# Exemplar Library: Design Spec

**Date:** 2026-08-28
**Status:** Draft for Tamara's review
**Depends on:** Runtime visual pass (merged 2026-08-28, 582 tests)
**Sequencing (Tamara's ruling):** exemplar library → engines 3–4 → platform phase last.

## 1. Purpose

Turn the two proof-demos into a **library of six pedagogically serious exemplars** that does three jobs at once:

1. **Stress-test authoring** the way a real designer would — every exemplar is built through the app's own paths (editor, companion-doc import, export gate), so friction surfaces now, cheaply.
2. **Stakeholder portfolio** — real-feeling interactives across five disciplines that Tamara can show faculty and leadership.
3. **Starter-template library** — each exemplar ships as a committed, versioned starter in the New Interactive flow, so every future designer starts from a strong pattern and adapts it in the same flexible editor. Exemplars are pure JSON configs: they prove the flexible system, they never become features. Zero new executable code.

Content is drafted by the agent from discipline knowledge and cross-institutional patterns of what online courses need (Tamara's ruling 2026-08-28); Tamara reviews each exemplar like a faculty deliverable. The library also becomes the quality bar the CreateAI seam is later judged against.

The one feature in this sprint: the **sandbox companion-doc format** (§5) — the known authoring gap — built first, then exercised by authoring both sandbox exemplars through it.

## 2. The library (six exemplars)

Selection logic: the highest-demand interactive shapes across online programs are decision-under-uncertainty scenarios, relationship-discovery sandboxes, and applied-ethics branching; disciplines chosen for enrollment weight and portfolio breadth.

### The arc — one scenario world across three modules (branching ×3)

World: **"Sierra Vista Unified"**, a public school district; course pattern: education leadership. Three *separate* SCORM packages (independent grade objects) sharing the world, its named characters, and consequences that reference each other narratively — demonstrating how one engine scales from intro to capstone across a course:

1. **The Budget Cut** (early-module shape): 4 scenes, ONE visible variable (Board confidence). A mid-year 3% cut must land somewhere; every option harms someone. Teaches the base pattern: choice → quality → consequence.
2. **The Community Meeting** (mid-module shape): 5–6 scenes, TWO variables in tension (Community trust vs. District compliance), at least one conditional choice that unlocks only if trust was managed well. The world remembers module 1 (the cut is the meeting's subject).
3. **The Crisis** (capstone shape): 7–8 scenes, three variables, conditional paths, 3+ endings ranked by quality, debrief that reads like a leadership after-action review. Full engine expressiveness.

Each arc package's companion doc is committed alongside it (via "Copy as companion doc") — the arc doubles as format documentation faculty can imitate.

### Standalones

4. **Plea Bargain** (branching, criminal justice — the flagship discipline): defense attorney advising a client on a plea offer against trial risk; variables Client trust and Case strength; no comfortable path — quality rewards process integrity (informed consent, disclosure) over outcome luck. The **Canvas-review zip** uses a scene header image (exercises the image-header + alt-policy path); the **committed starter ships image-less** with an authoring note where the image goes (Tamara's ruling 2026-08-28 — starters are pure config, assets are per-project uploads, and a dangling asset id would fail at export; designers adapting the starter upload their own image, which is the intended flow anyway). The image itself is an authored abstract/typographic composition rasterized to PNG (no third-party rights; the asset pipeline accepts only PNG/JPEG/WebP — SVG is excluded in v1), provenance noted in the content brief; its alt text is drafted by the agent and **accepted by Tamara as author-of-record** per the alt policy before the zip is delivered.
5. **Dose-Response** (sandbox, nursing/pharmacology): inputs dose, dosing interval, patient weight; outputs peak/trough concentration via one-compartment half-life math (dimensionally correct, sourced); chart concentration vs. interval; **3–4 challenges** (therapeutic floor, toxicity ceiling, an interval-reasoning challenge) so the SCORM score has a saner scale than 0/50/100 (sandbox grading = challenges-met ÷ total). The learner-visible intro MUST carry an "educational model — not clinical guidance" statement; this is a content requirement, not boilerplate. Authored **through the sandbox companion doc** (§5).
6. **Break-Even Studio** (sandbox, business): inputs price, unit variable cost, fixed costs, projected volume; outputs contribution margin, break-even units, profit; chart profit vs. volume; **3–4 challenges** forcing price-vs-volume reasoning (e.g., reach profitability without exceeding a market-realistic price). Also authored through the companion doc.

### Content quality bar (every exemplar)

- A stated learning objective in the intro (visible to the learner, plain language).
- Branching: every choice quality (best/ok/poor) defensible in one sentence a SME would accept; feedback teaches the principle, never a gotcha; endings differ in substance, not just tone.
- Sandbox: formulas dimensionally correct with a citable source noted in the spec-side content brief; every challenge reachable within input ranges (proven by test); units on every input/output.
- All images non-decorative get human-quality alt — drafted by the agent, **accepted by Tamara as author-of-record** (the alt policy's human-acceptance step, made explicit; a short alt policy doc lands in `docs/exemplars/` this sprint since no standalone policy file exists yet).
- WCAG coverage is an explicit task, not assumed: the existing axe/transcript suites are hardcoded to the buoyancy/jury starters, so they are generalized to iterate ALL starters (or the plan names bespoke coverage per exemplar).
- **Content briefs live in `docs/exemplars/`** — one per exemplar: learning objective, discipline pattern it demonstrates, cited formula/scenario sources, image provenance, and the SME-defensibility line for each choice quality. The committed companion docs live there too.
- Tamara reviews each exemplar in Canvas before it graduates to "starter" status.

## 3. Delivery

- **Committed starters:** each exemplar lands in the engine's starter list (`starter-configs.ts` / `starters.ts`) with a one-line description of the pattern it teaches ("Two variables in tension, conditional choices"). Plea Bargain's starter is image-less per §2. The New Interactive picker grows from 2 to ~5 starters per engine. Picker shape decided at plan time, with the review's constraint named: today's native `<select>` exposes descriptions only via mouse-hover `title` tooltips (keyboard/SR-invisible — arguably already a WCAG gap), and "a flat list with descriptions" means a radio-group swap (the engine-card radio pattern in the same form is the in-repo precedent), not a tweak; `StarterMeta` gains a grouping/description field either way.
- **Verified zips:** every exemplar exported through the real route, independently verified (hashes vs. manifest, fresh SCORM identity), delivered to Downloads for Tamara's Canvas review.
- **Companion docs:** committed for all four branching exemplars (the arc's three + Plea Bargain) and both sandbox exemplars (post-§5), as faculty-facing format documentation.
- Starters are config-only data: validated against schemas in tests like today's starters (drift = build failure).

## 4. The arc principle (documented, not mechanized)

Cross-module "building" is narrative and pedagogical, not technical: SCORM packages stay independent SCOs with independent grades and suspend state. In Canvas that means **three separate uploads and three gradebook columns** — faculty weight them in their grading scheme; there is no cross-package rollup, and the spec says so up front so review expectations are set. The arc's continuity lives in the shared world, recurring characters, escalating variable count, and later scenes referencing earlier events in text. A short authoring note ("Designing arcs") is added to the companion-doc template's comment header so faculty can imitate the pattern. No new schema fields, no cross-package state.

## 5. Sandbox companion-doc format (the sprint's one feature)

The deterministic twin of the branching format, for the Parameter Sandbox — same doctrine: line-based, names-not-ids, never-throws parser returning `{ config, report: ImportIssue[] }`, config re-validated by the existing schema (double gate), serializer for round-trip, same editor disclosure UI (Import textarea + confirm-replace + line-numbered report + "Copy as companion doc" + template download), Word-friendly tolerances (CRLF, smart quotes, dash variants, **and the leading UTF-8 BOM** — inherit the branching parser's load-bearing `\s*` absorption verbatim). Grammar below is grounded in the REAL schema (adversarial review 2026-08-28): challenges are structured comparisons (`gte`/`lte`/`between`), NOT formula expressions — the interpreter has no comparison operators. Example is normative:

```
TITLE: Break-Even Studio
INTRO: Set a price and see when the venture stops losing money.

INPUT: Price (slider, $, 5 to 60, step 1, start 20)
INPUT: Unit cost (slider, $, 1 to 40, step 1, start 12)
INPUT: Fixed costs (slider, $, 1000 to 50000, step 500, start 12000)
INPUT: Volume (slider, units, 0 to 10000, step 100, start 2000)

OUTPUT: Contribution margin ($, 2 decimals) = Price - Unit cost
OUTPUT: Break-even units (units, 0 decimals) = Fixed costs / (Price - Unit cost)
OUTPUT: Profit ($, 2 decimals) = (Price - Unit cost) * Volume - Fixed costs

CHART: Profit vs Volume (40 samples, titled Profit against sales volume)

CHALLENGE: Reach a profit of at least $1 -> Profit at least 1
CHALLENGE: Break even at 3000 units or fewer -> Break-even units at most 3000
```

**Rules:**
- Directives: `TITLE:`, `INTRO:`, `INPUT:`, `OUTPUT:`, `CHART:`, `CHALLENGE:`. Unknown directive → error, line skipped (same contract as branching). `INTRO:` is plain text; the parser wraps it as a single `<p>…</p>` (the schema field is rich text), sanitized like all authored text.
- `INPUT: <Label> (slider|number, <units>, <min> to <max>, step <step>, start <default>)` or `INPUT: <Label> (select[, <units>]: <opt>=<value>, <opt>=<value>*, ...)` — the `*` marks the default option (absent → first option). `toggle` inputs are editor-only: a `toggle` keyword in a doc → line-numbered error naming it editor-only, input skipped. Placement defaults to Panel (placement/layout stay editor-side — spatial authoring is not a text concern; the serializer notes dropped placements in a header comment, branching-style documented lossiness).
- `OUTPUT: <Label> (<units>[, <n> decimals]) = <formula>` — decimals optional (absent → full precision). **Formula identifiers resolve against labels first** (case-insensitive; the normative example writes `Price - Unit cost`), falling back to raw slugified ids — ids are collision-suffixed and 32-char-truncated, so doc authors cannot reliably predict them; labels are the format's actual names-not-ids contract. Ambiguous or unresolvable identifier → line-numbered error, output imported with formula `0` and flagged. Formulas are validated by the existing no-eval interpreter at import. Labels that collide with the interpreter's reserved constants (`pi`, `e`) → error, renamed-with-suffix on import.
- `CHART: <Output label> vs <Input label> [(<N> samples[, titled <text>])]` — samples default 40 (schema requires a value; the default is reported as an info-level note, not silently), title defaults to "<Output label> vs <Input label>". Unresolved labels → error, chart skipped.
- `CHALLENGE: <Learner-facing text> -> <Output label> at least <n> | at most <n> | between <n> and <m>` — mirrors the branching format's proven condition grammar and maps 1:1 to the schema's `gte`/`lte`/`between` comparators. `>`/`<` in the condition position → error naming the supported phrases (strict inequalities don't exist in the schema; silent coercion would shift pedagogy at the boundary). Unresolved output label → error, challenge skipped (a broken challenge must never block completion silently).
- **Floor:** a doc yielding zero valid outputs (or zero valid inputs) still lands an editable draft — the parser synthesizes a flagged placeholder ("Imported output", formula `0`) because the schema requires min 1 of each; the report says exactly why.
- **Label escaping (documented lossiness, branching-style):** labels containing `(`, `=`, `->`, or the token ` vs ` parse wrong by design; the serializer emits a header-comment warning when a config's labels contain them, and the module's doc-comment names the full list (mirror `companion-doc.ts`'s DEST_PREFIX_RE precedent).
- Names → ids via existing slugify; caps per schema; visual-state image layers are editor-only (out of the text format by design — they require uploads).
- **Round-trip contract:** serialize→parse→validate on the buoyancy starter and both new exemplars, compared structurally over the representable field set via labels (titles/labels/units/ranges/steps/defaults/formulas/decimals/chart axes+samples+title/challenge triples) — ids may differ; editor-only fields (placement, layout, visual states, toggle inputs) are the documented lossy set.
- Module: `src/lib/engines/param-sandbox/companion-doc.ts` (pure, light); tests mirror the branching suite: normative example parses clean, positive+negative per rule, round-trip per the contract above, seeded-flaws report completeness, template file parse-clean drift test. The committed template (`public/companion-doc-sandbox-template.txt`) is generated from a real config via `serializeCompanionDoc` (spelling correct by construction) and inherits the existing template's guards: no en/em dashes, never appears in `public/engines/engines.manifest.json`.

## 6. Testing / acceptance

- All existing tests stay green EXCEPT the two starter-inventory assertions (`starter-configs.test.ts` / `branching-starters.test.ts` hardcode `["blank","buoyancy"]` / `["blank","jury"]`), which are deliberately updated — restructured to assert invariants over the full starter set rather than exact lists. Engine runtimes untouched (zero `public/engines` diff — confirmed feasible: starters never feed the bundle build).
- New: sandbox companion-doc suite (§5); starter-validation tests extended to all new starters (validate + export-scan clean + zip <40KB each); challenge-reachability per sandbox exemplar via **committed witness vectors** — each challenge ships a known-good input assignment in the content brief, and the test verifies it through the real interpreter's chained evaluation order (catching per-point `FormulaError` — e.g. Break-Even's division by zero at price = unit cost), which is exact and cheap where a grid search over the input ranges would be ~10⁷ evaluations; branching exemplars pass graph validation by construction (schema gate).
- Editor E2E: import the Break-Even doc into a blank sandbox interactive → playable preview → export scans clean.
- Acceptance (Tamara's bar): six exemplars she would show a dean; each opens as an editable starter; the two sandbox exemplars demonstrably authored via companion doc; Canvas spot-check of at least the arc's module 3 and one sandbox exemplar.

## 7. Out of scope

Engines 3–4 (next milestone). Platform phase (last). AI drafting (CreateAI seam unchanged). Visual-state image layers in the text format. Cross-package state sharing. Localization. .docx upload.
