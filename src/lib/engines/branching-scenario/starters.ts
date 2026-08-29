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
