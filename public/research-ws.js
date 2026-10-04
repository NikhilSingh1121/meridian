/* ════════════════════════════════════════════════════════════════════════════
   M-TERMINAL — Equity Research workstation (tabbed)

   Overview · Thesis & View · Financials · Estimates · Peers & Comps · Segments
   Key Ratios · Shareholding · News & Events · Filings & Transcripts

   Everything here is deterministic (reported statements, exchange filings,
   market data, consensus). The only model-assisted panel is the document
   reader in Filings & Transcripts, which is shared with report generation.
   Panels sit on the same 12-column grid as Market Intelligence; a row whose
   panel has no data redistributes its width so boxes stay edge-aligned.
   ════════════════════════════════════════════════════════════════════════════ */
const WS = (() => {
  /* ── state ─────────────────────────────────────────────────────────── */
  const S = { co: null, pack: null, lens: null, est: null, seg: null, peerQ: null, tok: null, tab: "overview", built: new Set() };
  const TABS_DEF = [
    ["overview", "Overview"], ["thesis", "Thesis & View"], ["financials", "Financials"], ["estimates", "Estimates"],
    ["peers", "Peers & Comps"], ["segments", "Segments"], ["ratios", "Key Ratios"], ["shareholding", "Shareholding"],
    ["news", "News & Events"], ["filings", "Filings & Transcripts"],
  ];
  const PAL = { c1: "#c98500", c2: "#3987e5", c3: "#d55181", c4: "#9085e9", up: "#2e9e6b", down: "#c84b3c", hold: "#c98500" };
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  /* ── formatting ────────────────────────────────────────────────────── */
  let U = (v) => v, UNIT = "", SCALE = 1;
  const setUnits = (co) => {
    const u = ersUnits(co.currency); UNIT = u.unit; SCALE = u.scale;
    U = (v, dp = 0) => (v == null || !Number.isFinite(v) ? "—" : (v / SCALE).toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp }));
  };
  const n1 = (v, dp = 1) => (v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp }));
  const sgn = (v, dp = 1, suf = "%") => (v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${n1(v, dp)}${suf}`);
  const cls = (v) => (v == null || !Number.isFinite(v) ? "" : v >= 0 ? "up" : "down");
  const bps = (v) => (v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${Math.round(v)} bps`);
  const fd = (iso) => { const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]} ${MON[+m[2] - 1]} ${m[1]}` : "—"; };
  const fy = (y) => "FY" + String(y).slice(2);
  const px = (v) => F.px(v, S.co && S.co.currency);
  const link = (url, text) => (url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${text}</a>` : text);
  const pctOf = (a, b) => (a != null && b ? (a / b) * 100 : null);
  const growth = (a, b) => (a != null && b != null && b !== 0 ? (a / Math.abs(b) - (b < 0 ? -1 : 1)) * 100 * (b < 0 ? -1 : 1) : null);
  const yoyPct = (a, b) => (a != null && b != null && b !== 0 ? ((a - b) / Math.abs(b)) * 100 : null);

  /* ── panel + grid primitives ───────────────────────────────────────── */
  const ICON = {
    doc: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>', chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
    bars: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', pie: '<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>', flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="1"/><path d="M3 10h18M8 3v4M16 3v4"/>', target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    scale: '<path d="M12 3v18M5 7h14M5 7l-3 7h6zM19 7l-3 7h6z"/>', shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>', grid: '<rect x="3" y="3" width="18" height="18"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
    news: '<rect x="3" y="4" width="18" height="16"/><path d="M7 8h10M7 12h10M7 16h6"/>', bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>', layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  };
  const ic = (k) => `<svg class="ws-ic" viewBox="0 0 24 24">${ICON[k] || ICON.doc}</svg>`;
  const xref = (tab, label) => `<button class="ws-xref" type="button" data-ws-go="${tab}">${label} →</button>`;
  const tabLink = (tab, label) => `<button class="ws-xref" type="button" data-ws-tab-go="${tab}">${label} ↗</button>`;
  /* panel(title, body, { icon, sub, tools }) — title bar identical to Market Intelligence */
  function panel(title, body, o = {}) {
    if (!body) return "";
    return `<div class="panel ws-p"><div class="panel-h"><h3>${ic(o.icon)}${title}</h3>${o.tools || o.sub ? `<div class="ws-tools">${o.sub ? `<span class="panel-sub mono">${o.sub}</span>` : ""}${o.tools || ""}</div>` : ""}</div><div class="ws-body${o.flush ? " flush" : ""}">${body}</div></div>`;
  }
  /* row([[html, span], …]) — drops empty panels and re-spreads the 12 columns */
  function row(cells) {
    const live = cells.filter(([h]) => h);
    if (!live.length) return "";
    const total = live.reduce((a, c) => a + c[1], 0);
    let used = 0;
    return live.map(([h, span], i) => {
      const s = i === live.length - 1 ? 12 - used : Math.max(3, Math.round((span / total) * 12));
      used += s;
      return `<div class="ws-cell" style="grid-column:span ${s}">${h}</div>`;
    }).join("");
  }
  /* for ersGrowthDrivers / ersKeyRisks / ersCapitalAllocation / ersDuPontPanel */
  const legacyBlock = (icon) => (title, sub, inner) => panel(title, inner, { icon, sub });

  /* ── SVG charts (thin marks, rounded data ends, recessive grid, hover tips) ── */
  const CH = new Map(); let chSeq = 0;
  const chart = (spec) => { const id = "wsc" + (++chSeq); CH.set(id, spec); return `<div class="ws-chart" id="${id}" style="height:${spec.h || 190}px"></div>`; };
  const legend = (items) => `<div class="ws-legend">${items.map(([n, c, dash]) => `<span><i style="background:${c}"${dash ? ' class="dash"' : ""}></i>${esc(n)}</span>`).join("")}</div>`;
  function niceScale(lo, hi, n = 4) {
    if (lo === hi) { lo -= 1; hi += 1; }
    const raw = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(Math.abs(raw)))), f = raw / mag;
    const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
    const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step, ticks = [];
    for (let v = a; v <= b + step / 2; v += step) ticks.push(+v.toPrecision(12));
    return { a, b, ticks };
  }
  const tickFmt = (v, pct) => (pct ? `${n1(v, Math.abs(v) < 10 && v % 1 ? 1 : 0)}%` : Math.abs(v) >= 1000 ? (v / 1000).toLocaleString("en-IN", { maximumFractionDigits: 1 }) + "k" : n1(v, Math.abs(v) < 10 && v % 1 ? 1 : 0));
  function roundedBar(x, y0, y1, w, r) {
    const up = y1 < y0, h = Math.abs(y1 - y0); r = Math.min(r, w / 2, h);
    if (h < 0.5) return `M${x},${y0}h${w}`;
    return up
      ? `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`
      : `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
  }
  function axes(W, H, P, sc, y, pct) {
    return sc.ticks.map((t) => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}" class="${t === 0 ? "ws-zero" : "ws-gl"}"/><text x="${P.l - 6}" y="${y(t) + 3}" class="ws-ax" text-anchor="end">${tickFmt(t, pct)}</text>`).join("");
  }
  function svgBars(s, W) {
    const H = s.h || 190, P = { l: 44, r: 8, t: 10, b: 22 };
    const vals = s.series.flatMap((x) => x.values).filter((v) => v != null && Number.isFinite(v));
    if (!vals.length) return "";
    const sc = niceScale(Math.min(0, ...vals), Math.max(0, ...vals));
    const y = (v) => P.t + (1 - (v - sc.a) / (sc.b - sc.a)) * (H - P.t - P.b);
    const gw = (W - P.l - P.r) / s.cats.length, n = s.series.length, bw = Math.max(4, Math.min(20, (gw * 0.66 - (n - 1) * 2) / n));
    let out = axes(W, H, P, sc, y, s.pct);
    s.cats.forEach((c, i) => {
      const g0 = P.l + i * gw + (gw - (n * bw + (n - 1) * 2)) / 2;
      s.series.forEach((se, k) => {
        const v = se.values[i]; if (v == null || !Number.isFinite(v)) return;
        const x = g0 + k * (bw + 2);
        const fill = se.signColor ? (v >= 0 ? PAL.up : PAL.down) : se.color;
        out += `<path d="${roundedBar(x, y(0), y(v), bw, 3)}" fill="${fill}" class="ws-mark" data-tip="${esc(`${c} · ${se.name}\n${s.fmt ? s.fmt(v) : n1(v)}`)}"/>`;
      });
      out += `<text x="${P.l + i * gw + gw / 2}" y="${H - 6}" class="ws-ax" text-anchor="middle">${esc(c)}</text>`;
    });
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(s.label || "bar chart")}">${out}</svg>`;
  }
  function svgLines(s, W) {
    const H = s.h || 190, P = { l: 44, r: 50, t: 12, b: 22 };
    const vals = s.series.flatMap((x) => x.values).filter((v) => v != null && Number.isFinite(v));
    if (vals.length < 2) return "";
    const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.15 || 1;
    const sc = niceScale(s.zeroBase ? Math.min(0, lo) : lo - pad, hi + pad);
    const y = (v) => P.t + (1 - (v - sc.a) / (sc.b - sc.a)) * (H - P.t - P.b);
    const x = (i) => P.l + (s.cats.length === 1 ? (W - P.l - P.r) / 2 : (i / (s.cats.length - 1)) * (W - P.l - P.r));
    let out = axes(W, H, P, sc, y, s.pct);
    s.cats.forEach((c, i) => { out += `<text x="${x(i)}" y="${H - 6}" class="ws-ax" text-anchor="middle">${esc(c)}</text>`; });
    const ends = [];
    s.series.forEach((se) => {
      const pts = se.values.map((v, i) => (v == null || !Number.isFinite(v) ? null : [x(i), y(v), v, i])).filter(Boolean);
      if (!pts.length) return;
      out += `<path d="${pts.map((p, k) => `${k ? "L" : "M"}${p[0]},${p[1]}`).join("")}" fill="none" stroke="${se.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${se.dash ? ' stroke-dasharray="5 4"' : ""}/>`;
      pts.forEach((p) => {
        out += `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="${se.color}" stroke="var(--ink-2)" stroke-width="2"/>`;
        out += `<circle cx="${p[0]}" cy="${p[1]}" r="11" fill="transparent" class="ws-hit" data-tip="${esc(`${s.cats[p[3]]} · ${se.name}\n${s.fmt ? s.fmt(p[2]) : n1(p[2])}`)}"/>`;
      });
      const L = pts.at(-1); ends.push({ y: L[1], text: s.fmt ? s.fmt(L[2]) : n1(L[2]), color: se.color });
    });
    // direct labels at the line ends, nudged apart so they never collide
    ends.sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 12) ends[i].y = ends[i - 1].y + 12;
    ends.forEach((e) => { out += `<text x="${W - P.r + 6}" y="${e.y + 3}" class="ws-end">${esc(e.text)}</text>`; });
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(s.label || "line chart")}">${out}</svg>`;
  }
  function svgDonut(s, W) {
    const H = s.h || 170, R = Math.min(H, W * 0.45) / 2 - 4, r = R * 0.64, cx = R + 6, cy = H / 2;
    const tot = s.items.reduce((a, x) => a + (x.value > 0 ? x.value : 0), 0);
    if (!tot) return "";
    let a0 = -Math.PI / 2, out = "";
    const pt = (rad, a) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
    s.items.filter((x) => x.value > 0).forEach((x) => {
      const a1 = a0 + (x.value / tot) * Math.PI * 2, large = a1 - a0 > Math.PI ? 1 : 0;
      const [x0, y0] = pt(R, a0), [x1, y1] = pt(R, a1), [x2, y2] = pt(r, a1), [x3, y3] = pt(r, a0);
      const d = a1 - a0 >= Math.PI * 2 - 1e-6
        ? `M${cx - R},${cy}a${R},${R} 0 1,0 ${2 * R},0a${R},${R} 0 1,0 ${-2 * R},0M${cx - r},${cy}a${r},${r} 0 1,1 ${2 * r},0a${r},${r} 0 1,1 ${-2 * r},0`
        : `M${x0},${y0}A${R},${R} 0 ${large} 1 ${x1},${y1}L${x2},${y2}A${r},${r} 0 ${large} 0 ${x3},${y3}Z`;
      out += `<path d="${d}" fill="${x.color}" stroke="var(--ink-2)" stroke-width="2" fill-rule="evenodd" class="ws-mark" data-tip="${esc(`${x.name}\n${s.fmt ? s.fmt(x.value) : n1(x.value)} · ${n1((x.value / tot) * 100)}%`)}"/>`;
      a0 = a1;
    });
    out += `<text x="${cx}" y="${cy - 2}" class="ws-dc-v" text-anchor="middle">${esc(s.center || "")}</text><text x="${cx}" y="${cy + 14}" class="ws-dc-l" text-anchor="middle">${esc(s.centerSub || "")}</text>`;
    const lx = cx + R + 22, rows = s.items.filter((x) => x.value > 0);
    rows.forEach((x, i) => {
      const yy = cy - ((rows.length - 1) * 22) / 2 + i * 22;
      out += `<rect x="${lx}" y="${yy - 5}" width="10" height="10" rx="2" fill="${x.color}"/><text x="${lx + 16}" y="${yy + 4}" class="ws-dl-n">${esc(x.name)}</text><text x="${W - 6}" y="${yy + 4}" class="ws-dl-v" text-anchor="end">${n1((x.value / tot) * 100)}%</text>`;
    });
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(s.label || "composition")}">${out}</svg>`;
  }
  function svgStack(s, W) {
    const H = s.h || 170, P = { l: 30, r: 8, t: 10, b: 22 };
    const gw = (W - P.l - P.r) / s.cats.length, bw = Math.min(34, gw * 0.55);
    const y = (v) => P.t + (1 - v / 100) * (H - P.t - P.b);
    let out = [0, 50, 100].map((t) => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}" class="ws-gl"/><text x="${P.l - 6}" y="${y(t) + 3}" class="ws-ax" text-anchor="end">${t}%</text>`).join("");
    s.cats.forEach((c, i) => {
      const tot = s.series.reduce((a, se) => a + (se.values[i] || 0), 0) || 1;
      let acc = 0; const x = P.l + i * gw + (gw - bw) / 2;
      s.series.forEach((se) => {
        const v = se.values[i] || 0; if (!v) return;
        const p0 = (acc / tot) * 100, p1 = ((acc + v) / tot) * 100; acc += v;
        const yTop = y(p1) + 1, yBot = y(p0) - 1;
        if (yBot - yTop > 0.5) out += `<rect x="${x}" y="${yTop}" width="${bw}" height="${yBot - yTop}" rx="2" fill="${se.color}" class="ws-mark" data-tip="${esc(`${c} · ${se.name}\n${v} (${n1((v / tot) * 100, 0)}%)`)}"/>`;
      });
      out += `<text x="${x + bw / 2}" y="${H - 6}" class="ws-ax" text-anchor="middle">${esc(c)}</text>`;
    });
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(s.label || "stacked bars")}">${out}</svg>`;
  }
  function spark(values, W = 88, H = 22) {
    const v = values.filter((x) => x != null && Number.isFinite(x));
    if (v.length < 2) return "";
    const lo = Math.min(...v), hi = Math.max(...v), sp = hi - lo || 1;
    const pts = values.map((x, i) => (x == null || !Number.isFinite(x) ? null : [2 + (i / (values.length - 1)) * (W - 4), 2 + (1 - (x - lo) / sp) * (H - 4)])).filter(Boolean);
    return `<svg class="ws-spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><path d="${pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("")}" fill="none" stroke="${PAL.c1}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${pts.at(-1)[0]}" cy="${pts.at(-1)[1]}" r="2.2" fill="${PAL.c1}"/></svg>`;
  }
  function drawCharts(root) {
    (root || document).querySelectorAll(".ws-chart").forEach((el) => {
      const s = CH.get(el.id), W = el.clientWidth;
      if (!s || !W) return;
      el.innerHTML = { bars: svgBars, lines: svgLines, donut: svgDonut, stack: svgStack }[s.kind](s, W) || `<div class="ws-empty">No data</div>`;
    });
  }
  /* one shared tooltip for every chart mark */
  let tipEl = null;
  function wireTips(host) {
    if (host.__wsTips) return; host.__wsTips = true;
    if (!tipEl) { tipEl = document.createElement("div"); tipEl.className = "ws-tip"; tipEl.hidden = true; document.body.appendChild(tipEl); }
    host.addEventListener("mousemove", (e) => {
      const m = e.target.closest && e.target.closest("[data-tip]");
      if (!m) { tipEl.hidden = true; return; }
      tipEl.innerHTML = String(m.getAttribute("data-tip")).split("\n").map((l, i) => (i ? `<b>${esc(l)}</b>` : `<span>${esc(l)}</span>`)).join("");
      tipEl.hidden = false;
      const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
      tipEl.style.left = Math.min(window.innerWidth - w - 8, e.clientX + 14) + "px";
      tipEl.style.top = Math.max(8, e.clientY - h - 10) + "px";
    });
    host.addEventListener("mouseleave", () => (tipEl.hidden = true));
  }

  /* ═══════════════════════════ HEADER ═══════════════════════════ */
  function header(co) {
    const ks = co.keyStats || {};
    const hi = ks.high52, lo = ks.low52, pos = hi && lo && hi > lo ? Math.max(0, Math.min(100, ((co.price - lo) / (hi - lo)) * 100)) : null;
    const vol = (v) => (v == null ? "—" : v >= 1e7 ? n1(v / 1e7, 2) + " Cr" : v >= 1e5 ? n1(v / 1e5, 1) + " L" : v.toLocaleString("en-IN"));
    const cell = (k, v, sub) => `<div class="ws-stat"><div class="k">${k}</div><div class="v">${v}</div>${sub ? `<div class="s">${sub}</div>` : ""}</div>`;
    const asOf = ks.marketTime ? new Date(ks.marketTime).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
    return `<div class="ws-head">
      <div class="ws-id">
        <h2>${esc(co.name)}</h2>
        <div class="ws-meta">${esc(co.symbol)} <i>·</i> ${esc(co.exchange || "")}${co.profile.sector ? ` <i>·</i> ${esc(co.profile.sector)}` : ""}${co.profile.industry ? ` › ${esc(co.profile.industry)}` : ""}</div>
        <div class="ws-actions">
          <button class="ws-watch mono" id="wsWatchBtn" type="button">☆ Watch</button>
          <button class="ws-watch mono" id="wsWorkbookBtn" type="button" title="Download the consolidated research workbook (Excel)">⬇ Workbook</button>
          <button class="ws-watch mono" id="wsReportBtn" type="button" title="Open Report Generation for this company">▤ Generate report</button>
        </div>
      </div>
      <div class="ws-quote">
        <div class="ws-px" id="wsPriceLive">${F.px(co.price, co.currency)}</div>
        <div class="ws-change ${F.cls(co.changePct)}" id="wsChangeLive">${(co.changePct >= 0 ? "+" : "") + F.pct(co.changePct, 2)}</div>
        ${asOf ? `<div class="ws-asof">${esc(asOf)}</div>` : ""}
      </div>
      <div class="ws-stats">
        ${cell("MARKET CAP", F.cap(ks.mcap, co.currency), ks.ev ? `EV ${F.cap(ks.ev, co.currency)}` : "")}
        <div class="ws-stat ws-range"><div class="k">52-WEEK RANGE</div><div class="v">${n1(lo, 2)} – ${n1(hi, 2)}</div>${pos != null ? `<div class="ws-rbar"><i style="left:${pos.toFixed(1)}%"></i></div>` : ""}</div>
        ${cell("VOLUME", vol(ks.volume), ks.avgVolume ? `avg ${vol(ks.avgVolume)}` : "")}
        ${cell("BETA", n1(ks.beta, 2), "vs market")}
      </div>
    </div>`;
  }

  /* ═══════════════════════════ OVERVIEW ═══════════════════════════ */
  function ovSnapshot(co) {
    const ks = co.keyStats || {}, pf = co.profile || {};
    const off = (pf.officers || []).slice(0, 2).map((o) => `${esc(o.name)}${o.title ? ` <span class="ws-dim">(${esc(o.title)})</span>` : ""}`).join("<br>");
    const f = [
      ["Market cap", F.cap(ks.mcap, co.currency)], ["Enterprise value", F.cap(ks.ev, co.currency)],
      ["Shares outstanding", ks.sharesOut ? n1(ks.sharesOut / 1e7, 2) + " Cr" : "—"], ["Employees", pf.employees ? pf.employees.toLocaleString("en-IN") : "—"],
      ["Headquarters", [pf.city, pf.country].filter(Boolean).map(esc).join(", ") || "—"], ["Website", pf.website ? link(pf.website, esc(pf.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""))) : "—"],
    ];
    return panel("COMPANY SNAPSHOT", `${ersProse(pf.summary, 360)}
      <div class="ws-facts">${f.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("")}</div>
      ${off ? `<div class="ws-lead"><span>Leadership</span><div>${off}</div></div>` : ""}`, { icon: "doc", sub: pf.country || "" });
  }
  function ovStreet(co) {
    const st = co.street || {}, t = (st.trends && st.trends[0]) || st.trend;
    const L = S.lens;
    if (!st.targetMean && !t) return "";
    const b = t ? (t.strongBuy || 0) + (t.buy || 0) : 0, h = t ? t.hold || 0 : 0, sl = t ? (t.sell || 0) + (t.strongSell || 0) : 0, tot = b + h + sl;
    const rm = st.recMean, label = rm == null ? String(st.rec || "—").replace(/_/g, " ").toUpperCase() : rm <= 1.5 ? "STRONG BUY" : rm <= 2.5 ? "BUY" : rm <= 3.5 ? "HOLD" : rm <= 4.5 ? "SELL" : "STRONG SELL";
    const tgt = st.targetMedian ?? st.targetMean, up = tgt && co.price ? (tgt / co.price - 1) * 100 : null;
    const seg = (v, c, n) => (v ? `<i style="width:${(v / tot) * 100}%;background:${c}" data-tip="${esc(`${n}\n${v} analysts · ${n1((v / tot) * 100, 0)}%`)}"></i>` : "");
    return panel("STREET VIEW", `
      <div class="ws-sv-top"><div class="ws-sv-rec ${/BUY/.test(label) ? "up" : /SELL/.test(label) ? "down" : "hold"}">${label}</div><div class="ws-dim">${st.analysts ? `${st.analysts} analysts` : ""}</div></div>
      ${tot ? `<div class="ws-sv-bar">${seg(b, PAL.up, "Buy")}${seg(h, PAL.hold, "Hold")}${seg(sl, PAL.down, "Sell")}</div>
        <div class="ws-sv-leg"><span><i style="background:${PAL.up}"></i>Buy ${n1((b / tot) * 100, 0)}%</span><span><i style="background:${PAL.hold}"></i>Hold ${n1((h / tot) * 100, 0)}%</span><span><i style="background:${PAL.down}"></i>Sell ${n1((sl / tot) * 100, 0)}%</span></div>` : ""}
      ${tgt ? `<div class="ws-sv-tg"><div><span>Consensus target (median)</span><b>${px(tgt)}</b></div><div class="${cls(up)}">${sgn(up)}</div></div>
        <div class="ws-sv-hl"><span>High <b>${px(st.targetHigh)}</b></span><span>Low <b>${px(st.targetLow)}</b></span></div>` : ""}
      <div id="wsOwnTgt">${ownTarget()}</div>`,
      { icon: "target", tools: tabLink("estimates", "Estimates") });
  }
  function ownTarget() {
    const L = S.lens;
    return L && L.target ? `<div class="ws-sv-own"><span>M-Terminal target</span><b>${px(L.target)}</b><em class="${cls(L.upside)}">${sgn(L.upside)}</em>${xref("thesis", "How it is built")}</div>` : "";
  }
  function ovKeyFin(co) {
    const inc = co.statements.income.slice(-4), cf = co.statements.cashflow;
    if (inc.length < 2) return "";
    const cfBy = Object.fromEntries(cf.map((r) => [r.year, r]));
    const rows = [
      ["Revenue", (r) => r.revenue], ["Gross profit", (r) => r.grossProfit], ["EBITDA", (r) => r.ebitda ?? r.opIncome], ["EBIT", (r) => r.ebit ?? r.opIncome],
      ["Net profit", (r) => r.netIncome], ["EPS (basic)", (r) => r.basicEPS, "eps"], ["Operating cash flow", (r) => (cfBy[r.year] || {}).ocf], ["Free cash flow", (r) => (cfBy[r.year] || {}).fcf],
    ].filter(([, f]) => inc.some((r) => f(r) != null));
    const body = `<div class="table-wrap"><table class="dt ws-t"><tr><th>${UNIT}</th>${inc.map((r) => `<th>${fy(r.year)}</th>`).join("")}<th>YoY</th></tr>
      ${rows.map(([l, f, k]) => { const v = inc.map(f), g = yoyPct(v.at(-1), v.at(-2)); return `<tr><td class="nm">${l}</td>${v.map((x) => `<td>${k === "eps" ? n1(x, 2) : U(x)}</td>`).join("")}<td class="${cls(g)}">${sgn(g)}</td></tr>`; }).join("")}
    </table></div>`;
    return panel("KEY FINANCIALS", body, { icon: "grid", sub: "annual · consolidated", tools: xref("financials", "Statements") });
  }
  /* a bridge as a table: same typography and row height as every other .ws-t table;
     the bar column is a floating waterfall segment on a shared scale */
  const SHORT = { "Revenue growth at last year's gross margin": "Revenue growth", "Operating costs below gross profit": "Operating costs", "Advertising & promotion": "Advertising & promo" };
  function bridgeTable(steps, head) {
    if (!steps || !steps.length) return "";
    let run = 0, lo = 0, hi = 0;
    const pts = steps.map((x) => { let a, b; if (x.kind !== "delta") { a = 0; b = x.value; run = x.value; } else { a = run; b = run + x.value; run = b; } lo = Math.min(lo, a, b); hi = Math.max(hi, a, b); return { ...x, a, b }; });
    const span = hi - lo || 1, pos = (v) => ((v - lo) / span) * 100;
    const start = pts[0].value;
    return `<div class="table-wrap"><table class="dt ws-t ws-bt"><tr><th>${head || "Step"}</th><th>${UNIT}</th><th>% of start</th><th class="ws-bt-bar"></th></tr>${pts.map((x) => {
      const d = x.kind === "delta", k = d ? (x.value >= 0 ? "up" : "down") : "tot";
      const l = pos(Math.min(x.a, x.b)), w = Math.max(0.8, Math.abs(pos(x.b) - pos(x.a)));
      const v = `${d && x.value >= 0 ? "+" : ""}${U(x.value)}`;
      return `<tr class="${d ? "" : "rp-tot"}"><td class="nm" title="${esc(x.label)}">${d ? esc(SHORT[x.label] || x.label) : `<b>${esc(x.label)}</b>`}</td><td class="${d ? cls(x.value) : ""}">${d ? v : `<b>${v}</b>`}</td><td class="${d ? cls(x.value) : ""}">${start ? (d ? sgn((x.value / Math.abs(start)) * 100) : n1((x.value / Math.abs(start)) * 100, 0) + "%") : "—"}</td><td class="ws-bt-bar"><span class="ws-bt-track"><i class="${k}" style="left:${l.toFixed(2)}%;width:${w.toFixed(2)}%" data-tip="${esc(`${x.label}
${v} ${UNIT}`)}"></i></span></td></tr>`;
    }).join("")}</table></div>`;
  }
  /* inline magnitude bar inside a table cell (growth ladders, holdings) */
  const cellBar = (v, max, kind) => `<span class="ws-cb"><i class="${kind || (v >= 0 ? "up" : "down")}" style="width:${v == null || !max ? 0 : Math.min(100, (Math.abs(v) / max) * 100).toFixed(1)}%"></i></span>`;
  /* one styled callout instead of bulleted footnotes */
  const callout = (items, tone) => (items && items.length ? `<div class="ws-callout ${tone || ""}">${items.map((t) => `<p>${t}</p>`).join("")}</div>` : "");
  function ovBridge() {
    const b = S.pack && S.pack.annualBridge;
    if (!b) return S.pack ? "" : panel("EARNINGS BRIDGE", `<div class="rp-skel"><i></i><i></i><i></i></div>`, { icon: "bars", sub: "loading…" });
    const max = Math.max(...b.ladder.map((x) => Math.abs(x.growth || 0)), 1);
    const live = b.ladder.filter((x) => x.cur != null || x.prev != null);
    const ladder = `<div class="table-wrap"><table class="dt ws-t ws-bt"><tr><th>Line (${UNIT})</th><th>${esc(b.from)}</th><th>${esc(b.to)}</th><th>Growth</th><th class="ws-bt-bar"></th></tr>${live.map((x) => `<tr><td class="nm">${esc(x.label)}</td><td>${U(x.prev)}</td><td>${U(x.cur)}</td><td class="${cls(x.growth)}">${sgn(x.growth)}</td><td class="ws-bt-bar">${cellBar(x.growth, max)}</td></tr>`).join("")}</table></div>`;
    const c = b.conversion;
    const conv = [["OCF / EBITDA", c.ocfToEbitda], ["OCF / net profit", c.ocfToNetProfit], ["FCF / net profit", c.fcfToNetProfit]].filter((x) => x[1] != null);
    const chips = conv.length ? `<div class="ws-kv3">${conv.map((x) => `<div><span>${x[0]}</span><b class="${x[1] >= 80 ? "up" : x[1] < 60 ? "down" : ""}">${n1(x[1], 0)}%</b></div>`).join("")}</div>` : "";
    const flags = b.flags.length ? callout(b.flags.map(esc), "warn") : callout(["Every step keeps pace with the one above it (no gap wider than 10 points)."], "ok");
    return panel(`EARNINGS BRIDGE · ${esc(b.from)} → ${esc(b.to)}`, `<div class="ws-two"><div><div class="rp-sub">Growth down the income statement to cash</div>${ladder}</div><div>${b.steps ? `<div class="rp-sub">EBITDA bridge</div>${bridgeTable(b.steps, "Driver")}` : ""}</div></div>
      <div class="ws-two ws-two-foot"><div>${chips}</div><div>${flags}</div></div>`,
      { icon: "bars", sub: "where the revenue growth went" });
  }
  function segItems() {
    const q = S.pack && S.pack.quarterly && S.pack.quarterly.quarters && S.pack.quarterly.quarters[0];
    const segs = q ? q.segments.filter((s) => s.revenue > 0) : [];
    if (segs.length > 1) return { label: q.label, items: segs.map((s, i) => ({ name: s.name, value: s.revenue, color: [PAL.c1, PAL.c2, PAL.c3, PAL.c4][i] || "#6b7280" })), total: segs.reduce((a, s) => a + s.revenue, 0) };
    const p = S.seg && S.seg.available && S.seg.product && S.seg.product.at(-1);
    if (p) {
      const list = Object.entries(p.data).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
      const top = list.slice(0, 3), other = list.slice(3).reduce((a, x) => a + x[1], 0);
      const items = top.map(([n, v], i) => ({ name: n, value: v, color: [PAL.c1, PAL.c2, PAL.c3][i] }));
      if (other > 0) items.push({ name: "Other", value: other, color: PAL.c4 });
      return { label: fy(p.year), items, total: list.reduce((a, x) => a + x[1], 0) };
    }
    return null;
  }
  function ovSegments() {
    const s = segItems();
    if (!s) return "";
    return panel("SEGMENT MIX", chart({ kind: "donut", h: 170, items: s.items, center: U(s.total), centerSub: `${UNIT} · ${s.label}`, fmt: (v) => `${U(v)} ${UNIT}`, label: "Revenue by segment" }),
      { icon: "pie", sub: `revenue · ${s.label}`, tools: xref("segments", "Segments") });
  }
  function ovOwnership(co) {
    const sh = S.pack && S.pack.shareholding;
    let items;
    if (sh && sh.quarters.length) {
      const q = sh.quarters[0];
      items = [["Promoter", q.promoter, PAL.c1], ["Public", q.public, PAL.c2], ...(q.employeeTrusts ? [["Employee trusts", q.employeeTrusts, PAL.c4]] : [])];
    } else if (co.holders.insiders != null || co.holders.institutions != null) {
      items = [["Insiders", co.holders.insiders, PAL.c1], ["Institutions", co.holders.institutions, PAL.c2]].filter((x) => x[1] != null);
    } else return "";
    const pl = sh && sh.pledge;
    const bars = items.map(([n, v, c]) => `<div class="ws-own"><span>${n}</span><span class="ws-own-t"><i style="width:${Math.min(100, v)}%;background:${c}" data-tip="${esc(`${n}\n${n1(v, 2)}%`)}"></i></span><b>${n1(v, 2)}%</b></div>`).join("");
    return panel("OWNERSHIP", `${bars}${pl && !pl.none ? `<div class="rp-pledge ${pl.pledgedPctOfPromoter > 25 ? "hi" : pl.pledgedPctOfPromoter > 5 ? "mid" : "ok"}"><b>${n1(pl.pledgedPctOfPromoter, 2)}%</b> of promoter shares pledged</div>` : pl && pl.none ? `<div class="rp-pledge ok"><b>No promoter pledge</b></div>` : ""}`,
      { icon: "users", sub: sh ? `NSE · ${sh.quarters[0].label}` : "data provider", tools: xref("shareholding", "Shareholding") });
  }
  const KIND = { results: "Results", presentation: "Presentation", call: "Earnings call", deal: "Transaction", people: "Management", capital: "Capital", legal: "Legal", press: "Press release" };
  function ovUpdates() {
    const p = S.pack;
    if (!p) return "";
    const items = [
      ...(p.filings || []).map((f) => ({ date: f.date, text: f.text || f.category, tag: KIND[f.kind] || "Filing", url: f.url })),
      ...(p.news || []).slice(0, 6).map((n) => ({ date: n.date, text: n.title, tag: "News", url: n.url, pub: n.publisher })),
    ].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 6);
    if (!items.length) return "";
    return panel("RECENT UPDATES", `<ul class="ws-upd">${items.map((x) => `<li><span class="d">${fd(x.date)}</span><span class="t">${link(x.url, esc(x.text))}${x.pub ? ` <span class="ws-dim">— ${esc(x.pub)}</span>` : ""}</span><em class="rp-tag">${esc(x.tag)}</em></li>`).join("")}</ul>`,
      { icon: "news", tools: xref("news", "News") + xref("filings", "Filings") });
  }
  function paneOverview(co) {
    return [
      { static: true, html: row([[ovSnapshot(co), 5], [panel("PRICE PERFORMANCE", `<div id="wsPriceChart"></div>`, { icon: "chart", flush: true }), 4], [ovStreet(co), 3]]) },
      row([[ovKeyFin(co), 5], [ovBridge(), 7]]),
      row([[ovSegments(), 4], [ovOwnership(co), 4], [ovUpdates(), 4]]),
    ];
  }

  /* ═══════════════════════════ THESIS & VIEW ═══════════════════════════ */
  function thHighlights(co) {
    const items = ersHighlights(co);
    return items.length ? panel("INVESTMENT HIGHLIGHTS", `<ul class="ih-list">${items.map((x) => `<li>${x}</li>`).join("")}</ul>`, { icon: "flag", sub: "computed from reported data" }) : "";
  }
  function thQuality(co) {
    const inc = co.statements.income, g = co.growth || {}, latest = inc.at(-1) || {};
    const netM = latest.revenue ? (latest.netIncome / latest.revenue) * 100 : null;
    const roce = (co.ratios.find((r) => r.name === "ROCE") || {}).value;
    const parts = [];
    if (g.revCagr != null) parts.push(["Growth", `${n1(g.revCagr)}% CAGR`, g.revCagr > 12 ? 25 : g.revCagr > 6 ? 17 : g.revCagr > 0 ? 10 : 0, 25]);
    if (netM != null) parts.push(["Margin", `${n1(netM)}% net`, netM > 15 ? 25 : netM > 8 ? 18 : netM > 3 ? 10 : 3, 25]);
    if (roce != null) parts.push(["Capital returns", `${n1(roce)}% ROCE`, roce > 18 ? 30 : roce > 12 ? 22 : roce > 8 ? 12 : 4, 30]);
    if (g.cashConversion != null) parts.push(["Cash conversion", `${n1(g.cashConversion / 100, 2)}×`, g.cashConversion > 90 ? 20 : g.cashConversion > 70 ? 13 : 6, 20]);
    const q = parts.reduce((a, p) => a + p[2], 0), mx = parts.reduce((a, p) => a + p[3], 0) || 1, qn = Math.round((q / mx) * 100);
    const grade = qn >= 75 ? "High quality" : qn >= 50 ? "Above average" : qn >= 30 ? "Average" : "Challenged";
    const MO = co.moat;
    const moat = MO ? `<div class="rp-sub">Economic moat · ${esc(MO.overall)} <span class="ws-dim">(${esc(MO.sustainability)})</span></div>
      <table class="dt ws-t"><tr><th>Source</th><th>Rating</th><th>Evidence</th></tr>${MO.sources.map((x) => `<tr><td class="nm">${esc(x.name)}</td><td><span class="moat-tag ${esc(x.rating || "")}">${esc(x.rating || "—")}</span></td><td class="ws-dim">${esc(x.evidence)}</td></tr>`).join("")}</table>` : "";
    return panel("BUSINESS QUALITY &amp; MOAT", `<div class="bq-score"><div class="bq-l">BUSINESS QUALITY SCORE</div><div class="bq-v">${qn}<small>/100</small> · ${grade}</div>
      <div class="bq-bars">${parts.map(([l, d, v, m]) => `<div class="bq-bar"><span class="bq-bn">${l}</span><div class="bq-track"><i style="width:${(v / m) * 100}%"></i></div><span class="bq-bd">${d}</span></div>`).join("")}</div></div>${moat}`,
      { icon: "shield", sub: "deterministic scorecard" });
  }
  function thLens() {
    const l = S.lens;
    if (!l) return panel("VALUATION LENS", `<div class="rp-skel"><i></i><i></i><i></i></div>`, { icon: "scale", sub: "loading…" });
    if (l.target == null) return "";
    const card = (title, body, foot) => `<div class="ws-card"><div class="rp-sub">${title}</div><div class="ws-card-b">${body}</div>${foot ? `<div class="ws-card-f">${foot}</div>` : ""}</div>`;
    // 1 · how the target is built
    const st = l.street && l.street.target;
    const build = `<div class="table-wrap"><table class="dt ws-t"><tr><th>Method</th><th>Value / share</th><th>Weight</th><th>Contribution</th></tr>
      ${l.methods.map((m) => `<tr><td class="nm" title="${esc(m.note || "")}">${esc(m.name)}</td><td>${px(m.value)}</td><td>${n1(m.weight * 100, 0)}%</td><td>${px(m.value * m.weight)}</td></tr>`).join("")}
      <tr class="rp-tot"><td class="nm"><b>12-month target</b></td><td><b>${px(l.target)}</b></td><td>100%</td><td class="${cls(l.upside)}"><b>${sgn(l.upside)}</b></td></tr>
      ${st ? `<tr><td class="nm">Consensus target</td><td>${px(st)}</td><td></td><td class="${cls((l.target / st - 1) * 100)}">ours ${sgn((l.target / st - 1) * 100)}</td></tr>` : ""}</table></div>`;
    const c1 = card("How the 12-month target is built", build, `${l.basis === "market" ? `Market basis — Modeling Lab DCF off${l.fairValue ? `; ${esc(l.fairValue.provider)} fair value is the 40% anchor` : "; equal-weighted relative methods"}` : "Weights: Modeling Lab DCF 40%, relative methods share 60%"}. Current price ${px(l.price)}.`);
    // 2 · what the price implies
    const r = l.reverse || {}, dg = l.dcf && l.dcf.growth, hg = l.history && l.history.revCagr;
    const gRows = [["Growth the price implies", r.impliedGrowth, "imp"], ["Modeling Lab DCF assumption (Y1–5)", dg], ["Historical revenue CAGR", hg]].filter((x) => x[1] != null);
    const gMax = Math.max(...gRows.map((x) => Math.abs(x[1])), 1);
    const wRows = [["WACC the price implies", r.impliedWacc], ["Modeling Lab WACC", l.dcf && l.dcf.wacc], ["Terminal growth", l.dcf && l.dcf.terminalG]].filter((x) => x[1] != null);
    const c2 = gRows.length || wRows.length ? card("What today's price implies", `<div class="table-wrap"><table class="dt ws-t ws-bt"><tr><th>Revenue growth, % a year</th><th></th><th class="ws-bt-bar"></th></tr>
      ${gRows.map((x) => `<tr class="${x[2] ? "ws-self" : ""}"><td class="nm">${x[0]}</td><td>${n1(x[1])}%</td><td class="ws-bt-bar">${cellBar(x[1], gMax, x[2] ? "imp" : null)}</td></tr>`).join("")}
      ${wRows.length ? `<tr><th>Discount rate</th><th></th><th class="ws-bt-bar"></th></tr>${wRows.map((x) => `<tr><td class="nm">${x[0]}</td><td>${n1(x[1])}%</td><td class="ws-bt-bar"></td></tr>`).join("")}` : ""}</table></div>`,
      r.impliedGrowth != null ? `At ${px(l.price)} the market is pricing in about <b>${n1(r.impliedGrowth)}%</b> revenue growth a year for five years (reverse cash-flow model)${r.bounded ? "" : r.side === "above" ? " or more" : " or less"}${dg != null ? ` — ${r.impliedGrowth > dg ? "more" : "less"} than our ${n1(dg)}%` : ""}.` : "") : "";
    // 3 · the multiple against its own history
    const bandRow = (name, bb) => {
      if (!bb || bb.current == null || !(bb.max > bb.min)) return "";
      const ps = (v) => (((Math.min(Math.max(v, bb.min), bb.max) - bb.min) / (bb.max - bb.min)) * 100).toFixed(1);
      return `<div class="ws-band"><div class="ws-band-h"><span>${name}</span><b>${n1(bb.current)}×</b><em>${bb.pctile}th pct</em></div>
        <div class="rp-band"><span class="rp-band-iqr" style="left:${ps(bb.p25)}%;width:${(ps(bb.p75) - ps(bb.p25)).toFixed(1)}%"></span><span class="rp-band-med" style="left:${ps(bb.med)}%"></span><span class="rp-band-now" style="left:${ps(bb.current)}%"></span></div>
        <div class="rp-band-axis"><span>${n1(bb.min)}×</span><span>median ${n1(bb.med)}×</span><span>${n1(bb.max)}×</span></div></div>`;
    };
    const B = l.bands || {}, bl = [["Trailing P/E", B.pe], ["Price / book", B.pb]].filter((x) => x[1] && x[1].current != null);
    const c3 = bl.length ? card("Multiple against its own 5-year history", `${bl.map((x) => bandRow(x[0], x[1])).join("")}
      <div class="table-wrap"><table class="dt ws-t"><tr><th>Multiple</th><th>Now</th><th>Median</th><th>IQR</th><th>vs median</th></tr>${bl.map(([n, bb]) => { const d = (bb.current / bb.med - 1) * 100; return `<tr><td class="nm">${n}</td><td>${n1(bb.current)}×</td><td>${n1(bb.med)}×</td><td>${n1(bb.p25)}–${n1(bb.p75)}×</td><td class="${d > 0 ? "down" : "up"}">${sgn(d, 0)}</td></tr>`; }).join("")}</table></div>`,
      "Shaded: interquartile range · grey tick: median · amber marker: today.") : "";
    return panel("VALUATION LENS", `<div class="ws-three ws-cards">${c1}${c2 || card("What today's price implies", `<div class="ws-empty">Market-implied growth not available.</div>`)}${c3 || card("Multiple against its own history", `<div class="ws-empty">Not enough price history.</div>`)}</div>`,
      { icon: "scale", sub: "target build · implied expectations · multiple history", tools: tabLink("models", "Modeling Lab") });
  }
  function thManagement(co) {
    const r = (nm) => (co.ratios.find((x) => x.name === nm) || {}).value;
    const roce = r("ROCE"), roe = r("ROE"), de = r("Debt / Equity"), dy = r("Dividend yield");
    const rows = [
      ["Returns on capital", roce != null ? (roce > 15 ? "Strong" : roce > 8 ? "Adequate" : "Weak") : "—", roce != null ? `${n1(roce)}% ROCE` : "n/a"],
      ["Returns on equity", roe != null ? (roe > 15 ? "Strong" : roe > 10 ? "Adequate" : "Weak") : "—", roe != null ? `${n1(roe)}% ROE` : "n/a"],
      ["Balance-sheet discipline", de != null ? (de < 0.5 ? "Conservative" : de < 1.5 ? "Moderate" : "Aggressive") : "—", de != null ? `${n1(de, 2)}× debt / equity` : "n/a"],
      ["Shareholder distribution", dy != null && dy > 0 ? "Returns cash" : "Retains", dy != null && dy > 0 ? `${n1(dy)}% dividend yield` : "reinvesting"],
    ];
    const off = (co.profile.officers || []).map((o) => `<li><b>${esc(o.name)}</b>${o.title ? `<span>${esc(o.title)}</span>` : ""}</li>`).join("");
    return panel("MANAGEMENT", `${off ? `<ul class="ws-officers">${off}</ul>` : ""}
      <table class="dt ws-t"><tr><th>Review</th><th>Assessment</th><th>Evidence</th></tr>${rows.map((x) => `<tr><td class="nm">${x[0]}</td><td><b>${x[1]}</b></td><td class="ws-dim">${x[2]}</td></tr>`).join("")}</table>`,
      { icon: "users", sub: "leadership · capital-allocation review" });
  }
  function paneThesis(co) {
    return [
      row([[thHighlights(co), 7], [thQuality(co), 5]]),
      row([[thLens(), 12]]),
      row([[ersGrowthDrivers(co, { block: legacyBlock("bolt") }), 6], [ersKeyRisks(co, { block: legacyBlock("shield") }), 6]]),
      row([[thManagement(co), 5], [ersCapitalAllocation(co, { U, unit: UNIT, block: legacyBlock("bars") }), 7]]),
      `<div class="ws-related"><span>Deeper work on this company:</span>${tabLink("forensic", "Forensic Analysis")}${tabLink("models", "Modeling Lab (DCF)")}${tabLink("earnings", "Earnings Call")}<button class="ws-xref" type="button" data-ws-report>Generate report ↗</button></div>`,
    ];
  }

  /* ═══════════════════════════ FINANCIALS ═══════════════════════════ */
  function finQuarter() {
    const q = S.pack && S.pack.quarterly;
    if (!q || !q.quarters || !q.quarters.length) return S.pack ? "" : panel("LATEST QUARTER", `<div class="rp-skel"><i></i><i></i><i></i></div>`, { icon: "cal", sub: "loading exchange filing…" });
    const L = q.quarters[0], rev = L.pl.revenue;
    const ap = (L.expenses.find((e) => /advertis|promotion/i.test(e.label)) || {}).value ?? null;
    const kpi = (k, v, a, b) => `<div class="rp-kpi"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${a || ""}${b ? ` <span class="ws-dim">· ${b}</span>` : ""}</div></div>`;
    const kpis = [
      kpi("REVENUE", U(rev), `<span class="${cls(L.yoy && L.yoy.revenue)}">${sgn(L.yoy && L.yoy.revenue)} YoY</span>`, L.qoq ? `${sgn(L.qoq.revenue)} QoQ` : ""),
      kpi("GROSS MARGIN", `${n1(L.derived.grossMargin)}%`, L.yoy ? `<span class="${cls(L.yoy.grossMarginBps)}">${bps(L.yoy.grossMarginBps)} YoY</span>` : ""),
      kpi("EBITDA", U(L.derived.ebitda), `<span class="${cls(L.yoy && L.yoy.ebitda)}">${sgn(L.yoy && L.yoy.ebitda)} YoY</span>`, `${n1(L.derived.ebitdaMargin)}% margin`),
      kpi("NET PROFIT", U(L.pl.pat), `<span class="${cls(L.yoy && L.yoy.pat)}">${sgn(L.yoy && L.yoy.pat)} YoY</span>`, `EPS ${n1(L.pl.eps, 2)}`),
      ap != null ? kpi("ADVERTISING &amp; PROMOTION", U(ap), `${n1((ap / rev) * 100)}% of revenue`) : "",
    ].join("");
    const qs = q.quarters.slice().reverse();
    const apOf = (x) => { const a = (x.expenses.find((e) => /advertis|promotion/i.test(e.label)) || {}).value; return a != null ? (a / x.pl.revenue) * 100 : null; };
    const rw = (label, f, c) => `<tr><td class="nm">${label}</td>${qs.map((x) => `<td class="${c ? c(x) : ""}">${f(x)}</td>`).join("")}</tr>`;
    const trend = `<div class="table-wrap"><table class="dt ws-t"><tr><th>${UNIT}</th>${qs.map((x) => `<th>${esc(x.label)}</th>`).join("")}</tr>
      ${rw("Revenue", (x) => U(x.pl.revenue))}${rw("YoY growth", (x) => sgn(x.yoy && x.yoy.revenue), (x) => cls(x.yoy && x.yoy.revenue))}
      ${rw("Gross margin", (x) => n1(x.derived.grossMargin) + "%")}${rw("EBITDA", (x) => U(x.derived.ebitda))}${rw("EBITDA margin", (x) => n1(x.derived.ebitdaMargin) + "%")}
      ${rw("Net profit", (x) => U(x.pl.pat))}${qs.some((x) => apOf(x) != null) ? rw("A&amp;P % of revenue", (x) => (apOf(x) == null ? "—" : n1(apOf(x)) + "%")) : ""}</table></div>`;
    const br = q.bridge ? bridgeTable(q.bridge.steps, `EBITDA bridge · ${esc(q.bridge.from)} → ${esc(q.bridge.to)}`) : "";
    return panel(`LATEST QUARTER · ${esc(L.label)}`, `<div class="rp-kpis">${kpis}</div><div class="ws-q2"><div>${trend}</div><div>${br}</div></div>
      <div class="rp-src">Source: ${esc(q.scope.toLowerCase())} results filed with NSE (XBRL), ${fd(L.filed)} · ${L.audited ? "audited" : "unaudited"} · EBITDA = revenue − operating expenses excl. finance cost and D&amp;A.</div>`,
      { icon: "cal", sub: `${esc(q.scope)} · filed with the exchange`, tools: xref("segments", "Segments") + xref("peers", "Peers' quarter") });
  }
  function finStatements(co) {
    const yrs = co.statements.income.map((r) => r.year);
    return panel("FINANCIAL STATEMENTS", `<div id="ersStmtsWrap">${ersStatementsInner(co, { U, unit: UNIT, yrs })}</div>`,
      { icon: "doc", sub: `annual · ${yrs.length} years · ${UNIT} · YoY and CAGR` });
  }
  function finCharts(co) {
    const inc = co.statements.income, cf = co.statements.cashflow, cats = inc.map((r) => fy(r.year));
    const cfBy = Object.fromEntries(cf.map((r) => [r.year, r]));
    const sc = (v) => (v == null ? null : v / SCALE);
    const fmtU = (v) => `${n1(v, 0)} ${UNIT}`;
    const a = chart({ kind: "bars", h: 200, cats, fmt: fmtU, label: "Revenue, EBITDA and net profit", series: [
      { name: "Revenue", color: PAL.c1, values: inc.map((r) => sc(r.revenue)) }, { name: "EBITDA", color: PAL.c2, values: inc.map((r) => sc(r.ebitda ?? r.opIncome)) }, { name: "Net profit", color: PAL.c3, values: inc.map((r) => sc(r.netIncome)) }] });
    const m = (f) => inc.map((r) => (r.revenue ? (f(r) / r.revenue) * 100 : null));
    const b = chart({ kind: "lines", h: 200, cats, pct: true, fmt: (v) => n1(v) + "%", label: "Margin trend", series: [
      { name: "Gross margin", color: PAL.c1, values: m((r) => r.grossProfit) }, { name: "EBITDA margin", color: PAL.c2, values: m((r) => r.ebitda ?? r.opIncome) }, { name: "Net margin", color: PAL.c3, values: m((r) => r.netIncome) }] });
    const c = chart({ kind: "bars", h: 200, cats, fmt: fmtU, label: "Cash flow", series: [
      { name: "Operating cash flow", color: PAL.c1, values: inc.map((r) => sc((cfBy[r.year] || {}).ocf)) }, { name: "Capex", color: PAL.c3, values: inc.map((r) => { const v = (cfBy[r.year] || {}).capex; return v == null ? null : -Math.abs(v) / SCALE; }) }, { name: "Free cash flow", color: PAL.c2, values: inc.map((r) => sc((cfBy[r.year] || {}).fcf)) }] });
    return row([
      [panel(`REVENUE · EBITDA · NET PROFIT`, a + legend([["Revenue", PAL.c1], ["EBITDA", PAL.c2], ["Net profit", PAL.c3]]), { icon: "bars", sub: UNIT }), 4],
      [panel("MARGIN TREND", b + legend([["Gross margin", PAL.c1], ["EBITDA margin", PAL.c2], ["Net margin", PAL.c3]]), { icon: "chart", sub: "% of revenue" }), 4],
      [panel("CASH FLOW", c + legend([["Operating cash flow", PAL.c1], ["Capex", PAL.c3], ["Free cash flow", PAL.c2]]), { icon: "bars", sub: UNIT }), 4],
    ]);
  }
  function finGrowth(co) {
    const inc = co.statements.income, cf = co.statements.cashflow;
    const cagr = (arr) => { const v = arr.filter((x) => x != null && x > 0); return v.length >= 2 ? (Math.pow(v.at(-1) / v[0], 1 / (v.length - 1)) - 1) * 100 : null; };
    const tiles = [["Revenue", inc.map((r) => r.revenue)], ["Gross profit", inc.map((r) => r.grossProfit)], ["EBITDA", inc.map((r) => r.ebitda ?? r.opIncome)],
      ["Net profit", inc.map((r) => r.netIncome)], ["EPS", inc.map((r) => r.basicEPS)], ["Free cash flow", cf.map((r) => r.fcf)]]
      .map(([n, s]) => [n, cagr(s), s]).filter((t) => t[1] != null);
    if (!tiles.length) return "";
    return panel(`GROWTH · ${inc.length - 1}-YEAR CAGR`, `<div class="ws-tiles">${tiles.map(([n, g, s]) => `<div class="ws-tile"><div class="k">${n}</div><div class="v ${cls(g)}">${sgn(g)}</div>${spark(s)}</div>`).join("")}</div>`,
      { icon: "chart", sub: `${fy(inc[0].year)} → ${fy(inc.at(-1).year)} · from reported statements`, tools: xref("ratios", "Key ratios") });
  }
  function paneFinancials(co) {
    return [row([[finQuarter(), 12]]), { static: true, html: row([[finStatements(co), 12]]) }, finCharts(co), row([[finGrowth(co), 12]])];
  }

  /* ═══════════════════════════ ESTIMATES ═══════════════════════════ */
  function estAvailable() { const e = S.est; return !!(e && e.available && e.forward && e.forward.some((f) => f.epsAvg != null || f.revenueAvg != null)); }
  function paneEstimates(co) {
    const e = S.est;
    if (!e) return [row([[panel("CONSENSUS ESTIMATES", `<div class="rp-skel"><i></i><i></i><i></i></div>`, { icon: "target", sub: "loading…" }), 12]])];
    if (!estAvailable()) return [row([[panel("CONSENSUS ESTIMATES", `<div class="ws-empty">No analyst estimates are published for this company by the data provider.</div>`, { icon: "target" }), 12]])];
    const f = Object.fromEntries(e.forward.map((x) => [x.period, x]));
    // next-FY growth is measured against the current-FY consensus (the provider's own
    // next-FY growth field uses an inconsistent base for revenue)
    if (f["+1y"] && f["0y"]) {
      if (f["+1y"].revenueAvg && f["0y"].revenueAvg) f["+1y"].revenueGrowthPct = (f["+1y"].revenueAvg / f["0y"].revenueAvg - 1) * 100;
      if (f["+1y"].epsAvg != null && f["0y"].epsAvg) f["+1y"].growthPct = (f["+1y"].epsAvg / f["0y"].epsAvg - 1) * 100;
    }
    const st = co.street || {}, tgt = st.targetMedian ?? st.targetMean, up = tgt && co.price ? (tgt / co.price - 1) * 100 : null;
    const nx = e.next || {};
    const tile = (k, v, s, c) => `<div class="ws-tile"><div class="k">${k}</div><div class="v ${c || ""}">${v}</div><div class="s">${s || ""}</div></div>`;
    const tiles = [
      nx.date ? tile("NEXT RESULTS", fd(nx.date.slice(0, 10)), `${nx.isEstimate ? "estimated" : "confirmed"}${nx.daysUntil != null ? ` · in ${nx.daysUntil} days` : ""}`) : "",
      nx.epsEstimate != null ? tile("NEXT QTR EPS", n1(nx.epsEstimate, 2), nx.epsLow != null ? `range ${n1(nx.epsLow, 2)} – ${n1(nx.epsHigh, 2)}` : "") : "",
      nx.revenueEstimate != null ? tile("NEXT QTR REVENUE", `${U(nx.revenueEstimate)}`, UNIT) : "",
      f["0y"] ? tile("CURRENT FY EPS", n1(f["0y"].epsAvg, 2), `${sgn(f["0y"].growthPct)} growth`, "") : "",
      f["0y"] && f["0y"].revenueAvg ? tile("CURRENT FY REVENUE", U(f["0y"].revenueAvg), `${sgn(f["0y"].revenueGrowthPct)} growth`) : "",
      tgt ? tile("TARGET (MEDIAN)", px(tgt), `${sgn(up)} vs price`, cls(up)) : "",
    ].join("");
    const table = `<div class="table-wrap"><table class="dt ws-t"><tr><th>Period</th><th>Ends</th><th>EPS avg</th><th>EPS range</th><th>EPS growth</th><th>Revenue avg (${UNIT})</th><th>Revenue growth</th><th>Analysts</th></tr>
      ${e.forward.map((x) => `<tr><td class="nm">${esc(x.label)}</td><td>${fd(String(x.endDate || "").slice(0, 10))}</td><td>${n1(x.epsAvg, 2)}</td><td class="ws-dim">${x.epsLow != null ? `${n1(x.epsLow, 2)} – ${n1(x.epsHigh, 2)}` : "—"}</td><td class="${cls(x.growthPct)}">${sgn(x.growthPct)}</td><td>${U(x.revenueAvg)}</td><td class="${cls(x.revenueGrowthPct)}">${sgn(x.revenueGrowthPct)}</td><td>${x.numAnalysts ?? "—"}</td></tr>`).join("")}</table></div>`;
    const rv = e.forward.filter((x) => x.revisions && (x.revisions.up30 != null || x.revisions.down30 != null));
    const revisions = rv.length ? chart({ kind: "bars", h: 180, cats: rv.map((x) => x.label), fmt: (v) => `${Math.abs(v)} revisions`, label: "EPS estimate revisions, last 30 days", series: [
      { name: "Raised (30 days)", color: PAL.up, values: rv.map((x) => x.revisions.up30 || 0) }, { name: "Cut (30 days)", color: PAL.down, values: rv.map((x) => -(x.revisions.down30 || 0)) }] })
      + legend([["Raised", PAL.up], ["Cut", PAL.down]]) : "";
    const h = e.history || [];
    const surprise = h.length ? chart({ kind: "bars", h: 180, cats: h.map((x) => { const d = String(x.date).slice(0, 10); return d.slice(5, 7) + "/" + d.slice(2, 4); }), fmt: (v) => n1(v, 2), label: "EPS actual vs estimate", series: [
      { name: "Estimate", color: PAL.c4, values: h.map((x) => x.epsEstimate) }, { name: "Actual", color: PAL.c1, values: h.map((x) => x.epsActual) }] })
      + legend([["Estimate", PAL.c4], ["Actual", PAL.c1]])
      + `<div class="rp-chips">${e.stats && e.stats.quarters ? `<span class="rp-chip">Beat <b>${e.stats.beats}/${e.stats.quarters}</b></span><span class="rp-chip">Avg surprise <b class="${cls(e.stats.avgSurprise)}">${sgn(e.stats.avgSurprise)}</b></span>` : ""}</div>` : "";
    const tr = (st.trends || []).slice().reverse();
    const recTrend = tr.length ? chart({ kind: "stack", h: 170, cats: tr.map((x) => ({ "0m": "Now", "-1m": "1M ago", "-2m": "2M ago", "-3m": "3M ago" }[x.period] || x.period)), label: "Recommendation trend", series: [
      { name: "Buy", color: PAL.up, values: tr.map((x) => (x.strongBuy || 0) + (x.buy || 0)) }, { name: "Hold", color: PAL.hold, values: tr.map((x) => x.hold || 0) }, { name: "Sell", color: PAL.down, values: tr.map((x) => (x.sell || 0) + (x.strongSell || 0)) }] })
      + legend([["Buy", PAL.up], ["Hold", PAL.hold], ["Sell", PAL.down]]) : "";
    const range = st.targetLow && st.targetHigh && st.targetHigh > st.targetLow ? (() => {
      const lo = Math.min(st.targetLow, co.price), hi = Math.max(st.targetHigh, co.price), pos = (v) => (((v - lo) / (hi - lo)) * 100).toFixed(1);
      return `<div class="rp-sub">Target price range</div><div class="ws-trange"><span class="ws-tr-band" style="left:${pos(st.targetLow)}%;width:${(pos(st.targetHigh) - pos(st.targetLow)).toFixed(1)}%"></span>
        ${tgt ? `<span class="ws-tr-med" style="left:${pos(tgt)}%" data-tip="${esc(`Median target\n${px(tgt)}`)}"></span>` : ""}<span class="ws-tr-now" style="left:${pos(co.price)}%" data-tip="${esc(`Current price\n${px(co.price)}`)}"><em>Price</em></span></div>
        <div class="rp-band-axis"><span>Low ${px(st.targetLow)}</span><span>Median ${px(tgt)}</span><span>High ${px(st.targetHigh)}</span></div>`;
    })() : "";
    return [
      row([[panel("CONSENSUS SNAPSHOT", `<div class="ws-tiles">${tiles}</div>`, { icon: "target", sub: `${st.analysts || "—"} analysts · data provider consensus`, tools: tabLink("earnings", "Earnings Call") }), 12]]),
      row([[panel("CONSENSUS BY PERIOD", table, { icon: "grid", sub: "EPS and revenue" }), 8], [panel("ESTIMATE REVISIONS", revisions, { icon: "bars", sub: "EPS · last 30 days" }), 4]]),
      row([[panel("EARNINGS SURPRISES", surprise, { icon: "bars", sub: "EPS · last 4 quarters" }), 5], [panel("RECOMMENDATION TREND", recTrend + range, { icon: "users", sub: "last 4 months" }), 7]]),
    ];
  }

  /* ═══════════════════════════ PEERS & COMPS ═══════════════════════════ */
  const REL = [["pe", "P/E", "x"], ["evEbitda", "EV/EBITDA", "x"], ["pb", "P/B", "x"], ["roe", "ROE", "pct"], ["netMargin", "Net margin", "pct"], ["revGrowth", "Revenue growth", "pct"]];
  let relKey = "pe";
  function relChart() {
    const rows = (typeof PEERS !== "undefined" && PEERS) || [];
    const [k, lbl, t] = REL.find((r) => r[0] === relKey);
    const data = rows.filter((r) => r[k] != null && Number.isFinite(r[k]));
    if (data.length < 2) return `<div class="ws-empty">Not enough peer data for ${lbl}.</div>`;
    const vals = data.map((r) => r[k]).sort((a, b) => a - b), med = vals[Math.floor(vals.length / 2)];
    const max = Math.max(...data.map((r) => Math.abs(r[k])), 1);
    return `<div class="ws-rel">${data.map((r, i) => `<div class="ws-rel-r${i === 0 ? " self" : ""}"><span class="n">${esc(r.name)}</span><span class="tk"><i style="width:${((Math.abs(r[k]) / max) * 100).toFixed(1)}%" data-tip="${esc(`${r.name}\n${lbl} ${t === "pct" ? n1(r[k]) + "%" : n1(r[k], 1) + "×"}`)}"></i><b style="left:${((Math.abs(med) / max) * 100).toFixed(1)}%"></b></span><span class="v">${t === "pct" ? n1(r[k]) + "%" : n1(r[k], 1) + "×"}</span></div>`).join("")}</div>
      <div class="rp-note">Vertical marker: peer median ${t === "pct" ? n1(med) + "%" : n1(med, 1) + "×"}. Highlighted row: ${esc(rows[0] ? rows[0].name : "")}.</div>`;
  }
  function peerQTable(d) {
    const rows = (d && d.rows) || [];
    if (!rows.length) return `<div class="ws-empty">No listed peers with exchange filings were found.</div>`;
    const labels = [...new Set(rows.filter((r) => r.available).map((r) => r.label))];
    return `<div class="table-wrap"><table class="dt ws-t"><tr><th>Company</th><th>Quarter</th><th>Revenue (${UNIT})</th><th>YoY</th><th>Gross margin</th><th>Δ YoY</th><th>EBITDA margin</th><th>Δ YoY</th><th>Net profit YoY</th><th>A&amp;P %</th></tr>
      ${rows.map((r) => r.available ? `<tr class="${r.isSelf ? "ws-self" : ""}"><td class="nm">${esc(r.name)}</td><td>${esc(r.label)}</td><td>${U(r.revenue)}</td><td class="${cls(r.revenueYoy)}">${sgn(r.revenueYoy)}</td><td>${n1(r.grossMargin)}%</td><td class="${cls(r.grossMarginYoyBps)}">${bps(r.grossMarginYoyBps)}</td><td>${n1(r.ebitdaMargin)}%</td><td class="${cls(r.ebitdaMarginYoyBps)}">${bps(r.ebitdaMarginYoyBps)}</td><td class="${cls(r.patYoy)}">${sgn(r.patYoy)}</td><td>${r.apPct == null ? "—" : n1(r.apPct) + "%"}</td></tr>`
        : `<tr><td class="nm">${esc(r.name)}</td><td colspan="9" class="ws-dim" style="text-align:left">results filing not readable from NSE right now</td></tr>`).join("")}</table></div>
      ${rows.some((r) => !r.available) ? `<div class="rp-note">${rows.filter((r) => !r.available).length} of ${rows.length} filings could not be read. <button class="ws-xref" type="button" id="wsPeerQGo">Retry ↻</button></div>` : ""}
      ${labels.length > 1 ? `<div class="rp-note">Peers report on different calendars — compare like-labelled quarters.</div>` : ""}<div class="rp-src">Source: each company's consolidated results as filed with NSE (XBRL); margins computed identically.</div>`;
  }
  function panePeers(co) {
    const isIN = /\.(NS|BO)$/i.test(co.symbol);
    return [
      { static: true, html: row([[panel("PEER SET &amp; COMPARABLES", `<div class="peer-tools" id="peerTools"></div><div id="peerBlock"><div class="loading mono">selecting peers…</div></div>`, { icon: "users", sub: "customisable · up to 10 comparables" }), 12]]) },
      row([
        [panel("RELATIVE VALUATION", `<div id="wsRel">${relChart()}</div>`, { icon: "scale", tools: `<div class="mc-tf" id="wsRelKeys">${REL.map(([k, l]) => `<button class="mc-tfb${k === relKey ? " on" : ""}" type="button" data-rel="${k}">${l}</button>`).join("")}</div>` }), 6],
        [isIN ? panel("LATEST FILED QUARTER · PEERS", `<div id="wsPeerQ">${S.peerQ ? peerQTable(S.peerQ) : `<div class="ws-cta"><p>Compare every listed peer's most recent quarter, exactly as filed with the exchange.</p><button class="mini-btn" type="button" id="wsPeerQGo">Load peers' latest quarter</button><span class="ws-dim">about 20 s the first time</span></div>`}</div>`, { icon: "grid", sub: "exchange XBRL" }) : "", 6],
      ]),
    ];
  }

  /* ═══════════════════════════ SEGMENTS ═══════════════════════════ */
  function paneSegments() {
    const q = S.pack && S.pack.quarterly;
    const rowsOut = [];
    if (q && q.quarters && q.quarters.some((x) => x.segments.length > 1)) {
      const qs = q.quarters.slice().reverse().filter((x) => x.segments.length > 1);
      const names = [...new Set(qs.flatMap((x) => x.segments.map((s) => s.name)))].slice(0, 4);
      const colors = [PAL.c1, PAL.c2, PAL.c3, PAL.c4];
      const val = (x, n, k) => { const s = x.segments.find((y) => y.name === n); return s ? s[k] : null; };
      const cats = qs.map((x) => x.label);
      const revChart = chart({ kind: "bars", h: 210, cats, fmt: (v) => `${n1(v, 0)} ${UNIT}`, label: "Segment revenue by quarter", series: names.map((n, i) => ({ name: n, color: colors[i], values: qs.map((x) => { const v = val(x, n, "revenue"); return v == null ? null : v / SCALE; }) })) });
      const mChart = chart({ kind: "lines", h: 210, cats, pct: true, fmt: (v) => n1(v) + "%", label: "Segment EBIT margin by quarter", series: names.map((n, i) => ({ name: n, color: colors[i], values: qs.map((x) => val(x, n, "margin")) })) });
      const L = q.quarters[0];
      const table = `<div class="table-wrap"><table class="dt ws-t"><tr><th>Segment · ${esc(L.label)}</th><th>Revenue (${UNIT})</th><th>Share</th><th>YoY</th><th>EBIT (${UNIT})</th><th>EBIT margin</th><th>Δ margin YoY</th><th>Revenue trend</th></tr>
        ${L.segments.filter((s) => s.revenue != null).map((s) => `<tr><td class="nm">${esc(s.name)}</td><td>${U(s.revenue)}</td><td>${n1(pctOf(s.revenue, L.pl.revenue))}%</td><td class="${cls(s.revenueYoy)}">${sgn(s.revenueYoy)}</td><td>${U(s.ebit)}</td><td>${n1(s.margin)}%</td><td class="${cls(s.marginYoyBps)}">${bps(s.marginYoyBps)}</td><td>${spark(qs.map((x) => val(x, s.name, "revenue")))}</td></tr>`).join("")}</table></div>`;
      rowsOut.push(row([[panel(`SEGMENT PERFORMANCE · ${esc(L.label)}`, table, { icon: "layers", sub: `${esc(q.scope)} · exchange filing` }), 12]]));
      rowsOut.push(row([[panel("SEGMENT REVENUE · QUARTERLY", revChart + legend(names.map((n, i) => [n, colors[i]])), { icon: "bars", sub: UNIT }), 6], [panel("SEGMENT EBIT MARGIN · QUARTERLY", mChart + legend(names.map((n, i) => [n, colors[i]])), { icon: "chart", sub: "% of segment revenue" }), 6]]));
    }
    const sg = S.seg;
    if (sg && sg.available) {
      const blocks = [["product", "REVENUE BY BUSINESS · ANNUAL"], ["geographic", "REVENUE BY GEOGRAPHY · ANNUAL"]].map(([k, t]) => {
        const hist = sg[k] || [], L = hist.at(-1), P = hist.at(-2);
        if (!L) return "";
        const list = Object.entries(L.data).filter(([, v]) => v != null).sort((a, b) => b[1] - a[1]), tot = list.reduce((a, x) => a + (x[1] || 0), 0) || 1;
        return panel(t, `<div class="table-wrap"><table class="dt ws-t"><tr><th>${fy(L.year)}</th><th>${UNIT}</th><th>Share</th><th>Growth</th></tr>${list.map(([n, v]) => { const pv = P ? P.data[n] : null, g = yoyPct(v, pv); return `<tr><td class="nm">${esc(n)}</td><td>${U(v)}</td><td>${n1((v / tot) * 100)}%</td><td class="${cls(g)}">${sgn(g)}</td></tr>`; }).join("")}</table></div>`, { icon: "pie", sub: "company filings" });
      });
      rowsOut.push(row([[blocks[0], 6], [blocks[1], 6]]));
    }
    if (!rowsOut.length) rowsOut.push(row([[panel("SEGMENTS", S.pack ? `<div class="ws-empty">This company does not report business segments in its exchange filings${sg ? "" : " (checking the annual disclosure…)"}.</div>` : `<div class="rp-skel"><i></i><i></i><i></i></div>`, { icon: "layers" }), 12]]));
    return rowsOut;
  }

  /* ═══════════════════════════ KEY RATIOS ═══════════════════════════ */
  function yearRatios(co) {
    const inc = co.statements.income, balBy = Object.fromEntries(co.statements.balance.map((r) => [r.year, r])), cfBy = Object.fromEntries(co.statements.cashflow.map((r) => [r.year, r]));
    const roceBy = Object.fromEntries((co.series.roce || []).map((p) => [p.year ?? p.t, p.v]));
    const d = (a, b) => (a != null && b != null && b !== 0 ? a / b : null);
    return inc.map((r, i) => {
      const b = balBy[r.year] || {}, c = cfBy[r.year] || {}, ebitda = r.ebitda ?? r.opIncome, ebit = r.ebit ?? r.opIncome;
      const cogs = r.cogs ?? (r.revenue != null && r.grossProfit != null ? r.revenue - r.grossProfit : null);
      const debt = b.totalDebt > 0 ? b.totalDebt : (b.ltDebt || 0) + (b.stDebt || 0);
      const invD = d(b.inventory, cogs) != null ? d(b.inventory, cogs) * 365 : null, recD = d(b.receivables, r.revenue) != null ? d(b.receivables, r.revenue) * 365 : null, payD = d(b.payables, cogs) != null ? d(b.payables, cogs) * 365 : null;
      return {
        year: r.year,
        grossM: d(r.grossProfit, r.revenue) * 100, ebitdaM: d(ebitda, r.revenue) * 100, ebitM: d(ebit, r.revenue) * 100, netM: d(r.netIncome, r.revenue) * 100, fcfM: d(c.fcf, r.revenue) * 100,
        roe: d(r.netIncome, b.equity) * 100, roce: roceBy[r.year] ?? (b.assets != null && b.currentLiab != null ? d(ebit, b.assets - b.currentLiab) * 100 : null), roa: d(r.netIncome, b.assets) * 100,
        de: d(debt, b.equity), nde: d(debt - (b.cash || 0), b.equity), ndEbitda: d(debt - (b.cash || 0), ebitda), icov: r.interest ? d(ebit, Math.abs(r.interest)) : null,
        cur: d(b.currentAssets, b.currentLiab), quick: d((b.currentAssets ?? 0) - (b.inventory ?? 0), b.currentLiab), cash: d(b.cash, b.currentLiab),
        turn: d(r.revenue, b.assets), invD, recD, payD, ccc: invD != null && recD != null && payD != null ? invD + recD - payD : null,
        eps: r.basicEPS, deps: r.dilutedEPS, payout: c.dividends != null && r.netIncome ? (Math.abs(c.dividends) / r.netIncome) * 100 : null, ocfNi: d(c.ocf, r.netIncome) * 100,
      };
    }).map((o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v == null || !Number.isFinite(v) ? null : v])));
  }
  const RATIO_GROUPS = [
    ["PROFITABILITY", "chart", [["Gross margin", "grossM", "pct"], ["EBITDA margin", "ebitdaM", "pct"], ["EBIT margin", "ebitM", "pct"], ["Net margin", "netM", "pct"], ["FCF margin", "fcfM", "pct"]]],
    ["RETURNS", "target", [["Return on equity", "roe", "pct"], ["Return on capital employed", "roce", "pct"], ["Return on assets", "roa", "pct"], ["Cash conversion (OCF / net profit)", "ocfNi", "pct"]]],
    ["LEVERAGE &amp; COVERAGE", "shield", [["Debt / equity", "de", "x"], ["Net debt / equity", "nde", "x"], ["Net debt / EBITDA", "ndEbitda", "x"], ["Interest coverage", "icov", "x"]]],
    ["EFFICIENCY", "bars", [["Asset turnover", "turn", "x"], ["Inventory days", "invD", "d"], ["Receivable days", "recD", "d"], ["Payable days", "payD", "d"], ["Cash conversion cycle (days)", "ccc", "d"]]],
    ["LIQUIDITY", "layers", [["Current ratio", "cur", "x"], ["Quick ratio", "quick", "x"], ["Cash ratio", "cash", "x"]]],
    ["PER SHARE &amp; PAYOUT", "grid", [["EPS (basic)", "eps", "n"], ["EPS (diluted)", "deps", "n"], ["Dividend payout", "payout", "pct"]]],
  ];
  const ratioFmt = (v, t) => (v == null ? "—" : t === "pct" ? n1(v) + "%" : t === "x" ? n1(v, 2) + "×" : t === "d" ? n1(v, 0) : n1(v, 2));
  function ratioTable(title, icon, ys, lines) {
    const live = lines.filter(([, k]) => ys.some((y) => y[k] != null));
    if (!live.length) return "";
    return panel(title, `<div class="table-wrap"><table class="dt ws-t ws-rt"><tr><th>Metric</th><th class="ws-rt-sp">Trend</th>${ys.map((y) => `<th>${fy(y.year)}</th>`).join("")}</tr>
      ${live.map(([l, k, t]) => `<tr><td class="nm">${l}</td><td class="ws-rt-sp">${spark(ys.map((y) => y[k]), 64, 18)}</td>${ys.map((y) => `<td>${ratioFmt(y[k], t)}</td>`).join("")}</tr>`).join("")}</table></div>`, { icon });
  }
  function paneRatios(co) {
    const ys = yearRatios(co);
    const val = co.ratios.filter((r) => /Valuation|Market/.test(r.group));
    const valT = val.length ? panel("VALUATION MULTIPLES · CURRENT", `<div class="table-wrap"><table class="dt ws-t"><tr><th>Metric</th><th>Current</th><th>What it says</th></tr>${val.map((r) => `<tr><td class="nm">${esc(r.name)}</td><td><b>${r.fmt === "pct" ? n1(r.value) + "%" : r.fmt === "x" ? n1(r.value, 2) + "×" : n1(r.value, 2)}</b></td><td class="ws-dim">${esc(r.note || "")}</td></tr>`).join("")}</table></div>`, { icon: "scale", sub: "market price · trailing / forward", tools: xref("thesis", "5-year P/E band") }) : "";
    return [
      row(RATIO_GROUPS.slice(0, 3).map((g) => [ratioTable(g[0], g[1], ys, g[2]), 4])),
      row(RATIO_GROUPS.slice(3).map((g) => [ratioTable(g[0], g[1], ys, g[2]), 4])),
      row([[valT, 5], [ersDuPontPanel(co, { block: legacyBlock("layers") }), 7]]),
      `<div class="ws-foot">Year-wise ratios are computed from the reported annual statements (${fy(ys[0].year)}–${fy(ys.at(-1).year)}); debt includes lease liabilities. Valuation multiples use the current market price.</div>`,
    ];
  }

  /* ═══════════════════════════ SHAREHOLDING ═══════════════════════════ */
  function paneShareholding(co) {
    const sh = S.pack && S.pack.shareholding, ins = S.pack && S.pack.insiders, o = co.ownership || {};
    const out = [];
    if (sh && sh.quarters.length) {
      const q = sh.quarters[0], qs = sh.quarters.slice(0, 12).reverse();
      const C = sh.detail && sh.detail.label === q.label ? sh.detail.categories : null;
      const split = C ? (() => {
        const pr = C.promoter ?? q.promoter, fpi = C.fpi || 0, dii = C.domesticInst || 0, ret = C.retail || 0;
        return [{ name: "Promoter & group", value: pr, color: PAL.c1 }, { name: "Foreign portfolio (FPI)", value: fpi, color: PAL.c2 }, { name: "Domestic institutions", value: dii, color: PAL.c3 }, { name: "Retail (individuals)", value: ret, color: PAL.c4 }, { name: "Other", value: Math.max(0, 100 - pr - fpi - dii - ret), color: "#6b7280" }];
      })() : [{ name: "Promoter & group", value: q.promoter, color: PAL.c1 }, { name: "Public", value: q.public, color: PAL.c2 }, ...(q.employeeTrusts ? [{ name: "Employee trusts", value: q.employeeTrusts, color: PAL.c4 }] : [])];
      const donut = chart({ kind: "donut", h: 180, center: n1(q.promoter, 1) + "%", centerSub: "promoter", label: "Shareholding pattern", fmt: (v) => n1(v, 2) + "%", items: split });
      const trend = chart({ kind: "lines", h: 180, cats: qs.map((x) => x.label.replace(" FY", "·")), pct: true, fmt: (v) => n1(v, 2) + "%", label: "Promoter holding by quarter", series: [{ name: "Promoter & group", color: PAL.c1, values: qs.map((x) => x.promoter) }] });
      const pl = sh.pledge;
      out.push(row([
        [panel(`SHAREHOLDING PATTERN · ${esc(q.label)}`, donut, { icon: "pie", sub: "as filed with NSE" }), 5],
        [panel("PROMOTER HOLDING TREND", trend + `<div class="rp-chips"><span class="rp-chip ${cls(sh.change.qoq)}">QoQ <b>${sgn(sh.change.qoq, 2, " pp")}</b></span><span class="rp-chip ${cls(sh.change.yoy)}">YoY <b>${sgn(sh.change.yoy, 2, " pp")}</b></span>${pl && !pl.none ? `<span class="rp-chip">Pledged <b>${n1(pl.pledgedPctOfPromoter, 2)}%</b> of promoter shares</span>` : pl && pl.none ? `<span class="rp-chip rp-up">No promoter pledge</span>` : ""}</div>${q.remarks ? `<details class="rp-det"><summary>Filing remarks</summary><p>${esc(q.remarks)}</p></details>` : ""}`, { icon: "chart", sub: `${qs.length} quarters` }), 7],
      ]));
    }
    const insT = ins ? panel("INSIDER TRANSACTIONS", `<div class="rp-chips"><span class="rp-chip">Last 12 months <b>${ins.last12m.count}</b></span>${ins.last12m.buyValue ? `<span class="rp-chip rp-up">Bought <b>${U(ins.last12m.buyValue)} ${UNIT}</b></span>` : ""}${ins.last12m.sellValue ? `<span class="rp-chip rp-down">Sold <b>${U(ins.last12m.sellValue)} ${UNIT}</b></span>` : ""}</div>
      ${ins.trades.length ? `<div class="table-wrap"><table class="dt ws-t"><tr><th>Date</th><th>Person</th><th>Category</th><th>Type</th><th>Shares</th><th>Value (${UNIT})</th></tr>${ins.trades.slice(0, 10).map((x) => `<tr><td>${fd(x.date)}</td><td class="nm">${esc(x.name)}</td><td class="ws-dim">${esc(x.category)}</td><td class="${/buy/i.test(x.type) ? "up" : /sell/i.test(x.type) ? "down" : ""}">${esc(x.type || x.mode)}</td><td>${x.shares != null ? x.shares.toLocaleString("en-IN") : "—"}</td><td>${U(x.value, 1)}</td></tr>`).join("")}</table></div>` : `<div class="ws-empty">No insider trades disclosed.</div>`}`, { icon: "users", sub: "SEBI PIT disclosures" }) : "";
    const fmtSh = (v) => (v == null ? "—" : v >= 1e7 ? n1(v / 1e7, 2) + " Cr" : v >= 1e5 ? n1(v / 1e5, 1) + " L" : v.toLocaleString("en-IN"));
    const inst = (o.topInstitutions || []).filter((i) => i.name), funds = (o.topFunds || []).filter((i) => i.name);
    const D = sh && sh.detail;
    const hold = D ? instFromFiling(D) : inst.length || funds.length || co.holders.institutions != null ? panel("INSTITUTIONAL HOLDERS", `<div class="rp-chips">${co.holders.institutions != null ? `<span class="rp-chip">Institutions <b>${n1(co.holders.institutions, 1)}%</b></span>` : ""}${co.holders.insiders != null ? `<span class="rp-chip">Insiders <b>${n1(co.holders.insiders, 1)}%</b></span>` : ""}${o.instCount ? `<span class="rp-chip"><b>${o.instCount}</b> holders listed</span>` : ""}</div>
      ${inst.length ? `<div class="table-wrap"><table class="dt ws-t"><tr><th>Institution</th><th>% held</th><th>Shares</th><th>Δ</th></tr>${inst.map((i) => `<tr><td class="nm">${esc(i.name)}</td><td>${i.pct == null ? "—" : n1(i.pct, 2) + "%"}</td><td>${fmtSh(i.shares)}</td><td class="${cls(i.change)}">${sgn(i.change)}</td></tr>`).join("")}</table></div>` : ""}
      ${funds.length ? `<div class="rp-sub">Top funds</div><div class="table-wrap"><table class="dt ws-t"><tr><th>Fund</th><th>% held</th></tr>${funds.map((i) => `<tr><td class="nm">${esc(i.name)}</td><td>${i.pct == null ? "—" : n1(i.pct, 2) + "%"}</td></tr>`).join("")}</table></div>` : ""}`, { icon: "users", sub: "data provider" }) : "";
    out.push(row([[hold, 6], [D && D.trend && D.trend.length > 1 ? instTrend(D) : "", 6]]));
    out.push(row([[insT, 12]]));
    const shpDown = ((S.pack && S.pack.unavailable) || []).includes("shareholding");
    if (!out.some(Boolean)) out.push(row([[panel("SHAREHOLDING", `<div class="ws-empty">${shpDown ? "The shareholding pattern couldn't be fetched from NSE just now." : "Ownership disclosure is not available for this issuer."}</div>`, { icon: "users" }), 12]]));
    return out;
  }

  /* institutional holders, straight from the shareholding-pattern filing */
  function instFromFiling(D) {
    const c = D.categories || {};
    const other = c.domesticInst != null ? Math.max(0, c.domesticInst - (c.mutualFunds || 0) - (c.insurance || 0) - (c.banks || 0) - (c.pension || 0) - (c.aif || 0)) : null;
    const cats = [["Foreign portfolio investors", c.fpi], ["Mutual funds", c.mutualFunds], ["Insurance companies", c.insurance], ["Pension &amp; provident funds", c.pension], ["Alternative investment funds", c.aif], ["Banks &amp; NBFCs", c.banks], ["Other domestic institutions", other]].filter((x) => x[1] != null && x[1] > 0.004);
    const tot = (c.fpi || 0) + (c.domesticInst || 0), mx = Math.max(...cats.map((x) => x[1]), 1);
    const catT = `<div class="table-wrap"><table class="dt ws-t ws-bt"><tr><th>Category</th><th>% of equity</th><th class="ws-bt-bar"></th></tr>${cats.map(([n, v]) => `<tr><td class="nm">${n}</td><td>${n1(v, 2)}%</td><td class="ws-bt-bar">${cellBar(v, mx, "tot")}</td></tr>`).join("")}
      <tr class="rp-tot"><td class="nm"><b>All institutions</b></td><td><b>${n1(tot, 2)}%</b></td><td class="ws-bt-bar"></td></tr></table></div>`;
    const hs = D.holders || [];
    const hT = hs.length ? `<div class="rp-sub">Named holders above 1% · ${esc(D.label)}</div><div class="table-wrap"><table class="dt ws-t"><tr><th>Holder</th><th>Type</th><th>% held</th></tr>${hs.map((h) => `<tr><td class="nm">${esc(h.name)}</td><td class="ws-dim">${esc(h.type)}</td><td>${n1(h.pct, 2)}%</td></tr>`).join("")}</table></div>`
      : `<div class="rp-note">No single non-promoter holder owns more than 1% (the disclosure threshold).</div>`;
    return panel("INSTITUTIONAL HOLDERS", `<div class="rp-sub">By category · ${esc(D.label)}</div>${catT}${hT}`, { icon: "users", sub: "shareholding pattern filed with NSE" });
  }
  function instTrend(D) {
    const t = D.trend, cats = t.map((x) => x.label.replace(" FY", "·"));
    const series = [["FPI", "fpi", PAL.c2], ["Domestic institutions", "domesticInst", PAL.c3], ["of which mutual funds", "mutualFunds", PAL.c4], ["Retail", "retail", PAL.c1]].filter(([, k]) => t.some((x) => x[k] != null));
    const ch = chart({ kind: "lines", h: (D.holders || []).length ? 330 : 230, cats, pct: true, fmt: (v) => n1(v, 2) + "%", label: "Institutional and retail holding by quarter", series: series.map(([n, k, c], i) => ({ name: n, color: c, dash: k === "mutualFunds", values: t.map((x) => x[k]) })) });
    const f = t[0], L = t.at(-1);
    const chg = series.map(([n, k]) => (f[k] != null && L[k] != null ? `<span class="rp-chip ${cls(L[k] - f[k])}">${n} <b>${sgn(L[k] - f[k], 2, " pp")}</b></span>` : "")).join("");
    return panel("WHO IS BUYING · QUARTERLY", ch + legend(series.map(([n, , c, ], i) => [n, c, n.startsWith("of which")])) + `<div class="rp-chips">${chg}</div><div class="rp-note">Change over ${t.length} quarters (${esc(f.label)} → ${esc(L.label)}), percentage points of equity.</div>`, { icon: "chart", sub: "% of equity · NSE filings" });
  }

  /* ═══════════════════════════ NEWS & EVENTS ═══════════════════════════ */
  function paneNews(co) {
    const p = S.pack, c = p && p.calendar, e = S.est, today = new Date().toISOString().slice(0, 10);
    const cal = [];
    if (e && e.next && e.next.date) cal.push({ date: e.next.date.slice(0, 10), text: `Quarterly results${e.next.isEstimate ? " (estimated date)" : ""}`, tag: "Results", next: true });
    if (c) {
      c.upcoming.forEach((x) => cal.push({ date: x.date, text: `${x.purpose} — board meeting`, tag: "Board", next: true }));
      if (c.lastResults) cal.push({ date: c.lastResults.date, text: "Results board meeting", tag: "Results" });
      c.actions.slice(0, 6).forEach((a) => cal.push({ date: a.exDate || a.recordDate, text: `${a.subject} — ex-date`, tag: "Corporate action", next: (a.exDate || a.recordDate) >= today }));
    }
    cal.sort((a, b) => (a.next === b.next ? (a.next ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)) : a.next ? -1 : 1));
    const calP = cal.length ? panel("CALENDAR", `<ul class="ws-upd">${cal.map((x) => `<li class="${x.next ? "next" : ""}"><span class="d">${fd(x.date)}</span><span class="t">${esc(x.text)}</span><em class="rp-tag">${esc(x.tag)}</em></li>`).join("")}</ul>`, { icon: "cal", sub: "upcoming first" }) : "";
    const news = p && p.news && p.news.length ? panel("IN THE NEWS", `<ul class="ws-upd">${p.news.map((n) => `<li><span class="d">${fd(n.date)}</span><span class="t">${link(n.url, esc(n.title))}</span><em class="rp-tag">${esc(n.publisher)}</em></li>`).join("")}</ul>`, { icon: "news", sub: "dated headlines" }) : "";
    if (!p) return [row([[panel("NEWS & EVENTS", `<div class="rp-skel"><i></i><i></i><i></i></div>`, { icon: "news", sub: "loading…" }), 12]])];
    return [row([[calP, 5], [news, 7]]) || row([[panel("NEWS & EVENTS", `<div class="ws-empty">No dated events or headlines found.</div>`, { icon: "news" }), 12]])];
  }

  /* ═══════════════════════════ FILINGS & TRANSCRIPTS ═══════════════════════════ */
  let filKind = "all";
  function filingsList() {
    const f = (S.pack && S.pack.filings) || [];
    const list = f.filter((x) => filKind === "all" || x.kind === filKind);
    return list.length ? `<ul class="ws-upd">${list.map((x) => `<li><span class="d">${fd(x.date)}</span><span class="t">${link(x.url, esc(x.text || x.category))}</span><em class="rp-tag">${esc(KIND[x.kind] || x.category)}</em></li>`).join("")}</ul>` : `<div class="ws-empty">No filings in this category over the last 12 months.</div>`;
  }
  function paneFilings(co) {
    const p = S.pack;
    if (!p) return [row([[panel("EXCHANGE FILINGS", `<div class="rp-skel"><i></i><i></i><i></i></div>`, { icon: "doc", sub: "loading…" }), 12]])];
    const f = p.filings || [];
    const kinds = ["all", ...new Set(f.map((x) => x.kind))];
    const filP = f.length ? panel("MATERIAL EXCHANGE FILINGS", `<div id="wsFilList">${filingsList()}</div>`, { icon: "doc", tools: `<div class="mc-tf" id="wsFilKinds">${kinds.map((k) => `<button class="mc-tfb${k === filKind ? " on" : ""}" type="button" data-fk="${k}">${k === "all" ? "All" : KIND[k] || k}</button>`).join("")}</div>` }) : "";
    const q = p.quarterly && p.quarterly.quarters;
    const calls = f.filter((x) => x.kind === "call");
    const res = (q && q.length) || calls.length ? panel("RESULTS &amp; TRANSCRIPTS", `${q && q.length ? `<div class="rp-sub">Results filed with the exchange</div><ul class="ws-upd">${q.map((x) => `<li><span class="d">${fd(x.filed)}</span><span class="t">${esc(x.label)} results · ${x.audited ? "audited" : "unaudited"}</span><em class="rp-tag">${x.xbrl ? link(x.xbrl, "XBRL") : "XBRL"}</em></li>`).join("")}</ul>` : ""}
      ${calls.length ? `<div class="rp-sub">Earnings-call transcripts</div><ul class="ws-upd">${calls.map((x) => `<li><span class="d">${fd(x.date)}</span><span class="t">${link(x.url, "Call transcript")}</span><button class="ws-xref" type="button" data-ws-transcript>Analyse ↗</button></li>`).join("")}</ul>` : ""}`, { icon: "cal", sub: "structured data · transcripts" }) : "";
    return [row([[filP, 7], [res, 5]]), { static: true, html: row([[`<div class="panel ws-p" id="rpDeep" hidden></div>`, 12]]) }];
  }

  /* ═══════════════════════════ document reader (Layer 2) ═══════════════════════════ */
  const liveTok = (tok) => S.tok === tok && typeof CURRENT !== "undefined" && CURRENT && S.co && CURRENT.symbol === S.co.symbol;
  function deepHtml(v, countdown) {
    const head = (sub) => `<div class="panel-h"><h3>${ic("doc")}MANAGEMENT COMMENTARY, GUIDANCE &amp; DEALS</h3><div class="ws-tools"><span class="panel-sub mono">${sub}</span></div></div>`;
    if (!v || v.status === "off") return "";
    if (v.status === "idle" || v.status === "failed") return `${head("read from the company's own filings")}<div class="ws-body"><div class="ws-cta"><p>Read the latest results filing, call transcript and transaction filings for management commentary, guidance and deals.</p><button class="mini-btn" type="button" id="wsDeepGo">Read filings</button></div></div>`;
    if (v.status === "running") return `${head("reading company documents…")}<div class="ws-body"><div class="rp-deep-run"><span class="rg-spin"></span><span>${esc(v.stage || "Reading documents")}</span><span class="ws-dim">${v.elapsed != null ? v.elapsed + "s" : ""}</span></div><div class="rp-skel"><i></i><i></i><i></i></div></div>`;
    const col = (title, list, empty) => `<div><div class="rp-sub">${title}</div>${list.length ? `<ul class="rp-claims">${list.map((e) => `<li><span>${esc(String(e.claim || "").replace(/\s*\[(?:[DE]\s?)?\d+(?:\.\d+)*\]/g, ""))}</span><span class="ws-dim"> — ${link(e.url, esc(String(e.source || "").replace(/^.* — /, "")))}, ${fd(e.date)}</span></li>`).join("")}</ul>` : `<div class="rp-note">${empty}</div>`}</div>`;
    const it = v.items || {};
    return `${head(`read from exchange filings${v.readAt ? " · " + fd(String(v.readAt).slice(0, 10)) : ""}`)}<div class="ws-body"><div class="ws-three">
      ${col("Management commentary &amp; guidance", it.management || [], "No call transcript or presentation filed in the last year.")}
      ${col("Latest results — beyond the numbers", it.results || [], "No results document was available to read.")}
      ${col("Transactions &amp; developments", it.developments || [], "No acquisition, merger or restructuring filings in the last year.")}
      </div><div class="rp-src">Each line is taken from the linked exchange filing. These readings are shared with report generation.</div></div>`;
  }
  async function deep(tok) {
    const co = S.co, url = `/api/company/${encodeURIComponent(co.symbol)}/deep`;
    let v; try { v = await api(url); } catch { v = { status: "off" }; }
    if (!liveTok(tok)) return;
    S.deepView = v;
    const paint = (x, c) => { S.deepView = x; S.deepCount = c; const el = document.getElementById("rpDeep"); if (!el) return; el.innerHTML = deepHtml(x, c); el.hidden = !el.innerHTML; const b = document.getElementById("wsDeepGo"); if (b) b.onclick = () => start(); };
    let polling = false;
    const poll = async () => { if (polling) return; polling = true; while (liveTok(tok)) { await new Promise((r) => setTimeout(r, 4000)); if (!liveTok(tok)) return; try { v = await api(url); } catch { continue; } paint(v); if (v.status !== "running") return; } };
    const start = async () => { if (!liveTok(tok)) return; paint({ status: "running", stage: "Starting" }); try { v = await api(url, { method: "POST" }); } catch { v = { status: "failed" }; } if (!liveTok(tok)) return; paint(v); if (v.status === "running") poll(); };
    S.deepStart = start;
    if (v.status === "running") { paint(v); poll(); return; }
    // reading spends model quota, so it never starts on its own — only on a click
    paint(v);
  }

  /* ═══════════════════════════ build · tabs · refresh ═══════════════════════════ */
  const PANES = { overview: paneOverview, thesis: paneThesis, financials: paneFinancials, estimates: paneEstimates, peers: panePeers, segments: paneSegments, ratios: paneRatios, shareholding: paneShareholding, news: paneNews, filings: paneFilings };
  /* NSE sometimes refuses requests for a while; say so instead of implying the company
     has no such disclosure (the pack lists the sections it couldn't fetch) */
  const NSE_DEPS = { overview: ["shareholding", "quarterly"], financials: ["quarterly"], segments: ["quarterly"], shareholding: ["shareholding", "insiders"], news: ["calendar"], filings: ["filings"] };
  const NSE_LABEL = { quarterly: "quarterly results", shareholding: "shareholding pattern", insiders: "insider trades", calendar: "corporate calendar", filings: "exchange filings" };
  function nseNote(name) {
    const miss = ((S.pack && S.pack.unavailable) || []).filter((k) => (NSE_DEPS[name] || []).includes(k));
    if (!miss.length) return null;
    const what = miss.map((k) => NSE_LABEL[k] || k).join(" and ");
    return { html: `<div class="ws-foot" data-nse-note><span class="ws-nse-dot"></span>NSE didn't return the ${esc(what)} just now — the exchange limits automated requests at times. ${S.packRetried ? "Still unavailable; reopen the company in a few minutes." : "Retrying automatically in about two minutes…"}</div>` };
  }
  const paneRows = (name) => [nseNote(name), ...PANES[name](S.co)].filter(Boolean).map((r) => (typeof r === "string" ? { html: r } : r)).filter((r) => r.html);
  const gridOf = (r) => (/^<div class="ws-(related|foot)"/.test(r.html) ? `<div class="ws-grid ws-grid-note">${r.html}</div>` : `<div class="ws-grid">${r.html}</div>`);
  function build(name) {
    const el = document.querySelector(`.ws-pane[data-pane="${name}"]`);
    if (!el) return;
    el.innerHTML = paneRows(name).map(gridOf).join("");
    S.built.add(name);
    after(name, el, true);
  }
  /* data arrived: re-render the non-static rows in place (keeps the price chart,
     the statement tabs, the peer editor and the document reader untouched) */
  function update(name) {
    const el = document.querySelector(`.ws-pane[data-pane="${name}"]`);
    if (!el) return;
    const rows = paneRows(name), grids = [...el.children];
    if (!rows.some((r) => r.static) || rows.length !== grids.length) return build(name);
    rows.forEach((r, i) => { if (!r.static) grids[i].innerHTML = r.html; });
    after(name, el, false);
  }
  function after(name, el, first) {
    if (first && name === "overview" && typeof mountPriceChart === "function" && document.getElementById("wsPriceChart")) mountPriceChart({ containerId: "wsPriceChart", symbol: S.co.symbol, defaultRange: "1Y", compact: true, height: 250, liveRefresh: true });
    if (name === "financials") { /* statement tabs are delegated by ersWireEvents */ }
    if (first && name === "peers") {
      renderPeerTools(S.co.symbol);
      const ph = window.__peerHtml;
      if (ph && ph.sym === S.co.symbol) { const pb = document.getElementById("peerBlock"); if (pb) pb.innerHTML = ph.html; repaintPeers(); }
      else loadPeers(S.co.symbol).then(() => repaintPeers());
    }
    if (first && name === "filings" && S.deepView) { const d = document.getElementById("rpDeep"); if (d) { d.innerHTML = deepHtml(S.deepView, S.deepCount); d.hidden = !d.innerHTML; const b = document.getElementById("wsDeepGo"); if (b) b.onclick = () => S.deepStart && S.deepStart(); } }
    if (el.offsetParent !== null) drawCharts(el);
  }
  function repaintPeers() { const r = document.getElementById("wsRel"); if (r) r.innerHTML = relChart(); }
  /* data arrived → rebuild the panes that use it (only those already built) */
  /* valuation lens on the research basis — market by default, the Modeling Lab DCF
     only when the user switched it on for this company (DCFUSE, terminal-modules.js) */
  function loadLens(symbol, tok) {
    const url = `/api/company/${encodeURIComponent(symbol)}/valuation-lens`;
    const get = typeof DCFUSE !== "undefined" ? DCFUSE.fetch(url, symbol) : api(url);
    get.then((l) => { if (S.tok !== tok) return; S.lens = l; refresh(["overview", "thesis"]); }).catch(() => { if (S.tok === tok) { S.lens = {}; refresh(["thesis"]); } });
  }
  const relens = (e, needLab) => {
    if (!S.co || !e.detail || e.detail.symbol !== S.co.symbol) return;
    if (needLab && !(typeof DCFUSE !== "undefined" && DCFUSE.on(S.co.symbol))) return;
    loadLens(S.co.symbol, S.tok);
  };
  document.addEventListener("mt:dcf-basis", (e) => relens(e, false));
  document.addEventListener("mt:valuation-model", (e) => relens(e, true));
  function refresh(names) { names.forEach((n) => { if (S.built.has(n)) update(n); }); const o = document.getElementById("wsOwnTgt"); if (o) o.innerHTML = ownTarget(); syncTabs(); }
  function syncTabs() {
    const est = document.querySelector('.ws-tab[data-ws="estimates"]');
    if (est) est.hidden = !!S.est && !estAvailable();
  }
  function show(name) {
    if (!PANES[name]) name = "overview";
    if (name === "estimates" && S.est && !estAvailable()) name = "overview";
    S.tab = name;
    try { sessionStorage.setItem("ws_tab", name); } catch { }
    document.querySelectorAll(".ws-tab").forEach((b) => { const on = b.dataset.ws === name; b.classList.toggle("on", on); b.setAttribute("aria-selected", on ? "true" : "false"); });
    document.querySelectorAll(".ws-pane").forEach((p) => (p.hidden = p.dataset.pane !== name));
    if (!S.built.has(name)) build(name); else drawCharts(document.querySelector(`.ws-pane[data-pane="${name}"]`));
  }

  function wire(body, co) {
    wireTips(body);
    if (body.__wsWired) return; body.__wsWired = true;
    body.addEventListener("click", (e) => {
      const t = e.target.closest("[data-ws]"); if (t && t.classList.contains("ws-tab")) { show(t.dataset.ws); return; }
      const g = e.target.closest("[data-ws-go]"); if (g) { show(g.dataset.wsGo); body.scrollIntoView({ block: "start" }); return; }
      const tg = e.target.closest("[data-ws-tab-go]"); if (tg) { showTab(tg.dataset.wsTabGo); return; }
      if (e.target.closest("[data-ws-report]") || e.target.closest("#wsReportBtn")) { showTab("reports"); const i = document.getElementById("reportSymbol"); if (i) i.value = S.co.symbol; return; }
      if (e.target.closest("[data-ws-transcript]")) { showTab("earnings"); const i = document.getElementById("ecSym"); if (i) i.value = S.co.symbol; if (TABS.earnings && TABS.earnings.loadNseTranscript) TABS.earnings.loadNseTranscript(); return; }
      const rk = e.target.closest("[data-rel]"); if (rk) { relKey = rk.dataset.rel; document.querySelectorAll("#wsRelKeys .mc-tfb").forEach((b) => b.classList.toggle("on", b === rk)); repaintPeers(); return; }
      const fk = e.target.closest("[data-fk]"); if (fk) { filKind = fk.dataset.fk; document.querySelectorAll("#wsFilKinds .mc-tfb").forEach((b) => b.classList.toggle("on", b === fk)); const l = document.getElementById("wsFilList"); if (l) l.innerHTML = filingsList(); return; }
      if (e.target.closest("#wsPeerQGo")) {
        const box = document.getElementById("wsPeerQ"); if (!box) return;
        box.innerHTML = `<div class="rp-deep-run"><span class="rg-spin"></span><span>Reading peers' exchange filings…</span></div>`;
        const tok = S.tok;
        api(`/api/company/${encodeURIComponent(S.co.symbol)}/peer-quarters${S.peerQ ? "?retry=1" : ""}`).then((d) => { if (S.tok !== tok) return; S.peerQ = d; const b2 = document.getElementById("wsPeerQ"); if (b2) b2.innerHTML = peerQTable(d); })
          .catch(() => { const b2 = document.getElementById("wsPeerQ"); if (b2) b2.innerHTML = `<div class="ws-cta"><p>The exchange did not return the peers' filings this time (NSE throttles bursts of requests).</p><button class="mini-btn" type="button" id="wsPeerQGo">Try again</button></div>`; });
      }
    });
    let rt = null;
    window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { const p = document.querySelector(`.ws-pane[data-pane="${S.tab}"]`); if (p && !p.hidden) drawCharts(p); }, 150); });
  }

  /* entry point — called by loadCompany() */
  function render(co) {
    const tok = (S.tok = {});
    Object.assign(S, { co, pack: null, lens: null, est: null, seg: null, peerQ: null, deepView: null, deepCount: null, built: new Set() });
    CH.clear();
    setUnits(co);
    const body = document.getElementById("researchBody");
    let tab = "overview"; try { tab = sessionStorage.getItem("ws_tab") || "overview"; } catch { }
    body.innerHTML = header(co)
      + `<nav class="ws-tabs" role="tablist">${TABS_DEF.map(([k, l]) => `<button class="ws-tab" type="button" role="tab" data-ws="${k}">${l}</button>`).join("")}</nav>`
      + `<div class="ws-panes">${TABS_DEF.map(([k]) => `<section class="ws-pane" data-pane="${k}" hidden></section>`).join("")}</div>`;
    wire(body, co);
    ersWireEvents();
    const w = document.getElementById("wsWatchBtn");
    if (w && typeof WATCH !== "undefined") { w.addEventListener("click", () => WATCH.toggle(co.symbol, co.name)); WATCH.syncStar(); }
    const x = document.getElementById("wsWorkbookBtn");
    if (x) x.addEventListener("click", () => { x.textContent = "⬇ Building…"; x.disabled = true; const a = document.createElement("a"); a.href = `/api/company/${encodeURIComponent(co.symbol)}/workbook`; a.download = ""; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => { x.textContent = "⬇ Workbook"; x.disabled = false; }, 6000); });
    show(tab);
    // data — all in parallel; each arrival rebuilds only the panes that use it
    const sym = encodeURIComponent(co.symbol);
    // exchange data: when NSE refused some sections, retry once after the server's short
    // retry window (the refusals are bursty and usually clear within a minute or two)
    const PACK_PANES = ["overview", "financials", "segments", "shareholding", "news", "filings"];
    const loadPack = (retry) => api(`/api/company/${sym}/pack`).then((p) => {
      if (S.tok !== tok) return;
      S.pack = p; S.packRetried = retry;
      refresh(PACK_PANES);
      if (!retry && p && Array.isArray(p.unavailable) && p.unavailable.length) setTimeout(() => { if (S.tok === tok) loadPack(true); }, 100_000);
    }).catch(() => { if (S.tok !== tok) return; if (!retry) S.pack = {}; refresh(PACK_PANES); });
    loadPack(false);
    loadLens(co.symbol, tok);
    api(`/api/earnings/summary/${sym}`).then((e) => { if (S.tok !== tok) return; S.est = e || { available: false }; refresh(["estimates", "news"]); }).catch(() => { if (S.tok === tok) { S.est = { available: false }; refresh(["estimates"]); } });
    api(`/api/segments/${sym}`).then((s) => { if (S.tok !== tok) return; S.seg = s; if (s && s.available) refresh(["overview", "segments"]); }).catch(() => { });
    loadPeers(co.symbol).then(() => { if (S.tok === tok) repaintPeers(); });
    deep(tok);
  }

  // shared with the report renderer so both show identical year-wise ratios
  return {
    render, show, yearRatios, spark, ratioFmt, RATIO_GROUPS, get state() { return S; },
    // the workstation's building blocks, shared by the Earnings Call page so both look identical
    kit: { panel, row, chart, drawCharts, wireTips, legend, spark, ic, PAL },
  };
})();
