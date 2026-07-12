/**
 * MERIDIAN — data validation layer.
 *
 * Upstream providers (Yahoo chart API in particular) intermittently return
 * garbage inside otherwise-valid payloads: null-spiked OHLC rows, negative
 * or absurd prices, out-of-order timestamps, strings where numbers belong.
 * Downstream, that garbage becomes NaN indicators, broken candles and wrong
 * ratios. This module normalizes AT THE PROVIDER BOUNDARY so every consumer
 * (routes, analytics, technicals, frontend) can trust shape and type.
 *
 * Philosophy: coerce what is salvageable, drop what is not, NEVER throw —
 * a validation layer that crashes is worse than the garbage it filters.
 */

const num = (v) => {
  if (v === null || v === undefined) return null;
  const x = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(x) ? x : null;
};

/** Positive finite number or null. */
const pos = (v) => {
  const x = num(v);
  return x !== null && x > 0 ? x : null;
};

/**
 * Sanitize a quote object in place-shape: numeric fields coerced, price must
 * be a positive finite number (else null), spark filtered to finite values,
 * change/changePct recomputed if inconsistent with price/prevClose.
 */
function sanitizeQuote(q) {
  if (!q || typeof q !== "object") return q;
  const out = { ...q };
  out.price = pos(q.price);
  out.prevClose = pos(q.prevClose);
  out.dayHigh = pos(q.dayHigh);
  out.dayLow = pos(q.dayLow);
  out.change = num(q.change);
  out.changePct = num(q.changePct);
  // internal consistency: recompute change from price/prevClose when possible
  if (out.price != null && out.prevClose != null) {
    out.change = out.price - out.prevClose;
    out.changePct = (out.change / out.prevClose) * 100;
  } else if (out.price == null) {
    out.change = null; out.changePct = null;
  }
  // clamp pathological percentage moves (corrupted prevClose) — a 10x single
  // -session print on a listed equity is upstream garbage, not alpha
  if (out.changePct != null && Math.abs(out.changePct) > 400) {
    out.change = null; out.changePct = null;
  }
  if (Array.isArray(q.spark)) out.spark = q.spark.filter((v) => Number.isFinite(v) && v > 0);
  out.name = typeof q.name === "string" ? q.name : String(q.symbol || "");
  return out;
}

/**
 * Sanitize a candle array: every point needs finite positive close, coherent
 * OHLC bounds (h ≥ max(o,c), l ≤ min(o,c) — repaired when trivially fixable,
 * dropped when nonsensical), strictly increasing timestamps.
 */
function sanitizeHistoryPoints(points) {
  if (!Array.isArray(points)) return [];
  const out = [];
  let lastT = -Infinity;
  for (const p of points) {
    if (!p) continue;
    const t = num(p.t);
    const c = pos(p.c);
    if (t === null || c === null || t <= lastT) continue;
    let o = pos(p.o) ?? c;
    let h = pos(p.h) ?? Math.max(o, c);
    let l = pos(p.l) ?? Math.min(o, c);
    // repair inverted bounds; drop rows that are wildly incoherent (>50% violation)
    const hi = Math.max(o, c), lo = Math.min(o, c);
    if (h < hi) { if (hi / h > 1.5) continue; h = hi; }
    if (l > lo) { if (l / lo > 1.5) continue; l = lo; }
    const v = num(p.v);
    out.push({ t, o, h, l, c, v: v !== null && v >= 0 ? v : null });
    lastT = t;
  }
  return out;
}

module.exports = { num, pos, sanitizeQuote, sanitizeHistoryPoints };
