/**
 * Minimal row engine: turns tick-store books into table rows and tracks which rows
 * changed (seq). The full scanner engine (engine/scanner.js) extends this with
 * indicators, scans, scores and events.
 */
class QuoteEngine {
  constructor({ store, universe = [] }) {
    this.store = store; this.meta = new Map(universe.map((u) => [u.s, u]));
    this.rows = new Map(); this.dirty = new Set(); this.seq = 0;
    this.events = []; this.evSeq = 0;
  }
  setUniverse(universe) { this.meta = new Map(universe.map((u) => [u.s, u])); }
  onTick(book) { this.dirty.add(book.s); }
  onBar() { }
  baseRow(b) {
    const d = b.day, t = b.last || {}, m = this.meta.get(b.s) || {};
    const pc = d.prevClose;
    const vw = d.atp || (d.vwapVol > 0 ? d.pv / d.vwapVol : null);
    return {
      s: b.s, name: m.name || null, sec: m.sector || null, fno: !!m.fno, lot: m.lot ?? null,
      ltp: t.ltp, chg: pc ? +(t.ltp - pc).toFixed(2) : null, pct: pc ? +(((t.ltp - pc) / pc) * 100).toFixed(2) : null,
      o: d.open, h: Number.isFinite(d.high) ? d.high : null, l: Number.isFinite(d.low) ? d.low : null, pc, vol: d.vol || 0,
      vwap: vw ? +vw.toFixed(2) : null, oi: d.oi, oiPct: d.oi != null && d.oiOpen ? +(((d.oi - d.oiOpen) / d.oiOpen) * 100).toFixed(2) : null,
      bid: t.bid ?? null, ask: t.ask ?? null, ts: t.ts,
    };
  }
  computeRow(b) { return this.baseRow(b); }
  /** recompute dirty rows; a row's seq bumps only when its visible content changed */
  compute() {
    let n = 0;
    for (const s of this.dirty) {
      const b = this.store.get(s); if (!b || !b.last) continue;
      const r = this.computeRow(b), prev = this.rows.get(s);
      if (!prev || rowChanged(prev, r)) { r._seq = ++this.seq; this.rows.set(s, r); n++; }
    }
    this.dirty.clear();
    return n;
  }
  rowsSince(seq, filter) {
    const out = [];
    for (const r of this.rows.values()) if (r._seq > seq && (!filter || filter.has(r.s))) out.push(r);
    return { rows: out, seq: this.seq };
  }
  eventsSince(seq) { return { events: seq < 0 ? this.events.slice(-100) : this.events.filter((e) => e.id > seq), seq: this.evSeq }; }
  row(s) { return this.rows.get(s) || null; }
}
function rowChanged(a, b) {
  for (const k in b) { if (k === "_seq" || k === "ts" || k === "spark") continue; const x = a[k], y = b[k]; if (x !== y && !(Array.isArray(x) && Array.isArray(y) && x.join() === y.join())) return true; }
  return false;
}
module.exports = { QuoteEngine, rowChanged };
