# Process Simulator M2 (Companion Doc) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The process-simulator companion-doc format per spec `docs/superpowers/specs/2026-09-04-process-simulator-design.md` §6 — binding rulings there; grammar finalized against the REAL shipped schema. Suite baseline: 1298.

**Architecture:** Parser twin #4. EVERY prior twin's review-round regression class is a first-class requirement here, not a hope: duplicate-title errors (both lines), pruning skipped declarations from ALL resolution tables, parser-side checks against POST-escape lengths with line numbers, coerce-never-skip, floors landing a valid draft, single-pass reverse substitution N/A (no formulas), fenced structural sub-lines single-line, ALL doc-authored prose HTML-escaped (standing ruling), serializer-generated template + byte-match drift + guards, BOM/CRLF/smart-quotes.

**Execution notes:** branch `feature/process-doc` off `main`. Same environment/gates/commit rules. TDD. Zero engine-runtime changes.

### Task 1: Parser + serializer + template

`src/lib/engines/process-simulator/companion-doc.ts`: `parseProcessCompanionDoc` / `serializeProcessCompanionDoc` (+ shared ImportIssue import). Grammar per spec §6 (normative example there):
- Top matter: `TITLE:`, `INTRO:`, `OPENING:`, `EXPERTNOTE:` (each single-line, escaped, `<p>`-wrapped where rich); headerColor editor-only (serializer lossy note).
- `ACTION: <Label> (required|distractor[, after: <Label>, <Label>...])` — marker mandatory (missing ⇒ error + coercion by sub-lines: has Outcome ⇒ required else distractor, loud either way); `after:` resolves by REQUIRED-action label case-insensitively (unique-required-labels schema rule backs this); labels containing `,`/`(`/`)` ⇒ parser error + serializer risky-label warning (RISKY set adds `,` and literal `after:`); `after:` naming a distractor ⇒ edge dropped + error; **cycles ⇒ break the edge on the later-numbered line, error naming both actions**; after-entries >6 ⇒ truncated + error.
- Sub-lines inside an ACTION block only: `Outcome:` / `Consequence:` / `Note:` — single-line (multi-paragraph = editor territory, serializer header warning when a config carries it); recognized in any order, each at most once (duplicate ⇒ error, first wins); field-matrix violations coerced + errored (distractor Outcome dropped; missing required Outcome ⇒ flagged placeholder; missing consequence/consequenceNote where required ⇒ flagged placeholders); `#` comment lines skipped INCLUDING in sub-line lookahead (case-format lesson).
- Duplicate action labels: required-vs-required duplicate ⇒ error both lines + second skipped AND pruned (the schema's unique-required-labels rule); distractor duplicates tolerated with warning (schema only requires unique ids).
- Floors: <4 actions or <2 required ⇒ pad with prereq-free REQUIRED placeholders with placeholder Outcome (satisfies matrix + acyclicity); the ≥1-illegally-attemptable rule floored by a flagged placeholder distractor when needed; all with errors.
- Caps parser-side with line numbers vs POST-escape lengths (labels 200, outcome/consequence 1500 incl. `<p>` wrap + entity growth, note 300, actions 24, after 6).
- Serializer: full grammar; `after:` emits labels; escapes/unescapes symmetric; lossy header notes (headerColor, multi-paragraph rich fields); round-trip contract (blank starter + a max-feature config; byte-stable on second serialize; structural equality via labels over the representable set stated in the test-file header).
- Template `public/companion-doc-process-template.txt`: serializer-generated + `#` instructions; byte-match drift, parse-clean (zero errors AND warnings), validates, no en/em dashes, absent from engines.manifest.json.
- `tests/process-companion-doc.test.ts` mirroring `tests/case-companion-doc.test.ts`'s shape INCLUDING its review-round regression classes (empty-cell analog N/A — no tables; but: `Consequence:` text containing a colon-word; `- ` lines (no meaning here — body-free format: any non-directive non-sub-line line inside an ACTION block ⇒ unknown-line error? RULING: error, line skipped — this format has no free bodies, unlike case); seeded 5-flaw line numbers; every coercion branch; cycle-break; floor recipes).

Commit `feat: process-simulator companion-doc format (parser, serializer, template)`.

### Task 2: Editor wiring + E2E

Shared ImportPanel into `process-editor.tsx` (heading-bearing card — h2 before report h3), `templateHref`, confirm-replace text, importGeneration keys on the Actions section. Browser E2E: import the spec §6 normative example → clean report → play (premature click → consequence) → export 200 scan-clean; flawed doc (cycle + missing marker + after-names-distractor) → line-numbered report, draft editable + Issues panel consistent. Full gates + build. Commit `feat: process companion-doc import/copy in the editor`.
