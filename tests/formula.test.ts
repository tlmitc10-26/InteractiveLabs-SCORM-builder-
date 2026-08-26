import { describe, it, expect } from "vitest";
import { parseFormula } from "@/lib/formula/parser";
import { evaluateFormula, collectIdentifiers } from "@/lib/formula/evaluate";

function evalOk(src: string, vars: Record<string, number> = {}): number {
  const r = parseFormula(src);
  if (!r.ok) throw new Error(r.error);
  return evaluateFormula(r.ast, vars);
}

describe("parseFormula/evaluateFormula", () => {
  it("arithmetic with precedence", () => {
    expect(evalOk("2 + 3 * 4")).toBe(14);
    expect(evalOk("(2 + 3) * 4")).toBe(20);
    expect(evalOk("2 ^ 3 ^ 2")).toBe(512); // right-assoc
    expect(evalOk("-3 ^ 2")).toBe(-9);     // unary binds looser than ^
  });
  it("variables and constants", () => {
    expect(evalOk("mass / volume", { mass: 10, volume: 4 })).toBe(2.5);
    expect(evalOk("2 * pi")).toBeCloseTo(6.2831853, 5);
  });
  it("whitelisted functions", () => {
    expect(evalOk("min(3, 2, 5)")).toBe(2);
    expect(evalOk("round(sqrt(2) * 100)")).toBe(141);
    expect(evalOk("log10(1000)")).toBeCloseTo(3);
  });
  it("rejects unknown functions at parse time", () => {
    const r = parseFormula("fetch(1)");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unknown function/i);
  });
  it("rejects garbage and out-of-grammar syntax", () => {
    expect(parseFormula("2 +").ok).toBe(false);
    expect(parseFormula("a; alert(1)").ok).toBe(false);
    expect(parseFormula("a[0]").ok).toBe(false);
    expect(parseFormula("").ok).toBe(false);
  });
  it("throws a FormulaError naming unknown variables at eval time", () => {
    const r = parseFormula("x + y");
    if (!r.ok) throw new Error("should parse");
    expect(() => evaluateFormula(r.ast, { x: 1 })).toThrow(/unknown variable "y"/i);
  });
  it("division by zero and NaN become an error, never NaN output", () => {
    const r = parseFormula("1 / x");
    if (!r.ok) throw new Error("should parse");
    expect(() => evaluateFormula(r.ast, { x: 0 })).toThrow(/not a finite number/i);
    const s = parseFormula("sqrt(0 - 1)");
    if (!s.ok) throw new Error("should parse");
    expect(() => evaluateFormula(s.ast, {})).toThrow(/not a finite number/i);
  });
  it("collectIdentifiers returns variable refs, not constants/functions", () => {
    const r = parseFormula("min(mass, 2) * pi + depth");
    if (!r.ok) throw new Error("should parse");
    expect(collectIdentifiers(r.ast).sort()).toEqual(["depth", "mass"]);
  });
  it("prototype-chain names are not variables", () => {
    const r = parseFormula("constructor + 1");
    if (!r.ok) throw new Error("should parse");
    expect(() => evaluateFormula(r.ast, {})).toThrow(/unknown variable/i);
  });
  it("rejects zero-arg function calls", () => {
    expect(parseFormula("min()").ok).toBe(false);
  });
  it("rejects overflowing numeric literals at parse time", () => {
    const r = parseFormula("1e309");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/too large/i);
  });
  it("degrades gracefully on deeply nested input instead of throwing", () => {
    const r = parseFormula("(".repeat(5000) + "1" + ")".repeat(5000));
    expect(r.ok).toBe(false);
  });
  it("rejects formulas longer than the length cap", () => {
    const r = parseFormula("x".repeat(1001));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/too long/i);
  });
});
