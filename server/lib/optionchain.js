/**
 * NSE index derivatives → the Options Flow & OI Intelligence panel.
 *
 * Sources (NSE public APIs, shared by every viewer, at most one request per index per
 * minute while someone is watching; the last good snapshot is kept when NSE refuses):
 *   · option-chain-contract-info → expiry list
 *   · option-chain-v3            → strike-wise OI, change in OI, volume, IV, LTP
 *   · liveEquity-derivatives     → index futures (price, volume, open interest)
 *
 * Derived here: PCR (OI / change in OI / volume), max pain, call & put walls and writing
 * zones, ATM IV and its change since the first reading of the day, ATM straddle and the
 * move it implies, Black-Scholes Greeks (r = RISK_FREE), the price-and-OI reading for every
 * strike (long build-up · short build-up · short covering · long unwinding), the largest
 * OI changes between consecutive snapshots ("OI flow"), and the futures basis / OI build-up.
 * OI is not proof of direction — the UI says so and shows it beside price and breadth.
 */
const nse = require("../providers/nse");

const SUPPORTED = { NIFTY: { fut: "nse50_fut" }, BANKNIFTY: { fut: "nifty_bank_fut" }, FINNIFTY: { fut: "finnifty_fut" }, MIDCPNIFTY: { fut: null } };
const RISK_FREE = 0.065;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const r2 = (v) => (isNum(v) ? Math.round(v * 100) / 100 : null);
const r4 = (v) => (isNum(v) ? Math.round(v * 10000) / 10000 : null);
const parseExpiry = (s) => { const t = Date.parse(String(s).replace(/-/g, " ") + " 15:30 GMT+0530"); return Number.isFinite(t) ? t : null; };
const IST_DAY = (t) => new Date(t + 5.5 * 3600e3).toISOString().slice(0, 10);

/* ── Black-Scholes ── */
function erf(x) { const s = Math.sign(x), a = Math.abs(x), t = 1 / (1 + 0.3275911 * a); return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a)); }
const N = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
const n = (x) => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
/** Greeks per option; theta per calendar day, vega per 1 vol point */
function greeks(S, K, T, ivPct, type) {
  const s = ivPct / 100;
  if (!(S > 0 && K > 0 && T > 0 && s > 0)) return null;
  const d1 = (Math.log(S / K) + (RISK_FREE + s * s / 2) * T) / (s * Math.sqrt(T)), d2 = d1 - s * Math.sqrt(T);
  const delta = type === "CE" ? N(d1) : N(d1) - 1;
  const gamma = n(d1) / (S * s * Math.sqrt(T));
  const vega = (S * n(d1) * Math.sqrt(T)) / 100;
  const theta = type === "CE"
    ? (-(S * n(d1) * s) / (2 * Math.sqrt(T)) - RISK_FREE * K * Math.exp(-RISK_FREE * T) * N(d2)) / 365
    : (-(S * n(d1) * s) / (2 * Math.sqrt(T)) + RISK_FREE * K * Math.exp(-RISK_FREE * T) * N(-d2)) / 365;
  return { delta: r4(delta), gamma: r4(gamma * 1000) / 1000, theta: r2(theta), vega: r2(vega) };
}
/** price & OI reading for one option or future */
function buildup(priceChg, oiChg) {
  if (!isNum(priceChg) || !isNum(oiChg) || (priceChg === 0 && oiChg === 0)) return null;
  if (priceChg >= 0 && oiChg > 0) return "Long build-up";
  if (priceChg < 0 && oiChg > 0) return "Short build-up";
  if (priceChg >= 0 && oiChg < 0) return "Short covering";
  if (priceChg < 0 && oiChg < 0) return "Long unwinding";
  return null;
}

/** pure: NSE v3 payload → full analytics (exported for tests) */
function analyse(j, symbol, { now = Date.now(), baseline = null, prevProfile = null } = {}) {
  const rec = j && j.records, rows = (rec && rec.data) || (j && j.filtered && j.filtered.data) || [];
  if (!rows.length) return null;
  const spot = Number(rec && rec.underlyingValue) || Number(((rows.find((r) => r.CE) || {}).CE || {}).underlyingValue) || Number(((rows.find((r) => r.PE) || {}).PE || {}).underlyingValue) || null;
  const expiry = (rows.find((r) => r.expiryDates) || {}).expiryDates || ((rows[0].CE || rows[0].PE || {}).expiryDate) || null;
  const expT = parseExpiry(expiry), T = expT ? Math.max(1 / (365 * 24), (expT - now) / (365 * 86400e3)) : null;
  const side = (o, type, k) => {
    o = o || {};
    const iv = +o.impliedVolatility || null, ltp = +o.lastPrice || null;
    return { oi: +o.openInterest || 0, chg: +o.changeinOpenInterest || 0, vol: +o.totalTradedVolume || 0, iv, ltp, chgLtp: isNum(+o.change) ? +o.change : null,
      ...(spot && T && iv ? greeks(spot, k, T, iv, type) : {}), buildup: buildup(+o.change, +o.changeinOpenInterest) };
  };
  const strikes = rows.map((r) => { const k = Number(r.strikePrice); return { k, ce: side(r.CE, "CE", k), pe: side(r.PE, "PE", k) }; })
    .filter((s) => isNum(s.k)).sort((a, b) => a.k - b.k);
  if (!strikes.length || !spot) return null;
  const sum = (f) => strikes.reduce((a, s) => a + f(s), 0);
  const ceOi = sum((s) => s.ce.oi), peOi = sum((s) => s.pe.oi), ceChg = sum((s) => s.ce.chg), peChg = sum((s) => s.pe.chg), ceVol = sum((s) => s.ce.vol), peVol = sum((s) => s.pe.vol);
  let maxPain = null, best = Infinity;
  for (const x of strikes) { let pay = 0; for (const s of strikes) pay += s.ce.oi * Math.max(0, x.k - s.k) + s.pe.oi * Math.max(0, s.k - x.k); if (pay < best) { best = pay; maxPain = x.k; } }
  const above = strikes.filter((s) => s.k >= spot), below = strikes.filter((s) => s.k <= spot);
  const top = (arr, f, k = 3) => [...arr].sort((a, b) => f(b) - f(a)).slice(0, k).filter((s) => f(s) > 0).map((s) => ({ strike: s.k, oi: f(s) }));
  const atm = strikes.reduce((a, s) => (Math.abs(s.k - spot) < Math.abs(a.k - spot) ? s : a), strikes[0]);
  const atmIvs = [atm.ce.iv, atm.pe.iv].filter((v) => v > 0), atmIv = atmIvs.length ? atmIvs.reduce((a, b) => a + b, 0) / atmIvs.length : null;
  const straddle = atm.ce.ltp > 0 && atm.pe.ltp > 0 ? atm.ce.ltp + atm.pe.ltp : null;
  // writing zones: the band of strikes holding the most fresh OI on each side
  const cw = top(above, (s) => s.ce.chg, 2), pw = top(below, (s) => s.pe.chg, 2);
  const zone = (arr) => (arr.length ? [Math.min(...arr.map((x) => x.strike)), Math.max(...arr.map((x) => x.strike))] : null);
  // OI flow: largest changes since the previous snapshot
  const prev = new Map((prevProfile || []).map((p) => [p.k, p]));
  const flow = [];
  for (const s of strikes) {
    const p = prev.get(s.k); if (!p) continue;
    for (const [t, cur, was] of [["CE", s.ce, p.ce], ["PE", s.pe, p.pe]]) {
      const d = cur.oi - (was || 0); if (d) flow.push({ strike: s.k, type: t, dOi: d, ltp: cur.ltp, buildup: buildup(cur.chgLtp, d) });
    }
  }
  flow.sort((a, b) => Math.abs(b.dOi) - Math.abs(a.dOi));
  const near = strikes.filter((s) => Math.abs(s.k / spot - 1) <= 0.06 && (s.ce.oi || s.pe.oi));
  const ceBu = (b) => strikes.filter((s) => s.ce.buildup === b).length, peBu = (b) => strikes.filter((s) => s.pe.buildup === b).length;
  const pcr = ceOi ? peOi / ceOi : null;
  const sentiment = pcr == null ? null : pcr >= 1.3 ? "Bullish (heavy put writing)" : pcr >= 1.0 ? "Neutral to bullish" : pcr >= 0.7 ? "Neutral to bearish" : "Bearish (heavy call writing)";
  return {
    symbol, spot: r2(spot), expiry, expiryTs: expT, daysToExpiry: T ? r2(T * 365) : null, timestamp: (rec && rec.timestamp) || null,
    pcr: r2(pcr), pcrChange: ceChg ? r2(peChg / ceChg) : null, pcrVolume: ceVol ? r2(peVol / ceVol) : null, sentiment,
    totals: { ceOi, peOi, ceChg, peChg, ceVol, peVol },
    maxPain, callWall: top(above, (s) => s.ce.oi, 1)[0] || null, putWall: top(below, (s) => s.pe.oi, 1)[0] || null,
    callWalls: top(above, (s) => s.ce.oi), putWalls: top(below, (s) => s.pe.oi), callWritingZone: zone(cw), putWritingZone: zone(pw),
    atm: atm.k, atmIv: r2(atmIv), atmIvChange: baseline && isNum(baseline.atmIv) && isNum(atmIv) ? r2(atmIv - baseline.atmIv) : null,
    straddle: r2(straddle), impliedMovePct: straddle ? r2((straddle / spot) * 100) : null,
    buildupCounts: { ce: { lb: ceBu("Long build-up"), sb: ceBu("Short build-up"), sc: ceBu("Short covering"), lu: ceBu("Long unwinding") }, pe: { lb: peBu("Long build-up"), sb: peBu("Short build-up"), sc: peBu("Short covering"), lu: peBu("Long unwinding") } },
    profile: near.map((s) => ({ k: s.k, ce: s.ce.oi, pe: s.pe.oi, ceChg: s.ce.chg, peChg: s.pe.chg, ceVol: s.ce.vol, peVol: s.pe.vol })),
    chain: strikes.filter((s) => Math.abs(s.k - atm.k) <= Math.max(1, (above[1] ? above[1].k - above[0].k : 50)) * 15),
    flow: flow.slice(0, 12),
    chgLeaders: strikes.flatMap((s) => [{ strike: s.k, side: "CE", chg: s.ce.chg }, { strike: s.k, side: "PE", chg: s.pe.chg }]).sort((a, b) => Math.abs(b.chg) - Math.abs(a.chg)).slice(0, 6),
  };
}
/** pure: futures feed rows → nearest contract + basis + OI build-up vs the day's first reading */
function futuresFrom(j, baselineOi = null) {
  const rows = ((j && j.data) || []).filter((r) => /FUTIDX/.test(r.instrumentType || "")).map((r) => ({ ...r, t: parseExpiry(r.expiryDate) })).filter((r) => r.t).sort((a, b) => a.t - b.t);
  const f = rows[0]; if (!f) return null;
  const oi = +f.openInterest || 0, oiChg = isNum(baselineOi) ? oi - baselineOi : null;
  return { contract: f.contract, expiry: f.expiryDate, price: r2(+f.lastPrice), change: r2(+f.change), changePct: r2(+f.pChange), spot: r2(+f.underlyingValue),
    basis: r2(+f.lastPrice - +f.underlyingValue), basisPct: r4(((+f.lastPrice / +f.underlyingValue) - 1) * 100), volume: +f.volume || 0, oi, oiChgSinceFirst: oiChg,
    buildup: buildup(+f.change, oiChg), next: rows[1] ? { contract: rows[1].contract, price: r2(+rows[1].lastPrice), oi: +rows[1].openInterest || 0 } : null };
}

const state = new Map();   // `${symbol}|${expiry}` → snapshot state;  symbol → expiries + baselines
const meta = new Map();
async function expiries(sym) {
  const m = meta.get(sym) || {}; meta.set(sym, m);
  if (m.list && Date.now() - m.at < 6 * 3600e3) return m.list;
  const ci = await nse.nseGet(`/api/option-chain-contract-info?symbol=${sym}`, 15000);
  const list = ((ci && ci.expiryDates) || []).map((x) => ({ s: x, t: parseExpiry(x) })).filter((x) => x.t && x.t >= Date.now() - 6 * 3600e3).sort((a, b) => a.t - b.t);
  if (list.length) { m.list = list; m.at = Date.now(); }
  return m.list || [];
}
/**
 * latest analytics for an index and expiry (nearest when omitted), cached `maxAgeMs`.
 * @returns { data, at, error, expiries } — data may be the last good snapshot
 */
async function get(symbol, maxAgeMs = 60e3, expiry = null) {
  if (!SUPPORTED[symbol]) return { data: null, error: "no listed options for this index on NSE", expiries: [] };
  const list = await expiries(symbol).catch(() => []);
  const exp = expiry && list.some((x) => x.s === expiry) ? expiry : list[0] && list[0].s;
  const key = `${symbol}|${exp || "?"}`;
  const s = state.get(key) || {}; state.set(key, s);
  const m = meta.get(symbol) || {}; meta.set(symbol, m);
  if (s.data && Date.now() - s.at < maxAgeMs) return { ...s, expiries: list.map((x) => x.s) };
  if (!s.inflight) s.inflight = (async () => {
    try {
      const j = exp ? await nse.nseGet(`/api/option-chain-v3?type=Indices&symbol=${symbol}&expiry=${encodeURIComponent(exp)}`, 15000) : null;
      const day = IST_DAY(Date.now());
      if (!m.base || m.base.day !== day) m.base = { day };
      const a = j && analyse(j, symbol, { baseline: exp === (list[0] && list[0].s) ? m.base : null, prevProfile: s.data && s.data.chain && s.data.chain.map((x) => ({ k: x.k, ce: x.ce.oi, pe: x.pe.oi })) });
      if (a) {
        if (exp === (list[0] && list[0].s) && m.base.atmIv == null && a.atmIv) m.base.atmIv = a.atmIv;
        // OI flow log: the last 30 minutes of snapshot-to-snapshot changes
        s.flowLog = [...(a.flow || []).slice(0, 6).map((f) => ({ ...f, ts: Date.now() })), ...(s.flowLog || [])].filter((f) => Date.now() - f.ts < 30 * 60e3).slice(0, 40);
        a.flowLog = s.flowLog;
        s.data = a; s.at = Date.now(); s.error = null;
      } else s.error = "NSE did not return the option chain (it limits automated requests) — showing the last snapshot";
      // futures (nearest contract) with OI change since the first reading of the day
      const futKey = SUPPORTED[symbol].fut;
      if (futKey && exp === (list[0] && list[0].s)) {
        const fj = await nse.nseGet(`/api/liveEquity-derivatives?index=${futKey}`, 15000).catch(() => null);
        if (fj) { const raw = futuresFrom(fj, null); if (raw && m.base.futOi == null) m.base.futOi = raw.oi; const f = futuresFrom(fj, m.base.futOi); if (f) m.fut = { ...f, at: Date.now() }; }
      }
      if (s.data) s.data.futures = m.fut || null;
    } catch { s.error = "option chain unavailable right now"; }
    finally { s.inflight = null; }
  })();
  await s.inflight;
  return { ...s, expiries: list.map((x) => x.s) };
}

module.exports = { get, analyse, futuresFrom, greeks, buildup, SUPPORTED, RISK_FREE };
