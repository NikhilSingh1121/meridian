/**
 * MERIDIAN — macro-data layer tests: every parser and pure computation that
 * the Macro dashboard depends on, exercised with realistic fixtures.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../providers/macrodata");
const NSE = require("../providers/nse");

/* ═══ Stooq ═══ */
test("stooq: quote CSV parses; garbage returns null", () => {
  const q = M.parseStooqQuote("Symbol,Date,Time,Open,High,Low,Close,Volume\n10USY.B,2026-07-10,22:00:00,4.31,4.35,4.28,4.33,0");
  assert.equal(q.close, 4.33);
  assert.equal(q.date, "2026-07-10");
  assert.equal(M.parseStooqQuote("Symbol,Date,Time,Open,High,Low,Close,Volume\n10USY.B,N/D,N/D,N/D,N/D,N/D,N/D,N/D"), null, "no-data row rejected");
  assert.equal(M.parseStooqQuote(""), null);
});

test("stooq: daily history CSV parses in order, skips bad rows", () => {
  const rows = M.parseStooqDaily("Date,Open,High,Low,Close,Volume\n2026-07-08,4.2,4.3,4.1,4.25,0\n2026-07-09,,,,,\n2026-07-10,4.25,4.4,4.2,4.33,0");
  assert.equal(rows.length, 2);
  assert.equal(rows[1].v, 4.33);
});

/* ═══ FRED ═══ */
test("FRED: fredgraph CSV parses; '.' missing markers dropped; YoY correct", () => {
  let csv = "observation_date,CPIAUCSL\n";
  // 14 months at exactly +0.5% m/m ⇒ YoY = 1.005^12 − 1 ≈ 6.17%
  let v = 100;
  for (let m = 0; m < 14; m++) { csv += `2025-${String((m % 12) + 1).padStart(2, "0")}-01,${v.toFixed(4)}\n`; v *= 1.005; }
  csv += "2026-03-01,.\n";
  const rows = M.parseFredCsv(csv);
  assert.equal(rows.length, 14, "missing '.' row dropped");
  const yoy = M.yoyFromIndex(rows);
  assert.ok(yoy.length === 2, "two YoY points from 14 monthly rows");
  assert.ok(Math.abs(yoy[0].v - 6.17) < 0.02, `YoY ${yoy[0].v}% ≈ 6.17%`);
});

/* ═══ BIS ═══ */
test("BIS: SDMX CSV parses by header name, sorts by date", () => {
  const csv = `"FREQ","REF_AREA","TIME_PERIOD","OBS_VALUE"\n"D","IN","2026-07-09","5.50"\n"D","IN","2026-07-08","5.50"\n"D","IN","2024-12-06","6.50"`;
  const rows = M.parseBisCsv(csv);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].date, "2024-12-06");
  assert.equal(rows[2].v, 5.5);
  assert.deepEqual(M.parseBisCsv("no,such,columns\n1,2,3"), [], "unknown header shape → empty");
});

/* ═══ World Bank ═══ */
test("World Bank: JSON parses to oldest→newest, nulls dropped", () => {
  const json = JSON.stringify([{ page: 1 }, [
    { date: "2024", value: 8.15 }, { date: "2023", value: 7.62 }, { date: "2022", value: null },
  ]]);
  const rows = M.parseWorldBank(json);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].date, "2023");
  assert.equal(rows[1].v, 8.15);
});

/* ═══ series math ═══ */
test("horizonReturns + ytdReturn + lastPercentile", () => {
  const closes = [];
  for (let i = 0; i < 260; i++) closes.push(100 * Math.pow(1.001, i)); // steady uptrend
  const hz = M.horizonReturns(closes);
  assert.ok(Math.abs(hz.w1 - (Math.pow(1.001, 5) - 1) * 100) < 0.01, "1W matches 5 trading days");
  assert.ok(hz.m1 > hz.w1, "1M exceeds 1W in an uptrend");
  const rows = closes.map((c, i) => ({ date: `2026-0${Math.min(7, 1 + Math.floor(i / 40))}-0${(i % 28) + 1 < 10 ? "0" : ""}${(i % 28) + 1}`, v: c }));
  assert.ok(M.ytdReturn(rows) > 0, "YTD positive in an uptrend");
  assert.equal(M.lastPercentile(closes), 100, "top of its own range");
});

test("currencyStrength: strongest/weakest ranked correctly from USD pairs", () => {
  // EUR +1% vs USD; JPY −1% vs USD (USDJPY +1%); INR flat
  const s = M.currencyStrength({ EURUSD: 1.0, USDJPY: 1.0, USDINR: 0.0 });
  assert.equal(s[0].ccy, "EUR", "EUR strongest");
  assert.equal(s[s.length - 1].ccy, "JPY", "JPY weakest");
  const sum = s.reduce((a, x) => a + x.score, 0);
  assert.ok(Math.abs(sum) < 1e-9, "scores centred on the basket mean");
});

/* ═══ FII/DII windows ═══ */
test("FII windows: sums over captured sessions; incomplete windows flagged", () => {
  const sessions = [];
  for (let i = 1; i <= 7; i++) sessions.push({ date: `2026-07-0${i}`, fii: -100, dii: 150 });
  const w = NSE.fiiWindows(sessions);
  assert.equal(w.d5.fii, -500);
  assert.equal(w.d5.dii, 750);
  assert.equal(w.d5.complete, true);
  assert.equal(w.d20.complete, false, "only 7 sessions on record");
  assert.equal(w.d20.n, 7);
  assert.equal(w.sessionsOnRecord, 7);
});

/* ═══ IMF DataMapper ═══ */
test("IMF: parses per-country latest actual year, excludes future forecasts", () => {
  const year = new Date().getFullYear();
  const json = JSON.stringify({ values: { NGDP_RPCH: {
    IND: { [year - 2]: 7.6, [year - 1]: 8.2, [year + 1]: 6.5 },   // +1 is a forecast → excluded
    USA: { [year - 1]: 2.8 },
    XYZ: { [year - 1]: null },
  } } });
  const out = M.parseImf(json, "NGDP_RPCH");
  assert.equal(out.IND.v, 8.2, "latest actual year wins");
  assert.equal(out.IND.year, String(year - 1));
  assert.ok(out.IND.trend.length === 2, "trend carries the actual-year series");
  assert.equal(out.USA.v, 2.8);
  assert.equal(out.XYZ, undefined, "null-only country dropped");
  assert.deepEqual(M.parseImf("not json", "NGDP_RPCH"), {}, "garbage → empty");
});

/* ═══ FII extras ═══ */
test("FII extras: streaks, record day, combined and absorption ratio", () => {
  const sessions = [
    { date: "2026-07-01", fii: 500, dii: 200 },
    { date: "2026-07-02", fii: -4200, dii: 3100 },   // record |FII| day
    { date: "2026-07-03", fii: -900, dii: 800 },
    { date: "2026-07-04", fii: -300, dii: 450 },
  ];
  const x = NSE.fiiExtras(sessions);
  assert.deepEqual(x.fiiStreak, { side: "SELL", days: 3 }, "3-day FII sell streak");
  assert.equal(x.largestFiiDay.date, "2026-07-02");
  assert.equal(x.combinedNet, 150, "latest session combined net");
  assert.equal(x.diiToFiiRatio, 1.5, "|DII/FII| absorption on the latest session");
});
