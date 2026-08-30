/**
 * Pure state machine, zero DOM, zero heavy deps — importable by the engine
 * runtime bundle (Task 5) as well as by editor/preview code and tests.
 * Mirrors branching-scenario/state.ts's role and defensive-restore style,
 * but the case workspace's suspend payload is id-based with NO dedup
 * dictionary (spec §4 review #8: the case file is a bounded set, nothing
 * repeats, so a dictionary would only add bytes/complexity for no benefit).
 */

import { scoreCase, type CaseConfigLike, type CaseScoreResult } from "./scoring";

export type Strength = "strong" | "weak";
export type Step = "brief" | "workspace" | "conclude" | "debrief";

export type CaseArtifactLike = { id: string };

/** Structural config shape state.ts needs: scoring.ts's CaseConfigLike
 *  (scoringMode/conclusions/expertMap) plus the artifact id list that
 *  scoring itself doesn't need but restoreState/addToCaseFile/reviewArtifact
 *  do. schema.ts's `CaseConfig` (a z.infer) structurally satisfies this. */
export type CaseStateConfigLike = CaseConfigLike & { artifacts: CaseArtifactLike[] };

export interface CaseState {
  step: Step;
  /** [artifactId, strength] pairs, at most one entry per artifact. */
  caseFile: Array<[string, Strength]>;
  /** Artifacts opened at least once — persisted, glyph-only, never scored. */
  reviewed: Set<string>;
  chosen?: string;
  selectedReasons: Set<string>;
  /** High-water SCORM score — never decreases (spec §4). */
  bestPct: number;
  /** High-water SCORM completion — never revoked (spec §4). */
  completed: boolean;
  /**
   * Session-local (NOT persisted in suspendPayload/restoreState — always
   * false immediately after a restore): whether the runtime has already
   * called setScore/setCompleted for the most recent submit, so it does not
   * re-invoke the SCORM adapter on every re-render of the same debrief.
   * `completed`/`bestPct` are the durable SCORM-facing values; this flag is
   * a runtime bookkeeping detail scoped to the current page load.
   */
  scoreReported: boolean;
}

export function initialState(): CaseState {
  return {
    step: "brief",
    caseFile: [],
    reviewed: new Set(),
    chosen: undefined,
    selectedReasons: new Set(),
    bestPct: 0,
    completed: false,
    scoreReported: false,
  };
}

export function openCaseFile(state: CaseState): CaseState {
  return { ...state, step: "workspace" };
}

export function reviewArtifact(config: CaseStateConfigLike, state: CaseState, artifactId: string): CaseState {
  if (!config.artifacts.some((a) => a.id === artifactId)) throw new Error(`artifact "${artifactId}" does not exist`);
  if (state.reviewed.has(artifactId)) return state;
  const reviewed = new Set(state.reviewed);
  reviewed.add(artifactId);
  return { ...state, reviewed };
}

/** Adds (or, if already present, re-strengths) an artifact in the case
 *  file. At most one entry per artifact — matches the runtime's two
 *  explicit add buttons swapping to "Remove" once included (spec §3). */
export function addToCaseFile(config: CaseStateConfigLike, state: CaseState, artifactId: string, strength: Strength): CaseState {
  if (!config.artifacts.some((a) => a.id === artifactId)) throw new Error(`artifact "${artifactId}" does not exist`);
  const caseFile = state.caseFile.filter(([id]) => id !== artifactId);
  caseFile.push([artifactId, strength]);
  return { ...state, caseFile };
}

/** No-op (aside from a fresh array) when the artifact isn't in the case
 *  file — mirrors branching rename.ts's no-op-on-absence philosophy. */
export function removeFromCaseFile(state: CaseState, artifactId: string): CaseState {
  return { ...state, caseFile: state.caseFile.filter(([id]) => id !== artifactId) };
}

export function goToConclude(state: CaseState): CaseState {
  return { ...state, step: "conclude" };
}

export function backToWorkspace(state: CaseState): CaseState {
  return { ...state, step: "workspace" };
}

/** Selecting a conclusion resets the reason selection ONLY when the
 *  conclusion actually changes (spec §3: "on conclusion change, selections
 *  reset") — reselecting the currently-chosen conclusion is a no-op that
 *  preserves whatever reasons are already checked. */
export function chooseConclusion(config: CaseStateConfigLike, state: CaseState, conclusionId: string): CaseState {
  if (!config.conclusions.some((c) => c.id === conclusionId)) throw new Error(`conclusion "${conclusionId}" does not exist`);
  if (state.chosen === conclusionId) return state;
  return { ...state, chosen: conclusionId, selectedReasons: new Set() };
}

export function toggleReason(config: CaseStateConfigLike, state: CaseState, reasonId: string): CaseState {
  if (!state.chosen) throw new Error("toggleReason requires a chosen conclusion");
  const conclusion = config.conclusions.find((c) => c.id === state.chosen);
  if (!conclusion || !conclusion.reasons.some((r) => r.id === reasonId)) {
    throw new Error(`reason "${reasonId}" does not belong to the chosen conclusion "${state.chosen}"`);
  }
  const selectedReasons = new Set(state.selectedReasons);
  if (selectedReasons.has(reasonId)) selectedReasons.delete(reasonId);
  else selectedReasons.add(reasonId);
  return { ...state, selectedReasons };
}

export interface SubmitResult {
  state: CaseState;
  score: CaseScoreResult;
}

/** Submit gate (spec §3 review #17): requires a chosen conclusion AND at
 *  least one selected reason. One submission per attempt — the runtime
 *  (Task 5) enforces that by transitioning to "debrief", which this
 *  function does as part of its result. */
export function submit(config: CaseStateConfigLike, state: CaseState): SubmitResult {
  if (!state.chosen) throw new Error("submit requires a chosen conclusion");
  if (state.selectedReasons.size === 0) throw new Error("submit requires at least one selected reason");
  const includedIds = state.caseFile.map(([id]) => id);
  const score = scoreCase(config, state.chosen, includedIds, [...state.selectedReasons]);
  const bestPct = Math.max(state.bestPct, score.totalPct);
  return {
    state: { ...state, step: "debrief", bestPct, completed: true, scoreReported: true },
    score,
  };
}

/** "Start over" (spec §4): resets the attempt (step, case file, reviewed
 *  set, chosen conclusion, reason selection) but preserves the high-water
 *  bestPct/completed — SCORM score is never re-written below bestPct and
 *  completion is never revoked. scoreReported resets because it is
 *  session-local bookkeeping for the debrief just left, not a durable
 *  SCORM value. */
export function startOver(state: CaseState): CaseState {
  return {
    step: "brief",
    caseFile: [],
    reviewed: new Set(),
    chosen: undefined,
    selectedReasons: new Set(),
    bestPct: state.bestPct,
    completed: state.completed,
    scoreReported: false,
  };
}

/**
 * Suspend payload shape (spec §4, exact): `{v, cf:[[artifactId,strength]],
 * rv:[artifactId], ch?, sel:[reasonId], b, c, step}`. No dedup dictionary —
 * unlike branching's path (which can revisit the same scene/choice
 * hundreds of times), the case file/reviewed/reasons sets are each bounded
 * by the schema's caps (<=16 artifacts, <=6 reasons per conclusion), so a
 * dictionary would only add bytes. Measured worst case is well under
 * SCORM 1.2's 4096-char suspend_data limit (spec §4: "measured worst case
 * ~1.2KB").
 */
export interface SuspendPayload {
  v: 1;
  cf: Array<[string, Strength]>;
  rv: string[];
  ch?: string;
  sel: string[];
  b: number;
  c: boolean;
  step: Step;
}

export function suspendPayload(state: CaseState): SuspendPayload {
  const payload: SuspendPayload = {
    v: 1,
    cf: state.caseFile.map(([id, strength]) => [id, strength]),
    rv: [...state.reviewed],
    sel: [...state.selectedReasons],
    b: state.bestPct,
    c: state.completed,
    step: state.step,
  };
  if (state.chosen !== undefined) payload.ch = state.chosen;
  return payload;
}

const VALID_STEPS: readonly Step[] = ["brief", "workspace", "conclude", "debrief"];

/**
 * Defensive by design: any structural mismatch, id that no longer exists in
 * `config` (renamed/removed artifact, conclusion, or reason), wrong
 * version, or malformed shape returns null (never throws) so the runtime
 * can fall back to a fresh start — matches branching-scenario/state.ts's
 * restoreState contract exactly. `scoreReported` is always initialized to
 * false on restore (see the CaseState doc comment: it is session-local,
 * never carried in the payload).
 */
export function restoreState(config: CaseStateConfigLike, payload: unknown): CaseState | null {
  try {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const p = payload as Record<string, unknown>;
    if (p.v !== 1) return null;

    if (typeof p.step !== "string" || !VALID_STEPS.includes(p.step as Step)) return null;
    const step = p.step as Step;

    const artifactIds = new Set(config.artifacts.map((a) => a.id));
    const conclusionsById = new Map(config.conclusions.map((c) => [c.id, c]));

    if (!Array.isArray(p.cf)) return null;
    const caseFile: Array<[string, Strength]> = [];
    const seenArtifacts = new Set<string>();
    for (const entry of p.cf) {
      if (!Array.isArray(entry) || entry.length !== 2) return null;
      const [id, strength] = entry as [unknown, unknown];
      if (typeof id !== "string" || !artifactIds.has(id)) return null;
      if (strength !== "strong" && strength !== "weak") return null;
      if (seenArtifacts.has(id)) return null; // the case file is a set: no artifact twice
      seenArtifacts.add(id);
      caseFile.push([id, strength]);
    }

    if (!Array.isArray(p.rv) || !p.rv.every((x) => typeof x === "string" && artifactIds.has(x))) return null;
    const reviewed = new Set(p.rv as string[]);

    let chosen: string | undefined;
    if (p.ch !== undefined) {
      if (typeof p.ch !== "string" || !conclusionsById.has(p.ch)) return null;
      chosen = p.ch;
    }

    if (!Array.isArray(p.sel) || !p.sel.every((x) => typeof x === "string")) return null;
    const selRaw = p.sel as string[];
    if (selRaw.length > 0) {
      // Selections without a chosen conclusion are structurally invalid —
      // reason ids are scoped per-conclusion (like branching's choice ids
      // scoped per-scene), so there is nothing to validate them against.
      if (!chosen) return null;
      const reasonIds = new Set(conclusionsById.get(chosen)!.reasons.map((r) => r.id));
      if (!selRaw.every((id) => reasonIds.has(id))) return null;
    }
    const selectedReasons = new Set(selRaw);

    // Review F1/F3 (hostile suspend data): a step:"debrief" payload can only
    // ever have been produced by a real submit() call, which enforces the
    // submit gate (a chosen conclusion AND at least one selected reason,
    // spec §3 review #17) before transitioning there. A debrief payload
    // missing either half is therefore necessarily forged/corrupted, not a
    // legitimately-reachable resume state -- reject it here rather than
    // handing the runtime a debrief render with no chosen conclusion to
    // score/display.
    if (step === "debrief" && (!chosen || selRaw.length === 0)) return null;

    if (typeof p.b !== "number" || !Number.isFinite(p.b)) return null;
    const bestPct = Math.min(100, Math.max(0, p.b));

    if (typeof p.c !== "boolean") return null;

    return { step, caseFile, reviewed, chosen, selectedReasons, bestPct, completed: p.c, scoreReported: false };
  } catch {
    return null;
  }
}
