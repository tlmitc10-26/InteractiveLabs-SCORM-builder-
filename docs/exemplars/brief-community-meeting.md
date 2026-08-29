# Content brief: The Community Meeting

**Slug:** `community-meeting` · **Engine:** branching-scenario · **Arc position:** module 2 of 3 (Sierra Vista Unified)
**Escalation contract (spec §2):** exactly **2** variables in tension, **6** scenes, at least **one conditional (`showIf`) choice**.
**Status:** content complete; transcribe verbatim, invent nothing.

---

## 1. Learning objective

Learner-visible, appears in the interactive's intro:

> By the end of this scenario you will be able to design and run a public meeting that satisfies its legal requirements and is genuinely worth attending, and to explain why meeting the requirement is the floor of community engagement rather than the goal.

## 2. Discipline pattern

The second thing every leadership program has to teach is that two legitimate obligations can pull in opposite directions, and that the learner will be held to both. Compliance is measurable and unforgiving; trust is unmeasurable and easier to spend than to earn. Programs usually teach them in separate weeks — a law-and-policy module and a communications module — and students leave able to pass both and unable to hold them at once. A two-variable branching scenario is the smallest structure that forces the simultaneous judgment, and the conditional choice is what makes the pedagogy land: an option that appears only when trust was managed well is the clearest possible demonstration that credibility is a capacity, not a mood. This is the shape a designer reaches for the second time they use the engine, and the reason module 2 exists in the arc.

## 3. Notation for transcription

- **Quality words** are the schema's enum: `best`, `acceptable`, `poor` (companion-doc text: `BEST`, `OK`, `POOR`).
- **Scene and ending bodies:** each paragraph becomes one `<p>…</p>`.
- **Feedback lines** are the `feedback` field, learner-visible.
- **SME line** on each choice is a review rationale — **brief-only**, never in the config or shown to the learner.
- **Conditional choice:** `showIf: { variableId: "community_trust", comparator: "gte", value: 60 }`. Only one choice in the whole module carries a `showIf`, and its scene has two unconditional choices beside it.
- `feedbackMode: "debrief"`, `showPathInDebrief: true`.

## 4. Configuration summary

| Field | Value |
| --- | --- |
| `title` | The Community Meeting |
| `role` | You are the superintendent of Sierra Vista Unified. The mid-year reduction you made in February is three weeks old and the questions have not stopped. |
| `startSceneId` | `the_ask` |
| scenes | 6 (`the_ask`, `the_notice`, `the_agenda`, `the_room`, `the_hard_question`, `the_follow_through`) |
| endings | 3 (`partnership`, `compliant_but_cold`, `procedurally_exposed`) |
| variables | 2 |
| `feedbackMode` | `debrief` |

**Variables (exactly two, in tension):**

| id | label | initial | min | max | visible |
| --- | --- | --- | --- | --- | --- |
| `community_trust` | Community trust | 50 | 0 | 100 | true |
| `district_compliance` | District compliance | 70 | 0 | 100 | true |

Both are oriented the same way — higher is better — so the tension is in the choices rather than in reading the meters.

**Intro (learner-visible, carries the objective):**

> In February, Sierra Vista Unified absorbed a $1.9 million mid-year reduction. Three weeks later the questions have not stopped, and before the board can adopt the revised spending plan the state requires a properly noticed public hearing. You are the superintendent, and you have nine days.
>
> By the end of this scenario you will be able to design and run a public meeting that satisfies its legal requirements and is genuinely worth attending, and to explain why meeting the requirement is the floor of community engagement rather than the goal. Two things are tracked: **Community trust** and **District compliance**. They are not the same thing, and one of the choices later on will only be open to you if the first one is high enough.

**Recurring cast (identical to module 1 — do not rename):** Delia Okonjo (board president), Roy Vance and Priya Raman (board members), Wendell Cho (chief business official), Simone Alvarez (communications director), Tom Brackett (SVEA president), Elena Duarte and Marcus Bell (principals), Ray Delgado (operations). New in this module: **Andre Whitfield**, a middle-school parent who becomes the family working group's co-chair and returns in module 3.

## 5. Content

### Scene `the_ask` — "Nine days"

**Body:**
> Delia Okonjo wants a community meeting before the board adopts the revised spending plan, which state law says cannot happen without a properly noticed public hearing, materials posted seventy-two hours ahead, and interpretation available on request. Tom Brackett has asked that teachers be able to speak without signing up through their principals. You have nine days, one communications director, and a district where about a third of families speak Spanish at home.

| Choice `id` | Label | Quality | Effects | Goes to |
| --- | --- | --- | --- | --- |
| `one_meeting_both` | Hold one meeting that satisfies the hearing requirements and is built for listening, and say in the notice that it is both | `best` | `community_trust` +6, `district_compliance` +6 | `scene:the_notice` |
| `two_events` | Run the legal hearing at the board meeting and a separate informal community night the week before | `acceptable` | `community_trust` +4, `district_compliance` +3 | `scene:the_notice` |
| `hearing_only` | Do what the law requires: notice the hearing, take public comment, adopt the plan | `poor` | `community_trust` -10, `district_compliance` +5 | `scene:the_notice` |

**Feedback — `one_meeting_both`:**
> Merging the legal hearing and the community conversation works only if you tell people that is what you are doing. Said out loud in the notice, the requirement reads as a floor you are building on rather than a substitute for the conversation.

**Feedback — `two_events`:**
> Two events give the informal conversation room to breathe, and they double what one communications director has to staff. They also risk families attending the night that has no legal standing, so nothing they say enters the record.

**Feedback — `hearing_only`:**
> Meeting the requirement is not the same as answering the question, and a district that answers only what it must teaches families to ask somewhere else. Notice how compliance went up here while trust went down: that is the whole shape of this scenario.

**SME defensibility:**
- `one_meeting_both` (best): a single properly noticed hearing can carry both functions when the notice discloses the dual purpose; splitting costs capacity without adding legal protection.
- `two_events` (acceptable): defensible and common practice; the cost is staffing and the risk that comment made at the informal event never enters the official record.
- `hearing_only` (poor): legally sufficient and the weakest available practice — it satisfies the procedural duty while forgoing the engagement that makes an adopted plan durable.

### Scene `the_notice` — "What the notice actually does"

**Body:**
> Simone Alvarez drafts the notice on Monday. The requirement is seventy-two hours with materials posted; the practical question is whether a family working two jobs can act on a notice that goes out Friday afternoon for a Tuesday meeting. Interpretation is available on request, which in practice means available to people who know to request it. The translated packet is running four days behind the English one.

| Choice `id` | Label | Quality | Effects | Goes to |
| --- | --- | --- | --- | --- |
| `ten_days_translated` | Notice ten days out, post both language versions together, and staff interpretation by default | `best` | `community_trust` +8, `district_compliance` +8 | `scene:the_agenda` |
| `minimum_plus_outreach` | Post at the seventy-two hour mark, then push the meeting through newsletters, the parent text system, and Brackett's members | `acceptable` | `community_trust` +5, `district_compliance` +5 | `scene:the_agenda` |
| `friday_minimum` | Post Friday at the mark and let Alvarez handle the rest; you have next year's budget to rebuild | `poor` | `community_trust` -8, `district_compliance` -5 | `scene:the_room` |

**Feedback — `ten_days_translated`:**
> Going past the required notice period is not generosity; it is the difference between a meeting families can attend and a meeting families were technically told about. Interpretation by default removes a request nobody should have to make in the first place.

**Feedback — `minimum_plus_outreach`:**
> Amplification does real work and it reaches the families already connected to a school. The families the newsletter never reaches are exactly the ones a longer notice window was there to protect.

**Feedback — `friday_minimum`:**
> A Friday notice for a Tuesday meeting is compliant the way an unlit exit sign is a sign. The translated packet also still is not posted, which is the difference between an engagement problem and a hearing somebody can challenge.

**SME defensibility:**
- `ten_days_translated` (best): exceeds the procedural floor in the dimension that actually determines participation; simultaneous posting of language versions is standard equity practice.
- `minimum_plus_outreach` (acceptable): compliant and actively promoted; the residual gap is the least-connected families, which a longer window would partly have closed.
- `friday_minimum` (poor): within the notice period yet foreseeably suppressing attendance, and posting materials in only one language creates real procedural exposure rather than a rhetorical one.

### Scene `the_agenda` — "Designing the room"

**Body:**
> You have the room for two hours. Alvarez has built a forty-minute slide deck explaining the state revenue revision, the three options Cho analyzed, and why the board chose what it chose. Brackett says his members will not sit through forty minutes of slides. The middle-school parent group has asked whether anyone is going to answer questions or just present.

| Choice `id` | Label | Quality | Effects | Goes to |
| --- | --- | --- | --- | --- |
| `ten_minutes_then_tables` | Cut the presentation to ten minutes, break to facilitated tables with staff at each, and hold the last half hour for questions on the record | `best` | `community_trust` +8, `district_compliance` +2 | `scene:the_room` |
| `twenty_and_qa` | Trim the deck to twenty minutes and run open question-and-answer for the rest | `acceptable` | `community_trust` +5, `district_compliance` +2 | `scene:the_room` |
| `full_deck` | Present the whole deck. If people understand the arithmetic, the anger takes care of itself | `poor` | `community_trust` -12 | `scene:the_room` |

**Feedback — `ten_minutes_then_tables`:**
> A meeting is a listening instrument or it is a broadcast. Ten minutes of context and ninety of structured listening still puts every fact from the deck on the record and in the handout, where people can read it at their own speed.

**Feedback — `twenty_and_qa`:**
> Open question-and-answer is honest, and it rewards whoever is loudest and most practiced with a microphone. The families most affected by the cut are frequently not those people.

**Feedback — `full_deck`:**
> People rarely arrive angry because they misunderstood the arithmetic. They arrive because something was taken and nobody asked them first, and forty minutes of slides answers a question nobody in the room is asking.

**SME defensibility:**
- `ten_minutes_then_tables` (best): facilitated small-group design with a public comment segment preserves the hearing record while maximizing genuine participation — standard public-engagement practice.
- `twenty_and_qa` (acceptable): legitimate and transparent; open-mic format is known to over-represent confident speakers relative to affected populations.
- `full_deck` (poor): information-deficit framing is the most common and least effective engagement failure — it mistakes disagreement for misunderstanding.

### Scene `the_room` — "Meeting night"

**Body:**
> A hundred and forty people, more than the room has chairs for, plus three board members and a reporter from the county weekly. Before you begin, a group from the middle school asks to read a petition with four hundred signatures into the record, which is not on the agenda you posted. Okonjo looks at you; amending the agenda at the top of the meeting is yours to do. Whatever happens next, the room will read it as the answer to whether this meeting is real.

| Choice `id` | Label | Quality | Effects | Goes to |
| --- | --- | --- | --- | --- |
| `accept_petition` | Amend the agenda to accept the petition into the record, and say aloud why the amendment is being made | `best` | `community_trust` +8, `district_compliance` +4 | `scene:the_hard_question` |
| `petition_in_comment` | Ask them to read it during the public comment period already on the agenda | `acceptable` | `community_trust` +3, `district_compliance` +5 | `scene:the_hard_question` |
| `decline_not_on_agenda` | Decline; the agenda was posted, and changing it now is how hearings get challenged | `poor` | `community_trust` -14, `district_compliance` +2 | `scene:the_follow_through` |

**Feedback — `accept_petition`:**
> Taking the petition on the record costs six minutes and settles the only question the room had about your intentions. Announcing the amendment aloud is the part that keeps it procedurally clean.

**Feedback — `petition_in_comment`:**
> Public comment is the right procedural home for it, and the wait reads as a delay to people who have been waiting since February. Nothing is lost from the record; some goodwill is.

**Feedback — `decline_not_on_agenda`:**
> The instinct to protect the record is right and applied backwards here. Accepting a written submission does not create a notice defect, and refusing one in front of a hundred and forty people puts everything else at risk instead.

**SME defensibility:**
- `accept_petition` (best): accepting public submissions with an announced agenda amendment is procedurally routine; refusing invites the perception that the hearing is decorative.
- `petition_in_comment` (acceptable): procedurally the cleanest route, since public comment is the designated channel, at a modest engagement cost.
- `decline_not_on_agenda` (poor): over-application of procedural caution — accepting written submissions creates no notice defect, and the refusal carries a large and avoidable engagement cost.

### Scene `the_hard_question` — "The question you cannot answer"

**Body:**
> Ninety minutes in, at one of the tables, a father named Andre Whitfield asks what the room actually came for: is the after-school program coming back in the fall. Cho's honest answer is that it depends on a state budget nobody will sign until late June. Yours has to be given now, out loud, to a man whose son is currently walking home to an empty apartment.

| Choice `id` | Label | Quality | `showIf` | Effects | Goes to |
| --- | --- | --- | --- | --- | --- |
| `uncertainty_with_date` | Say you do not know, explain exactly what the answer depends on, and commit to reporting back publicly on July 15 either way | `best` | none | `community_trust` +8, `district_compliance` +2 | `scene:the_follow_through` |
| `working_group` | Accept Whitfield's offer to co-chair a family working group that reviews restoration options with Cho before the June budget | `best` | `community_trust` `gte` **60** | `community_trust` +10, `district_compliance` +4 | `scene:the_follow_through` |
| `reassure` | Tell him you will fight to bring it back; the room needs to hear that somebody is on their side | `poor` | none | `community_trust` -8 | `scene:the_follow_through` |

**Feedback — `uncertainty_with_date`:**
> I do not know, here is what it depends on, here is when you will hear from me is a complete answer. It is also the only one you can still be standing behind in August.

**Feedback — `working_group`:**
> A working group is credible only if the families in it believe the district will use what they produce, which is why this option is open to you tonight and would not have been three weeks ago. Shared authorship changes what the conversation in the fall is about.

**Feedback — `reassure`:**
> A promise made to a room is remembered one family at a time. If June does not cooperate, the person who pays for tonight's applause is the father who told his son it was coming back.

**SME defensibility:**
- `uncertainty_with_date` (best): committing to a reporting date rather than an outcome is the accountable response to genuine uncertainty.
- `working_group` (best, conditional): co-designed review bodies are strong practice where trust supports them; offered without that foundation they read as delay and worsen credibility — which is precisely why the option is gated.
- `reassure` (poor): commitments contingent on funds the district does not control are the classic engagement error, buying short-term relief with next year's credibility.

### Scene `the_follow_through` — "Forty-eight hours later"

**Body:**
> The room empties by nine-forty. Alvarez has eleven pages of table notes, the petition, and forty-two comment cards; the reporter's questions are in your inbox; and the board adopts the revised plan in six days. What happens in the next forty-eight hours decides whether that meeting was a hearing or a performance.

| Choice `id` | Label | Quality | Effects | Goes to |
| --- | --- | --- | --- | --- |
| `publish_the_record` | Publish the table notes, the petition, and written answers to every question you could not answer in the room, in both languages, before the board votes | `best` | `community_trust` +8, `district_compliance` +6 | `ending:partnership` |
| `summary_to_board` | Give the board a written summary of the themes at the vote and post it afterward | `acceptable` | `community_trust` +5, `district_compliance` +5 | `ending:compliant_but_cold` |
| `move_on` | The meeting is done and the vote is Tuesday; get back to next year's budget | `poor` | `community_trust` -16, `district_compliance` -12 | `ending:procedurally_exposed` |

**Feedback — `publish_the_record`:**
> The record is the deliverable. Publishing what people said, in their own words, before the vote rather than after it, is what turns a hearing into evidence the board actually used.

**Feedback — `summary_to_board`:**
> A themes summary is real information, and it is your account of what people said rather than theirs, arriving with no time for anyone to correct it. Posted afterward, the record becomes a receipt instead of an input.

**Feedback — `move_on`:**
> An unpublished record is indistinguishable from no record, including to whoever later asks whether the hearing met its requirements. The meeting cost a hundred and forty people their evening; the write-up costs you four hours.

**SME defensibility:**
- `publish_the_record` (best): publishing the engagement record before the decision is what makes consultation part of the decision rather than a formality after it.
- `summary_to_board` (acceptable): satisfies the duty to inform the board; the timing and the paraphrase both reduce the consultation's weight, a quality gap rather than a defect.
- `move_on` (poor): failure to document and publish the hearing record leaves the district unable to demonstrate that consultation occurred, which is concrete procedural exposure on top of the trust cost.

### Ending `partnership` — "A district families argue with, not about"

**Body (two paragraphs):**
> The board adopts the revised plan with the table notes attached to the packet, and Priya Raman quotes two of them from the dais. The restoration working group meets for the first time in May with Cho's spreadsheets open on the table, and when the state budget lands in late June the answer it produces is not the one anyone wanted, but it is the group's answer as much as yours. Andre Whitfield reads the July 15 update at the board meeting himself.
>
> What Sierra Vista has now is not agreement. Roy Vance still votes his way and the middle-school families still want their program back. What it has is a district families argue with rather than argue about, and the difference will matter more than anyone expects the following winter, when the district needs people to believe a very difficult account of something on very little evidence.

### Ending `compliant_but_cold` — "Every box checked"

**Body (two paragraphs):**
> The hearing was properly noticed, comment was taken, the summary reached the board before the vote, and the plan was adopted. If anyone audits this process they will find nothing wrong with it, and that is an accurate description of what you built: a process with nothing wrong with it.
>
> Attendance at the next community meeting is thirty-one people. The families who came in April concluded that coming did not change anything, and they were not entirely wrong — the record they created reached the board as your summary of it. Compliance is a floor. You are standing on it.

### Ending `procedurally_exposed` — "The hearing you may have to hold again"

**Body (two paragraphs):**
> The board adopts the plan on Tuesday. In the third week of May a complaint arrives asking whether the hearing met its notice and language-access requirements, and the honest answer is that the district cannot fully demonstrate that it did, because nobody wrote down what happened. Counsel's advice is to re-notice and hold the hearing again, which is four more weeks and a second evening of a hundred and forty people's time.
>
> The meeting itself was not the failure. What failed was everything after it: the record that was never published, the questions never answered, the forty-two cards in a folder in Alvarez's office. A hearing that leaves no trace is, to everyone outside the room, a hearing that may as well not have happened.

## 6. Verification

**Graph (must hold after transcription):**

| Scene | Reached from | Unconditional exits | Reaches an ending |
| --- | --- | --- | --- |
| `the_ask` | start | 3 | via `the_notice` |
| `the_notice` | `the_ask` | 3 | via `the_agenda` / `the_room` |
| `the_agenda` | `the_notice` (best, acceptable) | 3 | via `the_room` |
| `the_room` | `the_agenda` (3), `the_notice` (`friday_minimum`) | 3 | via `the_hard_question` / `the_follow_through` |
| `the_hard_question` | `the_room` (best, acceptable) | 2 unconditional + 1 conditional | via `the_follow_through` |
| `the_follow_through` | `the_hard_question` (3), `the_room` (`decline_not_on_agenda`) | 3 | direct, to all 3 endings |

All six scenes reachable; every scene has at least one choice without `showIf`; all three endings reachable from `the_follow_through`.

**Conditional-gate arithmetic** (`community_trust` on entry to `the_hard_question`, gate is `gte 60`):

| Path through scenes 1–4 | Trust on entry | Working group offered |
| --- | --- | --- |
| all `best` | 50 + 6 + 8 + 8 + 8 = 80 | yes |
| all `acceptable` | 50 + 4 + 5 + 5 + 3 = 67 | yes |
| one `poor` (the agenda) otherwise best | 50 + 6 + 8 − 12 + 8 = 60 | yes, exactly at the gate |
| `friday_minimum` route (skips `the_agenda`) | 50 + 6 − 8 + 8 = 56 | no |
| two or more `poor` | ≤ 48 | no |

The gate therefore discriminates, and it is reachable — the exemplar test can assert both.

**Range sanity:** all-best path ends at trust 96 and compliance 98, inside [0, 100] with no clamping. An all-poor path floors both variables at 0, which is expected and visible to the learner.

## 7. Sources

Scenario content is original and fictional. Professional expectations behind the quality ratings:

- National Policy Board for Educational Administration, *Professional Standards for Educational Leaders* (2015) — Standard 8, Meaningful Engagement of Families and Community.
- International Association for Public Participation, *IAP2 Spectrum of Public Participation* — the distinction between informing, consulting, involving and collaborating that separates `full_deck` from `ten_minutes_then_tables`.
- Open-meetings and public-hearing law is described generically (notice period, posted materials, public comment, language access). No state statute is named, so the scenario transfers across programs; the requirements as described are common to every state's framework.
- Title VI of the Civil Rights Act of 1964 and the associated language-access guidance for recipients of federal funds — the basis for translation and interpretation being an obligation rather than a courtesy.

No real district, board, or individual is depicted; all names are fictional. Public-education fiscal politics are framed without partisan alignment: the fiscal-conservative and equity-focused board members are both given defensible positions and neither is the antagonist.

## 8. Images

None. This starter ships image-less; no scene carries `imageAssetId`, `imageRole`, or `imageAlt`.

## 9. Transcription checklist

- [ ] 6 scenes with the ids in §5; `startSceneId: "the_ask"`.
- [ ] Exactly 2 variables, both `visible: true`.
- [ ] Exactly one `showIf` in the module: `working_group`, `community_trust gte 60`.
- [ ] `the_hard_question` retains two unconditional choices (guaranteed-exit rule).
- [ ] 3 endings with the ids and bodies in §5.
- [ ] Intro text from §4 (carries the learning objective).
- [ ] Module-1 references kept in text: the February reduction, the $1.9 million, Cho's three options.
- [ ] SME lines are **not** transcribed into the config.
- [ ] `validateBranchingConfig` returns ok; the §6 graph and gate tables hold.
