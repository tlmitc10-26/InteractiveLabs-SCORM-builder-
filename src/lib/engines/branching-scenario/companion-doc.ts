/**
 * LIGHT module (same discipline as runtime-config.ts): zero heavy deps (no
 * zod, no schema.ts, no sanitize-html). Parses/serializes the plain-text
 * "companion doc" format designers and faculty write branching scenarios in
 * (see docs/superpowers/specs/2026-08-27-companion-doc-import-design.md §2
 * for the format, and docs/superpowers/plans/2026-08-27-companion-doc-
 * import.md Task 1 for the grammar contract this file implements).
 *
 * `parseCompanionDoc` never throws: it always returns a best-effort `config`
 * (an `unknown` structurally shaped like `BranchingConfigLike` below) plus a
 * complete, line-numbered `report`. Nothing is silently dropped or defaulted
 * without a report entry — the report IS the contract. The returned config
 * is expected to flow through `validateBranchingConfig` (schema.ts) exactly
 * like any hand-authored draft; this module adds no new trust.
 *
 * `serializeCompanionDoc` is the reverse: it renders an existing
 * `BranchingConfigLike` back into companion-doc text, well enough that
 * `parseCompanionDoc(serializeCompanionDoc(config))` round-trips (tested
 * against the jury and blank starters). Two known, intentional forms of
 * lossiness in that round trip:
 *   - ids are NOT preserved (destinations are compared by title, not id,
 *     since the format names things by title — this is a title-based
 *     format, not an id-based one).
 *   - rich-text markup beyond bare paragraphs is flattened to plain text
 *     (INTRO/body/feedback are all single/plain lines or blank-line-
 *     separated paragraphs in this format; any other markup a hand-authored
 *     config might carry — e.g. bold/lists/links — is stripped on the way
 *     out). A choice LABEL containing literal "(" or "->" is a sharper edge:
 *     the serializer emits it verbatim (this is a title-based, not an
 *     escaped, format), and such a label would fail to re-parse as the same
 *     label/destination split it started as. That degrades to a visible
 *     import-report error on the next import, which is the intended
 *     fail-visible contract here, not silent corruption — labels are
 *     sanitized plain text already, so this can only happen if an author
 *     literally types "(" or "->" into a choice label.
 *   - The same edge applies to a SCENE/ENDING TITLE that literally starts
 *     with "Scene:" or "Ending:" (e.g. a scene titled `Scene: Setup`):
 *     `DEST_PREFIX_RE` strips what looks like an explicit-namespace prefix
 *     off any destination text, including the round-tripped destination
 *     text the serializer writes for choices pointing at such a title. A
 *     title beginning that way therefore degrades on re-parse to a
 *     fail-visible "no scene/ending named …" unresolved-destination error
 *     (routed to the placeholder ending) rather than silently resolving
 *     wrong — a named limitation, not corruption.
 */

import { uniqueSlug } from "@/lib/engines/slugify";
import type { BranchingConfigLike, Comparator } from "./runtime-config";

export interface ImportIssue {
  line: number;
  severity: "error" | "warning";
  message: string;
}

// ---------------------------------------------------------------------------
// Grammar
// ---------------------------------------------------------------------------

const COMMENT_RE = /^\s*#/;
// The leading `\s*` here also silently absorbs a leading UTF-8 BOM
// (U+FEFF is part of ECMAScript's `\s` character class), so a doc saved by
// an editor that stamps a BOM on the very first line still matches its
// first TITLE/etc. directive on line 1. This is load-bearing, not
// incidental — do not "simplify" this regex in a way that drops it.
const DIRECTIVE_RE = /^\s*(TITLE|ROLE|INTRO|FEEDBACK|START|TRACK|SCENE|ENDING)\s*:\s*(.*)$/i;
const UNKNOWN_DIRECTIVE_RE = /^\s*[A-Z][A-Z ]{2,20}:\s/i;
const CHOICE_RE = /^\s*[-*]\s+(.*)$/;
const TRACK_RE = /^(.*?)\s*\(\s*(-?\d+)\s+to\s+(-?\d+)\s*,\s*start(?:\s+at)?\s+(-?\d+)\s*(?:,\s*(visible))?\s*\)$/i;
const CHOICE_WITH_META_RE = /^(.*?)\s*\(([^()]*)\)\s*(->|→|–>|—>|=>)\s*(.+)$/;
const CHOICE_NO_META_RE = /^(.*?)\s*(->|→|–>|—>|=>)\s*(.+)$/;
const DEST_PREFIX_RE = /^(SCENE|ENDING)\s*:\s*(.*)$/i;
const FEEDBACK_CONTINUE_RE = /^\s+feedback\s*:\s*(.*)$/i;
const FEEDBACK_LINE_RE = /^\s+\S/;
const EFFECT_RE = /^(.+?)\s*([+-]\d+)$/;
const CONDITION_RE = /^only\s+if\s+(.+?)\s+is\s+(?:(at\s+least|at\s+most)\s+(-?\d+)|between\s+(-?\d+)\s+and\s+(-?\d+))$/i;

const GOOD_ARROWS = new Set(["->", "→"]);
const QUALITY_MAP: Record<string, "best" | "acceptable" | "poor"> = {
  BEST: "best",
  ACCEPTABLE: "acceptable",
  OK: "acceptable",
  POOR: "poor",
};

const MAX_SCENES = 40;
const MAX_CHOICES_PER_SCENE = 6;
const MAX_TRACKS = 8;
const MAX_ENDINGS = 8;

const PLACEHOLDER_ENDING_ID = "unresolved_destination";
const PLACEHOLDER_ENDING_TITLE = "Unresolved destination";
const PLACEHOLDER_ENDING_BODY =
  "<p>This choice pointed at a scene or ending name that could not be found in the document. Fix the destination name above and re-import, or edit this ending directly.</p>";

function normalize(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"');
}

/** Escapes the three characters that matter for safe `innerHTML` placement
 *  inside a `<p>...</p>` wrapper. Applied to INTRO before it's ever placed
 *  in the returned config (opus review, item 6 — mirrors the identical fix
 *  in param-sandbox/companion-doc.ts): the parser's returned config is
 *  `unknown`, un-validated, and the editor's live preview
 *  (toBranchingRuntimeConfig) renders it via innerHTML *before* the next
 *  debounced save routes it through schema.ts's sanitizeRichText — so an
 *  INTRO containing raw `<img onerror=...>` would otherwise execute in
 *  that preview window. `&` must be escaped first so the entities this
 *  function itself writes don't get double-escaped. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Reverses `escapeHtml` for the serializer's INTRO line — see
 *  param-sandbox/companion-doc.ts's `unescapeHtml` doc comment (identical
 *  rationale and ordering constraint) for why `&` must decode last. */
function unescapeHtml(s: string): string {
  return s.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
}

// ---------------------------------------------------------------------------
// Internal working types (superset of the eventual BranchingConfigLike
// pieces, plus bookkeeping the two-pass algorithm needs)
// ---------------------------------------------------------------------------

type Effect = { variableId: string; delta: number };
type ShowIf = { variableId: string; comparator: Comparator; value?: number; min?: number; max?: number };
type WorkingChoice = { id: string; label: string; quality: "best" | "acceptable" | "poor"; effects: Effect[]; feedback?: string; goTo: string; showIf?: ShowIf };
type WorkingScene = { id: string; title?: string; choices: WorkingChoice[]; paragraphs: string[] };
type WorkingEnding = { id: string; title: string; paragraphs: string[] };
type WorkingTrack = { id: string; label: string; min: number; max: number; initial: number; visible: boolean };

type TitleEntry = { id: string; title: string; line: number };

/** Pass 1: collect SCENE/ENDING titles (and assign their final ids up
 *  front) so destinations can resolve forward references, and so pass 2 can
 *  build the exact same ids without a second slugify pass. Also detects
 *  duplicate titles (case-insensitive, since resolution is
 *  case-insensitive) as errors — the FIRST occurrence of a duplicate title
 *  wins for resolution purposes; every occurrence still gets its own
 *  (uniquified) scene/ending object in pass 2 so the draft stays fully
 *  editable. */
function collectTitles(lines: string[], issues: ImportIssue[]): { scenes: TitleEntry[]; endings: TitleEntry[] } {
  const scenes: TitleEntry[] = [];
  const endings: TitleEntry[] = [];
  const sceneIds = new Set<string>();
  const endingIds = new Set<string>();
  const seenSceneTitles = new Map<string, number>(); // lowercased -> line of first occurrence
  const seenEndingTitles = new Map<string, number>();

  lines.forEach((line, i) => {
    if (COMMENT_RE.test(line)) return;
    const m = line.match(DIRECTIVE_RE);
    if (!m) return;
    const kind = m[1].toUpperCase();
    const title = m[2].trim();
    const lineNo = i + 1;
    if (kind === "SCENE") {
      const key = title.toLowerCase();
      if (seenSceneTitles.has(key)) {
        issues.push({ line: lineNo, severity: "error", message: `duplicate scene title "${title}" — destinations resolve by name, so this scene is unreachable by name (still imported)` });
      } else {
        seenSceneTitles.set(key, lineNo);
      }
      const id = uniqueSlug(title, sceneIds, "scene");
      sceneIds.add(id);
      scenes.push({ id, title, line: lineNo });
    } else if (kind === "ENDING") {
      const key = title.toLowerCase();
      if (seenEndingTitles.has(key)) {
        issues.push({ line: lineNo, severity: "error", message: `duplicate ending title "${title}" — destinations resolve by name, so this ending is unreachable by name (still imported)` });
      } else {
        seenEndingTitles.set(key, lineNo);
      }
      const id = uniqueSlug(title, endingIds, "ending");
      endingIds.add(id);
      endings.push({ id, title, line: lineNo });
    }
  });

  return { scenes, endings };
}

export function parseCompanionDoc(text: string): { config: unknown; report: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const lines = normalize(text).split("\n");

  const { scenes: sceneTitleList, endings: endingTitleList } = collectTitles(lines, issues);

  // Resolution maps: lowercased title -> FIRST-seen entry (see collectTitles).
  const sceneByTitle = new Map<string, TitleEntry>();
  for (const s of sceneTitleList) if (!sceneByTitle.has(s.title.toLowerCase())) sceneByTitle.set(s.title.toLowerCase(), s);
  const endingByTitle = new Map<string, TitleEntry>();
  for (const e of endingTitleList) if (!endingByTitle.has(e.title.toLowerCase())) endingByTitle.set(e.title.toLowerCase(), e);

  let title: string | undefined;
  let role: string | undefined;
  let intro: string | undefined;
  let feedbackMode: "immediate" | "debrief" = "debrief";
  let startSceneName: string | undefined;
  let startSceneLine = 0;

  const tracks: WorkingTrack[] = [];
  const variableIds = new Set<string>();
  const scenes: WorkingScene[] = [];
  const endings: WorkingEnding[] = [];

  let sceneTitleIndex = 0; // pointer into sceneTitleList, advances on each SCENE: line seen
  let endingTitleIndex = 0;

  type Section = { kind: "scene"; ref: WorkingScene } | { kind: "ending"; ref: WorkingEnding } | null;
  let currentSection: Section = null;
  let currentParagraph: string[] = [];
  // Wrapped in an object (rather than a bare `let`) because TypeScript's
  // control-flow narrowing does not widen a closure-captured `let` back to
  // its declared union type across a loop back-edge when the only
  // non-null assignment happens inside a nested function (processChoice,
  // below) — it narrows `lastChoice` to `never` at the top of later
  // iterations. Property access on an object isn't narrowed that
  // aggressively, so this sidesteps the issue. (Verified against a minimal
  // repro before choosing this over an `as` cast.)
  const choiceState: { lastChoice: WorkingChoice | null } = { lastChoice: null };
  let placeholderEndingId: string | null = null;

  function flushParagraph(): void {
    if (currentParagraph.length && currentSection) {
      currentSection.ref.paragraphs.push(currentParagraph.join(" "));
    }
    currentParagraph = [];
  }

  function ensurePlaceholderEnding(): string {
    if (!placeholderEndingId) {
      placeholderEndingId = PLACEHOLDER_ENDING_ID;
      endings.push({ id: placeholderEndingId, title: PLACEHOLDER_ENDING_TITLE, paragraphs: [PLACEHOLDER_ENDING_BODY.replace(/^<p>|<\/p>$/g, "")] });
    }
    return `ending:${placeholderEndingId}`;
  }

  function resolveTrack(label: string): WorkingTrack | undefined {
    const key = label.trim().toLowerCase();
    return tracks.find((t) => t.label.toLowerCase() === key);
  }

  function resolveDestination(rawDest: string, lineNo: number): string {
    const trimmed = rawDest.trim();
    const prefixMatch = trimmed.match(DEST_PREFIX_RE);
    if (prefixMatch) {
      const namespace = prefixMatch[1].toUpperCase();
      const name = prefixMatch[2].trim();
      const key = name.toLowerCase();
      if (namespace === "SCENE") {
        const hit = sceneByTitle.get(key);
        if (hit) return `scene:${hit.id}`;
        issues.push({ line: lineNo, severity: "error", message: `no scene named "${name}"` });
        return ensurePlaceholderEnding();
      }
      const hit = endingByTitle.get(key);
      if (hit) return `ending:${hit.id}`;
      issues.push({ line: lineNo, severity: "error", message: `no ending named "${name}"` });
      return ensurePlaceholderEnding();
    }
    const key = trimmed.toLowerCase();
    const sceneHit = sceneByTitle.get(key);
    const endingHit = endingByTitle.get(key);
    if (sceneHit && endingHit) {
      issues.push({ line: lineNo, severity: "error", message: `"${trimmed}" exists as both a scene and an ending — resolved to the scene` });
      return `scene:${sceneHit.id}`;
    }
    if (sceneHit) return `scene:${sceneHit.id}`;
    if (endingHit) return `ending:${endingHit.id}`;
    issues.push({ line: lineNo, severity: "error", message: `no scene or ending named "${trimmed}"` });
    return ensurePlaceholderEnding();
  }

  function processChoice(raw: string, lineNo: number, scene: WorkingScene): void {
    if (scene.choices.length >= MAX_CHOICES_PER_SCENE) {
      issues.push({ line: lineNo, severity: "error", message: `too many choices in this scene (max ${MAX_CHOICES_PER_SCENE}) — this choice was skipped` });
      return;
    }

    let label: string;
    let metaStr: string | null = null;
    let arrow: string | null = null;
    let destRaw: string | null = null;

    const withMeta = raw.match(CHOICE_WITH_META_RE);
    if (withMeta) {
      label = withMeta[1].trim();
      metaStr = withMeta[2];
      arrow = withMeta[3];
      destRaw = withMeta[4];
    } else {
      const noMeta = raw.match(CHOICE_NO_META_RE);
      if (noMeta) {
        label = noMeta[1].trim();
        arrow = noMeta[2];
        destRaw = noMeta[3];
        issues.push({ line: lineNo, severity: "error", message: "choice is missing (QUALITY) — imported as OK" });
      } else {
        label = raw.trim();
        issues.push({ line: lineNo, severity: "error", message: 'choice is missing "-> destination"' });
      }
    }

    let quality: "best" | "acceptable" | "poor" = "acceptable";
    const effects: Effect[] = [];
    let showIf: ShowIf | undefined;

    if (metaStr !== null) {
      const tokens = metaStr
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      if (tokens.length === 0) {
        issues.push({ line: lineNo, severity: "error", message: "choice is missing a quality (BEST/ACCEPTABLE/OK/POOR) — imported as OK" });
      } else {
        const qKey = tokens[0].toUpperCase();
        const mapped = QUALITY_MAP[qKey];
        if (mapped) {
          quality = mapped;
        } else {
          issues.push({ line: lineNo, severity: "error", message: `unknown quality "${tokens[0]}" (expected BEST/ACCEPTABLE/OK/POOR) — imported as OK` });
        }
        for (let i = 1; i < tokens.length; i++) {
          const tok = tokens[i];
          const condMatch = tok.match(CONDITION_RE);
          if (condMatch) {
            const varLabel = condMatch[1].trim();
            const track = resolveTrack(varLabel);
            if (!track) {
              issues.push({ line: lineNo, severity: "error", message: `unknown track "${varLabel}" in condition` });
              continue;
            }
            if (condMatch[2]) {
              const comparator: Comparator = /least/i.test(condMatch[2]) ? "gte" : "lte";
              showIf = { variableId: track.id, comparator, value: parseInt(condMatch[3], 10) };
            } else {
              showIf = { variableId: track.id, comparator: "between", min: parseInt(condMatch[4], 10), max: parseInt(condMatch[5], 10) };
            }
            continue;
          }
          const effMatch = tok.match(EFFECT_RE);
          if (effMatch) {
            const varLabel = effMatch[1].trim();
            const track = resolveTrack(varLabel);
            if (!track) {
              issues.push({ line: lineNo, severity: "error", message: `unknown track "${varLabel}" in effect` });
              continue;
            }
            effects.push({ variableId: track.id, delta: parseInt(effMatch[2], 10) });
            continue;
          }
          issues.push({ line: lineNo, severity: "error", message: `unrecognized choice detail "${tok}"` });
        }
      }
    }

    if (arrow && !GOOD_ARROWS.has(arrow)) {
      issues.push({ line: lineNo, severity: "warning", message: `use "->" instead of "${arrow}"` });
    }

    const goTo = destRaw === null ? ensurePlaceholderEnding() : resolveDestination(destRaw, lineNo);

    const choiceId = uniqueSlug(label || "choice", new Set(scene.choices.map((c) => c.id)), "choice");
    const choice: WorkingChoice = { id: choiceId, label: label || "Untitled choice", quality, effects, goTo };
    if (showIf) choice.showIf = showIf;
    scene.choices.push(choice);
    choiceState.lastChoice = choice;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    if (COMMENT_RE.test(line)) continue;

    if (line.trim() === "") {
      flushParagraph();
      continue;
    }

    // Feedback continuation (checked before the generic directive regex,
    // since an indented "Feedback:" line would otherwise also match the
    // FEEDBACK top-level directive alternative).
    if (FEEDBACK_LINE_RE.test(line)) {
      const fbMatch = line.match(FEEDBACK_CONTINUE_RE);
      if (fbMatch) {
        if (choiceState.lastChoice) {
          choiceState.lastChoice.feedback = fbMatch[1].trim();
        } else {
          issues.push({ line: lineNo, severity: "error", message: "Feedback: has no preceding choice" });
        }
        continue;
      }
      if (choiceState.lastChoice?.feedback !== undefined) {
        choiceState.lastChoice.feedback = `${choiceState.lastChoice.feedback} ${line.trim()}`;
        continue;
      }
    }

    const directiveMatch = line.match(DIRECTIVE_RE);
    if (directiveMatch) {
      const kind = directiveMatch[1].toUpperCase();
      const value = directiveMatch[2].trim();
      switch (kind) {
        case "TITLE":
          title = value;
          break;
        case "ROLE":
          role = value;
          break;
        case "INTRO":
          intro = value;
          break;
        case "FEEDBACK": {
          const v = value.toLowerCase();
          if (v === "immediate" || v === "debrief") {
            feedbackMode = v;
          } else {
            issues.push({ line: lineNo, severity: "error", message: `FEEDBACK must be "immediate" or "debrief" (got "${value}")` });
          }
          break;
        }
        case "START":
          startSceneName = value;
          startSceneLine = lineNo;
          break;
        case "TRACK": {
          const m = value.match(TRACK_RE);
          if (!m) {
            issues.push({ line: lineNo, severity: "error", message: 'TRACK line must look like "<Name> (<min> to <max>, start at <initial>[, visible])"' });
            break;
          }
          const label = m[1].trim();
          // Mirrors the duplicate-scene/ending-title rule: tracks are
          // targeted by name (effects/conditions resolve via resolveTrack's
          // case-insensitive label lookup, which binds to the FIRST match),
          // so a second track with the same name would be silently
          // unreachable by name. Flag it and skip it outright rather than
          // emit an unreachable "trust_2" the draft can never target.
          if (tracks.some((t) => t.label.toLowerCase() === label.toLowerCase())) {
            issues.push({ line: lineNo, severity: "error", message: `duplicate track name "${label}" — tracks are targeted by name` });
            break;
          }
          if (tracks.length >= MAX_TRACKS) {
            issues.push({ line: lineNo, severity: "error", message: `too many tracks (max ${MAX_TRACKS}) — this track was skipped` });
            break;
          }
          const id = uniqueSlug(label, variableIds, "track");
          variableIds.add(id);
          tracks.push({ id, label, min: parseInt(m[2], 10), max: parseInt(m[3], 10), initial: parseInt(m[4], 10), visible: !!m[5] });
          break;
        }
        case "SCENE": {
          flushParagraph();
          const entry = sceneTitleList[sceneTitleIndex++];
          if (scenes.length >= MAX_SCENES) {
            issues.push({ line: lineNo, severity: "error", message: `too many scenes (max ${MAX_SCENES}) — this scene was skipped` });
            currentSection = null;
          } else {
            const scene: WorkingScene = { id: entry.id, title: entry.title || undefined, choices: [], paragraphs: [] };
            scenes.push(scene);
            currentSection = { kind: "scene", ref: scene };
          }
          choiceState.lastChoice = null;
          break;
        }
        case "ENDING": {
          flushParagraph();
          const entry = endingTitleList[endingTitleIndex++];
          if (endings.length >= MAX_ENDINGS) {
            issues.push({ line: lineNo, severity: "error", message: `too many endings (max ${MAX_ENDINGS}) — this ending was skipped` });
            currentSection = null;
          } else {
            const ending: WorkingEnding = { id: entry.id, title: entry.title, paragraphs: [] };
            endings.push(ending);
            currentSection = { kind: "ending", ref: ending };
          }
          choiceState.lastChoice = null;
          break;
        }
      }
      continue;
    }

    if (UNKNOWN_DIRECTIVE_RE.test(line)) {
      issues.push({ line: lineNo, severity: "error", message: `unknown directive: "${line.trim()}"` });
      continue;
    }

    const choiceMatch = line.match(CHOICE_RE);
    if (choiceMatch) {
      if (!currentSection || currentSection.kind !== "scene") {
        issues.push({ line: lineNo, severity: "error", message: "choices belong under a SCENE" });
        continue;
      }
      processChoice(choiceMatch[1], lineNo, currentSection.ref);
      continue;
    }

    if (currentSection) {
      currentParagraph.push(line.trim());
    }
  }
  flushParagraph();

  if (title === undefined) {
    issues.push({ line: 1, severity: "warning", message: 'no TITLE given — defaulting to "Imported scenario"' });
    title = "Imported scenario";
  }

  let startSceneId = scenes[0]?.id ?? "";
  if (startSceneName !== undefined) {
    const hit = sceneByTitle.get(startSceneName.trim().toLowerCase());
    if (hit && scenes.some((s) => s.id === hit.id)) {
      startSceneId = hit.id;
    } else {
      issues.push({ line: startSceneLine, severity: "error", message: `no scene named "${startSceneName}" for START — defaulting to the first scene` });
    }
  }

  issues.sort((a, b) => a.line - b.line);

  const toBody = (paragraphs: string[]): string => paragraphs.map((p) => `<p>${p}</p>`).join("");

  const config: BranchingConfigLike = {
    title,
    ...(role ? { role } : {}),
    ...(intro ? { intro: `<p>${escapeHtml(intro)}</p>` } : {}),
    variables: tracks.map((t) => ({ id: t.id, label: t.label, initial: t.initial, min: t.min, max: t.max, visible: t.visible })),
    scenes: scenes.map((s) => ({
      id: s.id,
      ...(s.title ? { title: s.title } : {}),
      body: toBody(s.paragraphs),
      choices: s.choices.map((c) => ({
        id: c.id,
        label: c.label,
        quality: c.quality,
        effects: c.effects,
        ...(c.feedback !== undefined ? { feedback: c.feedback } : {}),
        goTo: c.goTo,
        ...(c.showIf ? { showIf: c.showIf } : {}),
      })),
    })),
    startSceneId,
    endings: endings.map((e) => ({ id: e.id, title: e.title, body: toBody(e.paragraphs) })),
    feedbackMode,
    showPathInDebrief: true,
  };

  return { config, report: issues };
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

function stripTags(html: string | undefined): string {
  return (html ?? "").replace(/<[^>]+>/g, "").trim();
}

/** Reconstructs blank-line-separated paragraphs from a body string built as
 *  concatenated `<p>...</p>` blocks (see `toBody` in the parser above). Any
 *  markup beyond bare `<p>` wrapping is flattened to plain text (see the
 *  module doc comment on lossiness). */
function bodyToParagraphs(html: string): string[] {
  const matches = [...html.matchAll(/<p>([\s\S]*?)<\/p>/gi)];
  if (matches.length === 0) {
    const plain = stripTags(html);
    return plain ? [plain] : [];
  }
  return matches.map((m) => stripTags(m[1]));
}

export function serializeCompanionDoc(config: BranchingConfigLike): string {
  const lines: string[] = [];
  lines.push(`TITLE: ${config.title}`);
  if (config.role) lines.push(`ROLE: ${config.role}`);
  // unescapeHtml (opus review, item 6): the parser now HTML-escapes INTRO
  // before storing it, so a config whose intro came from this module's own
  // parser (or from schema.ts's sanitizeRichText, which also escapes)
  // round-trips back out as plain text instead of literal "&amp;" (which
  // re-import would otherwise escape AGAIN into "&amp;amp;").
  if (config.intro) lines.push(`INTRO: ${unescapeHtml(stripTags(config.intro))}`);
  for (const v of config.variables) {
    const visible = v.visible ? ", visible" : "";
    lines.push(`TRACK: ${v.label} (${v.min} to ${v.max}, start at ${v.initial}${visible})`);
  }
  lines.push(`FEEDBACK: ${config.feedbackMode}`);

  const firstScene = config.scenes[0];
  const startScene = config.scenes.find((s) => s.id === config.startSceneId);
  if (startScene && firstScene && startScene.id !== firstScene.id) {
    lines.push(`START: ${startScene.title ?? startScene.id}`);
  }
  lines.push("");

  const sceneTitleOf = (id: string, index: number): string => config.scenes[index]?.title ?? `Part ${index + 1}`;
  const titleForGoTo = new Map<string, string>();
  config.scenes.forEach((s, i) => titleForGoTo.set(`scene:${s.id}`, sceneTitleOf(s.id, i)));
  config.endings.forEach((e) => titleForGoTo.set(`ending:${e.id}`, e.title));
  const variableById = new Map(config.variables.map((v) => [v.id, v]));

  config.scenes.forEach((scene, i) => {
    lines.push(`SCENE: ${sceneTitleOf(scene.id, i)}`);
    for (const p of bodyToParagraphs(scene.body)) {
      lines.push(p);
      lines.push("");
    }
    if (bodyToParagraphs(scene.body).length === 0) lines.push("");
    for (const choice of scene.choices) {
      const qualityWord = choice.quality === "best" ? "BEST" : choice.quality === "poor" ? "POOR" : "ACCEPTABLE";
      const metaParts = [qualityWord];
      for (const ef of choice.effects) {
        const label = variableById.get(ef.variableId)?.label ?? ef.variableId;
        const sign = ef.delta >= 0 ? "+" : "";
        metaParts.push(`${label} ${sign}${ef.delta}`);
      }
      if (choice.showIf) {
        const label = variableById.get(choice.showIf.variableId)?.label ?? choice.showIf.variableId;
        if (choice.showIf.comparator === "gte") metaParts.push(`only if ${label} is at least ${choice.showIf.value}`);
        else if (choice.showIf.comparator === "lte") metaParts.push(`only if ${label} is at most ${choice.showIf.value}`);
        else metaParts.push(`only if ${label} is between ${choice.showIf.min} and ${choice.showIf.max}`);
      }
      const destTitle = titleForGoTo.get(choice.goTo) ?? choice.goTo;
      // NOTE: labels are emitted verbatim (title-based format, not escaped) —
      // see the module doc comment on why a label containing literal "(" or
      // "->" is a documented, fail-visible-on-reimport edge case, not
      // silent corruption.
      lines.push(`- ${choice.label} (${metaParts.join(", ")}) -> ${destTitle}`);
      if (choice.feedback) lines.push(`  Feedback: ${stripTags(choice.feedback)}`);
    }
    lines.push("");
  });

  config.endings.forEach((ending) => {
    lines.push(`ENDING: ${ending.title}`);
    const paragraphs = bodyToParagraphs(ending.body);
    if (paragraphs.length === 0) {
      lines.push("");
    } else {
      for (const p of paragraphs) {
        lines.push(p);
        lines.push("");
      }
    }
  });

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "\n");
}
