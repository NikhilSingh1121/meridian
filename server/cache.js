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

/* Concurrent misses for the same key share one upstream call instead of each
   hitting the provider (15s polling from many tabs lands on the same keys). */
const inflight = new Map();
function once(key, fn) {
  if (inflight.has(key)) return inflight.get(key);
  const p = Promise.resolve().then(fn).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Wrap an async producer with caching. */
async function cached(key, ttlMs, producer) {
  const hit = get(key);
  if (hit !== null) return hit;
  return once(key, async () => set(key, await producer(), ttlMs));
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
    return await once(key, async () => {
      const value = await producer();
      snapWrite(key, value);
      return set(key, value, ttlMs);
    });
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

/* ── housekeeping ─────────────────────────────────────────────────────────
   Memory: expired entries are otherwise only dropped when re-read, so keys
   nobody asks for again (one-off tickers, old sessions) would live forever.
   Hourly sweep drops them; nothing live is affected (quotes are 15s).
   Disk: once every 24h, snapshots not refreshed in the last 24h are deleted —
   the fallback set stays limited to what users actually look at. */
const DAY = 24 * 60 * 60 * 1000;
function sweepMemory() {
  const now = Date.now();
  for (const [k, v] of store) if (now > v.expires) store.delete(k);
}
function sweepSnapshots() {
  let files = [];
  try { files = fs.readdirSync(SNAP_DIR); } catch { return; }
  const cutoff = Date.now() - DAY;
  for (const f of files) {
    const p = path.join(SNAP_DIR, f);
    try { if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p); } catch { }
  }
}
setInterval(sweepMemory, 60 * 60 * 1000).unref();
setInterval(sweepSnapshots, DAY).unref();
sweepSnapshots(); // boot: drop anything left over from long-idle periods

module.exports = { get, set, cached, cachedDurable, sweepMemory, sweepSnapshots };
