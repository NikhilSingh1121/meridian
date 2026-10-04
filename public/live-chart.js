/* ════════════════════════════════════════════════════════════════════════════
   LIVE SCANNER · FULL-SCREEN LIVE PATTERN CHART
   Opens from the scanner's detail drawer (⛶ button or double-click on the chart).
   Uses the Portfolio section's engine (price-action.js): PAChart candles and overlays,
   PA_PATTERN (19 candlestick patterns), PA_SCORE (confluence + bias), PA_STRUCT
   (trend, swings, support / resistance), PA_MATH (indicators), PA_AI (commentary).
   Every second: today's minute bars come from the scanner's tick store, the forming
   candle is rebuilt at the chosen timeframe, and the whole stack is re-run when the
   tape moved. The side panel is a full, live summary.
   ════════════════════════════════════════════════════════════════════════════ */
var LSC_CHART = (() => {
  const TF = [
    { k: "1m", interval: "1m", range: "5d", ms: 60e3, keep: 1200 },
    { k: "5m", interval: "5m", range: "1mo", ms: 300e3, keep: 900 },
    { k: "15m", interval: "15m", range: "1mo", ms: 900e3, keep: 700 },
    { k: "1D", interval: "1d", range: "1y", ms: 86400e3, keep: 400 },
  ];
  const S = { s: null, tf: "5m", hist: null, candles: [], scored: [], bias: null, sel: null, selKey: null, timer: 0, busy: false, sig: "", seen: new Set(), log: [], calcMs: 0, updatedAt: 0, chart: null, ro: null, err: null };
  const esc2 = (s) => (typeof esc === "function" ? esc(s) : String(s == null ? "" : s));
  const f2 = (v) => (v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const f1 = (v) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(1));
  const pc = (v, dp = 2) => (v == null || !Number.isFinite(v) ? "—" : (v > 0 ? "+" : "") + v.toFixed(dp) + "%");
  const cls = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");
  const hms = (ts) => new Date(ts + 5.5 * 3600e3).toISOString().slice(11, 19);
  const dayIST = (t) => Math.floor((t + 5.5 * 3600e3) / 86400e3);
  const keyOf = (p) => `${p.name}|${p.t}`;
  const tfo = () => TF.find((x) => x.k === S.tf);
  const row = () => (typeof LSC !== "undefined" ? LSC.rows().get(S.s) : null);

  /* ── skeleton ── */
  function shell() {
    let el = document.getElementById("lfc");
    if (el) return el;
    el = document.createElement("div"); el.id = "lfc"; el.className = "lfc"; el.hidden = true;
    el.innerHTML = `
      <header class="lfc-top">
        <div class="lfc-id" id="lfcId"></div>
        <div class="pa-tf mono" id="lfcTf">${TF.map((t) => `<button data-tf="${t.k}">${t.k}</button>`).join("")}</div>
        <span class="lfc-live mono" id="lfcLive"></span>
        <button class="mini-btn" id="lfcNative" type="button" title="Browser full screen (F11-style)">⤢ Full screen</button>
        <button class="mini-btn" id="lfcX" type="button" title="Close (Esc)">✕</button>
      </header>
      <div class="lfc-body">
        <section class="lfc-main">
          <div class="pa-canvas-wrap lfc-cw" id="lfcWrap"><canvas id="lfcCanvas"></canvas></div>
          <div class="pa-tools mono">
            <span class="pa-tool-grp" id="lfcOv">
              <label><input type="checkbox" data-ov="ema20" checked>EMA 20</label>
              <label><input type="checkbox" data-ov="ema50" checked>EMA 50</label>
              <label><input type="checkbox" data-ov="ema200">EMA 200</label>
              <label><input type="checkbox" data-ov="vwap" checked>VWAP</label>
              <label><input type="checkbox" data-ov="bb">Bollinger</label>
              <label><input type="checkbox" data-ov="st">Supertrend</label>
              <label><input type="checkbox" data-ov="sr" checked>S/R</label>
              <label><input type="checkbox" data-ov="tl" checked>Trendlines</label>
            </span>
            <span class="pa-tool-grp">
              <select id="lfcMom"><option value="rsi" selected>RSI</option><option value="macd">MACD</option><option value="adx">ADX</option><option value="atr">ATR</option><option value="obv">OBV</option><option value="mfi">MFI</option><option value="">None</option></select>
              <button class="pa-draw" data-dm="trend" title="Draw trendline (two clicks)">╱</button>
              <button class="pa-draw" data-dm="hline" title="Horizontal line">―</button>
              <button class="pa-draw" data-dm="clear" title="Clear drawings">⌫</button>
            </span>
          </div>
          <div class="pa-timeline-wrap"><div class="pa-timeline-label mono">PATTERN TIMELINE · click to focus</div><div class="pa-timeline" id="lfcTl"></div></div>
        </section>
        <aside class="lfc-side" id="lfcSide"></aside>
      </div>`;
    document.body.appendChild(el);
    S.chart = new PAChart(document.getElementById("lfcCanvas"), { initialBars: 150, onMarkClick: (m) => { S.selKey = keyOf(m); paint(true); } });
    S.chart.setOverlay("vwap", true);
    if (window.ResizeObserver) { S.ro = new ResizeObserver(() => S.chart.resize()); S.ro.observe(document.getElementById("lfcWrap")); }
    window.addEventListener("resize", () => { if (!el.hidden) S.chart.resize(); });
    el.querySelector("#lfcTf").addEventListener("click", (e) => { const b = e.target.closest("[data-tf]"); if (b && b.dataset.tf !== S.tf) { S.tf = b.dataset.tf; try { localStorage.setItem("meridian_lfcTf", S.tf); } catch { } load(); } });
    el.querySelector("#lfcOv").addEventListener("change", (e) => { const i = e.target.closest("[data-ov]"); if (i) S.chart.setOverlay(i.dataset.ov, i.checked); });
    el.querySelector("#lfcMom").addEventListener("change", (e) => S.chart.setMomentum(e.target.value));
    el.querySelector(".pa-tools").addEventListener("click", (e) => { const b = e.target.closest("[data-dm]"); if (!b) return; if (b.dataset.dm === "clear") S.chart.clearDrawings(); else S.chart.setDrawMode(S.chart.drawMode === b.dataset.dm ? "" : b.dataset.dm); });
    el.querySelector("#lfcTl").addEventListener("click", (e) => { const b = e.target.closest("[data-k]"); if (!b) return; S.selKey = b.dataset.k; const m = S.scored.find((x) => keyOf(x) === S.selKey); if (m) S.chart.focus(m.i); paint(true); });
    el.querySelector("#lfcSide").addEventListener("click", (e) => { const b = e.target.closest("[data-k]"); if (!b) return; S.selKey = b.dataset.k; const m = S.scored.find((x) => keyOf(x) === S.selKey); if (m) S.chart.focus(m.i); paint(true); });
    el.querySelector("#lfcX").addEventListener("click", close);
    el.querySelector("#lfcNative").addEventListener("click", () => { try { if (document.fullscreenElement) document.exitFullscreen(); else el.requestFullscreen(); } catch { } });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !el.hidden && !document.fullscreenElement) { e.stopPropagation(); close(); } }, true);
    return el;
  }

  /* ── data ── */
  function aggregate(bars, ms) {
    if (ms <= 60e3) return bars.map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0 }));
    const out = []; let cur = null;
    for (const b of bars) {
      const k = Math.floor(b.t / ms) * ms;
      if (!cur || cur.t !== k) { cur = { t: k, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0 }; out.push(cur); }
      else { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v += b.v || 0; }
    }
    return out;
  }
  function build(today) {
    const tf = tfo(), hist = S.hist || [], r = row();
    let out;
    if (tf.k === "1D") {
      out = hist.slice();
      const last = today && today.length ? today[today.length - 1] : null;
      if (r && r.ltp && (last || r.o)) {
        const t0 = last ? Math.floor((last.t + 5.5 * 3600e3) / 86400e3) * 86400e3 - 5.5 * 3600e3 : Date.now();
        const d = { t: t0, o: r.o || (today[0] && today[0].o) || r.ltp, h: Math.max(r.h || 0, r.ltp), l: Math.min(r.l || Infinity, r.ltp), c: r.ltp, v: r.vol || 0 };
        if (out.length && dayIST(out[out.length - 1].t) === dayIST(d.t)) out[out.length - 1] = d; else out.push(d);
      }
    } else {
      // completed bars come from the exchange-side history (reliable volume); the tick store supplies
      // the bars after it and the forming candle
      const H = hist.map((b) => ({ ...b, t: Math.floor(b.t / tf.ms) * tf.ms }));
      const lastH = H[H.length - 1], cut = lastH ? lastH.t : -Infinity;
      const agg = aggregate(today || [], tf.ms).filter((b) => b.t >= cut);
      out = H.filter((b) => b.t < cut);
      if (agg.length && lastH && agg[0].t === cut) { const a0 = agg[0]; agg[0] = { t: cut, o: lastH.o, h: Math.max(lastH.h, a0.h), l: Math.min(lastH.l, a0.l), c: a0.c, v: Math.max(lastH.v || 0, a0.v || 0) }; }
      else if (lastH) out.push(lastH);
      out = out.concat(agg);
      if (r && r.ltp && out.length) { const b = out[out.length - 1]; b.c = r.ltp; b.h = Math.max(b.h, r.ltp); b.l = Math.min(b.l, r.ltp); }
    }
    return out.filter((b) => b && b.c > 0 && b.h >= b.l).slice(-tf.keep);
  }
  async function load() {
    const s = S.s, tf = tfo(); S.hist = null; S.err = null; S.candles = []; S.scored = []; S.sig = ""; S.seen = new Set(); S.selKey = null;
    for (const b of document.querySelectorAll("#lfcTf button")) b.classList.toggle("on", b.dataset.tf === S.tf);
    head(); document.getElementById("lfcSide").innerHTML = `<div class="loading mono" style="padding:20px">loading ${esc2(s)} · ${tf.k}…</div>`;
    try {
      const j = await api(`/api/scanner/history/${encodeURIComponent(s)}?interval=${tf.interval}&range=${tf.range}`);
      if (S.s !== s || tfo() !== tf) return;
      S.hist = (j.bars || []).filter((b) => b.o != null && b.c > 0).sort((a, b) => a.t - b.t); S.histAt = Date.now();
    } catch (e) { S.hist = []; S.err = "History unavailable: " + e.message; }
    await tick(true);
    S.chart.setData(S.candles, { symbol: s }); S.chart.setMarks(S.scored);
    setTimeout(() => S.chart.resize(), 30);
  }

  /* ── the 1-second loop ── */
  async function refreshHist() {
    const s = S.s, tf = tfo(); S.histAt = Date.now();
    try { const j = await api(`/api/scanner/history/${encodeURIComponent(s)}?interval=${tf.interval}&range=${tf.range}`); if (S.s === s && tfo() === tf && j.bars && j.bars.length) S.hist = j.bars.filter((b) => b.o != null && b.c > 0).sort((a, b) => a.t - b.t); } catch { }
  }
  async function tick(force) {
    if (!S.s || S.busy || (!force && document.getElementById("lfc").hidden)) return;
    if (!force && S.tf !== "1D" && Date.now() - (S.histAt || 0) > 60e3) refreshHist();
    S.busy = true;
    try {
      let today = [];
      try { const j = await api("/api/scanner/bars/" + encodeURIComponent(S.s)); today = j.bars || []; } catch { }
      const c = build(today), last = c[c.length - 1];
      const sig = `${c.length}|${last ? [last.t, last.o, last.h, last.l, last.c, last.v].join(",") : ""}`;
      if (!force && sig === S.sig) { head(); return; }
      S.sig = sig;
      const t0 = performance.now();
      const pats = c.length >= 10 ? PA_PATTERN.detectAll(c) : [];
      const scored = c.length >= 20 ? PA_SCORE.analyze(c, pats) : [];
      S.bias = c.length >= 20 ? PA_SCORE.bias(c, scored) : null;
      // patterns that appeared since the last pass are logged as live detections
      if (S.seen.size) for (const p of scored.slice(-4)) if (!S.seen.has(keyOf(p))) S.log.unshift({ at: Date.now(), p, s: S.s, tf: S.tf });
      S.seen = new Set(scored.map(keyOf)); S.log = S.log.slice(0, 30);
      S.candles = c; S.scored = scored;
      S.calcMs = performance.now() - t0; S.updatedAt = Date.now();
      if (!force) { S.chart.updateData(c, { symbol: S.s }); S.chart.setMarks(scored); }
      paint(false);
    } finally { S.busy = false; }
  }

  /* ── summary panel ── */
  function head() {
    const r = row(), el = document.getElementById("lfcId"); if (!el) return;
    el.innerHTML = `<b>${esc2(S.s)}</b>${r ? ` <span class="ws-dim">${esc2(r.sec || "")}</span> <span class="lfc-px mono">${f2(r.ltp)}</span> <span class="mono ${cls(r.pct)}">${pc(r.pct)}</span>` : ""}`;
    const lv = document.getElementById("lfcLive");
    if (lv) lv.innerHTML = S.updatedAt ? `<i class="lfc-dot"></i> live · recomputed ${hms(S.updatedAt)} IST · ${S.calcMs.toFixed(0)} ms` : "";
  }
  function indicators(c) {
    const closes = c.map((x) => x.c), n = c.length - 1, px = closes[n];
    const e20 = PA_MATH.ema(closes, 20)[n], e50 = PA_MATH.ema(closes, 50)[n], e200 = PA_MATH.ema(closes, 200)[n];
    const rsi = PA_MATH.rsi(closes)[n], macd = PA_MATH.macd(closes), adx = PA_MATH.adx(c)[n], atr = PA_MATH.atr(c)[n];
    const r = row();
    // intraday: the scanner's session VWAP (exchange average price when the feed gives one); daily: anchored VWAP
    const bb = PA_MATH.bollinger(closes), vw = S.tf !== "1D" && r && r.vwap ? r.vwap : PA_MATH.vwap(c)[n], st = PA_MATH.supertrend(c);
    const av = PA_MATH.sma(c.map((x) => x.v || 0), 20)[n];
    const h0 = macd.hist[n], h1 = macd.hist[n - 1];
    const stDir = st && st[n] ? (st[n].up ? 1 : -1) : null;
    const bbPos = bb.up[n] != null && bb.lo[n] != null && bb.up[n] > bb.lo[n] ? (px - bb.lo[n]) / (bb.up[n] - bb.lo[n]) : null;
    return { px, e20, e50, e200, rsi, macdH: h0, macdRising: h0 != null && h1 != null ? h0 > h1 : null, adx, atr, atrPct: atr && px ? (atr / px) * 100 : null, vw, vwD: vw ? (px / vw - 1) * 100 : null, stDir, bbPos, volX: av ? (c[n].v || 0) / av : null };
  }
  function summary(c, I, kl, b, m, r) {
    const tf = S.tf, px = I.px, out = [];
    out.push(`<b>${esc2(S.s)} on the ${tf} chart reads ${b ? `<span class="${b.cls}">${b.label.toLowerCase()}</span> (bias score ${b.score > 0 ? "+" : ""}${b.score})` : "no bias yet (too few candles)"}.</b>`);
    if (b && b.trend) out.push(`The trend engine sees ${b.trend.label.toLowerCase()} (${esc2(b.trend.detail)}).`);
    const stack = I.e20 != null && I.e50 != null ? (px > I.e20 && I.e20 > I.e50 ? "price is above a rising EMA 20 › EMA 50 stack" : px < I.e20 && I.e20 < I.e50 ? "price is below a falling EMA 20 ‹ EMA 50 stack" : "the EMA 20/50 stack is mixed") : null;
    const bits = [];
    if (stack) bits.push(stack);
    if (I.vwD != null) bits.push(`${Math.abs(I.vwD).toFixed(2)}% ${I.vwD >= 0 ? "above" : "below"} VWAP`);
    if (I.e200 != null) bits.push(`${px > I.e200 ? "above" : "below"} the 200-EMA regime`);
    if (I.stDir) bits.push(`Supertrend ${I.stDir > 0 ? "up" : "down"}`);
    if (bits.length) out.push(`Structure: ${bits.join(", ")}.`);
    const mom = [];
    if (I.rsi != null) mom.push(`RSI ${I.rsi.toFixed(0)} (${I.rsi >= 70 ? "overbought" : I.rsi <= 30 ? "oversold" : I.rsi >= 55 ? "bullish zone" : I.rsi <= 45 ? "bearish zone" : "neutral"})`);
    if (I.macdH != null) mom.push(`MACD histogram ${I.macdH >= 0 ? "positive" : "negative"} and ${I.macdRising ? "rising" : "falling"}`);
    if (I.adx != null) mom.push(`ADX ${I.adx.toFixed(0)} (${I.adx >= 30 ? "strong trend" : I.adx >= 20 ? "trend developing" : "weak / ranging"})`);
    if (mom.length) out.push(`Momentum: ${mom.join("; ")}.`);
    if (I.atrPct != null) out.push(`Volatility: ATR(14) ${f2(I.atr)} (${I.atrPct.toFixed(2)}% of price per ${tf} candle)${I.volX ? `; the current candle's volume so far is ${I.volX.toFixed(1)}× its 20-candle average` : ""}.`);
    const lv = [];
    if (kl.s1 != null) lv.push(`support ${f2(kl.s1)} (${((kl.s1 / px - 1) * 100).toFixed(2)}%)`);
    if (kl.r1 != null) lv.push(`resistance ${f2(kl.r1)} (+${((kl.r1 / px - 1) * 100).toFixed(2)}%)`);
    if (lv.length) out.push(`Nearest levels: ${lv.join(", ")}.`);
    if (m) out.push(`Latest pattern: <b class="${cls(m.dir)}">${esc2(m.name)}</b>, ${m.strength.toLowerCase()} (${m.score}/100), ${m.confirmed === true ? "confirmed" : m.confirmed === false ? "not confirmed" : "forming on the live candle"}, ${m.factors.filter((f) => f.ok).length}/${m.factors.length} confluence factors aligned.`);
    if (r) {
      const sc = [];
      if (r.rvol != null) sc.push(`relative volume ${r.rvol.toFixed(2)}×`);
      if (r.orb) sc.push(`opening-range break ${r.orb > 0 ? "up" : "down"}`);
      if (r.brk52) sc.push(`52-week ${r.brk52 > 0 ? "high" : "low"} break`); else if (r.brkN) sc.push(`20-day ${r.brkN > 0 ? "high" : "low"} break`);
      if (r.rsN != null) sc.push(`${r.rsN >= 0 ? "outperforming" : "underperforming"} NIFTY by ${Math.abs(r.rsN).toFixed(2)} pts`);
      if (r.sqzFire) sc.push(`squeeze released ${r.sqzFire > 0 ? "up" : "down"}`); else if (r.sqz) sc.push(`in a squeeze for ${r.sqzBars} bars`);
      if (sc.length) out.push(`Scanner context: ${sc.join("; ")}${(r.tags || []).length ? `; matching scans: ${r.tags.map(esc2).join(", ")}` : ""}.`);
    }
    if (kl.r1 != null && kl.s1 != null) out.push(`What changes the picture: a ${tf} close above ${f2(kl.r1)} opens the next leg up; a close below ${f2(kl.s1)} hands control to sellers.`);
    return out.join(" ");
  }
  function paint(focusOnly) {
    head();
    const c = S.candles, side = document.getElementById("lfcSide"), tl = document.getElementById("lfcTl");
    if (!side) return;
    if (!c.length || c.length < 20) { side.innerHTML = `<div class="pa-empty mono" style="padding:22px">${esc2(S.err || `Waiting for candles: ${c.length} so far, 20 needed for the analysis.`)}</div>`; if (tl) tl.innerHTML = ""; return; }
    const I = indicators(c), kl = PA_STRUCT.keyLevels(c), b = S.bias, r = row();
    const m = (S.selKey && S.scored.find((x) => keyOf(x) === S.selKey)) || S.scored[S.scored.length - 1] || null;
    const tag = (d) => (d > 0 ? "Bullish" : d < 0 ? "Bearish" : "Neutral");
    const tile = (k, v, s, c2) => `<div class="lfc-tile"><div class="k">${k}</div><div class="v ${c2 || ""}">${v}</div><div class="s">${s || ""}</div></div>`;
    const tiles = [
      tile("RSI 14", f1(I.rsi), I.rsi >= 70 ? "overbought" : I.rsi <= 30 ? "oversold" : "", I.rsi >= 55 ? "up" : I.rsi <= 45 ? "down" : ""),
      tile("MACD HIST", I.macdH == null ? "—" : I.macdH.toFixed(3), I.macdRising == null ? "" : I.macdRising ? "rising" : "falling", cls(I.macdH)),
      tile("ADX 14", f1(I.adx), I.adx >= 25 ? "trending" : "ranging"),
      tile("ATR 14", f2(I.atr), I.atrPct != null ? I.atrPct.toFixed(2) + "% of price" : ""),
      tile("VWAP", f2(I.vw), I.vwD != null ? pc(I.vwD) + " away" : "", cls(I.vwD)),
      tile("EMA 20 / 50", `${f2(I.e20)}`, I.e50 != null ? "50: " + f2(I.e50) : "", I.e20 != null && I.e50 != null ? cls(I.e20 - I.e50) : ""),
      tile("BOLLINGER", I.bbPos == null ? "—" : (I.bbPos * 100).toFixed(0) + "%", "position in band"),
      tile("VOLUME", I.volX == null ? "—" : I.volX.toFixed(2) + "×", "vs 20-candle avg", I.volX >= 1.5 ? "up" : ""),
    ].join("");
    const levels = [["R2", kl.r2], ["R1", kl.r1], ["Price", I.px], ["S1", kl.s1], ["S2", kl.s2]].map(([k, v]) => `<div class="lfc-lv ${k === "Price" ? "px" : k[0] === "R" ? "r" : "s"}"><span>${k}</span><b class="mono">${f2(v)}</b><small class="mono">${v != null && k !== "Price" ? pc((v / I.px - 1) * 100) : ""}</small></div>`).join("");
    const pat = m ? `<div class="pa-cur"><div class="pa-cur-l mono">${m === S.scored[S.scored.length - 1] ? "Latest pattern" : "Selected pattern"}</div>
        <div class="pa-cur-row">${PA._glyphSVG ? PA._glyphSVG.call(PA, m) : ""}<div class="pa-cur-tx"><b class="${cls(m.dir)}">${esc2(m.name)}</b><span class="${cls(m.dir)}">${m.strength} ${tag(m.dir)}</span><small class="mono">${m.i === c.length - 1 ? "on the live candle" : new Date(m.t + 5.5 * 3600e3).toISOString().slice(S.tf === "1D" ? 0 : 5, S.tf === "1D" ? 10 : 16).replace("T", " ") + (S.tf === "1D" ? "" : " IST")}</small></div><div class="pa-conf mono"><b>${m.score}</b><small>conf</small></div></div>
        <div class="pa-strength"><i style="width:${m.score}%;background:${m.dir > 0 ? "var(--up)" : m.dir < 0 ? "var(--down)" : "var(--amber)"}"></i></div>
        <ul class="lfc-fac">${m.factors.map((f) => `<li class="${f.ok ? "ok" : "no"}"><span>${f.ok ? "✓" : "·"}</span>${esc2(f.t)}</li>`).join("")}</ul>
        <div class="lfc-p"><b>Setup.</b> ${esc2(PA_AI.strategy(m))}</div><div class="lfc-p"><b>Invalidation.</b> ${esc2(PA_AI.risk(m).split(". ")[0])}.</div></div>` : `<div class="pa-empty mono" style="padding:10px">No candlestick pattern in the loaded window.</div>`;
    const recent = S.scored.slice(-8).reverse().map((p) => `<button class="lfc-rp ${S.selKey === keyOf(p) ? "on" : ""}" data-k="${esc2(keyOf(p))}" type="button"><span class="${cls(p.dir)}">${p.dir > 0 ? "▲" : p.dir < 0 ? "▼" : "◆"}</span> ${esc2(p.name)} <small class="mono">${p.score}</small></button>`).join("");
    const log = S.log.length ? S.log.slice(0, 8).map((x) => `<div class="lfc-log"><span class="mono ws-dim">${hms(x.at)}</span> <b class="${cls(x.p.dir)}">${esc2(x.p.name)}</b> <span class="ws-dim">${x.tf} · ${x.p.score}/100</span></div>`).join("") : `<div class="ws-dim ec-small">New patterns detected while this chart is open are listed here with the time they appeared.</div>`;
    side.innerHTML = `
      <div class="pa-side-h"><span>LIVE SUMMARY</span>${b ? `<span class="pa-bias ${b.cls}">${b.label}</span>` : ""}</div>
      <div class="lfc-sum">${summary(c, I, kl, b, m, r)}</div>
      <div class="lfc-h mono">INDICATORS · ${S.tf}</div><div class="lfc-tiles">${tiles}</div>
      <div class="lfc-h mono">KEY LEVELS (support / resistance clusters)</div><div class="lfc-lvs">${levels}</div>
      <div class="lfc-h mono">PATTERN</div>${pat}
      <div class="lfc-h mono">RECENT PATTERNS</div><div class="lfc-rps">${recent || `<span class="ws-dim ec-small">none</span>`}</div>
      <div class="lfc-h mono">DETECTED LIVE</div>${log}
      <div class="ec-foot" style="padding:8px 0 16px">Candlestick detection, confluence scoring and bias are the Portfolio section's engine, recomputed every second on the live candles. Patterns on the live candle can change until it closes. Analysis, not advice.</div>`;
    const when = (p) => (p.i === c.length - 1 ? "live" : new Date(p.t + 5.5 * 3600e3).toISOString().slice(S.tf === "1D" ? 5 : 11, S.tf === "1D" ? 10 : 16));
    if (tl) tl.innerHTML = S.scored.slice(-60).reverse().map((p) => `<div class="pa-tl-item ${S.selKey === keyOf(p) ? "on" : ""}" data-k="${esc2(keyOf(p))}" title="${esc2(p.name)} · ${p.score}/100 · ${p.strength}"><span class="pa-dot ${p.dir > 0 ? "up" : p.dir < 0 ? "down" : "flat"}"></span><span class="pa-tl-n">${esc2(p.name)}</span><span class="pa-tl-d mono">${when(p)} · ${p.score}</span></div>`).join("") || `<span class="pa-empty mono">no patterns in the loaded window</span>`;
    if (focusOnly && m) S.chart.draw();
  }

  /* ── open / close ── */
  function open(s) {
    const el = shell();
    try { S.tf = localStorage.getItem("meridian_lfcTf") || S.tf; } catch { }
    if (!TF.some((t) => t.k === S.tf)) S.tf = "5m";
    S.s = s; S.log = [];
    el.hidden = false; document.body.classList.add("lfc-open");
    clearInterval(S.timer); S.timer = setInterval(() => tick(false), 1000);
    load();
    setTimeout(() => S.chart.resize(), 50);
  }
  function close() {
    const el = document.getElementById("lfc"); if (!el) return;
    if (document.fullscreenElement) try { document.exitFullscreen(); } catch { }
    el.hidden = true; document.body.classList.remove("lfc-open"); clearInterval(S.timer); S.s = null;
  }
  return { open, close, state: S, aggregate, build: (today) => build(today) };
})();
