import { describe, it, expect } from "vitest";
import { validateSandboxConfig, toRuntimeConfig, emptySandboxConfig } from "@/lib/engines/param-sandbox/schema";

const valid = {
  title: "Archimedes Principle",
  intro: "<p>Explore <strong>buoyancy</strong>.</p>",
  inputs: [
    { id: "mass", label: "Object mass", type: "slider", min: 0.1, max: 10, step: 0.1, defaultValue: 1, units: "kg" },
    { id: "density", label: "Fluid", type: "select", defaultValue: 1000, units: "kg/m3",
      options: [{ label: "Water", value: 1000 }, { label: "Oil", value: 900 }] },
  ],
  outputs: [
    { id: "volume", label: "Displaced volume", formula: "mass / density * 1000", units: "L", decimals: 2 },
  ],
  charts: [
    { id: "c1", title: "Volume vs mass", xInputId: "mass", yOutputId: "volume", samples: 40 },
  ],
  visual: {
    backgroundAssetId: "asset_abc",
    overlays: [
      { id: "water", type: "fill", outputId: "volume", inMin: 0, inMax: 10, color: "#4a90d9",
        box: { x: 20, y: 10, w: 60, h: 80 } },
    ],
  },
  challenges: [
    { id: "ch1", prompt: "Displace more than 5 L", outputId: "volume", comparator: "gte", value: 5 },
  ],
};

describe("validateSandboxConfig", () => {
  it("accepts a valid config and sanitizes text fields", () => {
    const r = validateSandboxConfig({ ...valid, intro: '<p>ok</p><script>x</script>' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.intro).toBe("<p>ok</p>");
  });
  it("rejects unknown keys (strict)", () => {
    const r = validateSandboxConfig({ ...valid, injected: "x" });
    expect(r.ok).toBe(false);
  });
  it("rejects formulas that fail to parse", () => {
    const r = validateSandboxConfig({
      ...valid,
      outputs: [{ id: "v", label: "v", formula: "eval(1)" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/unknown function/i);
  });
  it("rejects formulas referencing undefined inputs/outputs", () => {
    const r = validateSandboxConfig({
      ...valid,
      outputs: [{ id: "v", label: "v", formula: "massTypo * 2" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/massTypo/);
  });
  it("allows outputs to reference earlier outputs", () => {
    const r = validateSandboxConfig({
      ...valid,
      outputs: [
        { id: "volume", label: "V", formula: "mass / density * 1000" },
        { id: "double", label: "2V", formula: "volume * 2" },
      ],
    });
    expect(r.ok).toBe(true);
  });
  it("rejects duplicate input/output ids and bad id charset", () => {
    expect(validateSandboxConfig({ ...valid, inputs: [valid.inputs[0], valid.inputs[0]] }).ok).toBe(false);
    expect(validateSandboxConfig({
      ...valid, inputs: [{ ...valid.inputs[0], id: "bad id!" }],
    }).ok).toBe(false);
  });
  it("rejects charts referencing unknown ids", () => {
    const r = validateSandboxConfig({
      ...valid, charts: [{ id: "c", title: "t", xInputId: "nope", yOutputId: "volume", samples: 10 }],
    });
    expect(r.ok).toBe(false);
  });
  it("emptySandboxConfig validates", () => {
    expect(validateSandboxConfig(emptySandboxConfig("New interactive")).ok).toBe(true);
  });
});

describe("toRuntimeConfig", () => {
  it("replaces asset ids with resolved urls", () => {
    const r = validateSandboxConfig(valid);
    if (!r.ok) throw new Error("valid fixture");
    const rt = toRuntimeConfig(r.config, (assetId) => `assets/${assetId}.png`);
    expect(rt.visual?.backgroundUrl).toBe("assets/asset_abc.png");
    expect((rt.visual as { backgroundAssetId?: string }).backgroundAssetId).toBeUndefined();
  });
});
