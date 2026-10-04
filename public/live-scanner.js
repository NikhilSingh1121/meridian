/* ════════════════════════════════════════════════════════════════════════════
   LIVE SCANNER — M-Terminal tab.
   One SSE connection (/api/scanner/stream, opened when this tab is first shown)
   pushes only the rows that changed, at the interval chosen in the top bar (↻).
   Prices come from Yahoo's public stream; the scans are fixed presets run on the
   server for everyone. Per-viewer choices (hidden scans, filters, sort) stay in
   this browser. Views: Scanner · Top 5 Now · Sector Rotation.
   ════════════════════════════════════════════════════════════════════════════ */
const LSC = (() => {
  const S = {
    rows: new Map(), dom: new Map(), changed: new Set(), order: "", sort: { k: "score", d: -1 },
    f: { q: "", scan: null, dir: 0, minScore: 0, minRvol: 0, fno: false, sec: "", tagged: false },
    sel: null, view: "scanner", es: null, id: null, status: null, market: null, events: [], evIds: new Set(),
    scans: [], fields: [], ops: [], perf: { last: 0, avg: 0, max: 0, n: 0 }, raf: 0, paused: false, mounted: false,
    dw: { s: null, tab: "overview", bars: null, barsAt: 0 }, sectors: new Set(), lastFrame: 0,
    off: new Set((() => { try { return JSON.parse(localStorage.getItem("meridian_scannerOff") || "[]"); } catch { return []; } })()),
  };
  const saveOff = () => { try { localStorage.setItem("meridian_scannerOff", JSON.stringify([...S.off])); } catch { } };
  const tagOff = (t) => { const sc = S.scans.find((x) => (x.tag || x.id) === t); return !!(sc && S.off.has(sc.id)); };
  const liveTags = (r) => (r.tags || []).filter((t) => !tagOff(t));
  const $r = (sel) => document.querySelector("#lscRoot " + sel);
  const N = (v, dp = 2) => (v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp }));
  const P = (v, dp = 2) => (v == null || !Number.isFinite(v) ? "—" : (v > 0 ? "+" : "") + v.toFixed(dp) + "%");
  const X = (v, dp = 1) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(dp) + "×");
  const cls = (v) => (v == null ? "dim" : v > 0 ? "up" : v < 0 ? "down" : "dim");
  const VOL = (v) => (!v ? "—" : v >= 1e7 ? (v / 1e7).toFixed(2) + " Cr" : v >= 1e5 ? (v / 1e5).toFixed(1) + " L" : Math.round(v).toLocaleString("en-IN"));
  const hhmmss = (ts) => new Date(ts + 5.5 * 3600e3).toISOString().slice(11, 19);
  const visible = () => { const t = document.getElementById("tab-scanner"); return t && !t.hidden; };
  const heat = (v, full, rgb) => (v == null || !Number.isFinite(v) || v === 0 ? "" : `rgba(${rgb},${Math.min(1, Math.abs(v) / full) * 0.32})`);
  const UP = "46,158,107", DN = "200,75,60", AM = "200,134,42";

  function spark(arr, w = 72, h = 20) {
    const a = (arr || []).filter((x) => Number.isFinite(x));
    if (a.length < 2) return `<svg class="lsc-spark" width="${w}" height="${h}"></svg>`;
    const mn = Math.min(...a), mx = Math.max(...a), sp = mx - mn || 1;
    const d = a.map((v, i) => `${i ? "L" : "M"}${((i / (a.length - 1)) * (w - 2) + 1).toFixed(1)} ${(h - 2 - ((v - mn) / sp) * (h - 4)).toFixed(1)}`).join("");
    const col = a[a.length - 1] >= a[0] ? "var(--up)" : "var(--down)";
    return `<svg class="lsc-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="${d}" fill="none" stroke="${col}" stroke-width="1.3"/></svg>`;
  }
  function sparkPath(arr, w = 72, h = 20) {
    const a = (arr || []).filter((x) => Number.isFinite(x)); if (a.length < 2) return ["", "none"];
    const mn = Math.min(...a), mx = Math.max(...a), sp = mx - mn || 1;
    return [a.map((v, i) => `${i ? "L" : "M"}${((i / (a.length - 1)) * (w - 2) + 1).toFixed(1)} ${(h - 2 - ((v - mn) / sp) * (h - 4)).toFixed(1)}`).join(""), a[a.length - 1] >= a[0] ? "var(--up)" : "var(--down)"];
  }
  const tagCls = (t) => { const sc = S.scans.find((x) => (x.tag || x.id) === t); return sc ? (sc.bias > 0 ? "b" : sc.bias < 0 ? "s" : "n") : "n"; };

  /* ── columns: [key, header, title, render(r) → {t, c?, bg?, html?}, sortValue] ── */
  const COLS = [
    ["s", "SYMBOL", "Symbol · sector", null, (r) => r.s],
    ["ltp", "LTP", "Last traded price", (r) => ({ t: N(r.ltp) }), (r) => r.ltp],
    ["pct", "% CHG", "Change vs previous close", (r) => ({ t: P(r.pct), c: cls(r.pct), bg: heat(r.pct, 4, r.pct > 0 ? UP : DN) }), (r) => r.pct],
    ["rvol", "RVOL", "Volume vs the same time of day (5-session profile)", (r) => ({ t: X(r.rvol, 2), c: r.rvol >= 2 ? "flag" : "", bg: r.rvol > 1 ? heat(r.rvol - 1, 3, AM) : "" }), (r) => r.rvol],
    ["vspike", "SPIKE", "This minute's volume vs the same minute's average", (r) => ({ t: X(r.vspike, 1), bg: r.vspike > 1.5 ? heat(r.vspike - 1, 6, AM) : "" }), (r) => r.vspike],
    ["m1", "M1", "Momentum 1 min", (r) => ({ t: P(r.m1), c: cls(r.m1) }), (r) => r.m1],
    ["m5", "M5", "Momentum 5 min", (r) => ({ t: P(r.m5), c: cls(r.m5), bg: heat(r.m5, 1.5, r.m5 > 0 ? UP : DN) }), (r) => r.m5],
    ["vwapD", "VWAP", "Distance from VWAP", (r) => ({ t: P(r.vwapD), c: cls(r.vwapD) }), (r) => r.vwapD],
    ["gap", "GAP", "Opening gap", (r) => ({ t: P(r.gap, 1), c: Math.abs(r.gap) >= 1 ? cls(r.gap) + " flag" : "dim" }), (r) => r.gap],
    ["orb", "ORB", "Opening-range (15 min) breakout", (r) => ({ t: r.orb > 0 ? "▲" : r.orb < 0 ? "▼" : "·", c: r.orb > 0 ? "up flag" : r.orb < 0 ? "down flag" : "dim" }), (r) => r.orb],
    ["brk", "BRK", "Breakout of the 20-day (N) or 52-week (52) range", (r) => { const t = r.brk52 ? (r.brk52 > 0 ? "52▲" : "52▼") : r.brkN ? (r.brkN > 0 ? "N▲" : "N▼") : r.distN != null ? r.distN.toFixed(1) + "%" : "—"; return { t, c: r.brk52 || r.brkN ? ((r.brk52 || r.brkN) > 0 ? "up flag" : "down flag") : "dim" }; }, (r) => (r.brk52 || 0) * 2 + (r.brkN || 0) + (r.distN || 0) / 100],
    ["sqz", "SQZ", "Squeeze: ● coiling (bars) · ✦ released", (r) => ({ t: r.sqzFire ? (r.sqzFire > 0 ? "✦▲" : "✦▼") : r.sqz ? "●" + r.sqzBars : "·", c: r.sqzFire ? (r.sqzFire > 0 ? "up flag" : "down flag") : r.sqz ? "flag" : "dim" }), (r) => (r.sqzFire ? 100 : 0) + (r.sqz ? r.sqzBars : 0)],
    ["rsN", "RS·N", "Relative strength vs NIFTY (pp)", (r) => ({ t: r.rsN == null ? "—" : (r.rsN > 0 ? "+" : "") + r.rsN.toFixed(2), c: cls(r.rsN) }), (r) => r.rsN],
    ["rsS", "RS·SEC", "Relative strength vs sector (pp)", (r) => ({ t: r.rsS == null ? "—" : (r.rsS > 0 ? "+" : "") + r.rsS.toFixed(2), c: cls(r.rsS) }), (r) => r.rsS],
    ["spark", "TREND", "Last 30 one-minute closes + live price", (r) => ({ path: sparkPath(r.spark ? [...r.spark, r.ltp] : null), key: (r.spark || []).length + "|" + (r.spark || []).at(-1) + "|" + r.ltp }), null],
    ["tags", "SIGNALS", "Scans matching now (hidden scans are left out)", (r) => { const t = liveTags(r); return { html: `<span class="lsc-tags">${t.map((x) => `<span class="lsc-tag ${tagCls(x)}">${esc(x)}</span>`).join("")}</span>`, key: t.join("|") + "|" + S.off.size }; }, (r) => liveTags(r).length],
    ["score", "SCORE", "Signal score 0–100: how many bullish or bearish conditions line up (breakouts, volume, VWAP, momentum, relative strength)", (r) => ({ html: `<span class="lsc-score"><i><u style="width:${r.score || 0}%"></u></i><b class="${r.bias > 0 ? "up" : r.bias < 0 ? "down" : ""}">${r.score ?? "—"}</b></span>`, key: r.score + "|" + r.bias }), (r) => r.score],
  ];
  const COLI = Object.fromEntries(COLS.map((c, i) => [c[0], i]));
  const COLW = { s: 128, ltp: 68, pct: 58, rvol: 50, vspike: 46, m1: 52, m5: 54, vwapD: 54, gap: 44, orb: 30, brk: 46, sqz: 36, rsN: 48, rsS: 50, spark: 76, tags: 112, score: 64 };

  /* ── skeleton ── */
  function skeleton() {
    return `
    <div class="lsc-strip">
      <span class="lsc-feed" id="lscFeed">CONNECTING</span>
      <div class="lsc-idx" id="lscIdx"></div>
      <span class="sp"></span>
      <span class="lsc-meta" id="lscMeta"></span>
    </div>
    <div id="lscWarn"></div>
    <nav class="lsc-nav" id="lscNav">
      <button data-v="scanner" class="on">Scanner<kbd>1</kbd></button>
    </nav>
    <div id="lscViews">
      <div data-view="scanner" class="lsc-grid">
        <div class="panel"><div class="panel-h"><h3>SCANS</h3><span class="panel-sub" id="lscScanN"></span></div>
          <div class="lsc-scans" id="lscScans"><div class="loading">loading scans…</div></div>
          <div class="lsc-sc-act"><span class="ws-dim ec-small">Tick a scan to show or hide it · ⓘ explains it</span><button class="mini-btn" id="lscHelpB" type="button" title="Keyboard shortcuts (?)">⌨ Keys</button></div>
        </div>
        <div class="panel">
          <div class="lsc-tb">
            <input class="lsc-in" id="lscQ" placeholder="Filter symbol / sector (f)" spellcheck="false" autocomplete="off">
            <div class="mc-tf" id="lscDir"><button class="mc-tfb on" data-d="0" type="button">All</button><button class="mc-tfb" data-d="1" type="button">▲ Bull</button><button class="mc-tfb" data-d="-1" type="button">▼ Bear</button></div>
            <select class="lsc-sel" id="lscMinS" title="Minimum score"><option value="0">Score ≥ 0</option><option value="20">≥ 20</option><option value="35">≥ 35</option><option value="50">≥ 50</option><option value="65">≥ 65</option></select>
            <select class="lsc-sel" id="lscMinR" title="Minimum relative volume"><option value="0">RVol any</option><option value="1.2">≥ 1.2×</option><option value="1.5">≥ 1.5×</option><option value="2">≥ 2×</option><option value="3">≥ 3×</option></select>
            <select class="lsc-sel" id="lscSec" title="Sector"><option value="">All sectors</option></select>
            <label><input type="checkbox" id="lscTag"> Signals only</label>
            <label><input type="checkbox" id="lscFno"> F&amp;O only</label>
            <span id="lscScanChip"></span>
            <span class="lsc-count" id="lscCount"></span>
          </div>
          <div class="lsc-tw" id="lscTw"><table class="lsc-t" id="lscT"><colgroup>${COLS.map(([k]) => `<col style="width:${COLW[k] || 56}px">`).join("")}</colgroup><thead><tr>${COLS.map(([k, h, t]) => `<th data-k="${k}" title="${esc(t)}">${h}</th>`).join("")}</tr></thead><tbody id="lscBody"></tbody></table>
            <div class="lsc-empty" id="lscEmpty" hidden>No symbols match these filters.</div></div>
        </div>
        <div class="panel lsc-feedp"><div class="panel-h"><h3>SIGNAL FEED</h3><span class="panel-sub" id="lscEvN"></span></div><div class="lsc-feed-list" id="lscFeedList"><div class="lsc-empty">Signals appear here as scans trigger.</div></div></div>
      </div>
    </div>`;
  }

  /* ── SSE ── */
  function connect() {
    if (S.es) S.es.close();
    const every = (window.REFRESH && REFRESH.sec) || 5;
    const es = new EventSource(`/api/scanner/stream?every=${every}&delta=1`);
    S.es = es;
    es.addEventListener("hello", (e) => { const d = JSON.parse(e.data); S.id = d.id; setStatus(d.status); if (!S.scans.length && S.mounted) loadScans(); });
    es.addEventListener("frame", (e) => onFrame(JSON.parse(e.data)));
    es.onerror = () => { const f = document.getElementById("lscFeed"); if (f) { f.textContent = "RECONNECTING"; f.className = "lsc-feed err"; } };
  }
  function setEvery(sec) { if (S.id) fetch(`/api/scanner/stream/${S.id}/every`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ every: sec }) }).catch(() => {}); }

  function onFrame(f) {
    S.lastFrame = Date.now();
    if (f.full) { S.rows.clear(); for (const [s, d] of S.dom) { d.tr.remove(); } S.dom.clear(); S.order = ""; S.events = []; S.visibleList = []; S.evIds.clear(); const fl = document.getElementById("lscFeedList"); if (fl) fl.innerHTML = ""; }
    for (const r of f.rows) {
      const cur = f.delta ? S.rows.get(r.s) : null;
      if (cur) Object.assign(cur, r); else S.rows.set(r.s, r);           // delta frames carry only changed fields
      S.changed.add(r.s); if (r.sec && !S.sectors.has(r.sec)) { S.sectors.add(r.sec); S.secDirty = true; }
    }
    if (f.events && f.events.length) addEvents(f.events, !f.full);
    if (f.status) setStatus(f.status);
    if (f.market) setMarket(f.market);
    if (typeof LSC_HOOKS !== "undefined") LSC_HOOKS.forEach((h) => { try { h(f); } catch { } });
    if (!S.raf) S.raf = requestAnimationFrame(render);
  }

  /* ── render (measured) ── */
  function render() {
    S.raf = 0;
    if (!S.mounted || !visible() || S.paused) return;
    const t0 = performance.now();
    const body = document.getElementById("lscBody");
    applyOrder(body);                             // sort + filter (JS only) → S.visibleList
    windowRows(body);                             // DOM holds only the rows in view
    S.changed.clear();
    if (S.secDirty) fillSectors();
    if (S.dw.s && S.rows.has(S.dw.s)) drawerLive();
    void body.offsetHeight;                      // include style + layout in the measurement (the browser does it before paint anyway)
    const dt = performance.now() - t0, p = S.perf;
    p.last = dt; p.n++; p.avg = p.avg + (dt - p.avg) / Math.min(p.n, 60); p.max = Math.max(p.max * 0.995, dt);
    (p.hist = p.hist || []).push(dt); if (p.hist.length > 600) p.hist.shift();      // diagnostics: last 600 frame times
    if (p.n % 5 === 0) meta();
  }
  function patchRow(s) {
    const r = S.rows.get(s); if (!r) return;
    let d = S.dom.get(s);
    if (!d) {
      const tr = document.createElement("tr"); tr.dataset.s = s;
      tr.innerHTML = COLS.map(([k]) => `<td class="c-${k}"></td>`).join("");
      d = { tr, td: [...tr.children], cache: new Array(COLS.length).fill(null), ltp: null, fl: false };
      d.tdLtp = d.td[COLI.ltp];
      d.td[0].innerHTML = `<b>${esc(s)}</b>${r.fno ? '<span class="fo">F&O</span>' : ""}<small>${esc(r.sec || "")}</small>`;
      S.dom.set(s, d);
    }
    for (let i = 1; i < COLS.length; i++) {
      const out = COLS[i][3](r);
      const key = out.html !== undefined || out.path !== undefined ? out.key : out.t + "|" + (out.c || "") + "|" + (out.bg || "");
      if (d.cache[i] === key) continue;
      d.cache[i] = key;
      const td = d.td[i];
      if (out.path !== undefined) { if (!td.firstChild) td.innerHTML = `<svg class="lsc-spark" width="72" height="20" viewBox="0 0 72 20"><path fill="none" stroke-width="1.3"/></svg>`; const pth = td.firstChild.firstChild; pth.setAttribute("d", out.path[0]); pth.setAttribute("stroke", out.path[1]); }
      else if (out.html !== undefined) td.innerHTML = out.html;
      else { td.textContent = out.t; if (i !== COLI.ltp) td.className = `c-${COLS[i][0]} ${out.c || ""}`; td.style.background = out.bg || ""; }
    }
    d.dirty = false;
    d.tr.classList.toggle("stale", !!r.stale);
    // price flash: alternate two identical animations → restarts without forcing a layout
    if (d.ltp != null && d.ltp !== r.ltp) { d.fl = !d.fl; d.tdLtp.className = "c-ltp " + (d.fl ? "fa" : "fb"); }
    d.ltp = r.ltp;
  }
  function pass(r) {
    const f = S.f;
    if (f.q) { const q = f.q; if (!r.s.includes(q) && !(r.sec || "").toUpperCase().includes(q)) return false; }
    if (f.scan) { const sc = S.scans.find((x) => x.id === f.scan); if (!sc || !(r.tags || []).includes(sc.tag || sc.id)) return false; }
    if (f.dir && (r.bias || 0) !== f.dir) return false;
    if (f.minScore && !(r.score >= f.minScore)) return false;
    if (f.minRvol && !(r.rvol >= f.minRvol)) return false;
    if (f.fno && !r.fno) return false;
    if (f.sec && r.sec !== f.sec) return false;
    if (f.tagged && !liveTags(r).length) return false;
    return true;
  }
  function applyOrder(body) {
    const col = COLS[COLI[S.sort.k]] || COLS[COLI.score], get = col[4], dir = S.sort.d;
    const list = [];
    for (const r of S.rows.values()) if (pass(r)) list.push(r);
    list.sort((a, b) => {
      const x = get(a), y = get(b);
      if (x == null && y == null) return a.s < b.s ? -1 : 1; if (x == null) return 1; if (y == null) return -1;
      if (typeof x === "string") return dir * x.localeCompare(y);
      return x === y ? (a.s < b.s ? -1 : 1) : dir * (x - y);
    });
    S.visibleList = list;
    document.getElementById("lscEmpty").hidden = list.length > 0 || S.rows.size === 0;
    document.getElementById("lscCount").textContent = `${list.length} / ${S.rows.size} symbols`;
  }
  /* virtual scrolling: fixed row height; spacer rows stand in for everything off-screen */
  const ROWH = 32, OVERSCAN = 8;
  function windowRows(body) {
    const tw = document.getElementById("lscTw"), list = S.visibleList || [];
    const view = tw.clientHeight || 600, top = tw.scrollTop;
    const a = Math.max(0, Math.floor(top / ROWH) - OVERSCAN), b = Math.min(list.length, Math.ceil((top + view) / ROWH) + OVERSCAN);
    const want = list.slice(a, b);
    const key = a + ":" + want.map((r) => r.s).join(",") + ":" + list.length;
    for (const r of want) if (S.changed.has(r.s) || !S.dom.has(r.s) || S.dom.get(r.s).dirty) patchRow(r.s);
    for (const s of S.changed) { const d = S.dom.get(s); if (d && !d.tr.isConnected) d.dirty = true; }   // patch later, when scrolled in
    if (key === S.order) return;
    S.order = key;
    if (!S.spTop) { S.spTop = document.createElement("tr"); S.spTop.className = "lsc-spacer"; S.spBot = document.createElement("tr"); S.spBot.className = "lsc-spacer"; }
    S.spTop.style.height = a * ROWH + "px"; S.spBot.style.height = (list.length - b) * ROWH + "px";
    const frag = document.createDocumentFragment(); frag.appendChild(S.spTop);
    for (const r of want) { const d = S.dom.get(r.s); d.tr.classList.toggle("sel", r.s === S.sel); frag.appendChild(d.tr); }
    frag.appendChild(S.spBot);
    body.replaceChildren(frag);
  }
  function resort() { S.order = ""; for (const th of document.querySelectorAll("#lscT th")) { th.classList.toggle("srt", th.dataset.k === S.sort.k); th.classList.toggle("asc", th.dataset.k === S.sort.k && S.sort.d > 0); } if (!S.raf) S.raf = requestAnimationFrame(render); }

  /* ── status strip ── */
  function setStatus(st) {
    S.status = st; if (!st || !st.feed) return;
    const f = st.feed, el = document.getElementById("lscFeed"); if (!el) return;
    const ok = f.state === "live";
    const closedTxt = st.market && st.market.reason === "holiday" ? "HOLIDAY · NO SESSION" : st.market && st.market.reason === "weekend" ? "WEEKEND · NO SESSION" : "MARKET CLOSED";
    el.textContent = ok ? (st.marketOpen ? "LIVE" : closedTxt) : f.state === "error" ? "PRICES UNAVAILABLE" : "CONNECTING";
    el.className = "lsc-feed " + (f.state === "error" ? "err" : ok && st.marketOpen ? "live" : "");
    el.title = `Yahoo Finance stream · ${st.universe ? st.universe.n + " NSE stocks · " + st.universe.source : ""}`;
    const w = [], mk = st.market;
    if (f.state === "error") w.push(`<div class="lsc-warn bad">Live prices are unavailable right now (${esc(f.message || "stream error")}). The table keeps the last prices it received and reconnects on its own.</div>`);
    if (mk && !mk.open) w.push(`<div class="lsc-warn${mk.reason === "holiday" || mk.reason === "weekend" ? " strong" : ""}"><b>${mk.reason === "holiday" || mk.reason === "weekend" ? "No trading session today." : "Market closed."}</b> ${esc(mk.text)} Signals resume with live ticks at 09:15 IST on the next trading day.</div>`);
    else if (!mk && !st.marketOpen) w.push(`<div class="lsc-warn">NSE is closed. The table shows the last session <b>as of close</b>; signals resume with live ticks at 09:15 IST.</div>`);
    document.getElementById("lscWarn").innerHTML = w.join("");
  }
  function setMarket(m) {
    S.market = m;
    const idx = m.idx || {}, el = document.getElementById("lscIdx"); if (!el) return;
    const one = (k, lbl) => idx[k] ? `<span>${lbl}<b>${N(idx[k].ltp)}</b><em class="${cls(idx[k].pct)}">${P(idx[k].pct)}</em></span>` : "";
    const tot = (m.adv + m.dec + m.unch) || 1;
    el.innerHTML = one("NIFTY", "NIFTY") + one("BANKNIFTY", "BANK") + (idx.INDIAVIX ? `<span>VIX<b>${N(idx.INDIAVIX.ltp)}</b></span>` : "") +
      `<span title="Advancers / decliners in the universe">A/D <b>${m.adv}/${m.dec}</b><span class="lsc-ad"><i class="a" style="width:${(m.adv / tot) * 100}%"></i><i class="d" style="width:${(m.dec / tot) * 100}%"></i></span></span>`;
    // scan counts
    const counts = m.tagCounts || {};
    for (const b of document.querySelectorAll("#lscScans [data-scan]")) {
      const sc = S.scans.find((x) => x.id === b.dataset.scan); if (!sc) continue;
      const c = counts[sc.tag || sc.id] || 0, e = b.querySelector(".lsc-sc-c");
      if (e && e.textContent !== String(c)) { e.textContent = c; e.classList.toggle("z", !c); }
    }
  }
  function meta() {
    const el = document.getElementById("lscMeta"); if (!el || !S.status) return;
    const m = S.status.metrics || {}, w = S.market && S.market.warm;
    el.textContent = `${S.rows.size} stocks · ${m.tickRate ?? 0} ticks/s · updates every ${(window.REFRESH && REFRESH.sec) || 5}s${w && !w.finished ? ` · loading history ${w.done}/${w.total}` : ""}${S.paused ? " · PAUSED (space)" : ""}`;
    el.title = `engine ${m.computeMs ?? "—"} ms · render ${S.perf.last.toFixed(1)} ms (avg ${S.perf.avg.toFixed(1)})${w && !w.finished ? " · relative volume, breakouts and squeezes fill in as each stock's history loads" : ""}`;
  }
  function fillSectors() {
    S.secDirty = false; const sel = document.getElementById("lscSec"); if (!sel) return; const cur = sel.value;
    sel.innerHTML = `<option value="">All sectors</option>` + [...S.sectors].sort().map((s) => `<option>${esc(s)}</option>`).join(""); sel.value = cur;
  }

  /* ── signal feed + log ── */
  function evHtml(e, fresh) {
    const b = e.bias > 0 ? "b" : e.bias < 0 ? "s" : "n";
    return `<div class="lsc-ev${fresh ? " new" : ""}" data-open="${esc(e.s)}"><div class="lsc-ev-h"><time>${hhmmss(e.ts)}</time><b>${esc(e.s)}</b><span class="lsc-tag ${b}">${esc(e.tag || e.scan)}</span><span class="sp"></span><span class="${cls(e.pct)}">${P(e.pct)}</span></div>
      <div class="lsc-ev-m">${(e.met || []).slice(0, 4).map((m) => `<div>${esc(m)}</div>`).join("")}</div>
      <div class="lsc-ev-f"><span>${esc(e.name)} · score ${e.score ?? "—"}</span>${spark(e.spark, 90, 18)}</div></div>`;
  }
  function addEvents(evs, fresh) {
    const add = evs.filter((e) => !S.evIds.has(e.id) && !S.off.has(e.scan));
    for (const e of add) { S.evIds.add(e.id); S.events.push(e); }
    if (S.events.length > 500) { for (const e of S.events.splice(0, S.events.length - 500)) S.evIds.delete(e.id); }
    const fl = document.getElementById("lscFeedList"); if (!fl || !add.length) return;
    if (fl.querySelector(".lsc-empty")) fl.innerHTML = "";
    fl.insertAdjacentHTML("afterbegin", add.slice().reverse().map((e) => evHtml(e, fresh)).join(""));
    while (fl.children.length > 150) fl.lastElementChild.remove();
    document.getElementById("lscEvN").textContent = `${S.events.length} today`;
  }
  /* ── scans panel ── */
  async function loadScans() {
    try { const j = await api("/api/scanner/scans"); S.scans = j.scans || []; } catch { S.scans = []; }
    const el = document.getElementById("lscScans"); if (!el) return;
    const row = (s) => `<div class="lsc-sc${S.f.scan === s.id ? " on" : ""}${S.off.has(s.id) ? " off" : ""}" data-scan="${esc(s.id)}" title="Click to filter the table to this scan">
      <input type="checkbox" data-en ${S.off.has(s.id) ? "" : "checked"} title="Show / hide this scan's signals (this browser only)">
      <span class="lsc-sc-n"><i class="lsc-bias ${s.bias > 0 ? "up" : s.bias < 0 ? "down" : ""}">${s.bias > 0 ? "▲" : s.bias < 0 ? "▼" : "◆"}</i>${esc(s.name)}</span><span class="lsc-sc-c${s.matches ? "" : " z"}">${s.matches || 0}</span>
      <button class="lsc-i" data-info type="button" title="What this scan means" aria-label="What ${esc(s.name)} means">i</button></div>`;
    const grp = (lbl, list) => list.length ? `<div class="lsc-sc-grp">${lbl}</div>${list.map(row).join("")}` : "";
    el.innerHTML = grp("BULLISH", S.scans.filter((s) => s.bias > 0)) + grp("BEARISH", S.scans.filter((s) => s.bias < 0)) + grp("NEUTRAL · EITHER WAY", S.scans.filter((s) => !s.bias));
    document.getElementById("lscScanN").textContent = `${S.scans.filter((s) => !S.off.has(s.id)).length} of ${S.scans.length} shown`;
    scanChip();
  }
  function scanChip() {
    const sc = S.f.scan && S.scans.find((x) => x.id === S.f.scan);
    document.getElementById("lscScanChip").innerHTML = sc ? `<span class="lsc-chip">${esc(sc.name)}<button data-clear-scan title="Clear">×</button></span>` : "";
  }
  /* ── scan explanations (ⓘ) ── */
  const SCAN_INFO = {
    vol_breakout: ["Price pushes through a level traders watch (the 20-day high, the first 15 minutes' high, or the 52-week high) while volume runs at least twice its normal pace for this time of day.", "Volume shows real participation behind the move, so the breakout is less likely to fail than one on thin trade.", "Breakouts late in the day or on news can reverse; check the chart and the broader market before acting."],
    vol_breakdown: ["The mirror image of a volume breakout: price falls through the 20-day low, the opening-range low or the 52-week low on at least twice the usual volume.", "Heavy selling through support often means larger holders are exiting.", "Sharp breakdowns can snap back if the market turns; a close below the level is stronger evidence than an intraday dip."],
    squeeze_release: ["Volatility had compressed (Bollinger Bands inside Keltner Channels on 1-minute bars) and has just expanded, with a jump in volume.", "Quiet periods are often followed by strong moves; the release marks the start of that expansion.", "The first move after a squeeze can be a fake-out; the direction is shown by ▲/▼ in the SQZ column."],
    squeeze_building: ["Volatility has been compressed for at least 20 one-minute bars (Bollinger Bands inside Keltner Channels).", "A watch-list scan: these stocks are coiling and may break out either way.", "Coils can last a long time and resolve in either direction; this is not a directional signal."],
    gap_and_go: ["The stock opened at least 1% above yesterday's close, has broken above its opening range, trades above VWAP, and volume is 1.5× normal.", "A gap that keeps going after the open shows buyers defending the higher price instead of selling into it.", "Gaps on results or news can fade later in the session; watch VWAP as the line in the sand."],
    gap_down_go: ["The stock opened at least 1% below yesterday's close, has broken below its opening range, trades below VWAP, with 1.5× normal volume.", "Sellers are pressing the gap instead of buyers filling it.", "Oversold gaps can bounce sharply, especially in a rising market."],
    gap_fill: ["A large gap (1.5% or more) is reversing: a gap-up now trades below VWAP and is falling, or a gap-down trades above VWAP and is rising.", "Gaps that fail often travel back toward the previous close (\"filling\" the gap).", "Neutral by design: the scan flags the reversal, not a trade direction."],
    rs_leaders: ["The stock is beating NIFTY by at least 1.5 percentage points and its own sector by 0.75 points, while holding above VWAP and rising over 15 minutes.", "Relative strength shows where money is rotating to; leaders on strong days often lead on the next.", "Strength can reverse quickly if the whole sector turns."],
    rs_laggards: ["The stock trails NIFTY by at least 1.5 points and its sector by 0.75 points, below VWAP and falling over 15 minutes.", "Persistent relative weakness often signals stock-specific selling.", "Laggards can mean-revert on a bounce day."],
    momentum_burst: ["A move of 0.5% or more within a single minute with at least three times that minute's usual volume, in either direction.", "Flags sudden activity: block trades, news or an aggressive buyer or seller.", "Bursts are noisy; many fade within minutes."],
    hi52: ["A new 52-week high with at least 1.5× normal volume.", "Stocks at yearly highs have no overhead sellers left from the past year; momentum investors watch them closely.", "New highs in a weak market or on low volume are less reliable."],
    lo52: ["A new 52-week low with at least 1.5× normal volume.", "Shows sustained selling pressure; useful as a warning list for holders.", "Very oversold names can rebound sharply."],
    near_high: ["The stock trades within 1% below its 20-day high, on above-normal volume, while its daily range is narrow (less than 0.8× its average true range).", "Tight trading just under resistance often comes before a breakout.", "Resistance can hold; this is a set-up to watch, not a breakout yet."],
    vwap_reclaim: ["Price has just crossed back above the day's volume-weighted average price, on 1.5× normal volume.", "VWAP is the average price paid today; reclaiming it means buyers have regained control of the session.", "In choppy markets price can cross VWAP many times; volume is the filter."],
    range_expansion: ["Today's high-low range is already at least 1.5× the stock's average daily range (ATR), on 1.5× normal volume.", "Unusually wide days often mark the start of a new trend or a reaction to news.", "Direction is not part of the rule; check % change and VWAP."],
  };
  const OPTXT = { ">": ">", ">=": "≥", "<": "<", "<=": "≤", "==": "=", "!=": "≠", between: "between", crossAbove: "crosses above", crossBelow: "crosses below" };
  const UNIT = { pct: "%", m1: "%", m5: "%", m15: "%", vwapD: "%", gap: "%", distN: "%", atrPct: "%", rvol: "×", vspike: "×", rangeAtr: "×", rsN: " pp", rsS: " pp", sqzBars: " bars" };
  function ruleText(n) {
    if (!n) return "";
    if (n.rules) return n.rules.map((x) => (x.rules ? "(" + ruleText(x) + ")" : ruleText(x))).join(n.op === "OR" ? " <b>or</b> " : " <b>and</b> ");
    const f = (S.fields.find((x) => x.key === n.field) || {}).label || n.field;
    // enum labels carry their codes, e.g. "N-day breakout (1 above high · -1 below low)": say the word, not the number
    const m = /^(.*?)\s*\(([^()]*-?\d[^()]*)\)$/.exec(f.replace(/−/g, "-"));
    if (m &&(n.op === "==" || n.op === "!=") && typeof n.value === "number") {
      const hit = m[2].split("·").map((x) => x.trim().match(/^(-?\d+)\s+(.+)$/)).find((x) => x && +x[1] === n.value);
      if (hit) return `${esc(m[1])} ${n.op === "!=" ? "not " : ""}${esc(hit[2])}`;
      if (n.value === 0 && n.op === "!=") return `${esc(m[1])} (either direction)`;
    }
    if (typeof n.value === "boolean" && n.op === "==") return `${esc(f)}${n.value ? "" : " is off"}`;
    const v =Array.isArray(n.value) ? n.value.join(" and ") : typeof n.value === "string" && n.value.startsWith("@") ? ((S.fields.find((x) => x.key === n.value.slice(1)) || {}).label || n.value.slice(1)) : n.value;
    const unit = typeof v === "number" ? (UNIT[n.field] || "") : "";
    return `${esc(f)} ${OPTXT[n.op] || esc(n.op)} ${esc(String(v))}${unit}`;
  }
  function scanInfo(id, anchor) {
    const sc = S.scans.find((x) => x.id === id); if (!sc) return;
    const [what, why, care] = SCAN_INFO[id] || [sc.name, "", ""];
    const html = `<p>${esc(what)}</p>${why ? `<p><b>Why it matters.</b> ${esc(why)}</p>` : ""}${care ? `<p><b>Keep in mind.</b> ${esc(care)}</p>` : ""}
      <div class="mt-info-rule"><span>EXACT RULE</span>${ruleText(sc.logic) || "—"}</div>
      <p class="ws-dim">Bias: ${sc.bias > 0 ? "bullish ▲" : sc.bias < 0 ? "bearish ▼" : "neutral (either direction)"} · tag ${esc(sc.tag || sc.id)} · fires at most once per stock every ${Math.round((sc.cooldownSec || 900) / 60)} min. A scan describes what is happening; it is not a recommendation.</p>`;
    if (window.MT_INFO) MT_INFO.open(anchor, sc.name, html);
  }

  /* ── detail drawer ── */
  function openDrawer(s) {
    if (!S.rows.has(s)) return;
    S.sel = s; S.dw.s = s; S.dw.bars = null; S.dw.barsAt = 0;
    for (const [k, d] of S.dom) d.tr.classList.toggle("sel", k === s);
    let dw = document.getElementById("lscDw");
    if (!dw) {
      dw = document.createElement("aside"); dw.id = "lscDw"; dw.className = "lsc-dw"; document.body.appendChild(dw);
      const veil = document.createElement("div"); veil.id = "lscVeil"; veil.className = "lsc-veil"; document.body.appendChild(veil);
      veil.addEventListener("click", closeDrawer);
      dw.addEventListener("click", (e) => { if (e.target.closest("[data-dwx]")) closeDrawer(); const b = e.target.closest("[data-dwt]"); if (b) { S.dw.tab = b.dataset.dwt; drawDrawer(); } if (e.target.closest("#dwFull") && S.dw.s && typeof LSC_CHART !== "undefined") LSC_CHART.open(S.dw.s);
        const go = e.target.closest("[data-dwgo]");
        if (go && S.dw.s) { const sym = S.dw.s; if (go.dataset.dwgo === "chart") { if (typeof LSC_CHART !== "undefined") LSC_CHART.open(sym); } else { closeDrawer(); if (typeof loadCompany === "function") loadCompany(sym + ".NS"); } }
        const pr = e.target.closest("[data-peer]"); if (pr && pr.dataset.peer !== S.dw.s) openDrawer(pr.dataset.peer);
        const si = e.target.closest("[data-sinfo]"); if (si) scanInfo(si.dataset.sinfo, si); });
      dw.addEventListener("dblclick", (e) => { if (e.target.closest("#dwChart") && S.dw.s && typeof LSC_CHART !== "undefined") LSC_CHART.open(S.dw.s); });
    }
    drawDrawer(); dw.classList.add("open"); document.getElementById("lscVeil").classList.add("open");
  }
  function closeDrawer() { const dw = document.getElementById("lscDw"); if (dw) dw.classList.remove("open"); const v = document.getElementById("lscVeil"); if (v) v.classList.remove("open"); S.dw.s = null; }
  const DW_TABS = [["overview", "Overview"], ["chart", "Chart"], ["ind", "Indicators"], ["events", "Events"]];
  function drawDrawer() {
    const r = S.rows.get(S.dw.s); if (!r) return;
    const tabs = DW_TABS;
    document.getElementById("lscDw").innerHTML = `<div class="lsc-dw-h"><div><h2>${esc(r.s)}</h2><div class="sub">${r.name ? esc(r.name) + " · " : ""}${esc(r.sec || "")}${r.fno ? " · F&O" : ""}</div></div>
      <div class="px"><b id="dwLtp">${N(r.ltp)}</b><span id="dwPct" class="${cls(r.pct)}">${P(r.pct)}</span></div><button class="lsc-dw-x" data-dwx title="Close (Esc)">✕</button></div>
      <div class="lsc-dw-tabs">${tabs.map(([k, l]) => `<button data-dwt="${k}" class="${S.dw.tab === k ? "on" : ""}">${l}</button>`).join("")}</div>
      <div class="lsc-dw-b" id="dwBody"></div>
      <div class="lsc-dw-foot"><button class="mini-btn" data-dwgo="research" type="button">Open in Company Analysis →</button><button class="mini-btn" data-dwgo="chart" type="button">⛶ Live pattern chart</button></div>`;
    drawerBody();
  }
  function drawerBody() {
    const r = S.rows.get(S.dw.s), el = document.getElementById("dwBody"); if (!r || !el) return;
    const t = S.dw.tab;
    if (t === "overview") { el.innerHTML = overview(r); loadDetail(r.s); }
    else if (t === "chart") {
      el.innerHTML = `<div class="lsc-fsrow"><button class="mini-btn" id="dwFull" type="button" title="Full-screen chart with live candlestick pattern recognition (key g)">⛶ Full screen · live patterns</button></div><canvas class="lsc-chart" id="dwChart" title="Double-click for the full-screen live pattern chart"></canvas><div class="lsc-legend"><span><i style="background:var(--amber-bright)"></i>VWAP</span><span><i style="background:#6b7280"></i>Opening range</span><span><i style="background:var(--up)"></i>N-day high</span><span><i style="background:#8a93a0;opacity:.5"></i>Prev close</span></div>
        <div class="lsc-kv">${kv(r).slice(0, 9).join("")}</div>`;
      loadBars(true);
    } else if (t === "ind") {
      el.innerHTML = `<div class="lsc-kv">${kv(r).join("")}</div><div class="lsc-note">Relative volume divides today's cumulative volume by the average cumulative volume at the same minute over the previous ${r.prof === "approx" ? "(approximate U-shaped profile: no minute history)" : r.prof + " sessions"}. Squeeze = Bollinger(20, 2) inside Keltner(20, 1.5×ATR) on 1-minute bars.</div>`;
    } else if (t === "events") {
      const evs = S.events.filter((e) => e.s === r.s).slice().reverse();
      el.innerHTML = evs.length ? evs.map((e) => evHtml(e, false)).join("") : `<div class="lsc-empty">No signals for ${esc(r.s)} yet today.</div>`;
    }
  }
  /* range bar: where a price sits between low and high */
  function rangeBar(lo, hi, v, lbl) {
    if (![lo, hi, v].every(Number.isFinite) || hi <= lo) return "";
    const p = Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
    return `<div class="lsc-rng"><div class="lsc-rng-h"><span>${lbl}</span><b>${p.toFixed(0)}% of range</b></div><div class="lsc-rng-t"><i style="left:${p}%"></i></div><div class="lsc-rng-l"><span>${N(lo)}</span><span>${N(hi)}</span></div></div>`;
  }
  function overview(r) {
    const tags = liveTags(r), sc = (t) => S.scans.find((x) => (x.tag || x.id) === t);
    const peers = [...S.rows.values()].filter((x) => x.sec && x.sec === r.sec && x.pct != null).sort((a, b) => b.pct - a.pct);
    const rank = peers.findIndex((x) => x.s === r.s) + 1;
    const secAvg = peers.length ? peers.reduce((a, x) => a + x.pct, 0) / peers.length : null;
    const show = peers.length > 9 ? [...new Set([...peers.slice(0, 4), r, ...peers.slice(-3)])] : peers;
    const verdict = [];
    if (r.pct != null) verdict.push(`${r.pct >= 0 ? "Up" : "Down"} <b class="${cls(r.pct)}">${P(r.pct)}</b> today${secAvg != null ? `, ${r.pct - secAvg >= 0 ? "ahead of" : "behind"} its sector (${P(secAvg)} average)` : ""}.`);
    if (r.vwapD != null) verdict.push(`Trading ${r.vwapD >= 0 ? "above" : "below"} VWAP (${P(r.vwapD)}): ${r.vwapD >= 0 ? "buyers" : "sellers"} have the upper hand on the session.`);
    if (r.rvol != null) verdict.push(r.rvol >= 2 ? `Volume is heavy: ${X(r.rvol, 1)} the normal pace for this time of day.` : r.rvol < 0.7 ? `Volume is light (${X(r.rvol, 1)} normal), so moves carry less conviction.` : `Volume is about normal (${X(r.rvol, 1)}).`);
    if (r.brk52) verdict.push(`At a new 52-week ${r.brk52 > 0 ? "high" : "low"}.`); else if (r.brkN) verdict.push(`Through its 20-day ${r.brkN > 0 ? "high" : "low"}.`);
    return `<div class="lsc-ov">
      <div class="lsc-ov-sum">${verdict.join(" ") || "Waiting for today's first trades."}</div>
      <div class="lsc-ov-g">${rangeBar(r.l, r.h, r.ltp, "Day range")}${rangeBar(r.lo52, r.hi52, r.ltp, "52-week range")}</div>
      <div class="lsc-kv">${kv(r).slice(0, 6).join("")}</div>
      <h4>SIGNALS NOW</h4>${tags.length ? `<div class="lsc-ov-sig">${tags.map((t) => { const x = sc(t); return `<div><span class="lsc-tag ${tagCls(t)}">${esc(t)}</span> ${esc(x ? x.name : t)}${x ? ` <button class="lsc-i" data-sinfo="${esc(x.id)}" type="button" title="What this scan means">i</button>` : ""}</div>`; }).join("")}</div>` : `<div class="ws-dim ec-small">No scan matches right now.</div>`}
      <h4>SECTOR PEERS · ${esc(r.sec || "—")}${rank ? ` <span class="ws-dim">rank ${rank} of ${peers.length} today</span>` : ""}</h4>
      <div class="lsc-peers">${show.map((x) => `<div class="${x.s === r.s ? "me" : ""}" data-peer="${esc(x.s)}"><b>${esc(x.s)}</b><span>${N(x.ltp)}</span><span class="${cls(x.pct)}">${P(x.pct)}</span><span>${X(x.rvol, 1)}</span></div>`).join("") || `<div class="ws-dim ec-small">No peers in the universe.</div>`}</div>
      <div id="dwDetail"></div></div>`;
  }
  async function loadDetail(sym) {
    try {
      const d = await api("/api/scanner/detail/" + encodeURIComponent(sym));
      const el = document.getElementById("dwDetail"); if (!el || S.dw.s !== sym || S.dw.tab !== "overview") return;
      const b = d.base || {}, sq = d.squeeze || {};
      const K = (l, v) => `<div><span>${l}</span><b>${v}</b></div>`;
      el.innerHTML = `<h4>HISTORY BEHIND THE SIGNALS</h4><div class="lsc-kv">${[
        K("Avg daily volume (20d)", VOL(b.avgVol20)), K("Daily ATR", b.atrD ? N(b.atrD) + (b.atrPct ? ` (${b.atrPct.toFixed(1)}%)` : "") : "—"), K("20-day high / low", `${N(b.hiN)} / ${N(b.loN)}`),
        K("Volume profile", d.profileDays ? d.profileDays + " sessions" : "approximate"), K("Squeeze", sq.on ? `on · ${sq.bars} bars` : sq.lastFireAt ? "released at " + hhmmss(sq.lastFireAt).slice(0, 5) : "off"), K("Signals today", (d.events || []).length),
      ].join("")}</div>`;
    } catch { }
  }
  function kv(r) {
    const K = (l, v, c = "") => `<div><span>${l}</span><b class="${c}">${v}</b></div>`;
    return [K("Open", N(r.o)), K("High", N(r.h)), K("Low", N(r.l)), K("Prev close", N(r.pc)), K("VWAP", N(r.vwap) + ` <small class="${cls(r.vwapD)}">${P(r.vwapD)}</small>`), K("Volume", VOL(r.vol)),
      K("Rel. volume", X(r.rvol, 2)), K("1-min spike", X(r.vspike, 1)), K("Gap", P(r.gap), cls(r.gap)), K("M1 / M5 / M15", `${P(r.m1)} / ${P(r.m5)} / ${P(r.m15)}`), K("ORB high / low", `${N(r.orbH)} / ${N(r.orbL)}`), K("ORB state", r.orb > 0 ? "above ▲" : r.orb < 0 ? "below ▼" : "inside", cls(r.orb)),
      K("20-day high", N(r.hiN) + (r.distN != null ? ` <small>${P(r.distN)}</small>` : "")), K("52-wk high / low", `${N(r.hi52)} / ${N(r.lo52)}`), K("Daily ATR", r.atrPct == null ? "—" : r.atrPct.toFixed(2) + "%"),
      K("Range ÷ ATR", X(r.rangeAtr, 2)), K("Squeeze", r.sqzFire ? (r.sqzFire > 0 ? "released ▲" : "released ▼") : r.sqz ? `on · ${r.sqzBars} bars` : "off", r.sqzFire ? cls(r.sqzFire) : ""), K("New highs / lows", `${r.nh} / ${r.nl}`),
      K("RS vs NIFTY", r.rsN == null ? "—" : r.rsN.toFixed(2) + " pp", cls(r.rsN)), K("RS vs sector", r.rsS == null ? "—" : r.rsS.toFixed(2) + " pp", cls(r.rsS)),
      K("Bid / Ask", `${N(r.bid)} / ${N(r.ask)}`), K("Score", `${r.score ?? "—"} ${r.bias > 0 ? "▲" : r.bias < 0 ? "▼" : ""}`, cls(r.bias)), K("Signals", liveTags(r).map(esc).join(" · ") || "—")];
  }
  async function loadBars(force) {
    const s = S.dw.s; if (!s) return;
    if (!force && Date.now() - S.dw.barsAt < 5000) return;
    S.dw.barsAt = Date.now();
    try { const j = await api("/api/scanner/bars/" + encodeURIComponent(s)); if (S.dw.s === s) { S.dw.bars = j.bars; drawChart(); } } catch { }
  }
  function drawerLive() {
    const r = S.rows.get(S.dw.s); const l = document.getElementById("dwLtp"), p = document.getElementById("dwPct");
    if (l) l.textContent = N(r.ltp); if (p) { p.textContent = P(r.pct); p.className = cls(r.pct); }
    if (S.dw.tab === "overview" && (!S.dw.ovAt || Date.now() - S.dw.ovAt > 3000)) { S.dw.ovAt = Date.now(); const y = document.getElementById("dwBody"); const top = y ? y.scrollTop : 0; const det = document.getElementById("dwDetail"); const keep = det ? det.innerHTML : ""; if (y) { y.innerHTML = overview(r); const d2 = document.getElementById("dwDetail"); if (d2) d2.innerHTML = keep; y.scrollTop = top; } }
    if (S.dw.tab === "chart") { if (S.dw.bars && S.dw.bars.length) { const b = S.dw.bars[S.dw.bars.length - 1]; b.c = r.ltp; b.h = Math.max(b.h, r.ltp); b.l = Math.min(b.l, r.ltp); } drawChart(); loadBars(false); }
  }
  function drawChart() {
    const cv = document.getElementById("dwChart"), r = S.rows.get(S.dw.s), bars = S.dw.bars; if (!cv || !r || !bars || !bars.length) return;
    const dpr = devicePixelRatio || 1, W = (cv.width = cv.offsetWidth * dpr), H = (cv.height = cv.offsetHeight * dpr), ctx = cv.getContext("2d");
    const padR = 58 * dpr, padT = 8 * dpr, volH = H * 0.2, ph = H - volH - padT - 14 * dpr;
    const levels = [r.orbH, r.orbL, r.pc].filter(Number.isFinite);
    const hiN = Number.isFinite(r.hiN) ? r.hiN : null;
    let mn = Math.min(...bars.map((b) => b.l), ...levels), mx = Math.max(...bars.map((b) => b.h), ...levels);
    if (hiN && hiN < mx * 1.03) mx = Math.max(mx, hiN);
    const pad = (mx - mn) * 0.04 || 1; mn -= pad; mx += pad;
    const n = Math.max(bars.length, 60), bw = (W - padR) / n;
    const Y = (v) => padT + (1 - (v - mn) / (mx - mn)) * ph;
    ctx.clearRect(0, 0, W, H);
    ctx.font = `${10 * dpr}px Inter, sans-serif`; ctx.fillStyle = "#6b7280"; ctx.strokeStyle = "rgba(35,42,51,.9)"; ctx.lineWidth = 1;
    for (let k = 0; k <= 4; k++) { const v = mn + ((mx - mn) * k) / 4, y = Y(v); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W - padR, y); ctx.stroke(); ctx.fillText(v.toFixed(v < 100 ? 2 : 1), W - padR + 6 * dpr, y + 3 * dpr); }
    const hl = (v, col, dash) => { if (!Number.isFinite(v) || v < mn || v > mx) return; ctx.save(); ctx.strokeStyle = col; ctx.setLineDash(dash ? [4 * dpr, 4 * dpr] : []); ctx.beginPath(); ctx.moveTo(0, Y(v)); ctx.lineTo(W - padR, Y(v)); ctx.stroke(); ctx.restore(); };
    hl(r.pc, "rgba(138,147,160,.45)", true); hl(r.orbH, "#6b7280", true); hl(r.orbL, "#6b7280", true); if (hiN) hl(hiN, "rgba(46,158,107,.8)", true);
    const vmax = Math.max(...bars.map((b) => b.v || 0), 1);
    let pv = 0, vv = 0; const vw = [];
    bars.forEach((b, i) => {
      const x = i * bw + bw / 2, up = b.c >= b.o, col = up ? "#2e9e6b" : "#c84b3c";
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, Y(b.h)); ctx.lineTo(x, Y(b.l)); ctx.stroke();
      const y1 = Y(Math.max(b.o, b.c)), y2 = Y(Math.min(b.o, b.c)); ctx.fillRect(x - Math.max(1, bw * 0.35), y1, Math.max(1, bw * 0.7), Math.max(1, y2 - y1));
      const vh = ((b.v || 0) / vmax) * (volH - 4 * dpr); ctx.globalAlpha = 0.45; ctx.fillRect(x - Math.max(1, bw * 0.35), H - vh - 12 * dpr, Math.max(1, bw * 0.7), vh); ctx.globalAlpha = 1;
      pv += ((b.h + b.l + b.c) / 3) * (b.v || 0); vv += b.v || 0; vw.push(vv ? pv / vv : null);
    });
    ctx.strokeStyle = "#e8a33d"; ctx.lineWidth = 1.4 * dpr; ctx.beginPath(); let st = false;
    vw.forEach((v, i) => { if (v == null) return; const x = i * bw + bw / 2; st ? ctx.lineTo(x, Y(v)) : ctx.moveTo(x, Y(v)); st = true; }); ctx.stroke();
    const y = Y(r.ltp); ctx.fillStyle = r.pct >= 0 ? "#2e9e6b" : "#c84b3c"; ctx.fillRect(W - padR + 2 * dpr, y - 8 * dpr, padR - 4 * dpr, 16 * dpr); ctx.fillStyle = "#0a0c10"; ctx.fillText(N(r.ltp), W - padR + 6 * dpr, y + 4 * dpr);
    ctx.fillStyle = "#6b7280"; [0, Math.floor(bars.length / 2), bars.length - 1].forEach((i) => { if (bars[i]) ctx.fillText(hhmmss(bars[i].t).slice(0, 5), Math.min(i * bw, W - padR - 30 * dpr), H - 1 * dpr); });
  }

  /* ── toasts ── */
  function toast(msg, kind = "", onClick) {
    let box = document.getElementById("lscToasts"); if (!box) { box = document.createElement("div"); box.id = "lscToasts"; box.className = "lsc-toasts"; document.body.appendChild(box); }
    const t = document.createElement("div"); t.className = "lsc-toast " + kind; t.innerHTML = msg; box.appendChild(t);
    t.addEventListener("click", () => { if (onClick) onClick(); t.remove(); });
    setTimeout(() => t.remove(), 7000);
    while (box.children.length > 5) box.firstElementChild.remove();
  }

  /* ── keyboard ── */
  function help() {
    const keys = [["j / ↓", "next row"], ["k / ↑", "previous row"], ["Enter / o", "open detail drawer"], ["g", "full-screen live pattern chart"], ["Esc", "close drawer / dialog"], ["f", "filter box"], ["space", "pause / resume live updates"], ["b / n / a", "bull / bear / all"], ["s", "cycle sort: score → %chg → rvol → m5"], ["[ / ]", "previous / next scan filter"], ["c", "clear filters"], ["1 – 3", "Scanner · Top 5 Now · Sector Rotation"], ["?", "this help"]];
    let m = document.getElementById("lscHelp");
    if (!m) { m = document.createElement("div"); m.id = "lscHelp"; m.className = "lsc-modal"; document.body.appendChild(m); m.addEventListener("click", (e) => { if (e.target === m || e.target.closest("[data-close]")) m.classList.remove("open"); }); }
    m.innerHTML = `<div class="lsc-mbox" style="width:min(460px,94vw)"><div class="panel-h"><h3>KEYBOARD SHORTCUTS</h3><button class="lsc-dw-x" data-close>✕</button></div><div class="lsc-mb"><div class="lsc-help">${keys.map(([k, d]) => `<kbd>${k}</kbd><span>${d}</span>`).join("")}</div></div></div>`;
    m.classList.add("open");
  }
  function onKey(e) {
    if (!visible() || e.ctrlKey || e.metaKey || e.altKey) return;
    const modal = document.querySelector(".lsc-modal.open");
    if (e.key === "Escape") { if (modal) modal.classList.remove("open"); else closeDrawer(); return; }
    if (modal || e.target.closest("input,textarea,select,[contenteditable]")) return;
    const list = S.visibleList || [], i = list.findIndex((r) => r.s === S.sel);
    const move = (d) => { const n = list[Math.max(0, Math.min(list.length - 1, (i < 0 ? -1 : i) + d))]; if (!n) return; S.sel = n.s; for (const [k, x] of S.dom) x.tr.classList.toggle("sel", k === n.s); const tw = document.getElementById("lscTw"), idx = list.indexOf(n), y = idx * ROWH; if (y < tw.scrollTop + 30) tw.scrollTop = Math.max(0, y - 30); else if (y > tw.scrollTop + tw.clientHeight - 2 * ROWH) tw.scrollTop = y - tw.clientHeight + 2 * ROWH; if (!S.raf) S.raf = requestAnimationFrame(render); if (S.dw.s) openDrawer(n.s); };
    const k = e.key;
    if (k === "j" || k === "ArrowDown") { e.preventDefault(); move(1); }
    else if (k === "k" || k === "ArrowUp") { e.preventDefault(); move(-1); }
    else if ((k === "Enter" || k === "o") && S.sel) openDrawer(S.sel);
    else if (k === "g" && (S.sel || S.dw.s) && typeof LSC_CHART !== "undefined") LSC_CHART.open(S.dw.s || S.sel);
    else if (k === "f") { e.preventDefault(); document.getElementById("lscQ").focus(); }
    else if (k === " ") { e.preventDefault(); S.paused = !S.paused; meta(); if (!S.paused && !S.raf) S.raf = requestAnimationFrame(render); }
    else if (k === "b" || k === "n" || k === "a") setDir(k === "b" ? 1 : k === "n" ? -1 : 0);
    else if (k === "s") { const cyc = ["score", "pct", "rvol", "m5"]; S.sort = { k: cyc[(cyc.indexOf(S.sort.k) + 1) % cyc.length], d: -1 }; resort(); }
    else if (k === "c") clearFilters();
    else if (k === "[" || k === "]") { const cyc = [null, ...S.scans.filter((x) => !S.off.has(x.id)).map((x) => x.id)]; const j = cyc.indexOf(S.f.scan); S.f.scan = cyc[(j + (k === "]" ? 1 : -1) + cyc.length) % cyc.length]; loadScans(); resort(); }
    else if (/^[1-3]$/.test(k)) { const b = document.querySelectorAll("#lscNav button")[+k - 1]; if (b) b.click(); }
    else if (k === "?") help();
  }
  function setDir(d) { S.f.dir = d; for (const b of document.querySelectorAll("#lscDir [data-d]")) b.classList.toggle("on", +b.dataset.d === d); resort(); }
  function clearFilters() {
    S.f = { q: "", scan: null, dir: 0, minScore: 0, minRvol: 0, fno: false, sec: "", tagged: false };
    ["lscQ", "lscSec"].forEach((id) => (document.getElementById(id).value = "")); ["lscMinS", "lscMinR"].forEach((id) => (document.getElementById(id).value = "0"));
    document.getElementById("lscFno").checked = false; document.getElementById("lscTag").checked = false; setDir(0); loadScans();
  }
  function setView(v) {
    S.view = v;
    for (const b of document.querySelectorAll("#lscNav button")) b.classList.toggle("on", b.dataset.v === v);
    for (const d of document.querySelectorAll("#lscViews > [data-view]")) d.hidden = d.dataset.view !== v;
    if (typeof LSC_VIEWS !== "undefined") { const x = LSC_VIEWS.find((z) => z.id === v); if (x) x.show(); }
    if (v === "scanner") resort();
  }

  /* ── mount ── */
  function mount() {
    if (S.mounted) return;
    const root = document.getElementById("lscRoot"); root.innerHTML = skeleton(); S.mounted = true;
    if (typeof LSC_VIEWS !== "undefined") for (const v of LSC_VIEWS) {
      document.getElementById("lscNav").insertAdjacentHTML("beforeend", `<button data-v="${v.id}">${v.label}<kbd>${document.querySelectorAll("#lscNav button").length + 1}</kbd></button>`);
      document.getElementById("lscViews").insertAdjacentHTML("beforeend", `<div data-view="${v.id}" hidden></div>`);
      v.mount(document.querySelector(`#lscViews [data-view="${v.id}"]`));
    }
    document.getElementById("lscNav").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) setView(b.dataset.v); });
    document.querySelector("#lscT thead").addEventListener("click", (e) => { const th = e.target.closest("th[data-k]"); if (!th || !COLS[COLI[th.dataset.k]][4]) return; S.sort = S.sort.k === th.dataset.k ? { k: th.dataset.k, d: -S.sort.d } : { k: th.dataset.k, d: th.dataset.k === "s" ? 1 : -1 }; resort(); });
    document.getElementById("lscTw").addEventListener("scroll", () => { if (!S.raf) S.raf = requestAnimationFrame(render); }, { passive: true });
    document.getElementById("lscBody").addEventListener("click", (e) => { const tr = e.target.closest("tr[data-s]"); if (tr) openDrawer(tr.dataset.s); });
    document.getElementById("lscQ").addEventListener("input", (e) => { S.f.q = e.target.value.trim().toUpperCase(); resort(); });
    document.getElementById("lscDir").addEventListener("click", (e) => { const b = e.target.closest("[data-d]"); if (b) setDir(+b.dataset.d); });
    document.getElementById("lscMinS").addEventListener("change", (e) => { S.f.minScore = +e.target.value; resort(); });
    document.getElementById("lscMinR").addEventListener("change", (e) => { S.f.minRvol = +e.target.value; resort(); });
    document.getElementById("lscSec").addEventListener("change", (e) => { S.f.sec = e.target.value; resort(); });
    document.getElementById("lscFno").addEventListener("change", (e) => { S.f.fno = e.target.checked; resort(); });
    document.getElementById("lscTag").addEventListener("change", (e) => { S.f.tagged = e.target.checked; resort(); });
    document.getElementById("lscScanChip").addEventListener("click", (e) => { if (e.target.closest("[data-clear-scan]")) { S.f.scan = null; loadScans(); resort(); } });
    const scansEl = document.getElementById("lscScans");
    scansEl.addEventListener("click", (e) => {
      const row = e.target.closest("[data-scan]"); if (!row) return; const id = row.dataset.scan, sc = S.scans.find((x) => x.id === id);
      if (e.target.matches("[data-en]")) { if (e.target.checked) S.off.delete(id); else S.off.add(id); saveOff(); if (S.f.scan === id && S.off.has(id)) S.f.scan = null; loadScans(); kick(); return; }
      if (e.target.closest("[data-info]")) { scanInfo(id, e.target.closest("[data-info]")); return; }
      if (!sc) return;
      S.f.scan = S.f.scan === id ? null : id; loadScans(); resort();
    });
    document.getElementById("lscHelpB").addEventListener("click", help);
    document.getElementById("lscFeedList").addEventListener("click", (e) => { const x = e.target.closest("[data-open]"); if (x) openDrawer(x.dataset.open); });
    document.addEventListener("keydown", onKey);
    // frames that arrived before the tab was first opened
    for (const s of S.rows.keys()) S.changed.add(s);
    if (S.status) setStatus(S.status); if (S.market) setMarket(S.market);
    if (S.events.length) { const fl = document.getElementById("lscFeedList"); fl.innerHTML = S.events.slice(-150).reverse().map((e) => evHtml(e, false)).join(""); document.getElementById("lscEvN").textContent = `${S.events.length} today`; }
    resort(); loadScans();
    api("/api/scanner/fields").then((j) => { S.fields = j.fields; S.ops = j.ops; }).catch(() => {});
    if (!S.es) connect();
    if (window.REFRESH) REFRESH.on((sec) => setEvery(sec));
  }

  function kick() { S.order = ""; for (const s of S.rows.keys()) S.changed.add(s); if (!S.raf) S.raf = requestAnimationFrame(render); }
  return { mount, connect, kick, toast, openDrawer, rows: () => S.rows, events: () => S.events, state: S, spark, N, P, hhmmss, esc: (s) => esc(s), drawerBody };
})();

TABS.scanner = {
  init() { LSC.mount(); },
  syncContext() { LSC.kick(); },          // re-shown: render what arrived while hidden
};
/* the SSE stream connects only when the Live Scanner tab is opened (mount → connect); the server starts the scanner for its first viewer */
