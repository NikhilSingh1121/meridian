/**
 * In-memory tick store.
 *  · per symbol: last tick, a ring of recent ticks (ltp / cumulative volume / ts),
 *    today's minute bars built from ticks, day OHLC and VWAP accumulators;
 *  · restart-safe: snapshot() writes the day's bars + day state to local disk
 *    atomically; restore() reloads them when the snapshot is from the same IST date.
 *
 * Tick shape (every adapter emits this):
 *   { s, ltp, ts, vol?, oi?, bid?, ask?, bq?, aq?, open?, high?, low?, prevClose? }
 *   vol = cumulative day volume (exchange figure) — the store derives per-tick volume
 *   from its increments, so an adapter that re-sends the same cumulative figure adds 0.
 */
const fs = require("fs");
const path = require("path");
const { Ring } = require("./ringbuffer");
const { istDate, minuteFloor, sessionMinute } = require("./session");

const TICK_CAP = 900;      // ~15 min of 1s ticks per symbol
const BAR_CAP = 420;       // a full 375-minute session + slack

class SymbolBook {
  constructor(s) {
    this.s = s;
    this.tLtp = new Ring(TICK_CAP); this.tTs = new Ring(TICK_CAP); this.tVol = new Ring(TICK_CAP);
    this.bars = [];                 // today's closed + current minute bars {t,o,h,l,c,v,oi}
    this.last = null;               // last tick (merged)
    this.day = { date: null, open: null, high: -Infinity, low: Infinity, prevClose: null, vol: 0, pv: 0, vwapVol: 0, oi: null, oiOpen: null };
    this.seq = 0;                   // bumps on every accepted tick
  }
}

class TickStore {
  constructor({ dir, onBarClose } = {}) {
    this.books = new Map();
    this.dir = dir || null;
    this.onBarClose = onBarClose || null;
    this.ticks = 0;
    this.date = null;
  }
  book(s) { let b = this.books.get(s); if (!b) { b = new SymbolBook(s); this.books.set(s, b); } return b; }
  get(s) { return this.books.get(s) || null; }
  symbols() { return [...this.books.keys()]; }

  /** Accept a tick; returns the SymbolBook, or null when the tick was rejected. */
  ingest(t) {
    if (!t || !t.s || !(t.ltp > 0) || !Number.isFinite(t.ts)) return null;
    const b = this.book(t.s);
    const date = istDate(t.ts);
    if (b.day.date !== date) this._newDay(b, date, t);
    if (b.last && t.ts < b.last.ts - 5000) return null;            // stale / out-of-order beyond 5 s
    const d = b.day;
    // per-tick traded volume from the cumulative day figure
    let dv = 0;
    if (Number.isFinite(t.vol)) { dv = Math.max(0, t.vol - d.vol); d.vol = Math.max(d.vol, t.vol); }
    else if (Number.isFinite(t.lastQty)) { dv = t.lastQty; d.vol += dv; }
    if (d.open == null) d.open = Number.isFinite(t.open) && t.open > 0 ? t.open : t.ltp;
    if (Number.isFinite(t.open) && t.open > 0) d.open = t.open;     // exchange open wins
    d.high = Math.max(d.high, t.ltp, Number.isFinite(t.high) ? t.high : -Infinity);
    d.low = Math.min(d.low, t.ltp, Number.isFinite(t.low) && t.low > 0 ? t.low : Infinity);
    if (Number.isFinite(t.prevClose) && t.prevClose > 0) d.prevClose = t.prevClose;
    if (Number.isFinite(t.oi)) { if (d.oiOpen == null) d.oiOpen = t.oi; d.oi = t.oi; }
    if (dv > 0) { d.pv += t.ltp * dv; d.vwapVol += dv; }
    if (Number.isFinite(t.atp) && t.atp > 0) d.atp = t.atp;          // exchange average price when the feed provides one

    b.tLtp.push(t.ltp); b.tTs.push(t.ts); b.tVol.push(d.vol);
    // the first tick after a start-up / seed carries the day's cumulative volume not yet in the bars:
    // it belongs to the day's totals, not to the current minute (it would fake a volume spike)
    let catchUp = false;
    if (!b.live) {
      const lb = b.bars[b.bars.length - 1];
      catchUp = lb ? minuteFloor(t.ts) - lb.t > 120000 : sessionMinute(t.ts) > 2;   // a real gap, not a contiguous start
      b.live = true;
    }
    this._bar(b, t, catchUp ? 0 : dv);
    b.last = b.last ? Object.assign(b.last, t) : { ...t };
    b.seq++; this.ticks++;
    return b;
  }

  _newDay(b, date, t) {
    const prevClose = b.last && b.day.date && b.day.date < date ? b.last.ltp : b.day.prevClose;
    b.bars = []; b.tLtp.clear(); b.tTs.clear(); b.tVol.clear(); b.last = null; b.live = t && Number.isFinite(t.vol) && t.vol > 0 ? false : true;
    b.day = { date, open: null, high: -Infinity, low: Infinity, prevClose: Number.isFinite(t.prevClose) && t.prevClose > 0 ? t.prevClose : prevClose, vol: 0, pv: 0, vwapVol: 0, oi: null, oiOpen: null };
    if (!this.date || date > this.date) this.date = date;
  }

  _bar(b, t, dv) {
    const m = minuteFloor(t.ts);
    let cur = b.bars[b.bars.length - 1];
    if (!cur || m > cur.t) {
      if (cur && this.onBarClose) this.onBarClose(b.s, cur, b);
      cur = { t: m, o: t.ltp, h: t.ltp, l: t.ltp, c: t.ltp, v: 0, oi: Number.isFinite(t.oi) ? t.oi : null };
      b.bars.push(cur);
      if (b.bars.length > BAR_CAP) b.bars.shift();
    } else if (m < cur.t) {
      return;                                                     // late tick for a closed minute: day stats only
    }
    if (t.ltp > cur.h) cur.h = t.ltp; if (t.ltp < cur.l) cur.l = t.ltp;
    cur.c = t.ltp; cur.v += dv;
    if (Number.isFinite(t.oi)) cur.oi = t.oi;
  }

  /** Seed a symbol's day from minute bars (backfill after start-up / reconnect). Bars must be today's. */
  seedBars(s, bars, { prevClose } = {}) {
    if (!bars || !bars.length) return;
    const b = this.book(s);
    const date = istDate(bars[bars.length - 1].t);
    if (b.day.date && b.day.date > date) return;
    if (b.day.date !== date) this._newDay(b, date, { prevClose });
    const known = new Set(b.bars.map((x) => x.t));
    const add = bars.map((x) => ({ ...x, t: minuteFloor(x.t) })).filter((x, i, a) => !known.has(x.t) && x.c > 0 && (i + 1 >= a.length || a[i + 1].t !== x.t)).map((x) => ({ t: x.t, o: x.o, h: x.h, l: x.l, c: x.c, v: x.v || 0, oi: x.oi ?? null }));
    b.bars = [...add, ...b.bars].sort((x, y) => x.t - y.t).slice(-BAR_CAP);
    const d = b.day;
    if (prevClose > 0) d.prevClose = prevClose;
    d.open = b.bars[0].o; d.high = -Infinity; d.low = Infinity; d.pv = 0; d.vwapVol = 0; let vol = 0;
    for (const x of b.bars) { d.high = Math.max(d.high, x.h); d.low = Math.min(d.low, x.l); vol += x.v; d.pv += ((x.h + x.l + x.c) / 3) * x.v; d.vwapVol += x.v; }
    d.vol = Math.max(d.vol, vol);
    const lb = b.bars[b.bars.length - 1];
    if (!b.last) b.last = { s, ltp: lb.c, ts: lb.t + 59000, vol: d.vol, prevClose: d.prevClose };
    b.live = false;
    b.seq++;
  }

  vwap(s) { const b = this.get(s); if (!b) return null; const d = b.day; return d.atp || (d.vwapVol > 0 ? d.pv / d.vwapVol : null); }

  /* ── restart-safe snapshots ── */
  snapshot() {
    if (!this.dir || !this.date) return false;
    const out = { v: 1, date: this.date, savedAt: Date.now(), books: {} };
    for (const [s, b] of this.books) {
      if (b.day.date !== this.date) continue;
      out.books[s] = { day: b.day, bars: b.bars, last: b.last };
    }
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const f = path.join(this.dir, "ticks-" + this.date + ".json"), tmp = f + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(out));
      fs.renameSync(tmp, f);
      // keep only the 3 most recent daily snapshots
      const olds = fs.readdirSync(this.dir).filter((x) => /^ticks-\d{4}-\d\d-\d\d\.json$/.test(x)).sort().slice(0, -3);
      for (const o of olds) fs.unlinkSync(path.join(this.dir, o));
      return true;
    } catch (e) { console.warn("[scanner] snapshot failed:", e.message); return false; }
  }
  restore(date) {
    if (!this.dir) return 0;
    const f = path.join(this.dir, "ticks-" + date + ".json");
    let j; try { j = JSON.parse(fs.readFileSync(f, "utf8")); } catch { return 0; }
    if (!j || j.date !== date) return 0;
    let n = 0;
    for (const [s, x] of Object.entries(j.books || {})) {
      const b = this.book(s);
      b.day = { ...x.day, high: x.day.high ?? -Infinity, low: x.day.low ?? Infinity };
      const bars = []; for (const y of x.bars || []) { const t = minuteFloor(y.t), prev = bars[bars.length - 1]; if (prev && prev.t === t) Object.assign(prev, { h: Math.max(prev.h, y.h), l: Math.min(prev.l, y.l), c: y.c, v: prev.v + (y.v || 0) }); else bars.push({ ...y, t }); }
      b.bars = bars; b.last = x.last || null; b.live = false; b.seq++;
      if (b.last) { b.tLtp.push(b.last.ltp); b.tTs.push(b.last.ts); b.tVol.push(b.day.vol); }
      n++;
    }
    this.date = date;
    return n;
  }
}
module.exports = { TickStore, SymbolBook, TICK_CAP, BAR_CAP };
