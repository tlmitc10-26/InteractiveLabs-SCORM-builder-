/**
 * Pure state machine, zero DOM, zero heavy deps — importable by the engine
 * runtime bundle (Task 3) as well as by editor/preview code and tests.
 * Mirrors case-workspace/state.ts's role and defensive-restore style. The
 * suspend payload is id-based with a small dedup dictionary for illegal-
 * attempt counts ONLY (the `at` map) — unlike the case file's id-set
 * payload, a procedure genuinely needs a per-action counter (spec §4).
 */

import { scoreProcess, type ProcessScoreResult } from "./scoring";

export type Step = "brief" | "procedure" | "debrief";

export type ProcessStateAction = { id: string; required: boolean; requires?: string[] };

/** Structural config shape state.ts needs: id/required (what scoring.ts's
 *  ProcessConfigLike needs too — this is a structural superset, so a
 *  ProcessStateConfigLike passes directly to scoreProcess without either
 *  module importing the other's types) plus each action's `requires` list,
 *  which scoring itself doesn't need but attemptAction/restoreState do.
 *  schema.ts's `ProcessConfig` (a z.infer) structurally satisfies this. */
export type ProcessStateConfigLike = { actions: ProcessStateAction[] };

export interface ProcessState {
  step: Step;
  /** Required-action ids, in the order they were legally completed. */
  done: string[];
  /**
   * Illegal-attempt counts keyed by action id — REQUIRED actions attempted
   * prematurely AND distractors clicked at all (spec §4's `failed(r)` /
   * `hits(d)`), one entry per action attempted illegally at least once.
   * All counters SATURATE AT 99 AT INCREMENT TIME (spec §4 review #3) —
   * `incrementAttempt` below is the only place a count is ever written, so
   * this invariant holds everywhere a ProcessState is constructed (fresh,
   * post-attempt, or restored).
   */
  attempts: Map<string, number>;
  /** High-water SCORM score — never decreases (spec §4). */
  bestPct: number;
  /** High-water SCORM completion — never revoked (spec §4). */
  completed: boolean;
  /** Session-local (NOT persisted in suspendPayload/restoreState — always
   *  false immediately after a restore): whether the runtime has already
   *  called setScore/setCompleted for the current debrief. Mirrors
   *  case-workspace/state.ts's CaseState.scoreReported exactly. */
  scoreReported: boolean;
}

export function initialState(): ProcessState {
  return { step: "brief", done: [], attempts: new Map(), bestPct: 0, completed: false, scoreReported: false };
}

export function beginProcedure(state: ProcessState): ProcessState {
  return { ...state, step: "procedure" };
}

/** Saturates at 99 at increment time (spec §4 review #3) — payload and
 *  in-memory state always agree, and scoring is path-independent regardless
 *  of how many times the 99th+ click happens. */
function incrementAttempt(attempts: ReadonlyMap<string, number>, actionId: string): Map<string, number> {
  const next = new Map(attempts);
  next.set(actionId, Math.min(99, (next.get(actionId) ?? 0) + 1));
  return next;
}

export interface AttemptResult {
  state: ProcessState;
  /** True when the action was legally performed (a required action whose
   *  prerequisites are all done); false for any illegal attempt (a
   *  premature required action or any distractor click). */
  legal: boolean;
  /** Present only on the attempt that completes the last required action —
   *  the step transitions to "debrief" here, mirroring case-workspace's
   *  submit() returning a score alongside its state. */
  score?: ProcessScoreResult;
}

/**
 * A single learner click on an action button (spec §3/§4). Throws for an
 * unknown action id or a re-click on an already-done action — both are
 * caller/runtime bugs (a done required action's button is disabled, so a
 * conformant runtime never re-attempts it), mirroring case-workspace/
 * state.ts's throw-on-misuse philosophy for out-of-contract calls.
 *
 * Legal iff `action.required` and every id in `action.requires` (if any)
 * is already in `state.done` (conjunctive — spec §4: one-of-two met is
 * still illegal). Any distractor click is unconditionally illegal — its own
 * `requires` (if authored) is never consulted, matching spec §3's failure
 * condition list exactly ("any distractor click").
 */
export function attemptAction(config: ProcessStateConfigLike, state: ProcessState, actionId: string): AttemptResult {
  const action = config.actions.find((a) => a.id === actionId);
  if (!action) throw new Error(`action "${actionId}" does not exist`);
  if (state.done.includes(actionId)) throw new Error(`action "${actionId}" is already done`);

  const legal = action.required && (action.requires ?? []).every((id) => state.done.includes(id));

  if (!legal) {
    return { state: { ...state, attempts: incrementAttempt(state.attempts, actionId) }, legal: false };
  }

  const done = [...state.done, actionId];
  const totalRequired = config.actions.filter((a) => a.required).length;
  if (done.length < totalRequired) {
    return { state: { ...state, done }, legal: true };
  }

  // Last required action just completed -> debrief (spec §3: entered
  // automatically). Score using the attempts recorded so far (this legal
  // completion itself never counts as an illegal attempt).
  const score = scoreProcess(config, state.attempts);
  const bestPct = Math.max(state.bestPct, score.totalPct);
  return {
    state: { ...state, step: "debrief", done, bestPct, completed: true, scoreReported: true },
    legal: true,
    score,
  };
}

/** "Start over" (spec §3): resets the attempt (step, done, attempts) but
 *  preserves the high-water bestPct/completed — SCORM score is never
 *  re-written below bestPct and completion is never revoked. Mirrors
 *  case-workspace/state.ts's startOver exactly. */
export function startOver(state: ProcessState): ProcessState {
  return {
    step: "brief",
    done: [],
    attempts: new Map(),
    bestPct: state.bestPct,
    completed: state.completed,
    scoreReported: false,
  };
}

/**
 * Suspend payload shape (spec §4, exact): `{v, done:[actionId in
 * completion order], at:[[actionId, count]], b, c, step}`. `at` carries one
 * entry per action attempted illegally at least once, REQUIRED and
 * DISTRACTOR alike (review #2: distractor hits persist across suspend, so
 * efficiency is identical with or without a resume — tested in
 * process-state.test.ts). Counts are 1..99 integers. Worst case (24 actions,
 * every non-clean action's id at the schema's 40-char cap) is measured and
 * asserted in tests, well under SCORM 1.2's 4096-char suspend_data guard.
 */
export interface SuspendPayload {
  v: 1;
  done: string[];
  at: Array<[string, number]>;
  b: number;
  c: boolean;
  step: Step;
}

export function suspendPayload(state: ProcessState): SuspendPayload {
  return {
    v: 1,
    done: [...state.done],
    at: [...state.attempts.entries()],
    b: state.bestPct,
    c: state.completed,
    step: state.step,
  };
}

const VALID_STEPS: readonly Step[] = ["brief", "procedure", "debrief"];

/**
 * Defensive by design: any structural mismatch, id that no longer exists in
 * `config`, wrong version, or malformed shape returns null (never throws)
 * so the runtime can fall back to a fresh start — matches case-workspace/
 * state.ts's restoreState contract exactly. Implements EVERY §4 rejection
 * row:
 *  - every id (`done` and `at`) resolves against `config`;
 *  - `done` ⊆ required ids, with NO duplicates;
 *  - topological replay: walking `done` left to right, the first id whose
 *    `requires` are not already all in the preceding prefix is rejected;
 *  - `at` ids resolve; counts are INTEGERS 1..99;
 *  - an `at` entry on a prerequisite-free REQUIRED action is rejected — it
 *    has no prerequisite to violate, so it can never be illegally attempted
 *    by real play (unreachable, per spec §4);
 *  - `step:"debrief"` with `done` ≠ all-required is rejected;
 *  - a NON-debrief step with `done` = all-required is rejected (would
 *    soft-lock a room with every button disabled).
 * `scoreReported` is always initialized to false on restore (session-local,
 * never carried in the payload).
 */
export function restoreState(config: ProcessStateConfigLike, payload: unknown): ProcessState | null {
  try {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const p = payload as Record<string, unknown>;
    if (p.v !== 1) return null;

    if (typeof p.step !== "string" || !VALID_STEPS.includes(p.step as Step)) return null;
    const step = p.step as Step;

    const byId = new Map(config.actions.map((a) => [a.id, a]));
    const requiredIds = new Set(config.actions.filter((a) => a.required).map((a) => a.id));

    if (!Array.isArray(p.done) || !p.done.every((x) => typeof x === "string")) return null;
    const doneRaw = p.done as string[];

    const seenDone = new Set<string>();
    for (const id of doneRaw) {
      if (!requiredIds.has(id)) return null; // must resolve AND be required
      if (seenDone.has(id)) return null; // no duplicates
      seenDone.add(id);
    }

    // Topological replay: reject the first id whose prerequisites are not
    // already all satisfied by the preceding prefix.
    const prefix = new Set<string>();
    for (const id of doneRaw) {
      const action = byId.get(id)!;
      const reqs = action.requires ?? [];
      if (!reqs.every((r) => prefix.has(r))) return null;
      prefix.add(id);
    }
    const done = [...doneRaw];

    if (!Array.isArray(p.at)) return null;
    const attempts = new Map<string, number>();
    for (const entry of p.at) {
      if (!Array.isArray(entry) || entry.length !== 2) return null;
      const [id, count] = entry as [unknown, unknown];
      if (typeof id !== "string" || !byId.has(id)) return null;
      if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 99) return null;
      if (attempts.has(id)) return null; // duplicate `at` entry -- not producible by real play
      const action = byId.get(id)!;
      // A prerequisite-free required action has no prerequisite to violate
      // and is otherwise always legal to attempt until done -- an `at`
      // entry naming one is unreachable by real play (spec §4).
      if (action.required && (!action.requires || action.requires.length === 0)) return null;
      attempts.set(id, count);
    }

    const allRequiredDone = done.length === requiredIds.size;
    if (step === "debrief" && !allRequiredDone) return null;
    if (step !== "debrief" && allRequiredDone) return null;

    if (typeof p.b !== "number" || !Number.isFinite(p.b)) return null;
    const bestPct = Math.min(100, Math.max(0, p.b));

    if (typeof p.c !== "boolean") return null;

    return { step, done, attempts, bestPct, completed: p.c, scoreReported: false };
  } catch {
    return null;
  }
}
