const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();
const F = require("../providers/fundamentals");
const A = require("../lib/analytics");
const yahoo = require("../providers/yahoo");
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

/* ── Screener: full-universe fundamentals scan (cached 6h) ── */
async function screenRow(symbol) {
  const b = await cached(`mini:${symbol}`, 6 * 60 * 60 * 1000, () => F.miniSummary(symbol));
  const fd = b.financialData || {}, ks = b.defaultKeyStatistics || {}, sd = b.summaryDetail || {}, pr = b.price || {};
  const p = (v, m = 100) => (v === undefined || v === null ? null : v * m);
  return {
    symbol, name: pr.shortName || symbol, sector: b.assetProfile?.sector || "—",
    price: pr.regularMarketPrice ?? null, changePct: p(pr.regularMarketChangePercent),
    mcap: sd.marketCap ?? null,
    pe: sd.trailingPE ?? null, pb: ks.priceToBook ?? null, evEbitda: ks.enterpriseToEbitda ?? null,
    roe: p(fd.returnOnEquity), netMargin: p(fd.profitMargins), revGrowth: p(fd.revenueGrowth),
    earnGrowth: p(fd.earningsGrowth), de: fd.debtToEquity !== undefined && fd.debtToEquity !== null ? fd.debtToEquity / 100 : null,
    divYield: p(sd.dividendYield), beta: ks.beta ?? null,
    high52: sd.fiftyTwoWeekHigh ?? null, low52: sd.fiftyTwoWeekLow ?? null,
  };
}

let screenJob = null;
router.get("/screener/run", async (_req, res) => {
  try {
    if (!screenJob) screenJob = F.pool(F.UNIVERSE, 4, screenRow).finally(() => setTimeout(() => (screenJob = null), 6 * 60 * 60 * 1000));
    const rows = (await screenJob).filter((r) => r && !r.error && r.price !== null);
    res.json({ asOf: Date.now(), universe: "NIFTY-class large caps (editable in server/providers/fundamentals.js)", rows });
  } catch (e) { screenJob = null; res.status(502).json({ error: "Screener scan failed", detail: String(e.message || e).slice(0, 100) }); }
});

/* ── Breadth derived from the same universe ── */
router.get("/intel/breadth", async (_req, res) => {
  try {
    if (!screenJob) screenJob = F.pool(F.UNIVERSE, 4, screenRow).finally(() => setTimeout(() => (screenJob = null), 6 * 60 * 60 * 1000));
    const rows = (await screenJob).filter((r) => r && !r.error && r.changePct !== null);
    const adv = rows.filter((r) => r.changePct > 0).length, dec = rows.filter((r) => r.changePct < 0).length;
    const near52H = rows.filter((r) => r.price && r.high52 && r.price >= r.high52 * 0.95).length;
    const near52L = rows.filter((r) => r.price && r.low52 && r.price <= r.low52 * 1.05).length;
    res.json({ n: rows.length, advancers: adv, decliners: dec, unchanged: rows.length - adv - dec, adRatio: dec ? +(adv / dec).toFixed(2) : null, near52H, near52L, avgChange: +(rows.reduce((s, r) => s + r.changePct, 0) / rows.length).toFixed(2) });
  } catch { res.status(502).json({ error: "Breadth unavailable" }); }
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
