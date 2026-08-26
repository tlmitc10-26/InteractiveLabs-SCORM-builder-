# Design System + Front-End Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ASU/RDS-branded, WCAG 2.2 AA design system across both surfaces (builder app + exported SCORM runtime), a verifiable hybrid color model, a humanized editor, and drag-and-drop spatial authoring — per spec `docs/superpowers/specs/2026-08-26-design-system-frontend-design.md`.

**Architecture:** One token source (`src/lib/design/tokens.json` + typed accessor) emits generated, committed artifacts (`src/app/tokens.css` for the app; a tokens layer inside `engine.css` for the runtime) via the existing `buildEngines()` build step, covered by the existing drift test. Colors designers pick are stored as token names or verified hex; contrast math is a pure module used by editor (live), schema (block), and scanner (revalidate). All drag affordances live in the editor over the same-origin preview iframe; the audited runtime ships zero authoring code.

**Tech Stack:** existing stack (Next 16, Tailwind v4, Zod, Vitest/jsdom, esbuild) + `axe-core` (dev-only, for automated a11y tests). No other new dependencies.

**Execution notes for every task:**
- Working directory `C:\Users\tamar\Vercel SCORM Builder Interactive Lessons` (spaces — quote). Windows 11, PowerShell 5.1 (no `&&`). Branch: create `feature/design-system` off `main` before Task 1.
- Current suite: 126 tests green. Every task ends green (`npm test`), `npx tsc --noEmit` clean, `npx eslint .` clean; tasks touching `src/engine-runtime/**` or `src/lib/design/**` must run `npm run build:engines` and commit the rebuilt artifacts (deterministic: run twice, git clean).
- Commit messages end with blank line + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Living files (editor.tsx, main.ts, schema.ts) have evolved through review fixes: READ the current file before editing. Where this plan shows code for edits to living files, treat behavior as the contract and adapt mechanically to the current shape.

---

## Stage overview (each stage leaves the app shippable)

- **Stage A (Tasks 1–4):** tokens + both-surface branding. The app *looks like* an EdPlus product; exports are ASU-branded.
- **Stage B (Tasks 5–7):** verifiable color model (tokens + custom hex, live contrast, fail-closed).
- **Stage C (Tasks 8–10):** WCAG 2.2 runtime upgrades, humanized editor, axe automation.
- **Stage D (Tasks 11–13):** placement model + drag authoring.
- **Task 14:** final verification, README, docs.

## File Map

```
src/lib/design/tokens.json          # SINGLE SOURCE: RDS colors, fonts, spacing, radii, heading scale
src/lib/design/tokens.ts            # typed accessor + css emitters (used by app code, schema, tests)
src/lib/design/contrast.ts          # WCAG contrast math (pure)
src/app/tokens.css                  # GENERATED (committed): @theme + --rds-* vars for app chrome
src/app/globals.css                 # imports tokens.css; RDS button/heading component classes
scripts/build-engines.mjs           # buildEngines() also emits tokens.css + engine tokens layer
src/engine-runtime/param-sandbox/engine.css   # rewritten on tokens; Georgia headings
src/engine-runtime/param-sandbox/main.ts      # numeric+slider pairing, placement rendering, color resolution
src/lib/engines/param-sandbox/schema.ts       # color union, placement, layout preset, contrast validation
src/lib/engines/param-sandbox/starter-configs.ts  # blank + Buoyancy Explorer starters
src/app/interactives/[id]/editor.tsx          # humanized sections, color picker, preset picker
src/app/interactives/[id]/color-field.tsx     # token swatches + custom hex + live contrast badge
src/app/interactives/[id]/stage-authoring.tsx # drag layer over preview iframe (select/move/resize/nudge)
src/app/actions.ts                              # createInteractive accepts starter template id
tests/design-tokens.test.ts, tests/contrast.test.ts, tests/axe.test.ts, tests/placement-schema.test.ts,
tests/stage-authoring.test.ts + updates to existing schema/runtime/scanner/golden tests
```

---

### Task 1: Token source + emitters (TDD)

**Files:** Create `src/lib/design/tokens.json`, `src/lib/design/tokens.ts`, `tests/design-tokens.test.ts`

- [ ] **Step 1: Create `src/lib/design/tokens.json`** (pure data; hexes lowercase)

```json
{
  "colors": {
    "primary":   "#8c1d40",
    "secondary": "#ffc627",
    "success":   "#446d12",
    "info":      "#00a3e0",
    "warning":   "#ff7f32",
    "danger":    "#b72a2a",
    "light":     "#f8f9fa",
    "dark":      "#212529",
    "light-1":   "#fafafa",
    "light-2":   "#f1f1f1",
    "light-3":   "#e8e8e8",
    "light-4":   "#d0d0d0",
    "light-5":   "#bfbfbf",
    "dark-1":    "#747474",
    "dark-2":    "#484848",
    "dark-3":    "#191919"
  },
  "fonts": {
    "app":            "Arial, Helvetica, sans-serif",
    "lessonHeading":  "Georgia, 'Times New Roman', serif",
    "lessonBody":     "Arial, Helvetica, sans-serif"
  },
  "radius": { "pill": "50rem", "card": "8px" },
  "space":  { "xxs": "4px", "xs": "8px", "sm": "12px", "md": "16px", "lg": "24px", "xl": "32px" },
  "headings": {
    "h1": { "weight": 700, "mobile": "24px", "desktop": "36px", "lineHeight": 1.2 },
    "h2": { "weight": 700, "mobile": "18px", "desktop": "24px", "lineHeight": 1.2 },
    "h3": { "weight": 700, "mobile": "16px", "desktop": "16px", "lineHeight": 1.2 }
  },
  "minTarget": "24px"
}
```

- [ ] **Step 2: Write failing tests `tests/design-tokens.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import {
  RDS_COLOR_NAMES, colorHex, isTokenName,
  emitRootVariables, emitAppThemeCss, emitEngineTokensCss,
} from "@/lib/design/tokens";

describe("design tokens", () => {
  it("exposes the 16 RDS colors", () => {
    expect(RDS_COLOR_NAMES).toHaveLength(16);
    expect(colorHex("primary")).toBe("#8c1d40");
    expect(colorHex("secondary")).toBe("#ffc627");
    expect(isTokenName("info")).toBe(true);
    expect(isTokenName("hotpink")).toBe(false);
  });
  it("emits --rds-* root variables for every color", () => {
    const css = emitRootVariables();
    expect(css).toContain("--rds-primary: #8c1d40;");
    expect(css).toContain("--rds-dark-3: #191919;");
    expect((css.match(/--rds-/g) ?? []).length).toBeGreaterThanOrEqual(16);
  });
  it("app theme css maps tokens into Tailwind @theme", () => {
    const css = emitAppThemeCss();
    expect(css).toContain("@theme");
    expect(css).toContain("--color-rds-primary: #8c1d40;");
    expect(css).toContain("GENERATED FILE");
  });
  it("engine tokens css carries variables plus lesson font tokens", () => {
    const css = emitEngineTokensCss();
    expect(css).toContain(":root {");
    expect(css).toContain("--rds-primary: #8c1d40;");
    expect(css).toContain("--ilb-font-heading: Georgia");
    expect(css).toContain("--ilb-font-body: Arial");
  });
});
```

- [ ] **Step 3: Run to verify failure** — `npm test -- tests/design-tokens.test.ts` → FAIL (module missing).

- [ ] **Step 4: Implement `src/lib/design/tokens.ts`**

```ts
import tokens from "./tokens.json";

/** Single source of truth for the ASU/RDS Base (ASUO) theme.
 *  tokens.json is data so scripts/build-engines.mjs can read it without TS. */
export type TokenName = keyof typeof tokens.colors;

export const RDS_COLOR_NAMES = Object.keys(tokens.colors) as TokenName[];

export function colorHex(name: TokenName): string {
  return tokens.colors[name];
}

export function isTokenName(name: string): name is TokenName {
  return Object.prototype.hasOwnProperty.call(tokens.colors, name);
}

export const FONTS = tokens.fonts;
export const RADIUS = tokens.radius;
export const SPACE = tokens.space;
export const HEADINGS = tokens.headings;
export const MIN_TARGET = tokens.minTarget;

const GENERATED = "/* GENERATED FILE - edit src/lib/design/tokens.json and run npm run build:engines */";

/** :root { --rds-*: ... } block shared by both surfaces. */
export function emitRootVariables(): string {
  const lines = RDS_COLOR_NAMES.map((n) => `  --rds-${n}: ${tokens.colors[n]};`);
  return `:root {\n${lines.join("\n")}\n}`;
}

/** Tailwind v4 @theme mapping for the app chrome (written to src/app/tokens.css). */
export function emitAppThemeCss(): string {
  const colorLines = RDS_COLOR_NAMES.map((n) => `  --color-rds-${n}: ${tokens.colors[n]};`);
  return `${GENERATED}\n${emitRootVariables()}\n\n@theme {\n${colorLines.join("\n")}\n  --font-app: ${tokens.fonts.app};\n  --radius-pill: ${tokens.radius.pill};\n}\n`;
}

/** Tokens layer prepended into the engine runtime's engine.css at build time. */
export function emitEngineTokensCss(): string {
  return `${GENERATED}\n${emitRootVariables()}\n:root {\n  --ilb-font-heading: ${tokens.fonts.lessonHeading};\n  --ilb-font-body: ${tokens.fonts.lessonBody};\n  --ilb-min-target: ${tokens.minTarget};\n}\n`;
}
```

Note: `tsconfig.json` already has `resolveJsonModule: true`. If ESLint complains about the JSON import, fix config-side, not by weakening code.

- [ ] **Step 5: Run tests** — PASS (4). Full suite 130. tsc/eslint clean.
- [ ] **Step 6: Commit** — `feat: RDS design token source and css emitters`

---

### Task 2: Generated token artifacts via buildEngines + drift coverage

**Files:** Modify `scripts/build-engines.mjs`, `src/app/globals.css`, `tests/engine-build-drift.test.ts`; generated: `src/app/tokens.css` (committed)

- [ ] **Step 1: Read `scripts/build-engines.mjs`** (it exports `buildEngines({ outDir })` and has a CLI guard). Extend `buildEngines` so that BEFORE bundling it:
  1. Reads `src/lib/design/tokens.json` (readFileSync + JSON.parse — no TS import).
  2. Emits `src/app/tokens.css` — same content contract as `emitAppThemeCss()` (duplicate the tiny template literally in the mjs; the drift test cross-checks it against the TS emitter so they cannot diverge silently).
  3. Emits the engine tokens layer (contract of `emitEngineTokensCss()`) and PREPENDS it to the `engine.css` copied into the out dir (read source css, concatenate `tokensLayer + "\n" + sourceCss`, write to outDir instead of plain copyFileSync).
  4. When `outDir` is the default `public/engines`, also write `src/app/tokens.css`; when building to a temp dir (drift test), write the app css into the temp dir as `app-tokens.css` instead so tests can compare without touching the tree.
  Return value gains `{ appTokensCss: string }`.

- [ ] **Step 2: Extend `tests/engine-build-drift.test.ts`** — after the existing byte comparisons, add:

```ts
import { emitAppThemeCss, emitEngineTokensCss } from "@/lib/design/tokens";
// inside the test, after buildEngines({ outDir: tmpDir }):
// (a) mjs emitter and TS emitter agree — the two templates cannot drift
expect(built.appTokensCss).toBe(emitAppThemeCss());
// (b) committed src/app/tokens.css matches a fresh emit
expect(readFileSync(path.join(ROOT, "src", "app", "tokens.css"), "utf8")).toBe(emitAppThemeCss());
// (c) committed engine.css begins with the current tokens layer
const engineCss = readFileSync(path.join(COMMITTED_OUT, "param-sandbox/1.0.0/engine.css"), "utf8");
expect(engineCss.startsWith(emitEngineTokensCss())).toBe(true);
```

- [ ] **Step 3:** `src/app/globals.css` — replace the hand-written `:root`/`@theme` color blocks with `@import "./tokens.css";` after the tailwind import; set `body { font-family: var(--font-app, Arial, Helvetica, sans-serif); }`. Keep dark-scheme block for app background/foreground as-is.
- [ ] **Step 4:** Run `npm run build:engines` (generates tokens.css, rebuilds engine bundles with tokens layer, updates manifest hashes). Run twice → `git status` stable. `npm test` — drift + golden green (golden only checks determinism/scan, not fixed hashes).
- [ ] **Step 5: Commit** (source + generated artifacts) — `feat: generated token artifacts for both surfaces, drift-guarded`

---

### Task 3: RDS app chrome (buttons, headings, layout polish)

**Files:** Modify `src/app/globals.css`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/projects/[id]/page.tsx`, `src/app/projects/[id]/asset-panel.tsx`, `src/app/interactives/[id]/page.tsx`, `src/app/interactives/[id]/editor.tsx` (class swaps only in this task)

- [ ] **Step 1:** Add RDS component classes to `globals.css` (after imports):

```css
/* RDS buttons: pill, Arial 16px/700, 8px 16px padding. Variants per RDS Base. */
.btn { border-radius: var(--radius-pill, 50rem); font-weight: 700; font-size: 16px;
  padding: 8px 16px; min-height: 24px; min-width: 24px; display: inline-flex;
  align-items: center; justify-content: center; gap: 8px; cursor: pointer;
  border: 2px solid transparent; }
.btn:focus-visible { outline: 3px solid var(--rds-info); outline-offset: 2px; }
.btn-primary { background: var(--rds-primary); color: #fff; border-color: var(--rds-primary); }
.btn-primary:hover { background: #741434; }
.btn-secondary { background: var(--rds-secondary); color: #000; border-color: var(--rds-secondary); }
.btn-secondary:hover { background: #e6b323; }
.btn-light-2 { background: var(--rds-light-2); color: #000; border-color: var(--rds-light-2); }
.btn-dark-3 { background: var(--rds-dark-3); color: #fff; border-color: var(--rds-dark-3); }
.btn-danger-link { background: none; border: none; color: var(--rds-danger); text-decoration: underline; padding: 4px 8px; min-height: 24px; }
.btn-sm { font-size: 14px; padding: 4px 12px; }
/* App headings (Arial per RDS Base) */
.app-h1 { font-weight: 700; font-size: 24px; line-height: 1.2; color: var(--rds-primary); }
@media (min-width: 992px) { .app-h1 { font-size: 36px; } }
.app-h2 { font-weight: 700; font-size: 18px; line-height: 1.2; }
@media (min-width: 992px) { .app-h2 { font-size: 24px; } }
```

- [ ] **Step 2:** App shell: in `layout.tsx`, add a maroon header bar (`background: var(--rds-primary)`, white "Interactive Lesson Builder" wordmark, 16px vertical padding) above `{children}`; children wrapped in a main container. Keep semantic `<header>`/`<main>`.
- [ ] **Step 3:** Sweep every page/component listed above: replace hardcoded `#8C1D40` Tailwind arbitrary classes and ad-hoc button styles with `.btn .btn-primary` / `.btn-secondary` / `.btn-danger-link` / `.app-h1/2` classes. All delete buttons become `.btn-danger-link` (≥24px target). Do not change any logic, handlers, or structure beyond classnames + the header.
- [ ] **Step 4:** Verify in browser (`preview_start` ilb-dev): dashboard, project page, editor all render with pill maroon/gold buttons, header bar, no layout breakage; interact (create/delete project) to confirm handlers untouched. Full suite green.
- [ ] **Step 5: Commit** — `feat: RDS app chrome (pill buttons, headings, branded shell)`

---

### Task 4: Lesson runtime branding (engine.css on tokens, Georgia headings)

**Files:** Modify `src/engine-runtime/param-sandbox/engine.css`; rebuild artifacts

- [ ] **Step 1:** Rewrite `engine.css` values onto tokens (the tokens layer is prepended at build time, so the source file may reference `var(--rds-*)` freely):
  - `.ilb-sandbox` font-family → `var(--ilb-font-body)`; color → `var(--rds-dark)`.
  - `.ilb-title`, `.ilb-sandbox h2` → `font-family: var(--ilb-font-heading); color: var(--rds-primary); font-weight: 700; line-height: 1.2;` (title 24px, 36px ≥992px; h2 18px/24px).
  - `.ilb-intro` → `background: #fff8e1; border-left: 4px solid var(--rds-secondary);` (gold accent).
  - Panels `border: 1px solid var(--rds-light-4)`; stage bg `var(--rds-light-1)`; slider `accent-color: var(--rds-primary)`; output value color `var(--rds-primary)`; challenge met `var(--rds-success)`, unmet mark `var(--rds-dark-1)` (contrast ≥3:1 on white — verify #747474 = 4.6:1 ok); chart line `var(--rds-primary)` — CANVAS NOTE: canvas 2D cannot resolve CSS vars; keep chart drawing colors as hex read from a small `ILB_CHART_COLORS` constant in main.ts — change those hexes to token hexes (primary #8c1d40, marker secondary-dark #B8860B → use `--rds-warning` #ff7f32? NO: warning on white is ~2.9:1. Keep marker `#B8860B` (3.25:1) or switch to `var(--rds-dark-1)` #747474 (4.6:1) — use #747474 for the marker and axis text #484848).
  - Keep all a11y rules (sr-only, reduced-motion, focus) intact.
- [ ] **Step 2:** `npm run build:engines`; run twice; git stable. Full suite (drift, golden, runtime tests) green — runtime tests assert behavior/classes, not colors, so they should pass; fix any brittle assertions by asserting classes not colors.
- [ ] **Step 3:** Browser check: open editor preview — lesson shows Georgia maroon headings, gold intro accent; app chrome around it stays Arial. This visual split IS the two-surface requirement — screenshot-level check via DOM (`getComputedStyle(h2).fontFamily` contains Georgia inside iframe; app h1 Arial outside).
- [ ] **Step 4: Commit** — `feat: ASU-branded lesson runtime (Georgia headings, token palette)`

---

### Task 5: Contrast math module (TDD)

**Files:** Create `src/lib/design/contrast.ts`, `tests/contrast.test.ts`

- [ ] **Step 1: Failing tests `tests/contrast.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { contrastRatio, meetsNonText, meetsBodyText, ratioLabel } from "@/lib/design/contrast";

describe("contrastRatio", () => {
  it("black on white is 21:1, self is 1:1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#8c1d40", "#8c1d40")).toBeCloseTo(1, 5);
  });
  it("is symmetric", () => {
    expect(contrastRatio("#8c1d40", "#ffffff")).toBeCloseTo(contrastRatio("#ffffff", "#8c1d40"), 6);
  });
  it("known ASU pairs", () => {
    expect(contrastRatio("#8c1d40", "#ffffff")).toBeGreaterThan(8.5);  // maroon on white ≈ 8.9
    expect(contrastRatio("#ffc627", "#000000")).toBeGreaterThan(12);   // gold on black
    expect(contrastRatio("#ffc627", "#ffffff")).toBeLessThan(2);       // gold on white fails
  });
  it("accepts 3-digit hex and mixed case", () => {
    expect(contrastRatio("#FFF", "#000")).toBeCloseTo(21, 1);
  });
  it("throws on malformed input", () => {
    expect(() => contrastRatio("red", "#fff")).toThrow(/hex/i);
  });
});

describe("thresholds", () => {
  it("non-text 3:1, body text 4.5:1", () => {
    expect(meetsNonText(3.0)).toBe(true);
    expect(meetsNonText(2.99)).toBe(false);
    expect(meetsBodyText(4.5)).toBe(true);
    expect(meetsBodyText(4.49)).toBe(false);
  });
  it("ratioLabel formats for designers", () => {
    expect(ratioLabel(8.876)).toBe("8.9:1");
  });
});
```

- [ ] **Step 2:** Verify FAIL, then implement `src/lib/design/contrast.ts`:

```ts
/** WCAG 2.x contrast math (sRGB relative luminance). Pure; used by the editor
 *  (live badges), the schema (export blocking), and tests. */

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function parseHex(hex: string): [number, number, number] {
  const m = /^#(?:([0-9a-f]{3})|([0-9a-f]{6}))$/i.exec(hex.trim());
  if (!m) throw new Error(`invalid hex color "${hex}"`);
  const h = m[1] ? m[1].split("").map((c) => c + c).join("") : m[2];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG 1.4.11 non-text minimum. */
export const meetsNonText = (ratio: number): boolean => ratio >= 3;
/** WCAG 1.4.3 body-text minimum. */
export const meetsBodyText = (ratio: number): boolean => ratio >= 4.5;

export function ratioLabel(ratio: number): string {
  return `${(Math.round(ratio * 10) / 10).toFixed(1)}:1`;
}
```

- [ ] **Step 3:** Tests PASS (7). Full suite green. Commit — `feat: WCAG contrast math module`

---

### Task 6: Hybrid color model in schema + runtime + scanner (TDD)

**Files:** Modify `src/lib/engines/param-sandbox/schema.ts`, `src/engine-runtime/param-sandbox/main.ts`, `tests/param-sandbox-schema.test.ts`; rebuild artifacts. Read both files first — they carry review fixes.

**Contract:**
1. New exported type + Zod schema in schema.ts:
```ts
export const colorRefSchema = z.union([
  z.object({ token: z.string().refine(isTokenName, "unknown color token") }).strict(),
  z.object({ hex: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).strict(),
  // legacy migration: bare hex string from pre-existing configs → {hex}
  z.string().regex(/^#[0-9a-fA-F]{6}$/).transform((hex) => ({ hex })),
]);
export type ColorRef = { token: TokenName } | { hex: string };
export function resolveColorHex(c: ColorRef): string { return "token" in c ? colorHex(c.token) : c.hex; }
export function colorRefToCss(c: ColorRef): string { return "token" in c ? `var(--rds-${c.token})` : c.hex; }
```
(import `isTokenName`, `colorHex`, `TokenName` from `@/lib/design/tokens`.)
2. Fill overlay `color: hexColor` → `color: colorRefSchema`. RuntimeSandboxConfig's fill overlay `color: string` (a CSS value — `var(--rds-x)` or hex); `toRuntimeConfig` maps via `colorRefToCss`.
3. **Contrast rule in validateSandboxConfig:** for each fill overlay, when `visual.backgroundAssetId` is NOT set, compute `contrastRatio(resolveColorHex(color), STAGE_BG_HEX)` where `STAGE_BG_HEX = colorHex("light-1")`, require `meetsNonText` else error `overlay "id": fill color fails 3:1 contrast against the stage background (X.X:1) — pick a stronger color`. When a background image IS set, no hard block (the editor shows an advisory; numeric redundancy is the guarantee — already true in the runtime).
4. Runtime main.ts: fill overlay sets `fill.style.background = ov.color` (string; works for both var() and hex). No other change.
5. Scanner: needs NO code change (revalidation via validateSandboxConfig covers the rule) — but ADD a scanner regression test proving a failing-contrast config is blocked at scan (rule "schema").
6. Tests: update the schema test fixture(s) to the new color shape; add cases: token color ok; `{hex:"#e8e8e8"}` on default bg → blocked with ratio message; same hex WITH backgroundAssetId set → allowed; legacy bare string `"#4a90d9"` still validates (migration) and runtime css is the hex; `colorRefToCss({token:"info"})` → `var(--rds-info)`; golden fixture: update `tests/fixtures/golden-config.json` only if it contains a fill overlay (check — it doesn't; leave it).

- [ ] Steps: failing tests → implement → full suite green → `npm run build:engines` (main.ts change) deterministic → browser sanity (pick nothing; existing draft with legacy hex still previews) → commit `feat: hybrid verifiable color model (tokens + hex, contrast-blocked)`

---

### Task 7: Editor color field with live contrast verification

**Files:** Create `src/app/interactives/[id]/color-field.tsx`; modify `editor.tsx` (fill overlay color UI only)

- [ ] **Step 1:** Component contract (client component):

```tsx
export function ColorField({ value, backgroundHex, imagePresent, onChange }: {
  value: { token: string } | { hex: string };
  backgroundHex: string;            // stage bg to verify against (light-1 hex)
  imagePresent: boolean;            // background image set → advisory mode
  onChange: (v: { token: string } | { hex: string }) => void;
})
```
Renders: a labeled radiogroup-style swatch grid of the 16 tokens (each a ≥24px button, `aria-label` "<name>, contrast X.X:1", selected state ring, token name caption); below it a "Custom color (for college brand requirements)" disclosure containing a hex text input + native `<input type="color">` synced together; a live status line: when `imagePresent` → advisory text "Placed over an image — verify it reads clearly; the numeric readout guarantees meaning."; else `ratioLabel(contrastRatio(currentHex, backgroundHex))` + pass/fail vs `meetsNonText`, failure styled with `--rds-danger` and echoing the same message the schema emits. Uses tokens/contrast modules; no new deps.
- [ ] **Step 2:** In `editor.tsx`'s VisualSection, replace the fill overlay's raw color TextField with `<ColorField value={ov.color} backgroundHex={colorHex("light-1")} imagePresent={!!v.backgroundAssetId} onChange={(color)=>updateOverlay(i,{color} as Partial<EOverlay>)} />`; update the local `EOverlay` fill type's `color` to the union; when ADDING a fill overlay default `color: { token: "info" }`.
- [ ] **Step 3:** Browser verify: token swatches select, live ratio updates, failing custom hex shows the block message and the export button disables once the draft validates false. Full suite green. Commit — `feat: editor color picker with live WCAG verification`

---

### Task 8: Runtime WCAG 2.2 upgrades (TDD)

**Files:** Modify `src/engine-runtime/param-sandbox/main.ts`, `engine.css`, `tests/engine-runtime.test.ts`; rebuild artifacts

**Contract:**
1. **2.5.7:** every slider input gets a paired visible `<input type="number">` (same min/max/step, mount-unique id, `aria-label` "<label>, exact value") two-way synced: slider input updates number, number input (finite, clamped) updates slider + values + onInteract. Replaces the text badge for sliders (number field IS the readout).
2. **2.5.8:** engine.css: sliders/selects/checkboxes/number inputs min-height 24px (checkbox 24×24 via width/height), spacing preserved.
3. Focus-visible styles on all controls: `outline: 3px solid var(--rds-info); outline-offset: 2px`.
4. Tests to add: slider change updates paired number's value; number input "7" → values.x=7 and outputs recompute; number blur out-of-range clamps into [min,max]; checkbox has 24px computed... (jsdom lacks layout — assert the CSS rule exists in engine.css text instead via a small file-read test in `tests/engine-runtime.test.ts` or skip; prefer asserting attributes/behavior in jsdom and add a source-css assertion for min-heights).
- [ ] Steps: failing tests → implement → suite green → build:engines deterministic → browser check (slider+number pair works in preview) → commit `feat: runtime WCAG 2.2 — paired numeric inputs, 24px targets, focus styles`

---

### Task 9: Humanized editor + starter template

**Files:** Create `src/lib/engines/param-sandbox/starter-configs.ts`; modify `src/app/actions.ts` (createInteractive), `src/app/projects/[id]/page.tsx` (starter select), `editor.tsx`

- [ ] **Step 1:** `starter-configs.ts` — export `STARTERS: Record<string, { label: string; description: string; config: SandboxConfig }>` with `blank` (current emptySandboxConfig but labels humanized: input label "Value", output "Result") and `buoyancy` (the Archimedes demo config from the foundation: mass slider 0.5–20 kg, fluid select 4 options, volume + force outputs, volume-vs-mass chart, ≥6 L challenge, intro copy). Build configs through `sandboxConfigSchema.parse` so an invalid starter fails tests immediately. Test: both starters validate.
- [ ] **Step 2:** `createInteractive` accepts `starter` form field (default "blank"), looks up STARTERS, stores its config. Project page: the New-interactive form gains a labeled `<select name="starter">` of starters with descriptions.
- [ ] **Step 3 (editor humanization, behavior contract — read current editor.tsx first):**
  - **IDs disappear from the primary flow:** remove the ID TextField from every row. New rows: id auto-generated from label via `slugify(label)` (lowercase, spaces→_, strip non [a-z0-9_], prefix with letter if needed) + uniqueness suffix; existing newId util retired or reused underneath. When a designer edits a LABEL of an input/output, the id stays stable (formulas reference it) — add an "Advanced" `<details>` per row exposing the id read-only plus a "rename id" affordance that rewrites references in formulas/charts/challenges/overlays atomically (string replace on exact identifier via existing parse/collect utilities) — keep it simple: regenerate from label on demand with reference rewrite.
  - **Plain language:** section titles → "What learners adjust" (inputs), "What gets calculated" (outputs), "Charts", "Visual scene" (visual), "Challenges & completion" (challenges); field labels lose jargon ("Formula" keeps a helper line "Use the names of things learners adjust, e.g. mass / density * 1000").
  - **Formula insert picker:** next to the formula field, a small "insert name" dropdown listing available identifiers (inputs + earlier outputs) that inserts at cursor.
  - **3.3.7:** nothing asks twice — verify title only asked once (it is).
- [ ] **Step 4:** Browser verify the full authoring flow WITHOUT touching an id: create from Buoyancy starter, rename a label, add an output using the insert picker, preview updates. Suite green (adjust editor-dependent tests if selectors changed). Commit — `feat: humanized editor, auto ids, starter templates`

---

### Task 10: Automated a11y tests (axe-core)

**Files:** Modify `package.json` (devDep `axe-core`), create `tests/axe.test.ts`

- [ ] **Step 1:** `npm i -D axe-core`. Test file (jsdom): render the RUNTIME via `mountSandbox` with the buoyancy starter's runtime config into a jsdom container, run `axe.run(container, { rules: { "color-contrast": { enabled: false } } })` (color-contrast needs real layout; our contrast is verified by our own math instead) and assert `violations` is empty — print violations verbosely on failure. Add a second case mounting with visual overlays + charts. NOTE axe in jsdom: import `axe-core` directly, run on document.body; if canvas APIs missing, jsdom returns null context — main.ts already guards `getContext` null.
- [ ] **Step 2:** Fix any findings in runtime source (likely candidates: missing landmark/label nits) — rebuild engines if main.ts/engine.css change. Suite green. Commit — `test: axe-core accessibility gate for the lesson runtime`

---

### Task 11: Placement model — schema + runtime rendering (TDD)

**Files:** Modify `src/lib/engines/param-sandbox/schema.ts`, `src/engine-runtime/param-sandbox/main.ts`, `engine.css`; create `tests/placement-schema.test.ts`; rebuild artifacts

**Contract:**
1. Schema additions (all optional → old configs stay valid):
```ts
const stageBoxSchema = boxSchema; // reuse {x,y,w,h} percents
const placementSchema = z.union([
  z.object({ zone: z.literal("panel") }).strict(),
  z.object({ zone: z.literal("below") }).strict(),
  z.object({ zone: z.literal("stage"), box: stageBoxSchema }).strict(),
]);
// inputSchema and outputSchema each gain: placement: placementSchema.optional()  (default: panel)
// sandboxConfigSchema gains: layout: z.enum(["side", "stacked", "stage-focus"]).default("side")
```
Cross-check in validateSandboxConfig: `zone:"stage"` placement requires `visual` to exist (a stage must render) → error otherwise.
2. Runtime rendering (main.ts):
  - Config `layout` → class on `.ilb-layout`: `ilb-layout-side` (current grid), `ilb-layout-stacked` (single column: stage, then controls, then outputs), `ilb-layout-stage-focus` (stage large on top, controls+outputs in a row beneath). CSS grids in engine.css; `ilb-has-stage` behavior preserved.
  - Elements with `placement.zone === "below"` render into a `.ilb-below-panel` after the stage; `zone === "stage"` render into a `.ilb-stage-controls` layer inside the stage (`position:absolute` at box percents; white card background `--rds-light-1` with 0.92 opacity, border radius, padding 4px, min sizes enforced).
  - **Focus-order invariant:** DOM order is: panel-zone controls in authoring order → below-zone in authoring order → stage-zone in authoring order (stage-controls layer is a later sibling of the stage image/overlays, so tab order is predictable and matches the documented rule). Add a comment stating the invariant.
3. `toRuntimeConfig` passes placement/layout through unchanged (add to RuntimeSandboxConfig type).
4. Tests (`tests/placement-schema.test.ts` + additions to engine-runtime tests):
  - placement variants validate; stage placement without visual → blocked; layout defaults "side".
  - runtime: input with `zone:"stage"` renders inside `.ilb-stage-controls` with left/top style set from box; its slider still updates outputs; DOM order assertion: `[data-input]` NodeList order equals [panel-zone ids..., stage-zone ids...] for a mixed config.
- [ ] Steps: failing tests → implement schema → runtime → suite green → build:engines deterministic → browser check with a hand-placed stage slider → commit `feat: placement zones and layout presets (schema + runtime)`

---

### Task 12: Stage authoring — drag/resize/nudge layer in the editor

**Files:** Create `src/app/interactives/[id]/stage-authoring.tsx`, create `tests/stage-authoring.test.ts`; modify `editor.tsx` (mount the layer over the preview, wire selection)

**Contract (all authoring-side; ZERO runtime changes):**
1. `stage-authoring.tsx` exports:
```tsx
export function StageAuthoringLayer({ iframeRef, selected, onSelect, onBoxChange, targets }: {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  selected: string | null;                        // overlay id or "input:<id>"
  onSelect: (key: string | null) => void;
  onBoxChange: (key: string, box: { x: number; y: number; w: number; h: number }) => void; // percents, snapped
  targets: Array<{ key: string; label: string; box: { x: number; y: number; w: number; h: number } }>;
})
```
   plus the pure math (exported for tests):
```ts
export function pxToPercentBox(px: {left:number;top:number;width:number;height:number}, stage: {left:number;top:number;width:number;height:number}): {x:number;y:number;w:number;h:number};
export function snapBox(box: {x:number;y:number;w:number;h:number}, step?: number): typeof box;   // default 2, clamp 0..100, w/h min 2
export function nudgeBox(box: {x:number;y:number;w:number;h:number}, key: "ArrowUp"|"ArrowDown"|"ArrowLeft"|"ArrowRight", shift: boolean): typeof box; // 1%, shift=10%, clamped
```
2. Behavior: the layer is absolutely positioned over the iframe (same wrapper, `pointer-events: none` except on its own handles/outlines). It measures the stage each render via `iframeRef.current?.contentDocument?.querySelector(".ilb-stage")?.getBoundingClientRect()` combined with the iframe's own rect (same-origin — allowed; wrap in try/catch → render nothing when unavailable). For each target it draws a labeled outline box; the selected one gets 8 resize handles (≥24px hit areas) + a drag surface; pointer events convert to percent via pxToPercentBox, snap via snapBox, call `onBoxChange` throttled (rAF) during drag with live preview by ALSO directly setting the corresponding iframe element's inline style (authoring-time DOM touch of the preview is allowed), and commit final box on pointerup through normal config state (which re-posts config; the existing debounced save runs).
   Keyboard: when a target's outline has focus (`tabIndex=0`, `role="button"`, aria-label "<label>, position <x>,<y>, size <w> by <h> percent — arrow keys to move, Shift for larger steps"), arrow keys call nudgeBox → onBoxChange. Escape deselects. This is the required non-drag path; the numeric Box fields in the form remain the second alternative, still two-way synced.
3. `editor.tsx` wiring: overlays (fill/swap/transform) and stage-placed inputs become `targets` (`key = "overlay:"+id` / `"input:"+id`); `onBoxChange` writes the box into the right config slot (overlay.box or input.placement.box) via existing update paths; a selection state highlights the corresponding form row (scrollIntoView block:"nearest").
4. Tests (pure math, jsdom): pxToPercentBox correctness incl. offsets; snapBox rounds to 2 and clamps; nudgeBox 1%/10% + clamping at 0/100; a component test asserting the layer renders outlines from `targets` and arrow-key on a focused outline calls onBoxChange with the nudged box (use @testing-library-free approach: render with react-dom/test-utils or mount via createRoot in jsdom and dispatch KeyboardEvent — keep it dependency-free).
- [ ] Steps: failing math tests → implement → wire editor → suite green → **browser verification is the real gate:** drag the fill overlay over an uploaded image, resize by handle, nudge by keyboard, watch box fields update live and preview match; confirm export still passes scan → commit `feat: drag/resize/keyboard spatial authoring over the live preview`

---

### Task 13: Placement UX — zone & preset pickers + drag-to-stage

**Files:** Modify `editor.tsx`

- [ ] **Step 1:** Layout preset picker at the top of the Visual scene section (`SelectField` "Lesson layout": Side by side / Stacked / Stage focus → config.layout).
- [ ] **Step 2:** Each input/output row gains a "Where it appears" select (Panel / Below the scene / On the scene). Choosing "On the scene": if no `visual` exists show inline guidance ("Add a visual scene first"); else set `placement = { zone:"stage", box: { x: 60, y: 70, w: 30, h: 12 } }` and the element immediately appears in the StageAuthoringLayer targets for dragging. Switching away removes the box.
- [ ] **Step 3:** Browser E2E: buoyancy starter → set layout Stage focus → place the mass slider on-stage → drag it beside the beaker → tab order check (`document` tab sequence in iframe: panel controls then stage controls) → export → unzip → open index.html standalone → placement present. Suite green. Commit — `feat: layout presets and per-control placement zones in the editor`

---

### Task 14: Final verification, README, memory

- [ ] **Step 1:** Full gates: `npm test` (expect ≈150+, all green), `npx tsc --noEmit`, `npx eslint .`, `npm run build`, `npm run build:engines` twice → git clean.
- [ ] **Step 2:** Golden export still deterministic; export the buoyancy starter via the API route → scan passes → unzip → confirm engine.css begins with the tokens layer and index.html unchanged in shape.
- [ ] **Step 3:** README: add a "Design system" section (token source, generated artifacts, two surfaces, color verification model, WCAG 2.2 posture, spatial authoring), update test count.
- [ ] **Step 4:** Full-app browser walkthrough of the spec's acceptance scenario (spec §9) end to end; screenshot-level DOM checks for both typography surfaces.
- [ ] **Step 5:** Commit — `docs: design system README; chore: final verification for front-end pass`

## Post-plan self-review (author ran this)

- **Spec coverage:** §2 two surfaces → T2–T4; §3 tokens → T1–T2; §4 color model → T5–T7 (incl. image-advisory + legacy migration + scanner regression); §5 WCAG 2.2 → T8 (2.5.7/2.5.8/focus), T9 (3.3.7), T10 (axe), T12 (authoring-tool 2.5.7 keyboard parity); 2.4.11 → T3/T8 focus styles + T14 walkthrough check that the sticky preview never overlaps focused fields (verify in T14 Step 4; fix with scroll-margin if found); §6 humanized editor + starter → T9; §7 spatial authoring → T11–T13 (7c boundary respected: layer in editor only); §8 out-of-scope respected; §9 acceptance → T14.
- **Placeholder scan:** none ("adapt to current file shape" directives are deliberate for living files, with behavior contracts + code for all new modules).
- **Type consistency:** ColorRef/colorRefToCss (T6) used by T7; placementSchema/layout (T11) consumed by T12–T13 targets/pickers; StageAuthoringLayer props (T12) referenced in T13; tokens accessors (T1) used in T2/T6/T7.


