/**
 * Scanner hub: feed adapter → tick store → engine → SSE push.
 * One instance per server process (see index.js); state is snapshotted to
 * server/data/scanner (git-ignored). Live data comes from Yahoo's keyless stream;
 * the synthetic replay feed exists only for the automated tests.
 *
 * Env (names only):
 *   SCANNER_UNIVERSE  nifty500 | fno                      (default nifty500)
 *   SCANNER_RECORD    1 → record live ticks to data/scanner/recordings/<date>.jsonl
 */
const fs = require("fs");
const path = require("path");
const EventEmitter = require("events");
const { TickStore } = require("./store/tickstore");
const { SsePush } = require("./push/sse");
const { loadUniverse } = require("./data/loader");
const S = require("./store/session");

const DATA_DIR = process.env.SCANNER_DATA_DIR || path.join(__dirname, "..", "data", "scanner");

function makeFeed(name, opts = {}) {
  const dir = DATA_DIR;
  // replay = synthetic market for the automated tests only (never offered in the UI)
  if (name === "replay") return new (require("./feeds/replay").ReplayFeed)({ universe: opts.universe, speed: opts.speed ?? 1, file: opts.file, seed: opts.seed, manual: opts.manual, date: opts.date, warmMinutes: opts.warmMinutes });
  if (name === "yahoo") return new (require("./feeds/yahoo").YahooFeed)({ dataDir: dir });
  throw new Error("unknown feed " + name);
}
const autoFeed = () => "yahoo";

class ScannerHub extends EventEmitter {
  constructor({ dataDir = DATA_DIR, EngineClass, offlineUniverse = false } = {}) {
    super();
    this.dataDir = dataDir; this.offline = offlineUniverse;
    this.EngineClass = EngineClass || require("./engine/quote").QuoteEngine;
    this.push = new SsePush();
    this.feed = null; this.store = null; this.engine = null; this.universe = null;
    this.metrics = { ticks: 0, tickRate: 0, computeMs: 0, pumpMs: 0, rowsChanged: 0, lastLoop: 0, heapMB: 0, maxComputeMs: 0 };
    this._tickCount = 0; this._rateAt = Date.now(); this.loopTimer = null; this.snapTimer = null; this.recBuf = [];
    this.started = false;
  }
  /** market clock: simulated time on replay, wall clock on live feeds */
  now() { return this.feed && this.feed.name === "replay" && this.feed.simTs ? this.feed.simTs : Date.now(); }
  status() {
    return { started: this.started, feed: this.feed ? this.feed.status() : null, universe: this.universe && { kind: this.universe.kind, n: this.universe.list.length, source: this.universe.source, notes: this.universe.notes },
      symbols: this.store ? this.store.books.size : 0, marketOpen: S.isMarketOpen(), market: S.marketStatus(), metrics: this.metrics, push: this.push.stats(), recording: this._recording() };
  }
  _recording() { return process.env.SCANNER_RECORD === "1" && this.feed && this.feed.info().live; }

  async start({ feed = "auto", universe = process.env.SCANNER_UNIVERSE || "total", watchlist = [], feedOpts = {}, universeList = null } = {}) {
    await this.stop();
    const name = feed === "auto" ? autoFeed() : feed;
    this.universe = universeList
      ? { kind: "custom", list: universeList, source: "explicit list", lots: {}, indexLots: {}, notes: [] }
      : await loadUniverse(universe, { dir: this.dataDir, watchlist, offline: this.offline || name === "replay" && feedOpts.offlineUniverse });
    // load testing: SCANNER_REPLAY_PAD=500 pads a replay universe with synthetic SYNnnn names (never on live feeds)
    if (name === "replay" && +process.env.SCANNER_REPLAY_PAD > this.universe.list.length) {
      const have = new Set(this.universe.list.map((u) => u.s));
      for (let i = 0; this.universe.list.length < +process.env.SCANNER_REPLAY_PAD; i++) { const s = "SYN" + String(i).padStart(3, "0"); if (!have.has(s)) this.universe.list.push({ s, sector: "Synthetic", fno: false, lot: null }); }
      this.universe.notes = [...(this.universe.notes || []), `padded to ${this.universe.list.length} with synthetic names for load testing`];
    }
    for (const c of this.push.clients) { c.lastSeq = -1; c.lastEv = -1; c.sent = null; }      // a restarted engine resets every client to a full frame
    const storeDir = path.join(this.dataDir, name === "replay" ? "replay" : "live");
    this.store = new TickStore({ dir: storeDir, onBarClose: (s, bar, book) => this.engine && this.engine.onBar(book, bar) });
    const restored = name === "replay" ? 0 : this.store.restore(S.istDate(Date.now()));
    this.engine = new this.EngineClass({ store: this.store, universe: this.universe.list, hub: this, feedName: name });
    this.feed = makeFeed(name, { ...feedOpts, universe: this.universe.list });
    this.feed.on("tick", (t) => this._onTick(t));
    this.feed.on("status", (st) => this.emit("status", st));
    const symbols = [...this.universe.list.map((u) => u.s), ...this.engine.extraSymbols ? this.engine.extraSymbols() : ["NIFTY", "BANKNIFTY", "INDIAVIX"]];
    this.feed.subscribe([...new Set(symbols)]);
    this.started = true;
    if (restored) for (const s of this.store.symbols()) { if (this.engine.rebuild) this.engine.rebuild(s); else this.engine.onTick(this.store.get(s)); }
    if (this.engine.warmup) this.engine.warmup(this.feed).catch((e) => console.warn("[scanner] warm-up:", e.message));
    await this.feed.start();
    if (!feedOpts.manual) {
      this.loopTimer = setInterval(() => this.loop(), 1000);
      this.snapTimer = setInterval(() => this.store.snapshot(), 60000);
    }
    return this.status();
  }
  _onTick(t) {
    const b = this.store.ingest(t);
    if (!b) return;
    this._tickCount++; this.metrics.ticks++;
    this.engine.onTick(b, t);
    if (this._recording()) this.recBuf.push(t);
  }
  /** one scheduler step: compute changed rows, push to clients */
  loop(now = Date.now()) {
    const t0 = performance.now();
    const n = this.engine.compute(now);
    const t1 = performance.now();
    this.push.pump(now, { rowsSince: (seq, f) => this.engine.rowsSince(seq, f), eventsSince: (seq) => this.engine.eventsSince(seq), extra: (c) => this._extra(c, now) });
    const t2 = performance.now();
    const m = this.metrics;
    m.computeMs = +(t1 - t0).toFixed(2); m.pumpMs = +(t2 - t1).toFixed(2); m.rowsChanged = n; m.lastLoop = now;
    m.maxComputeMs = Math.max(m.maxComputeMs * 0.999, m.computeMs);
    if (now - this._rateAt >= 5000) { m.tickRate = Math.round((this._tickCount * 1000) / (now - this._rateAt)); this._tickCount = 0; this._rateAt = now; m.heapMB = Math.round(process.memoryUsage().heapUsed / 1048576); }
    if (this.recBuf.length) this._flushRec();
    if (this.engine.flushEvents) this.engine.flushEvents();
    return n;
  }
  _extra(c, now) {
    const out = {};
    if (!c._statusAt || now - c._statusAt > 5000) { c._statusAt = now; out.status = this.status(); }
    const ex = this.engine.extraFrame ? this.engine.extraFrame(c) : null; if (ex) Object.assign(out, ex);
    return Object.keys(out).length ? out : null;
  }
  _flushRec() {
    const dir = path.join(this.dataDir, "recordings");
    try { fs.mkdirSync(dir, { recursive: true }); fs.appendFileSync(path.join(dir, S.istDate(Date.now()) + ".jsonl"), this.recBuf.map((t) => JSON.stringify(t)).join("\n") + "\n"); } catch { }
    this.recBuf = [];
  }
  async stop() {
    clearInterval(this.loopTimer); clearInterval(this.snapTimer); this.loopTimer = this.snapTimer = null;
    if (this.store && this.feed && this.feed.name !== "replay") this.store.snapshot();
    if (this.feed) { try { await this.feed.stop(); } catch { } this.feed.removeAllListeners(); }
    this.feed = null; this.started = false;
  }
  attachClient(req, res, opts) {
    const c = this.push.attach(req, res, opts);
    if (c) this.push.send(c, "hello", { id: c.id, every: c.every / 1000, status: this.status() });
    return c;
  }
}
module.exports = { ScannerHub, makeFeed, DATA_DIR };
