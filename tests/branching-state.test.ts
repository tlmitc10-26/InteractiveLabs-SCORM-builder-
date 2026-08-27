import { describe, it, expect } from "vitest";
import {
  QUALITY_WEIGHTS,
  toBranchingRuntimeConfig,
  collectBranchingAssetIds,
  type BranchingConfigLike,
} from "@/lib/engines/branching-scenario/runtime-config";
import {
  MAX_PATH,
  initialState,
  conditionMet,
  visibleChoices,
  applyChoice,
  scorePct,
  suspendPayload,
  restoreState,
  QUALITY_CODES,
} from "@/lib/engines/branching-scenario/state";

// Small structural fixture — deliberately NOT run through the zod schema
// (state.ts/runtime-config.ts are light modules with zero zod dependency;
// their input is BranchingConfigLike, which a validated BranchingConfig
// structurally satisfies, but tests here exercise the structural contract
// directly).
const base: BranchingConfigLike = {
  title: "Sample",
  variables: [{ id: "trust", label: "Trust", initial: 50, min: 0, max: 100, visible: true }],
  scenes: [
    {
      id: "start",
      title: "Start",
      body: "<p>Start</p>",
      choices: [
        { id: "goodChoice", label: "Good", quality: "best", effects: [{ variableId: "trust", delta: 10 }], goTo: "scene:mid" },
        { id: "badChoice", label: "Bad", quality: "poor", effects: [{ variableId: "trust", delta: -70 }], goTo: "scene:mid" },
        {
          id: "hiddenChoice",
          label: "Hidden",
          quality: "acceptable",
          effects: [],
          goTo: "ending:secret",
          showIf: { variableId: "trust", comparator: "gte", value: 999 },
        },
      ],
    },
    {
      id: "mid",
      title: "Mid",
      body: "<p>Mid</p>",
      choices: [
        { id: "finish", label: "Finish", quality: "acceptable", effects: [], goTo: "ending:done" },
      ],
    },
  ],
  startSceneId: "start",
  endings: [
    { id: "done", title: "Done", body: "<p>Done</p>" },
    { id: "secret", title: "Secret", body: "<p>Secret</p>" },
  ],
  feedbackMode: "debrief",
  showPathInDebrief: true,
};

describe("runtime-config — toBranchingRuntimeConfig / collectBranchingAssetIds", () => {
  const withImages: BranchingConfigLike = {
    ...base,
    scenes: [
      { ...base.scenes[0], imageAssetId: "asset-1", imageRole: "decorative" },
      { ...base.scenes[1], imageAssetId: "asset-2", imageRole: "informative", imageAlt: "A description" },
    ],
  };

  it("replaces imageAssetId with imageUrl and drops imageAssetId", () => {
    const runtime = toBranchingRuntimeConfig(withImages, (id) => `/api/assets/${id}`);
    expect(runtime.scenes[0]).not.toHaveProperty("imageAssetId");
    expect(runtime.scenes[0].imageUrl).toBe("/api/assets/asset-1");
    expect(runtime.scenes[1].imageUrl).toBe("/api/assets/asset-2");
    expect(runtime.scenes[1].imageRole).toBe("informative");
    expect(runtime.scenes[1].imageAlt).toBe("A description");
  });

  it("leaves scenes without an image untouched (no imageUrl key)", () => {
    const runtime = toBranchingRuntimeConfig(base, (id) => `/api/assets/${id}`);
    expect(runtime.scenes[0]).not.toHaveProperty("imageUrl");
    expect(runtime.scenes[0]).not.toHaveProperty("imageAssetId");
  });

  it("passes through non-scene fields unchanged", () => {
    const runtime = toBranchingRuntimeConfig(base, (id) => id);
    expect(runtime.title).toBe(base.title);
    expect(runtime.variables).toEqual(base.variables);
    expect(runtime.endings).toEqual(base.endings);
    expect(runtime.startSceneId).toBe(base.startSceneId);
  });

  it("collects asset ids referenced by scenes only", () => {
    expect(collectBranchingAssetIds(withImages).sort()).toEqual(["asset-1", "asset-2"]);
    expect(collectBranchingAssetIds(base)).toEqual([]);
  });

  it("QUALITY_WEIGHTS defines best=1, acceptable=0.5, poor=0", () => {
    expect(QUALITY_WEIGHTS).toEqual({ best: 1, acceptable: 0.5, poor: 0 });
  });
});

describe("state — initialState", () => {
  it("sets vars from variable initials and sceneId to startSceneId", () => {
    const s = initialState(base);
    expect(s.sceneId).toBe("start");
    expect(s.endingId).toBeNull();
    expect(s.vars).toEqual({ trust: 50 });
    expect(s.path).toEqual([]);
    expect(s.truncated).toBe(false);
  });
});

describe("state — conditionMet", () => {
  it("gte is inclusive", () => {
    expect(conditionMet({ variableId: "trust", comparator: "gte", value: 50 }, { trust: 50 })).toBe(true);
    expect(conditionMet({ variableId: "trust", comparator: "gte", value: 51 }, { trust: 50 })).toBe(false);
  });
  it("lte is inclusive", () => {
    expect(conditionMet({ variableId: "trust", comparator: "lte", value: 50 }, { trust: 50 })).toBe(true);
    expect(conditionMet({ variableId: "trust", comparator: "lte", value: 49 }, { trust: 50 })).toBe(false);
  });
  it("between is inclusive on both ends", () => {
    expect(conditionMet({ variableId: "trust", comparator: "between", min: 40, max: 60 }, { trust: 40 })).toBe(true);
    expect(conditionMet({ variableId: "trust", comparator: "between", min: 40, max: 60 }, { trust: 60 })).toBe(true);
    expect(conditionMet({ variableId: "trust", comparator: "between", min: 40, max: 60 }, { trust: 61 })).toBe(false);
  });
});

describe("state — visibleChoices", () => {
  it("excludes choices whose showIf fails and includes those without showIf", () => {
    const s = initialState(base);
    const visible = visibleChoices(base, s);
    expect(visible.map((c) => c.id)).toEqual(["goodChoice", "badChoice"]);
  });

  it("includes a showIf choice once its condition holds", () => {
    const s = { ...initialState(base), vars: { trust: 999 } };
    const visible = visibleChoices(base, s);
    expect(visible.map((c) => c.id)).toEqual(["goodChoice", "badChoice", "hiddenChoice"]);
  });

  it("returns [] once the scenario has ended (sceneId null)", () => {
    const ended = { sceneId: null, endingId: "done", vars: { trust: 50 }, path: [], truncated: false };
    expect(visibleChoices(base, ended)).toEqual([]);
  });
});

describe("state — applyChoice", () => {
  it("throws naming the choice for an unknown choice id", () => {
    const s = initialState(base);
    expect(() => applyChoice(base, s, "nope")).toThrow(/nope/);
  });

  it("throws naming the choice for a choice that exists but is not currently visible", () => {
    const s = initialState(base); // trust=50, hiddenChoice requires >=999
    expect(() => applyChoice(base, s, "hiddenChoice")).toThrow(/hiddenChoice/);
  });

  it("applies effects and clamps into [min, max]", () => {
    const s = initialState(base);
    const next = applyChoice(base, s, "goodChoice"); // trust 50 + 10 = 60
    expect(next.vars.trust).toBe(60);

    const low = applyChoice(base, s, "badChoice"); // trust 50 - 70 clamps to 0
    expect(low.vars.trust).toBe(0);
  });

  it("clamps at the upper bound too", () => {
    const near100: BranchingConfigLike = {
      ...base,
      variables: [{ id: "trust", label: "Trust", initial: 95, min: 0, max: 100, visible: true }],
    };
    const s = initialState(near100);
    const next = applyChoice(near100, s, "goodChoice"); // +10 clamps to 100
    expect(next.vars.trust).toBe(100);
  });

  it("applies multiple effects on the same variable in sequence, clamping after EACH effect (not once at the end)", () => {
    const multiEffectConfig: BranchingConfigLike = {
      ...base,
      variables: [{ id: "trust", label: "Trust", initial: 90, min: 0, max: 100, visible: true }],
      scenes: [
        {
          id: "start",
          body: "<p>Start</p>",
          choices: [
            {
              id: "combo",
              label: "Combo",
              quality: "best",
              effects: [
                { variableId: "trust", delta: 20 }, // 90 + 20 = 110 -> clamps to 100
                { variableId: "trust", delta: -50 }, // 100 - 50 = 50
              ],
              goTo: "scene:mid",
            },
          ],
        },
        base.scenes[1],
      ],
    };
    const s = initialState(multiEffectConfig);
    const next = applyChoice(multiEffectConfig, s, "combo");
    // Clamp-after-each gives 50. A naive sum-then-clamp-once would instead
    // compute 90 + 20 - 50 = 60 and never see the clamp at all — this test
    // locks the (correct) per-effect clamping semantics.
    expect(next.vars.trust).toBe(50);
  });

  it("appends a {s,c,q} path entry and transitions sceneId on goTo scene:", () => {
    const s = initialState(base);
    const next = applyChoice(base, s, "goodChoice");
    expect(next.sceneId).toBe("mid");
    expect(next.endingId).toBeNull();
    expect(next.path).toEqual([{ s: "start", c: "goodChoice", q: "best" }]);
  });

  it("sets endingId and sceneId null on goTo ending:", () => {
    const s = initialState(base);
    const afterMid = applyChoice(base, s, "goodChoice");
    const ended = applyChoice(base, afterMid, "finish");
    expect(ended.sceneId).toBeNull();
    expect(ended.endingId).toBe("done");
    expect(ended.path).toHaveLength(2);
  });

  it("truncates the path from the FRONT beyond MAX_PATH and sets truncated=true", () => {
    const loopConfig: BranchingConfigLike = {
      ...base,
      scenes: [
        {
          id: "loop",
          body: "<p>Loop</p>",
          choices: [{ id: "again", label: "Again", quality: "best", effects: [], goTo: "scene:loop" }],
        },
      ],
      startSceneId: "loop",
    };
    let s = initialState(loopConfig);
    for (let i = 0; i < 201; i++) {
      s = applyChoice(loopConfig, s, "again");
    }
    expect(s.path).toHaveLength(MAX_PATH);
    expect(s.truncated).toBe(true);
    // still mid-scenario: sceneId stays "loop" every iteration
    expect(s.sceneId).toBe("loop");
  });

  it("does not truncate at exactly MAX_PATH steps", () => {
    const loopConfig: BranchingConfigLike = {
      ...base,
      scenes: [
        {
          id: "loop",
          body: "<p>Loop</p>",
          choices: [{ id: "again", label: "Again", quality: "best", effects: [], goTo: "scene:loop" }],
        },
      ],
      startSceneId: "loop",
    };
    let s = initialState(loopConfig);
    for (let i = 0; i < MAX_PATH; i++) {
      s = applyChoice(loopConfig, s, "again");
    }
    expect(s.path).toHaveLength(MAX_PATH);
    expect(s.truncated).toBe(false);
  });
});

describe("state — scorePct", () => {
  it("returns 0 for an empty path", () => {
    expect(scorePct(initialState(base))).toBe(0);
  });

  it("computes the mean of QUALITY_WEIGHTS * 100, rounded — best+poor+acceptable = 50", () => {
    const s = {
      sceneId: null, endingId: "done", vars: {}, truncated: false,
      path: [
        { s: "a", c: "x", q: "best" as const },
        { s: "b", c: "y", q: "poor" as const },
        { s: "c", c: "z", q: "acceptable" as const },
      ],
    };
    // (1 + 0 + 0.5) / 3 * 100 = 50
    expect(scorePct(s)).toBe(50);
  });

  it("rounds via Math.round", () => {
    const s = {
      sceneId: null, endingId: "done", vars: {}, truncated: false,
      path: [
        { s: "a", c: "x", q: "best" as const },
        { s: "b", c: "y", q: "poor" as const },
        { s: "c", c: "z", q: "poor" as const },
      ],
    };
    // (1 + 0 + 0) / 3 * 100 = 33.33... -> 33
    expect(scorePct(s)).toBe(33);
  });
});

describe("state — QUALITY_CODES mapping", () => {
  it("maps each quality to a distinct 0|1|2 code", () => {
    const codes = new Set(Object.values(QUALITY_CODES));
    expect(codes).toEqual(new Set([0, 1, 2]));
    expect(QUALITY_CODES.best).not.toBe(QUALITY_CODES.acceptable);
    expect(QUALITY_CODES.acceptable).not.toBe(QUALITY_CODES.poor);
  });
});

describe("state — suspendPayload / restoreState round trip", () => {
  it("round-trips a mid-scenario state", () => {
    const s0 = initialState(base);
    const s1 = applyChoice(base, s0, "goodChoice");
    const payload = suspendPayload(s1, 42, false);
    expect(payload).toEqual({
      v: 1,
      s: "mid",
      e: null,
      vars: { trust: 60 },
      d: ["start", "goodChoice"],
      p: [[0, 1, QUALITY_CODES.best]],
      t: false,
      b: 42,
      c: false,
    });

    const restored = restoreState(base, payload);
    expect(restored).not.toBeNull();
    expect(restored?.state).toEqual(s1);
    expect(restored?.best).toBe(42);
    expect(restored?.completed).toBe(false);
  });

  it("round-trips a completed/ended state", () => {
    const s0 = initialState(base);
    const s1 = applyChoice(base, s0, "goodChoice");
    const s2 = applyChoice(base, s1, "finish");
    const payload = suspendPayload(s2, 100, true);
    const restored = restoreState(base, payload);
    expect(restored?.state).toEqual(s2);
    expect(restored?.completed).toBe(true);
  });

  it("serializes a full 200-step path (realistic 10-char ids, cycling through 3 scenes) under 3500 bytes", () => {
    // Realistic-length (10-char) scene/choice ids, cycling through a small
    // loop so a 200-step playthrough is reachable (schema caps scenes/choices
    // low enough that a genuinely non-repeating 200-step path isn't
    // representative — long playthroughs in practice come from revisiting a
    // handful of scenes many times, which is exactly what the dedup
    // dictionary in suspendPayload is designed to keep compact).
    const variableId = "variableid"; // 10 chars
    const loopConfig: BranchingConfigLike = {
      ...base,
      variables: [{ id: variableId, label: "V", initial: 0, min: 0, max: 1000, visible: false }],
      scenes: [
        { id: "scenea0001", body: "<p>A</p>", choices: [{ id: "choicea001", label: "A", quality: "best", effects: [{ variableId, delta: 1 }], goTo: "scene:sceneb0002" }] },
        { id: "sceneb0002", body: "<p>B</p>", choices: [{ id: "choiceb002", label: "B", quality: "acceptable", effects: [], goTo: "scene:scenec0003" }] },
        { id: "scenec0003", body: "<p>C</p>", choices: [{ id: "choicec003", label: "C", quality: "poor", effects: [], goTo: "scene:scenea0001" }] },
      ],
      startSceneId: "scenea0001",
    };
    let s = initialState(loopConfig);
    for (let i = 0; i < MAX_PATH; i++) {
      const choiceId = visibleChoices(loopConfig, s)[0].id;
      s = applyChoice(loopConfig, s, choiceId);
    }
    expect(s.path).toHaveLength(MAX_PATH);
    expect(s.truncated).toBe(false);
    const payload = suspendPayload(s, 100, false);
    // Dedup dictionary holds only the 6 distinct ids ever referenced, no
    // matter how many times the loop repeats.
    expect(payload.d).toHaveLength(6);
    const json = JSON.stringify(payload);
    expect(json.length).toBeLessThan(3500);

    const restored = restoreState(loopConfig, payload);
    expect(restored?.state).toEqual(s);
  });

  it("returns null for a stale/unknown scene id", () => {
    const payload = {
      v: 1, s: "not-a-real-scene", e: null, vars: { trust: 50 }, p: [], t: false, b: 0, c: false,
    };
    expect(restoreState(base, payload)).toBeNull();
  });

  it("returns null for a stale/unknown ending id", () => {
    const payload = {
      v: 1, s: null, e: "not-a-real-ending", vars: { trust: 50 }, p: [], t: false, b: 0, c: true,
    };
    expect(restoreState(base, payload)).toBeNull();
  });

  it("returns null for an unknown variable in vars", () => {
    const payload = {
      v: 1, s: "start", e: null, vars: { trust: 50, extra: 1 }, p: [], t: false, b: 0, c: false,
    };
    expect(restoreState(base, payload)).toBeNull();
  });

  it("returns null for a missing variable in vars", () => {
    const payload = { v: 1, s: "start", e: null, vars: {}, p: [], t: false, b: 0, c: false };
    expect(restoreState(base, payload)).toBeNull();
  });

  it("clamps a restored var above its configured max down to max, rather than rejecting", () => {
    // trust's range in `base` is [0, 100]. A stale/tampered payload carrying
    // a finite but out-of-range value should degrade gracefully — the same
    // way live play would via applyChoice's clamp — not be treated as
    // corrupt. An unclamped restore could silently make a showIf condition
    // (e.g. "trust gte 999") visible when it never legitimately could be.
    const payload = { v: 1, s: "start", e: null, vars: { trust: 500 }, d: [], p: [], t: false, b: 0, c: false };
    const restored = restoreState(base, payload);
    expect(restored).not.toBeNull();
    expect(restored?.state.vars.trust).toBe(100);
  });

  it("clamps a restored var below its configured min up to min, rather than rejecting", () => {
    const payload = { v: 1, s: "start", e: null, vars: { trust: -50 }, d: [], p: [], t: false, b: 0, c: false };
    const restored = restoreState(base, payload);
    expect(restored).not.toBeNull();
    expect(restored?.state.vars.trust).toBe(0);
  });

  it("returns null for a path entry referencing an unknown choice id in a known scene", () => {
    const payload = {
      v: 1, s: "mid", e: null, vars: { trust: 60 },
      d: ["start", "not-a-real-choice"],
      p: [[0, 1, 0]],
      t: false, b: 0, c: false,
    };
    expect(restoreState(base, payload)).toBeNull();
  });

  it("returns null for a path entry whose dictionary index is out of range", () => {
    const payload = {
      v: 1, s: "mid", e: null, vars: { trust: 60 },
      d: ["start", "goodChoice"],
      p: [[0, 5, 0]],
      t: false, b: 0, c: false,
    };
    expect(restoreState(base, payload)).toBeNull();
  });

  it("returns null for a wrong version", () => {
    const payload = { v: 2, s: "start", e: null, vars: { trust: 50 }, p: [], t: false, b: 0, c: false };
    expect(restoreState(base, payload)).toBeNull();
  });

  it("returns null for malformed payloads (not an object, null, array, missing fields)", () => {
    expect(restoreState(base, null)).toBeNull();
    expect(restoreState(base, undefined)).toBeNull();
    expect(restoreState(base, "garbage")).toBeNull();
    expect(restoreState(base, [])).toBeNull();
    expect(restoreState(base, {})).toBeNull();
    expect(restoreState(base, { v: 1 })).toBeNull();
  });

  it("returns null when both s and e are null (invalid: neither mid-scenario nor ended)", () => {
    const payload = { v: 1, s: null, e: null, vars: { trust: 50 }, p: [], t: false, b: 0, c: false };
    expect(restoreState(base, payload)).toBeNull();
  });

  it("returns null when both s and e are non-null (invalid: can't be both mid-scenario and ended)", () => {
    const payload = { v: 1, s: "start", e: "done", vars: { trust: 50 }, p: [], t: false, b: 0, c: false };
    expect(restoreState(base, payload)).toBeNull();
  });

  it("never throws even on wildly malformed input", () => {
    expect(() => restoreState(base, { v: 1, s: 5, e: {}, vars: "nope", p: "nope", t: 1, b: "x", c: 1 })).not.toThrow();
  });
});
