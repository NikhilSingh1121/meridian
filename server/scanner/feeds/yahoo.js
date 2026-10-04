/**
 * YAHOO adapter — keyless live ticks for personal use.
 *  · ticks: Yahoo Finance streamer WebSocket (wss://streamer.finance.yahoo.com, protobuf
 *    PricingData) — price, day volume, day high/low/open, previous close, bid/ask when sent;
 *  · history: Yahoo chart endpoint via server/providers/yahoo.js, queued politely (never per second),
 *    cached on disk per day;
 * No OI in the tick stream (Yahoo carries none for NSE).
 */
const fs = require("fs");
const path = require("path");
const { FeedAdapter, RANGE_DAYS } = require("./base");
const { parseFrame } = require("./yahoo-proto");
const YH = require("../../providers/yahoo");
const U = require("../data/universe");
const S = require("../store/session");

const STREAM = "wss://streamer.finance.yahoo.com/?version=2";
const toYahoo = (s) => (U.INDICES[s] ? U.INDICES[s].yahoo : /[.^=]/.test(s) && !/^[A-Z0-9&-]+$/.test(s) ? s : s + ".NS");

/* History requests for the scanner are background work. They are paced (SCANNER_HIST_GAP_MS), pause while
   Yahoo is refusing data requests, and back off while the terminal's total Yahoo rate is above
   SCANNER_YAHOO_BUDGET calls/min, so people browsing the site always get Yahoo's capacity first. */
class HistQueue {
  constructor(conc = 2, gapMs = +process.env.SCANNER_HIST_GAP_MS || 600) { this.conc = conc; this.gap = gapMs; this.q = []; this.active = 0; this.wait = null; }
  run(fn) { return new Promise((res, rej) => { this.q.push([fn, res, rej]); this._pump(); }); }
  _hold() {
    let U; try { U = require("../../lib/upstream"); } catch { return 0; }
    const cool = U.dataCoolingMs ? U.dataCoolingMs() : 0;
    if (cool > 0) return cool + 1000;
    const budget = +process.env.SCANNER_YAHOO_BUDGET || 150;
    return U.yahooPerMinuteNow && U.yahooPerMinuteNow() > budget ? 3000 : 0;
  }
  _pump() {
    if (this.wait) return;
    const hold = this.q.length ? this._hold() : 0;
    if (hold) { this.wait = setTimeout(() => { this.wait = null; this._pump(); }, hold); if (this.wait.unref) this.wait.unref(); return; }
    while (this.active < this.conc && this.q.length) {
      const [fn, res, rej] = this.q.shift(); this.active++;
      Promise.resolve().then(fn).then(res, rej).finally(() => setTimeout(() => { this.active--; this._pump(); }, this.gap));
    }
  }
}

class YahooFeed extends FeedAdapter {
  constructor({ dataDir, WebSocketImpl, raw = false } = {}) {
    super("yahoo");
    this.raw = raw;                                  // raw: symbols are already Yahoo symbols (^NSEI, GC=F, AAPL, RELIANCE.NS)
    this.dataDir = dataDir; this.WS = WebSocketImpl || globalThis.WebSocket;
    this.fromY = new Map(); this.ws = null; this.retry = 0; this.lastMsg = 0; this.msgs = 0;
    this.hq = new HistQueue(2);
  }
  info() { return { name: "yahoo", label: "Yahoo Finance stream (keyless)", live: true, synthetic: false, capabilities: { ticks: true, history: true, optionChain: false, oi: false, depth: false }, messages: this.msgs }; }
  async start() { this._stopped = false; this._connect(); }
  _connect() {
    if (!this.WS) { this.setStatus("error", "WebSocket unavailable (Node ≥ 22 required)"); return; }
    this.setStatus("connecting", "Yahoo streamer");
    const ws = new this.WS(STREAM); this.ws = ws;
    ws.onopen = () => { this.retry = 0; this.lastMsg = Date.now(); this.setStatus("live", "Yahoo streamer connected"); this._send([...this.subs]); };
    ws.onmessage = (ev) => { this.lastMsg = Date.now(); this.msgs++; const m = (() => { try { return parseFrame(typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString()); } catch { return null; } })(); if (m) this._emit(m); };
    ws.onclose = () => { if (this.ws === ws && !this._stopped) this._reconnect(); };
    ws.onerror = () => { };
    clearInterval(this.watchdog);
    // Yahoo drops quiet subscriptions: resubscribe every 5 min, reconnect after 90 s of silence in market hours
    this.watchdog = setInterval(() => {
      if (!this.ws || this.ws.readyState !== 1) return;
      if (S.isMarketOpen() && Date.now() - this.lastMsg > 90000) { try { this.ws.close(); } catch { } return; }
      if (Date.now() - (this._lastSub || 0) > 300000) this._send([...this.subs]);
    }, 10000);
  }
  _reconnect() { const wait = Math.min(30000, 1000 * 2 ** this.retry++); this.setStatus("connecting", `reconnecting in ${Math.round(wait / 1000)}s`); setTimeout(() => { if (!this._stopped) this._connect(); }, wait); }
  _send(symbols) {
    if (!this.ws || this.ws.readyState !== 1 || !symbols.length) return;
    const ys = symbols.map((s) => { const y = this.raw ? s : toYahoo(s); this.fromY.set(y, s); return y; });
    for (let i = 0; i < ys.length; i += 200) this.ws.send(JSON.stringify({ subscribe: ys.slice(i, i + 200) }));
    this._lastSub = Date.now();
  }
  _emit(m) {
    const s = this.fromY.get(m.id) || m.id;
    if (!(m.price > 0)) return;
    const r2 = (v) => (Number.isFinite(v) && v > 0 ? +v.toFixed(2) : undefined);
    const t = { s, ltp: this.raw ? m.price : r2(m.price), ts: m.time || Date.now(), src: "yahoo" };
    if (this.raw) { t.changePct = m.changePercent; t.change = m.change; }
    if (m.dayVolume > 0) t.vol = m.dayVolume;
    t.open = r2(m.openPrice); t.high = r2(m.dayHigh); t.low = r2(m.dayLow);
    t.prevClose = r2(m.previousClose) || (Number.isFinite(m.change) ? r2(m.price - m.change) : undefined);
    t.bid = r2(m.bid); t.ask = r2(m.ask);
    if (m.bidSize > 0) t.bq = m.bidSize; if (m.askSize > 0) t.aq = m.askSize;
    this.emit("tick", t);
  }
  subscribe(symbols) { super.subscribe(symbols); this._send(symbols); }
  unsubscribe(symbols) { super.unsubscribe(symbols); if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ unsubscribe: symbols.map((s) => (this.raw ? s : toYahoo(s))) })); }
  async stop() { this._stopped = true; clearInterval(this.watchdog); try { this.ws && this.ws.close(); } catch { } this.setStatus("closed"); }

  async getHistory(symbol, interval = "1d", range = "1y") {
    let r = range;
    if (interval === "1m" && (RANGE_DAYS[r] || 0) > 5) r = "5d";            // Yahoo serves 1-minute bars for ≤ 7 days
    const key = `${symbol}_${interval}_${r}_${S.istDate(Date.now())}`.replace(/[^A-Za-z0-9_.-]/g, "_");
    const f = this.dataDir && path.join(this.dataDir, "hist", key + ".json");
    const fresh = interval === "1d" ? 6 * 3600e3 : S.isMarketOpen() ? 10 * 60e3 : 6 * 3600e3;   // live ticks fill the gap after a cached warm-up
    const q = (x) => (x == null ? x : Math.round(x * 100) / 100);                 // Yahoo floats → paise
    // intraday bars start on their interval boundary; Yahoo stamps the still-forming last bar with the
    // latest trade time, which would otherwise create a second bar for the same minute
    const IMS = { "1m": 60e3, "2m": 120e3, "5m": 300e3, "15m": 900e3, "30m": 1800e3, "60m": 3600e3, "1h": 3600e3 }[interval];
    const clean = (arr) => {
      const out = [];
      for (const p of arr) {
        const b = { t: IMS ? Math.floor(p.t / IMS) * IMS : p.t, o: q(p.o), h: q(p.h), l: q(p.l), c: q(p.c), v: p.v || 0 };
        const last = out[out.length - 1];
        if (last && last.t === b.t) { last.h = Math.max(last.h, b.h); last.l = Math.min(last.l, b.l); last.c = b.c; last.v = Math.max(last.v, b.v); }
        else out.push(b);
      }
      return out;
    };
    try { const st = fs.statSync(f); if (Date.now() - st.mtimeMs < fresh) return clean(JSON.parse(fs.readFileSync(f, "utf8"))); } catch { }
    const h = await this.hq.run(() => YH.getHistory(toYahoo(symbol), r, interval));
    const bars = clean(h.points);
    try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(bars)); } catch { }
    return bars;
  }
}
module.exports = { YahooFeed, toYahoo, HistQueue };
