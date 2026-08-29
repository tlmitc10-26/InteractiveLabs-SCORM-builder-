# Content brief: Break-Even Studio

**Slug:** `break-even-studio` · **Engine:** param-sandbox · **Standalone** (business / managerial accounting)
**Authored through:** the sandbox companion-doc format (spec §5). The doc in §5 of this brief is the source of truth; the starter config is its parse result.
**Status:** content complete; transcribe verbatim, invent nothing.

---

## 1. Learning objective

Learner-visible, appears in the interactive's intro:

> By the end of this activity you will be able to find a price, cost and volume combination that makes a small business viable, and explain why raising the price and raising the volume are not interchangeable ways of getting there.

## 2. Discipline pattern

Cost-volume-profit is the first genuinely load-bearing model in a business curriculum, and it is almost always taught as three formulas students memorise and apply to problems with one right answer. What the model is actually *for* is exploring a feasible region: several combinations of price, cost and volume clear break-even, they are not equally realistic, and the constraint that rules most of them out is the market rather than the arithmetic. A sandbox with challenges that push in different directions — be profitable, but do not price above what this market bears, and break even inside the room you actually have — turns a formula sheet into the judgment the formula exists to support. This is the highest-transfer sandbox pattern in the library: the identical structure carries unit economics in a marketing course, staffing ratios in health administration, and load calculations in engineering, and it is the one faculty most often recognise as something they already teach badly.

## 3. Notation for transcription

- The companion doc in §5 is authored by hand and imported through `parseSandboxCompanionDoc`. It must parse with **zero** error-severity issues, and the parsed config becomes the committed starter.
- Ids are what `slugify` produces from the labels (`Unit cost` → `unit_cost`, `Seats to break even` → `seats_to_break_even`); the witness vectors in §6 are keyed by id.
- Formulas are written in **label** form. Note that `Contribution margin ratio` and `Contribution margin` are both labels, one containing the other: this is intentional and exercises the format's longest-label-first resolution rule. Do not rename them to dodge it.
- Labels avoid hyphens, parentheses, `$` and the token ` vs `. In particular the spec's normative example uses `Break-even units`, whose hyphen the format flags as a risky label; this exemplar uses `Seats to break even` instead, which is why the doc imports with no header warnings.
- No formula functions are used at all — only `+ - * /` and parentheses.

## 4. Configuration summary

| Field | Value |
| --- | --- |
| `title` | Break-Even Studio |
| inputs | 4 sliders |
| outputs | 4 |
| charts | 2 |
| challenges | 4 |
| `layout` | `side` (schema default) |

**The situation (learner-facing framing):** a small community ceramics studio sells seats in monthly workshops. Each seat consumes clay, glaze and kiln firing; rent, the kiln lease, insurance and base staffing are the same every month whether one person books or three hundred do.

**Inputs**

| id | label | type | units | min | max | step | default |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `price` | Price | slider | $ per seat | 20 | 150 | 5 | 45 |
| `unit_cost` | Unit cost | slider | $ per seat | 5 | 60 | 1 | 18 |
| `fixed_costs` | Fixed costs | slider | $ per month | 2000 | 20000 | 250 | 9000 |
| `volume` | Volume | slider | seats per month | 0 | 800 | 10 | 250 |

**Outputs** (declaration order matters — each may reference inputs and *earlier* outputs only)

| # | id | label | units | decimals | formula (label form) |
| --- | --- | --- | --- | --- | --- |
| 1 | `contribution_margin` | Contribution margin | $ per seat | 2 | `Price - Unit cost` |
| 2 | `contribution_margin_ratio` | Contribution margin ratio | percent | 2 | `Contribution margin / Price * 100` |
| 3 | `seats_to_break_even` | Seats to break even | seats | 0 | `Fixed costs / Contribution margin` |
| 4 | `monthly_profit` | Monthly profit | $ per month | 2 | `Contribution margin * Volume - Fixed costs` |

**Charts**

| id (generated) | title | x input | y output | samples |
| --- | --- | --- | --- | --- |
| `monthly_profit_vs_volume` | Monthly profit across seat volume | `volume` | `monthly_profit` | 40 |
| `seats_to_break_even_vs_price` | Seats needed to break even across prices | `price` | `seats_to_break_even` | 40 |

**Challenges**

| # | learner text | output | comparator | value(s) |
| --- | --- | --- | --- | --- |
| 1 | Get the studio to a profit: monthly profit of at least one dollar. | `monthly_profit` | `gte` | 1 |
| 2 | Comparable studios in this market cannot sustain a contribution margin above 55 percent of the seat price. Keep the ratio at or below 55. | `contribution_margin_ratio` | `lte` | 55 |
| 3 | The studio can seat 300 people a month. Get the seats needed to break even down to 300 or fewer. | `seats_to_break_even` | `lte` | 300 |
| 4 | Find a plan that is comfortably rather than barely profitable: monthly profit from 1500 to 6000 dollars. | `monthly_profit` | `between` | 1500, 6000 |

The four pull against each other on purpose. Challenge 1 alone is trivially met by raising the price; challenge 2 caps how far the price can outrun the unit cost; challenge 3 forces attention onto fixed costs and margin together; challenge 4 rules out the barely-solvent solutions. There is a feasible region satisfying all four — §6 gives a point in it — and finding it requires moving price *and* volume rather than either one.

**State at the default input values:** contribution margin $27.00 per seat, ratio 60.00 percent, seats to break even 333, monthly profit −$2,250.00. **Zero** of the four challenges are satisfied at load, so the activity opens with the studio losing money, which is the intended starting condition.

## 5. Content — the companion doc

This is the exact text of `docs/exemplars/break-even-studio.companion.txt`. `INTRO:` is one physical line.

```
TITLE: Break-Even Studio
INTRO: A small community ceramics studio sells seats in monthly workshops. Every seat costs something in clay, glaze and firing; the rent, the kiln lease and the insurance cost the same whether one person books or three hundred do. By the end of this activity you will be able to find a price, cost and volume combination that makes the studio viable, and explain why raising the price and raising the volume are not interchangeable ways of getting there. Move the sliders until all four challenges are met at the same time.

INPUT: Price (slider, $ per seat, 20 to 150, step 5, start 45)
INPUT: Unit cost (slider, $ per seat, 5 to 60, step 1, start 18)
INPUT: Fixed costs (slider, $ per month, 2000 to 20000, step 250, start 9000)
INPUT: Volume (slider, seats per month, 0 to 800, step 10, start 250)

OUTPUT: Contribution margin ($ per seat, 2 decimals) = Price - Unit cost
OUTPUT: Contribution margin ratio (percent, 2 decimals) = Contribution margin / Price * 100
OUTPUT: Seats to break even (seats, 0 decimals) = Fixed costs / Contribution margin
OUTPUT: Monthly profit ($ per month, 2 decimals) = Contribution margin * Volume - Fixed costs

CHART: Monthly profit vs Volume (40 samples, titled Monthly profit across seat volume)
CHART: Seats to break even vs Price (40 samples, titled Seats needed to break even across prices)

CHALLENGE: Get the studio to a profit: monthly profit of at least one dollar. -> Monthly profit at least 1
CHALLENGE: Comparable studios in this market cannot sustain a contribution margin above 55 percent of the seat price. Keep the ratio at or below 55. -> Contribution margin ratio at most 55
CHALLENGE: The studio can seat 300 people a month. Get the seats needed to break even down to 300 or fewer. -> Seats to break even at most 300
CHALLENGE: Find a plan that is comfortably rather than barely profitable: monthly profit from 1500 to 6000 dollars. -> Monthly profit between 1500 and 6000
```

### The model

Standard cost-volume-profit, in the form every managerial accounting text presents it:

- Contribution margin per unit: **cm = p − v**
- Contribution margin ratio: **cm / p**, expressed as a percentage
- Break-even quantity: **Q\* = F / cm**
- Operating profit: **π = cm · Q − F**

**Assumptions, stated because they are the model's actual content:**

1. Linear cost behaviour over the relevant range: variable cost per seat is constant and fixed costs do not step. In reality a fourth kiln firing or a second instructor would create a step; the model has no step, which is exactly what makes the 300-seat room constraint in challenge 3 a *separate* constraint rather than something the arithmetic already knows.
2. One product. A studio with workshops, memberships and firing services would need a weighted-average contribution margin.
3. Everything produced is sold; no inventory, so revenue and volume move together.
4. Price is independent of volume — the model does not contain a demand curve. Challenge 2 is the stand-in for one, imposing as a rule what a demand curve would impose as a relationship.
5. Costs and price are per month and nominal; no taxes, no interest, no seasonality.

### Dimensional check

| Quantity | Expression | Units in | Units out |
| --- | --- | --- | --- |
| Contribution margin | p − v | $/seat − $/seat | **$/seat** ✓ (both terms per seat — the subtraction is only meaningful because they share units) |
| Contribution margin ratio | (cm / p) × 100 | ($/seat) / ($/seat) | **dimensionless, scaled to percent** ✓ |
| Seats to break even | F / cm | ($/month) / ($/seat) | **seats/month** ✓ — displayed as "seats", read as seats per month |
| Monthly profit | cm · Q − F | ($/seat)(seats/month) − $/month | **$/month** ✓ |

Both terms of the profit expression reduce to $/month, which is the check that matters: it is the step students most often get wrong by multiplying a monthly fixed cost by a volume.

### Validity domain and the deliberate singularity

The model is meaningful for **Price > Unit cost**. At Price = Unit cost the contribution margin is zero and `Seats to break even` divides by zero; the interpreter raises a formula error rather than returning infinity, and the runtime drops that point instead of drawing it. Below the crossover the margin is negative and break-even goes negative, which is arithmetically fine and economically meaningless — no volume rescues a seat sold below its own cost.

This is visible on the second chart. Sweeping Price from 20 to 150 in 40 samples, the sampled prices are 20, 23.33, 26.67, … and one of them coincides with the unit cost whenever the learner sets Unit cost to a value on that grid (for example 40). The curve then has a gap at that price and rises steeply on either side of it. Keep this. A learner who watches break-even blow up as the price approaches the unit cost has learned the most useful thing on the chart, and the exemplar-content test asserts the behaviour by catching the per-point formula error rather than treating it as a defect.

## 6. Witness vectors

Each vector is a complete input assignment, on-grid for every slider step and inside every declared range.

**Challenge 1 — monthly profit at least $1**

```json
{ "price": 45, "unit_cost": 18, "fixed_costs": 9000, "volume": 400 }
```
contribution margin 27.00 · ratio 60.00 · seats to break even 333 · **monthly profit 1800.00 ≥ 1** ✓

**Challenge 2 — contribution margin ratio at most 55 percent**

```json
{ "price": 45, "unit_cost": 21, "fixed_costs": 9000, "volume": 250 }
```
contribution margin 24.00 · **ratio 53.33 ≤ 55** ✓ · seats to break even 375 · monthly profit −3000.00

**Challenge 3 — seats to break even at most 300**

```json
{ "price": 60, "unit_cost": 28, "fixed_costs": 9000, "volume": 250 }
```
contribution margin 32.00 · ratio 53.33 · **seats to break even 281.25 ≤ 300** ✓ (displayed 281) · monthly profit −1000.00

**Challenge 4 — monthly profit between $1,500 and $6,000**

```json
{ "price": 60, "unit_cost": 28, "fixed_costs": 9000, "volume": 350 }
```
contribution margin 32.00 · ratio 53.33 · seats to break even 281.25 · **monthly profit 2200.00, inside [1500, 6000]** ✓

**All four at once** (the feasible point the challenges steer toward)

```json
{ "price": 60, "unit_cost": 28, "fixed_costs": 9000, "volume": 350 }
```
**ratio 53.33 ≤ 55** ✓ · **seats to break even 281.25 ≤ 300** ✓ · **profit 2200.00 ≥ 1** ✓ · **profit inside [1500, 6000]** ✓

The challenge-4 witness and the all-four witness are the same point, deliberately: it is the cleanest demonstration that the four constraints have a non-empty intersection, and it is reached by raising the price *and* the volume while raising the unit cost — which is the reasoning the challenges exist to force.

**Comparator note:** the runtime compares the raw computed value, not the rounded display value, so challenge 3 is satisfied at 281.25 even though the readout shows 281 (`decimals: 0`). Tests must evaluate the formula chain rather than parse the display string.

## 7. Sources

- Ray H. Garrison, Eric W. Noreen and Peter C. Brewer, *Managerial Accounting* — cost-volume-profit analysis: contribution margin per unit, contribution margin ratio, break-even in units, and the target-profit form of the same equation.
- Charles T. Horngren, Srikant M. Datar and Madhav V. Rajan, *Cost Accounting: A Managerial Emphasis* — the CVP assumption set reproduced above (linearity in the relevant range, single product or constant sales mix, production equals sales, price independent of volume).

These relations are identical in every managerial accounting text; no proprietary data or real business is referenced. The studio, its costs and the 55 percent market constraint are invented for the exercise.

## 8. Images

None. This sandbox has no `visual` scene, no background image and no overlays.

## 9. Transcription checklist

- [ ] `docs/exemplars/break-even-studio.companion.txt` is byte-for-byte the fenced block in §5 (comment lines may be prepended; nothing inside may change).
- [ ] `parseSandboxCompanionDoc` returns **zero** error-severity issues; `validateSandboxConfig` returns ok.
- [ ] The starter config in `starter-configs.ts` is structurally equal to the parse result (labels, units, decimals, ranges, chart axes and samples, challenge triples).
- [ ] `Contribution margin ratio` resolves to itself and not to `Contribution margin` in output 2's formula — assert the parsed formula references `contribution_margin` exactly once and the ratio output's id nowhere.
- [ ] Every input and every output carries a non-empty `units` string.
- [ ] Witness-vector test: each §6 vector evaluated through the real interpreter satisfies its challenge, and every value lies inside its input range.
- [ ] Division-by-zero at Price = Unit cost is handled per-point (caught, not fatal) rather than being designed away.
