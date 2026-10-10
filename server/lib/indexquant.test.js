/**
 * Index Analyser engines: levels, probabilities, forecasts, scenarios, regime, option chain,
 * participant OI. Checked against closed-form answers where they exist.
 * Run: npm test
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const Q = require("./indexquant");
const OC = require("./optionchain");
const PT = require("./participants");

/* deterministic 5-minute sessions (09:15–15:30 IST) with a random walk */
function sessions(nDays = 40, seed = 3, vol = 0.0012) {
  let a = seed >>> 0, px = 20000;
  const r = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = []; let day = Date.UTC(2026, 6, 1);
  for (let d = 0; d < nDays; d++) {
    while ([0, 6].includes(new Date(day).getUTCDay())) day += 86400e3;
    const open = day + (3 * 60 + 45) * 60e3;            // 09:15 IST in UTC
    for (let k = 0; k < 75; k++) {
      const z = Math.sqrt(-2 * Math.log(Math.max(r(), 1e-12))) * Math.cos(2 * Math.PI * r());
      const o = px; px *= 1 + vol * z;
      out.push({ t: open + k * 300e3, o, h: Math.max(o, px) * 1.0003, l: Math.min(o, px) * 0.9997, c: px });
    }
    day += 86400e3;
  }
  return out;
}

test("pivots: classic formulas from the previous session's high / low / close", () => {
  const p = Q.pivotSet(110, 90, 100).classic;
  assert.equal(p.P, 100); assert.equal(p.R1, 110); assert.equal(p.S1, 90); assert.equal(p.R2, 120); assert.equal(p.S2, 80);
  const lv = Q.levels({ last: 101, prevDay: { h: 110, l: 90, c: 100 } });
  assert.ok(lv.every((l, i) => i === 0 || lv[i - 1].price >= l.price), "sorted high → low");
  assert.equal(lv.find((l) => l.key === "R1").kind, "resistance");
  assert.equal(lv.find((l) => l.key === "S1").kind, "support");
});

test("touch probability: certain at the price, symmetric without drift, falls with distance, rises with volatility", () => {
  assert.equal(Q.touchProb(100, 100, 0, 0.01), 1);
  const up = Q.touchProb(100, 101, 0, 0.01), dn = Q.touchProb(100, 1 / 1.01 * 100, 0, 0.01);
  assert.ok(Math.abs(up - dn) < 1e-9, "driftless: equal log distances are equally likely");
  // reflection principle: P(max ≥ a) = 2·(1 − Φ(a/σ)) without drift
  assert.ok(Math.abs(up - 2 * (1 - Q.Phi(Math.log(1.01) / 0.01))) < 1e-9);
  assert.ok(Q.touchProb(100, 102, 0, 0.01) < up);
  assert.ok(Q.touchProb(100, 101, 0, 0.02) > up);
  assert.ok(Q.touchProb(100, 101, 0.005, 0.01) > up, "positive drift makes the upside more likely");
});

test("forecast: six models, ordered quantiles, probabilities in range, band widens with horizon", () => {
  const b5 = sessions(40);
  const day = Q.dayKey(b5[b5.length - 1].t), today = b5.filter((x) => Q.dayKey(x.t) === day).slice(0, 40);
  const hist = b5.filter((x) => Q.dayKey(x.t) < day), all = [...hist, ...today];
  const fitted = Q.fit(hist);
  const m = Q.minuteOfDay(today[today.length - 1].t);
  const fc = Q.forecast({ last: today[today.length - 1].c, b1today: today, barMin: 5, b5: all, fitted, minuteNow: m, twapNow: Q.twap(today) });
  assert.ok(fc && fc.ensemble.steps.length >= 3);
  assert.equal(Object.keys(fc.models).length, Q.MODELS.length);
  for (const s of fc.ensemble.steps) {
    assert.ok(s.q.every((v, i) => i === 0 || s.q[i - 1] <= v), "quantiles ordered");
    assert.ok(s.pUp >= 0 && s.pUp <= 1);
  }
  const w = (s) => s.q[4] - s.q[0], st = fc.ensemble.steps;
  assert.ok(w(st[st.length - 1]) > w(st[0]), "the cone widens");
  assert.ok(fc.sessionAnalogs && fc.sessionAnalogs.analogs.length >= 6, "session analogs found");
});

test("session analogs: an exact copy of a past session is its nearest analog", () => {
  const b5 = sessions(30, 9);
  const days = [...new Set(b5.map((x) => Q.dayKey(x.t)))];
  const src = b5.filter((x) => Q.dayKey(x.t) === days[10]), prevSrc = b5.filter((x) => Q.dayKey(x.t) === days[9]);
  const lastDay = days[days.length - 1], prevLast = b5.filter((x) => Q.dayKey(x.t) === days[days.length - 2]);
  const scale = prevLast[prevLast.length - 1].c / prevSrc[prevSrc.length - 1].c;   // same returns vs the previous close
  const copy = src.slice(0, 30).map((x, k) => { const t = b5.find((y) => Q.dayKey(y.t) === lastDay).t + k * 300e3; return { t, o: x.o * scale, h: x.h * scale, l: x.l * scale, c: x.c * scale }; });
  const series = [...b5.filter((x) => Q.dayKey(x.t) !== lastDay), ...copy];
  const sa = Q.sessionAnalogs(series, lastDay, 5);
  assert.equal(sa.analogs[0].day, days[10]);
  assert.ok(sa.analogs[0].dist < 1e-10);
});

test("scenarios: bull + base + bear = 1; triggers come from the level map", () => {
  const steps = [{ h: 30, q: [99, 99.5, 100, 100.5, 101] }, { h: 60, q: [98.6, 99.3, 100.1, 100.8, 101.5] }];
  const lv = [{ key: "R1", label: "R1", price: 100.4 }, { key: "R2", label: "R2", price: 101.2 }, { key: "S1", label: "S1", price: 99.6 }, { key: "S2", label: "S2", price: 98.9 }];
  const sc = Q.scenarios(100, steps, lv, { atr: 0.2 });
  assert.ok(Math.abs(sc.bull.p + sc.base.p + sc.bear.p - 1) < 1e-9);
  assert.equal(sc.bull.trigger.price, 100.4); assert.equal(sc.bear.trigger.price, 99.6);
  assert.equal(sc.bull.invalidation.price, 99.6);
  assert.equal(sc.bull.path.length, steps.length);
});

test("regime: score bounded 0–100, bullish inputs score above 50, closed market never suggests trading", () => {
  const tech = { twap: 100, twapDistPct: 0.4, emaStack: 1, rsi: 66, macdHist: 1, adx: 30, atrPct: 0.1 };
  const r = Q.regime({ tech, mtf: { alignment: 0.8, bull: 6, bear: 0, total: 7 }, orb: { h: 99, l: 98 }, last: 101, breadth: { adRatio: 2.5, advancers: 40, decliners: 10 }, sectors: [{ changePct: 1 }, { changePct: 0.5 }], vix: { price: 12, changePct: -3 }, open: true });
  assert.ok(r.score > 60 && r.score <= 100); assert.equal(r.label, "Bullish trend"); assert.equal(r.suits.key, "bull");
  assert.ok(Object.values(r.pillars).every((v) => v == null || (v >= 0 && v <= 100)));
  const c = Q.regime({ tech, open: false }); assert.equal(c.suits.key, "closed");
});

test("option chain: PCR, max pain, walls, build-up readings and Greeks from an NSE-shaped payload", () => {
  const row = (k, ceOi, peOi, ceChg, peChg, ceDp, peDp) => ({ strikePrice: k, expiryDates: "15-Dec-2099",
    CE: { openInterest: ceOi, changeinOpenInterest: ceChg, totalTradedVolume: 100, impliedVolatility: 12, lastPrice: Math.max(1, 22500 - k + 100), change: ceDp, underlyingValue: 22500 },
    PE: { openInterest: peOi, changeinOpenInterest: peChg, totalTradedVolume: 100, impliedVolatility: 12, lastPrice: Math.max(1, k - 22500 + 100), change: peDp, underlyingValue: 22500 } });
  const j = { records: { underlyingValue: 22500, timestamp: "now", data: [row(22300, 50, 900, 10, 100, 5, -2), row(22400, 80, 700, -5, 50, 3, 1), row(22500, 300, 400, 20, -10, -1, -3), row(22600, 600, 90, 60, 5, -4, 2), row(22700, 800, 40, 30, -1, 2, -1)] } };
  const a = OC.analyse(j, "NIFTY", { now: Date.UTC(2099, 11, 1) });
  assert.equal(a.pcr, +(2130 / 1830).toFixed(2));
  assert.equal(a.callWall.strike, 22700); assert.equal(a.putWall.strike, 22300);
  assert.equal(a.atm, 22500);
  assert.ok([22300, 22400, 22500, 22600, 22700].includes(a.maxPain));
  assert.equal(OC.buildup(1, 10), "Long build-up"); assert.equal(OC.buildup(-1, 10), "Short build-up");
  assert.equal(OC.buildup(1, -10), "Short covering"); assert.equal(OC.buildup(-1, -10), "Long unwinding");
  const g = OC.greeks(22500, 22500, 7 / 365, 12, "CE"), gp = OC.greeks(22500, 22500, 7 / 365, 12, "PE");
  assert.ok(g.delta > 0.45 && g.delta < 0.6); assert.ok(gp.delta < -0.4 && gp.delta > -0.55);
  assert.ok(Math.abs(g.delta - gp.delta - 1) < 0.01, "put-call delta parity");
  assert.ok(g.theta < 0 && g.vega > 0);
});

test("participant OI: NSE CSV → long share and net positions per participant", () => {
  const csv = `"Participant wise Open Interest (no. of contracts) in Equity Derivatives as on Oct 09, 2026",,,,
Client Type,Future Index Long,Future Index Short,Future Stock Long,Future Stock Short       ,Option Index Call Long,Option Index Put Long,Option Index Call Short,Option Index Put Short,Option Stock Call Long,Option Stock Put Long,Option Stock Call Short,Option Stock Put Short,Total Long Contracts      ,Total Short Contracts
Client,291627,62104,3402919,185348,3396080,3418874,3337345,4049875,2104606,822867,1206045,1081989,13436973,9922706
FII,34943,328931,3542863,2867395,600034,1245164,946852,704672,197429,316370,347630,186717,5936804,5382197
TOTAL,438669,438669,8068916,8068916,5404257,6021463,5404257,6021463,3230698,2194137,3230698,2194137,25358140,25358140`;
  const p = PT.parse(csv);
  assert.equal(p.asOf, "Oct 09, 2026");
  assert.equal(p.rows.FII.futLong, 34943); assert.equal(p.rows.FII.futNet, 34943 - 328931);
  assert.equal(p.rows.FII.futLongPct, Math.round((34943 / (34943 + 328931)) * 1000) / 10);
  assert.ok(!p.rows.TOTAL, "the total row is not a participant");
});
