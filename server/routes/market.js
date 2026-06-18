const express = require("express");
const router = express.Router();
const yahoo = require("../providers/yahoo");
const { cached } = require("../cache");

/** The instruments shown on the homepage Market Pulse board + hero ribbon. */
const PULSE = {
  indices: [
    { symbol: "^NSEI", label: "NIFTY 50" },
    { symbol: "^BSESN", label: "SENSEX" },
    { symbol: "^NSEBANK", label: "NIFTY BANK" },
    { symbol: "^GSPC", label: "S&P 500" },
    { symbol: "^IXIC", label: "NASDAQ" },
    { symbol: "^FTSE", label: "FTSE 100" },
    { symbol: "^N225", label: "NIKKEI 225" },
    { symbol: "^HSI", label: "HANG SENG" },
  ],
  commodities: [
    { symbol: "GC=F", label: "GOLD" },
    { symbol: "SI=F", label: "SILVER" },
    { symbol: "CL=F", label: "WTI CRUDE" },
    { symbol: "BZ=F", label: "BRENT" },
  ],
  currencies: [
    { symbol: "USDINR=X", label: "USD / INR" },
    { symbol: "EURUSD=X", label: "EUR / USD" },
    { symbol: "GBPUSD=X", label: "GBP / USD" },
    { symbol: "JPY=X", label: "USD / JPY" },
  ],
  rates: [
    { symbol: "^TNX", label: "US 10Y" },
    { symbol: "^FVX", label: "US 5Y" },
    { symbol: "^TYX", label: "US 30Y" },
  ],
  crypto: [
    { symbol: "BTC-USD", label: "BITCOIN" },
    { symbol: "ETH-USD", label: "ETHEREUM" },
  ],
};

const QUOTE_TTL = 15 * 1000; // 15s cache — serves fast polling without hammering Yahoo
const HISTORY_TTL = 5 * 60 * 1000;
const SEARCH_TTL = 10 * 60 * 1000;

async function quoteSafe(symbol, label) {
  try {
    const q = await cached(`q:${symbol}`, QUOTE_TTL, () => yahoo.getQuote(symbol));
    return { ...q, label: label || q.name };
  } catch (err) {
    return { symbol, label: label || symbol, error: true };
  }
}

/** GET /api/pulse — everything the homepage needs, in one call. */
router.get("/pulse", async (_req, res) => {
  try {
    const groups = await Promise.all(
      Object.entries(PULSE).map(async ([group, list]) => {
        const quotes = await Promise.all(list.map((i) => quoteSafe(i.symbol, i.label)));
        return [group, quotes];
      })
    );
    res.json({ asOf: Date.now(), groups: Object.fromEntries(groups) });
  } catch (err) {
    res.status(502).json({ error: "Pulse unavailable", detail: String(err.message || err) });
  }
});

/** GET /api/quote/:symbol — single live quote (e.g. RELIANCE.NS, AAPL, ^NSEI). */
router.get("/quote/:symbol", async (req, res) => {
  try {
    const q = await cached(`q:${req.params.symbol}`, QUOTE_TTL, () =>
      yahoo.getQuote(req.params.symbol)
    );
    res.json(q);
  } catch (err) {
    res.status(404).json({ error: `No live data for ${req.params.symbol}` });
  }
});

/** GET /api/history/:symbol?range=6mo&interval=1d */
router.get("/history/:symbol", async (req, res) => {
  const { range = "6mo", interval = "1d" } = req.query;
  const ALLOWED_RANGE = ["1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "max"];
  const ALLOWED_INT = ["1m", "5m", "15m", "30m", "1h", "1d", "1wk", "1mo"];
  if (!ALLOWED_RANGE.includes(range) || !ALLOWED_INT.includes(interval)) {
    return res.status(400).json({ error: "Invalid range or interval" });
  }
  try {
    const h = await cached(`h:${req.params.symbol}:${range}:${interval}`, HISTORY_TTL, () =>
      yahoo.getHistory(req.params.symbol, range, interval)
    );
    res.json(h);
  } catch (err) {
    res.status(404).json({ error: `No history for ${req.params.symbol}` });
  }
});

/** GET /api/search?q=reliance — live symbol lookup. */
router.get("/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 2) return res.json({ results: [] });
  try {
    const results = await cached(`s:${q.toLowerCase()}`, SEARCH_TTL, () => yahoo.search(q));
    res.json({ results });
  } catch (err) {
    res.status(502).json({ error: "Search unavailable" });
  }
});

module.exports = router;
