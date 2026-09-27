/**
 * DCF assumption engine — the self-built default plan behind the Modeling Lab.
 *
 * Every forecast driver is built year by year (10-year horizon: five explicit
 * years, then a five-year fade to the terminal state) from market evidence,
 * the company's own history and its peers, then adjusted for earnings quality,
 * moat and distress signals. Each driver returns:
 *
 *   path[]        — the value used for Y1 … Y10
 *   build[]       — the components, their weights and sources
 *   adjustments[] — every adjustment factor applied, its effect and why
 *   rationale     — a plain-English explanation of the default
 *
 * Conventions follow sell-side practice: consensus-anchored near years,
 * mean-reverting margins, capex tied to the reinvestment that terminal growth
 * requires (g = reinvestment rate × return on new capital), tax converging to
 * the statutory rate, CAPM with a regression beta (Blume-adjusted, blended with
 * peers), a synthetic-rating cost of debt, market-value weights and a terminal
 * growth rate capped by the risk-free rate. Pure and deterministic.
 */

const HORIZON = 10;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const r1 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 10) / 10);
const r2 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 100) / 100);
const fin = (x) => x != null && isFinite(x);
const avg = (a) => { const v = a.filter(fin); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const median = (a) => { const v = a.filter(fin).sort((x, y) => x - y); return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null; };
const lerp = (a, b, t) => a + (b - a) * t;
const pct = (x, dp = 1) => (fin(x) ? `${x >= 0 ? "" : "−"}${Math.abs(x).toFixed(dp)}%` : "—");
const pp = (x, dp = 1) => (fin(x) ? `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(dp)}pp` : "—");

/* ── market conventions (M-Terminal house assumptions — each shown in the table) ── */
/* erp: the premium over the LOCAL 10-year government yield. That yield already carries the
   sovereign default spread, so only the country risk in excess of it is added to the
   mature-market premium (~4.3%) — adding the full country premium would count it twice.
   nomGDP: long-run nominal GDP growth — the rate a durable franchise can sustain through the
   fade period; gT: the perpetuity rate (below nominal GDP and the risk-free rate). */
const MARKET = {
  IN: { rfFallback: 6.6, erp: 5.25, erpWhy: "mature-market premium ≈4.3% + India's country risk net of the default spread already in the G-sec yield ≈0.95%", statTax: 25.17, gT: 5.0, nomGDP: 10.0, idx: "NIFTY 50", label: "India" },
  US: { rfFallback: 4.3, erp: 4.3, erpWhy: "mature-market premium, in line with the implied premium Damodaran publishes for the S&P 500", statTax: 25.0, gT: 2.5, nomGDP: 4.5, idx: "S&P 500", label: "United States" },
  GB: { rfFallback: 4.5, erp: 4.8, erpWhy: "mature-market premium + a small country premium", statTax: 25.0, gT: 2.0, nomGDP: 4.0, idx: "FTSE 100", label: "United Kingdom" },
  EU: { rfFallback: 2.6, erp: 5.0, erpWhy: "mature-market premium + a small country premium", statTax: 25.0, gT: 2.0, nomGDP: 3.5, idx: "Euro Stoxx", label: "Euro area" },
  JP: { rfFallback: 1.5, erp: 5.0, erpWhy: "mature-market premium + a small country premium", statTax: 30.0, gT: 1.0, nomGDP: 2.5, idx: "Nikkei 225", label: "Japan" },
  EM: { rfFallback: 6.5, erp: 5.75, erpWhy: "mature-market premium + country risk net of the default spread in the local yield", statTax: 25.0, gT: 4.0, nomGDP: 7.0, idx: "local index", label: "Emerging market" },
  DM: { rfFallback: 3.5, erp: 4.8, erpWhy: "mature-market premium + a small country premium", statTax: 25.0, gT: 2.0, nomGDP: 3.5, idx: "local index", label: "Developed market" },
};
function marketOf(currency, exchange) {
  if (currency === "INR" || /NSE|BSE/i.test(exchange || "")) return "IN";
  if (currency === "USD") return "US";
  if (currency === "GBP" || currency === "GBp") return "GB";
  if (currency === "EUR") return "EU";
  if (currency === "JPY") return "JP";
  if (["CHF", "CAD", "AUD", "SEK", "NOK", "DKK", "NZD", "SGD", "HKD"].includes(currency)) return "DM";
  return "EM";
}

/* Synthetic credit rating from interest coverage (the Damodaran method for
   large non-financial firms). Spreads are M-Terminal's rounded house values. */
const RATINGS = [
  [8.5, "AAA", 0.6], [6.5, "AA", 0.8], [5.5, "A+", 1.0], [4.25, "A", 1.1], [3.0, "A−", 1.3],
  [2.5, "BBB", 1.6], [2.25, "BB+", 2.0], [2.0, "BB", 2.4], [1.75, "B+", 3.5], [1.5, "B", 4.0],
  [1.25, "B−", 5.0], [0.8, "CCC", 8.0], [-Infinity, "D", 12.0],
];
const syntheticRating = (cov) => RATINGS.find(([min]) => cov >= min);

function mk(key, label, unit = "%") { return { key, label, unit, path: [], build: [], adjustments: [], rationale: "", confidence: "Medium", hist: null, latest: null }; }
const src = (label, value, weight, source) => ({ label, value: r2(value), weight, source });
const adj = (label, delta, effect, why) => ({ label, delta: r2(delta), effect, why });

/**
 * @param i.st          normalised statements { income, balance, cashflow } (oldest → newest)
 * @param i.currency    listing currency; i.exchange
 * @param i.price, i.sharesOut, i.netDebt, i.totalDebt
 * @param i.consensus   { forward:[{period, endDate, revenueAvg, growthPct, numAnalysts}] } | null
 * @param i.peers       [{ revGrowth, netMargin, evEbitda, pe, beta }] (peers only)
 * @param i.forensic    forensicScores() result | null
 * @param i.moat        moatAssessment() result | null
 * @param i.rf          { value, source, asOf } | null — live 10-year sovereign yield
 * @param i.beta        { raw, source, n, index } | null — regression beta vs the local index
 * @param i.peerBetas   [raw regression betas of peers]
 * @param i.usdPerUnit  USD value of one unit of the listing currency (size premium) | null
 * @param i.sector
 */
function buildPlan(i) {
  const st = i.st || { income: [], balance: [], cashflow: [] };
  const inc = st.income || [], bal = st.balance || [], cf = st.cashflow || [];
  const li = inc.at(-1) || {}, lb = bal.at(-1) || {};
  const baseRev = li.revenue, baseYear = li.year || new Date().getFullYear();
  if (!baseRev) return null;
  const M = MARKET[marketOf(i.currency, i.exchange)];
  const mkKey = marketOf(i.currency, i.exchange);
  const peers = i.peers || [];
  const f = i.forensic || {};
  const eq = f.earningsQualityGrade || null;
  const moat = (i.moat && i.moat.overall) || null;
  const years = Array.from({ length: HORIZON }, (_, k) => baseYear + k + 1);
  const notes = [];
  const warnings = [];
  const isLender = /financial/i.test(i.sector || "") && /bank|insur|credit|mortgage|lend|financ|thrift/i.test(i.industry || i.sector || "");
  if (/utilit/i.test(i.sector || "")) warnings.push("Regulated utility: returns are set on regulated equity and heavy capex builds the future rate base, so an FCFF DCF on today's cash flows understates value during a capex cycle — cross-check with P/B against the regulated return on equity.");
  if (/conglomerate/i.test(i.industry || "") || ["RELIANCE", "ADANIENT", "ITC", "GRASIM", "LT"].includes(String(i.symbol || "").replace(/\..*$/, ""))) warnings.push("Multi-business group: a single consolidated FCFF blends businesses with very different growth, returns and capital needs — sum-of-the-parts is the better primary method; read this DCF as a consolidated cross-check.");
  if (/basic materials|energy/i.test(i.sector || "") && /steel|metal|aluminum|copper|mining|oil|gas|coal|chemical/i.test(i.industry || i.sector || "")) warnings.push("Commodity cyclical: margins swing with the cycle; this DCF mean-reverts margins to their multi-year average — cross-check against mid-cycle EV/EBITDA.");
  if (isLender) warnings.push("A free-cash-flow (FCFF) DCF is not meaningful for banks, insurers and lenders — interest and deposits are their operating business, not financing, and revenue / EBITDA / capex have no economic meaning. Value this company on book value, residual income and P/B (the valuation methods below).");

  /* ─────────────────────────── historical series ─────────────────────────── */
  const last = (arr, n = 4) => arr.slice(-n);
  const revs = inc.map((r) => r.revenue).filter(fin);
  const yoy = []; for (let k = 1; k < inc.length; k++) if (inc[k - 1].revenue && inc[k].revenue) yoy.push((inc[k].revenue / inc[k - 1].revenue - 1) * 100);
  const lastRevs = last(revs, 5);
  const histCagr = lastRevs.length >= 2 && lastRevs[0] > 0 && lastRevs.at(-1) > 0 ? (Math.pow(lastRevs.at(-1) / lastRevs[0], 1 / (lastRevs.length - 1)) - 1) * 100 : null;
  const ebitdaOf = (r) => (fin(r.ebitda) ? r.ebitda : fin(r.opIncome) ? r.opIncome : null);
  const margins = inc.map((r) => (r.revenue && fin(ebitdaOf(r)) ? (ebitdaOf(r) / r.revenue) * 100 : null));
  const depPcts = cf.map((c, k) => (c.dep && inc[k] && inc[k].revenue ? (Math.abs(c.dep) / inc[k].revenue) * 100 : null));
  const capexPcts = cf.map((c, k) => (c.capex && inc[k] && inc[k].revenue ? (Math.abs(c.capex) / inc[k].revenue) * 100 : null));
  const taxes = inc.map((r) => (r.pretax > 0 && fin(r.tax) ? clamp((r.tax / r.pretax) * 100, 0, 60) : null));
  const nwcPcts = bal.map((b, k) => { const rv = inc[k] && inc[k].revenue; const n = (b.receivables || 0) + (b.inventory || 0) - (b.payables || 0); return rv && (b.receivables || b.inventory || b.payables) ? (n / rv) * 100 : null; });
  const dso = bal.map((b, k) => (b.receivables && inc[k] && inc[k].revenue ? (b.receivables / inc[k].revenue) * 365 : null));
  const hstat = (arr) => { const v = last(arr).filter(fin); return v.length ? { avg: r2(avg(v)), min: r2(Math.min(...v)), max: r2(Math.max(...v)), n: v.length, latest: r2(v.at(-1)) } : null; };

  /* ─────────────────────────── cost of capital ─────────────────────────── */
  const wacc = { key: "wacc", label: "WACC", build: [], adjustments: [] };
  const rf = i.rf && fin(i.rf.value) ? { value: i.rf.value, source: i.rf.source, asOf: i.rf.asOf, live: true } : { value: M.rfFallback, source: `${M.label} 10-year government bond — house fallback (live yield unavailable)`, live: false };
  const blume = (b) => 0.67 * b + 0.33;
  const ownRaw = i.beta && fin(i.beta.raw) ? i.beta.raw : null;
  const peerBl = (i.peerBetas || []).filter(fin).map(blume);
  const peerMed = peerBl.length >= 3 ? median(peerBl) : null;
  let betaUsed, betaWhy;
  if (ownRaw != null && peerMed != null) { betaUsed = 0.5 * blume(ownRaw) + 0.5 * peerMed; betaWhy = `50% own regression beta (Blume-adjusted ${blume(ownRaw).toFixed(2)}) + 50% peer median (${peerMed.toFixed(2)}, ${peerBl.length} peers)`; }
  else if (ownRaw != null) { betaUsed = blume(ownRaw); betaWhy = `own regression beta ${ownRaw.toFixed(2)}, Blume-adjusted (0.67 × raw + 0.33) to ${betaUsed.toFixed(2)}`; }
  else if (peerMed != null) { betaUsed = peerMed; betaWhy = `peer median Blume-adjusted beta (${peerBl.length} peers) — own price history too short`; }
  else { betaUsed = 1.0; betaWhy = "market beta of 1.0 — no usable price history for the company or its peers"; }
  const betaRaw = betaUsed;
  betaUsed = clamp(betaUsed, 0.6, 2.0);
  if (betaUsed !== betaRaw) wacc.adjustments.push(adj("Beta floor / cap", betaUsed - betaRaw, `β ${betaRaw.toFixed(2)} → ${betaUsed.toFixed(2)}`, "Beta is bounded to 0.6–2.0: a listed equity carries at least 60% of market risk over a full cycle; very low measured betas usually reflect thin correlation, not low risk."));

  // company-specific risk premium — the adjustment factors on the cost of equity
  let prem = 0;
  const addPrem = (label, d, why) => { if (!d) return; prem += d; wacc.adjustments.push(adj(label, d, `${pp(d, 2)} cost of equity`, why)); };
  if (eq === "B") addPrem("Earnings quality grade B", 0.25, "Most forensic checks pass but not all — a small premium for weaker cash backing of profits.");
  if (eq === "C") addPrem("Earnings quality grade C", 0.75, "Several forensic checks fail (cash conversion / accruals / Piotroski) — reported profit is a less reliable base for cash flows.");
  if (eq === "D") addPrem("Earnings quality grade D", 1.5, "Most forensic checks fail — profits are poorly backed by cash; forecasts built on them deserve a higher return hurdle.");
  if (f.beneish && fin(f.beneish.score) && f.beneish.score > -1.78) addPrem("Beneish M-Score above −1.78", 0.5, `M-Score ${f.beneish.score.toFixed(2)} resembles companies that later restated — accounting risk premium.`);
  const altmanFits = !/utilit|financial|real estate/i.test(i.sector || "") && !/conglomerate|bank|insur/i.test(i.industry || "");
  if (!altmanFits && f.altman && f.altman.zone && f.altman.zone !== "Safe") wacc.adjustments.push(adj("Altman Z not applied", 0, "no premium", `Altman's Z-Score was built for manufacturers; for a ${(i.sector || "company").toLowerCase()} business its ${f.altman.zone.toLowerCase()} reading reflects the capital structure of the industry, not distress.`));
  if (altmanFits && f.altman && f.altman.zone === "Distress") addPrem("Altman Z in distress zone", 1.0, `Z-Score ${fin(f.altman.score) ? f.altman.score.toFixed(2) : ""} — elevated financial-distress risk.`);
  else if (altmanFits && f.altman && f.altman.zone === "Grey") addPrem("Altman Z in grey zone", 0.25, "Z-Score between 1.81 and 2.99 — some balance-sheet stress.");
  const mcap = i.price && i.sharesOut ? i.price * i.sharesOut : null;
  const mcapUsd = mcap && i.usdPerUnit ? mcap * i.usdPerUnit : null;
  if (mcapUsd != null) {
    if (mcapUsd < 5e8) addPrem("Size premium (micro-cap)", 1.5, `Market cap ≈ US$${(mcapUsd / 1e6).toFixed(0)}M — small, less liquid companies earn a size premium.`);
    else if (mcapUsd < 2e9) addPrem("Size premium (small-cap)", 1.0, `Market cap ≈ US$${(mcapUsd / 1e9).toFixed(1)}B — small-cap liquidity and risk premium.`);
    else if (mcapUsd < 1e10) addPrem("Size premium (mid-cap)", 0.5, `Market cap ≈ US$${(mcapUsd / 1e9).toFixed(1)}B — mid-cap premium.`);
  }
  const ke = rf.value + betaUsed * M.erp + prem;

  // cost of debt — synthetic rating from interest coverage
  const ebit = fin(li.ebit) ? li.ebit : li.opIncome;
  const interest = fin(li.interest) ? Math.abs(li.interest) : null;
  const debt = fin(i.totalDebt) && i.totalDebt > 0 ? i.totalDebt : 0;
  let kdPre, kdWhy, rating = null;
  if (debt > 0 && interest && ebit != null) {
    const cov = ebit / interest; const [, rt, spread] = syntheticRating(cov);
    rating = rt; kdPre = rf.value + spread;
    kdWhy = `interest cover ${cov.toFixed(1)}× → synthetic rating ${rt} → spread ${spread.toFixed(2)}pp over the ${rf.value.toFixed(2)}% risk-free rate`;
  } else if (debt > 0) { kdPre = rf.value + 2.0; kdWhy = "interest expense not disclosed — BBB-type spread of 2.0pp over the risk-free rate"; }
  else { kdPre = rf.value + 1.0; kdWhy = "no borrowings — the cost of debt carries no weight"; }
  const taxKd = M.statTax;
  const kdPost = kdPre * (1 - taxKd / 100);
  const wd = mcap && debt ? debt / (debt + mcap) : 0;
  const waccVal = (1 - wd) * ke + wd * kdPost;
  Object.assign(wacc, {
    rf, erp: { value: M.erp, source: `${M.label} equity risk premium — M-Terminal house assumption: ${M.erpWhy}` },
    beta: { raw: ownRaw, source: i.beta ? i.beta.source : null, n: i.beta ? i.beta.n : null, peerMedian: r2(peerMed), peers: peerBl.length, used: r2(betaUsed), why: betaWhy },
    premium: r2(prem), costEquity: r2(ke),
    costDebt: { pre: r2(kdPre), post: r2(kdPost), rating, why: kdWhy, taxRate: taxKd },
    weights: { equity: r2((1 - wd) * 100), debt: r2(wd * 100), basis: "market value of equity and book value of debt (including leases) today" },
    value: r2(waccVal),
  });
  wacc.build = [
    src("Risk-free rate (10-year government bond)", rf.value, null, rf.source),
    src("Beta (regression, Blume-adjusted, peer-blended)", betaUsed, null, betaWhy),
    src("Equity risk premium", M.erp, null, M.erpWhy),
    src("Company-specific premium", prem, null, prem ? "sum of the adjustment factors below" : "none — no quality, distress or size flags"),
    src("Cost of equity = rf + β × ERP + premium", ke, 1 - wd, "CAPM"),
    src("After-tax cost of debt", kdPost, wd, kdWhy),
  ];
  wacc.rationale = `WACC ${waccVal.toFixed(2)}%: cost of equity ${ke.toFixed(2)}% (risk-free ${rf.value.toFixed(2)}% ${rf.live ? `— live ${M.label} 10-year yield` : "— house fallback"}, β ${betaUsed.toFixed(2)} × ERP ${M.erp.toFixed(1)}%${prem ? `, plus ${prem.toFixed(2)}pp for the risk factors listed` : ""}) weighted ${((1 - wd) * 100).toFixed(0)}% against an after-tax cost of debt of ${kdPost.toFixed(2)}% at ${(wd * 100).toFixed(0)}%.`;
  wacc.confidence = rf.live && ownRaw != null ? "High" : "Medium";

  /* ─────────────────────────── terminal growth ─────────────────────────── */
  const term = { key: "terminalG", label: "Terminal growth", build: [], adjustments: [] };
  let gT = M.gT;
  term.build.push(src(`${M.label} long-run nominal growth anchor`, M.gT, null, "house assumption: below long-run nominal GDP growth, as a perpetuity must be"));
  if (moat === "None") { gT -= 0.5; term.adjustments.push(adj("No economic moat", -0.5, "−0.5pp", "Without a moat, returns compete away — the business grows below the economy in perpetuity.")); }
  if (eq === "D") { gT -= 0.5; term.adjustments.push(adj("Earnings quality grade D", -0.5, "−0.5pp", "Weak cash backing of profits — a more conservative perpetuity.")); }
  const gCap = Math.min(rf.value - 0.25, waccVal - 3.0);
  if (gT > gCap) { term.adjustments.push(adj("Capped by risk-free rate / WACC", gCap - gT, `${gT.toFixed(2)}% → ${gCap.toFixed(2)}%`, "Terminal growth may not exceed the risk-free rate, and must sit at least 3pp below WACC for a stable perpetuity.")); gT = gCap; }
  gT = r2(Math.max(0, gT));
  // return on new invested capital in the terminal state: a wide moat keeps the returns the
  // business earns today (bounded); a narrow moat keeps half the excess; no moat earns ~WACC
  const spread = moat === "Wide" ? 6 : moat === "Narrow" ? 3 : 1;
  const roicNow = fin(i.roic) ? i.roic : null;
  // new capital is spent on operations, not acquisitions: for a wide moat use the ROIC on
  // operating capital (acquired goodwill excluded) — HUL's 23% reported ROIC is mostly GSK goodwill
  const roicOp = fin(i.roicExGoodwill) ? i.roicExGoodwill : roicNow;
  const ronic = moat === "Wide" && roicOp != null ? clamp(roicOp, waccVal + spread, 60)
    : moat === "Narrow" && roicNow != null ? clamp(0.5 * roicNow + 0.5 * (waccVal + spread), waccVal + spread, 40)
    : waccVal + spread;
  const reinvRate = gT > 0 ? clamp(gT / ronic, 0, 0.9) : 0;
  Object.assign(term, { value: gT, ronic: r2(ronic), reinvestmentRate: r2(reinvRate * 100), moat });
  term.rationale = `Terminal growth ${gT.toFixed(2)}% — the ${M.label} long-run anchor${term.adjustments.length ? ", adjusted as listed" : ""}. In the terminal state the business earns ${ronic.toFixed(1)}% on new capital (${moat === "Wide" && roicOp != null ? `${roicOp >= 100 ? "returns on operating capital above 100% (acquired goodwill and brands exceed the capital the business runs on)" : `today’s ${roicOp.toFixed(1)}% return on operating capital`}${roicOp !== roicNow && roicNow != null ? ` (${roicNow.toFixed(1)}% including acquired goodwill)` : ""}, sustained by a wide moat — capped at 60%` : moat === "Narrow" && roicNow != null ? `half of today’s ${roicNow.toFixed(1)}% ROIC excess retained under a narrow moat` : `WACC + ${spread}pp`}), so sustaining ${gT.toFixed(2)}% growth requires reinvesting ${(reinvRate * 100).toFixed(0)}% of NOPAT (g ÷ RONIC). The terminal value is FCFF = NOPAT × (1 − g ÷ RONIC), discounted after the stage-2 fade.`;
  term.confidence = "Medium";

  /* ─────────────────────────── revenue growth ─────────────────────────── */
  const G = mk("growth", "Revenue growth");
  G.hist = { ...(hstat(yoy) || {}), cagr: r2(histCagr) };
  G.latest = r2(yoy.at(-1));
  const peerG = median(peers.map((p) => p.revGrowth));
  const fwd = ((i.consensus && i.consensus.forward) || []).filter((x) => fin(x.revenueAvg) && x.revenueAvg > 0);
  const fyEnd = (x) => (x.endDate ? new Date(x.endDate).getFullYear() : null);
  // the annual estimates, oldest first; drop one for a fiscal year already reported
  const annual = ["0y", "+1y"].map((p) => fwd.find((x) => x.period === p)).filter(Boolean)
    .filter((x) => fyEnd(x) == null || fyEnd(x) > baseYear);
  let cons1 = null, cons2 = null, nA = 0;
  if (annual[0]) {
    const g0 = (annual[0].revenueAvg / baseRev - 1) * 100;
    if (Math.abs(g0) < 60) { cons1 = g0; nA = annual[0].numAnalysts || 0; }
    if (annual[1] && cons1 != null) cons2 = (annual[1].revenueAvg / annual[0].revenueAvg - 1) * 100;
  }
  if (cons2 != null && (Math.abs(cons2) > 50 || (cons1 != null && Math.abs(cons2 - cons1) > 20))) { cons2 = null; notes.push("Next-year consensus revenue growth is inconsistent with this year’s estimate — not used."); }
  const e0 = annual[0] || null, e1 = annual[1] || null;
  const histAnchor = histCagr != null ? histCagr : avg(yoy);
  let y1, y2;
  if (cons1 != null && nA >= 3) {
    // consensus already embeds the history; with ≥5 analysts it is used as the market's
    // estimate, with 3–4 it is blended 70/30 with history
    const h = histAnchor != null ? histAnchor : cons1;
    const wc = nA >= 5 ? 1 : 0.7;
    y1 = wc * cons1 + (1 - wc) * h;
    G.build.push(src(`Consensus FY${String(years[0]).slice(2)} revenue (${nA} analysts)`, cons1, wc, "sell-side mean revenue estimate ÷ last reported revenue"));
    if (wc < 1) G.build.push(src("Historical revenue CAGR", h, 1 - wc, `${lastRevs.length - 1}-year compound growth — blended because fewer than 5 analysts cover the stock`));
    if (cons2 != null) { y2 = wc * cons2 + (1 - wc) * h; G.build.push(src(`Consensus FY${String(years[1]).slice(2)} revenue growth`, cons2, wc, "next-year mean estimate ÷ this-year mean estimate")); }
    else y2 = 0.5 * y1 + 0.5 * h;
    G.confidence = "High";
  } else {
    const h = histAnchor != null ? histAnchor : 8;
    if (peerG != null) { y1 = 0.6 * h + 0.4 * peerG; G.build.push(src("Historical revenue CAGR", h, 0.6, `${lastRevs.length - 1}-year compound growth`)); G.build.push(src("Peer median revenue growth", peerG, 0.4, `${peers.length} peers, trailing twelve months`)); }
    else { y1 = h; G.build.push(src("Historical revenue CAGR", h, 1, "no consensus or peer growth available")); }
    y2 = 0.85 * y1 + 0.15 * M.gT;
    G.confidence = histAnchor != null ? "Medium" : "Low";
    if (cons1 == null) notes.push("No usable consensus revenue estimate — near-year growth is built from history and peers.");
  }
  let gMult = 1;
  if (eq === "C") { gMult *= 0.9; G.adjustments.push(adj("Earnings quality grade C", null, "growth × 0.90", "Profits are not fully cash-backed; near-term growth is trimmed 10% until cash conversion improves.")); }
  if (eq === "D") { gMult *= 0.8; G.adjustments.push(adj("Earnings quality grade D", null, "growth × 0.80", "Weak earnings quality — growth trimmed 20%.")); }
  if (f.beneish && fin(f.beneish.score) && f.beneish.score > -1.78) { gMult *= 0.9; G.adjustments.push(adj("Beneish M-Score flag", null, "growth × 0.90", "Receivables / accrual patterns resemble aggressive revenue recognition — growth trimmed 10%.")); }
  if (gMult !== 1) { if (y1 > 0) y1 *= gMult; if (y2 > 0) y2 *= gMult; }
  const y1b = y1, y2b = y2;
  y1 = clamp(y1, -15, 40); y2 = clamp(y2, -15, 35);
  if (y1 !== y1b || y2 !== y2b) G.adjustments.push(adj("Growth bounds", null, "Y1 −15% to 40%, Y2 −15% to 35%", "Extreme single-year growth is capped; outliers rarely persist."));
  // competitive-advantage period: a wide moat holds growth near its mid-cycle level through
  // year 5; a narrow moat fades halfway to terminal by year 5; no moat fades two-thirds of the way
  // Stage 1 (Y1–Y2) consensus; Y3–Y10 fade toward the growth the economy can carry (nominal GDP);
  // stage 2 (after Y10, valued inside the terminal value) fades to the perpetuity rate over a
  // moat-length competitive-advantage period: wide 10 years, narrow 5, none 0.
  const gLR = M.nomGDP;
  // long-run anchor: halfway between the company's own history and nominal GDP (a 3-4 year
  // history can be a cyclical low or high; the economy is the gravitational pull)
  const lra = clamp(0.5 * gLR + 0.5 * clamp(fin(histAnchor) ? histAnchor : gLR, -5, gLR + 10), gT, gLR + 5);
  const mid = 0.6 * y2 + 0.4 * lra;
  G.build.push(src("Long-run anchor (½ history + ½ nominal GDP)", lra, null, "where mid-cycle growth settles once near-term estimates run out"));
  let y5, y10, s2;
  if (moat === "Wide") { y5 = Math.max(mid, gT); y10 = clamp(Math.min(y5, gLR), gT, gLR); s2 = 10; }
  else if (moat === "Narrow") { y5 = gT + 0.6 * (y2 - gT); y10 = gT + 0.5 * (clamp(Math.min(y5, gLR), gT, gLR) - gT); s2 = 5; }
  else { y5 = gT + (1 / 3) * (y2 - gT); y10 = gT; s2 = 0; }
  if (y2 < gT) { y5 = lerp(y2, gT, 0.6); y10 = gT; }         // a shrinking business recovers toward the economy
  const cap = moat === "Wide" ? `a wide moat — growth holds near its mid-cycle level to year 5, eases toward the ${gLR.toFixed(0)}% nominal-GDP rate by year 10, then fades to the ${gT.toFixed(1)}% perpetuity over a further 10 years`
    : moat === "Narrow" ? `a narrow moat — growth fades most of the way to terminal by year 10, then reaches the ${gT.toFixed(1)}% perpetuity over a further 5 years`
    : `no moat — growth converges on the ${gT.toFixed(1)}% perpetuity by year 10`;
  G.adjustments.push(adj(`Competitive-advantage period (${moat || "no"} moat)`, null, `Y5 ${y5.toFixed(1)}% · Y10 ${y10.toFixed(1)}% · +${s2}y fade`, `${cap[0].toUpperCase()}${cap.slice(1)}.`));
  G.build.push(src(`${M.label} long-run nominal GDP growth`, gLR, null, "house assumption — the ceiling for growth sustained beyond the forecast"));
  G.path = years.map((_, k) => {
    const y = k + 1;
    if (y === 1) return y1; if (y === 2) return y2;
    if (y <= 5) return lerp(y2, y5, (y - 2) / 3);
    return lerp(y5, y10, (y - 5) / 5);
  }).map(r2);
  G.stage2 = { years: s2, from: r2(y10), to: gT };
  G.rationale = `${cons1 != null && nA >= 3 ? `Years 1–2 are anchored on consensus (${pct(cons1)}${cons2 != null ? ` then ${pct(cons2)}` : ""}, ${nA} analysts) blended with the ${pct(histAnchor)} historical CAGR` : `Years 1–2 come from the ${pct(histAnchor)} historical CAGR${peerG != null ? ` and the ${pct(peerG)} peer median` : ""}`}; then ${cap} — competition, scale and market maturity pull every business toward the economy's growth rate.`;

  /* ─────────────────────────── EBITDA margin ─────────────────────────── */
  const Mg = mk("ebitdaMargin", "EBITDA margin");
  Mg.hist = hstat(margins); Mg.latest = r2(margins.filter(fin).at(-1));
  const m0 = Mg.latest != null ? Mg.latest : 15;
  const mAvg = Mg.hist ? Mg.hist.avg : m0;
  let d1 = 0, d2 = 0;
  if (e0 && fin(e0.growthPct) && cons1 != null && nA >= 3) {
    const lev = ((1 + e0.growthPct / 100) / (1 + cons1 / 100) - 1);
    d1 = clamp(m0 * lev * 0.6, -2, 2);
    if (Math.abs(d1) >= 0.05) Mg.build.push(src("Consensus operating leverage (EPS vs revenue growth)", d1, null, `consensus EPS growth ${pct(e0.growthPct)} vs revenue ${pct(cons1)} — 60% passed through to EBITDA margin, capped ±2pp`));
  }
  if (e1 && fin(e1.growthPct) && cons2 != null && Math.abs(e1.growthPct) < 80) d2 = clamp(m0 * ((1 + e1.growthPct / 100) / (1 + cons2 / 100) - 1) * 0.6, -1.5, 1.5);
  const mY1 = m0 + d1, mY2 = mY1 + d2;
  Mg.build.unshift(src("Latest reported EBITDA margin", m0, null, `FY${String(baseYear).slice(2)} reported`));
  Mg.build.push(src(`${Mg.hist ? Mg.hist.n : 1}-year average margin`, mAvg, null, "normalised level the margin reverts toward"));
  let mLong, mWhy;
  if (moat === "Wide") { mLong = Math.max(mY2, mAvg); mWhy = "a wide moat sustains the current margin"; }
  else if (moat === "Narrow") { mLong = 0.5 * mY2 + 0.5 * mAvg; mWhy = "a narrow moat — margin reverts halfway to its average"; }
  else { mLong = mAvg; mWhy = "no moat — margin reverts to its historical average"; }
  Mg.adjustments.push(adj(`Moat: ${moat || "not rated"}`, mLong - mY2, `long-run margin ${mLong.toFixed(1)}%`, `${mWhy[0].toUpperCase()}${mWhy.slice(1)}.`));
  const cc = f.cash && fin(f.cash.cashConversion) ? f.cash.cashConversion : null;
  if (cc != null && cc < 0.8) { mLong -= 1.0; Mg.adjustments.push(adj("Low cash conversion", -1.0, "−1.0pp long-run margin", `Operating cash flow is only ${cc.toFixed(2)}× net income — reported margins overstate cash margins.`)); }
  mLong = clamp(mLong, 1, 60);
  Mg.path = years.map((_, k) => { const y = k + 1; return y === 1 ? mY1 : y === 2 ? mY2 : y <= 5 ? lerp(mY2, mLong, (y - 2) / 3) : mLong; }).map((x) => r2(clamp(x, 1, 60)));
  Mg.rationale = `Starts from the ${m0.toFixed(1)}% latest margin${Math.abs(d1) >= 0.05 ? `, ${d1 >= 0 ? "expanding" : "contracting"} ${Math.abs(d1).toFixed(1)}pp in year 1 on the operating leverage consensus implies` : ""}; from year 3 it moves to a long-run ${mLong.toFixed(1)}% — ${mWhy}${cc != null && cc < 0.8 ? ", less 1pp for weak cash conversion" : ""}.`;
  Mg.confidence = Mg.hist && Mg.hist.n >= 3 ? "High" : "Medium";

  /* ─────────────────────────── D&A ─────────────────────────── */
  const D = mk("depPctRev", "D&A (% revenue)");
  D.hist = hstat(depPcts); D.latest = r2(depPcts.filter(fin).at(-1));
  const dep = D.hist ? D.hist.avg : 4;
  D.build.push(src(`${D.hist ? D.hist.n : 0}-year average D&A / revenue`, dep, 1, D.hist ? "reported depreciation & amortisation" : "not reported — 4% placeholder"));
  D.path = years.map(() => r2(dep));
  D.rationale = `Held at the ${dep.toFixed(2)}% historical average of revenue — depreciation follows the asset base, which grows with revenue.`;
  D.confidence = D.hist && D.hist.n >= 3 ? "High" : "Low";
  if (!D.hist) notes.push("D&A history not reported — a 4% placeholder is used.");

  /* ─────────────────────────── tax ─────────────────────────── */
  const T = mk("taxRate", "Tax rate");
  T.hist = hstat(taxes); T.latest = r2(taxes.filter(fin).at(-1));
  const tEff = T.hist ? T.hist.avg : M.statTax;
  const tYears = tEff < M.statTax - 8 ? 10 : 5;
  T.build.push(src(`${T.hist ? T.hist.n : 0}-year average effective tax rate`, tEff, null, "tax expense ÷ pre-tax profit"));
  T.build.push(src(`${M.label} statutory rate`, M.statTax, null, "house assumption for the jurisdiction"));
  T.path = years.map((_, k) => r2(k + 1 >= tYears ? M.statTax : lerp(tEff, M.statTax, k / (tYears - 1))));
  T.rationale = `Moves from the ${tEff.toFixed(1)}% effective rate to the ${M.statTax.toFixed(2)}% statutory rate by year ${tYears} — incentives and one-offs that lower the effective rate rarely last${tYears === 10 ? " (converging over ten years because the gap is wide)" : ""}.`;
  T.confidence = T.hist && T.hist.n >= 2 ? "High" : "Medium";

  /* ─────────────────────────── working capital ─────────────────────────── */
  const W = mk("wcPctRev", "Working capital (% of revenue change)");
  W.hist = hstat(nwcPcts); W.latest = r2(nwcPcts.filter(fin).at(-1));
  let wc = W.hist ? W.hist.avg : 10;
  W.build.push(src("Net working capital / revenue (receivables + inventory − payables)", wc, 1, W.hist ? `${W.hist.n}-year average` : "not reported — 10% placeholder"));
  const dsoV = dso.filter(fin);
  if (dsoV.length >= 3 && dsoV.at(-1) > dsoV[0] * 1.1) { wc += 2; W.adjustments.push(adj("Receivable days rising", 2, "+2pp", `Receivable days rose from ${dsoV[0].toFixed(0)} to ${dsoV.at(-1).toFixed(0)} — growth is absorbing more working capital.`)); }
  wc = clamp(wc, -15, 40);
  W.path = years.map(() => r2(wc));
  W.rationale = `Each extra unit of revenue ties up ${wc.toFixed(1)}% in working capital — the business's own receivable, inventory and payable cycle${W.adjustments.length ? ", adjusted for rising receivable days" : ""}. ${wc < 0 ? "Negative: suppliers fund the growth." : ""}`.trim();
  W.confidence = W.hist && W.hist.n >= 3 ? "High" : "Low";

  /* ─────────────────────────── capex ─────────────────────────── */
  // Constant fixed-asset intensity: capex = maintenance (≈ D&A) + the net PP&E each year's
  // revenue growth requires at today's revenue / net PP&E. Years 1–2 ease out of the current
  // capex cycle (committed projects); years 3–10 follow the growth path — capex falls as growth
  // fades. Beyond year 10 the terminal value reinvests g ÷ RONIC of NOPAT.
  const C = mk("capexPctRev", "Capex (% revenue)");
  C.hist = hstat(capexPcts); C.latest = r2(capexPcts.filter(fin).at(-1));
  const cap0 = C.hist ? C.hist.avg : dep * 1.2;
  const ppe = lb.ppe > 0 ? lb.ppe : null;
  const intensity = ppe ? ppe / baseRev : null;              // net PP&E per unit of revenue
  C.build.push(src(`${C.hist ? C.hist.n : 0}-year average capex / revenue`, cap0, null, C.hist ? "reported capital expenditure — the current cycle" : "not reported — 1.2 × D&A placeholder"));
  C.build.push(src("Maintenance capex ≈ D&A", dep, null, "replaces the asset base as it depreciates"));
  if (C.hist && cap0 < dep * 0.95) {
    // capex structurally below D&A: D&A includes amortisation of acquired intangibles /
    // spectrum that is not re-bought as capex, and growth is price-led — hold history
    C.path = years.map(() => r2(cap0));
    C.adjustments.push(adj("Capex below D&A", null, "held at history", `Capex (${cap0.toFixed(1)}%) runs below D&A (${dep.toFixed(1)}%) — D&A includes amortisation of acquired intangibles or spectrum that is not re-bought as capex, and growth has been price-led; capex is held at its historical intensity.`));
  } else if (intensity != null) {
    C.build.push(src("Net PP&E / revenue (asset intensity)", intensity * 100, null, `FY${String(baseYear).slice(2)} net PP&E ÷ revenue — held constant, so each rupee of new revenue needs ${intensity.toFixed(2)} of new fixed assets`));
    const model = (k) => dep + intensity * 100 * (G.path[k] / 100) / (1 + G.path[k] / 100);
    C.path = years.map((_, k) => r2(k === 0 ? 0.5 * cap0 + 0.5 * model(0) : k === 1 ? 0.25 * cap0 + 0.75 * model(1) : model(k)));
    if (cap0 > model(0) * 1.3) C.adjustments.push(adj("Current capex cycle", null, `${cap0.toFixed(1)}% → ${C.path[2].toFixed(1)}% by year 3`, "Recent capex runs well above what growth needs at today's asset intensity — a build-out cycle; it eases over two years."));
  } else {
    const net0 = cap0 - dep, gRef = Math.max(fin(histAnchor) ? histAnchor : 5, gT, 3);
    C.path = years.map((_, k) => r2(net0 > 0 ? dep + net0 * clamp(G.path[k] / gRef, 0.3, 1.5) : cap0));
    C.adjustments.push(adj("Net PP&E not reported", null, "growth-scaled", "Asset intensity unavailable — growth capex scales with growth relative to history instead."));
  }
  C.rationale = `Maintenance capex ≈ D&A (${dep.toFixed(2)}% of revenue)${intensity != null ? ` plus the new fixed assets growth needs at today's ${intensity.toFixed(2)}× net PP&E-to-revenue` : " plus growth capex scaled to growth"}: ${C.path[0].toFixed(2)}% in year 1 → ${C.path.at(-1).toFixed(2)}% by year 10 as growth fades${cap0 > C.path[2] * 1.3 ? `, easing out of a ${cap0.toFixed(1)}% build-out cycle` : ""}. Beyond year 10 the terminal value reinvests exactly what ${gT.toFixed(1)}% growth needs at a ${ronic.toFixed(1)}% return on new capital (g ÷ RONIC).`;
  if (C.hist && cap0 < dep * 0.95) C.rationale = `Capex is held at its ${cap0.toFixed(2)}% historical intensity: it runs below D&A (${dep.toFixed(2)}%) because D&A includes amortisation of acquired intangibles or spectrum that is not re-bought as capex. Beyond year 10 the terminal value reinvests exactly what ${gT.toFixed(1)}% growth needs at a ${ronic.toFixed(1)}% return on new capital (g ÷ RONIC).`;
  C.confidence = C.hist && C.hist.n >= 3 && intensity != null ? "High" : "Medium";

  const drivers = { growth: G, ebitdaMargin: Mg, depPctRev: D, capexPctRev: C, wcPctRev: W, taxRate: T };
  for (const d of Object.values(drivers)) d.path = d.path.map((x) => (fin(x) ? x : null));

  // every adjustment in one list — the "adjustment factors" table
  const allAdjustments = [
    ...G.adjustments.map((a) => ({ driver: G.label, ...a })), ...Mg.adjustments.map((a) => ({ driver: Mg.label, ...a })),
    ...W.adjustments.map((a) => ({ driver: W.label, ...a })), ...C.adjustments.map((a) => ({ driver: C.label, ...a })),
    ...wacc.adjustments.map((a) => ({ driver: "Cost of equity", ...a })), ...term.adjustments.map((a) => ({ driver: term.label, ...a })),
  ];
  return {
    version: "plan-v1", horizon: HORIZON, stage1: 5, years, baseYear, market: mkKey, marketLabel: M.label,
    drivers, wacc, terminal: { ...term, stage2Years: G.stage2.years, stage2From: G.stage2.from }, adjustments: allAdjustments, notes, warnings, applicable: !isLender,
    quality: { earningsQualityGrade: eq, moat, roic: r2(roicNow), cashConversion: cc, beneish: f.beneish ? r2(f.beneish.score) : null, altmanZone: f.altman ? f.altman.zone : null },
  };
}

/* the engine inputs the plan implies (dcfIn fields + yearly paths) */
function planToEngine(plan) {
  if (!plan) return null;
  const P = (k) => plan.drivers[k].path;
  return {
    growthY1_5: P("growth")[0],
    fade: r2(Math.max(0, (P("growth")[1] - P("growth")[4]) / 3)),
    terminalG: plan.terminal.value,
    wacc: plan.wacc.value,
    rationale: { rf: plan.wacc.rf.value, beta: plan.wacc.beta.used, erp: plan.wacc.erp.value, premium: plan.wacc.premium, kdPre: plan.wacc.costDebt.pre, kdTax: plan.wacc.costDebt.taxRate, wd: plan.wacc.weights.debt / 100 },
    paths: { growth: P("growth"), ebitdaMargin: P("ebitdaMargin"), depPctRev: P("depPctRev"), capexPctRev: P("capexPctRev"), wcPctRev: P("wcPctRev"), taxRate: P("taxRate") },
    horizon: plan.horizon,
    stage2: { years: plan.terminal.stage2Years || 0, ronic: plan.terminal.ronic },
  };
}

/* OLS beta of weekly returns against the index (both arrays of closes, aligned by timestamp) */
function regressionBeta(stock, index, maxWeeks = 156) {
  const m = new Map(index.filter((p) => p && fin(p.c)).map((p) => [Math.round(p.t / 864e5 / 7), p.c]));
  const pairs = stock.filter((p) => p && fin(p.c)).map((p) => [p.c, m.get(Math.round(p.t / 864e5 / 7))]).filter(([, b]) => fin(b));
  const rs = [], rm = [];
  for (let k = 1; k < pairs.length; k++) { rs.push(pairs[k][0] / pairs[k - 1][0] - 1); rm.push(pairs[k][1] / pairs[k - 1][1] - 1); }
  const n = Math.min(rs.length, maxWeeks); if (n < 52) return null;
  const a = rs.slice(-n), b = rm.slice(-n);
  const ma = avg(a), mb = avg(b);
  let cov = 0, vb = 0; for (let k = 0; k < n; k++) { cov += (a[k] - ma) * (b[k] - mb); vb += (b[k] - mb) ** 2; }
  return vb > 0 ? { raw: cov / vb, n } : null;
}

module.exports = { buildPlan, planToEngine, regressionBeta, marketOf, MARKET, HORIZON };
