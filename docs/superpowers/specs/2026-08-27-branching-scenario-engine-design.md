# Branching Scenario Engine: Design Spec

**Date:** 2026-08-27
**Status:** Draft for Tamara's review
**Depends on:** Foundation + design-system milestones (merged; 303 tests). Parent spec §4.2 (2026-08-25).

## 1. Purpose

Engine #2: role-based branching scenarios — the justice-trial pattern. A learner takes a role, moves through scenes, makes decisions whose consequences compound through variables, reaches an ending, and gets a debrief showing the path they took against the paths they didn't. Grade reflects decision quality, not completion clicking.

Same contract as every engine: hand-audited runtime + strict Zod schema; designers author only data; the existing SCORM shell, scanner, tokens, and a11y machinery apply unchanged.

## 2. Multi-engine plumbing (prerequisite, in scope)

The pipeline currently assumes `param-sandbox` in a few seams. This milestone makes engines first-class:
- `engines.manifest.json` gains the new engine's bundle + hashes (same build script).
- `assemblePackage`/export route resolve engine files by the Interactive's stored `engineId`/`engineVersion` instead of a hardcoded name.
- Editor routes by `engineId` to the right editor panel + preview page; `createInteractive` gains an engine choice (two cards: Parameter Sandbox / Branching Scenario, each with starters).
- Validation dispatches by engineId (`validateConfigFor(engineId, raw)`).

## 3. Content model (authoring schema, strict)

```
title            plain ≤200
intro            rich ≤5000 (optional)         — scenario framing, shown before scene 1
role             plain ≤200 (optional)          — "You are a juror in a criminal trial."
variables[≤8]    { id, label ≤80, initial int, min int, max int, visible bool }
scenes[≤40]      { id, title plain ≤200 (optional), body rich ≤5000,
                   imageAssetId? (existing asset pipeline),
                   choices[1..6]: {
                     id, label plain ≤300,
                     quality: enum "best"|"acceptable"|"poor"   — scoring weight 1 / 0.5 / 0
                     effects[≤4]: { variableId, delta int }
                     feedback? rich ≤2000                       — shown per feedbackMode
                     goTo: "scene:<id>" | "ending:<id>"
                     showIf?: { variableId, comparator gte|lte|between, value|min+max }
                   } }
startSceneId
endings[1..8]    { id, title plain ≤200, body rich ≤5000 }
feedbackMode     "immediate" | "debrief"        — default "debrief"
showPathInDebrief bool (default true)
```

**Validation guarantees (authoring-time, designer-readable errors):**
- All `goTo`/`showIf`/`effects` references resolve; ids unique per collection; start scene exists.
- **No dead ends:** every scene reachable from start can reach an ending (graph check). Unreachable scenes are a warning-grade error (blocked, named).
- A scene where every choice has `showIf` must be provably non-empty… not statically provable — rule: at least one choice per scene must have NO `showIf` (guaranteed exit).
- Variables clamp to [min,max] at runtime; deltas are ints; caps keep suspend data small.
- Color/asset/text rules inherited (sanitizers, contrast machinery not needed here — scene imagery is content, meaning always in text).

## 4. Scoring + SCORM (same shell)

- Score = mean of chosen decisions' quality weights × 100, reported high-water (consistent with Parameter Sandbox: exploring/replaying never lowers a recorded grade). Completion on first ending reached.
- Replay allowed from the debrief; best score stands.
- Suspend data: `{ sceneId, path: [{s,c}...], vars, best, completed }` — compact ids; path capped at 200 steps (oldest truncated with a flag); stays well under SCORM 1.2's 4096 chars, enforced by the existing adapter guard.

## 5. Runtime experience

- **Scene view:** role line (first scene only) → scene title (h2) → body → optional image → visible-variable status line ("Jury trust: 62") → choice buttons (real `<button>`s, full label text).
- **Scene images (Tamara's decision):** the designer explicitly marks each image `decorative` or `informative` (schema: `imageRole`, required when `imageAssetId` present). Decorative → `alt=""`. Informative → `imageAlt` plain ≤300 REQUIRED, and the authoring flow is **AI-suggest → human accept**: when CreateAI lands, a "Suggest description" action drafts alt text through the GenerationProvider; the human edits/accepts before it saves (the field is never auto-committed). v1 (NullProvider): the human authors it directly in the same field — the seam exists, the gate is identical.
- **On choice:** effects apply (clamped); feedback per mode (immediate: shown with a "Continue" button before transition); transition to target scene/ending.
- **Ending view:** ending title + body, score line ("Decisions: 3 best, 1 acceptable, 1 poor — score 70%"), then **debrief** (if enabled): the path as an ordered list — scene title, the choice made, its quality (text + glyph, never color alone), and per-scene "other options were: …" showing unchosen choice labels; per-choice feedback here when feedbackMode="debrief". Replay button.
- Layout/branding: existing tokens; Georgia headings; no stage/placement concepts (scenes are prose-first).

## 6. Announcement contract (designed first, per doctrine)

- Scene transition: focus moves to the new scene's h2 (`tabindex="-1"`, programmatic focus) — the canonical SPA navigation pattern; no live-region spam for body text.
- Choices: buttons — transcript entries `button "<label>"`. showIf-hidden choices are absent from DOM (not aria-hidden).
- Variable status line: ONE polite, atomic live region; text updates only on value change (churn-guarded); announcement e.g. "Jury trust: 62".
- Immediate feedback: rendered inside a polite live region once, then focus moves to "Continue".
- Debrief: static content (no live regions); path list is a real `<ol>`; quality conveyed as text ("best choice") + glyph with `aria-hidden` mark, mirroring the challenge-row pattern.
- The transcript module gains mappings for: button, and the focus-management assertion (after choosing, `document.activeElement` is the new h2). Contract tests lock the full focus/reading order for the starter scenario; `npm run a11y:script` gains a second generated NVDA script for this engine.

## 7. Editor

- Scene-list left rail (add/reorder/delete scenes; shows per-scene validation badges incl. dead-end warnings), per-scene panel: title, body, image+alt, choices (label, quality select, goTo dropdown of scenes+endings, effects rows, feedback, optional showIf) — all existing field components; ids auto-slugged/hidden per the humanized pattern; rename-with-reference-rewrite extended to scene/variable ids.
- Variables + endings sections; feedbackMode/debrief toggles; live preview = same iframe machinery (plays the scenario for real).
- No visual flow-graph in v1 (list + validation catches structure errors); graph view is a later milestone.
- Starters: `blank` (2 scenes, 1 ending) and `jury` — a compact 5-scene jury-deliberation scenario (domain example Tamara named; ~1 variable "Jury trust", 2 endings) authored carefully as the flagship demo.

## 8. Out of scope (v1 of this engine)

Timed decisions; media beyond images; branching on multiple-variable boolean logic (single-condition showIf only); flow-graph visualization; cross-scene inventory mechanics; AI drafting (comes with CreateAI phase — this schema becomes its second target).

## 9. Testing / acceptance

- Schema: cross-ref + graph validation suite (dead ends, unreachable scenes, showIf-only scenes, caps).
- Runtime (jsdom): transitions, effects/clamping, scoring math, suspend round-trip incl. path truncation, focus management, live-region contract, debrief content; axe gate for representative states; SR transcript locked for the jury starter.
- Scanner/golden: jury starter exports scan-clean; deterministic zips; multi-engine packager covered by tests for BOTH engines.
- Acceptance: Tamara authors a small scenario without touching an id, plays it in preview (keyboard-only pass per generated NVDA script), exports, imports to Canvas: decisions produce a quality-based grade, resume mid-scenario works, debrief shows her path. Both engines exportable side-by-side from one project.
