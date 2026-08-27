import { validateSandboxConfig } from "@/lib/engines/param-sandbox/schema";
import * as psRuntime from "@/lib/engines/param-sandbox/runtime-config";

export interface EngineAdapter {
  engineId: string;
  version: string;
  label: string;
  validate(raw: unknown): { ok: true; config: unknown } | { ok: false; errors: string[] };
  toRuntimeConfig(config: unknown, urlForAsset: (id: string) => string): unknown;
  collectAssetIds(config: unknown): string[];
}

export const ENGINE_ADAPTERS: Record<string, EngineAdapter> = {
  "param-sandbox": {
    engineId: "param-sandbox",
    version: "1.0.0",
    label: "Parameter Sandbox",
    validate: (raw) => validateSandboxConfig(raw),
    toRuntimeConfig: (c, u) => psRuntime.toRuntimeConfig(c as never, u),
    collectAssetIds: (c) => psRuntime.collectAssetIds(c as never),
  },
};

export function adapterFor(engineId: string): EngineAdapter {
  const a = ENGINE_ADAPTERS[engineId];
  if (!a) throw new Error(`unknown engine "${engineId}"`);
  return a;
}
