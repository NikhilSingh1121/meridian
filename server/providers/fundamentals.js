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

async function quoteSummary(symbol, modules = MODULES) {
  const y = await yf();
  const summary = await y.quoteSummary(symbol, { modules }, { validateResult: false });
  // attach normalized annual statements from the time-series API
  summary.__statements = await annualStatements(symbol).catch(() => ({ income: [], balance: [], cashflow: [] }));
  return summary;
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
    year: yr(r.date), revenue: pick(r, "totalRevenue", "operatingRevenue"),
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
    year: yr(r.date), assets: pick(r, "totalAssets"), currentAssets: pick(r, "currentAssets"),
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
    year: yr(r.date), ocf: pick(r, "operatingCashFlow", "cashFlowFromContinuingOperatingActivities"),
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
    const e = t.earningsEstimate || {};
    const avg = g(e.avg), ya = g(e.yearAgoEps);
    return {
      period: t.period, label: periodLabel[t.period], endDate: iso(t.endDate),
      epsAvg: avg, epsLow: g(e.low), epsHigh: g(e.high), numAnalysts: g(e.numberOfAnalysts),
      yearAgoEps: ya, growthPct: g(e.growth) != null ? g(e.growth) * 100 : (avg != null && ya ? ((avg - ya) / Math.abs(ya)) * 100 : null),
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

/** Screener / breadth universe — NIFTY-class large caps (.NS). Editable. */
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

module.exports = { quoteSummary, miniSummary, chartCloses, peerSuggestions, newsFor, searchSymbols, sectorApi, earningsSummary, UNIVERSE, pool };
