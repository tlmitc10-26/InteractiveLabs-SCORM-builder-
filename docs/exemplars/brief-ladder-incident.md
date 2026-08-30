# Content brief: The Ladder Incident

**Slug:** `ladder-incident` · **Engine:** case-workspace · **Standalone** (occupational safety and health)
**Authored through:** the case companion-doc format (spec §6, grammar shipped in M2). The doc in §5 of this brief is the source of truth; the starter config is its parse result.
**Shape:** 7 artifacts (5 text, 2 table), 3 conclusions, 13 reasons, 11 expert-map entries, mode `best-supported`.
**Status:** content complete; transcribe verbatim, invent nothing.

---

## 1. Learning objective

Learner-visible, appears in the interactive's intro:

> By the end of this case you will be able to distinguish the condition that caused an incident from the conditions that merely contributed to it, and to say what a given record does and does not establish.

## 2. Discipline pattern

Occupational safety is taught almost everywhere — as a standalone certificate, as a required module inside construction management, nursing, logistics, engineering technology and hospitality, and as the compliance training every employer buys. Almost all of it teaches rules: this is the standard, here is the checklist, here is the quiz. The work itself is nothing like that. An investigator arrives after the fact, with a partial record assembled by people who were not neutral, and has to decide which of several defensible stories the evidence actually carries — knowing that the finding determines whether the organization buys an inspection program or writes up an employee.

That decision is a reasoning task, not a recall task, and it fails in a characteristic direction. The person nearest the injury is the easiest thing in the file to see; there is nearly always *some* evidence pointing at them; and a finding of employee error is cheaper than a finding of equipment failure. The case below is built so that the employee-error story is genuinely defensible on the record and still second best, and so that the systemic story a safety-minded student reaches for first is the one the evidence contradicts. Nobody in it behaves badly. The same shape transfers directly to root-cause analysis in health administration, quality investigation in manufacturing, incident review in IT operations, and Title IX or HR fact-finding — every field where a professional has to say which explanation the record will bear.

## 3. Notation for transcription

- The companion doc in §5 is authored by hand and imported through `parseCaseCompanionDoc`. It parses with **zero** issues of **any** severity — not merely zero errors — and the parsed config becomes the committed starter.
- Ids are what `uniqueSlug` produces from titles and labels, truncated at 32 characters. The witness walkthrough in §6 is keyed by those ids, printed from the real parse.
- Credit markers in the doc map to schema credit: `(best)` → `full`, `(defensible)` → `partial`, `(unsupported)` → `none`.
- Reason markers are `(SOUND)` and `(FLAWED: <note>)`, anchored at end of line. The note becomes `flawNote` and is learner-visible in the debrief; it must **name** the reasoning flaw, not merely disagree with the reason.
- `Source:` sits on the line immediately after its `ARTIFACT:` line; `Caption:` immediately after that on table artifacts; `Rationale:` immediately after its `CONCLUSION:` line. Nowhere else — artifact bodies are opaque, which is why the SOP excerpt's `4.2 Pre-use inspection.` lines and the incident report's prose are safe.
- No title or label contains `(`, `->`, ` supports ` or ` contradicts `, so the doc carries no header warnings and every `MAP:` line resolves by title.
- Every `MAP:` line states its strength explicitly; an omitted strength would default to weak with an info note and break the zero-issue requirement.
- **Reason length is not a quality cue** (standing rule, reformulated for this engine per spec §7): pooled across the config, a flawed reason may be the uniquely longest reason of its conclusion in at most 40% of conclusions and the uniquely shortest in at most 40%. Measured numbers are in §6.
- SME notes in §6 are review rationale — **brief-only**, never in the config and never shown to the learner.

## 4. Configuration summary

| Field | Value |
| --- | --- |
| `title` | The Ladder Incident |
| `scoringMode` | `best-supported` |
| `headerColor` | not set (schema default brand band; editor-only, not representable in the doc) |
| artifacts | 7 (5 `text`, 2 `table`) |
| conclusions | 3 (one `full`, one `partial`, one `none`) |
| reasons | 13 (7 sound, 6 flawed) |
| `expertMap` | 11 entries; 1 artifact deliberately unmapped |

**The situation (learner-facing framing):** an inventory associate at a fictional distribution company falls from a stepladder in a returns aisle and is seriously hurt. The learner is the investigator. The injured employee has no memory of the minute before the fall, so the case can only be decided from the documentary record.

**Cast** (all fictional, as is the employer): Marisol Quintero, inventory associate, injured; Ehsan Farhadi, shift supervisor, who filed the report and did not see the fall; Curtis Boyd, facilities technician, who performs the ladder inspections; Jinhee Park, order picker, the only witness; Tanya Okonkwo, EHS manager; the examination is signed out by Vantage Materials Testing, an outside laboratory. Northline Fulfillment, its Building 4, and every document reproduced below are invented for this exercise.

**Artifacts**

| # | id | title | kind | role in the case |
| --- | --- | --- | --- | --- |
| 1 | `incident_report` | Incident report | text | the frame; carries both the separated rail and the tote's landing position |
| 2 | `ladder_examination_report` | Ladder examination report | text | the decisive artifact; fractography dates the crack |
| 3 | `witness_statement` | Witness statement | text | one probative detail, one character-evidence trap |
| 4 | `ladder_inspection_log` | Ladder inspection log | table | **reads clean at a glance; the asset-tag column is the case** |
| 5 | `training_records` | Training records | table | closes off the inadequate-training conclusion |
| 6 | `ladder_safety_procedure` | Ladder safety procedure | text | the standard: specific, and in force before the incident |
| 7 | `peak_season_overtime_notice` | Peak season overtime notice | text | **red herring — unmapped** |

Three of these are load-bearing for the design brief's requirements:

- **Superficially favors the wrong conclusion.** The inspection log shows six consecutive monthly `Pass` results, the most recent one week before the fall. Read quickly it says the equipment was fine, which points at the employee. The witness statement does the same job in prose: it volunteers that the injured associate "moves fast" and once stood on a top cap.
- **Rewards careful reading.** The same log's `Asset tag` column changes from `L-14` to `L-12` at the November row. The ladder that failed was last inspected on 2 October, four months and ten days before the fall; the four reassuring recent rows belong to a different unit. This is the single reading on which the case turns, and nothing in the interactive points at it.
- **Red herring.** The overtime notice is dramatic, dated two months before the incident, and invites a fatigue narrative. Its own text forecloses that narrative twice — ten-hour shifts were voluntary in returns, and facilities stayed on its existing schedule — and the incident report records the associate on a standard eight-hour shift, her second day back from leave. The expert map gives it no entry against any conclusion, which is how this engine says "irrelevant". Including it costs the learner nothing and gains nothing, and one flawed reason under conclusion 3 exists specifically to show what happens when it is treated as causal.

**Conclusions**

| # | id | label | credit | reasons |
| --- | --- | --- | --- | --- |
| 1 | `the_ladder_failed_structurally` | The ladder failed structurally | `full` | 5 (3 sound, 2 flawed) |
| 2 | `the_employee_s_own_actions_cause` | The employee's own actions caused the fall | `partial` | 4 (2 sound, 2 flawed) |
| 3 | `training_and_procedures_at_the_s` | Training and procedures at the site were inadequate | `none` | 4 (2 sound, 2 flawed) |

**Named reasoning flaws taught by `flawNote`** — every flawed reason names its flaw rather than merely contradicting itself:

| Conclusion | Flawed reason | Named flaw |
| --- | --- | --- |
| 1 | the file records no proof the ladder was sound | absence of evidence treated as evidence |
| 1 | the ladder was unsafe from the day it left the factory | overreach beyond what the report finds |
| 2 | Park says she always moves fast | character reasoning |
| 2 | she was reaching, so the reach brought her down | post hoc |
| 3 | someone was badly hurt, so the program was inadequate | overreach from an outcome to a system |
| 3 | the gap starts the month shifts changed | post hoc |

**Expert map** (11 entries; absent pair = irrelevant)

| Artifact | Conclusion 1 | Conclusion 2 | Conclusion 3 |
| --- | --- | --- | --- |
| Incident report | supports (weak) | supports (weak) | — |
| Ladder examination report | supports (**strong**) | contradicts (**strong**) | — |
| Witness statement | supports (weak) | — | supports (weak) |
| Ladder inspection log | supports (weak) | — | supports (weak) |
| Training records | — | — | contradicts (**strong**) |
| Ladder safety procedure | — | supports (weak) | contradicts (**strong**) |
| Peak season overtime notice | — | — | — |

The witness statement is deliberately mapped to two different conclusions and to neither of them as strong: the sound of a crack before the fall is weak support for equipment failure, and "I could not tell you the last time I saw anyone look one over" is weak support for a procedural finding. The same statement's remarks about how the injured associate generally works are mapped nowhere at all, because they are not evidence about this fall — the point the conclusion-2 `flawNote` makes explicitly.

## 5. Content — the companion doc

This is the exact text of `docs/exemplars/ladder-incident.companion.txt`. `INTRO:` is one physical line.

```
TITLE: The Ladder Incident
INTRO: Just after nine in the morning on 12 February 2026, an inventory associate at Northline Fulfillment's Building 4 fell from a stepladder in the returns aisle and was seriously hurt. You have been assigned the investigation. Northline Fulfillment, its employees and every document here are fictional, and this is a teaching case about how investigators reason from evidence rather than guidance for any real incident. Read the artifacts, add the ones you find probative to your case file, and commit to the conclusion you can defend. By the end you will be able to distinguish the condition that caused an incident from the conditions that merely contributed to it, and to say what a given record does and does not establish. Three explanations are on offer and the evidence is genuinely mixed. One of them is better supported than the others, and finding out which one takes reading the records closely rather than quickly.
MODE: best-supported

ARTIFACT: Incident report (text)
Source: Northline Fulfillment incident report NF-2026-018, filed by E. Farhadi, shift supervisor
At approximately 09:20 on 12 February 2026, inventory associate Marisol Quintero fell from a portable stepladder in Aisle 12 of Building 4 while retrieving a returns tote from the third rack level. Quintero was working a standard eight-hour shift, her second shift back after four scheduled days off. She was found on the floor by order picker Jinhee Park, treated on site, and transported. Recorded injuries are a fractured left wrist and a concussion.

The ladder is an eight-foot fiberglass stepladder, asset tag L-14, rated at 300 pounds. It was found lying on its right side with the rear left rail separated from the top cap. Quintero's weight together with the tote is recorded as 214 pounds. The tote was found on the floor about five feet to the left of the ladder's base. The base itself had not moved from the position marked by the floor tape.

Farhadi did not witness the fall and reached Aisle 12 roughly ninety seconds afterward. Quintero has given no statement: she has no recollection of the minute before the fall, which the treating clinician attributed to the head injury. The ladder was tagged, impounded the same day, and released to an outside laboratory for examination.

ARTIFACT: Ladder examination report (text)
Source: Vantage Materials Testing report VMT-4471, examination of asset L-14, 3 March 2026
The ladder arrived sealed and was examined as received. The rear left rail is separated from the top cap at the upper rivet hole. The separation runs through the rail wall from the rivet hole to the outer edge, a distance of about one and one quarter inches.

Under magnification the fracture surface has two distinct regions. About seventy percent of the surface, measured outward from the rivet hole, is discolored and oxidized and carries beach markings consistent with a crack that opened and closed repeatedly over an extended period. The remaining thirty percent is bright, clean and free of oxidation, consistent with final separation at the time of the incident. The oxidized region cannot have formed at the moment of failure.

The rail material meets specification and the fracture shows no manufacturing defect. The recorded load of 214 pounds is well inside the ladder's 300 pound rating; with seventy percent of the rail section already cracked, the remaining section would separate under loads far below that rating.

A hairline separation at the rail-to-cap joint would have been visible on close examination of that joint, which is item six of the manufacturer's inspection checklist. It would not be visible from the floor or from the front of the ladder.

ARTIFACT: Witness statement (text)
Source: Statement of Jinhee Park, order picker, taken 12 February 2026
I was pulling from Aisle 14, two aisles over. I heard a crack, like a pallet board going, and then a second later the ladder and Marisol coming down. I did not see her fall. By the time I came around the end cap she was already on the floor.

Marisol moves fast. Everybody on returns moves fast, it is how the shift gets cleared. I saw her stand on the top cap of a different ladder back in the summer and I said something to her about it. I do not know what she was doing this time.

Nobody uses those ladders except returns. I could not tell you the last time I saw anyone look one over.

ARTIFACT: Ladder inspection log (table)
Source: Northline Fulfillment facilities inspection log, Building 4, extract
Caption: Monthly portable ladder inspections recorded for the Building 4 returns area
| Date | Asset tag | Inspector | Result |
| 2025-09-04 | L-14 | C. Boyd | Pass |
| 2025-10-02 | L-14 | C. Boyd | Pass |
| 2025-11-06 | L-12 | C. Boyd | Pass |
| 2025-12-04 | L-12 | C. Boyd | Pass |
| 2026-01-08 | L-12 | C. Boyd | Pass |
| 2026-02-05 | L-12 | C. Boyd | Pass |

ARTIFACT: Training records (table)
Source: Northline Fulfillment learning management system extract, Building 4
Caption: Safety training on file for the employees named in this case
| Employee | Course | Completed | Score |
| M. Quintero | Portable ladder safety | 2025-11-18 | 92 percent |
| M. Quintero | Fall hazard awareness | 2025-06-03 | 88 percent |
| C. Boyd | Portable ladder inspection | 2025-08-21 | 95 percent |
| C. Boyd | Lockout and tagout | 2025-04-14 | 90 percent |
| J. Park | Portable ladder safety | 2025-11-18 | 84 percent |

ARTIFACT: Ladder safety procedure (text)
Source: Northline Fulfillment SOP 4.12, Portable Ladder Safety, revision 5, effective 1 July 2024
4.1 Scope. This procedure applies to every portable stepladder and extension ladder at a Northline Fulfillment site and to every employee who uses one.

4.2 Pre-use inspection. Before each use the user shall inspect the ladder for cracked, bent or missing parts, including the rails, steps, spreaders, feet and the rail-to-cap joints. A ladder with any crack or deformation shall be red-tagged, removed from service immediately, and reported to facilities within the same shift.

4.3 Documented inspection. Facilities shall inspect every portable ladder at least monthly, record each inspection against the ladder's asset tag, and retain the record for three years.

4.4 Use. Users shall maintain three points of contact, shall not stand above the second step from the top, and shall not reach beyond the side rails. Move the ladder rather than reaching from it.

ARTIFACT: Peak season overtime notice (text)
Source: Building 4 all-staff notice, posted 27 October 2025
Beginning 1 November, Building 4 runs ten-hour shifts Monday through Thursday for the peak returns season. Ten-hour shifts are voluntary for associates in returns and inventory control and mandatory for outbound. Associates who do not opt in stay on the standard eight-hour schedule.

The facilities and maintenance team stays on its existing schedule. Questions to your shift supervisor or to Tanya Okonkwo, EHS manager.

CONCLUSION: The ladder failed structurally (best)
Rationale: The physical evidence settles the mechanism. About seventy percent of the fracture face was oxidized before the day of the fall, which means the rail was already cracked through most of its section while the ladder stayed in service, and the load at separation was well inside the ladder's rating. A defect that had been growing for months, on a unit whose last recorded inspection was more than four months old, is the explanation that accounts for every artifact in the file rather than only some of them.

Naming the ladder as the cause is not the same as saying nothing else went wrong. The inspection log shows a control that was written down and then not performed on this unit, and a reach past the side rail may well have been the loading that finished a rail already cracked. An investigator ranks these. The defect is the condition without which the fall does not happen; the rest are contributing factors. That ranking is what makes the corrective action a ladder inspection and removal program rather than a conversation with one associate.

- About seventy percent of the fracture face is oxidized, so the crack was open and growing well before the morning of the fall. (SOUND)
- The rail separated at a load of 214 pounds against a 300 pound rating, so the failure is not explained by how much weight was on the ladder. (SOUND)
- The log records no inspection of L-14 in the four months before the fall, so a crack at the rail-to-cap joint had time to grow unseen. (SOUND)
- Nothing in the file records the ladder as sound on the morning of the fall, and that silence is itself proof the ladder was defective. (FLAWED: Treats an absence of evidence as evidence. The examination establishes the defect; a gap in the paperwork establishes nothing on its own, and the same move would condemn any ladder with an incomplete file.)
- The examination shows that this ladder was unsafe from the day it left the factory, and every unit from that batch should be pulled. (FLAWED: Overreach. The report finds a fatigue crack that grew over an extended period and expressly finds no manufacturing defect, which is a claim about this unit's recent service life, not about its condition when new.)

CONCLUSION: The employee's own actions caused the fall (defensible)
Rationale: This conclusion is defensible on the record, and it is not the best-supported one. A tote five feet to the left of a ladder base that never moved is real evidence of a reach past the side rail, and reaching past the rails is the specific act SOP 4.12 prohibits. An investigator who got this far is reasoning from evidence rather than from assumption.

What moves it out of first place is the examination report. A rail cracked through seventy percent of its section separates under loads far below the ladder's rating, so the fall is fully explained without any departure from procedure, while a reach on its own does not explain the fracture surface at all. The reach, if it happened, changed when a cracked rail let go rather than whether it would. Investigations that stop at the person nearest the injury are the most common failure mode in this work, and they are common precisely because there is usually some evidence for them.

- The tote was found five feet to the left of a ladder base that had not moved, which is consistent with a reach past the side rail. (SOUND)
- SOP 4.12 prohibits reaching beyond the side rails, and Quintero was current on that training. (SOUND)
- Park says Quintero always moves fast and once stood on the top cap of another ladder, so she was probably careless this time as well. (FLAWED: Character reasoning. A colleague's impression of how someone generally works, plus one unrelated incident months earlier, is not evidence about what this person did on this ladder on this morning.)
- She was reaching to her left when the ladder went over, and the reach is therefore what brought her down. (FLAWED: Post hoc. Two things that happen in the same instant are not thereby cause and effect. The rail separated in that same instant, and the examination shows it would have separated under a load well inside the rating.)

CONCLUSION: Training and procedures at the site were inadequate (unsupported)
Rationale: The instinct behind this conclusion is a good one and the evidence does not carry it. SOP 4.12 is specific about the exact failure mode in this case: it requires inspection of the rail-to-cap joints, immediate red-tagging of any crack, and a documented monthly inspection recorded against the asset tag. The training records show the associate current on ladder safety and the technician current on ladder inspection.

The log does show a real defect in execution, four consecutive months recorded against L-12 while L-14 was left out, and an investigator is entitled to weigh that. But a procedure that was written correctly and then not performed on one unit is a compliance failure rather than an inadequate procedure, and the two findings generate different corrective actions. Calling this one inadequate training would send the site off to rewrite documents that already say the right thing.

- The log records four consecutive monthly inspections against L-12 and none against L-14, so a control the procedure requires was not performed on this ladder. (SOUND)
- Every inspection in the extract was performed and recorded by the same technician with no second check, so a unit left out had no way of being caught. (SOUND)
- An associate was seriously hurt on a routine task, so the site's safety program was not adequate. (FLAWED: Overreach from an outcome to a system. How badly someone is hurt is a function of height and landing, not of program quality, and reasoning backward from harm condemns every program that ever has an incident.)
- The inspection gap starts in November, the month Building 4 went to ten-hour shifts, so the peak season schedule is what degraded the program. (FLAWED: Post hoc. The notice itself says facilities and maintenance stayed on their existing schedule, so the two facts only share a month. A date that lines up is a reason to look, not a finding.)

MAP: Ladder examination report supports The ladder failed structurally (strong)
MAP: Incident report supports The ladder failed structurally (weak)
MAP: Witness statement supports The ladder failed structurally (weak)
MAP: Ladder inspection log supports The ladder failed structurally (weak)
MAP: Incident report supports The employee's own actions caused the fall (weak)
MAP: Ladder safety procedure supports The employee's own actions caused the fall (weak)
MAP: Ladder examination report contradicts The employee's own actions caused the fall (strong)
MAP: Ladder inspection log supports Training and procedures at the site were inadequate (weak)
MAP: Witness statement supports Training and procedures at the site were inadequate (weak)
MAP: Training records contradicts Training and procedures at the site were inadequate (strong)
MAP: Ladder safety procedure contradicts Training and procedures at the site were inadequate (strong)
```

### SME defensibility

Brief-only. These are the grounds on which an occupational-safety investigator would defend each credit level.

- **Conclusion 1, `full`.** Fractography is the standard basis for dating a metal or composite failure, and the two-region fracture surface — an oxidized, beach-marked region and a bright final-separation region — is the textbook signature of progressive cracking followed by overload of the remaining section. The examination also removes the two alternative mechanisms an investigator has to exclude: the load was inside the rating, and the material met specification with no manufacturing defect. The finding is therefore about the *condition* of a specific unit that stayed in service while cracked, which is what makes the corrective action an equipment-control action.
- **Conclusion 2, `partial`.** The reach is a real inference from real evidence — a tote displaced five feet from a base that never moved — and SOP 4.12 §4.4 makes reaching past the side rails a defined departure. An investigator who finds a contributing unsafe act here is not wrong. What they cannot say is that the act *caused* the fall, because a rail cracked through seventy percent of its section is expected to separate under loads far below the rating, so the outcome is fully explained without the act. Partial credit is the exactly right amount: the reasoning is competent and the causal ranking is wrong.
- **Conclusion 3, `none`.** "Inadequate training or procedures" is the finding the record here specifically forecloses. The written procedure names the failure mode (rail-to-cap joints), states the control (monthly documented inspection recorded against asset tag), and states the response (red-tag and remove from service). The training records show both the user and the inspector current. The genuine defect is that the control was not executed on this unit, which is a compliance finding and a different corrective action. Marking this `none` rather than `partial` is deliberate: an exemplar that gives partial credit to the systemic story would teach that "blame the system" is always half right, which is the mirror image of the error conclusion 2 exists to catch.

## 6. Witness score walkthrough and verification

Every number in this section is output from the real modules, produced by running the §5 doc through `parseCaseCompanionDoc` → `validateCaseConfig` → `evidenceRatio` / `reasonRatio` / `scoreCase`. None of it is arithmetic done by hand.

### Parse and validation

| Check | Result |
| --- | --- |
| `parseCaseCompanionDoc` report | **0 issues** (0 errors, 0 warnings, 0 info) |
| `validateCaseConfig` | `ok: true` |
| artifacts parsed | 7 (`incident_report`, `ladder_examination_report`, `witness_statement`, `ladder_inspection_log`, `training_records`, `ladder_safety_procedure`, `peak_season_overtime_notice`) |
| conclusions parsed | 3 (`the_ladder_failed_structurally` `full`, `the_employee_s_own_actions_cause` `partial`, `training_and_procedures_at_the_s` `none`) |
| expert-map entries | 11 |
| intro length | 929 characters (cap 5000) |
| longest artifact body | `ladder_examination_report`, 1294 characters (cap 3000) |
| longest expert rationale | `the_ladder_failed_structurally`, 1064 characters (cap 3000) |
| longest reason text | 158 characters (cap 300) |
| longest flaw note | 214 characters (cap 300) |

### Expert-map gate

Every conclusion needs at least one `supports` entry (spec §2, review #19); the count of those entries is also the evidence denominator for that conclusion (spec §4).

| Conclusion | supports | contradicts | evidence denominator |
| --- | --- | --- | --- |
| `the_ladder_failed_structurally` | 4 — examination (strong), incident report (weak), witness statement (weak), inspection log (weak) | 0 | 4 |
| `the_employee_s_own_actions_cause` | 2 — incident report (weak), safety procedure (weak) | 1 — examination (strong) | 2 |
| `training_and_procedures_at_the_s` | 2 — inspection log (weak), witness statement (weak) | 2 — training records (strong), safety procedure (strong) | 2 |

Total 11 entries, within the 2–96 cap. **Unmapped artifacts: `peak_season_overtime_notice`** — the required red herring, and the editor's unmapped-artifact advisory will list exactly this one.

Note the denominators. Conclusion 3 was given a second supporting artifact deliberately: with a single support its evidence component is all-or-nothing and a learner can max it by finding one document, which would let the `none` conclusion score higher than the design intends. The measured effect is in the comparison table below.

### The witness path — "the careful reader"

One learner path, locked as a test fixture in `tests/exemplar-content.test.ts`. It is a *good but imperfect* run: the learner caught the asset-tag reading in the log, built a case file from the three documents that carry the mechanism, picked up the red herring on the way, left the witness statement out, and then over-claimed with one flawed reason.

| Component | Value |
| --- | --- |
| Case file (`includedIds`) | `incident_report`, `ladder_examination_report`, `ladder_inspection_log`, `peak_season_overtime_notice` |
| Conclusion (`chosenId`) | `the_ladder_failed_structurally` |
| Reasons (`selectedReasonIds`) | `about_seventy_percent_of_the_fra` (sound), `the_log_records_no_inspection_of` (sound), `the_examination_shows_that_this` (**flawed**) |

**evidenceRatio** = max(0, \|included ∩ supports(C)\| − \|included ∩ contradicts(C)\|) ÷ \|supports(C)\|

Included supports: incident report, examination report, inspection log = 3. Included contradicts: none = 0. Supports(C) = 4.

> **evidence = 3/4**

**reasonRatio** = max(0, \|sel ∩ S\| − \|sel ∩ F\|) ÷ \|S\|

Selected sound = 2, selected flawed = 1, sound reasons on this conclusion = 3.

> **reason = 1/3**

**conclusionCredit** — the chosen conclusion's credit is `full`, which `creditRatio` expresses as

> **credit = 2/2**

**total** (`best-supported`, spec §4: (50·e + 30·r + 20·c)/100, combined as one integer product before a single round):

| Term | Product |
| --- | --- |
| 50 · e.num · r.den · c.den | 50 · 3 · 3 · 2 = **900** |
| 30 · r.num · e.den · c.den | 30 · 1 · 4 · 2 = **240** |
| 20 · c.num · e.den · r.den | 20 · 2 · 4 · 3 = **480** |
| numerator | 900 + 240 + 480 = **1620** |
| denominator | 100 · e.den · r.den · c.den = 100 · 4 · 3 · 2 = **2400** |
| 100 · num ÷ den | **67.5** |
| `Math.round` (half up) | **68** |

> ### `scoreCase(...).totalPct === 68`

This fixture is chosen to land exactly on `.5`: it is the one path in the library that pins the spec's "standard round-half-up" ruling to a number. If the rounding ever changes to banker's rounding, this test goes to 67 and fails, which is the point.

**Per-artifact debrief comparison for this path** (the three status palettes from spec §3, computed against the chosen conclusion):

| Artifact | Status |
| --- | --- |
| `incident_report` | included support — best/green |
| `ladder_examination_report` | included support — best/green |
| `ladder_inspection_log` | included support — best/green |
| `witness_statement` | supports, left out — ok/amber |
| `peak_season_overtime_notice` | in the case file, unmapped — no effect on the score |
| `training_records`, `ladder_safety_procedure` | unmapped for this conclusion, not in the case file |

### Best-supported is earned, not signposted

Same case file as the witness path, but with every sound reason of each conclusion selected and no flawed ones — i.e. a learner who reasons perfectly *within* whichever conclusion they picked. All values from `scoreCase`.

| Chosen conclusion | evidence | reason | credit | totalPct |
| --- | --- | --- | --- | --- |
| `the_ladder_failed_structurally` | 3/4 | 3/3 | full | **88** |
| `training_and_procedures_at_the_s` | 1/2 | 2/2 | none | **55** |
| `the_employee_s_own_actions_cause` | 0/2 | 2/2 | partial | **40** |

And with the complete case file — all seven artifacts included, which is what a thorough learner ends up with:

| Chosen conclusion | evidence | reason | credit | totalPct |
| --- | --- | --- | --- | --- |
| `the_ladder_failed_structurally` | 4/4 | 3/3 | full | **100** |
| `the_employee_s_own_actions_cause` | 1/2 | 2/2 | partial | **65** |
| `training_and_procedures_at_the_s` | 0/2 | 2/2 | none | **30** |

Two things worth stating for the reviewer. First, the ordering only becomes the intended 100 / 65 / 30 once the case file is complete: the partial-file table has conclusion 3 above conclusion 2, because a learner who never opened the training records and the SOP has not collected the two artifacts that demolish the systemic story. That is the scoring model working as designed — leaving probative evidence out of the case file protects a weak conclusion — and it is exactly what the amber "left out" chips in the debrief exist to show. Second, conclusion 2 lands at 40 on the partial file because its single included support is cancelled by the included examination report: `max(0, 1 − 1) = 0`. A learner who reads the decisive artifact and still concludes employee error is scored on having read it.

### Reason length is not a quality cue

Spec §7's pooled formulation, computed across all three conclusions. Word count is `text.trim().split(/\s+/).length` on the parsed reason text, matching the gate in `tests/exemplar-content.test.ts`.

| Conclusion | word counts (doc order) | longest | shortest |
| --- | --- | --- | --- |
| `the_ladder_failed_structurally` | 23, 28, 26, 25, 24 | 28, unique, **sound** | 23, unique, **sound** |
| `the_employee_s_own_actions_cause` | 27, 15, 25, 20 | 27, unique, **sound** | 15, unique, **sound** |
| `training_and_procedures_at_the_s` | 25, 28, 17, 24 | 28, unique, **sound** | 17, unique, *flawed* |

| Gate | Measured | Limit | Result |
| --- | --- | --- | --- |
| flawed reason is the uniquely **longest** of its conclusion | 0 of 3 = **0.0000** | ≤ 0.40 | pass |
| flawed reason is the uniquely **shortest** of its conclusion | 1 of 3 = **0.3333** | ≤ 0.40 | pass |

Advisory band: `|mean(words(sound)) − mean(words(flawed))| ≤ 0.15 · mean(words(all))`.

| Quantity | Value |
| --- | --- |
| sound reasons (n = 7) | 23, 28, 26, 27, 15, 25, 28 — mean **24.5714** |
| flawed reasons (n = 6) | 25, 24, 25, 20, 17, 24 — mean **22.5000** |
| all reasons (n = 13) | mean **23.6154** |
| \|mean(sound) − mean(flawed)\| | **2.0714** |
| 0.15 · mean(all) | **3.5423** |
| within band | **yes** |

The one offender is deliberate and disclosed: under conclusion 3, "An associate was seriously hurt on a routine task, so the site's safety program was not adequate" is both the shortest reason and a flawed one. It is short because that is how the argument is actually made in the field — outcome-driven findings are stated briefly and confidently — and lengthening it to hit a metric would make it a worse example of the flaw it teaches. One conclusion in three is inside the gate.

## 7. Sources

The employer, the site, every person, every document and the laboratory are fictional. The professional content the credit levels encode:

- U.S. Occupational Safety and Health Administration, 29 CFR 1910.23 (Ladders) — the general-industry requirements the fictional SOP 4.12 is modeled on, including inspection of ladders for visible defects before initial use in each work shift, prompt removal from service of defective ladders, and the prohibition on using a ladder beyond its rated load or in a manner that puts the user off balance.
- ANSI/ASC A14.5, *Safety Requirements for Portable Reinforced Plastic Ladders*, and ANSI/ASC A14.2 for metal ladders — duty ratings, and the manufacturer inspection-checklist convention the examination report's "item six" refers to.
- U.S. National Institute for Occupational Safety and Health, Fatality Assessment and Control Evaluation (FACE) program, ladder-fall reports — the recurring finding pattern this case is built against: a defective or unmaintained ladder, an inspection program on paper, and an initial finding of employee error.
- ASM International, *ASM Handbook, Volume 11: Failure Analysis and Prevention* — fatigue fractography: beach marks, the distinction between a progressive crack region and a final fast-fracture region, and the inference that oxidation on a fracture surface predates the final separation.
- Center for Chemical Process Safety, *Guidelines for Investigating Process Safety Incidents* — the causal-factor method underlying the brief's central distinction between the condition without which the incident does not occur and the conditions that contribute to it.
- Sidney Dekker, *The Field Guide to Understanding "Human Error"* — the analysis of why investigations terminate at the person nearest the harm, which is the specific failure mode conclusion 2 is designed to make visible rather than to punish.

Citations are for the reviewer and the SME. Nothing is quoted in learner-visible text, and no statement in the interactive could be mistaken for a compliance determination about a real workplace; the intro says so.

## 8. Images

None, in the starter and in the delivery zip alike.

The case engine's v1 has no header image on the Brief step by design (spec §2, review #6) — the brand band is a color only. `kind: "image"` artifacts exist in the schema but are **editor-only**: the companion-doc format has no text representation for the asset picker and the alt-text matrix, and a hand-typed `ARTIFACT: … (image)` line is a line-numbered import error. This exemplar is authored entirely through the doc, so it carries no image artifacts and no `alt-policy.md` acceptance record is required.

## 9. Transcription checklist

- [ ] `docs/exemplars/ladder-incident.companion.txt` is byte-for-byte the fenced block in §5 (a `#` comment header may be prepended; nothing inside may change).
- [ ] `parseCaseCompanionDoc` returns **zero issues of any severity**, not merely zero errors; `validateCaseConfig` returns ok.
- [ ] The starter in `src/lib/engines/case-workspace/starters.ts` (group `"exemplar"`) is the parse result — 7 artifacts, 3 conclusions, 13 reasons, 11 map entries, `scoringMode: "best-supported"`, `title: ""`.
- [ ] Byte-parity test: `serializeCaseCompanionDoc({...starterConfig, title: label})` equals the committed `.companion.txt`.
- [ ] Exactly one conclusion has credit `full`; exactly one `partial`; exactly one `none`.
- [ ] Exactly one artifact is unmapped (`peak_season_overtime_notice`), asserted as ≥ 1 by the red-herring gate.
- [ ] Witness walkthrough asserted through the REAL scoring functions: `evidenceRatio` = 3/4, `reasonRatio` = 1/3, credit `full`, **`scoreCase(...).totalPct === 68`**.
- [ ] Length-cue gate asserted per spec §7's pooled formulation: uniquely-longest-is-flawed 0/3, uniquely-shortest-is-flawed 1/3, both ≤ 0.40; advisory band 2.0714 ≤ 3.5423.
- [ ] The inspection log's `Asset tag` column reads L-14, L-14, L-12, L-12, L-12, L-12 in that order. This is the case; a "tidy-up" that makes the column uniform destroys the exercise.
- [ ] SME notes in §6, the source list in §7, and every annotation in this brief are **not** transcribed into the config.
- [ ] Export zip under 40 KB via the real assemble path.
