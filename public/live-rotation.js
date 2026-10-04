/* ════════════════════════════════════════════════════════════════════════════
   LIVE SCANNER · SECTOR ROTATION (RRG-style)
   NSE sector indices against NIFTY 50: relative trend (RS-Ratio, x) and its momentum
   (RS-Momentum, y), with a trail of the last 8 weeks (or 10 sessions). Sectors usually rotate
   clockwise: Improving → Leading → Weakening → Lagging. Latest point is live (streamed index
   quotes); history is cached on disk server-side. Engine: server/lib/rotation.js.
   ════════════════════════════════════════════════════════════════════════════ */
var LSC_RRG = (() => {
  const S = { el: null, tf: "weekly", mode: "index", data: null, err: null, timer: 0, hi: null };
  const E = (s) => (typeof esc === "function" ? esc(s) : String(s == null ? "" : s));
  const Q = { Leading: "var(--up)", Weakening: "var(--amber-bright)", Lagging: "var(--down)", Improving: "#3987e5" };
  const P = (v) => (v == null ? "—" : `<span class="${v > 0 ? "up" : v < 0 ? "down" : ""}">${v > 0 ? "+" : ""}${v.toFixed(2)}%</span>`);
  async function load() {
    const mode = S.mode;
    try { S.data = await api((mode === "basket" ? "/api/scanner/rotation?tf=" : "/api/market/rotation?tf=") + S.tf); S.err = null; }
    catch (e) {
      if (mode === "basket") { S.note = e.message; S.mode = "index"; return load(); }   // baskets not ready: fall back to the official indices
      S.err = e.message;
    }
    render();
  }
  function chart(d) {
    const pts = d.sectors.filter((s) => s.trail);
    if (!pts.length) return `<div class="ws-dim ec-small">No sector has enough history yet.</div>`;
    const xs = pts.flatMap((s) => s.trail.map((p) => p.x)), ys = pts.flatMap((s) => s.trail.map((p) => p.y));
    const span = Math.max(1.5, ...xs.map((x) => Math.abs(x - 100)), ...ys.map((y) => Math.abs(y - 100))) * 1.12;
    const W = 720, H = 560, pad = 36, X = (x) => pad + ((x - (100 - span)) / (2 * span)) * (W - 2 * pad), Y = (y) => H - pad - ((y - (100 - span)) / (2 * span)) * (H - 2 * pad);
    const quad = (x0, y0, x1, y1, c, lbl, tx, ty, anchor) => `<rect x="${X(x0)}" y="${Y(y1)}" width="${X(x1) - X(x0)}" height="${Y(y0) - Y(y1)}" fill="${c}" opacity=".06"/><text x="${tx}" y="${ty}" text-anchor="${anchor}" class="q" fill="${c}">${lbl}</text>`;
    const lo = 100 - span, hi = 100 + span;
    let g = quad(100, 100, hi, hi, Q.Leading, "LEADING", W - pad - 6, pad + 14, "end") + quad(100, lo, hi, 100, Q.Weakening, "WEAKENING", W - pad - 6, H - pad - 8, "end") +
      quad(lo, lo, 100, 100, Q.Lagging, "LAGGING", pad + 6, H - pad - 8, "start") + quad(lo, 100, 100, hi, Q.Improving, "IMPROVING", pad + 6, pad + 14, "start");
    g += `<line x1="${X(100)}" x2="${X(100)}" y1="${pad}" y2="${H - pad}" class="ax"/><line x1="${pad}" x2="${W - pad}" y1="${Y(100)}" y2="${Y(100)}" class="ax"/>`;
    g += `<text x="${W / 2}" y="${H - 8}" text-anchor="middle" class="al">RS-Ratio (relative trend vs NIFTY) →</text><text x="12" y="${H / 2}" transform="rotate(-90 12 ${H / 2})" text-anchor="middle" class="al">RS-Momentum →</text>`;
    for (const s of pts) {
      const key = s.symbol || s.name, c = Q[s.quadrant], on = !S.hi || S.hi === key, op = on ? 1 : 0.18;
      const path = s.trail.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join("");
      const last = s.trail[s.trail.length - 1];
      g += `<g opacity="${op}" data-s="${E(key)}" class="tr"><path d="${path}" fill="none" stroke="${c}" stroke-width="1.6"/>${s.trail.slice(0, -1).map((p, i) => `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${1.5 + i * 0.25}" fill="${c}" opacity="${0.35 + (i / s.trail.length) * 0.5}"/>`).join("")}
        <circle cx="${X(last.x).toFixed(1)}" cy="${Y(last.y).toFixed(1)}" r="6" fill="${c}" stroke="var(--ink)" stroke-width="1.5"><title>${E(s.name)}: ratio ${last.x}, momentum ${last.y} (${s.quadrant})</title></circle>
        <text x="${(X(last.x) + 8).toFixed(1)}" y="${(Y(last.y) + 4).toFixed(1)}" class="nm">${E(short(s.name))}</text></g>`;
    }
    return `<svg class="rrg-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${g}</svg>`;
  }
  const short = (n) => { const m = { "Oil Gas & Consumable Fuels": "Oil & Gas", "Fast Moving Consumer Goods": "FMCG", "Automobile and Auto Components": "Auto", "Information Technology": "IT", "Construction Materials": "Cement", "Consumer Durables": "Durables", "Consumer Services": "Cons. Services", "Financial Services": "Financials", "Metals & Mining": "Metals", "Telecommunication": "Telecom", "Capital Goods": "Cap. Goods" }; return m[n] || (n.length > 14 ? n.slice(0, 13) + "…" : n); };
  const arrow = (h) => (h == null ? "" : `<span class="rrg-ar" style="transform:rotate(${-h}deg)">→</span>`);
  function render() {
    if (!S.el) return;
    const d = S.data;
    const head = `<div class="rrg-head"><div><b>SECTOR ROTATION</b> <span class="ws-dim">vs NIFTY 50${d ? ` · as of ${new Date(d.asOf + 5.5 * 3600e3).toISOString().slice(11, 16)} IST` : ""}</span></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><div class="pa-tf mono">${[["basket", "Scanner sector baskets"], ["index", "Official NSE indices"]].map(([m, l]) => `<button data-mode="${m}" class="${m === S.mode ? "on" : ""}">${l}</button>`).join("")}</div><div class="pa-tf mono">${["weekly", "daily"].map((t) => `<button data-tf="${t}" class="${t === S.tf ? "on" : ""}">${t === "weekly" ? "Weekly · 8-week trail" : "Daily · 10-session trail"}</button>`).join("")}</div></div></div>`;
    let body;
    const note = S.note ? `<div class="lsc-warn" style="margin-bottom:10px">${E(S.note)}</div>` : "";
    if (S.err) body = `<div class="ec-note bad">${E(S.err)}</div>`;
    else if (!d) body = `<div class="loading mono">reading sector index history…</div>`;
    else {
      const rows = d.sectors.slice().sort((a, b) => (b.trail ? b.trail.at(-1).x : 0) - (a.trail ? a.trail.at(-1).x : 0));
      const moved = rows.filter((s) => s.prevQuadrant && s.prevQuadrant !== s.quadrant);
      const table = `<div class="table-wrap"><table class="dt rrg-t"><tr><th>Sector</th><th>Quadrant</th><th>Heading</th><th>RS-Ratio</th><th>RS-Mom.</th><th>Strength</th><th>${S.tf === "weekly" ? "1W" : "1D"}</th><th>${S.tf === "weekly" ? "4W" : "4D"}</th><th>${S.tf === "weekly" ? "12W" : "12D"}</th><th>vs NIFTY (${S.tf === "weekly" ? "4W" : "4D"})</th></tr>
        ${rows.map((s) => s.error ? `<tr><td>${E(s.name)}</td><td colspan="9" class="ws-dim">${E(s.error)}</td></tr>` : `<tr data-s="${E(s.symbol || s.name)}" class="${S.hi === (s.symbol || s.name) ? "sel" : ""}"><td><b>${E(s.name)}</b> <span class="ws-dim mono">${s.symbol ? E(s.symbol) : s.members ? s.members + " stocks" : ""}</span></td><td><span class="rrg-q" style="color:${Q[s.quadrant]};border-color:${Q[s.quadrant]}">${s.quadrant}</span>${s.prevQuadrant && s.prevQuadrant !== s.quadrant ? ` <span class="ws-dim ec-small">from ${s.prevQuadrant}</span>` : ""}</td><td>${arrow(s.heading)}</td><td class="mono">${s.trail.at(-1).x.toFixed(2)}</td><td class="mono">${s.trail.at(-1).y.toFixed(2)}</td><td class="mono">${s.strength.toFixed(2)}</td><td class="mono">${P(s.ret1)}</td><td class="mono">${P(s.ret4)}</td><td class="mono">${P(s.ret12)}</td><td class="mono">${P(s.rel4)}</td></tr>`).join("")}</table></div>`;
      const c = d.counts;
      const summary = `<div class="rrg-sum">${Object.entries(c).map(([k, v]) => `<span style="color:${Q[k]}">● ${k} <b>${v}</b></span>`).join("")}</div>${moved.length ? `<div class="ec-small" style="margin:4px 0 8px">Changed quadrant on the latest ${S.tf === "weekly" ? "week" : "session"}: ${moved.map((s) => `<b>${E(s.name)}</b> ${s.prevQuadrant} → <span style="color:${Q[s.quadrant]}">${s.quadrant}</span>`).join(" · ")}</div>` : ""}`;
      body = `<div class="rrg-grid"><div class="panel"><div class="panel-h"><h3>RELATIVE ROTATION</h3><span class="panel-sub mono">click a sector to isolate its trail</span></div><div class="ws-body">${summary}${chart(d)}</div></div>
        <div class="panel"><div class="panel-h"><h3>SECTORS</h3></div><div class="ws-body">${table}
        <div class="lsc-note" style="margin-top:8px">How to read it: right of centre = outperforming NIFTY; above centre = that out/under-performance is accelerating. Sectors tend to rotate clockwise, Improving → Leading → Weakening → Lagging, so Improving names are early and Weakening names are late. ${E(d.method)} ${d.mode === "index" ? "The latest point uses live index quotes." : "The latest point uses the scanner's live prices."}${d.missing && d.missing.length ? ` Yahoo has no history for: ${E(d.missing.join(", "))}; switch to the scanner sector baskets for full coverage.` : ""}</div></div></div></div>`;
    }
    S.el.innerHTML = head + note + body;
  }
  function mountView(el) {
    S.el = el; el.classList.add("rrg");
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-tf]"); if (b) { S.tf = b.dataset.tf; S.data = null; render(); return load(); }
      const md = e.target.closest("[data-mode]"); if (md) { S.mode = md.dataset.mode; S.note = null; S.data = null; render(); return load(); }
      const s = e.target.closest("[data-s]"); if (s) { S.hi = S.hi === s.dataset.s ? null : s.dataset.s; render(); }
    });
  }
  function show() {
    render(); if (!S.data) load();
    clearInterval(S.timer);
    S.timer = setInterval(() => { if (S.el && !S.el.closest("[hidden]") && !document.hidden) load(); }, 60000);
  }
  return { mountView, show, state: S };
})();
var LSC_VIEWS = window.LSC_VIEWS || []; LSC_VIEWS.push({ id: "rotation", label: "Sector Rotation", mount: (el) => LSC_RRG.mountView(el), show: () => LSC_RRG.show() });
