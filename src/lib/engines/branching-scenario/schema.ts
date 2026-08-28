import { z } from "zod";
import { sanitizeRichText, sanitizePlainText } from "@/lib/sanitize";
import { RDS_COLOR_NAMES, type TokenName } from "@/lib/design/tokens";

const idPattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const safeId = z.string().min(1).max(40).regex(idPattern, "ids must be letters/digits/underscore");
const plain = (max: number) => z.string().max(max).transform(sanitizePlainText).pipe(z.string().max(max));
const rich = (max: number) => z.string().max(max).transform(sanitizeRichText).pipe(z.string().max(max));

const conditionSchema = z.object({
  variableId: safeId,
  comparator: z.enum(["gte", "lte", "between"]),
  value: z.number().int().optional(),
  min: z.number().int().optional(),
  max: z.number().int().optional(),
}).strict();

const effectSchema = z.object({ variableId: safeId, delta: z.number().int().min(-100).max(100) }).strict();

const choiceSchema = z.object({
  id: safeId,
  label: plain(300),
  quality: z.enum(["best", "acceptable", "poor"]),
  effects: z.array(effectSchema).max(4).default([]),
  feedback: rich(2000).optional(),
  goTo: z.string().regex(/^(scene|ending):[a-zA-Z_][a-zA-Z0-9_]*$/, 'goTo must be "scene:<id>" or "ending:<id>"'),
  showIf: conditionSchema.optional(),
}).strict();

const sceneSchema = z.object({
  id: safeId,
  title: plain(200).optional(),
  body: rich(5000),
  imageAssetId: z.string().min(1).max(64).optional(),
  imageRole: z.enum(["decorative", "informative"]).optional(),
  imageAlt: plain(300).optional(),
  choices: z.array(choiceSchema).min(1).max(6),
}).strict();

const variableSchema = z.object({
  id: safeId, label: plain(80),
  initial: z.number().int(), min: z.number().int(), max: z.number().int(),
  visible: z.boolean().default(false),
}).strict();

const endingSchema = z.object({ id: safeId, title: plain(200), body: rich(5000) }).strict();

export const branchingConfigSchema = z.object({
  title: plain(200),
  intro: rich(5000).optional(),
  role: plain(200).optional(),
  // Scenario-level header band color (visual pass only — see
  // docs/superpowers/specs/2026-08-27-runtime-visual-design.md §2): used ONLY
  // when a scene has no uploaded image, in which case the runtime paints a
  // solid brand band in this token color (default "primary" when absent —
  // see main.ts's `config.headerColor ?? "primary"`). Token-only, like every
  // other color in this app — never a raw hex/gradient.
  headerColor: z.enum(RDS_COLOR_NAMES as [TokenName, ...TokenName[]]).optional(),
  variables: z.array(variableSchema).max(8).default([]),
  scenes: z.array(sceneSchema).min(1).max(40),
  startSceneId: safeId,
  endings: z.array(endingSchema).min(1).max(8),
  feedbackMode: z.enum(["immediate", "debrief"]).default("debrief"),
  showPathInDebrief: z.boolean().default(true),
}).strict();

export type BranchingConfig = z.infer<typeof branchingConfigSchema>;
export type BranchingValidation = { ok: true; config: BranchingConfig } | { ok: false; errors: string[] };

function conditionErrors(where: string, c: NonNullable<z.infer<typeof conditionSchema>>, varIds: Set<string>): string[] {
  const errs: string[] = [];
  if (!varIds.has(c.variableId)) errs.push(`${where}: unknown variable "${c.variableId}"`);
  if (c.comparator === "between") {
    if (c.min === undefined || c.max === undefined) errs.push(`${where}: "between" requires min and max`);
    else if (c.min >= c.max) errs.push(`${where}: "between" requires min < max`);
  } else if (c.value === undefined) errs.push(`${where}: "${c.comparator}" requires value`);
  return errs;
}

export function validateBranchingConfig(raw: unknown): BranchingValidation {
  const parsed = branchingConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  const config = parsed.data;
  const errors: string[] = [];

  const dupes = (ids: string[], what: string) => {
    const seen = new Set<string>();
    for (const id of ids) { if (seen.has(id)) errors.push(`duplicate ${what} id "${id}"`); seen.add(id); }
  };
  dupes(config.scenes.map((s) => s.id), "scene");
  dupes(config.endings.map((e) => e.id), "ending");
  dupes(config.variables.map((v) => v.id), "variable");
  for (const s of config.scenes) dupes(s.choices.map((c) => c.id), `choice (scene "${s.id}")`);

  const sceneIds = new Set(config.scenes.map((s) => s.id));
  const endingIds = new Set(config.endings.map((e) => e.id));
  const varIds = new Set(config.variables.map((v) => v.id));

  if (!sceneIds.has(config.startSceneId)) errors.push(`startSceneId "${config.startSceneId}" is not a scene`);

  for (const v of config.variables) {
    if (v.min >= v.max) errors.push(`variable "${v.id}": min must be < max`);
    if (v.initial < v.min || v.initial > v.max) errors.push(`variable "${v.id}": initial must be within [min, max]`);
  }

  for (const s of config.scenes) {
    if (s.imageAssetId && !s.imageRole) errors.push(`scene "${s.id}": images require imageRole (decorative or informative)`);
    if (s.imageRole === "informative" && !s.imageAlt) errors.push(`scene "${s.id}": informative images require imageAlt (a human-accepted description)`);
    if (s.imageRole === "decorative" && s.imageAlt) errors.push(`scene "${s.id}": decorative images must not carry imageAlt — mark it informative instead`);
    if (!s.imageAssetId && (s.imageRole || s.imageAlt)) errors.push(`scene "${s.id}": imageRole/imageAlt without an image`);
    if (s.choices.every((c) => c.showIf)) errors.push(`scene "${s.id}": at least one choice must have no showIf (guaranteed exit)`);
    for (const c of s.choices) {
      const [kind, target] = c.goTo.split(":");
      if (kind === "scene" && !sceneIds.has(target)) errors.push(`scene "${s.id}" choice "${c.id}": goTo scene "${target}" does not exist`);
      if (kind === "ending" && !endingIds.has(target)) errors.push(`scene "${s.id}" choice "${c.id}": goTo ending "${target}" does not exist`);
      if (c.showIf) errors.push(...conditionErrors(`scene "${s.id}" choice "${c.id}" showIf`, c.showIf, varIds));
      for (const ef of c.effects) if (!varIds.has(ef.variableId)) errors.push(`scene "${s.id}" choice "${c.id}": effect on unknown variable "${ef.variableId}"`);
    }
  }

  // Graph checks on the scene digraph (edges ignore showIf: conditions can hide
  // paths at runtime, but the guaranteed-exit rule ensures the unconditional
  // subgraph is what must be sound). Edge exists per UNCONDITIONAL choice for
  // ending-reachability; ALL choices count for plain reachability.
  if (errors.length === 0) {
    const reach = new Set<string>([config.startSceneId]);
    const queue = [config.startSceneId];
    const byId = new Map(config.scenes.map((s) => [s.id, s]));
    while (queue.length) {
      const s = byId.get(queue.shift() as string);
      if (!s) continue;
      for (const c of s.choices) {
        const [kind, target] = c.goTo.split(":");
        if (kind === "scene" && !reach.has(target)) { reach.add(target); queue.push(target); }
      }
    }
    for (const s of config.scenes) if (!reach.has(s.id)) errors.push(`scene "${s.id}" is unreachable from the start scene`);

    // canFinish: fixed point over scenes whose UNCONDITIONAL choices reach an ending
    const canFinish = new Set<string>();
    let grew = true;
    while (grew) {
      grew = false;
      for (const s of config.scenes) {
        if (canFinish.has(s.id)) continue;
        const ok = s.choices.some((c) => {
          if (c.showIf) return false;
          const [kind, target] = c.goTo.split(":");
          return kind === "ending" || canFinish.has(target);
        });
        if (ok) { canFinish.add(s.id); grew = true; }
      }
    }
    for (const id of reach) if (!canFinish.has(id)) errors.push(`scene "${id}" is a dead end — no guaranteed path to any ending`);
  }

  return errors.length ? { ok: false, errors } : { ok: true, config };
}
