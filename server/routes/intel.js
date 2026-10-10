const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();
const F = require("../providers/fundamentals");
const A = require("../lib/analytics");
const yahoo = require("../providers/yahoo");
const NSE = require("../providers/nse");
const { cached, cachedDurable } = require("../cache");
const AUTH = require("../lib/auth");

/* ── Sector heatmap: NSE sector indices, live ── */
const SECTORS = [
  { symbol: "^NSEBANK", label: "Banks" }, { symbol: "^CNXIT", label: "IT" },
  { symbol: "^CNXAUTO", label: "Auto" }, { symbol: "^CNXPHARMA", label: "Pharma" },
  { symbol: "^CNXFMCG", label: "FMCG" }, { symbol: "^CNXMETAL", label: "Metals" },
  { symbol: "^CNXENERGY", label: "Energy" }, { symbol: "^CNXREALTY", label: "Realty" },
  { symbol: "^CNXINFRA", label: "Infra" }, { symbol: "^CNXMEDIA", label: "Media" },
  { symbol: "^CNXPSUBANK", label: "PSU Banks" }, { symbol: "^CNXFIN", label: "Fin Services" },
];

router.get("/intel/sectors", async (_req, res) => {
  try {
    const rows = await Promise.all(SECTORS.map(async (s) => {
      try { const q = await cachedDurable(`q:${s.symbol}`, 15_000, () => yahoo.getQuote(s.symbol)); return { ...q, label: s.label }; }
      catch { return { symbol: s.symbol, label: s.label, error: true }; }
    }));
    res.json({ asOf: Date.now(), sectors: rows });
  } catch { res.status(502).json({ error: "Sector data unavailable" }); }
});

/* ── Sector performance: 1D / 1W / 1M / 1Y for the NSE sector indices.
   Source is NSE's own allIndices feed (Yahoo has no history for most ^CNX
   sector symbols); the intraday sparkline comes from the live Yahoo quote.
   If NSE is unreachable, the day change still comes from Yahoo and the
   longer horizons show as unavailable rather than being guessed. ── */
const NSE_NAME = {
  "^NSEBANK": "NIFTY BANK", "^CNXIT": "NIFTY IT", "^CNXAUTO": "NIFTY AUTO", "^CNXPHARMA": "NIFTY PHARMA",
  "^CNXFMCG": "NIFTY FMCG", "^CNXMETAL": "NIFTY METAL", "^CNXENERGY": "NIFTY ENERGY", "^CNXREALTY": "NIFTY REALTY",
  "^CNXINFRA": "NIFTY INFRASTRUCTURE", "^CNXMEDIA": "NIFTY MEDIA", "^CNXPSUBANK": "NIFTY PSU BANK", "^CNXFIN": "NIFTY FINANCIAL SERVICES 25/50", // Yahoo ^CNXFIN tracks the 25/50 variant
};
router.get("/intel/sector-perf", async (_req, res) => {
  try {
    // NSE is slow (~8s) — never block on it: use the cached horizons if we
    // have them, otherwise answer now and let the fetch finish in the background
    const nsePending = NSE.allIndices();
    const nse = await Promise.race([nsePending, new Promise((r) => setTimeout(() => r(null), 1200))]);
    const rows = await Promise.all(SECTORS.map(async (s) => {
      const q = await cachedDurable(`q:${s.symbol}`, 15_000, () => yahoo.getQuote(s.symbol)).catch(() => null);
      const n = nse && nse[NSE_NAME[s.symbol]];
      return {
        symbol: s.symbol, label: s.label,
        // price and day change stay on the live 15s quote (same as the heatmap)
        price: q ? q.price : n ? n.last : null,
        d1: q && q.changePct != null ? q.changePct : n ? n.d1 : null,
        w1: n ? n.w1 : null, m1: n ? n.m1 : null, y1: n ? n.y1 : null,
        spark: q && q.spark ? q.spark : [],
      };
    }));
    res.json({ asOf: Date.now(), source: nse ? "NSE" : "pending", rows });
  } catch { res.status(502).json({ error: "Sector performance unavailable" }); }
});

/* ── Correlation / volatility / momentum engine over any symbol set ── */
router.get("/intel/matrix", async (req, res) => {
  const symbols = String(req.query.symbols || "^NSEI,^NSEBANK,^CNXIT,GC=F,USDINR=X,BTC-USD")
    .split(",").map((s) => s.trim()).filter(Boolean).slice(0, 12);
  const range = ["3mo", "6mo", "1y"].includes(req.query.range) ? req.query.range : "6mo";
  try {
    const seriesMap = {};
    await Promise.all(symbols.map(async (s) => {
      try { seriesMap[s] = await cached(`cl:${s}:${range}`, 30 * 60_000, () => F.chartCloses(s, range)); } catch { }
    }));
    const valid = Object.fromEntries(Object.entries(seriesMap).filter(([, v]) => v && v.length > 20));
    const corr = A.correlationMatrix(valid);
    const stats = Object.fromEntries(Object.entries(valid).map(([k, v]) => [k, { vol: A.annVol(v), mdd: A.maxDrawdown(v), mom: A.momentum(v) }]));
    res.json({ range, ...corr, stats });
  } catch { res.status(502).json({ error: "Matrix unavailable" }); }
});

/* ── Market breadth: live, one batch quote over the NIFTY universe (15s) ── */
async function buildBreadth() {
  const rows = (await F.batchQuotes(F.UNIVERSE))
    .map((q) => ({
      symbol: q.symbol, name: q.shortName || q.symbol,
      price: q.regularMarketPrice ?? null, changePct: q.regularMarketChangePercent ?? null,
      high52: q.fiftyTwoWeekHigh ?? null, low52: q.fiftyTwoWeekLow ?? null,
      // today's volume vs its 3-month daily average — "how unusual is the tape"
      volX: q.regularMarketVolume && q.averageDailyVolume3Month ? +(q.regularMarketVolume / q.averageDailyVolume3Month).toFixed(2) : null,
      ma50: q.fiftyDayAverage ?? null, ma200: q.twoHundredDayAverage ?? null,
    }))
    .filter((r) => r.price !== null && r.changePct !== null);
  if (!rows.length) throw new Error("no breadth rows");
  const adv = rows.filter((r) => r.changePct > 0).length, dec = rows.filter((r) => r.changePct < 0).length;
  const near52H = rows.filter((r) => r.high52 && r.price >= r.high52 * 0.95).length;
  const near52L = rows.filter((r) => r.low52 && r.price <= r.low52 * 1.05).length;
  const pctAbove = (k) => { const v = rows.filter((r) => r[k]); return v.length ? Math.round((v.filter((r) => r.price > r[k]).length / v.length) * 100) : null; };
  const byChg = [...rows].sort((a, b) => b.changePct - a.changePct);
  const mover = ({ symbol, name, price, changePct, volX }) => ({ symbol, name, price, changePct, volX });
  return {
    asOf: Date.now(), n: rows.length, advancers: adv, decliners: dec, unchanged: rows.length - adv - dec,
    adRatio: dec ? +(adv / dec).toFixed(2) : null, near52H, near52L, above50: pctAbove("ma50"), above200: pctAbove("ma200"),
    avgChange: +(rows.reduce((s, r) => s + r.changePct, 0) / rows.length).toFixed(2),
    movers: {
      gainers: byChg.filter((r) => r.changePct > 0).slice(0, 10).map(mover),
      losers: byChg.filter((r) => r.changePct < 0).reverse().slice(0, 10).map(mover),
    },
  };
}
router.get("/intel/breadth", async (_req, res) => {
  try { res.json(await cachedDurable("breadth:nifty", 15_000, buildBreadth)); }
  catch { res.status(502).json({ error: "Breadth unavailable" }); }
});

/* ── Batch quotes (portfolio) ── */
router.get("/quotes", async (req, res) => {
  const symbols = String(req.query.symbols || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 30);
  if (!symbols.length) return res.json({ quotes: [] });
  const quotes = await Promise.all(symbols.map(async (s) => {
    try { return await cachedDurable(`q:${s}`, 15_000, () => yahoo.getQuote(s)); } catch { return { symbol: s, error: true }; }
  }));
  res.json({ quotes });
});

/* ── Library: per-user document store (JSON file; swap for Postgres later) ──
   Every doc is tagged with its owner (Google `sub`). All routes require a
   signed-in user and only ever see that user's documents. */
const DS = require("../lib/datastore");
function readStore() { const s = DS.getBlob("library", null); return s && Array.isArray(s.docs) ? s : { docs: [] }; }
function writeStore(s) { DS.setBlob("library", s); }

router.get("/library", AUTH.requireUser, (req, res) => {
  const s = readStore();
  const docs = s.docs
    .filter((d) => d.owner === req.user.sub)
    .map(({ payload, owner, ...meta }) => meta)
    .sort((a, b) => b.ts - a.ts);
  res.json({ docs });
});
router.get("/library/:id", AUTH.requireUser, (req, res) => {
  const doc = readStore().docs.find((d) => d.id === req.params.id && d.owner === req.user.sub);
  if (!doc) return res.status(404).json({ error: "Not found" });
  const { owner, ...rest } = doc;
  res.json(rest);
});
router.post("/library", express.json({ limit: "3mb" }), AUTH.requireUser, (req, res) => {
  const s = readStore();
  const doc = {
    id: Math.random().toString(36).slice(2, 10),
    owner: req.user.sub,
    ts: Date.now(),
    title: req.body.title || "Untitled",
    kind: req.body.kind || "report",
    symbol: req.body.symbol || "",
    payload: req.body.payload || {},
  };
  s.docs.push(doc); writeStore(s);
  res.json({ id: doc.id });
});
router.delete("/library/:id", AUTH.requireUser, (req, res) => {
  const s = readStore();
  const before = s.docs.length;
  s.docs = s.docs.filter((d) => !(d.id === req.params.id && d.owner === req.user.sub));
  if (s.docs.length === before) return res.status(404).json({ error: "Not found" });
  writeStore(s); res.json({ ok: true });
});

module.exports = router;
/* shared with the Index Analyser's regime engine (same 15 s cache key, so no extra Yahoo calls) */
module.exports.breadth = () => cachedDurable("breadth:nifty", 15_000, buildBreadth);
