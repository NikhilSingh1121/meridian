/**
 * MERIDIAN — snapshot the deployed terminal's live-captured FII/DII sessions.
 *
 * Render wipes the server disk on every redeploy, which drops the daily
 * sessions captured since the last deploy. Run this BEFORE deploying: it pulls
 * the live site's series and writes every session after the shipped baseline
 * (fiidii-history.json) into fiidii-captured.json, which is committed and
 * merged at runtime by server/providers/nse.js.
 *
 *   node server/data-static/pull-fiidii.js [https://mterminal.onrender.com]
 *
 * Sessions already in the file but missing from the live site (e.g. captured
 * before an earlier redeploy) are kept — the file only ever grows.
 */
const fs = require("fs");
const path = require("path");

const SITE = (process.argv[2] || "https://mterminal.onrender.com").replace(/\/+$/, "");
const OUT = path.join(__dirname, "fiidii-captured.json");
const BASE_LATEST = require("./fiidii-history.json").meta.latest;

(async () => {
  const r = await fetch(`${SITE}/api/macro/fiidii`, { signal: AbortSignal.timeout(90_000) });
  if (!r.ok) throw new Error(`${SITE} answered ${r.status}`);
  const live = ((await r.json()).history || [])
    .filter((d) => d && d.date > BASE_LATEST && (d.fii != null || d.dii != null))
    .map((d) => ({ date: d.date, fii: d.fii, dii: d.dii }));

  let prev = [];
  try { prev = JSON.parse(fs.readFileSync(OUT, "utf8")).sessions || []; } catch { }
  const byDate = new Map(prev.map((s) => [s.date, s]));
  for (const s of live) byDate.set(s.date, s);
  const sessions = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

  const meta = {
    unit: "₹ Crore",
    source: "NSE provisional daily flows, captured live by the deployed terminal",
    pulledFrom: `${SITE}/api/macro/fiidii`,
    pulledAt: new Date().toISOString(),
    after: BASE_LATEST,
    sessions: sessions.length,
    from: sessions[0] ? sessions[0].date : null,
    to: sessions.length ? sessions[sessions.length - 1].date : null,
  };
  fs.writeFileSync(OUT, JSON.stringify({ meta, sessions }, null, 1) + "\n");
  console.log(`fiidii-captured.json: ${prev.length} → ${sessions.length} sessions (${meta.from} → ${meta.to})`);
})().catch((e) => { console.error("pull failed:", e.message); process.exit(1); });
