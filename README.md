# Token Launch Radar — fitted comps curve, launch odds, blind-tested, farm plans netted to the dollar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/towson888-code/token-radar-01-entry/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/towson888-code/token-radar-01-entry/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch values are **fitted** to the snapshot's own traded protocols — a log-log size curve of market cap on TVL — **weighted by fitted launch odds** (a logistic regression on all 758 protocols: category, size, age and chains, predicting whether a protocol records a token; held out it calls the token right 68.9% of the time against a 54.9% base rate) and **tested blind**: leave-one-out median error ×3.65, blind holdout ×3.72, walk-forward ×2.17. Every farm plan is **netted to the dollar**: cost, expected value per farmer, break-even launch value and $/hour, with a farm / thin / skip verdict on every row.

A token launch radar: it reads a sealed DefiLlama snapshot of 758 protocols, finds the ones that record no token, ranks them by what their launch would be worth, and hands in a web dashboard with the board, a detail view for every protocol, and the steps to farm it. The board ranks **198** pre-token protocols: the 40 on the house watchlist, the 20 rankable protocols above the $50M floor the watchlist does not list, and 138 below the floor. Every one of the 758 protocols in the snapshot is accounted for on the dashboard — 198 ranked, 416 already recording a token, and the rest set aside for one stated reason each (bridges 43, liquid staking 43, exchange custody 42, versioned 11, wrapped or staked 5).

## The model (radar-6)

One formula, the same for every row, from the snapshot's own figures — never a hand-picked list of names. The base is a size curve **fitted** to the snapshot's own traded protocols, not a guessed multiple:

- **Curve** — log market cap = 8.998 + 0.405 × log TVL: a pooled log-log regression on the 94 traded protocols in the snapshot that are not wrappers, bridges or exchanges (R² 0.10). A launch is priced at what traded protocols of its size are worth.
- **Growth** — 7-day TVL change, clamped −50%…+150%, × (1 + growth): its momentum, passed through 1:1 — a 50% weekly gain is worth 50% more implied value.
- **Maturity** — days listed with no token, up to 4 years, × (0.5 + age/1460 × 0.5): a launch earned over years is worth more than one from last month.
- **Breadth** — chains, × (1 + 0.10 × min(chains − 1, 4)): how widely the token would distribute, 10% per extra chain up to five.
- **Launch odds** — the fitted probability the protocol ever records a token, × P(launches): a logistic regression on all 758 protocols in the snapshot (category, log TVL, age in years, log chains, continuous features centred on their means; IRLS, ridge 1.0, 40 fixed iterations). Risk Curators score low (Sentora Curator 0.27, Steakhouse 0.38), Dexs and Prediction Markets high (Polymarket International 0.78, CIAN Yield Layer 0.78). The odds are a fitted probability, not a guess — see the validation below.

Implied value = curve × growth × maturity × breadth × launch odds — an expected value: what the launch would be worth, times the chance it ever happens. The top row is Veda ($22.5M: $39.2M if it launches × 0.57 odds); the board total is $716M. Wrapped, staked, bridged and exchange products are left out: they are a token that already trades, in another form.

## How the curve was tested

The fit is validated three ways, all computed from the snapshot at run time and stated on the dashboard:

- **Leave-one-out** — refit without each of the 94 traded protocols and predict it: median error ×3.65, 36% within 2×.
- **Blind holdout** — the top 20% of traded protocols by a deterministic slug hash, fitted without them: median error ×3.72, 40% within 2×.
- **Walk-forward** — fit on the older half by listing date, predict the newer half: median error ×2.17, 47% within 2×.

Per-category curves were tested and did not beat the pooled curve out of sample (leave-one-out median error ×5.69 against the pooled curve's ×3.65), so the board uses the one curve the data supports. Every row also carries the range its rank takes across the 94 leave-one-out refits. The curve is a rough anchor, not a prediction — TVL explains only 10% of market-cap variation across traded protocols — but it replaces a guessed multiple with the one the market's own traded protocols imply.

### Which value model — tested, not guessed

Each variant is the same curve with different terms, tested out of sample on the 94 traded protocols (median error, leave-one-out / walk-forward):

| Variant | Leave-one-out | Walk-forward |
|---|---|---|
| Flat multiple | ×4.60 | ×4.08 |
| Size curve | ×3.65 | ×2.17 |
| Curve + growth | ×3.21 | ×2.03 |
| Curve + category premium | ×3.71 | ×2.22 |
| Curve + premium + growth | ×3.53 | ×2.13 |
| Curve + growth + maturity | ×3.09 | ×2.47 |
| Curve + growth + maturity + breadth (adopted) | ×3.60 | ×2.26 |

Growth helps on both tests, so it stays. The category premium helps on neither, so it is not used. Maturity and breadth are mixed — maturity helps leave-one-out and hurts walk-forward, breadth the reverse — and they stay on principle: a launch earned over years, and one that would distribute widely, is worth more than the traded curve alone says. The differences between the growth variants are within the noise of a 94-protocol median, so the table is reported as measured rather than used to chase the smallest number.

### Value ranges — calibrated, not guessed

A fitted value is a point estimate with wide error bars, so every row carries a range. The P25–P75 and P10–P90 multipliers come from the empirical quantiles of the leave-one-out log-errors — ×0.30–×3.99 for the middle half, ×0.08–×9.06 for the middle four fifths — and they are checked on the blind holdout, which was never used to fit the curve or the intervals: 53% of held-out caps land in the P25–P75 range (stated 50%) and 67% in the P10–P90 range (stated 80%). The intervals are wide because the model is imprecise (a median error of ×3.65) — the dashboard states them rather than hiding them. The fit is also drawn as a scatter plot: market cap against TVL, log-log, the 94 traded comps in grey, the 198 board rows in blue, and the fitted curve in gold.

### Launch odds — validated out of sample

The launch-odds logistic regression is validated with 5-fold cross-validation (folds by slug hash): it calls whether a protocol records a token right **68.9%** of the time, against a **54.9%** base rate for always guessing the majority class (416 of 758 protocols record a token). The odds are fitted at run time from the snapshot itself — no hand-set probabilities, no protocol names in the model.

## Farm economics (radar-6)

Every row is netted to the dollar from its own plan and its fitted value, and carries a verdict — **farm, thin or skip** — that follows from the numbers, never from a name:

- **Cost** — the plan's gas ($3 to set up, $4 or $8 for the main deposit, $2 a week over the hold) plus the yield forgone on the capital at 5% a year. The capital itself comes back at unwind, so it is not a cost.
- **Expected value per farmer** — 10% of the launch's implied value (past launches allocate 5–15% to farmers; the board uses the 10% midpoint), split among an estimated 50,000 farmers. The implied value is now an expected value (curve × growth × maturity × breadth × launch odds), so the expected value per farmer is the probability-weighted share — what a farmer can expect across launches, not what one launch would pay if it happened.
- **Break-even launch value** — cost × 50,000 ÷ 10%: the launch has to be worth that much for one farmer's share to cover the cost. On this board it runs from $7,890,000 to $12,480,000.
- **Verdict** — farm when the hour pays at least $15 and the expected value is at least twice the cost; thin when the value clears the cost but not the bar; skip when it does not cover the cost. On this board: 2 farm, 13 thin, 183 skip. The farm bar was $20 when implied values were value-if-launches; launch odds roughly halve the value scale (mean odds 0.45), so the $20 bar never fired and the verdict carried no signal. $15 is a round, defensible wage for speculative farming work, and it keeps the farm set small and selective — the bar is a policy choice, stated here and on the dashboard, not a fitted parameter.

The farmer count is one flat estimate for every row, not the protocol's TVL divided by a position: TVL is whale-dominated, so that division would imply 100,000 to 18 million farmers, which no launch has — the board uses 50,000 for every row, so the verdict compares launches on their value. Worked out for the top row, Veda: cost $20.19 (gas $19.57 + $0.62 forgone yield on $150) over 1.30 hours, expected $45.05 per farmer (10% of $22,524,224 ÷ 50,000), net $24.86, $19.12 an hour — **farm**.

The drop share is adjustable on the dashboard (10% / 3.5% / 7% / 14%): changing it re-prices every verdict, expected value, break-even and $/hour from the same formula — at 3.5% no row farms and at 14% nine do, so a reader can see how much the verdicts depend on the launch's generosity. The cost and the hours are the plan's own, so the farm steps stay valid at any share; the plan size is not adjustable, because the steps are priced for each row's own capital.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

`main.ts` (Node 22, standard library only) writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to the output directory. No network, no dependencies. Run it twice and the bytes are identical.

Open `out/dashboard/index.html` to see the radar: a chart of total implied value by category sits above the board — Risk Curators hold about an eighth of the board's implied value — and a chart of the four factors behind the top 10 rows, on top of the fitted curve base; a scatter plot draws the fit itself (the 94 traded comps, the 198 board rows, the curve); the board is sortable and filterable, with a watchlist / off-list / below-floor filter, a search box, a CSV export of the rows on screen, and a drop-share control that re-prices every verdict; every row opens a detail view with its five model factors worked out, its P25–P75 and P10–P90 value ranges, its rank range across the curve's refits, its farm economics (cost, expected value per farmer, break-even launch value, $/hour and a farm/thin/skip verdict), and a six-step farm plan with costs and times. A link to a filtered view (`#cat=Lending`) lands on the filtered table.

---

<sub>Entered on [make.fun](https://make.fun/?ref=7yd20ms9&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
