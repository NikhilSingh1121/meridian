/* ════════════════════════════════════════════════════════════════════════
   MERIDIAN · MACRO COMMAND
   Full macro-economic analysis inside Market Intelligence:

   · RISK REGIME — rule-based cross-asset composite (VIX · dollar · copper/
     gold impulse · US 10Y direction) with the contributing reads shown.
   · MACRO HEATMAP — every tracked instrument tiled by category (India &
     global equity, US rates, FX, commodities, volatility, crypto), colour
     = day change, click any tile to chart it. Live quotes with gold flash.
   · ANALYSIS CHARTS — two zoomable chart stations (wheel-zoom around the
     cursor, drag-pan, double-click reset, crosshair readout). Each station:
     any macro series, 1M/3M/1Y/5Y ranges, optional second series overlaid
     on a normalized %-change axis, a computed indicator strip (returns,
     50/200-DMA position, RSI-14, annualized vol, max drawdown) and a
     rule-based macro read specific to the instrument.
   · US YIELD CURVE — 3M/5Y/10Y/30Y with the 10Y−3M spread and inversion
     callout.

   All data flows through the terminal's existing proven providers
   (/api/macro quotes, /api/history series) — no new external dependencies.
   ════════════════════════════════════════════════════════════════════════ */
"use strict";

/* ── series math (self-contained, pure) ─────────────────────────────────── */
const MC_MATH = {
  sma(vals, n) {
    if (vals.length < n) return null;
    let s = 0;
    for (let i = vals.length - n; i < vals.length; i++) s += vals[i];
    return s / n;
  },
  rsi14(vals) {
    if (vals.length < 15) return null;
    let g = 0, l = 0;
    for (let i = vals.length - 14; i < vals.length; i++) {
      const d = vals[i] - vals[i - 1];
      if (d >= 0) g += d; else l -= d;
    }
    if (g + l === 0) return 50;
    const rs = l === 0 ? 100 : g / l;
    return 100 - 100 / (1 + rs);
  },
  annVol(vals) {
    if (vals.length < 20) return null;
    const rets = [];
    for (let i = 1; i < vals.length; i++) if (vals[i - 1] > 0) rets.push(Math.log(vals[i] / vals[i - 1]));
    const m = rets.reduce((s, x) => s + x, 0) / rets.length;
    const v = rets.reduce((s, x) => s + (x - m) * (x - m), 0) / (rets.length - 1);
    return Math.sqrt(v) * Math.sqrt(252) * 100;
  },
  maxDD(vals) {
    let peak = -Infinity, dd = 0;
    for (const v of vals) { if (v > peak) peak = v; if (peak > 0) dd = Math.min(dd, (v - peak) / peak); }
    return dd * 100;
  },
  ret(vals, n) {
    if (vals.length < 2) return null;
    const a = n == null ? vals[0] : vals[Math.max(0, vals.length - 1 - n)];
    const b = vals[vals.length - 1];
    return a > 0 ? ((b - a) / a) * 100 : null;
  },
};

/* shared series palette (compare overlays in chart-analysis.js) */
const MC_PALETTE = ["#c8862a", "#7aa5c8", "#2e9e6b", "#9b7fc8", "#4fb3a9"];

/* ── per-instrument macro reads (rule-based, references computed stats) ──── */
function mcCommentFor(sym, st) {
  const dir = st.retRange == null ? "" : st.retRange >= 0 ? "up" : "down";
  const mag = st.retRange == null ? "" : Math.abs(st.retRange).toFixed(1) + "%";
  const trend = st.above200 == null ? "" : st.above200 ? "above" : "below";
  const T = {
    "USDINR=X": () => `USD/INR ${dir} ${mag} over the window, trading ${trend} its 200-DMA. A weakening rupee imports inflation and squeezes oil-importer margins, while cushioning IT and pharma exporters; sustained moves pressure the RBI's rate path.`,
    "DX-Y.NYB": () => `The dollar index is ${dir} ${mag} and ${trend} its 200-DMA. Dollar strength is the single biggest headwind for EM flows — FII selling in India historically clusters in rising-DXY regimes.`,
    "CL=F": () => `WTI ${dir} ${mag} across the window. Every sustained $10 move in crude swings India's import bill by roughly $12–15bn annually — falling crude is a margin tailwind for OMCs, paints, aviation and a CAD/INR positive.`,
    "BZ=F": () => `Brent ${dir} ${mag}. India imports ~85% of its crude — Brent directly drives the import bill, pump-price politics, and the margin structure of OMCs, paints, tyres and aviation.`,
    "GC=F": () => `Gold ${dir} ${mag}, ${trend} the 200-DMA. Gold rallies signal defensive positioning and real-rate expectations rolling over; for India they also pressure the trade deficit through import demand.`,
    "HG=F": () => `Copper — the metal with a PhD in economics — is ${dir} ${mag}. Rising copper reads as a global growth impulse (China construction, grids, EVs); copper strength alongside falling gold is a classic risk-on signature.`,
    "^TNX": () => `The US 10Y is at ${st.last?.toFixed(2)}%. Rising long yields compress equity multiples (especially long-duration growth) and historically pull FII money out of EM bonds and equities; falling yields do the reverse.`,
    "^VIX": () => `VIX at ${st.last?.toFixed(1)} — ${st.last < 13 ? "complacency zone: hedges are cheap and crowded positioning is the risk" : st.last < 20 ? "normal regime" : st.last < 28 ? "stress regime: correlations rise and liquidity thins" : "panic regime: forced deleveraging dominates price action"}.`,
    "^INDIAVIX": () => `India VIX at ${st.last?.toFixed(1)} — ${st.last < 12 ? "unusually calm; option sellers dominate and gap risk is under-priced" : st.last < 18 ? "normal Indian-market volatility" : "elevated: event risk or FII de-risking in play"}.`,
    "BTC-USD": () => `Bitcoin ${dir} ${mag}, RSI ${st.rsi?.toFixed(0)}. Crypto now trades as the highest-beta expression of global liquidity — its direction often front-runs risk appetite in equities.`,
    "^NSEI": () => `NIFTY ${dir} ${mag} over the window, ${trend} its 200-DMA with RSI ${st.rsi?.toFixed(0)}. ${st.above200 ? "Primary trend intact — dips remain buyable until the 200-DMA breaks on volume." : "Below the 200-DMA the burden of proof is on the bulls; rallies into the average tend to get sold."}`,
  };
  const f = T[sym];
  if (f) return f();
  return `${dir ? `Moved ${dir} ${mag} over the window` : "Series loaded"}${trend ? `, trading ${trend} its 200-DMA` : ""}${st.rsi != null ? `, RSI ${st.rsi.toFixed(0)}` : ""}. Annualized volatility ${st.vol != null ? st.vol.toFixed(0) + "%" : "—"}, max drawdown ${st.dd != null ? st.dd.toFixed(1) + "%" : "—"} in the loaded range.`;
}

/* ── tiny sparkline renderer (SVG string, no canvas churn in tables) ─────── */
function mcSpark(vals, w = 84, h = 22, color = "#c8862a") {
  const v = (vals || []).filter((x) => x != null && Number.isFinite(x));
  if (v.length < 3) return "";
  const lo = Math.min(...v), hi = Math.max(...v);
  const Y = (x) => (hi === lo ? h / 2 : 2 + (1 - (x - lo) / (hi - lo)) * (h - 4));
  const X = (i) => (i / (v.length - 1)) * w;
  const pts = v.map((x, i) => `${X(i).toFixed(1)},${Y(x).toFixed(1)}`).join(" ");
  const up = v[v.length - 1] >= v[0];
  return `<svg class="mc-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${up ? color : "#b23a2c"}" stroke-width="1.3"/></svg>`;
}
/* ── multi-line mini chart — several series overlaid in one tiny SVG, each
   auto-scaled to its own min/max so differently-scaled metrics (GDP growth,
   inflation, unemployment) are all legible together. ─────────────────────── */
const MC_ECON_COLORS = { gdp: "#2e9e6b", cpi: "#c8a53a", unemp: "#c84b3c" };
function mcMultiSpark(lines, w = 128, h = 30) {
  const polys = (lines || []).map(({ vals, color }) => {
    const v = (vals || []).filter((x) => x != null && Number.isFinite(x));
    if (v.length < 2) return "";
    const lo = Math.min(...v), hi = Math.max(...v);
    const Y = (x) => (hi === lo ? h / 2 : 2 + (1 - (x - lo) / (hi - lo)) * (h - 4));
    const X = (i) => (i / (v.length - 1)) * w;
    const pts = v.map((x, i) => `${X(i).toFixed(1)},${Y(x).toFixed(1)}`).join(" ");
    return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.3" vector-effect="non-scaling-stroke"/>`;
  }).join("");
  if (!polys) return `<span class="mono" style="color:var(--muted)">—</span>`;
  return `<svg class="mc-mspark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${polys}</svg>`;
}
/* ── semicircular NET-READ gauge (red→amber→green, needle at score/10) ────── */
function mcBriefGauge(score) {
  const cx = 100, cy = 104, r = 80, W = 200, H = 118;
  const s = Math.max(0, Math.min(10, score == null ? 5 : score));
  const arc = (a0, a1, steps = 20) => {
    let out = "";
    for (let i = 0; i <= steps; i++) { const t = a0 + (a1 - a0) * i / steps; out += `${(cx + r * Math.cos(t)).toFixed(1)},${(cy - r * Math.sin(t)).toFixed(1)} `; }
    return out.trim();
  };
  const P = Math.PI;
  const th = P * (1 - s / 10);
  const nx = cx + (r - 10) * Math.cos(th), ny = cy - (r - 10) * Math.sin(th);
  return `<svg class="mc-gauge" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax meet">
    <polyline points="${arc(P, P * 2 / 3)}" fill="none" stroke="#c84b3c" stroke-width="13" stroke-linecap="round"/>
    <polyline points="${arc(P * 2 / 3, P / 3)}" fill="none" stroke="#c8a53a" stroke-width="13"/>
    <polyline points="${arc(P / 3, 0)}" fill="none" stroke="#2e9e6b" stroke-width="13" stroke-linecap="round"/>
    <line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="var(--fg)" stroke-width="2.6" stroke-linecap="round"/>
    <circle cx="${cx}" cy="${cy}" r="4.5" fill="var(--fg)"/>
  </svg>`;
}
const mcPct = (v, dp = 2) => (v == null ? "—" : `<span class="${F.cls(v)}">${v >= 0 ? "+" : ""}${(+v).toFixed(dp)}%</span>`);
const mcCr = (v) => (v == null ? "—" : `<span class="${F.cls(v)}">${v >= 0 ? "+" : "−"}₹${Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr</span>`);

/* ── MACRO controller ────────────────────────────────────────────────────── */
const MACRO = {
  rows: [],
  _prev: {},
  _tick: 0,
  _mounted: false,
  _lazyDone: {},
  _fiiMode: "Daily",
  _fiiHist: [],
  _fiiSeries: null,
  _fiiCov: {},
  _fiiChart: null,
  /* Buckets for the selected granularity. Weekly / Monthly / Yearly are
     aggregated SERVER-side over the shipped exchange archive plus live
     capture, so the monthly view reaches back to Sep 2015 rather than being
     re-derived from the handful of daily sessions the client holds. */
  _fiiBuckets() {
    const S = this._fiiSeries || {};
    const d = (iso, o) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { timeZone: "UTC", ...o });
    switch (this._fiiMode) {
      case "Weekly":
        return (S.weekly || []).map((w) => ({
          label: "w/e " + d(w.end, { day: "2-digit", month: "short" }),
          sub: d(w.end, { year: "2-digit" }) + (w.partial ? ` · ${w.sessions}d` : ""),
          fii: w.fiiNet, dii: w.diiNet,
        }));
      case "Monthly":
        return (S.monthly || []).map((m) => ({
          label: d(m.month + "-01", { month: "short", year: "2-digit" }),
          sub: m.source === "month-to-date" ? `MTD ${m.sessions}d` : "",
          fii: m.fiiNet, dii: m.diiNet,
        }));
      case "Yearly":
        return (S.yearly || []).map((y) => ({
          label: y.year,
          sub: y.partial ? `${y.months}mo` : "",
          fii: y.fiiNet, dii: y.diiNet,
        }));
      default:
        return (this._fiiHist || []).map((s) => ({
          label: d(s.date, { day: "2-digit", month: "short" }),
          sub: d(s.date, { year: "2-digit" }),
          fii: s.fii, dii: s.dii,
        }));
    }
  },
  /* what the current mode actually covers — stated, not implied */
  _fiiCoverage() {
    const S = this._fiiSeries || {}, C = this._fiiCov || {};
    const yr = (iso) => (iso || "").slice(0, 4);
    switch (this._fiiMode) {
      case "Weekly": return `${(S.weekly || []).length} weeks · ${C.from || "—"} → ${C.to || "—"}`;
      case "Monthly": return `${(S.monthly || []).length} months · ${C.monthsFrom || "—"} → present`;
      case "Yearly": return `${(S.yearly || []).length} calendar years · from ${yr(C.monthsFrom)}`;
      default: return `${(this._fiiHist || []).length} sessions · ${C.from || "—"} → ${C.to || "—"}`;
    }
  },
  _drawFiiChart() {
    const cv = $("#mcFiiCv"); if (!cv) return;
    if (!this._fiiChart || this._fiiChart.cv !== cv) {
      this._fiiChart = new FiiChart(cv);
      if (typeof ResizeObserver !== "undefined") {
        const chart = this._fiiChart;
        new ResizeObserver(() => { if (chart.buckets.length) chart.draw(); }).observe(cv);
      }
    }
    this._fiiChart.setData(this._fiiBuckets());
  },

  async mount() {
    // Panels live directly in the Market Intelligence grid (terminal.html);
    // this module only fills them. Host = the whole tab, for delegation.
    const host = $("#tab-markets");
    if (!host || !$("#mcRegime")) return;
    if (!this._mounted) {
      this._mounted = true;

      // any tile or instrument link routes into the top CHART ANALYSIS module
      host.addEventListener("click", (e) => {
        const tile = e.target.closest("[data-chart]");
        if (tile && typeof CHARTX !== "undefined") {
          CHARTX.load(tile.dataset.chart, tile.dataset.chartLabel || null);
          const cv = $("#cxCv"); if (cv) cv.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });

      // lazy loaders — heavy panels fetch on first visibility
      const io = new IntersectionObserver((entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          const key = en.target.dataset.lazy;
          if (this._lazyDone[key]) continue;
          this._lazyDone[key] = true;
          io.unobserve(en.target);
          if (key === "inflation") this.loadInflation();
          else if (key === "india") this.loadIndia();
          else if (key === "econ") this.loadEcon();
          else if (key === "brief") this.loadBrief();
        }
      }, { rootMargin: "180px" });
      $$(".mc-lazy", host).forEach((el) => io.observe(el));
    }

    await this.refresh(true);
    this.loadBoard();
    this.loadFii();
  },

  async refresh(first) {
    try {
      const d = await api("/api/macro");
      this.rows = d.rows || [];
      this._renderRegime();
      this._renderHeat();
      const asOf = $("#macroAsOf");
      if (asOf) asOf.textContent = `live · ${this.rows.filter((r) => r.price != null).length}/${this.rows.length} instruments · ${new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}${this.rows.some((r) => r.stale) ? " · some values from last snapshot" : ""}`;
    } catch {
      if (first && $("#mcRegime")) $("#mcRegime").innerHTML = `<div class="empty-mini mono">macro feed unavailable — retrying on the next tick</div>`;
    }
  },

  q(sym) { return this.rows.find((r) => r.s === sym); },

  _renderRegime() {
    const el = $("#mcRegime"); if (!el) return;
    const vix = this.q("^VIX")?.price, ivix = this.q("^INDIAVIX")?.price;
    const dxy = this.q("DX-Y.NYB")?.change, cu = this.q("HG=F")?.change, au = this.q("GC=F")?.change;
    const y10 = this.q("^TNX"), nifty = this.q("^NSEI");
    let score = 0; const reads = [];
    if (vix != null) { const s = vix < 13 ? 2 : vix < 18 ? 1 : vix < 24 ? -1 : -2; score += s; reads.push([`VIX ${vix.toFixed(1)}`, s]); }
    if (ivix != null) { const s = ivix < 13 ? 1 : ivix < 18 ? 0.5 : -1; score += s; reads.push([`IN-VIX ${ivix.toFixed(1)}`, s]); }
    if (dxy != null) { const s = dxy < 0 ? 1 : -1; score += s; reads.push([`DXY ${dxy >= 0 ? "+" : ""}${dxy.toFixed(2)}%`, s]); }
    if (cu != null && au != null) { const s = cu - au > 0 ? 1 : -1; score += s; reads.push([`Cu−Au ${(cu - au) >= 0 ? "+" : ""}${(cu - au).toFixed(2)}pp`, s]); }
    if (y10 && y10.change != null) { const s = y10.change < 0 ? 1 : -1; score += s; reads.push([`US10Y ${y10.change >= 0 ? "+" : ""}${y10.change.toFixed(2)}%`, s]); }
    if (this._fear) reads.push([`FEAR: ${this._fear}`, 0]);
    const label = score >= 2.5 ? "RISK-ON" : score <= -2.5 ? "RISK-OFF" : "MIXED / NEUTRAL";
    const cls = score >= 2.5 ? "on" : score <= -2.5 ? "off" : "mid";
    el.innerHTML = `
      <div class="mc-reg-chip ${cls}">${label}</div>
      <div class="mc-reg-reads">${reads.map(([t, s]) => `<span class="mc-read ${s > 0 ? "up" : s < 0 ? "down" : ""}">${esc(t)}</span>`).join("")}</div>
      <div class="mi-keys">${[
        ["^NSEI", "NIFTY 50", (v) => F.num(v, 0)], ["^TNX", "US 10Y", (v) => v.toFixed(2) + "%"],
        ["BZ=F", "BRENT", (v) => "$" + v.toFixed(1)], ["USDINR=X", "USD/INR", (v) => v.toFixed(2)],
        ["DX-Y.NYB", "DXY", (v) => v.toFixed(2)], ["GC=F", "GOLD", (v) => "$" + F.num(v, 0)],
        ["^VIX", "VIX", (v) => v.toFixed(1)], ["BTC-USD", "BITCOIN", (v) => "$" + F.num(v, 0)],
      ].map(([s, l, fmt]) => { const r = this.q(s); return `<button class="mi-key" type="button" data-chart="${esc(s)}" data-chart-label="${esc(l)}"><small>${l}</small><b class="mono">${r && r.price != null ? fmt(r.price) : "—"}</b><span class="mono ${F.cls(r && r.change)}">${r && r.change != null ? (r.change >= 0 ? "+" : "") + r.change.toFixed(2) + "%" : ""}</span></button>`; }).join("")}</div>`;
  },

  _renderHeat() {
    const el = $("#mcHeat"); if (!el) return;
    // fixed row plan: each category renders as ONE full-width line of equal
    // tiles; the two small groups share a merged row.
    const byG = {};
    this.rows.forEach((r) => (byG[r.g] ||= []).push(r));
    const plan = [
      ["RATES", byG["Rates"] || []],
      ["FX", byG["FX"] || []],
      ["COMMODITIES", byG["Commodities"] || []],
      ["VOLATILITY · CRYPTO", [...(byG["Volatility"] || []), ...(byG["Crypto"] || [])]],
    ].filter(([, rows]) => rows.length);
    el.innerHTML = plan.map(([g, rows]) => `
      <div class="mc-hgrp" style="--tiles:${rows.length}">
        <div class="mc-hgl mono">${esc(g)}</div>
        <div class="mc-hrow">${rows.map((r) => {
          const c = r.change;
          const mag = c == null ? 0 : Math.min(1, Math.abs(c) / 2.5);
          const bg = c == null ? "rgba(255,255,255,.03)"
            : c >= 0 ? `rgba(47,124,84,${0.12 + mag * 0.55})` : `rgba(178,58,44,${0.12 + mag * 0.55})`;
          return `<button class="mc-tile" data-chart="${esc(r.s)}" data-chart-label="${esc(r.l)}" style="background:${bg}" title="Chart ${esc(r.l)}" type="button">
            <span class="mc-tl">${esc(r.l)}</span>
            <span class="mc-tp mono" data-px="${esc(r.s)}">${r.price == null ? "—" : F.num(r.price, r.price >= 1000 ? 0 : 2)}${r.unit || ""}</span>
            <span class="mc-tc mono">${c == null ? "" : (c >= 0 ? "+" : "") + c.toFixed(2) + "%"}</span>
          </button>`;
        }).join("")}</div>
      </div>`).join("");
    for (const r of this.rows) {
      if (r.price == null) continue;
      if (this._prev[r.s] != null && this._prev[r.s] !== r.price) {
        const cell = el.querySelector(`[data-px="${CSS.escape(r.s)}"]`);
        if (cell) goldFlash(cell);
      }
      this._prev[r.s] = r.price;
    }
  },

  /* GLOBAL MARKETS + FX + COMMODITIES + FEAR from /macro/board */
  async loadBoard() {
    try {
      const d = await api("/api/macro/board");
      if (!d.available) { $("#mcGlobal").innerHTML = `<div class="empty-mini mono">${esc(d.reason || "board unavailable")}</div>`; return; }
      this._fear = d.vol && d.vol.gauge ? `${d.vol.gauge}${d.vol.vixPctile1y != null ? " · P" + d.vol.vixPctile1y : ""}` : null;

      // absolute day change, derived from last price and the 1D % move
      const absChg = (p, pct) => (p == null || pct == null ? null : p - p / (1 + pct / 100));
      $("#mcGlobal").innerHTML = `<div class="table-wrap"><table class="dt mc-t mi-t">
        <tr><th style="text-align:left">Index</th><th>Last</th><th>Chg</th><th>1D</th><th>1W</th><th>1M</th><th>YTD</th><th class="mi-sp-h">1Y</th></tr>
        ${d.indices.map((x) => { const ch = absChg(x.price, x.d1); return `<tr>
          <td class="nm" style="text-align:left"><button class="mc-link" data-chart="${esc(x.s)}" data-chart-label="${esc(x.l)}" type="button">${esc(x.l)}</button></td>
          <td class="mono" data-gpx="${esc(x.s)}">${x.price == null ? "—" : F.num(x.price, 2)}</td>
          <td class="mono ${F.cls(ch)}">${ch == null ? "—" : (ch >= 0 ? "+" : "") + F.num(ch, 2)}</td>
          <td>${mcPct(x.d1)}</td><td>${mcPct(x.w1)}</td><td>${mcPct(x.m1)}</td><td>${mcPct(x.ytd)}</td>
          <td class="mi-sp">${mcSpark(x.spark, 84, 20, (x.ytd ?? x.m1 ?? 0) >= 0 ? "#2e9e6b" : "#c84b3c")}</td>
        </tr>`; }).join("")}</table></div>`;

      const maxS = Math.max(...d.fxStrength.map((x) => Math.abs(x.score)), 0.01);
      $("#mcFxStr").innerHTML = `
        <div class="mc-str mi-str">${d.fxStrength.map((x) => `
          <div class="mc-str-row"><span class="mc-str-c mono">${esc(x.ccy)}</span>
            <div class="mc-str-track"><span class="mc-str-bar ${x.score >= 0 ? "up" : "down"}" style="width:${(Math.abs(x.score) / maxS) * 50}%;${x.score >= 0 ? "left:50%" : "right:50%"}"></span><span class="mc-str-mid"></span></div>
            <span class="mc-str-v mono ${F.cls(x.score)}">${x.score >= 0 ? "+" : ""}${x.score.toFixed(2)}</span>
          </div>`).join("")}</div>
        <div class="idcf-note mi-foot">Session strength vs the trade-weighted mean of the majors — positive = outperforming the basket today.</div>`;
      $("#mcFxRates").innerHTML = `<div class="table-wrap"><table class="dt mc-t mi-t"><tr><th style="text-align:left">Pair</th><th>Rate</th><th>1D</th><th>1W</th><th>1M</th></tr>
          ${d.fx.map((f) => `<tr><td class="nm" style="text-align:left"><button class="mc-link" data-chart="${esc(f.s)}" data-chart-label="${esc(f.s.replace("=X", ""))}" type="button">${esc(f.s.replace("=X", ""))}</button></td><td class="mono">${f.price == null ? "—" : f.price.toFixed(4)}</td><td>${mcPct(f.d1)}</td><td>${mcPct(f.w1)}</td><td>${mcPct(f.m1)}</td></tr>`).join("")}</table></div>`;

      $("#mcCmd").innerHTML = `<div class="table-wrap"><table class="dt mc-t">
        <tr><th style="text-align:left">Commodity</th><th>Last</th><th>1D</th><th>1W</th><th>1M</th><th>Trend</th><th>vs 50-DMA</th><th>Vol (20d)</th><th class="mi-sp-h">6M</th></tr>
        ${d.commodities.map((c) => `<tr>
          <td class="nm" style="text-align:left"><button class="mc-link" data-chart="${esc(c.s)}" data-chart-label="${esc(c.l)}" type="button">${esc(c.l)}</button></td>
          <td class="mono">${c.price == null ? "—" : F.num(c.price, 2)}</td>
          <td>${mcPct(c.d1)}</td><td>${mcPct(c.w1)}</td><td>${mcPct(c.m1)}</td>
          <td class="${c.trend === "UP" ? "up" : c.trend === "DOWN" ? "down" : ""}">${c.trend || "—"}</td>
          <td>${mcPct(c.vs50, 1)}</td>
          <td class="mono">${c.vol20 == null ? "—" : c.vol20.toFixed(0) + "%"}</td>
          <td class="mi-sp">${mcSpark(c.spark || [], 84, 20, c.trend === "DOWN" ? "#c84b3c" : "#2e9e6b")}</td>
        </tr>`).join("")}</table></div>
        <div class="idcf-note mi-foot">Iron ore is intentionally absent — SGX TSI iron-ore data is licensed and there is no reliable free live source; nothing on this board is mocked.</div>`;
    } catch { $("#mcGlobal").innerHTML = `<div class="empty-mini mono">board unavailable — retrying on the next cycle</div>`; }
  },

  async loadFii() {
    const el = $("#mcFii"); if (!el) return;
    try {
      const d = await api("/api/macro/fiidii");
      if (!d.available) { el.innerHTML = `<div class="empty-mini mono">${esc(d.reason || "NSE FII/DII unavailable from this host")}</div>`; return; }
      const L = d.latest, W = d.windows || {}, X = d.extras || {};
      const sub = $("#mcFiiSub");
      if (sub && L) sub.textContent = `NSE provisional · ${esc(L.date || "")} · ₹ Cr`;
      // positioning indicator from the latest session + 5-day balance
      let chip = "", chipCls = "";
      if (L && L.fiiNet != null && L.diiNet != null) {
        if (L.fiiNet >= 0 && L.diiNet >= 0) { chip = "INSTITUTIONAL ACCUMULATION"; chipCls = "on"; }
        else if (L.fiiNet < 0 && L.diiNet >= 0) { chip = "DOMESTIC ABSORPTION"; chipCls = "mid"; }
        else if (L.fiiNet >= 0) { chip = "FOREIGN-LED BUYING"; chipCls = "mid"; }
        else { chip = "INSTITUTIONAL DISTRIBUTION"; chipCls = "off"; }
      }
      const winCell = (label, w, key) => `<div class="mc-fii-card"><div class="l">${label}</div><div class="n">${w && w[key] != null ? mcCr(w[key]) : `<span class="mono" style="color:var(--muted)">${w ? w.n : 0}/${label.includes("5") ? 5 : 20} sessions</span>`}</div></div>`;
      this._fiiHist = d.history || [];
      this._fiiSeries = d.series || {};
      this._fiiCov = d.coverage || {};
      const interp = (() => {
        const Y = (this._fiiSeries.yearly || []);
        const parts = [];
        if (L && L.fiiNet != null && L.diiNet != null) {
          parts.push(`Latest session (${esc(L.date || "")}): ${L.fiiNet >= 0 ? "FIIs bought" : "FIIs sold"} ₹${Math.abs(L.fiiNet).toFixed(0)} Cr net while ${L.diiNet >= 0 ? "DIIs bought" : "DIIs sold"} ₹${Math.abs(L.diiNet).toFixed(0)} Cr.`);
        }
        const f5 = W.d5 && W.d5.fii, d5 = W.d5 && W.d5.dii;
        if (f5 != null && d5 != null && W.d5.complete) {
          parts.push(f5 < 0 && d5 > 0 ? "Over five sessions the tape is the classic Indian tug-of-war — foreign selling absorbed by domestic funds; the market holds as long as DII inflows (SIP-driven, sticky) outpace the FII exit."
            : f5 > 0 && d5 > 0 ? "Both cohorts are net buyers over five sessions — the strongest flow configuration; supply is scarce into strength."
            : f5 > 0 ? "FIIs are the marginal buyer over five sessions while domestic funds book profits — foreign-led legs are faster but flightier."
            : "Both cohorts are net sellers over five sessions — the defensive configuration; rallies lack a natural buyer until one cohort turns.");
        }
        // the decade-scale read the monthly archive now makes possible
        const done = Y.filter((y) => !y.partial || y.months >= 11);
        if (done.length >= 3) {
          const sellYears = done.filter((y) => y.fiiNet < 0).length;
          const lastFull = done[done.length - 1];
          parts.push(`Across ${done.length} years of archive, FIIs were net sellers in ${sellYears} of them while DIIs absorbed the supply — in ${lastFull.year} alone FIIs were ${lastFull.fiiNet >= 0 ? "net buyers of" : "net sellers of"} ₹${Math.abs(lastFull.fiiNet / 1e5).toFixed(2)} L Cr against DII ${lastFull.diiNet >= 0 ? "buying" : "selling"} of ₹${Math.abs(lastFull.diiNet / 1e5).toFixed(2)} L Cr. That structural handover from foreign to domestic money is the single most important flow fact about this market.`);
        }
        return parts.join(" ");
      })();
      el.innerHTML = `
        ${chip ? `<div class="mc-reg-chip mi-fii-chip ${chipCls}">${chip}</div>` : ""}
        <div class="mc-fii-grid">
          <div class="mc-fii-card"><div class="l">FII NET · DAY</div><div class="n">${L ? mcCr(L.fiiNet) : "—"}</div></div>
          <div class="mc-fii-card"><div class="l">DII NET · DAY</div><div class="n">${L ? mcCr(L.diiNet) : "—"}</div></div>
          <div class="mc-fii-card"><div class="l">COMBINED NET · DAY</div><div class="n">${X && X.combinedNet != null ? mcCr(X.combinedNet) : "—"}</div></div>
          ${winCell("5-DAY / WEEKLY · FII", W.d5, "fii")}
          ${winCell("5-DAY / WEEKLY · DII", W.d5, "dii")}
          <div class="mc-fii-card"><div class="l">DII / FII ABSORPTION</div><div class="n">${X && X.diiToFiiRatio != null ? X.diiToFiiRatio + "×" : "—"}</div></div>
          ${winCell("20-DAY / MONTHLY · FII", W.d20, "fii")}
          ${winCell("20-DAY / MONTHLY · DII", W.d20, "dii")}
          <div class="mc-fii-card"><div class="l">FII STREAK</div><div class="n">${X && X.fiiStreak ? `<span class="${X.fiiStreak.side === "BUY" ? "up" : "down"}">${X.fiiStreak.days}d ${X.fiiStreak.side}</span>` : "—"}</div>${X && X.largestFiiDay ? `<div class="s mono">record day: ${mcCr(X.largestFiiDay.fii)} · ${esc(X.largestFiiDay.date)}</div>` : ""}</div>
        </div>
        ${this._fiiHist.length ? `
          <div class="mc-fii-ctl">
            <div class="mc-tf">${["Daily", "Weekly", "Monthly", "Yearly"].map((m) => `<button class="mc-tfb ${m === this._fiiMode ? "on" : ""}" data-fiimode="${m}" type="button">${m}</button>`).join("")}</div>
            <span class="mc-fii-legend mono"><i class="mc-lgd fii"></i> Net FII &nbsp;<i class="mc-lgd dii"></i> Net DII &nbsp;<i class="mc-lgd all"></i> Net overall · <span id="mcFiiCov">${esc(this._fiiCoverage())}</span></span>
          </div>
          <div class="mc-fii-cvwrap"><canvas id="mcFiiCv"></canvas></div>
          <div class="mc-hint mono" style="text-align:right;margin-top:4px">wheel zoom · drag pan · dbl-click reset · hover for values</div>` : ""}
        ${interp || (this._fiiCov.baseline && this._fiiCov.baseline.caveats) ? `<details class="mi-more"><summary class="mono">Flow read &amp; methodology</summary>` : ""}
        ${interp ? `<div class="mc-note">${interp}</div>` : ""}
        ${this._fiiCov.baseline && this._fiiCov.baseline.caveats ? `<div class="mc-note mc-fii-caveat">
          <b>How this series is built.</b> Monthly cash flows come from the exchange archive (${esc(this._fiiCov.monthsFrom || "")} onward, ${this._fiiCov.months || 0} months); daily and weekly detail covers ${esc(this._fiiCov.from || "")} → ${esc(this._fiiCov.to || "")} and extends automatically as new sessions are captured from NSE. ${esc((this._fiiCov.baseline.caveats || [])[0] || "")}
          ${(this._fiiCov.baseline.monthlyGaps || []).length ? ` The archive publishes no July row for ${esc(String((this._fiiCov.baseline.monthlyGaps[0] || "").slice(0, 4)))}–${esc(String((this._fiiCov.baseline.monthlyGaps.at(-1) || "").slice(0, 4)))}, so those calendar years carry eleven months — the Yearly view labels them.` : ""}
        </div>` : ""}
        ${interp || (this._fiiCov.baseline && this._fiiCov.baseline.caveats) ? `</details>` : ""}`;
      if (this._fiiHist.length) {
        el.querySelectorAll("[data-fiimode]").forEach((b) => b.addEventListener("click", () => {
          this._fiiMode = b.dataset.fiimode;
          el.querySelectorAll("[data-fiimode]").forEach((x) => x.classList.toggle("on", x === b));
          const cov = el.querySelector("#mcFiiCov");
          if (cov) cov.textContent = this._fiiCoverage();
          this._drawFiiChart();
        }));
        this._drawFiiChart();
      }
    } catch { el.innerHTML = `<div class="empty-mini mono">FII/DII unavailable — retrying later</div>`; }
  },

  /* ── LAZY PANELS ── */
  async loadInflation() {
    const el = $("#mcInfl"); if (!el) return;
    el.innerHTML = `<div class="loading mono">loading CPI series…</div>`;
    try {
      const d = await api("/api/macro/inflation");
      if (!d.available) { el.innerHTML = `<div class="empty-mini mono">${esc(d.reason || "FRED unreachable from this host")}</div>`; return; }
      el.innerHTML = `<div class="mc-infl-grid mi-infl">${d.rows.map((r) => !r.available ? "" : `
        <div class="mc-infl-card">
          <div class="l mono">${esc(r.name).toUpperCase()}</div>
          <div class="n ${r.prev != null && r.latest > r.prev ? "down" : "up"}">${r.latest.toFixed(1)}%</div>
          <div class="s mono">prev ${r.prev != null ? r.prev.toFixed(1) + "%" : "—"} · ${esc(String(r.latestDate).slice(0, 7))} ${r.prev != null ? (r.latest > r.prev ? "▲ heating" : r.latest < r.prev ? "▼ cooling" : "→ flat") : ""}</div>
          ${mcSpark(r.trend, 120, 26)}
        </div>`).join("")}</div>
        <div class="idcf-note mi-foot">${esc(d.note || "")}</div>`;
    } catch { el.innerHTML = `<div class="empty-mini mono">inflation panel unavailable</div>`; }
  },

  async loadIndia() {
    const el = $("#mcIndia"); if (!el) return;
    el.innerHTML = `<div class="loading mono">assembling India macro pack…</div>`;
    try {
      const d = await api("/api/macro/india");
      if (!d.available || !d.cards || !d.cards.length) { el.innerHTML = `<div class="empty-mini mono">${esc((d && d.reason) || "India macro sources unreachable from this host")}</div>`; return; }
      el.innerHTML = `<div class="mc-infl-grid mi-strip">${d.cards.map((c) => `
        <div class="mc-infl-card">
          <div class="l mono">${esc(c.k).toUpperCase()} <span class="mc-src">${esc(c.src)}</span></div>
          <div class="n">${c.v}${esc(c.unit || "")}</div>
          <div class="s mono">${esc(c.sub || "")}</div>
          ${mcSpark(c.trend, 120, 26)}
        </div>`).join("")}</div>
        ${d.omitted ? `<div class="idcf-note mi-foot">${esc(d.omitted)}</div>` : ""}`;
    } catch { el.innerHTML = `<div class="empty-mini mono">India macro unavailable</div>`; }
  },

  async loadEcon() {
    const el = $("#mcEcon"); if (!el) return;
    el.innerHTML = `<div class="loading mono">loading World Bank indicators…</div>`;
    try {
      const d = await api("/api/macro/global-econ");
      if (!d.available) { el.innerHTML = `<div class="empty-mini mono">${esc(d.reason || "World Bank unreachable from this host")}</div>`; return; }
      const cls = (k, v) => k === "gdp" ? F.cls(v) : "";
      const cell = (x, k) => x ? `<td class="mono ${cls(k, x.v)}">${x.v.toFixed(1)}% <span class="mc-src" title="Reference period">${esc(x.ref || "")}</span></td>` : `<td class="mono" style="color:var(--muted)">—</td>`;
      const trendCell = (r) => `<td class="mc-econ-trend">${mcMultiSpark([
        { vals: r.gdpTrend, color: MC_ECON_COLORS.gdp },
        { vals: r.cpiTrend, color: MC_ECON_COLORS.cpi },
        { vals: r.unempTrend, color: MC_ECON_COLORS.unemp },
      ])}</td>`;
      const rowsHtml = (rows) => rows.map((r) => `<tr><td class="nm" style="text-align:left">${esc(r.name)}</td>${cell(r.gdp, "gdp")}${cell(r.cpi, "cpi")}${cell(r.unemp, "unemp")}${trendCell(r)}</tr>`).join("");
      const head = () => `<tr><th style="text-align:left">Economy</th><th>GDP growth</th><th>Inflation</th><th>Unemployment</th><th style="width:132px">Trend · ~12y</th></tr>`;
      const legend = `<div class="mc-econ-legend mono"><span><i style="background:${MC_ECON_COLORS.gdp}"></i> GDP growth</span><span><i style="background:${MC_ECON_COLORS.cpi}"></i> Inflation</span><span><i style="background:${MC_ECON_COLORS.unemp}"></i> Unemployment</span></div>`;
      el.innerHTML = `<div class="table-wrap"><table class="dt mc-t mi-t">${head()}${rowsHtml(d.rows.slice(0, 9))}</table></div>
        ${legend}
        <details class="mi-more"><summary class="mono">Sources &amp; reference periods</summary><div class="idcf-note">${esc(d.note || "")} ${esc(d.trendNote || "")}</div></details>`;
      // "View all" lives in the panel header (terminal.html); wire it once
      const btn = $("#mcEconAll");
      if (btn) { btn.hidden = false; btn.textContent = `View all ${d.rows.length}`; }
      if (btn && !btn._wired) btn._wired = true, btn.addEventListener("click", () => {
        const m = document.createElement("div");
        m.className = "mcx-modal";
        m.innerHTML = `<div class="mcx-back"></div>
          <div class="mcx-box">
            <div class="mcx-head"><span class="mono">GLOBAL INDICATORS · ${d.rows.length} ECONOMIES · latest official prints</span><button class="mcx-x" type="button">×</button></div>
            <div class="mcx-body"><table class="dt mc-t">${head()}${rowsHtml(d.rows)}</table>${legend}</div>
          </div>`;
        document.body.appendChild(m);
        const kill = () => m.remove();
        m.querySelector(".mcx-back").addEventListener("click", kill);
        m.querySelector(".mcx-x").addEventListener("click", kill);
        document.addEventListener("keydown", function esc2(e) { if (e.key === "Escape") { kill(); document.removeEventListener("keydown", esc2); } });
      });
    } catch { el.innerHTML = `<div class="empty-mini mono">global indicators unavailable</div>`; }
  },

  async loadBrief() {
    const el = $("#mcBrief"); if (!el) return;
    el.innerHTML = `<div class="loading mono">composing briefing from live panels…</div>`;
    try {
      const d = await api("/api/macro/brief");
      if (!d.available) { el.innerHTML = `<div class="empty-mini mono">${esc(d.reason || "briefing unavailable")}</div>`; return; }
      const S = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
      const ICONS = {
        equity: `<svg viewBox="0 0 24 24" ${S}><polyline points="3 17 9 11 13 15 21 7"/><polyline points="16 7 21 7 21 12"/></svg>`,
        policy: `<svg viewBox="0 0 24 24" ${S}><path d="M3 21h18"/><path d="M5 21V10M9 21V10M15 21V10M19 21V10"/><path d="M12 3l9 5H3l9-5z"/></svg>`,
        external: `<svg viewBox="0 0 24 24" ${S}><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.6 2.6 2.6 15.4 0 18M12 3c-2.6 2.6-2.6 15.4 0 18"/></svg>`,
        commodity: `<svg viewBox="0 0 24 24" ${S}><path d="M12 3c3 4 6 6.5 6 10a6 6 0 0 1-12 0c0-3.5 3-6 6-10z"/></svg>`,
        flows: `<svg viewBox="0 0 24 24" ${S}><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.2 2.7-5 6-5s6 1.8 6 5"/><path d="M16 5.5a3 3 0 0 1 0 6"/><path d="M21.5 20c0-2.6-1.6-4.2-3.7-4.7"/></svg>`,
        growth: `<svg viewBox="0 0 24 24" ${S}><line x1="6" y1="20" x2="6" y2="12"/><line x1="12" y1="20" x2="12" y2="6"/><line x1="18" y1="20" x2="18" y2="14"/></svg>`,
        netread: `<svg viewBox="0 0 24 24" ${S}><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.6"/></svg>`,
      };
      const icon = (id) => ICONS[id] || ICONS.equity;
      const left = d.sections.map((s) => `
        <div class="mc-brief-sec">
          <div class="mc-bs-ic">${icon(s.icon)}</div>
          <div class="mc-bs-body"><h4>${esc(s.title)}</h4><p>${esc(s.text)}</p></div>
        </div>`).join("");
      const list = (items) => (items || []).map((t) => `<li>${esc(t)}</li>`).join("");
      const nr = d.netRead || { score: null, label: "", desc: "" };
      const gcol = nr.score >= 6.5 ? "#2e9e6b" : nr.score >= 4.5 ? "#c8a53a" : "#c84b3c";
      const right = `
        <div class="mc-brief-card">
          <div class="mc-bc-head"><span class="mc-bc-ic star">★</span> KEY TAKEAWAYS</div>
          <ul class="mc-bc-list">${list(d.takeaways)}</ul>
        </div>
        <div class="mc-brief-card">
          <div class="mc-bc-head"><span class="mc-bc-ic up">▲</span> OPPORTUNITIES</div>
          <ul class="mc-bc-list opp">${list(d.opportunities)}</ul>
        </div>
        <div class="mc-brief-card">
          <div class="mc-bc-head"><span class="mc-bc-ic warn">▲</span> RISKS TO WATCH</div>
          <ul class="mc-bc-list risk">${list(d.risks)}</ul>
        </div>
        <div class="mc-brief-card mc-netread">
          <div class="mc-bc-head">NET READ</div>
          <div class="mc-nr-body">
            <div class="mc-nr-gauge">${mcBriefGauge(nr.score)}</div>
            <div class="mc-nr-meta">
              <div class="mc-nr-label" style="color:${gcol}">${esc(nr.label || "")}</div>
              <div class="mc-nr-score"><b>${nr.score != null ? nr.score : "—"}</b> / 10</div>
            </div>
          </div>
          <div class="mc-nr-desc">${esc(nr.desc || "")}</div>
        </div>`;
      el.innerHTML = `
        <div class="mc-brief2">
          <div class="mc-brief-main">${left}</div>
          <div class="mc-brief-side">${right}</div>
        </div>
        <div class="mc-brief-foot">
          <span class="idcf-note">${esc(d.method || "")}</span>
          <span class="idcf-note mc-asof">All numbers as of ${esc(d.asOfLabel || "")} unless stated otherwise</span>
        </div>`;
    } catch { el.innerHTML = `<div class="empty-mini mono">briefing unavailable</div>`; }
  },

  /* unified live tick: quotes every tick; board every 4th; charts every 4th;
     FII/DII + rates on slow cycles (server caches govern actual upstream load) */
  liveTick() {
    if (!this._mounted) return;
    this._tick++;
    this.refresh().catch(() => {});
    if (this._tick % 4 === 0) {
      this.loadBoard().catch(() => {});
      if (typeof CHARTX !== "undefined") CHARTX.tick();
    }
    if (this._tick % 40 === 0) this.loadFii().catch(() => {});
  },
};

/* ════════════════════════════════════════════════════════════════════════
   CHART ANALYSIS — the merged charting module at the top of Market
   Intelligence. One engine, two selection paths:
     · SEARCH — free-text ticker OR name (Yahoo search) covering any stock,
       index, ETF, ADR…
     · PRESETS — the full macro universe (rates · FX · commodities ·
       volatility · crypto · global indices) matched by label, so "gold",
       "10y", "vix", "usdinr" resolve instantly without knowing tickers.
   Everything the old Chart Station had rides along: compare up to 5 series
   (normalized %), wheel-zoom / drag-pan / dbl-click reset, crosshair with
   all values, indicator strip, per-instrument macro read, and clickable
   ▲▼ sharp-move markers with deterministic summaries.
   ════════════════════════════════════════════════════════════════════════ */
const CX_PRESETS = [
  ["^NSEI", "NIFTY 50", "India Equity"], ["^BSESN", "SENSEX", "India Equity"], ["^NSEBANK", "BANK NIFTY", "India Equity"],
  ["^GSPC", "S&P 500", "Global Equity"], ["^IXIC", "Nasdaq", "Global Equity"], ["^DJI", "Dow Jones", "Global Equity"],
  ["^RUT", "Russell 2000", "Global Equity"], ["^FTSE", "FTSE 100", "Global Equity"], ["^GDAXI", "DAX", "Global Equity"],
  ["^N225", "Nikkei 225", "Global Equity"], ["^HSI", "Hang Seng", "Global Equity"], ["000001.SS", "Shanghai", "Global Equity"],
  ["^IRX", "US 3M Yield", "Rates"], ["^FVX", "US 5Y Yield", "Rates"], ["^TNX", "US 10Y Yield", "Rates"], ["^TYX", "US 30Y Yield", "Rates"],
  ["USDINR=X", "USD/INR", "FX"], ["EURUSD=X", "EUR/USD", "FX"], ["GBPUSD=X", "GBP/USD", "FX"], ["USDJPY=X", "USD/JPY", "FX"],
  ["USDCNY=X", "USD/CNY", "FX"], ["AUDUSD=X", "AUD/USD", "FX"], ["USDCAD=X", "USD/CAD", "FX"], ["USDCHF=X", "USD/CHF", "FX"],
  ["DX-Y.NYB", "Dollar Index", "FX"],
  ["GC=F", "Gold", "Commodities"], ["SI=F", "Silver", "Commodities"], ["HG=F", "Copper", "Commodities"],
  ["CL=F", "WTI Crude", "Commodities"], ["BZ=F", "Brent", "Commodities"], ["NG=F", "Nat Gas", "Commodities"],
  ["ZW=F", "Wheat", "Commodities"], ["ZC=F", "Corn", "Commodities"], ["PL=F", "Platinum", "Commodities"],
  ["^VIX", "VIX", "Volatility"], ["^INDIAVIX", "India VIX", "Volatility"],
  ["BTC-USD", "Bitcoin", "Crypto"], ["ETH-USD", "Ethereum", "Crypto"],
];

/* ════════════════════════════════════════════════════════════════════════
   FiiChart — zoomable FII/DII flow chart (Daily · Weekly · Monthly).
   Paired bars (FII amber / DII green) + a Net-overall line, on a signed
   axis with a zero baseline. Wheel-zoom around the cursor, drag-pan,
   double-click reset, crosshair tooltip. Same interaction language as the
   Chart Analysis engine, tuned for discrete buckets.
   ════════════════════════════════════════════════════════════════════════ */
class FiiChart {
  constructor(cv) {
    this.cv = cv;
    this.g = cv.getContext("2d");
    this.buckets = [];
    this.view = null;      // [i0, i1]
    this.hover = null;
    this._bind();
  }
  setData(buckets, keepView) {
    const prevN = this.buckets.length, prev = this.view;
    this.buckets = buckets || [];
    const n = this.buckets.length;
    if (!n) { this.view = null; this.draw(); return; }
    if (keepView && prev && prevN) {
      const span = Math.min(n - 1, prev[1] - prev[0]);
      this.view = [Math.max(0, n - 1 - span), n - 1];
    } else this.view = [0, n - 1];
    this.draw();
  }
  _bind() {
    const cv = this.cv;
    cv.addEventListener("wheel", (e) => {
      if (!this.view || this.buckets.length < 3) return;
      e.preventDefault();
      const [i0, i1] = this.view, n = this.buckets.length;
      const rect = cv.getBoundingClientRect();
      const fx = Math.min(1, Math.max(0, (e.clientX - rect.left - 46) / (rect.width - 54)));
      const span = i1 - i0;
      const ns = Math.min(n - 1, Math.max(3, Math.round(span * (e.deltaY > 0 ? 1.3 : 0.77))));
      let a = Math.round(i0 + fx * span - fx * ns), b = a + ns;
      if (a < 0) { b -= a; a = 0; }
      if (b > n - 1) { a -= b - (n - 1); b = n - 1; a = Math.max(0, a); }
      this.view = [a, b];
      this.draw();
    }, { passive: false });
    let dragX = null, dv = null;
    cv.addEventListener("mousedown", (e) => { dragX = e.clientX; dv = this.view && [...this.view]; cv.style.cursor = "grabbing"; });
    window.addEventListener("mouseup", () => { dragX = null; cv.style.cursor = "crosshair"; });
    cv.addEventListener("mousemove", (e) => {
      const rect = cv.getBoundingClientRect();
      if (dragX != null && dv && this.view) {
        const n = this.buckets.length, span = dv[1] - dv[0];
        const per = (span + 1) / Math.max(1, rect.width - 54);
        let shift = Math.round((dragX - e.clientX) * per);
        let a = dv[0] + shift, b = dv[1] + shift;
        if (a < 0) { b -= a; a = 0; }
        if (b > n - 1) { a -= b - (n - 1); b = n - 1; a = Math.max(0, a); }
        this.view = [a, b];
      } else if (this.view) {
        const [i0, i1] = this.view, span = i1 - i0 + 1;
        const fx = (e.clientX - rect.left - 46) / (rect.width - 54);
        this.hover = fx < 0 || fx > 1 ? null : Math.min(i1, Math.max(i0, i0 + Math.floor(fx * span)));
      }
      this.draw();
    });
    cv.addEventListener("mouseleave", () => { this.hover = null; this.draw(); });
    cv.addEventListener("dblclick", () => { if (this.buckets.length) { this.view = [0, this.buckets.length - 1]; this.draw(); } });
  }
  draw() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.cv.clientWidth, h = this.cv.clientHeight;
    this.cv.width = w * dpr; this.cv.height = h * dpr;
    const g = this.g;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (!this.view || this.buckets.length < 1) {
      g.fillStyle = "rgba(255,255,255,.35)"; g.font = "10px monospace";
      g.fillText("no captured sessions yet", 50, h / 2);
      return;
    }
    const [i0, i1] = this.view;
    const win = this.buckets.slice(i0, i1 + 1);
    const padL = 46, padR = 10, padT = 12, padB = 22;
    const iw = w - padL - padR, ih = h - padT - padB;
    const overall = win.map((b) => (b.fii != null || b.dii != null ? (b.fii || 0) + (b.dii || 0) : null));
    const vals = win.flatMap((b, i) => [b.fii, b.dii, overall[i]]).filter((v) => v != null);
    let hi = Math.max(...vals, 0), lo = Math.min(...vals, 0);
    if (hi === lo) { hi += 1000; lo -= 1000; }
    const pad = (hi - lo) * 0.14; hi += pad; lo -= pad;
    const Y = (v) => padT + (1 - (v - lo) / (hi - lo)) * ih;
    const slot = iw / win.length;
    const bw = Math.max(2, Math.min(16, slot * 0.30));
    const fmtK = (v) => (Math.abs(v) >= 1000 ? (v / 1000).toFixed(Math.abs(v) >= 10000 || v % 1000 === 0 ? 0 : 1) + "k" : v.toFixed(0));

    g.font = "8.5px monospace"; g.textAlign = "right"; g.fillStyle = "rgba(255,255,255,.4)"; g.strokeStyle = "rgba(255,255,255,.06)";
    for (let i = 0; i <= 3; i++) { const v = lo + ((hi - lo) * i) / 3, y = Y(v); g.beginPath(); g.moveTo(padL, y); g.lineTo(w - padR, y); g.stroke(); g.fillText((v >= 0 ? "+" : "") + fmtK(v), padL - 5, y + 3); }
    g.strokeStyle = "rgba(255,255,255,.22)"; g.beginPath(); g.moveTo(padL, Y(0)); g.lineTo(w - padR, Y(0)); g.stroke();

    win.forEach((b, i) => {
      const cx = padL + slot * i + slot / 2;
      const bar = (v, color, off) => { if (v == null) return; const y0 = Y(0), y1 = Y(v); g.fillStyle = color; g.fillRect(cx + off, Math.min(y0, y1), bw, Math.max(1.5, Math.abs(y1 - y0))); };
      bar(b.fii, "#c8862a", -bw - 1);
      bar(b.dii, "#2e9e6b", 1);
    });
    // net line
    g.beginPath(); let started = false;
    win.forEach((b, i) => { if (overall[i] == null) return; const x = padL + slot * i + slot / 2, y = Y(overall[i]); started ? g.lineTo(x, y) : g.moveTo(x, y); started = true; });
    g.strokeStyle = "rgba(232,227,216,.85)"; g.lineWidth = 1.3; g.stroke();
    win.forEach((b, i) => { if (overall[i] == null) return; g.beginPath(); g.arc(padL + slot * i + slot / 2, Y(overall[i]), 1.8, 0, Math.PI * 2); g.fillStyle = "#e8e3d8"; g.fill(); });

    // x labels (thinned)
    g.textAlign = "center"; g.fillStyle = "rgba(255,255,255,.4)";
    const step = Math.max(1, Math.ceil(win.length / 8));
    win.forEach((b, i) => {
      if (i % step !== 0 && i !== win.length - 1) return;
      const isFirst = i === 0, isLast = i === win.length - 1;
      g.textAlign = isFirst ? "left" : isLast ? "right" : "center";
      const x = isFirst ? padL : isLast ? w - padR : padL + slot * i + slot / 2;
      g.fillText(b.label, x, h - 7);
    });
    g.textAlign = "center";

    // crosshair + tooltip
    if (this.hover != null && this.hover >= i0 && this.hover <= i1) {
      const li = this.hover - i0, b = win[li];
      const cx = padL + slot * li + slot / 2;
      g.strokeStyle = "rgba(255,255,255,.18)"; g.beginPath(); g.moveTo(cx, padT); g.lineTo(cx, padT + ih); g.stroke();
      const net = (b.fii || 0) + (b.dii || 0);
      const lines = [
        `${b.label}${b.sub ? " '" + b.sub : ""}`,
        `FII ${b.fii != null ? (b.fii >= 0 ? "+" : "") + b.fii.toFixed(0) : "—"} Cr`,
        `DII ${b.dii != null ? (b.dii >= 0 ? "+" : "") + b.dii.toFixed(0) : "—"} Cr`,
        `Net ${net >= 0 ? "+" : ""}${net.toFixed(0)} Cr`,
      ];
      g.font = "10px monospace";
      const tw = Math.max(...lines.map((t) => g.measureText(t).width)) + 14;
      const th = lines.length * 14 + 8;
      let bx = cx + 10; if (bx + tw > w - padR) bx = cx - tw - 10;
      const by = padT + 4;
      g.fillStyle = "rgba(10,13,16,.95)"; g.fillRect(bx, by, tw, th);
      g.strokeStyle = "rgba(200,134,42,.4)"; g.strokeRect(bx, by, tw, th);
      g.textAlign = "left";
      lines.forEach((t, k) => { g.fillStyle = k === 0 ? "#e8e3d8" : k === 1 ? "#c8862a" : k === 2 ? "#2e9e6b" : "rgba(232,227,216,.85)"; g.fillText(t, bx + 7, by + 15 + k * 14); });
    }
  }
}
