import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { parseSandboxCompanionDoc, serializeSandboxCompanionDoc, type SandboxConfigLike } from "@/lib/engines/param-sandbox/companion-doc";
import type { ImportIssue } from "@/lib/engines/branching-scenario/companion-doc";
import { validateSandboxConfig, sandboxConfigSchema, type SandboxConfig } from "@/lib/engines/param-sandbox/schema";
import { STARTERS } from "@/lib/engines/param-sandbox/starter-configs";
import { parseFormula } from "@/lib/formula/parser";
import { evaluateFormula, collectIdentifiers } from "@/lib/formula/evaluate";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lineOf(sourceLines: string[], needle: string): number {
  const idx = sourceLines.findIndex((l) => l.includes(needle));
  if (idx === -1) throw new Error(`fixture bug: "${needle}" not found in fixture`);
  return idx + 1;
}

function errors(report: ImportIssue[]): ImportIssue[] {
  return report.filter((r) => r.severity === "error");
}
function warnings(report: ImportIssue[]): ImportIssue[] {
  return report.filter((r) => r.severity === "warning");
}
function stripTags(s: string | undefined): string {
  return (s ?? "").replace(/<[^>]+>/g, "").trim();
}

/** Structural-equality helper: reshapes a validated SandboxConfig into a
 *  label-keyed (not id-keyed) plain object so two configs that differ only
 *  in generated ids compare equal via `toEqual`. Mirrors companion-doc.test.ts's
 *  by-title comparisons for the branching format. */
function toLabeledShape(config: SandboxConfig) {
  const labelOf = (id: string): string => {
    const inp = config.inputs.find((i) => i.id === id);
    if (inp) return inp.label;
    const out = config.outputs.find((o) => o.id === id);
    if (out) return out.label;
    return id;
  };
  const formulaByLabels = (formula: string): string => {
    const r = parseFormula(formula);
    if (!r.ok) return formula;
    // Replace each identifier with its label so formulas that are
    // structurally identical modulo id spelling compare equal. Longest-id
    // first so one id can't clobber a substring of another.
    const ids = [...new Set(collectIdentifiers(r.ast))].sort((a, b) => b.length - a.length);
    let text = formula;
    for (const id of ids) {
      text = text.replace(new RegExp(`\\b${id}\\b`, "g"), labelOf(id));
    }
    return text;
  };
  return {
    title: config.title,
    intro: stripTags(config.intro),
    inputs: config.inputs.map((i) => ({
      label: i.label,
      type: i.type,
      min: i.min,
      max: i.max,
      step: i.step,
      defaultValue: i.defaultValue,
      units: i.units,
      options: i.options,
    })),
    outputs: config.outputs.map((o) => ({
      label: o.label,
      units: o.units,
      decimals: o.decimals,
      formula: formulaByLabels(o.formula),
    })),
    charts: config.charts.map((c) => ({
      title: c.title,
      samples: c.samples,
      xLabel: labelOf(c.xInputId),
      yLabel: labelOf(c.yOutputId),
    })),
    challenges: config.challenges.map((c) => ({
      prompt: c.prompt,
      outputLabel: labelOf(c.outputId),
      comparator: c.comparator,
      value: c.value,
      min: c.min,
      max: c.max,
    })),
  };
}

// ---------------------------------------------------------------------------
// The normative example (spec §5), copied VERBATIM.
// ---------------------------------------------------------------------------
const NORMATIVE_EXAMPLE = `TITLE: Break-Even Studio
INTRO: Set a price and see when the venture stops losing money.

INPUT: Price (slider, $, 5 to 60, step 1, start 20)
INPUT: Unit cost (slider, $, 1 to 40, step 1, start 12)
INPUT: Fixed costs (slider, $, 1000 to 50000, step 500, start 12000)
INPUT: Volume (slider, units, 0 to 10000, step 100, start 2000)

OUTPUT: Contribution margin ($, 2 decimals) = Price - Unit cost
OUTPUT: Break-even units (units, 0 decimals) = Fixed costs / (Price - Unit cost)
OUTPUT: Profit ($, 2 decimals) = (Price - Unit cost) * Volume - Fixed costs

CHART: Profit vs Volume (40 samples, titled Profit against sales volume)

CHALLENGE: Reach a profit of at least $1 -> Profit at least 1
CHALLENGE: Break even at 3000 units or fewer -> Break-even units at most 3000
`;

describe("parseSandboxCompanionDoc — normative example (spec §5, verbatim)", () => {
  const { config, report } = parseSandboxCompanionDoc(NORMATIVE_EXAMPLE);

  it("never throws and returns a config that validates with zero errors", () => {
    expect(errors(report), JSON.stringify(report)).toHaveLength(0);
    const r = validateSandboxConfig(config);
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });

  it("captures TITLE, INTRO, all 4 inputs, all 3 outputs, 1 chart, 2 challenges", () => {
    const r = validateSandboxConfig(config) as { ok: true; config: SandboxConfig };
    expect(r.config.title).toBe("Break-Even Studio");
    expect(r.config.intro).toContain("Set a price");
    expect(r.config.inputs).toHaveLength(4);
    expect(r.config.outputs).toHaveLength(3);
    expect(r.config.charts).toHaveLength(1);
    expect(r.config.challenges).toHaveLength(2);
  });

  it("resolves formulas by label (Price - Unit cost, etc.) into valid ids that evaluate correctly at a sample point", () => {
    const r = validateSandboxConfig(config) as { ok: true; config: SandboxConfig };
    const byInputLabel = (label: string) => r.config.inputs.find((i) => i.label === label)!;
    const byOutputLabel = (label: string) => r.config.outputs.find((o) => o.label === label)!;
    const price = byInputLabel("Price");
    const unitCost = byInputLabel("Unit cost");
    const fixedCosts = byInputLabel("Fixed costs");
    const volume = byInputLabel("Volume");
    const vars: Record<string, number> = {
      [price.id]: 20,
      [unitCost.id]: 12,
      [fixedCosts.id]: 12000,
      [volume.id]: 2000,
    };
    const margin = byOutputLabel("Contribution margin");
    const marginAst = parseFormula(margin.formula);
    expect(marginAst.ok).toBe(true);
    if (marginAst.ok) expect(evaluateFormula(marginAst.ast, vars)).toBe(8);

    const profit = byOutputLabel("Profit");
    vars[margin.id] = 8;
    const profitAst = parseFormula(profit.formula);
    expect(profitAst.ok).toBe(true);
    if (profitAst.ok) expect(evaluateFormula(profitAst.ast, vars)).toBe(8 * 2000 - 12000);
  });

  it("gives the chart its explicit title and sample count, and resolves the challenges to the right output/comparator", () => {
    const r = validateSandboxConfig(config) as { ok: true; config: SandboxConfig };
    expect(r.config.charts[0]).toMatchObject({ title: "Profit against sales volume", samples: 40 });
    const profit = r.config.outputs.find((o) => o.label === "Profit")!;
    const breakEven = r.config.outputs.find((o) => o.label === "Break-even units")!;
    expect(r.config.challenges[0]).toMatchObject({ outputId: profit.id, comparator: "gte", value: 1 });
    expect(r.config.challenges[1]).toMatchObject({ outputId: breakEven.id, comparator: "lte", value: 3000 });
  });
});

// ---------------------------------------------------------------------------
// INPUT grammar
// ---------------------------------------------------------------------------

describe("parseSandboxCompanionDoc — INPUT grammar: slider/number", () => {
  it("parses a well-formed slider input with zero issues", () => {
    const doc = ["TITLE: T", "", "INPUT: Speed (slider, mph, 0 to 100, step 5, start 30)", "", "OUTPUT: Y (mph) = Speed"].join("\n");
    const { config, report } = parseSandboxCompanionDoc(doc);
    expect(errors(report)).toHaveLength(0);
    const r = validateSandboxConfig(config) as { ok: true; config: SandboxConfig };
    expect(r.config.inputs[0]).toMatchObject({ label: "Speed", type: "slider", units: "mph", min: 0, max: 100, step: 5, defaultValue: 30 });
  });

  it("reports an error naming the expected shape for a malformed INPUT line, and skips it", () => {
    const lines = ["TITLE: T", "", "INPUT: Broken input definition", "", "INPUT: X (slider, u, 0 to 10, step 1, start 5)", "", "OUTPUT: Y (u) = X"];
    const { config, report } = parseSandboxCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "Broken input") && /slider\|number/i.test(e.message))).toBe(true);
    const r = validateSandboxConfig(config) as { ok: true; config: SandboxConfig };
    expect(r.config.inputs.some((i) => i.label === "Broken input definition")).toBe(false);
  });
});

describe("parseSandboxCompanionDoc — INPUT grammar: select", () => {
  it("marks the option with '*' as the default", () => {
    const doc = [
      "TITLE: T",
      "",
      "INPUT: Fluid (select, kg/m3: Fresh water=1000, Vegetable oil=920*, Seawater=1025)",
      "",
      "OUTPUT: Y (kg/m3) = Fluid",
    ].join("\n");
    const { config, report } = parseSandboxCompanionDoc(doc);
    expect(errors(report)).toHaveLength(0);
    const r = validateSandboxConfig(config) as { ok: true; config: SandboxConfig };
    const fluid = r.config.inputs[0];
    expect(fluid.type).toBe("select");
    expect(fluid.units).toBe("kg/m3");
    expect(fluid.defaultValue).toBe(920);
    expect(fluid.options).toEqual([
      { label: "Fresh water", value: 1000 },
      { label: "Vegetable oil", value: 920 },
      { label: "Seawater", value: 1025 },
    ]);
  });

  it("defaults to the first option when no '*' is present", () => {
    const doc = ["TITLE: T", "", "INPUT: Fluid (select: Fresh water=1000, Seawater=1025)", "", "OUTPUT: Y (u) = Fluid"].join("\n");
    const { config, report } = parseSandboxCompanionDoc(doc);
    expect(errors(report)).toHaveLength(0);
    const r = validateSandboxConfig(config) as { ok: true; config: SandboxConfig };
    expect(r.config.inputs[0].defaultValue).toBe(1000);
  });
});

describe("parseSandboxCompanionDoc — toggle inputs are editor-only", () => {
  it("errors naming toggle as editor-only, and skips the input entirely", () => {
    const lines = [
      "TITLE: T",
      "",
      "INPUT: Debug mode (toggle, start 0)",
      "INPUT: X (slider, u, 0 to 10, step 1, start 5)",
      "",
      "OUTPUT: Y (u) = X",
    ];
    const { config, report } = parseSandboxCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "Debug mode") && /toggle/i.test(e.message) && /editor-only/i.test(e.message))).toBe(true);
    const r = validateSandboxConfig(config) as { ok: true; config: SandboxConfig };
    expect(r.config.inputs.some((i) => i.label === "Debug mode")).toBe(false);
    expect(r.config.inputs.some((i) => i.label === "X")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// OUTPUT grammar / formula label resolution
// ---------------------------------------------------------------------------

describe("parseSandboxCompanionDoc — OUTPUT grammar: units and decimals", () => {
  it("parses decimals when present, and omits decimals (full precision) when absent", () => {
    const doc = [
      "TITLE: T",
      "",
      "INPUT: X (slider, u, 0 to 10, step 1, start 5)",
      "",
      "OUTPUT: WithDecimals (u, 2 decimals) = X",
      "OUTPUT: NoDecimals (u) = X",
    ].join("\n");
    const { config, report } = parseSandboxCompanionDoc(doc);
    expect(errors(report)).toHaveLength(0);
    const r = validateSandboxConfig(config) as { ok: true; config: SandboxConfig };
    expect(r.config.outputs[0].decimals).toBe(2);
    expect(r.config.outputs[1].decimals).toBeUndefined();
  });
});

describe("parseSandboxCompanionDoc — label-first formula identifier resolution", () => {
  it("resolves a label that is a substring of another label correctly (longest-label-first)", () => {
    const doc = [
      "TITLE: T",
      "",
      "INPUT: Cost (slider, $, 0 to 100, step 1, start 10)",
      "INPUT: Unit cost (slider, $, 0 to 100, step 1, start 5)",
      "",
      "OUTPUT: Total ($) = Unit cost - Cost",
    ].join("\n");
    const { config, report } = parseSandboxCompanionDoc(doc);
    expect(errors(report), JSON.stringify(report)).toHaveLength(0);
    const r = validateSandboxConfig(config) as { ok: true; config: SandboxConfig };
    const cost = r.config.inputs.find((i) => i.label === "Cost")!;
    const unitCost = r.config.inputs.find((i) => i.label === "Unit cost")!;
    const total = r.config.outputs[0];
    const ast = parseFormula(total.formula);
    expect(ast.ok).toBe(true);
    if (ast.ok) {
      expect(evaluateFormula(ast.ast, { [cost.id]: 10, [unitCost.id]: 5 })).toBe(-5);
      expect(new Set(collectIdentifiers(ast.ast))).toEqual(new Set([cost.id, unitCost.id]));
    }
  });

  it("errors and imports the output with formula '0', flagged, when an identifier cannot be resolved", () => {
    const lines = ["TITLE: T", "", "INPUT: X (slider, u, 0 to 10, step 1, start 5)", "", "OUTPUT: Y (u) = X + Nonexistent"];
    const { config, report } = parseSandboxCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "OUTPUT: Y") && /nonexistent/i.test(e.message))).toBe(true);
    const r = validateSandboxConfig(config) as { ok: true; config: SandboxConfig };
    expect(r.config.outputs.find((o) => o.label === "Y")?.formula).toBe("0");
  });

  it("errors and cannot reference a LATER output out of declaration order (mirrors the schema's progressive known-id rule)", () => {
    const lines = [
      "TITLE: T",
      "",
      "INPUT: X (slider, u, 0 to 10, step 1, start 5)",
      "",
      "OUTPUT: First (u) = Second",
      "OUTPUT: Second (u) = X",
    ];
    const { report } = parseSandboxCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "OUTPUT: First"))).toBe(true);
  });

  it("a label equal to 'pi' or 'e' (case-insensitive) errors and is imported with a numeric suffix", () => {
    const lines = ["TITLE: T", "", "INPUT: pi (slider, u, 0 to 10, step 1, start 5)", "", "OUTPUT: Y (u) = pi"];
    const { config, report } = parseSandboxCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "INPUT: pi") && /reserved/i.test(e.message))).toBe(true);
    const r = validateSandboxConfig(config) as { ok: true; config: SandboxConfig };
    const piInput = r.config.inputs.find((i) => i.label === "pi")!;
    expect(piInput.id).not.toBe("pi");
    expect(piInput.id).toMatch(/_2$/);
  });
});

// ---------------------------------------------------------------------------
// CHART grammar
// ---------------------------------------------------------------------------

describe("parseSandboxCompanionDoc — CHART grammar", () => {
  it("defaults samples to 40 with an info-level (warning) report note when the parenthetical is omitted, and defaults the title", () => {
    const lines = ["TITLE: T", "", "INPUT: X (slider, u, 0 to 10, step 1, start 5)", "", "OUTPUT: Y (u) = X", "", "CHART: Y vs X"];
    const { config, report } = parseSandboxCompanionDoc(lines.join("\n"));
    expect(errors(report)).toHaveLength(0);
    expect(warnings(report).some((w) => /sample/i.test(w.message) && /40/.test(w.message))).toBe(true);
    const r = validateSandboxConfig(config) as { ok: true; config: SandboxConfig };
    expect(r.config.charts[0]).toMatchObject({ samples: 40, title: "Y vs X" });
  });

  it("errors and skips the chart when a label cannot be resolved", () => {
    const lines = ["TITLE: T", "", "INPUT: X (slider, u, 0 to 10, step 1, start 5)", "", "OUTPUT: Y (u) = X", "", "CHART: Y vs Nonexistent"];
    const { config, report } = parseSandboxCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "CHART:") && /nonexistent/i.test(e.message))).toBe(true);
    const r = validateSandboxConfig(config) as { ok: true; config: SandboxConfig };
    expect(r.config.charts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// CHALLENGE grammar
// ---------------------------------------------------------------------------

describe("parseSandboxCompanionDoc — CHALLENGE grammar", () => {
  it("resolves 'between' correctly", () => {
    const doc = [
      "TITLE: T",
      "",
      "INPUT: X (slider, u, 0 to 10, step 1, start 5)",
      "",
      "OUTPUT: Y (u) = X",
      "",
      "CHALLENGE: Stay in range -> Y between 10 and 50",
    ].join("\n");
    const { config, report } = parseSandboxCompanionDoc(doc);
    expect(errors(report)).toHaveLength(0);
    const r = validateSandboxConfig(config) as { ok: true; config: SandboxConfig };
    expect(r.config.challenges[0]).toMatchObject({ comparator: "between", min: 10, max: 50 });
  });

  it("errors naming the three supported phrases when '>' is used in condition position, and skips the challenge", () => {
    const lines = [
      "TITLE: T",
      "",
      "INPUT: X (slider, u, 0 to 10, step 1, start 5)",
      "",
      "OUTPUT: Profit (u) = X",
      "",
      "CHALLENGE: Stay profitable -> Profit > 0",
    ];
    const { config, report } = parseSandboxCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    const hit = errs.find((e) => e.line === lineOf(lines, "CHALLENGE:"));
    expect(hit, JSON.stringify(report)).toBeDefined();
    expect(hit!.message).toMatch(/at least/i);
    expect(hit!.message).toMatch(/at most/i);
    expect(hit!.message).toMatch(/between/i);
    const r = validateSandboxConfig(config) as { ok: true; config: SandboxConfig };
    expect(r.config.challenges).toHaveLength(0);
  });

  it("errors and skips the challenge when the output label cannot be resolved", () => {
    const lines = [
      "TITLE: T",
      "",
      "INPUT: X (slider, u, 0 to 10, step 1, start 5)",
      "",
      "OUTPUT: Y (u) = X",
      "",
      "CHALLENGE: Do a thing -> Nonexistent at least 5",
    ];
    const { report } = parseSandboxCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "CHALLENGE:") && /nonexistent/i.test(e.message))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unknown directive
// ---------------------------------------------------------------------------

describe("parseSandboxCompanionDoc — unknown directive", () => {
  it("reports an error and skips the line for an unrecognized ALL-CAPS-colon directive", () => {
    const lines = [
      "TITLE: T",
      "WEIRDLINE: something",
      "",
      "INPUT: X (slider, u, 0 to 10, step 1, start 5)",
      "",
      "OUTPUT: Y (u) = X",
    ];
    const { report } = parseSandboxCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs).toHaveLength(1);
    expect(errs[0].line).toBe(lineOf(lines, "WEIRDLINE"));
    expect(errs[0].message).toMatch(/unknown directive/i);
  });
});

// ---------------------------------------------------------------------------
// Floors
// ---------------------------------------------------------------------------

describe("parseSandboxCompanionDoc — floors", () => {
  it("synthesizes a flagged placeholder input when the doc yields zero valid inputs", () => {
    const doc = ["TITLE: T", "", "OUTPUT: Y (u) = 1"].join("\n");
    const { config, report } = parseSandboxCompanionDoc(doc);
    const r = validateSandboxConfig(config) as { ok: true; config: SandboxConfig };
    expect(r.config.inputs).toHaveLength(1);
    expect(r.config.inputs[0].label).toMatch(/imported/i);
    expect(warnings(report).some((w) => /input/i.test(w.message))).toBe(true);
  });

  it("synthesizes a flagged placeholder output when the doc yields zero valid outputs", () => {
    const doc = ["TITLE: T", "", "INPUT: X (slider, u, 0 to 10, step 1, start 5)"].join("\n");
    const { config, report } = parseSandboxCompanionDoc(doc);
    const r = validateSandboxConfig(config) as { ok: true; config: SandboxConfig };
    expect(r.config.outputs).toHaveLength(1);
    expect(r.config.outputs[0].label).toMatch(/imported/i);
    expect(r.config.outputs[0].formula).toBe("0");
    expect(warnings(report).some((w) => /output/i.test(w.message))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tolerances: BOM, CRLF, smart quotes
// ---------------------------------------------------------------------------

describe("parseSandboxCompanionDoc — BOM/CRLF/smart-quote tolerance", () => {
  it("tolerates a leading UTF-8 BOM, CRLF line endings, and smart quotes, without shifting line numbers", () => {
    const lines = [
      "TITLE: Faculty’s Sandbox",
      "INTRO: The professor’s point was “clear”.",
      "BADLINE: oops",
      "",
      "INPUT: X (slider, u, 0 to 10, step 1, start 5)",
      "",
      "OUTPUT: Y (u) = X",
    ];
    const withBom = "﻿" + lines.join("\r\n");
    const { config, report } = parseSandboxCompanionDoc(withBom);
    const errs = errors(report);
    expect(errs).toHaveLength(1);
    expect(errs[0].line).toBe(lineOf(lines, "BADLINE"));
    const r = validateSandboxConfig(config) as { ok: true; config: SandboxConfig };
    expect(r.config.title).toBe("Faculty's Sandbox");
    expect(r.config.intro).toContain("The professor's point was \"clear\".");
  });
});

// ---------------------------------------------------------------------------
// Report completeness (seeded flaws)
// ---------------------------------------------------------------------------

describe("parseSandboxCompanionDoc — report completeness and ordering", () => {
  it("a doc with exactly 5 seeded flaws yields exactly 5 issues, at the right lines, in ascending line order", () => {
    const lines = [
      /* 1 */ "TITLE: Flawed Doc",
      /* 2 */ "WEIRDLINE: something",
      /* 3 */ "",
      /* 4 */ "INPUT: Broken input definition",
      /* 5 */ "INPUT: Debug mode (toggle, start 0)",
      /* 6 */ "INPUT: X (slider, u, 0 to 10, step 1, start 5)",
      /* 7 */ "",
      /* 8 */ "OUTPUT: Y (u) = X + Nonexistent",
      /* 9 */ "",
      /* 10 */ "CHALLENGE: Do a thing -> Y > 0",
    ];
    const { report } = parseSandboxCompanionDoc(lines.join("\n"));
    expect(report.map((r) => r.line), JSON.stringify(report)).toEqual([2, 4, 5, 8, 10]);
    expect(report.every((r) => r.severity === "error")).toBe(true);
    const sorted = [...report].sort((a, b) => a.line - b.line);
    expect(report).toEqual(sorted);
  });
});

// ---------------------------------------------------------------------------
// Duplicate labels (item 1, opus review fix round)
// ---------------------------------------------------------------------------

describe("parseSandboxCompanionDoc — duplicate labels are an error (item 1)", () => {
  it("errors naming both line numbers for a duplicate INPUT label, skips the second declaration entirely, and resolves the formula/chart to the FIRST Price", () => {
    const lines = [
      "TITLE: T",
      "",
      "INPUT: Price (slider, $, 0 to 100, step 1, start 10)",
      "INPUT: Price (slider, $, 0 to 50, step 1, start 5)",
      "",
      "OUTPUT: Y ($) = Price",
      "",
      "CHART: Y vs Price",
    ];
    const firstLine = lineOf(lines, "0 to 100");
    const dupLine = lineOf(lines, "0 to 50");
    const { config, report } = parseSandboxCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    const dupErr = errs.find((e) => e.line === dupLine);
    expect(dupErr, JSON.stringify(report)).toBeDefined();
    expect(dupErr!.message).toContain(`line ${firstLine}`);
    expect(dupErr!.message).toContain(`line ${dupLine}`);

    const r = validateSandboxConfig(config) as { ok: true; config: SandboxConfig };
    const priceInputs = r.config.inputs.filter((i) => i.label === "Price");
    expect(priceInputs).toHaveLength(1);
    expect(priceInputs[0]).toMatchObject({ min: 0, max: 100, step: 1, defaultValue: 10 });

    const y = r.config.outputs.find((o) => o.label === "Y")!;
    expect(y.formula).toBe(priceInputs[0].id);
    expect(r.config.charts[0].xInputId).toBe(priceInputs[0].id);
  });

  it("also flags a duplicate OUTPUT label the same way, independently of inputs", () => {
    const lines = [
      "TITLE: T",
      "",
      "INPUT: X (slider, u, 0 to 10, step 1, start 5)",
      "",
      "OUTPUT: Total (u) = X",
      "OUTPUT: Total (u) = X + X",
    ];
    const dupLine = lineOf(lines, "X + X");
    const { config, report } = parseSandboxCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => e.line === dupLine && /duplicate output label/i.test(e.message))).toBe(true);
    const r = validateSandboxConfig(config) as { ok: true; config: SandboxConfig };
    expect(r.config.outputs.filter((o) => o.label === "Total")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Single-pass label substitution (item 2, opus review fix round)
// ---------------------------------------------------------------------------

describe("parseSandboxCompanionDoc — single-pass label substitution never double-rewrites an id (item 2)", () => {
  it("resolves a same-text label collision across kinds (input 'Rate' vs a later output also named 'rate') deterministically, without a cascaded re-substitution", () => {
    const lines = [
      "TITLE: T",
      "",
      "INPUT: Rate (slider, u, 0 to 10, step 1, start 5)",
      "",
      "OUTPUT: rate (u) = 2",
      "OUTPUT: Y (u) = rate + Rate",
    ];
    const { config, report } = parseSandboxCompanionDoc(lines.join("\n"));
    expect(errors(report), JSON.stringify(report)).toHaveLength(0);
    const r = validateSandboxConfig(config) as { ok: true; config: SandboxConfig };
    const rateInput = r.config.inputs.find((i) => i.label === "Rate")!;
    const y = r.config.outputs.find((o) => o.label === "Y")!;
    // A sequential (old, buggy) substitution would replace "Rate"/"rate"
    // case-insensitively on its first pass, then re-match its OWN
    // just-inserted id on a later candidate's pass, silently rewriting it
    // again. Both terms here must resolve to the SAME id, in one pass.
    expect(y.formula).toBe(`${rateInput.id} + ${rateInput.id}`);
    const ast = parseFormula(y.formula);
    expect(ast.ok).toBe(true);
    if (ast.ok) expect(evaluateFormula(ast.ast, { [rateInput.id]: 5 })).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Pruning skipped declarations from resolution tables (item 3, opus review)
// ---------------------------------------------------------------------------

describe("parseSandboxCompanionDoc — pruning skipped declarations from resolution tables (item 3)", () => {
  it("a formula referencing a skipped toggle input errors (unresolved), falls back to formula '0', and the config still validates", () => {
    const lines = [
      "TITLE: T",
      "",
      "INPUT: Debug mode (toggle, start 0)",
      "INPUT: X (slider, u, 0 to 10, step 1, start 5)",
      "",
      "OUTPUT: Y (u) = X + Debug mode",
    ];
    const { config, report } = parseSandboxCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "OUTPUT: Y"))).toBe(true);
    const r = validateSandboxConfig(config);
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
    const cfg = (r as { ok: true; config: SandboxConfig }).config;
    expect(cfg.outputs.find((o) => o.label === "Y")?.formula).toBe("0");
  });

  it("a formula referencing a malformed (unparsable) INPUT line errors (unresolved) rather than silently binding to a dangling id", () => {
    const lines = [
      "TITLE: T",
      "",
      "INPUT: Broken input definition",
      "INPUT: X (slider, u, 0 to 10, step 1, start 5)",
      "",
      "OUTPUT: Y (u) = X + Broken input definition",
    ];
    const { config, report } = parseSandboxCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "OUTPUT: Y"))).toBe(true);
    const r = validateSandboxConfig(config);
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });

  it("a CHART referencing an input whose select declaration had zero valid options errors and the chart is skipped, and the config still validates", () => {
    const lines = [
      "TITLE: T",
      "",
      "INPUT: Fluid (select: )",
      "INPUT: X (slider, u, 0 to 10, step 1, start 5)",
      "",
      "OUTPUT: Y (u) = X",
      "",
      "CHART: Y vs Fluid",
    ];
    const { config, report } = parseSandboxCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "CHART:") && /fluid/i.test(e.message))).toBe(true);
    const r = validateSandboxConfig(config);
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
    const cfg = (r as { ok: true; config: SandboxConfig }).config;
    expect(cfg.charts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Parser-side numeric/cap checks (item 5, opus review fix round)
// ---------------------------------------------------------------------------

describe("parseSandboxCompanionDoc — parser-side numeric/cap checks (item 5)", () => {
  it("errors and skips the input when min is not less than max", () => {
    const lines = ["TITLE: T", "", "INPUT: X (slider, u, 10 to 5, step 1, start 7)", "", "OUTPUT: Y (u) = 1"];
    const { config, report } = parseSandboxCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "INPUT: X") && /min/i.test(e.message) && /max/i.test(e.message))).toBe(true);
    const r = validateSandboxConfig(config) as { ok: true; config: SandboxConfig };
    expect(r.config.inputs.some((i) => i.label === "X")).toBe(false);
  });

  it("clamps start into [min, max] with a warning when start is out of range", () => {
    const lines = ["TITLE: T", "", "INPUT: X (slider, u, 0 to 10, step 1, start 99)", "", "OUTPUT: Y (u) = X"];
    const { config, report } = parseSandboxCompanionDoc(lines.join("\n"));
    expect(errors(report), JSON.stringify(report)).toHaveLength(0);
    expect(warnings(report).some((w) => w.line === lineOf(lines, "INPUT: X") && /start/i.test(w.message) && /clamp/i.test(w.message))).toBe(true);
    const r = validateSandboxConfig(config) as { ok: true; config: SandboxConfig };
    expect(r.config.inputs.find((i) => i.label === "X")?.defaultValue).toBe(10);
  });

  it("errors and skips the input when step is not greater than 0", () => {
    const lines = ["TITLE: T", "", "INPUT: X (slider, u, 0 to 10, step 0, start 5)", "", "OUTPUT: Y (u) = 1"];
    const { config, report } = parseSandboxCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "INPUT: X") && /step/i.test(e.message))).toBe(true);
    const r = validateSandboxConfig(config) as { ok: true; config: SandboxConfig };
    expect(r.config.inputs.some((i) => i.label === "X")).toBe(false);
  });

  it("errors and skips the challenge when 'between' has min not less than max", () => {
    const lines = [
      "TITLE: T", "", "INPUT: X (slider, u, 0 to 10, step 1, start 5)", "", "OUTPUT: Y (u) = X", "",
      "CHALLENGE: Stay in range -> Y between 50 and 10",
    ];
    const { config, report } = parseSandboxCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "CHALLENGE:") && /between/i.test(e.message))).toBe(true);
    const r = validateSandboxConfig(config) as { ok: true; config: SandboxConfig };
    expect(r.config.challenges).toHaveLength(0);
  });

  it("caps decimals at 8 with a warning", () => {
    const lines = ["TITLE: T", "", "INPUT: X (slider, u, 0 to 10, step 1, start 5)", "", "OUTPUT: Y (u, 12 decimals) = X"];
    const { config, report } = parseSandboxCompanionDoc(lines.join("\n"));
    expect(errors(report), JSON.stringify(report)).toHaveLength(0);
    expect(warnings(report).some((w) => w.line === lineOf(lines, "OUTPUT: Y") && /decimals/i.test(w.message))).toBe(true);
    const r = validateSandboxConfig(config) as { ok: true; config: SandboxConfig };
    expect(r.config.outputs.find((o) => o.label === "Y")?.decimals).toBe(8);
  });

  it("truncates units longer than 20 characters with a warning", () => {
    const longUnits = "a".repeat(25);
    const lines = ["TITLE: T", "", `INPUT: X (slider, ${longUnits}, 0 to 10, step 1, start 5)`, "", "OUTPUT: Y (u) = X"];
    const { config, report } = parseSandboxCompanionDoc(lines.join("\n"));
    expect(errors(report), JSON.stringify(report)).toHaveLength(0);
    expect(warnings(report).some((w) => w.line === lineOf(lines, "INPUT: X") && /units/i.test(w.message))).toBe(true);
    const r = validateSandboxConfig(config) as { ok: true; config: SandboxConfig };
    expect(r.config.inputs.find((i) => i.label === "X")?.units).toHaveLength(20);
  });

  it("truncates a select with more than 20 options with a warning", () => {
    const opts = Array.from({ length: 25 }, (_, i) => `Opt${i}=${i}`).join(", ");
    const lines = ["TITLE: T", "", `INPUT: X (select: ${opts})`, "", "OUTPUT: Y (u) = X"];
    const { config, report } = parseSandboxCompanionDoc(lines.join("\n"));
    expect(errors(report), JSON.stringify(report)).toHaveLength(0);
    expect(warnings(report).some((w) => w.line === lineOf(lines, "INPUT: X") && /option/i.test(w.message))).toBe(true);
    const r = validateSandboxConfig(config) as { ok: true; config: SandboxConfig };
    expect(r.config.inputs.find((i) => i.label === "X")?.options).toHaveLength(20);
  });

  it("errors and skips the chart when the x-axis input is a select (not a slider/number)", () => {
    const lines = [
      "TITLE: T", "",
      "INPUT: Fluid (select: Water=1, Oil=2)",
      "",
      "OUTPUT: Y (u) = Fluid",
      "",
      "CHART: Y vs Fluid",
    ];
    const { config, report } = parseSandboxCompanionDoc(lines.join("\n"));
    const errs = errors(report);
    expect(errs.some((e) => e.line === lineOf(lines, "CHART:") && /slider|number/i.test(e.message))).toBe(true);
    const r = validateSandboxConfig(config) as { ok: true; config: SandboxConfig };
    expect(r.config.charts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// INTRO is HTML-escaped before the <p> wrap (item 6, opus review fix round)
// ---------------------------------------------------------------------------

describe("parseSandboxCompanionDoc / serializeSandboxCompanionDoc — INTRO HTML-escaping (item 6)", () => {
  it("escapes &, <, > in INTRO before wrapping it in <p>", () => {
    const doc = [
      "TITLE: T",
      "INTRO: <img src=x onerror=x> a & b",
      "",
      "INPUT: X (slider, u, 0 to 10, step 1, start 5)",
      "",
      "OUTPUT: Y (u) = X",
    ].join("\n");
    const { config } = parseSandboxCompanionDoc(doc);
    expect((config as { intro?: string }).intro).toBe("<p>&lt;img src=x onerror=x&gt; a &amp; b</p>");
  });

  it("round-trips an intro containing '&' without double-escaping, and is idempotent across a second round trip", () => {
    const original = { ...STARTERS.blank.config, intro: "<p>Salt & pepper, to taste.</p>" };
    const doc = serializeSandboxCompanionDoc(original);
    const { config } = parseSandboxCompanionDoc(doc);
    const intro1 = (config as { intro?: string }).intro;
    expect(intro1).toBe("<p>Salt &amp; pepper, to taste.</p>");

    const doc2 = serializeSandboxCompanionDoc({ ...original, intro: intro1 });
    const { config: config2 } = parseSandboxCompanionDoc(doc2);
    expect((config2 as { intro?: string }).intro).toBe(intro1);
  });
});

// ---------------------------------------------------------------------------
// Serializer coverage: risky labels, select default, lossy header, challenge
// condition text (items 7, 8, 9, opus review fix round)
// ---------------------------------------------------------------------------

describe("serializeSandboxCompanionDoc — risky-label warning coverage (item 7)", () => {
  it("flags labels containing $, arithmetic operators, or leading/trailing non-word characters", () => {
    const cfg: SandboxConfigLike = {
      title: "T",
      inputs: [
        { id: "a", label: "Cost$", type: "slider", min: 0, max: 10, step: 1, defaultValue: 5 },
        { id: "b", label: "A+B", type: "slider", min: 0, max: 10, step: 1, defaultValue: 5 },
        { id: "c", label: "-Leading", type: "slider", min: 0, max: 10, step: 1, defaultValue: 5 },
        { id: "d", label: "Trailing!", type: "slider", min: 0, max: 10, step: 1, defaultValue: 5 },
        { id: "e", label: "Plain label", type: "slider", min: 0, max: 10, step: 1, defaultValue: 5 },
      ],
      outputs: [{ id: "y", label: "Y", formula: "a" }],
      charts: [],
      challenges: [],
    };
    const doc = serializeSandboxCompanionDoc(cfg);
    const warningLine = doc.split("\n").find((l) => l.startsWith("# Warning:"));
    expect(warningLine, doc).toBeDefined();
    for (const risky of ["Cost$", "A+B", "-Leading", "Trailing!"]) {
      expect(warningLine).toContain(risky);
    }
    expect(warningLine).not.toContain("Plain label");
  });
});

describe("serializeSandboxCompanionDoc — single-pass id-to-label substitution never re-matches an inserted label (item 4)", () => {
  it("round-trips the review's probe (id 'rate' label \"Speed\", id 'rate_of_change' label \"rate of change\") with meaning preserved", () => {
    // The old chained-replace serializer processed the longer id first,
    // inserting the literal label text "rate of change" into the formula —
    // then the LATER pass for id "rate" would re-match the word "rate"
    // *inside that just-inserted label* (word-bounded on spaces, same as on
    // underscores) and corrupt it into "Speed of change".
    const cfg: SandboxConfigLike = {
      title: "T",
      inputs: [
        { id: "rate", label: "Speed", type: "slider", min: 0, max: 10, step: 1, defaultValue: 5 },
        { id: "rate_of_change", label: "rate of change", type: "slider", min: 0, max: 10, step: 1, defaultValue: 2 },
      ],
      outputs: [{ id: "y", label: "Y", formula: "rate_of_change + rate" }],
      charts: [],
      challenges: [],
    };
    const doc = serializeSandboxCompanionDoc(cfg);
    const outputLine = doc.split("\n").find((l) => l.startsWith("OUTPUT: Y"));
    expect(outputLine, doc).toBe("OUTPUT: Y () = rate of change + Speed");

    // Round trip: re-import and confirm the formula still evaluates using
    // BOTH distinct values (not collapsed onto one id).
    const { config, report } = parseSandboxCompanionDoc(doc);
    expect(errors(report), JSON.stringify(report)).toHaveLength(0);
    const r = validateSandboxConfig(config) as { ok: true; config: SandboxConfig };
    const speed = r.config.inputs.find((i) => i.label === "Speed")!;
    const roc = r.config.inputs.find((i) => i.label === "rate of change")!;
    const y = r.config.outputs.find((o) => o.label === "Y")!;
    const ast = parseFormula(y.formula);
    expect(ast.ok).toBe(true);
    if (ast.ok) expect(evaluateFormula(ast.ast, { [speed.id]: 5, [roc.id]: 2 })).toBe(7);
  });
});

describe("serializeSandboxCompanionDoc — select default marker on first match only (item 8)", () => {
  it("marks only the first option whose value equals defaultValue with '*'", () => {
    const cfg: SandboxConfigLike = {
      title: "T",
      inputs: [
        {
          id: "fluid", label: "Fluid", type: "select", defaultValue: 1000,
          options: [
            { label: "A", value: 1000 },
            { label: "B", value: 1000 },
            { label: "C", value: 2000 },
          ],
        },
      ],
      outputs: [{ id: "y", label: "Y", formula: "fluid" }],
      charts: [],
      challenges: [],
    };
    const doc = serializeSandboxCompanionDoc(cfg);
    const line = doc.split("\n").find((l) => l.startsWith("INPUT: Fluid"));
    expect(line).toBe("INPUT: Fluid (select: A=1000*, B=1000, C=2000)");
  });
});

describe("serializeSandboxCompanionDoc — challenge condition text for all three comparators (item 9)", () => {
  it("renders gte/lte/between correctly", () => {
    const cfg: SandboxConfigLike = {
      title: "T",
      inputs: [{ id: "x", label: "X", type: "slider", min: 0, max: 10, step: 1, defaultValue: 5 }],
      outputs: [{ id: "y", label: "Y", formula: "x" }],
      charts: [],
      challenges: [
        { id: "c1", prompt: "At least", outputId: "y", comparator: "gte", value: 3 },
        { id: "c2", prompt: "At most", outputId: "y", comparator: "lte", value: 7 },
        { id: "c3", prompt: "Between", outputId: "y", comparator: "between", min: 2, max: 8 },
      ],
    };
    const doc = serializeSandboxCompanionDoc(cfg);
    expect(doc).toContain("CHALLENGE: At least -> Y at least 3");
    expect(doc).toContain("CHALLENGE: At most -> Y at most 7");
    expect(doc).toContain("CHALLENGE: Between -> Y between 2 and 8");
  });
});

describe("serializeSandboxCompanionDoc — select default that is not the first option (item 9)", () => {
  it("marks the actual default option, not the first one, when they differ", () => {
    const cfg: SandboxConfigLike = {
      title: "T",
      inputs: [
        {
          id: "fluid", label: "Fluid", type: "select", defaultValue: 1025,
          options: [
            { label: "Fresh water", value: 1000 },
            { label: "Seawater", value: 1025 },
          ],
        },
      ],
      outputs: [{ id: "y", label: "Y", formula: "fluid" }],
      charts: [],
      challenges: [],
    };
    const doc = serializeSandboxCompanionDoc(cfg);
    expect(doc).toContain("INPUT: Fluid (select: Fresh water=1000, Seawater=1025*)");
  });
});

describe("serializeSandboxCompanionDoc — lossy-feature header block content (item 9)", () => {
  it("names every dropped feature in the header comment", () => {
    const cfg: SandboxConfigLike = {
      title: "T",
      inputs: [
        { id: "x", label: "X", type: "slider", min: 0, max: 10, step: 1, defaultValue: 5 },
        { id: "dbg", label: "Debug", type: "toggle", defaultValue: 0 },
        { id: "below", label: "Below thing", type: "slider", min: 0, max: 10, step: 1, defaultValue: 5, placement: { zone: "below" } },
      ],
      outputs: [{ id: "y", label: "Y", formula: "x" }],
      charts: [],
      challenges: [],
      visual: { overlays: [] },
      layout: "stacked",
    };
    const doc = serializeSandboxCompanionDoc(cfg);
    const noteLine = doc.split("\n").find((l) => l.startsWith("# Note:"));
    expect(noteLine, doc).toBeDefined();
    expect(noteLine).toContain("toggle input");
    expect(noteLine).toContain("Debug");
    expect(noteLine).toContain("custom placement");
    expect(noteLine).toContain("Below thing");
    expect(noteLine).toContain("visual scene");
    expect(noteLine).toContain("stacked");
  });
});

// ---------------------------------------------------------------------------
// Serializer + round-trip
// ---------------------------------------------------------------------------

describe("serializeSandboxCompanionDoc — round-trip", () => {
  it("round-trips the buoyancy starter: serialize -> parse -> validate ok, structurally equal via labels", () => {
    const original = STARTERS.buoyancy.config;
    const doc = serializeSandboxCompanionDoc(original);
    const { config, report } = parseSandboxCompanionDoc(doc);
    expect(errors(report), JSON.stringify(report)).toHaveLength(0);

    const validated = validateSandboxConfig(config);
    expect(validated.ok, !validated.ok ? validated.errors.join("; ") : "").toBe(true);
    const reparsed = (validated as { ok: true; config: SandboxConfig }).config;

    expect(toLabeledShape(reparsed)).toEqual(toLabeledShape(original));
  });

  it("round-trips the blank starter too", () => {
    const original = STARTERS.blank.config;
    const doc = serializeSandboxCompanionDoc(original);
    const { config, report } = parseSandboxCompanionDoc(doc);
    expect(errors(report), JSON.stringify(report)).toHaveLength(0);
    const validated = validateSandboxConfig(config);
    expect(validated.ok, !validated.ok ? validated.errors.join("; ") : "").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The committed template (public/companion-doc-sandbox-template.txt)
// ---------------------------------------------------------------------------

describe("companion-doc-sandbox-template.txt (public/, faculty-facing, serializer-generated)", () => {
  const templatePath = join(process.cwd(), "public", "companion-doc-sandbox-template.txt");
  const readTemplate = (): string => readFileSync(templatePath, "utf8");

  const TEMPLATE_HEADER = [
    "# Welcome! This is a companion doc for building a parameter sandbox.",
    "# Fill in your own inputs, outputs, and challenges and send this file",
    "# back. No special software or training is needed to use it.",
    "# Lines starting with # (like these) are comments and are ignored.",
    "# A sandbox has INPUTs the learner adjusts and OUTPUTs calculated from",
    "# them with a formula, like this:",
    "#   INPUT: Bill amount (slider, $, 10 to 200, step 5, start 50)",
    "#   OUTPUT: Tip amount ($, 2 decimals) = Bill amount * Tip percent / 100",
    "# Formulas can use +, -, *, /, ^, parentheses, and earlier inputs and",
    "# outputs by name (spelled the same as their own INPUT:/OUTPUT: line,",
    "# capitalization does not matter). Formulas can also use these",
    "# functions: min, max, abs, round, floor, ceil, sqrt, pow, exp, ln,",
    "# log10, sin, cos, tan, and the constants pi and e (so do not name an",
    "# input or output \"pi\" or \"e\"). A SELECT input offers a dropdown of",
    "# named options instead of a range, for example:",
    "#   INPUT: Fluid (select, kg/m3: Fresh water=1000, Seawater=1025*)",
    "# where the * marks which option is selected by default. Toggle",
    "# (on/off) inputs are not supported by this text format; build those",
    "# directly in the app instead. A CHART plots one output against one",
    "# input, and a CHALLENGE gives the learner a target to reach, phrased",
    "# as \"at least\", \"at most\", or \"between ... and ...\". Keep input and",
    "# output names plain (letters, numbers, spaces): a name containing",
    "# \"(\", \"=\", \"->\", \" vs \", or a math symbol like $ + - * / ^ , can",
    "# confuse this format when it is read back in.",
    "# When you are done, save and share this file with whoever is building",
    "# the lesson.",
  ].join("\n");

  const TEMPLATE_CONFIG: SandboxConfig = sandboxConfigSchema.parse({
    title: "Tip Calculator",
    intro: "<p>Set a bill amount and a tip percentage, and see the tip and total.</p>",
    inputs: [
      { id: "bill_amount", label: "Bill amount", type: "slider", units: "$", min: 10, max: 200, step: 5, defaultValue: 50 },
      { id: "tip_percent", label: "Tip percent", type: "slider", units: "%", min: 0, max: 30, step: 1, defaultValue: 15 },
    ],
    outputs: [
      { id: "tip_amount", label: "Tip amount", units: "$", decimals: 2, formula: "bill_amount * tip_percent / 100" },
      { id: "total", label: "Total", units: "$", decimals: 2, formula: "bill_amount + tip_amount" },
    ],
    charts: [{ id: "tip_chart", title: "Tip amount vs Bill amount", xInputId: "bill_amount", yOutputId: "tip_amount", samples: 40 }],
    challenges: [{ id: "big_tip", prompt: "Leave a tip of at least $10.", outputId: "tip_amount", comparator: "gte", value: 10 }],
  });

  it("byte-matches the header + serializer output for the template's source config (drift test)", () => {
    const generated = `${TEMPLATE_HEADER}\n\n${serializeSandboxCompanionDoc(TEMPLATE_CONFIG)}`;
    expect(readTemplate()).toBe(generated);
  });

  it("parses with zero ERRORS (warnings allowed, but none expected of a clean template)", () => {
    const { report } = parseSandboxCompanionDoc(readTemplate());
    expect(errors(report), JSON.stringify(report)).toHaveLength(0);
    expect(warnings(report), JSON.stringify(report)).toHaveLength(0);
  });

  it("parses to a config that validates via validateSandboxConfig", () => {
    const { config } = parseSandboxCompanionDoc(readTemplate());
    const r = validateSandboxConfig(config);
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });

  it("has no em dashes or en dashes anywhere (faculty-facing plain punctuation)", () => {
    expect(readTemplate()).not.toMatch(/[–—]/);
  });

  it("lives outside public/engines and is absent from the engines manifest (scanner/manifest untouched)", () => {
    const manifest = readFileSync(join(process.cwd(), "public", "engines", "engines.manifest.json"), "utf8");
    expect(manifest).not.toMatch(/companion-doc-sandbox-template/);
  });
});
