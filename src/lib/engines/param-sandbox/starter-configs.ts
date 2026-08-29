import { sandboxConfigSchema, type SandboxConfig } from "./schema";

/**
 * Starter templates offered on the "New interactive" form. Each entry's
 * `config` is parsed through `sandboxConfigSchema` at module load time so an
 * invalid starter fails immediately (a test asserts this — see
 * tests/starter-configs.test.ts) rather than surfacing as a runtime bug the
 * first time someone picks it.
 *
 * `config.title` here is a placeholder ("") — the real title always comes
 * from the "New interactive" form, never from the starter. Callers should go
 * through `starterConfig(starterId, title)` below rather than reading
 * `STARTERS[id].config` directly, so the title is always the one the
 * designer actually typed.
 */
export const STARTERS: Record<string, { label: string; description: string; group: "blank" | "exemplar"; config: SandboxConfig }> = {
  blank: {
    label: "Blank",
    description: "A single slider driving a single calculated result — start from scratch.",
    group: "blank",
    config: sandboxConfigSchema.parse({
      title: "",
      inputs: [
        { id: "value", label: "Value", type: "slider", min: 0, max: 10, step: 1, defaultValue: 5 },
      ],
      outputs: [
        { id: "result", label: "Result", formula: "value * 2" },
      ],
      charts: [],
      challenges: [],
    }),
  },
  buoyancy: {
    label: "Buoyancy Explorer (Archimedes)",
    description: "Sliders drive formulas, charts, and challenges.",
    group: "exemplar",
    config: sandboxConfigSchema.parse({
      title: "",
      intro: "<p>Drop an object into a fluid and see how much it displaces, and how hard the fluid pushes back.</p>",
      inputs: [
        { id: "mass", label: "Object mass", type: "slider", min: 0.5, max: 20, step: 0.5, defaultValue: 5, units: "kg" },
        {
          id: "density", label: "Fluid", type: "select", defaultValue: 1000, units: "kg/m3",
          options: [
            { label: "Fresh water", value: 1000 },
            { label: "Vegetable oil", value: 920 },
            { label: "Seawater", value: 1025 },
            { label: "Glycerin", value: 1260 },
          ],
        },
      ],
      outputs: [
        { id: "volume", label: "Displaced volume", formula: "mass / density * 1000", units: "L", decimals: 2 },
        { id: "force", label: "Weight (gravity)", formula: "mass * 9.81", units: "N", decimals: 1 },
      ],
      charts: [
        { id: "volume_chart", title: "Volume vs mass", xInputId: "mass", yOutputId: "volume", samples: 40 },
      ],
      challenges: [
        { id: "displace6", prompt: "Displace more than 6 litres of fluid.", outputId: "volume", comparator: "gte", value: 6 },
      ],
    }),
  },
  "dose-response": {
    label: "Dose-Response Explorer",
    description: "Pharmacokinetic model: half-life, accumulation, therapeutic window",
    group: "exemplar",
    // Transcribed verbatim from parseSandboxCompanionDoc(docs/exemplars/dose-response.companion.txt).config
    // (Task 7 of the exemplar library plan) — the committed companion doc is
    // the source of truth; tests/exemplar-content.test.ts asserts this config
    // stays structurally equal to that doc's parse result. The ONE deliberate
    // divergence is `title`: this module's placeholder-title invariant (see the
    // file header) wins, so the title stays "" here while the committed doc
    // carries the real, faculty-facing TITLE. The parity test normalizes title
    // away and asserts the doc's TITLE equals this starter's `label` instead.
    config: sandboxConfigSchema.parse({
      title: "",
      intro:
        "<p>This is an educational model, not clinical guidance: it uses simplified one compartment pharmacokinetics to show how dose and dosing interval shape peak and trough concentrations, and it must never be used to select, adjust, or check a dose for a real patient. The agent, its half life, and every threshold in the challenges below are invented for teaching; no real drug behaves exactly this way. Two of those thresholds are easy to confuse, so keep them apart: a trough floor of 2 mg per litre, below which this model treats the drug as too dilute to act, and a peak target band of 12 to 20 mg per litre, above which it treats the drug as toxic. By the end of this activity you will be able to predict how a change in dose, dosing interval, or patient weight moves the peak and trough concentrations of a drug at steady state, and explain why accumulation is set by the interval and the half life rather than by the size of the dose.</p>",
      inputs: [
        { id: "dose", label: "Dose", type: "slider", min: 100, max: 1500, step: 25, defaultValue: 500, units: "mg" },
        { id: "dosing_interval", label: "Dosing interval", type: "slider", min: 4, max: 24, step: 1, defaultValue: 8, units: "hours" },
        { id: "patient_weight", label: "Patient weight", type: "slider", min: 40, max: 140, step: 1, defaultValue: 70, units: "kg" },
        { id: "half_life", label: "Half life", type: "slider", min: 1, max: 12, step: 0.5, defaultValue: 4, units: "hours" },
        { id: "volume_per_kilogram", label: "Volume per kilogram", type: "slider", min: 0.1, max: 1, step: 0.05, defaultValue: 0.3, units: "L/kg" },
      ],
      outputs: [
        { id: "elimination_rate", label: "Elimination rate", formula: "ln(2) / half_life", units: "1/h", decimals: 4 },
        { id: "distribution_volume", label: "Distribution volume", formula: "patient_weight * volume_per_kilogram", units: "L", decimals: 2 },
        { id: "accumulation_factor", label: "Accumulation factor", formula: "1 / (1 - exp(-elimination_rate * dosing_interval))", units: "ratio", decimals: 3 },
        { id: "peak_concentration", label: "Peak concentration", formula: "dose / distribution_volume * accumulation_factor", units: "mg/L", decimals: 2 },
        { id: "trough_concentration", label: "Trough concentration", formula: "peak_concentration * exp(-elimination_rate * dosing_interval)", units: "mg/L", decimals: 2 },
      ],
      charts: [
        { id: "trough_concentration_vs_dosing_i", title: "Trough concentration across dosing intervals", xInputId: "dosing_interval", yOutputId: "trough_concentration", samples: 40 },
        { id: "peak_concentration_vs_dose", title: "Peak concentration across doses", xInputId: "dose", yOutputId: "peak_concentration", samples: 40 },
      ],
      challenges: [
        { id: "keep_the_trough_at_or_above_2_mg", prompt: "Keep the trough at or above 2 mg per litre, the floor below which this model treats the drug as too dilute to act.", outputId: "trough_concentration", comparator: "gte", value: 2 },
        { id: "keep_the_peak_at_or_below_20_mg", prompt: "Keep the peak at or below 20 mg per litre, the toxicity ceiling in this model.", outputId: "peak_concentration", comparator: "lte", value: 20 },
        { id: "land_the_peak_inside_the_target", prompt: "Land the peak inside the target band, 12 to 20 mg per litre in this model.", outputId: "peak_concentration", comparator: "between", min: 12, max: 20 },
        { id: "accumulation_is_set_by_the_inter", prompt: "Accumulation is set by the interval and the half life, not by the size of the dose. Find an interval that keeps the accumulation factor in a moderate range.", outputId: "accumulation_factor", comparator: "between", min: 1.5, max: 3 },
      ],
    }),
  },
  "break-even-studio": {
    label: "Break-Even Studio",
    description: "Cost-volume-profit: contribution margin and break-even",
    group: "exemplar",
    // Transcribed verbatim from parseSandboxCompanionDoc(docs/exemplars/break-even-studio.companion.txt).config
    // (Task 7 of the exemplar library plan) — the committed companion doc is
    // the source of truth; tests/exemplar-content.test.ts asserts this config
    // stays structurally equal to that doc's parse result, with `title`
    // normalized away (see the dose-response note above).
    config: sandboxConfigSchema.parse({
      title: "",
      intro:
        "<p>A small community ceramics studio sells seats in monthly workshops. Every seat costs something in clay, glaze and firing; the rent, the kiln lease and the insurance cost the same whether one person books or three hundred do. By the end of this activity you will be able to find a price, cost and volume combination that makes the studio viable, and explain why raising the price and raising the volume are not interchangeable ways of getting there. Move the sliders until all four challenges are met at the same time.</p>",
      inputs: [
        { id: "price", label: "Price", type: "slider", min: 20, max: 150, step: 5, defaultValue: 45, units: "$ per seat" },
        { id: "unit_cost", label: "Unit cost", type: "slider", min: 5, max: 60, step: 1, defaultValue: 18, units: "$ per seat" },
        { id: "fixed_costs", label: "Fixed costs", type: "slider", min: 2000, max: 20000, step: 250, defaultValue: 9000, units: "$ per month" },
        { id: "volume", label: "Volume", type: "slider", min: 0, max: 800, step: 10, defaultValue: 250, units: "seats per month" },
      ],
      outputs: [
        { id: "contribution_margin", label: "Contribution margin", formula: "price - unit_cost", units: "$ per seat", decimals: 2 },
        { id: "contribution_margin_ratio", label: "Contribution margin ratio", formula: "contribution_margin / price * 100", units: "percent", decimals: 2 },
        { id: "seats_to_break_even", label: "Seats to break even", formula: "fixed_costs / contribution_margin", units: "seats", decimals: 0 },
        { id: "monthly_profit", label: "Monthly profit", formula: "contribution_margin * volume - fixed_costs", units: "$ per month", decimals: 2 },
      ],
      charts: [
        { id: "monthly_profit_vs_volume", title: "Monthly profit across seat volume", xInputId: "volume", yOutputId: "monthly_profit", samples: 40 },
        { id: "seats_to_break_even_vs_price", title: "Seats needed to break even across prices", xInputId: "price", yOutputId: "seats_to_break_even", samples: 40 },
      ],
      challenges: [
        { id: "get_the_studio_to_a_profit_month", prompt: "Get the studio to a profit: monthly profit of at least one dollar.", outputId: "monthly_profit", comparator: "gte", value: 1 },
        { id: "comparable_studios_in_this_marke", prompt: "Comparable studios in this market cannot sustain a contribution margin above 55 percent of the seat price. Keep the ratio at or below 55.", outputId: "contribution_margin_ratio", comparator: "lte", value: 55 },
        { id: "the_studio_can_seat_300_people_a", prompt: "The studio can seat 300 people a month. Get the seats needed to break even down to 300 or fewer.", outputId: "seats_to_break_even", comparator: "lte", value: 300 },
        { id: "find_a_plan_that_is_comfortably", prompt: "Find a plan that is comfortably rather than barely profitable: monthly profit from 1500 to 6000 dollars.", outputId: "monthly_profit", comparator: "between", min: 1500, max: 6000 },
      ],
    }),
  },
};

export const DEFAULT_STARTER_ID = "blank";

/** Builds a fresh, title-stamped config for the given starter id. Unknown
 *  ids fall back to the blank starter (mirrors the FormData default in
 *  `createInteractive`) rather than throwing, since this can be reached with
 *  attacker-controlled input. Re-parses through the schema so the result is
 *  a genuinely fresh object tree (no shared references back into
 *  `STARTERS`), not just a shallow spread. */
export function starterConfig(starterId: string, title: string): SandboxConfig {
  const starter = STARTERS[starterId] ?? STARTERS[DEFAULT_STARTER_ID];
  return sandboxConfigSchema.parse({ ...starter.config, title });
}
