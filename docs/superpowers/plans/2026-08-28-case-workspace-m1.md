# Case Workspace M1 (Engine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Engine 3 (Case/Evidence Workspace) per spec `docs/superpowers/specs/2026-08-28-case-workspace-design.md` — M1 scope ONLY (§2–§5, §8, §9-M1): schema, scoring, state, runtime, editor, blank starter, full wiring + a11y. NO companion doc (M2), NO exemplar (M3).

**Architecture:** Fourth… third engine follows the branching blueprint exactly: `src/lib/engines/case-workspace/` (schema/state/runtime-config/starters/rename), `src/engine-runtime/case-workspace/` (main.ts + engine.css copied-and-adapted from branching), adapter in dispatch, editor from the shared kit. Shared helpers are COPIED (salvage ~9 lines) — the two shipped engines' bundles must not re-hash. One deliberate instrument change: transcript.ts gains radio/checkbox checked-state reporting (spec §8).

**Tech Stack:** existing only. Zip <40KB. Suite baseline: 741 green.

**Execution notes:** branch `feature/case-workspace` off `main`. Working dir `C:\Users\tamar\Vercel SCORM Builder Interactive Lessons` (quote). PowerShell 5.1 (no `&&`). Gates every task: npm test (exact count), npx tsc --noEmit, npx eslint ., npm run build when app code changes; `npm run build:engines` x2 deterministic when engine-runtime changes (commit rebuilt `public/engines/case-workspace/**` + manifest; branching/param-sandbox entries byte-identical). READ the spec + the referenced branching sources before each task. Commits: blank line + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. TDD throughout.

---

## File Map

```
src/lib/engines/case-workspace/schema.ts            # T1: caseConfigSchema + validateCaseConfig
src/lib/engines/case-workspace/scoring.ts           # T2: pure integer-arithmetic scoring (spec §4)
src/lib/engines/case-workspace/state.ts             # T2: CaseState, suspend payload, restore
src/lib/engines/case-workspace/runtime-config.ts    # T3: toCaseRuntimeConfig (assetId→url)
src/lib/engines/case-workspace/starters.ts          # T3: blank starter (group "blank")
src/lib/engines/case-workspace/rename.ts            # T3: renameArtifactId/ConclusionId/ReasonId
src/lib/a11y/transcript.ts                          # T4: radio/checkbox checked-state (spec §8, own commit)
src/engine-runtime/case-workspace/{main.ts,engine.css}  # T5: the runtime
scripts/build-engines.mjs                           # T5: third ENGINES entry
src/lib/engines/dispatch.ts                         # T6: caseWorkspaceAdapter
src/app/interactives/[id]/case-editor.tsx           # T6: editor
src/app/interactives/[id]/editor.tsx                # T6: dispatcher case
tests/{case-schema,case-scoring,case-state,case-runtime,sr-transcript-case}.test.ts  # T1-T5 (new)
tests/{axe,multi-engine,sr-transcript*}.test.ts     # T5-T7: extended
scripts/emit-nvda-script.mjs                        # T7: case-engine generator section
docs/a11y/nvda-check-case-workspace.md              # T7 (generated)
```

---

### Task 1: Schema (TDD)

Read spec §2 verbatim + `branching-scenario/schema.ts` (helpers: rich/plain caps, safeId, image matrix, RDS_COLOR_NAMES enum, validate-fn shape returning issues). Build `caseConfigSchema` + `validateCaseConfig` with EVERY §2 validation rule. Tests first: positive/negative per rule (unique ids, map resolution + duplicate pairs, kind-consistency both directions, image matrix, table shape incl. row-length equality + optional caption, flawNote requirement, mode rules incl. exactly-one-full and single-forbids-partial and argument-quality tolerance, unmapped-artifact legality, caps). Commit `feat: case-workspace schema`.

### Task 2: Scoring + state (TDD)

Read spec §4 verbatim + `branching-scenario/state.ts` (restore/salvage patterns). `scoring.ts`: pure functions taking (config, chosenId, includedIds, selectedReasonIds) → `{evidence:{num,den}, reason:{num,den}, credit, totalPct}` — INTEGER arithmetic, `Math.round((100*num)/den)` half-up, single-mode GATE (wrong ⇒ 0), argument-quality renormalization (den 80), defensive denominators documented as out-of-contract. `state.ts`: CaseState {step, caseFile:[[id,strength]], reviewed:Set, chosen?, selectedReasons, bestPct, completed, scoreReported}; `suspendPayload` per §4 (id-based, NO dictionary, `rv` field); `restoreState` validates every id vs config, null on mismatch. Tests: hand-computed fixtures per mode (lock exact pcts incl. a .5 boundary case), misuse floor, empty case file, round-trips at every step, mismatch→null. Commit `feat: case-workspace scoring + state`.

### Task 3: Adapter plumbing (TDD)

`runtime-config.ts` (assetId→url mapping for artifact images, mirror branching's), `starters.ts` (blank: 2 artifacts text-kind minimal, 2 conclusions, valid map — must pass validateCaseConfig; description + group "blank"), `rename.ts` (mirror branching's rename module for artifact/conclusion/reason ids incl. map + payload references). Tests mirror the equivalents. Commit `feat: case-workspace adapter modules`.

### Task 4: Transcript instrument extension (OWN COMMIT, spec §8)

`transcript.ts`: `controlRoleOf` accepts native radio/checkbox inputs; `describeControl` emits checked state (`"checked"|"not checked"`) for both. Tests: new unit cases; CRITICAL: run the full existing suite — both engines' locked transcripts must pass UNCHANGED (they contain no radios; if sandbox checkbox contracts gain state tokens, update those contract assertions deliberately and list them in the commit body). Commit `feat: transcript instrument reports radio/checkbox checked state`.

### Task 5: Runtime (the big one, TDD against transcripts)

Read spec §3+§4 verbatim, `branching-scenario/main.ts` END TO END (mount shape, el/setText helpers, focus mgmt, live-region churn guard, salvage, SCORM sequence, ending card markup), `branching-scenario/engine.css`, `scripts/build-engines.mjs`, `src/engine-runtime/scorm-adapter.ts` (setScore/setCompleted idempotency), `globals.d.ts`.

- `main.ts`: four steps per §3. Copy salvageBestAndCompleted (9 lines, comment its provenance). Radio conclusion cards (native inputs in label cards), reason checkbox group with legend-focus on conclusion change, submit gate (≥1 reason), debrief with the three existing status palettes ONLY, `role="main"`, ONE live region (case-file status only), h2 focus transitions, reduced-motion-safe 150ms enter. SCORM: suspend-only pre-submit; debrief → setScore(bestPct)+setCompleted; Start over never lowers/uncompletes.
- `engine.css`: port branching's (tokens/sr-only/focus/targets/reduced-motion/card/pill/qchip) + case-specific (artifact list, viewer, case-file panel, radio cards via `:checked` styling, comparison lists). ZERO new color pairs (contrast suite proves).
- `build-engines.mjs`: third ENGINES entry (case-workspace 1.0.0). Rebuild x2 deterministic; branching/param-sandbox manifest entries byte-identical (assert via git diff).
- Tests: `case-runtime.test.ts` (flow, scoring integration, SCORM call sequence via mock adapter, suspend/restore/salvage, submit gate, reviewed persistence); `sr-transcript-case.test.ts` (locked reading/focus transcripts per step incl. radio checked states, ONE-live-region contract); extend `axe.test.ts` (per-step cases: text/image/table artifact views, conclude open, debrief) + the generic starter loops pick up the blank starter; `multi-engine.test.ts` invariants gain the third engine id.
Commit `feat: case-workspace runtime (case file, conclude, expert-map debrief)`.

### Task 6: Editor + export wiring

Read `dispatch.ts` (EngineAdapter contract — supply EVERY field), `editor.tsx`, `param-sandbox-editor.tsx` + `editor-shared.tsx` (kit), `new-interactive-form.tsx` (data-driven; verify third engine card renders), export route (engine-agnostic; verify). `caseWorkspaceAdapter` (validate/toRuntimeConfig/collectAssetIds incl. artifact images/richTextValues: intro, artifact bodies, conclusion bodies+rationales/starterConfig/starters). `case-editor.tsx` per spec §5 (sections; credit select hidden in argument-quality; flawNote conditional; expert map artifact-major disclosures; unmapped advisory; mode-consequence line for single). E2E in browser: create from blank, author a two-artifact case, play to debrief in preview, export → 200 scan-clean, unzip + verify. Full gates. Commit `feat: case-workspace editor + export wiring`.

### Task 7: A11y closure + final verification

NVDA generator: case-engine section in `emit-nvda-script.mjs` (bespoke, blank-starter-driven; mirror the two existing generators' structure incl. "should NOT hear" prose); regen docs/a11y. Contrast suite: assert zero new pairs (grep engine.css for hex literals — only token values + the approved palette). Reduced-motion css assertions. Full gates + build x2 + zip <40KB (add to multi-engine budget test) + `git diff main -- public/engines/branching-scenario public/engines/param-sandbox` EMPTY. README paragraph. Commit `feat: case-workspace a11y closure + NVDA script` then `docs: README note for the case workspace engine`. DO NOT merge — final review first.

## Post-plan self-review (author ran this)

- Spec coverage: §2→T1, §4→T2 (+SCORM in T5), §5→T6, §3→T5, §8→T4, §9-M1→T5/T7; blank starter (§5)→T3; M2/M6 grammar + M3 exemplar explicitly excluded.
- Placeholders: none; every task names its normative spec section + real source files to read.
- Type consistency: caseConfigSchema/validateCaseConfig (T1) used T3/T5/T6; scoring signature (T2) consumed T5; CaseState fields match §4 payload; adapter field list matches dispatch contract check in T6.
