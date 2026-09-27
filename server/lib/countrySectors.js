/**
 * Country sector engine — sector / industry / company breakdown for any of the
 * 57 regions in Yahoo's equity screener (finance.yahoo.com/research-hub/screener,
 * Region filter, market cap: all).
 *
 * Each country is fetched on demand, a few calls at a time, and cached: Yahoo
 * rate-limits bursts (HTTP 429), so nothing here sweeps every country at once.
 *
 *   overview(code, onProgress) → the 11 sectors: market cap, weight, cap-weighted
 *                                day % and 52-week %, company counts
 *   detail(code, sectorKey)    → one sector: industries + every company
 *
 * Market caps are converted into the country's main trading currency (the most
 * common quote currency in that market) at live Yahoo FX rates; prices stay in
 * each listing's own currency. Listings of the same company on several
 * exchanges are NOT merged yet — every ticker is its own row.
 */
const F = require("../providers/fundamentals");
const { cached } = require("../cache");

const COUNTRIES = {
  us: "United States", ar: "Argentina", at: "Austria", au: "Australia", be: "Belgium", br: "Brazil", ca: "Canada",
  ch: "Switzerland", cl: "Chile", cn: "China", cz: "Czechia", de: "Germany", dk: "Denmark", ee: "Estonia", eg: "Egypt",
  es: "Spain", fi: "Finland", fr: "France", gb: "United Kingdom", gr: "Greece", hk: "Hong Kong SAR China", hu: "Hungary",
  id: "Indonesia", ie: "Ireland", il: "Israel", in: "India", is: "Iceland", it: "Italy", jp: "Japan", kr: "South Korea",
  kw: "Kuwait", lk: "Sri Lanka", lt: "Lithuania", lv: "Latvia", mx: "Mexico", my: "Malaysia", nl: "Netherlands",
  no: "Norway", nz: "New Zealand", pe: "Peru", ph: "Philippines", pk: "Pakistan", pl: "Poland", pt: "Portugal",
  qa: "Qatar", ru: "Russia", sa: "Saudi Arabia", se: "Sweden", sg: "Singapore", za: "South Africa", sr: "Suriname",
  th: "Thailand", tr: "Turkey", tw: "Taiwan", ve: "Venezuela", vn: "Vietnam",
};

const SECTORS = [
  ["technology", "Technology"], ["financial-services", "Financial Services"], ["healthcare", "Healthcare"],
  ["consumer-cyclical", "Consumer Cyclical"], ["communication-services", "Communication Services"],
  ["industrials", "Industrials"], ["consumer-defensive", "Consumer Defensive"], ["energy", "Energy"],
  ["basic-materials", "Basic Materials"], ["real-estate", "Real Estate"], ["utilities", "Utilities"],
];

const PAGE = 250;               // screener maximum
const MAX_PER_QUERY = 2000;     // rows per sector / industry (largest first); the API's total is still reported
const CONCURRENCY = 2;          // gentle — Yahoo answers bursts with 429
const ROWS_TTL = 30 * 60 * 1000;
const FX_TTL = 30 * 60 * 1000;

/* sub-unit quote currencies → [ISO base, factor] (pence, cents, agorot, fils) */
const SUBUNIT = { GBp: ["GBP", 0.01], GBX: ["GBP", 0.01], ZAc: ["ZAR", 0.01], ILA: ["ILS", 0.01], KWF: ["KWD", 0.001] };
const unitOf = (c) => SUBUNIT[c] || [c, 1];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); await sleep(120); }
  }));
  return out;
}

const eq = (f, v) => ({ operator: "eq", operands: [f, v] });
/* the sector feed writes "Beverages - Brewers"; the screener only matches "Beverages—Brewers" */
const screenerIndustry = (name) => String(name).replace(/\s+-\s+/g, "—");
/** every row for a query, largest market cap first, capped at MAX_PER_QUERY */
async function fetchAll(operands, onPage) {
  const first = await F.screener({ size: PAGE, offset: 0, sortField: "intradaymarketcap", sortType: "DESC", query: { operator: "AND", operands } });
  const rows = [...(first.quotes || [])];
  const total = first.total || rows.length;
  onPage && onPage();
  for (let off = PAGE; off < Math.min(total, MAX_PER_QUERY); off += PAGE) {
    await sleep(120);
    const r = await F.screener({ size: PAGE, offset: off, sortField: "intradaymarketcap", sortType: "DESC", query: { operator: "AND", operands } });
    rows.push(...(r.quotes || []));
    onPage && onPage();
  }
  return { rows, total };
}

/* ── FX: value in currency c → value in currency `to` ── */
async function fxRates(currencies) {
  const bases = [...new Set(currencies.map((c) => unitOf(c)[0]))].filter((c) => c && c !== "USD").sort();
  return cached(`csec:fx:${bases.join(",")}`, FX_TTL, async () => {
    const rate = { USD: 1 };
    if (bases.length) {
      const q = await F.batchQuotes(bases.map((b) => `${b}USD=X`));
      for (const x of q) if (x && x.regularMarketPrice) rate[x.symbol.slice(0, 3)] = x.regularMarketPrice;
    }
    return rate;
  });
}
/* Yahoo quotes pence / cent listings in the sub-unit but reports their market
   cap in the main unit (HSBA.L: price 1,512 GBp, market cap £258.7B), so market
   caps convert at the base currency's rate with no sub-unit factor. */
const mcapToUsd = (rate, c) => { const [b] = unitOf(c); return rate[b] != null ? rate[b] : null; };

const RATING = (s) => { const m = String(s || "").match(/([\d.]+)\s*-\s*(.+)/); return m ? { score: +m[1], label: m[2].trim() } : null; };
function mapRow(q) {
  const r = RATING(q.averageAnalystRating);
  return {
    symbol: q.symbol, ticker: q.symbol,
    name: q.longName || q.shortName || q.displayName || q.symbol,
    exchange: q.fullExchangeName || q.exchange || "",
    exchangeCode: q.exchange || null,       // Yahoo code: NSI, BSE, LSE, GER …
    currency: q.currency || null,
    price: q.regularMarketPrice ?? null,
    mcapLocal: q.marketCap ?? null,          // in the listing's own currency
    dayPct: q.regularMarketChangePercent ?? null,
    y1Pct: q.fiftyTwoWeekChangePercent ?? null,
    pe: q.trailingPE ?? null,
    rating: r ? r.label : null, ratingScore: r ? r.score : null,
  };
}

/* the country's main currency: the one carrying the most listings */
function mainCurrency(rows) {
  const n = {}; for (const r of rows) if (r.currency) n[r.currency] = (n[r.currency] || 0) + 1;
  const top = Object.entries(n).sort((a, b) => b[1] - a[1])[0];
  return top ? unitOf(top[0])[0] : "USD";
}
/* convert every row's market cap into `main`; rows with no FX are left out of totals */
function convert(rows, rate, main) {
  const mainUsd = rate[main];
  for (const r of rows) {
    const f = r.currency ? mcapToUsd(rate, r.currency) : null;
    r.mcap = r.mcapLocal != null && f != null && mainUsd ? (r.mcapLocal * f) / mainUsd : null;
  }
}
const wavg = (rows, k) => { let n = 0, d = 0; for (const r of rows) if (r[k] != null && r.mcap) { n += r.mcap * r[k]; d += r.mcap; } return d ? n / d : null; };

/* ── per-sector rows for a country (memory-cached; the detail view reuses them) ── */
function sectorRows(code, name, onPage) {
  return cached(`csec:rows:${code}:${name}`, ROWS_TTL, async () => {
    const { rows, total } = await fetchAll([eq("region", code), eq("sector", name)], onPage);
    return { rows: rows.map(mapRow), total };
  });
}

/* exchanges present in a country's listings, largest market cap first */
function exchangesOf(rows) {
  const m = new Map();
  for (const r of rows) {
    if (!r.exchangeCode) continue;
    const e = m.get(r.exchangeCode) || { code: r.exchangeCode, name: r.exchange || r.exchangeCode, companies: 0, mcap: 0 };
    e.companies++; e.mcap += r.mcap || 0; m.set(r.exchangeCode, e);
  }
  return [...m.values()].sort((a, b) => b.mcap - a.mcap);
}
const onExchange = (rows, ex) => (ex ? rows.filter((r) => r.exchangeCode === ex) : rows);

/* `exchange` (a Yahoo code) keeps one exchange's listings only — the way to
   avoid counting a company once per exchange (e.g. NSE and BSE in India).
   Rows are shared across exchanges, so switching exchange re-uses the cache. */
async function overview(code, exchange, onProgress) {
  let done = 0; const est = SECTORS.length;
  const bump = () => { done++; onProgress && onProgress({ done: Math.min(done, est - 1), total: est }); };
  const per = await pool(SECTORS, CONCURRENCY, async ([key, name]) => ({ key, name, ...(await sectorRows(code, name, bump)) }));
  const every = per.flatMap((s) => s.rows);
  const main = mainCurrency(every);
  const rate = await fxRates([main, ...every.map((r) => r.currency).filter(Boolean)]);
  convert(every, rate, main);
  const exchanges = exchangesOf(every);
  const ex = exchange && exchanges.some((e) => e.code === exchange) ? exchange : null;
  const all = onExchange(every, ex);
  const totalMcap = all.reduce((a, r) => a + (r.mcap || 0), 0);
  const sectors = per.map((s0) => {
    const s = { ...s0, rows: onExchange(s0.rows, ex) };
    const mcap = s.rows.reduce((a, r) => a + (r.mcap || 0), 0);
    return {
      key: s.key, name: s.name,
      mcap, weight: totalMcap ? (mcap / totalMcap) * 100 : null,
      dayPct: wavg(s.rows, "dayPct"), y1Pct: wavg(s.rows, "y1Pct"), ytdPct: null,
      // one exchange: the fetched rows ARE the count (complete unless the sector was capped)
      companies: ex ? s.rows.length : s.total, fetched: s.rows.length, capped: s0.rows.length < s0.total, industries: null,
    };
  }).filter((s) => s.companies > 0).sort((a, b) => (b.mcap || 0) - (a.mcap || 0));
  onProgress && onProgress({ done: est, total: est });
  return {
    asOf: Date.now(), mode: "country", country: code, countryName: COUNTRIES[code], currency: main,
    exchange: ex, exchangeName: ex ? exchanges.find((e) => e.code === ex).name : null, exchanges,
    fx: Object.fromEntries(Object.entries(rate).filter(([c]) => c !== "USD")),
    totalSectors: sectors.length, totalIndustries: null,
    totalCompanies: sectors.reduce((a, s) => a + s.companies, 0),
    totalMcap, dayPct: wavg(all, "dayPct"), y1Pct: wavg(all, "y1Pct"),
    truncated: sectors.some((s) => s.capped),
    sectors,
  };
}

/* ── one sector: industries (Yahoo's taxonomy for that sector) + every company ── */
async function detail(code, key, sectorMeta, exchange) {
  const pair = SECTORS.find(([k]) => k === key); if (!pair) throw new Error("Unknown sector");
  const name = pair[1];
  const { rows: every, total: totalAll } = await sectorRows(code, name);
  const ex = exchange && every.some((r) => r.exchangeCode === exchange) ? exchange : null;
  const rows = onExchange(every, ex), total = ex ? rows.length : totalAll;
  const inds = (sectorMeta && sectorMeta.industries || []).filter((i) => i.key && i.name);
  // tag each company with its industry: one screener query per industry of this sector
  const tag = new Map(), indTotal = new Map();
  await pool(inds, CONCURRENCY, async (ind) => {
    const r = await cached(`csec:ind:${code}:${ind.key}`, ROWS_TTL, () => fetchAll([eq("region", code), eq("industry", screenerIndustry(ind.name))]).then((x) => ({ syms: x.rows.map((q) => q.symbol), total: x.total })));
    for (const s of r.syms) tag.set(s, ind);
    indTotal.set(ind.key, r.total);
  });
  const main = mainCurrency(every);
  const rate = await fxRates([main, ...rows.map((r) => r.currency).filter(Boolean)]);
  const companies = rows.map((r) => ({ ...r }));
  convert(companies, rate, main);
  const mcap = companies.reduce((a, r) => a + (r.mcap || 0), 0);
  for (const c of companies) {
    const ind = tag.get(c.symbol);
    c.industry = ind ? ind.name : "Other"; c.industryKey = ind ? ind.key : "other";
    c.weight = c.mcap != null && mcap ? (c.mcap / mcap) * 100 : null;
  }
  const groups = new Map();
  for (const c of companies) { if (!groups.has(c.industryKey)) groups.set(c.industryKey, { key: c.industryKey, name: c.industry, rows: [] }); groups.get(c.industryKey).rows.push(c); }
  const industries = [...groups.values()].map((g) => {
    const m = g.rows.reduce((a, r) => a + (r.mcap || 0), 0);
    return { key: g.key, name: g.name, mcap: m, weight: mcap ? (m / mcap) * 100 : null, dayPct: wavg(g.rows, "dayPct"), y1Pct: wavg(g.rows, "y1Pct"), ytdPct: null, companies: !ex && indTotal.has(g.key) ? indTotal.get(g.key) : g.rows.length };
  }).filter((i) => i.mcap > 0 || i.companies).sort((a, b) => (b.mcap || 0) - (a.mcap || 0));
  companies.sort((a, b) => (b.mcap || 0) - (a.mcap || 0));
  return {
    mode: "country", country: code, countryName: COUNTRIES[code], key, name, exchange: ex,
    description: (sectorMeta && sectorMeta.overview && sectorMeta.overview.description) || "",
    currency: main, mcap, weight: null,
    industriesCount: industries.filter((i) => i.key !== "other").length,
    companiesCount: total, fetched: companies.length,
    metrics: { day: wavg(companies, "dayPct"), y1: wavg(companies, "y1Pct") },
    industries, companies,
  };
}

module.exports = { COUNTRIES, SECTORS, overview, detail };
