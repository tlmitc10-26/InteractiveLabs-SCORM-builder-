# Content brief: Dose-Response

**Slug:** `dose-response` · **Engine:** param-sandbox · **Standalone** (nursing / pharmacology)
**Authored through:** the sandbox companion-doc format (spec §5). The doc in §5 of this brief is the source of truth; the starter config is its parse result.
**Status:** content complete; transcribe verbatim, invent nothing.

---

## 1. Learning objective

Learner-visible, appears in the interactive's intro:

> By the end of this activity you will be able to predict how a change in dose, dosing interval, or patient weight moves the peak and trough concentrations of a drug at steady state, and explain why accumulation is set by the interval and the half life rather than by the size of the dose.

## 2. Discipline pattern

Pharmacology is taught with formulas and assessed with arithmetic, and the thing students most reliably fail to acquire is the *shape* of the relationships: that doubling the dose doubles both peak and trough while changing nothing about accumulation, that halving the interval moves the trough far more than the peak, that a heavier patient dilutes the same dose into a larger volume. Those are relationships you learn by moving one variable and watching four numbers respond, which is exactly what a parameter sandbox is. The same pattern — a small, dimensionally honest model plus challenges that force the learner into a target window rather than at a single answer — recurs across every quantitative health-science, engineering and physical-science program, and it is the highest-value sandbox shape because it converts a formula sheet into an instrument. The challenge structure also fixes a grading problem: a sandbox with one challenge scores 0 or 100, while four challenges give a SCORM score with a usable scale.

## 3. Notation for transcription

- The companion doc in §5 is authored by hand and imported through `parseSandboxCompanionDoc`. It must parse with **zero** error-severity issues, and the parsed config becomes the committed starter.
- Ids in this brief are the ids `slugify` produces from the labels — `Half life` → `half_life`, `Volume per kilogram` → `volume_per_kilogram`, and so on. They are given because the witness vectors in §6 are keyed by id.
- Output formulas are written in **label** form in the doc, which is the format's contract; the parser substitutes longest-label-first before validating with the real formula parser.
- Labels deliberately avoid hyphens, parentheses, `$`, and the token ` vs `, all of which the format flags as risky in labels.
- Every function used (`ln`, `exp`) is in the interpreter's whitelist. No constants are used, and no label collides with `pi` or `e`.

## 4. Configuration summary

| Field | Value |
| --- | --- |
| `title` | Dose-Response Explorer |
| inputs | 5 sliders |
| outputs | 5 |
| charts | 2 |
| challenges | 4 |
| `layout` | `side` (schema default) |

**Inputs**

| id | label | type | units | min | max | step | default |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dose` | Dose | slider | mg | 100 | 1500 | 25 | 500 |
| `dosing_interval` | Dosing interval | slider | hours | 4 | 24 | 1 | 8 |
| `patient_weight` | Patient weight | slider | kg | 40 | 140 | 1 | 70 |
| `half_life` | Half life | slider | hours | 1 | 12 | 0.5 | 4 |
| `volume_per_kilogram` | Volume per kilogram | slider | L/kg | 0.1 | 1 | 0.05 | 0.3 |

**Outputs** (declaration order matters — each may reference inputs and *earlier* outputs only)

| # | id | label | units | decimals | formula (label form) |
| --- | --- | --- | --- | --- | --- |
| 1 | `elimination_rate` | Elimination rate | 1/h | 4 | `ln(2) / Half life` |
| 2 | `distribution_volume` | Distribution volume | L | 2 | `Patient weight * Volume per kilogram` |
| 3 | `accumulation_factor` | Accumulation factor | ratio | 3 | `1 / (1 - exp(-Elimination rate * Dosing interval))` |
| 4 | `peak_concentration` | Peak concentration | mg/L | 2 | `Dose / Distribution volume * Accumulation factor` |
| 5 | `trough_concentration` | Trough concentration | mg/L | 2 | `Peak concentration * exp(-Elimination rate * Dosing interval)` |

**Charts**

| id (generated) | title | x input | y output | samples |
| --- | --- | --- | --- | --- |
| `trough_concentration_vs_dosing_i` (the 32-char id cap truncates it — expected) | Trough concentration across dosing intervals | `dosing_interval` | `trough_concentration` | 40 |
| `peak_concentration_vs_dose` | Peak concentration across doses | `dose` | `peak_concentration` | 40 |

**Challenges**

| # | learner text | output | comparator | value(s) |
| --- | --- | --- | --- | --- |
| 1 | Keep the trough at or above 2 mg per litre, the floor below which this model treats the drug as too dilute to act. | `trough_concentration` | `gte` | 2 |
| 2 | Keep the peak at or below 20 mg per litre, the toxicity ceiling in this model. | `peak_concentration` | `lte` | 20 |
| 3 | Land the peak inside the target band, 12 to 20 mg per litre in this model. | `peak_concentration` | `between` | 12, 20 |
| 4 | Accumulation is set by the interval and the half life, not by the size of the dose. Find an interval that keeps the accumulation factor in a moderate range. | `accumulation_factor` | `between` | 1.5, 3 |

**State at the default input values:** peak 31.75 mg/L, trough 7.94 mg/L, accumulation 1.333, elimination rate 0.1733 /h, distribution volume 21.00 L. Exactly one of the four challenges (the trough floor) is satisfied at load, so the activity opens with real work to do and is not trivially complete.

## 5. Content — the companion doc

This is the exact text of `docs/exemplars/dose-response.companion.txt`. `INTRO:` is one physical line; the educational-model statement is its first sentence and is **verbatim, non-negotiable**.

```
TITLE: Dose-Response Explorer
INTRO: This is an educational model, not clinical guidance: it uses simplified one compartment pharmacokinetics to show how dose and dosing interval shape peak and trough concentrations, and it must never be used to select, adjust, or check a dose for a real patient. The agent, its half life, and every threshold in the challenges below are invented for teaching; no real drug behaves exactly this way. Two of those thresholds are easy to confuse, so keep them apart: a trough floor of 2 mg per litre, below which this model treats the drug as too dilute to act, and a peak target band of 12 to 20 mg per litre, above which it treats the drug as toxic. By the end of this activity you will be able to predict how a change in dose, dosing interval, or patient weight moves the peak and trough concentrations of a drug at steady state, and explain why accumulation is set by the interval and the half life rather than by the size of the dose.

INPUT: Dose (slider, mg, 100 to 1500, step 25, start 500)
INPUT: Dosing interval (slider, hours, 4 to 24, step 1, start 8)
INPUT: Patient weight (slider, kg, 40 to 140, step 1, start 70)
INPUT: Half life (slider, hours, 1 to 12, step 0.5, start 4)
INPUT: Volume per kilogram (slider, L/kg, 0.1 to 1, step 0.05, start 0.3)

OUTPUT: Elimination rate (1/h, 4 decimals) = ln(2) / Half life
OUTPUT: Distribution volume (L, 2 decimals) = Patient weight * Volume per kilogram
OUTPUT: Accumulation factor (ratio, 3 decimals) = 1 / (1 - exp(-Elimination rate * Dosing interval))
OUTPUT: Peak concentration (mg/L, 2 decimals) = Dose / Distribution volume * Accumulation factor
OUTPUT: Trough concentration (mg/L, 2 decimals) = Peak concentration * exp(-Elimination rate * Dosing interval)

CHART: Trough concentration vs Dosing interval (40 samples, titled Trough concentration across dosing intervals)
CHART: Peak concentration vs Dose (40 samples, titled Peak concentration across doses)

CHALLENGE: Keep the trough at or above 2 mg per litre, the floor below which this model treats the drug as too dilute to act. -> Trough concentration at least 2
CHALLENGE: Keep the peak at or below 20 mg per litre, the toxicity ceiling in this model. -> Peak concentration at most 20
CHALLENGE: Land the peak inside the target band, 12 to 20 mg per litre in this model. -> Peak concentration between 12 and 20
CHALLENGE: Accumulation is set by the interval and the half life, not by the size of the dose. Find an interval that keeps the accumulation factor in a moderate range. -> Accumulation factor between 1.5 and 3
```

### The learner-visible statement (exact)

> This is an educational model, not clinical guidance: it uses simplified one compartment pharmacokinetics to show how dose and dosing interval shape peak and trough concentrations, and it must never be used to select, adjust, or check a dose for a real patient.

It is the **first** sentence of the intro, before the objective, so it is the first thing rendered. It must not be moved, shortened, softened, or split across the interactive. If the intro is ever re-authored, this sentence survives unchanged.

### The model and its assumptions

One-compartment, intravenous-bolus, multiple-dose model at steady state:

- k = ln 2 / t½
- V_d = weight × (V_d per kg)
- R (accumulation factor) = 1 / (1 − e^(−k·τ))
- C_max,ss = (D / V_d) · R
- C_min,ss = C_max,ss · e^(−k·τ)

**Simplifying assumptions, stated because they are what make this a teaching model rather than a dosing tool:**

1. One compartment: the drug distributes instantaneously and uniformly; there is no distribution phase, so the peak is the concentration immediately after the dose.
2. Intravenous bolus: no absorption phase and complete bioavailability (F = 1). An oral drug would need an absorption rate constant and would peak later and lower.
3. First-order (linear) elimination: clearance and volume are constant and independent of concentration. Saturable elimination is out of scope.
4. Steady state with identical doses at a fixed interval — reached after roughly four to five half-lives. The model does not show the approach to steady state, and single-dose peaks are lower than the ones shown here.
5. Constant t½ and V_d over the interval: no change in renal or hepatic function, fluid shifts, or protein binding.
6. Total (not free) drug concentration; no tissue or effect-site compartment, and therefore no pharmacodynamics — the "response" here is concentration, not effect.
7. The trough floor (2 mg/L), the toxicity ceiling (20 mg/L) and the peak target band (12 to 20 mg/L) are **model parameters chosen to make the challenges teach**, not the reference range of any real agent. They are three distinct thresholds and no two of them may be described as "the therapeutic window"; the trough floor governs the whole interval, the peak band governs the peak alone.

The simplest defensible model was chosen deliberately: an IV-bolus steady-state one-compartment model is the standard first model in every pharmacokinetics text, its five relations are all dimensionally checkable by hand, and every added realism (absorption, two compartments, infusion time) would add parameters without adding insight into the relationship the objective names.

### Dimensional check

| Quantity | Expression | Units in | Units out |
| --- | --- | --- | --- |
| Elimination rate | ln 2 / t½ | dimensionless / h | **1/h** ✓ |
| Distribution volume | weight × V_d per kg | kg × L/kg | **L** ✓ |
| Exponent | k · τ | (1/h) × h | **dimensionless** ✓ (required — `exp` takes a pure number) |
| Accumulation factor | 1 / (1 − e^(−kτ)) | dimensionless | **dimensionless (ratio)** ✓ |
| Peak concentration | (D / V_d) × R | mg / L × dimensionless | **mg/L** ✓ |
| Trough concentration | C_max × e^(−kτ) | mg/L × dimensionless | **mg/L** ✓ |

mg/L is numerically identical to µg/mL, which is the unit most clinical references print; the model uses mg/L so that the arithmetic from a milligram dose and a litre volume is visible without a conversion step.

**Behavioural sanity, provable at any input point:** k > 0 and τ > 0, so 0 < e^(−kτ) < 1, so R > 1 (a repeated dose always accumulates) and 0 < trough < peak. The denominator 1 − e^(−kτ) can never be zero for finite positive k and τ, so there is no division-by-zero point anywhere in the declared input ranges — unlike Break-Even Studio, this model has no singularity.

## 6. Witness vectors

Each vector is a complete input assignment, on-grid for every slider step and inside every declared range. Values are those the real interpreter produces evaluating the outputs in declaration order.

**Challenge 1 — trough at least 2 mg/L**

```json
{ "dose": 500, "dosing_interval": 8, "patient_weight": 70, "half_life": 4, "volume_per_kilogram": 0.3 }
```
elimination rate 0.1733 /h · distribution volume 21.00 L · accumulation 1.333 · peak 31.75 · **trough 7.94 ≥ 2** ✓

**Challenge 2 — peak at most 20 mg/L**

```json
{ "dose": 300, "dosing_interval": 8, "patient_weight": 70, "half_life": 4, "volume_per_kilogram": 0.3 }
```
accumulation 1.333 · **peak 19.05 ≤ 20** ✓ · trough 4.76

**Challenge 3 — peak between 12 and 20 mg/L**

```json
{ "dose": 225, "dosing_interval": 6, "patient_weight": 60, "half_life": 5, "volume_per_kilogram": 0.35 }
```
elimination rate 0.1386 /h · distribution volume 21.00 L · accumulation 1.771 · **peak 18.97, inside [12, 20]** ✓ · trough 8.26

**Challenge 4 — accumulation factor between 1.5 and 3**

```json
{ "dose": 500, "dosing_interval": 8, "patient_weight": 70, "half_life": 8, "volume_per_kilogram": 0.3 }
```
τ equals one half life exactly, so e^(−kτ) = 0.5 and **accumulation = 2.000, inside [1.5, 3]** ✓ · peak 47.62 · trough 23.81

**All four at once** (the configuration a learner is being steered toward; useful as a single end-state assertion)

```json
{ "dose": 200, "dosing_interval": 8, "patient_weight": 70, "half_life": 6, "volume_per_kilogram": 0.3 }
```
elimination rate 0.1155 /h · distribution volume 21.00 L · **accumulation 1.658** ✓ · **peak 15.79** (≤ 20 ✓, inside [12, 20] ✓) · **trough 6.27 ≥ 2** ✓

Reachability of challenge 4 in closed form, for the reviewer: R lies in [1.5, 3] exactly when τ / t½ lies in [log₂1.5, log₂3] ≈ [0.585, 1.585]. Both ends are reachable inside the declared ranges (τ from 4 to 24 h, t½ from 1 to 12 h), so the challenge is satisfiable at many settings, not only at the witness.

## 7. Sources

- Malcolm Rowland and Thomas N. Tozer, *Clinical Pharmacokinetics and Pharmacodynamics: Concepts and Applications*, 4th ed. — one-compartment model, the half-life/rate-constant relation, and the steady-state accumulation factor.
- Leon Shargel and Andrew B. C. Yu, *Applied Biopharmaceutics and Pharmacokinetics*, 7th ed. — multiple-dosage regimens, C_max,ss and C_min,ss for intravenous bolus dosing.
- Michael E. Winter, *Basic Clinical Pharmacokinetics*, 5th ed. — volume of distribution expressed per kilogram of body weight, and the practical peak/trough framing used here.

These are textbook-standard relations, identical across the three references; no proprietary or institution-specific parameters are used. The agent and every threshold in the challenges are invented for the exercise, which the intro states in learner-visible text.

## 8. Images

None. This sandbox has no `visual` scene, no background image and no overlays. Image layers are editor-only by design and have no representation in the companion-doc format.

## 9. Transcription checklist

- [ ] `docs/exemplars/dose-response.companion.txt` is byte-for-byte the fenced block in §5 (comment lines may be prepended; nothing inside may change).
- [ ] `parseSandboxCompanionDoc` returns **zero** error-severity issues; `validateSandboxConfig` returns ok.
- [ ] The starter config in `starter-configs.ts` is structurally equal to the parse result (labels, units, decimals, ranges, chart axes and samples, challenge triples).
- [ ] Intro's first sentence is the exact educational-model statement in §5.
- [ ] Every input and every output carries a non-empty `units` string.
- [ ] Witness-vector test: each §6 vector evaluated through the real interpreter satisfies its challenge, and every value lies inside its input range.
- [ ] Dimensional sanity test: at the all-four vector, peak > trough > 0.
