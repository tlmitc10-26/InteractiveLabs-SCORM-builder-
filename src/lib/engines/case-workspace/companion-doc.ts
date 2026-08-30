/**
 * LIGHT module (same discipline as branching-scenario/companion-doc.ts and
 * param-sandbox/companion-doc.ts): zero heavy deps (no zod, no schema.ts, no
 * sanitize-html). Parses/serializes the plain-text "companion doc" format
 * designers and faculty write case-workspace interactives in (see
 * docs/superpowers/specs/2026-08-28-case-workspace-design.md §6 for the
 * hardening rulings this grammar is BOUND by, and
 * docs/superpowers/plans/2026-08-28-case-workspace-m2.md Task 1 for the
 * concrete grammar this file implements, finalized against the real shipped
 * schema.ts). This is the third parser/serializer twin of
 * branching-scenario/companion-doc.ts and param-sandbox/companion-doc.ts:
 * same doctrine (line-based, names-not-ids, never-throws, `{ config,
 * report }`, line-numbered ImportIssue for every violation, floors that
 * always land an editable draft), a grammar shaped around this engine's own
 * concepts (ARTIFACT/CONCLUSION/MAP rather than scenes/endings/choices or
 * flat INPUT/OUTPUT directives).
 *
 * `parseCaseCompanionDoc` never throws: it always returns a best-effort
 * `config` (an `unknown` structurally shaped like `CaseConfigLike` below)
 * plus a complete, line-numbered `report`. The returned config is expected
 * to flow through `validateCaseConfig` (schema.ts) exactly like any
 * hand-authored draft; this module adds no new trust.
 *
 * `serializeCaseCompanionDoc` is the reverse. Known, intentional lossiness in
 * the round trip (documented here, and echoed as a `#` header comment in the
 * emitted text whenever the config actually uses one of these):
 *   - ids are NOT preserved (title/label-based format, like both siblings) —
 *     comparisons across a round trip must go by title/label.
 *   - `kind: "image"` artifacts have no text representation (the image
 *     picker + alt-text matrix are editor-only) and are dropped entirely; a
 *     hand-typed `ARTIFACT: <Title> (image)` line is rejected on import with
 *     a line-numbered error and the artifact is skipped AND pruned from
 *     every resolution table (a MAP line naming it errors, it does not
 *     silently resolve).
 *   - `headerColor` is editor-only (brand-band color picker) and is dropped.
 *   - a conclusion's `body` is dropped. This is the one grammar tradeoff
 *     this format makes that the sibling formats don't have to: schema.ts's
 *     `expertRationale` is REQUIRED (unlike a scene/ending body, which is
 *     optional) but this format has room for exactly one prose block per
 *     CONCLUSION (the `Rationale:` sub-line and its continuation, mirroring
 *     how `Source:`/`Caption:` are recognized only as the fixed line(s)
 *     right after the ARTIFACT line — see spec §6). Since `expertRationale`
 *     always exists and always needs that slot, an optional `body` — which
 *     would need a SECOND prose block — cannot also be represented; the
 *     serializer always emits `Rationale:` from `expertRationale` and, if
 *     `body` is also set, drops it with a `#` note rather than silently
 *     picking one on import (which would misattribute the wrong text to the
 *     wrong field on a future edit-and-reimport cycle).
 *   - a title/label containing literal "(", "->", " supports ", or
 *     " contradicts " parses wrong by design (this is a title-based, not an
 *     escaped, format): the serializer emits it verbatim and flags it in a
 *     header comment; such a title degrades to a visible, fail-visible
 *     import-report error/misresolution on the next import rather than
 *     silent corruption.
 *   - a table cell containing literal "|" is documented lossiness (the cell
 *     splits into extra columns on reimport, causing a row/header count
 *     mismatch that the parser then pads/truncates, flagged).
 */

import type { ImportIssue } from "@/lib/engines/branching-scenario/companion-doc";
import { uniqueSlug } from "@/lib/engines/slugify";

export type { ImportIssue };

// ---------------------------------------------------------------------------
// Grammar
// ---------------------------------------------------------------------------

const COMMENT_RE = /^\s*#/;
// The leading `\s*` here also silently absorbs a leading UTF-8 BOM (U+FEFF
// is part of ECMAScript's `\s` character class), so a doc saved by an
// editor that stamps a BOM on the very first line still matches its first
// TITLE/etc. directive on line 1. Copied verbatim from both siblings'
// load-bearing comment — do not "simplify" this regex in a way that drops
// it.
const DIRECTIVE_RE = /^\s*(TITLE|INTRO|MODE|ARTIFACT|CONCLUSION|MAP)\s*:\s*(.*)$/i;
// Applied ONLY outside any ARTIFACT/CONCLUSION block (see the module doc
// comment's "opaque bodies" doctrine, spec §6 bullet 1): a deposition
// transcript's "Alvarez:" lines or a memo's "Subject:" header are exactly
// this engine's content, and must never be mistaken for a mistyped
// directive just because they happen to end in a colon.
const UNKNOWN_DIRECTIVE_RE = /^\s*[A-Z][A-Z ]{2,20}:\s/i;

// Recognized ONLY as the fixed line(s) immediately following the line that
// opened the block (ARTIFACT's Source:/Caption:, CONCLUSION's Rationale:) —
// resolved via a one-line lookahead at block-open time, never re-checked
// later in the block (a second "Source:"-looking line deeper in an
// artifact's body is just body text, per the opaque-body rule).
const SOURCE_LINE_RE = /^\s*Source\s*:\s*(.*)$/i;
const CAPTION_LINE_RE = /^\s*Caption\s*:\s*(.*)$/i;
const RATIONALE_LINE_RE = /^\s*Rationale\s*:\s*(.*)$/i;

// Content group excludes parens (mirrors both siblings' INPUT/OUTPUT line
// regexes) so a title that itself contains a literal "(" — e.g. "Log
// (Draft)" — backtracks past its own paren to the real (outermost/last)
// metadata parens instead of truncating there.
const ARTIFACT_LINE_RE = /^(.*?)\s*\(([^()]*)\)\s*$/;
const CONCLUSION_LINE_RE = /^(.*?)\s*\(([^()]*)\)\s*$/;
const MAP_LINE_RE = /^(.*?)\s+(supports|contradicts)\s+(.+?)\s*(?:\((strong|weak)\)\s*)?$/i;

const REASON_PREFIX_RE = /^-\s*(.*)$/;
// Marker anchored at end of line (spec §6 bullet 3): the FLAWED note may
// contain any characters except a TRAILING ")" (the outer paren that closes
// the marker itself) — notably, it may contain ITS OWN internal parens (e.g.
// "...causes (miscounting, a pricing error); it does not..."). The note
// group is therefore a GREEDY `(.*)` (not `[^)]*`): greedy backtracking
// naturally consumes up to the LAST ")" in the line and leaves exactly that
// one for the closing `\)\s*$`, rather than stopping at the first ")" it
// meets (which would truncate a note containing its own parenthetical).
const REASON_MARKER_RE = /^(.*?)\s*\(\s*(SOUND|FLAWED\s*:\s*(.*))\)\s*$/i;

// Characters/substrings this grammar treats specially in a title/label —
// same doctrine as param-sandbox's RISKY_LABEL_RE, adapted to this format's
// own grammar (no formulas, no " vs ", but ARTIFACT/CONCLUSION lines use
// trailing parens and MAP lines use " supports "/" contradicts " as
// keywords).
const RISKY_LABEL_RE = /\(|->| supports | contradicts /i;

const MIN_ARTIFACTS = 2;
const MAX_ARTIFACTS = 16;
const MIN_CONCLUSIONS = 2;
const MAX_CONCLUSIONS = 6;
const MIN_REASONS = 2;
const MAX_REASONS = 6;
const MAX_MAP = 96;
const MIN_TABLE_HEADERS = 2;
const MAX_TABLE_HEADERS = 5;
const MAX_TABLE_ROWS = 8;

// Mirror schema.ts's own text caps (opus-review-style parser-side checks, so
// a violation is caught here, line-numbered and salvaged, rather than
// surfacing only as an opaque schema-validation failure with no line number
// at all — the same rationale as param-sandbox's MAX_UNITS_LENGTH etc.).
const MAX_TITLE = 200;
const MAX_INTRO = 5000;
const MAX_ARTIFACT_TITLE = 120;
const MAX_SOURCE_LINE = 200;
const MAX_ARTIFACT_BODY = 3000;
const MAX_TABLE_CAPTION = 200;
const MAX_TABLE_HEADER_TEXT = 60;
const MAX_TABLE_CELL = 120;
const MAX_CONCLUSION_LABEL = 200;
const MAX_EXPERT_RATIONALE = 3000;
const MAX_REASON_TEXT = 300;
const MAX_FLAW_NOTE = 300;

function normalize(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"');
}

/** Escapes the three characters that matter for safe `innerHTML` placement
 *  inside a `<p>...</p>` wrapper. Applied to INTRO before it's ever placed
 *  in the returned config — see both siblings' identical `escapeHtml` doc
 *  comment for the unsanitized-draft -> preview innerHTML path this closes.
 *  Only INTRO gets this treatment (matching branching-scenario's own
 *  precedent of leaving SCENE/ENDING body unescaped): artifact/conclusion
 *  body text follows the same convention as branching's scene/ending body. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Reverses `escapeHtml` for the serializer's INTRO line — see both
 *  siblings' identical `unescapeHtml` doc comment (same rationale and
 *  ordering constraint: `&` must decode last). */
function unescapeHtml(s: string): string {
  return s.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
}

function stripTags(html: string | undefined): string {
  return (html ?? "").replace(/<[^>]+>/g, "").trim();
}

/** Reconstructs blank-line-separated paragraphs from a body string built as
 *  concatenated `<p>...</p>` blocks — identical to branching-scenario's
 *  `bodyToParagraphs`. */
function bodyToParagraphs(html: string | undefined): string[] {
  const matches = [...(html ?? "").matchAll(/<p>([\s\S]*?)<\/p>/gi)];
  if (matches.length === 0) {
    const plain = stripTags(html);
    return plain ? [plain] : [];
  }
  return matches.map((m) => stripTags(m[1]));
}

function toBody(paragraphs: string[]): string {
  return paragraphs.map((p) => `<p>${p}</p>`).join("");
}

/** Plain-text field cap: truncates and reports a line-numbered warning when
 *  a captured value exceeds the schema's own limit for that field, so the
 *  violation is salvaged here instead of surfacing only as an opaque
 *  post-hoc schema error. */
function capText(value: string, max: number, fieldLabel: string, lineNo: number, issues: ImportIssue[]): string {
  if (value.length <= max) return value;
  issues.push({ line: lineNo, severity: "warning", message: `${fieldLabel} is longer than ${max} characters — truncated` });
  return value.slice(0, max);
}

/** Same cap, applied to an already-`<p>`-wrapped rich-text string: truncates
 *  on a tag boundary and re-closes the final `<p>` so the salvaged HTML
 *  stays well-formed. */
function capRichHtml(html: string, max: number, fieldLabel: string, lineNo: number, issues: ImportIssue[]): string {
  if (html.length <= max) return html;
  issues.push({ line: lineNo, severity: "warning", message: `${fieldLabel} is longer than ${max} characters — truncated` });
  let truncated = html.slice(0, max);
  const lastGt = truncated.lastIndexOf(">");
  const lastLt = truncated.lastIndexOf("<");
  if (lastLt > lastGt) truncated = truncated.slice(0, lastLt);
  if (!truncated.endsWith("</p>")) truncated += "</p>";
  return truncated;
}

function parseTableRow(raw: string): string[] {
  let s = raw.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

// ---------------------------------------------------------------------------
// Internal working types
// ---------------------------------------------------------------------------

type ArtifactKind = "text" | "table";
type ArtifactTitleEntry = { id: string; title: string; line: number; skip?: boolean; kind?: ArtifactKind };
type ConclusionMarker = "best" | "defensible" | "unsupported";
type ConclusionTitleEntry = { id: string; title: string; line: number; skip?: boolean; marker?: ConclusionMarker };

type WorkingReason = { id: string; text: string; sound: boolean; flawNote?: string };
type WorkingConclusion = {
  id: string;
  label: string;
  line: number;
  markerRaw?: ConclusionMarker;
  body?: string;
  expertRationale: string;
  reasons: WorkingReason[];
  credit?: "full" | "partial" | "none";
};
type WorkingArtifact = {
  id: string;
  title: string;
  kind: ArtifactKind;
  sourceLine?: string;
  body?: string;
  table?: { caption?: string; headers: string[]; rows: string[][] };
};
type WorkingMapEntry = { artifactId: string; conclusionId: string; role: "supports" | "contradicts"; strength: "strong" | "weak" };

/** Pass 1: walk every ARTIFACT:/CONCLUSION: line once to assign each one's
 *  final id and detect duplicates/kind problems/cap overflow UP FRONT — so
 *  MAP resolution (which needs to see every valid title regardless of file
 *  order) works, and so a skipped/duplicate/capped-out declaration's id
 *  never leaks into a resolution table (spec §6 / the sandbox review round's
 *  "pruning" rule). Mirrors branching's collectTitles / sandbox's
 *  collectLabels, but the cap check also lives HERE (not in pass 2) — unlike
 *  both siblings — specifically so a MAP line can never resolve to an id
 *  that didn't survive the cap (pass 2 trusts pass 1's skip flag
 *  completely, it never re-checks the cap itself). */
function collectArtifactTitles(lines: string[], issues: ImportIssue[]): ArtifactTitleEntry[] {
  const entries: ArtifactTitleEntry[] = [];
  const usedIds = new Set<string>();
  const seenTitles = new Map<string, number>();
  let acceptedCount = 0;

  lines.forEach((line, i) => {
    if (COMMENT_RE.test(line)) return;
    const m = line.match(DIRECTIVE_RE);
    if (!m || m[1].toUpperCase() !== "ARTIFACT") return;
    const lineNo = i + 1;
    const value = m[2];
    const structured = value.match(ARTIFACT_LINE_RE);
    const titleRaw = (structured ? structured[1] : value).trim() || "Untitled artifact";
    const title = capText(titleRaw, MAX_ARTIFACT_TITLE, "artifact title", lineNo, issues);
    const kindToken = structured ? structured[2].trim().toLowerCase() : undefined;

    if (kindToken === undefined) {
      issues.push({ line: lineNo, severity: "error", message: `ARTIFACT line must specify a kind: "${title}" needs "(text)", "(image)", or "(table)" after it` });
      entries.push({ id: "", title, line: lineNo, skip: true });
      return;
    }
    if (kindToken === "image") {
      issues.push({ line: lineNo, severity: "error", message: `artifact "${title}": image artifacts are editor-only in this text format — build these directly in the app; this artifact was skipped` });
      entries.push({ id: "", title, line: lineNo, skip: true });
      return;
    }
    if (kindToken !== "text" && kindToken !== "table") {
      issues.push({ line: lineNo, severity: "error", message: `artifact "${title}": kind must be "text" or "table" (got "${kindToken}") — this artifact was skipped` });
      entries.push({ id: "", title, line: lineNo, skip: true });
      return;
    }
    const key = title.toLowerCase();
    const firstLine = seenTitles.get(key);
    if (firstLine !== undefined) {
      issues.push({
        line: lineNo,
        severity: "error",
        message: `duplicate artifact title "${title}" — already declared on line ${firstLine}; this second declaration (line ${lineNo}) is skipped and will not resolve in the expert map`,
      });
      entries.push({ id: "", title, line: lineNo, skip: true, kind: kindToken });
      return;
    }
    seenTitles.set(key, lineNo);
    if (acceptedCount >= MAX_ARTIFACTS) {
      issues.push({ line: lineNo, severity: "error", message: `too many artifacts (max ${MAX_ARTIFACTS}) — "${title}" was skipped` });
      entries.push({ id: "", title, line: lineNo, skip: true, kind: kindToken });
      return;
    }
    const id = uniqueSlug(title, usedIds, "artifact");
    usedIds.add(id);
    acceptedCount++;
    entries.push({ id, title, line: lineNo, kind: kindToken });
  });

  return entries;
}

function collectConclusionTitles(lines: string[], issues: ImportIssue[]): ConclusionTitleEntry[] {
  const entries: ConclusionTitleEntry[] = [];
  const usedIds = new Set<string>();
  const seenTitles = new Map<string, number>();
  let acceptedCount = 0;

  lines.forEach((line, i) => {
    if (COMMENT_RE.test(line)) return;
    const m = line.match(DIRECTIVE_RE);
    if (!m || m[1].toUpperCase() !== "CONCLUSION") return;
    const lineNo = i + 1;
    const value = m[2];
    const structured = value.match(CONCLUSION_LINE_RE);
    const labelRaw = (structured ? structured[1] : value).trim() || "Untitled conclusion";
    const label = capText(labelRaw, MAX_CONCLUSION_LABEL, "conclusion label", lineNo, issues);
    let marker: ConclusionMarker | undefined;
    if (structured) {
      const token = structured[2].trim().toLowerCase();
      if (token === "best" || token === "defensible" || token === "unsupported") {
        marker = token;
      } else if (token !== "") {
        issues.push({ line: lineNo, severity: "error", message: `conclusion "${label}": credit marker must be "(best)", "(defensible)", or "(unsupported)" (got "(${token})") — treated as no marker` });
      }
    }

    const key = label.toLowerCase();
    const firstLine = seenTitles.get(key);
    if (firstLine !== undefined) {
      issues.push({
        line: lineNo,
        severity: "error",
        message: `duplicate conclusion title "${label}" — already declared on line ${firstLine}; this second declaration (line ${lineNo}) is skipped and will not resolve in the expert map`,
      });
      entries.push({ id: "", title: label, line: lineNo, skip: true, marker });
      return;
    }
    seenTitles.set(key, lineNo);
    if (acceptedCount >= MAX_CONCLUSIONS) {
      issues.push({ line: lineNo, severity: "error", message: `too many conclusions (max ${MAX_CONCLUSIONS}) — "${label}" was skipped` });
      entries.push({ id: "", title: label, line: lineNo, skip: true, marker });
      return;
    }
    const id = uniqueSlug(label, usedIds, "conclusion");
    usedIds.add(id);
    acceptedCount++;
    entries.push({ id, title: label, line: lineNo, marker });
  });

  return entries;
}

/** First-occurrence-wins, case-insensitive title lookup — mirrors
 *  branching's sceneByTitle/endingByTitle. Skip entries are never the first
 *  occurrence for their key by construction (pass 1 only marks the SECOND+
 *  occurrence as skip), so they're harmless here even if ever passed in. */
function toTitleMap(entries: Array<{ id: string; title: string; skip?: boolean }>): Map<string, string> {
  const map = new Map<string, string>();
  for (const e of entries) {
    if (e.skip) continue;
    const key = e.title.toLowerCase();
    if (!map.has(key)) map.set(key, e.id);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export function parseCaseCompanionDoc(text: string): { config: unknown; report: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const lines = normalize(text).split("\n");

  const artifactTitleList = collectArtifactTitles(lines, issues);
  const conclusionTitleList = collectConclusionTitles(lines, issues);
  const artifactByTitle = toTitleMap(artifactTitleList);
  const conclusionByTitle = toTitleMap(conclusionTitleList);

  let title: string | undefined;
  let introRaw: string | undefined;
  let introLine = 1;
  let scoringModeRaw: "single" | "best-supported" | "argument-quality" | undefined;

  const artifacts: WorkingArtifact[] = [];
  const conclusions: WorkingConclusion[] = [];
  const expertMap: WorkingMapEntry[] = [];
  const seenMapPairs = new Set<string>();

  let artifactPtr = 0;
  let conclusionPtr = 0;
  const consumedLines = new Set<number>(); // 0-based indices consumed by a Source:/Caption:/Rationale: lookahead

  type ArtifactBuilder = {
    id: string;
    title: string;
    line: number;
    kind: ArtifactKind;
    sourceLine?: string;
    caption?: string;
    paragraphs: string[];
    currentParagraph: string[];
    tableRows: Array<{ line: number; text: string }>;
  };
  type ConclusionBuilder = {
    id: string;
    label: string;
    line: number;
    markerRaw?: ConclusionMarker;
    rationaleMode: boolean;
    rationaleParagraphs: string[];
    bodyParagraphs: string[];
    currentParagraph: string[];
    reasons: WorkingReason[];
    usedReasonIds: Set<string>;
  };
  type Section = { kind: "artifact"; ref: ArtifactBuilder | null } | { kind: "conclusion"; ref: ConclusionBuilder | null } | null;
  const sectionState: { current: Section } = { current: null };

  function flushCurrentParagraph(): void {
    if (sectionState.current?.kind === "artifact" && sectionState.current.ref && sectionState.current.ref.kind === "text") {
      const b = sectionState.current.ref;
      if (b.currentParagraph.length) {
        b.paragraphs.push(b.currentParagraph.join(" "));
        b.currentParagraph = [];
      }
    } else if (sectionState.current?.kind === "conclusion" && sectionState.current.ref) {
      const b = sectionState.current.ref;
      if (b.currentParagraph.length) {
        const para = b.currentParagraph.join(" ");
        if (b.rationaleMode) b.rationaleParagraphs.push(para);
        else b.bodyParagraphs.push(para);
        b.currentParagraph = [];
      }
    }
  }

  function finalizeArtifactTable(b: ArtifactBuilder): { caption?: string; headers: string[]; rows: string[][] } {
    if (b.tableRows.length === 0) {
      issues.push({ line: b.line, severity: "error", message: `artifact "${b.title}": table has no rows — a placeholder table was inserted` });
      return { caption: b.caption, headers: ["Column 1", "Column 2"], rows: [["", ""]] };
    }
    let headers = parseTableRow(b.tableRows[0].text).map((h) => capText(h, MAX_TABLE_HEADER_TEXT, `artifact "${b.title}" table header`, b.tableRows[0].line, issues));
    if (headers.length < MIN_TABLE_HEADERS) {
      issues.push({ line: b.tableRows[0].line, severity: "error", message: `artifact "${b.title}": table needs at least ${MIN_TABLE_HEADERS} columns — padded with placeholder column(s)` });
      while (headers.length < MIN_TABLE_HEADERS) headers.push(`Column ${headers.length + 1}`);
    } else if (headers.length > MAX_TABLE_HEADERS) {
      issues.push({ line: b.tableRows[0].line, severity: "error", message: `artifact "${b.title}": table has more than ${MAX_TABLE_HEADERS} columns — extra columns were dropped` });
      headers = headers.slice(0, MAX_TABLE_HEADERS);
    }
    let dataRows = b.tableRows.slice(1);
    if (dataRows.length === 0) {
      issues.push({ line: b.line, severity: "error", message: `artifact "${b.title}": table has headers but no data rows — a placeholder row was inserted` });
      dataRows = [{ line: b.line, text: headers.map(() => "").join(" | ") }];
    } else if (dataRows.length > MAX_TABLE_ROWS) {
      issues.push({ line: b.line, severity: "error", message: `artifact "${b.title}": table has more than ${MAX_TABLE_ROWS} rows — extra rows were dropped` });
      dataRows = dataRows.slice(0, MAX_TABLE_ROWS);
    }
    const rows = dataRows.map((raw) => {
      let cells = parseTableRow(raw.text).map((c) => capText(c, MAX_TABLE_CELL, `artifact "${b.title}" table cell`, raw.line, issues));
      if (cells.length !== headers.length) {
        issues.push({
          line: raw.line,
          severity: "error",
          message: `artifact "${b.title}" table row has ${cells.length} cell(s) but the table has ${headers.length} column(s) — ${cells.length < headers.length ? "padded" : "truncated"} to fit`,
        });
        if (cells.length < headers.length) {
          cells = [...cells, ...Array(headers.length - cells.length).fill("")];
        } else {
          cells = cells.slice(0, headers.length);
        }
      }
      return cells;
    });
    const caption = b.caption ? capText(b.caption, MAX_TABLE_CAPTION, `artifact "${b.title}" table caption`, b.line, issues) : undefined;
    return { caption, headers, rows };
  }

  function finalizeCurrentSection(): void {
    if (sectionState.current?.kind === "artifact" && sectionState.current.ref) {
      const b = sectionState.current.ref;
      if (b.kind === "text") {
        let body = b.paragraphs.length ? capRichHtml(toBody(b.paragraphs), MAX_ARTIFACT_BODY, `artifact "${b.title}" body`, b.line, issues) : undefined;
        if (!body) {
          issues.push({ line: b.line, severity: "error", message: `artifact "${b.title}": text artifacts require body text — a placeholder was inserted` });
          body = "<p>Artifact text to be written.</p>";
        }
        artifacts.push({ id: b.id, title: b.title, kind: "text", sourceLine: b.sourceLine, body });
      } else {
        artifacts.push({ id: b.id, title: b.title, kind: "table", sourceLine: b.sourceLine, table: finalizeArtifactTable(b) });
      }
    } else if (sectionState.current?.kind === "conclusion" && sectionState.current.ref) {
      const b = sectionState.current.ref;
      let body: string | undefined;
      let expertRationale: string;
      if (b.rationaleMode) {
        expertRationale = b.rationaleParagraphs.length ? toBody(b.rationaleParagraphs) : "";
        if (!expertRationale) {
          issues.push({ line: b.line, severity: "error", message: `conclusion "${b.label}": Rationale: was empty — a placeholder rationale was inserted` });
          expertRationale = "<p>Expert rationale to be written.</p>";
        } else {
          expertRationale = capRichHtml(expertRationale, MAX_EXPERT_RATIONALE, `conclusion "${b.label}" rationale`, b.line, issues);
        }
      } else {
        body = b.bodyParagraphs.length ? capRichHtml(toBody(b.bodyParagraphs), 2000, `conclusion "${b.label}" body`, b.line, issues) : undefined;
        issues.push({
          line: b.line,
          severity: "error",
          message: `conclusion "${b.label}": no "Rationale:" line was found right after the CONCLUSION line (expert rationale is required) — a placeholder was inserted`,
        });
        expertRationale = "<p>Expert rationale to be written.</p>";
      }

      let reasons = b.reasons;
      if (reasons.length < MIN_REASONS) {
        issues.push({ line: b.line, severity: "error", message: `conclusion "${b.label}": needs at least ${MIN_REASONS} reasons — padded with placeholder reason(s)` });
        while (reasons.length < MIN_REASONS) {
          const id = uniqueSlug(`reason ${reasons.length + 1}`, b.usedReasonIds, "reason");
          b.usedReasonIds.add(id);
          reasons.push({ id, text: "Reason to be written.", sound: true });
        }
      }
      if (!reasons.some((r) => r.sound)) {
        issues.push({ line: b.line, severity: "error", message: `conclusion "${b.label}": needs at least one sound reason — the first reason was coerced to sound` });
        reasons = reasons.map((r, i) => (i === 0 ? { ...r, sound: true, flawNote: undefined } : r));
      }

      conclusions.push({ id: b.id, label: b.label, line: b.line, markerRaw: b.markerRaw, body, expertRationale, reasons });
    }
    sectionState.current = null;
  }

  function openArtifactBlock(lineNo: number, i: number): void {
    const entry = artifactTitleList[artifactPtr++];
    if (entry.skip) {
      sectionState.current = { kind: "artifact", ref: null };
      return;
    }
    let sourceLine: string | undefined;
    let cursor = i + 1;
    if (cursor < lines.length) {
      const sm = lines[cursor].match(SOURCE_LINE_RE);
      if (sm) {
        sourceLine = capText(sm[1].trim(), MAX_SOURCE_LINE, `artifact "${entry.title}" source line`, lineNo, issues);
        consumedLines.add(cursor);
        cursor++;
      }
    }
    let caption: string | undefined;
    if (entry.kind === "table" && cursor < lines.length) {
      const cm = lines[cursor].match(CAPTION_LINE_RE);
      if (cm) {
        caption = cm[1].trim();
        consumedLines.add(cursor);
      }
    }
    sectionState.current = {
      kind: "artifact",
      ref: {
        id: entry.id,
        title: entry.title,
        line: lineNo,
        kind: entry.kind as ArtifactKind,
        sourceLine,
        caption,
        paragraphs: [],
        currentParagraph: [],
        tableRows: [],
      },
    };
  }

  function openConclusionBlock(lineNo: number, i: number): void {
    const entry = conclusionTitleList[conclusionPtr++];
    if (entry.skip) {
      sectionState.current = { kind: "conclusion", ref: null };
      return;
    }
    let rationaleMode = false;
    let firstRationaleText: string | undefined;
    if (i + 1 < lines.length) {
      const rm = lines[i + 1].match(RATIONALE_LINE_RE);
      if (rm) {
        rationaleMode = true;
        firstRationaleText = rm[1].trim();
        consumedLines.add(i + 1);
      }
    }
    sectionState.current = {
      kind: "conclusion",
      ref: {
        id: entry.id,
        label: entry.title,
        line: lineNo,
        markerRaw: entry.marker,
        rationaleMode,
        rationaleParagraphs: [],
        bodyParagraphs: [],
        currentParagraph: firstRationaleText ? [firstRationaleText] : [],
        reasons: [],
        usedReasonIds: new Set<string>(),
      },
    };
  }

  function processReason(rawAfterDash: string, lineNo: number, b: ConclusionBuilder | null): void {
    if (!b) return; // conclusion is skipped/capped-out — already reported, discard silently
    if (b.reasons.length >= MAX_REASONS) {
      issues.push({ line: lineNo, severity: "error", message: `too many reasons in this conclusion (max ${MAX_REASONS}) — this reason was skipped` });
      return;
    }
    const marker = rawAfterDash.match(REASON_MARKER_RE);
    let text: string;
    let sound = true;
    let flawNote: string | undefined;
    if (!marker) {
      text = rawAfterDash.trim();
      issues.push({ line: lineNo, severity: "error", message: `reason is missing "(SOUND)" or "(FLAWED: <note>)" — imported as SOUND` });
    } else {
      text = marker[1].trim();
      if (/^SOUND$/i.test(marker[2].trim())) {
        sound = true;
      } else {
        sound = false;
        let note = (marker[3] ?? "").trim();
        if (note === "") {
          issues.push({ line: lineNo, severity: "warning", message: `flawed reason has an empty flaw note — a placeholder note was inserted` });
          note = "Reasoning flaw not further explained.";
        }
        flawNote = capText(note, MAX_FLAW_NOTE, "flaw note", lineNo, issues);
      }
    }
    text = capText(text || "A reason.", MAX_REASON_TEXT, "reason text", lineNo, issues);
    const id = uniqueSlug(text, b.usedReasonIds, "reason");
    b.usedReasonIds.add(id);
    b.reasons.push({ id, text, sound, ...(flawNote ? { flawNote } : {}) });
  }

  function processMap(rawValue: string, lineNo: number): void {
    if (expertMap.length >= MAX_MAP) {
      issues.push({ line: lineNo, severity: "error", message: `too many expert map entries (max ${MAX_MAP}) — this line was skipped` });
      return;
    }
    const m = rawValue.match(MAP_LINE_RE);
    if (!m) {
      issues.push({ line: lineNo, severity: "error", message: 'MAP line must look like "<Artifact> supports|contradicts <Conclusion> [(strong|weak)]"' });
      return;
    }
    const artifactTitleRaw = m[1].trim();
    const role = m[2].toLowerCase() as "supports" | "contradicts";
    const conclusionTitleRaw = m[3].trim();
    const strengthRaw = m[4];
    const artifactId = artifactByTitle.get(artifactTitleRaw.toLowerCase());
    if (!artifactId) {
      issues.push({ line: lineNo, severity: "error", message: `MAP: no artifact named "${artifactTitleRaw}"` });
      return;
    }
    const conclusionId = conclusionByTitle.get(conclusionTitleRaw.toLowerCase());
    if (!conclusionId) {
      issues.push({ line: lineNo, severity: "error", message: `MAP: no conclusion named "${conclusionTitleRaw}"` });
      return;
    }
    let strength: "strong" | "weak";
    if (strengthRaw) {
      strength = strengthRaw.toLowerCase() as "strong" | "weak";
    } else {
      strength = "weak";
      issues.push({ line: lineNo, severity: "warning", message: "MAP: no strength given — defaulted to weak" });
    }
    const pairKey = `${artifactId}::${conclusionId}`;
    if (seenMapPairs.has(pairKey)) {
      issues.push({ line: lineNo, severity: "error", message: `MAP: duplicate entry for "${artifactTitleRaw}" / "${conclusionTitleRaw}" — this line was skipped, the earlier entry stands` });
      return;
    }
    seenMapPairs.add(pairKey);
    expertMap.push({ artifactId, conclusionId, role, strength });
  }

  for (let i = 0; i < lines.length; i++) {
    if (consumedLines.has(i)) continue;
    const line = lines[i];
    const lineNo = i + 1;
    if (COMMENT_RE.test(line)) continue;

    if (line.trim() === "") {
      flushCurrentParagraph();
      continue;
    }

    if (sectionState.current?.kind === "conclusion") {
      const reasonMatch = line.match(REASON_PREFIX_RE);
      if (reasonMatch) {
        flushCurrentParagraph();
        processReason(reasonMatch[1], lineNo, sectionState.current.ref);
        continue;
      }
    }

    const directiveMatch = line.match(DIRECTIVE_RE);
    if (directiveMatch) {
      flushCurrentParagraph();
      finalizeCurrentSection();
      const kind = directiveMatch[1].toUpperCase();
      const value = directiveMatch[2].trim();
      switch (kind) {
        case "TITLE":
          title = capText(value, MAX_TITLE, "title", lineNo, issues);
          break;
        case "INTRO":
          introRaw = value;
          introLine = lineNo;
          break;
        case "MODE": {
          const token = value.toLowerCase();
          if (token === "single" || token === "best-supported" || token === "argument-quality") {
            scoringModeRaw = token;
          } else {
            issues.push({ line: lineNo, severity: "error", message: `MODE must be "single", "best-supported", or "argument-quality" (got "${value}") — defaulted to best-supported` });
            scoringModeRaw = "best-supported";
          }
          break;
        }
        case "ARTIFACT":
          openArtifactBlock(lineNo, i);
          break;
        case "CONCLUSION":
          openConclusionBlock(lineNo, i);
          break;
        case "MAP":
          processMap(value, lineNo);
          break;
      }
      continue;
    }

    if (!sectionState.current) {
      if (UNKNOWN_DIRECTIVE_RE.test(line)) {
        issues.push({ line: lineNo, severity: "error", message: `unknown directive: "${line.trim()}"` });
      }
      continue;
    }

    if (sectionState.current.kind === "artifact") {
      if (sectionState.current.ref) {
        const b = sectionState.current.ref;
        if (b.kind === "text") b.currentParagraph.push(line.trim());
        else b.tableRows.push({ line: lineNo, text: line });
      }
    } else if (sectionState.current.kind === "conclusion") {
      if (sectionState.current.ref) sectionState.current.ref.currentParagraph.push(line.trim());
    }
  }
  flushCurrentParagraph();
  finalizeCurrentSection();

  if (title === undefined) {
    issues.push({ line: 1, severity: "warning", message: 'no TITLE given — defaulting to "Imported case"' });
    title = "Imported case";
  }

  let introHtml: string;
  if (introRaw !== undefined) {
    introHtml = capRichHtml(`<p>${escapeHtml(introRaw)}</p>`, MAX_INTRO, "intro", introLine, issues);
  } else {
    issues.push({ line: 1, severity: "warning", message: "no INTRO given — a placeholder intro was inserted (the schema requires one)" });
    introHtml = "<p>Intro to be written.</p>";
  }

  let scoringMode = scoringModeRaw;
  if (scoringMode === undefined) {
    issues.push({ line: 1, severity: "warning", message: 'no MODE given — defaulting to "best-supported"' });
    scoringMode = "best-supported";
  }

  // Floors: schema.ts requires min 2 artifacts and min 2 conclusions (spec
  // §2) — not just "at least one" (param-sandbox's floor). A doc yielding
  // fewer than that still lands a fully editable draft, flagged.
  const usedArtifactIds = new Set(artifacts.map((a) => a.id));
  if (artifacts.length < MIN_ARTIFACTS) {
    issues.push({
      line: 1,
      severity: "warning",
      message: `fewer than ${MIN_ARTIFACTS} valid artifacts were found in this document — added placeholder artifact(s) so this draft can still be edited (the schema requires at least ${MIN_ARTIFACTS})`,
    });
    while (artifacts.length < MIN_ARTIFACTS) {
      const n = artifacts.length + 1;
      const id = uniqueSlug(`Imported artifact ${n}`, usedArtifactIds, "artifact");
      usedArtifactIds.add(id);
      artifacts.push({ id, title: `Imported artifact ${n}`, kind: "text", body: "<p>Artifact text to be written.</p>" });
    }
  }

  const usedConclusionIds = new Set(conclusions.map((c) => c.id));
  if (conclusions.length < MIN_CONCLUSIONS) {
    issues.push({
      line: 1,
      severity: "warning",
      message: `fewer than ${MIN_CONCLUSIONS} valid conclusions were found in this document — added placeholder conclusion(s) so this draft can still be edited (the schema requires at least ${MIN_CONCLUSIONS})`,
    });
    while (conclusions.length < MIN_CONCLUSIONS) {
      const n = conclusions.length + 1;
      const id = uniqueSlug(`Imported conclusion ${n}`, usedConclusionIds, "conclusion");
      usedConclusionIds.add(id);
      conclusions.push({
        id,
        label: `Imported conclusion ${n}`,
        line: 1,
        expertRationale: "<p>Expert rationale to be written.</p>",
        reasons: [
          { id: "reason_1", text: "Reason to be written.", sound: true },
          { id: "reason_2", text: "Reason to be written.", sound: true },
        ],
      });
    }
  }

  // Every-conclusion floor: >=1 "supports" map entry (spec §2 — review #19).
  for (const c of conclusions) {
    const hasSupport = expertMap.some((m) => m.conclusionId === c.id && m.role === "supports");
    if (!hasSupport) {
      issues.push({
        line: 1,
        severity: "error",
        message: `conclusion "${c.label}": needs at least one supporting artifact in the expert map — a weak supporting link from "${artifacts[0].title}" was added automatically`,
      });
      expertMap.push({ artifactId: artifacts[0].id, conclusionId: c.id, role: "supports", strength: "weak" });
    }
  }

  // MODE x credit-marker matrix (spec §6 / plan, verbatim): coerce +
  // line-numbered error, NEVER skip a conclusion — skipping would orphan MAP
  // lines that name it. Runs LAST, over the fully floor-padded conclusion
  // list, so placeholders participate in the "exactly one full credit" rule
  // exactly like a doc-declared conclusion would.
  for (const c of conclusions) {
    c.credit = c.markerRaw === "best" ? "full" : c.markerRaw === "defensible" ? "partial" : "none";
  }
  if (scoringMode === "single") {
    for (const c of conclusions) {
      if (c.markerRaw === "defensible") {
        issues.push({ line: c.line, severity: "error", message: `conclusion "${c.label}": "(defensible)" is not valid under "single" mode (no partial credit) — coerced to no credit` });
        c.credit = "none";
      }
    }
  }
  if (scoringMode === "single" || scoringMode === "best-supported") {
    const bestOnes = conclusions.filter((c) => c.markerRaw === "best");
    if (bestOnes.length === 0 && conclusions.length > 0) {
      const first = conclusions[0];
      issues.push({
        line: first.line,
        severity: "error",
        message: `no conclusion is marked "(best)" under "${scoringMode}" mode, which requires exactly one full-credit conclusion — "${first.label}" (the first conclusion) was coerced to full credit`,
      });
      first.credit = "full";
    } else if (bestOnes.length > 1) {
      for (let i = 1; i < bestOnes.length; i++) {
        const c = bestOnes[i];
        issues.push({
          line: c.line,
          severity: "error",
          message: `conclusion "${c.label}": only one conclusion may be marked "(best)" under "${scoringMode}" mode — "${bestOnes[0].label}" (the first) keeps full credit, this one was demoted to no credit`,
        });
        c.credit = "none";
      }
    }
  }

  issues.sort((a, b) => a.line - b.line);

  const config = {
    title,
    intro: introHtml,
    scoringMode,
    artifacts: artifacts.map((a) => ({
      id: a.id,
      title: a.title,
      kind: a.kind,
      ...(a.sourceLine ? { sourceLine: a.sourceLine } : {}),
      ...(a.body !== undefined ? { body: a.body } : {}),
      ...(a.table ? { table: a.table } : {}),
    })),
    conclusions: conclusions.map((c) => ({
      id: c.id,
      label: c.label,
      ...(c.body ? { body: c.body } : {}),
      credit: c.credit,
      expertRationale: c.expertRationale,
      reasons: c.reasons,
    })),
    expertMap,
  };

  return { config, report: issues };
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

/** Minimal shape this serializer needs — matches schema.ts's CaseConfig
 *  structurally without importing zod, mirroring both siblings'
 *  `*ConfigLike` precedent. */
export interface CaseConfigLike {
  title: string;
  intro: string;
  scoringMode: "single" | "best-supported" | "argument-quality";
  headerColor?: string;
  artifacts: Array<{
    id: string;
    title: string;
    sourceLine?: string;
    kind: "text" | "image" | "table";
    body?: string;
    imageAssetId?: string;
    imageRole?: string;
    imageAlt?: string;
    table?: { caption?: string; headers: string[]; rows: string[][] };
  }>;
  conclusions: Array<{
    id: string;
    label: string;
    body?: string;
    credit: "full" | "partial" | "none";
    expertRationale: string;
    reasons: Array<{ id: string; text: string; sound: boolean; flawNote?: string }>;
  }>;
  expertMap: Array<{ artifactId: string; conclusionId: string; role: "supports" | "contradicts"; strength: "strong" | "weak" }>;
}

export function serializeCaseCompanionDoc(config: CaseConfigLike): string {
  const lines: string[] = [];

  // -- Documented lossiness: header comments -------------------------------
  const lossyFeatures: string[] = [];
  const imageArtifacts = config.artifacts.filter((a) => a.kind === "image");
  if (imageArtifacts.length) {
    lossyFeatures.push(`image artifact${imageArtifacts.length > 1 ? "s" : ""} (${imageArtifacts.map((a) => a.title).join(", ")}) — images are editor-only`);
  }
  if (config.headerColor) {
    lossyFeatures.push(`the header color ("${config.headerColor}") — header color is editor-only`);
  }
  const conclusionsWithBody = config.conclusions.filter((c) => c.body);
  if (conclusionsWithBody.length) {
    lossyFeatures.push(`the separate conclusion body on ${conclusionsWithBody.map((c) => c.label).join(", ")} — this format has room for expert rationale only`);
  }
  if (lossyFeatures.length) {
    lines.push(`# Note: this config uses features this text format cannot represent, so they are left out below: ${lossyFeatures.join("; ")}. Edit those in the app instead.`);
  }

  const riskyTitles = [...config.artifacts.map((a) => a.title), ...config.conclusions.map((c) => c.label)].filter((t) => RISKY_LABEL_RE.test(t));
  if (riskyTitles.length) {
    lines.push(
      `# Warning: these titles contain characters this format's grammar treats specially ("(", "->", " supports ", or " contradicts "), and may not re-import correctly if edited by hand: ${riskyTitles.map((t) => `"${t}"`).join(", ")}.`,
    );
  }
  if (lossyFeatures.length || riskyTitles.length) lines.push("");

  // -- Top matter -----------------------------------------------------------
  lines.push(`TITLE: ${config.title}`);
  {
    const paragraphs = bodyToParagraphs(config.intro);
    const introText = paragraphs.filter(Boolean).join(" ");
    lines.push(`INTRO: ${unescapeHtml(introText)}`);
  }
  lines.push(`MODE: ${config.scoringMode}`);
  lines.push("");

  // -- Artifacts --------------------------------------------------------
  for (const a of config.artifacts) {
    if (a.kind === "image") continue; // dropped — see the module doc comment
    lines.push(`ARTIFACT: ${a.title} (${a.kind})`);
    if (a.sourceLine) lines.push(`Source: ${a.sourceLine}`);
    if (a.kind === "table" && a.table?.caption) lines.push(`Caption: ${a.table.caption}`);
    if (a.kind === "text") {
      const paragraphs = bodyToParagraphs(a.body);
      if (paragraphs.length === 0) {
        lines.push("");
      } else {
        for (const p of paragraphs) {
          lines.push(p);
          lines.push("");
        }
      }
    } else if (a.kind === "table" && a.table) {
      lines.push(a.table.headers.join(" | "));
      for (const row of a.table.rows) lines.push(row.join(" | "));
      lines.push("");
    }
  }

  // -- Conclusions --------------------------------------------------------
  for (const c of config.conclusions) {
    const marker = c.credit === "full" ? "best" : c.credit === "partial" ? "defensible" : "unsupported";
    lines.push(`CONCLUSION: ${c.label} (${marker})`);
    const rationaleParagraphs = bodyToParagraphs(c.expertRationale);
    lines.push(`Rationale: ${rationaleParagraphs[0] ?? ""}`);
    for (const p of rationaleParagraphs.slice(1)) {
      lines.push("");
      lines.push(p);
    }
    lines.push("");
    for (const r of c.reasons) {
      const markerText = r.sound ? "SOUND" : `FLAWED: ${r.flawNote ?? ""}`;
      lines.push(`- ${r.text} (${markerText})`);
    }
    lines.push("");
  }

  // -- Expert map --------------------------------------------------------
  const artifactTitleById = new Map(config.artifacts.map((a) => [a.id, a.title]));
  const conclusionLabelById = new Map(config.conclusions.map((c) => [c.id, c.label]));
  for (const m of config.expertMap) {
    const artifactTitle = artifactTitleById.get(m.artifactId) ?? m.artifactId;
    const conclusionLabel = conclusionLabelById.get(m.conclusionId) ?? m.conclusionId;
    lines.push(`MAP: ${artifactTitle} ${m.role} ${conclusionLabel} (${m.strength})`);
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "\n");
}
