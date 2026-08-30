import { describe, it, expect } from "vitest";
import {
  initialState,
  openCaseFile,
  reviewArtifact,
  addToCaseFile,
  removeFromCaseFile,
  goToConclude,
  backToWorkspace,
  chooseConclusion,
  toggleReason,
  submit,
  startOver,
  suspendPayload,
  restoreState,
  type CaseState,
  type CaseStateConfigLike,
} from "@/lib/engines/case-workspace/state";

// Structural fixture (state.ts is a light, zero-zod module — its input is
// CaseStateConfigLike, which a validated CaseConfig structurally satisfies).
const config: CaseStateConfigLike = {
  scoringMode: "best-supported",
  artifacts: [{ id: "memo" }, { id: "log" }, { id: "photo" }],
  conclusions: [
    {
      id: "equipment_failure",
      credit: "full",
      reasons: [
        { id: "r_sound1", sound: true },
        { id: "r_flaw1", sound: false },
      ],
    },
    {
      id: "operator_error",
      credit: "none",
      reasons: [
        { id: "r_sound2", sound: true },
        { id: "r_flaw2", sound: false },
      ],
    },
  ],
  expertMap: [
    { artifactId: "memo", conclusionId: "equipment_failure", role: "supports" },
    { artifactId: "log", conclusionId: "operator_error", role: "supports" },
  ],
};

describe("initialState", () => {
  it("starts at the brief step with everything empty", () => {
    const s = initialState();
    expect(s.step).toBe("brief");
    expect(s.caseFile).toEqual([]);
    expect(s.reviewed.size).toBe(0);
    expect(s.chosen).toBeUndefined();
    expect(s.selectedReasons.size).toBe(0);
    expect(s.bestPct).toBe(0);
    expect(s.completed).toBe(false);
    expect(s.scoreReported).toBe(false);
  });
});

describe("openCaseFile", () => {
  it("transitions brief -> workspace", () => {
    expect(openCaseFile(initialState()).step).toBe("workspace");
  });
});

describe("reviewArtifact", () => {
  it("adds the artifact to the reviewed set", () => {
    const s = reviewArtifact(config, initialState(), "memo");
    expect(s.reviewed.has("memo")).toBe(true);
  });

  it("is idempotent — reviewing the same artifact twice keeps the set at size 1", () => {
    let s = reviewArtifact(config, initialState(), "memo");
    s = reviewArtifact(config, s, "memo");
    expect(s.reviewed.size).toBe(1);
  });

  it("does not mutate the input state's reviewed set", () => {
    const s0 = initialState();
    reviewArtifact(config, s0, "memo");
    expect(s0.reviewed.size).toBe(0);
  });

  it("throws naming the artifact for an unknown artifact id", () => {
    expect(() => reviewArtifact(config, initialState(), "nope")).toThrow(/nope/);
  });
});

describe("addToCaseFile / removeFromCaseFile", () => {
  it("adds an artifact with its strength", () => {
    const s = addToCaseFile(config, initialState(), "memo", "strong");
    expect(s.caseFile).toEqual([["memo", "strong"]]);
  });

  it("re-adding the same artifact replaces its strength rather than duplicating the entry", () => {
    let s = addToCaseFile(config, initialState(), "memo", "strong");
    s = addToCaseFile(config, s, "memo", "weak");
    expect(s.caseFile).toEqual([["memo", "weak"]]);
  });

  it("supports multiple distinct artifacts", () => {
    let s = addToCaseFile(config, initialState(), "memo", "strong");
    s = addToCaseFile(config, s, "log", "weak");
    expect(s.caseFile).toEqual([["memo", "strong"], ["log", "weak"]]);
  });

  it("throws naming the artifact for an unknown artifact id", () => {
    expect(() => addToCaseFile(config, initialState(), "nope", "strong")).toThrow(/nope/);
  });

  it("removeFromCaseFile removes the entry", () => {
    let s = addToCaseFile(config, initialState(), "memo", "strong");
    s = removeFromCaseFile(s, "memo");
    expect(s.caseFile).toEqual([]);
  });

  it("removeFromCaseFile is a no-op when the artifact isn't in the case file", () => {
    const s = removeFromCaseFile(initialState(), "memo");
    expect(s.caseFile).toEqual([]);
  });

  it("does not mutate the input state's caseFile array", () => {
    const s0 = addToCaseFile(config, initialState(), "memo", "strong");
    const snapshot = [...s0.caseFile];
    addToCaseFile(config, s0, "log", "weak");
    removeFromCaseFile(s0, "memo");
    expect(s0.caseFile).toEqual(snapshot);
  });
});

describe("goToConclude / backToWorkspace", () => {
  it("goToConclude transitions workspace -> conclude", () => {
    expect(goToConclude(openCaseFile(initialState())).step).toBe("conclude");
  });

  it("backToWorkspace transitions conclude -> workspace", () => {
    const s = goToConclude(openCaseFile(initialState()));
    expect(backToWorkspace(s).step).toBe("workspace");
  });
});

describe("chooseConclusion", () => {
  it("sets chosen and starts with an empty reason selection", () => {
    const s = chooseConclusion(config, initialState(), "equipment_failure");
    expect(s.chosen).toBe("equipment_failure");
    expect(s.selectedReasons.size).toBe(0);
  });

  it("changing the chosen conclusion resets any already-selected reasons", () => {
    let s = chooseConclusion(config, initialState(), "equipment_failure");
    s = toggleReason(config, s, "r_sound1");
    expect(s.selectedReasons.size).toBe(1);
    s = chooseConclusion(config, s, "operator_error");
    expect(s.chosen).toBe("operator_error");
    expect(s.selectedReasons.size).toBe(0);
  });

  it("reselecting the SAME conclusion is a no-op that preserves selected reasons", () => {
    let s = chooseConclusion(config, initialState(), "equipment_failure");
    s = toggleReason(config, s, "r_sound1");
    const reselected = chooseConclusion(config, s, "equipment_failure");
    expect(reselected).toBe(s); // same reference: true no-op
    expect(reselected.selectedReasons.has("r_sound1")).toBe(true);
  });

  it("throws naming the conclusion for an unknown conclusion id", () => {
    expect(() => chooseConclusion(config, initialState(), "nope")).toThrow(/nope/);
  });
});

describe("toggleReason", () => {
  it("adds a reason id on first toggle and removes it on second toggle", () => {
    let s = chooseConclusion(config, initialState(), "equipment_failure");
    s = toggleReason(config, s, "r_sound1");
    expect(s.selectedReasons.has("r_sound1")).toBe(true);
    s = toggleReason(config, s, "r_sound1");
    expect(s.selectedReasons.has("r_sound1")).toBe(false);
  });

  it("throws when no conclusion has been chosen yet", () => {
    expect(() => toggleReason(config, initialState(), "r_sound1")).toThrow(/chosen conclusion/);
  });

  it("throws naming the reason when it does not belong to the chosen conclusion", () => {
    const s = chooseConclusion(config, initialState(), "equipment_failure");
    expect(() => toggleReason(config, s, "r_sound2")).toThrow(/r_sound2/);
  });
});

describe("submit", () => {
  function atConclude(chosenId: string, reasonIds: string[]): CaseState {
    let s = goToConclude(openCaseFile(initialState()));
    s = chooseConclusion(config, s, chosenId);
    for (const id of reasonIds) s = toggleReason(config, s, id);
    return s;
  }

  it("throws when no conclusion is chosen", () => {
    expect(() => submit(config, goToConclude(openCaseFile(initialState())))).toThrow(/chosen conclusion/);
  });

  it("throws when no reason is selected (submit gate, spec review #17)", () => {
    const s = chooseConclusion(config, goToConclude(openCaseFile(initialState())), "equipment_failure");
    expect(() => submit(config, s)).toThrow(/at least one selected reason/);
  });

  it("transitions to debrief, marks completed, and reports scoreReported=true", () => {
    const s = atConclude("equipment_failure", ["r_sound1"]);
    const { state } = submit(config, s);
    expect(state.step).toBe("debrief");
    expect(state.completed).toBe(true);
    expect(state.scoreReported).toBe(true);
  });

  it("returns the score computed via scoreCase for the chosen conclusion/case-file/reasons", () => {
    let s = atConclude("equipment_failure", ["r_sound1"]);
    s = addToCaseFile(config, s, "memo", "strong");
    const { score } = submit(config, s);
    expect(score.evidence).toEqual({ num: 1, den: 1 });
    expect(score.reason).toEqual({ num: 1, den: 1 });
    expect(score.credit).toBe("full");
    expect(score.totalPct).toBe(100);
  });

  it("bestPct is high-water: a later lower-scoring submit does not lower it", () => {
    let s1 = atConclude("equipment_failure", ["r_sound1"]);
    s1 = addToCaseFile(config, s1, "memo", "strong");
    const first = submit(config, s1);
    expect(first.score.totalPct).toBe(100);
    expect(first.state.bestPct).toBe(100);

    // Start over, then submit a deliberately worse attempt.
    const restarted = startOver(first.state);
    let s2 = atConclude("operator_error", ["r_sound2"]); // credit "none" -> best-supported score well under 100
    s2 = { ...s2, bestPct: restarted.bestPct, completed: restarted.completed };
    const second = submit(config, s2);
    expect(second.score.totalPct).toBeLessThan(100);
    expect(second.state.bestPct).toBe(100); // preserved, not overwritten downward
  });
});

describe("startOver", () => {
  it("resets step/caseFile/reviewed/chosen/selectedReasons/scoreReported but preserves bestPct and completed", () => {
    let s = atConcludeHelper();
    s = { ...s, bestPct: 77, completed: true, scoreReported: true };
    const reset = startOver(s);
    expect(reset.step).toBe("brief");
    expect(reset.caseFile).toEqual([]);
    expect(reset.reviewed.size).toBe(0);
    expect(reset.chosen).toBeUndefined();
    expect(reset.selectedReasons.size).toBe(0);
    expect(reset.scoreReported).toBe(false);
    expect(reset.bestPct).toBe(77); // high-water preserved
    expect(reset.completed).toBe(true); // never revoked
  });

  function atConcludeHelper(): CaseState {
    let s = addToCaseFile(config, reviewArtifact(config, openCaseFile(initialState()), "memo"), "memo", "strong");
    s = chooseConclusion(config, goToConclude(s), "equipment_failure");
    return toggleReason(config, s, "r_sound1");
  }
});

describe("suspendPayload / restoreState round trip", () => {
  it("round-trips a mid-workspace state (no chosen conclusion)", () => {
    let s = openCaseFile(initialState());
    s = reviewArtifact(config, s, "memo");
    s = addToCaseFile(config, s, "memo", "strong");
    s = addToCaseFile(config, s, "log", "weak");

    const payload = suspendPayload(s);
    expect(payload).toEqual({
      v: 1,
      cf: [["memo", "strong"], ["log", "weak"]],
      rv: ["memo"],
      sel: [],
      b: 0,
      c: false,
      step: "workspace",
    });
    expect(payload.ch).toBeUndefined();

    const restored = restoreState(config, payload);
    expect(restored).not.toBeNull();
    expect(restored?.step).toBe("workspace");
    expect(restored?.caseFile).toEqual(s.caseFile);
    expect(restored?.reviewed).toEqual(s.reviewed);
    expect(restored?.chosen).toBeUndefined();
    expect(restored?.scoreReported).toBe(false);
  });

  it("round-trips a mid-conclude state with a chosen conclusion and selected reasons", () => {
    let s = chooseConclusion(config, goToConclude(openCaseFile(initialState())), "equipment_failure");
    s = toggleReason(config, s, "r_sound1");

    const payload = suspendPayload(s);
    expect(payload.ch).toBe("equipment_failure");
    expect(payload.sel).toEqual(["r_sound1"]);

    const restored = restoreState(config, payload);
    expect(restored?.chosen).toBe("equipment_failure");
    expect(restored?.selectedReasons).toEqual(new Set(["r_sound1"]));
    expect(restored?.step).toBe("conclude");
  });

  it("round-trips a debrief/completed state", () => {
    const s = atConcludeAndSubmit();
    const payload = suspendPayload(s);
    expect(payload.c).toBe(true);
    expect(payload.step).toBe("debrief");

    const restored = restoreState(config, payload);
    expect(restored?.completed).toBe(true);
    expect(restored?.step).toBe("debrief");
    expect(restored?.scoreReported).toBe(false); // session-local, never persisted
  });

  function atConcludeAndSubmit(): CaseState {
    let s = chooseConclusion(config, goToConclude(openCaseFile(initialState())), "equipment_failure");
    s = addToCaseFile(config, s, "memo", "strong");
    s = toggleReason(config, s, "r_sound1");
    return submit(config, s).state;
  }

  it("round-trips the empty initial state", () => {
    const payload = suspendPayload(initialState());
    const restored = restoreState(config, payload);
    expect(restored).toEqual(initialState());
  });

  it("returns null for a wrong version", () => {
    const payload = { v: 2, cf: [], rv: [], sel: [], b: 0, c: false, step: "brief" };
    expect(restoreState(config, payload)).toBeNull();
  });

  it("returns null for an unknown step string", () => {
    const payload = { v: 1, cf: [], rv: [], sel: [], b: 0, c: false, step: "nowhere" };
    expect(restoreState(config, payload)).toBeNull();
  });

  it("returns null for an unknown artifact id in the case file", () => {
    const payload = { v: 1, cf: [["not-a-real-artifact", "strong"]], rv: [], sel: [], b: 0, c: false, step: "workspace" };
    expect(restoreState(config, payload)).toBeNull();
  });

  it("returns null for an invalid strength value in the case file", () => {
    const payload = { v: 1, cf: [["memo", "medium"]], rv: [], sel: [], b: 0, c: false, step: "workspace" };
    expect(restoreState(config, payload)).toBeNull();
  });

  it("returns null for a duplicate artifact entry in the case file", () => {
    const payload = { v: 1, cf: [["memo", "strong"], ["memo", "weak"]], rv: [], sel: [], b: 0, c: false, step: "workspace" };
    expect(restoreState(config, payload)).toBeNull();
  });

  it("returns null for an unknown artifact id in the reviewed list", () => {
    const payload = { v: 1, cf: [], rv: ["not-a-real-artifact"], sel: [], b: 0, c: false, step: "workspace" };
    expect(restoreState(config, payload)).toBeNull();
  });

  it("returns null for an unknown conclusion id in ch", () => {
    const payload = { v: 1, cf: [], rv: [], ch: "not-a-real-conclusion", sel: [], b: 0, c: false, step: "conclude" };
    expect(restoreState(config, payload)).toBeNull();
  });

  it("returns null for a reason id that does not belong to the chosen conclusion", () => {
    const payload = { v: 1, cf: [], rv: [], ch: "equipment_failure", sel: ["r_sound2"], b: 0, c: false, step: "conclude" };
    expect(restoreState(config, payload)).toBeNull();
  });

  it("returns null for selected reasons present with NO chosen conclusion", () => {
    const payload = { v: 1, cf: [], rv: [], sel: ["r_sound1"], b: 0, c: false, step: "conclude" };
    expect(restoreState(config, payload)).toBeNull();
  });

  // F1/F3 (review, hostile suspend data): the submit gate (a chosen
  // conclusion AND at least one selected reason, enforced by submit() above)
  // must also hold on RESTORE — a step:"debrief" payload can only ever have
  // been produced by a real submit() call, so one missing either half is
  // necessarily forged/corrupted, not a legitimately-reachable resume state.
  it("returns null for step:debrief with NO chosen conclusion at all", () => {
    const payload = { v: 1, cf: [], rv: [], sel: [], b: 0, c: false, step: "debrief" };
    expect(restoreState(config, payload)).toBeNull();
  });

  it("returns null for step:debrief with a valid chosen conclusion but an EMPTY reason selection", () => {
    const payload = { v: 1, cf: [], rv: [], ch: "equipment_failure", sel: [], b: 0, c: false, step: "debrief" };
    expect(restoreState(config, payload)).toBeNull();
  });

  it("still accepts step:debrief with a valid chosen conclusion AND a non-empty reason selection", () => {
    const payload = { v: 1, cf: [], rv: [], ch: "equipment_failure", sel: ["r_sound1"], b: 40, c: true, step: "debrief" };
    const restored = restoreState(config, payload);
    expect(restored).not.toBeNull();
    expect(restored?.step).toBe("debrief");
    expect(restored?.chosen).toBe("equipment_failure");
  });

  it("clamps a restored best score (b) above 100 down to 100", () => {
    const payload = { v: 1, cf: [], rv: [], sel: [], b: 150, c: false, step: "brief" };
    const restored = restoreState(config, payload);
    expect(restored?.bestPct).toBe(100);
  });

  it("clamps a restored best score (b) below 0 up to 0", () => {
    const payload = { v: 1, cf: [], rv: [], sel: [], b: -10, c: false, step: "brief" };
    const restored = restoreState(config, payload);
    expect(restored?.bestPct).toBe(0);
  });

  it("returns null for malformed payloads (not an object, null, array, missing fields)", () => {
    expect(restoreState(config, null)).toBeNull();
    expect(restoreState(config, undefined)).toBeNull();
    expect(restoreState(config, "garbage")).toBeNull();
    expect(restoreState(config, [])).toBeNull();
    expect(restoreState(config, {})).toBeNull();
    expect(restoreState(config, { v: 1 })).toBeNull();
  });

  it("never throws even on wildly malformed input", () => {
    expect(() => restoreState(config, { v: 1, cf: "nope", rv: 5, sel: {}, b: "x", c: 1, step: 9 })).not.toThrow();
  });
});
