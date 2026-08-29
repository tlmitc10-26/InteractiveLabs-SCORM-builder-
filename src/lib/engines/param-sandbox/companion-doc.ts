/**
 * LIGHT module (same discipline as branching-scenario/companion-doc.ts and
 * runtime-config.ts): zero heavy deps (no zod, no schema.ts, no
 * sanitize-html). Parses/serializes the plain-text "companion doc" format
 * designers and faculty write parameter-sandbox interactives in (see
 * docs/superpowers/specs/2026-08-28-exemplar-library-design.md §5 for the
 * grammar, and docs/superpowers/plans/2026-08-28-exemplar-library.md Task 1
 * for the contract this file implements). This is the deterministic twin of
 * ../branching-scenario/companion-doc.ts: same doctrine (line-based,
 * names-not-ids, never-throws, `{ config, report }`), different grammar
 * (flat top-matter directives — TITLE/INTRO/INPUT/OUTPUT/CHART/CHALLENGE —
 * rather than scenes/endings/choices).
 *
 * `parseSandboxCompanionDoc` never throws: it always returns a best-effort
 * `config` (an `unknown` structurally shaped like `SandboxConfig`, minus the
 * fields the schema itself defaults — see below) plus a complete,
 * line-numbered `report`. The returned config is expected to flow through
 * `validateSandboxConfig` (schema.ts) exactly like any hand-authored draft;
 * this module adds no new trust.
 *
 * `serializeSandboxCompanionDoc` is the reverse. Known, intentional
 * lossiness in the round trip (documented here, and echoed as a `#` header
 * comment in the emitted text whenever the config actually uses one of
 * these):
 *   - ids are NOT preserved (this is a label/title-based format, like the
 *     branching one) — comparisons across a round trip must go by label.
 *   - `placement`/`layout` are editor-side spatial concerns; a "below" or
 *     "stage" placement is dropped (inputs/outputs always import to the
 *     default "panel" placement), and a non-"side" layout is dropped.
 *   - the `visual` scene (background image, overlays) has no text
 *     representation at all and is dropped entirely.
 *   - `toggle` inputs are editor-only: the format has no grammar for them,
 *     so a `toggle` input is omitted from serializer output (and rejected,
 *     line-numbered, on import).
 *   - a label containing literal "(", "=", "->", or the token " vs " parses
 *     wrong by design (this is a title-based, not an escaped, format): the
 *     serializer emits it verbatim and flags it in a header comment; such a
 *     label degrades to a visible, fail-visible import-report error/
 *     misresolution on the next import rather than silent corruption.
 */

import type { ImportIssue } from "@/lib/engines/branching-scenario/companion-doc";
import { uniqueSlug } from "@/lib/engines/slugify";
import { parseFormula } from "@/lib/formula/parser";
import { collectIdentifiers } from "@/lib/formula/evaluate";

export type { ImportIssue };

// ---------------------------------------------------------------------------
// Grammar
// ---------------------------------------------------------------------------

const COMMENT_RE = /^\s*#/;
// The leading `\s*` here also silently absorbs a leading UTF-8 BOM (U+FEFF
// is part of ECMAScript's `\s` character class), so a doc saved by an
// editor that stamps a BOM on the very first line still matches its first
// TITLE/etc. directive on line 1. Copied verbatim from the branching
// parser's load-bearing comment — do not "simplify" this regex in a way
// that drops it.
const DIRECTIVE_RE = /^\s*(TITLE|INTRO|INPUT|OUTPUT|CHART|CHALLENGE)\s*:\s*(.*)$/i;
const UNKNOWN_DIRECTIVE_RE = /^\s*[A-Z][A-Z ]{2,20}:\s/i;

const NUMERIC_RE = /-?\d+(?:\.\d+)?/;
const RANGE_RE = new RegExp(`^(${NUMERIC_RE.source})\\s+to\\s+(${NUMERIC_RE.source})$`, "i");
const STEP_RE = new RegExp(`^step\\s+(${NUMERIC_RE.source})$`, "i");
const START_RE = new RegExp(`^start\\s+(${NUMERIC_RE.source})$`, "i");
const OPTION_RE = new RegExp(`^(.*?)\\s*=\\s*(${NUMERIC_RE.source})(\\*)?$`);
const DECIMALS_RE = /^(\d+)\s+decimals$/i;

// Content group excludes parens (like OUTPUT_LINE_RE) so a LABEL that
// itself contains a literal "(" — e.g. "Weight (gravity)" — forces the
// non-greedy label group to backtrack past its own paren and match the
// real (outermost/last) metadata parens instead of truncating there. Input
// metadata never legitimately contains a paren itself (units/range/step/
// select-option text never does), so this restriction costs nothing for
// well-formed input lines.
const INPUT_LINE_RE = /^(.*?)\s*\(([^()]*)\)\s*$/;
const OUTPUT_LINE_RE = /^(.*?)\s*\(([^()]*)\)\s*=\s*(.+)$/;
const CHART_TRAILING_PAREN_RE = /^(.*?)\s*\(([^()]*)\)\s*$/;
const CHART_VS_RE = /^(.*?)\s+vs\s+(.*)$/i;
const CHART_SAMPLES_RE = new RegExp(`^(\\d+)\\s+samples(?:\\s*,\\s*titled\\s+(.+))?$`, "i");
const DEFAULT_SAMPLES = 40;

const ARROW_RE = /^(.*?)\s*(->|→|–>|—>|=>)\s*(.+)$/;
const GOOD_ARROWS = new Set(["->", "→"]);
const CHALLENGE_CONDITION_RE = new RegExp(
  `^(.*?)\\s+(at\\s+least|at\\s+most|between)\\s+(${NUMERIC_RE.source})(?:\\s+and\\s+(${NUMERIC_RE.source}))?\\s*$`,
  "i",
);
const STRAY_COMPARATOR_RE = /[<>]/;

const RESERVED_CONSTANTS = new Set(["pi", "e"]);
// Extended (opus review, item 7) beyond the original "(", "=", "->", " vs "
// set to also catch: "$" and arithmetic-operator characters (a label like
// "A+B" or "Break-even" reads as an expression fragment once substituted
// into a formula), and a label with a leading/trailing non-word character
// (the \b-anchored substitution in substituteLabelsToIds/idsToLabelsInFormula
// can't even establish a word boundary at that edge).
const RISKY_LABEL_RE = /[(=$+\-*/^,]|->| vs |^[^\w]|[^\w]$/;

const MAX_INPUTS = 20;
const MAX_OUTPUTS = 20;
const MAX_CHARTS = 6;
const MAX_CHALLENGES = 12;
// Mirror schema.ts's own caps (units: plain(20), decimals: 0-8,
// options: max 20) so a violation is caught here, line-numbered and
// salvaged where possible, rather than surfacing only as an opaque
// schema-validation failure with no line number at all (opus review, item 5).
const MAX_UNITS_LENGTH = 20;
const MAX_SELECT_OPTIONS = 20;
const MAX_DECIMALS = 8;

function normalize(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Escapes the three characters that matter for safe `innerHTML` placement
 *  inside a `<p>...</p>` wrapper. Applied to INTRO before it's ever placed
 *  in the returned config (opus review, item 6): the parser's returned
 *  config is `unknown`, un-validated, and the editor's live preview
 *  (toRuntimeConfig) renders it via innerHTML *before* the next debounced
 *  save routes it through schema.ts's sanitizeRichText — so an INTRO
 *  containing raw `<img onerror=...>` would otherwise execute in that
 *  preview window. `&` must be escaped first so the entities this function
 *  itself writes don't get double-escaped. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Reverses `escapeHtml` for the serializer's INTRO line, so a config whose
 *  intro was produced by this module's own parser (or by the schema's
 *  sanitizeRichText, which also escapes) round-trips back to its original
 *  plain-text form instead of leaking literal "&amp;" into the emitted doc
 *  (which would then be re-escaped to "&amp;amp;" on the next import).
 *  Order matters only for `&`, which must decode LAST: escapeHtml never
 *  produces nested entities, so decoding "&gt;"/"&lt;" first can't create a
 *  spurious "&amp;...;" sequence for the final `&` replace to mis-fire on. */
function unescapeHtml(s: string): string {
  return s.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
}

// ---------------------------------------------------------------------------
// Internal working types
// ---------------------------------------------------------------------------

type WorkingOption = { label: string; value: number };
type WorkingInput = {
  id: string;
  label: string;
  type: "slider" | "number" | "select";
  min?: number;
  max?: number;
  step?: number;
  defaultValue: number;
  units?: string;
  options?: WorkingOption[];
};
type WorkingOutput = { id: string; label: string; formula: string; units?: string; decimals?: number };
type WorkingChart = { id: string; title: string; xInputId: string; yOutputId: string; samples: number };
type WorkingChallenge = {
  id: string;
  prompt: string;
  outputId: string;
  comparator: "gte" | "lte" | "between";
  value?: number;
  min?: number;
  max?: number;
};

type LabelEntry = { id: string; label: string; line: number; skip?: boolean };

/** Pass 1: walk every INPUT:/OUTPUT: line once to assign each one's final
 *  id up front (so formula/CHART/CHALLENGE resolution can find any label
 *  regardless of file order, mirroring branching's collectTitles), and to
 *  catch the "label collides with a reserved formula constant" rule at the
 *  point the label is declared. Mirrors branching's two-pass architecture,
 *  applied to a flat (non-nested) directive list. Ids are unique across
 *  BOTH inputs and outputs together (the schema's own duplicate-id check
 *  spans both collections), so a single shared `usedIds` set is threaded
 *  through both loops below and returned so pass 2 can keep allocating from
 *  it (chart/challenge ids, and the floor placeholders).
 *
 *  Duplicate detection (opus review, item 1): unlike branching's
 *  duplicate-title rule (which still imports every duplicate scene/ending,
 *  just unreachable by name), a duplicate INPUT/OUTPUT label here is
 *  skipped ENTIRELY — no id is assigned, and the entry is marked `skip` so
 *  pass 2 can drop it completely (see processInput/processOutput). This is
 *  stricter because param-sandbox labels are the *only* way formulas/
 *  CHART/CHALLENGE reference an input or output (there's no id-based
 *  fallback the way a hand-authored config could use), so leaving a
 *  same-named second declaration half-alive (present in the config, but
 *  unreachable by name, and thus unrenamable/unremovable via the doc) would
 *  be a worse outcome than dropping it outright. Duplicates are checked
 *  per-kind (an INPUT and an OUTPUT may share a label; the resolution maps
 *  are separate) — see substituteLabelsToIds/item 2 for the cross-kind
 *  collision this doesn't (and can't) catch. */
function collectLabels(
  lines: string[],
  issues: ImportIssue[],
): { inputs: LabelEntry[]; outputs: LabelEntry[]; usedIds: Set<string> } {
  const usedIds = new Set<string>();
  const inputs: LabelEntry[] = [];
  const outputs: LabelEntry[] = [];
  const seenInputLabels = new Map<string, number>(); // lowercased label -> line of first occurrence
  const seenOutputLabels = new Map<string, number>();

  const assign = (rawLabel: string, lineNo: number, fallback: string): string => {
    const isReserved = RESERVED_CONSTANTS.has(rawLabel.trim().toLowerCase());
    if (isReserved) {
      issues.push({
        line: lineNo,
        severity: "error",
        message: `label "${rawLabel.trim()}" collides with the reserved formula constant "${rawLabel.trim().toLowerCase()}" — imported with a numeric suffix`,
      });
      // Force uniqueSlug's own collision suffixing to kick in immediately by
      // pre-seeding the bare constant name as already taken.
      usedIds.add(rawLabel.trim().toLowerCase());
    }
    const id = uniqueSlug(rawLabel, usedIds, fallback);
    usedIds.add(id);
    return id;
  };

  lines.forEach((line, i) => {
    if (COMMENT_RE.test(line)) return;
    const m = line.match(DIRECTIVE_RE);
    if (!m) return;
    const kind = m[1].toUpperCase();
    const value = m[2];
    const lineNo = i + 1;
    if (kind !== "INPUT" && kind !== "OUTPUT") return;
    // Use the real INPUT/OUTPUT regexes (not a naive indexOf("(")) so a
    // label that itself contains a literal "(" — e.g. buoyancy's "Weight
    // (gravity)" — still backtracks correctly to the actual metadata
    // parens rather than truncating at the label's own paren. Falls back to
    // a best-effort naive split only when the line is malformed enough that
    // neither regex matches at all (pass 2 reports the real error for that
    // line; this label is only used for forward-reference resolution).
    const structured = kind === "INPUT" ? value.match(INPUT_LINE_RE) : value.match(OUTPUT_LINE_RE);
    const rawLabel = (structured ? structured[1].trim() : (value.indexOf("(") === -1 ? value : value.slice(0, value.indexOf("("))).trim());
    const fallback = kind === "INPUT" ? "input" : "output";
    const effectiveLabel = rawLabel || fallback;
    const key = effectiveLabel.toLowerCase();
    const seenMap = kind === "INPUT" ? seenInputLabels : seenOutputLabels;
    const list = kind === "INPUT" ? inputs : outputs;

    const firstLine = seenMap.get(key);
    if (firstLine !== undefined) {
      issues.push({
        line: lineNo,
        severity: "error",
        message: `duplicate ${kind.toLowerCase()} label "${effectiveLabel}" — already declared on line ${firstLine}; this second declaration (line ${lineNo}) is skipped and will not resolve by name`,
      });
      list.push({ id: "", label: rawLabel, line: lineNo, skip: true });
      return;
    }
    seenMap.set(key, lineNo);
    const id = assign(effectiveLabel, lineNo, fallback);
    list.push({ id, label: rawLabel, line: lineNo });
  });

  return { inputs, outputs, usedIds };
}

/** First-occurrence-wins, case-insensitive label lookup (mirrors branching's
 *  sceneByTitle/endingByTitle maps). Entries marked `skip` (duplicates, see
 *  collectLabels) are never the first occurrence for their key by
 *  construction, so they're harmless here even when included in `entries`. */
function toLabelMap(entries: LabelEntry[]): Map<string, LabelEntry> {
  const map = new Map<string, LabelEntry>();
  for (const e of entries) {
    const key = e.label.toLowerCase();
    if (!map.has(key)) map.set(key, e);
  }
  return map;
}

/** Longest-label-first, case-insensitive whole-word substitution of known
 *  labels into their slugified ids, applied before `parseFormula`
 *  validation (spec §5's "formula identifiers resolve against labels
 *  first"). Candidates may include labels not yet "known" for schema
 *  purposes (e.g. a later output) — that's deliberate: the substitution
 *  step is purely textual, and the caller checks the resulting identifiers
 *  against the order-sensitive known-id set afterward, so a forward
 *  reference still surfaces as an "unresolved identifier" error (mirroring
 *  the schema's own progressive known-id rule) even though the label text
 *  matched.
 *
 *  Single-pass rewrite (opus review, item 2): the original implementation
 *  replaced one candidate label at a time, longest-first, chaining each
 *  `.replace()` onto the previous pass's output. That's unsound whenever
 *  two candidates share the same lowercased label text across kinds (an
 *  INPUT and an OUTPUT can both be named "Rate", say, since duplicate
 *  detection — item 1 — only checks within a kind): the first candidate's
 *  case-insensitive regex matches BOTH spellings and inserts its id, and
 *  the second candidate's regex (also case-insensitive) can then re-match
 *  that just-inserted id — if it happens to equal the second candidate's
 *  own lowercased label — and rewrite it AGAIN. The fix builds one
 *  combined alternation over every distinct label (longest first, so a
 *  longer label wins over a shorter one it contains) and replaces every
 *  match in a single `.replace()` pass over the ORIGINAL string, so an
 *  inserted id is never visible to a later part of the same substitution.
 *  Ties for the same lowercased label resolve to whichever candidate is
 *  first in `candidates` (inputs before outputs, in file order — the same
 *  "first occurrence wins" convention as toLabelMap). */
function substituteLabelsToIds(formula: string, candidates: LabelEntry[]): string {
  const withLabels = candidates.filter((c) => c.label);
  if (withLabels.length === 0) return formula;
  const sorted = [...withLabels].sort((a, b) => b.label.length - a.label.length);
  const idByLowerLabel = new Map<string, string>();
  for (const c of sorted) {
    const key = c.label.toLowerCase();
    if (!idByLowerLabel.has(key)) idByLowerLabel.set(key, c.id);
  }
  const pattern = [...idByLowerLabel.keys()]
    .sort((a, b) => b.length - a.length)
    .map((k) => escapeRegExp(k))
    .join("|");
  const re = new RegExp(`\\b(?:${pattern})\\b`, "gi");
  return formula.replace(re, (matched) => idByLowerLabel.get(matched.toLowerCase()) ?? matched);
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export function parseSandboxCompanionDoc(text: string): { config: unknown; report: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const lines = normalize(text).split("\n");

  const { inputs: inputLabelList, outputs: outputLabelList, usedIds } = collectLabels(lines, issues);
  // Candidates for formula-label substitution exclude `skip`ped (duplicate,
  // item 1) entries — a formula referencing a duplicate label resolves via
  // the FIRST (surviving) entry for that label, which stays in this list.
  const allLabelCandidates: LabelEntry[] = [...inputLabelList, ...outputLabelList].filter((e) => !e.skip);

  let title: string | undefined;
  let intro: string | undefined;

  const inputs: WorkingInput[] = [];
  const outputs: WorkingOutput[] = [];
  const charts: WorkingChart[] = [];
  const challenges: WorkingChallenge[] = [];

  let inputIndex = 0;
  let outputIndex = 0;

  // Entries that actually landed in `inputs`/`outputs` below (i.e. survived
  // every pass-2 rejection: duplicate/toggle/malformed/empty-select/cap-
  // overflow/min>=max/step<=0 for inputs; duplicate/malformed/cap-overflow
  // for outputs). `inputByLabel`/`outputByLabel` — and the seed of
  // `knownIdsForFormulas` — are built ONLY from these (opus review, item 3):
  // a rejected declaration's label must not resolve to anything, so a
  // later formula/CHART/CHALLENGE reference to it surfaces as a normal
  // "unresolved"/"no input named" error instead of silently binding to a
  // dangling id that never made it into the returned config.
  const acceptedInputEntries: LabelEntry[] = [];
  const acceptedOutputEntries: LabelEntry[] = [];

  const usedChartIds = new Set<string>();
  const usedChallengeIds = new Set<string>();

  function processInput(rawValue: string, lineNo: number): void {
    const entry = inputLabelList[inputIndex++];
    if (entry.skip) return; // duplicate label (item 1) — already reported, fully pruned
    const m = rawValue.match(INPUT_LINE_RE);
    if (!m) {
      issues.push({
        line: lineNo,
        severity: "error",
        message:
          'INPUT line must look like "<Label> (slider|number, <units>, <min> to <max>, step <step>, start <default>)" or "<Label> (select[, <units>]: <option>=<value>, ...)"',
      });
      return;
    }
    if (inputs.length >= MAX_INPUTS) {
      issues.push({ line: lineNo, severity: "error", message: `too many inputs (max ${MAX_INPUTS}) — this input was skipped` });
      return;
    }
    const label = entry.label;
    const meta = m[2];
    const typeToken = meta.split(/[,:]/)[0].trim().toLowerCase();

    if (typeToken === "toggle") {
      issues.push({ line: lineNo, severity: "error", message: `input "${label}": toggle inputs are editor-only — skipped on import` });
      return;
    }

    if (typeToken === "select") {
      const colonIdx = meta.indexOf(":");
      if (colonIdx === -1) {
        issues.push({ line: lineNo, severity: "error", message: `input "${label}": a select input needs ": <option>=<value>, ..." after "select"` });
        return;
      }
      const header = meta.slice(0, colonIdx).split(",").map((t) => t.trim());
      let units = header[1] || undefined;
      const optsRaw = meta
        .slice(colonIdx + 1)
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      const options: Array<WorkingOption & { isDefault: boolean }> = [];
      for (const opt of optsRaw) {
        const om = opt.match(OPTION_RE);
        if (!om) {
          issues.push({ line: lineNo, severity: "error", message: `input "${label}": unrecognized select option "${opt}" (expected "<name>=<value>")` });
          continue;
        }
        options.push({ label: om[1].trim(), value: Number(om[2]), isDefault: !!om[3] });
      }
      if (options.length === 0) {
        issues.push({ line: lineNo, severity: "error", message: `input "${label}": select has no valid options — input skipped` });
        return;
      }
      let finalOptions = options;
      if (finalOptions.length > MAX_SELECT_OPTIONS) {
        issues.push({ line: lineNo, severity: "warning", message: `input "${label}": select has more than ${MAX_SELECT_OPTIONS} options — extra options were dropped` });
        finalOptions = finalOptions.slice(0, MAX_SELECT_OPTIONS);
      }
      if (units && units.length > MAX_UNITS_LENGTH) {
        issues.push({ line: lineNo, severity: "warning", message: `input "${label}": units "${units}" is longer than ${MAX_UNITS_LENGTH} characters — truncated` });
        units = units.slice(0, MAX_UNITS_LENGTH);
      }
      const defaultOpt = finalOptions.find((o) => o.isDefault) ?? finalOptions[0];
      inputs.push({
        id: entry.id,
        label,
        type: "select",
        defaultValue: defaultOpt.value,
        ...(units ? { units } : {}),
        options: finalOptions.map((o) => ({ label: o.label, value: o.value })),
      });
      acceptedInputEntries.push(entry);
      return;
    }

    if (typeToken !== "slider" && typeToken !== "number") {
      issues.push({
        line: lineNo,
        severity: "error",
        message: `input "${label}": unknown input type "${typeToken}" (expected slider, number, or select — toggle is editor-only)`,
      });
      return;
    }

    const tokens = meta.split(",").map((t) => t.trim());
    const rangeM = tokens[2]?.match(RANGE_RE);
    const stepM = tokens[3]?.match(STEP_RE);
    const startM = tokens[4]?.match(START_RE);
    if (tokens.length !== 5 || !rangeM || !stepM || !startM) {
      issues.push({
        line: lineNo,
        severity: "error",
        message: 'INPUT line must look like "<Label> (slider|number, <units>, <min> to <max>, step <step>, start <default>)"',
      });
      return;
    }
    const min = Number(rangeM[1]);
    const max = Number(rangeM[2]);
    const step = Number(stepM[1]);
    let defaultValue = Number(startM[1]);
    let units = tokens[1] || undefined;

    // Numeric/cap checks (opus review, item 5) — mirror schema.ts's own
    // rules so a violation is line-numbered here instead of surfacing only
    // as an opaque post-hoc schema error. min>=max and step<=0 have no
    // sensible salvage, so the input is skipped outright (pruned, item 3);
    // an out-of-range start is salvageable by clamping, with a warning.
    if (!(min < max)) {
      issues.push({ line: lineNo, severity: "error", message: `input "${label}": min (${min}) must be less than max (${max}) — this input was skipped` });
      return;
    }
    if (!(step > 0)) {
      issues.push({ line: lineNo, severity: "error", message: `input "${label}": step must be greater than 0 (got ${step}) — this input was skipped` });
      return;
    }
    if (defaultValue < min) {
      issues.push({ line: lineNo, severity: "warning", message: `input "${label}": start ${defaultValue} is below min ${min} — clamped to ${min}` });
      defaultValue = min;
    } else if (defaultValue > max) {
      issues.push({ line: lineNo, severity: "warning", message: `input "${label}": start ${defaultValue} is above max ${max} — clamped to ${max}` });
      defaultValue = max;
    }
    if (units && units.length > MAX_UNITS_LENGTH) {
      issues.push({ line: lineNo, severity: "warning", message: `input "${label}": units "${units}" is longer than ${MAX_UNITS_LENGTH} characters — truncated` });
      units = units.slice(0, MAX_UNITS_LENGTH);
    }

    inputs.push({
      id: entry.id,
      label,
      type: typeToken,
      min,
      max,
      step,
      defaultValue,
      ...(units ? { units } : {}),
    });
    acceptedInputEntries.push(entry);
  }

  // Pass 2a: all inputs, in file order (independent of CHART/CHALLENGE
  // position — see the module doc comment for why this is now a dedicated
  // pass rather than interleaved with everything else).
  lines.forEach((line, i) => {
    if (COMMENT_RE.test(line)) return;
    const m = line.match(DIRECTIVE_RE);
    if (!m || m[1].toUpperCase() !== "INPUT") return;
    processInput(m[2].trim(), i + 1);
  });

  const inputByLabel = toLabelMap(acceptedInputEntries);

  // Order-sensitive known-id set for formula validation: all ACCEPTED
  // inputs are available immediately (they never depend on anything else),
  // and outputs are added one at a time as they're successfully processed —
  // mirroring validateSandboxConfig's own progressive `known` set, so a
  // formula referencing a not-yet-declared output (or a since-pruned input,
  // item 3) is caught here as an "unresolved identifier", not deferred to a
  // confusing schema-only error.
  const knownIdsForFormulas = new Set<string>(acceptedInputEntries.map((e) => e.id));

  function processOutput(rawValue: string, lineNo: number): void {
    const entry = outputLabelList[outputIndex++];
    if (entry.skip) return; // duplicate label (item 1) — already reported, fully pruned
    const m = rawValue.match(OUTPUT_LINE_RE);
    if (!m) {
      issues.push({
        line: lineNo,
        severity: "error",
        message: 'OUTPUT line must look like "<Label> (<units>[, <n> decimals]) = <formula>"',
      });
      return;
    }
    if (outputs.length >= MAX_OUTPUTS) {
      issues.push({ line: lineNo, severity: "error", message: `too many outputs (max ${MAX_OUTPUTS}) — this output was skipped` });
      return;
    }
    const label = entry.label;
    const metaTokens = m[2]
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    let units = metaTokens[0] || undefined;
    let decimals: number | undefined;
    if (metaTokens.length >= 2) {
      const dm = metaTokens[1].match(DECIMALS_RE);
      if (!dm) {
        issues.push({ line: lineNo, severity: "error", message: `output "${label}": "${metaTokens[1]}" must look like "<n> decimals"` });
      } else {
        decimals = Number(dm[1]);
      }
    }
    // Numeric/cap checks (opus review, item 5): both salvageable by
    // clamping/truncating with a warning, so the declaration still lands.
    if (decimals !== undefined && decimals > MAX_DECIMALS) {
      issues.push({ line: lineNo, severity: "warning", message: `output "${label}": decimals capped at ${MAX_DECIMALS} (was ${decimals})` });
      decimals = MAX_DECIMALS;
    }
    if (units && units.length > MAX_UNITS_LENGTH) {
      issues.push({ line: lineNo, severity: "warning", message: `output "${label}": units "${units}" is longer than ${MAX_UNITS_LENGTH} characters — truncated` });
      units = units.slice(0, MAX_UNITS_LENGTH);
    }

    const rawFormula = m[3].trim();
    const substituted = substituteLabelsToIds(rawFormula, allLabelCandidates);
    const parsed = parseFormula(substituted);
    let finalFormula = substituted;
    let ok = parsed.ok;
    if (!parsed.ok) {
      issues.push({ line: lineNo, severity: "error", message: `output "${label}" formula could not be parsed: ${parsed.error}` });
    } else {
      const refs = collectIdentifiers(parsed.ast);
      const unresolved = refs.filter((r) => !knownIdsForFormulas.has(r));
      if (unresolved.length > 0) {
        issues.push({
          line: lineNo,
          severity: "error",
          message: `output "${label}" formula references "${unresolved[0]}" which could not be resolved to a known input or earlier output`,
        });
        ok = false;
      }
    }
    if (!ok) finalFormula = "0";

    outputs.push({
      id: entry.id,
      label,
      formula: finalFormula,
      ...(units ? { units } : {}),
      ...(decimals !== undefined ? { decimals } : {}),
    });
    acceptedOutputEntries.push(entry);
    knownIdsForFormulas.add(entry.id);
  }

  // Pass 2b: all outputs, in file order (formula resolution is genuinely
  // order-sensitive — an output may only reference EARLIER outputs — so
  // this stays a dedicated top-to-bottom pass, now running to completion
  // before CHART/CHALLENGE are resolved against the result).
  lines.forEach((line, i) => {
    if (COMMENT_RE.test(line)) return;
    const m = line.match(DIRECTIVE_RE);
    if (!m || m[1].toUpperCase() !== "OUTPUT") return;
    processOutput(m[2].trim(), i + 1);
  });

  const outputByLabel = toLabelMap(acceptedOutputEntries);

  function resolveOutputLabel(rawLabel: string, lineNo: number, context: string): LabelEntry | undefined {
    const hit = outputByLabel.get(rawLabel.trim().toLowerCase());
    if (!hit) {
      issues.push({ line: lineNo, severity: "error", message: `${context}: no output named "${rawLabel.trim()}"` });
      return undefined;
    }
    return hit;
  }
  function resolveInputLabel(rawLabel: string, lineNo: number, context: string): LabelEntry | undefined {
    const hit = inputByLabel.get(rawLabel.trim().toLowerCase());
    if (!hit) {
      issues.push({ line: lineNo, severity: "error", message: `${context}: no input named "${rawLabel.trim()}"` });
      return undefined;
    }
    return hit;
  }

  function processChart(rawValue: string, lineNo: number): void {
    if (charts.length >= MAX_CHARTS) {
      issues.push({ line: lineNo, severity: "error", message: `too many charts (max ${MAX_CHARTS}) — this chart was skipped` });
      return;
    }
    let core = rawValue.trim();
    let samples: number | undefined;
    let explicitTitle: string | undefined;
    const trailing = core.match(CHART_TRAILING_PAREN_RE);
    if (trailing) {
      const inner = trailing[2].trim();
      const sm = inner.match(CHART_SAMPLES_RE);
      if (!sm) {
        issues.push({
          line: lineNo,
          severity: "error",
          message: 'CHART line must look like "<Output label> vs <Input label> [(<N> samples[, titled <text>])]"',
        });
        return;
      }
      samples = Number(sm[1]);
      explicitTitle = sm[2]?.trim();
      core = trailing[1].trim();
    }
    const vsM = core.match(CHART_VS_RE);
    if (!vsM) {
      issues.push({
        line: lineNo,
        severity: "error",
        message: 'CHART line must look like "<Output label> vs <Input label> [(<N> samples[, titled <text>])]"',
      });
      return;
    }
    const outputEntry = resolveOutputLabel(vsM[1], lineNo, "CHART");
    const inputEntry = resolveInputLabel(vsM[2], lineNo, "CHART");
    if (!outputEntry || !inputEntry) return;

    // The x-axis must be a slider/number input — a select's values aren't a
    // continuous domain to plot against (mirrors schema.ts's own chart
    // xInputId check; opus review, item 5). `inputs` is fully populated by
    // this point (pass 2a already ran to completion).
    const xInput = inputs.find((i) => i.id === inputEntry.id);
    if (xInput && xInput.type !== "slider" && xInput.type !== "number") {
      issues.push({
        line: lineNo,
        severity: "error",
        message: `CHART: input "${inputEntry.label}" must be a slider or number input to use as the x-axis (got "${xInput.type}") — this chart was skipped`,
      });
      return;
    }

    if (samples === undefined) {
      samples = DEFAULT_SAMPLES;
      // spec §5 calls this an "info-level" note; ImportIssue has no "info"
      // severity (only "error"/"warning"), so it's reported as a warning —
      // this is the one place that mapping matters (opus review, item 11).
      issues.push({ line: lineNo, severity: "warning", message: `samples defaulted to ${DEFAULT_SAMPLES}` });
    }
    const title = explicitTitle || `${outputEntry.label} vs ${inputEntry.label}`;
    const id = uniqueSlug(`${outputEntry.label}_vs_${inputEntry.label}`, usedChartIds, "chart");
    usedChartIds.add(id);
    charts.push({ id, title, xInputId: inputEntry.id, yOutputId: outputEntry.id, samples });
  }

  function processChallenge(rawValue: string, lineNo: number): void {
    if (challenges.length >= MAX_CHALLENGES) {
      issues.push({ line: lineNo, severity: "error", message: `too many challenges (max ${MAX_CHALLENGES}) — this challenge was skipped` });
      return;
    }
    const arrowM = rawValue.match(ARROW_RE);
    if (!arrowM) {
      issues.push({ line: lineNo, severity: "error", message: 'CHALLENGE is missing "-> <Output label> at least|at most|between ..."' });
      return;
    }
    const prompt = arrowM[1].trim();
    const arrow = arrowM[2];
    const conditionPart = arrowM[3].trim();
    if (!GOOD_ARROWS.has(arrow)) {
      issues.push({ line: lineNo, severity: "warning", message: `use "->" instead of "${arrow}"` });
    }
    if (STRAY_COMPARATOR_RE.test(conditionPart)) {
      issues.push({
        line: lineNo,
        severity: "error",
        message: `challenge condition must use "at least <n>", "at most <n>", or "between <n> and <m>" — comparators like ">", "<", ">=", "<=" are not supported`,
      });
      return;
    }
    const condM = conditionPart.match(CHALLENGE_CONDITION_RE);
    if (!condM) {
      issues.push({
        line: lineNo,
        severity: "error",
        message: `challenge condition must use "at least <n>", "at most <n>", or "between <n> and <m>"`,
      });
      return;
    }
    const outputEntry = resolveOutputLabel(condM[1], lineNo, "CHALLENGE");
    if (!outputEntry) return;
    const keyword = condM[2].toLowerCase();
    let comparator: "gte" | "lte" | "between";
    let value: number | undefined;
    let min: number | undefined;
    let max: number | undefined;
    if (/least/.test(keyword)) {
      comparator = "gte";
      value = Number(condM[3]);
    } else if (/most/.test(keyword)) {
      comparator = "lte";
      value = Number(condM[3]);
    } else {
      comparator = "between";
      if (condM[4] === undefined) {
        issues.push({ line: lineNo, severity: "error", message: `challenge condition: "between" requires "between <n> and <m>"` });
        return;
      }
      min = Number(condM[3]);
      max = Number(condM[4]);
      // opus review, item 5: no sensible salvage for an inverted range, so
      // (like input min>=max) the whole declaration is skipped.
      if (!(min < max)) {
        issues.push({ line: lineNo, severity: "error", message: `challenge condition: "between" requires min < max (got ${min} and ${max}) — this challenge was skipped` });
        return;
      }
    }
    const id = uniqueSlug(prompt || "challenge", usedChallengeIds, "challenge");
    usedChallengeIds.add(id);
    challenges.push({ id, prompt: prompt || "Challenge", outputId: outputEntry.id, comparator, ...(value !== undefined ? { value } : {}), ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) });
  }

  // Pass 2c: everything else (TITLE/INTRO/CHART/CHALLENGE/unknown
  // directives). INPUT/OUTPUT lines are already fully handled above (passes
  // 2a/2b) and are explicitly no-ops here — CHART/CHALLENGE now resolve
  // against the complete, pruned inputByLabel/outputByLabel regardless of
  // where they sit relative to the declarations they reference.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    if (COMMENT_RE.test(line)) continue;
    if (line.trim() === "") continue;

    const directiveMatch = line.match(DIRECTIVE_RE);
    if (directiveMatch) {
      const kind = directiveMatch[1].toUpperCase();
      const value = directiveMatch[2].trim();
      switch (kind) {
        case "TITLE":
          title = value;
          break;
        case "INTRO":
          intro = value;
          break;
        case "INPUT":
        case "OUTPUT":
          break; // handled in passes 2a/2b above
        case "CHART":
          processChart(value, lineNo);
          break;
        case "CHALLENGE":
          processChallenge(value, lineNo);
          break;
      }
      continue;
    }

    if (UNKNOWN_DIRECTIVE_RE.test(line)) {
      issues.push({ line: lineNo, severity: "error", message: `unknown directive: "${line.trim()}"` });
      continue;
    }
    // Any other stray line (plain text with no directive) is silently
    // ignored — this format has no free-text body sections to collect into.
  }

  if (title === undefined) {
    issues.push({ line: 1, severity: "warning", message: 'no TITLE given — defaulting to "Imported sandbox"' });
    title = "Imported sandbox";
  }

  // Floor: the schema requires >=1 input and >=1 output. A doc that yields
  // zero of either still lands an editable draft with a flagged
  // placeholder, per spec §5's "floor" rule.
  if (inputs.length === 0) {
    const id = uniqueSlug("Imported input", usedIds, "input");
    usedIds.add(id);
    inputs.push({ id, label: "Imported input", type: "slider", min: 0, max: 10, step: 1, defaultValue: 5 });
    issues.push({
      line: 1,
      severity: "warning",
      message: "no valid inputs were found in this document — added a placeholder input so this draft can still be edited (the schema requires at least one)",
    });
  }
  if (outputs.length === 0) {
    const id = uniqueSlug("Imported output", usedIds, "output");
    usedIds.add(id);
    outputs.push({ id, label: "Imported output", formula: "0" });
    issues.push({
      line: 1,
      severity: "warning",
      message: "no valid outputs were found in this document — added a placeholder output so this draft can still be edited (the schema requires at least one)",
    });
  }

  issues.sort((a, b) => a.line - b.line);

  const config = {
    title,
    // HTML-escaped before the <p> wrap (opus review, item 6) — see
    // escapeHtml's doc comment for the unsanitized-draft -> preview
    // innerHTML path this closes.
    ...(intro ? { intro: `<p>${escapeHtml(intro)}</p>` } : {}),
    inputs: inputs.map((i) => ({
      id: i.id,
      label: i.label,
      type: i.type,
      ...(i.min !== undefined ? { min: i.min } : {}),
      ...(i.max !== undefined ? { max: i.max } : {}),
      ...(i.step !== undefined ? { step: i.step } : {}),
      defaultValue: i.defaultValue,
      ...(i.units ? { units: i.units } : {}),
      ...(i.options ? { options: i.options } : {}),
    })),
    outputs: outputs.map((o) => ({
      id: o.id,
      label: o.label,
      formula: o.formula,
      ...(o.units ? { units: o.units } : {}),
      ...(o.decimals !== undefined ? { decimals: o.decimals } : {}),
    })),
    charts: charts.map((c) => ({ id: c.id, title: c.title, xInputId: c.xInputId, yOutputId: c.yOutputId, samples: c.samples })),
    challenges: challenges.map((c) => ({
      id: c.id,
      prompt: c.prompt,
      outputId: c.outputId,
      comparator: c.comparator,
      ...(c.value !== undefined ? { value: c.value } : {}),
      ...(c.min !== undefined ? { min: c.min } : {}),
      ...(c.max !== undefined ? { max: c.max } : {}),
    })),
  };

  return { config, report: issues };
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

function stripTags(html: string | undefined): string {
  return (html ?? "").replace(/<[^>]+>/g, "").trim();
}

/** Minimal shape this serializer needs — matches schema.ts's SandboxConfig
 *  structurally without importing zod. Declared locally (not imported from
 *  schema.ts) to keep this module light, mirroring branching's
 *  BranchingConfigLike precedent. */
export interface SandboxConfigLike {
  title: string;
  intro?: string;
  inputs: Array<{
    id: string;
    label: string;
    type: "slider" | "number" | "toggle" | "select";
    min?: number;
    max?: number;
    step?: number;
    defaultValue: number;
    units?: string;
    options?: Array<{ label: string; value: number }>;
    placement?: { zone: "panel" | "below" | "stage" };
  }>;
  outputs: Array<{
    id: string;
    label: string;
    formula: string;
    units?: string;
    decimals?: number;
    placement?: { zone: "panel" | "below" | "stage" };
  }>;
  charts: Array<{ id: string; title: string; xInputId: string; yOutputId: string; samples: number }>;
  challenges: Array<{ id: string; prompt: string; outputId: string; comparator: "gte" | "lte" | "between"; value?: number; min?: number; max?: number }>;
  visual?: unknown;
  layout?: "side" | "stacked" | "stage-focus";
}

/** Word-bounded substitution of ids back into their labels, the reverse of
 *  `substituteLabelsToIds`. Ids are simple identifier strings (letters/
 *  digits/underscore).
 *
 *  Single-pass rewrite (opus review, item 4): the original chained one
 *  `.replace()` per id, longest-first. That's unsound whenever one id's
 *  own text can be produced by inserting ANOTHER id's label — e.g. id
 *  `rate` (label "Speed") and id `rate_of_change` (label "rate of change"):
 *  substituting `rate_of_change` first inserts the literal text
 *  "rate of change" into the formula, and the LATER pass for id `rate`
 *  then re-matches the word "rate" *inside that just-inserted label text*
 *  and corrupts it into "Speed of change". Building one combined
 *  alternation over every id (longest first) and replacing in a single
 *  `.replace()` over the ORIGINAL formula means an inserted label is never
 *  visible to a later part of the same substitution — mirrors
 *  substituteLabelsToIds's own fix (item 2) in the reverse direction. The
 *  comment this replaces previously (incorrectly) described the hazard as
 *  one id matching inside another id's spelling, which the shared
 *  underscore-as-word-character property already ruled out; the real
 *  hazard is an inserted LABEL text (which can contain arbitrary words)
 *  being re-matched. */
function idsToLabelsInFormula(formula: string, idToLabel: Map<string, string>): string {
  const entries = [...idToLabel.entries()];
  if (entries.length === 0) return formula;
  const sorted = [...entries].sort((a, b) => b[0].length - a[0].length);
  const pattern = sorted.map(([id]) => escapeRegExp(id)).join("|");
  const re = new RegExp(`\\b(?:${pattern})\\b`, "g");
  return formula.replace(re, (matched) => idToLabel.get(matched) ?? matched);
}

export function serializeSandboxCompanionDoc(config: SandboxConfigLike): string {
  const lines: string[] = [];

  // -- Documented lossiness: header comments -------------------------------
  const lossyFeatures: string[] = [];
  const toggleInputs = config.inputs.filter((i) => i.type === "toggle");
  if (toggleInputs.length) {
    lossyFeatures.push(`toggle input${toggleInputs.length > 1 ? "s" : ""} (${toggleInputs.map((i) => i.label).join(", ")}) — toggles are editor-only`);
  }
  const placedItems = [...config.inputs, ...config.outputs].filter((f) => f.placement && f.placement.zone !== "panel");
  if (placedItems.length) {
    lossyFeatures.push(`custom placement on ${placedItems.map((f) => f.label).join(", ")} — placement is editor-only`);
  }
  if (config.visual) {
    lossyFeatures.push(`the visual scene (background image and/or overlays) — visual layers are editor-only`);
  }
  if (config.layout && config.layout !== "side") {
    lossyFeatures.push(`the "${config.layout}" layout — layout is editor-only`);
  }
  if (lossyFeatures.length) {
    lines.push(`# Note: this config uses features this text format cannot represent, so they are left out below: ${lossyFeatures.join("; ")}. Edit those in the app instead.`);
  }

  const riskyLabels = [...config.inputs, ...config.outputs].map((f) => f.label).filter((l) => RISKY_LABEL_RE.test(l));
  if (riskyLabels.length) {
    lines.push(
      `# Warning: these labels contain characters this format's grammar treats specially ("(", "=", "->", " vs ", "$", an arithmetic operator, or a leading/trailing symbol), and may not re-import correctly if edited by hand: ${riskyLabels.map((l) => `"${l}"`).join(", ")}.`,
    );
  }
  if (lossyFeatures.length || riskyLabels.length) lines.push("");

  // -- Top matter -----------------------------------------------------------
  lines.push(`TITLE: ${config.title}`);
  // unescapeHtml (opus review, item 6): the parser now HTML-escapes INTRO
  // before storing it (`&`/`<`/`>` -> entities), so a config whose intro
  // came from this module's own parser (or from schema.ts's
  // sanitizeRichText, which also escapes) would otherwise round-trip back
  // out as literal "&amp;" text — and re-import would escape it AGAIN into
  // "&amp;amp;". Decoding here keeps the round trip stable.
  // INTRO is a single directive line, so a multi-paragraph intro
  // (concatenated <p> blocks) is joined with a single space -- bare
  // stripTags would butt the paragraphs together ("...end.Next...").
  if (config.intro) {
    const paragraphs = [...config.intro.matchAll(/<p>([\s\S]*?)<\/p>/gi)].map((m) => stripTags(m[1]));
    const introText = (paragraphs.length ? paragraphs : [stripTags(config.intro)]).filter(Boolean).join(" ");
    lines.push(`INTRO: ${unescapeHtml(introText)}`);
  }
  lines.push("");

  const idToLabel = new Map<string, string>();
  config.inputs.forEach((i) => idToLabel.set(i.id, i.label));
  config.outputs.forEach((o) => idToLabel.set(o.id, o.label));

  // -- Inputs -----------------------------------------------------------
  for (const inp of config.inputs) {
    if (inp.type === "toggle") continue;
    if (inp.type === "select") {
      const unitsPart = inp.units ? `, ${inp.units}` : "";
      // Mark only the FIRST matching option (opus review, item 8): if two
      // options happen to share the same value as defaultValue, marking
      // every match with "*" would re-import ambiguously (OPTION_RE's `*`
      // sets isDefault per-option, and the parser takes whichever comes
      // first anyway — so the serializer's output should already agree
      // with that, rather than emitting a doc with two "*"s).
      const defaultIdx = (inp.options ?? []).findIndex((o) => o.value === inp.defaultValue);
      const optsPart = (inp.options ?? [])
        .map((o, idx) => `${o.label}=${o.value}${idx === defaultIdx ? "*" : ""}`)
        .join(", ");
      lines.push(`INPUT: ${inp.label} (select${unitsPart}: ${optsPart})`);
    } else {
      lines.push(`INPUT: ${inp.label} (${inp.type}, ${inp.units ?? ""}, ${inp.min} to ${inp.max}, step ${inp.step}, start ${inp.defaultValue})`);
    }
  }
  lines.push("");

  // -- Outputs -----------------------------------------------------------
  for (const out of config.outputs) {
    const decimalsPart = out.decimals !== undefined ? `, ${out.decimals} decimals` : "";
    const formulaLabeled = idsToLabelsInFormula(out.formula, idToLabel);
    lines.push(`OUTPUT: ${out.label} (${out.units ?? ""}${decimalsPart}) = ${formulaLabeled}`);
  }
  lines.push("");

  // -- Charts -----------------------------------------------------------
  for (const chart of config.charts) {
    const outLabel = idToLabel.get(chart.yOutputId) ?? chart.yOutputId;
    const inLabel = idToLabel.get(chart.xInputId) ?? chart.xInputId;
    const defaultTitle = `${outLabel} vs ${inLabel}`;
    const titledPart = chart.title !== defaultTitle ? `, titled ${chart.title}` : "";
    lines.push(`CHART: ${outLabel} vs ${inLabel} (${chart.samples} samples${titledPart})`);
  }
  if (config.charts.length) lines.push("");

  // -- Challenges -----------------------------------------------------------
  for (const ch of config.challenges) {
    const outLabel = idToLabel.get(ch.outputId) ?? ch.outputId;
    let condText: string;
    if (ch.comparator === "gte") condText = `at least ${ch.value}`;
    else if (ch.comparator === "lte") condText = `at most ${ch.value}`;
    else condText = `between ${ch.min} and ${ch.max}`;
    lines.push(`CHALLENGE: ${ch.prompt} -> ${outLabel} ${condText}`);
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "\n");
}
