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
//   growth = clamp(change_7d, -50, 150) per cent; growthMult = 1 + (growth / 100) x 1.0
//   maturity = 0.5 + min(age_days, 1460) / 1460 x 0.5   (age unknown: 365 days)
//   breadth  = 1 + 0.10 x min(chains - 1, 4)
//   implied  = max(1, round(curve x growthMult x maturityMult x breadthMult))
//
// The curve is fitted to the 94 traded protocols in the snapshot that are not wrappers, bridges or
// exchanges (a market cap and a TVL each). One pooled curve, not one per category: per-category
// curves were tested and did NOT beat the pooled curve out of sample (leave-one-out median error
// about 5.2x against the pooled curve's 3.7x), so the board uses the one curve the data supports.
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
// falls as TVL grows). Growth passes through 1:1, maturity spreads 0.50-1.00, breadth 1.00-1.40:
// those three are stated adjustments on top of the fitted base, unchanged from radar-3.
//
// Farm economics (radar-5, round 5): every row is netted to the dollar from its own plan and its
// fitted value. The farmer pool is 10% of the implied value (past launches allocate 5-15% to
// farmers; the board uses the 10% midpoint), split among an estimated 50,000 farmers. The cost is
// the plan's gas plus the yield forgone on the capital at 5% a year; the capital itself comes back
// at unwind, so it is not a cost. The farmer count is one flat estimate for every row, not the
// protocol's TVL divided by a position: TVL is whale-dominated, so that division would imply
// 100,000 to 18 million farmers, which no launch has. Break-even value = cost x 50,000 / 10%.
// Verdict: farm when the hour pays at least $20 and the expected value is at least twice the
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
  growth_weight: 1.0,
  growth_floor: -50,
  growth_cap: 150,
  maturity_floor: 0.5,
  maturity_range: 0.5,
  maturity_days: 1460,
  unknown_age_days: 365,
  chain_step: 0.1,
  chain_max: 4,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-5';

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
  farmers: 50000,
  opp_rate: 0.05,
  gas_setup_usd: 3,
  gas_main_usd: 4,
  gas_main_big_usd: 8,
  gas_weekly_usd: 2,
  hourly_bar_usd: 20,
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
    age_days: number | null;
    /** The row's implied value and rank across the leave-one-out refits of the curve. */
    implied_low_usd: number;
    implied_high_usd: number;
    rank_low: number;
    rank_high: number;
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
  rank_low: number;
  rank_high: number;
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

/** Everything the dashboard needs: the board, the live set, the model it runs, and the fit it was fitted with. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  fit: FitReport;
  econ: EconConstants;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  watchlist: string[];
  rows: RadarRow[];
  live: LiveRow[];
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
 * Returns the fit report and the leave-one-out refits (one per comp, in slug order),
 * which the board uses for each row's rank range. Every split is deterministic: the
 * blind holdout is the top 20% of comps by slug hash, the walk-forward split is the
 * median listing date among comps that carry one.
 */
export function fitModel(snapshot: Snapshot): { fit: FitReport; refits: CurveFit[] } {
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
  };
  return { fit, refits };
}

/** The four multipliers and the implied value one protocol gets under `model` and the fitted curve. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  fit: CurveFit,
): { implied: number; curveBase: number; curveMultiple: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult = 1 + model.chain_step * Math.min(Math.max(protocol.chains.length - 1, 0), model.chain_max);
  const curveBase = Math.exp(fit.intercept + fit.slope * Math.log(protocol.tvl_usd));
  const implied = Math.max(1, Math.round(curveBase * growthMult * maturityMult * breadthMult));
  return { implied, curveBase, curveMultiple: round4(curveBase / protocol.tvl_usd), growthPct, growthMult, maturityMult, breadthMult, age };
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
export function buildBoard(snapshot: Snapshot, model: ModelConstants, fit: CurveFit, refits: CurveFit[]): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug on it is ranked, whatever its size.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every genuine pre-token protocol below the watchlist floor, by TVL.
  // No cap: the radar exists to find them all, and the gate allows up to 4,000 rows.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const { implied, curveBase, curveMultiple, growthPct, growthMult, maturityMult, breadthMult, age } = impliedValue(p, snapshot.as_of, model, fit);
    return { p, implied, curveBase, curveMultiple, growthPct, growthMult, maturityMult, breadthMult, age, economics: farmEconomics(p, age, implied) };
  });
  // Rank ranges: re-price every row under each leave-one-out refit and re-rank. The multipliers
  // do not depend on the fit, so only the curve's base moves.
  const ranges = new Map<string, { low: number; high: number; rankLow: number; rankHigh: number }>();
  for (const r of refits) {
    const priced = scored.map((s) => ({
      slug: s.p.slug,
      implied: Math.max(1, Math.round(Math.exp(r.intercept + r.slope * Math.log(s.p.tvl_usd)) * s.growthMult * s.maturityMult * s.breadthMult)),
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
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => {
    const range = ranges.get(s.p.slug) ?? { low: s.implied, high: s.implied, rankLow: i + 1, rankHigh: i + 1 };
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
        age_days: s.age,
        implied_low_usd: range.low,
        implied_high_usd: range.high,
        rank_low: range.rankLow,
        rank_high: range.rankHigh,
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
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
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
 * wallet up, 15 for the main deposit, 10 a week over the hold, 10 to check the claim, 5 to log
 * the unwind — the hold itself is passive. The farmer pool is 10% of the implied value, split
 * among 50,000 farmers. Every figure is rounded to cents before it is stored, so the
 * dashboard's arithmetic (gas + forgone yield = cost; expected − cost = net; net ÷ hours =
 * $/hour) is exact on the numbers it shows. The verdict follows from the numbers, never from
 * a name.
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
  const hours = round2((35 + 10 * weeks) / 60);
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

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 24)
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

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
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
    rank_low: row.model.rank_low,
    rank_high: row.model.rank_high,
    economics: row.economics,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { fit, refits } = fitModel(snapshot);
  const board = buildBoard(snapshot, model, fit, refits);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    fit,
    econ: ECON,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    watchlist: snapshot.watchlist.slice(),
    rows: board.map(radarRow),
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
