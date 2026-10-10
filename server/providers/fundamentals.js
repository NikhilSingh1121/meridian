/** Fundamentals provider — wraps yahoo-finance2 (handles Yahoo auth/crumbs).
    Live company fundamentals: statements, ratios inputs, holders, estimates, news. */

/* ── Yahoo session (crumb) ──────────────────────────────────────────────────
   Four Yahoo endpoints need a "crumb" (session token): company summaries, v7 quotes,
   the screener and the sector pages. From cloud IPs (Render) Yahoo often refuses the
   token endpoint (/v1/test/getcrumb → 429), typically right after a redeploy, when
   the new process has no session yet. Two library details turned that into a lasting
   outage: (1) yahoo-finance2 caches a FAILED crumb request for the life of the process
   and never asks again, and (2) a crumb written into its cookie jar is ignored once a
   crumb (good or failed) is cached. So the session is established here, not by the
   library:
     · a session given by the operator (YAHOO_COOKIE + YAHOO_CRUMB env vars), if set;
     · the A3 cookie from fc.yahoo.com, then the crumb from query2 / query1 getcrumb;
     · if getcrumb is refused, the crumb embedded in the finance.yahoo.com quote page
       (a different endpoint, so a refused getcrumb does not block it);
   then the library's cached state is cleared (getCrumbClear) and the new cookie +
   crumb are put in its jar, where it finds them before ever minting its own. The
   session is set up once at start-up and again whenever a call fails on the crumb,
   with retries spaced 30 s → 15 min so a refusing Yahoo is not hammered. These
   requests use https directly (huge response headers on the quote page overflow
   fetch's limit) and are paced here instead of by the upstream breakers. */
const https = require("https");
const path = require("path");
const { pathToFileURL } = require("url");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const CRUMB_ERR = /Failed to get crumb|Could not find crumb|Invalid Crumb|Unauthorized|unable to access this feature|No set-cookie header|cool-down|fetch failed/i;
const validCrumb = (c) => typeof c === "string" && c.length >= 5 && c.length < 64 && !/[\s<>{}"]/.test(c);
const SES = { ok: false, source: null, at: 0, fails: 0, nextAt: 0, lastError: null, envBad: false };
let _seeding = null;

function httpsGet(url, headers = {}, maxBody = 3e6) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { "User-Agent": UA, ...headers }, maxHeaderSize: 256 * 1024 }, (res) => {
      let body = "", size = 0; res.setEncoding("utf8");
      res.on("data", (d) => { size += d.length; if (size <= maxBody) body += d; else res.destroy(); });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
      res.on("close", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", () => resolve(null));
    req.setTimeout(15_000, () => req.destroy());
  });
}
const cookiesOf = (r) => ((r && r.headers && r.headers["set-cookie"]) || []);
const cookieHeader = (setCookies) => setCookies.map((c) => c.split(";")[0]).filter(Boolean).join("; ");

/** obtain { setCookies, crumb, source } without the library — null when Yahoo refuses every route */
async function mintSession() {
  const envCookie = (process.env.YAHOO_COOKIE || "").trim(), envCrumb = (process.env.YAHOO_CRUMB || "").trim();
  if (envCookie && validCrumb(envCrumb) && !SES.envBad) {
    const setCookies = envCookie.split(/;\s*/).filter((kv) => /^[^=\s]+=/.test(kv)).map((kv) => `${kv}; Domain=.yahoo.com; Path=/; Secure`);
    return { setCookies, crumb: envCrumb, source: "YAHOO_COOKIE / YAHOO_CRUMB" };
  }
  let setCookies = cookiesOf(await httpsGet("https://fc.yahoo.com/", { Accept: "text/html" }, 2e4));
  if (!setCookies.length) setCookies = cookiesOf(await httpsGet("https://www.yahoo.com/", { Accept: "text/html" }, 2e4));
  const cookie = cookieHeader(setCookies);
  if (!cookie) return null;
  for (const host of ["query2", "query1"]) {
    const r = await httpsGet(`https://${host}.finance.yahoo.com/v1/test/getcrumb`, { cookie, Accept: "*/*", Origin: "https://finance.yahoo.com", Referer: "https://finance.yahoo.com/" }, 2e3);
    const crumb = r && r.status === 200 ? String(r.body || "").trim() : "";
    if (validCrumb(crumb)) return { setCookies, crumb, source: `${host} getcrumb` };
  }
  // getcrumb refused: the quote page carries the same crumb in its embedded data
  const page = await httpsGet("https://finance.yahoo.com/quote/AAPL/", { cookie, Accept: "text/html,application/xhtml+xml" });
  const m = page && page.status === 200 && /"crumb"\s*:\s*"([^"]{5,64})"/.exec(page.body || "");
  const crumb = m ? m[1].replace(/\\u002F/gi, "/").replace(/\\\//g, "/") : "";
  if (validCrumb(crumb)) return { setCookies, crumb, source: "quote page" };
  return null;
}

/* the library's module-level crumb cache (same module instance the library itself imports) */
let _crumbClear;
async function crumbClear() {
  if (_crumbClear !== undefined) return _crumbClear;
  try {
    const root = path.resolve(path.dirname(require.resolve("yahoo-finance2")), "..", "..");
    const mod = await import(pathToFileURL(path.join(root, "esm", "src", "lib", "getCrumb.js")).href);
    _crumbClear = typeof mod.getCrumbClear === "function" ? mod.getCrumbClear : null;
  } catch { _crumbClear = null; }
  return _crumbClear;
}

/** establish a session for the library; resolves true when a fresh crumb is in its jar */
function seedYahooSession(inst, force = false) {
  if (_seeding) return _seeding;
  if (!force && Date.now() < SES.nextAt) return Promise.resolve(false);   // spaced retries — never hammer Yahoo
  _seeding = (async () => {
    const jar = inst && inst._opts && inst._opts.cookieJar;
    if (!jar) return false;
    const s = await mintSession().catch((e) => { SES.lastError = e.message; return null; });
    if (!s) {
      SES.fails++; SES.ok = false;
      SES.nextAt = Date.now() + Math.min(15 * 60e3, 30e3 * 2 ** Math.min(5, SES.fails - 1));
      console.warn(`[yahoo] could not establish a session token (attempt ${SES.fails}); next try ${new Date(SES.nextAt).toISOString()}. Charts, prices, statements and search do not need it.`);
      return false;
    }
    const clear = await crumbClear();
    if (clear) await clear(jar);            // drop the library's cached (failed or stale) crumb and cookies
    await jar.setFromSetCookieHeaders(s.setCookies, "https://finance.yahoo.com/");
    await jar.setCookie(`crumb=${s.crumb}`, "http://config.yf2/");
    Object.assign(SES, { ok: true, source: s.source, at: Date.now(), fails: 0, nextAt: Date.now() + 60e3, lastError: null });
    console.log(`[yahoo] session token established via ${s.source}`);
    return true;
  })().finally(() => { _seeding = null; });
  return _seeding;
}
function sessionInfo() { return { ok: SES.ok, source: SES.source, since: SES.at || null, failedAttempts: SES.fails, nextAttempt: SES.nextAt > Date.now() && !SES.ok ? new Date(SES.nextAt).toISOString() : null }; }

let yfPromise = null;
async function yf() {
  if (!yfPromise) {
    yfPromise = import("yahoo-finance2").then((m) => {
      const inst = new m.default({ suppressNotices: ["yahooSurvey", "ripHistorical"] });
      // set the session up front, so the library never has to mint one itself
      if (process.env.NODE_ENV !== "test" && !process.env.NODE_TEST_CONTEXT && !process.env.YAHOO_NO_WARM) seedYahooSession(inst, true).catch(() => {});
      // every library call: on a session (crumb) failure, re-establish the session and retry once
      return new Proxy(inst, {
        get(target, prop) {
          const v = target[prop];
          if (typeof v !== "function") return v;
          return async (...args) => {
            if (_seeding) await _seeding.catch(() => {});      // a session being set up: wait for it instead of minting in parallel
            try { return await v.apply(target, args); }
            catch (e) {
              if (!CRUMB_ERR.test(String(e && e.message))) throw e;
              if (SES.source === "YAHOO_COOKIE / YAHOO_CRUMB" && /Invalid Crumb|Unauthorized/i.test(String(e.message))) { SES.envBad = true; SES.nextAt = 0; console.warn("[yahoo] the YAHOO_COOKIE / YAHOO_CRUMB session was rejected — minting a fresh one instead"); }
              if (!(await seedYahooSession(target))) throw e;
              return v.apply(target, args);
            }
          };
        },
      });
    });
  }
  return yfPromise;
}

/* ── token-free price fields (Yahoo's spark endpoint) ────────────────────────
   Up to 20 symbols per request, no session token needed — the fallback for the v7 quote
   calls (batch prices, breadth) whenever the token is unavailable. Same row shape as the
   library's quote(); daily mode adds 50 / 200-day averages and 3-month average volume, which
   move once a day and so are fetched at most every 30 minutes per symbol. */
async function sparkFetch(symbols, range, interval) {
  const out = [];
  for (let i = 0; i < symbols.length; i += 20) {
    const part = symbols.slice(i, i + 20);
    const r = await fetch(`https://query1.finance.yahoo.com/v7/finance/spark?symbols=${part.map(encodeURIComponent).join(",")}&range=${range}&interval=${interval}`, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!r.ok) throw new Error(`spark ${r.status}`);
    const j = await r.json();
    for (const it of (j && j.spark && j.spark.result) || []) { const resp = it.response && it.response[0]; if (resp && resp.meta) out.push({ symbol: it.symbol, resp }); }
  }
  return out;
}
const dailyStats = new Map();   // symbol → { at, fiftyDayAverage, twoHundredDayAverage, averageDailyVolume3Month }
async function sparkRows(symbols, { daily = false } = {}) {
  const out = [];
  for (const { symbol, resp } of await sparkFetch(symbols, "1d", "5m")) {
    const m = resp.meta; if (!(m.regularMarketPrice > 0)) continue;
    const prev = m.previousClose ?? m.chartPreviousClose ?? null;
    const reg = m.currentTradingPeriod && m.currentTradingPeriod.regular, nowS = Date.now() / 1000;
    out.push({
      symbol, shortName: m.shortName || m.longName || symbol, longName: m.longName, currency: m.currency,
      regularMarketPrice: m.regularMarketPrice, regularMarketPreviousClose: prev,
      regularMarketChange: prev ? m.regularMarketPrice - prev : undefined, regularMarketChangePercent: prev ? (m.regularMarketPrice / prev - 1) * 100 : m.regularMarketChangePercent,
      regularMarketTime: m.regularMarketTime, regularMarketDayHigh: m.regularMarketDayHigh, regularMarketDayLow: m.regularMarketDayLow,
      regularMarketVolume: m.regularMarketVolume, fiftyTwoWeekHigh: m.fiftyTwoWeekHigh, fiftyTwoWeekLow: m.fiftyTwoWeekLow,
      marketState: reg && nowS >= reg.start && nowS < reg.end ? "REGULAR" : "CLOSED", __source: "spark",
    });
  }
  if (daily && out.length) {
    const stale = out.map((r) => r.symbol).filter((s) => !(dailyStats.get(s) && Date.now() - dailyStats.get(s).at < 30 * 60e3));
    if (stale.length) {
      const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : undefined);
      for (const { symbol, resp } of await sparkFetch(stale, "1y", "1d").catch(() => [])) {
        const q = (resp.indicators && resp.indicators.quote && resp.indicators.quote[0]) || {};
        const cl = (q.close || []).filter((x) => x != null), v = (q.volume || []).filter((x) => x != null).slice(-63);
        dailyStats.set(symbol, { at: Date.now(), fiftyDayAverage: cl.length >= 50 ? avg(cl.slice(-50)) : undefined, twoHundredDayAverage: cl.length >= 200 ? avg(cl.slice(-200)) : undefined, averageDailyVolume3Month: v.length ? Math.round(avg(v)) : undefined });
      }
    }
    for (const r of out) { const d = dailyStats.get(r.symbol); if (d) Object.assign(r, { fiftyDayAverage: d.fiftyDayAverage, twoHundredDayAverage: d.twoHundredDayAverage, averageDailyVolume3Month: d.averageDailyVolume3Month }); }
  }
  return out;
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
  const fields = ["symbol", "shortName", "regularMarketPrice", "regularMarketChangePercent", "regularMarketPreviousClose", "fiftyTwoWeekHigh", "fiftyTwoWeekLow", "regularMarketTime", "regularMarketVolume", "averageDailyVolume3Month", "fiftyDayAverage", "twoHundredDayAverage"];
  try {
    if (require("../lib/upstream").sessionCooling()) throw new Error("session cooling");
    const y = await yf();
    const rows = await y.quote(symbols, { fields }, { validateResult: false });
    return (Array.isArray(rows) ? rows : [rows]).filter(Boolean);
  } catch (e) {
    // no session token right now: the same fields from the token-free spark endpoint
    const rows = await sparkRows(symbols, { daily: true });
    if (!rows.length) throw e;
    return rows;
  }
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
async function annualStatements(symbol, years = 6) {   // one spare year: a stub period may be dropped below
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
  // Yahoo sometimes returns a period without its income statement (a stub, or a
  // year it hasn't filled in yet — e.g. NESTLEIND FY26 with revenue null). Left in,
  // it becomes the "latest year" and every model that starts from the latest
  // revenue (DCF, plan, ratios) fails. Drop such years from all three statements
  // together so they stay aligned by year; keep everything if no year qualifies.
  const usable = new Set(income.filter((r) => r.revenue != null && r.revenue > 0).map((r) => r.year));
  const keep = (arr) => (usable.size ? arr.filter((r) => usable.has(r.year)) : arr);
  return { income: keep(income).slice(-4), balance: keep(balance).slice(-4), cashflow: keep(cashflow).slice(-4) };
}

/** Price fields for many symbols in one request (the 15-second quote refresh between chart calls). */
async function quoteFields(symbols) {
  const fields = ["symbol", "regularMarketPrice", "regularMarketDayHigh", "regularMarketDayLow", "regularMarketTime", "regularMarketPreviousClose", "marketState"];
  try {
    if (require("../lib/upstream").sessionCooling()) throw new Error("session cooling");
    const y = await yf();
    const rows = await y.quote(symbols, { fields }, { validateResult: false });
    return (Array.isArray(rows) ? rows : [rows]).filter(Boolean);
  } catch (e) {
    // no session token right now: spark gives the same price fields without one
    const rows = await sparkRows(symbols);
    if (!rows.length) throw e;
    return rows;
  }
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

module.exports = { sessionInfo, sparkRows, batchQuotes, quoteFields, quoteSummary, miniSummary, chartCloses, peerSuggestions, newsFor, searchSymbols, sectorApi, screener, marketFairValue, earningsSummary, fillShareCount, UNIVERSE, pool };
