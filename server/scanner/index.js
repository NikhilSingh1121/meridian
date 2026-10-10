/**
 * Live Scanner bootstrap. Mounted by server/index.js:
 *   require("./scanner").mount(app)   → /api/scanner/* routes + the hub (+ terminal-wide live quotes)
 *
 * The scanner starts when the first viewer opens it and stops after SCANNER_IDLE_MIN
 * (default 15) minutes with nobody watching — a server restart (Render redeploys,
 * free-plan sleeps) therefore never triggers a history warm-up for 500 stocks unless
 * someone actually uses the scanner. SCANNER_AUTOSTART=1 starts it with the server.
 */
const { ScannerHub } = require("./hub");
const R = require("./routes");
const S = require("./store/session");
let hub = null, starting = null, idleSince = null;

function engineClass() { try { return require("./engine/scanner").ScannerEngine; } catch (e) { if (e.code !== "MODULE_NOT_FOUND") throw e; return require("./engine/quote").QuoteEngine; } }

/* start once, however many viewers arrive together */
function ensureStarted() {
  if (hub.started) return Promise.resolve(hub.status());
  if (!starting) {
    starting = hub.start()
      .then((st) => { console.log(`Live Scanner    → feed ${st.feed && st.feed.name} · ${st.universe && st.universe.n} symbols · ${st.universe && st.universe.source}`); return st; })
      .finally(() => { starting = null; });
  }
  return starting;
}

/* NSE trading holidays (falls back to Yahoo's view of whether today had a session) */
async function loadHolidays() {
  try {
    const nse = require("../providers/nse");
    const j = await nse.nseGet("/api/holiday-master?type=trading", 15000);
    const rows = j && (j.CM || j.FO || []);
    if (Array.isArray(rows) && rows.length) {
      S.setHolidays(rows.map((r) => ({ date: nse.nseDate(r.tradingDate), name: String(r.description || "Exchange holiday").trim() })).filter((h) => h.date));
      return;
    }
  } catch { /* NSE refused — Yahoo check below */ }
}
/* on a weekday after 09:45 IST with no NIFTY trade today, today had no session (holiday) */
async function yahooSessionCheck() {
  const now = Date.now(), p = S.istParts(now);
  if (p.dow < 1 || p.dow > 5 || p.min < S.OPEN_MIN + 30 || S.holidayOn(now)) return;
  try {
    const q = await require("../providers/yahoo").chartQuote("^NSEI");
    if (q && q.marketTime && S.istDate(q.marketTime) !== S.istDate(now)) S.setHolidays([{ date: S.istDate(now), name: "no trading session today" }]);
  } catch { /* unknown: leave the clock as it is */ }
}

function mount(app) {
  hub = new ScannerHub({ EngineClass: engineClass() });
  R.setHub(hub, ensureStarted);
  app.use("/api", R.router);

  // terminal-wide live prices (tape, company header, watchlist) + quote overlay
  const { LiveQuotes, router: liveRouter } = require("./livequotes");
  const live = new LiveQuotes();
  // every quote the terminal asks for is auto-subscribed to the stream, then overlaid
  require("../cache").setQuoteOverlay((sym, q) => { if (process.env.LIVE_QUOTES !== "0") live.ensure([sym]); return live.overlay(sym, q); });
  app.use("/api", liveRouter(live));
  // Index Analyser: shares the same tick stream (one computation per index, pushed to every viewer)
  require("../lib/indexlive").mount(app, live);
  // Yahoo load: a quote the stream keeps current needs its REST refresh only for the 5-minute sparkline;
  // an NSE / BSE quote cannot change while the Indian market is closed. Screen refresh rates are unchanged.
  const INDIAN = /\.(NS|BO)$|^\^(NSE|BSE|CNX|INDIAVIX|NIFTY)/i;
  require("../cache").setFreshPolicy((key, hit) => {
    if (!key.startsWith("q:") || !hit || !hit.value || hit.value.stale) return false;
    const sym = key.slice(2), age = Date.now() - (hit.born || 0);
    if (process.env.YAHOO_SAVER === "0") return false;
    if (process.env.LIVE_QUOTES !== "0" && live.isFresh(sym, 60e3) && age < 30 * 60e3) return true;   // price + sparkline come from the stream
    if (INDIAN.test(sym) && !S.isMarketOpen() && age < 30 * 60e3) return true;
    return false;
  });
  if (process.env.LIVE_QUOTES !== "0") live.ensure(["^NSEI", "^NSEBANK", "^INDIAVIX", "^BSESN"]);

  // holidays: NSE's list at boot and daily; Yahoo cross-check every 15 min in market hours
  loadHolidays();
  const day = setInterval(loadHolidays, 12 * 3600e3); if (day.unref) day.unref();
  const yc = setInterval(yahooSessionCheck, 15 * 60e3); if (yc.unref) yc.unref();

  // idle stop: nobody watching for SCANNER_IDLE_MIN minutes → stop the feed and engine
  const IDLE_MS = (+process.env.SCANNER_IDLE_MIN || 15) * 60e3;
  const idle = setInterval(() => {
    if (!hub.started) { idleSince = null; return; }
    if (hub.push.clients.size) { idleSince = null; return; }
    if (idleSince == null) { idleSince = Date.now(); return; }
    if (Date.now() - idleSince >= IDLE_MS && process.env.SCANNER_AUTOSTART !== "1") { idleSince = null; hub.stop().then(() => console.log("[scanner] stopped (no viewers)")).catch(() => {}); }
  }, 60e3);
  if (idle.unref) idle.unref();

  if (process.env.SCANNER_AUTOSTART === "1") ensureStarted().catch((e) => console.warn("[scanner] start failed:", e.message));
  process.once("exit", () => live.stop());
  const bye = () => { if (hub && hub.started) hub.stop().finally(() => process.exit(0)); else process.exit(0); };
  process.once("SIGINT", bye); process.once("SIGTERM", bye);
  return hub;
}
module.exports = { mount, getHub: () => hub, ensureStarted: () => ensureStarted() };
