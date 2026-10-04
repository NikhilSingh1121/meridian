const test = require("node:test");
const assert = require("node:assert/strict");

const fresh = () => { delete require.cache[require.resolve("./aiGovernor")]; return require("./aiGovernor"); };
const env = (o) => { for (const [k, v] of Object.entries(o)) { if (v == null) delete process.env[k]; else process.env[k] = String(v); } };

test("ai governor · kill switch refuses every call and reports AI unavailable", () => {
  env({ AI_ENABLED: "0", AI_DAILY_TOKENS: null, AI_DAILY_SEARCHES: null });
  const g = fresh();
  assert.deepEqual(g.allow(), { ok: false, reason: "ai_off" });
  assert.equal(g.status().available, false);
  env({ AI_ENABLED: null });
});

test("ai governor · daily token cap: calls run until the cap, then are refused", () => {
  env({ AI_ENABLED: null, AI_DAILY_TOKENS: "1000", AI_DAILY_SEARCHES: "5" });
  const g = fresh();
  const base = g.status().tokens;            // the datastore may hold today's usage already
  if (base >= 1000) return;                  // (never on a clean test run)
  assert.equal(g.allow().ok, true);
  g.record("report", 1000 - base);
  assert.deepEqual(g.allow(), { ok: false, reason: "budget" });
  assert.equal(g.status().available, false);
  assert.ok(g.status().byFeature.report.tokens >= 1000 - base);
  env({ AI_DAILY_TOKENS: null, AI_DAILY_SEARCHES: null });
});

test("ai governor · web-search cap applies only to calls that search", () => {
  env({ AI_ENABLED: null, AI_DAILY_TOKENS: "100000000", AI_DAILY_SEARCHES: "0" });
  const g = fresh();
  assert.equal(g.allow({ search: false }).ok, true);
  assert.deepEqual(g.allow({ search: true }), { ok: false, reason: "search_budget" });
  env({ AI_DAILY_TOKENS: null, AI_DAILY_SEARCHES: null });
});
