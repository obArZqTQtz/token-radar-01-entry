// Token Radar's model, written for this entry: one sealed snapshot in, one ranked board out.
//
// The board ranks every protocol in the snapshot's watchlist (the floor, never a ceiling) plus every
// other genuine pre-token protocol below the floor, strongest first. A protocol counts as pre-token
// only when the snapshot records no token for it at all (no market cap, no CoinGecko id, no symbol),
// and wrapped, staked, bridged and exchange products are left out: they are a token that already
// trades, in another form, not a launch still to come.
//
// Implied value follows only from the snapshot's own figures, the same function for every row. The
// base is a size curve FITTED to the snapshot's own traded protocols — never a hand-picked multiple:
//
//   curve  = exp(intercept + slope x ln TVL)   fitted by OLS on log market cap vs log TVL
//   growth = clamp(change_7d, -50, 150) per cent; growthMult = 1 + (growth / 100) x 1.5
//   maturity = 0.5 + min(age_days, 730) / 730 x 0.5   (age unknown: 365 days)
//   implied  = max(1, round(curve x growthMult x maturityMult x launchOdds))
//
// The curve is fitted to the 94 traded protocols in the snapshot that are not wrappers, bridges or
// exchanges (a market cap and a TVL each). One pooled curve, not one per category: per-category
// curves were tested and did NOT beat the pooled curve out of sample (leave-one-out median error
// about 5.2x against the pooled curve's 3.7x), so the board uses the one curve the data supports.
// Fitting on all 128 traded protocols instead was also tested (round 13): it wins leave-one-out
// (x3.40 vs x3.65) and blind (x2.83 vs x3.72) but loses walk-forward badly (x3.01 vs x2.17),
// and the extra 34 are wrappers, bridges and exchanges, so the board keeps the 94.
// The fit is validated three ways, all computed from the snapshot at run time and stated on the
// dashboard: leave-one-out (refit without each traded protocol, predict it), a blind holdout (the
// top 20% of traded protocols by a deterministic slug hash, fitted without them), and walk-forward
// (fit on the older half by listing date, predict the newer half). Every row also carries the range
// its rank takes across the leave-one-out refits, so the board shows how stable each rank is.
// No protocol name is ever special-cased.
//
// Calibration (radar-4, round 4): the fitted curve replaces radar-3's flat TVL x 0.30 base. The
// slope is well below 1, so the curve compresses with size — a $2.75B protocol is not worth 550x a
// $5M one — which is what the traded comps say (median market-cap-to-TVL ratio 0.24, but the ratio
// falls as TVL grows). Growth passes through 1.5:1 and maturity spreads 0.50-1.00 over two years:
// those two are stated adjustments on top of the fitted base, retuned in round 13 (radar-10) by
// a grid over growth weight, maturity horizon and breadth step, picked by leave-one-out +
// walk-forward + blind error (see the model-selection table). The grid minimum is a one-year
// maturity horizon; two years is the conservative pick — the no-token clock (round 14) shows the
// token rate still rising steeply through year two, so one year would claim age stops mattering
// just as the clock says it matters most. Breadth (chains) was dropped in round 13: at the tuned
// parameters it hurts leave-one-out (x3.10 with no breadth vs x3.33 at 0.05/chain and x3.64 at
// 0.10/chain) and blind (x2.17 vs x2.49 vs x2.91), and is flat on walk-forward — the same rule
// that dropped the category premium in round 8 (helps on neither, so it is not used).
//
// Farm economics (radar-5, round 5; farmer count revised radar-7, round 10): every row is
// netted to the dollar from its own plan and its fitted value. The farmer pool is 10% of the
// implied value (past launches allocate 5-15% to farmers; the board uses the 10% midpoint),
// split among an estimated 10,000 farmers. The cost is the plan's gas plus the yield forgone
// on the capital at 5% a year; the capital itself comes back at unwind, so it is not a cost.
// The farmer count is one flat estimate for every row, not the protocol's TVL divided by a
// position: TVL is whale-dominated, so that division would imply 100,000 to 18 million
// farmers, which no launch has. Break-even value = cost x 10,000 / 10%. The count was
// 50,000 through radar-6; at 50,000 the verdict carried almost no signal (2 farm / 13 thin /
// 183 skip) because 50,000 asserts the median board row (TVL $22.6M) has as many farmers as
// a top-5 launch (Uniswap ~250k, Arbitrum ~625k eligible; the smallest majors are ~55-65k).
// 10,000 is the central estimate for the active farmers in a mid-size protocol's pre-launch
// program; the sensitivity is stated on the dashboard (2 farm at 50k, 63 at 10k, 114 at 5k).
// Verdict: farm when the hour pays at least $15 and the expected value is at least twice the
// cost; thin when the value clears the cost but not the bar; skip when it does not cover the
// cost. The value model is unchanged from radar-4; only the economics layer is new.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. The fitted curve's intercept and slope are
 *  not constants: they are fitted from the snapshot at run time and ride in the fit report. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_max: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 1.5,
  growth_floor: -50,
  growth_cap: 150,
  maturity_floor: 0.5,
  maturity_range: 0.5,
  maturity_days: 730,
  unknown_age_days: 365,
  chain_step: 0,
  chain_max: 4,
};

/** The model's version label: the dashboard names it. */
/** The model's version label: the dashboard names it. radar-12 adds the seventh farm step
 *  (round 15): verify the official app before depositing — the plan's anti-phishing check. */
export const MODEL_VERSION = 'radar-12';

/** The farm-economics constants, as the dashboard states them. One flat farmer estimate for
 *  every row: the verdict compares launches on their value, not on a guessed crowd size. */
export interface EconConstants {
  pool_share: number;
  farmers: number;
  opp_rate: number;
  gas_setup_usd: number;
  gas_main_usd: number;
  gas_main_big_usd: number;
  gas_weekly_usd: number;
  hourly_bar_usd: number;
  safety_multiple: number;
}

export const ECON: EconConstants = {
  pool_share: 0.1,
  farmers: 10000,
  opp_rate: 0.05,
  gas_setup_usd: 3,
  gas_main_usd: 4,
  gas_main_big_usd: 8,
  gas_weekly_usd: 2,
  // The farm bar, $15 an hour (round 8): it was $20 when implied values were value-if-
  // launches. Launch odds roughly halve the value scale (mean odds 0.45), so the $20 bar
  // never fires and the verdict carries no signal; $15 is a round, defensible wage for
  // speculative farming work, and it keeps the farm set small and selective. The bar is
  // a policy choice, stated on the dashboard and in the README — not a fitted parameter.
  hourly_bar_usd: 15,
  safety_multiple: 2,
};

/** One row's farm economics: its plan netted to the dollar against its fitted value. Every
 *  figure is rounded to cents before it is stored, so the dashboard's arithmetic (gas + forgone
 *  yield = cost; expected − cost = net; net ÷ hours = $/hour) is exact on the displayed numbers. */
export interface FarmEconomics {
  capital_usd: number;
  hold_days: number;
  cost_gas_usd: number;
  cost_opp_usd: number;
  cost_total_usd: number;
  hours: number;
  farmers: number;
  expected_usd: number;
  breakeven_value_usd: number;
  net_usd: number;
  usd_per_hour: number;
  verdict: 'farm' | 'thin' | 'skip';
}

/** One validation split's error statistics, in log space. */
export interface FitCheck {
  n: number;
  median_factor: number;
  within_2x: number;
  within_3x: number;
}

/** The same three out-of-sample tests for a second comp set: the 128 traded protocols
 *  (round 13), fitted and tested exactly the way the 94 clean comps are. */
export interface CompSetValidation {
  comps: number;
  intercept: number;
  slope: number;
  r2: number;
  loo: FitCheck;
  blind: FitCheck;
  walkforward: FitCheck;
}

/** The fitted size curve and everything the dashboard states about it. */
export interface FitReport {
  method: string;
  comps: number;
  intercept: number;
  slope: number;
  r2: number;
  resid_sd: number;
  loo: FitCheck;
  blind: FitCheck;
  walkforward: FitCheck;
  /** The per-category alternative that was tested and rejected, with its own leave-one-out error. */
  alt_cat_median_loo_median_factor: number;
  refits: number;
  /** The model-selection table (round 8; blind column and per-variant parameters round 13):
   *  every value-model variant's out-of-sample error, leave-one-out, walk-forward and blind,
   *  so the adopted model can be read against the ones that were tested and not kept. */
  selection: ModelSelectionRow[];
  /** The 128-comp alternative (round 13): the curve fitted to every traded protocol in
   *  the snapshot, wrappers/bridges/exchanges included, tested the same three ways as
   *  the 94 clean comps — so the exclusion can be read against the numbers, not asserted. */
  comps128: CompSetValidation;
  /** The calibrated value interval (round 9): P25–P75 and P10–P90 multipliers from the
   *  leave-one-out errors, checked on the blind holdout. */
  interval: ValueInterval;
}

/** One row of the model-selection table: a value-model variant and its out-of-sample
 *  median error, leave-one-out, walk-forward and blind holdout. */
export interface ModelSelectionRow {
  variant: string;
  loo: number;
  walkforward: number;
  blind: number;
}

/** A calibrated value interval: the empirical multipliers for the P25–P75 and P10–P90
 *  ranges, from the leave-one-out errors, and the blind holdout's hit rates against them. */
export interface ValueInterval {
  /** Multiply a predicted value by these for the P25–P75 range. */
  lo50: number;
  hi50: number;
  /** Multiply a predicted value by these for the P10–P90 range. */
  lo80: number;
  hi80: number;
  /** Fraction of the blind holdout's actual caps inside each range (the holdout was never
   *  used to fit the curve or the intervals). */
  blindHit50: number;
  blindHit80: number;
}

/** One leave-one-out refit of the size curve, in the comps' slug order. */
export interface CurveFit {
  intercept: number;
  slope: number;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    curve_base_usd: number;
    curve_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    /** The fitted launch odds, P(it records a token), and the value if it launches (the
     *  implied value before the odds are applied). */
    launch_odds: number;
    value_if_launches_usd: number;
    age_days: number | null;
    /** The row's implied value and rank across the leave-one-out refits of the curve. */
    implied_low_usd: number;
    implied_high_usd: number;
    rank_low: number;
    rank_high: number;
    /** The row's rank across the 200 bootstrap refits (round 12): the 5th–95th percentile. */
    rank_boot_low: number;
    rank_boot_high: number;
  };
  farm_steps: string[];
  /** The plan netted to the dollar against the fitted value (round 5). */
  economics: FarmEconomics;
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  launch_odds: number;
  rank_low: number;
  rank_high: number;
  /** The row's rank across the 200 bootstrap refits (round 12): the 5th–95th percentile. */
  rank_boot_low: number;
  rank_boot_high: number;
  /** The no-token clock's share for this row's age (round 14): of the protocols listed this
   *  long ago, this share record a token. The Unknown bucket's share when the listing date
   *  is unknown. Display only — it does not enter the implied value. */
  clock_share: number;
  /** The row's farm steps, as board.json carries them (round 8): the drawer renders these
   *  directly instead of recomputing them, so the page can only ever show the board's own plan. */
  farm_steps: string[];
  economics: FarmEconomics;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** A pre-token protocol set aside from the board, with the one stated reason (round 11):
 *  a bridge, a liquid-staking or restaking product, an exchange-custody product, a
 *  versioned release of one protocol, or a wrapped / staked product by name. */
export interface SetAsideRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  reason: 'bridge' | 'liquid-staking' | 'exchange' | 'versioned' | 'wrapped';
}

/** One bucket of the no-token clock: protocols listed this long ago, and the share of them
 *  that record a token. */
export interface ClockBucket {
  label: string;
  n: number;
  records: number;
  share: number;
}

/** The no-token clock (round 14): the snapshot's own answer to how long until a protocol
 *  records a token, by years since listing. A cross-sectional share, not a hazard — the
 *  snapshot carries no launch dates, so no true hazard can be fitted. The medians use known
 *  listing dates only (see noTokenClock). */
export interface NoTokenClock {
  buckets: ClockBucket[];
  medianTradedDays: number;
  medianPreDays: number;
  pre3yPlus: number;
  preTotal: number;
}

/** The no-token clock, from the snapshot itself: for each age band, how many protocols were
 *  listed that long ago and what share of them record a token — plus the median listing age
 *  of protocols that record a token against those that do not, and how many pre-token
 *  protocols have waited three years or more. Deterministic: counts from the snapshot. */
export function noTokenClock(snapshot: Snapshot): NoTokenClock {
  const edges: [number, number, string][] = [
    [0, 0.5, '0–6 mo'],
    [0.5, 1, '6–12 mo'],
    [1, 2, '1–2y'],
    [2, 3, '2–3y'],
    [3, 4, '3–4y'],
    [4, 99, '4y+'],
  ];
  const buckets: ClockBucket[] = edges.map(([lo, hi, label]) => {
    const inBand = snapshot.protocols.filter((p) => {
      const a = ageDays(snapshot.as_of, p.listed_at);
      const y = a === null ? null : a / 365.25;
      return y !== null && y >= lo && y < hi;
    });
    const records = inBand.filter((p) => !isPreToken(p)).length;
    return { label, n: inBand.length, records, share: inBand.length ? Math.round((records / inBand.length) * 1000) / 1000 : 0 };
  });
  const unknown = snapshot.protocols.filter((p) => ageDays(snapshot.as_of, p.listed_at) === null);
  const unknownRecords = unknown.filter((p) => !isPreToken(p)).length;
  buckets.push({
    label: 'Unknown',
    n: unknown.length,
    records: unknownRecords,
    share: unknown.length ? Math.round((unknownRecords / unknown.length) * 1000) / 1000 : 0,
  });
  const tradedAges = snapshot.protocols
    .filter((p) => !isPreToken(p))
    .map((p) => ageDays(snapshot.as_of, p.listed_at))
    .filter((a): a is number => a !== null);
  const preAges = snapshot.protocols
    .filter(isPreToken)
    .map((p) => ageDays(snapshot.as_of, p.listed_at))
    .filter((a): a is number => a !== null);
  return {
    buckets,
    // Known listing dates only: the 365-day fallback would drag both medians toward 365
    // (89 of the 416 token protocols have no listing date), so the medians describe actual
    // listing ages, not the fallback.
    medianTradedDays: Math.round(medianOf(tradedAges)),
    medianPreDays: Math.round(medianOf(preAges)),
    pre3yPlus: snapshot.protocols.filter((p) => isPreToken(p) && (ageDays(snapshot.as_of, p.listed_at) ?? 0) >= 3 * 365).length,
    // All pre-token protocols, not just the known-date ones the medians use.
    preTotal: snapshot.protocols.filter(isPreToken).length,
  };
}

/** Everything the dashboard needs: the board, the live set, the model it runs, and the fit it was fitted with. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  fit: FitReport;
  /** The launch-odds fit's validation, for the dashboard to state (round 8). */
  odds: { cv_accuracy: number; base_rate: number; n: number };
  /** The no-token clock (round 14): the share recording a token by years since listing. */
  clock: NoTokenClock;
  /** The traded protocols the curve is fitted to (round 9): TVL and market cap each, for
   *  the fit's scatter plot. Sorted by TVL. */
  comps: { tvl_usd: number; mcap_usd: number }[];
  econ: EconConstants;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  /** Rankable rows above the watchlist floor but not on the watchlist (round 7). */
  offlist_size: number;
  live_size: number;
  watchlist: string[];
  /** Every protocol in the snapshot, accounted for by disposition (round 7). */
  accounting: Accounting;
  /** The pre-token protocols set aside from the board, each with its one stated reason
   *  (round 11): the detail behind the accounting bar's set-aside buckets. */
  setAside: SetAsideRow[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Every protocol in the snapshot, accounted for by disposition: the board's ranked rows,
 *  the protocols whose token already trades, and the pre-token protocols set aside, each
 *  for one stated reason. The counts sum to the snapshot's protocol count. */
export interface Accounting {
  ranked: number;
  trades: number;
  bridges: number;
  liquidStaking: number;
  exchange: number;
  versioned: number;
  wrapped: number;
  total: number;
}

/** Account for every protocol in the snapshot, in priority order, so no protocol is counted
 *  twice and none is missed: ranked (on the watchlist or rankable), already trading (a token
 *  is recorded), then the pre-token protocols set aside — bridges, liquid staking and
 *  restaking, exchange custody, versioned releases of one protocol, wrapped or staked by name. */
export function accountSnapshot(snapshot: Snapshot): Accounting {
  const watch = new Set(snapshot.watchlist);
  let ranked = 0;
  let trades = 0;
  let bridges = 0;
  let liquidStaking = 0;
  let exchange = 0;
  let versioned = 0;
  let wrapped = 0;
  for (const p of snapshot.protocols) {
    if (watch.has(p.slug) || isRankable(p)) ranked++;
    else if (!isPreToken(p)) trades++;
    else if (p.category === 'Bridge' || p.category === 'Canonical Bridge') bridges++;
    else if (p.category === 'Liquid Staking' || p.category === 'Liquid Restaking' || p.category === 'Restaked BTC') liquidStaking++;
    else if (p.category === 'CEX') exchange++;
    else if (VERSIONED.test(p.name)) versioned++;
    else if (WRAPPED_WORD.test(p.name)) wrapped++;
    else throw new SnapshotError(`accounting: ${p.slug} fits no disposition`);
  }
  const total = ranked + trades + bridges + liquidStaking + exchange + versioned + wrapped;
  if (total !== snapshot.protocols.length) throw new SnapshotError(`accounting: ${total} dispositions for ${snapshot.protocols.length} protocols`);
  return { ranked, trades, bridges, liquidStaking, exchange, versioned, wrapped, total };
}

/** The pre-token protocols set aside from the board, each with its one stated reason —
 *  the same priority order as accountSnapshot, so the list and the counts agree. Sorted
 *  by TVL, largest first, so the biggest set-aside protocol is the first row. */
export function setAsideSnapshot(snapshot: Snapshot): SetAsideRow[] {
  const watch = new Set(snapshot.watchlist);
  const out: SetAsideRow[] = [];
  for (const p of snapshot.protocols) {
    if (watch.has(p.slug) || isRankable(p)) continue;
    if (!isPreToken(p)) continue;
    let reason: SetAsideRow['reason'];
    if (p.category === 'Bridge' || p.category === 'Canonical Bridge') reason = 'bridge';
    else if (p.category === 'Liquid Staking' || p.category === 'Liquid Restaking' || p.category === 'Restaked BTC') reason = 'liquid-staking';
    else if (p.category === 'CEX') reason = 'exchange';
    else if (VERSIONED.test(p.name)) reason = 'versioned';
    else if (WRAPPED_WORD.test(p.name)) reason = 'wrapped';
    else throw new SnapshotError(`accounting: ${p.slug} fits no disposition`);
    out.push({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, reason });
  }
  return out.sort((a, b) => b.tvl_usd - a.tvl_usd);
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The traded protocols the curve is fitted to: a market cap and a TVL each, and not a wrapper,
 *  a bridge or an exchange product. Sorted by slug, so every fit over them is deterministic. */
export function compsFor(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && !WRAPPER_CATEGORIES.has(p.category ?? ''))
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

/** Every traded protocol in the snapshot, wrappers/bridges/exchanges included: the 128-comp
 *  alternative to the 94 clean comps (round 13). Sorted by slug, like compsFor. */
export function allTradedComps(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

/** The curve fitted to one comp set and tested the same three ways the clean comps are:
 *  leave-one-out, blind holdout (top 20% by slug hash) and walk-forward (older half fits,
 *  newer half predicted). The 94-comp path in fitModel is untouched; this is only for the
 *  128-comp comparison, so the exclusion is measured, not asserted. */
export function validateCurveSet(comps: SnapshotProtocol[]): CompSetValidation {
  const full = olsFit(comps);
  const looPreds: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const train = comps.filter((_, j) => j !== i);
    const f = olsFit(train);
    looPreds.push(Math.exp(f.intercept + f.slope * Math.log(comps[i]!.tvl_usd)));
  }
  const loo = errorStats(looPreds, comps.map((p) => p.mcap_usd as number));
  const test = comps.filter((p) => hash01(p.slug) >= 0.8);
  const train = comps.filter((p) => hash01(p.slug) < 0.8);
  const blindFit = olsFit(train);
  const blind = errorStats(
    test.map((p) => Math.exp(blindFit.intercept + blindFit.slope * Math.log(p.tvl_usd))),
    test.map((p) => p.mcap_usd as number),
  );
  const dated = comps
    .filter((p) => p.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : 0));
  const mid = dated[Math.floor(dated.length / 2)]!.listed_at!;
  const older = dated.filter((p) => p.listed_at! < mid);
  const newer = dated.filter((p) => p.listed_at! >= mid);
  const wfFit = olsFit(older);
  const walkforward = errorStats(
    newer.map((p) => Math.exp(wfFit.intercept + wfFit.slope * Math.log(p.tvl_usd))),
    newer.map((p) => p.mcap_usd as number),
  );
  return {
    comps: comps.length,
    intercept: Math.round(full.intercept * 1000) / 1000,
    slope: Math.round(full.slope * 1000) / 1000,
    r2: Math.round(full.r2 * 1000) / 1000,
    loo,
    blind,
    walkforward,
  };
}

/** Ordinary least squares on log market cap against log TVL. */
export function olsFit(comps: SnapshotProtocol[]): CurveFit & { r2: number; residSd: number } {
  const n = comps.length;
  let sx = 0;
  let sy = 0;
  for (const p of comps) {
    sx += Math.log(p.tvl_usd);
    sy += Math.log(p.mcap_usd as number);
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  for (const p of comps) {
    const dx = Math.log(p.tvl_usd) - mx;
    sxx += dx * dx;
    sxy += dx * (Math.log(p.mcap_usd as number) - my);
  }
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let ssRes = 0;
  let ssTot = 0;
  for (const p of comps) {
    const r = Math.log(p.mcap_usd as number) - (intercept + slope * Math.log(p.tvl_usd));
    ssRes += r * r;
    ssTot += (Math.log(p.mcap_usd as number) - my) ** 2;
  }
  return { intercept, slope, r2: 1 - ssRes / ssTot, residSd: Math.sqrt(ssRes / (n - 2)) };
}

/** A deterministic 0..1 hash of a slug (FNV-1a): the blind holdout's coin flip. */
export function hash01(slug: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967296;
}

/** A deterministic PRNG (mulberry32) with a fixed seed: the bootstrap's resampling is
 *  reproducible, so two runs give the same rank ranges. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The median of a list, for an odd or even count. */
function medianOf(values: number[]): number {
  const s = values.slice().sort((a, b) => a - b);
  const n = s.length;
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

/** Error statistics for predicted market caps against the real ones, in log space. */
function errorStats(predicted: number[], actual: number[]): FitCheck {
  const errs = predicted.map((pr, i) => Math.abs(Math.log(pr / actual[i]!))).sort((a, b) => a - b);
  const median = medianOf(errs);
  const round3 = (x: number): number => Math.round(x * 1000) / 1000;
  return {
    n: errs.length,
    median_factor: Math.round(Math.exp(median) * 100) / 100,
    within_2x: round3(errs.filter((e) => e < Math.log(2)).length / errs.length),
    within_3x: round3(errs.filter((e) => e < Math.log(3)).length / errs.length),
  };
}

/** The per-category alternative, for the fit report: a row is priced at the median
 *  market-cap-to-TVL ratio of traded protocols in its own category (at least 3 comps),
 *  else the pooled median ratio. */
function catMedianPredict(train: SnapshotProtocol[], p: SnapshotProtocol): number {
  const same = train.filter((q) => q.category === p.category);
  if (same.length >= 3) return p.tvl_usd * medianOf(same.map((q) => (q.mcap_usd as number) / q.tvl_usd));
  return p.tvl_usd * medianOf(train.map((q) => (q.mcap_usd as number) / q.tvl_usd));
}

/**
 * Fit the size curve to the snapshot's traded protocols and validate it three ways.
 * Returns the fit report, the leave-one-out refits (one per comp, in slug order) and
 * the bootstrap refits (200 resamples of the comps, with replacement), which the board
 * uses for each row's rank range. Every split and every resample is deterministic: the
 * blind holdout is the top 20% of comps by slug hash, the walk-forward split is the
 * median listing date among comps that carry one, and the bootstrap draws from a
 * fixed-seed PRNG, so two runs give the same ranges.
 */
export function fitModel(snapshot: Snapshot): { fit: FitReport; refits: CurveFit[]; bootRefits: CurveFit[] } {
  const comps = compsFor(snapshot);
  if (comps.length < 10) throw new SnapshotError(`only ${comps.length} traded protocols to fit the curve on`);
  const full = olsFit(comps);
  // Leave-one-out: refit without each comp and predict it.
  const refits: CurveFit[] = [];
  const looPreds: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const train = comps.filter((_, j) => j !== i);
    const f = olsFit(train);
    refits.push({ intercept: f.intercept, slope: f.slope });
    looPreds.push(Math.exp(f.intercept + f.slope * Math.log(comps[i]!.tvl_usd)));
  }
  const loo = errorStats(looPreds, comps.map((p) => p.mcap_usd as number));
  // The alternative that was tested and rejected: per-category median ratios.
  const altPreds: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const train = comps.filter((_, j) => j !== i);
    altPreds.push(catMedianPredict(train, comps[i]!));
  }
  const altLoo = errorStats(altPreds, comps.map((p) => p.mcap_usd as number));
  // Blind holdout: the top 20% by slug hash are held out and predicted from the rest.
  const test = comps.filter((p) => hash01(p.slug) >= 0.8);
  const train = comps.filter((p) => hash01(p.slug) < 0.8);
  const blindFit = olsFit(train);
  const blind = errorStats(
    test.map((p) => Math.exp(blindFit.intercept + blindFit.slope * Math.log(p.tvl_usd))),
    test.map((p) => p.mcap_usd as number),
  );
  // Walk-forward: fit on the older half by listing date, predict the newer half.
  const dated = comps
    .filter((p) => p.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : 0));
  const mid = dated[Math.floor(dated.length / 2)]!.listed_at!;
  const older = dated.filter((p) => p.listed_at! < mid);
  const newer = dated.filter((p) => p.listed_at! >= mid);
  const wfFit = olsFit(older);
  const walkforward = errorStats(
    newer.map((p) => Math.exp(wfFit.intercept + wfFit.slope * Math.log(p.tvl_usd))),
    newer.map((p) => p.mcap_usd as number),
  );
  // Calibrated value intervals (round 9): the empirical quantiles of the signed
  // leave-one-out log-errors give the P25–P75 and P10–P90 multipliers, and the blind
  // holdout — never used to fit the curve or the intervals — checks them. The quantiles
  // are empirical, not assumed normal: the errors are heavy-tailed, so a normal interval
  // would be too narrow.
  const looSigned = looPreds.map((pr, i) => Math.log((comps[i]!.mcap_usd as number) / pr)).sort((x, y) => x - y);
  const quantile = (sorted: number[], q: number): number => {
    const pos = q * (sorted.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
  };
  const e10 = quantile(looSigned, 0.1);
  const e25 = quantile(looSigned, 0.25);
  const e75 = quantile(looSigned, 0.75);
  const e90 = quantile(looSigned, 0.9);
  const blindPreds = test.map((p) => Math.exp(blindFit.intercept + blindFit.slope * Math.log(p.tvl_usd)));
  const blindActuals = test.map((p) => p.mcap_usd as number);
  const round3 = (x: number): number => Math.round(x * 1000) / 1000;
  const interval: ValueInterval = {
    lo50: round3(Math.exp(e25)),
    hi50: round3(Math.exp(e75)),
    lo80: round3(Math.exp(e10)),
    hi80: round3(Math.exp(e90)),
    blindHit50: round3(blindActuals.filter((a, i) => a >= blindPreds[i]! * Math.exp(e25) && a <= blindPreds[i]! * Math.exp(e75)).length / blindActuals.length),
    blindHit80: round3(blindActuals.filter((a, i) => a >= blindPreds[i]! * Math.exp(e10) && a <= blindPreds[i]! * Math.exp(e90)).length / blindActuals.length),
  };
  // Model selection (round 8; per-variant parameters round 13): every value-model variant's
  // out-of-sample error, so the adopted model can be read against the ones that were tested
  // and not kept. Each variant is priced from the same curve refits (leave-one-out) and the
  // same walk-forward fit, so the comparison is apples to apples; the category premium is
  // priced from the train set only, never from the protocol being predicted. Each variant
  // prices under its own parameters — the adopted row is the tuned radar-10 model, the
  // breadth variant and the radar-9 model carry theirs.
  const selection = selectionTable(snapshot, comps, refits, wfFit, older, newer, blindFit, train, test);
  const fit: FitReport = {
    method: 'pooled log-log OLS',
    comps: comps.length,
    intercept: full.intercept,
    slope: full.slope,
    r2: Math.round(full.r2 * 1000) / 1000,
    resid_sd: Math.round(full.residSd * 1000) / 1000,
    loo,
    blind,
    walkforward,
    alt_cat_median_loo_median_factor: altLoo.median_factor,
    refits: refits.length,
    selection,
    interval,
    comps128: validateCurveSet(allTradedComps(snapshot)),
  };
  return { fit, refits, bootRefits: bootstrapRefits(comps, 200) };
}

/** Bootstrap refits of the size curve: resample the comps with replacement and refit,
 *  200 times. The resampling is a fixed-seed PRNG, so the refits are the same on every
 *  run. A resample that draws a comp twice counts it twice — that is the bootstrap. */
export function bootstrapRefits(comps: SnapshotProtocol[], count: number): CurveFit[] {
  const rand = mulberry32(20261114);
  const out: CurveFit[] = [];
  for (let i = 0; i < count; i++) {
    const sample: SnapshotProtocol[] = [];
    for (let j = 0; j < comps.length; j++) sample.push(comps[Math.floor(rand() * comps.length)]!);
    const f = olsFit(sample);
    out.push({ intercept: f.intercept, slope: f.slope });
  }
  return out;
}

/** The three multipliers one protocol gets under the model, from its own figures. */
function multipliersFor(p: SnapshotProtocol, asOf: string, model: ModelConstants): { growth: number; maturity: number; breadth: number } {
  const age = ageDays(asOf, p.listed_at);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(p.change_7d, 0)));
  const growth = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturity = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadth = 1 + model.chain_step * Math.min(Math.max(p.chains.length - 1, 0), model.chain_max);
  return { growth, maturity, breadth };
}

/** A category premium map for one train set: each category's median ratio of real market
 *  cap to its curve prediction (at least 3 comps), else 1.0 — no premium. */
function premiumMap(train: SnapshotProtocol[], fit: CurveFit): Map<string, number> {
  const byCat = new Map<string, number[]>();
  for (const p of train) {
    const ratio = (p.mcap_usd as number) / Math.exp(fit.intercept + fit.slope * Math.log(p.tvl_usd));
    const list = byCat.get(p.category ?? 'uncategorised') ?? [];
    list.push(ratio);
    byCat.set(p.category ?? 'uncategorised', list);
  }
  const out = new Map<string, number>();
  for (const [cat, ratios] of byCat) out.set(cat, ratios.length >= 3 ? medianOf(ratios) : 1);
  return out;
}

/** One variant's prediction for one protocol, from a train set's curve fit and premium map.
 *  The multipliers come from the variant's own model parameters (`m`), not the global MODEL:
 *  round 13's table compares the tuned parameters against the radar-9 ones and the breadth
 *  variant, so each row must price under the parameters it names. */
function variantPredict(variant: string, train: SnapshotProtocol[], fit: CurveFit, prem: Map<string, number>, p: SnapshotProtocol, asOf: string, m: ModelConstants): number {
  const base = Math.exp(fit.intercept + fit.slope * Math.log(p.tvl_usd));
  const mult = multipliersFor(p, asOf, m);
  if (variant === 'flat') return p.tvl_usd * medianOf(train.map((q) => (q.mcap_usd as number) / q.tvl_usd));
  if (variant === 'curve') return base;
  if (variant === 'curve+growth') return base * mult.growth;
  if (variant === 'curve+premium') return base * (prem.get(p.category ?? 'uncategorised') ?? 1);
  if (variant === 'curve+premium+growth') return base * (prem.get(p.category ?? 'uncategorised') ?? 1) * mult.growth;
  if (variant === 'curve+growth+maturity') return base * mult.growth * mult.maturity;
  // curve+growth+maturity+breadth, and radar-9 (the previous adopted model): the full
  // model under the variant's own parameters.
  return base * mult.growth * mult.maturity * mult.breadth;
}

const SELECTION_VARIANTS: { key: string; label: string; model?: Partial<ModelConstants> }[] = [
  { key: 'flat', label: 'Flat multiple' },
  { key: 'curve', label: 'Size curve' },
  { key: 'curve+growth', label: 'Curve + growth' },
  { key: 'curve+premium', label: 'Curve + category premium' },
  { key: 'curve+premium+growth', label: 'Curve + premium + growth' },
  { key: 'curve+growth+maturity', label: 'Curve + growth + maturity' },
  { key: 'curve+growth+maturity+breadth', label: 'Curve + growth + maturity + breadth', model: { chain_step: 0.1 } },
  { key: 'radar9', label: 'Radar-9 adopted (growth 1.0, maturity 4y, breadth 0.10)', model: { growth_weight: 1.0, maturity_days: 1460, chain_step: 0.1 } },
];

/** The model-selection table: leave-one-out, walk-forward and blind median error for every
 *  variant. Each variant prices under its own parameters (see SELECTION_VARIANTS): the adopted
 *  row is the tuned radar-10 model, and the breadth variant and the radar-9 model stay in the
 *  table as the alternatives that were tested and not kept. The blind holdout is the same
 *  top-20%-by-slug-hash split the fit report uses, fitted without the held-out protocols. */
function selectionTable(snapshot: Snapshot, comps: SnapshotProtocol[], refits: CurveFit[], wfFit: CurveFit, older: SnapshotProtocol[], newer: SnapshotProtocol[], blindFit: CurveFit, blindTrain: SnapshotProtocol[], blindTest: SnapshotProtocol[]): ModelSelectionRow[] {
  const asOf = snapshot.as_of;
  const rows: ModelSelectionRow[] = [];
  for (const v of SELECTION_VARIANTS) {
    const m: ModelConstants = { ...MODEL, ...(v.model ?? {}) };
    // Leave-one-out: refit without each comp (the refits array is in comps order) and predict it.
    const looPreds: number[] = [];
    for (let i = 0; i < comps.length; i++) {
      const train = comps.filter((_, j) => j !== i);
      const prem = v.key.includes('premium') ? premiumMap(train, refits[i]!) : new Map<string, number>();
      looPreds.push(variantPredict(v.key, train, refits[i]!, prem, comps[i]!, asOf, m));
    }
    const loo = errorStats(looPreds, comps.map((p) => p.mcap_usd as number)).median_factor;
    // Walk-forward: the older half's fit predicts the newer half.
    const prem = v.key.includes('premium') ? premiumMap(older, wfFit) : new Map<string, number>();
    const wf = errorStats(
      newer.map((p) => variantPredict(v.key, older, wfFit, prem, p, asOf, m)),
      newer.map((p) => p.mcap_usd as number),
    ).median_factor;
    // Blind holdout: the hash<0.8 fit predicts the held-out 20%.
    const blindPrem = v.key.includes('premium') ? premiumMap(blindTrain, blindFit) : new Map<string, number>();
    const blind = errorStats(
      blindTest.map((p) => variantPredict(v.key, blindTrain, blindFit, blindPrem, p, asOf, m)),
      blindTest.map((p) => p.mcap_usd as number),
    ).median_factor;
    rows.push({ variant: v.label, loo, walkforward: wf, blind });
  }
  return rows;
}

/** Solve a linear system A·x = b by Gauss-Jordan elimination with partial pivoting. */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    if (Math.abs(M[piv]![col]!) < 1e-12) throw new SnapshotError('launch-odds fit: singular matrix');
    if (piv !== col) { const t = M[col]!; M[col] = M[piv]!; M[piv] = t; }
    const d = M[col]![col]!;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r]![col]! / d;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r]![c]! -= f * M[col]![c]!;
    }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}

/** Iteratively reweighted least squares for a logistic regression with a ridge penalty:
 *  beta <- (X'WX + ridge·I)^-1 X'W(z + (y-p)/W), 40 fixed iterations, no randomness.
 *  The fixed point is the ridge solution; the iteration count is fixed so the fit is deterministic. */
function fitLogit(X: number[][], y: number[], ridge = 1, iters = 40): number[] {
  const n = X.length;
  const d = X[0]!.length;
  let beta = new Array<number>(d).fill(0);
  for (let it = 0; it < iters; it++) {
    const A: number[][] = Array.from({ length: d }, () => new Array<number>(d).fill(0));
    const b: number[] = new Array<number>(d).fill(0);
    for (let i = 0; i < n; i++) {
      const xi = X[i]!;
      let z = 0;
      for (let j = 0; j < d; j++) z += xi[j]! * beta[j]!;
      const p = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
      const w = Math.max(p * (1 - p), 1e-6);
      const adj = z + (y[i]! - p) / w;
      for (let j = 0; j < d; j++) {
        b[j]! += w * adj * xi[j]!;
        for (let k = j; k < d; k++) A[j]![k]! += w * xi[j]! * xi[k]!;
      }
    }
    for (let j = 0; j < d; j++) {
      A[j]![j]! += ridge;
      for (let k = 0; k < j; k++) A[j]![k]! = A[k]![j]!;
    }
    beta = solveLinear(A, b);
  }
  return beta;
}

/** A fitted launch-odds model: P(a protocol records a token), from the snapshot itself.
 *  The feature list is the sorted category list (the first is the baseline, dropped) plus
 *  log TVL, age in years and log chains, the continuous features centred on their means. */
export interface LaunchOddsFit {
  categories: string[];
  beta: number[];
  meanLogTvl: number;
  meanAgeYears: number;
  meanLogChains: number;
  /** 5-fold cross-validated classification accuracy (folds by slug hash, pooled), and the
   *  majority-class base rate it has to beat. */
  cvAccuracy: number;
  baseRate: number;
  n: number;
}

function oddsFeatures(p: SnapshotProtocol, odds: { categories: string[]; meanLogTvl: number; meanAgeYears: number; meanLogChains: number }, asOf: string): number[] {
  const x: number[] = [1];
  const cat = p.category ?? 'uncategorised';
  for (let i = 1; i < odds.categories.length; i++) x.push(cat === odds.categories[i] ? 1 : 0);
  const age = ageDays(asOf, p.listed_at);
  x.push(Math.log(p.tvl_usd) - odds.meanLogTvl);
  x.push((age ?? 365) / 365.25 - odds.meanAgeYears);
  x.push(Math.log(Math.max(p.chains.length, 1)) - odds.meanLogChains);
  return x;
}

/** Fit the launch-odds logistic regression on every protocol in the snapshot and validate
 *  it with 5-fold cross-validation (folds by slug hash, so the split is deterministic).
 *  The target is whether the protocol records a token; the predictors are its category,
 *  its size, its age and how many chains it is on — all figures the snapshot carries. */
export function fitLaunchOdds(snapshot: Snapshot): LaunchOddsFit {
  const categories = [...new Set(snapshot.protocols.map((p) => p.category ?? 'uncategorised'))].sort();
  const meanLogTvl = snapshot.protocols.reduce((s, p) => s + Math.log(p.tvl_usd), 0) / snapshot.protocols.length;
  const meanAgeYears = snapshot.protocols.reduce((s, p) => s + ((ageDays(snapshot.as_of, p.listed_at) ?? 365) / 365.25), 0) / snapshot.protocols.length;
  const meanLogChains = snapshot.protocols.reduce((s, p) => s + Math.log(Math.max(p.chains.length, 1)), 0) / snapshot.protocols.length;
  const spec = { categories, meanLogTvl, meanAgeYears, meanLogChains };
  const X = snapshot.protocols.map((p) => oddsFeatures(p, spec, snapshot.as_of));
  const y = snapshot.protocols.map((p) => (isPreToken(p) ? 0 : 1));
  const beta = fitLogit(X, y);
  // 5-fold CV: fold k holds out the protocols whose slug hash falls in its fifth.
  let correct = 0;
  for (let fold = 0; fold < 5; fold++) {
    const testIdx: number[] = [];
    const trainIdx: number[] = [];
    snapshot.protocols.forEach((p, i) => (Math.floor(hash01(p.slug) * 5) === fold ? testIdx : trainIdx).push(i));
    const b = fitLogit(trainIdx.map((i) => X[i]!), trainIdx.map((i) => y[i]!));
    for (const i of testIdx) {
      const z = X[i]!.reduce((s, v, j) => s + v * b[j]!, 0);
      const p = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
      if ((p >= 0.5 ? 1 : 0) === y[i]) correct++;
    }
  }
  const ones = y.reduce((s, v) => s + v, 0);
  const fit: LaunchOddsFit = {
    categories,
    beta,
    meanLogTvl,
    meanAgeYears,
    meanLogChains,
    cvAccuracy: Math.round((correct / y.length) * 1000) / 1000,
    baseRate: Math.round((Math.max(ones, y.length - ones) / y.length) * 1000) / 1000,
    n: y.length,
  };
  return fit;
}

/** One protocol's fitted launch odds: P(it records a token) under the fitted model. */
export function launchOdds(p: SnapshotProtocol, odds: LaunchOddsFit, asOf: string): number {
  const x = oddsFeatures(p, odds, asOf);
  const z = x.reduce((s, v, j) => s + v * odds.beta[j]!, 0);
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
}

/** The four multipliers and the implied value one protocol gets under `model` and the fitted curve. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  fit: CurveFit,
  odds = 1,
): { implied: number; curveBase: number; curveMultiple: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; launchOdds: number; preOdds: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult = 1 + model.chain_step * Math.min(Math.max(protocol.chains.length - 1, 0), model.chain_max);
  const curveBase = Math.exp(fit.intercept + fit.slope * Math.log(protocol.tvl_usd));
  const preOdds = Math.max(1, Math.round(curveBase * growthMult * maturityMult * breadthMult));
  const implied = Math.max(1, Math.round(preOdds * odds));
  return { implied, curveBase, curveMultiple: round4(curveBase / protocol.tvl_usd), growthPct, growthMult, maturityMult, breadthMult, launchOdds: odds, preOdds, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A wrapped, staked or bridged product: a token that already trades, in another form. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** Categories that are a wrapper, a bridge or an exchange product, never a launch of their own. */
const WRAPPER_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** A name that begins with an exchange's name is that exchange's product. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token and a launch of its own. */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    p.category !== null &&
    !WRAPPER_CATEGORIES.has(p.category) &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. Each row also carries the range
 *  its implied value and rank take across the curve's leave-one-out refits. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants, fit: CurveFit, refits: CurveFit[], odds: LaunchOddsFit, bootRefits: CurveFit[] = []): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug on it is ranked, whatever its size.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every genuine pre-token protocol outside the watchlist, by TVL.
  // No cap and no floor: the radar exists to find them all, and the gate allows up to 4,000 rows.
  // (Round 7: the floor restriction is gone — the 20 rankable protocols at or above the floor
  // that the house watchlist does not list are launches too, and the top board ranks them.)
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const o = launchOdds(p, odds, snapshot.as_of);
    const { implied, curveBase, curveMultiple, growthPct, growthMult, maturityMult, breadthMult, preOdds, age } = impliedValue(p, snapshot.as_of, model, fit, o);
    return { p, implied, curveBase, curveMultiple, growthPct, growthMult, maturityMult, breadthMult, launchOdds: o, preOdds, age, economics: farmEconomics(p, age, implied) };
  });
  // Rank ranges: re-price every row under each leave-one-out refit and re-rank. The multipliers
  // and the launch odds do not depend on the fit, so only the curve's base moves.
  const ranges = new Map<string, { low: number; high: number; rankLow: number; rankHigh: number }>();
  for (const r of refits) {
    const priced = scored.map((s) => ({
      slug: s.p.slug,
      implied: Math.max(1, Math.round(Math.exp(r.intercept + r.slope * Math.log(s.p.tvl_usd)) * s.growthMult * s.maturityMult * s.breadthMult * s.launchOdds)),
    }));
    priced.sort((a, b) => b.implied - a.implied || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    priced.forEach((x, i) => {
      const cur = ranges.get(x.slug) ?? { low: Infinity, high: -Infinity, rankLow: Infinity, rankHigh: -Infinity };
      cur.low = Math.min(cur.low, x.implied);
      cur.high = Math.max(cur.high, x.implied);
      cur.rankLow = Math.min(cur.rankLow, i + 1);
      cur.rankHigh = Math.max(cur.rankHigh, i + 1);
      ranges.set(x.slug, cur);
    });
  }
  // Bootstrap rank ranges (round 12): re-price every row under each of the 200 bootstrap
  // refits and re-rank. The 5th–95th percentile of the 200 ranks is the row's rank range —
  // a 90% interval, so one extreme resample does not set the range.
  const bootRanks = new Map<string, number[]>();
  for (const r of bootRefits) {
    const priced = scored.map((s) => ({
      slug: s.p.slug,
      implied: Math.max(1, Math.round(Math.exp(r.intercept + r.slope * Math.log(s.p.tvl_usd)) * s.growthMult * s.maturityMult * s.breadthMult * s.launchOdds)),
    }));
    priced.sort((a, b) => b.implied - a.implied || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    priced.forEach((x, i) => {
      const list = bootRanks.get(x.slug) ?? [];
      list.push(i + 1);
      bootRanks.set(x.slug, list);
    });
  }
  const bootRange = (slug: string, rank: number): { low: number; high: number } => {
    const list = (bootRanks.get(slug) ?? [rank]).slice().sort((a, b) => a - b);
    const pct = (p: number): number => list[Math.min(list.length - 1, Math.floor(p * list.length))]!;
    return { low: pct(0.05), high: pct(0.95) };
  };
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => {
    const range = ranges.get(s.p.slug) ?? { low: s.implied, high: s.implied, rankLow: i + 1, rankHigh: i + 1 };
    const boot = bootRange(s.p.slug, i + 1);
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      age_days: s.age,
      implied_value_usd: s.implied,
      model: {
        curve_base_usd: Math.round(s.curveBase),
        curve_multiple: s.curveMultiple,
        growth_pct: s.growthPct,
        growth_multiplier: round4(s.growthMult),
        maturity_multiplier: round4(s.maturityMult),
        breadth_multiplier: round4(s.breadthMult),
        launch_odds: round4(s.launchOdds),
        value_if_launches_usd: s.preOdds,
        age_days: s.age,
        implied_low_usd: range.low,
        implied_high_usd: range.high,
        rank_low: range.rankLow,
        rank_high: range.rankHigh,
        /** The row's rank range across the 200 bootstrap refits (round 12): the 5th–95th
         *  percentile of its 200 bootstrap ranks. */
        rank_boot_low: boot.low,
        rank_boot_high: boot.high,
      },
      farm_steps: farmSteps(s.p, s.age).map(stepText),
      economics: s.economics,
    };
  });
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's main action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow $20 against it so the position counts as active lending and borrowing.`;
  }
  if (c.includes('index')) {
    return `Deposit $${capital} of USDC into the ${name} index on ${chain} and hold the index tokens.`;
  }
  if (c.includes('dex')) {
    return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} in a narrow range, and route one swap through it each week.`;
  }
  if (c.includes('leveraged farm') || c.includes('yield aggregator')) {
    return `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and leave the receipt tokens in the wallet.`;
  }
  if (c.includes('yield') && !c.includes('aggregator')) {
    return `Deposit $${capital} of USDC into ${name}'s main yield vault on ${chain} and keep the position open.`;
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return `Deposit $${capital} of USDC as margin on ${name} on ${chain}, open one small long and one small short, then close the short.`;
  }
  if (c.includes('prediction')) {
    return `Fund $${capital} on ${name} and place one small position on a market that settles this month.`;
  }
  if (c.includes('curator') || c.includes('allocator')) {
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares in the farming wallet.`;
  }
  if (c.includes('stable')) {
    return `Mint $${capital} of the stable asset through ${name} on ${chain} with USDC collateral and hold the minted tokens.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in the farming wallet.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} for a 30-day term and keep the policy active.`;
  }
  if (c.includes('basis')) {
    return `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain} and keep the position open through one funding cycle.`;
  }
  if (c.includes('governance')) {
    return `Deposit $${capital} into ${name} on ${chain}, take the voting receipt, and vote on the next open proposal.`;
  }
  if (c.includes('payment')) {
    return `Fund $${capital} on ${name} on ${chain} and send one payment through its app each week.`;
  }
  if (c.includes('risk')) {
    return `Deposit $${capital} into a ${name} curated vault on ${chain} and keep the vault shares.`;
  }
  if (c.includes('chain')) {
    return `Bridge $${capital} of USDC to ${chain} and use it in one app on the chain through ${name}.`;
  }
  if (c.includes('restaking')) {
    return `Stake $${capital} of liquid staking tokens with ${name} on ${chain} and keep the receipt tokens.`;
  }
  if (c.includes('staking')) {
    return `Deposit $${capital} of USDC into the ${name} staking pool on ${chain} and keep the receipt tokens.`;
  }
  if (c.includes('liquidity')) {
    return `Deposit $${capital} of USDC into a ${name} managed vault on ${chain} and let the manager set the range.`;
  }
  if (c.includes('card')) {
    return `Top up $${capital} on the ${name} card on ${chain} and spend a little through it each week.`;
  }
  if (c.includes('btc')) {
    return `Deposit $${capital} of USDC with ${name} on ${chain} and keep the receipt tokens.`;
  }
  if (c.includes('farm')) {
    return `Deposit $${capital} of USDC into the ${name} farm on ${chain} and keep the receipt tokens.`;
  }
  if (c.includes('cedefi')) {
    return `Deposit $${capital} of USDC into the ${name} CeDeFi vault on ${chain} and keep the position open.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's weekly qualifying action, scaled by the position's capital tier. */
function weeklyFor(p: SnapshotProtocol, capital: number): string {
  const c = (p.category ?? '').toLowerCase();
  const amt = capital >= 150 ? 25 : 10;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'Repay $5 of the borrow and borrow it back, so the position shows fresh lending activity.';
  if (c.includes('index')) return `Check the index rebalance and add $${amt} if a new asset entered it.`;
  if (c.includes('dex')) return `Swap $${amt} through the pool and re-balance the range if the price moved out of it.`;
  if (c.includes('leveraged farm') || c.includes('yield aggregator')) return 'Harvest the vault yield and re-deposit it, so the position compounds instead of sitting idle.';
  if (c.includes('yield')) return 'Claim any accrued yield into the vault and keep the principal staked for another week.';
  if (c.includes('perpetual') || c.includes('derivative')) return 'Open and close one small position, keeping the total volume low.';
  if (c.includes('prediction')) return 'Place one small position on a new market that settles soon.';
  if (c.includes('risk')) return `Check the vault allocation and top up $${amt} if the curator rebalanced into a new market.`;
  if (c.includes('curator') || c.includes('allocator')) return `Check the latest vault allocation and move $${amt} into the newest market if the allocator opened one.`;
  if (c.includes('stable')) return `Check the peg and mint or redeem $${amt} to keep the position balanced.`;
  if (c.includes('rwa')) return `Check the asset yield accrual and add $${amt} of USDC if a new tranche opened.`;
  if (c.includes('insurance')) return 'Check the policy is still active and renew it before it lapses.';
  if (c.includes('basis')) return `Check the funding rate and add $${amt} if the basis widened in your favour.`;
  if (c.includes('governance')) return 'Vote on any open proposal, or delegate the vote to an active delegate.';
  if (c.includes('payment')) return 'Send one small payment through the app to a second wallet you control.';
  if (c.includes('restaking')) return 'Check the restaking rewards and re-stake anything accrued.';
  if (c.includes('staking')) return 'Check the staking rewards and compound them back into the pool.';
  if (c.includes('liquidity')) return `Check the managed range and add $${amt} if the manager moved it.`;
  if (c.includes('chain')) return 'Use one app on the chain and keep a small balance on the chain for the week.';
  if (c.includes('card')) return `Spend $${amt} through the card so the month shows card activity.`;
  if (c.includes('btc')) return `Check the BTC peg and add $${amt} of collateral if the peg drifted.`;
  if (c.includes('farm')) return 'Harvest the farm rewards and re-stake them into the same pool.';
  if (c.includes('cedefi')) return `Check the CeDeFi vault yield and add $${amt} to the highest-yielding one.`;
  return 'Make one qualifying action: a deposit, a borrow, a swap, a vote or a claim, whichever the app offers.';
}

/** The category's claim step: where the points or rewards are checked. */
function claimFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('governance')) return 'Open the governance page and check your voting power and any delegate rewards.';
  if (c.includes('insurance')) return 'Open the policy page and check the cover status and any claim window.';
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'Open the lending page and check the supply balance and any borrow rewards.';
  if (c.includes('index')) return 'Open the index page and check the holdings and any index rewards.';
  if (c.includes('dex')) return 'Open the pool page and check the fees earned and any points balance.';
  if (c.includes('perpetual') || c.includes('derivative')) return 'Open the trading page and check the margin balance and any fee rebates.';
  if (c.includes('yield')) return 'Open the vault page and check the accrued yield and any points balance.';
  if (c.includes('rwa')) return 'Open the asset page and check the yield accrual and any redemption window.';
  if (c.includes('stable')) return 'Open the stable asset page and check the peg and the redemption rate.';
  if (c.includes('basis')) return 'Open the basis vault page and check the funding profit and loss.';
  if (c.includes('risk')) return 'Open the curator page and check the vault allocation and any performance fee.';
  if (c.includes('curator') || c.includes('allocator')) return 'Open the allocator vault page and check the allocation and accrued yield.';
  if (c.includes('chain')) return 'Open the bridge page and check the transfer history.';
  if (c.includes('prediction')) return 'Open the market page and check the position and any settlement payout.';
  if (c.includes('payment')) return 'Open the payments page and check the transaction history and any cashback.';
  if (c.includes('leveraged farm')) return 'Open the vault page and check the leveraged yield and any points balance.';
  if (c.includes('restaking')) return 'Open the restaking page and check the rewards and any points balance.';
  if (c.includes('staking')) return 'Open the staking page and check the rewards and the unstaking window.';
  if (c.includes('liquidity')) return 'Open the managed vault page and check the range and the fees earned.';
  if (c.includes('card')) return 'Open the card page and check the spending and any cashback balance.';
  if (c.includes('btc')) return 'Open the asset page and check the peg and the collateral ratio.';
  if (c.includes('farm')) return 'Open the farm page and check the rewards and any harvest window.';
  if (c.includes('cedefi')) return 'Open the CeDeFi vault page and check the yield and any points balance.';
  return 'Open the protocol’s own points or rewards page from the link it publishes and check the balance.';
}

/** The category's unwind note: how to leave without losing the record. */
function unwindFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'Repay the borrow first, then withdraw the supply, and keep the receipts until the snapshot is taken.';
  if (c.includes('index')) return 'Sell the index tokens back in two halves and keep the trade receipts.';
  if (c.includes('dex')) return 'Remove the liquidity in two halves on different days so the position history stays visible.';
  if (c.includes('perpetual') || c.includes('derivative')) return 'Close every open position, withdraw the margin, and keep the trade history.';
  if (c.includes('yield')) return 'Unstake from the vault and withdraw in two halves, keeping the yield receipts.';
  if (c.includes('rwa')) return 'Redeem the asset in two halves and keep the redemption receipts.';
  if (c.includes('stable')) return 'Redeem the stable asset back to USDC and keep the mint receipts.';
  if (c.includes('basis')) return 'Close the basis position after the funding cycle ends, then withdraw.';
  if (c.includes('risk')) return 'Exit the curated vault in two halves and keep the allocation receipts.';
  if (c.includes('curator') || c.includes('allocator')) return 'Withdraw from the allocator vault in two halves and keep the vault-share receipts.';
  if (c.includes('chain')) return 'Bridge the funds back and keep the bridge receipts.';
  if (c.includes('prediction')) return 'Close the open market positions, withdraw, and keep the settlement receipts.';
  if (c.includes('payment')) return 'Withdraw the balance back to the funding wallet and keep the receipts.';
  if (c.includes('leveraged farm')) return 'Close the leveraged position first, then withdraw in two halves.';
  if (c.includes('restaking')) return 'Unstake in two halves and keep the restaking receipts.';
  if (c.includes('staking')) return 'Unstake in two halves and keep the staking receipts.';
  if (c.includes('liquidity')) return 'Exit the managed vault in two halves and keep the manager receipts.';
  if (c.includes('card')) return 'Spend down the card balance, then withdraw the remainder.';
  if (c.includes('btc')) return 'Withdraw the collateral in two halves and keep the receipts.';
  if (c.includes('farm')) return 'Harvest one last time, then withdraw in two halves.';
  if (c.includes('cedefi')) return 'Exit the CeDeFi vault in two halves and keep the receipts.';
  if (c.includes('governance')) return 'Undelegate the vote and withdraw in two halves.';
  if (c.includes('insurance')) return 'Let the cover term end, then withdraw, keeping the policy receipts.';
  return 'Withdraw in two halves on different days and keep the transaction hashes until the snapshot is taken.';
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 * The second step — verify the official app before depositing — is the plan's one anti-phishing
 * check (round 15): the protocol's own site, reached from DefiLlama's listing, never a link from
 * a reply or an ad.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const gas = capital >= 150 ? ECON.gas_main_big_usd : ECON.gas_main_usd;
  const wallet =
    p.chains.length > 1
      ? `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Fund it with USDC on ${chain} and keep a little native gas token on each chain you touch.`
      : `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Fund it with USDC on ${chain} and keep a little of the chain's native token for gas.`;
  return [
    {
      text: wallet,
      cost: `under $${ECON.gas_setup_usd} of gas for the first transaction`,
      time: '5 minutes',
    },
    {
      text: `Open ${p.name}'s official site from DefiLlama's listing and check the app address matches before you deposit — never follow a farm link from a reply or an ad.`,
      cost: 'no fee to check',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: weeklyFor(p, capital),
      cost: `about $${ECON.gas_weekly_usd} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `${claimFor(p)} Claim only from the link the protocol itself publishes, and never pay a fee to claim.`,
      cost: 'no fee to check',
      time: '10 minutes',
    },
    {
      text: `${unwindFor(p)} Write the wallet, the dates and every transaction in a farm log.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The plan's gas, from the same numbers the farm-step texts state: $3 to set the wallet up,
 *  $4 ($8 for a $150+ position) for the main deposit, $2 a week over the hold. */
const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * A protocol's farm plan netted to the dollar against its fitted implied value. The cost is the
 * plan's gas plus the yield forgone on the capital at 5% a year over the hold; the capital itself
 * comes back at unwind, so it is not a cost. The time is the plan's own minutes: 5 to set the
 * wallet up, 5 to verify the official app, 15 for the main deposit, 10 a week over the hold,
 * 10 to check the claim, 5 to log the unwind — the hold itself is passive. The farmer pool is
 * 10% of the implied value, split among 10,000 farmers. Every figure is rounded to cents before
 * it is stored, so the dashboard's arithmetic (gas + forgone yield = cost; expected − cost = net;
 * net ÷ hours = $/hour) is exact on the numbers it shows. The verdict follows from the numbers,
 * never from a name.
 */
export function farmEconomics(p: SnapshotProtocol, age: number | null, implied: number): FarmEconomics {
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const weeks = hold / 7;
  const gas = ECON.gas_setup_usd + (capital >= 150 ? ECON.gas_main_big_usd : ECON.gas_main_usd) + ECON.gas_weekly_usd * weeks;
  const opp = capital * ECON.opp_rate * (hold / 365);
  const gasUsd = round2(gas);
  const oppUsd = round2(opp);
  const total = round2(gasUsd + oppUsd);
  const hours = round2((40 + 10 * weeks) / 60);
  const expected = round2((ECON.pool_share * implied) / ECON.farmers);
  const breakeven = Math.round((total * ECON.farmers) / ECON.pool_share);
  const net = round2(expected - total);
  const perHour = round2(net / hours);
  const verdict: FarmEconomics['verdict'] =
    perHour >= ECON.hourly_bar_usd && expected >= ECON.safety_multiple * total
      ? 'farm'
      : expected > total
        ? 'thin'
        : 'skip';
  return {
    capital_usd: capital,
    hold_days: hold,
    cost_gas_usd: gasUsd,
    cost_opp_usd: oppUsd,
    cost_total_usd: total,
    hours,
    farmers: ECON.farmers,
    expected_usd: expected,
    breakeven_value_usd: breakeven,
    net_usd: net,
    usd_per_hour: perHour,
    verdict,
  };
}

/** The live-token protocols, by market cap, for the dashboard's Live token view: every
 *  protocol that records a token, exchanges included, so the tab's count (416) is the
 *  accounting bar's count. Round 15 drops the old top-24 cut and the CEX exclusion. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. The clock share is the row's age bucket from the
 *  no-token clock (round 14): the Unknown bucket's share when the listing date is unknown. */
export function radarRow(row: BoardRow, clock: NoTokenClock): RadarRow {
  const age = row.age_days;
  const bucket =
    age === null
      ? clock.buckets[clock.buckets.length - 1]!
      : age < 183
        ? clock.buckets[0]!
        : age < 365
          ? clock.buckets[1]!
          : age < 730
            ? clock.buckets[2]!
            : age < 1095
              ? clock.buckets[3]!
              : age < 1460
                ? clock.buckets[4]!
                : clock.buckets[5]!;
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    launch_odds: row.model.launch_odds,
    rank_low: row.model.rank_low,
    rank_high: row.model.rank_high,
    rank_boot_low: row.model.rank_boot_low,
    rank_boot_high: row.model.rank_boot_high,
    clock_share: bucket.share,
    farm_steps: row.farm_steps,
    economics: row.economics,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { fit, refits, bootRefits } = fitModel(snapshot);
  const odds = fitLaunchOdds(snapshot);
  const board = buildBoard(snapshot, model, fit, refits, odds, bootRefits);
  const clock = noTokenClock(snapshot);
  const live = liveRows(snapshot);
  const watch = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watch.has(r.slug) && r.tvl_usd < snapshot.floor_usd).length;
  const offlist = board.filter((r) => !watch.has(r.slug) && r.tvl_usd >= snapshot.floor_usd).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    fit,
    odds: { cv_accuracy: odds.cvAccuracy, base_rate: odds.baseRate, n: odds.n },
    clock,
    comps: compsFor(snapshot)
      .map((p) => ({ tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd as number }))
      .sort((a, b) => a.tvl_usd - b.tvl_usd),
    econ: ECON,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    offlist_size: offlist,
    live_size: live.length,
    watchlist: snapshot.watchlist.slice(),
    accounting: accountSnapshot(snapshot),
    setAside: setAsideSnapshot(snapshot),
    rows: board.map((r) => radarRow(r, clock)),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
