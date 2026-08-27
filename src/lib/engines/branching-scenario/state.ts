/**
 * Pure state machine, zero DOM, zero heavy deps — importable by the engine
 * runtime bundle (Task 5) as well as by editor/preview code and tests. Only
 * imports from the light `runtime-config.ts` module (types + QUALITY_WEIGHTS).
 */

import {
  QUALITY_WEIGHTS,
  type BranchingConfigLike,
  type Choice,
  type Condition,
  type Quality,
  type Scene,
} from "./runtime-config";

export interface PathStep {
  s: string; // sceneId the choice was made in
  c: string; // choiceId
  q: Quality;
}

export interface ScenarioState {
  sceneId: string | null; // null once ended
  endingId: string | null;
  vars: Record<string, number>;
  path: PathStep[];
  truncated: boolean;
}

export const MAX_PATH = 200;

/** Compact 0|1|2 encoding for a Quality, used by suspendPayload/restoreState. */
export const QUALITY_CODES: Record<Quality, 0 | 1 | 2> = { best: 0, acceptable: 1, poor: 2 };
const CODE_TO_QUALITY: readonly Quality[] = ["best", "acceptable", "poor"];

export function initialState(config: BranchingConfigLike): ScenarioState {
  const vars: Record<string, number> = {};
  for (const v of config.variables) vars[v.id] = v.initial;
  return { sceneId: config.startSceneId, endingId: null, vars, path: [], truncated: false };
}

export function conditionMet(cond: Condition, vars: Record<string, number>): boolean {
  const val = vars[cond.variableId];
  if (val === undefined) return false;
  switch (cond.comparator) {
    case "gte":
      return cond.value !== undefined && val >= cond.value;
    case "lte":
      return cond.value !== undefined && val <= cond.value;
    case "between":
      return cond.min !== undefined && cond.max !== undefined && val >= cond.min && val <= cond.max;
    default:
      return false;
  }
}

function sceneById(config: BranchingConfigLike, id: string): Scene | undefined {
  return config.scenes.find((s) => s.id === id);
}

export function visibleChoices(config: BranchingConfigLike, state: ScenarioState): Choice[] {
  if (!state.sceneId) return [];
  const scene = sceneById(config, state.sceneId);
  if (!scene) return [];
  return scene.choices.filter((c) => !c.showIf || conditionMet(c.showIf, state.vars));
}

export function applyChoice(config: BranchingConfigLike, state: ScenarioState, choiceId: string): ScenarioState {
  const visible = visibleChoices(config, state);
  const choice = visible.find((c) => c.id === choiceId);
  if (!choice) throw new Error(`choice "${choiceId}" is not a visible choice in the current scene`);

  const currentSceneId = state.sceneId as string; // visibleChoices returned non-empty only if sceneId set
  const varsById = new Map(config.variables.map((v) => [v.id, v]));
  const vars = { ...state.vars };
  for (const ef of choice.effects) {
    const varDef = varsById.get(ef.variableId);
    if (!varDef) continue; // defensive: unknown variable ref — ignore, schema.ts prevents this at authoring time
    const current = vars[ef.variableId] ?? varDef.initial;
    vars[ef.variableId] = Math.min(varDef.max, Math.max(varDef.min, current + ef.delta));
  }

  let path = [...state.path, { s: currentSceneId, c: choice.id, q: choice.quality }];
  let truncated = state.truncated;
  if (path.length > MAX_PATH) {
    path = path.slice(path.length - MAX_PATH);
    truncated = true;
  }

  const [kind, target] = choice.goTo.split(":");
  const sceneId = kind === "scene" ? target : null;
  const endingId = kind === "ending" ? target : null;

  return { sceneId, endingId, vars, path, truncated };
}

export function scorePct(state: ScenarioState): number {
  if (state.path.length === 0) return 0;
  const sum = state.path.reduce((acc, step) => acc + QUALITY_WEIGHTS[step.q], 0);
  return Math.round((sum / state.path.length) * 100);
}

/**
 * Compact suspend-data shape. `path` entries are NOT stored as raw id
 * strings per step — with realistic ~10-char authoring ids, 200 steps of
 * `[sceneId, choiceId, qualityCode]` would run ~6KB, blowing well past
 * SCORM 1.2's 4096-char suspend_data limit. Instead `d` is a dedup
 * dictionary of every distinct scene/choice id referenced by the path
 * (first-seen order, shared between scenes and choices — a same-text
 * collision between a scene id and a choice id just reuses one dictionary
 * slot, which is harmless since each `p` entry's position tells restoreState
 * which category to validate it against). Each `p` entry is
 * `[sceneIdIndex, choiceIdIndex, qualityCode]` — indices into `d`. Since a
 * scene is revisited many times across a long/looping playthrough, this
 * keeps the payload compact regardless of path length.
 */
export interface SuspendPayload {
  v: 1;
  s: string | null;
  e: string | null;
  vars: Record<string, number>;
  d: string[];
  p: Array<[number, number, 0 | 1 | 2]>;
  t: boolean;
  b: number;
  c: boolean;
}

export function suspendPayload(state: ScenarioState, best: number, completed: boolean): SuspendPayload {
  const d: string[] = [];
  const indexOf = new Map<string, number>();
  const dedup = (id: string): number => {
    const existing = indexOf.get(id);
    if (existing !== undefined) return existing;
    const idx = d.length;
    d.push(id);
    indexOf.set(id, idx);
    return idx;
  };
  const p: Array<[number, number, 0 | 1 | 2]> = state.path.map((step) => [dedup(step.s), dedup(step.c), QUALITY_CODES[step.q]]);
  return {
    v: 1,
    s: state.sceneId,
    e: state.endingId,
    vars: state.vars,
    d,
    p,
    t: state.truncated,
    b: best,
    c: completed,
  };
}

export interface RestoredScenario {
  state: ScenarioState;
  best: number;
  completed: boolean;
}

/**
 * Defensive by design: any structural mismatch, id that no longer exists in
 * `config` (renamed/removed scene, ending, variable, or choice), wrong
 * version, or malformed shape returns null (never throws) so the runtime can
 * fall back to a fresh start rather than crash on stale suspend_data.
 */
export function restoreState(config: BranchingConfigLike, payload: unknown): RestoredScenario | null {
  try {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const p = payload as Record<string, unknown>;
    if (p.v !== 1) return null;

    const sceneIds = new Set(config.scenes.map((s) => s.id));
    const endingIds = new Set(config.endings.map((e) => e.id));
    const varIds = new Set(config.variables.map((v) => v.id));

    const s = p.s;
    if (s !== null && (typeof s !== "string" || !sceneIds.has(s))) return null;
    const e = p.e;
    if (e !== null && (typeof e !== "string" || !endingIds.has(e))) return null;
    // exactly one of sceneId/endingId is active: mid-scenario xor ended
    if ((s === null) === (e === null)) return null;

    const varsRaw = p.vars;
    if (!varsRaw || typeof varsRaw !== "object" || Array.isArray(varsRaw)) return null;
    const varsObj = varsRaw as Record<string, unknown>;
    if (Object.keys(varsObj).length !== varIds.size) return null;
    const vars: Record<string, number> = {};
    for (const vid of varIds) {
      const val = varsObj[vid];
      if (typeof val !== "number" || !Number.isFinite(val)) return null;
      vars[vid] = val;
    }

    const dictRaw = p.d;
    if (!Array.isArray(dictRaw) || !dictRaw.every((x) => typeof x === "string")) return null;
    const dict = dictRaw as string[];

    const pathRaw = p.p;
    if (!Array.isArray(pathRaw)) return null;
    const choicesByScene = new Map<string, Set<string>>(config.scenes.map((sc) => [sc.id, new Set(sc.choices.map((c) => c.id))]));
    const path: PathStep[] = [];
    for (const step of pathRaw) {
      if (!Array.isArray(step) || step.length !== 3) return null;
      const [sceneIdx, choiceIdx, qCode] = step as [unknown, unknown, unknown];
      if (typeof sceneIdx !== "number" || !Number.isInteger(sceneIdx) || sceneIdx < 0 || sceneIdx >= dict.length) return null;
      if (typeof choiceIdx !== "number" || !Number.isInteger(choiceIdx) || choiceIdx < 0 || choiceIdx >= dict.length) return null;
      const stepSceneId = dict[sceneIdx];
      const stepChoiceId = dict[choiceIdx];
      const choiceIds = choicesByScene.get(stepSceneId);
      if (!choiceIds || !choiceIds.has(stepChoiceId)) return null;
      if (qCode !== 0 && qCode !== 1 && qCode !== 2) return null;
      path.push({ s: stepSceneId, c: stepChoiceId, q: CODE_TO_QUALITY[qCode] });
    }

    if (typeof p.t !== "boolean") return null;
    if (typeof p.b !== "number" || !Number.isFinite(p.b)) return null;
    if (typeof p.c !== "boolean") return null;

    return {
      state: { sceneId: s as string | null, endingId: e as string | null, vars, path, truncated: p.t },
      best: p.b,
      completed: p.c,
    };
  } catch {
    return null;
  }
}
