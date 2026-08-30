import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdirSync, copyFileSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE_VERSION = "1.0.0";
const SCORM_VERSION = "1.0.0";
const DEFAULT_OUT = path.join(ROOT, "public", "engines");

// Every engine bundle this build produces. Each gets its own
// src/engine-runtime/<id>/{main.ts,engine.css,preview.html}, built into
// public/engines/<id>/<version>/ with the same file shape, and one entry in
// engines.manifest.json's `engines` array (in this order — order matters
// only for readability/diffing, not behavior; engineEntry() looks entries up
// by id). Adding a third engine is: add its src/engine-runtime/<id> files,
// add one entry here.
const ENGINES = [
  { id: "param-sandbox", title: "Parameter Sandbox" },
  { id: "branching-scenario", title: "Branching Scenario" },
  { id: "case-workspace", title: "Case / Evidence Workspace" },
];

// Mirrors src/lib/design/tokens.ts's GENERATED marker + emitters exactly.
// Duplicated here (rather than imported) because this is a plain .mjs build
// script with no TS toolchain — tests/engine-build-drift.test.ts cross-checks
// this copy against the TS emitters so the two cannot silently diverge.
const GENERATED = "/* GENERATED FILE - edit src/lib/design/tokens.json and run npm run build:engines */";

function emitRootVariables(tokens) {
  const lines = Object.keys(tokens.colors).map((n) => `  --rds-${n}: ${tokens.colors[n]};`);
  return `:root {\n${lines.join("\n")}\n}`;
}

function emitSpacingMotionVars(tokens) {
  const spaceLines = Object.keys(tokens.space).map((n) => `  --sp-${n}: ${tokens.space[n]};`);
  return `${spaceLines.join("\n")}\n  --radius-chip: ${tokens.radius.chip};\n  --elev-card: ${tokens.elevation.card};\n  --motion-fast: ${tokens.motion.fast};`;
}

function emitAppThemeCss(tokens) {
  const colorLines = Object.keys(tokens.colors).map((n) => `  --color-rds-${n}: ${tokens.colors[n]};`);
  return `${GENERATED}\n${emitRootVariables(tokens)}\n\n@theme {\n${colorLines.join("\n")}\n  --font-app: ${tokens.fonts.app};\n  --radius-pill: ${tokens.radius.pill};\n  --radius-card: ${tokens.radius.card};\n${emitSpacingMotionVars(tokens)}\n}\n`;
}

function emitEngineTokensCss(tokens) {
  return `${GENERATED}\n${emitRootVariables(tokens)}\n:root {\n  --ilb-font-heading: ${tokens.fonts.lessonHeading};\n  --ilb-font-body: ${tokens.fonts.lessonBody};\n  --radius-card: ${tokens.radius.card};\n${emitSpacingMotionVars(tokens)}\n}\n`;
}

/**
 * Build every engine bundle (+ the scorm adapter + manifest) into `outDir`
 * (defaults to public/engines). Pulled out of the CLI script's top-level
 * code so that tests/engine-build-drift.test.ts can call the EXACT SAME
 * build logic against a temp directory and diff the result against the
 * committed public/engines bytes — a dev editing src/engine-runtime/* and
 * forgetting to run `npm run build:engines` must not be able to ship a
 * stale bundle, for EITHER engine.
 *
 * Deterministic and cross-platform: no timestamps in the manifest, no
 * shell invocations, only path.join/path.resolve for paths.
 */
export async function buildEngines({ outDir } = {}) {
  const OUT = outDir ?? DEFAULT_OUT;

  const scormDir = path.join(OUT, "scorm", SCORM_VERSION);
  mkdirSync(scormDir, { recursive: true });

  const tokens = JSON.parse(readFileSync(path.join(ROOT, "src/lib/design/tokens.json"), "utf8"));
  const appTokensCss = emitAppThemeCss(tokens);
  const engineTokensCss = emitEngineTokensCss(tokens);

  // App chrome theme: committed at src/app/tokens.css when building to the
  // default public/engines out dir; written alongside a temp/other out dir
  // instead (as app-tokens.css) so the drift test can compare without
  // touching the tree.
  if (path.resolve(OUT) === path.resolve(DEFAULT_OUT)) {
    writeFileSync(path.join(ROOT, "src", "app", "tokens.css"), appTokensCss);
  } else {
    writeFileSync(path.join(OUT, "app-tokens.css"), appTokensCss);
  }

  const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

  /** @type {Record<string, string>} */
  const files = {};
  const engineManifests = [];

  for (const engine of ENGINES) {
    const engineDir = path.join(OUT, engine.id, ENGINE_VERSION);
    mkdirSync(engineDir, { recursive: true });
    const srcDir = path.join(ROOT, "src/engine-runtime", engine.id);

    await build({
      entryPoints: [path.join(srcDir, "main.ts")],
      bundle: true,
      minify: false, // auditable output
      format: "iife",
      target: "es2019",
      outfile: path.join(engineDir, "engine.js"),
      alias: { "@": path.join(ROOT, "src") },
    });

    // engine.css ships the generated tokens layer prepended to the hand-
    // written source rules (source may reference var(--rds-*) freely).
    const engineCssSource = readFileSync(path.join(srcDir, "engine.css"), "utf8");
    writeFileSync(path.join(engineDir, "engine.css"), `${engineTokensCss}\n${engineCssSource}`);
    copyFileSync(path.join(srcDir, "preview.html"), path.join(engineDir, "preview.html"));

    files[`${engine.id}/${ENGINE_VERSION}/engine.js`] = path.join(engineDir, "engine.js");
    files[`${engine.id}/${ENGINE_VERSION}/engine.css`] = path.join(engineDir, "engine.css");

    engineManifests.push({
      id: engine.id,
      version: ENGINE_VERSION,
      title: engine.title,
      files: {
        "engine.js": sha256(path.join(engineDir, "engine.js")),
        "engine.css": sha256(path.join(engineDir, "engine.css")),
      },
    });
  }

  await build({
    entryPoints: [path.join(ROOT, "src/engine-runtime/scorm-adapter.ts")],
    bundle: true,
    minify: false,
    format: "iife",
    target: "es2019",
    outfile: path.join(scormDir, "scorm-adapter.js"),
    alias: { "@": path.join(ROOT, "src") },
  });
  files[`scorm/${SCORM_VERSION}/scorm-adapter.js`] = path.join(scormDir, "scorm-adapter.js");

  // No timestamp field: rebuilds must be byte-identical given identical
  // source, since a later export-pipeline task gates on `git status` being
  // clean after `npm run build:engines`.
  //
  // preview.html is deliberately NOT hashed here (for either engine): it's
  // an editor-only preview harness and never ships inside an exported SCORM
  // package (an exported package gets a generated index.html instead).
  const manifest = {
    engines: engineManifests,
    scorm: {
      version: SCORM_VERSION,
      files: { "scorm-adapter.js": sha256(path.join(scormDir, "scorm-adapter.js")) },
    },
  };
  writeFileSync(path.join(OUT, "engines.manifest.json"), JSON.stringify(manifest, null, 2));

  return {
    outDir: OUT,
    scormDir,
    manifest,
    appTokensCss,
    files,
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
