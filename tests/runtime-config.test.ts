import { describe, it, expect } from "vitest";
import {
  migrateLegacyColors, colorRefToCss, resolveColorHex, toRuntimeConfig, toDisplayColorRef,
  type ColorRef, type SandboxConfigLike,
} from "@/lib/engines/param-sandbox/runtime-config";

const baseConfig: SandboxConfigLike = {
  title: "T",
  inputs: [{ id: "x", label: "x", type: "slider", min: 0, max: 10, step: 1, defaultValue: 5 }],
  outputs: [{ id: "y", label: "y", formula: "x * 2" }],
  charts: [],
  challenges: [],
};

describe("migrateLegacyColors", () => {
  it("rewrites a fill overlay's bare-hex-string color into { hex }", () => {
    const raw = {
      ...baseConfig,
      visual: { overlays: [{ id: "ov1", type: "fill", outputId: "y", inMin: 0, inMax: 10, color: "#4a90d9", box: { x: 0, y: 0, w: 10, h: 10 } }] },
    };
    const migrated = migrateLegacyColors(raw) as typeof raw & { visual: { overlays: Array<{ color: unknown }> } };
    expect(migrated.visual.overlays[0].color).toEqual({ hex: "#4a90d9" });
    // original reference is untouched (no in-place mutation)
    expect((raw as { visual: { overlays: Array<{ color: unknown }> } }).visual.overlays[0].color).toBe("#4a90d9");
  });

  it("leaves an already-migrated { token } color untouched", () => {
    const raw = {
      ...baseConfig,
      visual: { overlays: [{ id: "ov1", type: "fill", outputId: "y", inMin: 0, inMax: 10, color: { token: "info" }, box: { x: 0, y: 0, w: 10, h: 10 } }] },
    };
    expect(migrateLegacyColors(raw)).toBe(raw); // identity: nothing changed, no copy made
  });

  it("leaves an already-migrated { hex } color untouched", () => {
    const raw = {
      ...baseConfig,
      visual: { overlays: [{ id: "ov1", type: "fill", outputId: "y", inMin: 0, inMax: 10, color: { hex: "#4a90d9" }, box: { x: 0, y: 0, w: 10, h: 10 } }] },
    };
    expect(migrateLegacyColors(raw)).toBe(raw);
  });

  it("leaves garbage color values untouched for the validator to reject (not a color string, not the right shape)", () => {
    const rawNumber = {
      ...baseConfig,
      visual: { overlays: [{ id: "ov1", type: "fill", outputId: "y", inMin: 0, inMax: 10, color: 12345, box: { x: 0, y: 0, w: 10, h: 10 } }] },
    };
    expect(migrateLegacyColors(rawNumber)).toBe(rawNumber);

    const rawMalformedHex = {
      ...baseConfig,
      visual: { overlays: [{ id: "ov1", type: "fill", outputId: "y", inMin: 0, inMax: 10, color: "not-a-color", box: { x: 0, y: 0, w: 10, h: 10 } }] },
    };
    expect(migrateLegacyColors(rawMalformedHex)).toBe(rawMalformedHex);

    const rawTooShortHex = {
      ...baseConfig,
      visual: { overlays: [{ id: "ov1", type: "fill", outputId: "y", inMin: 0, inMax: 10, color: "#fff", box: { x: 0, y: 0, w: 10, h: 10 } }] },
    };
    expect(migrateLegacyColors(rawTooShortHex)).toBe(rawTooShortHex);
  });

  it("only migrates fill overlays, not swap/transform (which have no color field)", () => {
    const raw = {
      ...baseConfig,
      visual: {
        overlays: [{ id: "ov1", type: "swap", outputId: "y", box: { x: 0, y: 0, w: 10, h: 10 }, bands: [{ upTo: 5, assetId: "a1" }] }],
      },
    };
    expect(migrateLegacyColors(raw)).toBe(raw);
  });

  it("is defensive against missing/malformed visual or overlays without throwing", () => {
    expect(migrateLegacyColors(null)).toBe(null);
    expect(migrateLegacyColors(undefined)).toBe(undefined);
    expect(migrateLegacyColors("a string")).toBe("a string");
    expect(migrateLegacyColors({ ...baseConfig })).toEqual(baseConfig); // no visual key at all
    expect(migrateLegacyColors({ ...baseConfig, visual: {} })).toEqual({ ...baseConfig, visual: {} }); // visual with no overlays array
    expect(migrateLegacyColors({ ...baseConfig, visual: { overlays: [null, "not-an-overlay"] } })).toEqual({
      ...baseConfig, visual: { overlays: [null, "not-an-overlay"] },
    });
  });
});

describe("editor-crash regression: a legacy draft survives migration and resolves to a usable CSS value", () => {
  it("migrateLegacyColors + colorRefToCss round-trip a legacy bare-hex config the way the editor/page.tsx pipeline does", () => {
    const raw = {
      ...baseConfig,
      visual: { overlays: [{ id: "ov1", type: "fill", outputId: "y", inMin: 0, inMax: 10, color: "#4a90d9", box: { x: 0, y: 0, w: 10, h: 10 } }] },
    };
    const migrated = migrateLegacyColors(raw) as SandboxConfigLike;
    const overlay = migrated.visual!.overlays[0];
    if (overlay.type !== "fill") throw new Error("expected fill overlay");
    // This is exactly what previously crashed/silently no-op'd in the
    // editor's color-field bridge and toPreviewRuntime before the
    // runtime-config extraction: calling `"token" in color` /
    // colorRefToCss(color) on a value that was still a bare string.
    expect(colorRefToCss(overlay.color)).toBe("#4a90d9");
    expect(resolveColorHex(overlay.color)).toBe("#4a90d9");
  });

  it("toDisplayColorRef tolerates a bare string so a display helper never does `in` on a string", () => {
    const wrapped = toDisplayColorRef("#4a90d9");
    expect(wrapped).toEqual({ hex: "#4a90d9" });
    expect("token" in wrapped).toBe(false);
    expect((wrapped as { hex: string }).hex).toBe("#4a90d9");

    const passthroughToken = toDisplayColorRef({ token: "info" } as ColorRef);
    expect(passthroughToken).toEqual({ token: "info" });
  });
});

describe("toRuntimeConfig / colorRefToCss / resolveColorHex (moved from schema.ts, imported directly from the light module)", () => {
  it("colorRefToCss maps a token to a css variable reference and a hex to itself", () => {
    expect(colorRefToCss({ token: "info" } as ColorRef)).toBe("var(--rds-info)");
    expect(colorRefToCss({ hex: "#e8e8e8" } as ColorRef)).toBe("#e8e8e8");
  });

  it("resolveColorHex resolves a token to its hex and passes a hex through", () => {
    expect(resolveColorHex({ token: "info" } as ColorRef)).toBe("#00a3e0");
    expect(resolveColorHex({ hex: "#e8e8e8" } as ColorRef)).toBe("#e8e8e8");
  });

  it("replaces asset ids with resolved urls and maps overlay colors to css values", () => {
    const config: SandboxConfigLike = {
      ...baseConfig,
      visual: {
        backgroundAssetId: "asset_abc",
        overlays: [{ id: "ov1", type: "fill", outputId: "y", inMin: 0, inMax: 10, color: { token: "primary" }, box: { x: 0, y: 0, w: 10, h: 10 } }],
      },
    };
    const rt = toRuntimeConfig(config, (assetId) => `assets/${assetId}.png`);
    expect(rt.visual?.backgroundUrl).toBe("assets/asset_abc.png");
    const overlay = rt.visual?.overlays[0] as { type: string; color: string };
    expect(overlay.color).toBe("var(--rds-primary)");
  });
});
