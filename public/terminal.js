/* MERIDIAN Terminal — application layer.
   Every panel is fed by the live /api/* backend. */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
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
  cap(v, ccy) { if (!v) return "—"; const u = ccy === "INR" ? ["", " K Cr"] : ["", "M", "B", "T"]; if (ccy === "INR") { const cr = v / 1e7; return "₹" + (cr >= 1e5 ? (cr / 1e5).toFixed(2) + " L Cr" : (cr / 1e3).toFixed(1) + " K Cr"); } let n = v, i = 0; while (n >= 1000 && i < 3) { n /= 1000; i++; } return "$" + n.toFixed(1) + ["", "M", "B", "T"][i]; },
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
  forensic:"Forensic Analysis", models:"Modeling Lab", risk:"Risk Center",
  reports:"Report Generation", screener:"Screener", portfolio:"Portfolio",
  news:"News & Sentiment", calc:"Calculators", learn:"Learning Center", library:"Library",
};

function showTab(name) {
  $$(".ttabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  $$(".tab").forEach((t) => (t.hidden = t.id !== "tab-" + name));
  if (TABS[name] && !TABS[name].loaded) { TABS[name].init(); TABS[name].loaded = true; }
  location.hash = name;
  // Sync mobile drawer active state
  $$(".m-drawer-tabs button[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  // Update tbar data attribute so CSS ::after shows current module name
  const tbar = $(".tbar");
  if (tbar) tbar.setAttribute("data-active-tab", TAB_LABELS[name] || name);
  // Close drawer if open
  closeMobileDrawer();
}
$$(".ttabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

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
  const tabBtns = $$(".ttabs button");
  // Group tabs into two sections: core analytics + user tools
  const groups = [
    { label: "Analytics", tabs: ["markets","research","earnings","forensic","models","risk","reports"] },
    { label: "Tools", tabs: ["screener","portfolio","news","calc","learn","library"] },
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

function initCmd() {
  const input = $("#tcmdInput"), results = $("#tcmdResults");
  let timer, items = [], active = -1;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { results.hidden = true; return; }
    timer = setTimeout(async () => {
      try {
        const { results: list } = await api(`/api/search?q=${encodeURIComponent(q)}`);
        items = list; active = -1;
        if (!list.length) return (results.hidden = true);
        results.innerHTML = list.map((it, i) => `<button class="cmd-result" data-i="${i}"><span class="sym">${it.symbol}</span><span class="nm">${it.name}</span><span class="ex">${it.exchange}</span></button>`).join("");
        results.hidden = false;
      } catch { results.hidden = true; }
    }, 200);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); if (active >= 0 && items[active]) loadCompany(items[active].symbol); else if (input.value.trim()) loadCompany(input.value.trim().toUpperCase()); results.hidden = true; }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (!items.length) return; active = (active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; $$(".cmd-result", results).forEach((el, i) => el.classList.toggle("active", i === active)); }
    else if (e.key === "Escape") results.hidden = true;
  });
  results.addEventListener("click", (e) => { const b = e.target.closest(".cmd-result"); if (b) { loadCompany(items[+b.dataset.i].symbol); results.hidden = true; } });
  document.addEventListener("click", (e) => { if (!e.target.closest("#tcmd")) results.hidden = true; });
  document.addEventListener("keydown", (e) => { if ((e.key === "/" || (e.ctrlKey && e.key === "k")) && document.activeElement !== input) { e.preventDefault(); input.focus(); } });
}

/* ════════ TAB · MARKET INTELLIGENCE ════════ */
TABS.markets = {
  init() {
    this.loadTape(); this.loadBreadth(); this.loadHeatmap(); this.loadMatrix(); this.loadMacro();
    $("#matrixRun").addEventListener("click", () => this.loadMatrix());
    const ir = $("#indRun"), is = $("#indSym");
    if (ir) ir.addEventListener("click", () => { const s = (is.value || "").trim().toUpperCase(); if (s) this.loadIndustry(s); });
    if (is) is.addEventListener("keydown", (e) => { if (e.key === "Enter") ir.click(); });
    if (typeof CURRENT !== "undefined" && CURRENT && CURRENT.symbol) { is.value = CURRENT.symbol; this.loadIndustry(CURRENT.symbol); }
    // Mount interactive price chart with NIFTY as default
    if (typeof mountPriceChart === "function") {
      mountPriceChart({ containerId: "miPriceChart", symbol: "^NSEI", defaultRange: "6M", showSearch: true, title: true, height: 420, liveRefresh: true });
    }
    // start the unified live-price auto-refresh loop
    startLiveRefresh();
  },
  async loadMacro() {
    try {
      const d = await api("/api/macro");
      const groups = {};
      d.rows.forEach((r) => { (groups[r.g] ||= []).push(r); });
      $("#macroOut").innerHTML = `<div class="macro-grid">${Object.entries(groups).map(([g, rows]) => `<div class="macro-grp"><div class="macro-gl">${g}</div>${rows.map((r) => `<div class="macro-row"><span class="macro-n">${r.l}</span><span class="macro-p">${r.price == null ? "—" : F.num(r.price, r.price > 1000 ? 0 : 2)}</span><span class="macro-c ${r.change >= 0 ? "up" : "down"}">${r.change == null ? "" : (r.change >= 0 ? "+" : "") + F.num(r.change, 2) + "%"}</span></div>`).join("")}</div>`).join("")}</div>`;
    } catch { $("#macroOut").innerHTML = `<div class="empty-mini">macro snapshot unavailable here (live in your environment)</div>`; }
  },
  async loadIndustry(symbol) {
    $("#industryOut").innerHTML = `<div class="loading mono" style="padding:30px">Analyzing ${symbol}'s industry — peers, market share, Porter's, economics…</div>`;
    try {
      const d = await api("/api/industry/" + encodeURIComponent(symbol));
      if (d.error) { $("#industryOut").innerHTML = `<div class="empty-mini">${d.error}</div>`; return; }
      $("#industryOut").innerHTML = renderIndustry(d);
    } catch (e) { $("#industryOut").innerHTML = `<div class="empty-mini">${e.message}</div>`; }
  },
  async loadTape() {
    try {
      const data = await api("/api/pulse");
      const all = Object.values(data.groups).flat().filter((q) => !q.error);
      // diff against previous values and flash changed cells
      const prev = this._tapeCache || {};
      $("#tape").innerHTML = all.map((q) => {
        const changed = prev[q.label] != null && prev[q.label] !== q.price;
        return `<div class="tape-cell${changed ? " price-flash" : ""}"><div class="tl">${q.label}</div><div class="tp">${F.px(q.price, q.currency)}</div><div class="tc ${F.cls(q.changePct)}">${F.pct(q.changePct, 2)}</div></div>`;
      }).join("");
      this._tapeCache = Object.fromEntries(all.map((q) => [q.label, q.price]));
      $("#tapeAsOf").textContent = "as of " + new Date(data.asOf).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    } catch { $("#tape").innerHTML = `<div class="loading">tape unavailable</div>`; }
  },
  async loadBreadth() {
    try {
      const b = await api("/api/intel/breadth");
      const tot = b.advancers + b.decliners + b.unchanged || 1;
      $("#breadth").innerHTML = `
        <div class="adbar"><span class="a" style="width:${(b.advancers / tot) * 100}%"></span><span class="u" style="width:${(b.unchanged / tot) * 100}%"></span><span class="d" style="width:${(b.decliners / tot) * 100}%"></span></div>
        <div class="brow"><span class="bl">Advancers</span><span class="bv up">${b.advancers}</span></div>
        <div class="brow"><span class="bl">Decliners</span><span class="bv down">${b.decliners}</span></div>
        <div class="brow"><span class="bl">A/D ratio</span><span class="bv">${b.adRatio ?? "—"}</span></div>
        <div class="brow"><span class="bl">Avg move</span><span class="bv ${F.cls(b.avgChange)}">${F.pct(b.avgChange, 2)}</span></div>
        <div class="brow"><span class="bl">Near 52w high</span><span class="bv up">${b.near52H}</span></div>
        <div class="brow"><span class="bl">Near 52w low</span><span class="bv down">${b.near52L}</span></div>`;
      this.breadth = b;
      this.renderCommentary();
    } catch { $("#breadth").innerHTML = `<div class="loading">breadth unavailable</div>`; }
  },
  async loadHeatmap() {
    try {
      const { sectors } = await api("/api/intel/sectors");
      const hue = (p) => { if (p === null) return "var(--ink-3)"; const c = Math.min(Math.abs(p) / 2.5, 1); return p >= 0 ? `rgba(46,158,107,${0.12 + c * 0.5})` : `rgba(200,75,60,${0.12 + c * 0.5})`; };
      $("#heatmap").innerHTML = sectors.map((s) => s.error ? "" : `<div class="hm-cell" style="background:${hue(s.changePct)}"><div class="hl">${s.label}</div><div class="hp ${F.cls(s.change)}">${F.pct(s.changePct, 2)}</div><div class="hv">${F.num(s.price, 0)}</div></div>`).join("");
    } catch { $("#heatmap").innerHTML = `<div class="loading">sector data unavailable</div>`; }
  },
  async loadMatrix() {
    const symbols = $("#matrixSymbols").value, range = $("#matrixRange").value;
    $("#matrix").innerHTML = `<div class="loading mono">computing…</div>`;
    try {
      const m = await api(`/api/intel/matrix?symbols=${encodeURIComponent(symbols)}&range=${range}`);
      const short = (s) => s.replace(/\^|=F|=X|-USD|\.NS/g, "").slice(0, 7) || s;
      const hue = (v) => v === null ? "" : `background:rgba(${v >= 0 ? "200,134,42" : "100,120,200"},${Math.abs(v) * 0.55})`;
      let html = `<table class="mx"><tr><th></th>${m.keys.map((k) => `<th>${short(k)}</th>`).join("")}</tr>`;
      m.matrix.forEach((row, i) => { html += `<tr><th>${short(m.keys[i])}</th>${row.map((v) => `<td style="${hue(v)}">${v === null ? "—" : v.toFixed(2)}</td>`).join("")}</tr>`; });
      html += `</table>`;
      html += `<table class="mx" style="margin-top:0"><tr><th>Instrument</th><th>Ann. vol</th><th>Max DD</th><th>1M</th><th>3M</th><th>6M</th></tr>`;
      m.keys.forEach((k) => { const s = m.stats[k]; html += `<tr><th>${short(k)}</th><td>${F.num(s.vol, 1)}%</td><td class="down">${F.num(s.mdd, 1)}%</td><td class="${F.cls(s.mom.m1)}">${F.pct(s.mom.m1)}</td><td class="${F.cls(s.mom.m3)}">${F.pct(s.mom.m3)}</td><td class="${F.cls(s.mom.m6)}">${F.pct(s.mom.m6)}</td></tr>`; });
      html += `</table>`;
      $("#matrix").innerHTML = html;
      this.matrix = m; this.renderCommentary();
    } catch { $("#matrix").innerHTML = `<div class="loading">matrix unavailable</div>`; }
  },
  renderCommentary() {
    if (!this.breadth) return;
    const b = this.breadth, parts = [];
    parts.push(`Market breadth is <strong>${b.adRatio >= 1.5 ? "broadly positive" : b.adRatio >= 0.8 ? "mixed" : "negative"}</strong> with an advance/decline ratio of ${b.adRatio ?? "—"} across the large-cap universe (${b.advancers} up, ${b.decliners} down).`);
    if (b.near52H || b.near52L) parts.push(`${b.near52H} name${b.near52H === 1 ? "" : "s"} trade within 5% of 52-week highs versus ${b.near52L} near lows — a ${b.near52H > b.near52L ? "risk-on" : "defensive"} tilt.`);
    if (this.matrix) {
      const vols = Object.entries(this.matrix.stats).sort((a, c) => (c[1].vol || 0) - (a[1].vol || 0));
      if (vols[0]) parts.push(`Realised volatility is highest in <strong>${vols[0][0].replace(/\^|\.NS|=F|=X|-USD/g, "")}</strong> (${F.num(vols[0][1].vol, 0)}% annualised); cross-asset correlations in the matrix above flag where diversification is real versus illusory.`);
    }
    $("#marketCommentary").innerHTML = `<div class="tagline">DETERMINISTIC ANALYSIS · COMPUTED FROM LIVE DATA</div>` + parts.map((p) => `<p>${p}</p>`).join("");
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

  // 2. Sector heatmap — every 4 ticks (60s fast / 240s slow)
  if (_liveCount % 4 === 0 && TABS.markets && TABS.markets.loadHeatmap) TABS.markets.loadHeatmap().catch(() => {});

  // 3. Portfolio prices — refresh if portfolio tab is visible
  if (TABS.portfolio && TABS.portfolio.holdings && TABS.portfolio.holdings.length) {
    TABS.portfolio.refresh().catch(() => {});
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

  // reschedule at the right interval
  const nextMs = inHours ? 15000 : 60000;
  _liveTimer = setTimeout(liveRefreshTick, nextMs);
}

function startLiveRefresh() {
  if (_liveTimer) clearTimeout(_liveTimer);
  _liveTimer = setTimeout(liveRefreshTick, 15000); // first tick 15s after init
}

function bootTerminal() {
  initCmd();
  initMobileNav();
  initMobileChartResize();
  const start = (location.hash || "#markets").slice(1);
  showTab(["markets", "research", "earnings", "forensic", "models", "risk", "reports", "screener", "portfolio", "news", "calc", "learn", "library"].includes(start) ? start : "markets");
}

/* Industry & competitive analysis renderer (Market Intelligence). */
function renderIndustry(d) {
  const N = (x, dp = 1) => x == null || !isFinite(x) ? "—" : x.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  const cap = (v) => v == null ? "—" : v >= 1e12 ? "$" + (v / 1e12).toFixed(2) + "T" : v >= 1e9 ? "$" + (v / 1e9).toFixed(1) + "B" : "$" + (v / 1e6).toFixed(0) + "M";
  const a = d.agg;
  // scorecards
  const attrClass = d.attractiveness === "Attractive" ? "up" : d.attractiveness === "Challenging" ? "down" : "";
  const cards = `<div class="ind-cards">
    <div class="ind-card"><div class="ind-l">INDUSTRY</div><div class="ind-v">${d.meta.industry || d.meta.sector || "—"}</div><div class="ind-s">${d.meta.sector || ""}</div></div>
    <div class="ind-card"><div class="ind-l">LIFECYCLE</div><div class="ind-v">${d.lifecycle}</div><div class="ind-s">${a.medGrowth == null ? "" : N(a.medGrowth, 1) + "% median growth"}</div></div>
    <div class="ind-card"><div class="ind-l">STRUCTURE</div><div class="ind-v">${d.concentration}</div><div class="ind-s">HHI ≈ ${d.hhi}</div></div>
    <div class="ind-card"><div class="ind-l">ATTRACTIVENESS</div><div class="ind-v ${attrClass}">${d.attractiveness}</div><div class="ind-s">Porter avg ${N(d.porterAvg, 1)}/5</div></div>
  </div>`;
  // economics table
  const econ = `<div class="ind-sub mono">INDUSTRY ECONOMICS (peer medians, n=${a.n})</div>
    <table class="dt"><tr><th>Metric</th><th>Industry median</th><th>${d.self ? d.self.name : "Company"}</th><th>vs peers</th></tr>
    ${[["Revenue growth", a.medGrowth, d.self?.revGrowth, "%"], ["Net margin", a.medNetMargin, d.self?.netMargin, "%"], ["ROE", a.medRoe, d.self?.roe, "%"], ["P/E", a.medPe, d.self?.pe, "×"], ["EV/EBITDA", a.medEvEbitda, d.self?.evEbitda, "×"]]
      .map(([l, m, s, u]) => { const delta = m != null && s != null ? s - m : null; return `<tr><td class="nm">${l}</td><td>${m == null ? "—" : N(m, 1) + u}</td><td>${s == null ? "—" : N(s, 1) + u}</td><td class="${delta == null ? "" : (l === "P/E" || l === "EV/EBITDA" ? (delta <= 0 ? "up" : "down") : (delta >= 0 ? "up" : "down"))}">${delta == null ? "—" : (delta >= 0 ? "+" : "") + N(delta, 1) + u}</td></tr>`; }).join("")}
    </table>`;
  // market share
  const maxShare = Math.max(...d.shares.map((s) => s.share || 0), 1);
  const share = `<div class="ind-sub mono">MARKET SHARE — by market cap (observed peer set)</div>
    <div class="ind-share">${d.shares.slice(0, 8).map((s) => `<div class="ind-sh-row ${s.isSelf ? "self" : ""}"><span class="ind-sh-n">${s.name || s.symbol}${s.isSelf ? " ◄" : ""}</span><div class="ind-sh-track"><i style="width:${(s.share / maxShare) * 100}%"></i></div><span class="ind-sh-v">${N(s.share, 1)}%</span></div>`).join("")}</div>
    <div class="ind-note">Shares are within the observed listed-peer set, not the total addressable market; treat as relative positioning among comparables.</div>`;
  // porter
  const porter = `<div class="ind-sub mono">PORTER'S FIVE FORCES</div>
    <div class="ind-porter">${d.porter.map((p) => `<div class="ind-pf"><div class="ind-pf-top"><span>${p.force}</span><span class="ind-pf-score s${p.score}">${p.score}/5</span></div><div class="ind-pf-bar"><i class="s${p.score}" style="width:${(p.score / 5) * 100}%"></i></div><div class="ind-pf-note">${p.note}</div></div>`).join("")}</div>
    <div class="ind-note">Scored 1 (favourable to incumbents) → 5 (threatening). Lower average = more attractive industry. Forces blend observed structure with sector heuristics; supplier/substitute scores are directional pending qualitative input.</div>`;
  return cards + econ + share + porter;
}
// terminal-modules.js calls bootTerminal() after it registers all TABS.
