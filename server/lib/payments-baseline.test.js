/**
 * Community-goal baseline tests.
 *
 * The contract these lock down:
 *   · SUPPORT_SEED_INR / SUPPORT_SEED_USER are a FLOOR that live payments add
 *     on top of — never a cap, and never a max() that hides real contributions.
 *   · Raising either value takes effect immediately and cannot double-count.
 *   · A store seeded by an older build keeps exactly the figures it had.
 *
 * Run: npm test
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Point the datastore at a scratch dir BEFORE anything requires it.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-goal-"));
process.env.MERIDIAN_DATA_DIR = TMP;

const DS = require("./datastore");
const store = require("./payments-store");

const ENV_INR = "SUPPORT_SEED_INR";
const ENV_USER = "SUPPORT_SEED_USER";

/** Reset store + env between cases so ordering can never matter. */
function reset({ inr, users, payments } = {}) {
  inr == null ? delete process.env[ENV_INR] : (process.env[ENV_INR] = String(inr));
  users == null ? delete process.env[ENV_USER] : (process.env[ENV_USER] = String(users));
  if (payments) {
    const total = payments.reduce((n, p) => n + (Number(p.amount_inr) || 0), 0);
    DS.setBlob("payments", { payments, total_inr: Math.round(total * 100) / 100, count: payments.length, updated_at: Date.now() });
  } else {
    DS.deleteBlob("payments");
  }
}
const pay = (id, amt, src = "verify") => ({ id, amount_inr: amt, ts: Date.now(), src, email: null });

test.before(async () => { await DS.init(); });
test.after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} });

/* ══════════════════════════════════════════════════════════════════════════
   BASELINE ALONE
   ══════════════════════════════════════════════════════════════════════════ */

test("with no env and no payments the widget reads zero", () => {
  reset();
  const s = store.summary();
  assert.equal(s.raised_inr, 0);
  assert.equal(s.count, 0);
  assert.equal(s.contributions, 0);
});

test("SUPPORT_SEED_USER alone sets the supporter floor", () => {
  reset({ users: 42 });
  const s = store.summary();
  assert.equal(s.count, 42);
  assert.equal(s.raised_inr, 0, "a supporter count must not invent money");
  assert.equal(s.baseline.count, 42);
});

test("SUPPORT_SEED_INR alone sets the amount floor", () => {
  reset({ inr: 8500 });
  const s = store.summary();
  assert.equal(s.raised_inr, 8500);
  assert.equal(s.count, 0, "an amount must not invent supporters");
});

test("both vars together set both floors", () => {
  reset({ inr: 8500, users: 42 });
  const s = store.summary();
  assert.equal(s.raised_inr, 8500);
  assert.equal(s.count, 42);
  assert.deepEqual(s.baseline, { raised_inr: 8500, count: 42 });
});

/* ══════════════════════════════════════════════════════════════════════════
   LIVE PAYMENTS ADD ON TOP  (the whole point — a max() floor would fail these)
   ══════════════════════════════════════════════════════════════════════════ */

test("a live payment increments BOTH figures above the baseline", () => {
  reset({ inr: 8500, users: 42, payments: [] });
  store.recordPayment({ id: "pay_1", amount_inr: 99, src: "verify" });
  const s = store.summary();
  assert.equal(s.raised_inr, 8599, "₹99 must be added to the ₹8500 baseline");
  assert.equal(s.count, 43, "the supporter count must tick to 43, not stay at 42");
  assert.equal(s.contributions, 1);
});

test("the very first real supporter is visible even when the floor is large", () => {
  // A max()-style floor would show 500 here and silently swallow the payment.
  reset({ inr: 100000, users: 500, payments: [] });
  store.recordPayment({ id: "pay_solo", amount_inr: 10, src: "verify" });
  const s = store.summary();
  assert.equal(s.count, 501);
  assert.equal(s.raised_inr, 100010);
});

test("many payments accumulate on the baseline", () => {
  reset({ inr: 1000, users: 10, payments: [] });
  for (let i = 1; i <= 5; i++) store.recordPayment({ id: `pay_${i}`, amount_inr: 100, src: "verify" });
  const s = store.summary();
  assert.equal(s.raised_inr, 1500);
  assert.equal(s.count, 15);
  assert.equal(s.contributions, 5);
});

test("duplicate payment ids are deduped and do not inflate the count", () => {
  reset({ users: 10, payments: [] });
  store.recordPayment({ id: "pay_dup", amount_inr: 50, src: "verify" });
  const again = store.recordPayment({ id: "pay_dup", amount_inr: 50, src: "webhook" });
  assert.equal(again.deduped, true);
  const s = store.summary();
  assert.equal(s.count, 11);
  assert.equal(s.contributions, 1);
});

test("the displayed figures never fall below the configured floor", () => {
  reset({ inr: 5000, users: 25, payments: [pay("p1", 10), pay("p2", 20)] });
  const s = store.summary();
  assert.ok(s.raised_inr >= 5000, `raised ${s.raised_inr} dropped below the floor`);
  assert.ok(s.count >= 25, `count ${s.count} dropped below the floor`);
});

/* ══════════════════════════════════════════════════════════════════════════
   RAISING THE BASELINE LATER
   ══════════════════════════════════════════════════════════════════════════ */

test("raising the env takes effect immediately without double-counting", () => {
  reset({ inr: 1000, users: 10, payments: [pay("p1", 250)] });
  assert.equal(store.summary().count, 11);
  assert.equal(store.summary().raised_inr, 1250);

  process.env[ENV_USER] = "60";           // operator bumps the numbers
  process.env[ENV_INR] = "5000";
  const s = store.summary();
  assert.equal(s.count, 61, "new floor + the one real payment");
  assert.equal(s.raised_inr, 5250, "new floor + ₹250 — the old floor must not linger");
});

test("lowering the env lowers the floor but keeps every real payment", () => {
  reset({ inr: 5000, users: 60, payments: [pay("p1", 250)] });
  process.env[ENV_INR] = "1000";
  process.env[ENV_USER] = "10";
  const s = store.summary();
  assert.equal(s.count, 11);
  assert.equal(s.raised_inr, 1250);
  assert.equal(s.contributions, 1, "real payments survive a baseline change");
});

/* ══════════════════════════════════════════════════════════════════════════
   INVALID INPUT
   ══════════════════════════════════════════════════════════════════════════ */

test("junk env values are ignored rather than corrupting the widget", () => {
  for (const bad of ["abc", "", "   ", "-5", "NaN"]) {
    reset({ inr: bad, users: bad, payments: [pay("p1", 100)] });
    const s = store.summary();
    assert.equal(s.raised_inr, 100, `SUPPORT_SEED_INR="${bad}" should be ignored`);
    assert.equal(s.count, 1, `SUPPORT_SEED_USER="${bad}" should be ignored`);
  }
});

test("a fractional supporter count is rounded to whole people", () => {
  reset({ users: "12.6", payments: [] });
  assert.equal(store.summary().count, 13);
});

test("a fractional rupee baseline keeps two decimals", () => {
  reset({ inr: "1000.559", payments: [] });
  assert.equal(store.summary().raised_inr, 1000.56);
});

/* ══════════════════════════════════════════════════════════════════════════
   BACKWARD COMPATIBILITY WITH THE OLD SEED RECORD
   ══════════════════════════════════════════════════════════════════════════ */

test("a store seeded by an older build keeps its figures when the env is unset", () => {
  reset({ payments: [{ id: "seed:baseline", amount_inr: 8500, ts: Date.now(), src: "seed", email: null }] });
  const s = store.summary();
  assert.equal(s.raised_inr, 8500, "legacy seed amount must be honoured");
  assert.equal(s.count, 1, "legacy seed counted as one supporter, as before");
  assert.equal(s.contributions, 0, "it was never a real payment");
});

test("the env baseline replaces a legacy seed record instead of stacking on it", () => {
  reset({
    inr: 9000, users: 50,
    payments: [{ id: "seed:baseline", amount_inr: 8500, ts: Date.now(), src: "seed", email: null }, pay("p1", 100)],
  });
  const s = store.summary();
  assert.equal(s.raised_inr, 9100, "must be 9000 + 100, NOT 9000 + 8500 + 100");
  assert.equal(s.count, 51, "must be 50 + 1 real, NOT 50 + 1 seed + 1 real");
});

test("seedFromEnv retires the legacy record once the env supplies both halves", () => {
  reset({
    inr: 9000, users: 50,
    payments: [{ id: "seed:baseline", amount_inr: 8500, ts: Date.now(), src: "seed", email: null }, pay("p1", 100)],
  });
  const before = store.summary();
  store.seedFromEnv();
  const raw = DS.getBlob("payments");
  assert.ok(!raw.payments.some((p) => p.src === "seed"), "legacy record should be gone");
  assert.equal(raw.payments.length, 1, "the genuine payment must survive");
  const after = store.summary();
  assert.deepEqual(
    { r: after.raised_inr, c: after.count },
    { r: before.raised_inr, c: before.count },
    "retiring the record must not change what the widget displays"
  );
});

test("seedFromEnv leaves the legacy record alone when the env is unset", () => {
  reset({ payments: [{ id: "seed:baseline", amount_inr: 8500, ts: Date.now(), src: "seed", email: null }] });
  store.seedFromEnv();
  const raw = DS.getBlob("payments");
  assert.ok(raw.payments.some((p) => p.src === "seed"), "nothing configured — do not destroy existing data");
  assert.equal(store.summary().raised_inr, 8500);
});

test("seedFromEnv is safe to call repeatedly", () => {
  reset({ inr: 2000, users: 20, payments: [pay("p1", 100)] });
  const first = store.summary();
  store.seedFromEnv(); store.seedFromEnv(); store.seedFromEnv();
  const after = store.summary();
  assert.deepEqual({ r: after.raised_inr, c: after.count }, { r: first.raised_inr, c: first.count });
});

/* ══════════════════════════════════════════════════════════════════════════
   THE PUBLIC PAYLOAD MUST NOT LEAK OPERATIONAL DETAIL
   ══════════════════════════════════════════════════════════════════════════ */

test("summary never exposes raw payment records", () => {
  reset({ inr: 1000, users: 10, payments: [pay("pay_secret", 500, "verify")] });
  const s = store.summary();
  const json = JSON.stringify(s);
  assert.ok(!json.includes("pay_secret"), "payment ids must not travel to the client");
  assert.ok(!("payments" in s), "the record array must not be part of the summary");
});
