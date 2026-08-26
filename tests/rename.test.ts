import { describe, it, expect } from "vitest";
import { renameInFormula, renameIdentifier, type RenameableConfig } from "@/lib/engines/param-sandbox/rename";

describe("renameInFormula", () => {
  it("renames a whole identifier", () => {
    expect(renameInFormula("mass / density * 1000", "mass", "object_mass")).toBe("object_mass / density * 1000");
  });

  it("is word-boundary safe: renaming mass must not touch biomass", () => {
    expect(renameInFormula("biomass * 2", "mass", "weight")).toBe("biomass * 2");
  });

  it("renames every occurrence", () => {
    expect(renameInFormula("mass + mass * 2", "mass", "m")).toBe("m + m * 2");
  });

  it("leaves formulas that don't reference the id untouched", () => {
    expect(renameInFormula("density * 2", "mass", "m")).toBe("density * 2");
  });

  it("leaves unparsable formulas untouched rather than corrupting them", () => {
    expect(renameInFormula("mass +", "mass", "m")).toBe("mass +");
  });

  it("does not rename function names or constants", () => {
    // "e" is a constant; renaming an id literally named "e" would be
    // pathological input, but round(e) should never be touched by a rename
    // of some unrelated id that happens to share no characters here.
    expect(renameInFormula("round(pi) + mass", "mass", "m")).toBe("round(pi) + m");
  });
});

function baseConfig(): RenameableConfig {
  return {
    title: "t",
    inputs: [{ id: "mass", label: "Mass" }, { id: "density", label: "Density" }],
    outputs: [
      { id: "volume", label: "Volume", formula: "mass / density * 1000" },
      { id: "biomass_index", label: "Biomass index", formula: "mass * 3" },
    ],
    charts: [{ id: "c1", xInputId: "mass", yOutputId: "volume" }],
    challenges: [{ id: "ch1", outputId: "volume" }],
    visual: {
      overlays: [
        { id: "ov1", type: "fill", outputId: "volume" },
        { id: "ov2", type: "swap", outputId: "biomass_index" },
      ],
    },
  };
}

describe("renameIdentifier", () => {
  it("renames the input's own id", () => {
    const out = renameIdentifier(baseConfig(), "mass", "object_mass");
    expect(out.inputs[0].id).toBe("object_mass");
  });

  it("rewrites formulas referencing the renamed id", () => {
    const out = renameIdentifier(baseConfig(), "mass", "object_mass");
    expect(out.outputs[0].formula).toBe("object_mass / density * 1000");
    expect(out.outputs[1].formula).toBe("object_mass * 3");
  });

  it("does not touch an unrelated identifier that shares a substring (biomass vs mass)", () => {
    const out = renameIdentifier(baseConfig(), "mass", "object_mass");
    expect(out.outputs[1].id).toBe("biomass_index"); // own id untouched
  });

  it("rewrites chart xInputId/yOutputId", () => {
    const renamedInput = renameIdentifier(baseConfig(), "mass", "object_mass");
    expect(renamedInput.charts[0].xInputId).toBe("object_mass");
    const renamedOutput = renameIdentifier(baseConfig(), "volume", "displaced_volume");
    expect(renamedOutput.charts[0].yOutputId).toBe("displaced_volume");
  });

  it("rewrites challenge outputId", () => {
    const out = renameIdentifier(baseConfig(), "volume", "displaced_volume");
    expect(out.challenges[0].outputId).toBe("displaced_volume");
  });

  it("rewrites overlay outputId", () => {
    const out = renameIdentifier(baseConfig(), "volume", "displaced_volume");
    expect(out.visual!.overlays[0].outputId).toBe("displaced_volume");
    expect(out.visual!.overlays[1].outputId).toBe("biomass_index"); // untouched
  });

  it("renaming an output id updates its own id and every reference, leaving other outputs alone", () => {
    const out = renameIdentifier(baseConfig(), "volume", "displaced_volume");
    expect(out.outputs[0].id).toBe("displaced_volume");
    expect(out.outputs[1].id).toBe("biomass_index");
    expect(out.outputs[1].formula).toBe("mass * 3");
  });

  it("is a no-op returning the same reference when oldId === newId", () => {
    const cfg = baseConfig();
    expect(renameIdentifier(cfg, "mass", "mass")).toBe(cfg);
  });

  it("does not mutate the input config", () => {
    const cfg = baseConfig();
    const snapshot = JSON.parse(JSON.stringify(cfg));
    renameIdentifier(cfg, "mass", "object_mass");
    expect(cfg).toEqual(snapshot);
  });

  it("handles configs with no visual section", () => {
    const cfg = baseConfig();
    delete cfg.visual;
    const out = renameIdentifier(cfg, "mass", "object_mass");
    expect(out.visual).toBeUndefined();
  });
});
