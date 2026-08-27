/**
 * Pure, dependency-free reference-rewrite helpers backing the branching
 * editor's per-row "Rename to match label" Advanced affordance. Mirrors
 * src/lib/engines/param-sandbox/rename.ts's role, but the rewrite itself is
 * simpler: unlike a formula identifier (which can appear embedded inside a
 * larger expression, hence that module's parser-based word-boundary
 * machinery), every id this module rewrites appears only as a COMPLETE
 * string value in a schema.ts-defined position — a scene id is the entire
 * `goTo: "scene:<id>"` suffix, a variable id is the entire
 * `effects[].variableId` / `showIf.variableId` value, etc. Word-exact
 * equality checks are therefore exact and sufficient; no regex or parser is
 * needed.
 *
 * Structural/untyped like runtime-config.ts on purpose: this needs nothing
 * beyond plain object shapes, so it stays importable from the editor's
 * client bundle without dragging schema.ts's zod/sanitize-html weight along.
 * schema.ts's `BranchingConfig` (a z.infer) structurally satisfies
 * `RenameableBranchingConfig` below without either module importing the
 * other's types.
 *
 * Never mutates `config`; every function returns a new object tree along
 * the paths it touches (unrelated array elements keep their original
 * object identity is NOT guaranteed — each function maps over its arrays,
 * consistent with rename.ts's own approach).
 */

type Condition = { variableId: string; [k: string]: unknown };
type Effect = { variableId: string; [k: string]: unknown };
type Choice = { id: string; goTo: string; effects: Effect[]; showIf?: Condition; [k: string]: unknown };
type Scene = { id: string; choices: Choice[]; [k: string]: unknown };
type Variable = { id: string; [k: string]: unknown };
type Ending = { id: string; [k: string]: unknown };

export type RenameableBranchingConfig = {
  startSceneId: string;
  variables: Variable[];
  scenes: Scene[];
  endings: Ending[];
  [k: string]: unknown;
};

/** Renames a scene id: rewrites the scene's own id, every
 *  `goTo: "scene:<oldId>"` reference across ALL scenes' choices, and
 *  `startSceneId` when it currently points at this scene. Choice ids and
 *  other scenes are left untouched. */
export function renameSceneId<T extends RenameableBranchingConfig>(config: T, oldId: string, newId: string): T {
  if (oldId === newId) return config;
  const oldRef = `scene:${oldId}`;
  const newRef = `scene:${newId}`;
  const scenes = config.scenes.map((s) => ({
    ...s,
    id: s.id === oldId ? newId : s.id,
    choices: s.choices.map((c) => (c.goTo === oldRef ? { ...c, goTo: newRef } : c)),
  }));
  const startSceneId = config.startSceneId === oldId ? newId : config.startSceneId;
  return { ...config, scenes, startSceneId };
}

/** Renames an ending id: rewrites the ending's own id and every
 *  `goTo: "ending:<oldId>"` reference across all scenes' choices. */
export function renameEndingId<T extends RenameableBranchingConfig>(config: T, oldId: string, newId: string): T {
  if (oldId === newId) return config;
  const oldRef = `ending:${oldId}`;
  const newRef = `ending:${newId}`;
  const scenes = config.scenes.map((s) => ({
    ...s,
    choices: s.choices.map((c) => (c.goTo === oldRef ? { ...c, goTo: newRef } : c)),
  }));
  const endings = config.endings.map((e) => (e.id === oldId ? { ...e, id: newId } : e));
  return { ...config, scenes, endings };
}

/** Renames a variable id: rewrites the variable's own id, every
 *  `effects[].variableId` reference, and every `showIf.variableId`
 *  reference, across all scenes' choices. */
export function renameVariableId<T extends RenameableBranchingConfig>(config: T, oldId: string, newId: string): T {
  if (oldId === newId) return config;
  const variables = config.variables.map((v) => (v.id === oldId ? { ...v, id: newId } : v));
  const scenes = config.scenes.map((s) => ({
    ...s,
    choices: s.choices.map((c) => ({
      ...c,
      effects: c.effects.map((ef) => (ef.variableId === oldId ? { ...ef, variableId: newId } : ef)),
      showIf: c.showIf && c.showIf.variableId === oldId ? { ...c.showIf, variableId: newId } : c.showIf,
    })),
  }));
  return { ...config, variables, scenes };
}

/** Renames a choice id — scene-local only: a choice id is never referenced
 *  anywhere else in the config (unlike scene/ending/variable ids, which are
 *  referenced from goTo/effects/showIf elsewhere), so this rewrites just the
 *  one choice inside the one named scene. A `sceneId` that doesn't match any
 *  scene is a no-op (returns a shallow-copied config, nothing renamed). */
export function renameChoiceId<T extends RenameableBranchingConfig>(config: T, sceneId: string, oldId: string, newId: string): T {
  if (oldId === newId) return config;
  const scenes = config.scenes.map((s) =>
    s.id === sceneId
      ? { ...s, choices: s.choices.map((c) => (c.id === oldId ? { ...c, id: newId } : c)) }
      : s,
  );
  return { ...config, scenes };
}
