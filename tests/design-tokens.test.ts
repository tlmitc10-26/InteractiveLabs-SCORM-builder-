import { describe, it, expect } from "vitest";
import {
  RDS_COLOR_NAMES, colorHex, isTokenName,
  emitRootVariables, emitAppThemeCss, emitEngineTokensCss,
} from "@/lib/design/tokens";

describe("design tokens", () => {
  it("exposes the 16 RDS colors", () => {
    expect(RDS_COLOR_NAMES).toHaveLength(16);
    expect(colorHex("primary")).toBe("#8c1d40");
    expect(colorHex("secondary")).toBe("#ffc627");
    expect(isTokenName("info")).toBe(true);
    expect(isTokenName("hotpink")).toBe(false);
  });
  it("emits --rds-* root variables for every color", () => {
    const css = emitRootVariables();
    expect(css).toContain("--rds-primary: #8c1d40;");
    expect(css).toContain("--rds-dark-3: #191919;");
    expect((css.match(/--rds-/g) ?? []).length).toBeGreaterThanOrEqual(16);
  });
  it("app theme css maps tokens into Tailwind @theme", () => {
    const css = emitAppThemeCss();
    expect(css).toContain("@theme");
    expect(css).toContain("--color-rds-primary: #8c1d40;");
    expect(css).toContain("GENERATED FILE");
  });
  it("app theme css emits --radius-pill and --radius-card (both consumed: app buttons and engine stage-controls)", () => {
    const css = emitAppThemeCss();
    expect(css).toContain("--radius-pill: 50rem;");
    expect(css).toContain("--radius-card: 8px;");
  });
  it("engine tokens css carries variables plus lesson font tokens", () => {
    const css = emitEngineTokensCss();
    expect(css).toContain(":root {");
    expect(css).toContain("--rds-primary: #8c1d40;");
    expect(css).toContain("--ilb-font-heading: Georgia");
    expect(css).toContain("--ilb-font-body: Arial");
  });
  it("engine tokens css emits --radius-card (consumed by .ilb-stage-control in engine.css) and no longer emits the unconsumed --ilb-min-target", () => {
    const css = emitEngineTokensCss();
    expect(css).toContain("--radius-card: 8px;");
    expect(css).not.toContain("--ilb-min-target");
  });
  it("engine tokens css emits spacing/radius-chip/elevation/motion tokens consumed by the visual pass", () => {
    const css = emitEngineTokensCss();
    expect(css).toContain("--sp-1: 4px;");
    expect(css).toContain("--sp-2: 8px;");
    expect(css).toContain("--sp-3: 12px;");
    expect(css).toContain("--sp-4: 16px;");
    expect(css).toContain("--sp-5: 24px;");
    expect(css).toContain("--sp-6: 32px;");
    expect(css).toContain("--radius-chip: 999px;");
    expect(css).toContain("--elev-card: 0 1px 3px rgba(25,25,25,.08), 0 4px 14px rgba(25,25,25,.06);");
    expect(css).toContain("--motion-fast: 150ms;");
  });
  it("app theme css emits the same spacing/radius-chip/elevation/motion tokens (harmless for future app use)", () => {
    const css = emitAppThemeCss();
    expect(css).toContain("--sp-1: 4px;");
    expect(css).toContain("--sp-6: 32px;");
    expect(css).toContain("--radius-chip: 999px;");
    expect(css).toContain("--elev-card: 0 1px 3px rgba(25,25,25,.08), 0 4px 14px rgba(25,25,25,.06);");
    expect(css).toContain("--motion-fast: 150ms;");
  });
});
