import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BRANCHING_STARTERS, branchingStarterConfig } from "@/lib/engines/branching-scenario/starters";
import { validateBranchingConfig, type BranchingConfig } from "@/lib/engines/branching-scenario/schema";
import { parseCompanionDoc, type ImportIssue } from "@/lib/engines/branching-scenario/companion-doc";
import { adapterFor } from "@/lib/engines/dispatch";
import { assemblePackage, zipPackage } from "@/lib/export/package";

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
