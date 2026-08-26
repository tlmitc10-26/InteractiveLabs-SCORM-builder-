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

describe("semantic validation", () => {
  it("enforces the declared length cap on the post-sanitize (stored) value, not just the raw input", () => {
    // 100 raw "&" chars pass the pre-transform cap (<=120) but sanitizePlainText
    // escapes each to "&amp;" (5 chars), producing a 500-char stored value that
    // must still be rejected against the label's 120-char cap.
    const r = validateSandboxConfig({
      ...valid,
      inputs: [{ ...valid.inputs[0], label: "&".repeat(100) }],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects fill/transform overlays where inMin === inMax", () => {
    const fillDegenerate = validateSandboxConfig({
      ...valid,
      visual: { ...valid.visual, overlays: [{ ...valid.visual.overlays[0], inMin: 5, inMax: 5 }] },
    });
    expect(fillDegenerate.ok).toBe(false);
    if (!fillDegenerate.ok) expect(fillDegenerate.errors.join(" ")).toMatch(/inMin and inMax must differ/);

    const transformDegenerate = validateSandboxConfig({
      ...valid,
      visual: {
        overlays: [{
          id: "t1", type: "transform", outputId: "volume", box: { x: 0, y: 0, w: 10, h: 10 },
          assetId: "asset1", property: "rotate", inMin: 2, inMax: 2, outMin: 0, outMax: 360,
        }],
      },
    });
    expect(transformDegenerate.ok).toBe(false);
  });

  it("rejects a chart whose xInputId references a non-numeric input", () => {
    const r = validateSandboxConfig({
      ...valid,
      inputs: [...valid.inputs, { id: "flag", label: "Flag", type: "toggle", defaultValue: 0 }],
      charts: [{ id: "c1", title: "bad", xInputId: "flag", yOutputId: "volume", samples: 10 }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/must reference a slider or number input/);
  });

  it("rejects duplicate ids within charts, within challenges, and within overlays", () => {
    const dupCharts = validateSandboxConfig({
      ...valid,
      charts: [valid.charts[0], { ...valid.charts[0] }],
    });
    expect(dupCharts.ok).toBe(false);

    const dupChallenges = validateSandboxConfig({
      ...valid,
      challenges: [valid.challenges[0], { ...valid.challenges[0] }],
    });
    expect(dupChallenges.ok).toBe(false);

    const dupOverlays = validateSandboxConfig({
      ...valid,
      visual: { ...valid.visual, overlays: [valid.visual.overlays[0], { ...valid.visual.overlays[0] }] },
    });
    expect(dupOverlays.ok).toBe(false);
  });

  it("enforces slider/number min < max and defaultValue within [min, max]", () => {
    const badRange = validateSandboxConfig({
      ...valid,
      inputs: [{ ...valid.inputs[0], min: 10, max: 10 }],
    });
    expect(badRange.ok).toBe(false);

    const outOfRangeDefault = validateSandboxConfig({
      ...valid,
      inputs: [{ ...valid.inputs[0], min: 0, max: 5, defaultValue: 99 }],
    });
    expect(outOfRangeDefault.ok).toBe(false);
  });

  it("enforces select defaultValue is one of options[].value", () => {
    const badSelectDefault = validateSandboxConfig({
      ...valid,
      inputs: [{ ...valid.inputs[1], defaultValue: 12345 }],
    });
    expect(badSelectDefault.ok).toBe(false);
    if (!badSelectDefault.ok) expect(badSelectDefault.errors.join(" ")).toMatch(/defaultValue must match one of the option values/);
  });

  it("rejects swap overlay bands that are not sorted ascending by upTo", () => {
    const unsorted = validateSandboxConfig({
      ...valid,
      visual: {
        overlays: [{
          id: "s1", type: "swap", outputId: "volume", box: { x: 0, y: 0, w: 10, h: 10 },
          bands: [{ upTo: 5, assetId: "a1" }, { upTo: 2, assetId: "a2" }],
        }],
      },
    });
    expect(unsorted.ok).toBe(false);
    if (!unsorted.ok) expect(unsorted.errors.join(" ")).toMatch(/sorted ascending/);

    const sorted = validateSandboxConfig({
      ...valid,
      visual: {
        overlays: [{
          id: "s1", type: "swap", outputId: "volume", box: { x: 0, y: 0, w: 10, h: 10 },
          bands: [{ upTo: 2, assetId: "a2" }, { upTo: 5, assetId: "a1" }],
        }],
      },
    });
    expect(sorted.ok).toBe(true);
  });

  it("rejects a between challenge where min is not strictly less than max", () => {
    const r = validateSandboxConfig({
      ...valid,
      challenges: [{ id: "ch1", prompt: "p", outputId: "volume", comparator: "between", min: 5, max: 5 }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/between.*min < max/);
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
