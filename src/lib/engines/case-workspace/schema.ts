import { z } from "zod";
import { sanitizeRichText, sanitizePlainText } from "@/lib/sanitize";
import { RDS_COLOR_NAMES, type TokenName } from "@/lib/design/tokens";

// Mirrors branching-scenario/schema.ts's id/plain/rich helpers exactly
// (salvaged, not extracted — see docs/superpowers/specs/2026-08-28-case-
// workspace-design.md §1 on why shared helpers are copied rather than
// shared between engines).
const idPattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const safeId = z.string().min(1).max(40).regex(idPattern, "ids must be letters/digits/underscore");
const plain = (max: number) => z.string().max(max).transform(sanitizePlainText).pipe(z.string().max(max));
const rich = (max: number) => z.string().max(max).transform(sanitizeRichText).pipe(z.string().max(max));

const tableSchema = z.object({
  caption: plain(200).optional(),
  headers: z.array(plain(60)).min(2).max(5),
  rows: z.array(z.array(plain(120))).min(1).max(8),
}).strict();

const artifactSchema = z.object({
  id: safeId,
  title: plain(120),
  sourceLine: plain(200).optional(),
  kind: z.enum(["text", "image", "table"]),
  body: rich(3000).optional(),
  imageAssetId: z.string().min(1).max(64).optional(),
  imageRole: z.enum(["decorative", "informative"]).optional(),
  imageAlt: plain(300).optional(),
  table: tableSchema.optional(),
}).strict();

const reasonSchema = z.object({
  id: safeId,
  text: plain(300),
  sound: z.boolean(),
  flawNote: plain(300).optional(),
}).strict();

const conclusionSchema = z.object({
  id: safeId,
  label: plain(200),
  body: rich(2000).optional(),
  credit: z.enum(["full", "partial", "none"]),
  expertRationale: rich(3000),
  reasons: z.array(reasonSchema).min(2).max(6),
}).strict();

const mapEntrySchema = z.object({
  artifactId: safeId,
  conclusionId: safeId,
  role: z.enum(["supports", "contradicts"]),
  strength: z.enum(["strong", "weak"]),
}).strict();

export const caseConfigSchema = z.object({
  title: plain(200),
  intro: rich(5000),
  scoringMode: z.enum(["single", "best-supported", "argument-quality"]),
  // Brand band color for the Brief step (spec §3) — v1 has no header image
  // (review #6), consistent with branching's headerColor doc comment.
  headerColor: z.enum(RDS_COLOR_NAMES as [TokenName, ...TokenName[]]).optional(),
  artifacts: z.array(artifactSchema).min(2).max(16),
  conclusions: z.array(conclusionSchema).min(2).max(6),
  expertMap: z.array(mapEntrySchema).min(2).max(96),
}).strict();

export type CaseConfig = z.infer<typeof caseConfigSchema>;
export type CaseArtifact = CaseConfig["artifacts"][number];
export type CaseConclusion = CaseConfig["conclusions"][number];
export type CaseReason = CaseConclusion["reasons"][number];
export type CaseMapEntry = CaseConfig["expertMap"][number];
export type CaseValidation = { ok: true; config: CaseConfig } | { ok: false; errors: string[] };

/**
 * Cross-field/business rules that zod's per-field shape checks above cannot
 * express (or that mirror branching's precedent of keeping graph/cross-ref
 * checks in a second JS pass rather than zod .refine/.superRefine chains).
 * Order mirrors spec §2's validation paragraph: unique ids -> map resolution
 * + duplicates -> kind consistency + image matrix -> table shape ->
 * per-conclusion requirements (supports/reasons/flawNote) -> mode rules.
 */
export function validateCaseConfig(raw: unknown): CaseValidation {
  const parsed = caseConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  const config = parsed.data;
  const errors: string[] = [];

  const dupes = (ids: string[], what: string) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) errors.push(`duplicate ${what} id "${id}"`);
      seen.add(id);
    }
  };
  dupes(config.artifacts.map((a) => a.id), "artifact");
  dupes(config.conclusions.map((c) => c.id), "conclusion");
  for (const c of config.conclusions) dupes(c.reasons.map((r) => r.id), `reason (conclusion "${c.id}")`);

  const artifactIds = new Set(config.artifacts.map((a) => a.id));
  const conclusionIds = new Set(config.conclusions.map((c) => c.id));

  // Kind consistency: each kind requires its own payload and forbids the
  // others' (both directions — a config can be wrong by omission or by
  // carrying the wrong fields).
  for (const a of config.artifacts) {
    if (a.kind === "text") {
      if (!a.body) errors.push(`artifact "${a.id}": text artifacts require body`);
      if (a.imageAssetId || a.imageRole || a.imageAlt) errors.push(`artifact "${a.id}": text artifacts must not carry image fields`);
      if (a.table) errors.push(`artifact "${a.id}": text artifacts must not carry a table`);
    } else if (a.kind === "image") {
      if (a.body) errors.push(`artifact "${a.id}": image artifacts must not carry body`);
      if (a.table) errors.push(`artifact "${a.id}": image artifacts must not carry a table`);
      if (!a.imageAssetId) errors.push(`artifact "${a.id}": image artifacts require imageAssetId`);
      // Alt matrix — EXACT mirror of branching-scenario/schema.ts's scene
      // image checks.
      if (a.imageAssetId && !a.imageRole) errors.push(`artifact "${a.id}": images require imageRole (decorative or informative)`);
      if (a.imageRole === "informative" && !a.imageAlt) errors.push(`artifact "${a.id}": informative images require imageAlt (a human-accepted description)`);
      if (a.imageRole === "decorative" && a.imageAlt) errors.push(`artifact "${a.id}": decorative images must not carry imageAlt — mark it informative instead`);
    } else if (a.kind === "table") {
      if (a.body) errors.push(`artifact "${a.id}": table artifacts must not carry body`);
      if (a.imageAssetId || a.imageRole || a.imageAlt) errors.push(`artifact "${a.id}": table artifacts must not carry image fields`);
      if (!a.table) errors.push(`artifact "${a.id}": table artifacts require table`);
    }
    // imageRole/imageAlt without an image — mirrors branching's scene rule
    // verbatim; applies regardless of kind (a text/table artifact carrying
    // stray image fields already fails the kind-consistency check above,
    // but this rule names the specific defect too).
    if (!a.imageAssetId && (a.imageRole || a.imageAlt)) {
      errors.push(`artifact "${a.id}": imageRole/imageAlt without an image`);
    }
    if (a.kind === "table" && a.table) {
      const headerLen = a.table.headers.length;
      a.table.rows.forEach((row, i) => {
        if (row.length !== headerLen) {
          errors.push(`artifact "${a.id}" table row ${i}: length ${row.length} does not match header length ${headerLen}`);
        }
      });
    }
  }

  // Expert map: references resolve; (artifactId, conclusionId) pairs unique
  // (an absent pair means "irrelevant" per spec — duplicates are invalid,
  // not merely redundant).
  const seenPairs = new Set<string>();
  config.expertMap.forEach((m, i) => {
    if (!artifactIds.has(m.artifactId)) errors.push(`expertMap[${i}]: unknown artifact "${m.artifactId}"`);
    if (!conclusionIds.has(m.conclusionId)) errors.push(`expertMap[${i}]: unknown conclusion "${m.conclusionId}"`);
    const pairKey = `${m.artifactId}::${m.conclusionId}`;
    if (seenPairs.has(pairKey)) errors.push(`expertMap: duplicate pair (artifact "${m.artifactId}", conclusion "${m.conclusionId}")`);
    seenPairs.add(pairKey);
  });

  // Per-conclusion requirements: >=1 supports in the map, >=1 sound reason
  // (>=2 reasons total is already enforced by the array cap), flawNote
  // required on every flawed reason.
  for (const c of config.conclusions) {
    const supportsCount = config.expertMap.filter((m) => m.conclusionId === c.id && m.role === "supports").length;
    if (supportsCount === 0) errors.push(`conclusion "${c.id}": needs at least one supporting artifact in the expert map`);
    const soundCount = c.reasons.filter((r) => r.sound).length;
    if (soundCount === 0) errors.push(`conclusion "${c.id}": needs at least one sound reason`);
    for (const r of c.reasons) {
      if (!r.sound && !r.flawNote) errors.push(`conclusion "${c.id}" reason "${r.id}": flawed reasons require flawNote`);
    }
  }

  // Mode rules (spec §2/§4): single/best-supported require exactly one
  // credit "full"; single additionally forbids "partial" outright.
  // argument-quality tolerates any credit distribution — a mode switch must
  // never brick an otherwise-valid draft.
  if (config.scoringMode === "single" || config.scoringMode === "best-supported") {
    const fullCount = config.conclusions.filter((c) => c.credit === "full").length;
    if (fullCount !== 1) errors.push(`scoringMode "${config.scoringMode}" requires exactly one conclusion with credit "full" (found ${fullCount})`);
  }
  if (config.scoringMode === "single") {
    const partialCount = config.conclusions.filter((c) => c.credit === "partial").length;
    if (partialCount > 0) errors.push(`scoringMode "single" forbids credit "partial" (found ${partialCount})`);
  }

  return errors.length ? { ok: false, errors } : { ok: true, config };
}
