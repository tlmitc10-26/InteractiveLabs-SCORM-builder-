/**
 * LIGHT module: zero heavy deps (no zod, no sanitize-html). Mirrors the
 * other three engines' runtime-config.ts role (structural runtime-shape
 * mapping needed by client bundles that must NOT pull zod/sanitize-html
 * into their chunk: the editor's live preview AND the engine runtime bundle
 * — Task 3) — but process-simulator carries no assets in v1 (spec §10:
 * Images are out of scope), so there is no imageAssetId -> imageUrl mapping
 * to perform. This module is a light PASS-THROUGH kept as its own file
 * (rather than skipped) so the runtime and the editor's preview have one
 * canonical "runtime config" import, matching the other three engines'
 * registration shape (spec §8) — a future v-next that adds an asset field
 * (e.g. a per-action image) has exactly one place to add the mapping.
 *
 * schema.ts's `ProcessConfig` (a z.infer) structurally satisfies
 * `ProcessRuntimeConfigLike` below without either module importing the
 * other's types.
 */

export type ProcessRuntimeAction = {
  id: string;
  label: string;
  required: boolean;
  requires?: string[];
  outcome?: string;
  consequence?: string;
  consequenceNote?: string;
};

export type ProcessRuntimeConfigLike = {
  title: string;
  intro: string;
  headerColor?: string;
  opening: string;
  expertNote?: string;
  actions: ProcessRuntimeAction[];
};

/** Identity pass-through — no asset ids to resolve in v1. Takes the same
 *  two-argument shape as the other three engines' toXRuntimeConfig
 *  (`urlForAsset` unused here) so call sites can treat all four engines
 *  uniformly without a special case for this one. */
export function toProcessRuntimeConfig<T extends ProcessRuntimeConfigLike>(
  config: T,
  urlForAsset: (assetId: string) => string,
): T {
  void urlForAsset; // no assets in v1; kept for signature parity across all four engines' dispatch adapters
  return config;
}

/** No assets exist in v1 — always empty. Kept as a real function (not
 *  omitted) so export bundling (which calls collectXAssetIds uniformly
 *  across all four engines) never needs an engine-specific branch. */
export function collectProcessAssetIds(config: ProcessRuntimeConfigLike): string[] {
  void config;
  return [];
}
