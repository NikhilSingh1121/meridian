/* Milestone 2 — incremental indicators, conditions, scans, engine events and score. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), os = require("os"), path = require("path");
const IND = require("../engine/indicators");
const C = require("../engine/conditions");
const { ScanBook, PRESETS, AND, OR, R } = require("../engine/scans");
const { ScannerEngine, score } = require("../engine/scanner");
const { TickStore } = require("../store/tickstore");
const { ScannerHub } = require("../hub");
const { mulberry32, gauss } = require("../feeds/rng");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "scn2-"));
const T0 = Date.parse("2026-09-25T09:15:00+05:30");
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

test("rolling mean/stdev match a direct computation over a sliding window", () => {
  const rs = new IND.RollingStats(20), rnd = mulberry32(7), xs = [];
  for (let i = 0; i < 1000; i++) {
    const x = 100 + gauss(rnd) * 5; xs.push(x); rs.push(x);
    const w = xs.slice(-20), m = w.reduce((a, b) => a + b, 0) / w.length, sd = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / w.length);
    assert.ok(close(rs.mean, m, 1e-9)); if (w.length > 1) assert.ok(close(rs.sd, sd, 1e-6));
  }
});

test("EMA and Wilder ATR match reference formulas", () => {
  const e = new IND.Ema(3); [1, 2, 3, 4].forEach((x) => e.push(x)); assert.equal(e.v, 3.125);                                              // k = 0.5: 1 → 1.5 → 2.25 → 3.125
  const a = new IND.WilderAtr(3), bars = [[10, 8, 9], [11, 9, 10], [12, 10, 11], [11, 7, 8], [9, 8, 8.5]];
  bars.forEach(([h, l, c]) => a.push(h, l, c));
  // TRs: 2, 2, 2, max(4,1,4)=4, max(1,1,0)=1 → seed (2+2+2)/3=2 → (2·2+4)/3=2.667 → (2.667·2+1)/3=2.111
  assert.ok(close(a.v, (((2 * 2 + 4) / 3) * 2 + 1) / 3, 1e-12));
});

test("daily baseline: N-day and 52-week extremes, ATR, 20-day volume", () => {
  const d = Array.from({ length: 260 }, (_, i) => ({ t: T0 - (260 - i) * 86400e3, o: 100 + i * 0.1, h: 101 + i * 0.1, l: 99 + i * 0.1, c: 100 + i * 0.1, v: 1000 + i }));
  d[10].h = 500;                                             // an old 52-week high outside the N window
  const b = IND.dailyBaseline(d, { n: 20 });
  assert.equal(b.hi52, 500); assert.ok(close(b.hiN, 101 + 259 * 0.1)); assert.ok(close(b.loN, 99 + 240 * 0.1));
  assert.ok(close(b.avgVol20, 1000 + (240 + 259) / 2)); assert.ok(b.atrD > 1.9 && b.atrD < 2.2);
});

test("time-of-day volume profile → relative volume and per-minute expectation", () => {
  const bars = [];
  for (const day of [1, 2]) for (let m = 0; m < 375; m++) bars.push({ t: T0 - day * 86400e3 + m * 60000, v: day === 1 ? 100 : 300 });   // avg 200/min
  const p = IND.volumeProfile(bars, "2026-09-25");
  assert.equal(p.days, 2); assert.equal(p.cum[0], 200); assert.equal(p.cum[374], 75000);
  assert.equal(IND.expectedCum(p, T0 + 9 * 60000 + 30000), 1900);        // 9 full minutes + half the 10th
  assert.equal(IND.perMinute(p, 100), 200);
  assert.equal(IND.volumeProfile(bars.slice(0, 375), "x"), null);            // one session is not a profile
  const sp = IND.syntheticProfile(75000); assert.ok(close(sp.cum[374], 75000, 1e-9) && sp.approx);
});

test("squeeze: Bollinger inside Keltner while coiling, fires on the first expansion bar", () => {
  const st = new IND.SymState("X");
  let t = T0;
  for (let i = 0; i < 40; i++, t += 60000) { const c = 100 + (i % 2 ? 0.05 : -0.05); st.onBar({ t, o: 100, h: 100.6, l: 99.4, c }); }
  assert.equal(st.sqzOn, true); assert.ok(st.sqzBars >= 6);
  for (let i = 0; i < 3 && !st.sqzFire; i++, t += 60000) st.onBar({ t, o: 100, h: 104 + i * 3, l: 100, c: 104 + i * 3 });
  assert.equal(st.sqzFire, 1); assert.equal(st.sqzOn, false);
  assert.equal(st.fireNow(st.sqzFireAt + 60000), 1); assert.equal(st.fireNow(st.sqzFireAt + 11 * 60000), 0);
});

test("opening range = first 15 minutes; new intraday highs counted once per minute after 5 minutes", () => {
  const st = new IND.SymState("X");
  for (let m = 0; m < 20; m++) st.onBar({ t: T0 + m * 60000, o: 100, h: 100 + (m < 15 ? m * 0.1 : 5), l: 99 - (m < 15 ? m * 0.05 : 5), c: 100 });
  assert.ok(close(st.orbH, 101.4)); assert.ok(close(st.orbL, 98.3));
  const day = { high: 101, low: 99 };
  st.onTick(100, T0 + 6 * 60000, day);                 // initialises marks
  st.onTick(101.5, T0 + 6 * 60000 + 1000, day); st.onTick(101.6, T0 + 6 * 60000 + 2000, day);   // same minute → 1
  st.onTick(101.7, T0 + 7 * 60000, day); st.onTick(98, T0 + 8 * 60000, day);
  assert.equal(st.nh, 2); assert.equal(st.nl, 1);
});

test("condition language: validation, nested AND/OR, between, field refs, crosses", () => {
  assert.throws(() => C.validate({ field: "nope", op: ">", value: 1 }), /unknown field/);
  assert.throws(() => C.validate({ field: "pct", op: "~", value: 1 }), /unknown operator/);
  assert.throws(() => C.validate({ op: "XOR", rules: [] }), /AND or OR/);
  assert.throws(() => C.validate({ field: "sec", op: ">", value: "IT" }), /use == or !=/);
  const L = C.validate(AND(R("rvol", ">=", 2), OR(R("brkN", "==", 1), R("orb", "==", 1)), R("ltp", ">", "@vwap"), R("pct", "between", [3, 1])));
  const row = { rvol: 2.5, brkN: 0, orb: 1, ltp: 105, vwap: 103, pct: 2.2 };
  const e = C.evaluate(L, row);
  assert.equal(e.ok, true); assert.equal(e.met.length, 4);
  assert.match(e.met[0], /Relative volume >= 2× \(now 2\.5×\)/);
  assert.equal(C.evaluate(L, { ...row, orb: 0 }).ok, false);
  assert.equal(C.evaluate(L, { ...row, pct: 3.5 }).ok, false);
  assert.equal(C.evaluate(L, { ...row, rvol: null }).ok, false);
  const X = C.validate(R("vwapD", "crossAbove", 0));
  assert.equal(C.evaluate(X, { vwapD: 0.2 }, { vwapD: -0.1 }).ok, true);
  assert.equal(C.evaluate(X, { vwapD: 0.2 }, { vwapD: 0.1 }).ok, false);
  assert.equal(C.evaluate(X, { vwapD: 0.2 }, null).ok, false);
  assert.deepEqual([...C.fieldsOf(L)].sort(), ["brkN", "ltp", "orb", "pct", "rvol", "vwap"]);
});

test("scan book: every preset is valid; custom scans persist, flags override presets", () => {
  for (const p of PRESETS) C.validate(p.logic);
  const dir = tmp(), a = new ScanBook(dir);
  const sc = a.upsert({ name: "My RS", logic: AND(R("rsN", ">", 2)), cooldownSec: 5 });
  assert.equal(sc.cooldownSec, 30); assert.equal(sc.preset, false);
  assert.throws(() => a.upsert({ name: "", logic: AND(R("rsN", ">", 2)) }), /name/);
  assert.throws(() => a.upsert({ name: "bad", logic: { op: "AND", rules: [] } }), /empty group/);
  a.setFlags("vol_breakout", { enabled: false, alert: true });
  const b = new ScanBook(dir);
  assert.equal(b.get(sc.id).name, "My RS"); assert.equal(b.get("vol_breakout").enabled, false); assert.equal(b.get("vol_breakout").alert, true);
  assert.equal(b.active().some((s) => s.id === "vol_breakout"), false);
  assert.equal(b.remove(sc.id), true); assert.equal(new ScanBook(dir).get(sc.id), null);
});

test("score is bounded 0–100 and bias follows breakout direction", () => {
  assert.deepEqual(score({}), [0, 0]);
  const [s, b] = score({ rvol: 8, vspike: 9, brkN: -1, brk52: -1, orb: -1, sqzFire: -1, m5: -5, rsN: -9, nl: 9, pct: -4 });
  assert.equal(s, 100); assert.equal(b, -1);
  assert.equal(score({ rvol: 2, m5: 0.5, pct: 1 })[0], 12 + 2);
});

/* engine on hand-made ticks: one stock + NIFTY, a baseline, then a volume breakout */
function mkEngine(dir) {
  const store = new TickStore({ onBarClose: (s, bar, b) => eng.onBar(b, bar) });
  const universe = [{ s: "AAA", sector: "Tech", fno: true }, { s: "BBB", sector: "Tech", fno: true }, { s: "CCC", sector: "Tech", fno: true }];
  const eng = new ScannerEngine({ store, universe, dataDir: dir, feedName: "test" });
  for (const s of ["AAA", "BBB", "CCC"]) {
    const st = eng.st(s);
    st.base = { n: 20, hiN: 110, loN: 90, hi52: 130, lo52: 80, atrD: 2, atrPct: 2, avgVol20: 75000, lastClose: 100, days: 252 };
    st.profile = IND.syntheticProfile(75000);
  }
  eng.scans.active = () => [{ ...PRESETS.find((p) => p.id === "vol_breakout"), cooldownSec: 600 }];
  return { store, eng };
}
const feed = (store, eng, s, ltp, ts, vol) => { const t = { s, ltp, ts, vol, prevClose: s === "NIFTY" ? 25000 : 100 }; const b = store.ingest(t); eng.onTick(b, t); };

test("engine: volume breakout fires one event with conditions + sparkline; cool-down suppresses repeats", () => {
  const { store, eng } = mkEngine(tmp());
  let vol = 0;
  for (let m = 0; m < 30; m++) for (let k = 0; k < 6; k++) {                     // 30 quiet minutes around 100
    const ts = T0 + m * 60000 + k * 10000; vol += 20;
    feed(store, eng, "AAA", 100 + (k % 2) * 0.1, ts, vol); feed(store, eng, "BBB", 100, ts, vol); feed(store, eng, "CCC", 100.2, ts, vol);
    feed(store, eng, "NIFTY", 25000, ts, undefined);
  }
  eng.compute(); assert.equal(eng.events.length, 0);
  let ts = T0 + 30 * 60000;
  for (let k = 0; k < 8; k++, ts += 30000) { vol += 60000; feed(store, eng, "AAA", 100 + (k + 1) * 1.6, ts, vol); }   // heavy volume, through 110
  eng.compute();
  const r = eng.row("AAA");
  assert.equal(r.brkN, 1); assert.ok(r.rvol >= 2, "rvol " + r.rvol); assert.ok(r.m5 > 0.3); assert.ok(r.tags.includes("VOL▲BRK"));
  assert.ok(Math.abs(r.rsS - (r.pct - (r.pct + 0 + 0.2) / 3)) < 0.02);       // vs the equal-weight sector mean
  assert.equal(r.rsN, r.pct);                                                  // NIFTY flat
  assert.equal(eng.events.length, 1);
  const ev = eng.events[0];
  assert.equal(ev.s, "AAA"); assert.equal(ev.scan, "vol_breakout"); assert.ok(ev.met.some((x) => /Relative volume/.test(x))); assert.ok(ev.spark.length > 10); assert.equal(ev.spark.at(-1), r.ltp);
  // leave the condition, re-enter within the cool-down → no new event
  feed(store, eng, "AAA", 99.5, ts += 60000, vol); eng.compute(); assert.ok(!eng.row("AAA").tags.includes("VOL▲BRK"));   // below the opening range, momentum negative
  vol += 90000; feed(store, eng, "AAA", 115, ts += 60000, vol); eng.compute();
  assert.equal(eng.events.length, 1);
  // after the cool-down, a fresh crossing fires again
  feed(store, eng, "AAA", 99.5, ts += 11 * 60000, vol); eng.compute();
  vol += 400000; feed(store, eng, "AAA", 118, ts += 60000, vol); eng.compute();
  assert.equal(eng.events.length, 2);
  eng.flushEvents(); assert.equal(eng.newEvents.length, 0);
});

test("engine on replay: baselines load for every symbol, events carry conditions, market summary adds up", async () => {
  const hub = new ScannerHub({ dataDir: tmp(), EngineClass: ScannerEngine, offlineUniverse: true });
  await hub.start({ feed: "replay", feedOpts: { manual: true, date: "2026-09-25", warmMinutes: 20 } });
  while (!hub.engine.warm.finished) await new Promise((r) => setTimeout(r, 10));
  for (let i = 0; i < 1200; i++) { hub.feed.step(1); hub.loop(); }
  const rows = [...hub.engine.rows.values()];
  assert.equal(hub.engine.warm.errors, 0);
  assert.ok(rows.every((r) => r.base && r.rvol != null && r.prof >= 2), "all rows have baselines + a 5-day profile");
  assert.ok(hub.engine.events.length > 0 && hub.engine.events.every((e) => e.met.length && e.synthetic));
  const mk = hub.engine.market();
  assert.equal(mk.adv + mk.dec + mk.unch, rows.length);
  assert.ok(mk.idx.NIFTY && mk.idx.NIFTY.pct != null);
  const one = hub.engine.events[0];
  assert.ok(hub.engine.matches(one.scan) !== null);
  assert.ok(hub.engine.detail(one.s).events.length >= 1);
  await hub.stop();
});
