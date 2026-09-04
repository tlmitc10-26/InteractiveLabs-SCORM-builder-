import { validateSandboxConfig, type SandboxConfig } from "@/lib/engines/param-sandbox/schema";
import * as psRuntime from "@/lib/engines/param-sandbox/runtime-config";
import { STARTERS as PS_STARTERS, starterConfig as psStarterConfig } from "@/lib/engines/param-sandbox/starter-configs";
import { validateBranchingConfig } from "@/lib/engines/branching-scenario/schema";
import * as branchingRuntime from "@/lib/engines/branching-scenario/runtime-config";
import type { BranchingConfigLike } from "@/lib/engines/branching-scenario/runtime-config";
import { BRANCHING_STARTERS, branchingStarterConfig } from "@/lib/engines/branching-scenario/starters";
import { validateCaseConfig } from "@/lib/engines/case-workspace/schema";
import * as caseRuntime from "@/lib/engines/case-workspace/runtime-config";
import type { CaseWorkspaceConfigLike } from "@/lib/engines/case-workspace/runtime-config";
import { CASE_STARTERS, caseStarterConfig } from "@/lib/engines/case-workspace/starters";
import { validateProcessConfig } from "@/lib/engines/process-simulator/schema";
import * as processRuntime from "@/lib/engines/process-simulator/runtime-config";
import type { ProcessRuntimeConfigLike } from "@/lib/engines/process-simulator/runtime-config";
import { PROCESS_STARTERS, processStarterConfig } from "@/lib/engines/process-simulator/starters";

export interface StarterMeta {
  id: string;
  label: string;
  description: string;
  /** "blank" starters are empty-ish skeletons to build from scratch; every
   *  other starter is an "exemplar" demonstrating a worked pattern. The
   *  "New interactive" picker (new-interactive-form.tsx) groups the
   *  `<select>` by this field via `<optgroup>`. */
  group: "blank" | "exemplar";
}

export interface EngineAdapter {
  engineId: string;
  version: string;
  label: string;
  /** One-line description shown next to `label` on the "New interactive"
   *  engine picker (Task 8) — plain text, no em dashes (period/colon only,
   *  per house style). */
  blurb: string;
  validate(raw: unknown): { ok: true; config: unknown } | { ok: false; errors: string[] };
  toRuntimeConfig(config: unknown, urlForAsset: (id: string) => string): unknown;
  collectAssetIds(config: unknown): string[];
  /**
   * Every rich-text (sanitized HTML) string value in an authoring config for
   * this engine — used by the export scanner's sanitizer-stability check
   * (src/lib/export/scanner.ts), which asserts sanitizeRichText(v) === v for
   * each. The scanner itself stays engine-agnostic: it never knows the shape
   * of a config, only that this function can enumerate its rich-text values.
   */
  richTextValues(config: unknown): string[];
  /** Builds a fresh, title-stamped starter config. Unknown starter ids fall
   *  back to this engine's default starter (see each engine's starters
   *  module) rather than throwing, since callers may pass attacker-controlled
   *  form input straight through. */
  starterConfig(starterId: string, title: string): unknown;
  /** Starters offered for this engine on the "New interactive" form. */
  starters: StarterMeta[];
}

export const ENGINE_ADAPTERS: Record<string, EngineAdapter> = {
  "param-sandbox": {
    engineId: "param-sandbox",
    version: "1.0.0",
    label: "Parameter Sandbox",
    blurb: "Learners experiment with a live model.",
    validate: (raw) => validateSandboxConfig(raw),
    toRuntimeConfig: (c, u) => psRuntime.toRuntimeConfig(c as never, u),
    collectAssetIds: (c) => psRuntime.collectAssetIds(c as never),
    richTextValues: (c) => {
      const config = c as SandboxConfig;
      return config.intro ? [config.intro] : [];
    },
    starterConfig: (starterId, title) => psStarterConfig(starterId, title),
    starters: Object.entries(PS_STARTERS).map(([id, s]) => ({ id, label: s.label, description: s.description, group: s.group })),
  },
  "branching-scenario": {
    engineId: "branching-scenario",
    version: "1.0.0",
    label: "Branching Scenario",
    blurb: "Learners make decisions and live the consequences.",
    validate: (raw) => validateBranchingConfig(raw),
    toRuntimeConfig: (c, u) => branchingRuntime.toBranchingRuntimeConfig(c as BranchingConfigLike, u),
    collectAssetIds: (c) => branchingRuntime.collectBranchingAssetIds(c as BranchingConfigLike),
    richTextValues: (c) => {
      const config = c as BranchingConfigLike;
      const values: string[] = [];
      if (config.intro) values.push(config.intro);
      for (const scene of config.scenes) {
        values.push(scene.body);
        for (const choice of scene.choices) if (choice.feedback) values.push(choice.feedback);
      }
      for (const ending of config.endings) values.push(ending.body);
      return values;
    },
    starterConfig: (starterId, title) => branchingStarterConfig(starterId, title),
    starters: Object.entries(BRANCHING_STARTERS).map(([id, s]) => ({ id, label: s.label, description: s.description, group: s.group })),
  },
  "case-workspace": {
    engineId: "case-workspace",
    version: "1.0.0",
    label: "Case / Evidence Workspace",
    blurb: "Learners examine evidence and defend a conclusion.",
    validate: (raw) => validateCaseConfig(raw),
    toRuntimeConfig: (c, u) => caseRuntime.toCaseRuntimeConfig(c as CaseWorkspaceConfigLike, u),
    collectAssetIds: (c) => caseRuntime.collectCaseAssetIds(c as CaseWorkspaceConfigLike),
    richTextValues: (c) => {
      const config = c as { intro: string; artifacts: Array<{ body?: string }>; conclusions: Array<{ body?: string; expertRationale: string }> };
      const values: string[] = [config.intro];
      for (const artifact of config.artifacts) if (artifact.body) values.push(artifact.body);
      for (const conclusion of config.conclusions) {
        if (conclusion.body) values.push(conclusion.body);
        values.push(conclusion.expertRationale);
      }
      return values;
    },
    starterConfig: (starterId, title) => caseStarterConfig(starterId, title),
    starters: Object.entries(CASE_STARTERS).map(([id, s]) => ({ id, label: s.label, description: s.description, group: s.group })),
  },
  "process-simulator": {
    engineId: "process-simulator",
    version: "1.0.0",
    label: "Process Simulator",
    blurb: "Learners perform a multi-step procedure and live with the consequences of a wrong or premature action.",
    validate: (raw) => validateProcessConfig(raw),
    toRuntimeConfig: (c, u) => processRuntime.toProcessRuntimeConfig(c as ProcessRuntimeConfigLike, u),
    collectAssetIds: (c) => processRuntime.collectProcessAssetIds(c as ProcessRuntimeConfigLike),
    richTextValues: (c) => {
      const config = c as { intro: string; opening: string; expertNote?: string; actions: Array<{ outcome?: string; consequence?: string }> };
      const values: string[] = [config.intro, config.opening];
      if (config.expertNote) values.push(config.expertNote);
      for (const action of config.actions) {
        if (action.outcome) values.push(action.outcome);
        if (action.consequence) values.push(action.consequence);
      }
      return values;
    },
    starterConfig: (starterId, title) => processStarterConfig(starterId, title),
    starters: Object.entries(PROCESS_STARTERS).map(([id, s]) => ({ id, label: s.label, description: s.description, group: s.group })),
  },
};

export function adapterFor(engineId: string): EngineAdapter {
  const a = ENGINE_ADAPTERS[engineId];
  if (!a) throw new Error(`unknown engine "${engineId}"`);
  return a;
}
