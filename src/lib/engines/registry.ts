import { readFileSync } from "node:fs";
import path from "node:path";

export interface EngineManifest {
  engines: Array<{ id: string; version: string; title: string; files: Record<string, string> }>;
  scorm: { version: string; files: Record<string, string> };
}

export function loadEngineManifest(): EngineManifest {
  const p = path.join(process.cwd(), "public", "engines", "engines.manifest.json");
  return JSON.parse(readFileSync(p, "utf8")) as EngineManifest;
}

/** Looks up a single engine entry by id within an already-loaded manifest.
 *  Centralizes the "which engine" lookup so callers (package.ts, dispatch.ts)
 *  don't each hardcode a `.find()` + not-found message. */
export function engineEntry(manifest: EngineManifest, engineId: string): EngineManifest["engines"][number] {
  const e = manifest.engines.find((x) => x.id === engineId);
  if (!e) throw new Error(`engine "${engineId}" not found in engines.manifest.json — run npm run build:engines`);
  return e;
}

export function engineDir(id: string, version: string): string {
  return path.join(process.cwd(), "public", "engines", id, version);
}

export function scormDir(version: string): string {
  return path.join(process.cwd(), "public", "engines", "scorm", version);
}
