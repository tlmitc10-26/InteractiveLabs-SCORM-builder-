# Runtime Visual Design Pass: Design Spec

**Date:** 2026-08-27
**Status:** Draft for Tamara's review (with HTML mockup: see `docs/superpowers/specs/mock-runtime-visual.html`)
**Benchmark:** the Articulate Rise scenario block — meet its visual strength; beat it on accessibility, auditability, and size.

## 1. Purpose and non-negotiables

Raise the visual strength of both engine runtimes to the bar Rise sets, **changing presentation only**:
- Zero changes to schemas, scoring, SCORM behavior, state machines, or the security pipeline.
- Every existing gate stays armed and passing: contrast math, axe suite, announcement-contract transcripts, focus-order tests, reduced-motion, checksummed/drift-guarded bundles, deterministic builds.
- All styling from the token system (plus a small set of NEW consumed tokens: spacing scale, radii, elevation, motion durations — added to `tokens.json` and both emitters, drift-guarded like every token).
- Meaning never rides on the new visuals alone: every decorative element is `aria-hidden` with the existing text carrying the semantics (the redundancy doctrine).

## 2. Branching Scenario runtime (the main event)

**Scene view → a staged card:**
- **Header rule (Tamara's decision, 2026-08-28 — Google-Forms model):** when the scene has an uploaded image, the image IS the header (full-bleed 16:7 crop via `object-fit: cover`, max-height cap, rounded top corners, existing upload + imageRole/imageAlt pipeline). When there is no image, the header is a clean brand band in **exact ASU maroon `#8C1D40`** (`--rds-primary`) with a gold (`--rds-secondary`) rule beneath — solid token colors only, **never a gradient or any non-token color**. Optionally, a scenario-level `headerColor` token choice (from the 16 RDS tokens, token-only per the established rule) lets a designer pick a different approved band color; default is primary. Title and body sit BELOW the header on the card surface — never overlaid on an image (text-over-arbitrary-photo contrast is unverifiable; our doctrine says don't fake it). Reading-order consequence: the header image precedes the role line and heading in reading order; focus still lands on the heading after transitions; the NVDA human check evaluates this pattern (pending Tamara's confirmation).
- Role line ("You are a juror…") becomes a distinct opener: small-caps label with a gold accent bar, start scene only.
- Body typography: measure capped (~70ch), comfortable line-height, Georgia headings as today.

**Variables → meter chips:** each visible variable renders as a chip: label, value, and a small horizontal meter bar (token color, min→max). Bar is `aria-hidden`; the existing single live-region TEXT remains the announced source of truth, churn-guarded, unchanged.

**Choices → decision cards:** full-width cards replacing bare buttons — still real `<button>`s. Left-aligned label, an `aria-hidden` letter marker (A/B/C), 2px `light-4` border warming to `primary` on hover/focus, gentle lift on hover (transform, disabled under reduced-motion), pressed state, min-height 56px. Keyboard/focus behavior byte-identical to today (same elements, same handlers, same focus ring).

**Immediate feedback → a considered moment:** feedback panel styled like a "coach note" (gold accent bar, aria-hidden glyph), Continue as the primary pill. The aria-describedby announcement contract is unchanged.

**Transitions:** 150ms fade/rise of the scene card on transition; `prefers-reduced-motion: reduce` → none. Focus management unchanged (h2 focus is the navigation event; motion is garnish).

**Ending + debrief → the emotional beat Rise dresses well:**
- Result card: ending title large (Georgia), the score as a big numeral with quality-breakdown chips ("3 best" / "1 acceptable" / "1 poor" — text + aria-hidden glyph + token color, all pairs contrast-passing).
- Debrief becomes a vertical timeline: CSS rule + node markers (quality glyphs) on the existing `<ol>` — semantics untouched, screen-reader reading order identical to today's contract.
- "Start over" as a secondary pill.

## 3. Parameter Sandbox runtime (polish, not redesign)

- Panels gain soft elevation and small-caps section labels; spacing rhythm from the new scale.
- Range inputs styled (track/thumb via vendor pseudo-elements, token colors, ≥24px thumb) — native semantics untouched; paired numeric field styling matched.
- Output cards: value/unit typographic hierarchy sharpened.
- Challenges: rows become status chips (glyph + text as today, styled); the score strip becomes a banner (neutral → success-green on completion; both states contrast-verified).
- Charts: light gridlines (`light-3`) and an 8%-opacity area fill under the line; axis text unchanged (already verified).

## 4. Token additions (consumed, not speculative)

`tokens.json` gains: `space` scale (4/8/12/16/24/32 — reintroduced NOW WITH consumers), `radius.chip`, `elevation.card` (a shadow value), `motion.fast` (150ms). Both emitters updated in lockstep (drift test extends). Any color used by new elements comes from the existing 16 — no new colors, with one approved exception: the quality-chip/timeline-node/status-banner palette from the Tamara-approved normative mock, shipped as literals rather than the 16-token set — tint backgrounds `#f2f7ec`/`#fff8e1`/`#fbeeee`, border/glyph values `#7a5a00`/`#8b1f1f`, and the AAA text variants `#365409`/`#644a00` (Tamara's 2026-08-28 ruling: TEXT on the tinted status surfaces meets SC 1.4.6 AAA 7:1, not just AA — token success and `#7a5a00` measure 5.6:1/6.0:1 on their tints, so the darkened variants carry the text while the lighter values remain on borders/glyphs where SC 1.4.11's 3:1 applies). Every pair contrast-asserted in tests (Task 4).

## 5. Explicitly unchanged

DOM structure changes are allowed ONLY where the announcement contract proves equivalence (transcript tests must pass with at most deliberate, reviewed updates — e.g., an added aria-hidden marker never appears in a transcript). No new live regions. No layout-preset changes. No editor changes in this milestone (authoring UI polish is a separate, later pass). Package size must stay under 40KB.

## 6. Testing / acceptance

- All existing suites green; transcript tests updated ONLY where a change is deliberate and reviewed (expected: near-zero updates).
- axe on every restyled state (scene, feedback, ending/debrief, sandbox states); contrast assertions for every NEW color pair (chips, banners, markers) via the contrast module in tests.
- Reduced-motion test: transitions absent under the media query (CSS-text assertion + jsdom class check).
- Visual acceptance: Tamara compares the shipped runtime against the mockup and against a Rise scenario block side by side; the NVDA scripts re-run unchanged (or regenerated with reviewed diffs).
- Deterministic build x2; zips re-verified; a fresh jury demo zip delivered for Canvas.
