/* ════════════════════════════════════════════════════════════════════════
   MERIDIAN · USER STORE  (loads FIRST, before any module)
   Transparently mirrors browser localStorage `meridian_*` keys (portfolios,
   active portfolio, column prefs) to the signed-in user's server storage.

   · Patches Storage.setItem/removeItem so every write to a meridian_* key
     debounce-syncs the full snapshot to /api/userdata (only when signed in).
   · On boot: checks /api/auth/me; if signed in, pulls the server snapshot and
     hydrates localStorage BEFORE the app reads it (bootTerminal awaits ready).
   · hydrate/clearLocal use the *native* methods so they never re-trigger sync.
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  const PREFIX = "meridian_";
  const SYNC_URL = "/api/userdata";
  const DEBOUNCE = 700;

  let authed = false;
  let suppress = false;   // true while hydrating/clearing → don't echo back to server
  let timer = null;

  const nativeSet = Storage.prototype.setItem;
  const nativeRemove = Storage.prototype.removeItem;
  const LS = () => window.localStorage;

  function meridianKeys() {
    const ls = LS(), out = [];
    for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k && k.indexOf(PREFIX) === 0) out.push(k); }
    return out;
  }
  function snapshot() {
    const ls = LS(), map = {};
    meridianKeys().forEach((k) => { map[k] = ls.getItem(k); });
    return map;
  }
  function queueSync() {
    if (!authed || suppress) return;
    clearTimeout(timer);
    timer = setTimeout(pushNow, DEBOUNCE);
  }
  async function pushNow() {
    if (!authed) return;
    clearTimeout(timer); timer = null;
    try {
      await fetch(SYNC_URL, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: snapshot() }),
      });
    } catch { /* offline / transient — next write retries */ }
  }

  /* patch writes (reads are untouched — modules read hydrated values normally) */
  Storage.prototype.setItem = function (k, v) {
    nativeSet.call(this, k, v);
    try { if (this === window.localStorage && typeof k === "string" && k.indexOf(PREFIX) === 0) queueSync(); } catch { }
  };
  Storage.prototype.removeItem = function (k) {
    nativeRemove.call(this, k);
    try { if (this === window.localStorage && typeof k === "string" && k.indexOf(PREFIX) === 0) queueSync(); } catch { }
  };

  function hydrate(map) {
    suppress = true;
    try {
      meridianKeys().forEach((k) => nativeRemove.call(LS(), k));
      if (map && typeof map === "object") {
        Object.keys(map).forEach((k) => { if (k.indexOf(PREFIX) === 0 && typeof map[k] === "string") nativeSet.call(LS(), k, map[k]); });
      }
    } finally { suppress = false; }
  }
  function clearLocal() {
    suppress = true;
    try { meridianKeys().forEach((k) => nativeRemove.call(LS(), k)); } finally { suppress = false; }
  }

  let resolveReady;
  const ready = new Promise((r) => (resolveReady = r));

  async function init() {
    try {
      const r = await fetch("/api/auth/me", { headers: { accept: "application/json" } });
      const j = await r.json();
      if (j && j.user) {
        authed = true;
        window.MERIDIAN_USER = j.user;
        try {
          const rd = await fetch(SYNC_URL);
          if (rd.ok) { const dj = await rd.json(); hydrate(dj.data || {}); }
        } catch { /* keep whatever is local */ }
      } else {
        authed = false;
        window.MERIDIAN_USER = null;
      }
    } catch {
      authed = false;
    }
    resolveReady();
  }

  window.MSTORE = {
    ready,
    get authed() { return authed; },
    get user() { return window.MERIDIAN_USER || null; },
    setAuthed(v) { authed = !!v; },
    hydrate, clearLocal, pushNow, snapshot,
    refresh: init,        // re-run auth check + hydrate (used right after sign-in)
  };

  init();
})();
