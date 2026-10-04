/**
 * Incremental indicators. Every update is O(1) per tick or per closed minute bar —
 * nothing re-scans a history.
 *
 * Baselines (once a day, from history): N-day / 52-week high-low, daily ATR, 20-day
 * average volume, and the time-of-day cumulative-volume profile used by relative volume.
 * Intraday state (per closed 1-minute bar): Bollinger(20,2) via rolling sums, EMA20,
 * Wilder ATR(14), Keltner(20, 1.5×ATR) squeeze on/off/fire, opening range.
 * Per tick: new intraday highs/lows count.
 */
const { Ring } = require("../store/ringbuffer");
const { sessionMinute, istDate, SESSION_MIN } = require("../store/session");

class RollingStats {                       // mean / stdev over the last n values
  constructor(n) { this.n = n; this.r = new Ring(n); this.sum = 0; this.sq = 0; this.pushes = 0; }
  push(v) {
    if (this.r.length === this.n) { const o = this.r.get(0); this.sum -= o; this.sq -= o * o; }
    this.r.push(v); this.sum += v; this.sq += v * v;
    if (++this.pushes % 256 === 0) { this.sum = 0; this.sq = 0; for (let i = 0; i < this.r.length; i++) { const x = this.r.get(i); this.sum += x; this.sq += x * x; } }
  }
  get full() { return this.r.length === this.n; }
  get mean() { return this.r.length ? this.sum / this.r.length : null; }
  get sd() { const k = this.r.length; if (k < 2) return null; const m = this.sum / k; return Math.sqrt(Math.max(0, this.sq / k - m * m)); }
}
class Ema { constructor(n) { this.k = 2 / (n + 1); this.v = null; this.n = 0; } push(x) { this.v = this.v == null ? x : this.v + this.k * (x - this.v); this.n++; return this.v; } }
class WilderAtr {
  constructor(n = 14) { this.n = n; this.v = null; this.prevC = null; this.cnt = 0; this.acc = 0; }
  push(h, l, c) {
    const tr = this.prevC == null ? h - l : Math.max(h - l, Math.abs(h - this.prevC), Math.abs(l - this.prevC));
    this.prevC = c;
    if (this.v == null) { this.acc += tr; if (++this.cnt === this.n) this.v = this.acc / this.n; }
    else this.v = (this.v * (this.n - 1) + tr) / this.n;
    return this.v;
  }
}

/** Daily-history baselines. `daily` = bars before today, oldest first. */
function dailyBaseline(daily, { n = 20 } = {}) {
  const d = (daily || []).filter((b) => b && b.c > 0);
  if (!d.length) return null;
  const lastN = d.slice(-n), last252 = d.slice(-252);
  const atr = new WilderAtr(14); for (const b of d.slice(-60)) atr.push(b.h, b.l, b.c);
  const vols = d.slice(-20).map((b) => b.v).filter((v) => v > 0);
  return {
    n, hiN: Math.max(...lastN.map((b) => b.h)), loN: Math.min(...lastN.map((b) => b.l)),
    hi52: Math.max(...last252.map((b) => b.h)), lo52: Math.min(...last252.map((b) => b.l)),
    atrD: atr.v, atrPct: atr.v ? (atr.v / d.at(-1).c) * 100 : null, avgVol20: vols.length ? vols.reduce((a, b) => a + b, 0) / vols.length : null,
    lastClose: d.at(-1).c, days: d.length,
  };
}

/**
 * Time-of-day volume profile from prior sessions' 1-minute bars:
 * cum[m] = average cumulative volume by the END of session minute m (m = 0…374).
 * `excludeDate` drops today's bars. Needs ≥ 2 sessions, else null.
 */
function volumeProfile(minuteBars, excludeDate) {
  const days = new Map();
  for (const b of minuteBars || []) {
    const date = istDate(b.t); if (date === excludeDate) continue;
    const m = sessionMinute(b.t); if (m < 0 || m >= SESSION_MIN) continue;
    let arr = days.get(date); if (!arr) { arr = new Float64Array(SESSION_MIN); days.set(date, arr); }
    arr[m] += b.v || 0;
  }
  const good = [...days.values()].filter((a) => a.reduce((x, y) => x + y, 0) > 0);
  if (good.length < 2) return null;
  const cum = new Float64Array(SESSION_MIN);
  for (const a of good) { let c = 0; for (let m = 0; m < SESSION_MIN; m++) { c += a[m]; cum[m] += c / good.length; } }
  return { cum, days: good.length, avgDay: cum[SESSION_MIN - 1] };
}
/** fallback profile when no minute history: U-shape scaled to the 20-day average volume */
function syntheticProfile(avgDay) {
  const w = Array.from({ length: SESSION_MIN }, (_, m) => 1 + 1.9 * Math.exp(-m / 22) + 1.0 * Math.exp(-(SESSION_MIN - 1 - m) / 28));
  const tot = w.reduce((a, b) => a + b, 0); const cum = new Float64Array(SESSION_MIN); let c = 0;
  for (let m = 0; m < SESSION_MIN; m++) { c += (w[m] / tot) * avgDay; cum[m] = c; }
  return { cum, days: 0, avgDay, approx: true };
}
/** expected cumulative volume at time ts (interpolated inside the minute) */
function expectedCum(profile, ts) {
  if (!profile) return null;
  const m = sessionMinute(ts); if (m < 0) return null;
  if (m >= SESSION_MIN) return profile.cum[SESSION_MIN - 1];
  const frac = ((ts % 60000) + 60000) % 60000 / 60000;
  const prev = m > 0 ? profile.cum[m - 1] : 0;
  return prev + (profile.cum[m] - prev) * frac;
}
const perMinute = (profile, m) => (!profile || m < 0 ? null : m >= SESSION_MIN ? null : profile.cum[m] - (m > 0 ? profile.cum[m - 1] : 0));

/** per-symbol intraday indicator state */
class SymState {
  constructor(s, { orbMin = 15 } = {}) {
    this.s = s; this.orbMin = orbMin; this.base = null; this.profile = null;
    this.reset(null);
  }
  reset(date) {
    this.date = date; this.bb = new RollingStats(20); this.ema = new Ema(20); this.atr = new WilderAtr(14);
    this.sqzOn = false; this.sqzBars = 0; this.sqzFire = 0; this.sqzFireAt = null; this.sqzLen = 0;
    this.orbH = null; this.orbL = null; this.nh = 0; this.nl = 0; this._hiMark = null; this._loMark = null; this._lastNhMin = -99; this._lastNlMin = -99;
    this.barsSeen = 0; this.bbwMin = Infinity;
  }
  /** a 1-minute bar closed */
  onBar(bar) {
    const date = istDate(bar.t); if (date !== this.date) this.reset(date);
    this.barsSeen++;
    this.bb.push(bar.c); this.ema.push(bar.c); this.atr.push(bar.h, bar.l, bar.c);
    const m = sessionMinute(bar.t);
    if (m >= 0 && m < this.orbMin) { this.orbH = this.orbH == null ? bar.h : Math.max(this.orbH, bar.h); this.orbL = this.orbL == null ? bar.l : Math.min(this.orbL, bar.l); }
    // Bollinger inside Keltner = squeeze; first bar outside after ≥ 6 squeeze bars = fire
    if (this.bb.full && this.atr.v != null && this.ema.v != null) {
      const up = this.bb.mean + 2 * this.bb.sd, dn = this.bb.mean - 2 * this.bb.sd;
      const ku = this.ema.v + 1.5 * this.atr.v, kd = this.ema.v - 1.5 * this.atr.v;
      const inside = up < ku && dn > kd;
      const bbw = this.bb.mean ? (up - dn) / this.bb.mean : null;
      if (bbw != null) this.bbwMin = Math.min(this.bbwMin, bbw);
      if (inside) { this.sqzOn = true; this.sqzBars++; }
      else {
        if (this.sqzOn && this.sqzBars >= 6) { this.sqzFire = bar.c >= this.ema.v ? 1 : -1; this.sqzFireAt = bar.t + 60000; this.sqzLen = this.sqzBars; }
        this.sqzOn = false; this.sqzBars = 0;
      }
    }
  }
  /** per tick: count fresh intraday highs/lows (at most one per minute, after the first 5 minutes) */
  onTick(ltp, ts, day) {
    const m = sessionMinute(ts);
    if (this._hiMark == null || this.date !== istDate(ts)) { this._hiMark = day.high; this._loMark = day.low; return; }
    if (m >= 5 && ltp > this._hiMark && m !== this._lastNhMin) { this.nh++; this._lastNhMin = m; }
    if (m >= 5 && ltp < this._loMark && m !== this._lastNlMin) { this.nl++; this._lastNlMin = m; }
    if (ltp > this._hiMark) this._hiMark = ltp; if (ltp < this._loMark) this._loMark = ltp;
  }
  /** fresh squeeze-fire flag: stays set for 10 minutes after the release */
  fireNow(ts) { return this.sqzFire && this.sqzFireAt && ts - this.sqzFireAt < 10 * 60000 ? this.sqzFire : 0; }
}
module.exports = { RollingStats, Ema, WilderAtr, dailyBaseline, volumeProfile, syntheticProfile, expectedCum, perMinute, SymState };
