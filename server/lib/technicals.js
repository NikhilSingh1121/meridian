/**
 * MERIDIAN — Technical indicators library.
 *
 * Pure-math computations over OHLCV time-series (oldest → newest).
 * Every indicator is computed locally from Yahoo daily candles. No hardcoded
 * values, no third-party services. Used by the Portfolio Technical Screener.
 *
 * Convention: every function returns `null` when input is too short to be
 * meaningful, so the renderer can fall back to "—" badges without throwing.
 */

/* ── Moving averages ─────────────────────────────────────────────────────── */

/** Final EMA value over the whole series. */
function ema(values, period) {
  if (!values || values.length < period) return null;
  const k = 2 / (period + 1);
  let e = 0;
  for (let i = 0; i < period; i++) e += values[i];
  e /= period;
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

/** Full EMA series (leading values up to period-1 are null). */
function emaSeries(values, period) {
  const out = new Array(values.length).fill(null);
  if (!values || values.length < period) return out;
  const k = 2 / (period + 1);
  let e = 0;
  for (let i = 0; i < period; i++) e += values[i];
  e /= period;
  out[period - 1] = e;
  for (let i = period; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}

/** Final SMA value (last `period` values). */
function sma(values, period) {
  if (!values || values.length < period) return null;
  let s = 0;
  for (let i = values.length - period; i < values.length; i++) s += values[i];
  return s / period;
}

/* ── Momentum ────────────────────────────────────────────────────────────── */

/** RSI — Wilder smoothing. Returns 0..100 or null. */
function rsi(closes, period = 14) {
  if (!closes || closes.length < period + 1) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) g += d; else l -= d;
  }
  let ag = g / period, al = l / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const gg = d > 0 ? d : 0, ll = d < 0 ? -d : 0;
    ag = (ag * (period - 1) + gg) / period;
    al = (al * (period - 1) + ll) / period;
  }
  if (al === 0) return 100;
  const rs = ag / al;
  return 100 - 100 / (1 + rs);
}

/** MACD(12,26,9) — returns {macd, signal, hist} or null. */
function macd(closes) {
  if (!closes || closes.length < 35) return null;
  const e12 = emaSeries(closes, 12);
  const e26 = emaSeries(closes, 26);
  const macdLine = closes.map((_, i) => (e12[i] != null && e26[i] != null ? e12[i] - e26[i] : null));
  const validMacd = macdLine.filter((v) => v != null);
  if (validMacd.length < 9) return null;
  // build a 9-EMA of the macd line (only valid section), pick the last value
  const sigSeries = emaSeries(validMacd, 9);
  const sig = sigSeries[sigSeries.length - 1];
  const m = macdLine[macdLine.length - 1];
  if (m == null || sig == null) return null;
  return { macd: m, signal: sig, hist: m - sig };
}

/** ADX(14) — Wilder. Returns a value typically 0..100 or null. */
function adx(highs, lows, closes, period = 14) {
  if (!highs || highs.length < period * 2 + 2) return null;
  const n = highs.length;
  const tr = [], pdm = [], ndm = [];
  for (let i = 1; i < n; i++) {
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
    const up = highs[i] - highs[i - 1];
    const dn = lows[i - 1] - lows[i];
    pdm.push(up > dn && up > 0 ? up : 0);
    ndm.push(dn > up && dn > 0 ? dn : 0);
  }
  // Wilder smoothing
  const wilder = (arr) => {
    if (arr.length < period) return null;
    let sum = 0;
    for (let i = 0; i < period; i++) sum += arr[i];
    const out = [sum];
    for (let i = period; i < arr.length; i++) {
      sum = sum - sum / period + arr[i];
      out.push(sum);
    }
    return out;
  };
  const trS = wilder(tr), pdmS = wilder(pdm), ndmS = wilder(ndm);
  if (!trS || !pdmS || !ndmS) return null;
  const dx = trS.map((t, i) => {
    if (!t) return 0;
    const piDI = (pdmS[i] / t) * 100;
    const niDI = (ndmS[i] / t) * 100;
    const denom = piDI + niDI;
    return denom ? (Math.abs(piDI - niDI) / denom) * 100 : 0;
  });
  if (dx.length < period) return null;
  let adxV = 0;
  for (let i = 0; i < period; i++) adxV += dx[i];
  adxV /= period;
  for (let i = period; i < dx.length; i++) adxV = (adxV * (period - 1) + dx[i]) / period;
  return adxV;
}

/** Rate of change over `period` bars (percent). */
function roc(closes, period = 12) {
  if (!closes || closes.length < period + 1) return null;
  const p = closes[closes.length - 1 - period];
  return p ? ((closes[closes.length - 1] - p) / p) * 100 : null;
}

/** Simple momentum: ratio of latest close to N bars ago * 100. */
function momentum(closes, period = 10) {
  if (!closes || closes.length < period + 1) return null;
  const p = closes[closes.length - 1 - period];
  return p ? (closes[closes.length - 1] / p) * 100 : null;
}

/* ── Oscillators ─────────────────────────────────────────────────────────── */

/** Stochastic %K and %D (14, 3). */
function stochastic(highs, lows, closes, kPer = 14, dPer = 3) {
  if (!closes || closes.length < kPer + dPer) return null;
  const ks = [];
  for (let i = kPer - 1; i < closes.length; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - kPer + 1; j <= i; j++) {
      if (highs[j] > hh) hh = highs[j];
      if (lows[j] < ll) ll = lows[j];
    }
    const denom = hh - ll;
    ks.push(denom > 0 ? ((closes[i] - ll) / denom) * 100 : 50);
  }
  const k = ks[ks.length - 1];
  const tail = ks.slice(-dPer);
  const d = tail.reduce((s, v) => s + v, 0) / tail.length;
  return { k, d };
}

/** Williams %R (14). Returns -100..0. */
function williamsR(highs, lows, closes, period = 14) {
  if (!closes || closes.length < period) return null;
  let hh = -Infinity, ll = Infinity;
  for (let i = closes.length - period; i < closes.length; i++) {
    if (highs[i] > hh) hh = highs[i];
    if (lows[i] < ll) ll = lows[i];
  }
  const px = closes[closes.length - 1];
  const denom = hh - ll;
  return denom > 0 ? ((hh - px) / denom) * -100 : 0;
}

/** Commodity Channel Index (20). */
function cci(highs, lows, closes, period = 20) {
  if (!closes || closes.length < period) return null;
  const tps = [];
  for (let i = closes.length - period; i < closes.length; i++) {
    tps.push((highs[i] + lows[i] + closes[i]) / 3);
  }
  const ma = tps.reduce((s, v) => s + v, 0) / period;
  const md = tps.reduce((s, v) => s + Math.abs(v - ma), 0) / period;
  const last = (highs[highs.length - 1] + lows[lows.length - 1] + closes[closes.length - 1]) / 3;
  return md === 0 ? 0 : (last - ma) / (0.015 * md);
}

/** Money Flow Index (14). Volume-weighted RSI on typical price. 0..100. */
function mfi(highs, lows, closes, volumes, period = 14) {
  if (!closes || closes.length < period + 1) return null;
  let pos = 0, neg = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    const ptp = (highs[i - 1] + lows[i - 1] + closes[i - 1]) / 3;
    const mf = tp * (volumes[i] || 0);
    if (tp > ptp) pos += mf;
    else if (tp < ptp) neg += mf;
  }
  if (neg === 0) return 100;
  return 100 - 100 / (1 + pos / neg);
}

/* ── Volume ──────────────────────────────────────────────────────────────── */

/** Cumulative OBV value over the whole series. */
function obv(closes, volumes) {
  if (!closes || closes.length < 2) return null;
  let v = 0;
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) v += (volumes[i] || 0);
    else if (closes[i] < closes[i - 1]) v -= (volumes[i] || 0);
  }
  return v;
}

/** Sign of OBV slope over the last 20 bars: +1 rising, 0 flat, -1 falling. */
function obvSlope(closes, volumes, lookback = 20) {
  if (!closes || closes.length < lookback + 2) return 0;
  let v = 0;
  const series = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) v += (volumes[i] || 0);
    else if (closes[i] < closes[i - 1]) v -= (volumes[i] || 0);
    series.push(v);
  }
  const tail = series.slice(-lookback);
  return Math.sign(tail[tail.length - 1] - tail[0]);
}

/** Rolling VWAP over the last `days` bars (typical-price weighted by volume). */
function vwap(highs, lows, closes, volumes, days = 20) {
  if (!closes || !closes.length) return null;
  const n = Math.min(days, closes.length);
  let tpv = 0, vol = 0;
  for (let i = closes.length - n; i < closes.length; i++) {
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    tpv += tp * (volumes[i] || 0);
    vol += (volumes[i] || 0);
  }
  return vol > 0 ? tpv / vol : null;
}

/** Chaikin Money Flow (20). Returns roughly -1..+1. */
function cmf(highs, lows, closes, volumes, period = 20) {
  if (!closes || closes.length < period) return null;
  let mfv = 0, vol = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const range = highs[i] - lows[i];
    const m = range > 0 ? (((closes[i] - lows[i]) - (highs[i] - closes[i])) / range) : 0;
    mfv += m * (volumes[i] || 0);
    vol += (volumes[i] || 0);
  }
  return vol > 0 ? mfv / vol : null;
}

/* ── Volatility ──────────────────────────────────────────────────────────── */

/** ATR(14) — Wilder true range. */
function atr(highs, lows, closes, period = 14) {
  if (!closes || closes.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < closes.length; i++) {
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  // Wilder smoothing: seed = SMA of first `period`, then a*(p-1)+t / p
  let a = 0;
  for (let i = 0; i < period; i++) a += trs[i];
  a /= period;
  for (let i = period; i < trs.length; i++) a = (a * (period - 1) + trs[i]) / period;
  return a;
}

/**
 * Bollinger Bands (20, 2σ). Returns:
 *   - upper, middle, lower
 *   - pos: 0..1 — where current price sits (0 = lower band, 1 = upper)
 *   - squeeze: true if normalized width (sd/mean) is small (volatility compressed)
 */
function bollinger(closes, period = 20, k = 2) {
  if (!closes || closes.length < period) return null;
  const last = closes.slice(-period);
  const mean = last.reduce((s, v) => s + v, 0) / period;
  const variance = last.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  const upper = mean + k * sd, lower = mean - k * sd;
  const px = closes[closes.length - 1];
  const width = upper - lower;
  return {
    middle: mean, upper, lower, sd,
    pos: width > 0 ? (px - lower) / width : 0.5,
    squeeze: mean > 0 ? sd / mean < 0.025 : false,
  };
}

/** Donchian breakout: did price break above/below the prior N-period range? */
function donchian(highs, lows, closes, period = 20) {
  if (!closes || closes.length < period + 2) return null;
  // Prior range = N bars EXCLUDING the current one
  let ph = -Infinity, pl = Infinity;
  for (let i = closes.length - period - 1; i < closes.length - 1; i++) {
    if (highs[i] > ph) ph = highs[i];
    if (lows[i] < pl) pl = lows[i];
  }
  const px = closes[closes.length - 1];
  return { upper: ph, lower: pl, breakoutUp: px > ph, breakoutDown: px < pl };
}

/* ── Price action ────────────────────────────────────────────────────────── */

/** Pivot-style support / resistance from last `period` bars. */
function supportResistance(highs, lows, period = 30) {
  if (!highs || highs.length < period) return null;
  let s = Infinity, r = -Infinity;
  for (let i = highs.length - period; i < highs.length; i++) {
    if (highs[i] > r) r = highs[i];
    if (lows[i] < s) s = lows[i];
  }
  return { support: s, resistance: r };
}

/* ── Aggregation: full technical pack from candles ───────────────────────── */

/**
 * Vote-based trend label from the price-EMA stack.
 * Returns one of: Strong Bullish · Bullish · Neutral · Bearish · Strong Bearish.
 */
function classifyTrend(price, e20, e50, e200) {
  let v = 0;
  if (e20 != null && price > e20) v++;
  if (e50 != null && price > e50) v++;
  if (e200 != null && price > e200) v++;
  if (e20 != null && e50 != null && e20 > e50) v++;
  if (e50 != null && e200 != null && e50 > e200) v++;
  if (v === 5) return "Strong Bullish";
  if (v === 4) return "Bullish";
  if (v === 3) return "Neutral";
  if (v === 1 || v === 2) return "Bearish";
  return "Strong Bearish";
}

/**
 * Composite technical score (0..100). Weights:
 *   Trend 25% · Momentum 20% · Oscillators 15% · Volume 20% · Volatility 10% · Price Action 10%
 *
 * Sub-scores are clamped to their cap so a single noisy input can never
 * blow up the composite — this is what makes scores comparable across names.
 */
function computeScore(d) {
  let total = 0;

  // Trend (max 25)
  let t = 0;
  if (d.ema20 != null && d.price > d.ema20) t += 4;
  if (d.ema50 != null && d.price > d.ema50) t += 5;
  if (d.ema200 != null && d.price > d.ema200) t += 8;
  if (d.goldenCross) t += 5;
  if (d.ema20 != null && d.ema50 != null && d.ema20 > d.ema50) t += 3;
  total += Math.min(t, 25);

  // Momentum (max 20)
  let m = 0;
  if (d.rsi != null) {
    if (d.rsi >= 50 && d.rsi <= 70) m += 7;
    else if (d.rsi > 70 && d.rsi < 80) m += 4;
    else if (d.rsi >= 40 && d.rsi < 50) m += 3;
    else if (d.rsi < 30) m += 1;
  }
  if (d.macdBullish) m += 6;
  if (d.adx != null && d.adx > 25) m += 4;
  if (d.roc != null && d.roc > 0) m += 3;
  total += Math.min(m, 20);

  // Oscillators (max 15)
  let o = 0;
  if (d.stochK != null && d.stochD != null && d.stochK > d.stochD && d.stochK < 80) o += 4;
  if (d.mfi != null && d.mfi > 50 && d.mfi < 80) o += 4;
  if (d.willR != null && d.willR > -80 && d.willR < -20) o += 3;
  if (d.cci != null && d.cci > 0 && d.cci < 200) o += 4;
  total += Math.min(o, 15);

  // Volume (max 20)
  let v = 0;
  if (d.volumeSpike != null) {
    if (d.volumeSpike > 1.5) v += 7;
    else if (d.volumeSpike > 1.0) v += 5;
    else if (d.volumeSpike > 0.7) v += 2;
  }
  if (d.obvSlope > 0) v += 7;
  else if (d.obvSlope === 0) v += 3;
  if (d.cmf != null) {
    if (d.cmf > 0.05) v += 6;
    else if (d.cmf > 0) v += 3;
  }
  total += Math.min(v, 20);

  // Volatility (max 10)
  let vol = 0;
  if (d.bbPos != null && d.bbPos > 0.5 && d.bbPos < 0.95) vol += 5;
  if (d.donchianBreakoutUp) vol += 5;
  total += Math.min(vol, 10);

  // Price action (max 10)
  let pa = 0;
  if (d.distHigh52 != null) {
    if (d.distHigh52 >= -3) pa += 6;
    else if (d.distHigh52 >= -10) pa += 4;
    else if (d.distHigh52 >= -20) pa += 2;
  }
  if (d.distLow52 != null) {
    if (d.distLow52 > 30) pa += 4;
    else if (d.distLow52 > 10) pa += 2;
  }
  total += Math.min(pa, 10);

  return Math.round(Math.max(0, Math.min(100, total)));
}

/** Maps a 0..100 score to its signal band. */
function classifySignal(score) {
  if (score == null || !Number.isFinite(score)) return "—";
  if (score >= 90) return "Strong Buy";
  if (score >= 80) return "Buy";
  if (score >= 70) return "Accumulate";
  if (score >= 60) return "Watch";
  if (score >= 40) return "Hold";
  return "Avoid";
}

/**
 * Compute the full per-company technical pack from a Yahoo history result.
 * `history` shape: { points: [{t, o, h, l, c, v}, ...], currency }
 * `meta` (optional): { symbol, name, sector, currency }
 */
function computeTechnicals(history, meta = {}) {
  const pts = (history?.points || []).filter((p) => p && p.c != null);
  if (pts.length < 50) {
    return { symbol: meta.symbol, name: meta.name, sector: meta.sector, currency: history?.currency || meta.currency || "", error: "Insufficient history" };
  }

  const closes = pts.map((p) => p.c);
  const highs = pts.map((p) => (p.h != null ? p.h : p.c));
  const lows = pts.map((p) => (p.l != null ? p.l : p.c));
  const volumes = pts.map((p) => p.v || 0);

  const price = closes[closes.length - 1];
  const prevClose = closes[closes.length - 2];
  const change = prevClose != null ? price - prevClose : null;
  const changePct = prevClose ? (change / prevClose) * 100 : null;

  // Trend
  const ema20v = ema(closes, 20);
  const ema50v = ema(closes, 50);
  const ema100v = ema(closes, 100);
  const ema200v = ema(closes, 200);
  const sma50v = sma(closes, 50);
  const sma200v = sma(closes, 200);
  const goldenCross = sma50v != null && sma200v != null && sma50v > sma200v;
  const deathCross = sma50v != null && sma200v != null && sma50v < sma200v;
  const direction = classifyTrend(price, ema20v, ema50v, ema200v);

  // Momentum
  const rsiV = rsi(closes, 14);
  const macdV = macd(closes);
  const macdBullish = macdV != null && macdV.macd > macdV.signal;
  const adxV = adx(highs, lows, closes, 14);
  const rocV = roc(closes, 12);
  const momV = momentum(closes, 10);

  // Oscillators
  const stoch = stochastic(highs, lows, closes, 14, 3);
  const willR = williamsR(highs, lows, closes, 14);
  const cciV = cci(highs, lows, closes, 20);
  const mfiV = mfi(highs, lows, closes, volumes, 14);

  // Volume
  const curVol = volumes[volumes.length - 1] || 0;
  const avgWindow = Math.min(30, volumes.length);
  const avgVol = volumes.slice(-avgWindow).reduce((s, v) => s + v, 0) / avgWindow;
  const obvV = obv(closes, volumes);
  const obvSlopeV = obvSlope(closes, volumes, 20);
  const vwapV = vwap(highs, lows, closes, volumes, 20);
  const cmfV = cmf(highs, lows, closes, volumes, 20);
  const volumeSpike = avgVol > 0 ? curVol / avgVol : null;

  // Volatility
  const atrV = atr(highs, lows, closes, 14);
  const bb = bollinger(closes, 20, 2);
  const donch = donchian(highs, lows, closes, 20);

  // Price action
  const sr = supportResistance(highs, lows, 30);
  const window52 = Math.min(252, closes.length);
  const high52 = Math.max(...highs.slice(-window52));
  const low52 = Math.min(...lows.slice(-window52));
  const distHigh52 = high52 > 0 ? ((price - high52) / high52) * 100 : null;
  const distLow52 = low52 > 0 ? ((price - low52) / low52) * 100 : null;

  const flat = {
    price, ema20: ema20v, ema50: ema50v, ema200: ema200v, goldenCross,
    rsi: rsiV, macdBullish, adx: adxV, roc: rocV,
    stochK: stoch?.k, stochD: stoch?.d, willR, cci: cciV, mfi: mfiV,
    volumeSpike, obvSlope: obvSlopeV, cmf: cmfV,
    bbPos: bb?.pos, donchianBreakoutUp: donch?.breakoutUp,
    distHigh52, distLow52,
  };
  const score = computeScore(flat);
  const signal = classifySignal(score);

  return {
    symbol: meta.symbol || history.symbol,
    name: meta.name || history.symbol,
    sector: meta.sector || "—",
    currency: history.currency || meta.currency || "",
    price, prevClose, change, changePct,

    trend: {
      direction,
      ema20: ema20v, ema50: ema50v, ema100: ema100v, ema200: ema200v,
      sma50: sma50v, sma200: sma200v,
      goldenCross, deathCross,
      aboveEma200: ema200v != null && price > ema200v,
    },
    momentum: {
      rsi: rsiV,
      macd: macdV?.macd ?? null, macdSignal: macdV?.signal ?? null, macdHist: macdV?.hist ?? null,
      macdBullish,
      adx: adxV, roc: rocV, mom: momV,
    },
    oscillators: { stochK: stoch?.k ?? null, stochD: stoch?.d ?? null, willR, cci: cciV, mfi: mfiV },
    volume: {
      current: curVol, avg30: avgVol, spike: volumeSpike,
      obv: obvV, obvSlope: obvSlopeV, vwap: vwapV, cmf: cmfV,
    },
    volatility: {
      atr: atrV,
      bbUpper: bb?.upper ?? null, bbLower: bb?.lower ?? null, bbMiddle: bb?.middle ?? null,
      bbPos: bb?.pos ?? null, bbSqueeze: !!bb?.squeeze,
      donchianUpper: donch?.upper ?? null, donchianLower: donch?.lower ?? null,
      breakoutUp: !!donch?.breakoutUp, breakoutDown: !!donch?.breakoutDown,
    },
    priceAction: {
      support: sr?.support ?? null, resistance: sr?.resistance ?? null,
      high52, low52, distHigh52, distLow52,
      aboveResistance: sr ? price > sr.resistance : false,
      belowSupport: sr ? price < sr.support : false,
    },
    score, signal,
    spark: closes.slice(-60),
  };
}

module.exports = {
  // surfaces (for future re-use)
  ema, emaSeries, sma, rsi, macd, adx, roc, momentum,
  stochastic, williamsR, cci, mfi,
  obv, obvSlope, vwap, cmf,
  atr, bollinger, donchian, supportResistance,
  // aggregate
  computeTechnicals, computeScore, classifySignal, classifyTrend,
};
