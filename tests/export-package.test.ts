import { describe, it, expect } from "vitest";
import { assemblePackage, zipPackage, MAX_PACKAGE_ASSETS, MAX_PACKAGE_ASSET_BYTES } from "@/lib/export/package";
import { scanPackage } from "@/lib/export/scanner";
import { emptySandboxConfig, SandboxConfig } from "@/lib/engines/param-sandbox/schema";

/** Builds a config referencing exactly `n` distinct assetIds, spread across
 *  "swap" overlays (max 12 bands each per schema) — the cheapest way to
 *  reference an arbitrary number of assets without touching real image
 *  bytes. Not run through validateSandboxConfig (assemblePackage doesn't
 *  re-validate — that's the route's job), so bands don't need to satisfy
 *  the ascending-upTo rule here. */
function configWithNAssets(n: number): SandboxConfig {
  const base = emptySandboxConfig("Many Assets");
  const outputId = base.outputs[0].id;
  const ids = Array.from({ length: n }, (_, i) => `asset${i}`);
  const overlays = [];
  for (let start = 0; start < ids.length; start += 12) {
    const chunk = ids.slice(start, start + 12);
    overlays.push({
      id: `ov${start}`,
      type: "swap" as const,
      outputId,
      box: { x: 0, y: 0, w: 10, h: 10 },
      bands: chunk.map((assetId, i) => ({ upTo: i, assetId })),
    });
  }
  return { ...base, visual: { overlays } };
}

describe("assemblePackage", () => {
  it("assembles a complete package for a minimal valid config", async () => {
    const { files } = await assemblePackage({
      identifier: "ILB-test1",
      title: "Test",
      config: emptySandboxConfig("Test"),
      resolveAsset: async () => { throw new Error("no assets in this config"); },
    });
    const paths = [...files.keys()].sort();
    expect(paths).toEqual([
      "content/config.json",
      "engine/engine.css",
      "engine/engine.js",
      "engine/scorm-adapter.js",
      "imsmanifest.xml",
      "index.html",
    ]);
    const manifest = files.get("imsmanifest.xml")!.toString();
    for (const p of paths.filter((p) => p !== "imsmanifest.xml")) expect(manifest).toContain(p);
    // index.html inlines the RUNTIME config; config.json carries the authoring config
    expect(files.get("index.html")!.toString()).toContain('"inputs"');
  });

  it("returns engineChecksums and indexHtml alongside files, for the route to pass into the scanner", async () => {
    const { engineChecksums, indexHtml, files } = await assemblePackage({
      identifier: "ILB-test2",
      title: "Test",
      config: emptySandboxConfig("Test"),
      resolveAsset: async () => { throw new Error("no assets in this config"); },
    });
    expect(engineChecksums["engine/engine.js"]).toBeTruthy();
    expect(engineChecksums["engine/scorm-adapter.js"]).toBeTruthy();
    expect(indexHtml).toBe(files.get("index.html")!.toString());
  });
});

describe("assemblePackage: asset caps + parallel resolution + determinism", () => {
  it("rejects a config referencing more than MAX_PACKAGE_ASSETS assets", async () => {
    const config = configWithNAssets(MAX_PACKAGE_ASSETS + 1);
    await expect(
      assemblePackage({
        identifier: "ILB-cap-test",
        title: config.title,
        config,
        resolveAsset: async () => ({ data: Buffer.from("x"), ext: "png" }),
      }),
    ).rejects.toThrow(`too many assets referenced (max ${MAX_PACKAGE_ASSETS})`);
  });

  it("assembles a config at exactly the asset-count cap, resolving concurrently, and self-scans clean", async () => {
    const config = configWithNAssets(MAX_PACKAGE_ASSETS);
    let inFlight = 0;
    let maxInFlight = 0;
    const assembled = await assemblePackage({
      identifier: "ILB-cap-ok",
      title: config.title,
      config,
      resolveAsset: async (assetId) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 0));
        inFlight--;
        return { data: Buffer.from(`data-for-${assetId}`), ext: "png" };
      },
    });

    // Proves resolution isn't a strictly sequential for-await loop.
    expect(maxInFlight).toBeGreaterThan(1);

    const assetPaths = [...assembled.files.keys()].filter((p) => p.startsWith("assets/"));
    expect(assetPaths).toHaveLength(MAX_PACKAGE_ASSETS);

    // Empty allowlist -- the scanner's manifest-namespace-URI exemption
    // (src/lib/export/scanner.ts, scanUrlTokensForAllowlist) means a clean
    // self-generated package scans clean even under the strictest default
    // policy; no need to allowlist the SCORM/IMS/W3C spec URIs by hand.
    const report = scanPackage(assembled.files, {
      engineChecksums: assembled.engineChecksums,
      urlAllowlist: [],
      authoringConfig: config,
      expectedIndexHtml: assembled.indexHtml,
    });
    expect(report.violations).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it("rejects when cumulative resolved asset bytes exceed MAX_PACKAGE_ASSET_BYTES", async () => {
    const assetCount = 5;
    const config = configWithNAssets(assetCount);
    // 5 assets just over (MAX_PACKAGE_ASSET_BYTES / 5) each -> total just over the cap.
    const oversizedChunk = Buffer.alloc(Math.ceil(MAX_PACKAGE_ASSET_BYTES / assetCount) + 1024);
    await expect(
      assemblePackage({
        identifier: "ILB-bytes-cap",
        title: config.title,
        config,
        resolveAsset: async () => ({ data: oversizedChunk, ext: "png" }),
      }),
    ).rejects.toThrow(`package assets exceed ${MAX_PACKAGE_ASSET_BYTES / (1024 * 1024)} MB total`);
  });

  it("produces byte-identical zips across repeated assembly of the same multi-asset config", async () => {
    const config = configWithNAssets(10);
    const assembleOnce = () =>
      assemblePackage({
        identifier: "ILB-determinism",
        title: config.title,
        config,
        resolveAsset: async (assetId) => ({ data: Buffer.from(`data-for-${assetId}`), ext: "png" }),
      });
    const a = await assembleOnce();
    const b = await assembleOnce();
    const [zipA, zipB] = await Promise.all([zipPackage(a.files), zipPackage(b.files)]);
    expect(zipA.equals(zipB)).toBe(true);
  });
});
