import { describe, it, expect } from "vitest";
import { contrastRatio, meetsNonText, meetsBodyText, ratioLabel } from "@/lib/design/contrast";

describe("contrastRatio", () => {
  it("black on white is 21:1, self is 1:1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#8c1d40", "#8c1d40")).toBeCloseTo(1, 5);
  });
  it("is symmetric", () => {
    expect(contrastRatio("#8c1d40", "#ffffff")).toBeCloseTo(contrastRatio("#ffffff", "#8c1d40"), 6);
  });
  it("known ASU pairs", () => {
    expect(contrastRatio("#8c1d40", "#ffffff")).toBeGreaterThan(8.5);  // maroon on white ≈ 8.9
    expect(contrastRatio("#ffc627", "#000000")).toBeGreaterThan(12);   // gold on black
    expect(contrastRatio("#ffc627", "#ffffff")).toBeLessThan(2);       // gold on white fails
  });
  it("accepts 3-digit hex and mixed case", () => {
    expect(contrastRatio("#FFF", "#000")).toBeCloseTo(21, 1);
  });
  it("throws on malformed input", () => {
    expect(() => contrastRatio("red", "#fff")).toThrow(/hex/i);
  });
});

describe("thresholds", () => {
  it("non-text 3:1, body text 4.5:1", () => {
    expect(meetsNonText(3.0)).toBe(true);
    expect(meetsNonText(2.99)).toBe(false);
    expect(meetsBodyText(4.5)).toBe(true);
    expect(meetsBodyText(4.49)).toBe(false);
  });
  it("ratioLabel formats for designers", () => {
    expect(ratioLabel(8.876)).toBe("8.9:1");
  });
});
