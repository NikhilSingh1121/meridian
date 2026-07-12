/**
 * MERIDIAN — Consolidated Research Workbook (.xlsx)
 * ════════════════════════════════════════════════════════════════════════════
 * One workbook containing EVERY analytical surface of the terminal apart from
 * the live-formula valuation model (which has its own dedicated export in the
 * Modeling Lab, with formulas, named ranges and scenario switches).
 *
 * This is a COMPUTED-VALUES export: the numbers are the exact outputs of the
 * deterministic engine — the same figures on screen — laid out for committee
 * packs, print, and side-by-side comparison. Sheets:
 *
 *   1. Cover ·········· company, metadata, table of contents
 *   2. Snapshot ······· profile, price, key stats
 *   3. Income Statement annual + YoY + CAGR
 *   4. Balance Sheet ·· annual + YoY + CAGR
 *   5. Cash Flow ······ annual (plug-reconciled "Other" rows) + YoY + CAGR
 *   6. Ratios ········· full ratio library, grouped
 *   7. DuPont ········· 3+5 stage per year + exact YoY attribution
 *   8. Growth & Variance CAGRs, YoY, variance drivers + commentary
 *   9. Valuation ······ multi-method table (football-field inputs) + bands
 *  10. Reverse DCF & Tornado — market-implied expectations + driver swings
 *  11. Forensic ······· Piotroski / Altman / Beneish with components
 *  12. Risk ·········· scored risk register + scenario table
 *  13. Peers ········· comparable-company table
 *  14. Ownership ····· institutional holders
 *
 * Every section is failure-isolated: a missing analytics pack renders an
 * explanatory row, never a broken export. Style kit is shared with the
 * Modeling Lab export so both workbooks look like one product.
 * ════════════════════════════════════════════════════════════════════════════
 */

const ExcelJS = require("exceljs");
const { kit } = require("./excel-export");
const { C, NF, STYLE, fontBase, fillSolid, setCell, bannerRow, pageHeader, fy } = kit;

/* ── local conveniences ─────────────────────────────────────────────────── */
/* The kit's bannerRow paints in place but returns undefined; this workbook
   threads the row cursor through every section, so wrap it to return r+1. */
const banner = (ws, r, c0, c1, text) => { bannerRow(ws, r, c0, c1, text); return r + 1; };
const nn = (v) => (v == null || !Number.isFinite(+v) ? null : +v);
const scaleFor = (currency) => (currency === "INR" ? { div: 1e7, label: "₹ Cr" } : { div: 1e6, label: (currency || "") + " Mn" });
const D = (v, div) => (nn(v) == null ? null : v / div);
const cagrOf = (vals) => {
  const clean = vals.map(nn);
  const first = clean.find((v) => v != null && v > 0);
  const last = [...clean].reverse().find((v) => v != null && v > 0);
  const i0 = clean.indexOf(first), i1 = clean.lastIndexOf(last);
  if (first == null || last == null || i1 - i0 < 2) return null;
  return Math.pow(last / first, 1 / (i1 - i0)) - 1;
};
const yoyOf = (vals) => {
  const a = nn(vals.at(-2)), b = nn(vals.at(-1));
  return a && b != null ? (b - a) / Math.abs(a) : null;
};

function noteRow(ws, r, text) {
  setCell(ws, r, 2, text, { font: fontBase(C.greyDk, false, 9, ) });
  return r + 1;
}

/** Generic financial-statement sheet: label | FY cols | YoY | CAGR. */
function statementSheet(wb, title, lines, years, scale) {
  const ws = wb.addWorksheet(title, { views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 2;
  ws.getColumn(2).width = 38;
  for (let i = 0; i < years.length + 2; i++) ws.getColumn(3 + i).width = 13;
  let r = pageHeader(ws, title.toUpperCase(), `annual · all figures in ${scale.label} · YoY on latest year · CAGR over the full window`, years.length + 4);
  r++;
  // column headers
  setCell(ws, r, 2, `(${scale.label})`, STYLE.colHeader);
  years.forEach((y, i) => setCell(ws, r, 3 + i, fy(y), STYLE.colHeader));
  setCell(ws, r, 3 + years.length, "YoY", STYLE.colHeader);
  setCell(ws, r, 4 + years.length, `CAGR`, STYLE.colHeader);
  r++;
  for (const L of lines) {
    if (L.sec) { r = banner(ws, r, 2, 4 + years.length, L.label); continue; }
    const vals = years.map((_, i) => L.val(i));
    if (!vals.some((v) => nn(v) != null)) continue;
    const labStyle = L.strong ? STYLE.totalLabel : L.indent ? STYLE.rowLabelSub : STYLE.rowLabel;
    const valStyle = L.strong ? STYLE.total : STYLE.formula;
    setCell(ws, r, 2, L.label, labStyle);
    vals.forEach((v, i) => setCell(ws, r, 3 + i, L.eps ? nn(v) : D(v, scale.div), valStyle, L.eps ? NF.money2 : NF.money));
    setCell(ws, r, 3 + years.length, yoyOf(vals), valStyle, NF.pct1);
    setCell(ws, r, 4 + years.length, cagrOf(vals), valStyle, NF.pct1);
    r++;
  }
  ws.getRow(1).height = 24;
  return ws;
}

/* ════════════════════════ MAIN BUILDER ═════════════════════════ */
async function buildResearchWorkbook(pack) {
  const { co, forensicPack, riskPack, valuationPack, idcfPack, bands, peers } = pack;
  const wb = new ExcelJS.Workbook();
  wb.creator = "MERIDIAN Research Terminal";
  wb.created = new Date();
  const scale = scaleFor(co.currency);
  const st = co.statements || { income: [], balance: [], cashflow: [] };
  const years = st.income.map((x) => x.year);
  const I = (i, k) => nn(st.income[i]?.[k]);
  const balBy = Object.fromEntries((st.balance || []).map((x) => [x.year, x]));
  const cfBy = Object.fromEntries((st.cashflow || []).map((x) => [x.year, x]));
  const B = (i, k) => nn(balBy[years[i]]?.[k]);
  const Cf = (i, k) => nn(cfBy[years[i]]?.[k]);
  const z = (v) => (v == null ? 0 : v);

  /* ── 1. COVER ── */
  {
    const ws = wb.addWorksheet("Cover", { views: [{ showGridLines: false }] });
    ws.getColumn(1).width = 3; ws.getColumn(2).width = 34; ws.getColumn(3).width = 64;
    setCell(ws, 2, 2, "MERIDIAN", { font: fontBase(C.amber, true, 26) });
    setCell(ws, 3, 2, "CONSOLIDATED RESEARCH WORKBOOK", { font: fontBase(C.navy, true, 13) });
    let r = 5;
    const kv = (k, v) => { setCell(ws, r, 2, k, STYLE.rowLabelBold); setCell(ws, r, 3, v == null ? "—" : v, { font: fontBase(C.black, false, 10) }); r++; };
    kv("Company", co.name);
    kv("Ticker · Exchange", `${co.symbol} · ${co.exchange || "—"}`);
    kv("Sector", co.profile?.sector || "—");
    kv("Price at export", nn(co.price) != null ? `${co.currency === "INR" ? "₹" : ""}${(+co.price).toLocaleString("en-IN", { maximumFractionDigits: 2 })} ${co.currency || ""}` : "—");
    kv("Generated", new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC");
    kv("Reporting unit", scale.label);
    r++;
    r = banner(ws, r, 2, 3, "CONTENTS");
    ["Snapshot", "Income Statement", "Balance Sheet", "Cash Flow", "Ratios", "DuPont", "Growth & Variance", "Valuation", "Reverse DCF & Tornado", "Forensic", "Risk", "Peers", "Ownership"]
      .forEach((t, i) => { setCell(ws, r, 2, `${i + 2}.`, STYLE.rowLabelSub); setCell(ws, r, 3, t, STYLE.rowLabel); r++; });
    r++;
    setCell(ws, r, 2, "Nature of this export", STYLE.rowLabelBold); r++;
    setCell(ws, r, 2, "Computed-values export of the terminal's deterministic analytics — the exact figures on screen. For the live-formula", { font: fontBase(C.greyDk, false, 9) }); r++;
    setCell(ws, r, 2, "DCF model (editable assumptions, scenario switches, named ranges) use the Modeling Lab's dedicated Excel export.", { font: fontBase(C.greyDk, false, 9) });
  }

  /* ── 2. SNAPSHOT ── */
  {
    const ws = wb.addWorksheet("Snapshot", { views: [{ showGridLines: false }] });
    ws.getColumn(1).width = 2; ws.getColumn(2).width = 34; ws.getColumn(3).width = 20; ws.getColumn(4).width = 70;
    let r = pageHeader(ws, "COMPANY SNAPSHOT", `${co.name} · ${co.symbol}`, 5); r++;
    r = banner(ws, r, 2, 4, "PROFILE");
    const kv = (k, v, fmtd) => { setCell(ws, r, 2, k, STYLE.rowLabel); setCell(ws, r, 3, v == null ? "—" : v, STYLE.formula, fmtd); r++; };
    kv("Sector", co.profile?.sector);
    kv("Industry", co.profile?.industry);
    kv("Employees", nn(co.profile?.employees), NF.money);
    kv("Currency", co.currency);
    r++;
    r = banner(ws, r, 2, 4, "MARKET");
    kv("Price", nn(co.price), NF.money2);
    kv("Change %", nn(co.changePct) != null ? co.changePct / 100 : null, NF.pct2);
    kv("Market cap (" + scale.label + ")", D(co.ratios ? co.keyStats?.marketCap ?? null : null, scale.div) ?? D(co.keyStats?.marketCap, scale.div), NF.money);
    kv("Beta", nn(co.keyStats?.beta), NF.ratio);
    kv("52-week high", nn(co.keyStats?.high52), NF.money2);
    kv("52-week low", nn(co.keyStats?.low52), NF.money2);
    r++;
    if (co.profile?.summary) {
      r = banner(ws, r, 2, 4, "BUSINESS");
      String(co.profile.summary).match(/.{1,110}(\s|$)/g)?.slice(0, 10).forEach((line) => {
        setCell(ws, r, 2, line.trim(), { font: fontBase(C.black, false, 9) }); ws.mergeCells(r, 2, r, 4); r++;
      });
    }
  }

  /* ── 3–5. STATEMENTS ── */
  statementSheet(wb, "Income Statement", [
    { label: "Revenue", val: (i) => I(i, "revenue"), strong: true },
    { label: "Gross Profit", val: (i) => I(i, "grossProfit") },
    { label: "EBITDA", val: (i) => I(i, "ebitda"), strong: true },
    { label: "Depreciation & Amortization", val: (i) => Cf(i, "dep"), indent: 1 },
    { label: "Operating Income (EBIT)", val: (i) => I(i, "ebit") ?? I(i, "opIncome"), strong: true },
    { label: "Interest Expense", val: (i) => I(i, "interest"), indent: 1 },
    { label: "Pre-tax Income", val: (i) => I(i, "pretax") },
    { label: "Tax", val: (i) => I(i, "tax"), indent: 1 },
    { label: "Net Income", val: (i) => I(i, "netIncome"), strong: true },
    { label: "Basic EPS", val: (i) => I(i, "basicEPS"), eps: true },
  ], years, scale);

  statementSheet(wb, "Balance Sheet", [
    { sec: true, label: "ASSETS" },
    { label: "Total Assets", val: (i) => B(i, "assets"), strong: true },
    { label: "Current Assets", val: (i) => B(i, "currentAssets") },
    { label: "Cash & Equivalents", val: (i) => B(i, "cash"), indent: 1 },
    { label: "Receivables", val: (i) => B(i, "receivables"), indent: 1 },
    { label: "Inventory", val: (i) => B(i, "inventory"), indent: 1 },
    { label: "Net PP&E", val: (i) => B(i, "ppe") },
    { sec: true, label: "LIABILITIES & EQUITY" },
    { label: "Total Liabilities", val: (i) => B(i, "totalLiabilities"), strong: true },
    { label: "Current Liabilities", val: (i) => B(i, "currentLiab") },
    { label: "Short-Term Debt", val: (i) => B(i, "stDebt"), indent: 1 },
    { label: "Accounts Payable", val: (i) => B(i, "payables"), indent: 1 },
    { label: "Long-Term Debt", val: (i) => B(i, "ltDebt") },
    { label: "Total Equity", val: (i) => B(i, "equity"), strong: true },
    { label: "Share Capital", val: (i) => B(i, "shareCapital"), indent: 1 },
    { label: "Reserves & Surplus", val: (i) => (B(i, "equity") != null && B(i, "shareCapital") != null ? B(i, "equity") - B(i, "shareCapital") : null), indent: 1 },
  ], years, scale);

  statementSheet(wb, "Cash Flow", [
    { sec: true, label: "OPERATING" },
    { label: "Net Income", val: (i) => I(i, "netIncome") },
    { label: "Depreciation & Amortization", val: (i) => Cf(i, "dep"), indent: 1 },
    { label: "Working Capital Changes", val: (i) => Cf(i, "wcChange"), indent: 1 },
    { label: "Other Operating Items (plug)", val: (i) => (Cf(i, "ocf") != null && I(i, "netIncome") != null ? Cf(i, "ocf") - (I(i, "netIncome") + z(Cf(i, "dep")) + z(Cf(i, "wcChange")) + z(Cf(i, "deferredTax")) + z(Cf(i, "stockComp"))) : null), indent: 1 },
    { label: "Cash from Operations", val: (i) => Cf(i, "ocf"), strong: true },
    { sec: true, label: "INVESTING" },
    { label: "Capital Expenditure", val: (i) => Cf(i, "capex") },
    { label: "Acquisitions", val: (i) => Cf(i, "acquisitions"), indent: 1 },
    { label: "Cash from Investing", val: (i) => Cf(i, "investingCF"), strong: true },
    { sec: true, label: "FINANCING" },
    { label: "Debt Issued", val: (i) => Cf(i, "debtIssued"), indent: 1 },
    { label: "Debt Repaid", val: (i) => Cf(i, "debtRepaid"), indent: 1 },
    { label: "Buybacks", val: (i) => Cf(i, "buybacks"), indent: 1 },
    { label: "Dividends Paid", val: (i) => Cf(i, "dividends"), indent: 1 },
    { label: "Cash from Financing", val: (i) => Cf(i, "financingCF"), strong: true },
    { sec: true, label: "SUMMARY" },
    { label: "Free Cash Flow (OCF − Capex)", val: (i) => Cf(i, "fcf"), strong: true },
  ], years, scale);

  /* ── 6. RATIOS ── */
  {
    const ws = wb.addWorksheet("Ratios", { views: [{ showGridLines: false }] });
    ws.getColumn(1).width = 2; ws.getColumn(2).width = 30; ws.getColumn(3).width = 13; ws.getColumn(4).width = 90;
    let r = pageHeader(ws, "RATIO ANALYSIS", "full library · latest fiscal year · interpretation per line", 5); r++;
    const list = co.ratios || [];
    if (!list.length) r = noteRow(ws, r, "Ratio pack unavailable for this issuer.");
    let lastGroup = null;
    for (const x of list) {
      if (x.group !== lastGroup) { r = banner(ws, r, 2, 4, String(x.group || "").toUpperCase()); lastGroup = x.group; }
      setCell(ws, r, 2, x.name, STYLE.rowLabel);
      const isPct = x.fmt === "pct";
      setCell(ws, r, 3, isPct ? nn(x.value) / 100 : nn(x.value), STYLE.formula, isPct ? NF.pct1 : x.fmt === "x" ? NF.mult : NF.ratio);
      setCell(ws, r, 4, x.note || "", { font: fontBase(C.greyDk, false, 8.5) });
      r++;
    }
  }

  /* ── 7. DUPONT ── */
  {
    const ws = wb.addWorksheet("DuPont", { views: [{ showGridLines: false }] });
    ws.getColumn(1).width = 2; ws.getColumn(2).width = 34;
    years.forEach((_, i) => (ws.getColumn(3 + i).width = 12));
    let r = pageHeader(ws, "DUPONT DECOMPOSITION", "ROE = margin × turnover × leverage · exact log-attribution", years.length + 3); r++;
    const d = co.dupont;
    if (!d || !d.rows?.length) { noteRow(ws, r, "DuPont unavailable (insufficient statement history)."); }
    else {
      setCell(ws, r, 2, "", STYLE.colHeader);
      d.rows.forEach((row, i) => setCell(ws, r, 3 + i, fy(row.year), STYLE.colHeader)); r++;
      const line = (label, key, fmtd, strong) => {
        setCell(ws, r, 2, label, strong ? STYLE.totalLabel : STYLE.rowLabel);
        d.rows.forEach((row, i) => setCell(ws, r, 3 + i, fmtd === NF.pct1 ? nn(row[key]) / 100 : nn(row[key]), strong ? STYLE.total : STYLE.formula, fmtd));
        r++;
      };
      line("Net margin", "netMargin", NF.pct1);
      line("× Asset turnover", "turnover", NF.ratio);
      line("× Equity multiplier", "leverage", NF.ratio);
      line("= Return on Equity", "roe", NF.pct1, true);
      r = banner(ws, r + 1, 2, years.length + 2, "5-STAGE EXTENSION");
      line("Tax burden (NI/PBT)", "taxBurden", NF.ratio);
      line("Interest burden (PBT/EBIT)", "intBurden", NF.ratio);
      line("EBIT margin", "ebitMargin", NF.pct1);
      const a = d.attribution;
      if (a) {
        r++;
        r = banner(ws, r, 2, years.length + 2, `ROE CHANGE ATTRIBUTION — FY${String(a.fromYear).slice(2)} → FY${String(a.toYear).slice(2)} (exact, sums to total)`);
        [["Total ROE change", a.roeDeltaPp], ["… from margin", a.marginPp], ["… from asset turnover", a.turnoverPp], ["… from leverage", a.leveragePp]]
          .forEach(([k, v], idx) => { setCell(ws, r, 2, k, idx ? STYLE.rowLabelSub : STYLE.rowLabelBold); setCell(ws, r, 3, nn(v) / 100, idx ? STYLE.formula : STYLE.formulaBold, NF.pct2); r++; });
      }
    }
  }

  /* ── 8. GROWTH & VARIANCE ── */
  {
    const ws = wb.addWorksheet("Growth & Variance", { views: [{ showGridLines: false }] });
    ws.getColumn(1).width = 2; ws.getColumn(2).width = 40; ws.getColumn(3).width = 14; ws.getColumn(4).width = 84;
    let r = pageHeader(ws, "GROWTH & VARIANCE", "multi-year compounding + latest-year drivers", 5); r++;
    r = banner(ws, r, 2, 4, "GROWTH");
    const g = co.growth || {};
    [["Revenue CAGR (window)", g.revCagr], ["Net income CAGR (window)", g.niCagr], ["Revenue YoY", g.revYoy], ["Net income YoY", g.niYoy], ["FCF YoY", g.fcfYoy], ["Cash conversion (OCF/NI)", g.cashConversion]]
      .forEach(([k, v]) => { setCell(ws, r, 2, k, STYLE.rowLabel); setCell(ws, r, 3, nn(v) != null ? v / 100 : null, STYLE.formula, NF.pct1); r++; });
    r++;
    r = banner(ws, r, 2, 4, "VARIANCE DRIVERS — LATEST YEAR");
    const drivers = co.variance?.drivers || [];
    if (!drivers.length) r = noteRow(ws, r, "Variance drivers unavailable.");
    for (const dr of drivers) {
      setCell(ws, r, 2, dr.label, STYLE.rowLabel);
      const isPct = dr.unit === "%" || dr.unit === "pp";
      setCell(ws, r, 3, isPct ? nn(dr.value) / 100 : nn(dr.value), STYLE.formula, isPct ? NF.pct1 : NF.money1);
      setCell(ws, r, 4, dr.unit === "pp" ? "percentage points" : "", { font: fontBase(C.greyDk, false, 8.5) });
      r++;
    }
    if (co.variance?.commentary) {
      r++;
      setCell(ws, r, 2, "Commentary", STYLE.rowLabelBold); r++;
      String(co.variance.commentary).match(/.{1,120}(\s|$)/g)?.forEach((line) => { setCell(ws, r, 2, line.trim(), { font: fontBase(C.black, false, 9) }); ws.mergeCells(r, 2, r, 4); r++; });
    }
  }

  /* ── 9. VALUATION (methods + bands) ── */
  {
    const ws = wb.addWorksheet("Valuation", { views: [{ showGridLines: false }] });
    ws.getColumn(1).width = 2; ws.getColumn(2).width = 30; ws.getColumn(3).width = 15; ws.getColumn(4).width = 46; ws.getColumn(5).width = 52;
    let r = pageHeader(ws, "MULTI-METHOD VALUATION", "per-share outputs by method (football-field inputs) · historical multiple bands", 6); r++;
    r = banner(ws, r, 2, 5, "METHODS — VALUE PER SHARE");
    const methods = valuationPack?.valuation?.methods || [];
    if (!methods.length) r = noteRow(ws, r, "Valuation methods unavailable (upstream data missing at export time).");
    setCell(ws, r, 2, "Method", STYLE.colHeader); setCell(ws, r, 3, "Per share", STYLE.colHeader); setCell(ws, r, 4, "Key inputs", STYLE.colHeader); setCell(ws, r, 5, "Note", STYLE.colHeader); r++;
    for (const m of methods) {
      setCell(ws, r, 2, m.name, STYLE.rowLabel);
      setCell(ws, r, 3, nn(m.value), STYLE.formula, NF.money2);
      setCell(ws, r, 4, m.inputs ? Object.entries(m.inputs).map(([k, v]) => `${k}=${v}`).join(" · ").slice(0, 90) : "", { font: fontBase(C.greyDk, false, 8.5) });
      setCell(ws, r, 5, (m.note || "").slice(0, 100), { font: fontBase(C.greyDk, false, 8.5) });
      r++;
    }
    setCell(ws, r, 2, "Current price", STYLE.totalLabel); setCell(ws, r, 3, nn(co.price), STYLE.total, NF.money2); r += 2;
    r = banner(ws, r, 2, 5, "HISTORICAL MULTIPLE BANDS — 5Y MONTHLY, TRAILING FY DENOMINATORS");
    if (!bands || !bands.available) { r = noteRow(ws, r, "Bands unavailable: " + (bands?.reason || "history not retrievable at export time")); }
    else {
      setCell(ws, r, 2, "", STYLE.colHeader); ["Current", "Percentile", "Min", "25th", "Median", "75th", "Max"].forEach((h, i) => setCell(ws, r, 3 + i, h, STYLE.colHeader));
      ws.getColumn(4).width = 12; ws.getColumn(5).width = 10; ws.getColumn(6).width = 10; ws.getColumn(7).width = 10; ws.getColumn(8).width = 10; ws.getColumn(9).width = 10;
      r++;
      for (const [label, b] of [["Trailing P/E", bands.pe], ["Price / Book", bands.pb]]) {
        if (!b) continue;
        setCell(ws, r, 2, label, STYLE.rowLabel);
        [b.current, null, b.min, b.p25, b.med, b.p75, b.max].forEach((v, i) => {
          if (i === 1) setCell(ws, r, 4, b.pctile != null ? `P${b.pctile}` : "—", STYLE.formula);
          else setCell(ws, r, 3 + i, nn(v), STYLE.formula, NF.mult);
        });
        r++;
      }
      r = noteRow(ws, r + 1, bands.note || "");
    }
  }

  /* ── 10. REVERSE DCF & TORNADO ── */
  {
    const ws = wb.addWorksheet("Reverse DCF & Tornado", { views: [{ showGridLines: false }] });
    ws.getColumn(1).width = 2; ws.getColumn(2).width = 36; ws.getColumn(3).width = 16; ws.getColumn(4).width = 16; ws.getColumn(5).width = 16; ws.getColumn(6).width = 16;
    let r = pageHeader(ws, "REVERSE DCF & TORNADO", "market-implied expectations · one-way driver sensitivity (evidence-based assumption set)", 7); r++;
    const rev = idcfPack?.reverse, tor = idcfPack?.tornado;
    r = banner(ws, r, 2, 6, "REVERSE DCF — WHAT THE PRICE IMPLIES");
    if (!rev || rev.error) r = noteRow(ws, r, "Reverse DCF unavailable at export time" + (rev?.error ? ` (${rev.error})` : "."));
    else {
      const kv = (k, v, fmtd, sub) => { setCell(ws, r, 2, k, STYLE.rowLabel); setCell(ws, r, 3, v, STYLE.formulaBold, fmtd); if (sub) setCell(ws, r, 4, sub, { font: fontBase(C.greyDk, false, 8.5) }); r++; };
      kv("Market-implied growth (Y1–5)", rev.impliedGrowthBounded ? rev.impliedGrowth / 100 : null, NF.pct2, rev.impliedGrowthBounded ? `vs assumed ${rev.assumedGrowth}%` : `outside solver bounds (${rev.impliedGrowthSide})`);
      kv("Market-implied WACC", rev.impliedWaccBounded ? rev.impliedWacc / 100 : null, NF.pct2, `vs model WACC ${rev.assumedWacc}%`);
      kv("Model value per share", nn(rev.basePerShare), NF.money2);
      kv("Market price", nn(rev.currentPrice), NF.money2);
    }
    r++;
    r = banner(ws, r, 2, 6, "TORNADO — VALUE-PER-SHARE SWING PER DRIVER (SORTED)");
    if (!tor || tor.error || !tor.bars?.length) r = noteRow(ws, r, "Tornado unavailable at export time.");
    else {
      ["Driver", "Step ±pp", "Low value", "High value", "Swing", "Swing %"].forEach((h, i) => setCell(ws, r, 2 + i, h, STYLE.colHeader)); r++;
      for (const b of tor.bars) {
        setCell(ws, r, 2, b.label, STYLE.rowLabel);
        setCell(ws, r, 3, nn(b.step), STYLE.formula, NF.ratio);
        setCell(ws, r, 4, nn(b.lowPx), STYLE.formula, NF.money2);
        setCell(ws, r, 5, nn(b.highPx), STYLE.formula, NF.money2);
        setCell(ws, r, 6, nn(b.swing), STYLE.formula, NF.money2);
        setCell(ws, r, 7, nn(b.swingPct) != null ? b.swingPct / 100 : null, STYLE.formula, NF.pct1);
        r++;
      }
      setCell(ws, r, 2, "Base value per share", STYLE.totalLabel); setCell(ws, r, 4, nn(tor.basePerShare), STYLE.total, NF.money2); r++;
    }
  }

  /* ── 11. FORENSIC ── */
  {
    const ws = wb.addWorksheet("Forensic", { views: [{ showGridLines: false }] });
    ws.getColumn(1).width = 2; ws.getColumn(2).width = 42; ws.getColumn(3).width = 13; ws.getColumn(4).width = 44; ws.getColumn(5).width = 30;
    let r = pageHeader(ws, "FORENSIC ANALYSIS", "Piotroski F-Score · Altman Z · Beneish M · earnings quality", 6); r++;
    const f = forensicPack?.forensic;
    if (!f) { noteRow(ws, r, "Forensic pack unavailable for this issuer."); }
    else {
      r = banner(ws, r, 2, 5, `PIOTROSKI F-SCORE — ${f.piotroski.score}/${f.piotroski.max} (${f.piotroski.grade})`);
      ["Test", "Pass", "Detail", "Benchmark"].forEach((h, i) => setCell(ws, r, 2 + i, h, STYLE.colHeader)); r++;
      for (const p of f.piotroski.components || []) {
        setCell(ws, r, 2, p.t, STYLE.rowLabel);
        setCell(ws, r, 3, p.ok ? "PASS" : "FAIL", { font: fontBase(p.ok ? C.green : C.red, true, 10), alignment: { horizontal: "center" } });
        setCell(ws, r, 4, p.detail || "", { font: fontBase(C.greyDk, false, 8.5) });
        setCell(ws, r, 5, p.benchmark || "", { font: fontBase(C.greyDk, false, 8.5) });
        r++;
      }
      r++;
      r = banner(ws, r, 2, 5, `ALTMAN Z-SCORE — ${f.altman.score ?? "—"} (${f.altman.zone || "—"})`);
      for (const [k, v] of Object.entries(f.altman.components || {})) {
        setCell(ws, r, 2, k, STYLE.rowLabel); setCell(ws, r, 3, nn(v), STYLE.formula, NF.ratio);
        setCell(ws, r, 4, `weight ${f.altman.weights?.[k] ?? ""} · ${f.altman.benchmarks?.[k] ?? ""}`, { font: fontBase(C.greyDk, false, 8.5) }); r++;
      }
      r++;
      r = banner(ws, r, 2, 5, `BENEISH M-SCORE — ${f.beneish.score ?? "—"} (${f.beneish.flag || "—"} · threshold ${f.beneish.threshold})`);
      for (const [k, v] of Object.entries(f.beneish.components || {})) {
        setCell(ws, r, 2, k, STYLE.rowLabel); setCell(ws, r, 3, nn(v), STYLE.formula, NF.ratio);
        setCell(ws, r, 4, f.beneish.benchmarks?.[k] || "", { font: fontBase(C.greyDk, false, 8.5) }); r++;
      }
      r++;
      r = banner(ws, r, 2, 5, `EARNINGS QUALITY — GRADE ${f.earningsQualityGrade || "—"}`);
      [["Cash conversion (OCF/NI)", f.cash?.cashConversion, NF.ratio], ["FCF margin", f.cash?.fcfMargin != null ? f.cash.fcfMargin / 100 : null, NF.pct1], ["Accrual ratio", f.cash?.accrualRatio != null ? f.cash.accrualRatio / 100 : null, NF.pct1]]
        .forEach(([k, v, fm]) => { setCell(ws, r, 2, k, STYLE.rowLabel); setCell(ws, r, 3, nn(v), STYLE.formula, fm); r++; });
      const flags = forensicPack?.flags || [];
      if (flags.length) {
        r++;
        r = banner(ws, r, 2, 5, "RED FLAGS");
        for (const fl of flags) {
          setCell(ws, r, 2, fl.title || fl.t || String(fl).slice(0, 60), STYLE.rowLabelBold);
          setCell(ws, r, 4, (fl.detail || fl.reason || "").slice(0, 110), { font: fontBase(C.red, false, 8.5) });
          r++;
        }
      }
    }
  }

  /* ── 12. RISK ── */
  {
    const ws = wb.addWorksheet("Risk", { views: [{ showGridLines: false }] });
    ws.getColumn(1).width = 2; ws.getColumn(2).width = 16; ws.getColumn(3).width = 40; ws.getColumn(4).width = 8; ws.getColumn(5).width = 8; ws.getColumn(6).width = 10; ws.getColumn(7).width = 88;
    let r = pageHeader(ws, "RISK ASSESSMENT", `composite ${riskPack?.risk?.compositeScore ?? "—"}/100 · ${riskPack?.risk?.compositeBand ?? ""}`, 8); r++;
    const risk = riskPack?.risk;
    if (!risk) { noteRow(ws, r, "Risk pack unavailable for this issuer."); }
    else {
      r = banner(ws, r, 2, 7, "RISK REGISTER — SORTED BY SEVERITY (PROBABILITY × IMPACT, 1–5 EACH)");
      ["Category", "Risk", "Prob", "Impact", "Severity", "Evidence"].forEach((h, i) => setCell(ws, r, 2 + i, h, STYLE.colHeader)); r++;
      for (const x of risk.risks || []) {
        setCell(ws, r, 2, x.category, STYLE.rowLabelSub);
        setCell(ws, r, 3, x.title, STYLE.rowLabel);
        setCell(ws, r, 4, nn(x.prob), STYLE.formula, NF.money);
        setCell(ws, r, 5, nn(x.impact), STYLE.formula, NF.money);
        setCell(ws, r, 6, nn(x.severity), x.severity >= 15 ? { font: fontBase(C.red, true, 10), alignment: { horizontal: "right" } } : STYLE.formulaBold, NF.money);
        setCell(ws, r, 7, (x.evidence || "").slice(0, 130), { font: fontBase(C.greyDk, false, 8.5) });
        r++;
      }
      if (risk.scenarios) {
        r++;
        r = banner(ws, r, 2, 7, "SCENARIOS");
        for (const [k, v] of Object.entries(risk.scenarios)) {
          setCell(ws, r, 2, k, STYLE.rowLabelBold);
          setCell(ws, r, 3, typeof v === "object" ? JSON.stringify(v).slice(0, 140) : String(v).slice(0, 140), { font: fontBase(C.greyDk, false, 8.5) });
          r++;
        }
      }
      if (risk.dailyVar95 != null) { r++; setCell(ws, r, 2, "1-day VaR (95%, beta-based)", STYLE.rowLabel); setCell(ws, r, 3, risk.dailyVar95 / 100, STYLE.formula, NF.pct1); }
    }
  }

  /* ── 13. PEERS ── */
  {
    const ws = wb.addWorksheet("Peers", { views: [{ showGridLines: false }] });
    ws.getColumn(1).width = 2; ws.getColumn(2).width = 26;
    const cols = [["P/E", "pe", NF.mult], ["EV/EBITDA", "evEbitda", NF.mult], ["P/B", "pb", NF.mult], ["ROE %", "roe", NF.pct1, true], ["Net margin %", "netMargin", NF.pct1, true], ["Rev growth %", "revGrowth", NF.pct1, true], ["D/E", "de", NF.ratio], ["Div yield %", "divYield", NF.pct1, true]];
    cols.forEach((_, i) => (ws.getColumn(3 + i).width = 12));
    let r = pageHeader(ws, "COMPARABLE COMPANIES", "self first · Yahoo consensus metrics", cols.length + 3); r++;
    if (!peers || !peers.length) { noteRow(ws, r, "Peer set unavailable at export time."); }
    else {
      setCell(ws, r, 2, "Company", STYLE.colHeader);
      cols.forEach(([h], i) => setCell(ws, r, 3 + i, h, STYLE.colHeader)); r++;
      for (const p of peers) {
        const self = p.symbol === co.symbol;
        setCell(ws, r, 2, `${p.symbol}${self ? " ◀" : ""}`, self ? STYLE.rowLabelBold : STYLE.rowLabel);
        cols.forEach(([, k, fm, isPct], i) => setCell(ws, r, 3 + i, isPct ? (nn(p[k]) != null ? p[k] / 100 : null) : nn(p[k]), self ? STYLE.formulaBold : STYLE.formula, fm));
        r++;
      }
    }
  }

  /* ── 14. OWNERSHIP ── */
  {
    const ws = wb.addWorksheet("Ownership", { views: [{ showGridLines: false }] });
    ws.getColumn(1).width = 2; ws.getColumn(2).width = 44; ws.getColumn(3).width = 16; ws.getColumn(4).width = 16; ws.getColumn(5).width = 16; ws.getColumn(6).width = 16;
    let r = pageHeader(ws, "OWNERSHIP", "institutional holders", 7); r++;
    const own = co.ownership || {};
    if (own.topInstitutions?.length) {
      r = banner(ws, r, 2, 6, "TOP INSTITUTIONAL HOLDERS");
      for (const h of own.topInstitutions) { setCell(ws, r, 2, h.name, STYLE.rowLabel); setCell(ws, r, 3, nn(h.pctHeld) != null ? h.pctHeld : null, STYLE.formula, NF.pct2); r++; }
      r++;
    }
    if (r <= 5) noteRow(ws, 5, "No ownership disclosures retrievable at export time.");
  }

  return wb;
}

module.exports = { buildResearchWorkbook };
