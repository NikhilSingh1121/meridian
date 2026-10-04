/**
 * MERIDIAN — Quant Lab engines.
 *
 * Four deterministic research engines built on the quant-stats kernel:
 *
 *   1 · backtest()          event-driven rule backtester + parameter surface +
 *                           anchored walk-forward + block-bootstrap significance
 *   2 · factorAttribution() multi-factor OLS with Newey-West HAC inference,
 *                           risk decomposition, rolling beta, capture ratios
 *   3 · pairsAnalysis()     Engle-Granger cointegration, OU half-life, spread
 *                           z-score strategy with a full backtest
 *   4 · returnProfile()     tail risk, drawdown anatomy, seasonality, market
 *                           microstructure (overnight vs intraday), regimes
 *
 * Every engine takes plain OHLCV points ({t,o,h,l,c,v}, oldest → newest) and
 * returns plain JSON. No I/O, no randomness except the explicitly-seeded
 * bootstrap, so a given input always produces an identical report.
 */

const S = require("./quant-stats");

const TRADING_DAYS = 252;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const isNum = (v) => v != null && Number.isFinite(v);

/* ══════════════════════════════════════════════════════════════════════════
   ROLLING INDICATOR SERIES
   technicals.js returns final values (what the screener needs). A backtest
   needs the value AT EVERY BAR, so these are the series-valued twins. Leading
   values are null until the lookback window fills — those bars are flat.
   ══════════════════════════════════════════════════════════════════════════ */

function smaSeries(v, p) {
  const out = new Array(v.length).fill(null);
  if (p < 1 || v.length < p) return out;
  let s = 0;
  for (let i = 0; i < v.length; i++) {
    s += v[i];
    if (i >= p) s -= v[i - p];
    if (i >= p - 1) out[i] = s / p;
  }
  return out;
}

function emaSeries(v, p) {
  const out = new Array(v.length).fill(null);
  if (p < 1 || v.length < p) return out;
  const k = 2 / (p + 1);
  let e = 0;
  for (let i = 0; i < p; i++) e += v[i];
  e /= p;
  out[p - 1] = e;
  for (let i = p; i < v.length; i++) { e = v[i] * k + e * (1 - k); out[i] = e; }
  return out;
}

function stdevSeries(v, p) {
  const out = new Array(v.length).fill(null);
  if (v.length < p) return out;
  for (let i = p - 1; i < v.length; i++) {
    const w = v.slice(i - p + 1, i + 1);
    const m = w.reduce((s, x) => s + x, 0) / p;
    out[i] = Math.sqrt(w.reduce((s, x) => s + (x - m) ** 2, 0) / p);
  }
  return out;
}

/** RSI series — Wilder smoothing, seeded on the first `p` deltas. */
function rsiSeries(c, p = 14) {
  const out = new Array(c.length).fill(null);
  if (c.length < p + 1) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) {
    const d = c[i] - c[i - 1];
    if (d >= 0) g += d; else l -= d;
  }
  let ag = g / p, al = l / p;
  out[p] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = p + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    ag = (ag * (p - 1) + (d > 0 ? d : 0)) / p;
    al = (al * (p - 1) + (d < 0 ? -d : 0)) / p;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}

/** MACD series → { macd[], signal[], hist[] }. */
function macdSeries(c, fast = 12, slow = 26, sig = 9) {
  const ef = emaSeries(c, fast), es = emaSeries(c, slow);
  const macd = c.map((_, i) => (ef[i] != null && es[i] != null ? ef[i] - es[i] : null));
  const firstValid = macd.findIndex((v) => v != null);
  const signal = new Array(c.length).fill(null);
  if (firstValid >= 0) {
    const compact = macd.slice(firstValid);
    const sg = emaSeries(compact, sig);
    for (let i = 0; i < sg.length; i++) signal[firstValid + i] = sg[i];
  }
  const hist = macd.map((v, i) => (v != null && signal[i] != null ? v - signal[i] : null));
  return { macd, signal, hist };
}

/** True-range series (index 0 is null — no prior close). */
function trSeries(h, l, c) {
  const out = new Array(c.length).fill(null);
  for (let i = 1; i < c.length; i++) {
    out[i] = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
  }
  return out;
}

/** ATR series — Wilder smoothing of true range. */
function atrSeries(h, l, c, p = 14) {
  const tr = trSeries(h, l, c);
  const out = new Array(c.length).fill(null);
  if (c.length < p + 1) return out;
  let a = 0;
  for (let i = 1; i <= p; i++) a += tr[i];
  a /= p;
  out[p] = a;
  for (let i = p + 1; i < c.length; i++) { a = (a * (p - 1) + tr[i]) / p; out[i] = a; }
  return out;
}

/** ADX series — Wilder directional movement index. */
function adxSeries(h, l, c, p = 14) {
  const n = c.length;
  const out = new Array(n).fill(null);
  if (n < p * 2 + 2) return out;
  const tr = [], pdm = [], ndm = [];
  for (let i = 1; i < n; i++) {
    tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
    const up = h[i] - h[i - 1], dn = l[i - 1] - l[i];
    pdm.push(up > dn && up > 0 ? up : 0);
    ndm.push(dn > up && dn > 0 ? dn : 0);
  }
  const wilder = (arr) => {
    let s = 0;
    for (let i = 0; i < p; i++) s += arr[i];
    const o = [s];
    for (let i = p; i < arr.length; i++) { s = s - s / p + arr[i]; o.push(s); }
    return o;
  };
  const trS = wilder(tr), pS = wilder(pdm), nS = wilder(ndm);
  const dx = trS.map((t, i) => {
    if (!t) return 0;
    const pdi = (pS[i] / t) * 100, ndi = (nS[i] / t) * 100;
    return pdi + ndi ? (Math.abs(pdi - ndi) / (pdi + ndi)) * 100 : 0;
  });
  if (dx.length < p) return out;
  let a = 0;
  for (let i = 0; i < p; i++) a += dx[i];
  a /= p;
  // Index map: tr[j] is bar j+1, so the Wilder sum trS[j] lands on bar j+p and
  // therefore dx[j] does too. Seeding on dx[0..p−1] puts the first ADX at bar
  // 2p−1, and each subsequent dx[i] updates bar i+p.
  out[2 * p - 1] = a;
  for (let i = p; i < dx.length; i++) {
    a = (a * (p - 1) + dx[i]) / p;
    const bar = i + p;
    if (bar < n) out[bar] = a;
  }
  return out;
}

/** Rolling highest-high / lowest-low over the PRIOR p bars (excludes current). */
function donchianSeries(h, l, p) {
  const n = h.length;
  const hi = new Array(n).fill(null), lo = new Array(n).fill(null);
  for (let i = p; i < n; i++) {
    let mx = -Infinity, mn = Infinity;
    for (let j = i - p; j < i; j++) { if (h[j] > mx) mx = h[j]; if (l[j] < mn) mn = l[j]; }
    hi[i] = mx; lo[i] = mn;
  }
  return { hi, lo };
}

/* ══════════════════════════════════════════════════════════════════════════
   STRATEGY LIBRARY
   Each strategy maps market state → a DESIRED POSITION at the close of bar i
   (+1 long · 0 flat · −1 short). The engine executes at the NEXT bar, so no
   signal can ever use information from the bar it trades on.
   ══════════════════════════════════════════════════════════════════════════ */

const STRATEGIES = {
  sma_cross: {
    label: "Moving-average crossover",
    family: "Trend",
    thesis: "Long while the fast average is above the slow one. The canonical trend filter — profits from persistence, bleeds in chop.",
    rule: "LONG when SMA(fast) > SMA(slow); FLAT otherwise.",
    params: [
      { key: "fast", label: "Fast SMA", def: 20, min: 5, max: 60, step: 5 },
      { key: "slow", label: "Slow SMA", def: 100, min: 40, max: 250, step: 10 },
    ],
    signal(ctx, p) {
      if (p.fast >= p.slow) return ctx.closes.map(() => 0);
      const f = smaSeries(ctx.closes, p.fast), s = smaSeries(ctx.closes, p.slow);
      return ctx.closes.map((_, i) => (f[i] != null && s[i] != null && f[i] > s[i] ? 1 : 0));
    },
  },

  ema_cross_adx: {
    label: "EMA cross, ADX-filtered",
    family: "Trend",
    thesis: "The same trend signal, but only taken when ADX confirms a directional market. Trades far less; the filter is what kills the whipsaw tax.",
    rule: "LONG when EMA(fast) > EMA(slow) AND ADX(14) > threshold; FLAT otherwise.",
    params: [
      { key: "fast", label: "Fast EMA", def: 20, min: 5, max: 60, step: 5 },
      { key: "slow", label: "Slow EMA", def: 60, min: 30, max: 200, step: 10 },
      { key: "adxMin", label: "ADX floor", def: 22, min: 10, max: 40, step: 2 },
    ],
    signal(ctx, p) {
      if (p.fast >= p.slow) return ctx.closes.map(() => 0);
      const f = emaSeries(ctx.closes, p.fast), s = emaSeries(ctx.closes, p.slow);
      const a = adxSeries(ctx.highs, ctx.lows, ctx.closes, 14);
      return ctx.closes.map((_, i) => (f[i] != null && s[i] != null && a[i] != null && f[i] > s[i] && a[i] > p.adxMin ? 1 : 0));
    },
  },

  donchian_breakout: {
    label: "Donchian channel breakout",
    family: "Breakout",
    thesis: "The Turtle rule. Buy a new N-day high, exit on an M-day low. Few winners pay for many small losers — expect a low hit rate and a high payoff ratio.",
    rule: "ENTER LONG when close > highest high of prior N bars; EXIT when close < lowest low of prior M bars.",
    params: [
      { key: "entry", label: "Entry window", def: 55, min: 10, max: 120, step: 5 },
      { key: "exit", label: "Exit window", def: 20, min: 5, max: 60, step: 5 },
    ],
    signal(ctx, p) {
      const e = donchianSeries(ctx.highs, ctx.lows, p.entry);
      const x = donchianSeries(ctx.highs, ctx.lows, p.exit);
      const out = new Array(ctx.closes.length).fill(0);
      let pos = 0;
      for (let i = 0; i < ctx.closes.length; i++) {
        const c = ctx.closes[i];
        if (pos === 0 && e.hi[i] != null && c > e.hi[i]) pos = 1;
        else if (pos === 1 && x.lo[i] != null && c < x.lo[i]) pos = 0;
        out[i] = pos;
      }
      return out;
    },
  },

  atr_chandelier: {
    label: "Trend with ATR chandelier stop",
    family: "Trend",
    thesis: "Enter on trend confirmation, then trail a volatility-scaled stop below the running high. Volatility sizing is what makes the same rule behave the same way across quiet and violent regimes.",
    rule: "ENTER LONG when close > EMA(trend); EXIT when close < (highest close since entry − k × ATR14).",
    params: [
      { key: "trend", label: "Trend EMA", def: 50, min: 20, max: 200, step: 10 },
      { key: "k", label: "ATR multiple", def: 3, min: 1, max: 6, step: 0.5 },
    ],
    signal(ctx, p) {
      const e = emaSeries(ctx.closes, p.trend);
      const a = atrSeries(ctx.highs, ctx.lows, ctx.closes, 14);
      const out = new Array(ctx.closes.length).fill(0);
      let pos = 0, runHigh = -Infinity;
      for (let i = 0; i < ctx.closes.length; i++) {
        const c = ctx.closes[i];
        if (pos === 1) {
          runHigh = Math.max(runHigh, c);
          if (a[i] != null && c < runHigh - p.k * a[i]) pos = 0;
        }
        if (pos === 0 && e[i] != null && a[i] != null && c > e[i]) { pos = 1; runHigh = c; }
        out[i] = pos;
      }
      return out;
    },
  },

  rsi_reversion: {
    label: "RSI mean reversion",
    family: "Mean reversion",
    thesis: "Buy statistical exhaustion, sell the snap-back. Works in range-bound, high-liquidity names; catastrophic in a downtrend without the regime filter.",
    rule: "ENTER LONG when RSI(period) < oversold; EXIT when RSI > exit level. Optional 200-day filter blocks entries below the long-term average.",
    params: [
      { key: "period", label: "RSI period", def: 14, min: 5, max: 30, step: 1 },
      { key: "oversold", label: "Entry (oversold)", def: 30, min: 10, max: 45, step: 5 },
      { key: "exitAt", label: "Exit level", def: 55, min: 45, max: 80, step: 5 },
      { key: "trendFilter", label: "200-DMA filter (1=on)", def: 1, min: 0, max: 1, step: 1 },
    ],
    signal(ctx, p) {
      const r = rsiSeries(ctx.closes, Math.round(p.period));
      const sm = smaSeries(ctx.closes, 200);
      const out = new Array(ctx.closes.length).fill(0);
      let pos = 0;
      for (let i = 0; i < ctx.closes.length; i++) {
        if (r[i] != null) {
          const allowed = p.trendFilter < 0.5 || (sm[i] != null && ctx.closes[i] > sm[i]);
          if (pos === 0 && r[i] < p.oversold && allowed) pos = 1;
          else if (pos === 1 && r[i] > p.exitAt) pos = 0;
        }
        out[i] = pos;
      }
      return out;
    },
  },

  bollinger_reversion: {
    label: "Bollinger band reversion",
    family: "Mean reversion",
    thesis: "Fade a stretch beyond the lower band and exit at the mean. A direct bet that price is stationary around its own moving average.",
    rule: "ENTER LONG when close < lower band (n, k·σ); EXIT when close ≥ middle band.",
    params: [
      { key: "period", label: "Band period", def: 20, min: 10, max: 60, step: 5 },
      { key: "k", label: "σ multiple", def: 2, min: 1, max: 3.5, step: 0.25 },
    ],
    signal(ctx, p) {
      const per = Math.round(p.period);
      const m = smaSeries(ctx.closes, per), sd = stdevSeries(ctx.closes, per);
      const out = new Array(ctx.closes.length).fill(0);
      let pos = 0;
      for (let i = 0; i < ctx.closes.length; i++) {
        if (m[i] != null && sd[i] != null) {
          const lower = m[i] - p.k * sd[i];
          if (pos === 0 && ctx.closes[i] < lower) pos = 1;
          else if (pos === 1 && ctx.closes[i] >= m[i]) pos = 0;
        }
        out[i] = pos;
      }
      return out;
    },
  },

  macd_trend: {
    label: "MACD histogram",
    family: "Momentum",
    thesis: "Long while the MACD line leads its signal. A smoothed rate-of-change filter — earlier than a moving-average cross, and noisier for it.",
    rule: "LONG when MACD(fast, slow) > signal(9); FLAT otherwise.",
    params: [
      { key: "fast", label: "Fast EMA", def: 12, min: 5, max: 30, step: 1 },
      { key: "slow", label: "Slow EMA", def: 26, min: 15, max: 60, step: 1 },
    ],
    signal(ctx, p) {
      if (p.fast >= p.slow) return ctx.closes.map(() => 0);
      const m = macdSeries(ctx.closes, Math.round(p.fast), Math.round(p.slow), 9);
      return ctx.closes.map((_, i) => (m.hist[i] != null && m.hist[i] > 0 ? 1 : 0));
    },
  },

  momentum_12_1: {
    label: "Time-series momentum (12−1)",
    family: "Momentum",
    thesis: "The academic cross-sectional momentum factor applied to one name: hold when the past year excluding last month was positive. Skipping the most recent month sidesteps short-term reversal.",
    rule: "LONG when the return from t−lookback to t−skip is positive, re-evaluated every `hold` bars.",
    params: [
      { key: "lookback", label: "Lookback (bars)", def: 252, min: 60, max: 504, step: 21 },
      { key: "skip", label: "Skip recent (bars)", def: 21, min: 0, max: 63, step: 7 },
      { key: "hold", label: "Rebalance every", def: 21, min: 1, max: 63, step: 5 },
    ],
    signal(ctx, p) {
      const c = ctx.closes;
      const lb = Math.round(p.lookback), sk = Math.round(p.skip), hold = Math.max(1, Math.round(p.hold));
      const out = new Array(c.length).fill(0);
      let pos = 0;
      for (let i = 0; i < c.length; i++) {
        if (i % hold === 0 && i - lb >= 0 && i - sk >= 0) {
          const past = c[i - lb], recent = c[i - sk];
          pos = past > 0 && recent / past - 1 > 0 ? 1 : 0;
        }
        out[i] = pos;
      }
      return out;
    },
  },

  volatility_regime: {
    label: "Volatility-regime trend",
    family: "Regime",
    thesis: "Own the trend only while realised volatility sits below its own recent norm. Risk-off when turbulence spikes — a crude but effective drawdown brake.",
    rule: "LONG when close > SMA(trend) AND realised vol(21) < percentile of its trailing 1-year distribution.",
    params: [
      { key: "trend", label: "Trend SMA", def: 100, min: 20, max: 250, step: 10 },
      { key: "volPct", label: "Vol percentile cap", def: 70, min: 30, max: 95, step: 5 },
    ],
    signal(ctx, p) {
      const c = ctx.closes;
      const sm = smaSeries(c, Math.round(p.trend));
      const rets = [null, ...S.simpleReturns(c)];
      const vol = new Array(c.length).fill(null);
      for (let i = 21; i < c.length; i++) {
        const w = rets.slice(i - 20, i + 1).filter(isNum);
        vol[i] = w.length > 5 ? S.stdev(w) : null;
      }
      const out = new Array(c.length).fill(0);
      for (let i = 0; i < c.length; i++) {
        if (sm[i] == null || vol[i] == null || i < TRADING_DAYS) continue;
        const hist = vol.slice(Math.max(0, i - TRADING_DAYS), i).filter(isNum);
        if (hist.length < 60) continue;
        const cap = S.quantile(hist, p.volPct / 100);
        out[i] = c[i] > sm[i] && vol[i] <= cap ? 1 : 0;
      }
      return out;
    },
  },

  dual_momentum_ma: {
    label: "Golden-cross regime",
    family: "Trend",
    thesis: "The slowest, most-quoted regime switch there is. Very few trades, long holding periods — a fair benchmark for whether faster rules are earning their turnover.",
    rule: "LONG when SMA(50) > SMA(200) AND close > SMA(200); FLAT otherwise.",
    params: [
      { key: "fast", label: "Fast SMA", def: 50, min: 20, max: 100, step: 5 },
      { key: "slow", label: "Slow SMA", def: 200, min: 100, max: 300, step: 10 },
    ],
    signal(ctx, p) {
      if (p.fast >= p.slow) return ctx.closes.map(() => 0);
      const f = smaSeries(ctx.closes, Math.round(p.fast)), s = smaSeries(ctx.closes, Math.round(p.slow));
      return ctx.closes.map((_, i) => (f[i] != null && s[i] != null && f[i] > s[i] && ctx.closes[i] > s[i] ? 1 : 0));
    },
  },
};

/** Public catalogue for the UI (no functions). */
function strategyCatalogue() {
  return Object.entries(STRATEGIES).map(([id, s]) => ({
    id, label: s.label, family: s.family, thesis: s.thesis, rule: s.rule, params: s.params,
  }));
}

function resolveParams(id, given = {}) {
  const s = STRATEGIES[id];
  if (!s) return null;
  const p = {};
  for (const def of s.params) {
    const raw = given[def.key];
    const v = raw == null || !Number.isFinite(Number(raw)) ? def.def : Number(raw);
    p[def.key] = clamp(v, def.min, def.max);
  }
  return p;
}

/* ══════════════════════════════════════════════════════════════════════════
   1 · BACKTEST ENGINE
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Core simulation. Positions decided at bar i are held from i+1, so the return
 * booked on bar i+1 is earned by a decision that could only see bars ≤ i.
 * Costs (commission + slippage, in basis points) are charged on the full
 * notional traded whenever the held position changes.
 */
function simulate(ctx, positions, { costBps = 10 } = {}) {
  const c = ctx.closes;
  const n = c.length;
  const cost = costBps / 10000;
  const held = new Array(n).fill(0);
  for (let i = 1; i < n; i++) held[i] = positions[i - 1] || 0;

  const rets = new Array(n).fill(0);
  const trades = [];
  let open = null;
  let costsPaid = 0;
  let turnover = 0;

  for (let i = 1; i < n; i++) {
    const bar = c[i - 1] ? c[i] / c[i - 1] - 1 : 0;
    const traded = Math.abs(held[i] - held[i - 1]);
    const fee = traded * cost;
    costsPaid += fee;
    turnover += traded;
    rets[i] = held[i] * bar - fee;

    if (held[i] !== held[i - 1]) {
      if (open) {
        const exitPx = c[i - 1];
        open.exitIdx = i - 1;
        open.exitDate = ctx.dates[i - 1];
        open.exitPrice = exitPx;
        open.bars = open.exitIdx - open.entryIdx;
        open.grossReturn = open.side * (exitPx / open.entryPrice - 1);
        open.netReturn = open.grossReturn - 2 * cost;
        trades.push(open);
        open = null;
      }
      if (held[i] !== 0) {
        // held[i] is the position carried ACROSS bar i, i.e. established at
        // the close of bar i−1. Booking the entry at c[i] instead would make
        // the trade ledger understate every trade by its first bar's move and
        // silently disagree with the equity curve.
        open = {
          side: held[i], entryIdx: i - 1, entryDate: ctx.dates[i - 1], entryPrice: c[i - 1],
          mfe: 0, mae: 0,
        };
      }
    }
    if (open) {
      const move = open.side * (c[i] / open.entryPrice - 1);
      open.mfe = Math.max(open.mfe, move);
      open.mae = Math.min(open.mae, move);
    }
  }
  if (open) {
    open.exitIdx = n - 1;
    open.exitDate = ctx.dates[n - 1];
    open.exitPrice = c[n - 1];
    open.bars = open.exitIdx - open.entryIdx;
    open.grossReturn = open.side * (open.exitPrice / open.entryPrice - 1);
    open.netReturn = open.grossReturn - 2 * cost;
    open.stillOpen = true;
    trades.push(open);
  }

  const active = rets.slice(1);
  const exposure = held.slice(1).filter((h) => h !== 0).length / Math.max(1, n - 1);
  return { returns: active, held, trades, exposure, costsPaid, turnover };
}

/** Trade-level statistics — the part of a backtest that reveals its character. */
function tradeStats(trades) {
  if (!trades.length) {
    return { n: 0, winRate: null, profitFactor: null, avgWin: null, avgLoss: null,
      expectancy: null, payoff: null, best: null, worst: null, avgBars: null,
      maxConsecLosses: 0, maxConsecWins: 0, sqn: null };
  }
  const r = trades.map((t) => t.netReturn);
  const wins = r.filter((v) => v > 0), losses = r.filter((v) => v <= 0);
  const gp = wins.reduce((s, v) => s + v, 0);
  const gl = Math.abs(losses.reduce((s, v) => s + v, 0));
  let cw = 0, cl = 0, mw = 0, ml = 0;
  for (const v of r) {
    if (v > 0) { cw++; cl = 0; mw = Math.max(mw, cw); }
    else { cl++; cw = 0; ml = Math.max(ml, cl); }
  }
  const m = S.mean(r), sd = S.stdev(r);
  return {
    n: trades.length,
    winRate: wins.length / trades.length,
    profitFactor: gl > 0 ? gp / gl : (gp > 0 ? Infinity : null),
    avgWin: wins.length ? S.mean(wins) : null,
    avgLoss: losses.length ? S.mean(losses) : null,
    expectancy: m,
    payoff: wins.length && losses.length ? Math.abs(S.mean(wins) / S.mean(losses)) : null,
    best: Math.max(...r), worst: Math.min(...r),
    avgBars: S.mean(trades.map((t) => t.bars)),
    avgMFE: S.mean(trades.map((t) => t.mfe)),
    avgMAE: S.mean(trades.map((t) => t.mae)),
    maxConsecWins: mw, maxConsecLosses: ml,
    // Van Tharp System Quality Number — expectancy per unit of trade-level noise
    sqn: sd ? (m / sd) * Math.sqrt(Math.min(100, trades.length)) : null,
  };
}

/** Score used for optimisation — Sharpe, penalised when the sample is thin. */
function objective(perf, tstats, minTrades = 5) {
  if (!perf || perf.sharpe == null) return -Infinity;
  if (tstats.n < minTrades) return -Infinity;
  return perf.sharpe;
}

/**
 * Parameter surface: sweep the strategy's two most important numeric
 * parameters and record Sharpe / CAGR / maxDD at every node. A single bright
 * cell in a dark field is an overfit; a broad plateau is a real edge.
 */
function parameterSurface(ctx, id, baseParams, { costBps, maxNodes = 240 } = {}) {
  const spec = STRATEGIES[id];
  if (!spec || spec.params.length < 2) return null;
  const [px, py] = spec.params.slice(0, 2);
  const axis = (d) => {
    const steps = Math.floor((d.max - d.min) / d.step) + 1;
    const stride = Math.max(1, Math.ceil(steps / 12));
    const out = [];
    for (let i = 0; i < steps; i += stride) out.push(+(d.min + i * d.step).toFixed(4));
    if (out[out.length - 1] !== d.max) out.push(d.max);
    return out;
  };
  let xs = axis(px), ys = axis(py);
  while (xs.length * ys.length > maxNodes) {
    if (xs.length >= ys.length) xs = xs.filter((_, i) => i % 2 === 0);
    else ys = ys.filter((_, i) => i % 2 === 0);
  }

  const sharpe = [], cagr = [], dd = [], trades = [];
  for (const yv of ys) {
    const rowS = [], rowC = [], rowD = [], rowT = [];
    for (const xv of xs) {
      const p = { ...baseParams, [px.key]: xv, [py.key]: yv };
      const sig = spec.signal(ctx, p);
      const sim = simulate(ctx, sig, { costBps });
      const perf = S.performance(sim.returns, { years: ctx.years });
      const ts = tradeStats(sim.trades);
      rowS.push(perf && ts.n >= 3 ? +perf.sharpe.toFixed(3) : null);
      rowC.push(perf && ts.n >= 3 && perf.cagr != null ? +(perf.cagr * 100).toFixed(2) : null);
      rowD.push(perf && ts.n >= 3 && perf.maxDD != null ? +(perf.maxDD * 100).toFixed(2) : null);
      rowT.push(ts.n);
    }
    sharpe.push(rowS); cagr.push(rowC); dd.push(rowD); trades.push(rowT);
  }

  const flat = sharpe.flat().filter(isNum);
  const median = flat.length ? S.quantile(flat, 0.5) : null;
  const best = flat.length ? Math.max(...flat) : null;
  // Plateau ratio: share of the grid within 25% of the best Sharpe. High is
  // good — the edge survives parameter perturbation.
  const plateau = flat.length && best > 0 ? flat.filter((v) => v >= best * 0.75).length / flat.length : null;
  return {
    xKey: px.key, xLabel: px.label, xs,
    yKey: py.key, yLabel: py.label, ys,
    sharpe, cagr, dd, trades,
    medianSharpe: median, bestSharpe: best, plateauRatio: plateau,
    robustness: plateau == null ? null : plateau > 0.35 ? "Broad plateau — parameter-insensitive"
      : plateau > 0.15 ? "Moderate — edge narrows off-centre"
      : "Narrow peak — likely curve-fit",
  };
}

/**
 * Anchored walk-forward validation.
 * The window is split into folds; each fold optimises on everything seen so
 * far and is graded ONLY on the next unseen block. The stitched out-of-sample
 * curve is the closest thing a backtest offers to an honest track record.
 */
function walkForward(ctx, id, baseParams, { costBps, folds = 4 } = {}) {
  const spec = STRATEGIES[id];
  const n = ctx.closes.length;
  if (!spec || n < 400) return null;
  const grid = [];
  const [px, py] = spec.params;
  const axisOf = (d) => {
    const out = [];
    const steps = Math.min(8, Math.floor((d.max - d.min) / d.step) + 1);
    const stride = (d.max - d.min) / Math.max(1, steps - 1);
    for (let i = 0; i < steps; i++) out.push(+(d.min + i * stride).toFixed(4));
    return out;
  };
  for (const a of axisOf(px)) {
    if (py) for (const b of axisOf(py)) grid.push({ ...baseParams, [px.key]: a, [py.key]: b });
    else grid.push({ ...baseParams, [px.key]: a });
  }

  const seg = Math.floor(n / (folds + 1));
  const oosReturns = [];
  const foldRows = [];
  for (let f = 0; f < folds; f++) {
    const isEnd = seg * (f + 1);
    const oosEnd = Math.min(n, seg * (f + 2));
    if (oosEnd - isEnd < 20) break;
    const isCtx = sliceCtx(ctx, 0, isEnd);
    let bestP = null, bestScore = -Infinity;
    for (const p of grid) {
      const sim = simulate(isCtx, spec.signal(isCtx, p), { costBps });
      const perf = S.performance(sim.returns, { years: isCtx.years });
      const sc = objective(perf, tradeStats(sim.trades), 3);
      if (sc > bestScore) { bestScore = sc; bestP = p; }
    }
    if (!bestP) continue;
    // Signals need history, so generate over [0, oosEnd) and grade only the tail.
    const fullCtx = sliceCtx(ctx, 0, oosEnd);
    const sim = simulate(fullCtx, spec.signal(fullCtx, bestP), { costBps });
    const tail = sim.returns.slice(isEnd - 1);
    oosReturns.push(...tail);
    const perfOOS = S.performance(tail, { years: tail.length / TRADING_DAYS });
    foldRows.push({
      fold: f + 1,
      isFrom: ctx.dates[0], isTo: ctx.dates[isEnd - 1],
      oosFrom: ctx.dates[isEnd], oosTo: ctx.dates[oosEnd - 1],
      params: bestP,
      isSharpe: +bestScore.toFixed(3),
      oosSharpe: perfOOS && perfOOS.sharpe != null ? +perfOOS.sharpe.toFixed(3) : null,
      oosReturn: perfOOS ? perfOOS.totalReturn : null,
      bars: tail.length,
    });
  }
  if (!foldRows.length) return null;
  const stitched = S.performance(oosReturns, { years: oosReturns.length / TRADING_DAYS });
  const isAvg = S.mean(foldRows.map((f) => f.isSharpe).filter(isNum));
  const oosAvg = S.mean(foldRows.map((f) => f.oosSharpe).filter(isNum));
  return {
    folds: foldRows,
    oos: stitched,
    isAvgSharpe: isAvg, oosAvgSharpe: oosAvg,
    efficiency: isAvg && isAvg !== 0 ? oosAvg / isAvg : null,
    verdict: oosAvg == null ? "Inconclusive"
      : oosAvg <= 0 ? "Fails out of sample — the in-sample result was fitted"
      : isAvg && oosAvg / isAvg > 0.6 ? "Holds up out of sample"
      : "Degrades out of sample — treat the headline numbers as optimistic",
  };
}

/** Deterministic 32-bit PRNG so bootstrap results are reproducible. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Stationary block bootstrap of the strategy's daily returns.
 * Resampling in blocks preserves short-horizon autocorrelation, so the
 * resulting spread of outcomes is a fair answer to "how much of this equity
 * curve was luck?".
 */
function bootstrap(returns, { runs = 1000, block = 20, seed = 20260726, years } = {}) {
  const r = returns.filter(isNum);
  if (r.length < 60) return null;
  const rnd = mulberry32(seed);
  const cagrs = [], dds = [], sharpes = [];
  const yrs = years || r.length / TRADING_DAYS;
  for (let run = 0; run < runs; run++) {
    const path = [];
    while (path.length < r.length) {
      const start = Math.floor(rnd() * r.length);
      const len = Math.min(block, r.length - path.length);
      for (let i = 0; i < len; i++) path.push(r[(start + i) % r.length]);
    }
    let eq = 1, peak = 1, mdd = 0;
    for (const v of path) {
      eq *= 1 + v;
      if (eq > peak) peak = eq;
      const d = eq / peak - 1;
      if (d < mdd) mdd = d;
    }
    cagrs.push(eq > 0 ? Math.pow(eq, 1 / yrs) - 1 : -1);
    dds.push(mdd);
    const sd = S.stdev(path);
    sharpes.push(sd ? (S.mean(path) / sd) * Math.sqrt(TRADING_DAYS) : 0);
  }
  const pct = (a, q) => S.quantile(a, q);
  return {
    runs,
    cagr: { p5: pct(cagrs, 0.05), p25: pct(cagrs, 0.25), median: pct(cagrs, 0.5), p75: pct(cagrs, 0.75), p95: pct(cagrs, 0.95) },
    maxDD: { p5: pct(dds, 0.05), median: pct(dds, 0.5), p95: pct(dds, 0.95), worst: Math.min(...dds) },
    sharpe: { p5: pct(sharpes, 0.05), median: pct(sharpes, 0.5), p95: pct(sharpes, 0.95) },
    probProfit: cagrs.filter((v) => v > 0).length / runs,
    probSharpeAbove1: sharpes.filter((v) => v > 1).length / runs,
  };
}

function sliceCtx(ctx, from, to) {
  return {
    closes: ctx.closes.slice(from, to),
    highs: ctx.highs.slice(from, to),
    lows: ctx.lows.slice(from, to),
    volumes: ctx.volumes.slice(from, to),
    dates: ctx.dates.slice(from, to),
    years: (to - from) / TRADING_DAYS,
  };
}

function buildCtx(points) {
  const p = (points || []).filter((x) => x && isNum(x.c));
  return {
    closes: p.map((x) => x.c),
    highs: p.map((x) => (isNum(x.h) ? x.h : x.c)),
    lows: p.map((x) => (isNum(x.l) ? x.l : x.c)),
    volumes: p.map((x) => x.v || 0),
    dates: p.map((x) => S.dayKey(x.t)),
    stamps: p.map((x) => x.t),
    years: p.length / TRADING_DAYS,
  };
}

/**
 * Full backtest report.
 *
 * @param points   OHLCV array, oldest → newest
 * @param opts     { strategy, params, costBps, rf, surface, walkForward, mc }
 */
function backtest(points, opts = {}) {
  const ctx = buildCtx(points);
  if (ctx.closes.length < 120) return { error: "Need at least 120 trading days of history to backtest." };
  const id = STRATEGIES[opts.strategy] ? opts.strategy : "sma_cross";
  const spec = STRATEGIES[id];
  const params = resolveParams(id, opts.params || {});
  const costBps = clamp(Number(opts.costBps ?? 10), 0, 200);
  const rf = clamp(Number(opts.rf ?? 0), 0, 0.2);

  const positions = spec.signal(ctx, params);
  const sim = simulate(ctx, positions, { costBps });
  const perf = S.performance(sim.returns, { years: ctx.years, rf });
  const ts = tradeStats(sim.trades);

  // Buy & hold on the identical window — the only benchmark that matters.
  const bhRets = S.simpleReturns(ctx.closes);
  const bh = S.performance(bhRets, { years: ctx.years, rf });

  // Strategy-vs-market regression: does the rule add anything beyond exposure?
  const reg = S.ols1(sim.returns, bhRets.slice(0, sim.returns.length));
  const alphaAnn = reg ? reg.alpha * TRADING_DAYS : null;

  const trades = sim.trades.map((t) => ({
    side: t.side > 0 ? "LONG" : "SHORT",
    entryDate: t.entryDate, entryPrice: +t.entryPrice.toFixed(2),
    exitDate: t.exitDate, exitPrice: +t.exitPrice.toFixed(2),
    bars: t.bars, ret: t.netReturn, mfe: t.mfe, mae: t.mae, stillOpen: !!t.stillOpen,
  }));

  // Down-sample the equity curves so the payload stays small on 10y windows.
  const stride = Math.max(1, Math.floor(perf.equity.length / 700));
  const bhEq = S.equityCurve(bhRets);
  const curve = [];
  for (let i = 0; i < perf.equity.length; i += stride) {
    curve.push({
      d: ctx.dates[i + 1] || ctx.dates[i],
      s: +perf.equity[i].toFixed(4),
      b: +(bhEq[i] ?? bhEq[bhEq.length - 1]).toFixed(4),
      dd: +(perf.ddCurve[i] * 100).toFixed(2),
    });
  }

  return {
    meta: {
      strategy: id, label: spec.label, family: spec.family, rule: spec.rule, thesis: spec.thesis,
      params, paramSpec: spec.params, costBps, rf,
      from: ctx.dates[0], to: ctx.dates[ctx.dates.length - 1],
      bars: ctx.closes.length, years: +ctx.years.toFixed(2),
    },
    performance: {
      totalReturn: perf.totalReturn, cagr: perf.cagr, vol: perf.vol,
      sharpe: perf.sharpe, sortino: perf.sortino, calmar: perf.calmar,
      maxDD: perf.maxDD, longestDDBars: perf.longestDDBars, currentDD: perf.currentDD,
      exposure: sim.exposure, turnover: sim.turnover, costDrag: sim.costsPaid,
      tStat: perf.tStat, pValue: perf.pValue,
      skew: perf.skew, excessKurtosis: perf.excessKurtosis,
      winRateDaily: perf.winRateDaily, bestDay: perf.bestDay, worstDay: perf.worstDay,
    },
    benchmark: {
      totalReturn: bh.totalReturn, cagr: bh.cagr, vol: bh.vol, sharpe: bh.sharpe,
      maxDD: bh.maxDD, sortino: bh.sortino, calmar: bh.calmar,
    },
    versusMarket: reg ? {
      alphaDaily: reg.alpha, alphaAnnualised: alphaAnn, alphaT: reg.tAlpha, alphaP: reg.pAlpha,
      beta: reg.beta, betaT: reg.tBeta, r2: reg.r2,
    } : null,
    trades: ts,
    tradeList: trades.slice(-60).reverse(),
    drawdowns: (perf.ddEpisodes || []).slice(0, 5).map((e) => ({
      depth: e.depth,
      peak: ctx.dates[e.peakIdx] || null,
      trough: ctx.dates[e.troughIdx] || null,
      recovery: e.recoveryIdx == null ? null : ctx.dates[e.recoveryIdx],
      declineBars: e.declineBars, totalBars: e.totalBars, underwater: e.underwater,
    })),
    curve,
    surface: opts.surface === false ? null : parameterSurface(ctx, id, params, { costBps }),
    walkForward: opts.walkForward === false ? null : walkForward(ctx, id, params, { costBps }),
    bootstrap: opts.mc === false ? null : bootstrap(sim.returns, { years: ctx.years }),
  };
}

/**
 * Strategy leaderboard: every rule in the catalogue at its published defaults
 * (nothing is optimised, so nothing is fitted), on the same candles and costs.
 * Each run is also split into three equal sub-periods: a rule that only worked
 * in one of them is a regime bet, not an edge.
 */
function compareStrategies(points, { costBps = 10 } = {}) {
  const ctx = buildCtx(points);
  if (ctx.closes.length < 250) return { error: "Need at least a year of daily history to compare strategies." };
  const bhRets = S.simpleReturns(ctx.closes);
  const bh = S.performance(bhRets, { years: ctx.years });
  const thirds = (r) => { const k = Math.floor(r.length / 3); return [r.slice(0, k), r.slice(k, 2 * k), r.slice(2 * k)].map((x) => { const p = S.performance(x, { years: x.length / TRADING_DAYS }); return p && p.sharpe != null ? +p.sharpe.toFixed(2) : null; }); };
  const rows = Object.entries(STRATEGIES).map(([id, spec]) => {
    const params = resolveParams(id, {});
    const sim = simulate(ctx, spec.signal(ctx, params), { costBps });
    const perf = S.performance(sim.returns, { years: ctx.years });
    const ts = tradeStats(sim.trades);
    const sub = thirds(sim.returns);
    return {
      id, label: spec.label, family: spec.family, params,
      cagr: perf ? perf.cagr : null, sharpe: perf ? perf.sharpe : null, maxDD: perf ? perf.maxDD : null,
      exposure: sim.exposure, trades: ts.n, winRate: ts.winRate, costDrag: sim.costsPaid,
      subSharpe: sub, consistent: sub.filter((v) => v != null && v > 0).length,
      beatsHold: perf && bh && perf.sharpe != null && bh.sharpe != null ? perf.sharpe > bh.sharpe : null,
    };
  });
  rows.sort((a, b) => (b.sharpe ?? -9) - (a.sharpe ?? -9));
  return {
    from: ctx.dates[0], to: ctx.dates[ctx.dates.length - 1], years: +ctx.years.toFixed(2), costBps,
    benchmark: bh ? { cagr: bh.cagr, sharpe: bh.sharpe, maxDD: bh.maxDD, subSharpe: thirds(bhRets) } : null,
    rows,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   2 · FACTOR ATTRIBUTION
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Multi-factor regression of an asset's excess return on factor returns.
 *
 * Factors arrive already differenced into long-short spreads by the caller
 * (e.g. SMB = smallcap index − largecap index), so a beta reads directly as
 * "exposure per unit of that style", and alpha is what is left after paying
 * for every exposure the model can price.
 *
 * @param assetReturns  daily simple returns
 * @param factors       { name: number[] } aligned to assetReturns
 * @param opts          { rf (annual), marketKey, rollWindow }
 */
function factorAttribution(assetReturns, factors, opts = {}) {
  const names = Object.keys(factors);
  const n = assetReturns.length;
  if (n < 60 || !names.length) return null;
  const rfDaily = (opts.rf ?? 0) / TRADING_DAYS;

  const y = assetReturns.map((v) => v - rfDaily);
  const X = [];
  for (let i = 0; i < n; i++) X.push(names.map((k) => factors[k][i]));
  const reg = S.ols(y, X);
  if (!reg) return null;

  /* Variance-inflation factors. Style proxies overlap by construction (a
     momentum ETF is full of quality names), and collinear regressors inflate
     standard errors — so every loading is reported next to the VIF that says
     how much of its imprecision is the model's own fault. VIF > 5 ⇒ read that
     beta as a blend, not a clean exposure. */
  const vif = {};
  if (names.length > 1) {
    for (let j = 0; j < names.length; j++) {
      const others = names.filter((_, i) => i !== j);
      const Xo = [];
      for (let i = 0; i < n; i++) Xo.push(others.map((k) => factors[k][i]));
      const r = S.ols(factors[names[j]], Xo);
      vif[names[j]] = r && r.r2 != null && r.r2 < 0.9999 ? 1 / (1 - r.r2) : null;
    }
  }

  const loadings = names.map((k, j) => ({
    factor: k,
    beta: reg.beta[j + 1],
    se: reg.se[j + 1], t: reg.t[j + 1], p: reg.p[j + 1],
    seHAC: reg.seHAC[j + 1], tHAC: reg.tHAC[j + 1], pHAC: reg.pHAC[j + 1],
    significant: reg.pHAC[j + 1] != null && reg.pHAC[j + 1] < 0.05,
    // annualised return contribution = β × mean factor return × 252
    contribution: reg.beta[j + 1] * S.mean(factors[k]) * TRADING_DAYS,
    vif: vif[k] ?? null,
    collinear: vif[k] != null && vif[k] > 5,
    // 95% confidence interval on the HAC standard error
    ci: reg.seHAC[j + 1] != null
      ? [reg.beta[j + 1] - 1.96 * reg.seHAC[j + 1], reg.beta[j + 1] + 1.96 * reg.seHAC[j + 1]]
      : null,
  }));

  const totalVar = S.variance(y);
  const residVar = S.variance(reg.resid);
  const systematic = totalVar ? 1 - residVar / totalVar : null;

  // Variance decomposition per factor: β_i · Cov(f_i, y) / Var(y).
  // Sums to R² up to the covariance among factors.
  const riskShare = names.map((k, j) => {
    const cov = S.covariance(factors[k], y);
    return { factor: k, share: totalVar && cov != null ? (reg.beta[j + 1] * cov) / totalVar : null };
  });

  const mk = opts.marketKey && factors[opts.marketKey] ? opts.marketKey : names[0];
  const mkt = factors[mk];

  // Rolling market beta — style drift is invisible in a full-sample number.
  const w = opts.rollWindow || 63;
  const rolling = [];
  if (n > w + 5) {
    for (let i = w; i < n; i += Math.max(1, Math.floor(n / 320))) {
      const yy = y.slice(i - w, i), xx = mkt.slice(i - w, i);
      const r = S.ols1(yy, xx);
      if (r) rolling.push({ i, beta: +r.beta.toFixed(4), alpha: +(r.alpha * TRADING_DAYS).toFixed(4), r2: +(r.r2 ?? 0).toFixed(3) });
    }
  }

  // Up/down capture and downside beta against the market factor.
  const up = [], dn = [], upM = [], dnM = [];
  for (let i = 0; i < n; i++) {
    if (mkt[i] > 0) { up.push(assetReturns[i]); upM.push(mkt[i]); }
    else if (mkt[i] < 0) { dn.push(assetReturns[i]); dnM.push(mkt[i]); }
  }
  const capture = (a, b) => {
    if (!a.length || !b.length) return null;
    const ma = S.mean(a), mb = S.mean(b);
    return mb ? ma / mb : null;
  };
  const downReg = dn.length > 30 ? S.ols1(dn.map((v) => v - rfDaily), dnM) : null;
  const upReg = up.length > 30 ? S.ols1(up.map((v) => v - rfDaily), upM) : null;

  const active = assetReturns.map((v, i) => v - mkt[i]);
  const te = S.stdev(active) * Math.sqrt(TRADING_DAYS);
  const ir = te ? (S.mean(active) * TRADING_DAYS) / te : null;

  const alphaDaily = reg.beta[0];
  return {
    n, factorNames: names, marketKey: mk,
    alpha: {
      daily: alphaDaily,
      annualised: alphaDaily * TRADING_DAYS,
      t: reg.t[0], p: reg.p[0], tHAC: reg.tHAC[0], pHAC: reg.pHAC[0], se: reg.se[0], seHAC: reg.seHAC[0],
      significant: reg.pHAC[0] != null && reg.pHAC[0] < 0.05,
    },
    loadings,
    fit: {
      r2: reg.r2, adjR2: reg.adjR2, f: reg.f, fp: reg.fp, dw: reg.dw, hacLags: reg.lags,
      residualVolAnn: S.stdev(reg.resid) * Math.sqrt(TRADING_DAYS),
      totalVolAnn: S.stdev(y) * Math.sqrt(TRADING_DAYS),
      systematicShare: systematic, specificShare: systematic == null ? null : 1 - systematic,
      maxVif: Object.values(vif).filter(isNum).length ? Math.max(...Object.values(vif).filter(isNum)) : null,
      residualAutocorr: S.autocorr(reg.resid, 1),
    },
    riskShare,
    rolling,
    betaStability: rolling.length > 2 ? {
      min: Math.min(...rolling.map((r) => r.beta)),
      max: Math.max(...rolling.map((r) => r.beta)),
      sd: S.stdev(rolling.map((r) => r.beta)),
      latest: rolling[rolling.length - 1].beta,
    } : null,
    capture: {
      upCapture: capture(up, upM), downCapture: capture(dn, dnM),
      upBeta: upReg ? upReg.beta : null, downBeta: downReg ? downReg.beta : null,
      upDays: up.length, downDays: dn.length,
    },
    active: { trackingError: te, informationRatio: ir },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   3 · PAIRS / COINTEGRATION
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Engle-Granger two-step cointegration analysis plus a z-score reversion
 * backtest on the resulting spread.
 *
 * Step 1: log P_a = α + β·log P_b + ε   (β is the hedge ratio)
 * Step 2: ADF on ε against ENGLE-GRANGER critical values, not Dickey-Fuller
 *         ones — the residual is fitted, so the standard table over-rejects.
 */
function pairsAnalysis({ dates, a, b, symA, symB }, opts = {}) {
  if (!a || !b || a.length < 120 || a.length !== b.length) {
    return { error: "Need at least 120 overlapping trading days for both legs." };
  }
  const window = clamp(Math.round(opts.window ?? 60), 20, 250);
  const entryZ = clamp(Number(opts.entryZ ?? 2), 0.5, 4);
  const exitZ = clamp(Number(opts.exitZ ?? 0.5), 0, 2);
  const stopZ = clamp(Number(opts.stopZ ?? 3.5), entryZ + 0.25, 6);
  const costBps = clamp(Number(opts.costBps ?? 10), 0, 200);

  const la = a.map((v) => Math.log(v)), lb = b.map((v) => Math.log(v));
  const reg = S.ols1(la, lb);
  if (!reg) return { error: "Regression failed on this pair." };
  const beta = reg.beta;
  const spread = la.map((v, i) => v - reg.alpha - beta * lb[i]);

  const eg = S.adfTest(spread, { table: "eg2_c" });
  const hl = S.halfLife(spread);
  /* hurst() expects a price series and differences it internally in log space.
     Exponentiating the spread makes log(x_t / x_{t−1}) collapse back to
     spread_t − spread_{t−1}, so this runs R/S on the spread's own increments —
     which is the quantity whose persistence we actually care about. */
  const hu = S.hurst(spread.map((v) => Math.exp(v)));
  const retA = S.simpleReturns(a), retB = S.simpleReturns(b);
  const corrLevels = S.correlation(la, lb);
  const corrReturns = S.correlation(retA, retB);

  // Rolling correlation — a pair whose correlation drifts is not a pair.
  const rollCorr = [];
  const rw = 63;
  for (let i = rw; i < retA.length; i += Math.max(1, Math.floor(retA.length / 300))) {
    const c = S.correlation(retA.slice(i - rw, i), retB.slice(i - rw, i));
    if (c != null) rollCorr.push({ d: dates[i + 1] || dates[i], c: +c.toFixed(3) });
  }

  // Rolling z-score of the spread
  const mu = smaSeries(spread, window);
  const sd = stdevSeries(spread, window);
  const z = spread.map((v, i) => (mu[i] != null && sd[i] ? (v - mu[i]) / sd[i] : null));

  // Position: +1 = long spread (long A, short β·B); −1 = short spread.
  const pos = new Array(spread.length).fill(0);
  let p = 0;
  for (let i = 0; i < spread.length; i++) {
    const zi = z[i];
    if (zi != null) {
      if (p === 0) {
        if (zi <= -entryZ) p = 1;
        else if (zi >= entryZ) p = -1;
      } else if (p === 1 && (zi >= -exitZ || zi < -stopZ)) p = 0;
      else if (p === -1 && (zi <= exitZ || zi > stopZ)) p = 0;
    }
    pos[i] = p;
  }

  // Spread return ≈ r_A − β·r_B, held from the next bar; cost on every change.
  const cost = costBps / 10000;
  const stratRets = [];
  const legTrades = [];
  let open = null;
  for (let i = 1; i < spread.length; i++) {
    const held = pos[i - 1];
    const raw = retA[i - 1] - beta * retB[i - 1];
    const traded = Math.abs(held - (pos[i - 2] ?? 0));
    stratRets.push(held * raw - traded * cost * (1 + Math.abs(beta)));
    if (held !== (pos[i - 2] ?? 0)) {
      if (open) {
        open.exitDate = dates[i]; open.exitZ = z[i]; open.bars = i - open.i;
        open.ret = open.cum;
        legTrades.push(open); open = null;
      }
      if (held !== 0) open = { i, side: held > 0 ? "LONG SPREAD" : "SHORT SPREAD", entryDate: dates[i], entryZ: z[i - 1], cum: 0 };
    }
    if (open) open.cum += held * raw;
  }
  if (open) { open.exitDate = dates[dates.length - 1]; open.exitZ = z[z.length - 1]; open.bars = spread.length - open.i; open.ret = open.cum; open.stillOpen = true; legTrades.push(open); }

  const years = spread.length / TRADING_DAYS;
  const perf = S.performance(stratRets, { years });
  const ts = tradeStats(legTrades.map((t) => ({ netReturn: t.ret, bars: t.bars, mfe: 0, mae: 0 })));

  const stride = Math.max(1, Math.floor(spread.length / 700));
  const series = [];
  for (let i = 0; i < spread.length; i += stride) {
    series.push({ d: dates[i], s: +spread[i].toFixed(5), z: z[i] == null ? null : +z[i].toFixed(3), p: pos[i] });
  }
  const eqStride = Math.max(1, Math.floor(perf.equity.length / 500));
  const equity = [];
  for (let i = 0; i < perf.equity.length; i += eqStride) equity.push({ d: dates[i + 1] || dates[i], e: +perf.equity[i].toFixed(4) });

  const zNow = z[z.length - 1];
  const tradeable = eg && eg.rejectAt != null && hl && hl.halfLife != null && hl.halfLife < window * 2;
  return {
    meta: { symA, symB, from: dates[0], to: dates[dates.length - 1], bars: spread.length, window, entryZ, exitZ, stopZ, costBps },
    hedge: {
      beta, alpha: reg.alpha, r2: reg.r2, tBeta: reg.tBeta,
      notional: `1 unit ${symA} vs ${beta.toFixed(3)} units ${symB} (log-price OLS)`,
    },
    cointegration: eg ? {
      stat: eg.stat, lag: eg.lag, crit: eg.crit, rejectAt: eg.rejectAt, nobs: eg.nobs,
      cointegrated: eg.rejectAt != null && eg.rejectAt <= 5,
      verdict: eg.rejectAt == null
        ? "No cointegration — the spread wanders. Any mean-reversion trade here is a bet on a relationship the data does not support."
        : `Cointegrated at the ${eg.rejectAt}% level — the spread is statistically anchored.`,
    } : null,
    meanReversion: {
      halfLifeDays: hl ? hl.halfLife : null,
      lambda: hl ? hl.lambda : null,
      tStat: hl ? hl.tStat : null,
      hurst: hu ? hu.h : null,
      hurstRegime: hu ? hu.regime : null,
    },
    correlation: { levels: corrLevels, returns: corrReturns, rolling: rollCorr,
      stability: rollCorr.length > 2 ? { min: Math.min(...rollCorr.map((r) => r.c)), max: Math.max(...rollCorr.map((r) => r.c)), sd: S.stdev(rollCorr.map((r) => r.c)) } : null },
    current: {
      z: zNow, spread: spread[spread.length - 1], position: pos[pos.length - 1],
      signal: zNow == null ? "—" : zNow <= -entryZ ? `LONG ${symA} / SHORT ${symB}`
        : zNow >= entryZ ? `SHORT ${symA} / LONG ${symB}`
        : Math.abs(zNow) <= exitZ ? "FLAT — spread at fair value" : "No signal — inside the band",
      priceA: a[a.length - 1], priceB: b[b.length - 1],
    },
    strategy: {
      totalReturn: perf.totalReturn, cagr: perf.cagr, vol: perf.vol, sharpe: perf.sharpe,
      sortino: perf.sortino, maxDD: perf.maxDD, tStat: perf.tStat, pValue: perf.pValue,
      trades: ts,
    },
    series, equity,
    tradeList: legTrades.slice(-40).reverse(),
    tradeable,
    caveat: "Spread returns assume both legs can be traded at the close with no borrow constraint on the short. Cointegration is a statistical property of the sample, not a promise about the future — relationships break when the business fundamentals diverge.",
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   4 · RETURN PROFILE — tail risk · drawdowns · seasonality · microstructure
   ══════════════════════════════════════════════════════════════════════════ */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Month-end closes → { ym, close } for monthly seasonality work. */
function monthEnds(points) {
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const d = new Date(points[i].t);
    const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const next = points[i + 1] ? new Date(points[i + 1].t) : null;
    const nextYm = next ? `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}` : null;
    if (!next || nextYm !== ym) out.push({ ym, year: d.getUTCFullYear(), month: d.getUTCMonth(), close: points[i].c });
  }
  return out;
}

/**
 * Everything a risk committee asks about a single name's return series that
 * the price chart cannot answer.
 */
function returnProfile(points, opts = {}) {
  const pts = (points || []).filter((p) => p && isNum(p.c));
  if (pts.length < 200) return { error: "Need at least 200 trading days for a return profile." };
  const closes = pts.map((p) => p.c);
  const dates = pts.map((p) => S.dayKey(p.t));
  const rets = S.simpleReturns(closes);
  const logs = S.logReturns(closes);
  const years = pts.length / TRADING_DAYS;

  const perf = S.performance(rets, { years, rf: opts.rf ?? 0 });

  /* ── tail risk ── */
  const var95 = S.valueAtRisk(rets, 0.95);
  const var99 = S.valueAtRisk(rets, 0.99);
  const jb = S.jarqueBera(rets);

  /* ── drawdown anatomy ── */
  const ddEpisodes = (perf.ddEpisodes || []).map((e) => ({
    depth: e.depth,
    peak: dates[e.peakIdx + 1] || dates[e.peakIdx],
    trough: dates[e.troughIdx + 1] || dates[e.troughIdx],
    recovery: e.recoveryIdx == null ? null : dates[e.recoveryIdx + 1] || dates[e.recoveryIdx],
    declineBars: e.declineBars, recoveryBars: e.recoveryBars, totalBars: e.totalBars,
    underwater: e.underwater,
  }));

  /* ── monthly seasonality matrix ── */
  const me = monthEnds(pts);
  const monthly = [];
  for (let i = 1; i < me.length; i++) {
    monthly.push({ year: me[i].year, month: me[i].month, ret: me[i - 1].close ? me[i].close / me[i - 1].close - 1 : null });
  }
  const yearsList = [...new Set(monthly.map((m) => m.year))].sort();
  const matrix = yearsList.map((y) => {
    const row = { year: y, months: new Array(12).fill(null), total: null };
    let comp = 1, any = false;
    for (const m of monthly) {
      if (m.year === y && m.ret != null) { row.months[m.month] = m.ret; comp *= 1 + m.ret; any = true; }
    }
    row.total = any ? comp - 1 : null;
    return row;
  });
  const monthStats = MONTHS.map((label, mi) => {
    const vals = monthly.filter((m) => m.month === mi && m.ret != null).map((m) => m.ret);
    if (vals.length < 2) return { month: label, n: vals.length, mean: null, median: null, hitRate: null, t: null, p: null };
    const m = S.mean(vals), sd = S.stdev(vals);
    const t = sd ? m / (sd / Math.sqrt(vals.length)) : null;
    return {
      month: label, n: vals.length, mean: m, median: S.quantile(vals, 0.5),
      best: Math.max(...vals), worst: Math.min(...vals),
      hitRate: vals.filter((v) => v > 0).length / vals.length,
      t, p: t == null ? null : S.tPvalue(t, vals.length - 1),
    };
  });

  /* ── day-of-week effect ── */
  const dowStats = [1, 2, 3, 4, 5].map((d) => {
    const vals = [];
    for (let i = 1; i < pts.length; i++) if (new Date(pts[i].t).getUTCDay() === d) vals.push(rets[i - 1]);
    if (vals.length < 10) return { day: DOW[d], n: vals.length, mean: null, hitRate: null, t: null };
    const m = S.mean(vals), sd = S.stdev(vals);
    const t = sd ? m / (sd / Math.sqrt(vals.length)) : null;
    return { day: DOW[d], n: vals.length, mean: m, hitRate: vals.filter((v) => v > 0).length / vals.length, t, p: t == null ? null : S.tPvalue(t, vals.length - 1) };
  });

  /* ── turn-of-month effect: last trading day + first three of the next ── */
  const tomFlags = pts.map((p, i) => {
    const d = new Date(p.t).getUTCDate();
    const prev = i > 0 ? new Date(pts[i - 1].t).getUTCMonth() : null;
    const cur = new Date(p.t).getUTCMonth();
    const isFirst3 = prev !== cur ? true : d <= 3;
    const next = pts[i + 1] ? new Date(pts[i + 1].t).getUTCMonth() : cur;
    const isLast = next !== cur;
    return isLast || isFirst3 || d <= 3;
  });
  const tomRets = [], restRets = [];
  for (let i = 1; i < pts.length; i++) (tomFlags[i] ? tomRets : restRets).push(rets[i - 1]);
  const tom = tomRets.length > 20 && restRets.length > 20 ? {
    windowMean: S.mean(tomRets), restMean: S.mean(restRets),
    windowDays: tomRets.length, restDays: restRets.length,
    windowAnnualised: S.mean(tomRets) * TRADING_DAYS, restAnnualised: S.mean(restRets) * TRADING_DAYS,
    edge: S.mean(tomRets) - S.mean(restRets),
  } : null;

  /* ── overnight vs intraday decomposition ──
     Gap = open ÷ prior close; session = close ÷ open. Splitting them shows
     whether the name's return is earned while the market is open or handed
     over in auctions — very different execution problems. */
  let gapRets = [], sessRets = [];
  if (pts.every((p) => isNum(p.o))) {
    for (let i = 1; i < pts.length; i++) {
      if (pts[i - 1].c > 0 && pts[i].o > 0) gapRets.push(pts[i].o / pts[i - 1].c - 1);
      if (pts[i].o > 0) sessRets.push(pts[i].c / pts[i].o - 1);
    }
  }
  let micro = null;
  if (gapRets.length > 50) {
    const g = S.mean(gapRets) * TRADING_DAYS;
    const s = S.mean(sessRets) * TRADING_DAYS;
    /* A "share of return" only means anything when both legs pull the same
       way. When one is negative the ratio explodes past 100% and reads as
       nonsense (16% overnight against −8% intraday is not "191% overnight"),
       so the split is reported as a pattern instead. */
    const sameSign = (g > 0 && s > 0) || (g < 0 && s < 0);
    micro = {
      overnightAnn: g, intradayAnn: s,
      overnightVol: S.stdev(gapRets) * Math.sqrt(TRADING_DAYS),
      intradayVol: S.stdev(sessRets) * Math.sqrt(TRADING_DAYS),
      overnightShare: sameSign && g + s !== 0 ? g / (g + s) : null,
      pattern: sameSign
        ? (g / (g + s) > 0.6 ? "overnight-dominated" : g / (g + s) < 0.3 ? "intraday-dominated" : "balanced")
        : g > 0 ? "overnight-only" : "intraday-only",
      gapCorr: S.correlation(gapRets, sessRets),
    };
  }

  /* ── volatility regime ── */
  const vol21 = [];
  for (let i = 21; i < rets.length; i++) vol21.push(S.stdev(rets.slice(i - 21, i)) * Math.sqrt(TRADING_DAYS));
  const curVol = vol21[vol21.length - 1] ?? null;
  const volPct = curVol != null && vol21.length > 60
    ? vol21.filter((v) => v <= curVol).length / vol21.length : null;
  // EWMA(λ=0.94) — RiskMetrics' one-day-ahead variance forecast
  let ewma = S.variance(rets.slice(0, 60)) ?? 0;
  for (let i = 60; i < rets.length; i++) ewma = 0.94 * ewma + 0.06 * rets[i] * rets[i];
  const ewmaVol = Math.sqrt(ewma * TRADING_DAYS);

  /* ── rolling risk series (down-sampled) ── */
  const rollWin = 252;
  const rolling = [];
  if (rets.length > rollWin + 5) {
    const stride = Math.max(1, Math.floor((rets.length - rollWin) / 400));
    for (let i = rollWin; i < rets.length; i += stride) {
      const w = rets.slice(i - rollWin, i);
      const sd = S.stdev(w), m = S.mean(w);
      rolling.push({
        d: dates[i + 1] || dates[i],
        vol: +(sd * Math.sqrt(TRADING_DAYS) * 100).toFixed(2),
        ret: +((Math.pow(1 + m, TRADING_DAYS) - 1) * 100).toFixed(2),
        sharpe: sd ? +((m / sd) * Math.sqrt(TRADING_DAYS)).toFixed(2) : null,
      });
    }
  }

  /* ── random-walk tests ── */
  const vrs = [2, 5, 10, 20].map((q) => S.varianceRatio(logs, q)).filter(Boolean);
  const lb = S.ljungBox(rets, 10);
  const hu = S.hurst(closes);

  /* ── return histogram vs the fitted normal ── */
  const lo = S.quantile(rets, 0.005), hi = S.quantile(rets, 0.995);
  const bins = 41;
  const wBin = (hi - lo) / bins;
  const hist = Array.from({ length: bins }, (_, i) => ({ x: lo + wBin * (i + 0.5), n: 0, normal: 0 }));
  for (const r of rets) {
    const idx = clamp(Math.floor((r - lo) / wBin), 0, bins - 1);
    hist[idx].n++;
  }
  const mu = S.mean(rets), sg = S.stdev(rets);
  for (const b of hist) b.normal = rets.length * wBin * S.normPdf((b.x - mu) / sg) / sg;

  return {
    meta: {
      from: dates[0], to: dates[dates.length - 1], bars: pts.length, years: +years.toFixed(2),
      lastClose: closes[closes.length - 1],
    },
    performance: {
      totalReturn: perf.totalReturn, cagr: perf.cagr, vol: perf.vol, sharpe: perf.sharpe,
      sortino: perf.sortino, calmar: perf.calmar, maxDD: perf.maxDD, currentDD: perf.currentDD,
      downsideDev: perf.downsideDev, winRateDaily: perf.winRateDaily,
      bestDay: perf.bestDay, worstDay: perf.worstDay, longestDDBars: perf.longestDDBars,
    },
    distribution: {
      meanDaily: mu, sdDaily: sg, skew: perf.skew, excessKurtosis: perf.excessKurtosis,
      jarqueBera: jb, histogram: hist,
      p1: S.quantile(rets, 0.01), p5: S.quantile(rets, 0.05),
      p95: S.quantile(rets, 0.95), p99: S.quantile(rets, 0.99),
    },
    tailRisk: { var95, var99 },
    drawdowns: ddEpisodes,
    seasonality: { matrix, months: monthStats, dayOfWeek: dowStats, turnOfMonth: tom, yearsCovered: yearsList.length },
    microstructure: micro,
    volatility: {
      current21d: curVol, percentile: volPct, ewmaForecast: ewmaVol,
      min: vol21.length ? Math.min(...vol21) : null, max: vol21.length ? Math.max(...vol21) : null,
      median: vol21.length ? S.quantile(vol21, 0.5) : null,
      regime: volPct == null ? "—" : volPct > 0.8 ? "Elevated — top quintile of its own year"
        : volPct < 0.2 ? "Compressed — bottom quintile of its own year" : "Normal",
    },
    efficiency: {
      varianceRatios: vrs, ljungBox: lb,
      hurst: hu ? { h: hu.h, regime: hu.regime, r2: hu.r2 } : null,
      autocorr1: S.autocorr(rets, 1), autocorr5: S.autocorr(rets, 5),
    },
    rolling,
  };
}

module.exports = {
  // engines
  backtest, compareStrategies, factorAttribution, pairsAnalysis, returnProfile,
  // catalogue + helpers reused by the routes
  STRATEGIES, strategyCatalogue, resolveParams, buildCtx, simulate, tradeStats,
  parameterSurface, walkForward, bootstrap,
  // indicator series (exported for tests and future modules)
  smaSeries, emaSeries, stdevSeries, rsiSeries, macdSeries, atrSeries, adxSeries, donchianSeries,
  TRADING_DAYS,
};
