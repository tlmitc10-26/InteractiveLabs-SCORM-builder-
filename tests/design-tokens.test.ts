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
  it("engine tokens css carries variables plus lesson font tokens", () => {
    const css = emitEngineTokensCss();
    expect(css).toContain(":root {");
    expect(css).toContain("--rds-primary: #8c1d40;");
    expect(css).toContain("--ilb-font-heading: Georgia");
    expect(css).toContain("--ilb-font-body: Arial");
  });
});
