import { validateSandboxConfig, type SandboxConfig } from "@/lib/engines/param-sandbox/schema";
import * as psRuntime from "@/lib/engines/param-sandbox/runtime-config";
import { STARTERS as PS_STARTERS, starterConfig as psStarterConfig } from "@/lib/engines/param-sandbox/starter-configs";
import { validateBranchingConfig } from "@/lib/engines/branching-scenario/schema";
import * as branchingRuntime from "@/lib/engines/branching-scenario/runtime-config";
import type { BranchingConfigLike } from "@/lib/engines/branching-scenario/runtime-config";
import { BRANCHING_STARTERS, branchingStarterConfig } from "@/lib/engines/branching-scenario/starters";

export interface StarterMeta {
  id: string;
  label: string;
  description: string;
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
    starters: Object.entries(PS_STARTERS).map(([id, s]) => ({ id, label: s.label, description: s.description })),
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
    starters: Object.entries(BRANCHING_STARTERS).map(([id, s]) => ({ id, label: s.label, description: s.description })),
  },
};

export function adapterFor(engineId: string): EngineAdapter {
  const a = ENGINE_ADAPTERS[engineId];
  if (!a) throw new Error(`unknown engine "${engineId}"`);
  return a;
}
