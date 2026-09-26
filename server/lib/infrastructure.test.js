/**
 * MERIDIAN — infrastructure test suite (datastore · durable cache · validation).
 * Run: npm test — uses temp dirs via MERIDIAN_DATA_DIR / MERIDIAN_SNAP_DIR so
 * the real server/data is never touched.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// isolate BEFORE requiring the modules (they read env at import time)
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mrd-test-"));
process.env.MERIDIAN_DATA_DIR = path.join(TMP, "data");
process.env.MERIDIAN_SNAP_DIR = path.join(TMP, "snapshots");
delete process.env.FIREBASE_SERVICE_ACCOUNT; // force file backend

const DS = require("./datastore");
const { cachedDurable } = require("../cache");
const V = require("./validate");

/* ═══════════════ datastore — file backend ═══════════════ */
test("datastore: set/get/list/delete round trip on the file backend", async () => {
  await DS.init();
  assert.equal(DS.backend(), "file");
  DS.setBlob("payments", { payments: [{ id: "p1", amount_inr: 500 }], total_inr: 500 });
  DS.setBlob("userdata/user-123", { meridian_watchlist: [{ symbol: "RELIANCE.NS" }] });

  assert.equal(DS.getBlob("payments").total_inr, 500);
  assert.equal(DS.getBlob("userdata/user-123").meridian_watchlist[0].symbol, "RELIANCE.NS");
  assert.equal(DS.getBlob("missing", "fallback"), "fallback");
  assert.deepEqual(DS.listBlobs("userdata/"), ["userdata/user-123"]);

  // files land in the legacy-identical layout
  assert.ok(fs.existsSync(path.join(TMP, "data", "payments.json")), "payments.json on disk");
  assert.ok(fs.existsSync(path.join(TMP, "data", "userdata", "user-123.json")), "userdata/<sub>.json on disk");

  DS.deleteBlob("payments");
  assert.equal(DS.getBlob("payments", null), null);
  assert.ok(!fs.existsSync(path.join(TMP, "data", "payments.json")), "file removed on delete");
});

/* ═══════════════ durable cache — stale-on-error ═══════════════ */
test("cachedDurable: serves the last-good snapshot, flagged stale, when upstream fails", async () => {
  let calls = 0;
  const good = () => { calls++; return Promise.resolve({ price: 2900, symbol: "T.NS" }); };
  const bad = () => { calls++; return Promise.reject(new Error("upstream down")); };

  const key = "q:TEST-STALE";
  const first = await cachedDurable(key, 1, good);       // 1ms TTL → expires immediately
  assert.equal(first.price, 2900);
  await new Promise((r) => setTimeout(r, 10));

  const second = await cachedDurable(key, 1, bad);       // upstream fails → snapshot serves
  assert.equal(second.price, 2900, "last-good value served");
  assert.equal(second.stale, true, "flagged stale");
  assert.ok(Number.isFinite(second.staleAsOf), "carries snapshot timestamp");
  assert.equal(calls, 2);
});

test("cachedDurable: with no snapshot the upstream error propagates", async () => {
  await assert.rejects(
    () => cachedDurable("q:NEVER-SEEN", 1, () => Promise.reject(new Error("boom"))),
    /boom/
  );
});

/* ═══════════════ validation layer ═══════════════ */
test("validate: quote coercion, consistency repair and garbage clamping", () => {
  const q = V.sanitizeQuote({
    symbol: "X.NS", price: "2450.5", prevClose: 2400,
    change: 999, changePct: 999,          // inconsistent — must be recomputed
    dayHigh: -5, spark: [1, NaN, null, 2, -1, 3],
  });
  assert.equal(q.price, 2450.5, "string price coerced");
  assert.ok(Math.abs(q.change - 50.5) < 1e-9, "change recomputed from price/prevClose");
  assert.ok(Math.abs(q.changePct - (50.5 / 2400) * 100) < 1e-9, "changePct recomputed");
  assert.equal(q.dayHigh, null, "negative high rejected");
  assert.deepEqual(q.spark, [1, 2, 3], "spark filtered to positive finite values");

  const junk = V.sanitizeQuote({ symbol: "Y.NS", price: 100, prevClose: 1 }); // +9900% print
  assert.equal(junk.changePct, null, "pathological move clamped to null");
});

test("validate: history points — bounds repaired, garbage dropped, timestamps monotonic", () => {
  const pts = V.sanitizeHistoryPoints([
    { t: 1000, o: 100, h: 99, l: 98, c: 101 },     // h < max(o,c) but trivially fixable → repaired
    { t: 2000, o: 100, h: 105, l: 95, c: 102 },    // clean → accepted
    { t: 1500, o: 100, h: 105, l: 95, c: 102 },    // behind last ACCEPTED candle (2000) → dropped
    { t: 2500, o: 100, h: 40, l: 98, c: 101 },     // h wildly incoherent (>50% violation) → dropped
    { t: 3000, o: null, h: null, l: null, c: 110, v: -5 }, // repaired from close; bad volume nulled
    { t: 4000, o: 100, h: 105, l: 95, c: null },   // no close → dropped
  ]);
  assert.equal(pts.length, 3, "three valid candles survive");
  assert.equal(pts[0].h, 101, "high repaired to max(o,c)");
  assert.equal(pts[2].o, 110, "missing open backfilled from close");
  assert.equal(pts[2].v, null, "negative volume nulled");
  assert.deepEqual(pts.map((p) => p.t), [1000, 2000, 3000], "strictly monotonic timestamps");
});
