/**
 * MERIDIAN — Quant Lab assessment layer.
 *
 * Reads the JSON the quant engines already produce and answers three questions
 * for the top of every desk:
 *   1. CONCLUSION   — what the analysis says, in plain words
 *   2. ASSUMPTIONS  — is each input the user chose reasonable? (ok · warn · bad, and why)
 *   3. SUGGESTIONS  — what a sensible setting would be, with values the page can apply
 *
 * Pure, deterministic rules (market conventions + the engines' own robustness
 * evidence). No model calls, no new market data.
 */

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const pct = (v, dp = 1) => (isNum(v) ? `${v >= 0 ? "+" : ""}${(v * 100).toFixed(dp)}%` : "—");
const pctAbs = (v, dp = 1) => (isNum(v) ? `${(Math.abs(v) * 100).toFixed(dp)}%` : "—");
const f2 = (v, dp = 2) => (isNum(v) ? v.toFixed(dp) : "—");
const isIndian = (sym) => /\.(NS|BO)$|^\^(NSE|BSE|CNX|INDIAVIX)/i.test(String(sym || ""));

/* ── market conventions ───────────────────────────────────────────────────
   Cost per side, in basis points, for a delivery trade. India: STT is 10 bp on
   each side of a delivery trade, plus stamp duty (1.5 bp on the buy), exchange
   and SEBI fees, GST and a few bp of slippage → about 12–20 bp per side for a
   liquid large cap, more for small caps. US: commission-free brokers, so the
   cost is mostly spread and slippage, about 2–10 bp. */
const COST = {
  india: { low: 6, ok: [12, 30], high: 50, suggest: 15, why: "Delivery trades in India pay STT of 10 bp on each side, plus stamp duty, exchange fees, GST and slippage: about 12–20 bp per side for a liquid stock." },
  us: { low: 1, ok: [2, 15], high: 30, suggest: 5, why: "US brokers charge little or no commission, so the cost is mostly the bid-ask spread and slippage: about 2–10 bp per side for a liquid stock." },
};

/* Typical ranges practitioners use for each rule (outside them is not wrong, but it needs a reason). */
const TYPICAL = {
  sma_cross: { fast: [10, 50], slow: [100, 200] },
  ema_cross_adx: { fast: [10, 30], slow: [40, 100], adxMin: [20, 30] },
  donchian_breakout: { entry: [20, 60], exit: [10, 25] },
  atr_chandelier: { trend: [50, 100], k: [2.5, 3.5] },
  rsi_reversion: { period: [10, 20], oversold: [25, 35], exitAt: [50, 70], trendFilter: [1, 1] },
  bollinger_reversion: { period: [15, 30], k: [1.75, 2.5] },
  macd_trend: { fast: [8, 15], slow: [20, 30] },
  momentum_12_1: { lookback: [126, 252], skip: [0, 21], hold: [5, 21] },
  volatility_regime: { trend: [100, 200], volPct: [60, 80] },
  dual_momentum_ma: { fast: [40, 60], slow: [150, 250] },
};
const WHY_TYPICAL = {
  "sma_cross.fast": "Fast averages of 10–50 days follow the intermediate trend; shorter ones react to noise.",
  "sma_cross.slow": "Slow averages of 100–200 days define the long-term trend most funds watch.",
  "ema_cross_adx.adxMin": "ADX above 20–25 is the usual threshold for a trending market.",
  "donchian_breakout.entry": "The Turtle rules used 20- and 55-day breakouts.",
  "donchian_breakout.exit": "Exits of 10–20 days give a breakout room without giving back the whole move.",
  "atr_chandelier.k": "Stops of 2.5–3.5 × ATR sit outside a stock's normal daily noise.",
  "rsi_reversion.period": "RSI(14) is the standard; much shorter periods flip constantly.",
  "rsi_reversion.oversold": "30 is the textbook oversold line; 25–35 keeps enough signals.",
  "rsi_reversion.trendFilter": "Buying oversold dips below the 200-day average is catching a falling knife; the filter is usually left on.",
  "bollinger_reversion.k": "2 standard deviations is the convention; much wider bands rarely trigger.",
  "macd_trend.fast": "MACD's standard settings are 12 / 26 / 9.",
  "momentum_12_1.lookback": "Momentum research uses 6–12 months (126–252 trading days).",
  "volatility_regime.volPct": "Capping at the 60th–80th percentile of volatility avoids the most turbulent spells without sitting out normal markets.",
  "dual_momentum_ma.slow": "The golden cross uses the 50- and 200-day averages.",
};
/* parameters that must be ordered (first < second), or the rule is degenerate */
const ORDERED = {
  sma_cross: ["fast", "slow"], ema_cross_adx: ["fast", "slow"], macd_trend: ["fast", "slow"],
  dual_momentum_ma: ["fast", "slow"], donchian_breakout: ["exit", "entry"], momentum_12_1: ["skip", "lookback"],
};
const WINDOW_KEYS = ["slow", "entry", "trend", "lookback", "period", "fast"];

const item = (name, value, status, why, suggest = null, apply = null) => ({ name, value, status, why, suggest, apply });

/** neighbourhood-median Sharpe on the parameter surface → the most robust cell */
function robustCell(surface, strategy) {
  if (!surface || !surface.sharpe || !surface.sharpe.length) return null;
  const { xs, ys, sharpe, trades, xKey, yKey } = surface;
  const ord = ORDERED[strategy];
  const valid = (xi, yi) => {
    if (!isNum(sharpe[yi][xi]) || (trades[yi][xi] || 0) < 5) return false;
    if (ord) {
      const v = { [xKey]: xs[xi], [yKey]: ys[yi] };
      if (isNum(v[ord[0]]) && isNum(v[ord[1]]) && v[ord[0]] >= v[ord[1]]) return false;
    }
    return true;
  };
  const hood = (xi, yi) => {
    const vals = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = xi + dx, y = yi + dy;
      if (y >= 0 && y < ys.length && x >= 0 && x < xs.length && isNum(sharpe[y][x])) vals.push(sharpe[y][x]);
    }
    // median, not mean: a single spike next to poor settings must not look robust
    if (vals.length < 4) return null;
    vals.sort((a, b) => a - b);
    const k = vals.length >> 1;
    return vals.length % 2 ? vals[k] : (vals[k - 1] + vals[k]) / 2;
  };
  // prefer settings inside the usual ranges; fall back to the whole grid only if none qualifies
  const typ = TYPICAL[strategy] || {};
  const inTyp = (k, v) => !typ[k] || (v >= typ[k][0] && v <= typ[k][1]);
  const pick = (needTyp) => {
    let best = null;
    for (let yi = 0; yi < ys.length; yi++) for (let xi = 0; xi < xs.length; xi++) {
      if (!valid(xi, yi) || (needTyp && !(inTyp(xKey, xs[xi]) && inTyp(yKey, ys[yi])))) continue;
      const h = hood(xi, yi);
      if (h != null && (!best || h > best.hood)) best = { xi, yi, hood: h, sharpe: sharpe[yi][xi], x: xs[xi], y: ys[yi], typical: needTyp };
    }
    return best;
  };
  const best = pick(true) || pick(false);
  return best ? { ...best, hoodOf: hood } : null;
}
const nearestIdx = (arr, v) => arr.reduce((bi, x, i) => (Math.abs(x - v) < Math.abs(arr[bi] - v) ? i : bi), 0);

/**
 * Backtest assessment.
 * @param d    the /api/quant/backtest payload (meta, performance, benchmark, trades, surface, walkForward, bootstrap, versusMarket)
 * @param opts { symbol }
 */
function assessBacktest(d, opts = {}) {
  const m = d.meta || {}, p = d.performance || {}, b = d.benchmark || {}, t = d.trades || {};
  const sym = opts.symbol || m.symbol || "";
  const region = isIndian(sym) ? "india" : "us";
  const C = COST[region];
  const params = m.params || {}, spec = m.paramSpec || [];
  const typ = TYPICAL[m.strategy] || {};
  const assumptions = [];
  const apply = { params: {}, costBps: null, range: null };

  /* 1 · cost per side */
  const cost = m.costBps;
  if (isNum(cost)) {
    if (cost < C.low) { assumptions.push(item("Trading cost", `${cost} bp per side`, "bad", `Unrealistically low. ${C.why}`, `${C.suggest} bp per side`)); apply.costBps = C.suggest; }
    else if (cost < C.ok[0]) { assumptions.push(item("Trading cost", `${cost} bp per side`, "warn", `Optimistic. ${C.why}`, `${C.suggest} bp per side`)); apply.costBps = C.suggest; }
    else if (cost > C.high) assumptions.push(item("Trading cost", `${cost} bp per side`, "warn", `Very conservative for a liquid stock. ${C.why} Keep it high only for illiquid small caps.`, `${C.suggest}–${C.ok[1]} bp per side`));
    else assumptions.push(item("Trading cost", `${cost} bp per side`, "ok", `In line with real costs. ${C.why}`));
  }

  /* 2 · history length vs the slowest window */
  const years = m.years;
  const longest = Math.max(0, ...WINDOW_KEYS.filter((k) => isNum(params[k])).map((k) => params[k]));
  const windows = longest ? (m.bars || 0) / longest : null;
  if (isNum(years)) {
    if (years < 3) { assumptions.push(item("History", `${f2(years, 1)} years`, "warn", "Too short to include a full market cycle (a bull run, a correction and a recovery). Results this short mostly describe one regime.", "5 years or more")); apply.range = "5y"; }
    else if (windows != null && windows < 8) { assumptions.push(item("History", `${f2(years, 1)} years`, "warn", `The slowest window (${longest} days) fits only ${f2(windows, 1)} times into this history, so there are few independent signals.`, "10 years, or a faster setting")); apply.range = "10y"; }
    else assumptions.push(item("History", `${f2(years, 1)} years`, "ok", `Covers ${windows ? f2(windows, 0) + " lengths of the slowest window" : "several market phases"}.`));
  }

  /* 3 · parameter order and conventions */
  const ord = ORDERED[m.strategy];
  if (ord && isNum(params[ord[0]]) && isNum(params[ord[1]]) && params[ord[0]] >= params[ord[1]]) {
    const l0 = (spec.find((s) => s.key === ord[0]) || {}).label || ord[0], l1 = (spec.find((s) => s.key === ord[1]) || {}).label || ord[1];
    assumptions.push(item(`${l0} vs ${l1}`, `${params[ord[0]]} ≥ ${params[ord[1]]}`, "bad", `${l0} must be smaller than ${l1}; otherwise the rule inverts and the result means nothing.`, "use the defaults"));
    for (const s of spec) apply.params[s.key] = s.def;
  }
  for (const s of spec) {
    const r = typ[s.key], v = params[s.key];
    if (!r || !isNum(v)) continue;
    const why = WHY_TYPICAL[`${m.strategy}.${s.key}`] || `Most practitioners use ${r[0]}–${r[1]}.`;
    if (v < r[0] || v > r[1]) {
      const target = v < r[0] ? r[0] : r[1];
      assumptions.push(item(s.label, String(v), "warn", `Outside the usual ${r[0] === r[1] ? r[0] : r[0] + "–" + r[1]} range. ${why}`, r[0] === r[1] ? String(r[0]) : `${r[0]}–${r[1]}`));
      if (apply.params[s.key] == null) apply.params[s.key] = target;
    } else assumptions.push(item(s.label, String(v), "ok", `Within the usual ${r[0] === r[1] ? r[0] : r[0] + "–" + r[1]} range. ${why}`));
  }

  /* 4 · sample size */
  if (isNum(t.n)) {
    if (t.n < 10) assumptions.push(item("Number of trades", String(t.n), "bad", "Too few trades to tell skill from luck; one or two trades decide the whole result.", "a longer history or a faster setting (30+ trades)"));
    else if (t.n < 30) assumptions.push(item("Number of trades", String(t.n), "warn", "A small sample; the win rate and averages can swing a lot with a few more trades.", "30 or more trades"));
    else assumptions.push(item("Number of trades", String(t.n), "ok", "Enough trades for the averages to mean something."));
  }

  /* 5 · robustness of the chosen setting on the parameter surface */
  const s = d.surface, rc = robustCell(s, m.strategy);
  let robustTxt = null;
  if (s && rc) {
    const cx = nearestIdx(s.xs, params[s.xKey]), cy = nearestIdx(s.ys, params[s.yKey]);
    const curHood = rc.hoodOf(cx, cy), curSharpe = s.sharpe[cy] && s.sharpe[cy][cx];
    const isolated = isNum(curSharpe) && isNum(s.bestSharpe) && curSharpe >= s.bestSharpe * 0.9 && isNum(curHood) && curHood < curSharpe * 0.5;
    const better = (!isNum(curHood) || rc.hood > curHood + 0.1) && rc.hood > 0;   // never suggest a setting that also loses
    const hopeless = rc.hood <= 0;
    const label = `${s.xLabel} ${params[s.xKey]} · ${s.yLabel} ${params[s.yKey]}`;
    if (isolated) assumptions.push(item("Parameter choice", label, "bad", `This setting sits on an isolated peak: its Sharpe (${f2(curSharpe)}) falls to a median of ${f2(curHood)} when either parameter moves one step. That is curve-fitting.`, `${s.xLabel} ${rc.x} · ${s.yLabel} ${rc.y}`));
    else if (better) assumptions.push(item("Parameter choice", label, "warn", `Neighbouring settings have a median Sharpe of ${f2(curHood)}; the steadiest region of the grid has ${f2(rc.hood)}.`, `${s.xLabel} ${rc.x} · ${s.yLabel} ${rc.y}`));
    else if (hopeless) assumptions.push(item("Parameter choice", label, "warn", `No region of the parameter grid has a positive median Sharpe, so changing the settings will not rescue this rule on this stock.`, "try another strategy"));
    else assumptions.push(item("Parameter choice", label, "ok", `Sits in the steadiest region of the grid (neighbours have a median Sharpe of ${f2(curHood)}).`));
    if ((isolated && rc.hood > 0) || better) { apply.params[s.xKey] = rc.x; apply.params[s.yKey] = rc.y; robustTxt = `${s.xLabel} ${rc.x} and ${s.yLabel} ${rc.y}`; }
  }

  /* 6 · walk-forward: does the optimiser keep changing its mind? */
  const wf = d.walkForward;
  if (wf && wf.folds && wf.folds.length >= 3 && spec[0]) {
    const k = spec[0].key, vals = wf.folds.map((f) => f.params && f.params[k]).filter(isNum);
    const span = spec[0].max - spec[0].min;
    if (vals.length >= 3 && span > 0) {
      const spread = (Math.max(...vals) - Math.min(...vals)) / span;
      if (spread > 0.5) assumptions.push(item("Parameter stability", `${spec[0].label}: ${vals.join(" → ")}`, "warn", "The best setting changed a lot from one period to the next, so there is no single stable parameter; expect live results to differ from the backtest."));
      else assumptions.push(item("Parameter stability", `${spec[0].label}: ${vals.join(" → ")}`, "ok", "The best setting stayed in the same area across periods."));
    }
  }

  /* ── conclusion ── */
  const checks = [];
  if (isNum(p.pValue)) checks.push(p.pValue < 0.05);
  if (wf && isNum(wf.oosAvgSharpe)) checks.push(wf.oosAvgSharpe > 0.3);
  if (s && isNum(s.plateauRatio)) checks.push(s.plateauRatio > 0.2);
  if (isNum(p.sharpe) && isNum(b.sharpe)) checks.push(p.sharpe > b.sharpe);
  const passed = checks.filter(Boolean).length;
  const tone = passed >= 3 ? "good" : passed === 2 ? "warn" : "bad";
  const points = [];
  if (isNum(p.cagr) && isNum(b.cagr)) points.push(`Returned ${pct(p.cagr)} a year after costs, against ${pct(b.cagr)} for simply holding ${sym || "the stock"}.`);
  if (isNum(p.sharpe) && isNum(b.sharpe)) points.push(`Risk-adjusted (Sharpe) ${f2(p.sharpe)} vs ${f2(b.sharpe)} for buy-and-hold — ${p.sharpe > b.sharpe ? "better" : "worse"} per unit of risk.`);
  if (isNum(p.maxDD) && isNum(b.maxDD)) points.push(`Worst fall ${pctAbs(p.maxDD)} vs ${pctAbs(b.maxDD)} for buy-and-hold${Math.abs(p.maxDD) < Math.abs(b.maxDD) * 0.75 ? " — the rule does cut the drawdown" : ""}.`);
  if (wf && wf.verdict) points.push(`Out of sample: ${wf.verdict.charAt(0).toLowerCase() + wf.verdict.slice(1)} (average Sharpe ${f2(wf.oosAvgSharpe)}).`);
  if (d.bootstrap && isNum(d.bootstrap.probProfit)) points.push(`In ${d.bootstrap.runs} resampled histories it made money ${pctAbs(d.bootstrap.probProfit, 0)} of the time.`);
  const gross = isNum(p.totalReturn) && isNum(p.costDrag) ? p.totalReturn + p.costDrag : null;
  if (isNum(p.costDrag) && gross && gross > 0 && p.costDrag / gross > 0.3) points.push(`Costs ate ${pctAbs(p.costDrag / gross, 0)} of the gross gain — the rule trades too often for its edge.`);
  const vm = d.versusMarket;
  if (vm && isNum(vm.alphaP)) points.push(vm.alphaP < 0.05 && vm.alphaAnnualised > 0 ? `Adds a statistically significant ${pct(vm.alphaAnnualised, 2)} a year beyond the stock's own move.` : `Adds no statistically reliable return beyond holding ${f2(Math.abs(vm.beta || 0), 2)}× the stock.`);
  const headline = passed >= 3
    ? `${m.label} shows a robust edge on ${sym}: it passes ${passed} of ${checks.length} checks.`
    : passed === 2
      ? `${m.label} on ${sym} is a mixed result: ${passed} of ${checks.length} checks pass, so part of the backtest is fragile.`
      : `${m.label} is not a reliable edge on ${sym}: only ${passed} of ${checks.length} checks pass, so treat the headline numbers as noise.`;
  const next = tone === "good"
    ? "Next: paper-trade it before committing money, and re-run it on a few similar stocks to confirm it is not specific to this one."
    : robustTxt
      ? `Next: try the steadier setting (${robustTxt}) or compare all strategies on this stock to see which family suits it.`
      : "Next: compare all strategies on this stock to see whether a different family (trend, mean reversion, momentum) suits it better.";

  const bad = assumptions.filter((a) => a.status === "bad").length, warn = assumptions.filter((a) => a.status === "warn").length;
  apply.labels = Object.fromEntries(spec.map((x) => [x.key, x.label]));
  const hasApply = Object.keys(apply.params).length || apply.costBps != null || apply.range;
  return {
    conclusion: { tone, headline, points, next, passed, total: checks.length },
    assumptions,
    reasonableness: bad ? "unrealistic" : warn ? "partly reasonable" : "reasonable",
    reasonablenessText: bad ? `${bad} input${bad > 1 ? "s are" : " is"} unrealistic, so the result above is not trustworthy until fixed.` : warn ? `${warn} input${warn > 1 ? "s need" : " needs"} a second look; the result is usable with care.` : "Every input is in a realistic range.",
    suggested: hasApply ? apply : null,
  };
}

/** Pairs assessment: z-window vs half-life, band choices, cost, history. */
function assessPairs(d) {
  const m = d.meta || {}, mr = d.meanReversion || {}, co = d.cointegration, st = d.strategy || {};
  const region = isIndian(m.symA) ? "india" : "us", C = COST[region];
  const assumptions = [], apply = {};
  const hl = mr.halfLifeDays;
  if (co && !co.cointegrated) assumptions.push(item("z-window", `${m.window} days`, "ok", "Not the issue here: without cointegration no window makes the spread mean-revert, so tuning it would only fit noise."));
  else if (isNum(hl) && hl > 0) {
    const ratio = m.window / hl, target = Math.max(20, Math.min(250, Math.round((hl * 4) / 5) * 5));
    if (ratio < 2) { assumptions.push(item("z-window", `${m.window} days`, "warn", `Shorter than twice the spread's half-life (${f2(hl, 1)} days): the rolling mean chases the spread, so signals fire late and often.`, `${target} days (about 4 half-lives)`)); apply.window = target; }
    else if (ratio > 8) { assumptions.push(item("z-window", `${m.window} days`, "warn", `Much longer than the half-life (${f2(hl, 1)} days): the mean barely moves and old prices dominate the z-score.`, `${target} days (about 4 half-lives)`)); apply.window = target; }
    else assumptions.push(item("z-window", `${m.window} days`, "ok", `About ${f2(ratio, 1)} half-lives — a sensible balance between responsiveness and stability.`));
  }
  if (isNum(m.entryZ)) {
    if (m.entryZ < 1.5) { assumptions.push(item("Entry |z|", String(m.entryZ), "warn", "Entering inside 1.5 σ trades ordinary noise; most of those signals revert by themselves before costs are covered.", "2.0")); apply.entryZ = 2; }
    else if (m.entryZ > 3) { assumptions.push(item("Entry |z|", String(m.entryZ), "warn", "Above 3 σ the spread rarely gets there; few trades, and the ones that do often mean the relationship broke.", "2.0–2.5")); apply.entryZ = 2; }
    else assumptions.push(item("Entry |z|", String(m.entryZ), "ok", "2–2.5 σ is the usual entry band."));
  }
  if (isNum(m.exitZ) && isNum(m.entryZ)) {
    if (m.exitZ >= m.entryZ) { assumptions.push(item("Exit |z|", String(m.exitZ), "bad", "The exit band must sit inside the entry band, or trades close the moment they open.", "0.5")); apply.exitZ = 0.5; }
    else if (m.exitZ > 1) assumptions.push(item("Exit |z|", String(m.exitZ), "warn", "Exiting far from the mean leaves most of the reversion on the table.", "0–0.5"));
    else assumptions.push(item("Exit |z|", String(m.exitZ), "ok", "Exits close to the mean, where the reversion completes."));
  }
  if (isNum(m.stopZ) && isNum(m.entryZ)) {
    if (m.stopZ <= m.entryZ + 0.5) { assumptions.push(item("Stop |z|", String(m.stopZ), "warn", "The stop is too close to the entry; ordinary overshoots will stop you out.", `${(m.entryZ + 1.5).toFixed(1)}`)); apply.stopZ = +(m.entryZ + 1.5).toFixed(2); }
    else assumptions.push(item("Stop |z|", String(m.stopZ), "ok", "Leaves room for normal overshoot while capping a broken relationship."));
  }
  if (isNum(m.costBps)) {
    // a pair trades two legs; the cost here is per leg per side
    if (m.costBps < C.ok[0]) { assumptions.push(item("Cost per leg", `${m.costBps} bp`, "warn", `Optimistic: a pair pays costs on both legs, and the short leg in India usually needs futures or stock lending. ${C.why}`, `${C.suggest} bp`)); apply.costBps = C.suggest; }
    else assumptions.push(item("Cost per leg", `${m.costBps} bp`, "ok", C.why));
  }
  const yrs = m.bars ? m.bars / 252 : null;
  if (isNum(yrs) && yrs < 3) assumptions.push(item("History", `${f2(yrs, 1)} years`, "warn", "Cointegration tests need several years to be meaningful; short samples find relationships that are not there.", "5 years"));
  const n = st.trades && st.trades.n;
  if (isNum(n) && n < 10) assumptions.push(item("Number of trades", String(n), "warn", "Too few round trips to judge the rule.", "a longer history or a lower entry band"));

  const tone = d.tradeable ? "good" : co && co.cointegrated ? "warn" : "bad";
  const headline = d.tradeable
    ? `${m.symA} / ${m.symB} is a statistically sound pair: cointegrated, with a ${f2(hl, 1)}-day half-life.`
    : co && co.cointegrated ? `${m.symA} / ${m.symB} is cointegrated, but the spread reverts slowly (half-life ${f2(hl, 1)} days).`
      : `${m.symA} / ${m.symB} is not a valid pair on this sample: the spread has no anchor to revert to.`;
  const points = [];
  if (co) points.push(co.verdict);
  if (isNum(st.cagr)) points.push(`The z-score rule returned ${pct(st.cagr)} a year with a Sharpe of ${f2(st.sharpe)} and a worst fall of ${pctAbs(st.maxDD)}.`);
  if (d.current && d.current.signal) points.push(`Right now: ${d.current.signal} (z = ${f2(d.current.z)}).`);
  const bad = assumptions.filter((a) => a.status === "bad").length, warn = assumptions.filter((a) => a.status === "warn").length;
  return {
    conclusion: { tone, headline, points, next: tone === "bad" ? "Next: try two companies with the same business drivers (same sector, similar size) — the presets are a good start." : "Next: check the rolling correlation below for breaks, and size both legs by the hedge ratio." },
    assumptions,
    reasonableness: bad ? "unrealistic" : warn ? "partly reasonable" : "reasonable",
    reasonablenessText: bad ? `${bad} input${bad > 1 ? "s are" : " is"} inconsistent.` : warn ? `${warn} input${warn > 1 ? "s need" : " needs"} a second look.` : "Every input is in a realistic range.",
    suggested: Object.keys(apply).length ? apply : null,
  };
}

/** Factor attribution: history length and the risk-free rate. */
function assessFactors(d) {
  const m = d.meta || {}, a = d.attribution || {}, al = a.alpha || {}, fit = a.fit || {};
  const india = m.region === "india";
  const assumptions = [], apply = {};
  const yrs = m.observations ? m.observations / 252 : null;
  if (isNum(yrs)) {
    if (yrs < 3) { assumptions.push(item("History", `${f2(yrs, 1)} years`, "warn", "Alpha estimates need years of data; with a short sample the standard error dwarfs any plausible alpha.", "5 years")); apply.range = "5y"; }
    else assumptions.push(item("History", `${f2(yrs, 1)} years`, "ok", "Long enough for the factor betas to settle."));
  }
  if (isNum(m.rf)) {
    const lo = india ? 0.05 : 0.03, hi = india ? 0.08 : 0.055, sug = india ? 6.5 : 4.2;
    if (m.rf < lo || m.rf > hi) { assumptions.push(item("Risk-free rate", `${(m.rf * 100).toFixed(2)}%`, "warn", `Outside the recent ${india ? "Indian 91-day T-bill" : "US 3-month T-bill"} range (${(lo * 100).toFixed(1)}–${(hi * 100).toFixed(1)}%). It shifts alpha one-for-one.`, `${sug}%`)); apply.rf = sug; }
    else assumptions.push(item("Risk-free rate", `${(m.rf * 100).toFixed(2)}%`, "ok", `Close to the ${india ? "Indian T-bill" : "US T-bill"} yield.`));
  }
  if (m.dropped && m.dropped.length) assumptions.push(item("Factors used", `${m.dropped.length} dropped`, "warn", `No usable data for ${m.dropped.join(", ")}; the model is missing those exposures.`));
  const tone = al.significant && al.annualised > 0 ? "good" : al.significant ? "bad" : "warn";
  const headline = al.significant
    ? `${m.symbol} earns a significant ${pct(al.annualised, 2)} a year beyond its factor exposures.`
    : `${m.symbol}'s return is explained by its exposures; no reliable alpha (${pct(al.annualised, 2)} a year, p = ${f2(al.pHAC, 3)}).`;
  const points = [`${pctAbs(fit.systematicShare, 0)} of the stock's movement comes from the factors; ${pctAbs(fit.specificShare, 0)} is company-specific.`];
  const betas = (a.loadings || []).filter((f) => f.significant && isNum(f.beta)).sort((x, y) => Math.abs(y.beta) - Math.abs(x.beta)).slice(0, 3);
  if (betas.length) points.push(`Strongest exposures: ${betas.map((f) => `${f.factor} (β ${f2(f.beta)})`).join(", ")}.`);
  const warn = assumptions.filter((x) => x.status === "warn").length;
  return {
    conclusion: { tone, headline, points, next: "Next: use the betas to size a hedge, or compare with a peer to see what is truly company-specific." },
    assumptions, reasonableness: warn ? "partly reasonable" : "reasonable",
    reasonablenessText: warn ? `${warn} input${warn > 1 ? "s need" : " needs"} a second look.` : "Every input is in a realistic range.",
    suggested: Object.keys(apply).length ? apply : null,
  };
}

/** Return profile: the only input is the history window. */
function assessProfile(d, opts = {}) {
  const m = d.meta || {}, p = d.performance || {}, tr = d.tailRisk || {}, v = d.volatility || {};
  const assumptions = [], apply = {};
  if (isNum(m.years)) {
    if (m.years < 5) { assumptions.push(item("History", `${f2(m.years, 1)} years`, "warn", "Tail and drawdown statistics need rare events; under 5 years the sample may not contain a real crash.", "10 years or Max")); apply.range = "10y"; }
    else assumptions.push(item("History", `${f2(m.years, 1)} years`, "ok", "Long enough to include stressed periods."));
  }
  const v95 = tr.var95 || {};
  const fat = isNum(v95.fatTailPremium) && v95.fatTailPremium > 0.1;
  const tone = fat || (isNum(p.maxDD) && p.maxDD < -0.4) ? "warn" : "good";
  const headline = `${opts.symbol || m.symbol || "This asset"}: ${pct(p.cagr)} a year at ${pctAbs(p.vol)} volatility, with a worst fall of ${pctAbs(p.maxDD)}.`;
  const points = [];
  if (fat) points.push(`Bad days are ${pctAbs(v95.fatTailPremium, 0)} worse than a normal distribution predicts — size positions for the real tail, not the textbook one.`);
  if (v.regime) points.push(`Volatility is currently ${String(v.regime).toLowerCase()} (${pctAbs(v.current21d)} annualised over 21 days).`);
  if (isNum(p.currentDD) && p.currentDD < -0.05) points.push(`It is ${pctAbs(p.currentDD)} below its peak today.`);
  return {
    conclusion: { tone, headline, points, next: "Next: backtest a rule on it, or check its factor exposures." },
    assumptions, reasonableness: assumptions.some((x) => x.status === "warn") ? "partly reasonable" : "reasonable",
    reasonablenessText: assumptions.some((x) => x.status === "warn") ? "The window is short for tail statistics." : "The window is long enough for tail statistics.",
    suggested: Object.keys(apply).length ? apply : null,
  };
}

module.exports = { assessBacktest, assessPairs, assessFactors, assessProfile, robustCell, COST, TYPICAL, isIndian };
