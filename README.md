# Interactive Lesson Builder (ILB)

Build interactives — parameter sandboxes/simulations, or role-based branching
scenarios — and export them as SCORM 1.2 packages for the Canvas LMS SCORM tool.

Spec: `docs/superpowers/specs/2026-08-25-scorm-interactive-builder-design.md`
Branching Scenario engine spec: `docs/superpowers/specs/2026-08-27-branching-scenario-engine-design.md`

## Run locally

    npm install
    cp .env.example .env
    npx prisma migrate dev
    npm run db:seed
    npm run build:engines   # only needed after editing src/engine-runtime/**
    npm run dev             # http://localhost:3000

Prisma 7 requires an explicit driver adapter even for local SQLite (see
`src/lib/db-adapter.ts`); `DATABASE_URL` (from `.env`) must be set before
`prisma migrate dev`, `npm run db:seed`, or `scripts/set-policy.ts` will run.

## Tests

    npm test

488 tests across schema validation (both engines), the formula interpreter,
the sanitizer, asset upload/validation, engine-runtime build output, SCORM
manifest/adapter generation, package assembly, the compliance scanner,
multi-engine dispatch/registry, a golden deterministic-export regression test
per engine (`tests/golden-export.test.ts`, `tests/multi-engine.test.ts`), the
design-token/contrast/placement modules, the branching-scenario state machine
and graph validator, locked screen-reader announcement-contract transcripts
for both engines, and an automated axe-core accessibility gate over the
rendered lesson runtime in every engine's representative states (Parameter
Sandbox; Branching Scenario's start scene, immediate-feedback panel, and
ending/debrief).

## Engines

ILB ships two engines today, chosen (with a starter) when an interactive is
created:

- **Parameter Sandbox** — learners experiment with a live model: inputs
  drive outputs through designer-authored formulas, with optional charts and
  stage-anchored placement.
- **Branching Scenario** — learners take a role and make a sequence of
  decisions; each choice is graded `best` / `acceptable` / `poor`, can move
  compounding variables (e.g. "Jury trust"), and routes to the next scene or
  an ending. The grade is the mean of chosen-decision quality weights, not a
  completion click.

Both engines share the same contract: hand-audited runtime bundles
(`src/engine-runtime/**` → `public/engines/**`, SHA-256-checked against
`engines.manifest.json`), a strict Zod authoring schema, and the existing
SCORM shell, compliance scanner, design tokens, and accessibility machinery.
Adding an engine means adding a schema + runtime + editor panel, not
touching the export/scan pipeline — `src/lib/engines/dispatch.ts` resolves
validation and runtime-config mapping by the interactive's stored `engineId`,
and `assemblePackage`/the export route resolve engine files the same way.

**No authorable dead ends.** The Branching Scenario schema validates the
scene graph at save time, not just field shapes: every `goTo`/`showIf`/effect
reference must resolve, every scene reachable from the start scene must have
a guaranteed (non-`showIf`-gated) path to some ending, unreachable scenes are
flagged by name, and a scene where every choice carries a `showIf` is
rejected outright (at least one choice per scene must be a guaranteed exit).
The editor's Issues panel surfaces these as live, named errors as soon as a
scene, choice, or `goTo` target changes — a scenario cannot be exported in a
state that could strand a learner.

**Accessibility contracts.** Both engines' screen-reader behavior is
designed first and locked by tests, not verified after the fact: focus
management (e.g. the new scene's heading receives focus on every transition),
live-region inventory (one polite/atomic status region per visible variable,
churn-guarded), and reading order are asserted in
`tests/sr-transcript-branching.test.ts` (and the Parameter Sandbox
equivalent). `npm run a11y:script` generates a keyboard-walkthrough NVDA
verification script per engine — `docs/a11y/nvda-check-param-sandbox.md` and
`docs/a11y/nvda-check-branching-scenario.md` — from the actual starter
content, so the human screen-reader check follows the same contract the
tests already lock, rather than an author's best guess at what NVDA will say.

## Design system

**Token source.** `src/lib/design/tokens.json` is the single source of truth
for the ASU/RDS Base (ASUO) theme — the 16 RDS colors, fonts, spacing, radii,
and the heading scale. `src/lib/design/tokens.ts` is the typed accessor used
by app code, the schema, and tests. Generated artifacts are emitted from that
one source by `npm run build:engines`, all committed: `src/app/tokens.css` (a
Tailwind v4 `@theme` mapping + `--rds-*` variables for the app chrome) and a
tokens layer prepended into each engine's `public/engines/<engine-id>/*/engine.css`
(the audited, checksummed lesson runtime stylesheet — currently
`param-sandbox` and `branching-scenario`). `tests/engine-build-drift.test.ts`
fails the build if any committed artifact, for either engine, ever drifts
from a fresh emit of the source — edit `tokens.json`, not the generated
files.

**Two styling surfaces.** The builder app (dashboard, editor forms, nav) is
Arial throughout, per RDS Base, and never ships in an export. The lesson
runtime — the editor's live preview iframe *and* every exported SCORM
package — uses Georgia headings over an Arial body, matching Canvas course
voice. These are intentionally different stylesheets, but the preview iframe
runs the exact same checksummed `engine.css`/`engine.js` an export ships:
what a designer previews is the bytes a learner gets in Canvas, never a
separate "preview theme."

**Hybrid color model.** Structural chrome (panels, buttons, runtime UI text)
is token-only, not designer-selectable. Designer-selected object colors
(currently: fill-overlay color) offer the 16 curated RDS tokens by name
(theme-proof — resolved via CSS variables at runtime) plus a custom hex
option for college/unit brand requirements. Every color, token or hex, is
contrast-verified against the stage background: live in the editor
(`color-field.tsx`, using `src/lib/design/contrast.ts`) and again at
export/scan time via schema validation (`validateSandboxConfig`) — a fill
that fails the WCAG 3:1 non-text minimum is blocked from export, fail-closed
like the URL allowlist. When a fill sits over a designer-uploaded background
image, real contrast isn't honestly computable against arbitrary photo
content, so the editor shows an advisory instead of a hard block; the
scanner instead verifies the structural guarantee — every visual state
already has a redundant numeric output, so meaning never depends on color
alone (WCAG 1.4.1).

**WCAG 2.2 posture.** Beyond the foundation's labeled controls, live
regions, reduced-motion support, and keyboard operability: every slider (in
both the editor and the exported runtime) is paired with a visible numeric
input, two-way synced, so no interaction requires dragging (2.5.7) — the
same rule applies to the editor's own stage drag/resize authoring, which
offers arrow-key nudge (1%, Shift for 10%) as the required non-drag
alternative. All interactive targets are at least 24×24 CSS px (2.5.8), and
every control carries a visible `:focus-visible` outline. An automated
axe-core pass (`tests/axe.test.ts`) runs against the mounted lesson runtime
in the test suite so accessibility regressions fail CI like any other test.

**Spatial authoring.** Designers place overlays and stage-anchored controls
by dragging, resizing, and keyboard-nudging directly over the live preview
(`stage-authoring.tsx`) — but all of that authoring code lives in the editor
only, drawn over the same-origin preview iframe; **zero authoring/drag code
ships in an exported package.** The runtime's contribution is purely
data-driven: each input/output may carry an optional `placement` (panel /
below the stage / on-stage at a percent box), and the config picks one of
three layout presets (side-by-side, stacked, stage-focus). Visual placement
never changes DOM order — inputs and outputs always render, and receive
focus, in their authored (panel → below → stage) order regardless of where
they sit on screen, so tab order and screen-reader order stay predictable
(WCAG 1.3.2 / 2.4.3).

## Security model (summary)

- Only audited engine runtimes (`src/engine-runtime/**`, built to `public/engines/**`
  with SHA-256 checksums recorded in the engine manifest) are executable code.
  Designers author JSON configs, never code.
- Formulas run through our own recursive-descent interpreter (`src/lib/formula/`);
  there is no `eval` or `new Function` anywhere in the codebase.
- Rich text (`intro` fields) passes an https-only allowlist sanitizer
  (`src/lib/sanitize.ts`) that strips control characters before scheme checks;
  plain-text fields (labels, units, titles) are fully HTML-escaped.
- Uploaded assets are magic-byte checked against their declared type, capped by
  admin policy (`Policy.maxAssetBytes`), and re-encoded through `sharp` to strip
  embedded metadata before storage.
- Export fails closed behind the compliance scanner (`src/lib/export/scanner.ts`):
  a URL allowlist (empty by default — fully self-contained packages only), a
  forbidden-pattern scan (eval/inline handlers/iframes/`javascript:`/`data:`
  schemes), engine checksum verification, a file-type allowlist, byte-exact
  verification that `index.html` matches the audited launcher output, and
  schema revalidation + sanitizer-idempotence of the authoring config. Every
  export attempt is recorded in `ExportRecord`.
- Policy (URL allowlist, asset size/type caps) is the admin-only `Policy` row,
  maintained via `scripts/set-policy.ts` — there is no designer-facing policy UI
  in v1.

## Canvas import

Export downloads a zip SCORM 1.2 package. Upload it in Canvas via the SCORM LTI
tool; any import mode works (graded imports receive both completion and a
0-100 score).

## Roadmap

Case/Evidence Workspace and Process Simulator engines; visual flow-graph
authoring for Branching Scenario; sign-in + admin policy UI; Vercel + Railway
deployment; CreateAI generation provider (the Branching Scenario image-alt
field's AI-suggest → human-accept seam is already in place, awaiting the
provider).
