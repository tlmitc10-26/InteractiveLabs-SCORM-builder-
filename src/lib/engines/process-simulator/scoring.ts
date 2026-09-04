/**
 * LIGHT module: zero heavy deps (no zod, no sanitize-html). Pure scoring
 * math consumed by state.ts, the engine runtime (Task 5), and the editor's
 * live preview — mirrors case-workspace/scoring.ts's role as the
 * dependency-light home for structural types + math that must not pull
 * zod/sanitize-html into a client bundle. schema.ts's `ProcessConfig` (a
 * z.infer) structurally satisfies `ProcessConfigLike` below without either
 * module importing the other's types.
 *
 * All arithmetic is exact rational math (plain integers) until the SINGLE
 * final `Math.round(num / den)` call per spec §4 — no component is rounded
 * and then fed into a further calculation. `correctness` and `efficiency`
 * are each kept as an exact {num, den} ratio; combining them into a single
 * percentage (weights 60/40, already summing to 100) is one common-
 * denominator division followed by one round.
 */

export type ProcessActionLike = { id: string; required: boolean };
export type ProcessConfigLike = { actions: ProcessActionLike[] };

export interface Ratio {
  num: number;
  den: number;
}

export interface ProcessScoreResult {
  correctness: Ratio;
  efficiency: Ratio;
  totalPct: number;
}

/**
 * Derives the three scoring primitives (spec §4) from a config and an
 * `attempts` map: illegal-attempt counts keyed by action id, covering
 * REQUIRED actions attempted prematurely AND distractors clicked at all
 * (`failed(r)` / `hits(d)` in the spec's terms) — the exact same shape as
 * the suspend payload's `at` entries, so state.ts can feed either its live
 * in-memory map or a just-restored one through unchanged. An action with no
 * entry (or an explicit 0) is treated as never illegally attempted.
 *
 * clean = |{r in R : failed(r) = 0}|; totalAttempts = |R| + Σfailed(r) +
 * Σhits(d) (spec §4 — every required action contributes its own "legit"
 * attempt once done, plus every illegal attempt on anything).
 */
export function scoreComponents(
  config: ProcessConfigLike,
  attempts: ReadonlyMap<string, number>,
): { totalRequired: number; cleanCount: number; totalAttempts: number } {
  const required = config.actions.filter((a) => a.required);
  const totalRequired = required.length;
  let cleanCount = 0;
  let illegalAttempts = 0;
  for (const a of config.actions) {
    const count = attempts.get(a.id) ?? 0;
    illegalAttempts += count;
    if (a.required && count === 0) cleanCount++;
  }
  return { totalRequired, cleanCount, totalAttempts: totalRequired + illegalAttempts };
}

/**
 * correctness = clean/|R|; efficiency = |R|/totalAttempts; total = (60*
 * correctness + 40*efficiency)/100, i.e. — since 60+40=100 — simply
 * `60*correctness + 40*efficiency` expressed directly as a 0..100 pct.
 *
 * Deliberate property (review #23): correctness is blind to distractor
 * hits, so a learner who completes every required action in a legal order
 * (clean = totalRequired) floors at 60 no matter how many distractor hits
 * pile up — efficiency approaches, but per spec never reaches, 0. Locked by
 * the "60-floor extreme" fixture in scoring.test.ts.
 */
export function combineScore(totalRequired: number, cleanCount: number, totalAttempts: number): ProcessScoreResult {
  const correctness: Ratio = { num: cleanCount, den: totalRequired };
  const efficiency: Ratio = { num: totalRequired, den: totalAttempts };
  // 60*(clean/totalRequired) + 40*(totalRequired/totalAttempts), combined
  // over the common denominator (totalRequired * totalAttempts) — one
  // division, one round; already scaled 0..100 since the weights sum to 100.
  const num = 60 * correctness.num * efficiency.den + 40 * efficiency.num * correctness.den;
  const den = correctness.den * efficiency.den;
  const totalPct = Math.round(num / den);
  return { correctness, efficiency, totalPct };
}

/** Pure scoring entry point (spec §4): derives the components from `config`
 *  + `attempts` and combines them into a single result. */
export function scoreProcess(config: ProcessConfigLike, attempts: ReadonlyMap<string, number>): ProcessScoreResult {
  const { totalRequired, cleanCount, totalAttempts } = scoreComponents(config, attempts);
  return combineScore(totalRequired, cleanCount, totalAttempts);
}
