/* MERIDIAN Terminal — application layer.
   Every panel is fed by the live /api/* backend. */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

/* ── HTML escaping for EXTERNAL strings (news titles, search results, holder
   names, announcement subjects…). Anything that arrives from an upstream
   provider and is interpolated into innerHTML must pass through esc(). ── */
const esc = (s) => s == null ? "" : String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
/* Safe href: only http(s) links survive; anything else (javascript:, data:)
   is neutralised. */
const escUrl = (u) => { const s = String(u || ""); return /^https?:\/\//i.test(s) ? esc(s) : "#"; };

/* ── premium gold flash — re-triggerable pulse on any element that changed ── */
function goldFlash(el) {
  if (!el) return;
  el.classList.remove("gold-flash");
  void el.offsetWidth; // restart the animation
  el.classList.add("gold-flash");
}
const api = async (path, opts) => {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
  return r.json();
};

/* ── formatting ── */
const F = {
  num(v, dp = 2) { return v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp }); },
  px(v, ccy, dp = 2) { if (v === null || v === undefined || !Number.isFinite(v)) return "—"; const s = this.num(v, dp); return ccy === "INR" ? "₹" + s : ccy === "USD" ? "$" + s : s; },
  pct(v, dp = 1) { return v === null || v === undefined || !Number.isFinite(v) ? "—" : (v >= 0 ? "+" : "") + v.toFixed(dp) + "%"; },
  cap(v, ccy) {
    if (!v || !Number.isFinite(v)) return "—";
    if (ccy === "INR") { const cr = v / 1e7; return "₹" + (cr >= 1e5 ? (cr / 1e5).toFixed(2) + " L Cr" : (cr / 1e3).toFixed(1) + " K Cr"); }
    // Auto-scale M / B / T from the RAW currency value (previous loop divided
    // by 1000 three times, over-promoting billion-scale caps to trillions).
    const a = Math.abs(v);
    const [d, u] = a >= 1e12 ? [1e12, "T"] : a >= 1e9 ? [1e9, "B"] : a >= 1e6 ? [1e6, "M"] : [1, ""];
    const sym = ccy === "USD" || !ccy ? "$" : ccy + " ";
    return sym + (v / d).toFixed(a >= 1e12 ? 2 : 1) + u;
  },
  x(v, dp = 1) { return v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(dp) + "x"; },
  cls(v) { return v === null || v === undefined ? "" : v >= 0 ? "up" : "down"; },
  ago(t) { if (!t) return ""; const m = (Date.now() - t) / 60000; if (m < 60) return Math.round(m) + "m ago"; if (m < 1440) return Math.round(m / 60) + "h ago"; return Math.round(m / 1440) + "d ago"; },
};

/* ── lightweight canvas charts ── */
function lineChart(canvas, series, opts = {}) {
  if (!canvas || !series || series.length < 2) return;
  const dpr = devicePixelRatio || 1;
  const W = (canvas.width = canvas.offsetWidth * dpr), H = (canvas.height = canvas.offsetHeight * dpr);
  const ctx = canvas.getContext("2d");
  const pad = (opts.pad ?? 6) * dpr;
  const vals = series.filter((v) => v !== null && Number.isFinite(v));
  if (vals.length < 2) return;
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const X = (i) => pad + (i / (series.length - 1)) * (W - 2 * pad);
  const Y = (v) => H - pad - ((v - min) / span) * (H - 2 * pad);
  const up = series.at(-1) >= series[0];
  const color = opts.color || (up ? "46,158,107" : "200,75,60");
  if (opts.fill !== false) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, `rgba(${color},0.18)`); g.addColorStop(1, `rgba(${color},0)`);
    ctx.beginPath(); ctx.moveTo(X(0), H - pad);
    series.forEach((v, i) => v !== null && ctx.lineTo(X(i), Y(v)));
    ctx.lineTo(X(series.length - 1), H - pad); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
  }
  ctx.beginPath();
  let started = false;
  series.forEach((v, i) => { if (v === null) return; started ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)); started = true; });
  ctx.strokeStyle = `rgba(${color},1)`; ctx.lineWidth = (opts.lw || 1.4) * dpr; ctx.stroke();
}
function barMini(canvas, series) {
  if (!canvas || !series) return;
  const dpr = devicePixelRatio || 1;
  const W = (canvas.width = canvas.offsetWidth * dpr), H = (canvas.height = canvas.offsetHeight * dpr);
  const ctx = canvas.getContext("2d");
  const vals = series.map((p) => p.v).filter((v) => v !== null);
  if (!vals.length) return;
  const max = Math.max(...vals, 0), min = Math.min(...vals, 0), span = max - min || 1;
  const bw = W / series.length;
  series.forEach((p, i) => {
    if (p.v === null) return;
    const h = (Math.abs(p.v) / span) * H;
    const y = p.v >= 0 ? H - ((p.v - Math.min(min, 0)) / span) * H : H - ((0 - min) / span) * H;
    ctx.fillStyle = p.v >= 0 ? "rgba(46,158,107,0.8)" : "rgba(200,75,60,0.8)";
    ctx.fillRect(i * bw + bw * 0.15, Math.min(y, y + h) , bw * 0.7, Math.max(2, h));
  });
}

/* ── tab switching ── */
const TABS = {};
const TAB_LABELS = {
  markets:"Market Intelligence", research:"Equity Research", earnings:"Earnings Call",
  forensic:"Forensic Analysis", models:"Modeling Lab", quant:"Quant Lab", risk:"Risk Center",
  reports:"Report Generation", portfolio:"Portfolio", sector:"Sector Analysis",
  news:"News & Sentiment", calc:"Calculators", learn:"Learning Center", library:"Library",
};

function showTab(name) {
  $$(".ttabs button[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  revealActiveTab();
  $$(".tab").forEach((t) => (t.hidden = t.id !== "tab-" + name));
  if (TABS[name] && !TABS[name].loaded) { TABS[name].init(); TABS[name].loaded = true; }
  // ── persistent company context: a tab opened AFTER a company was loaded
  //    (or re-opened after the company changed) syncs itself to CURRENT.
  //    Each module implements syncContext() as a cheap no-op when already
  //    aligned, so switching tabs never re-fetches unnecessarily. ──
  else if (TABS[name] && TABS[name].loaded && typeof TABS[name].syncContext === "function") {
    try { TABS[name].syncContext(); } catch { }
  }
  location.hash = name;
  // Sync mobile drawer active state
  $$(".m-drawer-tabs button[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  // Update tbar data attribute so CSS ::after shows current module name
  const tbar = $(".tbar");
  if (tbar) tbar.setAttribute("data-active-tab", TAB_LABELS[name] || name);
  // Close drawer if open
  closeMobileDrawer();
}
$$(".ttabs button[data-tab]").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

/* ─── Tab-bar overflow affordance ─────────────────────────────────────────
   14 modules do not fit most widths and the scrollbar is hidden, so tabs past
   the edge were undiscoverable. Sticky ‹ › arrows appear only on the side
   that has more tabs, the vertical wheel scrolls the bar sideways, and the
   active tab is always brought into view. */
function revealActiveTab() {
  const a = $(".ttabs button.active");
  if (a) a.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
}
(function initTabArrows() {
  const bar = $("#ttabs");
  if (!bar) return;
  const mk = (dir) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "ttabs-arrow " + dir; b.tabIndex = -1;
    b.setAttribute("aria-label", dir === "l" ? "Scroll tabs left" : "Scroll tabs right");
    b.textContent = dir === "l" ? "‹" : "›";
    b.addEventListener("click", () => bar.scrollBy({ left: (dir === "l" ? -1 : 1) * bar.clientWidth * 0.7, behavior: "smooth" }));
    return b;
  };
  const left = mk("l"), right = mk("r");
  bar.prepend(left); bar.append(right);
  const sync = () => {
    left.classList.toggle("show", bar.scrollLeft > 2);
    right.classList.toggle("show", bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 2);
  };
  bar.addEventListener("scroll", sync, { passive: true });
  bar.addEventListener("wheel", (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && bar.scrollWidth > bar.clientWidth) { bar.scrollLeft += e.deltaY; e.preventDefault(); }
  }, { passive: false });
  window.addEventListener("resize", sync);
  sync();
})();

/* ─── Mobile navigation drawer ─────────────────────────────────────────── */
let _drawerOpen = false;

function openMobileDrawer() {
  const drawer = $("#mDrawer"), overlay = $("#mDrawerOverlay"), btn = $("#mMenuBtn");
  if (!drawer) return;
  _drawerOpen = true;
  drawer.classList.add("open");
  drawer.removeAttribute("hidden");
  overlay.classList.add("open");
  btn && btn.setAttribute("aria-expanded", "true");
  document.body.style.overflow = "hidden"; // prevent body scroll while drawer open
}

function closeMobileDrawer() {
  const drawer = $("#mDrawer"), overlay = $("#mDrawerOverlay"), btn = $("#mMenuBtn");
  if (!drawer || !_drawerOpen) return;
  _drawerOpen = false;
  drawer.classList.remove("open");
  overlay.classList.remove("open");
  btn && btn.setAttribute("aria-expanded", "false");
  document.body.style.overflow = "";
}

function initMobileNav() {
  const btn = $("#mMenuBtn"), close = $("#mDrawerClose"), overlay = $("#mDrawerOverlay"), drawerTabs = $("#mDrawerTabs");
  if (!btn || !drawerTabs) return;

  // Populate drawer from the desktop ttabs (single source of truth)
  const tabBtns = $$(".ttabs button[data-tab]");
  // Group tabs into two sections: core analytics + user tools
  const groups = [
    { label: "Analytics", tabs: ["markets","research","earnings","forensic","models","quant","risk","reports"] },
    { label: "Tools", tabs: ["portfolio","sector","news","calc","learn","library"] },
  ];

  let html = "";
  groups.forEach((g, gi) => {
    if (gi > 0) html += `<div class="m-drawer-sep"></div>`;
    html += `<div style="padding:6px 18px 2px;font-family:var(--mono);font-size:9px;letter-spacing:.12em;color:var(--muted-ink);text-transform:uppercase">${g.label}</div>`;
    g.tabs.forEach((tid) => {
      const lbl = TAB_LABELS[tid] || tid;
      html += `<button data-tab="${tid}">${lbl}</button>`;
    });
  });
  drawerTabs.innerHTML = html;

  // Bind drawer tab buttons
  $$(".m-drawer-tabs button[data-tab]").forEach((b) => {
    b.addEventListener("click", () => showTab(b.dataset.tab));
  });

  // Open / close handlers
  btn.addEventListener("click", () => _drawerOpen ? closeMobileDrawer() : openMobileDrawer());
  close && close.addEventListener("click", closeMobileDrawer);
  overlay.addEventListener("click", closeMobileDrawer);

  // Swipe-to-close: track touch start X, close if swiped left > 60px
  let _touchStartX = 0;
  const drawer = $("#mDrawer");
  if (drawer) {
    drawer.addEventListener("touchstart", (e) => { _touchStartX = e.changedTouches[0].screenX; }, { passive: true });
    drawer.addEventListener("touchend", (e) => {
      const dx = _touchStartX - e.changedTouches[0].screenX;
      if (dx > 60) closeMobileDrawer();
    }, { passive: true });
  }

  // Close on Escape
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && _drawerOpen) closeMobileDrawer(); });

  // Resize: auto-close drawer if window grows to desktop size
  window.addEventListener("resize", () => {
    if (window.innerWidth > 768 && _drawerOpen) closeMobileDrawer();
  });
}

/* ─── Mobile canvas resize on orientation change ───────────────────────── */
function initMobileChartResize() {
  const resizeCharts = () => {
    // Redraw all mounted price charts when orientation changes
    if (typeof PRICE_CHARTS !== "undefined") {
      Object.values(PRICE_CHARTS).forEach((state) => {
        if (state && state.data && typeof drawChart === "function") {
          try { drawChart(state); } catch { }
        }
      });
    }
    // Redraw calc charts by dispatching resize
    window.dispatchEvent(new Event("resize"));
  };
  window.addEventListener("orientationchange", () => setTimeout(resizeCharts, 350));
  // Also fire on viewport-significant resize
  let _rTimer;
  window.addEventListener("resize", () => {
    clearTimeout(_rTimer);
    _rTimer = setTimeout(resizeCharts, 200);
  });
}

const YIELD_SYMS = new Set(["^TNX", "^FVX", "^TYX", "^IRX"]);

function initCmd() {
  const input = $("#tcmdInput"), results = $("#tcmdResults");
  // the full hint is cut off mid-word on phones — use a short one there
  const fullHint = input.placeholder;
  const phone = window.matchMedia("(max-width: 768px)");
  const setHint = () => { input.placeholder = phone.matches ? "Search company or ticker" : fullHint; };
  setHint();
  phone.addEventListener("change", setHint);
  let timer, items = [], active = -1, seq = 0;
  // Closing bumps `seq`, so a debounced search still in flight when the user
  // picks a company cannot re-open the dropdown over the loaded workstation.
  const close = () => { clearTimeout(timer); seq++; results.hidden = true; };
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { close(); return; }
    const my = ++seq;
    timer = setTimeout(async () => {
      try {
        const { results: list } = await api(`/api/search?q=${encodeURIComponent(q)}`);
        if (my !== seq) return;
        items = list; active = -1;
        if (!list.length) return (results.hidden = true);
        results.innerHTML = list.map((it, i) => `<button class="cmd-result" data-i="${i}"><span class="sym">${esc(it.symbol)}</span><span class="nm">${esc(it.name)}</span><span class="ex">${esc(it.exchange)}</span></button>`).join("");
        results.hidden = false;
      } catch { if (my === seq) results.hidden = true; }
    }, 200);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); if (active >= 0 && items[active]) loadCompany(items[active].symbol); else if (input.value.trim()) loadCompany(input.value.trim().toUpperCase()); close(); input.blur(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (!items.length) return; active = (active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; $$(".cmd-result", results).forEach((el, i) => el.classList.toggle("active", i === active)); }
    else if (e.key === "Escape") close();
  });
  results.addEventListener("click", (e) => { const b = e.target.closest(".cmd-result"); if (b) { loadCompany(items[+b.dataset.i].symbol); close(); input.blur(); } });
  document.addEventListener("click", (e) => { if (!e.target.closest("#tcmd")) close(); });
  // Ctrl·K chip in the command bar opens the palette (discoverability)
  const kbd = $("#tcmdKbd");
  if (kbd) kbd.addEventListener("click", () => { if (typeof PALETTE !== "undefined") PALETTE.open(); });

  document.addEventListener("keydown", (e) => {
    // Ctrl/Cmd+K → global command palette (tabs, recents, live ticker search)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (typeof PALETTE !== "undefined") PALETTE.open(); else input.focus();
      return;
    }
    // "/" → quick-focus the ticker search (unchanged muscle memory)
    if (e.key === "/" && document.activeElement !== input && !e.target.closest("input,textarea,[contenteditable]")) { e.preventDefault(); input.focus(); }
  });
}

/* ════════ TAB · MARKET INTELLIGENCE ════════ */
TABS.markets = {
  _tapeAll: false,
  _mxView: "corr",
  _spH: "d1",
  init() {
    this.loadTape(); this.loadBreadth(); this.loadHeatmap(); this.loadMatrix(); this.loadMacro(); this.loadSectorPerf();
    if (typeof WATCH !== "undefined") WATCH.render();
    $("#matrixRun").addEventListener("click", () => this.loadMatrix());
    $("#matrixSymbols").addEventListener("keydown", (e) => { if (e.key === "Enter") this.loadMatrix(); });
    $("#matrixRange").addEventListener("change", () => this.loadMatrix());
    $("#matrixEdit").addEventListener("click", () => { const r = $("#matrixEditRow"); r.hidden = !r.hidden; if (!r.hidden) $("#matrixSymbols").focus(); });
    $("#matrixView").addEventListener("click", (e) => {
      const b = e.target.closest("[data-mxview]"); if (!b) return;
      this._mxView = b.dataset.mxview;
      $$("#matrixView [data-mxview]").forEach((x) => x.classList.toggle("on", x === b));
      this.renderMatrix();
    });
    $("#tapeAll").addEventListener("click", () => { this._tapeAll = !this._tapeAll; this.loadTape(); });
    $("#secPerfTf").addEventListener("click", (e) => {
      const b = e.target.closest("[data-sph]"); if (!b) return;
      this._spH = b.dataset.sph;
      $$("#secPerfTf [data-sph]").forEach((x) => x.classList.toggle("on", x === b));
      this.renderSectorPerf();
    });
    const ir = $("#indRun"), is = $("#indSym");
    if (ir) ir.addEventListener("click", () => { const s = (is.value || "").trim().toUpperCase(); if (s) this.loadIndustry(s); });
    if (is) is.addEventListener("keydown", (e) => { if (e.key === "Enter") ir.click(); });
    if (typeof CURRENT !== "undefined" && CURRENT && CURRENT.symbol) { is.value = CURRENT.symbol; this.loadIndustry(CURRENT.symbol); }
    // any NIFTY mover row opens that company in the Research workstation
    ["#miGainers", "#miLosers"].forEach((id) => $(id).addEventListener("click", (e) => {
      const r = e.target.closest("[data-open]"); if (r) loadCompany(r.dataset.open);
    }));
    if (typeof CHARTX !== "undefined") {
      CHARTX.mount(); // CHART ANALYSIS — merged engine: universal search + macro presets + compare + markers
    } else if (typeof mountPriceChart === "function") {
      mountPriceChart({ containerId: "miPriceChart", symbol: "^NSEI", defaultRange: "6M", showSearch: true, title: true, height: 420, liveRefresh: true });
    }
    // start the unified live-price auto-refresh loop
    startLiveRefresh();
  },
  loadMacro() {
    // MACRO COMMAND panels (regime · FII/DII · FX · commodities · macro packs)
    if (typeof MACRO !== "undefined") return MACRO.mount();
  },
  async loadIndustry(symbol) {
    const out = $("#industryOut");
    out.innerHTML = `<div class="loading mono">Analyzing ${esc(symbol)}'s industry — peers, market share, Porter's, economics…</div>`;
    try {
      const d = await api("/api/industry/" + encodeURIComponent(symbol));
      if (d.error) { out.innerHTML = `<div class="empty-mini">${esc(d.error)}</div>`; return; }
      out.innerHTML = renderIndustry(d);
      out.querySelectorAll("[data-indpane]").forEach((b) => b.addEventListener("click", () => {
        out.querySelectorAll("[data-indpane]").forEach((x) => x.classList.toggle("on", x === b));
        out.querySelectorAll("[data-pane]").forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.indpane; });
      }));
    } catch (e) { out.innerHTML = `<div class="empty-mini">${esc(e.message)}</div>`; }
  },
  /* GLOBAL TAPE — card per instrument with an intraday sparkline. Shows the
     indices by default; "View all" adds commodities, FX, rates and crypto. */
  async loadTape() {
    try {
      const data = await api("/api/pulse");
      const G = data.groups || {};
      const list = (this._tapeAll ? Object.values(G).flat() : (G.indices || [])).filter((q) => !q.error);
      const prev = this._tapeCache || {};
      $("#tape").innerHTML = list.map((q) => {
        const changed = prev[q.label] != null && prev[q.label] !== q.price;
        // Treasury yield indices (^TNX/^FVX/^TYX/^IRX) quote a rate, not a price
        const val = YIELD_SYMS.has(q.symbol) ? F.num(q.price, 2) + "%" : F.px(q.price, q.currency);
        const spark = typeof mcSpark === "function" ? mcSpark(q.spark || [], 96, 26, "#2e9e6b") : "";
        return `<button class="tape-cell mi-tc${changed ? " price-flash" : ""}" type="button" data-chart="${esc(q.symbol)}" data-chart-label="${esc(q.label)}" title="Chart ${esc(q.label)}">
          <span class="tl">${esc(q.label)}</span><span class="tp">${val}</span>
          <span class="mi-tc-row"><span class="tc ${F.cls(q.changePct)}">${F.pct(q.changePct, 2)}</span>${spark}</span></button>`;
      }).join("");
      this.layoutTape();
      if (!this._tapeRO && typeof ResizeObserver !== "undefined") {
        this._tapeRO = new ResizeObserver(() => this.layoutTape());
        this._tapeRO.observe($("#tape"));
      }
      this._tapeCache = Object.fromEntries(Object.values(G).flat().map((q) => [q.label, q.price]));
      $("#tapeAsOf").textContent = "as of " + new Date(data.asOf).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
      $("#tapeAll").textContent = this._tapeAll ? "Indices only" : "View all";
    } catch { if (!this._tapeCache) $("#tape").innerHTML = `<div class="loading">tape unavailable</div>`; }
  },
  /* Tape layout: as few rows as fit at a readable card width (~150px), with
     cards spread evenly over those rows — 8 → 8×1 or 4×2, 21 → 5+4+4+4+4.
     Rows of different counts share one grid of LCM columns, so every row
     spans the full width and no cell is ever left empty. */
  layoutTape() {
    const el = $("#tape"); if (!el) return;
    const cards = [...el.querySelectorAll(".mi-tc")], n = cards.length;
    if (!n || !el.clientWidth) return;
    const fit = Math.max(1, Math.floor(el.clientWidth / 140));
    const rows = Math.ceil(n / Math.min(fit, n));
    const base = Math.floor(n / rows), extra = n % rows;   // `extra` rows carry base+1 cards
    const gridCols = extra ? base * (base + 1) : base;
    if (el._cols !== gridCols) { el.style.setProperty("--cols", gridCols); el._cols = gridCols; }
    let i = 0;
    for (let r = 0; r < rows; r++) {
      const inRow = r < extra ? base + 1 : base;
      const span = gridCols / inRow;
      for (let k = 0; k < inRow; k++, i++) cards[i].style.gridColumn = span > 1 ? `span ${span}` : "";
    }
  },
  async loadBreadth() {
    try {
      const b = await api("/api/intel/breadth");
      const tot = b.advancers + b.decliners + b.unchanged || 1;
      const pc = (n) => ((n / tot) * 100).toFixed(1) + "%";
      const row = (dot, label, n, cls) => `<div class="mi-br-row"><span class="mi-dot ${dot}"></span><span class="bl">${label}</span><span class="bv ${cls}">${n}</span><span class="mi-br-pc mono">${pc(n)}</span></div>`;
      $("#breadth").innerHTML = `
        <div class="adbar mi-adbar"><span class="a" style="width:${(b.advancers / tot) * 100}%"></span><span class="u" style="width:${(b.unchanged / tot) * 100}%"></span><span class="d" style="width:${(b.decliners / tot) * 100}%"></span></div>
        ${row("a", "Advancers", b.advancers, "up")}${row("d", "Decliners", b.decliners, "down")}${row("u", "Unchanged", b.unchanged, "")}
        <div class="mi-br-grid">
          <div><small>A/D RATIO</small><b>${b.adRatio ?? "—"}</b></div>
          <div><small>AVG MOVE</small><b class="${F.cls(b.avgChange)}">${F.pct(b.avgChange, 2)}</b></div>
          <div><small>NEAR 52W HIGH</small><b class="up">${b.near52H}</b></div>
          <div><small>NEAR 52W LOW</small><b class="down">${b.near52L}</b></div>
        </div>`;
      this.breadth = b;
      this.renderMovers(b.movers);
      this.renderCommentary();
    } catch { if (!this.breadth) $("#breadth").innerHTML = `<div class="loading">breadth unavailable</div>`; } // live tick keeps last good read
  },
  /* TOP GAINERS / LOSERS — same live batch as breadth (NIFTY 50 universe) */
  renderMovers(m) {
    if (!m) return;
    const table = (rows, empty) => rows.length ? `<table class="dt mc-t mi-t mi-movers">
      <tr><th>#</th><th style="text-align:left">Name</th><th>LTP (₹)</th><th>Chg %</th><th title="Today's volume ÷ 3-month average daily volume">Vol (x)</th></tr>
      ${rows.map((r, i) => `<tr class="mi-mv" data-open="${esc(r.symbol)}" title="Open ${esc(r.name)} in Research">
        <td class="mono mi-rank">${i + 1}</td>
        <td class="nm" style="text-align:left">${esc(r.symbol.replace(/\.NS$/, ""))}</td>
        <td class="mono">${F.num(r.price, 2)}</td>
        <td class="mono ${F.cls(r.changePct)}">${F.pct(r.changePct, 2)}</td>
        <td class="mono">${r.volX == null ? "—" : r.volX.toFixed(1) + "x"}</td></tr>`).join("")}
    </table>` : `<div class="empty-mini mono">${empty}</div>`;
    $("#miGainers").innerHTML = table(m.gainers || [], "No advancing names this session.");
    $("#miLosers").innerHTML = table(m.losers || [], "No declining names this session.");
  },
  async loadHeatmap() {
    try {
      const { sectors } = await api("/api/intel/sectors");
      const hue = (p) => { if (p == null) return "var(--ink-3)"; const c = Math.min(Math.abs(p) / 2.5, 1); return p >= 0 ? `rgba(46,158,107,${0.16 + c * 0.5})` : `rgba(200,75,60,${0.16 + c * 0.5})`; };
      $("#heatmap").innerHTML = sectors.map((s) => s.error ? "" : `<button class="hm-cell" type="button" style="background:${hue(s.changePct)}" data-chart="${esc(s.symbol)}" data-chart-label="NIFTY ${esc(s.label)}" title="Chart NIFTY ${esc(s.label)}"><span class="hl">${esc(s.label)}</span><span class="hp">${F.pct(s.changePct, 2)}</span><span class="hv">${F.num(s.price, 0)}</span></button>`).join("");
    } catch { $("#heatmap").innerHTML = `<div class="loading">sector data unavailable</div>`; }
  },
  async loadMatrix() {
    const symbols = $("#matrixSymbols").value, range = $("#matrixRange").value;
    if (!this.matrix) $("#matrix").innerHTML = `<div class="loading mono">computing…</div>`;
    try {
      this.matrix = await api(`/api/intel/matrix?symbols=${encodeURIComponent(symbols)}&range=${range}`);
      $("#matrixEditRow").hidden = true;
      this.renderMatrix();
      this.renderCommentary();
    } catch { $("#matrix").innerHTML = `<div class="loading">matrix unavailable</div>`; }
  },
  /* Correlation heat-grid, or per-instrument risk (vol / drawdown / momentum) */
  renderMatrix() {
    const m = this.matrix; if (!m) return;
    const short = (s) => s.replace(/\^|=F|=X|-USD|\.NS/g, "").slice(0, 7) || s;
    let html;
    if (this._mxView === "risk") {
      html = `<table class="mx mi-mx"><tr><th>Instrument</th><th>Ann. vol</th><th>Max DD</th><th>1M</th><th>3M</th><th>6M</th></tr>`;
      m.keys.forEach((k) => { const s = m.stats[k]; html += `<tr><th>${esc(short(k))}</th><td>${F.num(s.vol, 1)}%</td><td class="down">${F.num(s.mdd, 1)}%</td><td class="${F.cls(s.mom.m1)}">${F.pct(s.mom.m1)}</td><td class="${F.cls(s.mom.m3)}">${F.pct(s.mom.m3)}</td><td class="${F.cls(s.mom.m6)}">${F.pct(s.mom.m6)}</td></tr>`; });
    } else {
      // diagonal = amber, positive = amber tint, negative = blue tint
      const hue = (v, diag) => v === null ? "" : diag ? "background:rgba(200,134,42,.72);color:#101114" : `background:rgba(${v >= 0 ? "200,134,42" : "90,120,210"},${Math.min(0.62, Math.abs(v) * 0.62)})`;
      html = `<table class="mx mi-mx"><tr><th></th>${m.keys.map((k) => `<th>${esc(short(k))}</th>`).join("")}</tr>`;
      m.matrix.forEach((row, i) => { html += `<tr><th>${esc(short(m.keys[i]))}</th>${row.map((v, j) => `<td style="${hue(v, i === j)}">${v === null ? "—" : v.toFixed(2)}</td>`).join("")}</tr>`; });
    }
    $("#matrix").innerHTML = html + `</table>`;
  },
  /* SECTOR PERFORMANCE — multi-horizon returns, sorted by the chosen horizon */
  async loadSectorPerf() {
    try {
      this._sp = await api("/api/intel/sector-perf"); this.renderSectorPerf();
      // NSE horizons are fetched server-side in the background on a cold cache
      if (this._sp.source !== "NSE" && !this._spRetry && (this._spTries = (this._spTries || 0) + 1) <= 3) {
        this._spRetry = true;
        setTimeout(() => { this._spRetry = false; this.loadSectorPerf(); }, 12000);
      }
    }
    catch { if (!this._sp) $("#miSectorPerf").innerHTML = `<div class="empty-mini mono">sector performance unavailable</div>`; }
  },
  renderSectorPerf() {
    const d = this._sp; if (!d) return;
    const h = this._spH;
    const rows = [...d.rows].sort((a, b) => (b[h] ?? -1e9) - (a[h] ?? -1e9));
    const cell = (v, key) => `<td class="mono ${F.cls(v)}${key === h ? " mi-sel" : ""}">${v == null ? "—" : F.pct(v, 2)}</td>`;
    $("#miSectorPerf").innerHTML = `<div class="table-wrap"><table class="dt mc-t mi-t">
      <tr><th style="text-align:left">Sector</th><th>Last</th><th>1D</th><th>1W</th><th>1M</th><th>1Y</th><th class="mi-sp-h">Today</th></tr>
      ${rows.map((r) => `<tr>
        <td class="nm" style="text-align:left"><button class="mc-link" data-chart="${esc(r.symbol)}" data-chart-label="NIFTY ${esc(r.label)}" type="button">${esc(r.label)}</button></td>
        <td class="mono">${r.price == null ? "—" : F.num(r.price, 0)}</td>
        ${cell(r.d1, "d1")}${cell(r.w1, "w1")}${cell(r.m1, "m1")}${cell(r.y1, "y1")}
        <td class="mi-sp">${mcSpark(r.spark || [], 84, 20, "#2e9e6b")}</td></tr>`).join("")}
    </table></div>
    <div class="idcf-note mi-foot">${d.source === "NSE" ? "1W / 1M / 1Y from NSE index data · price, 1D and intraday path from the live quote · click a sector to chart it" : "Loading 1W / 1M / 1Y from NSE… price and 1D are live"}</div>`;
  },
  /* MARKET ANALYSIS ENGINE — one read per line, each with its own icon */
  renderCommentary() {
    if (!this.breadth) return;
    const b = this.breadth, items = [];
    const I = {
      breadth: `<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>`,
      tilt: `<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>`,
      vol: `<path d="M2 12h4l3-8 4 16 3-8h6"/>`,
      corr: `<rect x="3" y="3" width="18" height="18"/><path d="M3 12h18M12 3v18"/>`,
    };
    items.push(["breadth", `Market breadth is <strong>${b.adRatio >= 1.5 ? "broadly positive" : b.adRatio >= 0.8 ? "mixed" : "negative"}</strong> — A/D ratio ${b.adRatio ?? "—"} across the NIFTY 50 (${b.advancers} up, ${b.decliners} down).`]);
    if (b.near52H || b.near52L) items.push(["tilt", `${b.near52H} name${b.near52H === 1 ? "" : "s"} within 5% of 52-week highs versus ${b.near52L} near lows — a <strong>${b.near52H > b.near52L ? "risk-on" : "defensive"}</strong> tilt.`]);
    if (b.movers && b.movers.gainers[0] && b.movers.losers[0]) items.push(["tilt", `Leader <strong>${esc(b.movers.gainers[0].symbol.replace(/\.NS$/, ""))}</strong> ${F.pct(b.movers.gainers[0].changePct, 2)}; laggard <strong>${esc(b.movers.losers[0].symbol.replace(/\.NS$/, ""))}</strong> ${F.pct(b.movers.losers[0].changePct, 2)}.`]);
    if (this.matrix) {
      const vols = Object.entries(this.matrix.stats).sort((a, c) => (c[1].vol || 0) - (a[1].vol || 0));
      if (vols[0]) items.push(["vol", `Realised volatility is highest in <strong>${esc(vols[0][0].replace(/\^|\.NS|=F|=X|-USD/g, ""))}</strong> (${F.num(vols[0][1].vol, 0)}% annualised).`]);
      items.push(["corr", `Cross-asset correlations in the matrix flag where diversification is real versus illusory.`]);
    }
    $("#marketCommentary").innerHTML = `<ul class="mi-eng">${items.map(([ic, t]) => `<li><svg class="mi-eng-ic" viewBox="0 0 24 24">${I[ic]}</svg><span>${t}</span></li>`).join("")}</ul>`;
  },
};

/* ── LIVE PRICE AUTO-REFRESH ENGINE ──────────────────────────────────────────
   Polls every 15s during market hours (NSE 9:15–15:30 IST, US 9:30–16:00 ET),
   every 60s outside hours. Refreshes: tape, sector heatmap, portfolio, and the
   open-company price in the Research workstation header. Shows a live ● pulse
   indicator so users know prices are updating without a manual refresh. */
let _liveTimer = null;
let _liveCount = 0;

function isMarketHours() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  // IST = UTC+5:30
  const ist = new Date(utc + 5.5 * 3600000);
  const istMin = ist.getHours() * 60 + ist.getMinutes();
  const nseOpen = istMin >= 9 * 60 + 15 && istMin <= 15 * 60 + 30 && ist.getDay() >= 1 && ist.getDay() <= 5;
  // ET = UTC-5 (approx; ignores DST for simplicity)
  const et = new Date(utc - 5 * 3600000);
  const etMin = et.getHours() * 60 + et.getMinutes();
  const usOpen = etMin >= 9 * 60 + 30 && etMin <= 16 * 60 && et.getDay() >= 1 && et.getDay() <= 5;
  return nseOpen || usOpen;
}

function updateLivePulse(inHours) {
  const dot = $("#termLive");
  if (!dot) return;
  dot.className = inHours ? "live-dot on" : "live-dot";
  dot.title = inHours ? "Market hours — refreshing every 15s" : "Outside market hours — refreshing every 60s";
  dot.innerHTML = `<i></i>${inHours ? "LIVE ↻" : "LIVE"}`;
}

async function liveRefreshTick() {
  const inHours = isMarketHours();
  updateLivePulse(inHours);
  _liveCount++;

  // 1. Tape — always refresh
  if (TABS.markets && TABS.markets.loadTape) TABS.markets.loadTape().catch(() => {});

  // 1b. Market breadth — live A/D across the NIFTY universe, every tick
  if (TABS.markets && TABS.markets.loadBreadth) TABS.markets.loadBreadth().catch(() => {});

  // 2. Sector heatmap — every 4 ticks (60s fast / 240s slow)
  if (_liveCount % 4 === 0 && TABS.markets && TABS.markets.loadHeatmap) TABS.markets.loadHeatmap().catch(() => {});
  if (_liveCount % 4 === 0 && TABS.markets && TABS.markets.loaded && TABS.markets.loadSectorPerf) TABS.markets.loadSectorPerf().catch(() => {});

  // 3. Portfolio technicals — only when the portfolio tab is active and a
  //    portfolio with companies is loaded. Indicators are computed off daily
  //    candles, so we throttle to once per 4 ticks (~60s in-hours, 4m out)
  //    rather than every tick — fast enough to catch signal flips, slow
  //    enough to avoid re-fetching 1-year history on every poll.
  if (_liveCount % 4 === 0 && TABS.portfolio && TABS.portfolio.loaded) {
    const pf = TABS.portfolio._active && TABS.portfolio._active();
    const activeTab = document.querySelector(".tab:not([hidden])");
    const isVisible = activeTab && activeTab.id === "tab-portfolio";
    if (isVisible && pf && pf.symbols && pf.symbols.length) {
      TABS.portfolio.refresh({ silent: true }).catch(() => {});
    }
  }

  // 4. Open company price in Research header — update just the price/change cells
  if (CURRENT && CURRENT.symbol) {
    try {
      const q = await api("/api/quote/" + encodeURIComponent(CURRENT.symbol));
      if (q && q.price != null) {
        // update price display in workstation header
        const priceEl = $("#wsPriceLive");
        const changeEl = $("#wsChangeLive");
        if (priceEl) priceEl.textContent = F.px(q.price, q.currency);
        if (changeEl) { changeEl.textContent = (q.changePct >= 0 ? "+" : "") + F.pct(q.changePct, 2); changeEl.className = "ws-change " + F.cls(q.changePct); }
        CURRENT.price = q.price; // keep CURRENT in sync for any downstream computation
      }
    } catch { }
  }

  // 5. Interactive price charts — refresh live last price (intraday ranges fully re-fetched)
  if (typeof refreshAllPriceCharts === "function") {
    try { refreshAllPriceCharts(); } catch { }
  }

  // 6. Portfolio quotes — EVERY tick (15s in-hours) when the tab is visible.
  //    Lightweight: one batch /api/quotes call, diffed cell-level DOM patches
  //    with a gold flash on changed values. The full technical re-scan stays
  //    on the 4-tick cadence above (indicators are daily-candle math).
  if (TABS.portfolio && TABS.portfolio.loaded && typeof TABS.portfolio.refreshQuotes === "function") {
    const activeTab = document.querySelector(".tab:not([hidden])");
    if (activeTab && activeTab.id === "tab-portfolio") {
      TABS.portfolio.refreshQuotes().catch(() => {});
      // Transactions & Performance — full server-side recompute (throttled
      // internally to ~60s; quotes/XIRR/benchmark refresh with gold flash).
      if (typeof TXN !== "undefined") { try { TXN.liveTick(); } catch { } }
    }
  }

  // 7. Price-Action workspace — live candle extension. Re-fetches the active
  //    symbol's series, extends/updates the final candle in place, re-runs
  //    pattern detection + confluence, and preserves the user's zoom/pan.
  if (typeof PA !== "undefined" && PA._mounted) {
    try { PA.liveTick(); } catch { }
  }

  // 8. Market Intelligence live layers — watchlist quotes + the full Macro
  //    Command board (heatmap/regime/curve every tick; charts every 4th tick
  //    with zoom preserved).
  {
    const activeTab = document.querySelector(".tab:not([hidden])");
    if (activeTab && activeTab.id === "tab-markets") {
      if (typeof WATCH !== "undefined" && WATCH.refresh) WATCH.refresh().catch(() => {});
      if (typeof MACRO !== "undefined") { try { MACRO.liveTick(); } catch { } }
    }
  }

  // reschedule at the right interval
  const nextMs = inHours ? 15000 : 60000;
  _liveTimer = setTimeout(liveRefreshTick, nextMs);
}

function startLiveRefresh() {
  if (_liveTimer) clearTimeout(_liveTimer);
  _liveTimer = setTimeout(liveRefreshTick, 15000); // first tick 15s after init
}

async function bootTerminal() {
  initCmd();
  initMobileNav();
  initMobileChartResize();
  // Wait for the user-store to check auth and hydrate per-user data (portfolios,
  // etc.) so modules read the correct values on first open. Resolves fast when
  // signed out or offline.
  try { if (window.MSTORE && window.MSTORE.ready) await window.MSTORE.ready; } catch { }
  const start = (location.hash || "#markets").slice(1);
  showTab(["markets", "research", "earnings", "forensic", "models", "quant", "risk", "reports", "portfolio", "sector", "news", "calc", "learn", "library"].includes(start) ? start : "markets");
}

/* Industry & competitive analysis renderer (Market Intelligence). */
function renderIndustry(d) {
  const N = (x, dp = 1) => x == null || !isFinite(x) ? "—" : x.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  const cap = (v) => v == null ? "—" : v >= 1e12 ? "$" + (v / 1e12).toFixed(2) + "T" : v >= 1e9 ? "$" + (v / 1e9).toFixed(1) + "B" : "$" + (v / 1e6).toFixed(0) + "M";
  const a = d.agg;
  // scorecards
  const attrClass = d.attractiveness === "Attractive" ? "up" : d.attractiveness === "Challenging" ? "down" : "";
  const cards = `<div class="ind-cards">
    <div class="ind-card"><div class="ind-l">INDUSTRY</div><div class="ind-v">${esc(d.meta.industry || d.meta.sector || "—")}</div><div class="ind-s">${esc(d.meta.sector || "")}</div></div>
    <div class="ind-card"><div class="ind-l">LIFECYCLE</div><div class="ind-v">${d.lifecycle}</div><div class="ind-s">${a.medGrowth == null ? "" : N(a.medGrowth, 1) + "% median growth"}</div></div>
    <div class="ind-card"><div class="ind-l">STRUCTURE</div><div class="ind-v">${d.concentration}</div><div class="ind-s">HHI ≈ ${d.hhi}</div></div>
    <div class="ind-card"><div class="ind-l">ATTRACTIVENESS</div><div class="ind-v ${attrClass}">${d.attractiveness}</div><div class="ind-s">Porter avg ${N(d.porterAvg, 1)}/5</div></div>
  </div>`;
  // economics table
  const econ = `<div class="ind-sub mono">INDUSTRY ECONOMICS (peer medians, n=${a.n})</div>
    <table class="dt"><tr><th>Metric</th><th>Industry median</th><th>${d.self ? esc(d.self.name) : "Company"}</th><th>vs peers</th></tr>
    ${[["Revenue growth", a.medGrowth, d.self?.revGrowth, "%"], ["Net margin", a.medNetMargin, d.self?.netMargin, "%"], ["ROE", a.medRoe, d.self?.roe, "%"], ["P/E", a.medPe, d.self?.pe, "×"], ["EV/EBITDA", a.medEvEbitda, d.self?.evEbitda, "×"]]
      .map(([l, m, s, u]) => { const delta = m != null && s != null ? s - m : null; return `<tr><td class="nm">${l}</td><td>${m == null ? "—" : N(m, 1) + u}</td><td>${s == null ? "—" : N(s, 1) + u}</td><td class="${delta == null ? "" : (l === "P/E" || l === "EV/EBITDA" ? (delta <= 0 ? "up" : "down") : (delta >= 0 ? "up" : "down"))}">${delta == null ? "—" : (delta >= 0 ? "+" : "") + N(delta, 1) + u}</td></tr>`; }).join("")}
    </table>`;
  // market share
  const maxShare = Math.max(...d.shares.map((s) => s.share || 0), 1);
  const share = `<div class="ind-sub mono">MARKET SHARE — by market cap (observed peer set)</div>
    <div class="ind-share">${d.shares.slice(0, 8).map((s) => `<div class="ind-sh-row ${s.isSelf ? "self" : ""}"><span class="ind-sh-n">${esc(s.name || s.symbol)}${s.isSelf ? " ◄" : ""}</span><div class="ind-sh-track"><i style="width:${(s.share / maxShare) * 100}%"></i></div><span class="ind-sh-v">${N(s.share, 1)}%</span></div>`).join("")}</div>
    <div class="ind-note">Shares are within the observed listed-peer set, not the total addressable market; treat as relative positioning among comparables.</div>`;
  // porter
  const porter = `<div class="ind-sub mono">PORTER'S FIVE FORCES</div>
    <div class="ind-porter">${d.porter.map((p) => `<div class="ind-pf"><div class="ind-pf-top"><span>${p.force}</span><span class="ind-pf-score s${p.score}">${p.score}/5</span></div><div class="ind-pf-bar"><i class="s${p.score}" style="width:${(p.score / 5) * 100}%"></i></div><div class="ind-pf-note">${p.note}</div></div>`).join("")}</div>
    <div class="ind-note">Scored 1 (favourable to incumbents) → 5 (threatening). Lower average = more attractive industry. Forces blend observed structure with sector heuristics; supplier/substitute scores are directional pending qualitative input.</div>`;
  // one pane at a time keeps the panel the same height as its row neighbours
  const tabs = [["econ", "Economics", econ], ["share", "Market share", share], ["porter", "Porter's 5", porter]];
  return `<div class="mi-ind">${cards}
    <div class="mc-tf mi-ind-tabs">${tabs.map(([k, l], i) => `<button class="mc-tfb ${i ? "" : "on"}" data-indpane="${k}" type="button">${l}</button>`).join("")}</div>
    ${tabs.map(([k, , html], i) => `<div class="mi-ind-pane" data-pane="${k}"${i ? " hidden" : ""}>${html}</div>`).join("")}
  </div>`;
}
// terminal-modules.js calls bootTerminal() after it registers all TABS.
