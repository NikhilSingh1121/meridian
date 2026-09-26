/**
 * FII/DII historical baseline + aggregation tests.
 *
 * The shipped dataset (server/data-static/fiidii-history.json) is treated as
 * data under test: if a workbook refresh breaks reconciliation, ordering, or
 * introduces a non-trading day, these fail rather than the terminal quietly
 * drawing a wrong series.
 *
 * Run: npm test
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const NSE = require("../providers/nse");

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dow = (iso) => DOW[new Date(iso + "T00:00:00Z").getUTCDay()];
const near = (a, b, eps = 0.01) => Math.abs(a - b) < eps;

/* ══════════════════════════════════════════════════════════════════════════
   DATE NORMALISATION — the merge key between the archive and NSE's live feed
   ══════════════════════════════════════════════════════════════════════════ */

test("toIso normalises every date shape the two sources emit", () => {
  assert.equal(NSE.toIso("24-Jul-2026"), "2026-07-24");   // NSE live
  assert.equal(NSE.toIso("2026-07-24"), "2026-07-24");    // archive
  assert.equal(NSE.toIso("24-07-2026"), "2026-07-24");    // DD-MM-YYYY
  assert.equal(NSE.toIso("1-Jan-2020"), "2020-01-01");    // single-digit day
  assert.equal(NSE.toIso(new Date(Date.UTC(2026, 6, 24))), "2026-07-24");
});

test("toIso rejects junk instead of inventing a date", () => {
  for (const bad of [null, undefined, "", "garbage", "not-a-date", "13/13/2026x"]) {
    assert.equal(NSE.toIso(bad), null, `toIso(${JSON.stringify(bad)}) should be null`);
  }
});

test("isTradingDay accepts weekdays and rejects weekends", () => {
  assert.equal(NSE.isTradingDay("2026-07-24"), true);   // Friday
  assert.equal(NSE.isTradingDay("2026-07-20"), true);   // Monday
  assert.equal(NSE.isTradingDay("2026-07-25"), false);  // Saturday
  assert.equal(NSE.isTradingDay("2026-07-26"), false);  // Sunday
});

/* ══════════════════════════════════════════════════════════════════════════
   SHIPPED BASELINE INTEGRITY
   ══════════════════════════════════════════════════════════════════════════ */

test("the shipped baseline loads with all three series populated", () => {
  const s = NSE.staticHistory();
  assert.ok(s.daily.length >= 39, `expected ≥39 daily rows, got ${s.daily.length}`);
  assert.ok(s.monthly.length >= 120, `expected ≥120 monthly rows, got ${s.monthly.length}`);
  assert.ok(s.fno.length >= 18, `expected ≥18 F&O rows, got ${s.fno.length}`);
  assert.equal(s.meta.unit, "₹ Crore");
});

test("baseline daily rows are sorted, unique, and all trading days", () => {
  const d = NSE.staticHistory().daily;
  const seen = new Set();
  for (let i = 0; i < d.length; i++) {
    assert.match(d[i].date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(!seen.has(d[i].date), `duplicate date ${d[i].date}`);
    seen.add(d[i].date);
    assert.ok(NSE.isTradingDay(d[i].date), `${d[i].date} is a ${dow(d[i].date)} — not a trading day`);
    if (i) assert.ok(d[i - 1].date < d[i].date, `out of order at ${d[i].date}`);
  }
});

test("baseline monthly rows are sorted, unique and well-formed", () => {
  const m = NSE.staticHistory().monthly;
  const seen = new Set();
  for (let i = 0; i < m.length; i++) {
    assert.match(m[i].month, /^\d{4}-(0[1-9]|1[0-2])$/);
    assert.ok(!seen.has(m[i].month), `duplicate month ${m[i].month}`);
    seen.add(m[i].month);
    if (i) assert.ok(m[i - 1].month < m[i].month, `out of order at ${m[i].month}`);
  }
});

test("gross purchase minus gross sales equals the published net, every row", () => {
  for (const d of NSE.staticHistory().daily) {
    if (d.fiiBuy != null && d.fiiSell != null) assert.ok(near(d.fiiBuy - d.fiiSell, d.fiiNet, 0.02), `FII ${d.date}: ${d.fiiBuy} − ${d.fiiSell} ≠ ${d.fiiNet}`);
    if (d.diiBuy != null && d.diiSell != null) assert.ok(near(d.diiBuy - d.diiSell, d.diiNet, 0.02), `DII ${d.date}: ${d.diiBuy} − ${d.diiSell} ≠ ${d.diiNet}`);
  }
  for (const m of NSE.staticHistory().monthly) {
    if (m.fiiBuy != null && m.fiiSell != null) assert.ok(near(m.fiiBuy - m.fiiSell, m.fiiNet, 0.05), `FII ${m.month}`);
    if (m.diiBuy != null && m.diiSell != null) assert.ok(near(m.diiBuy - m.diiSell, m.diiNet, 0.05), `DII ${m.month}`);
  }
});

test("daily sessions reconcile to the published monthly total for June 2026", () => {
  // The workbook's own verification note states Jun 2026 = FII −49,028.6 cr,
  // DII +85,800.1 cr. Summing our parsed daily rows must reproduce it.
  const d = NSE.staticHistory().daily.filter((x) => x.date.startsWith("2026-06"));
  const pub = NSE.staticHistory().monthly.find((x) => x.month === "2026-06");
  assert.ok(d.length > 15 && pub, "June 2026 daily rows and monthly row must both exist");
  const fii = d.reduce((s, x) => s + x.fiiNet, 0);
  const dii = d.reduce((s, x) => s + x.diiNet, 0);
  assert.ok(near(fii, pub.fiiNet, 0.5), `FII Σ${fii.toFixed(2)} vs published ${pub.fiiNet}`);
  assert.ok(near(dii, pub.diiNet, 0.5), `DII Σ${dii.toFixed(2)} vs published ${pub.diiNet}`);
});

test("the documented July archive gap is recorded, not silently filled", () => {
  const meta = NSE.staticHistory().meta;
  assert.ok(Array.isArray(meta.monthlyGaps), "monthlyGaps must be present");
  // The source archive publishes no July row for 2016-2025.
  for (let y = 2016; y <= 2025; y++) {
    assert.ok(meta.monthlyGaps.includes(`${y}-07`), `${y}-07 should be listed as a gap`);
  }
  const months = new Set(NSE.staticHistory().monthly.map((m) => m.month));
  for (const g of meta.monthlyGaps) assert.ok(!months.has(g), `${g} is listed as a gap but present in the series`);
});

/* ══════════════════════════════════════════════════════════════════════════
   MERGE + AGGREGATION
   ══════════════════════════════════════════════════════════════════════════ */

test("mergedDaily is sorted, unique and free of weekend rows", () => {
  const d = NSE.mergedDaily();
  assert.ok(d.length >= NSE.staticHistory().daily.length, "merge must never lose baseline rows");
  const seen = new Set();
  for (let i = 0; i < d.length; i++) {
    assert.ok(!seen.has(d[i].date), `duplicate ${d[i].date}`);
    seen.add(d[i].date);
    assert.ok(NSE.isTradingDay(d[i].date), `${d[i].date} (${dow(d[i].date)}) survived the trading-day filter`);
    if (i) assert.ok(d[i - 1].date < d[i].date);
  }
});

test("the archive wins over live capture on overlapping dates", () => {
  // Baseline rows carry gross buy/sell; a live-only row does not. Every date
  // present in the baseline must therefore still expose its gross figures.
  const base = new Map(NSE.staticHistory().daily.map((d) => [d.date, d]));
  for (const m of NSE.mergedDaily()) {
    const b = base.get(m.date);
    if (!b) continue;
    assert.equal(m.fiiNet, b.fiiNet, `${m.date} FII net was overwritten by live capture`);
    assert.equal(m.diiNet, b.diiNet, `${m.date} DII net was overwritten by live capture`);
    assert.ok(m.fiiBuy != null, `${m.date} lost its gross figures in the merge`);
    assert.ok(!m.live, `${m.date} should be flagged as archive, not live`);
  }
});

test("weekly buckets are Monday-anchored and sum their own daily rows", () => {
  const daily = NSE.mergedDaily();
  const weekly = NSE.weeklyFrom(daily);
  assert.ok(weekly.length >= 8, `expected ≥8 weeks, got ${weekly.length}`);
  let sessions = 0;
  for (const w of weekly) {
    assert.equal(dow(w.start), "Mon", `${w.start} should be a Monday`);
    assert.equal(dow(w.end), "Fri", `${w.end} should be a Friday`);
    assert.equal(w.partial, w.sessions < 5);
    sessions += w.sessions;
    const rows = daily.filter((d) => d.date >= w.start && d.date <= w.end);
    assert.equal(rows.length, w.sessions, `${w.start}: session count mismatch`);
    assert.ok(near(rows.reduce((s, r) => s + r.fiiNet, 0), w.fiiNet, 0.05), `${w.start}: FII sum`);
    assert.ok(near(rows.reduce((s, r) => s + r.diiNet, 0), w.diiNet, 0.05), `${w.start}: DII sum`);
  }
  assert.equal(sessions, daily.length, "every session must land in exactly one week");
});

test("weekly totals reproduce the workbook's own weekly sheet", () => {
  // Week of 20-24 Jul 2026 per Weekly_Cash_2026: FII −7,182.08, DII +8,637.58.
  const w = NSE.weeklyFrom(NSE.mergedDaily()).find((x) => x.start === "2026-07-20");
  assert.ok(w, "week starting 2026-07-20 should exist");
  assert.equal(w.sessions, 5);
  assert.ok(near(w.fiiNet, -7182.08, 0.05), `FII ${w.fiiNet}`);
  assert.ok(near(w.diiNet, 8637.58, 0.05), `DII ${w.diiNet}`);
});

test("monthly keeps the archive and computes only the uncovered current month", () => {
  const monthly = NSE.monthlyFrom(NSE.mergedDaily());
  const archive = NSE.staticHistory().monthly;
  assert.ok(monthly.length >= archive.length, "archive months must all survive");
  for (const a of archive) {
    const m = monthly.find((x) => x.month === a.month);
    assert.ok(m, `${a.month} missing from the monthly series`);
    assert.equal(m.source, "archive");
    assert.equal(m.fiiNet, a.fiiNet, `${a.month} was overwritten by a daily rollup`);
  }
  const mtd = monthly.filter((m) => m.source === "month-to-date");
  for (const m of mtd) {
    assert.ok(!archive.some((a) => a.month === m.month), `${m.month} should not be month-to-date — it is in the archive`);
    assert.ok(m.sessions > 0, `${m.month} month-to-date needs a session count`);
  }
});

test("month-to-date matches the workbook's stated July 2026 figures", () => {
  // README verification: Jul MTD FII −11,729.0 cr, DII +29,711.5 cr.
  const jul = NSE.monthlyFrom(NSE.mergedDaily()).find((m) => m.month === "2026-07");
  assert.ok(jul, "July 2026 should be present as month-to-date");
  assert.equal(jul.source, "month-to-date");
  assert.ok(near(jul.fiiNet, -11729.0, 1), `FII MTD ${jul.fiiNet}`);
  assert.ok(near(jul.diiNet, 29711.5, 1), `DII MTD ${jul.diiNet}`);
});

test("yearly rolls up monthly and flags the eleven-month years honestly", () => {
  const monthly = NSE.monthlyFrom(NSE.mergedDaily());
  const yearly = NSE.yearlyFrom(monthly);
  assert.ok(yearly.length >= 11);
  for (const y of yearly) {
    const rows = monthly.filter((m) => m.month.startsWith(y.year));
    assert.equal(y.months, rows.length);
    assert.equal(y.partial, rows.length < 12);
    assert.ok(near(rows.reduce((s, r) => s + r.fiiNet, 0), y.fiiNet, 0.1), `${y.year} FII`);
    assert.ok(near(rows.reduce((s, r) => s + r.diiNet, 0), y.diiNet, 0.1), `${y.year} DII`);
  }
  // 2016-2025 lose July to the archive gap, so each must carry exactly 11 months
  for (let n = 2016; n <= 2025; n++) {
    const y = yearly.find((x) => x.year === String(n));
    assert.ok(y, `${n} missing`);
    assert.equal(y.months, 11, `${n} should have 11 months (July absent from the archive)`);
    assert.equal(y.partial, true);
  }
});

test("fiiSeries exposes all four granularities plus provenance", () => {
  const s = NSE.fiiSeries();
  for (const k of ["daily", "weekly", "monthly", "yearly", "fno", "meta"]) assert.ok(s[k], `missing ${k}`);
  assert.ok(s.daily.length > 0 && s.weekly.length > 0 && s.monthly.length > 100 && s.yearly.length > 10);
  assert.ok(s.meta.source && s.meta.sourceUrl, "provenance must travel with the data");
  assert.ok(Array.isArray(s.meta.caveats) && s.meta.caveats.length >= 3, "caveats must be shipped, not dropped");
});

test("windows and extras accept the merged {fiiNet,diiNet} shape", () => {
  const daily = NSE.mergedDaily();
  // the workbook-reconciled figure below is the baseline's final week; the
  // merged series also carries committed live captures after that date
  const baseLatest = require("../data-static/fiidii-history.json").meta.latest;
  const w = NSE.fiiWindows(daily.filter((d) => d.date <= baseLatest));
  assert.equal(w.d5.n, 5);
  assert.equal(w.d5.complete, true);
  assert.ok(Number.isFinite(w.d5.fii) && Number.isFinite(w.d20.fii), "windows must compute over the baseline");
  // 5-day window == the final full week of the workbook
  assert.ok(near(w.d5.fii, -7182.08, 0.05), `5d FII ${w.d5.fii}`);

  const x = NSE.fiiExtras(daily);
  assert.ok(x.largestFiiDay && x.largestFiiDay.date, "largest FII day must be identified");
  const maxAbs = Math.max(...daily.map((d) => Math.abs(d.fiiNet)));
  assert.ok(near(Math.abs(x.largestFiiDay.fii), maxAbs, 0.01), "largest day must really be the largest");
});

test("windows still accept the legacy stored {fii,dii} shape", () => {
  const legacy = [
    { date: "2026-07-20", fii: 1, dii: 2 }, { date: "2026-07-21", fii: 1, dii: 2 },
    { date: "2026-07-22", fii: 1, dii: 2 }, { date: "2026-07-23", fii: 1, dii: 2 },
    { date: "2026-07-24", fii: 1, dii: 2 },
  ];
  const w = NSE.fiiWindows(legacy);
  assert.equal(w.d5.fii, 5);
  assert.equal(w.d5.dii, 10);
});
