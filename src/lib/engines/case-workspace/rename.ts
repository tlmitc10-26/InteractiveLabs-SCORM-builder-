/**
 * Pure, dependency-free reference-rewrite helpers backing the case-workspace
 * editor's per-row "Rename to match label" Advanced affordance. Mirrors
 * branching-scenario/rename.ts's role and approach: every id this module
 * rewrites appears only as a COMPLETE string value in a schema.ts-defined
 * position (an artifact id is the entire `expertMap[].artifactId` value, a
 * conclusion id is the entire `expertMap[].conclusionId` value, a reason id
 * is the entire `reasons[].id` value scoped to its own conclusion), so
 * word-exact equality checks are exact and sufficient — no regex or parser
 * is needed, unlike param-sandbox/rename.ts's formula-identifier rewriting.
 *
 * Structural/untyped like branching's rename.ts on purpose: this needs
 * nothing beyond plain object shapes, so it stays importable from the
 * editor's client bundle without dragging schema.ts's zod/sanitize-html
 * weight along. schema.ts's `CaseConfig` (a z.infer) structurally satisfies
 * `RenameableCaseConfig` below without either module importing the other's
 * types.
 *
 * Never mutates `config`; every function returns a new object tree along
 * the paths it touches (unrelated array elements keep their original
 * object identity is NOT guaranteed — each function maps over its arrays,
 * consistent with branching's rename.ts's own approach).
 *
 * Reason ids are scoped per-conclusion (like branching's choice ids scoped
 * per-scene) and are never referenced anywhere else in the config (the
 * expert map references artifacts and conclusions only, never reasons), so
 * renameReasonId — like branching's renameChoiceId — only ever touches the
 * one reason inside the one named conclusion.
 */

type MapEntry = { artifactId: string; conclusionId: string; [k: string]: unknown };
type Reason = { id: string; [k: string]: unknown };
type Conclusion = { id: string; reasons: Reason[]; [k: string]: unknown };
type Artifact = { id: string; [k: string]: unknown };

export type RenameableCaseConfig = {
  artifacts: Artifact[];
  conclusions: Conclusion[];
  expertMap: MapEntry[];
  [k: string]: unknown;
};

/** Renames an artifact id: rewrites the artifact's own id and every
 *  `expertMap[].artifactId` reference. Conclusions and reasons are left
 *  untouched. */
export function renameArtifactId<T extends RenameableCaseConfig>(config: T, oldId: string, newId: string): T {
  if (oldId === newId) return config;
  const artifacts = config.artifacts.map((a) => (a.id === oldId ? { ...a, id: newId } : a));
  const expertMap = config.expertMap.map((m) => (m.artifactId === oldId ? { ...m, artifactId: newId } : m));
  return { ...config, artifacts, expertMap };
}

/** Renames a conclusion id: rewrites the conclusion's own id (its `reasons`
 *  array moves along with it, since reasons live inside the conclusion
 *  object) and every `expertMap[].conclusionId` reference. Artifacts are
 *  left untouched. */
export function renameConclusionId<T extends RenameableCaseConfig>(config: T, oldId: string, newId: string): T {
  if (oldId === newId) return config;
  const conclusions = config.conclusions.map((c) => (c.id === oldId ? { ...c, id: newId } : c));
  const expertMap = config.expertMap.map((m) => (m.conclusionId === oldId ? { ...m, conclusionId: newId } : m));
  return { ...config, conclusions, expertMap };
}

/** Renames a reason id — conclusion-local only: a reason id is never
 *  referenced anywhere else in the config, so this rewrites just the one
 *  reason inside the one named conclusion. A `conclusionId` that doesn't
 *  match any conclusion is a no-op (returns a shallow-copied config,
 *  nothing renamed). */
export function renameReasonId<T extends RenameableCaseConfig>(config: T, conclusionId: string, oldId: string, newId: string): T {
  if (oldId === newId) return config;
  const conclusions = config.conclusions.map((c) =>
    c.id === conclusionId
      ? { ...c, reasons: c.reasons.map((r) => (r.id === oldId ? { ...r, id: newId } : r)) }
      : c,
  );
  return { ...config, conclusions };
}

/** Strips every `expertMap` entry referencing an artifact id — backs the
 *  editor's artifact-row delete (mirrors branching's
 *  removeVariableReferences: destructive-but-consistent, so a deleted
 *  artifact never leaves a dangling map entry behind). Callers are still
 *  responsible for removing the artifact's own entry from
 *  `config.artifacts` — this only touches the OTHER place an artifact id
 *  can appear. */
export function removeArtifactReferences<T extends RenameableCaseConfig>(config: T, artifactId: string): T {
  return { ...config, expertMap: config.expertMap.filter((m) => m.artifactId !== artifactId) };
}

/** Strips every `expertMap` entry referencing a conclusion id — backs the
 *  editor's conclusion-row delete. Same division of labor as
 *  removeArtifactReferences: callers separately remove the conclusion's own
 *  entry from `config.conclusions`. */
export function removeConclusionReferences<T extends RenameableCaseConfig>(config: T, conclusionId: string): T {
  return { ...config, expertMap: config.expertMap.filter((m) => m.conclusionId !== conclusionId) };
}
