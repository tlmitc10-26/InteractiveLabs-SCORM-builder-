# Branching Scenario Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Engine #2 — role-based branching scenarios with quality-scored decisions, compounding variables, endings + debrief — plus first-class multi-engine plumbing, per spec `docs/superpowers/specs/2026-08-27-branching-scenario-engine-design.md`.

**Architecture:** Same engine contract as Parameter Sandbox: strict Zod schema (now with graph validation: no authorable dead ends), a pure state machine bundled into a hand-audited runtime, existing SCORM shell/scanner/tokens/a11y machinery unchanged. The pipeline seams that assume `param-sandbox` become engineId-dispatched. Announcement contract designed first (spec §6) and locked via the transcript layer.

**Tech Stack:** existing stack only. No new dependencies.

**Execution notes (every task):** branch `feature/branching-scenario` off `main` before Task 1. Working dir `C:\Users\tamar\Vercel SCORM Builder Interactive Lessons` (quote — spaces). Windows/PowerShell 5.1 (no `&&`). Suite: 303 green; every task ends fully green + `npx tsc --noEmit` + `npx eslint .` clean. Tasks touching `src/engine-runtime/**`, `src/lib/design/**`, or `scripts/build-engines.mjs` run `npm run build:engines` twice (git-stable) and commit rebuilt `public/engines/**`. Commit identity is repo-configured (noreply); messages end with blank line + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Living files carry review fixes — READ before editing; plan code for THEM is a behavior contract, while code for NEW pure modules is verbatim.

---

## File Map

```
src/lib/engines/registry.ts                     # modify: engineById(id) lookup; keep back-compat exports
src/lib/engines/dispatch.ts                     # NEW: validateConfigFor / starterFor / editor metadata by engineId
src/lib/engines/branching-scenario/schema.ts    # NEW: Zod + cross-ref + graph validation (pure)
src/lib/engines/branching-scenario/runtime-config.ts  # NEW: light module — runtime shape + asset resolution + QUALITY_WEIGHTS
src/lib/engines/branching-scenario/state.ts     # NEW: pure state machine (also bundled into the runtime)
src/lib/engines/branching-scenario/starters.ts  # NEW: blank + jury starters (schema-parsed at load)
src/engine-runtime/branching-scenario/main.ts   # NEW: runtime (window.ILBEngine.mount)
src/engine-runtime/branching-scenario/engine.css # NEW: scenario styles on tokens
src/engine-runtime/branching-scenario/preview.html # NEW: same handshake as param-sandbox's
scripts/build-engines.mjs                       # modify: engines list -> two entries
src/lib/export/package.ts                       # modify: assemblePackage takes engineId
src/app/api/interactives/[id]/export/route.ts   # modify: dispatch by interactive.engineId
src/app/actions.ts                              # modify: createInteractive(engine, starter)
src/app/projects/[id]/page.tsx                  # modify: engine+starter picker
src/app/interactives/[id]/page.tsx + editor.tsx # modify: editor.tsx becomes dispatcher
src/app/interactives/[id]/param-sandbox-editor.tsx   # NEW: current editor body moves here (mechanical)
src/app/interactives/[id]/branching-editor.tsx  # NEW: scenario editor
src/lib/a11y/transcript.ts                      # modify: button/img/link mappings as needed
scripts/emit-nvda-script.mjs                    # modify: emits per-engine scripts
tests/: branching-schema, branching-state, branching-runtime, sr-transcript-branching,
        multi-engine (packager/export/golden-jury), + updates to export/engine tests
```

---

### Task 1: Multi-engine plumbing (registry, packager, export route, dispatch)

**Files:** Modify `src/lib/engines/registry.ts`, `src/lib/export/package.ts`, `src/app/api/interactives/[id]/export/route.ts`; Create `src/lib/engines/dispatch.ts`; Test `tests/multi-engine.test.ts` + keep `tests/export-package.test.ts`, `tests/golden-export.test.ts` green.

**Contract:**
1. `registry.ts`: add `export function engineEntry(manifest: EngineManifest, engineId: string) { const e = manifest.engines.find(x => x.id === engineId); if (!e) throw new Error(`engine "${engineId}" not found in engines.manifest.json — run npm run build:engines`); return e; }` — existing exports unchanged.
2. `package.ts`: `AssembleOptions` gains `engineId: string`; `assemblePackage` uses `engineEntry(manifest, opts.engineId)` instead of the hardcoded find; config-shape-specific calls (`toRuntimeConfig`, `collectAssetIds`) move behind a per-engine adapter param: `AssembleOptions` gains `runtime: { toRuntimeConfig(config, urlForAsset): unknown; collectAssetIds(config): string[] }` so package.ts stops importing param-sandbox modules directly. Callers (export route, golden test, demo scripts) supply the param-sandbox implementations; Task 6 adds the branching ones.
3. NEW `src/lib/engines/dispatch.ts` (server-side; may import zod-bearing schemas):
```ts
import { validateSandboxConfig } from "@/lib/engines/param-sandbox/schema";
import * as psRuntime from "@/lib/engines/param-sandbox/runtime-config";

export interface EngineAdapter {
  engineId: string;
  version: string;
  label: string;
  validate(raw: unknown): { ok: true; config: unknown } | { ok: false; errors: string[] };
  toRuntimeConfig(config: unknown, urlForAsset: (id: string) => string): unknown;
  collectAssetIds(config: unknown): string[];
}
export const ENGINE_ADAPTERS: Record<string, EngineAdapter> = {
  "param-sandbox": {
    engineId: "param-sandbox", version: "1.0.0", label: "Parameter Sandbox",
    validate: (raw) => validateSandboxConfig(raw),
    toRuntimeConfig: (c, u) => psRuntime.toRuntimeConfig(c as never, u),
    collectAssetIds: (c) => psRuntime.collectAssetIds(c as never),
  },
};
export function adapterFor(engineId: string): EngineAdapter {
  const a = ENGINE_ADAPTERS[engineId];
  if (!a) throw new Error(`unknown engine "${engineId}"`);
  return a;
}
```
(Task 6 registers the branching adapter here.)
4. Export route: replace direct param-sandbox imports with `adapterFor(interactive.engineId)`; unknown engineId → 422 `{error:"unknown engine"}`.
5. Tests (`tests/multi-engine.test.ts`): engineEntry throws on unknown id; adapterFor dispatches; assemblePackage with engineId "param-sandbox" produces the identical file set as before (compare against a pre-refactor expectation); export-package + golden suites unchanged and green.
6. Gates + commit `refactor: engineId-dispatched packaging and validation (multi-engine plumbing)`.

---

### Task 2: Branching schema with graph validation (TDD, pure — verbatim code)

**Files:** Create `src/lib/engines/branching-scenario/schema.ts`, `tests/branching-schema.test.ts`

- [ ] **Step 1: failing tests** — write `tests/branching-schema.test.ts` covering, with explicit fixtures:
  - a valid 3-scene/1-ending config parses; text fields sanitized (title plain, body rich)
  - unknown keys rejected everywhere (strict)
  - goTo to a missing scene/ending → error naming the choice
  - **dead-end**: a reachable scene whose every path loops without reaching an ending → error naming the scene
  - **unreachable scene** → error naming it
  - a scene where EVERY choice has showIf → error (guaranteed-exit rule)
  - showIf/effects referencing unknown variable → error
  - duplicate ids within scenes/choices(per scene)/variables/endings → error
  - imageAssetId without imageRole → error; imageRole "informative" without imageAlt → error; "decorative" with alt is fine (alt ignored/allowed-empty rule: forbid imageAlt when decorative to avoid confusion)
  - caps: 41 scenes rejected; 7 choices rejected; quality enum only
  - startSceneId must exist; feedbackMode defaults "debrief"; showPathInDebrief defaults true
- [ ] **Step 2: verify FAIL** — `npm test -- tests/branching-schema.test.ts`
- [ ] **Step 3: implement `src/lib/engines/branching-scenario/schema.ts`:**

```ts
import { z } from "zod";
import { sanitizeRichText, sanitizePlainText } from "@/lib/sanitize";

const idPattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const safeId = z.string().min(1).max(40).regex(idPattern, "ids must be letters/digits/underscore");
const plain = (max: number) => z.string().max(max).transform(sanitizePlainText).pipe(z.string().max(max));
const rich = (max: number) => z.string().max(max).transform(sanitizeRichText).pipe(z.string().max(max));

const conditionSchema = z.object({
  variableId: safeId,
  comparator: z.enum(["gte", "lte", "between"]),
  value: z.number().int().optional(),
  min: z.number().int().optional(),
  max: z.number().int().optional(),
}).strict();

const effectSchema = z.object({ variableId: safeId, delta: z.number().int().min(-100).max(100) }).strict();

const choiceSchema = z.object({
  id: safeId,
  label: plain(300),
  quality: z.enum(["best", "acceptable", "poor"]),
  effects: z.array(effectSchema).max(4).default([]),
  feedback: rich(2000).optional(),
  goTo: z.string().regex(/^(scene|ending):[a-zA-Z_][a-zA-Z0-9_]*$/, 'goTo must be "scene:<id>" or "ending:<id>"'),
  showIf: conditionSchema.optional(),
}).strict();

const sceneSchema = z.object({
  id: safeId,
  title: plain(200).optional(),
  body: rich(5000),
  imageAssetId: z.string().min(1).max(64).optional(),
  imageRole: z.enum(["decorative", "informative"]).optional(),
  imageAlt: plain(300).optional(),
  choices: z.array(choiceSchema).min(1).max(6),
}).strict();

const variableSchema = z.object({
  id: safeId, label: plain(80),
  initial: z.number().int(), min: z.number().int(), max: z.number().int(),
  visible: z.boolean().default(false),
}).strict();

const endingSchema = z.object({ id: safeId, title: plain(200), body: rich(5000) }).strict();

export const branchingConfigSchema = z.object({
  title: plain(200),
  intro: rich(5000).optional(),
  role: plain(200).optional(),
  variables: z.array(variableSchema).max(8).default([]),
  scenes: z.array(sceneSchema).min(1).max(40),
  startSceneId: safeId,
  endings: z.array(endingSchema).min(1).max(8),
  feedbackMode: z.enum(["immediate", "debrief"]).default("debrief"),
  showPathInDebrief: z.boolean().default(true),
}).strict();

export type BranchingConfig = z.infer<typeof branchingConfigSchema>;
export type BranchingValidation = { ok: true; config: BranchingConfig } | { ok: false; errors: string[] };

function conditionErrors(where: string, c: NonNullable<z.infer<typeof conditionSchema>>, varIds: Set<string>): string[] {
  const errs: string[] = [];
  if (!varIds.has(c.variableId)) errs.push(`${where}: unknown variable "${c.variableId}"`);
  if (c.comparator === "between") {
    if (c.min === undefined || c.max === undefined) errs.push(`${where}: "between" requires min and max`);
    else if (c.min >= c.max) errs.push(`${where}: "between" requires min < max`);
  } else if (c.value === undefined) errs.push(`${where}: "${c.comparator}" requires value`);
  return errs;
}

export function validateBranchingConfig(raw: unknown): BranchingValidation {
  const parsed = branchingConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  const config = parsed.data;
  const errors: string[] = [];

  const dupes = (ids: string[], what: string) => {
    const seen = new Set<string>();
    for (const id of ids) { if (seen.has(id)) errors.push(`duplicate ${what} id "${id}"`); seen.add(id); }
  };
  dupes(config.scenes.map((s) => s.id), "scene");
  dupes(config.endings.map((e) => e.id), "ending");
  dupes(config.variables.map((v) => v.id), "variable");
  for (const s of config.scenes) dupes(s.choices.map((c) => c.id), `choice (scene "${s.id}")`);

  const sceneIds = new Set(config.scenes.map((s) => s.id));
  const endingIds = new Set(config.endings.map((e) => e.id));
  const varIds = new Set(config.variables.map((v) => v.id));

  if (!sceneIds.has(config.startSceneId)) errors.push(`startSceneId "${config.startSceneId}" is not a scene`);

  for (const v of config.variables) {
    if (v.min >= v.max) errors.push(`variable "${v.id}": min must be < max`);
    if (v.initial < v.min || v.initial > v.max) errors.push(`variable "${v.id}": initial must be within [min, max]`);
  }

  for (const s of config.scenes) {
    if (s.imageAssetId && !s.imageRole) errors.push(`scene "${s.id}": images require imageRole (decorative or informative)`);
    if (s.imageRole === "informative" && !s.imageAlt) errors.push(`scene "${s.id}": informative images require imageAlt (a human-accepted description)`);
    if (s.imageRole === "decorative" && s.imageAlt) errors.push(`scene "${s.id}": decorative images must not carry imageAlt — mark it informative instead`);
    if (!s.imageAssetId && (s.imageRole || s.imageAlt)) errors.push(`scene "${s.id}": imageRole/imageAlt without an image`);
    if (s.choices.every((c) => c.showIf)) errors.push(`scene "${s.id}": at least one choice must have no showIf (guaranteed exit)`);
    for (const c of s.choices) {
      const [kind, target] = c.goTo.split(":");
      if (kind === "scene" && !sceneIds.has(target)) errors.push(`scene "${s.id}" choice "${c.id}": goTo scene "${target}" does not exist`);
      if (kind === "ending" && !endingIds.has(target)) errors.push(`scene "${s.id}" choice "${c.id}": goTo ending "${target}" does not exist`);
      if (c.showIf) errors.push(...conditionErrors(`scene "${s.id}" choice "${c.id}" showIf`, c.showIf, varIds));
      for (const ef of c.effects) if (!varIds.has(ef.variableId)) errors.push(`scene "${s.id}" choice "${c.id}": effect on unknown variable "${ef.variableId}"`);
    }
  }

  // Graph checks on the scene digraph (edges ignore showIf: conditions can hide
  // paths at runtime, but the guaranteed-exit rule ensures the unconditional
  // subgraph is what must be sound). Edge exists per UNCONDITIONAL choice for
  // ending-reachability; ALL choices count for plain reachability.
  if (errors.length === 0) {
    const reach = new Set<string>([config.startSceneId]);
    const queue = [config.startSceneId];
    const byId = new Map(config.scenes.map((s) => [s.id, s]));
    while (queue.length) {
      const s = byId.get(queue.shift() as string);
      if (!s) continue;
      for (const c of s.choices) {
        const [kind, target] = c.goTo.split(":");
        if (kind === "scene" && !reach.has(target)) { reach.add(target); queue.push(target); }
      }
    }
    for (const s of config.scenes) if (!reach.has(s.id)) errors.push(`scene "${s.id}" is unreachable from the start scene`);

    // canFinish: fixed point over scenes whose UNCONDITIONAL choices reach an ending
    const canFinish = new Set<string>();
    let grew = true;
    while (grew) {
      grew = false;
      for (const s of config.scenes) {
        if (canFinish.has(s.id)) continue;
        const ok = s.choices.some((c) => {
          if (c.showIf) return false;
          const [kind, target] = c.goTo.split(":");
          return kind === "ending" || canFinish.has(target);
        });
        if (ok) { canFinish.add(s.id); grew = true; }
      }
    }
    for (const id of reach) if (!canFinish.has(id)) errors.push(`scene "${id}" is a dead end — no guaranteed path to any ending`);
  }

  return errors.length ? { ok: false, errors } : { ok: true, config };
}
```
- [ ] **Step 4: PASS** (expect 12+ tests). **Step 5: commit** `feat: branching scenario schema with dead-end-proof graph validation`

---

### Task 3: Runtime config + state machine (TDD, pure — verbatim contracts)

**Files:** Create `src/lib/engines/branching-scenario/runtime-config.ts`, `src/lib/engines/branching-scenario/state.ts`, `tests/branching-state.test.ts`

**`runtime-config.ts`** — LIGHT module (no zod/sanitize; structural types only), mirroring the param-sandbox split:
```ts
export const QUALITY_WEIGHTS = { best: 1, acceptable: 0.5, poor: 0 } as const;
export type Quality = keyof typeof QUALITY_WEIGHTS;
// Structural runtime shapes (RuntimeBranchingConfig = authoring shape with
// imageAssetId replaced by imageUrl; everything else passes through):
//   toBranchingRuntimeConfig(config, urlForAsset) and collectBranchingAssetIds(config)
```
Implement both functions structurally (walk scenes; replace `imageAssetId` with `imageUrl`, drop the assetId key; keep imageRole/imageAlt; collect ids from scenes).

**`state.ts`** — pure, bundled into the runtime (no DOM):
```ts
export interface ScenarioState {
  sceneId: string | null;          // null once ended
  endingId: string | null;
  vars: Record<string, number>;
  path: Array<{ s: string; c: string; q: Quality }>;
  truncated: boolean;
}
export const MAX_PATH = 200;
initialState(config): ScenarioState                     // vars from initials; sceneId = startSceneId
conditionMet(cond, vars): boolean                        // gte/lte/between (inclusive)
visibleChoices(config, state): Choice[]                  // current scene's choices minus failing showIf
applyChoice(config, state, choiceId): ScenarioState      // throws if choice not visible/unknown; applies
                                                         // effects clamped to [min,max]; appends {s,c,q};
                                                         // truncates path to MAX_PATH from the FRONT with truncated=true;
                                                         // sets sceneId or endingId per goTo
scorePct(state): number                                  // path empty -> 0; mean of weights * 100, Math.round
suspendPayload(state, best, completed): object           // { v:1, s, e, vars, p:[[s,c,q0|1|2]...], t, b, c } compact
restoreState(config, payload): { state, best, completed } | null   // defensive: unknown ids -> null (fresh start)
```
Tests: init; visibility with conditions; effects clamp at min/max; score math (best+poor+acceptable = 50); ending transition sets endingId and sceneId null; illegal choice throws; path truncation at 201 steps sets truncated; suspend round-trip compact (assert serialized JSON length < 3500 for a 200-step path); restore with a stale scene id returns null.
Commit: `feat: branching runtime config mapping and pure scenario state machine`

---

### Task 4: Starters — blank + the jury scenario (content is reviewed here, verbatim)

**Files:** Create `src/lib/engines/branching-scenario/starters.ts`, `tests/branching-starters.test.ts`

`starters.ts` exports `BRANCHING_STARTERS` + `branchingStarterConfig(id, title)` (same pattern as param-sandbox starters; parse through `branchingConfigSchema` at module load). Content:

**blank:** one variable `confidence` (0–100, init 50, hidden); two scenes (`opening` with 2 choices → `decision`; `decision` with 2 choices → endings), one ending pair `resolved`/`unresolved`. Neutral labels ("Consider the options", "Take the direct approach"...).

**jury (the flagship, exact content):** role "You are a juror in a criminal trial." Variable `jury_trust` label "Jury trust" 0–100 init 50 **visible**. feedbackMode "debrief". Scenes:
1. `first_vote` — body: the foreperson calls an early vote; the room leans guilty; you have doubts about the timeline evidence. Choices: `speak_up` (best, +10 trust, → `timeline`) "Raise your doubts about the timeline before anyone votes"; `stay_quiet` (poor, −10, → `pressure`) "Vote with the majority to keep things moving"; `demand_data` (acceptable, +0, → `timeline`) "Ask to re-examine the evidence list first".
2. `timeline` — body: the group re-reads the timeline; a witness statement conflicts with the security log. Choices: `walk_through` (best, +15, → `holdout`) "Walk the group through the conflict step by step"; `dismiss_conflict` (poor, −15, → `pressure`) "Call it a clerical error and move on".
3. `pressure` — body: two jurors push to finish before the weekend; tension rises. Choices: `restate_duty` (best, +10, → `holdout`) "Remind the room the standard is reasonable doubt, not convenience"; `compromise_vote` (poor, −10, → `verdict_rushed`) "Suggest a quick second vote to test the waters".
4. `holdout` — body: one juror still refuses to discuss; the room looks to you. Choices: `invite_reasons` (best, +10, → `verdict_reasoned`) "Ask them to explain what evidence would change their mind"; `isolate` (poor, −15, → `verdict_rushed`) "Suggest the group proceed without their input"; `call_break` (acceptable, +5, showIf jury_trust gte 60, → `verdict_reasoned`) "Call a break — the room trusts you enough to reset".
5. Endings: `verdict_reasoned` "A verdict the room can stand behind" (body: deliberation grounded in evidence; the verdict follows the standard of proof) / `verdict_rushed` "A verdict, but not deliberation" (body: the vote closed the case but the doubts were never resolved).
Tests: both starters validate; jury has 4 scenes/2 endings/1 visible variable; best-path score = 100; the all-poor path = 0; a mixed fixed path computes the expected mean.
Commit: `feat: branching starters incl. jury-deliberation flagship scenario`

---

### Task 5: The runtime (behavior contract + a11y contract from spec §5–6)

**Files:** Create `src/engine-runtime/branching-scenario/main.ts`, `engine.css`, `preview.html`; Modify `scripts/build-engines.mjs` (engines list → two entries, each with its own dir/files; manifest gains the second engine; app tokens emit unchanged); Test `tests/branching-runtime.test.ts`; drift test gains the second engine's files (extend the existing loops).

**Runtime contract (`window.ILBEngine.mount(root, runtimeConfig)` — same global, per-engine bundle):**
- Renders: `role="main"` on root; intro + role line on the start scene only; scene h2 (`tabindex="-1"`); body via innerHTML (pre-sanitized rich); image with `alt = imageRole === "informative" ? imageAlt : ""`; visible-variables status line (ONE polite atomic live region, churn-guarded via the setText pattern); choice buttons (visibleChoices from state.ts).
- On choice: `applyChoice`; feedbackMode "immediate" → render feedback (polite live region) + a "Continue" button (focus moves to it); otherwise transition immediately. On transition: re-render scene; **move focus to the new h2** (programmatic .focus()).
- Ending: h2 + body; score line "Decisions: N best, N acceptable, N poor — score X%"; debrief `<ol>` when showPathInDebrief (per step: scene title/id, chosen label, quality as text + aria-hidden glyph, unchosen labels as "Other options: …", feedback when mode debrief); "Start over" button (state reset; best score preserved).
- SCORM: same adapter global. setScore(high-water of scorePct) on each transition once interacted; setCompleted + flush on first ending; suspend via `suspendPayload(state, best, completed)` on every transition; restore on mount via `restoreState` (null → fresh). Reuse the reportedComplete/bestPct pattern from param-sandbox main.ts — read it first and mirror the semantics exactly.
- engine.css: token-based, Georgia headings, choice buttons ≥24px pill-adjacent styling, focus-visible primary ring, sr-only + reduced-motion utilities (copy the audited patterns from param-sandbox engine.css rather than inventing).
- preview.html: copy param-sandbox's (same handshake, same origin checks).
- build-engines.mjs: refactor the single-engine build into a loop over `[{ id: "param-sandbox", ... }, { id: "branching-scenario", ... }]`; manifest.engines gains the new entry; determinism preserved.

**Tests (jsdom):** mount jury starter runtime config → start scene h2 text + 3 buttons (visible choices); click `speak_up` → scene changes to timeline, `document.activeElement` is the new h2, jury-trust status text updated once (churn-guarded — MutationObserver zero-mutation check on identical re-render); showIf choice hidden below 60 trust and present at ≥60; reach an ending → score line text exact, debrief `<ol>` with the path and "Other options", start-over resets scene and preserves nothing in DOM from the old run; suspend round-trip across remount (mid-scenario + completed cases); mock-SCORM call sequence (score high-water, completed once).
Gates + build:engines x2 + commit `feat: branching scenario runtime with focus-managed transitions and debrief`

---

### Task 6: Register the engine (dispatch, export, validation seams)

**Files:** Modify `src/lib/engines/dispatch.ts` (add the branching adapter using validateBranchingConfig + branching runtime-config fns), `src/app/actions.ts` (createInteractive takes `engine` + `starter`, validates the pair via a starters-by-engine lookup; saveInteractiveConfig validates via `adapterFor(engineId)` — it needs the interactive's engineId: fetch it in the action), `src/app/api/interactives/[id]/export/route.ts` (already adapter-dispatched from Task 1 — confirm branching flows through). Test `tests/multi-engine.test.ts` additions: jury starter assembles + scans clean end-to-end (empty allowlist, expectedIndexHtml) and zips deterministically — the golden test for engine #2 (fixture-free: starter IS the fixture).
Commit: `feat: branching scenario registered across dispatch, actions, export`

---

### Task 7: Editor split + Branching editor

**Files:** Create `src/app/interactives/[id]/param-sandbox-editor.tsx` (MOVE the current editor body — mechanical, no behavior change; editor.tsx keeps shared bits it still needs), `src/app/interactives/[id]/branching-editor.tsx`; Modify `editor.tsx` → thin dispatcher on `engineId` prop (page.tsx passes it; migrateLegacyColors applies only to param-sandbox).

**Branching editor contract (reuse existing field components/patterns — Section/Row/Field/TextField/SelectField/FormulaField-less):**
- Sections: "Scenario" (title, role, intro, feedback mode, show-path toggle) / "What changes as they decide" (variables: label, range, initial, visible) / "Scenes" (scene rail: list with add/remove/reorder + per-scene validation badge; scene panel: title, body, image select + imageRole radio + imageAlt field shown only for informative — with helper text "Describe what the image conveys. When AI drafting arrives, it will suggest; a human always accepts."; choices list: label, quality select (Best/Acceptable/Poor), goTo select (grouped: Scenes…/Endings…), effects rows (variable + delta), feedback, optional condition) / "Endings".
- IDs hidden/auto-slugged from labels/titles (reuse slugify + per-row Advanced rename; extend rename-reference-rewrite for scene ids in goTo strings and variable ids in effects/showIf — new pure helpers in `src/lib/engines/branching-scenario/rename.ts`, unit-tested: renaming scene "timeline" rewrites `goTo: "scene:timeline"` everywhere; renaming a variable rewrites effects/showIf/visible refs).
- Live preview: same iframe machinery pointed at `/engines/branching-scenario/1.0.0/preview.html`; posts the branching runtime config (via the adapter's toRuntimeConfig with `/api/assets/` URLs).
- Draft-save path identical (saveInteractiveConfig now engine-aware from Task 6). Issues panel shows graph errors — they're the killer feature; verify a dead-end edit surfaces its named error live.
Browser E2E: author a 3-scene mini-scenario from blank without touching an id; introduce a dead end → named error appears; fix → clears; play it in preview end to end with keyboard only.
Commit: `feat: branching scenario editor with graph-validated authoring`

---

### Task 8: Engine + starter picker at creation

**Files:** Modify `src/app/projects/[id]/page.tsx`, `src/app/actions.ts` (finalize form contract)
Two engine cards (radio behavior, RDS styling, ≥24px, labeled): Parameter Sandbox ("Learners experiment with a live model") / Branching Scenario ("Learners make decisions and live the consequences"); a starter select that updates per engine (param-sandbox: blank/buoyancy; branching: blank/jury). Server action validates the pair server-side (unknown → blank of that engine). Browser check + commit `feat: engine and starter choice at interactive creation`

---

### Task 9: Announcement contracts + NVDA script for engine #2

**Files:** Modify `src/lib/a11y/transcript.ts` (ensure mappings cover button + linked image cases used; extend only as the runtime requires — unknown-focusable throw stays), `scripts/emit-nvda-script.mjs` (emit per-engine docs; add `docs/a11y/nvda-check-branching-scenario.md` generated from the jury starter: Tab/Enter walkthrough of the best path, expected utterances incl. the focus-to-heading announcements, variable status changes, debrief reading, and the not-hear section); Create `tests/sr-transcript-branching.test.ts` locking: start-scene focus transcript (3 buttons with exact labels), post-choice transcript (new h2 name, new buttons), live-region inventory (exactly one polite atomic status when a visible variable exists; none when not), ending/debrief reading order, decorative image absent from transcript / informative image present with its alt.
Commit: `feat: locked announcement contract + generated NVDA script for branching scenario`

---

### Task 10: Final verification + docs + deliverable

- Full gates: npm test (report count), tsc, eslint ., npm run build, build:engines x2 git-stable; axe suite extended with two branching states (start scene; debrief) — add to `tests/axe.test.ts`.
- README: engines section updated (two engines, choosing at creation, graph validation promise).
- Browser acceptance per spec §9: author → play keyboard-only against the generated NVDA doc's steps (DOM-level assertions) → export jury starter via real route → unzip verify (manifest, hashes, config) → write `C:\Users\tamar\Downloads\InteractiveLabs-Jury-Deliberation-scorm12.zip` (fresh identity) and independently verify it (the final-check pattern) BEFORE reporting.
- Merge --no-ff to main ("Merge feature/branching-scenario: Branching Scenario engine + multi-engine platform"), push origin, delete branch. Update memory doc is the coordinator's job, not this task's.

## Post-plan self-review (author ran this)

- **Spec coverage:** §2 plumbing → T1/T6/T8; §3 schema+rules → T2 (incl. image alt model per Tamara's decision — decorative/informative + human-authored alt, AI-suggest seam noted in editor helper text T7); §4 scoring/SCORM → T3/T5; §5 runtime UX → T5; §6 announcement contract → T5 (focus mgmt) + T9 (locked transcripts + NVDA doc); §7 editor → T7/T8 (flow-graph correctly absent); §8 exclusions respected; §9 acceptance → T10 + per-task tests.
- **Placeholder scan:** clean — living-file work is contract-form by design with the referenced audited patterns named; new pure modules verbatim.
- **Type consistency:** BranchingConfig/validateBranchingConfig (T2) consumed by T4/T6; QUALITY_WEIGHTS/ScenarioState/applyChoice/scorePct/suspendPayload/restoreState (T3) consumed by T5 tests and runtime; adapterFor/EngineAdapter (T1) consumed by T6 route/actions; engineEntry (T1) by package.ts; starters (T4) by T6/T8; branching rename helpers named consistently in T7.

