import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdirSync, copyFileSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE_VERSION = "1.0.0";
const SCORM_VERSION = "1.0.0";

/**
 * Build both engine bundles (+ manifest) into `outDir` (defaults to
 * public/engines). Pulled out of the CLI script's top-level code so that
 * tests/engine-build-drift.test.ts can call the EXACT SAME build logic
 * against a temp directory and diff the result against the committed
 * public/engines bytes — a dev editing src/engine-runtime/* and forgetting
 * to run `npm run build:engines` must not be able to ship a stale bundle.
 *
 * Deterministic and cross-platform: no timestamps in the manifest, no
 * shell invocations, only path.join/path.resolve for paths.
 */
export async function buildEngines({ outDir } = {}) {
  const OUT = outDir ?? path.join(ROOT, "public", "engines");

  const sandboxDir = path.join(OUT, "param-sandbox", ENGINE_VERSION);
  const scormDir = path.join(OUT, "scorm", SCORM_VERSION);
  mkdirSync(sandboxDir, { recursive: true });
  mkdirSync(scormDir, { recursive: true });

  await build({
    entryPoints: [path.join(ROOT, "src/engine-runtime/param-sandbox/main.ts")],
    bundle: true,
    minify: false, // auditable output
    format: "iife",
    target: "es2019",
    outfile: path.join(sandboxDir, "engine.js"),
    alias: { "@": path.join(ROOT, "src") },
  });

  await build({
    entryPoints: [path.join(ROOT, "src/engine-runtime/scorm-adapter.ts")],
    bundle: true,
    minify: false,
    format: "iife",
    target: "es2019",
    outfile: path.join(scormDir, "scorm-adapter.js"),
    alias: { "@": path.join(ROOT, "src") },
  });

  copyFileSync(path.join(ROOT, "src/engine-runtime/param-sandbox/engine.css"), path.join(sandboxDir, "engine.css"));
  copyFileSync(path.join(ROOT, "src/engine-runtime/param-sandbox/preview.html"), path.join(sandboxDir, "preview.html"));

  const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

  // No timestamp field: rebuilds must be byte-identical given identical
  // source, since a later export-pipeline task gates on `git status` being
  // clean after `npm run build:engines`.
  //
  // preview.html is deliberately NOT hashed here: it's an editor-only preview
  // harness and never ships inside an exported SCORM package (an exported
  // package gets a generated index.html from Task 11 instead).
  const manifest = {
    engines: [
      {
        id: "param-sandbox",
        version: ENGINE_VERSION,
        title: "Parameter Sandbox",
        files: {
          "engine.js": sha256(path.join(sandboxDir, "engine.js")),
          "engine.css": sha256(path.join(sandboxDir, "engine.css")),
        },
      },
    ],
    scorm: {
      version: SCORM_VERSION,
      files: { "scorm-adapter.js": sha256(path.join(scormDir, "scorm-adapter.js")) },
    },
  };
  writeFileSync(path.join(OUT, "engines.manifest.json"), JSON.stringify(manifest, null, 2));

  return {
    outDir: OUT,
    sandboxDir,
    scormDir,
    manifest,
    files: {
      "param-sandbox/1.0.0/engine.js": path.join(sandboxDir, "engine.js"),
      "param-sandbox/1.0.0/engine.css": path.join(sandboxDir, "engine.css"),
      "scorm/1.0.0/scorm-adapter.js": path.join(scormDir, "scorm-adapter.js"),
    },
  };
}

// CLI entry point: only runs the build (and prints) when this file is
// executed directly (`node scripts/build-engines.mjs` / `npm run
// build:engines`), not when it's imported by the drift test.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await buildEngines();
  console.log("Engines built and manifest written.");
}
