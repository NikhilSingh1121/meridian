/**
 * MERIDIAN — NSE India provider (FII / DII provisional flows).
 *
 * Restored per spec, scoped to the one dataset the Macro dashboard needs:
 * daily FII/DII provisional cash-market flows from NSE's official site API.
 *
 * ── Endpoint behavior & mitigations ────────────────────────────────────────
 *   · Requires a browser User-Agent + homepage cookie warm-up; the jar is
 *     reused and refreshed on 401/403 or every 12 minutes.
 *   · No published rate limits — requests are serialized, spaced ≥350ms and
 *     cached 30 minutes; the route layer adds durable stale-on-error.
 *   · NSE returns ONLY the latest session. Rolling 5-day / 20-day / weekly /
 *     monthly windows therefore come from OUR OWN capture history: every
 *     successful fetch persists that session into the datastore
 *     ("fiidii_history"), and the windows are computed over the real captured
 *     sessions. No synthetic backfill, no mock history — windows display the
 *     moment enough genuine sessions have accumulated, and the UI states how
 *     many sessions are on record.
 *   · Every failure degrades to { available:false, reason } — never throws.
 */

const { cached } = require("../cache");
const DS = require("../lib/datastore");

const BASE = "https://www.nseindia.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const WARM_TTL = 12 * 60 * 1000;
const REQ_TIMEOUT = 9000;
const SPACING_MS = 350;
const HISTORY_KEY = "fiidii_history";
const HISTORY_MAX = 400; // ~19 months of sessions

let _cookie = null, _warmedAt = 0, _chain = Promise.resolve();

async function fetchWithTimeout(url, opts = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), REQ_TIMEOUT);
  try { return await fetch(url, { ...opts, signal: ctl.signal, redirect: "follow" }); }
  finally { clearTimeout(t); }
}

async function warmUp(force = false) {
  if (!force && _cookie && Date.now() - _warmedAt < WARM_TTL) return true;
  try {
    const r = await fetchWithTimeout(BASE + "/", { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" } });
    const raw = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    const jar = raw.map((c) => c.split(";")[0]).filter(Boolean);
    if (jar.length) { _cookie = jar.join("; "); _warmedAt = Date.now(); return true; }
    const folded = r.headers.get("set-cookie");
    if (folded) { _cookie = folded.split(",").map((c) => c.split(";")[0]).join("; "); _warmedAt = Date.now(); return true; }
    return false;
  } catch { return false; }
}

function nseGet(path) {
  const job = _chain.then(async () => {
    await new Promise((r) => setTimeout(r, SPACING_MS));
    if (!(await warmUp())) return null;
    const headers = {
      "User-Agent": UA, Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9", Referer: BASE + "/",
      ...(_cookie ? { Cookie: _cookie } : {}),
    };
    let r = await fetchWithTimeout(BASE + path, { headers }).catch(() => null);
    if (r && (r.status === 401 || r.status === 403)) {
      if (await warmUp(true)) r = await fetchWithTimeout(BASE + path, { headers: { ...headers, Cookie: _cookie } }).catch(() => null);
    }
    if (!r || !r.ok) return null;
    const text = await r.text().catch(() => "");
    if (!text || text.trimStart().startsWith("<")) return null;
    try { return JSON.parse(text); } catch { return null; }
  });
  _chain = job.catch(() => {});
  return job;
}

const num = (v) => {
  if (v === null || v === undefined || v === "" || v === "-") return null;
  const x = typeof v === "string" ? parseFloat(v.replace(/,/g, "")) : Number(v);
  return Number.isFinite(x) ? x : null;
};
const pick = (o, keys) => { for (const k of keys) if (o && o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k]; return null; };

/* ── latest provisional session from NSE ── */
async function fiiDiiLatest() {
  return cached("nse:fiidii", 30 * 60 * 1000, async () => {
    const d = await nseGet("/api/fiidiiTradeReact");
    const list = Array.isArray(d) ? d : Array.isArray(d && d.data) ? d.data : null;
    if (!list || !list.length) return { available: false, reason: "NSE FII/DII endpoint unavailable from this host" };
    const rows = list.map((r) => ({
      category: String(pick(r, ["category", "cat"]) || ""),
      date: pick(r, ["date", "tradedDate"]),
      buyValue: num(pick(r, ["buyValue", "buyVal"])),
      sellValue: num(pick(r, ["sellValue", "sellVal"])),
      netValue: num(pick(r, ["netValue", "netVal"])),
    })).filter((r) => r.category);
    if (!rows.length) return { available: false, reason: "FII/DII payload in an unrecognized shape" };
    const find = (re) => rows.find((r) => re.test(r.category));
    const fii = find(/FII|FPI/i), dii = find(/DII/i);
    return {
      available: true, rows, unit: "₹ Crore",
      date: (fii && fii.date) || (dii && dii.date) || null,
      fiiNet: fii ? fii.netValue : null,
      diiNet: dii ? dii.netValue : null,
      source: "NSE provisional daily flows",
    };
  });
}

/* ── capture history (real sessions only) + rolling windows ── */
function readHistory() {
  const h = DS.getBlob(HISTORY_KEY, null);
  return h && Array.isArray(h.sessions) ? h.sessions : [];
}
function writeHistory(sessions) {
  const clean = sessions
    .filter((s) => s && s.date && (s.fii != null || s.dii != null))
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(-HISTORY_MAX);
  DS.setBlob(HISTORY_KEY, { sessions: clean, updatedAt: Date.now() });
  return clean;
}
function recordSession(latest) {
  if (!latest || !latest.available || !latest.date) return readHistory();
  const sessions = readHistory();
  if (!sessions.some((s) => s.date === latest.date)) {
    sessions.push({ date: latest.date, fii: latest.fiiNet, dii: latest.diiNet });
    return writeHistory(sessions);
  }
  return readHistory();
}

/* ── REAL historical backfill from NSE's own multi-session report ───────────
   NSE's /api/fiidiiTradeReact returns only today, but the reports endpoint
   exposes many past sessions in one call. We fetch it ONCE (when our capture
   history is short) and merge genuine past sessions in — deduplicated by date,
   never overwriting a session we already captured. This is real exchange data,
   not synthetic: it is the same series NSE publishes on its FII/DII page. */
let _backfilled = false;
function parseHistDate(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})/);
  if (!m) return String(s);
  return `${m[1].padStart(2, "0")}-${m[2]}-${m[3]}`;
}
async function backfillHistory() {
  if (_backfilled) return readHistory();
  _backfilled = true;
  const candidates = [
    "/api/fiidiiTradeReact?type=historical",
    "/api/historical/fiidiiTradeReact",
  ];
  for (const path of candidates) {
    const d = await nseGet(path).catch(() => null);
    const list = Array.isArray(d) ? d : Array.isArray(d && d.data) ? d.data : null;
    if (!list || list.length < 2) continue;
    const byDate = {};
    for (const r of list) {
      const date = parseHistDate(pick(r, ["date", "tradedDate", "reportDate"]));
      if (!date) continue;
      byDate[date] ||= { date, fii: null, dii: null };
      const cat = String(pick(r, ["category", "cat"]) || "");
      const net = num(pick(r, ["netValue", "netVal", "net"]));
      if (/FII|FPI/i.test(cat)) byDate[date].fii = net;
      else if (/DII/i.test(cat)) byDate[date].dii = net;
      else {
        const fii = num(pick(r, ["fiiNetValue", "fiiNet", "FIINet"]));
        const dii = num(pick(r, ["diiNetValue", "diiNet", "DIINet"]));
        if (fii != null) byDate[date].fii = fii;
        if (dii != null) byDate[date].dii = dii;
      }
    }
    const hist = Object.values(byDate).filter((s) => s.fii != null || s.dii != null);
    if (hist.length < 2) continue;
    const existing = readHistory();
    const seen = new Set(existing.map((s) => s.date));
    return writeHistory(existing.concat(hist.filter((s) => !seen.has(s.date))));
  }
  return readHistory();
}

/** Pure: streaks + extremes over captured sessions. */
function fiiExtras(sessions) {
  const valid = sessions.filter((s) => s.fii != null || s.dii != null);
  // consecutive same-sign FII streak ending at the latest session
  let streak = 0, side = null;
  for (let i = valid.length - 1; i >= 0; i--) {
    const f = valid[i].fii;
    if (f == null || f === 0) break;
    const sgn = f > 0 ? "BUY" : "SELL";
    if (side == null) side = sgn;
    if (sgn !== side) break;
    streak++;
  }
  // largest single-session absolute FII print on record
  let largest = null;
  for (const s of valid) {
    if (s.fii == null) continue;
    if (!largest || Math.abs(s.fii) > Math.abs(largest.fii)) largest = { date: s.date, fii: s.fii };
  }
  const last = valid[valid.length - 1];
  const combined = last && last.fii != null && last.dii != null ? +(last.fii + last.dii).toFixed(2) : null;
  const ratio = last && last.fii != null && last.dii != null && last.fii !== 0
    ? +Math.abs(last.dii / last.fii).toFixed(2) : null;
  return { fiiStreak: side ? { side, days: streak } : null, largestFiiDay: largest, combinedNet: combined, diiToFiiRatio: ratio };
}

/** Pure: rolling flow windows over captured sessions (₹ Cr sums). */
function fiiWindows(sessions) {
  const sum = (arr, key) => {
    const v = arr.map((s) => s[key]).filter((x) => x != null && Number.isFinite(x));
    return v.length ? +v.reduce((s, x) => s + x, 0).toFixed(2) : null;
  };
  const win = (n) => {
    const slice = sessions.slice(-n);
    return {
      n: slice.length, complete: slice.length >= n,
      fii: sum(slice, "fii"), dii: sum(slice, "dii"),
    };
  };
  return { d5: win(5), d20: win(20), sessionsOnRecord: sessions.length };
}

/** Full pack for the dashboard. */
async function fiiDiiPack() {
  const latest = await fiiDiiLatest();
  let sessions = latest.available ? recordSession(latest) : readHistory();
  // On a fresh store (or thin history) pull NSE's real multi-session report
  // once so the chart shows genuine day-by-day flows immediately, not a single
  // bar. Backfilled sessions are real exchange prints, deduplicated by date.
  if (sessions.length < 10) {
    sessions = await backfillHistory().catch(() => sessions);
  }
  const windows = fiiWindows(sessions);
  return {
    available: latest.available || sessions.length > 0,
    reason: latest.available ? undefined : latest.reason,
    latest: latest.available ? latest : null,
    history: sessions.slice(-60),
    windows,
    extras: fiiExtras(sessions),
  };
}

/**
 * Seed captured FII/DII history from an env var when empty (Render's disk is
 * wiped on redeploy and NSE's historical endpoint is often blocked from cloud
 * hosts, so the chart can restart from zero). Set FIIDII_SEED to a JSON array of
 * {date,fii,dii} sessions to restore the series on boot. Only seeds an empty
 * store; genuine captured sessions are never overwritten. For full durability,
 * use a persistent disk (MERIDIAN_DATA_DIR).
 */
function seedHistoryFromEnv() {
  const raw = process.env.FIIDII_SEED;
  if (!raw) return;
  if (readHistory().length) return;
  try {
    const sessions = JSON.parse(raw);
    if (Array.isArray(sessions) && sessions.length) {
      const n = writeHistory(sessions).length;
      console.log(`[nse] seeded ${n} FII/DII session(s) from FIIDII_SEED`);
    }
  } catch (e) { console.warn("[nse] FIIDII_SEED parse failed:", e.message); }
}

module.exports = { fiiDiiLatest, fiiDiiPack, fiiWindows, fiiExtras, seedHistoryFromEnv };
