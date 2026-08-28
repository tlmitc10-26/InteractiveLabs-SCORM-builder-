# Runtime Visual Design Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise both runtimes to the mockup's visual bar — presentation only — per spec `docs/superpowers/specs/2026-08-27-runtime-visual-design.md`; the NORMATIVE design source is `docs/superpowers/specs/mock-runtime-visual.html` (Tamara-approved, including the brand-band header rule: exact `--rds-primary` band + gold rule when no image, uploaded image as header otherwise, never gradients).

**Architecture:** New consumed tokens (spacing/radius/elevation/motion) flow through the existing drift-guarded emitters. Runtime changes are DOM garnish (aria-hidden markers/chips/nodes) + engine.css rewrites lifted from the mock's exact values. Every a11y gate (transcripts, axe, contrast math, focus order, reduced-motion) must stay green; transcript diffs only where deliberate and reviewed. One approved editor touch: the scenario-level header-color token select.

**Tech Stack:** existing only. Package budget: each engine zip < 40KB.

**Execution notes:** branch `feature/visual-pass` off `main`. Working dir `C:\Users\tamar\Vercel SCORM Builder Interactive Lessons` (quote). PowerShell 5.1 (no `&&`). Suite: 543 green. Every task: full gates + build:engines x2 deterministic when engine sources change + rebuilt artifacts committed. Commits end blank line + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. READ the mock file and the current engine sources before each task — the mock's CSS values are the design; transplant them into the token-driven engine.css idiom (mock hardcodes some values for standalone rendering; the shipped CSS uses the tokens from Task 1).

---

## File Map

```
src/lib/design/tokens.json + tokens.ts + scripts/build-engines.mjs   # Task 1: new consumed tokens (both emitters, lockstep)
tests/design-tokens.test.ts + tests/engine-build-drift.test.ts        # Task 1
src/lib/engines/branching-scenario/schema.ts                          # Task 2: optional headerColor (token-name enum)
src/lib/engines/branching-scenario/runtime-config.ts                  # Task 2: pass-through
src/engine-runtime/branching-scenario/{main.ts,engine.css}            # Task 2: the main visual event
src/app/interactives/[id]/branching-editor.tsx                        # Task 2: ONE SelectField (header color)
src/engine-runtime/param-sandbox/{main.ts,engine.css}                 # Task 3: polish
tests/{branching-runtime,engine-runtime,sr-transcript*,axe,contrast-pairs(new)}.test.ts  # Tasks 2-4
docs/a11y/* (regenerated)                                             # Task 4
README.md                                                             # Task 5
```

---

### Task 1: Consumed tokens

`tokens.json` gains: `"space": {"1":"4px","2":"8px","3":"12px","4":"16px","5":"24px","6":"32px"}`, `"radius"` gains `"chip":"999px"`, new `"elevation": {"card":"0 1px 3px rgba(25,25,25,.08), 0 4px 14px rgba(25,25,25,.06)"}`, new `"motion": {"fast":"150ms"}`. Emit in BOTH `emitEngineTokensCss` (as `--sp-1..6`, `--radius-chip`, `--elev-card`, `--motion-fast`; `--radius-card` already exists) and the mjs twin — lockstep, drift-tested. `emitAppThemeCss` gains the same custom properties (app may use them later; harmless). Update tests/design-tokens.test.ts expectations + rebuild engines (x2). These tokens are consumed by Tasks 2–3 — the drift test makes them load-bearing immediately after. Commit `feat: spacing/elevation/motion design tokens (consumed by the visual pass)`.

### Task 2: Branching Scenario visual event

**Schema (small):** `headerColor: z.enum([...the 16 token names]).optional()` on branchingConfigSchema (build the enum from RDS_COLOR_NAMES via `z.enum(RDS_COLOR_NAMES as [TokenName, ...TokenName[]])` — schema already imports tokens helpers? It imports sanitize only; import RDS_COLOR_NAMES from `@/lib/design/tokens`); runtime-config passes it through; serializer/companion-doc ignore it (absent = default; add a parser round-trip guard test that an imported doc simply has no headerColor). Editor: ONE SelectField "Header color (when no scene image)" in ScenarioSection listing the 16 tokens, default primary — the milestone's sole editor change.

**Runtime (main.ts) DOM garnish — transcript-invisible by construction (aria-hidden or plain containers):**
- Scene card wrapper `.ilb-scene-card`; header = scene image (existing) OR `.ilb-brand-band` div (background `var(--rds-<headerColor||primary>)`, gold bottom rule).
- Role line → `.ilb-role-line` (bar span aria-hidden + text as today).
- Variables status: keep the ONE live-region text node EXACTLY as-is (id/behavior untouched); ADD per-variable `.ilb-meter-chip` visuals (aria-hidden wrapper containing label/value/track-fill spans) rendered from the same values, churn-guarded via existing setText/setAttr on width style (only when changed). NOTE: the live region text remains the single announced source; the chips are `aria-hidden="true"` wholesale.
- Choices: buttons gain `.ilb-choice-card` styling + an aria-hidden `.ilb-choice-marker` span (A/B/C by index) BEFORE the label text node. Transcript name must remain exactly the label — verify computeAccessibleName ignores the aria-hidden marker (it does; test asserts unchanged names).
- Feedback panel: `.ilb-feedback` restyle + aria-hidden glyph span; Continue gets `.ilb-btn-pill` styling. aria-describedby unchanged.
- Ending: `.ilb-result-head` (eyebrow "Scenario complete" — NEW visible text: transcript/reading-order tests update deliberately; NVDA doc regen will include it), score numeral markup (aria-hidden big numeral + the existing score-line TEXT stays the announced content — wrap: keep the current `.ilb-score-line` paragraph verbatim for SRs (sr-only? NO — keep it visible as the accessible summary BELOW the numeral, styled small; numeral aria-hidden), quality chips (`.ilb-qchip best|ok|poor` — text content as today's breakdown, one chip per nonzero category; these REPLACE part of the score-line presentation — careful: keep announced text semantics equal to today's contract or update contract deliberately with justification).
- Debrief `<ol>` → `.ilb-timeline` with aria-hidden `.ilb-tnode` markers; step content structure/classes per mock (`where/chose/qual/fb/others`); reading order/text unchanged from contract except class names (transcript reads text, not classes — expect zero transcript diffs here).
- Scene transition: 150ms fade/rise via a re-applied `.ilb-enter` class; `@media (prefers-reduced-motion: reduce)` kills it; focus behavior untouched.

**engine.css:** rewrite onto the mock's values via tokens (`--sp-*`, `--elev-card`, `--radius-*`, `--motion-fast`). Every NEW color pair in tests (Task 4). Keep all existing a11y rules.

**Tests:** update branching-runtime/sr-transcript-branching/axe expectations DELIBERATELY (list every transcript diff in the commit message body — expected: the ending eyebrow text; choice names unchanged; live regions unchanged count/text). Verify suspend/scoring/SCORM tests untouched-green. Rebuild x2, zip budget check (<40KB), commit `feat: branching scenario visual pass (brand headers, decision cards, result timeline)`.

### Task 3: Sandbox polish

engine.css: panel elevation + small-caps section labels (style the existing h2s via a class — do NOT change heading text), styled range track/thumb (::-webkit-slider-thumb/-moz-range-thumb, token colors, ≥24px thumb, focus ring preserved), output card typography (value Georgia 26px primary + unit muted — classes exist; restyle), challenge rows as chips, score strip → `.ilb-score-banner` (neutral / `.complete` success — both pairs contrast-tested), stage/panel radius+spacing from tokens. main.ts: chart gains gridlines (`--rds-light-3` hex constant in ILB_CHART_COLORS) + area fill (primary at 8% via globalAlpha) — extend chartLayout consts; drawChart only. Tests: css-text assertions for reduced-motion/focus survive; chart tests green; axe suite green. Rebuild x2, commit `feat: parameter sandbox visual polish`.

### Task 4: Verification layer

- NEW `tests/contrast-pairs.test.ts`: every color pair introduced by the pass asserted ≥ threshold via the contrast module (qchip text/bg/border trios: success #446d12 on #f2f7ec; #7a5a00 on #fff8e1; #8b1f1f on #fbeeee; banner pairs; marker circle text; meter values; eyebrow #747474 on white ≥4.5 for small text? — eyebrow is bold 13px = small text → needs 4.5: #747474=4.6 ✓; assert ALL).
- Transcript re-lock: run and update sr-transcript tests; regenerate NVDA docs (`npm run a11y:script`) — diff must contain ONLY the deliberate changes listed in Task 2; commit regenerated docs.
- Reduced-motion: css-text assertions for the new transition rules being neutralized.
- axe: full suite over restyled states (existing cases suffice; add ending-with-chips case if not covered).
Commit `test: contrast pairs, transcript re-lock, NVDA regen for the visual pass`.

### Task 5: Final verification + delivery

Full gates (npm test — report count, tsc, eslint ., build, build:engines x2). Browser side-by-side: shipped runtime vs `mock-runtime-visual.html` — state-by-state DOM/computed-style comparison (band color rgb(140,29,64), gold rule, card shadows, choice-card borders/hover, timeline nodes, banner states); zip budget (<40KB each) verified; fresh demo zips BOTH engines → Downloads (`InteractiveLabs-Jury-Deliberation-v2-scorm12.zip` fresh identity, and a sandbox zip only if its visuals changed the runtime — they did → `InteractiveLabs-Buoyancy-Lab-v5-scorm12.zip` fresh identity) — independently verified (hash vs manifest, title/identifier) BEFORE reporting. README one-paragraph note. Merge --no-ff ("Merge feature/visual-pass: runtime visual design pass"), push, delete branch, verify sync.

## Post-plan self-review (author ran this)

- **Spec coverage:** §2 scene card/header rule/meters/choice cards/feedback/transitions/ending+debrief → T2; §3 sandbox → T3; §4 tokens → T1; §5 unchanged-guarantees → enforced via T2's transcript-diff discipline + T4; §6 testing → T4/T5; headerColor editor select = sole editor change (spec §2 amendment) → T2.
- **Placeholders:** none — the mock file carries the exact design values; tasks name their transplant targets precisely.
- **Type consistency:** token names (T1) consumed by T2/T3 CSS; headerColor enum from RDS_COLOR_NAMES; ILB_CHART_COLORS extension named consistently.
