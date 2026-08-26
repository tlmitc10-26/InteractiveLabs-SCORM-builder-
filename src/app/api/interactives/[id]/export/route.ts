import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateSandboxConfig } from "@/lib/engines/param-sandbox/schema";
import { assemblePackage, zipPackage } from "@/lib/export/package";
import { scanPackage } from "@/lib/export/scanner";
import { assetStore, assetKey } from "@/lib/assets/store";
import { EXT_BY_MIME, ImageMime } from "@/lib/assets/validate";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let interactive;
  try {
    interactive = await prisma.interactive.findUnique({ where: { id } });
  } catch (err) {
    console.error("export: failed to load interactive", err);
    return NextResponse.json({ error: "export failed" }, { status: 500 });
  }
  if (!interactive) return NextResponse.json({ error: "not found" }, { status: 404 });

  let rawConfig: unknown;
  try {
    rawConfig = JSON.parse(interactive.configJson);
  } catch (err) {
    // A corrupt configJson is a server-side data problem, not something the
    // caller can fix by resubmitting — 500, not 422.
    console.error("export: interactive.configJson is not valid JSON", err);
    return NextResponse.json({ error: "export failed" }, { status: 500 });
  }

  const validation = validateSandboxConfig(rawConfig);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "config invalid", violations: validation.errors.map((e) => ({ file: "config", rule: "schema", detail: e })) },
      { status: 422 },
    );
  }

  let policy;
  try {
    policy = await prisma.policy.findUniqueOrThrow({ where: { id: 1 } });
  } catch (err) {
    console.error("export: failed to load policy", err);
    return NextResponse.json({ error: "export failed" }, { status: 500 });
  }

  let urlAllowlist: string[];
  try {
    urlAllowlist = JSON.parse(policy.allowlistJson) as string[];
  } catch (err) {
    console.error("export: policy.allowlistJson is not valid JSON", err);
    return NextResponse.json({ error: "export failed" }, { status: 500 });
  }

  let assembled;
  try {
    assembled = await assemblePackage({
      identifier: `ILB-${interactive.id}`,
      title: validation.config.title,
      config: validation.config,
      resolveAsset: async (assetId) => {
        let asset;
        try {
          asset = await prisma.asset.findUnique({ where: { id: assetId } });
        } catch (err) {
          console.error("export: failed to load asset record", err);
          throw new Error(`asset "${assetId}" could not be loaded`);
        }
        // Never bundle an asset that belongs to a different project — even
        // if the id happens to be a valid asset somewhere else in the DB.
        if (!asset || asset.projectId !== interactive.projectId) {
          throw new Error(`unknown asset "${assetId}"`);
        }
        const ext = EXT_BY_MIME[asset.mimeType as ImageMime];
        try {
          // FOLLOW-UP (not done here, already tracked in src/lib/assets/store.ts):
          // LocalDiskAssetStore reads from local disk, which isn't durable
          // storage on Vercel/serverless. Out of scope for this route.
          const data = await assetStore.get(assetKey(asset.contentHash, ext));
          return { data, ext };
        } catch (err) {
          // Never let fs error messages (which embed absolute local paths)
          // reach the response body.
          console.error("export: failed to read asset from store", err);
          throw new Error(`asset "${assetId}" could not be read from storage`);
        }
      },
    });
  } catch (err) {
    // Log the real error server-side (parity with the other catches in this
    // route); the client only gets the clear, path-free message assembled
    // by assemblePackage / the resolveAsset wrappers above.
    console.error("export: package assembly failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "package assembly failed" },
      { status: 422 },
    );
  }
  // FOLLOW-UP (not done here): an assembly failure caught above never
  // creates an ExportRecord — only a completed scan (pass or fail) does,
  // below. The audit trail is missing a row for "export attempted but
  // couldn't even be assembled" (e.g. too-many-assets, unknown asset,
  // missing engine build). Adding that would need a schema change
  // (ExportRecord.reportJson/passed assume a real ScanReport exists;
  // an assembly failure has no report to store).

  const report = scanPackage(assembled.files, {
    engineChecksums: assembled.engineChecksums,
    urlAllowlist,
    authoringConfig: validation.config,
    // Byte-exact match against what was actually packaged — this is what
    // makes the scanner's index.html check airtight rather than falling
    // back to the weaker inline-script heuristic.
    expectedIndexHtml: assembled.indexHtml,
  });

  try {
    await prisma.exportRecord.create({
      data: { interactiveId: interactive.id, passed: report.passed, reportJson: JSON.stringify(report) },
    });
  } catch (err) {
    console.error("export: failed to write export record", err);
    return NextResponse.json({ error: "export failed" }, { status: 500 });
  }

  if (!report.passed) {
    return NextResponse.json({ error: "compliance scan failed", violations: report.violations }, { status: 422 });
  }

  let zip: Buffer;
  try {
    zip = await zipPackage(assembled.files);
  } catch (err) {
    console.error("export: failed to zip package", err);
    return NextResponse.json({ error: "export failed" }, { status: 500 });
  }

  const filename = `${validation.config.title.replace(/[^a-zA-Z0-9 _-]/g, "").trim().replace(/\s+/g, "-") || "interactive"}-scorm12.zip`;
  return new NextResponse(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Filename": filename,
    },
  });
}
