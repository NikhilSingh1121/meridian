/* Milestone 1 — data layer: ring buffer, session clock, tick store, adapters, SSE push, hub. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Ring } = require("../store/ringbuffer");
const S = require("../store/session");
const { TickStore } = require("../store/tickstore");
const YP = require("../feeds/yahoo-proto");
const { YahooFeed, toYahoo } = require("../feeds/yahoo");
const { parseLots, parseN500, loadUniverse } = require("../data/loader");
const { ReplayFeed } = require("../feeds/replay");
const { SsePush } = require("../push/sse");
const { ScannerHub } = require("../hub");
const U = require("../data/universe");
const FX = (f) => fs.readFileSync(path.join(__dirname, "fixtures", f), "utf8");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "scn-"));
const T0 = Date.parse("2026-09-25T09:15:00+05:30");       // a Friday session open

test("ring buffer keeps the newest N values in order", () => {
  const r = new Ring(3); [1, 2, 3, 4, 5].forEach((v) => r.push(v));
  assert.equal(r.length, 3); assert.deepEqual(r.toArray(), [3, 4, 5]); assert.equal(r.back(0), 5); assert.equal(r.get(0), 3);
  r.setBack(0, 9); assert.equal(r.back(), 9); assert.deepEqual(r.toArray(2), [4, 9]);
});

test("session clock is IST regardless of host time zone", () => {
  assert.equal(S.sessionMinute(T0), 0);
  assert.equal(S.sessionMinute(T0 + 374 * 60000), 374);
  assert.equal(S.istDate(T0), "2026-09-25");
  assert.equal(S.sessionOpenTs(T0 + 3 * 3600e3), T0);
  assert.equal(S.isMarketOpen(T0 + 60e3), true);
  assert.equal(S.isMarketOpen(T0 + 380 * 60000), false);
  assert.equal(S.isMarketOpen(Date.parse("2026-09-26T10:00:00+05:30")), false);   // Saturday
});

test("tick store builds minute bars, volume deltas, VWAP and rejects stale ticks", () => {
  const closed = [];
  const st = new TickStore({ onBarClose: (s, bar) => closed.push(bar) });
  st.ingest({ s: "X", ltp: 100, ts: T0 + 1000, vol: 1000, prevClose: 98 });
  st.ingest({ s: "X", ltp: 101, ts: T0 + 20000, vol: 1500 });
  st.ingest({ s: "X", ltp: 99, ts: T0 + 59000, vol: 1500 });          // no new volume
  st.ingest({ s: "X", ltp: 102, ts: T0 + 61000, vol: 2500 });          // next minute → closes bar 1
  assert.equal(st.ingest({ s: "X", ltp: 50, ts: T0 - 60000 }), null);   // older than 5 s → rejected
  assert.equal(st.ingest({ s: "X", ltp: -1, ts: T0 + 62000 }), null);
  const b = st.get("X");
  assert.equal(b.bars.length, 2); assert.equal(closed.length, 1);
  assert.deepEqual(closed[0], { t: T0, o: 100, h: 101, l: 99, c: 99, v: 1500, oi: null });
  assert.equal(b.bars[1].v, 1000);
  assert.equal(b.day.vol, 2500); assert.equal(b.day.prevClose, 98); assert.equal(b.day.high, 102); assert.equal(b.day.low, 99);
  // VWAP from per-tick volume: (100×1000 + 101×500 + 102×1000) / 2500
  assert.ok(Math.abs(st.vwap("X") - (100 * 1000 + 101 * 500 + 102 * 1000) / 2500) < 1e-9);
});

test("tick store resets on a new IST day and carries the close as previous close", () => {
  const st = new TickStore();
  st.ingest({ s: "X", ltp: 100, ts: T0 + 1000, vol: 10 });
  st.ingest({ s: "X", ltp: 105, ts: T0 + 3600e3, vol: 20 });
  st.ingest({ s: "X", ltp: 104, ts: T0 + 3 * 86400e3 + 1000, vol: 5 });   // Monday
  const b = st.get("X");
  assert.equal(b.day.date, "2026-09-28"); assert.equal(b.day.prevClose, 105); assert.equal(b.bars.length, 1); assert.equal(b.day.vol, 5);
});

test("tick store snapshot → restore round-trip (restart safety)", () => {
  const dir = tmp();
  const a = new TickStore({ dir });
  for (let i = 0; i < 180; i++) a.ingest({ s: "Y", ltp: 200 + (i % 7), ts: T0 + i * 1000, vol: i * 10, oi: 5000 + i });
  assert.ok(a.snapshot());
  const b = new TickStore({ dir });
  assert.equal(b.restore("2026-09-25"), 1);
  assert.deepEqual(b.get("Y").bars, a.get("Y").bars);
  assert.equal(b.get("Y").day.vol, a.get("Y").day.vol);
  assert.equal(b.restore("2026-09-24"), 0);
});

test("tick store seeds a day from backfilled minute bars", () => {
  const st = new TickStore();
  const bars = [0, 1, 2].map((k) => ({ t: T0 + k * 60000, o: 10 + k, h: 11 + k, l: 9 + k, c: 10.5 + k, v: 100 }));
  st.seedBars("Z", bars, { prevClose: 9.5 });
  const b = st.get("Z");
  assert.equal(b.bars.length, 3); assert.equal(b.day.vol, 300); assert.equal(b.day.open, 10); assert.equal(b.day.high, 13); assert.equal(b.last.ltp, 12.5);
  st.ingest({ s: "Z", ltp: 13, ts: T0 + 3 * 60000 + 5000, vol: 350 });
  assert.equal(b.bars.length, 4); assert.equal(b.bars[3].v, 50);
});

test("Yahoo streamer: a real captured frame decodes; synthetic NSE frame maps to a tick", () => {
  // captured from wss://streamer.finance.yahoo.com/?version=2 on 2026-09-28 (EURUSD=X)
  const m = YP.parseFrame(JSON.stringify({ type: "pricing", message: "CghFVVJVU0Q9WBXfiZE/GPC2jpudaCoDQ0NZMA44AUVfAzK+ZQDEAbvYAQj1AgDEAbv9Al8DMr4=" }));
  assert.equal(m.id, "EURUSD=X"); assert.ok(Math.abs(m.price - 1.13702) < 1e-5); assert.equal(m.exchange, "CCY");
  assert.equal(new Date(m.time).toISOString(), "2026-09-28T20:25:39.000Z"); assert.ok(m.changePercent < 0);
  const f = new YahooFeed({ dataDir: tmp() }); f.fromY.set("RELIANCE.NS", "RELIANCE");
  const got = []; f.on("tick", (t) => got.push(t));
  const frame = YP.encodePricing({ id: "RELIANCE.NS", price: 2915.35, time: 1790239001000, dayVolume: 4351234, dayHigh: 2920.5, dayLow: 2880.05, openPrice: 2890, previousClose: 2885.6, change: 29.75 });
  f._emit(YP.parseFrame(frame));
  assert.equal(got[0].s, "RELIANCE"); assert.equal(got[0].ltp, 2915.35); assert.equal(got[0].vol, 4351234); assert.equal(got[0].prevClose, 2885.6); assert.equal(got[0].ts, 1790239001000);
  assert.deepEqual(["RELIANCE", "M&M", "NIFTY", "BANKNIFTY"].map(toYahoo), ["RELIANCE.NS", "M&M.NS", "^NSEI", "^NSEBANK"]);
});

test("NSE archive CSVs (real samples) → lot sizes and industries", () => {
  const lots = parseLots(FX("fo_mktlots.sample.csv"));
  assert.equal(lots.NIFTY, 65); assert.equal(lots.RELIANCE, 500); assert.equal(lots.MARICO, 1200); assert.equal(lots.Symbol, undefined);
  const n = parseN500(FX("nifty500.sample.csv"));
  assert.deepEqual(n.find((x) => x.s === "MARICO"), { s: "MARICO", name: "Marico Ltd.", industry: "Fast Moving Consumer Goods" });
});

test("universe loader falls back to the static list offline, with unknown (null) lot sizes", async () => {
  const u = await loadUniverse("fno", { offline: true });
  assert.equal(u.list.length, U.FNO_LIST.length); assert.ok(u.list.every((x) => x.lot === null && x.fno));
  assert.match(u.source, /static fallback/);
  const w = await loadUniverse("watchlist", { offline: true, watchlist: ["reliance.ns", "TCS", "TCS"] });
  assert.deepEqual(w.list.map((x) => x.s), ["RELIANCE", "TCS"]);
  const n = await loadUniverse("nifty500", { offline: true });
  assert.ok(n.list.length >= 330);
});

test("replay feed is deterministic and self-consistent", async () => {
  const uni = ["RELIANCE", "TCS", "HDFCBANK"].map((s) => ({ s, sector: U.SECTOR_OF[s], fno: true }));
  const run = async () => { const f = new ReplayFeed({ universe: uni, manual: true, date: "2026-09-25", warmMinutes: 5 }); const t = []; f.on("tick", (x) => t.push(x)); await f.start(); f.step(30); return { f, t }; };
  const a = await run(), b = await run();
  assert.deepEqual(a.t.slice(-20), b.t.slice(-20));
  assert.ok(a.t.every((x) => x.ltp > 0 && x.ts >= T0 && x.info === undefined));
  assert.equal(a.f.info().synthetic, true);
  // daily history ends at the live day's previous close
  const d = await a.f.getHistory("RELIANCE", "1d", "1y");
  assert.equal(d.length, 252); assert.equal(d.at(-1).c, +a.f.quote("RELIANCE").prevClose.toFixed(2));
  assert.ok(d.at(-1).t < T0);
  // minute history: 375 bars a day, summing to that day's volume (±rounding)
  const m = await a.f.getHistory("RELIANCE", "1m", "5d");
  assert.equal(m.length, 5 * 375);
  const lastDay = m.slice(-375), vsum = lastDay.reduce((s, x) => s + x.v, 0);
  assert.ok(Math.abs(vsum - d.at(-1).v) / d.at(-1).v < 0.01);
  assert.equal(lastDay.at(-1).c, d.at(-1).c);
  const f5 = await a.f.getHistory("RELIANCE", "5m", "5d"); assert.equal(f5.length, 5 * 75);
  // option chain: 31 strikes around spot, calls fall with strike, puts rise
  const c = await a.f.getOptionChain("NIFTY");
  assert.equal(c.rows.length, 31); assert.equal(c.synthetic, true);
  for (let i = 1; i < c.rows.length; i++) { assert.ok(c.rows[i].CE.ltp <= c.rows[i - 1].CE.ltp); assert.ok(c.rows[i].PE.ltp >= c.rows[i - 1].PE.ltp); }
  assert.ok(c.future.ltp > c.spot * 0.99);
});

function fakeRes() { const r = { chunks: [], headers: {}, set(h) { Object.assign(this.headers, h); }, write(s) { this.chunks.push(s); return true; }, flushHeaders() { }, end() { } }; return r; }
function fakeReq() { return { on() { } }; }
const frames = (res) => res.chunks.filter((c) => c.startsWith("event: frame")).map((c) => JSON.parse(c.split("data: ")[1]));

test("SSE push sends only changed rows, per client, at each client's interval", () => {
  const push = new SsePush();
  const rows = new Map(); let seq = 0;
  const set = (s, v) => rows.set(s, { s, v, _seq: ++seq });
  const src = { rowsSince: (sq) => ({ rows: [...rows.values()].filter((r) => r._seq > sq), seq }), eventsSince: (e) => ({ events: [], seq: e }) };
  set("A", 1); set("B", 1);
  const r1 = fakeRes(), r2 = fakeRes();
  push.attach(fakeReq(), r1, { every: 1 }); push.attach(fakeReq(), r2, { every: 5 });
  assert.equal(r1.headers["Content-Type"], "text/event-stream");
  push.pump(1000, src);
  assert.equal(frames(r1)[0].rows.length, 2); assert.equal(frames(r1)[0].full, true); assert.equal(frames(r2).length, 1);
  set("A", 2); push.pump(2000, src);
  assert.deepEqual(frames(r1)[1].rows.map((r) => r.s), ["A"]); assert.equal(frames(r2).length, 1);   // r2 not due yet
  set("B", 2); push.pump(3000, src); push.pump(6000, src);
  assert.deepEqual(frames(r2)[1].rows.map((r) => r.s).sort(), ["A", "B"]);                         // accumulated diff
  push.pump(7000, src); assert.equal(frames(r1).length, 3);                                         // nothing changed → no frame
});

test("hub end-to-end on replay: ticks → rows → SSE frame", async () => {
  const hub = new ScannerHub({ dataDir: tmp(), offlineUniverse: true });
  await hub.start({ feed: "replay", universe: "fno", feedOpts: { manual: true, date: "2026-09-25", warmMinutes: 3 } });
  assert.ok(hub.store.books.size >= U.FNO_LIST.length);
  const res = fakeRes(); hub.attachClient(fakeReq(), res, { every: 1 });
  hub.feed.step(5); hub.loop(1e13);
  const f = frames(res);
  assert.equal(f.length, 1); assert.ok(f[0].rows.length >= 200);
  const rel = f[0].rows.find((r) => r.s === "RELIANCE");
  assert.ok(rel.ltp > 0 && rel.pc > 0 && rel.vol > 0 && rel.fno === true);
  assert.equal(f[0].status.feed.synthetic, true);
  hub.feed.step(1); hub.loop(1e13 + 1000);
  const f2 = frames(res);
  assert.ok(f2.length === 2 && f2[1].rows.length < f[0].rows.length + 10);
  await hub.stop();
});

test("tick store: the first live tick after a lagging seed does not dump catch-up volume into one minute", () => {
  const st = new TickStore();
  const bars = [0, 1, 2].map((k) => ({ t: T0 + k * 60000, o: 10, h: 10.5, l: 9.5, c: 10, v: 100 }));
  st.seedBars("Q", bars, { prevClose: 9.8 });                         // history ends at 09:17; the stream joins at 10:00
  st.ingest({ s: "Q", ltp: 10.2, ts: T0 + 45 * 60000 + 5000, vol: 90300 });
  const b = st.get("Q");
  assert.equal(b.day.vol, 90300);                                      // the day keeps the volume …
  assert.equal(b.bars.at(-1).v, 0);                                    // … the 10:00 bar does not
  st.ingest({ s: "Q", ltp: 10.3, ts: T0 + 45 * 60000 + 30000, vol: 90800 });
  assert.equal(b.bars.at(-1).v, 500);                                  // later ticks count normally
  // a stream that starts well after the open with no seed behaves the same way
  const s2 = new TickStore(); s2.ingest({ s: "R", ltp: 50, ts: T0 + 60 * 60000, vol: 500000 });
  assert.equal(s2.get("R").bars[0].v, 0); assert.equal(s2.get("R").day.vol, 500000);
});
