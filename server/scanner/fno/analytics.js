/**
 * F&O analytics on a normalised option chain (feeds/*.getOptionChain shape):
 *   PCR (OI, volume, OI-change) · max pain · OI walls (support / resistance) ·
 *   per-leg IV (supplied, or solved with Black-Scholes) · ATM IV, smile, expected move ·
 *   build-up classification per leg (price Δ × OI Δ) · unusual options activity ·
 *   futures basis and cost of carry · IV rank / percentile from a supplied history.
 * Pure functions — no I/O. Every figure is derived from the chain passed in.
 */
const BS = require("./bs");
const { yearsTo } = require("../data/expiries");

const RISK_FREE = 0.065;          // ≈ 91-day T-bill; only used when IV must be solved from prices
const r2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

/** price change × OI change → build-up class */
function classifyOi(priceChg, oiChg) {
  if (!Number.isFinite(priceChg) || !Number.isFinite(oiChg) || oiChg === 0 || priceChg === 0) return null;
  if (priceChg > 0 && oiChg > 0) return "Long build-up";
  if (priceChg < 0 && oiChg > 0) return "Short build-up";
  if (priceChg > 0 && oiChg < 0) return "Short covering";
  return "Long unwinding";
}
const CLASS_KEY = { "Long build-up": "LB", "Short build-up": "SB", "Short covering": "SC", "Long unwinding": "LU" };

/** strike K* at which option holders' total intrinsic payout is smallest */
function maxPain(rows) {
  const ks = rows.map((r) => r.strike).filter(Number.isFinite);
  let best = null, bestPay = Infinity;
  for (const K of ks) {
    let pay = 0;
    for (const r of rows) {
      if (r.CE && r.CE.oi > 0 && K > r.strike) pay += r.CE.oi * (K - r.strike);
      if (r.PE && r.PE.oi > 0 && K < r.strike) pay += r.PE.oi * (r.strike - K);
    }
    if (pay < bestPay) { bestPay = pay; best = K; }
  }
  return best == null ? null : { strike: best, payout: bestPay };
}

function median(a) { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; }

/** IV percentile / rank of `cur` within `hist` (array of IV values, oldest first) */
function ivStats(cur, hist, { minDays = 20 } = {}) {
  const h = (hist || []).filter(Number.isFinite);
  if (!Number.isFinite(cur) || h.length < minDays) return { rank: null, percentile: null, days: h.length, enough: false };
  const lo = Math.min(...h), hi = Math.max(...h);
  return { rank: hi > lo ? r2(((cur - lo) / (hi - lo)) * 100) : null, percentile: r2((h.filter((x) => x < cur).length / h.length) * 100), days: h.length, lo: r2(lo), hi: r2(hi), enough: true };
}

/**
 * analyse(chain, { ts, lot, ivHistory, ivProxy }) →
 *   { spot, expiry, T, totals, pcr, maxPain, walls, atm, atmIv, expectedMove, legs:[…per strike…], uoa:[…], future, ivRank }
 */
function analyse(chain, { ts = chain.ts || Date.now(), lot = chain.lotSize || null, ivHistory = null, ivProxy = null } = {}) {
  const rows = (chain.rows || []).filter((r) => Number.isFinite(r.strike)).sort((a, b) => a.strike - b.strike);
  const spot = chain.spot;
  const T = chain.T || yearsTo(chain.expiry, ts);
  const Tuse = Math.max(T, 1 / (365 * 24));
  const tot = { ceOi: 0, peOi: 0, ceOiChg: 0, peOiChg: 0, ceVol: 0, peVol: 0 };
  const legs = [];
  for (const r of rows) {
    const out = { strike: r.strike };
    for (const type of ["CE", "PE"]) {
      const l = r[type]; if (!l) { out[type] = null; continue; }
      if (l.oi > 0) tot[type === "CE" ? "ceOi" : "peOi"] += l.oi;
      if (Number.isFinite(l.oiChg)) tot[type === "CE" ? "ceOiChg" : "peOiChg"] += l.oiChg;
      if (l.vol > 0) tot[type === "CE" ? "ceVol" : "peVol"] += l.vol;
      let iv = Number.isFinite(l.iv) && l.iv > 0 ? l.iv / 100 : null, ivSrc = iv ? "source" : null;
      if (!iv && l.ltp > 0 && spot > 0) { iv = BS.impliedVol(type, l.ltp, spot, r.strike, Tuse, RISK_FREE); if (iv) ivSrc = "solved"; }
      const g = iv && spot > 0 ? BS.greeks(type, spot, r.strike, Tuse, RISK_FREE, iv) : null;
      out[type] = { ...l, iv: iv ? r2(iv * 100) : null, ivSrc, delta: g ? Math.round(g.delta * 1000) / 1000 : l.delta ?? null, theta: g ? r2(g.theta) : null, vega: g ? r2(g.vega) : null,
        cls: classifyOi(l.ltpChg, l.oiChg), volOi: l.oi > 0 && l.vol >= 0 ? r2(l.vol / l.oi) : null, oiChgPct: l.oi > 0 && Number.isFinite(l.oiChg) && l.oi - l.oiChg > 0 ? r2((l.oiChg / (l.oi - l.oiChg)) * 100) : null };
    }
    legs.push(out);
  }
  // ATM: strike nearest spot; ATM IV = mean of the call and put IVs there (interpolated between the two nearest strikes)
  let atm = null, atmIv = null;
  if (spot > 0 && legs.length) {
    const i = legs.reduce((bi, l, k) => (Math.abs(l.strike - spot) < Math.abs(legs[bi].strike - spot) ? k : bi), 0);
    atm = legs[i].strike;
    const ivAt = (l) => { const v = [l.CE && l.CE.iv, l.PE && l.PE.iv].filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const j = spot >= legs[i].strike ? Math.min(i + 1, legs.length - 1) : Math.max(i - 1, 0);
    const a = ivAt(legs[i]), b = ivAt(legs[j]);
    if (a != null && b != null && legs[j].strike !== legs[i].strike) { const w = (spot - legs[i].strike) / (legs[j].strike - legs[i].strike); atmIv = r2(a + (b - a) * w); }
    else atmIv = r2(a ?? b);
  }
  // walls: heaviest call OI at/above spot = resistance; heaviest put OI at/below = support
  const top = (arr, n) => arr.sort((x, y) => y.v - x.v).slice(0, n);
  const walls = {
    resistance: top(legs.filter((l) => l.CE && l.CE.oi > 0 && l.strike >= (spot || 0)).map((l) => ({ strike: l.strike, v: l.CE.oi, chg: l.CE.oiChg })), 3),
    support: top(legs.filter((l) => l.PE && l.PE.oi > 0 && l.strike <= (spot || Infinity)).map((l) => ({ strike: l.strike, v: l.PE.oi, chg: l.PE.oiChg })), 3),
    freshCallWriting: top(legs.filter((l) => l.CE && l.CE.oiChg > 0).map((l) => ({ strike: l.strike, v: l.CE.oiChg })), 3),
    freshPutWriting: top(legs.filter((l) => l.PE && l.PE.oiChg > 0).map((l) => ({ strike: l.strike, v: l.PE.oiChg })), 3),
  };
  // unusual options activity: volume ≥ 1.5× OI, or volume ≥ 4× the chain's median leg volume, or OI up ≥ 50% today
  const vols = legs.flatMap((l) => [l.CE && l.CE.vol, l.PE && l.PE.vol]).filter((v) => v > 0);
  const medVol = median(vols) || 0;
  const uoa = [];
  for (const l of legs) for (const type of ["CE", "PE"]) {
    const x = l[type]; if (!x || !(x.vol > 0)) continue;
    const why = [];
    if (x.volOi >= 1.5) why.push(`volume ${x.volOi}× OI`);
    if (medVol > 0 && x.vol >= 4 * medVol) why.push(`volume ${r2(x.vol / medVol)}× the chain's median strike`);
    if (x.oiChgPct >= 50) why.push(`OI +${x.oiChgPct}% today`);
    if (why.length) uoa.push({ strike: l.strike, type, vol: x.vol, oi: x.oi, oiChg: x.oiChg, ltp: x.ltp, iv: x.iv, cls: x.cls, why, turnover: lot && x.ltp ? Math.round(x.vol * x.ltp * (chain.oiUnit === "contracts" ? lot : 1)) : null, score: (x.volOi || 0) + (medVol ? x.vol / medVol / 4 : 0) });
  }
  uoa.sort((a, b) => b.score - a.score);
  // futures
  let future = null;
  if (chain.future && chain.future.ltp > 0 && spot > 0) {
    const days = Math.max(1 / 24, yearsTo(chain.future.expiry || chain.expiry, ts) * 365);
    const basis = chain.future.ltp - spot;
    future = { ...chain.future, basis: r2(basis), basisPct: r2((basis / spot) * 100), carryAnnPct: r2((basis / spot) * (365 / days) * 100), days: r2(days) };
  }
  const pcr = { oi: tot.ceOi > 0 ? r2(tot.peOi / tot.ceOi) : null, vol: tot.ceVol > 0 ? r2(tot.peVol / tot.ceVol) : null, oiChg: tot.ceOiChg > 0 && tot.peOiChg > 0 ? r2(tot.peOiChg / tot.ceOiChg) : null };
  const expectedMove = atmIv && spot ? { abs: r2(spot * (atmIv / 100) * Math.sqrt(Tuse)), pct: r2((atmIv / 100) * Math.sqrt(Tuse) * 100), days: r2(Tuse * 365) } : null;
  const ivRank = ivHistory ? { ...ivStats(atmIv, ivHistory), basis: "ATM IV history recorded by this scanner" } : ivProxy ? { ...ivStats(ivProxy.cur, ivProxy.hist), basis: ivProxy.basis, proxy: true } : null;
  return { underlying: chain.underlying, spot, expiry: chain.expiry, expiries: chain.expiries, T: r2(T * 365), totals: tot, pcr, maxPain: maxPain(rows), walls, atm, atmIv, expectedMove, legs, uoa: uoa.slice(0, 10), future, ivRank,
    oiUnit: chain.oiUnit || "shares", source: chain.source, synthetic: !!chain.synthetic, note: chain.oiChangeNote || null, ts };
}

/** stock-level build-up from the scanner row (price change today × OI change today) */
function rowBuildup(r) { return r && r.fno ? classifyOi(r.pct, r.oiPct) : null; }

module.exports = { analyse, classifyOi, CLASS_KEY, maxPain, ivStats, rowBuildup, RISK_FREE };
