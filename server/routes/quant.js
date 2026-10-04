/**
 * MERIDIAN — Quant Lab API.
 *
 * Four research endpoints over the quant.js engines. Every one of them is a
 * pure function of Yahoo daily candles: no API key, no vendor analytics, no
 * stored state. Heavy grids (parameter surfaces, walk-forward folds, 1,000
 * bootstrap paths) run in-process and are cached, so a repeat request on the
 * same symbol/params is free.
 */
const express = require("express");
const router = express.Router();
const yahoo = require("../providers/yahoo");
const { cached, cachedDurable } = require("../cache");
const Q = require("../lib/quant");
const S = require("../lib/quant-stats");
const A = require("../lib/quant-assess");
/* conclusion + assumption check for the top of each desk; never allowed to break the report */
const withAssessment = (out, fn) => { try { return { ...out, assessment: fn(out) }; } catch (e) { console.warn("[quant] assessment:", e.message); return out; } };

const ANALYSIS_TTL = 10 * 60 * 1000;   // computed reports
const HISTORY_TTL = 5 * 60 * 1000;     // shares keys with routes/market.js

const RANGES = ["1y", "2y", "5y", "10y", "max"];
const cleanRange = (r) => (RANGES.includes(r) ? r : "5y");
const cleanSym = (s) => String(s || "").trim().toUpperCase().slice(0, 24);

/** Daily candles, sharing the same cache keys the rest of the app uses. */
function history(symbol, range) {
  return cachedDurable(`h:${symbol}:${range}:1d`, HISTORY_TTL, () => yahoo.getHistory(symbol, range, "1d"));
}

/**
 * Turn a thrown upstream error into a clean client response.
 *
 * A 404 from the chart API means the ticker does not exist — that is the
 * user's typo, not an outage, and it deserves 404 with a plain message.
 * Anything else is a genuine upstream failure. Either way the raw error is
 * logged server-side and never echoed back: the provider's message embeds the
 * full request URL, which is internal detail the browser has no use for.
 */
function failUpstream(res, err, symbol, what) {
  const msg = String((err && err.message) || err);
  console.error(`[quant] ${what} failed for ${symbol}:`, msg);
  if (/\b404\b|No (data|history)/i.test(msg)) {
    return res.status(404).json({ error: `No market data for ${symbol}. Check the ticker — Indian listings need a .NS or .BO suffix.` });
  }
  return res.status(502).json({ error: `${what} is unavailable right now. The market-data provider did not respond — try again shortly.` });
}

/* ══════════════════════════════════════════════════════════════════════════
   FACTOR PROXY SETS
   There is no free Fama-French feed for India, and importing US factor
   returns for an NSE stock would be meaningless. So factors are built as
   LONG-SHORT SPREADS between liquid, continuously-quoted indices and ETFs
   that the terminal can already fetch. Each spread isolates one style or
   macro sensitivity, and a beta reads as "return per unit of that spread".
   Every symbol below was verified live against Yahoo before being listed.
   ══════════════════════════════════════════════════════════════════════════ */

const FACTOR_SETS = {
  india: {
    label: "India · NSE factor proxies",
    benchmark: "^NSEI",
    note: "Style factors are NSE index spreads. USD/INR and crude quote nearly around the clock, so they are broadly synchronous with the Indian cash session; a US equity factor is deliberately excluded because its close lands after NSE's and would mix a lagged signal into the regression.",
    factors: [
      { key: "Market", long: "^NSEI", short: null, desc: "NIFTY 50 excess return — the market factor.", excess: true },
      { key: "Size", long: "NIFTY_MIDCAP_100.NS", short: "^NSEI", desc: "Midcap 100 minus NIFTY 50. Positive β ⇒ the name behaves like a midcap." },
      { key: "Cyclical", long: "^CNXMETAL", short: "^CNXFMCG", desc: "Metals minus FMCG — cyclical over defensive. Positive β ⇒ geared to the industrial cycle." },
      { key: "Financials", long: "^NSEBANK", short: "^NSEI", desc: "Bank NIFTY minus NIFTY 50 — credit and rate sensitivity." },
      { key: "Export/IT", long: "^CNXIT", short: "^NSEI", desc: "NIFTY IT minus NIFTY 50 — the export-earnings and global-tech-demand factor." },
      { key: "USDINR", long: "USDINR=X", short: null, desc: "Rupee depreciation. Positive β ⇒ the stock gains when the rupee weakens (exporter); negative ⇒ importer or dollar-debt exposure." },
      { key: "Crude", long: "CL=F", short: null, desc: "WTI crude return — input-cost and energy exposure." },
    ],
  },
  us: {
    label: "US / global · style-ETF factor proxies",
    benchmark: "^GSPC",
    note: "Style factors are built from the iShares single-factor ETFs, which track the MSCI USA factor indices. They are investable spreads, so a loading translates directly into a hedge you could actually put on.",
    factors: [
      { key: "Market", long: "^GSPC", short: null, desc: "S&P 500 excess return — the market factor.", excess: true },
      { key: "Size", long: "IWM", short: "SPY", desc: "Russell 2000 minus S&P 500 — the small-minus-big spread." },
      { key: "Value", long: "IWD", short: "IWF", desc: "Russell 1000 Value minus Growth — the high-minus-low book-to-price spread." },
      { key: "Momentum", long: "MTUM", short: "SPY", desc: "MSCI USA Momentum minus the market." },
      { key: "Quality", long: "QUAL", short: "SPY", desc: "MSCI USA Quality (high ROE, low leverage, stable earnings) minus the market." },
      { key: "LowVol", long: "USMV", short: "SPY", desc: "MSCI USA Minimum Volatility minus the market — the defensive factor." },
      { key: "Duration", long: "TLT", short: "SPY", desc: "20y+ Treasuries minus equities — long-rate sensitivity." },
    ],
  },
};

const regionOf = (symbol) => (/\.(NS|BO)$/i.test(symbol) ? "india" : "us");

/* ══════════════════════════════════════════════════════════════════════════
   ROUTES
   ══════════════════════════════════════════════════════════════════════════ */

/** GET /api/quant/strategies — the backtester's rule catalogue (static). */
router.get("/quant/strategies", (_req, res) => {
  res.json({ strategies: Q.strategyCatalogue().map((x) => ({ ...x, typical: A.TYPICAL[x.id] || null })) });
});

/**
 * GET /api/quant/backtest/:symbol
 *   ?strategy=sma_cross&range=5y&costBps=10&p_fast=20&p_slow=100
 *
 * Any `p_<key>` query parameter overrides that strategy parameter; unknown or
 * out-of-range values fall back to the published default (see resolveParams).
 */
router.get("/quant/backtest/:symbol", async (req, res) => {
  const symbol = cleanSym(req.params.symbol);
  const range = cleanRange(req.query.range);
  const strategy = String(req.query.strategy || "sma_cross");
  if (!Q.STRATEGIES[strategy]) return res.status(400).json({ error: "Unknown strategy" });

  const params = {};
  for (const [k, v] of Object.entries(req.query)) {
    if (k.startsWith("p_") && Number.isFinite(Number(v))) params[k.slice(2)] = Number(v);
  }
  const costBps = Number(req.query.costBps ?? 10);
  const key = `qbt:${symbol}:${range}:${strategy}:${costBps}:${JSON.stringify(params)}`;

  try {
    const out = await cached(key, ANALYSIS_TTL, async () => {
      const h = await history(symbol, range);
      if (!h || !h.points || h.points.length < 120) return { error: `Not enough daily history for ${symbol}.` };
      const r = Q.backtest(h.points, { strategy, params, costBps });
      if (r.error) return r;
      r.meta.symbol = symbol;
      r.meta.currency = h.currency || "";
      r.meta.range = range;
      r.meta.stale = !!h.stale;
      return r;
    });
    if (out.error) return res.status(422).json(out);
    res.json(withAssessment(out, (o) => A.assessBacktest(o, { symbol })));
  } catch (e) {
    failUpstream(res, e, symbol, "Backtest");
  }
});

/**
 * GET /api/quant/factors/:symbol?range=5y&rf=0.06
 * Multi-factor attribution against the region-appropriate proxy set.
 */
router.get("/quant/factors/:symbol", async (req, res) => {
  const symbol = cleanSym(req.params.symbol);
  const range = cleanRange(req.query.range);
  const region = FACTOR_SETS[req.query.region] ? req.query.region : regionOf(symbol);
  const set = FACTOR_SETS[region];
  const rf = Math.max(0, Math.min(0.2, Number(req.query.rf ?? (region === "india" ? 0.065 : 0.042))));

  try {
    const out = await cached(`qf:${symbol}:${range}:${region}:${rf}`, ANALYSIS_TTL, async () => {
      // One fetch per distinct leg, then align everything on common trading days.
      const legs = [...new Set(set.factors.flatMap((f) => [f.long, f.short]).filter(Boolean))];
      const raw = {};
      await Promise.all([symbol, ...legs].map(async (s) => {
        try {
          const h = await history(s, range);
          if (h && h.points && h.points.length > 60) raw[s] = h.points;
        } catch { /* a dead proxy drops out of the model rather than failing it */ }
      }));
      if (!raw[symbol]) return { error: `No history for ${symbol}.` };

      // Keep only factors whose legs all survived the fetch.
      const usable = set.factors.filter((f) => raw[f.long] && (!f.short || raw[f.short]));
      if (!usable.length) return { error: "No factor proxies available right now." };

      const aligned = S.alignByDate(
        Object.fromEntries([[symbol, raw[symbol]], ...usable.flatMap((f) => [[f.long, raw[f.long]], ...(f.short ? [[f.short, raw[f.short]]] : [])])])
      );
      if (aligned.dates.length < 120) return { error: `Only ${aligned.dates.length} overlapping trading days — need at least 120.` };

      const ret = (sym) => S.simpleReturns(aligned.closes[sym]);
      const assetRet = ret(symbol);
      const rfDaily = rf / Q.TRADING_DAYS;
      const factors = {};
      for (const f of usable) {
        const L = ret(f.long);
        factors[f.key] = f.short
          ? L.map((v, i) => v - ret(f.short)[i])
          : f.excess ? L.map((v) => v - rfDaily) : L;
      }

      const attr = Q.factorAttribution(assetRet, factors, { rf, marketKey: "Market", rollWindow: 63 });
      if (!attr) return { error: "Regression failed — not enough clean overlapping data." };

      // Attach the human description + the factor's own realised stats.
      attr.loadings = attr.loadings.map((l) => {
        const spec = usable.find((f) => f.key === l.factor);
        return {
          ...l,
          desc: spec.desc,
          legs: spec.short ? `${spec.long} − ${spec.short}` : spec.long,
          factorAnnReturn: S.mean(factors[l.factor]) * Q.TRADING_DAYS,
          factorAnnVol: S.stdev(factors[l.factor]) * Math.sqrt(Q.TRADING_DAYS),
        };
      });

      // Down-sampled rolling beta series carries dates for the chart.
      attr.rolling = attr.rolling.map((r) => ({ ...r, d: aligned.dates[r.i + 1] || aligned.dates[r.i] }));

      // Correlation matrix among the factors themselves — the visual companion
      // to the VIF column.
      const keys = Object.keys(factors);
      const fcorr = keys.map((a) => keys.map((b) => {
        const c = S.correlation(factors[a], factors[b]);
        return c == null ? null : +c.toFixed(3);
      }));

      return {
        meta: {
          symbol, range, region, regionLabel: set.label, note: set.note,
          benchmark: set.benchmark, rf,
          from: aligned.dates[0], to: aligned.dates[aligned.dates.length - 1],
          observations: aligned.dates.length,
          dropped: set.factors.filter((f) => !usable.includes(f)).map((f) => f.key),
        },
        attribution: attr,
        factorCorrelation: { keys, matrix: fcorr },
      };
    });
    if (out.error) return res.status(422).json(out);
    res.json(withAssessment(out, (o) => A.assessFactors(o)));
  } catch (e) {
    failUpstream(res, e, symbol, "Factor attribution");
  }
});

/**
 * GET /api/quant/pairs?a=HDFCBANK.NS&b=ICICIBANK.NS&range=5y&window=60&entryZ=2&exitZ=0.5
 */
router.get("/quant/pairs", async (req, res) => {
  const a = cleanSym(req.query.a), b = cleanSym(req.query.b);
  if (!a || !b) return res.status(400).json({ error: "Both legs (a and b) are required." });
  if (a === b) return res.status(400).json({ error: "A pair needs two different symbols." });
  const range = cleanRange(req.query.range);
  const opts = {
    window: Number(req.query.window ?? 60),
    entryZ: Number(req.query.entryZ ?? 2),
    exitZ: Number(req.query.exitZ ?? 0.5),
    stopZ: Number(req.query.stopZ ?? 3.5),
    costBps: Number(req.query.costBps ?? 10),
  };
  try {
    const out = await cached(`qp:${a}:${b}:${range}:${JSON.stringify(opts)}`, ANALYSIS_TTL, async () => {
      const [ha, hb] = await Promise.all([history(a, range), history(b, range)]);
      if (!ha?.points?.length) return { error: `No history for ${a}.` };
      if (!hb?.points?.length) return { error: `No history for ${b}.` };
      const al = S.alignByDate({ [a]: ha.points, [b]: hb.points });
      if (al.dates.length < 120) return { error: `Only ${al.dates.length} overlapping trading days — need at least 120.` };
      const r = Q.pairsAnalysis({ dates: al.dates, a: al.closes[a], b: al.closes[b], symA: a, symB: b }, opts);
      if (r.error) return r;
      r.meta.range = range;
      r.meta.currencyA = ha.currency || "";
      r.meta.currencyB = hb.currency || "";
      r.meta.crossCurrency = !!(ha.currency && hb.currency && ha.currency !== hb.currency);
      return r;
    });
    if (out.error) return res.status(422).json(out);
    res.json(withAssessment(out, (o) => A.assessPairs(o)));
  } catch (e) {
    failUpstream(res, e, `${a} / ${b}`, "Pair analysis");
  }
});

/** GET /api/quant/profile/:symbol?range=5y — tail risk, drawdowns, seasonality. */
router.get("/quant/profile/:symbol", async (req, res) => {
  const symbol = cleanSym(req.params.symbol);
  const range = cleanRange(req.query.range);
  const rf = Math.max(0, Math.min(0.2, Number(req.query.rf ?? 0)));
  try {
    const out = await cached(`qrp:${symbol}:${range}:${rf}`, ANALYSIS_TTL, async () => {
      const h = await history(symbol, range);
      if (!h?.points?.length) return { error: `No history for ${symbol}.` };
      const r = Q.returnProfile(h.points, { rf });
      if (r.error) return r;
      r.meta.symbol = symbol;
      r.meta.currency = h.currency || "";
      r.meta.range = range;
      r.meta.stale = !!h.stale;
      return r;
    });
    if (out.error) return res.status(422).json(out);
    res.json(withAssessment(out, (o) => A.assessProfile(o, { symbol })));
  } catch (e) {
    failUpstream(res, e, symbol, "Return profile");
  }
});

/**
 * GET /api/quant/compare/:symbol?range=5y&costBps=15
 * Every strategy at its defaults on the same candles: a leaderboard, with a
 * three-period consistency check. Shares the backtester's history cache.
 */
router.get("/quant/compare/:symbol", async (req, res) => {
  const symbol = cleanSym(req.params.symbol);
  const range = cleanRange(req.query.range);
  const costBps = Math.max(0, Math.min(200, Number(req.query.costBps ?? 10) || 0));
  try {
    const out = await cached(`qcmp:${symbol}:${range}:${costBps}`, ANALYSIS_TTL, async () => {
      const h = await history(symbol, range);
      if (!h || !h.points || h.points.length < 250) return { error: `Not enough daily history for ${symbol}.` };
      const r = Q.compareStrategies(h.points, { costBps });
      if (r.error) return r;
      return { symbol, range, ...r };
    });
    if (out.error) return res.status(422).json(out);
    res.json(out);
  } catch (e) {
    failUpstream(res, e, symbol, "Strategy comparison");
  }
});

module.exports = router;
