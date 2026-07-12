/**
 * MERIDIAN — payments store
 *
 * File-backed, atomic, idempotent store for successful Razorpay contributions.
 * Feeds the /api/support/goal endpoint (which powers the Community Goal widget
 * on the landing page).
 *
 * On Render's free tier the filesystem is ephemeral — writes are lost on
 * redeploy. To survive redeploys, either:
 *   (a) configure a Razorpay webhook pointing at /api/support/webhook (the
 *       webhook will re-deliver undelivered events), or
 *   (b) keep the JSON in an external persistent volume / KV store.
 *
 * Shape of payments.json:
 *   {
 *     "payments": [{ "id": "pay_ABC", "amount_inr": 99, "ts": 1783422000000,
 *                    "src": "webhook" | "verify", "email": "…" | null }],
 *     "total_inr": 99,
 *     "count": 1,
 *     "updated_at": 1783422000000
 *   }
 */

/* Persistence flows through the datastore abstraction (identical local file,
 * data/payments.json, atomic write). */
const DS = require("./datastore");

const EMPTY = () => ({ payments: [], total_inr: 0, count: 0, updated_at: 0 });

/* Read the current state (never throws — returns EMPTY on any failure). */
function read() {
  const parsed = DS.getBlob("payments", null);
  if (!parsed || !Array.isArray(parsed.payments)) return EMPTY();
  return {
    payments: parsed.payments,
    total_inr: Number(parsed.total_inr) || 0,
    count: parsed.payments.length,
    updated_at: Number(parsed.updated_at) || 0,
  };
}

/* Durable write (memory + atomic local file + queued Firestore flush). */
function writeAtomic(state) {
  DS.setBlob("payments", state);
}

/**
 * Record a successful captured payment. Idempotent — a payment with an id
 * that's already recorded is a no-op. Returns the resulting summary.
 *
 * @param {{id: string, amount_inr: number, src: string, email?: string}} p
 */
function recordPayment(p) {
  if (!p || !p.id || typeof p.amount_inr !== "number" || p.amount_inr <= 0) {
    return { ok: false, reason: "invalid payment payload" };
  }
  const state = read();
  if (state.payments.some((x) => x.id === p.id)) {
    return { ok: true, deduped: true, total_inr: state.total_inr, count: state.count };
  }
  const record = {
    id: String(p.id),
    amount_inr: Math.round(p.amount_inr * 100) / 100,
    ts: Date.now(),
    src: p.src || "verify",
    email: p.email || null,
  };
  state.payments.push(record);
  state.total_inr = Math.round((state.total_inr + record.amount_inr) * 100) / 100;
  state.count = state.payments.length;
  state.updated_at = record.ts;
  writeAtomic(state);
  return { ok: true, deduped: false, total_inr: state.total_inr, count: state.count };
}

/* Summary for the goal widget — never includes raw payment records. */
function summary() {
  const s = read();
  return {
    raised_inr: s.total_inr,
    count: s.count,
    updated_at: s.updated_at,
  };
}

module.exports = { read, recordPayment, summary };
