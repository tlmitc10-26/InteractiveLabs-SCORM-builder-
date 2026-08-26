import { z } from "zod";
import { parseFormula } from "@/lib/formula/parser";
import { collectIdentifiers } from "@/lib/formula/evaluate";
import { sanitizeRichText, sanitizePlainText } from "@/lib/sanitize";
import { isTokenName, colorHex } from "@/lib/design/tokens";
import { contrastRatio, meetsNonText, ratioLabel } from "@/lib/design/contrast";
import {
  resolveColorHex, toRuntimeConfig as toRuntimeConfigImpl, collectAssetIds as collectAssetIdsImpl,
  type RuntimeSandboxConfig as RuntimeSandboxConfigImpl,
} from "@/lib/engines/param-sandbox/runtime-config";

// Re-exported so no existing import site (tests, engine-runtime, editor)
// breaks: the color-resolution/runtime-shape helpers now live in the light,
// zod-free runtime-config.ts module (see its file comment for why), but
// schema.ts remains the canonical place authoring code imports them from.
export { resolveColorHex, colorRefToCss, migrateLegacyColors } from "@/lib/engines/param-sandbox/runtime-config";
export type { ColorRef } from "@/lib/engines/param-sandbox/runtime-config";

const idPattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const safeId = z.string().min(1).max(40).regex(idPattern, "ids must be letters/digits/underscore");
// Pre-transform cap fails fast on giant inputs; the post-transform `.pipe()`
// cap enforces the declared max on the STORED value, since entity escaping
// (sanitizePlainText) can inflate length past the original input's cap
// (e.g. "&" x120 -> "&amp;" x120 = 600 chars).
const plain = (max: number) => z.string().max(max).transform(sanitizePlainText).pipe(z.string().max(max));
const rich = (max: number) => z.string().max(max).transform(sanitizeRichText).pipe(z.string().max(max));

/** Hybrid verifiable color model: a designer picks a named RDS token
 *  (contrast-safe by construction against the default stage background) or
 *  a verified custom hex (validated below). Legacy authoring drafts stored
 *  a bare hex string directly on the field — that shape is migrated to
 *  `{ hex }` at parse time so old drafts keep validating unchanged. This
 *  schema needs zod, so (unlike ColorRef/resolveColorHex/colorRefToCss) it
 *  stays in schema.ts rather than moving to the light runtime-config.ts. */
export const colorRefSchema = z.union([
  z.object({ token: z.string().refine(isTokenName, "unknown color token") }).strict(),
  z.object({ hex: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).strict(),
  z.string().regex(/^#[0-9a-fA-F]{6}$/).transform((hex) => ({ hex })),
]);

/** Stage background used for the fill-overlay contrast gate (light-1). */
const STAGE_BG_HEX = colorHex("light-1");

const boxSchema = z.object({
  x: z.number().min(0).max(100), y: z.number().min(0).max(100),
  w: z.number().min(0).max(100), h: z.number().min(0).max(100),
}).strict();

/** Stage placement reuses the same {x,y,w,h} percent box as overlays. */
const stageBoxSchema = boxSchema;

/** Placement model: where an input/output renders. `placement` is optional
 *  on both inputSchema and outputSchema — its absence means "panel" (the
 *  historical, only-ever behavior before this task), so every pre-existing
 *  config stays valid unchanged. A "stage" placement additionally requires
 *  a visual scene to exist (cross-checked in validateSandboxConfig, since
 *  that check needs the parsed config as a whole, not just this field). */
export const placementSchema = z.union([
  z.object({ zone: z.literal("panel") }).strict(),
  z.object({ zone: z.literal("below") }).strict(),
  z.object({ zone: z.literal("stage"), box: stageBoxSchema }).strict(),
]);
export type Placement = z.infer<typeof placementSchema>;

const inputSchema = z.object({
  id: safeId,
  label: plain(120),
  type: z.enum(["slider", "number", "toggle", "select"]),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().positive().optional(),
  defaultValue: z.number(),
  units: plain(20).optional(),
  options: z.array(z.object({ label: plain(80), value: z.number() }).strict()).max(20).optional(),
  placement: placementSchema.optional(),
}).strict();

const outputSchema = z.object({
  id: safeId,
  label: plain(120),
  formula: z.string().min(1).max(500),
  units: plain(20).optional(),
  decimals: z.number().int().min(0).max(8).optional(),
  placement: placementSchema.optional(),
}).strict();

const chartSchema = z.object({
  id: safeId,
  title: plain(120),
  xInputId: safeId,
  yOutputId: safeId,
  samples: z.number().int().min(2).max(200),
}).strict();

const overlaySchema = z.discriminatedUnion("type", [
  z.object({
    id: safeId, type: z.literal("fill"), outputId: safeId,
    inMin: z.number(), inMax: z.number(), color: colorRefSchema, box: boxSchema,
  }).strict(),
  z.object({
    id: safeId, type: z.literal("swap"), outputId: safeId, box: boxSchema,
    bands: z.array(z.object({ upTo: z.number(), assetId: z.string().min(1).max(64) }).strict()).min(1).max(12),
  }).strict(),
  z.object({
    id: safeId, type: z.literal("transform"), outputId: safeId, box: boxSchema,
    assetId: z.string().min(1).max(64),
    property: z.enum(["translateY", "translateX", "rotate", "scale", "opacity"]),
    inMin: z.number(), inMax: z.number(), outMin: z.number(), outMax: z.number(),
  }).strict(),
]);

const visualSchema = z.object({
  backgroundAssetId: z.string().min(1).max(64).optional(),
  overlays: z.array(overlaySchema).max(12).default([]),
}).strict();

const challengeSchema = z.object({
  id: safeId,
  prompt: plain(300),
  outputId: safeId,
  comparator: z.enum(["gte", "lte", "between"]),
  value: z.number().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
}).strict();

export const sandboxConfigSchema = z.object({
  title: plain(200),
  intro: rich(5000).optional(),
  inputs: z.array(inputSchema).min(1).max(20),
  outputs: z.array(outputSchema).min(1).max(20),
  charts: z.array(chartSchema).max(6).default([]),
  visual: visualSchema.optional(),
  challenges: z.array(challengeSchema).max(12).default([]),
  layout: z.enum(["side", "stacked", "stage-focus"]).default("side"),
}).strict();

export type SandboxConfig = z.infer<typeof sandboxConfigSchema>;

export type ValidationResult =
  | { ok: true; config: SandboxConfig }
  | { ok: false; errors: string[] };

export function validateSandboxConfig(raw: unknown): ValidationResult {
  const parsed = sandboxConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  const config = parsed.data;
  const errors: string[] = [];

  const inputIds = config.inputs.map((i) => i.id);
  const outputIds = config.outputs.map((o) => o.id);
  const dupes = [...inputIds, ...outputIds].filter((id, i, all) => all.indexOf(id) !== i);
  if (dupes.length) errors.push(`duplicate ids: ${[...new Set(dupes)].join(", ")}`);

  // Formulas: must parse; may reference inputs and earlier outputs only.
  const known = new Set(inputIds);
  for (const out of config.outputs) {
    const r = parseFormula(out.formula);
    if (!r.ok) { errors.push(`output "${out.id}" formula: ${r.error}`); continue; }
    for (const ref of collectIdentifiers(r.ast)) {
      if (!known.has(ref)) errors.push(`output "${out.id}" formula references unknown id "${ref}"`);
    }
    known.add(out.id);
  }

  const outputIdSet = new Set(outputIds);
  const inputIdSet = new Set(inputIds);
  const inputById = new Map(config.inputs.map((i) => [i.id, i]));

  // Within-collection duplicate-id checks (runtime keys DOM nodes on these ids).
  const dupesWithin = (ids: string[]): string[] =>
    [...new Set(ids.filter((id, i, all) => all.indexOf(id) !== i))];
  const chartDupes = dupesWithin(config.charts.map((c) => c.id));
  if (chartDupes.length) errors.push(`duplicate chart ids: ${chartDupes.join(", ")}`);
  const challengeDupes = dupesWithin(config.challenges.map((c) => c.id));
  if (challengeDupes.length) errors.push(`duplicate challenge ids: ${challengeDupes.join(", ")}`);
  const overlayDupes = dupesWithin((config.visual?.overlays ?? []).map((o) => o.id));
  if (overlayDupes.length) errors.push(`duplicate overlay ids: ${overlayDupes.join(", ")}`);

  // Placement cross-check: a "stage" zone renders inside the stage layer, so
  // it requires a visual scene to actually exist to render into.
  const hasVisual = !!config.visual;
  for (const inp of config.inputs) {
    if (inp.placement?.zone === "stage" && !hasVisual) {
      errors.push(`input "${inp.id}": placement zone "stage" requires a visual scene`);
    }
  }
  for (const out of config.outputs) {
    if (out.placement?.zone === "stage" && !hasVisual) {
      errors.push(`output "${out.id}": placement zone "stage" requires a visual scene`);
    }
  }

  for (const c of config.charts) {
    if (!inputIdSet.has(c.xInputId)) {
      errors.push(`chart "${c.id}": unknown xInputId "${c.xInputId}"`);
    } else {
      const xInput = inputById.get(c.xInputId)!;
      if (xInput.type !== "slider" && xInput.type !== "number") {
        errors.push(`chart "${c.id}": xInputId "${c.xInputId}" must reference a slider or number input (got "${xInput.type}")`);
      }
    }
    if (!outputIdSet.has(c.yOutputId)) errors.push(`chart "${c.id}": unknown yOutputId "${c.yOutputId}"`);
  }
  const hasBackgroundImage = !!config.visual?.backgroundAssetId;
  for (const ov of config.visual?.overlays ?? []) {
    if (!outputIdSet.has(ov.outputId)) errors.push(`overlay "${ov.id}": unknown outputId "${ov.outputId}"`);
    if ((ov.type === "fill" || ov.type === "transform") && ov.inMin === ov.inMax) {
      errors.push(`overlay "${ov.id}": inMin and inMax must differ`);
    }
    if (ov.type === "fill" && !hasBackgroundImage) {
      // No background image behind the stage: the overlay's fill color sits
      // directly on the stage background, so it must be verifiably legible
      // (WCAG 1.4.11 non-text, 3:1). When a background image IS set this is
      // advisory only (the runtime's numeric readout is the guarantee) —
      // the editor surfaces a warning but export is not blocked.
      const ratio = contrastRatio(resolveColorHex(ov.color), STAGE_BG_HEX);
      if (!meetsNonText(ratio)) {
        errors.push(`overlay "${ov.id}": fill color fails 3:1 contrast against the stage background (${ratioLabel(ratio)}) — pick a stronger color`);
      }
    }
    if (ov.type === "swap") {
      const ups = ov.bands.map((b) => b.upTo);
      const sortedAscending = ups.every((v, i) => i === 0 || ups[i - 1] < v);
      if (!sortedAscending) errors.push(`overlay "${ov.id}": bands must be sorted ascending by upTo`);
    }
  }
  for (const ch of config.challenges) {
    if (!outputIdSet.has(ch.outputId)) errors.push(`challenge "${ch.id}": unknown outputId "${ch.outputId}"`);
    if (ch.comparator === "between") {
      if (ch.min === undefined || ch.max === undefined) errors.push(`challenge "${ch.id}": "between" requires min and max`);
      else if (!(ch.min < ch.max)) errors.push(`challenge "${ch.id}": "between" requires min < max`);
    }
    if ((ch.comparator === "gte" || ch.comparator === "lte") && ch.value === undefined)
      errors.push(`challenge "${ch.id}": "${ch.comparator}" requires value`);
  }
  for (const inp of config.inputs) {
    if (inp.type === "slider" || inp.type === "number") {
      if (inp.min === undefined || inp.max === undefined) {
        errors.push(`input "${inp.id}": ${inp.type} requires min and max`);
      } else {
        if (!(inp.min < inp.max)) errors.push(`input "${inp.id}": min must be less than max`);
        if (inp.defaultValue < inp.min || inp.defaultValue > inp.max)
          errors.push(`input "${inp.id}": defaultValue must be within [min, max]`);
      }
    }
    if (inp.type === "select") {
      if (!(inp.options && inp.options.length)) errors.push(`input "${inp.id}": select requires options`);
      else if (!inp.options.some((o) => o.value === inp.defaultValue))
        errors.push(`input "${inp.id}": defaultValue must match one of the option values`);
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, config };
}

// Runtime-shape mapping (RuntimeSandboxConfig/toRuntimeConfig/collectAssetIds)
// lives in the light, zod-free runtime-config.ts so client bundles that only
// need to resolve/reshape a config (the editor's live preview) don't pull in
// zod/sanitize-html/the formula parser. Re-exported here so no existing
// import site breaks.
export type RuntimeSandboxConfig = RuntimeSandboxConfigImpl;
export const toRuntimeConfig: (config: SandboxConfig, urlForAsset: (assetId: string) => string) => RuntimeSandboxConfig = toRuntimeConfigImpl;
export const collectAssetIds: (config: SandboxConfig) => string[] = collectAssetIdsImpl;

export function emptySandboxConfig(title: string): SandboxConfig {
  return sandboxConfigSchema.parse({
    title,
    inputs: [{ id: "x", label: "x", type: "slider", min: 0, max: 10, step: 1, defaultValue: 5 }],
    outputs: [{ id: "y", label: "y", formula: "x * 2" }],
    charts: [],
    challenges: [],
  });
}
