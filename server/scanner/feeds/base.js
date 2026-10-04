/**
 * Provider-adapter interface for the Live Scanner.
 *
 * Every adapter is an EventEmitter that emits:
 *   'tick'   (tick)      { s, ltp, ts, vol?, oi?, bid?, ask?, bq?, aq?, open?, high?, low?, prevClose?, atp? }
 *   'status' (status)    { state: 'connecting'|'live'|'closed'|'error'|'idle', message? }
 * and implements:
 *   start(), stop()
 *   subscribe(symbols[]), unsubscribe(symbols[])
 *   getHistory(symbol, interval, range)  → [{ t, o, h, l, c, v, oi? }]   interval: '1m'|'5m'|'15m'|'1d', range: '1d'|'5d'|'1mo'|'3mo'|'6mo'|'1y'
 *   getOptionChain(underlying, expiry?)  → { underlying, spot, expiry, expiries[], ts, rows[{ strike, CE:{ltp,oi,oiChg,vol,iv?,bid,ask}, PE:{…} }], future? }
 *   info() → { name, label, live (real market data?), synthetic, capabilities{ticks,history,optionChain,oi,depth} }
 * Symbols are plain NSE trading symbols (RELIANCE, M&M) and index keys (NIFTY, BANKNIFTY, INDIAVIX).
 */
const EventEmitter = require("events");
class FeedAdapter extends EventEmitter {
  constructor(name) { super(); this.name = name; this.subs = new Set(); this.state = "idle"; this.message = null; this.setMaxListeners(50); }
  info() { return { name: this.name, label: this.name, live: false, synthetic: false, capabilities: {} }; }
  setStatus(state, message = null) { this.state = state; this.message = message; this.emit("status", { state, message, feed: this.name, ts: Date.now() }); }
  status() { return { state: this.state, message: this.message, subscribed: this.subs.size, ...this.info() }; }
  async start() { throw new Error(`${this.name}: start() not implemented`); }
  async stop() {}
  subscribe(symbols) { for (const s of symbols) this.subs.add(s); }
  unsubscribe(symbols) { for (const s of symbols) this.subs.delete(s); }
  async getHistory() { throw new Error(`${this.name}: history not available`); }
  async getOptionChain() { throw new Error(`${this.name}: option chain not available`); }
}
/** '1d' / '5d' / '1mo'… → trading days */
const RANGE_DAYS = { "1d": 1, "5d": 5, "1mo": 22, "3mo": 66, "6mo": 128, "1y": 252, "2y": 504 };
module.exports = { FeedAdapter, RANGE_DAYS };
