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
    PEER_CUSTOM = null; // fresh company → back to auto-suggested peer set
    renderWorkstation(co);
    loadPeers(symbol);
    loadSegments(co.symbol); // Business Segment Analysis (renders only when data exists)
    fillModelsFromCompany(co);
    // ── persistent company context ──
    if (typeof MRD_RECENTS !== "undefined") MRD_RECENTS.push(co.symbol, co.name);
    if (typeof WATCH !== "undefined") WATCH.syncStar();
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

  /* ── reporting-unit standardisation ──
     INR issuers → ₹ Crore; everything else → millions of the reporting
     currency. One scale used across statements, KPI strips, segments and
     capital allocation so the whole workstation reads in one unit. */
  const { unit, scale } = ersUnits(ccy);
  const U = (v, dp = 0) => (v == null || !Number.isFinite(v) ? "—" : (v / scale).toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp }));

  const block = (title, sub, inner) => `<div class="panel section-block grow"><div class="panel-h"><h3>${title}</h3>${sub ? `<span class="panel-sub mono">${sub}</span>` : ""}</div>${inner}</div>`;

  const head = `
    <div class="co-head">
      <div><h2>${co.name}</h2><div class="co-sym">${co.symbol} · ${co.exchange} · ${co.profile.sector || ""}${co.profile.industry ? " · " + co.profile.industry : ""}</div></div>
      <button class="ws-watch mono" id="wsWatchBtn" type="button">☆ Watch</button>
      <button class="ws-watch mono" id="wsWorkbookBtn" type="button" title="Download the consolidated research workbook — statements, ratios, DuPont, valuation, forensic, risk, peers and ownership in one Excel file">⬇ Workbook</button>
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

  // overview + business — full description (expandable, never truncated with "…")
  const overviewBody = `<div class="co-overview-row">
      <div class="co-text">${kv}${ersProse(co.profile.summary, 620)}${(co.profile.officers.length ? `<div class="prose"><strong>Key management:</strong> ${co.profile.officers.map((o) => `${esc(o.name)}${o.title ? " (" + esc(o.title) + ")" : ""}`).join(" · ")}</div>` : "")}</div>
      <div class="co-chart"><div id="researchPriceChart"></div></div>
    </div>`;
  const overview = block("COMPANY OVERVIEW", co.profile.country, overviewBody);

  // ── INVESTMENT HIGHLIGHTS — executive summary, 5–8 institutional bullets ──
  const highlights = (() => {
    const items = ersHighlights(co);
    if (items.length < 3) return "";
    return block("INVESTMENT HIGHLIGHTS", "executive summary · computed from live data",
      `<ul class="ih-list">${items.map((x) => `<li>${x}</li>`).join("")}</ul>`);
  })();

  // ── FINANCIAL STATEMENT ANALYSIS — tabbed, one statement at a time ──
  const fin = ersStatementsPanel(co, { U, unit, yrs, block });

  // ratio library (now includes the extended valuation set from the server)
  const ratioCards = Object.entries(ratioByGroup).map(([g, list]) => list.map((r, i) => {
    const series = co.series[ { "ROE": "roe", "ROCE": "roce", "Net margin": "netMargin", "EBITDA margin": "opMargin" }[r.name] ];
    return `<div class="ratio-card"><div class="rg">${g.toUpperCase()}</div><div class="rn">${r.name}</div><div class="rv">${r.fmt === "pct" ? F.num(r.value, 1) + "%" : r.fmt === "x" ? F.x(r.value, 2) : r.fmt === "days" ? F.num(r.value, 0) + "d" : F.num(r.value, 2)}</div>${series ? `<canvas class="rspark" data-key="${r.name}"></canvas>` : ""}<div class="ri">${r.note}</div></div>`;
  }).join("")).join("");
  const ratios = block("RATIO ANALYSIS", "current value · trend · interpretation", `<div class="ratio-grid">${ratioCards}</div>`);

  // positioning — customisable peer group (search · add · remove · max 10)
  const positioning = block("COMPETITIVE POSITIONING &amp; PEERS", "customisable peer set · up to 10 comparables",
    `<div class="peer-tools" id="peerTools"></div><div id="peerBlock"><div class="loading mono">selecting peers…</div></div>`);

  // ── BUSINESS ANALYSIS ──
  const biz = (() => {
    const inc = s.income, g = co.growth;
    const latest = inc.at(-1) || {}, prior = inc.at(-2) || {};
    const grossM = latest.revenue ? (latest.grossProfit / latest.revenue) * 100 : null;
    const opM = latest.revenue ? (latest.opIncome / latest.revenue) * 100 : null;
    const netM = latest.revenue ? (latest.netIncome / latest.revenue) * 100 : null;
    // revenue bridge: decompose YoY change into the drivers we can observe (volume/price proxy via revenue, margin mix)
    const revChg = (latest.revenue ?? 0) - (prior.revenue ?? 0);
    const revBridge = `<table class="dt"><tr><th>Revenue bridge (latest yr)</th><th>${unit}</th></tr>
      <tr><td class="nm">Prior-year revenue</td><td>${U(prior.revenue)}</td></tr>
      <tr><td class="nm">Δ Revenue (organic + price + mix)</td><td class="${revChg >= 0 ? "up" : "down"}">${revChg >= 0 ? "+" : ""}${U(revChg)}</td></tr>
      <tr><td class="nm">Current-year revenue</td><td>${U(latest.revenue)}</td></tr>
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
      `${ersProse(co.profile.summary, 520)}
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

  // ── OWNERSHIP ANALYSIS — quality chart · summary · thesis ──
  // Holder-level tables render ONLY when the provider actually returns data;
  // no empty visualisations (per spec §11).
  const own = (() => {
    const o = co.ownership || {};
    const inst = co.holders.institutions, ins = co.holders.insiders;
    const ni = o.netInsider || {};
    const fmtSh = (v) => v == null ? "—" : v >= 1e9 ? (v / 1e9).toFixed(2) + "B" : v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : F.num(v, 0);
    const hasStructure = inst != null || ins != null;
    if (!hasStructure && !(o.topInstitutions || []).length && !(o.insiders || []).length) {
      return block("OWNERSHIP ANALYSIS", "ownership structure",
        `<div class="prose">Ownership disclosure is not available from the data provider for this issuer. For Indian listings, the shareholding pattern filed quarterly with the exchanges (promoter, FII, DII, public split) is the authoritative source.</div>`);
    }
    const structure = hasStructure ? `<div class="own-split">
      ${inst != null ? `<div class="own-seg"><div class="own-bar"><i style="width:${Math.min(inst, 100)}%"></i></div><div class="own-lbl">Institutions <b>${F.num(inst, 1)}%</b></div></div>` : ""}
      ${ins != null ? `<div class="own-seg"><div class="own-bar amber"><i style="width:${Math.min(ins, 100)}%"></i></div><div class="own-lbl">Insiders / promoters <b>${F.num(ins, 1)}%</b></div></div>` : ""}
    </div>` : "";
    // ── ownership quality chart (component-scored, bq-bar visual) ──
    const comp = [];
    if (inst != null) comp.push(["Institutional depth", inst > 50 ? 40 : inst > 25 ? 28 : 15, 40, F.num(inst, 1) + "% held"]);
    if (ins != null) comp.push(["Insider / promoter alignment", ins > 25 ? 35 : ins > 5 ? 22 : 8, 35, F.num(ins, 1) + "% held"]);
    if (ni.netPct != null) comp.push(["Net insider activity (" + (ni.period || "6m") + ")", ni.netPct >= 0 ? 25 : 5, 25, (ni.netPct >= 0 ? "+" : "") + F.num(ni.netPct, 2) + "%"]);
    const oq = comp.reduce((a, c) => a + c[1], 0), oqMax = comp.reduce((a, c) => a + c[2], 0) || 1;
    const oqPct = Math.round((oq / oqMax) * 100);
    const oGrade = oqPct >= 75 ? "Strong" : oqPct >= 50 ? "Solid" : oqPct >= 30 ? "Moderate" : "Weak";
    const qualityChart = comp.length ? `<div class="bq-score"><div class="bq-l">OWNERSHIP QUALITY</div><div class="bq-v">${oqPct}<small>/100</small> · ${oGrade}</div>
      <div class="bq-bars">${comp.map(([l, v, mx, d]) => `<div class="bq-bar"><span class="bq-bn">${l}</span><div class="bq-track"><i style="width:${(v / mx) * 100}%"></i></div><span class="bq-bd">${d}</span></div>`).join("")}</div></div>` : "";
    // ── short ownership summary ──
    const sm = [];
    if (ins != null) sm.push(`Insiders and promoters hold ${F.num(ins, 1)}% of the equity — ${ins > 40 ? "a controlling stake that keeps decision-making concentrated" : ins > 15 ? "meaningful skin in the game" : "a limited direct stake"}.`);
    if (inst != null) sm.push(`Institutional investors own ${F.num(inst, 1)}%${inst > 40 ? ", deep professional sponsorship that supports liquidity and governance scrutiny" : inst > 15 ? ", a moderate institutional base" : ", a thin institutional footprint typical of closely-held or under-covered names"}.`);
    if (ni.netPct != null) sm.push(`Net insider activity over the last ${ni.period || "6m"} was ${ni.netPct >= 0 ? "positive" : "negative"} at ${(ni.netPct >= 0 ? "+" : "")}${F.num(ni.netPct, 2)}% of insider shares — ${ni.netPct >= 0 ? "insiders added on balance" : "insiders reduced on balance, worth monitoring against the fundamental picture"}.`);
    const summary = sm.length ? `<div class="panel-sub mono" style="margin-top:12px">OWNERSHIP SUMMARY</div><div class="prose">${sm.join(" ")}</div>` : "";
    // ── institutional ownership thesis ──
    const thesis = (() => {
      const t = [];
      if (inst != null && ins != null) {
        if (inst > 40 && ins > 20) t.push("The register combines a committed promoter/insider block with deep institutional sponsorship — the configuration most associated with durable governance and patient capital.");
        else if (inst > 40) t.push("Ownership is institution-led: price discovery is efficient and governance scrutiny high, but the register can turn over quickly around earnings surprises.");
        else if (ins > 40) t.push("Ownership is promoter-led: alignment is high and control stable, though free float and institutional validation are correspondingly lighter.");
        else t.push("Neither insiders nor institutions dominate the register — a dispersed base that offers liquidity but less anchored sponsorship.");
      }
      if (ni.netPct != null) t.push(ni.netPct >= 0 ? "Recent insider accumulation is a mild positive confirmation signal." : "Recent net insider selling argues for confirming the fundamental thesis before adding.");
      return t.length ? `<div class="panel-sub mono" style="margin-top:12px">INSTITUTIONAL OWNERSHIP THESIS</div><div class="prose">${t.join(" ")}</div>` : "";
    })();
    // ── holder tables — only when real rows exist ──
    const instRows = (o.topInstitutions || []).filter((i) => i.name).map((i) => `<tr><td class="nm" style="text-align:left">${esc(i.name)}</td><td>${i.pct == null ? "—" : F.num(i.pct, 2) + "%"}</td><td>${fmtSh(i.shares)}</td><td class="${i.change >= 0 ? "up" : "down"}">${i.change == null ? "—" : (i.change >= 0 ? "+" : "") + F.num(i.change, 1) + "%"}</td></tr>`).join("");
    const insRows = (o.insiders || []).filter((h) => h.name).map((h) => `<tr><td class="nm" style="text-align:left">${esc(h.name)}</td><td style="text-align:left;color:var(--muted)">${esc(h.relation)}</td><td>${fmtSh(h.shares)}</td><td style="color:var(--muted)">${h.latest || "—"}</td></tr>`).join("");
    return block("OWNERSHIP ANALYSIS", `${o.instCount ? o.instCount + " institutional holders" : "ownership structure"}`,
      structure + qualityChart + summary + thesis +
      (instRows ? `<div class="panel-sub mono" style="margin-top:12px">TOP INSTITUTIONAL HOLDERS</div><table class="dt"><tr><th style="text-align:left">Holder</th><th>% held</th><th>Shares</th><th>Δ</th></tr>${instRows}</table>` : "") +
      (insRows ? `<div class="panel-sub mono" style="margin-top:12px">INSIDER HOLDERS</div><table class="dt"><tr><th style="text-align:left">Name</th><th style="text-align:left">Relation</th><th>Shares</th><th>Latest</th></tr>${insRows}</table>` : ""));
  })();

  // ── NEW SECTIONS (spec §13) ──
  const hist = ersHistoricalSnapshot(co, { U, unit, block });
  const capalloc = ersCapitalAllocation(co, { U, unit, block });
  const drivers = ersGrowthDrivers(co, { block });
  const risks = ersKeyRisks(co, { block });

  const dup = ersDuPontPanel(co, { block });
  $("#researchBody").innerHTML = head + overview + highlights + biz +
    `<div id="segMount"></div>` + hist + mgmt + moat + own + fin + ratios + dup +
    capalloc + drivers + risks + positioning;

  // wire the ☆ Watch toggle + reflect current state
  const wBtn = $("#wsWatchBtn");
  if (wBtn && typeof WATCH !== "undefined") {
    wBtn.addEventListener("click", () => WATCH.toggle(co.symbol, co.name));
    WATCH.syncStar();
  }
  // consolidated Excel research workbook (server-built, styled like the model export)
  const xBtn = $("#wsWorkbookBtn");
  if (xBtn) xBtn.addEventListener("click", () => {
    xBtn.textContent = "⬇ Building…"; xBtn.disabled = true;
    const a = document.createElement("a");
    a.href = `/api/company/${encodeURIComponent(co.symbol)}/workbook`;
    a.download = "";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => { xBtn.textContent = "⬇ Workbook"; xBtn.disabled = false; }, 6000);
  });

  // wire statement tabs + expandable prose (single delegated handler)
  ersWireEvents();

  // draw charts
  requestAnimationFrame(() => {
    lineChart($("#cRev"), co.series.revenue.map((p) => p.v));
    lineChart($("#cNi"), co.series.netIncome.map((p) => p.v));
    $$(".rspark").forEach((cv) => {
      const map = { "ROE": "roe", "ROCE": "roce", "Net margin": "netMargin", "EBITDA margin": "opMargin" }[cv.dataset.key];
      if (map && co.series[map]) lineChart(cv, co.series[map].map((p) => p.v), { fill: false, lw: 1.2, color: "200,134,42" });
    });
    $$(".hp-spark").forEach((cv) => {
      const ser = ERS_SPARKS[cv.dataset.hk];
      if (ser && ser.filter((v) => v != null).length >= 2) lineChart(cv, ser, { fill: false, lw: 1.2, color: "200,134,42" });
    });
    // Mount the interactive compact price chart in the Company Overview
    if (typeof mountPriceChart === "function") {
      mountPriceChart({ containerId: "researchPriceChart", symbol: co.symbol, defaultRange: "1Y", compact: true, height: 240, liveRefresh: true });
    }
    revealSections();
  });
}

/* ── Equity Research helpers ─────────────────────────────────────────────── */

function ersUnits(ccy) {
  if (ccy === "INR") return { unit: "₹ Cr", scale: 1e7 };
  if (ccy === "USD") return { unit: "US$ Mn", scale: 1e6 };
  return { unit: (ccy ? ccy + " " : "") + "Mn", scale: 1e6 };
}

/* Full-length, expandable business description — never cut off with "…".
   Long texts collapse to a preview with a Read more toggle; the full text is
   rendered as readable paragraphs. */
function ersProse(text, limit = 650) {
  if (!text) return `<div class="prose">No business description available.</div>`;
  const paras = (() => {
    const sents = text.split(/(?<=\.)\s+(?=[A-Z0-9])/);
    const out = []; let cur = "";
    sents.forEach((sn) => { cur += (cur ? " " : "") + sn; if (cur.length > 430) { out.push(cur); cur = ""; } });
    if (cur) out.push(cur);
    return out.map((p) => `<p>${p}</p>`).join("");
  })();
  if (text.length <= limit) return `<div class="prose">${paras}</div>`;
  const short = text.slice(0, limit).replace(/\s+\S*$/, "");
  return `<div class="prose ers-xp"><span class="xp-short">${short}… </span><span class="xp-full" hidden>${paras}</span><button class="xp-toggle" type="button">Read more ▾</button></div>`;
}

/* Rule-based YoY variance commentary — deterministic, per line item. */
function ersReason(id, y, ctx = {}) {
  if (y == null || !Number.isFinite(y)) return "—";
  const f = (v) => Math.abs(v).toFixed(1);
  const flat = Math.abs(y) < 2;
  switch (id) {
    // income statement
    case "revenue": return y > 12 ? "Strong demand — higher sales volume and better product mix/realisations." : y > 4 ? "Steady volume-led growth with stable pricing." : y >= 0 ? "Broadly flat sales; demand held but pricing was muted." : y > -8 ? "Softer demand or pricing pressure weighed on the top line." : "Sharp revenue contraction — volume loss and/or price deflation.";
    case "cogs": return ctx.rev == null ? (y >= 0 ? "Input costs rose with activity levels." : "Input costs eased.") : y < ctx.rev ? "Input costs grew slower than sales — favourable costs or mix aided gross margin." : "Input-cost inflation outpaced revenue growth, compressing gross margin.";
    case "grossProfit": return ctx.rev == null ? "Moved with sales and input costs." : y > ctx.rev ? "Gross margin expanded — pricing power or softer input costs." : y < ctx.rev ? "Gross margin compressed — cost inflation or weaker mix." : "Gross profit tracked revenue; margin held.";
    case "sga": return ctx.rev != null && y > ctx.rev ? "Overheads grew faster than sales — investment phase or cost slippage." : "Operating cost discipline; overheads grew slower than sales.";
    case "otherOpExp": return flat ? "Other operating costs broadly stable." : y > 0 ? "Higher other operating expenses." : "Lower other operating expenses.";
    case "opIncome": case "ebit": return ctx.rev == null ? (y >= 0 ? "Operating profit improved." : "Operating profit declined.") : y > ctx.rev ? "Positive operating leverage — profit grew faster than sales." : y >= 0 ? "Operating profit grew, though slower than revenue." : "Negative operating leverage — costs absorbed the revenue line.";
    case "ebitda": return ctx.rev == null ? (y >= 0 ? "Core profitability improved." : "Core profitability softened.") : y > ctx.rev ? "EBITDA margin expanded on mix and cost control." : y >= 0 ? "EBITDA grew broadly in line with sales." : "EBITDA margin compressed on cost pressure.";
    case "dep": return y > 8 ? "Higher D&A from the recent capex/asset additions." : y < -8 ? "Lower D&A as older assets fully depreciated." : "Depreciation charge broadly steady.";
    case "interest": return y > 10 ? "Higher interest burden — increased borrowings and/or rates." : y < -10 ? "Interest cost fell on deleveraging or refinancing." : "Financing cost broadly stable.";
    case "pretax": return y >= 0 ? "Pre-tax profit rose with the operating performance above." : "Pre-tax profit fell with operating pressure and financing costs.";
    case "tax": return ctx.pretax != null ? (y > ctx.pretax + 3 ? "Effective tax rate rose year over year." : y < ctx.pretax - 3 ? "Effective tax rate eased year over year." : "Tax moved in line with pre-tax profit.") : "Tax expense tracked profitability.";
    case "netIncome": return ctx.rev == null ? (y >= 0 ? "Bottom line improved." : "Bottom line declined.") : y > ctx.rev ? "Earnings outgrew revenue — margin expansion and operating leverage." : y >= 0 ? "Earnings grew, trailing the top line." : "Earnings declined on margin compression below the revenue line.";
    case "eps": return y >= 0 ? "Per-share earnings rose with net profit." : "Per-share earnings fell with net profit.";
    // balance sheet
    case "assets": return y > 10 ? "Balance-sheet expansion — capacity build and working-capital growth." : y >= 0 ? "Modest asset growth in line with the business." : "Asset base contracted — divestments or depreciation outpaced additions.";
    case "currentAssets": return flat ? "Working-capital assets broadly stable." : y > 0 ? "Higher current assets with business activity." : "Current assets released as the cycle tightened.";
    case "cash": return y > 15 ? "Cash built up from operating generation and/or fund raising." : y < -15 ? "Cash deployed into capex, investments or distributions." : "Cash position broadly steady.";
    case "receivables": return ctx.rev != null ? (y > ctx.rev + 5 ? "Receivables outgrew sales — collection cycle stretched; watch DSO." : y < ctx.rev - 5 ? "Receivables grew slower than sales — tighter collections." : "Receivables moved with sales.") : "Moved with billing activity.";
    case "inventory": return ctx.rev != null ? (y > ctx.rev + 5 ? "Inventory built ahead of sales — demand bet or slower offtake." : y < ctx.rev - 5 ? "Inventory turned faster than sales growth." : "Inventory tracked activity levels.") : "Tracked activity levels.";
    case "ppe": return y > 10 ? "Fixed-asset base expanded — capacity investment." : y < -5 ? "Net block shrank as depreciation exceeded additions." : "Net block broadly stable.";
    case "totalLiabilities": return y >= 0 ? "Liabilities rose with balance-sheet growth and funding needs." : "Liabilities reduced — deleveraging and payables normalisation.";
    case "currentLiab": return flat ? "Short-term obligations broadly stable." : y > 0 ? "Higher short-term obligations with activity." : "Short-term obligations reduced.";
    case "stDebt": case "ltDebt": return y > 10 ? "Fresh borrowings raised — funding growth or refinancing." : y < -10 ? "Debt repaid — active deleveraging." : "Borrowing levels broadly unchanged.";
    case "payables": return ctx.rev != null && y > ctx.rev + 5 ? "Payables stretched — supplier credit funding working capital." : "Payables moved with purchases.";
    case "equity": return y >= 0 ? "Net worth accreted via retained earnings (and any issuance)." : "Net worth declined — losses, buybacks or distributions exceeded earnings.";
    case "shareCapital": return flat ? "No material change in paid-up capital." : y > 0 ? "Capital raised via fresh issuance." : "Capital reduced via buyback/cancellation.";
    case "reserves": return y >= 0 ? "Reserves & surplus built through retained profit." : "Reserves drawn down by losses or distributions.";
    // cash flow
    case "cfNetIncome": return y >= 0 ? "Starting profit base improved." : "Starting profit base declined.";
    case "wc": return "Working-capital swing reflects the receivables/inventory/payables cycle above.";
    case "deferredTax": return "Timing differences between book and cash taxes.";
    case "stockComp": return y >= 0 ? "Higher non-cash share-based pay." : "Lower non-cash share-based pay.";
    case "otherOp": return "Residual non-cash and one-off operating adjustments (computed plug).";
    case "ocf": return ctx.ni != null ? (y > ctx.ni ? "Cash generation outpaced earnings growth — high conversion quality." : y >= 0 ? "Operating cash grew, slightly behind earnings." : "Operating cash fell — working capital absorbed earnings.") : (y >= 0 ? "Operating cash generation improved." : "Operating cash generation weakened.");
    case "capex": return y > 15 ? "Capex cycle stepped up — capacity/asset build under way." : y < -15 ? "Capex moderated after the recent investment phase." : "Sustained, steady reinvestment.";
    case "acquisitions": return y >= 0 ? "Inorganic spend on business acquisitions." : "Lower acquisition outlay than prior year.";
    case "investPur": return "Treasury/strategic investments purchased.";
    case "investSold": return "Investments monetised during the year.";
    case "assetSales": return "Proceeds from disposal of fixed assets.";
    case "otherInv": return "Residual investing items (computed plug).";
    case "investCF": return y <= 0 ? "Higher investing outflow — deployment into assets and investments." : "Lower net investing outflow than prior year.";
    case "debtIssued": return y >= 0 ? "Higher fresh borrowings drawn." : "Lower reliance on new borrowings.";
    case "debtRepaid": return y >= 0 ? "Accelerated repayments — deleveraging." : "Slower repayment schedule.";
    case "buybacks": return "Capital returned via share repurchases.";
    case "dividends": return y > 5 ? "Dividend outgo raised — confidence in cash generation." : y < -5 ? "Dividend outgo reduced." : "Dividend broadly maintained.";
    case "equityIssue": return "Equity capital raised during the year.";
    case "otherFin": return "Residual financing items incl. leases/interest (computed plug).";
    case "finCF": return "Net of debt drawdowns, repayments and shareholder distributions.";
    case "netChange": return y >= 0 ? "Net cash build across the three activities." : "Net cash draw across the three activities.";
    case "fcf": return y >= 0 ? "Free cash flow improved — operations funded capex with surplus." : "Free cash flow weakened — capex and working capital absorbed operating cash.";
    default: return flat ? "Broadly stable year over year." : y > 0 ? "Increase of " + f(y) + "% year over year." : "Decrease of " + f(y) + "% year over year.";
  }
}

/* ── Tabbed financial statements with YoY %, variance commentary & KPI strips ── */
function ersStatementsPanel(co, { U, unit, yrs, block }) {
  const inner = ersStatementsInner(co, { U, unit, yrs });
  const charts = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--hairline);margin-top:1px">
      <div style="background:var(--ink-2);padding:12px 16px"><div class="panel-sub mono">REVENUE TREND (${unit})</div><canvas class="chart sm" id="cRev"></canvas></div>
      <div style="background:var(--ink-2);padding:12px 16px"><div class="panel-sub mono">NET INCOME TREND (${unit})</div><canvas class="chart sm" id="cNi"></canvas></div>
    </div>`;
  return block("FINANCIAL STATEMENT ANALYSIS", `annual · ${co.statements.income.length || 0} years · all figures in ${unit} · YoY variance integrated`, `<div id="ersStmtsWrap">${inner}</div>` + charts);
}

/* Common-size toggle — re-renders the statements (not the trend charts),
   preserving the active statement tab. Income & cash flow re-base to % of
   revenue; the balance sheet re-bases to % of total assets. */
window.__ersCS = false;
function ersToggleCS() {
  if (typeof CURRENT === "undefined" || !CURRENT) return;
  window.__ersCS = !window.__ersCS;
  const wrap = $("#ersStmtsWrap"); if (!wrap) return;
  const active = wrap.querySelector(".ers-pane.is-active")?.dataset.ersPane || "income";
  const { unit, scale } = ersUnits(CURRENT.currency);
  const U = (v, dp = 0) => (v == null || !Number.isFinite(v) ? "—" : (v / scale).toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp }));
  const yrs = CURRENT.statements.income.map((r) => r.year);
  wrap.innerHTML = ersStatementsInner(CURRENT, { U, unit, yrs });
  wrap.querySelectorAll(".iffm-tab[data-ers-tab]").forEach((b) => b.classList.toggle("is-active", b.dataset.ersTab === active));
  wrap.querySelectorAll(".ers-pane").forEach((pn) => pn.classList.toggle("is-active", pn.dataset.ersPane === active));
}

function ersStatementsInner(co, { U, unit, yrs }) {
  const s = co.statements;
  const inc = s.income, bal = s.balance, cf = s.cashflow;
  const byYear = (arr) => Object.fromEntries(arr.map((r) => [r.year, r]));
  const cfBy = byYear(cf), incBy = byYear(inc), balBy = byYear(bal);
  const years = yrs;
  const n2 = (v) => (v == null || !Number.isFinite(v) ? null : v);
  const yoy = (cur, prev) => (n2(cur) != null && n2(prev) != null && prev !== 0 ? ((cur - prev) / Math.abs(prev)) * 100 : null);

  // shared row renderer: label | FY columns | YoY % | CAGR | commentary
  // line: { id, label, val(yearRow-idx)->number, strong, indent, outflow, fmt, betterHigh }
  // csBase(i): common-size denominator per year (revenue / total assets);
  //            when window.__ersCS is on, cells render as % of that base.
  const cs = typeof window !== "undefined" && window.__ersCS;
  const nCagrYrs = years.length - 1;
  const cagrOf = (vals) => {
    const first = vals.find((v) => n2(v) != null && v > 0);
    const lastV = [...vals].reverse().find((v) => n2(v) != null && v > 0);
    const i0 = vals.indexOf(first), i1 = vals.lastIndexOf(lastV);
    if (first == null || lastV == null || i1 - i0 < 2) return null;
    return (Math.pow(lastV / first, 1 / (i1 - i0)) - 1) * 100;
  };
  const table = (lines, ctxOf, csBase) => {
    const live = lines.filter((L) => L.sec || years.some((y, i) => n2(L.val(i)) != null));
    const cols = years.length + 4;
    const body = live.map((L) => {
      if (L.sec) return `<tr class="ers-sec"><td colspan="${cols}">${L.label}</td></tr>`;
      const vals = years.map((y, i) => L.val(i));
      const csOn = cs && csBase && L.fmt !== "eps";
      const csVals = csOn ? years.map((y, i) => { const b = n2(csBase(i)); const v = n2(vals[i]); return b && v != null ? (v / b) * 100 : null; }) : null;
      const yv = csOn
        ? (n2(csVals.at(-1)) != null && n2(csVals.at(-2)) != null ? csVals.at(-1) - csVals.at(-2) : null)
        : yoy(vals.at(-1), vals.at(-2));
      const cg = cagrOf(vals);
      const ctx = ctxOf ? ctxOf(L.id) : {};
      const yvAbs = yoy(vals.at(-1), vals.at(-2)); // commentary always reads the absolute move
      const cls = yv == null || L.betterHigh == null ? "" : (yv >= 0) === (L.betterHigh !== false) ? "up" : "down";
      const fmtCell = (v, i) => {
        if (n2(v) == null) return "—";
        if (csOn) { const c = csVals[i]; return c == null ? "—" : c.toFixed(1) + "%"; }
        if (L.fmt === "eps") return v.toFixed(2);
        if (L.outflow && v > 0) return `(${U(v)})`;
        return U(v);
      };
      return `<tr class="${L.strong ? "ers-strong" : ""}">
        <td class="nm" style="${L.indent ? "padding-left:" + (12 + L.indent * 14) + "px" : ""}">${L.label}</td>
        ${vals.map((v, i) => `<td>${fmtCell(v, i)}</td>`).join("")}
        <td class="ers-yoy ${cls}">${yv == null ? "—" : (yv >= 0 ? "+" : "") + yv.toFixed(1) + (csOn ? "pp" : "%")}</td>
        <td class="ers-yoy">${cg == null ? "—" : (cg >= 0 ? "+" : "") + cg.toFixed(1) + "%"}</td>
        <td class="ers-note">${ersReason(L.id, yvAbs, ctx)}</td>
      </tr>`;
    }).join("");
    return `<div class="table-wrap"><table class="dt ers-t">
      <tr><th>(${cs ? (csBase === undefined ? unit : "common-size %") : unit})</th>${years.map((y) => `<th>FY${String(y).slice(2)}</th>`).join("")}<th>${cs && csBase ? "YoY Δpp" : "YoY %"}</th><th>CAGR ${nCagrYrs}y</th><th class="ers-note-h">Variance commentary</th></tr>
      ${body}</table></div>`;
  };

  // year-wise KPI strip (compact, below the statement)
  const kpiStrip = (title, rows) => `<div class="ers-kpi">
    <div class="panel-sub mono" style="padding:10px 2px 6px">${title}</div>
    <div class="table-wrap"><table class="dt ers-kpi-t"><tr><th></th>${years.map((y) => `<th>FY${String(y).slice(2)}</th>`).join("")}</tr>
    ${rows.map(([l, vals, fmt]) => `<tr><td class="nm">${l}</td>${vals.map((v) => `<td>${v == null || !Number.isFinite(v) ? "—" : fmt === "x" ? v.toFixed(2) + "×" : fmt === "u" ? U(v) : v.toFixed(1) + "%"}</td>`).join("")}</tr>`).join("")}
    </table></div></div>`;

  /* ── INCOME STATEMENT ── */
  const I = (i, k) => n2(inc[i]?.[k]);
  const revYoY = yoy(I(years.length - 1, "revenue"), I(years.length - 2, "revenue"));
  const pretaxYoY = yoy(I(years.length - 1, "pretax"), I(years.length - 2, "pretax"));
  const incCtx = () => ({ rev: revYoY, pretax: pretaxYoY });
  const incomeLines = [
    { id: "revenue", label: "Revenue", val: (i) => I(i, "revenue"), strong: true, betterHigh: true },
    { id: "cogs", label: "Cost of Revenue (COGS)", val: (i) => I(i, "cogs"), betterHigh: false },
    { id: "grossProfit", label: "Gross Profit", val: (i) => I(i, "grossProfit"), strong: true, betterHigh: true },
    { id: "sga", label: "Selling &amp; Administrative", val: (i) => I(i, "sga"), indent: 1, betterHigh: false },
    { id: "otherOpExp", label: "Other Operating Expenses", val: (i) => I(i, "otherOpExp"), indent: 1, betterHigh: false },
    { id: "ebitda", label: "EBITDA", val: (i) => I(i, "ebitda"), strong: true, betterHigh: true },
    { id: "dep", label: "Depreciation &amp; Amortization", val: (i) => n2(cfBy[years[i]]?.dep), betterHigh: null },
    { id: "opIncome", label: "Operating Income (EBIT)", val: (i) => I(i, "opIncome") ?? I(i, "ebit"), strong: true, betterHigh: true },
    { id: "interest", label: "Interest Expense", val: (i) => I(i, "interest"), betterHigh: false },
    { id: "pretax", label: "Profit Before Tax", val: (i) => I(i, "pretax"), betterHigh: true },
    { id: "tax", label: "Tax Expense", val: (i) => I(i, "tax"), betterHigh: null },
    { id: "netIncome", label: "Net Income", val: (i) => I(i, "netIncome"), strong: true, betterHigh: true },
    { id: "eps", label: "Basic EPS", val: (i) => I(i, "basicEPS"), fmt: "eps", betterHigh: true },
  ];
  const margin = (i, k) => (I(i, "revenue") ? ((k === "gross" ? I(i, "grossProfit") : k === "ebitda" ? I(i, "ebitda") : k === "ebit" ? (I(i, "opIncome") ?? I(i, "ebit")) : I(i, "netIncome")) / I(i, "revenue")) * 100 : null);
  const incomeKpi = kpiStrip("MARGIN PROFILE · YEAR-WISE", [
    ["Gross Margin", years.map((_, i) => margin(i, "gross")), "pct"],
    ["EBITDA Margin", years.map((_, i) => margin(i, "ebitda")), "pct"],
    ["EBIT Margin", years.map((_, i) => margin(i, "ebit")), "pct"],
    ["Net Profit Margin", years.map((_, i) => margin(i, "net")), "pct"],
  ]);

  /* ── BALANCE SHEET (same layout, enriched with YoY + KPI strip) ── */
  const B = (i, k) => n2(bal[i]?.[k]);
  const balCtx = () => ({ rev: revYoY });
  const balanceLines = [
    { id: "assets", label: "Total Assets", val: (i) => B(i, "assets"), strong: true, betterHigh: null },
    { id: "currentAssets", label: "Current Assets", val: (i) => B(i, "currentAssets"), betterHigh: null },
    { id: "cash", label: "Cash &amp; Equivalents", val: (i) => B(i, "cash"), indent: 1, betterHigh: true },
    { id: "receivables", label: "Receivables", val: (i) => B(i, "receivables"), indent: 1, betterHigh: null },
    { id: "inventory", label: "Inventory", val: (i) => B(i, "inventory"), indent: 1, betterHigh: null },
    { id: "ppe", label: "Net PP&amp;E", val: (i) => B(i, "ppe"), betterHigh: null },
    { id: "totalLiabilities", label: "Total Liabilities", val: (i) => B(i, "totalLiabilities"), strong: true, betterHigh: false },
    { id: "currentLiab", label: "Current Liabilities", val: (i) => B(i, "currentLiab"), betterHigh: null },
    { id: "stDebt", label: "Short-Term Debt", val: (i) => B(i, "stDebt"), indent: 1, betterHigh: false },
    { id: "payables", label: "Accounts Payable", val: (i) => B(i, "payables"), indent: 1, betterHigh: null },
    { id: "ltDebt", label: "Long-Term Debt", val: (i) => B(i, "ltDebt"), betterHigh: false },
    { id: "equity", label: "Total Equity", val: (i) => B(i, "equity"), strong: true, betterHigh: true },
    { id: "shareCapital", label: "Share Capital", val: (i) => B(i, "shareCapital"), indent: 1, betterHigh: null },
    // Indian convention: Reserves & Surplus as the aggregate plug (equity − share capital)
    { id: "reserves", label: "Reserves &amp; Surplus", val: (i) => (B(i, "equity") != null && B(i, "shareCapital") != null ? B(i, "equity") - B(i, "shareCapital") : null), indent: 1, betterHigh: true },
  ];
  const bsKpi = kpiStrip("LIQUIDITY · LEVERAGE · EFFICIENCY — YEAR-WISE", [
    ["Current Ratio", years.map((_, i) => (B(i, "currentAssets") && B(i, "currentLiab") ? B(i, "currentAssets") / B(i, "currentLiab") : null)), "x"],
    ["Debt to Equity", years.map((_, i) => (B(i, "equity") ? ((B(i, "ltDebt") || 0) + (B(i, "stDebt") || 0)) / B(i, "equity") : null)), "x"],
    [`Working Capital (${unit})`, years.map((_, i) => (B(i, "currentAssets") != null && B(i, "currentLiab") != null ? B(i, "currentAssets") - B(i, "currentLiab") : null)), "u"],
    ["Asset Turnover", years.map((_, i) => (B(i, "assets") && I(i, "revenue") ? I(i, "revenue") / B(i, "assets") : null)), "x"],
  ]);

  /* ── CASH FLOW — detailed, Modeling-Lab depth, with plug-based "Other" rows ── */
  const C = (i, k) => n2(cfBy[years[i]]?.[k]);
  const NI = (i) => I(i, "netIncome");
  const z = (v) => (v == null ? 0 : v);
  const otherOp = (i) => (C(i, "ocf") != null && NI(i) != null ? C(i, "ocf") - (NI(i) + z(C(i, "dep")) + z(C(i, "wcChange")) + z(C(i, "deferredTax")) + z(C(i, "stockComp"))) : null);
  const otherInv = (i) => (C(i, "investingCF") != null ? C(i, "investingCF") - (-z(C(i, "capex")) - z(C(i, "acquisitions")) - z(C(i, "investmentsPurchased")) + z(C(i, "investmentsSold")) + z(C(i, "fixedAssetsSold"))) : null);
  const otherFin = (i) => (C(i, "financingCF") != null ? C(i, "financingCF") - (z(C(i, "debtIssued")) - z(C(i, "debtRepaid")) - z(C(i, "buybacks")) - z(C(i, "dividends")) + z(C(i, "proceedsFromShares"))) : null);
  const netChg = (i) => C(i, "netChange") ?? (C(i, "endingCash") != null && C(i, "beginningCash") != null ? C(i, "endingCash") - C(i, "beginningCash") : null);
  const ocfYoY = yoy(C(years.length - 1, "ocf"), C(years.length - 2, "ocf"));
  const niYoY = yoy(NI(years.length - 1), NI(years.length - 2));
  const cfCtx = (id) => (id === "ocf" ? { ni: niYoY } : {});
  const cashflowLines = [
    { sec: true, label: "OPERATING ACTIVITIES" },
    { id: "cfNetIncome", label: "Net Income", val: NI, betterHigh: true },
    { id: "dep", label: "Depreciation &amp; Amortization", val: (i) => C(i, "dep"), betterHigh: null },
    { id: "wc", label: "Working Capital Changes", val: (i) => C(i, "wcChange"), betterHigh: null },
    { id: "deferredTax", label: "Deferred Taxes", val: (i) => C(i, "deferredTax"), betterHigh: null },
    { id: "stockComp", label: "Stock Compensation", val: (i) => C(i, "stockComp"), betterHigh: null },
    { id: "otherOp", label: "Other Operating Items", val: otherOp, betterHigh: null },
    { id: "ocf", label: "Cash from Operations", val: (i) => C(i, "ocf"), strong: true, betterHigh: true },
    { sec: true, label: "INVESTING ACTIVITIES" },
    { id: "capex", label: "Capital Expenditure", val: (i) => C(i, "capex"), outflow: true, betterHigh: null },
    { id: "acquisitions", label: "Acquisitions", val: (i) => C(i, "acquisitions"), outflow: true, betterHigh: null },
    { id: "investPur", label: "Investments Purchased", val: (i) => C(i, "investmentsPurchased"), outflow: true, betterHigh: null },
    { id: "investSold", label: "Investments Sold", val: (i) => C(i, "investmentsSold"), betterHigh: null },
    { id: "assetSales", label: "Asset Sales", val: (i) => C(i, "fixedAssetsSold"), betterHigh: null },
    { id: "otherInv", label: "Other Investing Items", val: otherInv, betterHigh: null },
    { id: "investCF", label: "Cash from Investing", val: (i) => C(i, "investingCF"), strong: true, betterHigh: null },
    { sec: true, label: "FINANCING ACTIVITIES" },
    { id: "debtIssued", label: "Debt Issued", val: (i) => C(i, "debtIssued"), betterHigh: null },
    { id: "debtRepaid", label: "Debt Repaid", val: (i) => C(i, "debtRepaid"), outflow: true, betterHigh: null },
    { id: "buybacks", label: "Share Buybacks", val: (i) => C(i, "buybacks"), outflow: true, betterHigh: null },
    { id: "dividends", label: "Dividends Paid", val: (i) => C(i, "dividends"), outflow: true, betterHigh: null },
    { id: "equityIssue", label: "Equity Issuance", val: (i) => C(i, "proceedsFromShares"), betterHigh: null },
    { id: "otherFin", label: "Other Financing Items", val: otherFin, betterHigh: null },
    { id: "finCF", label: "Cash from Financing", val: (i) => C(i, "financingCF"), strong: true, betterHigh: null },
    { sec: true, label: "CASH RECONCILIATION" },
    { id: "beginCash", label: "Beginning Cash", val: (i) => C(i, "beginningCash"), betterHigh: null },
    { id: "netChange", label: "Net Change in Cash", val: netChg, betterHigh: true },
    { id: "endCash", label: "Ending Cash", val: (i) => C(i, "endingCash"), strong: true, betterHigh: true },
    { id: "fcf", label: "Free Cash Flow (OCF − Capex)", val: (i) => C(i, "fcf"), strong: true, betterHigh: true },
  ];

  const panes = `
    <div class="iffm-tabs" id="ersTabs">
      <button class="iffm-tab is-active" data-ers-tab="income" type="button">Income Statement</button>
      <button class="iffm-tab" data-ers-tab="balance" type="button">Balance Sheet</button>
      <button class="iffm-tab" data-ers-tab="cashflow" type="button">Cash Flow</button>
      <button class="iffm-tab ers-cs-btn ${cs ? "is-on" : ""}" data-ers-cs type="button" title="Income & cash flow as % of revenue · balance sheet as % of total assets">${cs ? "◼ Common-size ON" : "◻ Common-size"}</button>
    </div>
    <div class="iffm-pane ers-pane is-active" data-ers-pane="income">${table(incomeLines, incCtx, (i) => I(i, "revenue"))}${incomeKpi}</div>
    <div class="iffm-pane ers-pane" data-ers-pane="balance">${table(balanceLines, balCtx, (i) => B(i, "assets"))}${bsKpi}</div>
    <div class="iffm-pane ers-pane" data-ers-pane="cashflow">${table(cashflowLines, cfCtx, (i) => I(i, "revenue"))}</div>`;

  return panes;
}

/* ── DuPont decomposition — 3-stage per fiscal year + exact YoY attribution ── */
function ersDuPontPanel(co, { block }) {
  const d = co.dupont;
  if (!d || !d.rows || !d.rows.length) return "";
  const rows = d.rows;
  const N = (v, dp = 2) => (v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp }));
  const P = (v, dp = 1) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(dp) + "%");
  const fy = (y) => "FY" + String(y).slice(2);
  const line = (label, key, fmt, strong) => `<tr class="${strong ? "ers-strong" : ""}"><td class="nm">${label}</td>${rows.map((r) => `<td>${fmt === "pct" ? P(r[key]) : N(r[key])}${fmt === "x" ? "×" : ""}</td>`).join("")}</tr>`;
  const tbl = `<div class="table-wrap"><table class="dt ers-t">
    <tr><th></th>${rows.map((r) => `<th>${fy(r.year)}</th>`).join("")}</tr>
    ${line("Net margin", "netMargin", "pct")}
    ${line("× Asset turnover", "turnover", "x")}
    ${line("× Equity multiplier (leverage)", "leverage", "x")}
    ${line("= Return on Equity", "roe", "pct", true)}
    <tr class="ers-sec"><td colspan="${rows.length + 1}">5-STAGE EXTENSION</td></tr>
    ${line("Tax burden (NI / PBT)", "taxBurden", "x")}
    ${line("Interest burden (PBT / EBIT)", "intBurden", "x")}
    ${line("EBIT margin", "ebitMargin", "pct")}
  </table></div>`;
  const a = d.attribution;
  const attr = a ? (() => {
    const parts = [["margin", a.marginPp], ["asset turnover", a.turnoverPp], ["leverage", a.leveragePp]]
      .sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
    const word = (v) => (v >= 0 ? "+" : "") + v.toFixed(1) + "pp";
    return `<div class="prose">ROE moved <b class="${a.roeDeltaPp >= 0 ? "up" : "down"}">${word(a.roeDeltaPp)}</b> from FY${String(a.fromYear).slice(2)} to FY${String(a.toYear).slice(2)}. Exact attribution: ${parts.map(([n2, v]) => `<b>${word(v)}</b> from ${n2}`).join(", ")}. ${Math.abs(parts[0][1]) > Math.abs(a.roeDeltaPp) * 0.6 ? `The move is dominated by ${parts[0][0]} — ${parts[0][0] === "leverage" ? "a financing effect, not an operating improvement; returns bought with balance-sheet risk deserve a lower quality weighting." : "an operating effect, the highest-quality source of ROE change."}` : "The change is broad-based across the three levers rather than driven by a single factor."}</div>`;
  })() : "";
  return block("DUPONT ANALYSIS", "ROE = margin × turnover × leverage · computed from reported statements",
    tbl + attr + `<div class="prose" style="color:var(--muted)">DuPont separates <em>why</em> the company earns its ROE: pricing/cost power (margin), capital intensity (turnover) and financing (leverage). Two companies with the same ROE can have very different quality — margin- and turnover-driven returns compound safely; leverage-driven returns are cyclical and fragile.</div>`);
}

/* ── Investment Highlights (5–8 rule-based institutional bullets) ── */
function ersHighlights(co) {
  const g = co.growth || {};
  const r = (nm) => co.ratios.find((x) => x.name === nm)?.value;
  const roce = r("ROCE"), nm = r("Net margin"), de = r("Debt / Equity"), pe = r("P/E (TTM)"), dy = r("Dividend yield"), fcfy = r("FCF yield"), icov = r("Interest coverage");
  const items = [];
  const B = (t, s) => `<b>${t}</b> — ${s}`;
  if (roce != null) items.push(roce > 18 ? B("Superior capital efficiency", `${roce.toFixed(1)}% ROCE sits well above a typical cost-of-capital hurdle — the financial signature of durable competitive advantage.`) : roce > 10 ? B("Value-accretive returns", `${roce.toFixed(1)}% ROCE clears a typical hurdle rate, supporting reinvestment-led compounding.`) : B("Capital returns below hurdle", `${roce.toFixed(1)}% ROCE trails a typical cost of capital — the central watch item in the thesis.`));
  if (g.revCagr != null) items.push(g.revCagr > 12 ? B("Compounding top line", `revenue has compounded at ${g.revCagr.toFixed(1)}% over the statement history, evidencing structural demand.`) : g.revCagr > 4 ? B("Steady growth profile", `${g.revCagr.toFixed(1)}% revenue CAGR — a stable, GDP-plus growth trajectory.`) : B("Muted growth", `revenue CAGR of ${g.revCagr.toFixed(1)}% leaves the equity case reliant on margins, capital returns and valuation.`));
  if (nm != null) items.push(nm > 15 ? B("High-margin franchise", `${nm.toFixed(1)}% net margin gives substantial buffer against cost cycles.`) : nm > 7 ? B("Healthy profitability", `${nm.toFixed(1)}% net margin, broadly resilient through the cycle.`) : B("Thin margins", `${nm.toFixed(1)}% net margin leaves earnings sensitive to input costs and pricing.`));
  if (de != null) items.push(de < 0.3 ? B("Fortress balance sheet", `${de.toFixed(2)}× debt/equity — near-unlevered, with capacity for downturns and opportunistic investment.`) : de < 1 ? B("Manageable leverage", `${de.toFixed(2)}× debt/equity${icov != null ? `, interest covered ${icov.toFixed(1)}×` : ""}.`) : B("Elevated leverage", `${de.toFixed(2)}× debt/equity heightens sensitivity to rates and cash-flow shocks.`));
  if (g.cashConversion != null) items.push(g.cashConversion > 90 ? B("High-quality earnings", `${(g.cashConversion / 100).toFixed(2)}× cash conversion — reported profit is backed by cash.`) : g.cashConversion < 60 ? B("Soft cash conversion", `${(g.cashConversion / 100).toFixed(2)}× OCF/PAT — accrual-heavy earnings warrant forensic attention.`) : B("Sound cash conversion", `${(g.cashConversion / 100).toFixed(2)}× OCF/PAT supports the earnings print.`));
  if (co.street?.targetMean != null && co.price) {
    const up = (co.street.targetMean / co.price - 1) * 100;
    items.push(B("Street positioning", `consensus target of ${F.px(co.street.targetMean, co.currency)} implies ${(up >= 0 ? "+" : "") + up.toFixed(1)}% versus the current price${co.street.analysts ? ` across ${co.street.analysts} analysts` : ""} (${(co.street.rec || "n/a").toUpperCase()}).`));
  } else if (pe != null) {
    items.push(B("Valuation observation", `trades at ${pe.toFixed(1)}× trailing earnings${fcfy != null ? ` with a ${fcfy.toFixed(1)}% free-cash-flow yield` : ""} — cross-check against the peer set below.`));
  }
  if (dy != null && dy > 1) items.push(B("Cash returns", `${dy.toFixed(1)}% dividend yield adds a distribution component to total return.`));
  const risk = de != null && de > 1.5 ? "balance-sheet leverage" : g.revYoy != null && g.revYoy < 0 ? "top-line contraction" : nm != null && nm < 5 ? "margin fragility" : null;
  if (risk) items.push(B("Key risk", `${risk} is the principal downside vector — sized in the Key Risks section below.`));
  if (g.revCagr != null && roce != null) items.push(B("Long-term outlook", `${g.revCagr > 8 && roce > 12 ? "growth and returns together support a multi-year compounding case" : roce > 12 ? "returns quality anchors the long-term case even with moderate growth" : "the long-term case rests on execution lifting returns above the cost of capital"}, subject to the risks flagged below.`));
  return items.slice(0, 8);
}

/* ── Historical Performance Snapshot ── */
let ERS_SPARKS = {};
function ersHistoricalSnapshot(co, { U, unit, block }) {
  const inc = co.statements.income, cfs = co.statements.cashflow;
  const cagr = (arr) => { const v = arr.filter((x) => x != null && x > 0); return v.length >= 2 ? (Math.pow(v[v.length - 1] / v[0], 1 / (v.length - 1)) - 1) * 100 : null; };
  const ser = (k, src = inc) => src.map((r) => r[k]);
  ERS_SPARKS = {
    rev: ser("revenue"), ebitda: ser("ebitda"), eps: ser("basicEPS"),
    roe: (co.series.roe || []).map((p) => p.v), roce: (co.series.roce || []).map((p) => p.v),
    fcf: (co.series.fcf || []).map((p) => p.v),
  };
  const roeL = ERS_SPARKS.roe.filter((v) => v != null).at(-1);
  const roceL = ERS_SPARKS.roce.filter((v) => v != null).at(-1);
  const fcfL = ERS_SPARKS.fcf.filter((v) => v != null).at(-1);
  const tiles = [
    ["Revenue CAGR", cagr(ERS_SPARKS.rev), "pct", "rev", "Top-line compounding over the statement history"],
    ["EBITDA CAGR", cagr(ERS_SPARKS.ebitda), "pct", "ebitda", "Core operating-profit compounding"],
    ["EPS CAGR", cagr(ERS_SPARKS.eps), "pct", "eps", "Per-share earnings compounding"],
    ["ROE (latest)", roeL, "pct1", "roe", "Return on shareholder capital, year-wise trend"],
    ["ROCE (latest)", roceL, "pct1", "roce", "Capital-structure-neutral returns, year-wise trend"],
    [`Free Cash Flow (${unit})`, fcfL, "u", "fcf", "Cash left after reinvestment, year-wise trend"],
  ].filter((t) => t[1] != null && Number.isFinite(t[1]));
  if (!tiles.length) return "";
  const fmt = (v, k) => k === "u" ? U(v) : (k === "pct" ? (v >= 0 ? "+" : "") : "") + v.toFixed(1) + "%";
  const cards = tiles.map(([l, v, k, sk, note]) => `<div class="ratio-card"><div class="rg">LONG-TERM TREND</div><div class="rn">${l}</div><div class="rv ${k !== "u" ? F.cls(v) : ""}">${fmt(v, k)}</div><canvas class="hp-spark" data-hk="${sk}"></canvas><div class="ri">${note}</div></div>`).join("");
  // concise commentary
  const rc = cagr(ERS_SPARKS.rev), ec = cagr(ERS_SPARKS.ebitda);
  const parts = [];
  if (rc != null && ec != null) parts.push(`Over the statement history revenue compounded at ${rc.toFixed(1)}% while EBITDA compounded at ${ec.toFixed(1)}% — ${ec > rc + 1 ? "operating leverage has amplified growth into profit" : ec < rc - 1 ? "profit growth has lagged sales, signalling margin give-back" : "profitability has scaled in line with the top line"}.`);
  if (roceL != null) parts.push(`Returns on capital ${roceL > 15 ? "remain comfortably above" : roceL > 8 ? "sit around" : "trail"} a typical hurdle at ${roceL.toFixed(1)}% ROCE.`);
  if (fcfL != null) parts.push(`Free cash flow of ${U(fcfL)} ${unit} in the latest year ${fcfL > 0 ? "confirms the model self-funds its reinvestment" : "reflects a heavy reinvestment or working-capital phase"}.`);
  return block("HISTORICAL PERFORMANCE SNAPSHOT", "long-term trends · computed from reported statements",
    `<div class="ratio-grid">${cards}</div><div class="prose">${parts.join(" ")}</div>`);
}

/* ── Capital Allocation ── */
function ersCapitalAllocation(co, { U, unit, block }) {
  const cf = co.statements.cashflow;
  if (!cf.length) return "";
  const years = cf.map((r) => r.year);
  const rows = [
    ["Capex", (r) => r.capex],
    ["Dividends", (r) => r.dividends],
    ["Buybacks", (r) => r.buybacks],
    ["Debt Reduction (net)", (r) => (r.debtRepaid != null || r.debtIssued != null ? (r.debtRepaid || 0) - (r.debtIssued || 0) : null)],
    ["Acquisitions", (r) => r.acquisitions],
  ];
  const live = rows.filter(([, f]) => cf.some((r) => f(r) != null));
  if (!live.length) return "";
  const sum = (f) => { const v = cf.map(f).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
  const tbl = `<div class="table-wrap"><table class="dt"><tr><th>(${unit})</th>${years.map((y) => `<th>FY${String(y).slice(2)}</th>`).join("")}<th>Σ ${years.length}Y</th></tr>
    ${live.map(([l, f]) => `<tr><td class="nm">${l}</td>${cf.map((r) => `<td>${U(f(r))}</td>`).join("")}<td><b>${U(sum(f))}</b></td></tr>`).join("")}
  </table></div>`;
  // thesis
  const tot = { ocf: sum((r) => r.ocf), capex: sum((r) => r.capex), div: sum((r) => r.dividends), bb: sum((r) => r.buybacks), debt: sum((r) => (r.debtRepaid != null || r.debtIssued != null ? (r.debtRepaid || 0) - (r.debtIssued || 0) : null)), acq: sum((r) => r.acquisitions) };
  const pctOf = (v) => (tot.ocf ? Math.round((v / tot.ocf) * 100) : null);
  const t = [];
  if (tot.ocf != null) {
    t.push(`Over FY${String(years[0]).slice(2)}–FY${String(years.at(-1)).slice(2)} the business generated ${U(tot.ocf)} ${unit} of operating cash.`);
    if (tot.capex != null) t.push(`Roughly ${pctOf(tot.capex)}% was reinvested as capex${tot.acq ? ` and a further ${pctOf(tot.acq)}% into acquisitions` : ""}.`);
    const ret = (tot.div || 0) + (tot.bb || 0);
    if (ret) t.push(`${pctOf(ret)}% was returned to shareholders via ${tot.div && tot.bb ? "dividends and buybacks" : tot.div ? "dividends" : "buybacks"}.`);
    if (tot.debt != null) t.push(tot.debt > 0 ? `Net debt reduction of ${U(tot.debt)} ${unit} shows a deleveraging bias.` : `Net borrowings rose ${U(-tot.debt)} ${unit}, funding the investment programme.`);
    const style = tot.capex != null && pctOf(tot.capex) > 50 ? "reinvestment-led" : ret && pctOf(ret) > 50 ? "distribution-led" : "balanced";
    t.push(`The allocation stance is ${style} — judge it against the ROCE evidence above: reinvestment only compounds value where incremental returns exceed the cost of capital.`);
  }
  return block("CAPITAL ALLOCATION", "where the cash went · " + years.length + " years",
    tbl + (t.length ? `<div class="prose">${t.join(" ")}</div>` : ""));
}

/* ── Growth Drivers ── */
function ersGrowthDrivers(co, { block }) {
  const g = co.growth || {}, sec = co.profile.sector || "";
  const inc = co.statements.income, cf = co.statements.cashflow;
  const TAILWINDS = {
    "Technology": "digital adoption, cloud/AI spending cycles and enterprise IT modernisation",
    "Financial Services": "credit penetration, financialisation of savings and digital distribution",
    "Consumer Defensive": "premiumisation, distribution expansion and per-capita consumption growth",
    "Consumer Cyclical": "discretionary income growth, urbanisation and category formalisation",
    "Healthcare": "ageing demographics, healthcare access expansion and specialty/generic pipelines",
    "Energy": "energy demand growth, transition capex and refining/petchem integration",
    "Industrials": "infrastructure capex cycles, manufacturing localisation and order-book build",
    "Basic Materials": "construction and manufacturing demand, commodity cycles and capacity discipline",
    "Communication Services": "data consumption growth, ARPU repair and digital-services bundling",
    "Utilities": "electrification, renewable-capacity addition and regulated asset-base growth",
    "Real Estate": "urbanisation, formalisation of housing demand and rate-cycle tailwinds",
  };
  const items = [];
  items.push(`<b>Industry tailwinds</b> — ${TAILWINDS[sec] || "sector-level demand growth and formalisation"}${sec ? ` continue to underpin the ${sec.toLowerCase()} opportunity set` : ""}.`);
  // capacity expansion from capex intensity
  const capexInt = (i) => (cf[i]?.capex != null && inc[i]?.revenue ? (cf[i].capex / inc[i].revenue) * 100 : null);
  const ciL = capexInt(cf.length - 1), ciAvg = (() => { const v = cf.map((_, i) => capexInt(i)).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; })();
  if (ciL != null && ciAvg != null) items.push(`<b>Capacity expansion</b> — capex intensity of ${ciL.toFixed(1)}% of revenue ${ciL > ciAvg + 1 ? "is running above its historical average, signalling capacity build ahead of demand" : ciL < ciAvg - 1 ? "has moderated below its historical average — a harvest phase that supports free cash flow" : "is steady at maintenance-plus levels"}.`);
  // product / mix from gross margin trend
  const gmSeries = (co.series.grossMargin || []).map((p) => p.v).filter((v) => v != null);
  if (gmSeries.length >= 2) items.push(`<b>Product mix &amp; launches</b> — gross margin has ${gmSeries.at(-1) > gmSeries[0] + 0.5 ? "expanded across the period, consistent with richer mix and new-product traction" : gmSeries.at(-1) < gmSeries[0] - 0.5 ? "compressed, so mix upgrades and launches are needed to rebuild pricing power" : "held steady; incremental growth is volume-led"}.`);
  if (g.revYoy != null) items.push(`<b>Market expansion</b> — latest-year revenue growth of ${(g.revYoy >= 0 ? "+" : "") + g.revYoy.toFixed(1)}% versus a ${g.revCagr != null ? g.revCagr.toFixed(1) + "% multi-year CAGR" : "longer trend"} points to ${g.revCagr != null && g.revYoy > g.revCagr ? "accelerating momentum — share gains or new markets coming through" : "a normalising growth cadence"}.`);
  if (co.street?.analysts) {
    const up = co.street.targetMean && co.price ? (co.street.targetMean / co.price - 1) * 100 : null;
    items.push(`<b>Key catalysts</b> — ${co.street.analysts} covering analysts${up != null ? ` see ${(up >= 0 ? "+" : "") + up.toFixed(1)}% to consensus target` : ""}; earnings prints, capacity commissioning and capital-allocation announcements are the near-term markers to track.`);
  } else {
    items.push(`<b>Key catalysts</b> — earnings prints, capacity commissioning, new-product announcements and capital-allocation decisions are the near-term markers to track.`);
  }
  return block("GROWTH DRIVERS", "tailwinds · expansion · catalysts — computed & sector-mapped",
    `<ul class="ih-list">${items.map((x) => `<li>${x}</li>`).join("")}</ul>`);
}

/* ── Key Risks ── */
function ersKeyRisks(co, { block }) {
  const g = co.growth || {}, sec = co.profile.sector || "";
  const r = (nm) => co.ratios.find((x) => x.name === nm)?.value;
  const de = r("Debt / Equity"), icov = r("Interest coverage"), cr = r("Current ratio"), nm = r("Net margin"), beta = r("Beta");
  const fcfL = (co.series.fcf || []).map((p) => p.v).filter((v) => v != null).at(-1);
  const REG = {
    "Financial Services": "Central-bank supervision (capital adequacy, provisioning norms) and lending-rate regulation can reset unit economics.",
    "Healthcare": "Drug-price controls and manufacturing-quality inspections (e.g. USFDA) are recurring binary risks.",
    "Energy": "Windfall levies, environmental norms and fuel-pricing policy shift economics with little notice.",
    "Utilities": "Tariff orders and regulated-return resets cap the earnings trajectory.",
    "Technology": "Data-protection, platform and cross-border taxation rules are tightening across key markets.",
    "Communication Services": "Spectrum policy, license fees and tariff regulation shape returns.",
    "Consumer Defensive": "Food-safety, labelling and local levies can disrupt portfolios and pricing.",
    "Basic Materials": "Environmental clearances, mining policy and import/export duties drive cycle timing.",
  };
  const biz = [];
  if (g.revYoy != null && g.revCagr != null && g.revYoy < g.revCagr - 3) biz.push("Revenue momentum is decelerating versus its own multi-year trend.");
  if (nm != null && nm < 7) biz.push(`Thin ${nm.toFixed(1)}% net margins leave little buffer against demand or cost shocks.`);
  const nmSeries = (co.series.netMargin || []).map((p) => p.v).filter((v) => v != null);
  if (nmSeries.length >= 2 && nmSeries.at(-1) < nmSeries[0] - 1) biz.push("Net margin has compressed across the statement history.");
  if (!biz.length) biz.push("Execution and demand-cycle risk — growth assumptions embed continued volume and pricing delivery.");
  const fin = [];
  if (de != null) fin.push(de > 1.5 ? `High gearing at ${de.toFixed(2)}× debt/equity amplifies earnings and refinancing risk.` : de > 0.8 ? `Moderate leverage (${de.toFixed(2)}× D/E) is serviceable but rate-sensitive.` : `Low leverage (${de.toFixed(2)}× D/E) — financial risk is contained.`);
  if (icov != null && icov < 3) fin.push(`Interest cover of ${icov.toFixed(1)}× is thin; earnings shocks transmit quickly to solvency metrics.`);
  if (cr != null && cr < 1) fin.push(`Current ratio below 1× flags near-term liquidity dependence on rollovers.`);
  if (fcfL != null && fcfL < 0) fin.push("Free cash flow is currently negative — external funding is bridging the investment phase.");
  if (!fin.length) fin.push("No acute balance-sheet stress visible in the reported numbers.");
  const reg = [REG[sec] || "Tax, disclosure and sector-specific compliance changes are an ongoing, low-probability / high-impact exposure."];
  const ind = [];
  const gmL = (co.series.grossMargin || []).map((p) => p.v).filter((v) => v != null).at(-1);
  if (gmL != null && gmL < 25) ind.push(`A ${gmL.toFixed(0)}% gross margin suggests limited pricing power against competitive intensity.`);
  if (beta != null && beta > 1.15) ind.push(`Beta of ${beta.toFixed(2)} marks the stock as cyclical versus the market — industry downcycles hit harder.`);
  ind.push("Technology shifts and new entrants can reset industry economics faster than incumbents adapt.");
  const cell = (t, lines) => `<div class="risk-cell"><div class="risk-h mono">${t}</div><div class="risk-b">${lines.map((x) => `<p>${x}</p>`).join("")}</div></div>`;
  return block("KEY RISKS", "business · financial · regulatory · industry — institutional summary",
    `<div class="risk-grid">${cell("BUSINESS RISKS", biz)}${cell("FINANCIAL RISKS", fin)}${cell("REGULATORY RISKS", reg)}${cell("INDUSTRY RISKS", ind)}</div>`);
}

/* ── Business Segment Analysis (renders only when segment data exists) ── */
async function loadSegments(symbol) {
  const mount = $("#segMount");
  if (!mount) return;
  try {
    const seg = await api(`/api/segments/${encodeURIComponent(symbol)}`);
    if (!seg.available || !CURRENT || CURRENT.symbol !== symbol) { mount.innerHTML = ""; return; }
    mount.innerHTML = ersRenderSegments(seg, CURRENT);
    revealSections();
  } catch { mount.innerHTML = ""; }
}

function ersRenderSegments(seg, co) {
  const { unit, scale } = ersUnits(co.currency);
  const U = (v, dp = 0) => (v == null || !Number.isFinite(v) ? "—" : (v / scale).toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp }));
  const buildRows = (hist) => {
    const latest = hist.at(-1), prior = hist.at(-2);
    if (!latest) return null;
    const total = Object.values(latest.data).reduce((a, b) => a + (b || 0), 0) || 1;
    const rows = Object.entries(latest.data)
      .map(([name, v]) => ({ name, v, prev: prior ? prior.data[name] ?? null : null }))
      .sort((a, b) => (b.v || 0) - (a.v || 0));
    return { rows, total, latestYear: latest.year, priorYear: prior?.year };
  };
  const bars = (rows, total) => {
    const max = Math.max(...rows.map((x) => x.v || 0), 1);
    return `<div class="ind-share">${rows.slice(0, 8).map((x) => `<div class="ind-sh-row"><span class="ind-sh-n">${x.name}</span><div class="ind-sh-track"><i style="width:${((x.v || 0) / max) * 100}%"></i></div><span class="ind-sh-v">${(((x.v || 0) / total) * 100).toFixed(1)}%</span></div>`).join("")}</div>`;
  };
  let inner = "";
  const p = buildRows(seg.product || []);
  if (p) {
    const gRows = p.rows.map((x) => {
      const gr = x.prev ? ((x.v / x.prev - 1) * 100) : null;
      return `<tr><td class="nm">${x.name}</td><td>${U(x.v)}</td><td>${x.prev == null ? "—" : U(x.prev)}</td><td class="${gr == null ? "" : gr >= 0 ? "up" : "down"}">${gr == null ? "—" : (gr >= 0 ? "+" : "") + gr.toFixed(1) + "%"}</td><td>${((x.v / p.total) * 100).toFixed(1)}%</td></tr>`;
    }).join("");
    inner += `<div class="panel-sub mono" style="padding:8px 2px">REVENUE BY SEGMENT — FY${String(p.latestYear).slice(2)} (${unit})</div>${bars(p.rows, p.total)}
      <div class="table-wrap" style="margin-top:8px"><table class="dt"><tr><th>Segment</th><th>FY${String(p.latestYear).slice(2)}</th><th>${p.priorYear ? "FY" + String(p.priorYear).slice(2) : "Prior"}</th><th>Growth</th><th>Contribution</th></tr>${gRows}</table></div>`;
  }
  const geo = buildRows(seg.geographic || []);
  if (geo) {
    inner += `<div class="panel-sub mono" style="padding:14px 2px 8px">GEOGRAPHIC REVENUE MIX — FY${String(geo.latestYear).slice(2)}</div>${bars(geo.rows, geo.total)}`;
  }
  if (!inner) return "";
  inner += `<div class="prose">Segment and geographic splits are as disclosed in company filings (via FMP). Concentration in a single segment or geography raises the earnings sensitivity to that exposure; diversification across ${p ? p.rows.length : "multiple"} reported segments ${geo ? `and ${geo.rows.length} geographies ` : ""}spreads it.</div>`;
  return `<div class="panel section-block grow"><div class="panel-h"><h3>BUSINESS SEGMENT ANALYSIS</h3><span class="panel-sub mono">revenue by segment · growth · contribution · geography</span></div>${inner}</div>`;
}

/* ── event wiring: statement tabs, expandable prose (delegated once) ── */
function ersWireEvents() {
  const body = $("#researchBody");
  if (!body || body.__ersWired) return;
  body.__ersWired = true;
  body.addEventListener("click", (e) => {
    const csBtn = e.target.closest("[data-ers-cs]");
    if (csBtn) { ersToggleCS(); return; }
    const tab = e.target.closest("[data-ers-tab]");
    if (tab) {
      $$("#ersTabs .iffm-tab", body).forEach((b) => b.classList.toggle("is-active", b === tab));
      $$(".ers-pane", body).forEach((p) => p.classList.toggle("is-active", p.dataset.ersPane === tab.dataset.ersTab));
      return;
    }
    const tg = e.target.closest(".xp-toggle");
    if (tg) {
      const box = tg.closest(".ers-xp");
      const sh = $(".xp-short", box), fu = $(".xp-full", box);
      const open = fu.hidden;
      fu.hidden = !open; sh.hidden = open;
      tg.textContent = open ? "Show less ▴" : "Read more ▾";
    }
  });
}

function revealSections() {
  const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add("vis"), io.unobserve(e.target))), { threshold: 0.08 });
  $$(".section-block:not(.vis)").forEach((el) => io.observe(el));
}

/* ── Peers: customisable peer group (search · autocomplete · add/remove · max 10) ── */
let PEER_CUSTOM = null; // peer symbols excluding self; null → server auto-suggestion

async function loadPeers(symbol, custom) {
  const pb = $("#peerBlock");
  if (custom && pb) pb.innerHTML = `<div class="loading mono">rebuilding peer set…</div>`;
  try {
    const q = custom && custom.length ? `?peers=${encodeURIComponent(custom.join(","))}` : "";
    const { rows } = await api(`/api/peers/${encodeURIComponent(symbol)}${q}`);
    PEERS = rows;
    if (!custom) PEER_CUSTOM = rows.slice(1).map((r) => r.symbol);
    renderPeerTools(symbol);
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
  } catch {
    if ($("#peerBlock")) $("#peerBlock").innerHTML = `<div class="loading">peer analysis unavailable</div>`;
    renderPeerTools(symbol);
  }
}

function renderPeerTools(symbol) {
  const host = $("#peerTools");
  if (!host) return;
  const list = PEER_CUSTOM || [];
  host.innerHTML = `
    <div class="peer-search">
      <span class="peer-search-i mono">⌕</span>
      <input id="peerSearchInput" placeholder="Add peer — search company or ticker…" spellcheck="false" autocomplete="off" />
      <div id="peerSearchResults" class="cmd-results" hidden></div>
    </div>
    <div class="peer-chips">${list.map((p) => `<span class="peer-chip mono">${p}<button class="peer-x" data-peer="${p}" title="Remove ${p}" type="button">×</button></span>`).join("")}
      <span class="peer-count mono">${list.length}/10</span>
    </div>`;
  // remove
  $$(".peer-x", host).forEach((b) => b.addEventListener("click", () => {
    PEER_CUSTOM = (PEER_CUSTOM || []).filter((p) => p !== b.dataset.peer);
    loadPeers(symbol, PEER_CUSTOM);
  }));
  // search + autocomplete (mirrors the command-bar interaction)
  const input = $("#peerSearchInput", host), results = $("#peerSearchResults", host);
  let timer, items = [];
  const addPeer = (sym) => {
    sym = (sym || "").trim().toUpperCase();
    results.hidden = true; input.value = "";
    if (!sym || sym === symbol.toUpperCase()) return;
    PEER_CUSTOM = PEER_CUSTOM || [];
    if (PEER_CUSTOM.includes(sym)) return;
    if (PEER_CUSTOM.length >= 10) { input.placeholder = "Peer limit reached (10) — remove one first"; return; }
    PEER_CUSTOM.push(sym);
    loadPeers(symbol, PEER_CUSTOM);
  };
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { results.hidden = true; return; }
    timer = setTimeout(async () => {
      try {
        const { results: list } = await api(`/api/search?q=${encodeURIComponent(q)}`);
        items = (list || []).filter((it) => it.type === "EQUITY" || !it.type).slice(0, 6);
        if (!items.length) return (results.hidden = true);
        results.innerHTML = items.map((it, i) => `<button class="cmd-result" data-i="${i}" type="button"><span class="sym">${it.symbol}</span><span class="nm">${it.name}</span><span class="ex">${it.exchange}</span></button>`).join("");
        results.hidden = false;
      } catch { results.hidden = true; }
    }, 220);
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addPeer(items[0]?.symbol || input.value); } else if (e.key === "Escape") results.hidden = true; });
  results.addEventListener("click", (e) => { const b = e.target.closest(".cmd-result"); if (b) addPeer(items[+b.dataset.i].symbol); });
  if (!window.__peerSearchDocClose) {
    window.__peerSearchDocClose = true;
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".peer-search")) { const r = $("#peerSearchResults"); if (r) r.hidden = true; }
    });
  }
}

/* ════════ MODELING LAB ════════ */
TABS.models = {
  init() { IDCF.init(); if (typeof SCN !== "undefined") SCN.init(); if (CURRENT) fillModelsFromCompany(CURRENT); },
  /* persistent company context: rebuild only when the company actually changed */
  syncContext() {
    if (CURRENT && CURRENT.symbol && IDCF.symbol !== CURRENT.symbol) fillModelsFromCompany(CURRENT);
  },
};

function fillModelsFromCompany(co) {
  // load the full institutional DCF for the open company
  if (co && co.symbol) { $("#idcfSym") && ($("#idcfSym").value = co.symbol); IDCF.load(co.symbol); loadValuation(co.symbol); loadBands(co.symbol); }
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
  /* persistent company context: prefill only — generation stays user-initiated */
  syncContext() {
    const inp = $("#reportSymbol");
    if (inp && CURRENT && CURRENT.symbol && !inp.value.trim()) inp.value = CURRENT.symbol;
  },
  async generate() {
    const symbol = ($("#reportSymbol").value.trim() || CURRENT?.symbol || "").toUpperCase();
    if (!symbol) return;
    const type = $("#reportType").value;
    $("#reportStatus").textContent = "reading filings · computing · drafting…";
    $("#reportActions").hidden = true;
    $("#reportCanvas").innerHTML = "";
    try {
      // ── Inject valuationModelState snapshot if available for this symbol ──
      const vms = valuationModelState.snapshot();
      const vmsForSymbol = vms && vms.symbol === symbol ? vms : null;
      const body = { symbol, type };
      if (vmsForSymbol) {
        // Pass the pre-computed idcf so the server can skip recalculation
        body._idcfSnapshot = {
          idcf: vmsForSymbol.idcf,
          assumptions: vmsForSymbol.assumptions,
          evidence: vmsForSymbol.evidence,
          modelStatus: vmsForSymbol.modelStatus,
          lastRecalcAt: vmsForSymbol.lastRecalcAt,
        };
      }
      const rep = await api("/api/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      this.current = rep;
      // Annotate report with model status from VMS
      if (vmsForSymbol) {
        rep._vmsModelStatus = vmsForSymbol.modelStatus;
        rep._vmsLastRecalcAt = vmsForSymbol.lastRecalcAt;
      }
      $("#aiMode").textContent = rep.meta.mode === "ai" ? "AI narrative (Claude)" : "Research Report - Not an Invesetment Advice";
      // Show VMS sync status
      const vmsNote = vmsForSymbol
        ? `<span class="vms-tag vms-ev" style="margin-left:8px">VALUATION SYNCED FROM MODELING LAB</span>`
        : `<span class="vms-tag vms-adj" style="margin-left:8px">INDEPENDENT DCF (open Modeling Lab first for user-adjusted assumptions)</span>`;
      $("#reportStatus").innerHTML = `done ${vmsNote}`;
      $("#reportActions").hidden = false;
      $("#reportCanvas").innerHTML = renderReport(rep);
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

/* ════════ PORTFOLIO · INSTITUTIONAL TECHNICAL SCREENER (v2) ════════════════
   Complete architectural rewrite. One cohesive workspace — header, toolbar,
   chips, screener, analytics, alerts — driven from a single per-portfolio
   runtime cache. Switching portfolios saves the current snapshot and
   restores the target's snapshot, so nothing from portfolio A ever leaks
   into portfolio B's view. Custom modals throughout — no native dialogs.

   Runtime cache shape (per portfolio id):
     { rows, prevRows, alerts, changes,
       activeFilters: Set, sortKey, sortDir,
       lastUpdate, loading, seeded }
   The `seeded` flag lets us distinguish "empty cache, needs first fetch"
   from "cache is empty because nothing came back this refresh".               */

const PF_KEY        = "meridian_portfolios";
const PF_ACTIVE_KEY = "meridian_portfolio_active";
const PF_COLS_KEY   = "meridian_pf_cols_v2";
const PF_MAX        = 20;

// Filter groups shown inside the popover panel. New groups & filters are
// added here — they auto-render in the panel and produce chips on activation.
const PF_FILTER_GROUPS = [
  { title: "TECHNICAL", items: [
    { id: "rsiHigh",     label: "RSI > 60",       fn: (r) => Number.isFinite(r.momentum?.rsi) && r.momentum.rsi > 60 },
    { id: "rsiLow",      label: "RSI < 30",       fn: (r) => Number.isFinite(r.momentum?.rsi) && r.momentum.rsi < 30 },
    { id: "adxStrong",   label: "ADX > 25",       fn: (r) => Number.isFinite(r.momentum?.adx) && r.momentum.adx > 25 },
    { id: "macdBull",    label: "Bullish MACD",   fn: (r) => !!r.momentum?.macdBullish },
    { id: "aboveEma200", label: "Above EMA200",   fn: (r) => !!r.trend?.aboveEma200 },
    { id: "golden",      label: "Golden Cross",   fn: (r) => !!r.trend?.goldenCross },
    { id: "death",       label: "Death Cross",    fn: (r) => !!r.trend?.deathCross },
  ]},
  { title: "SIGNAL", items: [
    { id: "strongBuy",  label: "Strong Buy",  fn: (r) => r.signal === "Strong Buy" },
    { id: "buy",        label: "Buy",         fn: (r) => r.signal === "Buy" },
    { id: "accumulate", label: "Accumulate",  fn: (r) => r.signal === "Accumulate" },
    { id: "watch",      label: "Watch",       fn: (r) => r.signal === "Watch" },
    { id: "hold",       label: "Hold",        fn: (r) => r.signal === "Hold" },
    { id: "avoid",      label: "Avoid",       fn: (r) => r.signal === "Avoid" },
  ]},
  { title: "PRICE ACTION", items: [
    { id: "breakout",  label: "Breakout (Donchian)", fn: (r) => !!r.volatility?.breakoutUp },
    { id: "volSpike",  label: "Volume Spike",        fn: (r) => Number.isFinite(r.volume?.spike) && r.volume.spike > 1.5 },
    { id: "near52H",   label: "Near 52W High",       fn: (r) => Number.isFinite(r.priceAction?.distHigh52) && r.priceAction.distHigh52 >= -3 },
    { id: "near52L",   label: "Near 52W Low",        fn: (r) => Number.isFinite(r.priceAction?.distLow52) && r.priceAction.distLow52 <= 5 },
  ]},
  { title: "VOLUME & MOMENTUM", items: [
    { id: "obvRising", label: "OBV Rising",           fn: (r) => Number.isFinite(r.volume?.obvSlope) && r.volume.obvSlope > 0 },
    { id: "aboveVwap", label: "Above VWAP",           fn: (r) => r.volume?.vwap && r.price > r.volume.vwap },
    { id: "mfiBull",   label: "MFI 50–80 (Bullish)",  fn: (r) => { const v = r.oscillators?.mfi; return Number.isFinite(v) && v >= 50 && v <= 80; } },
  ]},
];

const PF_FILTER_BY_ID = {};
PF_FILTER_GROUPS.forEach((g) => g.items.forEach((f) => { PF_FILTER_BY_ID[f.id] = f; }));

// Screener columns. `def` = shown by default; renderer decides badge/format.
const PF_COLS = [
  { id: "name",       label: "COMPANY",  sort: "name",       tip: "Company name & symbol",       def: true },
  { id: "price",      label: "PRICE",    sort: "price",      tip: "Latest close",                 def: true },
  { id: "chg",        label: "CHG %",    sort: "changePct",  tip: "Day change vs prior close",    def: true },
  { id: "trend",      label: "TREND",    sort: "trendDir",   tip: "Vote-based EMA-stack label",   def: true },
  { id: "rsi",        label: "RSI",      sort: "rsi",        tip: "Relative Strength Index (14)", def: true },
  { id: "macd",       label: "MACD",     sort: "macdHist",   tip: "MACD (12,26,9)",               def: true },
  { id: "adx",        label: "ADX",      sort: "adx",        tip: "Trend strength (14)",          def: true },
  { id: "ema20",      label: "EMA20",    sort: "ema20Rel",   tip: "Price vs 20-day EMA",          def: true },
  { id: "ema50",      label: "EMA50",    sort: "ema50Rel",   tip: "Price vs 50-day EMA",          def: true },
  { id: "ema200",     label: "EMA200",   sort: "ema200Rel",  tip: "Price vs 200-day EMA",         def: true },
  { id: "cross",      label: "SMA50/200",sort: "cross",      tip: "Golden / Death Cross",         def: true },
  { id: "bb",         label: "BB%",      sort: "bbPos",      tip: "Bollinger Band position",      def: true },
  { id: "atr",        label: "ATR",      sort: "atrRel",     tip: "ATR (14) as % of price",       def: false },
  { id: "vol",        label: "VOL",      sort: "volSpike",   tip: "Volume vs 30-day average",     def: true },
  { id: "obv",        label: "OBV",      sort: "obvSlope",   tip: "On-Balance-Volume slope (20)", def: true },
  { id: "vwap",       label: "VWAP",     sort: "vwapRel",    tip: "Price vs 20-day VWAP",         def: true },
  { id: "mfi",        label: "MFI",      sort: "mfi",        tip: "Money Flow Index (14)",        def: true },
  { id: "cci",        label: "CCI",      sort: "cci",        tip: "Commodity Channel Index (20)", def: false },
  { id: "roc",        label: "ROC",      sort: "roc",        tip: "Rate of Change (12)",          def: false },
  { id: "will",       label: "WILL %R",  sort: "willR",      tip: "Williams %R (14)",             def: false },
  { id: "stoch",      label: "STOCH",    sort: "stochK",     tip: "Stochastic %K / %D",           def: false },
  { id: "sr",         label: "S / R",    sort: "sr",         tip: "30-day support / resistance",  def: false },
  { id: "range52",    label: "52W RANGE",sort: "distHigh52", tip: "Distance to 52W high / low",   def: true },
  { id: "brk",        label: "BREAKOUT", sort: "breakout",   tip: "Donchian 20-day breakout",     def: true },
  { id: "score",      label: "SCORE",    sort: "score",      tip: "Composite 0..100",             def: true },
  { id: "signal",     label: "SIGNAL",   sort: "signalRank", tip: "Signal band",                  def: true },
];

// Composite-score → band label + colour for the health readout.
function pfHealthBand(score) {
  if (score == null) return { label: "—", color: "var(--muted)" };
  if (score >= 80) return { label: "Excellent", color: "#3fbf7f" };
  if (score >= 65) return { label: "Good",      color: "#5fb88a" };
  if (score >= 50) return { label: "Balanced",  color: "var(--amber-bright)" };
  if (score >= 35) return { label: "Cautious",  color: "var(--amber)" };
  return { label: "Weak", color: "var(--down)" };
}
/* Portfolio-level breadth health (0-100) — distinct from the mean composite
   score: rewards bullish breadth, trend participation and buy-side signals. */
function pfTechHealth(rows) {
  if (!rows.length) return null;
  const share = (fn) => rows.filter(fn).length / rows.length;
  const h =
    0.28 * share((r) => /Bullish/.test(r.trend?.direction || "")) +
    0.20 * share((r) => r.trend?.aboveEma200) +
    0.14 * share((r) => r.trend?.goldenCross) +
    0.14 * share((r) => r.momentum?.macdBullish) +
    0.24 * share((r) => ["Strong Buy", "Buy", "Accumulate"].includes(r.signal));
  return Math.round(h * 100);
}
/* Deterministic brand-ish colour for a monogram logo. */
function pfLogoColor(sym) {
  let h = 0; for (const c of String(sym)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = h % 360, sat = 46 + (h >> 8) % 16;
  return `hsl(${hue} ${sat}% 38%)`;
}
function pfLogoMarkup(symbol, name) {
  const base = String(name || symbol || "?").replace(/\.(NS|BO)$/i, "").trim();
  const letter = (base.charAt(0) || "?").toUpperCase();
  return `<span class="pfs-logo" style="background:${pfLogoColor(symbol)}">${pfEsc(letter)}</span>`;
}
function pfMean(arr) {
  const vs = (arr || []).filter((v) => Number.isFinite(v));
  return vs.length ? vs.reduce((s, v) => s + v, 0) / vs.length : null;
}
function pfEsc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

/* ── Custom modal system ────────────────────────────────────────────────────
   pfModal({ title, bodyHtml, actions, danger, size }) — one-shot dialog.
   pfPrompt({ ... })  and  pfConfirm({ ... }) are thin wrappers.
   Focus is trapped inside the dialog; Escape and overlay-click close it. */

function pfModalOpen({ title, bodyHtml, actions, danger, size, onOpen }) {
  const root = document.getElementById("pfModalRoot");
  if (!root) return;
  const acts = (actions || []).map((a, i) => {
    const cls = ["pfm-btn"];
    if (a.primary) cls.push("pfm-btn-primary");
    if (a.danger)  cls.push("pfm-btn-danger");
    return `<button class="${cls.join(" ")}" data-i="${i}">${pfEsc(a.label)}</button>`;
  }).join("");
  root.innerHTML = `
    <div class="pfm-overlay"></div>
    <div class="pfm-dialog ${danger ? "pfm-danger" : ""} pfm-size-${size || "m"}" role="dialog" aria-modal="true">
      <div class="pfm-h">
        <h4>${pfEsc(title)}</h4>
        <button class="pfm-x" aria-label="Close">×</button>
      </div>
      <div class="pfm-b">${bodyHtml || ""}</div>
      ${acts ? `<div class="pfm-f">${acts}</div>` : ""}
    </div>`;
  root.hidden = false;
  requestAnimationFrame(() => root.classList.add("pfm-open"));

  const cleanup = () => {
    root.classList.remove("pfm-open");
    document.removeEventListener("keydown", onKey);
    setTimeout(() => { root.hidden = true; root.innerHTML = ""; }, 160);
  };
  const runCancel = () => {
    const c = (actions || []).find((a) => a.cancel);
    if (c && c.onClick) c.onClick();
  };
  const onKey = (e) => {
    if (e.key === "Escape") { cleanup(); runCancel(); }
    // Enter → primary if input focused
    if (e.key === "Enter" && document.activeElement?.tagName === "INPUT") {
      const p = (actions || []).find((a) => a.primary);
      if (p) { e.preventDefault(); const r = p.onClick ? p.onClick(cleanup) : true; if (r !== false) cleanup(); }
    }
  };
  document.addEventListener("keydown", onKey);

  root.querySelector(".pfm-overlay")?.addEventListener("click", () => { cleanup(); runCancel(); });
  root.querySelector(".pfm-x")?.addEventListener("click", () => { cleanup(); runCancel(); });
  $$(".pfm-btn", root).forEach((b) => b.addEventListener("click", () => {
    const a = actions[+b.dataset.i];
    const r = a?.onClick ? a.onClick(cleanup) : true;
    if (r !== false) cleanup();
  }));

  // Focus the first input if any
  setTimeout(() => {
    const f = root.querySelector("input,textarea,select");
    if (f) f.focus(), f.select?.();
    onOpen && onOpen(root);
  }, 30);
}

function pfPrompt({ title, label, value = "", placeholder = "", confirmLabel = "Save", onConfirm, validator }) {
  const inputHtml = `<label class="pfm-label">${pfEsc(label)}</label><input class="pfm-input" id="pfmInput" value="${pfEsc(value)}" placeholder="${pfEsc(placeholder)}" spellcheck="false"/><div class="pfm-error" id="pfmError" hidden></div>`;
  pfModalOpen({
    title,
    bodyHtml: inputHtml,
    actions: [
      { label: "Cancel", cancel: true },
      { label: confirmLabel, primary: true, onClick: () => {
        const v = document.getElementById("pfmInput")?.value.trim() || "";
        const err = validator ? validator(v) : (!v ? "This field is required." : null);
        if (err) {
          const e = document.getElementById("pfmError");
          if (e) { e.textContent = err; e.hidden = false; }
          return false;
        }
        onConfirm(v);
      }},
    ],
  });
}

function pfConfirm({ title, body, confirmLabel = "Confirm", danger = false, onConfirm }) {
  pfModalOpen({
    title,
    bodyHtml: `<p class="pfm-body-text">${pfEsc(body)}</p>`,
    danger,
    actions: [
      { label: "Cancel", cancel: true },
      { label: confirmLabel, primary: !danger, danger, onClick: () => onConfirm() },
    ],
  });
}

function pfToast(msg, kind = "info") {
  const root = document.getElementById("pfModalRoot");
  if (!root) return;
  const el = document.createElement("div");
  el.className = `pf-toast pf-toast-${kind}`;
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("pf-toast-in"));
  setTimeout(() => { el.classList.remove("pf-toast-in"); setTimeout(() => el.remove(), 220); }, 2600);
}

TABS.portfolio = {
  init() {
    this.portfolios = this._loadAll();
    this.activeId = localStorage.getItem(PF_ACTIVE_KEY) || (this.portfolios[0]?.id || null);
    this.universes = null;
    this._caches = Object.create(null);    // pid -> runtime cache
    this._colVis  = this._loadColVis();    // { colId: true/false }
    this._searchTimer = null;

    this._loadUniverses().then(() => this._renderHeader());
    this._wireStatic();
    this._renderAll();
    // NOTE (v43): no automatic scan on open. If the active portfolio has
    // companies but no cached rows, the screener shows a "Run technical
    // scan" prompt — indicators are only computed when the user asks.
    // This keeps the tab instant to open and never blocks the UI.
  },

  /* ── storage ─────────────────────────────────────────────────────── */
  _loadAll() { try { return JSON.parse(localStorage.getItem(PF_KEY) || "[]"); } catch { return []; } },
  _saveAll() { localStorage.setItem(PF_KEY, JSON.stringify(this.portfolios)); },
  _loadColVis() {
    try {
      const v = JSON.parse(localStorage.getItem(PF_COLS_KEY) || "null");
      if (v && typeof v === "object") {
        // Ensure new columns default to their def flag when missing from stored prefs
        const out = {};
        PF_COLS.forEach((c) => { out[c.id] = c.id === "name" ? true : (v[c.id] != null ? !!v[c.id] : !!c.def); });
        return out;
      }
    } catch { /* fall through */ }
    const d = {};
    PF_COLS.forEach((c) => { d[c.id] = !!c.def; });
    d.name = true;
    return d;
  },
  _saveColVis() { localStorage.setItem(PF_COLS_KEY, JSON.stringify(this._colVis)); },
  _visibleCols() { return PF_COLS.filter((c) => c.id === "name" || this._colVis[c.id] !== false); },

  _active() { return this.portfolios.find((p) => p.id === this.activeId); },

  /* ── per-portfolio runtime cache ─────────────────────────────────── */
  _cacheFor(id) {
    if (!id) return null;
    if (!this._caches[id]) {
      this._caches[id] = {
        rows: [], prevRows: {}, alerts: [], changes: [],
        activeFilters: new Set(),
        sortKey: "score", sortDir: -1,
        lastUpdate: null, loading: false, seeded: false,
      };
    }
    return this._caches[id];
  },
  _cache() { return this._cacheFor(this.activeId); },

  /* ── universe metadata ───────────────────────────────────────────── */
  async _loadUniverses() {
    try {
      const { universes } = await api("/api/portfolio/universes");
      this.universes = universes;
    } catch { this.universes = {}; }
  },

  /* ── static (one-time) DOM bindings ──────────────────────────────── */
  _wireStatic() {
    // Empty-state CTA
    $("#pfEmptyCreate")?.addEventListener("click", () => this._createPortfolioFlow());

    // Header: switcher
    const sb = $("#pfhSwitchBtn");
    if (sb) sb.addEventListener("click", (e) => { e.stopPropagation(); this._toggleSwitcher(); });

    // Header: actions
    $("#pfActAdd")?.addEventListener("click", (e) => { e.stopPropagation(); this._toggleAddPopover(); });
    $("#pfActRefresh")?.addEventListener("click", () => this.refresh({ force: true }));
    $("#pfhUpdRefresh")?.addEventListener("click", (e) => { e.stopPropagation(); this.refresh({ force: true }); });
    $("#pfActExport")?.addEventListener("click", () => this._exportCsv());
    $("#pfActSettings")?.addEventListener("click", (e) => { e.stopPropagation(); this._toggleSettings(); });

    // Insights: collapse + view-all-alerts
    $("#pfiCollapse")?.addEventListener("click", () => {
      const body = $("#pfiBody"), btn = $("#pfiCollapse");
      if (body.hasAttribute("hidden")) { body.removeAttribute("hidden"); btn.textContent = "⌃"; btn.setAttribute("aria-expanded", "true"); }
      else { body.setAttribute("hidden", ""); btn.textContent = "⌄"; btn.setAttribute("aria-expanded", "false"); }
    });
    $("#pfiViewAlerts")?.addEventListener("click", () => {
      const d = $("#pfiAlertsDetail"), btn = $("#pfiViewAlerts");
      if (d.hasAttribute("hidden")) { d.removeAttribute("hidden"); btn.textContent = "Hide Alerts ↑"; }
      else { d.setAttribute("hidden", ""); btn.textContent = "View All Alerts →"; }
    });
    $("#pfiChanges")?.addEventListener("click", (e) => {
      if (e.target && e.target.id === "pfiLogMore") { this._logExpanded = !this._logExpanded; this._renderChanges(); }
    });

    // Toolbar: search
    const s = $("#pfSearch");
    if (s) {
      s.addEventListener("input", () => this._onSearch());
      s.addEventListener("focus", () => this._onSearch());
    }

    // Toolbar: filter button
    $("#pfFilterBtn")?.addEventListener("click", (e) => { e.stopPropagation(); this._toggleFilterPanel(); });
    $("#pfClearAll")?.addEventListener("click", () => this._clearFilters());

    // Global: close popovers on outside click or Escape
    document.addEventListener("click", (e) => this._closePopoversOutside(e));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") this._closeAllPopovers(); });
  },

  _closePopoversOutside(e) {
    const t = e.target;
    // e.target can be the document or a text node (has no .closest) — guard it,
    // otherwise this document-level handler throws on every such click.
    const inside = (sel) => (t && typeof t.closest === "function") ? t.closest(sel) : null;
    if (!inside("#pfhSwitcher"))   $("#pfhSwitchMenu")?.setAttribute("hidden", "");
    if (!inside("#pfActAdd") && !inside("#pfAddPop")) $("#pfAddPop")?.setAttribute("hidden", "");
    if (!inside(".pft-filter-wrap")) $("#pfFilterPanel")?.setAttribute("hidden", "");
    if (!inside(".pfh-settings-wrap")) $("#pfSettingsMenu")?.setAttribute("hidden", "");
    if (!inside(".pft-search")) $("#pfSearchResults")?.setAttribute("hidden", "");
  },
  _closeAllPopovers() {
    ["#pfhSwitchMenu", "#pfAddPop", "#pfFilterPanel", "#pfSettingsMenu", "#pfSearchResults"].forEach((s) => {
      const el = $(s); if (el) el.hidden = true;
    });
  },

  /* ── switching portfolios (state isolation) ──────────────────────── */
  switchTo(id) {
    if (id === this.activeId) return;
    // save current cache (already lives in this._caches[activeId] — no snapshot needed)
    this.activeId = id;
    if (id) localStorage.setItem(PF_ACTIVE_KEY, id);
    else localStorage.removeItem(PF_ACTIVE_KEY);
    // Re-render ALL sections from the (possibly empty) new cache.
    // No auto-scan — if the target has no rows yet, the screener shows
    // its "Run technical scan" prompt instead of fetching on its own.
    this._renderAll();
  },

  /* ── CRUD via custom modals ──────────────────────────────────────── */
  _createPortfolioFlow() {
    const defName = `Portfolio ${this.portfolios.length + 1}`;
    pfPrompt({
      title: "Create Portfolio",
      label: "Portfolio name",
      value: defName,
      placeholder: "Growth Portfolio",
      confirmLabel: "Create",
      validator: (v) => !v ? "Name is required." :
                        (this.portfolios.some((p) => p.name.toLowerCase() === v.toLowerCase()) ? "A portfolio with that name already exists." : null),
      onConfirm: (name) => {
        const id = "p_" + Math.random().toString(36).slice(2, 9);
        this.portfolios.push({ id, name, universe: "nifty50", symbols: [], createdAt: Date.now(), updatedAt: Date.now() });
        this._saveAll();
        this.switchTo(id);
        pfToast(`Created “${name}”`, "success");
      },
    });
  },
  _renameFlow() {
    const p = this._active(); if (!p) return;
    pfPrompt({
      title: "Rename Portfolio",
      label: "New name",
      value: p.name,
      confirmLabel: "Save",
      validator: (v) => !v ? "Name is required." :
                        (this.portfolios.some((x) => x.id !== p.id && x.name.toLowerCase() === v.toLowerCase()) ? "Another portfolio already has that name." : null),
      onConfirm: (name) => {
        p.name = name; p.updatedAt = Date.now();
        this._saveAll();
        this._renderHeader();
        pfToast("Renamed", "success");
      },
    });
  },
  _deleteFlow() {
    const p = this._active(); if (!p) return;
    pfConfirm({
      title: "Delete Portfolio",
      body: `Delete “${p.name}” with ${p.symbols.length} compan${p.symbols.length === 1 ? "y" : "ies"}? This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
      onConfirm: () => {
        this.portfolios = this.portfolios.filter((x) => x.id !== p.id);
        delete this._caches[p.id];
        this._saveAll();
        const nextId = this.portfolios[0]?.id || null;
        this.activeId = nextId;
        if (nextId) localStorage.setItem(PF_ACTIVE_KEY, nextId);
        else localStorage.removeItem(PF_ACTIVE_KEY);
        this._renderAll();
        pfToast("Portfolio deleted", "info");
      },
    });
  },

  /* ── HEADER: switcher menu ───────────────────────────────────────── */
  _toggleSwitcher() {
    this._closeAllPopovers();
    const m = $("#pfhSwitchMenu"); if (!m) return;
    if (!m.hidden) { m.hidden = true; return; }
    m.innerHTML = `
      ${this.portfolios.map((p) => `
        <button class="pfh-switch-item ${p.id === this.activeId ? "on" : ""}" data-id="${p.id}">
          <span class="pfh-switch-nm">${pfEsc(p.name)}</span>
          <span class="pfh-switch-sub mono">${p.symbols.length}/${PF_MAX}</span>
        </button>`).join("")}
      <div class="pfh-switch-sep"></div>
      <button class="pfh-switch-item pfh-switch-new" id="pfhSwitchNew"><span>+ New portfolio</span></button>`;
    m.hidden = false;
    $$(".pfh-switch-item", m).forEach((b) => b.addEventListener("click", () => {
      if (b.id === "pfhSwitchNew") { m.hidden = true; this._createPortfolioFlow(); return; }
      m.hidden = true; this.switchTo(b.dataset.id);
    }));
  },

  /* ── HEADER: settings menu ───────────────────────────────────────── */
  _toggleSettings() {
    this._closeAllPopovers();
    const m = $("#pfSettingsMenu"); if (!m) return;
    if (!m.hidden) { m.hidden = true; return; }
    const universeOpts = this.universes
      ? Object.entries(this.universes).map(([k, v]) => `<option value="${k}">${pfEsc(v.label)} (${v.count})</option>`).join("")
      : "";
    m.innerHTML = `
      <div class="pfs-menu-group">
        <div class="pfs-menu-h">PORTFOLIO</div>
        <button class="pfs-menu-item" id="pfsRename"><span class="pfs-menu-i">✎</span>Rename portfolio</button>
        <button class="pfs-menu-item pfs-menu-danger" id="pfsDelete"><span class="pfs-menu-i">🗑</span>Delete portfolio</button>
      </div>
      <div class="pfs-menu-group">
        <div class="pfs-menu-h">MARKET UNIVERSE</div>
        <select class="pfs-menu-select" id="pfsUniverse">${universeOpts}</select>
      </div>
      <div class="pfs-menu-group">
        <div class="pfs-menu-h">SHOW COLUMNS</div>
        <div class="pfs-menu-cols">
          ${PF_COLS.filter((c) => c.id !== "name").map((c) => `
            <label class="pfs-menu-check">
              <input type="checkbox" data-col="${c.id}" ${this._colVis[c.id] === false ? "" : "checked"}>
              <span>${pfEsc(c.label)}</span>
            </label>`).join("")}
        </div>
      </div>`;
    m.hidden = false;

    const usel = $("#pfsUniverse");
    if (usel) {
      const p = this._active();
      if (p) usel.value = p.universe || "nifty50";
      usel.addEventListener("change", () => {
        const p2 = this._active(); if (!p2) return;
        p2.universe = usel.value; p2.updatedAt = Date.now();
        this._saveAll();
        this._renderHeader();
      });
    }
    $("#pfsRename")?.addEventListener("click", () => { m.hidden = true; this._renameFlow(); });
    $("#pfsDelete")?.addEventListener("click", () => { m.hidden = true; this._deleteFlow(); });
    $$("input[data-col]", m).forEach((cb) => cb.addEventListener("change", () => {
      this._colVis[cb.dataset.col] = cb.checked;
      this._saveColVis();
      this._renderScreener();
    }));
  },

  /* ── HEADER: Add-Companies popover (universe + top-N + hints) ────── */
  _toggleAddPopover() {
    this._closeAllPopovers();
    const p = this._active(); if (!p) return;
    const pop = $("#pfAddPop"); if (!pop) return;
    if (!pop.hidden) { pop.hidden = true; return; }
    const remaining = PF_MAX - p.symbols.length;
    const universeOpts = this.universes
      ? Object.entries(this.universes).map(([k, v]) => `<option value="${k}" ${k === p.universe ? "selected" : ""}>${pfEsc(v.label)} (${v.count})</option>`).join("")
      : "";
    pop.innerHTML = `
      <div class="pf-addpop-h">Add Companies</div>
      <div class="pf-addpop-sub mono">${remaining} of ${PF_MAX} slots available</div>
      <label class="pf-addpop-label">MARKET UNIVERSE</label>
      <select class="pf-addpop-select" id="pfAddUniverse">${universeOpts}</select>
      <div class="pf-addpop-row">
        <button class="pf-addpop-btn" data-n="5"  ${remaining < 1 ? "disabled" : ""}>+ Top 5</button>
        <button class="pf-addpop-btn" data-n="10" ${remaining < 1 ? "disabled" : ""}>+ Top 10</button>
        <button class="pf-addpop-btn" data-n="20" ${remaining < 1 ? "disabled" : ""}>+ Top 20</button>
      </div>
      <div class="pf-addpop-hint mono">Or use the search bar below the header to add companies one at a time.</div>`;
    pop.hidden = false;

    $("#pfAddUniverse")?.addEventListener("change", (e) => {
      const p2 = this._active(); if (!p2) return;
      p2.universe = e.target.value; p2.updatedAt = Date.now();
      this._saveAll();
      this._renderHeader();
    });
    $$(".pf-addpop-btn", pop).forEach((b) => b.addEventListener("click", () => {
      const n = parseInt(b.dataset.n, 10);
      pop.hidden = true;
      this._addTopFromUniverse(n);
    }));
  },
/* ── TOOLBAR: filter panel (grouped popover) ─────────────────────── */
  _toggleFilterPanel() {
    this._closeAllPopovers();
    const c = this._cache(); if (!c) return;
    const panel = $("#pfFilterPanel"); if (!panel) return;
    if (!panel.hidden) { panel.hidden = true; return; }
    const groups = PF_FILTER_GROUPS.map((g) => `
      <div class="pft-fg">
        <div class="pft-fg-h">${g.title}</div>
        <div class="pft-fg-list">
          ${g.items.map((f) => `
            <label class="pft-fg-item">
              <input type="checkbox" data-fid="${f.id}" ${c.activeFilters.has(f.id) ? "checked" : ""}>
              <span>${pfEsc(f.label)}</span>
            </label>`).join("")}
        </div>
      </div>`).join("");
    panel.innerHTML = `
      <div class="pft-fp-h">
        <span>Filters</span>
        <button class="pft-fp-clear" id="pfFpClear">Clear all</button>
      </div>
      <div class="pft-fp-b">${groups}</div>
      <div class="pft-fp-f">
        <button class="pft-fp-reset" id="pfFpReset">Reset</button>
        <button class="pft-fp-apply" id="pfFpApply">Apply</button>
      </div>`;
    panel.hidden = false;

    // Local (draft) filter set inside the panel — only committed on Apply
    const draft = new Set(c.activeFilters);
    $$("input[data-fid]", panel).forEach((cb) => cb.addEventListener("change", () => {
      if (cb.checked) draft.add(cb.dataset.fid); else draft.delete(cb.dataset.fid);
    }));
    $("#pfFpClear")?.addEventListener("click", () => {
      draft.clear();
      $$("input[data-fid]", panel).forEach((cb) => (cb.checked = false));
    });
    $("#pfFpReset")?.addEventListener("click", () => {
      draft.clear();
      $$("input[data-fid]", panel).forEach((cb) => (cb.checked = false));
      c.activeFilters = new Set();
      panel.hidden = true;
      this._renderToolbar();
      this._renderScreener();
    });
    $("#pfFpApply")?.addEventListener("click", () => {
      c.activeFilters = new Set(draft);
      panel.hidden = true;
      this._renderToolbar();
      this._renderScreener();
    });
  },
  _clearFilters() {
    const c = this._cache(); if (!c) return;
    c.activeFilters.clear();
    this._renderToolbar();
    this._renderScreener();
  },

  /* ── TOOLBAR: search & add ───────────────────────────────────────── */
  _onSearch() {
    const s = $("#pfSearch"), out = $("#pfSearchResults");
    if (!s || !out) return;
    const q = s.value.trim();
    if (q.length < 2) { out.hidden = true; return; }
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(async () => {
      try {
        const { results } = await api(`/api/search?q=${encodeURIComponent(q)}`);
        if (!results || !results.length) { out.hidden = true; return; }
        out.innerHTML = results.slice(0, 8).map((r) => `
          <button class="cmd-result" data-s="${pfEsc(r.symbol)}">
            <span class="sym">${pfEsc(r.symbol)}</span>
            <span class="nm">${pfEsc(r.name)}</span>
            <span class="ex">${pfEsc(r.exchange)}</span>
          </button>`).join("");
        out.hidden = false;
        $$(".cmd-result", out).forEach((b) => b.addEventListener("click", () => {
          this._addSymbol(b.dataset.s);
          s.value = ""; out.hidden = true;
        }));
      } catch { out.hidden = true; }
    }, 200);
  },

  async _addSymbol(symbol) {
    const p = this._active(); if (!p) return;
    symbol = String(symbol || "").trim().toUpperCase();
    if (!symbol) return;
    if (p.symbols.some((s) => s.symbol === symbol)) { pfToast(`${symbol} already in portfolio`, "info"); return; }
    if (p.symbols.length >= PF_MAX) {
      pfConfirm({ title: "Portfolio full", body: `This portfolio already has ${PF_MAX} companies. Remove one before adding another.`, confirmLabel: "Got it", onConfirm: () => {} });
      return;
    }
    p.symbols.push({ symbol, name: symbol, sector: "—" });
    p.updatedAt = Date.now();
    this._saveAll();
    this._logChange("add", symbol);
    this._renderHeader();
    this._renderChips();
    if (window.PA) try { PA.sync(this); } catch (e) {}

    // Enrich metadata
    try {
      const meta = await api(`/api/portfolio/meta/${encodeURIComponent(symbol)}`);
      const slot = p.symbols.find((s) => s.symbol === symbol);
      if (slot) { slot.name = meta.name || symbol; slot.sector = meta.sector || "—"; this._saveAll(); this._renderChips(); if (window.PA) try { PA.sync(this); } catch (e) {} }
    } catch { /* refresh will backfill */ }
    this.refresh();
  },
  _removeSymbol(symbol) {
    const p = this._active(); if (!p) return;
    const slot = p.symbols.find((s) => s.symbol === symbol);
    p.symbols = p.symbols.filter((s) => s.symbol !== symbol);
    p.updatedAt = Date.now();
    this._saveAll();
    // Drop this symbol from the runtime cache too so charts/analytics update immediately
    const c = this._cache();
    if (c) {
      c.rows = c.rows.filter((r) => r.symbol !== symbol);
      delete c.prevRows[symbol];
    }
    this._logChange("remove", symbol, slot?.name);
    this._renderHeader();
    this._renderChips();
    this._renderScreener();
    this._renderAnalytics();
  },
  _addTopFromUniverse(n) {
    const p = this._active(); if (!p) return;
    const u = this.universes?.[p.universe || "nifty50"];
    if (!u || !u.symbols.length) { pfToast("This universe has no preset list — use search instead.", "info"); return; }
    const remaining = PF_MAX - p.symbols.length;
    if (remaining <= 0) { pfToast(`Portfolio is full (${PF_MAX} names).`, "info"); return; }
    const take = Math.min(n, remaining);
    const have = new Set(p.symbols.map((s) => s.symbol));
    const toAdd = u.symbols.filter((s) => !have.has(s)).slice(0, take);
    if (!toAdd.length) { pfToast("All top names from this universe are already in the portfolio.", "info"); return; }
    toAdd.forEach((s) => p.symbols.push({ symbol: s, name: s, sector: "—" }));
    p.updatedAt = Date.now();
    this._saveAll();
    this._logChange("bulk", `+${toAdd.length} names`, u.label);
    this._renderHeader();
    this._renderChips();
    if (window.PA) try { PA.sync(this); } catch (e) {}
    this.refresh();
    pfToast(`Added ${toAdd.length} companies from ${u.label}`, "success");
  },
  _logChange(kind, primary, secondary) {
    const c = this._cache(); if (!c) return;
    c.changes.unshift({ kind, primary, secondary: secondary || "", ts: Date.now() });
    c.changes = c.changes.slice(0, 40);
    this._renderChanges();
  },

  /* ── data fetch ──────────────────────────────────────────────────── */
  /* Chunked, cancellable technical scan (v43).
     The previous implementation sent all 20 names in one request and
     repainted only when everything returned — on slow hosts that read as a
     frozen screen. Now: batches of 5, rows painted as each batch lands, a
     generation token cancels stale scans (switch/delete/re-run), and the
     event loop is yielded between batches so the UI never locks. */
  /* ── LIVE QUOTE LAYER (every 15s in market hours, driven by liveRefreshTick).
     One batch /api/quotes call → cell-level DOM patches with a gold flash on
     values that actually changed. No re-render, no layout shift, selection
     and sort untouched. The full technical re-scan stays on its own slower
     cadence in refresh(). ── */
  async refreshQuotes() {
    if (this._quotesBusy || document.hidden) return;
    const p = this._active(); if (!p || !p.symbols || !p.symbols.length) return;
    const c = this._cache(); if (!c || !c.rows || !c.rows.length) return;
    this._quotesBusy = true;
    try {
      const syms = p.symbols.map((s) => s.symbol).slice(0, 30);
      const { quotes } = await api(`/api/quotes?symbols=${encodeURIComponent(syms.join(","))}`);
      const bySym = Object.fromEntries((quotes || []).filter((q) => q && !q.error && q.price != null).map((q) => [q.symbol, q]));
      let touched = false;
      for (const row of c.rows) {
        const q = bySym[row.symbol];
        if (!q) continue;
        const changed = row.price != null && Math.abs(row.price - q.price) > 1e-9;
        if (!changed && row.price != null) continue;
        row.price = q.price;
        if (q.changePct != null) row.changePct = q.changePct;
        touched = true;
        const tr = document.querySelector(`#pfScreener tr.pfs-row[data-s="${CSS.escape(row.symbol)}"]`);
        if (!tr) continue;
        const pxCell = tr.querySelector(".pfs-c-price");
        if (pxCell) { pxCell.textContent = F.num(q.price, 2); pxCell.classList.remove("pfs-dim"); if (changed) goldFlash(pxCell); }
        const chCell = tr.querySelector(".pfs-c-chg");
        if (chCell && q.changePct != null) {
          chCell.textContent = F.pct(q.changePct, 2);
          chCell.className = `pfs-c-chg ${F.cls(q.changePct)}`;
          if (changed) goldFlash(chCell);
        }
      }
      /* keep the PA workspace header price in step with the quote layer */
      if (touched && typeof PA !== "undefined" && PA._mounted && PA.state && PA.state.symbol) {
        try { PA._renderHead(); } catch { }
      }
    } catch { /* transient quote failures are silent — next tick retries */ }
    finally { this._quotesBusy = false; }
  },

  async refresh(opts = {}) {
    const p = this._active(); if (!p) return;
    const c = this._cache(); if (!c) return;
    if (!p.symbols.length) {
      c.rows = []; c.seeded = true;
      this._renderScreener(); this._renderAnalytics(); this._renderAlerts();
      return;
    }
    if (c.loading && !opts.force) return;

    const forId = this.activeId;
    const gen = (c.scanGen = (c.scanGen || 0) + 1);
    c.loading = true;
    this._paintRefreshButton(true);

    const symbols = p.symbols.map((s) => s.symbol);
    const prevMap = Object.fromEntries((c.rows || []).map((r) => [r.symbol, r]));
    const CHUNK = 5;
    const batches = [];
    for (let i = 0; i < symbols.length; i += CHUNK) batches.push(symbols.slice(i, i + CHUNK));

    const collected = Object.create(null);
    let done = 0, failedBatches = 0;
    c.pendingScan = symbols.length;
    if (!c.seeded && !c.rows.length) this._renderScreenerSkeleton(Math.min(symbols.length, 6));
    this._paintStatus(`Scanning 0/${symbols.length} — indicators compute per batch…`);

    const stale = () => { const t = this._cacheFor(forId); return !t || t.scanGen !== gen || !this.portfolios.some((x) => x.id === forId); };

    for (const batch of batches) {
      if (stale()) return;
      try {
        const resp = await api("/api/portfolio/technicals", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbols: batch }),
        });
        if (stale()) return;
        const target = this._cacheFor(forId);
        (resp.rows || []).forEach((r) => { if (r && r.symbol) collected[r.symbol] = r; });
        done += batch.length;
        // progressive merge in portfolio order; unscanned names keep last rows
        target.rows = symbols.map((s) => collected[s] || prevMap[s]).filter(Boolean);
        target.lastUpdate = resp.asOf || Date.now();
        target.pendingScan = symbols.length - done;
        if (forId === this.activeId) {
          this._renderScreener();
          this._renderHeader();
          this._paintStatus(done < symbols.length ? `Scanning ${done}/${symbols.length}…` : "Finalising…");
        }
      } catch (e) {
        failedBatches++;
        done += batch.length;
        if (forId === this.activeId) this._paintStatus(`Scanning ${Math.min(done, symbols.length)}/${symbols.length} — one batch failed, continuing…`);
      }
      // yield so paints/input land between batches
      await new Promise((r) => setTimeout(r, 30));
    }

    if (stale()) return;
    const target = this._cacheFor(forId);
    target.loading = false;
    target.pendingScan = 0;
    const newRows = symbols.map((s) => collected[s]).filter(Boolean);

    if (newRows.length) {
      // event detection versus the pre-scan snapshot
      this._detectEvents(target, newRows, prevMap);
      if (Object.keys(prevMap).length) target.prevRows = prevMap;
      target.seeded = true;

      // Propagate server-side name/sector back to the saved portfolio def
      const pTarget = this.portfolios.find((x) => x.id === forId);
      if (pTarget) {
        let touched = false;
        pTarget.symbols.forEach((s) => {
          const r = collected[s.symbol];
          if (r && !r.error) {
            if (r.name && r.name !== s.name) { s.name = r.name; touched = true; }
            if (r.sector && r.sector !== s.sector) { s.sector = r.sector; touched = true; }
          }
        });
        if (touched) { this._saveAll(); if (forId === this.activeId) this._renderChips(); }
      }
    }

    if (forId === this.activeId) {
      this._renderScreener();
      this._renderAnalytics();
      this._renderAlerts();
      this._renderHeader();
      const ok  = target.rows.filter((r) => r && !r.error).length;
      const err = target.rows.length - ok;
      this._paintStatus(!newRows.length
        ? "Scan failed — check the connection and press refresh to retry."
        : `${ok} ready${err ? " · " + err + " unavailable" : ""}${failedBatches ? " · partial (retry refreshes the rest)" : ""}`);
      this._paintRefreshButton(false);
    }
  },
  _paintRefreshButton(loading) {
    const btn = $("#pfActRefresh"); const i = $("#pfActRefreshI");
    if (!btn || !i) return;
    btn.classList.toggle("pfh-btn-loading", !!loading);
  },
  _paintStatus(text) {
    const s = $("#pfsStatus"); if (s) s.textContent = text || "";
    const t = $("#pfhUpdated"), c = this._cache();
    if (t) t.textContent = c && c.lastUpdate ? new Date(c.lastUpdate).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
  },

  /* ── Technical event detection (per target cache) ────────────────── */
  _detectEvents(target, nextRows, prevByOverride) {
    if (!target) return;
    const prevBy = prevByOverride || (target.rows && target.rows.length ? Object.fromEntries(target.rows.map((r) => [r.symbol, r])) : null);
    if (!prevBy || !Object.keys(prevBy).length) return;
    const events = [];
    nextRows.forEach((r) => {
      if (!r || r.error) return;
      const prev = prevBy[r.symbol]; if (!prev || prev.error) return;
      const ev = (kind, text) => events.push({ symbol: r.symbol, name: r.name, kind, text, ts: Date.now() });
      if (prev.signal !== r.signal) ev("signal", `Signal: ${prev.signal} → ${r.signal}`);
      if (prev.trend?.aboveEma200 === false && r.trend?.aboveEma200 === true) ev("trend", "Crossed above EMA200");
      if (prev.trend?.aboveEma200 === true && r.trend?.aboveEma200 === false) ev("trend", "Crossed below EMA200");
      if (prev.momentum?.macdBullish === false && r.momentum?.macdBullish === true) ev("momentum", "MACD bullish crossover");
      if (prev.momentum?.macdBullish === true && r.momentum?.macdBullish === false) ev("momentum", "MACD bearish crossover");
      if (!prev.trend?.goldenCross && r.trend?.goldenCross) ev("trend", "Golden Cross formed");
      if (!prev.trend?.deathCross && r.trend?.deathCross) ev("trend", "Death Cross formed");
      if (!prev.volatility?.breakoutUp && r.volatility?.breakoutUp) ev("breakout", "Upside breakout (Donchian 20)");
      if (!prev.volatility?.breakoutDown && r.volatility?.breakoutDown) ev("breakout", "Downside break (Donchian 20)");
      const pR = prev.momentum?.rsi, nR = r.momentum?.rsi;
      if (Number.isFinite(pR) && Number.isFinite(nR)) {
        if (pR <= 60 && nR > 60) ev("momentum", "RSI crossed above 60");
        if (pR >= 30 && nR < 30) ev("momentum", "RSI dropped below 30");
        if (pR <= 70 && nR > 70) ev("momentum", "RSI crossed above 70");
      }
      if ((prev.volume?.spike || 0) < 2 && (r.volume?.spike || 0) >= 2) ev("volume", `Volume spike · ${r.volume.spike.toFixed(1)}× avg`);
      if (Number.isFinite(r.priceAction?.distHigh52) && r.priceAction.distHigh52 >= -0.1 &&
          (!Number.isFinite(prev.priceAction?.distHigh52) || prev.priceAction.distHigh52 < -0.1))
        ev("price", "New 52-week high");
      if (Number.isFinite(r.priceAction?.distLow52) && r.priceAction.distLow52 <= 0.1 &&
          (!Number.isFinite(prev.priceAction?.distLow52) || prev.priceAction.distLow52 > 0.1))
        ev("price", "New 52-week low");
    });
    if (events.length) target.alerts = events.concat(target.alerts).slice(0, 80);
  },

  /* ── RENDER: coordinator (single source of truth) ────────────────── */
  _renderAll() {
    const empty = !this.portfolios.length;
    $("#pfEmptyShell").hidden = !empty;
    $("#pfWorkspace").hidden = empty;
    if (empty) return;
    // If we have portfolios but none is active, make one active
    if (!this._active() && this.portfolios.length) {
      this.activeId = this.portfolios[0].id;
      localStorage.setItem(PF_ACTIVE_KEY, this.activeId);
    }
    this._renderHeader();
    this._renderToolbar();
    this._renderChips();
    this._renderScreener();
    this._renderAnalytics();
    this._renderAlerts();
    this._renderChanges();
    if (window.PA) try { PA.sync(this); } catch (e) { console.warn("price-action sync:", e); }
  },

  /* ── RENDER: header ──────────────────────────────────────────────── */
  _renderHeader() {
    const p = this._active(); if (!p) return;
    const c = this._cache();
    $("#pfhBread").textContent = p.name;
    $("#pfhTitle").textContent = p.name;
    const uName = this.universes?.[p.universe || "nifty50"]?.label || (p.universe || "—");
    $("#pfhUniverse").textContent = uName;
    $("#pfhCount").textContent = p.symbols.length;
    const upd = c?.lastUpdate ? new Date(c.lastUpdate).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
    $("#pfhUpdated").textContent = upd;
    const dt = $("#pfiDataTime"); if (dt) dt.textContent = upd;
    this._renderStatStrip();
  },

  /* ── RENDER: stats strip (Health · Score · signal counts · breakouts · bull/bear) ── */
  _renderStatStrip() {
    const host = $("#pfStatStrip"); if (!host) return;
    const c = this._cache();
    const rows = (c?.rows || []).filter((r) => r && !r.error);
    const n = rows.length;
    const avg = pfMean(rows.map((r) => r.score));
    const avgScore = avg == null ? null : Math.round(avg);
    const health = pfTechHealth(rows);
    const hBand = pfHealthBand(health), sBand = pfHealthBand(avgScore);
    const counts = { "Strong Buy": 0, "Buy": 0, "Accumulate": 0, "Watch": 0, "Hold": 0, "Avoid": 0 };
    rows.forEach((r) => { if (counts[r.signal] != null) counts[r.signal]++; });
    const brk = rows.filter((r) => r.volatility?.breakoutUp).length;
    const bull = rows.filter((r) => /Bullish/.test(r.trend?.direction || "")).length;
    const bear = rows.filter((r) => /Bearish/.test(r.trend?.direction || "")).length;
    const neu = n - bull - bear;
    const pctOf = (x) => n ? Math.round((x / n) * 100) : 0;
    const series = this._pfIndexSeries(rows);

    const dash = "<span class='pfstat-dash'>—</span>";
    const metric = (label, big, unit, band, spark, sparkColor) => `
      <div class="pfstat-cell pfstat-metric">
        <div class="pfstat-k">${label}</div>
        <div class="pfstat-metricrow">
          <div class="pfstat-big" style="color:${band.color}">${big == null ? "—" : big}<span class="pfstat-unit">${big == null ? "" : unit}</span></div>
          <div class="pfstat-spark">${series.length > 2 ? this._spark(series, sparkColor) : ""}</div>
        </div>
        <div class="pfstat-band" style="color:${band.color}">${band.label}</div>
      </div>`;
    const countCell = (label, val, pct, cls, warn) => `
      <div class="pfstat-cell pfstat-count">
        <div class="pfstat-k">${label}</div>
        <div class="pfstat-cval ${cls}">${n ? val : dash}</div>
        <div class="pfstat-cpct ${cls}">${warn && n ? "⚑ " : ""}${n ? pct + "%" : ""}</div>
      </div>`;

    host.innerHTML = `
      ${metric("Technical Health", health, "/100", hBand, series, "#3fbf7f")}
      ${metric("Avg Technical Score", avgScore, "/100", sBand, series, "#5b8fd6")}
      ${countCell("Strong Buy", counts["Strong Buy"], pctOf(counts["Strong Buy"]), "pfstat-pos")}
      ${countCell("Buy", counts["Buy"], pctOf(counts["Buy"]), "pfstat-pos")}
      ${countCell("Watch", counts["Watch"], pctOf(counts["Watch"]), "pfstat-amber", true)}
      ${countCell("Avoid", counts["Avoid"], pctOf(counts["Avoid"]), "pfstat-neg", true)}
      ${countCell("Breakouts", brk, pctOf(brk), "pfstat-blue")}
      <div class="pfstat-cell pfstat-bb">
        <div class="pfstat-k">Bullish vs Bearish</div>
        ${this._bullBearBar(bull, neu, bear)}
      </div>`;
  },

  /* Equal-weight rebased index series (≤60 sessions) from per-row spark closes. */
  _pfIndexSeries(rows) {
    const sparks = rows
      .map((r) => (Array.isArray(r.spark) ? r.spark.filter((v) => Number.isFinite(v) && v > 0) : []))
      .filter((a) => a.length >= 10);
    if (!sparks.length) return [];
    const L = Math.min(60, ...sparks.map((a) => a.length));
    const series = [];
    for (let i = 0; i < L; i++) {
      let s = 0;
      for (const a of sparks) { const w = a.slice(-L); s += (w[i] / w[0]) * 100; }
      series.push(s / sparks.length);
    }
    return series;
  },

  _spark(series, color, w = 116, h = 34) {
    if (!series || series.length < 2) return "";
    const mn = Math.min(...series), mx = Math.max(...series), sp = (mx - mn) || 1;
    const x = (i) => (i / (series.length - 1)) * w;
    const y = (v) => h - 3 - ((v - mn) / sp) * (h - 6);
    const pts = series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const gid = "sg" + Math.random().toString(36).slice(2, 8);
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="pfstat-sparksvg">
      <defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity="0.28"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      <polygon points="0,${h} ${pts} ${w},${h}" fill="url(#${gid})"/>
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
    </svg>`;
  },

  _bullBearBar(bull, neu, bear) {
    const total = bull + neu + bear;
    if (!total) return `<div class="pfstat-bb-empty mono">—</div>`;
    const pct = (x) => (x / total) * 100;
    return `
      <div class="pfstat-bbbar">
        ${bull ? `<span style="width:${pct(bull)}%;background:#3fbf7f"></span>` : ""}
        ${neu ? `<span style="width:${pct(neu)}%;background:#6a778a"></span>` : ""}
        ${bear ? `<span style="width:${pct(bear)}%;background:#d15b4a"></span>` : ""}
      </div>
      <div class="pfstat-bblabels">
        <div class="pfstat-bbl"><b class="pfstat-pos">${bull}</b><span>Bullish</span></div>
        <div class="pfstat-bbl"><b>${neu}</b><span>Neutral</span></div>
        <div class="pfstat-bbl"><b class="pfstat-neg">${bear}</b><span>Bearish</span></div>
      </div>`;
  },

  /* ── RENDER: toolbar (active-filter chips + Clear all) ───────────── */
  _renderToolbar() {
    const c = this._cache(); if (!c) return;
    const badge = $("#pfFilterBadge");
    if (badge) {
      if (c.activeFilters.size) { badge.textContent = c.activeFilters.size; badge.hidden = false; }
      else badge.hidden = true;
    }
    const host = $("#pfActiveFilters");
    if (host) {
      host.innerHTML = [...c.activeFilters].map((fid) => {
        const f = PF_FILTER_BY_ID[fid]; if (!f) return "";
        return `<span class="pft-af-chip" data-f="${fid}">${pfEsc(f.label)}<button class="pft-af-x" data-rm="${fid}" aria-label="Remove filter">×</button></span>`;
      }).join("");
      $$(".pft-af-x", host).forEach((b) => b.addEventListener("click", () => {
        c.activeFilters.delete(b.dataset.rm);
        this._renderToolbar();
        this._renderScreener();
      }));
    }
    $("#pfClearAll").hidden = c.activeFilters.size === 0;
  },

  /* ── RENDER: company chips (compact + hover card + overflow) ─────── */
  _renderChips() {
    const p = this._active(), c = this._cache(); if (!p) return;
    const host = $("#pfChipsRow"); if (!host) return;
    if (!p.symbols.length) {
      host.innerHTML = `<div class="pfc-empty mono">No companies yet. Use the search bar below or “Add Companies” in the header to add up to ${PF_MAX} names.</div>`;
      return;
    }
    const MAX_INLINE = 12;
    const shown  = p.symbols.slice(0, MAX_INLINE);
    const extra  = p.symbols.length - shown.length;
    const rowBy  = c ? Object.fromEntries(c.rows.map((r) => [r.symbol, r])) : {};
    const chipHtml = (s) => {
      const r = rowBy[s.symbol];
      const tip = r && !r.error
        ? `${pfEsc(s.name || s.symbol)} · ${pfEsc(s.sector || "—")}\n${r.currency || ""} ${r.price?.toFixed(2) ?? "—"} · Score ${r.score ?? "—"} · ${r.signal ?? "—"}`
        : `${pfEsc(s.name || s.symbol)} · ${pfEsc(s.sector || "—")}`;
      return `<span class="pfc-chip" data-s="${pfEsc(s.symbol)}" title="${tip.replace(/"/g,'&quot;')}">
        <span class="pfc-chip-sym">${pfEsc(s.symbol)}</span>
        <button class="pfc-chip-x" data-rm="${pfEsc(s.symbol)}" aria-label="Remove">×</button>
      </span>`;
    };
    host.innerHTML = shown.map(chipHtml).join("") +
      (extra > 0 ? `<button class="pfc-more" id="pfcMore">+${extra} more</button>` : "");
    $$(".pfc-chip-x", host).forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); this._removeSymbol(b.dataset.rm); }));
    $("#pfcMore")?.addEventListener("click", () => this._showAllChipsModal());
  },
  _showAllChipsModal() {
    const p = this._active(), c = this._cache(); if (!p) return;
    const rowBy = c ? Object.fromEntries(c.rows.map((r) => [r.symbol, r])) : {};
    const body = `<div class="pfc-modal-list">${p.symbols.map((s) => {
      const r = rowBy[s.symbol];
      const sig = r && !r.error ? r.signal : "—";
      const sc  = r && !r.error ? r.score : "—";
      return `<div class="pfc-modal-row">
        <div class="pfc-modal-sym">${pfEsc(s.symbol)}</div>
        <div class="pfc-modal-nm">${pfEsc(s.name || s.symbol)}<span class="pfc-modal-sec">${pfEsc(s.sector || "—")}</span></div>
        <div class="pfc-modal-sc mono">${sc}</div>
        <div class="pfc-modal-sig">${pfEsc(sig)}</div>
        <button class="pfc-modal-rm" data-rm="${pfEsc(s.symbol)}">Remove</button>
      </div>`;
    }).join("")}</div>`;
    pfModalOpen({
      title: `Companies in ${p.name} (${p.symbols.length}/${PF_MAX})`,
      bodyHtml: body, size: "l",
      actions: [{ label: "Done", primary: true }],
      onOpen: (root) => {
        $$("[data-rm]", root).forEach((b) => b.addEventListener("click", () => {
          this._removeSymbol(b.dataset.rm);
          b.closest(".pfc-modal-row").remove();
        }));
      },
    });
  },

  /* ── RENDER: screener ───────────────────────────────────────────── */
  _renderScreenerSkeleton(rows = 8) {
    const t = $("#pfScreener"); if (!t) return;
    const cols = this._visibleCols();
    const head = `<thead><tr>${cols.map((c, i) => `<th class="${i === 0 ? "pfs-sticky" : ""}">${c.label}</th>`).join("")}</tr></thead>`;
    const bodyRows = Array.from({ length: rows }).map(() =>
      `<tr class="pfs-sk-row">${cols.map((c, i) => `<td class="${i === 0 ? "pfs-sticky" : ""}"><span class="pfs-sk"></span></td>`).join("")}</tr>`
    ).join("");
    t.innerHTML = head + `<tbody>${bodyRows}</tbody>`;
    $("#pfsCount").textContent = "";
  },
  _renderScreener() {
    const t = $("#pfScreener"); if (!t) return;
    const p = this._active(), c = this._cache(); if (!p) return;
    const cols = this._visibleCols();

    if (!p.symbols.length) {
      t.innerHTML = `<thead><tr>${cols.map((c, i) => `<th class="${i === 0 ? "pfs-sticky" : ""}">${c.label}</th>`).join("")}</tr></thead><tbody><tr><td class="pfs-empty-row" colspan="${cols.length}">No companies in this portfolio yet. Add up to ${PF_MAX} names to begin screening.</td></tr></tbody>`;
      $("#pfsCount").textContent = "0 companies";
      return;
    }

    // v43: nothing scanned yet → explicit prompt. The scan is user-initiated;
    // it never fires just because the tab was opened.
    if (!c.seeded && !c.loading && !(c.rows || []).length) {
      t.innerHTML = `<thead><tr>${cols.map((col, i) => `<th class="${i === 0 ? "pfs-sticky" : ""}">${col.label}</th>`).join("")}</tr></thead>
        <tbody><tr><td colspan="${cols.length}" class="pfs-empty-row pfs-scan-cell">
          <div class="pfs-scan-cta">
            <div class="pfs-scan-t mono">READY TO SCAN</div>
            <div class="pfs-scan-b">${p.symbols.length} compan${p.symbols.length === 1 ? "y is" : "ies are"} in this portfolio. Run the technical scan to compute trend, momentum, oscillators, volume, volatility and price-action indicators on every name.</div>
            <button class="pfs-scan-btn" id="pfsRunScan">▶ Run technical scan</button>
            <div class="pfs-scan-n mono">~2s per 5 names · results stream in as they compute</div>
          </div>
        </td></tr></tbody>`;
      $("#pfsCount").textContent = `${p.symbols.length} compan${p.symbols.length === 1 ? "y" : "ies"} · not scanned yet`;
      $("#pfsRunScan")?.addEventListener("click", () => this.refresh());
      return;
    }

    // first-ever scan, nothing streamed in yet → light skeleton
    if (c.loading && !c.seeded && !(c.rows || []).length) { this._renderScreenerSkeleton(Math.min(p.symbols.length, 6)); return; }

    const rows = (c.rows || []).filter((r) => r && !r.error).map((r) => this._derive(r));
    const filtered = rows.filter((r) => {
      if (!c.activeFilters.size) return true;
      for (const fid of c.activeFilters) {
        const f = PF_FILTER_BY_ID[fid];
        if (f && f.fn(r.raw)) return true;
      }
      return false;
    });
    filtered.sort((a, b) => {
      const x = a[c.sortKey], y = b[c.sortKey];
      const xn = Number.isFinite(x) ? x : (typeof x === "string" ? x : -Infinity);
      const yn = Number.isFinite(y) ? y : (typeof y === "string" ? y : -Infinity);
      if (typeof xn === "string" || typeof yn === "string") return String(xn).localeCompare(String(yn)) * c.sortDir;
      if (xn === yn) return 0;
      return xn < yn ? -c.sortDir : c.sortDir;
    });

    const head = `<thead><tr>${cols.map((col, i) => {
      const arrow = c.sortKey === col.sort ? (c.sortDir < 0 ? " ↓" : " ↑") : "";
      return `<th class="${i === 0 ? "pfs-sticky" : ""}" data-k="${col.sort}" title="${pfEsc(col.tip)}">${col.label}${arrow}</th>`;
    }).join("")}</tr></thead>`;

    const errorRows = (c.rows || []).filter((r) => r && r.error);
    const bodyRows = filtered.map((d) => this._renderRow(d, c.prevRows[d.symbol], cols)).join("") +
      errorRows.map((e) => `<tr class="pfs-row pfs-row-err">
        <td class="pfs-sticky pfs-name"><div class="pfs-name-b"><div class="pfs-name-sym">${pfEsc(e.symbol)}</div><div class="pfs-name-nm">${pfEsc(e.name || "")}</div></div></td>
        <td class="pfs-err-cell" colspan="${cols.length - 1}">⚠ ${pfEsc(e.error || "Data unavailable")}</td>
      </tr>`).join("");

    if (!filtered.length && !errorRows.length) {
      t.innerHTML = head + `<tbody><tr><td class="pfs-empty-row" colspan="${cols.length}">${rows.length ? "No companies match the active filters." : "Waiting for indicators…"}</td></tr></tbody>`;
    } else {
      t.innerHTML = head + `<tbody>${bodyRows}</tbody>`;
    }

    // Bind header sort
    $$("thead th[data-k]", t).forEach((th) => th.addEventListener("click", () => {
      if (c.sortKey === th.dataset.k) c.sortDir *= -1; else { c.sortKey = th.dataset.k; c.sortDir = -1; }
      this._renderScreener();
    }));
    // Bind name-cell clicks to load company in Research
    $$(".pfs-name-a", t).forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); loadCompany(a.dataset.s); }));

    const totalOk = rows.length;
    $("#pfsCount").textContent = c.activeFilters.size
      ? `${filtered.length} of ${totalOk} matching · ${errorRows.length ? errorRows.length + " unavailable" : ""}`.replace(/·\s*$/, "").trim()
      : `${totalOk} compan${totalOk === 1 ? "y" : "ies"}${errorRows.length ? " · " + errorRows.length + " unavailable" : ""}`;
  },

  /** Map raw indicator pack → flat sortable/filterable row. */
  _derive(r) {
    const t = r.trend || {}, m = r.momentum || {}, o = r.oscillators || {}, v = r.volume || {}, vo = r.volatility || {}, pa = r.priceAction || {};
    const trendOrder = { "Strong Bullish": 5, "Bullish": 4, "Neutral": 3, "Bearish": 2, "Strong Bearish": 1 };
    return {
      raw: r,
      symbol: r.symbol, name: r.name, sector: r.sector || "—", currency: r.currency || "",
      price: r.price, changePct: r.changePct,
      trendDir: trendOrder[t.direction] ?? 0, direction: t.direction,
      rsi: m.rsi, adx: m.adx, macdHist: m.macdHist, macdBullish: m.macdBullish, roc: m.roc,
      ema20: t.ema20, ema50: t.ema50, ema200: t.ema200,
      ema20Rel: t.ema20 ? (r.price / t.ema20 - 1) * 100 : null,
      ema50Rel: t.ema50 ? (r.price / t.ema50 - 1) * 100 : null,
      ema200Rel: t.ema200 ? (r.price / t.ema200 - 1) * 100 : null,
      cross: t.goldenCross ? 2 : t.deathCross ? -2 : 0,
      crossLabel: t.goldenCross ? "Golden" : t.deathCross ? "Death" : "—",
      bbPos: vo.bbPos, atr: vo.atr, atrRel: vo.atr && r.price ? (vo.atr / r.price) * 100 : null,
      volSpike: v.spike, obvSlope: v.obvSlope, vwap: v.vwap, vwapRel: v.vwap && r.price ? (r.price / v.vwap - 1) * 100 : null,
      mfi: o.mfi, cci: o.cci, willR: o.willR, stochK: o.stochK, stochD: o.stochD,
      sr: pa.resistance ? pa.support / pa.resistance : null,
      distHigh52: pa.distHigh52, distLow52: pa.distLow52, support: pa.support, resistance: pa.resistance,
      breakout: vo.breakoutUp ? 1 : vo.breakoutDown ? -1 : 0,
      breakoutLabel: vo.breakoutUp ? "Up" : vo.breakoutDown ? "Down" : "—",
      score: r.score, signal: r.signal,
      signalRank: ({"Strong Buy":6,"Buy":5,"Accumulate":4,"Watch":3,"Hold":2,"Avoid":1})[r.signal] || 0,
      goldenCross: t.goldenCross, deathCross: t.deathCross, aboveEma200: t.aboveEma200,
    };
  },

  /** Renders each configured column (respects column-visibility prefs). */
  _renderRow(d, prev, cols) {
    const dim = () => `<td class="pfs-dim">—</td>`;
    const num = (v, dp = 2) => (v == null || !Number.isFinite(v)) ? dim() : `<td>${F.num(v, dp)}</td>`;
    const pct = (v, dp = 1) => (v == null || !Number.isFinite(v)) ? dim() : `<td class="${F.cls(v)}">${F.pct(v, dp)}</td>`;
    const bd = (cls, txt) => `<td><span class="tbadge ${cls}">${txt}</span></td>`;
    const ctxt = (cls, s) => `<td class="${cls}">${s}</td>`;
    const pctTxt = (v) => (v == null || !Number.isFinite(v)) ? dim() : `<td class="${v >= 0 ? "pfs-pos" : "pfs-neg"}">${(v >= 0 ? "+" : "") + v.toFixed(1)}%</td>`;

    const cellFor = {
      name: () => `<td class="pfs-sticky pfs-name">
        <div class="pfs-name-b">
          ${pfLogoMarkup(d.symbol, d.name)}
          <a href="#" class="pfs-name-a" data-s="${pfEsc(d.symbol)}">
            <span class="pfs-name-sym">${pfEsc(d.symbol)}</span>
            <span class="pfs-name-nm">${pfEsc(d.name || "")}</span>
          </a>
          <div class="pfs-name-sec mono">${pfEsc(d.sector)}</div>
        </div></td>`,
      price: () => d.price == null ? `<td class="pfs-dim pfs-c-price">—</td>` : `<td class="pfs-c-price">${F.num(d.price, 2)}</td>`,
      chg: () => d.changePct == null || !Number.isFinite(d.changePct) ? `<td class="pfs-dim pfs-c-chg">—</td>` : `<td class="pfs-c-chg ${F.cls(d.changePct)}">${F.pct(d.changePct, 2)}</td>`,
      trend: () => !d.direction ? dim() : bd(/Bullish/.test(d.direction) ? "tb-good" : d.direction === "Neutral" ? "tb-neutral" : "tb-bad", d.direction),
      rsi: () => d.rsi == null ? dim() : bd(
        d.rsi >= 60 && d.rsi < 80 ? "tb-good" :
        d.rsi >= 40 && d.rsi < 60 ? "tb-neutral" :
        "tb-bad", d.rsi.toFixed(1)),
      macd: () => d.macdHist == null ? dim() : ctxt(d.macdBullish ? "pfs-pos" : "pfs-neg", d.macdBullish ? "Bullish" : "Bearish"),
      adx: () => d.adx == null ? dim() : ctxt(d.adx > 25 ? "pfs-pos" : d.adx > 20 ? "pfs-amber" : "pfs-dim", d.adx.toFixed(0)),
      ema20: () => pctTxt(d.ema20Rel),
      ema50: () => pctTxt(d.ema50Rel),
      ema200: () => pctTxt(d.ema200Rel),
      cross: () => d.crossLabel === "Golden" ? bd("tb-good", "Golden") : d.crossLabel === "Death" ? bd("tb-bad", "Death") : dim(),
      bb: () => d.bbPos == null ? dim() : bd(d.bbPos > 0.8 ? "tb-bad" : d.bbPos < 0.2 ? "tb-bad" : d.bbPos > 0.5 ? "tb-good" : "tb-neutral", (d.bbPos * 100).toFixed(0) + "%"),
      atr: () => d.atrRel == null ? dim() : `<td>${d.atrRel.toFixed(2)}%</td>`,
      vol: () => d.volSpike == null ? dim() : bd(d.volSpike > 1.5 ? "tb-good" : d.volSpike > 0.8 ? "tb-neutral" : "tb-bad", d.volSpike.toFixed(2) + "×"),
      obv: () => d.obvSlope == null ? dim() : ctxt(d.obvSlope > 0 ? "pfs-pos" : d.obvSlope < 0 ? "pfs-neg" : "pfs-dim", d.obvSlope > 0 ? "Rising" : d.obvSlope === 0 ? "Flat" : "Falling"),
      vwap: () => pctTxt(d.vwapRel),
      mfi: () => d.mfi == null ? dim() : ctxt(d.mfi > 80 ? "pfs-neg" : d.mfi >= 50 ? "pfs-pos" : d.mfi > 20 ? "pfs-amber" : "pfs-neg", d.mfi.toFixed(0)),
      cci: () => d.cci == null ? dim() : bd(d.cci > 100 ? "tb-good" : d.cci > -100 ? "tb-neutral" : "tb-bad", d.cci.toFixed(0)),
      roc: () => d.roc == null ? dim() : `<td class="${F.cls(d.roc)}">${F.pct(d.roc, 1)}</td>`,
      will: () => d.willR == null ? dim() : bd(d.willR > -20 ? "tb-bad" : d.willR > -80 ? "tb-good" : "tb-bad", d.willR.toFixed(0)),
      stoch: () => (d.stochK == null || d.stochD == null) ? dim() : bd(d.stochK > 80 ? "tb-bad" : d.stochK > 20 ? "tb-good" : "tb-bad", `${d.stochK.toFixed(0)}/${d.stochD.toFixed(0)}`),
      sr: () => d.support == null ? dim() : `<td><span class="pfs-srpair"><span class="up">${F.num(d.support, 1)}</span><span class="pfs-dim"> / </span><span class="down">${F.num(d.resistance, 1)}</span></span></td>`,
      range52: () => d.distHigh52 == null ? dim() : `<td><span class="${F.cls(d.distHigh52)}">${F.pct(d.distHigh52, 1)}</span><span class="pfs-dim"> / </span><span class="${F.cls(d.distLow52)}">${F.pct(d.distLow52, 1)}</span></td>`,
      brk: () => d.breakoutLabel === "Up" ? bd("tb-good", "↑ Up") : d.breakoutLabel === "Down" ? bd("tb-bad", "↓ Down") : dim(),
      score: () => d.score == null ? dim() : `<td><div class="pfs-score"><span class="pfs-score-bar"><i style="width:${Math.max(0, Math.min(100, d.score))}%"></i></span><span class="pfs-score-num">${d.score}</span></div></td>`,
      signal: () => {
        const map = {"Strong Buy":"sig-sbuy","Buy":"sig-buy","Accumulate":"sig-acc","Watch":"sig-watch","Hold":"sig-hold","Avoid":"sig-avoid"};
        return `<td><span class="sigbadge ${map[d.signal] || "sig-watch"}">${d.signal || "—"}</span></td>`;
      },
    };

    const flash = prev && prev.signal && prev.signal !== d.raw.signal ? " pfs-flash" : "";
    return `<tr class="pfs-row${flash}" data-s="${pfEsc(d.symbol)}">${cols.map((c) => (cellFor[c.id] || dim)()).join("")}</tr>`;
  },

  /* ── RENDER: analytics dashboard ─────────────────────────────────── */
  _renderAnalytics() {
    const c = this._cache(), p = this._active();
    if (!p) return;
    const rows = ((c?.rows) || []).filter((r) => r && !r.error);

    const sd = $("#pfiScoreDist"); if (sd) sd.innerHTML = this._scoreDistBars(rows);
    const sec = $("#pfiSector"); if (sec) sec.innerHTML = this._sectorDonut(rows);
    const counts = { "Strong Buy": 0, "Buy": 0, "Accumulate": 0, "Watch": 0, "Hold": 0, "Avoid": 0 };
    rows.forEach((r) => { if (counts[r.signal] != null) counts[r.signal]++; });
    const sig = $("#pfiSignal"); if (sig) sig.innerHTML = this._signalDonut(counts);
  },

  /* Technical Score Distribution — buckets <30 … >70 (red → amber → green). */
  _scoreDistBars(rows) {
    const buckets = [
      { lo: 0,  hi: 30,  label: "<30",   color: "#c84b3c" },
      { lo: 30, hi: 40,  label: "30-40", color: "#c8862a" },
      { lo: 40, hi: 50,  label: "40-50", color: "#c8a52a" },
      { lo: 50, hi: 60,  label: "50-60", color: "#c8a52a" },
      { lo: 60, hi: 70,  label: "60-70", color: "#5fb88a" },
      { lo: 70, hi: 101, label: ">70",   color: "#3fbf7f" },
    ];
    const counts = buckets.map((b) => rows.filter((r) => { const v = r.score; return Number.isFinite(v) && v >= b.lo && v < b.hi; }).length);
    const max = Math.max(...counts, 1);
    return `<div class="pfi-bars">${buckets.map((b, i) => `
      <div class="pfi-bar-col">
        <div class="pfi-bar-track"><div class="pfi-bar-fill" style="height:${counts[i] ? Math.max(3, (counts[i] / max) * 100) : 0}%;background:${b.color}"><span class="pfi-bar-v mono">${counts[i]}</span></div></div>
        <div class="pfi-bar-l mono">${b.label}</div>
      </div>`).join("")}</div>`;
  },

  /* Equal-weight portfolio index (last ≤60 sessions) built from the per-row
     `spark` close series the technicals endpoint already returns. Each name
     is rebased to 100 at the window start and averaged per session — a real
     portfolio trend line, not a decorative squiggle. */
  _portfolioIndexLine(rows) {
    const sparks = rows
      .map((r) => (Array.isArray(r.spark) ? r.spark.filter((v) => Number.isFinite(v) && v > 0) : []))
      .filter((a) => a.length >= 10);
    if (!sparks.length) return `<div class="pfa-line-empty mono">Equal-weight index line appears after the first scan.</div>`;
    const L = Math.min(60, ...sparks.map((a) => a.length));
    const series = [];
    for (let i = 0; i < L; i++) {
      let s = 0;
      for (const a of sparks) { const w = a.slice(-L); s += (w[i] / w[0]) * 100; }
      series.push(s / sparks.length);
    }
    const W = 340, H = 96, P = 8;
    const mn = Math.min(...series, 100), mx = Math.max(...series, 100);
    const x = (i) => P + (i / (L - 1)) * (W - 2 * P);
    const y = (v) => H - P - ((v - mn) / ((mx - mn) || 1)) * (H - 2 * P);
    const pts = series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const chg = series[series.length - 1] - 100;
    const col = chg >= 0 ? "var(--up)" : "var(--down)";
    return `
      <div class="pfa-line-head mono"><span>EQUAL-WEIGHT INDEX · ${L} SESSIONS</span><span style="color:${col}">${chg >= 0 ? "+" : ""}${chg.toFixed(1)}%</span></div>
      <svg viewBox="0 0 ${W} ${H}" class="pfa-line" preserveAspectRatio="none" role="img" aria-label="Portfolio equal-weight index, ${L} sessions, ${chg.toFixed(1)} percent">
        <line x1="${P}" x2="${W - P}" y1="${y(100).toFixed(1)}" y2="${y(100).toFixed(1)}" stroke="var(--hairline)" stroke-dasharray="3 4"/>
        <polygon points="${x(0).toFixed(1)},${H - P} ${pts} ${x(L - 1).toFixed(1)},${H - P}" fill="rgba(200,134,42,.10)"/>
        <polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
        <circle cx="${x(L - 1).toFixed(1)}" cy="${y(series[series.length - 1]).toFixed(1)}" r="2.8" fill="${col}"/>
      </svg>
      <div class="pfa-line-foot mono"><span>REBASED TO 100</span><span>${sparks.length}/${rows.length} NAMES</span></div>`;
  },

  /* ── RENDER: alerts panel ────────────────────────────────────────── */
  _renderAlerts() {
    const c = this._cache();
    const host = $("#pfiAlertCards"); if (!host) return;
    const rows = (c?.rows || []).filter((r) => r && !r.error);
    const avgSpark = (matchFn) => {
      const s = rows.filter(matchFn).map((r) => (Array.isArray(r.spark) ? r.spark.filter((v) => Number.isFinite(v) && v > 0) : [])).filter((a) => a.length >= 10);
      if (!s.length) return this._pfIndexSeries(rows);
      const L = Math.min(40, ...s.map((a) => a.length)), out = [];
      for (let i = 0; i < L; i++) { let sum = 0; for (const a of s) { const w = a.slice(-L); sum += (w[i] / w[0]) * 100; } out.push(sum / s.length); }
      return out;
    };
    const nBreak = rows.filter((r) => r.volatility?.breakoutUp).length;
    const nGolden = rows.filter((r) => r.trend?.goldenCross).length;
    const nRsi = rows.filter((r) => Number.isFinite(r.momentum?.rsi) && r.momentum.rsi > 70).length;
    const nVol = rows.filter((r) => Number.isFinite(r.volume?.spike) && r.volume.spike > 1.5).length;

    const card = (icon, color, title, sub, series) => `
      <div class="pfi-alert">
        <span class="pfi-alert-ic" style="color:${color};border-color:${color}44;background:${color}14">${icon}</span>
        <div class="pfi-alert-tx"><div class="pfi-alert-t">${title}</div><div class="pfi-alert-s">${sub}</div></div>
        <div class="pfi-alert-spark">${this._spark(series, color, 92, 30)}</div>
      </div>`;
    host.innerHTML =
      card("◈", "#5b8fd6", "Breakout", `${nBreak} stock${nBreak === 1 ? "" : "s"} nearing breakout`, avgSpark((r) => r.volatility?.breakoutUp)) +
      card("✳", "#e0a83d", "Golden Cross", `${nGolden} stock${nGolden === 1 ? "" : "s"} formed golden cross`, avgSpark((r) => r.trend?.goldenCross)) +
      card("♥", "#9b6db8", "RSI Overbought", `${nRsi} stock${nRsi === 1 ? "" : "s"} above 70 RSI`, avgSpark((r) => Number.isFinite(r.momentum?.rsi) && r.momentum.rsi > 70)) +
      card("▮", "#3fbf7f", "High Volume", `${nVol} stock${nVol === 1 ? "" : "s"} with volume spike`, avgSpark((r) => Number.isFinite(r.volume?.spike) && r.volume.spike > 1.5));

    // detail list (toggled by "View All Alerts")
    const detail = $("#pfiAlertsDetail");
    if (detail) {
      detail.innerHTML = !c || !c.alerts.length
        ? `<div class="pfi-empty mono">No technical events yet. Live monitoring flags signal flips, EMA crossings, RSI band changes, MACD crosses, breakouts and 52-week highs/lows as they occur.</div>`
        : `<div class="pfx-list">${c.alerts.slice(0, 40).map((a) => `
          <div class="pfx-row pfx-row-${a.kind}">
            <span class="pfx-time mono">${new Date(a.ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
            <span class="pfx-kind">${pfEsc(a.kind.toUpperCase())}</span>
            <span class="pfx-sym mono">${pfEsc(a.symbol)}</span>
            <span class="pfx-txt">${pfEsc(a.text)}</span>
          </div>`).join("")}</div>`;
    }
  },

  /* ── RENDER: recent changes panel ────────────────────────────────── */
  _renderChanges() {
    const c = this._cache(); if (!c) return;
    const host = $("#pfiChanges"); if (!host) return;
    if (!c.changes.length) {
      host.innerHTML = `<div class="pfi-empty mono">Composition &amp; signal changes appear here as your book updates.</div>`;
      return;
    }
    const KIND = { add: ["BULK ADD", "amber"], remove: ["REMOVE", "down"], bulk: ["BULK ADD", "amber"], increase: ["INCREASE", "up"], signal: ["SIGNAL CHANGE", "muted"] };
    const slice = this._logExpanded ? c.changes : c.changes.slice(0, 8);
    host.innerHTML = `<div class="pfi-log">${slice.map((ch) => {
      const [lbl, tone] = KIND[ch.kind] || ["EDIT", "muted"];
      return `<div class="pfi-log-row">
        <span class="pfi-log-time mono">${new Date(ch.ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
        <span class="pfi-log-badge pfi-log-${tone}">${lbl}</span>
        <span class="pfi-log-primary">${pfEsc(ch.primary)}</span>
        <span class="pfi-log-secondary">${pfEsc(ch.secondary)}</span>
      </div>`;
    }).join("")}</div>${c.changes.length > 8 ? `<button class="pfi-log-more" id="pfiLogMore">${this._logExpanded ? "Show Less ↑" : "View Full Log →"}</button>` : ""}`;
  },

  /* ── CSV export ──────────────────────────────────────────────────── */
  _exportCsv() {
    const p = this._active(), c = this._cache();
    if (!p || !c || !c.rows.length) { pfToast("Nothing to export yet.", "info"); return; }
    const rows = c.rows.filter((r) => r && !r.error).map((r) => this._derive(r));
    const cols = this._visibleCols();
    const hdr = cols.map((c) => c.label).join(",");
    const line = (d) => cols.map((col) => {
      switch (col.id) {
        case "name":    return `"${(d.symbol || "").replace(/"/g, '""')}","${(d.name || "").replace(/"/g, '""')}"`;
        case "trend":   return `"${d.direction || ""}"`;
        case "cross":   return `"${d.crossLabel || ""}"`;
        case "brk":     return `"${d.breakoutLabel || ""}"`;
        case "signal":  return `"${d.signal || ""}"`;
        case "sr":      return `"${d.support ?? ""} / ${d.resistance ?? ""}"`;
        case "range52": return `"${d.distHigh52 ?? ""} / ${d.distLow52 ?? ""}"`;
        default: {
          const key = col.sort;
          const v = d[key];
          return Number.isFinite(v) ? v.toFixed(4) : "";
        }
      }
    }).join(",");
    // For "name" col we output 2 CSV columns (symbol + name), so widen header too
    const headerCsv = cols.map((col) => col.id === "name" ? "SYMBOL,NAME" : col.label).join(",");
    const csv = [headerCsv, ...rows.map(line)].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
    a.href = url; a.download = `${p.name.replace(/[^\w\-]+/g, "_")}_${stamp}.csv`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 200);
    pfToast("CSV exported", "success");
  },

  /* ── chart primitives (compact SVG, muted institutional palette) ──── */

  _miniGauge(score, band) {
    if (score == null) return `<div class="pfa-gauge-empty mono">no data</div>`;
    const pct = Math.max(0, Math.min(100, score));
    const cx = 100, cy = 90, r = 68;
    const a = Math.PI * (1 - pct / 100);
    const x = cx + r * Math.cos(a), y = cy - r * Math.sin(a);
    return `
      <div class="pfa-gauge-wrap">
        <svg viewBox="0 0 200 110" class="pfa-gauge">
          <defs><linearGradient id="pfaGaugeBg" x1="0" x2="1">
            <stop offset="0%" stop-color="#c84b3c"/><stop offset="35%" stop-color="#c8862a"/>
            <stop offset="65%" stop-color="#c8a52a"/><stop offset="100%" stop-color="#2e9e6b"/></linearGradient></defs>
          <path d="M 32 90 A 68 68 0 0 1 168 90" stroke="#232a33" stroke-width="10" fill="none" stroke-linecap="round"/>
          <path d="M 32 90 A 68 68 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}" stroke="url(#pfaGaugeBg)" stroke-width="10" fill="none" stroke-linecap="round"/>
          <line x1="${cx}" y1="${cy}" x2="${(cx + (r - 14) * Math.cos(a)).toFixed(1)}" y2="${(cy - (r - 14) * Math.sin(a)).toFixed(1)}" stroke="${band.color}" stroke-width="2.5" stroke-linecap="round"/>
          <circle cx="${cx}" cy="${cy}" r="4" fill="${band.color}"/>
        </svg>
        <div class="pfa-gauge-meta"><span class="pfa-gauge-num" style="color:${band.color}">${pct}</span><span class="pfa-gauge-lbl" style="color:${band.color}">${band.label}</span></div>
      </div>`;
  },

  _miniDonut(slices) {
    const total = slices.reduce((s, v) => s + v.value, 0);
    if (!total) return `<div class="pfa-donut-empty mono">no data</div>`;
    const cx = 55, cy = 55, r = 42, rIn = 27;
    let acc = 0;
    const arcs = slices.filter((sl) => sl.value > 0).map((sl) => {
      const frac = sl.value / total;
      const a0 = acc * 2 * Math.PI - Math.PI / 2;
      const a1 = (acc + frac) * 2 * Math.PI - Math.PI / 2;
      acc += frac;
      if (frac >= 0.999) return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${sl.color}"/><circle cx="${cx}" cy="${cy}" r="${rIn}" fill="var(--ink)"/>`;
      const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      const xi0 = cx + rIn * Math.cos(a0), yi0 = cy + rIn * Math.sin(a0);
      const xi1 = cx + rIn * Math.cos(a1), yi1 = cy + rIn * Math.sin(a1);
      const large = frac > 0.5 ? 1 : 0;
      return `<path d="M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} L ${xi1.toFixed(2)} ${yi1.toFixed(2)} A ${rIn} ${rIn} 0 ${large} 0 ${xi0.toFixed(2)} ${yi0.toFixed(2)} Z" fill="${sl.color}"/>`;
    }).join("");
    const legend = slices.filter((sl) => sl.value > 0).map((sl) => `<div class="pfa-mini-leg"><span class="pfa-mini-sw" style="background:${sl.color}"></span><span>${pfEsc(sl.label)}</span><span class="mono">${sl.value}</span></div>`).join("");
    return `<div class="pfa-mini-donut-wrap"><svg viewBox="0 0 110 110" class="pfa-mini-donut-svg">${arcs}</svg><div class="pfa-mini-donut-leg">${legend}</div></div>`;
  },

  _signalDonut(counts) {
    const slices = [
      { label: "Strong Buy",  value: counts["Strong Buy"], color: "#2e9e6b" },
      { label: "Buy",         value: counts["Buy"],         color: "#5fb88a" },
      { label: "Accumulate",  value: counts["Accumulate"],  color: "#c8a52a" },
      { label: "Watch",       value: counts["Watch"],       color: "#c8862a" },
      { label: "Hold",        value: counts["Hold"],        color: "#7a8693" },
      { label: "Avoid",       value: counts["Avoid"],       color: "#c84b3c" },
    ];
    return this._largeDonut(slices);
  },

  _sectorDonut(rows) {
    const by = {};
    rows.forEach((r) => { const s = r.sector || "—"; by[s] = (by[s] || 0) + 1; });
    const entries = Object.entries(by).sort((a, b) => b[1] - a[1]);
    const palette = ["#c8862a", "#5fb88a", "#7aa86f", "#c8a52a", "#7a8693", "#a07350", "#9b6db8", "#c84b3c", "#3a8c6b", "#b08537", "#6a778a", "#b89f8a"];
    const slices = entries.map(([k, v], i) => ({ label: k, value: v, color: palette[i % palette.length] }));
    return this._largeDonut(slices);
  },

  _largeDonut(slices) {
    const total = slices.reduce((s, v) => s + v.value, 0);
    if (!total) return `<div class="pfa-donut-empty mono">no data</div>`;
    const cx = 80, cy = 80, r = 62, rIn = 40;
    let acc = 0;
    const arcs = slices.filter((sl) => sl.value > 0).map((sl) => {
      const frac = sl.value / total;
      const a0 = acc * 2 * Math.PI - Math.PI / 2;
      const a1 = (acc + frac) * 2 * Math.PI - Math.PI / 2;
      acc += frac;
      if (frac >= 0.999) return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${sl.color}"/><circle cx="${cx}" cy="${cy}" r="${rIn}" fill="var(--ink)"/>`;
      const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      const xi0 = cx + rIn * Math.cos(a0), yi0 = cy + rIn * Math.sin(a0);
      const xi1 = cx + rIn * Math.cos(a1), yi1 = cy + rIn * Math.sin(a1);
      const large = frac > 0.5 ? 1 : 0;
      return `<path d="M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} L ${xi1.toFixed(2)} ${yi1.toFixed(2)} A ${rIn} ${rIn} 0 ${large} 0 ${xi0.toFixed(2)} ${yi0.toFixed(2)} Z" fill="${sl.color}"/>`;
    }).join("");
    const legend = slices.filter((sl) => sl.value > 0).map((sl) =>
      `<div class="pfa-leg"><span class="pfa-leg-sw" style="background:${sl.color}"></span><span class="pfa-leg-l">${pfEsc(sl.label)}</span><span class="pfa-leg-v mono">${sl.value} · ${((sl.value / total) * 100).toFixed(0)}%</span></div>`
    ).join("");
    return `<div class="pfa-donut"><svg viewBox="0 0 160 160" class="pfa-donut-svg">${arcs}</svg><div class="pfa-donut-leg">${legend}</div></div>`;
  },

  _rsiHistogram(rows) {
    const buckets = [
      { lo: 0,  hi: 30,  label: "<30",   color: "#c84b3c" },
      { lo: 30, hi: 40,  label: "30-40", color: "#c8862a" },
      { lo: 40, hi: 50,  label: "40-50", color: "#c8a52a" },
      { lo: 50, hi: 60,  label: "50-60", color: "#7aa86f" },
      { lo: 60, hi: 70,  label: "60-70", color: "#5fb88a" },
      { lo: 70, hi: 101, label: ">70",   color: "#c84b3c" },
    ];
    const counts = buckets.map((b) => rows.filter((r) => { const v = r.momentum?.rsi; return Number.isFinite(v) && v >= b.lo && v < b.hi; }).length);
    const max = Math.max(...counts, 1);
    return `<div class="pfa-hist">${buckets.map((b, i) =>
      `<div class="pfa-hist-col">
        <div class="pfa-hist-bar"><i style="height:${(counts[i] / max) * 100}%;background:${b.color}"></i></div>
        <div class="pfa-hist-v mono">${counts[i]}</div>
        <div class="pfa-hist-l mono">${b.label}</div>
      </div>`).join("")}</div>`;
  },
};



/* ════════ NEWS & SENTIMENT ════════ */
TABS.news = {
  init() {
    $("#newsGo").addEventListener("click", () => this.load());
    $("#newsQuery").addEventListener("keydown", (e) => { if (e.key === "Enter") this.load(); });
    $("#newsMode").addEventListener("change", () => this.load());
    if (typeof CURRENT !== "undefined" && CURRENT && CURRENT.symbol) {
      $("#newsQuery").value = CURRENT.symbol;
    }
    this.load();
  },
  /* persistent company context */
  syncContext() {
    if (!CURRENT || !CURRENT.symbol) return;
    const q = $("#newsQuery");
    if (q && q.value.trim().toUpperCase() !== CURRENT.symbol) { q.value = CURRENT.symbol; this.load(); }
  },
  async load() {
    const q = $("#newsQuery").value.trim() || "NIFTY";
    const mode = $("#newsMode").value;
    $("#newsList").innerHTML = `<div class="loading mono">loading…</div>`;
    try {
      const d = await api(`/api/newsintel?q=${encodeURIComponent(q)}&mode=${mode}`);
      if (d.error) { $("#newsList").innerHTML = `<div class="loading">${d.error}</div>`; return; }
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
      $("#newsList").innerHTML = d.items.map((it) => `<div class="news-item"><span class="sent ${esc(it.sentiment)}">${esc((it.sentiment || "").slice(0, 3).toUpperCase())}</span><span class="nt"><a href="${escUrl(it.link)}" target="_blank" rel="noopener">${esc(it.title)}</a> ${(it.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join(" ")}</span><span class="np">${esc(it.publisher || "")} · ${F.ago(it.time)}</span></div>`).join("") || `<div class="empty-mini">No headlines found for "${esc(q)}".</div>`;
    } catch (e) { $("#newsList").innerHTML = `<div class="loading">news unavailable: ${e.message}</div>`; }
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

/* ════════════════════════════════════════════════════════════════════════════
   SCENARIO MANAGER — named, per-symbol snapshots of the COMPLETE assumption
   set (scalar overrides + year-wise edits + capital allocation + capital
   structure + terminal method). Stored under the meridian_ localStorage
   prefix so the signed-in user-store syncs them across devices. Applying a
   scenario re-runs the exact same IDCF engine — a scenario is a saved input
   set, never a saved output.
   ════════════════════════════════════════════════════════════════════════════ */
const SCN = {
  KEY: "meridian_scenarios",
  _wired: false,
  _all() { try { return JSON.parse(localStorage.getItem(this.KEY) || "{}"); } catch { return {}; } },
  _put(all) { try { localStorage.setItem(this.KEY, JSON.stringify(all)); } catch { } },
  list(symbol) { return (this._all()[symbol] || []); },

  init() {
    if (this._wired) return;
    this._wired = true;
    const save = $("#scnSave"), name = $("#scnName");
    if (save) save.addEventListener("click", () => this.save());
    if (name) name.addEventListener("keydown", (e) => { if (e.key === "Enter") this.save(); });
    const list = $("#scnList");
    if (list) list.addEventListener("click", (e) => {
      const ap = e.target.closest("[data-scn-apply]");
      if (ap) { this.apply(ap.dataset.scnApply); return; }
      const del = e.target.closest("[data-scn-del]");
      if (del) { this.remove(del.dataset.scnDel); }
    });
    this.render();
  },

  save() {
    if (!IDCF.symbol || !IDCF.data) { IDCF.setStatus("Build a model first, then save it as a scenario."); return; }
    const nameEl = $("#scnName");
    const name = (nameEl?.value || "").trim() || `Scenario ${this.list(IDCF.symbol).length + 1}`;
    const u = IDCF.uiState;
    const sc = {
      id: "s" + Date.now().toString(36),
      name, ts: Date.now(),
      scalar: { ...(valuationModelState.userOverrides || {}) },
      ui: {
        forecastHorizon: u.forecastHorizon,
        terminalMethod: u.terminalMethod,
        exitMultiple: u.exitMultiple,
        yearwise: JSON.parse(JSON.stringify(u.yearwise)),
        capitalAllocation: JSON.parse(JSON.stringify(u.capitalAllocation)),
        capitalStructure: { ...u.capitalStructure },
      },
      perShare: IDCF.data?.idcf?.base?.perShare ?? null,
      status: IDCF.data?.meta?.modelStatus || "Evidence-Based",
    };
    const all = this._all();
    (all[IDCF.symbol] ||= []).unshift(sc);
    all[IDCF.symbol] = all[IDCF.symbol].slice(0, 8);
    this._put(all);
    if (nameEl) nameEl.value = "";
    this.render();
  },

  apply(id) {
    const sc = this.list(IDCF.symbol).find((x) => x.id === id);
    if (!sc || !IDCF.symbol || IDCF.busy) return;
    const u = IDCF.uiState;
    u.forecastHorizon = sc.ui.forecastHorizon ?? 5;
    u.terminalMethod = sc.ui.terminalMethod || "perpetual";
    u.exitMultiple = sc.ui.exitMultiple ?? 12;
    const blank3 = () => [null, null, null];
    Object.keys(u.yearwise).forEach((k) => { u.yearwise[k] = (sc.ui.yearwise && sc.ui.yearwise[k]) ? [...sc.ui.yearwise[k]] : blank3(); });
    Object.keys(u.capitalAllocation).forEach((k) => { u.capitalAllocation[k] = (sc.ui.capitalAllocation && sc.ui.capitalAllocation[k]) ? [...sc.ui.capitalAllocation[k]] : blank3(); });
    u.capitalStructure = { netDebt: null, stDebt: null, ltDebt: null, cash: null, ...(sc.ui.capitalStructure || {}) };
    // Same-symbol reload → the company-switch guard does not clear these.
    IDCF.load(IDCF.symbol, Object.keys(sc.scalar || {}).length ? { ...sc.scalar } : undefined);
  },

  remove(id) {
    const all = this._all();
    if (!all[IDCF.symbol]) return;
    all[IDCF.symbol] = all[IDCF.symbol].filter((x) => x.id !== id);
    this._put(all);
    this.render();
  },

  render() {
    const host = $("#scnList"); if (!host) return;
    const items = IDCF.symbol ? this.list(IDCF.symbol) : [];
    if (!items.length) {
      host.innerHTML = `<div class="empty-mini mono" style="padding:8px 16px">${IDCF.symbol ? "No saved scenarios for " + esc(IDCF.symbol) + " yet — adjust assumptions and save." : "Adjust assumptions, then save them as named scenarios to compare bull / base / bear side-by-side."}</div>`;
      return;
    }
    const ccy = IDCF.data?.meta?.currency;
    const sym = ccy === "INR" ? "₹" : ccy === "USD" ? "$" : "";
    host.innerHTML = items.map((sc) => `
      <div class="scn-row">
        <div class="scn-main">
          <span class="scn-n">${esc(sc.name)}</span>
          <span class="scn-m mono">${sc.perShare != null ? sym + (+sc.perShare).toFixed(2) + "/sh" : ""} · ${new Date(sc.ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</span>
        </div>
        <button class="mini-btn" data-scn-apply="${sc.id}" title="Load this assumption set and recompute the model">Apply</button>
        <button class="scn-del" data-scn-del="${sc.id}" title="Delete scenario">×</button>
      </div>`).join("");
  },
};

/* ════════════════════════════════════════════════════════════════════════════
   HISTORICAL VALUATION BANDS — Modeling Lab panel.
   ════════════════════════════════════════════════════════════════════════════ */
async function loadBands(symbol) {
  const out = $("#bandsOut"); if (!out) return;
  out.innerHTML = `<div class="loading mono">computing 5-year multiple bands…</div>`;
  try {
    const d = await api(`/api/bands/${encodeURIComponent(symbol)}`);
    if (!d.available) { out.innerHTML = `<div class="empty-mini mono">${esc(d.reason || "Bands unavailable for this issuer")}</div>`; return; }
    $("#bandsFor") && ($("#bandsFor").textContent = `${d.name} · 5y monthly · trailing FY denominators`);
    const bandRow = (label, b) => {
      if (!b) return "";
      const span = (b.max - b.min) || 1;
      const X = (v) => Math.min(100, Math.max(0, ((v - b.min) / span) * 100));
      const zone = b.pctile == null ? "" : b.pctile >= 80 ? "down" : b.pctile <= 20 ? "up" : "";
      const read = b.pctile == null ? "" :
        b.pctile >= 80 ? "rich vs own history" :
        b.pctile <= 20 ? "cheap vs own history" : "mid-band";
      return `<div class="band-row">
        <span class="band-l">${label}</span>
        <div class="band-track">
          <span class="band-iqr" style="left:${X(b.p25)}%;width:${Math.max(X(b.p75) - X(b.p25), 1)}%"></span>
          <span class="band-med" style="left:${X(b.med)}%" title="Median ${b.med}×"></span>
          <span class="band-cur" style="left:${X(b.current)}%" title="Current ${b.current}×"></span>
        </div>
        <span class="band-v mono">${b.current}× <small class="${zone}">P${b.pctile} · ${read}</small></span>
      </div>
      <div class="band-scale mono"><span>${b.min}×</span><span>25th ${b.p25}×</span><span>med ${b.med}×</span><span>75th ${b.p75}×</span><span>${b.max}×</span></div>`;
    };
    out.innerHTML = `<div class="bands">${bandRow("Trailing P/E", d.pe)}${bandRow("Price / Book", d.pb)}</div>
      <div class="prose">${d.pe && d.pe.pctile != null ? `The stock trades at the <b>${d.pe.pctile}th percentile</b> of its own five-year P/E range${d.pe.pctile >= 80 ? " — priced for continuation of the recent narrative; multiple compression is a live risk if delivery slips." : d.pe.pctile <= 20 ? " — the market is paying less per unit of earnings than at almost any point in five years; either the cheapness is an opportunity or the E is about to fall. The forensic and risk modules arbitrate which." : " — squarely mid-band; the valuation debate here is about earnings trajectory, not re-rating."}` : ""}</div>
      <div class="idcf-note">${esc(d.note || "")}</div>`;
  } catch (e) { out.innerHTML = `<div class="empty-mini mono">${esc(e.message || "bands unavailable")}</div>`; }
}

/* ════════════════════════════════════════════════════════════════════════════
   TRANSACTIONS & PERFORMANCE — real-money ledger.
   Trades live in localStorage (meridian_ prefix → user-store sync); ALL math
   (WAC holdings, realized/unrealized, XIRR, benchmark XIRR) runs server-side
   in /api/portfolio/performance so the numbers are deterministic, tested and
   identical to any future consumer. Live layer: full recompute every ~60s in
   market hours via the unified tick, gold flash on changed values.
   ════════════════════════════════════════════════════════════════════════════ */
const TXN = {
  KEY: "meridian_txns",
  _busy: false, _lastAt: 0, _prevVals: {},
  all() { try { return JSON.parse(localStorage.getItem(this.KEY) || "[]"); } catch { return []; } },
  _put(list) { try { localStorage.setItem(this.KEY, JSON.stringify(list.slice(0, 500))); } catch { } },

  init() {
    const add = $("#txnAdd");
    if (!add || add._wired) return;
    add._wired = true;
    const dateEl = $("#txnDate");
    if (dateEl && !dateEl.value) dateEl.value = new Date().toISOString().slice(0, 10);
    add.addEventListener("click", () => this.add());
    ["txnSym", "txnQty", "txnPrice"].forEach((id) => {
      const el = $("#" + id);
      if (el) el.addEventListener("keydown", (e) => { if (e.key === "Enter") this.add(); });
    });
    const ledger = $("#txnLedger");
    if (ledger) ledger.addEventListener("click", (e) => {
      const del = e.target.closest("[data-txn-del]");
      if (del) { this._put(this.all().filter((t) => t.id !== del.dataset.txnDel)); this.refresh({ force: true }); }
    });
    if (this.all().length) this.refresh({ force: true });
    else this._renderEmpty();
  },

  add() {
    const symbol = ($("#txnSym")?.value || "").trim().toUpperCase();
    const side = $("#txnSide")?.value === "SELL" ? "SELL" : "BUY";
    const qty = +($("#txnQty")?.value || 0);
    const price = +($("#txnPrice")?.value || 0);
    const date = $("#txnDate")?.value;
    if (!symbol || !(qty > 0) || !(price > 0) || !date) {
      $("#txnAsOf").textContent = "enter symbol, positive qty & price, and a date";
      return;
    }
    const list = this.all();
    list.push({ id: "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), symbol, side, qty, price, date });
    this._put(list);
    ["txnQty", "txnPrice"].forEach((id) => { const el = $("#" + id); if (el) el.value = ""; });
    this.refresh({ force: true });
  },

  _renderEmpty() {
    $("#txnPerf") && ($("#txnPerf").innerHTML = "");
    $("#txnHoldings") && ($("#txnHoldings").innerHTML = "");
    $("#txnLedger") && ($("#txnLedger").innerHTML = `<div class="empty-mini mono" style="padding:14px 2px">Record actual buys and sells above — the terminal computes weighted-average holdings, realized and unrealized P&amp;L, your money-weighted XIRR, and benchmarks the same cashflows against the NIFTY 50.</div>`);
  },

  /* silent throttled refresh for the unified live tick */
  liveTick() {
    if (Date.now() - this._lastAt < 55_000) return;
    if (this.all().length) this.refresh({ silent: true });
  },

  async refresh(opts = {}) {
    if (this._busy) return;
    const txns = this.all();
    if (!txns.length) { this._renderEmpty(); return; }
    this._busy = true;
    this._lastAt = Date.now();
    if (!opts.silent) $("#txnAsOf").textContent = "computing performance…";
    try {
      const d = await api("/api/portfolio/performance", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ transactions: txns, benchmark: "^NSEI" }),
      });
      if (!d.available) { $("#txnAsOf").textContent = esc(d.reason || "performance unavailable"); return; }
      this._renderPerf(d);
      this._renderHoldings(d);
      this._renderLedger(txns);
      $("#txnAsOf").textContent = `weighted-average cost · XIRR vs ${d.benchmark} · as of ${new Date(d.asOf).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`;
    } catch (e) {
      if (!opts.silent) $("#txnAsOf").textContent = "performance failed: " + e.message;
    } finally { this._busy = false; }
  },

  _flashIfChanged(key, val, el) {
    if (el && this._prevVals[key] != null && this._prevVals[key] !== val) goldFlash(el);
    this._prevVals[key] = val;
  },

  _renderPerf(d) {
    const t = d.totals;
    const card = (l, v, cls, sub, key) => `<div class="txp-card" data-txp="${key || ""}"><div class="l">${l}</div><div class="n ${cls || ""}">${v}</div>${sub ? `<div class="s">${sub}</div>` : ""}</div>`;
    const pctFmt = (v) => v == null ? "—" : (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
    $("#txnPerf").innerHTML = `<div class="txp-grid">
      ${card("INVESTED (OPEN)", F.num(t.investedOpen, 0), "", "cost basis of open positions", "inv")}
      ${card("CURRENT VALUE", F.num(t.currentValue, 0), "", "live quotes", "val")}
      ${card("UNREALIZED P&L", (t.unrealized >= 0 ? "+" : "") + F.num(t.unrealized, 0), F.cls(t.unrealized), pctFmt(t.unrealizedPct), "unr")}
      ${card("REALIZED P&L", (t.realized >= 0 ? "+" : "") + F.num(t.realized, 0), F.cls(t.realized), "booked on sells", "rlz")}
      ${card("PORTFOLIO XIRR", t.xirr == null ? "—" : pctFmt(t.xirr), F.cls(t.xirr), "money-weighted, annualized", "xirr")}
      ${card(d.benchmark + " XIRR", t.benchXirr == null ? "—" : pctFmt(t.benchXirr), "", "same cashflows in the index", "bx")}
      ${card("ALPHA", t.alphaPp == null ? "—" : (t.alphaPp >= 0 ? "+" : "") + t.alphaPp.toFixed(2) + "pp", F.cls(t.alphaPp), "your XIRR − index XIRR", "alpha")}
    </div>
    ${(d.warnings || []).map((w) => `<div class="idcf-warn">⚠ ${esc(w)}</div>`).join("")}
    ${d.benchNote ? `<div class="idcf-note">${esc(d.benchNote)}</div>` : ""}`;
    // gold flash on changed headline values
    this._flashIfChanged("val", t.currentValue, document.querySelector('[data-txp="val"] .n'));
    this._flashIfChanged("unr", t.unrealized, document.querySelector('[data-txp="unr"] .n'));
    this._flashIfChanged("xirr", t.xirr, document.querySelector('[data-txp="xirr"] .n'));
  },

  _renderHoldings(d) {
    if (!d.holdings.length) { $("#txnHoldings").innerHTML = ""; return; }
    $("#txnHoldings").innerHTML = `<div class="panel-sub mono" style="margin:14px 0 6px">OPEN HOLDINGS</div>
      <div class="table-wrap"><table class="dt"><tr><th style="text-align:left">Holding</th><th>Qty</th><th>Avg cost</th><th>Price</th><th>Value</th><th>Weight</th><th>Unrealized</th><th>Day</th></tr>
      ${d.holdings.map((h) => `<tr>
        <td class="nm" style="text-align:left"><a href="#" onclick="loadCompany('${esc(h.symbol)}');return false" title="${esc(h.name || "")}">${esc(h.symbol)}</a></td>
        <td>${F.num(h.qty, h.qty % 1 ? 2 : 0)}</td>
        <td>${F.num(h.avgCost, 2)}</td>
        <td data-txh-px="${esc(h.symbol)}">${h.quoteMissing ? "—" : F.num(h.price, 2)}</td>
        <td>${h.value == null ? "—" : F.num(h.value, 0)}</td>
        <td>${h.weightPct == null ? "—" : h.weightPct.toFixed(1) + "%"}</td>
        <td class="${F.cls(h.unrealized)}">${h.unrealized == null ? "—" : (h.unrealized >= 0 ? "+" : "") + F.num(h.unrealized, 0) + (h.unrealizedPct != null ? " (" + (h.unrealizedPct >= 0 ? "+" : "") + h.unrealizedPct.toFixed(1) + "%)" : "")}</td>
        <td class="${F.cls(h.dayChangePct)}">${F.pct(h.dayChangePct, 2)}</td>
      </tr>`).join("")}</table></div>`;
    d.holdings.forEach((h) => this._flashIfChanged("px:" + h.symbol, h.price, document.querySelector(`[data-txh-px="${CSS.escape(h.symbol)}"]`)));
  },

  _renderLedger(txns) {
    const sorted = [...txns].sort((a, b) => new Date(b.date) - new Date(a.date));
    $("#txnLedger").innerHTML = `<div class="panel-sub mono" style="margin:14px 0 6px">TRADE LEDGER · ${sorted.length}</div>
      <div class="table-wrap"><table class="dt"><tr><th style="text-align:left">Date</th><th style="text-align:left">Symbol</th><th>Side</th><th>Qty</th><th>Price</th><th>Value</th><th></th></tr>
      ${sorted.map((t) => `<tr>
        <td class="nm" style="text-align:left">${esc(t.date)}</td>
        <td style="text-align:left">${esc(t.symbol)}</td>
        <td class="${t.side === "BUY" ? "up" : "down"}">${t.side}</td>
        <td>${F.num(+t.qty, +t.qty % 1 ? 2 : 0)}</td>
        <td>${F.num(+t.price, 2)}</td>
        <td>${F.num(t.qty * t.price, 0)}</td>
        <td><button class="scn-del" data-txn-del="${esc(t.id)}" title="Delete trade">×</button></td>
      </tr>`).join("")}</table></div>
      <div class="idcf-note">Trades are stored per-user (synced when signed in) and never leave your account; the server computes performance statelessly on each refresh. Cost basis: weighted average. XIRR is money-weighted — it reflects the timing of YOUR cashflows, which is why it can differ sharply from the index's simple return.</div>`;
  },
};

/* Transactions panel is independent of screener portfolios — bind immediately. */
try { TXN.init(); } catch { }

/* boot once all module tabs are registered */
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootTerminal);
else bootTerminal();

/* ════════════════════════════════════════════════════════════════════════════
   VALUATION MODEL STATE — single source of truth for the entire platform.
   Every module that needs valuation data reads from here.
   Report Generation reads valuationModelState.idcf, .evidence, .assumptions.
   ════════════════════════════════════════════════════════════════════════════ */
const valuationModelState = {
  symbol: null,
  company: null,
  currency: null,
  idcf: null,
  evidence: null,
  assumptions: null,
  userOverrides: {},
  modelStatus: "Empty",       // "Empty" | "Evidence-Based" | "User-Adjusted"
  builtAt: null,
  lastRecalcAt: null,

  update(data) {
    this.symbol    = data.meta.symbol;
    this.company   = data.meta.name;
    this.currency  = data.meta.currency;
    this.idcf      = data.idcf;
    this.evidence  = data.evidence;
    this.assumptions = data.idcf?.assumptions ?? null;
    this.modelStatus = data.meta.modelStatus ?? "Evidence-Based";
    this.builtAt   = data.meta.builtAt;
    this.lastRecalcAt = new Date().toISOString();
  },

  /** Called by Report Generation to pull the latest valuation snapshot. */
  snapshot() {
    if (!this.idcf) return null;
    return {
      symbol: this.symbol, company: this.company, currency: this.currency,
      idcf: this.idcf, evidence: this.evidence, assumptions: this.assumptions,
      modelStatus: this.modelStatus, lastRecalcAt: this.lastRecalcAt,
    };
  },
};

/* ════════ INSTITUTIONAL DCF — 17-section analyst model (Modeling Lab) ════════ */
const IDCF = {
  data: null, symbol: null, busy: false,
  // ── Expanded-mode UI state (year-wise assumptions panel) ─────────────────
  // None of this is set until the user opens "Expand & Edit". When empty/default
  // the server treats the call exactly like the legacy non-expanded path.
  uiState: {
    expandedMode: false,
    expandedRows: new Set(),           // which assumption rows are disclosed
    forecastHorizon: 5,                // 3 / 5 / 7 / 10
    terminalMethod: "perpetual",       // "perpetual" | "exitMultiple"
    exitMultiple: 12,
    // Active tab inside the Integrated Forecast Financial Model (Section 2)
    activeFinTab: "income",            // "income" | "balance" | "cashflow"
    // BS-tab expand/collapse state — a Set of parent row IDs that are open.
    // Initialised lazily on first BS render; cleared on company switch.
    bsExpanded: null,
    // Per-year overrides, arrays of length 3 (Y1, Y2, Y3). null = no override.
    yearwise: {
      growth: [null, null, null],
      ebitdaMargin: [null, null, null],
      capexPctRev: [null, null, null],
      depPctRev: [null, null, null],
      taxRate: [null, null, null],
      wcPctRev: [null, null, null],
    },
    capitalAllocation: {
      dividendPayout: [null, null, null],
      shareBuyback:   [null, null, null],
      debtRepayment:  [null, null, null],
      strategicAcq:   [null, null, null],
    },
    // Task 5: scalar overrides for capital structure. Stored in raw
    // monetary units (Cr / Mn raw — backend uses raw scale too). Null/missing
    // ⇒ engine uses last-historical-year values.
    capitalStructure: {
      netDebt: null,  // direct override; if set, wins over stDebt+ltDebt-cash
      stDebt:  null,
      ltDebt:  null,
      cash:    null,
    },
  },

  /** Gather all current UI state into a single overrides payload for the backend. */
  collectOverrides(scalarOverrides) {
    const u = this.uiState;
    const ov = { ...(scalarOverrides || {}) };
    // Always send forecast horizon (server treats 5 as default no-op)
    ov.forecastHorizon = u.forecastHorizon;
    // Terminal method
    if (u.terminalMethod === "exitMultiple") {
      ov.terminalMethod = "exitMultiple";
      ov.exitMultiple   = u.exitMultiple;
    }
    // Yearwise: only include keys that have at least one non-null value
    const yw = {};
    Object.keys(u.yearwise).forEach((k) => {
      if (u.yearwise[k].some((v) => v != null && isFinite(+v))) yw[k] = u.yearwise[k];
    });
    if (Object.keys(yw).length) ov.yearwise = yw;
    // Capital allocation: same rule
    const ca = {};
    Object.keys(u.capitalAllocation).forEach((k) => {
      if (u.capitalAllocation[k].some((v) => v != null && isFinite(+v))) ca[k] = u.capitalAllocation[k];
    });
    if (Object.keys(ca).length) ov.capitalAllocation = ca;
    // Task 5: capital-structure scalar overrides (raw monetary scale).
    //   netDebt > 0  ⇒ override the entire net debt figure
    //   stDebt / ltDebt / cash ⇒ override individual components; engine
    //                            recomputes Net Debt as ST + LT − Cash.
    if (u.capitalStructure) {
      ["netDebt", "stDebt", "ltDebt", "cash"].forEach((k) => {
        const v = u.capitalStructure[k];
        if (v != null && isFinite(+v)) ov[k] = +v;
      });
    }
    return ov;
  },

  init() {
    const load = $("#idcfLoad"), sym = $("#idcfSym");
    if (load) load.addEventListener("click", () => { const s = (sym.value || "").trim().toUpperCase(); if (s) this.load(s); });
    if (sym) sym.addEventListener("keydown", (e) => { if (e.key === "Enter") load.click(); });
  },

  /** Write to the IDCF status bar (#idcfStatus). Promoted from a closure-local
   *  helper inside load() so other methods (exportExcel, etc.) can use the
   *  same status surface without duplicating the DOM lookup. */
  setStatus(html, isHtml = false) {
    const el = $("#idcfStatus");
    if (!el) return;
    if (isHtml) el.innerHTML = html; else el.textContent = html;
  },

  async load(symbol, overrides) {
    if (this.busy) return; this.busy = true;
    // ── BUG FIX: company switch must reset all UI state ─────────────────────
    // Without this, year-wise overrides, capital-allocation values, terminal
    // method, and active tab from the previously analysed company carry over
    // to the new one. Whenever the ticker changes, we discard all state and
    // ignore any inbound `overrides` (they would be MARICO's sidebar values
    // applied to ITC, which is nonsensical).
    const companyChanged = this.symbol && this.symbol !== symbol;
    if (companyChanged) {
      this.resetUiState();
      overrides = undefined;
    }
    this.symbol = symbol;
    // Merge any scalar overrides with the expanded-mode UI state so the backend
    // sees the complete picture on every call.
    const mergedOverrides = this.collectOverrides(overrides);
    // "isRecompute" remains true only if there is a meaningful user delta (not
    // the implicit forecastHorizon=5 default).
    const meaningfulKeys = Object.keys(mergedOverrides).filter((k) => {
      if (k === "forecastHorizon") return +mergedOverrides[k] !== 5;
      return mergedOverrides[k] != null;
    });
    const isRecompute = meaningfulKeys.length > 0;
    this.setStatus(isRecompute ? "recomputing model…" : "building model · pulling statements…");
    try {
      const url = "/api/idcf/" + encodeURIComponent(symbol);
      const data = isRecompute
        ? await api(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(mergedOverrides) })
        : await api(url);
      if (data.error) { this.setStatus(data.error); this.busy = false; return; }

      // Stamp meta for downstream
      data.meta.symbol = symbol;
      this.data = data;

      // ── Update single source of truth ──────────────────────────────────
      valuationModelState.update(data);
      valuationModelState.userOverrides = overrides || {};

      // ── Render ─────────────────────────────────────────────────────────
      const dcfFor = $("#dcfFor");
      if (dcfFor) dcfFor.textContent = data.meta.name + " · " + data.meta.currency;
      const idcfMeta = $("#idcfMeta");
      if (idcfMeta) idcfMeta.textContent = data.meta.unitNote;
      this.renderAssumptionPanel(overrides || {});
      const idcfOut = $("#idcfOut");
      if (idcfOut) idcfOut.innerHTML = renderAssumptionIntelligence(data, this.uiState) + renderInstitutionalDCF(data, this.uiState);
      // Wire up expanded-mode listeners (no-op when collapsed)
      this.wireExpandedPanel();

      // ── Status bar with model status + timestamp ────────────────────────
      const ts = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const statusTag = data.meta.modelStatus === "User-Adjusted"
        ? `<span class="vms-tag vms-adj">USER-ADJUSTED</span>`
        : `<span class="vms-tag vms-ev">EVIDENCE-BASED</span>`;
      this.setStatus(`${statusTag} <span class="vms-ts">Model updated ${ts} · edit any assumption to recompute</span>`, true);

      // ── Reveal the Export-to-Excel button (hidden until first model build)
      const expBtn = $("#idcfExportExcel");
      if (expBtn) {
        expBtn.style.display = "inline-block";
        if (!expBtn._wired) {
          expBtn._wired = true;
          expBtn.addEventListener("click", () => IDCF.exportExcel());
        }
      }

      // ── Scenario Manager reflects the freshly-built model ──
      if (typeof SCN !== "undefined") SCN.render();

    } catch (e) { this.setStatus("failed: " + e.message); }
    this.busy = false;
  },

  renderAssumptionPanel(overrides) {
    const a = this.data.idcf.assumptions, w = this.data.idcf.waccBuild;
    const ev = this.data.evidence?.assumptions || {};
    const N2 = (v) => v != null && isFinite(v) ? (+v).toFixed(2) : "";
    const confTag = (c) => c === "High" ? "conf-h" : c === "Medium" ? "conf-m" : "conf-l";
    // srcCls declared BEFORE it is used in the .map() below
    const srcCls = (s) => s === "Evidence-Based" ? "src-ev" : s === "Verified" ? "src-vr" : s === "Analyst Estimate" ? "src-ae" : "src-sp";

    // ── Single-source-of-truth value resolver ──────────────────────────────
    // For sidebar fields that also exist year-wise in the expanded table, the
    // sidebar must reflect any Y1 override the user has set in the expanded
    // panel. yearwise[k][0] wins over the scalar baseline.
    const yw = this.uiState.yearwise;
    const ywKey = { growthY1_5: "growth", ebitdaMargin: "ebitdaMargin", capexPctRev: "capexPctRev",
                    depPctRev: "depPctRev", taxRate: "taxRate", wcPctRev: "wcPctRev" };
    const effVal = (k, scalarDefault) => {
      const ywK = ywKey[k];
      if (ywK && yw[ywK] && yw[ywK][0] != null && isFinite(+yw[ywK][0])) return +yw[ywK][0];
      return scalarDefault;
    };

    const rows = [
      { k: "growthY1_5",  label: "Revenue Growth Y1 (%)", val: effVal("growthY1_5", a.growthY1_5),  step: 0.5,
        rec: ev.revenueGrowth?.recommended,    conf: ev.revenueGrowth?.confidence,
        hist: ev.revenueGrowth?.historical,    src: ev.revenueGrowth?.sourceStatus },
      { k: "fade",        label: "Annual Fade (%)",        val: a.fade,        step: 0.25,
        rec: null, conf: "Medium", hist: null, src: "Analyst Estimate" },
      { k: "ebitdaMargin",label: "EBITDA Margin (%)",      val: effVal("ebitdaMargin", a.ebitdaMargin),step: 0.5,
        rec: ev.ebitdaMargin?.recommended,     conf: ev.ebitdaMargin?.confidence,
        hist: ev.ebitdaMargin?.historical,     src: ev.ebitdaMargin?.sourceStatus },
      { k: "capexPctRev", label: "Capex (% Rev)",          val: effVal("capexPctRev", a.capexPctRev), step: 0.25,
        rec: ev.capexPctRev?.recommended,      conf: ev.capexPctRev?.confidence,
        hist: ev.capexPctRev?.historical,      src: ev.capexPctRev?.sourceStatus },
      { k: "depPctRev",   label: "D&A (% Rev)",            val: effVal("depPctRev", a.depPctRev),   step: 0.25,
        rec: ev.depPctRev?.recommended,        conf: ev.depPctRev?.confidence,
        hist: ev.depPctRev?.historical,        src: ev.depPctRev?.sourceStatus },
      { k: "taxRate",     label: "Tax Rate (%)",            val: effVal("taxRate", a.taxRate),     step: 0.5,
        rec: ev.taxRate?.recommended,          conf: ev.taxRate?.confidence,
        hist: ev.taxRate?.historical,          src: ev.taxRate?.sourceStatus },
      { k: "wcPctRev",    label: "ΔWC (% Rev Chg)",        val: effVal("wcPctRev", a.wcPctRev),    step: 0.25,
        rec: null, conf: ev.workingCapital?.confidence,
        hist: null, src: ev.workingCapital?.sourceStatus },
      { k: "rf",          label: "Risk-Free Rate (%)",      val: w.rf,          step: 0.1,
        rec: ev.wacc?.waccDecomposition?.rf,   conf: "High", hist: null, src: "Evidence-Based" },
      { k: "beta",        label: "Beta",                    val: w.beta,        step: 0.05,
        rec: ev.wacc?.waccDecomposition?.beta, conf: "High", hist: null, src: "Evidence-Based" },
      { k: "erp",         label: "Equity Risk Prem. (%)",   val: w.erp,         step: 0.25,
        rec: ev.wacc?.waccDecomposition?.erp,  conf: "High", hist: null, src: "Evidence-Based" },
      { k: "terminalG",   label: "Terminal Growth (%)",     val: a.terminalG,   step: 0.1,
        rec: ev.terminalGrowth?.recommended,   conf: ev.terminalGrowth?.confidence,
        hist: null, src: ev.terminalGrowth?.sourceStatus },
    ];

    const rowsHtml = rows.map(({ k, label, val, step, rec, conf, hist, src }) => {
      // "isOverride" is true if EITHER the sidebar passed a scalar override
      // OR the corresponding yearwise[k][0] is set (single-source-of-truth).
      const ywK = ywKey[k];
      const ywOv = ywK && yw[ywK] && yw[ywK][0] != null && isFinite(+yw[ywK][0]);
      const isOverride = (overrides && overrides[k] != null) || ywOv;
      const histRange = hist && hist.min != null && hist.max != null
        ? `<div class="ap-row-bot"><span class="ap-hist-range">${(+hist.min).toFixed(1)}–${(+hist.max).toFixed(1)}%</span></div>` : "";
      const recBadge = rec != null
        ? `<span class="ap-rec" title="AI recommended: ${(+rec).toFixed(1)}">${(+rec).toFixed(1)}</span>` : "";
      const confBadge = conf
        ? `<span class="ap-conf ${confTag(conf)}" title="Confidence: ${conf}">${conf[0]}</span>` : "";
      const srcLabel = src === "Evidence-Based" ? "EV" : src === "Verified" ? "VR" : src === "Analyst Estimate" ? "AE" : src ? "SP" : "";
      const srcBadge = srcLabel
        ? `<span class="ap-src ${srcCls(src)}" title="${src}">${srcLabel}</span>` : "";
      return `<div class="ap-row${isOverride ? " ap-override" : ""}">
        <div class="ap-row-top">
          <span class="ap-label">${label}</span>
          <div class="ap-badges">${confBadge}${srcBadge}</div>
        </div>
        <div class="ap-row-mid">
          <input class="ap-input" data-k="${k}" type="number" step="${step}" value="${N2(val)}"${isOverride ? ' data-override="1"' : ""}>
          ${recBadge}
        </div>
        ${histRange}
      </div>`;
    }).join("");

    // Model Quality Score — compact bar at top of sidebar


    // Legend strip — same pattern as terminal badge rows
    const legendHtml = `<div class="ap-legend">
      <span class="ap-conf conf-h">H</span>&thinsp;High
      <span class="ap-conf conf-m">M</span>&thinsp;Med
      <span class="ap-conf conf-l">L</span>&thinsp;Low
      &nbsp;·&nbsp;
      <span class="ap-src src-ev">EV</span>&thinsp;Evidence
      <span class="ap-src src-ae">AE</span>&thinsp;Estimate
    </div>`;

    // WACC derived — amber-accented footer row
    const waccHtml = `<div class="ap-wacc-derived">
      <span class="ap-label">WACC (DERIVED)</span>
      <div>
        <span class="ap-wacc-val">${(+a.wacc).toFixed(1)}%</span>
        <span class="ap-wacc-formula">rf ${w.rf}% + β${w.beta.toFixed(2)} × ERP${w.erp}%</span>
      </div>
    </div>`;

    const resetBtnHtml = Object.keys(overrides || {}).length
      ? `<button class="btn-reset-assumptions ap-full" id="apReset">↺ RESET TO RECOMMENDED</button>` : "";

    // Expand & Edit pill — sits at the top of the sidebar, full width.
    // Clicking re-renders the right column to show the year-wise table.
    const isExpanded = this.uiState.expandedMode;
    const expandPillHtml = `<button class="ap-expand-pill ap-full" id="apExpandPill" data-expanded="${isExpanded ? 1 : 0}">
      <span class="ap-expand-pill-lbl">${isExpanded ? "« COLLAPSE" : "EXPAND & EDIT"}</span>
      <span class="ap-expand-pill-icon">${isExpanded ? "×" : "›"}</span>
    </button>`;

    // Everything lives inside .ap-rows so grid handles all spanning and containment.
    // ap-mqs, ap-legend, ap-wacc-derived, ap-full all get grid-column:1/-1 via CSS.
    $("#dcfForm").innerHTML = `
      <div class="ap-rows">
        ${expandPillHtml}
        ${rowsHtml}
        ${waccHtml}
        ${resetBtnHtml}
        <div class="note ap-full">Edit any value to recompute the full model. Recommended (AI) values shown in amber. Overrides highlighted in amber border.${isExpanded ? "" : " Click <b>Expand &amp; Edit</b> for year-wise assumptions."}</div>
      </div>`;

    // ── Debounced recompute on input ─────────────────────────────────────
    // Sidebar edits to fields with year-wise equivalents also write into
    // uiState.yearwise[*][0] so the expanded Y1 cell visibly tracks the
    // sidebar value on next render (single-source-of-truth). The scalar is
    // still passed in `ov` so Y2+/terminal default math also picks it up.
    const sbToYw = { growthY1_5: "growth", ebitdaMargin: "ebitdaMargin", capexPctRev: "capexPctRev",
                     depPctRev: "depPctRev", taxRate: "taxRate", wcPctRev: "wcPctRev" };
    let timer;
    $$("#dcfForm .ap-input").forEach((inp) => inp.addEventListener("input", () => {
      // Sync the just-edited field into yearwise[*][0] immediately (no debounce)
      const k = inp.dataset.k;
      const v = parseFloat(inp.value);
      if (sbToYw[k] && isFinite(v)) {
        this.uiState.yearwise[sbToYw[k]][0] = v;
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        const ov = {};
        $$("#dcfForm .ap-input").forEach((x) => { const val = parseFloat(x.value); if (isFinite(val)) ov[x.dataset.k] = val; });
        this.load(this.symbol, ov);
      }, 450);
    }));

    // Reset button
    const resetEl = $("#apReset");
    if (resetEl) resetEl.addEventListener("click", () => {
      // Also clear all expanded-mode state on reset
      this.resetUiState();
      this.load(this.symbol);
    });

    // Expand & Edit toggle — just flips the flag and re-renders the right column.
    // We don't refetch; the existing data has everything needed.
    const expandEl = $("#apExpandPill");
    if (expandEl) expandEl.addEventListener("click", () => {
      this.uiState.expandedMode = !this.uiState.expandedMode;
      // If we're opening for the first time and the user hasn't set any yearwise
      // values yet, leave them as null (nulls render as "—" in locked cells in
      // the disclosed view, and as the model-default value when shown editable).
      this.renderAssumptionPanel(overrides);
      const idcfOut = $("#idcfOut");
      if (idcfOut && this.data) idcfOut.innerHTML = renderAssumptionIntelligence(this.data, this.uiState) + renderInstitutionalDCF(this.data, this.uiState);
      this.wireExpandedPanel();
    });
  },

  /** Reset all expanded-mode UI state back to defaults (called on full reset
   *  AND on company switch — see load()). Does NOT reset expandedMode itself,
   *  so the user's preference to keep the panel open survives company changes. */
  /** Build a fully-linked institutional-grade .xlsx workbook for the
   *  current company and trigger a browser download. Server does the
   *  heavy lifting (ExcelJS); we just hand it the current UI state and
   *  the integrated statements (which the client computes anyway for
   *  the IFFM panel). */
  async exportExcel() {
    if (!this.data || !this.symbol) return;
    const btn = document.getElementById("idcfExportExcel");
    const origText = btn ? btn.textContent : "";
    try {
      if (btn) { btn.disabled = true; btn.textContent = "Building workbook…"; btn.style.opacity = "0.7"; }
      this.setStatus("Building Excel model — this can take a few seconds…");

      // Compute the same integrated statements that the IFFM panel uses,
      // so the workbook reflects the exact figures the user sees on screen.
      let statements = null;
      try {
        statements = computeIntegratedStatements(this.data, this.uiState);
      } catch (e) {
        // Non-fatal — server will fall back to actuals-only.
        statements = null;
      }

      // ── BUG FIX (v42): The Excel export must rebuild the server-side IDCF
      // with the EXACT same overrides that drove the current screen — most
      // critically forecastHorizon, terminalMethod, and exitMultiple. The
      // previous build did `baseUserOv = valuationModelState.userOverrides`
      // (a property that doesn't exist on the state object → always {}),
      // and shipped horizon/method only inside `uiState`. The server reads
      // `req.body.userOverrides` for the IDCF rebuild and ignores `uiState`,
      // so every Excel was generated with horizon=5 and method=perpetual
      // regardless of the user's selection.
      //
      // Fix: build userOverrides exactly like load() does — gather scalar
      // sidebar inputs (growthY1_5, ebitdaMargin, wacc, …) from the DOM,
      // then merge through collectOverrides() so horizon/method/exitMultiple
      // and yearwise/capitalAllocation also flow in. Capital structure is
      // added on top.
      const sidebarOv = {};
      $$("#dcfForm .ap-input").forEach((x) => {
        const val = parseFloat(x.value);
        if (isFinite(val) && x.dataset.k) sidebarOv[x.dataset.k] = val;
      });
      const mergedOv = this.collectOverrides(sidebarOv);
      if (this.uiState.capitalStructure) {
        ["netDebt", "stDebt", "ltDebt", "cash"].forEach((k) => {
          const v = this.uiState.capitalStructure[k];
          if (v != null && isFinite(+v)) mergedOv[k] = +v;
        });
      }
      const payload = {
        userOverrides: mergedOv,
        uiState: {
          forecastHorizon: this.uiState.forecastHorizon,
          terminalMethod: this.uiState.terminalMethod,
          exitMultiple: this.uiState.exitMultiple,
          yearwise: this.uiState.yearwise,
          capitalAllocation: this.uiState.capitalAllocation,
          capitalStructure: this.uiState.capitalStructure,
        },
        statements,
      };

      const res = await fetch(`/api/idcf/${this.symbol}/excel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Server returned ${res.status}: ${errText.slice(0, 200)}`);
      }
      const blob = await res.blob();
      const ts = new Date().toISOString().slice(0, 10);
      const fileName = `${this.symbol}_DCF_Model_${ts}.xlsx`;
      // Trigger download via temporary <a>
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
      this.setStatus(`✓ Downloaded ${fileName} (${(blob.size / 1024).toFixed(0)} KB)`, true);
    } catch (e) {
      console.error("Excel export failed:", e);
      this.setStatus("Excel export failed — " + (e.message || e));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = origText; btn.style.opacity = "1"; }
    }
  },

  resetUiState() {
    this.uiState.forecastHorizon = 5;
    this.uiState.terminalMethod = "perpetual";
    this.uiState.exitMultiple = 12;
    this.uiState.activeFinTab = "income";
    this.uiState.bsExpanded = null;
    Object.keys(this.uiState.yearwise).forEach((k) => { this.uiState.yearwise[k] = [null, null, null]; });
    Object.keys(this.uiState.capitalAllocation).forEach((k) => { this.uiState.capitalAllocation[k] = [null, null, null]; });
    this.uiState.expandedRows.clear();
    // Task 5: clear capital-structure overrides on company switch
    this.uiState.capitalStructure = {};
  },

  /** Wire all listeners inside the expanded year-wise table. Idempotent — safe
   *  to call after every right-column render. No-op when collapsed. */
  wireExpandedPanel() {
    if (!this.uiState.expandedMode) return;
    const root = document.getElementById("apeRoot");
    if (!root) return;

    // Forecast horizon segmented control
    root.querySelectorAll("[data-ape-horizon]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const h = +btn.dataset.apeHorizon;
        if (this.uiState.forecastHorizon === h) return;
        this.uiState.forecastHorizon = h;
        this.load(this.symbol);
      });
    });

    // Terminal method dropdown
    const tmSel = root.querySelector("#apeTermMethod");
    if (tmSel) tmSel.addEventListener("change", () => {
      this.uiState.terminalMethod = tmSel.value === "exitMultiple" ? "exitMultiple" : "perpetual";
      this.load(this.symbol);
    });

    // Exit multiple input
    const emInp = root.querySelector("#apeExitMult");
    if (emInp) {
      let t;
      emInp.addEventListener("input", () => {
        clearTimeout(t);
        t = setTimeout(() => {
          const v = parseFloat(emInp.value);
          if (isFinite(v) && v > 0) { this.uiState.exitMultiple = v; this.load(this.symbol); }
        }, 450);
      });
    }

    // Row disclosure arrows
    root.querySelectorAll("[data-ape-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const k = btn.dataset.apeToggle;
        if (this.uiState.expandedRows.has(k)) this.uiState.expandedRows.delete(k);
        else this.uiState.expandedRows.add(k);
        // Re-render right column only (no backend call)
        const idcfOut = $("#idcfOut");
        if (idcfOut && this.data) idcfOut.innerHTML = renderAssumptionIntelligence(this.data, this.uiState) + renderInstitutionalDCF(this.data, this.uiState);
        this.wireExpandedPanel();
      });
    });

    // Per-year editable cells (Y1, Y2, Y3) for assumption rows
    // BUG FIX: only update the cell the user actually edited. Previously we
    // read back EVERY expanded cell on each input, which stamped untouched
    // defaults into yearwise[*][0..2] and prevented sidebar edits from ever
    // reaching Y1 again. Now each input writes only its own cell.
    let timer;
    root.querySelectorAll("input.ape-cell-input").forEach((inp) => {
      inp.addEventListener("input", () => {
        const group = inp.dataset.apeGroup;       // "yearwise" | "capitalAllocation"
        const key   = inp.dataset.apeKey;
        const yIdx  = +inp.dataset.apeYear;       // 0, 1, 2
        const csKey = inp.dataset.apeCs;          // Task 5: capital-structure scalar
        const raw   = inp.value;
        const v     = raw === "" ? null : parseFloat(raw);
        if (csKey) {
          // Capital-structure scalar override (netDebt / stDebt / ltDebt / cash)
          // Stored under uiState.capitalStructure; sent as raw monetary values
          // (display × scale) to the backend, since the engine uses raw scale.
          if (!this.uiState.capitalStructure) this.uiState.capitalStructure = {};
          const ccy = this.data?.meta?.currency || "INR";
          const sc = ccy === "INR" ? 1e7 : 1e6;
          this.uiState.capitalStructure[csKey] = (v != null && isFinite(v)) ? v * sc : null;
        } else if (group && key && yIdx >= 0 && yIdx <= 2) {
          this.uiState[group][key][yIdx] = (v != null && isFinite(v)) ? v : null;
        }
        clearTimeout(timer);
        timer = setTimeout(() => this.load(this.symbol), 500);
      });
    });

    // ── Integrated Forecast Financial Model — tab switching ─────────────
    // Lives inside Section 2 of renderInstitutionalDCF (right column of idcfOut).
    // Toggle classes only; no full re-render. Persists choice in uiState so the
    // active tab survives recomputes triggered by other inputs.
    const iffmRoot = document.getElementById("s2ExpandedRoot");
    if (iffmRoot) {
      // Freeze-pane offsets for the currently-active tab's table. Inactive
      // tabs are display:none and measure as zero-width, so they're picked
      // up by the same call inside the tab-click handler below once shown.
      applyStickyColumns(iffmRoot);

      iffmRoot.querySelectorAll("[data-iffm-tab]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const tab = btn.dataset.iffmTab;
          if (!tab || this.uiState.activeFinTab === tab) return;
          this.uiState.activeFinTab = tab;
          iffmRoot.querySelectorAll("[data-iffm-tab]").forEach((b) => b.classList.toggle("is-active", b.dataset.iffmTab === tab));
          iffmRoot.querySelectorAll("[data-iffm-pane]").forEach((p) => p.classList.toggle("is-active", p.dataset.iffmPane === tab));
          // The newly-shown pane has real width now — (re)measure it.
          applyStickyColumns(iffmRoot);
        });
      });

      // ── Balance Sheet chevron click — expand/collapse ──────────────────
      // When a parent's chevron is clicked, toggle its state. Then walk the
      // descendant tree: each row whose nearest ancestor is collapsed gets
      // .bs-hidden. This handles arbitrary nesting depth (BS goes 4 levels).
      iffmRoot.querySelectorAll("[data-bs-chev]").forEach((chev) => {
        chev.addEventListener("click", (e) => {
          e.stopPropagation();
          const id = chev.dataset.bsChev;
          if (!id) return;
          if (!(this.uiState.bsExpanded instanceof Set)) {
            this.uiState.bsExpanded = new Set();
          }
          // Toggle
          if (this.uiState.bsExpanded.has(id)) this.uiState.bsExpanded.delete(id);
          else this.uiState.bsExpanded.add(id);
          chev.classList.toggle("is-open");
          // Walk descendants — hide if ANY ancestor in the chain is collapsed
          const bsExp = this.uiState.bsExpanded;
          // Build parent→children map by reading data attributes from DOM
          const allRows = iffmRoot.querySelectorAll("tr[data-bs-id]");
          const rowById = {};
          allRows.forEach((tr) => { rowById[tr.dataset.bsId] = tr; });
          allRows.forEach((tr) => {
            const myParent = tr.dataset.bsParent;
            if (!myParent) return; // top-level rows always visible
            // Walk up; hide if any ancestor in chain is not in bsExp
            let p = myParent, visible = true;
            while (p) {
              if (!bsExp.has(p)) { visible = false; break; }
              p = rowById[p]?.dataset.bsParent || null;
            }
            tr.classList.toggle("bs-hidden", !visible);
          });
          // Expanding/collapsing a row can change which label text is in
          // flow, which can change column-1's natural width — re-measure.
          applyStickyColumns(iffmRoot);
        });
      });
    }
  },
};

/* ════════════════════════════════════════════════════════════════════════════
   ASSUMPTION INTELLIGENCE & EVIDENCE LAYER
   Renders before Section 1 of the DCF model. Shows the full evidence base
   behind every assumption — historical stats, methodology, confidence.
   ════════════════════════════════════════════════════════════════════════════ */
function renderAssumptionIntelligence(data, uiState) {
  const ev = data.evidence;
  const meta = data.meta;
  if (!ev || ev.error) {
    return `<div class="ai-layer ai-layer-err"><span class="ai-layer-ttl">ASSUMPTION INTELLIGENCE</span><span class="muted">Evidence layer unavailable for this issuer.</span></div>`;
  }

  const N1 = (v) => v != null && isFinite(v) ? (+v).toFixed(1) : "—";
  const N0 = (v) => v != null && isFinite(v) ? (+v).toFixed(0) : "—";
  const P1 = (v) => v != null && isFinite(v) ? (+v).toFixed(1) + "%" : "—";
  const P0 = (v) => v != null && isFinite(v) ? (+v).toFixed(0) + "%" : "—";
  const confCls = (c) => c === "High" ? "conf-h" : c === "Medium" ? "conf-m" : "conf-l";
  const srcCls  = (s) => s === "Evidence-Based" ? "src-ev" : s === "Verified" ? "src-vr" : s === "Analyst Estimate" ? "src-ae" : "src-sp";

  const mqs = ev.modelQualityScore || {};
  const diag = ev.modelDiagnostics || [];
  const a = ev.assumptions || {};

  // ── Model Status Card ─────────────────────────────────────────────────
  const statusCls = meta.modelStatus === "User-Adjusted" ? "vms-adj" : "vms-ev";
  const statusCard = `<div class="ai-status-card">
    <div class="ai-sc-left">
      <div class="ai-sc-row"><span class="ai-sc-lbl">COMPANY</span><span>${meta.name} · ${meta.symbol}</span></div>
      <div class="ai-sc-row"><span class="ai-sc-lbl">SECTOR</span><span>${meta.sector || ev.sectorClass || "—"}</span></div>
      <div class="ai-sc-row"><span class="ai-sc-lbl">DATA PERIOD</span><span>${ev.dataYears || "—"} years actuals · latest FY${String(ev.latestYear || "").slice(2)}</span></div>
      <div class="ai-sc-row"><span class="ai-sc-lbl">MODEL STATUS</span><span class="vms-tag ${statusCls}">${meta.modelStatus}</span></div>
    </div>
    <div class="ai-sc-right">
      <div class="ai-mqs-big">
        <div class="ai-mqs-num ${mqs.label === "High" ? "mqs-h" : mqs.label === "Moderate" ? "mqs-m" : "mqs-l"}">${mqs.score ?? "—"}</div>
        <div class="ai-mqs-lbl">MODEL QUALITY</div>
        <div class="ai-mqs-sub">${mqs.label || ""} Reliability</div>
        <div class="ai-mqs-bar"><i style="width:${mqs.score || 0}%"></i></div>
      </div>
    </div>
  </div>`;

  // ── MQS Breakdown ─────────────────────────────────────────────────────
  const mqsDetail = (mqs.strengths?.length || mqs.weaknesses?.length) ? `
    <div class="ai-mqs-detail">
      ${(mqs.strengths || []).map((s) => `<div class="ai-mqs-item ai-mqs-str">✓ ${s}</div>`).join("")}
      ${(mqs.weaknesses || []).map((w) => `<div class="ai-mqs-item ai-mqs-wk">⚠ ${w}</div>`).join("")}
    </div>` : "";

  // ── Diagnostics / Red Flags ───────────────────────────────────────────
  let diagHtml = "";
  if (diag.length) {
    const sevCls = (s) => s === "Critical" ? "diag-crit" : s === "High" ? "diag-high" : s === "Medium" ? "diag-med" : "diag-low";
    diagHtml = `<div class="ai-diag">
      <div class="ai-diag-hdr"><span class="ai-sec-ttl">MODEL DIAGNOSTICS</span><span class="ai-sec-sub">${diag.length} flag${diag.length > 1 ? "s" : ""} detected</span></div>
      ${diag.map((f) => `<div class="ai-diag-row ${sevCls(f.severity)}">
        <div class="ai-diag-sev">${f.severity}</div>
        <div class="ai-diag-body">
          <div class="ai-diag-title">${f.check}</div>
          <div class="ai-diag-detail">${f.detail}</div>
          <div class="ai-diag-fix"><b>Suggested fix:</b> ${f.fix}</div>
        </div>
      </div>`).join("")}
    </div>`;
  }

  // ── Assumption Evidence Table ─────────────────────────────────────────
  // Helper to render a table row
  const aRow = (label, baseInput, recVal, histAvg, histRange, conf, src, formula, methodology, unit = "%") => {
    const hasRange = histRange && (histRange.min != null || histRange.max != null);
    const rangeStr = hasRange
      ? `${N1(histRange.min)}–${N1(histRange.max)}${unit}`
      : "—";
    const avgStr = histAvg != null ? N1(histAvg) + unit : "—";
    const recStr = recVal != null ? N1(recVal) + unit : "—";
    const baseStr = baseInput != null ? N1(baseInput) + unit : "—";
    const trendIcon = histRange?.trend === "improving" ? "↑" : histRange?.trend === "declining" ? "↓" : "→";
    const trendCls  = histRange?.trend === "improving" ? "up" : histRange?.trend === "declining" ? "down" : "";

    // Expandable methodology panel
    const expandId = "aie-" + label.replace(/\W+/g, "_");
    return `<tr class="aie-row">
      <td class="aie-label">${label}</td>
      <td class="aie-base">${baseStr}</td>
      <td class="aie-hist">${avgStr} <span class="aie-range">[${rangeStr}]</span> <span class="${trendCls}">${trendIcon}</span></td>
      <td class="aie-rec">${recStr}</td>
      <td class="aie-conf"><span class="ap-conf ${confCls(conf)}">${conf?.[0] || "?"}</span></td>
      <td class="aie-src"><span class="ap-src ${srcCls(src)}" title="${src}">${src === "Evidence-Based" ? "EV" : src === "Verified" ? "VR" : src === "Analyst Estimate" ? "AE" : "SP"}</span></td>
      <td class="aie-expand"><button class="aie-btn" data-target="${expandId}">▾ method</button></td>
    </tr>
    <tr class="aie-detail-row" id="${expandId}" hidden>
      <td colspan="7">
        <div class="aie-detail-body">
          <div class="aie-detail-formula"><span class="aie-detail-lbl">Formula</span>${formula || "—"}</div>
          <div class="aie-detail-method"><span class="aie-detail-lbl">Methodology</span>${methodology || "—"}</div>
          ${histRange?.years ? `<div class="aie-detail-method"><span class="aie-detail-lbl">Data Points</span>${histRange.years} year(s) of actuals</div>` : ""}
        </div>
      </td>
    </tr>`;
  };

  // Working capital special row
  const wc = a.workingCapital || {};
  const wcHist = wc.historical || {};
  const wcRowsHtml = `<tr class="aie-row">
    <td class="aie-label">Working Capital (DSO/DIO/DPO)</td>
    <td class="aie-base">ΔWC driver</td>
    <td class="aie-hist">
      DSO ${N0(wcHist.dso?.avg)}d &nbsp; DIO ${N0(wcHist.dio?.avg)}d &nbsp; DPO ${N0(wcHist.dpo?.avg)}d
    </td>
    <td class="aie-rec">—</td>
    <td class="aie-conf"><span class="ap-conf ${confCls(wc.confidence)}">${(wc.confidence || "L")[0]}</span></td>
    <td class="aie-src"><span class="ap-src ${srcCls(wc.sourceStatus)}" title="${wc.sourceStatus || ""}">${wc.sourceStatus === "Evidence-Based" ? "EV" : "AE"}</span></td>
    <td class="aie-expand"><button class="aie-btn" data-target="aie-wc">▾ method</button></td>
  </tr>
  <tr class="aie-detail-row" id="aie-wc" hidden>
    <td colspan="7">
      <div class="aie-detail-body">
        <div class="aie-detail-formula"><span class="aie-detail-lbl">Formula</span>${wc.formula || "—"}</div>
        <div class="aie-detail-method"><span class="aie-detail-lbl">Methodology</span>${wc.methodology || "—"}</div>
      </div>
    </td>
  </tr>`;

  // WACC special row
  const waccEv = a.wacc || {};
  const wd = waccEv.waccDecomposition || {};
  const waccDetailHtml = `<tr class="aie-row">
    <td class="aie-label">WACC</td>
    <td class="aie-base">${P1(waccEv.baseInput)}</td>
    <td class="aie-hist">Ke ${N1(wd.costEquity)}% &nbsp; Kd ${N1(wd.costDebt)}% &nbsp; ${N1(wd.weightEquity)}/${N1(wd.weightDebt)} split</td>
    <td class="aie-rec">${P1(waccEv.recommended)}</td>
    <td class="aie-conf"><span class="ap-conf ${confCls(waccEv.confidence)}">${(waccEv.confidence || "H")[0]}</span></td>
    <td class="aie-src"><span class="ap-src src-ev" title="Evidence-Based">EV</span></td>
    <td class="aie-expand"><button class="aie-btn" data-target="aie-wacc">▾ method</button></td>
  </tr>
  <tr class="aie-detail-row" id="aie-wacc" hidden>
    <td colspan="7">
      <div class="aie-detail-body">
        <div class="aie-detail-formula"><span class="aie-detail-lbl">Formula</span>${waccEv.formula || "—"}</div>
        <div class="aie-detail-method"><span class="aie-detail-lbl">Methodology</span>${waccEv.methodology || "—"}</div>
        <div class="aie-wacc-decomp">
          <span>rf <b>${N1(wd.rf)}%</b></span>
          <span>β <b>${(wd.beta || 0).toFixed(2)}</b></span>
          <span>ERP <b>${N1(wd.erp)}%</b></span>
          <span>Ke <b>${N1(wd.costEquity)}%</b></span>
          <span>Kd (AT) <b>${N1(wd.costDebt)}%</b></span>
          <span>Weight <b>${N1(wd.weightEquity)}/${N1(wd.weightDebt)}</b></span>
          <span>WACC <b>${N1(wd.impliedWacc)}%</b></span>
        </div>
      </div>
    </td>
  </tr>`;

  const tableRows = [
    aRow("Revenue Growth", a.revenueGrowth?.baseInput, a.revenueGrowth?.recommended,
      a.revenueGrowth?.historical?.avg, a.revenueGrowth?.historical,
      a.revenueGrowth?.confidence, a.revenueGrowth?.sourceStatus,
      a.revenueGrowth?.formula, a.revenueGrowth?.methodology),
    aRow("EBITDA Margin", a.ebitdaMargin?.baseInput, a.ebitdaMargin?.recommended,
      a.ebitdaMargin?.historical?.avg, a.ebitdaMargin?.historical,
      a.ebitdaMargin?.confidence, a.ebitdaMargin?.sourceStatus,
      a.ebitdaMargin?.formula, a.ebitdaMargin?.methodology),
    aRow("Capex % Revenue", a.capexPctRev?.baseInput, a.capexPctRev?.recommended,
      a.capexPctRev?.historical?.avg, a.capexPctRev?.historical,
      a.capexPctRev?.confidence, a.capexPctRev?.sourceStatus,
      a.capexPctRev?.formula, a.capexPctRev?.methodology),
    aRow("D&A % Revenue", a.depPctRev?.baseInput, a.depPctRev?.recommended,
      a.depPctRev?.historical?.avg, a.depPctRev?.historical,
      a.depPctRev?.confidence, a.depPctRev?.sourceStatus,
      a.depPctRev?.formula, a.depPctRev?.methodology),
    aRow("Effective Tax Rate", a.taxRate?.baseInput, a.taxRate?.recommended,
      a.taxRate?.historical?.avg, a.taxRate?.historical,
      a.taxRate?.confidence, a.taxRate?.sourceStatus,
      a.taxRate?.formula, a.taxRate?.methodology),
    wcRowsHtml,
    waccDetailHtml,
    aRow("Terminal Growth", a.terminalGrowth?.baseInput, a.terminalGrowth?.recommended,
      null, null,
      a.terminalGrowth?.confidence, a.terminalGrowth?.sourceStatus,
      a.terminalGrowth?.formula, a.terminalGrowth?.methodology),
  ];

  // Returns summary row
  const roeH = a.roe?.historical || {}, roceH = a.roce?.historical || {};
  const returnsRow = (roeH.avg != null || roceH.avg != null) ? `<tr class="aie-row aie-returns">
    <td class="aie-label" colspan="2">Returns (historical)</td>
    <td colspan="2">ROE ${P1(roeH.avg)} avg &nbsp;·&nbsp; ROCE ${P1(roceH.avg)} avg &nbsp;·&nbsp; trend ${roeH.trend || "—"}</td>
    <td colspan="3" class="muted">Reference — not a DCF input</td>
  </tr>` : "";

  const evidenceTable = `<div class="ai-evidence">
    <div class="ai-sec-hdr">
      <span class="ai-sec-ttl">ASSUMPTION EVIDENCE TABLE</span>
      <span class="ai-sec-sub"></span>
    </div>
    <div class="ai-table-wrap">
      <table class="aie-table">
        <thead><tr>
          <th>Assumption</th><th>Base Input</th><th>Historical Evidence</th>
          <th>Recommended</th><th>Conf</th><th>Source</th><th></th>
        </tr></thead>
        <tbody>${tableRows.join("")}${returnsRow}</tbody>
      </table>
    </div>
    <div class="ai-legend-row">
      <span class="ap-conf conf-h">H</span> High confidence &nbsp;
      <span class="ap-conf conf-m">M</span> Medium &nbsp;
      <span class="ap-conf conf-l">L</span> Low &nbsp;·&nbsp;
      <span class="ap-src src-ev">EV</span> Evidence-Based &nbsp;
      <span class="ap-src src-ae">AE</span> Analyst Estimate &nbsp;
      <span class="ap-src src-sp">SP</span> Speculative
    </div>
  </div>`;

  // Expanded year-wise table — rendered only when uiState.expandedMode is on.
  // Sits between MODEL DIAGNOSTICS and the ASSUMPTION EVIDENCE TABLE per spec.
  const expandedHtml = (uiState && uiState.expandedMode)
    ? renderExpandedAssumptions(data, uiState)
    : "";

  const html = `<div class="ai-layer">
  
    ${statusCard}
    ${mqsDetail}
    ${diagHtml}
    ${expandedHtml}
    ${evidenceTable}
  </div>`;

  // Wire up expand toggles after render (deferred)
  setTimeout(() => {
    $$(".aie-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = document.getElementById(btn.dataset.target);
        if (!target) return;
        const open = !target.hidden;
        target.hidden = open;
        btn.textContent = open ? "▾ method" : "▴ close";
      });
    });
  }, 0);

  return html;
}

/* ════════════════════════════════════════════════════════════════════════════
   EXPANDED YEAR-WISE ASSUMPTIONS TABLE  (Modeling Lab — expanded mode)

   Renders inside the Assumption Intelligence layer between Model Diagnostics
   and the Assumption Evidence Table when the user clicks "Expand & Edit".

   Layout (matches reference screenshot 2):
     • Header — title + Forecast Horizon segmented control (3/5/7/10)
     • Compact legend strip (reuses .ap-conf / .ap-src classes)
     • Single-column institutional grid table:
         actuals (last 3 yrs) | forecast (1..horizon) | terminal
     • Sections (collapsible rows, each with disclosure arrow):
         1. Growth      — Revenue Growth, EBITDA Margin
         2. Reinvestment— Capex % Rev, D&A % Rev, ΔWC % Rev
         3. Tax         — Effective Tax Rate
         4. Cost of Cap.— WACC (derived, read-only)
         5. Terminal    — Method toggle (Perpetual / Exit Multiple), Terminal Growth or Exit Multiple
         6. Share Struc.— Shares Out, Net Debt (informational, derived)
         7. Capital All.— Dividend Payout, Buyback, Debt Repayment, Strategic Acq.
     • Y1-Y3 cells are editable; Y4..horizon and Terminal are auto-derived (locked).
   ════════════════════════════════════════════════════════════════════════════ */
function renderExpandedAssumptions(data, ui) {
  const d = data.idcf;
  if (!d || d.error) return "";

  const ccy = data.meta.currency;
  const isINR = ccy === "INR";
  const unit  = isINR ? "₹ Cr" : (ccy === "USD" ? "$ Mn" : ccy + " Mn");
  const scale = isINR ? 1e7 : 1e6;

  const horizon  = d.forecastHorizon || ui.forecastHorizon || 5;
  const histRows = (d.hist || []).slice(-3);                 // last 3 actuals
  const fcRows   = d.base?.rows || [];
  const a        = d.assumptions;
  const w        = d.waccBuild;
  const ev       = data.evidence?.assumptions || {};

  const N1 = (v) => v != null && isFinite(v) ? (+v).toFixed(1) : "—";
  const N2 = (v) => v != null && isFinite(v) ? (+v).toFixed(2) : "—";
  const P1 = (v) => v != null && isFinite(v) ? (+v).toFixed(1) + "%" : "—";
  const P2 = (v) => v != null && isFinite(v) ? (+v).toFixed(2) + "%" : "—";
  const U0 = (v) => (v == null || !isFinite(v)) ? "—" : (v / scale).toLocaleString("en-IN", { maximumFractionDigits: 0 });
  const fy = (y) => "FY" + String(y).slice(2);
  const confTag = (c) => c === "High" ? "conf-h" : c === "Medium" ? "conf-m" : "conf-l";
  const srcCls  = (s) => s === "Evidence-Based" ? "src-ev" : s === "Verified" ? "src-vr" : s === "Analyst Estimate" ? "src-ae" : "src-sp";
  const srcLbl  = (s) => s === "Evidence-Based" ? "EV" : s === "Verified" ? "VR" : s === "Analyst Estimate" ? "AE" : s ? "SP" : "";

  // ── Header — title + horizon selector ────────────────────────────────────
  const horizons = [3, 5, 7, 10];
  const horizonHtml = horizons.map((h) => `<button class="ape-horiz-btn${h === horizon ? " is-active" : ""}" data-ape-horizon="${h}">${h} YR</button>`).join("");

  const headerHtml = `<div class="ape-hdr">
    <span class="ai-sec-ttl">EXPANDED ASSUMPTIONS <span class="ape-hdr-sub">(EDIT NEXT 3 YEARS ONLY)</span></span>
    <div class="ape-hdr-right">
      <span class="ape-hdr-lbl">Forecast Horizon</span>
      <div class="ape-horiz-grp">${horizonHtml}</div>
    </div>
  </div>`;

  // ── Compact legend (matches reference) ────────────────────────────────────
  const legendHtml = `<div class="ape-legend">
    <span class="ape-leg-item"><span class="ape-leg-edit"></span>Editable</span>
    <span class="ape-leg-item"><span class="ape-leg-lock">🔒</span>Auto-derived (Locked)</span>
    <span class="ape-leg-item"><span class="ap-conf conf-h">H</span>High</span>
    <span class="ape-leg-item"><span class="ap-conf conf-m">M</span>Medium</span>
    <span class="ape-leg-item"><span class="ap-conf conf-l">L</span>Low</span>
    <span class="ape-leg-item"><span class="ap-src src-ev">EV</span>Evidence-Based</span>
    <span class="ape-leg-item"><span class="ap-src src-ae">AE</span>Analyst Estimate</span>
    <span class="ape-leg-item"><span class="ap-src src-vr">Calc</span>Derived</span>
  </div>`;

  // ── Column header row (Actuals | Forecast | Terminal) ────────────────────
  const histYears = histRows.map((h) => fy(h.year));
  const fcYears   = fcRows.map((r, i) => {
    const tag = i < 3 ? ` <span class="ape-yr-tag">(Y${i + 1})</span>` : "";
    return fy(r.year) + tag;
  });
  // Group spans: actuals (3) + forecast (horizon) + terminal (1) + conf (1)
  const colHdr = `<thead>
    <tr class="ape-grp-hdr">
      <th></th>
      <th colspan="${histYears.length}" class="ape-grp-actuals">ACTUALS</th>
      <th colspan="${fcRows.length}" class="ape-grp-forecast">FORECAST (${unit})</th>
      <th class="ape-grp-terminal">TERMINAL</th>
      <th class="ape-grp-conf"></th>
    </tr>
    <tr class="ape-yr-hdr">
      <th class="ape-row-lbl">ASSUMPTION</th>
      ${histYears.map((y) => `<th class="ape-act">${y}</th>`).join("")}
      ${fcYears.map((y) => `<th class="ape-fc">${y}</th>`).join("")}
      <th class="ape-term">—</th>
      <th class="ape-conf-hdr">CONF</th>
    </tr>
  </thead>`;

  // ── Cell helpers ──────────────────────────────────────────────────────────
  // Editable cell (Y1..Y3): renders an <input>
  const editCell = (group, key, yIdx, val, suffix = "%") => {
    const userVal = ui[group]?.[key]?.[yIdx];
    const showVal = (userVal != null && isFinite(+userVal)) ? userVal : val;
    const isOverride = userVal != null && isFinite(+userVal);
    return `<td class="ape-cell ape-edit${isOverride ? " is-override" : ""}">
      <span class="ape-cell-icon">✎</span>
      <input class="ape-cell-input" data-ape-group="${group}" data-ape-key="${key}" data-ape-year="${yIdx}"
             type="number" step="0.1" value="${showVal != null && isFinite(showVal) ? (+showVal).toFixed(1) : ""}"
             aria-label="${key} Y${yIdx + 1}">
      <span class="ape-cell-suffix">${suffix}</span>
    </td>`;
  };
  // Locked cell (Y4+ or Terminal): plain text, muted
  const lockCell = (val, suffix = "%", extra = "") => {
    if (val == null || !isFinite(val)) return `<td class="ape-cell ape-lock ${extra}"><span class="muted">—</span></td>`;
    return `<td class="ape-cell ape-lock ${extra}">${(+val).toFixed(1)}<span class="ape-cell-suffix">${suffix}</span></td>`;
  };
  // Actuals cell (historical, read-only, no suffix box)
  const actCell = (val, suffix = "%") => {
    if (val == null || !isFinite(val)) return `<td class="ape-cell ape-act-cell"><span class="muted">—</span></td>`;
    return `<td class="ape-cell ape-act-cell">${(+val).toFixed(1)}<span class="ape-cell-suffix">${suffix}</span></td>`;
  };
  // Money cell (₹ Cr, no suffix, scaled)
  const moneyAct = (v) => `<td class="ape-cell ape-act-cell">${U0(v)}</td>`;
  const moneyLock = (v) => `<td class="ape-cell ape-lock">${U0(v)}</td>`;

  // Confidence + source mini chips at row end
  const confChip = (c, s) => {
    const cBadge = c ? `<span class="ap-conf ${confTag(c)}" title="${c}">${c[0]}</span>` : "";
    const sLbl = srcLbl(s);
    const sBadge = sLbl ? `<span class="ap-src ${srcCls(s)}" title="${s || ""}">${sLbl}</span>` : "";
    return `<td class="ape-conf-cell">${cBadge}${sBadge}</td>`;
  };

  // ── Assumption row builder ────────────────────────────────────────────────
  // metricKey selects the per-year fcRows value (e.g. "growth", "margin" — see d.base.rows)
  // group / key map to ui.yearwise[key]
  // hist values come from data.idcf.hist (per-year actuals like revGrowth, ebitdaMargin, etc.)
  // terminal: terminal value to show in Terminal column (or null for "—")
  const assumpRow = (cfg) => {
    const { label, group = "yearwise", key, fcField, histField, terminalVal, suffix = "%",
            conf, src, num = "" } = cfg;
    const cells = [];
    // Actuals
    histRows.forEach((h) => cells.push(actCell(h[histField], suffix)));
    // Forecast: Y1-Y3 editable, Y4+ locked
    fcRows.forEach((r, i) => {
      const v = r[fcField];
      if (i < 3) cells.push(editCell(group, key, i, v, suffix));
      else cells.push(lockCell(v, suffix));
    });
    // Terminal
    cells.push(lockCell(terminalVal, suffix));
    // Conf chips
    cells.push(confChip(conf, src));
    return `<tr class="ape-row" data-ape-key="${key}">
      <td class="ape-row-lbl">${num}${label} <span class="ape-row-suffix">(${suffix})</span></td>
      ${cells.join("")}
    </tr>`;
  };

  // Section header row (full-width)
  const sectionHdr = (n, title) => `<tr class="ape-sec-hdr"><td colspan="${1 + histRows.length + fcRows.length + 1 + 1}">${n}. ${title}</td></tr>`;

  // ── Build rows ────────────────────────────────────────────────────────────
  const rows = [];

  // 1. GROWTH
  rows.push(sectionHdr(1, "GROWTH"));
  rows.push(assumpRow({
    label: "Revenue Growth", key: "growth", fcField: "growth", histField: "revGrowth",
    terminalVal: a.terminalG, suffix: "%",
    conf: ev.revenueGrowth?.confidence, src: ev.revenueGrowth?.sourceStatus,
  }));
  rows.push(assumpRow({
    label: "EBITDA Margin", key: "ebitdaMargin", fcField: "margin", histField: "ebitdaMargin",
    terminalVal: null, suffix: "%",
    conf: ev.ebitdaMargin?.confidence, src: ev.ebitdaMargin?.sourceStatus,
  }));

  // 2. REINVESTMENT — capex, D&A, ΔWC
  rows.push(sectionHdr(2, "REINVESTMENT"));
  // Capex % rev: actuals have capexPctRev; forecast row has capex/rev = capexPctRev (stored as fraction). We derive % per row.
  const capRows = fcRows.map((r) => ({ ...r, capPct: r.rev ? (r.capex / r.rev) * 100 : null }));
  rows.push(`<tr class="ape-row" data-ape-key="capexPctRev">
    <td class="ape-row-lbl">Capex <span class="ape-row-suffix">(% Revenue)</span></td>
    ${histRows.map((h) => actCell(h.capexPctRev, "%")).join("")}
    ${capRows.map((r, i) => (i < 3 ? editCell("yearwise", "capexPctRev", i, r.capPct, "%") : lockCell(r.capPct, "%"))).join("")}
    ${lockCell(null, "%")}
    ${confChip(ev.capexPctRev?.confidence, ev.capexPctRev?.sourceStatus)}
  </tr>`);
  const depRows = fcRows.map((r) => ({ ...r, depPct: r.rev ? (r.dep / r.rev) * 100 : null }));
  rows.push(`<tr class="ape-row" data-ape-key="depPctRev">
    <td class="ape-row-lbl">D&amp;A <span class="ape-row-suffix">(% Revenue)</span></td>
    ${histRows.map((h) => actCell(h.depPctRev, "%")).join("")}
    ${depRows.map((r, i) => (i < 3 ? editCell("yearwise", "depPctRev", i, r.depPct, "%") : lockCell(r.depPct, "%"))).join("")}
    ${lockCell(null, "%")}
    ${confChip(ev.depPctRev?.confidence, ev.depPctRev?.sourceStatus)}
  </tr>`);
  // ΔWC % Revenue change — only forecast (no per-year hist value; show ΔWC/ΔRev)
  const wcRows = fcRows.map((r, i, arr) => {
    const prevRev = i === 0 ? null : arr[i - 1].rev;
    const drev = prevRev ? r.rev - prevRev : null;
    return { ...r, wcPct: drev ? (r.dWC / drev) * 100 : a.wcPctRev };
  });
  rows.push(`<tr class="ape-row" data-ape-key="wcPctRev">
    <td class="ape-row-lbl">Change in Working Capital <span class="ape-row-suffix">(% Revenue Chg)</span></td>
    ${histRows.map(() => actCell(null, "%")).join("")}
    ${wcRows.map((r, i) => (i < 3 ? editCell("yearwise", "wcPctRev", i, r.wcPct, "%") : lockCell(r.wcPct, "%"))).join("")}
    ${lockCell(null, "%")}
    ${confChip(ev.workingCapital?.confidence, ev.workingCapital?.sourceStatus)}
  </tr>`);

  // 3. TAX
  rows.push(sectionHdr(3, "TAX"));
  // Forecast tax rate per year = taxRate scalar from assumptions; we render uniformly
  const taxFc = fcRows.map((r) => ({ ...r, taxPct: r.ebit ? (r.tax / r.ebit) * 100 : a.taxRate }));
  rows.push(`<tr class="ape-row" data-ape-key="taxRate">
    <td class="ape-row-lbl">Effective Tax Rate <span class="ape-row-suffix">(%)</span></td>
    ${histRows.map((h) => actCell(h.taxRate, "%")).join("")}
    ${taxFc.map((r, i) => (i < 3 ? editCell("yearwise", "taxRate", i, r.taxPct, "%") : lockCell(r.taxPct, "%"))).join("")}
    ${lockCell(null, "%")}
    ${confChip(ev.taxRate?.confidence, ev.taxRate?.sourceStatus)}
  </tr>`);

  // 4. COST OF CAPITAL — WACC derived (read-only)
  rows.push(sectionHdr(4, "COST OF CAPITAL"));
  rows.push(`<tr class="ape-row ape-row-derived" data-ape-key="wacc">
    <td class="ape-row-lbl">WACC <span class="ape-row-suffix">(Derived %)</span></td>
    ${histRows.map(() => actCell(a.wacc, "%")).join("")}
    ${fcRows.map(() => lockCell(a.wacc, "%", "ape-derived")).join("")}
    ${lockCell(a.wacc, "%", "ape-derived")}
    <td class="ape-conf-cell"><span class="ap-conf conf-h" title="High">H</span><span class="ap-src src-vr" title="Calculated">Calc</span></td>
  </tr>`);

  // 5. TERMINAL VALUE — method + Terminal Growth OR Exit Multiple
  rows.push(sectionHdr(5, "TERMINAL VALUE"));
  const termMethod = ui.terminalMethod || "perpetual";
  // Method selector row (spans full width via colspan)
  rows.push(`<tr class="ape-row ape-row-method">
    <td class="ape-row-lbl">Terminal Method</td>
    <td colspan="${histRows.length + fcRows.length + 1}" class="ape-method-cell">
      <select id="apeTermMethod" class="ape-select">
        <option value="perpetual"${termMethod === "perpetual" ? " selected" : ""}>Perpetual Growth</option>
        <option value="exitMultiple"${termMethod === "exitMultiple" ? " selected" : ""}>Exit EV / EBITDA</option>
      </select>
    </td>
    ${confChip("High", "Analyst Estimate")}
  </tr>`);
  // Conditional: Terminal Growth (perpetual) OR Exit Multiple (exit)
  if (termMethod === "exitMultiple") {
    rows.push(`<tr class="ape-row" data-ape-key="exitMult">
      <td class="ape-row-lbl">Exit EV / EBITDA Multiple <span class="ape-row-suffix">(×)</span></td>
      ${histRows.map(() => actCell(null, "×")).join("")}
      ${fcRows.map((_, i) => i < fcRows.length - 1 ? lockCell(null, "×") : `<td class="ape-cell ape-edit"><span class="ape-cell-icon">✎</span><input class="ape-cell-input" id="apeExitMult" type="number" step="0.5" value="${(+ui.exitMultiple).toFixed(1)}"><span class="ape-cell-suffix">×</span></td>`).join("")}
      ${lockCell(ui.exitMultiple, "×")}
      ${confChip("Medium", "Analyst Estimate")}
    </tr>`);
  } else {
    rows.push(`<tr class="ape-row" data-ape-key="terminalG">
      <td class="ape-row-lbl">Terminal Growth <span class="ape-row-suffix">(%)</span></td>
      ${histRows.map(() => actCell(null, "%")).join("")}
      ${fcRows.map(() => lockCell(null, "%")).join("")}
      ${lockCell(a.terminalG, "%")}
      ${confChip(ev.terminalGrowth?.confidence, ev.terminalGrowth?.sourceStatus)}
    </tr>`);
  }

  // 6. CAPITAL STRUCTURE — shares out + editable Net Debt components (Task 5)
  rows.push(sectionHdr(6, "CAPITAL STRUCTURE"));
  // Shares: convert from raw (count) to Cr (÷ 1e7) for INR or Mn (÷ 1e6) otherwise
  const sharesUnit = isINR ? "Cr" : "Mn";
  const sharesScale = isINR ? 1e7 : 1e6;
  const sharesOut = d.sharesOut;
  rows.push(`<tr class="ape-row ape-row-derived" data-ape-key="sharesOut">
    <td class="ape-row-lbl">Shares Outstanding <span class="ape-row-suffix">(${sharesUnit})</span></td>
    ${histRows.map(() => `<td class="ape-cell ape-act-cell">${(sharesOut/sharesScale).toFixed(1)}</td>`).join("")}
    ${fcRows.map(() => `<td class="ape-cell ape-lock">${(sharesOut/sharesScale).toFixed(1)}</td>`).join("")}
    ${lockCell(null, "")}
    <td class="ape-conf-cell"><span class="ap-conf conf-h">H</span><span class="ap-src src-ev">EV</span></td>
  </tr>`);

  // Task 5: editable capital-structure scalars. These flow back to the
  // backend via ui.capitalStructure -> applied as overrides on next
  // recompute. Editing any of ST Debt / LT Debt / Cash auto-updates the
  // Net Debt row; or the user can override Net Debt directly.
  //
  // We don't have ST/LT/Cash component breakdown on the frontend (only the
  // aggregate `d.netDebt`), so the historical columns show "—" and the
  // forecast column 1 is the editable cell. Y2+ columns hold the same
  // value (these are static scalars, not year-wise). On recompute the
  // backend pulls the actual components from the last historical year on
  // its side.
  const csState = ui.capitalStructure || (ui.capitalStructure = {});
  const csVal = (key, dflt) => (csState[key] != null && isFinite(+csState[key])) ? +csState[key] : dflt;
  // Baseline display values when no user override is set: derive from
  // aggregate netDebt where possible (a rough split of 20% ST / 80% LT
  // with cash equal to whatever brings the net to d.netDebt is not
  // meaningful — instead we leave the field blank with a placeholder so
  // the user knows it's optional and the backend will use the actual
  // last-historical-year balance.).
  const baseND = d.netDebt || 0;
  const stDebtUsed = csVal("stDebt", null);
  const ltDebtUsed = csVal("ltDebt", null);
  const cashUsed   = csVal("cash",   null);
  const ndOvr      = csVal("netDebt", null);

  // Render a single-input row for a capital-structure scalar override.
  // Historicals shown as "—" (component-level history isn't available
  // on the frontend); first forecast column is the editable cell; the
  // rest hold whatever value is in the first cell.
  const csRow = (label, key, currentVal, hint) => {
    const isOverride = csState[key] != null && isFinite(+csState[key]);
    const showVal = (currentVal != null && isFinite(currentVal)) ? (currentVal / scale).toFixed(0) : "";
    const cells = [];
    // Historical cells — actual ST/LT/Cash split not exposed on frontend
    histRows.forEach(() => cells.push(`<td class="ape-cell ape-act-cell">—</td>`));
    // First forecast column — editable
    cells.push(`<td class="ape-cell ape-edit${isOverride ? " is-override" : ""}">
      <span class="ape-cell-icon">✎</span>
      <input class="ape-cell-input" data-ape-cs="${key}" type="number" step="1"
             value="${showVal}" placeholder="auto"
             aria-label="${key} override">
    </td>`);
    // Remaining forecast columns — hold value of cell 1
    const lockDisplay = isOverride ? showVal : "auto";
    for (let i = 1; i < fcRows.length; i++) {
      cells.push(`<td class="ape-cell ape-lock muted">${lockDisplay}</td>`);
    }
    cells.push(lockCell(null, ""));
    cells.push(`<td class="ape-conf-cell"><span class="ap-conf conf-m">M</span><span class="ap-src src-ae">AE</span></td>`);
    return `<tr class="ape-row${isOverride ? " ape-row-derived" : ""}" data-ape-key="cs-${key}" title="${hint || ''}">
      <td class="ape-row-lbl">${label} <span class="ape-row-suffix">(${unit})</span></td>
      ${cells.join("")}
    </tr>`;
  };
  rows.push(csRow("Short-Term Debt",  "stDebt", stDebtUsed, "Editable — overrides last historical year. Excludes capital-lease obligations."));
  rows.push(csRow("Long-Term Debt",   "ltDebt", ltDebtUsed, "Editable — overrides last historical year. Excludes capital-lease obligations."));
  rows.push(csRow("Cash & Cash Equiv.","cash",   cashUsed,   "Editable — overrides last historical year."));

  // Net Debt — directly editable override; falls back to aggregate from idcf
  const ndIsOverride = ndOvr != null && isFinite(ndOvr);
  const ndDisplay = ndIsOverride ? (ndOvr / scale).toFixed(0) : (baseND / scale).toFixed(0);
  const ndCells = [];
  histRows.forEach(() => ndCells.push(`<td class="ape-cell ape-act-cell">${(baseND / scale).toFixed(0)}</td>`));
  ndCells.push(`<td class="ape-cell ape-edit${ndIsOverride ? " is-override" : ""}">
    <span class="ape-cell-icon">✎</span>
    <input class="ape-cell-input" data-ape-cs="netDebt" type="number" step="1"
           value="${ndIsOverride ? (ndOvr / scale).toFixed(0) : ''}"
           placeholder="${(baseND / scale).toFixed(0)}" aria-label="netDebt override">
  </td>`);
  for (let i = 1; i < fcRows.length; i++) {
    ndCells.push(`<td class="ape-cell ape-lock">${ndDisplay}</td>`);
  }
  ndCells.push(lockCell(null, ""));
  ndCells.push(`<td class="ape-conf-cell"><span class="ap-conf conf-h">H</span><span class="ap-src src-ev">EV</span></td>`);
  rows.push(`<tr class="ape-row${ndIsOverride ? " ape-row-derived" : ""}" data-ape-key="cs-netDebt"
       title="Editable. Overrides Net Debt directly. Leave empty to use components or last historical year.">
    <td class="ape-row-lbl">Net Debt <span class="ape-row-suffix">(${unit})</span></td>
    ${ndCells.join("")}
  </tr>`);

  // 7. CAPITAL ALLOCATION — all four lines, Y1-Y3 editable, Y4+ hold Y3
  rows.push(sectionHdr(7, "CAPITAL ALLOCATION"));
  const capAllocRow = (label, key, defaultPct, conf, src) => {
    const arr = ui.capitalAllocation[key];
    const yearVal = (i) => {
      if (i < 3 && arr[i] != null && isFinite(+arr[i])) return +arr[i];
      if (arr[2] != null && isFinite(+arr[2])) return +arr[2];
      return defaultPct;
    };
    const cells = [];
    histRows.forEach(() => cells.push(actCell(null, "%")));
    fcRows.forEach((_, i) => {
      const v = yearVal(i);
      if (i < 3) cells.push(editCell("capitalAllocation", key, i, v, "%"));
      else cells.push(lockCell(v, "%"));
    });
    cells.push(lockCell(null, "%"));
    cells.push(confChip(conf, src));
    return `<tr class="ape-row" data-ape-key="${key}">
      <td class="ape-row-lbl">${label} <span class="ape-row-suffix">(%)</span></td>
      ${cells.join("")}
    </tr>`;
  };
  rows.push(capAllocRow("Dividend Payout",         "dividendPayout",  null, "Medium", "Analyst Estimate"));
  rows.push(capAllocRow("Share Buyback",           "shareBuyback",    null, "Medium", "Analyst Estimate"));
  rows.push(capAllocRow("Debt Repayment",          "debtRepayment",   null, "Medium", "Analyst Estimate"));
  rows.push(capAllocRow("Strategic Acquisition Spend", "strategicAcq", null, "Low",    "Analyst Estimate"));

  // ── Footer notes ──────────────────────────────────────────────────────────
  const footerHtml = `<div class="ape-footer">
    <span class="ape-foot-icon">ⓘ</span>
    Editable up to next 3 years (FY${String(fcRows[0]?.year || "").slice(2)}–FY${String(fcRows[2]?.year || "").slice(2)}). Years beyond Y3 are auto-derived based on fade/expansion logic.
  </div>`;

  return `<div class="ape-block" id="apeRoot">
    ${headerHtml}
    ${legendHtml}
    <div class="ape-table-wrap">
      <table class="ape-table">
        ${colHdr}
        <tbody>${rows.join("")}</tbody>
      </table>
    </div>
    ${footerHtml}
  </div>`;
}

function renderInstitutionalDCF(data, uiState) {
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
  //   Collapsed (default): legacy compact key-value list (Y1 assumptions only).
  //   Expanded:           year-wise assumption mini-table + Integrated Forecast Financial Model
  //                       (Income / Balance / Cash-flow tabs).
  const a = d.assumptions;
  const s2Inner = (uiState && uiState.expandedMode)
    ? renderS2Expanded(data, uiState, { U, N, P, fy, unit, sym, scale, isINR })
    : `<div class="idcf-kv">
      <div><span class="k">Revenue growth Y1</span><span class="v">${P(a.growthY1_5)}</span></div>
      <div><span class="k">Annual fade</span><span class="v">${P(a.fade)}</span></div>
      <div><span class="k">EBITDA margin</span><span class="v">${P(a.ebitdaMargin)}</span></div>
      <div><span class="k">Capex % rev</span><span class="v">${P(a.capexPctRev)}</span></div>
      <div><span class="k">D&amp;A % rev</span><span class="v">${P(a.depPctRev)}</span></div>
      <div><span class="k">Tax rate</span><span class="v">${P(a.taxRate)}</span></div>
      <div><span class="k">ΔWC % rev change</span><span class="v">${P(a.wcPctRev)}</span></div>
      <div><span class="k">Terminal growth</span><span class="v">${P(a.terminalG)}</span></div>
    </div>`;
  const s2Sub = (uiState && uiState.expandedMode)
    ? `year-wise · ${b.rows.length}y horizon`
    : "editable in the sidebar";
  const s2 = sec(2, "Forecast Assumptions", s2Sub, s2Inner);

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

  // S18 — Reverse DCF (market-implied expectations)
  const s18 = (() => {
    const r = data.reverse;
    if (!r || r.error) return "";
    const gSide = !r.impliedGrowthBounded ? (r.impliedGrowthSide === "below" ? "&lt; −15%" : "&gt; 60%") : null;
    const wSide = !r.impliedWaccBounded ? (r.impliedWaccSide === "below" ? "very low" : "&gt; 30%") : null;
    const gImp = gSide || P(r.impliedGrowth);
    const wImp = wSide || P(r.impliedWacc);
    const gGap = r.impliedGrowthBounded && r.assumedGrowth != null ? r.impliedGrowth - r.assumedGrowth : null;
    const verdict = gGap == null ? "" :
      gGap > 1.5 ? `The market is paying for <b>${P(gGap)} MORE</b> annual growth than this model assumes — the current price already embeds expectations above your base case. Owning the stock here means underwriting that gap.` :
      gGap < -1.5 ? `The market is pricing <b>${P(Math.abs(gGap))} LESS</b> growth than this model assumes — if your assumptions are right, expectations are beatable and the mispricing is the opportunity.` :
      `Market-implied growth sits within ±1.5pp of the model's assumption — the stock is priced roughly in line with this base case; the debate is about assumption quality, not expectations gap.`;
    return sec(18, "Reverse DCF — What the Price Implies", "expectations investing · solved by bisection on this exact model",
      `<div class="rvd-grid">
        <div class="rvd-card"><div class="l">MARKET-IMPLIED GROWTH (Y1–5)</div><div class="n">${gImp}</div><div class="s">vs your assumption ${P(r.assumedGrowth)}</div></div>
        <div class="rvd-card"><div class="l">MARKET-IMPLIED WACC</div><div class="n">${wImp}</div><div class="s">vs model WACC ${P(r.assumedWacc)}</div></div>
        <div class="rvd-card"><div class="l">MODEL VALUE / PRICE</div><div class="n">${px(r.basePerShare)} / ${px(r.currentPrice)}</div><div class="s">holding all other assumptions fixed</div></div>
      </div>
      <div class="idcf-prose"><p>Instead of asking "what is it worth?", the reverse DCF asks "<em>what must be true</em> for today's price to be fair?" — every other assumption (margins, capex, tax, WACC, terminal growth) is held at your current values while the solver finds the growth rate that makes intrinsic value equal the market price. ${verdict}</p></div>`);
  })();

  // S19 — Tornado sensitivity (one-way driver impact)
  const s19 = (() => {
    const t = data.tornado;
    if (!t || t.error || !t.bars || !t.bars.length) return "";
    const lo = Math.min(...t.bars.map((x) => x.lowPx ?? t.basePerShare), t.basePerShare);
    const hi = Math.max(...t.bars.map((x) => x.highPx ?? t.basePerShare), t.basePerShare);
    const span = (hi - lo) || 1;
    const X = (v) => ((v - lo) / span) * 100;
    const rows = t.bars.map((x) => {
      const l = x.lowPx ?? t.basePerShare, h = x.highPx ?? t.basePerShare;
      return `<div class="tor-row">
        <span class="tor-l">${x.label} <small>±${x.step}pp</small></span>
        <div class="tor-track">
          <span class="tor-base" style="left:${X(t.basePerShare)}%"></span>
          <span class="tor-bar" style="left:${X(l)}%;width:${Math.max(X(h) - X(l), 0.5)}%"></span>
          <span class="tor-lo mono" style="left:${X(l)}%">${px(l, 0)}</span>
          <span class="tor-hi mono" style="left:${X(h)}%">${px(h, 0)}</span>
        </div>
        <span class="tor-sw ${x.swingPct != null && Math.abs(x.swingPct) > 25 ? "down" : ""}">${x.swingPct == null ? "—" : "±" + N(Math.abs(x.swingPct) / 2, 1) + "%"}</span>
      </div>`;
    }).join("");
    const top = t.bars[0];
    return sec(19, "Tornado — Where the Model Lives and Dies", "one-way sensitivity · all other assumptions held at current values",
      `<div class="tor">${rows}<div class="tor-axis mono"><span>${px(lo, 0)}</span><span>base ${px(t.basePerShare, 0)}</span><span>${px(hi, 0)}</span></div></div>
      <div class="idcf-prose"><p>Each bar flexes one driver by an institutional-standard step while everything else holds. <b>${top.label}</b> dominates the valuation (${px(top.lowPx)}–${px(top.highPx)} per share across ±${top.step}pp) — that is the assumption to underwrite hardest, and where new information should move your target most. Drivers at the bottom are second-order; do not spend diligence time there.</p></div>`);
  })();

  return `<div class="idcf">${s1}${s2}${s3}${s4}${s5}${s6}${s7}${s8}${s9}${s10}${s11}${s12}${s13}${s14}${s15}${s16}${s17}${s18}${s19}</div>`;
}

/* ════════════════════════════════════════════════════════════════════════════
   SECTION 2 EXPANDED — year-wise forecast assumption recap + integrated
   forecast financial model (Income / Balance / Cash-flow tabs).

   Rendered inside renderInstitutionalDCF when uiState.expandedMode is true.
   Layout (matches Image 1 reference):
     1. Forecast Assumptions (Future Years) — read-only year-wise mini-table.
        Same data as the top-of-page EXPANDED ASSUMPTIONS panel, surfaced here
        in the context of Section 2 of the institutional DCF model.
     2. Integrated Forecast Financial Model — three-tab panel with projected
        income statement, balance sheet and cash-flow statement.
   ════════════════════════════════════════════════════════════════════════════ */
function renderS2Expanded(data, ui, fmt) {
  const { U, N, P, fy, unit, sym, scale, isINR } = fmt;
  const d = data.idcf;
  const a = d.assumptions;
  const fcRows = d.base.rows;
  const horizon = d.forecastHorizon || ui.forecastHorizon || 5;
  const termMethod = d.terminalMethod || ui.terminalMethod || "perpetual";

  // ── 1. Year-wise Forecast Assumptions recap ───────────────────────────
  // Read-only display. Editing is done up top in the EXPANDED ASSUMPTIONS panel.
  // Y1-Y3 amber (matches sidebar override colour), Y4+ muted, Terminal muted.
  const yrHdr = `<tr><th>Assumption</th>${fcRows.map((r, i) => {
    const tag = i < 3 ? ` <span class="ifa-yr-tag">(Y${i + 1})</span>` : "";
    const cls = i < 3 ? "ifa-fc-y3" : "ifa-fc";
    return `<th class="${cls}">${fy(r.year)}${tag}</th>`;
  }).join("")}<th class="ifa-term">Terminal</th></tr>`;

  // Row helper: pulls per-year value from fcRows + per-year override or scalar fallback
  const ifaRow = (label, fcField, scalarVal, suffix = "%", termVal = null) => {
    const cells = fcRows.map((r, i) => {
      const v = r[fcField];
      const cls = i < 3 ? "ifa-fc-y3" : "ifa-fc-muted";
      return `<td class="${cls}">${v != null && isFinite(v) ? (+v).toFixed(1) + suffix : "—"}</td>`;
    }).join("");
    const tCell = termVal != null && isFinite(termVal)
      ? `<td class="ifa-term-cell">${(+termVal).toFixed(1)}${suffix}</td>`
      : `<td class="ifa-term-cell ifa-muted">—</td>`;
    return `<tr><td class="ifa-lbl">${label}</td>${cells}${tCell}</tr>`;
  };
  // ΔWC per year as % of revenue change (positive = investment)
  const wcPctRow = fcRows.map((r, i, arr) => {
    const prev = i === 0 ? null : arr[i - 1].rev;
    const drev = prev ? r.rev - prev : null;
    return drev ? (r.dWC / drev) * 100 : a.wcPctRev;
  });
  const ifaRowsHtml = [
    ifaRow("Revenue Growth (%)",       "growth", a.growthY1_5, "%", a.terminalG),
    ifaRow("EBITDA Margin (%)",        "margin", a.ebitdaMargin, "%", null),
    `<tr><td class="ifa-lbl">Capex (% Revenue)</td>${fcRows.map((r, i) => {
      const v = r.rev ? (r.capex / r.rev) * 100 : null;
      const cls = i < 3 ? "ifa-fc-y3" : "ifa-fc-muted";
      return `<td class="${cls}">${v != null && isFinite(v) ? v.toFixed(1) + "%" : "—"}</td>`;
    }).join("")}<td class="ifa-term-cell ifa-muted">${a.capexPctRev != null ? a.capexPctRev.toFixed(1) + "%" : "—"}</td></tr>`,
    `<tr><td class="ifa-lbl">D&amp;A (% Revenue)</td>${fcRows.map((r, i) => {
      const v = r.rev ? (r.dep / r.rev) * 100 : null;
      const cls = i < 3 ? "ifa-fc-y3" : "ifa-fc-muted";
      return `<td class="${cls}">${v != null && isFinite(v) ? v.toFixed(1) + "%" : "—"}</td>`;
    }).join("")}<td class="ifa-term-cell ifa-muted">${a.depPctRev != null ? a.depPctRev.toFixed(1) + "%" : "—"}</td></tr>`,
    `<tr><td class="ifa-lbl">Tax Rate (%)</td>${fcRows.map((r, i) => {
      const v = r.ebit ? (r.tax / r.ebit) * 100 : null;
      const cls = i < 3 ? "ifa-fc-y3" : "ifa-fc-muted";
      return `<td class="${cls}">${v != null && isFinite(v) ? v.toFixed(1) + "%" : "—"}</td>`;
    }).join("")}<td class="ifa-term-cell ifa-muted">${a.taxRate != null ? a.taxRate.toFixed(1) + "%" : "—"}</td></tr>`,
    `<tr><td class="ifa-lbl">Working Capital (% Rev Change)</td>${wcPctRow.map((v, i) => {
      const cls = i < 3 ? "ifa-fc-y3" : "ifa-fc-muted";
      return `<td class="${cls}">${v != null && isFinite(v) ? v.toFixed(1) + "%" : "—"}</td>`;
    }).join("")}<td class="ifa-term-cell ifa-muted">—</td></tr>`,
    `<tr><td class="ifa-lbl">WACC (Derived %)</td>${fcRows.map((r, i) => {
      const cls = i < 3 ? "ifa-fc-y3" : "ifa-fc-muted";
      return `<td class="${cls}">${a.wacc.toFixed(1)}%</td>`;
    }).join("")}<td class="ifa-term-cell ifa-muted">—</td></tr>`,
    termMethod === "exitMultiple"
      ? `<tr><td class="ifa-lbl">Exit EV / EBITDA (×)</td>${fcRows.map((_, i) => {
          const cls = i < 3 ? "ifa-fc-muted" : "ifa-fc-muted";
          return `<td class="${cls}">—</td>`;
        }).join("")}<td class="ifa-term-cell">${(+ui.exitMultiple).toFixed(1)}×</td></tr>`
      : `<tr><td class="ifa-lbl">Terminal Growth (%)</td>${fcRows.map(() => `<td class="ifa-fc-muted">—</td>`).join("")}<td class="ifa-term-cell">${a.terminalG.toFixed(1)}%</td></tr>`,
  ].join("");

  const yrAssumpTable = `<div class="ifa-block">
    <div class="ifa-block-hdr">
      <span class="ifa-block-ttl">Forecast Assumptions (Future Years)</span>
      <span class="ifa-foot-icon" title="Year-wise view of the forecast assumptions. Edit values up top in EXPANDED ASSUMPTIONS to recompute.">ⓘ</span>
    </div>
    <table class="ifa-table">${yrHdr}${ifaRowsHtml}</table>
  </div>`;

  // ── 2. Integrated Forecast Financial Model ────────────────────────────
  const stmts = computeIntegratedStatements(data, ui);
  const activeTab = ui.activeFinTab || "income";

  // Tab strip
  const tabs = [
    { id: "income",   label: "Income Statement" },
    { id: "balance",  label: "Balance Sheet" },
    { id: "cashflow", label: "Cash Flow Statement" },
  ];
  const tabsHtml = tabs.map((t) => `<button class="iffm-tab${t.id === activeTab ? " is-active" : ""}" data-iffm-tab="${t.id}">${t.label}</button>`).join("");

  // Wraps a <table> in the shared horizontal-scroll container used by ALL
  // THREE statements (Income / Balance / Cash Flow) so behaviour is identical
  // across tabs — see applyStickyColumns() below for why this is the single
  // fix point instead of three separate ones.
  // `actualsLen` = number of historical (non-forecast) year columns, used to
  // decide how many leading columns (label + historical years) get frozen
  // when the user scrolls; always leaves at least one column free to scroll.
  const wrapStatementTable = (tableHtml, actualsLen, totalDataCols) => {
    const sticky = Math.max(1, Math.min(1 + actualsLen, Math.max(1, totalDataCols)));
    return `<div class="iffm-table-scroll" data-iffm-sticky-cols="${sticky}">${tableHtml}</div>`;
  };

  // Income Statement — actuals + forecast (per updated spec)
  const isActs = stmts.incomeActuals || [];
  const isFcs  = stmts.income;
  const allIs  = [...isActs.map(r => ({ ...r, isFc: false })), ...isFcs.map(r => ({ ...r, isFc: true }))];
  const isCols = allIs.map((r) => {
    if (r.isFc) {
      const i = isFcs.indexOf(isFcs.find(x => x.year === r.year));
      const tag = i < 3 ? ` <span class="ifa-yr-tag">(Y${i + 1})</span>` : "";
      return `<th class="iffm-fc-hdr">${fy(r.year)}${tag}</th>`;
    }
    return `<th>${fy(r.year)}</th>`;
  }).join("");
  const isRow = (label, key, kind = "money", strong = false) => {
    const cls = strong ? "iffm-row-strong" : "";
    const sub = kind === "pct" ? "iffm-row-sub" : "";
    return `<tr class="${cls} ${sub}"><td class="iffm-lbl">${label}</td>${allIs.map((r) => {
      const v = r[key];
      const tdCls = r.isFc ? "iffm-fc-cell" : "";
      if (v == null || !isFinite(v)) return `<td class="${tdCls} iffm-muted">—</td>`;
      if (kind === "pct")   return `<td class="${tdCls}">${v.toFixed(1)}%</td>`;
      if (kind === "eps")   return `<td class="${tdCls}">${v.toFixed(2)}</td>`;
      return `<td class="${tdCls}">${U(v)}</td>`;
    }).join("")}</tr>`;
  };
  const incomeTable = `<table class="iffm-table">
    <thead><tr><th class="iffm-unit">(${unit})</th>${isCols}</tr></thead>
    <tbody>
      ${isRow("Revenue", "rev", "money", true)}
      ${isRow("Revenue Growth (%)", "growth", "pct")}
      ${isRow("Cost of Revenue (COGS)", "cogs")}
      ${isRow("Gross Profit", "gross", "money", true)}
      ${isRow("Gross Margin (%)", "grossMargin", "pct")}
      ${isRow("Operating Expenses", "opExp")}
      ${isRow("&nbsp;&nbsp;Selling &amp; Administrative", "sga")}
      ${isRow("&nbsp;&nbsp;Other Operating Expenses", "otherOpExp")}
      ${isRow("EBITDA", "ebitda", "money", true)}
      ${isRow("EBITDA Margin (%)", "ebitdaMargin", "pct")}
      ${isRow("Depreciation &amp; Amortization", "dep")}
      ${isRow("EBIT", "ebit", "money", true)}
      ${isRow("EBIT Margin (%)", "ebitMargin", "pct")}
      ${isRow("Interest Income", "intIncome")}
      ${isRow("Interest Expense", "intExpense")}
      ${isRow("Profit Before Tax", "pbt", "money", true)}
      ${isRow("Tax Expense", "tax")}
      ${isRow("Share of Profit from Associates", "associateShare")}
      ${isRow("Profit After Tax (PAT)", "pat", "money", true)}
      ${isRow("&nbsp;&nbsp;Minority Interest", "minorityIntIncome")}
      ${isRow("&nbsp;&nbsp;Attributable to Parent", "patAttributableToParent")}
      ${isRow("PAT Margin (%)", "patMargin", "pct")}
      ${stmts.epsAvailable ? isRow(`Basic EPS (${sym || ""})`, "eps", "eps") : ""}
      ${stmts.epsAvailable ? isRow(`Diluted EPS (${sym || ""})`, "epsDiluted", "eps") : ""}
    </tbody>
  </table>`;
  const incomeHtml = wrapStatementTable(incomeTable, isActs.length, allIs.length);

  // ── Balance Sheet — Yahoo-native hierarchy with expand/collapse ─────────
  // The schema below mirrors yahoo-finance2.fundamentalsTimeSeries native
  // structure (see reference screenshot). Each row is either:
  //   { id, label, key, level }                   — leaf row
  //   { id, label, key, level, hasChildren: true } — parent with chevron
  // Children are rendered as siblings with data-bs-parent="<parent-id>"; CSS
  // hides them unless the parent is expanded. State lives in uiState.bsExpanded
  // (a Set of expanded parent IDs) and persists for the duration of the
  // company session; clears on company switch via resetUiState().
  const bsActs = stmts.balanceActuals, bsFcs = stmts.balance;
  const allBs = [...bsActs.map(r => ({ ...r, isFc: false })), ...bsFcs.map(r => ({ ...r, isFc: true }))];
  const bsCols = allBs.map((r) => {
    if (r.isFc) {
      const i = bsFcs.indexOf(bsFcs.find(x => x.year === r.year));
      const tag = i < 3 ? ` <span class="ifa-yr-tag">(Y${i + 1})</span>` : "";
      return `<th class="iffm-fc-hdr">${fy(r.year)}${tag}</th>`;
    }
    return `<th>${fy(r.year)}</th>`;
  }).join("");

  // Default set of parent rows that start expanded (top-level totals).
  // User clicks add/remove from uiState.bsExpanded. We initialise the Set
  // lazily on first render so it survives across recomputes.
  if (!(ui.bsExpanded instanceof Set)) {
    ui.bsExpanded = new Set(["totalAssets", "currentAssets", "nonCurrentAssets",
      "totalLiab", "currentLiab", "nonCurrentLiab",
      "totalEquityGross"]);
  }
  const isExpanded = (id) => ui.bsExpanded.has(id);

  /** Render a single BS row.
   *  level: indent depth (0 = top, 1 = under section, etc.)
   *  id: unique identifier (used for expand state + as parent ref by children)
   *  parentId: which row controls this row's visibility (null = always visible)
   *  hasChildren: parent rows get a chevron icon
   *  isStrong: bold/highlight (used for totals)
   *  kind: "money" | "decimal" | "shares" | "recon"
   */
  const bsTreeRow = ({ id, parentId, label, key, level = 0, hasChildren = false, isStrong = false, kind = "money" }) => {
    const indent = level * 14;
    const chev = hasChildren
      ? `<span class="bs-chev${isExpanded(id) ? " is-open" : ""}" data-bs-chev="${id}">▸</span>`
      : `<span class="bs-chev-spacer"></span>`;
    // CSS class .bs-hidden is applied when parent is collapsed.
    const hidden = parentId && !isExpanded(parentId) ? " bs-hidden" : "";
    const rowCls = `${isStrong ? "iffm-row-strong" : ""} bs-row level-${level}${hidden}`;
    const dataParent = parentId ? ` data-bs-parent="${parentId}"` : "";
    return `<tr class="${rowCls}" data-bs-id="${id}"${dataParent}>
      <td class="iffm-lbl" style="padding-left:${10 + indent}px">${chev}${label}</td>
      ${allBs.map((r) => {
        const v = r[key];
        const tdCls = r.isFc ? "iffm-fc-cell" : "";
        if (v == null || !isFinite(v)) return `<td class="${tdCls} iffm-muted">—</td>`;
        if (kind === "decimal") return `<td class="${tdCls}">${v.toFixed(1)}</td>`;
        if (kind === "shares")  return `<td class="${tdCls}">${(v / 1e7).toFixed(2)}Cr</td>`;
        return `<td class="${tdCls}">${U(v)}</td>`;
      }).join("")}
    </tr>`;
  };

  // ── BS hierarchy schema (revised user spec) ─────────────────────────────
  // Children always sum to the displayed parent subtotal because the "Other"
  // rows are computed as PLUGS in computeIntegratedStatements:
  //
  //   Current Assets        = Cash + STI + Recv + Inv + Other CA            ✓
  //   Non-Current Assets    = PPE + Goodwill&Intan + LT Inv + Other NCA     ✓
  //   Total Assets          = Current Assets + Non-Current Assets            ✓
  //   Current Liabilities   = Short-Term Debt + Accounts Payable + Other CL ✓
  //   Non-Current Liab.     = Long-Term Debt + Lease + DTL + Other NCL      ✓
  //   Total Liabilities     = Current Liab + Non-Current Liab                ✓
  //   Total Equity          = Share Cap + R&S + MI + Other Equity            ✓
  //   Total Liab + Total Eq = Total Assets                                   ✓
  //
  // Task 6: Total Debt = ST + LT Debt only (excludes leases).
  // Task 8: NO reconciliation diff row — model reconciles by construction.
  const bsSchema = [
    // ── ASSETS ───────────────────────────────────────────────────────────
    { id: "totalAssets", label: "TOTAL ASSETS", key: "totalAssets", level: 0, hasChildren: true, isStrong: true },
      { id: "currentAssets", parentId: "totalAssets", label: "Current Assets", key: "totalCA", level: 1, hasChildren: true, isStrong: true },
        { id: "cashOnly",       parentId: "currentAssets", label: "Cash &amp; Cash Equivalents",   key: "cashOnly",             level: 2 },
        { id: "shortTermInv",   parentId: "currentAssets", label: "Short-Term Investments",         key: "shortTermInvestments", level: 2 },
        { id: "receivablesRow", parentId: "currentAssets", label: "Accounts Receivable",            key: "receivables",          level: 2 },
        { id: "inventoryRow",   parentId: "currentAssets", label: "Inventory",                      key: "inventory",            level: 2 },
        { id: "otherCA",        parentId: "currentAssets", label: "Other Current Assets",           key: "otherCA",              level: 2 },
      { id: "nonCurrentAssets", parentId: "totalAssets", label: "Non-Current Assets", key: "totalNonCurrentAssets", level: 1, hasChildren: true, isStrong: true },
        { id: "netPPE",         parentId: "nonCurrentAssets", label: "Property, Plant &amp; Equipment", key: "netPPE",                          level: 2 },
        { id: "goodwillIntan",  parentId: "nonCurrentAssets", label: "Goodwill &amp; Intangible Assets", key: "goodwillAndOtherIntangibleAssets",level: 2 },
        { id: "investmentsRow", parentId: "nonCurrentAssets", label: "Long-Term Investments",            key: "investments",                    level: 2 },
        { id: "otherNCA",       parentId: "nonCurrentAssets", label: "Other Non-Current Assets",         key: "otherNCA",                       level: 2 },
    // ── LIABILITIES ──────────────────────────────────────────────────────
    { id: "totalLiab", label: "TOTAL LIABILITIES", key: "totalLiab", level: 0, hasChildren: true, isStrong: true },
      { id: "currentLiab", parentId: "totalLiab", label: "Current Liabilities", key: "currentLiab", level: 1, hasChildren: true, isStrong: true },
        { id: "curDebt",  parentId: "currentLiab", label: "Short-Term Debt",            key: "stDebt",    level: 2 },
        { id: "tradePay", parentId: "currentLiab", label: "Accounts Payable",           key: "payables",  level: 2 },
        { id: "otherCL",  parentId: "currentLiab", label: "Other Current Liabilities",  key: "otherCL",   level: 2 },
      { id: "nonCurrentLiab", parentId: "totalLiab", label: "Non-Current Liabilities", key: "nonCurrentLiab", level: 1, hasChildren: true, isStrong: true },
        { id: "ltDebtRow", parentId: "nonCurrentLiab", label: "Long-Term Debt",               key: "ltDebt",         level: 2 },
        { id: "leaseRow",  parentId: "nonCurrentLiab", label: "Lease Liabilities",            key: "longTermLease",  level: 2 },
        { id: "dtlRow",    parentId: "nonCurrentLiab", label: "Deferred Tax Liabilities",     key: "deferredTaxLiab", level: 2 },
        { id: "otherNCL",  parentId: "nonCurrentLiab", label: "Other Non-Current Liabilities", key: "otherNCL",       level: 2 },
    // ── EQUITY (4-row flat) ──────────────────────────────────────────────
    { id: "totalEquityGross", label: "TOTAL EQUITY", key: "totalEquityGrossMI", level: 0, hasChildren: true, isStrong: true },
      { id: "shareCap",    parentId: "totalEquityGross", label: "Share Capital",       key: "shareCapital",     level: 1 },
      { id: "reservesRow", parentId: "totalEquityGross", label: "Reserves &amp; Surplus", key: "reservesSurplus",  level: 1 },
      { id: "minorityInt", parentId: "totalEquityGross", label: "Minority Interest",   key: "minorityInterest", level: 1 },
      { id: "otherEqInt",  parentId: "totalEquityGross", label: "Other Equity",        key: "otherEquity",      level: 1 },
    // ── DERIVED METRICS (Task 6) ─────────────────────────────────────────
    { id: "totalDebtRow", label: "Total Debt  (ST + LT only · excludes leases)", key: "totalDebt", level: 0, isStrong: true },
    { id: "netDebtRow",   label: "Net Debt  (Total Debt − Cash)",                  key: "netDebt",   level: 0, isStrong: true },
    // ── BS RECONCILIATION (Total Liab + Total Equity = Total Assets) ─────
    { id: "totalLiabEq", label: "TOTAL LIABILITIES &amp; EQUITY", key: "totalLiabAndEquity", level: 0, isStrong: true },
  ];

  const balanceTable = `<table class="iffm-table iffm-bs-tree">
    <thead><tr><th class="iffm-unit">(${unit})</th>${bsCols}</tr></thead>
    <tbody>
      ${bsSchema.map((row) => bsTreeRow(row)).join("")}
    </tbody>
  </table>`;
  const balanceHtml = wrapStatementTable(balanceTable, bsActs.length, allBs.length);

  // Cash Flow — actuals + forecast (matches reference image 3 + spec additions)
  const cfActs = stmts.cashflowActuals, cfFcs = stmts.cashflow;
  const allCf = [...cfActs.map(r => ({ ...r, isFc: false })), ...cfFcs.map(r => ({ ...r, isFc: true }))];
  const cfCols = allCf.map((r) => {
    if (r.isFc) {
      const i = cfFcs.indexOf(cfFcs.find(x => x.year === r.year));
      const tag = i < 3 ? ` <span class="ifa-yr-tag">(Y${i + 1})</span>` : "";
      return `<th class="iffm-fc-hdr">${fy(r.year)}${tag}</th>`;
    }
    return `<th>${fy(r.year)}</th>`;
  }).join("");
  const cfRow = (label, key, isStrong = false, isOutflow = false) => {
    const cls = isStrong ? "iffm-row-strong" : "";
    return `<tr class="${cls}"><td class="iffm-lbl">${label}</td>${allCf.map((r) => {
      const v = r[key];
      const tdCls = r.isFc ? "iffm-fc-cell" : "";
      if (v == null || !isFinite(v)) return `<td class="${tdCls} iffm-muted">—</td>`;
      const dispV = isOutflow && v > 0 ? -v : v;
      const formatted = isOutflow && v > 0 ? `(${U(Math.abs(dispV))})` : U(dispV);
      return `<td class="${tdCls}">${formatted}</td>`;
    }).join("")}</tr>`;
  };
  const cashflowTable = `<table class="iffm-table">
    <thead><tr><th class="iffm-unit">(${unit})</th>${cfCols}</tr></thead>
    <tbody>
      ${cfRow("Cash from Operating Activity", "ocf", true)}
      ${cfRow("&nbsp;&nbsp;EBITDA", "ebitda")}
      ${cfRow("&nbsp;&nbsp;Working Capital Movement", "wcMove")}
      ${cfRow("&nbsp;&nbsp;Less: Cash Tax", "cashTax", false, true)}
      ${cfRow("Cash from Investing Activity", "investCF", true)}
      ${cfRow("&nbsp;&nbsp;Capital Expenditure", "capex", false, true)}
      ${cfRow("&nbsp;&nbsp;Fixed Assets Sold", "fixedAssetsSold")}
      ${cfRow("&nbsp;&nbsp;Investments Purchased", "investmentsPurchased", false, true)}
      ${cfRow("&nbsp;&nbsp;Investments Sold", "investmentsSold")}
      ${cfRow("&nbsp;&nbsp;Interest Received", "interestReceived")}
      ${cfRow("&nbsp;&nbsp;Dividends Received", "dividendsReceived")}
      ${cfRow("Cash from Financing Activity", "financeCF", true)}
      ${cfRow("&nbsp;&nbsp;Proceeds from Shares", "proceedsFromShares")}
      ${cfRow("&nbsp;&nbsp;Debt Issued", "debtIssued")}
      ${cfRow("&nbsp;&nbsp;Debt Repaid", "debtRepaid", false, true)}
      ${cfRow("&nbsp;&nbsp;Interest Paid", "interestPaid", false, true)}
      ${cfRow("&nbsp;&nbsp;Dividends Paid", "dividends", false, true)}
      ${cfRow("&nbsp;&nbsp;Share Buybacks", "buybacks", false, true)}
      ${cfRow("Net Change in Cash", "netChange", true)}
      ${cfRow("Opening Cash Balance", "openingCash")}
      ${cfRow("Closing Cash Balance", "closingCash", true)}
      ${cfRow("Free Cash Flow", "fcff", true)}
    </tbody>
  </table>`;
  const cashflowHtml = `${wrapStatementTable(cashflowTable, cfActs.length, allCf.length)}
  <div class="iffm-foot"></div>`;

  const iffmHtml = `<div class="iffm-block">
    <div class="ifa-block-hdr">
      <span class="ifa-block-ttl">Integrated Forecast Financial Model</span>
      <span class="ifa-foot-icon" title="Projected statements derived from the existing forecast engine. Updates dynamically when assumptions change.">ⓘ</span>
    </div>
    <div class="iffm-tabs">${tabsHtml}</div>
    <div class="iffm-pane${activeTab === "income"   ? " is-active" : ""}" data-iffm-pane="income">${incomeHtml}</div>
    <div class="iffm-pane${activeTab === "balance"  ? " is-active" : ""}" data-iffm-pane="balance">${balanceHtml}</div>
    <div class="iffm-pane${activeTab === "cashflow" ? " is-active" : ""}" data-iffm-pane="cashflow">${cashflowHtml}</div>
  </div>`;

  return `<div class="s2-expanded" id="s2ExpandedRoot">${yrAssumpTable}${iffmHtml}</div>`;
}

/* ── Frozen / sticky columns for the Integrated Forecast Financial Model ─────
   Why this exists: the overflow-x:auto on .iffm-table-scroll (terminal.css)
   is what stops the table from spilling outside the card — that alone is the
   fix for the reported bug. Everything below is the Bloomberg/FactSet-style
   "freeze panes" enhancement layered on top of it.

   Column widths in all three statement tables are content-driven (the label
   column especially — Yahoo-native BS line items vary a lot in length), so
   there's no reliable fixed-px value to hand the sticky `left` offset ahead
   of time. Instead we measure the ACTUAL rendered width of each column from
   the header row (every cell in a column shares that width) once the table
   is laid out, then stamp `left` on every cell in that column. This re-runs
   on every event that can change column widths or reveal a previously-
   display:none table: tab switch, chevron expand/collapse, model reload, and
   window resize.

   `scopeEl` is whatever root currently contains the rendered statement
   tables — usually #s2ExpandedRoot, but `document` works for the resize
   handler since it just needs to catch every .iffm-table-scroll on the page. */
function applyStickyColumns(scopeEl) {
  if (!scopeEl || !scopeEl.querySelectorAll) return;
  scopeEl.querySelectorAll(".iffm-table-scroll").forEach((wrap) => {
    // Skip panes that are currently display:none (e.g. an inactive tab) —
    // they measure as zero-width, which would collapse every sticky column
    // to left:0. They get measured correctly the moment they become visible
    // (see the tab-click handler in wireExpandedPanel).
    if (wrap.offsetWidth === 0) return;
    const table = wrap.querySelector("table.iffm-table");
    if (!table) return;
    const headRow = table.querySelector("thead tr");
    if (!headRow || !headRow.children.length) return;

    const requested = parseInt(wrap.dataset.iffmStickyCols, 10) || 1;
    // Never freeze every column — at least one (a forecast year) must stay
    // free to scroll, or "scrolling" would have nothing left to do.
    const stickyCount = Math.max(1, Math.min(requested, headRow.children.length - 1));

    const widths = [];
    for (let i = 0; i < stickyCount; i++) {
      const cell = headRow.children[i];
      widths.push(cell ? cell.getBoundingClientRect().width : 0);
    }

    table.querySelectorAll("tr").forEach((tr) => {
      let offset = 0;
      for (let i = 0; i < stickyCount; i++) {
        const cell = tr.children[i];
        if (!cell) break;
        cell.classList.add("iffm-sticky-col");
        cell.classList.toggle("iffm-sticky-col-last", i === stickyCount - 1);
        cell.style.left = offset + "px";
        offset += widths[i];
      }
    });
  });
}

// Recompute frozen-column offsets on window resize — column widths shift
// whenever the layout reflows (sidebar collapse, browser resize, zoom).
// Wired once at script load; applyStickyColumns() itself is a no-op for any
// table that isn't currently visible, so this is safe to call broadly.
(() => {
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => applyStickyColumns(document), 150);
  });
})();

/* ════════════════════════════════════════════════════════════════════════════
   COMPUTE INTEGRATED STATEMENTS — projected income, balance, cash flow.

   Inputs:
     data — full IDCF API response
     ui   — IDCF.uiState (used for capitalAllocation overrides)
   Outputs:
     {
       income:           [{ year, rev, growth, cogs, gross, grossMargin, ebitda, ebitdaMargin,
                             dep, ebit, ebitMargin, financeCost, pbt, tax, pat, patMargin, eps }, ...]
       balance:          [{ year, cash, receivables, inventory, otherCA, totalCA,
                             ppe, otherNCA, totalAssets, stDebt, ltDebt, totalDebt,
                             payables, otherCL, totalLiab, equity, netDebt, bvps }, ...]
       cashflow:         [{ year, ebitda, cashTax, ocf, wcMove, cfo, capex, investCF,
                             financeCF, fcff, netChange, openingCash, closingCash }, ...]
       balanceActuals:   [...] (last 3 historical balance years, same schema as balance)
       cashflowActuals:  [...] (last 3 historical cashflow years, same schema as cashflow)
       epsAvailable:     boolean
     }

   All projections derived from existing engine outputs + the historical anchors
   in data.statements. No external API calls.
   ════════════════════════════════════════════════════════════════════════════ */
function computeIntegratedStatements(data, ui) {
  const d = data.idcf;
  const a = d.assumptions;
  const fcRows = d.base.rows || [];
  const inc = data.statements?.income || [];
  const bal = data.statements?.balance || [];
  const cf  = data.statements?.cashflow || [];

  const sharesOut = d.sharesOut;
  const epsAvailable = sharesOut != null && isFinite(sharesOut) && sharesOut > 0;

  // ── Historical anchors ──────────────────────────────────────────────────
  const safeDiv = (a, b) => (a != null && b != null && isFinite(a) && isFinite(b) && b !== 0) ? a / b : null;
  const validNums = (arr) => arr.filter((x) => x != null && isFinite(x));
  const avg = (arr) => { const v = validNums(arr); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  const lastNonNull = (arr) => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null && isFinite(arr[i])) return arr[i]; return null; };

  // Gross margin: use COGS field if available, otherwise (revenue - grossProfit)/revenue
  const grossMarginSeries = inc.map((r) => {
    if (r.cogs != null && r.revenue) return 1 - r.cogs / r.revenue;
    return safeDiv(r.grossProfit, r.revenue);
  });
  const gm = avg(grossMarginSeries.filter(x => x != null && x > 0 && x < 1));
  const grossMarginUsed = (gm != null && isFinite(gm) && gm > 0.05) ? gm : 0.45;

  // SG&A and Other Operating Expenses as % of revenue (averaged from historical)
  const sgaPctSeries = inc.map((r) => safeDiv(r.sga, r.revenue));
  const sgaPctAvg = avg(sgaPctSeries.filter(x => x != null && x >= 0 && x < 0.5));
  const otherOpPctSeries = inc.map((r) => safeDiv(r.otherOpExp, r.revenue));
  const otherOpPctAvg = avg(otherOpPctSeries.filter(x => x != null && x >= 0 && x < 0.3));

  // Working capital days
  const ev = data.evidence?.assumptions?.workingCapital?.historical || {};
  const dso = ev.dso?.avg ?? (() => { const last = bal.at(-1) || {}, li = inc.at(-1) || {}; return safeDiv(last.receivables, li.revenue) != null ? safeDiv(last.receivables, li.revenue) * 365 : 45; })();
  const dio = ev.dio?.avg ?? (() => { const last = bal.at(-1) || {}, li = inc.at(-1) || {}; const cogs = li.revenue != null && li.grossProfit != null ? li.revenue - li.grossProfit : null; return safeDiv(last.inventory, cogs) != null ? safeDiv(last.inventory, cogs) * 365 : 60; })();
  const dpo = ev.dpo?.avg ?? (() => { const last = bal.at(-1) || {}, li = inc.at(-1) || {}; const cogs = li.revenue != null && li.grossProfit != null ? li.revenue - li.grossProfit : null; return safeDiv(last.payables, cogs) != null ? safeDiv(last.payables, cogs) * 365 : 60; })();

  // Finance cost & income (held flat at last historical)
  const lastInt = inc.at(-1)?.interest;
  const interestProj = (lastInt != null && isFinite(lastInt) && lastInt > 0) ? Math.abs(lastInt) : 0;
  const lastIntIncome = lastNonNull(inc.map(r => r.interestIncome));
  const interestIncomeProj = (lastIntIncome != null && isFinite(lastIntIncome)) ? lastIntIncome : 0;

  // Last historical balance — opening positions.
  // Task 5: capital-structure scalars (ST Debt, LT Debt, Cash) can be
  // overridden by the user via uiState.capitalStructure. When set, the
  // forecast opens from the user's overridden values rather than Yahoo's
  // last historical year — keeping the screen and Excel in lockstep.
  const lastBal = bal.at(-1) || {};
  const lastInc = inc.at(-1) || {};
  const lastCf  = cf.at(-1)  || {};
  const csOv = (ui && ui.capitalStructure) || {};
  const openingCash    = (csOv.cash    != null && isFinite(csOv.cash))    ? +csOv.cash    : (lastBal.cash ?? 0);
  const openingStDebt  = (csOv.stDebt  != null && isFinite(csOv.stDebt))  ? +csOv.stDebt  : (lastBal.stDebt ?? 0);
  const openingLtDebt  = (csOv.ltDebt  != null && isFinite(csOv.ltDebt))  ? +csOv.ltDebt  : (lastBal.ltDebt ?? 0);
  const openingPPE     = (() => {
    if (lastBal.ppe != null) return lastBal.ppe;
    const ca = lastBal.currentAssets ?? ((lastBal.cash || 0) + (lastBal.receivables || 0) + (lastBal.inventory || 0));
    if (lastBal.assets != null && ca != null) return (lastBal.assets - ca) * 0.75;
    return 0;
  })();
  const openingIntangibles = lastBal.intangibles ?? 0;
  const openingGoodwill    = lastBal.goodwill ?? 0;
  const openingInvestments = lastBal.investments ?? 0;
  const openingMinorityInterest = lastBal.minorityInterest ?? 0;
  const openingLongTermLease    = lastBal.longTermLease ?? 0;
  const openingDeferredTaxLiab  = lastBal.deferredTaxLiab ?? 0;
  const openingOtherNCL         = lastBal.otherNCL ?? 0;
  const openingOtherCA = (() => {
    if (lastBal.otherCA != null) return lastBal.otherCA;
    const ca = lastBal.currentAssets;
    if (ca == null) return 0;
    return Math.max(0, ca - (lastBal.cash || 0) - (lastBal.receivables || 0) - (lastBal.inventory || 0));
  })();
  const openingOtherCL = (() => {
    if (lastBal.otherCL != null) return lastBal.otherCL;
    const cl = lastBal.currentLiab;
    if (cl == null) return 0;
    return Math.max(0, cl - (lastBal.payables || 0) - (lastBal.stDebt || 0));
  })();
  const openingEquity = lastBal.equity ?? 0;
  const openingShareCapital     = lastBal.shareCapital ?? null;
  const openingRetainedEarnings = lastBal.retainedEarnings ?? null;
  const openingOtherEquity      = lastBal.otherEquity ?? null;
  // If share capital + retained earnings split is unavailable, we display
  // total equity in the "Retained Earnings" row as a fallback (with a hint
  // in the UI). Otherwise we evolve retained earnings = prior + PAT − div.
  const equitySplitAvailable = openingShareCapital != null && openingRetainedEarnings != null;

  // ── Capital allocation rates ────────────────────────────────────────────
  const capUi = ui?.capitalAllocation || {};
  const rateFor = (arr, i) => {
    if (!arr) return 0;
    if (i < 3 && arr[i] != null && isFinite(+arr[i])) return +arr[i];
    if (arr[2] != null && isFinite(+arr[2])) return +arr[2];
    return 0;
  };
  // Historical dividend rate (% of PAT) — used as default if user hasn't overridden
  const histDivRate = (() => {
    const r = cf.map((c, i) => {
      const ni = inc[i]?.netIncome;
      return c.dividends && ni && ni > 0 ? c.dividends / ni : null;
    }).filter(x => x != null && x > 0 && x < 1);
    return r.length ? r.reduce((s, x) => s + x, 0) / r.length : null;
  })();

  // ── Project income statement ────────────────────────────────────────────
  const income = fcRows.map((r) => {
    const rev = r.rev;
    const cogs = rev * (1 - grossMarginUsed);
    const gross = rev - cogs;
    const grossMarginPct = (gross / rev) * 100;
    const dep = r.dep;
    const ebitda = r.ebitda;
    const ebit = r.ebit;
    const taxRatePct = r.ebit ? (r.tax / r.ebit) * 100 : a.taxRate;
    // SG&A / Other Op Exp projected as % of revenue (if hist available)
    const sga        = sgaPctAvg     != null ? rev * sgaPctAvg     : null;
    const otherOpExp = otherOpPctAvg != null ? rev * otherOpPctAvg : null;
    // Operating Expenses = Gross - EBIT (the implied bucket)
    const opExp = gross - ebit;
    const intIncome  = interestIncomeProj;
    const intExpense = interestProj;
    const pbt = ebit + intIncome - intExpense;
    const tax = pbt * (taxRatePct / 100);
    const pat = pbt - tax;
    return {
      year: r.year, rev, growth: r.growth, cogs, gross,
      grossMargin: grossMarginPct, opExp, sga, otherOpExp,
      ebitda, ebitdaMargin: (ebitda / rev) * 100,
      dep, ebit, ebitMargin: (ebit / rev) * 100,
      intIncome, intExpense, financeCost: intExpense, // alias for backwards-compat
      pbt, tax, pat,
      patMargin: (pat / rev) * 100,
      eps: epsAvailable ? pat / sharesOut : null,
      epsDiluted: epsAvailable ? pat / sharesOut : null, // same as basic without dilution data
    };
  });

  // ── Project balance sheet & cash flow ───────────────────────────────────
  let prevEquity = openingEquity;
  let prevRE = openingRetainedEarnings ?? openingEquity;       // fallback when split unavailable
  let prevStDebt = openingStDebt;
  let prevLtDebt = openingLtDebt;
  let prevCash   = openingCash;
  let prevPPE    = openingPPE;
  let prevIntangibles = openingIntangibles;
  let prevInvestments = openingInvestments;
  let prevRecv   = lastBal.receivables ?? 0;
  let prevInv    = lastBal.inventory ?? 0;
  let prevPay    = lastBal.payables ?? 0;
  let prevOtherCA = openingOtherCA;
  let prevOtherCL = openingOtherCL;

  const balance = [];
  const cashflow = [];

  income.forEach((ir, i) => {
    const r = fcRows[i];
    const rev = ir.rev, cogs = ir.cogs, pat = ir.pat, ebitda = ir.ebitda;
    const dep = ir.dep, capex = r.capex;
    const taxAmount = ir.tax;

    // Working capital lines (driver-based)
    const recv = rev * (dso / 365);
    const invy = cogs * (dio / 365);
    const pay  = cogs * (dpo / 365);
    const otherCA = lastInc.revenue ? openingOtherCA * (rev / lastInc.revenue) : openingOtherCA;
    const otherCL = lastInc.revenue ? openingOtherCL * (rev / lastInc.revenue) : openingOtherCL;

    // WC movement (cash impact)
    const netWcCurr = recv + invy + otherCA - pay - otherCL;
    const netWcPrev = prevRecv + prevInv + prevOtherCA - prevPay - prevOtherCL;
    const wcMove = netWcCurr - netWcPrev; // positive = cash absorption

    // PPE rollforward
    const ppe = prevPPE + capex - dep;
    // Intangibles, goodwill, investments — held flat (informational baseline)
    const intangibles = prevIntangibles;
    const goodwill    = openingGoodwill;
    const investments = prevInvestments;
    // Non-current liabilities (other than debt) — held flat
    const longTermLease    = openingLongTermLease;
    const deferredTaxLiab  = openingDeferredTaxLiab;
    const otherNCL         = openingOtherNCL;
    const minorityInterest = openingMinorityInterest;

    // Capital allocation
    const divRatePct = rateFor(capUi.dividendPayout, i);
    const dividendRate = divRatePct ? divRatePct / 100 : (histDivRate || 0);
    const buybackRate  = rateFor(capUi.shareBuyback, i) / 100;
    const debtRepayRate = rateFor(capUi.debtRepayment, i) / 100;
    const acqRate       = rateFor(capUi.strategicAcq, i) / 100;

    const dividends = Math.max(0, pat) * dividendRate;
    const buybacks  = prevEquity * buybackRate;
    const debtRepaid = (prevStDebt + prevLtDebt) * debtRepayRate;
    const debtIssued = 0; // no new debt by default (could expose as override later)
    const acquisitions = rev * acqRate;

    // Debt rollforward
    const totalDebtPrev = prevStDebt + prevLtDebt;
    const totalDebt = Math.max(0, totalDebtPrev - debtRepaid + debtIssued);
    const stDebt = totalDebtPrev > 0 ? totalDebt * (prevStDebt / totalDebtPrev) : 0;
    const ltDebt = totalDebt - stDebt;

    // Cash flow waterfall
    const cashTax  = taxAmount;
    const ocf      = ebitda - cashTax;
    const cfo      = ocf - wcMove;
    const investCF = -capex - acquisitions;
    const financeCF = debtIssued - debtRepaid - dividends - buybacks;
    const netChange = cfo + investCF + financeCF;
    const closingCash = prevCash + netChange;

    // Equity rollforward
    const equity = prevEquity + pat - dividends - buybacks;
    const retainedEarnings = prevRE + pat - dividends;
    const shareCapital = openingShareCapital;
    const otherEquity = equitySplitAvailable
      ? equity - shareCapital - retainedEarnings
      : null;

    // Balance sheet — total liab includes ALL liab buckets (current + non-current).
    // Total assets = total liab + minority interest + equity. otherNCA is plug.
    const currentLiabFc = pay + otherCL + stDebt;
    const nonCurrentLiabFc = ltDebt + longTermLease + deferredTaxLiab + otherNCL;
    const totalLiab = currentLiabFc + nonCurrentLiabFc;
    const totalAssets = totalLiab + minorityInterest + equity;
    const knownNonCashAssets = closingCash + recv + invy + otherCA + ppe + intangibles + goodwill + investments;
    const otherNCA = Math.max(0, totalAssets - knownNonCashAssets);

    const totalCA = closingCash + recv + invy + otherCA;
    const netDebt = totalDebt - closingCash;
    const bvps = epsAvailable ? equity / sharesOut : null;
    // Reconciliation check (always ~0 by construction; surface to confirm)
    const reconDiff = totalAssets - (totalLiab + minorityInterest + equity);

    balance.push({
      year: r.year,
      // Reconciling totals
      totalAssets,
      totalCA,
      totalNonCurrentAssets: totalAssets - totalCA,
      totalLiab,
      currentLiab: currentLiabFc,
      nonCurrentLiab: nonCurrentLiabFc,
      totalEquityGrossMI: equity + minorityInterest,
      // Current assets
      cash: closingCash,
      cashAndShortTerm: closingCash,    // forecast doesn't separately model ST investments
      cashOnly: closingCash,
      shortTermInvestments: null,
      receivables: recv, inventory: invy,
      rawMaterials: null, workInProcess: null, finishedGoods: null, otherInventories: null,
      prepaidAssets: null, restrictedCash: null, assetsHeldForSale: null, hedgingAssetsCurrent: null,
      otherCA,
      // Non-current assets
      netPPE: ppe, grossPPE: null,
      properties: null, landAndImprovements: null, buildingsAndImprovements: null,
      machineryFurnitureEquipment: null, otherProperties: null, constructionInProgress: null,
      accumulatedDepreciation: null,
      goodwillAndOtherIntangibleAssets: goodwill + intangibles,
      goodwill, intangibles, investments,
      deferredTaxAssets: null, nonCurrentPrepaidAssets: null,
      otherNCA,
      // Liabilities
      currentProvisions: null,
      currentDebtAndCapitalLease: stDebt,
      stDebt, currentCapitalLease: null,
      payables: pay, otherCL,
      longTermProvisions: null,
      longTermDebtAndCapitalLease: ltDebt + longTermLease,
      ltDebt,
      longTermLease,           // separate row
      deferredTaxLiab,         // separate row
      tradeAndOtherPayablesNonCurrent: null,
      otherNCL,                // PLUG (computed elsewhere in forecast block)
      // ── Equity (4-row split per revised user spec) ──────────────────
      capitalStockField: shareCapital,
      commonStockOnly: shareCapital,
      additionalPaidInCapital: null,
      retainedEarnings, otherEquityInterest: otherEquity,
      equity, minorityInterest,
      equityCapital: shareCapital,
      // R&S aggregate (Indian convention) = stockholders' equity − share capital
      reservesSurplus: equity - (shareCapital || 0),
      shareCapital,
      // Other Equity — by definition 0 in forecast (R&S + SC = equity by
      // construction, and totalEquityGrossMI = equity + MI). Kept as a row
      // so the BS layout matches historical.
      otherEquity: 0,
      totalLiabAndEquity: totalLiab + minorityInterest + equity,
      totalNonCurrentAssets: totalAssets - totalCA,
      // Derived/Yahoo totals
      totalDebt,
      totalCapitalization: equity + ltDebt,
      commonStockEquity: equity,
      capitalLeaseObligations: longTermLease,
      netTangibleAssets: equity - goodwill - intangibles,
      workingCapital: totalCA - currentLiabFc,
      investedCapital: equity + totalDebt,
      tangibleBookValue: equity - goodwill - intangibles,
      netDebt, shareIssued: null, ordinarySharesNumber: null,
      bvps, reconDiff: 0,
    });
    cashflow.push({
      year: r.year, ebitda, cashTax, wcMove, ocf, cfo,
      capex, acquisitions, investCF,
      debtIssued, debtRepaid, dividends, buybacks, financeCF,
      fcff: r.fcff, fcfe: r.fcff + debtIssued - debtRepaid - ir.intExpense * (1 - (ir.tax / Math.max(1, ir.pbt))),
      netChange, openingCash: prevCash, closingCash,
    });

    // Roll state forward
    prevEquity = equity;
    prevRE = retainedEarnings;
    prevStDebt = stDebt; prevLtDebt = ltDebt;
    prevCash = closingCash;
    prevPPE = ppe;
    prevIntangibles = intangibles;
    prevInvestments = investments;
    prevRecv = recv; prevInv = invy; prevPay = pay;
    prevOtherCA = otherCA; prevOtherCL = otherCL;
  });

  // ── Historical actuals (last 3 years) — for ALL three tabs ─────────────
  // Designed to RECONCILE with the reported statements:
  //   • PAT uses netIncomeIncludingNoncontrollingInterests when available
  //     (= "Profit for the year" in Ind AS, includes associate share, BEFORE
  //     allocating between parent and minority interest). This is the
  //     institutionally correct PAT — what every Indian annual report
  //     declares as "Profit After Tax".
  //   • Balance sheet: reported totalAssets / totalLiabilities / equity are
  //     authoritative. Minority Interest is implied as the plug when not
  //     explicitly reported. Equity decomposed into Equity Capital +
  //     Reserves & Surplus (where Reserves = totalEquity − Equity Capital).
  //   • Cash flow: opening cash = the CF statement's OWN beginningCash
  //     (NOT the balance-sheet cash, which differs because BS cash
  //     includes short-term investments). Closing cash = endCash.
  //     This guarantees Opening + Net Change = Closing perfectly.
  const sliced = inc.slice(-3);
  const histYears = sliced.map((ir, idx) => {
    const i = inc.length - (sliced.length - idx);
    const br = bal[i] || {}, cr = cf[i] || {};
    const rev = ir.revenue;
    const cogsH = ir.cogs != null ? ir.cogs : (ir.revenue != null && ir.grossProfit != null ? ir.revenue - ir.grossProfit : null);

    // ── Income Statement actuals — PAT mapping ────────────────────────────
    // Preference order:
    //   1. netIncomeIncludingNoncontrollingInterests — the canonical Ind AS
    //      "Profit for the year" — includes associate share, before MI split.
    //   2. pretax + associate income − tax — when (1) isn't exposed, compute
    //      from constituents. Associate share is usually presented after tax
    //      on the IS (associates report their own tax) so this is the
    //      institutional convention.
    //   3. pretax − tax — minimal fallback (loses associate share).
    //   4. netIncome — final fallback (net of MI; less accurate for
    //      consolidated entities).
    const associate = ir.associateIncome;
    const patH = ir.netIncomeIncludingMI != null
      ? ir.netIncomeIncludingMI
      : (ir.pretax != null && ir.tax != null
          ? ir.pretax - ir.tax + (associate || 0)
          : ir.netIncome);
    const opExpH = ir.grossProfit != null && (ir.ebit ?? ir.opIncome) != null
      ? ir.grossProfit - (ir.ebit ?? ir.opIncome) : null;
    const prevRev = idx > 0 ? sliced[idx - 1]?.revenue : inc[i - 1]?.revenue;
    const isRow = {
      year: ir.year, rev,
      growth: prevRev ? (rev / prevRev - 1) * 100 : null,
      cogs: cogsH,
      gross: ir.grossProfit,
      grossMargin: ir.grossProfit != null && rev ? (ir.grossProfit / rev) * 100 : null,
      opExp: opExpH, sga: ir.sga, otherOpExp: ir.otherOpExp,
      ebitda: ir.ebitda,
      ebitdaMargin: ir.ebitda != null && rev ? (ir.ebitda / rev) * 100 : null,
      dep: cr.dep,
      ebit: ir.ebit ?? ir.opIncome,
      ebitMargin: (ir.ebit ?? ir.opIncome) != null && rev ? ((ir.ebit ?? ir.opIncome) / rev) * 100 : null,
      intIncome: ir.interestIncome,
      intExpense: ir.interest, financeCost: ir.interest,
      pbt: ir.pretax,
      tax: ir.tax,
      associateShare: associate,            // separately surfaced for IS row
      minorityIntIncome: ir.minorityIntIncome,
      pat: patH,
      patAttributableToParent: ir.netIncome,  // PAT minus MI = profit to equity holders
      patMargin: patH != null && rev ? (patH / rev) * 100 : null,
      eps: ir.basicEPS != null ? ir.basicEPS : (epsAvailable && patH != null ? patH / sharesOut : null),
      epsDiluted: ir.dilutedEPS != null ? ir.dilutedEPS : (epsAvailable && patH != null ? patH / sharesOut : null),
    };

    // ── Balance Sheet actuals — every "Other" bucket is a PLUG ───────────
    // Per user spec (revised Task 7/8):
    //
    //   Current Assets    = Cash + ST Investments + Receivables + Inventory + Other CA
    //   Non-Current Assets = PPE + Goodwill&Intan + LT Investments + Other NCA
    //   Total Assets      = Current Assets + Non-Current Assets
    //   Current Liab      = Short-Term Debt + Accounts Payable + Other CL
    //   Non-Current Liab  = Long-Term Debt + Lease + DTL + Other NCL
    //   Total Liab        = Current Liab + Non-Current Liab
    //   Total Equity      = Share Capital + Reserves & Surplus + MI + Other Equity
    //   Total Liab + Total Equity = Total Assets
    //
    // The "Other" row is COMPUTED AS A PLUG so children always sum to the
    // displayed parent subtotal — never trust Yahoo's raw `otherCA` etc.
    // field, which is incomplete and breaks the math (the bug in screenshot).
    const cash = br.cash, recv = br.receivables, invo = br.inventory, pay = br.payables;
    const sti = br.shortTermInvestments;

    // ── Current Assets ──────────────────────────────────────────────────
    const ca_ca = br.currentAssets;        // reported subtotal (authoritative)
    const otherCAh = (ca_ca != null)
      ? Math.max(0, ca_ca - (cash || 0) - (sti || 0) - (recv || 0) - (invo || 0))
      : (br.otherCA || 0);                  // fallback only when subtotal missing

    // ── Non-Current Assets ──────────────────────────────────────────────
    const ppeh = br.ppe ?? null;
    const intangH = br.intangibles, goodwillH = br.goodwill, investH = br.investments;
    const goodwillIntanH = (goodwillH != null || intangH != null)
      ? (goodwillH || 0) + (intangH || 0)
      : (br.goodwillAndOtherIntangibleAssets != null ? br.goodwillAndOtherIntangibleAssets : 0);
    // Reported total NCA — prefer Yahoo's field; else derive from totalAssets - CA
    const totalNCAh = br.totalNonCurrentAssets != null ? br.totalNonCurrentAssets
      : (br.assets != null && ca_ca != null ? br.assets - ca_ca : null);
    const otherNCAh = (totalNCAh != null)
      ? Math.max(0, totalNCAh - (ppeh || 0) - goodwillIntanH - (investH || 0))
      : (br.otherNCA || 0);

    // ── Debt ────────────────────────────────────────────────────────────
    const stDebth = br.stDebt, ltDebth = br.ltDebt;
    // Task 6: Total Debt = ST + LT ONLY (excludes leases). Capital leases are
    // contractual obligations, not financing debt, for net-debt purposes.
    const totalDebth = (stDebth != null || ltDebth != null)
      ? (stDebth || 0) + (ltDebth || 0)
      : (br.totalDebt != null
          ? Math.max(0, br.totalDebt - (br.capitalLeaseObligations || 0) - (br.longTermLease || 0))
          : null);

    // ── Current Liabilities ─────────────────────────────────────────────
    const otherCLh = (br.currentLiab != null)
      ? Math.max(0, br.currentLiab - (pay || 0) - (stDebth || 0))
      : (br.otherCL || 0);

    // ── Non-Current Liabilities ─────────────────────────────────────────
    // Per revised user spec: Long-Term Debt + Lease + DTL + Other NCL = Total NCL
    // Lease and DTL are SEPARATE rows; Other NCL is the plug.
    const leaseH = br.longTermLease || 0;
    const dtlH = br.deferredTaxLiab || 0;
    const reportedTotalLiabH = br.totalLiabilities;
    const ncl_h_reported = br.nonCurrentLiab;
    // If totalLiabilities is reported, derive NCL = totalLiab - currentLiab
    const ncl_h = ncl_h_reported != null ? ncl_h_reported
      : (reportedTotalLiabH != null && br.currentLiab != null ? reportedTotalLiabH - br.currentLiab : null);
    const otherNCLh = (ncl_h != null)
      ? Math.max(0, ncl_h - (ltDebth || 0) - leaseH - dtlH)
      : (br.otherNCL || 0);

    const totalLiabH = reportedTotalLiabH != null ? reportedTotalLiabH
      : (br.currentLiab != null && ncl_h != null ? br.currentLiab + ncl_h
        : (totalDebth != null && pay != null ? totalDebth + pay + (otherCLh || 0) + (ncl_h || 0) : null));

    // ── EQUITY DECOMPOSITION (revised user spec) ────────────────────────
    // Total Equity = Share Capital + Reserves & Surplus + Minority Interest + Other Equity
    //   • Share Capital      = br.shareCapital
    //   • Reserves & Surplus = equity_attributable − shareCapital  (R&S aggregate, Indian convention)
    //   • Minority Interest  = br.minorityInterest (or plug to make A = L + E)
    //   • Other Equity       = totalEquityGrossMI − (SC + R&S + MI)  PLUG
    //     By identity, SC + R&S = equity_attributable, so Other Eq is zero by
    //     construction when reported equity reconciles cleanly. Becomes
    //     non-zero only if upstream BS doesn't reconcile, in which case it
    //     absorbs the residual so children always sum to Total Equity.
    const eqH = br.equity;
    const equityCapH = br.shareCapital || 0;
    const reservesSurplusH = (eqH != null) ? eqH - equityCapH : null;

    // ── MINORITY INTEREST — implied as plug when not reported ─────────────
    // The reported identity is: Assets = Liab + Equity-attributable + MI
    // If MI is missing from Yahoo, compute it as the residual so the BS
    // reconciles. Many Indian consolidated statements report MI separately
    // even if Yahoo doesn't surface it cleanly.
    let miH;
    if (br.minorityInterest != null && isFinite(br.minorityInterest)) {
      miH = br.minorityInterest;
    } else if (br.assets != null && totalLiabH != null && eqH != null) {
      // Implicit MI = assets − totalLiab − equity. Floor at 0.
      miH = Math.max(0, br.assets - totalLiabH - eqH);
    } else {
      miH = 0;
    }

    // ── OTHER EQUITY (plug) — last residual to make A = L + E hold ────────
    // Total Equity (gross MI) = Share Capital + Reserves & Surplus + MI + Other Equity
    // SC + R&S = equity_attributable by construction. So Other Equity reduces
    // to (totalEquityGrossMI - equity_attributable - MI). If reported figures
    // reconcile, this is zero. If a top-level drift exists between
    // totalAssets − totalLiab and (equity + MI), the residual lives here.
    const totalEqGMIh = br.totalEquityGrossMI != null ? br.totalEquityGrossMI
      : ((eqH || 0) + (miH || 0));
    // If reported total assets exists and doesn't match totalLiab + totalEq,
    // we plug into Other Equity so the displayed BS reconciles cleanly.
    const tlPlusEqH = (totalLiabH || 0) + totalEqGMIh;
    const topLevelDrift = (br.assets != null) ? (br.assets - tlPlusEqH) : 0;
    const otherEquityH = Math.max(0, topLevelDrift);

    const tlAndEqH = (totalLiabH || 0) + totalEqGMIh + otherEquityH;
    const netDebtH = totalDebth != null && cash != null ? totalDebth - cash : null;
    const bvpsH = epsAvailable && eqH != null ? eqH / sharesOut : null;
    const bsRow = {
      year: ir.year,
      // Reported Yahoo totals (authoritative; use directly)
      totalAssets: br.assets,
      totalCA: br.currentAssets,
      totalNonCurrentAssets: br.totalNonCurrentAssets != null
        ? br.totalNonCurrentAssets
        : (br.assets != null && br.currentAssets != null ? br.assets - br.currentAssets : null),
      totalLiab: totalLiabH,
      currentLiab: br.currentLiab,
      nonCurrentLiab: ncl_h,
      totalEquityGrossMI: totalEqGMIh,
      totalNonCurrentAssets: totalNCAh,
      totalCA: br.currentAssets,
      // ── Current assets detail ────────────────────────────────────────
      cash: br.cash,
      cashAndShortTerm: br.cashAndShortTerm != null ? br.cashAndShortTerm
        : ((br.cashOnly || br.cash) + (br.shortTermInvestments || 0)),
      cashOnly: br.cashOnly != null ? br.cashOnly : br.cash,
      shortTermInvestments: br.shortTermInvestments,
      receivables: recv, inventory: invo,
      rawMaterials: br.rawMaterials, workInProcess: br.workInProcess,
      finishedGoods: br.finishedGoods, otherInventories: br.otherInventories,
      prepaidAssets: br.prepaidAssets, restrictedCash: br.restrictedCash,
      assetsHeldForSale: br.assetsHeldForSale, hedgingAssetsCurrent: br.hedgingAssetsCurrent,
      otherCA: otherCAh,   // PLUG: reported totalCA − explicit children
      // ── Non-current assets detail ───────────────────────────────────
      netPPE: br.netPPE != null ? br.netPPE : (ppeh != null ? ppeh : null),
      grossPPE: br.grossPPE,
      properties: br.properties, landAndImprovements: br.landAndImprovements,
      buildingsAndImprovements: br.buildingsAndImprovements,
      machineryFurnitureEquipment: br.machineryFurnitureEquipment,
      otherProperties: br.otherProperties, constructionInProgress: br.constructionInProgress,
      accumulatedDepreciation: br.accumulatedDepreciation,
      goodwillAndOtherIntangibleAssets: goodwillIntanH,
      goodwill: br.goodwill, intangibles: br.intangibles,
      investments: br.investments, deferredTaxAssets: br.deferredTaxAssets,
      nonCurrentPrepaidAssets: br.nonCurrentPrepaidAssets,
      otherNCA: otherNCAh,   // PLUG: reported totalNCA − explicit children
      // ── Liabilities detail ──────────────────────────────────────────
      currentProvisions: br.currentProvisions,
      currentDebtAndCapitalLease: br.currentDebtAndCapitalLease != null
        ? br.currentDebtAndCapitalLease
        : ((br.stDebt || 0) + (br.currentCapitalLease || 0)),
      stDebt: br.stDebt, currentCapitalLease: br.currentCapitalLease,
      payables: pay,
      otherCL: otherCLh,   // PLUG: reported currentLiab − stDebt − payables
      longTermProvisions: br.longTermProvisions,
      longTermDebtAndCapitalLease: (br.ltDebt || 0) + leaseH,
      ltDebt: br.ltDebt,
      longTermLease: leaseH,           // separate row per revised user spec
      deferredTaxLiab: dtlH,           // separate row per revised user spec
      tradeAndOtherPayablesNonCurrent: br.tradeAndOtherPayablesNonCurrent,
      otherNCL: otherNCLh,   // PLUG: reported nonCurrentLiab − ltDebt − lease − DTL
      // ── Equity detail (4-row split per revised user spec) ───────────
      capitalStockField: br.capitalStockField != null
        ? br.capitalStockField
        : ((br.commonStockOnly || br.shareCapital) + (br.additionalPaidInCapital || 0)),
      commonStockOnly: br.commonStockOnly != null ? br.commonStockOnly : br.shareCapital,
      additionalPaidInCapital: br.additionalPaidInCapital,
      retainedEarnings: br.retainedEarnings,   // kept for downstream consumers
      otherEquityInterest: br.otherEquityInterest,
      equity: eqH, minorityInterest: miH,
      shareCapital: equityCapH,
      reservesSurplus: reservesSurplusH,       // R&S = equity_attributable − SC
      otherEquity: otherEquityH,               // PLUG: 0 by construction
      equityCapital: equityCapH,
      totalLiabAndEquity: tlAndEqH,
      // ── Yahoo's pre-computed totals (verbatim) ──────────────────────
      totalDebt: totalDebth,
      totalCapitalization: br.totalCapitalization != null ? br.totalCapitalization
        : ((br.equity || 0) + (br.ltDebt || 0)),
      commonStockEquity: br.commonStockEquity != null ? br.commonStockEquity : br.equity,
      capitalLeaseObligations: br.capitalLeaseObligations != null ? br.capitalLeaseObligations
        : ((br.currentCapitalLease || 0) + (br.longTermLease || 0)),
      netTangibleAssets: br.netTangibleAssets != null ? br.netTangibleAssets
        : (eqH != null && br.goodwill != null && br.intangibles != null
            ? eqH - (br.goodwill || 0) - (br.intangibles || 0) : null),
      workingCapital: br.workingCapital != null ? br.workingCapital
        : (br.currentAssets != null && br.currentLiab != null ? br.currentAssets - br.currentLiab : null),
      investedCapital: br.investedCapital != null ? br.investedCapital
        : ((eqH || 0) + (totalDebth || 0)),
      tangibleBookValue: br.tangibleBookValue != null ? br.tangibleBookValue
        : (eqH != null && br.goodwill != null && br.intangibles != null
            ? eqH - (br.goodwill || 0) - (br.intangibles || 0) : null),
      netDebt: br.netDebt != null ? br.netDebt : netDebtH,
      shareIssued: br.shareIssued,
      ordinarySharesNumber: br.ordinarySharesNumber,
      bvps: bvpsH, reconDiff: 0,   // hidden / always zero by plug construction
    };

    // ── Cash Flow actuals — opening/closing cash from CF statement itself ─
    // The CF statement's own beginningCashPosition / endCashPosition are the
    // authoritative basis. Using BS cash instead caused mismatch because BS
    // "cash & cash equivalents" includes short-term investments that the CF
    // statement excludes (e.g. Reliance has significant ST investments).
    // Opening + Net Change = Closing reconciles trivially with this fix.
    const ocfH       = cr.ocf;
    const investCFH  = cr.investingCF;
    const financeCFH = cr.financingCF;
    const reportedNetChange = cr.netChange;
    const computedNetChange = ocfH != null && investCFH != null && financeCFH != null
      ? ocfH + investCFH + financeCFH
      : null;
    const netChangeH = reportedNetChange != null ? reportedNetChange : computedNetChange;
    // Opening cash priority: CF's beginningCash > prior year's CF endingCash > prior year's BS cash
    const prevCfRow = cf[i - 1] || {};
    const openingCashH = cr.beginningCash != null ? cr.beginningCash
      : (prevCfRow.endingCash != null ? prevCfRow.endingCash
        : (bal[i - 1]?.cash != null ? bal[i - 1].cash : null));
    // Closing cash priority: CF's endingCash > openingCash + netChange > BS cash
    const closingCashH = cr.endingCash != null ? cr.endingCash
      : (openingCashH != null && netChangeH != null ? openingCashH + netChangeH
        : cash);
    // Free Cash Flow — standard definition: OCF − Capex (positive cash to firm)
    // Prefer Yahoo's reported freeCashFlow field; otherwise derive correctly.
    const fcfH = cr.fcf != null ? cr.fcf
      : (ocfH != null && cr.capex != null ? ocfH - cr.capex : null);
    const cfRow = {
      year: ir.year,
      ebitda: ir.ebitda,
      cashTax: cr.taxesPaid != null ? cr.taxesPaid : ir.tax,
      wcMove: cr.wcChange != null ? cr.wcChange : null,
      ocf: ocfH, cfo: ocfH,
      capex: cr.capex,
      acquisitions: null,
      investCF: investCFH,
      // Investing-section components (when available from Yahoo)
      fixedAssetsPurchased: cr.fixedAssetsPurchased,
      fixedAssetsSold: cr.fixedAssetsSold,
      investmentsPurchased: cr.investmentsPurchased,
      investmentsSold: cr.investmentsSold,
      interestReceived: cr.interestReceivedCFI,
      dividendsReceived: cr.dividendsReceivedCFI,
      // Financing-section components
      debtIssued: cr.debtIssued, debtRepaid: cr.debtRepaid,
      dividends: cr.dividends, buybacks: cr.buybacks,
      proceedsFromShares: cr.proceedsFromShares,
      interestPaid: cr.interestPaid,
      financeCF: financeCFH,
      fcff: fcfH,   // historical FCF = OCF − Capex (reported preferred)
      fcfe: null,
      netChange: netChangeH,
      openingCash: openingCashH,
      closingCash: closingCashH,
    };
    return { is: isRow, bs: bsRow, cf: cfRow };
  });

  return {
    income,
    balance,
    cashflow,
    incomeActuals:   histYears.map((x) => x.is),
    balanceActuals:  histYears.map((x) => x.bs),
    cashflowActuals: histYears.map((x) => x.cf),
    epsAvailable,
    equitySplitAvailable,
  };
}

/* ════════ FORENSIC ANALYSIS (dedicated top-level module) ════════ */
TABS.forensic = {
  init() {
    const load = $("#frcLoad"), sym = $("#frcSym");
    if (load) load.addEventListener("click", () => { const s = (sym.value || "").trim().toUpperCase(); if (s) this.run(s); });
    if (sym) sym.addEventListener("keydown", (e) => { if (e.key === "Enter") load.click(); });
    if (CURRENT && CURRENT.symbol) { sym.value = CURRENT.symbol; this.run(CURRENT.symbol); }
  },
  /* persistent company context: re-align when the researched company changed */
  syncContext() {
    if (!CURRENT || !CURRENT.symbol || this._sym === CURRENT.symbol) return;
    const sym = $("#frcSym"); if (sym) sym.value = CURRENT.symbol;
    this.run(CURRENT.symbol);
  },
  async run(symbol) {
    this._sym = symbol;
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
  const isINR = /INR|₹/i.test(ccy || "");
  const money = (v) => { if (v == null || !isFinite(v)) return "—"; if (isINR) return "₹" + (v / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 0 }) + " Cr"; return (v / 1e6).toLocaleString("en-US", { maximumFractionDigits: 0 }) + " M"; };
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

  // red flags — with reasoning
  const flagRows = (d.flags || []).map((fl) => `<div class="frc-flag ${fl.sev}"><span class="frc-flag-dot"></span><div><div class="frc-flag-t">${fl.t}</div>${fl.why ? `<div class="frc-flag-why">${fl.why}</div>` : ""}</div></div>`).join("");
  const redFlags = sec("Red-Flag Detection", `${d.flags.filter((x) => x.sev !== "low").length} material item(s)`, `<div class="frc-flags">${flagRows}</div><div class="frc-note">Each flag states the metric that triggered it, the threshold breached and why it matters for earnings or solvency quality.</div>`);

  // NEW: year-wise figures feeding the models
  const fig = f.figures || [];
  const figLine = (label, key, fmt) => `<tr><td>${label}</td>${fig.map((y) => `<td>${fmt(y[key])}</td>`).join("")}</tr>`;
  const figuresSec = fig.length ? sec("Financial Figures Used", "year-wise inputs behind every calculation below",
    `<div class="frc-scroll"><table class="frc-t frc-fig"><tr><th>${isINR ? "₹ Crore" : "Millions"}</th>${fig.map((y) => `<th>FY${String(y.year).slice(2)}</th>`).join("")}</tr>
      ${figLine("Revenue", "revenue", money)}
      ${figLine("Gross profit", "grossProfit", money)}
      ${figLine("EBIT", "ebit", money)}
      ${figLine("Net income", "netIncome", money)}
      ${figLine("Operating cash flow", "ocf", money)}
      ${figLine("Free cash flow", "fcf", money)}
      ${figLine("Total assets", "assets", money)}
      ${figLine("Current assets", "currentAssets", money)}
      ${figLine("Current liabilities", "currentLiab", money)}
      ${figLine("Long-term debt", "ltDebt", money)}
      ${figLine("Shareholders' equity", "equity", money)}
      ${figLine("Receivables", "receivables", money)}
      ${figLine("Inventory", "inventory", money)}
    </table></div><div class="frc-note">These reported figures are the raw inputs; every ratio and model score below is derived from them.</div>`) : "";

  // earnings quality + cash flow quality (with benchmark column)
  const cash = f.cash;
  const eq = sec("Earnings Quality &amp; Cash-Flow Quality", "is reported profit backed by cash?",
    `<table class="frc-t"><tr><th>Metric</th><th>Value</th><th>Benchmark</th><th style="text-align:left">Interpretation</th></tr>
      <tr><td>Cash conversion (OCF / NI)</td><td>${cash.cashConversion == null ? "—" : N(cash.cashConversion, 2) + "×"}</td><td class="frc-bm">≥ 0.90×</td><td>${cash.cashConversion != null && cash.cashConversion >= 0.9 ? "Earnings well-backed by operating cash" : "Earnings exceed cash generation — monitor accruals"}</td></tr>
      <tr><td>FCF margin</td><td>${cash.fcfMargin == null ? "—" : N(cash.fcfMargin, 1) + "%"}</td><td class="frc-bm">&gt; 0%</td><td>Free cash generated per unit of sales</td></tr>
      <tr><td>Accrual ratio (NI − OCF)/assets</td><td>${cash.accrualRatio == null ? "—" : N(cash.accrualRatio, 1) + "%"}</td><td class="frc-bm">|x| &lt; 10%</td><td>${cash.accrualRatio != null && Math.abs(cash.accrualRatio) < 10 ? "Low accruals — clean earnings" : "Elevated accruals — scrutinise revenue recognition"}</td></tr>
    </table>`);

  // piotroski breakdown — now with calculation detail + benchmark
  const pio = sec("Piotroski F-Score — fundamental strength", `${f.piotroski.score}/9 (${f.piotroski.grade})`,
    `<table class="frc-t frc-pio-t"><tr><th style="text-align:left">Test</th><th style="text-align:left">Calculation</th><th>Benchmark</th><th>Pass</th></tr>
      ${f.piotroski.components.map((c) => `<tr class="${c.ok ? "frc-pass" : "frc-fail"}"><td style="text-align:left">${c.t}</td><td style="text-align:left" class="frc-calc">${c.detail || "—"}</td><td class="frc-bm">${c.benchmark || "—"}</td><td class="frc-mark">${c.ok ? "✓" : "✗"}</td></tr>`).join("")}
      <tr class="frc-tot"><td style="text-align:left">F-Score</td><td style="text-align:left">sum of passes</td><td class="frc-bm">≥ 7 strong</td><td>${f.piotroski.score}/9</td></tr>
    </table>`);

  // accounting quality = Beneish components (with benchmark)
  const ben = f.beneish.components, benB = f.beneish.benchmarks || {};
  const benLabels = { DSRI: "Days sales in receivables index", GMI: "Gross margin index", AQI: "Asset quality index", SGI: "Sales growth index", DEPI: "Depreciation index", SGAI: "SG&A expense index", LVGI: "Leverage index", TATA: "Total accruals / assets" };
  const accounting = sec("Accounting Quality — Beneish M-Score", `${f.beneish.flag}`,
    ben ? `<table class="frc-t"><tr><th>Variable</th><th>Value</th><th style="text-align:left">Benchmark</th><th style="text-align:left">What it captures</th></tr>
      ${Object.keys(benLabels).map((k) => `<tr><td>${k}</td><td>${N(ben[k], 2)}</td><td style="text-align:left" class="frc-bm">${benB[k] || "—"}</td><td style="text-align:left">${benLabels[k]}</td></tr>`).join("")}
      <tr class="frc-tot"><td>M-Score</td><td>${N(f.beneish.score, 2)}</td><td style="text-align:left" class="frc-bm">&gt; ${f.beneish.threshold} = risk</td><td style="text-align:left">−4.84 + 0.92·DSRI + 0.528·GMI + 0.404·AQI + 0.892·SGI + 0.115·DEPI − 0.172·SGAI + 4.679·TATA − 0.327·LVGI</td></tr>
    </table>` : `<div class="empty-mini">Beneish components unavailable for this issuer.</div>`);

  // altman breakdown — with raw inputs (backup) + benchmark
  const alt = f.altman.components, altB = f.altman.backup, altW = f.altman.weights || {};
  const altRows = [
    ["Working capital / total assets", "wcTa", altB ? `WC ${money(altB.workingCapital)} ÷ TA ${money(altB.totalAssets)}` : ""],
    ["Retained earnings / total assets", "reTa", altB ? `RE ${money(altB.retainedEarnings)} ÷ TA ${money(altB.totalAssets)}` : ""],
    ["EBIT / total assets", "ebitTa", altB ? `EBIT ${money(altB.ebit)} ÷ TA ${money(altB.totalAssets)}` : ""],
    ["Mkt value equity / total liabilities", "mveTl", altB ? `MVE ${money(altB.marketValueEquity)} ÷ TL ${money(altB.totalLiabilities)}` : ""],
    ["Sales / total assets", "salesTa", altB ? `Sales ${money(altB.sales)} ÷ TA ${money(altB.totalAssets)}` : ""],
  ];
  const altman = sec("Altman Z-Score — financial-distress risk", `${f.altman.score == null ? "—" : N(f.altman.score, 2)} · ${f.altman.zone} zone`,
    alt ? `<div class="frc-scroll"><table class="frc-t frc-z"><tr><th style="text-align:left">Component</th><th style="text-align:left">Calculation (backup)</th><th>Ratio</th><th>Weight</th><th>Contribution</th></tr>
      ${altRows.map(([label, key, calc]) => `<tr><td style="text-align:left">${label}</td><td style="text-align:left" class="frc-calc">${calc || "—"}</td><td>${N(alt[key], 2)}</td><td>${altW[key] != null ? altW[key].toFixed(1) + "×" : "—"}</td><td>${alt[key] != null && altW[key] != null ? N(alt[key] * altW[key], 2) : "—"}</td></tr>`).join("")}
      <tr class="frc-tot"><td style="text-align:left">Z-Score</td><td style="text-align:left">Σ contributions</td><td>${N(f.altman.score, 2)}</td><td></td><td>${f.altman.zone}</td></tr>
    </table></div><div class="frc-note">&gt; 2.99 safe · 1.81–2.99 grey · &lt; 1.81 distress. Contribution = ratio × weight; the Z-score is their sum.</div>` : `<div class="empty-mini">Altman components unavailable for this issuer.</div>`);

  // working capital trend (year-wise)
  const wc = d.wcTrend || [];
  const wcSec = wc.length ? sec("Working-Capital Analysis", "receivable / inventory days &amp; cash trend",
    `<div class="frc-scroll"><table class="frc-t"><tr><th>FY</th>${wc.map((w) => `<th>${String(w.year).slice(2)}</th>`).join("")}<th style="text-align:left">Benchmark</th></tr>
      <tr><td>Receivable days</td>${wc.map((w) => `<td>${w.recvDays ?? "—"}</td>`).join("")}<td class="frc-bm" style="text-align:left">stable/falling</td></tr>
      <tr><td>Inventory days</td>${wc.map((w) => `<td>${w.invDays ?? "—"}</td>`).join("")}<td class="frc-bm" style="text-align:left">stable/falling</td></tr>
      <tr><td>OCF / NI</td>${wc.map((w) => `<td>${w.ocfToNi ?? "—"}</td>`).join("")}<td class="frc-bm" style="text-align:left">&gt; 0.9×</td></tr>
      <tr><td>Accrual %</td>${wc.map((w) => `<td>${w.accrual ?? "—"}</td>`).join("")}<td class="frc-bm" style="text-align:left">|x| &lt; 10%</td></tr>
    </table></div><div class="frc-note">Rising receivable/inventory days or falling OCF/NI are classic quality-of-earnings warning signs.</div>`) : "";

  return `<div class="frc">${scoreCard}${redFlags}${figuresSec}${eq}${pio}${accounting}${altman}${wcSec}</div>`;
}

/* ════════ RISK CENTER (dedicated top-level module) ════════ */
TABS.risk = {
  init() {
    const load = $("#rskLoad"), sym = $("#rskSym");
    if (load) load.addEventListener("click", () => { const s = (sym.value || "").trim().toUpperCase(); if (s) this.run(s); });
    if (sym) sym.addEventListener("keydown", (e) => { if (e.key === "Enter") load.click(); });
    if (CURRENT && CURRENT.symbol) { sym.value = CURRENT.symbol; this.run(CURRENT.symbol); }
  },
  /* persistent company context: re-align when the researched company changed */
  syncContext() {
    if (!CURRENT || !CURRENT.symbol || this._sym === CURRENT.symbol) return;
    const sym = $("#rskSym"); if (sym) sym.value = CURRENT.symbol;
    this.run(CURRENT.symbol);
  },
  async run(symbol) {
    this._sym = symbol;
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