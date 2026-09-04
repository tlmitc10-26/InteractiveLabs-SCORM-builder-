# Content brief: Evidence Intake

**Slug:** `evidence-intake` · **Engine:** process-simulator · **Standalone** (criminal justice — evidence handling / chain of custody)
**Authored through:** the process companion-doc format (spec §6, grammar shipped in M2). The doc in §5 of this brief is the source of truth; the starter config is its parse result.
**Shape:** 13 actions — 9 required, 4 distractors — 9 prerequisite edges, 8 legal orders of the required actions.
**Status:** content complete; transcribe verbatim, invent nothing.

---

## 1. Learning objective

Learner-visible, appears in the interactive's intro:

> By the end of this exercise you will be able to sequence an evidence intake so that every step that destroys information happens after the step that records it, and to say what each link in a chain of custody is actually protecting.

## 2. Discipline pattern

Evidence handling is taught in every criminal-justice program in the country and in almost none of them as the thing it actually is. The standard treatment is a list: secure, photograph, sketch, collect, package, seal, label, log, transfer. Students memorize the list, answer nine multiple-choice questions about it, and leave with the impression that the procedure is an order to be recalled. Then they reach a scene where the light is bad, the reporting party is offering to help, the roll of evidence tape is in the other car, and the list does not tell them which of its steps they are allowed to reorder and which ones they are not.

The real skill is knowing *why* each step sits where it does — and, just as important, knowing which steps have no fixed order at all. Two of the nine actions below can be taken in either order and two more can be taken at almost any point; a program that grades order flexibly is teaching the reasoning, while one that grades a single memorized sequence is teaching the list again with a stopwatch. The prerequisite graph in §4 encodes exactly one distinction: an edge exists where taking the later step first destroys information the earlier step was the only way to capture, or breaks a record that only works when it is unbroken. Everything else is left free.

The characteristic failure this exercise is built around is not ignorance. It is the reasonable shortcut: the frame would be clearer with the bar moved two feet, the office manager is standing right there with two free hands, the desk has tape on it, and the paperwork can be done at seven with everything else. Each of the four distractors is something a competent person does under time pressure, and each one costs something specific and unrecoverable. The same shape transfers directly to specimen handling in nursing and clinical laboratory science, sample custody in environmental compliance, and forensic acquisition in digital investigations — every field where the value of a physical object depends on an unbroken written account of where it has been.

## 3. Notation for transcription

- The companion doc in §5 is authored by hand and imported through `parseProcessCompanionDoc`. It parses with **zero** issues of **any** severity — not merely zero errors — and the parsed config becomes the committed starter.
- Ids are what `uniqueSlug` produces from labels, truncated at 32 characters. The walkthroughs in §6 are keyed by those ids, printed from the real parse.
- Markers are `(required)` and `(distractor)`. A required action's prerequisites are written `(required, after: <label>[, <label>...])` and resolve by **required-action label**, case-insensitively; `after:` is conjunctive — the action is legal only when every named prerequisite is already done.
- **No required label contains `,`, `(` or `)`.** Those three characters are grammar-significant in an `after:` clause and the parser treats them as a hard **error** on a required label. Every label below is checked against that rule; a "tidy" edit that adds a comma to one of them breaks the import.
- Sub-lines are `Outcome:`, `Consequence:` and `Note:`, each on exactly one physical line, at most once per block, in any order. This format has no free bodies — any other line inside an `ACTION:` block is a line-numbered error.
- Field matrix, both directions: a required action always carries `Outcome:`; it carries `Consequence:` + `Note:` **iff** it has an `after:` clause (a prerequisite-free required action cannot be attempted illegally, so that text would be dead and is rejected); a distractor carries `Consequence:` + `Note:` and never `Outcome:`.
- `Consequence:` texts describe **operational and evidentiary harm only** — what stops being knowable, what can no longer be reconstructed. They never describe an adjudicated outcome. **"admissible" and "thrown out" are banned words**, asserted absent from every learner-visible string in `tests/exemplar-content.test.ts`.
- SME rationale in §4 and §6 is **brief-only** — review material, never in the config and never shown to the learner.

## 4. Configuration summary

| Field | Value |
| --- | --- |
| `title` | Evidence Intake |
| `headerColor` | not set (schema default brand band; editor-only, not representable in the doc) |
| actions | 13 |
| required actions | 9 |
| distractors | 4 |
| prerequisite edges | 9 |
| legal orders of the 9 required actions | 8 |
| `expertNote` | present (debrief commentary on the expert path) |

**The situation (learner-facing framing):** a rear door at a small veterinary clinic was pried open overnight and the tool is still lying inside the doorway. The learner is the deputy assigned to bring that one item in. There is exactly one item, deliberately: the exercise is about the record, not about triage.

**Cast** (all fictional, as is the agency): Deputy Ruben Alcaraz, first on scene; Nadia Oyelaran, the clinic's office manager and reporting party; Hana Yamashiro, evidence custodian. The Ashmoor County Sheriff's Office, its evidence manual, the Cottonmill Veterinary Clinic and every person named are invented for this exercise. Both coined names were checked against live search for collision with a real agency or business: there is no Ashmoor County and no Ashmoor County Sheriff's Office anywhere in the United States (the nearest real names are Ashe County NC and Ashland County OH), and there is no Cottonmill Veterinary Clinic.

### The scope statement

Spec §7 makes this a content requirement, not a nicety. It appears **verbatim** in `INTRO:`, which is learner-visible on the Brief step:

> Ashmoor County, its sheriff's office, its evidence manual and everyone named here are fictional. What follows is one fictional agency's standard operating procedure, written to teach the reasoning behind evidence handling; it is not a standard, and the policy of the agency you work for governs how you actually do this work.

Two things it has to do and does. It names the procedure as **one fictional agency's SOP** rather than as the procedure, because real agencies differ on genuinely contested points — whether the label is written before or after the seal, whether a sketch is required for a single-item recovery, who may transport. And it says **local policy governs**, so a learner who works for an agency whose manual orders these steps differently is not being told their employer is wrong.

### Required actions and the prerequisite graph

| # | id | label | `after:` |
| --- | --- | --- | --- |
| 1 | `secure_the_scene_and_control_who` | Secure the scene and control who enters it | — |
| 2 | `put_on_a_fresh_pair_of_examinati` | Put on a fresh pair of examination gloves | — |
| 3 | `photograph_the_item_where_it_lie` | Photograph the item where it lies | 1 |
| 4 | `sketch_the_room_and_measure_the` | Sketch the room and measure the item's position | 1 |
| 5 | `collect_the_item_and_place_it_in` | Collect the item and place it in an evidence bag | 2, 3, 4 |
| 6 | `seal_the_evidence_bag_with_tampe` | Seal the evidence bag with tamper-evident tape | 5 |
| 7 | `label_the_sealed_bag_and_initial` | Label the sealed bag and initial across the seal | 6 |
| 8 | `record_the_item_on_the_agency_ev` | Record the item on the agency evidence log | 7 |
| 9 | `transfer_the_sealed_package_to_t` | Transfer the sealed package to the evidence custodian | 8 |

Nine edges, and the graph is deliberately wide at the top: actions 1 and 2 have no prerequisites at all, and 3 and 4 are siblings. That yields **8 distinct legal orders** of the nine required actions (counted programmatically over the parsed graph, not by hand) — a learner who gloves up first and sketches before photographing scores exactly the same as one who does neither.

### Per-edge rationale — the SME signs these one at a time

Every edge below is defensible **on its own**, without appeal to "that's the order in the manual". The SME review is edge by edge: an edge that cannot be defended individually is an edge that punishes a learner for a preference.

| Edge | General principle | Why an evidence SME defends this edge specifically |
| --- | --- | --- |
| 3 ← 1 (photograph after securing) | Documentation before disturbance | A photograph records the scene at the instant the shutter opens, not the scene as found. While access is uncontrolled the room is still changing — a delivery driver steps in, a door gets pushed further open — so a frame taken then documents a room that has already been altered, and there is no second chance at an undisturbed one. Control is what makes the photograph a record of a finding. |
| 4 ← 1 (sketch and measure after securing) | Documentation before disturbance | Same reason, plus one of its own: a measurement fixes the item to reference points — a jamb, a wall — and those references have to be in the position they were found in at the moment the number is taken. A dimension recorded against a door somebody has since moved is a number about nothing. |
| 5 ← 2 (collect after gloving) | Contamination prevention | The only instant gloves matter is the instant of contact. Bare contact adds the collector's own trace to the item and can remove what was on it, and neither effect is subtractable afterward. No later step in the procedure can put the item back into the condition it was in before it was touched. |
| 5 ← 3 (collect after photographing) | Documentation before disturbance | Collection destroys the item's position permanently — this is the one-way door of the whole procedure. The photographs are the only record of the relationship between the item, the forced latch and the doorway. Taken after collection, a photograph shows a placement somebody made rather than a position somebody found. |
| 5 ← 4 (collect after sketching and measuring) | Documentation before disturbance | The same one-way door, a different record. Measurements can only be taken against the item while it lies where it lay; after collection, "fourteen inches from the jamb" can be recalled but not measured, and a recalled dimension is testimony rather than documentation. The sketch also carries what a photograph cannot: scale, orientation and the parts of the room outside the frame. |
| 6 ← 5 (seal after collecting) | Continuous custody | A seal makes one claim: this package has been closed since collection and has not been opened since. Applied to an empty bag it makes that claim about nothing, and the bag then has to be opened again to put the item in — which destroys the only claim the seal was there to make. |
| 7 ← 6 (label and initial after sealing) | Continuous custody | The initials and date are not decoration on the label; they have to run across the tape and onto the paper on both sides so that lifting the tape breaks them. Before the seal exists there is no tape to cross, so the one part of the marking that reports on tampering cannot be made at all. |
| 8 ← 7 (log after labelling) | Continuous custody | The log entry and the face of the package are one record kept in two places, and they stay identical because one is copied from the other. Logging first means describing from memory an item that carries no number yet, so any disagreement between the two is discovered later by whoever needs them rather than immediately by the person who made them. |
| 9 ← 8 (transfer after logging) | Continuous custody | Custody is continuous only if every change of hands is a documented event. A handoff made before the entry exists is remembered rather than recorded, and the receiving custodian has no line to sign against — the gap it creates is at exactly the point the record is supposed to be strongest. |

### Edges deliberately **not** authored

Each of these was considered and rejected. An unauthored edge is a design decision with the same weight as an authored one, and the SME signs this table too.

| Non-edge | Why there is no edge |
| --- | --- |
| 4 ← 3 / 3 ← 4 (sketch vs photograph) | **The load-bearing omission.** Photographs and a measured sketch are two independent records of the same undisturbed scene. Neither consumes the other's subject and neither is degraded by going second. Which one a competent investigator reaches for first is a matter of light, weather, how long the scene can be held and personal habit. Forcing an order here would grade a preference, and it is the single most likely place for a program to accidentally teach a memorized list. |
| 2 ← 1 (gloves after securing) | Gloving up is a personal act that changes nothing about the scene. It can be done in the car, at the tape, or one second before contact. The only wrong moment is after touching the item, and edge 5 ← 2 already covers that. |
| 5 ← 1 (collect after securing) | True but transitive: collection already requires 3 and 4, and both of those require 1. Transitive edges are legal in the schema and flagged as an editor advisory; authoring them adds nothing to what is enforced and makes the graph harder for the SME to read. |
| 6/7/8/9 ← anything earlier than their immediate predecessor | Same reason. The tail of the procedure is a genuine chain, so each action's single edge to its predecessor already forces the whole prefix. |
| 9 ← 6 (transfer after sealing) | Also transitive — and stating it separately would suggest the seal and the log are independent guarantees. They are not: the log is what makes the sealed package findable and the seal is what makes the logged package trustworthy. |

### Distractors

Four, each a shortcut a competent person genuinely takes under pressure, and each one costing something specific that no later step recovers. Consequence texts stay on operational and evidentiary ground — what stops being knowable — and never state a legal outcome.

| id | label | The temptation | What it actually costs | Teaching note (`Note:` → debrief) |
| --- | --- | --- | --- | --- |
| `move_the_item_into_better_light` | Move the item into better light before photographing it | A dim corridor at 06:40 and a phone camera that will not hold focus | The position becomes one the collector created; every measurement taken afterward describes the new placement, and the relationship between the bar, the jamb and the pry marks existed once and is gone | A clear photograph of the wrong position is worth less than a poor photograph of the right one. Light is a problem to solve with a flash rather than with your hands. |
| `hand_the_item_to_the_reporting_p` | Hand the item to the reporting party to hold | Two free hands are standing right there while you are trying to sketch | An ungloved person who is in nobody's log has handled the item; the count of people who touched it is now permanently larger than the count the record will ever show | Every person who touches the item belongs in the record. The quickest way to open a gap in it is to accept help. |
| `seal_the_bag_with_office_tape_fr` | Seal the bag with office tape from the drawer | The evidence tape is in the other car and the front desk has a dispenser | Office tape lifts off paper and goes back down leaving nothing behind, so the package looks closed while being unable to report on whether it stayed closed | Tamper-evident tape is not stationery with a case number written on it. The point of it is the damage it does when somebody takes it off. |
| `fill_in_the_evidence_log_at_shif` | Fill in the evidence log at shift end | Every other report is due at seven anyway, and it is one item | Hours pass in which the item's only record is memory; the times eventually written are remembered times, so the log stops being contemporaneous and becomes a reconstruction | The log is a contemporaneous record. Written afterward it becomes a reconstruction, and everyone who reads it later has to take your word for the gap. |

The last one is deliberately the near-twin of required action 8. A distractor that is the *deferred* version of a required action is the sharpest kind available in this engine: the learner is not choosing between right and obviously-wrong, they are choosing between now and later, which is the choice that is actually made in the field.

## 5. Content — the companion doc

This is the exact text of `docs/exemplars/evidence-intake.companion.txt`. `INTRO:`, `OPENING:`, `EXPERTNOTE:` and every `Outcome:`/`Consequence:`/`Note:` are each one physical line.

```
TITLE: Evidence Intake
INTRO: A rear door at the Cottonmill Veterinary Clinic was pried open overnight, and the tool used on it is still lying inside the doorway. Your job this morning is to bring that one item back to the Ashmoor County evidence room with a record complete enough to be read months from now by someone who was never at the scene. Ashmoor County, its sheriff's office, its evidence manual and everyone named here are fictional. What follows is one fictional agency's standard operating procedure, written to teach the reasoning behind evidence handling; it is not a standard, and the policy of the agency you work for governs how you actually do this work. By the end of this exercise you will be able to sequence an evidence intake so that every step that destroys information happens after the step that records it, and to say what each link in a chain of custody is actually protecting. More than one order is correct here. Work the procedure in an order you can defend, and read what each action does to the scene before you choose the next one.
OPENING: It is 06:40 on a Tuesday. Deputy Ruben Alcaraz has met you at the clinic's rear door, which was forced at the latch and stands half open, and a cash box is missing from the front desk. A flat steel pry bar is lying on the tile about a foot inside the doorway. Nadia Oyelaran, the clinic's office manager, opened up this morning, found the door and called it in; she is waiting in the parking lot with two staff members, and a delivery van has just pulled up to the same door. Nothing has been moved. The bar is yours to bring in.
EXPERTNOTE: The expert path is not a single order. Two things have to be true before the bar moves: the scene is under control, and the bar's position exists somewhere other than in your memory. Photographs and a measured sketch are two independent records of the same undisturbed scene, so whichever you take first is a matter of light and preference rather than procedure. Gloves are the same kind of choice - any time before you touch the bar is the right time. After the bar is in the bag the order stops being flexible, because from there each step is what gives the next one its meaning: a seal only reports on itself if your initials cross it, a label is only findable if the log carries the same number, and a handoff is only continuous if the entry exists before the package leaves your hands.

ACTION: Secure the scene and control who enters it (required)
Outcome: Deputy Alcaraz takes the parking lot side and turns the delivery driver back to the street. The clinic staff move around to the front of the building, and one deputy starts a log of everyone who crosses the tape. The scene stops changing while you work in it.

ACTION: Put on a fresh pair of examination gloves (required)
Outcome: You glove up from the box in your kit rather than reusing the pair in your jacket pocket. Whatever is on the bar stays on the bar, and nothing of yours joins it.

ACTION: Photograph the item where it lies (required, after: Secure the scene and control who enters it)
Outcome: Three frames: the doorway from inside the corridor, the bar in relation to the forced latch, and a close overall with a scale card alongside it. The bar's position now exists in something other than your memory.
Consequence: You are photographing a scene that is still open. Behind you the delivery driver has stepped through the doorway to see what happened, and the frames you just shot record a room that has already had two extra people in it. Whether they show the doorway as the burglar left it is now a question nobody can answer.
Note: A photograph of an uncontrolled scene records the scene at the moment the shutter opened and nothing earlier than that.

ACTION: Sketch the room and measure the item's position (required, after: Secure the scene and control who enters it)
Outcome: You draw the corridor, the rear door and the front desk, then fix the bar with two measurements: fourteen inches from the door jamb and thirty-one inches from the north wall. The sketch carries the case number, the date, your name and a north arrow.
Consequence: You are measuring to a doorway people are still walking through. One of your reference points is a door somebody has since pushed further open, so the numbers on the sketch describe a room that no longer matches the one in the report, and nothing on the page says which version it was.
Note: A measurement is only as good as the scene it was taken in. Control the access first, then fix the item to something that will still be there tomorrow.

ACTION: Collect the item and place it in an evidence bag (required, after: Put on a fresh pair of examination gloves, Photograph the item where it lies, Sketch the room and measure the item's position)
Outcome: You lift the bar by its flat faces, keeping clear of the pry end, and set it into a paper evidence bag large enough that nothing has to be forced. The bag goes on the clean side of your kit and never on the floor.
Consequence: The bar comes up before the scene has finished being recorded. Whatever was still missing - the photographs, the measurements, or clean gloves between your hand and the steel - cannot be supplied afterward, because the only thing that could have supplied it was the bar lying where you found it.
Note: Collection is the one step that cannot be undone. Everything that documents the item where it was found has to exist before the item moves.

ACTION: Seal the evidence bag with tamper-evident tape (required, after: Collect the item and place it in an evidence bag)
Outcome: You fold the mouth of the bag over twice and run tamper-evident tape the full width of the fold, pressing it down until no edge lifts. The package is now closed in a way that shows whether it has been opened.
Consequence: There is nothing in the bag to seal. A sealed empty bag is not a package, it is one more object at the scene that you will have to account for later, and the bar is still on the tile where you left it.
Note: A seal is an act performed on a filled bag. Its whole value is that it was applied once, at collection, and has not been disturbed since.

ACTION: Label the sealed bag and initial across the seal (required, after: Seal the evidence bag with tamper-evident tape)
Outcome: You write the case number, the item number, the date and time, the recovery location and your name on the face of the bag, then initial and date across the tape so that each mark runs onto the paper on both sides of it.
Consequence: You are writing on a bag that is still open. Initials that do not cross a seal record only that you were holding a pen, because the whole purpose of the mark is that it cannot survive the tape being lifted and put back.
Note: The initials belong to the seal, not to the label. They only do their work when they run across the tape and onto the bag on both sides.

ACTION: Record the item on the agency evidence log (required, after: Label the sealed bag and initial across the seal)
Outcome: You enter the case number, item one, a short description of the bar and its approximate length, the recovery location, the time of collection and your name. The entry matches the face of the bag word for word.
Consequence: You are logging a package that carries no number yet. The entry you make now describes an item you will have to identify all over again when you finally label the bag, and the two records can only agree by luck.
Note: The log and the label are one record kept in two places. Write the label first and copy it across, and the two of them cannot disagree.

ACTION: Transfer the sealed package to the evidence custodian (required, after: Record the item on the agency evidence log)
Outcome: You carry the bag to the evidence room and hand it to custodian Hana Yamashiro, who checks the seal against the label, signs the transfer line and gives you the receipt copy. Custody has changed hands once, on paper, with both of you standing there.
Consequence: You are handing over a package the log does not know about. From the moment it leaves your hands with no entry behind it, the only account of where it has been since the clinic is your recollection, and the custodian has nothing to sign against.
Note: A transfer is a documented event. If the log entry does not exist first, the handoff was not recorded, it was only remembered.

ACTION: Move the item into better light before photographing it (distractor)
Consequence: You slide the bar a foot toward the doorway and the frames come out much better. They are also frames of a position you created. The measurements you take next will describe where you put the bar, and no later photograph can put it back: the relationship between the bar, the jamb and the pry marks existed once, and you have just spent it.
Note: A clear photograph of the wrong position is worth less than a poor photograph of the right one. Light is a problem to solve with a flash rather than with your hands.

ACTION: Hand the item to the reporting party to hold (distractor)
Consequence: Nadia Oyelaran takes the bar willingly and holds it while you finish the sketch. She is now a person who has handled the item, and she is not in your log, not in your photographs and not wearing gloves. Everything that follows has an unrecorded pair of hands in the middle of it.
Note: Every person who touches the item belongs in the record. The quickest way to open a gap in it is to accept help.

ACTION: Seal the bag with office tape from the drawer (distractor)
Consequence: The clinic's front desk has a tape dispenser and the bag closes neatly. Office tape lifts off a paper bag and goes back down leaving nothing behind, so the package now looks closed while being unable to say whether it stayed that way. The seal is the only part of the package that reports on itself.
Note: Tamper-evident tape is not stationery with a case number written on it. The point of it is the damage it does when somebody takes it off.

ACTION: Fill in the evidence log at shift end (distractor)
Consequence: The bag goes in the front seat and you plan to write it up with the rest of the paperwork at seven. For the next several hours the only record of where the item has been is your memory, and the times you eventually write down will be the times you remember rather than the times that happened.
Note: The log is a contemporaneous record. Written afterward it becomes a reconstruction, and everyone who reads it later has to take your word for the gap.
```

## 6. Witness score walkthrough and verification

Every number in this section is output from the real modules, produced by running the §5 doc through `parseProcessCompanionDoc` → `validateProcessConfig` → `beginProcedure`/`attemptAction` (`state.ts`) → `scoreComponents`/`scoreProcess` (`scoring.ts`). None of it is arithmetic done by hand.

### Parse and validation

| Check | Result |
| --- | --- |
| `parseProcessCompanionDoc` report | **0 issues** (0 errors, 0 warnings, 0 info) |
| `validateProcessConfig` | `ok: true` |
| actions parsed | 13 (9 required, 4 distractors) |
| prerequisite edges | 9 |
| legal orders of the required actions | 8 |
| `intro` length | 1043 characters (cap 5000) |
| `opening` length | 536 characters (cap 2000) |
| `expertNote` length | 797 characters (cap 3000) |
| longest label | 55 characters (cap 200) |
| longest `outcome` | 266 characters (cap 1500) |
| longest `consequence` | 347 characters (cap 1500) |
| longest `consequenceNote` | 165 characters (cap 300) |
| banned words in the config | `admissible` **absent**, `thrown out` **absent** |

### Scoring, restated for this config

Spec §4, with |R| = 9. `clean` = required actions never attempted prematurely; `totalAttempts` = 9 + every illegal click (premature required actions *and* distractor hits).

> correctness = clean ÷ 9  ·  efficiency = 9 ÷ totalAttempts  ·  pct = round( (60·correctness + 40·efficiency) )

computed as one integer quotient — `num = 60·clean·totalAttempts + 40·9·9`, `den = 9·totalAttempts`, `Math.round(num/den)` — with a single half-up round at the end.

### The witness path — "the eager collector"

One learner path, locked as a test fixture in `tests/exemplar-content.test.ts`. It is a *competent but hurried* run: the learner reaches for the camera before the scene is under control, goes back for the bar three times before all three of its prerequisites are met, tries two shortcuts, and gets the tail of the procedure almost right — logging before labelling once, then reaching for the "do it later" option. Sixteen clicks, seven of them illegal.

| # | Click | Result |
| --- | --- | --- |
| 1 | Photograph the item where it lies | **illegal** — scene not secured |
| 2 | Secure the scene and control who enters it | legal |
| 3 | Photograph the item where it lies | legal |
| 4 | Collect the item and place it in an evidence bag | **illegal** — no gloves, no sketch |
| 5 | Move the item into better light before photographing it | **illegal** — distractor |
| 6 | Sketch the room and measure the item's position | legal |
| 7 | Collect the item and place it in an evidence bag | **illegal** — still no gloves |
| 8 | Put on a fresh pair of examination gloves | legal |
| 9 | Collect the item and place it in an evidence bag | legal |
| 10 | Seal the bag with office tape from the drawer | **illegal** — distractor |
| 11 | Seal the evidence bag with tamper-evident tape | legal |
| 12 | Record the item on the agency evidence log | **illegal** — bag not labelled |
| 13 | Label the sealed bag and initial across the seal | legal |
| 14 | Fill in the evidence log at shift end | **illegal** — distractor |
| 15 | Record the item on the agency evidence log | legal |
| 16 | Transfer the sealed package to the evidence custodian | legal — last required action, debrief |

Resulting `attempts` map, printed from the live `ProcessState` at the debrief:

| action id | illegal attempts |
| --- | --- |
| `photograph_the_item_where_it_lie` | 1 |
| `collect_the_item_and_place_it_in` | 2 |
| `move_the_item_into_better_light` | 1 |
| `seal_the_bag_with_office_tape_fr` | 1 |
| `record_the_item_on_the_agency_ev` | 1 |
| `fill_in_the_evidence_log_at_shif` | 1 |

`scoreComponents` → `{ totalRequired: 9, cleanCount: 6, totalAttempts: 16 }`. Three required actions carry a premature attempt (photograph, collect, log), so six of nine are clean; nine legitimate completions plus seven illegal clicks make sixteen attempts.

> **correctness = 6/9** · **efficiency = 9/16**

| Term | Product |
| --- | --- |
| 60 · clean · totalAttempts | 60 · 6 · 16 = **5760** |
| 40 · \|R\| · \|R\| | 40 · 9 · 9 = **3240** |
| numerator | 5760 + 3240 = **9000** |
| denominator | \|R\| · totalAttempts = 9 · 16 = **144** |
| num ÷ den | **62.5** |
| `Math.round` (half up) | **63** |

> ### `scoreProcess(...).totalPct === 63`

This fixture is chosen to land exactly on `.5`: it is the process-simulator's one path that pins spec §4's "one final round-half-up" ruling to a number. If the rounding ever drifts to banker's rounding this test goes to 62 and fails, which is the point. **Do not "improve" this path** — adding or removing a single click moves `totalAttempts` off 16 and the boundary is gone.

**Debrief step review for this path** (spec §3's three palettes, all three exercised):

| Action | Debrief status |
| --- | --- |
| Secure the scene / gloves / sketch / seal / label / transfer | clean first try — best/green (6 rows) |
| Photograph the item where it lies | done after 1 failed attempt — ok/amber, with its `consequenceNote` |
| Collect the item and place it in an evidence bag | done after 2 failed attempts — ok/amber, with its `consequenceNote` |
| Record the item on the agency evidence log | done after 1 failed attempt — ok/amber, with its `consequenceNote` |
| Move the item into better light… / Seal the bag with office tape… / Fill in the evidence log at shift end | attempted distractor — poor/red, with `consequenceNote` and attempt count 1 |
| Hand the item to the reporting party to hold | never attempted — no row |

### The other two runs, for score ranking

Same config, same real functions.

| Run | clean | totalAttempts | correctness | efficiency | exact | `totalPct` |
| --- | --- | --- | --- | --- | --- | --- |
| **Flawless** — 9 clicks, secure → photograph → sketch → gloves → collect → seal → label → log → transfer | 9 | 9 | 9/9 | 9/9 | 8100/81 = 100 | **100** |
| **Witness** — "the eager collector", 16 clicks | 6 | 16 | 6/9 | 9/16 | 9000/144 = 62.5 | **63** |
| **Messy** — 19 clicks: collect first, three more premature collects, four distractor hits, premature label and premature transfer | 5 | 19 | 5/9 | 9/19 | 8940/171 = 52.28… | **52** |

The flawless run demonstrates the other end of the flexibility claim: it uses the *non-obvious* order — sketch before gloves, gloves fourth — and still scores 100, because none of those choices crosses an authored edge.

**The 60-floor, made concrete.** Spec §4's deliberate property is that correctness is blind to distractor hits, so a learner who never triggers a premature required action floors at 60 however much they flail. Run the flawless order with 99 clicks on one distractor and `scoreProcess` returns correctness 9/9, efficiency 9/108, **`totalPct` 63** — numerically the same as the witness path, arrived at from the opposite direction. That coincidence is worth showing a dean: this engine grades *knowing the order* at 60 points and *working efficiently* at 40, and it says so out loud in the debrief's score line rather than hiding it in a curve.

### No-giveaway gates

Spec §7's machine gates for a flat action pool. Word count is `label.trim().split(/\s+/).length` on the parsed label, matching the gate in `tests/exemplar-content.test.ts`.

| Pool | word counts (doc order) | n | mean |
| --- | --- | --- | --- |
| required labels | 8, 8, 6, 8, 10, 7, 9, 8, 8 | 9 | **8.0000** |
| distractor labels | 9, 9, 9, 8 | 4 | **8.7500** |
| all labels | — | 13 | **8.2308** |

| Gate | Measured | Limit | Result |
| --- | --- | --- | --- |
| \|mean(required) − mean(distractor)\| ≤ 0.15 · mean(all) | **0.7500** | 1.2346 | **pass** |
| a distractor is the uniquely **longest** label in the pool | longest is 10 words, held by **required** `Collect the item and place it in an evidence bag`, uniquely | must be false | **pass** |
| a distractor is the uniquely **shortest** label in the pool | shortest is 6 words, held by **required** `Photograph the item where it lies`, uniquely | must be false | **pass** |

Both extremes of the pool are required actions, and the two extremes are held uniquely — so a learner who tries to game the menu by label length is led toward two actions they are supposed to take. Tone is not machine-checkable and is an SME-review item: no distractor is signposted by hedging language, none of them says "just" or "quickly", and all four are written in the same flat imperative as the required actions.

## 7. Sources

The county, the sheriff's office, the clinic, every person and every document are fictional. The professional content the prerequisite graph encodes:

- U.S. Department of Justice, National Institute of Justice, *Crime Scene Investigation: A Guide for Law Enforcement* — the sequence this procedure is modeled on: scene control before documentation, photography and sketching as parallel documentation of an undisturbed scene, and collection as the point after which the scene cannot be re-documented.
- National Institute of Standards and Technology / NIJ, *Crime Scene Investigation: Guides for Law Enforcement* — evidence packaging and sealing practice, including the convention that initials and date are written across the seal and onto the container so the mark is broken if the seal is lifted.
- Scientific Working Group on Materials Analysis (SWGMAT) and the Organization of Scientific Area Committees for Forensic Science, evidence-handling guidance — contamination control at the point of contact, and the rule that packaging follows collection rather than preceding it.
- International Association for Property and Evidence, *Professional Standards* — the property-room side of the procedure: contemporaneous logging, the transfer as a documented event signed by both parties, and the receipt copy.
- ASTM E1188 and E1459, standard practices for the collection and marking of evidence by a technical investigator — item numbering and the requirement that the record on the package and the record in the log correspond.
- Fisher and Fisher, *Techniques of Crime Scene Investigation* — the general case for treating collection as an irreversible act and for documenting position by two independent means.

Citations are for the reviewer and the SME. Nothing is quoted in learner-visible text, no real agency's manual is reproduced or paraphrased as authoritative, and the intro's scope statement says explicitly that the learner's own agency's policy governs.

## 8. Images

None, in the starter and in the delivery zip alike.

The process engine's v1 has no header image on the Brief step by design (spec §3 — the brand band is a color only), and the content model has no image field of any kind: the situation log, the action menu and the debrief are text throughout. This exemplar is authored entirely through the companion doc, so it carries no assets and no `alt-policy.md` acceptance record is required.

## 9. Transcription checklist

- [ ] `docs/exemplars/evidence-intake.companion.txt` is byte-for-byte the fenced block in §5 (a `#` comment header may be prepended; nothing inside may change).
- [ ] `parseProcessCompanionDoc` returns **zero issues of any severity**, not merely zero errors; `validateProcessConfig` returns ok.
- [ ] The starter in `src/lib/engines/process-simulator/starters.ts` (group `"exemplar"`) is the parse result — 13 actions, 9 required, 4 distractors, 9 prerequisite edges.
- [ ] Byte-parity test: `serializeProcessCompanionDoc({...starterConfig, title: label})` equals the committed `.companion.txt`.
- [ ] No required label contains `,`, `(` or `)`; every `after:` clause resolves by label with no ambiguity error.
- [ ] The graph is exactly the nine edges in §4 — in particular **there is no edge between `Photograph the item where it lies` and `Sketch the room and measure the item's position` in either direction**, and 8 legal orders are asserted. A "tidy-up" that chains them destroys the exercise.
- [ ] Witness walkthrough asserted through the REAL state machine and scoring: `cleanCount` 6, `totalAttempts` 16, correctness 6/9, efficiency 9/16, **`scoreProcess(...).totalPct === 63`** from an exact 62.5.
- [ ] Flawless run asserted at 100; messy run asserted at 52.
- [ ] No-giveaway gates asserted: pooled band 0.7500 ≤ 1.2346; longest (10 words) and shortest (6 words) labels in the pool are both required actions.
- [ ] Banned-words test: `admissible` and `thrown out` absent from every learner-visible string in the config.
- [ ] The scope statement in §4 appears verbatim inside `INTRO:`.
- [ ] SME rationale in §4 and §6, the source list in §7, and every annotation in this brief are **not** transcribed into the config.
- [ ] Export zip under 40 KB via the real assemble path.
