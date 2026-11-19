// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, a filterable table, and a per-protocol detail drawer with the model's own inputs
// and the protocol's farm plan. No network: every byte it shows is in data.js.
//
// The model, stated once and recomputed here from the same figures board.json carries, so the page's
// code and the board's data are visibly the same arithmetic:
//
//   curve        = exp(intercept + slope x ln TVL)   fitted to the snapshot's traded protocols
//   implied      = curve x growthMult x maturityMult x breadthMult x launchOdds
//   launchOdds   = fitted P(it records a token): logistic on category + log TVL + age + log chains
//   growthMult   = 1 + clamp(change_7d, -50, 150) / 100 x 1.0
//   maturityMult = 0.5 + min(age_days, 1460) / 1460 x 0.5   (age unknown: 365 days)
//   breadthMult  = 1 + 0.10 x min(chains - 1, 4)
//
// The farm economics are carried in each row (data.js), computed by the same code that writes
// board.json, so the page shows the board's own figures, never a second calculation:
//
//   cost         = plan gas ($3 + $4/$8 + $2/week over the hold) + 5%/yr forgone yield on capital
//   expected     = 10% of implied value / 50,000 farmers
//   breakeven    = cost x 50,000 / 10%   (the launch has to be worth this much to cover the cost)
//   net          = expected - cost
//   $/hour       = net / hours (35 fixed minutes + 10/week over the hold)
//   verdict      = FARM when $/hour >= the hourly bar (DATA.econ) and expected >= 2x cost; THIN when expected > cost;
//                  SKIP when the expected value does not cover the cost
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', list: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null, share: 0.10 };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  // The drop share as a number: 3.5 stays 3.5, not 4 (Math.round(3.5) is 4). Use sites
  // append the % themselves.
  function shareLabel(s) { var p = s * 100; return p % 1 ? p.toFixed(1) : String(p); }
  function fmtMoney(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
  }
  // Whole dollars with commas: $10,093,933.
  function fmtInt(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  // A count for prose: 103,000, 18.4 million.
  function fmtCount(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + ' million';
    if (n >= 1e3) return Math.round(n / 1e3) + ',000';
    return String(Math.round(n));
  }
  // The verdict badge: FARM green, THIN amber, SKIP slate. The SKIP badge uses class "pass"
  // (not "skip"): app.css already has a .skip rule for the skip-to-content link, which positions
  // anything with that class 9999px off-screen.
  function verdictBadge(v) {
    if (v === 'farm') return '<span class="verdict farm">FARM</span>';
    if (v === 'thin') return '<span class="verdict thin">THIN</span>';
    return '<span class="verdict pass">SKIP</span>';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function round4(n) { return Math.round(n * 1e4) / 1e4; }

  // ---- the model, recomputed from the row's own figures ----
  // The launch odds come from the row (fitted at build time); the four other multipliers
  // are recomputed here, so the page's arithmetic and the board's data stay visibly the same.
  function modelOf(row) {
    var m = DATA.model;
    var f = DATA.fit;
    var growthPct = Math.min(m.growth_cap, Math.max(m.growth_floor, typeof row.change_7d === 'number' && isFinite(row.change_7d) ? row.change_7d : 0));
    var growthMult = 1 + (growthPct / 100) * m.growth_weight;
    var age = row.age_days == null ? m.unknown_age_days : row.age_days;
    var maturityMult = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    var breadthMult = 1 + m.chain_step * Math.min(Math.max((row.chains || []).length - 1, 0), m.chain_max);
    var base = Math.exp(f.intercept + f.slope * Math.log(row.tvl_usd));
    var odds = typeof row.launch_odds === 'number' ? row.launch_odds : 1;
    var preOdds = Math.max(1, Math.round(base * growthMult * maturityMult * breadthMult));
    var implied = Math.max(1, Math.round(preOdds * odds));
    return { base: base, growthPct: growthPct, growthMult: round4(growthMult), maturityMult: round4(maturityMult), breadthMult: round4(breadthMult), launchOdds: odds, preOdds: preOdds, implied: implied };
  }

  // ---- filtering, sorting, rendering ----
  var isWatch = {};
  (DATA.watchlist || []).forEach(function (s) { isWatch[s] = true; });

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.list === 'watch' && !isWatch[r.slug]) return false;
      if (state.list === 'off' && (isWatch[r.slug] || r.tvl_usd < DATA.floor_usd)) return false;
      if (state.list === 'below' && (isWatch[r.slug] || r.tvl_usd >= DATA.floor_usd)) return false;
      if (state.category !== 'all' && (r.category || '') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (q) {
        var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }
  function sortedRows(rows) {
    var dir = state.dir;
    var key = state.sort;
    var val = function (r) {
      if (key === 'implied') return r.implied_value_usd;
      if (key === 'tvl') return r.tvl_usd;
      if (key === 'change') return r.change_7d === null ? -Infinity : r.change_7d;
      if (key === 'age') return r.age_days === null ? -1 : r.age_days;
      if (key === 'econ') return r.economics ? econFor(r, state.share).usd_per_hour : -Infinity;
      if (key === 'name') return r.name;
      return r.rank;
    };
    return rows.slice().sort(function (a, b) {
      var va = val(a), vb = val(b);
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return a.rank - b.rank;
    });
  }
  function maxImplied() {
    var m = 0;
    DATA.rows.forEach(function (r) { if (r.implied_value_usd > m) m = r.implied_value_usd; });
    return m || 1;
  }

  // ---- where the value sits: one bar per category, from the board's own rows ----
  // Top 10 categories by summed implied value, plus one "Other" bar for the rest.
  // The numbers are sums of DATA.rows, so the chart can only ever show what the
  // board says; the order is total descending, ties broken by category name.
  function categoryTotals() {
    var byCat = {};
    var grand = 0;
    DATA.rows.forEach(function (r) {
      var c = r.category || 'uncategorised';
      if (!byCat[c]) byCat[c] = { cat: c, total: 0, n: 0 };
      byCat[c].total += r.implied_value_usd;
      byCat[c].n += 1;
      grand += r.implied_value_usd;
    });
    var list = Object.keys(byCat).map(function (k) { return byCat[k]; });
    list.sort(function (a, b) { return b.total - a.total || (a.cat < b.cat ? -1 : a.cat > b.cat ? 1 : 0); });
    var top = list.slice(0, 10);
    var rest = list.slice(10);
    if (rest.length) {
      var otherTotal = 0, otherN = 0;
      rest.forEach(function (x) { otherTotal += x.total; otherN += x.n; });
      top.push({ cat: 'Other (' + rest.length + ' categories)', total: otherTotal, n: otherN, other: true });
    }
    return { rows: top, grand: grand };
  }

  function chartHtml() {
    var t = categoryTotals();
    var max = t.rows.length ? t.rows[0].total : 1;
    var W = 1100, LBL = 190, BARX = 200, BARW = 600, VALX = 812, ROWH = 30, TOP = 10;
    var H = TOP + t.rows.length * ROWH + 8;
    var bars = t.rows.map(function (x, i) {
      var y = TOP + i * ROWH;
      var w = Math.max(2, Math.round((x.total / max) * BARW));
      var share = (100 * x.total / t.grand).toFixed(1);
      var fill = x.other ? '#9db2c4' : '#e8a33d';
      return '<g data-cat="' + esc(x.cat) + '" data-total="' + x.total + '" data-rows="' + x.n + '">' +
        '<text class="lbl" x="' + LBL + '" y="' + (y + 15) + '" text-anchor="end">' + esc(x.cat) + '</text>' +
        '<rect x="' + BARX + '" y="' + (y + 4) + '" width="' + w + '" height="16" rx="3" fill="' + fill + '"/>' +
        '<text class="val" x="' + VALX + '" y="' + (y + 15) + '">' + fmtUsd(x.total) + ' · ' + x.n + ' row' + (x.n === 1 ? '' : 's') + ' · ' + share + '%</text>' +
        '</g>';
    }).join('');
    var lead = t.rows[0] ? t.rows[0].cat + ' holds ' + (100 * t.rows[0].total / t.grand).toFixed(1) + '% of the board\u2019s implied value' : '';
    return '<section class="card" id="chart"><h2>Where the value sits</h2>' +
      '<p>Total implied launch value by category, across all ' + DATA.board_size + ' pre-token rows. ' + esc(lead) + '.</p>' +
      '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Implied launch value by category. ' + esc(lead) + '.">' +
      '<title>Implied launch value by category</title>' + bars + '</svg></section>';
  }

  // ---- what moves the top 10: the four factors, row by row ----
  // For each of the top 10 rows, the four factors as bars on their own
  // scales (growth 0.5–2.5, maturity 0.5–1.0, breadth 1.0–1.4, launch odds 0–1), with the exact
  // figures and the implied value they multiply to as text. Every number comes
  // from modelOf(), which recomputes from the row's own figures — the chart can
  // only ever show what the board says.
  function factorsHtml() {
    var top = DATA.rows.slice().sort(function (a, b) { return a.rank - b.rank; }).slice(0, 10);
    var W = 1100, LBL = 155, ROWH = 30, TOP = 26, H = TOP + top.length * ROWH + 8;
    var groups = [
      { key: 'growthMult', label: 'Growth', min: 0.5, max: 2.5, x: 170, fill: '#1d7a4c' },
      { key: 'maturityMult', label: 'Maturity', min: 0.5, max: 1.0, x: 300, fill: '#16304f' },
      { key: 'breadthMult', label: 'Breadth', min: 1.0, max: 1.4, x: 430, fill: '#e8a33d' },
      { key: 'launchOdds', label: 'Launch odds', min: 0, max: 1, x: 560, fill: '#7a5aa6' }
    ];
    var head = groups.map(function (g) {
      return '<text class="val" x="' + g.x + '" y="18" font-weight="600">' + g.label + '</text>';
    }).join('') + '<text class="val" x="700" y="18" font-weight="600">Factors → implied value</text>';
    var rows = top.map(function (r, i) {
      var m = modelOf(r);
      var y = TOP + i * ROWH;
      var bars = groups.map(function (g) {
        var v = m[g.key];
        var w = Math.max(2, Math.round(((v - g.min) / (g.max - g.min)) * 110));
        return '<rect x="' + g.x + '" y="' + (y + 4) + '" width="110" height="14" rx="3" fill="#e6ebf0"/>' +
          '<rect x="' + g.x + '" y="' + (y + 4) + '" width="' + w + '" height="14" rx="3" fill="' + g.fill + '"/>';
      }).join('');
      return '<g data-slug="' + esc(r.slug) + '" data-growth="' + m.growthMult + '" data-maturity="' + m.maturityMult + '" data-breadth="' + m.breadthMult + '" data-odds="' + m.launchOdds + '" data-implied="' + m.implied + '">' +
        '<text class="lbl" x="' + LBL + '" y="' + (y + 15) + '" text-anchor="end">' + esc(r.name) + '</text>' + bars +
        '<text class="val" x="700" y="' + (y + 15) + '">×' + m.growthMult.toFixed(2) + ' · ×' + m.maturityMult.toFixed(2) + ' · ×' + m.breadthMult.toFixed(2) + ' · ×' + m.launchOdds.toFixed(2) + ' → ' + fmtUsd(m.implied) + '</text></g>';
    }).join('');
    return '<section class="card" id="factors"><h2>What moves the top 10</h2>' +
      '<p>Each of the top 10 rows, broken into the four factors on top of its fitted curve base. The bars run on each factor\u2019s own scale — growth 0.5–2.5, maturity 0.5–1.0, breadth 1.0–1.4, launch odds 0–1 — and the exact figures are on the right, with the implied value they multiply to.</p>' +
      '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Four-factor breakdown of the top 10 rows.">' +
      '<title>Four-factor breakdown of the top 10 rows</title>' + head + rows + '</svg></section>';
  }

  // ---- every protocol accounted for: the snapshot's full count, by disposition ----
  // The counts come from DATA.accounting, computed at build time from the snapshot itself.
  // They sum to the snapshot's protocol count, so nothing is silently dropped: the board's
  // ranked rows, the protocols whose token already trades, and the pre-token protocols set
  // aside, each for one stated reason.
  function accountHtml() {
    var a = DATA.accounting;
    var t = a.total || 1;
    var segs = [
      ['Ranked', a.ranked, '#e8a33d'],
      ['Already trades', a.trades, '#16304f'],
      ['Bridges', a.bridges, '#1d7a4c'],
      ['Liquid staking', a.liquidStaking, '#5b8a72'],
      ['Exchange custody', a.exchange, '#9db2c4'],
      ['Versioned', a.versioned, '#c4a55a'],
      ['Wrapped / staked', a.wrapped, '#7a6a4f']
    ];
    var bar = segs.map(function (s) {
      return '<span style="flex:0 0 ' + (100 * s[1] / t).toFixed(1) + '%;background:' + s[2] + '" title="' + s[0] + ': ' + s[1] + '"></span>';
    }).join('');
    var legend = segs.map(function (s) {
      return '<span style="white-space:nowrap"><span style="display:inline-block;width:10px;height:10px;background:' + s[2] + '"></span> ' + s[0] + ' <b>' + s[1] + '</b></span>';
    }).join(' · ');
    return '<section class="card" id="accounting"><h2>Every protocol accounted for</h2>' +
      '<p>The snapshot lists <b>' + a.total + '</b> protocols. <b>' + a.ranked + '</b> rank on this board, <b>' + a.trades + '</b> already record a token, and the rest are set aside for one stated reason each.</p>' +
      '<div style="display:flex;height:18px;border-radius:3px;overflow:hidden;margin:8px 0">' + bar + '</div>' +
      '<p>' + legend + '</p></section>';
  }

  // ---- the fit, as a scatter: traded comps, the curve, and the board (round 9) ----
  // Log-log: each traded comp is a grey dot at its TVL and market cap, each board row a
  // blue dot at its TVL and implied value, the fitted curve a gold line through them.
  // The comps come from DATA.comps (TVL + market cap each); the board rows from DATA.rows.
  function scatterHtml() {
    var W = 1100, H = 460, L = 70, R = 20, T = 20, B = 40;
    var pts = [];
    DATA.comps.forEach(function (c) { pts.push({ x: Math.log10(c.tvl_usd), y: Math.log10(c.mcap_usd), comp: true }); });
    DATA.rows.forEach(function (r) { pts.push({ x: Math.log10(r.tvl_usd), y: Math.log10(r.implied_value_usd), comp: false }); });
    var xs = pts.map(function (p) { return p.x; }), ys = pts.map(function (p) { return p.y; });
    var x0 = Math.floor(Math.min.apply(null, xs)), x1 = Math.ceil(Math.max.apply(null, xs));
    var y0 = Math.floor(Math.min.apply(null, ys)), y1 = Math.ceil(Math.max.apply(null, ys));
    var X = function (v) { return L + ((v - x0) / (x1 - x0)) * (W - L - R); };
    var Y = function (v) { return (H - B) - ((v - y0) / (y1 - y0)) * (H - T - B); };
    var ticks = '';
    var tickLabel = function (p) {
      if (p >= 1e9) return '$' + (p / 1e9) + 'B';
      if (p >= 1e6) return '$' + (p / 1e6) + 'M';
      return '$' + (p / 1e3) + 'K';
    };
    for (var tx = x0; tx <= x1; tx++) ticks += '<line x1="' + X(tx) + '" y1="' + (H - B) + '" x2="' + X(tx) + '" y2="' + T + '" stroke="#e6ebf0"/><text class="val" x="' + X(tx) + '" y="' + (H - 12) + '" text-anchor="' + (tx === x1 ? 'end' : 'middle') + '">' + tickLabel(Math.pow(10, tx)) + ' TVL</text>';
    for (var ty = y0; ty <= y1; ty++) ticks += '<line x1="' + L + '" y1="' + Y(ty) + '" x2="' + (W - R) + '" y2="' + Y(ty) + '" stroke="#e6ebf0"/><text class="val" x="' + (L - 8) + '" y="' + (Y(ty) + 4) + '" text-anchor="end">' + tickLabel(Math.pow(10, ty)) + '</text>';
    var f = DATA.fit;
    var line = '';
    for (var i = 0; i <= 40; i++) {
      var lx = x0 + (i / 40) * (x1 - x0);
      var ly = (f.intercept + f.slope * lx * Math.LN10) / Math.LN10;
      line += (i ? 'L' : 'M') + X(lx).toFixed(1) + ' ' + Y(ly).toFixed(1);
    }
    var dots = pts.map(function (p) {
      return '<circle cx="' + X(p.x).toFixed(1) + '" cy="' + Y(p.y).toFixed(1) + '" r="3" fill="' + (p.comp ? '#9db2c4' : '#16304f') + '" fill-opacity="' + (p.comp ? 0.7 : 0.9) + '"/>';
    }).join('');
    return '<section class="card" id="scatter"><h2>The fit, as a scatter</h2>' +
      '<p>Market cap against TVL, log-log. Grey dots are the ' + DATA.comps.length + ' traded protocols the curve is fitted to; blue dots are the ' + DATA.board_size + ' board rows at their implied values; the gold line is the fitted curve. The board rows sit where the curve says launches of their size are worth — the scatter is the fit, drawn.</p>' +
      '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Scatter plot of market cap against TVL with the fitted curve.">' +
      '<title>Market cap against TVL, with the fitted curve</title>' + ticks +
      '<path d="' + line + '" fill="none" stroke="#e8a33d" stroke-width="2"/>' + dots + '</svg>' +
      '<p><span style="white-space:nowrap"><span style="display:inline-block;width:10px;height:10px;background:#9db2c4"></span> traded comps</span> · <span style="white-space:nowrap"><span style="display:inline-block;width:10px;height:10px;background:#16304f"></span> board rows</span> · <span style="white-space:nowrap"><span style="display:inline-block;width:10px;height:10px;background:#e8a33d"></span> fitted curve</span></p></section>';
  }

  // ---- how the curve was fitted, and what its tests say ----
  // Every number comes from DATA.fit, which main.ts computes from the snapshot at run
  // time — the page states the fit, it never hardcodes it.
  function fitHtml() {
    var f = DATA.fit;
    function checkHtml(label, c, tail) {
      return '<dt>' + label + '</dt><dd>median error ×' + c.median_factor.toFixed(2) + ' · ' + Math.round(c.within_2x * 100) + '% within 2× · ' + c.n + ' ' + tail + '</dd>';
    }
    return '<h3>How the curve was fitted — and tested</h3>' +
      '<p>The curve is one pooled log-log regression on the ' + f.comps + ' traded protocols in this snapshot that are not wrappers, bridges or exchanges: log market cap = ' + f.intercept.toFixed(3) + ' + ' + f.slope.toFixed(3) + ' × log TVL (R² ' + f.r2.toFixed(2) + '). A launch is priced at what traded protocols of its size are worth — not at a hand-picked multiple.</p>' +
      '<p>Per-category curves were tested and did not beat the pooled curve out of sample (leave-one-out median error ×' + f.alt_cat_median_loo_median_factor.toFixed(2) + ' against the pooled curve’s ×' + f.loo.median_factor.toFixed(2) + '), so the board uses the one curve the data supports.</p>' +
      '<dl class="kv">' +
      checkHtml('Leave-one-out', f.loo, 'protocols') +
      checkHtml('Blind holdout', f.blind, 'protocols held out') +
      checkHtml('Walk-forward', f.walkforward, 'newer listings') +
      '<dt>Rank stability</dt><dd>every row’s rank range across ' + f.refits + ' leave-one-out refits — see any row’s detail view</dd>' +
      '</dl>' +
      '<p>The curve is a rough anchor, not a prediction: TVL explains only ' + Math.round(f.r2 * 100) + '% of market-cap variation across traded protocols, so the board’s absolute values carry wide error bars. What the curve does is replace a guessed multiple with the one the market’s own traded protocols imply.</p>' +
      '<p>Value ranges: the leave-one-out errors set a P25–P75 range of ×' + f.interval.lo50.toFixed(2) + '–×' + f.interval.hi50.toFixed(2) + ' around any fitted value and a P10–P90 range of ×' + f.interval.lo80.toFixed(2) + '–×' + f.interval.hi80.toFixed(2) + '. Checked on the blind holdout, ' + Math.round(f.interval.blindHit50 * 100) + '% of held-out caps land in the P25–P75 range (stated 50%) and ' + Math.round(f.interval.blindHit80 * 100) + '% in the P10–P90 range (stated 80%). Each row’s detail view shows its own ranges.</p>';
  }

  // ---- which value model: the variants, tested out of sample (round 8) ----
  // Every number comes from DATA.fit.selection, computed at run time — the page states
  // the table, it never hardcodes it. The adopted row is the full model the board runs.
  function selectionHtml() {
    var rows = DATA.fit.selection.map(function (x) {
      var adopted = x.variant === 'Curve + growth + maturity + breadth';
      return '<tr' + (adopted ? ' class="sel"' : '') + '><td>' + esc(x.variant) + (adopted ? ' — adopted' : '') + '</td><td class="num">×' + x.loo.toFixed(2) + '</td><td class="num">×' + x.walkforward.toFixed(2) + '</td></tr>';
    }).join('');
    return '<h3>Which value model — tested, not guessed</h3>' +
      '<p>Each variant is the same curve with different terms, tested out of sample on the ' + DATA.fit.comps + ' traded protocols. Growth helps on both tests, so it stays. The category premium helps on neither, so it is not used. Maturity and breadth are mixed — maturity helps leave-one-out and hurts walk-forward, breadth the reverse — and they stay on principle: a launch earned over years, and one that would distribute widely, is worth more than the traded curve alone says.</p>' +
      '<table class="board"><thead><tr><th>Variant</th><th class="num">Leave-one-out</th><th class="num">Walk-forward</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p>Launch odds are a separate fitted model: a logistic regression on all ' + DATA.odds.n + ' protocols — category, size, age and chains — predicting whether a protocol records a token. Held out, it calls the token right ' + Math.round(DATA.odds.cv_accuracy * 100) + '% of the time, against a ' + Math.round(DATA.odds.base_rate * 100) + '% base rate for always guessing the majority class.</p>';
  }

  // ---- the drop-share control: re-price a row's verdict (round 9) ----
  // The board prices every verdict at a 10% farmer share (past launches allocate 5–15%
  // to farmers). The reader can ask "what if the launch sets aside less?" — 3.5%, 7%
  // or 14% — and every verdict, expected value, break-even and $/hour is re-priced.
  // Only the share changes: the cost and the hours are the plan's own, so the farm
  // steps stay valid. With the share at 10% this reproduces the board's figures exactly
  // (the pagecheck verifies it row by row), because it is the same formula main.ts runs.
  function econFor(r, share) {
    var e = r.economics;
    var round2 = function (x) { return Math.round(x * 100) / 100; };
    var expected = round2((share * r.implied_value_usd) / DATA.econ.farmers);
    var breakeven = Math.round((e.cost_total_usd * DATA.econ.farmers) / share);
    var net = round2(expected - e.cost_total_usd);
    var perHour = round2(net / e.hours);
    var verdict = perHour >= DATA.econ.hourly_bar_usd && expected >= DATA.econ.safety_multiple * e.cost_total_usd
      ? 'farm' : expected > e.cost_total_usd ? 'thin' : 'skip';
    return { cost_total_usd: e.cost_total_usd, hours: e.hours, expected_usd: expected,
      breakeven_value_usd: breakeven, net_usd: net, usd_per_hour: perHour, verdict: verdict };
  }

  // ---- how the economics work: every row netted to the dollar ----
  // The verdict counts, the break-even range and the farmer-count range are computed from
  // DATA.rows, so the section can only ever state what the board says. The farmer-count range is
  // the TVL divided by the plan's position across the board — shown to explain why the board does
  // NOT estimate farmers that way.
  function econHtml() {
    var e = DATA.econ;
    var counts = { farm: 0, thin: 0, skip: 0 };
    var beMin = Infinity, beMax = -Infinity, ratioMin = Infinity, ratioMax = -Infinity;
    DATA.rows.forEach(function (r) {
      var ec = econFor(r, state.share);
      counts[ec.verdict]++;
      if (ec.breakeven_value_usd < beMin) beMin = ec.breakeven_value_usd;
      if (ec.breakeven_value_usd > beMax) beMax = ec.breakeven_value_usd;
      var ratio = r.tvl_usd / r.economics.capital_usd;
      if (ratio < ratioMin) ratioMin = ratio;
      if (ratio > ratioMax) ratioMax = ratio;
    });
    var poolPct = shareLabel(state.share);
    return '<h3>How the economics work — is it worth farming?</h3>' +
      '<p>Every row carries a verdict — farm, thin or skip — netted to the dollar from its own plan and its fitted value. The farmer pool is ' + poolPct + '% of the launch’s implied value (past launches allocate 5–15% to farmers; the board prices it at 10%, and the drop-share control above re-prices every verdict at 3.5%, 7% or 14%), split among an estimated ' + e.farmers.toLocaleString('en-US') + ' farmers. The cost is the plan’s gas — $' + e.gas_setup_usd + ' to set up, $' + e.gas_main_usd + ' or $' + e.gas_main_big_usd + ' for the main deposit, $' + e.gas_weekly_usd + ' a week over the hold — plus the yield forgone on the capital at ' + Math.round(e.opp_rate * 100) + '% a year; the capital itself comes back at unwind, so it is not a cost. The time is the plan’s own minutes: 35 fixed plus 10 a week.</p>' +
      '<p>Expected value per farmer = ' + poolPct + '% × implied value ÷ ' + e.farmers.toLocaleString('en-US') + '. Break-even launch value = cost × ' + e.farmers.toLocaleString('en-US') + ' ÷ ' + poolPct + '% — the launch has to be worth that much for one farmer’s share to cover the cost. Expected net = expected value − cost. Expected $/hour = net ÷ hours. Farm when the hour pays at least $' + e.hourly_bar_usd + ' and the expected value is at least ' + e.safety_multiple + '× the cost; thin when the value clears the cost but not the bar; skip when it does not cover the cost.</p>' +
      '<p>On this board, ' + counts.farm + ' rows farm, ' + counts.thin + ' are thin and ' + counts.skip + ' skip. The break-even launch value runs from ' + fmtInt(beMin) + ' to ' + fmtInt(beMax) + ' across the board — a launch has to be worth roughly that much for one farmer’s share to cover the gas. The farmer count does not come from the protocol’s TVL: TVL is whale-dominated, so dividing it by a $50–$250 position would imply ' + fmtCount(ratioMin) + ' to ' + fmtCount(ratioMax) + ' farmers, which no launch has — the board uses one flat estimate of ' + e.farmers.toLocaleString('en-US') + ' for every row, so the verdict compares launches on their value.</p>';
  }

  function rowHtml(r, max) {
    var m = modelOf(r);
    var ec = econFor(r, state.share);
    var pct = Math.max(2, Math.round((r.implied_value_usd / max) * 100));
    var chg = r.change_7d === null ? '<span class="mult">n/a</span>' : '<span class="' + (r.change_7d >= 0 ? 'up' : 'down') + '">' + fmtPct(r.change_7d) + '</span>';
    var badge = isWatch[r.slug] ? '<span class="badge watch">WATCHLIST</span>' : '<span class="badge early">EARLY</span>';
    return '<tr data-slug="' + esc(r.slug) + '"' + (state.selected === r.slug ? ' class="sel"' : '') + '>' +
      '<td class="rank">' + r.rank + '</td>' +
      '<td><strong>' + esc(r.name) + '</strong>' + badge + '<br><span class="mult">' + esc(r.category || 'uncategorised') + ' · ' + esc((r.chains || []).join(', ') || 'no chain') + '</span></td>' +
      '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
      '<td class="num">' + chg + '</td>' +
      '<td class="num">' + fmtAge(r.age_days) + '</td>' +
      '<td class="num"><strong>' + fmtUsd(r.implied_value_usd) + '</strong><div class="bar"><i style="width:' + pct + '%"></i></div>' +
      '<span class="mult">×' + m.growthMult.toFixed(2) + ' growth · ×' + m.maturityMult.toFixed(2) + ' age · ×' + m.breadthMult.toFixed(2) + ' chains · ×' + m.launchOdds.toFixed(2) + ' odds</span></td>' +
      '<td class="num" data-verdict="' + ec.verdict + '">' + verdictBadge(ec.verdict) + '<br><span class="mult">' + fmtMoney(ec.usd_per_hour) + '/h</span></td>' +
      '</tr>';
  }

  // ---- is it worth farming: the row's own plan netted to the dollar ----
  // Every figure comes from r.economics, re-priced at the reader's drop share by econFor
  // — at the 10% default it is the board's own figures; the cost and hours are the plan's,
  // so the farm steps stay valid at any share.
  function drawerEconHtml(r) {
    var e = econFor(r, state.share);
    var sharePct = shareLabel(state.share);
    var verdictLine = e.verdict === 'farm'
      ? 'Farm it: the hour pays well above the $' + DATA.econ.hourly_bar_usd + ' bar and the expected value is more than twice the cost.'
      : e.verdict === 'thin'
        ? 'Thin: the expected value clears the cost, but the hour does not pay the $' + DATA.econ.hourly_bar_usd + ' bar — farm it only if you value the optionality.'
        : 'Skip: the expected value does not cover the cost of the plan — the gas alone is more than one farmer’s share.';
    return '<h3>Is it worth farming?</h3>' +
      '<p>' + verdictBadge(e.verdict) + ' <strong>' + fmtMoney(e.usd_per_hour) + ' an hour</strong> — expected ' + fmtMoney(e.expected_usd) + ' per farmer against ' + fmtMoney(e.cost_total_usd) + ' of costs.</p>' +
      '<div class="factor"><span>Cost of the plan — gas ' + fmtMoney(r.economics.cost_gas_usd) + ' + ' + fmtMoney(r.economics.cost_opp_usd) + ' forgone yield on the $' + r.economics.capital_usd + ' position</span><span>' + fmtMoney(e.cost_total_usd) + '</span></div>' +
      '<div class="factor"><span>Time the plan takes — 35 fixed minutes + 10 a week over ' + r.economics.hold_days + ' days</span><span>' + e.hours.toFixed(2) + ' hours</span></div>' +
      '<div class="factor"><span>Farmers sharing the launch — ' + sharePct + '% of the launch goes to farmers</span><span>' + r.economics.farmers.toLocaleString('en-US') + '</span></div>' +
      '<div class="factor"><span>Expected value per farmer — ' + sharePct + '% of ' + fmtUsd(r.implied_value_usd) + ' ÷ 50,000 farmers</span><span>' + fmtMoney(e.expected_usd) + '</span></div>' +
      '<div class="factor"><span>Break-even launch value — the launch has to be worth this much for one farmer’s share to cover the cost</span><span>' + fmtInt(e.breakeven_value_usd) + '</span></div>' +
      '<div class="factor"><span>Expected net — expected value minus cost</span><span>' + fmtMoney(e.net_usd) + '</span></div>' +
      '<div class="factor"><span>Expected $/hour — net divided by the hours the plan takes</span><span>' + fmtMoney(e.usd_per_hour) + '</span></div>' +
      '<div class="factor"><span>Verdict — farm, thin or skip, from the numbers above</span><span>' + verdictBadge(e.verdict) + '</span></div>' +
      '<p>' + verdictLine + ' The verdict follows from the numbers: farm when the hour pays at least $' + DATA.econ.hourly_bar_usd + ' and the expected value is at least twice the cost; thin when the value clears the cost but not the bar; skip when it does not cover the cost. See “How the economics work” for the method.</p>';
  }

  function drawerHtml(r) {
    var m = modelOf(r);
    // The farm steps are the board's own strings (data.js carries them from board.json),
    // rendered as-is — the page never recomputes a plan, so it can only ever show the
    // board's plan. Each string is "action. Cost: ... Time: ...", split here for display.
    var steps = r.farm_steps || [];
    var base = Math.round(m.base);
    var rankRange = r.rank_low === r.rank_high ? '#' + r.rank_low : '#' + r.rank_low + '–#' + r.rank_high;
    var items = steps.map(function (s) {
      var cut = s.lastIndexOf(' Cost: ');
      var head = cut > 0 ? s.slice(0, cut) : s;
      var tail = cut > 0 ? s.slice(cut + 1) : '';
      return '<li><b>' + esc(head) + '</b><span>' + esc(tail) + '</span></li>';
    }).join('');
    return '<div class="drawer" role="dialog" aria-label="' + esc(r.name) + ' detail">' +
      '<button class="close" type="button" data-close="1">Close ✕</button>' +
      '<h2>' + esc(r.name) + '</h2>' +
      '<p class="sub">Rank #' + r.rank + ' · ' + esc(r.category || 'uncategorised') + ' · ' + esc((r.chains || []).join(', ') || 'no chain') + ' · ' + (isWatch[r.slug] ? 'on the watchlist' : (r.tvl_usd >= DATA.floor_usd ? 'off the watchlist, above the floor' : 'found early, below the watchlist floor')) + '</p>' +
      '<dl class="kv">' +
      '<dt>TVL</dt><dd>' + fmtUsd(r.tvl_usd) + '</dd>' +
      '<dt>7-day change</dt><dd>' + fmtPct(r.change_7d) + '</dd>' +
      '<dt>Listed</dt><dd>' + esc(r.listed_at || 'unknown') + ' (' + fmtAge(r.age_days) + ')</dd>' +
      '<dt>Token</dt><dd>records no token</dd>' +
      '<dt>Implied value</dt><dd><strong>' + fmtUsd(r.implied_value_usd) + '</strong></dd>' +
      '</dl>' +
      drawerEconHtml(r) +
      '<h3>How the value is worked out</h3>' +
      '<div class="factor"><span>Curve — fitted to ' + DATA.fit.comps + ' traded protocols</span><span>' + fmtUsd(base) + '</span></div>' +
      '<div class="factor"><span>Growth — ' + fmtPct(m.growthPct) + ' over 7 days</span><span>×' + m.growthMult.toFixed(2) + '</span></div>' +
      '<div class="factor"><span>Maturity — ' + fmtAge(r.age_days) + ' with no token</span><span>×' + m.maturityMult.toFixed(2) + '</span></div>' +
      '<div class="factor"><span>Breadth — ' + (r.chains || []).length + ' chain' + ((r.chains || []).length === 1 ? '' : 's') + '</span><span>×' + m.breadthMult.toFixed(2) + '</span></div>' +
      '<div class="factor"><span>Value if it launches — curve × growth × maturity × breadth</span><span>' + fmtUsd(m.preOdds) + '</span></div>' +
      '<div class="factor"><span>Launch odds — fitted P(it records a token)</span><span>×' + m.launchOdds.toFixed(2) + '</span></div>' +
      '<div class="factor"><span><strong>Implied launch value</strong></span><span><strong>' + fmtUsd(m.implied) + '</strong></span></div>' +
      '<div class="factor"><span>P25–P75 value range — half of held-out caps land in it</span><span>' + fmtUsd(r.implied_value_usd * DATA.fit.interval.lo50) + ' – ' + fmtUsd(r.implied_value_usd * DATA.fit.interval.hi50) + '</span></div>' +
      '<div class="factor"><span>P10–P90 value range — four fifths of held-out caps land in it</span><span>' + fmtUsd(r.implied_value_usd * DATA.fit.interval.lo80) + ' – ' + fmtUsd(r.implied_value_usd * DATA.fit.interval.hi80) + '</span></div>' +
      '<div class="factor"><span>Rank across ' + DATA.fit.refits + ' leave-one-out refits</span><span>' + rankRange + '</span></div>' +
      '<p>The page recomputes this from the same figures the board carries' + (m.implied === r.implied_value_usd ? '; it matches the board.' : '.') + ' The curve is log market cap = ' + DATA.fit.intercept.toFixed(3) + ' + ' + DATA.fit.slope.toFixed(3) + ' × log TVL, fitted to the traded protocols in this snapshot — see “How the radar scores” for the fit and its tests.</p>' +
      '<h3>How to farm it</h3>' +
      '<ol class="steps">' + items + '</ol>' +
      '<p>Farm only with money you can lose. A protocol that records no token may never issue one, and a farm plan is not a promise of an airdrop.</p>' +
      '</div>';
  }

  function render() {
    var max = maxImplied();
    var farmCount = 0;
    DATA.rows.forEach(function (r) { if (econFor(r, state.share).verdict === 'farm') farmCount++; });
    var cats = [];
    var catSeen = {};
    DATA.rows.forEach(function (r) { var c = r.category || 'uncategorised'; if (!catSeen[c]) { catSeen[c] = true; cats.push(c); } });
    cats.sort();
    var chains = [];
    var chainSeen = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { if (!chainSeen[c]) { chainSeen[c] = true; chains.push(c); } }); });
    chains.sort();
    var rows = state.tab === 'live' ? DATA.live : sortedRows(filteredRows());
    var liveHtml = '';
    if (state.tab === 'live') {
      liveHtml = '<table class="board"><thead><tr><th>Protocol</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">7-day</th></tr></thead><tbody>' +
        DATA.live.map(function (p) {
          return '<tr><td><strong>' + esc(p.name) + '</strong><br><span class="mult">' + esc(p.category || 'uncategorised') + ' · ' + esc((p.chains || []).join(', ') || 'no chain') + '</span></td>' +
            '<td class="num">' + fmtUsd(p.tvl_usd) + '</td><td class="num">' + fmtUsd(p.mcap_usd) + '</td><td class="num">' + fmtPct(p.change_7d) + '</td></tr>';
        }).join('') + '</tbody></table>' +
        '<p class="count">These tokens already trade, so the board shows the market\u2019s own value for them instead of a model\u2019s. They are kept apart from the pre-token board.</p>';
    }
    var sortBtn = function (key, label) {
      var arrow = state.sort === key ? (state.dir === -1 ? ' ↓' : ' ↑') : '';
      return '<button type="button" data-sort="' + key + '">' + label + arrow + '</button>';
    };
    var tableHtml = state.tab === 'live' ? liveHtml :
      '<table class="board"><thead><tr><th>' + sortBtn('rank', 'Rank') + '</th><th>' + sortBtn('name', 'Protocol') + '</th><th class="num">' + sortBtn('tvl', 'TVL') + '</th><th class="num">' + sortBtn('change', '7-day') + '</th><th class="num">' + sortBtn('age', 'Age') + '</th><th class="num">' + sortBtn('implied', 'Implied value') + '</th><th class="num">' + sortBtn('econ', 'Verdict') + '</th></tr></thead><tbody>' +
      (rows.length ? rows.map(function (r) { return rowHtml(r, max); }).join('') : '<tr><td colspan="7" class="empty">Nothing matches this filter.</td></tr>') +
      '</tbody></table>';
    var selected = null;
    if (state.selected) {
      for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === state.selected) { selected = DATA.rows[i]; break; }
    }
    app.innerHTML =
      '<header class="hero"><div class="wrap">' +
      '<h1>Token Launch Radar <span>— fitted comps curve, blind-tested, farm plans netted to the dollar</span></h1>' +
      '<p><strong>' + DATA.board_size + ' pre-token protocols</strong>, ranked by what their launch would be worth. Every row records no token on DefiLlama; wrapped, staked and bridged products are left out, because they are a token that already trades, in another form. Snapshot ' + esc(DATA.as_of) + ' · ' + esc(DATA.source) + '.</p>' +
      '<p>Launch values are <strong>fitted</strong> to the snapshot\u2019s own traded protocols and <strong>tested blind</strong> — leave-one-out ×' + DATA.fit.loo.median_factor.toFixed(2) + ', blind holdout ×' + DATA.fit.blind.median_factor.toFixed(2) + ', walk-forward ×' + DATA.fit.walkforward.median_factor.toFixed(2) + ' — <strong>weighted by fitted launch odds</strong> (the probability the protocol ever records a token, fitted on all ' + DATA.odds.n + ' protocols, ' + Math.round(DATA.odds.cv_accuracy * 100) + '% held out vs ' + Math.round(DATA.odds.base_rate * 100) + '% base), and every farm plan is <strong>netted to the dollar</strong>: break-even launch value, $/hour and a farm / thin / skip verdict.</p>' +
      '<div class="stats">' +
      '<div class="stat"><b>' + DATA.board_size + '</b><span>pre-token rows</span></div>' +
      '<div class="stat"><b>' + DATA.watchlist_size + '</b><span>on the watchlist</span></div>' +
      '<div class="stat"><b>' + DATA.offlist_size + '</b><span>off list, above the floor</span></div>' +
      '<div class="stat"><b>' + DATA.early_size + '</b><span>found early, below the floor</span></div>' +
      '<div class="stat"><b>' + DATA.live_size + '</b><span>live tokens set aside</span></div>' +
      '<div class="stat"><b>' + fmtUsd(DATA.rows[0] ? DATA.rows[0].implied_value_usd : 0) + '</b><span>top implied value</span></div>' +
      '<div class="stat"><b>' + farmCount + '</b><span>farm verdicts</span></div>' +
      '</div></div></header>' +
      '<div class="wrap">' +
      accountHtml() +
      chartHtml() +
      factorsHtml() +
      scatterHtml() +
      '<section class="card"><h2>How the radar scores</h2>' +
      '<p>One formula, the same for every row, from the snapshot\u2019s own figures — the base is fitted, not guessed.</p>' +
      '<div class="model-grid">' +
      '<div class="model-cell"><b>Curve — fitted size</b><span>log market cap on log TVL, fitted to ' + DATA.fit.comps + ' traded protocols</span><br><code>curve = exp(' + DATA.fit.intercept.toFixed(3) + ' + ' + DATA.fit.slope.toFixed(3) + ' × ln TVL)</code></div>' +
      '<div class="model-cell"><b>Growth — momentum</b><span>7-day TVL change, clamped −50%…+150%</span><br><code>× (1 + growth)</code></div>' +
      '<div class="model-cell"><b>Maturity — earned time</b><span>days listed with no token, up to 4 years</span><br><code>× (0.5 + age/1460 × 0.5)</code></div>' +
      '<div class="model-cell"><b>Breadth — distribution</b><span>one chain is the base, up to +40%</span><br><code>× (1 + 0.10 × min(chains − 1, 4))</code></div>' +
      '<div class="model-cell"><b>Launch odds — will it launch</b><span>fitted P(it records a token), ' + Math.round(DATA.odds.cv_accuracy * 100) + '% held out vs ' + Math.round(DATA.odds.base_rate * 100) + '% base</span><br><code>× P(launches)</code></div>' +
      '</div>' +
      '<p>Implied value = curve × growth × maturity × breadth × launch odds. A protocol listed 3 years ago with no token scores near the full maturity factor; one listed last month scores near the floor. The odds are a fitted probability, not a guess: the logistic regression is fitted on all ' + DATA.odds.n + ' protocols in the snapshot and validated out of sample — see “Which value model” below. Click any row to see its own five factors worked out, and the rank its row holds across the curve’s refits.</p>' +
      fitHtml() +
      selectionHtml() +
      econHtml() +
      '</section>' +
      '<section class="card" id="board-card">' +
      '<div class="tabs" role="group" aria-label="Views">' +
      '<button type="button" data-tab="pre-token" aria-pressed="' + (state.tab === 'pre-token') + '">Pre-token board (' + DATA.board_size + ')</button>' +
      '<button type="button" data-tab="live" aria-pressed="' + (state.tab === 'live') + '">Live tokens (' + DATA.live_size + ')</button>' +
      '</div>' +
      '<div class="controls" style="margin-top:12px">' +
      '<input type="search" id="q" placeholder="Search name, slug or category…" value="' + esc(state.q) + '" aria-label="Search">' +
      '<select id="cat" aria-label="Category"><option value="all">All categories</option>' + cats.map(function (c) { return '<option value="' + esc(c) + '"' + (state.category === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
      '<select id="chain" aria-label="Chain"><option value="all">All chains</option>' + chains.map(function (c) { return '<option value="' + esc(c) + '"' + (state.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
      '<select id="list" aria-label="Watchlist"><option value="all">All rows (' + DATA.board_size + ')</option><option value="watch"' + (state.list === 'watch' ? ' selected' : '') + '>Watchlist only (' + DATA.watchlist_size + ')</option><option value="off"' + (state.list === 'off' ? ' selected' : '') + '>Off list (' + DATA.offlist_size + ')</option><option value="below"' + (state.list === 'below' ? ' selected' : '') + '>Below floor (' + DATA.early_size + ')</option></select>' +
      '<button type="button" id="csv">Export CSV</button>' +
      '<label for="share">Drop share <select id="share" aria-label="Farmer drop share"><option value="0.10"' + (state.share === 0.10 ? ' selected' : '') + '>10% (board)</option><option value="0.035"' + (state.share === 0.035 ? ' selected' : '') + '>3.5%</option><option value="0.07"' + (state.share === 0.07 ? ' selected' : '') + '>7%</option><option value="0.14"' + (state.share === 0.14 ? ' selected' : '') + '>14%</option></select></label>' +
      '</div>' +
      '<p class="count">' + (state.tab === 'live' ? 'Tokens that already trade, by market cap.' : 'Showing ' + rows.length + ' of ' + DATA.board_size + ' pre-token rows, ranked by implied launch value.') + '</p>' +
      '<div class="table-wrap">' + tableHtml + '</div>' +
      '</section>' +
      '<footer class="note"><p>Method: the board ranks protocols that record no token (no market cap, no CoinGecko id, no symbol) on DefiLlama\u2019s snapshot of ' + esc(DATA.as_of) + '. The watchlist (TVL ≥ $50M) is the floor; the radar also carries every genuine pre-token protocol beyond it — above the floor and below it, so a launch can be found wherever it sits. Wrapped, staked, bridged and exchange products are excluded: they are a token that already trades, in another form. The implied value is fitted to the snapshot\u2019s traded protocols and tested out of sample — the fit is stated in “How the radar scores”. The verdict on each row is the farm plan netted to the dollar — its cost, its expected value per farmer and its $/hour — see “How the economics work”. The snapshot carries no ranking and no farm plan — both are this entry\u2019s work, and the task does not predict whether or when a token is issued. Farm plans are guides, not promises of an airdrop.</p></footer>' +
      '</div>' +
      (selected ? drawerHtml(selected) : '');
    app.removeAttribute('aria-busy');
    bind();
  }

  function writeHash() {
    var parts = [];
    if (state.tab !== 'pre-token') parts.push('tab=' + state.tab);
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.category !== 'all') parts.push('cat=' + encodeURIComponent(state.category));
    if (state.chain !== 'all') parts.push('chain=' + encodeURIComponent(state.chain));
    if (state.list !== 'all') parts.push('list=' + state.list);
    if (state.selected) parts.push('slug=' + encodeURIComponent(state.selected));
    var h = parts.length ? '#' + parts.join('&') : '';
    if (location.hash !== h) history.replaceState(null, '', h || location.pathname + location.search);
  }

  function readHash() {
    var h = location.hash.replace(/^#/, '');
    if (!h) return;
    h.split('&').forEach(function (pair) {
      var kv = pair.split('=');
      var k = kv[0], v = decodeURIComponent(kv[1] || '');
      if (k === 'tab' && (v === 'live' || v === 'pre-token')) state.tab = v;
      if (k === 'q') state.q = v;
      if (k === 'cat') state.category = v;
      if (k === 'chain') state.chain = v;
      if (k === 'list' && (v === 'watch' || v === 'off' || v === 'below')) state.list = v;
      if (k === 'slug') state.selected = v;
    });
  }

  // ---- CSV export: the rows on screen, as a file (round 9) ----
  // Exports the current view (filtered + sorted, or the live tokens) so a reader can
  // take the board into a spreadsheet. Values are the board's own figures.
  function downloadCsv() {
    var rows = state.tab === 'live' ? DATA.live : sortedRows(filteredRows());
    var escCsv = function (v) {
      var s = String(v == null ? '' : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    var lines = rows.map(function (r) {
      var ec = r.economics ? econFor(r, state.share) : null;
      return [r.rank || '', r.name, r.slug, r.category || '', (r.chains || []).join(';'), r.tvl_usd,
        r.change_7d == null ? '' : r.change_7d, r.age_days == null ? '' : r.age_days,
        r.implied_value_usd != null ? r.implied_value_usd : (r.mcap_usd || ''),
        r.launch_odds == null ? '' : r.launch_odds,
        ec ? ec.verdict : '',
        ec ? ec.usd_per_hour : ''].map(escCsv).join(',');
    });
    var blob = new Blob(['rank,name,slug,category,chains,tvl_usd,change_7d,age_days,implied_value_usd,launch_odds,verdict,usd_per_hour\n' + lines.join('\n')], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'token-launch-radar.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function bind() {
    var q = document.getElementById('q');
    if (q) q.addEventListener('input', function () { state.q = q.value; state.selected = null; render(); writeHash(); });
    var cat = document.getElementById('cat');
    if (cat) cat.addEventListener('change', function () { state.category = cat.value; state.selected = null; render(); writeHash(); });
    var chain = document.getElementById('chain');
    if (chain) chain.addEventListener('change', function () { state.chain = chain.value; state.selected = null; render(); writeHash(); });
    var list = document.getElementById('list');
    if (list) list.addEventListener('change', function () { state.list = list.value; state.selected = null; render(); writeHash(); });
    var csv = document.getElementById('csv');
    if (csv) csv.addEventListener('click', downloadCsv);
    var share = document.getElementById('share');
    if (share) share.addEventListener('change', function () { state.share = parseFloat(share.value); state.selected = null; render(); writeHash(); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-tab]'), function (b) {
      b.addEventListener('click', function () { state.tab = b.getAttribute('data-tab'); state.selected = null; render(); writeHash(); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-sort]'), function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-sort');
        if (state.sort === k) state.dir = -state.dir;
        else { state.sort = k; state.dir = k === 'name' ? 1 : -1; }
        render(); writeHash();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('table.board tbody tr[data-slug]'), function (tr) {
      tr.addEventListener('click', function () {
        state.selected = tr.getAttribute('data-slug');
        render(); writeHash();
        var d = document.querySelector('.drawer');
        if (d) d.scrollTop = 0;
      });
    });
    var close = document.querySelector('[data-close]');
    if (close) close.addEventListener('click', function () { state.selected = null; render(); writeHash(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.selected) { state.selected = null; render(); writeHash(); }
    });
  }

  readHash();
  render();
  // A deep link to a filtered view lands on the board, so a shared link shows
  // the filtered table instead of the top of the page.
  if (/[#&](cat|chain|q|list)=/.test(location.hash)) {
    var bc = document.getElementById('board-card');
    if (bc) bc.scrollIntoView();
  }
})();
