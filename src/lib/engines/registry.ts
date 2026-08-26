import { readFileSync } from "node:fs";
import path from "node:path";

export interface EngineManifest {
  generatedAt: string;
  engines: Array<{ id: string; version: string; title: string; files: Record<string, string> }>;
  scorm: { version: string; files: Record<string, string> };
}

export function loadEngineManifest(): EngineManifest {
  const p = path.join(process.cwd(), "public", "engines", "engines.manifest.json");
  return JSON.parse(readFileSync(p, "utf8")) as EngineManifest;
}

export function engineDir(id: string, version: string): string {
  return path.join(process.cwd(), "public", "engines", id, version);
}

export function scormDir(version: string): string {
  return path.join(process.cwd(), "public", "engines", "scorm", version);
}
