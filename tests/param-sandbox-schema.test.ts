import { describe, it, expect } from "vitest";
import {
  validateSandboxConfig, toRuntimeConfig, emptySandboxConfig,
  colorRefToCss, resolveColorHex, type ColorRef,
} from "@/lib/engines/param-sandbox/schema";

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
  it("no longer entity-escapes plain text, so a run of raw '&' chars under the cap is stored unchanged and stays valid", () => {
    // sanitizePlainText strips tags only (no entity escaping) — a value
    // that would previously have been inflated past the label's 120-char
    // cap (100 "&" -> 500 "&amp;" chars) is now stored byte-for-byte, well
    // under the cap.
    const r = validateSandboxConfig({
      ...valid,
      inputs: [{ ...valid.inputs[0], label: "&".repeat(100) }, valid.inputs[1]],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.inputs[0].label).toBe("&".repeat(100));
  });

  it("still enforces the declared length cap on the raw input (tag-stripping can only shrink, never rescue an over-cap input)", () => {
    const r = validateSandboxConfig({
      ...valid,
      inputs: [{ ...valid.inputs[0], label: "x".repeat(121) }, valid.inputs[1]],
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

  it("maps a legacy bare-hex fill overlay color to the resolved hex in the runtime css value", () => {
    const r = validateSandboxConfig(valid); // valid.visual.overlays[0].color === "#4a90d9" (legacy bare string)
    if (!r.ok) throw new Error("valid fixture");
    const rt = toRuntimeConfig(r.config, (assetId) => `assets/${assetId}.png`);
    const fill = rt.visual?.overlays.find((o) => o.type === "fill") as { color: string } | undefined;
    expect(fill?.color).toBe("#4a90d9");
  });

  it("maps a token fill overlay color to a var(--rds-*) runtime css value", () => {
    const withToken = {
      ...valid,
      visual: {
        backgroundAssetId: "asset_abc",
        overlays: [{ id: "water", type: "fill", outputId: "volume", inMin: 0, inMax: 10, color: { token: "info" }, box: { x: 20, y: 10, w: 60, h: 80 } }],
      },
    };
    const r = validateSandboxConfig(withToken);
    if (!r.ok) throw new Error(`expected valid: ${JSON.stringify((r as { errors: string[] }).errors)}`);
    const rt = toRuntimeConfig(r.config, (assetId) => `assets/${assetId}.png`);
    const fill = rt.visual?.overlays.find((o) => o.type === "fill") as { color: string } | undefined;
    expect(fill?.color).toBe("var(--rds-info)");
  });
});

describe("hybrid color model (ColorRef)", () => {
  it("colorRefToCss maps a token to a css variable reference and a hex to itself", () => {
    expect(colorRefToCss({ token: "info" } as ColorRef)).toBe("var(--rds-info)");
    expect(colorRefToCss({ hex: "#e8e8e8" } as ColorRef)).toBe("#e8e8e8");
  });

  it("resolveColorHex resolves a token to its hex and passes a hex through", () => {
    expect(resolveColorHex({ token: "info" } as ColorRef)).toBe("#00a3e0");
    expect(resolveColorHex({ hex: "#e8e8e8" } as ColorRef)).toBe("#e8e8e8");
  });

  it("accepts a token color on a fill overlay with no background image", () => {
    const cfg = {
      ...valid,
      visual: {
        overlays: [{ id: "water", type: "fill", outputId: "volume", inMin: 0, inMax: 10, color: { token: "primary" }, box: { x: 20, y: 10, w: 60, h: 80 } }],
      },
    };
    const r = validateSandboxConfig(cfg);
    expect(r.ok).toBe(true);
  });

  it("blocks a low-contrast hex fill color against the default stage background when no background image is set", () => {
    const cfg = {
      ...valid,
      visual: {
        overlays: [{ id: "water", type: "fill", outputId: "volume", inMin: 0, inMax: 10, color: { hex: "#e8e8e8" }, box: { x: 20, y: 10, w: 60, h: 80 } }],
      },
    };
    const r = validateSandboxConfig(cfg);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join(" ")).toMatch(/overlay "water": fill color fails 3:1 contrast against the stage background \(\d\.\d:1\) — pick a stronger color/);
    }
  });

  it("allows the same low-contrast hex fill color when a background image is set (advisory only)", () => {
    const cfg = {
      ...valid,
      visual: {
        backgroundAssetId: "asset_abc",
        overlays: [{ id: "water", type: "fill", outputId: "volume", inMin: 0, inMax: 10, color: { hex: "#e8e8e8" }, box: { x: 20, y: 10, w: 60, h: 80 } }],
      },
    };
    const r = validateSandboxConfig(cfg);
    expect(r.ok).toBe(true);
  });

  it("migrates a legacy bare-hex string color and validates it", () => {
    const cfg = {
      ...valid,
      visual: {
        backgroundAssetId: "asset_abc",
        overlays: [{ id: "water", type: "fill", outputId: "volume", inMin: 0, inMax: 10, color: "#4a90d9", box: { x: 20, y: 10, w: 60, h: 80 } }],
      },
    };
    const r = validateSandboxConfig(cfg);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const overlay = r.config.visual?.overlays[0];
      expect(overlay && "color" in overlay ? overlay.color : undefined).toEqual({ hex: "#4a90d9" });
    }
  });

  it("rejects an unknown color token", () => {
    const cfg = {
      ...valid,
      visual: {
        backgroundAssetId: "asset_abc",
        overlays: [{ id: "water", type: "fill", outputId: "volume", inMin: 0, inMax: 10, color: { token: "hotpink" }, box: { x: 20, y: 10, w: 60, h: 80 } }],
      },
    };
    expect(validateSandboxConfig(cfg).ok).toBe(false);
  });
});
