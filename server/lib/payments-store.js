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
 *   (b) keep the JSON in an external persistent volume / KV store, or
 *   (c) set the SUPPORT_SEED_INR / SUPPORT_SEED_USER baseline (see below) so
 *       the widget resumes from known figures instead of zero.
 *
 * The stored file holds GENUINE payments only. The env baseline is added when
 * summary() is read, so the two never mix and can never double-count.
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

/* ══════════════════════════════════════════════════════════════════════════
   ENV BASELINE
   Render's free tier wipes the disk on redeploy, so the widget would restart
   from zero. Two env vars supply a floor that live payments build ON TOP of:

     SUPPORT_SEED_INR   — ₹ already raised before this deploy
     SUPPORT_SEED_USER  — supporters already counted before this deploy

   The baseline is applied when the summary is READ, not written into the
   store. That means bumping either value in the dashboard takes effect on the
   next boot with no risk of double-counting, and every genuine payment still
   moves the number immediately (a floor implemented as max() would swallow
   the first N real contributions instead).
   ══════════════════════════════════════════════════════════════════════════ */

const SEED_ID = "seed:baseline";
/** Synthetic record written by older builds of seedFromEnv(). */
const isSeedRecord = (p) => !!p && (p.src === "seed" || p.id === SEED_ID);

const _warned = new Set();
function warnOnce(key, msg) {
  if (_warned.has(key)) return;
  _warned.add(key);
  console.warn(msg);
}

/** Parse an env var as a non-negative number; null when unset or unusable. */
function envNumber(name, { integer = false } = {}) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === "") return null;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 0) {
    warnOnce(name, `[payments] ${name}="${raw}" is not a non-negative number — expected e.g. ${integer ? "250" : "8500"}. Ignored.`);
    return null;
  }
  if (integer && !Number.isInteger(n)) {
    warnOnce(name, `[payments] ${name}="${raw}" must be a whole number of people — rounding to ${Math.round(n)}.`);
    return Math.round(n);
  }
  return integer ? n : Math.round(n * 100) / 100;
}

/**
 * The baseline in force right now.
 *
 * Falls back to any legacy `seed:baseline` record when the matching env var is
 * absent, so a deployment that was seeded by an older build keeps exactly the
 * numbers it had instead of silently losing them.
 */
function baseline(state = read()) {
  const legacy = state.payments.filter(isSeedRecord);
  const envInr = envNumber("SUPPORT_SEED_INR");
  const envUsers = envNumber("SUPPORT_SEED_USER", { integer: true });
  return {
    inr: envInr != null ? envInr : legacy.reduce((n, p) => n + (Number(p.amount_inr) || 0), 0),
    count: envUsers != null ? envUsers : legacy.length,
    fromEnv: { inr: envInr != null, count: envUsers != null },
  };
}

/* Summary for the goal widget — never includes raw payment records. */
function summary() {
  const s = read();
  // Genuine contributions only; the baseline is added separately so a legacy
  // seed record can never be counted twice.
  const real = s.payments.filter((p) => !isSeedRecord(p));
  const realInr = real.reduce((n, p) => n + (Number(p.amount_inr) || 0), 0);
  const base = baseline(s);
  return {
    raised_inr: Math.round((base.inr + realInr) * 100) / 100,
    count: base.count + real.length,
    contributions: real.length,   // real payments on this disk, for diagnostics
    baseline: { raised_inr: base.inr, count: base.count },
    updated_at: s.updated_at,
  };
}

/**
 * Report the configured baseline at boot and retire the synthetic record that
 * older builds used to write.
 *
 * Nothing is seeded into the store any more: summary() applies SUPPORT_SEED_INR
 * and SUPPORT_SEED_USER on every read. That removes the old "only seeds an
 * empty store" limitation — raising either number now takes effect on the next
 * boot even after contributions have landed, and can never double-count.
 *
 * For TRUE durability (keeping post-baseline contributions across redeploys)
 * use a persistent disk and point MERIDIAN_DATA_DIR at it.
 */
function seedFromEnv() {
  const s = read();
  const base = baseline(s);

  // Retire the legacy record once the env supplies both halves of the
  // baseline, so the stored file holds genuine payments only.
  if (base.fromEnv.inr && base.fromEnv.count && s.payments.some(isSeedRecord)) {
    const real = s.payments.filter((p) => !isSeedRecord(p));
    writeAtomic({
      payments: real,
      total_inr: Math.round(real.reduce((n, p) => n + (Number(p.amount_inr) || 0), 0) * 100) / 100,
      count: real.length,
      updated_at: s.updated_at || Date.now(),
    });
    console.log("[payments] retired the legacy seed record — the baseline now comes from the environment on every read");
  }

  if (base.inr > 0 || base.count > 0) {
    const src = (k) => (base.fromEnv[k] ? "env" : "legacy record");
    console.log(`[payments] community-goal baseline: ₹${base.inr} (${src("inr")}) · ${base.count} supporter(s) (${src("count")}) — live contributions add on top`);
  }
}

module.exports = { read, recordPayment, summary, seedFromEnv, baseline };
