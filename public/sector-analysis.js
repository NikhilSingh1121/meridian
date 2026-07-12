/* ════════════════════════════════════════════════════════════════════════
   MERIDIAN · SECTOR ANALYSIS  (frontend module)
   Registers TABS.sector. Two views inside one tab:
     · Overview  — sector table + sector treemap + summary cards
     · Detail    — breadcrumb, description, header cards, performance chart
                   (benchmarked, 1D–All, crosshair/zoom/pan/export),
                   metrics, industries (table+treemap), largest companies
                   (sortable/searchable table  ⇄  heatmap).
   All data is live from /api/sectors*. Company clicks reuse loadCompany().
   Depends on globals from terminal.js: TABS, F, api, $, $$, loadCompany.
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  const SECTOR = {
    view: "overview",         // 'overview' | 'detail'
    sectorKey: null,
    overview: null,           // cached overview payload
    detail: null,             // current sector detail payload
    benchmark: "^GSPC",
    range: "6M",
    companyView: "table",     // 'table' | 'heatmap'
    industryFilter: "ALL",
    sort: { key: "mcap", dir: -1 },
    search: "",
    page: 0,
    pageSize: 20,
    chart: null,              // live perf chart instance
    _pollTimer: null,
    _resizeBound: false,
  };
  const RANGES = ["1D", "5D", "1M", "6M", "YTD", "1Y", "3Y", "5Y", "All"];
  const BENCH_ORDER = ["^GSPC", "^IXIC", "^RUI", "^NSEI"];
  const COLORS = { sector: "#e8a33d", bench: "#5b8fd6" };

  /* ── shared tooltip ── */
  let TIP = null;
  function tip() {
    if (!TIP) { TIP = document.createElement("div"); TIP.className = "sec-tip"; document.body.appendChild(TIP); }
    return TIP;
  }
  function showTip(html, x, y) {
    const t = tip(); t.innerHTML = html; t.style.display = "block";
    const w = t.offsetWidth, h = t.offsetHeight;
    let nx = x + 14, ny = y + 14;
    if (nx + w > innerWidth - 8) nx = x - w - 14;
    if (ny + h > innerHeight - 8) ny = y - h - 14;
    t.style.left = nx + "px"; t.style.top = ny + "px";
  }
  function hideTip() { if (TIP) TIP.style.display = "none"; }

  /* ── formatting helpers (lean on global F) ── currency follows the live
     payload (Yahoo's global sector feed is USD). ── */
  const curOf = () => (SECTOR.detail && SECTOR.detail.currency) || (SECTOR.overview && SECTOR.overview.currency) || "USD";
  const capF = (v) => F.cap(v, curOf());
  const pxF = (v) => F.px(v, curOf());
  const pctF = (v, dp = 2) => F.pct(v, dp);
  const clsF = (v) => (v == null ? "" : v >= 0 ? "up" : "down");

  /* ── diverging day-return colour scale — rich brick red ↔ slate ↔ forest green.
     cap ±3% with a sqrt ease so typical ±1–2% moves saturate quickly (small moves
     read clearly red/green instead of washing out to gray). ── */
  function retColor(pct) {
    if (pct == null || !isFinite(pct)) return "rgb(46,52,60)";
    const cap = 3;
    const t = Math.max(-1, Math.min(1, pct / cap));
    const e = Math.sign(t) * Math.pow(Math.abs(t), 0.5);
    const mid = [46, 52, 60], neg = [150, 44, 44], pos = [38, 140, 90];
    const lerp = (a, b, r) => [a[0] + (b[0] - a[0]) * r, a[1] + (b[1] - a[1]) * r, a[2] + (b[2] - a[2]) * r];
    const c = e < 0 ? lerp(mid, neg, -e) : lerp(mid, pos, e);
    return `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
  }
  function legendHTML() {
    const stops = [-3, -2, -1, 0, 1, 2, 3];
    const cells = stops.map((s) => `<div class="lg-cell" style="background:${retColor(s)}"></div>`).join("");
    const labels = ["≤ -3", "-2", "-1", "0", "1", "2", "≥ 3"].map((l) => `<span class="lg-lbl">${l}</span>`).join("");
    return `<div class="sec-legend-wrap"><div class="sec-legend">${cells}</div><div class="lg-labels">${labels}</div></div>`;
  }

  /* ════════════════════════════════════════════════════════════════════
     SQUARIFIED TREEMAP (Bruls, Huizing & van Wijk)
     ════════════════════════════════════════════════════════════════════ */
  function worstRatio(areas, side) {
    let s = 0, mx = -Infinity, mn = Infinity;
    for (const a of areas) { s += a; if (a > mx) mx = a; if (a < mn) mn = a; }
    const s2 = s * s, side2 = side * side;
    return Math.max((side2 * mx) / s2, s2 / (side2 * mn));
  }
  function squarify(data, rect) {
    const nodes = data.filter((d) => d.value > 0);
    const total = nodes.reduce((s, n) => s + n.value, 0) || 1;
    const scale = (rect.w * rect.h) / total;
    nodes.forEach((n) => (n.area = n.value * scale));
    const out = [];
    let free = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    let i = 0;
    while (i < nodes.length && free.w > 0.5 && free.h > 0.5) {
      const shortSide = Math.min(free.w, free.h);
      const areas = [];
      let cur = Infinity, j = i;
      while (j < nodes.length) {
        const r = worstRatio(areas.concat(nodes[j].area), shortSide);
        if (r <= cur) { areas.push(nodes[j].area); cur = r; j++; } else break;
      }
      if (!areas.length) { areas.push(nodes[i].area); j = i + 1; }
      const rowArea = areas.reduce((s, a) => s + a, 0);
      const thick = rowArea / shortSide;
      if (free.w <= free.h) {
        let cx = free.x;
        for (let k = 0; k < areas.length; k++) { const cw = areas[k] / thick; out.push({ data: nodes[i + k], x: cx, y: free.y, w: cw, h: thick }); cx += cw; }
        free = { x: free.x, y: free.y + thick, w: free.w, h: free.h - thick };
      } else {
        let cy = free.y;
        for (let k = 0; k < areas.length; k++) { const ch = areas[k] / thick; out.push({ data: nodes[i + k], x: free.x, y: cy, w: thick, h: ch }); cy += ch; }
        free = { x: free.x + thick, y: free.y, w: free.w - thick, h: free.h };
      }
      i = j;
    }
    return out;
  }

  /* Keyed treemap render into `container` — glides tiles on data change,
     fades new tiles in. items: {key,label,sub,value,color,meta}. */
  function renderTreemap(container, items, opts) {
    opts = opts || {};
    const w = container.clientWidth, h = container.clientHeight;
    if (w < 20 || h < 20) { requestAnimationFrame(() => renderTreemap(container, items, opts)); return; }
    const data = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value).map((d) => ({ value: d.value, ref: d }));
    const laid = squarify(data, { x: 0, y: 0, w, h });
    const existing = container.__tiles || {};
    const next = {};
    laid.forEach((L, idx) => {
      const it = L.data.ref;
      let tile = existing[it.key];
      const isNew = !tile;
      if (isNew) { tile = document.createElement("div"); tile.className = "sec-tile"; tile.style.opacity = "0"; container.appendChild(tile); }
      positionTile(tile, L, it, opts);
      next[it.key] = tile;
      delete existing[it.key];
      if (isNew) requestAnimationFrame(() => { tile.style.transitionDelay = (idx * 10) + "ms"; tile.style.opacity = "1"; setTimeout(() => { tile.style.transitionDelay = ""; }, 500 + idx * 10); });
    });
    Object.values(existing).forEach((t) => { t.style.opacity = "0"; setTimeout(() => t.remove(), 420); });
    container.__tiles = next;
  }

  function positionTile(tile, L, it, opts) {
    const w = Math.max(0, L.w), h = Math.max(0, L.h);
    tile.style.left = L.x + "px"; tile.style.top = L.y + "px";
    tile.style.width = w + "px"; tile.style.height = h + "px";
    tile.style.background = it.color;

    // label sizing — height-anchored for visual consistency (equal-height tiles
    // yield equal-height text regardless of ticker length), then width-capped so
    // long labels never overflow. This prevents the previous inconsistency where
    // a 3-char ticker rendered ~2× larger than a 10-char ticker on the same tile.
    const area = w * h;
    let html = "";
    if (opts.mode === "heatmap") {
      const tkr = it.label;
      const heightF = Math.min(h * 0.30, 16);          // consistent size per tile height
      const widthCap = (w - 10) / Math.max(3, tkr.length * 0.60);
      let f = Math.min(heightF, widthCap);
      f = Math.max(8.5, f);
      if (w > 30 && h > 18) {
        html = `<div class="sec-tile-tkr" style="font-size:${f.toFixed(1)}px">${tkr}</div>`;
        if (h > 46 && w > 44 && it.sub) html += `<div class="sec-tile-v" style="font-size:${Math.max(8, f * 0.70).toFixed(1)}px">${it.sub}</div>`;
      }
    } else {
      const name = it.label;
      const longest = name.split(/\s+/).reduce((m, x) => Math.max(m, x.length), 1);
      const heightF = Math.min(h * 0.26, 22);
      const widthCap = (w - 10) / (longest * 0.58);
      let f = Math.min(heightF, widthCap);
      f = Math.max(9, f);
      if (w > 30 && h > 22) {
        html = `<div class="sec-tile-n" style="font-size:${f.toFixed(1)}px">${name}</div>`;
        if (h > 40 && w > 46 && it.sub != null) html += `<div class="sec-tile-v" style="font-size:${Math.max(8, f * 0.65).toFixed(1)}px">${it.sub}</div>`;
      }
    }
    tile.innerHTML = html;

    tile.onmousemove = (e) => showTip(opts.tip ? opts.tip(it.meta) : `<b>${it.label}</b>`, e.clientX, e.clientY);
    tile.onmouseleave = hideTip;
    tile.onclick = () => { hideTip(); opts.onClick && opts.onClick(it.meta); };
  }

  /* ════════════════════════════════════════════════════════════════════
     ROOT / ROUTER
     ════════════════════════════════════════════════════════════════════ */
  function root() { return document.getElementById("sectorRoot"); }

  function bindResize() {
    if (SECTOR._resizeBound) return;
    SECTOR._resizeBound = true;
    let t;
    window.addEventListener("resize", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const active = document.querySelector(".tab:not([hidden])");
        if (!active || active.id !== "tab-sector") return;
        redrawTreemaps();
        if (SECTOR.chart) SECTOR.chart.render();
      }, 180);
    });
  }

  function redrawTreemaps() {
    if (SECTOR.view === "overview" && SECTOR.overview) {
      const c = document.getElementById("secTmap");
      if (c) renderTreemap(c, sectorTiles(SECTOR.overview.sectors), sectorTmapOpts());
    } else if (SECTOR.view === "detail" && SECTOR.detail) {
      const ci = document.getElementById("secIndTmap");
      if (ci) renderTreemap(ci, industryTiles(SECTOR.detail.industries), industryTmapOpts());
      if (SECTOR.companyView === "heatmap") {
        const ch = document.getElementById("secCoHeat");
        if (ch) renderTreemap(ch, companyTiles(filteredCompanies()), companyHeatOpts());
      }
    }
  }

  /* ════════════════════════════════════════════════════════════════════
     OVERVIEW
     ════════════════════════════════════════════════════════════════════ */
  async function loadOverview() {
    SECTOR.view = "overview"; SECTOR.sectorKey = null;
    const r = root();
    r.innerHTML = loadingHTML("Loading the live global sector & industry taxonomy — market weights, market caps, day and YTD returns straight from the exchange feed…");
    poll();
    async function poll() {
      try {
        const res = await fetch("/api/sectors");
        if (res.status === 202) {
          const j = await res.json();
          updateProgress(j.progress);
          SECTOR._pollTimer = setTimeout(poll, 1400);
          return;
        }
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.status);
        const data = await res.json();
        SECTOR.overview = data;
        renderOverview();
      } catch (e) {
        r.innerHTML = `<div class="sec-wrap"><div class="empty-mini">Sector scan unavailable here — this runs live in your environment. ${e.message || ""}</div></div>`;
      }
    }
  }
  function updateProgress(p) {
    const bar = document.getElementById("secProgBar"), lbl = document.getElementById("secProgLbl");
    if (bar && p && p.total) { bar.style.width = Math.round((p.done / p.total) * 100) + "%"; lbl.textContent = `Classifying constituents… ${p.done} / ${p.total}`; }
  }

  function renderOverview() {
    const d = SECTOR.overview;
    const r = root();
    r.innerHTML = `
      <div class="sec-wrap">
        <div class="sec-head">
          <div class="sec-head-l">
            <div class="sec-title">Sector Analysis</div>
            <div class="sec-sub">Analyze the market by sector and industry. Understand market leadership, sector rotation, industry composition and individual company performance.</div>
          </div>
          <div class="sec-summary">
            <div class="sec-sum-cell"><div class="sec-sum-l">Total Sectors</div><div class="sec-sum-v">${d.totalSectors}</div></div>
            <div class="sec-sum-cell"><div class="sec-sum-l">Total Industries</div><div class="sec-sum-v">${d.totalIndustries}</div></div>
            <div class="sec-sum-cell"><div class="sec-sum-l">Total Market Cap</div><div class="sec-sum-v">${capF(d.totalMcap)}</div></div>
          </div>
        </div>
        <div class="sec-cols">
          <div class="sec-panel">
            <div class="sec-panel-h"><h4>Select a Sector for a Visual Breakdown</h4></div>
            <div class="sec-panel-body">${sectorTableHTML(d.sectors)}</div>
            <div class="sec-note">Percentage on the heatmap indicates the current day return. Sectors, industries, market caps and weights are the live global taxonomy (all listed constituents), not a sampled universe.</div>
          </div>
          <div class="sec-panel">
            <div class="sec-panel-h"><h4 id="secTmapTitle">All Sectors</h4><span class="sub">size · market cap  ·  colour · day return</span></div>
            <div class="sec-tmap-wrap">
              <div class="sec-tmap" id="secTmap"></div>
              ${legendHTML()}
            </div>
          </div>
        </div>
      </div>`;
    // table interactions
    wireSectorTable();
    // treemap
    renderTreemap(document.getElementById("secTmap"), sectorTiles(d.sectors), sectorTmapOpts());
    bindResize();
  }

  /* — SectorTable — */
  function sectorTableHTML(sectors) {
    const allDay = wcap(sectors, "dayPct"), allYtd = wcap(sectors, "ytdPct");
    const rows = [{ key: "__all", name: "All Sectors", weight: 100, ytdPct: allYtd, all: true }].concat(sectors);
    const maxW = 100;
    return `<table class="sec-tbl"><thead><tr><th>Sector</th><th>Market Weight</th><th>YTD Return</th></tr></thead><tbody>${rows.map((s) => `
      <tr data-key="${s.key}" class="${s.key === "__all" ? "sel" : ""}">
        <td><span class="sec-row-name">${s.name}</span>${s.all ? "" : `<span class="sec-row-sub">${s.companies} co · ${s.industries} ind</span>`}</td>
        <td><div class="sec-wcell"><div class="sec-wbar"><i style="width:${Math.min(100, (s.weight / maxW) * 100)}%"></i></div><span class="sec-wpct">${s.weight.toFixed(2)}%</span></div></td>
        <td><span class="sec-ret ${clsF(s.ytdPct)}">${pctF(s.ytdPct)}</span></td>
      </tr>`).join("")}</tbody></table>`;
  }
  function wireSectorTable() {
    $$("#sectorRoot .sec-tbl tbody tr").forEach((tr) => {
      tr.addEventListener("click", () => {
        const key = tr.dataset.key;
        if (key === "__all") {
          $$("#sectorRoot .sec-tbl tbody tr").forEach((x) => x.classList.toggle("sel", x.dataset.key === "__all"));
          document.getElementById("secTmapTitle").textContent = "All Sectors";
          renderTreemap(document.getElementById("secTmap"), sectorTiles(SECTOR.overview.sectors), sectorTmapOpts());
          return;
        }
        openSector(key);
      });
    });
  }

  /* — SectorTreemap — */
  function sectorTiles(sectors) {
    return sectors.map((s) => ({
      key: s.key, label: s.name, sub: pctF(s.dayPct), value: s.mcap, color: retColor(s.dayPct),
      meta: s,
    }));
  }
  function sectorTmapOpts() {
    return {
      mode: "sector",
      onClick: (s) => openSector(s.key),
      tip: (s) => `<b>${s.name}</b>
        <div class="tip-row"><span>Market cap</span><span>${capF(s.mcap)}</span></div>
        <div class="tip-row"><span>Weight</span><span>${s.weight.toFixed(2)}%</span></div>
        <div class="tip-row"><span>Day</span><span class="${clsF(s.dayPct)}">${pctF(s.dayPct)}</span></div>
        <div class="tip-row"><span>YTD</span><span class="${clsF(s.ytdPct)}">${pctF(s.ytdPct)}</span></div>
        <div class="tip-row"><span>Companies</span><span>${s.companies}</span></div>`,
    };
  }

  /* ════════════════════════════════════════════════════════════════════
     DETAIL
     ════════════════════════════════════════════════════════════════════ */
  async function openSector(key) {
    SECTOR.view = "detail"; SECTOR.sectorKey = key;
    SECTOR.range = "6M"; SECTOR.benchmark = "^NSEI"; SECTOR.companyView = "table";
    SECTOR.industryFilter = "ALL"; SECTOR.search = ""; SECTOR.page = 0;
    SECTOR.sort = { key: "mcap", dir: -1 };
    if (SECTOR.chart) { SECTOR.chart.destroy(); SECTOR.chart = null; }
    const r = root();
    r.innerHTML = loadingHTML("Building the sector workstation — industries, constituents, valuation columns and performance series…");
    try {
      const data = await api(`/api/sectors/${encodeURIComponent(key)}`);
      SECTOR.detail = data;
      renderDetail();
    } catch (e) {
      r.innerHTML = `<div class="sec-wrap"><button class="sec-crumb" id="secBack"><span class="arw">‹</span> Sectors</button><div class="empty-mini">Couldn't load this sector. ${e.message || ""}</div></div>`;
      const b = document.getElementById("secBack"); if (b) b.addEventListener("click", loadOverview);
    }
  }

  function renderDetail() {
    const d = SECTOR.detail;
    const r = root();
    r.innerHTML = `
      <div class="sec-wrap">
        <button class="sec-crumb" id="secBack"><span class="arw">‹</span> Sectors&nbsp;/&nbsp;<span class="cur">${d.name}</span></button>
        <div class="sec-head">
          <div class="sec-head-l">
            <div class="sec-title">${d.name}</div>
            <div class="sec-desc collapsed" id="secDesc">${d.description}</div>
            <span class="sec-desc-toggle" id="secDescT">Show more ▾</span>
          </div>
          <div class="sec-summary">
            <div class="sec-sum-cell"><div class="sec-sum-l">Market Cap</div><div class="sec-sum-v">${capF(d.mcap)}</div></div>
            <div class="sec-sum-cell"><div class="sec-sum-l">Market Weight</div><div class="sec-sum-v">${d.weight.toFixed(2)}%</div></div>
            <div class="sec-sum-cell"><div class="sec-sum-l">Industries</div><div class="sec-sum-v">${d.industriesCount}</div></div>
            <div class="sec-sum-cell"><div class="sec-sum-l">Companies</div><div class="sec-sum-v">${d.companiesCount}</div></div>
          </div>
        </div>

        <div class="sec-perf" id="secPerf">
          <div class="sec-perf-top">
            <div class="sec-plegend">
              <span class="sec-pl-item"><span class="dot" style="background:${COLORS.sector}"></span>${d.name}</span>
              <span class="sec-pl-item"><span class="dot" style="background:${COLORS.bench}"></span><span id="secBenchName">${(d.benchmarks && d.benchmarks[SECTOR.benchmark]) || "S&P 500"}</span></span>
            </div>
            <div class="sec-bench-sel" id="secBenchSel">${BENCH_ORDER.map((b) => `<button data-b="${b}" class="${b === SECTOR.benchmark ? "active" : ""}">${(d.benchmarks && d.benchmarks[b]) || b}</button>`).join("")}</div>
          </div>
          <div class="sec-chart-head">
            <div class="sec-ranges" id="secRanges">${RANGES.map((rg) => `<button class="sec-rb ${rg === SECTOR.range ? "active" : ""}" data-r="${rg}">${rg}</button>`).join("")}</div>
            <div class="sec-chart-tools"><button class="mini-btn" id="secZoomReset">Reset zoom</button><button class="mini-btn" id="secExport">Export PNG</button></div>
          </div>
          <div class="sec-canvas-wrap"><canvas id="secChart" class="sec-chart-canvas" style="height:340px"></canvas></div>
          <div class="sec-hint">Scroll to zoom · drag to pan · double-click to reset · hover for crosshair. Series rebased to 0% at range start.</div>
        </div>

        <div class="sec-metrics" id="secMetrics">${metricsHTML(d.metrics, null)}</div>
        <div class="sec-metric-note">Sector performance is cap-weighted across live constituents; benchmark series are rebased for relative comparison.</div>

        <div class="sec-block-title">Industries in this Sector</div>
        <div class="sec-cols">
          <div class="sec-panel">
            <div class="sec-panel-h"><h4>Select an Industry for a Visual Breakdown</h4></div>
            <div class="sec-panel-body">${industryTableHTML(d.industries)}</div>
            <div class="sec-note">Weight is relative to the sector. Selecting an industry filters the companies below.</div>
          </div>
          <div class="sec-panel">
            <div class="sec-panel-h"><h4>All Industries</h4><span class="sub">size · market cap  ·  colour · day return</span></div>
            <div class="sec-tmap-wrap"><div class="sec-tmap" id="secIndTmap"></div>${legendHTML()}</div>
          </div>
        </div>

        <div class="sec-co-head">
          <div class="sec-block-title" style="margin:0">Largest Companies in this Sector</div>
          <div class="sec-toggle" id="secCoToggle">
            <button data-v="table" class="active">Table View</button>
            <button data-v="heatmap">Heatmap View</button>
          </div>
        </div>
        <div id="secCoArea"></div>
      </div>`;

    document.getElementById("secBack").addEventListener("click", loadOverview);
    wireDescToggle();
    wireBenchmark();
    wireRanges();
    wireChartTools();
    // industries
    wireIndustryTable();
    renderTreemap(document.getElementById("secIndTmap"), industryTiles(d.industries), industryTmapOpts());
    // companies
    wireCoToggle();
    renderCompanyArea();
    // perf chart
    initChart();
    loadChart();
    loadBenchmarkMetrics();
    bindResize();
  }

  function wireDescToggle() {
    const desc = document.getElementById("secDesc"), t = document.getElementById("secDescT");
    t.addEventListener("click", () => {
      const collapsed = desc.classList.toggle("collapsed");
      t.textContent = collapsed ? "Show more ▾" : "Show less ▴";
    });
  }

  /* — PerformanceChart wiring — */
  function wireBenchmark() {
    $$("#secBenchSel button").forEach((b) => b.addEventListener("click", () => {
      SECTOR.benchmark = b.dataset.b;
      $$("#secBenchSel button").forEach((x) => x.classList.toggle("active", x === b));
      document.getElementById("secBenchName").textContent = b.textContent;
      loadChart(); loadBenchmarkMetrics();
    }));
  }
  function wireRanges() {
    $$("#secRanges .sec-rb").forEach((b) => b.addEventListener("click", () => {
      SECTOR.range = b.dataset.r;
      $$("#secRanges .sec-rb").forEach((x) => x.classList.toggle("active", x === b));
      loadChart();
    }));
  }
  function wireChartTools() {
    const ex = document.getElementById("secExport"), zr = document.getElementById("secZoomReset");
    ex.addEventListener("click", () => SECTOR.chart && SECTOR.chart.exportPNG(SECTOR.detail.name + "-" + SECTOR.range));
    zr.addEventListener("click", () => SECTOR.chart && SECTOR.chart.resetZoom());
  }
  function initChart() {
    const canvas = document.getElementById("secChart");
    SECTOR.chart = makePerfChart(canvas, { colors: COLORS });
  }
  async function loadChart() {
    if (!SECTOR.chart) return;
    SECTOR.chart.setLoading(true);
    try {
      const d = await api(`/api/sectors/${encodeURIComponent(SECTOR.sectorKey)}/chart?range=${encodeURIComponent(SECTOR.range)}&benchmark=${encodeURIComponent(SECTOR.benchmark)}`);
      SECTOR.chart.setData(d.sector || [], d.bench || [], { sector: SECTOR.detail.name, bench: d.benchmarkName || "Benchmark" }, SECTOR.range);
    } catch (e) {
      SECTOR.chart.setError("Chart data unavailable here (live in your environment).");
    }
  }
  async function loadBenchmarkMetrics() {
    try {
      const bm = await api(`/api/sectors/benchmark-metrics?symbol=${encodeURIComponent(SECTOR.benchmark)}`);
      const el = document.getElementById("secMetrics");
      if (el) el.innerHTML = metricsHTML(SECTOR.detail.metrics, bm);
    } catch { /* leave sector-only metrics */ }
  }

  function metricsHTML(m, bm) {
    const benchName = bm ? bm.name : "Benchmark";
    const rows = [
      ["Day Return", m.day, bm ? bm.day : null],
      ["YTD Return", m.ytd, bm ? bm.ytd : null],
      ["1-Year Return", m.y1, bm ? bm.y1 : null],
      ["3-Year Return", m.y3, bm ? bm.y3 : null],
      ["5-Year Return", m.y5, bm ? bm.y5 : null],
    ];
    return rows.map(([lbl, sv, bv]) => `
      <div class="sec-metric">
        <div class="sec-metric-l">${lbl}</div>
        <div class="sec-metric-grid">
          <div class="sec-metric-k">Sector</div><div class="sec-metric-k" style="text-align:right">${benchName}</div>
          <div class="sec-metric-v ${clsF(sv)}">${pctF(sv)}</div>
          <div class="sec-metric-v ${clsF(bv)}" style="text-align:right">${bv == null ? "—" : pctF(bv)}</div>
        </div>
      </div>`).join("");
  }

  /* — IndustryTable — */
  function industryTableHTML(inds) {
    const allYtd = wcap(inds, "ytdPct");
    const rows = [{ key: "ALL", name: "All Industries", weight: 100, ytdPct: allYtd, all: true }].concat(inds);
    return `<table class="sec-tbl"><thead><tr><th>Industry</th><th>Market Weight</th><th>YTD Return</th></tr></thead><tbody>${rows.map((s) => `
      <tr data-ikey="${s.key}" class="${s.key === SECTOR.industryFilter ? "sel" : ""}">
        <td><span class="sec-row-name">${s.name}</span>${s.all || s.companies == null ? "" : `<span class="sec-row-sub">${s.companies} co</span>`}</td>
        <td><div class="sec-wcell"><div class="sec-wbar"><i style="width:${Math.min(100, s.weight)}%"></i></div><span class="sec-wpct">${s.weight.toFixed(2)}%</span></div></td>
        <td><span class="sec-ret ${clsF(s.ytdPct)}">${pctF(s.ytdPct)}</span></td>
      </tr>`).join("")}</tbody></table>`;
  }
  function wireIndustryTable() {
    $$("#sectorRoot .sec-tbl tbody tr[data-ikey]").forEach((tr) => tr.addEventListener("click", () => {
      SECTOR.industryFilter = tr.dataset.ikey; SECTOR.page = 0;
      $$("#sectorRoot .sec-tbl tbody tr[data-ikey]").forEach((x) => x.classList.toggle("sel", x.dataset.ikey === SECTOR.industryFilter));
      renderCompanyArea();
    }));
  }
  function industryTiles(inds) {
    return inds.map((s) => ({ key: s.key, label: s.name, sub: pctF(s.dayPct), value: s.mcap, color: retColor(s.dayPct), meta: s }));
  }
  function industryTmapOpts() {
    return {
      mode: "sector",
      onClick: (s) => { SECTOR.industryFilter = s.key; SECTOR.page = 0; wireIndustryTable(); $$("#sectorRoot .sec-tbl tbody tr[data-ikey]").forEach((x) => x.classList.toggle("sel", x.dataset.ikey === s.key)); renderCompanyArea(); },
      tip: (s) => `<b>${s.name}</b>
        <div class="tip-row"><span>Market cap</span><span>${capF(s.mcap)}</span></div>
        <div class="tip-row"><span>Weight</span><span>${s.weight.toFixed(2)}%</span></div>
        <div class="tip-row"><span>Day</span><span class="${clsF(s.dayPct)}">${pctF(s.dayPct)}</span></div>
        <div class="tip-row"><span>YTD</span><span class="${clsF(s.ytdPct)}">${pctF(s.ytdPct)}</span></div>`,
    };
  }

  /* — Company view (Table ⇄ Heatmap) — */
  function wireCoToggle() {
    $$("#secCoToggle button").forEach((b) => b.addEventListener("click", () => {
      SECTOR.companyView = b.dataset.v;
      $$("#secCoToggle button").forEach((x) => x.classList.toggle("active", x === b));
      renderCompanyArea();
    }));
  }
  function filteredCompanies() {
    let rows = SECTOR.detail.companies.slice();
    if (SECTOR.industryFilter !== "ALL") rows = rows.filter((c) => c.industryKey === SECTOR.industryFilter);
    const q = SECTOR.search.trim().toLowerCase();
    if (q) rows = rows.filter((c) => (c.name + " " + c.ticker).toLowerCase().includes(q));
    return rows;
  }
  function renderCompanyArea() {
    const area = document.getElementById("secCoArea");
    if (!area) return;
    if (SECTOR.companyView === "heatmap") {
      area.innerHTML = `
        <div class="sec-co-tools">
          <div class="sec-search"><span class="mono" style="color:var(--muted-ink)">⌕</span><input id="secCoSearch" placeholder="Filter companies…" value="${SECTOR.search}" spellcheck="false"></div>
          <span class="sec-co-count" id="secCoCount"></span>
        </div>
        <div class="sec-tmap-wrap" style="border:1px solid var(--hairline);border-top:0;padding:12px">
          <div class="sec-tmap" id="secCoHeat" style="height:520px"></div>${legendHTML()}
        </div>`;
      wireCoSearch();
      const rows = filteredCompanies();
      document.getElementById("secCoCount").textContent = `${rows.length} companies · size market cap · colour day return`;
      renderTreemap(document.getElementById("secCoHeat"), companyTiles(rows), companyHeatOpts());
    } else {
      area.innerHTML = companyTableHTML();
      wireCoSearch();
      wireCompanyTable();
    }
  }
  function wireCoSearch() {
    const inp = document.getElementById("secCoSearch");
    if (!inp) return;
    inp.addEventListener("input", () => { SECTOR.search = inp.value; SECTOR.page = 0; renderCompanyArea(); requestAnimationFrame(() => { const el = document.getElementById("secCoSearch"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }); });
  }

  /* — CompanyTable (sortable / searchable / paginated / sticky) — */
  const COLS = [
    { k: "name", l: "Company", num: false },
    { k: "ticker", l: "Ticker", num: false },
    { k: "price", l: "Last Price", num: true, fmt: (v) => pxF(v) },
    { k: "target", l: "Target Price", num: true, fmt: (v) => (v == null ? "—" : pxF(v)) },
    { k: "upside", l: "Upside %", num: true, fmt: (v) => pctF(v), col: true },
    { k: "weight", l: "Mkt Weight", num: true, fmt: (v) => (v == null ? "—" : v.toFixed(2) + "%") },
    { k: "mcap", l: "Market Cap", num: true, fmt: (v) => capF(v) },
    { k: "dayPct", l: "Day %", num: true, fmt: (v) => pctF(v), col: true },
    { k: "ytdPct", l: "YTD %", num: true, fmt: (v) => pctF(v), col: true },
    { k: "rating", l: "Analyst Rating", num: false, fmt: (v) => ratingBadge(v) },
  ];
  function ratingBadge(v) {
    if (!v) return "—";
    const cls = { "Strong Buy": "sb", "Buy": "b", "Hold": "h", "Underperform": "u", "Sell": "s" }[v] || "h";
    return `<span class="sec-badge ${cls}">${v.toUpperCase()}</span>`;
  }
  function sortRows(rows) {
    const { key, dir } = SECTOR.sort;
    return rows.slice().sort((a, b) => {
      let x = a[key], y = b[key];
      if (typeof x === "string" || typeof y === "string") { x = (x || "").toString().toLowerCase(); y = (y || "").toString().toLowerCase(); return x < y ? -dir : x > y ? dir : 0; }
      if (x == null) return 1; if (y == null) return -1;
      return (x - y) * dir;
    });
  }
  function companyTableHTML() {
    const all = sortRows(filteredCompanies());
    const total = all.length;
    const pages = Math.max(1, Math.ceil(total / SECTOR.pageSize));
    if (SECTOR.page >= pages) SECTOR.page = pages - 1;
    const start = SECTOR.page * SECTOR.pageSize;
    const rows = all.slice(start, start + SECTOR.pageSize);
    const arrow = (k) => SECTOR.sort.key === k ? `<span class="sort-i">${SECTOR.sort.dir < 0 ? "▼" : "▲"}</span>` : "";
    const head = COLS.map((c) => `<th data-k="${c.k}">${c.l}${arrow(c.k)}</th>`).join("");
    const body = rows.map((c) => `<tr data-sym="${c.symbol}">${COLS.map((col) => {
      if (col.k === "name") return `<td><div class="sec-co-name"><span class="sec-co-tkr">${c.ticker}</span><span class="sec-co-full">${c.name}</span></div></td>`;
      if (col.k === "ticker") return `<td>${c.ticker}</td>`;
      const val = c[col.k];
      const cls = col.col ? clsF(val) : "";
      return `<td class="${cls}">${col.fmt ? col.fmt(val) : (val == null ? "—" : val)}</td>`;
    }).join("")}</tr>`).join("");
    const tools = `
      <div class="sec-co-tools">
        <div class="sec-search"><span class="mono" style="color:var(--muted-ink)">⌕</span><input id="secCoSearch" placeholder="Search company or ticker…" value="${SECTOR.search}" spellcheck="false"></div>
        <span class="sec-co-count">${total} compan${total === 1 ? "y" : "ies"}${SECTOR.industryFilter !== "ALL" ? " · filtered" : ""}</span>
      </div>`;
    const pager = total > SECTOR.pageSize ? `
      <div class="sec-pager">
        <span class="pg-info">Showing ${start + 1}–${Math.min(total, start + SECTOR.pageSize)} of ${total}</span>
        <div class="pg-btns">
          <button class="mini-btn" id="secPrev" ${SECTOR.page === 0 ? "disabled" : ""}>‹ Prev</button>
          <span class="pg-info">Page ${SECTOR.page + 1} / ${pages}</span>
          <button class="mini-btn" id="secNext" ${SECTOR.page >= pages - 1 ? "disabled" : ""}>Next ›</button>
        </div>
      </div>` : "";
    return tools + `<div class="sec-cotbl-wrap"><table class="sec-cotbl"><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${COLS.length}" style="text-align:center;color:var(--muted-ink);padding:24px">No companies match.</td></tr>`}</tbody></table></div>` + pager;
  }
  function wireCompanyTable() {
    $$("#secCoArea .sec-cotbl thead th").forEach((th) => th.addEventListener("click", () => {
      const k = th.dataset.k;
      if (SECTOR.sort.key === k) SECTOR.sort.dir *= -1;
      else SECTOR.sort = { key: k, dir: (COLS.find((c) => c.k === k).num ? -1 : 1) };
      renderCompanyArea();
    }));
    $$("#secCoArea .sec-cotbl tbody tr[data-sym]").forEach((tr) => tr.addEventListener("click", () => loadCompany(tr.dataset.sym)));
    const prev = document.getElementById("secPrev"), next = document.getElementById("secNext");
    if (prev) prev.addEventListener("click", () => { SECTOR.page = Math.max(0, SECTOR.page - 1); renderCompanyArea(); });
    if (next) next.addEventListener("click", () => { SECTOR.page++; renderCompanyArea(); });
  }

  /* — CompanyHeatmap — */
  function companyTiles(rows) {
    return rows.map((c) => ({ key: c.symbol, label: c.ticker, sub: pctF(c.dayPct), value: c.mcap, color: retColor(c.dayPct), meta: c }));
  }
  function companyHeatOpts() {
    return {
      mode: "heatmap",
      onClick: (c) => loadCompany(c.symbol),
      tip: (c) => `<b>${c.name} · ${c.ticker}</b>
        <div class="tip-row"><span>Price</span><span>${pxF(c.price)}</span></div>
        <div class="tip-row"><span>Day</span><span class="${clsF(c.dayPct)}">${pctF(c.dayPct)}</span></div>
        <div class="tip-row"><span>YTD</span><span class="${clsF(c.ytdPct)}">${pctF(c.ytdPct)}</span></div>
        <div class="tip-row"><span>Market cap</span><span>${capF(c.mcap)}</span></div>
        <div class="tip-row"><span>Weight</span><span>${c.weight.toFixed(2)}%</span></div>`,
    };
  }

  /* ════════════════════════════════════════════════════════════════════
     DUAL-LINE PERFORMANCE CHART (crosshair · zoom · pan · export)
     ════════════════════════════════════════════════════════════════════ */
  function makePerfChart(canvas, opts) {
    const colors = opts.colors || COLORS;
    const st = { sector: [], bench: [], names: { sector: "Sector", bench: "Benchmark" }, range: "6M", loading: false, error: null, view: null, domain: null, hoverX: null, drag: null, raf: null };

    function domainOf() {
      let mn = Infinity, mx = -Infinity;
      for (const s of [st.sector, st.bench]) for (const p of s) { if (p.t < mn) mn = p.t; if (p.t > mx) mx = p.t; }
      if (!isFinite(mn)) return null;
      return [mn, mx];
    }
    function setData(sector, bench, names, range) {
      st.sector = sector || []; st.bench = bench || []; st.names = names || st.names; st.range = range; st.error = null; st.loading = false;
      st.domain = domainOf();
      st.view = st.domain ? st.domain.slice() : null;
      render();
    }
    function setLoading(v) { st.loading = v; render(); }
    function setError(m) { st.error = m; st.loading = false; render(); }
    function resetZoom() { if (st.domain) { st.view = st.domain.slice(); render(); } }

    const schedule = () => { if (st.raf) return; st.raf = requestAnimationFrame(() => { st.raf = null; draw(); }); };
    function render() { schedule(); }

    function draw() {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const W = canvas.offsetWidth || 600, H = 340;
      canvas.width = W * dpr; canvas.height = H * dpr;
      const ctx = canvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.font = "10.5px Inter, sans-serif";

      if (st.loading) { ctx.fillStyle = "#8a93a0"; ctx.textAlign = "center"; ctx.fillText("loading…", W / 2, H / 2); return; }
      if (st.error) { ctx.fillStyle = "#8a93a0"; ctx.textAlign = "center"; ctx.fillText(st.error, W / 2, H / 2); return; }
      if (!st.view || (!st.sector.length && !st.bench.length)) { ctx.fillStyle = "#6b7280"; ctx.textAlign = "center"; ctx.fillText("no data", W / 2, H / 2); return; }

      const pad = { l: 54, r: 58, t: 14, b: 26 };
      const cw = W - pad.l - pad.r, ch = H - pad.t - pad.b;
      const [t0, t1] = st.view, tspan = (t1 - t0) || 1;
      const inView = (p) => p.t >= t0 && p.t <= t1;
      const visSeries = [st.sector.filter(inView), st.bench.filter(inView)];
      // include one point either side for continuity
      const clip = (full) => {
        const r = full.filter(inView);
        return r;
      };
      const sVis = clip(st.sector), bVis = clip(st.bench);
      let lo = Infinity, hi = -Infinity;
      for (const s of [sVis, bVis]) for (const p of s) { if (p.pct < lo) lo = p.pct; if (p.pct > hi) hi = p.pct; }
      if (!isFinite(lo)) { lo = -1; hi = 1; }
      if (lo === hi) { lo -= 1; hi += 1; }
      const padY = (hi - lo) * 0.08; lo -= padY; hi += padY;
      const span = (hi - lo) || 1;
      const xOf = (t) => pad.l + ((t - t0) / tspan) * cw;
      const yOf = (v) => pad.t + ch - ((v - lo) / span) * ch;

      // grid + y labels
      ctx.strokeStyle = "rgba(35,42,51,.7)"; ctx.fillStyle = "#7a8290"; ctx.textAlign = "right";
      for (let i = 0; i <= 4; i++) {
        const v = lo + (span * i) / 4, yy = yOf(v);
        ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(W - pad.r, yy); ctx.stroke();
        ctx.fillText((v >= 0 ? "+" : "") + v.toFixed(1) + "%", pad.l - 6, yy + 3);
      }
      // zero line emphasis
      if (lo < 0 && hi > 0) { const yz = yOf(0); ctx.strokeStyle = "rgba(138,147,160,.5)"; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(pad.l, yz); ctx.lineTo(W - pad.r, yz); ctx.stroke(); ctx.setLineDash([]); }
      // x labels
      ctx.textAlign = "center"; ctx.fillStyle = "#7a8290";
      const ticks = 6;
      for (let i = 0; i < ticks; i++) { const t = t0 + (tspan * i) / (ticks - 1); ctx.fillText(secFmtDate(t, st.range), Math.min(W - pad.r, Math.max(pad.l, xOf(t))), H - 8); }

      // series
      const drawLine = (data, color) => {
        if (data.length < 2) return;
        ctx.strokeStyle = color; ctx.lineWidth = 1.7; ctx.beginPath();
        data.forEach((p, i) => { const X = xOf(p.t), Y = yOf(p.pct); i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y); });
        ctx.stroke();
      };
      drawLine(bVis, colors.bench);
      drawLine(sVis, colors.sector);

      // end labels
      const endLabel = (data, color) => {
        if (!data.length) return;
        const p = data[data.length - 1]; const Y = yOf(p.pct);
        const txt = (p.pct >= 0 ? "+" : "") + p.pct.toFixed(2) + "%";
        ctx.fillStyle = color; ctx.fillRect(W - pad.r + 2, Y - 8, pad.r - 4, 16);
        ctx.fillStyle = "#0a0c10"; ctx.font = "600 10.5px Inter, sans-serif"; ctx.textAlign = "center";
        ctx.fillText(txt, W - pad.r / 2, Y + 3); ctx.font = "10.5px Inter, sans-serif";
      };
      endLabel(bVis, colors.bench);
      endLabel(sVis, colors.sector);

      // crosshair + tooltip
      if (st.hoverX != null && st.hoverX >= pad.l && st.hoverX <= W - pad.r) {
        const tH = t0 + ((st.hoverX - pad.l) / cw) * tspan;
        const nearest = (data) => { if (!data.length) return null; let best = data[0], bd = Infinity; for (const p of data) { const d = Math.abs(p.t - tH); if (d < bd) { bd = d; best = p; } } return best; };
        const ns = nearest(st.sector), nb = nearest(st.bench);
        const cx = st.hoverX;
        ctx.strokeStyle = "rgba(200,134,42,.5)"; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(cx, pad.t); ctx.lineTo(cx, pad.t + ch); ctx.stroke(); ctx.setLineDash([]);
        [[ns, colors.sector], [nb, colors.bench]].forEach(([p, c]) => { if (!p) return; ctx.fillStyle = c; ctx.beginPath(); ctx.arc(xOf(p.t), yOf(p.pct), 3.2, 0, 7); ctx.fill(); });
        const when = ns || nb;
        const lines = [secFmtDate(when.t, st.range, true)];
        if (ns) lines.push([st.names.sector, (ns.pct >= 0 ? "+" : "") + ns.pct.toFixed(2) + "%", colors.sector]);
        if (nb) lines.push([st.names.bench, (nb.pct >= 0 ? "+" : "") + nb.pct.toFixed(2) + "%", colors.bench]);
        // tooltip box
        const bw = 168, bh = 14 + (lines.length - 1) * 15 + 8;
        let bx = cx + 10; if (bx + bw > W - pad.r) bx = cx - bw - 10; const by = pad.t + 6;
        ctx.fillStyle = "rgba(12,15,19,.96)"; ctx.fillRect(bx, by, bw, bh);
        ctx.strokeStyle = "rgba(200,134,42,.4)"; ctx.strokeRect(bx, by, bw, bh);
        ctx.textAlign = "left"; ctx.fillStyle = "#e8eaed"; ctx.font = "10.5px Inter, sans-serif";
        ctx.fillText(lines[0], bx + 8, by + 14);
        for (let i = 1; i < lines.length; i++) { const [nm, vv, cc] = lines[i]; const y = by + 14 + i * 15; ctx.fillStyle = cc; ctx.fillRect(bx + 8, y - 7, 7, 7); ctx.fillStyle = "#b8c0cc"; ctx.fillText(nm, bx + 20, y); ctx.fillStyle = "#e8eaed"; ctx.textAlign = "right"; ctx.fillText(vv, bx + bw - 8, y); ctx.textAlign = "left"; }
      }
    }

    // interactions
    function tOfX(px) { if (!st.view) return null; const pad = { l: 54, r: 58 }; const W = canvas.offsetWidth; const cw = W - pad.l - pad.r; return st.view[0] + ((px - pad.l) / cw) * (st.view[1] - st.view[0]); }
    canvas.addEventListener("pointermove", (e) => {
      const rect = canvas.getBoundingClientRect(); const x = e.clientX - rect.left;
      if (st.drag) {
        const dx = x - st.drag.x0; const W = canvas.offsetWidth; const cw = W - 112; const dt = -(dx / cw) * (st.drag.v1 - st.drag.v0);
        let nv0 = st.drag.v0 + dt, nv1 = st.drag.v1 + dt;
        const [d0, d1] = st.domain; const spanV = nv1 - nv0;
        if (nv0 < d0) { nv0 = d0; nv1 = d0 + spanV; } if (nv1 > d1) { nv1 = d1; nv0 = d1 - spanV; }
        st.view = [nv0, nv1]; st.hoverX = null;
      } else { st.hoverX = x; }
      schedule();
    });
    canvas.addEventListener("pointerleave", () => { st.hoverX = null; schedule(); });
    canvas.addEventListener("pointerdown", (e) => { if (!st.domain) return; const rect = canvas.getBoundingClientRect(); st.drag = { x0: e.clientX - rect.left, v0: st.view[0], v1: st.view[1] }; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = "grabbing"; });
    canvas.addEventListener("pointerup", (e) => { st.drag = null; canvas.style.cursor = "crosshair"; try { canvas.releasePointerCapture(e.pointerId); } catch { } });
    canvas.addEventListener("dblclick", () => resetZoom());
    canvas.addEventListener("wheel", (e) => {
      if (!st.view || !st.domain) return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect(); const x = e.clientX - rect.left;
      const center = tOfX(x); if (center == null) return;
      const factor = e.deltaY < 0 ? 0.82 : 1.22;
      const [d0, d1] = st.domain; const fullSpan = d1 - d0;
      let span = (st.view[1] - st.view[0]) * factor;
      span = Math.max(fullSpan * 0.01, Math.min(fullSpan, span));
      let nv0 = center - (center - st.view[0]) * (span / (st.view[1] - st.view[0]));
      let nv1 = nv0 + span;
      if (nv0 < d0) { nv0 = d0; nv1 = d0 + span; } if (nv1 > d1) { nv1 = d1; nv0 = d1 - span; }
      st.view = [nv0, nv1]; schedule();
    }, { passive: false });

    function exportPNG(name) {
      const tmp = document.createElement("canvas"); tmp.width = canvas.width; tmp.height = canvas.height;
      const tctx = tmp.getContext("2d"); tctx.fillStyle = "#0a0c10"; tctx.fillRect(0, 0, tmp.width, tmp.height); tctx.drawImage(canvas, 0, 0);
      const a = document.createElement("a"); a.href = tmp.toDataURL("image/png"); a.download = (name || "sector-performance").replace(/\s+/g, "_") + ".png"; a.click();
    }
    function destroy() { if (st.raf) cancelAnimationFrame(st.raf); }

    return { setData, setLoading, setError, resetZoom, render, exportPNG, destroy };
  }

  function secFmtDate(t, range, full) {
    const d = new Date(t);
    if (range === "1D") return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
    if (range === "5D") return d.toLocaleDateString([], { day: "2-digit", month: "short" }) + (full ? " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "");
    if (["1M", "3M", "6M", "YTD", "1Y"].includes(range)) return d.toLocaleDateString([], { day: "2-digit", month: "short" }) + (full ? " '" + String(d.getFullYear()).slice(2) : "");
    return d.toLocaleDateString([], { month: "short", year: "2-digit" });
  }

  /* ── misc helpers ── */
  function wcap(rows, field) { let n = 0, d = 0; for (const r of rows) if (r[field] != null && r.mcap != null) { n += r.mcap * r[field]; d += r.mcap; } return d ? n / d : null; }
  function loadingHTML(msg) {
    return `<div class="sec-wrap"><div class="sec-loading">
      <div class="sec-spin">◷ ${msg}</div>
      <div class="sec-prog"><div class="sec-prog-track"><i id="secProgBar" style="width:6%"></i></div><div class="sec-prog-lbl" id="secProgLbl">Warming up…</div></div>
    </div></div>`;
  }

  /* ════════════════════════════════════════════════════════════════════
     TAB REGISTRATION
     ════════════════════════════════════════════════════════════════════ */
  TABS.sector = {
    init() {
      if (!root()) return;
      loadOverview();
    },
  };
})();
