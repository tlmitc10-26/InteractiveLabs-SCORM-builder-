# Content brief: The Budget Cut

**Slug:** `budget-cut` · **Engine:** branching-scenario · **Arc position:** module 1 of 3 (Sierra Vista Unified)
**Escalation contract (spec §2):** exactly **1** variable, exactly **4** scenes. No conditional (`showIf`) choices.
**Status:** content complete; transcribe verbatim, invent nothing.

---

## 1. Learning objective

Learner-visible, appears in the interactive's intro:

> By the end of this scenario you will be able to choose where a mid-year reduction lands and defend that choice on the record: naming the impact before the recommendation, and then answering for the decision wherever it lands you — in a board packet that has to disclose what the plan costs in future years, or in a room full of the people it hurts.

**Why the third clause is disjunctive** (final review, item 4): the graph in §6 sends `defer_technology`/`hold_vacancies` to `the_board_packet` and `cut_after_school` to `the_parents_arrive`, so no single play-through reaches both the disclosure scene and the public-comment scene. The earlier wording promised both as a conjunction and no path delivered it. The fix narrows the promise to what every path actually teaches — impact-before-recommendation in scene 1, a choice with named consequences in scene 2, and then accountability in whichever forum the choice leads to — rather than rerouting, which would have meant chaining the two terminal scenes and breaking the 4-scene / 1-variable escalation contract this module exists to demonstrate.

## 2. Discipline pattern

Every online program that prepares people to run something — a school, a clinic, a shift, a department — eventually has to teach the same shape: *a resource shrinks, every remaining option harms someone, and the learner is graded on the quality of the reasoning rather than on finding the harmless answer.* Textbook cases teach the analysis; they cannot teach the moment when a parent is standing at a microphone and the analysis is already finished. A four-scene, single-variable branching scenario is the smallest structure that makes that moment happen to the learner instead of being described to them, and it is the shape a designer can copy on their first attempt. This module is deliberately the simplest in the library: one tracked consequence, one decision per scene, no conditional logic. Everything a designer needs to learn about choice → quality → consequence is visible in four screens.

## 3. Notation for transcription

- **Quality words** are the schema's enum: `best`, `acceptable`, `poor`. (In companion-doc text these serialize as `BEST`, `OK`, `POOR`.)
- **Scene and ending bodies:** each paragraph below becomes one `<p>…</p>`. Bodies here are single paragraphs unless marked otherwise.
- **Feedback lines** are the `feedback` field (rich text, one `<p>`). They are learner-visible.
- **SME line** on each choice is a defensibility rationale for review. It is **brief-only** and never appears in the config or to the learner.
- **Effects** are integer deltas on the variable named. `goTo` targets are given as `scene:<id>` / `ending:<id>`.
- `feedbackMode: "debrief"`, `showPathInDebrief: true`, `headerColor` left unset (runtime paints the default brand band).
- **Label length is not a quality cue** (final review, item 1): across this module's multi-choice scenes, the single longest label (by word count) may be the `best` choice in **at most 40%** of them. Best labels are trimmed to their decision essence; acceptable and poor labels carry equally substantive phrasing, never filler. A tie for longest does not count as a cue. `tests/exemplar-content.test.ts` enforces this per starter.

## 4. Configuration summary

| Field | Value |
| --- | --- |
| `title` | The Budget Cut |
| `role` | You are the superintendent of Sierra Vista Unified, a public school district of about 6,200 students, in your second year in the job. |
| `startSceneId` | `the_memo` |
| scenes | 4 (`the_memo`, `three_lines`, `the_board_packet`, `the_parents_arrive`) |
| endings | 2 (`held_the_line`, `credibility_spent`) |
| variables | 1 |
| `feedbackMode` | `debrief` |

**Variable (exactly one):**

| id | label | initial | min | max | visible |
| --- | --- | --- | --- | --- | --- |
| `board_confidence` | Board confidence | 50 | 0 | 100 | true |

**Intro (learner-visible, carries the objective):**

> Sierra Vista Unified has 6,200 students, four months left in its fiscal year, and $1.9 million less than it had yesterday. You are the superintendent. By the end of this scenario you will be able to choose where a mid-year reduction lands and defend that choice on the record: naming the impact before the recommendation, and then answering for the decision wherever it lands you — in a board packet that has to disclose what the plan costs in future years, or in a room full of the people it hurts.
>
> One thing is tracked as you go: **Board confidence** — how much credibility you carry into the next decision. There is no option here that harms nobody. Choose the one you could explain in public.

**Recurring cast (shared across all three arc modules — keep names and roles identical):**

| Name | Role |
| --- | --- |
| Delia Okonjo | Board president |
| Roy Vance | Board member, fiscal conservative |
| Priya Raman | Board member, equity focus |
| Wendell Cho | Chief business official |
| Simone Alvarez | Communications director |
| Tom Brackett | President, Sierra Vista Education Association |
| Elena Duarte | Principal, Sierra Vista High School |
| Marcus Bell | Principal, Alder Creek Elementary |
| Ray Delgado | Director of operations |

(Only Okonjo, Vance, Cho, Alvarez and Ochoa appear in this module. Iris Ochoa is a one-scene parent, module 1 only.)

## 5. Content

### Scene `the_memo` — "The February memo"

**Body:**
> The state's second-quarter revision landed this morning: Sierra Vista Unified must absorb a 3 percent reduction, about $1.9 million, in the four months left in the fiscal year. Wendell Cho, your chief business official, says there are three places the money could realistically come from and none of them is painless. Board president Delia Okonjo has already called; the board meets in nine days and she wants to know what you will recommend. It is 8:15 in the morning and you have not seen a number yet.

| Choice `id` | Label | Quality | Effects | Goes to |
| --- | --- | --- | --- | --- |
| `request_analysis` | Ask Cho for a written impact analysis of each option before you commit to anything | `best` | `board_confidence` +8 | `scene:three_lines` |
| `call_principals` | Tell Okonjo you will bring a recommendation, and start calling principals to hear what they would protect | `acceptable` | `board_confidence` +2 | `scene:three_lines` |
| `commit_now` | Tell Okonjo you already know what has to go, and name it on the phone | `poor` | `board_confidence` -10 | `scene:three_lines` |

**Feedback — `request_analysis`:**
> Naming the analysis before the answer is what makes the answer defensible later. When the board asks what this costs us, you want Cho's numbers in the packet rather than your recollection of them.

**Feedback — `call_principals`:**
> Talking to principals surfaces things a spreadsheet will not, and you will need their buy-in either way. Without the impact analysis beside it, though, you are weighing strong opinions against each other with no shared set of numbers.

**Feedback — `commit_now`:**
> Announcing the answer in the first hour feels decisive and costs you every option you have not examined yet. If Cho's analysis later contradicts you, the board has to choose between your credibility and the arithmetic.

**SME defensibility:**
- `request_analysis` (best): fiscal decisions by public bodies are defended on their record; establishing a written impact basis before committing is the first professional duty here.
- `call_principals` (acceptable): stakeholder consultation is professionally sound but incomplete on its own — it gathers preference data without cost data.
- `commit_now` (poor): committing publicly before analysis forecloses alternatives and creates a credibility trap when the analysis lands.

### Scene `three_lines` — "Three lines"

**Body:**
> Cho's written analysis comes back in four days and it is honest about the trade-offs. Option one: freeze all non-instructional purchasing and defer the district's technology refresh — $1.9 million, reached without touching staffing, but the deferred replacement cost lands in next year's budget. Option two: hold the four currently vacant positions open through June and add a partial freeze — $1.9 million, though two of those vacancies are special education paraprofessional posts tied to services written into student plans. Option three: end the middle school after-school program in March and add a partial freeze — $1.9 million, and roughly two hundred students lose the only supervised place many of them have until six o'clock.

| Choice `id` | Label | Quality | Effects | Goes to |
| --- | --- | --- | --- | --- |
| `defer_technology` | Freeze purchasing and defer the technology refresh | `best` | `board_confidence` +10 | `scene:the_board_packet` |
| `hold_vacancies` | Hold vacancies, but fill the two paraprofessional posts and hold four others instead | `acceptable` | `board_confidence` +4 | `scene:the_board_packet` |
| `cut_after_school` | End the after-school program; it is the cleanest single line | `poor` | `board_confidence` -12 | `scene:the_parents_arrive` |

**Feedback — `defer_technology`:**
> Deferral protects instruction and student services this year and keeps the decision reversible. It is also a delay rather than a saving, and the board deserves to hear it named that way rather than discover it in July.

**Feedback — `hold_vacancies`:**
> Filling the paraprofessional posts respects services the district is obliged to deliver, and vacancy savings avoid layoffs entirely. It also thins supports elsewhere in ways families will start to feel by April, quietly, without anyone having announced a cut.

**Feedback — `cut_after_school`:**
> A single clean line is the easiest cut to execute and the hardest to defend, because it concentrates the entire reduction on the students with the fewest alternatives. If it is genuinely the right call, it has to be argued in public before it is made rather than after.

**SME defensibility:**
- `defer_technology` (best): reversible, non-instructional reductions are the standard first tier in a mid-year cut; the cost is transferred rather than eliminated, which is defensible only when disclosed.
- `hold_vacancies` (acceptable): vacancy management is a legitimate mid-year lever and protecting staffing tied to individualized service plans is required; the trade-off is a diffuse, unannounced service reduction.
- `cut_after_school` (poor): concentrating a district-wide reduction on a single student-services program without impact analysis or prior consultation is the least defensible of the three under any standard of public accountability.

### Scene `the_board_packet` — "The board packet"

**Body:**
> Simone Alvarez has the draft board packet open and one question: how much of this goes in it. Your plan has a tail, and which tail depends on what you chose. Deferring the technology refresh pushes roughly $2.3 million of replacement cost into a future year that nobody has provided for. Holding vacancies pushes nothing forward and saves nothing twice: the posts are budgeted again in July, so the $1.9 million has to be found somewhere else next year. Board member Roy Vance has asked twice for the clean version, not the encyclopedia. The packet posts publicly at five o'clock tomorrow.

**Fiscal note** (final review, item 5): this scene is reachable from BOTH `defer_technology` and `hold_vacancies`, so the tail has to be branch-correct. Only deferral creates a new future obligation, and $2.3 million is that branch's figure alone. Holding vacant posts open creates no future cost — the posts were budgeted and are budgeted again in July, restoring the baseline — so its disclosure duty is the opposite one: that the $1.9 million is a **non-recurring** saving and next year's reduction is still unfound. Attributing $2.3 million to either branch indiscriminately, as the earlier body did, is the sort of thing a chief business official would strike in review.

| Choice `id` | Label | Quality | Effects | Goes to |
| --- | --- | --- | --- | --- |
| `publish_full_schedule` | Publish the full schedule, with the year each deferred cost comes due | `best` | `board_confidence` +12 | `ending:held_the_line` |
| `brief_members_privately` | Publish the total, and brief board members individually on the detail | `acceptable` | `board_confidence` +3 | `ending:held_the_line` |
| `omit_the_tail` | Report the savings figure and leave the tail out of the packet | `poor` | `board_confidence` -15 | `ending:credibility_spent` |

**Feedback — `publish_full_schedule`:**
> Publishing what the plan costs later is what separates a plan from an accounting maneuver. Boards forgive bad news they hear early; what they rarely forgive is the second version of a number.

**Feedback — `brief_members_privately`:**
> Briefing members individually keeps the board informed, which is the substance of the duty. A public total with no detail still leaves the tail there for someone else to find first, and describe first.

**Feedback — `omit_the_tail`:**
> Leaving a known future cost out of the packet does not remove it from the budget; it removes the board's chance to weigh it. When it surfaces in next year's first draft, every other number you have presented gets read a second time.

**SME defensibility:**
- `publish_full_schedule` (best): full disclosure of deferred obligations in the decision record is a baseline governance expectation for a public body.
- `brief_members_privately` (acceptable): the board is informed, which satisfies the governance minimum; a public record thinner than the private one is a trust and communications risk rather than a governance failure.
- `omit_the_tail` (poor): omitting a known material future obligation from the decision record is indefensible regardless of intent.

### Scene `the_parents_arrive` — "The room fills up"

**Body:**
> By six-forty on board night there are sixty people in a room built for forty, most of them families from the middle school. A parent named Iris Ochoa tells the board that the after-school program is the only supervised place her seventh grader has between the last bell and the end of her shift. Delia Okonjo lets public comment run twenty minutes past its limit, then turns to you. The district's own livestream is running.

| Choice `id` | Label | Quality | Effects | Goes to |
| --- | --- | --- | --- | --- |
| `name_the_harm` | Name the harm plainly, and commit to a date when you will report back on restoring it | `best` | `board_confidence` +10 | `ending:held_the_line` |
| `explain_arithmetic` | Walk the room through the arithmetic that led here, and offer to meet the parent group next week | `acceptable` | `board_confidence` +2 | `ending:credibility_spent` |
| `decision_is_final` | Say the decision is final and move to the next agenda item | `poor` | `board_confidence` -18 | `ending:credibility_spent` |

**Feedback — `name_the_harm`:**
> Naming the harm without promising a rescue you cannot deliver is the only version of this answer that survives contact with June. A date to report back is a commitment you can actually keep, which is what makes it worth making.

**Feedback — `explain_arithmetic`:**
> The arithmetic is real and these families are entitled to see it. Led with, though, it answers a question about a child with a paragraph about a fund balance, and everyone in the room hears the difference.

**Feedback — `decision_is_final`:**
> Closing the item ends the meeting, not the conversation. A public body that declines to answer in the room gets answered elsewhere, by people working with less information than you have.

**SME defensibility:**
- `name_the_harm` (best): acknowledging impact and committing to a reporting date rather than an outcome is the accountable posture; promising restoration out of revenue the district does not control would be a commitment it cannot honor.
- `explain_arithmetic` (acceptable): accurate disclosure of the fiscal basis is professionally sound; leading with it before acknowledging impact is a communications failure, not an integrity failure.
- `decision_is_final` (poor): refusing engagement at a public hearing forfeits the district's account of its own decision and erodes the legitimacy the decision depends on.

### Ending `held_the_line` — "Credibility intact"

**Body (two paragraphs):**
> The reduction is adopted 5 to 0, and the part that matters comes afterward. When Cho brings the first draft of next year's budget in April, nobody on the board is surprised by what is in it. Roy Vance still thinks you cut in the wrong place; he says so on the record, and then he votes for the plan, because he can see the whole plan.
>
> Sierra Vista absorbed $1.9 million and spent very little of the thing that is hardest to rebuild: the board's assumption that when you present a number, it is the whole number. That assumption is the asset you will need at the community meeting in April, and again the following winter, when something much worse than a budget revision arrives on a Saturday morning.

### Ending `credibility_spent` — "The cut lands, the credibility does not"

**Body (two paragraphs):**
> The reduction is adopted 3 to 2. Within a month the part you left out has been found — in a budget draft, in a records request, in a parent's spreadsheet — and it is now the story, in place of the reasoning that led you to it. Nothing you did was unlawful and nothing you said was untrue. What is gone is the assumption that a number from your office is a complete number.
>
> You will do this arithmetic again in April, at a community meeting, in front of people who now check it. Every district makes a decision like this one; the ones that survive it are the ones that told the whole thing the first time.

## 6. Verification

**Graph (must hold after transcription):**

| Scene | Reachable from start | Unconditional exit | Reaches an ending |
| --- | --- | --- | --- |
| `the_memo` | start | 3 of 3 choices | via `three_lines` |
| `three_lines` | from `the_memo` (3 edges) | 3 of 3 choices | via both follow-on scenes |
| `the_board_packet` | from `three_lines` (`defer_technology`, `hold_vacancies`) | 3 of 3 choices | direct |
| `the_parents_arrive` | from `three_lines` (`cut_after_school`) | 3 of 3 choices | direct |

Endings `held_the_line` and `credibility_spent` are each reachable from both terminal scenes. No `showIf` anywhere, so the guaranteed-exit rule is satisfied trivially. Variable count = 1, scene count = 4: the module-1 escalation contract.

**Score band sanity:** best-only path ends at `board_confidence` 50 + 8 + 10 + 12 = 80. Poor-only path ends at 50 − 10 − 12 − 18 = 10. Both inside [0, 100]; no clamping is relied upon for the intended range.

## 7. Sources

Scenario content is original and fictional. The professional expectations the quality ratings encode are drawn from:

- National Policy Board for Educational Administration, *Professional Standards for Educational Leaders* (2015) — Standard 9 (Operations and Management) on fiscal stewardship and transparency; Standard 8 (Meaningful Engagement of Families and Community).
- Association of School Business Officials International, *Best Practices in School Budgeting* — the disclosure of multi-year consequences of one-year reductions.
- Government Finance Officers Association, *Best Practices: Budget Monitoring* and *Financial Transparency* — the treatment of deferral as a transfer of cost rather than a saving.
- Individuals with Disabilities Education Act, 20 U.S.C. §1400 et seq. — the obligation to staff services written into individualized education programs, which is why the paraprofessional posts are not an available saving.

No real district, board, or individual is depicted. "Sierra Vista Unified" and every named character are fictional. State revenue mechanics are described generically and no state is named, so the scenario is usable in any program.

## 8. Images

None. This starter ships image-less and no scene carries `imageAssetId`, `imageRole`, or `imageAlt`. Designers adapting it upload their own images per `docs/exemplars/alt-policy.md`.

## 9. Transcription checklist

- [ ] 4 scenes, ids exactly as in §5; `startSceneId: "the_memo"`.
- [ ] Exactly 1 variable (`board_confidence`), `visible: true`.
- [ ] 2 endings with the ids and bodies in §5.
- [ ] Every choice has `quality`, `goTo`, `feedback`; no `showIf` anywhere in this module.
- [ ] SME lines are **not** transcribed into the config.
- [ ] Intro text from §4 (it carries the learning objective the exemplar test asserts is present).
- [ ] `validateBranchingConfig` returns ok; graph table in §6 holds.
