/* ════════════════════════════════════════════════════════════════════
   MERIDIAN · PRICE CHART COMPONENT
   Reusable interactive price chart with range selector (1D–5Y) and
   live-refresh integration. Used by:
     · Market Intelligence (full-size, with symbol search)
     · Equity Research (compact, locked to open company)
   ════════════════════════════════════════════════════════════════════ */

/* Range presets — maps UI label to Yahoo's range + interval combination.
   Intraday intervals only allowed for short ranges (Yahoo restriction). */
const PRICE_CHART_RANGES = [
  { label: "1D",  range: "1d",  interval: "5m"  },
  { label: "5D",  range: "5d",  interval: "30m" },
  { label: "1M",  range: "1mo", interval: "1d"  },
  { label: "3M",  range: "3mo", interval: "1d"  },
  { label: "6M",  range: "6mo", interval: "1d"  },
  { label: "1Y",  range: "1y",  interval: "1d"  },
  { label: "2Y",  range: "2y",  interval: "1wk" },
  { label: "5Y",  range: "5y",  interval: "1wk" },
];

/* Registry of mounted charts — used by liveRefreshTick to refresh all charts. */
const PRICE_CHARTS = {};

/**
 * Mount a price chart into a container.
 * @param {Object} opts
 *   - containerId: DOM id of the wrapper div (must already exist)
 *   - symbol: initial ticker (e.g. "RELIANCE.NS", "^NSEI", "INR=X")
 *   - defaultRange: one of the labels above (default "6M")
 *   - height: pixel height of the canvas (default 380 for full-size)
 *   - showSearch: if true, render a symbol search bar (Market Intelligence)
 *   - compact: if true, render compressed version (Equity Research)
 *   - title: optional title shown above the chart
 *   - liveRefresh: if true, registers in PRICE_CHARTS for liveRefreshTick
 */
function mountPriceChart(opts) {
  const id      = opts.containerId;
  const el      = document.getElementById(id);
  if (!el) return null;
  // If a previous chart was mounted at this container id, unregister it
  if (PRICE_CHARTS[id]) delete PRICE_CHARTS[id];
  const height  = opts.height || (opts.compact ? 220 : 380);
  const range   = opts.defaultRange || (opts.compact ? "1Y" : "6M");

  // Build DOM
  const searchHTML = opts.showSearch
    ? `<div class="pc-search">
         <input id="${id}_sym" type="text" placeholder="Type ticker — RELIANCE.NS, ^NSEI, INR=X, AAPL, BTC-USD" value="${opts.symbol || ""}" spellcheck="false" style="text-transform:uppercase" />
         <button class="mini-btn" id="${id}_go">Load</button>
         <div class="pc-suggest" id="${id}_sugg" hidden></div>
       </div>` : "";

  el.innerHTML = `
    <div class="pc-wrap ${opts.compact ? "pc-compact" : ""}">
      ${opts.title ? `<div class="pc-title"><b id="${id}_name">${opts.symbol || "—"}</b><span class="pc-meta mono" id="${id}_meta"></span></div>` : ""}
      ${searchHTML}
      <div class="pc-head">
        <div class="pc-px-block">
          <div class="pc-px" id="${id}_px">—</div>
          <div class="pc-chg" id="${id}_chg">—</div>
        </div>
        <div class="pc-ranges mono" id="${id}_ranges">
          ${PRICE_CHART_RANGES.map(r => `<button class="pc-rb" data-r="${r.label}">${r.label}</button>`).join("")}
        </div>
      </div>
      <canvas id="${id}_canvas" class="pc-canvas" style="height:${height}px"></canvas>
      <div class="pc-status mono" id="${id}_status"></div>
    </div>
  `;

  // Internal state
  const state = {
    id, symbol: opts.symbol || "", range, height,
    compact: !!opts.compact,
    data: null,           // last fetched history
    lastClose: null,
    sessionOpen: null,    // for 1D, the day's open
    hoverIdx: null,
    raf: null,
  };
  PRICE_CHARTS[id] = state;

  // Bind range buttons
  el.querySelectorAll(`#${id}_ranges .pc-rb`).forEach(btn => {
    btn.classList.toggle("active", btn.dataset.r === range);
    btn.addEventListener("click", () => {
      state.range = btn.dataset.r;
      el.querySelectorAll(`#${id}_ranges .pc-rb`).forEach(b => b.classList.toggle("active", b === btn));
      loadAndDraw(state);
    });
  });

  // Bind search if present
  if (opts.showSearch) {
    const input = document.getElementById(`${id}_sym`);
    const go    = document.getElementById(`${id}_go`);
    const sugg  = document.getElementById(`${id}_sugg`);
    let suggTimer = null;
    const doLoad = () => {
      const s = (input.value || "").trim().toUpperCase();
      if (!s) return;
      state.symbol = s;
      sugg.hidden = true;
      loadAndDraw(state);
    };
    go.addEventListener("click", doLoad);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") doLoad(); });
    input.addEventListener("input", () => {
      clearTimeout(suggTimer);
      const q = input.value.trim();
      if (q.length < 2) { sugg.hidden = true; return; }
      suggTimer = setTimeout(async () => {
        try {
          const r = await api("/api/search?q=" + encodeURIComponent(q));
          const items = (r.results || []).slice(0, 8);
          if (!items.length) { sugg.hidden = true; return; }
          sugg.innerHTML = items.map(it => `<div class="pc-sugg-item" data-s="${it.symbol}">
              <b>${it.symbol}</b><span>${(it.shortname || it.longname || "").slice(0, 50)}</span>
              <i>${it.exchDisp || it.exchange || ""}</i></div>`).join("");
          sugg.hidden = false;
          sugg.querySelectorAll(".pc-sugg-item").forEach(d => d.addEventListener("click", () => {
            input.value = d.dataset.s;
            sugg.hidden = true;
            doLoad();
          }));
        } catch { sugg.hidden = true; }
      }, 250);
    });
    // Hide suggestions on outside click
    document.addEventListener("click", (e) => {
      if (!e.target.closest(`#${id}_sugg`) && e.target !== input) sugg.hidden = true;
    });
  }

  // Canvas hover for tooltip
  const canvas = document.getElementById(`${id}_canvas`);
  canvas.addEventListener("mousemove", (e) => {
    if (!state.data || !state.data.points || !state.data.points.length) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = x / rect.width;
    const idx = Math.min(state.data.points.length - 1, Math.max(0, Math.round(ratio * (state.data.points.length - 1))));
    state.hoverIdx = idx;
    drawChart(state);
  });
  canvas.addEventListener("mouseleave", () => { state.hoverIdx = null; drawChart(state); });
  window.addEventListener("resize", () => { if (state.data) drawChart(state); });

  // Initial load
  if (opts.symbol) loadAndDraw(state);

  return state;
}

async function loadAndDraw(state) {
  const sym = state.symbol;
  if (!sym) return;
  const meta = PRICE_CHART_RANGES.find(r => r.label === state.range);
  if (!meta) return;
  const statusEl = document.getElementById(`${state.id}_status`);
  if (statusEl) statusEl.textContent = "loading…";
  try {
    // Fetch in parallel: history + spot quote for live last price
    const [hist, quote] = await Promise.all([
      api(`/api/history/${encodeURIComponent(sym)}?range=${meta.range}&interval=${meta.interval}`).catch(() => null),
      api(`/api/quote/${encodeURIComponent(sym)}`).catch(() => null),
    ]);
    if (!hist || !hist.points || !hist.points.length) {
      if (statusEl) statusEl.textContent = "no data for " + sym;
      return;
    }
    // Keep only points with a valid close
    const points = hist.points.filter(p => p.c != null && isFinite(p.c));
    if (!points.length) { if (statusEl) statusEl.textContent = "no valid closes"; return; }

    // Splice the live last price in if it's fresher than the last bar
    if (quote && quote.price && isFinite(quote.price)) {
      const lastTime = points[points.length - 1].t;
      const nowTime = Date.now();
      // For intraday range, replace last point if quote is fresher
      if (state.range === "1D" || state.range === "5D") {
        if (Math.abs(nowTime - lastTime) > 60000) points[points.length - 1].c = quote.price;
        else points[points.length - 1].c = quote.price;
      } else {
        // For daily/weekly, only override if same trading day
        const d1 = new Date(lastTime).toISOString().slice(0, 10);
        const d2 = new Date(nowTime).toISOString().slice(0, 10);
        if (d1 === d2) points[points.length - 1].c = quote.price;
      }
    }

    state.data = { ...hist, points, quote, ccy: hist.currency || (quote && quote.currency) || "" };
    // Name / meta header
    const nameEl = document.getElementById(`${state.id}_name`);
    const metaEl = document.getElementById(`${state.id}_meta`);
    if (nameEl) nameEl.textContent = (quote && (quote.shortName || quote.longName)) || sym;
    if (metaEl) metaEl.textContent = sym + " · " + (state.data.ccy || "");

    drawChart(state);
    if (statusEl) statusEl.textContent = "";
  } catch (err) {
    if (statusEl) statusEl.textContent = "error loading " + sym;
  }
}

function drawChart(state) {
  const canvas = document.getElementById(`${state.id}_canvas`);
  if (!canvas || !state.data) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = canvas.offsetWidth || 600;
  const H = state.height || 380;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const points = state.data.points;
  const closes = points.map(p => p.c);
  const lo = Math.min(...closes);
  const hi = Math.max(...closes);
  const span = (hi - lo) || 1;
  const pad = state.compact
    ? { l: 50, r: 12, t: 8, b: 22 }
    : { l: 64, r: 16, t: 14, b: 32 };
  const cw = W - pad.l - pad.r;
  const ch = H - pad.t - pad.b;

  const x = i => pad.l + (i / Math.max(1, points.length - 1)) * cw;
  const y = v => pad.t + ch - ((v - lo) / span) * ch;

  // Determine line color: green if up over the range, red if down
  const first = closes[0], last = closes[closes.length - 1];
  const isUp = last >= first;
  const lineColor = isUp ? "#2e9e6b" : "#c84b3c";
  const fillTop   = isUp ? "rgba(46,158,107,.18)" : "rgba(200,75,60,.18)";
  const fillBot   = isUp ? "rgba(46,158,107,0)"   : "rgba(200,75,60,0)";

  // Grid
  ctx.strokeStyle = "rgba(35,42,51,.7)";
  ctx.fillStyle = "#7a8290";
  ctx.font = (state.compact ? "9px " : "10px ") + "monospace";
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i++) {
    const v = lo + (span * i / 4);
    const yy = y(v);
    ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(W - pad.r, yy); ctx.stroke();
    ctx.fillText(fmtPrice(v, state.data.ccy), pad.l - 6, yy + 3);
  }
  // X axis labels — pick ~5 evenly spaced timestamps
  ctx.textAlign = "center";
  const ticks = state.compact ? 4 : 6;
  for (let i = 0; i < ticks; i++) {
    const idx = Math.floor(i * (points.length - 1) / Math.max(1, ticks - 1));
    const t = points[idx].t;
    const lbl = fmtDate(t, state.range);
    ctx.fillText(lbl, x(idx), H - 10);
  }

  // Area fill under line
  const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ch);
  grad.addColorStop(0, fillTop); grad.addColorStop(1, fillBot);
  ctx.fillStyle = grad; ctx.beginPath();
  points.forEach((p, i) => { i === 0 ? ctx.moveTo(x(i), y(p.c)) : ctx.lineTo(x(i), y(p.c)); });
  ctx.lineTo(x(points.length - 1), pad.t + ch);
  ctx.lineTo(x(0), pad.t + ch);
  ctx.closePath(); ctx.fill();

  // Line
  ctx.strokeStyle = lineColor; ctx.lineWidth = state.compact ? 1.4 : 1.8;
  ctx.beginPath();
  points.forEach((p, i) => { i === 0 ? ctx.moveTo(x(i), y(p.c)) : ctx.lineTo(x(i), y(p.c)); });
  ctx.stroke();

  // Hover crosshair + tooltip
  if (state.hoverIdx != null && state.hoverIdx >= 0 && state.hoverIdx < points.length) {
    const hp = points[state.hoverIdx];
    const hx = x(state.hoverIdx);
    const hy = y(hp.c);
    ctx.strokeStyle = "rgba(200,134,42,.5)"; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(hx, pad.t); ctx.lineTo(hx, pad.t + ch); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#c8862a"; ctx.beginPath(); ctx.arc(hx, hy, 3.5, 0, Math.PI * 2); ctx.fill();
    // Tooltip
    const tipLines = [fmtDate(hp.t, state.range, true), fmtPrice(hp.c, state.data.ccy)];
    const tw = state.compact ? 110 : 140;
    const th = tipLines.length * 14 + 10;
    let tx = hx + 10; if (tx + tw > W) tx = hx - tw - 10;
    const ty = pad.t + 6;
    ctx.fillStyle = "rgba(15,18,22,.95)"; ctx.fillRect(tx, ty, tw, th);
    ctx.strokeStyle = "rgba(200,134,42,.4)"; ctx.strokeRect(tx, ty, tw, th);
    ctx.fillStyle = "#e8eaed"; ctx.textAlign = "left"; ctx.font = "11px monospace";
    tipLines.forEach((l, i) => ctx.fillText(l, tx + 8, ty + 16 + i * 14));
  }

  // Update header price
  const pxEl = document.getElementById(`${state.id}_px`);
  const chgEl = document.getElementById(`${state.id}_chg`);
  if (pxEl) pxEl.textContent = fmtPrice(last, state.data.ccy);
  if (chgEl) {
    const chg = last - first;
    const pct = first ? (chg / first * 100) : 0;
    chgEl.textContent = (chg >= 0 ? "+" : "") + fmtPrice(chg, state.data.ccy) + " (" + (pct >= 0 ? "+" : "") + pct.toFixed(2) + "%)";
    chgEl.className = "pc-chg " + (chg >= 0 ? "up" : "down");
  }
}

function fmtPrice(v, ccy) {
  if (v == null || !isFinite(v)) return "—";
  const sym = ccy === "INR" ? "₹" : ccy === "USD" ? "$" : ccy === "EUR" ? "€" : ccy === "GBP" ? "£" : "";
  // Use Indian formatting for INR, US for USD, generic for rest
  if (sym === "₹") return sym + Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  if (sym === "$") return sym + Number(v).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  return sym + Number(v).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function fmtDate(t, range, full) {
  const d = new Date(t);
  if (range === "1D") {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  if (range === "5D") {
    return d.toLocaleDateString([], { day: "2-digit", month: "short" }) + (full ? " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "");
  }
  if (range === "1M" || range === "3M" || range === "6M" || range === "1Y") {
    return d.toLocaleDateString([], { day: "2-digit", month: "short" });
  }
  return d.toLocaleDateString([], { month: "short", year: "2-digit" });
}

/** Called by liveRefreshTick — refresh all mounted charts on intraday ranges. */
function refreshAllPriceCharts() {
  Object.entries(PRICE_CHARTS).forEach(([id, state]) => {
    if (!state || !state.symbol) return;
    // If the canvas was removed from DOM (tab changed, content replaced), unregister
    if (!document.getElementById(`${id}_canvas`)) { delete PRICE_CHARTS[id]; return; }
    // Only re-fetch for intraday ranges (1D, 5D) — longer ranges don't change minute-to-minute
    if (state.range === "1D" || state.range === "5D") {
      loadAndDraw(state);
    } else {
      refreshLastPrice(state);
    }
  });
}

async function refreshLastPrice(state) {
  if (!state.symbol || !state.data) return;
  try {
    const q = await api(`/api/quote/${encodeURIComponent(state.symbol)}`);
    if (q && q.price && isFinite(q.price)) {
      const points = state.data.points;
      const lastTime = points[points.length - 1].t;
      const d1 = new Date(lastTime).toISOString().slice(0, 10);
      const d2 = new Date().toISOString().slice(0, 10);
      if (d1 === d2) {
        points[points.length - 1].c = q.price;
        drawChart(state);
      }
    }
  } catch { /* silent */ }
}
