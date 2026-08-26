import { describe, it, expect, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildEngines } from "../scripts/build-engines.mjs";
import { emitAppThemeCss, emitEngineTokensCss } from "@/lib/design/tokens";

/**
 * Guards against the class of bug where a dev edits src/engine-runtime/*
 * and forgets to run `npm run build:engines` before committing: the
 * committed public/engines bundles (which engines.manifest.json's hashes
 * are checked against, and which the export scanner treats as "audited
 * code") silently go stale relative to source.
 *
 * Rebuilds the engines into a fresh OS-temp directory using the exact same
 * build logic the CLI (`npm run build:engines`) uses — buildEngines() from
 * scripts/build-engines.mjs, refactored out of the script's top-level code
 * for this purpose — then diffs the freshly-built bytes against the
 * committed public/engines files AND against the committed manifest
 * hashes. No shell involved, no timestamps in play (the manifest has none
 * by design), so a clean rebuild must be byte-identical.
 */

const ROOT = path.resolve(__dirname, "..");
const COMMITTED_OUT = path.join(ROOT, "public", "engines");

const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

let tmpDir: string | undefined;

afterEach(() => {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

describe("engine build drift", () => {
  it("rebuilding from src/engine-runtime produces bytes identical to the committed public/engines bundles", async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "ilb-engine-drift-"));

    const built = await buildEngines({ outDir: tmpDir });

    const committedManifest = JSON.parse(readFileSync(path.join(COMMITTED_OUT, "engines.manifest.json"), "utf8"));

    // Committed manifest hashes must match the freshly-built manifest's
    // own hashes (sanity: the manifest itself isn't stale relative to the
    // files it describes).
    expect(built.manifest).toEqual(committedManifest);

    const relFiles: Array<[string, string]> = [
      ["param-sandbox/1.0.0/engine.js", "engine.js"],
      ["param-sandbox/1.0.0/engine.css", "engine.css"],
      ["scorm/1.0.0/scorm-adapter.js", "scorm-adapter.js"],
    ];

    const filesByRelPath: Record<string, string> = built.files;
    for (const [relPath, manifestKey] of relFiles) {
      const freshBuf = readFileSync(filesByRelPath[relPath]);
      const committedBuf = readFileSync(path.join(COMMITTED_OUT, relPath));

      // Byte-for-byte identical to what's committed in public/engines.
      expect(freshBuf.equals(committedBuf)).toBe(true);

      // And the fresh build's own hash matches the committed manifest hash
      // for that file (catches the case where public/engines was hand-
      // edited without regenerating the manifest, or vice versa).
      const expectedHash =
        manifestKey === "scorm-adapter.js"
          ? committedManifest.scorm.files["scorm-adapter.js"]
          : committedManifest.engines[0].files[manifestKey];
      expect(sha256(freshBuf)).toBe(expectedHash);
    }

    // (a) the .mjs build script's inline CSS templates and the TS emitters
    // used by app/schema/tests code must agree — they cannot silently drift
    // apart since one is a plain-JS duplicate of the other.
    expect(built.appTokensCss).toBe(emitAppThemeCss());

    // (b) the committed src/app/tokens.css is exactly what a fresh emit
    // produces (catches "edited tokens.json but forgot to rebuild").
    expect(readFileSync(path.join(ROOT, "src", "app", "tokens.css"), "utf8")).toBe(emitAppThemeCss());

    // (c) the committed engine.css begins with the current generated tokens
    // layer (catches a stale prepend as well as a hand-edited engine.css).
    const engineCss = readFileSync(path.join(COMMITTED_OUT, "param-sandbox", "1.0.0", "engine.css"), "utf8");
    expect(engineCss.startsWith(emitEngineTokensCss())).toBe(true);
  });
});
