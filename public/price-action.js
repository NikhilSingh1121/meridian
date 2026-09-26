/* ════════════════════════════════════════════════════════════════════
   MERIDIAN · AI PRICE ACTION & CANDLESTICK ANALYSIS WORKSPACE
   Sits between Portfolio Health (stats strip) and the Technical table.

   Architecture:
     PA_MATH    — indicator mathematics (EMA/RSI/MACD/ADX/ATR/OBV/MFI/ROC/CCI/BB/VWAP/Supertrend/Ichimoku)
     PA_STRUCT  — swing detection, support/resistance clustering, trend & structure read
     PA_PATTERN — 19-pattern candlestick detection engine
     PA_SCORE   — confluence engine: Pattern + Trend + Structure + S/R + EMA + Momentum + Volume + Confirmation
     PA_KB      — original educational knowledge base per pattern (concepts, not copied text)
     PA_AI      — institutional commentary generator (deterministic, context-driven)
     PAChart    — canvas candlestick chart (zoom/pan/crosshair/overlays/markers/drawing)
     PA         — workspace controller (navigator · chart · insights · drawer)
   ════════════════════════════════════════════════════════════════════ */

/* ── PA_MATH · indicator mathematics ─────────────────────────────────── */
const PA_MATH = {
  sma(vals, n) {
    const out = new Array(vals.length).fill(null); let s = 0;
    for (let i = 0; i < vals.length; i++) { s += vals[i]; if (i >= n) s -= vals[i - n]; if (i >= n - 1) out[i] = s / n; }
    return out;
  },
  ema(vals, n) {
    const out = new Array(vals.length).fill(null); const k = 2 / (n + 1); let e = null;
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i]; if (v == null) { out[i] = e; continue; }
      e = e == null ? v : v * k + e * (1 - k); out[i] = i >= n - 1 ? e : null;
    }
    return out;
  },
  rsi(closes, n = 14) {
    const out = new Array(closes.length).fill(null); let g = 0, l = 0;
    for (let i = 1; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
      if (i <= n) { g += up; l += dn; if (i === n) { g /= n; l /= n; out[i] = 100 - 100 / (1 + (l === 0 ? 100 : g / l)); } }
      else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; out[i] = 100 - 100 / (1 + (l === 0 ? 100 : g / l)); }
    }
    return out;
  },
  macd(closes, fast = 12, slow = 26, sig = 9) {
    const ef = this.ema(closes, fast), es = this.ema(closes, slow);
    const line = closes.map((_, i) => (ef[i] != null && es[i] != null ? ef[i] - es[i] : null));
    const signal = this.ema(line.map((v) => v ?? 0), sig).map((v, i) => (line[i] == null ? null : v));
    const hist = line.map((v, i) => (v != null && signal[i] != null ? v - signal[i] : null));
    return { line, signal, hist };
  },
  atr(c, n = 14) {
    const tr = c.map((k, i) => i === 0 ? k.h - k.l : Math.max(k.h - k.l, Math.abs(k.h - c[i - 1].c), Math.abs(k.l - c[i - 1].c)));
    const out = new Array(c.length).fill(null); let a = null;
    for (let i = 0; i < c.length; i++) {
      if (i === n - 1) { a = tr.slice(0, n).reduce((x, y) => x + y, 0) / n; out[i] = a; }
      else if (i >= n) { a = (a * (n - 1) + tr[i]) / n; out[i] = a; }
    }
    return out;
  },
  adx(c, n = 14) {
    const len = c.length, out = new Array(len).fill(null);
    if (len < n * 2 + 1) return out;
    let trS = 0, pS = 0, mS = 0; const dxs = [];
    let prevTr = null, prevP = null, prevM = null;
    for (let i = 1; i < len; i++) {
      const up = c[i].h - c[i - 1].h, dn = c[i - 1].l - c[i].l;
      const pDM = up > dn && up > 0 ? up : 0, mDM = dn > up && dn > 0 ? dn : 0;
      const tr = Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c));
      if (i <= n) { trS += tr; pS += pDM; mS += mDM; if (i === n) { prevTr = trS; prevP = pS; prevM = mS; } }
      else { prevTr = prevTr - prevTr / n + tr; prevP = prevP - prevP / n + pDM; prevM = prevM - prevM / n + mDM; }
      if (i >= n && prevTr > 0) {
        const pDI = (prevP / prevTr) * 100, mDI = (prevM / prevTr) * 100;
        const dx = pDI + mDI === 0 ? 0 : (Math.abs(pDI - mDI) / (pDI + mDI)) * 100;
        dxs.push(dx);
        if (dxs.length === n) out[i] = dxs.reduce((x, y) => x + y, 0) / n;
        else if (dxs.length > n) out[i] = (out[i - 1] * (n - 1) + dx) / n;
      }
    }
    return out;
  },
  obv(c) {
    const out = new Array(c.length).fill(0);
    for (let i = 1; i < c.length; i++) out[i] = out[i - 1] + (c[i].c > c[i - 1].c ? (c[i].v || 0) : c[i].c < c[i - 1].c ? -(c[i].v || 0) : 0);
    return out;
  },
  mfi(c, n = 14) {
    const out = new Array(c.length).fill(null);
    const tp = c.map((k) => (k.h + k.l + k.c) / 3);
    for (let i = n; i < c.length; i++) {
      let pos = 0, neg = 0;
      for (let j = i - n + 1; j <= i; j++) {
        const flow = tp[j] * (c[j].v || 0);
        if (tp[j] > tp[j - 1]) pos += flow; else if (tp[j] < tp[j - 1]) neg += flow;
      }
      out[i] = neg === 0 ? 100 : 100 - 100 / (1 + pos / neg);
    }
    return out;
  },
  roc(closes, n = 12) { return closes.map((v, i) => (i >= n && closes[i - n] ? ((v - closes[i - n]) / closes[i - n]) * 100 : null)); },
  cci(c, n = 20) {
    const tp = c.map((k) => (k.h + k.l + k.c) / 3), out = new Array(c.length).fill(null);
    for (let i = n - 1; i < c.length; i++) {
      const w = tp.slice(i - n + 1, i + 1), m = w.reduce((x, y) => x + y, 0) / n;
      const md = w.reduce((x, y) => x + Math.abs(y - m), 0) / n;
      out[i] = md === 0 ? 0 : (tp[i] - m) / (0.015 * md);
    }
    return out;
  },
  bollinger(closes, n = 20, mult = 2) {
    const mid = this.sma(closes, n), up = new Array(closes.length).fill(null), lo = new Array(closes.length).fill(null);
    for (let i = n - 1; i < closes.length; i++) {
      const w = closes.slice(i - n + 1, i + 1), m = mid[i];
      const sd = Math.sqrt(w.reduce((x, y) => x + (y - m) ** 2, 0) / n);
      up[i] = m + mult * sd; lo[i] = m - mult * sd;
    }
    return { mid, up, lo };
  },
  vwap(c) {
    // session-anchored is impractical across ranges; use cumulative anchored at window start
    const out = new Array(c.length).fill(null); let pv = 0, vv = 0;
    for (let i = 0; i < c.length; i++) {
      const tp = (c[i].h + c[i].l + c[i].c) / 3, v = c[i].v || 0;
      pv += tp * v; vv += v; out[i] = vv > 0 ? pv / vv : null;
    }
    return out;
  },
  supertrend(c, n = 10, mult = 3) {
    const atr = this.atr(c, n), out = new Array(c.length).fill(null);
    let up = null, dn = null, trendUp = true;
    for (let i = 0; i < c.length; i++) {
      if (atr[i] == null) continue;
      const mid = (c[i].h + c[i].l) / 2;
      let bU = mid + mult * atr[i], bL = mid - mult * atr[i];
      if (dn != null && (bL < dn && c[i - 1].c >= dn)) bL = dn;      // ratchet
      if (up != null && (bU > up && c[i - 1].c <= up)) bU = up;
      if (out[i - 1] != null) {
        if (trendUp && c[i].c < dn) trendUp = false;
        else if (!trendUp && c[i].c > up) trendUp = true;
      }
      dn = trendUp ? Math.max(bL, dn ?? -Infinity) : bL;
      up = trendUp ? bU : Math.min(bU, up ?? Infinity);
      if (trendUp) { dn = Math.max(bL, out[i - 1] != null && out[i - 1].up ? out[i - 1].line : -Infinity, dn); }
      out[i] = { line: trendUp ? dn : up, up: trendUp };
    }
    return out;
  },
  ichimoku(c) {
    const hh = (i, n) => Math.max(...c.slice(Math.max(0, i - n + 1), i + 1).map((k) => k.h));
    const ll = (i, n) => Math.min(...c.slice(Math.max(0, i - n + 1), i + 1).map((k) => k.l));
    const tenkan = c.map((_, i) => (i >= 8 ? (hh(i, 9) + ll(i, 9)) / 2 : null));
    const kijun = c.map((_, i) => (i >= 25 ? (hh(i, 26) + ll(i, 26)) / 2 : null));
    const spanA = c.map((_, i) => (tenkan[i] != null && kijun[i] != null ? (tenkan[i] + kijun[i]) / 2 : null));
    const spanB = c.map((_, i) => (i >= 51 ? (hh(i, 52) + ll(i, 52)) / 2 : null));
    return { tenkan, kijun, spanA, spanB }; // plotted with +26 displacement for spans
  },
};

/* ── PA_STRUCT · swings, support/resistance, trend & structure read ──── */
const PA_STRUCT = {
  /* swing highs/lows using a symmetric pivot window */
  swings(c, w = 3) {
    const highs = [], lows = [];
    for (let i = w; i < c.length - w; i++) {
      let isH = true, isL = true;
      for (let j = i - w; j <= i + w; j++) {
        if (c[j].h > c[i].h) isH = false;
        if (c[j].l < c[i].l) isL = false;
      }
      if (isH) highs.push({ i, p: c[i].h });
      if (isL) lows.push({ i, p: c[i].l });
    }
    return { highs, lows };
  },
  /* cluster swing prices into horizontal S/R zones; strength = touches (recency-weighted) */
  levels(c, opts = {}) {
    const { highs, lows } = this.swings(c, opts.w || 3);
    const pts = [...highs.map((x) => ({ ...x, kind: "h" })), ...lows.map((x) => ({ ...x, kind: "l" }))];
    if (!pts.length) return [];
    const px = c.at(-1).c;
    const atr = PA_MATH.atr(c, 14).at(-1) || px * 0.02;
    const tol = Math.max(atr * 0.6, px * 0.004);
    pts.sort((a, b) => a.p - b.p);
    const clusters = [];
    for (const p of pts) {
      const last = clusters.at(-1);
      if (last && Math.abs(p.p - last.sum / last.n) <= tol) { last.sum += p.p; last.n++; last.w += 1 + p.i / c.length; last.last = Math.max(last.last, p.i); }
      else clusters.push({ sum: p.p, n: 1, w: 1 + p.i / c.length, last: p.i });
    }
    return clusters
      .map((cl) => ({ price: cl.sum / cl.n, touches: cl.n, strength: cl.w, lastTouch: cl.last }))
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 10)
      .sort((a, b) => a.price - b.price);
  },
  keyLevels(c) {
    const lv = this.levels(c), px = c.at(-1).c;
    const above = lv.filter((l) => l.price > px * 1.002).sort((a, b) => a.price - b.price);
    const below = lv.filter((l) => l.price < px * 0.998).sort((a, b) => b.price - a.price);
    return { r1: above[0]?.price ?? null, r2: above[1]?.price ?? null, s1: below[0]?.price ?? null, s2: below[1]?.price ?? null, all: lv };
  },
  /* market-structure read at index i (default last):
     trend via EMA20/50 relation + slope + HH/HL vs LH/LL sequencing */
  trendAt(c, i = c.length - 1, pre) {
    const closes = pre?.closes || c.map((k) => k.c);
    const e20 = pre?.e20 || PA_MATH.ema(closes, 20), e50 = pre?.e50 || PA_MATH.ema(closes, 50);
    if (i < 21) return { dir: 0, label: "Undetermined", detail: "insufficient history" };
    const slope = e20[i] != null && e20[i - 5] != null ? (e20[i] - e20[i - 5]) / e20[i - 5] : 0;
    const { highs, lows } = this.swings(c.slice(Math.max(0, i - 60), i + 1), 3);
    let hh = 0, hl = 0, lh = 0, ll = 0;
    for (let k = 1; k < highs.length; k++) highs[k].p > highs[k - 1].p ? hh++ : lh++;
    for (let k = 1; k < lows.length; k++) lows[k].p > lows[k - 1].p ? hl++ : ll++;
    const emaBull = e20[i] != null && e50[i] != null && e20[i] > e50[i];
    const structBull = hh + hl, structBear = lh + ll;
    let dir = 0;
    if (emaBull && slope > 0.001 && structBull >= structBear) dir = structBull > structBear * 1.5 ? 2 : 1;
    else if (!emaBull && slope < -0.001 && structBear >= structBull) dir = structBear > structBull * 1.5 ? -2 : -1;
    const label = dir === 2 ? "Strong Uptrend" : dir === 1 ? "Uptrend" : dir === -2 ? "Strong Downtrend" : dir === -1 ? "Downtrend" : "Range / Sideways";
    return { dir, label, detail: `${hh}HH·${hl}HL vs ${lh}LH·${ll}LL, EMA20 ${emaBull ? ">" : "<"} EMA50` };
  },
  /* was the short window before i falling (for reversal-from-decline context)? */
  legInto(c, i, n = 5) {
    if (i < n + 1) return 0;
    const a = c[i - n].c, b = c[i - 1].c;
    const chg = (b - a) / a;
    return chg < -0.015 ? -1 : chg > 0.015 ? 1 : 0;
  },
};

/* ── PA_PATTERN · candlestick pattern detection ──────────────────────── */
/* Each detector receives candles c, index i, ctx {atrArr, avgBody, trend, legInto}
   Returns null or { name, dir: 1|-1|0, base (reliability), candles, glyph } */
const PA_PATTERN = (() => {
  const body = (k) => Math.abs(k.c - k.o);
  const range = (k) => k.h - k.l || 1e-9;
  const upSh = (k) => k.h - Math.max(k.o, k.c);
  const loSh = (k) => Math.min(k.o, k.c) - k.l;
  const bull = (k) => k.c > k.o, bear = (k) => k.c < k.o;
  const mid = (k) => (k.o + k.c) / 2;

  /* Ordered by specificity — first match wins for the "primary" pattern at i,
     but detectAll collects every match for the timeline. */
  const DETECTORS = [
    { name: "Morning Star", n: 3, base: 62, glyph: "ms", f(c, i, x) {
      if (i < 2) return null; const a = c[i - 2], b = c[i - 1], d = c[i];
      if (!(bear(a) && body(a) > x.avgBody(i) * 0.9)) return null;
      if (body(b) > x.avgBody(i) * 0.6) return null;
      if (!(bull(d) && d.c > mid(a))) return null;
      if (x.legInto(c, i - 1) >= 0 && x.trend(i).dir >= 0) return null;    // needs a decline into it
      return { dir: 1 };
    }},
    { name: "Evening Star", n: 3, base: 62, glyph: "es", f(c, i, x) {
      if (i < 2) return null; const a = c[i - 2], b = c[i - 1], d = c[i];
      if (!(bull(a) && body(a) > x.avgBody(i) * 0.9)) return null;
      if (body(b) > x.avgBody(i) * 0.6) return null;
      if (!(bear(d) && d.c < mid(a))) return null;
      if (x.legInto(c, i - 1) <= 0 && x.trend(i).dir <= 0) return null;
      return { dir: -1 };
    }},
    { name: "Three White Soldiers", n: 3, base: 65, glyph: "3w", f(c, i, x) {
      if (i < 2) return null; const a = c[i - 2], b = c[i - 1], d = c[i];
      if (!(bull(a) && bull(b) && bull(d))) return null;
      if (!(b.c > a.c && d.c > b.c && b.o > a.o && d.o > b.o)) return null;
      if ([a, b, d].some((k) => body(k) < x.avgBody(i) * 0.7 || upSh(k) > body(k) * 0.6)) return null;
      return { dir: 1 };
    }},
    { name: "Three Black Crows", n: 3, base: 65, glyph: "3b", f(c, i, x) {
      if (i < 2) return null; const a = c[i - 2], b = c[i - 1], d = c[i];
      if (!(bear(a) && bear(b) && bear(d))) return null;
      if (!(b.c < a.c && d.c < b.c && b.o < a.o && d.o < b.o)) return null;
      if ([a, b, d].some((k) => body(k) < x.avgBody(i) * 0.7 || loSh(k) > body(k) * 0.6)) return null;
      return { dir: -1 };
    }},
    { name: "Bullish Engulfing", n: 2, base: 58, glyph: "be", f(c, i, x) {
      if (i < 1) return null; const p = c[i - 1], k = c[i];
      if (!(bear(p) && bull(k))) return null;
      if (!(k.o <= p.c && k.c >= p.o && body(k) > body(p) * 1.05)) return null;
      if (body(k) < x.avgBody(i) * 0.8) return null;
      return { dir: 1 };
    }},
    { name: "Bearish Engulfing", n: 2, base: 58, glyph: "bre", f(c, i, x) {
      if (i < 1) return null; const p = c[i - 1], k = c[i];
      if (!(bull(p) && bear(k))) return null;
      if (!(k.o >= p.c && k.c <= p.o && body(k) > body(p) * 1.05)) return null;
      if (body(k) < x.avgBody(i) * 0.8) return null;
      return { dir: -1 };
    }},
    { name: "Piercing Line", n: 2, base: 55, glyph: "pl", f(c, i, x) {
      if (i < 1) return null; const p = c[i - 1], k = c[i];
      if (!(bear(p) && bull(k))) return null;
      if (!(k.o < p.l && k.c > mid(p) && k.c < p.o)) return null;
      return { dir: 1 };
    }},
    { name: "Dark Cloud Cover", n: 2, base: 55, glyph: "dc", f(c, i, x) {
      if (i < 1) return null; const p = c[i - 1], k = c[i];
      if (!(bull(p) && bear(k))) return null;
      if (!(k.o > p.h && k.c < mid(p) && k.c > p.o)) return null;
      return { dir: -1 };
    }},
    { name: "Tweezer Bottom", n: 2, base: 52, glyph: "tb", f(c, i, x) {
      if (i < 1) return null; const p = c[i - 1], k = c[i];
      if (Math.abs(p.l - k.l) > range(k) * 0.1) return null;
      if (!(bear(p) && bull(k))) return null;
      if (x.legInto(c, i) >= 0) return null;
      return { dir: 1 };
    }},
    { name: "Tweezer Top", n: 2, base: 52, glyph: "tt", f(c, i, x) {
      if (i < 1) return null; const p = c[i - 1], k = c[i];
      if (Math.abs(p.h - k.h) > range(k) * 0.1) return null;
      if (!(bull(p) && bear(k))) return null;
      if (x.legInto(c, i) <= 0) return null;
      return { dir: -1 };
    }},
    { name: "Bullish Harami", n: 2, base: 48, glyph: "bh", f(c, i, x) {
      if (i < 1) return null; const p = c[i - 1], k = c[i];
      if (!(bear(p) && body(p) > x.avgBody(i))) return null;
      if (!(Math.max(k.o, k.c) < p.o && Math.min(k.o, k.c) > p.c)) return null;
      return { dir: 1 };
    }},
    { name: "Bearish Harami", n: 2, base: 48, glyph: "brh", f(c, i, x) {
      if (i < 1) return null; const p = c[i - 1], k = c[i];
      if (!(bull(p) && body(p) > x.avgBody(i))) return null;
      if (!(Math.max(k.o, k.c) < p.c && Math.min(k.o, k.c) > p.o)) return null;
      return { dir: -1 };
    }},
    { name: "Hammer", n: 1, base: 55, glyph: "hm", f(c, i, x) {
      const k = c[i];
      if (!(loSh(k) >= body(k) * 2 && upSh(k) <= body(k) * 0.6 && body(k) <= range(k) * 0.35)) return null;
      if (x.legInto(c, i) >= 0 && x.trend(i).dir > 0) return null;  // hammer needs a decline into it
      return { dir: 1 };
    }},
    { name: "Hanging Man", n: 1, base: 46, glyph: "hgm", f(c, i, x) {
      const k = c[i];
      if (!(loSh(k) >= body(k) * 2 && upSh(k) <= body(k) * 0.6 && body(k) <= range(k) * 0.35)) return null;
      if (!(x.legInto(c, i) > 0 || x.trend(i).dir > 0)) return null; // same shape, after an advance
      return { dir: -1 };
    }},
    { name: "Shooting Star", n: 1, base: 55, glyph: "ss", f(c, i, x) {
      const k = c[i];
      if (!(upSh(k) >= body(k) * 2 && loSh(k) <= body(k) * 0.6 && body(k) <= range(k) * 0.35)) return null;
      if (!(x.legInto(c, i) > 0 || x.trend(i).dir > 0)) return null;
      return { dir: -1 };
    }},
    { name: "Dragonfly Doji", n: 1, base: 45, glyph: "dd", f(c, i, x) {
      const k = c[i];
      if (!(body(k) <= range(k) * 0.08 && loSh(k) >= range(k) * 0.6 && upSh(k) <= range(k) * 0.15)) return null;
      return { dir: 1 };
    }},
    { name: "Gravestone Doji", n: 1, base: 45, glyph: "gd", f(c, i, x) {
      const k = c[i];
      if (!(body(k) <= range(k) * 0.08 && upSh(k) >= range(k) * 0.6 && loSh(k) <= range(k) * 0.15)) return null;
      return { dir: -1 };
    }},
    { name: "Doji", n: 1, base: 35, glyph: "dj", f(c, i, x) {
      const k = c[i];
      if (!(body(k) <= range(k) * 0.07 && range(k) > (x.atrArr[i] || range(k)) * 0.4)) return null;
      return { dir: 0 };
    }},
    { name: "Marubozu", n: 1, base: 50, glyph: "mb", f(c, i, x) {
      const k = c[i];
      if (!(body(k) >= range(k) * 0.92 && body(k) > x.avgBody(i) * 1.2)) return null;
      return { dir: bull(k) ? 1 : -1 };
    }},
    { name: "Pin Bar", n: 1, base: 56, glyph: "pb", f(c, i, x) {
      const k = c[i];
      const lo = loSh(k), up = upSh(k), b = body(k), r = range(k);
      if (lo >= r * 0.66 && b <= r * 0.25 && up <= r * 0.2) return x.legInto(c, i) <= 0 ? { dir: 1 } : null;
      if (up >= r * 0.66 && b <= r * 0.25 && lo <= r * 0.2) return x.legInto(c, i) >= 0 ? { dir: -1 } : null;
      return null;
    }},
    { name: "Outside Bar", n: 2, base: 44, glyph: "ob", f(c, i, x) {
      if (i < 1) return null; const p = c[i - 1], k = c[i];
      if (!(k.h > p.h && k.l < p.l)) return null;
      if (body(k) < x.avgBody(i) * 0.6) return null;
      return { dir: bull(k) ? 1 : -1 };
    }},
    { name: "Inside Bar", n: 2, base: 42, glyph: "ib", f(c, i, x) {
      if (i < 1) return null; const p = c[i - 1], k = c[i];
      if (!(k.h < p.h && k.l > p.l)) return null;
      return { dir: 0 };
    }},
  ];

  /* Suppress noisy duplicates: when several fire on the same candle, keep the
     most specific (3-candle > 2-candle > 1-candle), highest base first. */
  function detectAt(c, i, x) {
    const hits = [];
    for (const d of DETECTORS) {
      const r = d.f(c, i, x);
      if (r) hits.push({ name: d.name, dir: r.dir, base: d.base, candles: d.n, glyph: d.glyph, i });
    }
    hits.sort((a, b) => b.candles - a.candles || b.base - a.base);
    return hits;
  }

  function detectAll(c) {
    if (!c || c.length < 10) return [];
    const closes = c.map((k) => k.c);
    const atrArr = PA_MATH.atr(c, 14);
    const e20 = PA_MATH.ema(closes, 20), e50 = PA_MATH.ema(closes, 50);
    const pre = { closes, e20, e50 };
    const bodies = c.map((k) => Math.abs(k.c - k.o));
    const trendCache = {};
    const x = {
      atrArr,
      avgBody: (i) => {
        const w = bodies.slice(Math.max(0, i - 14), i);
        return w.length ? w.reduce((a, b) => a + b, 0) / w.length : bodies[i] || 1e-9;
      },
      trend: (i) => (trendCache[i] ??= PA_STRUCT.trendAt(c, i, pre)),
      legInto: (cc, i, n) => PA_STRUCT.legInto(cc, i, n),
    };
    const out = [];
    const lastByName = {};
    for (let i = 5; i < c.length; i++) {
      const hits = detectAt(c, i, x);
      if (!hits.length) continue;
      const primary = hits[0];
      /* refractory window: the same pattern re-printing within a few bars of a
         sustained run is one event, not many (3-candle runs get a wider gap) */
      const gap = primary.candles >= 3 ? 4 : 2;
      const prev = lastByName[primary.name];
      if (prev != null && i - prev <= gap) { lastByName[primary.name] = i; continue; }
      lastByName[primary.name] = i;
      out.push(primary);
    }
    return out;
  }

  return { detectAll, detectAt, DETECTORS };
})();

/* ── PA_SCORE · confluence engine ────────────────────────────────────────
   Never evaluates a candlestick in isolation:
   Pattern + Trend + Structure + S/R + EMA alignment + Momentum + Volume + Confirmation */
const PA_SCORE = {
  analyze(c, patterns) {
    if (!c || c.length < 20) return [];
    const closes = c.map((k) => k.c);
    const e20 = PA_MATH.ema(closes, 20), e50 = PA_MATH.ema(closes, 50), e200 = PA_MATH.ema(closes, 200);
    const rsi = PA_MATH.rsi(closes), macd = PA_MATH.macd(closes), atr = PA_MATH.atr(c, 14);
    const pre = { closes, e20, e50 };
    const levels = PA_STRUCT.levels(c);
    const avgVol = PA_MATH.sma(c.map((k) => k.v || 0), 20);

    return patterns.map((p) => {
      const i = p.i, k = c[i], px = k.c;
      const trend = PA_STRUCT.trendAt(c, i, pre);
      const factors = [];
      let score = p.base;
      const bullish = p.dir > 0, bearish = p.dir < 0;

      // 1 · Trend context (with-trend continuation, or reversal after a genuine leg)
      const leg = PA_STRUCT.legInto(c, i, 6);
      if (bullish && trend.dir > 0) { score += 10; factors.push({ ok: true, t: `With-trend signal — ${trend.label.toLowerCase()} favours upside continuation` }); }
      else if (bearish && trend.dir < 0) { score += 10; factors.push({ ok: true, t: `With-trend signal — ${trend.label.toLowerCase()} favours downside continuation` }); }
      else if (bullish && leg < 0) { score += 8; factors.push({ ok: true, t: "Reversal context — pattern formed after a measurable decline" }); }
      else if (bearish && leg > 0) { score += 8; factors.push({ ok: true, t: "Reversal context — pattern formed after a measurable advance" }); }
      else factors.push({ ok: false, t: "Trend context weak — signal fires inside a range without a clear leg into it" });

      // 2 · Structure: proximity to a horizontal S/R level (within 1.2 ATR)
      const a = atr[i] || px * 0.02;
      const near = levels.filter((l) => Math.abs(l.price - px) <= a * 1.2);
      const sup = near.find((l) => l.price <= px), res = near.find((l) => l.price >= px);
      if (bullish && sup) { score += 12; factors.push({ ok: true, t: `Formed at horizontal support ~${sup.price.toFixed(2)} (${sup.touches} touches)` }); }
      else if (bearish && res) { score += 12; factors.push({ ok: true, t: `Formed at horizontal resistance ~${res.price.toFixed(2)} (${res.touches} touches)` }); }
      else factors.push({ ok: false, t: "No key horizontal level within 1.2×ATR — signal lacks a structural anchor" });

      // 3 · EMA alignment (20/50 as dynamic S/R, 200 as regime)
      const emaOk = bullish
        ? e20[i] != null && e50[i] != null && px > e20[i] && e20[i] > e50[i]
        : e20[i] != null && e50[i] != null && px < e20[i] && e20[i] < e50[i];
      const regimeOk = e200[i] == null ? null : bullish ? px > e200[i] : px < e200[i];
      if (emaOk) { score += 8; factors.push({ ok: true, t: bullish ? "EMA stack aligned — price > EMA20 > EMA50 (dynamic support)" : "EMA stack aligned — price < EMA20 < EMA50 (dynamic resistance)" }); }
      else factors.push({ ok: false, t: "EMA 20/50 not aligned with the signal direction" });
      if (regimeOk === true) { score += 4; factors.push({ ok: true, t: bullish ? "Above the 200-EMA — long-term regime supportive" : "Below the 200-EMA — long-term regime supportive" }); }
      else if (regimeOk === false) { score -= 4; factors.push({ ok: false, t: "Signal fights the 200-EMA regime" }); }

      // 4 · Momentum: RSI position + MACD histogram turn
      const r = rsi[i], h0 = macd.hist[i], h1 = macd.hist[i - 1];
      if (bullish && r != null && r < 45 && (h0 != null && h1 != null && h0 > h1)) { score += 8; factors.push({ ok: true, t: `Momentum turning — RSI ${r.toFixed(0)} recovering, MACD histogram rising` }); }
      else if (bearish && r != null && r > 55 && (h0 != null && h1 != null && h0 < h1)) { score += 8; factors.push({ ok: true, t: `Momentum rolling over — RSI ${r.toFixed(0)}, MACD histogram falling` }); }
      else if (r != null && ((bullish && r > 70) || (bearish && r < 30))) { score -= 6; factors.push({ ok: false, t: `RSI ${r.toFixed(0)} already stretched against the signal` }); }
      else factors.push({ ok: false, t: "Momentum neutral — RSI/MACD add no confirmation yet" });

      // 5 · Volume conviction
      const v = k.v || 0, av = avgVol[i];
      if (av && v >= av * 1.3) { score += 8; factors.push({ ok: true, t: `Volume conviction — ${(v / av).toFixed(1)}× the 20-bar average on the signal candle` }); }
      else if (av && v <= av * 0.6) { score -= 4; factors.push({ ok: false, t: "Thin volume — participation does not back the candle" }); }
      else factors.push({ ok: false, t: "Volume unremarkable versus its 20-bar average" });

      // 6 · Confirmation candle (close beyond the pattern extreme)
      const nxt = c[i + 1];
      let confirmed = null;
      if (nxt) {
        confirmed = bullish ? nxt.c > k.h : bearish ? nxt.c < k.l : null;
        if (confirmed === true) { score += 6; factors.push({ ok: true, t: "Confirmed — the following close broke the pattern extreme" }); }
        else if (confirmed === false) factors.push({ ok: false, t: "Not yet confirmed by a close beyond the pattern extreme" });
      } else factors.push({ ok: false, t: "Awaiting confirmation — pattern is on the live candle" });

      score = Math.max(15, Math.min(95, Math.round(score)));
      const strength = score >= 72 ? "Strong" : score >= 55 ? "Moderate" : "Weak";
      const kl = { sup: sup?.price ?? null, res: res?.price ?? null };
      return { ...p, score, strength, trend, factors, confirmed, atr: a, keyNear: kl,
        stop: bullish ? k.l - a * 0.35 : bearish ? k.h + a * 0.35 : null,
        t: k.t, o: k.o, h: k.h, l: k.l, cl: k.c, v: k.v };
    });
  },

  /* symbol-level bias from trend + last few scored patterns */
  bias(c, scored) {
    const trend = PA_STRUCT.trendAt(c);
    let s = trend.dir * 18;
    for (const p of scored.slice(-5)) s += p.dir * (p.score / 100) * 14;
    const closes = c.map((k) => k.c);
    const r = PA_MATH.rsi(closes).at(-1);
    if (r != null) s += (r - 50) / 4;
    const label = s > 22 ? "Strong Bullish Bias" : s > 8 ? "Bullish Bias" : s < -22 ? "Strong Bearish Bias" : s < -8 ? "Bearish Bias" : "Neutral Bias";
    return { score: Math.round(s), label, cls: s > 8 ? "up" : s < -8 ? "down" : "flat", trend };
  },
};

/* ── PA_KB · educational knowledge base ─────────────────────────────────
   Original explanations built on classical candlestick theory: anatomy,
   crowd psychology, where the signal is valid/invalid, common mistakes,
   confirmation discipline. No text reproduced from any source. */
const PA_KB = {
  _base: {
    reversalNote: "Reversal candles only carry meaning after a genuine directional leg. The same shape printed mid-range is noise.",
    confirmNote: "Professionals treat the pattern as an alert, not an order: they demand a close beyond the pattern extreme, or a retest that holds, before committing risk.",
  },
  "Bullish Engulfing": {
    type: "Bullish reversal (2 candles)",
    anatomy: "A down candle followed by an up candle whose real body opens at or below the prior close and closes above the prior open — the second body completely swallows the first.",
    psychology: "Sellers finish the first candle in control. The next session opens weak, yet buyers absorb all available supply and drive price through the entire prior day's range. Everyone who sold the first candle is underwater by the close — their covering becomes fuel.",
    valid: "After a measurable decline, at horizontal support or a rising 20/50-EMA, ideally with expanding volume.",
    invalid: "Inside a tight range, against a strong downtrend with no supporting level, or on shrinking volume.",
    mistakes: "Buying every engulfing candle regardless of location; ignoring that a huge engulfing bar far from support often exhausts, rather than starts, a move.",
    confirmation: "A following close above the engulfing high, or a shallow retest of its midpoint that holds.",
  },
  "Bearish Engulfing": {
    type: "Bearish reversal (2 candles)",
    anatomy: "An up candle followed by a down candle whose body opens at or above the prior close and closes below the prior open, engulfing the previous body entirely.",
    psychology: "Buyers own the first candle. The second opens firm, then supply overwhelms demand and price closes below the entire prior body — late buyers are trapped at the highs and their exits accelerate the fall.",
    valid: "After an advance into horizontal resistance or a declining 20/50-EMA, with volume expansion.",
    invalid: "In a quiet range, or against a strong uptrend with no overhead level nearby.",
    mistakes: "Shorting the signal in a powerful uptrend without structure overhead; sizing up before any confirming close.",
    confirmation: "A following close below the engulfing low.",
  },
  "Morning Star": {
    type: "Bullish reversal (3 candles)",
    anatomy: "A strong down candle, then a small-bodied pause (the star) marking indecision, then a strong up candle closing above the midpoint of the first.",
    psychology: "Sellers dominate, then stall — the tiny middle body shows their pressure has run out of participants. The third candle confirms buyers have wrestled control, closing deep into the earlier loss.",
    valid: "At the end of a decline, best at tested support, and stronger when the third candle carries above-average volume.",
    invalid: "Mid-range, or when the third candle is feeble and closes below the first candle's midpoint.",
    mistakes: "Calling any three-candle wobble a morning star; the middle body must be genuinely small and the third close genuinely deep.",
    confirmation: "Close above the star's high, ideally reclaiming the 20-EMA.",
  },
  "Evening Star": {
    type: "Bearish reversal (3 candles)",
    anatomy: "A strong up candle, a small-bodied stall, then a strong down candle closing below the midpoint of the first.",
    psychology: "The advance climaxes, the stall shows demand exhausting at altitude, and the third candle proves supply has taken over — late longs from the first candle are now trapped.",
    valid: "After an extended advance into resistance; a volume spike on the third candle strengthens it.",
    invalid: "In sideways chop or early in a fresh uptrend.",
    mistakes: "Fading strong trends on the star alone without an overhead level or momentum roll-over.",
    confirmation: "Close below the star's low.",
  },
  "Hammer": {
    type: "Bullish reversal (1 candle)",
    anatomy: "A small body near the top of the range with a lower shadow at least twice the body — price plunged intrabar and was bought back up.",
    psychology: "Sellers drive price sharply lower during the session, but buyers reject the discount so violently that the close returns near the open. The long tail maps exactly where demand lives.",
    valid: "Only after a decline, ideally tagging support or a rising long-term EMA. The deeper the prior leg, the more meaningful the rejection.",
    invalid: "After an advance (that same shape is a Hanging Man) or floating mid-range.",
    mistakes: "Treating the low of the tail as safe — a close below it invalidates the whole story; entering before any confirming strength.",
    confirmation: "A following close above the hammer's high; stop logically sits just beneath the tail.",
  },
  "Hanging Man": {
    type: "Bearish warning (1 candle)",
    anatomy: "Identical shape to a hammer — small body on top, long lower shadow — but printed after an advance.",
    psychology: "For the first time in the rally, sellers were able to push price sharply lower intrabar. Buyers rescued the close, yet the ease of the sell-off exposes soft demand under the market.",
    valid: "After a sustained advance, especially at resistance; needs bearish follow-through to matter.",
    invalid: "After declines (that context makes it a hammer) or without a next-candle breakdown.",
    mistakes: "Shorting it immediately — statistically it needs confirmation more than most signals.",
    confirmation: "A following close below the hanging man's low.",
  },
  "Shooting Star": {
    type: "Bearish reversal (1 candle)",
    anatomy: "A small body near the lows with an upper shadow at least twice the body — an intrabar rally that was sold back down.",
    psychology: "Buyers spike price into the sky; supply slams it back to earth before the close. The long upper wick marks precisely where sellers are camped.",
    valid: "After an advance, best when the wick probes a known resistance zone.",
    invalid: "After declines (an inverted hammer context) or deep inside a range.",
    mistakes: "Ignoring wick location — a shooting star whose wick never reaches any level says little.",
    confirmation: "A following close below the star's low.",
  },
  "Doji": {
    type: "Indecision (1 candle)",
    anatomy: "Open and close virtually equal — a cross or plus shape whose shadows can extend either side.",
    psychology: "Total stalemate: every push by one side is fully answered by the other. After a long trend it hints the driving side is losing conviction; inside a range it is routine noise.",
    valid: "As a caution flag at trend extremes or key levels — an exit or tighten-stops cue, sometimes an entry when combined with structure.",
    invalid: "As a standalone entry signal; dojis are frequent and mostly meaningless without context.",
    mistakes: "Trading every doji; a doji is a question the next candle answers.",
    confirmation: "Direction of the next decisive close.",
  },
  "Dragonfly Doji": {
    type: "Bullish indecision→reversal (1 candle)",
    anatomy: "Open, high and close clustered together with a long lower tail — a doji whose whole range sits below the close.",
    psychology: "Sellers controlled the session until buyers reclaimed every point of it. The tail is a rejection map of the demand zone beneath.",
    valid: "At support after a decline — the level plus the rejection makes the case.",
    invalid: "At highs or mid-range where the tail touches nothing meaningful.",
    mistakes: "Confusing it with a hammer trade without checking body size — the doji version signals indecision resolving, so confirmation matters even more.",
    confirmation: "A following close above the doji's high.",
  },
  "Gravestone Doji": {
    type: "Bearish indecision→reversal (1 candle)",
    anatomy: "Open, low and close clustered with a long upper tail — the inverse of the dragonfly.",
    psychology: "Buyers spent the session pushing higher and surrendered all of it — an auction that found only sellers above.",
    valid: "At resistance after an advance.",
    invalid: "At lows or in quiet ranges.",
    mistakes: "Shorting far from resistance because the shape looks dramatic.",
    confirmation: "A following close below the doji's low.",
  },
  "Bullish Harami": {
    type: "Bullish reversal (2 candles)",
    anatomy: "A large down candle followed by a small body contained entirely inside it — the market's range contracts sharply.",
    psychology: "After heavy selling, the inability to make any downside progress signals the selling wave has stalled; shorts begin to cover into the vacuum.",
    valid: "After a decline, especially at support; stronger when the inside candle closes green.",
    invalid: "Mid-trend where contraction is routine consolidation.",
    mistakes: "Expecting instant reversal — haramis mark loss of momentum, not an immediate turn.",
    confirmation: "A close above the large candle's midpoint, then its open.",
  },
  "Bearish Harami": {
    type: "Bearish reversal (2 candles)",
    anatomy: "A large up candle followed by a small body inside it.",
    psychology: "The advance abruptly loses breadth — buyers who chased the big candle see no follow-through, and their exits start the slide.",
    valid: "After an advance at resistance.",
    invalid: "Inside consolidations.",
    mistakes: "Shorting the harami inside a strong uptrend without structure overhead.",
    confirmation: "A close below the large candle's midpoint.",
  },
  "Piercing Line": {
    type: "Bullish reversal (2 candles)",
    anatomy: "A down candle, then an up candle that opens below the prior low and closes above the prior body's midpoint (but below its open).",
    psychology: "A gap-down open panics remaining longs out; buyers absorb the flush and drive the close more than halfway back — the deeper the pierce, the stronger the statement.",
    valid: "After declines at support; the open below the prior low is the key trap element.",
    invalid: "When the second close fails to reach the midpoint — that's a weak 'thrusting' candle, not a piercing line.",
    mistakes: "Accepting shallow closes; the midpoint rule is the pattern.",
    confirmation: "A following close above the second candle's high.",
  },
  "Dark Cloud Cover": {
    type: "Bearish reversal (2 candles)",
    anatomy: "An up candle, then a down candle opening above the prior high and closing below the prior body's midpoint.",
    psychology: "A gap-up open sucks in breakout buyers; supply then drives price down through more than half the prior gains, trapping them all.",
    valid: "After advances at resistance.",
    invalid: "Shallow closes above the midpoint; ranges.",
    mistakes: "Shorting before the midpoint rule is genuinely met.",
    confirmation: "A following close below the second candle's low.",
  },
  "Tweezer Bottom": {
    type: "Bullish reversal (2 candles)",
    anatomy: "Two adjacent candles printing matching lows — typically a down candle then an up candle rejecting the identical price.",
    psychology: "The market tests the same floor twice in immediate succession and is refused both times — a double-tap proof of resting demand.",
    valid: "At established support after a decline.",
    invalid: "Matching lows mid-range carry little information.",
    mistakes: "Requiring exact tick equality — a whisker of tolerance is normal.",
    confirmation: "A close above the pair's high.",
  },
  "Tweezer Top": {
    type: "Bearish reversal (2 candles)",
    anatomy: "Two adjacent candles printing matching highs.",
    psychology: "Two consecutive attempts to clear the same ceiling fail at the identical price — supply is stacked there.",
    valid: "At resistance after an advance.",
    invalid: "Mid-range noise.",
    mistakes: "Ignoring the trend leg into the pattern.",
    confirmation: "A close below the pair's low.",
  },
  "Marubozu": {
    type: "Conviction / continuation (1 candle)",
    anatomy: "A full-bodied candle with virtually no shadows — open at one extreme, close at the other.",
    psychology: "One side controlled the entire session without a single meaningful counter-attack. It is the purest single-bar statement of conviction.",
    valid: "As trend confirmation, or as a breakout bar through a level; direction of the body is the message.",
    invalid: "As a reversal call — a marubozu into major opposing structure often marks exhaustion instead.",
    mistakes: "Chasing an extended marubozu far from any base; entries improve on partial retracement.",
    confirmation: "Follow-through in the body's direction; failure to follow through warns of a climax.",
  },
  "Three White Soldiers": {
    type: "Bullish reversal/continuation (3 candles)",
    anatomy: "Three consecutive strong up candles, each opening within the prior body and closing at fresh highs with small upper shadows.",
    psychology: "Demand returns in waves — every dip is bought at progressively higher prices across three sessions. It is a structural change in behaviour, not one emotional bar.",
    valid: "Emerging from a base or after a decline; early in a move.",
    invalid: "After a long advance, where three big greens often complete, not start, the move.",
    mistakes: "Buying the third candle's close when the pattern is already stretched — wait for the first pullback.",
    confirmation: "A shallow pullback that holds above the first soldier's open.",
  },
  "Three Black Crows": {
    type: "Bearish reversal/continuation (3 candles)",
    anatomy: "Three consecutive strong down candles, each opening inside the prior body and closing at fresh lows.",
    psychology: "Supply arrives in waves; every bounce is sold lower for three straight sessions — distribution has become methodical.",
    valid: "Cracking down from a top or a broken support shelf.",
    invalid: "After a long decline, where they can climax the sell-off.",
    mistakes: "Shorting deeply extended crows into support.",
    confirmation: "A weak bounce that fails below the first crow's open.",
  },
  "Inside Bar": {
    type: "Consolidation / breakout setup (2 candles)",
    anatomy: "A candle whose entire range sits inside the prior candle's range — the 'mother bar'.",
    psychology: "Volatility compresses as both sides pause; energy stores inside the mother bar's extremes, which become the breakout tripwires.",
    valid: "With the trend after an impulsive leg (continuation), or at major levels as a coiled reversal.",
    invalid: "Strings of inside bars in dead, directionless tape.",
    mistakes: "Trading the break of the inside bar instead of the mother bar; ignoring false-break risk — the first break often traps.",
    confirmation: "A decisive close beyond the mother bar's high or low; the opposite extreme defines the stop.",
  },
  "Outside Bar": {
    type: "Volatility expansion (2 candles)",
    anatomy: "A candle that takes out both the prior high and prior low, closing decisively in one direction.",
    psychology: "Both sides get stopped out intrabar; whoever owns the close owns the initiative. It is an engulfing pattern measured on full ranges rather than bodies.",
    valid: "At key levels where the sweep flushes stops before the true move.",
    invalid: "In thin, gappy tape where wide ranges are routine.",
    mistakes: "Fading the close direction; the close is the verdict.",
    confirmation: "Follow-through beyond the outside bar's extreme in the close's direction.",
  },
  "Pin Bar": {
    type: "Rejection reversal (1 candle)",
    anatomy: "A prominent nose (tail) of at least two-thirds of the range with the body tucked at the opposite end — the generalised hammer/shooting-star.",
    psychology: "Price aggressively auctions into a zone and is thrown back out. The tail is a receipt of rejected prices; the market has voted those levels wrong.",
    valid: "Tail probing a horizontal level, trendline or key EMA, in line with (or reversing into) the higher-timeframe direction.",
    invalid: "Mid-range pins whose tails touch nothing; short-tailed impostors.",
    mistakes: "Entering at the close without a plan for the 50% retrace of the pin, which is a common better entry.",
    confirmation: "A close beyond the pin's body-side extreme, or a 50%-of-pin limit fill that holds.",
  },
};

/* ── PA_AI · institutional commentary generator ─────────────────────────
   Deterministic narrative builder combining pattern + measured context.
   Every claim traces to a computed input. */
const PA_AI = {
  fmtPx(v) { return v == null ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
  dirWord(d) { return d > 0 ? "bullish" : d < 0 ? "bearish" : "neutral"; },

  overview(p, sym) {
    const kb = PA_KB[p.name] || {};
    const conf = p.confirmed === true ? "and has been confirmed by a close beyond its extreme" : p.confirmed === false ? "but is not yet confirmed by a follow-through close" : "and is awaiting its confirmation candle";
    return `A ${p.strength.toLowerCase()} ${this.dirWord(p.dir)} ${p.name} has printed on ${sym} within a ${p.trend.label.toLowerCase()} (${p.trend.detail}). The signal scores ${p.score}/100 on the confluence engine ${conf}. ${kb.type || ""}.`;
  },

  psychology(p) {
    const kb = PA_KB[p.name] || {};
    const side = p.dir > 0 ? "Buyers" : p.dir < 0 ? "Sellers" : "Neither side";
    return `${kb.psychology || ""} In this instance the candle closed at ${this.fmtPx(p.cl)} on a ${this.fmtPx(p.h)}–${this.fmtPx(p.l)} range. ${side} ${p.dir === 0 ? "controls the tape yet" : "held the close, which is the session's verdict"}.`;
  },

  context(p) {
    const bits = [];
    bits.push(`Trend engine reads ${p.trend.label} (${p.trend.detail}).`);
    if (p.keyNear.sup != null) bits.push(`The pattern printed on horizontal support near ${this.fmtPx(p.keyNear.sup)} — the structural anchor for the long case.`);
    if (p.keyNear.res != null) bits.push(`Overhead resistance sits near ${this.fmtPx(p.keyNear.res)}, the level the move must contend with.`);
    if (p.keyNear.sup == null && p.keyNear.res == null) bits.push(`No major horizontal level lies within 1.2×ATR — the signal is structurally unanchored, which caps its reliability.`);
    bits.push(`ATR(14) is ${this.fmtPx(p.atr)}, framing normal noise; stops inside that band are donations.`);
    return bits.join(" ");
  },

  checklist(p) {
    return p.factors.map((f) => ({ ok: f.ok, t: f.t }));
  },

  strategy(p) {
    if (p.dir === 0) return `Indecision patterns are not entries. The professional play is patience: let the next decisive close pick the direction, then treat that close as the signal with this candle's extremes as the trigger lines (${this.fmtPx(p.h)} above, ${this.fmtPx(p.l)} below).`;
    const long = p.dir > 0;
    const trigger = long ? p.h : p.l;
    const stop = p.stop;
    const t1 = long ? (p.keyNear.res ?? p.cl + p.atr * 2) : (p.keyNear.sup ?? p.cl - p.atr * 2);
    const rr = stop != null ? Math.abs(t1 - trigger) / Math.abs(trigger - stop) : null;
    return `${long ? "Long" : "Short"} setup — aggressive entry at the close (${this.fmtPx(p.cl)}), conservative entry on a ${long ? "break above" : "break below"} ${this.fmtPx(trigger)}. Protective stop beyond the pattern extreme at ${this.fmtPx(stop)} (0.35×ATR buffer). First objective: the nearest opposing structure at ${this.fmtPx(t1)}${rr ? ` — roughly ${rr.toFixed(1)}R from the conservative trigger` : ""}. Scale or trail beyond it; never widen the stop.`;
  },

  risk(p) {
    const inval = p.dir > 0 ? `a close below ${this.fmtPx(p.stop)}` : p.dir < 0 ? `a close above ${this.fmtPx(p.stop)}` : `a decisive close against the eventual breakout direction`;
    return `Invalidation is ${inval} — beyond that point the pattern's premise is simply wrong and the trade must be closed without negotiation. Risk a fixed fraction of capital (professional practice: 1–2% per idea) sized off the stop distance, not off conviction. Expect the setup to fail roughly ${p.score >= 72 ? "1 time in 3" : p.score >= 55 ? "1 time in 2" : "more often than it works"} — the edge lives in the asymmetry of the payoff, not in being right.`;
  },

  scenarios(p) {
    if (p.dir === 0) return [`Break and close above ${this.fmtPx(p.h)} resolves the indecision upward.`, `Break and close below ${this.fmtPx(p.l)} resolves it downward.`, `Continued small bodies extend the pause — stand aside.`];
    const long = p.dir > 0;
    return [
      `Base case (${p.score}%-weighted): ${long ? "continuation higher toward" : "continuation lower toward"} ${this.fmtPx(long ? (p.keyNear.res ?? p.cl + 2 * p.atr) : (p.keyNear.sup ?? p.cl - 2 * p.atr))} while the pattern extreme holds.`,
      `Retest case: price pulls back to the ${long ? "midpoint of the signal candle" : "midpoint of the signal candle"} (~${this.fmtPx((p.h + p.l) / 2)}) then resumes — often the superior entry.`,
      `Failure case: ${long ? "a close back below" : "a close back above"} ${this.fmtPx(p.stop)} traps the breakout crowd and typically travels fast the other way.`,
    ];
  },

  reliability(p) {
    const passed = p.factors.filter((f) => f.ok).length;
    return `Confluence: ${passed}/${p.factors.length} factors aligned → ${p.score}/100 (${p.strength}). Base pattern reliability contributes ${p.base}; trend, structure, EMA alignment, momentum, volume and confirmation adjust the balance. Signals below 55 are observation-only; 55–71 need conservative triggers; 72+ justify normal size.`;
  },
};

/* ── PAChart · interactive candlestick chart (canvas) ─────────────────────
   Zoom (wheel) · pan (drag) · crosshair + OHLC readout · volume pane ·
   momentum sub-panel · overlays (EMA/VWAP/BB/Supertrend/Ichimoku/S&R/auto-
   trendlines) · pattern markers with hover/click · user drawing tools. */
class PAChart {
  constructor(canvas, opts = {}) {
    this.cv = canvas; this.ctx = canvas.getContext("2d");
    this.opts = opts;
    this.c = [];                    // candles
    this.marks = [];                // scored patterns
    this.view = { i0: 0, i1: 0 };   // visible index window (inclusive)
    this.overlays = { ema20: true, ema50: true, ema100: false, ema200: false, vwap: false, bb: false, st: false, ichi: false, sr: true, tl: true };
    this.momentum = "rsi";          // one at a time (PRD §6) — or "" for none
    this.cross = null;              // {x,y,i}
    this.hoverMark = null;
    this.focusI = null; this.focusUntil = 0;
    this.drawMode = "";             // "", "trend", "hline"
    this.drawings = [];             // {kind:"trend",a:{i,p},b:{i,p}} | {kind:"hline",p}
    this._pendingPt = null;
    this.pad = { l: 8, r: 62, t: 10, b: 22 };
    this._bind();
  }

  setData(candles, meta = {}) {
    this.c = candles || [];
    this.meta = meta;
    this._computeSeries();
    const n = this.c.length;
    const show = Math.min(n, this.opts.initialBars || 160);
    this.view = { i0: Math.max(0, n - show), i1: Math.max(0, n - 1) };
    this.cross = null; this.hoverMark = null;
    this.draw();
  }
  /* Live-update variant of setData: refreshes candles WITHOUT resetting the
     user's view, drawings, overlays or crosshair. If the user was pinned to
     the right edge (watching the live candle), the window follows new bars;
     otherwise their zoom/pan position is left exactly where it was. */
  updateData(candles, meta = {}) {
    const prevView = this.view ? { ...this.view } : null;
    const nOld = this.c ? this.c.length : 0;
    const pinnedRight = !prevView || nOld === 0 || prevView.i1 >= nOld - 1;
    this.c = candles || [];
    this.meta = { ...this.meta, ...meta };
    this._computeSeries();
    const n = this.c.length;
    if (!n) { this.view = { i0: 0, i1: 0 }; this.draw(); return; }
    if (pinnedRight) {
      const span = prevView ? Math.max(1, prevView.i1 - prevView.i0) : Math.min(n - 1, (this.opts.initialBars || 160) - 1);
      this.view = { i0: Math.max(0, n - 1 - span), i1: n - 1 };
    } else {
      // keep the exact window; clamp only if the series shrank
      this.view = { i0: Math.min(prevView.i0, Math.max(0, n - 2)), i1: Math.min(prevView.i1, n - 1) };
    }
    this.draw();
  }
  setMarks(marks) { this.marks = marks || []; this.draw(); }
  setOverlay(key, on) { this.overlays[key] = on; this.draw(); }
  setMomentum(key) { this.momentum = key; this.draw(); }
  setDrawMode(m) { this.drawMode = m; this._pendingPt = null; this.cv.style.cursor = m ? "crosshair" : "default"; }
  clearDrawings() { this.drawings = []; this._pendingPt = null; this.draw(); }

  _computeSeries() {
    const c = this.c; if (!c.length) { this.S = null; return; }
    const closes = c.map((k) => k.c);
    this.S = {
      e20: PA_MATH.ema(closes, 20), e50: PA_MATH.ema(closes, 50),
      e100: PA_MATH.ema(closes, 100), e200: PA_MATH.ema(closes, 200),
      vwap: PA_MATH.vwap(c), bb: PA_MATH.bollinger(closes),
      st: PA_MATH.supertrend(c), ichi: PA_MATH.ichimoku(c),
      rsi: PA_MATH.rsi(closes), macd: PA_MATH.macd(closes),
      adx: PA_MATH.adx(c), atr: PA_MATH.atr(c), obv: PA_MATH.obv(c),
      mfi: PA_MATH.mfi(c), roc: PA_MATH.roc(closes), cci: PA_MATH.cci(c),
      levels: PA_STRUCT.levels(c), swings: PA_STRUCT.swings(c, 3),
    };
  }

  resize() {
    /* Measure the wrap (our positioned parent) rather than the canvas element,
       which has been set to position:absolute and would report the parent's box
       recursively. If the wrap has zero width/height (ancestor hidden, tab not
       yet visible, first paint), we'll re-run when a ResizeObserver fires. */
    const wrap = this.cv.parentElement;
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    if (r.width < 20 || r.height < 20) { this._pendingResize = true; return; }
    this._pendingResize = false;
    const dpr = window.devicePixelRatio || 1;
    this.W = r.width; this.H = r.height;
    this.cv.width = Math.round(this.W * dpr); this.cv.height = Math.round(this.H * dpr);
    this.cv.style.width = this.W + "px"; this.cv.style.height = this.H + "px";
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  /* geometry */
  _zones() {
    const momH = this.momentum ? Math.max(64, this.H * 0.18) : 0;
    const volH = Math.max(34, this.H * 0.11);
    const axH = this.pad.b;
    const priceH = this.H - this.pad.t - volH - momH - axH;
    const x0 = this.pad.l, x1 = this.W - this.pad.r;
    return { x0, x1, price: { y0: this.pad.t, y1: this.pad.t + priceH }, vol: { y0: this.pad.t + priceH, y1: this.pad.t + priceH + volH }, mom: momH ? { y0: this.pad.t + priceH + volH + 6, y1: this.H - axH } : null, axY: this.H - axH };
  }
  _xAt(i, z) { const n = this.view.i1 - this.view.i0 + 1; return z.x0 + ((i - this.view.i0) + 0.5) * ((z.x1 - z.x0) / n); }
  _iAt(x, z) { const n = this.view.i1 - this.view.i0 + 1; return Math.round(this.view.i0 + (x - z.x0) / ((z.x1 - z.x0) / n) - 0.5); }

  _priceRange() {
    const { i0, i1 } = this.view; let lo = Infinity, hi = -Infinity;
    for (let i = i0; i <= i1; i++) { const k = this.c[i]; if (!k) continue; lo = Math.min(lo, k.l); hi = Math.max(hi, k.h); }
    if (this.overlays.sr && this.S) for (const l of this.S.levels) { if (l.price > lo * 0.97 && l.price < hi * 1.03) { lo = Math.min(lo, l.price); hi = Math.max(hi, l.price); } }
    const padv = (hi - lo) * 0.07 || hi * 0.02;
    return { lo: lo - padv, hi: hi + padv };
  }
  _yAt(p, z, pr) { return z.y1 - ((p - pr.lo) / (pr.hi - pr.lo)) * (z.y1 - z.y0); }

  /* interaction */
  _bind() {
    const cv = this.cv;
    let dragging = false, lastX = 0;
    cv.addEventListener("wheel", (e) => {
      if (!this.c.length) return;
      e.preventDefault();
      const z = this._zones();
      const anchorI = Math.max(this.view.i0, Math.min(this.view.i1, this._iAt(e.offsetX, z)));
      const span = this.view.i1 - this.view.i0 + 1;
      const factor = e.deltaY > 0 ? 1.18 : 1 / 1.18;
      let ns = Math.round(Math.max(20, Math.min(this.c.length, span * factor)));
      const frac = (anchorI - this.view.i0) / span;
      let i0 = Math.round(anchorI - frac * ns);
      i0 = Math.max(0, Math.min(this.c.length - ns, i0));
      this.view = { i0, i1: i0 + ns - 1 };
      this.draw();
    }, { passive: false });
    cv.addEventListener("mousedown", (e) => {
      if (this.drawMode) return this._drawClick(e);
      dragging = true; lastX = e.offsetX; cv.style.cursor = "grabbing";
    });
    window.addEventListener("mouseup", () => { dragging = false; if (!this.drawMode) cv.style.cursor = "default"; });
    cv.addEventListener("mousemove", (e) => {
      const z = this._zones();
      if (dragging && this.c.length) {
        const perBar = (z.x1 - z.x0) / (this.view.i1 - this.view.i0 + 1);
        const dI = Math.round((lastX - e.offsetX) / perBar);
        if (dI !== 0) {
          const span = this.view.i1 - this.view.i0;
          let i0 = Math.max(0, Math.min(this.c.length - 1 - span, this.view.i0 + dI));
          this.view = { i0, i1: i0 + span }; lastX = e.offsetX;
        }
      }
      this.cross = { x: e.offsetX, y: e.offsetY, i: Math.max(this.view.i0, Math.min(this.view.i1, this._iAt(e.offsetX, z))) };
      this.hoverMark = this._hitMark(e.offsetX, e.offsetY, z);
      cv.style.cursor = this.drawMode ? "crosshair" : this.hoverMark ? "pointer" : dragging ? "grabbing" : "default";
      this.draw();
    });
    cv.addEventListener("mouseleave", () => { this.cross = null; this.hoverMark = null; this.draw(); });
    cv.addEventListener("click", (e) => {
      if (this.drawMode) return;
      const z = this._zones();
      const m = this._hitMark(e.offsetX, e.offsetY, z);
      if (m && this.opts.onMarkClick) this.opts.onMarkClick(m);
    });
    // touch: basic pan
    let tX = null;
    cv.addEventListener("touchstart", (e) => { tX = e.touches[0].clientX; }, { passive: true });
    cv.addEventListener("touchmove", (e) => {
      if (tX == null || !this.c.length) return;
      const z = this._zones();
      const perBar = (z.x1 - z.x0) / (this.view.i1 - this.view.i0 + 1);
      const dI = Math.round((tX - e.touches[0].clientX) / perBar);
      if (dI) {
        const span = this.view.i1 - this.view.i0;
        let i0 = Math.max(0, Math.min(this.c.length - 1 - span, this.view.i0 + dI));
        this.view = { i0, i1: i0 + span }; tX = e.touches[0].clientX; this.draw();
      }
    }, { passive: true });
  }

  _drawClick(e) {
    const z = this._zones();
    const pr = this._priceRange();
    const i = Math.max(0, Math.min(this.c.length - 1, this._iAt(e.offsetX, z)));
    const p = pr.lo + (1 - (e.offsetY - z.price.y0) / (z.price.y1 - z.price.y0)) * (pr.hi - pr.lo);
    if (this.drawMode === "hline") { this.drawings.push({ kind: "hline", p }); this.draw(); return; }
    if (this.drawMode === "trend") {
      if (!this._pendingPt) { this._pendingPt = { i, p }; }
      else { this.drawings.push({ kind: "trend", a: this._pendingPt, b: { i, p } }); this._pendingPt = null; }
      this.draw();
    }
  }

  _hitMark(x, y, z) {
    if (!this.marks.length) return null;
    const pr = this._priceRange();
    for (const m of this.marks) {
      if (m.i < this.view.i0 || m.i > this.view.i1) continue;
      const mx = this._xAt(m.i, z);
      const k = this.c[m.i];
      const my = m.dir >= 0 ? this._yAt(k.l, z.price, pr) + 12 : this._yAt(k.h, z.price, pr) - 12;
      if (Math.abs(x - mx) < 9 && Math.abs(y - my) < 9) return m;
    }
    return null;
  }

  focus(i) {
    const span = Math.max(40, Math.min(this.c.length, this.view.i1 - this.view.i0 + 1));
    let i0 = Math.max(0, Math.min(this.c.length - span, Math.round(i - span / 2)));
    this.view = { i0, i1: i0 + span - 1 };
    this.focusI = i; this.focusUntil = Date.now() + 2400;
    this.draw();
    const pulse = () => { if (Date.now() < this.focusUntil) { this.draw(); requestAnimationFrame(pulse); } else { this.focusI = null; this.draw(); } };
    requestAnimationFrame(pulse);
  }

  /* rendering */
  draw() {
    const ctx = this.ctx; if (!ctx || !this.W) return;
    const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || "#888";
    const C = { up: "#2e9e6b", dn: "#c84b3c", grid: "rgba(35,42,51,.55)", fg: css("--fg"), mut: css("--muted"), mutInk: css("--muted-ink"), amber: css("--amber-bright"), hair: css("--hairline") };
    ctx.clearRect(0, 0, this.W, this.H);
    if (!this.c.length) {
      ctx.fillStyle = C.mutInk; ctx.font = "11px 'Inter', sans-serif"; ctx.textAlign = "center";
      ctx.fillText("select a company to load candles", this.W / 2, this.H / 2);
      return;
    }
    const z = this._zones(), pr = this._priceRange();
    const n = this.view.i1 - this.view.i0 + 1;
    const bw = Math.max(1.5, Math.min(13, ((z.x1 - z.x0) / n) * 0.66));

    /* grid + y labels */
    ctx.font = "10px 'Inter', sans-serif"; ctx.textAlign = "left";
    const steps = 5;
    for (let s = 0; s <= steps; s++) {
      const p = pr.lo + (s / steps) * (pr.hi - pr.lo);
      const y = this._yAt(p, z.price, pr);
      ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(z.x0, y); ctx.lineTo(z.x1, y); ctx.stroke();
      ctx.fillStyle = C.mutInk; ctx.fillText(this._fmt(p), z.x1 + 6, y + 3);
    }
    /* x labels */
    const tickEvery = Math.max(1, Math.round(n / Math.max(3, Math.floor(this.W / 90))));
    ctx.textAlign = "center"; ctx.fillStyle = C.mutInk;
    for (let i = this.view.i0; i <= this.view.i1; i++) {
      if ((i - this.view.i0) % tickEvery !== 0) continue;
      const d = new Date(this.c[i].t);
      const lbl = n > 260 ? d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" }) : n > 40 ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) + (this._intraday() ? " " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "");
      ctx.fillText(lbl, this._xAt(i, z), this.H - 8);
    }

    /* S/R levels */
    if (this.overlays.sr && this.S) {
      for (const l of this.S.levels.slice(0, 8)) {
        if (l.price < pr.lo || l.price > pr.hi) continue;
        const y = this._yAt(l.price, z.price, pr);
        ctx.strokeStyle = "rgba(200,134,42,.4)"; ctx.setLineDash([5, 4]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(z.x0, y); ctx.lineTo(z.x1, y); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    /* auto trendlines from last swing points */
    if (this.overlays.tl && this.S) this._autoTrendlines(ctx, z, pr, C);

    /* Ichimoku cloud (spans displaced +26) */
    if (this.overlays.ichi && this.S) {
      const { spanA, spanB } = this.S.ichi, disp = 26;
      ctx.beginPath(); let started = false;
      for (let i = this.view.i0; i <= this.view.i1; i++) {
        const j = i - disp; if (j < 0 || spanA[j] == null) continue;
        const x = this._xAt(i, z), y = this._yAt(spanA[j], z.price, pr);
        started ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), started = true);
      }
      for (let i = this.view.i1; i >= this.view.i0; i--) {
        const j = i - disp; if (j < 0 || spanB[j] == null) continue;
        ctx.lineTo(this._xAt(i, z), this._yAt(spanB[j], z.price, pr));
      }
      ctx.closePath(); ctx.fillStyle = "rgba(94,140,180,.10)"; ctx.fill();
      this._line(ctx, z, pr, (i) => { const j = i - disp; return j >= 0 ? this.S.ichi.spanA[j] : null; }, "rgba(46,158,107,.5)", 1);
      this._line(ctx, z, pr, (i) => { const j = i - disp; return j >= 0 ? this.S.ichi.spanB[j] : null; }, "rgba(200,75,60,.5)", 1);
      this._line(ctx, z, pr, (i) => this.S.ichi.tenkan[i], "#5b8fd6", 1);
      this._line(ctx, z, pr, (i) => this.S.ichi.kijun[i], "#9b6db8", 1);
    }
    /* Bollinger */
    if (this.overlays.bb && this.S) {
      this._line(ctx, z, pr, (i) => this.S.bb.up[i], "rgba(138,147,160,.55)", 1);
      this._line(ctx, z, pr, (i) => this.S.bb.lo[i], "rgba(138,147,160,.55)", 1);
      this._line(ctx, z, pr, (i) => this.S.bb.mid[i], "rgba(138,147,160,.8)", 1, [4, 3]);
    }
    /* EMAs + VWAP */
    if (this.overlays.ema20) this._line(ctx, z, pr, (i) => this.S.e20[i], "#e8a33d", 1.4);
    if (this.overlays.ema50) this._line(ctx, z, pr, (i) => this.S.e50[i], "#5b8fd6", 1.4);
    if (this.overlays.ema100) this._line(ctx, z, pr, (i) => this.S.e100[i], "#9b6db8", 1.3);
    if (this.overlays.ema200) this._line(ctx, z, pr, (i) => this.S.e200[i], "#c86ea0", 1.3);
    if (this.overlays.vwap) this._line(ctx, z, pr, (i) => this.S.vwap[i], "#4ecbc4", 1.2, [5, 3]);
    /* Supertrend */
    if (this.overlays.st && this.S) {
      this._line(ctx, z, pr, (i) => { const s = this.S.st[i]; return s && s.up ? s.line : null; }, "#2e9e6b", 1.5);
      this._line(ctx, z, pr, (i) => { const s = this.S.st[i]; return s && !s.up ? s.line : null; }, "#c84b3c", 1.5);
    }

    /* candles */
    for (let i = this.view.i0; i <= this.view.i1; i++) {
      const k = this.c[i]; if (!k) continue;
      const x = this._xAt(i, z);
      const up = k.c >= k.o, col = up ? C.up : C.dn;
      ctx.strokeStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, this._yAt(k.h, z.price, pr)); ctx.lineTo(x, this._yAt(k.l, z.price, pr)); ctx.stroke();
      const yO = this._yAt(k.o, z.price, pr), yC = this._yAt(k.c, z.price, pr);
      const top = Math.min(yO, yC), hgt = Math.max(1, Math.abs(yC - yO));
      ctx.fillStyle = col;
      ctx.fillRect(x - bw / 2, top, bw, hgt);
    }

    /* focus pulse */
    if (this.focusI != null && this.focusI >= this.view.i0 && this.focusI <= this.view.i1) {
      const x = this._xAt(this.focusI, z);
      const a = 0.25 + 0.2 * Math.sin(Date.now() / 160);
      ctx.fillStyle = `rgba(232,163,61,${a.toFixed(2)})`;
      ctx.fillRect(x - bw, z.price.y0, bw * 2, z.price.y1 - z.price.y0);
    }

    /* volume */
    let vMax = 0;
    for (let i = this.view.i0; i <= this.view.i1; i++) vMax = Math.max(vMax, this.c[i]?.v || 0);
    for (let i = this.view.i0; i <= this.view.i1; i++) {
      const k = this.c[i]; if (!k || !vMax) continue;
      const x = this._xAt(i, z);
      const h = ((k.v || 0) / vMax) * (z.vol.y1 - z.vol.y0 - 4);
      ctx.fillStyle = k.c >= k.o ? "rgba(46,158,107,.45)" : "rgba(200,75,60,.45)";
      ctx.fillRect(x - bw / 2, z.vol.y1 - h, bw, h);
    }
    ctx.fillStyle = C.mutInk; ctx.font = "9px 'Inter', sans-serif"; ctx.textAlign = "left";
    ctx.fillText("VOL", z.x0 + 2, z.vol.y0 + 10);

    /* momentum sub-panel */
    if (z.mom) this._drawMomentum(ctx, z, C);

    /* user drawings */
    for (const d of this.drawings) {
      ctx.strokeStyle = "#e8a33d"; ctx.lineWidth = 1.2;
      if (d.kind === "hline") {
        const y = this._yAt(d.p, z.price, pr);
        ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(z.x0, y); ctx.lineTo(z.x1, y); ctx.stroke(); ctx.setLineDash([]);
      } else if (d.kind === "trend") {
        const x1 = this._xAt(d.a.i, z), y1 = this._yAt(d.a.p, z.price, pr);
        const x2 = this._xAt(d.b.i, z), y2 = this._yAt(d.b.p, z.price, pr);
        // extend to right edge
        const dx = x2 - x1 || 1e-9, slope = (y2 - y1) / dx;
        const yE = y2 + slope * (z.x1 - x2);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(z.x1, yE); ctx.stroke();
      }
    }
    if (this._pendingPt) {
      const x = this._xAt(this._pendingPt.i, z), y = this._yAt(this._pendingPt.p, z.price, pr);
      ctx.fillStyle = "#e8a33d"; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    }

    /* pattern markers */
    for (const m of this.marks) {
      if (m.i < this.view.i0 || m.i > this.view.i1) continue;
      const k = this.c[m.i]; const x = this._xAt(m.i, z);
      const col = m.dir > 0 ? C.up : m.dir < 0 ? C.dn : C.amber;
      ctx.fillStyle = col;
      if (m.dir >= 0) { const y = this._yAt(k.l, z.price, pr) + 12; this._tri(ctx, x, y, 5, true); }
      if (m.dir <= 0) { const y = this._yAt(k.h, z.price, pr) - 12; this._tri(ctx, x, y, 5, false); }
      if (this.hoverMark === m || (this.focusI === m.i && this.focusI != null)) {
        const y = m.dir >= 0 ? this._yAt(k.l, z.price, pr) + 12 : this._yAt(k.h, z.price, pr) - 12;
        ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.stroke();
      }
    }

    /* last-price tag */
    const lp = this.c[this.view.i1]?.c ?? this.c.at(-1).c;
    const lpy = this._yAt(lp, z.price, pr);
    ctx.fillStyle = "#11151c"; ctx.strokeStyle = C.amber;
    ctx.fillRect(z.x1 + 2, lpy - 8, this.pad.r - 6, 16); ctx.strokeRect(z.x1 + 2, lpy - 8, this.pad.r - 6, 16);
    ctx.fillStyle = C.amber; ctx.font = "10px 'Inter', sans-serif"; ctx.textAlign = "left";
    ctx.fillText(this._fmt(lp), z.x1 + 6, lpy + 3);

    /* crosshair + OHLC legend */
    if (this.cross) {
      const i = this.cross.i, k = this.c[i];
      ctx.strokeStyle = "rgba(138,147,160,.5)"; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      const cx = this._xAt(i, z);
      ctx.beginPath(); ctx.moveTo(cx, z.price.y0); ctx.lineTo(cx, z.mom ? z.mom.y1 : z.vol.y1); ctx.stroke();
      if (this.cross.y > z.price.y0 && this.cross.y < z.price.y1) {
        ctx.beginPath(); ctx.moveTo(z.x0, this.cross.y); ctx.lineTo(z.x1, this.cross.y); ctx.stroke();
        const p = pr.lo + (1 - (this.cross.y - z.price.y0) / (z.price.y1 - z.price.y0)) * (pr.hi - pr.lo);
        ctx.setLineDash([]);
        ctx.fillStyle = "#1a2029"; ctx.fillRect(z.x1 + 2, this.cross.y - 8, this.pad.r - 6, 15);
        ctx.fillStyle = C.mut; ctx.fillText(this._fmt(p), z.x1 + 6, this.cross.y + 3);
      }
      ctx.setLineDash([]);
      if (k) {
        const chg = i > 0 ? ((k.c - this.c[i - 1].c) / this.c[i - 1].c) * 100 : 0;
        const d = new Date(k.t);
        const txt = `${d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}${this._intraday() ? " " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : ""}  O ${this._fmt(k.o)}  H ${this._fmt(k.h)}  L ${this._fmt(k.l)}  C ${this._fmt(k.c)}  ${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%  Vol ${this._fmtVol(k.v)}`;
        ctx.font = "10.5px 'Inter', sans-serif";
        const w = ctx.measureText(txt).width + 14;
        ctx.fillStyle = "rgba(17,21,28,.92)"; ctx.fillRect(z.x0 + 4, z.price.y0 + 2, w, 18);
        ctx.strokeStyle = C.hair; ctx.strokeRect(z.x0 + 4, z.price.y0 + 2, w, 18);
        ctx.fillStyle = k.c >= k.o ? C.up : C.dn; ctx.textAlign = "left";
        ctx.fillText(txt, z.x0 + 11, z.price.y0 + 15);
      }
      /* marker tooltip */
      if (this.hoverMark) {
        const m = this.hoverMark, mk = this.c[m.i];
        const mx = this._xAt(m.i, z);
        const my = m.dir >= 0 ? this._yAt(mk.l, z.price, pr) + 22 : this._yAt(mk.h, z.price, pr) - 58;
        const lines = [m.name, new Date(mk.t).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }), `${m.strength} ${m.dir > 0 ? "Bullish" : m.dir < 0 ? "Bearish" : "Neutral"} · Conf ${m.score}%`];
        ctx.font = "10px 'Inter', sans-serif";
        const w = Math.max(...lines.map((t) => ctx.measureText(t).width)) + 16;
        const bx = Math.max(z.x0, Math.min(z.x1 - w, mx - w / 2));
        ctx.fillStyle = "rgba(17,21,28,.96)"; ctx.fillRect(bx, my, w, 46);
        ctx.strokeStyle = C.amber; ctx.strokeRect(bx, my, w, 46);
        ctx.textAlign = "left";
        ctx.fillStyle = C.fg; ctx.fillText(lines[0], bx + 8, my + 13);
        ctx.fillStyle = C.mutInk; ctx.fillText(lines[1], bx + 8, my + 27);
        ctx.fillStyle = m.dir > 0 ? C.up : m.dir < 0 ? C.dn : C.amber; ctx.fillText(lines[2], bx + 8, my + 40);
      }
    }
  }

  _drawMomentum(ctx, z, C) {
    const m = this.momentum, S = this.S, zone = z.mom;
    ctx.strokeStyle = C.grid; ctx.strokeRect(z.x0, zone.y0, z.x1 - z.x0, zone.y1 - zone.y0);
    const get = { rsi: S.rsi, adx: S.adx, atr: S.atr, obv: S.obv, mfi: S.mfi, roc: S.roc, cci: S.cci }[m];
    const label = m.toUpperCase();
    ctx.fillStyle = C.mutInk; ctx.font = "9px 'Inter', sans-serif"; ctx.textAlign = "left";
    if (m === "macd") {
      const { line, signal, hist } = S.macd;
      let lo = Infinity, hi = -Infinity;
      for (let i = this.view.i0; i <= this.view.i1; i++) { for (const v of [line[i], signal[i], hist[i]]) if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
      if (lo === Infinity) return;
      const pad = (hi - lo) * 0.1 || 1; lo -= pad; hi += pad;
      const y = (v) => zone.y1 - ((v - lo) / (hi - lo)) * (zone.y1 - zone.y0);
      const n = this.view.i1 - this.view.i0 + 1, bw = Math.max(1, ((z.x1 - z.x0) / n) * 0.5);
      for (let i = this.view.i0; i <= this.view.i1; i++) { const h = hist[i]; if (h == null) continue; const x = this._xAt(i, z); ctx.fillStyle = h >= 0 ? "rgba(46,158,107,.5)" : "rgba(200,75,60,.5)"; ctx.fillRect(x - bw / 2, Math.min(y(0), y(h)), bw, Math.abs(y(h) - y(0)) || 1); }
      this._lineY(ctx, z, (i) => line[i], y, "#e8a33d", 1.2);
      this._lineY(ctx, z, (i) => signal[i], y, "#5b8fd6", 1.2);
      ctx.fillStyle = C.mutInk; ctx.fillText(`MACD 12·26·9  ${line.at(-1) != null ? line.at(-1).toFixed(2) : ""}`, z.x0 + 4, zone.y0 + 11);
      return;
    }
    if (!get) return;
    let lo = Infinity, hi = -Infinity;
    for (let i = this.view.i0; i <= this.view.i1; i++) { const v = get[i]; if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
    if (lo === Infinity) return;
    if (m === "rsi" || m === "mfi") { lo = 0; hi = 100; }
    const pad = (hi - lo) * 0.08 || 1; if (!(m === "rsi" || m === "mfi")) { lo -= pad; hi += pad; }
    const y = (v) => zone.y1 - ((v - lo) / (hi - lo)) * (zone.y1 - zone.y0);
    if (m === "rsi" || m === "mfi") {
      for (const lev of [30, 50, 70]) {
        ctx.strokeStyle = lev === 50 ? "rgba(138,147,160,.25)" : "rgba(200,134,42,.3)"; ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.moveTo(z.x0, y(lev)); ctx.lineTo(z.x1, y(lev)); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    this._lineY(ctx, z, (i) => get[i], y, "#e8a33d", 1.3);
    const cur = get[this.cross ? this.cross.i : this.c.length - 1];
    ctx.fillStyle = C.mutInk;
    ctx.fillText(`${label}${cur != null ? "  " + (Math.abs(cur) > 1e6 ? this._fmtVol(cur) : cur.toFixed(1)) : ""}`, z.x0 + 4, zone.y0 + 11);
  }

  _line(ctx, z, pr, fn, color, w = 1, dash) {
    ctx.strokeStyle = color; ctx.lineWidth = w; if (dash) ctx.setLineDash(dash);
    ctx.beginPath(); let started = false;
    for (let i = this.view.i0; i <= this.view.i1; i++) {
      const v = fn(i); if (v == null) { continue; }
      const x = this._xAt(i, z), y = this._yAt(v, z.price, pr);
      started ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), started = true);
    }
    ctx.stroke(); if (dash) ctx.setLineDash([]);
  }
  _lineY(ctx, z, fn, yFn, color, w = 1) {
    ctx.strokeStyle = color; ctx.lineWidth = w;
    ctx.beginPath(); let started = false;
    for (let i = this.view.i0; i <= this.view.i1; i++) {
      const v = fn(i); if (v == null) continue;
      const x = this._xAt(i, z), y = yFn(v);
      started ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), started = true);
    }
    ctx.stroke();
  }
  _autoTrendlines(ctx, z, pr, C) {
    const { highs, lows } = this.S.swings;
    const inView = (arr) => arr.filter((s) => s.i >= this.view.i0 && s.i <= this.view.i1);
    const hs = inView(highs).slice(-4), ls = inView(lows).slice(-4);
    const drawFrom = (pts, color) => {
      if (pts.length < 2) return;
      const a = pts[pts.length - 2], b = pts[pts.length - 1];
      const x1 = this._xAt(a.i, z), y1 = this._yAt(a.p, z.price, pr);
      const x2 = this._xAt(b.i, z), y2 = this._yAt(b.p, z.price, pr);
      const slope = (y2 - y1) / ((x2 - x1) || 1e-9);
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash([7, 5]);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(z.x1, y2 + slope * (z.x1 - x2)); ctx.stroke(); ctx.setLineDash([]);
    };
    drawFrom(ls, "rgba(46,158,107,.45)");
    drawFrom(hs, "rgba(200,75,60,.45)");
  }
  _tri(ctx, x, y, r, up) {
    ctx.beginPath();
    if (up) { ctx.moveTo(x, y - r); ctx.lineTo(x - r, y + r); ctx.lineTo(x + r, y + r); }
    else { ctx.moveTo(x, y + r); ctx.lineTo(x - r, y - r); ctx.lineTo(x + r, y - r); }
    ctx.closePath(); ctx.fill();
  }
  _intraday() { return this.c.length > 1 && (this.c[1].t - this.c[0].t) < 864e5 * 0.9; }
  _fmt(v) { return v == null ? "—" : v >= 10000 ? v.toLocaleString("en-IN", { maximumFractionDigits: 0 }) : v.toFixed(2); }
  _fmtVol(v) { if (v == null) return "—"; const a = Math.abs(v); return a >= 1e9 ? (v / 1e9).toFixed(1) + "B" : a >= 1e6 ? (v / 1e6).toFixed(1) + "M" : a >= 1e3 ? (v / 1e3).toFixed(1) + "K" : String(Math.round(v)); }
}

/* ── PA · workspace controller ────────────────────────────────────────────
   Left navigator (18%) · interactive chart (60%) · pattern & insights (22%)
   Mounted between the Portfolio stats strip and the technical table. */
const PA = {
  TF: [
    { label: "1D", range: "1d", interval: "5m" },
    { label: "1W", range: "5d", interval: "30m" },
    { label: "1M", range: "1mo", interval: "1d" },
    { label: "3M", range: "3mo", interval: "1d" },
    { label: "6M", range: "6mo", interval: "1d" },
    { label: "1Y", range: "1y", interval: "1d" },
    { label: "2Y", range: "2y", interval: "1d" },
    { label: "5Y", range: "5y", interval: "1wk" },
    { label: "MAX", range: "max", interval: "1mo" },
  ],
  state: { symbol: null, tf: "1Y", rows: [], candles: [], scored: [], sel: null, bias: null, q: "", loading: false },
  _cache: {},          // `${symbol}|${tf}` → candles
  chart: null,
  _mounted: false,

  /* Called by the portfolio module after every render/scan or symbol change. */
  sync(pf) {
    const host = document.getElementById("pfPriceAction");
    if (!host) return;
    this._pf = pf;
    const c = pf._cache && pf._cache();
    let rows = ((c && c.rows) || []).filter((r) => r && !r.error);
    /* If we have fewer scan rows than portfolio symbols (fresh add, pre-scan),
       union them so the newly-added names appear in the navigator right away. */
    if (pf._active) {
      const p = pf._active();
      const symList = ((p && p.symbols) || []);
      if (symList.length > rows.length) {
        const have = new Set(rows.map((r) => r.symbol));
        for (const s of symList) {
          if (!have.has(s.symbol)) rows.push({
            symbol: s.symbol, name: s.name || s.symbol, sector: s.sector || "",
            price: null, changePct: null, signal: "", trend: null, _bare: true,
          });
        }
      }
    }
    this.state.rows = rows;
    host.hidden = false;
    if (!this._mounted) this.mount(host);
    /* Every sync fires after the portfolio module renders — including the
       moment `pfWorkspace` un-hides on first portfolio creation. Kick the
       chart to remeasure now that our ancestor has real dimensions. */
    if (this.chart) {
      requestAnimationFrame(() => this.chart.resize());
      setTimeout(() => this.chart.resize(), 120);
    }
    if (!rows.length) { this._renderEmpty(); return; }
    this._renderNav();
    if (!this.state.symbol || !rows.some((r) => r.symbol === this.state.symbol)) {
      this.select(rows[0].symbol);
    } else {
      this._renderHead(); // refresh live price
    }
  },

  _renderEmpty() {
    const cnt = document.getElementById("paCount");
    if (cnt) cnt.textContent = "0 companies";
    const nav = document.getElementById("paNavList");
    if (nav) nav.innerHTML = `<div class="pa-empty mono" style="padding:14px 12px;line-height:1.6">Add companies to this portfolio and the candlestick engine will chart them here — pattern detection, confluence scoring and full AI analysis per name.</div>`;
    const head = document.getElementById("paHead"); if (head) head.innerHTML = "";
    const tl = document.getElementById("paTimeline"); if (tl) tl.innerHTML = `<div class="pa-empty mono">no companies yet</div>`;
    const side = document.getElementById("paSide"); if (side) side.innerHTML = `<div class="pa-side-h"><span>PATTERN &amp; INSIGHTS</span></div><div class="pa-empty mono">insights appear once a company is charted</div>`;
    this.state.symbol = null; this.state.candles = []; this.state.scored = []; this.state.sel = null;
    if (this.chart) this.chart.setData([], {});
  },

  mount(host) {
    this._mounted = true;
    host.innerHTML = `
      <div class="pa" id="paRoot">
        <header class="pa-top">
          <div class="pa-title"><span class="pa-title-ic">◮</span> CANDLESTICK ANALYSIS <span class="pa-title-sub mono" id="paCount"></span></div>
          <div class="pa-top-right">
            <div class="pa-tf mono" id="paTf">${this.TF.map((t) => `<button data-tf="${t.label}" class="${t.label === this.state.tf ? "on" : ""}">${t.label}</button>`).join("")}</div>
            <button class="pa-fs" id="paFs" title="Full screen">⛶</button>
          </div>
        </header>
        <div class="pa-body">
          <aside class="pa-nav">
            <div class="pa-nav-search"><input id="paSearch" placeholder="Search in portfolio…" spellcheck="false"></div>
            <div class="pa-nav-list" id="paNavList"></div>
          </aside>
          <section class="pa-main">
            <div class="pa-head" id="paHead"></div>
            <div class="pa-canvas-wrap"><canvas id="paCanvas"></canvas></div>
            <div class="pa-tools mono">
              <span class="pa-tool-grp" id="paOverlays">
                <label><input type="checkbox" data-ov="ema20" checked>EMA 20</label>
                <label><input type="checkbox" data-ov="ema50" checked>EMA 50</label>
                <label><input type="checkbox" data-ov="ema100">EMA 100</label>
                <label><input type="checkbox" data-ov="ema200">EMA 200</label>
                <label><input type="checkbox" data-ov="vwap">VWAP</label>
                <label><input type="checkbox" data-ov="bb">Bollinger</label>
                <label><input type="checkbox" data-ov="st">Supertrend</label>
                <label><input type="checkbox" data-ov="ichi">Ichimoku</label>
                <label><input type="checkbox" data-ov="sr" checked>S/R</label>
                <label><input type="checkbox" data-ov="tl" checked>Trendlines</label>
              </span>
              <span class="pa-tool-grp">
                <select id="paMom">
                  <option value="rsi" selected>RSI</option><option value="macd">MACD</option><option value="adx">ADX</option>
                  <option value="atr">ATR</option><option value="obv">OBV</option><option value="mfi">MFI</option>
                  <option value="roc">ROC</option><option value="cci">CCI</option><option value="">None</option>
                </select>
                <button class="pa-draw" data-dm="trend" title="Draw trendline (two clicks)">╱</button>
                <button class="pa-draw" data-dm="hline" title="Horizontal line">―</button>
                <button class="pa-draw" data-dm="clear" title="Clear drawings">⌫</button>
              </span>
            </div>
            <div class="pa-timeline-wrap">
              <div class="pa-timeline-label mono">PATTERN TIMELINE</div>
              <div class="pa-timeline" id="paTimeline"></div>
            </div>
          </section>
          <aside class="pa-side" id="paSide"></aside>
        </div>
      </div>
      <div class="pa-drawer-veil" id="paVeil" hidden></div>
      <aside class="pa-drawer" id="paDrawer" hidden></aside>`;

    /* chart — with robust size tracking */
    this.chart = new PAChart(document.getElementById("paCanvas"), {
      initialBars: 170,
      onMarkClick: (m) => { this.selectPattern(m, true); },
    });
    const wrap = host.querySelector(".pa-canvas-wrap");
    if (window.ResizeObserver) {
      this._ro = new ResizeObserver(() => this.chart.resize());
      this._ro.observe(wrap);
      /* also observe the workspace root so that toggling full-screen (or the
         portfolio's pfWorkspace container un-hiding) fires a resize even when
         the wrap's own box hasn't moved yet in the same frame */
      this._ro.observe(host);
    }
    /* stagger a few resize attempts to catch layout-after-visibility flips
       (fresh portfolio create → pfWorkspace un-hides → workspace suddenly has box) */
    [30, 120, 350, 800].forEach((t) => setTimeout(() => this.chart.resize(), t));
    window.addEventListener("resize", () => this.chart.resize());

    /* timeframes */
    host.querySelector("#paTf").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-tf]"); if (!b) return;
      this.state.tf = b.dataset.tf;
      host.querySelectorAll("#paTf button").forEach((x) => x.classList.toggle("on", x === b));
      if (this.state.symbol) this.load(this.state.symbol, true);
    });

    /* overlays + momentum + draw tools */
    host.querySelector("#paOverlays").addEventListener("change", (e) => {
      const cb = e.target.closest("input[data-ov]"); if (!cb) return;
      this.chart.setOverlay(cb.dataset.ov, cb.checked);
    });
    host.querySelector("#paMom").addEventListener("change", (e) => { this.chart.setMomentum(e.target.value); this.chart.resize(); });
    host.querySelectorAll(".pa-draw").forEach((b) => b.addEventListener("click", () => {
      const m = b.dataset.dm;
      if (m === "clear") { this.chart.clearDrawings(); return; }
      const on = this.chart.drawMode === m ? "" : m;
      this.chart.setDrawMode(on);
      host.querySelectorAll(".pa-draw").forEach((x) => x.classList.toggle("on", x.dataset.dm === on));
    }));

    /* fullscreen */
    host.querySelector("#paFs").addEventListener("click", () => {
      const root = document.getElementById("paRoot");
      root.classList.toggle("pa-full");
      document.body.classList.toggle("pa-noscroll", root.classList.contains("pa-full"));
      /* fire multiple resizes: the class-flip triggers a reflow, and some browsers
         report the new box only on the next frame (or after transitions settle) */
      requestAnimationFrame(() => this.chart.resize());
      [80, 260].forEach((t) => setTimeout(() => this.chart.resize(), t));
    });

    /* navigator search */
    host.querySelector("#paSearch").addEventListener("input", (e) => { this.state.q = e.target.value.trim().toUpperCase(); this._renderNav(); });

    /* drawer close */
    host.querySelector("#paVeil").addEventListener("click", () => this.closeDrawer());
  },

  /* ── navigator ── */
  _renderNav() {
    const el = document.getElementById("paNavList"); if (!el) return;
    const q = this.state.q;
    const rows = this.state.rows.filter((r) => !q || r.symbol.toUpperCase().includes(q) || (r.name || "").toUpperCase().includes(q));
    document.getElementById("paCount").textContent = `${this.state.rows.length} companies`;
    el.innerHTML = rows.map((r) => {
      const hasPx = r.price != null;
      const up = (r.changePct ?? 0) >= 0;
      const tdir = r.trend ? (/Bullish/.test(r.trend.direction || "") ? "▲" : /Bearish/.test(r.trend.direction || "") ? "▼" : "▬") : "";
      const tcls = r.trend ? (/Bullish/.test(r.trend.direction || "") ? "up" : /Bearish/.test(r.trend.direction || "") ? "down" : "flat") : "flat";
      return `<button class="pa-co ${r.symbol === this.state.symbol ? "on" : ""}" data-s="${r.symbol}">
        ${typeof pfLogoMarkup === "function" ? pfLogoMarkup(r.symbol, r.name) : ""}
        <span class="pa-co-main"><b>${r.symbol}</b><small>${(r.name || "").slice(0, 26)}</small></span>
        <span class="pa-co-px mono"><b>${hasPx ? r.price.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}</b>
        <small class="${up ? "up" : "down"}">${hasPx && r.changePct != null ? (up ? "+" : "") + r.changePct.toFixed(2) + "%" : ""}</small></span>
        <span class="pa-co-meta"><i class="${tcls}">${tdir}</i><em>${r.signal || (r._bare ? "" : "")}</em></span>
      </button>`;
    }).join("") || `<div class="pa-empty mono">no matches</div>`;
    el.querySelectorAll(".pa-co").forEach((b) => b.addEventListener("click", () => this.select(b.dataset.s)));
  },

  select(symbol) {
    if (this.state.symbol === symbol && this.state.candles.length) return;
    this.state.symbol = symbol;
    this._renderNav();
    this.load(symbol);
  },

  async load(symbol, keepView = false) {
    const tf = this.TF.find((t) => t.label === this.state.tf) || this.TF[5];
    const key = `${symbol}|${tf.label}`;
    this.state.loading = true; this._renderHead();
    try {
      let candles = this._cache[key];
      if (!candles) {
        const d = await api(`/api/history/${encodeURIComponent(symbol)}?range=${tf.range}&interval=${tf.interval}`);
        candles = (d.points || []).filter((p) => p.o != null && p.h != null && p.l != null && p.c != null);
        this._cache[key] = candles;
      }
      if (this.state.symbol !== symbol) return; // stale response
      this.state.candles = candles;
      /* backfill price/change for bare rows (no scan yet) from the candles */
      const row = this._row();
      if (row && row._bare && candles.length >= 2) {
        row.price = candles.at(-1).c;
        row.changePct = ((candles.at(-1).c - candles.at(-2).c) / candles.at(-2).c) * 100;
        this._renderNav();
      }
      const pats = PA_PATTERN.detectAll(candles);
      this.state.scored = PA_SCORE.analyze(candles, pats);
      this.state.bias = candles.length >= 20 ? PA_SCORE.bias(candles, this.state.scored) : null;
      this.state.sel = this.state.scored.at(-1) || null;
      this.chart.setData(candles, { symbol });
      this.chart.setMarks(this.state.scored);
      this.state.loading = false;
      this._renderHead(); this._renderTimeline(); this._renderSide();
    } catch (e) {
      this.state.loading = false; this.state.candles = []; this.state.scored = []; this.state.sel = null;
      this.chart.setData([], {});
      this._renderHead(e.message || "history unavailable");
      this._renderTimeline(); this._renderSide();
    }
  },

  _row() { return this.state.rows.find((r) => r.symbol === this.state.symbol); },

  /* ── LIVE CANDLE ENGINE ──────────────────────────────────────────────────
     Driven by the terminal's unified liveRefreshTick (15s in market hours).
     Re-fetches the active symbol's series, and ONLY when the tape actually
     moved (new bar, or the live bar's OHLC changed) re-runs the full
     analytical stack — pattern detection, confluence scoring, bias — and
     repaints via updateData(), which preserves zoom/pan/drawings/overlays.
     A brief premium gold glow marks the refresh; nothing flickers because
     nothing else re-renders. ── */
  _liveBusy: false,
  _lastLiveAt: 0,
  async liveTick() {
    if (this._liveBusy || !this._mounted || !this.state.symbol || this.state.loading) return;
    if (document.hidden) return;
    const activeTab = document.querySelector(".tab:not([hidden])");
    if (!activeTab || activeTab.id !== "tab-portfolio") return;
    // respect market hours: outside hours daily candles don't move — poll gently
    const inHours = typeof isMarketHours === "function" ? isMarketHours() : true;
    const minGap = inHours ? 14000 : 55000;
    if (Date.now() - this._lastLiveAt < minGap) return;
    this._liveBusy = true;
    this._lastLiveAt = Date.now();
    const symbol = this.state.symbol;
    const tf = this.TF.find((t) => t.label === this.state.tf) || this.TF[5];
    try {
      const d = await api(`/api/history/${encodeURIComponent(symbol)}?range=${tf.range}&interval=${tf.interval}`);
      const fresh = (d.points || []).filter((p) => p.o != null && p.h != null && p.l != null && p.c != null);
      // symbol/timeframe changed while we were fetching → drop silently
      if (this.state.symbol !== symbol || !fresh.length) return;
      const cur = this.state.candles || [];
      const a = cur.at(-1), b = fresh.at(-1);
      const moved = !a || !b ? true :
        fresh.length !== cur.length || a.t !== b.t || a.c !== b.c || a.h !== b.h || a.l !== b.l || a.o !== b.o;
      if (!moved) return;
      // refresh cache + state, re-run the full analytical stack
      this._cache[`${symbol}|${tf.label}`] = fresh;
      this.state.candles = fresh;
      const pats = PA_PATTERN.detectAll(fresh);
      this.state.scored = PA_SCORE.analyze(fresh, pats);
      this.state.bias = fresh.length >= 20 ? PA_SCORE.bias(fresh, this.state.scored) : null;
      // keep the user's selected pattern if it still exists; else latest
      const selId = this.state.sel && (this.state.sel.id || this.state.sel.key);
      this.state.sel = (selId && this.state.scored.find((x) => (x.id || x.key) === selId)) || this.state.scored.at(-1) || null;
      // update the nav row's live price/change from the candles
      const row = this._row();
      if (row && fresh.length >= 2) {
        row.price = fresh.at(-1).c;
        row.changePct = ((fresh.at(-1).c - fresh.at(-2).c) / fresh.at(-2).c) * 100;
      }
      this.chart.updateData(fresh, { symbol });
      this.chart.setMarks(this.state.scored);
      this._renderHead(); this._renderTimeline(); this._renderSide(); this._renderNav();
      // premium gold pulse on the chart frame
      const wrap = document.getElementById("paChartWrap") || (this.chart && this.chart.cv && this.chart.cv.parentElement);
      if (wrap && typeof goldFlash === "function") goldFlash(wrap);
    } catch { /* transient — next tick retries */ }
    finally { this._liveBusy = false; }
  },

  _renderHead(err) {
    const el = document.getElementById("paHead"); if (!el) return;
    const r = this._row(); if (!r) { el.innerHTML = ""; return; }
    const k = this.state.candles.at(-1);
    const px = r.price != null ? r.price : k ? k.c : null;
    const chg = r.changePct != null ? r.changePct : (this.state.candles.length >= 2 ? ((k.c - this.state.candles.at(-2).c) / this.state.candles.at(-2).c) * 100 : 0);
    const up = chg >= 0;
    const f = (v) => v == null ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    el.innerHTML = `
      <div class="pa-head-id"><b>${(r.name || r.symbol).toUpperCase()}</b><span class="mono">${r.symbol}</span></div>
      <div class="pa-head-px mono"><b class="${up ? "up" : "down"}">${f(px)}</b><small class="${up ? "up" : "down"}">${px != null ? (up ? "+" : "") + chg.toFixed(2) + "%" : ""}</small></div>
      <div class="pa-head-ohlc mono">${this.state.loading ? "loading candles…" : err ? `<span class="down">${err}</span>` : k ? `O ${f(k.o)}&nbsp; H ${f(k.h)}&nbsp; L ${f(k.l)}&nbsp; C ${f(k.c)}&nbsp; Vol ${this.chart ? this.chart._fmtVol(k.v) : "—"}` : ""}</div>`;
  },

  /* ── pattern timeline ── */
  _renderTimeline() {
    const el = document.getElementById("paTimeline"); if (!el) return;
    const list = this.state.scored;
    if (!list.length) { el.innerHTML = `<div class="pa-empty mono">no patterns detected in this window</div>`; return; }
    el.innerHTML = list.map((m, idx) => `
      <button class="pa-tl-item ${m === this.state.sel ? "on" : ""}" data-i="${idx}">
        <i class="pa-dot ${m.dir > 0 ? "up" : m.dir < 0 ? "down" : "flat"}"></i>
        <span class="pa-tl-d mono">${new Date(m.t).toLocaleDateString("en-IN", { month: "short", year: "2-digit" }).replace(" ", " '")}</span>
        <span class="pa-tl-n">${m.name}</span>
      </button>`).join("");
    el.querySelectorAll(".pa-tl-item").forEach((b) => b.addEventListener("click", () => {
      const m = list[+b.dataset.i];
      this.selectPattern(m, true);
    }));
    el.scrollLeft = el.scrollWidth;
  },

  selectPattern(m, focus = false) {
    this.state.sel = m;
    if (focus && this.chart) this.chart.focus(m.i);
    this._renderTimeline();
    this._renderSide();
  },

  /* ── right insights panel ── */
  _glyphSVG(m, w = 34, h = 30) {
    /* schematic two-candle glyph coloured by direction */
    const g = m.dir > 0 ? ["#c84b3c", "#2e9e6b"] : m.dir < 0 ? ["#2e9e6b", "#c84b3c"] : ["#8a93a0", "#8a93a0"];
    const one = m.candles === 1;
    return `<svg viewBox="0 0 34 30" width="${w}" height="${h}" class="pa-glyph">
      ${one ? "" : `<line x1="10" y1="4" x2="10" y2="26" stroke="${g[0]}" stroke-width="1.4"/><rect x="6.5" y="9" width="7" height="12" fill="${g[0]}"/>`}
      <line x1="${one ? 17 : 24}" y1="2" x2="${one ? 17 : 24}" y2="28" stroke="${g[1]}" stroke-width="1.4"/>
      <rect x="${one ? 13.5 : 20.5}" y="${m.dir === 0 ? 13 : 6}" width="7" height="${m.dir === 0 ? 3 : 18}" fill="${g[1]}"/>
    </svg>`;
  },

  _renderSide() {
    const el = document.getElementById("paSide"); if (!el) return;
    const m = this.state.sel, bias = this.state.bias, c = this.state.candles;
    if (!c.length) { el.innerHTML = `<div class="pa-empty mono" style="padding:22px">insights appear when candles load</div>`; return; }
    const kl = PA_STRUCT.keyLevels(c);
    const f = (v) => v == null ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const closes = c.map((x) => x.c);
    const rsi = PA_MATH.rsi(closes).at(-1);
    const adx = PA_MATH.adx(c).at(-1);
    const av = PA_MATH.sma(c.map((x) => x.v || 0), 20).at(-1);
    const volX = av ? (c.at(-1).v || 0) / av : null;
    const atr = PA_MATH.atr(c).at(-1), atrPct = atr && c.at(-1).c ? (atr / c.at(-1).c) * 100 : null;
    const momL = adx == null ? "—" : adx >= 30 ? "Strong" : adx >= 20 ? "Firm" : "Soft";
    const volL = volX == null ? "—" : volX >= 1.3 ? "Above Avg" : volX <= 0.7 ? "Below Avg" : "Average";
    const vlaL = atrPct == null ? "—" : atrPct >= 3 ? "High" : atrPct >= 1.5 ? "Medium" : "Low";
    const recent = this.state.scored.slice(-6).reverse();

    el.innerHTML = `
      <div class="pa-side-h"><span>PATTERN &amp; INSIGHTS</span>${bias ? `<span class="pa-bias ${bias.cls}">${bias.label.replace(" Bias", " Bias")}</span>` : ""}</div>
      ${m ? `
      <div class="pa-cur">
        <div class="pa-cur-l mono">Current Pattern</div>
        <div class="pa-cur-row">
          ${this._glyphSVG(m)}
          <div class="pa-cur-tx">
            <b class="${m.dir > 0 ? "up" : m.dir < 0 ? "down" : "flat"}">${m.name}</b>
            <span class="${m.dir > 0 ? "up" : m.dir < 0 ? "down" : "flat"}">${m.strength} ${m.dir > 0 ? "Bullish" : m.dir < 0 ? "Bearish" : "Neutral"}</span>
            <small class="mono">Detected on ${new Date(m.t).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</small>
          </div>
          <div class="pa-conf mono" title="Confluence score"><b>${m.score}</b><small>conf</small></div>
        </div>
        <div class="pa-strength"><i style="width:${m.score}%;background:${m.dir > 0 ? "var(--up)" : m.dir < 0 ? "var(--down)" : "var(--amber)"}"></i></div>
      </div>` : `<div class="pa-empty mono">no pattern in this window</div>`}
      <div class="pa-recent">
        <div class="pa-cur-l mono">Recent Patterns</div>
        ${recent.map((p) => `<button class="pa-rec ${p === m ? "on" : ""}" data-t="${p.i}">
          <i class="pa-dot ${p.dir > 0 ? "up" : p.dir < 0 ? "down" : "flat"}"></i>
          <b>${p.name}</b><em>(${p.strength} ${p.dir > 0 ? "Bullish" : p.dir < 0 ? "Bearish" : "Neutral"})</em>
          <span class="mono">${new Date(p.t).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })}</span>
        </button>`).join("") || `<div class="pa-empty mono">—</div>`}
      </div>
      ${m ? `<div class="pa-insight"><div class="pa-cur-l mono">Pattern Insight</div><p>${PA_AI.overview(m, this.state.symbol)}</p></div>` : ""}
      <div class="pa-mini">
        <div><small>Momentum</small><b class="${adx != null && adx >= 25 ? "up" : "flat"}">${momL}</b></div>
        <div><small>Trend</small><b class="${bias && bias.trend.dir > 0 ? "up" : bias && bias.trend.dir < 0 ? "down" : "flat"}">${bias ? bias.trend.label.replace("Strong ", "") : "—"}</b></div>
        <div><small>Volume</small><b class="${volX != null && volX >= 1.3 ? "up" : "flat"}">${volL}</b></div>
        <div><small>Volatility</small><b class="${vlaL === "High" ? "down" : "flat"}">${vlaL}</b></div>
      </div>
      <div class="pa-levels">
        <div class="pa-cur-l mono">Key Levels</div>
        <div class="pa-lv"><span>Resistance 2</span><b class="mono">${f(kl.r2)}</b></div>
        <div class="pa-lv"><span>Resistance 1</span><b class="mono">${f(kl.r1)}</b></div>
        <div class="pa-lv"><span>Support 1</span><b class="mono">${f(kl.s1)}</b></div>
        <div class="pa-lv"><span>Support 2</span><b class="mono">${f(kl.s2)}</b></div>
      </div>
      ${m ? `<button class="pa-full-btn" id="paFullBtn">View Full Analysis <span>→</span></button>` : ""}`;

    el.querySelectorAll(".pa-rec").forEach((b) => b.addEventListener("click", () => {
      const p = this.state.scored.find((x) => x.i === +b.dataset.t);
      if (p) this.selectPattern(p, true);
    }));
    el.querySelector("#paFullBtn")?.addEventListener("click", () => this.openDrawer());
  },

  /* ── full analysis drawer ── */
  openDrawer() {
    const m = this.state.sel; if (!m) return;
    const dr = document.getElementById("paDrawer"), veil = document.getElementById("paVeil");
    const kb = PA_KB[m.name] || {};
    const f = (v) => v == null ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const secs = [
      ["Overview", this._secOverview(m, kb)],
      ["Pattern Anatomy", `<p>${kb.anatomy || "—"}</p><div class="pa-d-note">Candles in formation: ${m.candles}. Signal candle — O ${f(m.o)} · H ${f(m.h)} · L ${f(m.l)} · C ${f(m.cl)}.</div>`],
      ["Market Psychology", `<p>${PA_AI.psychology(m)}</p>`],
      ["Context Analysis", `<p>${PA_AI.context(m)}</p>`],
      ["Confirmation Checklist", `<div class="pa-check">${PA_AI.checklist(m).map((x) => `<div class="pa-chk ${x.ok ? "ok" : "no"}"><i>${x.ok ? "✓" : "✗"}</i>${x.t}</div>`).join("")}</div>`],
      ["Reliability Engine", `<p>${PA_AI.reliability(m)}</p>`],
      ["Historical Examples", this._secHistory(m)],
      ["Trading Strategy", `<p>${PA_AI.strategy(m)}</p><div class="pa-scen">${PA_AI.scenarios(m).map((s) => `<div class="pa-scen-i">→ ${s}</div>`).join("")}</div>`],
      ["Risk Management", `<p>${PA_AI.risk(m)}</p>`],
      ["Educational Notes", `<p><b>Where it works:</b> ${kb.valid || "—"}</p><p><b>Where it fails:</b> ${kb.invalid || "—"}</p><p><b>Common mistakes:</b> ${kb.mistakes || "—"}</p><p><b>Professional confirmation:</b> ${kb.confirmation || "—"} ${PA_KB._base.confirmNote}</p>`],
    ];
    dr.innerHTML = `
      <div class="pa-d-head">
        <div class="pa-d-title">
          <b>${m.name}</b>
          <span class="pa-d-badge ${m.dir > 0 ? "up" : m.dir < 0 ? "down" : "flat"}">${m.strength} ${m.dir > 0 ? "Bullish" : m.dir < 0 ? "Bearish" : "Neutral"}</span>
          <small class="mono">Detected on ${new Date(m.t).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} · ${this.state.tf} timeframe</small>
        </div>
        <div class="pa-ring" title="Confluence score">
          <svg viewBox="0 0 44 44" width="52" height="52">
            <circle cx="22" cy="22" r="18" fill="none" stroke="var(--hairline)" stroke-width="4"/>
            <circle cx="22" cy="22" r="18" fill="none" stroke="${m.dir > 0 ? "#2e9e6b" : m.dir < 0 ? "#c84b3c" : "#e8a33d"}" stroke-width="4"
              stroke-dasharray="${(m.score / 100) * 113} 113" stroke-linecap="round" transform="rotate(-90 22 22)"/>
            <text x="22" y="26" text-anchor="middle" fill="var(--fg)" font-size="11" font-weight="600" font-family="Inter, sans-serif">${m.score}%</text>
          </svg>
        </div>
        <button class="pa-d-close" id="paDClose">✕</button>
      </div>
      <div class="pa-d-body">
        <nav class="pa-d-nav">${secs.map(([t], i) => `<button data-s="${i}" class="${i === 0 ? "on" : ""}"><span class="mono">${String(i + 1).padStart(2, "0")}</span>${t}</button>`).join("")}</nav>
        <div class="pa-d-content" id="paDContent">
          ${secs.map(([t, html], i) => `<section class="pa-d-sec" data-s="${i}"><h4>${t}</h4>${html}</section>`).join("")}
        </div>
      </div>`;
    dr.hidden = false; veil.hidden = false;
    requestAnimationFrame(() => dr.classList.add("open"));
    dr.querySelector("#paDClose").addEventListener("click", () => this.closeDrawer());
    const content = dr.querySelector("#paDContent");
    dr.querySelectorAll(".pa-d-nav button").forEach((b) => b.addEventListener("click", () => {
      dr.querySelectorAll(".pa-d-nav button").forEach((x) => x.classList.toggle("on", x === b));
      const sec = content.querySelector(`.pa-d-sec[data-s="${b.dataset.s}"]`);
      if (sec) content.scrollTo({ top: sec.offsetTop - 8, behavior: "smooth" });
    }));
  },

  _secOverview(m, kb) {
    const f = (v) => v == null ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const volTxt = (() => {
      const av = PA_MATH.sma(this.state.candles.map((x) => x.v || 0), 20)[m.i];
      return av && m.v ? `${(m.v / av).toFixed(1)}× 20-bar average` : "—";
    })();
    return `
      <div class="pa-ov">
        <div class="pa-ov-diagram">
          <div class="pa-ov-dl mono">${m.candles > 1 ? "Previous → Signal" : "Signal Candle"}</div>
          ${this._glyphSVG(m, 88, 74)}
        </div>
        <div class="pa-ov-facts">
          <div><span>Pattern Type</span><b>${kb.type || "—"}</b></div>
          <div><span>Formation</span><b>${m.candles} candle${m.candles > 1 ? "s" : ""}</b></div>
          <div><span>Market Bias</span><b class="${m.dir > 0 ? "up" : m.dir < 0 ? "down" : "flat"}">${m.strength} ${m.dir > 0 ? "Bullish" : m.dir < 0 ? "Bearish" : "Neutral"}</b></div>
          <div><span>Pattern Position</span><b>${m.keyNear.sup != null ? "Near Support" : m.keyNear.res != null ? "Near Resistance" : "Unanchored"}</b></div>
          <div><span>Volume</span><b>${volTxt}</b></div>
          <div><span>Trend Context</span><b>${m.trend.label}</b></div>
          <div><span>Reliability Score</span><b>${m.score}% (${m.strength})</b></div>
        </div>
      </div>
      <div class="pa-d-quick"><b>Quick Summary.</b> ${PA_AI.overview(m, this.state.symbol)}</div>`;
  },

  _secHistory(m) {
    const same = this.state.scored.filter((p) => p.name === m.name && p.i !== m.i);
    if (!same.length) return `<p>No earlier ${m.name} instances inside the loaded window. Extend the timeframe (2Y/5Y/MAX) to build a larger sample.</p>`;
    let wins = 0, n = 0;
    const rows = same.slice(-8).map((p) => {
      const k = this.state.candles, fwd = k[Math.min(p.i + 5, k.length - 1)];
      const ret = fwd && k[p.i] ? ((fwd.c - k[p.i].c) / k[p.i].c) * 100 : null;
      const win = ret != null && (p.dir >= 0 ? ret > 0 : ret < 0);
      if (ret != null && p.dir !== 0) { n++; if (win) wins++; }
      return `<div class="pa-hist-row"><span class="mono">${new Date(p.t).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })}</span>
        <span>conf ${p.score}%</span>
        <b class="${ret == null ? "flat" : ret >= 0 ? "up" : "down"} mono">${ret == null ? "—" : (ret >= 0 ? "+" : "") + ret.toFixed(1) + "% in 5 bars"}</b>
        <i class="${win ? "up" : "down"}">${p.dir === 0 ? "·" : win ? "worked" : "failed"}</i></div>`;
    }).join("");
    return `<div class="pa-hist">${rows}</div><div class="pa-d-note">${n ? `Directional instances resolved in favour ${wins}/${n} times over the next 5 bars in this window — a small local sample, not a universal statistic.` : "Sample too small for a hit-rate read."}</div>`;
  },

  closeDrawer() {
    const dr = document.getElementById("paDrawer"), veil = document.getElementById("paVeil");
    dr.classList.remove("open");
    setTimeout(() => { dr.hidden = true; veil.hidden = true; }, 240);
  },
};
window.PA = PA;
