/**
 * Quant Lab assessment layer: the conclusion / assumption checks at the top of each desk.
 * Run: npm test
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const Q = require("./quant");
const A = require("./quant-assess");

/* a deterministic random-walk price series with mild drift */
function series(n = 1300, seed = 11, drift = 0.0003, vol = 0.015) {
  let a = seed >>> 0, px = 100;
  const r = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = [], t0 = Date.UTC(2020, 0, 1);
  for (let i = 0; i < n; i++) {
    const z = Math.sqrt(-2 * Math.log(Math.max(r(), 1e-12))) * Math.cos(2 * Math.PI * r());
    px *= 1 + drift + vol * z;
    out.push({ t: t0 + i * 86400e3, o: px, h: px * 1.005, l: px * 0.995, c: px, v: 1e6 });
  }
  return out;
}
const find = (as, name) => as.assumptions.find((x) => x.name === name);

test("assessment: unrealistic Indian cost is flagged with a concrete suggestion", () => {
  const d = Q.backtest(series(), { strategy: "sma_cross", params: { fast: 20, slow: 100 }, costBps: 2, mc: false });
  const as = A.assessBacktest(d, { symbol: "RELIANCE.NS" });
  const c = find(as, "Trading cost");
  assert.equal(c.status, "bad");
  assert.equal(as.suggested.costBps, A.COST.india.suggest);
  assert.equal(as.reasonableness, "unrealistic");
  assert.ok(as.conclusion.headline.includes("RELIANCE.NS"));
  assert.ok(["good", "warn", "bad"].includes(as.conclusion.tone));
});

test("assessment: realistic inputs on a long history read as reasonable costs and history", () => {
  const d = Q.backtest(series(2600), { strategy: "sma_cross", params: { fast: 20, slow: 100 }, costBps: 15, mc: false });
  const as = A.assessBacktest(d, { symbol: "TCS.NS" });
  assert.equal(find(as, "Trading cost").status, "ok");
  assert.equal(find(as, "History").status, "ok");
  assert.equal(find(as, "Fast SMA").status, "ok");
  assert.ok(as.conclusion.points.length >= 3);
});

test("assessment: a fast window at or above the slow one is called out as degenerate", () => {
  const d = Q.backtest(series(), { strategy: "sma_cross", params: { fast: 60, slow: 50 }, costBps: 15, surface: false, walkForward: false, mc: false });
  const as = A.assessBacktest(d, { symbol: "INFY.NS" });
  const bad = as.assumptions.find((x) => x.status === "bad" && /Fast SMA vs Slow SMA/.test(x.name));
  assert.ok(bad, "ordering problem reported");
  assert.equal(as.suggested.params.fast, 20);
  assert.equal(as.suggested.params.slow, 100);
});

test("assessment: US symbols are judged against US costs", () => {
  const d = Q.backtest(series(), { strategy: "macd_trend", costBps: 5, surface: false, walkForward: false, mc: false });
  const as = A.assessBacktest(d, { symbol: "AAPL" });
  assert.equal(find(as, "Trading cost").status, "ok");
});

test("robustCell: picks the centre of a broad plateau over an isolated spike", () => {
  const xs = [10, 20, 30, 40, 50], ys = [100, 120, 140, 160, 180];
  const sharpe = ys.map((_, yi) => xs.map((_, xi) => (xi === 0 && yi === 4 ? 2.5 : Math.abs(xi - 2) + Math.abs(yi - 2) <= 1 ? 1.0 : 0.1)));
  const trades = ys.map(() => xs.map(() => 20));
  const rc = A.robustCell({ xs, ys, sharpe, trades, xKey: "fast", yKey: "slow" }, "sma_cross");
  assert.equal(rc.x, 30);
  assert.equal(rc.y, 140);
});

test("pairs assessment: exit band outside the entry band is inconsistent", () => {
  const as = A.assessPairs({ meta: { symA: "HDFCBANK.NS", symB: "ICICIBANK.NS", window: 60, entryZ: 2, exitZ: 2.5, stopZ: 3.5, costBps: 15, bars: 1200 }, meanReversion: { halfLifeDays: 15 }, cointegration: { cointegrated: true, verdict: "Cointegrated at the 5% level." }, strategy: { cagr: 0.05, sharpe: 0.6, maxDD: -0.1, trades: { n: 30 } }, tradeable: true, current: { signal: "No signal", z: 0.4 } });
  assert.equal(find(as, "Exit |z|").status, "bad");
  assert.equal(as.suggested.exitZ, 0.5);
  assert.equal(find(as, "z-window").status, "ok");
});

test("compareStrategies: ranks every catalogue rule on the same candles", () => {
  const r = Q.compareStrategies(series(1300), { costBps: 15 });
  assert.equal(r.rows.length, Object.keys(Q.STRATEGIES).length);
  for (let i = 1; i < r.rows.length; i++) assert.ok((r.rows[i - 1].sharpe ?? -9) >= (r.rows[i].sharpe ?? -9));
  assert.equal(r.rows[0].subSharpe.length, 3);
  assert.ok(r.benchmark && r.benchmark.sharpe != null);
});
