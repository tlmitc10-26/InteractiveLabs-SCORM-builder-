# Content brief: Plea Bargain

**Slug:** `plea-bargain` · **Engine:** branching-scenario · **Standalone** (criminal justice)
**Shape:** 2 variables, 6 scenes, 3 endings, one conditional choice.
**Image:** the committed starter ships **image-less**; the Canvas-review zip carries an authored header image on the start scene. See §8.
**Status:** content complete; transcribe verbatim, invent nothing.

---

## 1. Learning objective

Learner-visible, appears in the interactive's intro:

> By the end of this scenario you will be able to evaluate a plea decision by the quality of the process behind it — investigation, disclosure, advice on collateral consequences, and the client's own informed consent — rather than by how the case happens to turn out.

## 2. Discipline pattern

Criminal justice is one of the highest-enrollment online disciplines, and the overwhelming majority of criminal cases end in a plea rather than a trial — yet the trial is what courses simulate, because a trial has a script and a verdict and a plea has neither. The result is graduates who can run a cross-examination and have never sat with a client who has twelve days to decide something irreversible. The teachable content of a plea decision is entirely process: what you investigated, what you disclosed, what you advised, and whose decision it was. That makes it a natural fit for branching, and it makes the *endings* carry the pedagogy: this scenario deliberately includes an ending where the client wins and the representation was thin, because "it worked out" is the single most common way students mis-grade professional judgment. The same shape transfers to nursing, social work, and any field where a professional advises a person who must decide for themselves.

## 3. Notation for transcription

- **Quality words** are the schema's enum: `best`, `acceptable`, `poor` (companion-doc text: `BEST`, `OK`, `POOR`).
- **Scene and ending bodies:** each paragraph becomes one `<p>…</p>`.
- **Feedback lines** are the `feedback` field, learner-visible.
- **SME line** on each choice is a review rationale — **brief-only**, never in the config or shown to the learner.
- **Conditional choice:** one, `showIf: { variableId: "case_strength", comparator: "gte", value: 60 }`.
- `feedbackMode: "debrief"`, `showPathInDebrief: true`.
- **Label length is not a quality cue** (final review, item 1): across this module's multi-choice scenes, the single longest label (by word count) may be the `best` choice in **at most 40%** of them. Best labels are trimmed to their decision essence; acceptable and poor labels carry equally substantive phrasing, never filler. A tie for longest does not count as a cue. `tests/exemplar-content.test.ts` enforces this per starter.

## 4. Configuration summary

| Field | Value |
| --- | --- |
| `title` | Plea Bargain |
| `role` | You are an assistant public defender in Vela County, appointed nine days ago to represent Miguel Santos. |
| `startSceneId` | `the_offer` |
| scenes | 6 (`the_offer`, `the_file`, `the_kitchen_table`, `the_advisal`, `the_recording`, `the_decision`) |
| endings | 3 (`informed_choice`, `outcome_luck`, `plea_unravels`) |
| variables | 2 |
| `feedbackMode` | `debrief` |

**Variables:**

| id | label | initial | min | max | visible |
| --- | --- | --- | --- | --- | --- |
| `client_trust` | Client trust | 55 | 0 | 100 | true |
| `case_strength` | Case strength | 40 | 0 | 100 | true |

**Intro (learner-visible, carries the objective):**

> You are an assistant public defender in Vela County, appointed nine days ago to represent Miguel Santos, 24, charged with second-degree burglary and receiving stolen property. The prosecutor's offer expires in twelve days. Vela County and everyone in this scenario are fictional, and this is a teaching scenario about defense practice rather than legal advice.
>
> By the end of it you will be able to evaluate a plea decision by the quality of the process behind it — investigation, disclosure, advice on collateral consequences, and the client's own informed consent — rather than by how the case happens to turn out. Two things are tracked: **Client trust** and **Case strength**. Watch what happens to them; they do not always move together, and one of them is not a measure of how well you are doing your job.
>
> *(Starter note: add a scene header image in the editor — Image, role, and description on the first scene. Delete this line in your version.)*

**Cast:** Miguel Santos (client, 24, warehouse picker, father of a nine-month-old, lawful permanent resident since age eleven); Teresa Santos (his aunt); Ruben Ortega (his cousin, owner of the car); ADA Karen Trujillo (prosecutor); Judge Alma Ferreira; Dana Okafor (office investigator). All fictional.

## 5. Content

### Scene `the_offer` — "Nine days in"

**Body:**
> Miguel Santos is charged with second-degree burglary and receiving stolen property after a laptop and two power tools taken from a construction trailer turned up in the trunk of the car he was driving. The offer, open for twelve more days: plead to receiving stolen property, eighteen months of probation, $2,400 in restitution, no jail. If he is convicted at trial on the burglary count, the exposure is two to six years. You have had the file for three days and read the police report twice.

| Choice `id` | Label | Quality | Effects | Goes to |
| --- | --- | --- | --- | --- |
| `explain_and_wait` | Meet Santos, walk him through the offer, the exposure and the clock, and ask for no decision today | `best` | `client_trust` +8 | `scene:the_file` |
| `summary_letter` | Send a clear written summary of the offer and the exposure, and schedule the meeting for next week | `acceptable` | `client_trust` +2 | `scene:the_file` |
| `recommend_immediately` | Tell him to take it; probation with no jail on facts like these is a good outcome and he should not gamble | `poor` | `client_trust` -8 | `scene:the_file` |

**Feedback — `explain_and_wait`:**
> The first meeting decides whether a client brings you facts or brings you what he thinks you want to hear. Separating here is the offer from here is your decision is what keeps the decision his.

**Feedback — `summary_letter`:**
> The written record is genuinely valuable. What it cannot do is hear a question: a client reading two to six years alone at a kitchen table tends to decide something before you ever discuss it.

**Feedback — `recommend_immediately`:**
> The recommendation might even turn out to be right, and made before any investigation it is a guess in a suit. Whether to plead is one of the few decisions that belongs to the client alone, and it is only his if he had the information and the room to make it.

**SME defensibility:**
- `explain_and_wait` (best): prompt and complete communication of a plea offer is a core duty, and explicitly deferring the decision preserves the client's authority over it.
- `summary_letter` (acceptable): written communication conveys the offer and satisfies the duty to transmit it; it is weaker practice where the client's understanding cannot be confirmed.
- `recommend_immediately` (poor): advising acceptance before investigating, and framing it as a directive, misallocates a decision reserved to the client.

### Scene `the_file` — "What is actually in the file"

**Body:**
> The state's case is an eyewitness who saw two men near the trailer at 11:40 at night and identified Santos an hour later at the roadside, in the back of a patrol car; a partial fingerprint on the door frame reported as consistent; and the property in the trunk of a car Santos had borrowed from his cousin, Ruben Ortega. Santos says Ortega asked him to move the car. Ortega has not returned your calls. Discovery lists a surveillance recording from a business across the road that has not been produced.

| Choice `id` | Label | Quality | Effects | Goes to |
| --- | --- | --- | --- | --- |
| `investigate_and_compel` | Send Dana Okafor after Ortega and the store, and file a motion to compel the unproduced recording | `best` | `case_strength` +20, `client_trust` +6 | `scene:the_kitchen_table` |
| `work_it_yourself` | Keep calling Ortega yourself and read the report closely; the office investigator is three weeks out | `acceptable` | `case_strength` +6, `client_trust` +2 | `scene:the_kitchen_table` |
| `rely_on_the_report` | The report is detailed and the offer is generous; work from what the state has given you | `poor` | `case_strength` -10, `client_trust` -5 | `scene:the_kitchen_table` |

**Feedback — `investigate_and_compel`:**
> A plea evaluated against an uninvestigated case is not an evaluation; it is a coin flip with paperwork. The unproduced recording is the one item that could move this case in either direction, which is exactly why he needs it before he decides.

**Feedback — `work_it_yourself`:**
> Working the case yourself beats not working it. It still leaves the roadside identification and the missing recording untouched. Caseload is a real constraint; it is not an answer to the question of what you knew.

**Feedback — `rely_on_the_report`:**
> The police report is one party's account of the case, written by the party that has to prove it. Advising on it alone means your client's decision rests entirely on evidence nobody has tested.

**SME defensibility:**
- `investigate_and_compel` (best): independent investigation and enforcement of discovery obligations are prerequisites to competent plea advice, and the duty to investigate does not lapse because a client says he intends to plead.
- `work_it_yourself` (acceptable): defensible triage under caseload pressure, but it leaves the two most consequential evidentiary questions — the show-up identification and the undisclosed recording — unexamined.
- `rely_on_the_report` (poor): reliance on the prosecution's file as the sole factual basis is a recognized failure of the defense investigative function.

### Scene `the_kitchen_table` — "What would you do"

**Body:**
> Santos is 24, works as a warehouse picker, and has a nine-month-old daughter. He asks you the question every client asks: what would you do. He also says twice that he cannot be away from work, and once, quietly, that he does not want Ortega charged.

| Choice `id` | Label | Quality | Effects | Goes to |
| --- | --- | --- | --- | --- |
| `advise_and_reserve` | Give him your honest read of the risk on both paths, and be clear the choice is his | `best` | `client_trust` +8 | `scene:the_advisal` |
| `decline_to_advise` | Tell him you cannot make this decision for him, and lay out the two paths without a recommendation | `acceptable` | `client_trust` -2 | `scene:the_advisal` |
| `predict_acquittal` | Tell him you like the case; the identification is weak, the fingerprint is partial, and no jury convicts on this | `poor` | `client_trust` +6 | `scene:the_advisal` |

**Feedback — `advise_and_reserve`:**
> Clients are entitled to your judgment and not obliged to adopt it. Saying both of those things in the same conversation is the whole skill.

**Feedback — `decline_to_advise`:**
> Neutrality feels respectful. In practice it can leave a client alone with a decision he asked for help with, and withholding your professional judgment is not the same as protecting his autonomy.

**Feedback — `predict_acquittal`:**
> Notice that his trust in you went up. Confidence is contagious and unfalsifiable until the verdict, and a prediction offered as a probability educates a client where the same prediction offered as a promise replaces his decision with your optimism.

**SME defensibility:**
- `advise_and_reserve` (best): candid advice paired with explicit reservation of the decision to the client is the correct division of authority between lawyer and client.
- `decline_to_advise` (acceptable): accurate but incomplete — the duty to advise includes offering an assessment, and refusing to give one under-serves the client even though the decision remains his.
- `predict_acquittal` (poor): stating an outcome as near-certain misrepresents irreducible trial risk and is a recognized ground for later challenges to the voluntariness of a plea. The rise in Client trust here is the point: trust is not a proxy for quality.

### Scene `the_advisal` — "A line on the intake form"

**Body:**
> Going through the sentencing intake form you notice that Santos was born in Oaxaca and has been a lawful permanent resident since he was eleven. He has never connected that to this case. A plea to receiving stolen property may carry immigration consequences that a dismissal or a differently structured plea would not. Your office has an immigration consult line with a four-day turnaround. The offer expires in five days.

| Choice `id` | Label | Quality | Effects | Goes to |
| --- | --- | --- | --- | --- |
| `consult_before_advising` | Stop the plea discussion, send the consult, and tell Santos you cannot advise him until the answer comes back | `best` | `client_trust` +8, `case_strength` +5 | `scene:the_recording` |
| `general_warning` | Tell him a plea could affect his status and that he should speak with an immigration attorney, then carry on | `acceptable` | none | `scene:the_recording` |
| `not_my_area` | Immigration is a different practice area; focus on the criminal exposure, which is what the office was appointed for | `poor` | `client_trust` -12 | `scene:the_decision` |

**Feedback — `consult_before_advising`:**
> A noncitizen client's plea decision is not complete without the immigration consequence, and the duty to advise on it is constitutional rather than optional. Pausing a running clock is uncomfortable; advising blind is worse.

**Feedback — `general_warning`:**
> A general warning beats silence, and it is the version of the advisal that suffices only when the consequence is genuinely unclear. Here it is knowable in four days, which is the difference between a warning and advice.

**Feedback — `not_my_area`:**
> The consequence a client cares most about is often not the one on the charging document. Treating deportation risk as somebody else's specialty is precisely the reasoning the duty to advise exists to end.

**SME defensibility:**
- `consult_before_advising` (best): *Padilla v. Kentucky* establishes counsel's duty to advise a noncitizen client of the immigration consequences of a plea; obtaining a specific consult before advising is the standard-of-practice route.
- `general_warning` (acceptable): a generic warning suffices only where the consequence is not clear from the face of the statute; it is the recognized floor, not the standard.
- `not_my_area` (poor): disclaiming the immigration advisal is a recognized ineffective-assistance failure rather than a scope-of-representation choice.

### Scene `the_recording` — "Forty hours left"

**Body:**
> The recording surfaces Thursday afternoon, produced on your motion or handed over late in a supplemental disclosure. It shows two figures crossing the road at 11:38 at night; neither is identifiable, one is noticeably taller than Santos, and the timestamp is four minutes off the eyewitness's account. It is not exoneration and it is not nothing. ADA Trujillo, hearing that you have it, says the eighteen-month offer stands until Monday and will not improve.

| Choice `id` | Label | Quality | `showIf` | Effects | Goes to |
| --- | --- | --- | --- | --- | --- |
| `show_client_reassess` | Sit down with Santos, show him the recording, and re-explain both paths in light of it | `best` | none | `client_trust` +8, `case_strength` +8 | `scene:the_decision` |
| `push_for_better_offer` | Take the recording and the identification problems to Trujillo and ask for a disposition without the receiving count | `best` | `case_strength` `gte` **60** | `case_strength` +10, `client_trust` +6 | `scene:the_decision` |
| `keep_it_simple` | The offer is still good and the recording muddies it; do not complicate his decision forty hours out | `poor` | none | `client_trust` -10, `case_strength` -5 | `scene:the_decision` |

**Feedback — `show_client_reassess`:**
> New evidence changes the client's decision, not only yours, and he cannot weigh what he has not seen. Showing him what it fails to prove matters as much as showing him what it does.

**Feedback — `push_for_better_offer`:**
> You can only negotiate from what you actually built, which is why this conversation is available to you at all. Even a refused ask tells your client the case was worked rather than processed.

**Feedback — `keep_it_simple`:**
> Withholding evidence from a client to keep his decision tidy inverts the duty you hold. Complication is not the enemy of a good decision; it is usually the content of one.

**SME defensibility:**
- `show_client_reassess` (best): material new evidence must be conveyed so the plea decision remains informed, and describing its ambiguity honestly is part of conveying it.
- `push_for_better_offer` (best, conditional): renegotiation grounded in investigated weaknesses is standard practice; attempted without an evidentiary basis it spends credibility with the prosecutor for nothing, which is why the option is gated on Case strength.
- `keep_it_simple` (poor): failing to disclose material evidence to the client breaches the duty to keep him informed and undermines the voluntariness of any resulting plea.

### Scene `the_decision` — "Monday morning"

**Body:**
> Santos arrives Monday with his aunt Teresa, who has watched the recording twice on your office computer, and with the immigration consult if you obtained one. Court is at one-thirty. He asks you one more time what happens to him.

| Choice `id` | Label | Quality | Effects | Goes to |
| --- | --- | --- | --- | --- |
| `confirm_and_document` | Walk him through the offer, the exposure and the collateral consequences once more, confirm what he understands, memo the file, and do what he decides | `best` | `client_trust` +6 | `ending:informed_choice` |
| `support_whatever` | He has the information; tell him you support whatever he decides, and go to court | `acceptable` | `client_trust` +4 | `ending:outcome_luck` |
| `decide_for_him` | Tell him the answer is obvious by now, and that you have already told Trujillo he is taking it | `poor` | `client_trust` -20 | `ending:plea_unravels` |

**Feedback — `confirm_and_document`:**
> The colloquy in court tests whether a plea was voluntary; your file memo is the only record of whether it was informed. When somebody asks in two years, that memo is the only witness you have.

**Feedback — `support_whatever`:**
> Support is not counsel, and whatever you decide at the last moment can leave a client guessing at what you actually think. It also leaves no record of what he understood when he decided.

**Feedback — `decide_for_him`:**
> Communicating a client's decision before he has made it is not efficiency; it substitutes your judgment for his in the one decision that was never yours. Everything downstream of it is fragile.

**SME defensibility:**
- `confirm_and_document` (best): confirming understanding in the client's own words and documenting the advisal is the practice standard that makes a plea durable and the representation reviewable.
- `support_whatever` (acceptable): the client's autonomy is respected, but with no final confirmation and no documentation the informed character of the plea is simply unestablished.
- `decide_for_him` (poor): conveying acceptance without the client's authorization exceeds counsel's authority and creates a direct challenge to the plea's validity.

### Ending `informed_choice` — "The record you can stand behind"

**Body (three paragraphs):**
> Santos makes his decision. Whether he took the offer or set it for trial matters less to this scenario than what stands behind it: a case that was investigated, evidence he saw with his own eyes, a consequence to his residency that somebody actually researched, and a decision he made in his own words with his aunt sitting beside him.
>
> Two years later a different lawyer pulls the file for an unrelated reason and reads the memo: what he was told, what he understood, what he chose. Nothing in it has to be reconstructed from memory. That is what a defensible file looks like, and it is the only thing that can be built regardless of how the case turns out.
>
> This is the point of the exercise. You cannot control the eyewitness, the prosecutor, the judge, or the verdict. You can control what the client knew when he decided, and that is what the profession actually holds you to.

### Ending `outcome_luck` — "It worked out"

**Body (three paragraphs):**
> The eyewitness moves out of state in the spring. Trujillo cannot make the burglary count without her, the charge is reduced, and Santos ends up with an outcome better than the offer he was weighing. He shakes your hand in the hallway and means it.
>
> Now change one fact. If the witness had stayed, exactly the same choices you made would have produced a client who pleaded to an offense whose consequences nobody had researched, on evidence nobody had tested, with no record of what he understood. The choices did not become good because the witness moved.
>
> This is the ending students argue with, and it is the one worth arguing about. Outcomes are distributed by luck as much as by skill. The process is the only part that was ever yours, and it is the only part anyone can review.

### Ending `plea_unravels` — "The plea that comes back"

**Body (three paragraphs):**
> Santos pleads. Six months later, returning from his grandmother's funeral, he is held at the airport and learns from a stranger in a uniform what his conviction means for his residency — which is how he learns that it means anything at all.
>
> The motion to withdraw the plea lands on a different lawyer's desk, and the file it is built on is yours. There is no memo, no consult, no record of what he was told, and a prosecutor who remembers being informed of his decision before he had made it. Whatever the court decides, the year he spends on it is a year nobody gets back.
>
> Nothing here required bad faith. A heavy caseload, an offer with a clock on it, and a client who kept saying he could not miss work are enough. That is why the duties are written as duties rather than as good intentions.

## 6. Verification

**Graph (must hold after transcription):**

| Scene | Reached from | Unconditional exits | Reaches an ending |
| --- | --- | --- | --- |
| `the_offer` | start | 3 | via `the_file` |
| `the_file` | `the_offer` | 3 | via `the_kitchen_table` |
| `the_kitchen_table` | `the_file` | 3 | via `the_advisal` |
| `the_advisal` | `the_kitchen_table` | 3 | via `the_recording` / `the_decision` |
| `the_recording` | `the_advisal` (best, acceptable) | 2 unconditional + 1 conditional | via `the_decision` |
| `the_decision` | `the_recording` (3), `the_advisal` (`not_my_area`) | 3 | direct, to all 3 endings |

All six scenes reachable; every scene keeps at least two unconditional choices; all three endings reachable from `the_decision`.

**Conditional gate** (`case_strength` on entry to `the_recording`, gate is `gte 60`; only `the_file` and `the_advisal` move it):

| Path | Case strength on entry | Renegotiation offered |
| --- | --- | --- |
| `investigate_and_compel` + `consult_before_advising` | 40 + 20 + 5 = 65 | yes |
| `investigate_and_compel` + `general_warning` | 40 + 20 = 60 | yes, exactly at the gate |
| `work_it_yourself` + `consult_before_advising` | 40 + 6 + 5 = 51 | no |
| `rely_on_the_report` + anything | ≤ 35 | no |

The gate encodes one idea: you can only negotiate from a case you investigated.

**Range sanity:** best path ends at `client_trust` 99 and `case_strength` 73, inside [0, 100] with no clamping. Note the deliberate anti-correlation in `the_kitchen_table`: the `poor` choice *raises* Client trust by 6. This is intentional and the feedback names it — a learner who optimizes the trust meter will fail the scenario's actual lesson.

## 7. Sources

Case, client, county, and all names are fictional. The professional standards the quality ratings encode:

- American Bar Association, *Model Rules of Professional Conduct* r. 1.2(a) (the client decides whether to plead), r. 1.4 (communication), r. 1.1 (competence).
- American Bar Association, *Criminal Justice Standards for the Defense Function* (4th ed. 2015) — Standard 4-4.1 (duty to investigate, which is not excused by a client's stated intent to plead), 4-5.1 (advising the client), 4-6.1 and 4-6.2 (plea discussions and the client's decision).
- *Padilla v. Kentucky*, 559 U.S. 356 (2010) — counsel's duty to advise a noncitizen client of the immigration consequences of a plea; the distinction between specific advice where the consequence is clear and a general warning where it is not.
- *Missouri v. Frye*, 566 U.S. 134 (2012) and *Lafler v. Cooper*, 566 U.S. 156 (2012) — the duty to communicate formal plea offers and the extension of effective-assistance review to the plea-bargaining stage.
- *Brady v. Maryland*, 373 U.S. 83 (1963) and its progeny — the prosecution's disclosure obligation, which is the background of the unproduced recording.

Citations are for the reviewer and the SME. They are not quoted in learner-visible text, and the scenario avoids any statement of law that a learner could mistake for advice about a real case; the intro says so explicitly.

## 8. Images

### Committed starter

Image-less. No scene carries `imageAssetId`, `imageRole`, or `imageAlt`. The start scene's intro carries the one-line starter note in §4 marking where a header image goes.

### Canvas-review zip (image-bearing copy)

One informative header image on the start scene `the_offer`.

**Provenance:** authored for this project, no third-party elements. An abstract composition built as vector geometry and rasterized to PNG at 1600 × 700 (the 16:7 header crop). Palette is the two RDS brand colors only: maroon `#8C1D40` and gold `#FFC627`. No photographs, no stock assets, no typefaces, no text of any kind, no depiction of any person, no courthouse or agency insignia. Both the SVG source and the rasterized PNG are committed under `docs/exemplars/assets/`, so the image is reproducible and its rights position is unambiguous: it was made here.

**Composition:** a maroon field; a single horizontal gold beam; two shallow gold pans suspended from the beam by straight lines, resting at visibly unequal heights, with the beam tilted a few degrees off level. Flat shapes, no gradients, no outlines, generous margins so the header crop cannot clip the geometry.

**Image role:** `informative`. It is not decorative: the unequal pans and the tilted beam are the scenario's premise stated visually, so a learner who cannot see it would lose that framing.

**Drafted alt text (one sentence, awaiting acceptance):**

> A balance in maroon and gold with its beam tilted and its two pans resting at clearly unequal heights.

**Acceptance record (per `docs/exemplars/alt-policy.md`):**

| Field | Value |
| --- | --- |
| Drafted by | agent, 2026-08-28 |
| Accepted by | *pending — Tamara, author of record* |
| Accepted text | *pending* |
| Date accepted | *pending* |

The image-bearing zip must not be delivered for Canvas review until this table is filled in. If the accepted text differs from the draft, the accepted text is what ships and this table records both.

## 9. Transcription checklist

- [ ] 6 scenes with the ids in §5; `startSceneId: "the_offer"`.
- [ ] Exactly 2 variables, both `visible: true`.
- [ ] Exactly one `showIf`: `push_for_better_offer`, `case_strength gte 60`.
- [ ] 3 endings with the ids and bodies in §5.
- [ ] Intro text from §4, **including** the authoring note line, in the committed starter.
- [ ] Committed starter carries no image fields on any scene.
- [ ] SME lines and the case citations are **not** transcribed into the config.
- [ ] `validateBranchingConfig` returns ok; the §6 graph and gate tables hold.
- [ ] For the Canvas-review copy only: upload the PNG through the real asset route, set `imageRole: "informative"` and the **accepted** `imageAlt` on `the_offer`.
