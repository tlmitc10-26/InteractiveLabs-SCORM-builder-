# Case / Evidence Workspace (Engine 3): Design Spec

**Date:** 2026-08-28
**Status:** Adversarially reviewed (29 findings applied); for Tamara's approval
**Depends on:** Exemplar library (merged 2026-08-28, 741 tests). Founding spec §4.3.
**Sequencing (Tamara's ruling):** engines 3–4 before the platform phase.
**Execution split (review finding #15, branching precedent):** three milestones — **M1** engine (schema/scoring/state/runtime/editor/wiring/a11y instrument extension), **M2** companion doc (grammar finalized against the REAL schema, §6 here is direction not contract), **M3** exemplar ("The Ladder Incident" brief → starter → Canvas zip). One spec, three plans/merges.

## 1. Purpose

The third hand-audited engine: learners work a case the way professionals do — examine artifacts, build a case file, commit to a conclusion, justify it with reasons — graded against a designer-authored **expert map**. Tamara's rulings (2026-08-28): scoring mode is **designer-selectable per interactive**; **case-file flow**; **structured sound/flawed reasons** (gradable, teaches reasoning flaws). Approach A: ONE engine, ONE runtime, `scoringMode` changes only grading math + editor requirements. JSON-only authoring through the existing pipeline; zero changes to the two shipped engines (shared helpers are COPIED, not extracted — extraction would re-hash their pinned bundles; deferred to the platform phase).

## 2. Content model (strict Zod — caps are contracts)

```
caseConfigSchema = {
  title: plain ≤200,
  intro: rich ≤5000,                          // learning objective lives here, learner-visible
  scoringMode: "single" | "best-supported" | "argument-quality",
  headerColor?: RDS token enum,               // brand band color; v1 has NO header image (review #6) —
                                              // consistent with the image-less-starter ruling; artifact
                                              // images still exist below
  artifacts: 2..16 of {
    id, title: plain ≤120,
    sourceLine?: plain ≤200,                  // "Deposition of R. Alvarez, p.4"
    kind: "text" | "image" | "table",
    body?: rich ≤3000,                        // text: required
    imageAssetId?, imageRole?, imageAlt? (plain ≤300),   // image: EXACT branching alt matrix
    table?: { caption?: plain ≤200,           // OPTIONAL (review #1); runtime <caption> falls back to title
              headers: 2..5 of plain ≤60,
              rows: 1..8 of cells plain ≤120, each row len == headers len }
  },
  conclusions: 2..6 of {
    id, label: plain ≤200, body?: rich ≤2000,
    credit: "full" | "partial" | "none",
    expertRationale: rich ≤3000,
    reasons: 2..6 of { id, text: plain ≤300, sound: boolean,
                       flawNote?: plain ≤300 }   // REQUIRED when sound=false
  },
  expertMap: 2..96 of {                       // min 2 (review #19): every conclusion needs ≥1 supports
    artifactId, conclusionId, role: "supports"|"contradicts", strength: "strong"|"weak"
  }                                           // absent pair = irrelevant; duplicates invalid
}
```

**Validation:** unique ids; map references resolve; kind-consistency (each kind requires its payload, forbids the others'); image matrix (informative ⇒ non-empty alt, decorative ⇒ empty); every conclusion ≥1 supports + ≥2 reasons + ≥1 sound + flawNote on every flawed reason. Mode rules: `single`/`best-supported` ⇒ exactly one credit "full"; `single` forbids "partial". `argument-quality` ⇒ credit tolerated but ignored (mode switches never brick drafts). Unmapped artifacts legal (red herrings); editor lists them as an advisory.

## 3. Learner experience (runtime)

Four steps; h2 focus on every transition; ONE polite atomic live region whose ONLY semantic is the case-file status ("Case file: 3 of 16 artifacts"); buttons and native inputs only, no drag. Mount root `role="main"`. Reduced-motion / focus-ring / target-size / typography rules ported from branching's engine.css (a per-engine COPY — ~290 lines — the tokens prelude is shared by the build).

1. **Brief.** Brand band (exact `--rds-primary` or headerColor token) + gold rule — never a gradient. Intro. "Open the case file."
2. **Workspace.** Artifact list (buttons: title + kind + aria-hidden reviewed glyph; reviewed = opened at least once, persisted, never scored) → viewer (h3 title, sourceLine, body per kind; tables as real `<table>` with `<caption>` (fallback: artifact title) and `th scope`; images via the existing pipeline) → case-file panel (included artifacts with strength + Remove buttons). Per artifact two explicit add buttons — "Add as strong support" / "Add as weak support" — swapping to "Remove from case file" when included; every add/remove updates the live region. "Ready to conclude" always enabled (an empty file is a legal, scoreable choice).
3. **Conclude.** Conclusions as **native `<input type="radio">` in styled label cards** (the `rds-engine-card` pattern from the New Interactive form — review #3; checked state and arrow keys come free; the a11y instrument gains radio support, see §8). Selecting a conclusion reveals ITS reasons as a labeled checkbox group whose legend names the conclusion ("Which of these justify Equipment failure? Select all that apply."); on conclusion change, selections reset and **focus moves to the reason group's legend** — the accname carries the announcement; the live region is NOT used for this (review #5, branching's aria-describedby doctrine). "Back to the case file" allowed. **Submit requires ≥1 reason selected** (review #17: skipping the reasoning step is not a scoreable strategy); button disabled with visible + programmatic explanation until then. One submission per attempt.
4. **Debrief.** Result card in the branching ending's visual language (eyebrow "Case complete", aria-hidden numeral, visible score line as announced source, quality chips). Component breakdown; per-artifact comparison for the CHOSEN conclusion using EXACTLY the three existing status palettes (review #22 — included-support = best/green, left-out = ok/amber, misused-contradicting = poor/red; no new color pairs); reason review (sound selected/missed; flawed selected with flawNote); expert rationale; "Start over" (high-water preserved).

## 4. Scoring (exact; integer arithmetic so grades never float-flake — review #18)

Let C = chosen conclusion; sets as before. All components computed as integer-numerator/denominator pairs; `pct = Math.round((100 * num) / den)` with the standard round-half-up; witness values locked in tests.

- **evidenceScore** = max(0, |included ∩ supports(C)| − |included ∩ contradicts(C)|) ÷ |supports(C)|. (Denominator ≥1 by validation; the runtime keeps a defensive max(1,·) that no valid config can reach — tests exercise it only via direct function calls with out-of-contract input, stated so nobody writes an impossible config fixture — review #16.)
- **reasonScore** = max(0, |sel ∩ S| − |sel ∩ F|) ÷ |S|.
- **conclusionCredit**: `best-supported` → full=1, partial=1/2, none=0. `argument-quality` → component removed.
- **total**: `best-supported` → (50·e + 30·r + 20·c)/100. `argument-quality` → (50·e + 30·r)/80. **`single` → conclusionCredit GATES the grade** (review #4): correct ⇒ (50·e + 30·r + 20)/100, wrong ⇒ 0. "Single right answer" means process credit flows only with the right answer; the editor states this consequence next to the mode select.
- Strength marks: feedback-only in v1, stated in the editor.
- **SCORM sequence (review #20; existing adapter, zero changes):** steps 1–3 persist suspend data only — no score writes pre-submit. First debrief: `setScore(bestPct)` then `setCompleted()` (idempotent). Start over: state resets, suspend saved, score never re-written below bestPct, completion never revoked. High-water `bestPct` + salvage: the ~9-line `salvageBestAndCompleted` is COPIED from branching (review #9) — restore-mismatch preserves grades (the named prior CRITICAL).
- **Suspend payload (review #8):** no dedup dictionary — the case file is a bounded set, nothing repeats. Id-based JSON `{v, cf:[[artifactId, strength]], rv:[artifactId], ch?, sel:[reasonId], b, c, step}` — `rv` = reviewed artifacts (review #7). Measured worst case ≈1.2KB, far under the adapter's 4096 guard, which remains as defense only. Restore validates every id against the current config; mismatch ⇒ salvage.

## 5. Authoring (editor)

Sections: Case (title/intro/mode + its grading-consequence line/header color) → Artifacts (kind picker; table sub-editor; image via existing asset picker + role/alt matrix) → Conclusions (credit select hidden in argument-quality; reasons with sound/flawed toggle, flawNote appears when flawed) → Expert map (artifact-major: per-artifact disclosure listing every conclusion with irrelevant/supports/contradicts radios + strength select) → Issues panel + unmapped-artifacts advisory. Shared kit throughout; `blank` starter REQUIRED (review #10 — the picker's "Start blank" group and multi-engine invariants demand it) alongside M3's exemplar. ImportPanel wiring lands in M2. Live preview = exported bytes.

## 6. Companion doc — M2 DIRECTION (grammar finalized against the real schema at M2 planning; hardening rulings below are binding)

Same doctrine as both existing formats (never-throws, line-numbered ImportIssue report, serializer round-trip with stated comparison contract, serializer-generated template + guards, BOM/CRLF/smart-quote tolerance, duplicate-title errors, floors that always land an editable draft). Binding rulings from review findings #2/#12/#13/#21:

- **Artifact bodies are OPAQUE**: inside an ARTIFACT block, only block-opening directives (`TITLE|INTRO|MODE|ARTIFACT|CONCLUSION|MAP`) terminate the block; `Source:`/`Caption:` are recognized ONLY as the first lines after the ARTIFACT line; unknown-directive scanning NEVER runs against body lines (deposition-transcript `Name:` lines and memo `Subject:` headers are exactly this engine's content).
- **MODE × credit-marker matrix, all cases specified**: coerce + line-numbered error, never skip a conclusion (skipping orphans MAP lines). No `(best)` under single/best-supported ⇒ first conclusion coerced to full + error; multiple `(best)` ⇒ first wins, rest demoted + error; `(defensible)` under single ⇒ coerced to none + error; `MODE:` absent ⇒ best-supported + info-level note.
- **Reason lines**: `-` starts a reason ONLY inside a CONCLUSION block; a conclusion body line may not start with `-` (documented lossiness, branching-style). Marker anchored at end of line — `(SOUND)` / `(FLAWED: <note>)` with the note allowed any chars except a trailing `)`. Missing marker ⇒ error + imported as SOUND (mirrors branching's OK default).
- **Tables**: `|`-delimited rows, first row headers; `|` inside cell text = documented lossiness; row/header count mismatch ⇒ error + row padded/truncated to fit; caption via optional `Caption:` line.
- MAP lines resolve titles case-insensitively; strength defaults weak with info note if absent.

## 7. Exemplar — M3

**"The Ladder Incident"** (workplace-safety investigation, fictional employer, cross-discipline, dean-safe). Content brief first (`docs/exemplars/brief-ladder-incident.md`: complete artifact texts, expert map, sound/flawed reasons with flawNotes, and a **witness score walkthrough** computing every component for one learner path — a locked test fixture), then starter (group "exemplar") + committed companion doc with byte-parity. Standing content rules apply, with the length-cue gate reformulated for reasons (review #14): pooled per config, a flawed reason may be the uniquely longest reason of its conclusion in ≤40% of conclusions AND the uniquely shortest in ≤40%; advisory band `|mean(words(sound)) − mean(words(flawed))| ≤ 0.15 · mean(words(all))`.

## 8. A11y instrument extension (deliberate, reviewed — the one transcript.ts change)

`transcript.ts` currently throws on `role="radio"` and reports no checked/pressed state — correct until now, insufficient for a persistent selection control. M1 extends `controlRoleOf`/`describeControl` to native radio/checkbox checked-state reporting (mirroring the existing checkbox path), so the announcement contract can LOCK which conclusion is selected. This strengthens the instrument (more is observed, nothing is filtered); the change is its own commit with before/after transcript examples in the body, and both existing engines' locked transcripts must be byte-identical after it (they contain no radios; checkbox state reporting must match whatever the sandbox contracts already assert — verified at plan time, adjusted deliberately if the sandbox transcripts gain state tokens).

## 9. Testing / acceptance (M1 unless marked)

- Schema rule-by-rule positive/negative; mode-switch tolerance; image matrix; table shape; flawNote requirement.
- Scoring: hand-computed fixtures per mode incl. the single-mode gate (wrong conclusion ⇒ 0), argument-quality renormalization, misuse floors; defensive-denominator tests via direct calls (documented as out-of-contract).
- State: suspend round-trip at every step incl. mid-conclude + reviewed set; restore-mismatch salvage; Start-over high-water; SCORM call-sequence test (no score before submit).
- A11y: locked reading/focus transcripts per step (radio checked-state included), ONE-live-region contract, axe per step (text/image/table artifacts, conclude with reasons open, debrief), NVDA generator gains a case-engine section (~bespoke, budgeted — review #11), reduced-motion assertions, contrast suite proves ZERO new pairs.
- Build/export: adapter registered (multi-engine invariants updated for a third engine — review #10), deterministic build ×2, checksums, expectedIndexHtml, zip <40KB, drift test (already engine-generic).
- E2E: author a two-artifact case from blank in the browser, play to debrief, export scan-clean.
- M2: doc-format suite mirroring the sandbox's + template guards. M3: brief-parity, byte-parity doc, length-cue gate, witness walkthrough, Canvas zip independently verified.

## 10. Out of scope (v1)

Header images on the brief step. Strength-weighted scoring. Designer-tunable weights. Multi-case sets. Timers/hints. Free text. Cross-artifact annotation. Shared-runtime-helper extraction (platform phase). Engine 4 (next). Platform (last).
