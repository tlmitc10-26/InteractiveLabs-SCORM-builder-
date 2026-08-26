# Design System + Front-End Pass: Design Spec

**Date:** 2026-08-26
**Status:** Draft for Tamara's review
**Depends on:** Foundation milestone (merged; spec 2026-08-25)

## 1. Purpose

Make the front end as strong as the back end: an ASU-branded, WCAG 2.2 AA design system applied to BOTH surfaces (the builder app and every exported SCORM package), a verifiable color model for designer-selected object/pattern colors, and a humanized editor with low authoring friction.

Brand source of truth: the EdPlus **Rocket Design System (RDS)** Storybook (Base/ASUO theme). Token names mirror RDS (`--rds-*`) so this tool stays compatible with the team's design language and future partner themes (DSL, AirUniversity, Army, AYCE, Starbucks) are a token swap, not a redesign. v1 ships the ASUO Base theme only.

## 2. The two styling surfaces (decided)

| Surface | Where it renders | Typography | Styling file |
|---|---|---|---|
| **App chrome** (dashboard, editor forms, buttons, nav) | Builder app only, never exported | Arial throughout (RDS Base) | app stylesheet (Tailwind + tokens) |
| **Lesson runtime** (the interactive) | Editor preview iframe AND exported SCORM in Canvas | **Georgia headings, Arial body** (Canvas course voice) | `engine.css` (audited, checksummed) |

**Preview-fidelity invariant (already true, now stated as a requirement):** the editor preview runs the identical checksummed engine runtime + CSS that exports ship. What a designer previews is exactly what learners see in Canvas. No separate "preview theme" may ever exist.

## 3. Design tokens

- One token module: `src/lib/design/tokens.ts` — the single source of truth. The 16 RDS Base colors (primary `#8C1D40`, secondary `#FFC627`, success `#446D12`, info `#00A3E0`, warning `#FF7F32`, danger `#B72A2A`, light ramp light/light-1..5, dark ramp dark/dark-1..3), spacing steps, radii (pill buttons), and the RDS heading scale.
- Emitted two ways from the same source:
  1. CSS custom properties (`--rds-*`) + Tailwind theme mapping for the app chrome.
  2. A generated tokens layer prepended into `engine.css` at engine build time (`npm run build:engines`), re-checksummed like all engine output. The drift test extends to catch a token change without a rebuild.
- Buttons in the app follow RDS: pill radius, Arial 16px/700, `8px 16px` padding; variants primary (maroon/white), secondary (gold/black), light-2, dark-3; solid + outline; sm/default/lg.

## 4. Color model for designer-selected colors (decided: hybrid)

Applies to overlay fills today and to every future engine's colorable objects/patterns.

- **Structural colors** (panels, buttons, text, chrome, runtime UI): token-only. Not designer-selectable.
- **Object/pattern colors** (e.g. fill overlay color): picker offers the **curated token palette first** (tokens stored by NAME, e.g. `"info"`, resolved via CSS variables at runtime — theme-proof), **plus a custom hex option** (for college/unit brand requirements we cannot constrain), stored as hex.
- **Verification (the "strong and verifiable" requirement):**
  - Color-on-color pairs that carry meaning (text on fill, fill on stage background color) are contrast-computed live in the editor: show the ratio, WCAG 1.4.11 non-text minimum 3:1 (4.5:1 where text), and **block export below minimums** via schema validation + the compliance scanner (fail closed, same as URLs).
  - Color over an **uploaded image**: contrast is not honestly computable against arbitrary photos. The editor shows an advisory, and accessibility is guaranteed structurally instead: every visual state already has a redundant numeric readout (WCAG 1.4.1 — meaning never depends on color alone). The scanner verifies the redundancy exists (outputs present for every overlay-driving value), not a fake contrast number.
  - Custom hex values are validated for format AND run through the same contrast checks as tokens. No color path skips verification.
- Schema change: overlay `color` becomes `{ token: <name> } | { hex: "#rrggbb" }` (discriminated), with migration for existing configs (stored hex maps to `{hex}`).

## 5. WCAG 2.2 AA (both surfaces)

Already in place from the foundation: labeled controls, live regions (debounced), reduced-motion support, contrast-checked defaults, chart text alternatives, keyboard operability.

This pass adds and test-enforces:
- **2.5.7 Dragging Movements:** every slider paired with a visible numeric input (engine runtime AND editor). No interaction requires dragging.
- **2.5.8 Target Size (Minimum):** all interactive targets ≥ 24×24 CSS px in app and runtime.
- **2.4.11 Focus Not Obscured:** sticky preview pane and panels never cover a focused element.
- **3.3.7 Redundant Entry:** editor never asks for the same information twice.
- **1.4.11 verification** wired into the color model (section 4).
- **Automated checks:** axe-core (via vitest + jsdom) assertions over the rendered editor and runtime DOM added to the suite, so regressions fail CI like any other test. Manual screen-reader spot-check (NVDA) on the exported package before sign-off.

## 6. Humanized editor (rides along)

- Auto-generated IDs hidden from designers (generated from labels, editable only in an "advanced" disclosure). Formulas reference labels via a picker where practical.
- Plain-language section names and field labels; grouped visual-state controls so the background-image + fill (Archimedes) setup is one obvious flow.
- One starter template ("Buoyancy explorer" — the existing demo config) offered at interactive creation alongside "blank," so authoring never starts from an empty x→2x stub. Full template gallery is a later milestone.
- Inline validation stays gentle: draft always saves; issues panel wording task-focused.

## 7. Out of scope for this pass

Partner theme switching UI; template gallery beyond the one starter; new engines; auth; deployment. The token architecture must not preclude any of these.

## 8. Testing / acceptance

- All existing 126 tests stay green; token drift covered by the extended engine-drift test; golden export re-baselined once (engine.css changes).
- New: contrast-math unit tests (known ratio fixtures), schema tests for the color union + migration, axe checks, target-size assertions.
- Acceptance: Tamara opens the app via the desktop icon, authors a small interactive without touching an ID or hex code unless she wants to, previews it (Georgia-headed, ASU-branded), exports, and the package imports into Canvas looking identical to the preview.
