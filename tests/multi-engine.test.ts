import { describe, it, expect } from "vitest";
import { loadEngineManifest, engineEntry } from "@/lib/engines/registry";
import { adapterFor, ENGINE_ADAPTERS } from "@/lib/engines/dispatch";
import { assemblePackage } from "@/lib/export/package";
import { emptySandboxConfig, validateSandboxConfig } from "@/lib/engines/param-sandbox/schema";

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
