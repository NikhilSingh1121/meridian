/**
 * MERIDIAN — support (Razorpay) route
 *
 *   POST /api/support/order    → creates a Razorpay Order, returns {order_id, key_id, amount, currency, enabled}
 *   POST /api/support/verify   → verifies checkout signature, records the payment
 *   POST /api/support/webhook  → receives Razorpay webhook, records the payment (idempotent w/ /verify)
 *   GET  /api/support/goal     → {raised_inr, target_inr, pct, count, updated_at, enabled}
 *
 * Env vars (all optional — when missing, endpoints degrade gracefully and
 * the frontend keeps its "Payments launching shortly" fallback):
 *   RAZORPAY_KEY_ID
 *   RAZORPAY_KEY_SECRET
 *   RAZORPAY_WEBHOOK_SECRET
 *   SUPPORT_GOAL_INR         (default 10000)
 *   SUPPORT_MIN_INR          (default 1)
 *   SUPPORT_MAX_INR          (default 100000 — guards against fat-finger amounts)
 */

const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const store = require("../lib/payments-store");

const KEY_ID = process.env.RAZORPAY_KEY_ID || "";
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || "";
const TARGET_INR = Number(process.env.SUPPORT_GOAL_INR) || 10000;
const MIN_INR = Number(process.env.SUPPORT_MIN_INR) || 1;
const MAX_INR = Number(process.env.SUPPORT_MAX_INR) || 100000;

const enabled = () => Boolean(KEY_ID && KEY_SECRET);

/* Basic auth header for Razorpay REST API. */
function basicAuth() {
  return "Basic " + Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
}

/* ─────────────────────────────────────────────────────────────────────────
   POST /api/support/order
   Creates a Razorpay Order for the given INR amount and returns the details
   the frontend needs to open Razorpay Checkout.
────────────────────────────────────────────────────────────────────────── */
router.post("/support/order", express.json({ limit: "4kb" }), async (req, res) => {
  if (!enabled()) {
    return res.status(503).json({ error: "Payments not configured", enabled: false });
  }
  const amount_inr = Number(req.body && req.body.amount_inr);
  if (!Number.isFinite(amount_inr) || amount_inr < MIN_INR || amount_inr > MAX_INR) {
    return res.status(400).json({ error: `Amount must be between ₹${MIN_INR} and ₹${MAX_INR}` });
  }
  const paise = Math.round(amount_inr * 100);
  const receipt = "meridian_" + Date.now().toString(36) + "_" + crypto.randomBytes(3).toString("hex");

  try {
    const rp = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { Authorization: basicAuth(), "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: paise,
        currency: "INR",
        receipt,
        notes: { source: "meridian_landing", tier: amount_inr === 99 ? "fixed" : "custom" },
      }),
    });
    if (!rp.ok) {
      const t = await rp.text();
      console.error("[support] razorpay order error", rp.status, t);
      return res.status(502).json({ error: "Order creation failed" });
    }
    const order = await rp.json();
    res.json({
      enabled: true,
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: KEY_ID,
    });
  } catch (e) {
    console.error("[support] order exception", e);
    res.status(500).json({ error: "Order creation failed" });
  }
});

/* ─────────────────────────────────────────────────────────────────────────
   POST /api/support/verify
   Called by the frontend after Razorpay Checkout succeeds. Verifies the
   signature (HMAC-SHA256 of "order_id|payment_id" using key secret) and
   records the payment.
────────────────────────────────────────────────────────────────────────── */
router.post("/support/verify", express.json({ limit: "4kb" }), (req, res) => {
  if (!enabled()) return res.status(503).json({ error: "Payments not configured" });
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, amount_inr, email } = req.body || {};
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: "Missing verification fields" });
  }
  const expected = crypto
    .createHmac("sha256", KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  const provided = Buffer.from(String(razorpay_signature), "utf8");
  const derived  = Buffer.from(expected, "utf8");
  if (provided.length !== derived.length || !crypto.timingSafeEqual(provided, derived)) {
    return res.status(400).json({ error: "Signature verification failed", verified: false });
  }

  const amt = Number(amount_inr);
  if (!Number.isFinite(amt) || amt < MIN_INR) {
    // Don't reject verification — payment succeeded — but log & skip recording.
    console.warn("[support] verified payment with bad amount_inr", { amount_inr });
    return res.json({ verified: true, recorded: false });
  }
  const result = store.recordPayment({
    id: razorpay_payment_id, amount_inr: amt, src: "verify",
    email: typeof email === "string" ? email.slice(0, 120) : null,
  });
  res.json({ verified: true, recorded: result.ok, deduped: !!result.deduped });
});

/* ─────────────────────────────────────────────────────────────────────────
   POST /api/support/webhook
   Razorpay webhook — subscribes to payment.captured. Verifies the webhook
   signature over the raw request body, then records the payment (idempotent
   with /verify). Uses express.raw so we can compute HMAC over the exact
   bytes Razorpay signed.
────────────────────────────────────────────────────────────────────────── */
router.post("/support/webhook",
  express.raw({ type: "application/json", limit: "64kb" }),
  (req, res) => {
    if (!WEBHOOK_SECRET) {
      // Refuse to process anything if no secret is configured — otherwise a
      // caller could POST fake events.
      return res.status(503).json({ error: "Webhook secret not configured" });
    }
    const sig = req.get("x-razorpay-signature") || "";
    const raw = req.body; // Buffer (from express.raw)
    if (!Buffer.isBuffer(raw) || !sig) {
      return res.status(400).json({ error: "Missing body or signature" });
    }
    const expected = crypto.createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");
    const a = Buffer.from(sig, "utf8"), b = Buffer.from(expected, "utf8");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(400).json({ error: "Bad signature" });
    }
    let payload;
    try { payload = JSON.parse(raw.toString("utf8")); }
    catch { return res.status(400).json({ error: "Bad JSON" }); }

    const event = payload && payload.event;
    const pay = payload && payload.payload && payload.payload.payment && payload.payload.payment.entity;

    if (event === "payment.captured" && pay && pay.id && typeof pay.amount === "number") {
      const amount_inr = pay.amount / 100;
      const email = (pay.email || (pay.notes && pay.notes.email) || null);
      store.recordPayment({ id: pay.id, amount_inr, src: "webhook", email });
    }
    // Always ack 200 so Razorpay doesn't retry indefinitely for events we
    // don't need to act on.
    res.json({ ok: true });
  }
);

/* ─────────────────────────────────────────────────────────────────────────
   GET /api/support/goal
   Current Community Goal state for the widget. Cached in-process for 5s so
   rapid polling from the landing page doesn't thrash disk.
────────────────────────────────────────────────────────────────────────── */
let goalCache = { at: 0, data: null };
router.get("/support/goal", (_req, res) => {
  const now = Date.now();
  if (!goalCache.data || now - goalCache.at > 5000) {
    const s = store.summary();
    const raised = Math.min(s.raised_inr, TARGET_INR * 10); // clamp defensively
    goalCache = {
      at: now,
      data: {
        enabled: enabled(),
        raised_inr: s.raised_inr,
        target_inr: TARGET_INR,
        pct: TARGET_INR > 0 ? Math.min(100, (raised / TARGET_INR) * 100) : 0,
        count: s.count,
        updated_at: s.updated_at,
      },
    };
  }
  res.set("Cache-Control", "public, max-age=5");
  res.json(goalCache.data);
});

module.exports = router;
