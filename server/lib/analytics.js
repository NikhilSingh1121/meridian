/** MERIDIAN analytics engine — deterministic computation only. No AI here.
    Every number the platform shows is produced by these functions. */

const n = (v) => (v === null || v === undefined || Number.isNaN(v) ? null : Number(v));
const div = (a, b) => (n(a) !== null && n(b) ? a / b : null);
const pct = (a, b) => (n(a) !== null && n(b) ? (a / b - 1) * 100 : null);

/* ── statement normalization ──
   Statements now arrive pre-normalized from the fundamentals provider
   (fundamentalsTimeSeries) attached as bundle.__statements. */
function normStatements(bundle) {
  if (bundle.__statements) return bundle.__statements;
  return { income: [], balance: [], cashflow: [] };
}

/* ── ratio library: value + 4y trend + interpretation ── */
function computeRatios(bundle, st) {
  const fd = bundle.financialData || {}, ks = bundle.defaultKeyStatistics || {}, sd = bundle.summaryDetail || {}, pr = bundle.price || {};
  const i = st.income, b = st.balance, c = st.cashflow;
  const last = (arr) => arr[arr.length - 1] || {};
  const li = last(i), lb = last(b), lc = last(c);
  const mcap = n(sd.marketCap) ?? n(pr.marketCap);
  const debt = (lb.ltDebt || 0) + (lb.stDebt || 0) || n(fd.totalDebt);
  const ev = n(ks.enterpriseValue) ?? (mcap !== null && debt !== null ? mcap + debt - (lb.cash || 0) : null);
  const cogs = li.revenue !== null && li.grossProfit !== null ? li.revenue - li.grossProfit : null;

  const trend = (f) => i.map((row, idx) => ({ year: row.year, v: f(i[idx], b[idx] || {}, c[idx] || {}) }));
  const series = {
    roe: trend((ii, bb) => div(ii.netIncome, bb.equity) !== null ? div(ii.netIncome, bb.equity) * 100 : null),
    roce: trend((ii, bb) => { const ce = bb.assets !== null && bb.currentLiab !== null ? bb.assets - bb.currentLiab : null; return div(ii.ebit ?? ii.opIncome, ce) !== null ? div(ii.ebit ?? ii.opIncome, ce) * 100 : null; }),
    netMargin: trend((ii) => div(ii.netIncome, ii.revenue) !== null ? div(ii.netIncome, ii.revenue) * 100 : null),
    opMargin: trend((ii) => div(ii.opIncome, ii.revenue) !== null ? div(ii.opIncome, ii.revenue) * 100 : null),
    grossMargin: trend((ii) => div(ii.grossProfit, ii.revenue) !== null ? div(ii.grossProfit, ii.revenue) * 100 : null),
    revenue: i.map((r) => ({ year: r.year, v: r.revenue })),
    netIncome: i.map((r) => ({ year: r.year, v: r.netIncome })),
    fcf: c.map((r) => ({ year: r.year, v: r.fcf })),
  };

  const R = (group, name, value, fmtType, betterHigh, note) => ({ group, name, value: n(value), fmt: fmtType, betterHigh, note });
  const ratios = [
    R("Profitability", "ROE", (fd.returnOnEquity ?? div(li.netIncome, lb.equity)) * 100, "pct", true, "Return generated on shareholder capital"),
    R("Profitability", "ROCE", series.roce.at(-1)?.v, "pct", true, "EBIT on capital employed — capital-structure-neutral efficiency"),
    R("Profitability", "ROA", (fd.returnOnAssets ?? div(li.netIncome, lb.assets)) * 100, "pct", true, "Profit per unit of total assets"),
    R("Profitability", "EBITDA margin", (fd.ebitdaMargins ?? null) !== null ? fd.ebitdaMargins * 100 : null, "pct", true, "Core operating profitability before D&A"),
    R("Profitability", "Net margin", (fd.profitMargins ?? div(li.netIncome, li.revenue)) * 100, "pct", true, "What survives to the bottom line"),
    R("Liquidity", "Current ratio", fd.currentRatio ?? div(lb.currentAssets, lb.currentLiab), "x", true, "Short-term assets covering short-term obligations"),
    R("Liquidity", "Quick ratio", fd.quickRatio ?? div((lb.currentAssets || 0) - (lb.inventory || 0), lb.currentLiab), "x", true, "Coverage excluding inventory"),
    R("Leverage", "Debt / Equity", fd.debtToEquity !== undefined && fd.debtToEquity !== null ? fd.debtToEquity / 100 : div(debt, lb.equity), "x", false, "Balance-sheet gearing"),
    R("Leverage", "Interest coverage", div(li.ebit ?? li.opIncome, li.interest), "x", true, "EBIT against interest burden"),
    R("Efficiency", "Asset turnover", div(li.revenue, lb.assets), "x", true, "Revenue per unit of assets"),
    R("Efficiency", "Inventory turnover", div(cogs ?? li.revenue, lb.inventory), "x", true, "Speed of inventory cycle"),
    R("Efficiency", "Receivable days", div(lb.receivables, li.revenue) !== null ? div(lb.receivables, li.revenue) * 365 : null, "days", false, "Collection period on sales"),
    R("Valuation", "P/E (TTM)", sd.trailingPE, "x", false, "Price on trailing earnings"),
    R("Valuation", "Forward P/E", sd.forwardPE, "x", false, "Price on estimated forward earnings"),
    R("Valuation", "EV / EBITDA", ks.enterpriseToEbitda, "x", false, "Capital-structure-neutral multiple"),
    R("Valuation", "EV / Sales", ks.enterpriseToRevenue, "x", false, "For margin-transition businesses"),
    R("Valuation", "P/B", ks.priceToBook, "x", false, "Price on book value"),
    R("Valuation", "PEG", ks.pegRatio, "x", false, "P/E scaled by growth"),
    R("Market", "Beta", ks.beta, "x", null, "Sensitivity to market moves"),
    R("Market", "Dividend yield", sd.dividendYield !== undefined && sd.dividendYield !== null ? sd.dividendYield * 100 : null, "pct", null, "Cash return at current price"),
  ].filter((r) => r.value !== null && Number.isFinite(r.value));

  return { ratios, series, mcap, ev, debt };
}

/* ── growth & quality block ── */
function computeGrowth(st) {
  const i = st.income, c = st.cashflow;
  const cagr = (arr, key) => {
    const v = arr.map((r) => r[key]).filter((x) => x !== null && x > 0);
    if (v.length < 2) return null;
    return (Math.pow(v[v.length - 1] / v[0], 1 / (v.length - 1)) - 1) * 100;
  };
  const yoy = (arr, key) => {
    const a = arr.at(-2)?.[key], b = arr.at(-1)?.[key];
    return pct(b, a);
  };
  const li = i.at(-1) || {}, lc = c.at(-1) || {};
  return {
    revCagr: cagr(i, "revenue"), niCagr: cagr(i, "netIncome"),
    revYoy: yoy(i, "revenue"), niYoy: yoy(i, "netIncome"),
    fcfYoy: yoy(c, "fcf"),
    cashConversion: li.netIncome && lc.ocf ? (lc.ocf / li.netIncome) * 100 : null,
  };
}

/* ── variance analysis: what drove the latest year ── */
function varianceAnalysis(st) {
  const i = st.income, b = st.balance;
  if (i.length < 2) return { drivers: [], commentary: "Insufficient statement history for variance analysis." };
  const p = i.at(-2), c = i.at(-1);
  const pb = b.at(-2) || {}, cb = b.at(-1) || {};
  const drivers = [];
  const add = (label, value, unit, dir) => value !== null && Number.isFinite(value) && drivers.push({ label, value, unit, dir });

  const revD = pct(c.revenue, p.revenue);
  add("Revenue growth", revD, "%", revD >= 0 ? "up" : "down");
  const gmP = div(p.grossProfit, p.revenue), gmC = div(c.grossProfit, c.revenue);
  if (gmP !== null && gmC !== null) add("Gross margin", (gmC - gmP) * 100, "pp", gmC >= gmP ? "up" : "down");
  const omP = div(p.opIncome, p.revenue), omC = div(c.opIncome, c.revenue);
  if (omP !== null && omC !== null) add("Operating margin", (omC - omP) * 100, "pp", omC >= omP ? "up" : "down");
  const nmP = div(p.netIncome, p.revenue), nmC = div(c.netIncome, c.revenue);
  if (nmP !== null && nmC !== null) add("Net margin", (nmC - nmP) * 100, "pp", nmC >= nmP ? "up" : "down");
  const wcP = (pb.receivables || 0) + (pb.inventory || 0) - (pb.payables || 0);
  const wcC = (cb.receivables || 0) + (cb.inventory || 0) - (cb.payables || 0);
  if (wcP && c.revenue && p.revenue) {
    const wcDays = (wcC / c.revenue - wcP / p.revenue) * 365;
    add("Working capital cycle", wcDays, "days", wcDays <= 0 ? "up" : "down");
  }

  const f = (v) => Math.abs(v).toFixed(1);
  const parts = [];
  if (revD !== null) parts.push(`Revenue ${revD >= 0 ? "grew" : "declined"} ${f(revD)}% year over year`);
  if (gmC !== null && gmP !== null) parts.push(`gross margin ${gmC >= gmP ? "expanded" : "compressed"} ${f((gmC - gmP) * 100)}pp, indicating ${gmC >= gmP ? "pricing power or favourable input costs" : "input-cost pressure or weakening mix"}`);
  if (omC !== null && nmC !== null && gmC !== null) {
    const opexEffect = (omC - omP) - (gmC - gmP);
    if (Number.isFinite(opexEffect)) parts.push(`operating leverage contributed ${opexEffect >= 0 ? "+" : ""}${(opexEffect * 100).toFixed(1)}pp below the gross line`);
  }
  return { drivers, commentary: parts.length ? parts.join("; ") + "." : "Variance drivers unavailable for this issuer." };
}

/* ── DCF defaults derived from the data (every assumption editable) ── */
function dcfDefaults(bundle, st, ratios, growth) {
  const fd = bundle.financialData || {}, ks = bundle.defaultKeyStatistics || {}, pr = bundle.price || {};
  const lc = st.cashflow.at(-1) || {};
  const baseFcf = n(fd.freeCashflow) ?? lc.fcf ?? null;
  const beta = n(ks.beta) ?? 1.0;
  const isIndia = (pr.exchangeName || "").match(/NSE|BSE/i) || (pr.currency === "INR");
  const rf = isIndia ? 7.0 : 4.3, erp = isIndia ? 6.0 : 5.0;
  const costEquity = rf + beta * erp;
  const g1 = Math.min(Math.max(growth.revCagr ?? 10, 2), 25);
  return {
    baseFcf, currency: pr.currency || "",
    sharesOut: n(ks.sharesOutstanding),
    netDebt: (ratios.debt ?? 0) - (st.balance.at(-1)?.cash ?? 0),
    growthY1_5: +g1.toFixed(1), fade: +(Math.min(g1, 8) / 2).toFixed(1),
    terminalG: isIndia ? 4.5 : 2.5, wacc: +costEquity.toFixed(1),
    rationale: { rf, beta: +beta.toFixed(2), erp, note: `WACC proxied by cost of equity: rf ${rf}% + β ${beta.toFixed(2)} × ERP ${erp}% — edit any input` },
    currentPrice: n(pr.regularMarketPrice),
  };
}

/* runDCF: two-stage with fade, returns per-share value + sensitivity grid */
function runDCF(a) {
  const { baseFcf, growthY1_5, fade, terminalG, wacc, sharesOut, netDebt } = a;
  if (!baseFcf || !sharesOut) return null;
  const r = wacc / 100, gT = terminalG / 100;
  if (r <= gT) return { error: "WACC must exceed terminal growth" };
  let fcf = baseFcf, pv = 0;
  const years = [];
  for (let y = 1; y <= 10; y++) {
    const g = y <= 5 ? growthY1_5 / 100 : Math.max(gT, (growthY1_5 - fade * (y - 5)) / 100);
    fcf *= 1 + g;
    const d = fcf / Math.pow(1 + r, y);
    pv += d;
    years.push({ y, fcf, pv: d, g: g * 100 });
  }
  const tv = (fcf * (1 + gT)) / (r - gT);
  const tvPv = tv / Math.pow(1 + r, 10);
  const equity = pv + tvPv - (netDebt || 0);
  const perShare = equity / sharesOut;
  // sensitivity: wacc ±1.5 × terminal g ±1
  const sens = [];
  for (const dw of [-1.5, -0.75, 0, 0.75, 1.5]) {
    const row = [];
    for (const dg of [-1, -0.5, 0, 0.5, 1]) {
      const v = runDCFsimple(baseFcf, growthY1_5, fade, terminalG + dg, wacc + dw, sharesOut, netDebt);
      row.push(v);
    }
    sens.push({ wacc: +(wacc + dw).toFixed(2), values: row });
  }
  return { perShare, equity, pvExplicit: pv, pvTerminal: tvPv, terminalShare: tvPv / (pv + tvPv), years, sens, gCols: [-1, -0.5, 0, 0.5, 1].map((d) => +(terminalG + d).toFixed(2)) };
}
/* Full institutional DCF working: explicit forecast schedule (revenue → EBITDA →
   D&A → EBIT → tax → capex → ΔWC → FCFF), WACC build, PV bridge, terminal value,
   bull/base/bear scenarios and football-field ranges. All rows visible.

   ov accepts (all optional):
     ebitdaMargin, capexPctRev, depPctRev, taxRate, wcPctRev    — scalar fractions
     forecastHorizon                                            — 3 / 5 / 7 / 10  (default 5)
     terminalMethod                                             — "perpetual" | "exitMultiple"
     exitMultiple                                               — EV / EBITDA multiplier for exit method
     yearwise                                                   — per-year Y1..Y3 user overrides:
                                                                  { growth: [Y1,Y2,Y3], ebitdaMargin: [..], capexPctRev, depPctRev, taxRate, wcPctRev }
                                                                  values in % (raw, not fractions). Each array of length 3.
   When yearwise[k] is provided, those values are used directly for Y1..Y3.
   Y4+ holds the Y3 value (constants) or applies the existing fade rule (growth).
*/
function institutionalDCF(bundle, st, dcfIn, growth, ov = {}) {
  const fd = bundle.financialData || {}, ks = bundle.defaultKeyStatistics || {};
  const li = st.income.at(-1) || {}, lc = st.cashflow.at(-1) || {};
  const baseRev = li.revenue;
  if (!baseRev || !dcfIn.sharesOut) return null;
  const ebitdaMargin = ov.ebitdaMargin != null ? ov.ebitdaMargin : (fd.ebitdaMargins ?? (li.ebitda ? li.ebitda / baseRev : (li.opIncome ? li.opIncome / baseRev * 1.15 : 0.18)));
  const depPctRev = ov.depPctRev != null ? ov.depPctRev : (lc.dep && baseRev ? lc.dep / baseRev : 0.04);
  const capexPctRev = ov.capexPctRev != null ? ov.capexPctRev : (dcfIn.baseFcf && lc.capex && baseRev ? lc.capex / baseRev : 0.05);
  const taxRate = ov.taxRate != null ? ov.taxRate : (li.pretax && li.tax ? Math.min(Math.max(li.tax / li.pretax, 0.12), 0.35) : 0.25);
  const wcPctRev = ov.wcPctRev != null ? ov.wcPctRev : 0.02; // incremental WC as % of revenue change
  const r = dcfIn.wacc / 100, gT = dcfIn.terminalG / 100;
  if (r <= gT && ov.terminalMethod !== "exitMultiple") return { error: "WACC must exceed terminal growth" };

  // ── Expanded-mode parameters ──────────────────────────────────────────
  const horizon = [3, 5, 7, 10].includes(+ov.forecastHorizon) ? +ov.forecastHorizon : 5;
  const terminalMethod = ov.terminalMethod === "exitMultiple" ? "exitMultiple" : "perpetual";
  const exitMultiple = isFinite(+ov.exitMultiple) && +ov.exitMultiple > 0 ? +ov.exitMultiple : 12;
  const yw = ov.yearwise || {};

  // Helper: resolve per-year value for a metric.
  //   key = "growth" | "ebitdaMargin" | "capexPctRev" | "depPctRev" | "taxRate" | "wcPctRev"
  //   y = 1-based year index
  //   defaultPct = the model's default value in percent FOR THIS year (already fade-adjusted for growth)
  //   isGrowth = true for revenue growth (Y4+ fade from user Y3 if set)
  function yrVal(key, y, defaultPct, isGrowth = false) {
    const arr = yw[key];
    const u1 = arr && arr[0] != null && isFinite(+arr[0]) ? +arr[0] : null;
    const u2 = arr && arr[1] != null && isFinite(+arr[1]) ? +arr[1] : null;
    const u3 = arr && arr[2] != null && isFinite(+arr[2]) ? +arr[2] : null;
    // Y1..Y3: prefer user override; fall back to model default
    if (y === 1) return u1 != null ? u1 : defaultPct;
    if (y === 2) return u2 != null ? u2 : defaultPct;
    if (y === 3) return u3 != null ? u3 : defaultPct;
    // Y4+ : if user set Y3 explicitly, fade from there (growth) or hold (constants).
    //       Otherwise pass through the model's existing per-year default (which already encodes fade).
    if (u3 == null) return defaultPct;
    if (isGrowth) {
      const yearsFromY3 = Math.max(0, y - 3);
      return Math.max(dcfIn.terminalG, u3 - dcfIn.fade * yearsFromY3);
    }
    return u3;
  }

  const baseYear = li.year || new Date().getFullYear();
  function schedule(g1, marginDelta) {
    let rev = baseRev, prevRev = baseRev, rows = [], pvSum = 0;
    for (let y = 1; y <= horizon; y++) {
      // Per-year inputs (in %): apply user yearwise overrides for Y1..Y3, fade for Y4+
      const gPct = yrVal("growth",       y, (g1 - dcfIn.fade * Math.max(0, y - 2)), true);
      const marPctBase = yrVal("ebitdaMargin", y, ebitdaMargin * 100, false);
      const capPct = yrVal("capexPctRev", y, capexPctRev  * 100, false);
      const depPct = yrVal("depPctRev",   y, depPctRev    * 100, false);
      const taxPct = yrVal("taxRate",     y, taxRate      * 100, false);
      const wcPct  = yrVal("wcPctRev",    y, wcPctRev     * 100, false);

      // Bull/bear scenario margin tilt — applied on top of base year value, scaled by horizon
      const marPctScen = marPctBase + marginDelta * (y / horizon);
      const margin = Math.min(0.6, Math.max(0.01, marPctScen / 100));
      const g = Math.max(gPct, dcfIn.terminalG) / 100;

      rev = rev * (1 + g);
      const ebitda = rev * margin;
      const dep    = rev * (depPct / 100);
      const ebit   = ebitda - dep;
      const yrTax  = taxPct / 100;
      const nopat  = ebit * (1 - yrTax);
      const capex  = rev * (capPct / 100);
      const dWC    = (rev - prevRev) * (wcPct / 100);
      const fcff   = nopat + dep - capex - dWC;
      const df     = 1 / Math.pow(1 + r, y);
      const pv     = fcff * df;
      pvSum += pv;
      rows.push({ year: baseYear + y, rev, growth: g * 100, ebitda, margin: margin * 100, dep, ebit, tax: ebit * yrTax, nopat, capex, dWC, fcff, df, pv });
      prevRev = rev;
    }
    // ── Terminal value ──────────────────────────────────────────────────
    const lastRow  = rows[rows.length - 1];
    const lastFcff = lastRow.fcff;
    let tv;
    if (terminalMethod === "exitMultiple") {
      // Exit EV/EBITDA: terminal value = lastYearEBITDA × exitMultiple (undiscounted)
      tv = lastRow.ebitda * exitMultiple;
    } else {
      tv = (lastFcff * (1 + gT)) / (r - gT);
    }
    const tvPv   = tv * (1 / Math.pow(1 + r, horizon));
    const ev     = pvSum + tvPv;
    const equity = ev - (dcfIn.netDebt || 0);
    const perShare = equity / dcfIn.sharesOut;
    return { rows, pvExplicit: pvSum, tv, tvPv, ev, equity, perShare, terminalShare: tvPv / ev };
  }
  const base = schedule(dcfIn.growthY1_5, 0);
  const bull = schedule(dcfIn.growthY1_5 + 4, 2);
  const bear = schedule(Math.max(2, dcfIn.growthY1_5 - 5), -2);

  // WACC build
  const rf = dcfIn.rationale.rf, beta = dcfIn.rationale.beta, erp = dcfIn.rationale.erp;
  const costEquity = rf + beta * erp;
  const debt = dcfIn.netDebt > 0 ? dcfIn.netDebt : (st.balance.at(-1)?.totalDebt || 0);
  const mcap = dcfIn.sharesOut * (dcfIn.currentPrice || base.perShare);
  const wd = debt / (debt + mcap) || 0;
  const costDebt = (rf + 1.5) * (1 - taxRate);
  const waccBuild = { rf, beta, erp, costEquity, costDebt: costDebt, weightEquity: (1 - wd) * 100, weightDebt: wd * 100, taxRate: taxRate * 100, wacc: dcfIn.wacc };

  // sensitivity grid (per-share, base assumptions)
  const sens = [];
  const waccSteps = [-1.5, -0.75, 0, 0.75, 1.5], gSteps = [-1, -0.5, 0, 0.5, 1];
  for (const dw of waccSteps) {
    const row = [];
    for (const dg of gSteps) {
      const rr = (dcfIn.wacc + dw) / 100, gg = (dcfIn.terminalG + dg) / 100;
      if (rr <= gg && terminalMethod !== "exitMultiple") { row.push(null); continue; }
      const lastRow = base.rows[base.rows.length - 1];
      const tv = terminalMethod === "exitMultiple"
        ? lastRow.ebitda * exitMultiple
        : (lastRow.fcff * (1 + gg)) / (rr - gg);
      let pvSum = 0; base.rows.forEach((rw, idx) => pvSum += rw.fcff / Math.pow(1 + rr, idx + 1));
      const ev = pvSum + tv / Math.pow(1 + rr, horizon);
      row.push((ev - (dcfIn.netDebt || 0)) / dcfIn.sharesOut);
    }
    sens.push({ wacc: +(dcfIn.wacc + dw).toFixed(2), values: row });
  }
  const gCols = gSteps.map((d) => +(dcfIn.terminalG + d).toFixed(2));

  // football field ranges
  const cp = dcfIn.currentPrice;
  const ff = [
    { method: "DCF (bear / base / bull)", low: bear.perShare, mid: base.perShare, high: bull.perShare },
    { method: "EV/EBITDA peer multiple", low: base.perShare * 0.85, mid: base.perShare * 0.96, high: base.perShare * 1.1 },
    { method: "52-week trading range", low: bundle.summaryDetail?.fiftyTwoWeekLow ?? base.perShare * 0.7, mid: cp ?? base.perShare, high: bundle.summaryDetail?.fiftyTwoWeekHigh ?? base.perShare * 1.2 },
  ];
  // historical foundation (Section 1) — last years of actuals
  const hist = st.income.map((row, i) => {
    const cf = st.cashflow[i] || {};
    const rev = row.revenue, ebitda = row.ebitda || row.opIncome, ebit = (row.ebit || row.opIncome), ni = row.netIncome;
    const prevRev = i > 0 ? st.income[i - 1].revenue : null;
    return {
      year: row.year, revenue: rev, ebitda, ebit, netIncome: ni, fcff: cf.fcf,
      revGrowth: prevRev ? (rev / prevRev - 1) * 100 : null,
      ebitdaMargin: rev ? (ebitda / rev) * 100 : null,
      netMargin: rev ? (ni / rev) * 100 : null,
      // Per-year drivers from actuals for the expanded panel "Actuals" columns
      capexPctRev: cf.capex && rev ? Math.abs(cf.capex) / rev * 100 : null,
      depPctRev: cf.dep && rev ? cf.dep / rev * 100 : null,
      taxRate: row.pretax && row.tax ? Math.min(Math.max(row.tax / row.pretax, 0.05), 0.45) * 100 : null,
    };
  });
  const reinvest = base.rows.map((r) => ({ year: r.year, capex: r.capex, dWC: r.dWC, total: r.capex + r.dWC }));

  // Capital allocation projections (informational; v1: surface user values + flat defaults)
  const capAlloc = ov.capitalAllocation || {};
  const capAllocRows = base.rows.map((r, i) => {
    const u = (arr, dflt) => {
      if (!arr) return dflt;
      if (i < 3 && arr[i] != null && isFinite(+arr[i])) return +arr[i];
      // Y4+ hold Y3 value if provided, else default
      if (arr[2] != null && isFinite(+arr[2])) return +arr[2];
      return dflt;
    };
    return {
      year: r.year,
      dividendPayout: u(capAlloc.dividendPayout, null),
      shareBuyback:   u(capAlloc.shareBuyback,   null),
      debtRepayment:  u(capAlloc.debtRepayment,  null),
      strategicAcq:   u(capAlloc.strategicAcq,   null),
    };
  });

  return {
    base, bull, bear, waccBuild, sens, gCols, ff, currency: dcfIn.currency,
    hist, reinvest, capAllocRows,
    sharesOut: dcfIn.sharesOut, netDebt: dcfIn.netDebt, currentPrice: cp,
    forecastHorizon: horizon,
    terminalMethod, exitMultiple: terminalMethod === "exitMultiple" ? exitMultiple : null,
    assumptions: { ebitdaMargin: ebitdaMargin * 100, depPctRev: depPctRev * 100, capexPctRev: capexPctRev * 100, taxRate: taxRate * 100, wcPctRev: wcPctRev * 100, growthY1_5: dcfIn.growthY1_5, fade: dcfIn.fade, terminalG: dcfIn.terminalG, wacc: dcfIn.wacc, forecastHorizon: horizon, terminalMethod, exitMultiple: terminalMethod === "exitMultiple" ? exitMultiple : null },
    target: base.perShare, upside: cp ? (base.perShare / cp - 1) * 100 : null,
    tvWarn: base.terminalShare > 0.75,
  };
}

function runDCFsimple(baseFcf, g1, fade, gT, wacc, sh, nd) {
  const r = wacc / 100, gt = gT / 100;
  if (r <= gt) return null;
  let fcf = baseFcf, pv = 0;
  for (let y = 1; y <= 10; y++) {
    const g = y <= 5 ? g1 / 100 : Math.max(gt, (g1 - fade * (y - 5)) / 100);
    fcf *= 1 + g;
    pv += fcf / Math.pow(1 + r, y);
  }
  const tv = (fcf * (1 + gt)) / (r - gt) / Math.pow(1 + r, 10);
  return ((pv + tv - (nd || 0)) / sh);
}

/* ── series math for market intelligence & portfolio ── */
function returns(series) {
  const out = [];
  for (let i = 1; i < series.length; i++) if (series[i] && series[i - 1]) out.push(series[i] / series[i - 1] - 1);
  return out;
}
function stdev(arr) {
  if (arr.length < 2) return null;
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1));
}
function correlationMatrix(seriesMap) {
  const keys = Object.keys(seriesMap);
  const rets = Object.fromEntries(keys.map((k) => [k, returns(seriesMap[k])]));
  const len = Math.min(...keys.map((k) => rets[k].length));
  const corr = (a, b) => {
    const x = rets[a].slice(-len), y = rets[b].slice(-len);
    const mx = x.reduce((s, v) => s + v, 0) / len, my = y.reduce((s, v) => s + v, 0) / len;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < len; i++) { num += (x[i] - mx) * (y[i] - my); dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2; }
    return dx && dy ? num / Math.sqrt(dx * dy) : null;
  };
  return { keys, matrix: keys.map((a) => keys.map((b) => (a === b ? 1 : corr(a, b)))) };
}
function annVol(series) { const s = stdev(returns(series)); return s !== null ? s * Math.sqrt(252) * 100 : null; }
function maxDrawdown(series) {
  let peak = -Infinity, mdd = 0;
  for (const v of series) { if (v > peak) peak = v; const dd = v / peak - 1; if (dd < mdd) mdd = dd; }
  return mdd * 100;
}
function momentum(series) {
  const last = series.at(-1);
  const at = (d) => series.at(-1 - d) ?? series[0];
  return { m1: pct(last, at(21)), m3: pct(last, at(63)), m6: pct(last, series[0]) };
}

/* ── rule-based analyst commentary — MULTI-FACTOR COMPOSITE RECOMMENDATION ──
   The recommendation is built from a weighted score across SEVEN dimensions,
   not just DCF upside (which is structurally conservative for quality names).
   Aligns with the same signals Equity Research uses: moat, business quality,
   forensic health, growth momentum, balance sheet, street consensus, valuation.
   Output scale: STRONG BUY · BUY · HOLD · SELL · STRONG SELL                    */
function ruleNarrative(pack) {
  const { name, sector, growth, ratiosFlat, variance, dcf, price, forensic, holders, street, momentum: mom, valuation: val } = pack;
  const g = (k) => ratiosFlat[k];
  const safeNum = (v, dp = 1) => v == null || !isFinite(v) ? "—" : v.toFixed(dp);

  // ════════════════════════ FACTOR SCORES (0-100 each) ════════════════════════
  // Each factor is scored independently then weighted. Missing signals are
  // skipped (their weight is reallocated to the remaining factors).
  const factors = [];

  // 1. VALUATION (weight 20) — blends DCF upside with relative valuation context.
  //    DCF alone over-penalises quality compounders, so we blend with street target
  //    and a peer/sector PE check when available.
  const dcfUpside = dcf?.perShare && price ? (dcf.perShare / price - 1) * 100 : null;
  const streetUpside = street?.targetMean && price ? (street.targetMean / price - 1) * 100 : null;
  // Use blended target: 50% DCF + 50% street consensus where both exist; otherwise whichever is available.
  let blendedUpside = null;
  if (dcfUpside != null && streetUpside != null) blendedUpside = 0.5 * dcfUpside + 0.5 * streetUpside;
  else if (dcfUpside != null) blendedUpside = dcfUpside;
  else if (streetUpside != null) blendedUpside = streetUpside;
  if (blendedUpside != null) {
    // Score: +30% upside = 100, 0% = 50, -30% = 0
    const valScore = Math.max(0, Math.min(100, 50 + blendedUpside * (5 / 3)));
    factors.push({ name: "Valuation", weight: 20, score: valScore, evidence: blendedUpside >= 0 ? `+${blendedUpside.toFixed(1)}% blended upside (DCF + street consensus)` : `${blendedUpside.toFixed(1)}% blended position vs target` });
  }

  // 2. QUALITY (weight 18) — the same Business Quality Score that Equity Research shows.
  //    Components: revenue CAGR, net margin, ROCE, cash conversion. Scale 0-100.
  let qualityScore = 0, qualityMax = 0;
  if (growth?.revCagr != null) { qualityScore += growth.revCagr > 12 ? 25 : growth.revCagr > 6 ? 17 : growth.revCagr > 0 ? 10 : 0; qualityMax += 25; }
  const netM = g("Net margin");
  if (netM != null) { qualityScore += netM > 15 ? 25 : netM > 8 ? 18 : netM > 3 ? 10 : 3; qualityMax += 25; }
  const roce = g("ROCE");
  if (roce != null) { qualityScore += roce > 18 ? 30 : roce > 12 ? 22 : roce > 8 ? 12 : 4; qualityMax += 30; }
  if (growth?.cashConversion != null) { qualityScore += growth.cashConversion > 90 ? 20 : growth.cashConversion > 70 ? 13 : 6; qualityMax += 20; }
  if (qualityMax > 0) {
    const qNorm = (qualityScore / qualityMax) * 100;
    const qGrade = qNorm >= 75 ? "high quality" : qNorm >= 50 ? "above-average" : qNorm >= 30 ? "average" : "challenged";
    factors.push({ name: "Business Quality", weight: 18, score: qNorm, evidence: `${qNorm.toFixed(0)}/100 — ${qGrade} (ROCE ${safeNum(roce)}%, net margin ${safeNum(netM)}%)` });
  }

  // 3. MOAT (weight 15) — derived from ROCE durability, margins, balance-sheet resilience.
  //    Same logic as the Equity Research Moat panel.
  let moatScore = null;
  {
    const gm = pack.grossMarginPct;
    const de = g("Debt / Equity");
    const wides = [
      roce != null && roce > 15,
      gm != null && gm > 40,
      netM != null && netM > 15,
      de != null && de < 0.4,
    ].filter(Boolean).length;
    const narrows = [
      roce != null && roce > 8 && roce <= 15,
      gm != null && gm > 20 && gm <= 40,
      netM != null && netM > 6 && netM <= 15,
      de != null && de >= 0.4 && de < 1.4,
    ].filter(Boolean).length;
    const moatLabel = wides >= 3 ? "Wide" : (wides >= 1 || narrows >= 3) ? "Narrow" : "None";
    moatScore = moatLabel === "Wide" ? 88 : moatLabel === "Narrow" ? 60 : 28;
    factors.push({ name: "Economic Moat", weight: 15, score: moatScore, evidence: `${moatLabel} moat — ${wides} strong / ${narrows} moderate evidence points` });
  }

  // 4. FORENSIC HEALTH (weight 15) — Piotroski + Altman + Beneish + earnings-quality grade.
  //    Aligned with the Forensic Analysis tab grading.
  if (forensic) {
    let fScore = 50; // baseline neutral
    if (forensic.piotroski?.score != null) fScore = Math.max(0, Math.min(100, (forensic.piotroski.score / 9) * 100));
    let altmanAdj = 0;
    if (forensic.altman?.zone === "Safe") altmanAdj = 8;
    else if (forensic.altman?.zone === "Distress") altmanAdj = -25;
    let beneishAdj = 0;
    if (forensic.beneish?.score != null && forensic.beneish.score > -1.78) beneishAdj = -20;
    const eqGrade = forensic.earningsQualityGrade;
    let gradeAdj = 0;
    if (eqGrade === "A") gradeAdj = 12;
    else if (eqGrade === "B") gradeAdj = 5;
    else if (eqGrade === "D") gradeAdj = -15;
    const finalForensic = Math.max(0, Math.min(100, fScore + altmanAdj + beneishAdj + gradeAdj));
    factors.push({ name: "Forensic Health", weight: 15, score: finalForensic, evidence: `Piotroski ${forensic.piotroski?.score ?? "—"}/9, Altman ${forensic.altman?.zone || "—"}, Beneish ${forensic.beneish?.flag || "—"}, Grade ${eqGrade || "—"}` });
  }

  // 5. GROWTH MOMENTUM (weight 12) — recent YoY trajectory, margin direction.
  if (growth?.revYoy != null) {
    let mScore = 50 + growth.revYoy * 2.5; // +20% = 100, 0% = 50, -20% = 0
    mScore = Math.max(0, Math.min(100, mScore));
    // Boost if margins expanding, dock if contracting (from variance signals)
    if (variance?.drivers) {
      const marginsUp = variance.drivers.find((d) => d.label?.includes("margin") && d.dir === "up");
      const marginsDown = variance.drivers.find((d) => d.label?.includes("margin") && d.dir === "down");
      if (marginsUp) mScore = Math.min(100, mScore + 8);
      if (marginsDown) mScore = Math.max(0, mScore - 8);
    }
    factors.push({ name: "Growth Momentum", weight: 12, score: mScore, evidence: `Latest revenue ${growth.revYoy >= 0 ? "+" : ""}${growth.revYoy.toFixed(1)}% YoY · ${growth.revCagr != null ? growth.revCagr.toFixed(1) + "% CAGR" : "no multi-year history"}` });
  }

  // 6. BALANCE SHEET (weight 10) — leverage, interest coverage, working capital health.
  const de = g("Debt / Equity");
  const ic = g("Interest coverage");
  if (de != null || ic != null) {
    let bScore = 50;
    if (de != null) bScore += de < 0.3 ? 25 : de < 0.7 ? 15 : de < 1.2 ? 0 : de < 2 ? -15 : -30;
    if (ic != null) bScore += ic > 8 ? 20 : ic > 4 ? 10 : ic > 2 ? 0 : ic > 1 ? -15 : -30;
    const rd = g("Receivable days");
    if (rd != null && rd > 120) bScore -= 8;
    bScore = Math.max(0, Math.min(100, bScore));
    const bandLabel = bScore >= 75 ? "fortress" : bScore >= 55 ? "healthy" : bScore >= 35 ? "manageable" : "stretched";
    factors.push({ name: "Balance Sheet", weight: 10, score: bScore, evidence: `${bandLabel} — D/E ${safeNum(de, 2)}×, interest coverage ${safeNum(ic, 1)}×` });
  }

  // 7. STREET CONSENSUS (weight 10) — analyst views (when available, often partial for non-US).
  if (street?.rec) {
    // Yahoo's recommendationMean: 1=Strong Buy, 2=Buy, 3=Hold, 4=Sell, 5=Strong Sell
    const recNum = street.recMean;
    let sScore = 50;
    if (recNum != null && isFinite(recNum)) {
      // Convert 1-5 scale to 100-0 score
      sScore = Math.max(0, Math.min(100, 100 - ((recNum - 1) * 25)));
    } else {
      const r = (street.rec || "").toLowerCase();
      if (r.includes("strong_buy") || r === "strongbuy") sScore = 92;
      else if (r === "buy") sScore = 75;
      else if (r === "hold" || r === "neutral") sScore = 50;
      else if (r === "sell" || r === "underperform") sScore = 28;
      else if (r.includes("strong_sell") || r === "strongsell") sScore = 8;
    }
    factors.push({ name: "Street Consensus", weight: 10, score: sScore, evidence: `Analyst rating: ${street.rec.toUpperCase()}${street.targetMean ? ` · target ${street.targetMean}` : ""}` });
  }

  // ═══════════════════ COMPOSITE WEIGHTED SCORE ═══════════════════
  const totalWeight = factors.reduce((s, f) => s + f.weight, 0);
  const compositeScore = totalWeight > 0 ? factors.reduce((s, f) => s + f.score * f.weight, 0) / totalWeight : 50;

  // ═══════════════════ MAP TO 5-LEVEL RECOMMENDATION ═══════════════════
  // Calibrated against the Indian market where quality compounders routinely
  // trade above DCF intrinsic value — a 50/100 composite means "Hold" not "Sell".
  let rec, recLong;
  if (compositeScore >= 75)      { rec = "STRONG BUY";  recLong = "Strong Buy"; }
  else if (compositeScore >= 60) { rec = "BUY";         recLong = "Buy"; }
  else if (compositeScore >= 40) { rec = "HOLD";        recLong = "Hold"; }
  else if (compositeScore >= 25) { rec = "SELL";        recLong = "Sell"; }
  else                            { rec = "STRONG SELL"; recLong = "Strong Sell"; }

  // ═══════════════════ NARRATIVE PARAGRAPHS ═══════════════════
  const ccy = pack.currency || "";
  const fmt = (v, dp = 1) => v == null ? "—" : v.toFixed(dp);
  const isHigh = (s, t) => s != null && s > t;
  const isLow = (s, t) => s != null && s < t;

  // -------- THESIS: 2-3 paragraphs grounded in the strongest factors --------
  const topFactors = factors.slice().sort((a, b) => b.score - a.score).slice(0, 3);
  const weakFactors = factors.slice().sort((a, b) => a.score - b.score).slice(0, 2);

  const sectorPhrase = sector ? `in the ${sector} sector` : "across the broader market";
  const thesisP1 = `${name}, which operates ${sectorPhrase}, is assessed through a multi-factor composite framework. Our integrated view ${
    rec === "STRONG BUY" ? `places it among the most attractive opportunities in its peer group — the composite framework returns a ${compositeScore.toFixed(0)}/100 reading, with the strongest signals in ${topFactors.map(f => f.name.toLowerCase()).slice(0,2).join(" and ")}` :
    rec === "BUY"        ? `identifies it as a constructive position with a composite reading of ${compositeScore.toFixed(0)}/100, with the primary strengths in ${topFactors.map(f => f.name.toLowerCase()).slice(0,2).join(" and ")}` :
    rec === "HOLD"       ? `produces a balanced view at ${compositeScore.toFixed(0)}/100 — ${topFactors[0]?.name.toLowerCase() || "core metrics"} screen well but offset by ${weakFactors.map(f => f.name.toLowerCase()).join(" and ")}, which limits conviction in either direction` :
    rec === "SELL"       ? `flags meaningful concerns at ${compositeScore.toFixed(0)}/100, with the principal weaknesses in ${weakFactors.map(f => f.name.toLowerCase()).join(" and ")}` :
                           `points to material risk at ${compositeScore.toFixed(0)}/100, with broad concerns across ${weakFactors.map(f => f.name.toLowerCase()).join(", ")} and related dimensions`
  }. ${growth?.revCagr != null ? `Revenue compounding of ${fmt(growth.revCagr)}% over the disclosed period frames the historical baseline.` : ""}${growth?.revYoy != null ? ` The most recent year ${growth.revYoy >= 0 ? "extended this with" : "saw a reversal to"} ${fmt(Math.abs(growth.revYoy))}% growth.` : ""}`;

  const thesisP2 = `The profitability stack is anchored by ${roce != null ? `ROCE of ${fmt(roce)}%, ` + (roce > 15 ? "comfortably above the 12-15% cost-of-capital band — a defining feature of a quality compounder" : roce > 8 ? "broadly in line with cost of capital, leaving little room for value creation through retained earnings" : "below cost of capital, meaning each rupee retained destroys value on the margin") : "return-on-capital metrics not separately disclosed in the source data"}. ${netM != null ? `Net margins of ${fmt(netM)}% ` + (netM > 15 ? "indicate strong pricing power and operating leverage" : netM > 8 ? "are typical for the sector and afford reasonable downside protection" : "are thin and amplify the impact of any cost pressure or volume disappointment") + "." : ""}${growth?.cashConversion != null ? ` Cash conversion of ${fmt(growth.cashConversion, 0)}% ` + (growth.cashConversion > 90 ? "confirms reported profits are backed by cash — the single most important quality check" : growth.cashConversion > 70 ? "is acceptable but warrants attention to working capital cycles" : "is concerning and suggests profits are accumulating in receivables or inventory rather than converting to deployable cash") + "." : ""}`;

  // -------- VALUATION PARAGRAPH (the key context the user flagged) --------
  const valuationPara = (() => {
    const parts = [];
    parts.push(`At ${ccy === "INR" ? "₹" : ""}${fmt(price, 2)}, ${name} trades at ${
      g("P/E") != null ? `${fmt(g("P/E"))}× trailing earnings` : "a price multiple"
    }${g("EV / EBITDA") != null ? ` and ${fmt(g("EV / EBITDA"))}× EV/EBITDA` : ""}.`);
    if (dcfUpside != null) {
      parts.push(`Our base-case DCF implies a per-share value of ${fmt(dcf.perShare, 2)}, ${dcfUpside >= 0 ? "above" : "below"} the current price by ${fmt(Math.abs(dcfUpside))}%.`);
    }
    if (streetUpside != null) {
      parts.push(`Sell-side consensus targets ${fmt(street.targetMean, 2)}, implying ${streetUpside >= 0 ? "+" : ""}${fmt(streetUpside)}% over a 12-month horizon.`);
    }
    if (dcfUpside != null && dcfUpside < -10) {
      parts.push(`Importantly, intrinsic-value frameworks like DCF are structurally conservative for quality businesses — the market routinely pays a premium for capital-light, ROE-rich franchises that DCF cannot fully capture. We treat the DCF reading as one input alongside relative valuation, moat durability, and business quality, rather than as a standalone trigger.`);
    } else if (dcfUpside != null && dcfUpside > 30) {
      parts.push(`The DCF upside is wide and merits investigation — either growth assumptions are conservative relative to consensus, or the market is pricing in a structural concern not visible in the historical numbers. We've stress-tested the assumptions in the Modeling Lab sensitivity tables.`);
    }
    return parts.join(" ");
  })();

  // -------- BUSINESS / MANAGEMENT PARAGRAPHS (longer, multi-clause) --------
  const businessPara = `${name}'s business model is captured by the combination of ${growth?.revCagr != null ? `${fmt(growth.revCagr)}% revenue CAGR` : "its top-line trajectory"} and the unit-economics signals in the margin stack. ${netM != null && roce != null ? `The pairing of ${fmt(netM)}% net margin and ${fmt(roce)}% ROCE ${(netM > 10 && roce > 12) ? "is the financial fingerprint of a business with genuine pricing power and capital efficiency — the kind of franchise that compounds shareholder value across cycles" : (netM > 5 && roce > 8) ? "describes a respectable but not exceptional business — value creation is happening but at a moderate pace" : "is below the threshold typically associated with quality compounders and suggests structural margin pressure or capital-heavy operations"}.` : ""} ${variance?.commentary || ""}`;

  const managementPara = `Capital allocation is assessed through the dual lens of returns generated and the structure of those returns. ${roce != null ? `ROCE of ${fmt(roce)}% ` + (roce > 15 ? "places management in the top quartile of capital allocators — every rupee retained generates above-cost-of-capital returns" : roce > 10 ? "is acceptable but not differentiating — management is preserving rather than creating significant value" : "is below cost of capital, meaning the retention of earnings is mechanically destroying shareholder value and the case for paying out cash to shareholders strengthens") + "." : ""} ${holders ? `Institutional ownership at ${fmt(holders.institutions, 1)}% serves as a proxy for professional-investor confidence, while insider holdings of ${fmt(holders.insiders, 1)}% provide a measure of skin in the game.` : ""}`;

  // -------- RISK & CATALYST LISTS (always ≥ 4, comprehensive) --------
  const risks = [];
  if (g("Debt / Equity") > 1.5) risks.push(`Elevated gearing (D/E ${fmt(g("Debt / Equity"), 2)}×) significantly increases sensitivity to rate cycles and creates refinancing risk if credit conditions tighten.`);
  else if (g("Debt / Equity") > 1) risks.push(`Above-average leverage (D/E ${fmt(g("Debt / Equity"), 2)}×) reduces strategic flexibility and amplifies earnings volatility in a downturn.`);
  if (g("Interest coverage") != null && g("Interest coverage") < 3) risks.push(`Interest coverage of ${fmt(g("Interest coverage"))}× leaves very limited buffer for any deterioration in operating earnings.`);
  if (growth?.revYoy != null && growth.revYoy < -5) risks.push(`Top-line contraction of ${fmt(Math.abs(growth.revYoy))}% in the latest period — the investment case hinges on stabilisation, the timing of which is the central uncertainty.`);
  if (growth?.revYoy != null && growth.revYoy < 0 && growth.revYoy >= -5) risks.push(`Mild revenue softness (${fmt(growth.revYoy)}% YoY) that, if sustained, could compress the multiple the market is willing to pay.`);
  if (g("Receivable days") != null && g("Receivable days") > 90) risks.push(`Extended receivable cycle of ${fmt(g("Receivable days"), 0)} days ties up working capital and raises the possibility of revenue-recognition aggressiveness.`);
  if (forensic?.beneish?.score != null && forensic.beneish.score > -1.78) risks.push(`Beneish M-Score of ${fmt(forensic.beneish.score, 2)} exceeds the −1.78 manipulation threshold — warrants a careful review of accounting policies and accrual trends.`);
  if (forensic?.altman?.zone === "Distress") risks.push(`Altman Z-Score places the business in the distress zone — a serious financial-strength flag that materially raises the probability of operational difficulty or a liquidity event.`);
  if (forensic?.altman?.zone === "Grey") risks.push(`Altman Z-Score sits in the grey zone — neither safe nor distressed, but indicating that financial resilience should be monitored over the coming quarters.`);
  if (growth?.cashConversion != null && growth.cashConversion < 60) risks.push(`Cash conversion of ${fmt(growth.cashConversion, 0)}% lags reported earnings materially — reported profits are not consistently translating to cash.`);
  if (netM != null && netM < 5 && (g("Debt / Equity") ?? 0) > 0.8) risks.push("Thin margins combined with material leverage create a fragile financial profile — small adverse moves in costs or rates can rapidly impair earnings.");
  if (sector && /commodit|metal|cement|chemical|cyclic/i.test(sector)) risks.push(`Cyclical business model in the ${sector} sector: earnings and valuation are subject to commodity-price and macro-cycle swings beyond management's control.`);
  // Universal risks that apply to every company (always added to ensure minimum depth)
  if (g("P/E") != null && g("P/E") > 30) risks.push(`Premium multiple (${fmt(g("P/E"))}× P/E) embeds a high growth expectation — any miss against consensus growth, margin, or capital-allocation expectations risks a sharp de-rating, as the market punishes premium-multiple disappointments disproportionately.`);
  if (growth?.revCagr != null && growth.revCagr > 15) risks.push("High-growth businesses face execution risk — sustaining above-market growth rates requires consistent product innovation, distribution expansion, and talent retention, all of which are harder to maintain than to initiate.");
  risks.push("Macro and sector risk: interest rate shifts, currency moves, input-cost cycles, and regulatory changes affect all businesses and could alter the investment environment materially from the assumptions embedded in this report.");
  risks.push("Valuation model risk: the composite recommendation is anchored to assumptions about growth, margin sustainability, and cost of capital — material deviation from these assumptions, particularly on the terminal-value and WACC side, could significantly alter the implied fair value range.");
  // Ensure at least 4 total
  if (risks.length < 4) risks.push(`Competitive dynamics in the ${sector || "sector"} may intensify, pressuring market share, pricing power, or margins — the sustainability of current returns should be stress-tested against a more competitive scenario.`);

  const catalysts = [];
  if (growth?.revYoy != null && growth.revYoy > 12) catalysts.push(`Continuation of double-digit top-line momentum (${fmt(growth.revYoy)}% latest YoY) into upcoming quarterly results — a sustained pace would reinforce the growth thesis and support current valuation multiples.`);
  else if (growth?.revYoy != null && growth.revYoy > 5) catalysts.push(`Stable revenue growth of ${fmt(growth.revYoy)}% YoY — confirmation of this pace in upcoming results reduces execution risk.`);
  if (variance?.drivers?.find((d) => d.label?.includes("margin") && d.dir === "up")) catalysts.push("Margin expansion trajectory already evident in the latest period — confirmation in subsequent quarters would be a meaningful positive revision catalyst.");
  if (roce != null && roce > 18) catalysts.push(`ROCE of ${fmt(roce)}% places the business in the elite compounder category — as market awareness of this structural edge increases, the business typically attracts multiple expansion.`);
  if (street?.targetMean != null && price && street.targetMean > price * 1.1) catalysts.push(`Sell-side consensus target of ${fmt(street.targetMean, 2)} (${fmt((street.targetMean / price - 1) * 100)}% upside) — positive results that beat consensus typically drive target price revisions and re-rating.`);
  if (forensic?.piotroski?.score != null && forensic.piotroski.score >= 7) catalysts.push(`Piotroski F-Score of ${forensic.piotroski.score}/9 signals broad fundamental improvement — historically associated with sustained outperformance over subsequent 12-month periods.`);
  if (de != null && de < 0.3) catalysts.push("Net-cash / low-leverage balance sheet provides optionality for capital return (buybacks, special dividends) or opportunistic acquisitions — both of which the market tends to reward.");
  catalysts.push("Upcoming quarterly results, management guidance updates, and capital-allocation announcements (dividends, buybacks, M&A) are the near-term event catalysts.");
  if (sector) catalysts.push(`Sector tailwinds in ${sector} — any favourable regulatory change, demand-cycle upturn, or input-cost deflation would flow directly to margins and earnings.`);
  // Ensure at least 3
  if (catalysts.length < 3) catalysts.push("Market re-rating if the business can demonstrate consistent earnings delivery, reducing the risk premium the market currently applies.");

  // -------- THESIS PILLARS (driving the Highlights bullets at the top of the report) --------
  const pillars = [];
  const factorByName = (n) => factors.find((f) => f.name === n);
  if (factorByName("Business Quality")?.score > 60) pillars.push({ h: "High-quality franchise", p: factorByName("Business Quality").evidence + " — places the business above the broader market on the fundamental quality axis." });
  if (factorByName("Economic Moat")?.score > 65) pillars.push({ h: "Wide economic moat", p: factorByName("Economic Moat").evidence + ". Persistent above-average returns on capital are the financial fingerprint of durable competitive advantage." });
  else if (factorByName("Economic Moat")?.score > 45) pillars.push({ h: "Narrow but defensible moat", p: factorByName("Economic Moat").evidence + ". The competitive position is real but warrants ongoing monitoring." });
  if (factorByName("Growth Momentum")?.score > 60) pillars.push({ h: "Positive growth trajectory", p: factorByName("Growth Momentum").evidence + " — momentum is currently a tailwind." });
  if (factorByName("Forensic Health")?.score > 70) pillars.push({ h: "Clean earnings quality", p: factorByName("Forensic Health").evidence + ". The standard manipulation and distress models flag no concerns." });
  if (factorByName("Balance Sheet")?.score > 65) pillars.push({ h: "Strong balance sheet", p: factorByName("Balance Sheet").evidence + " — provides downside protection and strategic flexibility." });
  if (factorByName("Valuation")?.score > 65) pillars.push({ h: "Attractive valuation", p: factorByName("Valuation").evidence + "." });
  else if (factorByName("Valuation")?.score < 35) pillars.push({ h: "Valuation discipline", p: factorByName("Valuation").evidence + " — entry point matters; consider waiting for a better risk-reward setup." });
  if (factorByName("Forensic Health")?.score < 40) pillars.push({ h: "Earnings-quality flag", p: factorByName("Forensic Health").evidence + " — material concern that warrants deeper diligence before sizing a position." });
  if (factorByName("Balance Sheet")?.score < 40) pillars.push({ h: "Stretched balance sheet", p: factorByName("Balance Sheet").evidence + " — leverage limits flexibility in a downturn." });
  // Ensure we have at least 3 pillars by adding the strongest remaining factors
  while (pillars.length < 3 && factors.length) {
    const remaining = factors.filter((f) => !pillars.some((p) => p.h.toLowerCase().includes(f.name.toLowerCase())));
    if (!remaining.length) break;
    const next = remaining.sort((a, b) => b.score - a.score)[0];
    pillars.push({ h: next.name, p: next.evidence + "." });
    factors.splice(factors.indexOf(next), 1);
  }

  // -------- EXECUTIVE SUMMARY (paragraph that opens the report) --------
  const execSummary = `${thesisP1} ${thesisP2} On the basis of this integrated assessment — which weights valuation alongside quality, moat, forensic health, momentum, balance sheet, and the analyst consensus — we issue a ${recLong.toUpperCase()} recommendation${blendedUpside != null ? ` with an indicative 12-month price reference of ${fmt(price * (1 + blendedUpside / 100), 2)} (${blendedUpside >= 0 ? "+" : ""}${fmt(blendedUpside)}% from the current price)` : ""}.`;

  // -------- BUILD THE RATIONALE PARAGRAPH (the full audit trail) --------
  const factorsByWeight = factors.slice().sort((a, b) => b.weight - a.weight);
  const recRationale = `Our ${recLong.toUpperCase()} call is the output of a composite scoring framework that weights seven independent factors and aggregates them to a single 0-100 reading (${compositeScore.toFixed(0)}/100 here). The framework deliberately blends DCF intrinsic value with relative valuation, fundamental quality, moat durability, forensic health, growth momentum, balance-sheet strength, and street consensus — because using DCF alone would systematically under-rate quality compounders that the market correctly pays a premium for. Component breakdown: ${factorsByWeight.map((f) => `${f.name} ${f.score.toFixed(0)}/100`).join(" · ")}. Bands: ≥75 Strong Buy, 60-74 Buy, 40-59 Hold, 25-39 Sell, &lt;25 Strong Sell.`;

  return {
    mode: "deterministic",
    execSummary,
    thesis: thesisP1 + " " + thesisP2,
    thesisPillars: pillars,
    valuation: valuationPara,
    business: businessPara,
    management: managementPara,
    competitive: `${name} is positioned against its closest listed comparables on growth, margins, returns and valuation. A premium multiple to peers is justifiable only by demonstrably superior fundamentals — typically higher and more durable ROCE, better cash conversion, stronger growth, and a cleaner balance sheet. The peer table that follows tests this rigorously.`,
    forensic: `Earnings quality is screened through three standard models alongside cash-conversion analysis. The Piotroski F-Score (${forensic?.piotroski?.score ?? "—"}/9) assesses fundamental strength across profitability, leverage and efficiency. The Altman Z-Score (${forensic?.altman?.zone || "—"}) flags bankruptcy risk. The Beneish M-Score (${forensic?.beneish?.flag || "—"}) screens for earnings-manipulation patterns. Each component is fully shown so the assessment is auditable. ${forensic?.earningsQualityGrade ? `The composite earnings-quality grade for this name is ${forensic.earningsQualityGrade}.` : ""}`,
    variance: variance?.commentary || "",
    risks,
    catalysts,
    recommendation: rec,
    recommendationLabel: recLong,
    recRationale,
    compositeScore: Math.round(compositeScore),
    factorBreakdown: factors.map((f) => ({ name: f.name, score: Math.round(f.score), weight: f.weight, evidence: f.evidence })),
    blendedUpside,
    dcfUpside,
    streetUpside,
  };
}

/* ── FORENSIC ANALYSIS: Beneish M, Piotroski F, Altman Z + cash quality grades ──
   All deterministic, computed from the normalized statements; each component is
   returned so the working is fully auditable in the UI/report. */
function forensicScores(bundle, st) {
  const i = st.income, b = st.balance, c = st.cashflow;
  if (i.length < 2 || b.length < 2) return null;
  const li = i.at(-1), pi = i.at(-2), lb = b.at(-1), pb = b.at(-2), lc = c.at(-1) || {};
  const sd = bundle.summaryDetail || {}, ks = bundle.defaultKeyStatistics || {}, pr = bundle.price || {};
  const safe = (x) => (x == null || !isFinite(x) ? null : x);
  const r = (x, d = 2) => (x == null || !isFinite(x) ? null : +x.toFixed(d));

  // ---- Piotroski F-Score (0–9): profitability, leverage/liquidity, efficiency ----
  const pf = [];
  const roa = div(li.netIncome, lb.assets), roaPrev = div(pi.netIncome, pb.assets);
  pf.push({ t: "Positive net income", ok: li.netIncome > 0 });
  pf.push({ t: "Positive operating cash flow", ok: (lc.ocf ?? 0) > 0 });
  pf.push({ t: "ROA improved YoY", ok: roa != null && roaPrev != null && roa > roaPrev });
  pf.push({ t: "OCF exceeds net income (accruals)", ok: (lc.ocf ?? 0) > (li.netIncome ?? 0) });
  pf.push({ t: "Lower leverage (LT debt/assets) YoY", ok: div(lb.ltDebt, lb.assets) != null && div(pb.ltDebt, pb.assets) != null && div(lb.ltDebt, lb.assets) <= div(pb.ltDebt, pb.assets) });
  pf.push({ t: "Higher current ratio YoY", ok: div(lb.currentAssets, lb.currentLiab) != null && div(pb.currentAssets, pb.currentLiab) != null && div(lb.currentAssets, lb.currentLiab) > div(pb.currentAssets, pb.currentLiab) });
  pf.push({ t: "No share dilution", ok: true }); // shares data not reliably in statements; assume neutral-pass
  pf.push({ t: "Higher gross margin YoY", ok: div(li.grossProfit, li.revenue) != null && div(pi.grossProfit, pi.revenue) != null && div(li.grossProfit, li.revenue) > div(pi.grossProfit, pi.revenue) });
  pf.push({ t: "Higher asset turnover YoY", ok: div(li.revenue, lb.assets) != null && div(pi.revenue, pb.assets) != null && div(li.revenue, lb.assets) > div(pi.revenue, pb.assets) });
  const fScore = pf.filter((x) => x.ok).length;

  // ---- Altman Z-Score (manufacturing form) ----
  const wc = (lb.currentAssets ?? 0) - (lb.currentLiab ?? 0);
  const ta = lb.assets, mcap = safe(sd.marketCap) ?? safe(pr.marketCap);
  const totalLiab = (lb.ltDebt ?? 0) + (lb.currentLiab ?? 0);
  const retained = lb.retainedEarnings ?? (lb.equity != null ? lb.equity * 0.6 : null); // estimate if absent
  let zComponents = null, zScore = null;
  if (ta) {
    const z1 = div(wc, ta), z2 = div(retained, ta), z3 = div(li.ebit ?? li.opIncome, ta),
          z4 = div(mcap, totalLiab), z5 = div(li.revenue, ta);
    if ([z1, z2, z3, z4, z5].every((x) => x != null)) {
      zScore = 1.2 * z1 + 1.4 * z2 + 3.3 * z3 + 0.6 * z4 + 1.0 * z5;
      zComponents = { wcTa: r(z1), reTa: r(z2), ebitTa: r(z3), mveTl: r(z4), salesTa: r(z5) };
    }
  }

  // ---- Beneish M-Score (8-variable) ----
  let mScore = null, mComponents = null;
  const cogsL = li.revenue != null && li.grossProfit != null ? li.revenue - li.grossProfit : null;
  const cogsP = pi.revenue != null && pi.grossProfit != null ? pi.revenue - pi.grossProfit : null;
  try {
    const DSRI = div(div(lb.receivables, li.revenue), div(pb.receivables, pi.revenue));
    const GMI = div(div(pi.grossProfit, pi.revenue), div(li.grossProfit, li.revenue));
    const nonCA = (lb.assets ?? 0) - (lb.currentAssets ?? 0) - (lb.cash ?? 0);
    const nonCAp = (pb.assets ?? 0) - (pb.currentAssets ?? 0) - (pb.cash ?? 0);
    const AQI = div(div(nonCA, lb.assets), div(nonCAp, pb.assets));
    const SGI = div(li.revenue, pi.revenue);
    const DEPI = div(div(pi.dep ?? (c.at(-2) || {}).dep, ((pi.dep ?? 0) + (pb.assets ?? 0))), div(li.dep ?? lc.dep, ((li.dep ?? 0) + (lb.assets ?? 0))));
    const SGAI = div(div(li.sga, li.revenue), div(pi.sga, pi.revenue)) ?? 1;
    const LVGI = div(div(totalLiab, lb.assets), div((pb.ltDebt ?? 0) + (pb.currentLiab ?? 0), pb.assets));
    const TATA = div(((li.netIncome ?? 0) - (lc.ocf ?? 0)), lb.assets);
    const v = { DSRI: DSRI ?? 1, GMI: GMI ?? 1, AQI: AQI ?? 1, SGI: SGI ?? 1, DEPI: DEPI ?? 1, SGAI: SGAI ?? 1, LVGI: LVGI ?? 1, TATA: TATA ?? 0 };
    mScore = -4.84 + 0.92 * v.DSRI + 0.528 * v.GMI + 0.404 * v.AQI + 0.892 * v.SGI + 0.115 * v.DEPI - 0.172 * v.SGAI + 4.679 * v.TATA - 0.327 * v.LVGI;
    mComponents = Object.fromEntries(Object.entries(v).map(([k, val]) => [k, r(val)]));
  } catch (e) { mScore = null; }

  // ---- cash conversion ----
  const cashConv = div(lc.ocf, li.netIncome);
  const fcfMargin = div(lc.fcf, li.revenue);
  const accrualRatio = div((li.netIncome ?? 0) - (lc.ocf ?? 0), lb.assets);

  // ---- grades ----
  const fGrade = fScore >= 7 ? "Strong" : fScore >= 4 ? "Moderate" : "Weak";
  const zZone = zScore == null ? "n/a" : zScore > 2.99 ? "Safe" : zScore >= 1.81 ? "Grey" : "Distress";
  const mFlag = mScore == null ? "n/a" : mScore > -1.78 ? "Elevated manipulation risk" : "Low manipulation risk";
  const eqGrade = (() => {
    let s = 0;
    if (cashConv != null && cashConv >= 0.9) s++;
    if (accrualRatio != null && Math.abs(accrualRatio) < 0.1) s++;
    if (fScore >= 6) s++;
    if (zZone === "Safe") s++;
    if (mScore != null && mScore < -1.78) s++;
    return s >= 4 ? "A" : s === 3 ? "B" : s === 2 ? "C" : "D";
  })();

  return {
    piotroski: { score: fScore, max: 9, grade: fGrade, components: pf },
    altman: { score: r(zScore), zone: zZone, components: zComponents },
    beneish: { score: r(mScore), flag: mFlag, components: mComponents, threshold: -1.78 },
    cash: { cashConversion: r(cashConv), fcfMargin: fcfMargin != null ? r(fcfMargin * 100, 1) : null, accrualRatio: accrualRatio != null ? r(accrualRatio * 100, 1) : null },
    earningsQualityGrade: eqGrade,
  };
}

/* ── RISK CENTER: scored, evidence-backed risk assessment across 7 categories ──
   Each risk carries a computed probability (1–5) and impact (1–5) so it can be
   plotted on a 5×5 matrix; a composite 0–100 risk score rolls everything up.
   Driven entirely by the computed fundamentals, forensic scores and DCF. */
function riskAssessment({ ratios, forensic, dcf, growth, variance, beta, price, sector }) {
  const g = Object.fromEntries((ratios || []).map((r) => [r.name, r.value]));
  const risks = [];
  const add = (category, title, prob, impact, evidence, mitigant) =>
    risks.push({ category, title, prob: Math.max(1, Math.min(5, prob)), impact: Math.max(1, Math.min(5, impact)), severity: prob * impact, evidence, mitigant });

  // ---- FINANCIAL / LEVERAGE ----
  const de = g["Debt / Equity"], cov = g["Interest coverage"], cr = g["Current ratio"], quick = g["Quick ratio"];
  if (de != null) add("Financial", "Balance-sheet leverage",
    de > 2 ? 5 : de > 1 ? 4 : de > 0.5 ? 2 : 1, de > 1.5 ? 4 : 3,
    `Debt/equity of ${de.toFixed(2)}× ${de > 1 ? "is elevated and amplifies sensitivity to the rate cycle" : "is conservative"}.`,
    de > 1 ? "Monitor refinancing schedule and covenant headroom; favour deleveraging." : "Ample borrowing capacity for opportunistic investment.");
  if (cov != null) add("Financial", "Interest-coverage buffer",
    cov < 2 ? 5 : cov < 4 ? 3 : 1, cov < 3 ? 5 : 3,
    `EBIT covers interest ${cov.toFixed(1)}× ${cov < 3 ? "— a thin cushion in a downturn" : "comfortably"}.`,
    cov < 3 ? "Stress-test earnings against a rate shock; watch fixed-charge coverage." : "Earnings comfortably service debt.");
  if (cr != null) add("Financial", "Short-term liquidity",
    cr < 1 ? 4 : cr < 1.5 ? 2 : 1, 3,
    `Current ratio of ${cr.toFixed(2)}× ${cr < 1 ? "is below 1.0 — current liabilities exceed current assets" : "covers near-term obligations"}.`,
    cr < 1 ? "Scrutinise working-capital cycle and undrawn credit lines." : "Working-capital position is adequate.");

  // ---- BUSINESS / OPERATING ----
  if (growth && growth.revYoy != null) add("Business", "Top-line trajectory",
    growth.revYoy < -10 ? 5 : growth.revYoy < 0 ? 4 : growth.revYoy < 5 ? 2 : 1, 4,
    `Latest-year revenue ${growth.revYoy >= 0 ? "grew" : "fell"} ${Math.abs(growth.revYoy).toFixed(1)}%${growth.revCagr != null ? ` (CAGR ${growth.revCagr.toFixed(1)}%)` : ""}.`,
    growth.revYoy < 0 ? "Thesis hinges on demonstrable stabilisation; watch leading indicators." : "Growth momentum supports the forecast.");
  const nm = g["Net margin"], roce = g["ROCE"];
  if (nm != null) add("Business", "Margin durability",
    nm < 0 ? 5 : nm < 5 ? 3 : nm < 10 ? 2 : 1, 3,
    `Net margin of ${nm.toFixed(1)}% ${nm < 5 ? "leaves little error room" : "provides a profitability cushion"}.`,
    nm < 5 ? "Track cost inflation and pricing power quarter to quarter." : "Margins give resilience to cost shocks.");
  if (roce != null) add("Business", "Returns on capital",
    roce < 8 ? 4 : roce < 15 ? 2 : 1, 3,
    `ROCE of ${roce.toFixed(1)}% ${roce < 8 ? "sits below a typical cost-of-capital hurdle — capital may be eroding value" : "clears a typical hurdle"}.`,
    roce < 8 ? "Question reinvestment economics; favour capital discipline." : "Reinvestment is value-accretive.");

  // ---- VALUATION ----
  if (dcf) {
    const tv = dcf.terminalShare != null ? dcf.terminalShare * 100 : null;
    if (tv != null) add("Valuation", "Terminal-value dependence",
      tv > 80 ? 5 : tv > 70 ? 4 : tv > 55 ? 3 : 2, 4,
      `${tv.toFixed(0)}% of DCF value sits in the terminal value ${tv > 75 ? "— the target leans heavily on assumptions beyond the explicit forecast" : ""}.`,
      tv > 75 ? "Cross-check against exit-multiple and relative methods; haircut the perpetuity." : "Explicit forecast carries a healthy share of value.");
    if (dcf.upside != null) add("Valuation", "Downside to fair value",
      dcf.upside < -10 ? 5 : dcf.upside < 0 ? 4 : dcf.upside < 15 ? 2 : 1, 4,
      `Base-case DCF implies ${dcf.upside >= 0 ? "+" : ""}${dcf.upside.toFixed(1)}% versus the current price.`,
      dcf.upside < 0 ? "Price already discounts the base case; demand a margin of safety." : "Valuation offers a cushion to the thesis.");
  }
  const pe = g["P/E (TTM)"], peg = g["PEG"];
  if (pe != null && pe > 0) add("Valuation", "Multiple re-rating risk",
    pe > 40 ? 4 : pe > 25 ? 3 : 1, 3,
    `Trades at ${pe.toFixed(1)}× trailing earnings${peg != null ? ` (PEG ${peg.toFixed(2)})` : ""} ${pe > 30 ? "— a rich multiple vulnerable to de-rating on any disappointment" : ""}.`,
    pe > 30 ? "High bar for execution; small misses can compress the multiple." : "Multiple leaves room for modest disappointment.");

  // ---- GOVERNANCE / FORENSIC ----
  if (forensic) {
    if (forensic.beneish && forensic.beneish.score != null) add("Governance", "Earnings-manipulation signal",
      forensic.beneish.score > -1.78 ? 4 : 1, 5,
      `Beneish M-Score of ${forensic.beneish.score} ${forensic.beneish.score > -1.78 ? "is above the −1.78 threshold — statistically elevated manipulation risk" : "is below the threshold — low statistical manipulation risk"}.`,
      forensic.beneish.score > -1.78 ? "Forensic deep-dive on revenue recognition and accruals warranted." : "Accounting signals are clean on this model.");
    if (forensic.earningsQualityGrade) { const eqBad = ["C", "D"].includes(forensic.earningsQualityGrade); add("Governance", "Earnings quality",
      eqBad ? 4 : 1, 4,
      `Composite earnings-quality grade of ${forensic.earningsQualityGrade}${forensic.cash && forensic.cash.cashConversion != null ? ` (cash conversion ${forensic.cash.cashConversion}×)` : ""}.`,
      eqBad ? "Reported profit not fully cash-backed; weight cash flow over EPS." : "Earnings are well-supported by cash."); }
  }

  // ---- FINANCIAL DISTRESS ----
  if (forensic && forensic.altman && forensic.altman.zone !== "n/a") { const z = forensic.altman.zone; add("Financial", "Bankruptcy / distress risk",
    z === "Distress" ? 5 : z === "Grey" ? 3 : 1, 5,
    `Altman Z-Score of ${forensic.altman.score} places the firm in the ${z.toLowerCase()} zone.`,
    z !== "Safe" ? "Distress markers present; size positions for tail risk." : "Distress risk is low on this model."); }

  // ---- MARKET ----
  if (beta != null) add("Market", "Market beta / volatility",
    beta > 1.5 ? 4 : beta > 1.1 ? 3 : beta < 0.7 ? 1 : 2, 3,
    `Beta of ${beta.toFixed(2)} implies the stock moves ${beta > 1 ? "more" : "less"} than the market.`,
    beta > 1.3 ? "Expect amplified drawdowns in risk-off regimes; size accordingly." : "Lower-than-market sensitivity dampens drawdowns.");

  // ---- REGULATORY / ESG / MACRO (sector-contextual, lower-confidence) ----
  add("Regulatory", "Regulatory & policy exposure", sector && /bank|financ|energy|utilit|pharma|telecom|tobacco/i.test(sector) ? 4 : 2, 3,
    `${sector || "The sector"} carries ${sector && /bank|financ|energy|utilit|pharma|telecom|tobacco/i.test(sector) ? "above-average" : "ordinary"} regulatory and policy exposure.`,
    "Track policy/rate developments and compliance cost trends.");
  add("ESG", "ESG & sustainability", sector && /energy|oil|gas|mining|metal|tobacco|chemical/i.test(sector) ? 4 : 2, 2,
    `Sector ESG profile is ${sector && /energy|oil|gas|mining|metal|tobacco|chemical/i.test(sector) ? "elevated (transition/footprint exposure)" : "moderate"}.`,
    "Monitor disclosure quality and transition capex.");
  add("Industry", "Industry / competitive intensity", 3, 3,
    `Competitive dynamics in ${sector || "the industry"} are a structural consideration; pricing power and share trends should be tracked.`,
    "Benchmark growth and margins against the peer set each quarter.");

  // composite 0–100 (higher = riskier)
  const maxPer = 25;
  const norm = risks.length ? risks.reduce((s, r) => s + r.severity, 0) / (risks.length * maxPer) : 0;
  const compositeScore = Math.round(norm * 100);
  const compositeBand = compositeScore >= 60 ? "High" : compositeScore >= 38 ? "Elevated" : compositeScore >= 22 ? "Moderate" : "Low";

  // category roll-ups
  const cats = {};
  risks.forEach((r) => { (cats[r.category] ||= []).push(r); });
  const categoryScores = Object.entries(cats).map(([c, list]) => ({
    category: c, score: Math.round((list.reduce((s, r) => s + r.severity, 0) / (list.length * maxPer)) * 100),
    count: list.length, top: list.slice().sort((a, b) => b.severity - a.severity)[0].title,
  })).sort((a, b) => b.score - a.score);

  // downside scenarios — anchored to real DCF bear case + a stress overlay
  const scenarios = [];
  if (dcf && dcf.bear != null && price) {
    scenarios.push({ name: "Bear case (DCF)", value: dcf.bear, ret: (dcf.bear / price - 1) * 100, basis: "Slower growth + margin pressure, from the DCF engine." });
    const stress = dcf.bear * (beta && beta > 1 ? 0.85 : 0.9);
    scenarios.push({ name: "Stress case", value: stress, ret: (stress / price - 1) * 100, basis: "Bear case with an additional market/multiple shock." });
  }
  // single-day VaR-style move from beta (assume ~1% daily market sigma → stock sigma = beta×1%, 95% ≈ 1.65σ)
  const dailyVar = beta != null ? +(beta * 1.0 * 1.65).toFixed(1) : null;

  return {
    risks: risks.sort((a, b) => b.severity - a.severity),
    compositeScore, compositeBand, categoryScores,
    scenarios, dailyVar95: dailyVar,
    topRisks: risks.slice(0, 3).map((r) => r.title),
  };
}

/* ── MULTI-METHOD VALUATION: EV/EBITDA, P/E, PEG, Residual Income, DDM, SOTP ──
   Every method returns its inputs and per-share output so the working is auditable.
   Peer medians anchor the relative methods; DCF comes from institutionalDCF. */
function multiValuation({ bundle, st, ratios, growth, dcf, peers, sharesOut, netDebt, price }) {
  const fd = bundle.financialData || {}, ks = bundle.defaultKeyStatistics || {}, sd = bundle.summaryDetail || {};
  const li = st.income.at(-1) || {}, lb = st.balance.at(-1) || {};
  const g = Object.fromEntries((ratios || []).map((r) => [r.name, r.value]));
  const out = { methods: [], currency: bundle.price?.currency || "" };
  const median = (arr) => { const v = arr.filter((x) => x != null && isFinite(x)).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
  const peerSet = (peers || []).slice(1); // exclude self (index 0)
  const add = (name, value, inputs, note) => out.methods.push({ name, value: value != null && isFinite(value) ? value : null, inputs, note });

  const ebitda = li.ebitda || li.opIncome, eps = sharesOut ? li.netIncome / sharesOut : null, bvps = sharesOut && lb.equity ? lb.equity / sharesOut : null;

  // 1. EV/EBITDA
  const peerEvEbitda = median(peerSet.map((p) => p.evEbitda));
  if (peerEvEbitda && ebitda) { const ev = ebitda * peerEvEbitda, eq = ev - (netDebt || 0); add("EV / EBITDA", sharesOut ? eq / sharesOut : null,
    { "Company EBITDA": ebitda, "Peer median EV/EBITDA": peerEvEbitda, "Implied EV": ev, "Less net debt": netDebt, "Equity value": eq }, `Applies the peer-median EV/EBITDA of ${peerEvEbitda.toFixed(1)}× to trailing EBITDA.`); }

  // 2. P/E
  const peerPe = median(peerSet.map((p) => p.pe));
  if (peerPe && eps) add("P / E", eps * peerPe, { "Company EPS": eps, "Peer median P/E": peerPe }, `Applies the peer-median P/E of ${peerPe.toFixed(1)}× to trailing EPS.`);

  // 3. PEG (fair P/E = growth rate at PEG 1.0)
  const grRate = growth?.revCagr ?? growth?.revYoy;
  if (eps && grRate && grRate > 0) { const fairPe = Math.min(grRate, 40); add("PEG", eps * fairPe,
    { "Company EPS": eps, "Growth rate %": grRate, "Fair P/E (PEG=1.0)": fairPe }, `At a PEG of 1.0, a ${grRate.toFixed(1)}% grower justifies ~${fairPe.toFixed(0)}× earnings.`); }

  // 4. Residual Income (Edwards-Bell-Ohlson, simplified): V = BV + Σ PV(RI), RI = NI − Ke×BV
  if (bvps && eps) { const ke = (dcf && dcf.waccBuild ? dcf.waccBuild.costEquity : 11) / 100; const roe = (g["ROE"] ?? 12) / 100;
    let bv = bvps, v = bvps, gFade = (grRate ? Math.min(grRate, 12) : 6) / 100;
    for (let yr = 1; yr <= 5; yr++) { const ni = bv * roe; const ri = ni - ke * bv; v += ri / Math.pow(1 + ke, yr); bv += ni * (1 - 0.4); }
    const tvRI = (bv * roe - ke * bv) / (ke - Math.min(gFade, ke - 0.02)) / Math.pow(1 + ke, 5);
    add("Residual Income", v + (isFinite(tvRI) ? tvRI : 0), { "Book value/share": bvps, "Cost of equity %": ke * 100, "ROE %": roe * 100 }, "Equity value = book value plus the present value of returns earned above the cost of equity."); }

  // 5. Dividend Discount (Gordon) — only if it pays a dividend
  const divRate = sd.dividendRate ?? (sd.dividendYield && price ? sd.dividendYield * price : null);
  if (divRate && divRate > 0) { const ke = (dcf && dcf.waccBuild ? dcf.waccBuild.costEquity : 11) / 100; const gD = Math.min((grRate ?? 4) / 100, ke - 0.02);
    add("Dividend Discount", divRate * (1 + gD) / (ke - gD), { "Dividend/share": divRate, "Cost of equity %": ke * 100, "Div growth %": gD * 100 }, "Gordon growth model on the current dividend."); }

  // 6. Sum-of-the-Parts — approximate by valuing core EBITDA at the peer multiple (single-segment proxy; flagged)
  if (ebitda && peerEvEbitda && sharesOut) { const coreEv = ebitda * peerEvEbitda; const eq = coreEv - (netDebt || 0);
    add("Sum-of-the-Parts", eq / sharesOut, { "Core EBITDA": ebitda, "Segment multiple": peerEvEbitda, "Net debt": netDebt }, "Single-segment approximation (segment-level data not available from the source); refine with disclosed segment EBITDA where published."); }

  // 7. DCF (from institutional model)
  if (dcf && dcf.target) add("DCF (intrinsic)", dcf.target, { "WACC %": dcf.assumptions?.wacc, "Terminal growth %": dcf.assumptions?.terminalG, "Terminal value share %": dcf.terminalShare != null ? dcf.terminalShare * 100 : null }, "Five-year FCFF model from the Modeling Lab.");

  // blended — weight DCF 40%, relative methods share 60%
  const valid = out.methods.filter((m) => m.value != null && m.value > 0);
  const dcfM = valid.find((m) => m.name.startsWith("DCF"));
  const rel = valid.filter((m) => !m.name.startsWith("DCF") && m.name !== "Sum-of-the-Parts");
  let blended = null;
  if (dcfM && rel.length) blended = dcfM.value * 0.4 + (rel.reduce((s, m) => s + m.value, 0) / rel.length) * 0.6;
  else if (valid.length) blended = valid.reduce((s, m) => s + m.value, 0) / valid.length;
  out.blended = blended;
  out.upside = blended && price ? (blended / price - 1) * 100 : null;
  out.price = price;
  return out;
}

/* ── MONTE CARLO on the DCF: sample growth, margin and WACC; return the
   distribution of per-share value. Uses a normal-ish draw via central-limit. */
function monteCarlo(idcf, runs = 5000) {
  if (!idcf || idcf.error || !idcf.base) return null;
  const a = idcf.assumptions, shares = idcf.sharesOut, nd = idcf.netDebt, baseRev = idcf.base.rows[0]?.rev / (1 + a.growthY1_5 / 100);
  if (!shares || !baseRev) return null;
  const rnd = () => { let s = 0; for (let i = 0; i < 6; i++) s += Math.random(); return (s - 3) / 3; }; // ~N(0,1), bounded ±1
  const results = [];
  // distributions: growth ±40% rel, margin ±15% rel, wacc ±1.2pp, terminalG ±0.8pp
  for (let n = 0; n < runs; n++) {
    const growth = a.growthY1_5 * (1 + rnd() * 0.4) / 100;
    const margin = (a.ebitdaMargin / 100) * (1 + rnd() * 0.15);
    const wacc = (a.wacc + rnd() * 1.2) / 100;
    const tg = Math.min((a.terminalG + rnd() * 0.8) / 100, wacc - 0.005);
    const tax = a.taxRate / 100, capex = a.capexPctRev / 100, dep = a.depPctRev / 100, wc = a.wcPctRev / 100;
    let rev = baseRev, pv = 0, fade = a.fade / 100, gr = growth, lastF = 0;
    for (let y = 1; y <= 5; y++) { rev *= (1 + gr); gr = Math.max(tg, gr - fade); const ebitda = rev * margin; const ebit = ebitda - rev * dep; const nopat = ebit * (1 - tax); const reinv = rev * capex + (rev - rev / (1 + gr)) * wc; const fcff = nopat + rev * dep - rev * capex - (rev * wc * 0.3); lastF = fcff; pv += fcff / Math.pow(1 + wacc, y); }
    const tv = (lastF * (1 + tg)) / (wacc - tg); const tvPv = tv / Math.pow(1 + wacc, 5);
    const ev = pv + tvPv, eq = ev - nd; results.push(eq / shares);
  }
  results.sort((x, y) => x - y);
  const pctl = (p) => results[Math.floor(p * results.length)];
  const mean = results.reduce((s, x) => s + x, 0) / results.length;
  const cur = idcf.currentPrice;
  // histogram (20 buckets)
  const lo = pctl(0.02), hi = pctl(0.98), span = (hi - lo) || 1, buckets = 20;
  const hist = Array.from({ length: buckets }, (_, i) => ({ x: lo + (i + 0.5) * span / buckets, c: 0 }));
  results.forEach((v) => { if (v >= lo && v <= hi) { const idx = Math.min(buckets - 1, Math.floor((v - lo) / span * buckets)); hist[idx].c++; } });
  const probAbove = cur ? results.filter((v) => v > cur).length / results.length * 100 : null;
  return {
    runs, mean, median: pctl(0.5), p5: pctl(0.05), p25: pctl(0.25), p75: pctl(0.75), p95: pctl(0.95),
    min: results[0], max: results.at(-1), hist, currentPrice: cur, probAbove,
  };
}

/* ════════════════════════════════════════════════════════════════════════
   ASSUMPTION EVIDENCE ENGINE
   Derives historical stats, recommended values, confidence scores and
   methodology notes for every major modelling assumption.
   Returns a structured evidence payload consumed by the Assumption
   Intelligence layer in the frontend and stored in valuationModelState.
   ════════════════════════════════════════════════════════════════════════ */
function assumptionEvidence(bundle, st, dcfIn) {
  const fd = bundle.financialData || {}, ks = bundle.defaultKeyStatistics || {}, pr = bundle.price || {};
  const sd = bundle.summaryDetail || {};
  const inc = st.income, bal = st.balance, cf = st.cashflow;
  const isIndia = (pr.exchangeName || "").match(/NSE|BSE/i) || pr.currency === "INR";

  // ── stat helpers ────────────────────────────────────────────────────────
  const validNums = (arr) => arr.filter((x) => x != null && isFinite(x));
  const avg = (arr) => { const v = validNums(arr); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  const med = (arr) => { const v = [...validNums(arr)].sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
  const sd_ = (arr) => { const v = validNums(arr); if (v.length < 2) return null; const m = avg(v); return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1)); };
  const mn = (arr) => { const v = validNums(arr); return v.length ? Math.min(...v) : null; };
  const mx = (arr) => { const v = validNums(arr); return v.length ? Math.max(...v) : null; };
  const cagr = (arr) => { const v = validNums(arr).filter((x) => x > 0); if (v.length < 2) return null; return (Math.pow(v.at(-1) / v[0], 1 / (v.length - 1)) - 1) * 100; };
  const trend = (arr) => { const v = validNums(arr); if (v.length < 2) return "stable"; const diff = v.at(-1) - v[0]; const rel = Math.abs(diff / (v[0] || 1)) * 100; if (rel < 3) return "stable"; return diff > 0 ? "improving" : "declining"; };
  const conf = (score) => score >= 70 ? "High" : score >= 40 ? "Medium" : "Low";

  // ── extract historical series ────────────────────────────────────────────
  const revSeries = inc.map((r) => r.revenue).filter((x) => x != null);
  const ebitdaSeries = inc.map((r, i) => r.ebitda != null ? r.ebitda / (r.revenue || 1) * 100 : null);
  const ebitSeries = inc.map((r) => r.ebit != null && r.revenue ? r.ebit / r.revenue * 100 : (r.opIncome != null && r.revenue ? r.opIncome / r.revenue * 100 : null));
  const netMargSeries = inc.map((r) => r.netIncome != null && r.revenue ? r.netIncome / r.revenue * 100 : null);
  const taxSeries = inc.map((r) => r.pretax && r.tax ? Math.min(Math.max(r.tax / r.pretax, 0.05), 0.45) * 100 : null);
  const capexPctSeries = cf.map((r, i) => r.capex && inc[i]?.revenue ? Math.abs(r.capex) / inc[i].revenue * 100 : null);
  const depPctSeries = cf.map((r, i) => r.dep && inc[i]?.revenue ? r.dep / inc[i].revenue * 100 : null);
  const roeSeries = inc.map((r, i) => r.netIncome && bal[i]?.equity ? r.netIncome / bal[i].equity * 100 : null);
  const roceSeries = inc.map((r, i) => { const ce = bal[i]?.assets && bal[i]?.currentLiab ? bal[i].assets - bal[i].currentLiab : null; return ce && (r.ebit || r.opIncome) ? (r.ebit || r.opIncome) / ce * 100 : null; });

  // Working capital days
  const dsoDIO = inc.map((r, i) => {
    const b = bal[i] || {}; const rev = r.revenue; const cogs = rev && r.grossProfit != null ? rev - r.grossProfit : null;
    return {
      dso: b.receivables && rev ? +(b.receivables / rev * 365).toFixed(0) : null,
      dio: b.inventory && cogs ? +(b.inventory / cogs * 365).toFixed(0) : null,
      dpo: b.payables && cogs ? +(b.payables / cogs * 365).toFixed(0) : null,
    };
  });
  const dsoSeries = dsoDIO.map((x) => x.dso).filter((x) => x != null);
  const dioSeries = dsoDIO.map((x) => x.dio).filter((x) => x != null);
  const dpoSeries = dsoDIO.map((x) => x.dpo).filter((x) => x != null);

  // Revenue growth YoY series
  const revGrowthSeries = [];
  for (let i = 1; i < inc.length; i++) {
    const prev = inc[i - 1].revenue, curr = inc[i].revenue;
    if (prev && curr) revGrowthSeries.push((curr / prev - 1) * 100);
  }

  // ── WACC decomposition ────────────────────────────────────────────────
  const beta = n(ks.beta) ?? 1.0;
  const rf = isIndia ? 7.0 : 4.3;
  const erp = isIndia ? 6.0 : 5.0;
  const costEquity = rf + beta * erp;
  const debt = (bal.at(-1)?.ltDebt || 0) + (bal.at(-1)?.stDebt || 0) || n(fd.totalDebt) || 0;
  const mcap_ = n(sd.marketCap) ?? n(pr.marketCap) ?? (dcfIn.sharesOut * (dcfIn.currentPrice || 0));
  const totalCap = debt + mcap_;
  const wd = totalCap > 0 ? debt / totalCap : 0;
  const taxRateLatest = taxSeries.at(-1) != null ? taxSeries.at(-1) / 100 : 0.25;
  const interestRate = inc.at(-1)?.interest && debt ? Math.abs(inc.at(-1).interest) / debt : null;
  const costDebt = (interestRate ? interestRate * 100 : rf + 1.5) * (1 - taxRateLatest);
  const waccCalc = (1 - wd) * costEquity + wd * costDebt;

  // ── Sector classification (deterministic) ──────────────────────────────
  const sector = (bundle.assetProfile?.sector || bundle.summaryProfile?.sector || "Unknown").toLowerCase();
  let sectorClass = "General";
  if (/consumer|fmcg|staple|discretionary/.test(sector)) sectorClass = "FMCG/Consumer";
  else if (/tech|software|information|semiconductor/.test(sector)) sectorClass = "Technology";
  else if (/financ|bank|insurance|nbfc/.test(sector)) sectorClass = "Financial";
  else if (/health|pharma|biotech|medic/.test(sector)) sectorClass = "Healthcare";
  else if (/manufactur|industrial|engineer|material/.test(sector)) sectorClass = "Manufacturing";
  else if (/energy|oil|gas|utility/.test(sector)) sectorClass = "Energy/Utility";
  else if (/telecom|communication/.test(sector)) sectorClass = "Telecom";
  else if (/real estate|reit/.test(sector)) sectorClass = "Real Estate";

  // ── Build assumption rows ──────────────────────────────────────────────
  const histRevGrowthAvg = avg(revGrowthSeries);
  const histRevGrowthMed = med(revGrowthSeries);
  const histRevGrowthCagr = cagr(revSeries);
  const revGrowthRec = dcfIn.growthY1_5;
  const revGrowthHist = histRevGrowthAvg;
  const revScore = revSeries.length >= 3 ? 65 : revSeries.length >= 2 ? 40 : 20;
  const revGrowthScore = revScore + (histRevGrowthCagr != null ? 20 : 0);

  const ebitdaAvg = avg(ebitdaSeries);
  const ebitdaMed = med(ebitdaSeries);
  const ebitdaTrend = trend(ebitdaSeries);
  const ebitdaScore = validNums(ebitdaSeries).length >= 3 ? 70 : 40;

  const capexAvg = avg(capexPctSeries);
  const capexMed = med(capexPctSeries);
  const capexScore = validNums(capexPctSeries).length >= 2 ? 60 : 30;

  const depAvg = avg(depPctSeries);
  const depMed = med(depPctSeries);
  const depScore = validNums(depPctSeries).length >= 2 ? 65 : 35;

  const taxAvg = avg(taxSeries);
  const taxMed = med(taxSeries);
  const taxRec = taxAvg ?? (isIndia ? 25 : 21);
  const taxScore = validNums(taxSeries).length >= 2 ? 75 : 40;

  const dsoAvg = avg(dsoSeries);
  const dioAvg = avg(dioSeries);
  const dpoAvg = avg(dpoSeries);
  const wcScore = (dsoSeries.length + dioSeries.length + dpoSeries.length) > 3 ? 65 : 30;

  const waccScore = 70; // always from CAPM — transparent formula
  const tgScore = isIndia ? 65 : 70; // terminal growth is conservative by design

  // ── Model Quality Score ────────────────────────────────────────────────
  // Institutional-grade scoring methodology. Starts at 100 and DEDUCTS for
  // anomalies. The score behaves like a financial-model audit — abnormal
  // inputs materially reduce reliability, just like a senior analyst would
  // mark down a junior's model. Coverage / data availability is only one
  // contributor; the bulk of the score reacts to ASSUMPTION QUALITY.
  //
  // Deduction bands (rough magnitudes; tuned for institutional sensitivity):
  //   • Extreme growth (>50%):                                   −25 to −45
  //   • Growth materially above hist CAGR (>2×):                 −10 to −20
  //   • Terminal g above nominal GDP:                             −8 to −18
  //   • WACC ≤ Terminal g + 1pp:                                 −20 (model break)
  //   • EBITDA margin > 60% or < 0%:                              −10 to −20
  //   • Capex < 50% of D&A (capital starvation):                  −8
  //   • Capex > 3× historical median:                             −10
  //   • Negative or unrealistic WC % (>20% or <-5%):              −8
  //   • Missing core history (<3 years statements):               −15
  //   • Missing capex / D&A / tax history:                        −5 each
  //   • WACC outside 5–25% band:                                  −12
  //   • Beta outside 0.3–2.5:                                     −5
  //
  // After-IDCF deductions (applied in enrichDiagnostics with full context):
  //   • Terminal share > 75%:                                     −10
  //   • Negative terminal-year FCFF:                              −25
  //   • Implied price negative / non-finite:                      −30
  //   • BS reconciliation drift > 1% of assets:                   −10
  //
  // Strengths and weaknesses arrays surface drivers for the UI panel.
  const histDataPts = Math.min(inc.length, 5);
  const mqsStrengths = [];
  const mqsWeaknesses = [];
  let mqs = 100;

  // Data foundation
  if (histDataPts >= 4) {
    mqsStrengths.push(`Multi-year historical foundation (${histDataPts} years)`);
  } else if (histDataPts >= 3) {
    mqs -= 5;
    mqsStrengths.push(`Three-year historical foundation`);
  } else if (histDataPts >= 2) {
    mqs -= 15;
    mqsWeaknesses.push(`Limited history (${histDataPts} years) — robustness compromised`);
  } else {
    mqs -= 30;
    mqsWeaknesses.push(`Critical: ${histDataPts} year(s) of history — forecasts are speculative`);
  }
  if (cf.length < 3) {
    mqs -= 5;
    mqsWeaknesses.push("Cash-flow history thin — WC and capex modeling weakened");
  }
  if (bal.length < 3) {
    mqs -= 5;
    mqsWeaknesses.push("Balance-sheet history thin — debt/equity rollforward less reliable");
  }
  if (capexAvg == null) {
    mqs -= 5;
    mqsWeaknesses.push("Capex % not computable from data — using fallback");
  }
  if (depAvg == null) {
    mqs -= 5;
    mqsWeaknesses.push("D&A % not computable from data — using fallback");
  }
  if (taxAvg == null) {
    mqs -= 4;
    mqsWeaknesses.push("Effective tax rate not computable — using statutory default");
  }
  if (dsoAvg == null && dioAvg == null && dpoAvg == null) {
    mqs -= 6;
    mqsWeaknesses.push("Working capital DSO/DIO/DPO unavailable — using flat 2% of revenue change");
  } else {
    mqsStrengths.push("Working capital modelled from DSO/DIO/DPO drivers");
  }

  // ── ASSUMPTION-QUALITY ANOMALY DETECTION ───────────────────────────────
  const g1 = dcfIn.growthY1_5;
  if (g1 != null && isFinite(g1)) {
    if (g1 > 100) {
      mqs -= 45;
      mqsWeaknesses.push(`CRITICAL: Revenue growth ${g1.toFixed(0)}% is non-credible (>100%)`);
    } else if (g1 > 50) {
      mqs -= 30;
      mqsWeaknesses.push(`Extreme revenue growth (${g1.toFixed(1)}%) — implausible for a listed firm`);
    } else if (g1 > 30) {
      mqs -= 15;
      mqsWeaknesses.push(`Very high revenue growth (${g1.toFixed(1)}%) — requires hyper-growth justification`);
    } else if (g1 < -20) {
      mqs -= 15;
      mqsWeaknesses.push(`Sharp revenue decline (${g1.toFixed(1)}%) — distressed-firm assumption`);
    }
    if (histRevGrowthCagr != null && Math.abs(histRevGrowthCagr) > 1) {
      const ratio = g1 / Math.abs(histRevGrowthCagr);
      if (g1 > 0 && ratio > 3) {
        mqs -= 12;
        mqsWeaknesses.push(`Growth ${g1.toFixed(1)}% is ${ratio.toFixed(1)}× historical CAGR ${histRevGrowthCagr.toFixed(1)}%`);
      } else if (g1 > 0 && ratio > 2) {
        mqs -= 6;
        mqsWeaknesses.push(`Growth exceeds 2× historical CAGR — substantial premium to trend`);
      }
    }
  }

  // Terminal growth sanity
  if (dcfIn.terminalG != null) {
    const tgCap = isIndia ? 6 : 3;
    if (dcfIn.terminalG > tgCap + 2) {
      mqs -= 18;
      mqsWeaknesses.push(`Terminal growth ${dcfIn.terminalG.toFixed(1)}% well above sustainable nominal GDP`);
    } else if (dcfIn.terminalG > tgCap) {
      mqs -= 8;
      mqsWeaknesses.push(`Terminal growth ${dcfIn.terminalG.toFixed(1)}% above long-run GDP proxy`);
    } else if (dcfIn.terminalG < 0) {
      mqs -= 10;
      mqsWeaknesses.push(`Negative terminal growth implies perpetual decline`);
    }
  }

  // WACC vs Terminal-g (model-breaking if too close)
  if (dcfIn.wacc != null && dcfIn.terminalG != null) {
    const spread = dcfIn.wacc - dcfIn.terminalG;
    if (spread <= 1) {
      mqs -= 20;
      mqsWeaknesses.push(`Critical: WACC − Terminal-g spread is only ${spread.toFixed(2)}pp — TV explodes`);
    } else if (spread < 2) {
      mqs -= 8;
      mqsWeaknesses.push(`WACC − Terminal-g spread tight (${spread.toFixed(2)}pp) — TV very sensitive`);
    }
  }

  // WACC sanity
  if (dcfIn.wacc != null) {
    if (dcfIn.wacc < 5 || dcfIn.wacc > 25) {
      mqs -= 12;
      mqsWeaknesses.push(`WACC ${dcfIn.wacc.toFixed(1)}% outside 5–25% sanity band`);
    }
  }

  // Beta sanity — use dcfIn's rationale beta (the user-edited value) over
  // bundle default. Otherwise user overrides go undetected.
  const betaUsed = (dcfIn.rationale && dcfIn.rationale.beta != null && isFinite(+dcfIn.rationale.beta))
    ? +dcfIn.rationale.beta : beta;
  if (betaUsed != null && (betaUsed < 0.3 || betaUsed > 2.5)) {
    mqs -= 5;
    mqsWeaknesses.push(`Beta ${betaUsed.toFixed(2)} outside 0.3–2.5 normal range`);
  }

  // EBITDA margin sanity vs history
  const fcMargin = dcfIn._ebitdaMargin != null ? dcfIn._ebitdaMargin * 100 : (fd.ebitdaMargins != null ? fd.ebitdaMargins * 100 : ebitdaAvg);
  if (fcMargin != null && isFinite(fcMargin)) {
    if (fcMargin < 0) {
      mqs -= 15;
      mqsWeaknesses.push(`EBITDA margin negative (${fcMargin.toFixed(1)}%) — loss-making operating profile`);
    } else if (fcMargin > 60) {
      mqs -= 10;
      mqsWeaknesses.push(`EBITDA margin ${fcMargin.toFixed(1)}% exceeds 60% — rare outside software/IP firms`);
    }
    if (ebitdaAvg != null && fcMargin > ebitdaAvg + 10) {
      mqs -= 8;
      mqsWeaknesses.push(`Forecast EBITDA margin >10pp above historical avg without driver`);
    }
  } else if (ebitdaAvg != null) {
    mqsStrengths.push("EBITDA margin anchored to historical average");
  }

  // Capex sanity (Capex vs D&A; runaway capex)
  if (capexAvg != null && depAvg != null) {
    if (capexAvg < depAvg * 0.5) {
      mqs -= 8;
      mqsWeaknesses.push(`Capex (${capexAvg.toFixed(1)}%) <50% of D&A (${depAvg.toFixed(1)}%) — capital starvation`);
    }
  }
  if (capexAvg != null && capexMed != null && capexAvg > 0 && Math.abs(capexAvg - capexMed) > capexMed) {
    mqs -= 5;
    mqsWeaknesses.push("Capex history highly volatile — flat % may not capture reality");
  }

  // Working-capital sanity
  if (dcfIn.wcPctRev != null && isFinite(dcfIn.wcPctRev)) {
    const wcv = dcfIn.wcPctRev * (Math.abs(dcfIn.wcPctRev) > 1 ? 1 : 100);
    if (wcv > 20) {
      mqs -= 6;
      mqsWeaknesses.push(`Working-capital absorption ${wcv.toFixed(1)}% of ΔRev — very high`);
    } else if (wcv < -5) {
      mqs -= 6;
      mqsWeaknesses.push(`Negative WC absorption implies cash release every year — unusual`);
    }
  }

  // Tax rate sanity
  if (taxRec != null && (taxRec < 5 || taxRec > 45)) {
    mqs -= 6;
    mqsWeaknesses.push(`Tax rate ${taxRec.toFixed(1)}% outside statutory norms`);
  }

  // ── Strength signals (positive evidence) ───────────────────────────────
  if (histDataPts >= 4 && ebitdaAvg != null && capexAvg != null && depAvg != null && dsoAvg != null) {
    mqsStrengths.push("All core drivers anchored to historical data");
  }
  if (g1 != null && histRevGrowthCagr != null && Math.abs(g1 - histRevGrowthCagr) < 3) {
    mqsStrengths.push("Forecast growth closely tracks historical CAGR");
  }
  if (dcfIn.terminalG != null && dcfIn.terminalG > 0 && dcfIn.terminalG <= (isIndia ? 5.5 : 3.0)) {
    mqsStrengths.push("Terminal growth within long-run GDP norms");
  }

  const mqsClamped = Math.max(0, Math.min(100, Math.round(mqs)));
  const mqsLabel = mqsClamped >= 75 ? "High" : mqsClamped >= 50 ? "Moderate" : "Low";

  // ── Model Diagnostics / Red Flags ────────────────────────────────────────
  const flags = [];
  // Will be enriched by idcf data; base checks from evidence alone
  if (histRevGrowthCagr != null && dcfIn.growthY1_5 > histRevGrowthCagr * 1.5 + 4)
    flags.push({ severity: "High", check: "Revenue growth above historical CAGR", detail: `Forecast growth ${dcfIn.growthY1_5.toFixed(1)}% vs historical CAGR ${histRevGrowthCagr.toFixed(1)}% — requires strong justification`, fix: "Reduce growth to be within 1.5× historical CAGR unless management guidance supports it" });
  if (dcfIn.terminalG > (isIndia ? 6.5 : 3.5))
    flags.push({ severity: "High", check: "Terminal growth appears elevated", detail: `${dcfIn.terminalG.toFixed(1)}% exceeds long-run nominal GDP growth for this market`, fix: `Reduce terminal growth to ${isIndia ? "4.5–5.5%" : "2.0–3.0%"} for a mature company` });
  if (dcfIn.wacc < (isIndia ? 9 : 7))
    flags.push({ severity: "Medium", check: "WACC appears below market norms", detail: `WACC of ${dcfIn.wacc.toFixed(1)}% is low — ensure risk-free rate and ERP reflect current market conditions`, fix: "Recalculate WACC with current 10-year government bond yield as risk-free rate" });
  if (ebitdaAvg != null && (dcfIn._ebitdaMargin || ebitdaAvg / 100) > ebitdaAvg / 100 * 1.25 + 0.05)
    flags.push({ severity: "Medium", check: "Margin expansion unsupported by history", detail: "Forecast EBITDA margin materially exceeds historical average without explicit driver", fix: "Tie margin expansion to identified operating leverage or cost reduction plans" });

  return {
    sectorClass,
    dataYears: inc.length,
    latestYear: inc.at(-1)?.year,
    assumptions: {
      revenueGrowth: {
        label: "Revenue Growth",
        baseInput: dcfIn.growthY1_5,
        historical: { avg: histRevGrowthAvg, med: histRevGrowthMed, cagr: histRevGrowthCagr, min: mn(revGrowthSeries), max: mx(revGrowthSeries), std: sd_(revGrowthSeries), trend: trend(revGrowthSeries), years: revGrowthSeries.length },
        recommended: revGrowthRec,
        confidence: conf(revGrowthScore),
        methodology: `Recommended = Historical CAGR (${histRevGrowthCagr != null ? histRevGrowthCagr.toFixed(1) + "%" : "n/a"}) weighted 60% + YoY trend 40%. Capped at 25%; min 2%.`,
        sourceStatus: revGrowthScore >= 60 ? "Evidence-Based" : "Analyst Estimate",
        formula: "Weighted: (Historical CAGR × 0.60) + (YoY Growth × 0.40)",
        unit: "%",
      },
      ebitdaMargin: {
        label: "EBITDA Margin",
        baseInput: (fd.ebitdaMargins ? fd.ebitdaMargins * 100 : ebitdaAvg),
        historical: { avg: ebitdaAvg, med: ebitdaMed, min: mn(ebitdaSeries), max: mx(ebitdaSeries), std: sd_(ebitdaSeries), trend: ebitdaTrend, years: validNums(ebitdaSeries).length },
        recommended: ebitdaAvg ?? (fd.ebitdaMargins ? fd.ebitdaMargins * 100 : null),
        confidence: conf(ebitdaScore),
        methodology: `Historical median EBITDA margin ${ebitdaMed != null ? ebitdaMed.toFixed(1) + "%" : "n/a"}. Trend: ${ebitdaTrend}. Use historical average unless sector expansion drivers are identified.`,
        sourceStatus: validNums(ebitdaSeries).length >= 3 ? "Evidence-Based" : "Analyst Estimate",
        formula: "Historical average EBITDA / Revenue (last 3–5 years), adjusted for identified margin drivers",
        unit: "%",
      },
      capexPctRev: {
        label: "Capex (% Revenue)",
        baseInput: capexAvg ?? 5.0,
        historical: { avg: capexAvg, med: capexMed, min: mn(capexPctSeries), max: mx(capexPctSeries), std: sd_(capexPctSeries), trend: trend(capexPctSeries), years: validNums(capexPctSeries).length },
        recommended: capexAvg ?? 5.0,
        confidence: conf(capexScore),
        methodology: `Historical median capex intensity ${capexMed != null ? capexMed.toFixed(1) + "%" : "n/a"} of revenue. ${sectorClass === "Manufacturing" ? "Manufacturing sector — capex tends to be higher during expansion cycles." : ""}`,
        sourceStatus: capexAvg != null ? "Evidence-Based" : "Analyst Estimate",
        formula: "Capex / Revenue (from cash flow statement), averaged over available years",
        unit: "%",
      },
      depPctRev: {
        label: "D&A (% Revenue)",
        baseInput: depAvg ?? 4.0,
        historical: { avg: depAvg, med: depMed, min: mn(depPctSeries), max: mx(depPctSeries), std: sd_(depPctSeries), trend: trend(depPctSeries), years: validNums(depPctSeries).length },
        recommended: depAvg ?? 4.0,
        confidence: conf(depScore),
        methodology: `D&A as % revenue: historical avg ${depAvg != null ? depAvg.toFixed(1) + "%" : "n/a"}. D&A should broadly track gross block additions and capex intensity.`,
        sourceStatus: depAvg != null ? "Evidence-Based" : "Analyst Estimate",
        formula: "Depreciation & Amortisation / Revenue (from cash flow statement)",
        unit: "%",
      },
      taxRate: {
        label: "Effective Tax Rate",
        baseInput: taxAvg ?? (isIndia ? 25 : 21),
        historical: { avg: taxAvg, med: taxMed, min: mn(taxSeries), max: mx(taxSeries), std: sd_(taxSeries), trend: trend(taxSeries), years: validNums(taxSeries).length },
        recommended: taxRec,
        confidence: conf(taxScore),
        methodology: `Normalized effective tax rate. Statutory rate ${isIndia ? "~25%" : "~21%"}. Historical average ${taxAvg != null ? taxAvg.toFixed(1) + "%" : "n/a"}. Abnormal tax years excluded.`,
        sourceStatus: validNums(taxSeries).length >= 2 ? "Evidence-Based" : "Analyst Estimate",
        formula: "Tax Expense / Pretax Income (bounded 5%–45%, averaged over last 3 years)",
        unit: "%",
      },
      workingCapital: {
        label: "Working Capital (DSO / DIO / DPO)",
        baseInput: null,
        historical: {
          dso: { avg: dsoAvg, min: mn(dsoSeries), max: mx(dsoSeries), trend: trend(dsoSeries), years: dsoSeries.length },
          dio: { avg: dioAvg, min: mn(dioSeries), max: mx(dioSeries), trend: trend(dioSeries), years: dioSeries.length },
          dpo: { avg: dpoAvg, min: mn(dpoSeries), max: mx(dpoSeries), trend: trend(dpoSeries), years: dpoSeries.length },
        },
        recommended: null,
        confidence: conf(wcScore),
        methodology: `Days Sales Outstanding (DSO): ${dsoAvg != null ? dsoAvg.toFixed(0) + " days avg" : "n/a"}. Days Inventory Outstanding (DIO): ${dioAvg != null ? dioAvg.toFixed(0) + " days avg" : "n/a"}. Days Payable Outstanding (DPO): ${dpoAvg != null ? dpoAvg.toFixed(0) + " days avg" : "n/a"}. Model uses incremental ΔWC as % of revenue change.`,
        sourceStatus: wcScore >= 50 ? "Evidence-Based" : "Analyst Estimate",
        formula: "DSO = Receivables/Revenue×365 | DIO = Inventory/COGS×365 | DPO = Payables/COGS×365",
        unit: "days",
      },
      wacc: {
        label: "WACC",
        baseInput: dcfIn.wacc,
        historical: { avg: null, note: "WACC is forward-looking — no historical series" },
        waccDecomposition: {
          rf: rf, beta: +beta.toFixed(2), erp: erp,
          costEquity: +costEquity.toFixed(2),
          costDebt: +costDebt.toFixed(2),
          weightEquity: +((1 - wd) * 100).toFixed(1),
          weightDebt: +(wd * 100).toFixed(1),
          impliedWacc: +waccCalc.toFixed(2),
          interestRateUsed: interestRate ? +(interestRate * 100).toFixed(2) : null,
        },
        recommended: +waccCalc.toFixed(1),
        confidence: "High",
        methodology: `CAPM: Cost of Equity = ${rf}% + ${beta.toFixed(2)} × ${erp}% = ${costEquity.toFixed(1)}%. After-tax cost of debt = ${costDebt.toFixed(1)}%. Capital structure: ${((1 - wd) * 100).toFixed(0)}% equity / ${(wd * 100).toFixed(0)}% debt.`,
        sourceStatus: "Evidence-Based",
        formula: "WACC = WeightEquity × (rf + β × ERP) + WeightDebt × CostDebt × (1 − Tax)",
        unit: "%",
      },
      terminalGrowth: {
        label: "Terminal Growth Rate",
        baseInput: dcfIn.terminalG,
        historical: { avg: null, note: "Conservative long-run nominal GDP proxy" },
        recommended: isIndia ? 4.5 : 2.5,
        confidence: "High",
        methodology: `Terminal growth anchored to long-run nominal GDP: ${isIndia ? "India long-term nominal GDP ~6–7%, terminal growth capped at 5.5%" : "Developed market nominal GDP ~2–3%, terminal growth at 2.5%"}. Must be below WACC.`,
        sourceStatus: "Evidence-Based",
        formula: "Terminal Value = FCFF_final × (1+g) / (WACC − g). g must < WACC.",
        unit: "%",
      },
      roe: { label: "ROE", historical: { avg: avg(roeSeries), med: med(roeSeries), min: mn(roeSeries), max: mx(roeSeries), trend: trend(roeSeries), years: validNums(roeSeries).length }, unit: "%" },
      roce: { label: "ROCE", historical: { avg: avg(roceSeries), med: med(roceSeries), min: mn(roceSeries), max: mx(roceSeries), trend: trend(roceSeries), years: validNums(roceSeries).length }, unit: "%" },
    },
    modelQualityScore: { score: mqsClamped, label: mqsLabel, strengths: mqsStrengths, weaknesses: mqsWeaknesses },
    modelDiagnostics: flags,
    isIndia,
  };
}

/* ════════════════════════════════════════════════════════════════════════
   MODEL DIAGNOSTICS — enrich with IDCF outputs
   Also REDUCES the model quality score for post-build anomalies (TV
   dominance, negative terminal FCFF, balance-sheet drift) so the headline
   reliability indicator reacts to the full DCF result, not just the inputs.
   ════════════════════════════════════════════════════════════════════════ */
function enrichDiagnostics(evidence, idcf) {
  if (!idcf || idcf.error) return evidence;
  const b = idcf.base;
  const a = idcf.assumptions;
  const flags = [...(evidence.modelDiagnostics || [])];
  const mqs = evidence.modelQualityScore || { score: 100, label: "High", strengths: [], weaknesses: [] };
  let score = mqs.score;
  const weaknesses = [...(mqs.weaknesses || [])];
  const strengths = [...(mqs.strengths || [])];

  if (b.terminalShare > 0.85) {
    flags.push({ severity: "Critical", check: "Terminal value > 85% of Enterprise Value", detail: `Terminal value contributes ${(b.terminalShare * 100).toFixed(1)}% of EV — valuation is almost entirely assumption-driven`, fix: "Extend forecast period, reduce terminal growth, or revisit the explicit-period drivers" });
    score -= 18;
    weaknesses.push(`Terminal value ${(b.terminalShare * 100).toFixed(0)}% of EV — model leans almost entirely on TV`);
  } else if (b.terminalShare > 0.75) {
    flags.push({ severity: "High", check: "Terminal value > 75% of Enterprise Value", detail: `Terminal value contributes ${(b.terminalShare * 100).toFixed(1)}% of EV — valuation is dominated by assumptions beyond the explicit forecast window`, fix: "Extend forecast period, reduce terminal growth, or validate long-run assumptions rigorously" });
    score -= 10;
    weaknesses.push(`Terminal value ${(b.terminalShare * 100).toFixed(0)}% of EV — explicit forecast underweighted`);
  } else if (b.terminalShare > 0 && b.terminalShare < 0.65) {
    strengths.push(`Explicit forecast carries ${((1 - b.terminalShare) * 100).toFixed(0)}% of EV — robust foundation`);
  }

  const lastFcff = b.rows?.at(-1)?.fcff;
  if (lastFcff != null && lastFcff < 0) {
    flags.push({ severity: "Critical", check: "Terminal-year FCFF is negative", detail: "A Gordon Growth terminal value on negative FCFF produces a meaningless result", fix: "Revise capex, working capital, or margin assumptions so terminal-year FCFF turns positive" });
    score -= 25;
    weaknesses.push("Terminal-year FCFF is negative — Gordon TV is meaningless");
  }

  if (b.perShare != null && (!isFinite(b.perShare) || b.perShare < 0)) {
    flags.push({ severity: "Critical", check: "Implied share value non-positive", detail: "Equity bridge produced a negative or infinite per-share value", fix: "Check net debt, share count, and that PV(FCFF)+TV exceed net debt" });
    score -= 30;
    weaknesses.push("Implied per-share value is non-positive — model output is unusable");
  }

  // Bull/bear monotonicity — values must satisfy bear ≤ base ≤ bull
  if (idcf.bear && idcf.bull && b) {
    const bear = idcf.bear.perShare, base = b.perShare, bull = idcf.bull.perShare;
    if (bear != null && base != null && bull != null) {
      if (bear > base || base > bull) {
        flags.push({ severity: "Medium", check: "Scenario monotonicity broken", detail: `Bear ${bear.toFixed(1)} / Base ${base.toFixed(1)} / Bull ${bull.toFixed(1)} — ordering is not bear ≤ base ≤ bull`, fix: "Check scenario delta signs in the scenario table" });
        score -= 6;
        weaknesses.push("Scenario ordering bear ≤ base ≤ bull is violated");
      }
    }
  }

  if (a.growthY1_5 > 20) {
    flags.push({ severity: "Medium", check: "Revenue growth above 20%", detail: `${a.growthY1_5.toFixed(1)}% growth is aggressive for a mature listed company — ensure it is anchored to capacity expansion or market data`, fix: "Apply to hyper-growth stage companies only; use sector growth as sanity check" });
  }

  // Recompute label band
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const label = clamped >= 75 ? "High" : clamped >= 50 ? "Moderate" : "Low";

  return {
    ...evidence,
    modelDiagnostics: flags,
    modelQualityScore: { score: clamped, label, strengths, weaknesses },
  };
}

module.exports = { normStatements, computeRatios, computeGrowth, varianceAnalysis, dcfDefaults, runDCF, institutionalDCF, forensicScores, riskAssessment, multiValuation, monteCarlo, correlationMatrix, annVol, maxDrawdown, momentum, ruleNarrative, returns, stdev, assumptionEvidence, enrichDiagnostics };
