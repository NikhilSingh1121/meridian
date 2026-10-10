/**
 * Participant-wise open interest (NSE daily archive, after the close):
 * how Clients, DIIs, FIIs and Pros are positioned in index futures and index options,
 * and how that changed from the previous session. Cached for 6 hours; the file only
 * changes once a day.
 */
const C = require("../cache");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const url = (d) => `https://nsearchives.nseindia.com/content/nsccl/fao_participant_oi_${d}.csv`;
const ddmmyyyy = (t) => { const d = new Date(t + 5.5 * 3600e3); return `${String(d.getUTCDate()).padStart(2, "0")}${String(d.getUTCMonth() + 1).padStart(2, "0")}${d.getUTCFullYear()}`; };

/** pure: CSV text → { asOf, rows: { Client|DII|FII|Pro: {...} } } */
function parse(txt) {
  const lines = String(txt || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 4 || !/Client Type/i.test(lines[1] || "")) return null;
  const asOf = (lines[0].match(/as on ([A-Za-z]{3} \d{1,2}, \d{4})/) || [])[1] || null;
  const head = lines[1].split(",").map((h) => h.trim().toLowerCase());
  const col = (name) => head.findIndex((h) => h === name);
  const ix = { fil: col("future index long"), fis: col("future index short"), oicl: col("option index call long"), oipl: col("option index put long"), oics: col("option index call short"), oips: col("option index put short") };
  const rows = {};
  for (const l of lines.slice(2)) {
    const c = l.split(",").map((x) => x.trim()); const who = c[0];
    if (!/^(Client|DII|FII|Pro)$/i.test(who)) continue;
    const n = (i) => (i >= 0 ? +c[i] || 0 : 0);
    const fl = n(ix.fil), fs = n(ix.fis);
    rows[who] = {
      futLong: fl, futShort: fs, futNet: fl - fs, futLongPct: fl + fs ? Math.round((fl / (fl + fs)) * 1000) / 10 : null,
      callLong: n(ix.oicl), callShort: n(ix.oics), putLong: n(ix.oipl), putShort: n(ix.oips),
      // net option delta-ish stance: long calls + short puts are bullish, long puts + short calls bearish
      optStance: (n(ix.oicl) - n(ix.oics)) - (n(ix.oipl) - n(ix.oips)),
    };
  }
  return Object.keys(rows).length ? { asOf, rows } : null;
}

async function fetchDay(t) {
  const r = await fetch(url(ddmmyyyy(t)), { headers: { "User-Agent": UA, Accept: "text/csv,*/*" }, signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!r || !r.ok) return null;
  return parse(await r.text().catch(() => ""));
}
/** latest two available sessions (walks back over weekends / holidays) */
async function latest() {
  return C.cachedPersistent("participant-oi", 6 * 3600e3, async () => {
    const found = [];
    for (let i = 0; i < 10 && found.length < 2; i++) { const d = await fetchDay(Date.now() - i * 86400e3); if (d) found.push(d); }
    if (!found.length) throw new Error("participant OI unavailable");
    const [cur, prev] = found;
    for (const [k, v] of Object.entries(cur.rows)) { const p = prev && prev.rows[k]; v.futNetChg = p ? v.futNet - p.futNet : null; v.futLongPctChg = p && v.futLongPct != null && p.futLongPct != null ? Math.round((v.futLongPct - p.futLongPct) * 10) / 10 : null; }
    return { asOf: cur.asOf, prevAsOf: prev ? prev.asOf : null, rows: cur.rows, source: "NSE participant-wise open interest (daily)" };
  }).catch(() => null);
}

module.exports = { latest, parse };
