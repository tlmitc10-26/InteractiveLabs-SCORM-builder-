import { processConfigSchema, type ProcessConfig } from "./schema";

/**
 * Starter templates offered on the "New interactive" form for the process
 * simulator engine. Each entry's `config` is parsed through
 * `processConfigSchema` at module load time so an invalid starter fails
 * immediately (a test asserts this — see tests/process-starters.test.ts)
 * rather than surfacing as a runtime bug the first time someone picks it.
 * `processConfigSchema.parse` runs the shape/field-level checks; the
 * starters test additionally runs every starter through
 * `validateProcessConfig` to also cover the cross-field rules (acyclicity,
 * requires-only-required, the illegally-attemptable hard rule, the field
 * matrix, unique required labels) that `.parse` alone does not.
 *
 * `config.title` here is a placeholder ("") — the real title always comes
 * from the "New interactive" form, never from the starter. Callers should
 * go through `processStarterConfig(starterId, title)` below rather than
 * reading `PROCESS_STARTERS[id].config` directly, so the title is always
 * the one the designer actually typed.
 */
export const PROCESS_STARTERS: Record<string, { label: string; description: string; group: "blank" | "exemplar"; config: ProcessConfig }> = {
  blank: {
    label: "Blank",
    description:
      "A minimal, already-gradeable procedure: one prerequisite edge and one distractor, satisfying the schema's illegally-attemptable rule out of the box — build your own procedure from here.",
    group: "blank",
    config: processConfigSchema.parse({
      title: "",
      intro:
        "<p>Read the situation, then perform each action in an order that respects its prerequisites. A wrong or premature action produces a realistic consequence and lets you continue — mistakes cost score, never the attempt.</p>",
      opening: "<p>Describe the initial situation the learner walks into here — enough detail to make the first action obvious.</p>",
      actions: [
        {
          id: "first_action",
          label: "Describe the first action here",
          required: true,
          outcome: "<p>Describe what becomes true in the situation once this action is legally performed.</p>",
        },
        {
          id: "second_action",
          label: "Describe a second gated action here",
          required: true,
          requires: ["first_action"],
          outcome: "<p>Describe what becomes true once this action is legally performed.</p>",
          consequence: "<p>Describe the realistic consequence of attempting this action before its prerequisite is done.</p>",
          consequenceNote: "Explain, for the debrief, why the prerequisite matters.",
        },
        {
          id: "third_action",
          label: "Describe a third independent required action here",
          required: true,
          outcome: "<p>Describe what becomes true once this action is legally performed.</p>",
        },
        {
          id: "distractor_action",
          label: "Describe a tempting but wrong action here",
          required: false,
          consequence: "<p>Describe the realistic consequence of taking this wrong action.</p>",
          consequenceNote: "Explain, for the debrief, why this action is never correct.",
        },
      ],
    }),
  },
};

export const DEFAULT_PROCESS_STARTER_ID = "blank";

/** Builds a fresh, title-stamped config for the given starter id. Unknown
 *  ids fall back to the blank starter (mirrors case-workspace's
 *  caseStarterConfig / branching's branchingStarterConfig) rather than
 *  throwing, since this can be reached with attacker-controlled input.
 *  Re-parses through the schema so the result is a genuinely fresh object
 *  tree (no shared references back into `PROCESS_STARTERS`), not just a
 *  shallow spread. */
export function processStarterConfig(starterId: string, title: string): ProcessConfig {
  const starter = PROCESS_STARTERS[starterId] ?? PROCESS_STARTERS[DEFAULT_PROCESS_STARTER_ID];
  return processConfigSchema.parse({ ...starter.config, title });
}
