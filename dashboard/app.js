// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, a filterable table, and a per-protocol detail drawer with the model's own inputs
// and the protocol's farm plan. No network: every byte it shows is in data.js.
//
// The model, stated once and recomputed here from the same figures board.json carries, so the page's
// code and the board's data are visibly the same arithmetic:
//
//   curve        = exp(intercept + slope x ln TVL)   fitted to the snapshot's traded protocols
//   implied      = curve x growthMult x maturityMult x breadthMult
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
//   verdict      = FARM when $/hour >= $20 and expected >= 2x cost; THIN when expected > cost;
//                  SKIP when the expected value does not cover the cost
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', watchOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

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
  // Dollars to the cent, sign in front: $100.80, -$4.49.
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
  function modelOf(row) {
    var m = DATA.model;
    var f = DATA.fit;
    var growthPct = Math.min(m.growth_cap, Math.max(m.growth_floor, typeof row.change_7d === 'number' && isFinite(row.change_7d) ? row.change_7d : 0));
    var growthMult = 1 + (growthPct / 100) * m.growth_weight;
    var age = row.age_days == null ? m.unknown_age_days : row.age_days;
    var maturityMult = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    var breadthMult = 1 + m.chain_step * Math.min(Math.max((row.chains || []).length - 1, 0), m.chain_max);
    var base = Math.exp(f.intercept + f.slope * Math.log(row.tvl_usd));
    var implied = Math.max(1, Math.round(base * growthMult * maturityMult * breadthMult));
    return { base: base, growthPct: growthPct, growthMult: round4(growthMult), maturityMult: round4(maturityMult), breadthMult: round4(breadthMult), implied: implied };
  }

  // ---- the farm plan, generated from the row's own record ----
  function capitalFor(row) {
    if (row.tvl_usd >= 5e9) return 250;
    if (row.tvl_usd >= 1e9) return 150;
    if (row.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function cat(row) { return String(row.category || '').toLowerCase(); }
  function actionFor(row, capital, chain) {
    var c = cat(row);
    var name = row.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ', then borrow $20 against it so the position counts as active lending and borrowing.';
    if (c.indexOf('index') >= 0) return 'Deposit $' + capital + ' of USDC into the ' + name + ' index on ' + chain + ' and hold the index tokens.';
    if (c.indexOf('dex') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + '\'s main pool on ' + chain + ' in a narrow range, and route one swap through it each week.';
    if (c.indexOf('leveraged farm') >= 0 || c.indexOf('yield aggregator') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + '\'s highest-TVL vault on ' + chain + ' and leave the receipt tokens in the wallet.';
    if (c.indexOf('yield') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + '\'s main yield vault on ' + chain + ' and keep the position open.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' on ' + chain + ', open one small long and one small short, then close the short.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' on ' + name + ' and place one small position on a market that settles this month.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the vault shares in the farming wallet.';
    if (c.indexOf('stable') >= 0) return 'Mint $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' with USDC collateral and hold the minted tokens.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + ' of ' + name + '\'s yield-bearing asset on ' + chain + ' and hold it in the farming wallet.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' for a 30-day term and keep the policy active.';
    if (c.indexOf('basis') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + '\'s basis vault on ' + chain + ' and keep the position open through one funding cycle.';
    if (c.indexOf('governance') >= 0) return 'Deposit $' + capital + ' into ' + name + ' on ' + chain + ', take the voting receipt, and vote on the next open proposal.';
    if (c.indexOf('payment') >= 0) return 'Fund $' + capital + ' on ' + name + ' on ' + chain + ' and send one payment through its app each week.';
    if (c.indexOf('risk') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' curated vault on ' + chain + ' and keep the vault shares.';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' and use it in one app on the chain through ' + name + '.';
    if (c.indexOf('restaking') >= 0) return 'Stake $' + capital + ' of liquid staking tokens with ' + name + ' on ' + chain + ' and keep the receipt tokens.';
    if (c.indexOf('staking') >= 0) return 'Deposit $' + capital + ' of USDC into the ' + name + ' staking pool on ' + chain + ' and keep the receipt tokens.';
    if (c.indexOf('liquidity') >= 0) return 'Deposit $' + capital + ' of USDC into a ' + name + ' managed vault on ' + chain + ' and let the manager set the range.';
    if (c.indexOf('card') >= 0) return 'Top up $' + capital + ' on the ' + name + ' card on ' + chain + ' and spend a little through it each week.';
    if (c.indexOf('btc') >= 0) return 'Deposit $' + capital + ' of USDC with ' + name + ' on ' + chain + ' and keep the receipt tokens.';
    if (c.indexOf('farm') >= 0) return 'Deposit $' + capital + ' of USDC into the ' + name + ' farm on ' + chain + ' and keep the receipt tokens.';
    if (c.indexOf('cedefi') >= 0) return 'Deposit $' + capital + ' of USDC into the ' + name + ' CeDeFi vault on ' + chain + ' and keep the position open.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function weeklyFor(row, capital) {
    var c = cat(row);
    var amt = capital >= 150 ? 25 : 10;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Repay $5 of the borrow and borrow it back, so the position shows fresh lending activity.';
    if (c.indexOf('index') >= 0) return 'Check the index rebalance and add $' + amt + ' if a new asset entered it.';
    if (c.indexOf('dex') >= 0) return 'Swap $' + amt + ' through the pool and re-balance the range if the price moved out of it.';
    if (c.indexOf('leveraged farm') >= 0 || c.indexOf('yield aggregator') >= 0) return 'Harvest the vault yield and re-deposit it, so the position compounds instead of sitting idle.';
    if (c.indexOf('yield') >= 0) return 'Claim any accrued yield into the vault and keep the principal staked for another week.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Open and close one small position, keeping the total volume low.';
    if (c.indexOf('prediction') >= 0) return 'Place one small position on a new market that settles soon.';
    if (c.indexOf('risk') >= 0) return 'Check the vault allocation and top up $' + amt + ' if the curator rebalanced into a new market.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Check the latest vault allocation and move $' + amt + ' into the newest market if the allocator opened one.';
    if (c.indexOf('stable') >= 0) return 'Check the peg and mint or redeem $' + amt + ' to keep the position balanced.';
    if (c.indexOf('rwa') >= 0) return 'Check the asset yield accrual and add $' + amt + ' of USDC if a new tranche opened.';
    if (c.indexOf('insurance') >= 0) return 'Check the policy is still active and renew it before it lapses.';
    if (c.indexOf('basis') >= 0) return 'Check the funding rate and add $' + amt + ' if the basis widened in your favour.';
    if (c.indexOf('governance') >= 0) return 'Vote on any open proposal, or delegate the vote to an active delegate.';
    if (c.indexOf('payment') >= 0) return 'Send one small payment through the app to a second wallet you control.';
    if (c.indexOf('restaking') >= 0) return 'Check the restaking rewards and re-stake anything accrued.';
    if (c.indexOf('staking') >= 0) return 'Check the staking rewards and compound them back into the pool.';
    if (c.indexOf('liquidity') >= 0) return 'Check the managed range and add $' + amt + ' if the manager moved it.';
    if (c.indexOf('chain') >= 0) return 'Use one app on the chain and keep a small balance on the chain for the week.';
    if (c.indexOf('card') >= 0) return 'Spend $' + amt + ' through the card so the month shows card activity.';
    if (c.indexOf('btc') >= 0) return 'Check the BTC peg and add $' + amt + ' of collateral if the peg drifted.';
    if (c.indexOf('farm') >= 0) return 'Harvest the farm rewards and re-stake them into the same pool.';
    if (c.indexOf('cedefi') >= 0) return 'Check the CeDeFi vault yield and add $' + amt + ' to the highest-yielding one.';
    return 'Make one qualifying action: a deposit, a borrow, a swap, a vote or a claim, whichever the app offers.';
  }
  function claimFor(row) {
    var c = cat(row);
    if (c.indexOf('governance') >= 0) return 'Open the governance page and check your voting power and any delegate rewards.';
    if (c.indexOf('insurance') >= 0) return 'Open the policy page and check the cover status and any claim window.';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Open the lending page and check the supply balance and any borrow rewards.';
    if (c.indexOf('index') >= 0) return 'Open the index page and check the holdings and any index rewards.';
    if (c.indexOf('dex') >= 0) return 'Open the pool page and check the fees earned and any points balance.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Open the trading page and check the margin balance and any fee rebates.';
    if (c.indexOf('yield') >= 0) return 'Open the vault page and check the accrued yield and any points balance.';
    if (c.indexOf('rwa') >= 0) return 'Open the asset page and check the yield accrual and any redemption window.';
    if (c.indexOf('stable') >= 0) return 'Open the stable asset page and check the peg and the redemption rate.';
    if (c.indexOf('basis') >= 0) return 'Open the basis vault page and check the funding profit and loss.';
    if (c.indexOf('risk') >= 0) return 'Open the curator page and check the vault allocation and any performance fee.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Open the allocator vault page and check the allocation and accrued yield.';
    if (c.indexOf('chain') >= 0) return 'Open the bridge page and check the transfer history.';
    if (c.indexOf('prediction') >= 0) return 'Open the market page and check the position and any settlement payout.';
    if (c.indexOf('payment') >= 0) return 'Open the payments page and check the transaction history and any cashback.';
    if (c.indexOf('leveraged farm') >= 0) return 'Open the vault page and check the leveraged yield and any points balance.';
    if (c.indexOf('restaking') >= 0) return 'Open the restaking page and check the rewards and any points balance.';
    if (c.indexOf('staking') >= 0) return 'Open the staking page and check the rewards and the unstaking window.';
    if (c.indexOf('liquidity') >= 0) return 'Open the managed vault page and check the range and the fees earned.';
    if (c.indexOf('card') >= 0) return 'Open the card page and check the spending and any cashback balance.';
    if (c.indexOf('btc') >= 0) return 'Open the asset page and check the peg and the collateral ratio.';
    if (c.indexOf('farm') >= 0) return 'Open the farm page and check the rewards and any harvest window.';
    if (c.indexOf('cedefi') >= 0) return 'Open the CeDeFi vault page and check the yield and any points balance.';
    return 'Open the protocol\'s own points or rewards page from the link it publishes and check the balance.';
  }
  function unwindFor(row) {
    var c = cat(row);
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Repay the borrow first, then withdraw the supply, and keep the receipts until the snapshot is taken.';
    if (c.indexOf('index') >= 0) return 'Sell the index tokens back in two halves and keep the trade receipts.';
    if (c.indexOf('dex') >= 0) return 'Remove the liquidity in two halves on different days so the position history stays visible.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Close every open position, withdraw the margin, and keep the trade history.';
    if (c.indexOf('yield') >= 0) return 'Unstake from the vault and withdraw in two halves, keeping the yield receipts.';
    if (c.indexOf('rwa') >= 0) return 'Redeem the asset in two halves and keep the redemption receipts.';
    if (c.indexOf('stable') >= 0) return 'Redeem the stable asset back to USDC and keep the mint receipts.';
    if (c.indexOf('basis') >= 0) return 'Close the basis position after the funding cycle ends, then withdraw.';
    if (c.indexOf('risk') >= 0) return 'Exit the curated vault in two halves and keep the allocation receipts.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Withdraw from the allocator vault in two halves and keep the vault-share receipts.';
    if (c.indexOf('chain') >= 0) return 'Bridge the funds back and keep the bridge receipts.';
    if (c.indexOf('prediction') >= 0) return 'Close the open market positions, withdraw, and keep the settlement receipts.';
    if (c.indexOf('payment') >= 0) return 'Withdraw the balance back to the funding wallet and keep the receipts.';
    if (c.indexOf('leveraged farm') >= 0) return 'Close the leveraged position first, then withdraw in two halves.';
    if (c.indexOf('restaking') >= 0) return 'Unstake in two halves and keep the restaking receipts.';
    if (c.indexOf('staking') >= 0) return 'Unstake in two halves and keep the staking receipts.';
    if (c.indexOf('liquidity') >= 0) return 'Exit the managed vault in two halves and keep the manager receipts.';
    if (c.indexOf('card') >= 0) return 'Spend down the card balance, then withdraw the remainder.';
    if (c.indexOf('btc') >= 0) return 'Withdraw the collateral in two halves and keep the receipts.';
    if (c.indexOf('farm') >= 0) return 'Harvest one last time, then withdraw in two halves.';
    if (c.indexOf('cedefi') >= 0) return 'Exit the CeDeFi vault in two halves and keep the receipts.';
    if (c.indexOf('governance') >= 0) return 'Undelegate the vote and withdraw in two halves.';
    if (c.indexOf('insurance') >= 0) return 'Let the cover term end, then withdraw, keeping the policy receipts.';
    return 'Withdraw in two halves on different days and keep the transaction hashes until the snapshot is taken.';
  }
  function farmSteps(row) {
    var chain = (row.chains && row.chains[0]) || 'its main chain';
    var capital = capitalFor(row);
    var hold = holdDaysFor(row.age_days);
    var gas = capital >= 150 ? 8 : 4;
    var wallet = (row.chains && row.chains.length > 1)
      ? 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Fund it with USDC on ' + chain + ' and keep a little native gas token on each chain you touch.'
      : 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Fund it with USDC on ' + chain + ' and keep a little of the chain\'s native token for gas.';
    function step(text, cost, time) {
      var s = text + ' Cost: ' + cost + '. Time: ' + time + '.';
      if (s.length > 600) s = s.slice(0, 596) + '...';
      if (s.length < 20) s = s + ' Hold the position and check the protocol\'s own page.';
      return s;
    }
    return [
      step(wallet, 'under $3 of gas for the first transaction', '5 minutes'),
      step(actionFor(row, capital, chain), '$' + capital + ' of capital and about $' + gas + ' of gas', '15 minutes to set up'),
      step(weeklyFor(row, capital), 'about $2 of gas a week', '10 minutes a week'),
      step('Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', 'the $' + capital + ' stays in the position', hold + ' days'),
      step(claimFor(row) + ' Claim only from the link the protocol itself publishes, and never pay a fee to claim.', 'no fee to check', '10 minutes'),
      step(unwindFor(row) + ' Write the wallet, the dates and every transaction in a farm log.', 'nothing but the log', '5 minutes'),
    ];
  }

  // ---- filtering, sorting, rendering ----
  var isWatch = {};
  (DATA.watchlist || []).forEach(function (s) { isWatch[s] = true; });

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchOnly && !isWatch[r.slug]) return false;
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
      if (key === 'econ') return r.economics ? r.economics.usd_per_hour : -Infinity;
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
  // For each of the top 10 rows, the three multipliers as bars on their own
  // scales (growth 0.5–2.5, maturity 0.5–1.0, breadth 1.0–1.4), with the exact
  // figures and the implied value they multiply to as text. Every number comes
  // from modelOf(), which recomputes from the row's own figures — the chart can
  // only ever show what the board says.
  function factorsHtml() {
    var top = DATA.rows.slice().sort(function (a, b) { return a.rank - b.rank; }).slice(0, 10);
    var W = 1100, LBL = 155, ROWH = 30, TOP = 26, H = TOP + top.length * ROWH + 8;
    var groups = [
      { key: 'growthMult', label: 'Growth', min: 0.5, max: 2.5, x: 170, fill: '#1d7a4c' },
      { key: 'maturityMult', label: 'Maturity', min: 0.5, max: 1.0, x: 350, fill: '#16304f' },
      { key: 'breadthMult', label: 'Breadth', min: 1.0, max: 1.4, x: 530, fill: '#e8a33d' }
    ];
    var head = groups.map(function (g) {
      return '<text class="val" x="' + g.x + '" y="18" font-weight="600">' + g.label + '</text>';
    }).join('') + '<text class="val" x="740" y="18" font-weight="600">Multipliers → implied value</text>';
    var rows = top.map(function (r, i) {
      var m = modelOf(r);
      var y = TOP + i * ROWH;
      var bars = groups.map(function (g) {
        var v = m[g.key];
        var w = Math.max(2, Math.round(((v - g.min) / (g.max - g.min)) * 120));
        return '<rect x="' + g.x + '" y="' + (y + 4) + '" width="120" height="14" rx="3" fill="#e6ebf0"/>' +
          '<rect x="' + g.x + '" y="' + (y + 4) + '" width="' + w + '" height="14" rx="3" fill="' + g.fill + '"/>';
      }).join('');
      return '<g data-slug="' + esc(r.slug) + '" data-growth="' + m.growthMult + '" data-maturity="' + m.maturityMult + '" data-breadth="' + m.breadthMult + '" data-implied="' + m.implied + '">' +
        '<text class="lbl" x="' + LBL + '" y="' + (y + 15) + '" text-anchor="end">' + esc(r.name) + '</text>' + bars +
        '<text class="val" x="740" y="' + (y + 15) + '">×' + m.growthMult.toFixed(2) + ' · ×' + m.maturityMult.toFixed(2) + ' · ×' + m.breadthMult.toFixed(2) + ' → ' + fmtUsd(m.implied) + '</text></g>';
    }).join('');
    return '<section class="card" id="factors"><h2>What moves the top 10</h2>' +
      '<p>Each of the top 10 rows, broken into the three multipliers on top of its fitted curve base. The bars run on each factor\u2019s own scale — growth 0.5–2.5, maturity 0.5–1.0, breadth 1.0–1.4 — and the exact figures are on the right, with the implied value they multiply to.</p>' +
      '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Four-factor breakdown of the top 10 rows.">' +
      '<title>Four-factor breakdown of the top 10 rows</title>' + head + rows + '</svg></section>';
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
      '<p>The curve is a rough anchor, not a prediction: TVL explains only ' + Math.round(f.r2 * 100) + '% of market-cap variation across traded protocols, so the board’s absolute values carry wide error bars. What the curve does is replace a guessed multiple with the one the market’s own traded protocols imply.</p>';
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
      counts[r.economics.verdict]++;
      if (r.economics.breakeven_value_usd < beMin) beMin = r.economics.breakeven_value_usd;
      if (r.economics.breakeven_value_usd > beMax) beMax = r.economics.breakeven_value_usd;
      var ratio = r.tvl_usd / r.economics.capital_usd;
      if (ratio < ratioMin) ratioMin = ratio;
      if (ratio > ratioMax) ratioMax = ratio;
    });
    var poolPct = Math.round(e.pool_share * 100);
    return '<h3>How the economics work — is it worth farming?</h3>' +
      '<p>Every row carries a verdict — farm, thin or skip — netted to the dollar from its own plan and its fitted value. The farmer pool is ' + poolPct + '% of the launch’s implied value (past launches allocate 5–15% to farmers; the board uses the ' + poolPct + '% midpoint), split among an estimated ' + e.farmers.toLocaleString('en-US') + ' farmers. The cost is the plan’s gas — $' + e.gas_setup_usd + ' to set up, $' + e.gas_main_usd + ' or $' + e.gas_main_big_usd + ' for the main deposit, $' + e.gas_weekly_usd + ' a week over the hold — plus the yield forgone on the capital at ' + Math.round(e.opp_rate * 100) + '% a year; the capital itself comes back at unwind, so it is not a cost. The time is the plan’s own minutes: 35 fixed plus 10 a week.</p>' +
      '<p>Expected value per farmer = ' + poolPct + '% × implied value ÷ ' + e.farmers.toLocaleString('en-US') + '. Break-even launch value = cost × ' + e.farmers.toLocaleString('en-US') + ' ÷ ' + poolPct + '% — the launch has to be worth that much for one farmer’s share to cover the cost. Expected net = expected value − cost. Expected $/hour = net ÷ hours. Farm when the hour pays at least $' + e.hourly_bar_usd + ' and the expected value is at least ' + e.safety_multiple + '× the cost; thin when the value clears the cost but not the bar; skip when it does not cover the cost.</p>' +
      '<p>On this board, ' + counts.farm + ' rows farm, ' + counts.thin + ' are thin and ' + counts.skip + ' skip. The break-even launch value runs from ' + fmtInt(beMin) + ' to ' + fmtInt(beMax) + ' across the board — a launch has to be worth roughly that much for one farmer’s share to cover the gas. The farmer count does not come from the protocol’s TVL: TVL is whale-dominated, so dividing it by a $50–$250 position would imply ' + fmtCount(ratioMin) + ' to ' + fmtCount(ratioMax) + ' farmers, which no launch has — the board uses one flat estimate of ' + e.farmers.toLocaleString('en-US') + ' for every row, so the verdict compares launches on their value.</p>';
  }

  function rowHtml(r, max) {
    var m = modelOf(r);
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
      '<span class="mult">×' + m.growthMult.toFixed(2) + ' growth · ×' + m.maturityMult.toFixed(2) + ' age · ×' + m.breadthMult.toFixed(2) + ' chains</span></td>' +
      '<td class="num" data-verdict="' + r.economics.verdict + '">' + verdictBadge(r.economics.verdict) + '<br><span class="mult">' + fmtMoney(r.economics.usd_per_hour) + '/h</span></td>' +
      '</tr>';
  }

  // ---- is it worth farming: the row's own plan netted to the dollar ----
  // Every figure comes from r.economics, which main.ts computed from the same plan and fitted
  // value board.json carries — the drawer shows the board's figures, it never recomputes them.
  function drawerEconHtml(r) {
    var e = r.economics;
    var verdictLine = e.verdict === 'farm'
      ? 'Farm it: the hour pays well above the $20 bar and the expected value is more than twice the cost.'
      : e.verdict === 'thin'
        ? 'Thin: the expected value clears the cost, but the hour does not pay the $20 bar — farm it only if you value the optionality.'
        : 'Skip: the expected value does not cover the cost of the plan — the gas alone is more than one farmer’s share.';
    return '<h3>Is it worth farming?</h3>' +
      '<p>' + verdictBadge(e.verdict) + ' <strong>' + fmtMoney(e.usd_per_hour) + ' an hour</strong> — expected ' + fmtMoney(e.expected_usd) + ' per farmer against ' + fmtMoney(e.cost_total_usd) + ' of costs.</p>' +
      '<div class="factor"><span>Cost of the plan — gas ' + fmtMoney(e.cost_gas_usd) + ' + ' + fmtMoney(e.cost_opp_usd) + ' forgone yield on the $' + e.capital_usd + ' position</span><span>' + fmtMoney(e.cost_total_usd) + '</span></div>' +
      '<div class="factor"><span>Time the plan takes — 35 fixed minutes + 10 a week over ' + e.hold_days + ' days</span><span>' + e.hours.toFixed(2) + ' hours</span></div>' +
      '<div class="factor"><span>Farmers sharing the launch — 10% of the launch goes to farmers</span><span>' + e.farmers.toLocaleString('en-US') + '</span></div>' +
      '<div class="factor"><span>Expected value per farmer — 10% of ' + fmtUsd(r.implied_value_usd) + ' ÷ 50,000 farmers</span><span>' + fmtMoney(e.expected_usd) + '</span></div>' +
      '<div class="factor"><span>Break-even launch value — the launch has to be worth this much for one farmer’s share to cover the cost</span><span>' + fmtInt(e.breakeven_value_usd) + '</span></div>' +
      '<div class="factor"><span>Expected net — expected value minus cost</span><span>' + fmtMoney(e.net_usd) + '</span></div>' +
      '<div class="factor"><span>Expected $/hour — net divided by the hours the plan takes</span><span>' + fmtMoney(e.usd_per_hour) + '</span></div>' +
      '<div class="factor"><span>Verdict — farm, thin or skip, from the numbers above</span><span>' + verdictBadge(e.verdict) + '</span></div>' +
      '<p>' + verdictLine + ' The verdict follows from the numbers: farm when the hour pays at least $20 and the expected value is at least twice the cost; thin when the value clears the cost but not the bar; skip when it does not cover the cost. See “How the economics work” for the method.</p>';
  }

  function drawerHtml(r) {
    var m = modelOf(r);
    var steps = farmSteps(r);
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
      '<p class="sub">Rank #' + r.rank + ' · ' + esc(r.category || 'uncategorised') + ' · ' + esc((r.chains || []).join(', ') || 'no chain') + ' · ' + (isWatch[r.slug] ? 'on the watchlist' : 'found early, below the watchlist floor') + '</p>' +
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
      '<div class="factor"><span><strong>Implied launch value</strong></span><span><strong>' + fmtUsd(m.implied) + '</strong></span></div>' +
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
    DATA.rows.forEach(function (r) { if (r.economics.verdict === 'farm') farmCount++; });
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
      '<p>Launch values are <strong>fitted</strong> to the snapshot\u2019s own traded protocols and <strong>tested blind</strong> — leave-one-out ×' + DATA.fit.loo.median_factor.toFixed(2) + ', blind holdout ×' + DATA.fit.blind.median_factor.toFixed(2) + ', walk-forward ×' + DATA.fit.walkforward.median_factor.toFixed(2) + ' — and every farm plan is <strong>netted to the dollar</strong>: break-even launch value, $/hour and a farm / thin / skip verdict.</p>' +
      '<div class="stats">' +
      '<div class="stat"><b>' + DATA.board_size + '</b><span>pre-token rows</span></div>' +
      '<div class="stat"><b>' + DATA.watchlist_size + '</b><span>on the watchlist</span></div>' +
      '<div class="stat"><b>' + DATA.early_size + '</b><span>found early, below the floor</span></div>' +
      '<div class="stat"><b>' + DATA.live_size + '</b><span>live tokens set aside</span></div>' +
      '<div class="stat"><b>' + fmtUsd(DATA.rows[0] ? DATA.rows[0].implied_value_usd : 0) + '</b><span>top implied value</span></div>' +
      '<div class="stat"><b>' + farmCount + '</b><span>farm verdicts</span></div>' +
      '</div></div></header>' +
      '<div class="wrap">' +
      chartHtml() +
      factorsHtml() +
      '<section class="card"><h2>How the radar scores</h2>' +
      '<p>One formula, the same for every row, from the snapshot\u2019s own figures — the base is fitted, not guessed.</p>' +
      '<div class="model-grid">' +
      '<div class="model-cell"><b>Curve — fitted size</b><span>log market cap on log TVL, fitted to ' + DATA.fit.comps + ' traded protocols</span><br><code>curve = exp(' + DATA.fit.intercept.toFixed(3) + ' + ' + DATA.fit.slope.toFixed(3) + ' × ln TVL)</code></div>' +
      '<div class="model-cell"><b>Growth — momentum</b><span>7-day TVL change, clamped −50%…+150%</span><br><code>× (1 + growth)</code></div>' +
      '<div class="model-cell"><b>Maturity — earned time</b><span>days listed with no token, up to 4 years</span><br><code>× (0.5 + age/1460 × 0.5)</code></div>' +
      '<div class="model-cell"><b>Breadth — distribution</b><span>one chain is the base, up to +40%</span><br><code>× (1 + 0.10 × min(chains − 1, 4))</code></div>' +
      '</div>' +
      '<p>Implied value = curve × growth × maturity × breadth. A protocol listed 3 years ago with no token scores near the full maturity factor; one listed last month scores near the floor. Click any row to see its own four factors worked out, and the rank its row holds across the curve’s refits.</p>' +
      fitHtml() +
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
      '<label><input type="checkbox" id="watchOnly"' + (state.watchOnly ? ' checked' : '') + '> Watchlist only</label>' +
      '</div>' +
      '<p class="count">' + (state.tab === 'live' ? 'Tokens that already trade, by market cap.' : 'Showing ' + rows.length + ' of ' + DATA.board_size + ' pre-token rows, ranked by implied launch value.') + '</p>' +
      '<div class="table-wrap">' + tableHtml + '</div>' +
      '</section>' +
      '<footer class="note"><p>Method: the board ranks protocols that record no token (no market cap, no CoinGecko id, no symbol) on DefiLlama\u2019s snapshot of ' + esc(DATA.as_of) + '. The watchlist (TVL ≥ $50M) is the floor; the radar also carries every genuine pre-token protocol below it, so a launch can be found early. Wrapped, staked, bridged and exchange products are excluded: they are a token that already trades, in another form. The implied value is fitted to the snapshot\u2019s traded protocols and tested out of sample — the fit is stated in “How the radar scores”. The verdict on each row is the farm plan netted to the dollar — its cost, its expected value per farmer and its $/hour — see “How the economics work”. The snapshot carries no ranking and no farm plan — both are this entry\u2019s work, and the task does not predict whether or when a token is issued. Farm plans are guides, not promises of an airdrop.</p></footer>' +
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
    if (state.watchOnly) parts.push('watch=1');
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
      if (k === 'watch') state.watchOnly = v === '1';
      if (k === 'slug') state.selected = v;
    });
  }

  function bind() {
    var q = document.getElementById('q');
    if (q) q.addEventListener('input', function () { state.q = q.value; state.selected = null; render(); writeHash(); });
    var cat = document.getElementById('cat');
    if (cat) cat.addEventListener('change', function () { state.category = cat.value; state.selected = null; render(); writeHash(); });
    var chain = document.getElementById('chain');
    if (chain) chain.addEventListener('change', function () { state.chain = chain.value; state.selected = null; render(); writeHash(); });
    var watch = document.getElementById('watchOnly');
    if (watch) watch.addEventListener('change', function () { state.watchOnly = watch.checked; state.selected = null; render(); writeHash(); });
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
  if (/[#&](cat|chain|q|watch)=/.test(location.hash)) {
    var bc = document.getElementById('board-card');
    if (bc) bc.scrollIntoView();
  }
})();
