/* Earnings Call intelligence.
   Transcript source: API Ninjas (/v1/earningstranscript + /v1/earningstranscriptsearch),
   gated behind API_NINJAS_KEY. The FREE/base tier returns the raw `transcript` string;
   the analysis below (sentiment, guidance, competitor/risk mentions, topics, tone) is
   computed deterministically by Meridian so it works on any tier. When the account tier
   returns the richer fields (overall_sentiment, guidance, transcript_split…), we surface
   those too. Everything is auditable; nothing is fabricated.

   Network note: api.api-ninjas.com must be reachable from the host (it is from a normal
   machine; the build sandbox is firewalled, so this is exercised on the user's machine). */

const NINJA_BASE = "https://api.api-ninjas.com/v1";
const hasNinjaKey = () => !!process.env.API_NINJAS_KEY;
const FMP_BASE = "https://financialmodelingprep.com/stable";
const hasFmpKey = () => !!process.env.FMP_API_KEY;

async function fmpGet(path, params) {
  if (!hasFmpKey()) throw new Error("NO_FMP_KEY");
  const url = new URL(FMP_BASE + path);
  Object.entries(params || {}).forEach(([k, v]) => { if (v != null && v !== "") url.searchParams.set(k, v); });
  url.searchParams.set("apikey", process.env.FMP_API_KEY);
  const r = await fetch(url);
  if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error(`FMP ${r.status}: ${t.slice(0, 140)}`); }
  return r.json();
}

// FMP earnings report / estimates → [{ symbol, date, epsActual, epsEstimated, revenueActual, revenueEstimated, lastUpdated }]
async function fmpEarnings(symbol, limit = 8) {
  const rows = await fmpGet("/earnings", { symbol, limit });
  return Array.isArray(rows) ? rows : [];
}
// FMP earnings-call transcript (if the plan includes it)
async function fmpTranscript(symbol, year, quarter) {
  const rows = await fmpGet("/earning-call-transcript", { symbol, year, quarter });
  // FMP returns an array of { symbol, period/quarter, year, date, content }
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) return null;
  return { ticker: symbol, year: row.year ?? year, quarter: row.quarter ?? row.period ?? quarter, date: row.date, transcript: row.content || row.transcript || "" };
}

// FMP revenue segmentation (business + geographic). Availability varies by
// plan and issuer — callers must treat empty results as "not disclosed".
// Rows arrive as [{ symbol, fiscalYear, period, date, data: { SegmentName: value } }]
async function fmpRevenueSegments(symbol) {
  const norm = (rows) => (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r.data && Object.keys(r.data).length)
    .map((r) => ({ year: r.fiscalYear ?? (r.date ? new Date(r.date).getFullYear() : null), period: r.period || "FY", data: r.data }))
    .filter((r) => r.year)
    .sort((a, b) => a.year - b.year)
    .slice(-4);
  const [product, geographic] = await Promise.all([
    fmpGet("/revenue-product-segmentation", { symbol, period: "annual" }).then(norm).catch(() => []),
    fmpGet("/revenue-geographic-segmentation", { symbol, period: "annual" }).then(norm).catch(() => []),
  ]);
  return { product, geographic };
}

async function ninjaGet(path, params) {
  if (!hasNinjaKey()) throw new Error("NO_KEY");
  const url = new URL(NINJA_BASE + path);
  Object.entries(params || {}).forEach(([k, v]) => { if (v != null && v !== "") url.searchParams.set(k, v); });
  const r = await fetch(url, { headers: { "X-Api-Key": process.env.API_NINJAS_KEY } });
  if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error(`API Ninjas ${r.status}: ${t.slice(0, 140)}`); }
  return r.json();
}

// list available calls for a ticker → [{ ticker, year, quarter, date }]
async function listCalls(ticker) {
  const rows = await ninjaGet("/earningstranscriptsearch", { ticker });
  return Array.isArray(rows) ? rows : [];
}

// fetch one transcript (latest if year/quarter omitted)
async function fetchTranscript(ticker, year, quarter) {
  return ninjaGet("/earningstranscript", { ticker, year, quarter });
}

/* ─────────────  ANALYSIS ENGINE  ─────────────
   The transcript analyser lives in callParse (structure: speakers, roles, Q&A,
   pages), callAnalysis (facts, guidance, themes, tone) and callModules (answer
   quality, red flags, monitorables). This wrapper keeps the old entry point. */
const { analyzeCall } = require("./callAnalysis");
function analyzeTranscript(raw, meta = {}, peers = []) { return analyzeCall(raw, meta, peers); }

module.exports = { hasNinjaKey, listCalls, fetchTranscript, analyzeTranscript, hasFmpKey, fmpEarnings, fmpTranscript, fmpRevenueSegments };
