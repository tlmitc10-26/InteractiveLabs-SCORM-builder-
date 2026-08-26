import { colorHex, type TokenName } from "@/lib/design/tokens";

/**
 * LIGHT module: imports ONLY @/lib/design/tokens. No zod, no sanitize, no
 * formula parser. This is deliberate — schema.ts (validation, sanitization,
 * formula parsing) is a heavy authoring-time dependency; the pieces here
 * (ColorRef resolution, runtime-shape mapping, legacy-color migration) are
 * needed by client bundles (the editor's live preview) that must NOT pull
 * zod/sanitize-html/the formula parser into their chunk just to resolve a
 * color or reshape a config for the runtime.
 *
 * schema.ts re-exports everything below so no other module's imports break;
 * colorRefSchema (which needs zod) stays in schema.ts.
 */

/** Hybrid verifiable color model: a designer picks a named RDS token
 *  (contrast-safe by construction against the default stage background) or
 *  a verified custom hex. Legacy authoring drafts stored a bare hex string
 *  directly on the field — see `migrateLegacyColors`. */
export type ColorRef = { token: TokenName } | { hex: string };

export function resolveColorHex(c: ColorRef): string {
  return "token" in c ? colorHex(c.token) : c.hex;
}

export function colorRefToCss(c: ColorRef): string {
  return "token" in c ? `var(--rds-${c.token})` : c.hex;
}

/** UI-only tolerance for the editor's crude color-field bridge: wraps a
 *  bare string color value into `{hex}` (regardless of whether it happens
 *  to be a syntactically valid #rrggbb — validity is enforced by
 *  colorRefSchema at save time, not here) so a display helper can safely do
 *  `"token" in colorRefOf(x)` without ever risking `in` on a raw string. */
export function toDisplayColorRef(color: ColorRef | string): ColorRef {
  return typeof color === "string" ? { hex: color } : color;
}

const legacyHexPattern = /^#[0-9a-fA-F]{6}$/;

/**
 * Pure, structural (untyped-input) migration: rewrites any fill overlay
 * whose `color` is a bare hex string into `{ hex }`, matching the shape
 * `colorRefSchema`'s legacy-migration branch produces at validation time.
 * Defensive by design — only touches a `color` that is a string AND matches
 * `^#[0-9a-fA-F]{6}$`; anything else (already-migrated `{token}`/`{hex}`,
 * malformed data, garbage) is left completely untouched for
 * `validateSandboxConfig` to accept or reject on its own terms. Never
 * mutates the input; returns the original reference untouched when nothing
 * needed migrating.
 */
export function migrateLegacyColors(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const obj = raw as Record<string, unknown>;
  const visual = obj.visual;
  if (!visual || typeof visual !== "object") return raw;
  const visualObj = visual as Record<string, unknown>;
  const overlays = visualObj.overlays;
  if (!Array.isArray(overlays)) return raw;

  let changed = false;
  const migratedOverlays = overlays.map((ov) => {
    if (!ov || typeof ov !== "object") return ov;
    const ovObj = ov as Record<string, unknown>;
    if (ovObj.type === "fill" && typeof ovObj.color === "string" && legacyHexPattern.test(ovObj.color)) {
      changed = true;
      return { ...ovObj, color: { hex: ovObj.color } };
    }
    return ov;
  });

  if (!changed) return raw;
  return { ...obj, visual: { ...visualObj, overlays: migratedOverlays } };
}

/* ---------- structural (zod-free) shapes mirroring schema.ts's Zod types ---------- */
/* schema.ts's `SandboxConfig` (a z.infer) structurally satisfies these —
 * kept as plain interfaces here so this module never imports zod. */

type Box = { x: number; y: number; w: number; h: number };

type FillOverlay = { id: string; type: "fill"; outputId: string; inMin: number; inMax: number; color: ColorRef; box: Box };
type SwapOverlay = { id: string; type: "swap"; outputId: string; box: Box; bands: Array<{ upTo: number; assetId: string }> };
type TransformOverlay = {
  id: string; type: "transform"; outputId: string; box: Box; assetId: string;
  property: "translateY" | "translateX" | "rotate" | "scale" | "opacity";
  inMin: number; inMax: number; outMin: number; outMax: number;
};
type Overlay = FillOverlay | SwapOverlay | TransformOverlay;

type Input = {
  id: string; label: string; type: "slider" | "number" | "toggle" | "select";
  min?: number; max?: number; step?: number; defaultValue: number; units?: string;
  options?: Array<{ label: string; value: number }>;
};
type Output = { id: string; label: string; formula: string; units?: string; decimals?: number };
type Chart = { id: string; title: string; xInputId: string; yOutputId: string; samples: number };
type Challenge = { id: string; prompt: string; outputId: string; comparator: "gte" | "lte" | "between"; value?: number; min?: number; max?: number };
type Visual = { backgroundAssetId?: string; overlays: Overlay[] };

/** Structural authoring-config shape: schema.ts's `SandboxConfig` (a Zod
 *  inference) is assignable to this without either module importing the
 *  other's types. */
export type SandboxConfigLike = {
  title: string; intro?: string;
  inputs: Input[]; outputs: Output[]; charts: Chart[];
  visual?: Visual; challenges: Challenge[];
};

/** Runtime config: assetIds resolved to URLs, colors resolved to CSS values.
 *  Shape consumed by the engine runtime. */
export type RuntimeSandboxConfig = Omit<SandboxConfigLike, "visual"> & {
  visual?: {
    backgroundUrl?: string;
    overlays: Array<
      | { id: string; type: "fill"; outputId: string; inMin: number; inMax: number; color: string; box: Box }
      | { id: string; type: "swap"; outputId: string; box: Box; bands: Array<{ upTo: number; url: string }> }
      | { id: string; type: "transform"; outputId: string; box: Box; url: string; property: "translateY" | "translateX" | "rotate" | "scale" | "opacity"; inMin: number; inMax: number; outMin: number; outMax: number }
    >;
  };
};

export function toRuntimeConfig(config: SandboxConfigLike, urlForAsset: (assetId: string) => string): RuntimeSandboxConfig {
  const { visual, ...rest } = config;
  if (!visual) return rest;
  return {
    ...rest,
    visual: {
      backgroundUrl: visual.backgroundAssetId ? urlForAsset(visual.backgroundAssetId) : undefined,
      overlays: visual.overlays.map((ov) => {
        if (ov.type === "fill") return { ...ov, color: colorRefToCss(ov.color) };
        if (ov.type === "swap") {
          const { bands, ...o } = ov;
          return { ...o, bands: bands.map((b) => ({ upTo: b.upTo, url: urlForAsset(b.assetId) })) };
        }
        const { assetId, ...o } = ov;
        return { ...o, url: urlForAsset(assetId) };
      }),
    },
  };
}

/** All assetIds referenced by a config (for export bundling). */
export function collectAssetIds(config: SandboxConfigLike): string[] {
  const ids = new Set<string>();
  if (config.visual?.backgroundAssetId) ids.add(config.visual.backgroundAssetId);
  for (const ov of config.visual?.overlays ?? []) {
    if (ov.type === "swap") ov.bands.forEach((b) => ids.add(b.assetId));
    if (ov.type === "transform") ids.add(ov.assetId);
  }
  return [...ids];
}
