import { caseConfigSchema, type CaseConfig } from "./schema";

/**
 * Starter templates offered on the "New interactive" form for the case
 * workspace engine. Each entry's `config` is parsed through
 * `caseConfigSchema` at module load time so an invalid starter fails
 * immediately (a test asserts this — see tests/case-starters.test.ts)
 * rather than surfacing as a runtime bug the first time someone picks it.
 * `caseConfigSchema.parse` runs the full validateCaseConfig-independent
 * shape/field-level checks; the starters test additionally runs every
 * starter through `validateCaseConfig` to also cover the cross-field rules
 * (map resolution, per-conclusion requirements, mode gate) that
 * `.parse` alone does not.
 *
 * `config.title` here is a placeholder ("") — the real title always comes
 * from the "New interactive" form, never from the starter. Callers should
 * go through `caseStarterConfig(starterId, title)` below rather than
 * reading `CASE_STARTERS[id].config` directly, so the title is always the
 * one the designer actually typed.
 */
export const CASE_STARTERS: Record<string, { label: string; description: string; group: "blank" | "exemplar"; config: CaseConfig }> = {
  blank: {
    label: "Blank",
    description:
      "Two artifacts, two conclusions, and a minimal expert map, scored best-supported — a skeleton to build your own case workspace from.",
    group: "blank",
    config: caseConfigSchema.parse({
      title: "",
      intro:
        "<p>Review the artifacts below, build a case file of the evidence you find relevant, and commit to the conclusion you can best defend with sound reasoning.</p>",
      scoringMode: "best-supported",
      artifacts: [
        {
          id: "artifact_one",
          title: "Artifact One",
          kind: "text",
          body: "<p>Describe the first piece of evidence here — a memo, a log excerpt, a witness statement. Give the learner enough detail to weigh it against each conclusion.</p>",
        },
        {
          id: "artifact_two",
          title: "Artifact Two",
          kind: "text",
          body: "<p>Describe a second piece of evidence here. An artifact can support a conclusion, contradict it, or be entirely irrelevant — irrelevant artifacts are a legitimate part of the exercise.</p>",
        },
      ],
      conclusions: [
        {
          id: "conclusion_a",
          label: "Conclusion A",
          credit: "full",
          expertRationale: "<p>Explain, from the expert's point of view, why this is the best-supported conclusion given the artifacts above.</p>",
          reasons: [
            {
              id: "conclusion_a_sound",
              text: "A sound reason that genuinely follows from the evidence for Conclusion A.",
              sound: true,
            },
            {
              id: "conclusion_a_flawed",
              text: "A plausible-sounding but flawed reason for Conclusion A.",
              sound: false,
              flawNote: "Explain the reasoning flaw here — this note appears to the learner after they select this reason.",
            },
          ],
        },
        {
          id: "conclusion_b",
          label: "Conclusion B",
          credit: "none",
          expertRationale: "<p>Explain why this conclusion falls short, even though it may look reasonable at first glance.</p>",
          reasons: [
            {
              id: "conclusion_b_sound",
              text: "A sound reason relevant to Conclusion B, even though it isn't the credited conclusion.",
              sound: true,
            },
            {
              id: "conclusion_b_flawed",
              text: "A flawed reason relevant to Conclusion B.",
              sound: false,
              flawNote: "Explain the reasoning flaw here.",
            },
          ],
        },
      ],
      expertMap: [
        { artifactId: "artifact_one", conclusionId: "conclusion_a", role: "supports", strength: "strong" },
        { artifactId: "artifact_two", conclusionId: "conclusion_b", role: "supports", strength: "weak" },
      ],
    }),
  },
};

export const DEFAULT_CASE_STARTER_ID = "blank";

/** Builds a fresh, title-stamped config for the given starter id. Unknown
 *  ids fall back to the blank starter (mirrors branching's
 *  branchingStarterConfig) rather than throwing, since this can be reached
 *  with attacker-controlled input. Re-parses through the schema so the
 *  result is a genuinely fresh object tree (no shared references back into
 *  `CASE_STARTERS`), not just a shallow spread. */
export function caseStarterConfig(starterId: string, title: string): CaseConfig {
  const starter = CASE_STARTERS[starterId] ?? CASE_STARTERS[DEFAULT_CASE_STARTER_ID];
  return caseConfigSchema.parse({ ...starter.config, title });
}
