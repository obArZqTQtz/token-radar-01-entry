# Token Launch Radar — fitted comps curve, blind-tested, farm plans netted to the dollar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/towson888-code/token-radar-01-entry/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/towson888-code/token-radar-01-entry/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch values are **fitted** to the snapshot's own traded protocols — a log-log size curve of market cap on TVL — and **tested blind**: leave-one-out median error ×3.65, blind holdout ×3.72, walk-forward ×2.17. Every farm plan is **netted to the dollar**: cost, expected value per farmer, break-even launch value and $/hour, with a farm / thin / skip verdict on every row.

A token launch radar: it reads a sealed DefiLlama snapshot of 758 protocols, finds the ones that record no token, ranks them by what their launch would be worth, and hands in a web dashboard with the board, a detail view for every protocol, and the steps to farm it.

## The model (radar-5)

One formula, the same for every row, from the snapshot's own figures — never a hand-picked list of names. The base is a size curve **fitted** to the snapshot's own traded protocols, not a guessed multiple:

- **Curve** — log market cap = 8.998 + 0.405 × log TVL: a pooled log-log regression on the 94 traded protocols in the snapshot that are not wrappers, bridges or exchanges (R² 0.10). A launch is priced at what traded protocols of its size are worth.
- **Growth** — 7-day TVL change, clamped −50%…+150%, × (1 + growth): its momentum, passed through 1:1 — a 50% weekly gain is worth 50% more implied value.
- **Maturity** — days listed with no token, up to 4 years, × (0.5 + age/1460 × 0.5): a launch earned over years is worth more than one from last month.
- **Breadth** — chains, × (1 + 0.10 × min(chains − 1, 4)): how widely the token would distribute, 10% per extra chain up to five.

Implied value = curve × growth × maturity × breadth. Wrapped, staked, bridged and exchange products are left out: they are a token that already trades, in another form.

## How the curve was tested

The fit is validated three ways, all computed from the snapshot at run time and stated on the dashboard:

- **Leave-one-out** — refit without each of the 94 traded protocols and predict it: median error ×3.65, 36% within 2×.
- **Blind holdout** — the top 20% of traded protocols by a deterministic slug hash, fitted without them: median error ×3.72, 40% within 2×.
- **Walk-forward** — fit on the older half by listing date, predict the newer half: median error ×2.17, 47% within 2×.

Per-category curves were tested and did not beat the pooled curve out of sample (leave-one-out median error ×5.69 against the pooled curve's ×3.65), so the board uses the one curve the data supports. Every row also carries the range its rank takes across the 94 leave-one-out refits. The curve is a rough anchor, not a prediction — TVL explains only 10% of market-cap variation across traded protocols — but it replaces a guessed multiple with the one the market's own traded protocols imply.

## Farm economics (radar-5)

Every row is netted to the dollar from its own plan and its fitted value, and carries a verdict — **farm, thin or skip** — that follows from the numbers, never from a name:

- **Cost** — the plan's gas ($3 to set up, $4 or $8 for the main deposit, $2 a week over the hold) plus the yield forgone on the capital at 5% a year. The capital itself comes back at unwind, so it is not a cost.
- **Expected value per farmer** — 10% of the launch's implied value (past launches allocate 5–15% to farmers; the board uses the 10% midpoint), split among an estimated 50,000 farmers.
- **Break-even launch value** — cost × 50,000 ÷ 10%: the launch has to be worth that much for one farmer's share to cover the cost. On this board it runs from $7,890,000 to $12,480,000.
- **Verdict** — farm when the hour pays at least $20 and the expected value is at least twice the cost; thin when the value clears the cost but not the bar; skip when it does not cover the cost. On this board: 5 farm, 30 thin, 143 skip.

The farmer count is one flat estimate for every row, not the protocol's TVL divided by a position: TVL is whale-dominated, so that division would imply 100,000 to 18 million farmers, which no launch has — the board uses 50,000 for every row, so the verdict compares launches on their value. Worked out for the top row, Steakhouse Financial: cost $20.19 (gas $19.57 + $0.62 forgone yield on $150) over 1.30 hours, expected $100.80 per farmer (10% of $50,397,598 ÷ 50,000), net $80.61, $62.01 an hour — **farm**.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

`main.ts` (Node 22, standard library only) writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to the output directory. No network, no dependencies. Run it twice and the bytes are identical.

Open `out/dashboard/index.html` to see the radar: a chart of total implied value by category sits above the board — Risk Curators hold about a quarter of the board's implied value — and a chart of the four factors behind the top 10 rows; the board is sortable and filterable, every row opens a detail view with its four model factors worked out, its rank range across the curve's refits, its farm economics (cost, expected value per farmer, break-even launch value, $/hour and a farm/thin/skip verdict), and a six-step farm plan with costs and times. A link to a filtered view (`#cat=Lending`) lands on the filtered table.

---

<sub>Entered on [make.fun](https://make.fun/?ref=7yd20ms9&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
