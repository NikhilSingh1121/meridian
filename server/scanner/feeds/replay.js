/**
 * REPLAY feed — a synthetic (or recorded) NSE market for development, tests and
 * after-hours use. Everything it emits is flagged synthetic; nothing here is real
 * market data.
 *
 * Synthetic model (deterministic from `seed`):
 *  · price: market factor + sector factor (β-weighted) + idiosyncratic noise, per second;
 *  · volume: U-shaped intraday profile × stock ADV × noise;
 *  · daily "episodes" planted in a few names: volume-spike breakouts, squeezes that
 *    release, opening gaps, and an OI regime (long/short build-up, covering, unwinding);
 *  · history (daily + minute) generated consistently with the live day's previous close;
 *  · option chains priced with Black-Scholes on an IV smile, with OI walls at round strikes.
 * Recorded mode: ReplayFeed({ file }) plays a JSONL tick recording (see hub recording).
 */
const fs = require("fs");
const readline = require("readline");
const { FeedAdapter, RANGE_DAYS } = require("./base");
const { rngFor, gauss } = require("./rng");
const S = require("../store/session");
const BS = require("../fno/bs");
const EXP = require("../data/expiries");

const SEC_PER_DAY = S.SESSION_MIN * 60;          // 22,500 trading seconds
const PROF = Array.from({ length: S.SESSION_MIN }, (_, m) => 1 + 1.9 * Math.exp(-m / 22) + 1.0 * Math.exp(-(S.SESSION_MIN - 1 - m) / 28));
const PROF_SUM = PROF.reduce((a, b) => a + b, 0);
const INDEX_BASE = { NIFTY: [25000, 0.009, 1.0, null], BANKNIFTY: [55000, 0.011, 1.05, "Financial Services"], FINNIFTY: [26500, 0.011, 1.0, "Financial Services"], MIDCPNIFTY: [13200, 0.012, 1.2, null], INDIAVIX: [13.5, 0, 0, null] };
const RISK_FREE = 0.065;

/* previous `n` weekdays before date (YYYY-MM-DD), oldest first */
function prevWeekdays(date, n) {
  const out = []; const d = new Date(date + "T00:00:00Z");
  while (out.length < n) { d.setUTCDate(d.getUTCDate() - 1); const w = d.getUTCDay(); if (w !== 0 && w !== 6) out.push(d.toISOString().slice(0, 10)); }
  return out.reverse();
}
function nextWeekday(date) { const d = new Date(date + "T00:00:00Z"); do d.setUTCDate(d.getUTCDate() + 1); while ([0, 6].includes(d.getUTCDay())); return d.toISOString().slice(0, 10); }
const openTsOf = (date) => Date.parse(date + "T09:15:00Z") - S.IST_OFFSET;
function strikeStep(px, u) {
  if (u === "NIFTY" || u === "FINNIFTY") return 50; if (u === "BANKNIFTY") return 100; if (u === "MIDCPNIFTY") return 25;
  return px < 100 ? 1 : px < 250 ? 2.5 : px < 500 ? 5 : px < 1000 ? 10 : px < 2500 ? 20 : px < 5000 ? 50 : 100;
}

class ReplayFeed extends FeedAdapter {
  constructor(opts = {}) {
    super("replay");
    this.seed = opts.seed ?? 20260929;
    this.speed = opts.speed ?? 1;
    this.tickMs = opts.tickMs ?? 1000;
    this.tickProb = opts.tickProb ?? 0.9;
    this.warmMinutes = opts.warmMinutes ?? 25;
    this.manual = !!opts.manual;                     // tests drive the clock with step()
    this.file = opts.file || null;
    this.universe = new Map();                       // s → { sector, fno }
    for (const u of opts.universe || []) this.universe.set(u.s, u);
    for (const k of Object.keys(INDEX_BASE)) if (!this.universe.has(k)) this.universe.set(k, { s: k, sector: null, index: true, fno: k !== "INDIAVIX" });
    this.params = new Map();
    this.st = new Map();                             // live state per symbol
    this.simTs = null; this.day = null; this.timer = null;
    this.completed = new Map();                      // s → [{date,o,h,l,c,v}] simulated full days
    this._startDate = opts.date || null;
  }
  info() {
    return { name: "replay", label: this.file ? "Replay · recorded ticks" : "Replay · synthetic market", live: false, synthetic: !this.file, recorded: !!this.file,
      capabilities: { ticks: true, history: !this.file, optionChain: !this.file, oi: true, depth: true }, speed: this.speed, simTs: this.simTs };
  }

  /* ── per-symbol constants ── */
  p(s) {
    let p = this.params.get(s); if (p) return p;
    const u = this.universe.get(s) || { s };
    const r = rngFor(this.seed, "params", s);
    if (INDEX_BASE[s]) { const [base, sig, beta, sec] = INDEX_BASE[s]; p = { base, sigD: sig, beta, sector: sec, adv: 0, index: true, atmIv: s === "NIFTY" ? 0.13 : 0.16 }; }
    else p = {
      base: Math.round(Math.exp(Math.log(60) + r() * (Math.log(6500) - Math.log(60))) * 20) / 20,
      sigD: 0.011 + r() * 0.021, beta: 0.6 + r() * 0.9, sector: u.sector || "Other",
      adv: Math.round(Math.pow(10, 5.2 + r() * 2.1)), index: false, atmIv: 0.2 + r() * 0.22, fno: u.fno !== false,
    };
    p.tick = p.index ? 0.05 : p.base < 250 ? 0.01 : 0.05;
    this.params.set(s, p); return p;
  }
  /* ── deterministic plan for one symbol-day: gap, episode, OI regime ── */
  plan(s, date) {
    const r = rngFor(this.seed, "plan", s, date), p = this.p(s);
    const plan = { gap: gauss(r) * 0.003, ep: null, sq: null, oiReg: ["LB", "SB", "SC", "LU", "N", "N"][Math.floor(r() * 6)], trend: gauss(r) * 0.004 };
    if (p.index) { plan.gap = gauss(r) * 0.004; return plan; }
    if (r() < 0.06) plan.gap += (r() < 0.5 ? -1 : 1) * (0.012 + r() * 0.028);
    const e = r();
    if (e < 0.06) plan.ep = { start: 15 + Math.floor(r() * 290), len: 8 + Math.floor(r() * 18), dir: r() < 0.62 ? 1 : -1, move: 0.015 + r() * 0.025, volX: 3 + r() * 4 };
    else if (e < 0.10) { const q = 45 + Math.floor(r() * 150); plan.sq = { quietEnd: q, len: 18, dir: r() < 0.6 ? 1 : -1, move: 0.012 + r() * 0.018, volX: 3 }; }
    return plan;
  }
  /* multipliers at session minute m: [price-vol ×, drift per sec, volume ×] */
  epAt(plan, m) {
    if (plan.ep && m >= plan.ep.start && m < plan.ep.start + plan.ep.len) return [1.8, (plan.ep.dir * plan.ep.move) / (plan.ep.len * 60), plan.ep.volX];
    if (plan.sq) {
      if (m < plan.sq.quietEnd) return [0.3, 0, 0.6];
      if (m < plan.sq.quietEnd + plan.sq.len) return [2.2, (plan.sq.dir * plan.sq.move) / (plan.sq.len * 60), plan.sq.volX];
    }
    return [1, 0, 1];
  }

  /* ── day lifecycle ── */
  _beginDay(date) {
    this.day = { date, openTs: openTsOf(date), mkt: 0, sec: new Map(), mktTrend: rngFor(this.seed, "mkt", date)() - 0.5 };
    const mr = rngFor(this.seed, "mktgap", date);
    this.day.mktGap = gauss(mr) * 0.004;
    this.day.rMkt = rngFor(this.seed, "mktpath", date);
    for (const s of this.universe.keys()) {
      const p = this.p(s), prev = this.st.get(s);
      if (prev && prev.date !== date) {                            // roll: yesterday's close becomes prevClose
        const list = this.completed.get(s) || []; list.push({ date: prev.date, o: prev.open, h: prev.high, l: prev.low, c: prev.px, v: prev.vol });
        if (list.length > 300) list.shift(); this.completed.set(s, list);
      }
      const prevClose = prev ? prev.px : p.base;
      const plan = this.plan(s, date);
      const gap = p.index ? (s === "INDIAVIX" ? -4 * this.day.mktGap : p.beta * this.day.mktGap + plan.gap * 0.3) : p.beta * this.day.mktGap + plan.gap;
      const open = this._round(prevClose * Math.exp(gap), p.tick);
      this.st.set(s, { date, prevClose, open, px: open, high: open, low: open, vol: 0, oi: p.fno && !p.index ? Math.round(p.adv * (2 + rngFor(this.seed, "oi", s)() * 6)) : null, oiOpen: null, plan, r: rngFor(this.seed, "path", s, date), lastEmit: 0 });
      const st = this.st.get(s); st.oiOpen = st.oi;
    }
  }
  _round(x, tick) { return +(Math.round(x / tick) * tick).toFixed(2); }

  /** advance the simulated market by dtSec seconds, emitting ticks */
  _advance(dtSec, emit = true) {
    const d = this.day;
    const m = Math.floor((this.simTs - d.openTs) / 60000);
    if (m >= S.SESSION_MIN) { this._beginDay(nextWeekday(d.date)); this.simTs = this.day.openTs; return this._advance(dtSec, emit); }
    const sq = Math.sqrt(dtSec / SEC_PER_DAY);
    const mr = gauss(d.rMkt) * 0.009 * sq + (d.mktTrend * 0.006 * dtSec) / SEC_PER_DAY;
    d.mkt += mr;
    const secR = new Map();
    const ts = this.simTs;
    for (const [s, st] of this.st) {
      const p = this.p(s);
      if (s === "INDIAVIX") { st.px = Math.max(8, st.px * Math.exp(-3.5 * mr + gauss(st.r) * 0.04 * sq)); }
      else {
        let sr = 0;
        if (p.sector) { if (!secR.has(p.sector)) { const rr = rngFor(this.seed, "sec", p.sector, d.date, ts)(); secR.set(p.sector, (rr - 0.5) * 3.46 * 0.006 * sq); } sr = secR.get(p.sector); }
        const [vx, drift, volX] = p.index ? [1, 0, 1] : this.epAt(st.plan, m);
        const idio = p.index ? gauss(st.r) * 0.002 * sq : gauss(st.r) * p.sigD * 0.8 * vx * sq + drift * dtSec + (st.plan.trend * dtSec) / SEC_PER_DAY;
        const ret = p.beta * mr + sr + idio;
        st.px = Math.max(p.tick, st.px * Math.exp(ret));
        if (!p.index) {
          const noise = Math.exp(gauss(st.r) * 0.45 - 0.1);
          const dv = Math.round(((p.adv * PROF[Math.max(0, Math.min(m, S.SESSION_MIN - 1))]) / PROF_SUM / 60) * dtSec * volX * noise);
          st.vol += Math.max(0, dv);
          if (st.oi != null) {
            const k = { LB: [1, 1], SB: [-1, 1], SC: [1, -1], LU: [-1, -1], N: [0, 0] }[st.plan.oiReg];
            const dOi = st.oi * (0.00002 * dtSec * k[1] + gauss(st.r) * 0.00008 * Math.sqrt(dtSec)) + (k[0] !== 0 ? 0 : 0);
            st.oi = Math.max(0, Math.round(st.oi + dOi));
            if (k[0] !== 0) st.px *= Math.exp((k[0] * 0.004 * dtSec) / SEC_PER_DAY);   // regime price bias
          }
        }
      }
      st.px = this._round(st.px, p.tick);
      st.high = Math.max(st.high, st.px); st.low = Math.min(st.low, st.px);
      if (emit && (st.r() < this.tickProb || ts - st.lastEmit >= 5000)) {
        st.lastEmit = ts;
        const spr = p.tick * (1 + Math.floor(st.r() * 3));
        this.emit("tick", { s, ltp: st.px, ts, vol: p.index ? undefined : st.vol, oi: st.oi ?? undefined, bid: this._round(st.px - spr, p.tick), ask: this._round(st.px + spr, p.tick),
          bq: p.index ? undefined : Math.round(50 + st.r() * 2000), aq: p.index ? undefined : Math.round(50 + st.r() * 2000), open: st.open, high: st.high, low: st.low, prevClose: st.prevClose });
      }
    }
    this.simTs += dtSec * 1000;
  }

  async start() {
    if (this.file) return this._startRecorded();
    const now = Date.now();
    let date = this._startDate || S.istDate(now);
    if ([0, 6].includes(new Date(date + "T00:00:00Z").getUTCDay())) date = prevWeekdays(date, 1)[0];
    this._beginDay(date);
    // align with the wall clock during market hours at 1× speed, else warm-start a few minutes in
    const live = !this._startDate && this.speed === 1 && S.isMarketOpen(now) && S.istDate(now) === date;
    const target = live ? now : this.day.openTs + this.warmMinutes * 60000;
    this.simTs = this.day.openTs;
    while (this.simTs < target - 5000) this._advance(5);
    this.setStatus("live", `synthetic session ${date}${this.speed !== 1 ? ` · ${this.speed}× speed` : ""}`);
    if (!this.manual) this.timer = setInterval(() => { try { this._advance(this.tickMs / 1000); } catch (e) { this.setStatus("error", e.message); } }, Math.max(20, this.tickMs / this.speed));
  }
  /** tests: advance n steps of tickMs */
  step(n = 1) { for (let i = 0; i < n; i++) this._advance(this.tickMs / 1000); }
  async stop() { clearInterval(this.timer); this.timer = null; if (this._rl) this._rl.close(); this.setStatus("closed"); }
  setSpeed(x) { this.speed = Math.max(0.25, Math.min(60, +x || 1)); if (this.timer) { clearInterval(this.timer); this.timer = setInterval(() => this._advance(this.tickMs / 1000), Math.max(20, this.tickMs / this.speed)); } }

  /* ── recorded playback: JSONL ticks, original timestamps, paced by `speed` ── */
  async _startRecorded() {
    const rl = readline.createInterface({ input: fs.createReadStream(this.file) }); this._rl = rl;
    this.setStatus("live", "recorded session " + require("path").basename(this.file));
    let t0 = null, w0 = Date.now();
    for await (const line of rl) {
      if (!line.trim()) continue;
      let t; try { t = JSON.parse(line); } catch { continue; }
      if (t0 == null) t0 = t.ts;
      const wait = (t.ts - t0) / this.speed - (Date.now() - w0);
      if (wait > 5 && !this.manual) await new Promise((r) => setTimeout(r, wait));
      this.simTs = t.ts; this.emit("tick", t);
    }
    this.setStatus("closed", "recording finished");
  }

  /* ── history ── */
  _dailySeries(s, n) {
    // backward from the base price: deterministic daily returns, the newest bar closes at p.base
    const p = this.p(s), r = rngFor(this.seed, "daily", s);
    const rets = Array.from({ length: n }, () => gauss(r) * (p.index ? p.sigD : p.sigD) + 0.0002);
    const firstLive = this.st.get(s)?.date || this.day?.date || this._startDate || S.istDate(Date.now());
    const dates = prevWeekdays(firstLive, n + (this.completed.get(s)?.length || 0)).slice(0, n);
    const out = new Array(n); let c = p.base;
    for (let i = n - 1; i >= 0; i--) {
      const dr = rngFor(this.seed, "dbar", s, dates[i]);
      const g = gauss(dr) * p.sigD * 0.3;
      const o = c / Math.exp(rets[i]) * Math.exp(g);
      const hi = Math.max(o, c) * (1 + Math.abs(gauss(dr)) * p.sigD * 0.45), lo = Math.min(o, c) * (1 - Math.abs(gauss(dr)) * p.sigD * 0.45);
      const v = p.index ? 0 : Math.round(p.adv * Math.exp(gauss(dr) * 0.35 - 0.06));
      out[i] = { date: dates[i], t: openTsOf(dates[i]), o, h: hi, l: lo, c, v };
      c = c / Math.exp(rets[i]);
    }
    return out;
  }
  _minuteDay(s, bar) {
    const p = this.p(s), plan = this.plan(s, bar.date), r = rngFor(this.seed, "mday", s, bar.date);
    const n = S.SESSION_MIN, lp = new Float64Array(n + 1); lp[0] = 0;
    for (let m = 0; m < n; m++) { const [vx, drift] = p.index ? [1, 0] : this.epAt(plan, m); lp[m + 1] = lp[m] + gauss(r) * p.sigD * vx * Math.sqrt(60 / SEC_PER_DAY) + drift * 60; }
    const target = Math.log(bar.c / bar.o), adj = (target - lp[n]) / n;   // bridge to the daily close
    const bars = []; let vsum = 0; const vols = [];
    for (let m = 0; m < n; m++) { const [, , vX] = p.index ? [1, 0, 1] : this.epAt(plan, m); const v = p.index ? 0 : PROF[m] * vX * Math.exp(gauss(r) * 0.4); vols.push(v); vsum += v; }
    for (let m = 0; m < n; m++) {
      const o = bar.o * Math.exp(lp[m] + adj * m), c = bar.o * Math.exp(lp[m + 1] + adj * (m + 1));
      const w = Math.abs(gauss(r)) * p.sigD * Math.sqrt(60 / SEC_PER_DAY) * 0.6;
      bars.push({ t: bar.t + m * 60000, o, h: Math.max(o, c) * (1 + w), l: Math.min(o, c) * (1 - w), c, v: p.index ? 0 : Math.round((vols[m] / vsum) * bar.v) });
    }
    return bars;
  }
  async getHistory(symbol, interval = "1d", range = "1y") {
    if (this.file) throw new Error("recorded replay has no history");
    this.p(symbol);
    const days = RANGE_DAYS[range] || 252;
    const done = (this.completed.get(symbol) || []).map((x) => ({ ...x, t: openTsOf(x.date) }));
    const need = Math.max(0, days - done.length);
    const daily = [...this._dailySeries(symbol, Math.max(need, 1)).slice(-need || undefined), ...done].slice(-days);
    const round = (b) => ({ t: b.t, o: +b.o.toFixed(2), h: +b.h.toFixed(2), l: +b.l.toFixed(2), c: +b.c.toFixed(2), v: b.v });
    if (interval === "1d") return daily.map(round);
    const mins = [];
    for (const b of daily.slice(-Math.min(days, 22))) mins.push(...this._minuteDay(symbol, b));
    const k = { "1m": 1, "5m": 5, "15m": 15 }[interval];
    if (!k) throw new Error("unsupported interval " + interval);
    if (k === 1) return mins.map(round);
    const agg = [];
    for (let i = 0; i < mins.length; i += k) { const g = mins.slice(i, i + k); agg.push({ t: g[0].t, o: g[0].o, h: Math.max(...g.map((x) => x.h)), l: Math.min(...g.map((x) => x.l)), c: g.at(-1).c, v: g.reduce((a, x) => a + x.v, 0) }); }
    return agg.map(round);
  }

  /* ── option chain ── */
  async getOptionChain(u, expiry) {
    if (this.file) throw new Error("recorded replay has no option chain");
    const st = this.st.get(u); const p = this.p(u);
    if (!st || p.index === false && p.fno === false) throw new Error(`${u} is not an F&O underlying`);
    const ts = this.simTs;
    const exps = EXP.expiries(u, ts);
    const ex = expiry && exps.includes(expiry) ? expiry : exps[0];
    const T = Math.max(EXP.yearsTo(ex, ts), 1 / (365 * 24));
    const spot = st.px, step = strikeStep(spot, u), atm = Math.round(spot / step) * step;
    const minuteKey = Math.floor(ts / 60000);
    const r = rngFor(this.seed, "chain", u, ex, st.date);
    const wall = (k) => (k % (step * 10) === 0 ? 2.2 : k % (step * 5) === 0 ? 1.5 : 1);
    const baseOi = p.index ? 4e6 : p.adv * 0.6;
    const uoa = new Set([atm + step * (2 + Math.floor(r() * 3)), atm - step * (2 + Math.floor(r() * 3))]);
    const prog = Math.min(1, Math.max(0, (ts - this.day.openTs) / (SEC_PER_DAY * 1000)));
    const rows = [];
    for (let i = -15; i <= 15; i++) {
      const K = +(atm + i * step).toFixed(2); if (K <= 0) continue;
      const mny = Math.log(K / spot);
      const row = { strike: K };
      for (const type of ["CE", "PE"]) {
        const rr = rngFor(this.seed, "leg", u, ex, K, type, st.date);
        const iv = p.atmIv * (1 + 2.2 * mny * mny) + (type === "PE" ? -0.25 * Math.min(0, mny) : 0) + (rr() - 0.5) * 0.01;
        const otm = type === "CE" ? mny : -mny;
        const shape = Math.exp(-Math.pow(Math.max(0, otm) / 0.05, 2) * 0.5) * (otm >= 0 ? 1 : 0.35);
        const oiPrev = Math.round(baseOi * shape * wall(K) * (0.6 + rr() * 0.8) / 100) * 100 || 0;
        const drift = (rr() - 0.4) * 0.35 * prog + Math.sin(minuteKey * 0.7 + K) * 0.004;
        const oi = Math.max(0, Math.round(oiPrev * (1 + drift) / 100) * 100);
        const ltp = Math.max(0.05, +BS.price(type, spot, K, T, RISK_FREE, iv).toFixed(2));
        const vol = Math.round((oi * (0.4 + rr() * 1.2) * (uoa.has(K) ? 6 : 1) * (0.3 + prog)) / 50) * 50;
        const g = BS.greeks(type, spot, K, T, RISK_FREE, iv);
        row[type] = { ltp, iv: +(iv * 100).toFixed(2), oi, oiChg: oi - oiPrev, vol, bid: Math.max(0.05, +(ltp * 0.995).toFixed(2)), ask: +(ltp * 1.005 + 0.05).toFixed(2), delta: +g.delta.toFixed(3), ltpChg: +((rr() - 0.5) * ltp * 0.2).toFixed(2) };
      }
      rows.push(row);
    }
    const futExp = EXP.expiries("_MONTHLY", ts)[0];                  // futures expire monthly
    const fut = +(spot * Math.exp(RISK_FREE * EXP.yearsTo(futExp, ts)) + (rngFor(this.seed, "basis", u, minuteKey)() - 0.5) * spot * 0.0006).toFixed(2);
    return { underlying: u, spot, expiry: ex, expiries: exps, ts, T, rows, future: { ltp: fut, expiry: futExp, oi: st.oi, oiChg: st.oi != null && st.oiOpen != null ? st.oi - st.oiOpen : null }, lotSize: null, synthetic: true, source: "replay" };
  }
  /** synthetic ATM IV history (1y) for IV rank in replay */
  ivHistory(u, days = 252) {
    const p = this.p(u), r = rngFor(this.seed, "ivh", u); let x = p.atmIv; const out = [];
    for (let i = 0; i < days; i++) { x = Math.max(0.05, x + 0.08 * (p.atmIv - x) + gauss(r) * p.atmIv * 0.06); out.push(+(x * 100).toFixed(2)); }
    return out;
  }
  quote(s) { const st = this.st.get(s); return st ? { ltp: st.px, prevClose: st.prevClose, open: st.open, high: st.high, low: st.low, vol: st.vol, oi: st.oi } : null; }
}
module.exports = { ReplayFeed, prevWeekdays, nextWeekday, strikeStep, PROF, PROF_SUM, openTsOf };
