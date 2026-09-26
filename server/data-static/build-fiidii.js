/**
 * MERIDIAN — FII/DII historical dataset builder.
 *
 * Converts the source workbook (NSE/BSE provisional FII-DII reports, compiled
 * via 5paisa + an open NSE daily mirror) into `fiidii-history.json`, which the
 * terminal ships as its historical baseline. Live daily sessions captured from
 * NSE after deployment are merged on top of this file at runtime — see
 * server/providers/nse.js.
 *
 * Re-run after refreshing the workbook:
 *   node server/data-static/build-fiidii.js "C:/path/to/FII_DII_Activity_India.xlsx"
 *
 * The script is deliberately strict: rows whose first cell is not a real date
 * or month are treated as the workbook's own summary rows and dropped, and the
 * daily→monthly reconciliation is asserted before anything is written.
 */
const path = require("path");
const fs = require("fs");
const ExcelJS = require("exceljs");

const SRC = process.argv[2] || path.join(require("os").homedir(), "Downloads", "FII_DII_Activity_India.xlsx");
const OUT = path.join(__dirname, "fiidii-history.json");

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** Unwrap formula results / rich text that exceljs returns as objects. */
function val(cell) {
  let v = cell ? cell.value : null;
  if (v && typeof v === "object" && v.result !== undefined) v = v.result;
  if (v && typeof v === "object" && v.text !== undefined) v = v.text;
  return v === undefined ? null : v;
}
function num(cell) {
  const v = val(cell);
  if (v === null || v === "" || v === "-") return null;
  const n = typeof v === "string" ? parseFloat(v.replace(/,/g, "")) : Number(v);
  return Number.isFinite(n) ? +n.toFixed(2) : null;
}
/** Cell → "YYYY-MM-DD", or null when the cell is not a date (summary rows). */
function isoDate(cell) {
  const v = val(cell);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v || "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[-\s/]([A-Za-z]{3})[a-z]*[-\s/](\d{4})$/);
  if (m && MONTHS[m[2].toLowerCase()]) {
    return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}
/** Cell → "YYYY-MM" for the monthly sheet ("Sep 2015"), else null. */
function isoMonth(cell) {
  const v = val(cell);
  if (v instanceof Date) return v.toISOString().slice(0, 7);
  const m = String(v || "").trim().match(/^([A-Za-z]{3})[a-z]*[-\s]?(\d{4})$/);
  if (!m || !MONTHS[m[1].toLowerCase()]) return null;
  return `${m[2]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, "0")}`;
}

(async () => {
  if (!fs.existsSync(SRC)) {
    console.error(`Source workbook not found: ${SRC}`);
    process.exit(1);
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(SRC);

  const sheet = (n) => {
    const ws = wb.getWorksheet(n);
    if (!ws) throw new Error(`Missing worksheet: ${n}`);
    return ws;
  };

  /* ── daily cash ─────────────────────────────────────────────────────── */
  const daily = [];
  {
    const ws = sheet("Daily_Cash_Jun_Jul2026");
    for (let i = 6; i <= ws.rowCount; i++) {
      const r = ws.getRow(i);
      const date = isoDate(r.getCell(1));
      if (!date) continue; // "Period total", "Avg daily net", …
      daily.push({
        date,
        fiiBuy: num(r.getCell(3)), fiiSell: num(r.getCell(4)), fiiNet: num(r.getCell(5)),
        diiBuy: num(r.getCell(6)), diiSell: num(r.getCell(7)), diiNet: num(r.getCell(8)),
      });
    }
    daily.sort((a, b) => a.date.localeCompare(b.date));
  }

  /* ── monthly cash ───────────────────────────────────────────────────── */
  const monthly = [];
  {
    const ws = sheet("Monthly_Cash_History");
    for (let i = 6; i <= ws.rowCount; i++) {
      const r = ws.getRow(i);
      const month = isoMonth(r.getCell(1));
      if (!month) continue; // "Total (available months)", "Best month", …
      monthly.push({
        month,
        fiiBuy: num(r.getCell(2)), fiiSell: num(r.getCell(3)), fiiNet: num(r.getCell(4)),
        diiBuy: num(r.getCell(5)), diiSell: num(r.getCell(6)), diiNet: num(r.getCell(7)),
      });
    }
    monthly.sort((a, b) => a.month.localeCompare(b.month));
  }

  /* ── FII derivatives (notional gross; read the Net columns) ─────────── */
  const fno = [];
  {
    const ws = sheet("Daily_FnO_Jul2026");
    for (let i = 6; i <= ws.rowCount; i++) {
      const r = ws.getRow(i);
      const date = isoDate(r.getCell(1));
      if (!date) continue;
      fno.push({
        date,
        indexFutNet: num(r.getCell(4)),
        indexOptNet: num(r.getCell(7)),
        stockFutNet: num(r.getCell(10)),
        stockOptNet: num(r.getCell(13)),
      });
    }
    fno.sort((a, b) => a.date.localeCompare(b.date));
  }

  /* ── reconciliation: daily nets must sum to the published monthly totals
        for every month the daily sheet fully covers. The workbook's README
        asserts this holds exactly for June 2026; if a future refresh breaks
        it, the build should fail rather than ship a silently wrong series. ─ */
  const byMonth = {};
  for (const d of daily) {
    const m = d.date.slice(0, 7);
    (byMonth[m] ||= { fii: 0, dii: 0, n: 0 });
    byMonth[m].fii += d.fiiNet || 0;
    byMonth[m].dii += d.diiNet || 0;
    byMonth[m].n++;
  }
  const checks = [];
  for (const [m, agg] of Object.entries(byMonth)) {
    const pub = monthly.find((x) => x.month === m);
    if (!pub) { checks.push(`${m}: ${agg.n} daily sessions, no monthly row (month-to-date)`); continue; }
    const df = Math.abs(agg.fii - pub.fiiNet), dd = Math.abs(agg.dii - pub.diiNet);
    const ok = df < 1 && dd < 1;
    checks.push(`${m}: daily Σ FII ${agg.fii.toFixed(1)} vs published ${pub.fiiNet} · DII ${agg.dii.toFixed(1)} vs ${pub.diiNet} → ${ok ? "MATCH" : "MISMATCH"}`);
    if (!ok) throw new Error(`Reconciliation failed for ${m}: FII Δ${df.toFixed(2)}, DII Δ${dd.toFixed(2)}`);
  }

  /* ── calendar gaps in the monthly archive (July is absent 2016-2025) ── */
  const gaps = [];
  if (monthly.length) {
    const [y0, m0] = monthly[0].month.split("-").map(Number);
    const [y1, m1] = monthly[monthly.length - 1].month.split("-").map(Number);
    const have = new Set(monthly.map((x) => x.month));
    for (let y = y0, m = m0; y < y1 || (y === y1 && m <= m1); m === 12 ? (m = 1, y++) : m++) {
      const k = `${y}-${String(m).padStart(2, "0")}`;
      if (!have.has(k)) gaps.push(k);
    }
  }

  const out = {
    meta: {
      unit: "₹ Crore",
      source: "NSE/BSE provisional FII-DII reports (compiled via 5paisa and an open NSE daily-report mirror)",
      sourceUrl: "https://www.5paisa.com/share-market-today/fii-dii-data",
      prepared: "2026-07-26",
      latest: daily.length ? daily[daily.length - 1].date : null,
      generatedAt: new Date().toISOString(),
      coverage: {
        daily: daily.length ? `${daily[0].date} → ${daily[daily.length - 1].date} (${daily.length} sessions)` : null,
        monthly: monthly.length ? `${monthly[0].month} → ${monthly[monthly.length - 1].month} (${monthly.length} months)` : null,
        fno: fno.length ? `${fno[0].date} → ${fno[fno.length - 1].date} (${fno.length} sessions)` : null,
      },
      monthlyGaps: gaps,
      caveats: [
        "Provisional exchange data — the exchanges publish these same-day and revise them; final SEBI/FPI figures can differ.",
        "The monthly archive has no row for July in any year from 2016 through 2025, so trailing windows can span more than twelve calendar months.",
        "Day-level FII/DII figures are only published for a rolling recent window, so weekly detail cannot be reconstructed before June 2026.",
        "Index and stock option gross figures are notional turnover in lakhs of crore and are not comparable in magnitude to cash flows — read the net.",
      ],
    },
    daily, monthly, fno,
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(`Wrote ${OUT}`);
  console.log(`  daily   ${daily.length} sessions   ${out.meta.coverage.daily}`);
  console.log(`  monthly ${monthly.length} months     ${out.meta.coverage.monthly}`);
  console.log(`  fno     ${fno.length} sessions   ${out.meta.coverage.fno}`);
  console.log(`  monthly calendar gaps: ${gaps.length}${gaps.length ? " (" + gaps.slice(0, 12).join(", ") + (gaps.length > 12 ? ", …" : "") + ")" : ""}`);
  console.log("  reconciliation:");
  checks.forEach((c) => console.log("    " + c));
})().catch((e) => { console.error("BUILD FAILED:", e.message); process.exit(1); });
