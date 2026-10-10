/**
 * M-TERMINAL — Index quant engine (pure functions, no I/O).
 *
 * Everything the Index Analyser shows is computed here from bars:
 *   levels()     classic / Camarilla / Fibonacci pivots, swing levels, range projections
 *   technicals() RSI, MACD, ADX/DI, ATR, Bollinger width, Supertrend, EMA stack, TWAP
 *   setup()      market-setup classification with a bias score and the reasons behind it
 *   forecast()   five forecasting models + a skill-weighted ensemble, as quantile paths
 *   touchProb()  probability of touching a level before the close (drifted Brownian barrier)
 *   evaluate()   walk-forward reliability of every model on past sessions (band coverage, hit rate)
 *
 * Bars are { t (ms UTC), o, h, l, c }. Intraday maths uses log returns. Indices carry
 * no volume on the free feed, so the session average is time-weighted (TWAP).
 */

const IST = 5.5 * 3600e3, OPEN_MIN = 9 * 60 + 15, CLOSE_MIN = 15 * 60 + 30;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const minuteOfDay = (t) => { const d = new Date(t + IST); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const dayKey = (t) => new Date(t + IST).toISOString().slice(0, 10);
const r2 = (v) => (isNum(v) ? Math.round(v * 100) / 100 : null);
const r4 = (v) => (isNum(v) ? Math.round(v * 10000) / 10000 : null);

/* ── distributions ── */
function erf(x) { const s = Math.sign(x), a = Math.abs(x), t = 1 / (1 + 0.3275911 * a); return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a)); }
const Phi = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
function invPhi(p) {   // Acklam
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  if (p <= 0) return -Infinity; if (p >= 1) return Infinity;
  if (p < 0.02425) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - 0.02425) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
const QS = [0.1, 0.25, 0.5, 0.75, 0.9];
const Z = QS.map(invPhi);
function wQuantile(vals, ws, q) {   // weighted empirical quantile
  const idx = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]);
  const tot = ws.reduce((a, b) => a + b, 0); let acc = 0;
  for (const i of idx) { acc += ws[i]; if (acc >= q * tot) return vals[i]; }
  return vals[idx[idx.length - 1]];
}

/* ── series helpers ── */
function ema(v, p) { const k = 2 / (p + 1), out = []; let e = null; for (const x of v) { e = e == null ? x : x * k + e * (1 - k); out.push(e); } return out; }
function sma(v, p) { const out = []; let s = 0; for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= p) s -= v[i - p]; out.push(i >= p - 1 ? s / p : null); } return out; }
function rsi(c, p = 14) {
  let g = 0, l = 0; const out = new Array(c.length).fill(null);
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= p) { g += up / p; l += dn / p; if (i === p) out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); continue; }
    g = (g * (p - 1) + up) / p; l = (l * (p - 1) + dn) / p; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}
function trueRange(b) { return b.map((x, i) => (i ? Math.max(x.h - x.l, Math.abs(x.h - b[i - 1].c), Math.abs(x.l - b[i - 1].c)) : x.h - x.l)); }
function atr(b, p = 14) { const tr = trueRange(b); const out = []; let a = null; tr.forEach((x, i) => { a = i < p ? (a == null ? x : (a * i + x) / (i + 1)) : (a * (p - 1) + x) / p; out.push(a); }); return out; }
function adx(b, p = 14) {
  const n = b.length; if (n < p * 2) return { adx: null, pdi: null, mdi: null };
  let trS = 0, pS = 0, mS = 0, dxs = [], A = null;
  for (let i = 1; i < n; i++) {
    const up = b[i].h - b[i - 1].h, dn = b[i - 1].l - b[i].l;
    const pdm = up > dn && up > 0 ? up : 0, mdm = dn > up && dn > 0 ? dn : 0;
    const tr = Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c));
    if (i <= p) { trS += tr; pS += pdm; mS += mdm; } else { trS = trS - trS / p + tr; pS = pS - pS / p + pdm; mS = mS - mS / p + mdm; }
    if (i >= p) {
      const pdi = trS ? (100 * pS) / trS : 0, mdi = trS ? (100 * mS) / trS : 0, dx = pdi + mdi ? (100 * Math.abs(pdi - mdi)) / (pdi + mdi) : 0;
      dxs.push(dx); if (dxs.length === p) A = dxs.reduce((x, y) => x + y, 0) / p; else if (dxs.length > p) A = (A * (p - 1) + dx) / p;
      if (i === n - 1) return { adx: A, pdi, mdi };
    }
  }
  return { adx: null, pdi: null, mdi: null };
}
function supertrend(b, p = 10, m = 3) {
  const a = atr(b, p); let dir = 1, up = null, dn = null;
  for (let i = 0; i < b.length; i++) {
    const hl2 = (b[i].h + b[i].l) / 2, bu = hl2 + m * a[i], bl = hl2 - m * a[i];
    const pc = i ? b[i - 1].c : b[i].c;
    up = up == null || bu < up || pc > up ? bu : up;
    dn = dn == null || bl > dn || pc < dn ? bl : dn;
    if (dir === 1 && b[i].c < dn) dir = -1; else if (dir === -1 && b[i].c > up) dir = 1;
  }
  return { dir, line: dir === 1 ? dn : up };
}
/** n-minute bars from 1-minute bars, aligned to the 09:15 session open */
function resample(b1, n) {
  if (n <= 1) return b1.slice();
  const out = [];
  for (const x of b1) {
    const m = minuteOfDay(x.t), k = dayKey(x.t) + ":" + Math.floor((m - OPEN_MIN) / n);
    const last = out[out.length - 1];
    if (last && last._k === k) { last.h = Math.max(last.h, x.h); last.l = Math.min(last.l, x.l); last.c = x.c; }
    else out.push({ _k: k, t: x.t, o: x.o, h: x.h, l: x.l, c: x.c });
  }
  return out.map(({ _k, ...r }) => r);
}
const sessionOf = (bars, day) => bars.filter((x) => dayKey(x.t) === day);
function twap(session) { if (!session.length) return null; let s = 0; for (const x of session) s += (x.h + x.l + x.c) / 3; return s / session.length; }

/* ══ LEVELS ══════════════════════════════════════════════════════════════ */
function pivotSet(H, L, C) {
  const P = (H + L + C) / 3, R = H - L;
  return {
    classic: { P, R1: 2 * P - L, R2: P + R, R3: H + 2 * (P - L), S1: 2 * P - H, S2: P - R, S3: L - 2 * (H - P) },
    camarilla: { H4: C + R * 1.1 / 2, H3: C + R * 1.1 / 4, L3: C - R * 1.1 / 4, L4: C - R * 1.1 / 2 },
    fibonacci: { R1: P + 0.382 * R, R2: P + 0.618 * R, R3: P + R, S1: P - 0.382 * R, S2: P - 0.618 * R, S3: P - R },
  };
}
/** swing highs / lows (5-bar fractals) clustered within `tol` of each other */
function swingLevels(b, tol = 0.0015) {
  const pts = [];
  for (let i = 2; i < b.length - 2; i++) {
    if (b[i].h >= Math.max(b[i - 1].h, b[i - 2].h, b[i + 1].h, b[i + 2].h)) pts.push({ p: b[i].h, kind: "swing high", t: b[i].t });
    if (b[i].l <= Math.min(b[i - 1].l, b[i - 2].l, b[i + 1].l, b[i + 2].l)) pts.push({ p: b[i].l, kind: "swing low", t: b[i].t });
  }
  const cl = [];
  for (const x of pts.sort((a, b2) => a.p - b2.p)) {
    const c = cl[cl.length - 1];
    if (c && Math.abs(x.p / c.p - 1) < tol) { c.n++; c.p = (c.p * (c.n - 1) + x.p) / c.n; c.t = Math.max(c.t, x.t); }
    else cl.push({ p: x.p, n: 1, kind: x.kind, t: x.t });
  }
  return cl.filter((c) => c.n >= 2).sort((a, b2) => b2.n - a.n);
}
/**
 * @param o { last, prevDay {h,l,c}, prevWeek {h,l,c}, today {o,h,l} | null, orb {h,l} | null, adr, bars5 }
 * @returns sorted list [{ key, label, price, group, kind: "resistance"|"support" }]
 */
function levels(o) {
  const out = [], add = (key, label, price, group) => { if (isNum(price)) out.push({ key, label, price: r2(price), group }); };
  if (o.prevDay) {
    const pv = pivotSet(o.prevDay.h, o.prevDay.l, o.prevDay.c);
    for (const [k, v] of Object.entries(pv.classic)) add(k, k === "P" ? "Pivot" : k, v, "pivot");
    for (const [k, v] of Object.entries(pv.camarilla)) add("cam" + k, "Camarilla " + k, v, "camarilla");
    for (const [k, v] of Object.entries(pv.fibonacci)) add("fib" + k, "Fib " + k, v, "fibonacci");
    add("PDH", "Prev day high", o.prevDay.h, "session"); add("PDL", "Prev day low", o.prevDay.l, "session"); add("PDC", "Prev close", o.prevDay.c, "session");
  }
  if (o.prevWeek) { const w = pivotSet(o.prevWeek.h, o.prevWeek.l, o.prevWeek.c).classic; add("WP", "Weekly pivot", w.P, "weekly"); add("WR1", "Weekly R1", w.R1, "weekly"); add("WS1", "Weekly S1", w.S1, "weekly"); }
  if (o.today) { add("DH", "Day high", o.today.h, "session"); add("DL", "Day low", o.today.l, "session"); add("DO", "Day open", o.today.o, "session"); }
  if (o.orb) {
    const w = o.orb.h - o.orb.l;
    add("ORH", "Opening-range high", o.orb.h, "orb"); add("ORL", "Opening-range low", o.orb.l, "orb");
    add("ORT1", "ORB target ↑ (1× range)", o.orb.h + w, "projection"); add("ORT2", "ORB target ↓ (1× range)", o.orb.l - w, "projection");
  }
  if (o.today && isNum(o.adr)) { add("ADRU", "ADR projection ↑ (day low + avg range)", o.today.l + o.adr, "projection"); add("ADRD", "ADR projection ↓ (day high − avg range)", o.today.h - o.adr, "projection"); }
  if (o.bars5 && o.bars5.length > 20) swingLevels(o.bars5).slice(0, 6).forEach((s, i) => add("SW" + i, `${s.p >= o.last ? "Swing resistance" : "Swing support"} (×${s.n} touches)`, s.p, "swing"));
  for (const l of out) l.kind = l.price >= o.last ? "resistance" : "support";
  return out.sort((a, b) => b.price - a.price);
}

/* ══ TECHNICALS ══════════════════════════════════════════════════════════ */
function technicals(b5, session1) {
  const c = b5.map((x) => x.c), n = c.length;
  if (n < 30) return null;
  const e9 = ema(c, 9), e21 = ema(c, 21), e50 = ema(c, 50), rs = rsi(c, 14);
  const m12 = ema(c, 12), m26 = ema(c, 26), macd = m12.map((v, i) => v - m26[i]), sig = ema(macd, 9);
  const at = atr(b5, 14), ad = adx(b5, 14), st = supertrend(b5, 10, 3);
  const s20 = sma(c, 20), sd20 = (() => { const w = c.slice(-20), m = w.reduce((a, b) => a + b, 0) / w.length; return Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / w.length); })();
  const bbw = s20[n - 1] ? (4 * sd20) / s20[n - 1] : null;
  const bbwHist = []; for (let i = 40; i < n; i++) { const w = c.slice(i - 20, i), m = w.reduce((a, b) => a + b, 0) / 20, sd = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / 20); bbwHist.push((4 * sd) / m); }
  const squeezePct = bbwHist.length ? bbwHist.filter((x) => x <= bbw).length / bbwHist.length : null;
  const tw = twap(session1 || []);
  const last = c[n - 1];
  return {
    last: r2(last), ema9: r2(e9[n - 1]), ema21: r2(e21[n - 1]), ema50: r2(e50[n - 1]),
    emaStack: e9[n - 1] > e21[n - 1] && e21[n - 1] > e50[n - 1] ? 1 : e9[n - 1] < e21[n - 1] && e21[n - 1] < e50[n - 1] ? -1 : 0,
    rsi: r2(rs[n - 1]), macd: r4(macd[n - 1]), macdSignal: r4(sig[n - 1]), macdHist: r4(macd[n - 1] - sig[n - 1]),
    macdCross: Math.sign(macd[n - 1] - sig[n - 1]) !== Math.sign(macd[n - 2] - sig[n - 2]) ? Math.sign(macd[n - 1] - sig[n - 1]) : 0,
    atr: r2(at[n - 1]), atrPct: r4(at[n - 1] / last * 100),
    adx: r2(ad.adx), pdi: r2(ad.pdi), mdi: r2(ad.mdi),
    supertrend: st.dir, supertrendLine: r2(st.line),
    bbWidthPct: r4(bbw * 100), squeezePct: r4(squeezePct),
    twap: r2(tw), twapDistPct: tw ? r4((last / tw - 1) * 100) : null,
  };
}

/* ══ SETUP ═══════════════════════════════════════════════════════════════ */
/** what kind of session is this, and which way does the evidence lean (−100…+100)? */
function setup({ tech, last, orb, today, prevDay, open = true, vixChgPct = null, minutesIn = 0 }) {
  if (!tech) return { label: "Not enough data", bias: 0, confidence: 0, reasons: [] };
  const reasons = [], comp = [];
  const push = (w, v, txt) => { comp.push(w * v); if (txt) reasons.push({ dir: Math.sign(v), text: txt }); };
  if (tech.twap) push(25, Math.max(-1, Math.min(1, tech.twapDistPct / 0.3)), `${tech.twapDistPct >= 0 ? "Above" : "Below"} the session average (TWAP) by ${Math.abs(tech.twapDistPct).toFixed(2)}%`);
  push(15, tech.emaStack, tech.emaStack ? `5-min EMAs stacked ${tech.emaStack > 0 ? "bullishly (9 > 21 > 50)" : "bearishly (9 < 21 < 50)"}` : null);
  push(15, tech.supertrend, `Supertrend (10, 3) ${tech.supertrend > 0 ? "up" : "down"}`);
  if (isNum(tech.rsi)) push(10, Math.max(-1, Math.min(1, (tech.rsi - 50) / 20)), `RSI ${tech.rsi.toFixed(0)}${tech.rsi > 70 ? " (overbought)" : tech.rsi < 30 ? " (oversold)" : ""}`);
  if (isNum(tech.macdHist)) push(10, Math.sign(tech.macdHist), `MACD histogram ${tech.macdHist >= 0 ? "positive" : "negative"}${tech.macdCross ? " — fresh cross" : ""}`);
  let orbState = 0;
  if (orb && minutesIn >= 15) { orbState = last > orb.h ? 1 : last < orb.l ? -1 : 0; push(20, orbState, orbState ? `${orbState > 0 ? "Above" : "Below"} the opening range (${r2(orb.l)}–${r2(orb.h)})` : `Inside the opening range (${r2(orb.l)}–${r2(orb.h)})`); }
  if (isNum(vixChgPct)) push(5, Math.max(-1, Math.min(1, -vixChgPct / 5)), `India VIX ${vixChgPct >= 0 ? "up" : "down"} ${Math.abs(vixChgPct).toFixed(1)}%`);
  const bias = Math.round(comp.reduce((a, b) => a + b, 0));
  const trending = isNum(tech.adx) && tech.adx >= 22, coiling = isNum(tech.squeezePct) && tech.squeezePct <= 0.15;
  let label;
  if (!open) label = "Market closed — last session";
  else if (minutesIn < 15) label = "Opening range forming";
  else if (trending && bias >= 35) label = "Trend day — up";
  else if (trending && bias <= -35) label = "Trend day — down";
  else if (coiling) label = "Coiling — breakout watch";
  else if (orbState === 0 && Math.abs(bias) < 25) label = "Range-bound / two-way";
  else if (today && prevDay && ((today.o > prevDay.h && last < today.o) || (today.o < prevDay.l && last > today.o))) label = "Gap fade — reversal watch";
  else label = bias > 0 ? "Bullish drift" : bias < 0 ? "Bearish drift" : "Neutral";
  const confidence = Math.round(Math.min(100, Math.abs(bias) * (trending ? 1.15 : 0.85)));
  reasons.push({ dir: 0, text: `ADX ${isNum(tech.adx) ? tech.adx.toFixed(0) : "—"}: ${trending ? "trending conditions" : "weak trend — moves tend to fade"}` });
  if (coiling) reasons.push({ dir: 0, text: `Bollinger width in the lowest ${Math.round(tech.squeezePct * 100)}% of the recent range — volatility compressed` });
  return { label, bias, confidence, reasons };
}

/* ══ FORECAST ════════════════════════════════════════════════════════════
   Each model returns, for a horizon h (minutes): { mu, sd } (log return, parametric)
   or { samples, weights } (empirical). The ensemble averages quantiles across
   models (Vincentization) with weights from walk-forward skill. */
const MODELS = [
  { key: "cone", label: "Volatility cone", note: "random walk, today's realised volatility, no drift — the baseline" },
  { key: "momentum", label: "Momentum (fitted)", note: "recent 30-min trend × the continuation coefficient fitted on past sessions (negative = reversal)" },
  { key: "reversion", label: "Mean reversion (TWAP)", note: "Ornstein–Uhlenbeck pull back toward the session average, speed fitted on past sessions" },
  { key: "analog", label: "Historical analogs", note: "the 40 most similar past moments (last 30 min shape, time of day) and what followed" },
  { key: "seasonal", label: "Time-of-day pattern", note: "how the index moved from this clock time over the past sessions, scaled to today's volatility" },
  { key: "session", label: "Session analogs", note: "the 12 past sessions whose whole path from the previous close most resembles today's so far, and how they finished" },
];

/**
 * Whole-session pattern matching (the "minute-bar similarity" method): today's path from the
 * previous close, slot by slot (5 min), against every past session's path up to the same slot
 * (sum of squared differences, recent slots weighted a little more). The k closest sessions and
 * their full-day paths are the analogs; their average is the "fitting" line.
 * @returns { slotNow, analogs: [{ day, dist, sd, path: [{ slot, r }] }] }  r = log return vs previous close
 */
function sessionAnalogs(b5, todayKey, k = 12) {
  const byDay = new Map(); for (const x of b5) { const d = dayKey(x.t); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(x); }
  const days = [...byDay.keys()].sort();
  const slotOf = (t) => Math.floor((minuteOfDay(t) - OPEN_MIN) / 5);
  const pathOf = (d) => { const i = days.indexOf(d); if (i < 1) return null; const prev = byDay.get(days[i - 1]), pc = prev[prev.length - 1].c; const m = new Map(); for (const x of byDay.get(d)) m.set(slotOf(x.t), Math.log(x.c / pc)); return m; };
  const today = pathOf(todayKey); if (!today || !today.size) return null;
  const slotNow = Math.max(...today.keys());
  const sdOf = (bars) => { let s2 = 0, n = 0; for (let i = 1; i < bars.length; i++) { const r = Math.log(bars[i].c / bars[i - 1].c); s2 += r * r; n++; } return n ? Math.sqrt(s2 / n) : null; };
  const cand = [];
  for (const d of days) {
    if (d >= todayKey) continue;
    const p = pathOf(d); if (!p) continue;
    let dist = 0, n = 0;
    for (const [sl, r] of today) { const v = p.get(sl); if (v == null) continue; const w = 0.5 + sl / Math.max(1, slotNow); dist += w * (v - r) ** 2; n += w; }
    if (n < Math.max(1, (slotNow + 1) * 0.6)) continue;
    cand.push({ day: d, dist: dist / n, sd: sdOf(byDay.get(d)), path: [...p].sort((a, b) => a[0] - b[0]).map(([slot, r]) => ({ slot, r })) });
  }
  cand.sort((a, b) => a.dist - b.dist);
  return { slotNow, rNow: today.get(slotNow), analogs: cand.slice(0, k) };
}

/** per-session realised 5-min volatility and the time-of-day volatility profile */
function volProfile(b5) {
  const byDay = new Map();
  for (let i = 1; i < b5.length; i++) {
    if (dayKey(b5[i].t) !== dayKey(b5[i - 1].t)) continue;
    const r = Math.log(b5[i].c / b5[i - 1].c), d = dayKey(b5[i].t), slot = Math.floor((minuteOfDay(b5[i].t) - OPEN_MIN) / 5);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push({ r, slot });
  }
  const daySd = new Map(), slotVar = new Map();
  for (const [d, xs] of byDay) {
    const sd = Math.sqrt(xs.reduce((a, x) => a + x.r * x.r, 0) / Math.max(1, xs.length));
    daySd.set(d, sd);
    for (const x of xs) { if (!sd) continue; const z = x.r / sd; const s = slotVar.get(x.slot) || { s: 0, n: 0 }; s.s += z * z; s.n++; slotVar.set(x.slot, s); }
  }
  const slotMult = new Map([...slotVar].map(([k, v]) => [k, Math.sqrt(v.s / Math.max(1, v.n))]));
  return { daySd, slotMult };
}
/** expected variance multiplier over the next h minutes starting at minute-of-day m (time-of-day profile) */
function seasonalFactor(prof, m, h) {
  let s = 0, n = 0;
  for (let k = 0; k < h; k += 5) { const slot = Math.floor((m + k - OPEN_MIN) / 5); const f = prof.slotMult.get(slot); s += (f != null ? f * f : 1); n++; }
  return n ? Math.sqrt(s / n) : 1;
}

/**
 * Fit the per-index coefficients on past 5-min sessions (cheap; cached daily by the caller).
 * momentum beta: regression of the next-30-min return on the previous-30-min return (vol-normalised)
 * reversion phi: AR(1) of the 5-min deviation from the running session TWAP
 */
function fit(b5) {
  const prof = volProfile(b5);
  const xs = [], ys = [], dev = [], devNext = [];
  let day = null, acc = 0, cnt = 0;
  for (let i = 0; i < b5.length; i++) {
    const d = dayKey(b5[i].t);
    if (d !== day) { day = d; acc = 0; cnt = 0; }
    acc += (b5[i].h + b5[i].l + b5[i].c) / 3; cnt++;
    const tw = acc / cnt, x = Math.log(b5[i].c / tw);
    if (i + 1 < b5.length && dayKey(b5[i + 1].t) === d && cnt >= 6) {
      let acc2 = acc + (b5[i + 1].h + b5[i + 1].l + b5[i + 1].c) / 3;
      dev.push(x); devNext.push(Math.log(b5[i + 1].c / (acc2 / (cnt + 1))));
    }
    if (i >= 6 && i + 6 < b5.length && dayKey(b5[i - 6].t) === d && dayKey(b5[i + 6].t) === d) {
      const sd = prof.daySd.get(d) || 1e-4;
      xs.push(Math.log(b5[i].c / b5[i - 6].c) / sd); ys.push(Math.log(b5[i + 6].c / b5[i].c) / sd);
    }
  }
  const ols = (x, y) => { const n = x.length; if (n < 30) return 0; const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n; let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; } return sxx ? sxy / sxx : 0; };
  const beta = Math.max(-0.6, Math.min(0.6, ols(xs, ys)));
  const phi5 = Math.max(0.5, Math.min(0.999, ols(dev, devNext) || 0.95));
  const devResid = dev.length ? Math.sqrt(dev.reduce((a, x, i) => a + (devNext[i] - phi5 * x) ** 2, 0) / dev.length) : 0.0005;
  return { beta, phi5, devResid, prof, sessions: prof.daySd.size };
}

/** k nearest past moments by the shape of the last 6 five-minute returns and the clock */
function neighbours(b5, prof, curFeat, curMin, k = 40, excludeDay = null) {
  const cand = [];
  for (let i = 6; i < b5.length - 1; i++) {
    const d = dayKey(b5[i].t); if (d === excludeDay || dayKey(b5[i - 6].t) !== d) continue;
    const sd = prof.daySd.get(d) || 1e-4, m = minuteOfDay(b5[i].t);
    let dist = 0;
    for (let j = 0; j < 6; j++) { const r = Math.log(b5[i - 5 + j].c / b5[i - 6 + j].c) / sd; dist += (r - curFeat[j]) ** 2; }
    dist += ((m - curMin) / 30) ** 2;                         // half an hour of clock distance ≈ one σ of shape distance
    cand.push({ i, d, sd, dist });
  }
  return cand.sort((a, b) => a.dist - b.dist).slice(0, k);
}
/** log return from bar i over h minutes within the same session (null when the session ends first) */
function fwd(b5, i, h) { const j = i + Math.round(h / 5); return j < b5.length && dayKey(b5[j].t) === dayKey(b5[i].t) ? Math.log(b5[j].c / b5[i].c) : null; }
function fwdToClose(b5, i) { let j = i; while (j + 1 < b5.length && dayKey(b5[j + 1].t) === dayKey(b5[i].t)) j++; return j > i ? Math.log(b5[j].c / b5[i].c) : null; }

/**
 * @param o { last, b1today (1-min bars of today), b5 (5-min history incl. today), twapNow, minuteNow, fitted, weights, steps }
 * steps: minutes ahead at which to report quantiles (e.g. [5,10,…,60] plus minutes-to-close)
 * @returns { models: { key: { label, note, steps: [{ h, q:[p10..p90 prices], pUp }] } }, ensemble: { steps: [...] }, sigma1 }
 */
function forecast(o) {
  const { last, b1today, b5, fitted, minuteNow } = o;
  const toClose = Math.max(0, CLOSE_MIN - minuteNow);
  const steps = (o.steps || [5, 10, 15, 20, 30, 45, 60, 90, 120]).filter((h) => h <= toClose);
  if (toClose >= 5 && !steps.includes(toClose)) steps.push(toClose);
  if (!steps.length || !isNum(last)) return null;
  // today's realised 1-min volatility (EWMA), blended toward the recent sessions' level early in the day
  const bm = o.barMin || 1;                                   // granularity of b1today (1 live, 5 in the backtest)
  const r1 = []; for (let i = 1; i < b1today.length; i++) r1.push(Math.log(b1today[i].c / b1today[i - 1].c));
  let ew = null; for (const r of r1) ew = ew == null ? r * r : 0.94 * ew + 0.06 * r * r;
  if (ew != null) ew /= bm;                                   // per-minute variance
  const histSd1 = (() => { const v = [...fitted.prof.daySd.values()].slice(-10); return v.length ? (v.reduce((a, b) => a + b, 0) / v.length) / Math.sqrt(5) : 0.0004; })();
  const wToday = Math.min(1, (r1.length * bm) / 60);
  const sd1 = Math.sqrt(wToday * (ew ?? histSd1 ** 2) + (1 - wToday) * histSd1 ** 2) || histSd1;
  const sdH = (h) => sd1 * Math.sqrt(h) * seasonalFactor(fitted.prof, minuteNow, h);
  // shape features: the last 6 five-minute returns of today (normalised by today's 5-min σ)
  const today5 = b5.filter((x) => dayKey(x.t) === dayKey(b1today.length ? b1today[b1today.length - 1].t : b5[b5.length - 1].t));
  const sd5 = sd1 * Math.sqrt(5);
  const feat = []; for (let j = today5.length - 6; j < today5.length; j++) feat.push(j >= 1 ? Math.log(today5[j].c / today5[j - 1].c) / sd5 : 0);
  const todayKey = today5.length ? dayKey(today5[0].t) : null;
  const nb = neighbours(b5, fitted.prof, feat, minuteNow, 40, todayKey);
  const mom30 = today5.length >= 7 ? Math.log(today5[today5.length - 1].c / today5[today5.length - 7].c) / sd5 : 0;
  const devNow = isNum(o.twapNow) ? Math.log(last / o.twapNow) : 0;
  const phi1 = Math.pow(fitted.phi5, 1 / 5), resid1 = fitted.devResid / Math.sqrt(5);
  const sa = todayKey ? sessionAnalogs(b5, todayKey, 12) : null;

  const at = (h) => {
    const sd = sdH(h), out = {};
    out.cone = { mu: 0, sd };
    // momentum: 30-min return carries forward with the fitted coefficient, decaying with horizon
    const hEff = 30 * (1 - Math.exp(-h / 30));
    out.momentum = { mu: fitted.beta * mom30 * sd5 * (hEff / 30), sd };
    // reversion: deviation from TWAP decays by phi per minute
    const muRev = devNow * (Math.pow(phi1, h) - 1);
    const sdRev = Math.sqrt(sd * sd * 0.6 + (resid1 * resid1 * (1 - Math.pow(phi1, 2 * h))) / Math.max(1e-6, 1 - phi1 * phi1) * 0.4);
    out.reversion = { mu: muRev, sd: sdRev };
    // analogs: forward returns of the neighbours, rescaled from their day's σ to today's
    const av = [], aw = [];
    for (const n of nb) { const f = h >= toClose ? fwdToClose(b5, n.i) : fwd(b5, n.i, h); if (f == null) continue; av.push((f / n.sd) * sd5); aw.push(1 / (1 + n.dist)); }
    out.analog = av.length >= 10 ? { samples: av, weights: aw } : { mu: 0, sd };
    // time-of-day: every past session from this clock time
    const sv = [];
    for (let i = 0; i < b5.length; i++) {
      const d = dayKey(b5[i].t); if (d === todayKey) continue;
      if (Math.abs(minuteOfDay(b5[i].t) - minuteNow) > 2) continue;
      const f = h >= toClose ? fwdToClose(b5, i) : fwd(b5, i, h); if (f == null) continue;
      sv.push((f / (fitted.prof.daySd.get(d) || sd5)) * sd5);
    }
    out.seasonal = sv.length >= 8 ? { samples: sv, weights: sv.map(() => 1) } : { mu: 0, sd };
    // session analogs: each analog's move from the current slot over h (or to its close), rescaled to today's volatility
    const ssv = [], ssw = [];
    if (sa && sa.analogs.length >= 6) {
      const dists = sa.analogs.map((a) => a.dist), dMed = dists[Math.floor(dists.length / 2)] || 1e-9;
      for (const a of sa.analogs) {
        const at0 = a.path.find((p) => p.slot === sa.slotNow), tgt = h >= toClose ? a.path[a.path.length - 1] : a.path.find((p) => p.slot === sa.slotNow + Math.round(h / 5));
        if (!at0 || !tgt) continue;
        ssv.push((tgt.r - at0.r) * (a.sd ? sd5 / a.sd : 1)); ssw.push(1 / (1 + a.dist / dMed));
      }
    }
    out.session = ssv.length >= 6 ? { samples: ssv, weights: ssw } : { mu: 0, sd };
    return out;
  };
  const quant = (m) => (m.samples ? QS.map((q) => wQuantile(m.samples, m.weights, q)) : Z.map((z) => m.mu + z * m.sd));
  const pUp = (m) => (m.samples ? m.samples.reduce((a, v, i) => a + (v > 0 ? m.weights[i] : 0), 0) / m.weights.reduce((a, b) => a + b, 0) : Phi(m.mu / m.sd));
  const W = o.weights || Object.fromEntries(MODELS.map((m) => [m.key, 1 / MODELS.length]));
  const models = Object.fromEntries(MODELS.map((m) => [m.key, { label: m.label, note: m.note, weight: r4(W[m.key] || 0), steps: [] }]));
  const ensemble = { steps: [] };
  for (const h of steps.sort((a, b) => a - b)) {
    const ms = at(h);
    const eq = [0, 0, 0, 0, 0]; let ep = 0, wsum = 0;
    for (const m of MODELS) {
      const q = quant(ms[m.key]), p = pUp(ms[m.key]), w = W[m.key] || 0;
      models[m.key].steps.push({ h, q: q.map((x) => r2(last * Math.exp(x))), pUp: r4(p) });
      q.forEach((x, i) => (eq[i] += w * x)); ep += w * p; wsum += w;
    }
    ensemble.steps.push({ h, q: eq.map((x) => r2(last * Math.exp(x / (wsum || 1)))), pUp: r4(ep / (wsum || 1)), sdLog: r4(sdH(h)) });
  }
  return { models, ensemble, sigma1: sd1, minutesToClose: toClose, neighbours: nb.length, sessionAnalogs: sa };
}

/** probability of touching `level` before the close (Brownian motion with drift, reflection principle) */
function touchProb(last, level, muLog, sdLog) {
  if (!isNum(level) || !isNum(last) || !(sdLog > 0)) return null;
  const a = Math.log(level / last); if (a === 0) return 1;
  const s = a > 0 ? 1 : -1, A = Math.abs(a), mu = s * muLog;          // reflect the downside case
  const p = 1 - Phi((A - mu) / sdLog) + Math.exp((2 * mu * A) / (sdLog * sdLog)) * Phi((-A - mu) / sdLog);
  return Math.max(0, Math.min(1, p));
}

/**
 * Walk-forward reliability on past sessions: at every 30 minutes of the last `days`
 * sessions, each model forecasts the next `h` minutes using only earlier sessions.
 * Reports band coverage (did the 50% / 80% range contain the outcome?), directional
 * hit rate when the model leaned (|P(up) − 50%| ≥ 5 pp), and a pinball (quantile) loss
 * that sets the ensemble weights.
 */
function evaluate(b5, { days = 15, h = 30 } = {}) {
  const sessions = [...new Set(b5.map((x) => dayKey(x.t)))];
  const test = sessions.slice(-days);
  const stats = Object.fromEntries(MODELS.map((m) => [m.key, { n: 0, in50: 0, in80: 0, lean: 0, hit: 0, loss: 0 }]));
  stats.ensemble = { n: 0, in50: 0, in80: 0, lean: 0, hit: 0, loss: 0 };
  for (const d of test) {
    const past = b5.filter((x) => dayKey(x.t) < d);
    if (new Set(past.map((x) => dayKey(x.t))).size < 8) continue;
    const fitted = fit(past);
    const day = b5.filter((x) => dayKey(x.t) === d);
    for (let k = 9; k + Math.round(h / 5) < day.length; k += 6) {
      const sofar = day.slice(0, k + 1), last = sofar[sofar.length - 1].c;
      const outcome = Math.log(day[k + Math.round(h / 5)].c / last);
      const tw = twap(sofar), m = minuteOfDay(sofar[sofar.length - 1].t);
      const fc = forecast({ last, b1today: sofar, barMin: 5, b5: [...past, ...sofar], fitted, minuteNow: m, twapNow: tw, steps: [h] });
      if (!fc) continue;
      const score = (key, st) => {
        const q = st.q.map((x) => Math.log(x / last)), S = stats[key];
        S.n++; if (outcome >= q[1] && outcome <= q[3]) S.in50++; if (outcome >= q[0] && outcome <= q[4]) S.in80++;
        if (Math.abs(st.pUp - 0.5) >= 0.05) { S.lean++; if ((st.pUp > 0.5) === (outcome > 0)) S.hit++; }
        S.loss += q.reduce((a, qv, i) => a + Math.max(QS[i] * (outcome - qv), (QS[i] - 1) * (outcome - qv)), 0);
      };
      for (const mm of MODELS) score(mm.key, fc.models[mm.key].steps[0]);
      score("ensemble", fc.ensemble.steps[0]);
    }
  }
  const out = {};
  for (const [k, S] of Object.entries(stats)) out[k] = { samples: S.n, coverage50: S.n ? r4(S.in50 / S.n) : null, coverage80: S.n ? r4(S.in80 / S.n) : null, hitRate: S.lean ? r4(S.hit / S.lean) : null, leaned: S.lean, loss: S.n ? S.loss / S.n : null };
  // weights: inverse pinball loss, sharpened, floor so no model is ignored entirely
  const inv = MODELS.map((m) => (out[m.key].loss ? 1 / out[m.key].loss : 0));
  const tot = inv.reduce((a, b) => a + b ** 4, 0);
  const weights = Object.fromEntries(MODELS.map((m, i) => [m.key, tot ? Math.max(0.05, inv[i] ** 4 / tot) : 1 / MODELS.length]));
  const ws = Object.values(weights).reduce((a, b) => a + b, 0); for (const k in weights) weights[k] = weights[k] / ws;
  return { horizon: h, sessions: test.length, stats: out, weights };
}

/* ══ MULTI-TIMEFRAME ═════════════════════════════════════════════════════
   One row per timeframe: trend (EMA 20/50 and price), RSI 14, MACD histogram,
   and a −2…+2 reading. Alignment = how many timeframes agree. */
function tfRow(bars) {
  if (!bars || bars.length < 30) return null;
  const c = bars.map((x) => x.c), n = c.length, e20 = ema(c, 20), e50 = ema(c, Math.min(50, Math.max(20, n - 1)));
  const e26 = ema(c, 26), rs = rsi(c, 14), m = ema(c, 12).map((v, i) => v - e26[i]), sig = ema(m, 9), hist = m[n - 1] - sig[n - 1];
  const slope = (e20[n - 1] - e20[Math.max(0, n - 6)]) / e20[n - 1] * 100;
  let score = 0;
  score += c[n - 1] > e20[n - 1] ? 0.5 : -0.5;
  score += e20[n - 1] > e50[n - 1] ? 0.5 : -0.5;
  score += hist > 0 ? 0.5 : -0.5;
  score += rs[n - 1] > 55 ? 0.5 : rs[n - 1] < 45 ? -0.5 : 0;
  const trend = score >= 1 ? "Bullish" : score <= -1 ? "Bearish" : "Neutral";
  const signal = score >= 1.5 ? "Strong bullish" : score >= 1 ? "Bullish" : score <= -1.5 ? "Strong bearish" : score <= -1 ? "Bearish" : "Neutral";
  return { trend, signal, score, rsi: r2(rs[n - 1]), macdHist: r4(hist), ema20: r2(e20[n - 1]), slopePct: r4(slope), last: r2(c[n - 1]) };
}
/** series: { "1m": bars, "5m": bars, "15m": …, "1h": …, "1d": …, "1wk": …, "1mo": … } */
function multiTimeframe(series) {
  const order = [["1m", "1 min"], ["5m", "5 min"], ["15m", "15 min"], ["1h", "1 hour"], ["1d", "Daily"], ["1wk", "Weekly"], ["1mo", "Monthly"]];
  const rows = order.map(([k, label]) => ({ key: k, label, ...(tfRow(series[k]) || { trend: "—", signal: "Not enough data", score: 0 }) }));
  const valid = rows.filter((r) => r.rsi != null);
  const bull = valid.filter((r) => r.score >= 1).length, bear = valid.filter((r) => r.score <= -1).length;
  const intraday = rows.filter((r) => ["5m", "15m", "1h"].includes(r.key) && r.rsi != null);
  const intraAlign = intraday.length ? intraday.reduce((a, r) => a + Math.sign(r.score), 0) / intraday.length : 0;
  return { rows, bull, bear, total: valid.length, alignment: valid.length ? r4((bull - bear) / valid.length) : 0, intradayAlignment: r4(intraAlign) };
}
/** aggregate bars into calendar weeks / months (IST) — for indices Yahoo has no long daily history for */
function aggregate(bars, unit) {
  const keyOf = (t) => { const d = new Date(t + IST); if (unit === "1mo") return d.toISOString().slice(0, 7); const dow = (d.getUTCDay() + 6) % 7; return dayKey(t - dow * 86400e3); };
  const out = [];
  for (const x of bars) { const k = unit === "1d" ? dayKey(x.t) : keyOf(x.t), l = out[out.length - 1];
    if (l && l._k === k) { l.h = Math.max(l.h, x.h); l.l = Math.min(l.l, x.l); l.c = x.c; } else out.push({ _k: k, t: x.t, o: x.o, h: x.h, l: x.l, c: x.c }); }
  return out.map(({ _k, ...r }) => r);
}

/* ══ MULTI-DAY FORECAST (daily / weekly / monthly charts) ═════════════════
   Horizons in trading days. Models: volatility cone (EWMA daily σ), fitted momentum
   (next-h vs past-h returns), daily analogs (the 30 most similar 10-day shapes), and —
   when the option chain is available — the options-implied cone (ATM IV). */
function forecastDaily(daily, { horizons = [1, 5, 10, 21], ivPct = null } = {}) {
  const c = daily.map((x) => x.c), n = c.length;
  if (n < 40) return null;
  const r = []; for (let i = 1; i < n; i++) r.push(Math.log(c[i] / c[i - 1]));
  let ew = null; for (const x of r.slice(-250)) ew = ew == null ? x * x : 0.94 * ew + 0.06 * x * x;
  const sd1 = Math.sqrt(ew), last = c[n - 1];
  const models = { cone: { label: "Volatility cone", steps: [] }, momentum: { label: "Momentum (fitted)", steps: [] }, analog: { label: "Historical analogs", steps: [] } };
  if (ivPct) models.implied = { label: "Options-implied", steps: [] };
  const ens = { steps: [] };
  // analog neighbours: last 10 daily returns, z-scored
  const L = 10, sdAll = Math.sqrt(r.reduce((a, x) => a + x * x, 0) / r.length) || 0.01;
  const feat = r.slice(-L).map((x) => x / sdAll);
  const cand = [];
  for (let i = L; i < r.length - 1; i++) { let d = 0; for (let j = 0; j < L; j++) d += (r[i - L + j] / sdAll - feat[j]) ** 2; cand.push({ i, d }); }
  const nb = cand.sort((a, b) => a.d - b.d).slice(0, 30);
  for (const h of horizons) {
    const sd = sd1 * Math.sqrt(h), out = {};
    out.cone = { mu: 0, sd };
    // momentum: regress next-h on past-h (non-overlapping enough, vol-normalised)
    const xs = [], ys = []; for (let i = h; i + h < c.length; i += Math.max(1, Math.floor(h / 2))) { xs.push(Math.log(c[i] / c[i - h])); ys.push(Math.log(c[i + h] / c[i])); }
    const mx = xs.reduce((a, b) => a + b, 0) / (xs.length || 1), my = ys.reduce((a, b) => a + b, 0) / (ys.length || 1);
    let sxy = 0, sxx = 0; xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; });
    const beta = sxx && xs.length > 20 ? Math.max(-0.5, Math.min(0.5, sxy / sxx)) : 0;
    out.momentum = { mu: beta * Math.log(last / c[Math.max(0, n - 1 - h)]), sd };
    const av = []; for (const nn of nb) { const j = nn.i + 1; if (j + h < c.length) av.push(Math.log(c[j + h - 1] / c[j - 1]) * (sd1 / sdAll)); }
    out.analog = av.length >= 8 ? { samples: av, weights: av.map(() => 1) } : { mu: 0, sd };
    if (ivPct) out.implied = { mu: 0, sd: (ivPct / 100) * Math.sqrt(h / 252) };
    const keys = Object.keys(out), eq = [0, 0, 0, 0, 0]; let ep = 0;
    for (const k of keys) {
      const m = out[k];
      const q = m.samples ? QS.map((qq) => wQuantile(m.samples, m.weights, qq)) : Z.map((z) => m.mu + z * m.sd);
      const p = m.samples ? m.samples.filter((v) => v > 0).length / m.samples.length : Phi(m.mu / m.sd);
      models[k].steps.push({ h, q: q.map((x) => r2(last * Math.exp(x))), pUp: r4(p) });
      q.forEach((x, i) => (eq[i] += x / keys.length)); ep += p / keys.length;
    }
    ens.steps.push({ h, q: eq.map((x) => r2(last * Math.exp(x))), pUp: r4(ep), sdLog: r4((eq[4] - eq[0]) / (2 * 1.2816)) });
  }
  return { models, ensemble: ens, sigmaDaily: r4(sd1), unit: "days" };
}

/* ══ SCENARIOS ══════════════════════════════════════════════════════════
   From the ensemble distribution at a horizon: bullish = move above +θ, bearish = below
   −θ, base = in between, with θ = half the horizon's σ. Triggers / targets / invalidation
   come from the level map; paths are quantile paths for the chart's branches. */
function scenarios(last, ensSteps, lvls, { horizonLabel = "", atr = null } = {}) {
  if (!ensSteps || !ensSteps.length) return null;
  const F = (v) => (isNum(v) ? v.toLocaleString("en-IN", { maximumFractionDigits: 0 }) : "—");
  const end = ensSteps[ensSteps.length - 1];
  const med = Math.log(end.q[2] / last), sd = Math.max(1e-6, (Math.log(end.q[4] / last) - Math.log(end.q[0] / last)) / (2 * 1.2816));
  const th = 0.5 * sd;
  const pBull = 1 - Phi((th - med) / sd), pBear = Phi((-th - med) / sd), pBase = Math.max(0, 1 - pBull - pBear);
  const above = lvls.filter((l) => l.price > last * 1.0002).sort((a, b) => a.price - b.price);
  const below = lvls.filter((l) => l.price < last * 0.9998).sort((a, b) => b.price - a.price);
  const tgtUp = end.q[4], tgtDn = end.q[0];
  // targets: at least half an ATR (or 0.08%) past the trigger and from each other — no near-duplicate levels
  const gap = Math.max(isNum(atr) ? atr * 0.5 : 0, last * 0.0008);
  const beyond = (arr, p, dir) => { const out = []; let ref = p; for (const l of arr) { if ((dir > 0 ? l.price - ref : ref - l.price) >= gap) { out.push({ label: l.label, price: l.price }); ref = l.price; if (out.length === 2) break; } } return out; };
  const trigUp = above[0] || null, trigDn = below[0] || null;
  const path = (i) => ensSteps.map((s) => ({ h: s.h, p: i === "bull" ? r2((s.q[3] + s.q[4]) / 2) : i === "bear" ? r2((s.q[0] + s.q[1]) / 2) : s.q[2] }));
  return {
    horizon: horizonLabel, threshold: r2(last * th),
    bull: { p: r4(pBull), trigger: trigUp && { label: trigUp.label, price: trigUp.price }, targets: [...(trigUp ? beyond(above, trigUp.price, 1) : []), { label: "80% upper band", price: r2(tgtUp) }],
      invalidation: trigDn ? { label: trigDn.label, price: trigDn.price } : null, path: path("bull"),
      text: `Holds above ${trigUp ? trigUp.label + " " + F(trigUp.price) : "resistance"} and extends toward ${F(tgtUp)}` },
    base: { p: r4(pBase), range: [r2(end.q[1]), r2(end.q[3])], path: path("base"),
      text: `Two-way trade between ${F(trigDn ? trigDn.price : end.q[1])} and ${F(trigUp ? trigUp.price : end.q[3])}; median ${F(end.q[2])}` },
    bear: { p: r4(pBear), trigger: trigDn && { label: trigDn.label, price: trigDn.price }, targets: [...(trigDn ? beyond(below, trigDn.price, -1) : []), { label: "80% lower band", price: r2(tgtDn) }],
      invalidation: trigUp ? { label: trigUp.label, price: trigUp.price } : null, path: path("bear"),
      text: `Breaks ${trigDn ? trigDn.label + " " + F(trigDn.price) : "support"} and slides toward ${F(tgtDn)}` },
    expectedRange: { p10: end.q[0], p90: end.q[4], atr: r2(atr) },
  };
}

/* ══ REGIME ENGINE ═══════════════════════════════════════════════════════
   0–100 (50 = neutral) from trend, momentum, multi-timeframe alignment, breadth,
   sector participation, volatility and derivatives. Each component is listed with
   its reading so the score is explainable. */
function regime(o) {
  const rows = [], add = (key, label, val, w, text) => { if (isNum(val)) rows.push({ key, label, val: Math.max(-1, Math.min(1, val)), w, text }); };
  const t = o.tech || {};
  if (t.twap) add("vwap", "Price vs session avg", t.twapDistPct / 0.25, 12, `${t.twapDistPct >= 0 ? "Above" : "Below"} TWAP (${t.twapDistPct >= 0 ? "+" : ""}${t.twapDistPct.toFixed(2)}%)`);
  add("structure", "Trend structure", t.emaStack, 10, t.emaStack > 0 ? "EMA 9 > 21 > 50 (up)" : t.emaStack < 0 ? "EMA 9 < 21 < 50 (down)" : "EMAs mixed");
  if (isNum(t.rsi)) add("momentum", "Momentum (RSI 14)", (t.rsi - 50) / 20, 8, `RSI ${t.rsi.toFixed(1)}${t.rsi > 60 ? " (bullish)" : t.rsi < 40 ? " (bearish)" : ""}`);
  if (isNum(t.macdHist)) add("macd", "MACD", Math.sign(t.macdHist), 6, `${t.macdHist >= 0 ? "Above" : "Below"} signal${t.macdCross ? " — fresh crossover" : ""}`);
  if (o.mtf) add("mtf", "Multi-timeframe alignment", o.mtf.alignment, 16, `${o.mtf.bull} bullish · ${o.mtf.bear} bearish of ${o.mtf.total} timeframes`);
  if (o.orb) add("orb", "Opening range", o.last > o.orb.h ? 1 : o.last < o.orb.l ? -1 : 0, 8, o.last > o.orb.h ? "Above the opening range" : o.last < o.orb.l ? "Below the opening range" : "Inside the opening range");
  if (o.breadth && isNum(o.breadth.adRatio)) add("breadth", "Market breadth", (o.breadth.adRatio - 1) / 1, 14, `${o.breadth.advancers} advancing / ${o.breadth.decliners} declining (A/D ${o.breadth.adRatio})`);
  if (o.sectors && o.sectors.length) { const up = o.sectors.filter((s) => s.changePct > 0).length; add("sectors", "Sector participation", (up / o.sectors.length - 0.5) * 2, 8, `${up} of ${o.sectors.length} sectors up`); }
  if (o.vix && isNum(o.vix.changePct)) add("vix", "India VIX", -o.vix.changePct / 5, 6, `${o.vix.price} (${o.vix.changePct >= 0 ? "+" : ""}${o.vix.changePct.toFixed(2)}%)`);
  if (o.oi && isNum(o.oi.pcr)) add("pcr", "Options PCR (OI)", (o.oi.pcr - 1) / 0.4, 6, `${o.oi.pcr} — ${o.oi.sentiment || ""}`);
  if (o.futures && o.futures.buildup) add("fut", "Futures price & OI", /Long build|Short cover/.test(o.futures.buildup) ? 1 : -1, 6, `${o.futures.buildup} (basis ${o.futures.basis})`);
  if (isNum(o.globalTone)) add("global", "Global cues", o.globalTone / 1, 6, `Global equity indices ${o.globalTone >= 0 ? "+" : ""}${o.globalTone.toFixed(2)}% on average`);
  const fii = o.positioning && o.positioning.rows && o.positioning.rows.FII;
  if (fii && isNum(fii.futLongPct)) add("fiipos", "FII index-futures positioning", (fii.futLongPct - 50) / 25, 5, `FII ${fii.futLongPct}% long in index futures${isNum(fii.futLongPctChg) ? ` (${fii.futLongPctChg >= 0 ? "+" : ""}${fii.futLongPctChg} pp d/d)` : ""}`);
  const wsum = rows.reduce((a, r) => a + r.w, 0) || 1;
  const s = rows.reduce((a, r) => a + r.w * r.val, 0) / wsum;           // −1…+1
  const score = Math.round(50 + 50 * s);
  const adx = t.adx, atrPct = t.atrPct, wide = isNum(atrPct) && isNum(o.atrPctMedian) && atrPct > 1.6 * o.atrPctMedian;
  const trending = isNum(adx) && adx >= 22, agree = rows.filter((r) => Math.sign(r.val) === Math.sign(s) && Math.abs(r.val) > 0.2).length / Math.max(1, rows.length);
  let label;
  if (wide && !trending) label = "Volatile / two-way";
  else if (trending && score >= 62) label = "Bullish trend";
  else if (trending && score <= 38) label = "Bearish trend";
  else if (!trending && Math.abs(score - 50) < 12) label = "Range-bound";
  else if (o.prevLabel && /trend/.test(o.prevLabel) && Math.abs(score - 50) < 18) label = "Transitioning";   // a trend regime losing its readings
  else label = score > 50 ? "Bullish tilt" : "Bearish tilt";
  const confidence = agree >= 0.7 && trending ? "High" : agree >= 0.5 ? "Medium" : "Low";
  // what the regime suits — a classification of conditions, never an instruction
  const suits = !o.open ? { key: "closed", text: "Market closed — plan, don't trade" }
    : label === "Volatile / two-way" || confidence === "Low" ? { key: "stand-aside", text: "Stand aside / reduce size — signals disagree" }
      : label === "Range-bound" ? { key: "range", text: "Range conditions — fades at the edges, not breakouts" }
        : score >= 58 ? { key: "bull", text: "Bullish directional conditions (call side / long setups)" }
          : score <= 42 ? { key: "bear", text: "Bearish directional conditions (put side / short setups)" }
            : { key: "neutral", text: "No clear edge — wait for confirmation" };
  // pillars (0–100) for the panel: trend · momentum · breadth · volatility · global · derivatives
  const P = { trend: ["vwap", "structure", "mtf", "orb"], momentum: ["momentum", "macd"], breadth: ["breadth", "sectors"], volatility: ["vix"], global: ["global"], derivatives: ["pcr", "fut", "fiipos"] };
  const pillars = Object.fromEntries(Object.entries(P).map(([k, keys]) => { const rs = rows.filter((r) => keys.includes(r.key)); const w = rs.reduce((a, r) => a + r.w, 0); return [k, w ? Math.round(50 + 50 * rs.reduce((a, r) => a + r.w * r.val, 0) / w) : null]; }));
  if (isNum(adx)) pillars.trendStrength = Math.round(Math.max(0, Math.min(100, (adx / 50) * 100)));
  return { score, label, confidence, pillars, rows: rows.map((r) => ({ key: r.key, label: r.label, text: r.text, tone: r.val > 0.2 ? "up" : r.val < -0.2 ? "down" : "flat", weight: r.w })), suits };
}

/* ══ SEASONALITY ═════════════════════════════════════════════════════════ */
function seasonality(b5, daily) {
  // average path through the session (cumulative log return from the open, by 5-min slot)
  const slots = new Map(), byDay = new Map();
  for (const x of b5) { const d = dayKey(x.t); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(x); }
  for (const [, bars] of byDay) { const o = bars[0].o; for (const x of bars) { const s = Math.floor((minuteOfDay(x.t) - OPEN_MIN) / 5); const a = slots.get(s) || []; a.push(Math.log(x.c / o) * 100); slots.set(s, a); } }
  const path = [...slots].sort((a, b) => a[0] - b[0]).map(([s, a]) => ({ minute: OPEN_MIN + s * 5, mean: r4(a.reduce((x, y) => x + y, 0) / a.length), up: r4(a.filter((v) => v > 0).length / a.length), n: a.length }));
  const dows = ["Mon", "Tue", "Wed", "Thu", "Fri"], dow = dows.map((d) => ({ day: d, rets: [] }));
  for (let i = 1; i < daily.length; i++) { const wd = new Date(daily[i].t + IST).getUTCDay(); if (wd >= 1 && wd <= 5) dow[wd - 1].rets.push((daily[i].c / daily[i - 1].c - 1) * 100); }
  return { sessions: byDay.size, path, dayOfWeek: dow.map((d) => ({ day: d.day, avg: d.rets.length ? r4(d.rets.reduce((a, b) => a + b, 0) / d.rets.length) : null, up: d.rets.length ? r4(d.rets.filter((v) => v > 0).length / d.rets.length) : null, n: d.rets.length })) };
}

module.exports = {
  IST, OPEN_MIN, CLOSE_MIN, minuteOfDay, dayKey, Phi, invPhi,
  ema, sma, rsi, atr, adx, supertrend, resample, twap, sessionOf,
  pivotSet, swingLevels, levels, technicals, setup, fit, forecast, touchProb, evaluate, MODELS,
  multiTimeframe, aggregate, forecastDaily, scenarios, regime, seasonality, sessionAnalogs,
};
