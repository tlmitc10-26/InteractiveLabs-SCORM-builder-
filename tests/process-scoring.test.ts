import { describe, it, expect } from "vitest";
import { scoreComponents, combineScore, scoreProcess, type ProcessConfigLike } from "@/lib/engines/process-simulator/scoring";

// Structural fixture — deliberately NOT run through the zod schema
// (scoring.ts is a light module with zero zod dependency; its input is
// ProcessConfigLike, which a validated ProcessConfig structurally
// satisfies, but tests here exercise the structural contract directly —
// mirrors tests/case-scoring.test.ts's approach).
function nineRequired(): ProcessConfigLike {
  return {
    actions: Array.from({ length: 9 }, (_, i) => ({ id: `r${i + 1}`, required: true })),
  };
}

describe("scoreComponents", () => {
  it("clean counts every required action with zero recorded attempts", () => {
    const config = nineRequired();
    const { totalRequired, cleanCount, totalAttempts } = scoreComponents(config, new Map());
    expect(totalRequired).toBe(9);
    expect(cleanCount).toBe(9);
    expect(totalAttempts).toBe(9);
  });

  it("a required action with >=1 recorded attempt is not clean, and its count adds to totalAttempts", () => {
    const config = nineRequired();
    const { cleanCount, totalAttempts } = scoreComponents(config, new Map([["r1", 3]]));
    expect(cleanCount).toBe(8);
    expect(totalAttempts).toBe(12); // 9 + 3
  });

  it("distractor hits add to totalAttempts but never affect cleanCount (correctness is blind to them)", () => {
    const config: ProcessConfigLike = { ...nineRequired(), actions: [...nineRequired().actions, { id: "d1", required: false }] };
    const { cleanCount, totalAttempts } = scoreComponents(config, new Map([["d1", 5]]));
    expect(cleanCount).toBe(9);
    expect(totalAttempts).toBe(14); // 9 + 5
  });

  it("an action with an explicit 0 entry is treated identically to no entry", () => {
    const config = nineRequired();
    const { cleanCount, totalAttempts } = scoreComponents(config, new Map([["r1", 0]]));
    expect(cleanCount).toBe(9);
    expect(totalAttempts).toBe(9);
  });
});

describe("combineScore — exact arithmetic", () => {
  it("returns the correctness/efficiency ratios unrounded", () => {
    const s = combineScore(9, 8, 108);
    expect(s.correctness).toEqual({ num: 8, den: 9 });
    expect(s.efficiency).toEqual({ num: 9, den: 108 });
  });
});

describe("scoreProcess — locked degenerate fixtures (spec §4)", () => {
  it("flawless: 9 of 9 clean, no illegal attempts at all -> 100", () => {
    const config = nineRequired();
    const s = scoreProcess(config, new Map());
    expect(s.totalPct).toBe(100);
  });

  it("fail one action 99 times, the other 8 clean -> 57", () => {
    const config = nineRequired();
    const s = scoreProcess(config, new Map([["r1", 99]]));
    // correctness 8/9, efficiency 9/108: 60*(8/9) + 40*(9/108)
    // = 53.333... + 3.333... = 56.666... -> round-half-up-ish -> 57
    expect(s.totalPct).toBe(57);
  });

  it("flawless-plus-one-distractor: all 9 required clean, one distractor hit once -> 96", () => {
    const config: ProcessConfigLike = { actions: [...nineRequired().actions, { id: "d1", required: false }] };
    const s = scoreProcess(config, new Map([["d1", 1]]));
    // correctness 9/9 (100%), efficiency 9/10 (90%): 60 + 40*0.9 = 96
    expect(s.totalPct).toBe(96);
  });

  it("the 60-floor extreme: schema-worst-case flailing (2 required clean, 22 distractors each saturated at 99) still floors at 60, never below", () => {
    // Schema caps: 24 actions max, 2 required minimum -> 22 distractors max,
    // each individually saturating its attempt counter at 99 (spec §4
    // review #3). Locks the deliberate property (review #23): correctness
    // is blind to distractor hits, so flailing on every distractor as hard
    // as the schema allows still can't push the grade below 60.
    const actions: ProcessConfigLike["actions"] = [
      { id: "r1", required: true },
      { id: "r2", required: true },
      ...Array.from({ length: 22 }, (_, i) => ({ id: `d${i + 1}`, required: false })),
    ];
    const attempts = new Map(Array.from({ length: 22 }, (_, i) => [`d${i + 1}`, 99] as [string, number]));
    const s = scoreProcess({ actions }, attempts);
    // correctness 2/2 (100%), efficiency 2/2180: 60 + 40*(2/2180) = 60.0367...
    expect(s.correctness).toEqual({ num: 2, den: 2 });
    expect(s.totalPct).toBe(60);
    expect(s.totalPct).toBeGreaterThanOrEqual(60); // the floor is never crossed
  });

  it("LOCKED rounding-boundary fixture: lands exactly on a .5 boundary and rounds up (round-half-up)", () => {
    // Constructed so the weighted sum is exactly X.5: totalRequired=2,
    // clean=1 (one required action clean, the other failed 30 times before
    // being done), totalAttempts = 2 + 30 = 32.
    // correctness 1/2 -> 60*0.5 = 30 exactly.
    // efficiency 2/32 = 0.0625 -> 40*0.0625 = 2.5 exactly.
    // 30 + 2.5 = 32.5 -> Math.round(32.5) === 33 in JS (round-half-up for
    // positive inputs) -- this test locks that this is the actual behavior
    // scoreProcess relies on, exactly like tests/case-scoring.test.ts's own
    // locked .5-boundary fixture.
    expect(Math.round(32.5)).toBe(33);

    const config: ProcessConfigLike = { actions: [{ id: "r1", required: true }, { id: "r2", required: true }] };
    const s = scoreProcess(config, new Map([["r2", 30]]));
    expect(s.correctness).toEqual({ num: 1, den: 2 });
    expect(s.efficiency).toEqual({ num: 2, den: 32 });
    expect(s.totalPct).toBe(33);
  });
});
