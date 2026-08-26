import { describe, it, expect } from "vitest";
import { STARTERS, starterConfig, DEFAULT_STARTER_ID } from "@/lib/engines/param-sandbox/starter-configs";
import { validateSandboxConfig } from "@/lib/engines/param-sandbox/schema";

describe("STARTERS", () => {
  it("has a blank and a buoyancy starter", () => {
    expect(Object.keys(STARTERS).sort()).toEqual(["blank", "buoyancy"]);
  });

  it("every starter's config validates", () => {
    for (const [id, starter] of Object.entries(STARTERS)) {
      const r = validateSandboxConfig(starter.config);
      expect(r.ok, `starter "${id}" should validate: ${!r.ok ? r.errors.join("; ") : ""}`).toBe(true);
    }
  });

  it("buoyancy has 2 inputs, 2 outputs, 1 chart, 1 challenge", () => {
    const { config } = STARTERS.buoyancy;
    expect(config.inputs).toHaveLength(2);
    expect(config.outputs).toHaveLength(2);
    expect(config.charts).toHaveLength(1);
    expect(config.challenges).toHaveLength(1);
  });

  it("blank starter has humanized labels/ids", () => {
    const { config } = STARTERS.blank;
    expect(config.inputs[0]).toMatchObject({ id: "value", label: "Value" });
    expect(config.outputs[0]).toMatchObject({ id: "result", label: "Result", formula: "value * 2" });
  });
});

describe("starterConfig", () => {
  it("stamps the given title onto the starter's config", () => {
    const config = starterConfig("buoyancy", "My Lesson");
    expect(config.title).toBe("My Lesson");
    expect(config.inputs).toHaveLength(2);
  });

  it("falls back to the blank starter for an unknown id", () => {
    const config = starterConfig("does-not-exist", "Fallback Title");
    expect(config.title).toBe("Fallback Title");
    expect(config).toMatchObject(starterConfig(DEFAULT_STARTER_ID, "Fallback Title"));
  });

  it("returns a fresh object tree each call (no shared references)", () => {
    const a = starterConfig("buoyancy", "A");
    const b = starterConfig("buoyancy", "B");
    expect(a.inputs).not.toBe(b.inputs);
    expect(a.inputs[0]).not.toBe(b.inputs[0]);
  });

  it("the resulting config still validates", () => {
    const r = validateSandboxConfig(starterConfig("buoyancy", "Archimedes"));
    expect(r.ok).toBe(true);
  });
});
