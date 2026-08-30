import { describe, it, expect } from "vitest";
import { evidenceRatio, reasonRatio, scoreCase, type CaseConfigLike } from "@/lib/engines/case-workspace/scoring";

// Structural fixture — deliberately NOT run through the zod schema (scoring.ts
// is a light module with zero zod dependency; its input is CaseConfigLike,
// which a validated CaseConfig structurally satisfies, but tests here
// exercise the structural contract directly — mirrors
// tests/branching-state.test.ts's `base` fixture).
//
// equipment_failure: credit full, 2 supports (memo strong, log weak), 1
//   contradicts (photo). Reasons: r_sound1 + r_sound2 (both sound), r_flaw1
//   (flawed).
// operator_error: credit none, 1 supports (grid). Reasons: r_sound (sound),
//   r_flaw (flawed).
const bestSupportedConfig: CaseConfigLike = {
  scoringMode: "best-supported",
  conclusions: [
    {
      id: "equipment_failure",
      credit: "full",
      reasons: [
        { id: "r_sound1", sound: true },
        { id: "r_sound2", sound: true },
        { id: "r_flaw1", sound: false },
      ],
    },
    {
      id: "operator_error",
      credit: "none",
      reasons: [
        { id: "r_sound", sound: true },
        { id: "r_flaw", sound: false },
      ],
    },
  ],
  expertMap: [
    { artifactId: "memo", conclusionId: "equipment_failure", role: "supports" },
    { artifactId: "log", conclusionId: "equipment_failure", role: "supports" },
    { artifactId: "photo", conclusionId: "equipment_failure", role: "contradicts" },
    { artifactId: "grid", conclusionId: "operator_error", role: "supports" },
  ],
};

describe("evidenceRatio", () => {
  it("computes included-supports minus included-contradicts over |supports(C)|", () => {
    const r = evidenceRatio(bestSupportedConfig, "equipment_failure", ["memo"]);
    expect(r).toEqual({ num: 1, den: 2 }); // 1 support included, 0 contradicts included, 2 supports total
  });

  it("both supports included scores 2/2", () => {
    const r = evidenceRatio(bestSupportedConfig, "equipment_failure", ["memo", "log"]);
    expect(r).toEqual({ num: 2, den: 2 });
  });

  it("floors at 0 when included contradicts outweigh included supports (misuse floor)", () => {
    const r = evidenceRatio(bestSupportedConfig, "equipment_failure", ["photo"]); // 0 supports, 1 contradicts
    expect(r).toEqual({ num: 0, den: 2 });
  });

  it("floors at 0 (not negative) when contradicts exceed supports even with some supports included", () => {
    const manyContradicts: CaseConfigLike = {
      ...bestSupportedConfig,
      expertMap: [
        { artifactId: "memo", conclusionId: "equipment_failure", role: "supports" },
        { artifactId: "photo1", conclusionId: "equipment_failure", role: "contradicts" },
        { artifactId: "photo2", conclusionId: "equipment_failure", role: "contradicts" },
      ],
    };
    const r = evidenceRatio(manyContradicts, "equipment_failure", ["memo", "photo1", "photo2"]);
    // 1 support included, 2 contradicts included -> max(0, 1-2) = 0
    expect(r).toEqual({ num: 0, den: 1 });
  });

  it("returns 0/den for an empty case file", () => {
    const r = evidenceRatio(bestSupportedConfig, "equipment_failure", []);
    expect(r).toEqual({ num: 0, den: 2 });
  });

  it("ignores artifacts irrelevant to the chosen conclusion (unmapped/other-conclusion artifacts)", () => {
    const r = evidenceRatio(bestSupportedConfig, "equipment_failure", ["memo", "grid", "herring"]);
    expect(r).toEqual({ num: 1, den: 2 });
  });

  it("DEFENSIVE (out-of-contract): a chosen conclusion with zero supports entries clamps the denominator to 1 rather than dividing by zero", () => {
    // validateCaseConfig always rejects a conclusion with zero supports
    // entries — this exercises the documented-out-of-contract defensive
    // floor directly, per spec §4 review #16.
    const noSupports: CaseConfigLike = {
      ...bestSupportedConfig,
      expertMap: [{ artifactId: "photo", conclusionId: "equipment_failure", role: "contradicts" }],
    };
    const r = evidenceRatio(noSupports, "equipment_failure", []);
    expect(r).toEqual({ num: 0, den: 1 });
  });
});

describe("reasonRatio", () => {
  it("computes selected-sound minus selected-flawed over |sound reasons|", () => {
    const r = reasonRatio(bestSupportedConfig, "equipment_failure", ["r_sound1"]);
    expect(r).toEqual({ num: 1, den: 2 }); // 1 of 2 sound reasons selected, 0 flawed selected
  });

  it("both sound reasons selected scores 2/2", () => {
    const r = reasonRatio(bestSupportedConfig, "equipment_failure", ["r_sound1", "r_sound2"]);
    expect(r).toEqual({ num: 2, den: 2 });
  });

  it("floors at 0 when selected flawed reasons outweigh selected sound reasons (misuse floor)", () => {
    const r = reasonRatio(bestSupportedConfig, "equipment_failure", ["r_flaw1"]);
    expect(r).toEqual({ num: 0, den: 2 });
  });

  it("returns 0/den when nothing is selected", () => {
    const r = reasonRatio(bestSupportedConfig, "equipment_failure", []);
    expect(r).toEqual({ num: 0, den: 2 });
  });

  it("ignores reason ids belonging to a DIFFERENT conclusion", () => {
    const r = reasonRatio(bestSupportedConfig, "equipment_failure", ["r_sound"]); // operator_error's reason id
    expect(r).toEqual({ num: 0, den: 2 });
  });

  it("DEFENSIVE (out-of-contract): an unknown chosenId returns 0/1 rather than throwing", () => {
    const r = reasonRatio(bestSupportedConfig, "not-a-real-conclusion", ["anything"]);
    expect(r).toEqual({ num: 0, den: 1 });
  });

  it("DEFENSIVE (out-of-contract): a conclusion with zero sound reasons clamps the denominator to 1", () => {
    // validateCaseConfig always rejects a conclusion with zero sound
    // reasons — this exercises the documented-out-of-contract floor.
    const noSound: CaseConfigLike = {
      ...bestSupportedConfig,
      conclusions: [
        { id: "equipment_failure", credit: "full", reasons: [{ id: "r1", sound: false }, { id: "r2", sound: false }] },
        bestSupportedConfig.conclusions[1],
      ],
    };
    const r = reasonRatio(noSound, "equipment_failure", []);
    expect(r).toEqual({ num: 0, den: 1 });
  });
});

describe("scoreCase — best-supported mode", () => {
  it("perfect evidence + perfect reasons + full credit scores 100", () => {
    const s = scoreCase(bestSupportedConfig, "equipment_failure", ["memo", "log"], ["r_sound1", "r_sound2"]);
    expect(s.evidence).toEqual({ num: 2, den: 2 });
    expect(s.reason).toEqual({ num: 2, den: 2 });
    expect(s.credit).toBe("full");
    expect(s.totalPct).toBe(100);
  });

  it("zero evidence + zero reasons + none credit scores 0", () => {
    const s = scoreCase(bestSupportedConfig, "operator_error", [], []);
    expect(s.credit).toBe("none");
    expect(s.totalPct).toBe(0);
  });

  it("partial credit contributes exactly half its 20-point weight (10 points) when evidence/reason are perfect", () => {
    const partialConfig: CaseConfigLike = {
      ...bestSupportedConfig,
      conclusions: [
        bestSupportedConfig.conclusions[0],
        { ...bestSupportedConfig.conclusions[1], credit: "partial" },
      ],
    };
    const s = scoreCase(partialConfig, "operator_error", ["grid"], ["r_sound"]);
    // evidence 1/1 (100%), reason 1/1 (100%), credit partial (50%)
    // best-supported: 50*1 + 30*1 + 20*0.5 = 90
    expect(s.totalPct).toBe(90);
  });

  it("mixed evidence/reason computes the exact expected weighted percentage", () => {
    const s = scoreCase(bestSupportedConfig, "equipment_failure", ["memo"], ["r_sound1"]);
    // evidence 1/2 (50%), reason 1/2 (50%), credit full (100%)
    // 50*0.5 + 30*0.5 + 20*1 = 25 + 15 + 20 = 60
    expect(s.totalPct).toBe(60);
  });
});

describe("scoreCase — single mode gate", () => {
  const singleConfig: CaseConfigLike = { ...bestSupportedConfig, scoringMode: "single" };

  it("wrong conclusion (credit not full) scores totalPct 0 REGARDLESS of evidence/reason quality", () => {
    // operator_error has credit "none" under single mode — even perfect
    // evidence/reasons for it must gate to zero (spec §4 review #4).
    const s = scoreCase(singleConfig, "operator_error", ["grid"], ["r_sound"]);
    expect(s.evidence).toEqual({ num: 1, den: 1 }); // process credit still reported...
    expect(s.reason).toEqual({ num: 1, den: 1 });
    expect(s.credit).toBe("none");
    expect(s.totalPct).toBe(0); // ...but the gate zeroes the total
  });

  it("correct conclusion (credit full) computes (50e + 30r + 20)/100, matching best-supported's formula with credit fixed at full", () => {
    const s = scoreCase(singleConfig, "equipment_failure", ["memo"], ["r_sound1"]);
    // evidence 1/2 (50%), reason 1/2 (50%): 50*0.5 + 30*0.5 + 20 = 25+15+20 = 60
    expect(s.totalPct).toBe(60);
  });

  it("correct conclusion with perfect evidence/reasons scores 100", () => {
    const s = scoreCase(singleConfig, "equipment_failure", ["memo", "log"], ["r_sound1", "r_sound2"]);
    expect(s.totalPct).toBe(100);
  });
});

describe("scoreCase — argument-quality mode", () => {
  const aqConfig: CaseConfigLike = { ...bestSupportedConfig, scoringMode: "argument-quality" };

  it("removes the credit component: renormalizes over 80 instead of 100", () => {
    const s = scoreCase(aqConfig, "equipment_failure", ["memo", "log"], ["r_sound1", "r_sound2"]);
    // evidence 2/2 (100%), reason 2/2 (100%): (50+30)/80 * 100 = 100
    expect(s.totalPct).toBe(100);
  });

  it("credit value on the conclusion does not affect totalPct at all", () => {
    // operator_error has credit "none" — under argument-quality this must
    // not matter (review: mode switches never brick/penalize a draft).
    const s = scoreCase(aqConfig, "operator_error", ["grid"], ["r_sound"]);
    // evidence 1/1 (100%), reason 1/1 (100%): (50+30)/80 * 100 = 100
    expect(s.totalPct).toBe(100);
    expect(s.credit).toBe("none"); // still reported for display, just unused in the math
  });

  it("mixed evidence/reason computes the exact renormalized percentage", () => {
    const s = scoreCase(aqConfig, "equipment_failure", ["memo"], ["r_sound1"]);
    // evidence 1/2 (50%), reason 1/2 (50%): (50*0.5 + 30*0.5)/80 * 100 = 40/80*100 = 50
    expect(s.totalPct).toBe(50);
  });
});

describe("scoreCase — locked .5-boundary fixture (round-half-up)", () => {
  it("50*(1/4) + 30*(0/1) + 20*0.5(partial) = 22.5 rounds UP to 23", () => {
    // Deliberately constructed so the weighted sum lands exactly on a .5
    // boundary: evidence 1/4 (4 supports, 1 net-included) contributes
    // 50*0.25 = 12.5 exactly; reason 0/1 contributes 0; partial credit
    // contributes 20*0.5 = 10 exactly. 12.5 + 0 + 10 = 22.5 -> round-half-up -> 23.
    // Math.round(22.5) === 23 in JS, which IS round-half-up for positive
    // inputs — this test locks that this is the actual behavior relied on.
    expect(Math.round(22.5)).toBe(23);

    const boundaryConfig: CaseConfigLike = {
      scoringMode: "best-supported",
      conclusions: [
        {
          id: "target",
          credit: "partial",
          reasons: [
            { id: "sound1", sound: true },
            { id: "flaw1", sound: false },
          ],
        },
        { id: "other", credit: "full", reasons: [{ id: "s", sound: true }, { id: "f", sound: false }] },
      ],
      expertMap: [
        { artifactId: "a1", conclusionId: "target", role: "supports" },
        { artifactId: "a2", conclusionId: "target", role: "supports" },
        { artifactId: "a3", conclusionId: "target", role: "supports" },
        { artifactId: "a4", conclusionId: "target", role: "supports" },
        { artifactId: "a5", conclusionId: "other", role: "supports" },
      ],
    };
    const s = scoreCase(boundaryConfig, "target", ["a1"], []);
    expect(s.evidence).toEqual({ num: 1, den: 4 });
    expect(s.reason).toEqual({ num: 0, den: 1 });
    expect(s.credit).toBe("partial");
    expect(s.totalPct).toBe(23);
  });
});
