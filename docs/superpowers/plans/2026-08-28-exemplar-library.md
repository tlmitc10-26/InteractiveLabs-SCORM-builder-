# Exemplar Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the six-exemplar library + the sandbox companion-doc format per spec `docs/superpowers/specs/2026-08-28-exemplar-library-design.md` (adversarially hardened 2026-08-28 — its §5 grammar and §2 content briefs are NORMATIVE; read the spec before every task).

**Architecture:** One feature (sandbox companion-doc parser/serializer + shared import UI), one infrastructure upgrade (starter picker + generalized starter test coverage), then content: six exemplar configs authored as data through the app's own paths. Zero engine-runtime changes — `public/engines/**` must show zero diff at the end. Exemplars are pure JSON validated by existing schemas; the two sandbox exemplars are authored THROUGH the new doc format as its stress test.

**Tech Stack:** existing only. Suite baseline: 582 green. Each exemplar zip < 40KB (Plea Bargain's image zip < 40KB total is NOT required — image zips get the existing per-asset caps; assert < 400KB as sanity).

**Execution notes:** branch `feature/exemplar-library` off `main`. Working dir `C:\Users\tamar\Vercel SCORM Builder Interactive Lessons` (quote). PowerShell 5.1 (no `&&`). Gates every task: npm test (report count), npx tsc --noEmit, npx eslint ., npm run build when app code changed. NO `npm run build:engines` needed anywhere (nothing feeds the bundles); final task verifies zero `public/engines` diff. Commits end blank line + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. TDD for Tasks 1–3: test first, watch it fail, implement, watch it pass.

---

## File Map

```
src/lib/engines/param-sandbox/companion-doc.ts        # T1 (new): parser + serializer
tests/sandbox-companion-doc.test.ts                    # T1 (new)
public/companion-doc-sandbox-template.txt              # T1 (new, serializer-generated)
src/app/interactives/[id]/editor-shared.tsx            # T2: shared ImportPanel (extracted from branching-editor)
src/app/interactives/[id]/branching-editor.tsx         # T2: use shared panel
src/app/interactives/[id]/param-sandbox-editor.tsx     # T2: wire panel in
src/lib/engines/dispatch.ts                            # T3: StarterMeta gains description + group
src/app/projects/[id]/new-interactive-form.tsx         # T3: optgroup + visible description
tests/{starter-configs,branching-starters,axe,sr-transcript*}.test.ts  # T3: invariants + iterate ALL starters
docs/exemplars/{alt-policy.md, brief-*.md, *.companion.txt}            # T4-T7: briefs, policy, committed docs
src/lib/engines/branching-scenario/starters.ts         # T5, T6: four new branching starters
src/lib/engines/param-sandbox/starter-configs.ts       # T7: two new sandbox starters
tests/exemplar-content.test.ts                         # T5-T7 (new): validation, witness vectors, doc parity
public/companion-doc-template.txt                      # T5: "Designing arcs" note in comment header
docs/exemplars/assets/plea-bargain-header.png          # T6 (new): authored rights-clean image
README.md                                              # T8
```

---

### Task 1: Sandbox companion-doc parser + serializer (TDD)

**Read first:** spec §5 (the grammar IS the contract — every rule, the floor, escaping, BOM note, round-trip contract); `src/lib/engines/branching-scenario/companion-doc.ts` end to end (inherit its architecture: two-pass line scan, `ImportIssue{line,severity,message}`, never-throws, the `\s*`-BOM absorption comment, documented-lossiness header comments); `src/lib/engines/param-sandbox/schema.ts` (exact field names/caps: inputs `slider|number|toggle|select`, `defaultValue`, select `options[{label,value}]`, outputs `formula/units/decimals`, `chartSchema` incl. required `samples`, challenges `{outputId, comparator:"gte"|"lte"|"between", value?, min?, max?}`, `.min(1)` on inputs/outputs); `src/lib/engines/slugify.ts` (`slugify`/`uniqueSlug`); `src/lib/formula/parser.ts` + `evaluate.ts` (`parseFormula`, `collectIdentifiers`, `FORMULA_CONSTANTS` = `pi`,`e`).

**Create `src/lib/engines/param-sandbox/companion-doc.ts`:**
- `parseSandboxCompanionDoc(text): { config: unknown; report: ImportIssue[] }` and `serializeSandboxCompanionDoc(config: SandboxConfig): string`. Reuse branching's `ImportIssue` type (import it — do not redeclare).
- Directive regexes per spec §5: `TITLE:`, `INTRO:` (wrap parsed text as one sanitized `<p>…</p>`), `INPUT:`, `OUTPUT:`, `CHART:`, `CHALLENGE:`. Unknown directive → error, line skipped. Tolerances: CRLF, smart quotes normalized, `->`/`→` arrows, leading BOM via `\s*` (copy branching's load-bearing comment).
- INPUT: `<Label> (slider|number, <units>, <min> to <max>, step <step>, start <default>)` and `<Label> (select[, <units>]: A=1, B=2*, ...)` — `*` marks default option (absent → first). `toggle` keyword → error "toggle inputs are editor-only", input skipped.
- OUTPUT: `<Label> (<units>[, <n> decimals]) = <formula>`. **Label-first identifier resolution:** build the formula string for the schema by longest-label-first, case-insensitive substitution of known input/output labels with their slugified ids (sort candidate labels by length desc so "Unit cost" wins over "cost"; substitution happens before `parseFormula` validation). Unresolvable identifier after substitution → error, output lands with formula `"0"` and a flag. A label equal to `pi` or `e` (case-insensitive) → error, imported with `_2` suffix.
- CHART: `<Output label> vs <Input label> [(<N> samples[, titled <text>])]` — samples default 40 with an info-level report note ("samples defaulted to 40"), title default `"<Output label> vs <Input label>"`. Unresolved label → error, chart skipped.
- CHALLENGE: `<text> -> <Output label> at least <n> | at most <n> | between <n> and <m>` (case-insensitive keywords; model the regex on branching's `CONDITION_RE`). `>`/`<`/`>=`/`<=` in condition position → error naming the three supported phrases. Unresolved output → error, challenge skipped.
- **Floor:** after parsing, if `inputs.length === 0` push a flagged placeholder slider ("Imported input", 0–10, step 1, start 5); if `outputs.length === 0` push flagged placeholder output ("Imported output", formula `"0"`); report explains why (schema requires ≥1 of each; import must land an editable draft).
- Serializer: emits labels in formulas (reverse id→label map; longest-id-first substitution). Emits ALL representable fields (units, decimals when present, select `*` default, chart samples + titled). Header `#` comments: the lossy-fields note (placement/layout/visual states/toggle inputs) listing any that the config actually used, and a warning listing any label containing `(`, `=`, `->`, or ` vs ` (spec's escaping stance).

**Create `tests/sandbox-companion-doc.test.ts`** (mirror `tests/companion-doc.test.ts` structure):
- [ ] Write tests FIRST covering: spec §5's normative Break-Even example parses with zero errors and validates via `validateSandboxConfig` (import from schema); one positive + one negative case per rule above (incl. `toggle` rejection, `profit > 0` rejection with the naming message, between grammar, select default `*`, samples default info note, decimals round-trip, BOM/CRLF/smart-quote tolerance, label-first resolution where a label contains another label, `pi` label rejection, both floors, unknown directive); seeded 5-flaw doc → exactly 5 issues with correct line numbers; round-trip per spec contract on the buoyancy starter (representable fields equal via labels; `decimals`, select units/default preserved) and structural-equality helper comparing via labels not ids.
- [ ] Run: `npx vitest run tests/sandbox-companion-doc.test.ts` → all FAIL (module missing).
- [ ] Implement the module; run again → PASS.
- [ ] Generate `public/companion-doc-sandbox-template.txt` VIA the serializer from a small instructional config (write a tiny script inline or a test-time snapshot — the committed file must byte-match serializer output in a drift test), prepend `#` instruction comments. Tests: template parses clean; contains no en/em dashes; absent from `public/engines/engines.manifest.json` (mirror `tests/companion-doc.test.ts:1044-1054` guards).
- [ ] Full gates. Commit: `feat: sandbox companion-doc format (parser, serializer, template)`.

### Task 2: Shared import panel + sandbox editor wiring

**Read first:** `branching-editor.tsx`'s ImportPanel (textarea, confirm-replace, line-numbered report with h3 focus, Copy-with-tri-state, template link, importGeneration remount) and `editor-shared.tsx` conventions; spec §5 "same editor disclosure UI".

- [ ] Extract branching's ImportPanel into `editor-shared.tsx` as `ImportPanel` parameterized by: `parse(text) → {config, report}`, `serialize(config) → string`, `templateHref`, `confirmText`, `onApply(config)`. Branching editor uses it with zero behavior change (its tests must stay green unmodified — the extraction is pure).
- [ ] Wire it into `param-sandbox-editor.tsx`'s scenario/setup section with the sandbox parser/serializer and `templateHref="/companion-doc-sandbox-template.txt"`; import lands through the normal draft-save path; `importGeneration`-prefixed keys for row remounts exactly like branching.
- [ ] Browser E2E (dev server via preview): paste the normative Break-Even doc into a blank sandbox interactive → confirm-replace → import report clean → preview plays (sliders move outputs) → export via the real route scans clean. Then a flawed doc → line-numbered report renders, draft still editable.
- [ ] Full gates + `npm run build`. Commit: `feat: sandbox companion-doc import/copy in the editor (shared ImportPanel)`.

### Task 3: Starter infrastructure (picker + generalized coverage)

**Read first:** `src/lib/engines/dispatch.ts` (`StarterMeta`), `src/app/projects/[id]/new-interactive-form.tsx` (the `<select>` at ~:83-88 with title-tooltip descriptions — the WCAG gap named in the spec), `tests/starter-configs.test.ts:7`, `tests/branching-starters.test.ts:8`, `tests/axe.test.ts`, `tests/sr-transcript*.test.ts`.

- [ ] `StarterMeta` gains `description: string` and `group: "blank" | "exemplar"` (existing starters: blank→blank, buoyancy/jury→exemplar with one-line pattern descriptions).
- [ ] Picker: keep the native `<select>`, add `<optgroup label="Start blank">` / `<optgroup label="Exemplars">`, and render the SELECTED starter's description as visible text below the select (a `<p id>` referenced by `aria-describedby` on the select) — kills the hover-only tooltip gap without a control swap. Remove the `title` attr.
- [ ] Restructure the two starter-inventory tests to invariants over the full set: every starter validates via its engine's validate; every starter export-scans clean (existing per-starter checks generalized to iterate); ids unique; every StarterMeta has non-empty description. (Exact-list assertions deleted — deliberate, per spec §6.)
- [ ] Generalize a11y coverage: `tests/axe.test.ts` iterates ALL starters of both engines (mount each config's runtime states it can reach generically: initial state for sandbox; initial scene for branching) instead of only buoyancy/jury; keep the existing deep per-state cases for buoyancy/jury as-is. sr-transcript suites keep their locked buoyancy/jury contracts (bespoke) — new exemplars get reading-order smoke assertions (transcript runs without throwing; no unexpected live regions) via one generic loop.
- [ ] Full gates + build. Commit: `feat: starter groups + accessible picker descriptions + generalized starter coverage`.

### Task 4: Content foundations — `docs/exemplars/`

**Read first:** spec §2 (quality bar + per-exemplar briefs), §4 (arc principle), the alt-policy decisions in memory/spec (decorative/informative matrix, human acceptance).

- [ ] Create `docs/exemplars/alt-policy.md`: the project's image alt policy as practiced — decorative (`alt=""`, no acceptance needed) vs informative (human-authored/accepted alt required; schema enforces non-empty; for agent-drafted images Tamara accepts as author-of-record before delivery); AI-suggest seam noted as future.
- [ ] Write six content briefs `docs/exemplars/brief-<slug>.md`, each: learning objective (learner-visible phrasing), the discipline pattern it demonstrates, full scenario/model content (scene text + choices + qualities with one-line SME defensibility each — the actual scripts, not summaries — or formulas with cited sources and dimensional check), witness vectors per challenge (sandbox briefs: exact input assignments as JSON), image provenance (Plea Bargain only), the educational-not-clinical statement (Dose-Response). Sources: standard textbook-level references (one-compartment PK: Cl, Vd, t½ relations; CVP break-even). These briefs are the single content source Tasks 5–7 transcribe — they must be complete enough that transcription requires zero invention.
- [ ] Commit: `docs: exemplar content briefs + alt policy`.

### Task 5: The arc (three branching exemplars)

**Read first:** brief-budget-cut/community-meeting/crisis briefs (T4), `src/lib/engines/branching-scenario/starters.ts` (jury starter shape), spec §2 arc escalation contract (1 var/4 scenes → 2 vars + conditional → 3 vars/7-8 scenes/3+ endings), §4.

- [ ] Author the three configs in `starters.ts` (STARTER entries with StarterMeta descriptions naming the pattern each teaches), transcribed from the briefs. Escalation contract enforced by test: module 1 exactly 1 variable; module 2 exactly 2 + ≥1 conditional (showIf) choice; module 3 exactly 3 variables and ≥3 endings.
- [ ] Generate + commit companion docs `docs/exemplars/<slug>.companion.txt` via the existing branching `serializeCompanionDoc`; test: each committed doc parses+validates to a config structurally equal (titles/labels/qualities/effects/goTo-by-title) to its starter — parity locked, drift breaks the build.
- [ ] Add the "Designing arcs" note (3–5 lines) to `public/companion-doc-template.txt`'s `#` comment header; its parse-clean test stays green.
- [ ] `tests/exemplar-content.test.ts`: validation + graph gates pass for all three; each has a stated learning objective in intro text (assert the intro mentions it non-empty); zip budget via assemble (<40KB each).
- [ ] Full gates. Commit: `feat: Sierra Vista arc exemplars (three branching starters + companion docs)`.

### Task 6: Plea Bargain (branching + the image path)

**Read first:** brief-plea-bargain (T4), spec §2 item 4 (image-less starter + image-bearing zip, alt author-of-record flow), asset pipeline `src/lib/assets/validate.ts` (PNG/JPEG/WebP only, sharp re-encode).

- [ ] Author the config in `starters.ts` — image-less; the start scene's intro carries a one-line authoring note where the header image goes ("Add a scene image in the editor — see the exemplar brief"). Committed companion doc + parity test like T5.
- [ ] Author `docs/exemplars/assets/plea-bargain-header.png`: an abstract/typographic composition (scales-of-justice geometry in RDS maroon/gold, flat shapes, no text) — build as SVG then rasterize to PNG 1600×700 (16:7 per the header crop) with a local tool (sharp is in node_modules); commit BOTH the SVG source and PNG; provenance line in the brief. Draft alt text in the brief for Tamara's acceptance.
- [ ] Delivery-time flow (executed in T8, verified here in a dry run): upload the PNG through the real asset route into the demo project, set imageAssetId/imageRole=informative/imageAlt on the start scene of a DB copy, export scans clean, image present in zip.
- [ ] Tests: starter validates + scans + zip <40KB; the brief's alt draft is non-empty.
- [ ] Full gates. Commit: `feat: Plea Bargain exemplar (starter + companion doc + authored header image)`.

### Task 7: Sandbox exemplars — authored THROUGH the doc format

**Read first:** briefs for dose-response and break-even (T4, incl. witness vectors + the educational-not-clinical statement), spec §2 items 5–6, §5, §6.

- [ ] Write the two companion docs `docs/exemplars/dose-response.companion.txt` and `break-even-studio.companion.txt` by hand from the briefs (3–4 challenges each; Dose-Response intro carries the educational-not-clinical statement verbatim from the brief).
- [ ] THE STRESS TEST: `tests/exemplar-content.test.ts` parses each committed doc with `parseSandboxCompanionDoc` → asserts ZERO error-severity issues → validates → this parsed config IS the starter (starter-configs.ts entries are generated by transcribing the parse result; a parity test asserts starter ≡ parse(doc) structurally, so the doc remains the source of truth).
- [ ] Witness-vector tests: for each challenge, evaluate the output chain through the real interpreter (`parseFormula`/`evaluateFormula` in declaration order, catching FormulaError per point) at the brief's witness assignment and assert the comparator is satisfied; also assert every witness lies within its input ranges.
- [ ] Dimensional sanity test for Dose-Response: at the witness vector, peak > trough > 0 and units strings present on every input/output.
- [ ] Zip budget (<40KB each) + scan-clean via generalized T3 coverage.
- [ ] Full gates. Commit: `feat: Dose-Response + Break-Even exemplars authored via companion docs`.

### Task 8: Final verification + delivery

- [ ] Full gates: npm test (report exact count), tsc, eslint, `npm run build`. Verify `git status` + `git diff main -- public/engines` show ZERO engine diff.
- [ ] Browser pass: New Interactive picker shows both optgroups with visible descriptions (keyboard through it); create one interactive from each of the six exemplar starters; spot-play the arc's module 3 and Break-Even in preview.
- [ ] Exports via the real route from the demo project: six zips → Downloads as `InteractiveLabs-<Name>-scorm12.zip` (fresh identities). Plea Bargain export = the image-bearing copy (upload PNG per T6 flow, set image fields + accepted-pending alt). INDEPENDENTLY verify every zip (unzip to scratchpad: title, unique identifier, engine hashes vs manifest, image present where expected) BEFORE reporting.
- [ ] README: exemplar-library paragraph. Commit `docs: README note for the exemplar library`.
- [ ] Merge `--no-ff` ("Merge feature/exemplar-library: six exemplars + sandbox companion-doc format"), push, delete branch. Deliver zips via SendUserFile with a review checklist note (Canvas spot-check targets per spec §6; alt-text acceptance ask for Plea Bargain).

## Post-plan self-review (author ran this)

- **Spec coverage:** §1 three jobs → T3 (starters), T8 (portfolio zips), T1-2 (stress-test feature); §2 slate + quality bar → T4-7 (briefs are the bar's enforcement point; objective/SME-line/witness/statement all land in briefs then tests); §3 delivery → T3 + T8; §4 arc → T5 (escalation test + template note + gradebook sentence lives in spec, no code); §5 grammar → T1 rule-by-rule incl. floor/escaping/BOM/round-trip contract/template guards; §6 → T3 (inventory invariants, generalized axe), T7 (witness vectors), T8 (E2E, zero-engine-diff). Out-of-scope §7 respected: no engine/runtime/platform work.
- **Placeholders:** none — grammar and briefs' required contents are enumerated; T4 explicitly requires briefs complete enough for zero-invention transcription (the plan's content quality gate).
- **Type consistency:** `parseSandboxCompanionDoc`/`serializeSandboxCompanionDoc` named consistently T1/T2/T7; `StarterMeta.description/group` consistent T3/T5/T6; `ImportIssue` imported from branching module, not redeclared.
