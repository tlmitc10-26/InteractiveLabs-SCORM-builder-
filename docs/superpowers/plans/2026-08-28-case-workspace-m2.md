# Case Workspace M2 (Companion Doc) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The case-workspace companion-doc format per spec `docs/superpowers/specs/2026-08-28-case-workspace-design.md` §6 — its hardening rulings are BINDING; the concrete grammar is finalized here against the REAL shipped schema (`src/lib/engines/case-workspace/schema.ts`).

**Architecture:** Third parser/serializer twin. Inherit every hardening lesson the sandbox format learned in its review round (single-pass longest-first title substitution N/A — no formulas — but: duplicate-title errors with both line numbers, pruning of skipped declarations from ALL resolution tables, parser-side range/cap checks with line numbers, coerce-never-skip, floors, BOM `\s*`, HTML-escaped INTRO, serializer emits titles). Editor wiring reuses the shared ImportPanel verbatim.

**Tech Stack:** existing only. Suite baseline: 1010 green. Zero engine-runtime changes (no rebuild).

**Execution notes:** branch `feature/case-doc` off `main`. Working dir `C:\Users\tamar\Vercel SCORM Builder Interactive Lessons` (quote). PowerShell 5.1 (no `&&`). TDD. Commits + trailer as always.

---

### Task 1: Parser + serializer + template (TDD)

`src/lib/engines/case-workspace/companion-doc.ts`: `parseCaseCompanionDoc` / `serializeCaseCompanionDoc`, importing `ImportIssue` type. Grammar (finalized against the real schema; spec §6 rulings verbatim):

- Directives: `TITLE:`, `INTRO:` (plain → HTML-escaped `<p>` wrap), `MODE:` (three mode names; absent ⇒ best-supported + info-as-warning note), `ARTIFACT: <Title> (text|table)` (image kind is editor-only → `(image)` ⇒ line-numbered "editor-only" error, artifact skipped AND pruned), `CONCLUSION: <Label> [(best|defensible|unsupported)]`, `MAP: <Artifact> supports|contradicts <Conclusion> [(strong|weak)]` (strength absent ⇒ weak + note).
- **ARTIFACT block bodies are OPAQUE**: after the ARTIFACT line, optional `Source:` then optional `Caption:` (table only) as the immediately-following lines; thereafter EVERY line until the next block-opening directive (`TITLE|INTRO|MODE|ARTIFACT|CONCLUSION|MAP` at line start, case-insensitive, colon-required) is body content — the unknown-directive scan NEVER runs inside a body ("Subject:", "Alvarez:" lines are content). Table bodies: `|`-rows, first = headers; `|` in cells = documented lossiness; row/header count mismatch ⇒ error + pad/truncate.
- Reason lines: `- <text> (SOUND)` / `- <text> (FLAWED: <note>)` ONLY inside CONCLUSION blocks (marker anchored end-of-line, note = any chars except trailing `)`); missing marker ⇒ error + SOUND; `-` inside ARTIFACT bodies is body content (opaque rule above); conclusion body lines = lines in a CONCLUSION block before its first `-` line, joined as paragraphs (blank-line-separated `<p>`s? — schema `body` is rich ≤2000 and `expertRationale` rich ≤3000: conclusion block plain lines before reasons → body; a `Rationale:` sub-line (after label line, like Source:) starts the expertRationale lines until the first `-`; if no Rationale: line, expertRationale = REQUIRED by schema → floor: synthesized "Expert rationale to be written." + error).
- MODE × credit matrix (spec §6 verbatim): coerce + line-numbered error, never skip; no `(best)` under single/best-supported ⇒ first conclusion coerced full + error; multiple ⇒ first wins rest demoted + error; `(defensible)` under single ⇒ none + error.
- Duplicate artifact/conclusion titles ⇒ error with both line numbers, second skipped + pruned everywhere (MAP resolution must not see it).
- Parser-side checks with line numbers: caps (artifacts ≤16, conclusions ≤6, reasons ≤6 with overflow truncation + error, map ≤96, all text caps), every-conclusion floors (≥2 reasons ⇒ pad with flagged placeholder reasons "Reason to be written" SOUND + error; ≥1 sound ⇒ coerce first to sound + error; ≥1 supports map entry ⇒ synthesize weak supports from first artifact + error), zero-artifacts/conclusions floors (flagged placeholders so the draft lands).
- Serializer: emits full grammar (Source:/Caption:/Rationale:/markers/strengths), titles from config, HTML-unescape intro, `#` header comments for lossy features (image artifacts, headerColor noted as editor-kept? headerColor survives import absence = fine, serializer just omits — no, headerColor is schema-optional: DROP with lossy note) + risky-label warning (`(`, `->`, ` supports `, ` contradicts ` in titles).
- Round-trip contract: serialize→parse→validate on the blank starter + a max-feature fixture; structural equality via titles over the representable set (modes/credits/artifact kinds text+table incl. caption/source/bodies/reasons+flawNotes/map triples+strengths); documented lossy set: image artifacts, headerColor.
- Template `public/companion-doc-case-template.txt`: serializer-generated + `#` instructions (incl. toggle-equivalent notes: image artifacts editor-only, `#` comments, escaping caveats); byte-match drift test + parse-clean (zero errors AND warnings) + no en/em dashes + absent from engines.manifest.json.
- Tests `tests/case-companion-doc.test.ts` mirroring the sandbox suite: normative example (write one — a small 3-artifact/2-conclusion case) clean parse + validate; positive+negative per rule above (esp. opaque bodies with "Subject:"-style lines, `-` in artifact body, Rationale: sub-line, every coercion branch, duplicate titles, pad/truncate rows, floors); seeded 5-flaw line-number test; round-trips.

Commit `feat: case-workspace companion-doc format (parser, serializer, template)`.

### Task 2: Editor wiring + E2E

ImportPanel (shared, generic) into `case-editor.tsx` (same placement pattern as sandbox: in the Case section card WITH a heading — remember the h3 heading-order lesson), `templateHref="/companion-doc-case-template.txt"`, confirm-replace text consistent, importGeneration keys on Artifacts/Conclusions/Map sections' useRowKeys. Browser E2E: import the normative example into a blank case interactive → clean report → sections populate → play to debrief in preview → export 200 scan-clean; flawed doc → line-numbered report, draft editable. Full gates + npm run build. Commit `feat: case companion-doc import/copy in the editor`.

## Post-plan self-review

Spec §6 rulings all mapped (opaque bodies/MODE matrix/- scoping/table rules/coerce-never-skip); Rationale: sub-line is the one grammar addition forced by the real schema (expertRationale required) — direction §6 didn't cover it, resolved here with a floor; no placeholders; names consistent (parseCaseCompanionDoc/serializeCaseCompanionDoc).
