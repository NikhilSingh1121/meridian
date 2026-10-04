/* Upstream gateway: Yahoo calls are coalesced, micro-cached and stopped by the breaker after a 429. */
const test = require("node:test");
const assert = require("node:assert/strict");
let calls = [], status = 200;
globalThis.fetch = async (input) => { const url = typeof input === "string" ? input : input.url; calls.push(url); await new Promise((r) => setTimeout(r, 20)); return new Response(JSON.stringify({ url, n: calls.length }), { status, headers: { "content-type": "application/json" } }); };
const U = require("../../lib/upstream");
U.install();
const Q = "https://query1.finance.yahoo.com/v8/finance/chart/RELIANCE.NS?range=1d&interval=5m";

test("identical concurrent Yahoo requests share one upstream call; bodies are intact for every caller", async () => {
  U._test.reset(); calls = []; status = 200;
  const rs = await Promise.all(Array.from({ length: 5 }, () => fetch(Q).then((r) => r.json())));
  assert.equal(calls.length, 1);
  assert.ok(rs.every((j) => j.url === Q && j.n === 1));
  const st = U.status();
  assert.equal(st.yahoo.requests, 1); assert.equal(st.yahoo.coalesced, 4);
});

test("a repeat within the micro-cache window is answered without a call", async () => {
  U._test.reset(); calls = []; status = 200;
  await (await fetch(Q)).json(); const again = await (await fetch(Q)).json();
  assert.equal(calls.length, 1); assert.equal(again.n, 1);
  assert.equal(U.status().yahoo.cacheHits, 1);
});

test("429 opens the breaker: Yahoo calls fail fast (no upstream traffic), other hosts are untouched", async () => {
  U._test.reset(); calls = []; status = 429;
  const r = await fetch(Q.replace("RELIANCE", "TCS"));
  assert.equal(r.status, 429);
  const st = U.status(); assert.equal(st.breaker.open, true); assert.equal(st.breaker.trips, 1); assert.equal(st.breaker.nextBackoffSec, 60);
  status = 200; const before = calls.length;
  await assert.rejects(fetch(Q.replace("RELIANCE", "INFY")), (e) => e.code === "UPSTREAM_COOLDOWN");
  assert.equal(calls.length, before);
  const other = await fetch("https://www.nseindia.com/api/allIndices"); assert.equal(other.status, 200);
  assert.equal(calls.length, before + 1);
});

test("POST and crumb/cookie calls are never cached or shared", async () => {
  U._test.reset(); calls = []; status = 200;
  await Promise.all([fetch("https://query1.finance.yahoo.com/v1/test/getcrumb"), fetch("https://query1.finance.yahoo.com/v1/test/getcrumb")]);
  assert.equal(calls.length, 2);
  await fetch(Q, { method: "POST", body: "x" }); await fetch(Q, { method: "POST", body: "x" });
  assert.equal(calls.length, 4);
});
