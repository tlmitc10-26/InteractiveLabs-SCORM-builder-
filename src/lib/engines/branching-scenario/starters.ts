import { branchingConfigSchema, type BranchingConfig } from "./schema";

/**
 * Starter templates offered on the "New interactive" form for the branching
 * scenario engine. Each entry's `config` is parsed through
 * `branchingConfigSchema` at module load time so an invalid starter fails
 * immediately (a test asserts this — see tests/branching-starters.test.ts)
 * rather than surfacing as a runtime bug the first time someone picks it.
 * NOTE: `branchingConfigSchema.parse` only runs shape/field-level Zod
 * validation. The cross-ref and graph checks (dead ends, unreachable
 * scenes, the guaranteed-exit rule) live in `validateBranchingConfig`
 * (schema.ts), a separate pass this module does NOT run at load time. A
 * starter that parses but is graph-broken would not fail here — the
 * starters test covers that gap by additionally running every starter
 * through `validateBranchingConfig`.
 *
 * `config.title` here is a placeholder ("") — the real title always comes
 * from the "New interactive" form, never from the starter. Callers should go
 * through `branchingStarterConfig(starterId, title)` below rather than
 * reading `BRANCHING_STARTERS[id].config` directly, so the title is always
 * the one the designer actually typed.
 */
export const BRANCHING_STARTERS: Record<string, { label: string; description: string; group: "blank" | "exemplar"; config: BranchingConfig }> = {
  blank: {
    label: "Blank",
    description: "Two scenes and a fork to two endings — a minimal skeleton to build your own branching scenario from.",
    group: "blank",
    config: branchingConfigSchema.parse({
      title: "",
      variables: [
        { id: "confidence", label: "Confidence", initial: 50, min: 0, max: 100, visible: false },
      ],
      scenes: [
        {
          id: "opening",
          title: "Opening",
          body: "<p>You're about to make your first move in this scenario. Take a moment to think about how you want to approach the situation ahead.</p>",
          choices: [
            {
              id: "consider",
              label: "Consider the options",
              quality: "best",
              effects: [{ variableId: "confidence", delta: 10 }],
              feedback: "<p>Considering the options first sets up a more deliberate choice at the next step.</p>",
              goTo: "scene:decision",
            },
            {
              id: "direct",
              label: "Take the direct approach",
              quality: "acceptable",
              effects: [{ variableId: "confidence", delta: -5 }],
              feedback: "<p>Moving straight ahead can work, but skipping the options means you might miss a better path.</p>",
              goTo: "scene:decision",
            },
          ],
        },
        {
          id: "decision",
          title: "Decision",
          body: "<p>With the groundwork laid, it's time to decide how the situation will resolve.</p>",
          choices: [
            {
              id: "follow_through",
              label: "Follow through on your plan",
              quality: "best",
              effects: [{ variableId: "confidence", delta: 10 }],
              feedback: "<p>Following through builds on the groundwork you already laid and brings the scenario to a clear resolution.</p>",
              goTo: "ending:resolved",
            },
            {
              id: "change_course",
              label: "Change course at the last minute",
              quality: "poor",
              effects: [{ variableId: "confidence", delta: -10 }],
              feedback: "<p>Changing course now undoes the groundwork you laid and leaves things unresolved.</p>",
              goTo: "ending:unresolved",
            },
          ],
        },
      ],
      startSceneId: "opening",
      endings: [
        { id: "resolved", title: "A Resolved Outcome", body: "<p>Your choices led to a clear resolution. Use this starter as a foundation to build out your own branching scenario.</p>" },
        { id: "unresolved", title: "An Unresolved Outcome", body: "<p>Your choices left things unresolved. Edit this starter's scenes and choices to build your own story.</p>" },
      ],
      feedbackMode: "debrief",
      showPathInDebrief: true,
    }),
  },
  jury: {
    label: "Jury Deliberation",
    description: "Choices with quality scoring, a tracked variable, and a debrief.",
    group: "exemplar",
    config: branchingConfigSchema.parse({
      title: "",
      role: "You are a juror in a criminal trial.",
      variables: [
        { id: "jury_trust", label: "Jury trust", initial: 50, min: 0, max: 100, visible: true },
      ],
      scenes: [
        {
          id: "first_vote",
          title: "The First Vote",
          body: "<p>The foreperson calls for a vote before the discussion has really started. Most of the room leans toward a guilty verdict, but you still have doubts about the timeline evidence from the trial.</p>",
          choices: [
            {
              id: "speak_up",
              label: "Raise your doubts about the timeline before anyone votes",
              quality: "best",
              effects: [{ variableId: "jury_trust", delta: 10 }],
              feedback: "<p>Speaking up before the vote keeps the deliberation grounded in the evidence instead of the room's momentum.</p>",
              goTo: "scene:timeline",
            },
            {
              id: "stay_quiet",
              label: "Vote with the majority to keep things moving",
              quality: "poor",
              effects: [{ variableId: "jury_trust", delta: -10 }],
              feedback: "<p>Going along with the room silences a real doubt and lets pressure stand in for scrutiny.</p>",
              goTo: "scene:pressure",
            },
            {
              id: "demand_data",
              label: "Ask to re-examine the evidence list first",
              quality: "acceptable",
              effects: [],
              feedback: "<p>Asking to re-examine the evidence is a reasonable middle ground, though it stops short of naming your actual doubt.</p>",
              goTo: "scene:timeline",
            },
          ],
        },
        {
          id: "timeline",
          title: "The Timeline",
          body: "<p>The group reads back through the timeline of events. A witness statement conflicts with the security log, and no one has said so out loud yet.</p>",
          choices: [
            {
              id: "walk_through",
              label: "Walk the group through the conflict step by step",
              quality: "best",
              effects: [{ variableId: "jury_trust", delta: 15 }],
              feedback: "<p>Walking the room through the conflict turns a vague unease into a concrete point the jury can actually weigh.</p>",
              goTo: "scene:holdout",
            },
            {
              id: "dismiss_conflict",
              label: "Call it a clerical error and move on",
              quality: "poor",
              effects: [{ variableId: "jury_trust", delta: -15 }],
              feedback: "<p>Waving away a real conflict in the evidence skips the analysis the jury owes the defendant.</p>",
              goTo: "scene:pressure",
            },
          ],
        },
        {
          id: "pressure",
          title: "Under Pressure",
          body: "<p>Two jurors are pushing to finish before the weekend, and the room's patience is wearing thin.</p>",
          choices: [
            {
              id: "restate_duty",
              label: "Remind the room the standard is reasonable doubt, not convenience",
              quality: "best",
              effects: [{ variableId: "jury_trust", delta: 10 }],
              feedback: "<p>Naming the actual standard of proof refocuses the room on the verdict rather than the clock.</p>",
              goTo: "scene:holdout",
            },
            {
              id: "compromise_vote",
              label: "Suggest a quick second vote to test the waters",
              quality: "poor",
              effects: [{ variableId: "jury_trust", delta: -10 }],
              feedback: "<p>A quick vote taken under time pressure trades careful deliberation for a shortcut, and the doubts go unresolved.</p>",
              goTo: "ending:verdict_rushed",
            },
          ],
        },
        {
          id: "holdout",
          title: "The Holdout",
          body: "<p>One juror still refuses to discuss the case further, and the rest of the room looks to you to do something about it.</p>",
          choices: [
            {
              id: "invite_reasons",
              label: "Ask them to explain what evidence would change their mind",
              quality: "best",
              effects: [{ variableId: "jury_trust", delta: 10 }],
              feedback: "<p>Inviting the holdout to explain their reasoning keeps deliberation open instead of forcing a verdict past it.</p>",
              goTo: "ending:verdict_reasoned",
            },
            {
              id: "isolate",
              label: "Suggest the group proceed without their input",
              quality: "poor",
              effects: [{ variableId: "jury_trust", delta: -15 }],
              feedback: "<p>Sidelining a dissenting juror abandons deliberation exactly when it is needed most.</p>",
              goTo: "ending:verdict_rushed",
            },
            {
              id: "call_break",
              label: "Call a break, since the room trusts you enough to reset",
              quality: "acceptable",
              effects: [{ variableId: "jury_trust", delta: 5 }],
              feedback: "<p>A short break can lower the temperature, though it only works because the room already trusts your judgment.</p>",
              goTo: "ending:verdict_reasoned",
              showIf: { variableId: "jury_trust", comparator: "gte", value: 60 },
            },
          ],
        },
      ],
      startSceneId: "first_vote",
      endings: [
        { id: "verdict_reasoned", title: "A verdict the room can stand behind", body: "<p>The deliberation stayed grounded in the evidence, and the verdict follows the standard of proof the jury was asked to apply.</p>" },
        { id: "verdict_rushed", title: "A verdict, but not deliberation", body: "<p>The vote closed the case, but the doubts raised along the way were never actually resolved.</p>" },
      ],
      feedbackMode: "debrief",
      showPathInDebrief: true,
    }),
  },
  "budget-cut": {
    label: "The Budget Cut",
    description: "One tracked variable, four scenes — the base pattern.",
    group: "exemplar",
    config: branchingConfigSchema.parse({
      title: "",
      role: "You are the superintendent of Sierra Vista Unified, a public school district of about 6,200 students, in your second year in the job.",
      intro:
        "<p>Sierra Vista Unified has 6,200 students, four months left in its fiscal year, and $1.9 million less than it had yesterday. You are the superintendent. By the end of this scenario you will be able to choose where a mid-year reduction lands and defend that choice on the record: naming the impact before the recommendation, disclosing what the plan costs in future years, and answering the people it hurts in the room where the decision is made.</p><p>One thing is tracked as you go: <b>Board confidence</b> — how much credibility you carry into the next decision. There is no option here that harms nobody. Choose the one you could explain in public.</p>",
      variables: [
        { id: "board_confidence", label: "Board confidence", initial: 50, min: 0, max: 100, visible: true },
      ],
      scenes: [
        {
          id: "the_memo",
          title: "The February memo",
          body:
            "<p>The state's second-quarter revision landed this morning: Sierra Vista Unified must absorb a 3 percent reduction, about $1.9 million, in the four months left in the fiscal year. Wendell Cho, your chief business official, says there are three places the money could realistically come from and none of them is painless. Board president Delia Okonjo has already called; the board meets in nine days and she wants to know what you will recommend. It is 8:15 in the morning and you have not seen a number yet.</p>",
          choices: [
            {
              id: "request_analysis",
              label: "Ask Cho for a written impact analysis of each option before you commit to anything",
              quality: "best",
              effects: [{ variableId: "board_confidence", delta: 8 }],
              feedback:
                "<p>Naming the analysis before the answer is what makes the answer defensible later. When the board asks what this costs us, you want Cho's numbers in the packet rather than your recollection of them.</p>",
              goTo: "scene:three_lines",
            },
            {
              id: "call_principals",
              label: "Tell Okonjo you will bring a recommendation, and start calling principals to hear what they would protect",
              quality: "acceptable",
              effects: [{ variableId: "board_confidence", delta: 2 }],
              feedback:
                "<p>Talking to principals surfaces things a spreadsheet will not, and you will need their buy-in either way. Without the impact analysis beside it, though, you are weighing strong opinions against each other with no shared set of numbers.</p>",
              goTo: "scene:three_lines",
            },
            {
              id: "commit_now",
              label: "Tell Okonjo you already know what has to go, and name it on the phone",
              quality: "poor",
              effects: [{ variableId: "board_confidence", delta: -10 }],
              feedback:
                "<p>Announcing the answer in the first hour feels decisive and costs you every option you have not examined yet. If Cho's analysis later contradicts you, the board has to choose between your credibility and the arithmetic.</p>",
              goTo: "scene:three_lines",
            },
          ],
        },
        {
          id: "three_lines",
          title: "Three lines",
          body:
            "<p>Cho's written analysis comes back in four days and it is honest about the trade-offs. Option one: freeze all non-instructional purchasing and defer the district's technology refresh — $1.9 million, reached without touching staffing, but the deferred replacement cost lands in next year's budget. Option two: hold the four currently vacant positions open through June and add a partial freeze — $1.9 million, though two of those vacancies are special education paraprofessional posts tied to services written into student plans. Option three: end the middle school after-school program in March and add a partial freeze — $1.9 million, and roughly two hundred students lose the only supervised place many of them have until six o'clock.</p>",
          choices: [
            {
              id: "defer_technology",
              label: "Freeze purchasing and defer the technology refresh",
              quality: "best",
              effects: [{ variableId: "board_confidence", delta: 10 }],
              feedback:
                "<p>Deferral protects instruction and student services this year and keeps the decision reversible. It is also a delay rather than a saving, and the board deserves to hear it named that way rather than discover it in July.</p>",
              goTo: "scene:the_board_packet",
            },
            {
              id: "hold_vacancies",
              label: "Hold vacancies, but fill the two paraprofessional posts and hold four others instead",
              quality: "acceptable",
              effects: [{ variableId: "board_confidence", delta: 4 }],
              feedback:
                "<p>Filling the paraprofessional posts respects services the district is obliged to deliver, and vacancy savings avoid layoffs entirely. It also thins supports elsewhere in ways families will start to feel by April, quietly, without anyone having announced a cut.</p>",
              goTo: "scene:the_board_packet",
            },
            {
              id: "cut_after_school",
              label: "End the after-school program; it is the cleanest single line",
              quality: "poor",
              effects: [{ variableId: "board_confidence", delta: -12 }],
              feedback:
                "<p>A single clean line is the easiest cut to execute and the hardest to defend, because it concentrates the entire reduction on the students with the fewest alternatives. If it is genuinely the right call, it has to be argued in public before it is made rather than after.</p>",
              goTo: "scene:the_parents_arrive",
            },
          ],
        },
        {
          id: "the_board_packet",
          title: "The board packet",
          body:
            "<p>Simone Alvarez has the draft board packet open and one question: how much of this goes in it. Your plan has a tail — deferred replacements or posts left unfilled — that lands in next year's budget at roughly $2.3 million, and nobody has budgeted for it. Board member Roy Vance has asked twice for the clean version, not the encyclopedia. The packet posts publicly at five o'clock tomorrow.</p>",
          choices: [
            {
              id: "publish_full_schedule",
              label: "Publish the full schedule, with the year each deferred cost comes due",
              quality: "best",
              effects: [{ variableId: "board_confidence", delta: 12 }],
              feedback:
                "<p>Publishing what the plan costs later is what separates a plan from an accounting maneuver. Boards forgive bad news they hear early; what they rarely forgive is the second version of a number.</p>",
              goTo: "ending:held_the_line",
            },
            {
              id: "brief_members_privately",
              label: "Publish the total, and brief board members individually on the detail",
              quality: "acceptable",
              effects: [{ variableId: "board_confidence", delta: 3 }],
              feedback:
                "<p>Briefing members individually keeps the board informed, which is the substance of the duty. A public total with no detail still leaves the tail there for someone else to find first, and describe first.</p>",
              goTo: "ending:held_the_line",
            },
            {
              id: "omit_the_tail",
              label: "Report the savings figure and leave the tail out of the packet",
              quality: "poor",
              effects: [{ variableId: "board_confidence", delta: -15 }],
              feedback:
                "<p>Leaving a known future cost out of the packet does not remove it from the budget; it removes the board's chance to weigh it. When it surfaces in next year's first draft, every other number you have presented gets read a second time.</p>",
              goTo: "ending:credibility_spent",
            },
          ],
        },
        {
          id: "the_parents_arrive",
          title: "The room fills up",
          body:
            "<p>By six-forty on board night there are sixty people in a room built for forty, most of them families from the middle school. A parent named Iris Ochoa tells the board that the after-school program is the only supervised place her seventh grader has between the last bell and the end of her shift. Delia Okonjo lets public comment run twenty minutes past its limit, then turns to you. The district's own livestream is running.</p>",
          choices: [
            {
              id: "name_the_harm",
              label: "Name the harm plainly, and commit to a date when you will report back on restoring it",
              quality: "best",
              effects: [{ variableId: "board_confidence", delta: 10 }],
              feedback:
                "<p>Naming the harm without promising a rescue you cannot deliver is the only version of this answer that survives contact with June. A date to report back is a commitment you can actually keep, which is what makes it worth making.</p>",
              goTo: "ending:held_the_line",
            },
            {
              id: "explain_arithmetic",
              label: "Walk the room through the arithmetic that led here, and offer to meet the parent group next week",
              quality: "acceptable",
              effects: [{ variableId: "board_confidence", delta: 2 }],
              feedback:
                "<p>The arithmetic is real and these families are entitled to see it. Led with, though, it answers a question about a child with a paragraph about a fund balance, and everyone in the room hears the difference.</p>",
              goTo: "ending:credibility_spent",
            },
            {
              id: "decision_is_final",
              label: "Say the decision is final and move to the next agenda item",
              quality: "poor",
              effects: [{ variableId: "board_confidence", delta: -18 }],
              feedback:
                "<p>Closing the item ends the meeting, not the conversation. A public body that declines to answer in the room gets answered elsewhere, by people working with less information than you have.</p>",
              goTo: "ending:credibility_spent",
            },
          ],
        },
      ],
      startSceneId: "the_memo",
      endings: [
        {
          id: "held_the_line",
          title: "Credibility intact",
          body:
            "<p>The reduction is adopted 5 to 0, and the part that matters comes afterward. When Cho brings the first draft of next year's budget in April, nobody on the board is surprised by what is in it. Roy Vance still thinks you cut in the wrong place; he says so on the record, and then he votes for the plan, because he can see the whole plan.</p><p>Sierra Vista absorbed $1.9 million and spent very little of the thing that is hardest to rebuild: the board's assumption that when you present a number, it is the whole number. That assumption is the asset you will need at the community meeting in April, and again the following winter, when something much worse than a budget revision arrives on a Saturday morning.</p>",
        },
        {
          id: "credibility_spent",
          title: "The cut lands, the credibility does not",
          body:
            "<p>The reduction is adopted 3 to 2. Within a month the part you left out has been found — in a budget draft, in a records request, in a parent's spreadsheet — and it is now the story, in place of the reasoning that led you to it. Nothing you did was unlawful and nothing you said was untrue. What is gone is the assumption that a number from your office is a complete number.</p><p>You will do this arithmetic again in April, at a community meeting, in front of people who now check it. Every district makes a decision like this one; the ones that survive it are the ones that told the whole thing the first time.</p>",
        },
      ],
      feedbackMode: "debrief",
      showPathInDebrief: true,
    }),
  },
  "community-meeting": {
    label: "The Community Meeting",
    description: "Two variables in tension with a conditional choice.",
    group: "exemplar",
    config: branchingConfigSchema.parse({
      title: "",
      role: "You are the superintendent of Sierra Vista Unified. The mid-year reduction you made in February is three weeks old and the questions have not stopped.",
      intro:
        "<p>In February, Sierra Vista Unified absorbed a $1.9 million mid-year reduction. Three weeks later the questions have not stopped, and before the board can adopt the revised spending plan the state requires a properly noticed public hearing. You are the superintendent, and you have nine days.</p><p>By the end of this scenario you will be able to design and run a public meeting that satisfies its legal requirements and is genuinely worth attending, and to explain why meeting the requirement is the floor of community engagement rather than the goal. Two things are tracked: <b>Community trust</b> and <b>District compliance</b>. They are not the same thing, and one of the choices later on will only be open to you if the first one is high enough.</p>",
      variables: [
        { id: "community_trust", label: "Community trust", initial: 50, min: 0, max: 100, visible: true },
        { id: "district_compliance", label: "District compliance", initial: 70, min: 0, max: 100, visible: true },
      ],
      scenes: [
        {
          id: "the_ask",
          title: "Nine days",
          body:
            "<p>Delia Okonjo wants a community meeting before the board adopts the revised spending plan, which state law says cannot happen without a properly noticed public hearing, materials posted seventy-two hours ahead, and interpretation available on request. Tom Brackett has asked that teachers be able to speak without signing up through their principals. You have nine days, one communications director, and a district where about a third of families speak Spanish at home.</p>",
          choices: [
            {
              id: "one_meeting_both",
              label: "Hold one meeting that satisfies the hearing requirements and is built for listening, and say in the notice that it is both",
              quality: "best",
              effects: [
                { variableId: "community_trust", delta: 6 },
                { variableId: "district_compliance", delta: 6 },
              ],
              feedback:
                "<p>Merging the legal hearing and the community conversation works only if you tell people that is what you are doing. Said out loud in the notice, the requirement reads as a floor you are building on rather than a substitute for the conversation.</p>",
              goTo: "scene:the_notice",
            },
            {
              id: "two_events",
              label: "Run the legal hearing at the board meeting and a separate informal community night the week before",
              quality: "acceptable",
              effects: [
                { variableId: "community_trust", delta: 4 },
                { variableId: "district_compliance", delta: 3 },
              ],
              feedback:
                "<p>Two events give the informal conversation room to breathe, and they double what one communications director has to staff. They also risk families attending the night that has no legal standing, so nothing they say enters the record.</p>",
              goTo: "scene:the_notice",
            },
            {
              id: "hearing_only",
              label: "Do what the law requires: notice the hearing, take public comment, adopt the plan",
              quality: "poor",
              effects: [
                { variableId: "community_trust", delta: -10 },
                { variableId: "district_compliance", delta: 5 },
              ],
              feedback:
                "<p>Meeting the requirement is not the same as answering the question, and a district that answers only what it must teaches families to ask somewhere else. Notice how compliance went up here while trust went down: that is the whole shape of this scenario.</p>",
              goTo: "scene:the_notice",
            },
          ],
        },
        {
          id: "the_notice",
          title: "What the notice actually does",
          body:
            "<p>Simone Alvarez drafts the notice on Monday. The requirement is seventy-two hours with materials posted; the practical question is whether a family working two jobs can act on a notice that goes out Friday afternoon for a Tuesday meeting. Interpretation is available on request, which in practice means available to people who know to request it. The translated packet is running four days behind the English one.</p>",
          choices: [
            {
              id: "ten_days_translated",
              label: "Notice ten days out, post both language versions together, and staff interpretation by default",
              quality: "best",
              effects: [
                { variableId: "community_trust", delta: 8 },
                { variableId: "district_compliance", delta: 8 },
              ],
              feedback:
                "<p>Going past the required notice period is not generosity; it is the difference between a meeting families can attend and a meeting families were technically told about. Interpretation by default removes a request nobody should have to make in the first place.</p>",
              goTo: "scene:the_agenda",
            },
            {
              id: "minimum_plus_outreach",
              label: "Post at the seventy-two hour mark, then push the meeting through newsletters, the parent text system, and Brackett's members",
              quality: "acceptable",
              effects: [
                { variableId: "community_trust", delta: 5 },
                { variableId: "district_compliance", delta: 5 },
              ],
              feedback:
                "<p>Amplification does real work and it reaches the families already connected to a school. The families the newsletter never reaches are exactly the ones a longer notice window was there to protect.</p>",
              goTo: "scene:the_agenda",
            },
            {
              id: "friday_minimum",
              label: "Post Friday at the mark and let Alvarez handle the rest; you have next year's budget to rebuild",
              quality: "poor",
              effects: [
                { variableId: "community_trust", delta: -8 },
                { variableId: "district_compliance", delta: -5 },
              ],
              feedback:
                "<p>A Friday notice for a Tuesday meeting is compliant the way an unlit exit sign is a sign. The translated packet also still is not posted, which is the difference between an engagement problem and a hearing somebody can challenge.</p>",
              goTo: "scene:the_room",
            },
          ],
        },
        {
          id: "the_agenda",
          title: "Designing the room",
          body:
            "<p>You have the room for two hours. Alvarez has built a forty-minute slide deck explaining the state revenue revision, the three options Cho analyzed, and why the board chose what it chose. Brackett says his members will not sit through forty minutes of slides. The middle-school parent group has asked whether anyone is going to answer questions or just present.</p>",
          choices: [
            {
              id: "ten_minutes_then_tables",
              label: "Cut the presentation to ten minutes, break to facilitated tables with staff at each, and hold the last half hour for questions on the record",
              quality: "best",
              effects: [
                { variableId: "community_trust", delta: 8 },
                { variableId: "district_compliance", delta: 2 },
              ],
              feedback:
                "<p>A meeting is a listening instrument or it is a broadcast. Ten minutes of context and ninety of structured listening still puts every fact from the deck on the record and in the handout, where people can read it at their own speed.</p>",
              goTo: "scene:the_room",
            },
            {
              id: "twenty_and_qa",
              label: "Trim the deck to twenty minutes and run open question-and-answer for the rest",
              quality: "acceptable",
              effects: [
                { variableId: "community_trust", delta: 5 },
                { variableId: "district_compliance", delta: 2 },
              ],
              feedback:
                "<p>Open question-and-answer is honest, and it rewards whoever is loudest and most practiced with a microphone. The families most affected by the cut are frequently not those people.</p>",
              goTo: "scene:the_room",
            },
            {
              id: "full_deck",
              label: "Present the whole deck. If people understand the arithmetic, the anger takes care of itself",
              quality: "poor",
              effects: [{ variableId: "community_trust", delta: -12 }],
              feedback:
                "<p>People rarely arrive angry because they misunderstood the arithmetic. They arrive because something was taken and nobody asked them first, and forty minutes of slides answers a question nobody in the room is asking.</p>",
              goTo: "scene:the_room",
            },
          ],
        },
        {
          id: "the_room",
          title: "Meeting night",
          body:
            "<p>A hundred and forty people, more than the room has chairs for, plus three board members and a reporter from the county weekly. Before you begin, a group from the middle school asks to read a petition with four hundred signatures into the record, which is not on the agenda you posted. Okonjo looks at you; amending the agenda at the top of the meeting is yours to do. Whatever happens next, the room will read it as the answer to whether this meeting is real.</p>",
          choices: [
            {
              id: "accept_petition",
              label: "Amend the agenda to accept the petition into the record, and say aloud why the amendment is being made",
              quality: "best",
              effects: [
                { variableId: "community_trust", delta: 8 },
                { variableId: "district_compliance", delta: 4 },
              ],
              feedback:
                "<p>Taking the petition on the record costs six minutes and settles the only question the room had about your intentions. Announcing the amendment aloud is the part that keeps it procedurally clean.</p>",
              goTo: "scene:the_hard_question",
            },
            {
              id: "petition_in_comment",
              label: "Ask them to read it during the public comment period already on the agenda",
              quality: "acceptable",
              effects: [
                { variableId: "community_trust", delta: 3 },
                { variableId: "district_compliance", delta: 5 },
              ],
              feedback:
                "<p>Public comment is the right procedural home for it, and the wait reads as a delay to people who have been waiting since February. Nothing is lost from the record; some goodwill is.</p>",
              goTo: "scene:the_hard_question",
            },
            {
              id: "decline_not_on_agenda",
              label: "Decline; the agenda was posted, and changing it now is how hearings get challenged",
              quality: "poor",
              effects: [
                { variableId: "community_trust", delta: -14 },
                { variableId: "district_compliance", delta: 2 },
              ],
              feedback:
                "<p>The instinct to protect the record is right and applied backwards here. Accepting a written submission does not create a notice defect, and refusing one in front of a hundred and forty people puts everything else at risk instead.</p>",
              goTo: "scene:the_follow_through",
            },
          ],
        },
        {
          id: "the_hard_question",
          title: "The question you cannot answer",
          body:
            "<p>Ninety minutes in, at one of the tables, a father named Andre Whitfield asks what the room actually came for: is the after-school program coming back in the fall. Cho's honest answer is that it depends on a state budget nobody will sign until late June. Yours has to be given now, out loud, to a man whose son is currently walking home to an empty apartment.</p>",
          choices: [
            {
              id: "uncertainty_with_date",
              label: "Say you do not know, explain exactly what the answer depends on, and commit to reporting back publicly on July 15 either way",
              quality: "best",
              effects: [
                { variableId: "community_trust", delta: 8 },
                { variableId: "district_compliance", delta: 2 },
              ],
              feedback:
                "<p>I do not know, here is what it depends on, here is when you will hear from me is a complete answer. It is also the only one you can still be standing behind in August.</p>",
              goTo: "scene:the_follow_through",
            },
            {
              id: "working_group",
              label: "Accept Whitfield's offer to co-chair a family working group that reviews restoration options with Cho before the June budget",
              quality: "best",
              showIf: { variableId: "community_trust", comparator: "gte", value: 60 },
              effects: [
                { variableId: "community_trust", delta: 10 },
                { variableId: "district_compliance", delta: 4 },
              ],
              feedback:
                "<p>A working group is credible only if the families in it believe the district will use what they produce, which is why this option is open to you tonight and would not have been three weeks ago. Shared authorship changes what the conversation in the fall is about.</p>",
              goTo: "scene:the_follow_through",
            },
            {
              id: "reassure",
              label: "Tell him you will fight to bring it back; the room needs to hear that somebody is on their side",
              quality: "poor",
              effects: [{ variableId: "community_trust", delta: -8 }],
              feedback:
                "<p>A promise made to a room is remembered one family at a time. If June does not cooperate, the person who pays for tonight's applause is the father who told his son it was coming back.</p>",
              goTo: "scene:the_follow_through",
            },
          ],
        },
        {
          id: "the_follow_through",
          title: "Forty-eight hours later",
          body:
            "<p>The room empties by nine-forty. Alvarez has eleven pages of table notes, the petition, and forty-two comment cards; the reporter's questions are in your inbox; and the board adopts the revised plan in six days. What happens in the next forty-eight hours decides whether that meeting was a hearing or a performance.</p>",
          choices: [
            {
              id: "publish_the_record",
              label: "Publish the table notes, the petition, and written answers to every question you could not answer in the room, in both languages, before the board votes",
              quality: "best",
              effects: [
                { variableId: "community_trust", delta: 8 },
                { variableId: "district_compliance", delta: 6 },
              ],
              feedback:
                "<p>The record is the deliverable. Publishing what people said, in their own words, before the vote rather than after it, is what turns a hearing into evidence the board actually used.</p>",
              goTo: "ending:partnership",
            },
            {
              id: "summary_to_board",
              label: "Give the board a written summary of the themes at the vote and post it afterward",
              quality: "acceptable",
              effects: [
                { variableId: "community_trust", delta: 5 },
                { variableId: "district_compliance", delta: 5 },
              ],
              feedback:
                "<p>A themes summary is real information, and it is your account of what people said rather than theirs, arriving with no time for anyone to correct it. Posted afterward, the record becomes a receipt instead of an input.</p>",
              goTo: "ending:compliant_but_cold",
            },
            {
              id: "move_on",
              label: "The meeting is done and the vote is Tuesday; get back to next year's budget",
              quality: "poor",
              effects: [
                { variableId: "community_trust", delta: -16 },
                { variableId: "district_compliance", delta: -12 },
              ],
              feedback:
                "<p>An unpublished record is indistinguishable from no record, including to whoever later asks whether the hearing met its requirements. The meeting cost a hundred and forty people their evening; the write-up costs you four hours.</p>",
              goTo: "ending:procedurally_exposed",
            },
          ],
        },
      ],
      startSceneId: "the_ask",
      endings: [
        {
          id: "partnership",
          title: "A district families argue with, not about",
          body:
            "<p>The board adopts the revised plan with the table notes attached to the packet, and Priya Raman quotes two of them from the dais. The restoration working group meets for the first time in May with Cho's spreadsheets open on the table, and when the state budget lands in late June the answer it produces is not the one anyone wanted, but it is the group's answer as much as yours. Andre Whitfield reads the July 15 update at the board meeting himself.</p><p>What Sierra Vista has now is not agreement. Roy Vance still votes his way and the middle-school families still want their program back. What it has is a district families argue with rather than argue about, and the difference will matter more than anyone expects the following winter, when the district needs people to believe a very difficult account of something on very little evidence.</p>",
        },
        {
          id: "compliant_but_cold",
          title: "Every box checked",
          body:
            "<p>The hearing was properly noticed, comment was taken, the summary reached the board before the vote, and the plan was adopted. If anyone audits this process they will find nothing wrong with it, and that is an accurate description of what you built: a process with nothing wrong with it.</p><p>Attendance at the next community meeting is thirty-one people. The families who came in April concluded that coming did not change anything, and they were not entirely wrong — the record they created reached the board as your summary of it. Compliance is a floor. You are standing on it.</p>",
        },
        {
          id: "procedurally_exposed",
          title: "The hearing you may have to hold again",
          body:
            "<p>The board adopts the plan on Tuesday. In the third week of May a complaint arrives asking whether the hearing met its notice and language-access requirements, and the honest answer is that the district cannot fully demonstrate that it did, because nobody wrote down what happened. Counsel's advice is to re-notice and hold the hearing again, which is four more weeks and a second evening of a hundred and forty people's time.</p><p>The meeting itself was not the failure. What failed was everything after it: the record that was never published, the questions never answered, the forty-two cards in a folder in Alvarez's office. A hearing that leaves no trace is, to everyone outside the room, a hearing that may as well not have happened.</p>",
        },
      ],
      feedbackMode: "debrief",
      showPathInDebrief: true,
    }),
  },
  crisis: {
    label: "The Crisis",
    description: "Full complexity: three variables, conditional paths, ranked endings.",
    group: "exemplar",
    config: branchingConfigSchema.parse({
      title: "",
      role: "You are the superintendent of Sierra Vista Unified. It is 5:40 on a Saturday morning in January and your director of operations is calling.",
      intro:
        "<p>Last winter Sierra Vista Unified absorbed a mid-year reduction and deferred its technology refresh, including the endpoint maintenance line. In April it held a community meeting about that reduction. This is the following January, and at 5:40 on a Saturday morning the district's systems stop responding.</p><p>By the end of this scenario you will be able to lead a district through a security incident that has no good options: sequencing containment against continuity, communicating before the facts are complete, meeting a notification duty on its own clock rather than yours, and giving an after-action account that includes your own earlier decisions. Three things are tracked: <b>Community trust</b>, <b>Instructional continuity</b>, and <b>Regulatory standing</b>. Some of the choices ahead will only be available to you if the right one of those is high enough when you get there.</p>",
      variables: [
        { id: "community_trust", label: "Community trust", initial: 55, min: 0, max: 100, visible: true },
        { id: "instructional_continuity", label: "Instructional continuity", initial: 80, min: 0, max: 100, visible: true },
        { id: "regulatory_standing", label: "Regulatory standing", initial: 70, min: 0, max: 100, visible: true },
      ],
      scenes: [
        {
          id: "the_saturday_call",
          title: "5:40 a.m., Saturday",
          body:
            "<p>Ray Delgado calls at 5:40 on Saturday morning. Overnight the student information system stopped responding, the building-access controllers are offline, and a message on the district's file server says the data has been encrypted and gives an address to contact. Nobody knows yet what was taken, how long the intruder was inside, or whether the backups are intact — including, Delgado notes, the ones covered by the maintenance line the district deferred last February. You are the only person with the authority to shut anything down.</p>",
          choices: [
            {
              id: "isolate_and_convene",
              label: "Isolate the affected systems now, then call the county office, the district's cyber insurer, and counsel before anything else is touched",
              quality: "best",
              effects: [
                { variableId: "instructional_continuity", delta: -8 },
                { variableId: "regulatory_standing", delta: 6 },
                { variableId: "community_trust", delta: 2 },
              ],
              feedback:
                "<p>Isolation buys the one thing you cannot get back later: an intact record of what happened. Counsel and the insurer both have roles that begin in the first hour rather than the first press call, and the call you make now is what determines which options exist on Wednesday.</p>",
              goTo: "scene:the_first_hour",
            },
            {
              id: "restore_first",
              label: "Have Delgado start restoring from whatever backups exist so Monday still works, and call counsel once you know what this is",
              quality: "acceptable",
              effects: [
                { variableId: "instructional_continuity", delta: 5 },
                { variableId: "regulatory_standing", delta: -8 },
              ],
              feedback:
                "<p>The instinct to get schools running is right, and restoring before the systems are isolated can overwrite the evidence that decides what you must report and to whom. Continuity and containment genuinely compete here; the order matters more than the speed.</p>",
              goTo: "scene:the_first_hour",
            },
            {
              id: "wait_for_monday",
              label: "It is Saturday. Keep it quiet until the IT vendor can look at it Monday",
              quality: "poor",
              effects: [
                { variableId: "instructional_continuity", delta: -5 },
                { variableId: "regulatory_standing", delta: -18 },
                { variableId: "community_trust", delta: -10 },
              ],
              feedback:
                "<p>Every hour an intrusion runs unexamined is an hour of further access, and a delay that begins as caution is read afterward as concealment. Notification clocks generally run from discovery, not from when it became convenient to look.</p>",
              goTo: "scene:the_first_hour",
            },
          ],
        },
        {
          id: "the_first_hour",
          title: "Who is in the room",
          body:
            "<p>By seven you have counsel on the phone, the insurer's incident line open, and Delgado in the server room. Counsel asks a question you cannot answer: does the district have a written incident response plan naming who decides, who speaks, and who notifies. Delia Okonjo is calling. Roy Vance has texted twice, and one of the texts asks what you are going to tell the press.</p>",
          choices: [
            {
              id: "incident_command",
              label: "Stand up one incident command — you decide, counsel advises, Alvarez speaks, Delgado runs technical — and brief Okonjo hourly",
              quality: "best",
              effects: [
                { variableId: "regulatory_standing", delta: 4 },
                { variableId: "instructional_continuity", delta: 2 },
                { variableId: "community_trust", delta: 4 },
              ],
              feedback:
                "<p>Incident command is not bureaucracy; it is the mechanism that stops six people giving five versions of the same facts. Hourly briefings to your board president keep governance informed without moving the decision out of the room where the facts are.</p>",
              goTo: "scene:monday_morning",
            },
            {
              id: "small_circle",
              label: "Keep the circle small — you, Delgado, counsel — and update the full board Monday",
              quality: "acceptable",
              effects: [
                { variableId: "instructional_continuity", delta: 2 },
                { variableId: "community_trust", delta: -5 },
              ],
              feedback:
                "<p>A small circle moves fast, and it means every question in the district lands on the three most overloaded people in it. By Monday your board will have learned about this from somebody who is not you.</p>",
              goTo: "scene:monday_morning",
            },
            {
              id: "everyone_decides",
              label: "Put every cabinet member and both board officers on a running call so nobody feels shut out",
              quality: "poor",
              effects: [
                { variableId: "regulatory_standing", delta: -10 },
                { variableId: "instructional_continuity", delta: -5 },
                { variableId: "community_trust", delta: -5 },
              ],
              feedback:
                "<p>Inclusion is not coordination. A twelve-person call with no decision-maker produces twelve partial accounts, and one of them reaches a parent group before the facts are stable enough to correct.</p>",
              goTo: "scene:monday_morning",
            },
          ],
        },
        {
          id: "monday_morning",
          title: "Thirty-six hours to Monday",
          body:
            "<p>School opens in thirty-six hours. Without the student information system there is no attendance, no gradebook, no medication list at the health office, and no service log for the roughly six hundred students whose plans entitle them to specific minutes of support. Elena Duarte says the high school can run attendance on paper. Marcus Bell says his office cannot verify who is allowed to pick up a kindergartner. Delgado's estimate for partial restoration is four to nine days.</p>",
          choices: [
            {
              id: "paper_protocols",
              label: "Open on time with published paper protocols for attendance, medication and pickup verification, and a written service-log plan for students whose plans require one",
              quality: "best",
              effects: [
                { variableId: "instructional_continuity", delta: 8 },
                { variableId: "regulatory_standing", delta: 2 },
                { variableId: "community_trust", delta: 4 },
              ],
              feedback:
                "<p>Continuity is a set of specific written workarounds, not a decision to be brave. Putting the service-log plan in writing is also what later lets the district show that entitled minutes were delivered rather than merely intended.</p>",
              goTo: "scene:what_to_say",
            },
            {
              id: "delay_two_days",
              label: "Close Monday and Tuesday as emergency days, restore what you can, reopen Wednesday",
              quality: "acceptable",
              effects: [
                { variableId: "instructional_continuity", delta: -8 },
                { variableId: "regulatory_standing", delta: 2 },
                { variableId: "community_trust", delta: -2 },
              ],
              feedback:
                "<p>Two days buys real technical room, and it costs six thousand students two days of instruction and several thousand families two days of childcare they had not planned. It is a defensible call. It is not a free one.</p>",
              goTo: "scene:what_to_say",
            },
            {
              id: "open_and_improvise",
              label: "Open on time and tell principals to improvise; they know their families",
              quality: "poor",
              effects: [
                { variableId: "instructional_continuity", delta: -14 },
                { variableId: "regulatory_standing", delta: -12 },
                { variableId: "community_trust", delta: -8 },
              ],
              feedback:
                "<p>Principals will improvise regardless; the question is whether they improvise from a common protocol or invent forty of them. Medication and custody release are the two places where a good-faith improvisation becomes a child in the wrong car.</p>",
              goTo: "scene:what_to_say",
            },
          ],
        },
        {
          id: "what_to_say",
          title: "The first message",
          body:
            "<p>Alvarez needs a first message by Sunday noon; a screenshot of the ransom note is already circulating in a parents' group chat. Counsel's advice is that anything you say about what was taken could be wrong within a day. What you know is narrow: systems are down, an investigation is under way, and here is what Monday looks like. What families are asking is whether their children's records are in somebody else's hands.</p>",
          choices: [
            {
              id: "say_what_you_know",
              label: "Publish now: what happened, what you do not yet know, what Monday looks like, and when the next update comes — then keep that schedule whether or not there is news",
              quality: "best",
              effects: [
                { variableId: "community_trust", delta: 10 },
                { variableId: "regulatory_standing", delta: 2 },
              ],
              feedback:
                "<p>A stated update rhythm is the most valuable thing you can offer while the facts are thin, because it converts an information vacuum into a wait people can tolerate. Publishing your uncertainties is also what makes tomorrow's corrections survivable.</p>",
              goTo: "scene:the_demand",
            },
            {
              id: "brief_staff_first",
              label: "Brief principals and staff Sunday so they can answer families Monday, and hold the public statement until you know more",
              quality: "acceptable",
              effects: [
                { variableId: "community_trust", delta: -4 },
                { variableId: "regulatory_standing", delta: 2 },
                { variableId: "instructional_continuity", delta: 4 },
              ],
              feedback:
                "<p>Staff who can answer questions are worth a great deal, and a message given to four hundred employees is a public message with extra steps and no timestamp. The screenshot in the group chat is not going to wait for your confidence to catch up.</p>",
              goTo: "scene:the_demand",
            },
            {
              id: "say_nothing_yet",
              label: "Say nothing until the forensic picture is clear; a wrong statement now is worse than silence",
              quality: "poor",
              effects: [
                { variableId: "community_trust", delta: -14 },
                { variableId: "regulatory_standing", delta: -4 },
              ],
              feedback:
                "<p>Silence is not neutral. It says the district either does not know or will not say, and both readings are worse than here is what we know so far. The correction you are afraid of is far cheaper than the vacuum you are creating.</p>",
              goTo: "scene:the_notification",
            },
          ],
        },
        {
          id: "the_demand",
          title: "The demand",
          body:
            "<p>The intruders want payment, and promise both a decryption key and the deletion of everything they copied. The insurer says the decision is yours and coverage does not turn on it. Delgado's backups turn out to be nine days stale for the student information system, which is precisely what the deferred maintenance line was going to fix. Paying might shorten the outage by a week. It would also fund the next district's incident, and the promise to delete stolen data is unverifiable by definition.</p>",
          choices: [
            {
              id: "decline_and_rebuild",
              label: "Decline the payment, rebuild from the backups that exist, and tell the board why in writing, with the nine-day gap named",
              quality: "best",
              effects: [
                { variableId: "regulatory_standing", delta: 4 },
                { variableId: "community_trust", delta: 4 },
                { variableId: "instructional_continuity", delta: -4 },
              ],
              feedback:
                "<p>The unverifiable half of the offer is the whole offer: nobody can confirm that copied data was deleted. Naming the backup gap yourself, in the same memo, is what keeps it from being discovered later as a second story.</p>",
              goTo: "scene:the_notification",
            },
            {
              id: "public_stance",
              label: "Say publicly that Sierra Vista will not pay, publish the restoration timeline, and ask families for patience by a specific date",
              quality: "best",
              showIf: { variableId: "community_trust", comparator: "gte", value: 60 },
              effects: [
                { variableId: "regulatory_standing", delta: 3 },
                { variableId: "community_trust", delta: 10 },
                { variableId: "instructional_continuity", delta: -4 },
              ],
              feedback:
                "<p>A public refusal is a commitment you can only make if people will wait through the outage it buys, which is a trust question rather than a technical one — and it is why this option is open to you now and would not have been in a district that had spent its credibility. Publishing the timeline is what makes the ask concrete instead of a slogan.</p>",
              goTo: "scene:the_notification",
            },
            {
              id: "pay_quietly",
              label: "Authorize payment through the insurer's negotiator and keep it out of the public account; Monday matters more than principle",
              quality: "poor",
              effects: [
                { variableId: "regulatory_standing", delta: -16 },
                { variableId: "community_trust", delta: -12 },
                { variableId: "instructional_continuity", delta: 8 },
              ],
              feedback:
                "<p>Payment might shorten the outage and it cannot buy the data back, because the only evidence of deletion is the word of the people who took it. Keeping a material expenditure out of the public account is a second decision, and a much harder one to defend than the payment itself.</p>",
              goTo: "scene:the_notification",
            },
          ],
        },
        {
          id: "the_notification",
          title: "What was taken",
          body:
            "<p>On Wednesday the forensic firm confirms what everyone feared: files were copied out before the encryption, including a directory of names, dates of birth, home addresses and service plans for students going back six years. Counsel says the notification clock runs from the determination that records were acquired, and that the determination is now. Roy Vance argues for waiting until the firm can say precisely which students are affected — we should tell families something useful, he says, not something frightening.</p>",
          choices: [
            {
              id: "notify_now",
              label: "Notify now: tell every family in the affected years what is known, what is not, and what the district is doing, and follow with specifics as the firm confirms them",
              quality: "best",
              effects: [
                { variableId: "regulatory_standing", delta: 5 },
                { variableId: "community_trust", delta: 6 },
              ],
              feedback:
                "<p>Waiting for a perfect list means families learn this from somebody else first, and the duty does not pause for precision. Two notices, one prompt and honest and one specific, beat a single late and complete one.</p>",
              goTo: "scene:staff_and_families",
            },
            {
              id: "joint_notice",
              label: "Send the notice counsel drafted on Saturday, jointly with the state education agency and the county office, with a family help line live the same hour",
              quality: "best",
              showIf: { variableId: "regulatory_standing", comparator: "gte", value: 80 },
              effects: [
                { variableId: "regulatory_standing", delta: 6 },
                { variableId: "community_trust", delta: 8 },
                { variableId: "instructional_continuity", delta: 2 },
              ],
              feedback:
                "<p>The reason this option exists on Wednesday is that counsel was in the room on Saturday morning: the notice was drafted before anyone needed it. Issuing jointly with the agencies also means families get one consistent account instead of three competing ones.</p>",
              goTo: "scene:staff_and_families",
            },
            {
              id: "wait_for_the_list",
              label: "Take Vance's position and wait for the confirmed list so the notice can be accurate",
              quality: "poor",
              effects: [
                { variableId: "regulatory_standing", delta: -18 },
                { variableId: "community_trust", delta: -10 },
              ],
              feedback:
                "<p>The argument for waiting is sincere, and it converts a disclosure obligation into a discretionary judgment the district does not get to make. Every day of waiting is a day families could have been protecting their children's records and were not told to.</p>",
              goTo: "scene:staff_and_families",
            },
          ],
        },
        {
          id: "staff_and_families",
          title: "The people doing the work",
          body:
            "<p>Teachers have spent six days reconstructing eleven weeks of grades from paper and memory. Tom Brackett puts it plainly: his members will do it, and they want to know whether it is being counted as work or expected as goodwill. Meanwhile Alvarez's help line is taking two hundred calls a day with three people answering.</p>",
          choices: [
            {
              id: "pay_and_staff",
              label: "Compensate the reconstruction work at the contractual rate, and pull substitutes and central office staff onto the help line",
              quality: "best",
              effects: [
                { variableId: "instructional_continuity", delta: 8 },
                { variableId: "community_trust", delta: 6 },
              ],
              feedback:
                "<p>Recovery is labor, and labor performed in a crisis is still labor. Paying for it is the contractual answer and the reason those people will still be standing when the next thing happens.</p>",
              goTo: "scene:the_after_action",
            },
            {
              id: "working_group_line",
              label: "Ask the family working group from April to run a parent-to-parent help line beside the district's, with a liaison and a shared script",
              quality: "best",
              showIf: { variableId: "community_trust", comparator: "gte", value: 60 },
              effects: [
                { variableId: "instructional_continuity", delta: 6 },
                { variableId: "community_trust", delta: 12 },
              ],
              feedback:
                "<p>Families answering families is faster and warmer than any phone tree you could build in a week, and it is possible only because the working group already existed and already trusted the district's numbers. The shared script is what keeps it accurate.</p>",
              goTo: "scene:the_after_action",
            },
            {
              id: "ask_for_goodwill",
              label: "Thank staff publicly and ask them to absorb the work; the budget is already carrying an incident",
              quality: "poor",
              effects: [
                { variableId: "instructional_continuity", delta: -10 },
                { variableId: "community_trust", delta: -12 },
              ],
              feedback:
                "<p>Gratitude is not compensation. Asking people to donate labor after a decision they had no part in is how a technical incident becomes a labor dispute, and the budget argument is a reason to go to the board rather than to the staff.</p>",
              goTo: "ending:trust_deficit",
            },
          ],
        },
        {
          id: "the_after_action",
          title: "After-action",
          body:
            "<p>Six weeks later the systems are back, the notification is complete, and the board has scheduled an after-action review in open session. Cho's estimate is $1.4 million between recovery, credit monitoring for families, and the endpoint renewal that was deferred last February. Every decision you made sits on a timeline in the board packet, including the ones made at 5:40 on a Saturday morning.</p>",
          choices: [
            {
              id: "own_the_deferral",
              label: "Present the full timeline, name the February deferral as a contributing decision that was yours, and bring the multi-year replacement plan",
              quality: "best",
              effects: [
                { variableId: "community_trust", delta: 8 },
                { variableId: "regulatory_standing", delta: 5 },
                { variableId: "instructional_continuity", delta: 4 },
              ],
              feedback:
                "<p>An after-action review is worth exactly as much as its least comfortable sentence. Naming your own earlier decision as a contributing cause is what converts an incident into a budget the board will actually fund.</p>",
              goTo: "ending:stewardship",
            },
            {
              id: "technical_findings_only",
              label: "Present the technical timeline and the vendor's recommendations; the budget history is a separate conversation",
              quality: "acceptable",
              effects: [
                { variableId: "community_trust", delta: 2 },
                { variableId: "regulatory_standing", delta: 2 },
              ],
              feedback:
                "<p>The technical findings are accurate and incomplete. An intrusion that succeeded partly because of a deferred renewal is not only a technical event, and the separate conversation you are promising tends never to happen.</p>",
              goTo: "ending:contained_but_costly",
            },
            {
              id: "blame_the_vendor",
              label: "Frame the review around the vendor's failure and the sophistication of the attack",
              quality: "poor",
              effects: [
                { variableId: "community_trust", delta: -16 },
                { variableId: "regulatory_standing", delta: -12 },
              ],
              feedback:
                "<p>Attributing an incident entirely outward ends the inquiry before it reaches anything the district could change. It also does not survive a records request, because last February's board packet is a public document.</p>",
              goTo: "ending:regulatory_reckoning",
            },
          ],
        },
      ],
      startSceneId: "the_saturday_call",
      endings: [
        {
          id: "stewardship",
          title: "The account that holds",
          body:
            "<p>The board adopts a four-year replacement plan at the same meeting, 5 to 0, and Roy Vance is the one who moves it. The state agency's review closes with findings on the district's controls and none on its conduct: notification was timely, the record is complete, and the account the district gave of itself on day two matches the account the forensic firm gave on day forty. Andre Whitfield's volunteers answered eleven hundred family calls.</p><p>None of this made the incident less expensive. Six thousand students lost instructional time, six years of records are in somebody else's hands, and $1.4 million that was going to do something else is gone. What Sierra Vista has instead is the only asset that survives an event like this one: a district whose account of itself can be checked. That is what you spent three years building, one decision at a time, starting with a $1.9 million problem on a Tuesday in February.</p>",
        },
        {
          id: "contained_but_costly",
          title: "Recovered, not learned",
          body:
            "<p>Systems are restored, the notification went out, and the after-action review is filed with the vendor's recommendations attached. Nobody was misled and nothing was concealed. The review simply stopped where the technology stopped, and so the replacement plan goes to the board as a line item in the spring rather than as the answer to a question the board is still asking.</p><p>The plan is funded at about half. Two winters from now, the part that was not funded will be the part that matters — which is roughly what happened to the maintenance line last February, and is the reason an after-action review that avoids the budget is an incomplete one.</p>",
        },
        {
          id: "trust_deficit",
          title: "Technically recovered",
          body:
            "<p>The systems come back. Two hundred and forty teachers reconstruct eleven weeks of grades on their own time, the association files a grievance in March, and the fall bargaining opens with an article on emergency duties that will take eleven months to settle. Family calls go unanswered for days because three people cannot answer two hundred calls, and the help line's voicemail box is full for most of a week.</p><p>Every technical objective was met. The district recovered its data and lost something it will need next time: the assumption, among the people who actually delivered the recovery, that the district notices what it is asking of them. A crisis is a withdrawal from an account somebody has to have funded first.</p>",
        },
        {
          id: "regulatory_reckoning",
          title: "The record that answers for you",
          body:
            "<p>The state agency's review does not close. Its findings run to the notification timeline, the absence of a written incident response plan, and the district's public statements measured against what it knew when it made them. The county office assigns a technical monitor for eighteen months. In April, a reporter obtains last February's board packet and lays the deferred maintenance line beside your after-action presentation, and the story writes itself without a single unfair sentence in it.</p><p>The intrusion was not your fault. The account of it was yours to give, and you gave one the record does not support. That is the difference between an incident a district survives and one it spends years explaining.</p>",
        },
      ],
      feedbackMode: "debrief",
      showPathInDebrief: true,
    }),
  },
};

export const DEFAULT_BRANCHING_STARTER_ID = "blank";

/** Builds a fresh, title-stamped config for the given starter id. Unknown
 *  ids fall back to the blank starter (mirrors the FormData default in
 *  `createInteractive`) rather than throwing, since this can be reached with
 *  attacker-controlled input. Re-parses through the schema so the result is
 *  a genuinely fresh object tree (no shared references back into
 *  `BRANCHING_STARTERS`), not just a shallow spread. */
export function branchingStarterConfig(starterId: string, title: string): BranchingConfig {
  const starter = BRANCHING_STARTERS[starterId] ?? BRANCHING_STARTERS[DEFAULT_BRANCHING_STARTER_ID];
  return branchingConfigSchema.parse({ ...starter.config, title });
}
