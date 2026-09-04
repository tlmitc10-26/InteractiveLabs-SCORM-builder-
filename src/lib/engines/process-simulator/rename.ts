/**
 * Pure, dependency-free reference-rewrite helpers backing the process-
 * simulator editor's per-row "Rename to match label" Advanced affordance,
 * and the required->distractor toggle cascade (spec §5 review #10).
 * Mirrors case-workspace/rename.ts's role and approach exactly: an action
 * id appears only as a COMPLETE string value in a schema.ts-defined
 * position — the action's own `id`, or an entry of ANOTHER action's
 * `requires` array — so word-exact equality checks are exact and
 * sufficient; no regex or parser is needed.
 *
 * Structural/untyped like case-workspace's rename.ts on purpose: this needs
 * nothing beyond plain object shapes, so it stays importable from the
 * editor's client bundle without dragging schema.ts's zod/sanitize-html
 * weight along. schema.ts's `ProcessConfig` (a z.infer) structurally
 * satisfies `RenameableProcessConfig` below without either module importing
 * the other's types.
 *
 * Never mutates `config`; every function returns a new object tree along
 * the paths it touches (unrelated array elements keep their original
 * object identity is NOT guaranteed — each function maps over `actions`,
 * consistent with case-workspace/rename.ts's own approach).
 */

type Action = { id: string; requires?: string[]; [k: string]: unknown };

export type RenameableProcessConfig = {
  actions: Action[];
  [k: string]: unknown;
};

/** Rewrites `requires` to drop `oldId` if present, dropping the field
 *  entirely (rather than leaving `[]`, which the schema forbids — `[]` is
 *  invalid, absent means "none") when nothing remains. Returns the SAME
 *  action object when `oldId` isn't referenced, so callers that don't need
 *  a rewrite skip the allocation. */
function withoutRequires(action: Action, oldId: string): Action {
  if (!action.requires || !action.requires.includes(oldId)) return action;
  const pruned = action.requires.filter((id) => id !== oldId);
  if (pruned.length === 0) {
    const rest: Action = { ...action };
    delete rest.requires;
    return rest;
  }
  return { ...action, requires: pruned };
}

/** Renames an action id: rewrites the action's own id AND every OTHER
 *  action's `requires` entry referencing it (conjunctive prerequisites —
 *  an action can appear in many other actions' `requires` arrays at once,
 *  unlike case-workspace's artifact/conclusion ids which are referenced via
 *  a single external map). */
export function renameActionId<T extends RenameableProcessConfig>(config: T, oldId: string, newId: string): T {
  if (oldId === newId) return config;
  const actions = config.actions.map((a) => {
    const renamed = a.id === oldId ? { ...a, id: newId } : a;
    if (!renamed.requires || !renamed.requires.includes(oldId)) return renamed;
    return { ...renamed, requires: renamed.requires.map((id) => (id === oldId ? newId : id)) };
  });
  return { ...config, actions };
}

/** Strips every OTHER action's `requires` entry referencing `actionId` —
 *  backs BOTH the editor's action-row delete AND the required->distractor
 *  toggle cascade (spec §5 review #10: toggling a required action to a
 *  distractor must prune every inbound prerequisite pointing at it, since a
 *  distractor can never be referenced by `requires`). Callers are still
 *  responsible for the action's own fate (removing it from `config.actions`
 *  on delete, or flipping its own `required` flag on toggle) — this only
 *  touches the OTHER place an action id can appear. A no-op (aside from a
 *  fresh `actions` array) when `actionId` is never referenced. */
export function removeActionReferences<T extends RenameableProcessConfig>(config: T, actionId: string): T {
  return { ...config, actions: config.actions.map((a) => withoutRequires(a, actionId)) };
}
