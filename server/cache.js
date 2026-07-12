/** Tiny in-memory TTL cache. Keeps upstream API calls low and pages fast. */
const store = new Map();

function get(key) {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    store.delete(key);
    return null;
  }
  return hit.value;
}

function set(key, value, ttlMs) {
  store.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}

/** Wrap an async producer with caching. */
async function cached(key, ttlMs, producer) {
  const hit = get(key);
  if (hit !== null) return hit;
  const value = await producer();
  return set(key, value, ttlMs);
}

/* ════════════════════════════════════════════════════════════════════════════
   DURABLE SNAPSHOT LAYER — stale-on-error.
   Same contract as cached(), plus: every successful production is snapshotted
   to disk, and when the producer FAILS (Yahoo hiccup, rate-limit, DNS) the
   last-good snapshot is served — flagged { stale:true, staleAsOf } — instead
   of surfacing an error. A provider outage degrades the terminal to "slightly
   old numbers, clearly labelled" rather than "dead panels".
   Snapshots are cache, not user data: local-disk only, best-effort, and the
   directory is safe to wipe at any time.
   ════════════════════════════════════════════════════════════════════════════ */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const SNAP_DIR = process.env.MERIDIAN_SNAP_DIR || path.join(__dirname, "data", "snapshots");

function snapFile(key) {
  return path.join(SNAP_DIR, crypto.createHash("sha1").update(key).digest("hex").slice(0, 24) + ".json");
}
function snapWrite(key, value) {
  try {
    fs.mkdirSync(SNAP_DIR, { recursive: true });
    const f = snapFile(key), tmp = f + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ key, ts: Date.now(), value }));
    fs.renameSync(tmp, f);
  } catch { /* best-effort */ }
}
function snapRead(key) {
  try {
    const s = JSON.parse(fs.readFileSync(snapFile(key), "utf8"));
    return s && s.key === key ? s : null;
  } catch { return null; }
}

async function cachedDurable(key, ttlMs, producer) {
  const hit = get(key);
  if (hit !== null) return hit;
  try {
    const value = await producer();
    snapWrite(key, value);
    return set(key, value, ttlMs);
  } catch (err) {
    const snap = snapRead(key);
    if (snap) {
      console.warn(`[cache] upstream failed for ${key} — serving snapshot from ${new Date(snap.ts).toISOString()}`);
      const v = snap.value;
      const flagged = v && typeof v === "object" && !Array.isArray(v)
        ? { ...v, stale: true, staleAsOf: snap.ts }
        : v;
      // short memory TTL so we retry upstream soon rather than pinning stale
      return set(key, flagged, Math.min(ttlMs, 30_000));
    }
    throw err;
  }
}

module.exports = { get, set, cached, cachedDurable };
