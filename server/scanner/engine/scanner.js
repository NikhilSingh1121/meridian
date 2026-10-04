/**
 * Scanner engine: rows = quote + incremental indicators + scan tags + score; events =
 * scan triggers (edge-triggered, per-scan cool-down per symbol) with the conditions met
 * and a sparkline.
 *
 * SIGNAL SCORE (0–100, magnitude; `bias` carries direction):
 *   relative volume   min(25, 12·log2(rvol))           (rvol ≥ 1)
 *   1-min vol spike   min(15, 5·(vspike − 1))
 *   N-day breakout    12   · 52-week breakout 8 · opening-range breakout 8
 *   squeeze           12 on release (last 10 min) · 4 while coiled ≥ 20 bars
 *   momentum          min(10, 4·|m5|)                 (m5 in %)
 *   rel. strength     min(10, 2.5·|rsN|)              (pp vs NIFTY)
 *   new highs/lows    min(5, count)
 *   bias = sign(2·m5 + pct), overridden by the direction of a breakout / squeeze fire.
 */
const fs = require("fs");
const path = require("path");
const { QuoteEngine } = require("./quote");
const IND = require("./indicators");
const C = require("./conditions");
const { ScanBook } = require("./scans");
const { istDate, sessionMinute, isMarketOpen } = require("../store/session");

const IDX = new Set(["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "INDIAVIX"]);
const r2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const EVENT_CAP = 500;

function score(r) {
  let s = 0;
  if (r.rvol > 1) s += Math.min(25, 12 * Math.log2(r.rvol));
  if (r.vspike > 1) s += Math.min(15, 5 * (r.vspike - 1));
  if (r.brkN) s += 12; if (r.brk52) s += 8; if (r.orb) s += 8;
  if (r.sqzFire) s += 12; else if (r.sqz && r.sqzBars >= 20) s += 4;
  if (r.m5 != null) s += Math.min(10, 4 * Math.abs(r.m5));
  if (r.rsN != null) s += Math.min(10, 2.5 * Math.abs(r.rsN));
  s += Math.min(5, Math.max(r.nh || 0, r.nl || 0));
  let bias = Math.sign(2 * (r.m5 || 0) + (r.pct || 0));
  const dir = r.sqzFire || r.brk52 || r.brkN || r.orb;
  if (dir) bias = Math.sign(dir);
  return [Math.round(Math.min(100, s)), bias];
}

class ScannerEngine extends QuoteEngine {
  constructor({ store, universe = [], hub = null, feedName = null, dataDir = null } = {}) {
    super({ store, universe });
    this.hub = hub; this.feedName = feedName;
    this.dir = dataDir || (hub && hub.dataDir) || null;
    this.scans = new ScanBook(this.dir);
    this.state = new Map(); this.match = new Map(); this.lastFire = new Map(); this.newEvents = [];
    this.idx = new Map(); this.sectorAvg = new Map(); this.pctOf = new Map();
    this.warm = { done: 0, total: 0, errors: 0, finished: false };
    this.liveFeed = !!(feedName && feedName !== "replay" && feedName !== "test");
  }
  extraSymbols() { return ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "INDIAVIX"]; }
  st(s) { let x = this.state.get(s); if (!x) { x = new IND.SymState(s); this.state.set(s, x); } return x; }
  onTick(book, t) { this.dirty.add(book.s); if (t && !IDX.has(book.s)) this.st(book.s).onTick(t.ltp, t.ts, book.day); }
  onBar(book, bar) { if (!IDX.has(book.s)) this.st(book.s).onBar(bar); this.dirty.add(book.s); }

  /** rebuild a symbol's intraday indicator state from the store's closed bars (after backfill / restore) */
  rebuild(s) {
    const b = this.store.get(s); if (!b || !b.bars.length) return;
    const st = this.st(s); st.reset(b.day.date);
    for (const bar of b.bars.slice(0, -1)) st.onBar(bar);
    st._hiMark = b.day.high; st._loMark = b.day.low;
    this.dirty.add(s);
  }
  /** baselines from history (+ today's bars for live feeds). Runs in the background. */
  async warmup(feed) {
    const syms = [...this.extraSymbols().filter((x) => x !== "INDIAVIX"), ...this.meta.keys()];
    this.warm = { done: 0, total: syms.length, errors: 0, finished: false, startedAt: Date.now() };
    const live = feed.info().live;
    const todayOf = () => (feed.day && feed.day.date) || istDate(Date.now());
    this._warming = true; this.warmDate = todayOf();
    const one = async (s) => {
      try {
        let today = todayOf();
        const minute = await feed.getHistory(s, "1m", "5d").catch(() => []);
        // market closed and nothing ticked today: show the last session "as of close"
        if (live && !isMarketOpen() && minute.length && !(this.store.get(s) && this.store.get(s).day.date === today)) today = istDate(minute[minute.length - 1].t);
        const daily = await feed.getHistory(s, "1d", "1y").catch(() => []);
        const st = this.st(s);
        st.base = IND.dailyBaseline(daily.filter((d) => istDate(d.t) < today));
        st.profile = IND.volumeProfile(minute, today) || (st.base && st.base.avgVol20 ? IND.syntheticProfile(st.base.avgVol20) : null);
        if (live) {
          const todays = minute.filter((x) => istDate(x.t) === today);
          if (todays.length) { this.store.seedBars(s, todays, { prevClose: st.base && st.base.lastClose }); this.rebuild(s); }
        }
        this.dirty.add(s);
      } catch { this.warm.errors++; }
      this.warm.done++;
    };
    const conc = live ? 4 : 16;
    let i = 0;
    await Promise.all(Array.from({ length: conc }, async () => { while (i < syms.length) await one(syms[i++]); }));
    this.warm.finished = true; this.warm.ms = Date.now() - this.warm.startedAt; this._warming = false;
  }
  /** a new trading day started on a live feed → refresh baselines so yesterday counts in N-day highs etc. */
  _maybeRewarm() {
    if (this._warming || !this.hub || !this.hub.feed || !this.hub.feed.info().live || !this.store.date || !this.warmDate) return;
    if (this.store.date > this.warmDate) this.warmup(this.hub.feed).catch(() => { this._warming = false; });
  }

  computeRow(b) {
    const r = this.baseRow(b), st = this.st(b.s), t = b.last, ts = t.ts, ltp = t.ltp, d = b.day, base = st.base;
    const bars = b.bars, m = sessionMinute(ts);
    // relative volume and 1-minute spike vs the same time of day
    const exp = IND.expectedCum(st.profile, ts);
    r.rvol = exp > 0 && r.vol > 0 ? r2(r.vol / exp) : null;
    const cur = bars[bars.length - 1], prev = bars[bars.length - 2];
    const pmNow = IND.perMinute(st.profile, Math.min(m, 374)), pmPrev = IND.perMinute(st.profile, Math.min(m - 1, 374));
    const frac = Math.max(0.25, (((ts % 60000) + 60000) % 60000) / 60000);
    const v1 = cur && pmNow > 0 ? cur.v / (pmNow * frac) : null, v0 = prev && pmPrev > 0 ? prev.v / pmPrev : null;
    r.vspike = v1 == null && v0 == null ? null : r2(Math.max(v1 ?? 0, v0 ?? 0));
    // momentum vs the close k minutes ago (falls back to the day's open)
    const ref = (k) => { const i = bars.length - 1 - k; return i >= 0 ? bars[i].c : d.open; };
    const mom = (k) => { const x = ref(k); return x > 0 ? r2((ltp / x - 1) * 100) : null; };
    r.m1 = mom(1); r.m5 = mom(5); r.m15 = mom(15);
    r.vwapD = r.vwap ? r2((ltp / r.vwap - 1) * 100) : null;
    r.gap = r.pc && d.open ? r2((d.open / r.pc - 1) * 100) : null;
    r.orbH = st.orbH; r.orbL = st.orbL;
    r.orb = m >= st.orbMin && st.orbH != null ? (ltp > st.orbH ? 1 : ltp < st.orbL ? -1 : 0) : 0;
    if (base) {
      r.brkN = ltp > base.hiN ? 1 : ltp < base.loN ? -1 : 0;
      r.brk52 = ltp > base.hi52 ? 1 : ltp < base.lo52 ? -1 : 0;
      r.distN = r2((ltp / base.hiN - 1) * 100); r.hiN = r2(base.hiN); r.hi52 = r2(base.hi52); r.lo52 = r2(base.lo52);
      r.atrPct = r2(base.atrPct);
      r.rangeAtr = base.atrD > 0 && Number.isFinite(d.high) ? r2((d.high - d.low) / base.atrD) : null;
    } else { r.brkN = 0; r.brk52 = 0; r.distN = null; r.atrPct = null; r.rangeAtr = null; }
    r.sqz = st.sqzOn; r.sqzBars = st.sqzBars; r.sqzFire = st.fireNow(ts);
    const nifty = this.idx.get("NIFTY");
    r.rsN = r.pct != null && nifty && nifty.pct != null ? r2(r.pct - nifty.pct) : null;
    const sa = this.sectorAvg.get(r.sec);
    r.rsS = r.pct != null && sa && sa.n >= 3 ? r2(r.pct - sa.pct) : null;
    r.nh = st.nh; r.nl = st.nl;
    r.oiCls = r.fno ? (require("../fno/analytics").rowBuildup(r) || null) : null;
    if (this.lite) r.spark = null;                                       // backtests: no sparklines
    else r.spark = bars.slice(-31, -1).map((x) => x.c);                  // closed 1-min bars; clients append the live price
    r.base = !!base; r.prof = st.profile ? (st.profile.approx ? "approx" : st.profile.days) : 0;
    [r.score, r.bias] = score(r);
    return r;
  }

  compute(now = Date.now()) {
    this._maybeRewarm();
    // index + sector context first (sector = equal-weight mean % change of its members)
    for (const s of IDX) { const b = this.store.get(s); if (b && b.last && b.day.prevClose) this.idx.set(s, { ltp: b.last.ltp, pct: r2(((b.last.ltp - b.day.prevClose) / b.day.prevClose) * 100), ts: b.last.ts }); }
    for (const s of this.dirty) { const b = this.store.get(s); if (b && b.last && b.day.prevClose && this.meta.has(s)) this.pctOf.set(s, ((b.last.ltp - b.day.prevClose) / b.day.prevClose) * 100); }
    const acc = new Map();
    for (const [s, p] of this.pctOf) { const sec = this.meta.get(s)?.sector || "Other"; const a = acc.get(sec) || { sum: 0, n: 0 }; a.sum += p; a.n++; acc.set(sec, a); }
    this.sectorAvg = new Map([...acc].map(([k, a]) => [k, { pct: a.sum / a.n, n: a.n }]));

    const scans = this.scans.active();
    let n = 0;
    for (const s of this.dirty) {
      if (!this.meta.has(s)) continue;
      const b = this.store.get(s); if (!b || !b.last) continue;
      const prev = this.rows.get(s);
      const r = this.computeRow(b);
      r.tags = [];
      // live feeds: only ticks from the last 2 minutes can raise events (seeded history / after-hours never alert)
      const fresh = !this.liveFeed || now - b.last.ts < 120000;
      r.stale = !fresh;
      for (const sc of scans) {
        const e = C.evaluate(sc.logic, r, prev);
        const key = sc.id + "|" + s, was = this.match.get(key) || false;
        if (e.ok) {
          r.tags.push(sc.tag || sc.id);
          if (!was && fresh) {
            const last = this.lastFire.get(key) || 0, ts = b.last.ts;
            if (ts - last >= (sc.cooldownSec || 900) * 1000) { this.lastFire.set(key, ts); this._event(sc, r, e.met, ts); }
          }
        }
        this.match.set(key, e.ok);
      }
      if (!prev || require("./quote").rowChanged(prev, r)) { r._seq = ++this.seq; this.rows.set(s, r); n++; }
      else { prev.tags = r.tags; }
    }
    this.dirty.clear();
    return n;
  }
  _event(sc, r, met, ts) {
    const ev = { id: ++this.evSeq, ts, scan: sc.id, name: sc.name, tag: sc.tag, s: r.s, sec: r.sec, ltp: r.ltp, pct: r.pct, rvol: r.rvol, score: r.score,
      bias: sc.bias || r.bias || 0, met: met.slice(0, 6), spark: r.spark ? [...r.spark, r.ltp] : [], alert: !!sc.alert, synthetic: this.feedName === "replay" };
    this.events.push(ev); if (this.events.length > EVENT_CAP) this.events.shift();
    this.newEvents.push(ev);
    if (this.hub) this.hub.emit("signal", ev);
  }
  /** append new events to today's log (called once a second by the hub) */
  flushEvents() {
    if (!this.newEvents.length) return;
    if (this.dir) {
      const f = path.join(this.dir, this.feedName === "replay" ? "replay" : "live", `events-${istDate(this.newEvents[0].ts)}.jsonl`);
      try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.appendFileSync(f, this.newEvents.map((e) => JSON.stringify(e)).join("\n") + "\n"); } catch { }
    }
    this.newEvents = [];
  }
  market() {
    let adv = 0, dec = 0, unch = 0; for (const p of this.pctOf.values()) { if (p > 0.05) adv++; else if (p < -0.05) dec++; else unch++; }
    const sectors = [...this.sectorAvg].map(([sec, a]) => ({ sec, pct: r2(a.pct), n: a.n })).sort((a, b) => b.pct - a.pct);
    const counts = {}; for (const r of this.rows.values()) for (const t of r.tags || []) counts[t] = (counts[t] || 0) + 1;
    return { idx: Object.fromEntries(this.idx), adv, dec, unch, sectors, tagCounts: counts, warm: this.warm };
  }
  extraFrame(c) { if (c._mktAt && Date.now() - c._mktAt < 2000) return null; c._mktAt = Date.now(); return { market: this.market() }; }
  matches(scanId) {
    const sc = this.scans.get(scanId); if (!sc) return null;
    const out = [];
    for (const r of this.rows.values()) { const e = C.evaluate(sc.logic, r, null); if (e.ok) out.push({ s: r.s, ltp: r.ltp, pct: r.pct, score: r.score, met: e.met }); }
    return out.sort((a, b) => b.score - a.score);
  }
  preview(logic) { const L = C.validate(logic); const out = []; for (const r of this.rows.values()) if (C.evaluate(L, r, null).ok) out.push(r.s); return out; }
  detail(s) { const st = this.state.get(s), r = this.rows.get(s); return r ? { row: r, base: st && st.base, profileDays: st && st.profile ? st.profile.days : 0, squeeze: st && { on: st.sqzOn, bars: st.sqzBars, lastFireAt: st.sqzFireAt, lastLen: st.sqzLen }, events: this.events.filter((e) => e.s === s).slice(-30) } : null; }
}
module.exports = { ScannerEngine, score };
