/**
 * Yahoo Finance provider — LIVE data, no API key required.
 * Uses the public chart + search endpoints (the same ones finance.yahoo.com runs on).
 *
 * Coverage: NSE (.NS), BSE (.BO), US, global indices (^NSEI, ^GSPC...),
 * FX (USDINR=X), commodities (GC=F, CL=F), crypto (BTC-USD).
 *
 * Upgrade path: drop in a paid provider (Finnhub / Twelve Data / TrueData for
 * NSE real-time) inside providers/ and switch in routes/market.js — the
 * normalized quote shape below is provider-agnostic.
 */
const V = require("../lib/validate");
const { cached, cachedPersistent } = require("../cache");

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json",
};

const CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart/";
const SEARCH_BASE = "https://query2.finance.yahoo.com/v1/finance/search";

async function fetchJson(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Upstream ${res.status} for ${url}`);
  return res.json();
}

/**
 * Official close of the last session BEFORE the current one, from daily bars.
 * It changes once per session, so it is cached per (symbol, session date) —
 * the 15s quote refresh costs no extra upstream calls after the first.
 */
async function prevSessionClose(symbol, meta) {
  if (!meta.regularMarketTime) return null;
  const off = meta.gmtoffset || 0;
  const localDate = (sec) => new Date((sec + off) * 1000).toISOString().slice(0, 10);
  const session = localDate(meta.regularMarketTime);
  return cachedPersistent(`pc:${symbol}:${session}`, 20 * 60 * 60 * 1000, async () => {   // one fetch per symbol per session, kept across restarts
    const url = `${CHART_BASE}${encodeURIComponent(symbol)}?range=5d&interval=1d`;
    const r = (await fetchJson(url))?.chart?.result?.[0];
    const ts = r?.timestamp || [], cl = r?.indicators?.quote?.[0]?.close || [];
    for (let i = ts.length - 1; i >= 0; i--) {
      if (cl[i] != null && localDate(ts[i]) < session) return cl[i];
    }
    throw new Error("no prior session"); // don't cache a miss
  });
}

/**
 * One call gets price + previous close + today's intraday series
 * (used for sparklines), so the whole pulse board costs one request per symbol.
 */
async function chartQuote(symbol) {
  const url = `${CHART_BASE}${encodeURIComponent(symbol)}?range=1d&interval=5m&includePrePost=false`;
  const data = await fetchJson(url);
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`No data for ${symbol}`);

  const meta = result.meta || {};
  const closes = (result.indicators?.quote?.[0]?.close || []).filter(
    (v) => v !== null && v !== undefined
  );

  const price = meta.regularMarketPrice ?? closes[closes.length - 1] ?? null;
  // Yahoo's chart meta.chartPreviousClose is unreliable for NSE indices (it can
  // point two sessions back, flipping the sign of the day change). The official
  // prior-session close comes from the daily bars instead; meta is the fallback.
  const dailyPrev = await prevSessionClose(symbol, meta).catch(() => null);
  const prevClose = dailyPrev ?? meta.chartPreviousClose ?? meta.previousClose ?? null;
  const change = price !== null && prevClose ? price - prevClose : null;
  const changePct = change !== null && prevClose ? (change / prevClose) * 100 : null;

  // Validation boundary: coerce types, repair inconsistencies, drop garbage —
  // every consumer downstream can trust this shape.
  return V.sanitizeQuote({
    symbol,
    name: meta.shortName || meta.longName || symbol,
    exchange: meta.fullExchangeName || meta.exchangeName || "",
    currency: meta.currency || "",
    price,
    prevClose,
    change,
    changePct,
    dayHigh: meta.regularMarketDayHigh ?? null,
    dayLow: meta.regularMarketDayLow ?? null,
    marketTime: meta.regularMarketTime ? meta.regularMarketTime * 1000 : null,
    marketState: meta.marketState || null, // PRE / REGULAR / POST / CLOSED
    spark: closes.slice(-60), // intraday sparkline series
  });
}

/* ── Yahoo load: batched quotes ─────────────────────────────────────────────
   A full chart call (price + session previous close + 5-minute sparkline) is needed once per
   5 minutes per symbol — that is the sparkline's resolution. Between those, the terminal's
   15-second quote refreshes only need price fields, and every symbol that comes due in the same
   moment is folded into ONE batch request of up to 50 symbols. Same refresh rate on screen,
   a fraction of the upstream calls. Any batch failure falls back to the chart call. */
// Yahoo gives market time as a Date, an ISO string or raw epoch seconds (futures) depending on the symbol
const tms = (v) => (v == null ? null : v instanceof Date ? v.getTime() : typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : Date.parse(v) || null);
const CHART_EVERY = 30 * 60e3;                 // full chart as a correction; the sparkline is kept current from batch prices
const PRICE_FRESH = 12e3;                      // a piggy-backed price serves the next 15-second refresh
const chartCache = new Map(), priceCache = new Map(), b5 = new Map();
let batchQ = null;
function note5(symbol, price, t) {                                    // 5-minute closes from batch prices (for the sparkline)
  const k = Math.floor(t / 300e3) * 300e3; let b = b5.get(symbol); if (!b) { b = []; b5.set(symbol, b); }
  if (b.length && b[b.length - 1].t === k) b[b.length - 1].c = price; else if (!b.length || k > b[b.length - 1].t) { b.push({ t: k, c: price }); if (b.length > 90) b.shift(); }
}
function batchPrice(symbol) {
  if (!batchQ) {
    batchQ = { syms: new Map() };
    setTimeout(async () => {
      const q = batchQ; batchQ = null;
      const all = [...q.syms.keys()];
      // piggy-back: fill the batch with other symbols whose price will soon be due, oldest first, so
      // the whole set converges on a few full batches a minute instead of many small ones
      const room = Math.ceil(all.length / 50) * 50 - all.length, now = Date.now();
      const extra = [...chartCache.keys()].filter((x) => !q.syms.has(x) && now - (priceCache.get(x)?.at || 0) > 5e3 && now - chartCache.get(x).lastAsk < 120e3)
        .sort((a, b) => (priceCache.get(a)?.at || 0) - (priceCache.get(b)?.at || 0)).slice(0, room);
      for (const x of extra) { all.push(x); q.syms.set(x, []); }
      for (let i = 0; i < all.length; i += 50) {
        const part = all.slice(i, i + 50);
        try {
          const rows = await require("./fundamentals").quoteFields(part);
          const by = new Map(rows.map((r) => [r.symbol, r]));
          for (const r of rows) if (r.regularMarketPrice > 0) { priceCache.set(r.symbol, { at: Date.now(), r }); note5(r.symbol, r.regularMarketPrice, tms(r.regularMarketTime) || Date.now()); }
          for (const s of part) { const r = by.get(s); for (const w of q.syms.get(s)) r ? w.res(r) : w.rej(new Error("not in batch")); }
        } catch (e) { for (const s of part) for (const w of q.syms.get(s)) w.rej(e); }
      }
    }, 40);
  }
  return new Promise((res, rej) => { const arr = batchQ.syms.get(symbol) || []; arr.push({ res, rej }); batchQ.syms.set(symbol, arr); });
}
async function getQuote(symbol) {
  let c = chartCache.get(symbol);
  // after a restart, a chart quote saved within the last 30 minutes (same session) is reused from disk
  if (!c && process.env.YAHOO_SAVER !== "0") {
    const sn = require("../cache").snap.read(`cq:${symbol}`);
    if (sn && Date.now() - sn.ts < CHART_EVERY && sn.value && sn.value.q) { c = { at: sn.ts, q: sn.value.q, lastAsk: Date.now() }; chartCache.set(symbol, c); }
  }
  if (!c || Date.now() - c.at > CHART_EVERY || process.env.YAHOO_SAVER === "0") {
    const q = await chartQuote(symbol);
    chartCache.set(symbol, { at: Date.now(), q, lastAsk: Date.now() });
    require("../cache").snap.write(`cq:${symbol}`, { q });
    if (chartCache.size > 2000) chartCache.delete(chartCache.keys().next().value);
    return q;
  }
  c.lastAsk = Date.now();
  try {
    const pc = priceCache.get(symbol);
    // the batch endpoint needs Yahoo's session (crumb); while that path cools down, use the chart call
    if (!(pc && Date.now() - pc.at < PRICE_FRESH) && require("../lib/upstream").sessionCooling()) throw new Error("session cooling");
    const r = pc && Date.now() - pc.at < PRICE_FRESH ? pc.r : await batchPrice(symbol);
    const price = r.regularMarketPrice;
    const mt = tms(r.regularMarketTime);
    if (!(price > 0)) throw new Error("no price");
    // a new session since the chart call: previous close and sparkline must be rebuilt
    if (c.q.marketTime && mt && new Date(mt + 19800e3).toISOString().slice(0, 10) !== new Date(c.q.marketTime + 19800e3).toISOString().slice(0, 10)) throw new Error("new session");
    // sparkline: the chart's 5-minute closes, extended by 5-minute closes seen in batch prices since
    let spark = c.q.spark;
    const b = b5.get(symbol), ct = Math.floor((c.q.marketTime || 0) / 300e3) * 300e3;
    if (Array.isArray(spark) && spark.length) {
      const after = (b || []).filter((x) => x.t >= ct);
      spark = after.length ? [...(after[0].t === ct ? spark.slice(0, -1) : spark), ...after.map((x) => x.c)].slice(-80) : [...spark.slice(0, -1), price];
    }
    return V.sanitizeQuote({ ...c.q, price, change: null, changePct: null,
      dayHigh: r.regularMarketDayHigh ?? c.q.dayHigh, dayLow: r.regularMarketDayLow ?? c.q.dayLow,
      marketTime: mt ?? c.q.marketTime, marketState: r.marketState || c.q.marketState, spark, batched: true });
  } catch {
    const q = await chartQuote(symbol);
    chartCache.set(symbol, { at: Date.now(), q, lastAsk: Date.now() });
    return q;
  }
}

async function getHistory(symbol, range = "6mo", interval = "1d") {
  const url = `${CHART_BASE}${encodeURIComponent(
    symbol
  )}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`;
  const data = await fetchJson(url);
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`No history for ${symbol}`);

  const ts = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const points = ts
    .map((t, i) => ({
      t: t * 1000,
      o: q.open?.[i] ?? null,
      h: q.high?.[i] ?? null,
      l: q.low?.[i] ?? null,
      c: q.close?.[i] ?? null,
      v: q.volume?.[i] ?? null,
    }))
    .filter((p) => p.c !== null);

  // Validation boundary: coherent OHLC, positive closes, monotonic timestamps.
  return { symbol, range, interval, currency: result.meta?.currency || "", points: V.sanitizeHistoryPoints(points) };
}

async function search(query) {
  const url = `${SEARCH_BASE}?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0&listsCount=0`;
  const data = await fetchJson(url);
  return (data.quotes || [])
    .filter((q) => q.symbol && (q.quoteType === "EQUITY" || q.quoteType === "INDEX" || q.quoteType === "ETF"))
    .map((q) => ({
      symbol: q.symbol,
      name: q.shortname || q.longname || q.symbol,
      exchange: q.exchDisp || q.exchange || "",
      type: q.quoteType,
    }));
}

/**
 * Batch quote — fetches up to 20 symbols in a SINGLE HTTP request.
 * Uses Yahoo's v7/finance/quote endpoint (same data, bulk mode).
 * This is what makes 10s polling viable — 1 request instead of 20.
 */
async function getBatchQuotes(symbols) {
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols.map(encodeURIComponent).join(",")}&fields=regularMarketPrice,regularMarketChangePercent,regularMarketChange,regularMarketPreviousClose,shortName,currency,marketState,regularMarketTime`;
  const data = await fetchJson(url);
  const results = data?.quoteResponse?.result || [];
  return results.map((q) => ({
    symbol: q.symbol,
    name: q.shortName || q.symbol,
    currency: q.currency || "",
    price: q.regularMarketPrice ?? null,
    change: q.regularMarketChange ?? null,
    changePct: q.regularMarketChangePercent ?? null,
    prevClose: q.regularMarketPreviousClose ?? null,
    marketState: q.marketState || null,
    marketTime: q.regularMarketTime ? q.regularMarketTime * 1000 : null,
    spark: [],
  }));
}

module.exports = { getQuote, chartQuote, getBatchQuotes, getHistory, search };
