/**
 * LIGHT module: zero heavy deps (no zod, no sanitize-html). This is
 * deliberate — schema.ts (validation, sanitization) is a heavy
 * authoring-time dependency; the pieces here (structural runtime-shape
 * mapping, asset-id collection) are needed by client bundles that must NOT
 * pull zod/sanitize-html into their chunk: the editor's live preview AND
 * the engine runtime bundle (Task 5) itself. Mirrors
 * branching-scenario/runtime-config.ts's role exactly.
 *
 * schema.ts's `CaseConfig` (a z.infer) structurally satisfies
 * `CaseWorkspaceConfigLike` below without either module importing the
 * other's types. Only the `artifacts` field is typed precisely (this
 * module's entire job is the artifact imageAssetId -> imageUrl mapping);
 * every other field (title/intro/scoringMode/headerColor/conclusions/
 * expertMap) passes through untouched via the index signature, mirroring
 * branching-scenario/rename.ts's passthrough-field philosophy for fields a
 * module doesn't need to understand.
 */

export type ImageRole = "decorative" | "informative";
export type ArtifactKind = "text" | "image" | "table";

export type ArtifactTable = { caption?: string; headers: string[]; rows: string[][] };

export type Artifact = {
  id: string;
  title: string;
  sourceLine?: string;
  kind: ArtifactKind;
  body?: string;
  imageAssetId?: string;
  imageRole?: ImageRole;
  imageAlt?: string;
  table?: ArtifactTable;
};

export type CaseWorkspaceConfigLike = {
  artifacts: Artifact[];
  [k: string]: unknown;
};

/** Runtime artifact: imageAssetId resolved to imageUrl (key dropped when
 *  absent) — mirrors branching-scenario/runtime-config.ts's RuntimeScene. */
export type RuntimeArtifact = Omit<Artifact, "imageAssetId"> & { imageUrl?: string };

/** Runtime config consumed by the engine runtime: imageAssetId -> imageUrl
 *  throughout artifacts; every other field passes through unchanged. */
export type RuntimeCaseWorkspaceConfig<T extends CaseWorkspaceConfigLike = CaseWorkspaceConfigLike> =
  Omit<T, "artifacts"> & { artifacts: RuntimeArtifact[] };

export function toCaseRuntimeConfig<T extends CaseWorkspaceConfigLike>(
  config: T,
  urlForAsset: (assetId: string) => string,
): RuntimeCaseWorkspaceConfig<T> {
  return {
    ...config,
    artifacts: config.artifacts.map((a): RuntimeArtifact => {
      const { imageAssetId, ...rest } = a;
      return imageAssetId ? { ...rest, imageUrl: urlForAsset(imageAssetId) } : rest;
    }),
  };
}

/** All assetIds referenced by a config (for export bundling). */
export function collectCaseAssetIds(config: CaseWorkspaceConfigLike): string[] {
  const ids = new Set<string>();
  for (const a of config.artifacts) if (a.imageAssetId) ids.add(a.imageAssetId);
  return [...ids];
}
