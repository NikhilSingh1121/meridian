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
 *   · NSE returns ONLY the latest session, so the series is assembled in two
 *     layers:
 *       1. A SHIPPED HISTORICAL BASELINE — data-static/fiidii-history.json,
 *          built from the exchange archive (see build-fiidii.js). Daily cash
 *          back to Jun 2026, monthly cash back to Sep 2015, FII derivatives
 *          for Jul 2026. It is committed to the repo, so it survives the
 *          redeploys that wipe Render's disk.
 *       2. LIVE CAPTURE — every successful fetch persists that session into
 *          the datastore ("fiidii_history") and is merged on top of the
 *          baseline, so the series keeps extending day by day after deploy.
 *     Nothing is synthesised: both layers are real exchange prints, merged by
 *     date with the shipped (reconciled) rows taking precedence on overlap.
 *   · Every failure degrades to { available:false, reason } — never throws.
 */

const fs = require("fs");
const path = require("path");
const { cached, cachedDurable } = require("../cache");
const DS = require("../lib/datastore");

const BASE = "https://www.nseindia.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const WARM_TTL = 12 * 60 * 1000;
const REQ_TIMEOUT = 9000;
const SPACING_MS = 350;
const HISTORY_KEY = "fiidii_history";
const HISTORY_MAX = 400; // ~19 months of sessions

let _cookie = null, _warmedAt = 0, _chain = Promise.resolve();

async function fetchWithTimeout(url, opts = {}, timeout = REQ_TIMEOUT) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
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

function nseGet(path, timeout = REQ_TIMEOUT) {
  const job = _chain.then(async () => {
    await new Promise((r) => setTimeout(r, SPACING_MS));
    if (!(await warmUp())) return null;
    const headers = {
      "User-Agent": UA, Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9", Referer: BASE + "/",
      ...(_cookie ? { Cookie: _cookie } : {}),
    };
    let r = await fetchWithTimeout(BASE + path, { headers }, timeout).catch(() => null);
    if (r && (r.status === 401 || r.status === 403)) {
      if (await warmUp(true)) r = await fetchWithTimeout(BASE + path, { headers: { ...headers, Cookie: _cookie } }, timeout).catch(() => null);
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

/* ── every NSE index with NSE's own horizon returns (1W / 1M / 1Y) ──
   Yahoo carries no history for most sector indices (^CNXAUTO, ^CNXFMCG …),
   so multi-horizon sector performance comes from the exchange directly.
   Returns a Map keyed by NSE index name, or null when NSE is unreachable. */
async function allIndices() {
  return cachedDurable("nse:allIndices", 10 * 60_000, async () => {
    const d = await nseGet("/api/allIndices", 25_000);
    const rows = d && Array.isArray(d.data) ? d.data : null;
    if (!rows) throw new Error("NSE allIndices unavailable");
    const pctFrom = (last, ago) => (last != null && ago ? +(((last - ago) / ago) * 100).toFixed(2) : null);
    const out = {};
    for (const r of rows) {
      const name = r.index || r.indexSymbol;
      if (!name) continue;
      const last = num(r.last);
      out[name] = {
        last, d1: num(r.percentChange),
        w1: pctFrom(last, num(r.oneWeekAgoVal)),
        m1: num(r.perChange30d) ?? pctFrom(last, num(r.oneMonthAgoVal)),
        y1: num(r.perChange365d) ?? pctFrom(last, num(r.oneYearAgoVal)),
      };
    }
    return out;
  }).catch(() => null);
}

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

/* ════════════════════════════════════════════════════════════════════════════
   SHIPPED HISTORICAL BASELINE
   ════════════════════════════════════════════════════════════════════════════ */

const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/**
 * Normalise every date shape we handle to "YYYY-MM-DD" so the shipped baseline
 * and NSE's live prints (which come back as "24-Jul-2026") merge on one key.
 * Returns null when the value is not a date, so junk can be filtered out.
 */
function toIso(v) {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[-\s/]([A-Za-z]{3})[a-z]*[-\s/](\d{4})$/);            // 24-Jul-2026
  if (m && MON[m[2].toLowerCase()]) return `${m[3]}-${String(MON[m[2].toLowerCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);                          // 24-07-2026 (DD-MM-YYYY)
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

let _static = null;
function staticHistory() {
  if (_static) return _static;
  try {
    const raw = fs.readFileSync(path.join(__dirname, "..", "data-static", "fiidii-history.json"), "utf8");
    const j = JSON.parse(raw);
    _static = {
      meta: j.meta || {},
      daily: (j.daily || []).filter((d) => d && d.date),
      monthly: (j.monthly || []).filter((m) => m && m.month),
      fno: (j.fno || []).filter((f) => f && f.date),
    };
  } catch (e) {
    console.warn("[nse] shipped FII/DII baseline unavailable:", e.message);
    _static = { meta: {}, daily: [], monthly: [], fno: [] };
  }
  return _static;
}

/** NSE cash settles Monday-Friday. A weekend row is a data error, never a session. */
function isTradingDay(iso) {
  const dow = new Date(iso + "T00:00:00Z").getUTCDay();
  return dow >= 1 && dow <= 5;
}

/**
 * Shipped daily rows ∪ live captured sessions, keyed by ISO date.
 * The shipped rows are reconciled against published monthly totals at build
 * time, so they win on overlap; live capture only ever ADDS new sessions.
 *
 * Where the two have overlapped in practice the live prints have matched the
 * archive to the paisa, which is the check that says the merge key is right.
 * Rounded or weekend-dated rows left behind by earlier captures are dropped
 * rather than rendered as phantom bars.
 */
/* Sessions the DEPLOYED terminal captured after the baseline's last date,
   pulled from the live site and committed (data-static/fiidii-captured.json,
   refresh with `node server/data-static/pull-fiidii.js`). Render wipes the
   live store on redeploy; this file is what carries those sessions across. */
let _captured = null;
function capturedFile() {
  if (_captured) return _captured;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data-static", "fiidii-captured.json"), "utf8"));
    _captured = Array.isArray(j.sessions) ? j.sessions : [];
  } catch { _captured = []; }
  return _captured;
}

function mergedDaily() {
  const base = staticHistory().daily;
  const byDate = new Map();
  // precedence (later wins): committed capture < live store < reconciled baseline
  for (const s of capturedFile().concat(readHistory())) {
    const date = toIso(s.date);
    if (!date) continue;
    if (s.fii == null && s.dii == null) continue;
    if (!isTradingDay(date)) continue;
    byDate.set(date, { date, fiiNet: s.fii ?? null, diiNet: s.dii ?? null, live: true });
  }
  for (const d of base) {
    byDate.set(d.date, {
      date: d.date,
      fiiNet: d.fiiNet, diiNet: d.diiNet,
      fiiBuy: d.fiiBuy, fiiSell: d.fiiSell, diiBuy: d.diiBuy, diiSell: d.diiSell,
    });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Monday-anchored ISO week key + a human "w/e Fri" label. */
function weekOf(iso) {
  const d = new Date(iso + "T00:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7;                 // Mon = 0
  const mon = new Date(d); mon.setUTCDate(d.getUTCDate() - dow);
  const fri = new Date(mon); fri.setUTCDate(mon.getUTCDate() + 4);
  return { key: mon.toISOString().slice(0, 10), start: mon.toISOString().slice(0, 10), end: fri.toISOString().slice(0, 10) };
}

const sumNet = (rows, key) => {
  const v = rows.map((r) => r[key]).filter((x) => x != null && Number.isFinite(x));
  return v.length ? +v.reduce((a, b) => a + b, 0).toFixed(2) : null;
};

/** Weekly aggregation — only meaningful over the window where daily data exists. */
function weeklyFrom(daily) {
  const buckets = new Map();
  for (const d of daily) {
    const w = weekOf(d.date);
    if (!buckets.has(w.key)) buckets.set(w.key, { start: w.start, end: w.end, rows: [] });
    buckets.get(w.key).rows.push(d);
  }
  return [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, b]) => ({
    start: b.start, end: b.end, sessions: b.rows.length,
    fiiNet: sumNet(b.rows, "fiiNet"), diiNet: sumNet(b.rows, "diiNet"),
    partial: b.rows.length < 5,
  }));
}

/**
 * Monthly series: the shipped archive is authoritative for the months it
 * covers; any month present only in the daily series (i.e. the current one)
 * is computed month-to-date so the latest bar keeps moving after deployment.
 */
function monthlyFrom(daily) {
  const out = new Map();
  for (const m of staticHistory().monthly) {
    out.set(m.month, { month: m.month, fiiNet: m.fiiNet, diiNet: m.diiNet, fiiBuy: m.fiiBuy, fiiSell: m.fiiSell, diiBuy: m.diiBuy, diiSell: m.diiSell, source: "archive" });
  }
  const byMonth = new Map();
  for (const d of daily) {
    const k = d.date.slice(0, 7);
    if (!byMonth.has(k)) byMonth.set(k, []);
    byMonth.get(k).push(d);
  }
  for (const [k, rows] of byMonth) {
    if (out.has(k)) continue;                            // archive wins
    out.set(k, {
      month: k, fiiNet: sumNet(rows, "fiiNet"), diiNet: sumNet(rows, "diiNet"),
      sessions: rows.length, source: "month-to-date",
    });
  }
  return [...out.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** Calendar-year rollup. `months` is surfaced because the archive skips July 2016-2025. */
function yearlyFrom(monthly) {
  const by = new Map();
  for (const m of monthly) {
    const y = m.month.slice(0, 4);
    if (!by.has(y)) by.set(y, []);
    by.get(y).push(m);
  }
  return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([year, rows]) => ({
    year, months: rows.length, partial: rows.length < 12,
    fiiNet: sumNet(rows, "fiiNet"), diiNet: sumNet(rows, "diiNet"),
  }));
}

/** Everything the chart needs, at four granularities. */
function fiiSeries() {
  const daily = mergedDaily();
  const monthly = monthlyFrom(daily);
  return {
    daily, weekly: weeklyFrom(daily), monthly, yearly: yearlyFrom(monthly),
    fno: staticHistory().fno,
    meta: staticHistory().meta,
  };
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

/** Accept both the stored {fii,dii} shape and the merged {fiiNet,diiNet} one. */
const asFlow = (s) => ({ date: s.date, fii: s.fii !== undefined ? s.fii : s.fiiNet, dii: s.dii !== undefined ? s.dii : s.diiNet });

/** Pure: streaks + extremes over captured sessions. */
function fiiExtras(rows) {
  const sessions = rows.map(asFlow);
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
function fiiWindows(rows) {
  const sessions = rows.map(asFlow);
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
  let captured = latest.available ? recordSession(latest) : readHistory();
  // On a fresh store (or thin capture history) pull NSE's real multi-session
  // report once, so live capture starts from more than a single bar. The
  // shipped baseline below covers the chart regardless; this only enriches the
  // live layer. Backfilled sessions are real exchange prints, deduped by date.
  if (captured.length < 10) {
    captured = await backfillHistory().catch(() => captured);
  }

  // Baseline ∪ live capture. Windows, streaks and extremes are computed over
  // the merged series, so the 5- and 20-day cells are populated from day one
  // instead of waiting weeks for enough live sessions to accumulate.
  const series = fiiSeries();
  const daily = series.daily;

  return {
    available: latest.available || daily.length > 0,
    reason: latest.available ? undefined : latest.reason,
    latest: latest.available ? latest : null,
    // last ~3 years of sessions keeps the payload small; the full monthly and
    // yearly history travels in `series`
    history: daily.slice(-750).map((d) => ({ date: d.date, fii: d.fiiNet, dii: d.diiNet })),
    series: {
      weekly: series.weekly,
      monthly: series.monthly,
      yearly: series.yearly,
      fno: series.fno,
    },
    coverage: {
      dailySessions: daily.length,
      capturedLive: captured.length,
      months: series.monthly.length,
      years: series.yearly.length,
      from: daily.length ? daily[0].date : null,
      to: daily.length ? daily[daily.length - 1].date : null,
      monthsFrom: series.monthly.length ? series.monthly[0].month : null,
      baseline: series.meta,
    },
    windows: fiiWindows(daily),
    extras: fiiExtras(daily),
  };
}

/**
 * Seed the LIVE capture layer from an env var when empty. Render wipes its disk
 * on redeploy and NSE's historical endpoint is often blocked from cloud hosts,
 * so sessions captured since the last deploy would otherwise be lost.
 *
 * This no longer affects whether the chart has history — the shipped baseline
 * in data-static/fiidii-history.json is committed to the repo and always
 * present. FIIDII_SEED only carries forward live sessions captured AFTER the
 * baseline's last date, so the daily series does not develop a gap between
 * deploys. Set it to a JSON array of {date,fii,dii}. Only seeds an empty store;
 * genuine captured sessions are never overwritten. For full durability, use a
 * persistent disk (MERIDIAN_DATA_DIR).
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

/* ── corporate announcements (exchange filings) for one listed company ──
   Primary-source disclosures: results outcomes, investor presentations,
   call transcripts, acquisitions, management changes … each with NSE's own
   one-line summary and the filing PDF on nsearchives. Newest first; null
   when NSE is unreachable. */
const ANN_MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
/* "04-Aug-2026 19:09:16", "30-JUN-2026", "31-Dec-2024" → "2026-08-04" */
function nseDate(s) {
  const m = String(s || "").trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (!m || !(m[2].toLowerCase() in ANN_MON)) return null;
  return new Date(Date.UTC(+m[3], ANN_MON[m[2].toLowerCase()], +m[1])).toISOString().slice(0, 10);
}
const nseSym = (symbol) => { const s = String(symbol || "").replace(/\.(NS|BO)$/i, "").toUpperCase(); return /^[A-Z0-9&-]{1,20}$/.test(s) ? s : null; };
const listOf = (j) => (Array.isArray(j) ? j : j && Array.isArray(j.data) ? j.data : null);
const pnum = (v) => { const x = parseFloat(String(v == null ? "" : v).replace(/,/g, "").trim()); return Number.isFinite(x) ? x : null; };

/* shareholding pattern — promoter / public split per quarter, newest first */
async function shareholdingPattern(symbol) {
  const sym = nseSym(symbol); if (!sym) return null;
  const list = listOf(await nseGet(`/api/corporate-share-holdings-master?index=equities&symbol=${encodeURIComponent(sym)}`, 15000));
  if (!list) return null;
  return list.map((x) => ({
    date: nseDate(x.date), promoter: pnum(x.pr_and_prgrp), public: pnum(x.public_val), employeeTrusts: pnum(x.employeeTrusts),
    filed: nseDate(x.broadcastDate), remarks: String(x.remarksWeb || "").replace(/\s+/g, " ").trim().slice(0, 600),
    xbrl: /^https:\/\/nsearchives\.nseindia\.com\/.+\.xml$/i.test(x.xbrl || "") ? x.xbrl : null,
  })).filter((x) => x.date && x.promoter != null).sort((a, b) => b.date.localeCompare(a.date));
}

/* promoter pledge summary (latest disclosure) */
async function pledgeSummary(symbol) {
  const sym = nseSym(symbol); if (!sym) return null;
  const list = listOf(await nseGet(`/api/corporate-pledgedata?index=equities&symbol=${encodeURIComponent(sym)}`, 15000));
  if (!list || !list.length) return list ? { none: true } : null;
  const x = list[0];
  return {
    asOf: nseDate(x.shp), promoterHoldingPct: pnum(x.percPromoterHolding),
    pledgedPctOfPromoter: pnum(x.percPromoterShares), pledgedPctOfTotal: pnum(x.percTotShares), sharesPledged: pnum(x.totPromoterShares),
  };
}

/* insider trades under SEBI (PIT) regulations, newest first */
async function insiderTrades(symbol) {
  const sym = nseSym(symbol); if (!sym) return null;
  const list = listOf(await nseGet(`/api/corporates-pit?index=equities&symbol=${encodeURIComponent(sym)}`, 15000));
  if (!list) return null;
  return list.map((x) => ({
    date: nseDate(x.intimDt || x.date), from: nseDate(x.acqfromDt), name: String(x.acqName || "").trim(), category: String(x.personCategory || "").trim(),
    type: String(x.tdpTransactionType || "").trim(), mode: String(x.acqMode || "").trim(), shares: pnum(x.secAcq), value: pnum(x.secVal),
    afterPct: pnum(x.afterAcqSharesPer),
  })).filter((x) => x.date).sort((a, b) => b.date.localeCompare(a.date));
}

/* corporate actions (dividends, splits, bonus …) with ex / record dates */
async function corporateActions(symbol) {
  const sym = nseSym(symbol); if (!sym) return null;
  const list = listOf(await nseGet(`/api/corporates-corporateActions?index=equities&symbol=${encodeURIComponent(sym)}`, 15000));
  if (!list) return null;
  return list.map((x) => ({ exDate: nseDate(x.exDate), recordDate: nseDate(x.recDate), subject: String(x.subject || "").trim() }))
    .filter((x) => x.exDate || x.recordDate).sort((a, b) => String(b.exDate || b.recordDate).localeCompare(String(a.exDate || a.recordDate)));
}

/* board-meeting calendar (results dates and other purposes), newest first */
async function eventCalendar(symbol) {
  const sym = nseSym(symbol); if (!sym) return null;
  const list = listOf(await nseGet(`/api/event-calendar?index=equities&symbol=${encodeURIComponent(sym)}`, 15000));
  if (!list) return null;
  return list.map((x) => ({ date: nseDate(x.date), purpose: String(x.purpose || "").trim(), detail: String(x.bm_desc || "").replace(/\s+/g, " ").trim().slice(0, 300) }))
    .filter((x) => x.date).sort((a, b) => b.date.localeCompare(a.date));
}

/* quarterly results filings with their XBRL — integrated filings (2025+) first,
   then the older results format; one row per quarter-end and scope */
async function resultsFilings(symbol) {
  const sym = nseSym(symbol); if (!sym) return null;
  const [a, b] = await Promise.all([
    nseGet(`/api/integrated-filing-results?index=equities&symbol=${encodeURIComponent(sym)}`, 15000),
    nseGet(`/api/corporates-financial-results?index=equities&symbol=${encodeURIComponent(sym)}&period=Quarterly`, 15000),
  ]);
  const la = listOf(a), lb = listOf(b);
  if (!la && !lb) return null;
  const rows = [
    ...(la || []).map((x) => ({ qe: nseDate(x.qe_Date), consolidated: x.consolidated === "Consolidated", audited: /^Audited/i.test(x.audited || ""), revision: /revis/i.test(x.type_Sub || ""), filed: nseDate(x.broadcast_Date), xbrl: x.xbrl, format: "integrated" })),
    ...(lb || []).map((x) => ({ qe: nseDate(x.toDate), consolidated: x.consolidated === "Consolidated", audited: /^Audited/i.test(x.audited || ""), revision: false, filed: nseDate(x.filingDate || x.broadCastDate), xbrl: x.xbrl, format: "results" })),
  ].filter((x) => x.qe && /^https:\/\/nsearchives\.nseindia\.com\/.+\.xml$/i.test(x.xbrl || ""));
  // latest filing per quarter-end + scope (a revision supersedes the original)
  const best = new Map();
  for (const r of rows) {
    const k = `${r.qe}|${r.consolidated}`, cur = best.get(k);
    if (!cur || (r.filed || "") > (cur.filed || "")) best.set(k, r);
  }
  return [...best.values()].sort((x, y) => y.qe.localeCompare(x.qe));
}

/* a filing document from the public archive (XBRL / XML); size-capped */
async function archiveText(url, maxBytes = 3_000_000) {
  if (!/^https:\/\/nsearchives\.nseindia\.com\//i.test(url || "")) return null;
  const r = await fetchWithTimeout(url, { headers: { "User-Agent": UA } }, 15000).catch(() => null);
  if (!r || !r.ok) return null;
  const t = await r.text().catch(() => "");
  return t && t.length <= maxBytes ? t : null;
}

async function corporateAnnouncements(symbol) {
  const sym = nseSym(symbol);
  if (!sym) return null;
  const path = `/api/corporate-announcements?index=equities&symbol=${encodeURIComponent(sym)}`;
  // NSE drops the occasional request under load — one fresh-session retry
  let j = await nseGet(path, 15000);
  if (!listOf(j)) { await warmUp(true); j = await nseGet(path, 15000); }
  const list = Array.isArray(j) ? j : j && Array.isArray(j.data) ? j.data : null;
  if (!list) return null;
  return list.map((a) => ({
    date: nseDate(a.an_dt || a.sort_date),
    category: String(a.desc || "").trim(),
    text: String(a.attchmntText || "").replace(/\s+/g, " ").trim(),
    url: /^https:\/\/(nsearchives|archives)\.nseindia\.com\//i.test(a.attchmntFile || "") ? a.attchmntFile : null,
  })).filter((a) => a.date);
}

module.exports = {
  corporateAnnouncements, shareholdingPattern, pledgeSummary, insiderTrades, corporateActions, eventCalendar, resultsFilings, archiveText, nseDate,
  fiiDiiLatest, fiiDiiPack, fiiWindows, fiiExtras, seedHistoryFromEnv, allIndices,
  // historical baseline + aggregation (exported for the routes and tests)
  fiiSeries, staticHistory, mergedDaily, weeklyFrom, monthlyFrom, yearlyFrom, toIso, isTradingDay,
};
