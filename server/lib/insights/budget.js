/**
 * Per-report token budget (REPORT_TOKEN_CAP, default 100,000 — input + output +
 * thinking across every call a report makes). Research reads documents only
 * while it leaves `reserve` tokens for the write-up; the write-up stops when the
 * cap is reached and the report falls back to its deterministic text for the
 * sections it could not afford. Estimates are conservative (3.5 characters per
 * token) so a call is skipped rather than allowed to overrun the cap.
 */
const capFromEnv = (name, def) => { const v = +process.env[name]; return Number.isFinite(v) && v > 0 ? v : def; };

class TokenBudget {
  constructor(cap = capFromEnv("REPORT_TOKEN_CAP", 100_000)) { this.cap = cap; this.used = 0; this.skipped = []; }
  remaining() { return Math.max(0, this.cap - this.used); }
  /** would a call costing about `est` tokens fit while keeping `reserve` free? */
  fits(est, reserve = 0) { return this.used + est <= this.cap - reserve; }
  add(n) { this.used += Math.max(0, Math.round(+n || 0)); }
  skip(what) { this.skipped.push(what); }
  get exhausted() { return this.skipped.length > 0; }
}
/** prompt characters + expected output → estimated tokens */
const estimate = (chars, outTokens = 4000) => Math.ceil((+chars || 0) / 3.5) + outTokens;

module.exports = { TokenBudget, estimate, capFromEnv };
