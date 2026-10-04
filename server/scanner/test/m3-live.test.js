/* Milestone 3 (server side) — terminal-wide live quotes: stream → overlay on polled quotes → SSE diffs. */
const test = require("node:test");
const assert = require("node:assert/strict");
const EventEmitter = require("events");
const { LiveQuotes } = require("../livequotes");
const cache = require("../../cache");

class FakeFeed extends EventEmitter {
  constructor() { super(); this.subs = new Set(); this.state = "live"; }
  start() { } stop() { } subscribe(s) { s.forEach((x) => this.subs.add(x)); }
}

test("live quotes: streamed price overlays a polled quote only when newer; cached object untouched", () => {
  const L = new LiveQuotes({ FeedClass: FakeFeed });
  L.ensure(["^NSEI"]);
  assert.ok(L.feed.subs.has("^NSEI"));
  const polled = { symbol: "^NSEI", price: 22780.25, prevClose: 23141.3, change: -361.05, changePct: -1.56, dayHigh: 23100, dayLow: 22700, marketTime: 1000 };
  assert.equal(L.overlay("^NSEI", polled), polled);                          // nothing streamed yet
  L.feed.emit("tick", { s: "^NSEI", ltp: 22800, ts: 2000 });
  const o = L.overlay("^NSEI", polled);
  assert.notEqual(o, polled); assert.equal(polled.price, 22780.25);
  assert.equal(o.price, 22800); assert.equal(o.live, true); assert.equal(o.marketTime, 2000);
  assert.ok(Math.abs(o.change - (22800 - 23141.3)) < 1e-9); assert.ok(Math.abs(o.changePct - ((22800 - 23141.3) / 23141.3) * 100) < 1e-9);
  assert.equal(L.overlay("^NSEI", { ...polled, marketTime: 3000 }).price, 22780.25);   // polled is newer → untouched
  L.stop();
});

test("live quotes: SSE rows carry only symbols that changed since the client's last push", () => {
  const L = new LiveQuotes({ FeedClass: FakeFeed }); L.ensure(["A", "B"]);
  L.feed.emit("tick", { s: "A", ltp: 10, ts: 1 }); L.feed.emit("tick", { s: "B", ltp: 20, ts: 1 });
  const first = L.rowsSince(-1, null); assert.equal(first.rows.length, 2);
  L.feed.emit("tick", { s: "A", ltp: 10, ts: 1 });                          // duplicate → no change
  L.feed.emit("tick", { s: "B", ltp: 21, ts: 2 });
  const next = L.rowsSince(first.seq, null); assert.deepEqual(next.rows.map((r) => r.s), ["B"]);
  assert.deepEqual(L.rowsSince(first.seq, new Set(["A"])).rows, []);
  L.stop();
});

test("cache hook: q:<symbol> values pass through the overlay, other keys do not", async () => {
  cache.setQuoteOverlay((sym, q) => ({ ...q, price: 99, sym }));
  const q = await cache.cached("q:TEST.NS", 1000, async () => ({ price: 1 }));
  assert.deepEqual(q, { price: 99, sym: "TEST.NS" });
  assert.deepEqual(await cache.cached("h:TEST.NS", 1000, async () => ({ price: 1 })), { price: 1 });
  const d = await cache.cachedDurable("q:DUR.NS", 1000, async () => ({ price: 2 }));
  assert.equal(d.price, 99);
  assert.equal(cache.get("q:TEST.NS").price, 1);                              // the cached value itself is not mutated
  cache.setQuoteOverlay(null);
});
