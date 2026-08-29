# Content brief: The Crisis

**Slug:** `crisis` · **Engine:** branching-scenario · **Arc position:** module 3 of 3 (Sierra Vista Unified), capstone
**Escalation contract (spec §2):** exactly **3** variables, **8** scenes, **4** endings ranked by quality, conditional paths.
**Status:** content complete; transcribe verbatim, invent nothing.

---

## 1. Learning objective

Learner-visible, appears in the interactive's intro:

> By the end of this scenario you will be able to lead a district through a security incident that has no good options: sequencing containment against continuity, communicating before the facts are complete, meeting a notification duty on its own clock rather than yours, and giving an after-action account that includes your own earlier decisions.

## 2. Discipline pattern

Capstone assessments in leadership programs are almost always a case study and a paper, which measures how well a student reasons with unlimited time about a decision somebody else already made. The thing the job actually demands is judgment under compounding constraint: three obligations moving in different directions, each choice narrowing the next, and a public record forming while you decide. A three-variable branching scenario with conditional paths is the closest a course can get to that, and it is worth the authoring effort exactly once per course — at the end, where it functions as a synthesis assessment. This module also demonstrates the arc's whole argument: the option available to the learner in scene 6 exists only because of what they did in scene 1, and the incident itself grew from a budget decision made in module 1. Consequences that arrive two modules later are what separate a scenario library from a set of quizzes.

## 3. Notation for transcription

- **Quality words** are the schema's enum: `best`, `acceptable`, `poor` (companion-doc text: `BEST`, `OK`, `POOR`).
- **Scene and ending bodies:** each paragraph becomes one `<p>…</p>`.
- **Feedback lines** are the `feedback` field, learner-visible.
- **SME line** on each choice is a review rationale — **brief-only**, never in the config or shown to the learner.
- **Conditional choices:** three, each written out in §5 with its exact `showIf` object. Every scene that has one also has at least two unconditional choices.
- `feedbackMode: "debrief"`, `showPathInDebrief: true`.
- **Label length is not a quality cue** (final review, item 1): across this module's multi-choice scenes, the single longest label (by word count) may be the `best` choice in **at most 40%** of them. Best labels are trimmed to their decision essence; acceptable and poor labels carry equally substantive phrasing, never filler. A tie for longest does not count as a cue. `tests/exemplar-content.test.ts` enforces this per starter.

## 4. Configuration summary

| Field | Value |
| --- | --- |
| `title` | The Crisis |
| `role` | You are the superintendent of Sierra Vista Unified. It is 5:40 on a Saturday morning in January and your director of operations is calling. |
| `startSceneId` | `the_saturday_call` |
| scenes | 8 (`the_saturday_call`, `the_first_hour`, `monday_morning`, `what_to_say`, `the_demand`, `the_notification`, `staff_and_families`, `the_after_action`) |
| endings | 4 (`stewardship`, `contained_but_costly`, `trust_deficit`, `regulatory_reckoning`) |
| variables | 3 |
| `feedbackMode` | `debrief` |

**Variables (exactly three):**

| id | label | initial | min | max | visible |
| --- | --- | --- | --- | --- | --- |
| `community_trust` | Community trust | 55 | 0 | 100 | true |
| `instructional_continuity` | Instructional continuity | 80 | 0 | 100 | true |
| `regulatory_standing` | Regulatory standing | 70 | 0 | 100 | true |

All three are oriented the same way — higher is better — deliberately, so the learner reads three meters rather than translating one of them.

**Intro (learner-visible, carries the objective):**

> Last winter Sierra Vista Unified absorbed a mid-year reduction and deferred its technology refresh, including the endpoint maintenance line. In April it held a community meeting about that reduction. This is the following January, and at 5:40 on a Saturday morning the district's systems stop responding.
>
> By the end of this scenario you will be able to lead a district through a security incident that has no good options: sequencing containment against continuity, communicating before the facts are complete, meeting a notification duty on its own clock rather than yours, and giving an after-action account that includes your own earlier decisions. Three things are tracked: **Community trust**, **Instructional continuity**, and **Regulatory standing**. Some of the choices ahead will only be available to you if the right one of those is high enough when you get there.

**Recurring cast (identical to modules 1 and 2):** Delia Okonjo (board president), Roy Vance and Priya Raman (board members), Wendell Cho (chief business official), Simone Alvarez (communications director), Tom Brackett (SVEA president), Elena Duarte (Sierra Vista High) and Marcus Bell (Alder Creek Elementary), Ray Delgado (director of operations), Andre Whitfield (family working group co-chair, from module 2).

## 5. Content

### Scene `the_saturday_call` — "5:40 a.m., Saturday"

**Body:**
> Ray Delgado calls at 5:40 on Saturday morning. Overnight the student information system stopped responding, the building-access controllers are offline, and a message on the district's file server says the data has been encrypted and gives an address to contact. Nobody knows yet what was taken, how long the intruder was inside, or whether the backups are intact — including, Delgado notes, the ones covered by the maintenance line the district deferred last February. You are the only person with the authority to shut anything down.

| Choice `id` | Label | Quality | Effects | Goes to |
| --- | --- | --- | --- | --- |
| `isolate_and_convene` | Isolate the affected systems now, then call the county office, the district's cyber insurer, and counsel before anything else is touched | `best` | `instructional_continuity` -8, `regulatory_standing` +6, `community_trust` +2 | `scene:the_first_hour` |
| `restore_first` | Have Delgado start restoring from whatever backups exist so Monday still works, and call counsel once you know what this is | `acceptable` | `instructional_continuity` +5, `regulatory_standing` -8 | `scene:the_first_hour` |
| `wait_for_monday` | It is Saturday. Keep it quiet until the IT vendor can look at it Monday | `poor` | `instructional_continuity` -5, `regulatory_standing` -18, `community_trust` -10 | `scene:the_first_hour` |

**Feedback — `isolate_and_convene`:**
> Isolation buys the one thing you cannot get back later: an intact record of what happened. Counsel and the insurer both have roles that begin in the first hour rather than the first press call, and the call you make now is what determines which options exist on Wednesday.

**Feedback — `restore_first`:**
> The instinct to get schools running is right. What it misses is that restoring before the systems are isolated can overwrite the evidence that decides what you must report and to whom. Continuity and containment genuinely compete here; the order matters more than the speed.

**Feedback — `wait_for_monday`:**
> Every hour an intrusion runs unexamined is an hour of further access, and a delay that begins as caution is read afterward as concealment. Notification clocks generally run from discovery, not from when it became convenient to look.

**SME defensibility:**
- `isolate_and_convene` (best): containment plus early engagement of counsel, insurer and the intermediate agency is the standard incident-response sequence, and preserving forensic evidence protects the investigation, the claim and the later notification analysis.
- `restore_first` (acceptable): a real practitioner tension, but restoring first risks destroying forensic artifacts and can compromise both the insurance claim and the scope determination.
- `wait_for_monday` (poor): delaying containment and notification extends exposure and starts the record with a gap that cannot later be explained.

### Scene `the_first_hour` — "Who is in the room"

**Body:**
> By seven you have counsel on the phone, the insurer's incident line open, and Delgado in the server room. Counsel asks a question you cannot answer: does the district have a written incident response plan naming who decides, who speaks, and who notifies. Delia Okonjo is calling. Roy Vance has texted twice, and one of the texts asks what you are going to tell the press.

| Choice `id` | Label | Quality | Effects | Goes to |
| --- | --- | --- | --- | --- |
| `incident_command` | Stand up one incident command — you decide, counsel advises, Alvarez speaks — and brief Okonjo hourly | `best` | `regulatory_standing` +4, `instructional_continuity` +2, `community_trust` +4 | `scene:monday_morning` |
| `small_circle` | Keep the circle small — you, Delgado, counsel — and update the full board Monday | `acceptable` | `instructional_continuity` +2, `community_trust` -5 | `scene:monday_morning` |
| `everyone_decides` | Put every cabinet member and both board officers on a running call and decide as a group; nobody should feel shut out | `poor` | `regulatory_standing` -10, `instructional_continuity` -5, `community_trust` -5 | `scene:monday_morning` |

**Feedback — `incident_command`:**
> Incident command is not bureaucracy; it is the mechanism that stops six people giving five versions of the same facts. Hourly briefings to your board president keep governance informed without moving the decision out of the room where the facts are.

**Feedback — `small_circle`:**
> A small circle moves fast. It also means every question in the district lands on the three most overloaded people in it, and by Monday your board will have learned about this from somebody who is not you.

**Feedback — `everyone_decides`:**
> Inclusion is not coordination. A twelve-person call with no decision-maker produces twelve partial accounts, and one of them reaches a parent group before the facts are stable enough to correct.

**SME defensibility:**
- `incident_command` (best): unified command with a single spokesperson and a defined decision-maker is baseline incident-response doctrine and protects the accuracy of the public record.
- `small_circle` (acceptable): workable in the first hours, does not scale past the first day, and delayed board notification is a governance weakness rather than a legal failure.
- `everyone_decides` (poor): undifferentiated group decision-making during an incident degrades response speed and message discipline — the classic failure mode of well-intentioned transparency.

### Scene `monday_morning` — "Thirty-six hours to Monday"

**Body:**
> School opens in thirty-six hours. Without the student information system there is no attendance, no gradebook, no medication list at the health office, and no service log for the roughly six hundred students whose plans entitle them to specific minutes of support. Elena Duarte says the high school can run attendance on paper. Marcus Bell says his office cannot verify who is allowed to pick up a kindergartner. Delgado's estimate for partial restoration is four to nine days.

| Choice `id` | Label | Quality | Effects | Goes to |
| --- | --- | --- | --- | --- |
| `paper_protocols` | Open on time with published paper protocols for attendance, medication, pickup verification, and service logs | `best` | `instructional_continuity` +8, `regulatory_standing` +2, `community_trust` +4 | `scene:what_to_say` |
| `delay_two_days` | Close Monday and Tuesday as emergency days, restore what you can, and reopen Wednesday on whatever is back | `acceptable` | `instructional_continuity` -8, `regulatory_standing` +2, `community_trust` -2 | `scene:what_to_say` |
| `open_and_improvise` | Open on time and tell principals to improvise; they know their families | `poor` | `instructional_continuity` -14, `regulatory_standing` -12, `community_trust` -8 | `scene:what_to_say` |

**Feedback — `paper_protocols`:**
> Continuity is a set of specific written workarounds, not a decision to be brave. Putting the service-log plan in writing is also what later lets the district show that entitled minutes were delivered rather than merely intended.

**Feedback — `delay_two_days`:**
> Two days buys real technical room. The price is six thousand students' instruction and several thousand families' childcare, neither of which anyone had planned for. It is a defensible call. It is not a free one.

**Feedback — `open_and_improvise`:**
> Principals will improvise regardless; the question is whether they improvise from a common protocol or invent forty of them. Medication and custody release are the two places where a good-faith improvisation becomes a child in the wrong car.

**SME defensibility:**
- `paper_protocols` (best): documented manual continuity procedures, especially for health, custody release and service logging, preserve instruction while keeping an auditable service record.
- `delay_two_days` (acceptable): closure is legitimate where safety-critical systems cannot be substituted, but the instructional and family costs are real and need justifying.
- `open_and_improvise` (poor): devolving safety-critical processes without protocol creates uncontrolled variation in exactly the areas where error is most consequential.

### Scene `what_to_say` — "The first message"

**Body:**
> Alvarez needs a first message by Sunday noon; a screenshot of the ransom note is already circulating in a parents' group chat. Counsel's advice is that anything you say about what was taken could be wrong within a day. What you know is narrow: systems are down, an investigation is under way, and here is what Monday looks like. What families are asking is whether their children's records are in somebody else's hands.

| Choice `id` | Label | Quality | Effects | Goes to |
| --- | --- | --- | --- | --- |
| `say_what_you_know` | Publish now: what happened, what you do not yet know, what Monday looks like, and when the next update comes | `best` | `community_trust` +10, `regulatory_standing` +2 | `scene:the_demand` |
| `brief_staff_first` | Brief principals and staff Sunday so they can answer families Monday, and hold the public statement until you know more | `acceptable` | `community_trust` -4, `regulatory_standing` +2, `instructional_continuity` +4 | `scene:the_demand` |
| `say_nothing_yet` | Say nothing until the forensic picture is clear; a wrong statement now is worse than silence | `poor` | `community_trust` -14, `regulatory_standing` -4 | `scene:the_notification` |

**Feedback — `say_what_you_know`:**
> A stated update rhythm is the most valuable thing you can offer while the facts are thin, because it converts an information vacuum into a wait people can tolerate. Publishing your uncertainties is also what makes tomorrow's corrections survivable.

**Feedback — `brief_staff_first`:**
> Staff who can answer questions are worth a great deal. A message given to four hundred employees, though, is a public message with extra steps and no timestamp — and the screenshot in the group chat is not going to wait for your confidence to catch up.

**Feedback — `say_nothing_yet`:**
> Silence is not neutral. It says the district either does not know or will not say, and both readings are worse than here is what we know so far. The correction you are afraid of is far cheaper than the vacuum you are creating.

**SME defensibility:**
- `say_what_you_know` (best): early bounded disclosure with a committed cadence is standard crisis-communication practice and does not prejudice a forensic investigation when limited to confirmed operational facts.
- `brief_staff_first` (acceptable): internal-first communication is legitimate but is not confidential in effect, and the delay cedes the narrative during the highest-attention window.
- `say_nothing_yet` (poor): total silence during an active public incident is the least defensible posture; accuracy is protected by scoping a statement, not by withholding it.

### Scene `the_demand` — "The demand"

**Body:**
> The intruders want payment, and promise both a decryption key and the deletion of everything they copied. The insurer says the decision is yours and coverage does not turn on it. Delgado's backups turn out to be nine days stale for the student information system, which is precisely what the deferred maintenance line was going to fix. Paying might shorten the outage by a week. It would also fund the next district's incident, and the promise to delete stolen data is unverifiable by definition.

| Choice `id` | Label | Quality | `showIf` | Effects | Goes to |
| --- | --- | --- | --- | --- | --- |
| `decline_and_rebuild` | Decline the payment, rebuild from the backups that exist, and tell the board why in writing, with the nine-day gap named | `best` | none | `regulatory_standing` +4, `community_trust` +4, `instructional_continuity` -4 | `scene:the_notification` |
| `public_stance` | Say publicly that Sierra Vista will not pay, publish the restoration timeline, and ask families for patience by a specific date | `best` | `community_trust` `gte` **60** | `regulatory_standing` +3, `community_trust` +10, `instructional_continuity` -4 | `scene:the_notification` |
| `pay_quietly` | Authorize payment through the insurer's negotiator and keep it out of the public account; Monday matters more than principle | `poor` | none | `regulatory_standing` -16, `community_trust` -12, `instructional_continuity` +8 | `scene:the_notification` |

**Feedback — `decline_and_rebuild`:**
> The unverifiable half of the offer is the whole offer: nobody can confirm that copied data was deleted. Naming the backup gap yourself, in the same memo, is what keeps it from being discovered later as a second story.

**Feedback — `public_stance`:**
> A public refusal is a commitment you can only make if people will wait through the outage it buys, which is a trust question rather than a technical one — and it is why this option is open to you now and would not have been in a district that had spent its credibility. Publishing the timeline is what makes the ask concrete instead of a slogan.

**Feedback — `pay_quietly`:**
> Payment might shorten the outage and it cannot buy the data back, because the only evidence of deletion is the word of the people who took it. Keeping a material expenditure out of the public account is a second decision, and a much harder one to defend than the payment itself.

**SME defensibility:**
- `decline_and_rebuild` (best): declining payment aligns with law-enforcement and sector guidance and avoids funding further attacks; proactively disclosing the backup gap is the accountable handling of a known prior decision.
- `public_stance` (best, conditional): a public stance is strong practice where community patience exists; taken without it, the extended outage becomes the story and the position becomes untenable mid-incident — hence the gate.
- `pay_quietly` (poor): payment is contested but not unheard of as an operational choice; concealing it from the board and the public record is the indefensible element, independent of the payment.

### Scene `the_notification` — "What was taken"

**Body:**
> On Wednesday the forensic firm confirms what everyone feared: files were copied out before the encryption, including a directory of names, dates of birth, home addresses and service plans for students going back six years. Counsel says the notification clock runs from the determination that records were acquired, and that the determination is now. Roy Vance argues for waiting until the firm can say precisely which students are affected — we should tell families something useful, he says, not something frightening.

| Choice `id` | Label | Quality | `showIf` | Effects | Goes to |
| --- | --- | --- | --- | --- | --- |
| `notify_now` | Notify now: tell every family in the affected years what is known and what is not, and follow with specifics later | `best` | none | `regulatory_standing` +5, `community_trust` +6 | `scene:staff_and_families` |
| `joint_notice` | Send counsel's Saturday draft jointly with the state agency and the county office, and open a family help line the same hour | `best` | `regulatory_standing` `gte` **80** | `regulatory_standing` +6, `community_trust` +8, `instructional_continuity` +2 | `scene:staff_and_families` |
| `wait_for_the_list` | Take Vance's position and wait until the firm can name the affected students, so the notice tells families something useful rather than something frightening | `poor` | none | `regulatory_standing` -18, `community_trust` -10 | `scene:staff_and_families` |

**Feedback — `notify_now`:**
> Waiting for a perfect list means families learn this from somebody else first, and the duty does not pause for precision. Two notices, one prompt and honest and one specific, beat a single late and complete one.

**Feedback — `joint_notice`:**
> The reason this option exists on Wednesday is that counsel was in the room on Saturday morning: the notice was drafted before anyone needed it. Issuing jointly with the agencies also means families get one consistent account instead of three competing ones.

**Feedback — `wait_for_the_list`:**
> The argument for waiting is sincere, and it converts a disclosure obligation into a discretionary judgment the district does not get to make. Every day of waiting is a day families could have been protecting their children's records and were not told to.

**SME defensibility:**
- `notify_now` (best): prompt notification upon determination, refined as scope firms up, is both the compliant and the ethical sequence — breach-notification clocks run from determination, not from completed scoping.
- `joint_notice` (best, conditional): coordinated notification with oversight agencies is best practice and is only actually available when counsel was engaged early enough to have prepared it, which is what the gate encodes.
- `wait_for_the_list` (poor): delaying notification pending complete scoping is a common instinct and a compliance failure; the affected families' ability to act is the reason the clock is short.

### Scene `staff_and_families` — "The people doing the work"

**Body:**
> Teachers have spent six days reconstructing eleven weeks of grades from paper and memory. Tom Brackett puts it plainly: his members will do it, and they want to know whether it is being counted as work or expected as goodwill. Meanwhile Alvarez's help line is taking two hundred calls a day with three people answering.

| Choice `id` | Label | Quality | `showIf` | Effects | Goes to |
| --- | --- | --- | --- | --- | --- |
| `pay_and_staff` | Compensate the reconstruction work at the contractual rate, and pull substitutes and central office staff onto the help line | `best` | none | `instructional_continuity` +8, `community_trust` +6 | `scene:the_after_action` |
| `working_group_line` | Ask April's family working group to run a parent-to-parent help line beside the district's, on a shared script | `best` | `community_trust` `gte` **60** | `instructional_continuity` +6, `community_trust` +12 | `scene:the_after_action` |
| `ask_for_goodwill` | Thank staff publicly and ask them to absorb the work; the budget is already carrying an incident | `poor` | none | `instructional_continuity` -10, `community_trust` -12 | `ending:trust_deficit` |

**Feedback — `pay_and_staff`:**
> Recovery is labor, and labor performed in a crisis is still labor. Paying for it is the contractual answer and the reason those people will still be standing when the next thing happens.

**Feedback — `working_group_line`:**
> Families answering families is faster and warmer than any phone tree you could build in a week, and it is possible only because the working group already existed and already trusted the district's numbers. The shared script is what keeps it accurate.

**Feedback — `ask_for_goodwill`:**
> Gratitude is not compensation. Asking people to donate labor after a decision they had no part in is how a technical incident becomes a labor dispute, and the budget argument is a reason to go to the board rather than to the staff.

**SME defensibility:**
- `pay_and_staff` (best): compensating additional duties is the contractually and ethically required position; unpaid crisis labor is a durable morale and bargaining cost.
- `working_group_line` (best, conditional): leveraging an established community structure multiplies capacity, and attempting it without an existing relationship shifts district error onto volunteers — hence the gate.
- `ask_for_goodwill` (poor): requesting uncompensated additional duties is a contractual and relational failure; fiscal pressure argues for a board conversation, not for moving cost onto employees.

### Scene `the_after_action` — "After-action"

**Body:**
> Six weeks later the systems are back, the notification is complete, and the board has scheduled an after-action review in open session. Cho's estimate is $1.4 million between recovery, credit monitoring for families, and the endpoint renewal that was deferred last February. Every decision you made sits on a timeline in the board packet, including the ones made at 5:40 on a Saturday morning.

| Choice `id` | Label | Quality | Effects | Goes to |
| --- | --- | --- | --- | --- |
| `own_the_deferral` | Present the full timeline, own the February deferral as a contributing decision, and bring the multi-year replacement plan | `best` | `community_trust` +8, `regulatory_standing` +5, `instructional_continuity` +4 | `ending:stewardship` |
| `technical_findings_only` | Present the technical timeline and the vendor's recommendations, and take the budget history up separately with the board in the spring | `acceptable` | `community_trust` +2, `regulatory_standing` +2 | `ending:contained_but_costly` |
| `blame_the_vendor` | Frame the review around the vendor's failure and the sophistication of the attack, which no district of this size could have stopped | `poor` | `community_trust` -16, `regulatory_standing` -12 | `ending:regulatory_reckoning` |

**Feedback — `own_the_deferral`:**
> An after-action review is worth exactly as much as its least comfortable sentence. Naming your own earlier decision as a contributing cause is what converts an incident into a budget the board will actually fund.

**Feedback — `technical_findings_only`:**
> The technical findings are accurate and incomplete. An intrusion that succeeded partly because of a deferred renewal is not only a technical event, and the separate conversation you are promising tends never to happen.

**Feedback — `blame_the_vendor`:**
> Attributing an incident entirely outward ends the inquiry before it reaches anything the district could change. It also does not survive a records request, because last February's board packet is a public document.

**SME defensibility:**
- `own_the_deferral` (best): candid causal analysis including the leader's own prior decisions is the standard of a credible after-action review and the precondition for corrective investment.
- `technical_findings_only` (acceptable): technically sufficient and analytically shallow; excluding fiscal causation predictably prevents the corrective investment.
- `blame_the_vendor` (poor): external attribution without self-assessment forecloses corrective action and is contradicted by the district's own public record.

### Ending `stewardship` — "The account that holds"

**Body (two paragraphs):**
> The board adopts a four-year replacement plan at the same meeting, 5 to 0, and Roy Vance is the one who moves it. The state agency's review closes with findings on the district's controls and none on its conduct: notification was timely, the record is complete, and the account the district gave of itself on day two matches the account the forensic firm gave on day forty. Andre Whitfield's volunteers answered eleven hundred family calls.
>
> None of this made the incident less expensive. Six thousand students lost instructional time, six years of records are in somebody else's hands, and $1.4 million that was going to do something else is gone. What Sierra Vista has instead is the only asset that survives an event like this one: a district whose account of itself can be checked. That is what you spent three years building, one decision at a time, starting with a $1.9 million problem on a Tuesday in February.

### Ending `contained_but_costly` — "Recovered, not learned"

**Body (two paragraphs):**
> Systems are restored, the notification went out, and the after-action review is filed with the vendor's recommendations attached. Nobody was misled and nothing was concealed. The review simply stopped where the technology stopped, and so the replacement plan goes to the board as a line item in the spring rather than as the answer to a question the board is still asking.
>
> The plan is funded at about half. Two winters from now, the part that was not funded will be the part that matters — which is roughly what happened to the maintenance line last February, and is the reason an after-action review that avoids the budget is an incomplete one.

### Ending `trust_deficit` — "Technically recovered"

**Body (two paragraphs):**
> The systems come back. Two hundred and forty teachers reconstruct eleven weeks of grades on their own time, the association files a grievance in March, and the fall bargaining opens with an article on emergency duties that will take eleven months to settle. Family calls go unanswered for days because three people cannot answer two hundred calls, and the help line's voicemail box is full for most of a week.
>
> Every technical objective was met. The district recovered its data and lost something it will need next time: the assumption, among the people who actually delivered the recovery, that the district notices what it is asking of them. A crisis is a withdrawal from an account somebody has to have funded first.

### Ending `regulatory_reckoning` — "The record that answers for you"

**Body (two paragraphs):**
> The state agency's review does not close. Its findings run to the notification timeline, the absence of a written incident response plan, and the district's public statements measured against what it knew when it made them. The county office assigns a technical monitor for eighteen months. In April, a reporter obtains last February's board packet and lays the deferred maintenance line beside your after-action presentation, and the story writes itself without a single unfair sentence in it.
>
> The intrusion was not your fault. The account of it was yours to give, and you gave one the record does not support. That is the difference between an incident a district survives and one it spends years explaining.

## 6. Verification

**Graph (must hold after transcription):**

| Scene | Reached from | Unconditional exits | Reaches an ending |
| --- | --- | --- | --- |
| `the_saturday_call` | start | 3 | via `the_first_hour` |
| `the_first_hour` | `the_saturday_call` | 3 | via `monday_morning` |
| `monday_morning` | `the_first_hour` | 3 | via `what_to_say` |
| `what_to_say` | `monday_morning` | 3 | via `the_demand` / `the_notification` |
| `the_demand` | `what_to_say` (best, acceptable) | 2 unconditional + 1 conditional | via `the_notification` |
| `the_notification` | `the_demand` (3), `what_to_say` (`say_nothing_yet`) | 2 unconditional + 1 conditional | via `staff_and_families` |
| `staff_and_families` | `the_notification` | 2 unconditional + 1 conditional | direct (`ending:trust_deficit`) and via `the_after_action` |
| `the_after_action` | `staff_and_families` (best, conditional) | 3 | direct, to 3 endings |

All eight scenes reachable; every scene has at least two choices without `showIf`; all four endings reachable (`trust_deficit` from `staff_and_families`, the other three from `the_after_action`).

**Conditional gates:**

| Gate | Where | Meaning | Reachable on a best path | Locked on a weak path |
| --- | --- | --- | --- | --- |
| `community_trust gte 60` | `the_demand` → `public_stance` | you can only take a public position if people will wait for you | entry trust 55+2+4+4+10 = 75 | all-`acceptable` route: 44 |
| `regulatory_standing gte 80` | `the_notification` → `joint_notice` | the drafted notice exists only if counsel was engaged Saturday | entry standing 70+6+4+2+2+4 = 88 | without `isolate_and_convene` the ceiling is 74 |
| `community_trust gte 60` | `staff_and_families` → `working_group_line` | the working group exists because of module 2 | entry trust 85 on the best path | ≤ 48 after two poor choices |

The middle gate is the arc's sharpest teaching point: it is mathematically unreachable unless the learner isolated and convened counsel in scene 1.

**Range sanity:** the all-`best` unconditional path ends at `community_trust` 99, `instructional_continuity` 90, `regulatory_standing` 98 — inside [0, 100] with no clamping. An all-`poor` path floors `regulatory_standing` and `community_trust` at 0, which is intended and visible.

## 7. Sources

Scenario content is original and fictional; no real incident, district, vendor or person is depicted, and the intrusion is described only in terms a superintendent would experience (systems unavailable, a note, a demand). Nothing operational about the attack is described, deliberately.

Professional expectations behind the quality ratings:

- National Institute of Standards and Technology, SP 800-61 Rev. 2, *Computer Security Incident Handling Guide* — the preparation/detection/containment/eradication/recovery/post-incident sequence, and the primacy of evidence preservation.
- Cybersecurity and Infrastructure Security Agency and the Multi-State Information Sharing and Analysis Center, *Ransomware Guide* — engaging counsel, insurers and partner agencies early; the standing guidance that payment does not guarantee data deletion and funds further attacks.
- W. Timothy Coombs, *Ongoing Crisis Communication: Planning, Managing, and Responding* (Situational Crisis Communication Theory) — early, bounded disclosure with a stated update cadence; the cost of silence during high-attention windows.
- Family Educational Rights and Privacy Act, 20 U.S.C. §1232g, and the US Department of Education's Privacy Technical Assistance Center guidance on data breach response in education agencies; state student-data breach notification statutes are referenced generically, and the timing principle used here (the clock runs from determination) is common to them.
- Individuals with Disabilities Education Act, 20 U.S.C. §1400 et seq. — the service-log obligation that makes `paper_protocols` more than an operational nicety.
- National Policy Board for Educational Administration, *Professional Standards for Educational Leaders* (2015) — Standards 8 and 9.

## 8. Images

None. This starter ships image-less; no scene carries `imageAssetId`, `imageRole`, or `imageAlt`.

## 9. Transcription checklist

- [ ] 8 scenes with the ids in §5; `startSceneId: "the_saturday_call"`.
- [ ] Exactly 3 variables, all `visible: true`.
- [ ] Exactly 3 `showIf` choices with the exact comparators and values in §5.
- [ ] Every scene keeps at least two unconditional choices.
- [ ] 4 endings with the ids and bodies in §5.
- [ ] Intro text from §4 (carries the learning objective).
- [ ] Arc references kept in text: the February deferral and maintenance line (module 1), the April meeting and the family working group (module 2), Andre Whitfield by name.
- [ ] SME lines are **not** transcribed into the config.
- [ ] `validateBranchingConfig` returns ok; the §6 graph and gate tables hold.
