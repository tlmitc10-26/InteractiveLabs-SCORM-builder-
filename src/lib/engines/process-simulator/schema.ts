import { z } from "zod";
import { sanitizeRichText, sanitizePlainText } from "@/lib/sanitize";
import { RDS_COLOR_NAMES, type TokenName } from "@/lib/design/tokens";

// Mirrors branching-scenario/schema.ts's id/plain/rich helpers exactly
// (salvaged, not extracted — see docs/superpowers/specs/2026-09-04-process-
// simulator-design.md §1 on why shared helpers are copied rather than
// shared between engines).
const idPattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const safeId = z.string().min(1).max(40).regex(idPattern, "ids must be letters/digits/underscore");
const plain = (max: number) => z.string().max(max).transform(sanitizePlainText).pipe(z.string().max(max));
const rich = (max: number) => z.string().max(max).transform(sanitizeRichText).pipe(z.string().max(max));

/**
 * Action shape (spec §2). `requires` is CONJUNCTIVE — an action is legal
 * iff EVERY listed id is already done. `[]` is invalid (min 1); absent
 * means "no prerequisites". Field-requirement matrix (outcome/consequence/
 * consequenceNote) is enforced in validateProcessConfig below, not here —
 * it depends on `required` and whether `requires` is present, which zod's
 * per-field shape checks can't express (mirrors case-workspace/schema.ts's
 * kind-consistency split).
 */
const actionSchema = z.object({
  id: safeId,
  label: plain(200),
  required: z.boolean(),
  requires: z.array(safeId).min(1).max(6).optional(),
  outcome: rich(1500).optional(),
  consequence: rich(1500).optional(),
  consequenceNote: plain(300).optional(),
}).strict();

export const processConfigSchema = z.object({
  title: plain(200),
  intro: rich(5000),
  // Brand band color for the Brief step (spec §3) — v1 has no header image,
  // consistent with the other three engines' headerColor doc comments.
  headerColor: z.enum(RDS_COLOR_NAMES as [TokenName, ...TokenName[]]).optional(),
  opening: rich(2000),
  expertNote: rich(3000).optional(),
  actions: z.array(actionSchema).min(4).max(24),
}).strict();

export type ProcessConfig = z.infer<typeof processConfigSchema>;
export type ProcessAction = ProcessConfig["actions"][number];
export type ProcessValidation = { ok: true; config: ProcessConfig } | { ok: false; errors: string[] };

/**
 * Cross-field/business rules that zod's per-field shape checks above cannot
 * express — mirrors case-workspace/schema.ts's validateCaseConfig role and
 * structure exactly. Order follows spec §2's validation paragraph: unique
 * ids -> requires resolution/required-only/no-self-reference/dedup -> acyclic
 * check -> required-count floor -> the illegally-attemptable hard rule ->
 * field matrix (both directions) -> unique required labels.
 */
export function validateProcessConfig(raw: unknown): ProcessValidation {
  const parsed = processConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  const config = parsed.data;
  const errors: string[] = [];

  // Unique action ids.
  const seenIds = new Set<string>();
  for (const a of config.actions) {
    if (seenIds.has(a.id)) errors.push(`duplicate action id "${a.id}"`);
    seenIds.add(a.id);
  }

  const byId = new Map(config.actions.map((a) => [a.id, a]));
  const requiredIds = new Set(config.actions.filter((a) => a.required).map((a) => a.id));

  // requires: every entry resolves, references a REQUIRED action, no
  // self-reference, deduplicated (transitive over-specification is legal —
  // an editor advisory, not a hard error here).
  for (const a of config.actions) {
    if (!a.requires) continue;
    // A distractor's own `requires` is never consulted (state.ts's
    // attemptAction: "any distractor click is unconditionally illegal --
    // its own `requires` (if authored) is never consulted") -- so the field
    // is dead/misleading data on a distractor and is forbidden outright,
    // rather than validated against the resolution rules below (fix round:
    // closes the gap the required->distractor toggle cascade's doc comment
    // already anticipated: an orphaned `requires` left behind by a toggle
    // must be "surfaced by the field-matrix validator as a named error").
    if (!a.required) {
      errors.push(`action "${a.id}": distractor actions must not carry requires (a distractor's own prerequisites are never consulted when it is attempted)`);
      continue;
    }
    const seenRefs = new Set<string>();
    for (const ref of a.requires) {
      if (ref === a.id) {
        errors.push(`action "${a.id}": requires cannot reference itself`);
      } else if (!byId.has(ref)) {
        errors.push(`action "${a.id}": requires references unknown action "${ref}"`);
      } else if (!requiredIds.has(ref)) {
        errors.push(`action "${a.id}": requires references non-required action "${ref}" — only required actions are referenceable`);
      }
      if (seenRefs.has(ref)) errors.push(`action "${a.id}": requires contains a duplicate entry "${ref}"`);
      seenRefs.add(ref);
    }
  }

  // Acyclic check (topological/DFS cycle detection) — only walks edges that
  // resolve to a known action id, so an already-reported bad reference
  // doesn't cascade into a spurious cycle report. Acyclic + requires-only-
  // required together guarantee every required action is reachable from an
  // empty "done" set (tested in process-schema.test.ts rather than checked
  // again here — it is a mathematical consequence of the two rules, not an
  // independent one).
  const UNVISITED = 0, VISITING = 1, DONE = 2;
  const state = new Map<string, number>();
  const cycle: { path: string[] | null } = { path: null };
  const visit = (id: string, stack: string[]): void => {
    if (cycle.path) return;
    const s = state.get(id) ?? UNVISITED;
    if (s === DONE) return;
    if (s === VISITING) {
      const start = stack.indexOf(id);
      cycle.path = [...stack.slice(start), id];
      return;
    }
    state.set(id, VISITING);
    const action = byId.get(id);
    if (action?.requires) {
      for (const ref of action.requires) {
        if (!byId.has(ref)) continue; // unresolved reference already reported above
        visit(ref, [...stack, id]);
        if (cycle.path) return;
      }
    }
    state.set(id, DONE);
  };
  for (const a of config.actions) {
    visit(a.id, []);
    if (cycle.path) break;
  }
  if (cycle.path) errors.push(`prerequisite graph contains a cycle: ${cycle.path.join(" -> ")}`);

  // At least 2 required actions.
  if (requiredIds.size < 2) errors.push(`at least 2 required actions are required (found ${requiredIds.size})`);

  // The ≥1-illegally-attemptable hard rule (spec §2 review #4): otherwise a
  // legal config exists where every learner scores 100 unconditionally.
  const hasPrereqEdge = config.actions.some((a) => a.required && a.requires && a.requires.length > 0);
  const hasDistractor = config.actions.some((a) => !a.required);
  if (!hasPrereqEdge && !hasDistractor) {
    errors.push(
      "at least one required action must carry a prerequisite, or at least one distractor action must exist " +
      "(otherwise every learner scores 100 unconditionally)",
    );
  }

  // Field-requirement matrix, both directions.
  for (const a of config.actions) {
    const hasRequires = !!(a.requires && a.requires.length > 0);
    if (a.required) {
      if (!a.outcome) errors.push(`action "${a.id}": required actions require outcome`);
      if (hasRequires) {
        if (!a.consequence) errors.push(`action "${a.id}": a required action with prerequisites requires consequence`);
      } else if (a.consequence) {
        errors.push(`action "${a.id}": a prerequisite-free required action must not carry consequence (dead text — it is never attemptable illegally)`);
      }
    } else {
      if (a.outcome) errors.push(`action "${a.id}": distractor actions must not carry outcome`);
      if (!a.consequence) errors.push(`action "${a.id}": distractor actions require consequence`);
    }

    // consequenceNote is required wherever consequence is required, and
    // forbidden otherwise (the debrief teaching line only makes sense
    // attached to a consequence that can actually be triggered).
    const consequenceRequired = (a.required && hasRequires) || !a.required;
    if (consequenceRequired) {
      if (!a.consequenceNote) errors.push(`action "${a.id}": consequenceNote is required wherever consequence is required`);
    } else if (a.consequenceNote) {
      errors.push(`action "${a.id}": consequenceNote must not be present without a required consequence`);
    }
  }

  // Required action labels unique case-insensitively (review #22 — `after:`
  // resolves by label in the doc format; only required actions are
  // referenceable, so the rule is narrow to them).
  const labelsSeen = new Set<string>();
  for (const a of config.actions) {
    if (!a.required) continue;
    const key = a.label.toLowerCase();
    if (labelsSeen.has(key)) errors.push(`duplicate required action label (case-insensitive): "${a.label}"`);
    labelsSeen.add(key);
  }

  return errors.length ? { ok: false, errors } : { ok: true, config };
}
