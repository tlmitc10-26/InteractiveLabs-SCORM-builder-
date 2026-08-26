import { describe, it, expect } from "vitest";
import { validateSandboxConfig, toRuntimeConfig } from "@/lib/engines/param-sandbox/schema";

const base = {
  title: "Placement test",
  inputs: [
    { id: "mass", label: "Mass", type: "slider", min: 0, max: 10, step: 1, defaultValue: 5 },
  ],
  outputs: [
    { id: "double", label: "Double", formula: "mass * 2" },
  ],
  charts: [],
  challenges: [],
};

describe("placement schema", () => {
  it("input/output placement is absent (defaults to panel) when not authored, and layout defaults to side", () => {
    const r = validateSandboxConfig(base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.inputs[0].placement).toBeUndefined();
      expect(r.config.outputs[0].placement).toBeUndefined();
      expect(r.config.layout).toBe("side");
    }
  });

  it("accepts explicit panel and below zone placements", () => {
    const cfg = {
      ...base,
      inputs: [{ ...base.inputs[0], placement: { zone: "panel" } }],
      outputs: [{ ...base.outputs[0], placement: { zone: "below" } }],
    };
    const r = validateSandboxConfig(cfg);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.inputs[0].placement).toEqual({ zone: "panel" });
      expect(r.config.outputs[0].placement).toEqual({ zone: "below" });
    }
  });

  it("accepts a stage-zone placement with a box when a visual scene exists", () => {
    const cfg = {
      ...base,
      inputs: [{ ...base.inputs[0], placement: { zone: "stage", box: { x: 10, y: 10, w: 20, h: 20 } } }],
      visual: {},
    };
    const r = validateSandboxConfig(cfg);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.inputs[0].placement).toEqual({ zone: "stage", box: { x: 10, y: 10, w: 20, h: 20 } });
  });

  it('blocks a stage-zone input placement when no visual scene exists, naming the input', () => {
    const cfg = {
      ...base,
      inputs: [{ ...base.inputs[0], placement: { zone: "stage", box: { x: 10, y: 10, w: 20, h: 20 } } }],
    };
    const r = validateSandboxConfig(cfg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/input "mass": placement zone "stage" requires a visual scene/);
  });

  it('blocks a stage-zone output placement when no visual scene exists, naming the output', () => {
    const cfg = {
      ...base,
      outputs: [{ ...base.outputs[0], placement: { zone: "stage", box: { x: 10, y: 10, w: 20, h: 20 } } }],
    };
    const r = validateSandboxConfig(cfg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/output "double": placement zone "stage" requires a visual scene/);
  });

  it("rejects an unknown placement zone", () => {
    const cfg = { ...base, inputs: [{ ...base.inputs[0], placement: { zone: "nowhere" } }] };
    expect(validateSandboxConfig(cfg).ok).toBe(false);
  });

  it("rejects a stage placement missing its box", () => {
    const cfg = { ...base, visual: {}, inputs: [{ ...base.inputs[0], placement: { zone: "stage" } }] };
    expect(validateSandboxConfig(cfg).ok).toBe(false);
  });

  it("rejects a panel/below placement carrying a box (strict union, extra key)", () => {
    const cfg = { ...base, inputs: [{ ...base.inputs[0], placement: { zone: "panel", box: { x: 0, y: 0, w: 1, h: 1 } } }] };
    expect(validateSandboxConfig(cfg).ok).toBe(false);
  });
});

describe("layout preset", () => {
  it("defaults to side when omitted", () => {
    const r = validateSandboxConfig(base);
    if (r.ok) expect(r.config.layout).toBe("side");
  });

  it("accepts stacked and stage-focus", () => {
    expect(validateSandboxConfig({ ...base, layout: "stacked" }).ok).toBe(true);
    expect(validateSandboxConfig({ ...base, layout: "stage-focus" }).ok).toBe(true);
  });

  it("rejects an unknown layout value", () => {
    expect(validateSandboxConfig({ ...base, layout: "grid" }).ok).toBe(false);
  });
});

describe("toRuntimeConfig passthrough (placement + layout)", () => {
  it("passes placement and layout through unchanged", () => {
    const cfg = {
      ...base,
      layout: "stacked",
      inputs: [{ ...base.inputs[0], placement: { zone: "below" } }],
      outputs: [{ ...base.outputs[0], placement: { zone: "stage", box: { x: 1, y: 2, w: 3, h: 4 } } }],
      visual: {},
    };
    const r = validateSandboxConfig(cfg);
    if (!r.ok) throw new Error(`expected valid: ${JSON.stringify(r.errors)}`);
    const rt = toRuntimeConfig(r.config, (id) => `assets/${id}`);
    expect(rt.layout).toBe("stacked");
    expect(rt.inputs[0].placement).toEqual({ zone: "below" });
    expect(rt.outputs[0].placement).toEqual({ zone: "stage", box: { x: 1, y: 2, w: 3, h: 4 } });
  });

  it("passes a config with no placement/layout authored through with layout defaulted to side", () => {
    const r = validateSandboxConfig(base);
    if (!r.ok) throw new Error("valid fixture");
    const rt = toRuntimeConfig(r.config, (id) => `assets/${id}`);
    expect(rt.layout).toBe("side");
    expect(rt.inputs[0].placement).toBeUndefined();
  });
});
