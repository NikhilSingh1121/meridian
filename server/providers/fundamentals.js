/** Fundamentals provider — wraps yahoo-finance2 (handles Yahoo auth/crumbs).
    Live company fundamentals: statements, ratios inputs, holders, estimates, news. */

let yfPromise = null;
async function yf() {
  if (!yfPromise) {
    yfPromise = import("yahoo-finance2").then((m) => {
      const inst = new m.default({ suppressNotices: ["yahooSurvey", "ripHistorical"] });
      return inst;
    });
  }
  return yfPromise;
}

// Statement-history modules were deprecated by Yahoo (empty since Nov 2024).
// We pull point-in-time summary modules here and statements via fundamentalsTimeSeries below.
const MODULES = [
  "assetProfile", "price", "summaryDetail", "financialData", "defaultKeyStatistics",
  "recommendationTrend", "majorHoldersBreakdown",
  "institutionOwnership", "fundOwnership", "insiderHolders", "netSharePurchaseActivity",
];

/** Live quotes for many symbols in ONE upstream request (breadth scan). */
async function batchQuotes(symbols) {
  const y = await yf();
  const fields = ["symbol", "shortName", "regularMarketPrice", "regularMarketChangePercent", "regularMarketPreviousClose", "fiftyTwoWeekHigh", "fiftyTwoWeekLow", "regularMarketTime", "regularMarketVolume", "averageDailyVolume3Month"];
  const rows = await y.quote(symbols, { fields }, { validateResult: false });
  return (Array.isArray(rows) ? rows : [rows]).filter(Boolean);
}

async function quoteSummary(symbol, modules = MODULES) {
  const y = await yf();
  const summary = await y.quoteSummary(symbol, { modules }, { validateResult: false });
  // attach normalized annual statements from the time-series API
  summary.__statements = await annualStatements(symbol).catch(() => ({ income: [], balance: [], cashflow: [] }));
  await toTradingCurrency(summary);
  fillShareCount(summary);
  return summary;
}

/* Shares outstanding drives market cap, per-share DCF value and every
   price-multiple. Yahoo sometimes omits it (seen from cloud-host IPs, e.g.
   RELIANCE.NS on Render), so fall back through other disclosed figures and
   derive market cap from it. The source is recorded in __sharesSource. */
function fillShareCount(summary) {
  const ks = (summary.defaultKeyStatistics = summary.defaultKeyStatistics || {});
  const sd = (summary.summaryDetail = summary.summaryDetail || {});
  const pr = (summary.price = summary.price || {});
  const num = (v) => (v != null && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
  const st = summary.__statements || {};
  const li = (st.income || []).at(-1) || {}, lb = (st.balance || []).at(-1) || {};
  const price = num(pr.regularMarketPrice) ?? num(sd.previousClose);
  const mcap = num(sd.marketCap) ?? num(pr.marketCap);
  const candidates = [
    ["reported", num(ks.sharesOutstanding)],
    ["implied", num(ks.impliedSharesOutstanding)],
    ["market cap / price", mcap && price ? mcap / price : null],
    ["balance sheet", num(lb.sharesIssued)],
    ["average shares", num(li.basicAvgShares)],
    ["net profit / EPS", num(li.netIncome) && num(li.basicEPS) ? li.netIncome / li.basicEPS : null],
  ];
  const hit = candidates.find(([, v]) => v != null);
  summary.__sharesSource = hit ? hit[0] : null;
  if (!hit) return;
  if (hit[0] !== "reported") ks.sharesOutstanding = Math.round(hit[1]);
  if (mcap == null && price) sd.marketCap = Math.round(hit[1] * price);
}

/** Some issuers file in one currency and trade in another — Yahoo gives
    Infosys' and HCL Tech's statements in USD while the shares trade in INR.
    Every statement amount (not years or share counts) is converted into the
    trading currency at today's rate, so ratios, the DCF, forensic scores and
    reports compare like with like. Recorded on summary.__statementFx. */
const NOT_MONEY = new Set(["year", "periodEnd", "basicAvgShares", "sharesIssued"]);
async function toTradingCurrency(summary) {
  const fc = summary.financialData && summary.financialData.financialCurrency;
  const pc = summary.price && summary.price.currency;
  const base = pc === "GBp" ? "GBP" : pc === "ZAc" ? "ZAR" : pc === "ILA" ? "ILS" : pc;
  if (!fc || !base || fc === base) return;
  let rate = null;
  try { const q = await batchQuotes([`${fc}${base}=X`]); rate = q[0] && q[0].regularMarketPrice; } catch { /* leave as filed */ }
  if (!rate || !isFinite(rate)) { summary.__statementFx = { from: fc, to: base, rate: null, note: "conversion rate unavailable — statements left in the filing currency" }; return; }
  const st = summary.__statements;
  // Yahoo's financialCurrency label is not reliable (HCL Tech says USD, its statements are
  // in INR). Convert only if it makes price-to-sales plausible: of the two readings, keep the
  // one closer to a typical P/S of ~3× (the two differ by the exchange rate, so this is decisive).
  const rev = (st.income || []).map((r) => r.revenue).filter((x) => x > 0).at(-1);
  const mcap = (summary.summaryDetail && summary.summaryDetail.marketCap) || (summary.price && summary.price.marketCap);
  if (rev && mcap) {
    const d = (ps) => Math.abs(Math.log(ps / 3));
    if (d(mcap / (rev * rate)) >= d(mcap / rev)) { summary.__statementFx = { from: fc, to: base, rate: null, note: `Yahoo labels the statements ${fc}, but their scale matches ${base} — left unconverted` }; return; }
  }
  // Each period at its own rate — flows (income, cash flow) at the average of the 12 months
  // to the period end, balances at the period-end rate; today's rate only when history is
  // missing. Converting every year at today's rate would turn currency moves into fake growth.
  let monthly = [];
  try {
    const y = await yf();
    const ch = await y.chart(`${fc}${base}=X`, { period1: new Date(Date.now() - 8 * 365 * 864e5), interval: "1mo" });
    monthly = (ch.quotes || []).filter((q) => q.close > 0).map((q) => ({ t: new Date(q.date).getTime(), c: q.close }));
  } catch { /* spot fallback */ }
  const rateFor = (end, flow) => {
    const e = end ? new Date(end).getTime() : null;
    if (!e || !monthly.length) return rate;
    const win = monthly.filter((m) => m.t <= e + 16 * 864e5 && m.t > e - (flow ? 365 : 35) * 864e5);
    return win.length ? win.reduce((a, m) => a + m.c, 0) / win.length : rate;
  };
  const used = [];
  for (const part of ["income", "balance", "cashflow"]) {
    for (const row of st[part] || []) {
      const r = rateFor(row.periodEnd, part !== "balance");
      if (part === "income") used.push(`FY${String(row.year).slice(2)} ${r.toFixed(2)}`);
      for (const k of Object.keys(row)) if (!NOT_MONEY.has(k) && typeof row[k] === "number" && isFinite(row[k])) row[k] *= r;
    }
  }
  summary.__statementFx = { from: fc, to: base, rate, note: `Statements filed in ${fc}, converted to ${base} at each period's own rate (flows: 12-month average; balances: period end) — ${used.join(", ")}` };
}

/** Annual statements via fundamentalsTimeSeries (current Yahoo API). */
async function annualStatements(symbol, years = 5) {
  const y = await yf();
  const period2 = new Date();
  const period1 = new Date(); period1.setFullYear(period2.getFullYear() - years - 1);
  const rows = await y.fundamentalsTimeSeries(symbol, { period1, period2, type: "annual", module: "all" });
  // rows: [{ date, totalRevenue, netIncome, ... }] oldest→newest
  const yr = (d) => (d ? new Date(d).getFullYear() : null);
  const pick = (r, ...keys) => { for (const k of keys) if (r[k] !== undefined && r[k] !== null) return Number(r[k]); return null; };
  const income = rows.map((r) => ({
    year: yr(r.date), periodEnd: r.date ? new Date(r.date).toISOString().slice(0, 10) : null, revenue: pick(r, "totalRevenue", "operatingRevenue"),
    grossProfit: pick(r, "grossProfit"), opIncome: pick(r, "operatingIncome", "totalOperatingIncomeAsReported"),
    ebit: pick(r, "EBIT"), ebitda: pick(r, "EBITDA", "normalizedEBITDA"),
    interest: pick(r, "interestExpense") !== null ? Math.abs(pick(r, "interestExpense")) : null,
    pretax: pick(r, "pretaxIncome"), tax: pick(r, "taxProvision"), netIncome: pick(r, "netIncome", "netIncomeCommonStockholders"),
    // ── Extended line items for the Integrated Forecast Financial Model ────
    cogs: pick(r, "costOfRevenue", "reconciledCostOfRevenue"),
    sga: pick(r, "sellingGeneralAndAdministration", "sellingGeneralAndAdministrativeExpense", "generalAndAdministrativeExpense"),
    otherOpExp: pick(r, "otherOperatingExpenses", "otherGandA", "otherOperatingIncomeExpenseNet"),
    interestIncome: pick(r, "interestIncome", "interestIncomeNonOperating") !== null ? Math.abs(pick(r, "interestIncome", "interestIncomeNonOperating")) : null,
    basicEPS: pick(r, "basicEPS", "dilutedEPS"),
    basicAvgShares: pick(r, "basicAverageShares", "dilutedAverageShares"),
    dilutedEPS: pick(r, "dilutedEPS", "basicEPS"),
    // ── PAT-correct mapping fields (per user spec) ─────────────────────────
    // netIncomeIncludingNoncontrollingInterests = total Profit After Tax for
    // the consolidated entity BEFORE allocating between parent and minority.
    // This is what Indian Ind AS statements call "Profit for the year" and
    // is the correct figure to display as PAT.
    netIncomeIncludingMI: pick(r, "netIncomeIncludingNoncontrollingInterests", "netIncomeFromContinuingAndDiscontinuedOperation", "netIncomeContinuousOperations"),
    associateIncome: pick(r, "earningsFromEquityInterest", "earningsFromEquityInterestNetOfTax", "incomeFromAssociatesAndOtherParticipatingInterests"),
    minorityIntIncome: pick(r, "minorityInterests", "netIncomeMinorityInterests", "otherIncomeMinority"),
  })).filter((r) => r.year);
  const balance = rows.map((r) => ({
    year: yr(r.date), periodEnd: r.date ? new Date(r.date).toISOString().slice(0, 10) : null, assets: pick(r, "totalAssets"), currentAssets: pick(r, "currentAssets"),
    currentLiab: pick(r, "currentLiabilities"), inventory: pick(r, "inventory"),
    receivables: pick(r, "receivables", "accountsReceivable"), payables: pick(r, "accountsPayable", "payables"),
    cash: pick(r, "cashAndCashEquivalents", "cashCashEquivalentsAndShortTermInvestments"),
    equity: pick(r, "stockholdersEquity", "commonStockEquity", "totalEquityGrossMinorityInterest"),
    ltDebt: pick(r, "longTermDebt"), stDebt: pick(r, "currentDebt", "currentDebtAndCapitalLeaseObligation"),
    totalDebt: pick(r, "totalDebt"),
    // ── Extended line items ────────────────────────────────────────────────
    ppe: pick(r, "netPPE", "grossPPE", "propertyPlantAndEquipmentNet"),
    intangibles: pick(r, "otherIntangibleAssets", "netIntangibleAssetsExcludingGoodwill"),
    goodwill: pick(r, "goodwill"),
    investments: pick(r, "longTermInvestments", "investmentsAndAdvances", "otherInvestments"),
    otherCA: pick(r, "otherCurrentAssets"),
    otherNCA: pick(r, "otherNonCurrentAssets", "otherAssets"),
    otherCL: pick(r, "otherCurrentLiabilities"),
    shareCapital: pick(r, "commonStock", "capitalStock"),
    sharesIssued: pick(r, "ordinarySharesNumber", "shareIssued"),
    retainedEarnings: pick(r, "retainedEarnings"),
    otherEquity: pick(r, "gainsLossesNotAffectingRetainedEarnings", "otherStockholdersEquity", "AOCIIncludingNoncontrollingInterests"),
    // ── Reconciliation-critical fields (for BS to balance) ────────────────
    totalLiabilities: pick(r, "totalLiabilitiesNetMinorityInterest", "totalLiab"),
    nonCurrentLiab: pick(r, "totalNonCurrentLiabilities", "totalNonCurrentLiabilitiesNetMinorityInterest"),
    otherNCL: pick(r, "otherNonCurrentLiabilities"),
    longTermLease: pick(r, "longTermCapitalLeaseObligation"),
    minorityInterest: pick(r, "minorityInterest"),
    deferredTaxLiab: pick(r, "nonCurrentDeferredTaxesLiabilities", "deferredTaxLiabilities"),
    deferredTaxAssets: pick(r, "nonCurrentDeferredTaxAssets", "deferredTaxAssets"),
    // Equity total INCLUDING minority interest (for some reporting conventions)
    totalEquityGrossMI: pick(r, "totalEquityGrossMinorityInterest"),
    additionalPaidInCapital: pick(r, "additionalPaidInCapital", "capitalSurplus"),
    treasuryStock: pick(r, "treasuryStock"),
  })).filter((r) => r.year);
  const cashflow = rows.map((r) => ({
    year: yr(r.date), periodEnd: r.date ? new Date(r.date).toISOString().slice(0, 10) : null, ocf: pick(r, "operatingCashFlow", "cashFlowFromContinuingOperatingActivities"),
    capex: pick(r, "capitalExpenditure") !== null ? Math.abs(pick(r, "capitalExpenditure")) : null,
    dividends: pick(r, "cashDividendsPaid", "commonStockDividendPaid") !== null ? Math.abs(pick(r, "cashDividendsPaid", "commonStockDividendPaid")) : null,
    dep: pick(r, "depreciationAndAmortization", "depreciationAmortizationDepletion"),
    fcf: pick(r, "freeCashFlow"),
    // ── Extended cash-flow line items ──────────────────────────────────────
    investingCF: pick(r, "investingCashFlow", "cashFlowFromContinuingInvestingActivities"),
    financingCF: pick(r, "financingCashFlow", "cashFlowFromContinuingFinancingActivities"),
    debtIssued: pick(r, "longTermDebtIssuance", "issuanceOfDebt", "longTermDebtAndCapitalLeaseIssuance"),
    debtRepaid: pick(r, "longTermDebtPayments", "repaymentOfDebt", "longTermDebtAndCapitalLeasePayments") !== null
                ? Math.abs(pick(r, "longTermDebtPayments", "repaymentOfDebt", "longTermDebtAndCapitalLeasePayments"))
                : null,
    buybacks: pick(r, "repurchaseOfCapitalStock", "commonStockRepurchased") !== null
              ? Math.abs(pick(r, "repurchaseOfCapitalStock", "commonStockRepurchased"))
              : null,
    netChange: pick(r, "changeInCashSupplementalAsReported", "netCashFlow", "changesInCash", "endCashPositionMinusBeginCashPosition"),
    // ── AUTHORITATIVE opening/closing cash (per the CF statement itself) ───
    // Yahoo exposes these explicitly. They must be used for the historical
    // CF tab — NOT the balance-sheet cash field, which includes short-term
    // investments and equivalents that differ from the CF statement's
    // "cash and cash equivalents" basis.
    beginningCash: pick(r, "beginningCashPosition"),
    endingCash:    pick(r, "endCashPosition"),
    // ── Operating-section components for institutional CF display ─────────
    wcChange: pick(r, "changeInWorkingCapital"),
    deferredTax: pick(r, "deferredIncomeTax", "deferredTax"),
    stockComp: pick(r, "stockBasedCompensation"),
    otherNonCash: pick(r, "otherNonCashItems"),
    // Acquisitions (business purchases) — kept separate from PP&E capex
    acquisitions: pick(r, "purchaseOfBusiness", "netBusinessPurchaseAndSale") !== null
      ? Math.abs(pick(r, "purchaseOfBusiness", "netBusinessPurchaseAndSale")) : null,
    deltaReceivables: pick(r, "changesInAccountReceivables", "changeInReceivables"),
    deltaInventory: pick(r, "changeInInventory"),
    deltaPayables: pick(r, "changeInAccountPayable", "changeInPayables", "changeInPayable"),
    interestPaid: pick(r, "interestPaidCFF", "interestPaidSupplementalData"),
    taxesPaid: pick(r, "taxesRefundPaid", "incomeTaxPaidSupplementalData"),
    // ── Investing-section components ──────────────────────────────────────
    fixedAssetsPurchased: pick(r, "purchaseOfPPE", "purchaseOfBusiness") !== null
      ? Math.abs(pick(r, "purchaseOfPPE", "purchaseOfBusiness")) : null,
    fixedAssetsSold: pick(r, "saleOfPPE", "saleOfBusiness"),
    investmentsPurchased: pick(r, "purchaseOfInvestment") !== null
      ? Math.abs(pick(r, "purchaseOfInvestment")) : null,
    investmentsSold: pick(r, "saleOfInvestment"),
    interestReceivedCFI: pick(r, "interestReceivedCFI"),
    dividendsReceivedCFI: pick(r, "dividendReceivedCFI", "dividendsReceivedCFI"),
    // ── Financing-section components ──────────────────────────────────────
    proceedsFromShares: pick(r, "issuanceOfCapitalStock", "proceedsFromIssuanceOfCommonStock", "commonStockIssuance"),
    debtIssuedShort: pick(r, "shortTermDebtIssuance"),
    debtRepaidShort: pick(r, "shortTermDebtPayments") !== null
      ? Math.abs(pick(r, "shortTermDebtPayments")) : null,
  })).filter((r) => r.year);
  cashflow.forEach((r) => { if (r.fcf === null && r.ocf !== null && r.capex !== null) r.fcf = r.ocf - r.capex; });
  return { income: income.slice(-4), balance: balance.slice(-4), cashflow: cashflow.slice(-4) };
}

/** Light bundle for peer rows / screener — fewer modules, faster. */
async function miniSummary(symbol) {
  const y = await yf();
  return y.quoteSummary(
    symbol,
    { modules: ["price", "summaryDetail", "financialData", "defaultKeyStatistics", "assetProfile"] },
    { validateResult: false }
  );
}

async function chartCloses(symbol, range = "6mo", interval = "1d") {
  const y = await yf();
  const period1 = new Date(Date.now() - rangeMs(range));
  const res = await y.chart(symbol, { period1, interval });
  return (res.quotes || []).map((q) => q.close).filter((c) => c !== null && c !== undefined);
}
function rangeMs(r) {
  const m = { "1mo": 31, "3mo": 92, "6mo": 184, "1y": 366, "2y": 732 }[r] || 184;
  return m * 24 * 3600 * 1000;
}

/** Yahoo sector/industry taxonomy API — the live feed behind
    finance.yahoo.com/sectors (global market weights, market caps, per-sector
    industry lists and top companies). Uses the library's authenticated fetch,
    which transparently handles Yahoo's crumb + cookie session (the same auth
    every other call in this app relies on). `path` examples:
      "sectors"                     → all-sectors aggregate + list
      "sectors/technology"          → one sector (overview, industries, companies)
      "industries/semiconductors"   → one industry (overview, companies)
    NB: "${YF_QUERY_HOST}" must stay a literal — the library substitutes it. */
async function sectorApi(path) {
  const y = await yf();
  return y._fetch("https://${YF_QUERY_HOST}/v1/finance/" + path, {}, {}, "json", true);
}

/** Yahoo equity screener — the engine behind finance.yahoo.com/research-hub/
    screener (region / sector / industry / market-cap filters, 250 rows a page).
    It is a POST, and the library would reuse the POST options when it has to
    mint a crumb, so the crumb is established first with an ordinary GET. On a
    failure the crumb is re-established once and the call retried. */
let _screenerWarm = false;
async function screener(body) {
  const y = await yf();
  const warm = async () => { await y.quote("AAPL", { fields: ["symbol"] }, { validateResult: false }); _screenerWarm = true; };
  const call = () => y._fetch("https://${YF_QUERY_HOST}/v1/finance/screener",
    { formatted: "false", lang: "en-US", region: "US" },
    { fetchOptions: { method: "POST", body: JSON.stringify({ userId: "", userIdType: "guid", quoteType: "EQUITY", ...body }), headers: { "content-type": "application/json" } } },
    "json", true);
  if (!_screenerWarm) await warm();
  let r;
  try { r = await call(); } catch (e) { await warm(); r = await call(); }
  const res = r && r.finance && r.finance.result && r.finance.result[0];
  if (!res) throw new Error("screener: empty result");
  return res;
}

/** Third-party fair value published on Yahoo (Trading Central's valuation
    model, finance.yahoo.com → Insights). Yahoo gives the discount of the price
    to fair value ("-8%" = price 8% above fair value), so fair value =
    price × (1 + discount). Mostly US-listed coverage; null when not published. */
async function marketFairValue(symbol, price) {
  if (!price || !isFinite(price)) return null;
  const y = await yf();
  const r = await y.insights(symbol, { reportsCount: 0 }, { validateResult: false });
  const v = r && r.instrumentInfo && r.instrumentInfo.valuation;
  const d = v && parseFloat(String(v.discount || "").replace(/[^\d.+-]/g, ""));
  if (!v || !isFinite(d)) return null;
  return { value: price * (1 + d / 100), discountPct: d, label: v.description || null, provider: v.provider || "Trading Central", relative: v.relativeValue || null };
}

async function peerSuggestions(symbol) {
  const y = await yf();
  try {
    const res = await y.recommendationsBySymbol(symbol);
    return (res.recommendedSymbols || []).map((r) => r.symbol).slice(0, 6);
  } catch { return []; }
}

/* ── Earnings pack — next call, recent calls (actual vs estimate + surprise),
   forward consensus, and universal transcript links. Live via yahoo-finance2
   (keyless) so it works for ANY ticker — NSE (.NS/.BO), US, or global. ── */
function _transcriptLinks(symbol, name) {
  const bare = symbol.replace(/\.(NS|BO)$/i, "");
  const isIndia = /\.(NS|BO)$/i.test(symbol);
  const q = encodeURIComponent(`${name || bare} earnings call transcript`);
  const links = [];
  if (isIndia) {
    links.push({ label: "Screener.in · concalls", url: `https://www.screener.in/company/${encodeURIComponent(bare)}/consolidated/` });
    links.push({ label: "Trendlyne · earnings", url: `https://trendlyne.com/equity/${encodeURIComponent(bare)}/` });
    links.push({ label: "NSE announcements", url: `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(bare)}` });
  } else {
    links.push({ label: "Seeking Alpha · transcripts", url: `https://seekingalpha.com/symbol/${encodeURIComponent(bare)}/earnings/transcripts` });
    links.push({ label: "Motley Fool · transcripts", url: `https://www.fool.com/quote/${encodeURIComponent(bare.toLowerCase())}/` });
  }
  links.push({ label: "Yahoo Finance", url: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/` });
  links.push({ label: "Search the transcript", url: `https://www.google.com/search?q=${q}` });
  return links;
}

async function earningsSummary(symbol) {
  const y = await yf();
  const r = await y.quoteSummary(
    symbol,
    { modules: ["price", "summaryDetail", "calendarEvents", "earnings", "earningsHistory", "earningsTrend"] },
    { validateResult: false }
  );
  // validateResult:false already unwraps {raw,fmt}→raw and coerces dates→Date
  const g = (x) => (x && typeof x === "object" && "raw" in x ? x.raw : x);
  const iso = (d) => { const t = g(d); if (t == null) return null; const dt = t instanceof Date ? t : new Date(t); return isNaN(dt) ? null : dt.toISOString(); };
  const pr = r.price || {}, ce = (r.calendarEvents && r.calendarEvents.earnings) || {};
  const eh = (r.earningsHistory && r.earningsHistory.history) || [];
  const et = (r.earningsTrend && r.earningsTrend.trend) || [];
  const fin = (r.earnings && r.earnings.financialsChart && r.earnings.financialsChart.yearly) || [];
  const name = pr.longName || pr.shortName || symbol;

  // NEXT earnings — earningsDate is an array (a window if unconfirmed)
  const rawDates = Array.isArray(ce.earningsDate) ? ce.earningsDate.map(iso).filter(Boolean) : [];
  const nextDate = rawDates.length ? rawDates[0] : null;
  const daysUntil = nextDate ? Math.round((new Date(nextDate) - Date.now()) / 86400000) : null;
  const next = {
    date: nextDate,
    dateEnd: rawDates.length > 1 ? rawDates[rawDates.length - 1] : null,
    isEstimate: !!ce.isEarningsDateEstimate,
    daysUntil,
    epsEstimate: g(ce.earningsAverage), epsLow: g(ce.earningsLow), epsHigh: g(ce.earningsHigh),
    revenueEstimate: g(ce.revenueAverage), revenueLow: g(ce.revenueLow), revenueHigh: g(ce.revenueHigh),
  };

  // RECENT calls — actual vs estimate + surprise, oldest→newest
  const history = eh.map((h) => {
    const act = g(h.epsActual), est = g(h.epsEstimate);
    let surprisePct = g(h.surprisePercent);
    if (surprisePct != null) surprisePct = surprisePct * 100; // fractional → %
    else if (act != null && est != null && est !== 0) surprisePct = ((act - est) / Math.abs(est)) * 100;
    return { date: iso(h.quarter), epsActual: act, epsEstimate: est, surprisePct, beat: surprisePct != null ? surprisePct >= 0 : null };
  }).filter((h) => h.date).sort((a, b) => new Date(a.date) - new Date(b.date));

  // FORWARD consensus by period
  const periodLabel = { "0q": "Current Qtr", "+1q": "Next Qtr", "0y": "Current FY", "+1y": "Next FY" };
  const forward = et.filter((t) => periodLabel[t.period]).map((t) => {
    const e = t.earningsEstimate || {}, rv = t.revenueEstimate || {}, rs = t.epsRevisions || {};
    const avg = g(e.avg), ya = g(e.yearAgoEps), ravg = g(rv.avg), rya = g(rv.yearAgoRevenue);
    return {
      period: t.period, label: periodLabel[t.period], endDate: iso(t.endDate),
      epsAvg: avg, epsLow: g(e.low), epsHigh: g(e.high), numAnalysts: g(e.numberOfAnalysts),
      yearAgoEps: ya, growthPct: g(e.growth) != null ? g(e.growth) * 100 : (avg != null && ya ? ((avg - ya) / Math.abs(ya)) * 100 : null),
      revenueAvg: ravg, revenueLow: g(rv.low), revenueHigh: g(rv.high), revenueAnalysts: g(rv.numberOfAnalysts), yearAgoRevenue: rya,
      revenueGrowthPct: g(rv.growth) != null ? g(rv.growth) * 100 : (ravg != null && rya ? ((ravg - rya) / Math.abs(rya)) * 100 : null),
      revisions: { up7: g(rs.upLast7days), up30: g(rs.upLast30days), down7: g(rs.downLast7Days ?? rs.downLast7days), down30: g(rs.downLast30days) },
    };
  });

  // rolling track record from the available window
  const scored = history.filter((h) => h.surprisePct != null);
  const beats = scored.filter((h) => h.beat).length, misses = scored.length - beats;
  const stats = {
    quarters: scored.length, beats, misses,
    hitRate: scored.length ? (beats / scored.length) * 100 : null,
    avgSurprise: scored.length ? scored.reduce((s, h) => s + h.surprisePct, 0) / scored.length : null,
  };

  return {
    available: true, symbol, name,
    exchange: pr.fullExchangeName || pr.exchangeName || pr.exchange || null,
    currency: pr.currency || null,
    price: g(pr.regularMarketPrice),
    next, history, forward, stats,
    annual: fin.map((yr) => ({ year: yr.date, earnings: g(yr.earnings), revenue: g(yr.revenue) })),
    links: _transcriptLinks(symbol, name),
    asOf: Date.now(),
  };
}

async function newsFor(query, count = 12) {
  const y = await yf();
  const res = await y.search(query, { newsCount: count, quotesCount: 0 });
  return (res.news || []).map((nw) => ({
    title: nw.title, publisher: nw.publisher,
    link: nw.link, time: nw.providerPublishTime ? new Date(nw.providerPublishTime).getTime() : null,
    tickers: nw.relatedTickers || [],
  }));
}

async function searchSymbols(query) {
  const y = await yf();
  const res = await y.search(query, { quotesCount: 8, newsCount: 0 });
  return (res.quotes || [])
    .filter((q) => q.symbol && ["EQUITY", "INDEX", "ETF"].includes(q.quoteType))
    .map((q) => ({ symbol: q.symbol, name: q.shortname || q.longname || q.symbol, exchange: q.exchDisp || "", type: q.quoteType }));
}

/** Market-breadth universe — NIFTY-class large caps (.NS). Editable. */
const UNIVERSE = [
  "RELIANCE", "HDFCBANK", "TCS", "BHARTIARTL", "ICICIBANK", "SBIN", "INFY", "BAJFINANCE",
  "HINDUNILVR", "ITC", "LT", "HCLTECH", "KOTAKBANK", "SUNPHARMA", "MARUTI", "M&M",
  "AXISBANK", "ULTRACEMCO", "NTPC", "TITAN", "BAJAJFINSV", "ONGC", "ADANIPORTS", "ADANIENT",
  "POWERGRID", "TATAMOTORS", "WIPRO", "JSWSTEEL", "COALINDIA", "BAJAJ-AUTO", "NESTLEIND",
  "ASIANPAINT", "TATASTEEL", "GRASIM", "TRENT", "SBILIFE", "HDFCLIFE", "TECHM", "EICHERMOT",
  "HINDALCO", "CIPLA", "DRREDDY", "SHRIRAMFIN", "BRITANNIA", "APOLLOHOSP", "INDUSINDBK",
  "HEROMOTOCO", "TATACONSUM", "BPCL", "BEL",
].map((s) => s + ".NS");

/** Run async fn over list with limited concurrency + pacing to avoid Yahoo rate limits. */
async function pool(items, limit, fn) {
  const out = [];
  let i = 0;
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const concurrency = Math.min(limit, 2); // cap at 2 to avoid Yahoo blocking parallel requests
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (i < items.length) {
        const idx = i++;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            out[idx] = await fn(items[idx]);
            await delay(250 + Math.random() * 150); // pace between calls
            break;
          } catch (e) {
            if (attempt === 0) await delay(2000 + Math.random() * 1000); // back off on first failure
            else out[idx] = { symbol: items[idx], error: String(e.message || e).slice(0, 80) };
          }
        }
      }
    })
  );
  return out;
}

module.exports = { batchQuotes, quoteSummary, miniSummary, chartCloses, peerSuggestions, newsFor, searchSymbols, sectorApi, screener, marketFairValue, earningsSummary, fillShareCount, UNIVERSE, pool };
