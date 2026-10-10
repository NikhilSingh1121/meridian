/**
 * Terminal-wide live prices. A keyless Yahoo streamer connection (raw Yahoo symbols:
 * ^NSEI, RELIANCE.NS, GC=F, USDINR=X, BTC-USD…) subscribed to the union of symbols the
 * open tabs ask for. Two outputs:
 *   · SSE /api/live/stream?every=<s>&symbols=A,B  — only quotes that changed, per client interval;
 *   · a cache overlay: every "q:<symbol>" quote the REST API serves gets the streamed price
 *     when it is newer than the polled one (server/cache.js setQuoteOverlay).
 * When the stream is silent (market closed, network down) nothing is overlaid and the
 * polled quotes pass through unchanged.
 */
const express = require("express");
const { YahooFeed } = require("./feeds/yahoo");
const { SsePush } = require("./push/sse");

class LiveQuotes {
  constructor({ FeedClass = YahooFeed, maxSymbols = 400 } = {}) {
    this.q = new Map(); this.b5 = new Map(); this.seq = 0; this.push = new SsePush({ maxClients: 60 });
    this.FeedClass = FeedClass; this.feed = null; this.maxSymbols = maxSymbols; this.timer = null;
    this.listeners = new Set();   // other modules (Index Analyser) receive every raw tick
  }
  start() {
    if (this.feed) return;
    this.feed = new this.FeedClass({ raw: true });
    this.feed.on("tick", (t) => this.onTick(t));
    this.feed.start();
    this.timer = setInterval(() => { if (this.push.clients.size) this.push.pump(Date.now(), this); }, 1000);
    if (this.timer.unref) this.timer.unref();
  }
  stop() { clearInterval(this.timer); this.timer = null; if (this.feed) this.feed.stop(); this.feed = null; this.push.closeAll(); }
  ensure(symbols) {
    const add = symbols.filter((s) => s && !this.feed?.subs.has(s));
    if (!add.length) return;
    this.start();
    if (this.feed.subs.size + add.length > this.maxSymbols) return;
    this.feed.subscribe(add);
  }
  onTick(t) {
    if (!(t.ltp > 0)) return;
    const prev = this.q.get(t.s);
    if (prev && prev.price === t.ltp && prev.time >= t.ts) return;
    // 5-minute closes from the stream, so sparklines stay current without re-polling
    const k = Math.floor(t.ts / 300e3) * 300e3; let b = this.b5.get(t.s); if (!b) { b = []; this.b5.set(t.s, b); }
    if (b.length && b[b.length - 1].t === k) b[b.length - 1].c = t.ltp; else if (!b.length || k > b[b.length - 1].t) { b.push({ t: k, c: t.ltp }); if (b.length > 90) b.shift(); }
    this.q.set(t.s, { s: t.s, price: t.ltp, time: t.ts, dayHigh: t.high ?? prev?.dayHigh ?? null, dayLow: t.low ?? prev?.dayLow ?? null, prevClose: t.prevClose ?? prev?.prevClose ?? null, changePct: t.changePct ?? null, seq: ++this.seq });
    for (const f of this.listeners) { try { f(t); } catch { /* a listener never breaks the feed */ } }
  }
  /** the polled 5-minute sparkline extended with streamed 5-minute closes after it */
  sparkFor(symbol, quote) {
    const b = this.b5.get(symbol), sp = Array.isArray(quote.spark) ? quote.spark : [];
    if (!b || !b.length) return quote.spark;
    const after = b.filter((x) => x.t >= Math.floor((quote.marketTime || 0) / 300e3) * 300e3);
    if (!after.length) return quote.spark;
    const base = after[0].t === Math.floor((quote.marketTime || 0) / 300e3) * 300e3 ? sp.slice(0, -1) : sp;
    return [...base, ...after.map((x) => x.c)].slice(-80);
  }
  /** has the stream delivered a price for this symbol within `ms`? */
  onTicks(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  quote(symbol) { return this.q.get(symbol) || null; }
  isFresh(symbol, ms = 60e3) { const L = this.q.get(symbol); return !!L && Date.now() - L.time < ms; }
  /** patched copy of a polled quote, or the quote itself */
  overlay(symbol, quote) {
    const L = this.q.get(symbol);
    if (!L || !(L.time > (quote.marketTime || 0))) return quote;
    const pc = quote.prevClose || L.prevClose;
    const change = pc ? L.price - pc : quote.change;
    return { ...quote, price: L.price, change, changePct: pc ? (change / pc) * 100 : L.changePct ?? quote.changePct,
      dayHigh: quote.dayHigh != null ? Math.max(quote.dayHigh, L.price) : L.dayHigh, dayLow: quote.dayLow != null ? Math.min(quote.dayLow, L.price) : L.dayLow,
      marketTime: L.time, live: true, spark: this.sparkFor(symbol, quote) };
  }
  rowsSince(seq, filter) {
    const rows = [];
    for (const r of this.q.values()) if (r.seq > seq && (!filter || filter.has(r.s))) rows.push(r);
    return { rows, seq: this.seq };
  }
  eventsSince(seq) { return { events: [], seq }; }
  status() { return { connected: !!this.feed && this.feed.state === "live", state: this.feed ? this.feed.state : "idle", symbols: this.feed ? this.feed.subs.size : 0, quotes: this.q.size, ...this.push.stats() }; }
}

function router(live) {
  const r = express.Router();
  r.get("/live/stream", (req, res) => {
    const syms = String(req.query.symbols || "").split(",").map((x) => x.trim()).filter((x) => /^[\^A-Za-z0-9.=&_-]{1,30}$/.test(x)).slice(0, 200);
    live.ensure(syms);
    const c = live.push.attach(req, res, { every: req.query.every, filter: syms.length ? new Set(syms) : null });
    if (c) live.push.send(c, "hello", { id: c.id, every: c.every / 1000, status: live.status() });
  });
  r.post("/live/stream/:id/every", express.json(), (req, res) => { live.push.setEvery(req.params.id, req.body && req.body.every); res.json({ ok: true }); });
  r.post("/live/subscribe", express.json(), (req, res) => { const syms = (req.body && req.body.symbols || []).filter((x) => typeof x === "string").slice(0, 100); live.ensure(syms); res.json({ ok: true }); });
  r.get("/live/status", (_req, res) => res.json(live.status()));
  return r;
}
module.exports = { LiveQuotes, router };
