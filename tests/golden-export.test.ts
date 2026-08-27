import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { validateSandboxConfig } from "@/lib/engines/param-sandbox/schema";
import { assemblePackage, zipPackage } from "@/lib/export/package";
import { scanPackage } from "@/lib/export/scanner";
import { adapterFor } from "@/lib/engines/dispatch";

const psAdapter = adapterFor("param-sandbox");
const psRuntime = { toRuntimeConfig: psAdapter.toRuntimeConfig, collectAssetIds: psAdapter.collectAssetIds };

describe("golden export", () => {
  it("golden config assembles, passes the scanner, and zips deterministically", async () => {
    const raw = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "golden-config.json"), "utf8"));
    const v = validateSandboxConfig(raw);
    expect(v.ok).toBe(true);
    if (!v.ok) return;

    const build = () => assemblePackage({
      identifier: "ILB-golden",
      title: v.config.title,
      engineId: "param-sandbox",
      config: v.config,
      runtime: psRuntime,
      resolveAsset: async () => { throw new Error("golden config has no assets"); },
    });

    const a = await build();
    // expectedIndexHtml wired (Task 13, N4): a reference-only scan can't see
    // executable inline JS, so the scanner needs the exact bytes assemblePackage
    // is about to write. Empty urlAllowlist still scans clean because the
    // scanner exempts the fixed SCORM/IMS/W3C namespace URIs in imsmanifest.xml.
    const report = scanPackage(a.files, {
      engineChecksums: a.engineChecksums,
      urlAllowlist: [],
      authoringConfig: v.config,
      validate: psAdapter.validate,
      richTextFields: psAdapter.richTextValues,
      expectedIndexHtml: a.indexHtml,
    });
    expect(report.violations).toEqual([]);

    const zip1 = await zipPackage(a.files);
    const zip2 = await zipPackage((await build()).files);
    expect(zip1.equals(zip2)).toBe(true); // byte-stable
    expect(zip1.length).toBeGreaterThan(1000);
  });
});
