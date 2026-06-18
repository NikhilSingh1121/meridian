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

module.exports = { get, set, cached };
