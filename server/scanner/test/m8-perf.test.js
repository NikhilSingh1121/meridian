/* Milestone 8 — wire efficiency: per-client field deltas; explicit universes. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { SsePush } = require("../push/sse");

test("SSE delta mode: first frame full, then only changed fields per client", () => {
  const push = new SsePush();
  const rows = new Map(); let seq = 0;
  const set = (r) => rows.set(r.s, { ...r, _seq: ++seq });
  const src = { rowsSince: (sq) => ({ rows: [...rows.values()].filter((r) => r._seq > sq), seq }), eventsSince: (e) => ({ events: [], seq: e }) };
  set({ s: "A", ltp: 10, pct: 1, sec: "X", spark: [1, 2] }); set({ s: "B", ltp: 20, pct: 2, sec: "X", spark: [3] });
  const res = { chunks: [], set() { }, write(x) { this.chunks.push(x); return true; }, flushHeaders() { }, end() { } };
  push.attach({ on() { } }, res, { every: 1, delta: true });
  push.pump(1000, src);
  set({ s: "A", ltp: 11, pct: 1, sec: "X", spark: [1, 2] });                 // only ltp changed
  push.pump(2000, src);
  set({ s: "A", ltp: 11, pct: 1.5, sec: "X", spark: [1, 2, 3] });
  push.pump(3000, src);
  const f = res.chunks.filter((c) => c.startsWith("event: frame")).map((c) => JSON.parse(c.split("data: ")[1]));
  assert.equal(f[0].full, true); assert.equal(f[0].rows.length, 2); assert.ok(f[0].rows[0].sec);
  assert.equal(f[1].delta, true); assert.deepEqual(f[1].rows, [{ ltp: 11, s: "A" }]);
  assert.deepEqual(f[2].rows, [{ pct: 1.5, spark: [1, 2, 3], s: "A" }]);
});
