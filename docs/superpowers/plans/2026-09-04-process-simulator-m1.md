# Process Simulator M1 (Engine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Engine 4 per spec `docs/superpowers/specs/2026-09-04-process-simulator-design.md` — M1 scope (§2–§5, §8, §9-M1). NO companion doc (M2), NO exemplar (M3).

**Architecture:** Fourth engine on the case-workspace blueprint (its M1 is the closest sibling — copy its structure, not its semantics). Shared helpers COPIED; three shipped bundles byte-untouched. One instrument change: a text-carrier class for situation-log entries (own commit).

**Registration table (spec §8 — every point a fourth engine touches; nothing discovered at E2E time):**
`src/lib/engines/process-simulator/{schema,scoring,state,rename,starters,runtime-config}.ts` · `src/engine-runtime/process-simulator/{main.ts,engine.css,preview.html(byte-copy)}` · `scripts/build-engines.mjs` ENGINES entry (+ stale "third engine" comment sweep) · committed `public/engines/process-simulator/**` + manifest · `src/lib/engines/dispatch.ts` adapter · `src/app/interactives/[id]/editor.tsx` dispatcher case · **`src/app/interactives/[id]/page.tsx` initialConfig branch** (engine-3's missed branch) · new `process-editor.tsx` · `src/lib/a11y/transcript.ts` carrier class + doc comment · `scripts/emit-nvda-script.mjs` fourth generator + NVDA_STATE_WORD (disabled→"unavailable") + regenerate ALL FOUR docs + stale "both docs" comment · `tests/multi-engine.test.ts` fourth id + adapter/validate/richText/golden/zip tests · `tests/axe.test.ts` fourth starter loop + per-state cases · `tests/contrast-pairs.test.ts` fourth hex-allowlist block · new tests: `process-{schema,scoring,state,runtime,rename,starters}.test.ts` + `sr-transcript-process.test.ts` · README (+ stale test-count sweep).

**Execution notes:** branch `feature/process-sim` off `main`. Working dir `C:\Users\tamar\Vercel SCORM Builder Interactive Lessons` (quote). PowerShell 5.1 (no `&&`). Suite baseline 1098. TDD. Gates per commit: npm test (exact count), tsc, eslint (+ build when app code changes; build:engines x2 deterministic when runtime changes, three shipped bundles byte-identical asserted via git diff). Commits + trailer as always.

---

### Task 1: Schema + scoring + state + rename + starters (pure modules, TDD, one agent, four commits)

Read spec §2/§4 VERBATIM + the case siblings (`case-workspace/{schema,scoring,state,rename,starters}.ts`) for structure. Highlights the spec mandates: conjunctive requires (`[] `invalid via min 1), acyclic topological validation, requires-only-required, unique required labels case-insensitive, field matrix both directions, the ≥1-illegally-attemptable hard rule; scoring with saturate-at-99-at-increment counters + the locked degenerate fixtures (57 / 96 / 100 / the 60-floor extreme / a rounding-boundary case); state with the `at` payload (required AND distractor attempts), topological-replay restore, ALL §4 rejection rows (duplicates in done, at-on-prereq-free-required, non-integer counts, debrief-without-completion, non-debrief-with-completion), payload worst-case length asserted; rename.ts (renameActionId + removeActionReferences incl. requires arrays); blank starter WITH one prerequisite edge + 1 distractor (the gradeable shape), validates. Suspend-preserves-efficiency test (grade identical with/without mid-run suspend).

### Task 2: Transcript carrier (OWN COMMIT)

`transcript.ts`: register the situation-log entry class (per-`<li>` granularity per spec §3) + doc-comment update. Full suite green; both existing engines' locked transcripts byte-identical.

### Task 3: Runtime (TDD against transcripts)

Read spec §3/§4 VERBATIM + `case-workspace/main.ts` END TO END + its engine.css. The spec's focus contract is exact: success → Situation h3 (tabIndex -1); failure → consequence panel replaces ONLY the Actions sub-container (Situation + progress persist), focus to its h3, Continue rebuilds menu + refocuses attempted button BY ID; mount/restore never move focus; debrief h2 on completion transition. Live region created OUTSIDE swapped containers, churn-guarded, progress-semantic only (text unchanged across consequence open/Continue — asserted). Situation log per-entry carriers + non-color latest-emphasis (weight + approved-hex left rule + sr-only "Latest:"). Debrief: result card, score line exact format from spec, full log read-back, step review on the three palettes, expertNote, Start over. SCORM sequence + copied salvage. engine.css ported (zero new hex — fourth contrast-pairs block enforces). build-engines entry; preview.html byte-copy; rebuild x2; three shipped bundles untouched (git diff assert). Tests: `process-runtime.test.ts` (flow, focus contract incl. success path, scoring integration, SCORM mock sequence, suspend mid-procedure AND mid-consequence, salvage, 99-saturation through UI clicks) + `sr-transcript-process.test.ts` (locked transcripts: menu with a disabled done-button in reading order, consequence open with Situation still present, debrief with log read-back; ONE-live-region contract) + axe per state.

### Task 4: Editor + wiring

dispatch adapter (all fields; richTextValues = intro/opening/expertNote/outcomes/consequences), editor.tsx case, **page.tsx branch**, `process-editor.tsx` per spec §5 (matrix-driven conditional fields with inline hints; prerequisite checkbox list over other REQUIRED actions' labels; required→distractor toggle cascade: prune inbound requires, keep orphaned text, Issues errors, never brick; scoring-consequence line; advisories). multi-engine fourth id + tests + golden path + zip <40KB. Browser E2E: author a 4-action procedure from blank (incl. toggling one action required→distractor and back), play with deliberate mistakes (premature click → consequence → try again), verify debrief accounting matches hand-count, export 200 scan-clean + unzip verify. Stop server.

### Task 5: A11y closure + final verification

NVDA: fourth generator + NVDA_STATE_WORD (disabled→"unavailable") + regenerate ALL four docs (existing three should differ ONLY where "disabled" became "unavailable" — list the diffs) + stale-comment sweep (emit-nvda "both docs", build-engines "third engine"). Fourth axe starter loop. Fourth contrast-pairs hex-allowlist block. README paragraph + stale test-count sweep. Full gates + build x2 + shipped-bundle isolation + `git diff main -- public/engines/branching-scenario public/engines/param-sandbox public/engines/case-workspace` EMPTY. DO NOT merge — review first.

## Post-plan self-review

Spec §2→T1, §4→T1+T3, §3→T3, §5→T4, §8 registration table→plan header + T2-T5, §9-M1 distributed; M2/M3 excluded. No placeholders (spec sections are normative; siblings named). Names consistent: processConfigSchema/validateProcessConfig, `at` payload field, renameActionId/removeActionReferences.
