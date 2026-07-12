/* ════════════════════════════════════════════════════════════════════════
   MERIDIAN · CONTEXT, COMMAND PALETTE & WATCHLIST
   Loaded between terminal.js (core helpers) and terminal-modules.js (TABS).

   · MRD_RECENTS — recently-opened tickers (localStorage `meridian_recents`;
     the meridian_ prefix means the signed-in user-store syncs it for free).
   · PALETTE    — Ctrl/Cmd+K command palette: jump to any module, reopen a
     recent ticker, or live-search any symbol. Keyboard-first, Bloomberg-
     style: the fastest path from intent to screen.
   · WATCH      — watchlist store (`meridian_watchlist`) + the live strip on
     Market Intelligence + the ☆ toggle in the Research workstation header.
   ════════════════════════════════════════════════════════════════════════ */
"use strict";

/* ── Recent tickers ─────────────────────────────────────────────────────── */
const MRD_RECENTS = {
  KEY: "meridian_recents",
  MAX: 8,
  all() {
    try { return JSON.parse(localStorage.getItem(this.KEY) || "[]"); } catch { return []; }
  },
  push(symbol, name) {
    if (!symbol) return;
    const list = this.all().filter((r) => r.symbol !== symbol);
    list.unshift({ symbol, name: name || symbol, ts: Date.now() });
    try { localStorage.setItem(this.KEY, JSON.stringify(list.slice(0, this.MAX))); } catch { }
  },
};

/* ── Watchlist ──────────────────────────────────────────────────────────── */
const WATCH = {
  KEY: "meridian_watchlist",
  _prev: {},           // symbol → last price (for change-flash diffing)
  all() {
    try { return JSON.parse(localStorage.getItem(this.KEY) || "[]"); } catch { return []; }
  },
  has(symbol) { return this.all().some((w) => w.symbol === symbol); },
  add(symbol, name) {
    if (!symbol || this.has(symbol)) return false;
    const list = this.all();
    list.unshift({ symbol, name: name || symbol });
    try { localStorage.setItem(this.KEY, JSON.stringify(list.slice(0, 30))); } catch { }
    this.render();
    this.syncStar();
    return true;
  },
  /* ticker/name search box in the Watchlist header — combined macro presets
     (so indices/FX/commodities are addable too) + live Yahoo ticker search */
  wireAdd() {
    const input = document.getElementById("watchAdd");
    const drop = document.getElementById("watchAddDrop");
    if (!input || !drop || input._wired) return;
    input._wired = true;
    let t = null, seq = 0;
    const close = () => { drop.hidden = true; };
    const presets = (typeof CX_PRESETS !== "undefined") ? CX_PRESETS : [];
    input.addEventListener("input", () => {
      const q = input.value.trim();
      clearTimeout(t);
      if (q.length < 2) { close(); return; }
      const ql = q.toLowerCase(), mySeq = ++seq;
      const pre = presets.filter(([sym, l, g]) => l.toLowerCase().includes(ql) || sym.toLowerCase().includes(ql) || (g || "").toLowerCase().includes(ql)).slice(0, 5);
      const render = (tickers) => {
        if (!pre.length && !tickers.length) { close(); return; }
        drop.innerHTML =
          (pre.length ? `<div class="cx-dh mono">MACRO</div>` + pre.map((p) => `<button class="cx-di" type="button" data-s="${esc(p[0])}" data-l="${esc(p[1])}"><b>${esc(p[1])}</b><span class="mono">${esc(p[0])} · ${esc(p[2])}</span></button>`).join("") : "") +
          (tickers.length ? `<div class="cx-dh mono">TICKERS</div>` + tickers.map((r) => `<button class="cx-di" type="button" data-s="${esc(r.symbol)}" data-l="${esc(r.name || r.symbol)}"><b>${esc(r.symbol)}</b><span class="mono">${esc((r.name || "").slice(0, 42))}${r.exchange ? " · " + esc(r.exchange) : ""}</span></button>`).join("") : "");
        drop.hidden = false;
      };
      render([]);
      t = setTimeout(async () => {
        try { const d = await api(`/api/search?q=${encodeURIComponent(q)}`); if (mySeq === seq) render((d.results || []).slice(0, 7)); }
        catch { /* presets already shown */ }
      }, 240);
    });
    drop.addEventListener("mousedown", (e) => {
      const it = e.target.closest(".cx-di"); if (!it) return;
      e.preventDefault();
      this.add(it.dataset.s, it.dataset.l);
      input.value = ""; close();
    });
    input.addEventListener("blur", () => setTimeout(close, 140));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { close(); input.blur(); }
      if (e.key === "Enter") { const f = drop.querySelector(".cx-di"); if (f && !drop.hidden) { this.add(f.dataset.s, f.dataset.l); input.value = ""; close(); } }
    });
  },
  toggle(symbol, name) {
    let list = this.all();
    if (list.some((w) => w.symbol === symbol)) list = list.filter((w) => w.symbol !== symbol);
    else list.unshift({ symbol, name: name || symbol });
    try { localStorage.setItem(this.KEY, JSON.stringify(list.slice(0, 30))); } catch { }
    this.render();
    this.syncStar();
    return this.has(symbol);
  },
  /* ☆/★ in the Research workstation header */
  syncStar() {
    const btn = document.getElementById("wsWatchBtn");
    if (!btn || typeof CURRENT === "undefined" || !CURRENT) return;
    const on = this.has(CURRENT.symbol);
    btn.classList.toggle("on", on);
    btn.innerHTML = on ? "★ Watching" : "☆ Watch";
    btn.title = on ? "Remove from watchlist" : "Add to watchlist";
  },
  /* Watchlist strip on Market Intelligence */
  render() {
    const host = document.getElementById("watchList");
    if (!host) return;
    const list = this.all();
    const count = document.getElementById("watchCount");
    if (count) count.textContent = list.length ? `${list.length} name${list.length === 1 ? "" : "s"} · live` : "";
    this.wireAdd();
    if (!list.length) {
      host.innerHTML = `<div class="empty-mini mono">Star a company from its Research page (☆ Watch) — live quotes for your names appear here.</div>`;
      return;
    }
    host.innerHTML = `<div class="wl-head mono"><span>Symbol</span><span>Name</span><span class="wl-h-px">Price</span><span class="wl-h-chg">Chg %</span><span class="wl-h-x"></span></div>` + list.map((w) => `
      <div class="wl-row" data-s="${esc(w.symbol)}">
        <button class="wl-open" data-open="${esc(w.symbol)}" title="Open in Research">
          <span class="wl-sym">${esc(w.symbol)}</span><span class="wl-nm">${esc(w.name || "")}</span>
        </button>
        <span class="wl-px mono" data-px>—</span>
        <span class="wl-chg mono" data-chg></span>
        <button class="wl-del" data-del="${esc(w.symbol)}" title="Remove">×</button>
      </div>`).join("");
    host.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => loadCompany(b.dataset.open)));
    host.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); this.toggle(b.dataset.del); }));
    this.refresh().catch(() => {});
  },
  /* Live quote refresh — patches only changed cells, gold flash on change. */
  async refresh() {
    const list = this.all();
    if (!list.length) return;
    const d = await api(`/api/quotes?symbols=${encodeURIComponent(list.map((w) => w.symbol).join(","))}`);
    const quotes = d.quotes || d || [];
    for (const q of quotes) {
      if (!q || q.error || q.price == null) continue;
      const row = document.querySelector(`#watchList .wl-row[data-s="${CSS.escape(q.symbol)}"]`);
      if (!row) continue;
      const pxEl = row.querySelector("[data-px]"), chEl = row.querySelector("[data-chg]");
      const changed = this._prev[q.symbol] != null && this._prev[q.symbol] !== q.price;
      if (pxEl) { pxEl.textContent = F.px(q.price, q.currency); if (changed) goldFlash(pxEl); }
      if (chEl) { chEl.textContent = F.pct(q.changePct, 2); chEl.className = "wl-chg mono " + F.cls(q.changePct); }
      this._prev[q.symbol] = q.price;
    }
  },
};

/* ── Command palette ────────────────────────────────────────────────────── */
const PALETTE = {
  el: null, input: null, list: null,
  items: [], active: 0, _searchTimer: null, _searchResults: [],
  MODULES: [
    ["markets", "Market Intelligence", "tape · breadth · heatmap · macro"],
    ["research", "Equity Research", "full workstation for any ticker"],
    ["models", "Modeling Lab", "institutional DCF · reverse DCF · tornado"],
    ["forensic", "Forensic Analysis", "Piotroski · Altman · Beneish"],
    ["risk", "Risk Center", "risk assessment"],
    ["earnings", "Earnings Call", "transcripts & analysis"],
    ["reports", "Report Generation", "initiating coverage · memos"],
    ["portfolio", "Portfolio", "holdings · technicals · price action"],
    ["sector", "Sector Analysis", "sector deep-dives"],
    ["news", "News & Sentiment", "headlines · event tags"],
    ["calc", "Calculators", "investment & ESOP suites"],
    ["learn", "Learning Center", "concepts & formulas"],
    ["library", "Library", "saved research"],
  ],
  ensure() {
    if (this.el) return;
    const wrap = document.createElement("div");
    wrap.id = "mrdPalette";
    wrap.innerHTML = `
      <div class="pal-backdrop"></div>
      <div class="pal-box" role="dialog" aria-label="Command palette">
        <input id="palInput" type="text" placeholder="Jump to a module, reopen a recent name, or search any ticker…" autocomplete="off" spellcheck="false" />
        <div id="palList" class="pal-list"></div>
        <div class="pal-hint mono">↑↓ navigate · Enter open · Esc close</div>
      </div>`;
    document.body.appendChild(wrap);
    this.el = wrap;
    this.input = wrap.querySelector("#palInput");
    this.list = wrap.querySelector("#palList");
    wrap.querySelector(".pal-backdrop").addEventListener("click", () => this.close());
    this.input.addEventListener("input", () => this.update());
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); this.close(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); this.move(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); this.move(-1); }
      else if (e.key === "Enter") { e.preventDefault(); this.exec(this.items[this.active]); }
    });
    this.list.addEventListener("click", (e) => {
      const b = e.target.closest("[data-i]");
      if (b) this.exec(this.items[+b.dataset.i]);
    });
  },
  open() {
    this.ensure();
    this.el.classList.add("open");
    this.input.value = "";
    this._searchResults = [];
    this.update();
    requestAnimationFrame(() => this.input.focus());
  },
  close() { if (this.el) this.el.classList.remove("open"); },
  isOpen() { return !!(this.el && this.el.classList.contains("open")); },
  move(d) {
    if (!this.items.length) return;
    this.active = (this.active + d + this.items.length) % this.items.length;
    this.paint();
  },
  exec(item) {
    if (!item) return;
    this.close();
    if (item.kind === "tab") showTab(item.id);
    else if (item.kind === "ticker") loadCompany(item.symbol);
  },
  update() {
    const q = this.input.value.trim();
    const ql = q.toLowerCase();
    const items = [];

    // module jumps (fuzzy contains on name + description)
    for (const [id, label, sub] of this.MODULES) {
      if (!q || label.toLowerCase().includes(ql) || sub.includes(ql) || id.includes(ql)) {
        items.push({ kind: "tab", id, label, sub, group: "MODULES" });
      }
    }
    // recents
    for (const r of MRD_RECENTS.all()) {
      if (!q || r.symbol.toLowerCase().includes(ql) || (r.name || "").toLowerCase().includes(ql)) {
        items.push({ kind: "ticker", symbol: r.symbol, label: r.symbol, sub: r.name, group: "RECENT" });
      }
    }
    // live symbol search (debounced; results merged on arrival)
    if (q.length >= 2) {
      for (const s of this._searchResults) {
        if (!items.some((i) => i.kind === "ticker" && i.symbol === s.symbol)) {
          items.push({ kind: "ticker", symbol: s.symbol, label: s.symbol, sub: `${s.name || ""} · ${s.exchange || ""}`, group: "SEARCH" });
        }
      }
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(async () => {
        try {
          const { results } = await api(`/api/search?q=${encodeURIComponent(q)}`);
          if (this.input.value.trim() === q) { this._searchResults = results || []; this.update(); }
        } catch { }
      }, 220);
    }

    this.items = items.slice(0, 14);
    this.active = 0;
    this.paint();
  },
  paint() {
    if (!this.items.length) {
      this.list.innerHTML = `<div class="pal-empty mono">No matches — keep typing to search all listed symbols.</div>`;
      return;
    }
    let lastGroup = null, html = "";
    this.items.forEach((it, i) => {
      if (it.group !== lastGroup) { html += `<div class="pal-grp mono">${it.group}</div>`; lastGroup = it.group; }
      html += `<button class="pal-item ${i === this.active ? "active" : ""}" data-i="${i}">
        <span class="pal-l">${it.kind === "tab" ? "▤" : "◈"} ${esc(it.label)}</span>
        <span class="pal-s">${esc(it.sub || "")}</span></button>`;
    });
    this.list.innerHTML = html;
    const act = this.list.querySelector(".pal-item.active");
    if (act) act.scrollIntoView({ block: "nearest" });
  },
};

/* Esc closes the palette from anywhere */
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && PALETTE.isOpen()) PALETTE.close();
});
