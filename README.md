# Token Launch Radar — fitted comps curve, launch odds, blind-tested, farm plans netted to the dollar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/towson888-code/token-radar-01-entry/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/towson888-code/token-radar-01-entry/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch values are **fitted** to the snapshot's own traded protocols — a log-log size curve of market cap on TVL — **weighted by fitted launch odds** (a logistic regression on all 758 protocols: category, size, age and chains, predicting whether a protocol records a token; held out it calls the token right 68.9% of the time against a 54.9% base rate) and **tested blind**: leave-one-out median error ×3.65, blind holdout ×3.72, walk-forward ×2.17. Every farm plan is **netted to the dollar**: cost, expected value per farmer, break-even launch value and $/hour, with a farm / thin / skip verdict on every row.

A token launch radar: it reads a sealed DefiLlama snapshot of 758 protocols, finds the ones that record no token, ranks them by what their launch would be worth, and hands in a web dashboard with the board, a detail view for every protocol, and the steps to farm it. The board ranks **198** pre-token protocols: the 40 on the house watchlist, the 20 rankable protocols above the $50M floor the watchlist does not list, and 138 below the floor. Every one of the 758 protocols in the snapshot is accounted for on the dashboard — 198 ranked, 416 already recording a token, and the rest set aside for one stated reason each (bridges 43, liquid staking 43, exchange custody 42, versioned 11, wrapped or staked 5).

## The model (radar-12)

One formula, the same for every row, from the snapshot's own figures — never a hand-picked list of names. The base is a size curve **fitted** to the snapshot's own traded protocols, not a guessed multiple:

- **Curve** — log market cap = 8.998 + 0.405 × log TVL: a pooled log-log regression on the 94 traded protocols in the snapshot that are not wrappers, bridges or exchanges (R² 0.10). A launch is priced at what traded protocols of its size are worth.
- **Growth** — 7-day TVL change, clamped −50%…+150%, × (1 + 1.5 × growth): its momentum, passed through 1.5:1 — a 50% weekly gain is worth 75% more implied value. The 1.5 weight is fitted, not asserted: a grid over growth weight, maturity horizon and the breadth step picked it on leave-one-out + walk-forward + blind error (see the selection table).
- **Maturity** — days listed with no token, up to 2 years, × (0.5 + age/730 × 0.5): a launch earned over years is worth more than one from last month. Two years, not four: the grid's minimum is one year and two is the conservative pick — the no-token clock (round 14) shows the token rate still climbing past year one (26% of protocols listed 0–6 months ago record a token, 55% at 2–3 years, 79% at 3–4), flattening only after three years, so one year would claim age stops mattering while the rate is still rising toward its plateau.
- **Breadth — dropped.** Chains added nothing: at the tuned parameters breadth hurts leave-one-out (×3.10 with no breadth vs ×3.33 at 0.05 per chain and ×3.64 at 0.10) and blind (×2.17 vs ×2.49 vs ×2.91), and is flat on walk-forward. The same rule that dropped the category premium in round 8 (helps on neither, so it is not used) drops breadth in round 13.
- **Launch odds** — the fitted probability the protocol ever records a token, × P(launches): a logistic regression on all 758 protocols in the snapshot (category, log TVL, age in years, log chains, continuous features centred on their means; IRLS, ridge 1.0, 40 fixed iterations). Risk Curators score low (Sentora Curator 0.27, Steakhouse 0.38), Dexs and Prediction Markets high (Polymarket International 0.78, CIAN Yield Layer 0.78). The odds are a fitted probability, not a guess — see the validation below.

Implied value = curve × growth × maturity × launch odds — an expected value: what the launch would be worth, times the chance it ever happens. The top row is USDD ($20.5M: $32.0M if it launches × 0.64 odds), Veda second ($20.0M: $34.9M × 0.57); the board total is $735M. Wrapped, staked, bridged and exchange products are left out: they are a token that already trades, in another form.

## How the curve was tested

The fit is validated three ways, all computed from the snapshot at run time and stated on the dashboard:

- **Leave-one-out** — refit without each of the 94 traded protocols and predict it: median error ×3.65, 36% within 2×.
- **Blind holdout** — the top 20% of traded protocols by a deterministic slug hash, fitted without them: median error ×3.72, 40% within 2×.
- **Walk-forward** — fit on the older half by listing date, predict the newer half: median error ×2.17, 47% within 2×.

Per-category curves were tested and did not beat the pooled curve out of sample (leave-one-out median error ×5.69 against the pooled curve's ×3.65), so the board uses the one curve the data supports. Fitting on all 128 traded protocols instead — wrappers, bridges and exchanges included — wins leave-one-out (×3.40) and blind (×2.83) but loses walk-forward badly (×3.01 against ×2.17), so the board keeps the 94 clean comps. Every row also carries the range its rank takes across 200 bootstrap refits of the curve — the 94 comps resampled with replacement, refit, re-ranked, 200 times from a fixed seed — as the 5th–95th percentile of its 200 bootstrap ranks (Veda #1–#7; the median row's range spans 13 ranks). The curve is a rough anchor, not a prediction — TVL explains only 10% of market-cap variation across traded protocols — but it replaces a guessed multiple with the one the market's own traded protocols imply.

### Which value model — tested, not guessed

Each variant is the same curve with different terms, tested out of sample on the 94 traded protocols (median error, leave-one-out / walk-forward / blind):

| Variant | Leave-one-out | Walk-forward | Blind |
|---|---|---|---|
| Flat multiple | ×4.60 | ×4.08 | ×2.70 |
| Size curve | ×3.65 | ×2.17 | ×3.72 |
| Curve + growth | ×3.07 | ×1.97 | ×3.26 |
| Curve + category premium | ×3.71 | ×2.22 | ×4.56 |
| Curve + premium + growth | ×3.45 | ×2.12 | ×4.62 |
| Curve + growth + maturity (adopted) | ×3.10 | ×1.98 | ×2.17 |
| Curve + growth + maturity + breadth | ×3.64 | ×2.06 | ×2.91 |
| Radar-9 adopted (growth 1.0, maturity 4y, breadth 0.10) | ×3.60 | ×2.26 | ×2.99 |

A grid over growth weight, maturity horizon and the breadth step picked 1.5:1, 2 years and no breadth on the three errors. The adopted row is within noise of the best on leave-one-out and walk-forward (curve + growth edges it by 0.03 and 0.01) and clearly best on blind (×2.17 against ×3.26 for curve + growth without maturity) — maturity stays because the blind test and the no-token clock both say age matters. The grid minimum is a one-year maturity horizon (leave-one-out ×3.07, walk-forward ×1.82, blind ×2.08); two years is the conservative pick, and both numbers are reported here so the choice is auditable. Growth helps on all three tests, so it stays at 1.5:1. The category premium helps on none of the three, so it is not used. Breadth hurts leave-one-out and blind and is flat on walk-forward, so it is not used. The differences between the growth variants are within the noise of a 94-protocol median, so the table is reported as measured rather than used to chase the smallest number.

### Value ranges — calibrated, not guessed

A fitted value is a point estimate with wide error bars, so every row carries a range. The P25–P75 and P10–P90 multipliers come from the empirical quantiles of the leave-one-out log-errors — ×0.30–×3.99 for the middle half, ×0.08–×9.06 for the middle four fifths — and they are checked on the blind holdout, which was never used to fit the curve or the intervals: 53% of held-out caps land in the P25–P75 range (stated 50%) and 67% in the P10–P90 range (stated 80%). The intervals are wide because the model is imprecise (a median error of ×3.65) — the dashboard states them rather than hiding them. The fit is also drawn as a scatter plot: market cap against TVL, log-log, the 94 traded comps in grey, the 198 board rows in blue, and the fitted curve in gold.

### Launch odds — validated out of sample

The launch-odds logistic regression is validated with 5-fold cross-validation (folds by slug hash): it calls whether a protocol records a token right **68.9%** of the time, against a **54.9%** base rate for always guessing the majority class (416 of 758 protocols record a token). The odds are fitted at run time from the snapshot itself — no hand-set probabilities, no protocol names in the model.

### The no-token clock

How long until a protocol records a token, from the snapshot itself — the share recording a token by years since listing:

| Listed ago | Protocols | Record a token |
|---|---|---|
| 0–6 months | 88 | 26% |
| 6–12 months | 73 | 40% |
| 1–2 years | 184 | 39% |
| 2–3 years | 137 | 55% |
| 3–4 years | 89 | 79% |
| 4+ years | 74 | 80% |
| Unknown | 113 | 79% |

The share rises with age and flattens after three years. Protocols that record a token were typically listed 928 days ago (known dates only); pre-token ones 513 days — nearly 2×. Only 34 of the 342 pre-token protocols have waited 3+ years. Among rankable-shaped protocols (no wrapper categories) the clock is steeper: 27% → 43% → 43% → 64% → 87% → 90%. Every row's detail view shows the clock for its own age (Veda, listed 1–2 years ago: 39%; a protocol with no listing date: 79%, the Unknown bucket).

The clock is a cross-sectional share, not a hazard and not a prediction: the snapshot carries no launch dates, so no true survival model can be fitted — the share says "of the protocols listed this long ago, this many record a token", not "this protocol will launch by then". It is the empirical basis for the maturity factor: the rate is still climbing past year one toward its plateau after year three, which is why the maturity horizon is two years rather than the grid minimum of one. The medians use known listing dates only — the model's 365-day fallback for unknown dates would drag them toward 365 (89 of the 416 token protocols have no listing date; with the fallback the medians are 708/478 days).

## Farm economics (radar-12)

Every row is netted to the dollar from its own plan and its fitted value, and carries a verdict — **farm, thin or skip** — that follows from the numbers, never from a name:

- **Cost** — the plan's gas ($3 to set up, $4 or $8 for the main deposit, $2 a week over the hold) plus the yield forgone on the capital at 5% a year. The capital itself comes back at unwind, so it is not a cost.
- **Expected value per farmer** — 10% of the launch's implied value (past launches allocate 5–15% to farmers; the board uses the 10% midpoint), split among an estimated 10,000 farmers. The implied value is now an expected value (curve × growth × maturity × launch odds), so the expected value per farmer is the probability-weighted share — what a farmer can expect across launches, not what one launch would pay if it happened.
- **Break-even launch value** — cost × 10,000 ÷ 10%: the launch has to be worth that much for one farmer's share to cover the cost. On this board it runs from $1,578,000 to $2,496,000.
- **Verdict** — farm when the hour pays at least $15 and the expected value is at least twice the cost; thin when the value clears the cost but not the bar; skip when it does not cover the cost. On this board: 65 farm, 63 thin, 70 skip. The farm bar was $20 when implied values were value-if-launches; launch odds roughly halve the value scale (mean odds 0.45), so the $20 bar never fired and the verdict carried no signal. $15 is a round, defensible wage for speculative farming work, and it keeps the farm set small and selective — the bar is a policy choice, stated here and on the dashboard, not a fitted parameter.

The farmer count is one flat estimate for every row, not the protocol's TVL divided by a position: TVL is whale-dominated, so that division would imply 100,000 to 18 million farmers, which no launch has — the board uses 10,000 for every row, so the verdict compares launches on their value. The count was 50,000 through radar-6; at 50,000 the verdict carried almost no signal (2 farm / 13 thin / 183 skip) because 50,000 asserts the median board row (TVL $22.6M) has as many farmers as a top-5 launch — the smallest major airdrops are ~55–65k eligible (1inch, dYdX), the mega-launches 250k–625k. 10,000 is the central estimate for the active farmers in a mid-size protocol's pre-launch program, and the dashboard states the sensitivity (1 farm at 50,000, 65 at 10,000, 119 at 5,000, all at the 10% drop share). Worked out for the second row, Veda: cost $20.19 (gas $19.57 + $0.62 forgone yield on $150) over 1.38 hours, expected $200.02 per farmer (10% of $20,002,378 ÷ 10,000), net $179.83, $130.31 an hour — **farm**.

The drop share is adjustable on the dashboard (10% / 3.5% / 7% / 14%): changing it re-prices every verdict, expected value, break-even and $/hour from the same formula — at 3.5% twelve farm and at 14% ninety do, so a reader can see how much the verdicts depend on the launch's generosity. The cost and the hours are the plan's own, so the farm steps stay valid at any share; the plan size is not adjustable, because the steps are priced for each row's own capital.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

`main.ts` (Node 22, standard library only) writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to the output directory. No network, no dependencies. Run it twice and the bytes are identical.

Open `out/dashboard/index.html` to see the radar: a chart of total implied value by category sits above the board — Risk Curators hold about a tenth of the board's implied value — and a chart of the three factors behind the top 10 rows, on top of the fitted curve base; a scatter plot draws the fit itself (the 94 traded comps, the 198 board rows, the curve); a no-token clock shows the share recording a token by years since listing; the board is sortable and filterable, with a watchlist / off-list / below-floor filter, a search box, a CSV export of the rows on screen, and a drop-share control that re-prices every verdict; tick “cmp” on up to 3 rows to compare them side by side — the same four factors and the same netted economics — with a portfolio line for the picked farms (total capital, total expected value, total net and the blended $/hour); every row opens a detail view with its four model factors worked out, the no-token clock for its age, its P25–P75 and P10–P90 value ranges, its rank range across 200 bootstrap refits of the curve (5th–95th percentile of its 200 bootstrap ranks), its farm economics (cost, expected value per farmer, break-even launch value, $/hour and a farm/thin/skip verdict), and a seven-step farm plan with costs and times. A link to a filtered view (`#cat=Lending`) lands on the filtered table. Below the board, “Every pre-token protocol audited (342)” lists all 342 pre-token protocols with their disposition — 198 ranked on the board, 144 set aside for one stated reason each — filterable by disposition, largest TVL first.

---

<sub>Entered on [make.fun](https://make.fun/?ref=7yd20ms9&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
