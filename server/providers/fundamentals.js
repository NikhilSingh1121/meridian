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
  })).filter((r) => r.year);
  const balance = rows.map((r) => ({
    year: yr(r.date), assets: pick(r, "totalAssets"), currentAssets: pick(r, "currentAssets"),
    currentLiab: pick(r, "currentLiabilities"), inventory: pick(r, "inventory"),
    receivables: pick(r, "receivables", "accountsReceivable"), payables: pick(r, "accountsPayable", "payables"),
    cash: pick(r, "cashAndCashEquivalents", "cashCashEquivalentsAndShortTermInvestments"),
    equity: pick(r, "stockholdersEquity", "commonStockEquity", "totalEquityGrossMinorityInterest"),
    ltDebt: pick(r, "longTermDebt"), stDebt: pick(r, "currentDebt", "currentDebtAndCapitalLeaseObligation"),
    totalDebt: pick(r, "totalDebt"),
  })).filter((r) => r.year);
  const cashflow = rows.map((r) => ({
    year: yr(r.date), ocf: pick(r, "operatingCashFlow", "cashFlowFromContinuingOperatingActivities"),
    capex: pick(r, "capitalExpenditure") !== null ? Math.abs(pick(r, "capitalExpenditure")) : null,
    dividends: pick(r, "cashDividendsPaid", "commonStockDividendPaid") !== null ? Math.abs(pick(r, "cashDividendsPaid", "commonStockDividendPaid")) : null,
    dep: pick(r, "depreciationAndAmortization", "depreciationAmortizationDepletion"),
    fcf: pick(r, "freeCashFlow"),
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

async function peerSuggestions(symbol) {
  const y = await yf();
  try {
    const res = await y.recommendationsBySymbol(symbol);
    return (res.recommendedSymbols || []).map((r) => r.symbol).slice(0, 6);
  } catch { return []; }
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

module.exports = { quoteSummary, miniSummary, chartCloses, peerSuggestions, newsFor, searchSymbols, UNIVERSE, pool };
