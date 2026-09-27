/* ════════════════════════════════════════════════════════════════════════════
   M-TERMINAL — Forensic Analysis workstation
   Same header, sub-tab bar, 12-column grid, panels and charts as Equity
   Research. Every formula carries an ⓘ that opens a compact explainer:
   formula → purpose → interpretation → M-Terminal's calculation → the exact
   source figures used. Sections without data are not rendered.
   ════════════════════════════════════════════════════════════════════════════ */
TABS.forensic = (() => {
  const S = { sym: null, co: null, d: null, tab: "overview", spark: null, tok: 0 };
  const K = () => WS.kit;
  const $e = (id) => document.getElementById(id);
  const TABS_DEF = [["overview", "Overview"], ["eq", "Earnings Quality"], ["cash", "Cash Flow Quality"], ["piotroski", "Piotroski F-Score"], ["altman", "Altman Z-Score"], ["beneish", "Beneish M-Score"], ["wc", "Working Capital"], ["flags", "Red Flags & Notes"], ["history", "Historical Trend"], ["method", "Methodology & Formulas"]];

  /* ── formatting ─────────────────────────────────────────────────────── */
  let UNIT = "₹ Cr", SCALE = 1e7, CCY = "INR";
  const setCcy = (c) => { CCY = c || "INR"; const u = ersUnits(CCY); UNIT = u.unit; SCALE = u.scale; };
  const n1 = (v, dp = 1) => (v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp }));
  const U = (v) => (v == null || !Number.isFinite(v) ? "—" : (v / SCALE).toLocaleString("en-IN", { maximumFractionDigits: 0 }));
  const amt = (v, unit) => (v == null || !Number.isFinite(v) ? "—" : unit === "shares" ? `${n1(v / 1e7, 2)} Cr shares` : CCY === "INR" ? `₹${U(v)} Cr` : `${U(v)} ${UNIT}`);
  const fy = (y) => (y == null ? "—" : "FY" + String(y).slice(-2));
  const badge = (t, k) => `<span class="ec-badge ${k || ""}">${esc(t)}</span>`;
  const info = (key) => `<button class="fx-i" type="button" data-fx="${esc(key)}" aria-label="Explain">ⓘ</button>`;
  // numeric-looking cells (and their column headers) right-align; text and formulas read left
  const plain = (c) => String(c).replace(/<[^>]+>/g, "").trim();
  const isNum = (c) => c != null && /\d/.test(plain(c)) && /^[\s−+₹$.,%×x\d—/-]*(Cr|days|shares)?[\s×%]*$/i.test(plain(c));
  const tbl = (head, rows, cls) => {
    const body = rows.map((r) => r.cells || r);
    const numCol = head.map((_, i) => i > 0 && body.some((c) => c[i] != null && c[i] !== "") && body.every((c) => c[i] == null || c[i] === "" || c[i] === "—" || isNum(c[i]) || /ws-spark|<svg/.test(c[i])));
    return `<div class="table-wrap"><table class="dt ws-t fx-t ${cls || ""}"><tr>${head.map((h, i) => `<th${numCol[i] ? ' class="n"' : ""}>${h}</th>`).join("")}</tr>${rows.map((r) => `<tr${r.cls ? ` class="${r.cls}"` : ""}>${(r.cells || r).map((c, i) => `<td${numCol[i] || isNum(c) && i > 0 ? ' class="n"' : ""}>${c == null ? "—" : c}</td>`).join("")}</tr>`).join("")}</table></div>`;
  };
  const panel = (t, b, o) => K().panel(t, b, o), row = (c) => K().row(c);
  const grid = (...rows) => rows.filter(Boolean).map((h) => `<div class="ws-grid">${h}</div>`).join("");
  const pass = (ok, na) => (na ? `<span class="ws-dim">n/a</span>` : ok ? `<b class="up">✓</b>` : `<b class="down">✕</b>`);

  /* ═══════════ EXPLAINER REGISTRY — text is static; the calculation and inputs are live ═══════════ */
  const EX = {
    "m.cashConv": ["Cash Conversion", "OCF ÷ Net income", "Operating cash generated relative to reported profit — whether accounting profit is supported by cash.", "Above 1.0× means operating cash exceeds net income. Persistently below ~0.7× means profit is being booked faster than cash is collected; check working capital and revenue recognition."],
    "m.fcfMargin": ["FCF Margin", "Free cash flow ÷ Revenue", "Cash generated from sales after capital expenditure.", "Higher generally indicates stronger cash generation. Read alongside the capex cycle — a heavy build-out phase depresses it temporarily."],
    "m.accrual": ["Accrual Ratio", "(Net income − OCF) ÷ Total assets", "The extent to which earnings differ from operating cash generation — accrual dependence.", "Higher positive values indicate weaker cash backing; accrual-heavy earnings tend to mean-revert. Negative values mean cash exceeded profit."],
    "m.fcfNi": ["FCF Conversion", "Free cash flow ÷ Net income", "How much of reported profit is left as free cash after investment.", "Near or above 1.0× is strong; well below 1.0× in a steady year suggests profit is absorbed by capex or working capital."],
    "m.capexRev": ["Capex Intensity", "Capital expenditure ÷ Revenue", "How much of each rupee of sales is reinvested in fixed assets.", "Needs business context: rising intensity can be growth investment or a sign of maintenance catch-up."],
    "m.wcTa": ["Working Capital / Assets", "(Current assets − Current liabilities) ÷ Total assets", "Working capital relative to the asset base — liquidity structure.", "Higher or lower needs business-context interpretation; a sharp swing is worth checking against receivables and inventory."],
    "m.recvDays": ["Receivable Days", "Receivables ÷ Revenue × 365", "Average time taken to collect customer receivables — collection efficiency.", "Rising days can indicate slower collections or more generous credit terms (a classic channel-stuffing signal)."],
    "m.invDays": ["Inventory Days", "Inventory ÷ Cost of goods sold × 365", "Average inventory holding period — inventory efficiency.", "Rising days can indicate slower inventory movement or build-up ahead of demand."],
    "m.payDays": ["Payable Days", "Payables ÷ Cost of goods sold × 365", "Average time taken to pay suppliers.", "Rising days conserve cash but can flatter operating cash flow; a sudden stretch is worth noting."],
    "m.ccc": ["Cash Conversion Cycle", "Receivable days + Inventory days − Payable days", "Days of working capital tied up in operations.", "Lower is more cash-efficient; a rising cycle absorbs cash."],
    "m.currentRatio": ["Current Ratio", "Current assets ÷ Current liabilities", "Short-term liquidity — current assets available against current liabilities.", "Higher generally means greater current-asset coverage; below 1.0× means current liabilities exceed current assets."],
    "m.grossMargin": ["Gross Margin", "Gross profit ÷ Revenue", "Profitability after the direct cost of goods.", "Stable or rising margins support earnings quality; a falling margin also raises the Beneish GMI."],
    "m.eq": ["Earnings Quality Grade", "Five pass/fail checks → A (4–5) · B (3) · C (2) · D (0–1)", "A composite read of whether reported earnings are cash-backed and free of distress or manipulation signals.", "Checks: cash conversion ≥ 0.90×, accruals within ±10% of assets, Piotroski ≥ 6, Altman safe zone, Beneish below −1.78."],
    "p.F": ["Piotroski F-Score", "Sum of nine binary tests (0–9)", "Fundamental strength across profitability, leverage / liquidity and operating efficiency, year on year.", "7–9 strong · 4–6 moderate · 0–3 weak. Each test compares the latest year with the one before."],
    "p.ni": ["Positive Net Income", "NI > 0", "Basic profitability.", "One point if the company earned a profit in the latest year."],
    "p.ocf": ["Positive Operating Cash Flow", "OCF > 0", "Operating cash generation.", "One point if operations generated cash."],
    "p.roa": ["ROA Improvement", "Current ROA > Prior ROA · ROA = Net income ÷ Total assets", "Improving asset profitability.", "One point if return on assets rose year on year."],
    "p.accr": ["OCF Exceeds Net Income", "OCF > NI", "Earnings backed by cash (the accrual test).", "One point if operating cash flow exceeded net income."],
    "p.lev": ["Lower Leverage", "Current LT debt ÷ Assets < Prior", "Improving balance-sheet leverage.", "One point if long-term debt relative to assets fell (or stayed nil)."],
    "p.cr": ["Higher Current Ratio", "Current ratio > Prior", "Improving liquidity.", "One point if current assets ÷ current liabilities rose."],
    "p.dil": ["No Dilution", "Current shares ≤ Prior shares", "Shareholder dilution.", "One point if no new shares were issued. Small ESOP allotments also fail this test — read the detail."],
    "p.gm": ["Gross Margin Improvement", "Current GM > Prior GM", "Improving profitability at the gross level.", "One point if gross margin rose."],
    "p.at": ["Asset Turnover Improvement", "Current asset turnover > Prior · Revenue ÷ Total assets", "Improving asset efficiency.", "One point if the company generated more revenue per rupee of assets."],
    "b.M": ["Beneish M-Score", "−4.84 + 0.920·DSRI + 0.528·GMI + 0.404·AQI + 0.892·SGI + 0.115·DEPI − 0.172·SGAI + 4.679·TATA − 0.327·LVGI", "A statistical screen for earnings manipulation built from eight year-on-year indices.", "Above −1.78 resembles firms that later restated (elevated risk); −2.22 and below is generally low risk; in between is a grey zone. A screen, not proof."],
    "b.DSRI": ["DSRI — Days Sales in Receivables Index", "Current (Receivables ÷ Revenue) ÷ Prior (Receivables ÷ Revenue)", "Measures whether receivables are growing faster than revenue.", "A value above 1.0 means receivables intensity has increased. This is not automatically evidence of manipulation; investigate alongside collection trends, credit terms and business growth."],
    "b.GMI": ["GMI — Gross Margin Index", "Prior gross margin ÷ Current gross margin", "Gross-margin deterioration.", "Above 1.0 means margins fell — deteriorating prospects raise the incentive to manage earnings."],
    "b.AQI": ["AQI — Asset Quality Index", "[1 − (Current assets + PPE) ÷ Total assets] current ÷ prior", "Change in the share of 'softer' non-current assets (intangibles, deferred costs).", "Above 1.0 can indicate more costs being capitalised rather than expensed."],
    "b.SGI": ["SGI — Sales Growth Index", "Current revenue ÷ Prior revenue", "Sales growth.", "High growth is not manipulation, but it raises pressure to sustain the trajectory."],
    "b.DEPI": ["DEPI — Depreciation Index", "Prior [Dep ÷ (Dep + PPE)] ÷ Current [Dep ÷ (Dep + PPE)]", "Change in the depreciation rate.", "Above 1.0 means assets are being depreciated more slowly — possibly longer useful lives that lift profit."],
    "b.SGAI": ["SGAI — SG&A Expense Index", "Current (SG&A ÷ Revenue) ÷ Prior (SG&A ÷ Revenue)", "SG&A intensity.", "Above 1.0 means overhead is rising faster than sales. It carries a negative weight in the model."],
    "b.LVGI": ["LVGI — Leverage Index", "Current (Total liabilities ÷ Total assets) ÷ Prior", "Leverage change.", "Above 1.0 indicates rising leverage — debt-covenant pressure is a manipulation incentive."],
    "b.TATA": ["TATA — Total Accruals to Total Assets", "(Net income − OCF) ÷ Total assets", "The accrual component of earnings.", "Higher positive values warrant investigation; it carries the largest weight (4.679) in the model."],
    "a.Z": ["Altman Z-Score", "1.2·X1 + 1.4·X2 + 3.3·X3 + 0.6·X4 + 1.0·X5", "A composite financial-distress indicator (original public-manufacturer form).", "Above 2.99 safe · 1.81–2.99 grey · below 1.81 distress. Designed for manufacturers — less meaningful for banks, insurers and asset-light services."],
    "a.X1": ["X1 — Working Capital / Total Assets", "(Current assets − Current liabilities) ÷ Total assets", "Liquidity.", "Higher is safer — a shrinking working-capital cushion is an early distress sign."],
    "a.X2": ["X2 — Retained Earnings / Total Assets", "Retained earnings ÷ Total assets", "Cumulative profitability and maturity.", "Higher is safer — young or loss-making firms score low."],
    "a.X3": ["X3 — EBIT / Total Assets", "EBIT ÷ Total assets", "Operating profitability of the asset base.", "Higher is safer; it carries the largest weight (3.3)."],
    "a.X4": ["X4 — Market Value of Equity / Total Liabilities", "Market capitalisation ÷ Total liabilities", "Capital structure — the solvency cushion the market prices in.", "Higher is safer. For richly valued, low-debt companies this term dominates the Z-Score."],
    "a.X5": ["X5 — Sales / Total Assets", "Revenue ÷ Total assets", "Asset turnover.", "Higher is safer; asset-heavy industries naturally score lower."],
  };

  /* live calculation + inputs for an explainer key */
  function liveFor(key) {
    const f = S.d && S.d.forensic; if (!f) return null;
    const Y = fy(f.years.current), P = fy(f.years.prior);
    const fig = (y) => f.figures.find((x) => x.year === y) || {};
    const cur = fig(f.years.current), prv = fig(f.years.prior);
    const inp = (label, k, both = true) => ({ label, cur: cur[k], prev: both ? prv[k] : undefined });
    const H = f.history.at(-1) || {};
    const m = {
      "m.cashConv": [`${Y}: ${amt(cur.ocf)} ÷ ${amt(cur.netIncome)} = ${n1(f.cash.cashConversion, 2)}×`, [inp("Operating cash flow", "ocf", false), inp("Net income", "netIncome", false)]],
      "m.fcfMargin": [`${Y}: ${amt(cur.fcf)} ÷ ${amt(cur.revenue)} = ${n1(f.cash.fcfMargin)}%`, [inp("Free cash flow", "fcf", false), inp("Revenue", "revenue", false)]],
      "m.accrual": [`${Y}: (${amt(cur.netIncome)} − ${amt(cur.ocf)}) ÷ ${amt(cur.assets)} = ${n1(f.cash.accrualRatio)}%`, [inp("Net income", "netIncome", false), inp("Operating cash flow", "ocf", false), inp("Total assets", "assets", false)]],
      "m.fcfNi": [`${Y}: ${amt(cur.fcf)} ÷ ${amt(cur.netIncome)} = ${n1(f.cash.fcfToNi, 2)}×`, [inp("Free cash flow", "fcf", false), inp("Net income", "netIncome", false)]],
      "m.capexRev": [`${Y}: ${amt(cur.capex)} ÷ ${amt(cur.revenue)} = ${n1(f.cash.capexToRevenue)}%`, [inp("Capital expenditure", "capex", false), inp("Revenue", "revenue", false)]],
      "m.wcTa": [`${Y}: (${amt(cur.currentAssets)} − ${amt(cur.currentLiab)}) ÷ ${amt(cur.assets)} = ${n1(H.wcTa)}%`, [inp("Current assets", "currentAssets", false), inp("Current liabilities", "currentLiab", false), inp("Total assets", "assets", false)]],
      "m.recvDays": [`${Y}: ${amt(cur.receivables)} ÷ ${amt(cur.revenue)} × 365 = ${n1(H.recvDays, 0)} days`, [inp("Trade receivables", "receivables"), inp("Revenue", "revenue")]],
      "m.invDays": [`${Y}: ${amt(cur.inventory)} ÷ COGS × 365 = ${n1(H.invDays, 0)} days (COGS = revenue − gross profit)`, [inp("Inventory", "inventory"), inp("Revenue", "revenue"), inp("Gross profit", "grossProfit")]],
      "m.payDays": [`${Y}: ${amt(cur.payables)} ÷ COGS × 365 = ${n1(H.payDays, 0)} days`, [inp("Trade payables", "payables"), inp("Revenue", "revenue"), inp("Gross profit", "grossProfit")]],
      "m.ccc": [`${Y}: ${n1(H.recvDays, 0)} + ${n1(H.invDays, 0)} − ${n1(H.payDays, 0)} = ${n1(H.ccc, 0)} days`, [inp("Trade receivables", "receivables"), inp("Inventory", "inventory"), inp("Trade payables", "payables")]],
      "m.currentRatio": [`${Y}: ${amt(cur.currentAssets)} ÷ ${amt(cur.currentLiab)} = ${n1(H.currentRatio, 2)}×`, [inp("Current assets", "currentAssets"), inp("Current liabilities", "currentLiab")]],
      "m.grossMargin": [`${Y}: ${amt(cur.grossProfit)} ÷ ${amt(cur.revenue)} = ${n1(H.grossMargin)}%`, [inp("Gross profit", "grossProfit"), inp("Revenue", "revenue")]],
      "m.eq": [f.eqChecks.map((c) => `${c.pass ? "✓" : "✕"} ${c.label}: ${c.value}`).join(" · ") + ` → ${f.eqPass}/5 = grade ${f.earningsQualityGrade}`, []],
      "p.F": [`${Y} vs ${P}: ${f.piotroski.score} of ${f.piotroski.tested} testable criteria passed`, []],
      "b.M": [`−4.84 + Σ(weight × index) = ${n1(f.beneish.score, 2)} (threshold −1.78)`, []],
      "a.Z": [`${Y}: ${(f.altman.detail || []).map((x) => `${x.weight}×${n1(x.ratio, 3)}`).join(" + ")} = ${n1(f.altman.score, 2)}`, []],
    };
    if (m[key]) return { calc: m[key][0], inputs: m[key][1], Y, P };
    const [grp, k] = key.split(".");
    if (grp === "p") { const c = f.piotroski.components.find((x) => x.key === k); return c && { calc: `${Y} vs ${P}: ${c.detail} → ${c.na ? "not testable" : c.ok ? "pass (1 point)" : "fail (0 points)"}`, inputs: c.inputs, Y, P }; }
    if (grp === "b") {
      const v = f.beneish.detail.find((x) => x.key === k); if (!v) return null;
      // spell out each year's ratio, then the index, so the arithmetic is auditable
      const q = (a, b) => (a != null && b ? a / b : null), pc = (x) => (x == null ? "—" : n1(x * 100, 2) + "%");
      const yr = (fa, fb, lab) => `${lab} ${amt(fa)} ÷ ${amt(fb)} = ${pc(q(fa, fb))}`;
      const st = {
        DSRI: `${yr(cur.receivables, cur.revenue, Y)}; ${yr(prv.receivables, prv.revenue, P)}; ${pc(q(cur.receivables, cur.revenue))} ÷ ${pc(q(prv.receivables, prv.revenue))}`,
        GMI: `Gross margin ${P} ${pc(q(prv.grossProfit, prv.revenue))} ÷ ${Y} ${pc(q(cur.grossProfit, cur.revenue))}`,
        AQI: `${Y}: 1 − (${amt(cur.currentAssets)} + ${amt(cur.ppe)}) ÷ ${amt(cur.assets)} = ${pc(1 - q((cur.currentAssets ?? 0) + (cur.ppe ?? 0), cur.assets))}; ${P}: ${pc(1 - q((prv.currentAssets ?? 0) + (prv.ppe ?? 0), prv.assets))}`,
        SGI: `${amt(cur.revenue)} ÷ ${amt(prv.revenue)}`,
        DEPI: `${P} ${amt(prv.dep)} ÷ (${amt(prv.dep)} + ${amt(prv.ppe)}) = ${pc(q(prv.dep, (prv.dep ?? 0) + (prv.ppe ?? 0)))}; ${Y} ${amt(cur.dep)} ÷ (${amt(cur.dep)} + ${amt(cur.ppe)}) = ${pc(q(cur.dep, (cur.dep ?? 0) + (cur.ppe ?? 0)))}`,
        SGAI: `${yr(cur.sga, cur.revenue, Y)}; ${yr(prv.sga, prv.revenue, P)}`,
        LVGI: `${yr(cur.totalLiabilities, cur.assets, Y)}; ${yr(prv.totalLiabilities, prv.assets, P)}`,
        TATA: `${Y}: (${amt(cur.netIncome)} − ${amt(cur.ocf)}) ÷ ${amt(cur.assets)}`,
      }[k];
      return { calc: v.computed ? `${st} = ${n1(v.value, 3)} · × weight ${v.weight} → contribution ${n1(v.contribution, 3)} to the M-Score` : `Input not disclosed — neutral value ${n1(v.value, 3)} used · contribution ${n1(v.contribution, 3)}`, inputs: v.inputs, Y, P };
    }
    if (grp === "a") { const x = (f.altman.detail || []).find((z) => z.key === k); return x && { calc: `${Y}: ${amt(x.num)} ÷ ${amt(x.den)} = ${n1(x.ratio, 3)} · weight ${x.weight} → contribution ${n1(x.contribution, 3)}`, inputs: x.inputs, Y, P }; }
    return null;
  }
  function explain(key, anchor) {
    const e = EX[key]; if (!e) return;
    const live = liveFor(key);
    let pop = $e("fxPop");
    if (!pop) { pop = document.createElement("div"); pop.id = "fxPop"; pop.className = "fx-pop"; document.body.appendChild(pop); }
    const f = S.d && S.d.forensic;
    const inputs = live && live.inputs && live.inputs.length ? `<table class="fx-pop-t"><tr><th>Source input</th><th>${live.Y}</th>${live.inputs.some((x) => x.prev !== undefined) ? `<th>${live.P}</th>` : ""}</tr>${live.inputs.map((x) => `<tr><td>${esc(x.label)}</td><td>${amt(x.cur, x.unit)}</td>${live.inputs.some((y) => y.prev !== undefined) ? `<td>${x.prev === undefined ? "" : amt(x.prev, x.unit)}</td>` : ""}</tr>`).join("")}</table>` : "";
    pop.innerHTML = `<div class="fx-pop-h"><b>${esc(e[0])}</b><button type="button" class="fx-pop-x" aria-label="Close">✕</button></div>
      <div class="fx-pop-r"><span>Formula</span><code>${esc(e[1])}</code></div>
      <div class="fx-pop-r"><span>Purpose</span>${esc(e[2])}</div>
      <div class="fx-pop-r"><span>Interpretation</span>${esc(e[3])}</div>
      ${live ? `<div class="fx-pop-r"><span>M-Terminal calculation</span>${esc(live.calc)}</div>${inputs}` : ""}
      ${f ? `<div class="fx-pop-src">Source: ${esc(f.source)}${live ? ` ${live.Y}${live.P ? " and " + live.P : ""}.` : ""}</div>` : ""}`;
    pop.hidden = false; S.anchor = anchor; place();
  }
  // fixed to the viewport and re-placed on scroll, so it stays beside its ⓘ
  function place() {
    const pop = $e("fxPop"), a = S.anchor; if (!pop || pop.hidden || !a) return;
    const r = a.getBoundingClientRect();
    if (!a.isConnected || r.bottom < 0 || r.top > window.innerHeight) { pop.hidden = true; return; }
    const w = Math.min(420, window.innerWidth - 24);
    pop.style.width = w + "px";
    pop.style.left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left - w / 2)) + "px";
    const h = pop.offsetHeight;
    pop.style.top = (r.bottom + 8 + h > window.innerHeight ? Math.max(12, r.top - h - 8) : r.bottom + 8) + "px";
  }

  /* ═══════════ HEADER + SUB-TABS ═══════════ */
  function header() {
    const co = S.co; if (!co) return "";
    const ks = co.keyStats || {}, r = (nm) => (co.ratios.find((x) => x.name === nm) || {}).value;
    const cell = (k, v) => `<div class="ws-stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;
    return `<div class="ws-head fx-head">
      <div class="ws-id"><h2>${esc(co.name)}</h2><div class="ws-meta">${esc(co.symbol)} <i>·</i> ${esc(co.exchange || "")}${co.profile.sector ? ` <i>·</i> ${esc(co.profile.sector)}` : ""}${co.profile.industry ? ` › ${esc(co.profile.industry)}` : ""}</div>
        <div class="ws-actions"><button class="ws-watch mono" type="button" id="fxOpenReport">▤ View report</button><button class="ws-watch mono" type="button" id="fxOpenER">▤ Company Analysis</button></div></div>
      <div class="ws-quote fx-quote"><div><div class="ws-px">${F.px(co.price, co.currency)}</div><div class="ws-change ${F.cls(co.changePct)}">${(co.changePct >= 0 ? "+" : "") + F.pct(co.changePct, 2)}</div></div>${S.spark ? `<div class="fx-spark">${K().spark(S.spark, 130, 40)}</div>` : ""}</div>
      <div class="ws-stats fx-stats">${cell("MKT CAP", F.cap(ks.mcap, co.currency))}${cell("P/E (TTM)", r("P/E (TTM)") == null ? "—" : n1(r("P/E (TTM)")) + "×")}${cell("EV/EBITDA", r("EV / EBITDA") == null ? "—" : n1(r("EV / EBITDA")) + "×")}${cell("ROE", r("ROE") == null ? "—" : n1(r("ROE")) + "%")}${cell("DIV YIELD", r("Dividend yield") == null ? "—" : n1(r("Dividend yield")) + "%")}</div>
    </div>`;
  }
  const tabs = () => `<nav class="ws-tabs" role="tablist">${TABS_DEF.map(([k, l]) => `<button class="ws-tab${S.tab === k ? " on" : ""}" type="button" role="tab" data-fxtab="${k}">${l}</button>`).join("")}</nav>`;

  /* ═══════════ SHARED PIECES ═══════════ */
  function scoreCards(f) {
    const eqCol = { A: "good", B: "good", C: "mid", D: "bad" }[f.earningsQualityGrade];
    const pCol = f.piotroski.score >= 7 ? "good" : f.piotroski.score >= 4 ? "mid" : "bad";
    const zCol = f.altman.zone === "Safe" ? "good" : f.altman.zone === "Grey" ? "mid" : f.altman.zone === "Distress" ? "bad" : "mid";
    const mCol = f.beneish.score == null ? "mid" : f.beneish.score > -1.78 ? "bad" : f.beneish.score > -2.22 ? "mid" : "good";
    const card = (tab, label, key, val, pct, cap, col) => `<div class="fx-card ${col}" data-fxtab="${tab}"><div class="fx-card-k">${label} ${info(key)}</div><div class="fx-card-v">${val}</div><div class="fx-card-bar"><i style="width:${Math.max(4, Math.min(100, pct)).toFixed(0)}%"></i></div><div class="fx-card-c">${cap}</div><span class="fx-card-go">›</span></div>`;
    const zPct = f.altman.score == null ? 0 : Math.min(100, (f.altman.score / 6) * 100), mPct = f.beneish.score == null ? 0 : Math.min(100, Math.max(0, ((-f.beneish.score - 1) / 2.5) * 100));
    return `<div class="fx-cards">
      ${card("eq", "EARNINGS QUALITY", "m.eq", f.earningsQualityGrade, (f.eqPass / 5) * 100, { A: "Strong quality earnings with healthy cash backing", B: "Good quality with minor soft spots", C: "Mixed — several checks failed", D: "Weak — earnings poorly backed" }[f.earningsQualityGrade], eqCol)}
      ${card("piotroski", "PIOTROSKI F-SCORE", "p.F", `${f.piotroski.score}<small>/9</small>`, (f.piotroski.score / 9) * 100, `${f.piotroski.grade} fundamentals`, pCol)}
      ${card("altman", "ALTMAN Z-SCORE", "a.Z", f.altman.score == null ? "—" : n1(f.altman.score, 2), zPct, f.altman.zone === "n/a" ? "Not computable" : `${f.altman.zone} zone (${f.altman.zone === "Safe" ? "low" : f.altman.zone === "Grey" ? "moderate" : "high"} distress risk)`, zCol)}
      ${card("beneish", "BENEISH M-SCORE", "b.M", f.beneish.score == null ? "—" : n1(f.beneish.score, 2), mPct, f.beneish.flag, mCol)}
    </div>`;
  }
  // figures table: metric × latest four years
  function figuresTable(f, years) {
    const ys = f.figures.slice(-(years || 4));
    const rows = [["Revenue", "revenue"], ["Gross profit", "grossProfit"], ["EBIT", "ebit"], ["Net income", "netIncome"], ["Operating cash flow", "ocf"], ["Free cash flow", "fcf"], ["Capital expenditure", "capex"], ["Total assets", "assets"], ["Current assets", "currentAssets"], ["Current liabilities", "currentLiab"], ["Total liabilities", "totalLiabilities"], ["Long-term debt", "ltDebt"], ["Shareholders' equity", "equity"], ["Receivables", "receivables"], ["Inventory", "inventory"], ["Payables", "payables"]]
      .filter(([, k]) => ys.some((y) => y[k] != null));
    return tbl([`Metric (${UNIT})`, ...ys.map((y) => fy(y.year))], rows.map(([l, k]) => [`<b>${l}</b>`, ...ys.map((y) => U(y[k]))]));
  }
  function ratioRows(f) {
    const H = f.history;
    return [
      ["OCF / NI", "m.cashConv", H.map((h) => h.ocfNi), (v) => n1(v, 2) + "×"],
      ["FCF margin", "m.fcfMargin", H.map((h) => h.fcfMargin), (v) => n1(v) + "%"],
      ["Accrual ratio", "m.accrual", H.map((h) => h.accrual), (v) => n1(v) + "%"],
      ["Gross margin", "m.grossMargin", H.map((h) => h.grossMargin), (v) => n1(v) + "%"],
    ].filter((r) => r[2].some((v) => v != null));
  }
  const ratioTable = (f) => { const H = f.history; return tbl(["Metric", ...H.map((h) => fy(h.year)), "Trend"], ratioRows(f).map(([l, k, vals, fmt]) => [`<b>${l}</b> ${info(k)}`, ...vals.map((v) => (v == null ? "—" : `<span class="${k === "m.accrual" && v > 10 ? "down" : ""}">${fmt(v)}</span>`)), K().spark(vals, 64, 18)])); };
  function piotroskiTable(f, full) {
    const c = f.piotroski.components;
    return tbl(full ? ["#", "Test", "Formula", `${fy(f.years.current)} vs ${fy(f.years.prior)}`, "Inputs", "Result"] : ["#", "Test", "Calculation", "Pass"],
      c.map((x, i) => ({ cls: x.na ? "" : x.ok ? "" : "fx-fail", cells: full
        ? [String(i + 1), `<b>${esc(x.t)}</b> ${info("p." + x.key)}`, `<code>${esc(x.formula)}</code>`, esc(x.detail), x.inputs.map((y) => `${esc(y.label)}: ${amt(y.cur, y.unit)}${y.prev !== undefined ? ` <span class="ws-dim">(prior ${amt(y.prev, y.unit)})</span>` : ""}`).join("<br>"), pass(x.ok, x.na)]
        : [String(i + 1), `${esc(x.t)} ${info("p." + x.key)}`, `<span class="ws-dim">${esc(x.detail)}</span>`, pass(x.ok, x.na)] })));
  }
  function altmanTable(f, full) {
    const A = f.altman; if (!A.detail) return "";
    const rows = A.detail.map((x) => full
      ? [`<b>${x.key}</b> ${info("a." + x.key)}`, esc(x.label), `<code>${esc(x.formula)}</code>`, x.inputs.map((y) => `${esc(y.label)}: ${amt(y.cur)}`).join("<br>"), n1(x.ratio, 3), `${x.weight}×`, `<b>${n1(x.contribution, 2)}</b>`]
      : [`${esc(x.label)} ${info("a." + x.key)}`, `<span class="ws-dim">${esc(x.inputs.map((y) => y.label.replace(/ \(current\)/, "") + " " + amt(y.cur)).slice(0, 1).join(""))}</span>`, n1(x.ratio, 2), `${x.weight}×`, n1(x.contribution, 2)]);
    const tot = full ? [`<b>Z-Score</b> ${info("a.Z")}`, "Σ contributions", "", "", "", "", `<b>${n1(A.score, 2)}</b>`] : [`<b>Z-Score (Σ contributions)</b>`, "", "", "", `<b>${n1(A.score, 2)}</b>`];
    return tbl(full ? ["", "Component", "Formula", "Inputs", "Ratio", "Weight", "Contribution"] : ["Component", "Calculation (backup)", "Ratio", "Wt.", "Contrib."], [...rows, { cls: "fx-tot", cells: tot }], full ? "" : "fx-cmp");
  }
  function beneishTable(f, full) {
    const B = f.beneish;
    const read = (x) => (x.key === "TATA" ? (x.value > 0.05 ? badge("investigate", "down") : badge("normal", "up")) : x.value > 1.1 ? badge("above 1", "amb") : badge("≈ normal", "up"));
    const rows = B.detail.map((x) => full
      ? [`<b>${x.key}</b> ${info("b." + x.key)}`, esc(x.name), `<code>${esc(x.formula)}</code>`, x.inputs.map((y) => `${esc(y.label)}: ${amt(y.cur)} <span class="ws-dim">/ ${amt(y.prev)}</span>`).join("<br>"), `${n1(x.value, 3)}${x.computed ? "" : ` <span class="ws-dim">(neutral)</span>`}`, x.weight, `<b>${n1(x.contribution, 3)}</b>`, read(x)]
      : [`${x.key} ${info("b." + x.key)}`, n1(x.value, 2), `<span class="ws-dim">${esc(x.benchmark.split("·")[0])}</span>`, x.weight, n1(x.contribution, 2)]);
    const tot = full ? [`<b>M-Score</b> ${info("b.M")}`, "−4.84 + Σ contributions", "", "", "", "", `<b>${n1(B.score, 2)}</b>`, B.score > -1.78 ? badge("elevated risk", "down") : badge("low risk", "up")] : [`<b>M-Score (Σ)</b>`, "", "", "", `<b>${n1(B.score, 2)}</b>`];
    return tbl(full ? ["", "Index", "Formula", `Inputs (${fy(f.years.current)} / ${fy(f.years.prior)})`, "Value", "Weight", "Contribution", "Read"] : ["Variable", "Value", "Benchmark", "Wt.", "Contrib."], [...rows, { cls: "fx-tot", cells: tot }], full ? "" : "fx-cmp");
  }

  /* ═══════════ SUB-TAB PANES ═══════════ */
  function overview(f, d) {
    const flags = (d.flags || []).filter((x) => x.sev !== "low");
    const tk = [];
    if (f.cash.cashConversion != null) tk.push(f.cash.cashConversion >= 0.9 ? `Earnings are well supported by operating cash flow (${n1(f.cash.cashConversion, 2)}× OCF / NI).` : `Earnings run ahead of cash — ${n1(f.cash.cashConversion, 2)}× OCF / NI.`);
    if (f.cash.accrualRatio != null) tk.push(Math.abs(f.cash.accrualRatio) < 5 ? `Accrual levels are low (${n1(f.cash.accrualRatio)}% of assets), indicating high earnings quality.` : `Accruals are ${n1(f.cash.accrualRatio)}% of assets — a larger non-cash share of profit.`);
    if (f.altman.zone !== "n/a") tk.push(f.altman.zone === "Safe" ? "Balance sheet is strong — Altman Z sits well inside the safe zone." : `Altman Z is in the ${f.altman.zone.toLowerCase()} zone — watch solvency.`);
    tk.push(flags.length ? `${flags.length} red flag${flags.length > 1 ? "s" : ""} raised across the forensic screens.` : "No material red flags detected across forensic screens.");
    const fails = f.piotroski.components.filter((x) => !x.ok && !x.na).map((x) => x.t);
    const summary = `${esc(S.co ? S.co.name : "The company")} shows ${{ A: "strong", B: "good", C: "mixed", D: "weak" }[f.earningsQualityGrade]} earnings quality (grade ${f.earningsQualityGrade}) with ${f.cash.cashConversion != null && f.cash.cashConversion >= 0.9 ? "consistent cash generation" : "cash generation lagging profit"}. ${f.altman.score != null ? `The Altman Z-Score of ${n1(f.altman.score, 2)} indicates ${f.altman.zone === "Safe" ? "low" : f.altman.zone === "Grey" ? "moderate" : "high"} financial-distress risk, ` : ""}and a Beneish M-Score of ${n1(f.beneish.score, 2)} suggests ${f.beneish.score > -1.78 ? "an elevated" : "a low"} probability of earnings manipulation. The Piotroski F-Score of ${f.piotroski.score}/9 points to ${f.piotroski.grade.toLowerCase()} fundamental strength${fails.length ? `; tests not met this year: ${fails.slice(0, 3).join(", ")}` : ""}.`;
    const ys = f.figures.slice(-4);
    const cashChart = K().chart({ kind: "bars", h: 190, cats: ys.map((y) => fy(y.year)), fmt: (v) => `${n1(v, 0)} ${UNIT}`, label: "Revenue, net income, OCF and FCF", series: [["Revenue", "revenue", K().PAL.c2], ["Net income", "netIncome", K().PAL.up], ["Operating cash flow", "ocf", K().PAL.c1], ["Free cash flow", "fcf", K().PAL.c4]].map(([n, k, c]) => ({ name: n, color: c, values: ys.map((y) => (y[k] == null ? null : y[k] / SCALE)) })) });
    const qTbl = tbl(["Metric", fy(f.years.current), "Benchmark", "Interpretation"], [
      [`Cash conversion (OCF / NI) ${info("m.cashConv")}`, `<b>${n1(f.cash.cashConversion, 2)}×</b>`, "≥ 0.90×", f.cash.cashConversion >= 0.9 ? "Earnings well backed by cash" : "Profit ahead of cash"],
      [`FCF margin ${info("m.fcfMargin")}`, `<b>${n1(f.cash.fcfMargin)}%</b>`, "> 0%", f.cash.fcfMargin > 0 ? "Positive free cash generation" : "Cash-consuming year"],
      [`Accrual ratio ${info("m.accrual")}`, `<b>${n1(f.cash.accrualRatio)}%</b>`, "|x| < 10%", Math.abs(f.cash.accrualRatio) < 10 ? "Low accruals — clean earnings" : "Elevated accruals"],
    ].filter((r) => !/—/.test(r[1])), "fx-wrap");
    const H = f.history, lines = ratioRows(f).filter((r) => r[1] !== "m.cashConv");
    const trendChart = H.length >= 2 ? K().chart({ kind: "lines", h: 170, cats: H.map((h) => fy(h.year)), pct: true, fmt: (v) => n1(v) + "%", label: "Quality ratios", series: lines.map(([n, , vals], i2) => ({ name: n, color: [K().PAL.c2, K().PAL.c1, K().PAL.c4][i2], values: vals })) }) + K().legend(lines.map(([n], i2) => [n, [K().PAL.c2, K().PAL.c1, K().PAL.c4][i2]])) : "";
    return grid(
      `<div class="ws-cell" style="grid-column:span 12">${scoreCards(f)}</div>`,
      row([[panel("KEY TAKEAWAYS", `<ul class="ec-list fx-list">${tk.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`, { icon: "bolt" }), 4],
        [panel("RED FLAG SUMMARY", flags.length ? `<ul class="fx-flags">${flags.slice(0, 4).map((x) => `<li class="${x.sev}"><b>${esc(x.t)}</b></li>`).join("")}</ul><button class="ws-xref" type="button" data-fxtab="flags">All flags & notes →</button>` : `<div class="fx-clean"><b class="up">✓</b><div><b>No material red flags detected.</b><span>Beneish, Altman, cash-conversion, accrual and Piotroski screens are within normal ranges.</span></div></div>`, { icon: "flag" }), 4],
        [panel("FORENSIC SUMMARY", `<p class="fx-p">${summary}</p>`, { icon: "doc", sub: `${fy(f.years.current)} vs ${fy(f.years.prior)}` }), 4]]),
      row([[panel(`FINANCIAL FIGURES USED (${UNIT})`, figuresTable(f, 4), { icon: "grid", sub: "annual · consolidated" }), 4],
        [panel("EARNINGS QUALITY & CASH-FLOW QUALITY", cashChart + K().legend([["Revenue", K().PAL.c2], ["Net income", K().PAL.up], ["OCF", K().PAL.c1], ["FCF", K().PAL.c4]]) + qTbl, { icon: "bars" }), 4],
        [panel("QUALITY RATIOS TREND", trendChart + ratioTable(f), { icon: "chart" }), 4]]),
      row([[panel("PIOTROSKI F-SCORE", piotroskiTable(f, false), { icon: "target", tools: badge(`${f.piotroski.score}/9 (${f.piotroski.grade})`, f.piotroski.score >= 7 ? "up" : f.piotroski.score >= 4 ? "amb" : "down") }), 4],
        [f.altman.detail ? panel("ALTMAN Z-SCORE", altmanTable(f, false) + `<div class="ec-foot">&gt; 2.99 safe · 1.81–2.99 grey · &lt; 1.81 distress</div>`, { icon: "shield", tools: badge(`${n1(f.altman.score, 2)} (${f.altman.zone})`, f.altman.zone === "Safe" ? "up" : f.altman.zone === "Grey" ? "amb" : "down") }) : "", 4],
        [panel("BENEISH M-SCORE", beneishTable(f, false) + `<div class="ec-foot">&lt; −2.22 low risk · −2.22 to −1.78 grey · &gt; −1.78 high risk</div>`, { icon: "scale", tools: badge(`${n1(f.beneish.score, 2)} (${f.beneish.score > -1.78 ? "elevated" : "low risk"})`, f.beneish.score > -1.78 ? "down" : "up") }), 4]]));
  }
  function eqPane(f) {
    const H = f.history;
    const chk = `<div class="fx-grade"><div class="g ${{ A: "up", B: "up", C: "amb", D: "down" }[f.earningsQualityGrade]}">${f.earningsQualityGrade}</div><div><b>${f.eqPass} of 5 checks passed</b> ${info("m.eq")}<br><span class="ws-dim">A 4–5 · B 3 · C 2 · D 0–1</span></div></div>` + tbl(["Check", `Value (${fy(f.years.current)})`, "Result"], f.eqChecks.map((c) => [esc(c.label), `<b>${esc(c.value)}</b>`, pass(c.pass)]));
    const chart = H.length >= 2 ? K().chart({ kind: "bars", h: 210, cats: H.map((h) => fy(h.year)), pct: true, fmt: (v) => n1(v) + "%", label: "Accrual ratio by year", series: [{ name: "Accrual ratio", signColor: false, color: K().PAL.c1, values: H.map((h) => h.accrual) }] }) : "";
    const ys = f.figures.slice(-5);
    const niOcf = tbl(["Year", "Net income", "Operating cash flow", "OCF − NI", "OCF / NI", "Accrual ratio"], ys.map((y) => { const h = H.find((x) => x.year === y.year) || {}; return [fy(y.year), U(y.netIncome), U(y.ocf), `<span class="${(y.ocf ?? 0) - (y.netIncome ?? 0) >= 0 ? "up" : "down"}">${U(y.ocf != null && y.netIncome != null ? y.ocf - y.netIncome : null)}</span>`, h.ocfNi != null ? n1(h.ocfNi, 2) + "×" : "—", h.accrual != null ? n1(h.accrual) + "%" : "—"]; }));
    return grid(row([[panel("EARNINGS QUALITY GRADE", chk, { icon: "shield" }), 5], [panel(`ACCRUAL RATIO BY YEAR ${info("m.accrual")}`, chart + `<div class="ec-foot">(Net income − OCF) ÷ total assets · negative = cash exceeded profit</div>`, { icon: "bars" }), 7]]),
      row([[panel(`NET INCOME vs OPERATING CASH FLOW (${UNIT})`, niOcf, { icon: "grid" }), 12]]));
  }
  function cashPane(f) {
    const ys = f.figures.slice(-5);
    const chart = K().chart({ kind: "bars", h: 220, cats: ys.map((y) => fy(y.year)), fmt: (v) => `${n1(v, 0)} ${UNIT}`, label: "Operating cash flow, capex and FCF", series: [{ name: "Operating cash flow", color: K().PAL.c1, values: ys.map((y) => (y.ocf == null ? null : y.ocf / SCALE)) }, { name: "Capex", color: K().PAL.c3, values: ys.map((y) => (y.capex == null ? null : -y.capex / SCALE)) }, { name: "Free cash flow", color: K().PAL.c2, values: ys.map((y) => (y.fcf == null ? null : y.fcf / SCALE)) }] });
    const rows = [["OCF / Net income", "m.cashConv", (y) => (y.ocf != null && y.netIncome ? y.ocf / y.netIncome : null), (v) => n1(v, 2) + "×"], ["FCF / Net income", "m.fcfNi", (y) => (y.fcf != null && y.netIncome ? y.fcf / y.netIncome : null), (v) => n1(v, 2) + "×"], ["FCF margin", "m.fcfMargin", (y) => (y.fcf != null && y.revenue ? (y.fcf / y.revenue) * 100 : null), (v) => n1(v) + "%"], ["Capex / Revenue", "m.capexRev", (y) => (y.capex != null && y.revenue ? (y.capex / y.revenue) * 100 : null), (v) => n1(v) + "%"]];
    const t = tbl(["Metric", ...ys.map((y) => fy(y.year)), "Trend"], rows.filter(([, , fn]) => ys.some((y) => fn(y) != null)).map(([l, k, fn, fmt]) => [`<b>${l}</b> ${info(k)}`, ...ys.map((y) => (fn(y) == null ? "—" : fmt(fn(y)))), K().spark(ys.map(fn), 64, 18)]));
    return grid(row([[panel(`OPERATING CASH FLOW · CAPEX · FREE CASH FLOW (${UNIT})`, chart + K().legend([["Operating cash flow", K().PAL.c1], ["Capex", K().PAL.c3], ["Free cash flow", K().PAL.c2]]), { icon: "bars" }), 6], [panel("CASH-FLOW QUALITY RATIOS", t, { icon: "chart" }), 6]]));
  }
  function piotroskiPane(f) {
    const H = f.history;
    const chart = H.length >= 2 ? K().chart({ kind: "bars", h: 180, cats: H.map((h) => fy(h.year)), fmt: (v) => `${v}/9`, label: "Piotroski F-Score by year", series: [{ name: "F-Score", color: K().PAL.c1, values: H.map((h) => h.fScore) }] }) : "";
    return grid(row([[panel(`PIOTROSKI F-SCORE — ${fy(f.years.current)} vs ${fy(f.years.prior)}`, piotroskiTable(f, true), { icon: "target", tools: badge(`${f.piotroski.score}/9 · ${f.piotroski.grade}`, f.piotroski.score >= 7 ? "up" : f.piotroski.score >= 4 ? "amb" : "down") }), 8], [chart ? panel("F-SCORE HISTORY", chart + `<div class="ec-foot">7–9 strong · 4–6 moderate · 0–3 weak</div>`, { icon: "bars" }) : "", 4]]));
  }
  function altmanPane(f) {
    const A = f.altman; if (!A.detail) return grid(row([[panel("ALTMAN Z-SCORE", `<div class="ws-empty">Not computable — the balance sheet does not split current assets and liabilities (typical for banks, NBFCs and insurers), so X1 and the model cannot be formed. The original Z-Score is not designed for financial companies.</div>`, { icon: "shield" }), 12]]));
    const pos = Math.min(100, (Math.min(A.score, 6) / 6) * 100);
    const gauge = `<div class="fx-gauge"><div class="fx-gauge-t"><i class="d" style="width:${(1.81 / 6) * 100}%"></i><i class="g" style="width:${((2.99 - 1.81) / 6) * 100}%"></i><i class="s"></i><b style="left:${pos}%"></b></div><div class="fx-gauge-a"><span>0</span><span style="left:${(1.81 / 6) * 100}%">1.81</span><span style="left:${(2.99 / 6) * 100}%">2.99</span><span style="right:0">6+</span></div></div>`;
    const x4 = A.detail.find((x) => x.key === "X4"), dom = x4 && A.score ? x4.contribution / A.score : 0;
    return grid(row([[panel(`ALTMAN Z-SCORE — ${fy(f.years.current)}`, altmanTable(f, true), { icon: "shield", tools: badge(`${n1(A.score, 2)} · ${A.zone}`, A.zone === "Safe" ? "up" : A.zone === "Grey" ? "amb" : "down") }), 8],
      [panel("ZONE", `<div class="fx-big">${n1(A.score, 2)}</div>${gauge}<ul class="ec-list sm"><li>Distress below 1.81 · grey 1.81–2.99 · safe above 2.99.</li>${dom > 0.5 ? `<li>${Math.round(dom * 100)}% of the score comes from X4 (market value ÷ liabilities) — the result leans on the current valuation.</li>` : ""}<li>X4 uses today's market capitalisation; the other ratios use ${fy(f.years.current)} statements.</li><li>The original model was built for manufacturers — read with care for banks, insurers and asset-light services.</li></ul>`, { icon: "target" }), 4]]));
  }
  function beneishPane(f) {
    const B = f.beneish, H = f.history;
    const chart = H.length >= 2 ? K().chart({ kind: "lines", h: 180, cats: H.map((h) => fy(h.year)), fmt: (v) => n1(v, 2), label: "Beneish M-Score by year", series: [{ name: "M-Score", color: K().PAL.c4, values: H.map((h) => h.mScore) }, { name: "Threshold −1.78", color: K().PAL.down, dash: true, values: H.map(() => -1.78) }] }) : "";
    return grid(row([[panel(`BENEISH M-SCORE — ${fy(f.years.current)} vs ${fy(f.years.prior)}`, beneishTable(f, true), { icon: "scale", tools: badge(`${n1(B.score, 2)} · ${B.score > -1.78 ? "elevated risk" : "low risk"}`, B.score > -1.78 ? "down" : "up") }), 8],
      [chart ? panel("M-SCORE HISTORY", chart + K().legend([["M-Score", K().PAL.c4], ["Threshold −1.78", K().PAL.down, true]]) + `<div class="ec-foot">Above −1.78 resembles later restaters; a screen, not proof.</div>`, { icon: "chart" }) : "", 4]]));
  }
  function wcPane(f) {
    const H = f.history;
    const rows = [["Receivable days", "m.recvDays", "recvDays", (v) => n1(v, 0)], ["Inventory days", "m.invDays", "invDays", (v) => n1(v, 0)], ["Payable days", "m.payDays", "payDays", (v) => n1(v, 0)], ["Cash conversion cycle", "m.ccc", "ccc", (v) => n1(v, 0)], ["Current ratio", "m.currentRatio", "currentRatio", (v) => n1(v, 2) + "×"], ["Working capital / assets", "m.wcTa", "wcTa", (v) => n1(v) + "%"]].filter(([, , k]) => H.some((h) => h[k] != null));
    if (!rows.length) return "";
    const days = rows.filter(([, , k]) => /Days|ccc/i.test(k));
    const chart = days.length && H.length >= 2 ? K().chart({ kind: "lines", h: 200, cats: H.map((h) => fy(h.year)), fmt: (v) => `${n1(v, 0)} days`, label: "Working-capital days", series: days.map(([n, , k], i2) => ({ name: n, color: [K().PAL.c1, K().PAL.c2, K().PAL.c3, K().PAL.c4][i2], values: H.map((h) => h[k]) })) }) + K().legend(days.map(([n], i2) => [n, [K().PAL.c1, K().PAL.c2, K().PAL.c3, K().PAL.c4][i2]])) : "";
    return grid(row([[panel("WORKING-CAPITAL METRICS", tbl(["Metric", ...H.map((h) => fy(h.year)), "Trend"], rows.map(([l, k, key, fmt]) => [`<b>${l}</b> ${info(k)}`, ...H.map((h) => (h[key] == null ? "—" : fmt(h[key]))), K().spark(H.map((h) => h[key]), 64, 18)])), { icon: "grid" }), 7], [chart ? panel("DAYS TREND", chart, { icon: "chart" }) : "", 5]]));
  }
  function flagsPane(f, d) {
    const sev = (s) => (s === "high" ? badge("High", "down") : s === "med" ? badge("Medium", "amb") : badge("Low"));
    const flags = d.flags || [];
    const notes = [...(f.notes || []), ...(f.altman.zone === "n/a" ? ["Altman Z-Score not computed: current assets / liabilities are not reported separately (typical for financial companies). The Altman earnings-quality check therefore counts as not met."] : []), ...f.piotroski.components.filter((x) => x.na).map((x) => `Piotroski "${x.t}" could not be tested (input not disclosed) — scored as not met.`)];
    return grid(row([[panel("RED FLAGS", tbl(["Severity", "Finding", "Why it matters"], flags.map((x) => [sev(x.sev), `<b>${esc(x.t)}</b>`, esc(x.why)])), { icon: "flag", sub: `${flags.filter((x) => x.sev !== "low").length} material` }), 8],
      [panel("DATA NOTES & MODEL CAVEATS", `<ul class="ec-list sm">${[...notes, "Figures are annual and consolidated as reported by the market-data provider; restated years follow the latest filing.", "Altman's X4 uses the latest market capitalisation for the latest year only — historical Z-Scores are not shown.", "Beneish and Piotroski compare the latest fiscal year with the one before."].map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`, { icon: "doc" }), 4]]));
  }
  function historyPane(f) {
    const H = f.history; if (H.length < 2) return grid(row([[panel("HISTORICAL TREND", `<div class="ws-empty">At least three years of statements are needed for a trend.</div>`, { icon: "chart" }), 12]]));
    const rows = [["Piotroski F-Score", "p.F", "fScore", (v) => `${v}/9`], ["Beneish M-Score", "b.M", "mScore", (v) => n1(v, 2)], ["OCF / NI", "m.cashConv", "ocfNi", (v) => n1(v, 2) + "×"], ["FCF margin", "m.fcfMargin", "fcfMargin", (v) => n1(v) + "%"], ["Accrual ratio", "m.accrual", "accrual", (v) => n1(v) + "%"], ["Gross margin", "m.grossMargin", "grossMargin", (v) => n1(v) + "%"], ["Receivable days", "m.recvDays", "recvDays", (v) => n1(v, 0)], ["Inventory days", "m.invDays", "invDays", (v) => n1(v, 0)], ["Current ratio", "m.currentRatio", "currentRatio", (v) => n1(v, 2) + "×"]].filter(([, , k]) => H.some((h) => h[k] != null));
    const fChart = K().chart({ kind: "bars", h: 180, cats: H.map((h) => fy(h.year)), fmt: (v) => `${v}/9`, label: "F-Score", series: [{ name: "F-Score", color: K().PAL.c1, values: H.map((h) => h.fScore) }] });
    const mChart = K().chart({ kind: "lines", h: 180, cats: H.map((h) => fy(h.year)), fmt: (v) => n1(v, 2), label: "M-Score", series: [{ name: "M-Score", color: K().PAL.c4, values: H.map((h) => h.mScore) }, { name: "Threshold", color: K().PAL.down, dash: true, values: H.map(() => -1.78) }] });
    return grid(row([[panel("FORENSIC METRICS BY YEAR", tbl(["Metric", ...H.map((h) => fy(h.year)), "Trend"], rows.map(([l, k, key, fmt]) => [`<b>${l}</b> ${info(k)}`, ...H.map((h) => (h[key] == null ? "—" : fmt(h[key]))), K().spark(H.map((h) => h[key]), 64, 18)])), { icon: "grid", sub: "each year vs the one before" }), 12]]),
      row([[panel("PIOTROSKI F-SCORE", fChart, { icon: "bars" }), 6], [panel("BENEISH M-SCORE vs −1.78", mChart + K().legend([["M-Score", K().PAL.c4], ["Threshold −1.78", K().PAL.down, true]]), { icon: "chart" }), 6]]));
  }
  function methodPane() {
    const r = (key, cells) => [...cells.slice(0, 1).map((c) => `<b>${c}</b> ${info(key)}`), ...cells.slice(1)];
    const gen = tbl(["Metric / Formula", "Definition", "Calculation", "What it measures", "How to interpret"], [
      r("m.cashConv", ["Cash Conversion", "Operating cash generated relative to reported profit", "<code>OCF ÷ Net income</code>", "Whether accounting profit is supported by cash", ">1.0× generally means OCF exceeds NI"]),
      r("m.fcfMargin", ["FCF Margin", "Free cash flow generated from revenue", "<code>FCF ÷ Revenue</code>", "Cash generation after capital expenditure", "Higher generally indicates stronger cash generation"]),
      r("m.accrual", ["Accrual Ratio", "Extent to which earnings differ from operating cash generation", "<code>(NI − OCF) ÷ Total assets</code>", "Potential accrual dependence in earnings", "Higher positive values can indicate weaker cash backing"]),
      r("m.wcTa", ["Working Capital / Assets", "Working capital relative to asset base", "<code>Working capital ÷ Total assets</code>", "Liquidity structure", "Higher / lower needs business-context interpretation"]),
      r("m.recvDays", ["Receivable Days", "Average time taken to collect customer receivables", "<code>Receivables ÷ Revenue × 365</code>", "Collection efficiency", "Rising days can indicate slower collections"]),
      r("m.invDays", ["Inventory Days", "Average inventory holding period", "<code>Inventory ÷ COGS × 365</code>", "Inventory efficiency", "Rising days can indicate slower inventory movement"]),
      r("m.currentRatio", ["Current Ratio", "Current assets available against current liabilities", "<code>Current assets ÷ Current liabilities</code>", "Short-term liquidity", "Higher generally means greater current-asset coverage"]),
    ]);
    const pio = tbl(["Component", "Formula", "What it captures"], [["ni", "Positive net income", "NI > 0", "Basic profitability"], ["ocf", "Positive OCF", "OCF > 0", "Operating cash generation"], ["roa", "ROA improvement", "Current ROA > Prior ROA", "Improving asset profitability"], ["accr", "OCF > NI", "OCF > NI", "Earnings backed by cash"], ["lev", "Lower leverage", "Current LT debt ÷ Assets < Prior", "Improving balance-sheet leverage"], ["cr", "Higher current ratio", "Current ratio > Prior", "Improving liquidity"], ["dil", "No dilution", "Current shares ≤ Prior shares", "Shareholder dilution"], ["gm", "Gross-margin improvement", "Current GM > Prior GM", "Improving profitability"], ["at", "Asset-turnover improvement", "Current asset turnover > Prior", "Improving asset efficiency"]].map(([k, c, fm, w]) => [`<b>${c}</b> ${info("p." + k)}`, `<code>${fm}</code>`, w]));
    const ben = tbl(["Beneish variable", "Formula", "What it captures", "Direction to investigate"], [["DSRI", "Current (Receivables ÷ Revenue) ÷ Prior (Receivables ÷ Revenue)", "Receivables growth relative to sales", ">1 can indicate receivables rising faster"], ["GMI", "Prior gross margin ÷ Current gross margin", "Gross-margin deterioration", ">1 indicates deterioration"], ["AQI", "[1 − (CA + PPE) ÷ TA] current ÷ prior", "Asset-quality change", ">1 can indicate increasing softer assets"], ["SGI", "Current revenue ÷ Prior revenue", "Sales growth", "High growth can increase pressure to manage earnings"], ["DEPI", "Prior depreciation rate ÷ Current depreciation rate", "Depreciation-policy change", ">1 may indicate slower depreciation"], ["SGAI", "Current SG&A/Sales ÷ Prior SG&A/Sales", "SG&A intensity", ">1 indicates increasing SG&A burden"], ["LVGI", "Current leverage ratio ÷ Prior leverage ratio", "Leverage change", ">1 indicates rising leverage"], ["TATA", "(NI − OCF) ÷ Total assets", "Accrual component", "Higher positive value warrants investigation"]].map(([k, fm, w, d]) => [`<b>${k}</b> ${info("b." + k)}`, `<code>${fm}</code>`, w, d]).concat([[`<b>M-Score</b> ${info("b.M")}`, `<code>−4.84 + 0.920·DSRI + 0.528·GMI + 0.404·AQI + 0.892·SGI + 0.115·DEPI − 0.172·SGAI + 4.679·TATA − 0.327·LVGI</code>`, "Composite manipulation screen", "> −1.78 elevated · < −2.22 low"]]));
    const alt = tbl(["Component", "Formula", "What it represents", "Weight"], [["X1", "Working capital ÷ Total assets", "Liquidity", "1.2"], ["X2", "Retained earnings ÷ Total assets", "Cumulative profitability / maturity", "1.4"], ["X3", "EBIT ÷ Total assets", "Operating profitability", "3.3"], ["X4", "Market value of equity ÷ Total liabilities", "Capital structure / solvency cushion", "0.6"], ["X5", "Sales ÷ Total assets", "Asset turnover", "1.0"]].map(([k, fm, w, wt]) => [`<b>${k}</b> ${info("a." + k)}`, `<code>${fm}</code>`, w, wt]).concat([[`<b>Z-Score</b> ${info("a.Z")}`, `<code>1.2·X1 + 1.4·X2 + 3.3·X3 + 0.6·X4 + 1.0·X5</code>`, "Composite financial-distress indicator", "> 2.99 safe · < 1.81 distress"]]));
    return grid(row([[panel("GENERAL METRICS", gen, { icon: "doc", sub: "click ⓘ for the live calculation and source figures" }), 12]]),
      row([[panel("PIOTROSKI F-SCORE — NINE TESTS", pio, { icon: "target", sub: "one point each · latest year vs prior" }), 6], [panel("ALTMAN Z-SCORE — COMPONENTS", alt, { icon: "shield", sub: "original public-manufacturer model" }), 6]]),
      row([[panel("BENEISH M-SCORE — EIGHT VARIABLES", ben, { icon: "scale", sub: "Beneish (1999)" }), 12]]),
      `<div class="ws-foot">Every ⓘ shows the formula, its purpose and interpretation, M-Terminal's calculation for this company and the exact statement figures used. Source: ${esc((S.d && S.d.forensic && S.d.forensic.source) || "annual financial statements")}.</div>`);
  }

  /* ═══════════ PAINT ═══════════ */
  function body() {
    if (!S.d) return "";
    const f = S.d.forensic;
    if (!f) return `<div class="ws-empty">At least two years of financial statements are needed to run the forensic models for ${esc(S.sym)}.</div>`;
    return { overview, eq: eqPane, cash: cashPane, piotroski: piotroskiPane, altman: altmanPane, beneish: beneishPane, wc: wcPane, flags: flagsPane, history: historyPane, method: methodPane }[S.tab](f, S.d) || "";
  }
  function paint() {
    const root = $e("fxRoot"); if (!root) return;
    $e("fxHead").innerHTML = header() + (S.d ? tabs() : "");
    $e("fxBody").innerHTML = body();
    K().drawCharts(root); K().wireTips(root);
  }
  async function run(sym) {
    sym = String(sym || "").trim().toUpperCase(); if (!sym) return;
    const tok = ++S.tok;
    Object.assign(S, { sym, co: null, d: null, spark: null });
    $e("fxStatus").innerHTML = `<span class="rg-spin"></span> running Piotroski · Altman · Beneish · cash quality…`;
    const [co, d, hist] = await Promise.all([
      api(`/api/company/${encodeURIComponent(sym)}`).catch(() => null),
      api(`/api/forensic/${encodeURIComponent(sym)}`).catch((e) => ({ error: e.message })),
      api(`/api/history/${encodeURIComponent(sym)}?range=1y&interval=1wk`).catch(() => null),
    ]);
    if (tok !== S.tok) return;
    if (!d || d.error) { $e("fxStatus").innerHTML = `<span class="down">${esc((d && (d.detail || d.error)) || "Forensic scan failed")}</span>`; return; }
    Object.assign(S, { co: co && !co.error ? co : null, d, spark: hist && Array.isArray(hist.points) ? hist.points.map((p) => p.c ?? p.close) : hist && Array.isArray(hist.closes) ? hist.closes : null });
    setCcy((co && co.currency) || d.meta.currency);
    $e("fxStatus").innerHTML = d.forensic ? `<span class="up">${esc(d.meta.name)}</span> · ${esc(d.forensic.years.label)} · ${esc(d.meta.currency)}` : "insufficient history";
    paint();
  }
  function init() {
    const load = () => run($e("fxSym").value);
    $e("fxLoad").addEventListener("click", load);
    $e("fxSym").addEventListener("keydown", (e) => { if (e.key === "Enter") load(); });
    const root = $e("fxRoot");
    root.addEventListener("click", (e) => {
      const i = e.target.closest(".fx-i"); if (i) { e.stopPropagation(); explain(i.dataset.fx, i); return; }
      const t = e.target.closest("[data-fxtab]"); if (t) { S.tab = t.dataset.fxtab; paint(); const h = $e("fxHead"); if (h) h.scrollIntoView({ block: "start", behavior: "smooth" }); return; }
      if (e.target.closest("#fxOpenReport") && S.sym) { showTab("reports"); const x = document.getElementById("reportSymbol"); if (x) x.value = S.sym; return; }
      if (e.target.closest("#fxOpenER") && S.sym) { showTab("research"); if (typeof loadCompany === "function") loadCompany(S.sym); }
    });
    document.addEventListener("click", (e) => { const p = $e("fxPop"); if (p && !p.hidden && (e.target.closest(".fx-pop-x") || !e.target.closest("#fxPop"))) p.hidden = true; });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") { const p = $e("fxPop"); if (p) p.hidden = true; } });
    // keep the popover beside its ⓘ while any scroller moves
    document.addEventListener("scroll", (e) => { const p = $e("fxPop"); if (p && !(e.target instanceof Node && p.contains(e.target))) place(); }, true);
    let rt = null; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (!$e("tab-forensic").hidden) K().drawCharts(root); }, 150); });
    syncContext();
  }
  function syncContext() {
    const cur = typeof CURRENT !== "undefined" && CURRENT && CURRENT.symbol;
    if (cur && cur !== S.sym) { $e("fxSym").value = cur; run(cur); }
  }
  return { init, syncContext, run, loaded: false, get state() { return S; } };
})();
