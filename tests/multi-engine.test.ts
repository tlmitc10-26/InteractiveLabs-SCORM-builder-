import { describe, it, expect } from "vitest";
import { loadEngineManifest, engineEntry } from "@/lib/engines/registry";
import { adapterFor, ENGINE_ADAPTERS } from "@/lib/engines/dispatch";
import { assemblePackage, zipPackage } from "@/lib/export/package";
import { scanPackage } from "@/lib/export/scanner";
import { emptySandboxConfig, validateSandboxConfig } from "@/lib/engines/param-sandbox/schema";
import { branchingStarterConfig } from "@/lib/engines/branching-scenario/starters";
import { validateBranchingConfig } from "@/lib/engines/branching-scenario/schema";
import { caseStarterConfig } from "@/lib/engines/case-workspace/starters";
import { validateCaseConfig } from "@/lib/engines/case-workspace/schema";
import { processStarterConfig } from "@/lib/engines/process-simulator/starters";
import { validateProcessConfig } from "@/lib/engines/process-simulator/schema";

describe("engineEntry", () => {
  it("returns the matching engine entry from the manifest", () => {
    const manifest = loadEngineManifest();
    const entry = engineEntry(manifest, "param-sandbox");
    expect(entry.id).toBe("param-sandbox");
  });

  it("throws a clear, actionable error for an unknown engine id", () => {
    const manifest = loadEngineManifest();
    expect(() => engineEntry(manifest, "nope")).toThrow(
      'engine "nope" not found in engines.manifest.json — run npm run build:engines',
    );
  });
});

describe("adapterFor", () => {
  it("dispatches the param-sandbox adapter by engineId", () => {
    const adapter = adapterFor("param-sandbox");
    expect(adapter.engineId).toBe("param-sandbox");
    expect(adapter).toBe(ENGINE_ADAPTERS["param-sandbox"]);
  });

  it("validates through the adapter identically to validateSandboxConfig", () => {
    const adapter = adapterFor("param-sandbox");
    const config = emptySandboxConfig("Adapter Test");
    const direct = validateSandboxConfig(config);
    const viaAdapter = adapter.validate(config);
    expect(viaAdapter.ok).toBe(direct.ok);
    if (viaAdapter.ok && direct.ok) expect(viaAdapter.config).toEqual(direct.config);
  });

  it("throws on an unknown engine id", () => {
    expect(() => adapterFor("does-not-exist")).toThrow('unknown engine "does-not-exist"');
  });

  it("dispatches the branching-scenario adapter by engineId", () => {
    const adapter = adapterFor("branching-scenario");
    expect(adapter.engineId).toBe("branching-scenario");
    expect(adapter.version).toBe("1.0.0");
    expect(adapter.label).toBe("Branching Scenario");
    expect(adapter).toBe(ENGINE_ADAPTERS["branching-scenario"]);
  });

  it("validates through the branching adapter identically to validateBranchingConfig", () => {
    const adapter = adapterFor("branching-scenario");
    const config = branchingStarterConfig("jury", "Adapter Test");
    const direct = validateBranchingConfig(config);
    const viaAdapter = adapter.validate(config);
    expect(viaAdapter.ok).toBe(direct.ok);
    if (viaAdapter.ok && direct.ok) expect(viaAdapter.config).toEqual(direct.config);
  });

  it("dispatches the case-workspace adapter by engineId (third engine, plan Task 6)", () => {
    const adapter = adapterFor("case-workspace");
    expect(adapter.engineId).toBe("case-workspace");
    expect(adapter.version).toBe("1.0.0");
    expect(adapter.label).toBe("Case / Evidence Workspace");
    expect(adapter).toBe(ENGINE_ADAPTERS["case-workspace"]);
  });

  it("validates through the case-workspace adapter identically to validateCaseConfig", () => {
    const adapter = adapterFor("case-workspace");
    const config = caseStarterConfig("blank", "Adapter Test");
    const direct = validateCaseConfig(config);
    const viaAdapter = adapter.validate(config);
    expect(viaAdapter.ok).toBe(direct.ok);
    if (viaAdapter.ok && direct.ok) expect(viaAdapter.config).toEqual(direct.config);
  });

  it("dispatches the process-simulator adapter by engineId (fourth engine, plan Task 4)", () => {
    const adapter = adapterFor("process-simulator");
    expect(adapter.engineId).toBe("process-simulator");
    expect(adapter.version).toBe("1.0.0");
    expect(adapter.label).toBe("Process Simulator");
    expect(adapter).toBe(ENGINE_ADAPTERS["process-simulator"]);
  });

  it("validates through the process-simulator adapter identically to validateProcessConfig", () => {
    const adapter = adapterFor("process-simulator");
    const config = processStarterConfig("blank", "Adapter Test");
    const direct = validateProcessConfig(config);
    const viaAdapter = adapter.validate(config);
    expect(viaAdapter.ok).toBe(direct.ok);
    if (viaAdapter.ok && direct.ok) expect(viaAdapter.config).toEqual(direct.config);
  });

  it("collectAssetIds always returns empty for process-simulator (no assets in v1)", () => {
    const adapter = adapterFor("process-simulator");
    const config = processStarterConfig("blank", "Adapter Test");
    expect(adapter.collectAssetIds(config)).toEqual([]);
  });

  it("builds a title-stamped starter config per engine via adapter.starterConfig", () => {
    const ps = adapterFor("param-sandbox").starterConfig("blank", "My Sandbox") as { title: string };
    expect(ps.title).toBe("My Sandbox");
    const branching = adapterFor("branching-scenario").starterConfig("jury", "My Scenario") as { title: string };
    expect(branching.title).toBe("My Scenario");
    const caseWorkspace = adapterFor("case-workspace").starterConfig("blank", "My Case") as { title: string };
    expect(caseWorkspace.title).toBe("My Case");
    const process = adapterFor("process-simulator").starterConfig("blank", "My Procedure") as { title: string };
    expect(process.title).toBe("My Procedure");
  });

  it("falls back to each engine's default starter for an unknown starter id, rather than throwing", () => {
    expect(() => adapterFor("param-sandbox").starterConfig("no-such-starter", "T")).not.toThrow();
    expect(() => adapterFor("branching-scenario").starterConfig("no-such-starter", "T")).not.toThrow();
    expect(() => adapterFor("case-workspace").starterConfig("no-such-starter", "T")).not.toThrow();
    expect(() => adapterFor("process-simulator").starterConfig("no-such-starter", "T")).not.toThrow();
  });

  it("exposes starters metadata (id/label/description) for each engine, for uniform UI dispatch", () => {
    // Invariants over the full starter set rather than an exact id list (the
    // exemplar library, Tasks 5-7, keeps adding starters to both engines) --
    // every starter must carry a non-empty id/label/description and a valid
    // group, ids must be unique, and the "blank" starter must exist so the
    // picker always has a from-scratch option.
    for (const engineId of ["param-sandbox", "branching-scenario", "case-workspace", "process-simulator"] as const) {
      const starters = adapterFor(engineId).starters;
      const ids = starters.map((s) => s.id);
      expect(new Set(ids).size, `${engineId} starter ids should be unique`).toBe(ids.length);
      expect(ids, `${engineId} should offer a "blank" starter`).toContain("blank");
      for (const s of starters) {
        expect(typeof s.id, `${engineId} starter id`).toBe("string");
        expect(s.id.length, `${engineId} starter id should be non-empty`).toBeGreaterThan(0);
        expect(typeof s.label).toBe("string");
        expect(s.label.length, `${engineId} starter "${s.id}" label should be non-empty`).toBeGreaterThan(0);
        expect(s.description.length, `${engineId} starter "${s.id}" description should be non-empty`).toBeGreaterThan(0);
        expect(["blank", "exemplar"], `${engineId} starter "${s.id}" group`).toContain(s.group);
      }
    }
  });

  it("richTextValues walks the branching config's intro + every scene body + ending body + choice feedback (not just intro)", () => {
    const adapter = adapterFor("branching-scenario");
    const config = branchingStarterConfig("jury", "RichText Test");
    const values = adapter.richTextValues(config);
    // The jury starter sets no top-level `intro`, but every scene body,
    // ending body, and every choice's feedback text must still be present.
    for (const scene of config.scenes) {
      expect(values).toContain(scene.body);
      for (const choice of scene.choices) if (choice.feedback) expect(values).toContain(choice.feedback);
    }
    for (const ending of config.endings) expect(values).toContain(ending.body);
  });

  it("richTextValues walks the case-workspace config's intro + every artifact body + conclusion body + expertRationale (not just intro)", () => {
    const adapter = adapterFor("case-workspace");
    const config = caseStarterConfig("blank", "RichText Test");
    const values = adapter.richTextValues(config);
    expect(values).toContain(config.intro);
    for (const artifact of config.artifacts) if (artifact.body) expect(values).toContain(artifact.body);
    for (const conclusion of config.conclusions) {
      if (conclusion.body) expect(values).toContain(conclusion.body);
      expect(values).toContain(conclusion.expertRationale);
    }
  });

  it("richTextValues walks the process-simulator config's intro + opening + expertNote + every action's outcome + consequence (not just intro)", () => {
    const adapter = adapterFor("process-simulator");
    const config = processStarterConfig("blank", "RichText Test");
    const values = adapter.richTextValues(config);
    expect(values).toContain(config.intro);
    expect(values).toContain(config.opening);
    if (config.expertNote) expect(values).toContain(config.expertNote);
    for (const action of config.actions) {
      if (action.outcome) expect(values).toContain(action.outcome);
      if (action.consequence) expect(values).toContain(action.consequence);
    }
  });
});

describe("assemblePackage: engineId dispatch produces the pre-refactor param-sandbox output", () => {
  it("produces the identical file set, manifest contents, and index.html for engineId \"param-sandbox\"", async () => {
    const adapter = adapterFor("param-sandbox");
    const config = emptySandboxConfig("Multi-Engine Parity");

    const assembled = await assemblePackage({
      identifier: "ILB-parity",
      title: config.title,
      engineId: "param-sandbox",
      config,
      runtime: { toRuntimeConfig: adapter.toRuntimeConfig, collectAssetIds: adapter.collectAssetIds },
      resolveAsset: async () => { throw new Error("no assets in this config"); },
    });

    // This is the exact pre-refactor expectation for assemblePackage's file
    // set on emptySandboxConfig (see tests/export-package.test.ts's
    // long-standing "assembles a complete package" case) -- proves the
    // engineId + runtime-adapter plumbing changes nothing observable for
    // the param-sandbox engine.
    const paths = [...assembled.files.keys()].sort();
    expect(paths).toEqual([
      "content/config.json",
      "engine/engine.css",
      "engine/engine.js",
      "engine/scorm-adapter.js",
      "imsmanifest.xml",
      "index.html",
    ]);
    expect(assembled.indexHtml).toBe(assembled.files.get("index.html")!.toString());
    expect(assembled.indexHtml).toContain('"inputs"');
    const manifestXml = assembled.files.get("imsmanifest.xml")!.toString();
    expect(manifestXml).toContain("<title>Multi-Engine Parity</title>");
    for (const p of paths.filter((p) => p !== "imsmanifest.xml")) expect(manifestXml).toContain(p);
  });

  it("rejects an unknown engineId before touching the filesystem", async () => {
    const config = emptySandboxConfig("Unknown Engine");
    await expect(
      assemblePackage({
        identifier: "ILB-unknown-engine",
        title: config.title,
        engineId: "nonexistent-engine",
        config,
        runtime: { toRuntimeConfig: (c) => c, collectAssetIds: () => [] },
        resolveAsset: async () => { throw new Error("should not be called"); },
      }),
    ).rejects.toThrow('engine "nonexistent-engine" not found in engines.manifest.json — run npm run build:engines');
  });
});

describe("engine #2 golden path: jury starter (branching-scenario) end-to-end", () => {
  it("assembles, scans clean, and zips deterministically — the fixture-free golden test for the second engine", async () => {
    const adapter = adapterFor("branching-scenario");
    expect(adapter.engineId).toBe("branching-scenario");
    const config = branchingStarterConfig("jury", "Jury Deliberation");

    const build = () =>
      assemblePackage({
        identifier: "ILB-jury",
        title: config.title,
        engineId: "branching-scenario",
        config,
        runtime: { toRuntimeConfig: adapter.toRuntimeConfig, collectAssetIds: adapter.collectAssetIds },
        resolveAsset: async () => { throw new Error("the jury starter has no assets"); },
      });

    const a = await build();

    // assemblePackage emits engine/engine.js + engine/scorm-adapter.js for
    // ANY engine (the loop over engine.files + manifest.scorm.files is not
    // param-sandbox-specific) -- the scanner's missing-engine-checksum rule
    // requires exactly these two keys, so this is what proves that holds for
    // engine #2 too, not just by inspection of package.ts.
    expect(Object.keys(a.engineChecksums)).toEqual(
      expect.arrayContaining(["engine/engine.js", "engine/scorm-adapter.js"]),
    );
    const paths = [...a.files.keys()].sort();
    expect(paths).toEqual([
      "content/config.json",
      "engine/engine.css",
      "engine/engine.js",
      "engine/scorm-adapter.js",
      "imsmanifest.xml",
      "index.html",
    ]);

    const report = scanPackage(a.files, {
      engineChecksums: a.engineChecksums,
      urlAllowlist: [],
      authoringConfig: config,
      validate: adapter.validate,
      richTextFields: adapter.richTextValues,
      expectedIndexHtml: a.indexHtml,
    });
    expect(report.violations).toEqual([]);
    expect(report.passed).toBe(true);

    const zip1 = await zipPackage(a.files);
    const zip2 = await zipPackage((await build()).files);
    expect(zip1.equals(zip2)).toBe(true); // byte-stable

    // Package budget (runtime visual pass, plan Task 2): every engine zip
    // must stay under 40KB even after the brand-header/decision-card/
    // result-timeline restyle.
    expect(zip1.length).toBeLessThan(40 * 1024);
  });

  it("blocks a scene body tampered AFTER validation via the sanitizer-stability rule (richTextValues walks every scene.body/ending.body/choice.feedback, not just intro)", async () => {
    const adapter = adapterFor("branching-scenario");
    const config = branchingStarterConfig("jury", "Jury Deliberation");

    const a = await assemblePackage({
      identifier: "ILB-jury-tampered",
      title: config.title,
      engineId: "branching-scenario",
      config,
      runtime: { toRuntimeConfig: adapter.toRuntimeConfig, collectAssetIds: adapter.collectAssetIds },
      resolveAsset: async () => { throw new Error("the jury starter has no assets"); },
    });

    // Mutate a non-intro rich-text field (a scene body deep in the graph,
    // not the top-level intro) to something sanitizeRichText would strip --
    // simulating a config that was tampered with after schema validation
    // already ran (so the schema's own sanitizing transform never touches
    // it). Only a richTextFields walk that covers scene bodies (not just
    // `intro`, which this starter doesn't even set) can catch this.
    const tampered = {
      ...config,
      scenes: config.scenes.map((s, i) =>
        i === 0 ? { ...s, body: `${s.body}<script>alert(1)</script>` } : s,
      ),
    };
    // Construct the files map with the mutated config too (not just
    // ctx.authoringConfig) so this matches what a real tampered export
    // would look like: content/config.json's own bytes carry the tampered
    // value as well.
    const tamperedFiles = new Map(a.files);
    tamperedFiles.set("content/config.json", Buffer.from(JSON.stringify(tampered, null, 2)));

    const report = scanPackage(tamperedFiles, {
      engineChecksums: a.engineChecksums,
      urlAllowlist: [],
      authoringConfig: tampered,
      validate: adapter.validate,
      richTextFields: adapter.richTextValues,
      expectedIndexHtml: a.indexHtml,
    });
    expect(report.passed).toBe(false);
    expect(report.violations.some((v) => v.rule === "sanitizer")).toBe(true);
  });
});

describe("engine #3 golden path: blank starter (case-workspace) end-to-end", () => {
  it("assembles, scans clean, and zips deterministically — the fixture-free golden test for the third engine", async () => {
    const adapter = adapterFor("case-workspace");
    expect(adapter.engineId).toBe("case-workspace");
    const config = caseStarterConfig("blank", "Blank Case");

    const build = () =>
      assemblePackage({
        identifier: "ILB-case",
        title: config.title,
        engineId: "case-workspace",
        config,
        runtime: { toRuntimeConfig: adapter.toRuntimeConfig, collectAssetIds: adapter.collectAssetIds },
        resolveAsset: async () => { throw new Error("the blank case starter has no assets"); },
      });

    const a = await build();

    // Same invariant as engine #2's golden test: assemblePackage emits
    // engine/engine.js + engine/scorm-adapter.js for ANY engine, so this
    // proves that holds for engine #3 too, not just by inspection of
    // package.ts.
    expect(Object.keys(a.engineChecksums)).toEqual(
      expect.arrayContaining(["engine/engine.js", "engine/scorm-adapter.js"]),
    );
    const paths = [...a.files.keys()].sort();
    expect(paths).toEqual([
      "content/config.json",
      "engine/engine.css",
      "engine/engine.js",
      "engine/scorm-adapter.js",
      "imsmanifest.xml",
      "index.html",
    ]);

    const report = scanPackage(a.files, {
      engineChecksums: a.engineChecksums,
      urlAllowlist: [],
      authoringConfig: config,
      validate: adapter.validate,
      richTextFields: adapter.richTextValues,
      expectedIndexHtml: a.indexHtml,
    });
    expect(report.violations).toEqual([]);
    expect(report.passed).toBe(true);

    const zip1 = await zipPackage(a.files);
    const zip2 = await zipPackage((await build()).files);
    expect(zip1.equals(zip2)).toBe(true); // byte-stable

    // Package budget (spec/plan): every engine zip must stay under 40KB.
    expect(zip1.length).toBeLessThan(40 * 1024);
  });
});

describe("engine #4 golden path: blank starter (process-simulator) end-to-end", () => {
  it("assembles, scans clean, and zips deterministically — the fixture-free golden test for the fourth engine", async () => {
    const adapter = adapterFor("process-simulator");
    expect(adapter.engineId).toBe("process-simulator");
    const config = processStarterConfig("blank", "Blank Procedure");

    const build = () =>
      assemblePackage({
        identifier: "ILB-process",
        title: config.title,
        engineId: "process-simulator",
        config,
        runtime: { toRuntimeConfig: adapter.toRuntimeConfig, collectAssetIds: adapter.collectAssetIds },
        resolveAsset: async () => { throw new Error("the blank process starter has no assets"); },
      });

    const a = await build();

    // Same invariant as engines #2/#3's golden tests: assemblePackage emits
    // engine/engine.js + engine/scorm-adapter.js for ANY engine, so this
    // proves that holds for engine #4 too, not just by inspection of
    // package.ts.
    expect(Object.keys(a.engineChecksums)).toEqual(
      expect.arrayContaining(["engine/engine.js", "engine/scorm-adapter.js"]),
    );
    const paths = [...a.files.keys()].sort();
    expect(paths).toEqual([
      "content/config.json",
      "engine/engine.css",
      "engine/engine.js",
      "engine/scorm-adapter.js",
      "imsmanifest.xml",
      "index.html",
    ]);

    const report = scanPackage(a.files, {
      engineChecksums: a.engineChecksums,
      urlAllowlist: [],
      authoringConfig: config,
      validate: adapter.validate,
      richTextFields: adapter.richTextValues,
      expectedIndexHtml: a.indexHtml,
    });
    expect(report.violations).toEqual([]);
    expect(report.passed).toBe(true);

    const zip1 = await zipPackage(a.files);
    const zip2 = await zipPackage((await build()).files);
    expect(zip1.equals(zip2)).toBe(true); // byte-stable

    // Package budget (spec/plan): every engine zip must stay under 40KB.
    expect(zip1.length).toBeLessThan(40 * 1024);
  });
});
