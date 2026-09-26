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
const { cached } = require("../cache");

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
  return cached(`pc:${symbol}:${session}`, 6 * 60 * 60 * 1000, async () => {
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
async function getQuote(symbol) {
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

module.exports = { getQuote, getBatchQuotes, getHistory, search };
