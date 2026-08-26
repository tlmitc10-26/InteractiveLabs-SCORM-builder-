import { describe, it, expect } from "vitest";
import { assemblePackage } from "@/lib/export/package";
import { emptySandboxConfig } from "@/lib/engines/param-sandbox/schema";

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
