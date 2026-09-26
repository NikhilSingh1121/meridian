/**
 * MERIDIAN — free macro-data provider layer.
 *
 * Four keyless, genuinely free public sources, each long-established:
 *
 *   · STOOQ  (stooq.com)         — global government bond yields + any quote,
 *                                  simple CSV endpoints, no key, no login.
 *   · FRED   (fredgraph.csv)     — the St. Louis Fed's public CSV download
 *                                  (NOT the keyed API): CPI indices, reserves,
 *                                  industrial production, policy-adjacent series.
 *   · WORLD BANK (api.worldbank.org) — annual GDP growth / inflation /
 *                                  unemployment, keyless JSON, v2 API.
 *   · BIS    (stats.bis.org)     — daily central-bank policy rates for every
 *                                  major central bank (WS_CBPOL), SDMX CSV.
 *
 * Design rules (identical to the rest of the platform):
 *   · every fetch has a hard timeout and returns null on any failure —
 *     callers render "unavailable", never crash;
 *   · every endpoint is cached (TTLs at the route layer via cachedDurable,
 *     which also snapshots last-good data to disk for stale-on-error);
 *   · all parsers are pure and exported for unit testing;
 *   · no mock values anywhere — a metric either comes from the source or
 *     is reported unavailable.
 */

const REQ_TIMEOUT = 10_000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function fetchText(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), REQ_TIMEOUT);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": UA, Accept: "text/csv,application/json,text/plain,*/*" }, redirect: "follow" });
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
  finally { clearTimeout(t); }
}

const num = (v) => {
  if (v === null || v === undefined || v === "" || v === "." || v === "-") return null;
  const x = parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(x) ? x : null;
};

/* ═══════════════════════ STOOQ ═══════════════════════ */
/* Live-ish quote CSV: Symbol,Date,Time,Open,High,Low,Close,Volume */
function parseStooqQuote(csv) {
  if (!csv) return null;
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const cells = lines[1].split(",");
  if (cells.length < 7) return null;
  const close = num(cells[6]);
  const open = num(cells[3]);
  if (close == null) return null;
  return { symbol: cells[0], date: cells[1], close, open, high: num(cells[4]), low: num(cells[5]) };
}
/* Daily history CSV: Date,Open,High,Low,Close,Volume */
function parseStooqDaily(csv, maxRows = 600) {
  if (!csv) return [];
  const lines = csv.trim().split(/\r?\n/);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(",");
    const v = num(c[4]);
    if (!c[0] || v == null) continue;
    out.push({ date: c[0], v });
  }
  return out.slice(-maxRows);
}
async function stooqQuote(sym) {
  return parseStooqQuote(await fetchText(`https://stooq.com/q/l/?s=${encodeURIComponent(sym)}&f=sd2t2ohlcv&h&e=csv`));
}
async function stooqDaily(sym, maxRows = 600) {
  return parseStooqDaily(await fetchText(`https://stooq.com/q/d/l/?s=${encodeURIComponent(sym)}&i=d`), maxRows);
}

/* ═══════════════════════ FRED (keyless fredgraph.csv) ═══════════════════════ */
/* CSV: observation_date,SERIESID — one row per period, "." for missing. */
function parseFredCsv(csv) {
  if (!csv) return [];
  const lines = csv.trim().split(/\r?\n/);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const [date, raw] = lines[i].split(",");
    const v = num(raw);
    if (!date || v == null) continue;
    out.push({ date, v });
  }
  return out;
}
async function fredSeries(id, maxRows = 600) {
  const rows = parseFredCsv(await fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}`));
  return rows.slice(-maxRows);
}
/** YoY % series from a monthly index (CPI etc). */
function yoyFromIndex(rows) {
  const out = [];
  for (let i = 12; i < rows.length; i++) {
    const a = rows[i - 12].v, b = rows[i].v;
    if (a > 0 && b != null) out.push({ date: rows[i].date, v: +(((b - a) / a) * 100).toFixed(2) });
  }
  return out;
}

/* ═══════════════════════ WORLD BANK ═══════════════════════ */
function parseWorldBank(json) {
  try {
    const arr = JSON.parse(json);
    const rows = (arr && arr[1]) || [];
    return rows
      .filter((r) => r && r.value != null)
      .map((r) => ({ date: r.date, v: +(+r.value).toFixed(2) }))
      .reverse(); // oldest → newest
  } catch { return []; }
}
async function worldBank(country, indicator, maxRows = 30) {
  const rows = parseWorldBank(await fetchText(
    `https://api.worldbank.org/v2/country/${encodeURIComponent(country)}/indicator/${encodeURIComponent(indicator)}?format=json&per_page=70`));
  return rows.slice(-maxRows);
}

/* ═══════════════════════ BIS (central-bank policy rates) ═══════════════════════ */
/* SDMX CSV — columns include TIME_PERIOD and OBS_VALUE; header order varies,
   so locate them by name. One row per day per country. */
function parseBisCsv(csv) {
  if (!csv) return [];
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const head = lines[0].split(",").map((h) => h.trim().replace(/"/g, "").toUpperCase());
  const ti = head.indexOf("TIME_PERIOD");
  const vi = head.indexOf("OBS_VALUE");
  if (ti === -1 || vi === -1) return [];
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(",");
    const date = (c[ti] || "").replace(/"/g, "").trim();
    const v = num((c[vi] || "").replace(/"/g, ""));
    if (!date || v == null) continue;
    out.push({ date, v });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : 1));
  return out;
}
async function bisPolicyRate(cc, lastN = 800) {
  const rows = parseBisCsv(await fetchText(
    `https://stats.bis.org/api/v1/data/WS_CBPOL_D/D.${encodeURIComponent(cc)}/all?format=csv&lastNObservations=${lastN}`));
  return rows;
}

/* ═══════════════════════ pure series math (shared) ═══════════════════════ */
/** Multi-horizon % returns from a daily close series (trading-day offsets). */
function horizonReturns(closes) {
  const n = closes.length;
  if (n < 2) return {};
  const last = closes[n - 1];
  const at = (k) => (n - 1 - k >= 0 ? closes[n - 1 - k] : null);
  const pct = (base) => (base != null && base > 0 ? +(((last - base) / base) * 100).toFixed(2) : null);
  return { w1: pct(at(5)), m1: pct(at(21)), m3: pct(at(63)) };
}
/** YTD % from [{date:"YYYY-MM-DD"|ms, v|c}] daily rows. */
function ytdReturn(rows) {
  if (!rows || rows.length < 2) return null;
  // Prefer the close `c` (Yahoo rows also carry `v` = volume, which must never
  // be mistaken for the price); fall back to `v` only for FRED {date, v} rows.
  const val = (r) => (r.c != null ? r.c : r.v);
  const yr = new Date(rows[rows.length - 1].t || rows[rows.length - 1].date).getFullYear();
  let base = null;
  for (const r of rows) {
    const y = new Date(r.t || r.date).getFullYear();
    if (y === yr) { base = val(r); break; }
  }
  const last = val(rows[rows.length - 1]);
  return base > 0 && last != null ? +(((last - base) / base) * 100).toFixed(2) : null;
}
/** Percentile (0-100) of the last value within the series. */
function lastPercentile(values) {
  const v = values.filter((x) => x != null && Number.isFinite(x));
  if (v.length < 20) return null;
  const last = v[v.length - 1];
  const below = v.filter((x) => x <= last).length;
  return Math.round((below / v.length) * 100);
}
/**
 * Currency strength from USD pairs.
 * pairs: { EURUSD: pct, GBPUSD: pct, USDINR: pct, ... } (daily % change).
 * Convention: for XXXUSD pairs, +pct = XXX stronger; for USDXXX, +pct = XXX weaker.
 * USD strength = mean of its % change against every other currency.
 */
function currencyStrength(pairs) {
  const vsUsd = {}; // currency → % change vs USD (positive = stronger than USD)
  for (const [pair, chg] of Object.entries(pairs)) {
    if (chg == null) continue;
    if (pair.startsWith("USD")) vsUsd[pair.slice(3, 6)] = -chg;
    else if (pair.endsWith("USD")) vsUsd[pair.slice(0, 3)] = chg;
  }
  const others = Object.values(vsUsd);
  if (!others.length) return [];
  const usd = -(others.reduce((s, x) => s + x, 0) / others.length);
  const out = Object.entries(vsUsd).map(([ccy, v]) => ({ ccy, score: +(v - usd).toFixed(2) }));
  out.push({ ccy: "USD", score: +(0 - usd).toFixed(2) });
  // normalize: strength relative to the group mean, ranked strongest first
  const mean = out.reduce((s, x) => s + x.score, 0) / out.length;
  return out.map((x) => ({ ccy: x.ccy, score: +(x.score - mean).toFixed(2) })).sort((a, b) => b.score - a.score);
}

/* ═══════════════════════ IMF DataMapper ═══════════════════════ */
/* Keyless JSON covering GDP growth (NGDP_RPCH), inflation (PCPIPCH) and
   unemployment (LUR) for every economy, WEO vintage — the most complete
   single free source for cross-country indicators.
   Shape: { values: { IND: { "2023": 7.6, ... } } } after indicator key. */
function parseImf(json, indicator) {
  try {
    const j = JSON.parse(json);
    const byCountry = j && j.values && j.values[indicator];
    if (!byCountry) return {};
    const nowYear = new Date().getFullYear();
    const out = {};
    for (const [cc, years] of Object.entries(byCountry)) {
      const entries = Object.entries(years)
        .map(([y, v]) => ({ year: +y, v: num(v) }))
        .filter((e) => e.v != null && e.year <= nowYear)   // exclude pure forecasts
        .sort((a, b) => a.year - b.year);
      if (!entries.length) continue;
      const last = entries[entries.length - 1];
      out[cc] = { year: String(last.year), v: +last.v.toFixed(2), trend: entries.slice(-12).map((e) => e.v) };
    }
    return out;
  } catch { return {}; }
}
async function imfIndicator(indicator, countries) {
  // The DataMapper 404s when too many country codes sit in the path (~30+), yet
  // any valid request returns every economy for the indicator — so query in
  // chunks of 15 and merge. One good chunk already covers the whole world;
  // chunking just keeps the URL short and survives a partial failure.
  const list = (countries && countries.length) ? countries : ["USA"];
  const chunks = [];
  for (let i = 0; i < list.length; i += 15) chunks.push(list.slice(i, i + 15));
  const merged = {};
  for (const ch of chunks) {
    const url = `https://www.imf.org/external/datamapper/api/v1/${encodeURIComponent(indicator)}/${ch.map(encodeURIComponent).join("/")}`;
    Object.assign(merged, parseImf(await fetchText(url), indicator));
  }
  return merged;
}

module.exports = {
  stooqQuote, stooqDaily, fredSeries, worldBank, bisPolicyRate, imfIndicator,
  parseStooqQuote, parseStooqDaily, parseFredCsv, parseWorldBank, parseBisCsv, parseImf,
  yoyFromIndex, horizonReturns, ytdReturn, lastPercentile, currencyStrength,
};
