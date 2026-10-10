/**
 * Upstream gateway — every outbound fetch goes through here (installed once in server/index.js).
 *
 * For Yahoo hosts (*.finance.yahoo.com, fc.yahoo.com) it enforces, without changing any refresh rate:
 *   · coalescing   identical GET URLs already in flight share one upstream request
 *   · micro-cache  identical GET URLs answered from the last response for a short window
 *                  (2 s for quotes/charts, 30 s for search, 5 s otherwise) — many panels and tabs
 *                  asking for the same thing in the same second cost one call
 *   · pacing       at most N requests in flight per host, queued in order (bursts are smoothed)
 *   · breakers     a 429 / 999 opens a circuit for 30 s, doubling to 10 min (session: 60 s → 20 min;
 *                  mint: 60 s → 15 min); while open, those Yahoo calls fail fast so callers serve their
 *                  cached / stale data instead of hammering an endpoint that is already limiting us.
 *                  Three independent circuits: MINT (getting a session token — getcrumb, fc.yahoo.com,
 *                  the finance.yahoo.com pages), SESSION (endpoints that need the token — company
 *                  summaries, v7 quotes, screener, sector pages) and DATA (charts, spark, search,
 *                  fundamentals time series, insights — none of these needs a token). Yahoo often
 *                  refuses only token minting from cloud IPs: a refused mint must not pause calls that
 *                  already hold a valid token, and nothing token-free is ever paused by it.
 * Everything (all hosts) is metered: requests, cache hits, coalesced, errors, bytes, per endpoint.
 * GET /api/upstream/status shows the meter and the breaker state.
 */
const YAHOO = /(^|\.)finance\.yahoo\.com$|^fc\.yahoo\.com$|(^|\.)yahoo\.com$/i;
const CONC = { default: 4 };
const TTL = (u) => (/\/v1\/finance\/search/.test(u.pathname) ? 30e3 : /\/v7\/finance\/quote|\/v8\/finance\/chart|\/v10\/finance\/quoteSummary|\/v11\/finance\/quoteSummary/.test(u.pathname) ? 2e3 : 5e3);
const MICRO_MAX = 400;

const meter = { since: Date.now(), hosts: {}, endpoints: {}, recent: [], perMin: {}, symbols: {} };
const inflight = new Map(), micro = new Map(), queues = new Map();
// mint = obtaining a session token; session = endpoints that need the token; data = everything else on Yahoo
// (fundamentals time series and insights answer without a token — verified — so they are data)
const SESSION_EP = /^\/v7\/finance\/quote|\/finance\/quoteSummary|\/finance\/screener|\/finance\/options|\/v1\/finance\/(sectors|industries)/;
const MINT_HOST = /^(fc|www|finance|guce|consent|login)\.yahoo\.com$/i;
const mk = (min, max) => ({ openUntil: 0, backoff: min, min, max, trips: 0, lastStatus: null, lastTripAt: 0 });
const breakers = { session: mk(60e3, 20 * 60e3), data: mk(30e3, 10 * 60e3), mint: mk(60e3, 15 * 60e3) };
const kindOf = (u) => (/getcrumb/.test(u.pathname) || MINT_HOST.test(u.hostname) ? "mint" : SESSION_EP.test(u.pathname) ? "session" : "data");
const breaker = breakers.data;   // legacy alias (status / tests)

const epKey = (u) => `${u.host}${u.pathname.replace(/\/[A-Za-z0-9^.=%&-]{1,30}(?=$|\?)/g, (m) => (/^\/(v\d+|finance|chart|quote|search|api|rss|content)$/i.test(m) ? m : "/:sym")).replace(/\/\d+/g, "/:n").slice(0, 60)}${/\/chart\//.test(u.pathname) ? ` [${u.searchParams.get("interval") || "?"}/${u.searchParams.get("range") || "?"}]` : ""}`;
function count(u, field, bytes) {
  const h = (meter.hosts[u.host] = meter.hosts[u.host] || { requests: 0, cacheHits: 0, coalesced: 0, errors: 0, blocked: 0, bytes: 0 });
  const e = (meter.endpoints[epKey(u)] = meter.endpoints[epKey(u)] || { requests: 0, cacheHits: 0, coalesced: 0, errors: 0, blocked: 0, bytes: 0 });
  h[field]++; e[field]++;
  if (bytes) { h.bytes += bytes; e.bytes += bytes; }
  if (field === "requests") { meter.recent.push(Date.now()); if (meter.recent.length > 20000) meter.recent.splice(0, 5000); if (YAHOO.test(u.hostname)) { const m = Math.floor(Date.now() / 60e3); meter.perMin[m] = (meter.perMin[m] || 0) + 1; const cm = /\/v8\/finance\/chart\/([^/?]+)/.exec(u.pathname); if (cm) { const k = decodeURIComponent(cm[1]); meter.symbols[k] = (meter.symbols[k] || 0) + 1; } } }
}
function slot(host) {
  let q = queues.get(host); if (!q) { q = { active: 0, wait: [] }; queues.set(host, q); }
  return new Promise((res) => { const go = () => { q.active++; res(() => { q.active--; const n = q.wait.shift(); if (n) n(); }); }; if (q.active < (CONC[host] || CONC.default)) go(); else q.wait.push(go); });
}
const clone = (r) => ({ status: r.status, statusText: r.statusText, headers: [...r.headers.entries()], body: r.body });
const rebuild = (c) => new Response(c.body, { status: c.status, statusText: c.statusText, headers: c.headers });

function install() {
  if (globalThis.fetch && globalThis.fetch.__upstream) return;
  const raw = globalThis.fetch.bind(globalThis);
  const wrapped = async (input, init = {}) => {
    let u; try { u = new URL(typeof input === "string" ? input : input.url); } catch { return raw(input, init); }
    const method = (init.method || (typeof input !== "string" && input.method) || "GET").toUpperCase();
    const isY = YAHOO.test(u.hostname);
    if (!isY) {
      count(u, "requests");
      try { const r = await raw(input, init); if (!r.ok) count(u, "errors"); return r; } catch (e) { count(u, "errors"); throw e; }
    }
    // circuit open → fail fast (callers fall back to cached / stale data)
    const kind = kindOf(u), br = breakers[kind];
    if (Date.now() < br.openUntil) { count(u, "blocked"); const e = new Error(`Yahoo rate-limit cool-down (${Math.ceil((br.openUntil - Date.now()) / 1000)} s left)`); e.code = "UPSTREAM_COOLDOWN"; throw e; }
    const cacheable = method === "GET" && !init.body && !/fc\.yahoo\.com|getcrumb/.test(u.href);
    const key = cacheable ? u.href : null;
    if (key) {
      const m = micro.get(key);
      if (m && Date.now() - m.at < TTL(u)) { count(u, "cacheHits"); return rebuild({ ...m.res, body: m.buf }); }
      if (inflight.has(key)) { count(u, "coalesced"); const c = await inflight.get(key); return rebuild({ ...c, body: c.buf }); }
    }
    const run = (async () => {
      const release = await slot(u.host);
      try {
        count(u, "requests");
        const r = await raw(input, init);
        if (r.status === 429 || r.status === 999) trip(r.status, kind);
        else if (r.ok && br.trips && Date.now() > br.openUntil) br.backoff = Math.max(br.min, br.backoff / 2);
        if (!r.ok) count(u, "errors");
        if (!key) return { passthrough: r };
        const buf = Buffer.from(await r.arrayBuffer());
        meter.hosts[u.host].bytes += buf.length; meter.endpoints[epKey(u)].bytes += buf.length;
        const c = { ...clone(r), buf };
        if (r.ok) { micro.set(key, { at: Date.now(), res: c, buf }); if (micro.size > MICRO_MAX) micro.delete(micro.keys().next().value); }
        return c;
      } catch (e) { count(u, "errors"); throw e; }
      finally { release(); }
    })();
    if (!key) { const x = await run; return x.passthrough; }
    inflight.set(key, run);
    try { const c = await run; return rebuild({ ...c, body: c.buf }); }
    finally { inflight.delete(key); }
  };
  wrapped.__upstream = true;
  globalThis.fetch = wrapped;
}
function trip(status, kind = "data") {
  const b = breakers[kind] || breakers.data;
  b.trips++; b.lastStatus = status; b.lastTripAt = Date.now();
  b.openUntil = Date.now() + b.backoff;
  b.backoff = Math.min(b.max, b.backoff * 2);
  console.warn(`[upstream] Yahoo answered ${status} (${kind}): pausing ${kind === "session" ? "token-gated calls (company summaries, v7 quotes, screener)" : kind === "mint" ? "session-token minting (calls already holding a token continue)" : "Yahoo data calls"} until ${new Date(b.openUntil).toISOString()}`);
}
/* is Yahoo's session (crumb) path cooling down? callers can skip crumb-gated work */
function sessionCooling() { return Date.now() < breakers.session.openUntil; }
/* background work (scanner warm-up) yields to people: ms until the data breaker closes, and the rolling Yahoo call rate */
function dataCoolingMs() { return Math.max(0, breakers.data.openUntil - Date.now()); }
function yahooPerMinuteNow() { const now = Date.now(), m = Math.floor(now / 60e3), f = (now % 60e3) / 60e3; return Math.round((meter.perMin[m] || 0) + (meter.perMin[m - 1] || 0) * (1 - f)); }
function status() {
  const now = Date.now(), perMin = meter.recent.filter((t) => now - t < 60e3).length;
  const ys = Object.entries(meter.hosts).filter(([h]) => YAHOO.test(h));
  const sum = (f) => ys.reduce((a, [, v]) => a + v[f], 0);
  return {
    since: meter.since, uptimeMin: +((now - meter.since) / 60e3).toFixed(1), requestsLastMinute: perMin,
    yahoo: { requests: sum("requests"), servedWithoutCall: sum("cacheHits") + sum("coalesced"), cacheHits: sum("cacheHits"), coalesced: sum("coalesced"), errors: sum("errors"), blockedByBreaker: sum("blocked"), bytes: sum("bytes") },
    session: { open: now < breakers.session.openUntil, secondsLeft: Math.max(0, Math.ceil((breakers.session.openUntil - now) / 1000)), trips: breakers.session.trips, lastStatus: breakers.session.lastStatus },
    mint: { open: now < breakers.mint.openUntil, secondsLeft: Math.max(0, Math.ceil((breakers.mint.openUntil - now) / 1000)), trips: breakers.mint.trips, lastStatus: breakers.mint.lastStatus },
    yahooSession: (() => { try { return require("../providers/fundamentals").sessionInfo(); } catch { return null; } })(),
    breaker: { open: now < breaker.openUntil, secondsLeft: Math.max(0, Math.ceil((breaker.openUntil - now) / 1000)), trips: breaker.trips, lastStatus: breaker.lastStatus, lastTripAt: breaker.lastTripAt || null, nextBackoffSec: breaker.backoff / 1000 },
    yahooPerMinute: Object.entries(meter.perMin).slice(-30).map(([m, n]) => ({ at: new Date(+m * 60e3).toISOString().slice(11, 16), n })),
    cacheExtended: (() => { try { return require("../cache").cacheStats.extended; } catch { return null; } })(),
    topSymbols: Object.entries(meter.symbols).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([s, n]) => ({ s, n })),
    hosts: meter.hosts,
    endpoints: Object.entries(meter.endpoints).sort((a, b) => b[1].requests - a[1].requests).slice(0, 40).map(([k, v]) => ({ endpoint: k, ...v })),
  };
}
const _test = { reset() { meter.since = Date.now(); meter.hosts = {}; meter.endpoints = {}; meter.recent = []; meter.perMin = {}; meter.symbols = {}; inflight.clear(); micro.clear(); queues.clear(); Object.assign(breakers.session, { openUntil: 0, backoff: breakers.session.min, trips: 0, lastStatus: null, lastTripAt: 0 }); Object.assign(breakers.mint, { openUntil: 0, backoff: breakers.mint.min, trips: 0, lastStatus: null, lastTripAt: 0 }); Object.assign(breaker, { openUntil: 0, backoff: 30e3, trips: 0, lastStatus: null, lastTripAt: 0 }); }, breaker };
module.exports = { install, status, trip, sessionCooling, dataCoolingMs, yahooPerMinuteNow, _test };
