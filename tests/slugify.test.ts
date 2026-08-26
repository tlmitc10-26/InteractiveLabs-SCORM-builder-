import { describe, it, expect } from "vitest";
import { slugify, uniqueSlug } from "@/app/interactives/[id]/slugify";

describe("slugify", () => {
  it("lowercases and replaces spaces with underscores", () => {
    expect(slugify("Object mass")).toBe("object_mass");
  });

  it("guarantees a letter/underscore start when the label starts with a digit", () => {
    expect(slugify("  7 Up! ")).toBe("n_7_up");
  });

  it("collapses repeated separators and trims leading/trailing underscores", () => {
    expect(slugify("  Fluid   Density!!  ")).toBe("fluid_density");
  });

  it("strips characters outside [a-z0-9_]", () => {
    expect(slugify("Volume (L)")).toBe("volume_l");
  });

  it("falls back when the label has no sluggable characters", () => {
    expect(slugify("!!!", "input")).toBe("input");
    expect(slugify("", "input")).toBe("input");
  });

  it("caps length well under the schema's 40-char id limit", () => {
    const long = "a".repeat(100);
    const s = slugify(long);
    expect(s.length).toBeLessThanOrEqual(40);
  });

  it("already-valid-looking labels pass through unchanged", () => {
    expect(slugify("mass")).toBe("mass");
    expect(slugify("density_2")).toBe("density_2");
  });
});

describe("uniqueSlug", () => {
  it("returns the plain slug when there's no collision", () => {
    expect(uniqueSlug("New input", new Set())).toBe("new_input");
  });

  it("suffixes with _2, _3, ... on collision", () => {
    const existing = new Set(["mass", "mass_2"]);
    expect(uniqueSlug("Mass", existing)).toBe("mass_3");
  });

  it("never exceeds the 40-char id cap even with a suffix", () => {
    const long = "a".repeat(100);
    const existing = new Set([slugify(long)]);
    const s = uniqueSlug(long, existing);
    expect(s.length).toBeLessThanOrEqual(40);
    expect(existing.has(s)).toBe(false);
  });

  it("never returns an empty string", () => {
    expect(uniqueSlug("!!!", new Set(), "input").length).toBeGreaterThan(0);
  });
});
