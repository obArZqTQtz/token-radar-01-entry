# token-radar-01-entry

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/towson888-code/token-radar-01-entry/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/towson888-code/token-radar-01-entry/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a sealed DefiLlama snapshot of 758 protocols, finds the ones that record no token, ranks them by what their launch would be worth, and hands in a web dashboard with the board, a detail view for every protocol, and the steps to farm it.

## The model (radar-3)

One formula, the same for every row, from the snapshot's own figures — never a hand-picked list of names:

- **Base** — TVL × 0.30: the size of the launch.
- **Growth** — 7-day TVL change, clamped −50%…+150%, × (1 + growth): its momentum, passed through 1:1 — a 50% weekly gain is worth 50% more implied value.
- **Maturity** — days listed with no token, up to 4 years, × (0.5 + age/1460 × 0.5): a launch earned over years is worth more than one from last month.
- **Breadth** — chains, × (1 + 0.10 × min(chains − 1, 4)): how widely the token would distribute, 10% per extra chain up to five.

Implied value = base × growth × maturity × breadth. Wrapped, staked, bridged and exchange products are left out: they are a token that already trades, in another form.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

`main.ts` (Node 22, standard library only) writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to the output directory. No network, no dependencies. Run it twice and the bytes are identical.

Open `out/dashboard/index.html` to see the radar: a chart of total implied value by category sits above the board — Risk Curators hold nearly half of the board's implied value — the board is sortable and filterable, every row opens a detail view with its four model factors worked out and a six-step farm plan with costs and times. A link to a filtered view (`#cat=Lending`) lands on the filtered table.

---

<sub>Entered on [make.fun](https://make.fun/?ref=7yd20ms9&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
