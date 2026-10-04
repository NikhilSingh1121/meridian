/* ════════════════════════════════════════════════════════════════════════════
   LIVE SCANNER · TOP 5 NOW — live leaderboards across every dimension
   Ranks the whole scanner universe once a second from the SSE rows:
     composite leaders / laggards (percentile blend of six factors, shown per stock),
     price, value traded, relative volume, momentum, VWAP, relative strength,
     breakouts / breakdowns, opening range, gaps, squeezes, signal scores,
     sectors.
   Every board states its basis (what is measured and how), and every pick lists the
   factors behind it. Charts: sector performance, breadth, % change vs relative volume,
   distribution of moves. It describes what is moving, not what to buy.
   ════════════════════════════════════════════════════════════════════════════ */
var LSC_TOP5 = (() => {
  const S = { el: null, timer: 0, last: 0, fnoOnly: false, minValCr: 0, paused: false };
  const E = (s) => (typeof esc === "function" ? esc(s) : String(s == null ? "" : s));
  const N = (v, dp = 2) => (v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp }));
  const P = (v, dp = 2) => (v == null || !Number.isFinite(v) ? "—" : (v > 0 ? "+" : "") + v.toFixed(dp) + "%");
  const X = (v) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(2) + "×");
  const cls = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");
  const valCr = (r) => (r.vol > 0 ? ((r.vwap || r.ltp) * r.vol) / 1e7 : null);
  const hms = (ts) => new Date(ts + 5.5 * 3600e3).toISOString().slice(11, 19);
  const chip = (t, c) => `<span class="t5-f ${c || ""}">${t}</span>`;

  /* factors shown under a pick: the evidence, whatever board it is on */
  function factors(r) {
    const f = [];
    if (r.rvol != null && r.rvol >= 1.5) f.push(chip(`RVOL ${r.rvol.toFixed(1)}×`, "amb"));
    if (r.vwapD != null && Math.abs(r.vwapD) >= 0.4) f.push(chip(`${r.vwapD > 0 ? "+" : ""}${r.vwapD.toFixed(1)}% vs VWAP`, cls(r.vwapD)));
    if (r.m15 != null && Math.abs(r.m15) >= 0.5) f.push(chip(`15m ${P(r.m15, 1)}`, cls(r.m15)));
    if (r.orb) f.push(chip(`ORB ${r.orb > 0 ? "▲" : "▼"}`, cls(r.orb)));
    if (r.brk52) f.push(chip(`52W ${r.brk52 > 0 ? "high" : "low"}`, cls(r.brk52))); else if (r.brkN) f.push(chip(`20D ${r.brkN > 0 ? "high" : "low"}`, cls(r.brkN)));
    if (r.gap != null && Math.abs(r.gap) >= 1) f.push(chip(`gap ${P(r.gap, 1)}`, cls(r.gap)));
    if (r.sqzFire) f.push(chip(`squeeze ✦${r.sqzFire > 0 ? "▲" : "▼"}`, cls(r.sqzFire))); else if (r.sqz && r.sqzBars >= 10) f.push(chip(`coiling ${r.sqzBars}`, "amb"));
    if (r.rsS != null && Math.abs(r.rsS) >= 1) f.push(chip(`${r.rsS > 0 ? "+" : ""}${r.rsS.toFixed(1)} vs sector`, cls(r.rsS)));
    if (r.oiCls) f.push(chip(r.oiCls, /Long build|Short cover/.test(r.oiCls) ? "up" : "down"));
    return f.slice(0, 5).join("");
  }

  /* ── boards: [id, title, basis, filter, value (sort key), display, direction] ── */
  const BOARDS = [
    ["gain", "Top gainers", "Largest % change vs previous close.", () => true, (r) => r.pct, (r) => P(r.pct), -1],
    ["lose", "Top losers", "Largest % fall vs previous close.", () => true, (r) => r.pct, (r) => P(r.pct), 1],
    ["value", "Most traded (value)", "Turnover today ≈ volume × VWAP, in ₹ crore: where the money is.", (r) => valCr(r) != null, valCr, (r) => "₹" + N(valCr(r), 0) + " Cr", -1],
    ["rvol", "Unusual volume", "Relative volume: today's cumulative volume ÷ the average at this minute over recent sessions.", (r) => r.rvol != null, (r) => r.rvol, (r) => X(r.rvol), -1],
    ["mom", "Momentum up · 15 min", "Price change over the last 15 one-minute bars.", (r) => r.m15 != null, (r) => r.m15, (r) => P(r.m15), -1],
    ["momd", "Momentum down · 15 min", "Steepest fall over the last 15 one-minute bars.", (r) => r.m15 != null, (r) => r.m15, (r) => P(r.m15), 1],
    ["rs", "Strongest vs NIFTY", "Relative strength: stock % change minus NIFTY % change (percentage points).", (r) => r.rsN != null, (r) => r.rsN, (r) => (r.rsN > 0 ? "+" : "") + N(r.rsN) + " pp", -1],
    ["rsw", "Weakest vs NIFTY", "Stock % change minus NIFTY % change, most negative.", (r) => r.rsN != null, (r) => r.rsN, (r) => N(r.rsN) + " pp", 1],
    ["vwap", "Holding above VWAP", "Furthest above the day's volume-weighted average price, with at least normal volume (RVOL ≥ 1).", (r) => r.vwapD != null && (r.rvol || 0) >= 1, (r) => r.vwapD, (r) => P(r.vwapD), -1],
    ["brk", "Breakouts with volume", "Above the 20-day or 52-week high, ranked by relative volume (52-week first).", (r) => r.brk52 > 0 || r.brkN > 0, (r) => (r.brk52 > 0 ? 100 : 0) + (r.rvol || 0), (r) => `${r.brk52 > 0 ? "52W" : "20D"} · ${X(r.rvol)}`, -1],
    ["brkd", "Breakdowns with volume", "Below the 20-day or 52-week low, ranked by relative volume.", (r) => r.brk52 < 0 || r.brkN < 0, (r) => (r.brk52 < 0 ? 100 : 0) + (r.rvol || 0), (r) => `${r.brk52 < 0 ? "52W" : "20D"} · ${X(r.rvol)}`, -1],
    ["orb", "Opening-range breakouts", "Above the first 15 minutes' high, ranked by % change.", (r) => r.orb > 0, (r) => r.pct, (r) => P(r.pct), -1],
    ["gap", "Gap-ups holding", "Opened ≥ 0.75% above yesterday's close and still above the open.", (r) => r.gap >= 0.75 && r.ltp >= (r.o || 0), (r) => r.gap, (r) => "gap " + P(r.gap, 1), -1],
    ["gapd", "Gap-downs staying weak", "Opened ≥ 0.75% below yesterday's close and still below the open.", (r) => r.gap <= -0.75 && r.ltp <= (r.o || Infinity), (r) => r.gap, (r) => "gap " + P(r.gap, 1), 1],
    ["sqz", "Squeeze setups", "Bollinger inside Keltner on 1-minute bars: releases first, then the longest coils.", (r) => r.sqzFire || r.sqz, (r) => (r.sqzFire ? 1000 : 0) + (r.sqzBars || 0), (r) => (r.sqzFire ? `released ${r.sqzFire > 0 ? "▲" : "▼"}` : `coiling ${r.sqzBars} bars`), -1],
    ["bull", "Bullish signal score", "The scanner's 0–100 score for rows with a bullish bias (breakouts, volume, VWAP, momentum, RS).", (r) => r.bias > 0 && r.score != null, (r) => r.score, (r) => String(r.score), -1],
    ["bear", "Bearish signal score", "The scanner's 0–100 score for rows with a bearish bias.", (r) => r.bias < 0 && r.score != null, (r) => r.score, (r) => String(r.score), -1],
    ["nh", "Most new intraday highs", "Count of new session highs printed today.", (r) => r.nh > 0, (r) => r.nh, (r) => r.nh + " highs", -1],
  ];

  /* composite: percentile rank of six factors across the universe → 0–100 */
  const CF = [["pct", "% change", 0.25], ["m15", "15-min momentum", 0.2], ["rvol", "relative volume", 0.2], ["vwapD", "vs VWAP", 0.15], ["rsS", "vs sector", 0.1], ["brk", "breakout", 0.1]];
  function composite(rows) {
    const val = (r, k) => (k === "brk" ? (r.brk52 || 0) * 2 + (r.brkN || 0) + (r.orb || 0) : k === "rvol" ? (r.rvol == null ? null : Math.log(Math.max(0.05, r.rvol)) * Math.sign((r.pct || 0) + 1e-9)) : r[k]);
    const ranks = {};
    for (const [k] of CF) {
      const arr = rows.map((r) => [r.s, val(r, k)]).filter(([, v]) => v != null && Number.isFinite(v)).sort((a, b) => a[1] - b[1]);
      const m = new Map(); arr.forEach(([s], i) => m.set(s, arr.length > 1 ? i / (arr.length - 1) : 0.5)); ranks[k] = m;
    }
    return rows.map((r) => {
      let sc = 0, w = 0; const parts = [];
      for (const [k, lab, wt] of CF) { const p = ranks[k].get(r.s); if (p == null) continue; sc += p * wt; w += wt; parts.push([lab, p]); }
      return { r, score: w ? Math.round((sc / w) * 100) : null, parts };
    }).filter((x) => x.score != null);
  }

  /* ── charts (inline SVG, terminal colours) ── */
  function sectorChart(m) {
    const sec = (m && m.sectors) || []; if (!sec.length) return `<div class="ws-dim ec-small">Sector data appears once prices stream.</div>`;
    const top = sec.slice(0, 8), bot = sec.slice(-4).filter((x) => !top.includes(x)), L = [...top, ...bot];
    const mx = Math.max(0.5, ...L.map((x) => Math.abs(x.pct)));
    return `<div class="t5-bars">${L.map((x) => `<div class="t5-bar"><span>${E(x.sec)} <small class="ws-dim">${x.n}</small></span><div class="t5-track"><i class="mid"></i><i class="${x.pct >= 0 ? "pos" : "neg"}" style="${x.pct >= 0 ? `left:50%;width:${(x.pct / mx) * 50}%` : `right:50%;width:${(-x.pct / mx) * 50}%`}"></i></div><b class="${cls(x.pct)}">${P(x.pct)}</b></div>`).join("")}</div>`;
  }
  function breadth(m, rows) {
    if (!m) return "";
    const tot = (m.adv + m.dec + m.unch) || 1, up2 = rows.filter((r) => r.pct >= 2).length, dn2 = rows.filter((r) => r.pct <= -2).length;
    const aboveVw = rows.filter((r) => r.vwapD > 0).length, withV = rows.filter((r) => r.vwapD != null).length || 1;
    return `<div class="t5-ad"><i class="a" style="width:${(m.adv / tot) * 100}%"></i><i class="u" style="width:${(m.unch / tot) * 100}%"></i><i class="d" style="width:${(m.dec / tot) * 100}%"></i></div>
      <div class="t5-kv"><div><span>Advancers / decliners</span><b><span class="up">${m.adv}</span> / <span class="down">${m.dec}</span> <small class="ws-dim">(${m.unch} flat)</small></b></div>
      <div><span>A/D ratio</span><b>${m.dec ? (m.adv / m.dec).toFixed(2) : "—"}</b></div>
      <div><span>Up ≥ 2% · down ≥ 2%</span><b><span class="up">${up2}</span> · <span class="down">${dn2}</span></b></div>
      <div><span>Above VWAP</span><b>${Math.round((aboveVw / withV) * 100)}%</b></div></div>`;
  }
  function scatter(rows, hi) {
    const pts = rows.filter((r) => r.pct != null && r.rvol != null && r.rvol > 0);
    if (pts.length < 5) return `<div class="ws-dim ec-small">Waiting for volume data.</div>`;
    const W = 560, H = 250, pl = 40, pr = 10, pt = 10, pb = 26;
    const xs = pts.map((r) => r.pct), mxx = Math.max(1, ...xs.map(Math.abs));
    const ly = (v) => Math.log10(Math.max(0.1, Math.min(20, v)));
    const y0 = ly(0.1), y1 = ly(20);
    const X0 = (v) => pl + ((v + mxx) / (2 * mxx)) * (W - pl - pr), Y0 = (v) => H - pb - ((ly(v) - y0) / (y1 - y0)) * (H - pt - pb);
    const set = new Map(hi.map((x, i) => [x.r.s, i + 1]));
    const grid = [0.25, 0.5, 1, 2, 5, 10].map((v) => `<line x1="${pl}" x2="${W - pr}" y1="${Y0(v)}" y2="${Y0(v)}" class="g"/><text x="${pl - 4}" y="${Y0(v) + 3}" text-anchor="end">${v}×</text>`).join("");
    const xt = [-mxx, -mxx / 2, 0, mxx / 2, mxx].map((v) => `<text x="${X0(v)}" y="${H - 8}" text-anchor="middle">${v > 0 ? "+" : ""}${v.toFixed(1)}%</text>`).join("");
    const dots = pts.map((r) => { const k = set.get(r.s); return `<circle cx="${X0(r.pct).toFixed(1)}" cy="${Y0(r.rvol).toFixed(1)}" r="${k ? 4.5 : 2.3}" class="${k ? "hi" : r.pct >= 0 ? "u" : "d"}" data-s="${E(r.s)}"><title>${E(r.s)} ${P(r.pct)} · RVOL ${X(r.rvol)}</title></circle>${k ? `<text x="${(X0(r.pct) + (X0(r.pct) > W - 90 ? -6 : 6)).toFixed(1)}" y="${(Y0(r.rvol) - 6 - (k - 1) * 3).toFixed(1)}" text-anchor="${X0(r.pct) > W - 90 ? "end" : "start"}" class="lbl">${k}·${E(r.s)}</text>` : ""}`; }).join("");
    return `<svg class="t5-sc" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${grid}<line x1="${X0(0)}" x2="${X0(0)}" y1="${pt}" y2="${H - pb}" class="z"/><line x1="${pl}" x2="${W - pr}" y1="${Y0(1)}" y2="${Y0(1)}" class="z"/>${xt}${dots}</svg>
      <div class="ec-foot">Each dot is a stock: % change (x) against relative volume (y, log scale). Top-right = rising on heavy volume; the five composite leaders are labelled. Click a dot to open it.</div>`;
  }
  function histogram(rows) {
    const B = [-5, -3, -2, -1, -0.5, 0, 0.5, 1, 2, 3, 5], lab = ["≤−5", "−5…−3", "−3…−2", "−2…−1", "−1…−.5", "−.5…0", "0….5", ".5…1", "1…2", "2…3", "3…5", "≥5"];
    const cnt = new Array(B.length + 1).fill(0);
    for (const r of rows) { if (r.pct == null) continue; let i = B.findIndex((b) => r.pct < b); if (i < 0) i = B.length; cnt[i]++; }
    const mx = Math.max(1, ...cnt);
    return `<div class="t5-hist">${cnt.map((c, i) => `<div class="t5-hb" title="${lab[i]}%: ${c}"><i class="${i < 6 ? "neg" : "pos"}" style="height:${(c / mx) * 100}%"></i><b>${c}</b><span>${lab[i]}</span></div>`).join("")}</div>`;
  }

  /* ── render ── */
  function card(title, basis, list, disp, id) {
    const rowsHtml = list.length ? list.map((r, i) => `<div class="t5-row" data-s="${E(r.s)}"><span class="t5-rk">${i + 1}</span><span class="t5-sym"><b>${E(r.s)}</b><small>${E(r.sec || "")}</small></span><span class="t5-sp">${LSC.spark(r.spark && r.spark.length ? [...r.spark, r.ltp] : [], 64, 18)}</span><span class="t5-v mono">${disp(r)}<small class="${cls(r.pct)}">${N(r.ltp)} ${P(r.pct)}</small></span><span class="t5-fs">${factors(r)}</span></div>`).join("")
      : `<div class="ws-dim ec-small t5-none">Nothing qualifies right now.</div>`;
    return `<div class="panel t5-card" data-b="${id}"><div class="panel-h"><h3>${E(title.toUpperCase())}</h3></div><div class="t5-basis">${E(basis)}</div>${rowsHtml}</div>`;
  }
  function render() {
    if (!S.el || S.el.hidden || S.el.closest("[hidden]")) return;
    if (typeof LSC === "undefined") return;
    const all = [...LSC.rows().values()].filter((r) => r.ltp > 0 && !String(r.s).startsWith("^") && !["NIFTY", "BANKNIFTY", "FINNIFTY", "INDIAVIX", "MIDCPNIFTY"].includes(r.s));
    const rows = all.filter((r) => (!S.fnoOnly || r.fno) && (!S.minValCr || (valCr(r) || 0) >= S.minValCr));
    const m = LSC.state.market, st = LSC.state.status;
    const comp = composite(rows).sort((a, b) => b.score - a.score);
    const lead = comp.slice(0, 5), lag = comp.slice(-5).reverse();
    const compCard = (title, list, basis) => `<div class="panel t5-card t5-comp"><div class="panel-h"><h3>${title}</h3></div><div class="t5-basis">${E(basis)}</div>${list.map((x, i) => `<div class="t5-row" data-s="${E(x.r.s)}"><span class="t5-rk">${i + 1}</span><span class="t5-sym"><b>${E(x.r.s)}</b><small>${E(x.r.sec || "")}</small></span><span class="t5-sp">${LSC.spark(x.r.spark && x.r.spark.length ? [...x.r.spark, x.r.ltp] : [], 64, 18)}</span><span class="t5-v mono">${x.score}<small class="${cls(x.r.pct)}">${N(x.r.ltp)} ${P(x.r.pct)}</small></span><span class="t5-parts">${x.parts.map(([lab, p]) => `<span title="${E(lab)}: percentile ${Math.round(p * 100)}"><em>${E(lab)}</em><i><u style="width:${Math.round(p * 100)}%;background:${p >= 0.5 ? "var(--up)" : "var(--down)"}"></u></i></span>`).join("")}</span></div>`).join("") || `<div class="ws-dim ec-small t5-none">Waiting for rows.</div>`}</div>`;
    const cards = BOARDS.map(([id, title, basis, f, v, disp, dir]) => {
      const list = rows.filter((r) => { try { return f(r) && v(r) != null && Number.isFinite(v(r)); } catch { return false; } }).sort((a, b) => (v(a) - v(b)) * dir).slice(0, 5);
      return card(title, basis, list, disp, id);
    }).join("");
    const secTop = (m && m.sectors || []).slice(0, 5);
    const html = `
      <div class="t5-head"><div><b>TOP 5 NOW</b> <span class="ws-dim">${rows.length} stocks ranked · as of ${hms(Date.now())} IST${st && st.market && !st.market.open ? ` · ${st.market.reason === "holiday" || st.market.reason === "weekend" ? "no trading session today" : "market closed"}: last session` : st && st.marketOpen === false ? " · market closed: last session" : ""}</span></div>
        <div class="t5-ctl"><label><input type="checkbox" id="t5Fno" ${S.fnoOnly ? "checked" : ""}> F&amp;O only</label><label>Min turnover <select id="t5Val">${[0, 10, 50, 100, 500].map((v) => `<option value="${v}" ${S.minValCr === v ? "selected" : ""}>${v ? "₹" + v + " Cr" : "any"}</option>`).join("")}</select></label><button class="mini-btn" id="t5Pause" type="button">${S.paused ? "▶ Resume" : "❚❚ Pause"}</button></div></div>
      <div class="t5-grid t5-top">${compCard("OVERALL LEADERS · COMPOSITE", lead, "Percentile blend across the universe: % change 25%, 15-min momentum 20%, relative volume (signed by direction) 20%, VWAP distance 15%, strength vs sector 10%, breakout / opening range 10%. Bars show each factor's percentile.")}${compCard("OVERALL LAGGARDS · COMPOSITE", lag, "The same blend, weakest first.")}
        <div class="panel t5-card"><div class="panel-h"><h3>% CHANGE VS RELATIVE VOLUME</h3></div>${scatter(rows, lead)}</div></div>
      <div class="t5-grid t5-charts"><div class="panel t5-card"><div class="panel-h"><h3>SECTORS · AVERAGE % CHANGE</h3></div>${sectorChart(m)}<div class="ec-foot">Equal-weighted average of the universe's stocks in each sector (count shown).${secTop.length ? ` Leading: ${secTop.map((x) => E(x.sec)).join(", ")}.` : ""}</div></div>
        <div class="panel t5-card"><div class="panel-h"><h3>BREADTH</h3></div>${breadth(m, rows)}<div class="lsc-note" style="margin-top:8px">Distribution of today's moves</div>${histogram(rows)}</div></div>
      <div class="t5-grid t5-boards">${cards}</div>
      <div class="lsc-note" style="margin:10px 0 18px">Recomputed every second from the live scanner rows (about 750 NSE stocks: the Nifty Total Market list plus F&amp;O stocks). Rankings describe what is moving and why; they are not recommendations. Relative volume needs a few sessions of minute history (shown as "approximate" in the drawer until then). Click any stock to open its detail drawer; press g there for the full-screen live pattern chart.</div>`;
    const y = S.el.scrollTop;
    S.el.innerHTML = html; S.el.scrollTop = y;
    S.last = Date.now();
  }
  function mountView(el) {
    S.el = el; el.classList.add("t5");
    el.addEventListener("click", (e) => {
      const r = e.target.closest("[data-s]"); if (r) { LSC.openDrawer(r.dataset.s); return; }
      if (e.target.closest("#t5Pause")) { S.paused = !S.paused; render(); }
    });
    el.addEventListener("change", (e) => { if (e.target.id === "t5Fno") S.fnoOnly = e.target.checked; if (e.target.id === "t5Val") S.minValCr = +e.target.value; render(); });
  }
  function show() {
    render(); clearInterval(S.timer);
    S.timer = setInterval(() => { if (!S.el || S.el.closest("[hidden]")) return; if (!S.paused && !document.hidden) render(); }, 1000);
  }
  return { mountView, show, render, composite, BOARDS, state: S };
})();
var LSC_VIEWS = window.LSC_VIEWS || []; LSC_VIEWS.push({ id: "top5", label: "Top 5 Now", mount: (el) => LSC_TOP5.mountView(el), show: () => LSC_TOP5.show() });
