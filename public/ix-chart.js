/* ════════════════════════════════════════════════════════════════════════════
   M-TERMINAL — Index Analyser chart (canvas).
   Candles + EMA 20/50/200 + Bollinger + session average (TWAP) + opening-range box,
   pivot / OI levels with tags, an OI profile at the right edge, RSI and MACD panes,
   and the forecast drawn as BRANCHES from the live price into the future: a faint
   10–90% cone, bullish / base / bearish scenario paths (dotted, lighter than the
   price), optional per-model branches, each tagged with its probability.
   Live: updateTick() extends the forming candle; setOverlay() redraws the branches;
   setMarks() places candlestick-pattern markers (▲ bullish below the low, ▼ bearish above the high).
   Interaction: wheel zoom · drag pan · double-click reset · crosshair read-out · click a pattern
   marker (hover shows its card) · pick mode for bar replay (click a candle to start from it).
   ════════════════════════════════════════════════════════════════════════════ */
const IXC = {
  up: "#2e9e6b", down: "#c84b3c", upSoft: "rgba(46,158,107,", downSoft: "rgba(200,75,60,", amber: "#e8a33d", amberDim: "#c8862a",
  blue: "#5b8dd6", blueSoft: "rgba(91,141,214,", violet: "#9b7ede", teal: "#3fb8af", orange: "#e0884a", grey: "#8a93a0",
  fg: "#e8eaed", muted: "#8a93a0", ink: "#0a0c10", grid: "rgba(35,42,51,.75)", hair: "#232a33",
};
const IX_MODEL_COLORS = { cone: "#8a93a0", momentum: "#5b8dd6", reversion: "#9b7ede", analog: "#3fb8af", seasonal: "#e0884a", session: "#d4c34a", implied: "#e8a33d" };
const IX_SPAGHETTI = ["#c84b3c", "#5b8dd6", "#3fb8af", "#e0884a", "#9b7ede", "#2e9e6b", "#d4c34a", "#8a93a0", "#e39a8f", "#7fc9a4", "#b48ead", "#88c0d0"];
const ixEma = (v, p) => { const k = 2 / (p + 1), o = []; let e = null; for (const x of v) { e = e == null ? x : x * k + e * (1 - k); o.push(e); } return o; };
const ixRsi = (c, p = 14) => { const o = new Array(c.length).fill(null); let g = 0, l = 0; for (let i = 1; i < c.length; i++) { const d = c[i] - c[i - 1], u = Math.max(d, 0), dn = Math.max(-d, 0); if (i <= p) { g += u / p; l += dn / p; if (i === p) o[i] = l ? 100 - 100 / (1 + g / l) : 100; continue; } g = (g * (p - 1) + u) / p; l = (l * (p - 1) + dn) / p; o[i] = l ? 100 - 100 / (1 + g / l) : 100; } return o; };
const ixFmt = (v, dp = 2) => (v == null || !isFinite(v) ? "—" : Number(v).toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp }));

class IXChart {
  constructor(canvas, { onHover, onMarkClick, onPick } = {}) {
    this.cv = canvas; this.ctx = canvas.getContext("2d"); this.onHover = onHover; this.onMarkClick = onMarkClick; this.onPick = onPick;
    this.pick = false; this.hoverMark = null; this._mh = [];
    this.bars = []; this.tf = "5m"; this.ov = {}; this.ind = { ema20: true, ema50: true, ema200: true, bb: false, twap: true, levels: true, oi: false, rsi: true, macd: true, cone: true, pat: true, view: "scen" };   // view: scen · analog · models
    this.view = { n: 120, end: 0 };   // bars visible, offset from the right (0 = latest)
    this.hover = null; this.raf = 0; this.dpr = window.devicePixelRatio || 1; this.marks = []; this.selMark = null;
    this._bind();
    if (window.ResizeObserver) { this.ro = new ResizeObserver(() => this.draw()); this.ro.observe(canvas.parentElement); }
  }
  /* ── data ── */
  setBars(bars, tf) { const keep = this.tf === tf && this.bars.length; this.bars = bars.slice(); this.tf = tf; if (!keep) this.view = { n: Math.min(this.defaultN(), Math.max(30, bars.length)), end: 0 }; this._calc(); this.draw(); }
  defaultN() { return { "1m": 120, "5m": 80, "15m": 70, "1h": 120, "1d": 140, "1wk": 120, "1mo": 100 }[this.tf] || 120; }
  tfMs() { return { "1m": 60e3, "5m": 300e3, "15m": 900e3, "1h": 3600e3, "1d": 86400e3, "1wk": 7 * 86400e3, "1mo": 30 * 86400e3 }[this.tf] || 300e3; }
  intraday() { return ["1m", "5m", "15m", "1h"].includes(this.tf); }
  /** live price into the forming candle (or a new candle when its period has rolled) */
  updateTick(t, price) {
    if (!(price > 0) || !this.bars.length) return;
    const last = this.bars[this.bars.length - 1], ms = this.tfMs();
    const ist = (x) => new Date(x + 5.5 * 3600e3), day = (x) => ist(x).toISOString().slice(0, 10);
    const wk = (x) => { const d = ist(x); return day(x - ((d.getUTCDay() + 6) % 7) * 86400e3); };
    let roll = false, start = t;
    if (this.intraday()) {
      // candles continue from the session's own grid (hourly candles start at 09:15, not on the clock hour)
      if (day(t) !== day(last.t)) roll = true;
      else if (t >= last.t + ms) { roll = true; start = last.t + Math.floor((t - last.t) / ms) * ms; }
    } else if (this.tf === "1d") roll = day(t) !== day(last.t);
    else if (this.tf === "1wk") roll = wk(t) !== wk(last.t);
    else roll = day(t).slice(0, 7) !== day(last.t).slice(0, 7);
    if (!roll) { last.h = Math.max(last.h, price); last.l = Math.min(last.l, price); last.c = price; }
    else this.bars.push({ t: start, o: price, h: price, l: price, c: price });
    this.lastPrice = price; this.lastTickAt = Date.now();
    this._calc(); this.draw();
  }
  setOverlay(ov) { this.ov = ov || {}; this.draw(); }
  /** pattern markers: [{ t, dir, name, score, live }] keyed by candle time (survive candle roll-overs) */
  setMarks(m, sel) { this.marks = m || []; if (sel !== undefined) this.selMark = sel; this.draw(); }
  /** bring the candle at time t into view (a third in from the right edge) */
  focusTime(t) { const i = this._idxOfTime(t); if (i < 0) return; this.view.end = Math.max(0, Math.min(this.bars.length - 10, this.bars.length - 1 - i - Math.floor(this.view.n / 3))); this.draw(); }
  _idxAtX(x) { const L = this.L; if (!L || x > L.nowX + L.bw) return null; return Math.max(L.startIdx, Math.min(L.endIdx, Math.floor(x / L.bw) + L.startIdx)); }
  _hitMark(x, y) { let best = null, bd = 1e9; for (const h of this._mh) { const d = Math.hypot(x - h.x, y - h.y); if (d <= h.r && d < bd) { bd = d; best = h.m; } } return best; }
  _idxOfTime(t) { const b = this.bars; let lo = 0, hi = b.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (b[m].t === t) return m; if (b[m].t < t) lo = m + 1; else hi = m - 1; } return -1; }
  setInd(k, on) { this.ind[k] = on; this.draw(); }
  _calc() {
    const c = this.bars.map((b) => b.c);
    this.e20 = ixEma(c, 20); this.e50 = ixEma(c, 50); this.e200 = ixEma(c, 200); this.rsi = ixRsi(c, 14);
    const m12 = ixEma(c, 12), m26 = ixEma(c, 26); this.macd = m12.map((v, i) => v - m26[i]); this.sig = ixEma(this.macd, 9);
    this.bb = c.map((_, i) => { if (i < 19) return null; const w = c.slice(i - 19, i + 1), m = w.reduce((a, b) => a + b, 0) / 20, sd = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / 20); return { m, u: m + 2 * sd, l: m - 2 * sd }; });
  }
  /* ── interaction ── */
  _bind() {
    const cv = this.cv;
    cv.addEventListener("wheel", (e) => { e.preventDefault(); const f = e.deltaY > 0 ? 1.12 : 0.89; this.view.n = Math.max(25, Math.min(this.bars.length + 20, Math.round(this.view.n * f))); this.draw(); }, { passive: false });
    let drag = null;
    cv.addEventListener("mousedown", (e) => { drag = { x: e.clientX, y: e.clientY, end: this.view.end, moved: false }; });
    window.addEventListener("mouseup", (e) => {
      const d = drag; drag = null;
      if (!d || d.moved || e.target !== cv) return;
      // a click, not a pan: a pattern marker wins; otherwise pick mode starts the replay at the candle
      if (this.hoverMark && this.onMarkClick) { this.onMarkClick(this.hoverMark.key); return; }
      if (this.pick && this.onPick && this.L) { const r = cv.getBoundingClientRect(), i = this._idxAtX(e.clientX - r.left); if (i != null) this.onPick(i, this.bars[i]); }
    });
    cv.addEventListener("mousemove", (e) => {
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      if (drag && Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) drag.moved = true;
      if (drag && drag.moved && this.L) { const dx = e.clientX - drag.x; this.view.end = Math.max(0, Math.min(this.bars.length - 10, Math.round(drag.end + dx / this.L.bw))); }
      this.hover = { x, y };
      this.hoverMark = drag && drag.moved ? null : this._hitMark(x, y);
      cv.style.cursor = this.hoverMark ? "pointer" : this.pick ? "copy" : drag && drag.moved ? "grabbing" : "crosshair";
      this.draw();
    });
    cv.addEventListener("mouseleave", () => { this.hover = null; this.hoverMark = null; this.draw(); if (this.onHover) this.onHover(null); });
    cv.addEventListener("dblclick", () => { this.view = { n: this.defaultN(), end: 0 }; this.draw(); });
  }
  draw() { if (this.raf) return; this.raf = requestAnimationFrame(() => { this.raf = 0; this._draw(); }); }

  /* ── layout ── */
  _layout(W, H) {
    const panes = [{ k: "price", h: 1 }];
    if (this.ind.rsi) panes.push({ k: "rsi", h: 0.18 }); if (this.ind.macd) panes.push({ k: "macd", h: 0.2 });
    const axisR = 72, axisB = 22, gap = 8, tot = panes.reduce((a, p) => a + p.h, 0), avail = H - axisB - gap * (panes.length - 1);
    let y = 0; for (const p of panes) { p.y = y; p.hh = Math.round(avail * p.h / tot); y += p.hh + gap; }
    const plotW = W - axisR;
    // the future zone: wide enough for the forecast horizon, never more than 30% of the plot
    const fc = this.ov.fan, an = this.ind.view === "analog" && this.ov.analogs && this.ov.analogs.fit && this.ov.analogs.fit.length ? this.ov.analogs : null;
    const horizon = an && this.bars.length ? Math.max(0, an.fit[an.fit.length - 1][0] - this.bars[this.bars.length - 1].t) : fc && fc.steps && fc.steps.length ? fc.horizonMs : 0;
    // the future zone is wide enough to read the branches (≥ 30% of the plot), never more than 45%
    const futBars = horizon ? Math.max(Math.round(this.view.n * 0.43), Math.min(Math.ceil(horizon / this.tfMs()) + 2, Math.round(this.view.n * 0.8))) : 0;
    const totalBars = this.view.n + futBars, bw = plotW / Math.max(10, totalBars);
    const endIdx = this.bars.length - 1 - this.view.end, startIdx = Math.max(0, endIdx - this.view.n + 1);
    return { W, H, panes, axisR, axisB, plotW, bw, futBars, startIdx, endIdx, nowX: (endIdx - startIdx + 1) * bw };
  }
  _draw() {
    const cv = this.cv, dpr = this.dpr = window.devicePixelRatio || 1, W = cv.parentElement.clientWidth, H = cv.parentElement.clientHeight;
    if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + "px"; cv.style.height = H + "px"; }
    const ctx = this.ctx; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    if (!this.bars.length) { ctx.fillStyle = IXC.muted; ctx.font = "12px Inter, sans-serif"; ctx.fillText("Loading chart…", 16, 24); return; }
    const L = this.L = this._layout(W, H), bars = this.bars.slice(L.startIdx, L.endIdx + 1);
    const P = L.panes.find((p) => p.k === "price");
    // y-range: visible candles + overlays that matter (fan bands, nearest levels)
    let lo = Math.min(...bars.map((b) => b.l)), hi = Math.max(...bars.map((b) => b.h));
    const fan = this.ov.fan;
    const AN = this.ind.view === "analog" && this.intraday() ? this.ov.analogs : null;
    if (AN && AN.bands) for (const b2 of AN.bands) { lo = Math.min(lo, b2.q[0]); hi = Math.max(hi, b2.q[4]); }
    else if (fan && fan.steps) for (const s of fan.steps) { lo = Math.min(lo, s.q[0]); hi = Math.max(hi, s.q[4]); }
    if (this.ind.bb) bars.forEach((_, i) => { const b = this.bb[L.startIdx + i]; if (b) { lo = Math.min(lo, b.l); hi = Math.max(hi, b.u); } });
    const pad = (hi - lo) * 0.08 || hi * 0.002; lo -= pad; hi += pad;
    const Y = (v) => P.y + 8 + (1 - (v - lo) / (hi - lo)) * (P.hh - 16), X = (i) => (i - L.startIdx + 0.5) * L.bw;
    this.Y = Y; this.X = X; this.lo = lo; this.hi = hi;
    // grid + price axis
    ctx.font = "10.5px Inter, sans-serif"; ctx.textBaseline = "middle";
    const step = niceStep((hi - lo) / 6);
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) { const y = Y(v); ctx.strokeStyle = IXC.grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(L.plotW, y); ctx.stroke(); ctx.fillStyle = IXC.muted; ctx.fillText(ixFmt(v, v < 100 ? 2 : 0), L.plotW + 8, y); }
    // future zone shading + "Now" divider
    if (L.futBars) { ctx.fillStyle = "rgba(91,141,214,0.035)"; ctx.fillRect(L.nowX, P.y, L.plotW - L.nowX, P.hh); ctx.setLineDash([3, 4]); ctx.strokeStyle = "rgba(138,147,160,.45)"; ctx.beginPath(); ctx.moveTo(L.nowX, P.y); ctx.lineTo(L.nowX, H - L.axisB); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = IXC.muted; ctx.textAlign = "center"; ctx.fillText("Now", L.nowX, P.y + 8); ctx.textAlign = "left"; }
    // everything inside the price pane is clipped to it (outlier analog paths, wide cones)
    ctx.save(); ctx.beginPath(); ctx.rect(0, P.y, L.plotW, P.hh); ctx.clip();
    // opening range box (current session, intraday)
    const orb = this.ov.orb;
    if (orb && this.intraday() && this.ind.levels) {
      const i0 = this.bars.findIndex((b) => b.t >= orb.t0), i1 = this.bars.findIndex((b) => b.t >= orb.t1);
      if (i0 >= L.startIdx) { const x0 = X(i0) - L.bw / 2, x1 = i1 > 0 ? X(Math.min(i1, L.endIdx)) : L.nowX; ctx.fillStyle = "rgba(232,163,61,.07)"; ctx.strokeStyle = "rgba(232,163,61,.45)"; ctx.fillRect(x0, Y(orb.h), x1 - x0, Y(orb.l) - Y(orb.h)); ctx.strokeRect(x0, Y(orb.h), x1 - x0, Y(orb.l) - Y(orb.h)); ctx.fillStyle = IXC.amber; ctx.fillText("Opening range", x0 + 4, Y(orb.h) + 9); }
    }
    // Bollinger band
    if (this.ind.bb) { ctx.fillStyle = "rgba(91,141,214,.07)"; ctx.beginPath(); let st = false; for (let i = L.startIdx; i <= L.endIdx; i++) { const b = this.bb[i]; if (!b) continue; st ? ctx.lineTo(X(i), Y(b.u)) : ctx.moveTo(X(i), Y(b.u)); st = true; } for (let i = L.endIdx; i >= L.startIdx; i--) { const b = this.bb[i]; if (b) ctx.lineTo(X(i), Y(b.l)); } ctx.closePath(); ctx.fill(); }
    // levels
    const levels = this.ind.levels ? (this.ov.levels || []) : [];
    const tags = [];
    for (const l of levels) {
      if (l.price < lo || l.price > hi) continue;
      const y = Y(l.price), col = l.group === "options" ? (l.key === "CW" ? IXC.down : l.key === "PW" ? IXC.up : IXC.violet) : /^R|PDH|camH|fibR|WR/.test(l.key) ? IXC.down : /^S|PDL|camL|fibS|WS/.test(l.key) ? IXC.up : IXC.grey;
      ctx.strokeStyle = col; ctx.globalAlpha = l.major ? 0.75 : 0.4; ctx.setLineDash(l.major ? [6, 4] : [2, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(L.plotW, y); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      if (l.major) tags.push({ y, text: `${l.short || l.key} ${ixFmt(l.price, 0)}`, col });
    }
    // OI profile at the right edge of the plot (CE red, PE green), aligned to strikes
    const prof = this.ind.oi && this.ov.oiProfile;
    if (prof && prof.length) {
      const mx = Math.max(...prof.map((p) => Math.max(p.ce, p.pe))) || 1, wMax = Math.min(60, L.plotW * 0.08), x1 = L.plotW - 2, bh = Math.max(2, Math.min(9, Math.abs(Y(prof[0].k) - Y(prof[Math.min(1, prof.length - 1)].k)) * 0.42));
      for (const p of prof) { if (p.k < lo || p.k > hi) continue; const y = Y(p.k);
        ctx.fillStyle = IXC.downSoft + ".55)"; ctx.fillRect(x1 - (p.ce / mx) * wMax, y - bh, (p.ce / mx) * wMax, bh);
        ctx.fillStyle = IXC.upSoft + ".55)"; ctx.fillRect(x1 - (p.pe / mx) * wMax, y, (p.pe / mx) * wMax, bh); }
    }
    // averages
    const line = (arr, col, w = 1.3, dash) => { ctx.strokeStyle = col; ctx.lineWidth = w; if (dash) ctx.setLineDash(dash); ctx.beginPath(); let st = false; for (let i = L.startIdx; i <= L.endIdx; i++) { const v = arr[i]; if (v == null) continue; st ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)); st = true; } ctx.stroke(); ctx.setLineDash([]); };
    if (this.ind.ema200) line(this.e200, "rgba(200,75,60,.85)");
    if (this.ind.ema50) line(this.e50, "rgba(91,141,214,.9)");
    if (this.ind.ema20) line(this.e20, "rgba(232,163,61,.9)");
    if (this.ind.twap && this.ov.twap && this.intraday()) { const y = Y(this.ov.twap.v), i0 = Math.max(L.startIdx, this.bars.findIndex((b) => b.t >= this.ov.twap.t0)); if (i0 >= 0) { ctx.strokeStyle = "#3fb8af"; ctx.lineWidth = 1.4; ctx.setLineDash([5, 3]); ctx.beginPath(); ctx.moveTo(X(i0), y); ctx.lineTo(L.nowX, y); ctx.stroke(); ctx.setLineDash([]); tags.push({ y, text: `VWAP ${ixFmt(this.ov.twap.v, 0)}`, col: "#3fb8af" }); } }
    // analog layer (whole-session pattern matches), beneath the candles
    if (AN && AN.paths && L.endIdx === this.bars.length - 1) {
      const xs = (t) => this._xOfTime(t);
      const bandFill = (a, b2, alpha) => { const B = AN.bands; if (!B || B.length < 2) return; ctx.fillStyle = IXC.downSoft + alpha + ")"; ctx.beginPath(); B.forEach((p, i) => (i ? ctx.lineTo(xs(p.t), Y(p.q[a])) : ctx.moveTo(xs(p.t), Y(p.q[a])))); for (let i = B.length - 1; i >= 0; i--) ctx.lineTo(xs(B[i].t), Y(B[i].q[b2])); ctx.closePath(); ctx.fill(); };
      bandFill(0, 4, 0.1); bandFill(1, 3, 0.16);
      AN.paths.forEach((p, k) => { ctx.strokeStyle = IX_SPAGHETTI[k % IX_SPAGHETTI.length]; ctx.globalAlpha = 0.5; ctx.lineWidth = 1; ctx.beginPath(); let st = false; for (const [t, v] of p.pts) { const x = xs(t); if (x < 0 || x > L.plotW) continue; st ? ctx.lineTo(x, Y(v)) : ctx.moveTo(x, Y(v)); st = true; } ctx.stroke(); });
      ctx.globalAlpha = 1; ctx.strokeStyle = "#d4c34a"; ctx.lineWidth = 2.6; ctx.beginPath(); let st = false; for (const [t, v] of AN.fit) { const x = xs(t); if (x < 0 || x > L.plotW) continue; st ? ctx.lineTo(x, Y(v)) : ctx.moveTo(x, Y(v)); st = true; } ctx.stroke();
    }
    // candles
    const cw = Math.max(1, L.bw * 0.66);
    for (let i = L.startIdx; i <= L.endIdx; i++) {
      const b = this.bars[i], x = X(i), up = b.c >= b.o, col = up ? IXC.up : IXC.down;
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, Y(b.h)); ctx.lineTo(x, Y(b.l)); ctx.stroke();
      const y1 = Y(Math.max(b.o, b.c)), y2 = Y(Math.min(b.o, b.c)); ctx.fillRect(x - cw / 2, y1, cw, Math.max(1, y2 - y1));
    }
    // candlestick-pattern markers
    this._mh = [];
    if (this.ind.pat && this.marks.length) {
      const rng = (hi - lo) / Math.max(1, P.hh), off = 7 * rng, sz = Math.max(3.5, Math.min(6, L.bw * 0.42));
      const t0 = this.bars[L.startIdx].t, t1 = this.bars[L.endIdx].t;
      ctx.font = "600 9.5px Inter, sans-serif"; ctx.textAlign = "center";
      for (const m of this.marks) {
        if (m.t < t0 || m.t > t1) continue;
        const i = this._idxOfTime(m.t); if (i < 0) continue;
        const b = this.bars[i], x = X(i), col = m.dir > 0 ? IXC.up : m.dir < 0 ? IXC.down : IXC.amber;
        const y = m.dir > 0 ? Y(b.l) + 6 + sz : Y(b.h) - 6 - sz, sel = this.selMark === m.key;
        // weak signals (< 55) are a faint dot — recognised, listed, but not shouted on the chart
        const hov = this.hoverMark && this.hoverMark.key === m.key;
        if (m.score < 55 && !m.live && !sel && !hov) { const dy = m.dir > 0 ? Y(b.l) + 6 : Y(b.h) - 6; ctx.globalAlpha = 0.5; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, dy, 1.8, 0, 7); ctx.fill(); ctx.globalAlpha = 1; this._mh.push({ m, x, y: dy, r: 6 }); continue; }
        this._mh.push({ m, x, y, r: sz + 4 });
        ctx.globalAlpha = m.live ? 0.55 + 0.45 * Math.abs(Math.sin(Date.now() / 450)) : m.score >= 55 ? 0.95 : 0.6;
        ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.beginPath();
        if (m.dir > 0) { ctx.moveTo(x, y - sz); ctx.lineTo(x - sz, y + sz * 0.8); ctx.lineTo(x + sz, y + sz * 0.8); }
        else if (m.dir < 0) { ctx.moveTo(x, y + sz); ctx.lineTo(x - sz, y - sz * 0.8); ctx.lineTo(x + sz, y - sz * 0.8); }
        else { ctx.moveTo(x, y - sz); ctx.lineTo(x + sz, y); ctx.lineTo(x, y + sz); ctx.lineTo(x - sz, y); }
        ctx.closePath(); m.live ? ctx.stroke() : ctx.fill();
        ctx.globalAlpha = 1;
        if (sel || hov) { ctx.strokeStyle = hov ? col : IXC.fg; ctx.lineWidth = hov ? 1.5 : 1; ctx.beginPath(); ctx.arc(x, y, sz + 4, 0, 7); ctx.stroke(); }
        if (sel || m.live || (m.score >= 72 && L.bw >= 6)) {
          const txt = sel || m.live ? `${m.name}${m.live ? " · forming" : ""}` : m.name.split(" ").map((w) => w[0]).join("");
          const ty = m.dir > 0 ? y + sz + 10 : y - sz - 8, w = ctx.measureText(txt).width + 8;
          ctx.fillStyle = "rgba(10,12,16,.82)"; ctx.fillRect(x - w / 2, ty - 6.5, w, 13); ctx.fillStyle = col; ctx.fillText(txt, x, ty);
        }
      }
      ctx.textAlign = "left";
      if (this.marks.some((m) => m.live)) { clearTimeout(this._pulse); this._pulse = setTimeout(() => this.draw(), 150); }
    }
    // forecast branches
    const last = this.bars[L.endIdx], x0 = X(L.endIdx), y0 = Y(last.c);
    if (AN && AN.fit && AN.fit.length && L.endIdx === this.bars.length - 1) {
      const e = AN.fit[AN.fit.length - 1], ex = this._xOfTime(e[0]), ey = Y(e[1]);
      const t1 = "Analog fit " + ixFmt(e[1], 0), t2 = "P(close above now) " + Math.round(AN.pUpClose * 100) + "% · " + AN.n + " sessions";
      ctx.font = "600 11px Inter, sans-serif"; const w = Math.max(ctx.measureText(t1).width, ctx.measureText(t2).width) + 14, bx = Math.min(ex - w - 4, L.plotW - w - 2), by = Math.max(P.y + 2, Math.min(P.y + P.hh - 32, ey - 15));
      ctx.fillStyle = "rgba(10,12,16,.85)"; ctx.strokeStyle = "#d4c34a"; roundRect(ctx, bx, by, w, 30, 4); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#d4c34a"; ctx.fillText(t1, bx + 7, by + 9); ctx.font = "10.5px Inter, sans-serif"; ctx.fillStyle = IXC.fg; ctx.fillText(t2, bx + 7, by + 21);
    } else if (fan && fan.steps && fan.steps.length && L.endIdx === this.bars.length - 1) {
      const fx = (ms) => x0 + (ms / this.tfMs()) * L.bw;
      const pts = (k) => [[x0, y0], ...fan.steps.map((s) => [fx(s.ms), Y(k(s))])];
      if (this.ind.cone) {
        const band = (a, b, alpha) => { const A = pts((s) => s.q[a]), B = pts((s) => s.q[b]).reverse(); ctx.fillStyle = IXC.blueSoft + alpha + ")"; ctx.beginPath(); A.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); B.forEach(([x, y]) => ctx.lineTo(x, y)); ctx.closePath(); ctx.fill(); };
        band(0, 4, 0.07); band(1, 3, 0.1);
      }
      const mLabels = [];
      if (this.ind.view === "models" && fan.models) for (const [k, m] of Object.entries(fan.models)) {
        const P2 = [[x0, y0], ...m.steps.map((s) => [fx(s.ms), Y(s.q[2])])];
        ctx.strokeStyle = IX_MODEL_COLORS[k] || IXC.grey; ctx.globalAlpha = 0.8; ctx.lineWidth = 1.3; ctx.setLineDash([3, 3]);
        ctx.beginPath(); P2.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
        const [ex, ey] = P2[P2.length - 1]; mLabels.push({ y: ey, x: ex, col: IX_MODEL_COLORS[k] || IXC.grey, text: (m.label || k) + " " + ixFmt(m.steps[m.steps.length - 1].q[2], 0) });
      }
      // model labels stacked so they never overlap, with a leader to each branch tip
      mLabels.sort((a, b) => a.y - b.y); for (let i = 1; i < mLabels.length; i++) if (mLabels[i].y - mLabels[i - 1].y < 13) mLabels[i].y2 = (mLabels[i - 1].y2 || mLabels[i - 1].y) + 13;
      ctx.font = "10px Inter, sans-serif";
      for (const l of mLabels) { const ly = l.y2 || l.y, w = ctx.measureText(l.text).width + 8, lx = Math.max(0, Math.min(l.x - w - 10, L.plotW - w - 2)); ctx.strokeStyle = l.col; ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(lx + w, ly); ctx.lineTo(l.x, l.y); ctx.stroke(); ctx.globalAlpha = 1; ctx.fillStyle = "rgba(10,12,16,.82)"; ctx.fillRect(lx, ly - 6, w, 12); ctx.fillStyle = l.col; ctx.fillText(l.text, lx + 4, ly); }
      const sc = this.ind.view === "scen" ? this.ov.scenarios : null;
      const branch = (path, col, soft) => {
        if (!path || !path.length) return null;
        const P2 = [[x0, y0], ...path.map((p) => [fx(p.ms), Y(p.p)])];
        ctx.strokeStyle = col; ctx.globalAlpha = 0.75; ctx.lineWidth = 1.3; ctx.setLineDash([4, 3]);
        ctx.beginPath(); P2.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = col; for (const [x, y] of P2.slice(1)) { ctx.beginPath(); ctx.arc(x, y, 2.2, 0, 7); ctx.fill(); }
        ctx.globalAlpha = 1; return P2[P2.length - 1];
      };
      if (sc) {
        const ends = [["bull", IXC.up, "Bullish"], ["base", IXC.blue, "Base case"], ["bear", IXC.down, "Bearish"]].map(([k, col, label]) => { const e = branch(sc[k] && sc[k].path, col); return e && { k, col, label, x: e[0], y: e[1], p: sc[k].p, price: sc[k].path[sc[k].path.length - 1].p }; }).filter(Boolean);
        // probability tags at the branch tips, kept apart vertically
        ends.sort((a, b) => a.y - b.y); for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 34) ends[i].y = ends[i - 1].y + 34;
        for (const e of ends) {
          const txt1 = `${e.label} ${Math.round(e.p * 100)}%`, txt2 = `${ixFmt(e.price, 0)} (${((e.price / last.c - 1) * 100).toFixed(2)}%)`;
          ctx.font = "600 11px Inter, sans-serif"; const w = Math.max(ctx.measureText(txt1).width, ctx.measureText(txt2).width) + 14, bx = Math.min(e.x - w - 4, L.plotW - w - 2), by = Math.max(P.y + 2, Math.min(P.y + P.hh - 32, e.y - 15));
          ctx.fillStyle = "rgba(10,12,16,.82)"; ctx.strokeStyle = e.col; ctx.lineWidth = 1; roundRect(ctx, bx, by, w, 30, 4); ctx.fill(); ctx.stroke();
          ctx.fillStyle = e.col; ctx.fillText(txt1, bx + 7, by + 9); ctx.font = "10.5px Inter, sans-serif"; ctx.fillStyle = IXC.fg; ctx.fillText(txt2, bx + 7, by + 21);
        }
      }
      // future time labels
      ctx.font = "10px Inter, sans-serif"; ctx.fillStyle = IXC.muted; ctx.textAlign = "center";
      for (const s of fan.labels || []) { const x = fx(s.ms); if (x < L.plotW - 10) ctx.fillText(s.label, x, H - 8); }
      ctx.textAlign = "left";
    }
    ctx.restore();
    // live price line + tag
    const lp = this.lastPrice && L.endIdx === this.bars.length - 1 ? this.bars[this.bars.length - 1].c : last.c, yl = Y(lp), upDay = this.ov.prevClose ? lp >= this.ov.prevClose : last.c >= last.o;
    ctx.strokeStyle = upDay ? IXC.up : IXC.down; ctx.globalAlpha = 0.55; ctx.setLineDash([1, 3]); ctx.beginPath(); ctx.moveTo(0, yl); ctx.lineTo(L.plotW, yl); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    if (this.lastTickAt && Date.now() - this.lastTickAt < 1500) { ctx.fillStyle = upDay ? IXC.upSoft + ".35)" : IXC.downSoft + ".35)"; ctx.beginPath(); ctx.arc(x0, yl, 6, 0, 7); ctx.fill(); }
    tags.push({ y: yl, text: ixFmt(lp, 2), col: upDay ? IXC.up : IXC.down, solid: true });
    // right-axis tags, de-overlapped
    tags.sort((a, b) => a.y - b.y); for (let i = 1; i < tags.length; i++) if (tags[i].y - tags[i - 1].y < 15) tags[i].y = tags[i - 1].y + 15;
    ctx.font = "600 10px Inter, sans-serif";
    for (const t of tags) { if (t.y < P.y || t.y > P.y + P.hh) continue; ctx.fillStyle = t.solid ? t.col : "rgba(10,12,16,.9)"; ctx.strokeStyle = t.col; roundRect(ctx, L.plotW + 2, t.y - 7, L.axisR - 4, 14, 3); ctx.fill(); if (!t.solid) ctx.stroke(); ctx.fillStyle = t.solid ? "#fff" : t.col; ctx.fillText(t.text.length > 13 ? t.text.slice(0, 13) : t.text, L.plotW + 6, t.y); }
    // sub-panes
    for (const p of L.panes) {
      if (p.k === "price") continue;
      ctx.strokeStyle = IXC.hair; ctx.beginPath(); ctx.moveTo(0, p.y - 4); ctx.lineTo(W, p.y - 4); ctx.stroke();
      if (p.k === "rsi") {
        const Yr = (v) => p.y + (1 - v / 100) * p.hh;
        ctx.fillStyle = "rgba(155,126,222,.06)"; ctx.fillRect(0, Yr(70), L.plotW, Yr(30) - Yr(70));
        for (const v of [30, 70]) { ctx.strokeStyle = IXC.grid; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(0, Yr(v)); ctx.lineTo(L.plotW, Yr(v)); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = IXC.muted; ctx.font = "10px Inter, sans-serif"; ctx.fillText(String(v), L.plotW + 8, Yr(v)); }
        ctx.strokeStyle = IXC.violet; ctx.lineWidth = 1.2; ctx.beginPath(); let st = false; for (let i = L.startIdx; i <= L.endIdx; i++) { const v = this.rsi[i]; if (v == null) continue; st ? ctx.lineTo(X(i), Yr(v)) : ctx.moveTo(X(i), Yr(v)); st = true; } ctx.stroke();
        const rv = this.rsi[L.endIdx]; ctx.fillStyle = IXC.muted; ctx.font = "10.5px Inter, sans-serif"; ctx.fillText(`RSI 14  `, 6, p.y + 8); if (rv != null) { ctx.fillStyle = IXC.violet; ctx.fillText(rv.toFixed(2), 52, p.y + 8); }
      } else if (p.k === "macd") {
        const vis = []; for (let i = L.startIdx; i <= L.endIdx; i++) vis.push(this.macd[i], this.sig[i], this.macd[i] - this.sig[i]);
        const mx = Math.max(...vis.map(Math.abs)) || 1, Ym = (v) => p.y + p.hh / 2 - (v / mx) * (p.hh / 2 - 4);
        for (let i = L.startIdx; i <= L.endIdx; i++) { const h = this.macd[i] - this.sig[i]; ctx.fillStyle = h >= 0 ? IXC.upSoft + ".55)" : IXC.downSoft + ".55)"; ctx.fillRect(X(i) - cw / 2, Math.min(Ym(0), Ym(h)), cw, Math.abs(Ym(h) - Ym(0))); }
        const ln = (arr, col) => { ctx.strokeStyle = col; ctx.lineWidth = 1.1; ctx.beginPath(); for (let i = L.startIdx; i <= L.endIdx; i++) (i === L.startIdx ? ctx.moveTo(X(i), Ym(arr[i])) : ctx.lineTo(X(i), Ym(arr[i]))); ctx.stroke(); };
        ln(this.macd, IXC.blue); ln(this.sig, IXC.amber);
        ctx.fillStyle = IXC.muted; ctx.font = "10.5px Inter, sans-serif"; ctx.fillText("MACD 12 26 9", 6, p.y + 8);
      }
    }
    // time axis
    ctx.fillStyle = IXC.muted; ctx.font = "10px Inter, sans-serif"; ctx.textAlign = "center";
    const every = Math.max(1, Math.round(90 / L.bw)); let lastLbl = "";
    for (let i = L.startIdx; i <= L.endIdx; i += every) { const lbl = this._tlabel(this.bars[i].t); if (lbl !== lastLbl) ctx.fillText(lbl, X(i), H - 8); lastLbl = lbl; }
    ctx.textAlign = "left";
    // replay pick: everything right of the hovered candle is what the replay will play forward
    if (this.pick && this.hover && this.hover.x < L.plotW) {
      const i = this._idxAtX(this.hover.x);
      if (i != null) {
        const xr = X(i) + L.bw / 2;
        ctx.fillStyle = "rgba(10,12,16,.62)"; ctx.fillRect(xr, P.y, L.plotW - xr, H - L.axisB - P.y);
        ctx.strokeStyle = IXC.amber; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(xr, P.y); ctx.lineTo(xr, H - L.axisB); ctx.stroke();
        const txt = this.intraday() ? "▶ Replay from " + this._tlabelFull(this.bars[i].t + this.tfMs()) : "▶ Replay after " + this._tlabelFull(this.bars[i].t);
        ctx.font = "600 11px Inter, sans-serif"; const w = ctx.measureText(txt).width + 14, bx = Math.min(xr + 6, L.plotW - w - 4);
        ctx.fillStyle = "rgba(10,12,16,.92)"; ctx.strokeStyle = IXC.amber; ctx.lineWidth = 1; roundRect(ctx, bx, P.y + 18, w, 22, 4); ctx.fill(); ctx.stroke();
        ctx.fillStyle = IXC.amber; ctx.fillText(txt, bx + 7, P.y + 29);
      }
    }
    // pattern card on hover (like the Portfolio chart)
    if (this.hoverMark) {
      const m = this.hoverMark, hh = this._mh.find((q) => q.m.key === m.key);
      if (hh) {
        const col = m.dir > 0 ? IXC.up : m.dir < 0 ? IXC.down : IXC.amber;
        const lines = [m.name, this._tlabelFull(m.t), `${m.strength || ""} ${m.dir > 0 ? "Bullish" : m.dir < 0 ? "Bearish" : "Neutral"} · conf ${m.score}`, (m.status || "") + " · click for details"];
        ctx.font = "600 11px Inter, sans-serif"; const w = Math.max(...lines.map((t2) => ctx.measureText(t2).width)) + 18, bh = 62;
        const bx = Math.max(2, Math.min(L.plotW - w - 2, hh.x - w / 2)), by = m.dir > 0 ? Math.min(P.y + P.hh - bh - 2, hh.y + 12) : Math.max(P.y + 2, hh.y - bh - 12);
        ctx.fillStyle = "rgba(14,17,23,.96)"; ctx.strokeStyle = col; ctx.lineWidth = 1; roundRect(ctx, bx, by, w, bh, 5); ctx.fill(); ctx.stroke();
        ctx.fillStyle = IXC.fg; ctx.fillText(lines[0], bx + 9, by + 12);
        ctx.font = "10.5px Inter, sans-serif"; ctx.fillStyle = IXC.muted; ctx.fillText(lines[1], bx + 9, by + 26);
        ctx.fillStyle = col; ctx.fillText(lines[2], bx + 9, by + 40); ctx.fillStyle = IXC.muted; ctx.fillText(lines[3], bx + 9, by + 53);
      }
    }
    // crosshair
    const h = this.hover;
    if (h && h.x < L.plotW) {
      ctx.strokeStyle = "rgba(232,234,237,.25)"; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(h.x, 0); ctx.lineTo(h.x, H - L.axisB); ctx.moveTo(0, h.y); ctx.lineTo(L.plotW, h.y); ctx.stroke(); ctx.setLineDash([]);
      if (h.y >= P.y && h.y <= P.y + P.hh) { const v = lo + (1 - (h.y - P.y - 8) / (P.hh - 16)) * (hi - lo); ctx.fillStyle = "#2a313b"; roundRect(ctx, L.plotW + 2, h.y - 7, L.axisR - 4, 14, 3); ctx.fill(); ctx.fillStyle = IXC.fg; ctx.font = "10px Inter, sans-serif"; ctx.fillText(ixFmt(v, 2), L.plotW + 6, h.y); }
      const i = Math.floor(h.x / L.bw) + L.startIdx;
      if (this.onHover) {
        if (i <= L.endIdx && this.bars[i]) this.onHover({ bar: this.bars[i], rsi: this.rsi[i], e20: this.e20[i], e50: this.e50[i], e200: this.e200[i] });
        else if (fan && fan.steps) { const ms = (h.x - x0) / L.bw * this.tfMs(); const s = fan.steps.reduce((a, b) => (Math.abs(b.ms - ms) < Math.abs(a.ms - ms) ? b : a), fan.steps[0]); this.onHover({ future: s }); }
      }
    }
  }
  _xOfTime(t) {
    const L = this.L, b = this.bars, li = L.endIdx; if (!b.length) return null;
    if (t >= b[li].t) return this.X(li) + ((t - b[li].t) / this.tfMs()) * L.bw;
    let lo = 0, hi = li; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (b[m].t <= t) lo = m; else hi = m - 1; }
    return this.X(lo) + ((t - b[lo].t) / this.tfMs()) * L.bw;
  }
  _tlabelFull(t) {
    const d = new Date(t + 5.5 * 3600e3), M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const date = `${d.getUTCDate()} ${M[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    return this.intraday() ? `${date} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} IST` : date;
  }
  _tlabel(t) {
    const d = new Date(t + 5.5 * 3600e3), M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    if (this.tf === "1m" || this.tf === "5m" || this.tf === "15m") return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
    if (this.tf === "1h") return `${d.getUTCDate()} ${M[d.getUTCMonth()]}`;
    if (this.tf === "1d") return `${d.getUTCDate()} ${M[d.getUTCMonth()]}`;
    return `${M[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
  }
}
function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(raw || 1))), f = raw / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; }
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
window.IXChart = IXChart;
