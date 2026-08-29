import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BRANCHING_STARTERS, branchingStarterConfig } from "@/lib/engines/branching-scenario/starters";
import { validateBranchingConfig, type BranchingConfig } from "@/lib/engines/branching-scenario/schema";
import { parseCompanionDoc, type ImportIssue } from "@/lib/engines/branching-scenario/companion-doc";
import { adapterFor } from "@/lib/engines/dispatch";
import { assemblePackage, zipPackage } from "@/lib/export/package";
import { parseSandboxCompanionDoc } from "@/lib/engines/param-sandbox/companion-doc";
import { validateSandboxConfig, type SandboxConfig } from "@/lib/engines/param-sandbox/schema";
import { STARTERS as PS_STARTERS, starterConfig as psStarterConfig } from "@/lib/engines/param-sandbox/starter-configs";
import { parseFormula } from "@/lib/formula/parser";
import { evaluateFormula, FormulaError } from "@/lib/formula/evaluate";

/**
 * Content-quality gates for the Sierra Vista arc (Task 5 of the exemplar
 * library plan): the three branching starters ("budget-cut",
 * "community-meeting", "crisis") authored from docs/exemplars/brief-*.md.
 * This suite checks the escalation contract the briefs specify, that each
 * committed companion doc (docs/exemplars/<slug>.companion.txt) is the
 * serializer's exact output for its starter and stays in parity with it, and
 * that each starter's exported zip stays within the 40KB budget.
 */

const ARC = [
  { id: "budget-cut", slug: "budget-cut", variables: 1, scenes: 4, showIfMin: 0, endingsMin: 2, objectiveSubstring: "choose where a mid-year" },
  { id: "community-meeting", slug: "community-meeting", variables: 2, scenes: 6, showIfMin: 1, endingsMin: 3, objectiveSubstring: "design and run a public meeting" },
  { id: "crisis", slug: "crisis", variables: 3, scenes: 8, showIfMin: 3, endingsMin: 4, objectiveSubstring: "lead a district through a security incident" },
] as const;

function errors(report: ImportIssue[]): ImportIssue[] {
  return report.filter((r) => r.severity === "error");
}

function countShowIf(config: BranchingConfig): number {
  let n = 0;
  for (const s of config.scenes) for (const c of s.choices) if (c.showIf) n++;
  return n;
}

describe("Sierra Vista arc — escalation contract", () => {
  for (const mod of ARC) {
    describe(`module "${mod.id}"`, () => {
      const { config } = BRANCHING_STARTERS[mod.id];

      it("validates via validateBranchingConfig", () => {
        const r = validateBranchingConfig(config);
        expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
      });

      it(`has exactly ${mod.variables} variable(s)`, () => {
        expect(config.variables).toHaveLength(mod.variables);
        for (const v of config.variables) expect(v.visible).toBe(true);
      });

      it(`has exactly ${mod.scenes} scenes`, () => {
        expect(config.scenes).toHaveLength(mod.scenes);
      });

      it(`has at least ${mod.endingsMin} endings`, () => {
        expect(config.endings.length).toBeGreaterThanOrEqual(mod.endingsMin);
      });

      it("has an intro that carries the stated learning objective", () => {
        expect(config.intro).toBeTruthy();
        expect(config.intro).toContain(mod.objectiveSubstring);
      });
    });
  }

  it('module 1 ("budget-cut") has zero showIf choices anywhere', () => {
    const { config } = BRANCHING_STARTERS["budget-cut"];
    expect(countShowIf(config)).toBe(0);
  });

  it('module 2 ("community-meeting") has exactly 1 showIf choice', () => {
    const { config } = BRANCHING_STARTERS["community-meeting"];
    expect(countShowIf(config)).toBe(1);
  });

  it('module 3 ("crisis") has at least 3 showIf choices', () => {
    const { config } = BRANCHING_STARTERS.crisis;
    expect(countShowIf(config)).toBeGreaterThanOrEqual(3);
  });

  it("every scene with a conditional choice still keeps at least one unconditional choice (guaranteed-exit rule)", () => {
    for (const mod of ARC) {
      const { config } = BRANCHING_STARTERS[mod.id];
      for (const s of config.scenes) {
        if (s.choices.some((c) => c.showIf)) {
          expect(
            s.choices.some((c) => !c.showIf),
            `module "${mod.id}" scene "${s.id}" should keep an unconditional exit`,
          ).toBe(true);
        }
      }
    }
  });
});

describe("Sierra Vista arc — committed companion docs (parity + doc-format quality)", () => {
  for (const mod of ARC) {
    describe(`docs/exemplars/${mod.slug}.companion.txt`, () => {
      const docPath = join(process.cwd(), "docs", "exemplars", `${mod.slug}.companion.txt`);
      const docText = readFileSync(docPath, "utf8");
      const { config: original } = BRANCHING_STARTERS[mod.id];

      it("parses with zero error-severity issues", () => {
        const { report } = parseCompanionDoc(docText);
        expect(errors(report), JSON.stringify(errors(report))).toHaveLength(0);
      });

      it("parses to a config that validates via validateBranchingConfig", () => {
        const { config } = parseCompanionDoc(docText);
        const r = validateBranchingConfig(config);
        expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
      });

      it("is structurally equal to the starter by title/label/quality/effects/goTo-by-title/showIf", () => {
        const { config } = parseCompanionDoc(docText);
        const validated = validateBranchingConfig(config);
        expect(validated.ok, !validated.ok ? validated.errors.join("; ") : "").toBe(true);
        const reparsed = (validated as { ok: true; config: BranchingConfig }).config;

        expect(reparsed.role).toBe(original.role);
        expect(reparsed.feedbackMode).toBe(original.feedbackMode);

        expect(
          reparsed.variables.map((v) => ({ label: v.label, min: v.min, max: v.max, initial: v.initial, visible: v.visible })),
        ).toEqual(original.variables.map((v) => ({ label: v.label, min: v.min, max: v.max, initial: v.initial, visible: v.visible })));

        const origStart = original.scenes.find((s) => s.id === original.startSceneId);
        const newStart = reparsed.scenes.find((s) => s.id === reparsed.startSceneId);
        expect(newStart?.title).toBe(origStart?.title);

        const titleOf = (cfg: BranchingConfig, goTo: string): string | undefined => {
          const [kind, id] = goTo.split(":");
          return kind === "scene" ? cfg.scenes.find((s) => s.id === id)?.title : cfg.endings.find((e) => e.id === id)?.title;
        };
        const varLabel = (cfg: BranchingConfig, variableId: string): string | undefined =>
          cfg.variables.find((v) => v.id === variableId)?.label;

        expect(reparsed.scenes).toHaveLength(original.scenes.length);
        original.scenes.forEach((origScene, i) => {
          const newScene = reparsed.scenes[i];
          expect(newScene.title).toBe(origScene.title);
          expect(newScene.choices).toHaveLength(origScene.choices.length);
          origScene.choices.forEach((origChoice, j) => {
            const newChoice = newScene.choices[j];
            expect(newChoice.label).toBe(origChoice.label);
            expect(newChoice.quality).toBe(origChoice.quality);
            expect(
              newChoice.effects.map((e) => ({ label: varLabel(reparsed, e.variableId), delta: e.delta })),
            ).toEqual(origChoice.effects.map((e) => ({ label: varLabel(original, e.variableId), delta: e.delta })));
            expect(titleOf(reparsed, newChoice.goTo)).toBe(titleOf(original, origChoice.goTo));
            if (origChoice.showIf) {
              expect(newChoice.showIf?.comparator).toBe(origChoice.showIf.comparator);
              expect(newChoice.showIf?.value).toBe(origChoice.showIf.value);
              expect(newChoice.showIf?.min).toBe(origChoice.showIf.min);
              expect(newChoice.showIf?.max).toBe(origChoice.showIf.max);
              const label = varLabel(reparsed, newChoice.showIf!.variableId);
              expect(label).toBe(varLabel(original, origChoice.showIf.variableId));
            } else {
              expect(newChoice.showIf).toBeUndefined();
            }
          });
        });

        expect(reparsed.endings).toHaveLength(original.endings.length);
        for (const origEnding of original.endings) {
          expect(reparsed.endings.some((e) => e.title === origEnding.title)).toBe(true);
        }
      });
    });
  }
});

describe("Sierra Vista arc — export package budget", () => {
  for (const mod of ARC) {
    it(`starter "${mod.id}" exports a zip under 40KB`, async () => {
      const adapter = adapterFor("branching-scenario");
      const config = branchingStarterConfig(mod.id, `Exemplar Test: ${mod.id}`);

      const assembled = await assemblePackage({
        identifier: `ILB-exemplar-${mod.id}`,
        title: config.title,
        engineId: "branching-scenario",
        config,
        runtime: { toRuntimeConfig: adapter.toRuntimeConfig, collectAssetIds: adapter.collectAssetIds },
        resolveAsset: async () => { throw new Error(`starter "${mod.id}" has no assets`); },
      });

      const zip = await zipPackage(assembled.files);
      expect(zip.length).toBeLessThan(40 * 1024);
    });
  }
});

/**
 * Plea Bargain (Task 6 of the exemplar library plan): a fourth branching
 * exemplar authored from docs/exemplars/brief-plea-bargain.md. Per Tamara's
 * ruling the COMMITTED starter is image-less — no scene carries
 * imageAssetId/imageRole/imageAlt — and the start scene's intro instead
 * carries a one-line authoring note marking where a header image goes. The
 * image itself (docs/exemplars/assets/plea-bargain-header.svg + .png) is
 * delivered separately: uploaded through the real asset route into a
 * Canvas-review copy at delivery time (Task 8), not baked into this starter.
 */
describe("Plea Bargain — starter content quality", () => {
  const { config } = BRANCHING_STARTERS["plea-bargain"];

  it("validates via validateBranchingConfig", () => {
    const r = validateBranchingConfig(config);
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });

  it("is grouped as an exemplar with a non-empty description naming the pattern", () => {
    expect(BRANCHING_STARTERS["plea-bargain"].group).toBe("exemplar");
    expect(BRANCHING_STARTERS["plea-bargain"].description.length).toBeGreaterThan(0);
  });

  it("has exactly 2 variables, both visible", () => {
    expect(config.variables).toHaveLength(2);
    for (const v of config.variables) expect(v.visible).toBe(true);
  });

  it("has exactly 6 scenes and 3 endings", () => {
    expect(config.scenes).toHaveLength(6);
    expect(config.endings).toHaveLength(3);
  });

  it("has exactly one showIf choice, gated on case_strength gte 60 (the renegotiation gate)", () => {
    expect(countShowIf(config)).toBe(1);
    const gated = config.scenes.flatMap((s) => s.choices).find((c) => c.showIf);
    expect(gated?.showIf).toEqual({ variableId: "case_strength", comparator: "gte", value: 60 });
  });

  it("ships image-less: no scene carries imageAssetId, imageRole, or imageAlt", () => {
    for (const s of config.scenes) {
      expect(s.imageAssetId).toBeUndefined();
      expect(s.imageRole).toBeUndefined();
      expect(s.imageAlt).toBeUndefined();
    }
  });

  it("carries the authoring note about the header image in the intro", () => {
    expect(config.intro).toBeTruthy();
    expect(config.intro).toContain("this is where a scene header image goes");
    expect(config.intro).toContain("docs/exemplars/alt-policy.md");
  });

  it("carries the learner-visible learning objective in the intro", () => {
    expect(config.intro).toContain("evaluate a plea decision by the quality of the process behind it");
  });
});

describe("Plea Bargain — committed companion doc (parity + doc-format quality)", () => {
  const docPath = join(process.cwd(), "docs", "exemplars", "plea-bargain.companion.txt");
  const docText = readFileSync(docPath, "utf8");
  const { config: original } = BRANCHING_STARTERS["plea-bargain"];

  it("parses with zero error-severity issues", () => {
    const { report } = parseCompanionDoc(docText);
    expect(errors(report), JSON.stringify(errors(report))).toHaveLength(0);
  });

  it("parses to a config that validates via validateBranchingConfig", () => {
    const { config } = parseCompanionDoc(docText);
    const r = validateBranchingConfig(config);
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });

  it("is structurally equal to the starter by title/label/quality/effects/goTo-by-title/showIf", () => {
    const { config } = parseCompanionDoc(docText);
    const validated = validateBranchingConfig(config);
    expect(validated.ok, !validated.ok ? validated.errors.join("; ") : "").toBe(true);
    const reparsed = (validated as { ok: true; config: BranchingConfig }).config;

    expect(reparsed.role).toBe(original.role);
    expect(reparsed.feedbackMode).toBe(original.feedbackMode);

    expect(
      reparsed.variables.map((v) => ({ label: v.label, min: v.min, max: v.max, initial: v.initial, visible: v.visible })),
    ).toEqual(original.variables.map((v) => ({ label: v.label, min: v.min, max: v.max, initial: v.initial, visible: v.visible })));

    const origStart = original.scenes.find((s) => s.id === original.startSceneId);
    const newStart = reparsed.scenes.find((s) => s.id === reparsed.startSceneId);
    expect(newStart?.title).toBe(origStart?.title);

    const titleOf = (cfg: BranchingConfig, goTo: string): string | undefined => {
      const [kind, id] = goTo.split(":");
      return kind === "scene" ? cfg.scenes.find((s) => s.id === id)?.title : cfg.endings.find((e) => e.id === id)?.title;
    };
    const varLabel = (cfg: BranchingConfig, variableId: string): string | undefined =>
      cfg.variables.find((v) => v.id === variableId)?.label;

    expect(reparsed.scenes).toHaveLength(original.scenes.length);
    original.scenes.forEach((origScene, i) => {
      const newScene = reparsed.scenes[i];
      expect(newScene.title).toBe(origScene.title);
      expect(newScene.choices).toHaveLength(origScene.choices.length);
      origScene.choices.forEach((origChoice, j) => {
        const newChoice = newScene.choices[j];
        expect(newChoice.label).toBe(origChoice.label);
        expect(newChoice.quality).toBe(origChoice.quality);
        expect(
          newChoice.effects.map((e) => ({ label: varLabel(reparsed, e.variableId), delta: e.delta })),
        ).toEqual(origChoice.effects.map((e) => ({ label: varLabel(original, e.variableId), delta: e.delta })));
        expect(titleOf(reparsed, newChoice.goTo)).toBe(titleOf(original, origChoice.goTo));
        if (origChoice.showIf) {
          expect(newChoice.showIf?.comparator).toBe(origChoice.showIf.comparator);
          expect(newChoice.showIf?.value).toBe(origChoice.showIf.value);
          expect(newChoice.showIf?.min).toBe(origChoice.showIf.min);
          expect(newChoice.showIf?.max).toBe(origChoice.showIf.max);
          const label = varLabel(reparsed, newChoice.showIf!.variableId);
          expect(label).toBe(varLabel(original, origChoice.showIf.variableId));
        } else {
          expect(newChoice.showIf).toBeUndefined();
        }
      });
    });

    expect(reparsed.endings).toHaveLength(original.endings.length);
    for (const origEnding of original.endings) {
      expect(reparsed.endings.some((e) => e.title === origEnding.title)).toBe(true);
    }
  });
});

describe("Plea Bargain — export package budget", () => {
  it('starter "plea-bargain" exports a zip under 40KB (image-less)', async () => {
    const adapter = adapterFor("branching-scenario");
    const config = branchingStarterConfig("plea-bargain", "Exemplar Test: plea-bargain");

    const assembled = await assemblePackage({
      identifier: "ILB-exemplar-plea-bargain",
      title: config.title,
      engineId: "branching-scenario",
      config,
      runtime: { toRuntimeConfig: adapter.toRuntimeConfig, collectAssetIds: adapter.collectAssetIds },
      resolveAsset: async () => { throw new Error('starter "plea-bargain" has no assets'); },
    });

    const zip = await zipPackage(assembled.files);
    expect(zip.length).toBeLessThan(40 * 1024);
  });
});

describe("Plea Bargain — authored header image + brief provenance", () => {
  const briefPath = join(process.cwd(), "docs", "exemplars", "brief-plea-bargain.md");
  const briefText = readFileSync(briefPath, "utf8");

  it("the brief's drafted alt text section is non-empty", () => {
    const m = briefText.match(/\*\*Drafted alt text[^\n]*\n\n>\s*(.+)/);
    expect(m, "expected a '**Drafted alt text...' section with a blockquote sentence").not.toBeNull();
    const draft = (m?.[1] ?? "").trim();
    expect(draft.length).toBeGreaterThan(0);
  });

  it("the authored SVG source exists and is committed", () => {
    const svgPath = join(process.cwd(), "docs", "exemplars", "assets", "plea-bargain-header.svg");
    const svg = readFileSync(svgPath, "utf8");
    expect(svg).toContain("<svg");
    expect(svg).toContain("#8C1D40");
    expect(svg).toContain("#FFC627");
  });

  it("the rasterized PNG exists and its magic bytes are PNG", () => {
    const pngPath = join(process.cwd(), "docs", "exemplars", "assets", "plea-bargain-header.png");
    const buf = readFileSync(pngPath);
    expect(buf.length).toBeGreaterThan(0);
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    expect(Array.from(buf.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // Sanity budget for an authored header image (not the <40KB starter-zip
    // budget, which does not apply to a standalone asset file).
    expect(buf.length).toBeLessThan(400 * 1024);
  });
});

/**
 * Dose-Response + Break-Even Studio (Task 7 of the exemplar library plan):
 * the two param-sandbox exemplars, authored THROUGH the sandbox companion-doc
 * format from docs/exemplars/brief-dose-response.md and
 * brief-break-even-studio.md. Unlike the branching exemplars (T5/T6), where
 * the starter is authored first and the doc is generated from it via the
 * serializer, here the DOC is the source of truth: the committed doc is
 * hand-written from the brief's fenced block, and the starter in
 * starter-configs.ts is a verbatim transcription of
 * parseSandboxCompanionDoc(doc).config. The parity test below is the stress
 * test that keeps that promise honest — drift between the doc and the
 * starter fails the build.
 */

type SandboxWitness = { challengeIndex: number; inputs: Record<string, number> };

function evaluateOutputsInOrder(config: SandboxConfig, inputValues: Record<string, number>): Record<string, number> {
  const vars: Record<string, number> = { ...inputValues };
  for (const out of config.outputs) {
    const parsed = parseFormula(out.formula);
    if (!parsed.ok) throw new Error(`output "${out.id}" formula failed to parse: ${parsed.error}`);
    vars[out.id] = evaluateFormula(parsed.ast, vars);
  }
  return vars;
}

function challengeSatisfied(challenge: SandboxConfig["challenges"][number], value: number): boolean {
  if (challenge.comparator === "gte") return value >= challenge.value!;
  if (challenge.comparator === "lte") return value <= challenge.value!;
  return value >= challenge.min! && value <= challenge.max!;
}

function assertWithinInputRanges(config: SandboxConfig, inputValues: Record<string, number>): void {
  for (const inp of config.inputs) {
    const v = inputValues[inp.id];
    expect(v, `witness is missing a value for input "${inp.id}"`).not.toBeUndefined();
    if (inp.min !== undefined) expect(v, `input "${inp.id}" witness value ${v} is below min ${inp.min}`).toBeGreaterThanOrEqual(inp.min);
    if (inp.max !== undefined) expect(v, `input "${inp.id}" witness value ${v} is above max ${inp.max}`).toBeLessThanOrEqual(inp.max);
  }
}

describe("Dose-Response Explorer — companion doc is the source of truth (stress test)", () => {
  const docPath = join(process.cwd(), "docs", "exemplars", "dose-response.companion.txt");
  const docText = readFileSync(docPath, "utf8");
  const { config: starterConfig } = PS_STARTERS["dose-response"];

  it("parses with zero error-severity issues", () => {
    const { report } = parseSandboxCompanionDoc(docText);
    expect(errors(report), JSON.stringify(errors(report))).toHaveLength(0);
  });

  it("has zero issues at all (no warnings either — none were anticipated by the brief)", () => {
    const { report } = parseSandboxCompanionDoc(docText);
    expect(report, JSON.stringify(report)).toHaveLength(0);
  });

  it("validates via validateSandboxConfig", () => {
    const { config } = parseSandboxCompanionDoc(docText);
    const r = validateSandboxConfig(config);
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });

  it("the starter config is structurally equal to parse(doc) (labels/types/ranges/defaults/units/formulas/decimals/charts/challenges)", () => {
    const { config } = parseSandboxCompanionDoc(docText);
    const validated = validateSandboxConfig(config);
    expect(validated.ok, !validated.ok ? validated.errors.join("; ") : "").toBe(true);
    if (!validated.ok) return;
    expect(validated.config).toEqual(starterConfig);
  });

  it("is grouped as an exemplar with a description naming the pattern", () => {
    expect(PS_STARTERS["dose-response"].group).toBe("exemplar");
    expect(PS_STARTERS["dose-response"].description).toContain("Pharmacokinetic model");
    expect(PS_STARTERS["dose-response"].description).toContain("half-life");
    expect(PS_STARTERS["dose-response"].description).toContain("therapeutic window");
  });

  it("intro's first sentence is the exact educational-not-clinical statement from the brief", () => {
    const statement =
      "This is an educational model, not clinical guidance: it uses simplified one compartment pharmacokinetics to show how dose and dosing interval shape peak and trough concentrations, and it must never be used to select, adjust, or check a dose for a real patient.";
    expect(starterConfig.intro).toBeTruthy();
    const introText = (starterConfig.intro ?? "").replace(/^<p>/, "");
    expect(introText.startsWith(statement)).toBe(true);
  });

  it("has 5 inputs, 5 outputs, 2 charts, 4 challenges", () => {
    expect(starterConfig.inputs).toHaveLength(5);
    expect(starterConfig.outputs).toHaveLength(5);
    expect(starterConfig.charts).toHaveLength(2);
    expect(starterConfig.challenges).toHaveLength(4);
  });

  it("dimensional sanity: every input and every output carries a non-empty units string", () => {
    for (const inp of starterConfig.inputs) {
      expect(inp.units, `input "${inp.id}" should carry units`).toBeTruthy();
      expect((inp.units ?? "").length).toBeGreaterThan(0);
    }
    for (const out of starterConfig.outputs) {
      expect(out.units, `output "${out.id}" should carry units`).toBeTruthy();
      expect((out.units ?? "").length).toBeGreaterThan(0);
    }
  });

  const witnesses: SandboxWitness[] = [
    { challengeIndex: 0, inputs: { dose: 500, dosing_interval: 8, patient_weight: 70, half_life: 4, volume_per_kilogram: 0.3 } },
    { challengeIndex: 1, inputs: { dose: 300, dosing_interval: 8, patient_weight: 70, half_life: 4, volume_per_kilogram: 0.3 } },
    { challengeIndex: 2, inputs: { dose: 225, dosing_interval: 6, patient_weight: 60, half_life: 5, volume_per_kilogram: 0.35 } },
    { challengeIndex: 3, inputs: { dose: 500, dosing_interval: 8, patient_weight: 70, half_life: 8, volume_per_kilogram: 0.3 } },
  ];
  const allFourWitness = { dose: 200, dosing_interval: 8, patient_weight: 70, half_life: 6, volume_per_kilogram: 0.3 };

  describe("witness vectors (evaluated through the real interpreter, declaration order)", () => {
    for (const w of witnesses) {
      const challenge = starterConfig.challenges[w.challengeIndex];
      it(`challenge ${w.challengeIndex + 1} ("${challenge.prompt.slice(0, 40)}...") is satisfied at its witness, and the witness is on-range`, () => {
        assertWithinInputRanges(starterConfig, w.inputs);
        const values = evaluateOutputsInOrder(starterConfig, w.inputs);
        const outputValue = values[challenge.outputId];
        expect(outputValue).not.toBeUndefined();
        expect(
          challengeSatisfied(challenge, outputValue),
          `challenge "${challenge.id}" not satisfied: output "${challenge.outputId}" = ${outputValue}`,
        ).toBe(true);
      });
    }

    it("the all-four witness satisfies every challenge at once, and dimensional sanity holds (peak > trough > 0)", () => {
      assertWithinInputRanges(starterConfig, allFourWitness);
      const values = evaluateOutputsInOrder(starterConfig, allFourWitness);
      for (const challenge of starterConfig.challenges) {
        const outputValue = values[challenge.outputId];
        expect(
          challengeSatisfied(challenge, outputValue),
          `challenge "${challenge.id}" not satisfied at the all-four witness: "${challenge.outputId}" = ${outputValue}`,
        ).toBe(true);
      }
      const peak = values["peak_concentration"];
      const trough = values["trough_concentration"];
      expect(peak).toBeGreaterThan(trough);
      expect(trough).toBeGreaterThan(0);
    });
  });
});

describe("Dose-Response Explorer — export package budget", () => {
  it('starter "dose-response" exports a zip under 40KB', async () => {
    const adapter = adapterFor("param-sandbox");
    const config = psStarterConfig("dose-response", "Exemplar Test: dose-response");

    const assembled = await assemblePackage({
      identifier: "ILB-exemplar-dose-response",
      title: config.title,
      engineId: "param-sandbox",
      config,
      runtime: { toRuntimeConfig: adapter.toRuntimeConfig, collectAssetIds: adapter.collectAssetIds },
      resolveAsset: async () => { throw new Error('starter "dose-response" has no assets'); },
    });

    const zip = await zipPackage(assembled.files);
    expect(zip.length).toBeLessThan(40 * 1024);
  });
});

describe("Break-Even Studio — companion doc is the source of truth (stress test)", () => {
  const docPath = join(process.cwd(), "docs", "exemplars", "break-even-studio.companion.txt");
  const docText = readFileSync(docPath, "utf8");
  const { config: starterConfig } = PS_STARTERS["break-even-studio"];

  it("parses with zero error-severity issues", () => {
    const { report } = parseSandboxCompanionDoc(docText);
    expect(errors(report), JSON.stringify(errors(report))).toHaveLength(0);
  });

  it("has zero issues at all (no warnings either — none were anticipated by the brief)", () => {
    const { report } = parseSandboxCompanionDoc(docText);
    expect(report, JSON.stringify(report)).toHaveLength(0);
  });

  it("validates via validateSandboxConfig", () => {
    const { config } = parseSandboxCompanionDoc(docText);
    const r = validateSandboxConfig(config);
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });

  it("the starter config is structurally equal to parse(doc) (labels/types/ranges/defaults/units/formulas/decimals/charts/challenges)", () => {
    const { config } = parseSandboxCompanionDoc(docText);
    const validated = validateSandboxConfig(config);
    expect(validated.ok, !validated.ok ? validated.errors.join("; ") : "").toBe(true);
    if (!validated.ok) return;
    expect(validated.config).toEqual(starterConfig);
  });

  it("is grouped as an exemplar with a description naming the pattern", () => {
    expect(PS_STARTERS["break-even-studio"].group).toBe("exemplar");
    expect(PS_STARTERS["break-even-studio"].description).toContain("Cost-volume-profit");
    expect(PS_STARTERS["break-even-studio"].description).toContain("contribution margin");
    expect(PS_STARTERS["break-even-studio"].description).toContain("break-even");
  });

  it("has 4 inputs, 4 outputs, 2 charts, 4 challenges", () => {
    expect(starterConfig.inputs).toHaveLength(4);
    expect(starterConfig.outputs).toHaveLength(4);
    expect(starterConfig.charts).toHaveLength(2);
    expect(starterConfig.challenges).toHaveLength(4);
  });

  it("every input and every output carries a non-empty units string", () => {
    for (const inp of starterConfig.inputs) expect((inp.units ?? "").length).toBeGreaterThan(0);
    for (const out of starterConfig.outputs) expect((out.units ?? "").length).toBeGreaterThan(0);
  });

  it("'Contribution margin ratio' resolves to itself and not to 'Contribution margin' (longest-label-first resolution)", () => {
    const ratioOutput = starterConfig.outputs.find((o) => o.id === "contribution_margin_ratio")!;
    expect(ratioOutput).toBeTruthy();
    const occurrences = ratioOutput.formula.match(/\bcontribution_margin\b/g) ?? [];
    expect(occurrences).toHaveLength(1);
    expect(ratioOutput.formula).not.toContain("contribution_margin_ratio");
  });

  const witnesses: SandboxWitness[] = [
    { challengeIndex: 0, inputs: { price: 45, unit_cost: 18, fixed_costs: 9000, volume: 400 } },
    { challengeIndex: 1, inputs: { price: 45, unit_cost: 21, fixed_costs: 9000, volume: 250 } },
    { challengeIndex: 2, inputs: { price: 60, unit_cost: 28, fixed_costs: 9000, volume: 250 } },
    { challengeIndex: 3, inputs: { price: 60, unit_cost: 28, fixed_costs: 9000, volume: 350 } },
  ];
  const allFourWitness = { price: 60, unit_cost: 28, fixed_costs: 9000, volume: 350 };

  describe("witness vectors (evaluated through the real interpreter, declaration order)", () => {
    for (const w of witnesses) {
      const challenge = starterConfig.challenges[w.challengeIndex];
      it(`challenge ${w.challengeIndex + 1} ("${challenge.prompt.slice(0, 40)}...") is satisfied at its witness, and the witness is on-range`, () => {
        assertWithinInputRanges(starterConfig, w.inputs);
        const values = evaluateOutputsInOrder(starterConfig, w.inputs);
        const outputValue = values[challenge.outputId];
        expect(outputValue).not.toBeUndefined();
        expect(
          challengeSatisfied(challenge, outputValue),
          `challenge "${challenge.id}" not satisfied: output "${challenge.outputId}" = ${outputValue}`,
        ).toBe(true);
      });
    }

    it("the all-four witness (same point as challenge 4) satisfies every challenge at once", () => {
      assertWithinInputRanges(starterConfig, allFourWitness);
      const values = evaluateOutputsInOrder(starterConfig, allFourWitness);
      for (const challenge of starterConfig.challenges) {
        const outputValue = values[challenge.outputId];
        expect(
          challengeSatisfied(challenge, outputValue),
          `challenge "${challenge.id}" not satisfied at the all-four witness: "${challenge.outputId}" = ${outputValue}`,
        ).toBe(true);
      }
    });

    it("the comparator uses the raw computed value, not the rounded display value (challenge 3 at 281.25, displayed 281)", () => {
      const values = evaluateOutputsInOrder(starterConfig, { price: 60, unit_cost: 28, fixed_costs: 9000, volume: 250 });
      expect(values["seats_to_break_even"]).toBeCloseTo(281.25, 5);
    });
  });

  describe("the deliberate Price = Unit cost singularity (caught per-point, not designed away)", () => {
    it("the model is meaningful only for Price > Unit cost: at Price = Unit cost, Seats to break even raises FormulaError rather than returning Infinity", () => {
      const inputsAtSingularity = { price: 40, unit_cost: 40, fixed_costs: 9000, volume: 250 };
      expect(() => evaluateOutputsInOrder(starterConfig, inputsAtSingularity)).toThrow(FormulaError);
    });

    it("sweeping the 'Seats to break even vs Price' chart's 40 samples hits the singularity at exactly one grid point (Unit cost = 40) and every other point evaluates cleanly", () => {
      const chart = starterConfig.charts.find((c) => c.id === "seats_to_break_even_vs_price")!;
      expect(chart).toBeTruthy();
      const xInput = starterConfig.inputs.find((i) => i.id === chart.xInputId)!;
      const min = xInput.min!;
      const max = xInput.max!;
      const unitCostOnGrid = 40;

      let errorCount = 0;
      let okCount = 0;
      for (let i = 0; i < chart.samples; i++) {
        const price = min + (i * (max - min)) / (chart.samples - 1);
        try {
          const values = evaluateOutputsInOrder(starterConfig, { price, unit_cost: unitCostOnGrid, fixed_costs: 9000, volume: 250 });
          expect(Number.isFinite(values[chart.yOutputId])).toBe(true);
          okCount++;
        } catch (e) {
          expect(e).toBeInstanceOf(FormulaError);
          errorCount++;
        }
      }
      expect(errorCount).toBe(1);
      expect(okCount).toBe(chart.samples - 1);
    });
  });
});

describe("Break-Even Studio — export package budget", () => {
  it('starter "break-even-studio" exports a zip under 40KB', async () => {
    const adapter = adapterFor("param-sandbox");
    const config = psStarterConfig("break-even-studio", "Exemplar Test: break-even-studio");

    const assembled = await assemblePackage({
      identifier: "ILB-exemplar-break-even-studio",
      title: config.title,
      engineId: "param-sandbox",
      config,
      runtime: { toRuntimeConfig: adapter.toRuntimeConfig, collectAssetIds: adapter.collectAssetIds },
      resolveAsset: async () => { throw new Error('starter "break-even-studio" has no assets'); },
    });

    const zip = await zipPackage(assembled.files);
    expect(zip.length).toBeLessThan(40 * 1024);
  });
});
