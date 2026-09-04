import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BRANCHING_STARTERS, branchingStarterConfig } from "@/lib/engines/branching-scenario/starters";
import { validateBranchingConfig, type BranchingConfig } from "@/lib/engines/branching-scenario/schema";
import { parseCompanionDoc, serializeCompanionDoc, type ImportIssue } from "@/lib/engines/branching-scenario/companion-doc";
import { adapterFor } from "@/lib/engines/dispatch";
import { assemblePackage, zipPackage } from "@/lib/export/package";
import { parseSandboxCompanionDoc } from "@/lib/engines/param-sandbox/companion-doc";
import { validateSandboxConfig, type SandboxConfig } from "@/lib/engines/param-sandbox/schema";
import { STARTERS as PS_STARTERS, starterConfig as psStarterConfig } from "@/lib/engines/param-sandbox/starter-configs";
import { parseFormula } from "@/lib/formula/parser";
import { evaluateFormula, FormulaError } from "@/lib/formula/evaluate";
import { parseCaseCompanionDoc, serializeCaseCompanionDoc } from "@/lib/engines/case-workspace/companion-doc";
import { validateCaseConfig, type CaseConfig } from "@/lib/engines/case-workspace/schema";
import { CASE_STARTERS, caseStarterConfig } from "@/lib/engines/case-workspace/starters";
import { scoreCase, evidenceRatio, reasonRatio } from "@/lib/engines/case-workspace/scoring";
import { parseProcessCompanionDoc, serializeProcessCompanionDoc } from "@/lib/engines/process-simulator/companion-doc";
import { validateProcessConfig, type ProcessConfig } from "@/lib/engines/process-simulator/schema";
import { PROCESS_STARTERS, processStarterConfig } from "@/lib/engines/process-simulator/starters";
import { beginProcedure, initialState, attemptAction, type ProcessState } from "@/lib/engines/process-simulator/state";
import { scoreProcess } from "@/lib/engines/process-simulator/scoring";

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

/**
 * The committed-companion-doc contract, shared by all four branching
 * exemplars (previously copy-pasted once for the Sierra Vista arc and again
 * for Plea Bargain). Two halves:
 *
 *  - `describeCommittedDocParity` — the doc parses cleanly, validates, and
 *    round-trips back to a config structurally identical to the starter
 *    (compared BY TITLE/LABEL, never by id: the companion-doc format names
 *    things by title, so ids are deliberately not preserved).
 *  - the byte-equality assertion inside it — the committed doc is EXACTLY
 *    `serializeCompanionDoc({ ...starter.config, title: starter.label })`.
 *    Structural parity alone let the two drift in every dimension the
 *    comparison does not visit (scene/ending bodies, feedback text, the
 *    intro); byte-equality closes that gap and makes "regenerate the doc
 *    from the starter" the only way to change one.
 */
function describeCommittedDocParity(starterId: string, slug: string): void {
  describe(`docs/exemplars/${slug}.companion.txt`, () => {
    const docPath = join(process.cwd(), "docs", "exemplars", `${slug}.companion.txt`);
    const docText = readFileSync(docPath, "utf8");
    const { config: original, label } = BRANCHING_STARTERS[starterId];

    it("parses with zero error-severity issues", () => {
      const { report } = parseCompanionDoc(docText);
      expect(errors(report), JSON.stringify(errors(report))).toHaveLength(0);
    });

    it("parses to a config that validates via validateBranchingConfig", () => {
      const { config } = parseCompanionDoc(docText);
      const r = validateBranchingConfig(config);
      expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
    });

    it("is byte-for-byte serializeCompanionDoc({ ...starter.config, title: starter.label })", () => {
      const expected = serializeCompanionDoc({ ...original, title: label });
      expect(
        docText,
        `docs/exemplars/${slug}.companion.txt is stale — regenerate it from the starter with serializeCompanionDoc({ ...BRANCHING_STARTERS["${starterId}"].config, title: BRANCHING_STARTERS["${starterId}"].label })`,
      ).toBe(expected);
    });

    it("carries the real, faculty-facing title (not the starter's placeholder \"\")", () => {
      const { config } = parseCompanionDoc(docText);
      expect((config as { title: string }).title).toBe(label);
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

  it('module 2 ("community-meeting") has exactly 1 showIf choice, gated on community_trust gte 60 (the working-group gate)', () => {
    const { config } = BRANCHING_STARTERS["community-meeting"];
    expect(countShowIf(config)).toBe(1);
    const gated = config.scenes.flatMap((s) => s.choices).find((c) => c.showIf);
    expect(gated?.showIf).toEqual({ variableId: "community_trust", comparator: "gte", value: 60 });
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
  for (const mod of ARC) describeCommittedDocParity(mod.id, mod.slug);
});

/**
 * The length cue (final review, item 1). Faculty-authored branching scenarios
 * drift toward a tell where the best choice is simply the longest one, which
 * lets a learner score well by counting words instead of reasoning. This gate
 * caps how often that pattern may hold PER STARTER: in at most 40% of a
 * starter's multi-choice scenes may the single longest label (by word count)
 * also be the `best` choice. A tie for longest does not count — the cue only
 * exists when one label is unambiguously longest.
 */
describe("branching starters — label length is not a quality cue", () => {
  const MAX_LONGEST_IS_BEST_RATIO = 0.4;
  const wordCount = (label: string): number => label.trim().split(/\s+/).length;

  for (const [starterId, starter] of Object.entries(BRANCHING_STARTERS)) {
    it(`starter "${starterId}": the longest label is uniquely the best choice in at most 40% of its multi-choice scenes`, () => {
      const multiChoiceScenes = starter.config.scenes.filter((s) => s.choices.length > 1);
      expect(multiChoiceScenes.length, `starter "${starterId}" has no multi-choice scenes`).toBeGreaterThan(0);

      const offenders: string[] = [];
      for (const scene of multiChoiceScenes) {
        const counts = scene.choices.map((c) => wordCount(c.label));
        const longest = Math.max(...counts);
        const atLongest = counts.reduce<number[]>((acc, n, i) => (n === longest ? [...acc, i] : acc), []);
        if (atLongest.length === 1 && scene.choices[atLongest[0]].quality === "best") offenders.push(scene.id);
      }

      expect(
        offenders.length / multiChoiceScenes.length,
        `scenes where the longest label is uniquely the best choice: ${offenders.join(", ") || "none"} (${offenders.length} of ${multiChoiceScenes.length})`,
      ).toBeLessThanOrEqual(MAX_LONGEST_IS_BEST_RATIO);
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
    // Faculty-facing wording (final review, item 9a): names the editor
    // controls by their on-screen labels rather than pointing at a repo path
    // a faculty author has no way to open.
    expect(config.intro).toContain("add a scene header image in the editor");
    expect(config.intro).toContain("Image, role, and description on the first scene");
    expect(config.intro).toContain("Delete this line in your version");
    expect(config.intro).not.toContain("docs/exemplars/");
  });

  it("carries the learner-visible learning objective in the intro", () => {
    expect(config.intro).toContain("evaluate a plea decision by the quality of the process behind it");
  });
});

describe("Plea Bargain — committed companion doc (parity + doc-format quality)", () => {
  describeCommittedDocParity("plea-bargain", "plea-bargain");
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

/**
 * Sandbox parity comparison (final review, item 9c). The committed doc is the
 * source of truth for everything EXCEPT `title`: starter-configs.ts has a
 * documented invariant that a starter's `config.title` is the placeholder ""
 * (the real title always comes from the "New interactive" form), while the
 * committed doc carries the real, faculty-facing TITLE so a designer who
 * opens the .txt sees a named activity. So the deep-equal normalizes `title`
 * to the starter's, and the doc's actual TITLE is asserted separately against
 * the starter's `label`.
 */
function expectSandboxDocParity(parsed: SandboxConfig, starterConfig: SandboxConfig, label: string): void {
  expect(parsed.title, "the committed doc should carry the real, faculty-facing TITLE").toBe(label);
  expect(starterConfig.title, 'starter configs keep the placeholder title ""').toBe("");
  expect({ ...parsed, title: starterConfig.title }).toEqual(starterConfig);
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
  const { config: starterConfig, label: starterLabel } = PS_STARTERS["dose-response"];

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

  it("the starter config is structurally equal to parse(doc) (labels/types/ranges/defaults/units/formulas/decimals/charts/challenges), title normalized", () => {
    const { config } = parseSandboxCompanionDoc(docText);
    const validated = validateSandboxConfig(config);
    expect(validated.ok, !validated.ok ? validated.errors.join("; ") : "").toBe(true);
    if (!validated.ok) return;
    expectSandboxDocParity(validated.config, starterConfig, starterLabel);
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

  // Final review, items 2 and 3: the trough floor (>=2 mg/L) and the peak
  // target band (12-20 mg/L) are two different thresholds and the intro must
  // not blur them into one "therapeutic window"; and the fiction disclosure
  // (invented agent, invented thresholds) has to be learner-visible, not
  // buried in the brief.
  it("discloses the fiction and keeps the trough floor and the peak target band distinct", () => {
    const intro = starterConfig.intro ?? "";
    expect(intro).toContain("invented for teaching");
    expect(intro).toContain("trough floor of 2 mg per litre");
    expect(intro).toContain("peak target band of 12 to 20 mg per litre");

    const prompts = starterConfig.challenges.map((c) => c.prompt);
    expect(prompts.join(" "), 'no challenge may call a threshold "the therapeutic window"').not.toContain("therapeutic");
    expect(prompts[0]).not.toContain("across the whole interval");
    expect(prompts[2]).toContain("in this model");
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
  const { config: starterConfig, label: starterLabel } = PS_STARTERS["break-even-studio"];

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

  it("the starter config is structurally equal to parse(doc) (labels/types/ranges/defaults/units/formulas/decimals/charts/challenges), title normalized", () => {
    const { config } = parseSandboxCompanionDoc(docText);
    const validated = validateSandboxConfig(config);
    expect(validated.ok, !validated.ok ? validated.errors.join("; ") : "").toBe(true);
    if (!validated.ok) return;
    expectSandboxDocParity(validated.config, starterConfig, starterLabel);
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

/**
 * The Ladder Incident (case-workspace M3, Task 2 of the exemplar plan): the
 * case-workspace engine's first exemplar, authored THROUGH the case
 * companion-doc format from docs/exemplars/brief-ladder-incident.md. As with
 * the two param-sandbox exemplars above, the DOC is the source of truth: the
 * committed doc is the brief's §5 fenced block (regenerated byte-exact from
 * the serializer, since the serializer's own trailing-newline convention
 * differs by one byte from the brief's hand-formatted block), and the starter
 * in starters.ts is a verbatim transcription of
 * parseCaseCompanionDoc(doc).config. The witness-path numbers below are
 * locked test fixtures per the brief's §6 walkthrough, computed through the
 * REAL scoring functions rather than re-derived here.
 */
describe("The Ladder Incident — companion doc is the source of truth (stress test)", () => {
  const docPath = join(process.cwd(), "docs", "exemplars", "ladder-incident.companion.txt");
  const docText = readFileSync(docPath, "utf8");
  const { config: starterConfig, label: starterLabel } = CASE_STARTERS["ladder-incident"];

  it("parses with zero issues of any severity (not merely zero errors)", () => {
    const { report } = parseCaseCompanionDoc(docText);
    expect(report, JSON.stringify(report)).toHaveLength(0);
  });

  it("validates via validateCaseConfig", () => {
    const { config } = parseCaseCompanionDoc(docText);
    const r = validateCaseConfig(config);
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });

  it("carries the real, faculty-facing TITLE (not the starter's placeholder \"\")", () => {
    const { config } = parseCaseCompanionDoc(docText);
    expect((config as { title: string }).title).toBe(starterLabel);
    expect(starterConfig.title).toBe("");
  });

  it("is byte-for-byte serializeCaseCompanionDoc({ ...starter.config, title: starter.label })", () => {
    const expected = serializeCaseCompanionDoc({ ...starterConfig, title: starterLabel });
    expect(
      docText,
      'docs/exemplars/ladder-incident.companion.txt is stale — regenerate it from the starter with serializeCaseCompanionDoc({ ...CASE_STARTERS["ladder-incident"].config, title: CASE_STARTERS["ladder-incident"].label })',
    ).toBe(expected);
  });

  it("the starter config is structurally equal to parse(doc), title normalized", () => {
    const { config } = parseCaseCompanionDoc(docText);
    const validated = validateCaseConfig(config);
    expect(validated.ok, !validated.ok ? validated.errors.join("; ") : "").toBe(true);
    if (!validated.ok) return;
    expect({ ...validated.config, title: starterConfig.title }).toEqual(starterConfig);
  });

  it("is grouped as an exemplar with a description naming the pattern", () => {
    expect(CASE_STARTERS["ladder-incident"].group).toBe("exemplar");
    expect(CASE_STARTERS["ladder-incident"].description.length).toBeGreaterThan(0);
    expect(CASE_STARTERS["ladder-incident"].description).toContain("best-supported");
  });

  it("has 7 artifacts (5 text, 2 table), 3 conclusions, 13 reasons, 11 expert-map entries, mode best-supported", () => {
    expect(starterConfig.scoringMode).toBe("best-supported");
    expect(starterConfig.artifacts).toHaveLength(7);
    expect(starterConfig.artifacts.filter((a) => a.kind === "text")).toHaveLength(5);
    expect(starterConfig.artifacts.filter((a) => a.kind === "table")).toHaveLength(2);
    expect(starterConfig.conclusions).toHaveLength(3);
    const reasonCount = starterConfig.conclusions.reduce((n, c) => n + c.reasons.length, 0);
    expect(reasonCount).toBe(13);
    expect(starterConfig.expertMap).toHaveLength(11);
  });

  it("has exactly one conclusion of each credit level (full, partial, none)", () => {
    const byCredit = { full: 0, partial: 0, none: 0 };
    for (const c of starterConfig.conclusions) byCredit[c.credit]++;
    expect(byCredit).toEqual({ full: 1, partial: 1, none: 1 });
  });

  it("has at least one unmapped artifact (the red herring)", () => {
    const mappedIds = new Set(starterConfig.expertMap.map((m) => m.artifactId));
    const unmapped = starterConfig.artifacts.filter((a) => !mappedIds.has(a.id));
    expect(unmapped.length).toBeGreaterThanOrEqual(1);
    expect(unmapped.map((a) => a.id)).toContain("peak_season_overtime_notice");
  });

  it("the inspection log's Asset tag column reads L-14, L-14, L-12, L-12, L-12, L-12 in that order", () => {
    const log = starterConfig.artifacts.find((a) => a.id === "ladder_inspection_log")!;
    expect(log.kind).toBe("table");
    const assetTagIdx = log.table!.headers.indexOf("Asset tag");
    expect(assetTagIdx).toBeGreaterThanOrEqual(0);
    expect(log.table!.rows.map((r) => r[assetTagIdx])).toEqual(["L-14", "L-14", "L-12", "L-12", "L-12", "L-12"]);
  });

  /**
   * The witness path — "the careful reader" (brief §6): a good but imperfect
   * run through the REAL scoring functions, locked exactly on the brief's
   * numbers (including the deliberate .5-boundary round to 68, which would
   * regress to 67 under banker's rounding).
   */
  describe("the witness path — locked through the real scoring functions", () => {
    const chosenId = "the_ladder_failed_structurally";
    const includedIds = ["incident_report", "ladder_examination_report", "ladder_inspection_log", "peak_season_overtime_notice"];
    const selectedReasonIds = ["about_seventy_percent_of_the_fra", "the_log_records_no_inspection_of", "the_examination_shows_that_this"];

    it("evidenceRatio is 3/4 (included supports minus included contradicts, over supports(C))", () => {
      const e = evidenceRatio(starterConfig as CaseConfig, chosenId, includedIds);
      expect(e).toEqual({ num: 3, den: 4 });
    });

    it("reasonRatio is 1/3 (selected sound minus selected flawed, over sound reasons)", () => {
      const r = reasonRatio(starterConfig as CaseConfig, chosenId, selectedReasonIds);
      expect(r).toEqual({ num: 1, den: 3 });
    });

    it("scoreCase(...).totalPct === 68 (the deliberate .5-boundary round-half-up fixture)", () => {
      const score = scoreCase(starterConfig as CaseConfig, chosenId, includedIds, selectedReasonIds);
      expect(score.evidence).toEqual({ num: 3, den: 4 });
      expect(score.reason).toEqual({ num: 1, den: 3 });
      expect(score.credit).toBe("full");
      expect(score.totalPct).toBe(68);
    });
  });

  /**
   * Reason length is not a quality cue (spec §7's pooled formulation, per the
   * brief's §6 measurement): across all conclusions, a flawed reason may be
   * the uniquely longest reason of its conclusion in at most 40% of
   * conclusions, and the uniquely shortest in at most 40%.
   */
  describe("reasons — length is not a quality cue", () => {
    const wordCount = (text: string): number => text.trim().split(/\s+/).length;

    it("flawed-is-uniquely-longest is 0/3 and flawed-is-uniquely-shortest is 1/3, both within the 40% gate", () => {
      let longestOffenders = 0;
      let shortestOffenders = 0;
      for (const c of starterConfig.conclusions) {
        const counts = c.reasons.map((r) => ({ words: wordCount(r.text), sound: r.sound }));
        const longest = Math.max(...counts.map((c2) => c2.words));
        const shortest = Math.min(...counts.map((c2) => c2.words));
        const atLongest = counts.filter((c2) => c2.words === longest);
        const atShortest = counts.filter((c2) => c2.words === shortest);
        if (atLongest.length === 1 && !atLongest[0].sound) longestOffenders++;
        if (atShortest.length === 1 && !atShortest[0].sound) shortestOffenders++;
      }
      const total = starterConfig.conclusions.length;
      expect(longestOffenders / total).toBeLessThanOrEqual(0.4);
      expect(shortestOffenders / total).toBeLessThanOrEqual(0.4);
      // Locked to the brief's exact measurement (§6): 0/3 longest, 1/3 shortest.
      expect(longestOffenders).toBe(0);
      expect(shortestOffenders).toBe(1);
    });

    it("advisory band: |mean(words(sound)) - mean(words(flawed))| <= 0.15 * mean(words(all))", () => {
      const sound: number[] = [];
      const flawed: number[] = [];
      for (const c of starterConfig.conclusions) {
        for (const r of c.reasons) (r.sound ? sound : flawed).push(wordCount(r.text));
      }
      const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
      const meanSound = mean(sound);
      const meanFlawed = mean(flawed);
      const meanAll = mean([...sound, ...flawed]);
      expect(Math.abs(meanSound - meanFlawed)).toBeLessThanOrEqual(0.15 * meanAll);
    });
  });
});

describe("The Ladder Incident — CASE_STARTERS / dispatch registration (generic loops pick it up automatically)", () => {
  it("is registered in CASE_STARTERS and validates via validateCaseConfig", () => {
    expect(CASE_STARTERS["ladder-incident"]).toBeTruthy();
    const r = validateCaseConfig(CASE_STARTERS["ladder-incident"].config);
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });

  it("caseStarterConfig stamps a fresh title onto a fresh object tree", () => {
    const a = caseStarterConfig("ladder-incident", "Title A");
    const b = caseStarterConfig("ladder-incident", "Title B");
    expect(a.title).toBe("Title A");
    expect(b.title).toBe("Title B");
    expect(a.artifacts).not.toBe(b.artifacts);
    const r = validateCaseConfig(a);
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });

  it("is listed in the engine dispatch table's starters list", () => {
    const adapter = adapterFor("case-workspace");
    const listed = adapter.starters.find((s) => s.id === "ladder-incident");
    expect(listed).toBeTruthy();
    expect(listed?.label).toBe("The Ladder Incident");
    expect(listed?.group).toBe("exemplar");
  });
});

describe("The Ladder Incident — export package budget", () => {
  it('starter "ladder-incident" exports a zip under 40KB', async () => {
    const adapter = adapterFor("case-workspace");
    const config = caseStarterConfig("ladder-incident", "Exemplar Test: ladder-incident");

    const assembled = await assemblePackage({
      identifier: "ILB-exemplar-ladder-incident",
      title: config.title,
      engineId: "case-workspace",
      config,
      runtime: { toRuntimeConfig: adapter.toRuntimeConfig, collectAssetIds: adapter.collectAssetIds },
      resolveAsset: async () => { throw new Error('starter "ladder-incident" has no assets'); },
    });

    const zip = await zipPackage(assembled.files);
    expect(zip.length).toBeLessThan(40 * 1024);
  });
});

/**
 * Evidence Intake (process-simulator M3, Task 2 of the exemplar plan): the
 * process-simulator engine's first exemplar, authored THROUGH the process
 * companion-doc format from docs/exemplars/brief-evidence-intake.md. As with
 * the param-sandbox pair and The Ladder Incident above, the DOC is the
 * source of truth: the committed doc is the brief's §5 fenced block
 * verbatim, and the starter in starters.ts (group "exemplar") is a verbatim
 * transcription of parseProcessCompanionDoc(doc).config. Every number below
 * — the witness/flawless/messy scoring fixtures, the 8-legal-orders count,
 * the no-giveaway gates — is computed through the REAL parser, validator,
 * state machine and scoring functions, exactly as the brief's §6 requires,
 * not re-derived by hand here.
 */
describe("Evidence Intake — companion doc is the source of truth (stress test)", () => {
  const docPath = join(process.cwd(), "docs", "exemplars", "evidence-intake.companion.txt");
  const docText = readFileSync(docPath, "utf8");
  const { config: starterConfig, label: starterLabel } = PROCESS_STARTERS["evidence-intake"];

  it("parses with zero issues of any severity (not merely zero errors)", () => {
    const { report } = parseProcessCompanionDoc(docText);
    expect(report, JSON.stringify(report)).toHaveLength(0);
  });

  it("validates via validateProcessConfig", () => {
    const { config } = parseProcessCompanionDoc(docText);
    const r = validateProcessConfig(config);
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });

  it("carries the real, faculty-facing TITLE (not the starter's placeholder \"\")", () => {
    const { config } = parseProcessCompanionDoc(docText);
    expect((config as { title: string }).title).toBe(starterLabel);
    expect(starterConfig.title).toBe("");
  });

  it("is byte-for-byte serializeProcessCompanionDoc({ ...starter.config, title: starter.label })", () => {
    const expected = serializeProcessCompanionDoc({ ...starterConfig, title: starterLabel });
    expect(
      docText,
      'docs/exemplars/evidence-intake.companion.txt is stale — regenerate it from the starter with serializeProcessCompanionDoc({ ...PROCESS_STARTERS["evidence-intake"].config, title: PROCESS_STARTERS["evidence-intake"].label })',
    ).toBe(expected);
  });

  it("the starter config is structurally equal to parse(doc), title normalized", () => {
    const { config } = parseProcessCompanionDoc(docText);
    const validated = validateProcessConfig(config);
    expect(validated.ok, !validated.ok ? validated.errors.join("; ") : "").toBe(true);
    if (!validated.ok) return;
    expect({ ...validated.config, title: starterConfig.title }).toEqual(starterConfig);
  });

  it("is grouped as an exemplar with a description naming the pattern", () => {
    expect(PROCESS_STARTERS["evidence-intake"].group).toBe("exemplar");
    expect(PROCESS_STARTERS["evidence-intake"].description.length).toBeGreaterThan(0);
    expect(PROCESS_STARTERS["evidence-intake"].description).toContain("chain of custody");
  });

  it("has 13 actions (9 required, 4 distractors) and 9 prerequisite edges", () => {
    expect(starterConfig.actions).toHaveLength(13);
    expect(starterConfig.actions.filter((a) => a.required)).toHaveLength(9);
    expect(starterConfig.actions.filter((a) => !a.required)).toHaveLength(4);
    const edgeCount = starterConfig.actions.reduce((n, a) => n + (a.requires?.length ?? 0), 0);
    expect(edgeCount).toBe(9);
  });

  /**
   * Counts the number of distinct legal completion orders of the required
   * actions (a brute-force topological-order count over the small 9-node
   * graph — feasible since the graph never exceeds ~a few thousand orders
   * for this shape). Used to lock the brief's "8 legal orders" claim and to
   * assert the load-bearing non-edge between photograph and sketch.
   */
  function countLegalOrders(actions: ProcessConfig["actions"]): number {
    const required = actions.filter((a) => a.required);
    const byId = new Map(required.map((a) => [a.id, a] as const));
    const ids = required.map((a) => a.id);
    const memo = new Map<string, number>();
    function count(doneMask: Set<string>, remaining: string[]): number {
      if (remaining.length === 0) return 1;
      const key = [...doneMask].sort().join(",") + "|" + [...remaining].sort().join(",");
      if (memo.has(key)) return memo.get(key)!;
      let total = 0;
      for (const id of remaining) {
        const action = byId.get(id)!;
        const reqs = action.requires ?? [];
        if (reqs.every((r) => doneMask.has(r))) {
          const nextDone = new Set(doneMask);
          nextDone.add(id);
          total += count(nextDone, remaining.filter((x) => x !== id));
        }
      }
      memo.set(key, total);
      return total;
    }
    return count(new Set(), ids);
  }

  it("has exactly 8 legal orders of the 9 required actions", () => {
    expect(countLegalOrders(starterConfig.actions)).toBe(8);
  });

  it("the load-bearing non-edge: photograph and sketch carry no prerequisite on each other, in either direction", () => {
    const photograph = starterConfig.actions.find((a) => a.id === "photograph_the_item_where_it_lie")!;
    const sketch = starterConfig.actions.find((a) => a.id === "sketch_the_room_and_measure_the")!;
    expect(photograph.requires ?? []).not.toContain(sketch.id);
    expect(sketch.requires ?? []).not.toContain(photograph.id);
    // Both are gated only on "secure the scene" (the graph's genuine sibling pair).
    expect(photograph.requires).toEqual(["secure_the_scene_and_control_who"]);
    expect(sketch.requires).toEqual(["secure_the_scene_and_control_who"]);
  });

  function idFor(config: ProcessConfig, label: string): string {
    const action = config.actions.find((a) => a.label.toLowerCase() === label.toLowerCase());
    if (!action) throw new Error(`no action with label "${label}"`);
    return action.id;
  }

  function runClicks(config: ProcessConfig, labels: string[]): { state: ProcessState; score: ReturnType<typeof scoreProcess> | undefined } {
    let state = beginProcedure(initialState());
    let score: ReturnType<typeof scoreProcess> | undefined;
    for (const label of labels) {
      const result = attemptAction(config, state, idFor(config, label));
      state = result.state;
      score = result.score ?? score;
    }
    return { state, score };
  }

  /**
   * The witness path — "the eager collector" (brief §6): sixteen clicks,
   * seven of them illegal, locked exactly on the brief's numbers (including
   * the deliberate .5-boundary round to 63, which would regress to 62 under
   * banker's rounding).
   */
  describe("the witness path — locked through the real state machine and scoring", () => {
    const witnessClicks = [
      "Photograph the item where it lies",
      "Secure the scene and control who enters it",
      "Photograph the item where it lies",
      "Collect the item and place it in an evidence bag",
      "Move the item into better light before photographing it",
      "Sketch the room and measure the item's position",
      "Collect the item and place it in an evidence bag",
      "Put on a fresh pair of examination gloves",
      "Collect the item and place it in an evidence bag",
      "Seal the bag with office tape from the drawer",
      "Seal the evidence bag with tamper-evident tape",
      "Record the item on the agency evidence log",
      "Label the sealed bag and initial across the seal",
      "Fill in the evidence log at shift end",
      "Record the item on the agency evidence log",
      "Transfer the sealed package to the evidence custodian",
    ];

    it("scoreProcess(...).totalPct === 63 (the deliberate .5-boundary round-half-up fixture), cleanCount 6, totalAttempts 16", () => {
      const { state, score } = runClicks(starterConfig, witnessClicks);
      expect(state.attempts.get(idFor(starterConfig, "Photograph the item where it lies"))).toBe(1);
      expect(state.attempts.get(idFor(starterConfig, "Collect the item and place it in an evidence bag"))).toBe(2);
      expect(state.attempts.get(idFor(starterConfig, "Move the item into better light before photographing it"))).toBe(1);
      expect(state.attempts.get(idFor(starterConfig, "Seal the bag with office tape from the drawer"))).toBe(1);
      expect(state.attempts.get(idFor(starterConfig, "Record the item on the agency evidence log"))).toBe(1);
      expect(state.attempts.get(idFor(starterConfig, "Fill in the evidence log at shift end"))).toBe(1);
      expect(state.attempts.get(idFor(starterConfig, "Hand the item to the reporting party to hold"))).toBeUndefined();

      expect(score).toBeDefined();
      expect(score!.correctness).toEqual({ num: 6, den: 9 });
      expect(score!.efficiency).toEqual({ num: 9, den: 16 });
      expect(score!.totalPct).toBe(63);
    });
  });

  it("the flawless run (9 clicks, non-obvious order: sketch before gloves) scores 100", () => {
    const flawlessClicks = [
      "Secure the scene and control who enters it",
      "Photograph the item where it lies",
      "Sketch the room and measure the item's position",
      "Put on a fresh pair of examination gloves",
      "Collect the item and place it in an evidence bag",
      "Seal the evidence bag with tamper-evident tape",
      "Label the sealed bag and initial across the seal",
      "Record the item on the agency evidence log",
      "Transfer the sealed package to the evidence custodian",
    ];
    const { score } = runClicks(starterConfig, flawlessClicks);
    expect(score).toBeDefined();
    expect(score!.correctness).toEqual({ num: 9, den: 9 });
    expect(score!.efficiency).toEqual({ num: 9, den: 9 });
    expect(score!.totalPct).toBe(100);
  });

  it("a messy 19-click run (clean 5/9, totalAttempts 19) scores 52 (8940/171, floored)", () => {
    const messyClicks = [
      "Collect the item and place it in an evidence bag",
      "Secure the scene and control who enters it",
      "Collect the item and place it in an evidence bag",
      "Move the item into better light before photographing it",
      "Photograph the item where it lies",
      "Collect the item and place it in an evidence bag",
      "Hand the item to the reporting party to hold",
      "Sketch the room and measure the item's position",
      "Seal the bag with office tape from the drawer",
      "Put on a fresh pair of examination gloves",
      "Collect the item and place it in an evidence bag",
      "Label the sealed bag and initial across the seal",
      "Seal the evidence bag with tamper-evident tape",
      "Record the item on the agency evidence log",
      "Label the sealed bag and initial across the seal",
      "Transfer the sealed package to the evidence custodian",
      "Fill in the evidence log at shift end",
      "Record the item on the agency evidence log",
      "Transfer the sealed package to the evidence custodian",
    ];
    const { score } = runClicks(starterConfig, messyClicks);
    expect(score).toBeDefined();
    expect(score!.correctness).toEqual({ num: 5, den: 9 });
    expect(score!.efficiency).toEqual({ num: 9, den: 19 });
    expect(score!.totalPct).toBe(52);
  });

  /**
   * No-giveaway gates (spec §7's pooled formulation, per the brief's §6
   * measurement): word count is label.trim().split(/\s+/).length on the
   * parsed label.
   */
  describe("no-giveaway gates — label length is not a quality cue", () => {
    const wordCount = (label: string): number => label.trim().split(/\s+/).length;

    it("pooled mean band holds: |mean(required) - mean(distractor)| <= 0.15 * mean(all) (0.7500 <= 1.2346)", () => {
      const required = starterConfig.actions.filter((a) => a.required).map((a) => wordCount(a.label));
      const distractor = starterConfig.actions.filter((a) => !a.required).map((a) => wordCount(a.label));
      const all = starterConfig.actions.map((a) => wordCount(a.label));
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      const band = Math.abs(mean(required) - mean(distractor));
      expect(band).toBeLessThanOrEqual(0.15 * mean(all));
      expect(band).toBeCloseTo(0.75, 4);
    });

    it("no distractor is the uniquely longest or uniquely shortest label in the pool", () => {
      const withCounts = starterConfig.actions.map((a) => ({ id: a.id, required: a.required, words: wordCount(a.label) }));
      const longest = Math.max(...withCounts.map((a) => a.words));
      const shortest = Math.min(...withCounts.map((a) => a.words));
      const atLongest = withCounts.filter((a) => a.words === longest);
      const atShortest = withCounts.filter((a) => a.words === shortest);
      const uniquelyLongestIsDistractor = atLongest.length === 1 && !atLongest[0].required;
      const uniquelyShortestIsDistractor = atShortest.length === 1 && !atShortest[0].required;
      expect(uniquelyLongestIsDistractor).toBe(false);
      expect(uniquelyShortestIsDistractor).toBe(false);
      // Locked to the brief's exact measurement (§6): both extremes (10 and
      // 6 words) are held uniquely by required actions.
      expect(longest).toBe(10);
      expect(atLongest).toHaveLength(1);
      expect(atLongest[0].required).toBe(true);
      expect(shortest).toBe(6);
      expect(atShortest).toHaveLength(1);
      expect(atShortest[0].required).toBe(true);
    });
  });

  it('banned words ("admissible", "thrown out") are absent from every learner-visible string', () => {
    const strings: string[] = [starterConfig.title, starterConfig.intro, starterConfig.opening, starterConfig.expertNote ?? ""];
    for (const a of starterConfig.actions) {
      strings.push(a.label, a.outcome ?? "", a.consequence ?? "", a.consequenceNote ?? "");
    }
    const joined = strings.join(" \n ").toLowerCase();
    expect(joined).not.toContain("admissible");
    expect(joined).not.toContain("thrown out");
  });

  it("the scope statement appears verbatim in the intro", () => {
    expect(starterConfig.intro).toContain(
      "Ashmoor County, its sheriff's office, its evidence manual and everyone named here are fictional. What follows is one fictional agency's standard operating procedure, written to teach the reasoning behind evidence handling; it is not a standard, and the policy of the agency you work for governs how you actually do this work.",
    );
  });
});

describe("Evidence Intake — PROCESS_STARTERS / dispatch registration (generic loops pick it up automatically)", () => {
  it("is registered in PROCESS_STARTERS and validates via validateProcessConfig", () => {
    expect(PROCESS_STARTERS["evidence-intake"]).toBeTruthy();
    const r = validateProcessConfig(PROCESS_STARTERS["evidence-intake"].config);
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });

  it("processStarterConfig stamps a fresh title onto a fresh object tree", () => {
    const a = processStarterConfig("evidence-intake", "Title A");
    const b = processStarterConfig("evidence-intake", "Title B");
    expect(a.title).toBe("Title A");
    expect(b.title).toBe("Title B");
    expect(a.actions).not.toBe(b.actions);
    const r = validateProcessConfig(a);
    expect(r.ok, !r.ok ? r.errors.join("; ") : "").toBe(true);
  });

  it("is listed in the engine dispatch table's starters list", () => {
    const adapter = adapterFor("process-simulator");
    const listed = adapter.starters.find((s) => s.id === "evidence-intake");
    expect(listed).toBeTruthy();
    expect(listed?.label).toBe("Evidence Intake");
    expect(listed?.group).toBe("exemplar");
  });
});

describe("Evidence Intake — export package budget", () => {
  it('starter "evidence-intake" exports a zip under 40KB', async () => {
    const adapter = adapterFor("process-simulator");
    const config = processStarterConfig("evidence-intake", "Exemplar Test: evidence-intake");

    const assembled = await assemblePackage({
      identifier: "ILB-exemplar-evidence-intake",
      title: config.title,
      engineId: "process-simulator",
      config,
      runtime: { toRuntimeConfig: adapter.toRuntimeConfig, collectAssetIds: adapter.collectAssetIds },
      resolveAsset: async () => { throw new Error('starter "evidence-intake" has no assets'); },
    });

    const zip = await zipPackage(assembled.files);
    expect(zip.length).toBeLessThan(40 * 1024);
  });
});
