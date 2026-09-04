import { describe, it, expect } from "vitest";
import {
  initialState,
  beginProcedure,
  attemptAction,
  startOver,
  suspendPayload,
  restoreState,
  type ProcessState,
  type ProcessStateConfigLike,
} from "@/lib/engines/process-simulator/state";

// Structural fixture (state.ts is a light, zero-zod module — its input is
// ProcessStateConfigLike, which a validated ProcessConfig structurally
// satisfies). r3 conjunctively requires BOTH r1 and r2 -- exercises the
// "one-of-two prerequisites met is still illegal" rule for real.
const config: ProcessStateConfigLike = {
  actions: [
    { id: "r1", required: true },
    { id: "r2", required: true },
    { id: "r3", required: true, requires: ["r1", "r2"] },
    { id: "d1", required: false },
  ],
};

describe("initialState", () => {
  it("starts at brief with everything empty", () => {
    const s = initialState();
    expect(s.step).toBe("brief");
    expect(s.done).toEqual([]);
    expect(s.attempts.size).toBe(0);
    expect(s.bestPct).toBe(0);
    expect(s.completed).toBe(false);
    expect(s.scoreReported).toBe(false);
  });
});

describe("beginProcedure", () => {
  it("transitions brief -> procedure", () => {
    expect(beginProcedure(initialState()).step).toBe("procedure");
  });
});

describe("attemptAction — legality", () => {
  it("a prerequisite-free required action is legal from the start", () => {
    const s = beginProcedure(initialState());
    const result = attemptAction(config, s, "r1");
    expect(result.legal).toBe(true);
    expect(result.state.done).toEqual(["r1"]);
  });

  it("a required action with an unmet prerequisite is illegal and records an attempt", () => {
    const s = beginProcedure(initialState());
    const result = attemptAction(config, s, "r3");
    expect(result.legal).toBe(false);
    expect(result.state.attempts.get("r3")).toBe(1);
    expect(result.state.done).toEqual([]);
  });

  it("CONJUNCTIVE: one of two prerequisites met is STILL illegal", () => {
    let s = beginProcedure(initialState());
    s = attemptAction(config, s, "r1").state; // r1 done, r2 not
    const result = attemptAction(config, s, "r3"); // r3 requires [r1, r2] -- only r1 done
    expect(result.legal).toBe(false);
    expect(result.state.attempts.get("r3")).toBe(1);
  });

  it("becomes legal once ALL conjunctive prerequisites are done", () => {
    let s = beginProcedure(initialState());
    s = attemptAction(config, s, "r1").state;
    s = attemptAction(config, s, "r2").state;
    const result = attemptAction(config, s, "r3");
    expect(result.legal).toBe(true);
    expect(result.state.done).toEqual(["r1", "r2", "r3"]);
  });

  it("any distractor click is illegal, unconditionally", () => {
    const s = beginProcedure(initialState());
    const result = attemptAction(config, s, "d1");
    expect(result.legal).toBe(false);
    expect(result.state.attempts.get("d1")).toBe(1);
  });

  it("repeated illegal attempts accumulate on the same action", () => {
    let s = beginProcedure(initialState());
    s = attemptAction(config, s, "d1").state;
    s = attemptAction(config, s, "d1").state;
    s = attemptAction(config, s, "d1").state;
    expect(s.attempts.get("d1")).toBe(3);
  });

  it("throws for an unknown action id", () => {
    const s = beginProcedure(initialState());
    expect(() => attemptAction(config, s, "nope")).toThrow(/nope/);
  });

  it("throws for a re-click on an already-done action", () => {
    let s = beginProcedure(initialState());
    s = attemptAction(config, s, "r1").state;
    expect(() => attemptAction(config, s, "r1")).toThrow(/r1/);
  });

  it("does not mutate the input state's attempts map or done array", () => {
    const s0 = beginProcedure(initialState());
    attemptAction(config, s0, "d1");
    attemptAction(config, s0, "r1");
    expect(s0.attempts.size).toBe(0);
    expect(s0.done).toEqual([]);
  });
});

describe("attemptAction — 99-saturation (spec §4 review #3)", () => {
  it("saturates an illegal-attempt counter at 99 even after 120 clicks", () => {
    let s = beginProcedure(initialState());
    for (let i = 0; i < 120; i++) s = attemptAction(config, s, "d1").state;
    expect(s.attempts.get("d1")).toBe(99);
  });

  it("120 clicks vs exactly 99 clicks produce IDENTICAL scoring once the procedure completes", () => {
    function completeWith(distractorClicks: number): ProcessState {
      let s = beginProcedure(initialState());
      for (let i = 0; i < distractorClicks; i++) s = attemptAction(config, s, "d1").state;
      s = attemptAction(config, s, "r1").state;
      s = attemptAction(config, s, "r2").state;
      return attemptAction(config, s, "r3").state;
    }
    const at99 = completeWith(99);
    const at120 = completeWith(120);
    expect(at99.bestPct).toBe(at120.bestPct);
    expect(at99.attempts.get("d1")).toBe(99);
    expect(at120.attempts.get("d1")).toBe(99);
  });
});

describe("attemptAction — completion / debrief transition", () => {
  it("transitions to debrief and reports a score only on the attempt completing the LAST required action", () => {
    let s = beginProcedure(initialState());
    const mid = attemptAction(config, s, "r1");
    expect(mid.state.step).toBe("procedure");
    expect(mid.score).toBeUndefined();
    s = mid.state;
    const mid2 = attemptAction(config, s, "r2");
    expect(mid2.state.step).toBe("procedure");
    expect(mid2.score).toBeUndefined();
    s = mid2.state;
    const last = attemptAction(config, s, "r3");
    expect(last.state.step).toBe("debrief");
    expect(last.state.completed).toBe(true);
    expect(last.state.scoreReported).toBe(true);
    expect(last.score).toBeDefined();
    expect(last.score!.totalPct).toBe(100); // flawless: no illegal attempts anywhere
  });

  it("bestPct is high-water: a later lower-scoring completion does not lower it", () => {
    function completeFlawlessly(): ProcessState {
      let s = beginProcedure(initialState());
      s = attemptAction(config, s, "r1").state;
      s = attemptAction(config, s, "r2").state;
      return attemptAction(config, s, "r3").state;
    }
    const first = completeFlawlessly();
    expect(first.bestPct).toBe(100);

    const restarted = startOver(first);
    let s2 = beginProcedure(restarted);
    s2 = attemptAction(config, s2, "d1").state; // deliberate flail before finishing
    s2 = attemptAction(config, s2, "r1").state;
    s2 = attemptAction(config, s2, "r2").state;
    const second = attemptAction(config, s2, "r3");
    expect(second.score!.totalPct).toBeLessThan(100);
    expect(second.state.bestPct).toBe(100); // preserved, not overwritten downward
  });
});

describe("startOver", () => {
  it("resets step/done/attempts/scoreReported but preserves bestPct and completed", () => {
    let s = beginProcedure(initialState());
    s = attemptAction(config, s, "d1").state;
    s = attemptAction(config, s, "r1").state;
    s = { ...s, bestPct: 77, completed: true, scoreReported: true };
    const reset = startOver(s);
    expect(reset.step).toBe("brief");
    expect(reset.done).toEqual([]);
    expect(reset.attempts.size).toBe(0);
    expect(reset.scoreReported).toBe(false);
    expect(reset.bestPct).toBe(77);
    expect(reset.completed).toBe(true);
  });
});

describe("suspendPayload / restoreState round trip", () => {
  it("round-trips a fresh brief-step state", () => {
    const payload = suspendPayload(initialState());
    expect(payload).toEqual({ v: 1, done: [], at: [], b: 0, c: false, step: "brief" });
    const restored = restoreState(config, payload);
    expect(restored).toEqual(initialState());
  });

  it("round-trips a mid-procedure state with both done actions and illegal attempts", () => {
    let s = beginProcedure(initialState());
    s = attemptAction(config, s, "d1").state; // 1 illegal
    s = attemptAction(config, s, "r3").state; // illegal (prereqs unmet) -> another attempt on r3
    s = attemptAction(config, s, "r1").state; // legal

    const payload = suspendPayload(s);
    expect(payload.done).toEqual(["r1"]);
    expect([...payload.at].sort()).toEqual([["d1", 1], ["r3", 1]]);
    expect(payload.step).toBe("procedure");

    const restored = restoreState(config, payload);
    expect(restored).not.toBeNull();
    expect(restored?.done).toEqual(["r1"]);
    expect(restored?.attempts).toEqual(new Map([["d1", 1], ["r3", 1]]));
    expect(restored?.scoreReported).toBe(false);
  });

  it("round-trips a completed/debrief state", () => {
    let s = beginProcedure(initialState());
    s = attemptAction(config, s, "r1").state;
    s = attemptAction(config, s, "r2").state;
    s = attemptAction(config, s, "r3").state;
    const payload = suspendPayload(s);
    expect(payload.step).toBe("debrief");
    expect(payload.c).toBe(true);

    const restored = restoreState(config, payload);
    expect(restored?.step).toBe("debrief");
    expect(restored?.completed).toBe(true);
    expect(restored?.scoreReported).toBe(false); // session-local, never persisted
  });

  it("SUSPEND-PRESERVES-EFFICIENCY: grading is identical whether or not a suspend/restore cycle happens mid-run", () => {
    function completeWithoutSuspend(): ProcessState {
      let s = beginProcedure(initialState());
      s = attemptAction(config, s, "d1").state;
      s = attemptAction(config, s, "d1").state;
      s = attemptAction(config, s, "r1").state;
      s = attemptAction(config, s, "r2").state;
      return attemptAction(config, s, "r3").state;
    }
    function completeWithSuspend(): ProcessState {
      let s = beginProcedure(initialState());
      s = attemptAction(config, s, "d1").state;
      s = attemptAction(config, s, "d1").state;
      s = attemptAction(config, s, "r1").state;
      // Suspend and restore right here, mid-procedure.
      const payload = suspendPayload(s);
      const restored = restoreState(config, payload)!;
      s = attemptAction(config, restored, "r2").state;
      return attemptAction(config, s, "r3").state;
    }
    const noSuspend = completeWithoutSuspend();
    const withSuspend = completeWithSuspend();
    expect(withSuspend.bestPct).toBe(noSuspend.bestPct);
    expect(withSuspend.attempts.get("d1")).toBe(noSuspend.attempts.get("d1"));
  });
});

describe("restoreState — negative-fixture table (one row per §4 rejection)", () => {
  it("returns null for malformed payloads (not an object, null, array, missing fields)", () => {
    expect(restoreState(config, null)).toBeNull();
    expect(restoreState(config, undefined)).toBeNull();
    expect(restoreState(config, "garbage")).toBeNull();
    expect(restoreState(config, [])).toBeNull();
    expect(restoreState(config, {})).toBeNull();
  });

  it("returns null for a wrong version", () => {
    expect(restoreState(config, { v: 2, done: [], at: [], b: 0, c: false, step: "brief" })).toBeNull();
  });

  it("returns null for an unknown step string", () => {
    expect(restoreState(config, { v: 1, done: [], at: [], b: 0, c: false, step: "nowhere" })).toBeNull();
  });

  it("returns null for an unresolvable id in done", () => {
    expect(restoreState(config, { v: 1, done: ["not-a-real-action"], at: [], b: 0, c: false, step: "procedure" })).toBeNull();
  });

  it("returns null for a done entry naming a DISTRACTOR (done ⊄ required)", () => {
    expect(restoreState(config, { v: 1, done: ["d1"], at: [], b: 0, c: false, step: "procedure" })).toBeNull();
  });

  it("returns null for a duplicate id in done", () => {
    expect(restoreState(config, { v: 1, done: ["r1", "r1"], at: [], b: 0, c: false, step: "procedure" })).toBeNull();
  });

  it("returns null for a topological-replay violation (r3 done before its prerequisites)", () => {
    expect(restoreState(config, { v: 1, done: ["r3", "r1", "r2"], at: [], b: 0, c: false, step: "debrief" })).toBeNull();
  });

  it("returns null for a partial topological-replay violation (r1 done, then r3 before r2)", () => {
    expect(restoreState(config, { v: 1, done: ["r1", "r3"], at: [], b: 0, c: false, step: "procedure" })).toBeNull();
  });

  it("accepts a VALID topological order (r1, r2, r3)", () => {
    expect(restoreState(config, { v: 1, done: ["r1", "r2", "r3"], at: [], b: 100, c: true, step: "debrief" })).not.toBeNull();
  });

  it("returns null for an at-entry on a prerequisite-free REQUIRED action (unreachable by play)", () => {
    // r1 has no `requires` -- it can never be illegally attempted for real.
    expect(restoreState(config, { v: 1, done: [], at: [["r1", 1]], b: 0, c: false, step: "procedure" })).toBeNull();
  });

  it("accepts an at-entry on a required action THAT DOES have prerequisites (r3)", () => {
    expect(restoreState(config, { v: 1, done: [], at: [["r3", 1]], b: 0, c: false, step: "procedure" })).not.toBeNull();
  });

  it("accepts an at-entry on a distractor", () => {
    expect(restoreState(config, { v: 1, done: [], at: [["d1", 5]], b: 0, c: false, step: "procedure" })).not.toBeNull();
  });

  it("returns null for an at-entry with an unresolvable action id", () => {
    expect(restoreState(config, { v: 1, done: [], at: [["nope", 1]], b: 0, c: false, step: "procedure" })).toBeNull();
  });

  it("returns null for a non-integer at count", () => {
    expect(restoreState(config, { v: 1, done: [], at: [["d1", 1.5]], b: 0, c: false, step: "procedure" })).toBeNull();
  });

  it("returns null for an at count of 0 (below the 1..99 range)", () => {
    expect(restoreState(config, { v: 1, done: [], at: [["d1", 0]], b: 0, c: false, step: "procedure" })).toBeNull();
  });

  it("returns null for a negative at count", () => {
    expect(restoreState(config, { v: 1, done: [], at: [["d1", -1]], b: 0, c: false, step: "procedure" })).toBeNull();
  });

  it("returns null for an at count of 100 (above the 1..99 range)", () => {
    expect(restoreState(config, { v: 1, done: [], at: [["d1", 100]], b: 0, c: false, step: "procedure" })).toBeNull();
  });

  it("accepts an at count of exactly 99 (the saturation ceiling)", () => {
    expect(restoreState(config, { v: 1, done: [], at: [["d1", 99]], b: 0, c: false, step: "procedure" })).not.toBeNull();
  });

  it("returns null for a non-numeric at count (string)", () => {
    expect(restoreState(config, { v: 1, done: [], at: [["d1", "99"]], b: 0, c: false, step: "procedure" })).toBeNull();
  });

  it('returns null for step:"debrief" with done not covering all required actions', () => {
    expect(restoreState(config, { v: 1, done: ["r1"], at: [], b: 0, c: false, step: "debrief" })).toBeNull();
  });

  it('returns null for a non-"debrief" step with done covering ALL required actions (would soft-lock)', () => {
    expect(restoreState(config, { v: 1, done: ["r1", "r2", "r3"], at: [], b: 0, c: false, step: "procedure" })).toBeNull();
  });

  it("clamps a restored best score (b) above 100 down to 100", () => {
    expect(restoreState(config, { v: 1, done: [], at: [], b: 150, c: false, step: "brief" })?.bestPct).toBe(100);
  });

  it("clamps a restored best score (b) below 0 up to 0", () => {
    expect(restoreState(config, { v: 1, done: [], at: [], b: -10, c: false, step: "brief" })?.bestPct).toBe(0);
  });

  it("never throws even on wildly malformed input", () => {
    expect(() => restoreState(config, { v: 1, done: "nope", at: 5, b: "x", c: 1, step: 9 })).not.toThrow();
  });
});

describe("suspend payload — worst-case length (spec §4: est. well under SCORM 1.2's 4096-char guard)", () => {
  it("measures the worst-case payload for a full 24-action config with 40-char ids, all non-clean", () => {
    // Schema worst case: 24 actions max, ids at the 40-char cap. Half
    // required (with a long prerequisite chain so `done` is full), half
    // distractors, EVERY action carrying a saturated (99) `at` entry.
    const pad = (prefix: string, i: number) => `${prefix}_${i}`.padEnd(40, "x");
    const requiredIds = Array.from({ length: 12 }, (_, i) => pad("required_action", i));
    const distractorIds = Array.from({ length: 12 }, (_, i) => pad("distractor_action", i));
    const worstConfig: ProcessStateConfigLike = {
      actions: [
        ...requiredIds.map((id, i) => ({ id, required: true, ...(i > 0 ? { requires: [requiredIds[i - 1]] } : {}) })),
        ...distractorIds.map((id) => ({ id, required: false })),
      ],
    };
    let s = beginProcedure(initialState());
    // Every required action fails once before being done (so it carries an
    // `at` entry too, except the first which has no prerequisite to fail on
    // -- restoreState forbids that combination, and real play can't produce
    // it either); every distractor is clicked to saturation.
    for (let i = 1; i < requiredIds.length; i++) {
      s = attemptAction(worstConfig, s, requiredIds[i]).state; // illegal: prereq not yet done
    }
    for (const id of requiredIds) s = attemptAction(worstConfig, s, id).state; // legal, in order
    for (const id of distractorIds) {
      for (let i = 0; i < 99; i++) s = attemptAction(worstConfig, s, id).state;
    }

    // Measured worst-case payload: 1665 bytes (well under SCORM 1.2's
    // 4096-char suspend_data guard) — locked so this fixture regresses
    // loudly if the payload shape ever grows.
    const payload = suspendPayload(s);
    const json = JSON.stringify(payload);
    expect(json.length).toBe(1665);
    expect(json.length).toBeLessThan(4096);
  });
});
