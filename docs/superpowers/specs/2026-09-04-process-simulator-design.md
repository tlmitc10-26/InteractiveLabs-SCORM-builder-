# Process Simulator (Engine 4): Design Spec

**Date:** 2026-09-04
**Status:** Adversarially reviewed (29 findings applied); building
**Depends on:** Case Workspace M1–M3 (merged; 1098 tests). Founding spec §4.4.
**Execution split:** **M1** engine, **M2** companion doc (grammar finalized against the real schema; §6 is direction + binding rulings), **M3** exemplar ("Evidence Intake"). One spec, three plans/merges.

## 1. Purpose

The fourth hand-audited engine: multi-step professional procedure. Tamara's rulings (2026-09-04): **situation + action menu** over a **prerequisite graph** on a flat action pool (approach A — legitimate order flexibility grades fairly); **try-again consequences** (a wrong or premature action produces its authored realistic consequence and the learner continues — mistakes cost score, never the attempt; no terminal states, consistent with dead-ends-unauthorable); **60/40 correctness/efficiency** fixed weights. JSON-only authoring; the three shipped engines' bundles stay byte-untouched (helpers copied, never extracted).

## 2. Content model (strict Zod — caps are contracts)

```
processConfigSchema = {
  title: plain ≤200,
  intro: rich ≤5000,                     // learning objective, learner-visible
  headerColor?: RDS token enum,          // brand band; no header image
  opening: rich ≤2000,                   // the initial situation
  expertNote?: rich ≤3000,               // debrief commentary on the expert path
  actions: 4..24 of {
    id, label: plain ≤200,               // imperative: "Photograph the item in place"
    required: boolean,
    requires?: 1..6 of actionId,         // prerequisites — CONJUNCTIVE: an action is legal iff EVERY
                                         //   listed id is already done; [] is invalid (absent = none);
                                         //   entries may reference REQUIRED actions only
    outcome?: rich ≤1500,                // REQUIRED iff required=true
    consequence?: rich ≤1500,            // REQUIRED iff (required AND requires present) OR required=false
    consequenceNote?: plain ≤300         // REQUIRED wherever consequence is required (debrief teaching line)
  }
}
```

**Validation (fail-authoring-time):**
- ids unique; every `requires` entry resolves, references a REQUIRED action, no self-reference; the prerequisite graph is **acyclic** (topological check; acyclic + requires-only-required ⇒ every required action reachable — stated and tested).
- ≥2 required actions; **≥1 required action MUST carry a non-empty `requires` OR ≥1 distractor MUST exist** — hard error, not advisory (review #4: otherwise a legal config exists where every learner scores 100 unconditionally). Stronger norm the editor encourages: at least one prerequisite edge so correctness is earnable; "no distractors yet" stays an advisory.
- Field-requirement matrix both directions (distractor with `outcome` invalid; prereq-free required action with `consequence` invalid — dead text).
- **Required action labels unique case-insensitively** (review #22 — `after:` resolves by label in the doc format; only required actions are referenceable, so the rule is narrow).
- `requires` deduplicated; transitive over-specification legal (editor advisory).

## 3. Learner experience (runtime)

Steps: **Brief → Procedure room → Debrief.** h2 focus on every learner-initiated transition; **mount and restore render without moving focus** (review #24). Mount root `role="main"`; buttons only, no drag; a11y rules per-engine-copied from the case engine.css. **The ONE polite atomic live region (progress: "6 of 9 required steps done") is created once at mount OUTSIDE any container the step/panel swaps replace, mutated only via churn-guarded textContent** (review #6) — its text changes only on completed required actions and on reset/restore re-statement (review #28).

1. **Brief.** Brand band (exact primary or headerColor token, gold rule, never a gradient). Intro. "Begin the procedure."
2. **Procedure room.** Three persistent regions: Situation, Actions, progress line.
   - **Situation panel** (h3 "Situation"): opens with `opening`; each legally-performed required action APPENDS its `outcome` as a new entry in a visible running log. **Carrier granularity: the text-carrier class goes on each log `<li>`, not the list** (review #20 — per-entry transcript entries like `ilb-case-file-strength`, so locked expectations stay readable as the log grows). The newest entry is emphasized **non-color-only**: heavier weight + a left rule in an already-approved hex + a visually-hidden "Latest:" prefix (reviews #25, 1.4.1) — no new color pairs.
   - **Action menu** (h3 "Actions"): every action as a real `<button>`, authored order, accname = label verbatim (locked). A completed required action's button becomes `disabled` with an aria-hidden done-glyph. **Reading order still carries the disabled button with its name and disabled state** (the instrument reports it — review #5); only the tab order drops it, and the situation log + debrief are additional records. A locked reading-order transcript containing a disabled action button is part of §9.
   - **Successful required action → focus moves to the Situation panel's h3 (`tabIndex="-1"`)** (review #1 — the just-clicked button is now disabled; the new outcome is the next thing read, which is also the right teaching moment). The progress region updates in the same beat.
   - **Failed attempt** (premature required action — i.e., any conjunctive prerequisite unmet — or any distractor click): a **consequence panel replaces ONLY the Actions sub-container** (Situation and progress persist — review #21); focus moves to the panel's h3 (`tabIndex="-1"`, review #26) — the accname carries the announcement, the live region is NOT used and its text does not change (asserted in §9). The panel shows `consequence` + one "Continue" pill; Continue rebuilds the action menu and **re-establishes focus by action id** on the attempted action's button (still enabled). The attempt is recorded. Nothing ends; nothing locks.
3. **Debrief** (entered automatically when the last required action completes; the transition focuses the debrief h2). Result card (eyebrow "Procedure complete", aria-hidden numeral, visible score line as announced source: "Steps: 7 of 9 clean. Attempts: 13 (expert minimum 9). Score: 78%.", quality chips). Then, in order: **the complete situation log read back** (review #13 — the final outcome must survive the transition; the log is the learner's record and renders in full), **step review** (every required action in completion order: clean first-try = best/green; done after ≥1 failed attempt = ok/amber with its consequenceNote; each attempted distractor = poor/red with its consequenceNote and attempt count — three existing palettes verbatim, zero new pairs), `expertNote` if authored, "Start over" (high-water preserved; progress region re-states "0 of N").

## 4. Scoring (integer num/den arithmetic, one final round-half-up)

Definitions: R = required actions. **Every illegal click is an attempt**: for r∈R, `failed(r)` = premature attempts on r before it was done; for each distractor d, `hits(d)` = clicks on d. **All attempt counters saturate at 99 AT INCREMENT TIME in live state** (review #3 — payload and memory always agree; scoring is path-independent; display "99+"). `clean` = |{r : failed(r)=0}|. `totalAttempts` = |R| + Σfailed(r) + Σhits(d). No double-count path exists: done buttons are disabled, and the consequence panel replaces the menu during its display.

- **correctness** = clean ÷ |R|; **efficiency** = |R| ÷ totalAttempts; **total** = (60·correctness + 40·efficiency)/100; `pct = Math.round((100·num)/den)`.
- **Deliberate property (review #23):** correctness is blind to distractor hits, so a learner completing all required actions in a legal order floors at 60 no matter how much they flail — locked by an extreme fixture so it can never drift silently. (Worked degenerates: fail one action 99× → 57; flawless-plus-one-distractor → 96; flawless → 100.)
- Completion: reaching the debrief (always reachable). SCORM: suspend-only pre-debrief; first debrief `setScore(bestPct)` then `setCompleted()`; Start over never lowers/uncompletes; high-water + copied `salvageBestAndCompleted`.
- **Suspend payload (bounded by construction):** `{v, done:[actionId in completion order], at:[[actionId, count]], b, c, step}` — **`at` carries one entry per action attempted illegally at least once, REQUIRED AND DISTRACTOR alike** (review #2: distractor hits persist across suspend; efficiency is identical with or without a resume — tested). Counts 1..99 integers. Worst case measured and asserted in tests (est. ≈2.3KB with 40-char ids; well under the adapter's 4096 guard — review #14).
- **Restore invariants — each violation ⇒ null ⇒ salvage** (review #7): every id resolves; `done` ⊆ required ids, NO duplicates; **topological replay** — walk `done` left to right, rejecting the first id whose `requires` are not all in the preceding prefix; `at` ids resolve, counts are INTEGERS 1..99; an `at` entry on a prereq-free REQUIRED action is rejected (unreachable by play); `step:"debrief"` with done ≠ all-required is rejected; a NON-debrief step with done = all-required is rejected (would soft-lock a room with every button disabled).

## 5. Authoring (editor)

Sections: Procedure (title/intro/opening/expertNote/headerColor) → Actions (useRowKeys rows: label, required toggle, prerequisites as a checkbox list over the OTHER required actions' labels, outcome/consequence/consequenceNote per the field matrix with visible inline hints) → Issues panel (cycle/reachability/matrix errors) + advisories (no distractors; transitive prerequisites) → the scoring-consequence line ("Score = 60% first-try correctness + 40% efficiency; every click on a wrong or premature action counts"). **`rename.ts` module (renameActionId + removeActionReferences) is a named M1 deliverable** (review #10 — ids live inside `requires` arrays; the case `rename.ts` is the precedent). **Required→distractor toggle cascade** (review #10): prune every inbound `requires` entry pointing at it; orphaned outcome/consequence text is KEPT in the draft (surfaced as Issues-panel errors per the matrix), never silently deleted — a toggle never bricks a draft. Blank starter: 2 required actions **with one prerequisite edge** + 1 distractor (the gradeable shape — review #4). Live preview via preview.html + postMessage sharing the exported engine bytes (same mechanism as all engines).

## 6. Companion doc — M2 DIRECTION (grammar finalized at M2; rulings below are binding)

All prior formats' doctrine + the case format's review-round regression classes carry over (never-throws, line-numbered issues, coerce-never-skip, pruning, floors, post-escape caps, BOM/CRLF/smart-quotes, ALL doc-authored prose HTML-escaped, serializer-generated template + guards). Direction:

```
TITLE: Evidence Intake
INTRO: ...
OPENING: A sealed scene, one item to collect, and a log that must hold up in court.
EXPERTNOTE: The order that survives cross-examination is the one where nothing touched the item before the record existed.

ACTION: Photograph the item in place (required)
Outcome: The item's position is recorded before anything moves.

ACTION: Collect the item (required, after: Photograph the item in place, Put on gloves)
Outcome: The item is bagged.
Consequence: The item moved before it was photographed; its position now rests on memory, not the record.
Note: Collection has two prerequisites; skipping either compromises the record.

ACTION: Ask the officer to move the item closer (distractor)
Consequence: The chain of custody now starts with an undocumented move.
Note: Convenience is not a custody procedure.
```

**Binding rulings:**
- `(required)` / `(distractor)` marker mandatory; missing ⇒ line-numbered error + coercion disambiguated by sub-lines (has `Outcome:` ⇒ required, else distractor) — either coercion errors loudly (a silent default changes scoring).
- `after:` resolves by required-action label, case-insensitively. **Labels containing `,`, `(`, or `)` are grammar-significant** (review #9): parser error naming the label + serializer risky-label warning (the engine-4 RISKY set adds `,` and the literal `after:`).
- **Cycles from `after:` edges: broken by dropping the edge on the later-numbered line, error naming both actions** (review #8 — the floors doctrine requires an editable draft). `after:` naming a distractor ⇒ edge dropped + error.
- **Sub-lines (`Outcome:`/`Consequence:`/`Note:`) are single-line** (review #9); multi-paragraph prose is editor-territory (documented lossiness with a serializer header warning when a config carries it). `EXPERTNOTE:` is a top-matter directive; `headerColor` is editor-only (dropped with a lossy note, case precedent).
- **Floor recipe** (review #8): padding to schema minimums uses prereq-free REQUIRED placeholder actions with placeholder `Outcome` (satisfies matrix + acyclicity); the ≥1-illegally-attemptable rule is floored by a flagged placeholder distractor when needed.

## 7. Exemplar — M3

**"Evidence Intake"** (chain-of-custody, criminal-justice flagship, fictional agency): ~9 required actions with genuine order flexibility, ~4 distractors. **Scope statement is a content requirement** (review #16): the learner-visible intro names this as ONE fictional agency's SOP and states that local policy governs; consequence texts describe operational/evidentiary harm, never adjudicated legal outcomes ("admissible"/"thrown out" are banned words); the brief's per-edge rationale table cites the general principle behind each prerequisite, and the SME review signs edge by edge. Brief-first (complete texts, witness walkthrough through the REAL scoring functions on a rounding boundary, locked fixture). **No-giveaway gate restated for a flat pool** (review #15): machine gates = the pooled mean-length advisory band AND a hard rule that no distractor is the uniquely longest or uniquely shortest label in the pool; tone is an SME-review checklist item, human-judged. Starter (group "exemplar") + byte-parity companion doc + Canvas zip + SME content review before merge.

## 8. Inherited / registration reality (review #11/#12 — stated as WORK, not inheritance)

Genuinely automatic: picker (adapter-driven), export route, ImportPanel, build-drift test. Everything else is enumerated work — the M1 plan opens with the full registration table (engine lib modules incl. rename.ts, runtime + preview.html byte-copy, build-engines ENGINES entry + committed bundle + manifest, dispatch adapter, **editor.tsx dispatcher case AND page.tsx initialConfig branch** (engine 3's missed-branch lesson), new process-editor.tsx, `transcript.ts` text-carrier class registration for the log entries (own commit, both existing engines' locked transcripts byte-identical), NVDA generator fourth section + **NVDA_STATE_WORD table (disabled → "unavailable") + regenerate all four docs** (review #17), fourth axe starter loop, multi-engine fourth id + adapter/golden tests, fourth contrast-pairs hex-allowlist block, README, stale-comment sweep: emit-nvda "both docs", build-engines "third engine", README test count). Zip <40KB; zero new color pairs; `role="main"`.

## 9. Testing / acceptance (M1 unless marked)

- Schema rule-by-rule (matrix both directions, conjunctive-requires fixture: one-of-two prerequisites met is still illegal, cycle detection, requires-only-required, `[]` invalid, unique required labels, the ≥1-illegally-attemptable rule).
- Scoring: clean=100; 99-saturation determinism (120 clicks → counted 99, with AND without a suspend/restore in between — identical pct); the 60-floor extreme fixture; a rounding-boundary fixture; suspend-preserves-efficiency (suspend after N distractor hits ⇒ identical grade).
- State: restore negative-fixture table, one row per §4 rejection; payload worst-case length asserted; suspend round-trip mid-procedure and mid-consequence.
- Runtime: flow incl. success-path focus (Situation h3) and failure-path focus (consequence h3, Continue → attempted button by id); locked transcripts per state incl. per-entry log carriers AND a disabled action button in reading order; live-region contract (exactly one; text unchanged across consequence open/Continue; updates on completion/reset only); SCORM call sequence; axe per state (menu, consequence open, debrief with full log read-back).
- M2: doc suite incl. the case round's regression classes + cycle-breaking + floor recipe. M3: brief-parity, witness fixture, no-giveaway gates, banned-words check ("admissible", "thrown out"), Canvas zip independently verified.
- E2E: author a 4-action procedure from blank, play with deliberate mistakes, verify debrief accounting, export scan-clean.

## 10. Out of scope (v1)

Timers. Branching consequences (consequence = text + score only). Partial-credit prerequisite distance. Multi-procedure sets. Free text. Images. Engine 5 (Dialogue — deferred). Platform phase (last).
