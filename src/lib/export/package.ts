import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { buildManifestXml } from "@/lib/scorm/manifest";
import { buildIndexHtml } from "@/lib/scorm/index-html";
import { loadEngineManifest, engineDir, scormDir } from "@/lib/engines/registry";
import { SandboxConfig, toRuntimeConfig, collectAssetIds } from "@/lib/engines/param-sandbox/schema";

export interface ResolvedAsset { data: Buffer; ext: string }

// Memory guards. The sandbox schema permits up to ~144 distinct asset
// references in a single config (12 overlays x 12 swap bands each), and
// each resolved asset can be as large as the admin's policy.maxAssetBytes
// (default 5MB) -- unbounded, that's ~700MB buffered in one export request,
// an OOM risk on a serverless instance. Two independent caps: a count cap
// (cheap, checked before any bytes are read) and a cumulative-bytes cap
// (checked after resolution, since actual size isn't known until then).
// Both throw a plain Error with a client-safe message; the route's
// assembly try/catch turns that into a 422.
export const MAX_PACKAGE_ASSETS = 40;
export const MAX_PACKAGE_ASSET_BYTES = 50 * 1024 * 1024; // 50 MB

export interface AssembleOptions {
  identifier: string;
  title: string;
  config: SandboxConfig;
  /** returns binary + extension for an assetId; throws if unknown */
  resolveAsset: (assetId: string) => Promise<ResolvedAsset>;
}

export interface AssembledPackage {
  files: Map<string, Buffer>;
  engineChecksums: Record<string, string>;
  /** the exact index.html string that was written into `files` — callers
   *  (the export route) MUST pass this as ctx.expectedIndexHtml to
   *  scanPackage, since a reference-only check can't see executable inline
   *  JS. Returning it here (rather than re-deriving it) guarantees the
   *  scanner is checking against literally the same bytes being packaged. */
  indexHtml: string;
}

/** Reads a single runtime file for the package, wrapping fs errors so a
 *  missing/misconfigured build never leaks an absolute local path into an
 *  error message that could reach an HTTP response. */
async function readRuntimeFile(dir: string, name: string): Promise<Buffer> {
  try {
    return await readFile(path.join(dir, name));
  } catch {
    throw new Error(`engine runtime file "${name}" could not be read — run npm run build:engines`);
  }
}

export async function assemblePackage(opts: AssembleOptions): Promise<AssembledPackage> {
  const manifest = loadEngineManifest();
  const engine = manifest.engines.find((e) => e.id === "param-sandbox");
  if (!engine) throw new Error("param-sandbox engine not found in engines.manifest.json — run npm run build:engines");

  const files = new Map<string, Buffer>();
  const engineChecksums: Record<string, string> = {};

  // Engine runtime files
  const eDir = engineDir(engine.id, engine.version);
  for (const [name, hash] of Object.entries(engine.files)) {
    files.set(`engine/${name}`, await readRuntimeFile(eDir, name));
    engineChecksums[`engine/${name}`] = hash;
  }
  const sDir = scormDir(manifest.scorm.version);
  for (const [name, hash] of Object.entries(manifest.scorm.files)) {
    files.set(`engine/${name}`, await readRuntimeFile(sDir, name));
    engineChecksums[`engine/${name}`] = hash;
  }

  // Assets: bundled under assets/, referenced by hashed filename.
  const assetIds = collectAssetIds(opts.config);
  if (assetIds.length > MAX_PACKAGE_ASSETS) {
    throw new Error(`too many assets referenced (max ${MAX_PACKAGE_ASSETS})`);
  }
  // Sort ids before resolving (not just before zipping) so insertion order
  // into `files` — and therefore anything downstream that iterates the map
  // before zipPackage's own final sort — is deterministic regardless of
  // resolution order/timing under Promise.all.
  const sortedAssetIds = [...assetIds].sort();
  // Bounded concurrency: capped at MAX_PACKAGE_ASSETS (40) above, so a
  // flat Promise.all is fine — no need for a semaphore/queue at this size.
  // Per-asset ownership (asset.projectId === interactive.projectId) is
  // enforced by the caller's resolveAsset (see the export route), not here.
  const resolved = await Promise.all(
    sortedAssetIds.map(async (id) => ({ id, ...(await opts.resolveAsset(id)) })),
  );
  let totalAssetBytes = 0;
  for (const { data } of resolved) totalAssetBytes += data.length;
  if (totalAssetBytes > MAX_PACKAGE_ASSET_BYTES) {
    throw new Error(`package assets exceed ${MAX_PACKAGE_ASSET_BYTES / (1024 * 1024)} MB total`);
  }
  const assetPathById = new Map<string, string>();
  for (const { id, data, ext } of resolved) {
    const p = `assets/${id}.${ext}`;
    files.set(p, data);
    assetPathById.set(id, p);
  }

  // Configs: runtime (inlined) + authoring (audit copy)
  const runtimeConfig = toRuntimeConfig(opts.config, (id) => {
    const p = assetPathById.get(id);
    if (!p) throw new Error(`config references unknown asset "${id}"`);
    return p;
  });
  const indexHtml = buildIndexHtml({ title: opts.config.title, configJson: JSON.stringify(runtimeConfig) });
  files.set("content/config.json", Buffer.from(JSON.stringify(opts.config, null, 2)));
  files.set("index.html", Buffer.from(indexHtml));
  files.set("imsmanifest.xml", Buffer.from(buildManifestXml({
    identifier: opts.identifier,
    title: opts.config.title,
    files: [...files.keys()].filter((f) => f !== "imsmanifest.xml").sort(),
  })));

  return { files, engineChecksums, indexHtml };
}

export async function zipPackage(files: Map<string, Buffer>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [p, data] of [...files.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    zip.file(p, data, { date: new Date(2000, 0, 1) }); // fixed date -> byte-stable zips
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
