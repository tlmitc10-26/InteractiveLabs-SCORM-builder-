/**
 * LIGHT module: zero heavy deps (no zod, no sanitize-html). This is deliberate
 * — schema.ts (validation, sanitization) is a heavy authoring-time
 * dependency; the pieces here (structural runtime-shape mapping, asset-id
 * collection, quality weights) are needed by client bundles that must NOT
 * pull zod/sanitize-html into their chunk: the editor's live preview AND the
 * engine runtime bundle (Task 5) itself. Mirrors the param-sandbox split —
 * see src/lib/engines/param-sandbox/runtime-config.ts.
 *
 * schema.ts's `BranchingConfig` (a z.infer) structurally satisfies
 * `BranchingConfigLike` below without either module importing the other's
 * types.
 */

export const QUALITY_WEIGHTS = { best: 1, acceptable: 0.5, poor: 0 } as const;
export type Quality = keyof typeof QUALITY_WEIGHTS;

export type Comparator = "gte" | "lte" | "between";
export type Condition = { variableId: string; comparator: Comparator; value?: number; min?: number; max?: number };
export type Effect = { variableId: string; delta: number };

export type Choice = {
  id: string;
  label: string;
  quality: Quality;
  effects: Effect[];
  feedback?: string;
  goTo: string; // "scene:<id>" | "ending:<id>"
  showIf?: Condition;
};

export type Scene = {
  id: string;
  title?: string;
  body: string;
  imageAssetId?: string;
  imageRole?: "decorative" | "informative";
  imageAlt?: string;
  choices: Choice[];
};

export type Variable = { id: string; label: string; initial: number; min: number; max: number; visible: boolean };
export type Ending = { id: string; title: string; body: string };

/** Structural authoring-config shape (see schema.ts's `BranchingConfig`). */
export type BranchingConfigLike = {
  title: string;
  intro?: string;
  role?: string;
  variables: Variable[];
  scenes: Scene[];
  startSceneId: string;
  endings: Ending[];
  feedbackMode: "immediate" | "debrief";
  showPathInDebrief: boolean;
};

/** Runtime scene: imageAssetId resolved to imageUrl (key dropped when absent). */
export type RuntimeScene = Omit<Scene, "imageAssetId"> & { imageUrl?: string };

/** Runtime config consumed by the engine runtime: imageAssetId -> imageUrl
 *  throughout scenes; everything else passes through unchanged. */
export type RuntimeBranchingConfig = Omit<BranchingConfigLike, "scenes"> & { scenes: RuntimeScene[] };

export function toBranchingRuntimeConfig(
  config: BranchingConfigLike,
  urlForAsset: (assetId: string) => string,
): RuntimeBranchingConfig {
  return {
    ...config,
    scenes: config.scenes.map((scene): RuntimeScene => {
      const { imageAssetId, ...rest } = scene;
      return imageAssetId ? { ...rest, imageUrl: urlForAsset(imageAssetId) } : rest;
    }),
  };
}

/** All assetIds referenced by a config (for export bundling). */
export function collectBranchingAssetIds(config: BranchingConfigLike): string[] {
  const ids = new Set<string>();
  for (const scene of config.scenes) if (scene.imageAssetId) ids.add(scene.imageAssetId);
  return [...ids];
}
