/* Live Scanner client views: the full-screen chart's candle building and the Top 5 composite (browser files run in a VM). */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path"), vm = require("vm");
const load = (file, extra = {}) => {
  const ctx = { window: {}, console, Math, Date, JSON, Number, String, Array, Map, Set, Infinity, isFinite, localStorage: { getItem: () => null, setItem() {} }, ...extra };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "..", "..", "public", file), "utf8"), ctx);
  return ctx;
};

test("full-screen chart: minute bars aggregate into 5-minute candles on interval boundaries", () => {
  const C = load("live-chart.js").LSC_CHART;
  const t0 = Date.parse("2026-09-29T09:15:00+05:30");
  const bars = Array.from({ length: 11 }, (_, i) => ({ t: t0 + i * 60e3, o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i, v: 10 }));
  const a = C.aggregate(bars, 300e3);
  assert.equal(a.length, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(a[0])), { t: t0, o: 100, h: 105, l: 99, c: 104.5, v: 50 });
  assert.equal(a[2].t, t0 + 600e3); assert.equal(a[2].v, 10);
});

test("full-screen chart: history supplies completed candles, the tick store the forming one, the live price closes it", () => {
  const t0 = Date.parse("2026-09-29T13:00:00+05:30");
  const row = { ltp: 105.5, o: 100, h: 106, l: 99, vol: 1e6, vwap: 103 };
  const C = load("live-chart.js", { LSC: { rows: () => new Map([["X", row]]), state: {} } }).LSC_CHART;
  C.state.s = "X"; C.state.tf = "5m";
  // history: 13:00, 13:05, 13:10 (the last is Yahoo's partial bar stamped 13:12:37)
  C.state.hist = [{ t: t0, o: 100, h: 102, l: 99, c: 101, v: 500 }, { t: t0 + 300e3, o: 101, h: 103, l: 100, c: 102, v: 600 }, { t: t0 + 757e3, o: 102, h: 104, l: 101, c: 103, v: 200 }];
  const today = [0, 1, 2, 3, 4, 5, 6].map((k) => ({ t: t0 + 600e3 + k * 60e3, o: 103, h: 104 + (k === 6 ? 1.5 : 0), l: 102.5, c: 103.5, v: k === 0 ? 0 : 40 }));   // 13:10 … 13:16
  const out = C.build(today);
  assert.deepEqual(out.map((b) => b.t), [t0, t0 + 300e3, t0 + 600e3, t0 + 900e3]);
  assert.equal(out[2].o, 102); assert.equal(out[2].v, 200);        // the 13:10 bucket keeps history's open and the larger volume
  const last = out[3];
  assert.equal(last.c, 105.5); assert.equal(last.h, 105.5); assert.equal(last.v, 80);   // live price, store volume
});

test("full-screen chart: daily view replaces today's history candle with the live session", () => {
  const today0 = Date.parse("2026-09-29T09:15:00+05:30");
  const row = { ltp: 205, o: 200, h: 206, l: 198, vol: 5e6 };
  const C = load("live-chart.js", { LSC: { rows: () => new Map([["Y", row]]), state: {} } }).LSC_CHART;
  C.state.s = "Y"; C.state.tf = "1D";
  const d = (iso) => Date.parse(iso + "T00:00:00+05:30");
  C.state.hist = [{ t: d("2026-09-26"), o: 190, h: 195, l: 189, c: 194, v: 4e6 }, { t: d("2026-09-29"), o: 200, h: 201, l: 199, c: 200, v: 1e5 }];
  const out = C.build([{ t: today0, o: 200, h: 201, l: 199, c: 200, v: 10 }]);
  assert.equal(out.length, 2);
  assert.deepEqual({ o: out[1].o, h: out[1].h, l: out[1].l, c: out[1].c, v: out[1].v }, { o: 200, h: 206, l: 198, c: 205, v: 5e6 });
});

test("Top 5: composite blends factor percentiles; boards filter and sort as stated", () => {
  const T = load("live-top5.js").LSC_TOP5;
  const mk = (s, pct, m15, rvol, vwapD, rsS, extra = {}) => ({ s, pct, m15, rvol, vwapD, rsS, brk52: 0, brkN: 0, orb: 0, ltp: 100, ...extra });
  const rows = [mk("A", 4, 1.5, 3, 1.2, 2, { brkN: 1, orb: 1 }), mk("B", 2, 0.5, 1.5, 0.4, 0.5), mk("C", 0.1, 0, 1, 0, 0), mk("D", -1, -0.4, 1.2, -0.5, -0.8), mk("E", -3, -1.2, 2.5, -1.5, -2, { brkN: -1, orb: -1 })];
  const c = T.composite(rows).sort((a, b) => b.score - a.score);
  assert.deepEqual(c.map((x) => x.r.s), ["A", "B", "C", "D", "E"]);
  assert.equal(c[0].score, 100); assert.equal(c[4].score, 0);
  assert.equal(c[0].parts.length, 6);
  const board = (id) => T.BOARDS.find((b) => b[0] === id);
  const [, , , f, v, , dir] = board("brk");
  const brk = rows.filter(f).sort((a, b) => (v(a) - v(b)) * dir).map((r) => r.s);
  assert.deepEqual(brk, ["A"]);
  const [, , , fg, vg, , dg] = board("gain");
  assert.deepEqual(rows.filter(fg).sort((a, b) => (vg(a) - vg(b)) * dg).slice(0, 2).map((r) => r.s), ["A", "B"]);
});
