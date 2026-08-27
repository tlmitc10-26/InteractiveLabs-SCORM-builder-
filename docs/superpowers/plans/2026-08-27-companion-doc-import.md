# Scenario Companion Doc Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One-paste import of branching scenarios from a plain-text companion doc, per spec `docs/superpowers/specs/2026-08-27-companion-doc-import-design.md` — deterministic parser, line-numbered fail-visible report, round-trip serializer, editor UI, downloadable template.

**Architecture:** A pure two-pass parser (pass 1 collects SCENE/ENDING titles for name resolution; pass 2 builds the config and the report) + a serializer, both in one light module with zero heavy deps. Output flows through the EXISTING `validateBranchingConfig` gate — the importer adds no new trust. Editor UI is a disclosure panel in the Branching editor using existing field/report patterns.

**Tech Stack:** existing stack only. No new dependencies. Authoring-side only: ZERO engine-runtime/public-engines changes in this milestone (verify each task).

**Execution notes:** branch `feature/companion-doc` off `main`. Working dir `C:\Users\tamar\Vercel SCORM Builder Interactive Lessons` (quote). Windows/PowerShell 5.1 (no `&&`). Suite: 488 green; every task ends green + tsc + eslint clean. Commits end blank line + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. READ living files before editing (branching-editor.tsx, editor-shared.tsx carry review-hardened patterns).

---

## File Map

```
src/lib/engines/branching-scenario/companion-doc.ts   # NEW: parseCompanionDoc + serializeCompanionDoc + ImportIssue
public/companion-doc-template.txt                     # NEW: faculty-facing template (# comment lines)
src/app/interactives/[id]/branching-editor.tsx        # modify: ImportPanel disclosure in Scenario section
tests/companion-doc.test.ts                           # NEW: grammar matrix + round-trip + report completeness
```

---

### Task 1: Parser + serializer (TDD — the grammar is the contract)

**Files:** Create `src/lib/engines/branching-scenario/companion-doc.ts`, `tests/companion-doc.test.ts`

**Module contract:**
```ts
export interface ImportIssue { line: number; severity: "error" | "warning"; message: string }
export function parseCompanionDoc(text: string): { config: unknown; report: ImportIssue[] }
export function serializeCompanionDoc(config: BranchingConfigLike): string   // structural type from runtime-config.ts (light module discipline: import ONLY slugify + runtime-config types; NOT schema/zod)
```

**Parsing algorithm (two passes over normalized lines):**
- Normalize once: CRLF→LF; smart quotes ’‘“” → straight; keep original line numbers (1-based) alongside each line.
- Comment lines `^\s*#` are skipped silently (template instructions).
- Directive regex: `/^\s*(TITLE|ROLE|INTRO|FEEDBACK|START|TRACK|SCENE|ENDING)\s*:\s*(.*)$/i`. A line matching `/^\s*[A-Z][A-Z ]{2,20}:\s/i` that is NOT a known directive → error "unknown directive", line skipped.
- **Pass 1:** collect SCENE and ENDING titles in order (for name resolution + duplicate-title errors: duplicate scene/ending titles are errors, since destinations resolve by name).
- **Pass 2:** build. State machine: top matter (TITLE/ROLE/INTRO/FEEDBACK/START/TRACK) → scenes/endings.
  - `TRACK:` value grammar: `/^(.*?)\s*\(\s*(-?\d+)\s+to\s+(-?\d+)\s*,\s*start(?:\s+at)?\s+(-?\d+)\s*(?:,\s*(visible))?\s*\)$/i` → {label, min, max, initial, visible}. Malformed → error with the expected shape in the message.
  - `FEEDBACK:` value must be immediate|debrief (case-insensitive) else error (default debrief).
  - Body lines (non-directive, non-choice, not feedback-continuation) accumulate under the current SCENE/ENDING; blank line = paragraph break; paragraphs joined as `<p>…</p>` (raw text — the schema's rich() sanitizer normalizes at validation).
  - Choice lines `/^\s*[-*]\s+(.*)$/` (only under a SCENE; under an ENDING or top matter → error "choices belong under a SCENE").
    - Split: `/^(.*?)\s*\(([^()]*)\)\s*(->|→|–>|—>|=>)\s*(.+)$/` → label, meta, arrow, dest. Arrow not in {->, →} → warning "use ->". No-parens fallback `/^(.*?)\s*(->|→|–>|—>|=>)\s*(.+)$/` → error "missing (QUALITY)"; quality defaults OK (flagged). No arrow at all → error "missing -> destination"; choice gets the unresolved placeholder.
    - Meta = comma-split tokens: first token quality `BEST|ACCEPTABLE|OK|POOR` (i) → best/acceptable/poor; unknown first token → error, quality OK flagged. Remaining tokens each match effect `/^(.+?)\s*([+-]\d+)$/` (track name resolved case-insensitively by label → error if unknown) or condition `/^only\s+if\s+(.+?)\s+is\s+(?:(at\s+least|at\s+most)\s+(-?\d+)|between\s+(-?\d+)\s+and\s+(-?\d+))$/i` → gte/lte/between. Unrecognized token → error naming it.
    - Destination: strip optional explicit prefix `/^(SCENE|ENDING)\s*:\s*(.*)$/i`; resolve case-insensitively against pass-1 titles (explicit prefix restricts the namespace; bare name checks scenes first, then endings; ambiguous both → error "exists as both", resolves to the scene with a warning… NO: error + scene, flagged). Unresolved → error "no scene or ending named …" + goTo the shared placeholder ending (id `unresolved_destination`, title "Unresolved destination", body instructing the designer) — created once, appended to endings.
    - `Feedback:` continuation: `/^\s+feedback\s*:\s*(.*)$/i` attaches to the LAST choice; subsequent indented plain lines (`/^\s+\S/` while in feedback mode) append with a space. Feedback with no preceding choice → error.
  - ids: slugify + uniqueSlug (existing helpers) per namespace; scene/ending/variable/choice ids generated from titles/labels.
  - `START:` resolves by scene name (default: first scene). TITLE default: "Imported scenario" + warning if absent.
  - Caps checked with line-numbered errors (scenes ≤40, choices ≤6/scene, tracks ≤8, endings ≤8) — over-cap items are still emitted up to the cap, extras skipped+flagged (the validator double-checks).
- Report ordering: by line number. NOTHING is dropped or defaulted without an issue entry.

**Serializer:** writes TITLE/ROLE/INTRO/FEEDBACK/START (START only when not the first scene)/TRACK lines, then scenes in order (`SCENE: <title-or-Part N fallback>`, body paragraphs tag-stripped to plain text — document lossiness for non-paragraph rich markup in a comment), choices as `- label (QUALITY[, Track ±N][, only if …]) -> <destination title>`, `  Feedback: …` lines, then endings. Output must re-parse cleanly (this is tested, not aspirational).

**Test matrix (write ALL of these):** the spec's normative example parses → validateBranchingConfig ok, zero report errors (arrow/quality warnings zero); each grammar rule positive+negative (unknown directive line, TRACK malformed, FEEDBACK invalid value, choice missing quality, missing arrow, unresolved destination→placeholder present+flagged, ambiguous scene/ending name, effect on unknown track, condition at-least/at-most/between + malformed, choices under ENDING, feedback without choice, duplicate scene titles, comment lines ignored, CRLF + smart quotes + `→` arrow accepted, `–>` warns, multi-paragraph body becomes two `<p>`, START directive honored, caps: 41 scenes → 40 kept + flagged); **round-trip**: serializeCompanionDoc(jury starter config) → parseCompanionDoc → validate ok + semantic equality (titles, labels, qualities, effects, resolved destination titles, feedback text tag-stripped, track defs, feedbackMode, start scene); **report completeness**: a fixture with exactly 5 seeded flaws yields exactly 5 issues with the right line numbers.

Steps: failing tests → implement → 488+~35 green → tsc/eslint → commit `feat: companion doc parser and serializer with line-numbered import report`.

---

### Task 2: The template

**Files:** Create `public/companion-doc-template.txt`; Test: add 2 cases to `tests/companion-doc.test.ts`

Template content: ~15 `#` instruction lines at top (what the doc is, the rules in plain words, "share this file with faculty"), then a compact 2-scene/2-ending fillable skeleton with placeholder text in ALL-CAPS brackets style (`SCENE: [Name your first scene]`). Tests: (a) the template file parses with zero ERRORS (warnings allowed); (b) fs-read it from public/ so drift between file and parser breaks the build. Verify the file is NOT inside public/engines (scanner/manifest untouched — assert no manifest diff). Commit `feat: faculty-facing companion doc template`.

---

### Task 3: Editor import panel

**Files:** Modify `src/app/interactives/[id]/branching-editor.tsx` (READ first — hardened patterns)

Contract:
- In the Scenario section, a `<details>` "Import from companion doc": labeled `<textarea>` (10 rows, monospace), "Import" button (`.btn .btn-secondary`), "Copy as companion doc" button (`.btn .btn-light-2`), and a "Download the template" link (`<a href="/companion-doc-template.txt" download>` styled `.app-link`).
- Import click → `parseCompanionDoc(text)`; if the textarea is empty → inline message, no confirm. Otherwise `window.confirm("This replaces everything in this interactive. The current draft cannot be recovered. Continue?")` → on yes: `setConfig(parsed.config as EBranchingConfig)` through the existing hook path (draft-save + preview repost happen exactly like any edit), store the report in state.
- Report UI: an `<h3 tabIndex={-1} ref>` "Import report" + list (`{line}: {severity}: {message}` — severity styled: errors `--rds-danger`, warnings `--rds-dark-2`), focus moved to the heading after import (announcement contract), "Dismiss" button clears it. Zero-issue import shows "Imported cleanly." in the same focused region.
- Copy button: `serializeCompanionDoc(config)` → `navigator.clipboard.writeText` with try/catch fallback (select a hidden textarea + execCommand) + a transient "Copied." status (aria-live NOT needed — focus stays on the button; set its text to "Copied." for 2s then restore… simpler: a sibling status span updated via state, `role="status"`).
- Light-module discipline: companion-doc.ts imports stay clear of zod/sanitize (verify built chunk has no sanitize-html after `npm run build` + grep).

Browser E2E (required): paste the normative example into a fresh blank branching interactive → confirm → scenario plays in preview end-to-end → export 200; paste a 5-flaw doc → report lists 5 line-numbered issues, focus lands on the report heading, draft still editable; Copy button round-trips (copy from jury, import into a new blank, plays identically). Gates + commit `feat: companion doc import panel with fail-visible report`.

---

### Task 4: Final verification + docs

- Full gates: npm test (report count), tsc, eslint ., npm run build; **zero public/engines diff for the whole branch** (`git diff main..HEAD --stat -- public/engines src/engine-runtime` empty).
- README: short "Companion doc import" paragraph under the engines section (what it is, template link, deterministic + fail-visible, same validation gates).
- Browser acceptance run of spec §7 end to end.
- Merge --no-ff to main ("Merge feature/companion-doc: scenario companion doc import"), push origin, delete branch.

## Post-plan self-review (author ran this)

- **Spec coverage:** §2 format → Task 1 grammar (all directives, choice grammar, tolerances) ; §3 parser/serializer + round-trip + Word tolerances → Task 1; §4 UI (disclosure, confirm, report+focus, template link, copy) → Task 3; template → Task 2; §5 exclusions respected (no docx upload, no AI, no sandbox format); §6 test matrix → Tasks 1–3; §7 acceptance → Task 4.
- **Placeholder scan:** clean — grammar given as concrete regexes + resolution algorithm; UI as behavior contract against read-first hardened files.
- **Type consistency:** ImportIssue/parseCompanionDoc/serializeCompanionDoc (T1) consumed by T2 tests and T3 UI; BranchingConfigLike from runtime-config (existing); slugify/uniqueSlug existing helpers.
