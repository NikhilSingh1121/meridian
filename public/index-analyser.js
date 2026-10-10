/* ════════════════════════════════════════════════════════════════════════════
   M-TERMINAL — INDEX ANALYSER
   Answers three questions in real time:
     1. What is the market doing right now?          → regime engine, breadth, sectors, global, levels
     2. What is the highest-probability setup, and    → scenario engine (bull / base / bear with
        what would invalidate it?                        triggers, targets, invalidation), multi-timeframe
     3. When to act, wait or stay out?                 → smart alerts, setup bias, trade planner
   One Server-Sent-Events stream per index (/api/ix/stream) carries ticks (every price
   change), analysis (every 5 s) and derivatives (every minute). Panels are patched in
   place (no flicker, scroll and focus kept); the chart extends its candle on every tick.
   Probabilities are model estimates from historical behaviour — never promises.
   ════════════════════════════════════════════════════════════════════════════ */
const IXA = (() => {
  const LS = (k, d) => { try { const v = localStorage.getItem("meridian_ixa_" + k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const SAVE = (k, v) => { try { localStorage.setItem("meridian_ixa_" + k, JSON.stringify(v)); } catch { } };
  const S = {
    key: LS("key", "NIFTY"), tf: LS("tf", "5m"), tab: LS("tab", "oi"), scHz: LS("scHz", "intraday"), ind: LS("ind", null),
    rules: LS("rules", { vwap: true, orb: true, levels: true, near: true, vol: true, oi: true }), notify: LS("notify", false), watch: LS("watch", []),
    A: null, OI: null, es: null, chart: null, mounted: false, indices: [], ticker: [], chainExp: null, chainData: null, chainView: "oi", heat: "oi",
    seas: {}, cal: null, corr: {}, corrSet: "indices", lots: null, wl: new Map(), wlEs: null, alerts: [], hiddenAt: null, retry: 0, lastTick: 0,
  };
  const $i = (id) => document.getElementById(id);
  const E = (s) => (typeof esc === "function" ? esc(s) : String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));
  const N = (v, dp = 2) => (v == null || !isFinite(v) ? "—" : Number(v).toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp }));
  const P = (v, dp = 2) => (v == null || !isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${Number(v).toFixed(dp)}%`);
  const PCT = (v, dp = 0) => (v == null || !isFinite(v) ? "—" : `${(v * 100).toFixed(dp)}%`);
  const cls = (v) => (v == null || !isFinite(v) || v === 0 ? "" : v > 0 ? "up" : "down");
  const CR = (v) => (v == null || !isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr`);
  const K = (v) => (v == null || !isFinite(v) ? "—" : Math.abs(v) >= 1e7 ? (v / 1e7).toFixed(2) + " Cr" : Math.abs(v) >= 1e5 ? (v / 1e5).toFixed(2) + " L" : Math.round(v).toLocaleString("en-IN"));
  const hhmm = (t) => { const d = new Date(t + 5.5 * 3600e3); return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };
  const hhmmss = (t) => new Date(t + 5.5 * 3600e3).toISOString().slice(11, 19);
  const Phi = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
  const INTRA = ["1m", "5m", "15m", "1h"];
  const TF_LBL = { "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1H", "1d": "D", "1wk": "W", "1mo": "M" };
  const info = (k, title, text) => `<button class="mt-i ixa-i" type="button" data-info="${E(k)}" data-title="${E(title)}" data-text="${E(text)}" aria-label="About ${E(title)}">i</button>`;
  const spark = (arr, w = 90, h = 26, col) => {
    const a = (arr || []).filter((x) => isFinite(x)); if (a.length < 2) return `<svg width="${w}" height="${h}"></svg>`;
    const mn = Math.min(...a), mx = Math.max(...a), sp = mx - mn || 1, c = col || (a[a.length - 1] >= a[0] ? "var(--up)" : "var(--down)");
    const d = a.map((v, i) => `${i ? "L" : "M"}${((i / (a.length - 1)) * (w - 2) + 1).toFixed(1)} ${(h - 2 - ((v - mn) / sp) * (h - 4)).toFixed(1)}`).join("");
    return `<svg class="ixa-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="${d}" fill="none" stroke="${c}" stroke-width="1.4"/></svg>`;
  };
  const bar = (v, max = 100, col) => `<span class="ixa-bar"><i style="width:${Math.max(0, Math.min(100, (v / max) * 100)).toFixed(1)}%;${col ? `background:${col}` : ""}"></i></span>`;
  const toneCol = (v) => (v == null ? "var(--muted-ink)" : v >= 60 ? "var(--up)" : v <= 40 ? "var(--down)" : "var(--amber)");

  /* ── minimal DOM patcher: only changed nodes are touched (no flicker; scroll, focus, canvases kept) ── */
  function morph(el, html) { if (!el) return; if (el._h === html) return; el._h = html; const t = document.createElement(el.tagName); t.innerHTML = html; patch(el, t); }
  function patch(a, b) {
    const ac = [...a.childNodes], bc = [...b.childNodes];
    for (let i = 0; i < bc.length; i++) {
      const x = ac[i], y = bc[i];
      if (!x) { a.appendChild(y.cloneNode(true)); continue; }
      if (x.nodeType !== y.nodeType || x.nodeName !== y.nodeName) { a.replaceChild(y.cloneNode(true), x); continue; }
      if (x.nodeType === 3) { if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue; continue; }
      if (x.nodeType !== 1) continue;
      // data-keep="key" keeps a node the user is editing — but only against the same key; anything else replaces it
      if (x.hasAttribute("data-keep")) { if (y.getAttribute("data-keep") !== x.getAttribute("data-keep")) a.replaceChild(y.cloneNode(true), x); continue; }
      if (y.hasAttribute("data-keep")) { a.replaceChild(y.cloneNode(true), x); continue; }
      const form = x.tagName === "INPUT" || x.tagName === "SELECT" || x.tagName === "TEXTAREA";
      if (form && document.activeElement === x) continue;
      for (const at of [...x.attributes]) if (!y.hasAttribute(at.name)) x.removeAttribute(at.name);
      for (const at of [...y.attributes]) if (x.getAttribute(at.name) !== at.value) x.setAttribute(at.name, at.value);
      if (x.tagName === "CANVAS") continue;
      patch(x, y);
      // attributes only set defaults: keep the live properties in step with the markup
      if (x.tagName === "INPUT") { if (x.type === "checkbox" || x.type === "radio") x.checked = y.hasAttribute("checked"); else x.value = y.getAttribute("value") || ""; }
      else if (x.tagName === "SELECT") { const o = y.querySelector("option[selected]"); if (o) x.selectedIndex = [...y.options].indexOf(o); }
    }
    for (let i = ac.length - 1; i >= bc.length; i--) a.removeChild(ac[i]);
  }

  /* ══ SKELETON ═══════════════════════════════════════════════════════════ */
  function skeleton() {
    const ind = S.ind || {};
    const INDS = [["ema20", "EMA 20"], ["ema50", "EMA 50"], ["ema200", "EMA 200"], ["bb", "Bollinger 20, 2"], ["twap", "VWAP (session avg)"], ["levels", "Pivots & key levels"], ["oi", "OI profile (strikes)"], ["rsi", "RSI pane"], ["macd", "MACD pane"], ["cone", "Probability cone"], ["pat", "Candlestick patterns"]];
    return `
    <div class="ixa-ticker" id="ixaTicker"></div>
    <div class="ixa-top">
      <div class="ixa-left">
        <aside class="ixa-side" id="ixaSide"><div class="loading mono" style="padding:16px">loading indices…</div></aside>
        <section class="panel ixa-pat" id="ixaPat"></section>
      </div>
      <section class="ixa-main panel">
        <div class="ixa-chead">
          <div class="ixa-title"><h2 id="ixaName">—</h2><span class="mono" id="ixaSym"></span></div>
          <div class="ixa-tfs" id="ixaTf">${Object.entries(TF_LBL).map(([k, l]) => `<button type="button" data-tf="${k}" class="${k === S.tf ? "on" : ""}">${l}</button>`).join("")}</div>
          <div class="ixa-dd"><button class="ixa-btn" type="button" data-dd="ixaIndMenu">Indicators ▾</button>
            <div class="ixa-menu" id="ixaIndMenu" hidden>${INDS.map(([k, l]) => `<label><input type="checkbox" data-ind="${k}" ${k === "bb" || k === "oi" ? (ind[k] ? "checked" : "") : ind[k] === false ? "" : "checked"}> ${l}</label>`).join("")}</div></div>
          <div class="ixa-seg ixa-view" id="ixaView" title="How the forecast is drawn">${[["scen", "Scenarios"], ["analog", "Analog paths"], ["models", "Models"]].map(([k, l]) => `<button type="button" data-view="${k}" class="${(ind.view || "scen") === k ? "on" : ""}">${l}</button>`).join("")}</div>
          <span class="sp"></span>
          <span class="ixa-live" id="ixaLive"><i></i>CONNECTING</span>
          <button class="ixa-btn ixa-rpb" type="button" id="ixaRpBtn" title="Bar replay — pick a past candle and play the history forward, with the forecast rebuilt as it stood then">⏮ Replay</button>
          <button class="ixa-btn" type="button" id="ixaFull" title="Fullscreen chart">⛶</button>
        </div>
        <div class="ixa-legend" id="ixaLegend"></div>
        <div class="ixa-rpbar" id="ixaRpBar" hidden></div>
        <div class="ixa-cwrap" id="ixaCwrap"><canvas id="ixaCv"></canvas><div class="ixa-bo" id="ixaBo"></div><div class="ixa-fut" id="ixaFut" hidden></div><div class="ixa-rp-pick" id="ixaRpPick" hidden></div></div>
        <div class="ixa-cfoot" id="ixaCfoot"></div>
      </section>
      <aside class="ixa-right">
        <div class="panel ixa-reg" id="ixaReg"></div>
        <div class="panel ixa-lv" id="ixaLv"></div>
      </aside>
    </div>
    <div class="ixa-strip" id="ixaStrip"></div>
    <div class="panel ixa-work">
      <nav class="ixa-wtabs" id="ixaWtabs"></nav>
      <div class="ixa-wbody" id="ixaWbody"></div>
    </div>
    <div class="ixa-disc">Probabilities, scenarios and the regime score are model estimates built from this index's own history and live market data — not guaranteed outcomes and not investment advice. Index prices stream from Yahoo; option chain, futures, breadth and positioning from NSE public data (with fallbacks). OI alone is not proof of direction.</div>
    <div class="ixa-toasts" id="ixaToasts"></div>`;
  }

  /* ══ STREAM ═════════════════════════════════════════════════════════════ */
  function connect() {
    if (S.es) { S.es.close(); S.es = null; }
    setLive("CONNECTING", "");
    const es = new EventSource(`/api/ix/stream?symbol=${encodeURIComponent(S.key)}`);
    S.es = es; const key = S.key;
    es.addEventListener("init", (e) => { if (key !== S.key) return; S.retry = 0; const d = JSON.parse(e.data); if (d.analysis) onAnalysis(d.analysis); loadBars(); });
    es.addEventListener("analysis", (e) => { if (key !== S.key || RP.on) return; onAnalysis(JSON.parse(e.data)); });
    es.addEventListener("tick", (e) => { if (key !== S.key) return; onTick(JSON.parse(e.data)); });
    es.addEventListener("oi", (e) => { if (key !== S.key) return; S.OI = JSON.parse(e.data); if (S.tab === "oi") renderWork(); });
    es.addEventListener("alert", (e) => { if (key !== S.key) return; onAlert(JSON.parse(e.data)); });
    es.addEventListener("bars", () => { if (key === S.key) loadBars(true); });
    es.onerror = () => { setLive("RECONNECTING", "err"); if (es.readyState === 2) setTimeout(() => { if (S.es === es && !document.hidden) connect(); }, Math.min(15000, 1500 * ++S.retry)); };
  }
  function setLive(txt, c) { const el = $i("ixaLive"); if (el) { el.className = "ixa-live " + c; el.innerHTML = `<i></i>${txt}`; } }
  async function loadBars(keepView) {
    if (RP.on) return;
    const key = S.key, tf = S.tf;
    try {
      const j = await api(`/api/ix/bars?symbol=${encodeURIComponent(key)}&tf=${tf}`);
      if (key !== S.key || tf !== S.tf || !S.chart || RP.on || RP.picking) return;
      S.chart.setBars(j.bars || [], tf); S.shortHistory = j.shortHistory;
      updateChartOverlay(); renderFoot(); legend(null); patSchedule(true);
    } catch { }
  }
  function onTick(d) { S.lastTick = Date.now(); if (S.chart) S.chart.updateTick(d.ts, d.price); onPrice(d.price); patSchedule(); }
  function onPrice(p) {
    const A = S.A; if (!A) return;
    A.last = p; if (A.prevClose) { A.change = p - A.prevClose; A.changePct = (p / A.prevClose - 1) * 100; }
    renderHeaderPrice();
  }
  function onAnalysis(a) {
    const first = !S.A || S.A.key !== a.key; S.A = a;
    for (const al of a.alerts || []) if (!S.alerts.some((x) => x.id === al.id)) S.alerts.push(al);
    S.alerts.sort((x, y) => y.ts - x.ts); S.alerts = S.alerts.slice(0, 80);
    const st = a.status || {};
    if (RP.on) setLive(`REPLAY · ${rpLabel()}`, "rp");
    else setLive(st.open ? "LIVE" : (st.reason === "holiday" || st.reason === "weekend") ? "NO SESSION TODAY" : "MARKET CLOSED", st.open ? "on" : "");
    renderAll(first); updateChartOverlay();
  }

  /* ══ RENDER ═════════════════════════════════════════════════════════════ */
  function renderAll() { renderTicker(); renderSide(); renderHeader(); renderReg(); renderLv(); renderStrip(); renderTabs(); renderWork(); renderBo(); }
  function renderTicker() {
    const t = (S.A && S.A.market && S.A.market.ticker) || {};
    const keys = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "INDIAVIX"];
    const cur = S.A, curT = t[S.key] || {};
    const main = `<button class="ixa-tk-main" type="button" data-ix="${E(S.key)}"><span class="ixa-tk-n">${E(cur ? cur.name : S.key)}</span><b>${N(cur && cur.last)}</b><em class="${cls(cur && cur.changePct)}">${cur && cur.change != null ? (cur.change > 0 ? "+" : "") + N(cur.change) : ""} (${P(cur && cur.changePct)})</em>${spark(curT.spark && curT.spark.length ? [...curT.spark.slice(0, -1), cur && cur.last] : [], 110, 30)}</button>`;
    if (RP.on) { morph($i("ixaTicker"), main + `<div class="ixa-tk-rp"><b>REPLAY · ${E(rpLabel())} IST</b><span>Candles, patterns, forecast, scenarios, levels and regime are rebuilt from the bars that existed at this moment — nothing later. Breadth, sectors, global markets, FII/DII and the option chain are live-only data (no intraday history), so they are not replayed.</span></div>`); return; }
    morph($i("ixaTicker"), main + keys.filter((k) => k !== S.key).map((k) => { const v = t[k] || {}; return `<button class="ixa-tk" type="button" data-ix="${k}"><span>${E(v.label || k)}</span><b>${N(v.price)}</b><em class="${k === "INDIAVIX" ? cls(-(v.changePct || 0)) : cls(v.changePct)}">${v.change != null ? (v.change > 0 ? "+" : "") + N(v.change) : ""} (${P(v.changePct)})</em>${spark(v.spark, 70, 24, k === "INDIAVIX" ? (v.changePct > 0 ? "var(--down)" : "var(--up)") : null)}</button>`; }).join(""));
  }
  function renderSide() {
    if (!S.indices.length) return;
    const sect = new Map(((S.A && S.A.market && S.A.market.sectors) || []).map((s) => [s.symbol, s.changePct]));
    const tk = (S.A && S.A.market && S.A.market.ticker) || {};
    const groups = [...new Set(S.indices.map((x) => x.group))];
    morph($i("ixaSide"), groups.map((g) => `<div class="ixa-sg mono">${E(g.toUpperCase())}</div>` + S.indices.filter((x) => x.group === g).map((x) => {
      const chg = tk[x.key] && tk[x.key].changePct != null ? tk[x.key].changePct : sect.get(x.yahoo);
      return `<button type="button" class="ixa-si${x.key === S.key ? " on" : ""}" data-ix="${E(x.key)}"><span class="ixa-sic">${x.key === "INDIAVIX" ? "◈" : "▮"}</span><span class="ixa-sin">${E(x.name)}</span>${x.options ? '<span class="ixa-fo" title="Options & OI available">F&amp;O</span>' : ""}<em class="${x.key === "INDIAVIX" ? cls(-(chg || 0)) : cls(chg)}">${chg != null ? P(chg) : ""}</em></button>`;
    }).join("")).join("") + `<div class="ixa-sg mono">TOOLS</div>
      <button type="button" class="ixa-si" data-goto="pat"><span class="ixa-sic">◮</span><span class="ixa-sin">Patterns & insights</span></button>
      <button type="button" class="ixa-si" data-goto="scen"><span class="ixa-sic">⟁</span><span class="ixa-sin">Scenario engine</span></button>
      <button type="button" class="ixa-si" data-goto="oi"><span class="ixa-sic">▤</span><span class="ixa-sin">Options & OI</span></button>
      <button type="button" class="ixa-si" data-goto="alerts"><span class="ixa-sic">⚑</span><span class="ixa-sin">Signals & alerts</span></button>
      <button type="button" class="ixa-si" data-goto="corr"><span class="ixa-sic">◫</span><span class="ixa-sin">Correlation</span></button>
      <button type="button" class="ixa-si" data-goto="plan"><span class="ixa-sic">⚖</span><span class="ixa-sin">Trade planner</span></button>`);
  }
  function renderHeader() {
    const A = S.A; if (!A) return;
    $i("ixaName").textContent = A.name; $i("ixaSym").textContent = `${A.group}${A.hasOi ? " · F&O" : ""}`;
    renderHeaderPrice(); legend(null);
  }
  function renderHeaderPrice() { renderTicker(); if (!S.hoverOn) legend(null); }
  function legend(h) {
    const A = S.A, el = $i("ixaLegend"); if (!A || !el) return;
    const ch = S.chart, n = ch && ch.bars.length ? ch.bars.length - 1 : -1;
    const b = h && h.bar ? h.bar : ch && n >= 0 ? ch.bars[n] : null, i = h && h.bar ? ch.bars.indexOf(h.bar) : n;
    if (h && h.future) { const s = h.future; morph(el, `<span class="mono">Forecast ${E(s.label || "")}</span> <span>10%</span><b>${N(s.q[0])}</b> <span>25%</span><b>${N(s.q[1])}</b> <span>median</span><b>${N(s.q[2])}</b> <span>75%</span><b>${N(s.q[3])}</b> <span>90%</span><b>${N(s.q[4])}</b>${s.pUp != null ? ` <span>P(up)</span><b>${PCT(s.pUp)}</b>` : ""}`); return; }
    if (!b) { el.textContent = ""; return; }
    const chg = b.c - b.o;
    morph(el, `<span class="mono">${E(A.name)} · ${TF_LBL[S.tf]}</span> <span>O</span><b>${N(b.o)}</b> <span>H</span><b>${N(b.h)}</b> <span>L</span><b>${N(b.l)}</b> <span>C</span><b class="${cls(chg)}">${N(b.c)}</b> <em class="${cls(chg)}">${chg >= 0 ? "+" : ""}${N(chg)}</em>
      ${ch && ch.ind.ema20 ? `<span class="ixa-lg" style="--c:#e8a33d">EMA 20</span><b>${N(ch.e20[i])}</b>` : ""}${ch && ch.ind.ema50 ? `<span class="ixa-lg" style="--c:#5b8dd6">EMA 50</span><b>${N(ch.e50[i])}</b>` : ""}${ch && ch.ind.ema200 ? `<span class="ixa-lg" style="--c:#c84b3c">EMA 200</span><b>${N(ch.e200[i])}</b>` : ""}
      ${INTRA.includes(S.tf) && A.tech && A.tech.twap ? `<span class="ixa-lg" style="--c:#3fb8af">VWAP</span><b>${N(A.tech.twap)}</b>` : ""}
      ${PT.scored.filter((p) => p.t === b.t).map((p) => `<span class="ixa-lgp ${cls(p.dir)}">${p.dir > 0 ? "▲" : p.dir < 0 ? "▼" : "◆"} ${E(p.name)} ${p.score}</span>`).join("")}`);
  }
  function renderBo() {
    const A = S.A, el = $i("ixaBo"); if (!A || !el) return;
    const b = A.breakout || {};
    morph(el, `<div class="ixa-bo-h">Possible breakout levels ${info("bo", "Breakout levels", "The nearest levels above and below the price from the level map (pivots, session levels, swing highs/lows, option walls), with the distance in % and in 5-minute ATRs, and the modelled probability of touching each before the close.")}</div>
      ${b.up ? `<div class="up">▲ ${N(b.up.price)} <small>${P(b.up.distPct)} · ${E(b.up.label)} · ${PCT(b.up.pTouch)}</small></div>` : ""}
      ${b.down ? `<div class="down">▼ ${N(b.down.price)} <small>${P(b.down.distPct)} · ${E(b.down.label)} · ${PCT(b.down.pTouch)}</small></div>` : ""}
      ${b.watch ? `<div class="ixa-bo-w">Breakout watch: ${b.watch === "up" ? "upside" : "downside"}</div>` : ""}`);
  }
  function renderFoot() {
    const A = S.A, el = $i("ixaCfoot"); if (!el) return;
    const f = A && (INTRA.includes(S.tf) ? A.forecast : A.forecastDaily);
    const rel = A && A.reliability && A.reliability.stats && A.reliability.stats.ensemble;
    morph(el, `<span>wheel zoom · drag pan · double-click reset</span><span class="sp"></span>
      ${S.shortHistory && !INTRA.includes(S.tf) ? `<span class="ixa-warn">Yahoo keeps no long daily history for this index — daily bars are built from 60 sessions of 5-minute data</span>` : ""}
      ${INTRA.includes(S.tf) && A && !A.forecast ? `<span>${A.status && A.status.open ? "Forecast starts 5 minutes after the open" : "Intraday forecast resumes at the next open — switch to D / W / M for multi-day projections"}</span>` : ""}
      ${f && INTRA.includes(S.tf) && rel ? `<span title="Walk-forward over the last ${A.reliability.sessions} sessions at a 30-minute horizon">Model reliability: 80% band held ${PCT(rel.coverage80)} · 50% band ${PCT(rel.coverage50)}${A.forecast.bandInflation > 1.001 ? ` · bands widened ×${A.forecast.bandInflation}` : ""}</span>` : ""}
      ${S.chart && S.chart.ind.view === "analog" ? (INTRA.includes(S.tf) ? (A && A.analogs ? `<span title="${E((A.analogs.days || []).join(", "))}">Analog view: the ${A.analogs.n} past sessions whose path from the previous close best matches today's · yellow = their average · bands = 10–90% / 25–75%</span>` : `<span>Analog paths appear during market hours, a few minutes after the open</span>`) : `<span>Analog paths are an intraday view — pick 1m, 5m or 15m</span>`) : ""}
      ${RP.on && A && A.replay ? `<span class="ixa-warn">Replay: analysis rebuilt from bars before ${E(rpLabel())} · ${A.replay.barMin === 5 ? "5-minute bars (1-minute history covers the last ~5 sessions)" : "1-minute bars"} · model weights: ${E(A.replay.weights)}</span>` : ""}
      <span class="mono">${A ? (RP.on ? "as of " : "updated ") + hhmmss(A.asOf) + " IST" : ""}</span>`);
  }

  /* chart overlays from the latest analysis, for the selected timeframe */
  function updateChartOverlay() {
    const A = S.A, ch = S.chart; if (!A || !ch || !ch.bars.length) return;
    const intra = INTRA.includes(S.tf);
    const MAJOR = intra ? ["R1", "R2", "R3", "S1", "S2", "S3", "P", "PDH", "PDL", "CW", "PW"] : ["WR1", "WS1", "WP", "CW", "PW", "R2", "S2", "PDH", "PDL"];
    const SHORT = { P: "P", PDH: "PDH", PDL: "PDL", CW: "Call wall", PW: "Put wall", MP: "Max pain", WP: "W pivot", WR1: "W R1", WS1: "W S1", ORH: "OR high", ORL: "OR low" };
    const levels = (A.levels || []).filter((l) => intra || !["orb", "session", "projection"].includes(l.group) || ["PDH", "PDL"].includes(l.key)).map((l) => ({ ...l, major: MAJOR.includes(l.key), short: SHORT[l.key] || l.key }));
    const bars = ch.bars, lastDay = new Date(bars[bars.length - 1].t + 5.5 * 3600e3).toISOString().slice(0, 10);
    const t0 = (bars.find((b) => new Date(b.t + 5.5 * 3600e3).toISOString().slice(0, 10) === lastDay) || {}).t;
    let fan = null, scen = null;
    if (intra && A.forecast) {
      const lbl = (h, last) => (h === last ? "Close" : h >= 60 ? `+${h / 60}h` : `+${h}m`);
      const st = A.forecast.ensemble.steps, lastH = st[st.length - 1].h;
      fan = { steps: st.map((s) => ({ ms: s.h * 60e3, q: s.q, pUp: s.pUp, label: lbl(s.h, lastH) })), horizonMs: lastH * 60e3,
        models: Object.fromEntries(Object.entries(A.forecast.models).map(([k, m]) => [k, { label: m.label, steps: m.steps.map((s) => ({ ms: s.h * 60e3, q: s.q })) }])),
        labels: st.filter((s) => [15, 30, 60, 120].includes(s.h) || s.h === lastH).map((s) => ({ ms: s.h * 60e3, label: lbl(s.h, lastH) })) };
      const sc = A.scenarios && A.scenarios.intraday;
      if (sc) scen = Object.fromEntries(["bull", "base", "bear"].map((k) => [k, { p: sc[k].p, path: sc[k].path.map((p) => ({ ms: p.h * 60e3, p: p.p })) }]));
    } else if (!intra && A.forecastDaily) {
      const perBar = S.tf === "1d" ? 1 : S.tf === "1wk" ? 5 : 21, tfMs = ch.tfMs();
      const hz = S.tf === "1d" ? [1, 2, 3, 5, 10, 21] : S.tf === "1wk" ? [5, 10, 21, 42, 63] : [21, 42, 63, 126];
      const LBL = { 1: "+1D", 2: "+2D", 3: "+3D", 5: "+1W", 10: "+2W", 21: "+1M", 42: "+2M", 63: "+3M", 126: "+6M" };
      const st = A.forecastDaily.ensemble.steps.filter((s) => hz.includes(s.h)).map((s) => ({ ms: (s.h / perBar) * tfMs, q: s.q, pUp: s.pUp, label: LBL[s.h] }));
      if (st.length) {
        fan = { steps: st, horizonMs: st[st.length - 1].ms, labels: st.map((s) => ({ ms: s.ms, label: s.label })),
          models: Object.fromEntries(Object.entries(A.forecastDaily.models).map(([k, m]) => [k, { label: m.label, steps: m.steps.filter((s) => hz.includes(s.h)).map((s) => ({ ms: (s.h / perBar) * tfMs, q: s.q })) }])) };
        scen = scenFromSteps(st, A.last);
      }
    }
    ch.setOverlay({ levels, prevClose: A.prevClose, twap: intra && A.tech && A.tech.twap && t0 ? { v: A.tech.twap, t0 } : null, orb: intra && A.orb && t0 ? { h: A.orb.h, l: A.orb.l, t0, t1: t0 + 15 * 60e3 } : null,
      oiProfile: S.OI && S.OI.profile, fan, scenarios: scen, analogs: intra ? A.analogs : null });
    renderFoot();
  }
  /** bull / base / bear probabilities and paths from quantile steps (θ = half the horizon σ) */
  function scenFromSteps(st, last) {
    const end = st[st.length - 1], med = Math.log(end.q[2] / last), sd = Math.max(1e-6, (Math.log(end.q[4] / last) - Math.log(end.q[0] / last)) / 2.563), th = sd / 2;
    const pBull = 1 - Phi((th - med) / sd), pBear = Phi((-th - med) / sd);
    const path = (f) => st.map((s) => ({ ms: s.ms, p: f(s.q) }));
    return { bull: { p: pBull, path: path((q) => (q[3] + q[4]) / 2) }, base: { p: Math.max(0, 1 - pBull - pBear), path: path((q) => q[2]) }, bear: { p: pBear, path: path((q) => (q[0] + q[1]) / 2) } };
  }

  /* ── right column: regime engine + key levels ── */
  function renderReg() {
    const A = S.A, R = A && A.regime; if (!R) return;
    const icon = /Bullish/.test(R.label) ? "▲" : /Bearish/.test(R.label) ? "▼" : /Volatile/.test(R.label) ? "≈" : "↔";
    const tone = R.score >= 60 ? "up" : R.score <= 40 ? "down" : "flat";
    const pil = R.pillars || {};
    const pillars = [["Trend strength", pil.trendStrength], ["Trend direction", pil.trend], ["Momentum", pil.momentum], ["Breadth", pil.breadth], ["Volatility (calm = high)", pil.volatility], ["Global cues", pil.global], ["Derivatives positioning", pil.derivatives]].filter(([, v]) => v != null);
    const sess = A.scenarios && A.scenarios.sessions;
    morph($i("ixaReg"), `<div class="panel-h"><h3>LIVE MARKET REGIME ENGINE</h3>${info("reg", "Live market regime engine", "A 0–100 score (50 = neutral) built from trend structure, price vs the session average, multi-timeframe alignment, the opening range, momentum, breadth, sector participation, India VIX, global indices, options PCR, futures price/OI and FII index-futures positioning. The label also uses ADX (trend strength) and volatility versus normal. 'Conditions' classifies the environment; it is not an instruction to trade.")}<span class="panel-sub mono">${hhmmss(A.asOf)}</span></div>
      <div class="ixa-reg-top ${tone}"><div class="ixa-reg-lbl"><span class="ixa-reg-ic">${icon}</span><div><b>${E(R.label.toUpperCase())}</b><small>Confidence: ${E(R.confidence)}</small></div></div>
        <div class="ixa-reg-score"><b>${R.score}</b><small>/100</small>${bar(R.score, 100, toneCol(R.score))}</div></div>
      <div class="ixa-suits ${E(R.suits.key)}">${E(R.suits.text)}</div>
      <div class="ixa-pils">${pillars.map(([l, v]) => `<div><span>${E(l)}</span>${bar(v, 100, toneCol(v))}<b>${v}</b></div>`).join("")}</div>
      ${sess ? `<div class="ixa-bias"><div class="ixa-sub mono">SETUP BIAS · NEXT 1–3 SESSIONS ${info("bias", "Setup bias", "From the multi-day forecast ensemble (volatility cone, fitted momentum, historical analogs and — when available — the options-implied range): the chance of a move larger than half a standard deviation up (long bias), down (short bias) or in between (range).")}</div>
        <div class="ixa-bias-g"><div class="up"><span>Long bias</span><b>${PCT(sess.bull.p)}</b>${bar(sess.bull.p * 100, 100, "var(--up)")}</div><div class="flat"><span>Range</span><b>${PCT(sess.base.p)}</b>${bar(sess.base.p * 100, 100, "var(--amber)")}</div><div class="down"><span>Short bias</span><b>${PCT(sess.bear.p)}</b>${bar(sess.bear.p * 100, 100, "var(--down)")}</div></div></div>` : ""}
      <div class="ixa-rows">${R.rows.map((r) => `<div><span>${E(r.label)}</span><i class="ixa-dot ${r.tone}"></i><b class="${r.tone}">${E(r.text)}</b></div>`).join("")}</div>`);
  }
  function renderLv() {
    const A = S.A; if (!A) return;
    const lv = A.levels || [], last = A.last;
    const pick = (keys) => keys.map((k) => lv.find((l) => l.key === k)).filter(Boolean);
    const res = pick(["R3", "R2", "R1"]), sup = pick(["S1", "S2", "S3"]);
    const row = (l) => `<div class="${l.price >= last ? "res" : "sup"}"><span>${E(l.key)}</span><b>${N(l.price)}</b><em>${P((l.price / last - 1) * 100)}</em><small title="Probability of touching before the close">${PCT(l.pTouch)}</small></div>`;
    const extra = lv.filter((l) => ["PDH", "PDL", "CW", "PW", "MP", "ORH", "ORL", "DH", "DL"].includes(l.key)).slice(0, 9);
    morph($i("ixaLv"), `<div class="panel-h"><h3>KEY LEVELS</h3>${info("lv", "Key levels", "Classic pivots (R1–R3 / S1–S3) from the previous session's high, low and close, plus previous-day high/low, the opening range, the day's range and the option-chain call wall, put wall and max pain. The last column is the modelled probability of the price touching the level before today's close (Brownian motion with the forecast drift and volatility).")}<span class="panel-sub mono">P(touch)</span></div>
      <div class="ixa-lvg">${res.map(row).join("")}<div class="ixa-lvp"><span>Price</span><b>${N(last)}</b><em class="${cls(A.changePct)}">${P(A.changePct)}</em><small></small></div>${sup.map(row).join("")}</div>
      <div class="ixa-lvx">${extra.map((l) => `<div><span>${E(l.label)}</span><b>${N(l.price)}</b><em class="${l.price >= last ? "down" : "up"}">${P((l.price / last - 1) * 100)}</em></div>`).join("")}</div>`);
  }

  /* ── strip under the chart: breadth · sectors · A/D · FII/DII · global ── */
  function renderStrip() {
    if (RP.on) { morph($i("ixaStrip"), `<div class="panel ixa-sc ixa-rp-strip"><div class="ixa-sch">Market breadth · sectors · A/D · FII/DII · global <small class="mono">live only</small></div><div class="ixa-na">These come from live quotes and NSE's daily files; there is no intraday history to rebuild them from, so they are hidden during replay rather than shown with today's values.</div></div>`); return; }
    const M = (S.A && S.A.market) || {}, b = M.breadth, f = M.fiiDii;
    const tot = b ? (b.advancers + b.decliners + (b.unchanged || 0)) || 1 : 1;
    const sec = (M.sectors || []).slice(0, 6), mx = Math.max(0.5, ...sec.map((s) => Math.abs(s.changePct)));
    const glob = (M.global || []).filter((g) => !/USDINR|BZ=F|ES=F/.test(g.symbol)).slice(0, 5);
    morph($i("ixaStrip"), `
      <div class="panel ixa-sc"><div class="ixa-sch">Market breadth <small class="mono">NIFTY 50</small></div>${b ? `<div class="ixa-adbar"><i class="a" style="width:${(b.advancers / tot) * 100}%"></i><i class="d" style="width:${(b.decliners / tot) * 100}%"></i></div><div class="ixa-ad2"><div><b class="up">${b.advancers}</b><span>Advances</span></div><div><b class="down">${b.decliners}</b><span>Declines</span></div></div>` : `<div class="ixa-na">breadth loading…</div>`}</div>
      <div class="panel ixa-sc"><div class="ixa-sch">Sector performance <small class="mono">today</small></div><div class="ixa-secb">${sec.map((s) => `<div><span>${E(s.label)}</span><i class="ixa-hb"><u class="${s.changePct >= 0 ? "pos" : "neg"}" style="width:${(Math.abs(s.changePct) / mx) * 100}%"></u></i><b class="${cls(s.changePct)}">${P(s.changePct)}</b></div>`).join("") || '<div class="ixa-na">—</div>'}</div></div>
      <div class="panel ixa-sc"><div class="ixa-sch">Advance / decline</div>${b ? `<div class="ixa-big ${b.adRatio >= 1 ? "up" : "down"}">${N(b.adRatio)} <small>${b.adRatio >= 1.5 ? "(Bullish)" : b.adRatio <= 0.67 ? "(Bearish)" : "(Mixed)"}</small></div><div class="ixa-kv"><span>Above 50 DMA</span><b>${b.above50 != null ? b.above50 + "%" : "—"}</b><span>Above 200 DMA</span><b>${b.above200 != null ? b.above200 + "%" : "—"}</b><span>Near 52W high / low</span><b><span class="up">${b.near52H}</span> / <span class="down">${b.near52L}</span></b></div>` : '<div class="ixa-na">—</div>'}</div>
      <div class="panel ixa-sc"><div class="ixa-sch">FII / DII (cash) <small class="mono">${E(f && f.date || "")}</small></div>${f ? `<div class="ixa-fd"><div><span>FII</span><b class="${cls(f.fiiNet)}">${CR(f.fiiNet)}</b></div><div><span>DII</span><b class="${cls(f.diiNet)}">${CR(f.diiNet)}</b></div></div>${flowBars(f.last10, 150, 30)}` : '<div class="ixa-na">NSE flows unavailable</div>'}</div>
      <div class="panel ixa-sc"><div class="ixa-sch">${E(S.A ? S.A.name : "")} vs global</div><div class="ixa-gl">${S.A ? `<div><span>${E(S.A.name)}</span><b class="${cls(S.A.changePct)}">${P(S.A.changePct)}</b></div>` : ""}${glob.map((g) => `<div><span>${E(g.label)}</span><b class="${cls(g.changePct)}">${P(g.changePct)}</b></div>`).join("")}</div></div>`);
  }
  function flowBars(rows, w = 150, h = 30) {
    const r = (rows || []).slice(-10); if (!r.length) return "";
    const mx = Math.max(1, ...r.flatMap((x) => [Math.abs(x.fii || 0), Math.abs(x.dii || 0)])), bw = w / r.length;
    return `<svg width="${w}" height="${h}" class="ixa-flow">${r.map((x, i) => { const fh = (Math.abs(x.fii || 0) / mx) * (h / 2 - 1), dh = (Math.abs(x.dii || 0) / mx) * (h / 2 - 1); return `<rect x="${i * bw + 1}" y="${x.fii >= 0 ? h / 2 - fh : h / 2}" width="${bw / 2 - 1}" height="${fh}" fill="${x.fii >= 0 ? "#2e9e6b" : "#c84b3c"}"><title>${E(x.date)} FII ${CR(x.fii)}</title></rect><rect x="${i * bw + bw / 2}" y="${x.dii >= 0 ? h / 2 - dh : h / 2}" width="${bw / 2 - 1}" height="${dh}" fill="${x.dii >= 0 ? "rgba(46,158,107,.55)" : "rgba(200,75,60,.55)"}"><title>${E(x.date)} DII ${CR(x.dii)}</title></rect>`; }).join("")}<line x1="0" x2="${w}" y1="${h / 2}" y2="${h / 2}" stroke="#232a33"/></svg>`;
  }

  /* ══ WORKSPACE TABS ═════════════════════════════════════════════════════ */
  const WTABS = [["oi", "Options flow & OI"], ["pat", "Patterns & insights"], ["scen", "Scenario engine"], ["mtf", "Multi-timeframe"], ["alerts", "Signals & alerts"], ["breadth", "Breadth & sectors"], ["global", "Global & macro"], ["vol", "Volatility & risk"], ["pos", "Positioning & FII/DII"], ["seas", "Seasonality & calendar"], ["corr", "Correlation"], ["plan", "Trade planner"]];
  function renderTabs() {
    const unread = S.alerts.filter((a) => a.ts > (S.alertsSeen || 0)).length;
    morph($i("ixaWtabs"), WTABS.map(([k, l]) => `<button type="button" data-wt="${k}" class="${k === S.tab ? "on" : ""}">${E(l)}${k === "alerts" && unread ? `<span class="ixa-badge">${unread}</span>` : ""}</button>`).join(""));
  }
  function renderWork() {
    const el = $i("ixaWbody"); if (!el || (!S.A && S.tab !== "pat")) return;
    const f = { oi: wOi, pat: wPat, scen: wScen, mtf: wMtf, alerts: wAlerts, breadth: wBreadth, global: wGlobal, vol: wVol, pos: wPos, seas: wSeas, corr: wCorr, plan: wPlan }[S.tab] || wOi;
    if (S.tab === "alerts") S.alertsSeen = Date.now();
    const LIVE_ONLY = { oi: "The option chain, OI and futures are live NSE snapshots — NSE publishes no intraday history, so this tab shows the market now, not the replayed moment.", breadth: "Breadth and sectors are live data and are not replayed.", global: "Global markets are live data and are not replayed.", pos: "FII/DII and participant positioning are daily NSE files shown as of now — not replayed.", corr: "Correlations use the last 6 months of daily data up to today — not replayed.", alerts: "Alerts are fired by the live engine; none are generated during replay." };
    const html = (RP.on && LIVE_ONLY[S.tab] ? `<div class="ixa-rpnote">REPLAY · ${E(LIVE_ONLY[S.tab])}</div>` : "") + f();
    if (el._tab !== S.tab) { el._tab = S.tab; el._h = html; el.innerHTML = html; return; }
    morph(el, html);
  }

  /* ── Options flow & OI ── */
  function wOi() {
    const A = S.A;
    if (!A.hasOi) return `<div class="ixa-empty">NSE lists index options for NIFTY, BANK NIFTY, FIN NIFTY and MIDCAP SELECT. Pick one of them in the sidebar for the option chain, OI and futures.</div>`;
    const D = S.chainExp && S.chainData ? S.chainData : S.OI;
    if (!D || !D.chain) return `<div class="ixa-empty">${E((A.oi && A.oi.error) || "Loading the option chain from NSE…")}</div>`;
    const exps = ((S.OI && S.OI.expiries) || (S.chainData && S.chainData.expiries) || []).slice(0, 8);
    const atm = D.atm, spot = D.spot, g = S.chainView === "greeks";
    const head = g ? ["Θ", "Vega", "Γ", "Δ", "IV", "LTP"] : ["OI", "Chg OI", "Volume", "IV", "LTP"];
    const ceCells = (c) => g ? [N(c.theta), N(c.vega), c.gamma != null ? c.gamma.toFixed(4) : "—", N(c.delta, 2), N(c.iv, 1), N(c.ltp)] : [K(c.oi), `<span class="${cls(c.chg)}">${K(c.chg)}</span>`, K(c.vol), N(c.iv, 1), `${N(c.ltp)}<small class="${cls(c.chgLtp)}">${c.chgLtp != null ? (c.chgLtp > 0 ? "+" : "") + N(c.chgLtp) : ""}</small>`];
    const peCells = (c) => [...ceCells(c)].reverse();
    const mxOi = Math.max(1, ...D.chain.map((s) => Math.max(s.ce.oi, s.pe.oi)));
    const rows = D.chain.map((s) => `<tr class="${s.k === atm ? "atm" : ""}">${ceCells(s.ce).map((v, i) => `<td class="${s.k < spot ? "itm" : ""}${i === 0 && !g ? " oib" : ""}" ${i === 0 && !g ? `style="--w:${(s.ce.oi / mxOi) * 100}%"` : ""}>${v}</td>`).join("")}<td class="k">${N(s.k, 0)}<small class="ixa-buc ${buClass(s.ce.buildup)}" title="CE: ${E(s.ce.buildup || "")}">${buShort(s.ce.buildup)}</small><small class="ixa-buc ${buClass(s.pe.buildup)}" title="PE: ${E(s.pe.buildup || "")}">${buShort(s.pe.buildup)}</small></td>${peCells(s.pe).map((v, i, arr) => `<td class="${s.k > spot ? "itm" : ""}${i === arr.length - 1 && !g ? " oib pe" : ""}" ${i === arr.length - 1 && !g ? `style="--w:${(s.pe.oi / mxOi) * 100}%"` : ""}>${v}</td>`).join("")}</tr>`).join("");
    const t = D.totals || {}, fut = D.futures;
    const prof = D.profile || [], pmx = Math.max(1, ...prof.map((p) => Math.max(Math.abs(S.heat === "chg" ? p.ceChg : S.heat === "vol" ? p.ceVol : p.ce), Math.abs(S.heat === "chg" ? p.peChg : S.heat === "vol" ? p.peVol : p.pe))));
    const pv = (p, side) => (S.heat === "chg" ? p[side + "Chg"] : S.heat === "vol" ? p[side + "Vol"] : p[side]);
    const heat = [...prof].reverse().filter((_, i, a) => a.length <= 26 || i % Math.ceil(a.length / 26) === 0).map((p) => `<div class="${Math.abs(p.k - spot) < (prof[1] ? prof[1].k - prof[0].k : 50) / 2 ? "spot" : ""}"><span>${N(p.k, 0)}</span><i class="ce" style="width:${(Math.abs(pv(p, "ce")) / pmx) * 50}%"></i><i class="pe" style="width:${(Math.abs(pv(p, "pe")) / pmx) * 50}%"></i></div>`).join("");
    const flow = (D.flowLog || []).slice(0, 14);
    return `<div class="ixa-oi">
      <div class="panel ixa-chain"><div class="panel-h"><h3>${E(A.name)} OPTION CHAIN</h3>${info("chain", "Option chain", "Strike-wise calls (left) and puts (right) for the selected expiry: open interest, change in OI today, volume, implied volatility and last price. The small tags under each strike read price against OI for the call and the put: LB long build-up (price ↑ OI ↑), SB short build-up (price ↓ OI ↑), SC short covering (price ↑ OI ↓), LU long unwinding (price ↓ OI ↓). Greeks are Black-Scholes at a 6.5% risk-free rate. The ATM row is outlined; shaded cells are in the money.")}
        <div class="panel-tools"><select id="ixaExp" class="ixa-sel">${exps.map((x) => `<option ${x === (S.chainExp || D.expiry) ? "selected" : ""}>${E(x)}</option>`).join("")}</select>
        <div class="ixa-seg"><button type="button" data-cv="oi" class="${!g ? "on" : ""}">OI</button><button type="button" data-cv="greeks" class="${g ? "on" : ""}">Greeks</button></div></div></div>
        <div class="ixa-chain-w"><table class="ixa-ct"><thead><tr><th colspan="${head.length}" class="cap">CALLS</th><th rowspan="2">Strike</th><th colspan="${head.length}" class="cap">PUTS</th></tr><tr>${head.map((h) => `<th>${h}</th>`).join("")}${[...head].reverse().map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>
        <div class="ixa-note">Spot ${N(spot)} · expiry ${E(D.expiry)} (${N(D.daysToExpiry, 1)} days) · NSE ${E(D.timestamp || "")}${S.OI && S.OI.error ? ` · <span class="ixa-warn">${E(S.OI.error)}</span>` : ""}</div></div>
      <div class="ixa-oi-r">
        <div class="panel"><div class="panel-h"><h3>OI INSIGHTS</h3>${info("oii", "OI insights", "Put-call ratios by open interest, by today's change in OI and by volume; total OI and its change; max pain (the expiry price that minimises payouts to option buyers); the strikes with the largest call and put OI (resistance / support as positioned) and the strikes where fresh OI was written today. ATM IV change is measured against the first reading of the day.")}</div>
          <div class="ixa-kvl">
            <span>PCR (OI)</span><b>${N(D.pcr)} <small>${E(D.sentiment || "")}</small></b>
            <span>PCR (change in OI)</span><b>${N(D.pcrChange)}</b><span>PCR (volume)</span><b>${N(D.pcrVolume)}</b>
            <span>Total call OI</span><b>${K(t.ceOi)} <small class="${cls(t.ceChg)}">${t.ceChg > 0 ? "+" : ""}${K(t.ceChg)}</small></b>
            <span>Total put OI</span><b>${K(t.peOi)} <small class="${cls(t.peChg)}">${t.peChg > 0 ? "+" : ""}${K(t.peChg)}</small></b>
            <span>Max pain</span><b>${N(D.maxPain, 0)}</b>
            <span>Highest call OI (resistance)</span><b class="down">${D.callWall ? N(D.callWall.strike, 0) + " · " + K(D.callWall.oi) : "—"}</b>
            <span>Highest put OI (support)</span><b class="up">${D.putWall ? N(D.putWall.strike, 0) + " · " + K(D.putWall.oi) : "—"}</b>
            <span>Call writing zone</span><b>${D.callWritingZone ? D.callWritingZone.map((x) => N(x, 0)).join(" – ") : "—"}</b>
            <span>Put writing zone</span><b>${D.putWritingZone ? D.putWritingZone.map((x) => N(x, 0)).join(" – ") : "—"}</b>
            <span>ATM IV</span><b>${N(D.atmIv, 1)}%${D.atmIvChange != null ? ` <small class="${cls(-D.atmIvChange)}">${D.atmIvChange > 0 ? "+" : ""}${N(D.atmIvChange, 1)} today</small>` : ""}</b>
            <span>ATM straddle → implied move</span><b>${N(D.straddle)} → ±${N(D.impliedMovePct)}% to expiry</b>
          </div>
          ${D.buildupCounts ? `<div class="ixa-buc-g"><div><span>Calls</span>${buRow(D.buildupCounts.ce)}</div><div><span>Puts</span>${buRow(D.buildupCounts.pe)}</div></div>` : ""}</div>
        ${fut ? `<div class="panel"><div class="panel-h"><h3>INDEX FUTURES</h3>${info("fut", "Index futures", "Nearest futures contract from NSE: price, change, basis (futures minus spot) and open interest. NSE's feed carries no change-in-OI, so OI change is measured from the first reading of the day; the price-and-OI reading (long build-up, short covering…) uses that change.")}</div>
          <div class="ixa-kvl"><span>${E(fut.contract)}</span><b>${N(fut.price)} <small class="${cls(fut.change)}">${fut.change > 0 ? "+" : ""}${N(fut.change)} (${P(fut.changePct)})</small></b><span>Basis (premium)</span><b>${N(fut.basis)} <small>${P(fut.basisPct)}</small></b><span>Open interest</span><b>${K(fut.oi)}${fut.oiChgSinceFirst != null ? ` <small class="${cls(fut.oiChgSinceFirst)}">${fut.oiChgSinceFirst > 0 ? "+" : ""}${K(fut.oiChgSinceFirst)} since first read</small>` : ""}</b><span>Price & OI reading</span><b>${E(fut.buildup || "awaiting OI change")}</b><span>Volume</span><b>${K(fut.volume)}</b>${fut.next ? `<span>${E(fut.next.contract)}</span><b>${N(fut.next.price)} · OI ${K(fut.next.oi)}</b>` : ""}</div></div>` : ""}
      </div>
      <div class="panel ixa-heat"><div class="panel-h"><h3>OI HEATMAP</h3>${info("heat", "OI heatmap", "Strike-wise call (red) and put (green) open interest around the spot, or today's change in OI, or volume. Heavy call OI above the price is where writers expect resistance; heavy put OI below is expected support. The highlighted row is the spot.")}<div class="panel-tools"><div class="ixa-seg">${[["oi", "OI"], ["chg", "OI change"], ["vol", "Volume"]].map(([k, l]) => `<button type="button" data-heat="${k}" class="${S.heat === k ? "on" : ""}">${l}</button>`).join("")}</div></div></div>
        <div class="ixa-hm"><div class="ixa-hm-l"><span class="ce">Call</span><span class="pe">Put</span></div>${heat}</div></div>
      <div class="panel ixa-flowp"><div class="panel-h"><h3>OI FLOW · LAST 30 MIN</h3>${info("flow", "OI flow", "Trade-by-trade options flow is not public. This log lists the largest changes in open interest between consecutive one-minute option-chain snapshots, with the price-and-OI reading for each — a close, honest proxy for where positions are being added or closed.")}</div>
        <table class="ixa-t"><thead><tr><th>Time</th><th>Strike</th><th>Type</th><th>LTP</th><th>Δ OI</th><th>Reading</th></tr></thead><tbody>${flow.map((x) => `<tr><td class="mono">${hhmm(x.ts)}</td><td>${N(x.strike, 0)}</td><td class="${x.type === "CE" ? "down" : "up"}">${x.type}</td><td>${N(x.ltp)}</td><td class="${cls(x.dOi)}">${x.dOi > 0 ? "+" : ""}${K(x.dOi)}</td><td>${E(x.buildup || "—")}</td></tr>`).join("") || `<tr><td colspan="6" class="ixa-na">Builds up from the second snapshot (one a minute while the market is open).</td></tr>`}</tbody></table></div>
    </div>`;
  }
  const buShort = (b) => ({ "Long build-up": "LB", "Short build-up": "SB", "Short covering": "SC", "Long unwinding": "LU" }[b] || "");
  const buClass = (b) => ({ "Long build-up": "lb", "Short build-up": "sb", "Short covering": "sc", "Long unwinding": "lu" }[b] || "");
  const buRow = (c) => `<i class="lb" title="Long build-up">LB ${c.lb}</i><i class="sb" title="Short build-up">SB ${c.sb}</i><i class="sc" title="Short covering">SC ${c.sc}</i><i class="lu" title="Long unwinding">LU ${c.lu}</i>`;

  /* ── Scenario engine ── */
  function wScen() {
    const A = S.A, sc = A.scenarios || {}, hz = S.scHz;
    const cur = sc[hz] || sc.intraday || sc.week;
    const hzBtns = [["intraday", "To the close"], ["sessions", "1–3 sessions"], ["week", "1 week"], ["month", "1 month"]].map(([k, l]) => `<button type="button" data-schz="${k}" class="${hz === k ? "on" : ""}" ${sc[k] ? "" : "disabled"}>${l}</button>`).join("");
    if (!cur) return `<div class="ixa-seg ixa-hz">${hzBtns}</div><div class="ixa-empty">Scenarios appear once enough history has loaded.</div>`;
    const card = (k, title, col, s) => `<div class="ixa-scc ${k}"><div class="ixa-scc-h"><b>${title}</b><span class="ixa-prob">${PCT(s.p)}</span></div>${bar(s.p * 100, 100, col)}
      <p>${E(s.text)}</p>
      ${s.trigger ? `<div class="ixa-kvl sm"><span>Trigger</span><b>${E(s.trigger.label)} ${N(s.trigger.price)}</b>${(s.targets || []).map((t, i) => `<span>Target ${i + 1}</span><b>${E(t.label)} ${N(t.price)}</b>`).join("")}<span>Invalidation</span><b>${s.invalidation ? E(s.invalidation.label) + " " + N(s.invalidation.price) : "—"}</b><span>Horizon</span><b>${E(cur.horizon)}</b></div>` : s.range ? `<div class="ixa-kvl sm"><span>Expected range</span><b>${N(s.range[0])} – ${N(s.range[1])}</b><span>Horizon</span><b>${E(cur.horizon)}</b></div>` : ""}</div>`;
    const intra = hz === "intraday" && A.forecast;
    const models = intra ? A.forecast.models : A.forecastDaily && A.forecastDaily.models;
    const hSel = intra ? A.forecast.ensemble.steps[A.forecast.ensemble.steps.length - 1].h : hz === "sessions" ? 3 : hz === "week" ? 5 : 21;
    const mRows = models ? Object.entries(models).map(([k, m]) => { const s = m.steps.find((x) => x.h === hSel) || m.steps[m.steps.length - 1]; return s ? `<tr><td><i class="ixa-sw" style="background:${(window.IX_MODEL_COLORS || {})[k] || "#8a93a0"}"></i>${E(m.label)}</td><td>${m.weight != null ? PCT(m.weight) : "equal"}</td><td class="${s.pUp >= 0.5 ? "up" : "down"}">${PCT(s.pUp)}</td><td>${N(s.q[2])}</td><td>${N(s.q[0])} – ${N(s.q[4])}</td></tr>` : ""; }).join("") : "";
    const ens = intra ? A.forecast.ensemble.steps : A.forecastDaily ? A.forecastDaily.ensemble.steps.filter((s) => [1, 2, 3, 5, 10, 21].includes(s.h)) : [];
    const rel = A.reliability && A.reliability.stats;
    return `<div class="ixa-scen">
      <div class="ixa-scen-top"><div class="ixa-seg ixa-hz">${hzBtns}</div><span class="ixa-note">Scenario = move beyond ±½σ of the horizon (θ = ${N(cur.threshold)} pts). Expected range (80%): ${N(cur.expectedRange.p10)} – ${N(cur.expectedRange.p90)}.</span></div>
      <div class="ixa-scgrid">${card("bull", "Bullish scenario", "var(--up)", cur.bull)}${card("base", "Base case", "var(--blue,#5b8dd6)", cur.base)}${card("bear", "Bearish scenario", "var(--down)", cur.bear)}</div>
      <div class="ixa-scgrid2">
        <div class="panel"><div class="panel-h"><h3>MODELS BEHIND THE FORECAST</h3>${info("models", "Forecast models", intra ? "Five intraday models: a volatility cone (no drift), momentum with a continuation coefficient fitted on past sessions, Ornstein-Uhlenbeck reversion to the session average, the 40 most similar past moments (historical analogs) and the time-of-day pattern. The ensemble averages their quantiles, weighted by walk-forward accuracy (pinball loss)." : "Multi-day models: a volatility cone (EWMA daily σ), momentum fitted on past returns, the 30 most similar 10-day shapes in history and, when available, the options-implied range from ATM IV. The ensemble averages their quantiles.")}</div>
          <table class="ixa-t"><thead><tr><th>Model</th><th>Weight</th><th>P(up)</th><th>Median</th><th>80% range</th></tr></thead><tbody>${mRows}</tbody></table></div>
        <div class="panel"><div class="panel-h"><h3>PROBABILITY BY HORIZON</h3></div>
          <table class="ixa-t"><thead><tr><th>Horizon</th><th>P(up)</th><th>Median</th><th>50% range</th><th>80% range</th></tr></thead><tbody>${ens.map((s) => `<tr><td>${intra ? (s.h >= 60 ? s.h / 60 + "h" : s.h + "m") : s.h + "d"}</td><td class="${s.pUp >= 0.5 ? "up" : "down"}">${PCT(s.pUp)}</td><td>${N(s.q[2])}</td><td>${N(s.q[1])} – ${N(s.q[3])}</td><td>${N(s.q[0])} – ${N(s.q[4])}</td></tr>`).join("")}</tbody></table></div>
        <div class="panel"><div class="panel-h"><h3>CALIBRATION</h3>${info("cal", "Calibration", "Walk-forward test over recent sessions: at every half hour each model forecast the next 30 minutes using only earlier data. A well-calibrated 80% range should contain the outcome about 80% of the time and a 50% range about 50%. Hit rate = how often the leaned direction was right when a model leaned at least 5 points away from 50%. The live bands are widened automatically when the 80% range held less often than it should.")}<span class="panel-sub mono">${rel ? `${A.reliability.sessions} sessions · 30-min horizon` : "computing…"}</span></div>
          ${rel ? `<table class="ixa-t"><thead><tr><th>Model</th><th>80% held</th><th>50% held</th><th>Hit rate</th><th>Leaned</th></tr></thead><tbody>${Object.entries(rel).map(([k, v]) => `<tr class="${k === "ensemble" ? "ens" : ""}"><td>${k === "ensemble" ? "Ensemble" : E((models && models[k] && models[k].label) || k)}</td><td>${PCT(v.coverage80)}</td><td>${PCT(v.coverage50)}</td><td>${v.hitRate != null ? PCT(v.hitRate) : "—"}</td><td>${v.leaned}</td></tr>`).join("")}</tbody></table>` : `<div class="ixa-na">The reliability backtest runs once a day in the background.</div>`}</div>
        <div class="panel"><div class="panel-h"><h3>WHAT CHANGED</h3></div><div class="ixa-chg">${(A.changes || []).map((c) => `<div><time class="mono">${hhmm(c.ts)}</time>${E(c.text)}</div>`).join("") || `<div class="ixa-na">Regime, setup and scenario shifts are logged here as they happen.</div>`}</div></div>
      </div></div>`;
  }

  /* ── Multi-timeframe ── */
  function wMtf() {
    const m = S.A.mtf; if (!m) return `<div class="ixa-empty">Loading…</div>`;
    return `<div class="ixa-mtf-sum"><b>${m.bull}</b> bullish · <b>${m.bear}</b> bearish of ${m.total} timeframes · alignment ${m.alignment > 0 ? "+" : ""}${N(m.alignment * 100, 0)} ${info("mtfi", "Multi-timeframe", "Each timeframe scores −2…+2 from four readings: price vs EMA 20, EMA 20 vs EMA 50, the MACD histogram and RSI (above 55 / below 45). The score is shown as 0–100 (50 neutral). The same breakout behaves very differently when the higher timeframes agree.")}</div>
      <div class="ixa-mtf">${m.rows.map((r) => { const sc = Math.round(50 + r.score * 25), t = r.score >= 1 ? "up" : r.score <= -1 ? "down" : "flat"; return `<div class="panel ixa-mt ${t}"><div class="ixa-mt-h"><span>${E(r.label)}</span><b>${sc}<small>/100</small></b></div><div class="ixa-mt-s">${t === "up" ? "▲" : t === "down" ? "▼" : "■"} ${E(r.signal)}</div>${bar(sc, 100, toneCol(sc))}<ul><li>${r.last != null && r.ema20 != null ? (r.last >= r.ema20 ? "Above" : "Below") + " EMA 20 (" + N(r.ema20) + ")" : "—"}</li><li>RSI ${N(r.rsi, 1)}${r.rsi > 60 ? " (strong)" : r.rsi < 40 ? " (weak)" : ""}</li><li>MACD histogram ${r.macdHist != null ? (r.macdHist >= 0 ? "positive" : "negative") : "—"}</li><li>EMA 20 slope ${P(r.slopePct)}</li></ul></div>`; }).join("")}</div>`;
  }

  /* ── Signals & alerts ── */
  const RULES = [["vwap", "Session-average (VWAP) crosses", "Index crosses its session average, held for two 1-minute closes, with breadth as the confirmation (index prices carry no volume)."], ["orb", "Opening-range breaks", "First break of the 15-minute opening range, flagged high-conviction only when breadth is improving."], ["levels", "Key level breaks", "R1/R2/S1/S2, previous-day high/low, day high/low and the option walls. Support breaks are high-conviction only when momentum is bearish and derivatives align."], ["near", "Approaching breakout levels", "Within 0.75 ATR of the next level with the setup bias behind it."], ["vol", "Volatility expansion / VIX jumps", "1-minute volatility above 1.8× its level 30 minutes earlier, or India VIX up 3 points of % since the last reading."], ["oi", "Sudden OI changes", "One strike's OI moving more than 1% of total call or put OI between one-minute snapshots."]];
  const ruleOf = (r) => (/^twap/.test(r) ? "vwap" : /^orb/.test(r) ? "orb" : /^brk/.test(r) ? "levels" : /^near/.test(r) ? "near" : /^(volx|vix)/.test(r) ? "vol" : /^oi/.test(r) ? "oi" : /^wl/.test(r) ? "watch" : "other");
  function wAlerts() {
    const list = S.alerts.filter((a) => a.rule === undefined || ruleOf(a.rule) === "watch" || S.rules[ruleOf(a.rule)] !== false);
    const wl = [...S.wl.values()];
    return `<div class="ixa-al">
      <div class="panel"><div class="panel-h"><h3>ALERT RULES</h3>${info("rules", "Smart alerts", "Alerts fire only when every condition of the rule is met, at most once every 10 minutes per rule, and say which conditions held. They arrive while this page is open (any tab of the terminal); switch on browser notifications to see them when the window is in the background. Rules here only filter what you see — the conditions are evaluated on the server for everyone.")}</div>
        <div class="ixa-rules">${RULES.map(([k, l, d]) => `<label><input type="checkbox" data-rule="${k}" ${S.rules[k] !== false ? "checked" : ""}><span><b>${E(l)}</b><small>${E(d)}</small></span></label>`).join("")}</div>
        <label class="ixa-notif"><input type="checkbox" id="ixaNotify" ${S.notify ? "checked" : ""}> Browser notifications ${typeof Notification !== "undefined" && Notification.permission === "denied" ? "<small class='ixa-warn'>(blocked in browser settings)</small>" : ""}</label></div>
      <div class="panel ixa-alog"><div class="panel-h"><h3>ALERT LOG</h3><span class="panel-sub mono">${list.length}</span></div>
        <div class="ixa-alist">${list.map((a) => `<div class="ixa-ali ${E(a.severity)}"><time class="mono">${hhmm(a.ts)}</time><span class="ixa-alix">${E(a.name || a.index)}</span><div><b>${E(a.title)}</b><small>${E(a.text)}</small></div></div>`).join("") || `<div class="ixa-na">No alerts yet today. They appear here the moment a rule's conditions are met.</div>`}</div></div>
      <div class="panel"><div class="panel-h"><h3>SETUP WATCHLIST (STOCKS)</h3>${info("wl", "Setup watchlist", "Add NSE symbols. While this page is open their live rows come from the Live Scanner stream, and you are alerted when one comes within 0.3% of its 20-day high, breaks its opening range, crosses VWAP with relative volume ≥ 1.5×, or trades at 3× its normal volume for the time of day.")}</div>
        <div class="ixa-wl-in" data-keep="wlin"><input id="ixaWlIn" placeholder="Add symbols, e.g. RELIANCE, HDFCBANK" spellcheck="false" autocomplete="off"><button class="ixa-btn" type="button" id="ixaWlAdd">Add</button></div>
        <table class="ixa-t"><thead><tr><th>Symbol</th><th>LTP</th><th>% Chg</th><th>RVOL</th><th>vs VWAP</th><th>To 20D high</th><th></th></tr></thead><tbody>${S.watch.map((s) => { const r = S.wl.get(s) || {}; return `<tr><td><b>${E(s)}</b></td><td>${N(r.ltp)}</td><td class="${cls(r.pct)}">${P(r.pct)}</td><td>${r.rvol != null ? N(r.rvol) + "×" : "—"}</td><td class="${cls(r.vwapD)}">${P(r.vwapD)}</td><td>${P(r.distN)}</td><td><button class="ixa-x" type="button" data-wlrm="${E(s)}" title="Remove">×</button></td></tr>`; }).join("") || `<tr><td colspan="7" class="ixa-na">No symbols yet.</td></tr>`}</tbody></table>
        ${S.watch.length && !wl.length ? `<div class="ixa-note">Connecting to the Live Scanner stream…</div>` : ""}</div>
    </div>`;
  }

  /* ── Breadth & sectors ── */
  function wBreadth() {
    const M = S.A.market || {}, b = M.breadth, sec = M.sectors || [];
    const mx = Math.max(0.5, ...sec.map((s) => Math.abs(s.changePct)));
    return `<div class="ixa-br">
      <div class="panel"><div class="panel-h"><h3>BREADTH INDICATORS</h3>${info("bri", "Breadth", "Across the NIFTY 50 constituents (live quotes): advancers vs decliners, the A/D ratio, stocks within 5% of their 52-week high or low, and the share trading above their 50- and 200-day averages. Broad participation makes index moves more durable.")}</div>
        ${b ? `<div class="ixa-kvl"><span>Advances / declines</span><b><span class="up">${b.advancers}</span> / <span class="down">${b.decliners}</span> · ${b.unchanged} flat</b><span>A/D ratio</span><b>${N(b.adRatio)}</b><span>Average change</span><b class="${cls(b.avgChange)}">${P(b.avgChange)}</b><span>Near 52-week high</span><b class="up">${b.near52H}</b><span>Near 52-week low</span><b class="down">${b.near52L}</b><span>Above 50-day average</span><b>${b.above50 != null ? b.above50 + "%" : "—"}</b><span>Above 200-day average</span><b>${b.above200 != null ? b.above200 + "%" : "—"}</b></div>
        <div class="ixa-movers"><div><div class="ixa-sub mono">TOP GAINERS</div>${(b.gainers || []).map((m) => `<div><span>${E(m.name || m.symbol)}</span><b class="up">${P(m.changePct)}</b></div>`).join("")}</div><div><div class="ixa-sub mono">TOP LOSERS</div>${(b.losers || []).map((m) => `<div><span>${E(m.name || m.symbol)}</span><b class="down">${P(m.changePct)}</b></div>`).join("")}</div></div>` : `<div class="ixa-na">Breadth loading…</div>`}</div>
      <div class="panel"><div class="panel-h"><h3>SECTOR STRENGTH</h3></div><div class="ixa-secb lg">${sec.map((s) => `<div><span>${E(s.label)}</span><i class="ixa-hb"><u class="${s.changePct >= 0 ? "pos" : "neg"}" style="width:${(Math.abs(s.changePct) / mx) * 100}%"></u></i><b class="${cls(s.changePct)}">${P(s.changePct)}</b><small>${s.w1 != null ? "1W " + P(s.w1, 1) : ""}</small></div>`).join("")}</div></div>
      <div class="panel"><div class="panel-h"><h3>SECTOR HEATMAP</h3></div><div class="ixa-hmap">${sec.map((s) => { const a = Math.min(1, Math.abs(s.changePct) / 2.5); return `<div style="background:${s.changePct >= 0 ? `rgba(46,158,107,${0.15 + a * 0.6})` : `rgba(200,75,60,${0.15 + a * 0.6})`}"><span>${E(s.label.toUpperCase())}</span><b>${P(s.changePct)}</b></div>`; }).join("")}</div></div>
    </div>`;
  }
  /* ── Global & macro ── */
  function wGlobal() {
    const M = S.A.market || {}, g = M.global || [];
    return `<div class="ixa-gm"><div class="panel"><div class="panel-h"><h3>GLOBAL MARKETS</h3>${info("glo", "Global context", "Major overseas indices, S&P 500 futures, USD/INR and Brent, streamed. 'Global tone' is the average change of the equity indices — one input to the regime score.")}<span class="panel-sub mono">global tone ${P(M.globalTone)}</span></div>
      <table class="ixa-t"><thead><tr><th>Market</th><th>Last</th><th>Change</th></tr></thead><tbody>${g.map((x) => `<tr><td>${E(x.label)}</td><td>${N(x.price)}</td><td class="${/USDINR/.test(x.symbol) ? cls(-x.changePct) : cls(x.changePct)}">${P(x.changePct)}</td></tr>`).join("")}</tbody></table></div>
      <div class="panel"><div class="panel-h"><h3>INDIA VIX</h3></div><div class="ixa-big ${cls(-(S.A.vix && S.A.vix.changePct))}">${N(S.A.vix && S.A.vix.price)} <small>${P(S.A.vix && S.A.vix.changePct)}</small></div>${spark(((M.ticker || {}).INDIAVIX || {}).spark, 260, 60, "var(--violet,#9b7ede)")}<div class="ixa-note">Lower VIX = cheaper options and calmer ranges; a rising VIX into a falling market signals stress.</div></div></div>`;
  }
  /* ── Volatility & risk ── */
  function wVol() {
    const v = S.A.volatility || {}, A = S.A;
    return `<div class="ixa-vol">
      <div class="panel"><div class="panel-h"><h3>VOLATILITY</h3>${info("vol", "Volatility & risk", "Realised volatility is the annualised standard deviation of daily close-to-close returns over 5, 10, 20 and 60 sessions. The 1-day expected move comes from the forecast ensemble (1 σ); the implied move from the option chain's ATM IV ÷ √252. When implied runs well above realised, options are pricing in more movement than the index has been delivering.")}</div>
        <div class="ixa-vtiles"><div><span>India VIX</span><b>${N(A.vix && A.vix.price)}</b><small class="${cls(-(A.vix && A.vix.changePct))}">${P(A.vix && A.vix.changePct)}</small></div><div><span>ATM IV</span><b>${v.atmIv != null ? N(v.atmIv, 1) + "%" : "—"}</b><small>${v.atmIvChange != null ? (v.atmIvChange > 0 ? "+" : "") + N(v.atmIvChange, 1) + " today" : ""}</small></div><div><span>Realised vol (20D)</span><b>${v.rv20 != null ? N(v.rv20, 1) + "%" : "—"}</b></div><div><span>Expected move (1D)</span><b>±${N(v.expectedMove1dPct)}%</b><small>implied ±${N(v.impliedMove1dPct)}%</small></div></div>
        <table class="ixa-t"><thead><tr><th>Window</th><th>Realised vol (annualised)</th></tr></thead><tbody>${[["5 sessions", v.rv5], ["10 sessions", v.rv10], ["20 sessions", v.rv20], ["60 sessions", v.rv60]].map(([l, x]) => `<tr><td>${l}</td><td>${x != null ? N(x, 1) + "%" : "—"}</td></tr>`).join("")}</tbody></table></div>
      <div class="panel"><div class="panel-h"><h3>INTRADAY RISK</h3></div><div class="ixa-kvl"><span>5-min ATR</span><b>${N(A.tech && A.tech.atr)} pts (${N(v.atrPct5m, 3)}%)</b><span>Average daily range (10D)</span><b>${N(A.adr)} pts</b><span>Today's range so far</span><b>${A.today ? N(A.today.h - A.today.l) + " pts" : "—"}</b><span>Range used vs ADR</span><b>${A.today && A.adr ? PCT((A.today.h - A.today.l) / A.adr) : "—"}</b><span>Bollinger width (5m)</span><b>${N(A.tech && A.tech.bbWidthPct, 3)}%${A.tech && A.tech.squeezePct != null ? ` · ${PCT(A.tech.squeezePct)} percentile` : ""}</b><span>1-min volatility (live)</span><b>${A.forecast ? N(A.forecast.sigma1 * 100, 3) + "%" : "—"}</b></div>
        <div class="ixa-note">When today's range has already used most of the average daily range, fresh breakouts have less room left.</div></div></div>`;
  }
  /* ── Positioning & FII/DII ── */
  function wPos() {
    const M = S.A.market || {}, f = M.fiiDii, pos = M.positioning;
    const who = ["FII", "DII", "Pro", "Client"];
    return `<div class="ixa-pos">
      <div class="panel"><div class="panel-h"><h3>FII / DII CASH FLOWS</h3>${info("fii", "FII / DII", "NSE's provisional daily cash-market flows (₹ crore). Net buying by foreign investors (FII/FPI) has historically coincided with stronger index trends; DIIs often take the other side.")}<span class="panel-sub mono">${E(f && f.date || "")}</span></div>
        ${f ? `<div class="ixa-fd lg"><div><span>FII net</span><b class="${cls(f.fiiNet)}">${CR(f.fiiNet)}</b></div><div><span>DII net</span><b class="${cls(f.diiNet)}">${CR(f.diiNet)}</b></div></div>${flowBars(f.last10, 420, 90)}<div class="ixa-note">Last 10 sessions — darker bar FII, lighter bar DII.</div>` : `<div class="ixa-na">NSE flows unavailable right now.</div>`}</div>
      <div class="panel"><div class="panel-h"><h3>PARTICIPANT POSITIONING · INDEX DERIVATIVES</h3>${info("part", "Participant OI", "NSE's daily participant-wise open interest: how FIIs, DIIs, proprietary traders (Pro) and clients (retail and others) hold index futures — long share of their futures positions and the change from the previous session — and their net index-options stance (long calls + short puts minus long puts + short calls, in contracts). Published after the close, so it describes yesterday's positioning.")}<span class="panel-sub mono">${E(pos && pos.asOf || "")}</span></div>
        ${pos ? `<table class="ixa-t"><thead><tr><th>Participant</th><th>Futures long %</th><th>Δ d/d</th><th>Net futures</th><th>Δ net</th><th>Options stance</th></tr></thead><tbody>${who.map((w) => { const r = pos.rows[w]; return r ? `<tr><td><b>${w}</b></td><td>${bar(r.futLongPct, 100, r.futLongPct >= 50 ? "var(--up)" : "var(--down)")} ${N(r.futLongPct, 1)}%</td><td class="${cls(r.futLongPctChg)}">${r.futLongPctChg != null ? (r.futLongPctChg > 0 ? "+" : "") + N(r.futLongPctChg, 1) + " pp" : "—"}</td><td class="${cls(r.futNet)}">${K(r.futNet)}</td><td class="${cls(r.futNetChg)}">${r.futNetChg != null ? (r.futNetChg > 0 ? "+" : "") + K(r.futNetChg) : "—"}</td><td class="${cls(r.optStance)}">${r.optStance > 0 ? "Bullish" : r.optStance < 0 ? "Bearish" : "Flat"} (${K(r.optStance)})</td></tr>` : ""; }).join("")}</tbody></table>` : `<div class="ixa-na">NSE participant data unavailable right now.</div>`}</div></div>`;
  }
  /* ── Seasonality & calendar ── */
  function wSeas() {
    const s = S.seas[S.key], c = S.cal;
    if (!s) { loadSeas(); }
    const path = s && s.path ? s.path : [];
    const W = 560, H = 160, mn = Math.min(0, ...path.map((p) => p.mean)), mx = Math.max(0, ...path.map((p) => p.mean)), sp = mx - mn || 0.1;
    const X = (m) => ((m - 555) / 375) * (W - 40) + 30, Y = (v) => 10 + (1 - (v - mn) / sp) * (H - 30);
    const nowM = (() => { const d = new Date(Date.now() + 5.5 * 3600e3); return d.getUTCHours() * 60 + d.getUTCMinutes(); })();
    const svg = path.length ? `<svg viewBox="0 0 ${W} ${H}" class="ixa-seas"><line x1="30" x2="${W - 10}" y1="${Y(0)}" y2="${Y(0)}" stroke="#232a33"/><path d="${path.map((p, i) => `${i ? "L" : "M"}${X(p.minute).toFixed(1)} ${Y(p.mean).toFixed(1)}`).join("")}" fill="none" stroke="#e8a33d" stroke-width="1.6"/>${nowM >= 555 && nowM <= 930 ? `<line x1="${X(nowM)}" x2="${X(nowM)}" y1="8" y2="${H - 18}" stroke="#5b8dd6" stroke-dasharray="3 3"/><text x="${X(nowM) + 4}" y="16" fill="#5b8dd6" font-size="10">now</text>` : ""}${["09:15", "11:00", "13:00", "15:30"].map((t) => { const [h, m] = t.split(":").map(Number); return `<text x="${X(h * 60 + m)}" y="${H - 4}" fill="#8a93a0" font-size="10" text-anchor="middle">${t}</text>`; }).join("")}<text x="2" y="${Y(mx) + 4}" fill="#8a93a0" font-size="10">${mx.toFixed(2)}%</text><text x="2" y="${Y(mn)}" fill="#8a93a0" font-size="10">${mn.toFixed(2)}%</text></svg>` : `<div class="ixa-na">Loading…</div>`;
    return `<div class="ixa-sea">
      <div class="panel"><div class="panel-h"><h3>AVERAGE SESSION PATH</h3>${info("sp", "Average session path", "The average move from the open through the day, by 5-minute slot, over the last sessions of 5-minute data. It shows typical time-of-day tendencies (morning drift, lunchtime lull, closing push) — an average, not a forecast for today.")}<span class="panel-sub mono">${s ? s.sessions + " sessions" : ""}</span></div>${svg}</div>
      <div class="panel"><div class="panel-h"><h3>DAY OF WEEK</h3></div><table class="ixa-t"><thead><tr><th>Day</th><th>Avg return</th><th>% positive</th><th>Sessions</th></tr></thead><tbody>${s ? s.dayOfWeek.map((d) => `<tr><td>${d.day}</td><td class="${cls(d.avg)}">${P(d.avg, 3)}</td><td>${PCT(d.up)}</td><td>${d.n}</td></tr>`).join("") : ""}</tbody></table></div>
      <div class="panel"><div class="panel-h"><h3>DERIVATIVES EXPIRIES & HOLIDAYS</h3>${info("calx", "Calendar", "Upcoming NIFTY, BANK NIFTY and FIN NIFTY option expiries from NSE's contract list, and NSE trading holidays. Expiry days tend to bring pinning around max pain and sharp moves late in the session.")}</div>
        ${c ? `<div class="ixa-cal">${Object.entries(c.expiries).map(([k, l]) => `<div><span class="ixa-sub mono">${k}</span>${l.slice(0, 4).map((x) => `<b>${E(x)}</b>`).join("")}</div>`).join("")}<div><span class="ixa-sub mono">HOLIDAYS</span>${c.holidays.length ? c.holidays.slice(0, 6).map((h) => `<b>${E(h.date)} · ${E(h.name)}</b>`).join("") : "<b>—</b>"}</div></div>` : `<div class="ixa-na">Loading…</div>`}</div></div>`;
  }
  async function loadSeas() {
    const key = S.key; S.seasBusy = S.seasBusy || new Set(); if (S.seasBusy.has(key)) return; S.seasBusy.add(key);
    try { const [s, c] = await Promise.all([api(`/api/ix/seasonality?symbol=${encodeURIComponent(key)}`), S.cal ? S.cal : api("/api/ix/calendar")]); S.seas[key] = s; S.cal = c; if (S.tab === "seas") renderWork(); } catch { } finally { S.seasBusy.delete(key); }
  }
  /* ── Correlation ── */
  const CORR = { indices: ["^NSEI", "^NSEBANK", "^CNXIT", "^CNXPHARMA", "^CNXAUTO", "^CNXMETAL", "^BSESN", "^INDIAVIX"], global: ["^NSEI", "^GSPC", "^IXIC", "^HSI", "^N225", "^FTSE"], macro: ["^NSEI", "USDINR=X", "BZ=F", "GC=F", "^TNX", "^INDIAVIX"] };
  const CORR_LBL = { "^NSEI": "NIFTY", "^NSEBANK": "BANK", "^CNXIT": "IT", "^CNXPHARMA": "PHARMA", "^CNXAUTO": "AUTO", "^CNXMETAL": "METAL", "^BSESN": "SENSEX", "^INDIAVIX": "VIX", "^GSPC": "S&P 500", "^IXIC": "NASDAQ", "^HSI": "HANG SENG", "^N225": "NIKKEI", "^FTSE": "FTSE", "USDINR=X": "USD/INR", "BZ=F": "BRENT", "GC=F": "GOLD", "^TNX": "US 10Y" };
  function wCorr() {
    const d = S.corr[S.corrSet];
    if (!d) loadCorr();
    const syms = d && (d.symbols || d.keys || Object.keys(d.stats || {})), M = d && (d.matrix || d.corr);
    return `<div class="panel"><div class="panel-h"><h3>CORRELATION MATRIX · 6 MONTHS OF DAILY RETURNS</h3>${info("corr", "Correlation", "Pearson correlation of daily returns over six months. Near +1: move together; near −1: move opposite. Useful for hedging and for spotting when a usual relationship breaks.")}<div class="panel-tools"><div class="ixa-seg">${[["indices", "Indices & sectors"], ["global", "Global"], ["macro", "Macro"]].map(([k, l]) => `<button type="button" data-corr="${k}" class="${S.corrSet === k ? "on" : ""}">${l}</button>`).join("")}</div></div></div>
      ${syms && M ? `<div class="ixa-corr-w"><table class="ixa-corr"><thead><tr><th></th>${syms.map((s) => `<th>${E(CORR_LBL[s] || s)}</th>`).join("")}</tr></thead><tbody>${syms.map((r, i) => `<tr><th>${E(CORR_LBL[r] || r)}</th>${syms.map((c, j) => { const v = M[i] && M[i][j]; const a = v == null ? 0 : Math.abs(v); return `<td style="background:${v == null ? "transparent" : v >= 0 ? `rgba(46,158,107,${a * 0.75})` : `rgba(200,75,60,${a * 0.75})`}">${v == null ? "—" : v.toFixed(2)}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div>` : `<div class="ixa-na">Loading…</div>`}</div>`;
  }
  async function loadCorr() {
    const set = S.corrSet; if (S.corr[set] === null) return; S.corr[set] = null;
    try { const d = await api(`/api/intel/matrix?symbols=${encodeURIComponent(CORR[set].join(","))}&range=6mo`); S.corr[set] = d; if (S.tab === "corr") renderWork(); } catch { delete S.corr[set]; }
  }
  /* ── Trade planner ── */
  function wPlan() {
    const A = S.A, pl = S.plan || (S.plan = planDefaults());
    const r = planCalc(pl);
    return `<div class="ixa-plan">
      <div class="panel" data-keep="plan-${E(A.key)}"><div class="panel-h"><h3>TRADE PLANNER & POSITION SIZING</h3>${info("plan", "Trade planner", "Sizes a position from the loss you accept, not the gain you hope for: quantity = (capital × risk %) ÷ (entry − stop) × lot size. Entry, stop and target can be filled from the current scenario (trigger, invalidation, first target). Check the exchange's current lot size before trading. A planning tool, not a recommendation.")}</div>
        <div class="ixa-pf">
          <label>Instrument<input id="plInst" value="${E(A.name)}" disabled></label>
          <label>Direction<select id="plDir"><option value="long" ${pl.dir === "long" ? "selected" : ""}>Long</option><option value="short" ${pl.dir === "short" ? "selected" : ""}>Short</option></select></label>
          <label>Mode<select id="plMode"><option value="fut" ${pl.mode === "fut" ? "selected" : ""}>Futures (index points)</option><option value="opt" ${pl.mode === "opt" ? "selected" : ""}>Options (premium)</option></select></label>
          <label>Entry<input id="plEntry" type="number" step="0.05" value="${pl.entry}"></label>
          <label>Stop loss<input id="plStop" type="number" step="0.05" value="${pl.stop}"></label>
          <label>Target<input id="plTarget" type="number" step="0.05" value="${pl.target}"></label>
          <label>Capital (₹)<input id="plCap" type="number" step="1000" value="${pl.cap}"></label>
          <label>Risk per trade (%)<input id="plRisk" type="number" step="0.25" value="${pl.risk}"></label>
          <label>Lot size<input id="plLot" type="number" step="1" value="${pl.lot}"></label>
        </div>
        <div class="ixa-pact"><button class="ixa-btn" type="button" data-plfill="bull">Fill from bullish scenario</button><button class="ixa-btn" type="button" data-plfill="bear">Fill from bearish scenario</button></div></div>
      <div class="panel"><div class="panel-h"><h3>RESULT</h3></div><div id="plOut">${planOut(r)}</div></div></div>`;
  }
  function planDefaults() {
    const A = S.A, sc = (A.scenarios && (A.scenarios.intraday || A.scenarios.sessions)) || null, lots = S.lots || {};
    const lot = lots[A.key] || "";
    return { dir: "long", mode: "fut", entry: A.last != null ? +A.last.toFixed(2) : "", stop: sc && sc.bull.invalidation ? sc.bull.invalidation.price : "", target: sc && sc.bull.targets && sc.bull.targets[0] ? sc.bull.targets[0].price : "", cap: 500000, risk: 1, lot };
  }
  function planCalc(pl) {
    const e = +pl.entry, s = +pl.stop, t = +pl.target, cap = +pl.cap, rk = +pl.risk, lot = +pl.lot || 1, dir = pl.dir === "short" ? -1 : 1;
    if (!(e > 0 && s > 0)) return null;
    const riskPts = (e - s) * dir, rewardPts = (t - e) * dir;
    if (riskPts <= 0) return { error: `The stop must be ${dir > 0 ? "below" : "above"} the entry for a ${pl.dir} trade.` };
    const riskLot = riskPts * lot, budget = cap * rk / 100, lots = Math.floor(budget / riskLot);
    return { riskPts, rewardPts, riskLot, rewardLot: rewardPts * lot, rr: rewardPts > 0 ? rewardPts / riskPts : null, budget, lots, maxLoss: lots * riskLot, expGain: lots * rewardPts * lot, lossPct: cap ? (lots * riskLot) / cap * 100 : null, lot };
  }
  function planOut(r) {
    if (!r) return `<div class="ixa-na">Enter entry and stop.</div>`;
    if (r.error) return `<div class="ixa-warn">${E(r.error)}</div>`;
    return `<div class="ixa-vtiles"><div><span>Risk per lot</span><b class="down">₹${N(r.riskLot, 0)}</b><small>${N(r.riskPts)} pts</small></div><div><span>Reward per lot</span><b class="up">₹${N(r.rewardLot, 0)}</b><small>${N(r.rewardPts)} pts</small></div><div><span>Reward : risk</span><b>${r.rr != null ? "1 : " + N(r.rr) : "—"}</b><small>${r.rr != null && r.rr < 1.5 ? "below 1.5 — thin" : ""}</small></div><div><span>Lots within risk budget</span><b>${r.lots}</b><small>budget ₹${N(r.budget, 0)}</small></div></div>
      <div class="ixa-kvl"><span>Maximum loss at stop</span><b class="down">₹${N(r.maxLoss, 0)} (${N(r.lossPct)}% of capital)</b><span>Gain at target</span><b class="up">₹${N(r.expGain, 0)}</b><span>Units</span><b>${N(r.lots * r.lot, 0)}</b></div>
      ${r.lots < 1 ? `<div class="ixa-warn">Even one lot risks more than your budget — widen the budget, tighten the stop, or skip the trade.</div>` : ""}`;
  }

  /* ══ PATTERN & INSIGHTS ═════════════════════════════════════════════════
     The Portfolio Analysis candlestick engine (PA_PATTERN · PA_SCORE · PA_STRUCT · PA_AI, all
     22 detectors) run on this chart's own candles and re-run on the live candle at most once a
     second — every tick can complete, change or dissolve a pattern. Leg and trend-slope
     thresholds are scaled to the timeframe's own ATR (a 1.5% "leg" means something different
     on a 5-minute index candle than on a daily stock candle). An index has no traded volume,
     so the volume factor is left out rather than scored. */
  const PT = { c: [], scored: [], bias: null, ind: null, kl: null, opts: null, seen: null, prevLive: new Map(), log: [], sel: null, ms: 0, at: 0, timer: 0, ctx: "" };
  const patKey = (p) => `${p.name}|${p.t}`;
  const clock = () => (RP.on ? RP.at : S.replaying && S.A ? S.A.asOf + (Date.now() - (S.replayAt || Date.now())) : Date.now());
  function patReset() { PT.seen = null; PT.log = []; PT.prevLive = new Map(); }
  const patOk = () => typeof PA_PATTERN !== "undefined" && typeof PA_SCORE !== "undefined";
  function patSchedule(now, gap = 1000) {
    if (!patOk() || !S.chart) return;
    if (now) { clearTimeout(PT.timer); PT.timer = 0; patScan(); return; }
    if (PT.timer) return;
    PT.timer = setTimeout(() => { PT.timer = 0; patScan(); }, Math.max(0, (PT.ran || 0) + gap - Date.now()));
  }
  function patScan() {
    const ctx = `${S.key}|${S.tf}`;
    if (ctx !== PT.ctx) { PT.ctx = ctx; PT.seen = null; PT.prevLive = new Map(); PT.log = []; PT.sel = null; }
    const t0 = performance.now(), A = S.A;
    const c = S.chart.bars.slice(-600).map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c }));
    PT.c = c; PT.at = clock(); PT.ran = Date.now();
    if (c.length < 20) { PT.scored = []; PT.bias = null; PT.ind = null; PT.kl = null; S.chart.setMarks([]); renderPat(); if (S.tab === "pat") renderWork(); return; }
    const atr = PA_MATH.atr(c, 14), ap = [];
    for (let i = Math.max(14, c.length - 120); i < c.length; i++) if (atr[i] && c[i].c) ap.push(atr[i] / c[i].c);
    ap.sort((x, y) => x - y);
    const atrPct = ap.length ? ap[ap.length >> 1] : 0.01;
    const opts = PT.opts = { legTh: Math.max(0.001, atrPct), slopeTh: Math.min(0.001, Math.max(0.00015, 0.25 * atrPct)) };
    // the last candle is still forming while the session is open (daily+ candles too)
    const forming = RP.on ? !!RP.part : !!(A && A.status && A.status.open);
    const n = c.length - 1;
    const scored = PA_SCORE.analyze(c, PA_PATTERN.detectAll(c, opts), opts).map((p) => {
      const live = p.i === n && forming;
      const factors = p.factors.filter((x) => !/^Volume|^Thin volume/.test(x.t)).map((x) => (!live && /on the live candle/.test(x.t) ? { ...x, t: "Awaiting confirmation — the next candle decides" } : x));
      return { ...p, live, factors, last: p.i === n };
    });
    const keys = new Set(scored.map(patKey));
    if (PT.seen) {
      const now = clock();
      for (const p of scored.slice(-6)) if (!PT.seen.has(patKey(p))) PT.log.unshift({ at: now, kind: p.live ? "forming" : "printed", p });
      for (const [k, p] of PT.prevLive) {
        if (!keys.has(k)) PT.log.unshift({ at: now, kind: "dissolved", p });
        else { const q = scored.find((x) => patKey(x) === k); if (q && !q.live) PT.log.unshift({ at: now, kind: "printed", p: q }); }
      }
    }
    PT.prevLive = new Map(scored.filter((p) => p.live).map((p) => [patKey(p), p]));
    PT.seen = keys; PT.log = PT.log.slice(0, 40);
    if (PT.sel && !keys.has(PT.sel)) PT.sel = null;
    PT.scored = scored; PT.bias = PA_SCORE.bias(c, scored, opts); PT.ind = patInd(c); PT.kl = PA_STRUCT.keyLevels(c);
    PT.ms = performance.now() - t0;
    S.chart.setMarks(scored.map((p) => ({ key: patKey(p), t: p.t, dir: p.dir, name: p.name, score: p.score, live: p.live, strength: p.strength, status: patStatus(p) })), PT.sel);
    renderPat(); if (!S.hoverOn) legend(null); if (S.tab === "pat") renderWork();
  }
  function patInd(c) {
    const closes = c.map((x) => x.c), n = c.length - 1, px = closes[n];
    const macd = PA_MATH.macd(closes), bb = PA_MATH.bollinger(closes), st = PA_MATH.supertrend(c), atr = PA_MATH.atr(c)[n];
    const A = S.A, vw = INTRA.includes(S.tf) && A && A.tech ? A.tech.twap : null;
    const h0 = macd.hist[n], h1 = macd.hist[n - 1];
    return { px, e20: PA_MATH.ema(closes, 20)[n], e50: PA_MATH.ema(closes, 50)[n], e200: PA_MATH.ema(closes, 200)[n], rsi: PA_MATH.rsi(closes)[n], macdH: h0, macdRising: h0 != null && h1 != null ? h0 > h1 : null,
      adx: PA_MATH.adx(c)[n], atr, atrPct: atr && px ? (atr / px) * 100 : null, vw, vwD: vw ? (px / vw - 1) * 100 : null, stDir: st[n] ? (st[n].up ? 1 : -1) : null,
      bbPos: bb.up[n] != null && bb.lo[n] != null && bb.up[n] > bb.lo[n] ? (px - bb.lo[n]) / (bb.up[n] - bb.lo[n]) : null };
  }
  function patSelect(k, fromChart) {
    PT.sel = k;
    // with the left column hidden (narrow screens) a chart click opens the write-up straight away
    const left = document.querySelector("#ixaRoot .ixa-left");
    if (fromChart && left && getComputedStyle(left).display === "none") patDrawer(k);
    const p = PT.scored.find((x) => patKey(x) === PT.sel);
    if (p && S.chart) S.chart.focusTime(p.t);
    if (S.chart) { S.chart.selMark = PT.sel; S.chart.draw(); }
    renderPat(); if (S.tab === "pat") renderWork();
  }
  const patWhen = (p) => (p.live ? "live candle" : INTRA.includes(S.tf) ? (new Date(p.t + 5.5 * 3600e3).toISOString().slice(0, 10) === new Date(PT.c[PT.c.length - 1].t + 5.5 * 3600e3).toISOString().slice(0, 10) ? hhmm(p.t) : new Date(p.t + 5.5 * 3600e3).toISOString().slice(5, 16).replace("T", " ")) : new Date(p.t + 5.5 * 3600e3).toISOString().slice(0, 10));
  const patTag = (d) => (d > 0 ? "Bullish" : d < 0 ? "Bearish" : "Neutral");
  const patGlyph = (p, w, h) => (typeof PA !== "undefined" && PA._glyphSVG ? PA._glyphSVG.call(PA, p, w, h) : "");
  const patCur = () => PT.scored.find((x) => patKey(x) === PT.sel) || PT.scored[PT.scored.length - 1] || null;
  const patStatus = (p) => (p.live ? "forming" : p.confirmed === true ? "confirmed" : p.confirmed === false ? "not confirmed" : "awaiting next candle");
  /* left column: compact, always visible beside the chart */
  function renderPat() {
    const el = $i("ixaPat"); if (!el) return;
    if (!patOk()) { morph(el, `<div class="ixa-pat-h"><span>PATTERN & INSIGHTS</span></div><div class="ixa-na" style="padding:10px 12px">Pattern engine not loaded.</div>`); return; }
    const b = PT.bias, m = patCur(), I = PT.ind, A = S.A;
    const head = `<div class="ixa-pat-h"><span>PATTERN & INSIGHTS</span></div>
      <div class="ixa-pat-live mono"><i class="${A && A.status && A.status.open ? "on" : ""}"></i>${TF_LBL[S.tf]} · ${PA_PATTERN.DETECTORS.length} patterns · ${PT.at ? hhmmss(PT.at) : "waiting"}${b ? `<span class="ixa-pat-b ${b.cls}">${E(b.label.replace(" Bias", ""))}</span>` : ""}</div>`;
    if (!PT.c.length || PT.c.length < 20) { morph(el, head + `<div class="ixa-na" style="padding:10px 12px">Waiting for candles (${PT.c.length}/20).</div>`); return; }
    const mini = (k, v, c2) => `<div><small>${k}</small><b class="${c2 || ""}">${v}</b></div>`;
    const trend = b && b.trend ? b.trend : null;
    morph(el, head + (m ? `<div class="ixa-pc${PT.sel ? " sel" : ""}" data-patdrawer="${E(patKey(m))}" role="button" tabindex="0" title="Open the full analysis">
        <div class="ixa-pc-l mono">${PT.sel ? "SELECTED" : m.live ? "FORMING NOW" : "LATEST"} · ${E(patWhen(m))}${PT.sel ? `<button type="button" class="ixa-pc-x" data-patclear title="Back to the latest pattern">× latest</button>` : ""}</div>
        <div class="ixa-pc-r">${patGlyph(m, 30, 27)}<div class="ixa-pc-t"><b class="${cls(m.dir)}">${E(m.name)}</b><span>${m.strength} ${patTag(m.dir)}</span></div><div class="ixa-pc-s"><b>${m.score}</b><small>conf</small></div></div>
        <span class="ixa-pc-bar"><i style="width:${m.score}%;background:${m.dir > 0 ? "var(--up)" : m.dir < 0 ? "var(--down)" : "var(--amber)"}"></i></span>
        <div class="ixa-pc-f">${m.factors.filter((x) => x.ok).length}/${m.factors.length} factors · ${E(patStatus(m))}</div>
        <div class="ixa-pc-go">View full analysis →</div></div>` : `<div class="ixa-na" style="padding:8px 12px">No candlestick pattern in the loaded window.</div>`) + `
      <div class="ixa-pat-m">${mini("Trend", trend ? E(trend.label.replace("Range / Sideways", "Range")) : "—", trend ? cls(trend.dir) : "")}${mini("RSI 14", I && I.rsi != null ? I.rsi.toFixed(0) : "—", I && I.rsi >= 55 ? "up" : I && I.rsi <= 45 ? "down" : "")}${mini("ADX", I && I.adx != null ? I.adx.toFixed(0) + (I.adx >= 25 ? " trend" : " range") : "—")}${mini("ATR", I && I.atrPct != null ? I.atrPct.toFixed(2) + "%" : "—")}</div>
      <div class="ixa-pat-s mono">RECENT</div>
      <div class="ixa-pat-r">${PT.scored.slice(-7).reverse().map((p) => `<button type="button" class="${PT.sel === patKey(p) ? "on" : ""}" data-pk="${E(patKey(p))}"><i class="${cls(p.dir) || "flat"}">${p.dir > 0 ? "▲" : p.dir < 0 ? "▼" : "◆"}</i><span>${E(p.name)}</span><em class="mono">${E(p.live ? "live" : patWhen(p).slice(-5))}</em><b class="mono">${p.score}</b></button>`).join("")}</div>
      <div class="ixa-pat-s mono">DETECTED LIVE</div>
      <div class="ixa-pat-log">${PT.log.slice(0, 5).map((x) => `<div><time class="mono">${hhmmss(x.at).slice(0, 5)}</time><b class="${x.kind === "dissolved" ? "" : cls(x.p.dir)}">${E(x.p.name)}</b><small>${x.kind}</small></div>`).join("") || `<div class="ixa-na">New patterns appear here the moment they form.</div>`}</div>
      <button type="button" class="ixa-pat-full" data-patfull>Full pattern analysis →</button>`);
  }
  /* workspace tab: the broad view — summary, indicators, levels, selected pattern in depth, timeline, library */
  function wPat() {
    if (!patOk()) return `<div class="ixa-empty">The candlestick engine did not load.</div>`;
    const c = PT.c, A = S.A;
    if (!c.length || c.length < 20 || !PT.ind) return `<div class="ixa-empty">Pattern recognition starts once 20 candles are on the chart (${c.length} so far).</div>`;
    const I = PT.ind, kl = PT.kl, b = PT.bias, m = patCur(), f2 = (v) => N(v), px = I.px;
    const tile = (k, v, s2, c2) => `<div><span>${k}</span><b class="${c2 || ""}">${v}</b><small>${s2 || ""}</small></div>`;
    const tiles = [
      tile("RSI 14", I.rsi != null ? I.rsi.toFixed(1) : "—", I.rsi >= 70 ? "overbought" : I.rsi <= 30 ? "oversold" : I.rsi >= 55 ? "bullish zone" : I.rsi <= 45 ? "bearish zone" : "neutral", I.rsi >= 55 ? "up" : I.rsi <= 45 ? "down" : ""),
      tile("MACD hist", I.macdH != null ? I.macdH.toFixed(2) : "—", I.macdRising == null ? "" : I.macdRising ? "rising" : "falling", cls(I.macdH)),
      tile("ADX 14", I.adx != null ? I.adx.toFixed(1) : "—", I.adx >= 30 ? "strong trend" : I.adx >= 20 ? "trend developing" : "weak / ranging"),
      tile("ATR 14", f2(I.atr), I.atrPct != null ? I.atrPct.toFixed(2) + "% per candle" : ""),
      I.vw ? tile("VWAP (session avg)", f2(I.vw), P(I.vwD) + " away", cls(I.vwD)) : tile("Supertrend", I.stDir ? (I.stDir > 0 ? "Up" : "Down") : "—", "10, 3", cls(I.stDir)),
      tile("EMA 20 / 50", f2(I.e20), "50: " + f2(I.e50), I.e20 != null && I.e50 != null ? cls(I.e20 - I.e50) : ""),
      tile("EMA 200", f2(I.e200), I.e200 ? (px > I.e200 ? "price above" : "price below") : "", I.e200 ? cls(px - I.e200) : ""),
      tile("Bollinger", I.bbPos != null ? (I.bbPos * 100).toFixed(0) + "%" : "—", "position in the 20, 2 band"),
    ].join("");
    // plain-language summary of what the candles say right now
    const sum = [];
    sum.push(`<b>${E(A ? A.name : S.key)} on the ${TF_LBL[S.tf]} chart reads ${b ? `<span class="${b.cls}">${E(b.label.toLowerCase())}</span> (bias score ${b.score > 0 ? "+" : ""}${b.score})` : "no bias yet"}.</b>`);
    if (b && b.trend) sum.push(`The trend engine sees ${E(b.trend.label.toLowerCase())} (${E(b.trend.detail)}).`);
    const st = [];
    if (I.e20 != null && I.e50 != null) st.push(px > I.e20 && I.e20 > I.e50 ? "price above a rising EMA 20 › EMA 50 stack" : px < I.e20 && I.e20 < I.e50 ? "price below a falling EMA 20 ‹ EMA 50 stack" : "a mixed EMA 20/50 stack");
    if (I.vwD != null) st.push(`${Math.abs(I.vwD).toFixed(2)}% ${I.vwD >= 0 ? "above" : "below"} the session average`);
    if (I.e200 != null) st.push(`${px > I.e200 ? "above" : "below"} the 200-EMA`);
    if (I.stDir) st.push(`Supertrend ${I.stDir > 0 ? "up" : "down"}`);
    if (st.length) sum.push(`Structure: ${st.join(", ")}.`);
    if (m) sum.push(`${m === PT.scored[PT.scored.length - 1] ? "Latest" : "Selected"} pattern: <b class="${cls(m.dir)}">${E(m.name)}</b> (${patWhen(m)}), ${m.strength.toLowerCase()} at ${m.score}/100, ${patStatus(m)}, ${m.factors.filter((x) => x.ok).length} of ${m.factors.length} confluence factors aligned.`);
    if (kl.r1 != null && kl.s1 != null) sum.push(`What changes the picture: a ${TF_LBL[S.tf]} close above ${f2(kl.r1)} opens the next leg up; a close below ${f2(kl.s1)} hands control to sellers.`);
    const lvl = [["R2", kl.r2], ["R1", kl.r1], ["Price", px], ["S1", kl.s1], ["S2", kl.s2]].filter(([, v]) => v != null).map(([k, v]) => `<div class="${k === "Price" ? "ixa-lvp" : k[0] === "R" ? "res" : "sup"}"><span>${k}</span><b>${f2(v)}</b><em>${v != null && k !== "Price" ? P((v / px - 1) * 100) : ""}</em><small></small></div>`).join("");
    // the selected (or latest) pattern in depth
    const kb = m ? (typeof PA_KB !== "undefined" && PA_KB[m.name]) || {} : {};
    const deep = m ? `<div class="ixa-pd-h">${patGlyph(m, 54, 46)}<div><b class="${cls(m.dir)}">${E(m.name)}</b><span>${m.strength} ${patTag(m.dir)} · ${E(kb.type || "")}</span><small class="mono">${E(patWhen(m))} · O ${f2(m.o)} H ${f2(m.h)} L ${f2(m.l)} C ${f2(m.cl)}</small></div>
        <div class="ixa-pd-ring"><svg viewBox="0 0 44 44" width="56" height="56"><circle cx="22" cy="22" r="18" fill="none" stroke="var(--hairline)" stroke-width="4"/><circle cx="22" cy="22" r="18" fill="none" stroke="${m.dir > 0 ? "#2e9e6b" : m.dir < 0 ? "#c84b3c" : "#e8a33d"}" stroke-width="4" stroke-dasharray="${(m.score / 100) * 113} 113" stroke-linecap="round" transform="rotate(-90 22 22)"/><text x="22" y="26" text-anchor="middle" fill="currentColor" font-size="11" font-weight="600">${m.score}</text></svg></div></div>
      ${m.live ? `<div class="ixa-pd-live">Forming on the live candle — it can still change or dissolve before the candle closes.</div>` : ""}
      <div class="ixa-sub mono">CONFLUENCE CHECKLIST</div>
      <ul class="ixa-pd-f">${m.factors.map((x) => `<li class="${x.ok ? "ok" : "no"}"><span>${x.ok ? "✓" : "·"}</span>${E(x.t)}</li>`).join("")}</ul>
      <div class="ixa-pd-p"><b>Setup.</b> ${E(PA_AI.strategy(m))}</div>
      <div class="ixa-pd-p"><b>Invalidation.</b> ${E(PA_AI.risk(m))}</div>
      <div class="ixa-sub mono">SCENARIOS</div><div class="ixa-pd-sc">${PA_AI.scenarios(m).map((x) => `<div>→ ${E(x)}</div>`).join("")}</div>
      <div class="ixa-pd-p"><b>Reliability.</b> ${E(PA_AI.reliability(m))}</div>
      ${kb.psychology ? `<div class="ixa-pd-p"><b>Psychology.</b> ${E(kb.psychology)}</div>` : ""}${kb.confirmation ? `<div class="ixa-pd-p"><b>Professional confirmation.</b> ${E(kb.confirmation)}</div>` : ""}` : `<div class="ixa-na">No pattern in the loaded window.</div>`;
    // timeline with what happened over the next 5 candles (closed patterns only)
    const tl = PT.scored.slice(-40).reverse().map((p) => {
      const fw = c[p.i + 5], ret = fw && !p.live ? (fw.c / c[p.i].c - 1) * 100 : null, win = ret != null && p.dir !== 0 ? (p.dir > 0 ? ret > 0 : ret < 0) : null;
      return `<tr class="${PT.sel === patKey(p) ? "sel" : ""}" data-pk="${E(patKey(p))}"><td class="mono">${E(patWhen(p))}</td><td><b class="${cls(p.dir)}">${p.dir > 0 ? "▲" : p.dir < 0 ? "▼" : "◆"}</b> ${E(p.name)}</td><td>${p.score} <small>${p.strength}</small></td><td>${E(patStatus(p))}</td><td class="${ret == null ? "" : cls(ret)}">${ret == null ? "—" : P(ret)}</td><td>${win == null ? "" : win ? '<span class="up">worked</span>' : '<span class="down">failed</span>'}</td></tr>`;
    }).join("");
    // per-pattern record in this window: every detector, how often it fired, how it resolved
    const lib = PA_PATTERN.DETECTORS.map((d) => {
      const hits = PT.scored.filter((p) => p.name === d.name), done = hits.filter((p) => p.dir !== 0 && c[p.i + 5]);
      const wins = done.filter((p) => { const r = c[p.i + 5].c / c[p.i].c - 1; return p.dir > 0 ? r > 0 : r < 0; }).length, lastP = hits[hits.length - 1];
      return `<div class="${hits.length ? "" : "z"}${lastP && lastP.live ? " live" : ""}"><span>${E(d.name)}</span><b>${hits.length}</b><small>${done.length ? `${wins}/${done.length} worked` : lastP ? E(patWhen(lastP)) : "—"}</small></div>`;
    }).join("");
    const logP = `<div class="panel"><div class="panel-h"><h3>DETECTED LIVE</h3><span class="panel-sub mono">this session</span></div>
          <div class="ixa-pat-log lg">${PT.log.slice(0, 14).map((x) => `<div><time class="mono">${hhmmss(x.at)}</time><b class="${x.kind === "dissolved" ? "" : cls(x.p.dir)}">${E(x.p.name)}</b><small>${x.kind} · ${x.p.score}/100</small></div>`).join("") || `<div class="ixa-na">While the market is open, each new pattern is logged here the moment it forms, prints (its candle closes) or dissolves.</div>`}</div></div>`;
    return `<div class="ixa-patw">
      <div class="ixa-patc"><div class="panel"><div class="panel-h"><h3>LIVE SUMMARY</h3>${info("patsum", "Live summary", "Recomputed on every tick (at most once a second) from the candles on the chart: the Portfolio Analysis candlestick engine — 22 pattern detectors, a confluence score (trend, structure, support/resistance, EMA alignment, momentum, confirmation) and a bias read. Leg and trend thresholds are scaled to this timeframe's ATR. An index has no traded volume, so the volume factor is left out.")}${b ? `<span class="ixa-pat-b ${b.cls}">${E(b.label)}</span>` : ""}</div>
        <div class="ixa-pat-sum">${sum.join(" ")}</div>
        <div class="ixa-sub mono" style="padding:0 12px">INDICATORS · ${TF_LBL[S.tf]}</div><div class="ixa-vtiles ixa-pat-tiles">${tiles}</div>
        <div class="ixa-sub mono" style="padding:0 12px">SUPPORT / RESISTANCE CLUSTERS</div><div class="ixa-lvg">${lvl}</div>
        <div class="ixa-note">Clusters are swing highs/lows grouped within ~0.6 ATR, weighted by touches and recency — the chart's own structure, separate from the pivot map in Key Levels. Scan ${PT.ms.toFixed(0)} ms over ${c.length} candles.</div></div>
      ${logP}</div>
      <div class="panel"><div class="panel-h"><h3>${PT.sel ? "SELECTED" : "LATEST"} PATTERN</h3>${m ? `<button type="button" class="ixa-btn ixa-pd-open" data-patdrawer="${E(patKey(m))}">Full analysis →</button>` : ""}${info("patdeep", "Pattern in depth", "Click any pattern in the timeline, the list beside the chart or a marker's row to study it. The checklist shows which confluence factors held when it printed; the setup, invalidation and scenarios come from the same engine as Portfolio Analysis. A pattern is an alert, not an order — wait for the confirmation close.")}</div><div class="ixa-pd">${deep}</div></div>
      <div class="ixa-patc ixa-patc3">
        <div class="panel"><div class="panel-h"><h3>PATTERN TIMELINE</h3><span class="panel-sub mono">${PT.scored.length} in window</span></div>
          <div class="ixa-pat-tl"><table class="ixa-t"><thead><tr><th>When</th><th>Pattern</th><th>Score</th><th>Status</th><th>Next 5</th><th></th></tr></thead><tbody>${tl || `<tr><td colspan="6" class="ixa-na">No patterns in the loaded window.</td></tr>`}</tbody></table></div></div>
        <div class="panel"><div class="panel-h"><h3>ALL ${PA_PATTERN.DETECTORS.length} PATTERNS · CHECKED EVERY TICK</h3>${info("patlib", "Pattern library", "Every detector runs on every candle in the window on each scan. The count is how often each fired here; 'worked' means price moved in the pattern's direction over the next five candles — a small local sample, not a universal hit rate.")}</div><div class="ixa-pat-lib">${lib}</div></div>
      </div>
    </div>`;
  }

  /* ── pattern drawer: the full write-up for one pattern (the Portfolio Analysis drawer, on index candles) ── */
  function patDrawer(k) {
    const p = PT.scored.find((x) => patKey(x) === k); if (!p) return;
    let dr = $i("ixaDrawer"), veil = $i("ixaVeil");
    if (!dr) {
      veil = document.createElement("div"); veil.className = "pa-drawer-veil"; veil.id = "ixaVeil"; veil.hidden = true;
      dr = document.createElement("aside"); dr.className = "pa-drawer"; dr.id = "ixaDrawer"; dr.hidden = true;
      document.body.append(veil, dr);
      veil.addEventListener("click", patDrawerClose);
      dr.addEventListener("click", (e) => {
        if (e.target.closest("[data-pdclose]")) return patDrawerClose();
        const b = e.target.closest("[data-pds]"); if (b) { dr.querySelectorAll("[data-pds]").forEach((x) => x.classList.toggle("on", x === b)); const sec = dr.querySelector(`.pa-d-sec[data-s="${b.dataset.pds}"]`); if (sec) dr.querySelector(".pa-d-content").scrollTo({ top: sec.offsetTop - 8, behavior: "smooth" }); }
      });
    }
    const kb = (typeof PA_KB !== "undefined" && PA_KB[p.name]) || {}, c = PT.c, f2 = (v) => N(v);
    const dirW = `${p.strength} ${patTag(p.dir)}`, A = S.A, sym = A ? A.name : S.key;
    const same = PT.scored.filter((x) => x.name === p.name && x.i !== p.i && c[x.i + 5]);
    let wins = 0, n = 0;
    const hist = same.slice(-8).map((x) => { const r = (c[x.i + 5].c / c[x.i].c - 1) * 100, w = x.dir >= 0 ? r > 0 : r < 0; if (x.dir !== 0) { n++; if (w) wins++; } return `<div class="pa-hist-row"><span class="mono">${E(patWhen(x))}</span><span>conf ${x.score}</span><b class="${cls(r)} mono">${P(r)} in 5 candles</b><i class="${w ? "up" : "down"}">${x.dir === 0 ? "·" : w ? "worked" : "failed"}</i></div>`; }).join("");
    const secs = [
      ["Overview", `<div class="pa-ov"><div class="pa-ov-diagram"><div class="pa-ov-dl mono">${p.candles > 1 ? "Previous → Signal" : "Signal candle"}</div>${patGlyph(p, 88, 74)}</div>
        <div class="pa-ov-facts"><div><span>Pattern type</span><b>${E(kb.type || "—")}</b></div><div><span>Formation</span><b>${p.candles} candle${p.candles > 1 ? "s" : ""}</b></div><div><span>Bias</span><b class="${cls(p.dir)}">${dirW}</b></div><div><span>Position</span><b>${p.keyNear.sup != null ? "Near support" : p.keyNear.res != null ? "Near resistance" : "Unanchored"}</b></div><div><span>Trend context</span><b>${E(p.trend.label)}</b></div><div><span>Status</span><b>${E(patStatus(p))}</b></div><div><span>Confluence score</span><b>${p.score}/100 (${p.strength})</b></div></div></div>
        <div class="pa-d-quick"><b>Quick summary.</b> ${E(PA_AI.overview(p, sym))}</div>`],
      ["Pattern anatomy", `<p>${E(kb.anatomy || "—")}</p><div class="pa-d-note">Signal candle (${E(TF_LBL[S.tf])}, ${E(patWhen(p))}) — O ${f2(p.o)} · H ${f2(p.h)} · L ${f2(p.l)} · C ${f2(p.cl)}. Index candles carry no volume.</div>`],
      ["Market psychology", `<p>${E(PA_AI.psychology(p))}</p>`],
      ["Context analysis", `<p>${E(PA_AI.context(p))}</p>`],
      ["Confirmation checklist", `<div class="pa-check">${p.factors.map((x) => `<div class="pa-chk ${x.ok ? "ok" : "no"}"><i>${x.ok ? "✓" : "✗"}</i>${E(x.t)}</div>`).join("")}</div>`],
      ["Reliability engine", `<p>${E(PA_AI.reliability(p))}</p>`],
      ["In this window", same.length ? `<div class="pa-hist">${hist}</div><div class="pa-d-note">${n ? `Directional ${E(p.name)} signals resolved in their favour ${wins}/${n} times over the next 5 candles on this chart — a small local sample, not a universal hit rate.` : "Sample too small for a hit-rate read."}</div>` : `<p>No earlier ${E(p.name)} on this chart's loaded window. A longer timeframe gives a larger sample.</p>`],
      ["Trading strategy", `<p>${E(PA_AI.strategy(p))}</p><div class="pa-scen">${PA_AI.scenarios(p).map((x) => `<div class="pa-scen-i">→ ${E(x)}</div>`).join("")}</div>`],
      ["Risk management", `<p>${E(PA_AI.risk(p))}</p>`],
      ["Educational notes", `<p><b>Where it works:</b> ${E(kb.valid || "—")}</p><p><b>Where it fails:</b> ${E(kb.invalid || "—")}</p><p><b>Common mistakes:</b> ${E(kb.mistakes || "—")}</p><p><b>Professional confirmation:</b> ${E(kb.confirmation || "—")}</p>`],
    ];
    dr.innerHTML = `<div class="pa-d-head"><div class="pa-d-title"><b>${E(p.name)}</b><span class="pa-d-badge ${cls(p.dir) || "flat"}">${dirW}</span><small class="mono">${E(sym)} · ${E(TF_LBL[S.tf])} · ${E(patWhen(p))}${RP.on ? " · replay" : ""}</small></div>
        <div class="pa-ring"><svg viewBox="0 0 44 44" width="52" height="52"><circle cx="22" cy="22" r="18" fill="none" stroke="var(--hairline)" stroke-width="4"/><circle cx="22" cy="22" r="18" fill="none" stroke="${p.dir > 0 ? "#2e9e6b" : p.dir < 0 ? "#c84b3c" : "#e8a33d"}" stroke-width="4" stroke-dasharray="${(p.score / 100) * 113} 113" stroke-linecap="round" transform="rotate(-90 22 22)"/><text x="22" y="26" text-anchor="middle" fill="var(--fg)" font-size="11" font-weight="600">${p.score}%</text></svg></div>
        <button class="pa-d-close" type="button" data-pdclose aria-label="Close">✕</button></div>
      <div class="pa-d-body"><nav class="pa-d-nav">${secs.map(([t], i) => `<button type="button" data-pds="${i}" class="${i === 0 ? "on" : ""}"><span class="mono">${String(i + 1).padStart(2, "0")}</span>${t}</button>`).join("")}</nav>
        <div class="pa-d-content">${secs.map(([t, h], i) => `<section class="pa-d-sec" data-s="${i}"><h4>${t}</h4>${h}</section>`).join("")}</div></div>`;
    dr.hidden = false; veil.hidden = false; requestAnimationFrame(() => dr.classList.add("open"));
  }
  function patDrawerClose() { const dr = $i("ixaDrawer"), veil = $i("ixaVeil"); if (!dr) return; dr.classList.remove("open"); setTimeout(() => { dr.hidden = true; veil.hidden = true; }, 240); }

  /* ══ BAR REPLAY ═════════════════════════════════════════════════════════
     Pick a past candle (or type a moment) and play the history forward: each candle forms from
     the finer bars inside it (1-minute where held, else 5-minute), patterns are re-detected on
     every step, and the forecast, scenarios, levels and regime are rebuilt by the server from
     only the bars that existed at that moment (/api/ix/replay). Live-only inputs — breadth,
     sectors, global, FII/DII, the option chain — have no intraday history and are not replayed. */
  const RP = { on: false, picking: false, tf: null, src: [], fine: {}, idx: -1, part: null, sub: 0, subs: null, at: 0, playing: false, speed: LS("rpSpeed", 2), timer: 0, inflight: false, want: 0, lastReq: 0, reqT: 0, note: "", key: null };
  const RP_SPEEDS = [1, 2, 5, 10, 20];
  const closeOf = (t) => { const d = new Date(t + 5.5 * 3600e3); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 10, 0); };   // 15:30 IST
  const istInput = (t) => new Date(t + 5.5 * 3600e3).toISOString().slice(0, 16);
  const tfMsOf = (tf) => ({ "1m": 60e3, "5m": 300e3, "15m": 900e3, "1h": 3600e3 }[tf] || 0);
  function rpEnd(i) {
    const b = RP.src[i]; if (!b) return 0;
    if (INTRA.includes(RP.tf)) return Math.min(b.t + tfMsOf(RP.tf), closeOf(b.t));
    if (RP.tf === "1d") return closeOf(b.t);
    return i < RP.src.length - 1 ? RP.src[i + 1].t - 60e3 : Math.min(Date.now(), closeOf(b.t) + 7 * 86400e3);
  }
  async function rpLoad(tf) {
    const key = S.key, get = async (t) => ((await api(`/api/ix/bars?symbol=${encodeURIComponent(key)}&tf=${t}&full=1`)).bars || []);
    const src = await get(tf);
    // finer bars a candle forms from: 1-minute (~5 sessions held), else 5-minute (~60 sessions) for 15m / 1H / D
    const fine = {};
    if (tf !== "1m" && tf !== "1wk" && tf !== "1mo") { try { fine.m1 = await get("1m"); } catch { } }
    if (["15m", "1h", "1d"].includes(tf)) { try { fine.m5 = await get("5m"); } catch { } }
    if (key !== S.key) return false;
    RP.tf = tf; RP.src = src; RP.fine = fine; RP.key = key;
    return src.length > 0;
  }
  function rpSubsFor(i) {
    const b = RP.src[i], end = rpEnd(i); if (!b) return null;
    const pick = (arr) => { if (!arr || !arr.length) return []; let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].t < b.t) lo = m + 1; else hi = m; } const out = []; for (let k = lo; k < arr.length && arr[k].t < end; k++) out.push(arr[k]); return out; };
    let list = pick(RP.fine.m1); if (list.length < 2) list = pick(RP.fine.m5);
    if (list.length < 2) return null;
    // about five visible steps per candle, whatever the timeframe
    const g = Math.max(1, Math.round(list.length / 5)), steps = [];
    for (let k = 0; k < list.length; k += g) { const ch = list.slice(k, k + g); steps.push({ t: ch[0].t, o: ch[0].o, h: Math.max(...ch.map((x) => x.h)), l: Math.min(...ch.map((x) => x.l)), c: ch[ch.length - 1].c, end: Math.min(end, ch[ch.length - 1].t + (list[1].t - list[0].t)) }); }
    return steps;
  }
  async function rpPick() {
    if (!S.chart) return;
    rpPause();
    if (!RP.src.length || RP.tf !== S.tf || RP.key !== S.key) { rpBanner("Loading the full history for this timeframe…"); if (!(await rpLoad(S.tf))) { rpBanner("No history to replay for this timeframe."); return; } }
    RP.picking = true; S.chart.pick = true;
    if (!RP.on) { S.chart.setBars(RP.src, S.tf); }
    else S.chart.setBars(RP.src, S.tf);   // show the whole series while choosing a new start
    rpBanner(`Click a candle — the replay starts right after it. Scroll or drag to go further back (${RP.src.length} ${TF_LBL[S.tf]} candles loaded). Esc cancels.`);
    rpUI();
  }
  function rpBanner(t) { const el = $i("ixaRpPick"); if (!el) return; el.hidden = !t; el.textContent = t || ""; }
  function rpStart(i) {
    if (!RP.src.length) return;
    i = Math.max(0, Math.min(RP.src.length - 1, i));
    RP.picking = false; if (S.chart) { S.chart.pick = false; S.chart.view.end = 0; }
    rpBanner("");
    if (!RP.on) { RP.on = true; S.replaying = true; S.replayAt = Date.now(); if (S.es) { S.es.close(); S.es = null; } }
    patReset(); RP.idx = i; RP.part = null; RP.sub = 0; RP.subs = null; RP.at = rpEnd(i); RP.note = "";
    rpShow(true); rpRequest(true); rpUI();
  }
  function rpShow(force) {
    const bars = RP.src.slice(0, RP.idx + 1); if (RP.part) bars.push({ ...RP.part });
    S.chart.setBars(bars, S.tf);
    const last = bars[bars.length - 1]; if (last) { S.chart.lastPrice = last.c; S.chart.lastTickAt = Date.now(); onPrice(last.c); }
    patSchedule(force || RP.speed <= 5, 250);
  }
  function rpStep() {
    if (!RP.on) return;
    if (RP.idx >= RP.src.length - 1 && !RP.part) { rpPause(); RP.note = "End of the loaded history — press “Back to live”."; rpUI(); return; }
    const ni = RP.idx + 1;
    if (!RP.subs || RP.subs.i !== ni) RP.subs = { i: ni, list: rpSubsFor(ni) };
    const list = RP.subs.list;
    if (list && list.length > 1) {
      const st = list[RP.sub], nb = RP.src[ni];
      RP.part = RP.part ? { ...RP.part, h: Math.max(RP.part.h, st.h), l: Math.min(RP.part.l, st.l), c: st.c } : { t: nb.t, o: st.o, h: st.h, l: st.l, c: st.c };
      RP.sub++; RP.at = st.end;
      if (RP.sub >= list.length) { RP.idx = ni; RP.part = null; RP.sub = 0; RP.at = rpEnd(ni); }
    } else { RP.idx = ni; RP.part = null; RP.sub = 0; RP.at = rpEnd(ni); }
    rpShow(); rpRequest(); rpUI();
  }
  function rpBack() {
    if (!RP.on) return;
    if (RP.part) { RP.part = null; RP.sub = 0; } else if (RP.idx > 0) RP.idx--;
    RP.at = rpEnd(RP.idx); patReset(); rpShow(true); rpRequest(); rpUI();
  }
  function rpPlay() { if (!RP.on) return; rpPause(); RP.playing = true; RP.timer = setInterval(rpStep, Math.round(1000 / RP.speed)); rpUI(); }
  function rpPause() { clearInterval(RP.timer); RP.timer = 0; RP.playing = false; }
  function rpJump(ms) {
    if (!RP.src.length) return;
    let i = -1; for (let k = 0; k < RP.src.length; k++) { if (rpEnd(k) <= ms) i = k; else break; }
    rpStart(Math.max(0, i));
  }
  async function rpTf(tf) {
    const at = RP.at; rpPause();
    if (!(await rpLoad(tf))) return rpExit();
    let i = -1; for (let k = 0; k < RP.src.length; k++) { if (rpEnd(k) <= at) i = k; else break; }
    RP.idx = Math.max(0, i); RP.part = null; RP.sub = 0; RP.subs = null; RP.at = rpEnd(RP.idx); patReset();
    rpShow(true); rpRequest(true); rpUI();
  }
  function rpExit(reconnect = true) {
    rpPause(); const was = RP.on;
    RP.on = false; RP.picking = false; RP.part = null; RP.note = ""; clearTimeout(RP.reqT);
    if (S.chart) S.chart.pick = false;
    rpBanner(""); rpUI(); patReset();
    if (was) { S.replaying = false; S.A = null; if (reconnect) { if (S.chart) S.chart.setBars([], S.tf); connect(); } }
    else if (reconnect) loadBars();
  }
  function rpRequest(force) {
    if (!RP.on) return;
    if (RP.inflight) { RP.want = RP.at; return; }
    const gap = Date.now() - RP.lastReq;
    if (!force && gap < 600) { clearTimeout(RP.reqT); RP.reqT = setTimeout(() => rpRequest(true), 600 - gap); return; }
    const at = RP.at, key = S.key; RP.inflight = true; RP.lastReq = Date.now();
    api(`/api/ix/replay?symbol=${encodeURIComponent(key)}&at=${at}`)
      .then((a) => {
        if (!RP.on || key !== S.key || at !== RP.at) return;
        if (a && !a.error) { RP.note = ""; onAnalysis(a); }
        else rpNoAnalysis((a && a.error) || "Replay analysis unavailable.");
      })
      .catch(() => { if (RP.on && at === RP.at) rpNoAnalysis("Replay analysis unavailable right now — candles and patterns still replay."); })
      .finally(() => { RP.inflight = false; rpUI(); if (RP.on && RP.want && RP.want !== at) { RP.want = 0; rpRequest(); } });
  }
  function rpNoAnalysis(msg) {
    RP.note = msg; S.A = null;
    if (S.chart) S.chart.setOverlay({});
    const blank = `<div class="ixa-na" style="padding:14px 12px">${E(msg)}</div>`;
    for (const id of ["ixaReg", "ixaLv"]) { const el = $i(id); if (el) { el._h = null; el.innerHTML = blank; } }
    const bo = $i("ixaBo"); if (bo) { bo._h = null; bo.innerHTML = ""; }
    renderStrip(); renderTicker(); renderWork(); renderFoot();
    setLive(`REPLAY · ${rpLabel()}`, "rp");
  }
  const rpLabel = () => { const d = new Date(RP.at + 5.5 * 3600e3), M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]; return `${d.getUTCDate()} ${M[d.getUTCMonth()]} ${d.getUTCFullYear()}${INTRA.includes(RP.tf) || RP.tf === "1d" ? ` ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}` : ""}`; };
  /* the control strip: built once, then only its values change (no re-render under the slider or inputs) */
  function rpUI() {
    const bar = $i("ixaRpBar"), btn = $i("ixaRpBtn"); if (!bar) return;
    if (btn) btn.classList.toggle("on", RP.on || RP.picking);
    bar.hidden = !RP.on;
    if (!RP.on) return;
    if (!bar.dataset.built) {
      bar.dataset.built = "1";
      bar.innerHTML = `<span class="ixa-rp-tag mono"><i></i>REPLAY</span>
        <button type="button" class="ixa-rpc" data-rp="back" title="Step back (←)">⏮</button><button type="button" class="ixa-rpc ixa-rp-play" data-rp="play" title="Play / pause (space)">▶</button><button type="button" class="ixa-rpc" data-rp="fwd" title="Step forward (→)">⏭</button>
        <select id="ixaRpSpd" class="ixa-sel" title="Replay speed (steps per second)">${RP_SPEEDS.map((x) => `<option value="${x}">${x}×</option>`).join("")}</select>
        <input type="range" id="ixaRpPos" min="0" max="0" step="1" title="Drag to move through the history">
        <span class="ixa-rp-t mono" id="ixaRpT"></span>
        <label class="ixa-rp-jump" title="Jump to a moment (IST)"><input type="datetime-local" id="ixaRpAt" class="ixa-sel" step="60"><button type="button" class="ixa-btn" data-rp="go">Go</button></label>
        <button type="button" class="ixa-btn" data-rp="pick" title="Choose a new start candle on the chart">✂ Pick candle</button>
        <button type="button" class="ixa-btn ixa-rp-live" data-rp="exit" title="Leave replay and return to the live market">● Back to live</button>
        <span class="ixa-rp-note" id="ixaRpNote"></span>`;
    }
    const pos = $i("ixaRpPos"), spd = $i("ixaRpSpd"), t = $i("ixaRpT"), at = $i("ixaRpAt"), note = $i("ixaRpNote"), play = bar.querySelector(".ixa-rp-play");
    pos.max = String(Math.max(0, RP.src.length - 1)); if (document.activeElement !== pos) pos.value = String(RP.idx);
    if (document.activeElement !== spd) spd.value = String(RP.speed);
    play.textContent = RP.playing ? "❚❚" : "▶"; play.classList.toggle("on", RP.playing);
    t.textContent = `${rpLabel()}${RP.part ? " · candle forming" : ""}`;
    if (RP.src.length && document.activeElement !== at) { at.min = istInput(RP.src[0].t); at.max = istInput(rpEnd(RP.src.length - 1)); at.value = istInput(RP.at); }
    note.textContent = RP.note || (RP.inflight ? "rebuilding the analysis for this moment…" : "");
  }
  function rpKey(e) {
    const tab = $i("tab-ixa"); if (!tab || tab.hidden || !(RP.on || RP.picking)) return;
    if (e.target.closest && e.target.closest("input, select, textarea")) return;
    if (e.key === "Escape") { if (RP.picking) { RP.picking = false; if (S.chart) S.chart.pick = false; rpBanner(""); if (RP.on) rpShow(true); else loadBars(); rpUI(); } else rpExit(); e.preventDefault(); return; }
    if (!RP.on) return;
    if (e.key === " ") { RP.playing ? rpPause() : rpPlay(); rpUI(); e.preventDefault(); }
    else if (e.key === "ArrowRight") { rpPause(); rpStep(); e.preventDefault(); }
    else if (e.key === "ArrowLeft") { rpPause(); rpBack(); e.preventDefault(); }
  }

  /* ══ EVENTS ═════════════════════════════════════════════════════════════ */
  function onAlert(al) {
    if (S.alerts.some((x) => x.id === al.id)) return;
    S.alerts.unshift(al); S.alerts = S.alerts.slice(0, 80);
    const r = ruleOf(al.rule); if (r !== "watch" && S.rules[r] === false) return;
    toast(al);
    if (S.notify && typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) { try { new Notification(`${al.name || al.index}: ${al.title}`, { body: al.text, tag: al.id }); } catch { } }
    renderTabs(); if (S.tab === "alerts") renderWork();
  }
  function toast(al) {
    const box = $i("ixaToasts"); if (!box) return;
    const t = document.createElement("div"); t.className = "ixa-toast " + (al.severity || "");
    t.innerHTML = `<b>${E(al.name || al.index)} · ${E(al.title)}</b><small>${E(al.text)}</small>`;
    t.addEventListener("click", () => { S.tab = "alerts"; SAVE("tab", S.tab); renderTabs(); renderWork(); t.remove(); });
    box.prepend(t); setTimeout(() => t.remove(), 9000); while (box.children.length > 4) box.lastElementChild.remove();
  }
  /* watchlist stocks through the Live Scanner stream */
  function connectWatch() {
    if (S.wlEs) { S.wlEs.close(); S.wlEs = null; }
    if (!S.watch.length) return;
    const es = new EventSource(`/api/scanner/stream?every=5&delta=1&symbols=${encodeURIComponent(S.watch.join(","))}`); S.wlEs = es;
    es.addEventListener("frame", (e) => {
      const f = JSON.parse(e.data);
      for (const r of f.rows || []) {
        if (!S.watch.includes(r.s)) continue;
        const prev = S.wl.get(r.s), cur = { ...(prev || {}), ...r }; S.wl.set(r.s, cur);
        if (!prev || prev.ltp == null) continue;
        const fire = (rule, title, text) => onAlert({ id: `wl-${r.s}-${rule}-${Math.floor(Date.now() / 600e3)}`, ts: Date.now(), index: r.s, name: r.s, rule: "wl-" + rule, severity: "info", title, text });
        if (cur.distN != null && cur.distN > -0.3 && cur.distN < 0 && !(prev.distN > -0.3 && prev.distN < 0)) fire("near", `${r.s} within 0.3% of its 20-day high`, `LTP ${N(cur.ltp)} · RVOL ${N(cur.rvol)}×`);
        if (cur.orb && cur.orb !== prev.orb) fire("orb", `${r.s} broke its opening range ${cur.orb > 0 ? "high" : "low"}`, `${P(cur.pct)} today · RVOL ${N(cur.rvol)}×`);
        if (cur.vwapD != null && prev.vwapD != null && Math.sign(cur.vwapD) !== Math.sign(prev.vwapD) && cur.rvol >= 1.5) fire("vwap", `${r.s} crossed ${cur.vwapD > 0 ? "above" : "below"} VWAP on volume`, `RVOL ${N(cur.rvol)}×`);
        if (cur.rvol >= 3 && !(prev.rvol >= 3)) fire("vol", `${r.s} abnormal volume`, `${N(cur.rvol)}× normal for the time of day`);
      }
      if (S.tab === "alerts") renderWork();
    });
  }

  /* ══ MOUNT ══════════════════════════════════════════════════════════════ */
  async function mount() {
    if (S.mounted) return show();
    const root = $i("ixaRoot"); if (!root) return;
    S.mounted = true; root.innerHTML = skeleton();
    S.chart = new IXChart($i("ixaCv"), { onHover: (h) => { S.hoverOn = !!h; legend(h); }, onMarkClick: (k) => patSelect(k, true), onPick: (i) => rpStart(i) });
    window.IX_MODEL_COLORS = IX_MODEL_COLORS;
    if (S.ind) for (const [k, v] of Object.entries(S.ind)) S.chart.ind[k] = v;
    bind(root);
    try { const j = await api("/api/ix/indices"); S.indices = j.indices || []; renderSide(); } catch { }
    if (!S.indices.some((x) => x.key === S.key)) S.key = "NIFTY";
    api("/api/ix/lots").then((j) => { S.lots = j.lots || {}; }).catch(() => {});
    connect(); connectWatch();
    // leave the stream when the tab has been hidden for a minute; rejoin when shown
    setInterval(() => {
      const tab = $i("tab-ixa"), hidden = !tab || tab.hidden || document.hidden;
      if (hidden) { S.hiddenAt = S.hiddenAt || Date.now(); if (S.es && Date.now() - S.hiddenAt > 60e3) { S.es.close(); S.es = null; } }
      else { S.hiddenAt = null; if (!S.es && !S.replaying) connect(); }
      if (S.lastTick && Date.now() - S.lastTick > 8000) { const el = $i("ixaLive"); if (el && el.classList.contains("on")) el.classList.add("idle"); } else { const el = $i("ixaLive"); if (el) el.classList.remove("idle"); }
    }, 5000);
  }
  function show() { if (!S.es && !S.replaying) connect(); if (S.chart) S.chart.draw(); }
  function switchIndex(k) {
    if (!k || k === S.key) return;
    if (RP.on || RP.picking) rpExit(false);
    RP.src = []; S.replaying = false; S.key = k; SAVE("key", k); S.A = null; S.OI = null; S.chainExp = null; S.chainData = null; S.plan = null;
    if (S.chart) S.chart.setBars([], S.tf);
    renderSide(); connect();
  }
  function bind(root) {
    root.addEventListener("click", (e) => {
      const t = e.target;
      const ib = t.closest("[data-info]"); if (ib) { if (window.MT_INFO) MT_INFO.open(ib, ib.dataset.title, `<p>${E(ib.dataset.text)}</p>`); return; }
      const ix = t.closest("[data-ix]"); if (ix) { switchIndex(ix.dataset.ix); return; }
      const go = t.closest("[data-goto]"); if (go) { S.tab = go.dataset.goto; SAVE("tab", S.tab); renderTabs(); renderWork(); $i("ixaWtabs").scrollIntoView({ behavior: "smooth", block: "start" }); return; }
      const tf = t.closest("[data-tf]"); if (tf) {
        S.tf = tf.dataset.tf; SAVE("tf", S.tf); root.querySelectorAll("[data-tf]").forEach((b) => b.classList.toggle("on", b === tf));
        if (RP.on) { rpTf(S.tf); return; }                       // the replay keeps its moment on the new timeframe
        if (S.chart) S.chart.setBars([], S.tf);
        if (RP.picking) { RP.src = []; rpPick(); return; }
        loadBars(); return;
      }
      const vw = t.closest("[data-view]"); if (vw) { S.chart.setInd("view", vw.dataset.view); S.ind = { ...S.chart.ind }; SAVE("ind", S.ind); root.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("on", b === vw)); renderFoot(); return; }
      const dd = t.closest("[data-dd]"); if (dd) { const m = $i(dd.dataset.dd); m.hidden = !m.hidden; return; }
      if (!t.closest(".ixa-dd")) { const m = $i("ixaIndMenu"); if (m) m.hidden = true; }
      if (t.closest("#ixaFull")) { const w = root.querySelector(".ixa-main"); w.classList.toggle("full"); setTimeout(() => S.chart && S.chart.draw(), 50); return; }
      const wt = t.closest("[data-wt]"); if (wt) { S.tab = wt.dataset.wt; SAVE("tab", S.tab); renderTabs(); renderWork(); return; }
      const cv = t.closest("[data-cv]"); if (cv) { S.chainView = cv.dataset.cv; renderWork(); return; }
      const hm = t.closest("[data-heat]"); if (hm) { S.heat = hm.dataset.heat; renderWork(); return; }
      const hz = t.closest("[data-schz]"); if (hz && !hz.disabled) { S.scHz = hz.dataset.schz; SAVE("scHz", S.scHz); renderWork(); return; }
      const co = t.closest("[data-corr]"); if (co) { S.corrSet = co.dataset.corr; renderWork(); return; }
      const rm = t.closest("[data-wlrm]"); if (rm) { S.watch = S.watch.filter((x) => x !== rm.dataset.wlrm); S.wl.delete(rm.dataset.wlrm); SAVE("watch", S.watch); connectWatch(); renderWork(); return; }
      if (t.closest("#ixaWlAdd")) { addWatch(); return; }
      const pf = t.closest("[data-plfill]"); if (pf) { fillPlan(pf.dataset.plfill); return; }
      if (t.closest("[data-patclear]")) { PT.sel = null; if (S.chart) { S.chart.selMark = null; S.chart.draw(); } renderPat(); if (S.tab === "pat") renderWork(); return; }
      const pdw = t.closest("[data-patdrawer]"); if (pdw) { patDrawer(pdw.dataset.patdrawer); return; }
      const pk = t.closest("[data-pk]"); if (pk) { patSelect(pk.dataset.pk); return; }
      if (t.closest("#ixaRpBtn")) { if (RP.on) rpExit(); else if (RP.picking) { RP.picking = false; S.chart.pick = false; rpBanner(""); loadBars(); rpUI(); } else rpPick(); return; }
      const rp = t.closest("[data-rp]");
      if (rp) {
        const a = rp.dataset.rp;
        if (a === "play") { RP.playing ? rpPause() : rpPlay(); rpUI(); }
        else if (a === "fwd") { rpPause(); rpStep(); }
        else if (a === "back") { rpPause(); rpBack(); }
        else if (a === "pick") rpPick();
        else if (a === "exit") rpExit();
        else if (a === "go") { const v = ($i("ixaRpAt") || {}).value; if (v) rpJump(Date.parse(v + ":00Z") - 5.5 * 3600e3); }
        return;
      }
      if (t.closest("[data-patfull]")) { S.tab = "pat"; SAVE("tab", S.tab); renderTabs(); renderWork(); $i("ixaWtabs").scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    });
    root.addEventListener("change", async (e) => {
      const t = e.target;
      if (t.dataset.ind) { S.chart.setInd(t.dataset.ind, t.checked); S.ind = { ...S.chart.ind }; SAVE("ind", S.ind); legend(null); return; }
      if (t.dataset.rule) { S.rules[t.dataset.rule] = t.checked; SAVE("rules", S.rules); renderWork(); return; }
      if (t.id === "ixaNotify") { S.notify = t.checked; SAVE("notify", S.notify); if (t.checked && typeof Notification !== "undefined" && Notification.permission === "default") await Notification.requestPermission().catch(() => {}); renderWork(); return; }
      if (t.id === "ixaExp") { const nearest = S.OI && S.OI.expiries && S.OI.expiries[0]; S.chainExp = t.value === nearest ? null : t.value; S.chainData = null; if (S.chainExp) loadChain(); renderWork(); return; }
      if (t.id && t.id.startsWith("pl")) readPlan();
      if (t.id === "ixaRpSpd") { RP.speed = +t.value || 2; SAVE("rpSpeed", RP.speed); if (RP.playing) rpPlay(); return; }
    });
    root.addEventListener("input", (e) => {
      if (e.target.id && e.target.id.startsWith("pl")) readPlan();
      if (e.target.id === "ixaRpPos" && RP.on) { rpPause(); RP.idx = +e.target.value; RP.part = null; RP.sub = 0; RP.at = rpEnd(RP.idx); patReset(); rpShow(true); rpRequest(); rpUI(); }
    });
    document.addEventListener("keydown", rpKey);
    root.addEventListener("keydown", (e) => { if (e.target.id === "ixaWlIn" && e.key === "Enter") addWatch(); });
    setInterval(() => { if (S.chainExp && S.tab === "oi") loadChain(); }, 60e3);
  }
  async function loadChain() { const exp = S.chainExp; try { const j = await api(`/api/ix/chain?symbol=${encodeURIComponent(S.key)}&expiry=${encodeURIComponent(exp)}`); if (exp === S.chainExp && j.data) { S.chainData = { ...j.data, expiries: j.expiries, flowLog: j.data.flowLog }; renderWork(); } } catch { } }
  function addWatch() { const inp = $i("ixaWlIn"); if (!inp) return; const add = inp.value.toUpperCase().split(/[,\s]+/).map((x) => x.replace(/\.NS$/, "").replace(/[^A-Z0-9&-]/g, "")).filter(Boolean); if (!add.length) return; S.watch = [...new Set([...S.watch, ...add])].slice(0, 30); SAVE("watch", S.watch); inp.value = ""; connectWatch(); S.tab === "alerts" && (renderWork()); }
  function readPlan() { const v = (id) => ($i(id) || {}).value; S.plan = { dir: v("plDir"), mode: v("plMode"), entry: v("plEntry"), stop: v("plStop"), target: v("plTarget"), cap: v("plCap"), risk: v("plRisk"), lot: v("plLot") }; const o = $i("plOut"); if (o) o.innerHTML = planOut(planCalc(S.plan)); }
  function fillPlan(k) {
    const A = S.A, sc = A && A.scenarios && (A.scenarios.intraday || A.scenarios.sessions); if (!sc) return;
    const s = sc[k]; const set = (id, v) => { const el = $i(id); if (el && v != null) el.value = v; };
    set("plDir", k === "bull" ? "long" : "short"); set("plMode", "fut");
    set("plEntry", s.trigger ? s.trigger.price : A.last); set("plStop", s.invalidation ? s.invalidation.price : ""); set("plTarget", s.targets && s.targets[0] ? s.targets[0].price : "");
    readPlan();
  }
  /* replay hook (used to verify mid-session rendering from a recorded session) */
  function _replay(a, bars) { S.replaying = true; S.replayAt = Date.now(); if (S.es) { S.es.close(); S.es = null; } S.key = a.key; if (bars && S.chart) S.chart.setBars(bars, S.tf); onAnalysis(a); patSchedule(true); }
  return { mount, show, state: S, patterns: PT, replay: RP, _replay, _tick: onTick };
})();

TABS.ixa = { init() { IXA.mount(); }, syncContext() { IXA.show(); } };
