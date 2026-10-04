/**
 * Sector rotation (Relative Rotation Graph style) for NSE sector indices against NIFTY 50.
 *
 *   RS        = 100 × sector / NIFTY
 *   RS-Ratio  = 100 + z-score of RS over the look-back window         (relative trend)
 *   RS-Mom.   = 100 + z-score of the RS-Ratio's one-period change      (momentum of that trend)
 * This is an open approximation of the JdK RS-Ratio / RS-Momentum idea (the original formulas are
 * proprietary). Quadrants: Leading (ratio > 100, momentum > 100), Weakening (> 100, < 100),
 * Lagging (< 100, < 100), Improving (< 100, > 100); sectors usually rotate clockwise.
 *
 * Load on Yahoo: index history is cached on disk (weekly 6 h, daily 1 h in market hours, else until
 * the next session) and the latest point uses the terminal's quotes, which the live stream keeps
 * current without polling — so opening the map costs at most one history call per sector per window.
 */
const { cachedPersistent, cachedDurable } = require("../cache");
const Y = require("../providers/yahoo");

const SECTORS = [
  ["^NSEBANK", "Bank"], ["^CNXIT", "IT"], ["^CNXAUTO", "Auto"], ["^CNXFMCG", "FMCG"], ["^CNXPHARMA", "Pharma"],
  ["^CNXMETAL", "Metal"], ["^CNXREALTY", "Realty"], ["^CNXENERGY", "Energy"], ["^CNXINFRA", "Infra"], ["^CNXPSUBANK", "PSU Bank"],
  ["^CNXMEDIA", "Media"], ["^CNXPSE", "PSE"], ["NIFTY_FIN_SERVICE.NS", "Fin Services"], ["^CNXCMDT", "Commodities"], ["^CNXCONSUM", "Consumption"], ["^CNXMNC", "MNC"],
];
const BENCH = "^NSEI";

function zs(arr, n) {
  return arr.map((v, i) => {
    if (i < n - 1 || v == null) return null;
    if (arr.slice(i - n + 1, i + 1).some((x) => x == null)) return null;
    const w = arr.slice(i - n + 1, i + 1).filter((x) => x != null); if (w.length < n * 0.8) return null;
    const m = w.reduce((a, b) => a + b, 0) / w.length, sd = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / w.length);
    return sd > 0 ? (v - m) / sd : 0;
  });
}
/** pure computation: aligned closes → RRG points */
function compute(bench, series, { n = 10, tail = 8 } = {}) {
  const bmap = new Map(bench.map((b) => [b.t, b.c]));
  const out = [];
  for (const s of series) {
    const pts = s.bars.filter((b) => bmap.has(b.t) && b.c > 0);
    if (pts.length < n * 2 + 2) { out.push({ symbol: s.symbol, name: s.name, error: "not enough history" }); continue; }
    // relative strength and the ratio's change are smoothed (EMA 3) before normalising, as RRG
    // implementations do, so trails show the rotation rather than week-to-week noise
    const ema = (arr, k = 3) => { const a = 2 / (k + 1); let e = null; return arr.map((v) => (v == null ? e : (e = e == null ? v : v * a + e * (1 - a)))); };
    const rs = ema(pts.map((b) => (100 * b.c) / bmap.get(b.t)));
    const zr = zs(rs, n), ratio = zr.map((z) => (z == null ? null : 100 + z));
    const d = ema(ratio.map((v, i) => (i && v != null && ratio[i - 1] != null ? v - ratio[i - 1] : null)));
    const zm = zs(d, n), mom = zm.map((z) => (z == null ? null : 100 + z));
    const trail = [];
    for (let i = pts.length - tail; i < pts.length; i++) if (i >= 0 && ratio[i] != null && mom[i] != null) trail.push({ t: pts[i].t, x: +ratio[i].toFixed(2), y: +mom[i].toFixed(2) });
    if (!trail.length) { out.push({ symbol: s.symbol, name: s.name, error: "not enough history" }); continue; }
    const q = (p) => (p.x >= 100 ? (p.y >= 100 ? "Leading" : "Weakening") : p.y >= 100 ? "Improving" : "Lagging");
    const last = trail[trail.length - 1], prev = trail[trail.length - 2];
    const heading = prev ? (Math.atan2(last.y - prev.y, last.x - prev.x) * 180) / Math.PI : null;
    const ret = (k) => (pts.length > k ? +((pts[pts.length - 1].c / pts[pts.length - 1 - k].c - 1) * 100).toFixed(2) : null);
    const bret = (k) => { const a = bench.filter((b) => b.t <= pts[pts.length - 1].t); return a.length > k ? +((a[a.length - 1].c / a[a.length - 1 - k].c - 1) * 100).toFixed(2) : null; };
    out.push({ symbol: s.symbol, name: s.name, trail, quadrant: q(last), prevQuadrant: prev ? q(prev) : null, heading: heading == null ? null : Math.round(heading),
      strength: +Math.hypot(last.x - 100, last.y - 100).toFixed(2), close: pts[pts.length - 1].c, ret1: ret(1), ret4: ret(4), ret12: ret(12), rel4: ret(4) != null && bret(4) != null ? +(ret(4) - bret(4)).toFixed(2) : null });
  }
  return out;
}

async function history(sym, tf) {
  const { isMarketOpen } = require("../scanner/store/session");
  const ttl = tf === "weekly" ? 6 * 3600e3 : isMarketOpen() ? 3600e3 : 12 * 3600e3;
  return cachedPersistent(`rrg:${tf}:${sym}:${new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)}`, ttl, async () => {
    const h = await Y.getHistory(sym, tf === "weekly" ? "2y" : "1y", tf === "weekly" ? "1wk" : "1d");
    return (h.points || []).filter((p) => p.c > 0).map((p) => ({ t: p.t, c: p.c }));
  });
}
/** latest close from the terminal's quote (kept live by the stream) */
async function withLive(sym, bars, tf) {
  try {
    const q = await cachedDurable(`q:${sym}`, 15000, () => Y.getQuote(sym));
    if (!q || !(q.price > 0) || !bars.length) return bars;
    const last = bars[bars.length - 1], day = (t) => Math.floor((t + 5.5 * 3600e3) / 86400e3);
    const qt = q.marketTime || Date.now();
    if (tf === "daily" && day(qt) > day(last.t)) return [...bars, { t: qt, c: q.price }];
    return [...bars.slice(0, -1), { ...last, c: q.price }];
  } catch { return bars; }
}
async function rotation(tf = "weekly") {
  tf = tf === "daily" ? "daily" : "weekly";
  const align = (bars) => bars.map((b) => ({ t: tf === "weekly" ? Math.floor((b.t + 5.5 * 3600e3 - 4 * 86400e3) / (7 * 86400e3)) : Math.floor((b.t + 5.5 * 3600e3) / 86400e3), c: b.c }));
  const bench = align(await withLive(BENCH, await history(BENCH, tf), tf));
  const series = [];
  for (const [symbol, name] of SECTORS) {
    try { series.push({ symbol, name, bars: align(await withLive(symbol, await history(symbol, tf), tf)) }); }
    catch (e) { series.push({ symbol, name, bars: [], error: e.message }); }
  }
  const pts = compute(bench, series, tf === "weekly" ? { n: 10, tail: 8 } : { n: 20, tail: 10 });
  const counts = { Leading: 0, Weakening: 0, Lagging: 0, Improving: 0 };
  for (const p of pts) if (p.quadrant) counts[p.quadrant]++;
  const missing = pts.filter((p) => p.error).map((p) => p.name);
  return { tf, mode: "index", benchmark: "NIFTY 50", sectors: pts.filter((p) => !p.error), missing, counts, asOf: Date.now(),
    method: "RS = sector ÷ NIFTY; RS-Ratio = 100 + z-score of RS over " + (tf === "weekly" ? "10 weeks" : "20 sessions") + "; RS-Momentum = 100 + z-score of the ratio's change. An open approximation of JdK RRG." };
}
/**
 * Sector baskets from the Live Scanner's own data: an equal-weighted index of each sector's F&O
 * stocks (daily returns averaged), benchmarked to NIFTY. Uses the daily history the scanner already
 * cached at warm-up and today's live prices — no extra Yahoo calls, and every sector is covered
 * (Yahoo has no history for most NSE sector indices).
 */
async function basketRotation(hub, tf = "weekly") {
  tf = tf === "daily" ? "daily" : "weekly";
  const E = hub.engine, feed = hub.feed, dayKey = (t) => Math.floor((t + 5.5 * 3600e3) / 86400e3);
  const bySec = new Map();
  for (const [s, m] of E.meta) { const sec = (m && m.sector) || "Other"; if (!bySec.has(sec)) bySec.set(sec, []); bySec.get(sec).push(s); }
  const live = (s) => { const b = hub.store.get(s); return b && b.last && b.last.ltp > 0 ? { t: b.last.ts, c: b.last.ltp } : null; };
  const hist = async (s) => {
    const h = (await feed.getHistory(s, "1d", "1y").catch(() => [])).filter((x) => x.c > 0).map((x) => ({ d: dayKey(x.t), c: x.c }));
    const L = live(s);
    if (L) { const d = dayKey(L.t); if (h.length && h[h.length - 1].d === d) h[h.length - 1].c = L.c; else if (!h.length || d > h[h.length - 1].d) h.push({ d, c: L.c }); }
    return h;
  };
  const benchH = await hist("NIFTY");
  if (benchH.length < 40) throw new Error("NIFTY history not available yet (the scanner is still warming up)");
  const days = benchH.map((x) => x.d);
  const series = [];
  for (const [sec, syms] of bySec) {
    if (syms.length < 3 || sec === "Other") continue;
    const H = await Promise.all(syms.map(async (s) => new Map((await hist(s)).map((x) => [x.d, x.c]))));
    let idx = 100; const bars = [];
    for (let i = 0; i < days.length; i++) {
      if (i === 0) { bars.push({ t: days[i], c: idx }); continue; }
      const rs = []; for (const m of H) { const a = m.get(days[i - 1]), b = m.get(days[i]); if (a > 0 && b > 0) rs.push(b / a - 1); }
      if (rs.length) idx *= 1 + rs.reduce((x, y) => x + y, 0) / rs.length;
      bars.push({ t: days[i], c: idx });
    }
    series.push({ symbol: sec, name: sec, bars, members: syms.length });
  }
  let bench = benchH.map((x) => ({ t: x.d, c: x.c }));
  const toWeek = (bars) => { const out = []; for (const b of bars) { const w = Math.floor((b.t - 4) / 7); if (out.length && out[out.length - 1].t === w) out[out.length - 1].c = b.c; else out.push({ t: w, c: b.c }); } return out; };
  if (tf === "weekly") { bench = toWeek(bench); for (const s of series) s.bars = toWeek(s.bars); }
  const pts = compute(bench, series, tf === "weekly" ? { n: 10, tail: 8 } : { n: 20, tail: 10 });
  for (const p of pts) { const s = series.find((x) => x.symbol === p.symbol); p.members = s ? s.members : null; p.symbol = null; }
  const counts = { Leading: 0, Weakening: 0, Lagging: 0, Improving: 0 };
  for (const p of pts) if (p.quadrant) counts[p.quadrant]++;
  return { tf, mode: "basket", benchmark: "NIFTY 50", sectors: pts, counts, asOf: Date.now(), synthetic: !!(feed.info && feed.info().synthetic),
    method: `Equal-weighted baskets of the scanner's stocks in each sector (daily returns averaged; members shown), vs NIFTY. RS-Ratio = 100 + z-score of RS over ${tf === "weekly" ? "10 weeks" : "20 sessions"}; RS-Momentum = 100 + z-score of the ratio's change. An open approximation of JdK RRG.` };
}
module.exports = { rotation, basketRotation, compute, SECTORS };
