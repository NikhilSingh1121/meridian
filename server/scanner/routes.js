/** /api/scanner/* — Live Scanner backend.
 *  Public site rules: everything here is read-only and shared — no viewer can restart the
 *  engine, switch the universe or edit scans for everyone. Per-viewer choices (which scans
 *  to show, filters, sort) live in the browser. The first viewer starts the scanner. */
const express = require("express");
const router = express.Router();
let HUB = null, START = null;
const hub = () => HUB;
function setHub(h, ensureStarted) { HUB = h; START = ensureStarted || null; }

const need = (res) => { if (!HUB || !HUB.started) { res.status(503).json({ error: "scanner not started" }); return false; } return true; };
const inUniverse = (s) => !!(HUB && HUB.universe && HUB.universe.list.some((u) => u.s === s)) || /^(NIFTY|BANKNIFTY|INDIAVIX|FINNIFTY|MIDCPNIFTY)$/.test(s);
const sym = (x) => String(x || "").toUpperCase().replace(/[^A-Z0-9&-]/g, "").slice(0, 20);

router.get("/scanner/status", (_req, res) => res.json(HUB ? HUB.status() : { started: false }));

/* SSE: ?every=<sec>&symbols=A,B (optional filter). Starts the scanner for the first viewer. */
router.get("/scanner/stream", async (req, res) => {
  if (!HUB) return res.status(503).json({ error: "scanner unavailable" });
  if (!HUB.started) {
    try { await START(); } catch (e) { return res.status(503).json({ error: "scanner could not start" }); }
  }
  const filter = req.query.symbols ? new Set(String(req.query.symbols).split(",").map((x) => sym(x)).filter(Boolean)) : null;
  HUB.attachClient(req, res, { every: req.query.every, filter, delta: req.query.delta === "1" });
});
router.post("/scanner/stream/:id/every", express.json(), (req, res) => { if (HUB) HUB.push.setEvery(req.params.id, req.body && req.body.every); res.json({ ok: true }); });

router.get("/scanner/rotation", async (req, res) => {
  if (!need(res)) return;
  const tf = req.query.tf === "daily" ? "daily" : "weekly";
  const w = HUB.engine.warm;   // baskets need every stock's daily history: wait for the warm-up instead of queueing behind it
  if (w && !w.finished) return res.status(503).json({ error: `Sector baskets need a year of history for every stock; the scanner has loaded ${w.done} of ${w.total}. Official NSE indices are shown meanwhile.`, warming: true });
  try { res.json(await require("../cache").cached(`rrg:basket:${tf}:${HUB.feed.name}`, 30e3, () => require("../lib/rotation").basketRotation(HUB, tf))); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

/* history only for symbols in the scanner universe (never a free proxy to Yahoo) */
router.get("/scanner/history/:symbol", async (req, res) => {
  if (!need(res)) return;
  const s = sym(req.params.symbol);
  if (!inUniverse(s)) return res.status(404).json({ error: "symbol not in the scanner universe" });
  const interval = ["1m", "5m", "15m", "1d"].includes(req.query.interval) ? req.query.interval : "1d";
  const range = ["1d", "5d", "1mo", "3mo", "6mo", "1y", "2y"].includes(req.query.range) ? req.query.range : "6mo";
  try { res.json({ symbol: s, bars: await HUB.feed.getHistory(s, interval, range) }); }
  catch (e) { res.status(502).json({ error: "history unavailable" }); }
});
router.get("/scanner/bars/:symbol", (req, res) => {
  if (!need(res)) return;
  const b = HUB.store.get(sym(req.params.symbol));
  res.json({ symbol: sym(req.params.symbol), bars: b ? b.bars : [], day: b ? { ...b.day, high: Number.isFinite(b.day.high) ? b.day.high : null, low: Number.isFinite(b.day.low) ? b.day.low : null } : null });
});

/* ── scans: presets, read-only on the server ── */
router.get("/scanner/fields", (_req, res) => { const C = require("./engine/conditions"); res.json({ fields: C.FIELDS, ops: C.OPS }); });
router.get("/scanner/scans", (_req, res) => {
  if (!need(res)) return;
  const counts = HUB.engine.market ? HUB.engine.market().tagCounts : {};
  res.json({ scans: HUB.engine.scans.all().filter((s) => s.preset !== false && !/^oi_/.test(s.id))   /* OI scans need a broker feed with open interest */.map((s) => ({ ...s, matches: counts[s.tag || s.id] || 0 })) });
});
/* a custom condition evaluated now, nothing saved (the scan builder's live count) */
router.post("/scanner/scans/preview", express.json({ limit: "16kb" }), (req, res) => {
  if (!need(res)) return;
  try { const m = HUB.engine.preview(req.body && req.body.logic); res.json({ count: m.length, symbols: m.slice(0, 50) }); }
  catch (e) { res.status(400).json({ error: "invalid scan condition" }); }
});
router.get("/scanner/scans/:id/matches", (req, res) => { if (!need(res)) return; const m = HUB.engine.matches(req.params.id); if (!m) return res.status(404).json({ error: "no such scan" }); res.json({ matches: m }); });
router.get("/scanner/events", (req, res) => { if (!need(res)) return; const since = +req.query.since || 0; res.json({ events: HUB.engine.events.filter((e) => e.id > since).slice(-500) }); });
router.get("/scanner/detail/:symbol", (req, res) => { if (!need(res)) return; const d = HUB.engine.detail ? HUB.engine.detail(sym(req.params.symbol)) : null; if (!d) return res.status(404).json({ error: "symbol not in universe" }); res.json(d); });

module.exports = { router, setHub, hub };
