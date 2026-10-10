/* ════════════════════════════════════════════════════════════════════════
   M-TERMINAL · CHART ANALYSIS  (top of Market Intelligence)

   · Chart types  — Line (deep gradient), Candles, OHLC bars, Baseline
   · Indicators   — SMA 20/50/200, EMA 20, Bollinger (20,2), Volume, RSI pane
   · Events       — seven deterministic event families detected on the series
                    (sharp moves, gaps, 52-week extremes, golden/death crosses,
                    200-DMA breaks, RSI extremes, window drawdown) with a
                    filterable list; every summary is computed, never invented
   · Compare      — up to 4 overlays on a normalised %-change axis
   · Fullscreen   — the whole panel, chart resized to the screen

   History is fetched with a look-back beyond the visible window so 200-DMA,
   RSI and 52-week reads are exact from the first visible bar.
   Depends on globals from terminal.js / macro-command.js:
   $, $$, api, esc, F, MC_MATH, mcCommentFor, CX_PRESETS, MC_PALETTE.
   ════════════════════════════════════════════════════════════════════════ */
"use strict";

const CX_COL = { up: "#2ebd85", down: "#f0524f", grid: "rgba(255,255,255,.055)", axis: "rgba(233,228,218,.46)", amber: "#e8a33d" };
const CX_TYPES = [["line", "Line"], ["candle", "Candles"], ["bar", "OHLC bars"], ["baseline", "Baseline"]];
const CX_IND = [
  ["sma20", "SMA 20", "#7aa5c8"], ["sma50", "SMA 50", "#e8a33d"], ["sma200", "SMA 200", "#b58cf0"],
  ["ema20", "EMA 20", "#4fb3a9"], ["bb", "Bollinger Bands (20, 2)", "#8fa0b3"],
  ["vol", "Volume", "#6b7480"], ["rsi", "RSI (14) pane", "#d4b14a"],
];
const CX_EVT = {
  move:    { label: "Sharp moves",       color: "#e8e3d8" },
  gap:     { label: "Price gaps",        color: "#7aa5c8" },
  extreme: { label: "52-week extremes",  color: "#2ebd85" },
  cross:   { label: "Golden / death cross", color: "#e8c547" },
  trend:   { label: "200-DMA breaks",    color: "#e8a33d" },
  rsi:     { label: "RSI extremes",      color: "#d4b14a" },
  dd:      { label: "Drawdown peak / trough", color: "#b58cf0" },
};
const CX_ICON = {
  line: `<svg viewBox="0 0 24 24"><path d="M3 17l5-6 4 3 5-7 4 4"/></svg>`,
  candle: `<svg viewBox="0 0 24 24"><path d="M7 3v4M7 17v4M17 5v3M17 16v4"/><rect x="5" y="7" width="4" height="10"/><rect x="15" y="8" width="4" height="8"/></svg>`,
  ind: `<svg viewBox="0 0 24 24"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>`,
  ev: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  full: `<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>`,
  exit: `<svg viewBox="0 0 24 24"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>`,
  caret: `<svg viewBox="0 0 24 24"><path d="M7 10l5 5 5-5"/></svg>`,
};

/* ── rolling series math (arrays aligned to the price series) ──────────── */
const CX_MATH = {
  sma(v, n) {
    const out = new Array(v.length).fill(null); let s = 0;
    for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= n) s -= v[i - n]; if (i >= n - 1) out[i] = s / n; }
    return out;
  },
  ema(v, n) {
    const out = new Array(v.length).fill(null); const k = 2 / (n + 1); let e = null;
    for (let i = 0; i < v.length; i++) {
      if (i === n - 1) { let s = 0; for (let j = 0; j < n; j++) s += v[j]; e = s / n; }
      else if (i >= n) e = v[i] * k + e * (1 - k);
      if (i >= n - 1) out[i] = e;
    }
    return out;
  },
  bb(v, n = 20, m = 2) {
    const mid = CX_MATH.sma(v, n), up = new Array(v.length).fill(null), lo = new Array(v.length).fill(null);
    for (let i = n - 1; i < v.length; i++) {
      let s = 0; for (let j = i - n + 1; j <= i; j++) s += (v[j] - mid[i]) ** 2;
      const sd = Math.sqrt(s / n); up[i] = mid[i] + m * sd; lo[i] = mid[i] - m * sd;
    }
    return { mid, up, lo };
  },
  rsi(v, n = 14) {   // Wilder smoothing
    const out = new Array(v.length).fill(null);
    if (v.length <= n) return out;
    let g = 0, l = 0;
    for (let i = 1; i <= n; i++) { const d = v[i] - v[i - 1]; if (d >= 0) g += d; else l -= d; }
    g /= n; l /= n; out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    for (let i = n + 1; i < v.length; i++) {
      const d = v[i] - v[i - 1];
      g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n;
      out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
    return out;
  },
};

function cxDate(t, withYear = true) {
  return new Date(t).toLocaleDateString("en-IN", { day: "2-digit", month: "short", ...(withYear ? { year: "2-digit" } : {}) });
}
function cxNum(v) { return v == null || !isFinite(v) ? "—" : Math.abs(v) >= 1000 ? v.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 }) : v.toFixed(2); }
const weeklyInt = (iv) => iv === "1wk";
const cxPct = (v, dp = 2) => (v == null || !isFinite(v) ? "—" : (v >= 0 ? "+" : "") + v.toFixed(dp) + "%");

/* ── event engine ──────────────────────────────────────────────────────────
   Runs over the full fetched series (look-back included) so crosses and
   52-week reads are exact; the UI shows the ones inside the visible range.
   Clustering keeps one marker per regime change instead of a marker per bar. */
function cxDetectEvents(pts, ind, weekly) {
  const n = pts.length; if (n < 30) return [];
  const c = pts.map((p) => p.c), ev = [];
  const barsYear = weekly ? 52 : 252, unit = weekly ? "week" : "session";
  const rets = []; for (let i = 1; i < n; i++) rets.push(c[i - 1] > 0 ? (c[i] / c[i - 1] - 1) * 100 : 0);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1)) || 1;
  const ctx = (i) => {
    const bits = [];
    if (ind.sma200[i] != null) bits.push(`price ${c[i] >= ind.sma200[i] ? "above" : "below"} the 200-${weekly ? "week" : "day"} average`);
    if (ind.rsi[i] != null) bits.push(`RSI ${ind.rsi[i].toFixed(0)}${ind.rsi[i] > 70 ? " (overbought)" : ind.rsi[i] < 30 ? " (oversold)" : ""}`);
    return bits.length ? ` Context: ${bits.join(", ")}.` : "";
  };
  const after = (i, k) => (i + k < n && c[i] > 0 ? (c[i + k] / c[i] - 1) * 100 : null);
  const follow = (i) => { const a = after(i, weekly ? 4 : 10); return a == null ? "" : ` Over the next ${weekly ? 4 : 10} ${unit}s price moved ${cxPct(a, 1)}.`; };

  // 1 · sharp moves — |return| beyond max(2σ, 1.5%); the 12 largest
  const thr = Math.max(2 * sd, weekly ? 3 : 1.5);
  rets.map((r, k) => ({ i: k + 1, r })).filter((x) => Math.abs(x.r) >= thr)
    .sort((a, b) => Math.abs(b.r) - Math.abs(a.r)).slice(0, 12)
    .forEach(({ i, r }) => ev.push({
      i, kind: "move", dir: r >= 0 ? 1 : -1,
      title: `${r >= 0 ? "Surge" : "Drop"} ${cxPct(r, 1)}`,
      text: `${cxPct(r, 1)} in one ${unit} — ${((Math.abs(r - mean)) / sd).toFixed(1)}σ versus this series' typical ${unit}ly swing.${follow(i)}${ctx(i)}`,
    }));

  // 2 · gaps — open vs previous close beyond max(1.5σ, 1%), not already a sharp move
  const moveSet = new Set(ev.map((e) => e.i));
  const gaps = [];
  for (let i = 1; i < n; i++) {
    const o = pts[i].o; if (o == null || !(c[i - 1] > 0) || moveSet.has(i)) continue;
    const gp = (o / c[i - 1] - 1) * 100;
    if (Math.abs(gp) >= Math.max(1.5 * sd, 1)) gaps.push({ i, gp });
  }
  gaps.sort((a, b) => Math.abs(b.gp) - Math.abs(a.gp)).slice(0, 8).forEach(({ i, gp }) => {
    const filled = gp > 0 ? pts[i].l <= c[i - 1] : pts[i].h >= c[i - 1];
    ev.push({ i, kind: "gap", dir: gp >= 0 ? 1 : -1, title: `Gap ${gp >= 0 ? "up" : "down"} ${cxPct(gp, 1)}`,
      text: `Opened ${cxPct(gp, 1)} from the prior close (${cxNum(c[i - 1])} → ${cxNum(pts[i].o)}); the gap was ${filled ? "filled intraday" : "left open at the close"}, closing at ${cxNum(c[i])}.${ctx(i)}` });
  });

  // 3 · 52-week extremes — first new high/low after a quiet spell
  let lastHi = -1e9, lastLo = -1e9;
  for (let i = barsYear; i < n; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - barsYear; j < i; j++) { if (c[j] > hi) hi = c[j]; if (c[j] < lo) lo = c[j]; }
    const gapBars = weekly ? 4 : 15;
    if (c[i] > hi && i - lastHi > gapBars) { lastHi = i; ev.push({ i, kind: "extreme", dir: 1, title: "New 52-week high", text: `Closed at ${cxNum(c[i])}, above the prior 52-week high of ${cxNum(hi)} — the first new high in over ${gapBars} ${unit}s.${follow(i)}${ctx(i)}` }); }
    if (c[i] < lo && i - lastLo > gapBars) { lastLo = i; ev.push({ i, kind: "extreme", dir: -1, title: "New 52-week low", text: `Closed at ${cxNum(c[i])}, below the prior 52-week low of ${cxNum(lo)} — the first new low in over ${gapBars} ${unit}s.${follow(i)}${ctx(i)}` }); }
  }

  // 4 · golden / death cross — 50 vs 200 average
  for (let i = 1; i < n; i++) {
    const a0 = ind.sma50[i - 1], b0 = ind.sma200[i - 1], a1 = ind.sma50[i], b1 = ind.sma200[i];
    if ([a0, b0, a1, b1].some((x) => x == null)) continue;
    if (a0 <= b0 && a1 > b1) ev.push({ i, kind: "cross", dir: 1, title: "Golden cross", text: `The 50-${weekly ? "week" : "day"} average (${cxNum(a1)}) crossed above the 200 (${cxNum(b1)}) — a classic long-term trend-up signal.${follow(i)}` });
    if (a0 >= b0 && a1 < b1) ev.push({ i, kind: "cross", dir: -1, title: "Death cross", text: `The 50-${weekly ? "week" : "day"} average (${cxNum(a1)}) crossed below the 200 (${cxNum(b1)}) — a classic long-term trend-down signal.${follow(i)}` });
  }

  // 5 · 200-DMA breaks — confirmed for 3 bars, one per 15 bars
  let lastTr = -1e9;
  for (let i = 1; i < n - 3; i++) {
    const m = ind.sma200; if (m[i - 1] == null || m[i] == null) continue;
    const up = c[i - 1] <= m[i - 1] && c[i] > m[i], dn = c[i - 1] >= m[i - 1] && c[i] < m[i];
    if (!(up || dn) || i - lastTr < 15) continue;
    const held = [1, 2, 3].every((k) => m[i + k] != null && (up ? c[i + k] > m[i + k] : c[i + k] < m[i + k]));
    if (!held) continue;
    lastTr = i;
    ev.push({ i, kind: "trend", dir: up ? 1 : -1, title: `${up ? "Reclaimed" : "Broke below"} 200-${weekly ? "WMA" : "DMA"}`,
      text: `Closed ${up ? "above" : "below"} the 200-${weekly ? "week" : "day"} average (${cxNum(m[i])}) and held there for three ${unit}s — ${up ? "the primary trend turned constructive" : "the primary trend turned defensive"}.${follow(i)}` });
  }

  // 6 · RSI extremes — entries into >70 / <30, one per 10 bars
  let lastR = -1e9;
  for (let i = 1; i < n; i++) {
    const r0 = ind.rsi[i - 1], r1 = ind.rsi[i]; if (r0 == null || r1 == null || i - lastR < 10) continue;
    if (r0 <= 70 && r1 > 70) { lastR = i; ev.push({ i, kind: "rsi", dir: 1, title: "RSI overbought (>70)", text: `RSI-14 rose to ${r1.toFixed(0)} — momentum stretched to the upside; overbought readings often precede consolidation.${follow(i)}` }); }
    if (r0 >= 30 && r1 < 30) { lastR = i; ev.push({ i, kind: "rsi", dir: -1, title: "RSI oversold (<30)", text: `RSI-14 fell to ${r1.toFixed(0)} — momentum stretched to the downside; oversold readings often precede relief bounces.${follow(i)}` }); }
  }
  return ev.sort((a, b) => a.i - b.i).map((e) => ({ ...e, t: pts[e.i].t }));
}

/* drawdown peak/trough inside the visible window (recomputed per view) */
function cxDrawdown(pts, i0, i1) {
  let peak = i0, best = { dd: 0, p: i0, q: i0 };
  for (let i = i0; i <= i1; i++) {
    if (pts[i].c > pts[peak].c) peak = i;
    const dd = (pts[i].c / pts[peak].c - 1) * 100;
    if (dd < best.dd) best = { dd, p: peak, q: i };
  }
  if (best.dd > -3) return [];
  let rec = null;
  for (let i = best.q; i <= i1; i++) if (pts[i].c >= pts[best.p].c) { rec = i; break; }
  const bars = best.q - best.p;
  return [
    { i: best.p, t: pts[best.p].t, kind: "dd", dir: 1, title: "Window peak", text: `Highest close before the deepest drawdown in view: ${cxNum(pts[best.p].c)}. The decline that followed lasted ${bars} bars.` },
    { i: best.q, t: pts[best.q].t, kind: "dd", dir: -1, title: `Max drawdown ${cxPct(best.dd, 1)}`, text: `Trough at ${cxNum(pts[best.q].c)}, ${cxPct(best.dd, 1)} below the ${cxDate(pts[best.p].t)} peak. ${rec != null ? `Fully recovered by ${cxDate(pts[rec].t)}.` : `Not yet recovered — price is ${cxPct((pts[i1].c / pts[best.p].c - 1) * 100, 1)} from the peak.`}` },
  ];
}

/* ════════════════════════════════════════════════════════════════════════
   CxChart — canvas engine
   ════════════════════════════════════════════════════════════════════════ */
class CxChart {
  constructor(cv, onEvent) {
    this.cv = cv; this.g = cv.getContext("2d");
    this.onEvent = onEvent;
    this.d = null;           // { pts, ind, events, compare:[{label,color,pts}], win0 }
    this.view = null;        // [i0, i1]
    this.opt = { type: "line", ind: new Set(), evOn: true, evFilter: new Set(Object.keys(CX_EVT)) };
    this.hx = null; this.hy = null;
    this._hits = [];
    this._bind();
  }
  setData(d, keepView) {
    const prev = this.view, nOld = this.d ? this.d.pts.length : 0;
    this.d = d;
    const n = d.pts.length;
    if (keepView && prev && nOld) {
      const span = prev[1] - prev[0];
      this.view = prev[1] >= nOld - 1 ? [Math.max(0, n - 1 - span), n - 1] : [Math.min(prev[0], n - 2), Math.min(prev[1], n - 1)];
    } else this.view = [Math.max(0, d.win0), n - 1];
    this.draw();
  }
  resetView() { if (this.d) { this.view = [this.d.win0, this.d.pts.length - 1]; this.draw(); } }
  focus(i) {
    if (!this.d) return;
    const n = this.d.pts.length, span = this.view[1] - this.view[0];
    let a = Math.round(i - span / 2), b = a + span;
    if (a < 0) { b -= a; a = 0; } if (b > n - 1) { a -= b - (n - 1); b = n - 1; a = Math.max(0, a); }
    this.view = [a, b]; this.draw();
  }
  visibleEvents() {
    if (!this.d || !this.view) return [];
    const [i0, i1] = this.view;
    const base = this.d.events.filter((e) => e.i >= i0 && e.i <= i1);
    return [...base, ...cxDrawdown(this.d.pts, i0, i1)].sort((a, b) => a.i - b.i);
  }
  _geom() {
    const w = this.cv.clientWidth, h = this.cv.clientHeight;
    const narrow = w < 520;
    const padL = narrow ? 46 : 60, padR = narrow ? 58 : 70, padT = 28, padB = 24;
    const ih = h - padT - padB, iw = w - padL - padR;
    const rsiH = this.opt.ind.has("rsi") && !this._multi() ? Math.round(ih * 0.22) : 0;
    const gap = rsiH ? 14 : 0;
    return { w, h, padL, padR, padT, padB, iw, ph: ih - rsiH - gap, rsiH, rsiTop: padT + ih - rsiH };
  }
  _multi() { return !!(this.d && this.d.compare && this.d.compare.length); }
  _idxAt(clientX) {
    const r = this.cv.getBoundingClientRect(), G = this._geom();
    const [i0, i1] = this.view, cnt = i1 - i0 + 1;
    const f = (clientX - r.left - G.padL) / G.iw;
    return Math.min(i1, Math.max(i0, i0 + Math.floor(f * cnt)));
  }
  _bind() {
    const cv = this.cv;
    cv.addEventListener("wheel", (e) => {
      if (!this.view) return;
      e.preventDefault();
      const n = this.d.pts.length, [i0, i1] = this.view, span = i1 - i0;
      const anchor = this._idxAt(e.clientX), fx = span ? (anchor - i0) / span : 0.5;
      const ns = Math.min(n - 1, Math.max(12, Math.round(span * (e.deltaY > 0 ? 1.2 : 0.83))));
      let a = Math.round(anchor - fx * ns), b = a + ns;
      if (a < 0) { b -= a; a = 0; } if (b > n - 1) { a -= b - (n - 1); b = n - 1; a = Math.max(0, a); }
      this.view = [a, b]; this.draw();
    }, { passive: false });
    let down = null, dv = null, moved = false;
    cv.addEventListener("mousedown", (e) => { down = e.clientX; dv = this.view && [...this.view]; moved = false; });
    window.addEventListener("mouseup", (e) => {
      if (down != null && !moved) {
        const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
        const hit = this._hits.find((b) => Math.abs(b.x - mx) < 9 && Math.abs(b.y - my) < 9);
        if (hit && this.onEvent) this.onEvent(hit.ev, hit.x, hit.y);
      }
      down = null; dv = null; cv.style.cursor = "crosshair";
    });
    cv.addEventListener("mousemove", (e) => {
      if (!this.view) return;
      const r = cv.getBoundingClientRect();
      if (down != null && dv) {
        if (Math.abs(e.clientX - down) > 4) { moved = true; cv.style.cursor = "grabbing"; }
        const n = this.d.pts.length, span = dv[1] - dv[0], G = this._geom();
        const shift = Math.round(((down - e.clientX) / G.iw) * (span + 1));
        let a = dv[0] + shift, b = dv[1] + shift;
        if (a < 0) { b -= a; a = 0; } if (b > n - 1) { a -= b - (n - 1); b = n - 1; a = Math.max(0, a); }
        this.view = [a, b];
      } else {
        this.hx = this._idxAt(e.clientX); this.hy = e.clientY - r.top;
        const mx = e.clientX - r.left;
        cv.style.cursor = this._hits.some((b) => Math.abs(b.x - mx) < 9 && Math.abs(b.y - this.hy) < 9) ? "pointer" : "crosshair";
      }
      this.draw();
    });
    cv.addEventListener("mouseleave", () => { this.hx = null; this.hy = null; this.draw(); });
    cv.addEventListener("dblclick", () => this.resetView());
  }

  draw() {
    const dpr = window.devicePixelRatio || 1;
    const G = this._geom(), { w, h } = G;
    if (!w || !h) return;
    if (this.cv.width !== Math.round(w * dpr) || this.cv.height !== Math.round(h * dpr)) { this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr); }
    const g = this.g; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    this._hits = [];
    if (!this.d || !this.view || this.d.pts.length < 2) {
      g.fillStyle = CX_COL.axis; g.font = "11px 'IBM Plex Mono', monospace"; g.fillText("loading series…", G.padL, h / 2); return;
    }
    const { pts, ind } = this.d, [i0, i1] = this.view, cnt = i1 - i0 + 1;
    const multi = this._multi(), type = multi ? "line" : this.opt.type;
    const X = (i) => G.padL + ((i - i0 + 0.5) / cnt) * G.iw;
    const bw = Math.max(1, Math.min(14, (G.iw / cnt) * 0.66));

    /* values in view (raw, or % from first visible bar when comparing) */
    const base = pts[i0].c;
    const val = (c) => (multi ? (c / base - 1) * 100 : c);
    const cmp = multi ? this.d.compare.map((s) => {
      const b0 = s.byT(pts[i0].t);
      return { ...s, v: (i) => { const c = s.byT(pts[i].t); return c != null && b0 ? (c / b0 - 1) * 100 : null; } };
    }) : [];
    let lo = Infinity, hi = -Infinity;
    const take = (v) => { if (v != null && isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } };
    for (let i = i0; i <= i1; i++) {
      const p = pts[i];
      if (type === "candle" || type === "bar") { take(p.h); take(p.l); } else take(val(p.c));
      if (!multi) {
        ["sma20", "sma50", "sma200", "ema20"].forEach((k) => this.opt.ind.has(k) && take(ind[k][i]));
        if (this.opt.ind.has("bb")) { take(ind.bb.up[i]); take(ind.bb.lo[i]); }
      }
      cmp.forEach((s) => take(s.v(i)));
    }
    if (hi === lo) { hi += 1; lo -= 1; }
    const padV = (hi - lo) * 0.08; hi += padV; lo -= padV;
    const Y = (v) => G.padT + (1 - (v - lo) / (hi - lo)) * G.ph;
    const fmt = multi ? (v) => cxPct(v, 1) : (v) => (Math.abs(v) >= 1000 ? v.toLocaleString("en-IN", { maximumFractionDigits: 0 }) : v.toFixed(2));

    /* grid + y labels (left) */
    g.font = "10.5px 'IBM Plex Mono', monospace"; g.textAlign = "right"; g.textBaseline = "middle";
    for (let k = 0; k <= 5; k++) {
      const v = lo + ((hi - lo) * k) / 5, y = Y(v);
      g.strokeStyle = CX_COL.grid; g.lineWidth = 1;
      g.beginPath(); g.moveTo(G.padL, Math.round(y) + 0.5); g.lineTo(w - G.padR, Math.round(y) + 0.5); g.stroke();
      g.fillStyle = CX_COL.axis; g.fillText(fmt(v), G.padL - 8, y);
    }
    /* x labels */
    const spanDays = (pts[i1].t - pts[i0].t) / 864e5;
    g.textAlign = "center"; g.textBaseline = "alphabetic";
    const ticks = Math.max(2, Math.min(8, Math.floor(G.iw / 110)));
    for (let k = 0; k <= ticks; k++) {
      const i = Math.round(i0 + ((cnt - 1) * k) / ticks), x = X(i);
      g.strokeStyle = "rgba(255,255,255,.03)"; g.beginPath(); g.moveTo(x, G.padT); g.lineTo(x, G.padT + G.ph); g.stroke();
      g.fillStyle = CX_COL.axis;
      g.textAlign = k === 0 ? "left" : k === ticks ? "right" : "center";
      g.fillText(new Date(pts[i].t).toLocaleDateString("en-IN", spanDays > 150 ? { month: "short", year: "2-digit" } : { day: "2-digit", month: "short" }), k === 0 ? G.padL : k === ticks ? w - G.padR : x, h - 7);
    }

    const first = pts[i0].c, last = pts[i1].c, upPerf = last >= first;
    const col = upPerf ? CX_COL.up : CX_COL.down;
    const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };

    /* volume — bottom 20% of the price pane */
    if (!multi && this.opt.ind.has("vol")) {
      let vmax = 0; for (let i = i0; i <= i1; i++) vmax = Math.max(vmax, pts[i].v || 0);
      if (vmax > 0) for (let i = i0; i <= i1; i++) {
        const v = pts[i].v || 0, bh = (v / vmax) * G.ph * 0.2, up = i === 0 || pts[i].c >= pts[i - 1].c;
        g.fillStyle = up ? "rgba(46,189,133,.22)" : "rgba(240,82,79,.22)";
        g.fillRect(X(i) - bw / 2, G.padT + G.ph - bh, bw, bh);
      }
    }

    /* Bollinger band fill under the price */
    if (!multi && this.opt.ind.has("bb")) {
      g.beginPath(); let started = false;
      for (let i = i0; i <= i1; i++) { const v = ind.bb.up[i]; if (v == null) continue; started ? g.lineTo(X(i), Y(v)) : (g.moveTo(X(i), Y(v)), started = true); }
      for (let i = i1; i >= i0; i--) { const v = ind.bb.lo[i]; if (v == null) continue; g.lineTo(X(i), Y(v)); }
      g.closePath(); g.fillStyle = "rgba(143,160,179,.07)"; g.fill();
    }

    /* primary series */
    const linePath = () => { g.beginPath(); for (let i = i0; i <= i1; i++) { const x = X(i), y = Y(val(pts[i].c)); i === i0 ? g.moveTo(x, y) : g.lineTo(x, y); } };
    if (type === "line") {
      const lc = multi ? MC_PALETTE[0] : col;
      linePath(); g.lineTo(X(i1), G.padT + G.ph); g.lineTo(X(i0), G.padT + G.ph); g.closePath();
      const minY = Math.min(...pts.slice(i0, i1 + 1).map((p) => Y(val(p.c))));
      const gr = g.createLinearGradient(0, minY, 0, G.padT + G.ph);
      gr.addColorStop(0, rgba(lc, multi ? 0.18 : 0.46)); gr.addColorStop(0.45, rgba(lc, multi ? 0.07 : 0.18)); gr.addColorStop(1, rgba(lc, 0));
      g.fillStyle = gr; g.fill();
      linePath(); g.save(); g.shadowColor = rgba(lc, 0.75); g.shadowBlur = 10;
      g.strokeStyle = lc; g.lineWidth = 1.8; g.lineJoin = "round"; g.stroke(); g.restore();
    } else if (type === "baseline") {
      const yb = Y(first);
      ["up", "down"].forEach((side) => {
        g.save(); g.beginPath();
        side === "up" ? g.rect(G.padL, G.padT, G.iw, yb - G.padT) : g.rect(G.padL, yb, G.iw, G.padT + G.ph - yb);
        g.clip();
        const c2 = side === "up" ? CX_COL.up : CX_COL.down;
        linePath(); g.lineTo(X(i1), yb); g.lineTo(X(i0), yb); g.closePath();
        const gr = g.createLinearGradient(0, side === "up" ? G.padT : G.padT + G.ph, 0, yb);
        gr.addColorStop(0, rgba(c2, 0.4)); gr.addColorStop(1, rgba(c2, 0.02));
        g.fillStyle = gr; g.fill();
        linePath(); g.strokeStyle = c2; g.lineWidth = 1.7; g.stroke();
        g.restore();
      });
      g.setLineDash([4, 4]); g.strokeStyle = "rgba(233,228,218,.35)";
      g.beginPath(); g.moveTo(G.padL, yb); g.lineTo(w - G.padR, yb); g.stroke(); g.setLineDash([]);
    } else {
      for (let i = i0; i <= i1; i++) {
        const p = pts[i], up = p.c >= p.o, c2 = up ? CX_COL.up : CX_COL.down, x = X(i);
        g.strokeStyle = c2; g.fillStyle = c2; g.lineWidth = 1;
        if (type === "candle") {
          g.beginPath(); g.moveTo(x, Y(p.h)); g.lineTo(x, Y(p.l)); g.stroke();
          const yo = Y(p.o), yc = Y(p.c), top = Math.min(yo, yc), bh = Math.max(1, Math.abs(yc - yo));
          if (up) { g.fillStyle = rgba(c2, 0.85); } g.fillRect(x - bw / 2, top, bw, bh);
        } else {
          g.beginPath(); g.moveTo(x, Y(p.h)); g.lineTo(x, Y(p.l));
          g.moveTo(x - bw / 2, Y(p.o)); g.lineTo(x, Y(p.o)); g.moveTo(x, Y(p.c)); g.lineTo(x + bw / 2, Y(p.c)); g.stroke();
        }
      }
    }

    /* compare overlays */
    cmp.forEach((s) => {
      g.beginPath(); let st = false;
      for (let i = i0; i <= i1; i++) { const v = s.v(i); if (v == null) continue; st ? g.lineTo(X(i), Y(v)) : (g.moveTo(X(i), Y(v)), st = true); }
      g.strokeStyle = s.color; g.lineWidth = 1.5; g.stroke();
    });
    if (multi && lo < 0 && hi > 0) { g.setLineDash([3, 4]); g.strokeStyle = "rgba(233,228,218,.25)"; g.beginPath(); g.moveTo(G.padL, Y(0)); g.lineTo(w - G.padR, Y(0)); g.stroke(); g.setLineDash([]); }

    /* moving averages + band edges */
    if (!multi) {
      CX_IND.forEach(([k, , c2]) => {
        if (!this.opt.ind.has(k) || !["sma20", "sma50", "sma200", "ema20"].includes(k)) return;
        g.beginPath(); let st = false;
        for (let i = i0; i <= i1; i++) { const v = ind[k][i]; if (v == null) continue; st ? g.lineTo(X(i), Y(v)) : (g.moveTo(X(i), Y(v)), st = true); }
        g.strokeStyle = c2; g.lineWidth = 1.25; g.stroke();
      });
      if (this.opt.ind.has("bb")) {
        g.setLineDash([4, 3]); g.strokeStyle = "rgba(143,160,179,.6)"; g.lineWidth = 1;
        ["up", "lo"].forEach((k) => { g.beginPath(); let st = false; for (let i = i0; i <= i1; i++) { const v = ind.bb[k][i]; if (v == null) continue; st ? g.lineTo(X(i), Y(v)) : (g.moveTo(X(i), Y(v)), st = true); } g.stroke(); });
        g.setLineDash([]);
      }
    }

    /* last-price line + badge on the right axis */
    const lv = val(last), ly = Y(lv), badgeCol = multi ? MC_PALETTE[0] : col;
    g.setLineDash([2, 3]); g.strokeStyle = rgba(badgeCol, 0.7); g.lineWidth = 1;
    g.beginPath(); g.moveTo(G.padL, ly); g.lineTo(w - G.padR + 2, ly); g.stroke(); g.setLineDash([]);
    const drawBadge = (y, text, bg, fg = "#fff", top = G.padT, bottom = G.padT + G.ph) => {
      g.font = "600 11px 'IBM Plex Mono', monospace";
      const tw = g.measureText(text).width + 12, bx = w - G.padR + 4, by = Math.max(top, Math.min(bottom - 18, y - 9));
      g.fillStyle = bg; g.beginPath(); g.roundRect ? g.roundRect(bx, by, tw, 18, 3) : g.rect(bx, by, tw, 18); g.fill();
      g.fillStyle = fg; g.textAlign = "left"; g.textBaseline = "middle"; g.fillText(text, bx + 6, by + 9.5);
    };
    drawBadge(ly, fmt(lv), badgeCol);
    g.beginPath(); g.arc(X(i1), ly, 3.5, 0, Math.PI * 2); g.fillStyle = badgeCol; g.fill();
    g.beginPath(); g.arc(X(i1), ly, 7, 0, Math.PI * 2); g.fillStyle = rgba(badgeCol, 0.22); g.fill();

    /* event markers */
    if (!multi && this.opt.evOn) {
      for (const e of this.visibleEvents()) {
        if (!this.opt.evFilter.has(e.kind)) continue;
        const p = pts[e.i], x = X(e.i);
        const yRef = type === "candle" || type === "bar" ? (e.dir > 0 ? p.h : p.l) : p.c;
        const y = Y(val(yRef)) + (e.dir > 0 ? -13 : 13);
        const c2 = e.kind === "move" || e.kind === "gap" || e.kind === "trend" || e.kind === "extreme" || e.kind === "rsi"
          ? (e.dir > 0 ? CX_COL.up : CX_COL.down) : CX_EVT[e.kind].color;
        this._marker(e.kind, e.dir, x, y, c2);
        this._hits.push({ x, y, ev: e });
      }
    }

    /* RSI pane */
    if (G.rsiH) {
      const top = G.rsiTop, RH = G.rsiH, RY = (v) => top + (1 - v / 100) * RH;
      g.fillStyle = "rgba(255,255,255,.02)"; g.fillRect(G.padL, top, G.iw, RH);
      g.fillStyle = "rgba(212,177,74,.06)"; g.fillRect(G.padL, RY(70), G.iw, RY(30) - RY(70));
      g.setLineDash([3, 3]); g.strokeStyle = "rgba(233,228,218,.18)";
      [70, 30].forEach((v) => { g.beginPath(); g.moveTo(G.padL, RY(v)); g.lineTo(w - G.padR, RY(v)); g.stroke(); });
      g.setLineDash([]);
      g.font = "10px 'IBM Plex Mono', monospace"; g.fillStyle = CX_COL.axis; g.textAlign = "right"; g.textBaseline = "middle";
      g.fillText("70", G.padL - 8, RY(70)); g.fillText("30", G.padL - 8, RY(30));
      g.textAlign = "left"; g.fillText("RSI 14", G.padL + 6, top + 9);
      g.beginPath(); let st = false;
      for (let i = i0; i <= i1; i++) { const v = ind.rsi[i]; if (v == null) continue; st ? g.lineTo(X(i), RY(v)) : (g.moveTo(X(i), RY(v)), st = true); }
      g.strokeStyle = "#d4b14a"; g.lineWidth = 1.3; g.stroke();
      const rl = ind.rsi[i1];
      if (rl != null) drawBadge(RY(rl), rl.toFixed(1), "#8a7424", "#fff", top, top + RH);
    }

    /* crosshair + legend (hovered bar, else last) */
    const hi2 = this.hx != null ? this.hx : i1, hp = pts[hi2];
    if (this.hx != null) {
      const x = X(hi2);
      g.strokeStyle = "rgba(233,228,218,.28)"; g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(x, G.padT); g.lineTo(x, h - G.padB); g.stroke();
      if (this.hy != null && this.hy >= G.padT && this.hy <= G.padT + G.ph) {
        g.beginPath(); g.moveTo(G.padL, this.hy); g.lineTo(w - G.padR, this.hy); g.stroke();
        const v = lo + (1 - (this.hy - G.padT) / G.ph) * (hi - lo);
        g.setLineDash([]); drawBadge(this.hy, fmt(v), "#2a2f36", "#e9e4da");
      }
      g.setLineDash([]);
      const ds = cxDate(hp.t);
      g.font = "10.5px 'IBM Plex Mono', monospace";
      const tw = g.measureText(ds).width + 12;
      g.fillStyle = "#2a2f36"; g.fillRect(x - tw / 2, h - G.padB + 3, tw, 17);
      g.fillStyle = "#e9e4da"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(ds, x, h - G.padB + 12);
    }
    this._legend(G, hp, hi2, multi, cmp, fmt, val);
  }

  _marker(kind, dir, x, y, c) {
    const g = this.g;
    g.save(); g.fillStyle = c; g.strokeStyle = "rgba(10,12,15,.95)"; g.lineWidth = 1.2;
    g.beginPath();
    if (kind === "move") {           // triangle
      if (dir > 0) { g.moveTo(x, y - 6); g.lineTo(x - 5.5, y + 4); g.lineTo(x + 5.5, y + 4); }
      else { g.moveTo(x, y + 6); g.lineTo(x - 5.5, y - 4); g.lineTo(x + 5.5, y - 4); }
      g.closePath(); g.fill(); g.stroke();
    } else if (kind === "gap") {     // diamond
      g.moveTo(x, y - 6); g.lineTo(x + 5, y); g.lineTo(x, y + 6); g.lineTo(x - 5, y); g.closePath(); g.fill(); g.stroke();
    } else if (kind === "extreme") { // ring
      g.arc(x, y, 5, 0, Math.PI * 2); g.lineWidth = 2.2; g.strokeStyle = c; g.stroke();
    } else if (kind === "cross") {   // X in a disc
      g.arc(x, y, 6.5, 0, Math.PI * 2); g.fill(); g.stroke();
      g.beginPath(); g.strokeStyle = "#101114"; g.lineWidth = 1.6;
      g.moveTo(x - 3, y - 3); g.lineTo(x + 3, y + 3); g.moveTo(x + 3, y - 3); g.lineTo(x - 3, y + 3); g.stroke();
    } else if (kind === "trend") {   // square
      g.rect(x - 4.5, y - 4.5, 9, 9); g.fill(); g.stroke();
    } else if (kind === "rsi") {     // small disc with inner dot
      g.arc(x, y, 5, 0, Math.PI * 2); g.fill(); g.stroke();
      g.beginPath(); g.arc(x, y, 1.8, 0, Math.PI * 2); g.fillStyle = "#101114"; g.fill();
    } else {                          // drawdown: flag
      g.moveTo(x, y + 6); g.lineTo(x, y - 6); g.lineTo(x + 7, y - 3); g.lineTo(x, y); g.lineWidth = 1.6; g.strokeStyle = c; g.stroke();
    }
    g.restore();
  }

  _legend(G, p, i, multi, cmp, fmt, val) {
    const g = this.g, ind = this.d.ind;
    g.font = "11px 'IBM Plex Mono', monospace"; g.textAlign = "left"; g.textBaseline = "middle";
    let x = G.padL + 2; const y = 12;
    const maxX = G.padL + G.iw;   // never run past the plot into the price axis
    const put = (text, color) => {
      const tw = g.measureText(text).width;
      if (x + tw > maxX) return;
      g.fillStyle = color; g.fillText(text, x, y); x += tw + 12;
    };
    if (multi) {
      put(`${this.d.label} ${fmt(val(p.c))}`, MC_PALETTE[0]);
      cmp.forEach((s) => { const v = s.v(i); put(`${s.label} ${v == null ? "—" : fmt(v)}`, s.color); });
      return;
    }
    const prev = i > 0 ? this.d.pts[i - 1].c : null, chg = prev ? (p.c / prev - 1) * 100 : null;
    put(cxDate(p.t), CX_COL.axis);
    if (p.o != null && p.h != null) { put(`O ${cxNum(p.o)}`, "#c9c4ba"); put(`H ${cxNum(p.h)}`, "#c9c4ba"); put(`L ${cxNum(p.l)}`, "#c9c4ba"); }
    put(`C ${cxNum(p.c)}`, "#e9e4da");
    if (chg != null) put(cxPct(chg), chg >= 0 ? CX_COL.up : CX_COL.down);
    if (this.opt.ind.has("vol") && p.v) put(`Vol ${F.num(p.v / 1e6, 2)}M`, "#8a93a0");
    CX_IND.forEach(([k, l, c]) => {
      if (!this.opt.ind.has(k) || !["sma20", "sma50", "sma200", "ema20"].includes(k)) return;
      const v = ind[k][i]; if (v != null) put(`${l} ${cxNum(v)}`, c);
    });
    if (this.opt.ind.has("bb") && ind.bb.up[i] != null) put(`BB ${cxNum(ind.bb.lo[i])} – ${cxNum(ind.bb.up[i])}`, "#8fa0b3");
  }
}

/* ════════════════════════════════════════════════════════════════════════
   CHARTX — the Chart Analysis module
   ════════════════════════════════════════════════════════════════════════ */
const CHARTX = {
  main: { s: "^NSEI", l: "NIFTY 50" },
  compare: [],
  chart: null,
  // [label, visible days, fetch range (with look-back), interval]
  RANGES: [["1M", 31, "1y", "1d"], ["3M", 92, "2y", "1d"], ["6M", 183, "2y", "1d"], ["1Y", 365, "2y", "1d"], ["5Y", 1826, "10y", "1d"]],
  PREF_KEY: "meridian_cx_prefs",
  _tf: "1Y",
  // candle size: daily or weekly bars over the chosen window (weekly fetches a longer look-back so the 50/200 averages exist)
  _iv: "1d",
  WEEKLY_RANGE: { "1M": "2y", "3M": "2y", "6M": "5y", "1Y": "5y", "5Y": "10y" },
  _seq: 0,
  _mounted: false,

  _prefs() {
    try { return JSON.parse(localStorage.getItem(this.PREF_KEY) || "{}"); } catch { return {}; }
  },
  _savePrefs() {
    const o = this.chart.opt;
    try { localStorage.setItem(this.PREF_KEY, JSON.stringify({ type: o.type, ind: [...o.ind], evOn: o.evOn, evFilter: [...o.evFilter], tf: this._tf, iv: this._iv })); } catch { }
  },

  mount() {
    const host = $("#miPriceChart");
    if (!host) return;
    if (!this._mounted) {
      this._mounted = true;
      const P = this._prefs();
      if (P.tf && this.RANGES.some(([l]) => l === P.tf)) this._tf = P.tf;
      if (P.iv === "1d" || P.iv === "1wk") this._iv = P.iv;
      host.innerHTML = `
        <div class="cx">
          <div class="cx-bar">
            <div class="cx-search cx-main-search"><input id="cxSearch" placeholder="Search ticker or name — stocks · indices · rates · FX · commodities · crypto" autocomplete="off" spellcheck="false" /><div class="cx-drop" id="cxDrop" hidden></div></div>
            <div class="cx-tf" id="cxTf">${this.RANGES.map(([l]) => `<button class="cx-tfb ${l === this._tf ? "on" : ""}" data-cxtf="${l}" type="button">${l}</button>`).join("")}</div>
            <div class="cx-tf" id="cxIv" title="Candle size">${[["1d", "D", "Daily candles"], ["1wk", "W", "Weekly candles"]].map(([k, l, t]) => `<button class="cx-tfb ${k === this._iv ? "on" : ""}" data-cxiv="${k}" type="button" title="${t}">${l}</button>`).join("")}</div>
            <div class="mc-chips" id="cxChips"></div>
            <div class="cx-tools">
              <div class="cx-dd" id="cxTypeDD">
                <button class="cx-btn" type="button" data-dd="cxTypeMenu"><span class="cx-ic" id="cxTypeIc">${CX_ICON.line}</span><span id="cxTypeLbl">Line</span><span class="cx-caret">${CX_ICON.caret}</span></button>
                <div class="cx-menu" id="cxTypeMenu" hidden>${CX_TYPES.map(([k, l]) => `<button class="cx-mi" type="button" data-type="${k}"><span class="cx-chk"></span>${l}</button>`).join("")}</div>
              </div>
              <div class="cx-dd" id="cxIndDD">
                <button class="cx-btn" type="button" data-dd="cxIndMenu"><span class="cx-ic">${CX_ICON.ind}</span>Indicators<span class="cx-badge" id="cxIndCount" hidden></span><span class="cx-caret">${CX_ICON.caret}</span></button>
                <div class="cx-menu cx-menu-wide" id="cxIndMenu" hidden>
                  <div class="cx-mh mono">OVERLAYS &amp; PANES</div>
                  ${CX_IND.map(([k, l, c]) => `<button class="cx-mi" type="button" data-ind="${k}"><span class="cx-chk"></span><i class="cx-sw" style="background:${c}"></i>${l}</button>`).join("")}
                  <div class="cx-mh mono">COMPARE (MAX 4 · % AXIS)</div>
                  <div class="cx-search cx-cmp"><input id="cxCmp" placeholder="+ add ticker to compare" autocomplete="off" spellcheck="false" /><div class="cx-drop" id="cxCmpDrop" hidden></div></div>
                </div>
              </div>
              <div class="cx-dd cx-split" id="cxEvDD">
                <button class="cx-btn cx-ev-toggle" type="button" id="cxEvToggle" title="Show / hide event markers"><span class="cx-ic">${CX_ICON.ev}</span>Events<span class="cx-badge" id="cxEvCount"></span></button>
                <button class="cx-btn cx-ev-caret" type="button" data-dd="cxEvMenu" title="Event list &amp; filters"><span class="cx-caret">${CX_ICON.caret}</span></button>
                <div class="cx-menu cx-evmenu" id="cxEvMenu" hidden>
                  <div class="cx-ev-head"><span class="mono">EVENTS IN VIEW</span><label class="cx-switch"><input type="checkbox" id="cxEvOn" /><span></span> Show on chart</label></div>
                  <div class="cx-ev-filters" id="cxEvFilters"></div>
                  <div class="cx-ev-list" id="cxEvList"></div>
                </div>
              </div>
              <button class="cx-btn" type="button" id="cxFull"><span class="cx-ic">${CX_ICON.full}</span><span>Fullscreen</span></button>
            </div>
          </div>
          <div class="mi-cx-body">
            <div class="mi-cx-main">
              <div class="mc-cvwrap cx-cvwrap">
                <canvas class="cx-cv" id="cxCv"></canvas>
                <div class="mc-pop" id="cxPop" hidden></div>
              </div>
            </div>
            <div class="mi-cx-stats" id="cxStats"></div>
          </div>
          <div class="cx-foot"><div class="mc-note" id="cxNote"></div><span class="mc-hint mono">wheel zoom · drag pan · dbl-click reset · click a marker for its read</span></div>
        </div>`;

      this.chart = new CxChart($("#cxCv"), (ev, x, y) => this._pop(ev, x, y));
      const o = this.chart.opt;
      if (P.type && CX_TYPES.some(([k]) => k === P.type)) o.type = P.type;
      o.ind = new Set(Array.isArray(P.ind) ? P.ind : ["sma50", "sma200", "vol"]);
      if (typeof P.evOn === "boolean") o.evOn = P.evOn;
      if (Array.isArray(P.evFilter)) o.evFilter = new Set(P.evFilter.filter((k) => CX_EVT[k]));
      this._syncControls();

      if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => this.chart.draw()).observe($("#cxCv"));
      this._wireSearch($("#cxSearch"), $("#cxDrop"), (hit) => this.load(hit.s, hit.l));
      this._wireSearch($("#cxCmp"), $("#cxCmpDrop"), (hit) => { this.addCompare(hit.s, hit.l); $("#cxCmp").value = ""; });
      this._wireControls(host);
      $("#cxSearch").value = this.main.l;
    }
    this._fetch();
  },

  _wireControls(host) {
    const o = this.chart.opt;
    const closeMenus = (except) => $$(".cx-menu", host).forEach((m) => { if (m.id !== except) m.hidden = true; });
    host.addEventListener("click", (e) => {
      const dd = e.target.closest("[data-dd]");
      if (dd) { const m = $("#" + dd.dataset.dd); closeMenus(m.id); m.hidden = !m.hidden; if (m.id === "cxEvMenu" && !m.hidden) this._renderEvents(); return; }
      const iv = e.target.closest("[data-cxiv]");
      if (iv) {
        this._iv = iv.dataset.cxiv;
        $$("[data-cxiv]", host).forEach((b) => b.classList.toggle("on", b === iv));
        this._savePrefs(); this._fetch(); return;
      }
      const tf = e.target.closest("[data-cxtf]");
      if (tf) {
        this._tf = tf.dataset.cxtf;
        $$("[data-cxtf]", host).forEach((b) => b.classList.toggle("on", b === tf));
        this._savePrefs(); this._fetch(); return;
      }
      const ty = e.target.closest("[data-type]");
      if (ty) { o.type = ty.dataset.type; closeMenus(); this._syncControls(); this._savePrefs(); this.chart.draw(); return; }
      const ind = e.target.closest("[data-ind]");
      if (ind) { const k = ind.dataset.ind; o.ind.has(k) ? o.ind.delete(k) : o.ind.add(k); this._syncControls(); this._savePrefs(); this.chart.draw(); return; }
      const ef = e.target.closest("[data-evf]");
      if (ef) { const k = ef.dataset.evf; o.evFilter.has(k) ? o.evFilter.delete(k) : o.evFilter.add(k); this._savePrefs(); this.chart.draw(); this._renderEvents(); return; }
      const ei = e.target.closest("[data-evi]");
      if (ei) {
        const ev = this.chart.visibleEvents().find((x) => String(x.i) === ei.dataset.evi && x.kind === ei.dataset.evk);
        if (ev) { if (!o.evOn) { o.evOn = true; this._syncControls(); } this.chart.focus(ev.i); closeMenus(); requestAnimationFrame(() => { const hit = this.chart._hits.find((h) => h.ev.i === ev.i && h.ev.kind === ev.kind); if (hit) this._pop(ev, hit.x, hit.y); }); }
        return;
      }
      const rm = e.target.closest("[data-rm]");
      if (rm) { this.compare = this.compare.filter((c) => c.s !== rm.dataset.rm); this._chips(); this._fetch(); }
    });
    // clicks outside any dropdown close them
    document.addEventListener("click", (e) => { if (!e.target.closest(".cx-dd")) closeMenus(); });
    $("#cxEvToggle").addEventListener("click", () => { o.evOn = !o.evOn; this._syncControls(); this._savePrefs(); this.chart.draw(); });
    $("#cxEvOn").addEventListener("change", (e) => { o.evOn = e.target.checked; this._syncControls(); this._savePrefs(); this.chart.draw(); });
    // fullscreen — the whole panel, chart grows to the screen
    // Native fullscreen where the browser allows it; where it doesn't (embedded
    // webviews, iframes without allowfullscreen) the panel maximises over the
    // window instead — same layout, Esc or the button restores it.
    const panel = $("#miChartPanel");
    const paint = (on) => {
      $("#cxFull").innerHTML = `<span class="cx-ic">${on ? CX_ICON.exit : CX_ICON.full}</span><span>${on ? "Exit" : "Fullscreen"}</span>`;
      $("#cxFull").classList.toggle("on", on);
      document.body.classList.toggle("cx-noscroll", panel.classList.contains("cx-max"));
      setTimeout(() => this.chart.draw(), 60);
    };
    const setMax = (on) => { panel.classList.toggle("cx-max", on); paint(on); };
    $("#cxFull").addEventListener("click", () => {
      if (document.fullscreenElement) { document.exitFullscreen(); return; }
      if (panel.classList.contains("cx-max")) { setMax(false); return; }
      // Some embedded browsers reject, some grant-then-drop, some leave the
      // request pending forever. Whatever happens, if we are not actually
      // fullscreen half a second later, maximise over the window instead.
      try { const req = panel.requestFullscreen && panel.requestFullscreen(); if (req && req.catch) req.catch(() => {}); } catch { }
      setTimeout(() => { if (document.fullscreenElement !== panel && !panel.classList.contains("cx-max")) setMax(true); }, 500);
    });
    document.addEventListener("fullscreenchange", () => {
      const fs = document.fullscreenElement === panel;
      if (fs) panel.classList.remove("cx-max");   // native won the race
      paint(fs);
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && panel.classList.contains("cx-max")) setMax(false); });
    // chart-local keys: Esc closes menus, R resets zoom
    host.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenus(); });
  },

  _syncControls() {
    const o = this.chart.opt;
    const lbl = (CX_TYPES.find(([k]) => k === o.type) || CX_TYPES[0])[1];
    $("#cxTypeLbl").textContent = this.compare.length ? "Line" : lbl;
    $("#cxTypeIc").innerHTML = o.type === "candle" || o.type === "bar" ? CX_ICON.candle : CX_ICON.line;
    $$("#cxTypeMenu [data-type]").forEach((b) => b.classList.toggle("on", b.dataset.type === o.type));
    $$("#cxIndMenu [data-ind]").forEach((b) => b.classList.toggle("on", o.ind.has(b.dataset.ind)));
    const cnt = $("#cxIndCount"); cnt.hidden = !o.ind.size; cnt.textContent = o.ind.size;
    $("#cxEvToggle").classList.toggle("on", o.evOn);
    const sw = $("#cxEvOn"); if (sw) sw.checked = o.evOn;
  },

  _renderEvents() {
    const o = this.chart.opt, evs = this.chart.visibleEvents();
    const byKind = {}; evs.forEach((e) => (byKind[e.kind] = (byKind[e.kind] || 0) + 1));
    $("#cxEvFilters").innerHTML = Object.entries(CX_EVT).map(([k, m]) =>
      `<button class="cx-evf ${o.evFilter.has(k) ? "on" : ""}" type="button" data-evf="${k}"><i style="background:${m.color}"></i>${m.label}<b>${byKind[k] || 0}</b></button>`).join("");
    const list = evs.filter((e) => o.evFilter.has(e.kind)).reverse();
    $("#cxEvList").innerHTML = list.length ? list.map((e) => `
      <button class="cx-evi" type="button" data-evi="${e.i}" data-evk="${e.kind}">
        <span class="cx-evi-d mono">${cxDate(e.t)}</span>
        <span class="cx-evi-b"><b class="${e.dir > 0 ? "up" : "down"}">${esc(e.title)}</b><small>${esc(CX_EVT[e.kind].label)}</small><span>${esc(e.text)}</span></span>
      </button>`).join("") : `<div class="empty-mini mono">No events of the selected types in this range.</div>`;
    const c = $("#cxEvCount"); c.textContent = evs.filter((e) => o.evFilter.has(e.kind)).length;
  },

  /* combined suggestions: macro presets by label/symbol + live ticker search */
  _wireSearch(input, drop, onPick) {
    let t = null, seq = 0;
    const close = () => { drop.hidden = true; };
    const render = (presets, tickers) => {
      if (!presets.length && !tickers.length) { close(); return; }
      drop.innerHTML =
        (presets.length ? `<div class="cx-dh mono">MACRO</div>` + presets.map((p) => `<button class="cx-di" type="button" data-s="${esc(p[0])}" data-l="${esc(p[1])}"><b>${esc(p[1])}</b><span class="mono">${esc(p[0])} · ${esc(p[2])}</span></button>`).join("") : "") +
        (tickers.length ? `<div class="cx-dh mono">TICKERS</div>` + tickers.map((r) => `<button class="cx-di" type="button" data-s="${esc(r.symbol)}" data-l="${esc(r.name || r.symbol)}"><b>${esc(r.symbol)}</b><span class="mono">${esc((r.name || "").slice(0, 42))}${r.exchange ? " · " + esc(r.exchange) : ""}</span></button>`).join("") : "");
      drop.hidden = false;
    };
    input.addEventListener("input", () => {
      const q = input.value.trim();
      clearTimeout(t);
      if (q.length < 2) { close(); return; }
      const mySeq = ++seq, ql = q.toLowerCase();
      const presets = CX_PRESETS.filter(([sym, l, g]) => l.toLowerCase().includes(ql) || sym.toLowerCase().includes(ql) || g.toLowerCase().includes(ql)).slice(0, 6);
      render(presets, []);
      t = setTimeout(async () => {
        try { const d = await api(`/api/search?q=${encodeURIComponent(q)}`); if (mySeq === seq) render(presets, (d.results || []).slice(0, 7)); } catch { }
      }, 240);
    });
    drop.addEventListener("mousedown", (e) => {
      const it = e.target.closest(".cx-di"); if (!it) return;
      e.preventDefault(); onPick({ s: it.dataset.s, l: it.dataset.l }); close();
    });
    input.addEventListener("blur", () => setTimeout(close, 140));
    input.addEventListener("focus", () => input.select());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { close(); input.blur(); }
      if (e.key === "Enter") { const f = drop.querySelector(".cx-di"); if (f && !drop.hidden) { onPick({ s: f.dataset.s, l: f.dataset.l }); close(); input.blur(); } }
    });
  },

  load(sym, label) {
    if (!sym) return;
    this.compare = this.compare.filter((c) => c.s !== sym);
    this.main = { s: sym, l: label || (CX_PRESETS.find(([x]) => x === sym) || [])[1] || sym };
    const inp = $("#cxSearch"); if (inp) inp.value = this.main.l;
    this._chips(); this._fetch();
  },
  addCompare(sym, label) {
    if (!sym || sym === this.main.s || this.compare.some((c) => c.s === sym) || this.compare.length >= 4) return;
    this.compare.push({ s: sym, l: label || sym });
    this._chips(); this._fetch();
  },
  _chips() {
    const el = $("#cxChips"); if (!el) return;
    el.innerHTML = this.compare.map((c, i) =>
      `<span class="mc-chip" style="--c:${MC_PALETTE[(i + 1) % MC_PALETTE.length]}">${esc(c.l)}<button data-rm="${esc(c.s)}" title="Remove" type="button">×</button></span>`).join("");
    if (this.chart) this._syncControls();
  },

  async _fetch(keepView) {
    if (!this.chart) return;
    const [label, days, dRange] = this.RANGES.find(([l]) => l === this._tf) || this.RANGES[3];
    const interval = this._iv === "1wk" ? "1wk" : "1d";
    const range = interval === "1wk" ? (this.WEEKLY_RANGE[label] || "5y") : dRange;
    const wanted = [this.main, ...this.compare];
    const seq = ++this._seq;
    try {
      const packs = await Promise.all(wanted.map((w) =>
        api(`/api/history/${encodeURIComponent(w.s)}?range=${range}&interval=${interval}`).catch(() => null)));
      if (seq !== this._seq) return;
      const norm = (d) => ((d && d.points) || []).filter((p) => p.c != null).map((p) => ({
        t: p.t, c: p.c, o: p.o ?? p.c, h: p.h ?? Math.max(p.o ?? p.c, p.c), l: p.l ?? Math.min(p.o ?? p.c, p.c), v: p.v ?? 0,
      }));
      const pts = norm(packs[0]);
      if (pts.length < 5) throw new Error("no data");
      // Long-range daily history can omit the current session — merge the live
      // quote in as today's bar so LAST, the badge and every stat are current.
      const q = await api(`/api/quote/${encodeURIComponent(this.main.s)}`).catch(() => null);
      if (seq !== this._seq) return;
      if (q && q.price != null && q.marketTime) {
        const lb = pts[pts.length - 1];
        const dayKey = (t) => new Date(t + 5.5 * 3600e3).toISOString().slice(0, 10);
        const sameBar = weeklyInt(interval) ? q.marketTime - lb.t < 7 * 864e5 : dayKey(q.marketTime) === dayKey(lb.t);
        if (sameBar) {
          lb.c = q.price; lb.h = Math.max(lb.h, q.dayHigh ?? q.price, q.price); lb.l = Math.min(lb.l, q.dayLow ?? q.price, q.price);
        } else if (q.marketTime > lb.t) {
          const o = (q.spark && q.spark[0]) ?? q.prevClose ?? q.price;
          pts.push({ t: q.marketTime, o, h: Math.max(q.dayHigh ?? q.price, o, q.price), l: Math.min(q.dayLow ?? q.price, o, q.price), c: q.price, v: 0 });
        }
      }
      const closes = pts.map((p) => p.c);
      const ind = {
        sma20: CX_MATH.sma(closes, 20), sma50: CX_MATH.sma(closes, 50), sma200: CX_MATH.sma(closes, 200),
        ema20: CX_MATH.ema(closes, 20), bb: CX_MATH.bb(closes, 20, 2), rsi: CX_MATH.rsi(closes, 14),
      };
      const cut = pts[pts.length - 1].t - days * 864e5;
      let win0 = pts.findIndex((p) => p.t >= cut); if (win0 < 0) win0 = 0;
      const weekly = interval === "1wk";
      const compare = packs.slice(1).map((d, k) => {
        const cp = norm(d); if (!cp.length) return null;
        const map = new Map(cp.map((p) => [new Date(p.t).toISOString().slice(0, 10), p.c]));
        const byT = (t) => { const key = new Date(t).toISOString().slice(0, 10); if (map.has(key)) return map.get(key);
          let best = null, bd = Infinity; for (const p of cp) { const dd = Math.abs(p.t - t); if (dd < bd) { bd = dd; best = p.c; } } return bd < 4 * 864e5 ? best : null; };
        return { label: this.compare[k].l, color: MC_PALETTE[(k + 1) % MC_PALETTE.length], byT };
      }).filter(Boolean);
      this.chart.setData({ pts, ind, win0, label: this.main.l, events: cxDetectEvents(pts, ind, weekly), compare }, keepView);
      const pop = $("#cxPop"); if (pop && !keepView) pop.hidden = true;
      this._stats(pts, win0, ind, weekly);
      this._renderEvents();
    } catch {
      const note = $("#cxNote"); if (note) note.textContent = "series unavailable — check the ticker or try another range";
    }
  },

  /* right-hand metrics with micro-visuals */
  _stats(pts, win0, ind, weekly) {
    const el = $("#cxStats"), note = $("#cxNote"); if (!el) return;
    const n = pts.length, last = pts[n - 1].c, first = pts[win0].c;
    const win = pts.slice(win0).map((p) => p.c);
    const DAY = 864e5, tLast = pts[n - 1].t;
    const retDays = (days) => { const cut = tLast - days * DAY; let b = null; for (const p of pts) { if (p.t <= cut) b = p.c; else break; } return b ? (last / b - 1) * 100 : null; };
    const yr = pts.filter((p) => p.t >= tLast - 365 * DAY);
    const has52 = pts[0].t <= tLast - 358 * DAY;
    const hi52 = Math.max(...(has52 ? yr : pts.slice(win0)).map((p) => p.h ?? p.c));
    const lo52 = Math.min(...(has52 ? yr : pts.slice(win0)).map((p) => p.l ?? p.c));
    const s50 = ind.sma50[n - 1], s200 = ind.sma200[n - 1], rsi = ind.rsi[n - 1];
    const d50 = s50 ? (last / s50 - 1) * 100 : null, d200 = s200 ? (last / s200 - 1) * 100 : null;
    // annualise by the bar frequency — √252 for daily bars, √52 for weekly
    const annVol = (v) => {
      if (v.length < 10) return null;
      const r = []; for (let k = 1; k < v.length; k++) if (v[k - 1] > 0) r.push(Math.log(v[k] / v[k - 1]));
      const m = r.reduce((x, y) => x + y, 0) / r.length;
      return Math.sqrt(r.reduce((x, y) => x + (y - m) ** 2, 0) / (r.length - 1)) * Math.sqrt(weekly ? 52 : 252) * 100;
    };
    const vol = annVol(yr.length > (weekly ? 20 : 30) ? yr.map((p) => p.c) : win);
    const chg = last - first, pch = (last / first - 1) * 100;
    const r1w = retDays(7), r1m = retDays(30), r3m = retDays(91);
    const cls = (v) => (v == null ? "" : v >= 0 ? "up" : "down");
    const maxAbs = Math.max(1, ...[r1w, r1m, r3m].filter((v) => v != null).map(Math.abs));
    const bar = (v) => v == null ? "" : `<div class="cx-zbar"><i class="${cls(v)}" style="width:${Math.min(50, (Math.abs(v) / maxAbs) * 50)}%;${v >= 0 ? "left:50%" : "right:50%"}"></i></div>`;
    const spark = (() => {
      const lo = Math.min(...win), hi = Math.max(...win), W = 110, H = 26;
      const step = Math.max(1, Math.floor(win.length / 60));
      const s = win.filter((_, k) => k % step === 0 || k === win.length - 1);
      const pp = s.map((v, k) => `${((k / (s.length - 1)) * W).toFixed(1)},${(H - 2 - ((v - lo) / (hi - lo || 1)) * (H - 4)).toFixed(1)}`).join(" ");
      const c = pch >= 0 ? "#2ebd85" : "#f0524f";
      return `<svg class="cx-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="cxSg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity=".45"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient></defs><polygon points="0,${H} ${pp} ${W},${H}" fill="url(#cxSg)"/><polyline points="${pp}" fill="none" stroke="${c}" stroke-width="1.4"/></svg>`;
    })();
    const pos = hi52 > lo52 ? ((last - lo52) / (hi52 - lo52)) * 100 : 50;
    const range = `<div class="cx-range"><i style="left:${pos.toFixed(1)}%"></i></div>`;
    const rsiG = rsi == null ? "" : `<div class="cx-rsi"><span class="z"></span><i style="left:${rsi.toFixed(1)}%"></i></div>`;
    const volG = vol == null ? "" : `<div class="cx-meter"><i style="width:${Math.min(100, (vol / 60) * 100).toFixed(0)}%"></i></div>`;
    const dmaG = (d) => d == null ? "" : `<div class="cx-zbar"><i class="${cls(d)}" style="width:${Math.min(50, (Math.abs(d) / 20) * 50)}%;${d >= 0 ? "left:50%" : "right:50%"}"></i></div>`;
    const cell = (label, value, c, extra = "", sub = "") =>
      `<div class="cx-st"><small>${label}</small><b class="${c}">${value}</b>${sub ? `<em>${sub}</em>` : ""}${extra}</div>`;
    const ma = weekly ? "W MA" : " DMA";
    el.innerHTML = [
      cell("LAST", cxNum(last), "", spark),
      cell("CHANGE · " + this._tf, (chg >= 0 ? "+" : "") + cxNum(chg), cls(chg), "", `since ${cxDate(pts[win0].t)}`),
      cell("% CHANGE", cxPct(pch), cls(pch), `<div class="cx-pill ${cls(pch)}">${pch >= 0 ? "▲" : "▼"} ${Math.abs(pch).toFixed(2)}%</div>`),
      cell("1W", cxPct(r1w), cls(r1w), bar(r1w)),
      cell("1M", cxPct(r1m), cls(r1m), bar(r1m)),
      cell("3M", cxPct(r3m), cls(r3m), bar(r3m)),
      cell(has52 ? "52W HIGH" : "RANGE HIGH", cxNum(hi52), "", range, `${cxPct((last / hi52 - 1) * 100, 1)} from high`),
      cell(has52 ? "52W LOW" : "RANGE LOW", cxNum(lo52), "", range, `${cxPct((last / lo52 - 1) * 100, 1)} from low`),
      cell("RSI (14)", rsi == null ? "—" : rsi.toFixed(2), rsi == null ? "" : rsi > 70 ? "down" : rsi < 30 ? "up" : "", rsiG, rsi == null ? "" : rsi > 70 ? "overbought" : rsi < 30 ? "oversold" : "neutral zone"),
      cell("200" + ma, cxPct(d200, 1), cls(d200), dmaG(d200), s200 ? `level ${cxNum(s200)}` : "needs 200 bars"),
      cell("50" + ma, cxPct(d50, 1), cls(d50), dmaG(d50), s50 ? `level ${cxNum(s50)}` : ""),
      cell("VOLATILITY (1Y)", vol == null ? "—" : vol.toFixed(1) + "%", "", volG, vol == null ? "" : vol < 15 ? "calm" : vol < 25 ? "normal" : vol < 40 ? "elevated" : "high"),
    ].join("");
    if (note) note.textContent = mcCommentFor(this.main.s, {
      last, retRange: pch, rsi, vol, dd: MC_MATH.maxDD(win), above200: s200 ? last > s200 : null, d50, d200,
    });
  },

  _pop(ev, x, y) {
    const pop = $("#cxPop"); if (!pop) return;
    pop.innerHTML = `<button class="mc-pop-x" type="button">×</button>
      <div class="mc-pop-t mono"><span class="${ev.dir > 0 ? "up" : "down"}">${ev.dir > 0 ? "▲" : "▼"}</span> ${esc(ev.title.toUpperCase())} · ${cxDate(ev.t)}</div>
      <div class="cx-pop-k mono">${esc(CX_EVT[ev.kind].label)}</div>
      <div class="mc-pop-b">${esc(ev.text)}</div>`;
    const wrap = pop.parentElement; pop.hidden = false;
    const pw = Math.min(340, wrap.clientWidth - 16);
    pop.style.width = pw + "px";
    pop.style.left = Math.max(6, Math.min(x - pw / 2, wrap.clientWidth - pw - 6)) + "px";
    pop.style.top = Math.max(6, Math.min(y + 14, wrap.clientHeight - 150)) + "px";
    pop.querySelector(".mc-pop-x").addEventListener("click", () => { pop.hidden = true; });
  },

  /* live: re-pull with zoom preserved (called by MACRO every 4th tick) */
  tick() { if (this._mounted) this._fetch(true).catch(() => {}); },
};
