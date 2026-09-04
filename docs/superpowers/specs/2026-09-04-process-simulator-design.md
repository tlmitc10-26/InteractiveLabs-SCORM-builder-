# Process Simulator (Engine 4): Design Spec

**Date:** 2026-09-04
**Status:** Draft for adversarial review, then build (Tamara approved the design 2026-09-04)
**Depends on:** Case Workspace M1–M3 (merged; 1098 tests). Founding spec §4.4.
**Execution split (engine-3 precedent):** **M1** engine, **M2** companion doc (grammar finalized against the real schema; §6 is direction), **M3** exemplar ("Evidence Intake" chain-of-custody procedure). One spec, three plans/merges.

## 1. Purpose

The fourth hand-audited engine: multi-step professional procedure. Tamara's rulings (2026-09-04): **situation + action menu** (the learner recognizes what comes next from a full menu of plausible actions — approach A: prerequisite graph over a flat action pool, so legitimate order flexibility grades fairly); **try-again consequences** (a wrong or premature action produces its authored realistic consequence state and the learner continues — mistakes cost score, never the attempt; no terminal states, consistent with the platform's dead-ends-unauthorable doctrine); **60/40 correctness/efficiency** fixed weights. JSON-only authoring; zero changes to the three shipped engines (shared helpers copied, never extracted).

## 2. Content model (strict Zod — caps are contracts)

```
processConfigSchema = {
  title: plain ≤200,
  intro: rich ≤5000,                     // learning objective, learner-visible
  headerColor?: RDS token enum,          // brand band; no header image (engine-3 ruling)
  opening: rich ≤2000,                   // the initial situation
  expertNote?: rich ≤3000,               // debrief commentary on the expert path
  actions: 4..24 of {
    id, label: plain ≤200,               // imperative: "Photograph the item in place"
    required: boolean,
    requires?: 0..6 of actionId,         // prerequisites; may reference REQUIRED actions only
    outcome?: rich ≤1500,                // REQUIRED iff required=true: the situation after doing it legally
    consequence?: rich ≤1500,            // REQUIRED iff (required=true AND requires nonempty) OR required=false:
                                         //   what realistically happens on a premature/wrong attempt
    consequenceNote?: plain ≤300         // REQUIRED wherever consequence is required: the debrief teaching
                                         //   line naming WHY it was premature/unnecessary
  }
}
```

**Validation (fail-authoring-time):**
- ids unique; every `requires` entry resolves, references a REQUIRED action (a prerequisite on a distractor would make it required de facto), no self-reference, and the prerequisite graph is **acyclic** (cycles unauthorable — topological check; acyclic + requires-only-required ⇒ every required action reachable, stated and tested).
- ≥2 required actions; ≥1 distractor RECOMMENDED (editor advisory, not an error).
- Field-requirement matrix exactly as annotated above, both directions (a distractor with an `outcome` is invalid; a prereq-free required action with a `consequence` is invalid — it can never be attempted illegally, so the text would be dead).
- `requires` lists deduplicated; a required action may be transitively over-specified (A requires B, B requires C, A also requires C) — legal, editor advisory only.

## 3. Learner experience (runtime)

Steps: **Brief → Procedure room → Debrief.** h2 focus on every transition; mount root `role="main"`; ONE polite atomic live region whose ONLY semantic is progress ("6 of 9 required steps done"); buttons only, no drag; all a11y rules (focus-visible primary rings, 24px targets, reduced-motion, sr-only, Georgia/Arial) ported per-engine-copy from the case engine.css.

1. **Brief.** Brand band (exact primary or headerColor token, gold rule, never a gradient). Intro. "Begin the procedure."
2. **Procedure room.**
   - **Situation panel** (h3 "Situation"): opens with `opening`; each legally-performed required action APPENDS its `outcome` as a new paragraph to a visible running log (a text-carrier list — the learner's record, transcript-locked). The most recent entry is visually emphasized; all remain readable.
   - **Action menu** (h3 "Actions"): every action as a real `<button>`, authored order, label verbatim (accname = label, locked). A completed required action's button becomes `disabled` with an aria-hidden done-glyph — its record lives in the situation log and the debrief, which the transcripts DO carry (stated in the instrument doc-comment: disabled buttons leave the focus transcript by design; the log is the compensating record). Distractors and not-yet-done actions stay enabled always — a distractor can be attempted repeatedly and counts each time.
   - **Failed attempt** (premature required action or any distractor click): a **consequence panel** replaces the action menu's focus context — focus moves to its h3 (accname carries the announcement; the live region is NOT used, per the established doctrine), showing the authored `consequence` and one "Continue" pill; Continue returns to the procedure room with focus on the attempted action's button (still enabled). The attempt is recorded. Nothing ends; nothing is locked out.
   - Progress line updates ONLY on completed required actions (the one live-region semantic).
   - The room is reached with all state restorable mid-procedure (suspend at any point).
3. **Debrief** (entered automatically when the last required action completes — its outcome still lands in the log first; the transition focuses the debrief h2). Result card in the established language: eyebrow "Procedure complete", aria-hidden numeral, visible score line as the announced source ("Steps: 7 of 9 clean. Attempts: 13 (expert minimum 9). Score: 78%."), quality chips (existing palette). Then: **step review** — every required action in the order the learner completed it, using EXACTLY the three existing status palettes (clean first-try = best/green; done after ≥1 failed attempt = ok/amber, with its consequenceNote; each attempted distractor = poor/red, with its consequenceNote and attempt count); `expertNote` if authored; "Start over" (high-water preserved).

## 4. Scoring (integer num/den arithmetic, one final round-half-up — engine-3 doctrine)

Definitions: R = required actions; for each r∈R, `failed(r)` = premature attempts on r before it was done; for each distractor d, `hits(d)` = attempts on d. `clean` = |{r : failed(r)=0}|. `totalAttempts` = |R| + Σfailed(r) + Σhits(d) (every click on an action button is an attempt; the expert minimum is exactly |R|).

- **correctness** = clean ÷ |R|.
- **efficiency** = |R| ÷ totalAttempts (≤1 by construction; =1 only on a flawless run).
- **total** = (60·correctness + 40·efficiency)/100, as integer pairs; `pct = Math.round((100·num)/den)`.
- Completion: reaching the debrief (always reachable — no terminal states). SCORM: suspend-only pre-debrief; first debrief `setScore(bestPct)` then `setCompleted()`; Start over never lowers/uncompletes; high-water + copied `salvageBestAndCompleted`.
- **Suspend payload (BOUNDED — the unbounded-attempts trap is designed out):** no attempt log; per-action COUNTERS only. `{v, done:[actionId in completion order], fa:[[actionId, failedCount]], b, c, step}` — bounded by 24 actions regardless of how many times a learner clicks. `failedCount` capped at 99 in the payload (display "99+"; scoring uses the capped value — stated in the spec so grades are deterministic). Restore validates every id and every invariant (done ⊆ required ids, done order respects prerequisites, fa ids resolve, counts 0..99) → null ⇒ salvage. Debrief-step restore with done ≠ all-required ⇒ null (the completion gate holds on restore — engine-3 lesson).

## 5. Authoring (editor)

Sections: Procedure (title/intro/opening/expertNote/headerColor) → Actions (useRowKeys rows: label, required toggle, prerequisites as a checkbox list over the OTHER required actions' labels — no free-text ids; outcome/consequence/consequenceNote fields appearing per the field matrix, with the matrix enforced by visible inline hints, not just save-time errors) → advisories (cycle/reachability errors from validate in the Issues panel; "no distractors yet" advisory; transitive-prerequisite advisory) → editor states the scoring consequence line ("Score = 60% first-try correctness + 40% efficiency; every click on a wrong or premature action counts"). Blank starter (2 required actions + 1 distractor, valid) + M3 exemplar. ImportPanel lands in M2. Live preview = exported bytes.

## 6. Companion doc — M2 DIRECTION (grammar finalized against the real schema at M2; the inherited rulings are binding)

All three formats' doctrine and the case format's rulings carry over (never-throws, line-numbered ImportIssue, coerce-never-skip, prune skipped declarations from resolution tables, duplicate-title errors with both lines, floors landing an editable draft, caps checked parser-side against POST-escape lengths, BOM/CRLF/smart-quotes, ALL doc-authored prose HTML-escaped at parse time per the standing security ruling, serializer-generated template with byte-match drift test + guards, fenced structural sub-lines). Direction:

```
TITLE: Evidence Intake
INTRO: ...
OPENING: A sealed scene, one item to collect, and a log that must hold up in court.

ACTION: Photograph the item in place (required)
Outcome: The item's position is recorded before anything moves.

ACTION: Collect the item (required, after: Photograph the item in place, Put on gloves)
Outcome: The item is bagged.
Consequence: The item moved before it was photographed; its position is now testimony, not evidence.
Note: Collection has two prerequisites; skipping either compromises the record.

ACTION: Ask the officer to move the item closer (distractor)
Consequence: The chain of custody now starts with an undocumented move.
Note: Convenience is not a custody procedure.
```

`(required)` / `(distractor)` marker mandatory. A silent default in either direction would change scoring, so a missing marker ⇒ line-numbered error + coercion disambiguated by the sub-lines: an action carrying an `Outcome:` line coerces to `required`, otherwise to `distractor` — either coercion errors loudly. `after:` names resolve by label case-insensitively. Sub-lines (`Outcome:`/`Consequence:`/`Note:`) recognized only inside an ACTION block; field-matrix violations coerced + errored per the schema rules (dead consequence dropped with error; missing required outcome ⇒ flagged placeholder).

## 7. Exemplar — M3

**"Evidence Intake"** (crime-scene chain-of-custody, criminal-justice flagship discipline, fictional agency): ~9 required actions (secure scene, gloves, photograph, sketch/measure, collect, seal, label, log, transfer) with genuine order flexibility (sketch/photograph interchangeable where defensible), ~4 distractors with realistic consequences (moving the item, borrowing a pen for the label from the witness, etc.). Brief-first in `docs/exemplars/brief-evidence-intake.md` (complete action texts, prerequisite table with rationale per edge, witness walkthrough computing correctness/efficiency/total through the REAL scoring functions — locked fixture, ideally on a rounding boundary; a "no giveaway" check: distractor labels must not be reliably shorter/longer or tonally marked — pooled formulation like engine 3's), then starter (group "exemplar") + byte-parity companion doc + Canvas zip, SME review (law-enforcement procedure accuracy; evidence-handling realism) before merge.

## 8. Explicitly inherited / unchanged

Scanner/package/export (engine-agnostic, adapter supplies validate + richTextFields: intro/opening/expertNote/outcomes/consequences), deterministic build ×2, checksummed fourth bundle, preview.html byte-copy, transcript instrument (radio/checkbox support already landed; this engine needs NO instrument change — buttons only; disabled-button focus-transcript behavior documented), NVDA generator gains a fourth section (bespoke, budgeted), axe + generic starter loops pick up the new starters, multi-engine invariants gain the fourth id, zip <40KB, zero new color pairs (three status palettes reused verbatim), `role="main"`, contrast machine-enforcement extended to the fourth engine.css.

## 9. Testing / acceptance (M1 unless marked)

- Schema rule-by-rule positive/negative (field matrix both directions, cycle detection, requires-only-required, dedup).
- Scoring: hand-computed fixtures (clean run = 100; the 99-cap determinism; a rounding-boundary fixture locked); state: suspend round-trip mid-procedure + restore-invariant rejections (done order violating prerequisites ⇒ null ⇒ salvage; debrief-without-completion ⇒ null); counter cap behavior.
- Runtime: flow (premature → consequence → try again → done), focus contract (consequence h3, Continue returns to the attempted button, debrief h2), locked transcripts per step incl. the situation-log carrier, ONE-live-region contract (progress only — consequence panel NOT announced via region), SCORM call sequence, disabled-done buttons leave focus order (documented), axe per state (menu, consequence open, debrief).
- M2: doc suite mirroring the case format's incl. its review round's regression classes. M3: brief-parity, witness walkthrough, no-giveaway gate, Canvas zip independently verified.
- E2E: author a 4-action procedure from blank in the browser, play with deliberate mistakes, verify the debrief accounting, export scan-clean.

## 10. Out of scope (v1)

Timers/time pressure. Branching consequences (a consequence never changes WHICH actions exist — it is text + score, per the try-again ruling). Partial-credit prerequisite distance. Multi-procedure sets. Free text. Images (v1 is text-procedure; the artifact-image pipeline can come later if an exemplar demands it). Engine 5 (Dialogue — deferred per founding spec). Platform phase (last).
