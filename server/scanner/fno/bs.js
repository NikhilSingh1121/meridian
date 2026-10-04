/**
 * Black-Scholes-Merton for European index/stock options (NSE options are European).
 * T in years, r and q continuous rates, sigma annualised. IV solved by
 * Newton-Raphson with a bisection fallback.
 */
const SQRT2PI = Math.sqrt(2 * Math.PI);
function ncdf(x) {
  // Abramowitz-Stegun 7.1.26 via erf, |error| < 7.5e-8
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}
const npdf = (x) => Math.exp(-0.5 * x * x) / SQRT2PI;

function d1d2(S, K, T, r, q, v) {
  const sT = v * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * v * v) * T) / sT;
  return [d1, d1 - sT];
}
function price(type, S, K, T, r, v, q = 0) {
  if (T <= 0 || v <= 0) return Math.max(0, type === "CE" ? S - K : K - S);
  const [d1, d2] = d1d2(S, K, T, r, q, v);
  return type === "CE"
    ? S * Math.exp(-q * T) * ncdf(d1) - K * Math.exp(-r * T) * ncdf(d2)
    : K * Math.exp(-r * T) * ncdf(-d2) - S * Math.exp(-q * T) * ncdf(-d1);
}
function greeks(type, S, K, T, r, v, q = 0) {
  if (T <= 0 || v <= 0) return { delta: type === "CE" ? (S > K ? 1 : 0) : (S < K ? -1 : 0), gamma: 0, theta: 0, vega: 0 };
  const [d1, d2] = d1d2(S, K, T, r, q, v);
  const eq = Math.exp(-q * T), er = Math.exp(-r * T);
  const delta = type === "CE" ? eq * ncdf(d1) : eq * (ncdf(d1) - 1);
  const gamma = (eq * npdf(d1)) / (S * v * Math.sqrt(T));
  const vega = (S * eq * npdf(d1) * Math.sqrt(T)) / 100;                 // per 1 vol point
  const thetaY = type === "CE"
    ? -(S * eq * npdf(d1) * v) / (2 * Math.sqrt(T)) - r * K * er * ncdf(d2) + q * S * eq * ncdf(d1)
    : -(S * eq * npdf(d1) * v) / (2 * Math.sqrt(T)) + r * K * er * ncdf(-d2) - q * S * eq * ncdf(-d1);
  return { delta, gamma, theta: thetaY / 365, vega };                    // theta per calendar day
}
/** implied volatility (annualised, decimal) or null when the price is outside no-arbitrage bounds */
function impliedVol(type, P, S, K, T, r, q = 0) {
  if (!(P > 0) || !(S > 0) || !(K > 0) || !(T > 0)) return null;
  const intrinsic = Math.max(0, type === "CE" ? S * Math.exp(-q * T) - K * Math.exp(-r * T) : K * Math.exp(-r * T) - S * Math.exp(-q * T));
  if (P < intrinsic - 1e-9 || P > (type === "CE" ? S : K)) return null;
  let v = 0.3;
  for (let i = 0; i < 30; i++) {
    const p = price(type, S, K, T, r, v, q), vg = greeks(type, S, K, T, r, v, q).vega * 100;
    const diff = p - P;
    if (Math.abs(diff) < 1e-6) return v;
    if (!(vg > 1e-8)) break;
    const nv = v - diff / vg;
    if (!(nv > 0.001 && nv < 5)) break;
    v = nv;
  }
  let lo = 0.001, hi = 5;                                                 // bisection fallback
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2, p = price(type, S, K, T, r, mid, q);
    if (Math.abs(p - P) < 1e-6) return mid;
    if (p > P) hi = mid; else lo = mid;
  }
  const v2 = (lo + hi) / 2;
  return Math.abs(price(type, S, K, T, r, v2, q) - P) < Math.max(0.01, P * 0.001) ? v2 : null;
}
module.exports = { ncdf, npdf, price, greeks, impliedVol };
