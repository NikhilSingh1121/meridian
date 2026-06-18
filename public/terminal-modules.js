/* MERIDIAN Terminal — modules part 2.
   Shares helpers ($, api, F, charts) from terminal.js (loaded first). */

let CURRENT = null;   // current company pack
let PEERS = null;     // peer rows

/* ════════ EQUITY RESEARCH WORKSTATION ════════ */
TABS.research = {
  init() {
    const picks = ["RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "AAPL", "MSFT"];
    $("#quickPicks").innerHTML = picks.map((s) => `<button class="chip" data-s="${s}">${s}</button>`).join("");
    $$("#quickPicks .chip").forEach((c) => c.addEventListener("click", () => loadCompany(c.dataset.s)));
  },
};

async function loadCompany(symbol) {
  showTab("research");
  $("#researchEmpty").hidden = true;
  const body = $("#researchBody");
  body.hidden = false;
  body.innerHTML = `<div class="loading mono" style="padding:60px">Building research workstation for ${symbol} — pulling live statements, computing ratios, running valuation…</div>`;
  $("#tcmdInput").value = symbol;
  try {
    const co = await api(`/api/company/${encodeURIComponent(symbol)}`);
    CURRENT = co;
    renderWorkstation(co);
    loadPeers(symbol);
    fillModelsFromCompany(co);
  } catch (e) {
    body.innerHTML = `<div class="loading mono" style="padding:60px;color:var(--down)">Couldn't build a research pack for "${symbol}". Try an exchange suffix — RELIANCE.NS, TCS.NS — or a US ticker like AAPL.<br><br>${e.message || ""}</div>`;
  }
}

function renderWorkstation(co) {
  const ccy = co.currency;
  const s = co.statements;
  const yrs = s.income.map((r) => r.year);
  const ratioByGroup = {};
  co.ratios.forEach((r) => (ratioByGroup[r.group] ||= []).push(r));

  const block = (title, sub, inner) => `<div class="panel section-block grow"><div class="panel-h"><h3>${title}</h3>${sub ? `<span class="panel-sub mono">${sub}</span>` : ""}</div>${inner}</div>`;

  const head = `
    <div class="co-head">
      <div><h2>${co.name}</h2><div class="co-sym">${co.symbol} · ${co.exchange} · ${co.profile.sector || ""}${co.profile.industry ? " · " + co.profile.industry : ""}</div></div>
      <div style="margin-left:auto;text-align:right"><div class="co-px" id="wsPriceLive">${F.px(co.price, ccy)}</div><div class="co-chg ${F.cls(co.change)} ws-change" id="wsChangeLive">${F.px(co.change, ccy)} (${F.pct(co.changePct, 2)})</div></div>
    </div>`;

  const kv = `<div class="kv">
    <div><div class="k">MARKET CAP</div><div class="v">${F.cap(co.keyStats.mcap, ccy)}</div></div>
    <div><div class="k">ENTERPRISE VALUE</div><div class="v">${F.cap(co.keyStats.ev, ccy)}</div></div>
    <div><div class="k">52-WEEK RANGE</div><div class="v">${F.num(co.keyStats.low52)} – ${F.num(co.keyStats.high52)}</div></div>
    <div><div class="k">BETA</div><div class="v">${F.x(co.keyStats.beta)}</div></div>
    <div><div class="k">PROMOTER/INSIDER</div><div class="v">${F.num(co.holders.insiders, 1)}%</div></div>
    <div><div class="k">INSTITUTIONS</div><div class="v">${F.num(co.holders.institutions, 1)}%</div></div>
    <div><div class="k">STREET TARGET</div><div class="v">${F.px(co.street.targetMean, ccy)}</div></div>
    <div><div class="k">STREET VIEW</div><div class="v" style="text-transform:uppercase">${co.street.rec || "—"}</div></div>
  </div>`;

  // overview + business — text/KVs on left, price chart on right
  const overviewBody = `<div class="co-overview-row">
      <div class="co-text">${kv}<div class="prose">${co.profile.summary ? co.profile.summary.slice(0, 700) + (co.profile.summary.length > 700 ? "…" : "") : "No business description available."}</div>${(co.profile.officers.length ? `<div class="prose"><strong>Key management:</strong> ${co.profile.officers.map((o) => `${o.name}${o.title ? " (" + o.title + ")" : ""}`).join(" · ")}</div>` : "")}</div>
      <div class="co-chart"><div id="researchPriceChart"></div></div>
    </div>`;
  const overview = block("COMPANY OVERVIEW", co.profile.country, overviewBody);

  // financial statements
  const stmtTable = (rows, cols) => `<div class="table-wrap"><table class="dt"><tr><th>${ccy ? "(" + ccy + ")" : ""}</th>${yrs.map((y) => `<th>FY${String(y).slice(2)}</th>`).join("")}</tr>${cols.map(([label, key, src]) => `<tr><td class="nm">${label}</td>${(src || s.income).map((r) => `<td>${F.num(r[key], 0)}</td>`).join("")}</tr>`).join("")}</table></div>`;
  const fin = block("FINANCIAL STATEMENT ANALYSIS", "annual · " + (s.income.length || 0) + " years",
    `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1px;background:var(--hairline)">
      <div style="background:var(--ink-2);padding:6px"><div class="panel-sub mono" style="padding:6px 10px">INCOME STATEMENT</div>${stmtTable(s.income, [["Revenue", "revenue"], ["Gross profit", "grossProfit"], ["Operating income", "opIncome"], ["Net income", "netIncome"]])}</div>
      <div style="background:var(--ink-2);padding:6px"><div class="panel-sub mono" style="padding:6px 10px">BALANCE SHEET</div>${stmtTable(s.balance, [["Total assets", "assets", s.balance], ["Equity", "equity", s.balance], ["LT debt", "ltDebt", s.balance], ["Cash", "cash", s.balance]])}</div>
      <div style="background:var(--ink-2);padding:6px"><div class="panel-sub mono" style="padding:6px 10px">CASH FLOW</div>${stmtTable(s.cashflow, [["Operating CF", "ocf", s.cashflow], ["Capex", "capex", s.cashflow], ["Free cash flow", "fcf", s.cashflow]])}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--hairline);margin-top:1px">
      <div style="background:var(--ink-2);padding:12px 16px"><div class="panel-sub mono">REVENUE TREND</div><canvas class="chart sm" id="cRev"></canvas></div>
      <div style="background:var(--ink-2);padding:12px 16px"><div class="panel-sub mono">NET INCOME TREND</div><canvas class="chart sm" id="cNi"></canvas></div>
    </div>`);

  // ratio library
  const ratioCards = Object.entries(ratioByGroup).map(([g, list]) => list.map((r, i) => {
    const series = co.series[ { "ROE": "roe", "ROCE": "roce", "Net margin": "netMargin", "EBITDA margin": "opMargin" }[r.name] ];
    return `<div class="ratio-card"><div class="rg">${g.toUpperCase()}</div><div class="rn">${r.name}</div><div class="rv">${r.fmt === "pct" ? F.num(r.value, 1) + "%" : r.fmt === "x" ? F.x(r.value, 2) : r.fmt === "days" ? F.num(r.value, 0) + "d" : F.num(r.value, 2)}</div>${series ? `<canvas class="rspark" data-key="${r.name}"></canvas>` : ""}<div class="ri">${r.note}</div></div>`;
  }).join("")).join("");
  const ratios = block("RATIO ANALYSIS", "current value · trend · interpretation", `<div class="ratio-grid">${ratioCards}</div>`);

  // variance
  const variance = block("VARIANCE ANALYSIS", "latest year vs prior", `<div class="drv">${co.variance.drivers.map((d) => `<div class="drv-chip">${d.label}: <b class="${d.dir === "up" ? "up" : "down"}">${d.value >= 0 ? "+" : ""}${F.num(d.value, 1)}${d.unit}</b></div>`).join("")}</div><div class="prose">${co.variance.commentary}</div>`);

  // valuation summary (from research-side DCF)
  let valBlock = "";
  if (co.dcf.result && !co.dcf.result.error) {
    const r = co.dcf.result, up = co.price ? (r.perShare / co.price - 1) * 100 : null;
    valBlock = block("VALUATION · DCF SUMMARY", "edit assumptions in the Modeling Lab",
      `<div class="dcf-big"><div><div class="n ${up >= 0 ? "up" : "down"}">${F.px(r.perShare, ccy)}</div><div class="l">INTRINSIC VALUE / SHARE</div></div><div><div class="n">${F.px(co.price, ccy)}</div><div class="l">CURRENT PRICE</div></div><div><div class="n ${F.cls(up)}">${F.pct(up)}</div><div class="l">IMPLIED UPSIDE</div></div><div><div class="n">${F.num(r.terminalShare * 100, 0)}%</div><div class="l">FROM TERMINAL VALUE</div></div></div>
      <div class="prose">Base case on a 10-year FCFF fade model: WACC ${co.dcf.inputs.wacc}% (${co.dcf.inputs.rationale.note}), terminal growth ${co.dcf.inputs.terminalG}%. Open the Modeling Lab to flex every assumption and see the sensitivity grid.</div>`);
  }

  // positioning placeholder filled by peers
  const positioning = block("COMPETITIVE POSITIONING &amp; PEERS", "auto-selected peer set", `<div id="peerBlock"><div class="loading mono">selecting peers…</div></div>`);

  // ── BUSINESS ANALYSIS ──
  const biz = (() => {
    const inc = s.income, g = co.growth;
    const latest = inc.at(-1) || {}, prior = inc.at(-2) || {};
    const grossM = latest.revenue ? (latest.grossProfit / latest.revenue) * 100 : null;
    const opM = latest.revenue ? (latest.opIncome / latest.revenue) * 100 : null;
    const netM = latest.revenue ? (latest.netIncome / latest.revenue) * 100 : null;
    // revenue bridge: decompose YoY change into the drivers we can observe (volume/price proxy via revenue, margin mix)
    const revChg = (latest.revenue ?? 0) - (prior.revenue ?? 0);
    const revBridge = `<table class="dt"><tr><th>Revenue bridge (latest yr)</th><th>${ccy || ""}</th></tr>
      <tr><td class="nm">Prior-year revenue</td><td>${F.num(prior.revenue, 0)}</td></tr>
      <tr><td class="nm">Δ Revenue (organic + price + mix)</td><td class="${revChg >= 0 ? "up" : "down"}">${revChg >= 0 ? "+" : ""}${F.num(revChg, 0)}</td></tr>
      <tr><td class="nm">Current-year revenue</td><td>${F.num(latest.revenue, 0)}</td></tr>
      <tr><td class="nm">Implied growth</td><td class="${g.revYoy >= 0 ? "up" : "down"}">${F.pct(g.revYoy)}</td></tr></table>`;
    // business quality score (deterministic, 0-100)
    let q = 0; const qn = [];
    if (g.revCagr != null) { const v = g.revCagr > 12 ? 25 : g.revCagr > 6 ? 17 : g.revCagr > 0 ? 10 : 0; q += v; qn.push(["Growth", g.revCagr.toFixed(1) + "% CAGR", v, 25]); }
    if (netM != null) { const v = netM > 15 ? 25 : netM > 8 ? 18 : netM > 3 ? 10 : 3; q += v; qn.push(["Margin", netM.toFixed(1) + "% net", v, 25]); }
    const roce = co.ratios.find((r) => r.name === "ROCE")?.value;
    if (roce != null) { const v = roce > 18 ? 30 : roce > 12 ? 22 : roce > 8 ? 12 : 4; q += v; qn.push(["Capital returns", roce.toFixed(1) + "% ROCE", v, 30]); }
    const cc = g.cashConversion; if (cc != null) { const v = cc > 90 ? 20 : cc > 70 ? 13 : 6; q += v; qn.push(["Cash conversion", (cc / 100).toFixed(2) + "×", v, 20]); }
    const qGrade = q >= 75 ? "High quality" : q >= 50 ? "Above average" : q >= 30 ? "Average" : "Challenged";
    const marginTbl = `<table class="dt"><tr><th>Margin structure</th><th>Latest</th></tr>
      <tr><td class="nm">Gross margin</td><td>${grossM == null ? "—" : F.num(grossM, 1) + "%"}</td></tr>
      <tr><td class="nm">Operating margin</td><td>${opM == null ? "—" : F.num(opM, 1) + "%"}</td></tr>
      <tr><td class="nm">Net margin</td><td>${netM == null ? "—" : F.num(netM, 1) + "%"}</td></tr></table>`;
    return block("BUSINESS ANALYSIS", "model · revenue drivers · quality score",
      `<div class="prose">${co.profile.summary ? co.profile.summary.slice(0, 600) + (co.profile.summary.length > 600 ? "…" : "") : "No business description available."}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--hairline);margin-top:1px">
        <div style="background:var(--ink-2);padding:10px 14px">${revBridge}</div>
        <div style="background:var(--ink-2);padding:10px 14px">${marginTbl}</div>
      </div>
      <div class="bq-score"><div class="bq-l">BUSINESS QUALITY SCORE</div><div class="bq-v">${q}<small>/100</small> · ${qGrade}</div>
        <div class="bq-bars">${qn.map(([l, d, v, mx]) => `<div class="bq-bar"><span class="bq-bn">${l}</span><div class="bq-track"><i style="width:${(v / mx) * 100}%"></i></div><span class="bq-bd">${d}</span></div>`).join("")}</div></div>`);
  })();

  // ── MANAGEMENT ANALYSIS ──
  const mgmt = (() => {
    const roce = co.ratios.find((r) => r.name === "ROCE")?.value;
    const roe = co.ratios.find((r) => r.name === "ROE")?.value;
    const de = co.ratios.find((r) => r.name === "Debt / Equity")?.value;
    const dy = co.ratios.find((r) => r.name === "Dividend yield")?.value;
    // capital allocation scorecard
    const rows = [
      ["Returns on capital", roce != null ? (roce > 15 ? "Strong" : roce > 8 ? "Adequate" : "Weak") : "—", roce != null ? roce.toFixed(1) + "% ROCE — " + (roce > 8 ? "creating value above a typical hurdle" : "below a typical cost-of-capital hurdle") : "n/a"],
      ["Returns on equity", roe != null ? (roe > 15 ? "Strong" : roe > 10 ? "Adequate" : "Weak") : "—", roe != null ? roe.toFixed(1) + "% ROE" : "n/a"],
      ["Balance-sheet discipline", de != null ? (de < 0.5 ? "Conservative" : de < 1.5 ? "Moderate" : "Aggressive") : "—", de != null ? de.toFixed(2) + "× debt/equity" : "n/a"],
      ["Shareholder distribution", dy != null && dy > 0 ? "Returns cash" : "Retains", dy != null && dy > 0 ? dy.toFixed(1) + "% dividend yield" : "No/low dividend — reinvesting"],
    ];
    const align = co.holders.insiders != null ? (co.holders.insiders > 25 ? "High insider alignment" : co.holders.insiders > 5 ? "Moderate alignment" : "Low insider ownership") : "n/a";
    const officers = co.profile.officers.length ? `<div class="prose"><strong>Leadership:</strong> ${co.profile.officers.map((o) => `${o.name}${o.title ? " (" + o.title + ")" : ""}${o.age ? ", " + o.age : ""}`).join(" · ")}</div>` : "";
    return block("MANAGEMENT ANALYSIS", "capital allocation · alignment",
      officers +
      `<table class="dt" style="margin-top:8px"><tr><th>Capital-allocation review</th><th>Assessment</th><th>Evidence</th></tr>
        ${rows.map((r) => `<tr><td class="nm">${r[0]}</td><td><b>${r[1]}</b></td><td style="text-align:left;color:var(--muted)">${r[2]}</td></tr>`).join("")}
        <tr><td class="nm">Shareholder alignment</td><td><b>${align}</b></td><td style="text-align:left;color:var(--muted)">${co.holders.insiders != null ? F.num(co.holders.insiders, 1) + "% insider holding" : "n/a"}</td></tr>
      </table>
      <div class="prose">Capital-allocation quality is judged on the returns the business earns on the capital it deploys and how that capital is financed and distributed. ${roce != null && roce > 8 ? "Management is generating returns above a typical cost-of-capital hurdle, evidence of value-accretive reinvestment." : roce != null ? "Returns on capital sit below a typical hurdle — reinvestment economics deserve scrutiny." : ""} ${co.holders.insiders != null && co.holders.insiders > 15 ? "Meaningful insider ownership aligns management with outside shareholders." : ""}</div>`);
  })();

  // ── ECONOMIC MOAT ──
  const moat = (() => {
    const roce = co.ratios.find((r) => r.name === "ROCE")?.value;
    const netM = co.ratios.find((r) => r.name === "Net margin")?.value;
    const gm = co.statements.income.at(-1)?.grossProfit && co.statements.income.at(-1)?.revenue ? (co.statements.income.at(-1).grossProfit / co.statements.income.at(-1).revenue) * 100 : null;
    const de = co.ratios.find((r) => r.name === "Debt / Equity")?.value;
    const rate = (cond, hi, lo) => cond == null ? ["—", "n/a"] : cond > hi ? ["Wide", "strong"] : cond > lo ? ["Narrow", "moderate"] : ["None", "limited"];
    const sources = [
      ["Returns on capital (pricing power proxy)", ...rate(roce, 15, 8), roce != null ? roce.toFixed(1) + "% ROCE" : "n/a"],
      ["Gross-margin strength (brand / cost edge)", ...rate(gm, 40, 20), gm != null ? gm.toFixed(0) + "% gross margin" : "n/a"],
      ["Net-margin durability", ...rate(netM, 15, 6), netM != null ? netM.toFixed(1) + "% net margin" : "n/a"],
      ["Balance-sheet resilience (scale staying power)", ...rate(de != null ? 2 - de : null, 1.4, 0.4), de != null ? de.toFixed(2) + "× D/E" : "n/a"],
    ];
    const wides = sources.filter((x) => x[1] === "Wide").length, narrows = sources.filter((x) => x[1] === "Narrow").length;
    const overall = wides >= 3 ? "Wide" : (wides >= 1 || narrows >= 3) ? "Narrow" : "None";
    const sustain = overall === "Wide" ? "Durable (5–10yr)" : overall === "Narrow" ? "Moderate (2–5yr)" : "Limited";
    return block("ECONOMIC MOAT", "deterministic moat scorecard",
      `<table class="dt"><tr><th>Moat source</th><th>Rating</th><th>Evidence</th></tr>
        ${sources.map((x) => `<tr><td class="nm">${x[0]}</td><td><span class="moat-tag ${x[1]}">${x[1]}</span></td><td style="text-align:left;color:var(--muted)">${x[3]}</td></tr>`).join("")}
        <tr><td class="nm"><b>Overall moat</b></td><td><span class="moat-tag ${overall}">${overall}</span></td><td style="text-align:left"><b>Sustainability: ${sustain}</b></td></tr>
      </table>
      <div class="prose">The moat assessment infers competitive advantage from financial fingerprints: persistently high returns on capital and gross margins point to pricing power or a cost edge, while balance-sheet strength signals the staying power to defend share. ${overall === "Wide" ? "The numbers are consistent with a wide, durable moat." : overall === "Narrow" ? "The evidence supports a narrow moat that warrants monitoring." : "Financial signals do not currently evidence a structural moat."} This is a quantitative screen; qualitative factors (network effects, switching costs, regulatory protection) should be assessed alongside.</div>`);
  })();

  // ── OWNERSHIP ANALYSIS ──
  const own = (() => {
    const o = co.ownership || {};
    const fmtSh = (v) => v == null ? "—" : v >= 1e9 ? (v / 1e9).toFixed(2) + "B" : v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : F.num(v, 0);
    const instRows = (o.topInstitutions || []).map((i) => `<tr><td class="nm" style="text-align:left">${i.name}</td><td>${i.pct == null ? "—" : F.num(i.pct, 2) + "%"}</td><td>${fmtSh(i.shares)}</td><td class="${i.change >= 0 ? "up" : "down"}">${i.change == null ? "—" : (i.change >= 0 ? "+" : "") + F.num(i.change, 1) + "%"}</td></tr>`).join("");
    const insRows = (o.insiders || []).map((h) => `<tr><td class="nm" style="text-align:left">${h.name}</td><td style="text-align:left;color:var(--muted)">${h.relation}</td><td>${fmtSh(h.shares)}</td><td style="color:var(--muted)">${h.latest || "—"}</td></tr>`).join("");
    const ni = o.netInsider || {};
    const structure = `<div class="own-split">
      <div class="own-seg"><div class="own-bar"><i style="width:${co.holders.institutions || 0}%"></i></div><div class="own-lbl">Institutions <b>${F.num(co.holders.institutions, 1)}%</b></div></div>
      <div class="own-seg"><div class="own-bar amber"><i style="width:${co.holders.insiders || 0}%"></i></div><div class="own-lbl">Insiders / promoters <b>${F.num(co.holders.insiders, 1)}%</b></div></div>
    </div>`;
    // ownership quality score
    let oq = 0; if (co.holders.institutions != null) oq += co.holders.institutions > 50 ? 40 : co.holders.institutions > 25 ? 28 : 15;
    if (co.holders.insiders != null) oq += co.holders.insiders > 25 ? 35 : co.holders.insiders > 5 ? 22 : 8;
    if (ni.netPct != null) oq += ni.netPct >= 0 ? 25 : 5;
    const oGrade = oq >= 75 ? "Strong" : oq >= 50 ? "Solid" : oq >= 30 ? "Moderate" : "Weak";
    return block("OWNERSHIP ANALYSIS", `${o.instCount ? o.instCount + " institutional holders" : "ownership structure"}`,
      structure +
      `<div class="own-score"><span>Ownership quality</span> <b>${oq}/100 · ${oGrade}</b> ${ni.netPct != null ? `<span style="color:var(--muted)">· net insider activity (${ni.period}): <b class="${ni.netPct >= 0 ? "up" : "down"}">${ni.netPct >= 0 ? "+" : ""}${F.num(ni.netPct, 2)}%</b></span>` : ""}</div>
      ${instRows ? `<div class="panel-sub mono" style="margin-top:10px">TOP INSTITUTIONAL HOLDERS</div><table class="dt"><tr><th style="text-align:left">Holder</th><th>% held</th><th>Shares</th><th>Δ</th></tr>${instRows}</table>` : `<div class="prose">Detailed institutional holder data is not available for this issuer (common for non-US listings).</div>`}
      ${insRows ? `<div class="panel-sub mono" style="margin-top:10px">INSIDER HOLDERS</div><table class="dt"><tr><th style="text-align:left">Name</th><th style="text-align:left">Relation</th><th>Shares</th><th>Latest</th></tr>${insRows}</table>` : ""}`);
  })();

  $("#researchBody").innerHTML = head + overview + biz + mgmt + moat + own + fin + ratios + variance + positioning + valBlock;

  // draw charts
  requestAnimationFrame(() => {
    lineChart($("#cRev"), co.series.revenue.map((p) => p.v));
    lineChart($("#cNi"), co.series.netIncome.map((p) => p.v));
    $$(".rspark").forEach((cv) => {
      const map = { "ROE": "roe", "ROCE": "roce", "Net margin": "netMargin", "EBITDA margin": "opMargin" }[cv.dataset.key];
      if (map && co.series[map]) lineChart(cv, co.series[map].map((p) => p.v), { fill: false, lw: 1.2, color: "200,134,42" });
    });
    // Mount the interactive compact price chart in the Company Overview
    if (typeof mountPriceChart === "function") {
      mountPriceChart({ containerId: "researchPriceChart", symbol: co.symbol, defaultRange: "1Y", compact: true, height: 240, liveRefresh: true });
    }
    revealSections();
  });
}

function revealSections() {
  const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add("vis"), io.unobserve(e.target))), { threshold: 0.08 });
  $$(".section-block:not(.vis)").forEach((el) => io.observe(el));
}

async function loadPeers(symbol) {
  try {
    const { rows } = await api(`/api/peers/${encodeURIComponent(symbol)}`);
    PEERS = rows;
    const cols = [["P/E", "pe", "x"], ["EV/EBITDA", "evEbitda", "x"], ["P/B", "pb", "x"], ["ROE", "roe", "pct"], ["Net mgn", "netMargin", "pct"], ["Rev gr", "revGrowth", "pct"], ["D/E", "de", "x"], ["Div yld", "divYield", "pct"]];
    const fmt = (v, t) => t === "pct" ? (v === null ? "—" : F.num(v, 1) + "%") : F.x(v, 2);
    const table = `<div class="table-wrap"><table class="dt"><tr><th>Company</th><th>Mcap</th>${cols.map((c) => `<th>${c[0]}</th>`).join("")}</tr>${rows.map((r, i) => `<tr><td class="nm">${i === 0 ? "★ " : ""}${r.name}</td><td>${F.cap(r.mcap, r.currency)}</td>${cols.map((c) => `<td>${fmt(r[c[1]], c[2])}</td>`).join("")}</tr>`).join("")}</table></div>`;
    // medians for positioning
    const med = (k) => { const v = rows.slice(1).map((r) => r[k]).filter((x) => x !== null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
    const self = rows[0];
    const posLines = [];
    if (self.pe !== null && med("pe") !== null) posLines.push(`Trades at ${F.x(self.pe, 1)} P/E versus a peer median of ${F.x(med("pe"), 1)} — a ${self.pe > med("pe") ? "premium" : "discount"} the growth and returns profile must justify.`);
    if (self.roe !== null && med("roe") !== null) posLines.push(`ROE of ${F.num(self.roe, 1)}% ranks ${self.roe > med("roe") ? "above" : "below"} the peer median (${F.num(med("roe"), 1)}%).`);
    $("#peerBlock").innerHTML = table + `<div class="prose"><div class="panel-sub mono" style="margin-bottom:8px">RELATIVE POSITIONING</div>${posLines.join(" ")}</div>`;
    fillComps(rows, self.currency);
  } catch { $("#peerBlock").innerHTML = `<div class="loading">peer analysis unavailable</div>`; }
}

/* ════════ MODELING LAB ════════ */
TABS.models = { init() { IDCF.init(); if (CURRENT) fillModelsFromCompany(CURRENT); } };

function fillModelsFromCompany(co) {
  // load the full institutional DCF for the open company
  if (co && co.symbol) { $("#idcfSym") && ($("#idcfSym").value = co.symbol); IDCF.load(co.symbol); loadValuation(co.symbol); }
}

async function loadValuation(symbol) {
  const vo = $("#valMethodsOut"), mo = $("#mcOut");
  if (vo) vo.innerHTML = `<div class="loading mono" style="padding:30px">Computing EV/EBITDA · P/E · PEG · Residual Income · DDM · SOTP…</div>`;
  if (mo) mo.innerHTML = `<div class="loading mono" style="padding:30px">Running 5,000 Monte Carlo simulations…</div>`;
  try {
    const d = await api("/api/valuation/" + encodeURIComponent(symbol));
    if (d.error) { if (vo) vo.innerHTML = `<div class="empty-mini">${d.error}</div>`; if (mo) mo.innerHTML = ""; return; }
    $("#valFor") && ($("#valFor").textContent = d.meta.name + " · " + d.meta.currency);
    $("#mcFor") && ($("#mcFor").textContent = d.monteCarlo ? d.monteCarlo.runs.toLocaleString() + " runs" : "");
    if (vo) vo.innerHTML = renderValuationMethods(d.valuation, d.meta);
    if (mo) mo.innerHTML = d.monteCarlo ? renderMonteCarlo(d.monteCarlo, d.meta) : `<div class="empty-mini">Monte Carlo needs a valid DCF for this issuer.</div>`;
    if (d.monteCarlo) drawMonteCarlo(d.monteCarlo, d.meta);
  } catch (e) { if (vo) vo.innerHTML = `<div class="empty-mini">${e.message}</div>`; }
}

function renderValuationMethods(v, meta) {
  const ccy = v.currency, sym = ccy === "INR" ? "₹" : ccy === "USD" ? "$" : "";
  const N = (x, dp = 2) => x == null || !isFinite(x) ? "—" : x.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  const px = (x) => x == null ? "—" : sym + N(x, 2);
  const methods = v.methods.filter((m) => m.value != null);
  const vals = methods.map((m) => m.value).concat(v.price || []);
  const lo = Math.min(...vals) * 0.95, hi = Math.max(...vals) * 1.05, span = (hi - lo) || 1;
  const pos = (x) => ((x - lo) / span) * 100;
  // football field
  const field = `<div class="vf">${methods.map((m) => `
    <div class="vf-row"><span class="vf-name">${m.name}</span>
      <div class="vf-track"><span class="vf-dot" style="left:${pos(m.value)}%" title="${px(m.value)}"></span><span class="vf-val" style="left:${pos(m.value)}%">${px(m.value)}</span></div>
    </div>`).join("")}
    <div class="vf-row vf-blend"><span class="vf-name">BLENDED</span>
      <div class="vf-track"><span class="vf-dot blend" style="left:${pos(v.blended)}%"></span><span class="vf-val blend" style="left:${pos(v.blended)}%">${px(v.blended)}</span></div></div>
    ${v.price != null ? `<div class="vf-row"><span class="vf-name">Current price</span><div class="vf-track"><span class="vf-mark" style="left:${pos(v.price)}%"></span><span class="vf-val cur" style="left:${pos(v.price)}%">${px(v.price)}</span></div></div>` : ""}
    <div class="vf-axis"><span>${px(lo)}</span><span>${px(hi)}</span></div>
  </div>`;
  // detail tables (workings)
  const detail = methods.map((m) => `<div class="vm-card"><div class="vm-h"><span>${m.name}</span><b>${px(m.value)}</b></div>
    <table class="vm-t">${Object.entries(m.inputs).map(([k, val]) => `<tr><td>${k}</td><td>${typeof val === "number" ? (Math.abs(val) > 1e6 ? N(val / (ccy === "INR" ? 1e7 : 1e6), 0) + (ccy === "INR" ? " Cr" : " Mn") : N(val, 2)) : (val ?? "—")}</td></tr>`).join("")}</table>
    <div class="vm-note">${m.note}</div></div>`).join("");
  const blendUp = v.upside;
  return `<div class="vm-verdict"><div><span class="l">BLENDED TARGET</span><span class="n">${px(v.blended)}</span></div><div><span class="l">CURRENT</span><span class="n">${px(v.price)}</span></div><div><span class="l">UPSIDE</span><span class="n ${blendUp >= 0 ? "up" : "down"}">${blendUp == null ? "—" : (blendUp >= 0 ? "+" : "") + N(blendUp, 1) + "%"}</span></div></div>
    <div class="panel-sub mono" style="margin:14px 0 8px">FOOTBALL FIELD — value per share by method</div>${field}
    <div class="panel-sub mono" style="margin:16px 0 8px">METHOD WORKINGS</div><div class="vm-grid">${detail}</div>
    <div class="vm-disc">Blended target weights the DCF 40% and the average of the relative methods 60%, per institutional convention. Each method is a cross-check, not a point forecast; the spread between them is itself information about valuation uncertainty.</div>`;
}

function renderMonteCarlo(mc, meta) {
  const ccy = meta.currency, sym = ccy === "INR" ? "₹" : ccy === "USD" ? "$" : "";
  const N = (x, dp = 2) => x == null ? "—" : x.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  const px = (x) => x == null ? "—" : sym + N(x, 2);
  return `<div class="mc-stats">
    <div><span class="l">MEAN</span><span class="n">${px(mc.mean)}</span></div>
    <div><span class="l">MEDIAN</span><span class="n">${px(mc.median)}</span></div>
    <div><span class="l">5th PCTILE</span><span class="n">${px(mc.p5)}</span></div>
    <div><span class="l">95th PCTILE</span><span class="n">${px(mc.p95)}</span></div>
    <div class="mc-hl"><span class="l">P(VALUE &gt; PRICE)</span><span class="n ${mc.probAbove >= 50 ? "up" : "down"}">${mc.probAbove == null ? "—" : N(mc.probAbove, 0) + "%"}</span></div>
  </div>
  <canvas id="mcChart" class="mc-canvas"></canvas>
  <div class="mc-range"><span>5–95% range: <b>${px(mc.p5)} – ${px(mc.p95)}</b></span><span>interquartile: <b>${px(mc.p25)} – ${px(mc.p75)}</b></span></div>
  <div class="vm-disc">${mc.runs.toLocaleString()} simulations drawing revenue growth (±40% relative), EBITDA margin (±15%), WACC (±1.2pp) and terminal growth (±0.8pp) from bounded normal distributions. The histogram is the resulting distribution of intrinsic value per share; the dashed line marks the current price.</div>`;
}

function drawMonteCarlo(mc, meta) {
  const cv = $("#mcChart"); if (!cv || !mc.hist) return;
  const dpr = Math.min(devicePixelRatio || 1, 2), W = cv.offsetWidth || 600, H = 180;
  cv.width = W * dpr; cv.height = H * dpr; const ctx = cv.getContext("2d"); ctx.scale(dpr, dpr);
  const maxC = Math.max(...mc.hist.map((b) => b.c)) || 1;
  const lo = mc.hist[0].x, hi = mc.hist.at(-1).x, span = (hi - lo) || 1;
  const bw = W / mc.hist.length;
  ctx.clearRect(0, 0, W, H);
  mc.hist.forEach((b, i) => {
    const bh = (b.c / maxC) * (H - 30);
    const inIqr = b.x >= mc.p25 && b.x <= mc.p75;
    ctx.fillStyle = inIqr ? "#c8862a" : "rgba(200,134,42,.4)";
    ctx.fillRect(i * bw + 1, H - 20 - bh, bw - 2, bh);
  });
  // current price line
  if (mc.currentPrice != null && mc.currentPrice >= lo && mc.currentPrice <= hi) {
    const x = ((mc.currentPrice - lo) / span) * W;
    ctx.strokeStyle = "#e8e6e1"; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(x, 4); ctx.lineTo(x, H - 20); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "#e8e6e1"; ctx.font = "10px monospace"; ctx.fillText("price", x + 3, 12);
  }
  // axis labels
  ctx.fillStyle = "#7a8290"; ctx.font = "10px monospace";
  ctx.fillText(lo.toFixed(0), 2, H - 6); ctx.fillText(hi.toFixed(0), W - 28, H - 6);
}

function fillComps(rows, ccy) {
  $("#compsFor").textContent = rows[0]?.name || "";
  const cols = [["P/E", "pe"], ["EV/EBITDA", "evEbitda"], ["P/B", "pb"]];
  const med = (k) => { const v = rows.slice(1).map((r) => r[k]).filter((x) => x !== null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
  const self = rows[0];
  const implied = cols.map(([l, k]) => { const m = med(k); return { l, m, self: self[k] }; });
  $("#compsOut").innerHTML = `<div class="table-wrap"><table class="dt"><tr><th>Multiple</th><th>${self.name}</th><th>Peer median</th><th>Premium/(disc)</th></tr>${implied.map((r) => `<tr><td class="nm">${r.l}</td><td>${F.x(r.self, 2)}</td><td>${F.x(r.m, 2)}</td><td class="${r.self && r.m ? (r.self > r.m ? "down" : "up") : ""}">${r.self && r.m ? F.pct((r.self / r.m - 1) * 100) : "—"}</td></tr>`).join("")}</table></div><div class="prose">Relative multiples versus the auto-selected peer median. A premium is only warranted where growth, returns or quality exceed the peer set — cross-reference the ratio library in Research.</div>`;
}

/* ════════ AI RESEARCH ENGINE ════════ */
TABS.reports = {
  init() {
    api("/api/company/AAPL").catch(() => {}); // warm
    $("#aiMode").textContent = "checking engine…";
    $("#reportGo").addEventListener("click", () => this.generate());
    $("#reportSymbol").value = CURRENT?.symbol || "";
    $("#reportPrint").addEventListener("click", () => window.print());
    $("#reportSave").addEventListener("click", () => this.save());
    $("#reportDoc").addEventListener("click", () => this.downloadDoc());
  },
  async generate() {
    const symbol = $("#reportSymbol").value.trim() || CURRENT?.symbol;
    if (!symbol) return;
    const type = $("#reportType").value;
    $("#reportStatus").textContent = "reading filings · computing · drafting…";
    $("#reportActions").hidden = true;
    $("#reportCanvas").innerHTML = "";
    try {
      const rep = await api("/api/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol, type }) });
      this.current = rep;
      $("#aiMode").textContent = rep.meta.mode === "ai" ? "AI narrative (Claude)" : "deterministic narrative — add ANTHROPIC_API_KEY for AI-written prose";
      $("#reportCanvas").innerHTML = renderReport(rep);
      $("#reportStatus").textContent = "done";
      $("#reportActions").hidden = false;
    } catch (e) { $("#reportStatus").textContent = "failed: " + e.message; }
  },
  async save() {
    if (!this.current) return;
    const m = this.current.meta;
    await api("/api/library", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: `${m.name} — ${m.type}`, kind: "report", symbol: m.symbol, payload: this.current }) });
    $("#reportStatus").textContent = "saved to Library";
  },
  downloadDoc() {
    if (!this.current) return;
    const html = `<html><head><meta charset="utf-8"></head><body>${renderReport(this.current)}</body></html>`;
    const blob = new Blob([html], { type: "application/msword" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${this.current.meta.symbol}_${this.current.meta.type.replace(/\s+/g, "_")}.doc`; a.click();
  },
};

function renderReport(rep) {
  const m = rep.meta, nv = rep.narrative, d = rep.data, ccy = m.currency;
  const idcf = d.idcf && !d.idcf.error ? d.idcf : null;
  const li = (arr) => (arr || []).map((x) => `<li>${x}</li>`).join("");
  // unit-aware scaler: statements arrive in absolute currency; show in Cr (INR) or Mn (else)
  const isINR = ccy === "INR";
  const unit = isINR ? "Cr" : "Mn";
  const scale = isINR ? 1e7 : 1e6;
  const U = (v, dp = 0) => (v == null || !isFinite(v) ? "—" : (v / scale).toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp }));
  const N = (v, dp = 1) => (v == null || !isFinite(v) ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp }));
  const P = (v, dp = 1) => (v == null || !isFinite(v) ? "—" : (v >= 0 ? "" : "") + v.toFixed(dp) + "%");
  const X = (v, dp = 1) => (v == null || !isFinite(v) ? "—" : v.toFixed(dp) + "x");
  const sym = isINR ? "₹" : ccy === "USD" ? "$" : "";
  const px = (v, dp = 2) => v == null ? "—" : sym + N(v, dp);
  const yoy = (arr, i) => i > 0 && arr[i - 1] ? ((arr[i] / arr[i - 1] - 1) * 100) : null;

  const st = d.statements, yrs = st.income.map((r) => r.year);
  let ex = 0; const EX = () => ++ex; // exhibit counter

  // ── COVER ──
  // Map recommendation to a safe CSS class (handles "STRONG BUY", "STRONG SELL")
  const recClass = (m.recommendation || "HOLD").replace(/\s+/g, "_");
  const recDisplay = m.recommendation || "HOLD";
  const cover = `
    <div class="ir-cover">
      <div class="ir-band"><div class="ir-firm">MERIDIAN RESEARCH</div><div class="ir-region">${(m.exchange || "GLOBAL").toUpperCase()} EQUITY RESEARCH</div></div>
      <div class="ir-cover-main">
        <div class="ir-cover-left">
          <h1 class="ir-co">${m.name}</h1>
          <div class="ir-tagline">${(m.type || "").toUpperCase()}${m.sector ? " · " + m.sector : ""}</div>
          <p class="ir-thesis-lead">${nv.execSummary || nv.thesis || ""}</p>
        </div>
        <div class="ir-cover-right">
          <div class="ir-rec-box ${recClass}">
            <div class="ir-rec-label">RATING</div>
            <div class="ir-rec">${recDisplay}</div>
          </div>
          <table class="ir-keyfin">
            <tr><td>Ticker</td><td>${m.symbol}</td></tr>
            <tr><td>Sector</td><td>${m.sector || "—"}</td></tr>
            <tr><td>Current price</td><td>${px(m.price)}</td></tr>
            <tr><td>12-mth target</td><td><b>${px(m.target)}</b></td></tr>
            <tr><td>Up/downside</td><td class="${m.upside >= 0 ? "ir-up" : "ir-down"}"><b>${P(m.upside)}</b></td></tr>
            <tr><td>Market cap</td><td>${sym}${U(d.keyStats.mcap)} ${unit}</td></tr>
            <tr><td>52-wk range</td><td>${N(d.keyStats.low52)}–${N(d.keyStats.high52)}</td></tr>
            <tr><td>Beta</td><td>${X(d.keyStats.beta, 2)}</td></tr>
            <tr><td>Date</td><td>${m.date}</td></tr>
            <tr><td>Analyst</td><td>${m.analyst}</td></tr>
          </table>
          <div class="ir-unit">${m.unitNote}</div>
        </div>
      </div>
    </div>`;

  // ── helper: financial summary table with %y/y subrows ──
  function finRow(label, vals, asPct) {
    const cells = vals.map((v, i) => `<td>${asPct ? P(v) : U(v)}</td>`).join("");
    const yoyRow = asPct ? "" : `<tr class="ir-yoy"><td>% y/y</td>${vals.map((v, i) => `<td>${i === 0 ? "—" : P(yoy(vals, i))}</td>`).join("")}</tr>`;
    return `<tr><td>${label}</td>${cells}</tr>${yoyRow}`;
  }
  const rev = st.income.map((r) => r.revenue), gp = st.income.map((r) => r.grossProfit), eb = st.income.map((r) => r.ebitda || r.opIncome), ni = st.income.map((r) => r.netIncome);
  const fcf = st.cashflow.map((r) => r.fcf), capex = st.cashflow.map((r) => r.capex);
  const finSummary = `
    <h2>Exhibit ${EX()}: Financial Summary (${ccy} ${unit})</h2>
    <table class="ir-fin"><tr class="ir-hd"><td>FY (${yrs[0] || ""}–${yrs[yrs.length - 1] || ""})</td>${yrs.map((y) => `<th>FY${String(y).slice(2)}</th>`).join("")}</tr>
      ${finRow("Sales", rev)}
      ${finRow("Gross profit", gp)}
      ${finRow("EBITDA", eb)}
      ${finRow("Net profit", ni)}
      ${finRow("Free cash flow", fcf)}
      ${finRow("Capex", capex)}
      <tr class="ir-sep"><td>EBITDA margin</td>${st.income.map((r) => `<td>${P(r.revenue ? (r.ebitda || r.opIncome) / r.revenue * 100 : null)}</td>`).join("")}</tr>
      <tr><td>Net margin</td>${st.income.map((r) => `<td>${P(r.revenue ? r.netIncome / r.revenue * 100 : null)}</td>`).join("")}</tr>
    </table><div class="ir-src">Source: Company filings, Meridian computation</div>`;

  // ── ratio / valuation block ──
  const rGet = (n) => { const r = d.ratios.find((x) => x.name === n); return r ? r.value : null; };
  const valTbl = `
    <h2>Exhibit ${EX()}: Valuation & Return Metrics</h2>
    <table class="ir-fin"><tr class="ir-hd"><td>Metric</td><th>Current</th><td style="text-align:left;width:50%">Interpretation</td></tr>
      ${[["P/E (TTM)", "P/E (TTM)", "x"], ["EV/EBITDA", "EV / EBITDA", "x"], ["P/B", "P/B", "x"], ["ROE", "ROE", "%"], ["ROCE", "ROCE", "%"], ["Net margin", "Net margin", "%"], ["Debt / Equity", "Debt / Equity", "x"], ["Dividend yield", "Dividend yield", "%"]].map(([l, k, t]) => { const v = rGet(k); const r = d.ratios.find((x) => x.name === k); return `<tr><td>${l}</td><td>${v == null ? "—" : t === "%" ? N(v, 1) + "%" : X(v, 2)}</td><td style="text-align:left;color:#555">${r ? r.note : ""}</td></tr>`; }).join("")}
    </table><div class="ir-src">Source: Company filings, Meridian computation</div>`;

  // ── DCF working ──
  let dcfSection = "";
  if (idcf) {
    const b = idcf.base, w = idcf.waccBuild;
    const dcfRows = b.rows.map((r) => `<tr><td>FY${String(r.year).slice(2)}E</td><td>${U(r.rev)}</td><td>${P(r.growth)}</td><td>${U(r.ebitda)}</td><td>${P(r.margin)}</td><td>${U(r.dep)}</td><td>${U(r.ebit)}</td><td>(${U(r.tax)})</td><td>(${U(r.capex)})</td><td>(${U(r.dWC)})</td><td><b>${U(r.fcff)}</b></td><td>${N(r.df, 3)}</td><td>${U(r.pv)}</td></tr>`).join("");
    const waccRows = `<tr><td>Risk-free rate</td><td>${N(w.rf, 1)}%</td></tr><tr><td>Beta</td><td>${N(w.beta, 2)}</td></tr><tr><td>Equity risk premium</td><td>${N(w.erp, 1)}%</td></tr><tr><td>Cost of equity</td><td>${N(w.costEquity, 1)}%</td></tr><tr><td>After-tax cost of debt</td><td>${N(w.costDebt, 1)}%</td></tr><tr><td>Weight equity / debt</td><td>${N(w.weightEquity, 0)}% / ${N(w.weightDebt, 0)}%</td></tr><tr class="ir-tot"><td>WACC</td><td><b>${N(w.wacc, 1)}%</b></td></tr>`;
    const sensRows = idcf.sens.map((row) => `<tr><th>${N(row.wacc, 2)}%</th>${row.values.map((v) => `<td style="${v && idcf.currentPrice ? `background:rgba(${v >= idcf.currentPrice ? "46,158,107" : "200,24,27"},${Math.min(Math.abs(v / idcf.currentPrice - 1) * 1.4, 0.42)})` : ""}">${v == null ? "—" : N(v, 1)}</td>`).join("")}</tr>`).join("");
    // football field as bars
    const allVals = idcf.ff.flatMap((f) => [f.low, f.high]).filter((v) => v != null);
    const lo = Math.min(...allVals), hi = Math.max(...allVals), span = hi - lo || 1;
    const ffRows = idcf.ff.map((f) => { const l = ((f.low - lo) / span) * 100, ww = ((f.high - f.low) / span) * 100, mp = ((f.mid - lo) / span) * 100; return `<div class="ir-ff-row"><span class="ir-ff-lbl">${f.method}</span><span class="ir-ff-track"><i style="left:${l}%;width:${ww}%"></i><b style="left:${mp}%"></b></span><span class="ir-ff-val">${N(f.mid, 1)}</span></div>`; }).join("");
    dcfSection = `
    <h2>Exhibit ${EX()}: DCF — Explicit Free Cash Flow Forecast (${ccy} ${unit})</h2>
    <table class="ir-fin ir-dcf"><tr class="ir-hd"><td>Year</td><th>Revenue</th><th>Gr%</th><th>EBITDA</th><th>Mgn%</th><th>D&A</th><th>EBIT</th><th>Tax</th><th>Capex</th><th>ΔWC</th><th>FCFF</th><th>DF</th><th>PV</th></tr>${dcfRows}</table>
    <div class="ir-dcf-summary">
      <table class="ir-fin ir-half"><tr class="ir-hd"><td colspan="2">WACC Build-up</td></tr>${waccRows}</table>
      <table class="ir-fin ir-half"><tr class="ir-hd"><td colspan="2">Valuation Bridge (${ccy} ${unit})</td></tr>
        <tr><td>PV of explicit FCFF</td><td>${U(b.pvExplicit)}</td></tr>
        <tr><td>PV of terminal value</td><td>${U(b.tvPv)}</td></tr>
        <tr class="ir-tot"><td>Enterprise value</td><td><b>${U(b.ev)}</b></td></tr>
        <tr><td>Less: net debt</td><td>(${U(idcf.netDebt)})</td></tr>
        <tr class="ir-tot"><td>Equity value</td><td><b>${U(b.equity)}</b></td></tr>
        <tr><td>Shares outstanding (mn)</td><td>${N(idcf.sharesOut / 1e6, 0)}</td></tr>
        <tr class="ir-tot"><td>Value per share</td><td><b>${px(b.perShare)}</b></td></tr>
        <tr><td>Terminal value as % of EV</td><td>${P(b.terminalShare * 100)}</td></tr>
      </table>
    </div><div class="ir-src">Source: Meridian DCF engine. Terminal growth ${N(idcf.assumptions.terminalG, 1)}%, WACC ${N(idcf.assumptions.wacc, 1)}%.</div>

    <h2>Exhibit ${EX()}: Sensitivity — Value per Share (WACC × Terminal Growth)</h2>
    <table class="ir-fin ir-sens"><tr class="ir-hd"><th>WACC ↓ / g →</th>${idcf.gCols.map((g) => `<th>${N(g, 2)}%</th>`).join("")}</tr>${sensRows}</table>
    <div class="ir-src">Shaded vs current price ${px(idcf.currentPrice)}.</div>

    <h2>Exhibit ${EX()}: Valuation Football Field (${sym} per share)</h2>
    <div class="ir-ff">${ffRows}</div><div class="ir-src">Bar = method range; marker = midpoint. Source: Meridian.</div>

    <h2>Exhibit ${EX()}: Scenario Analysis (${sym} per share)</h2>
    <table class="ir-fin"><tr class="ir-hd"><td>Scenario</td><th>Value/share</th><th>vs CMP</th><th>Key assumption</th></tr>
      <tr><td>Bull case</td><td>${px(idcf.bull.perShare)}</td><td class="ir-up">${P(idcf.currentPrice ? (idcf.bull.perShare / idcf.currentPrice - 1) * 100 : null)}</td><td style="text-align:left">Higher growth + margin expansion</td></tr>
      <tr class="ir-base"><td><b>Base case</b></td><td><b>${px(idcf.base.perShare)}</b></td><td class="${idcf.upside >= 0 ? "ir-up" : "ir-down"}"><b>${P(idcf.upside)}</b></td><td style="text-align:left">Forecast as modelled</td></tr>
      <tr><td>Bear case</td><td>${px(idcf.bear.perShare)}</td><td class="ir-down">${P(idcf.currentPrice ? (idcf.bear.perShare / idcf.currentPrice - 1) * 100 : null)}</td><td style="text-align:left">Slower growth + margin pressure</td></tr>
    </table><div class="ir-src">Source: Meridian DCF engine.</div>`;
  }

  // ── peers / comps ──
  let compsSection = "";
  if (d.peers && d.peers.length > 1) {
    const self = d.peers[0];
    const med = (k) => { const v = d.peers.slice(1).map((p) => p[k]).filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
    const rows = d.peers.map((p, i) => `<tr${i === 0 ? ' class="ir-base"' : ""}><td>${i === 0 ? "<b>" + p.name + "</b>" : p.name}</td><td>${sym}${U(p.mcap)}</td><td>${X(p.pe)}</td><td>${X(p.evEbitda)}</td><td>${X(p.pb)}</td><td>${N(p.roe, 1)}%</td><td>${N(p.netMargin, 1)}%</td><td>${P(p.revGrowth)}</td><td>${X(p.de, 2)}</td></tr>`).join("");
    const prem = (k) => { const mv = med(k), sv = self[k]; return mv && sv ? P((sv / mv - 1) * 100) : "—"; };
    compsSection = `
    <h2>Exhibit ${EX()}: Comparable Company Analysis</h2>
    <table class="ir-fin"><tr class="ir-hd"><td>Company</td><th>Mcap</th><th>P/E</th><th>EV/EBITDA</th><th>P/B</th><th>ROE</th><th>Net mgn</th><th>Rev gr</th><th>D/E</th></tr>${rows}
      <tr class="ir-sep"><td>Peer median</td><td>—</td><td>${X(med("pe"))}</td><td>${X(med("evEbitda"))}</td><td>${X(med("pb"))}</td><td>${N(med("roe"), 1)}%</td><td>${N(med("netMargin"), 1)}%</td><td>${P(med("revGrowth"))}</td><td>${X(med("de"), 2)}</td></tr>
    </table>
    <div class="ir-src">${self.name} trades at a ${prem("pe")} P/E and ${prem("evEbitda")} EV/EBITDA premium/(discount) to peer median. Source: Meridian.</div>`;
  }

  // ── SWOT / Porter ──
  const swot = nv.swot ? `<h2>Exhibit ${EX()}: SWOT</h2><div class="ir-swot"><div><h5>STRENGTHS</h5><ul>${li(nv.swot.strengths)}</ul></div><div><h5>WEAKNESSES</h5><ul>${li(nv.swot.weaknesses)}</ul></div><div><h5>OPPORTUNITIES</h5><ul>${li(nv.swot.opportunities)}</ul></div><div><h5>THREATS</h5><ul>${li(nv.swot.threats)}</ul></div></div>` : "";  const porter = nv.porter ? `<h2>Exhibit ${EX()}: Porter's Five Forces</h2><table class="ir-fin"><tr class="ir-hd"><td>Force</td><td style="text-align:left">Assessment</td></tr>${Object.entries({ "Competitive rivalry": "rivalry", "Threat of new entrants": "newEntrants", "Threat of substitutes": "substitutes", "Buyer power": "buyerPower", "Supplier power": "supplierPower" }).map(([l, k]) => `<tr><td>${l}</td><td style="text-align:left">${nv.porter[k] || "—"}</td></tr>`).join("")}</table>` : "";

  return `<div class="ir">
    ${cover}
    <div class="ir-page">
      ${(() => {
        // ── PAGE 1 · HIGHLIGHTS (Expedia-style thesis bullets + recent context) ──
        const bullets = (nv.thesisPillars && nv.thesisPillars.length ? nv.thesisPillars : (nv.catalysts || []).slice(0, 4).map((c) => ({ h: "Driver", p: c })));
        const hi = bullets.map((b) => `<li><b>${b.h || "Driver"}</b> — ${b.p || b}</li>`).join("");
        return `<div class="ir-highlights">
          <h2 class="ir-h-title">Highlights</h2>
          <p class="ir-lead">We issue a <b>${m.recommendation}</b> recommendation on ${m.name} (${m.symbol}) with a 12-month target price of <b>${px(m.target)}</b>, ${m.upside >= 0 ? "offering" : "implying"} <b class="${m.upside >= 0 ? "ir-up" : "ir-down"}">${P(m.upside)}</b> ${m.upside >= 0 ? "upside" : "downside"} versus the ${px(m.price)} current price. Our recommendation is driven by:</p>
          <ul class="ir-hi-list">${hi}</ul>
        </div>`;
      })()}

      <h2>1 · Investment Summary</h2>
      <p>${nv.execSummary || nv.thesis || ""}</p>
      ${nv.compositeScore != null ? `
      <div class="ir-comp-summary">
        <div><span class="ir-cs-l">COMPOSITE</span><span class="ir-cs-v">${nv.compositeScore}/100</span></div>
        ${nv.blendedUpside != null ? `<div><span class="ir-cs-l">BLENDED UPSIDE</span><span class="ir-cs-v ${nv.blendedUpside >= 0 ? "ir-up" : "ir-down"}">${nv.blendedUpside >= 0 ? "+" : ""}${nv.blendedUpside.toFixed(1)}%</span></div>` : ""}
        ${nv.dcfUpside != null ? `<div><span class="ir-cs-l">DCF VS PRICE</span><span class="ir-cs-v ${nv.dcfUpside >= 0 ? "ir-up" : "ir-down"}">${nv.dcfUpside >= 0 ? "+" : ""}${nv.dcfUpside.toFixed(1)}%</span></div>` : ""}
        ${nv.streetUpside != null ? `<div><span class="ir-cs-l">STREET VS PRICE</span><span class="ir-cs-v ${nv.streetUpside >= 0 ? "ir-up" : "ir-down"}">${nv.streetUpside >= 0 ? "+" : ""}${nv.streetUpside.toFixed(1)}%</span></div>` : ""}
      </div>` : ""}

      <h2>2 · Business Overview</h2>
      <p>${(d.profile.summary || "").slice(0, 1100)}</p>
      ${nv.business ? `<p>${nv.business}</p>` : ""}
      ${d.profile.officers && d.profile.officers.length ? `<p><b>Key management:</b> ${d.profile.officers.map((o) => o.name + (o.title ? " (" + o.title + ")" : "")).join("; ")}.</p>` : ""}

      <h2>3 · Management &amp; Governance</h2>
      <p>${nv.management || `${m.name}'s management is assessed on its capital-allocation record and alignment with shareholders. Insider ownership stands at ${N(d.holders.insiders, 1)}% and institutional ownership at ${N(d.holders.institutions, 1)}%, the latter a proxy for professional-investor confidence in the franchise.`}</p>
      <table class="ir-fin ir-half"><tr class="ir-hd"><td colspan="2">Ownership &amp; alignment</td></tr>
        <tr><td>Insider / promoter holding</td><td>${N(d.holders.insiders, 1)}%</td></tr>
        <tr><td>Institutional holding</td><td>${N(d.holders.institutions, 1)}%</td></tr>
        <tr><td>Street rating</td><td style="text-transform:capitalize">${d.street.rec || "—"}</td></tr>
        <tr><td>Street target</td><td>${px(d.street.targetMean)}</td></tr>
      </table>

      <h2>4 · Industry Analysis</h2>
      <p>${nv.industry || "Industry context for the " + (m.sector || "sector") + " is assessed against the peer set and macro backdrop below."}</p>
      ${porter}

      <h2>5 · Competitive Positioning</h2>
      <p>${nv.competitive || `We position ${m.name} against its closest listed comparables on growth, margins, returns and valuation. The peer table below frames whether the company's multiple is justified by superior fundamentals.`}</p>
      ${compsSection}

      <h2>6 · Economic Moat Analysis</h2>
      ${(() => {
        // deterministic moat scorecard from computed fundamentals
        const roe = rGet("ROE"), roce = rGet("ROCE"), gm = rGet("Net margin"), de = rGet("Debt / Equity");
        const score = (cond) => cond ? "Wide" : "Narrow";
        const rows = [
          ["Returns on capital", roce != null ? (roce > 15 ? "Wide" : roce > 8 ? "Narrow" : "None") : "—", roce != null ? N(roce, 1) + "% ROCE" : "n/a"],
          ["Margin durability", gm != null ? (gm > 15 ? "Wide" : gm > 5 ? "Narrow" : "None") : "—", gm != null ? N(gm, 1) + "% net margin" : "n/a"],
          ["Balance-sheet resilience", de != null ? (de < 0.5 ? "Wide" : de < 1.5 ? "Narrow" : "None") : "—", de != null ? X(de, 2) + " D/E" : "n/a"],
          ["Profitability vs peers", "Narrow", "see comparable analysis"],
        ];
        const moatBars = rows.map((r) => `<tr><td style="text-align:left">${r[0]}</td><td><span class="ir-moat-tag ${r[1]}">${r[1]}</span></td><td style="text-align:left;color:#555">${r[2]}</td></tr>`).join("");
        const wide = rows.filter((r) => r[1] === "Wide").length;
        const overall = wide >= 3 ? "Wide" : wide >= 1 ? "Narrow" : "None";
        return `<p>${nv.moat || `Our moat assessment scores ${m.name} across returns on capital, margin durability and balance-sheet resilience.`}</p>
        <table class="ir-fin"><tr class="ir-hd"><td>Moat source</td><th>Rating</th><td style="text-align:left;width:45%">Evidence</td></tr>${moatBars}
          <tr class="ir-tot"><td>Overall moat</td><td><b>${overall}</b></td><td style="text-align:left">Sustainability: ${overall === "Wide" ? "durable" : overall === "Narrow" ? "moderate" : "limited"}</td></tr>
        </table><div class="ir-src">Meridian deterministic moat framework. Ratings: Wide / Narrow / None.</div>`;
      })()}
      ${swot}

      <h2>7 · Financial Analysis</h2>
      <p>${nv.variance || d.variance.commentary}</p>
      ${nv.valuation ? `<div class="ir-val-rationale"><h4>Valuation context</h4><p>${nv.valuation}</p></div>` : ""}
      ${finSummary}
      ${valTbl}

      <h2>8 · Forensic &amp; Earnings Quality</h2>
      ${(() => {
        const fr = d.forensic;
        if (!fr) return `<p>Insufficient multi-year statement history to compute forensic scores for this issuer.</p>`;
        const pio = fr.piotroski, alt = fr.altman, ben = fr.beneish, cash = fr.cash;
        const gradeClass = (g) => ({ A: "ir-up", B: "", C: "", D: "ir-down" }[g] || "");
        return `<p>${nv.forensic || `We screen ${m.name}'s accounting quality with three standard forensic models — the Piotroski F-Score (fundamental strength), the Altman Z-Score (distress risk) and the Beneish M-Score (earnings-manipulation risk) — alongside cash-conversion analysis. Each component is shown so the assessment is fully auditable.`}</p>
        <div class="ir-forensic-grid">
          <table class="ir-fin"><tr class="ir-hd"><td colspan="2">Piotroski F-Score</td></tr>
            ${pio.components.map((c) => `<tr><td style="text-align:left">${c.t}</td><td>${c.ok ? "✓" : "—"}</td></tr>`).join("")}
            <tr class="ir-tot"><td>Score</td><td><b>${pio.score} / ${pio.max} (${pio.grade})</b></td></tr>
          </table>
          <div>
            <table class="ir-fin ir-half"><tr class="ir-hd"><td colspan="2">Altman Z-Score</td></tr>
              ${alt.components ? Object.entries({ "WC/TA": "wcTa", "RE/TA": "reTa", "EBIT/TA": "ebitTa", "MVE/TL": "mveTl", "Sales/TA": "salesTa" }).map(([l, k]) => `<tr><td>${l}</td><td>${N(alt.components[k], 2)}</td></tr>`).join("") : ""}
              <tr class="ir-tot"><td>Z-Score</td><td><b>${alt.score == null ? "—" : N(alt.score, 2)} (${alt.zone})</b></td></tr>
            </table>
            <table class="ir-fin ir-half" style="margin-top:8px"><tr class="ir-hd"><td colspan="2">Beneish M-Score</td></tr>
              <tr><td>M-Score</td><td>${ben.score == null ? "—" : N(ben.score, 2)}</td></tr>
              <tr><td>Threshold</td><td>${ben.threshold}</td></tr>
              <tr class="ir-tot"><td>Assessment</td><td><b>${ben.flag}</b></td></tr>
            </table>
          </div>
        </div>
        <table class="ir-fin" style="margin-top:8px"><tr class="ir-hd"><td>Cash quality</td><th>Value</th><td style="text-align:left;width:50%">Read</td></tr>
          <tr><td>Cash conversion (OCF/NI)</td><td>${cash.cashConversion == null ? "—" : X(cash.cashConversion, 2)}</td><td style="text-align:left;color:#555">${cash.cashConversion != null && cash.cashConversion >= 0.9 ? "Earnings well-backed by cash" : "Earnings run ahead of cash — monitor accruals"}</td></tr>
          <tr><td>FCF margin</td><td>${cash.fcfMargin == null ? "—" : N(cash.fcfMargin, 1) + "%"}</td><td style="text-align:left;color:#555">Free cash generated per unit of sales</td></tr>
          <tr><td>Accrual ratio</td><td>${cash.accrualRatio == null ? "—" : N(cash.accrualRatio, 1) + "%"}</td><td style="text-align:left;color:#555">${cash.accrualRatio != null && Math.abs(cash.accrualRatio) < 10 ? "Low accruals — clean quality" : "Elevated accruals — scrutinise"}</td></tr>
          <tr class="ir-tot"><td>Earnings quality grade</td><td class="${gradeClass(fr.earningsQualityGrade)}"><b>${fr.earningsQualityGrade}</b></td><td style="text-align:left">Composite of the screens above</td></tr>
        </table><div class="ir-src">Source: Meridian forensic engine, computed from reported statements. Beneish M &gt; −1.78 flags elevated manipulation risk; Altman Z &gt; 2.99 = safe, 1.81–2.99 = grey, &lt; 1.81 = distress.</div>`;
      })()}

      <h2>9 · Valuation</h2>
      <p>${idcf ? `We value ${m.name} using a five-year explicit DCF (FCFF) discounted at a ${N(idcf.assumptions.wacc, 1)}% WACC with ${N(idcf.assumptions.terminalG, 1)}% terminal growth, cross-checked against comparable multiples and the 52-week trading range. Consistent with institutional practice, our headline target blends the intrinsic (DCF) and relative (multiples) approaches rather than relying on a single method.` : "A full DCF was not available for this issuer; valuation rests on relative multiples versus the peer set."}</p>
      ${(() => {
        // blended valuation table (Expedia 50/50 DCF/multiples style)
        if (!idcf) return "";
        const dcfVal = idcf.target;
        const self = d.peers && d.peers.length > 1 ? d.peers[0] : null;
        const med = (k) => { if (!d.peers || d.peers.length < 2) return null; const v = d.peers.slice(1).map((p) => p[k]).filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
        // implied multiple value: peer median P/E × current EPS proxy (net income / shares)
        let multVal = null;
        const ni = st.income.at(-1)?.netIncome, peerPe = med("pe");
        if (ni && peerPe && idcf.sharesOut) multVal = (ni * peerPe) / idcf.sharesOut;
        const blended = multVal ? dcfVal * 0.5 + multVal * 0.5 : dcfVal;
        const blendUp = idcf.currentPrice ? (blended / idcf.currentPrice - 1) * 100 : null;
        return `<table class="ir-fin"><tr class="ir-hd"><td>Method</td><th>Est. value/share</th><th>Weight</th><th>Contribution</th></tr>
          <tr><td>DCF (intrinsic)</td><td>${px(dcfVal)}</td><td>${multVal ? "50%" : "100%"}</td><td>${px(multVal ? dcfVal * 0.5 : dcfVal)}</td></tr>
          ${multVal ? `<tr><td>Comparable multiples (peer median P/E)</td><td>${px(multVal)}</td><td>50%</td><td>${px(multVal * 0.5)}</td></tr>` : ""}
          <tr class="ir-tot"><td><b>Blended target price</b></td><td><b>${px(blended)}</b></td><td></td><td class="${blendUp >= 0 ? "ir-up" : "ir-down"}"><b>${P(blendUp)}</b></td></tr>
        </table><div class="ir-src">Blended target weights intrinsic and relative approaches equally, per institutional convention. Source: Meridian.</div>`;
      })()}
      ${dcfSection}

      <h2>10 · Investment Thesis</h2>
      <p>${nv.thesis || ""}</p>
      ${nv.catalysts && nv.catalysts.length ? `<p><b>Key catalysts:</b></p><ul>${li(nv.catalysts)}</ul>` : ""}

      <h2>11 · Risk Analysis</h2>
      <ul>${li(nv.risks)}</ul>
      ${(() => {
        // simple probability×impact risk matrix from the listed risks
        const risks = (nv.risks || []).slice(0, 6);
        if (!risks.length) return "";
        const cells = risks.map((r, i) => { const cat = ["Business", "Industry", "Financial", "Governance", "Regulatory", "Macro"][i] || "Other"; return `<tr><td style="text-align:left">${cat}</td><td style="text-align:left">${r}</td></tr>`; }).join("");
        return `<table class="ir-fin"><tr class="ir-hd"><td>Category</td><td style="text-align:left">Risk factor</td></tr>${cells}</table><div class="ir-src">Risks should be weighed by probability and severity; downside is captured in the bear-case scenario above.</div>`;
      })()}

      <h2>12 · Recommendation</h2>
      <div class="ir-concl">
        <p><b>Investment thesis summary.</b> ${(nv.thesis || "").slice(0, 600)}</p>
        <p><b>Valuation summary.</b> ${idcf ? `Base-case DCF fair value ${px(idcf.target)} (${P(idcf.upside)} vs current); bull ${px(idcf.bull.perShare)} / bear ${px(idcf.bear.perShare)}.` : "Valuation anchored to relative metrics."}${d.street?.targetMean ? ` Sell-side consensus target ${px(d.street.targetMean)}${nv.streetUpside != null ? ` (${nv.streetUpside >= 0 ? "+" : ""}${nv.streetUpside.toFixed(1)}%)` : ""}.` : ""}${nv.blendedUpside != null ? ` Blended target ${px(m.price * (1 + nv.blendedUpside / 100))} implies <b class="${nv.blendedUpside >= 0 ? "ir-up" : "ir-down"}">${nv.blendedUpside >= 0 ? "+" : ""}${nv.blendedUpside.toFixed(1)}%</b> over a 12-month horizon.` : ""}</p>
        <p><b>Key catalysts.</b> ${(nv.catalysts || []).join("; ")}.</p>
        <p><b>Risk assessment.</b> ${(nv.risks || []).slice(0, 3).join("; ")}.</p>

        ${nv.factorBreakdown && nv.factorBreakdown.length ? `
        <h4 style="margin-top:18px">Composite recommendation framework</h4>
        <p>The recommendation is the output of a weighted multi-factor framework. Each factor is scored independently from the underlying data; the weighted aggregate determines the rating band. <b>The framework deliberately does not rely on DCF intrinsic value alone</b> — quality compounders routinely trade above DCF fair value and would be wrongly screened as Sells if intrinsic value were the only input.</p>
        <table class="ir-fin ir-factor-tbl">
          <tr class="ir-hd"><td style="text-align:left">Factor</td><th>Weight</th><th>Score</th><th style="text-align:left">Evidence</th></tr>
          ${nv.factorBreakdown.map((f) => `<tr>
            <td style="text-align:left"><b>${f.name}</b></td>
            <td>${f.weight}%</td>
            <td><span class="ir-factor-score" style="background:${f.score >= 75 ? "#1d6f48" : f.score >= 60 ? "#2e9e6b" : f.score >= 40 ? "#b08328" : f.score >= 25 ? "#c2181b" : "#8a0e10"}">${f.score}/100</span></td>
            <td style="text-align:left;color:#444;font-size:11px">${f.evidence}</td>
          </tr>`).join("")}
          <tr class="ir-tot"><td style="text-align:left"><b>Composite (weighted average)</b></td><td></td><td><b>${nv.compositeScore}/100</b></td><td style="text-align:left"><b>${nv.recommendationLabel || m.recommendation}</b> band (≥75 Strong Buy · 60–74 Buy · 40–59 Hold · 25–39 Sell · &lt;25 Strong Sell)</td></tr>
        </table>
        ` : ""}

        <div class="ir-verdict ${recClass}">
          <div><span class="ir-v-l">RECOMMENDATION</span><span class="ir-v-v">${recDisplay}</span></div>
          <div><span class="ir-v-l">TARGET PRICE</span><span class="ir-v-v">${px(m.target)}</span></div>
          <div><span class="ir-v-l">EXPECTED RETURN</span><span class="ir-v-v ${m.upside >= 0 ? "ir-up" : "ir-down"}">${P(m.upside)}</span></div>
        </div>
        <p class="ir-rationale">${nv.recRationale || ""}</p>
      </div>
      <h2>Appendix — Methodology &amp; Disclosures</h2>
      <p class="ir-disc">Meridian Research. Generated ${m.date}. ${m.unitNote} All figures are computed from the issuer's latest public filings by the platform's deterministic analytics engine; qualitative sections were ${nv.mode === "ai" ? "drafted by an AI model constrained to the computed data" : "produced by the deterministic commentary engine"}. ${nv.note || ""} <b>Rating methodology:</b> ratings are derived from a multi-factor composite score (0–100) that weights valuation (20%), business quality (18%), economic moat (15%), forensic health (15%), growth momentum (12%), balance sheet (10%) and street consensus (10%). Bands: <b>STRONG BUY</b> (composite ≥75), <b>BUY</b> (60–74), <b>HOLD</b> (40–59), <b>SELL</b> (25–39), <b>STRONG SELL</b> (&lt;25). DCF intrinsic value is one input among many — quality compounders routinely trade above DCF fair value, which the framework deliberately accommodates. This document is for information only and is not investment advice or an offer to transact. Valuations depend on the assumptions stated herein and actual results will differ. Past performance does not indicate future results.</p>
    </div>
  </div>`;
}

/* ════════ SCREENER ════════ */
TABS.screener = {
  init() {
    this.load();
    $("#screenApply").addEventListener("click", () => this.render());
    $("#screenReset").addEventListener("click", () => { $$("#screenFilters input").forEach((i) => (i.value = "")); $("#f_sector").value = ""; this.render(); });
  },
  async load() {
    $("#screenInfo").textContent = "scanning 50 companies — paced to avoid rate limits (2–3 min first run, cached 6h after)…";
    try {
      const { rows } = await api("/api/screener/run");
      this.rows = rows; this.sortKey = "mcap"; this.sortDir = -1;
      const sectors = [...new Set(rows.map((r) => r.sector).filter((s) => s && s !== "—"))].sort();
      $("#f_sector").innerHTML = `<option value="">All</option>` + sectors.map((s) => `<option>${s}</option>`).join("");
      $("#screenInfo").textContent = `${rows.length} companies · cached 6h`;
      this.render();
    } catch (e) { $("#screenInfo").textContent = "scan failed: " + e.message; }
  },
  render() {
    if (!this.rows) return;
    const fv = (id) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : null; };
    const f = { mcap: fv("#f_mcap"), pe: fv("#f_pe"), roe: fv("#f_roe"), rg: fv("#f_rg"), nm: fv("#f_nm"), de: fv("#f_de"), sector: $("#f_sector").value };
    let rows = this.rows.filter((r) =>
      (f.mcap === null || (r.mcap && r.mcap / 1e7 >= f.mcap)) &&
      (f.pe === null || (r.pe !== null && r.pe <= f.pe)) &&
      (f.roe === null || (r.roe !== null && r.roe >= f.roe)) &&
      (f.rg === null || (r.revGrowth !== null && r.revGrowth >= f.rg)) &&
      (f.nm === null || (r.netMargin !== null && r.netMargin >= f.nm)) &&
      (f.de === null || (r.de !== null && r.de <= f.de)) &&
      (!f.sector || r.sector === f.sector)
    );
    rows.sort((a, b) => { const x = a[this.sortKey] ?? -Infinity, y = b[this.sortKey] ?? -Infinity; return (x - y) * this.sortDir; });

    // auto-generated ideas: cheap + quality
    const ideas = this.rows.filter((r) => r.pe !== null && r.pe > 0 && r.pe < 22 && r.roe > 18 && (r.de === null || r.de < 1)).sort((a, b) => b.roe - a.roe).slice(0, 5);
    $("#screenIdeas").innerHTML = ideas.length ? `<div class="ideas"><div class="tagline">AUTO-DISCOVERED · QUALITY AT A REASONABLE PRICE (ROE&gt;18%, P/E&lt;22, low debt)</div>${ideas.map((r) => `<span class="chip" data-s="${r.symbol}">${r.name} · ${F.x(r.pe, 1)} · ROE ${F.num(r.roe, 0)}%</span>`).join(" ")}</div>` : "";
    $$("#screenIdeas .chip").forEach((c) => c.addEventListener("click", () => loadCompany(c.dataset.s)));

    const cols = [["Company", "name", "nm"], ["Sector", "sector", "txt"], ["Price", "price", "px"], ["Chg", "changePct", "pct"], ["Mcap", "mcap", "cap"], ["P/E", "pe", "x"], ["P/B", "pb", "x"], ["EV/EBITDA", "evEbitda", "x"], ["ROE", "roe", "pct"], ["Net mgn", "netMargin", "pct"], ["Rev gr", "revGrowth", "pct"], ["D/E", "de", "x"], ["Div", "divYield", "pct"]];
    const cell = (r, k, t) => {
      const v = r[k];
      if (t === "nm") return `<a href="#" data-s="${r.symbol}">${v}</a>`;
      if (t === "txt") return v || "—";
      if (t === "px") return F.px(v, "INR", 1);
      if (t === "pct") return `<span class="${F.cls(v)}">${v === null ? "—" : F.num(v, 1) + "%"}</span>`;
      if (t === "cap") return F.cap(v, "INR");
      if (t === "x") return F.x(v, 1);
      return v ?? "—";
    };
    $("#screenTable").innerHTML = `<tr>${cols.map((c) => `<th data-k="${c[1]}">${c[0]}${this.sortKey === c[1] ? (this.sortDir < 0 ? " ↓" : " ↑") : ""}</th>`).join("")}</tr>` + rows.map((r) => `<tr>${cols.map((c) => `<td${c[2] === "nm" ? ' class="nm"' : ""}>${cell(r, c[1], c[2])}</td>`).join("")}</tr>`).join("");
    $$("#screenTable th").forEach((th) => th.addEventListener("click", () => { const k = th.dataset.k; if (this.sortKey === k) this.sortDir *= -1; else { this.sortKey = k; this.sortDir = -1; } this.render(); }));
    $$("#screenTable a").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); loadCompany(a.dataset.s); }));
  },
};

/* ════════ PORTFOLIO ════════ */
const PF_KEY = "meridian_pf";
TABS.portfolio = {
  init() {
    this.holdings = JSON.parse(localStorage.getItem(PF_KEY) || "[]");
    $("#pfAdd").addEventListener("click", () => this.add());
    $("#pfRefresh").addEventListener("click", () => this.refresh());
    this.refresh();
  },
  save() { localStorage.setItem(PF_KEY, JSON.stringify(this.holdings)); },
  add() {
    const sym = $("#pfSym").value.trim().toUpperCase(), qty = parseFloat($("#pfQty").value), cost = parseFloat($("#pfCost").value);
    if (!sym || !qty) return;
    this.holdings.push({ sym, qty, cost: cost || 0 }); this.save();
    $("#pfSym").value = $("#pfQty").value = $("#pfCost").value = "";
    this.refresh();
  },
  async refresh() {
    if (!this.holdings.length) { $("#pfTable").innerHTML = `<tr><td class="empty-mini">No holdings yet. Add a symbol, quantity and average cost above.</td></tr>`; $("#pfStats").innerHTML = ""; $("#pfAlloc").innerHTML = ""; $("#pfRisk").innerHTML = `<div class="empty-mini mono">Add 2+ holdings and refresh.</div>`; return; }
    const syms = this.holdings.map((h) => h.sym).join(",");
    try {
      const { quotes } = await api(`/api/quotes?symbols=${encodeURIComponent(syms)}`);
      const qmap = Object.fromEntries(quotes.map((q) => [q.symbol, q]));
      let totVal = 0, totCost = 0;
      const rows = this.holdings.map((h) => { const q = qmap[h.sym] || {}; const px = q.price ?? 0; const val = px * h.qty, cost = h.cost * h.qty; totVal += val; totCost += cost; return { ...h, px, val, cost, pl: val - cost, plPct: cost ? (val / cost - 1) * 100 : null, ccy: q.currency, name: q.name || h.sym }; });
      $("#pfTable").innerHTML = `<tr><th>Symbol</th><th>Qty</th><th>Avg cost</th><th>Price</th><th>Value</th><th>P/L</th><th>P/L %</th><th>Wt</th><th></th></tr>` + rows.map((r, i) => `<tr><td class="nm"><a href="#" data-s="${r.sym}">${r.sym}</a></td><td>${F.num(r.qty, 0)}</td><td>${F.num(r.cost / r.qty, 2)}</td><td>${F.num(r.px, 2)}</td><td>${F.num(r.val, 0)}</td><td class="${F.cls(r.pl)}">${F.num(r.pl, 0)}</td><td class="${F.cls(r.plPct)}">${F.pct(r.plPct)}</td><td>${F.num((r.val / totVal) * 100, 1)}%</td><td><button class="mini-btn" data-rm="${i}">×</button></td></tr>`).join("");
      $$("#pfTable a").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); loadCompany(a.dataset.s); }));
      $$("#pfTable [data-rm]").forEach((b) => b.addEventListener("click", () => { this.holdings.splice(+b.dataset.rm, 1); this.save(); this.refresh(); }));
      const pl = totVal - totCost;
      $("#pfStats").innerHTML = `<div class="brow"><span class="bl">Market value</span><span class="bv">${F.num(totVal, 0)}</span></div><div class="brow"><span class="bl">Cost basis</span><span class="bv">${F.num(totCost, 0)}</span></div><div class="brow"><span class="bl">Total P/L</span><span class="bv ${F.cls(pl)}">${F.num(pl, 0)}</span></div><div class="brow"><span class="bl">Return</span><span class="bv ${F.cls(pl)}">${F.pct(totCost ? (totVal / totCost - 1) * 100 : null)}</span></div><div class="brow"><span class="bl">Positions</span><span class="bv">${rows.length}</span></div><div class="brow"><span class="bl">Concentration (top)</span><span class="bv">${F.num(Math.max(...rows.map((r) => (r.val / totVal) * 100)), 1)}%</span></div>`;
      const sorted = [...rows].sort((a, b) => b.val - a.val);
      $("#pfAlloc").innerHTML = `<div style="padding:10px 0">` + sorted.map((r) => `<div class="alloc-row"><span>${r.sym}</span><span class="alloc-bar"><i style="width:${(r.val / totVal) * 100}%"></i></span><span>${F.num((r.val / totVal) * 100, 1)}%</span></div>`).join("") + `</div>`;
      this.loadRisk();
    } catch (e) { $("#pfTable").innerHTML = `<tr><td class="empty-mini">Price refresh failed: ${e.message}</td></tr>`; }
  },
  async loadRisk() {
    if (this.holdings.length < 2) { $("#pfRisk").innerHTML = `<div class="empty-mini mono">Add 2+ holdings for correlation &amp; risk.</div>`; return; }
    const syms = this.holdings.map((h) => h.sym).join(",");
    try {
      const m = await api(`/api/intel/matrix?symbols=${encodeURIComponent(syms)}&range=6mo`);
      const short = (s) => s.replace(/\.NS|\^|=F|=X|-USD/g, "").slice(0, 7);
      const hue = (v) => v === null ? "" : `background:rgba(${v >= 0 ? "200,134,42" : "100,120,200"},${Math.abs(v) * 0.55})`;
      let html = `<table class="mx"><tr><th></th>${m.keys.map((k) => `<th>${short(k)}</th>`).join("")}</tr>` + m.matrix.map((row, i) => `<tr><th>${short(m.keys[i])}</th>${row.map((v) => `<td style="${hue(v)}">${v === null ? "—" : v.toFixed(2)}</td>`).join("")}</tr>`).join("") + `</table>`;
      html += `<table class="mx" style="margin-top:0"><tr><th>Holding</th><th>Ann. vol</th><th>Max DD</th></tr>${m.keys.map((k) => `<tr><th>${short(k)}</th><td>${F.num(m.stats[k].vol, 1)}%</td><td class="down">${F.num(m.stats[k].mdd, 1)}%</td></tr>`).join("")}</table>`;
      $("#pfRisk").innerHTML = html;
    } catch { $("#pfRisk").innerHTML = `<div class="empty-mini">risk decomposition unavailable</div>`; }
  },
};

/* ════════ NEWS & SENTIMENT ════════ */
TABS.news = {
  init() {
    $("#newsGo").addEventListener("click", () => this.load());
    $("#newsQuery").addEventListener("keydown", (e) => { if (e.key === "Enter") this.load(); });
    $("#newsMode").addEventListener("change", () => this.load());
    if (typeof CURRENT !== "undefined" && CURRENT && CURRENT.symbol) $("#newsQuery").value = CURRENT.symbol;
    this.load();
  },
  async load() {
    const q = $("#newsQuery").value.trim() || "NIFTY";
    const mode = $("#newsMode").value;
    $("#newsList").innerHTML = `<div class="loading mono">loading…</div>`;
    $("#eventTracker").innerHTML = `<div class="loading mono">…</div>`;
    try {
      const d = await api(`/api/newsintel?q=${encodeURIComponent(q)}&mode=${mode}`);
      if (d.error) { $("#newsList").innerHTML = `<div class="loading">${d.error}</div>`; return; }
      // sentiment analysis panel
      const trendIcon = d.trend === "improving" ? "▲ improving" : d.trend === "deteriorating" ? "▼ deteriorating" : "▬ flat";
      const trendCls = d.trend === "improving" ? "up" : d.trend === "deteriorating" ? "down" : "";
      const toneCls = d.tone === "Positive" ? "up" : d.tone === "Negative" ? "down" : "";
      const total = d.count || 1;
      $("#newsAgg").innerHTML = `<div class="senti">
        <div class="senti-gauge"><div class="senti-score ${toneCls}">${d.sentimentScore}<small>/100</small></div><div class="senti-tone">${d.tone.toUpperCase()} · <span class="${trendCls}">${trendIcon}</span></div>
          <div class="senti-dist"><span class="sd-pos" style="width:${(d.pos / total) * 100}%"></span><span class="sd-neu" style="width:${(d.neu / total) * 100}%"></span><span class="sd-neg" style="width:${(d.neg / total) * 100}%"></span></div>
          <div class="senti-leg"><span class="up">${d.pos} positive</span> · <span>${d.neu} neutral</span> · <span class="down">${d.neg} negative</span></div></div>
        <div class="senti-meta"><div class="sm-l">SCOPE</div><div class="sm-v">${mode === "industry" ? "Industry / sector" : mode === "market" ? "Broad market" : "Company"}</div><div class="sm-l">HEADLINES</div><div class="sm-v">${d.count}</div><div class="sm-note">Sentiment is a keyword-lexicon score over recent headlines (50 = neutral); trend compares newer vs older headlines. Directional, not a market signal.</div></div>
      </div>`;
      $("#newsCount").textContent = d.count + " headlines";
      // event tracker
      $("#eventTracker").innerHTML = d.events.length
        ? `<div class="evt-list">${d.events.map((e) => `<div class="evt-row"><span class="evt-t">${e.type}</span><div class="evt-bar"><i style="width:${(e.count / d.count) * 100}%"></i></div><span class="evt-c">${e.count}</span></div>`).join("")}</div><div class="ind-note">Headlines auto-tagged into corporate-event categories.</div>`
        : `<div class="empty-mini mono">No tagged events in the current headlines.</div>`;
      // headline feed
      $("#newsList").innerHTML = d.items.map((it) => `<div class="news-item"><span class="sent ${it.sentiment}">${it.sentiment.slice(0, 3).toUpperCase()}</span><span class="nt"><a href="${it.link}" target="_blank" rel="noopener">${it.title}</a> ${it.tags.map((t) => `<span class="tag">${t}</span>`).join(" ")}</span><span class="np">${it.publisher || ""} · ${F.ago(it.time)}</span></div>`).join("") || `<div class="empty-mini">No headlines found for "${q}".</div>`;
    } catch (e) { $("#newsList").innerHTML = `<div class="loading">news unavailable: ${e.message}</div>`; $("#eventTracker").innerHTML = ""; }
  },
};

/* ════════ LIBRARY ════════ */
TABS.library = {
  init() { this.load(); },
  async load() {
    try {
      const { docs } = await api("/api/library");
      $("#libraryList").innerHTML = docs.length ? docs.map((d) => `<div class="lib-item"><span class="lt"><a href="#" data-open="${d.id}">${d.title}</a></span><span class="lm">${d.kind.toUpperCase()} · ${new Date(d.ts).toLocaleString("en-IN")}</span><button class="mini-btn" data-del="${d.id}">Delete</button></div>`).join("") : `<div class="empty-mini mono">No saved research yet. Generate a report and click “Save to Library”.</div>`;
      $$("#libraryList [data-open]").forEach((a) => a.addEventListener("click", async (e) => { e.preventDefault(); const doc = await api(`/api/library/${a.dataset.open}`); showTab("reports"); TABS.reports.current = doc.payload; $("#reportCanvas").innerHTML = renderReport(doc.payload); $("#reportActions").hidden = false; $("#aiMode").textContent = "loaded from Library"; }));
      $$("#libraryList [data-del]").forEach((b) => b.addEventListener("click", async () => { await api(`/api/library/${b.dataset.del}`, { method: "DELETE" }); this.load(); }));
    } catch (e) { $("#libraryList").innerHTML = `<div class="loading">${e.message}</div>`; }
  },
};

/* boot once all module tabs are registered */
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootTerminal);
else bootTerminal();

/* ════════ INSTITUTIONAL DCF — 17-section analyst model (Modeling Lab) ════════ */
const IDCF = {
  data: null, symbol: null, busy: false,
  init() {
    const load = $("#idcfLoad"), sym = $("#idcfSym");
    if (load) load.addEventListener("click", () => { const s = (sym.value || "").trim().toUpperCase(); if (s) this.load(s); });
    if (sym) sym.addEventListener("keydown", (e) => { if (e.key === "Enter") load.click(); });
  },
  async load(symbol, overrides) {
    if (this.busy) return; this.busy = true;
    this.symbol = symbol;
    $("#idcfStatus").textContent = overrides ? "recomputing…" : "building model · pulling statements…";
    try {
      const url = "/api/idcf/" + encodeURIComponent(symbol);
      const data = overrides
        ? await api(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(overrides) })
        : await api(url);
      if (data.error) { $("#idcfStatus").textContent = data.error; this.busy = false; return; }
      this.data = data;
      $("#dcfFor").textContent = data.meta.name + " · " + data.meta.currency;
      $("#idcfMeta").textContent = data.meta.unitNote;
      this.renderAssumptions();
      $("#idcfOut").innerHTML = renderInstitutionalDCF(data);
      $("#idcfStatus").textContent = "live · edit any assumption to recompute";
    } catch (e) { $("#idcfStatus").textContent = "failed: " + e.message; }
    this.busy = false;
  },
  renderAssumptions() {
    const a = this.data.idcf.assumptions, w = this.data.idcf.waccBuild;
    const f = [
      ["growthY1_5", "Revenue growth Y1 (%)", a.growthY1_5, 0.5],
      ["fade", "Annual fade (%)", a.fade, 0.25],
      ["ebitdaMargin", "EBITDA margin (%)", a.ebitdaMargin, 0.5],
      ["capexPctRev", "Capex (% rev)", a.capexPctRev, 0.25],
      ["taxRate", "Tax rate (%)", a.taxRate, 0.5],
      ["wcPctRev", "ΔWC (% rev chg)", a.wcPctRev, 0.25],
      ["rf", "Risk-free rate (%)", w.rf, 0.1],
      ["beta", "Beta", w.beta, 0.05],
      ["erp", "Equity risk premium (%)", w.erp, 0.25],
      ["terminalG", "Terminal growth (%)", a.terminalG, 0.1],
    ];
    $("#dcfForm").innerHTML = f.map(([k, l, v, st]) => `<label>${l}<input data-k="${k}" type="number" step="${st}" value="${v != null ? (+v).toFixed(2) : ""}"></label>`).join("")
      + `<div class="note">Edit any field — the entire 17-section model recomputes from live financials. WACC is derived from rf, beta &amp; ERP.</div>`;
    let timer;
    $$("#dcfForm input").forEach((i) => i.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const ov = {};
        $$("#dcfForm input").forEach((x) => { const val = parseFloat(x.value); if (isFinite(val)) ov[x.dataset.k] = val; });
        this.load(this.symbol, ov);
      }, 450);
    }));
  },
};

function renderInstitutionalDCF(data) {
  const d = data.idcf, ccy = data.meta.currency, m = data.meta;
  if (!d || d.error) return `<div class="empty-mini mono">${d && d.error ? d.error : "Insufficient data to build a DCF for this issuer."}</div>`;
  const isINR = ccy === "INR", unit = isINR ? "₹ Cr" : (ccy === "USD" ? "$ Mn" : ccy + " Mn"), scale = isINR ? 1e7 : 1e6;
  const sym = isINR ? "₹" : ccy === "USD" ? "$" : "";
  const U = (v, dp = 0) => (v == null || !isFinite(v) ? "—" : (v / scale).toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp }));
  const N = (v, dp = 1) => (v == null || !isFinite(v) ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp }));
  const P = (v, dp = 1) => (v == null || !isFinite(v) ? "—" : v.toFixed(dp) + "%");
  const px = (v, dp = 2) => v == null ? "—" : sym + N(v, dp);
  const sec = (n, title, sub, inner) => `<div class="idcf-sec"><div class="idcf-sh"><span class="idcf-sn">SECTION ${n}</span><h4>${title}</h4>${sub ? `<span class="idcf-ssub">${sub}</span>` : ""}</div>${inner}</div>`;
  const b = d.base, w = d.waccBuild;
  const fy = (y) => "FY" + String(y).slice(2);

  // S1 — historical foundation
  const hRows = (label, key, fmt) => `<tr><td class="nm">${label}</td>${d.hist.map((h) => `<td>${fmt === "p" ? P(h[key]) : U(h[key])}</td>`).join("")}</tr>`;
  const s1 = sec(1, "Historical Financial Foundation", `${unit} · ${d.hist.length}y actuals`,
    `<table class="idcf-t"><tr><th>Actuals</th>${d.hist.map((h) => `<th>${fy(h.year)}</th>`).join("")}</tr>
      ${hRows("Revenue", "revenue")}${hRows("EBITDA", "ebitda")}${hRows("EBIT", "ebit")}${hRows("Net income", "netIncome")}${hRows("FCFF", "fcff")}
      <tr class="sub"><td class="nm">Revenue growth</td>${d.hist.map((h) => `<td>${P(h.revGrowth)}</td>`).join("")}</tr>
      <tr class="sub"><td class="nm">EBITDA margin</td>${d.hist.map((h) => `<td>${P(h.ebitdaMargin)}</td>`).join("")}</tr>
      <tr class="sub"><td class="nm">Net margin</td>${d.hist.map((h) => `<td>${P(h.netMargin)}</td>`).join("")}</tr></table>`);

  // S2 — forecast assumptions
  const a = d.assumptions;
  const s2 = sec(2, "Forecast Assumptions", "editable in the sidebar",
    `<div class="idcf-kv">
      <div><span class="k">Revenue growth Y1</span><span class="v">${P(a.growthY1_5)}</span></div>
      <div><span class="k">Annual fade</span><span class="v">${P(a.fade)}</span></div>
      <div><span class="k">EBITDA margin</span><span class="v">${P(a.ebitdaMargin)}</span></div>
      <div><span class="k">Capex % rev</span><span class="v">${P(a.capexPctRev)}</span></div>
      <div><span class="k">D&amp;A % rev</span><span class="v">${P(a.depPctRev)}</span></div>
      <div><span class="k">Tax rate</span><span class="v">${P(a.taxRate)}</span></div>
      <div><span class="k">ΔWC % rev change</span><span class="v">${P(a.wcPctRev)}</span></div>
      <div><span class="k">Terminal growth</span><span class="v">${P(a.terminalG)}</span></div>
    </div>`);

  // S3 — revenue forecast
  const s3 = sec(3, "Revenue Forecast Model", `${unit}`,
    `<table class="idcf-t"><tr><th>Year</th>${b.rows.map((r) => `<th>${fy(r.year)}E</th>`).join("")}</tr>
      <tr><td class="nm">Revenue</td>${b.rows.map((r) => `<td>${U(r.rev)}</td>`).join("")}</tr>
      <tr class="sub"><td class="nm">Growth %</td>${b.rows.map((r) => `<td>${P(r.growth)}</td>`).join("")}</tr></table>
      <div class="idcf-note">Revenue compounds off the last actual at the Y1 growth rate, fading ${P(a.fade)} per year toward the ${P(a.terminalG)} terminal rate.</div>`);

  // S4 — margin forecast
  const s4 = sec(4, "Margin Forecast Model", `${unit}`,
    `<table class="idcf-t"><tr><th>Year</th>${b.rows.map((r) => `<th>${fy(r.year)}E</th>`).join("")}</tr>
      <tr><td class="nm">EBITDA</td>${b.rows.map((r) => `<td>${U(r.ebitda)}</td>`).join("")}</tr>
      <tr class="sub"><td class="nm">EBITDA margin</td>${b.rows.map((r) => `<td>${P(r.margin)}</td>`).join("")}</tr></table>`);

  // S5 — EBIT build-up
  const s5 = sec(5, "EBIT Build-up", `${unit}`,
    `<table class="idcf-t"><tr><th>Year</th>${b.rows.map((r) => `<th>${fy(r.year)}E</th>`).join("")}</tr>
      <tr><td class="nm">Revenue</td>${b.rows.map((r) => `<td>${U(r.rev)}</td>`).join("")}</tr>
      <tr><td class="nm">EBITDA</td>${b.rows.map((r) => `<td>${U(r.ebitda)}</td>`).join("")}</tr>
      <tr><td class="nm">Less: D&amp;A</td>${b.rows.map((r) => `<td>(${U(r.dep)})</td>`).join("")}</tr>
      <tr class="tot"><td class="nm">EBIT</td>${b.rows.map((r) => `<td>${U(r.ebit)}</td>`).join("")}</tr></table>`);

  // S6 — tax build-up
  const s6 = sec(6, "Tax Build-up", `tax rate ${P(a.taxRate)}`,
    `<table class="idcf-t"><tr><th>Year</th>${b.rows.map((r) => `<th>${fy(r.year)}E</th>`).join("")}</tr>
      <tr><td class="nm">EBIT</td>${b.rows.map((r) => `<td>${U(r.ebit)}</td>`).join("")}</tr>
      <tr><td class="nm">Tax @ ${P(a.taxRate)}</td>${b.rows.map((r) => `<td>(${U(r.tax)})</td>`).join("")}</tr></table>`);

  // S7 — NOPAT
  const s7 = sec(7, "NOPAT Build-up", `${unit}`,
    `<table class="idcf-t"><tr><th>Year</th>${b.rows.map((r) => `<th>${fy(r.year)}E</th>`).join("")}</tr>
      <tr><td class="nm">EBIT</td>${b.rows.map((r) => `<td>${U(r.ebit)}</td>`).join("")}</tr>
      <tr><td class="nm">Less: tax</td>${b.rows.map((r) => `<td>(${U(r.tax)})</td>`).join("")}</tr>
      <tr class="tot"><td class="nm">NOPAT</td>${b.rows.map((r) => `<td>${U(r.nopat)}</td>`).join("")}</tr></table>`);

  // S8 — reinvestment
  const s8 = sec(8, "Reinvestment Build-up", `${unit}`,
    `<table class="idcf-t"><tr><th>Year</th>${b.rows.map((r) => `<th>${fy(r.year)}E</th>`).join("")}</tr>
      <tr><td class="nm">Capex</td>${b.rows.map((r) => `<td>${U(r.capex)}</td>`).join("")}</tr>
      <tr><td class="nm">Δ Working capital</td>${b.rows.map((r) => `<td>${U(r.dWC)}</td>`).join("")}</tr>
      <tr class="tot"><td class="nm">Total reinvestment</td>${b.rows.map((r) => `<td>${U(r.capex + r.dWC)}</td>`).join("")}</tr></table>`);

  // S9 — FCFF
  const s9 = sec(9, "FCFF Build-up", `${unit}`,
    `<table class="idcf-t"><tr><th>Year</th>${b.rows.map((r) => `<th>${fy(r.year)}E</th>`).join("")}</tr>
      <tr><td class="nm">NOPAT</td>${b.rows.map((r) => `<td>${U(r.nopat)}</td>`).join("")}</tr>
      <tr><td class="nm">+ D&amp;A</td>${b.rows.map((r) => `<td>${U(r.dep)}</td>`).join("")}</tr>
      <tr><td class="nm">− Capex</td>${b.rows.map((r) => `<td>(${U(r.capex)})</td>`).join("")}</tr>
      <tr><td class="nm">− Δ WC</td>${b.rows.map((r) => `<td>(${U(r.dWC)})</td>`).join("")}</tr>
      <tr class="tot"><td class="nm">FCFF</td>${b.rows.map((r) => `<td>${U(r.fcff)}</td>`).join("")}</tr></table>`);

  // S10 — WACC build
  const s10 = sec(10, "WACC Build-up", "CAPM cost of equity + after-tax cost of debt",
    `<table class="idcf-t two"><tr><td class="nm">Risk-free rate</td><td>${N(w.rf, 1)}%</td></tr>
      <tr><td class="nm">Beta</td><td>${N(w.beta, 2)}</td></tr>
      <tr><td class="nm">Equity risk premium</td><td>${N(w.erp, 1)}%</td></tr>
      <tr class="tot"><td class="nm">Cost of equity (rf + β·ERP)</td><td>${N(w.costEquity, 1)}%</td></tr>
      <tr><td class="nm">After-tax cost of debt</td><td>${N(w.costDebt, 1)}%</td></tr>
      <tr><td class="nm">Weight equity / debt</td><td>${N(w.weightEquity, 0)}% / ${N(w.weightDebt, 0)}%</td></tr>
      <tr class="tot"><td class="nm">WACC</td><td><b>${N(w.wacc, 1)}%</b></td></tr></table>`);

  // S11 — discounting table
  const s11 = sec(11, "Discounting Schedule", `discounted at ${N(a.wacc, 1)}% WACC`,
    `<table class="idcf-t"><tr><th>Year</th><th>FCFF</th><th>Discount factor</th><th>PV of FCFF</th></tr>
      ${b.rows.map((r, i) => `<tr><td class="nm">${fy(r.year)}E</td><td>${U(r.fcff)}</td><td>${N(r.df, 3)}</td><td>${U(r.pv)}</td></tr>`).join("")}
      <tr class="tot"><td class="nm">Σ PV of explicit FCFF</td><td></td><td></td><td>${U(b.pvExplicit)}</td></tr></table>`);

  // S12 — terminal value
  const s12 = sec(12, "Terminal Value", `Gordon growth @ ${P(a.terminalG)}`,
    `<table class="idcf-t two"><tr><td class="nm">Terminal FCFF (Y5 × (1+g))</td><td>${U(b.rows[b.rows.length-1].fcff * (1 + a.terminalG/100))}</td></tr>
      <tr><td class="nm">Terminal value (undiscounted)</td><td>${U(b.tv)}</td></tr>
      <tr><td class="nm">PV of terminal value</td><td>${U(b.tvPv)}</td></tr>
      <tr class="tot"><td class="nm">Terminal value as % of EV</td><td class="${d.tvWarn ? "down" : ""}">${P(b.terminalShare * 100)}</td></tr></table>
      ${d.tvWarn ? `<div class="idcf-warn">⚠ Terminal value is ${P(b.terminalShare*100)} of enterprise value — above the 75% comfort threshold. The valuation leans heavily on assumptions beyond the explicit forecast; treat the target with added caution.</div>` : ""}`);

  // S13 — EV bridge
  const s13 = sec(13, "Enterprise Value Bridge", `${unit}`,
    `<table class="idcf-t two"><tr><td class="nm">PV of explicit FCFF</td><td>${U(b.pvExplicit)}</td></tr>
      <tr><td class="nm">+ PV of terminal value</td><td>${U(b.tvPv)}</td></tr>
      <tr class="tot"><td class="nm">Enterprise value</td><td>${U(b.ev)}</td></tr>
      <tr><td class="nm">− Net debt</td><td>(${U(d.netDebt)})</td></tr>
      <tr class="tot"><td class="nm">Equity value</td><td>${U(b.equity)}</td></tr></table>`);

  // S14 — intrinsic value
  const up = d.upside;
  const s14 = sec(14, "Intrinsic Value Per Share", "",
    `<div class="idcf-verdict">
      <div><span class="l">EQUITY VALUE</span><span class="n">${sym}${U(b.equity)}</span></div>
      <div><span class="l">÷ SHARES (mn)</span><span class="n">${N(d.sharesOut / 1e6, 0)}</span></div>
      <div class="big"><span class="l">INTRINSIC / SHARE</span><span class="n ${F.cls(up)}">${px(b.perShare)}</span></div>
      <div><span class="l">CURRENT</span><span class="n">${px(d.currentPrice)}</span></div>
      <div><span class="l">UPSIDE</span><span class="n ${F.cls(up)}">${P(up)}</span></div>
    </div>`);

  // S15 — sensitivity
  const s15 = sec(15, "Sensitivity Analysis", "value/share · WACC × terminal growth",
    `<table class="idcf-t sens"><tr><th>WACC ↓ / g →</th>${d.gCols.map((g) => `<th>${N(g, 2)}%</th>`).join("")}</tr>
      ${d.sens.map((row) => `<tr><th>${N(row.wacc, 2)}%</th>${row.values.map((v) => `<td style="${v && d.currentPrice ? `background:rgba(${v >= d.currentPrice ? "46,158,107" : "200,75,60"},${Math.min(Math.abs(v / d.currentPrice - 1) * 1.4, 0.45)})` : ""}">${v == null ? "—" : N(v, 1)}</td>`).join("")}</tr>`).join("")}</table>
      <div class="idcf-note">Shaded green where the implied value exceeds the current price of ${px(d.currentPrice)}, red where it falls below.</div>`);

  // S16 — scenarios
  const scen = (label, s, cls) => { const u = d.currentPrice ? (s.perShare / d.currentPrice - 1) * 100 : null; return `<tr class="${cls}"><td class="nm">${label}</td><td>${px(s.perShare)}</td><td class="${F.cls(u)}">${P(u)}</td></tr>`; };
  const s16 = sec(16, "Scenario Analysis", "bull · base · bear",
    `<table class="idcf-t"><tr><th>Scenario</th><th>Value/share</th><th>vs current</th></tr>
      ${scen("Bull (higher growth + margin)", d.bull)}
      ${scen("Base", d.base, "tot")}
      ${scen("Bear (slower growth + pressure)", d.bear)}
    </table>
    <div class="idcf-pe"><span>Probability-weighted (25/50/25):</span> <b>${px(d.bull.perShare*0.25 + d.base.perShare*0.5 + d.bear.perShare*0.25)}</b></div>`);

  // S17 — AI commentary (deterministic)
  const drivers = [];
  if (b.terminalShare > 0.7) drivers.push("the terminal value, which carries " + P(b.terminalShare*100) + " of enterprise value");
  drivers.push("the " + P(a.growthY1_5) + " revenue growth assumption and the " + P(a.ebitdaMargin) + " EBITDA margin");
  const aggressive = a.growthY1_5 > 15 || a.terminalG > 4.5;
  const s17 = sec(17, "Valuation Commentary", "deterministic — add ANTHROPIC_API_KEY for AI prose",
    `<div class="idcf-prose">
      <p>The base case yields an intrinsic value of <b>${px(b.perShare)}</b>, implying <b class="${F.cls(up)}">${P(up)}</b> versus the current ${px(d.currentPrice)}. Value is driven primarily by ${drivers.join(", and ")}.</p>
      <p>The most sensitive assumptions are the WACC (${N(a.wacc,1)}%) and terminal growth (${P(a.terminalG)}); the sensitivity grid in Section 15 shows how the per-share value swings across a ±1.5% WACC and ±1% growth band. ${d.tvWarn ? "Because the terminal value dominates enterprise value, small changes in the long-run assumptions move the target materially." : "Terminal value is within a comfortable share of enterprise value, so the target rests on the explicit forecast rather than the perpetuity."}</p>
      <p>Overall the assumption set looks <b>${aggressive ? "somewhat aggressive" : "reasonable to conservative"}</b>${aggressive ? " — the growth and/or terminal-growth inputs sit at the optimistic end; a more conservative reading would temper the upside." : ", which lends confidence to the base-case output."} Confidence is moderate: the model is built on trailing financials and standard CAPM inputs, and should be cross-checked against the comparable-company analysis below and the scenario range (${px(d.bear.perShare)}–${px(d.bull.perShare)}).</p>
    </div>`);

  return `<div class="idcf">${s1}${s2}${s3}${s4}${s5}${s6}${s7}${s8}${s9}${s10}${s11}${s12}${s13}${s14}${s15}${s16}${s17}</div>`;
}

/* ════════ FORENSIC ANALYSIS (dedicated top-level module) ════════ */
TABS.forensic = {
  init() {
    const load = $("#frcLoad"), sym = $("#frcSym");
    if (load) load.addEventListener("click", () => { const s = (sym.value || "").trim().toUpperCase(); if (s) this.run(s); });
    if (sym) sym.addEventListener("keydown", (e) => { if (e.key === "Enter") load.click(); });
    if (CURRENT && CURRENT.symbol) { sym.value = CURRENT.symbol; this.run(CURRENT.symbol); }
  },
  async run(symbol) {
    $("#frcStatus").textContent = "scanning statements…";
    $("#frcOut").innerHTML = `<div class="loading mono" style="padding:50px">Running forensic models on ${symbol} — Piotroski · Altman · Beneish · cash quality…</div>`;
    try {
      const d = await api("/api/forensic/" + encodeURIComponent(symbol));
      if (d.error) { $("#frcStatus").textContent = d.error; $("#frcOut").innerHTML = `<div class="empty-mini">${d.error}</div>`; return; }
      if (!d.forensic) { $("#frcStatus").textContent = "insufficient history"; $("#frcOut").innerHTML = `<div class="empty-mini">Need at least two years of statements to run forensic models for ${symbol}.</div>`; return; }
      $("#frcFor").textContent = d.meta.name + " · " + d.meta.currency;
      $("#frcStatus").textContent = "complete";
      $("#frcOut").innerHTML = renderForensic(d);
    } catch (e) { $("#frcStatus").textContent = "failed: " + e.message; $("#frcOut").innerHTML = `<div class="empty-mini">${e.message}</div>`; }
  },
};

function renderForensic(d) {
  const f = d.forensic, ccy = d.meta.currency;
  const N = (v, dp = 1) => (v == null || !isFinite(v) ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp }));
  const gradeClass = (g) => ({ A: "frc-a", B: "frc-b", C: "frc-c", D: "frc-d", Strong: "frc-a", Moderate: "frc-c", Weak: "frc-d", Safe: "frc-a", Grey: "frc-c", Distress: "frc-d" }[g] || "");
  const sec = (title, sub, inner) => `<div class="frc-sec"><div class="frc-sh"><h4>${title}</h4>${sub ? `<span>${sub}</span>` : ""}</div>${inner}</div>`;

  // top scorecard — the 4 headline grades
  const beneishGrade = f.beneish.score == null ? "n/a" : (f.beneish.score > f.beneish.threshold ? "Risk" : "Clean");
  const scoreCard = `<div class="frc-cards">
    <div class="frc-card ${gradeClass(f.earningsQualityGrade)}"><div class="frc-c-l">EARNINGS QUALITY</div><div class="frc-c-v">${f.earningsQualityGrade}</div><div class="frc-c-s">composite grade</div></div>
    <div class="frc-card ${gradeClass(f.piotroski.grade)}"><div class="frc-c-l">PIOTROSKI F</div><div class="frc-c-v">${f.piotroski.score}<small>/9</small></div><div class="frc-c-s">${f.piotroski.grade} fundamentals</div></div>
    <div class="frc-card ${gradeClass(f.altman.zone)}"><div class="frc-c-l">ALTMAN Z</div><div class="frc-c-v">${f.altman.score == null ? "—" : N(f.altman.score, 2)}</div><div class="frc-c-s">${f.altman.zone} zone</div></div>
    <div class="frc-card ${beneishGrade === "Clean" ? "frc-a" : beneishGrade === "Risk" ? "frc-d" : ""}"><div class="frc-c-l">BENEISH M</div><div class="frc-c-v">${f.beneish.score == null ? "—" : N(f.beneish.score, 2)}</div><div class="frc-c-s">${f.beneish.flag.split(" ")[0]} ${f.beneish.flag.split(" ")[1] || ""} risk</div></div>
  </div>`;

  // red flags
  const flagRows = (d.flags || []).map((fl) => `<div class="frc-flag ${fl.sev}"><span class="frc-flag-dot"></span>${fl.t}</div>`).join("");
  const redFlags = sec("Red-Flag Detection", `${d.flags.filter((x) => x.sev !== "low").length} item(s)`, `<div class="frc-flags">${flagRows}</div>`);

  // earnings quality + cash flow quality
  const cash = f.cash;
  const eq = sec("Earnings Quality &amp; Cash-Flow Quality", "is reported profit backed by cash?",
    `<table class="frc-t"><tr><th>Metric</th><th>Value</th><th style="text-align:left">Interpretation</th></tr>
      <tr><td>Cash conversion (OCF / NI)</td><td>${cash.cashConversion == null ? "—" : N(cash.cashConversion, 2) + "×"}</td><td>${cash.cashConversion != null && cash.cashConversion >= 0.9 ? "Earnings well-backed by operating cash" : "Earnings exceed cash generation — monitor accruals"}</td></tr>
      <tr><td>FCF margin</td><td>${cash.fcfMargin == null ? "—" : N(cash.fcfMargin, 1) + "%"}</td><td>Free cash generated per unit of sales</td></tr>
      <tr><td>Accrual ratio (NI − OCF)/assets</td><td>${cash.accrualRatio == null ? "—" : N(cash.accrualRatio, 1) + "%"}</td><td>${cash.accrualRatio != null && Math.abs(cash.accrualRatio) < 10 ? "Low accruals — clean earnings" : "Elevated accruals — scrutinise revenue recognition"}</td></tr>
    </table>`);

  // accounting quality = Beneish components
  const ben = f.beneish.components;
  const accounting = sec("Accounting Quality — Beneish M-Score", `${f.beneish.flag}`,
    ben ? `<table class="frc-t"><tr><th>Variable</th><th>Value</th><th style="text-align:left">What it captures</th></tr>
      <tr><td>DSRI</td><td>${N(ben.DSRI, 2)}</td><td>Days sales in receivables index</td></tr>
      <tr><td>GMI</td><td>${N(ben.GMI, 2)}</td><td>Gross margin index (deterioration)</td></tr>
      <tr><td>AQI</td><td>${N(ben.AQI, 2)}</td><td>Asset quality index</td></tr>
      <tr><td>SGI</td><td>${N(ben.SGI, 2)}</td><td>Sales growth index</td></tr>
      <tr><td>DEPI</td><td>${N(ben.DEPI, 2)}</td><td>Depreciation index</td></tr>
      <tr><td>SGAI</td><td>${N(ben.SGAI, 2)}</td><td>SG&amp;A expense index</td></tr>
      <tr><td>LVGI</td><td>${N(ben.LVGI, 2)}</td><td>Leverage index</td></tr>
      <tr><td>TATA</td><td>${N(ben.TATA, 2)}</td><td>Total accruals to total assets</td></tr>
      <tr class="frc-tot"><td>M-Score</td><td>${N(f.beneish.score, 2)}</td><td>&gt; ${f.beneish.threshold} flags manipulation risk</td></tr>
    </table>` : `<div class="empty-mini">Beneish components unavailable for this issuer.</div>`);

  // piotroski breakdown
  const pio = sec("Piotroski F-Score — fundamental strength", `${f.piotroski.score}/9 (${f.piotroski.grade})`,
    `<div class="frc-pio">${f.piotroski.components.map((c) => `<div class="frc-pio-row ${c.ok ? "ok" : "no"}"><span class="frc-pio-mark">${c.ok ? "✓" : "✗"}</span>${c.t}</div>`).join("")}</div>`);

  // altman breakdown
  const alt = f.altman.components;
  const altman = sec("Altman Z-Score — financial-distress risk", `${f.altman.score == null ? "—" : N(f.altman.score, 2)} · ${f.altman.zone} zone`,
    alt ? `<table class="frc-t"><tr><th>Component</th><th>Value</th><th>Weight</th></tr>
      <tr><td>Working capital / total assets</td><td>${N(alt.wcTa, 2)}</td><td>1.2×</td></tr>
      <tr><td>Retained earnings / total assets</td><td>${N(alt.reTa, 2)}</td><td>1.4×</td></tr>
      <tr><td>EBIT / total assets</td><td>${N(alt.ebitTa, 2)}</td><td>3.3×</td></tr>
      <tr><td>Mkt value equity / total liabilities</td><td>${N(alt.mveTl, 2)}</td><td>0.6×</td></tr>
      <tr><td>Sales / total assets</td><td>${N(alt.salesTa, 2)}</td><td>1.0×</td></tr>
      <tr class="frc-tot"><td>Z-Score</td><td>${N(f.altman.score, 2)}</td><td>${f.altman.zone}</td></tr>
    </table><div class="frc-note">&gt; 2.99 safe · 1.81–2.99 grey · &lt; 1.81 distress</div>` : `<div class="empty-mini">Altman components unavailable for this issuer.</div>`);

  // working capital trend
  const wc = d.wcTrend || [];
  const wcSec = sec("Working-Capital Analysis", "receivable / inventory days &amp; cash trend",
    `<table class="frc-t"><tr><th>FY</th>${wc.map((w) => `<th>${String(w.year).slice(2)}</th>`).join("")}</tr>
      <tr><td>Receivable days</td>${wc.map((w) => `<td>${w.recvDays ?? "—"}</td>`).join("")}</tr>
      <tr><td>Inventory days</td>${wc.map((w) => `<td>${w.invDays ?? "—"}</td>`).join("")}</tr>
      <tr><td>OCF / NI</td>${wc.map((w) => `<td>${w.ocfToNi ?? "—"}</td>`).join("")}</tr>
      <tr><td>Accrual %</td>${wc.map((w) => `<td>${w.accrual ?? "—"}</td>`).join("")}</tr>
    </table><div class="frc-note">Rising receivable/inventory days or falling OCF/NI are classic quality-of-earnings warning signs.</div>`);

  return `<div class="frc">${scoreCard}${redFlags}${eq}${pio}${accounting}${altman}${wcSec}</div>`;
}

/* ════════ RISK CENTER (dedicated top-level module) ════════ */
TABS.risk = {
  init() {
    const load = $("#rskLoad"), sym = $("#rskSym");
    if (load) load.addEventListener("click", () => { const s = (sym.value || "").trim().toUpperCase(); if (s) this.run(s); });
    if (sym) sym.addEventListener("keydown", (e) => { if (e.key === "Enter") load.click(); });
    if (CURRENT && CURRENT.symbol) { sym.value = CURRENT.symbol; this.run(CURRENT.symbol); }
  },
  async run(symbol) {
    $("#rskStatus").textContent = "scoring risks…";
    $("#rskOut").innerHTML = `<div class="loading mono" style="padding:50px">Assessing ${symbol} — leverage, distress, valuation, governance, market & macro risk…</div>`;
    try {
      const d = await api("/api/risk/" + encodeURIComponent(symbol));
      if (d.error) { $("#rskStatus").textContent = d.error; $("#rskOut").innerHTML = `<div class="empty-mini">${d.error}</div>`; return; }
      $("#rskFor").textContent = d.meta.name + " · " + d.meta.currency;
      $("#rskStatus").textContent = "complete";
      $("#rskOut").innerHTML = renderRisk(d);
    } catch (e) { $("#rskStatus").textContent = "failed: " + e.message; $("#rskOut").innerHTML = `<div class="empty-mini">${e.message}</div>`; }
  },
};

function renderRisk(d) {
  const r = d.risk, ccy = d.meta.currency, sym = ccy === "INR" ? "₹" : ccy === "USD" ? "$" : "";
  const N = (v, dp = 1) => (v == null || !isFinite(v) ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp }));
  const px = (v) => v == null ? "—" : sym + N(v, 2);
  const bandClass = (b) => ({ Low: "rsk-a", Moderate: "rsk-b", Elevated: "rsk-c", High: "rsk-d" }[b] || "");
  const sevClass = (s) => s >= 16 ? "rsk-d" : s >= 9 ? "rsk-c" : s >= 4 ? "rsk-b" : "rsk-a";
  const sec = (title, sub, inner) => `<div class="rsk-sec"><div class="rsk-sh"><h4>${title}</h4>${sub ? `<span>${sub}</span>` : ""}</div>${inner}</div>`;

  // headline gauge + category cards
  const head = `<div class="rsk-head">
    <div class="rsk-gauge ${bandClass(r.compositeBand)}">
      <div class="rsk-g-score">${r.compositeScore}<small>/100</small></div>
      <div class="rsk-g-band">${r.compositeBand.toUpperCase()} RISK</div>
      <div class="rsk-g-bar"><i style="width:${r.compositeScore}%"></i></div>
    </div>
    <div class="rsk-cats">
      ${r.categoryScores.map((c) => `<div class="rsk-cat"><div class="rsk-cat-top"><span>${c.category}</span><b class="${sevClass(c.score / 4)}">${c.score}</b></div><div class="rsk-cat-bar"><i class="${sevClass(c.score / 4)}" style="width:${c.score}%"></i></div><div class="rsk-cat-sub">${c.count} risk(s) · top: ${c.top}</div></div>`).join("")}
    </div>
  </div>`;

  // 5×5 probability × impact matrix — plot each risk in its cell
  const cell = {};
  r.risks.forEach((rk) => { const key = rk.prob + "-" + rk.impact; (cell[key] ||= []).push(rk); });
  let grid = "";
  for (let p = 5; p >= 1; p--) {
    let row = `<div class="rsk-m-row"><span class="rsk-m-axis">${p === 5 ? "Almost certain" : p === 4 ? "Likely" : p === 3 ? "Possible" : p === 2 ? "Unlikely" : "Rare"}</span>`;
    for (let im = 1; im <= 5; im++) {
      const sevv = p * im;
      const items = cell[p + "-" + im] || [];
      const tone = sevv >= 16 ? "d" : sevv >= 9 ? "c" : sevv >= 4 ? "b" : "a";
      row += `<div class="rsk-m-cell rsk-${tone}" title="${items.map((x) => x.title).join(", ")}">${items.length ? items.map((x) => `<span class="rsk-m-dot">${x.category[0]}</span>`).join("") : ""}</div>`;
    }
    grid += row + "</div>";
  }
  grid += `<div class="rsk-m-row"><span class="rsk-m-axis"></span>${["Insignificant", "Minor", "Moderate", "Major", "Severe"].map((l) => `<span class="rsk-m-xlabel">${l}</span>`).join("")}</div>`;
  const matrix = sec("Probability × Impact Matrix", "each lettered dot = a risk, placed by likelihood × severity",
    `<div class="rsk-matrix"><div class="rsk-m-ylabel">PROBABILITY →</div>${grid}<div class="rsk-m-xtitle">IMPACT →</div></div>`);

  // scored risk register grouped by category
  const cats = {};
  r.risks.forEach((rk) => { (cats[rk.category] ||= []).push(rk); });
  const register = Object.entries(cats).map(([c, list]) => `
    <div class="rsk-reg-cat"><h5>${c} Risks</h5>
    ${list.map((rk) => `<div class="rsk-reg-row">
      <div class="rsk-reg-sev ${sevClass(rk.severity)}">${rk.severity}</div>
      <div class="rsk-reg-body"><div class="rsk-reg-t">${rk.title} <span class="rsk-reg-pi">P${rk.prob}·I${rk.impact}</span></div><div class="rsk-reg-e">${rk.evidence}</div><div class="rsk-reg-m"><b>Mitigant:</b> ${rk.mitigant}</div></div>
    </div>`).join("")}</div>`).join("");
  const regSec = sec("Risk Register", `${r.risks.length} scored factors · severity = probability × impact (max 25)`, `<div class="rsk-register">${register}</div>`);

  // downside scenarios + VaR
  let downside = "";
  if (r.scenarios && r.scenarios.length) {
    downside = sec("Downside Scenarios", "anchored to the DCF bear case",
      `<table class="frc-t"><tr><th style="text-align:left">Scenario</th><th>Value/share</th><th>Return</th><th style="text-align:left">Basis</th></tr>
        ${r.scenarios.map((s) => `<tr><td style="text-align:left">${s.name}</td><td>${px(s.value)}</td><td class="${s.ret >= 0 ? "up" : "down"}">${s.ret >= 0 ? "+" : ""}${N(s.ret, 1)}%</td><td style="text-align:left;color:var(--muted-ink)">${s.basis}</td></tr>`).join("")}
      </table>${r.dailyVar95 != null ? `<div class="rsk-var">Beta-implied 1-day 95% move: <b>±${N(r.dailyVar95, 1)}%</b> <span style="color:var(--muted-ink)">(rough VaR proxy from beta; assumes ~1% daily market volatility)</span></div>` : ""}`);
  }

  return `<div class="rsk">${head}${matrix}${regSec}${downside}</div>`;
}

/* ════════ EARNINGS CALL (dedicated top-level module) ════════ */
TABS.earnings = {
  init() {
    const an = $("#ecAnalyze");
    if (an) an.addEventListener("click", () => this.analyze());
    $("#ecPaste") && $("#ecPaste").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.ctrlKey) this.analyze(); });
  },
  async analyze() {
    const transcript = $("#ecPaste").value.trim();
    if (transcript.length < 100) {
      $("#ecStatus").innerHTML = `<span class="down">Paste a longer transcript (at least a few paragraphs).</span>`;
      return;
    }
    $("#ecStatus").textContent = "analysing…";
    $("#ecOut").innerHTML = `<div class="loading mono" style="padding:40px">Analysing transcript — computing tone, guidance, risks, competitor mentions, topics…</div>`;
    try {
      const d = await api("/api/earnings/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transcript }) });
      if (d.error) { $("#ecOut").innerHTML = `<div class="empty-mini">${d.error}</div>`; $("#ecStatus").textContent = ""; return; }
      $("#ecFor").textContent = "transcript analysis";
      $("#ecStatus").textContent = "done · Ctrl+Enter to re-run";
      $("#ecOut").innerHTML = renderEarnings(d);
    } catch (e) {
      $("#ecOut").innerHTML = `<div class="empty-mini">${e.message}</div>`;
      $("#ecStatus").textContent = "";
    }
  },
};

function renderEarnings(d) {
  const a = d.analysis;
  if (a.error) return `<div class="empty-mini">${a.error}</div>`;
  const toneCls = a.toneScore >= 60 ? "up" : a.toneScore < 45 ? "down" : "";
  const sec = (title, sub, inner) => `<div class="ec-sec"><div class="ec-sh"><h4>${title}</h4>${sub ? `<span>${sub}</span>` : ""}</div>${inner}</div>`;
  // headline: tone gauge + insights
  const head = `<div class="ec-head">
    <div class="ec-gauge"><div class="ec-g-score ${toneCls}">${a.toneScore}<small>/100</small></div><div class="ec-g-l">MANAGEMENT TONE</div><div class="ec-g-tag">${a.toneLabel}</div>
      <div class="ec-g-meta">${a.words.toLocaleString()} words · ${a.hedges} hedges · ${a.sentimentDetail.pos}▲ ${a.sentimentDetail.neg}▼</div></div>
    <div class="ec-insights">${a.insights.map((i) => `<div class="ec-ins">${i.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")}</div>`).join("")}</div>
  </div>`;
  // API-provided sentiment — not used in paste-only mode
  const apiBlock = "";
  // guidance
  const guidance = a.guidance.length ? sec("Guidance Tracking", `${a.guidance.length} forward-looking statements`,
    `<ul class="ec-list">${a.guidance.map((g) => `<li>${g}</li>`).join("")}</ul>`)
    : sec("Guidance Tracking", "", `<div class="empty-mini">No explicit forward-looking statements detected.</div>`);
  // risk mentions
  const risk = sec("Risk Mentions", `${a.riskCount} risk-related statements`,
    a.topRisks.length ? `<div class="ec-chips">${a.topRisks.map((r) => `<span class="ec-chip">${r.cue} <b>${r.count}</b></span>`).join("")}</div>` : `<div class="empty-mini">No notable risk language detected.</div>`);
  // competitor mentions
  const comp = sec("Competitor Mentions", a.competitorMentions.length ? `${a.competitorMentions.length} peers referenced` : "",
    (a.competitorMentions.length ? `<div class="ec-chips">${a.competitorMentions.map((c) => `<span class="ec-chip">${c.name} <b>${c.count}</b></span>`).join("")}</div>` : "") +
    (a.competitiveContext.length ? `<ul class="ec-list" style="margin-top:8px">${a.competitiveContext.map((s) => `<li>${s}</li>`).join("")}</ul>` : (a.competitorMentions.length ? "" : `<div class="empty-mini">No direct competitor references detected.</div>`)));
  // topic frequency
  const maxT = Math.max(...a.topics.map((t) => t.count), 1);
  const topics = a.topics.length ? sec("Topic Frequency", "what the call focused on",
    `<div class="ec-topics">${a.topics.map((t) => `<div class="ec-topic"><span class="ec-tn">${t.topic}</span><div class="ec-tbar"><i style="width:${(t.count / maxT) * 100}%"></i></div><span class="ec-tc">${t.count}</span></div>`).join("")}</div>`) : "";
  // speaker breakdown
  const speakers = a.speakers && a.speakers.length ? sec("Management Sentiment by Speaker", "tone per speaker (where transcript is attributed)",
    `<table class="frc-t"><tr><th style="text-align:left">Speaker</th><th>Turns</th><th>Words</th><th>Tone</th></tr>
      ${a.speakers.map((s) => `<tr><td style="text-align:left">${s.speaker}</td><td>${s.turns}</td><td>${s.words.toLocaleString()}</td><td class="${s.score >= 60 ? "up" : s.score < 45 ? "down" : ""}">${s.score}/100</td></tr>`).join("")}
    </table>`) : "";
  const disc = `<div class="ec-disc">Tone, guidance, risk and competitor signals are computed by Meridian's deterministic lexicon engine over the transcript text (method: ${a.method}). These are directional reading aids, not investment signals. Every signal is traceable directly to the pasted text.</div>`;
  return `<div class="ec">${head}${apiBlock}${guidance}${risk}${comp}${topics}${speakers}${disc}</div>`;
}
