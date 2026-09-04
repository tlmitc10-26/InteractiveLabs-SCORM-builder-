/**
 * LIGHT module (same discipline as the other three companion-doc twins:
 * branching-scenario, param-sandbox, case-workspace): zero heavy deps (no
 * zod, no schema.ts, no sanitize-html). Parses/serializes the plain-text
 * "companion doc" format designers/SMEs write process-simulator procedures
 * in — see docs/superpowers/specs/2026-09-04-process-simulator-design.md §6
 * for the binding rulings this grammar implements, and
 * docs/superpowers/plans/2026-09-04-process-simulator-m2.md Task 1 for the
 * concrete grammar (finalized against the real shipped schema.ts).
 *
 * `parseProcessCompanionDoc` never throws: it always returns a best-effort
 * `config` (an `unknown` structurally shaped like `ProcessConfigLike` below)
 * plus a complete, line-numbered `report`. The returned config is expected
 * to flow through `validateProcessConfig` (schema.ts) exactly like any
 * hand-authored draft; this module adds no new trust.
 *
 * This is the fourth parser/serializer twin. Unlike all three siblings, this
 * format has NO free-body prose anywhere: top matter is four single-line
 * directives (TITLE/INTRO/OPENING/EXPERTNOTE) and every ACTION block holds
 * only up to three single-line sub-directives (Outcome:/Consequence:/
 * Note:), recognized in ANY order and at most once each. Any other
 * non-blank, non-comment line inside an ACTION block is grammatically
 * meaningless in this format ("no free bodies" ruling) and is reported as
 * an unknown-line error and skipped — it is never accumulated as body text
 * the way a case ARTIFACT's or CONCLUSION's opaque body is.
 *
 * Known, intentional lossiness in the round trip (documented here, and
 * echoed as a `#` header comment in the emitted text whenever the config
 * actually uses one of these):
 *   - ids are NOT preserved (label-based format, like all three siblings) —
 *     comparisons across a round trip must go by label, not id.
 *   - `headerColor` is editor-only (brand-band color picker) and is dropped
 *     with a lossy header note (case-workspace precedent).
 *   - every rich field this format carries (INTRO/OPENING/EXPERTNOTE and
 *     each action's Outcome:/Consequence:) is SINGLE-LINE in the doc
 *     format, even though schema.ts's `rich()` fields have no paragraph-
 *     count limit of their own. A config whose field actually carries more
 *     than one `<p>...</p>` paragraph is collapsed to one line (paragraphs
 *     joined with a space) on serialize, flagged in a header comment —
 *     mirrors case-workspace's own INTRO handling exactly (INTRO there is
 *     also single-line in the doc format for the same reason).
 *   - an action label containing literal ",", "(", ")", or the literal text
 *     "after:" is grammar-significant (spec §6 review #9): it can break
 *     this label's own use as an `after:` TARGET by some other action, or
 *     (for "," specifically) the parsing of ITS OWN `after:` clause if it
 *     has one. The parser flags every such label with a line-numbered
 *     error at the point it's declared; the serializer flags the same set
 *     in a `#` header warning whenever a config carries one (this can only
 *     happen if a label was hand-typed or edited to contain one of these,
 *     since the editor's own label field allows free text).
 *
 * RULING (spec §6): every doc-authored PROSE field this format stores as
 * rich text (INTRO, OPENING, EXPERTNOTE, each action's Outcome/Consequence)
 * is HTML-escaped at parse time before being wrapped in `<p>...</p>` —
 * exactly the same doctrine as all three sibling formats' INTRO handling.
 * This closes the same pre-save-preview window those formats already
 * closed: the un-sandboxed same-origin preview renders an unvalidated
 * draft, so nothing doc-authored may carry live markup. PLAIN fields
 * (TITLE, an action's label, its Note:/consequenceNote) are NOT escaped —
 * they mirror schema.ts's `plain()` fields, which strip tags rather than
 * escape them, and every real sink renders them via `textContent`, not
 * `innerHTML` (case-workspace precedent: its TITLE/artifact-title/
 * conclusion-label are all unescaped too).
 */

import type { ImportIssue } from "@/lib/engines/branching-scenario/companion-doc";
import { uniqueSlug } from "@/lib/engines/slugify";

export type { ImportIssue };

// ---------------------------------------------------------------------------
// Grammar
// ---------------------------------------------------------------------------

const COMMENT_RE = /^\s*#/;
// The leading `\s*` also silently absorbs a leading UTF-8 BOM (U+FEFF is
// part of ECMAScript's `\s` class) — copied verbatim from all three
// siblings' load-bearing comment; do not "simplify" this away.
const TOP_DIRECTIVE_RE = /^\s*(TITLE|INTRO|OPENING|EXPERTNOTE|ACTION)\s*:\s*(.*)$/i;
// Catches a typo'd/unrecognized ALL-CAPS-colon line sitting OUTSIDE any
// ACTION block (case-workspace precedent) — e.g. "SITUATION: ..." — so a
// mistyped directive doesn't silently vanish as inert stray text.
const UNKNOWN_DIRECTIVE_RE = /^\s*[A-Z][A-Z ]{2,20}:\s/i;

// Content group excludes parens (mirrors all three siblings' own
// title/label-line regexes) so a label that itself contains a literal "("
// backtracks past its own paren to the real (outermost/last) marker parens
// instead of truncating there.
const ACTION_LINE_RE = /^(.*?)\s*\(([^()]*)\)\s*$/;
// Marker content: "required" or "distractor", optionally followed by
// ", after: <Label>, <Label>, ...". Anything that doesn't match this shape
// at all (missing entirely, or garbled) is treated identically by the
// coercion path below — loud either way, never silently defaulted.
const MARKER_RE = /^\s*(required|distractor)\s*(?:,\s*after\s*:\s*(.+))?\s*$/i;

const OUTCOME_LINE_RE = /^\s*Outcome\s*:\s*(.*)$/i;
const CONSEQUENCE_LINE_RE = /^\s*Consequence\s*:\s*(.*)$/i;
const NOTE_LINE_RE = /^\s*Note\s*:\s*(.*)$/i;

// The engine-4 RISKY set (spec §6 review #9): "," / "(" / ")" (grammar-
// significant everywhere a label is read) plus the literal "after:" token
// (which could be mistaken for the start of a marker's after-clause if it
// appears inside a label another action's after: list is trying to name).
const RISKY_LABEL_RE = /[(),]|after\s*:/i;
// Narrower set used for the PARSER's own per-label error (spec §6:
// "Labels containing ',', '(', or ')'"): these three are the characters
// that can actually corrupt THIS format's own parsing (comma splits an
// after: list; parens collide with the marker's own trailing group).
const LABEL_RISKY_CHARS_RE = /[(),]/;

const MIN_ACTIONS = 4;
const MAX_ACTIONS = 24;
const MIN_REQUIRED = 2;
const MAX_AFTER = 6;

// Mirror schema.ts's own caps (opus-review-style parser-side checks) so a
// violation is caught here, line-numbered and salvaged, rather than
// surfacing only as an opaque schema-validation failure with no line number.
const MAX_TITLE = 200;
const MAX_INTRO = 5000;
const MAX_OPENING = 2000;
const MAX_EXPERT_NOTE = 3000;
const MAX_LABEL = 200;
const MAX_OUTCOME = 1500;
const MAX_CONSEQUENCE = 1500;
const MAX_NOTE = 300;

function normalize(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"');
}

/** Escapes the three characters that matter for safe `innerHTML` placement
 *  inside a `<p>...</p>` wrapper — applied to every rich field before it's
 *  ever placed in the returned config (see the module doc comment's RULING).
 *  Copied verbatim from all three siblings' identical `escapeHtml`. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Reverses `escapeHtml` for the serializer — see all three siblings'
 *  identical `unescapeHtml` doc comment (same rationale and ordering
 *  constraint: `&` must decode last). */
function unescapeHtml(s: string): string {
  return s.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
}

function stripTags(html: string | undefined): string {
  return (html ?? "").replace(/<[^>]+>/g, "").trim();
}

/** Reconstructs blank-line-separated paragraphs from a body string built as
 *  concatenated `<p>...</p>` blocks — identical to all three siblings'
 *  `bodyToParagraphs`. This format's own fields are always single-paragraph
 *  when THIS module wrote them, but a hand-authored/editor-authored config
 *  can carry more (see the module doc comment's multi-paragraph bullet). */
function bodyToParagraphs(html: string | undefined): string[] {
  const matches = [...(html ?? "").matchAll(/<p>([\s\S]*?)<\/p>/gi)];
  if (matches.length === 0) {
    const plain = stripTags(html);
    return plain ? [plain] : [];
  }
  return matches.map((m) => stripTags(m[1]));
}

/** Collapses a (possibly multi-paragraph) rich field to the single line this
 *  doc format represents it as — paragraphs joined with a space (identical
 *  technique to case-workspace's own INTRO handling). */
function joinParagraphs(html: string | undefined): string {
  return bodyToParagraphs(html).filter(Boolean).join(" ");
}

/** Plain-text field cap: truncates and reports a line-numbered warning when
 *  a captured value exceeds the schema's own limit for that field. */
function capText(value: string, max: number, fieldLabel: string, lineNo: number, issues: ImportIssue[]): string {
  if (value.length <= max) return value;
  issues.push({ line: lineNo, severity: "warning", message: `${fieldLabel} is longer than ${max} characters — truncated` });
  return value.slice(0, max);
}

/** Same cap, applied to an already-`<p>`-wrapped rich-text string: truncates
 *  on a tag boundary and re-closes the final `<p>` so the salvaged HTML
 *  stays well-formed. Caps the POST-escape length (this string, after
 *  `escapeHtml` and the `<p>` wrap) — identical to all three siblings'
 *  `capRichHtml`, including the entity-safe-cut guard. */
function capRichHtml(html: string, max: number, fieldLabel: string, lineNo: number, issues: ImportIssue[]): string {
  if (html.length <= max) return html;
  issues.push({ line: lineNo, severity: "warning", message: `${fieldLabel} is longer than ${max} characters — truncated` });
  const CLOSE = "</p>";
  let truncated = html.slice(0, Math.max(0, max - CLOSE.length));
  const lastGt = truncated.lastIndexOf(">");
  const lastLt = truncated.lastIndexOf("<");
  if (lastLt > lastGt) truncated = truncated.slice(0, lastLt);
  const lastAmp = truncated.lastIndexOf("&");
  if (lastAmp !== -1 && !truncated.slice(lastAmp).includes(";")) {
    truncated = truncated.slice(0, lastAmp);
  }
  if (!truncated.endsWith(CLOSE)) truncated += CLOSE;
  return truncated;
}

// ---------------------------------------------------------------------------
// Internal working types
// ---------------------------------------------------------------------------

type RawBlock = { lineNo: number; valueRaw: string; interior: Array<{ lineNo: number; text: string }> };

type WorkingAction = {
  lineNo: number;
  label: string;
  required: boolean;
  id: string;
  skip?: boolean;
  afterRawLabels?: string[];
  requires?: string[];
  outcomeRaw?: string; outcomeLine?: number;
  consequenceRaw?: string; consequenceLine?: number;
  noteRaw?: string; noteLine?: number;
  interior: RawBlock["interior"];
};

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export function parseProcessCompanionDoc(text: string): { config: unknown; report: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const lines = normalize(text).split("\n");

  let titleRaw: string | undefined;
  let titleLine = 1;
  let introRaw: string | undefined;
  let introLine = 1;
  let openingRaw: string | undefined;
  let openingLine = 1;
  let expertNoteRaw: string | undefined;
  let expertNoteLine = 1;

  const blocks: RawBlock[] = [];
  let currentBlock: RawBlock | null = null;

  // -- Single pass: top matter + ACTION block boundaries -------------------
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    if (COMMENT_RE.test(line)) continue; // comments invisible everywhere

    const dm = line.match(TOP_DIRECTIVE_RE);
    if (dm) {
      const kind = dm[1].toUpperCase();
      if (kind === "ACTION") {
        currentBlock = { lineNo, valueRaw: dm[2], interior: [] };
        blocks.push(currentBlock);
      } else {
        currentBlock = null;
        const value = dm[2].trim();
        switch (kind) {
          case "TITLE": titleRaw = value; titleLine = lineNo; break;
          case "INTRO": introRaw = value; introLine = lineNo; break;
          case "OPENING": openingRaw = value; openingLine = lineNo; break;
          case "EXPERTNOTE": expertNoteRaw = value; expertNoteLine = lineNo; break;
        }
      }
      continue;
    }

    if (line.trim() === "") continue; // blank lines are inert everywhere

    if (currentBlock) {
      currentBlock.interior.push({ lineNo, text: line });
    } else if (UNKNOWN_DIRECTIVE_RE.test(line)) {
      issues.push({ line: lineNo, severity: "error", message: `unknown directive: "${line.trim()}"` });
    }
    // else: stray top-level prose — silently ignored (case-workspace precedent).
  }

  // -- Pass 1: label + required/distractor determination (coercion needs to
  //    know, per block, whether an Outcome: line is present ANYWHERE in the
  //    block — sub-lines are recognized in any order, so this is a full
  //    block scan, not a fixed-position lookahead). --------------------------
  const working: WorkingAction[] = blocks.map((b) => {
    const structured = b.valueRaw.match(ACTION_LINE_RE);
    const labelRaw = (structured ? structured[1] : b.valueRaw).trim() || "Untitled action";
    const label = capText(labelRaw, MAX_LABEL, "action label", b.lineNo, issues);
    if (LABEL_RISKY_CHARS_RE.test(label)) {
      // Warning, not error (a deliberate departure from a literal reading of
      // the plan's "parser error naming the label"): the shipped M1 blank
      // starter (PROCESS_STARTERS.blank, untouched by this M2 milestone)
      // already authors a label containing a comma ("Describe a second,
      // gated action here"), and that comma never actually corrupts a
      // parse unless this EXACT label is later targeted by some other
      // action's after: clause — which produces its own distinct,
      // fail-visible "doesn't exist"/mis-split error at THAT point. Making
      // this an unconditional error would mean the M1 starter itself can
      // never round-trip cleanly through the M2 companion-doc format, an
      // internal contradiction this module avoids. The label is still
      // flagged here (loud, not silent) and by the serializer's own header
      // warning (`RISKY_LABEL_RE`) whenever a config carries one.
      issues.push({
        line: b.lineNo, severity: "warning",
        message: `action "${label}": label contains "(", ")", or "," — this format's after: grammar treats these specially, and an after: reference naming this action may not resolve correctly`,
      });
    }

    const hasOutcome = b.interior.some((l) => OUTCOME_LINE_RE.test(l.text));
    const markerText = structured ? structured[2] : undefined;
    const markerMatch = markerText !== undefined ? markerText.match(MARKER_RE) : null;

    let required: boolean;
    let afterRawLabels: string[] | undefined;
    if (markerMatch) {
      required = markerMatch[1].toLowerCase() === "required";
      if (markerMatch[2]) {
        afterRawLabels = markerMatch[2].split(",").map((s) => s.trim()).filter(Boolean);
      }
    } else {
      required = hasOutcome;
      const reason = markerText === undefined
        ? `is missing its required "(required)" or "(distractor[, after: ...])" marker`
        : `has a marker ("(${markerText.trim()})") that isn't "(required)" or "(distractor[, after: ...])"`;
      issues.push({
        line: b.lineNo, severity: "error",
        message: `action "${label}" ${reason} — imported as ${required ? "required" : "distractor"} because ${required ? "an Outcome: line is present" : "no Outcome: line is present"}`,
      });
    }

    return { lineNo: b.lineNo, label, required, id: "", afterRawLabels, interior: b.interior };
  });

  // -- Pass 2: dedup (required-vs-required errors + prunes; distractor
  //    collisions warn only) + the 24-action cap, assigning ids only to
  //    surviving entries so a pruned/capped-out action's id never leaks into
  //    the requires-resolution map below. ------------------------------------
  const requiredLabelSeen = new Map<string, number>();
  const distractorLabelSeen = new Map<string, number>();
  const usedIds = new Set<string>();
  let acceptedCount = 0;

  for (const w of working) {
    const key = w.label.toLowerCase();
    if (w.required) {
      const firstLine = requiredLabelSeen.get(key);
      if (firstLine !== undefined) {
        issues.push({
          line: w.lineNo, severity: "error",
          message: `duplicate required action label "${w.label}" — already declared on line ${firstLine} (required labels must be unique); this second declaration (line ${w.lineNo}) is skipped and will not resolve in any after: clause`,
        });
        w.skip = true;
        continue;
      }
      if (acceptedCount >= MAX_ACTIONS) {
        issues.push({ line: w.lineNo, severity: "error", message: `too many actions (max ${MAX_ACTIONS}) — "${w.label}" was skipped` });
        w.skip = true;
        continue;
      }
      requiredLabelSeen.set(key, w.lineNo);
    } else {
      if (distractorLabelSeen.has(key)) {
        issues.push({ line: w.lineNo, severity: "warning", message: `duplicate distractor label "${w.label}" — already declared on line ${distractorLabelSeen.get(key)}; both are kept (only required action labels must be unique)` });
      } else {
        distractorLabelSeen.set(key, w.lineNo);
      }
      if (acceptedCount >= MAX_ACTIONS) {
        issues.push({ line: w.lineNo, severity: "error", message: `too many actions (max ${MAX_ACTIONS}) — "${w.label}" was skipped` });
        w.skip = true;
        continue;
      }
    }
    acceptedCount++;
    w.id = uniqueSlug(w.label, usedIds, "action");
    usedIds.add(w.id);
  }

  const requiredLabelMap = new Map<string, string>(); // lowercase label -> id, first-occurrence-wins, PRUNED entries excluded
  const distractorLabelSet = new Set<string>();
  for (const w of working) {
    if (w.skip) continue;
    const key = w.label.toLowerCase();
    if (w.required) { if (!requiredLabelMap.has(key)) requiredLabelMap.set(key, w.id); }
    else distractorLabelSet.add(key);
  }

  // -- Pass 3: resolve after: labels into ids -------------------------------
  const survivors = working.filter((w) => !w.skip);
  for (const w of survivors) {
    if (!w.required) {
      if (w.afterRawLabels?.length) {
        issues.push({ line: w.lineNo, severity: "error", message: `action "${w.label}": distractor actions must not carry after: prerequisites (a distractor's own prerequisites are never consulted) — dropped` });
      }
      continue;
    }
    const raw = w.afterRawLabels;
    if (!raw?.length) continue;
    const resolved: string[] = [];
    const seen = new Set<string>();
    for (const nameRaw of raw) {
      const key = nameRaw.toLowerCase();
      if (key === w.label.toLowerCase()) {
        issues.push({ line: w.lineNo, severity: "error", message: `action "${w.label}": after: cannot name itself — dropped` });
        continue;
      }
      const targetId = requiredLabelMap.get(key);
      if (targetId) {
        if (seen.has(targetId)) {
          issues.push({ line: w.lineNo, severity: "warning", message: `action "${w.label}": after: names "${nameRaw}" more than once — duplicate dropped` });
          continue;
        }
        seen.add(targetId);
        resolved.push(targetId);
      } else if (distractorLabelSet.has(key)) {
        issues.push({ line: w.lineNo, severity: "error", message: `action "${w.label}": after: names "${nameRaw}", a distractor — only required actions are referenceable — this prerequisite was dropped` });
      } else {
        issues.push({ line: w.lineNo, severity: "error", message: `action "${w.label}": after: names an action that doesn't exist: "${nameRaw}" — this prerequisite was dropped` });
      }
    }
    if (resolved.length > MAX_AFTER) {
      issues.push({ line: w.lineNo, severity: "error", message: `action "${w.label}": too many prerequisites (max ${MAX_AFTER}) — extra ones were dropped` });
      resolved.length = MAX_AFTER;
    }
    if (resolved.length) w.requires = resolved;
  }

  // -- Pass 4: cycle detection + breaking (spec §6 review #8) — break the
  //    edge on the LATER-numbered line among the cycle's own edges, error
  //    naming both actions, repeat until acyclic. ----------------------------
  {
    const byId = new Map(survivors.filter((w) => w.required).map((w) => [w.id, w] as const));
    const findCycle = (): string[] | null => {
      const state = new Map<string, 0 | 1 | 2>();
      let found: string[] | null = null;
      const visit = (id: string, stack: string[]) => {
        if (found) return;
        const s = state.get(id) ?? 0;
        if (s === 2) return;
        if (s === 1) { found = [...stack.slice(stack.indexOf(id)), id]; return; }
        state.set(id, 1);
        const node = byId.get(id);
        if (node?.requires) {
          for (const ref of node.requires) {
            if (!byId.has(ref)) continue;
            visit(ref, [...stack, id]);
            if (found) return;
          }
        }
        state.set(id, 2);
      };
      for (const id of byId.keys()) {
        visit(id, []);
        if (found) break;
      }
      return found;
    };
    let guard = 0;
    while (guard++ < survivors.length + 5) {
      const cycle = findCycle();
      if (!cycle) break;
      let bestIdx = 0, bestLine = -1;
      for (let i = 0; i < cycle.length - 1; i++) {
        const line = byId.get(cycle[i])!.lineNo;
        if (line > bestLine) { bestLine = line; bestIdx = i; }
      }
      const srcId = cycle[bestIdx], dstId = cycle[bestIdx + 1];
      const src = byId.get(srcId)!;
      src.requires = (src.requires ?? []).filter((r) => r !== dstId);
      if (src.requires.length === 0) src.requires = undefined;
      const dst = byId.get(dstId)!;
      const pathLabels = cycle.map((id) => byId.get(id)!.label).join(" -> ");
      issues.push({
        line: src.lineNo, severity: "error",
        message: `action "${src.label}": its after: on "${dst.label}" creates a prerequisite cycle (${pathLabels}) — that prerequisite was dropped`,
      });
    }
  }

  // -- Pass 5: sub-lines (Outcome:/Consequence:/Note:), any order, at most
  //    once each; any other line inside the block is unknown and skipped
  //    (this format has no free bodies). ------------------------------------
  for (const w of survivors) {
    for (const { lineNo, text } of w.interior) {
      const om = text.match(OUTCOME_LINE_RE);
      if (om) {
        if (w.outcomeRaw !== undefined) {
          issues.push({ line: lineNo, severity: "error", message: `action "${w.label}": duplicate Outcome: line — the first one (line ${w.outcomeLine}) is kept` });
        } else {
          w.outcomeRaw = om[1].trim(); w.outcomeLine = lineNo;
        }
        continue;
      }
      const cm = text.match(CONSEQUENCE_LINE_RE);
      if (cm) {
        if (w.consequenceRaw !== undefined) {
          issues.push({ line: lineNo, severity: "error", message: `action "${w.label}": duplicate Consequence: line — the first one (line ${w.consequenceLine}) is kept` });
        } else {
          w.consequenceRaw = cm[1].trim(); w.consequenceLine = lineNo;
        }
        continue;
      }
      const nm = text.match(NOTE_LINE_RE);
      if (nm) {
        if (w.noteRaw !== undefined) {
          issues.push({ line: lineNo, severity: "error", message: `action "${w.label}": duplicate Note: line — the first one (line ${w.noteLine}) is kept` });
        } else {
          w.noteRaw = nm[1].trim(); w.noteLine = lineNo;
        }
        continue;
      }
      issues.push({ line: lineNo, severity: "error", message: `action "${w.label}": unrecognized line inside its block (only Outcome:/Consequence:/Note: are allowed here) — skipped: "${text.trim()}"` });
    }
  }

  // -- Pass 6: field-requirement matrix (both directions, schema.ts's
  //    validateProcessConfig mirror), applied against the FINAL (post
  //    cycle-break) `requires` state. coerce-never-skip: every violation is
  //    a flagged placeholder or a flagged drop, never a skipped action. -----
  type OutAction = {
    id: string; label: string; required: boolean; requires?: string[];
    outcome?: string; consequence?: string; consequenceNote?: string;
  };
  const outActions: OutAction[] = [];
  for (const w of survivors) {
    const hasRequires = !!(w.requires && w.requires.length);
    const consequenceApplies = w.required ? hasRequires : true;

    let outcome: string | undefined;
    if (w.required) {
      if (w.outcomeRaw !== undefined) {
        outcome = capRichHtml(`<p>${escapeHtml(w.outcomeRaw)}</p>`, MAX_OUTCOME, `action "${w.label}" outcome`, w.outcomeLine ?? w.lineNo, issues);
      } else {
        issues.push({ line: w.lineNo, severity: "error", message: `action "${w.label}": required actions need an Outcome: line — a placeholder was inserted` });
        outcome = "<p>Outcome to be written.</p>";
      }
    } else if (w.outcomeRaw !== undefined) {
      issues.push({ line: w.outcomeLine ?? w.lineNo, severity: "error", message: `action "${w.label}": distractor actions must not carry an Outcome: line — dropped` });
    }

    let consequence: string | undefined;
    let consequenceNote: string | undefined;
    if (consequenceApplies) {
      if (w.consequenceRaw !== undefined) {
        consequence = capRichHtml(`<p>${escapeHtml(w.consequenceRaw)}</p>`, MAX_CONSEQUENCE, `action "${w.label}" consequence`, w.consequenceLine ?? w.lineNo, issues);
      } else {
        issues.push({ line: w.lineNo, severity: "error", message: `action "${w.label}": needs a Consequence: line (it can be attempted illegally) — a placeholder was inserted` });
        consequence = "<p>Consequence to be written.</p>";
      }
      if (w.noteRaw !== undefined) {
        consequenceNote = capText(w.noteRaw, MAX_NOTE, `action "${w.label}" note`, w.noteLine ?? w.lineNo, issues);
      } else {
        issues.push({ line: w.lineNo, severity: "error", message: `action "${w.label}": needs a Note: line (the debrief teaching line for its consequence) — a placeholder was inserted` });
        consequenceNote = "Note to be written.";
      }
    } else {
      if (w.consequenceRaw !== undefined) {
        issues.push({ line: w.consequenceLine ?? w.lineNo, severity: "error", message: `action "${w.label}": a prerequisite-free required action must not carry a Consequence: line (dead text) — dropped` });
      }
      if (w.noteRaw !== undefined) {
        issues.push({ line: w.noteLine ?? w.lineNo, severity: "error", message: `action "${w.label}": a Note: line only applies alongside a Consequence: line — dropped` });
      }
    }

    outActions.push({
      id: w.id, label: w.label, required: w.required,
      ...(w.requires?.length ? { requires: w.requires } : {}),
      ...(outcome !== undefined ? { outcome } : {}),
      ...(consequence !== undefined ? { consequence } : {}),
      ...(consequenceNote !== undefined ? { consequenceNote } : {}),
    });
  }

  // -- Top matter floors -----------------------------------------------------
  let title = titleRaw;
  if (title === undefined) {
    issues.push({ line: 1, severity: "warning", message: 'no TITLE given — defaulting to "Imported procedure"' });
    title = "Imported procedure";
  } else {
    title = capText(title, MAX_TITLE, "title", titleLine, issues);
  }

  let intro: string;
  if (introRaw !== undefined) {
    intro = capRichHtml(`<p>${escapeHtml(introRaw)}</p>`, MAX_INTRO, "intro", introLine, issues);
  } else {
    issues.push({ line: 1, severity: "warning", message: "no INTRO given — a placeholder intro was inserted (the schema requires one)" });
    intro = "<p>Intro to be written.</p>";
  }

  let opening: string;
  if (openingRaw !== undefined) {
    opening = capRichHtml(`<p>${escapeHtml(openingRaw)}</p>`, MAX_OPENING, "opening", openingLine, issues);
  } else {
    issues.push({ line: 1, severity: "warning", message: "no OPENING given — a placeholder opening was inserted (the schema requires one)" });
    opening = "<p>Opening to be written.</p>";
  }

  let expertNote: string | undefined;
  if (expertNoteRaw) {
    expertNote = capRichHtml(`<p>${escapeHtml(expertNoteRaw)}</p>`, MAX_EXPERT_NOTE, "expert note", expertNoteLine, issues);
  }

  // -- Floor: <4 actions or <2 required -> pad with prereq-free REQUIRED
  //    placeholders (placeholder Outcome, no requires — satisfies the field
  //    matrix and can never introduce a cycle). ------------------------------
  const usedActionIds = new Set(outActions.map((a) => a.id));
  const usedLabelsLower = new Set(outActions.map((a) => a.label.toLowerCase()));
  let placeholderN = 1;
  function nextPlaceholderLabel(prefix: string): string {
    let label = `${prefix} ${placeholderN}`;
    while (usedLabelsLower.has(label.toLowerCase())) {
      placeholderN++;
      label = `${prefix} ${placeholderN}`;
    }
    placeholderN++;
    usedLabelsLower.add(label.toLowerCase());
    return label;
  }
  const requiredCount = () => outActions.filter((a) => a.required).length;
  if (outActions.length < MIN_ACTIONS || requiredCount() < MIN_REQUIRED) {
    issues.push({
      line: 1, severity: "warning",
      message: `fewer than ${MIN_ACTIONS} actions (or fewer than ${MIN_REQUIRED} required actions) were found in this document — added placeholder required action(s) so this draft can still be edited`,
    });
    while (outActions.length < MIN_ACTIONS || requiredCount() < MIN_REQUIRED) {
      const label = nextPlaceholderLabel("Placeholder action");
      const id = uniqueSlug(label, usedActionIds, "action");
      usedActionIds.add(id);
      outActions.push({ id, label, required: true, outcome: "<p>Outcome to be written.</p>" });
    }
  }

  // -- Floor: the ≥1-illegally-attemptable rule (spec §2 review #4). ---------
  const hasPrereqEdge = outActions.some((a) => a.required && a.requires && a.requires.length > 0);
  const hasDistractor = outActions.some((a) => !a.required);
  if (!hasPrereqEdge && !hasDistractor) {
    issues.push({
      line: 1, severity: "error",
      message: "no required action carries a prerequisite and no distractor action exists — every learner would score 100 unconditionally; a placeholder distractor action was added",
    });
    const label = nextPlaceholderLabel("Placeholder wrong action");
    const id = uniqueSlug(label, usedActionIds, "action");
    usedActionIds.add(id);
    outActions.push({ id, label, required: false, consequence: "<p>Consequence to be written.</p>", consequenceNote: "Note to be written." });
  }

  issues.sort((a, b) => a.line - b.line);

  const config = {
    title, intro, opening,
    ...(expertNote ? { expertNote } : {}),
    actions: outActions,
  };

  return { config, report: issues };
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

/** Minimal shape this serializer needs — matches schema.ts's ProcessConfig
 *  structurally without importing zod, mirroring all three siblings'
 *  `*ConfigLike` precedent. */
export interface ProcessConfigLike {
  title: string;
  intro: string;
  headerColor?: string;
  opening: string;
  expertNote?: string;
  actions: Array<{
    id: string;
    label: string;
    required: boolean;
    requires?: string[];
    outcome?: string;
    consequence?: string;
    consequenceNote?: string;
  }>;
}

export function serializeProcessCompanionDoc(config: ProcessConfigLike): string {
  const lines: string[] = [];

  // -- Documented lossiness: header comments -------------------------------
  const lossyFeatures: string[] = [];
  if (config.headerColor) {
    lossyFeatures.push(`the header color ("${config.headerColor}") — header color is editor-only`);
  }
  const multiParaNames: string[] = [];
  const flagIfMulti = (html: string | undefined, name: string) => {
    if (html && bodyToParagraphs(html).filter(Boolean).length > 1) multiParaNames.push(name);
  };
  flagIfMulti(config.intro, "INTRO");
  flagIfMulti(config.opening, "OPENING");
  flagIfMulti(config.expertNote, "EXPERTNOTE");
  for (const a of config.actions) {
    flagIfMulti(a.outcome, `"${a.label}" Outcome`);
    flagIfMulti(a.consequence, `"${a.label}" Consequence`);
  }
  if (multiParaNames.length) {
    lossyFeatures.push(`multi-paragraph text collapsed to one line in ${multiParaNames.join(", ")} — this text format is single-line per field`);
  }
  if (lossyFeatures.length) {
    lines.push(`# Note: this config uses features this text format cannot represent, so they are simplified below: ${lossyFeatures.join("; ")}. Edit those in the app instead.`);
  }

  const riskyLabels = config.actions.map((a) => a.label).filter((l) => RISKY_LABEL_RE.test(l));
  if (riskyLabels.length) {
    lines.push(
      `# Warning: these action labels contain characters this format's grammar treats specially ("(", ")", ",", or "after:"), and may not re-import correctly if edited by hand: ${riskyLabels.map((l) => `"${l}"`).join(", ")}.`,
    );
  }
  if (lossyFeatures.length || riskyLabels.length) lines.push("");

  // -- Top matter -----------------------------------------------------------
  lines.push(`TITLE: ${config.title}`);
  lines.push(`INTRO: ${unescapeHtml(joinParagraphs(config.intro))}`);
  lines.push(`OPENING: ${unescapeHtml(joinParagraphs(config.opening))}`);
  if (config.expertNote) lines.push(`EXPERTNOTE: ${unescapeHtml(joinParagraphs(config.expertNote))}`);
  lines.push("");

  // -- Actions ----------------------------------------------------------
  const labelById = new Map(config.actions.map((a) => [a.id, a.label]));
  for (const a of config.actions) {
    const marker = a.required ? "required" : "distractor";
    const afterClause = a.required && a.requires?.length
      ? `, after: ${a.requires.map((id) => labelById.get(id) ?? id).join(", ")}`
      : "";
    lines.push(`ACTION: ${a.label} (${marker}${afterClause})`);
    if (a.outcome) lines.push(`Outcome: ${unescapeHtml(joinParagraphs(a.outcome))}`);
    if (a.consequence) lines.push(`Consequence: ${unescapeHtml(joinParagraphs(a.consequence))}`);
    if (a.consequenceNote) lines.push(`Note: ${a.consequenceNote}`);
    lines.push("");
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "\n");
}
