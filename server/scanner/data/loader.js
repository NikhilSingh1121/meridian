/**
 * Universe loader: NSE F&O underlyings (+ lot sizes) and Nifty 500 constituents (+ NSE industry),
 * from NSE's public archive CSVs, cached on disk for the day. Falls back to the static list
 * (data/universe.js) when NSE is unreachable — lot sizes are then unknown (null), never guessed.
 */
const fs = require("fs");
const path = require("path");
const U = require("./universe");
const { parseCsv } = require("../feeds/csv");
const S = require("../store/session");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const FO_URL = "https://nsearchives.nseindia.com/content/fo/fo_mktlots.csv";
const N500_URL = "https://nsearchives.nseindia.com/content/indices/ind_nifty500list.csv";
const NTM_URL = "https://nsearchives.nseindia.com/content/indices/ind_niftytotalmarket_list.csv";   // Nifty Total Market ≈ 750 (Nifty 500 + Microcap 250)
const snapshot = (f) => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "data-static", f), "utf8")); } catch { return null; } };

async function getText(url) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/csv,*/*" }, signal: ctl.signal });
    const txt = await r.text();
    if (!r.ok || /<html|access denied/i.test(txt.slice(0, 300))) throw new Error("NSE archive refused " + r.status);
    return txt;
  } finally { clearTimeout(t); }
}
/** fo_mktlots.csv → { SYMBOL: lotSize } (first listed expiry's lot) and index list */
function parseLots(txt) {
  const lines = txt.split(/\r?\n/).filter((l) => l.trim());
  const out = {};
  for (const l of lines.slice(1)) {
    const c = l.split(",").map((x) => x.trim());
    if (!c[1] || /^symbol$/i.test(c[1])) continue;
    const lot = c.slice(2).map((x) => parseInt(x, 10)).find((x) => x > 0);
    if (lot) out[c[1]] = lot;
  }
  return out;
}
function parseN500(txt) { return parseCsv(txt).filter((r) => r.Symbol && !/^DUMMY/i.test(r.Symbol)).map((r) => ({ s: r.Symbol, name: r["Company Name"], industry: r.Industry })); }

async function cachedFetch(dir, name, url, parse) {
  const f = dir && path.join(dir, `${name}-${S.istDate(Date.now())}.json`);
  try { return { data: JSON.parse(fs.readFileSync(f, "utf8")), source: "nse-cache" }; } catch { }
  const data = parse(await getText(url));
  if (f) { try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(f, JSON.stringify(data)); } catch { } }
  return { data, source: "nse" };
}

/** kind: 'total' | 'fno' | 'nifty500' | 'watchlist' ; returns { list:[{s,name?,sector,fno,lot}], source, note? } */
async function loadUniverse(kind = "fno", { dir, watchlist = [], offline = false } = {}) {
  let lots = null, n500 = null, notes = [];
  if (!offline) {
    try { lots = (await cachedFetch(dir, "fo-lots", FO_URL, parseLots)).data; } catch (e) { notes.push("F&O list: " + e.message); }
    try { n500 = (await cachedFetch(dir, "nifty500", N500_URL, parseN500)).data; } catch (e) { notes.push("Nifty 500 list: " + e.message); }
  }
  if (!n500) {                                    // bundled NSE snapshot (industry labels + constituents), dated
    n500 = snapshot("nifty500-list-2026-09-29.json"); if (n500) notes.push("using NSE's Nifty 500 list snapshot of 2026-09-29");
  }
  let ntm = null, ntmSnap = false;
  if (kind === "total") {
    if (!offline) { try { ntm = (await cachedFetch(dir, "niftytotalmarket", NTM_URL, parseN500)).data; } catch (e) { notes.push("Total Market list: " + e.message); } }
    if (!ntm) { ntm = snapshot("niftytotalmarket-list-2026-10-04.json"); ntmSnap = !!ntm; if (ntm) notes.push("using NSE's Nifty Total Market list snapshot of 2026-10-04"); }
  }
  const ind = new Map([...(ntm || []), ...(n500 || [])].map((x) => [x.s, x]));
  const sectorOf = (s) => ind.get(s)?.industry || U.SECTOR_OF[s] || "Other";
  const idx = new Set(Object.keys(U.INDICES).concat(["NIFTYNXT50", "NIFTYFPI"]));
  const fnoSet = lots ? new Set(Object.keys(lots).filter((s) => !idx.has(s))) : new Set(U.FNO_LIST);
  const mk = (s) => ({ s, name: ind.get(s)?.name || null, sector: sectorOf(s), fno: fnoSet.has(s), lot: lots ? lots[s] ?? null : null });
  let list;
  // Nifty 500 first: the warm-up loads history in list order, so the most-followed stocks get their indicators first
  if (kind === "total" && ntm) list = [...new Set([...(n500 || []).map((x) => x.s), ...fnoSet, ...ntm.map((x) => x.s)])].filter((s) => !/^DUMMY/i.test(s)).map(mk);
  else if (kind === "nifty500" || kind === "total") list = n500 ? n500.map((x) => mk(x.s)) : [...U.FNO_LIST, ...U.EXTRA_500].slice(0, 500).map(mk);
  else if (kind === "watchlist") list = [...new Set(watchlist.map((x) => String(x).trim().toUpperCase().replace(/\.NS$/, "")).filter(Boolean))].map(mk);
  else list = [...fnoSet].map(mk);
  const snap = notes.some((x) => /snapshot/.test(x));
  const source = kind === "total" && ntm ? (ntmSnap ? "NSE Nifty Total Market snapshot (2026-10-04)" : "NSE ind_niftytotalmarket_list.csv") + " + F&O stocks" : kind === "fno" ? (lots ? "NSE fo_mktlots.csv" : "static fallback list (lot sizes unknown)") : (kind === "nifty500" || kind === "total") ? (n500 ? (snap ? "NSE Nifty 500 snapshot (2026-09-29)" : "NSE ind_nifty500list.csv") : "static fallback list") : "watchlist";
  return { kind, list, source, lots: lots || {}, indexLots: lots ? Object.fromEntries([...idx].filter((k) => lots[k]).map((k) => [k, lots[k]])) : {}, notes };
}
module.exports = { loadUniverse, parseLots, parseN500 };
