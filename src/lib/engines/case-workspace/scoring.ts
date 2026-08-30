/**
 * LIGHT module: zero heavy deps (no zod, no sanitize-html). Pure scoring
 * math consumed by state.ts, the engine runtime (Task 5), and the editor's
 * live preview — mirrors branching-scenario/runtime-config.ts's role as the
 * dependency-light home for structural types + math that must not pull
 * zod/sanitize-html into a client bundle. schema.ts's `CaseConfig` (a
 * z.infer) structurally satisfies `CaseConfigLike` below without either
 * module importing the other's types.
 *
 * All arithmetic is exact rational math (plain integers) until the SINGLE
 * final `Math.round((100 * num) / den)` call per spec §4 — no component is
 * rounded and then fed into a further calculation, which is what "integer
 * arithmetic so grades never float-flake" rules out. Each component
 * (evidence, reason, credit) is combined via a common-denominator product
 * rather than converting to a float early.
 */

export type CreditLevel = "full" | "partial" | "none";
export type MapRole = "supports" | "contradicts";
export type ScoringMode = "single" | "best-supported" | "argument-quality";

export type CaseReasonLike = { id: string; sound: boolean };
export type CaseConclusionLike = { id: string; credit: CreditLevel; reasons: CaseReasonLike[] };
export type CaseMapEntryLike = { artifactId: string; conclusionId: string; role: MapRole };

/** Structural authoring-config shape (see schema.ts's `CaseConfig`). Only
 *  the fields scoring needs — deliberately narrower than the full schema. */
export type CaseConfigLike = {
  scoringMode: ScoringMode;
  conclusions: CaseConclusionLike[];
  expertMap: CaseMapEntryLike[];
};

export interface Ratio {
  num: number;
  den: number;
}

export interface CaseScoreResult {
  evidence: Ratio;
  reason: Ratio;
  /** The chosen conclusion's authored credit level, for display — always
   *  reported even when the scoring mode ignores it (argument-quality) or
   *  the single-mode gate zeroes totalPct. Null only for an out-of-contract
   *  chosenId that names no conclusion. */
  credit: CreditLevel | null;
  totalPct: number;
}

/**
 * evidenceScore = max(0, |included ∩ supports(C)| − |included ∩
 * contradicts(C)|) ÷ |supports(C)| (spec §4).
 *
 * The denominator is guaranteed >=1 by validateCaseConfig (every conclusion
 * requires at least one supports entry) — the `Math.max(1, ...)` floor here
 * is DEFENSIVE ONLY. It is reachable exclusively via a direct call with an
 * out-of-contract config (e.g. a conclusion with zero supports entries),
 * which validateCaseConfig always rejects; no valid authored config can
 * trigger it (spec §4 review #16 / §9-M1).
 */
export function evidenceRatio(config: CaseConfigLike, chosenId: string, includedIds: readonly string[]): Ratio {
  const supports: string[] = [];
  const contradicts: string[] = [];
  for (const m of config.expertMap) {
    if (m.conclusionId !== chosenId) continue;
    (m.role === "supports" ? supports : contradicts).push(m.artifactId);
  }
  const included = new Set(includedIds);
  const includedSupports = supports.filter((id) => included.has(id)).length;
  const includedContradicts = contradicts.filter((id) => included.has(id)).length;
  const num = Math.max(0, includedSupports - includedContradicts);
  const den = Math.max(1, supports.length);
  return { num, den };
}

/**
 * reasonScore = max(0, |sel ∩ S| − |sel ∩ F|) ÷ |S| (spec §4), where S/F are
 * the chosen conclusion's sound/flawed reasons.
 *
 * The denominator is guaranteed >=1 by validateCaseConfig (every conclusion
 * requires at least one sound reason) — the floor here is DEFENSIVE ONLY,
 * same status as evidenceRatio's above. An unknown `chosenId` (no matching
 * conclusion) is likewise out-of-contract and returns 0/1 rather than
 * throwing.
 */
export function reasonRatio(config: CaseConfigLike, chosenId: string, selectedReasonIds: readonly string[]): Ratio {
  const conclusion = config.conclusions.find((c) => c.id === chosenId);
  if (!conclusion) return { num: 0, den: 1 };
  const sound: string[] = [];
  const flawed: string[] = [];
  for (const r of conclusion.reasons) (r.sound ? sound : flawed).push(r.id);
  const selected = new Set(selectedReasonIds);
  const selSound = sound.filter((id) => selected.has(id)).length;
  const selFlawed = flawed.filter((id) => selected.has(id)).length;
  const num = Math.max(0, selSound - selFlawed);
  const den = Math.max(1, sound.length);
  return { num, den };
}

/** conclusionCredit as a ratio out of a fixed denominator of 2, so it
 *  combines with evidence/reason ratios via plain integer products:
 *  full=2/2 (1), partial=1/2 (0.5), none=0/2 (0). */
function creditRatio(credit: CreditLevel): Ratio {
  switch (credit) {
    case "full":
      return { num: 2, den: 2 };
    case "partial":
      return { num: 1, den: 2 };
    case "none":
      return { num: 0, den: 2 };
  }
}

/** Weighted combination of TWO ratios into a single percentage via one
 *  final Math.round (argument-quality: evidence + reason only, /80). */
function combine2(e: Ratio, r: Ratio, we: number, wr: number, weightSum: number): number {
  const num = we * e.num * r.den + wr * r.num * e.den;
  const den = weightSum * e.den * r.den;
  return Math.round((100 * num) / den);
}

/** Weighted combination of THREE ratios into a single percentage via one
 *  final Math.round (single/best-supported: evidence + reason + credit,
 *  /100). */
function combine3(e: Ratio, r: Ratio, c: Ratio, we: number, wr: number, wc: number, weightSum: number): number {
  const num = we * e.num * r.den * c.den + wr * r.num * e.den * c.den + wc * c.num * e.den * r.den;
  const den = weightSum * e.den * r.den * c.den;
  return Math.round((100 * num) / den);
}

/**
 * Pure scoring entry point (spec §4). `chosenId` names the learner's
 * committed conclusion; `includedIds` is the case-file's artifact ids;
 * `selectedReasonIds` is the reason checkbox selection for that conclusion.
 *
 * Mode math:
 * - best-supported: totalPct = round(50*evidence + 30*reason + 20*credit)
 *   where credit is full=1/partial=0.5/none=0 — i.e. (50e+30r+20c)/100 as a
 *   percentage.
 * - argument-quality: credit is REMOVED from the formula and the weights
 *   renormalize over 80 instead of 100: (50e+30r)/80 as a percentage. The
 *   conclusion's authored credit is still reported on the result for
 *   display, just never consulted by the math — so a mode switch can never
 *   brick or silently repunish a draft.
 * - single: conclusionCredit GATES the grade. If the chosen conclusion's
 *   credit is not "full" (i.e. it is not the single right answer),
 *   totalPct is 0 regardless of evidence/reason quality. If it IS "full",
 *   the formula is identical to best-supported's with credit fixed at
 *   full: (50e+30r+20)/100.
 */
export function scoreCase(
  config: CaseConfigLike,
  chosenId: string,
  includedIds: readonly string[],
  selectedReasonIds: readonly string[],
): CaseScoreResult {
  const conclusion = config.conclusions.find((c) => c.id === chosenId);
  const evidence = evidenceRatio(config, chosenId, includedIds);
  const reason = reasonRatio(config, chosenId, selectedReasonIds);
  const credit = conclusion ? conclusion.credit : null;

  if (config.scoringMode === "single") {
    if (credit !== "full") {
      return { evidence, reason, credit, totalPct: 0 };
    }
    return { evidence, reason, credit, totalPct: combine3(evidence, reason, creditRatio("full"), 50, 30, 20, 100) };
  }

  if (config.scoringMode === "argument-quality") {
    return { evidence, reason, credit, totalPct: combine2(evidence, reason, 50, 30, 80) };
  }

  // best-supported
  const cr = creditRatio(credit ?? "none");
  return { evidence, reason, credit, totalPct: combine3(evidence, reason, cr, 50, 30, 20, 100) };
}
