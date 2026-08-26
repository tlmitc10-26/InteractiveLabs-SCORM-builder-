import { parseFormula } from "@/lib/formula/parser";
import { collectIdentifiers } from "@/lib/formula/evaluate";

/**
 * Rewrites every reference to `oldId` into `newId` across a config's
 * formulas, chart axes, challenge outputIds, and overlay outputIds — the
 * "rename id" affordance in the editor's per-row Advanced `<details>`
 * (renaming from a stable, auto-generated id to a fresh one derived from the
 * current label). Word-boundary safe: renaming "mass" must never touch
 * "biomass" (verified via `collectIdentifiers` — the formula parser's own
 * identifier boundaries — rather than a bare string search/replace).
 *
 * Structural/untyped on purpose (mirrors runtime-config.ts): this needs only
 * the formula parser, not zod/sanitize-html, so it stays importable from the
 * editor's client bundle without dragging schema.ts's weight along.
 *
 * Never mutates `config`; returns a new object. Fields the config doesn't
 * have (e.g. no `visual`) are left absent in the result.
 */

type Box = { x: number; y: number; w: number; h: number };

type Overlay =
  | { id: string; type: "fill"; outputId: string; [k: string]: unknown }
  | { id: string; type: "swap"; outputId: string; [k: string]: unknown }
  | { id: string; type: "transform"; outputId: string; [k: string]: unknown };

export type RenameableConfig = {
  title: string; intro?: string;
  inputs: Array<{ id: string; [k: string]: unknown }>;
  outputs: Array<{ id: string; formula: string; [k: string]: unknown }>;
  charts: Array<{ id: string; xInputId: string; yOutputId: string; [k: string]: unknown }>;
  visual?: { backgroundAssetId?: string; overlays: Overlay[] };
  challenges: Array<{ id: string; outputId: string; [k: string]: unknown }>;
  [k: string]: unknown;
};

/** Replaces every whole-identifier occurrence of `oldId` with `newId` in a
 *  formula string, verified via the formula parser's own identifier
 *  collection (not a bare regex) so this can never touch part of a longer
 *  identifier (renaming "mass" leaves "biomass" untouched) and never
 *  produces a formula that fails to parse the same way the input did. Word
 *  boundaries in the replace itself rely on `\b`, which — since formula
 *  identifiers are exactly `[a-zA-Z_][a-zA-Z0-9_]*` (the same character
 *  class `\w` uses) — only matches where a real identifier starts/ends. */
export function renameInFormula(formula: string, oldId: string, newId: string): string {
  const parsed = parseFormula(formula);
  if (!parsed.ok) return formula; // don't touch formulas we can't safely analyze
  if (!collectIdentifiers(parsed.ast).includes(oldId)) return formula;
  const pattern = new RegExp(`\\b${escapeRegExp(oldId)}\\b`, "g");
  return formula.replace(pattern, newId);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Renames `oldId` to `newId` everywhere it can be referenced: as an
 *  input/output's own id, inside output formulas, as a chart's
 *  xInputId/yOutputId, as a challenge's outputId, and as an overlay's
 *  outputId. Placements aren't in the schema yet (a later task), so there's
 *  nothing else to touch. Leaves every other identifier untouched. */
export function renameIdentifier<T extends RenameableConfig>(config: T, oldId: string, newId: string): T {
  if (oldId === newId) return config;

  const inputs = config.inputs.map((i) => (i.id === oldId ? { ...i, id: newId } : i));
  const outputs = config.outputs.map((o) => ({
    ...o,
    id: o.id === oldId ? newId : o.id,
    formula: renameInFormula(o.formula, oldId, newId),
  }));
  const charts = config.charts.map((c) => ({
    ...c,
    xInputId: c.xInputId === oldId ? newId : c.xInputId,
    yOutputId: c.yOutputId === oldId ? newId : c.yOutputId,
  }));
  const challenges = config.challenges.map((ch) => ({
    ...ch,
    outputId: ch.outputId === oldId ? newId : ch.outputId,
  }));
  const visual = config.visual
    ? {
        ...config.visual,
        overlays: config.visual.overlays.map((ov) => (ov.outputId === oldId ? { ...ov, outputId: newId } : ov)),
      }
    : config.visual;

  return { ...config, inputs, outputs, charts, challenges, visual };
}

// Re-export Box for callers that want it (stage-authoring/placement tasks
// will extend this module; kept here so the type has one home).
export type { Box };
