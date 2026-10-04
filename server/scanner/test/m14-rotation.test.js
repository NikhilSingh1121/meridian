/* Sector rotation (RRG-style): quadrants follow relative trend and its momentum. */
const test = require("node:test");
const assert = require("node:assert/strict");
const RG = require("../../lib/rotation");

test("rotation: steady out-performer leads, steady under-performer lags, a recent turn shows as improving", () => {
  const N = 60, bench = Array.from({ length: N }, (_, t) => ({ t, c: 100 * (1 + 0.002 * t) }));
  const mk = (f) => Array.from({ length: N }, (_, t) => ({ t, c: bench[t].c * f(t) }));
  const accel = (t) => 1 + 0.0002 * t * t;                                  // out-performance that keeps accelerating
  const decel = (t) => 1 - 0.0002 * t * t;
  const turn = (t) => (t < 58 ? 1 - 0.008 * t : 1 - 0.008 * 58 + 0.02 * (t - 58));   // long decline, then a fresh up-turn (last 2 periods)
  const out = RG.compute(bench, [{ symbol: "A", name: "Accel", bars: mk(accel) }, { symbol: "D", name: "Decel", bars: mk(decel) }, { symbol: "T", name: "Turn", bars: mk(turn) }], { n: 10, tail: 8 });
  const q = Object.fromEntries(out.map((x) => [x.name, x]));
  assert.equal(q.Accel.quadrant, "Leading");
  assert.equal(q.Decel.quadrant, "Lagging");
  const tr = q.Turn.trail;
  assert.ok(tr.at(-1).y > 100, "momentum turned up");
  assert.ok(tr.at(-1).x > tr.at(-3).x && tr.at(-3).x < 100, "relative trend rising from the lagging side");
  assert.equal(q.Turn.quadrant, "Improving");
  assert.equal(q.Accel.trail.length, 8);
  assert.ok(q.Accel.rel4 > 0 && q.Decel.rel4 < 0);
});

test("rotation: too little history is reported, not guessed", () => {
  const bench = Array.from({ length: 12 }, (_, t) => ({ t, c: 100 + t }));
  const out = RG.compute(bench, [{ symbol: "X", name: "Short", bars: bench.map((b) => ({ ...b })) }], { n: 10 });
  assert.equal(out[0].error, "not enough history");
});
