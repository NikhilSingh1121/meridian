/**
 * Market context for the Index Analyser, shared by every index and every viewer:
 *   · breadth  — advancers / decliners across the NIFTY universe (the Market Intelligence
 *                breadth, same 15 s cache key — no extra upstream calls)
 *   · sectors  — NSE sector indices' change today (streamed prices; NSE allIndices fallback)
 *   · global   — S&P 500, Nasdaq, Dow, Nikkei, Hang Seng, FTSE, S&P futures, USD/INR, Brent
 *   · FII / DII — NSE's provisional cash-market flows (latest session)
 * Refreshed at most every 15 s and only while someone has the Index Analyser open.
 * Every symbol here is subscribed to the terminal-wide stream, so prices come from ticks,
 * not polling (quotes the stream keeps current are served from cache).
 */
const C = require("../cache");
const Y = require("../providers/yahoo");
const NSE = require("../providers/nse");

const SECTORS = [
  ["^NSEBANK", "Banking", "NIFTY BANK"], ["^CNXIT", "IT", "NIFTY IT"], ["^CNXAUTO", "Auto", "NIFTY AUTO"], ["^CNXFMCG", "FMCG", "NIFTY FMCG"],
  ["^CNXPHARMA", "Pharma", "NIFTY PHARMA"], ["^CNXMETAL", "Metal", "NIFTY METAL"], ["^CNXREALTY", "Realty", "NIFTY REALTY"], ["^CNXENERGY", "Energy", "NIFTY ENERGY"],
  ["^CNXPSUBANK", "PSU Bank", "NIFTY PSU BANK"], ["NIFTY_FIN_SERVICE.NS", "Fin Services", "NIFTY FINANCIAL SERVICES"], ["^CNXMEDIA", "Media", "NIFTY MEDIA"],
];
const GLOBAL = [["^GSPC", "S&P 500"], ["^IXIC", "Nasdaq"], ["^DJI", "Dow Jones"], ["ES=F", "S&P 500 fut"], ["^N225", "Nikkei 225"], ["^HSI", "Hang Seng"], ["^FTSE", "FTSE 100"], ["USDINR=X", "USD/INR"], ["BZ=F", "Brent crude"]];
const TICKER = [["NIFTY", "^NSEI", "NIFTY 50"], ["BANKNIFTY", "^NSEBANK", "BANK NIFTY"], ["FINNIFTY", "NIFTY_FIN_SERVICE.NS", "FIN NIFTY"], ["MIDCPNIFTY", "NIFTY_MID_SELECT.NS", "MIDCAP SELECT"], ["SENSEX", "^BSESN", "SENSEX"], ["INDIAVIX", "^INDIAVIX", "INDIA VIX"]];
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const r2 = (v) => (isNum(v) ? Math.round(v * 100) / 100 : null);

let LIVE = null, snap = null, at = 0, inflight = null;
const quote = (s) => C.cachedDurable("q:" + s, 15_000, () => Y.getQuote(s)).catch(() => null);

async function build() {
  if (LIVE) LIVE.ensure([...SECTORS.map((x) => x[0]), ...GLOBAL.map((x) => x[0]), ...TICKER.map((x) => x[1])]);
  const [breadth, nseIdx, fii, secQ, glQ, tkQ, pos, pack] = await Promise.all([
    require("../routes/intel").breadth().catch(() => null),
    NSE.allIndices().catch(() => null),
    NSE.fiiDiiLatest().catch(() => null),
    Promise.all(SECTORS.map((x) => quote(x[0]))),
    Promise.all(GLOBAL.map((x) => quote(x[0]))),
    Promise.all(TICKER.map((x) => quote(x[1]))),
    require("./participants").latest(),
    C.cached("ix:fiipack", 10 * 60e3, () => NSE.fiiDiiPack()).catch(() => null),
  ]);
  const ticker = Object.fromEntries(TICKER.map(([k, , label], i) => { const q = tkQ[i]; return [k, q && q.price > 0 ? { label, price: r2(q.price), change: r2(q.change), changePct: r2(q.changePct), spark: Array.isArray(q.spark) ? q.spark.slice(-60) : [] } : { label }]; }));
  const sectors = SECTORS.map(([s, label, nseName], i) => {
    const q = secQ[i], n = nseIdx && nseIdx[nseName];
    const chg = q && isNum(q.changePct) ? q.changePct : n ? n.d1 : null;
    return isNum(chg) ? { symbol: s, label, changePct: r2(chg), price: r2(q && q.price), w1: n ? n.w1 : null } : null;
  }).filter(Boolean).sort((a, b) => b.changePct - a.changePct);
  const global = GLOBAL.map(([s, label], i) => { const q = glQ[i]; return q && isNum(q.changePct) ? { symbol: s, label, price: r2(q.price), changePct: r2(q.changePct) } : null; }).filter(Boolean);
  const eq = global.filter((g) => !/USDINR|BZ=F/.test(g.symbol));
  return {
    asOf: Date.now(),
    breadth: breadth ? { advancers: breadth.advancers, decliners: breadth.decliners, unchanged: breadth.unchanged, adRatio: breadth.adRatio, n: breadth.n, near52H: breadth.near52H, near52L: breadth.near52L, above50: breadth.above50, above200: breadth.above200, avgChange: breadth.avgChange, gainers: (breadth.movers && breadth.movers.gainers || []).slice(0, 5), losers: (breadth.movers && breadth.movers.losers || []).slice(0, 5) } : null,
    ticker, sectors, global,
    globalTone: eq.length ? r2(eq.reduce((a, g) => a + g.changePct, 0) / eq.length) : null,
    fiiDii: fii && fii.available ? { date: fii.date, fiiNet: fii.fiiNet, diiNet: fii.diiNet, unit: fii.unit, last10: pack && Array.isArray(pack.history) ? pack.history.slice(-10) : [] } : (pack && pack.history && pack.history.length ? { date: pack.history[pack.history.length - 1].date, fiiNet: pack.history[pack.history.length - 1].fii, diiNet: pack.history[pack.history.length - 1].dii, unit: "₹ Crore", last10: pack.history.slice(-10) } : null),
    positioning: pos,
  };
}
/** latest context (≤ 15 s old); never throws */
async function get() {
  if (snap && Date.now() - at < 15_000) return snap;
  if (!inflight) inflight = build().then((s) => { snap = s; at = Date.now(); return s; }).catch(() => snap).finally(() => { inflight = null; });
  return inflight;
}
function setLive(live) { LIVE = live; }

module.exports = { get, setLive, SECTORS, GLOBAL, TICKER };
