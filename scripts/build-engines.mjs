import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdirSync, copyFileSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public", "engines");
const ENGINE_VERSION = "1.0.0";
const SCORM_VERSION = "1.0.0";

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
console.log("Engines built and manifest written.");
