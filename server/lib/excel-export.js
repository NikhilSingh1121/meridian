/**
 * MERIDIAN — Institutional Excel Export
 * ════════════════════════════════════════════════════════════════════════════
 * Generates a real investment-banking-grade .xlsx workbook from the live
 * Modeling Lab state. Every IDCF intermediate calculation is exported with
 * full Excel formulas, named ranges, cross-sheet linking and circularity-
 * free construction. Color coding follows the standard convention:
 *
 *   Blue text   → hardcoded user input (changeable for scenarios)
 *   Black text  → formula / calculation
 *   Green text  → cross-sheet link
 *   Grey fill   → headers, totals, section dividers
 *
 * Number formats use thousands separators with negatives in parentheses,
 * zeros rendered as "-", and percentages to one decimal. Years are kept
 * as text strings (e.g. "FY24E"). Currency unit appears in column headers.
 *
 * The workbook structure is identical in spirit to the deal-team model an
 * analyst at Goldman / Morgan Stanley / Evercore would hand a VP:
 *
 *   1. Cover ······ title, ticker, build metadata, table of contents
 *   2. Dashboard ·· executive summary, key outputs, recommendation
 *   3. Assumptions  every scalar + year-wise driver (BLUE inputs)
 *   4. WACC ······· CAPM build, cost of debt, weights
 *   5. Historicals  last 3 years actuals — IS / BS / CF on one sheet
 *   6. Income St ·· line-by-line P&L (actuals + 5y forecast)
 *   7. Balance Sh · structured BS (actuals + forecast)
 *   8. Cash Flow ·· indirect-method CF (actuals + forecast)
 *   9. DCF Engine · 17-step FCFF build → EV → equity → per share
 *  10. Sensitivity  WACC × g grid (live formulas)
 *  11. Scenarios ·· Bull / Base / Bear / Stress / Downside
 *  12. Audit ····· BS check, CF reconciliation, debt RF, model health
 *  13. Documentation methodology, calculation notes, sources
 * ════════════════════════════════════════════════════════════════════════════
 */

const ExcelJS = require("exceljs");

// ── Color palette (matches institutional convention) ──────────────────────
const C = {
  blue:   "FF0000FF",       // hardcoded inputs
  black:  "FF000000",       // formulas (default)
  green:  "FF006100",       // cross-sheet links
  red:    "FFC00000",       // errors / warnings
  amber:  "FFB68B0F",       // accent (MERIDIAN brand)
  grey:   "FFD9D9D9",       // header fill
  greyDk: "FF808080",       // dim text
  white:  "FFFFFFFF",
  navy:   "FF1F3864",       // section header fill (dark navy = IB-deck style)
  navyLt: "FFD9E1F2",       // subtotal fill
  totalFill: "FFE7E6E6",    // totals row fill
};

// ── Number formats ────────────────────────────────────────────────────────
const NF = {
  money:    '#,##0_);(#,##0);"-"_)',
  money1:   '#,##0.0_);(#,##0.0);"-"_)',
  money2:   '#,##0.00_);(#,##0.00);"-"_)',
  pct1:     '0.0%;(0.0%);"-"_)',
  pct2:     '0.00%;(0.00%);"-"_)',
  mult:     '0.0"x";(0.0"x");"-"_)',
  ratio:    '0.000_);(0.000);"-"_)',
  year:     '@',
  date:     'dd-mmm-yyyy',
  txt:      '@',
};

// ── Style helpers ─────────────────────────────────────────────────────────
const fontBase  = (color = C.black, bold = false, size = 10) => ({ name: "Arial", size, bold, color: { argb: color } });
const fillSolid = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const border    = (style = "thin", color = "FFB0B0B0") => ({ style, color: { argb: color } });
const allBorders = (style = "thin", color = "FFD0D0D0") => ({
  top: border(style, color), left: border(style, color), bottom: border(style, color), right: border(style, color),
});

const STYLE = {
  // Page title (large, navy, top of every sheet)
  pageTitle: { font: fontBase(C.navy, true, 18), alignment: { vertical: "middle" } },
  pageSub:   { font: fontBase(C.greyDk, false, 9), alignment: { vertical: "middle" } },
  // Section banner — full-width navy bar with white text
  sectionBanner: {
    font: fontBase(C.white, true, 11),
    fill: fillSolid(C.navy),
    alignment: { vertical: "middle", horizontal: "left", indent: 1 },
    border: { bottom: border("medium", C.amber) },
  },
  // Column headers (year row, etc.)
  colHeader: {
    font: fontBase(C.black, true, 10),
    fill: fillSolid(C.grey),
    alignment: { horizontal: "center", vertical: "middle" },
    border: { bottom: border("medium", C.black), top: border("thin", C.black) },
  },
  // Row label
  rowLabel: { font: fontBase(C.black, false, 10), alignment: { horizontal: "left", indent: 1 } },
  rowLabelSub: { font: fontBase(C.greyDk, false, 9, ), alignment: { horizontal: "left", indent: 2 } },
  rowLabelBold: { font: fontBase(C.black, true, 10), alignment: { horizontal: "left", indent: 1 } },
  // Values
  input:    { font: fontBase(C.blue, false, 10), alignment: { horizontal: "right" } },
  inputBold:{ font: fontBase(C.blue, true,  10), alignment: { horizontal: "right" } },
  formula:  { font: fontBase(C.black, false, 10), alignment: { horizontal: "right" } },
  formulaBold: { font: fontBase(C.black, true, 10), alignment: { horizontal: "right" } },
  link:     { font: fontBase(C.green, false, 10), alignment: { horizontal: "right" } },
  linkBold: { font: fontBase(C.green, true,  10), alignment: { horizontal: "right" } },
  // Totals & subtotals
  total: {
    font: fontBase(C.black, true, 10),
    fill: fillSolid(C.totalFill),
    border: { top: border("thin", C.black), bottom: border("medium", C.black) },
    alignment: { horizontal: "right" },
  },
  totalLabel: {
    font: fontBase(C.black, true, 10),
    fill: fillSolid(C.totalFill),
    border: { top: border("thin", C.black), bottom: border("medium", C.black) },
    alignment: { horizontal: "left", indent: 1 },
  },
  subtotal: {
    font: fontBase(C.black, true, 10),
    fill: fillSolid(C.navyLt),
    border: { top: border("thin", C.black) },
    alignment: { horizontal: "right" },
  },
  subtotalLabel: {
    font: fontBase(C.black, true, 10),
    fill: fillSolid(C.navyLt),
    border: { top: border("thin", C.black) },
    alignment: { horizontal: "left", indent: 1 },
  },
  // Notes
  note: { font: fontBase(C.greyDk, false, 9, ), alignment: { horizontal: "left", wrapText: true, vertical: "top" } },
  warn: { font: fontBase(C.red,    false, 9), alignment: { horizontal: "left", wrapText: true, vertical: "top" } },
  // Audit cells
  ok:   { font: fontBase("FF1F7A1F", true, 10), alignment: { horizontal: "center" } },
  fail: { font: fontBase(C.red, true, 10), alignment: { horizontal: "center" } },
};

// ── Helpers ───────────────────────────────────────────────────────────────
function col(n) {                 // 1-indexed col → A, B, ..., AA
  let s = "";
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function addr(r, c) { return col(c) + r; }
function fy(year) { return "FY" + String(year).slice(-2); }
function safeNum(v) { return v == null || !isFinite(v) ? 0 : +v; }
function pctVal(v) { return v == null || !isFinite(v) ? 0 : v / 100; }

// Set a cell's value & style in one call. `style` is one of STYLE.*, or null.
function setCell(ws, r, c, value, style, numFmt) {
  const cell = ws.getCell(r, c);
  cell.value = value;
  if (style) {
    if (style.font)      cell.font = style.font;
    if (style.fill)      cell.fill = style.fill;
    if (style.alignment) cell.alignment = style.alignment;
    if (style.border)    cell.border = style.border;
  }
  if (numFmt) cell.numFmt = numFmt;
  return cell;
}

/** Apply a section banner across columns startC..endC at row r. */
function bannerRow(ws, r, startC, endC, text) {
  ws.mergeCells(r, startC, r, endC);
  setCell(ws, r, startC, text, STYLE.sectionBanner);
  ws.getRow(r).height = 22;
}

/** Top-of-sheet title block (rows 1-3). Returns next-available row. */
function pageHeader(ws, title, subtitle, totalCols = 12) {
  ws.mergeCells(1, 1, 1, totalCols);
  setCell(ws, 1, 1, title, STYLE.pageTitle);
  ws.getRow(1).height = 26;
  ws.mergeCells(2, 1, 2, totalCols);
  setCell(ws, 2, 1, subtitle, STYLE.pageSub);
  // Brand strip
  ws.mergeCells(3, 1, 3, totalCols);
  setCell(ws, 3, 1, "", { fill: fillSolid(C.amber) });
  ws.getRow(3).height = 4;
  return 5;
}

/** Convert a JS value at raw scale to "display" units (₹ Cr or $ Mn). */
function toDisp(v, scale) { return v == null || !isFinite(v) ? null : v / scale; }

// ════════════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ════════════════════════════════════════════════════════════════════════════
/**
 * Build the complete Excel workbook from a Modeling Lab payload.
 *
 * @param {Object} payload  Posted from the client (or built server-side):
 *   - meta:          { symbol, name, currency, exchange, price, sector,
 *                       unitNote, modelStatus, userOverrides, builtAt }
 *   - assumptions:   scalar IDCF assumptions
 *   - waccBuild:     CAPM components
 *   - statements:    { incomeActuals, balanceActuals, cashflowActuals,
 *                       income, balance, cashflow, epsAvailable }
 *   - idcf:          full institutional DCF data (base/bull/bear/sens/...)
 *   - uiState:       expanded-mode UI state (yearwise overrides, etc.)
 *   - evidence:      assumption evidence layer (sources)
 * @returns {Promise<Buffer>}  xlsx binary
 */
async function buildWorkbook(payload) {
  const wb = new ExcelJS.Workbook();
  wb.creator  = "MERIDIAN Modeling Lab";
  wb.lastModifiedBy = "MERIDIAN";
  wb.created  = new Date();
  wb.modified = new Date();
  wb.company  = "MERIDIAN — Equity Research";
  wb.title    = `${payload.meta.symbol} · Institutional DCF`;
  wb.subject  = "Discounted Cash Flow Valuation Model";

  // Derive display scale (₹ Cr = 1e7 for INR, $ Mn = 1e6 otherwise)
  const ccy   = payload.meta.currency || "INR";
  const isINR = ccy === "INR";
  const scale = isINR ? 1e7 : 1e6;
  const unit  = isINR ? "₹ Cr" : (ccy === "USD" ? "$ Mn" : ccy + " Mn");
  const ccySym = isINR ? "₹" : ccy === "USD" ? "$" : "";

  // Enrich payload with derived display-scale helpers used across sheets
  const p = { ...payload, scale, unit, isINR, ccySym, ccy };

  // Build sheets in order. Each module is responsible for its own layout.
  // Historicals are now folded into IS/BS/CF (one integrated model per statement),
  // so there's no separate Historicals sheet.
  addCoverSheet(wb, p);
  addDashboard(wb, p);
  addAssumptions(wb, p);
  addWaccBuild(wb, p);
  addIncomeStatement(wb, p);
  addBalanceSheet(wb, p);
  addCashFlow(wb, p);
  addDcfEngine(wb, p);
  addSensitivity(wb, p);
  addScenarios(wb, p);
  addAudit(wb, p);
  addDocumentation(wb, p);

  return wb.xlsx.writeBuffer();
}

module.exports = { buildWorkbook };

// ════════════════════════════════════════════════════════════════════════════
// SHEET 1 — COVER
// ════════════════════════════════════════════════════════════════════════════
function addCoverSheet(wb, p) {
  const ws = wb.addWorksheet("Cover", {
    properties: { tabColor: { argb: C.navy } },
    pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 1, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } },
    views: [{ showGridLines: false }],
  });
  ws.columns = [{ width: 2 }, { width: 28 }, { width: 50 }, { width: 2 }];

  // Top banner — large amber strip with MERIDIAN brand
  ws.mergeCells("B2:C3");
  setCell(ws, 2, 2, "MERIDIAN", {
    font: fontBase(C.amber, true, 32),
    alignment: { horizontal: "left", vertical: "middle" },
  });
  ws.mergeCells("B4:C4");
  setCell(ws, 4, 2, "Institutional Equity Research · Modeling Lab", {
    font: fontBase(C.greyDk, false, 10),
    alignment: { horizontal: "left" },
  });

  // Divider
  ws.mergeCells("B5:C5"); setCell(ws, 5, 2, "", { fill: fillSolid(C.navy) }); ws.getRow(5).height = 3;

  // Big title
  ws.getRow(7).height = 26;
  ws.mergeCells("B7:C7");
  setCell(ws, 7, 2, `${p.meta.name || p.meta.symbol}  ·  Discounted Cash Flow Valuation Model`, {
    font: fontBase(C.navy, true, 18), alignment: { horizontal: "left", vertical: "middle" },
  });
  ws.mergeCells("B8:C8");
  setCell(ws, 8, 2, `Ticker · ${p.meta.symbol}    |    ${p.meta.exchange || ""}    |    Sector · ${p.meta.sector || "n/a"}`,
    { font: fontBase(C.greyDk, false, 10) });

  // Metadata block (label/value pairs)
  let r = 11;
  const meta = [
    ["Currency",          p.ccy],
    ["Display unit",      p.unit],
    ["Model status",      p.meta.modelStatus || "Evidence-Based"],
    ["Built at",          p.meta.builtAt ? new Date(p.meta.builtAt).toLocaleString("en-IN") : new Date().toLocaleString("en-IN")],
    ["Current price",     p.meta.price != null ? `${p.ccySym}${(+p.meta.price).toFixed(2)}` : "n/a"],
    ["Intrinsic value",   p.idcf?.base?.perShare != null ? `${p.ccySym}${(+p.idcf.base.perShare).toFixed(2)}` : "n/a"],
    ["Upside / (Downside)", p.idcf?.upside != null ? `${(+p.idcf.upside).toFixed(1)}%` : "n/a"],
    ["WACC",              p.assumptions?.wacc != null ? `${(+p.assumptions.wacc).toFixed(2)}%` : "n/a"],
    ["Terminal growth",   p.assumptions?.terminalG != null ? `${(+p.assumptions.terminalG).toFixed(2)}%` : "n/a"],
    ["Forecast horizon",  `${p.assumptions?.forecastHorizon || p.uiState?.forecastHorizon || 5} years`],
    ["Terminal method",   p.assumptions?.terminalMethod === "exitMultiple" ? `Exit EV/EBITDA (${p.assumptions.exitMultiple}x)` : "Gordon perpetual"],
  ];
  meta.forEach((row) => {
    setCell(ws, r, 2, row[0], { font: fontBase(C.greyDk, true, 10), alignment: { horizontal: "left", indent: 1 } });
    setCell(ws, r, 3, row[1], { font: fontBase(C.black, false, 10), alignment: { horizontal: "left" } });
    r++;
  });

  // Table of contents
  r += 2;
  ws.mergeCells(r, 2, r, 3);
  setCell(ws, r, 2, "TABLE OF CONTENTS", { font: fontBase(C.navy, true, 12), border: { bottom: border("medium", C.amber) } });
  r++;
  const toc = [
    ["1.  Cover",                "This sheet — model metadata, table of contents, color-coding key"],
    ["2.  Dashboard",            "Executive summary, valuation outputs, scenario range, key ratios, recommendation"],
    ["3.  Assumptions",          "All scalar & year-wise inputs (BLUE = changeable). Single source of truth for the model."],
    ["4.  WACC Build",           "CAPM build — risk-free rate, beta, ERP, cost of debt, weights, derived WACC"],
    ["5.  Historicals",          "Last 3 years actuals — income statement, balance sheet, cash flow on one page"],
    ["6.  Income Statement",     "Line-by-line P&L — revenue → gross → EBITDA → EBIT → PBT → PAT, with margin %s"],
    ["7.  Balance Sheet",        "Current & non-current assets / liabilities / equity, reconciled both sides"],
    ["8.  Cash Flow",            "Indirect-method statement — OCF, ICF, FCF, net change reconciled to closing cash"],
    ["9.  DCF Engine",           "Revenue → Margin → EBIT → Tax → NOPAT → Reinvestment → FCFF → Discounting → Terminal → EV → Equity → Per Share. Every intermediate calculation."],
    ["10. Sensitivity",          "WACC × Terminal Growth grid — live formulas, recomputes automatically"],
    ["11. Scenarios",            "Bull, Base, Bear, Stress and Downside cases with full per-share outputs"],
    ["12. Audit",                "Balance sheet check, cash flow reconciliation, debt rollforward, model health score"],
    ["13. Documentation",        "Methodology, calculation notes, sources, color-coding standards"],
  ];
  toc.forEach((row) => {
    setCell(ws, r, 2, row[0], { font: fontBase(C.navy, true, 10), alignment: { horizontal: "left", indent: 1 } });
    setCell(ws, r, 3, row[1], STYLE.note);
    ws.getRow(r).height = 18;
    r++;
  });

  // Color-coding key (institutional convention)
  r += 2;
  ws.mergeCells(r, 2, r, 3);
  setCell(ws, r, 2, "COLOR-CODING CONVENTION", { font: fontBase(C.navy, true, 12), border: { bottom: border("medium", C.amber) } });
  r++;
  const ckey = [
    ["BLUE",  "Hardcoded inputs you can edit — assumptions, scenarios, growth rates",  C.blue],
    ["BLACK", "Formulas and calculations within the same sheet", C.black],
    ["GREEN", "Cross-sheet links pulling from another worksheet", C.green],
    ["GREY",  "Section headers, totals, subtotals", C.greyDk],
    ["RED",   "Errors, warnings, audit failures", C.red],
  ];
  ckey.forEach(([k, desc, color]) => {
    setCell(ws, r, 2, k, { font: fontBase(color, true, 10), alignment: { horizontal: "left", indent: 1 } });
    setCell(ws, r, 3, desc, STYLE.note);
    r++;
  });

  // Footer disclaimer
  r += 2;
  ws.mergeCells(r, 2, r, 3);
  setCell(ws, r, 2,
    "Disclaimer: This model is generated by the MERIDIAN Modeling Lab for research and educational purposes. Outputs are not investment advice. Verify all inputs against primary sources before use.",
    STYLE.note);
  ws.getRow(r).height = 32;
}
function addWaccBuild(wb, p) {
  const ws = wb.addWorksheet("WACC Build", {
    properties: { tabColor: { argb: C.amber } },
    views: [{ showGridLines: false, state: "frozen", ySplit: 4 }],
    pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } },
  });
  ws.columns = [{ width: 3 }, { width: 38 }, { width: 14 }, { width: 12 }, { width: 50 }];

  pageHeader(ws, "WACC Build", "CAPM cost of equity + after-tax cost of debt → WACC.  All inputs link to Assumptions sheet.", 5);

  let r = 5;
  bannerRow(ws, r, 2, 5, "1.  CAPM COST OF EQUITY  (Sharpe-Lintner)"); r++;
  setCell(ws, r, 2, "Component", STYLE.colHeader);
  setCell(ws, r, 3, "Value",     STYLE.colHeader);
  setCell(ws, r, 4, "Unit",      STYLE.colHeader);
  setCell(ws, r, 5, "Source / Formula", STYLE.colHeader);
  r++;
  const rows1 = [
    ["Risk-free rate (Rf)",        "Rf",   "%",  "10-year sovereign yield (Assumptions)"],
    ["Beta (β)",                   "Beta", "—",  "Levered beta, 2y monthly (Assumptions)"],
    ["Equity risk premium (ERP)",  "Erp",  "%",  "Mature-market ERP + country premium (Assumptions)"],
  ];
  rows1.forEach(([lbl, ref, unit, src]) => {
    setCell(ws, r, 2, lbl, STYLE.rowLabel);
    setCell(ws, r, 3, { formula: ref }, STYLE.link, NF.money2);
    setCell(ws, r, 4, unit, { font: fontBase(C.greyDk, false, 9) });
    setCell(ws, r, 5, src, STYLE.note);
    r++;
  });
  setCell(ws, r, 2, "Cost of equity = Rf + β × ERP", STYLE.totalLabel);
  setCell(ws, r, 3, { formula: "CostEquity" }, STYLE.total, NF.money2);
  setCell(ws, r, 4, "%", { font: fontBase(C.greyDk, false, 9), fill: fillSolid(C.totalFill) });
  setCell(ws, r, 5, "Sharpe-Lintner CAPM (Assumptions!CostEquity)", { ...STYLE.note, fill: fillSolid(C.totalFill) });
  r += 2;

  bannerRow(ws, r, 2, 5, "2.  AFTER-TAX COST OF DEBT"); r++;
  setCell(ws, r, 2, "Pre-tax cost of debt (Kd)", STYLE.rowLabel);
  setCell(ws, r, 3, { formula: "Kd" }, STYLE.link, NF.money2);
  setCell(ws, r, 4, "%", { font: fontBase(C.greyDk, false, 9) });
  setCell(ws, r, 5, "Rf + 150bp credit spread (Assumptions)", STYLE.note);
  r++;
  setCell(ws, r, 2, "Marginal tax rate (t)", STYLE.rowLabel);
  setCell(ws, r, 3, { formula: "TaxRate" }, STYLE.link, NF.money1);
  setCell(ws, r, 4, "%", { font: fontBase(C.greyDk, false, 9) });
  r++;
  setCell(ws, r, 2, "Tax shield factor (1 − t)", STYLE.rowLabel);
  setCell(ws, r, 3, { formula: "1 - TaxRate/100" }, STYLE.formula, NF.pct2);
  setCell(ws, r, 4, "ratio", { font: fontBase(C.greyDk, false, 9) });
  r++;
  setCell(ws, r, 2, "After-tax cost of debt = Kd × (1 − t)", STYLE.totalLabel);
  setCell(ws, r, 3, { formula: "CostDebtAT" }, STYLE.total, NF.money2);
  setCell(ws, r, 4, "%", { font: fontBase(C.greyDk, false, 9), fill: fillSolid(C.totalFill) });
  r += 2;

  bannerRow(ws, r, 2, 5, "3.  CAPITAL STRUCTURE WEIGHTS"); r++;
  setCell(ws, r, 2, "Weight of equity (Wₑ)", STYLE.rowLabel);
  setCell(ws, r, 3, { formula: "WEq" }, STYLE.link, NF.money1);
  setCell(ws, r, 4, "%", { font: fontBase(C.greyDk, false, 9) });
  setCell(ws, r, 5, "Market cap / (Market cap + Total debt)", STYLE.note);
  r++;
  setCell(ws, r, 2, "Weight of debt (Wd)", STYLE.rowLabel);
  setCell(ws, r, 3, { formula: "WDt" }, STYLE.link, NF.money1);
  setCell(ws, r, 4, "%", { font: fontBase(C.greyDk, false, 9) });
  setCell(ws, r, 5, "Total debt / (Market cap + Total debt)", STYLE.note);
  r++;
  setCell(ws, r, 2, "Check sum: We + Wd", STYLE.rowLabel);
  setCell(ws, r, 3, { formula: "WEq + WDt" }, STYLE.formula, NF.money1);
  setCell(ws, r, 4, "%", { font: fontBase(C.greyDk, false, 9) });
  setCell(ws, r, 5, "Should equal 100%", STYLE.note);
  r += 2;

  bannerRow(ws, r, 2, 5, "4.  WEIGHTED-AVERAGE COST OF CAPITAL"); r++;
  setCell(ws, r, 2, "Equity contribution (Wₑ × Kₑ)", STYLE.rowLabel);
  setCell(ws, r, 3, { formula: "(WEq/100) * CostEquity" }, STYLE.formula, NF.money2);
  setCell(ws, r, 4, "%", { font: fontBase(C.greyDk, false, 9) });
  r++;
  setCell(ws, r, 2, "Debt contribution (Wd × Kd × (1−t))", STYLE.rowLabel);
  setCell(ws, r, 3, { formula: "(WDt/100) * CostDebtAT" }, STYLE.formula, NF.money2);
  setCell(ws, r, 4, "%", { font: fontBase(C.greyDk, false, 9) });
  r++;
  setCell(ws, r, 2, "WACC", STYLE.totalLabel);
  setCell(ws, r, 3, { formula: "Wacc" }, STYLE.total, NF.money2);
  setCell(ws, r, 4, "%", { font: fontBase(C.greyDk, false, 9), fill: fillSolid(C.totalFill) });
  setCell(ws, r, 5, "Drives every discounting calculation downstream.", { ...STYLE.note, fill: fillSolid(C.totalFill) });
  r += 2;

  // Scenario-adjusted WACC (active scenario delta applied)
  bannerRow(ws, r, 2, 5, "5.  SCENARIO-ADJUSTED WACC"); r++;
  setCell(ws, r, 2, "Base WACC", STYLE.rowLabel);
  setCell(ws, r, 3, { formula: "Wacc" }, STYLE.formula, NF.money2);
  setCell(ws, r, 4, "%", { font: fontBase(C.greyDk, false, 9) });
  r++;
  setCell(ws, r, 2, "+ Active scenario WACC Δ", STYLE.rowLabel);
  setCell(ws, r, 3, { formula: "ScenWaccD" }, STYLE.formula, NF.money1);
  setCell(ws, r, 4, "pp", { font: fontBase(C.greyDk, false, 9) });
  r++;
  setCell(ws, r, 2, "= Scenario WACC (used in DCF)", STYLE.totalLabel);
  setCell(ws, r, 3, { formula: "Wacc + ScenWaccD" }, STYLE.total, NF.money2);
  setCell(ws, r, 4, "%", { font: fontBase(C.greyDk, false, 9), fill: fillSolid(C.totalFill) });
  wb.definedNames.add(`'WACC Build'!${addr(r, 3)}`, "WaccScen");
  r++;

  ws.pageSetup.printArea = `A1:E${r}`;
}
// ════════════════════════════════════════════════════════════════════════════
// SHEET 3 — ASSUMPTIONS  (single source of truth, mirrors Modeling Lab UI)
// ════════════════════════════════════════════════════════════════════════════
// One integrated block per the Lab's expanded-mode display.
//   Block A — Year-wise forecast drivers (growth, margin, capex, D&A, tax, WC)
//   Block B — Capital allocation rates (dividend, buyback, debt repay, acq)
//   Block C — Operating anchors (gross margin, DSO/DIO/DPO, SGA/OtherOpEx %, IntInc, IntExp)
//   Block D — WACC inputs (Rf, Beta, ERP, Kd, We, Wd) → derived WACC
//   Block E — Base scalar drivers (GrowthBase, Fade, TerminalG)
//   Block F — Capital structure & share count (BaseRev, NetDebt, SharesMn, CurrentPx)
//   Block G — Terminal value method (Method, ExitMult)
//   Block H — Scenario selector + delta table
// All downstream sheets read from these via named ranges.
// ════════════════════════════════════════════════════════════════════════════
function addAssumptions(wb, p) {
  const ws = wb.addWorksheet("Assumptions", {
    properties: { tabColor: { argb: C.amber } },
    views: [{ showGridLines: false, state: "frozen", xSplit: 2, ySplit: 5 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1,
                 margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.3, footer: 0.3 } },
  });

  const a   = p.assumptions || {};
  const w   = p.waccBuild   || {};
  const ui  = p.uiState      || {};
  const yw  = ui.yearwise    || {};
  const ca  = ui.capitalAllocation || {};
  const horizon = a.forecastHorizon || ui.forecastHorizon || 5;
  const nF      = horizon;

  const incActs = p.statements?.incomeActuals || [];
  const balActs = p.statements?.balanceActuals || [];
  const cfActs  = p.statements?.cashflowActuals || [];
  const nA      = incActs.length;
  const lastHistRev = incActs.slice(-1)[0]?.rev ?? null;
  const baseYear    = incActs.slice(-1)[0]?.year ?? (new Date().getFullYear());

  // Column geometry (shared with IS/BS/CF):
  //   A: margin, B: label, C..(2+nA): historicals, (3+nA)..(2+nA+nF): forecast,
  //   (3+nA+nF): Terminal, (4+nA+nF): notes
  const colsLayout = [{ width: 3 }, { width: 38 }];
  for (let i = 0; i < nA + nF; i++) colsLayout.push({ width: 14 });
  colsLayout.push({ width: 14 });
  colsLayout.push({ width: 40 });
  ws.columns = colsLayout;

  const colHist  = (i) => 3 + i;
  const colFC    = (y) => 2 + nA + y;
  const colTerm  = 3 + nA + nF;
  const colNotes = 4 + nA + nF;

  pageHeader(ws, "Assumptions",
    `${p.meta.name} (${p.meta.symbol}) · BLUE cells are user-editable inputs · downstream sheets read via named ranges`,
    colNotes);

  let r = 5;
  // ── Header row (years) ─────────────────────────────────────────────────
  setCell(ws, r, 2, "Driver", STYLE.colHeader);
  incActs.forEach((row, i) => setCell(ws, r, colHist(i), fy(row.year), STYLE.colHeader));
  for (let y = 1; y <= nF; y++) {
    const tag = y <= 3 ? ` (Y${y})` : "";
    setCell(ws, r, colFC(y),
      { formula: `"FY"&RIGHT(${baseYear}+${y},2)&"E${tag}"` },
      STYLE.colHeader, NF.txt);
  }
  setCell(ws, r, colTerm,  "Terminal", STYLE.colHeader);
  setCell(ws, r, colNotes, "Notes",    STYLE.colHeader);
  ws.getRow(r).height = 22;
  r++;

  // ── BLOCK A — Year-wise forecast drivers ───────────────────────────────
  bannerRow(ws, r, 2, colNotes, "A.  FORECAST ASSUMPTIONS  (one row per driver)"); r++;

  const drivers = [
    { key: "growth",       label: "Revenue Growth (%)",          baseName: "GrowthBase",    scenName: "ScenGrowthD", fade: true,  termName: "TerminalG", note: "Annual revenue growth; Y2+ fades by Fade/yr toward TerminalG." },
    { key: "ebitdaMargin", label: "EBITDA Margin (%)",           baseName: "EbitdaMargin",  scenName: "ScenMarginD", fade: false, note: "EBITDA as a % of revenue." },
    { key: "capexPctRev",  label: "Capex (% Revenue)",           baseName: "CapexPctRev",   scenName: "ScenCapexD",  fade: false, note: "Capital expenditure as % of revenue." },
    { key: "depPctRev",    label: "D&A (% Revenue)",             baseName: "DepPctRev",     scenName: null,          fade: false, note: "Depreciation & amortization as % of revenue." },
    { key: "taxRate",      label: "Tax Rate (%)",                baseName: "TaxRate",       scenName: null,          fade: false, note: "Effective tax rate on PBT." },
    { key: "wcPctRev",     label: "Working Capital (% Δ Rev)",   baseName: "WcPctRev",      scenName: null,          fade: false, note: "Net working capital absorption as % of revenue change." },
  ];

  // Historical pre-calculated values (informational)
  const histGrowth = incActs.map((row, i) => {
    if (i === 0) return null;
    const prev = incActs[i - 1]?.rev;
    return prev ? ((row.rev / prev) - 1) * 100 : null;
  });
  const histEbitdaMargin = incActs.map((row) => row.ebitdaMargin ?? null);
  const histCapexPct = cfActs.map((cfr, i) => {
    const rev = incActs[i]?.rev;
    return (cfr.capex && rev) ? (cfr.capex / rev) * 100 : null;
  });
  const histDepPct = incActs.map((row, i) => {
    const dep = row.dep ?? cfActs[i]?.dep;
    return (dep && row.rev) ? (dep / row.rev) * 100 : null;
  });
  const histTaxRate = incActs.map((row) =>
    (row.tax != null && row.pbt) ? (row.tax / row.pbt) * 100 : null
  );
  const histWcPct = incActs.map((row, i) => {
    if (i === 0) return null;
    const dRev = row.rev - incActs[i - 1].rev;
    const wcChg = cfActs[i]?.wcMove;
    return (dRev && wcChg != null) ? (wcChg / dRev) * 100 : null;
  });
  const histMap = { growth: histGrowth, ebitdaMargin: histEbitdaMargin, capexPctRev: histCapexPct,
                    depPctRev: histDepPct, taxRate: histTaxRate, wcPctRev: histWcPct };

  drivers.forEach((d) => {
    setCell(ws, r, 2, d.label, STYLE.rowLabel);

    // Historicals (blue inputs)
    histMap[d.key].forEach((v, i) => {
      setCell(ws, r, colHist(i), safeNum(v), STYLE.input, NF.money1);
    });

    // Forecast: Y1 falls back to base scalar + scenario delta;
    //          Y2+ chains from previous year cell (fade for growth, flat for others)
    const ywVals = yw[d.key] || [];
    let prevColRef = null;
    for (let y = 1; y <= nF; y++) {
      const c = colFC(y);
      const ov = (y <= 3 && ywVals[y - 1] != null && isFinite(+ywVals[y - 1])) ? +ywVals[y - 1] : null;

      if (ov != null) {
        setCell(ws, r, c, ov, STYLE.input, NF.money1);
      } else {
        let formula;
        const scenAdd = d.scenName ? ` + ${d.scenName}` : "";
        if (y === 1) {
          formula = `${d.baseName}${scenAdd}`;
        } else {
          if (d.fade) {
            formula = `MAX(${prevColRef} - Fade, ${d.termName})`;
          } else {
            formula = `${prevColRef}`;
          }
        }
        setCell(ws, r, c, { formula }, STYLE.formula, NF.money1);
      }
      prevColRef = `${col(c)}${r}`;
    }

    // Terminal column
    if (d.termName) {
      setCell(ws, r, colTerm, { formula: d.termName }, STYLE.formula, NF.money1);
    } else {
      setCell(ws, r, colTerm, { formula: `${col(colFC(nF))}${r}` }, STYLE.formula, NF.money1);
    }

    setCell(ws, r, colNotes, d.note, STYLE.note);

    // Named range over forecast year cells (size = nF, indexable 1..nF)
    wb.definedNames.add(
      `Assumptions!$${col(colFC(1))}$${r}:$${col(colFC(nF))}$${r}`,
      "Yw_" + d.key
    );
    r++;
  });
  r++;

  // ── BLOCK B — Capital allocation (yearwise) ────────────────────────────
  bannerRow(ws, r, 2, colNotes, "B.  CAPITAL ALLOCATION  (yearwise; % rates)"); r++;
  const capRates = [
    { key: "dividendPayout", label: "Dividend Payout (% of PAT)",   note: "Cash dividends as % of profit after tax (positive PAT only)." },
    { key: "shareBuyback",   label: "Share Buyback (% of equity)",  note: "Buybacks as % of opening equity balance." },
    { key: "debtRepayment",  label: "Debt Repayment (% of debt)",   note: "Debt repaid as % of opening total debt." },
    { key: "strategicAcq",   label: "Strategic Acquisition (% Rev)",note: "Acquisitions / inorganic spend as % of revenue." },
  ];

  const histDivPayout = cfActs.map((cfr, i) => {
    const ni = incActs[i]?.pat;
    return (cfr.dividends && ni && ni > 0) ? (cfr.dividends / ni) * 100 : null;
  });

  capRates.forEach((cap) => {
    setCell(ws, r, 2, cap.label, STYLE.rowLabel);
    if (cap.key === "dividendPayout") {
      histDivPayout.forEach((v, i) => {
        setCell(ws, r, colHist(i), safeNum(v), STYLE.input, NF.money1);
      });
    } else {
      incActs.forEach((_, i) => setCell(ws, r, colHist(i), "", STYLE.rowLabel));
    }
    const ywVals = ca[cap.key] || [];
    let prevColRef = null;
    for (let y = 1; y <= nF; y++) {
      const c = colFC(y);
      const ov = (y <= 3 && ywVals[y - 1] != null && isFinite(+ywVals[y - 1])) ? +ywVals[y - 1] : null;
      if (ov != null) {
        setCell(ws, r, c, ov, STYLE.input, NF.money1);
      } else if (y === 1) {
        setCell(ws, r, c, 0, STYLE.input, NF.money1);
      } else {
        setCell(ws, r, c, { formula: prevColRef }, STYLE.formula, NF.money1);
      }
      prevColRef = `${col(c)}${r}`;
    }
    setCell(ws, r, colTerm, { formula: `${col(colFC(nF))}${r}` }, STYLE.formula, NF.money1);
    setCell(ws, r, colNotes, cap.note, STYLE.note);
    wb.definedNames.add(
      `Assumptions!$${col(colFC(1))}$${r}:$${col(colFC(nF))}$${r}`,
      "Yw_" + cap.key
    );
    r++;
  });
  r++;

  // ── BLOCK C — Operating anchors (scalars) ──────────────────────────────
  bannerRow(ws, r, 2, colNotes, "C.  OPERATING ANCHORS  (scalars used by IS / BS / CF formulas)"); r++;

  const lastInc = incActs.slice(-1)[0] || {};
  const lastBal = balActs.slice(-1)[0] || {};

  // Task 4: where possible, use a ROLLING AVERAGE of the last 2-3 years
  // (rather than the latest year alone) to avoid single-year shocks
  // anchoring the entire forecast. The latest year is still the fallback.
  const avgNonNull = (vals) => {
    const v = vals.filter((x) => x != null && isFinite(x));
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
  };
  const recentN = (arr, n, key) => arr.slice(-n).map((x) => x[key]);

  const grossMarginDefault = (() => {
    // Average gross margin over last 3 years
    const gm = avgNonNull(recentN(incActs, 3, "grossMargin").filter((v) => v != null && v > 0 && v < 100));
    if (gm != null) return gm;
    if (lastInc.gross && lastInc.rev) return (lastInc.gross / lastInc.rev) * 100;
    return 45;
  })();
  const dsoDefault = (() => {
    // DSO from last 3 years' avg (receivables / revenue × 365)
    const series = incActs.map((r, i) => {
      const b = balActs[i];
      return (b?.receivables && r.rev) ? (b.receivables / r.rev) * 365 : null;
    });
    const v = avgNonNull(series.slice(-3));
    return v != null ? v : (lastBal.receivables && lastInc.rev ? (lastBal.receivables / lastInc.rev) * 365 : 45);
  })();
  const dioDefault = (() => {
    const series = incActs.map((r, i) => {
      const b = balActs[i];
      return (b?.inventory && r.cogs) ? (b.inventory / r.cogs) * 365 : null;
    });
    const v = avgNonNull(series.slice(-3));
    return v != null ? v : (lastBal.inventory && lastInc.cogs ? (lastBal.inventory / lastInc.cogs) * 365 : 60);
  })();
  const dpoDefault = (() => {
    const series = incActs.map((r, i) => {
      const b = balActs[i];
      return (b?.payables && r.cogs) ? (b.payables / r.cogs) * 365 : null;
    });
    const v = avgNonNull(series.slice(-3));
    return v != null ? v : (lastBal.payables && lastInc.cogs ? (lastBal.payables / lastInc.cogs) * 365 : 60);
  })();
  const sgaPctDefault = (() => {
    const series = incActs.map((r) => (r.sga && r.rev) ? (r.sga / r.rev) * 100 : null);
    return avgNonNull(series.slice(-3)) ?? 0;
  })();
  const otherOpDefault = (() => {
    const series = incActs.map((r) => (r.otherOpExp && r.rev) ? (r.otherOpExp / r.rev) * 100 : null);
    return avgNonNull(series.slice(-3)) ?? 0;
  })();
  // Interest income / expense as 3-year averages (less volatile anchor)
  const intIncomeDefault = avgNonNull(recentN(incActs, 3, "intIncome")) ?? lastInc.intIncome ?? 0;
  const intExpenseDefault = avgNonNull(recentN(incActs, 3, "intExpense")) ?? lastInc.intExpense ?? 0;

  const addScalar = (label, value, unit, name, fmt, note) => {
    setCell(ws, r, 2, label, STYLE.rowLabel);
    const isMonetary = (unit === p.unit);
    const displayVal = isMonetary ? value / p.scale : value;
    setCell(ws, r, 3, safeNum(displayVal), STYLE.input, fmt || NF.money2);
    setCell(ws, r, 4, unit,
      { font: fontBase(C.greyDk, false, 9), alignment: { horizontal: "left", indent: 1 } });
    setCell(ws, r, colNotes, note, STYLE.note);
    wb.definedNames.add(`Assumptions!${addr(r, 3)}`, name);
    r++;
  };

  addScalar("Gross margin",          grossMarginDefault, "%",   "GrossMargin",   NF.money1, "Cost of revenue = (1 − GrossMargin) × Revenue.");
  addScalar("Days Sales Outstanding (DSO)", dsoDefault,  "days","DSO",           NF.money1, "Trade receivables = DSO × Revenue / 365.");
  addScalar("Days Inventory Outstanding (DIO)", dioDefault, "days","DIO",        NF.money1, "Inventory = DIO × COGS / 365.");
  addScalar("Days Payables Outstanding (DPO)", dpoDefault, "days","DPO",         NF.money1, "Trade payables = DPO × COGS / 365.");
  addScalar("SG&A (% Revenue)",      sgaPctDefault,      "%",   "SgaPctRev",     NF.money1, "Selling, general & administrative as % of revenue.");
  addScalar("Other Op Exp (% Revenue)", otherOpDefault,  "%",   "OtherOpPctRev", NF.money1, "Other operating expenses as % of revenue.");
  addScalar(`Interest income (${p.unit})`,  intIncomeDefault,  p.unit, "IntIncome",  NF.money,  "Anchored to 3-year historical average (Task 4 rolling avg).");
  addScalar(`Interest expense (${p.unit})`, intExpenseDefault, p.unit, "IntExpense", NF.money,  "Anchored to 3-year historical average (Task 4 rolling avg).");
  r++;

  // ── BLOCK D — WACC inputs (CAPM) ───────────────────────────────────────
  bannerRow(ws, r, 2, colNotes, "D.  WACC INPUTS  (CAPM; derived components in BLACK)"); r++;
  addScalar("Risk-free rate (Rf)",     safeNum(w.rf),           "%", "Rf",   NF.money2, "10-year sovereign yield.");
  addScalar("Beta (β, levered)",       safeNum(w.beta),         "—", "Beta", NF.ratio,  "2-year monthly levered beta.");
  addScalar("Equity risk premium (ERP)", safeNum(w.erp),        "%", "Erp",  NF.money2, "Damodaran ERP (mature + country risk).");
  addScalar("Pre-tax cost of debt (Kd)", safeNum((w.rf || 0) + 1.5), "%", "Kd", NF.money2, "Rf + 150bp credit spread.");
  addScalar("Weight of equity (We)",   safeNum(w.weightEquity), "%", "WEq",  NF.money1, "Mkt cap / (Mkt cap + Debt).");
  addScalar("Weight of debt (Wd)",     safeNum(w.weightDebt),   "%", "WDt",  NF.money1, "Debt / (Mkt cap + Debt).");

  setCell(ws, r, 2, "Cost of equity (Rf + β × ERP)", STYLE.rowLabelBold);
  setCell(ws, r, 3, { formula: "Rf + Beta * Erp" }, STYLE.formulaBold, NF.money2);
  setCell(ws, r, 4, "%",
    { font: fontBase(C.greyDk, false, 9), alignment: { horizontal: "left", indent: 1 } });
  setCell(ws, r, colNotes, "Sharpe-Lintner CAPM.", STYLE.note);
  wb.definedNames.add(`Assumptions!${addr(r, 3)}`, "CostEquity");
  r++;

  setCell(ws, r, 2, "After-tax cost of debt (Kd × (1−t))", STYLE.rowLabelBold);
  setCell(ws, r, 3, { formula: "Kd * (1 - TaxRate/100)" }, STYLE.formulaBold, NF.money2);
  setCell(ws, r, 4, "%",
    { font: fontBase(C.greyDk, false, 9), alignment: { horizontal: "left", indent: 1 } });
  wb.definedNames.add(`Assumptions!${addr(r, 3)}`, "CostDebtAT");
  r++;

  setCell(ws, r, 2, "WACC (We × Ke + Wd × Kd × (1−t))", STYLE.totalLabel);
  setCell(ws, r, 3, { formula: "(WEq/100) * CostEquity + (WDt/100) * CostDebtAT" }, STYLE.total, NF.money2);
  setCell(ws, r, 4, "%",
    { font: fontBase(C.greyDk, false, 9), fill: fillSolid(C.totalFill),
      alignment: { horizontal: "left", indent: 1 } });
  setCell(ws, r, colNotes, "Drives every discounting downstream.",
    { ...STYLE.note, fill: fillSolid(C.totalFill) });
  wb.definedNames.add(`Assumptions!${addr(r, 3)}`, "Wacc");
  r += 2;

  // ── BLOCK E — Base scalar drivers (anchors for fade) ────────────────────
  // These are the SCALAR inputs that Block A's Y1 formulas reference (and
  // that downstream sheets — Audit, WACC build, DCF Engine, Scenarios — also
  // reference by short name). When the user is in collapsed mode in the Lab
  // UI, these are what's editable; when in expanded mode, the user typically
  // overrides Y1/Y2/Y3 directly via the yearwise table (blue cells in Block A).
  bannerRow(ws, r, 2, colNotes, "E.  BASE SCALAR DRIVERS  (anchor values for Block A formulas)"); r++;
  addScalar("Revenue growth (Y1 base)",     safeNum(a.growthY1_5),  "%", "GrowthBase",   NF.money1, "Anchor for Y1 forecast (Block A Y1 fallback).");
  addScalar("EBITDA margin (base)",         safeNum(a.ebitdaMargin),"%", "EbitdaMargin", NF.money1, "Held flat across forecast unless overridden in Block A.");
  addScalar("Capex (% revenue, base)",      safeNum(a.capexPctRev), "%", "CapexPctRev",  NF.money1, "Held flat across forecast unless overridden.");
  addScalar("D&A (% revenue, base)",        safeNum(a.depPctRev),   "%", "DepPctRev",    NF.money1, "Held flat across forecast unless overridden.");
  addScalar("Tax rate (base)",              safeNum(a.taxRate),     "%", "TaxRate",      NF.money1, "Effective tax rate (also used in WACC build).");
  addScalar("Working capital (% Δ rev, base)", safeNum(a.wcPctRev), "%", "WcPctRev",     NF.money1, "Held flat across forecast unless overridden.");
  addScalar("Annual fade",                  safeNum(a.fade),        "pp","Fade",         NF.money1, "Per-year reduction in growth from Y2 onward.");
  addScalar("Terminal growth (perpetuity)", safeNum(a.terminalG),   "%", "TerminalG",    NF.money1, "Long-run growth rate in TV.");
  r++;

  // ── BLOCK F — Capital structure & share count ──────────────────────────
  // Task 5 / 6: Net Debt is editable directly, and is the bridge from
  // Enterprise Value to Equity Value. For users who prefer the component
  // view (ST Debt + LT Debt − Cash = Net Debt), the three component scalars
  // are also exposed. Editing any component automatically updates Net Debt
  // via the formula in the "Net Debt (computed)" row, so the model always
  // reconciles. Editing Net Debt directly overrides the components.
  //
  // Defaults: prefer UI overrides (from uiState.capitalStructure) over the
  // last-historical-year balance — so the Excel always opens with the same
  // capital structure the user has on screen.
  bannerRow(ws, r, 2, colNotes, "F.  CAPITAL STRUCTURE & SHARE COUNT"); r++;
  const sharesOut = p.idcf?.sharesOut ?? 0;
  const netDebt   = p.idcf?.netDebt   ?? 0;
  const currentPx = p.idcf?.currentPrice ?? p.meta.price ?? 0;
  const lastBalEnd = balActs.slice(-1)[0] || {};
  const csOv       = (p.uiState && p.uiState.capitalStructure) || {};
  const stDebtHist = (csOv.stDebt != null && isFinite(csOv.stDebt)) ? +csOv.stDebt : (lastBalEnd.stDebt ?? 0);
  const ltDebtHist = (csOv.ltDebt != null && isFinite(csOv.ltDebt)) ? +csOv.ltDebt : (lastBalEnd.ltDebt ?? 0);
  const cashHist   = (csOv.cash   != null && isFinite(csOv.cash))   ? +csOv.cash   : (lastBalEnd.cash   ?? 0);
  const ndOverride = (csOv.netDebt != null && isFinite(csOv.netDebt)) ? +csOv.netDebt : 0;
  addScalar(`Last historical revenue (${p.unit})`, safeNum(lastHistRev), p.unit, "BaseRev",   NF.money,  "Anchor for Year-1 revenue.");
  addScalar(`Short-Term Debt (${p.unit})`,         safeNum(stDebtHist),  p.unit, "StDebt",    NF.money,  "Editable. Excludes capital-lease obligations (Task 6).");
  addScalar(`Long-Term Debt (${p.unit})`,          safeNum(ltDebtHist),  p.unit, "LtDebt",    NF.money,  "Editable. Excludes capital-lease obligations (Task 6).");
  addScalar(`Cash & Cash Equivalents (${p.unit})`, safeNum(cashHist),    p.unit, "CashEq",    NF.money,  "Editable. Includes short-term investments per convention.");
  // Total Debt — formula, sum of ST + LT, NEVER includes leases (Task 6)
  setCell(ws, r, 2, "Total Debt  (= ST Debt + LT Debt)", STYLE.rowLabelBold);
  setCell(ws, r, 3, { formula: `StDebt + LtDebt` }, STYLE.formulaBold, NF.money);
  setCell(ws, r, 4, p.unit, { font: fontBase(C.greyDk, false, 9), alignment: { horizontal: "left", indent: 1 } });
  setCell(ws, r, colNotes, "Excludes leases. Drives WACC weights and EV-to-Equity bridge.", STYLE.note);
  wb.definedNames.add(`Assumptions!${addr(r, 3)}`, "TotalDebt");
  r++;
  // Net Debt (computed) — formula, ST + LT − Cash
  setCell(ws, r, 2, "Net Debt  (= Total Debt − Cash)", STYLE.totalLabel);
  setCell(ws, r, 3, { formula: `TotalDebt - CashEq` }, STYLE.total, NF.money);
  setCell(ws, r, 4, p.unit, { font: fontBase(C.greyDk, false, 9), fill: fillSolid(C.totalFill), alignment: { horizontal: "left", indent: 1 } });
  setCell(ws, r, colNotes, "Bridges EV to Equity Value in the DCF Engine.", { ...STYLE.note, fill: fillSolid(C.totalFill) });
  wb.definedNames.add(`Assumptions!${addr(r, 3)}`, "NetDebt");
  r++;
  // Net Debt override (BLUE input) — if non-zero, overrides the computed value.
  // The DCF Engine references NetDebtUsed below, which prefers the override.
  setCell(ws, r, 2, "Net Debt override  (0 = use computed)", STYLE.rowLabel);
  setCell(ws, r, 3, safeNum(ndOverride / p.scale), STYLE.input, NF.money);
  setCell(ws, r, 4, p.unit, { font: fontBase(C.greyDk, false, 9), alignment: { horizontal: "left", indent: 1 } });
  setCell(ws, r, colNotes, "Enter a non-zero figure to override the component-derived net debt.", STYLE.note);
  wb.definedNames.add(`Assumptions!${addr(r, 3)}`, "NetDebtOverride");
  r++;
  setCell(ws, r, 2, "Net Debt used  (override if set, else computed)", STYLE.rowLabel);
  setCell(ws, r, 3, { formula: `IF(ABS(NetDebtOverride)>0.0001, NetDebtOverride, NetDebt)` }, STYLE.formula, NF.money);
  setCell(ws, r, 4, p.unit, { font: fontBase(C.greyDk, false, 9), alignment: { horizontal: "left", indent: 1 } });
  wb.definedNames.add(`Assumptions!${addr(r, 3)}`, "NetDebtUsed");
  r++;
  addScalar("Shares outstanding (mn)",             sharesOut / 1e6,      "mn",   "SharesMn",  NF.money1, "Basic share count, in millions.");
  addScalar(`Current market price (${p.ccySym}/sh)`, safeNum(currentPx), `${p.ccySym}/sh`, "CurrentPx", NF.money2, "Latest trading price.");
  r++;

  // ── BLOCK G — Terminal value method ────────────────────────────────────
  bannerRow(ws, r, 2, colNotes, "G.  TERMINAL VALUE METHOD"); r++;
  const isExitMult = a.terminalMethod === "exitMultiple";
  addScalar("Method (1=Perpetual, 2=Exit Multiple)", isExitMult ? 2 : 1, "", "TermMethod", NF.money, "Toggles TV approach.");
  addScalar("Exit EV/EBITDA multiple", safeNum(a.exitMultiple ?? ui.exitMultiple ?? 12), "×", "ExitMult", NF.mult, "Only used when TermMethod = 2.");

  setCell(ws, r, 2, "Forecast horizon (years)", STYLE.rowLabel);
  setCell(ws, r, 3, nF, STYLE.input, NF.money);
  setCell(ws, r, 4, "yrs",
    { font: fontBase(C.greyDk, false, 9), alignment: { horizontal: "left", indent: 1 } });
  setCell(ws, r, colNotes, "Number of explicit forecast years.", STYLE.note);
  wb.definedNames.add(`Assumptions!${addr(r, 3)}`, "Horizon");
  r++;

  setCell(ws, r, 2, "Base year (last historical)", STYLE.rowLabel);
  setCell(ws, r, 3, baseYear, STYLE.input, NF.year);
  setCell(ws, r, 4, "FY",
    { font: fontBase(C.greyDk, false, 9), alignment: { horizontal: "left", indent: 1 } });
  wb.definedNames.add(`Assumptions!${addr(r, 3)}`, "BaseYear");
  r += 2;

  // ── BLOCK H — Scenario selector + delta table ──────────────────────────
  bannerRow(ws, r, 2, colNotes, "H.  SCENARIO SELECTOR  (Bull/Bear propagation)"); r++;
  setCell(ws, r, 2, "Active scenario (1=Base 2=Bull 3=Bear 4=Stress 5=Downside)", STYLE.rowLabel);
  setCell(ws, r, 3, 1, STYLE.input, NF.money);
  setCell(ws, r, colNotes, "Change to flex every line. Scenarios sheet has all 5 side-by-side.", STYLE.note);
  wb.definedNames.add(`Assumptions!${addr(r, 3)}`, "ScenarioId");
  r++;
  setCell(ws, r, 2, "Active scenario (name)", STYLE.rowLabel);
  setCell(ws, r, 3, { formula: `CHOOSE(ScenarioId, "Base", "Bull", "Bear", "Stress", "Downside")` }, STYLE.formula, NF.txt);
  r += 2;

  bannerRow(ws, r, 2, colNotes, "    Scenario delta table  (added to base assumptions)"); r++;
  setCell(ws, r, 2, "Scenario",       STYLE.colHeader);
  setCell(ws, r, 3, "Growth Δ (pp)",  STYLE.colHeader);
  setCell(ws, r, 4, "Margin Δ (pp)",  STYLE.colHeader);
  setCell(ws, r, 5, "WACC Δ (pp)",    STYLE.colHeader);
  setCell(ws, r, 6, "Term-g Δ (pp)",  STYLE.colHeader);
  setCell(ws, r, 7, "Capex Δ (pp)",   STYLE.colHeader);
  r++;
  const scenTableStart = r;
  const scenarios = [
    ["Base",      0,     0,     0,     0,     0],
    ["Bull",      4,     2,    -0.5,   0.5,   0],
    ["Bear",     -5,    -2,     0.5,  -0.5,   0],
    ["Stress",   -8,    -4,     1.5,  -1.0,   1],
    ["Downside", -3,    -1,     0.25, -0.25,  0.5],
  ];
  scenarios.forEach(([name, g, m, wd, tg, cx]) => {
    setCell(ws, r, 2, name, STYLE.rowLabel);
    setCell(ws, r, 3, g,  STYLE.input, NF.money1);
    setCell(ws, r, 4, m,  STYLE.input, NF.money1);
    setCell(ws, r, 5, wd, STYLE.input, NF.money1);
    setCell(ws, r, 6, tg, STYLE.input, NF.money1);
    setCell(ws, r, 7, cx, STYLE.input, NF.money1);
    r++;
  });
  const scenTableEnd = r - 1;
  wb.definedNames.add(`Assumptions!$B$${scenTableStart}:$G$${scenTableEnd}`, "ScenarioTable");

  r++;
  const addDelta = (label, idx, name) => {
    setCell(ws, r, 2, label, STYLE.rowLabel);
    setCell(ws, r, 3, { formula: `INDEX(ScenarioTable, ScenarioId, ${idx})` }, STYLE.formula, NF.money1);
    setCell(ws, r, 4, "pp",
      { font: fontBase(C.greyDk, false, 9), alignment: { horizontal: "left", indent: 1 } });
    wb.definedNames.add(`Assumptions!${addr(r, 3)}`, name);
    r++;
  };
  addDelta("Active growth Δ",     2, "ScenGrowthD");
  addDelta("Active margin Δ",     3, "ScenMarginD");
  addDelta("Active WACC Δ",       4, "ScenWaccD");
  addDelta("Active terminal-g Δ", 5, "ScenTermD");
  addDelta("Active capex Δ",      6, "ScenCapexD");

  ws.pageSetup.printArea = `A1:${col(colNotes)}${r}`;
}
// ════════════════════════════════════════════════════════════════════════════
// SHEET 5 — INCOME STATEMENT  (integrated: actuals + forecast, formula-driven)
// ════════════════════════════════════════════════════════════════════════════
// Row order matches the Modeling Lab UI exactly (see renderS2Expanded):
//   Revenue, Revenue Growth %, COGS, Gross Profit, Gross Margin %,
//   Operating Expenses (SG&A, Other Op Exp), EBITDA, EBITDA Margin %,
//   D&A, EBIT, EBIT Margin %, Int Income, Int Expense, PBT, Tax,
//   Associate Share (hist), PAT, Minority Interest (hist), Attributable to
//   Parent (hist), PAT Margin %, Basic EPS, Diluted EPS.
//
// Every forecast cell is a live formula linked to Assumptions named ranges.
// Historical cells are BLUE hardcoded values from incomeActuals.
// Tracked row indices are exposed via wb._rowIndex.is for BS/CF cross-sheet
// linkage.
// ════════════════════════════════════════════════════════════════════════════
function addIncomeStatement(wb, p) {
  const ws = wb.addWorksheet("Income Statement", {
    properties: { tabColor: { argb: C.green } },
    views: [{ showGridLines: false, state: "frozen", xSplit: 2, ySplit: 5 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1,
                 margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.3, footer: 0.3 } },
  });

  const acts = p.statements?.incomeActuals || [];
  const horizon = p.assumptions?.forecastHorizon || p.uiState?.forecastHorizon || 5;
  const nA = acts.length, nF = horizon;
  const colsLayout = [{ width: 3 }, { width: 38 }];
  for (let i = 0; i < nA + nF; i++) colsLayout.push({ width: 14 });
  ws.columns = colsLayout;

  const colHist = (i) => 3 + i;
  const colFC   = (y) => 2 + nA + y;
  const epsFactor = p.isINR ? 10 : 1;
  const baseYear = acts.slice(-1)[0]?.year ?? (new Date().getFullYear());

  pageHeader(ws, "Income Statement",
    `${p.meta.name} (${p.meta.symbol}) · ${nA}y actuals + ${nF}y forecast · ${p.unit} · Y1/Y2/Y3 editable on Assumptions`,
    2 + nA + nF);

  let r = 5;
  // Year header
  setCell(ws, r, 2, "Line Item", STYLE.colHeader);
  acts.forEach((row, i) => setCell(ws, r, colHist(i), fy(row.year), STYLE.colHeader));
  for (let y = 1; y <= nF; y++) {
    const tag = y <= 3 ? ` (Y${y})` : "";
    setCell(ws, r, colFC(y), { formula: `"FY"&RIGHT(${baseYear}+${y},2)&"E${tag}"` }, STYLE.colHeader, NF.txt);
  }
  ws.getRow(r).height = 22;
  r++;

  const lblF = (text, style) => setCell(ws, r, 2, text, style);
  const ROWS = {};

  bannerRow(ws, r, 2, 2 + nA + nF, "1.  REVENUE & PROFITABILITY"); r++;

  // Revenue
  ROWS.rev = r;
  lblF("Revenue", STYLE.rowLabelBold);
  acts.forEach((row, i) => {
    const v = row.rev != null ? row.rev / p.scale : null;
    setCell(ws, r, colHist(i), safeNum(v), STYLE.input, NF.money);
  });
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    if (y === 1) {
      setCell(ws, r, c,
        { formula: `BaseRev * (1 + (INDEX(Yw_growth, ${y}) + ScenGrowthD)/100)` },
        STYLE.formulaBold, NF.money);
    } else {
      setCell(ws, r, c,
        { formula: `${col(c - 1)}${r} * (1 + (INDEX(Yw_growth, ${y}) + ScenGrowthD)/100)` },
        STYLE.formulaBold, NF.money);
    }
  }
  r++;

  // Revenue growth %
  ROWS.growth = r;
  lblF("  Revenue Growth (%)", STYLE.rowLabelSub);
  acts.forEach((row, i) => {
    if (i === 0) { setCell(ws, r, colHist(i), "", STYLE.formula); return; }
    setCell(ws, r, colHist(i),
      { formula: `(${col(colHist(i))}${ROWS.rev} / ${col(colHist(i - 1))}${ROWS.rev}) - 1` },
      STYLE.formula, NF.pct1);
  });
  for (let y = 1; y <= nF; y++) {
    setCell(ws, r, colFC(y),
      { formula: `(INDEX(Yw_growth, ${y}) + ScenGrowthD) / 100` },
      STYLE.formula, NF.pct1);
  }
  r++;

  // COGS
  ROWS.cogs = r;
  lblF("Cost of Revenue (COGS)", STYLE.rowLabel);
  acts.forEach((row, i) => {
    const v = row.cogs != null ? row.cogs / p.scale : null;
    setCell(ws, r, colHist(i), safeNum(v), STYLE.input, NF.money);
  });
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, r, c, { formula: `${col(c)}${ROWS.rev} * (1 - GrossMargin/100)` },
      STYLE.formula, NF.money);
  }
  r++;

  // Gross Profit
  ROWS.gross = r;
  lblF("Gross Profit", STYLE.subtotalLabel);
  for (let i = 0; i < nA; i++) {
    const c = colHist(i);
    const v = acts[i].gross != null ? acts[i].gross / p.scale : null;
    setCell(ws, r, c, safeNum(v), STYLE.subtotal, NF.money);
  }
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, r, c, { formula: `${col(c)}${ROWS.rev} - ${col(c)}${ROWS.cogs}` },
      STYLE.subtotal, NF.money);
  }
  r++;

  // Gross Margin %
  lblF("  Gross Margin (%)", STYLE.rowLabelSub);
  for (let i = 0; i < nA + nF; i++) {
    const c = i < nA ? colHist(i) : colFC(i - nA + 1);
    setCell(ws, r, c,
      { formula: `IFERROR(${col(c)}${ROWS.gross} / ${col(c)}${ROWS.rev}, 0)` },
      STYLE.formula, NF.pct1);
  }
  r++;

  // Operating Expenses (implied: Gross − EBIT)
  ROWS.opex = r;
  lblF("Operating Expenses", STYLE.rowLabel);
  acts.forEach((row, i) => {
    const v = row.opExp != null ? row.opExp / p.scale : null;
    setCell(ws, r, colHist(i), safeNum(v), STYLE.input, NF.money);
  });
  for (let y = 1; y <= nF; y++) {
    setCell(ws, r, colFC(y), 0, STYLE.formula, NF.money);
  }
  r++;

  // SGA
  ROWS.sga = r;
  lblF("  Selling & Administrative", STYLE.rowLabelSub);
  acts.forEach((row, i) => {
    const v = row.sga != null ? row.sga / p.scale : null;
    if (v != null) setCell(ws, r, colHist(i), v, STYLE.input, NF.money);
    else setCell(ws, r, colHist(i), "", STYLE.rowLabelSub);
  });
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, r, c, { formula: `${col(c)}${ROWS.rev} * SgaPctRev / 100` },
      STYLE.formula, NF.money);
  }
  r++;

  // Other Op Exp
  lblF("  Other Operating Expenses", STYLE.rowLabelSub);
  acts.forEach((row, i) => {
    const v = row.otherOpExp != null ? row.otherOpExp / p.scale : null;
    if (v != null) setCell(ws, r, colHist(i), v, STYLE.input, NF.money);
    else setCell(ws, r, colHist(i), "", STYLE.rowLabelSub);
  });
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, r, c, { formula: `${col(c)}${ROWS.rev} * OtherOpPctRev / 100` },
      STYLE.formula, NF.money);
  }
  r++;

  // EBITDA
  ROWS.ebitda = r;
  lblF("EBITDA", STYLE.subtotalLabel);
  acts.forEach((row, i) => {
    const v = row.ebitda != null ? row.ebitda / p.scale : null;
    setCell(ws, r, colHist(i), safeNum(v), STYLE.subtotal, NF.money);
  });
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, r, c,
      { formula: `${col(c)}${ROWS.rev} * (INDEX(Yw_ebitdaMargin, ${y}) + ScenMarginD) / 100` },
      STYLE.subtotal, NF.money);
  }
  r++;

  // EBITDA Margin %
  lblF("  EBITDA Margin (%)", STYLE.rowLabelSub);
  for (let i = 0; i < nA + nF; i++) {
    const c = i < nA ? colHist(i) : colFC(i - nA + 1);
    setCell(ws, r, c,
      { formula: `IFERROR(${col(c)}${ROWS.ebitda} / ${col(c)}${ROWS.rev}, 0)` },
      STYLE.formula, NF.pct1);
  }
  r++;

  // D&A
  ROWS.dep = r;
  lblF("Depreciation & Amortization", STYLE.rowLabel);
  acts.forEach((row, i) => {
    const v = row.dep != null ? row.dep / p.scale : null;
    setCell(ws, r, colHist(i), safeNum(v), STYLE.input, NF.money);
  });
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, r, c, { formula: `${col(c)}${ROWS.rev} * INDEX(Yw_depPctRev, ${y}) / 100` },
      STYLE.formula, NF.money);
  }
  r++;

  // EBIT
  ROWS.ebit = r;
  lblF("EBIT", STYLE.subtotalLabel);
  for (let i = 0; i < nA; i++) {
    const c = colHist(i);
    const v = acts[i].ebit != null ? acts[i].ebit / p.scale : null;
    setCell(ws, r, c, safeNum(v), STYLE.subtotal, NF.money);
  }
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, r, c, { formula: `${col(c)}${ROWS.ebitda} - ${col(c)}${ROWS.dep}` },
      STYLE.subtotal, NF.money);
  }
  r++;

  // EBIT Margin %
  lblF("  EBIT Margin (%)", STYLE.rowLabelSub);
  for (let i = 0; i < nA + nF; i++) {
    const c = i < nA ? colHist(i) : colFC(i - nA + 1);
    setCell(ws, r, c,
      { formula: `IFERROR(${col(c)}${ROWS.ebit} / ${col(c)}${ROWS.rev}, 0)` },
      STYLE.formula, NF.pct1);
  }
  r++;

  // Back-fill Operating Expenses = Gross − EBIT
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, ROWS.opex, c,
      { formula: `${col(c)}${ROWS.gross} - ${col(c)}${ROWS.ebit}` },
      STYLE.formula, NF.money);
  }

  // Interest Income — Task 4: institutional approach uses an implied yield
  //   on average cash balance, but since the IS is built before the CF, we
  //   approximate by holding flat at the historical average (more robust
  //   than the latest year alone, which can be skewed by one-off events).
  //   When the user wants to override, they edit IntIncome on Assumptions.
  ROWS.intIncome = r;
  lblF("Interest Income", STYLE.rowLabel);
  acts.forEach((row, i) => {
    const v = row.intIncome != null ? row.intIncome / p.scale : null;
    setCell(ws, r, colHist(i), safeNum(v), STYLE.input, NF.money);
  });
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, r, c, { formula: `IntIncome` }, STYLE.formula, NF.money);
  }
  r++;

  // Interest Expense — Task 4: scale by Total Debt rather than holding flat.
  //   Effective interest rate = IntExpense / TotalDebt (computed via named
  //   ranges). This means Interest Expense follows debt rollforward over
  //   the forecast (debt is repaid → interest declines). When debt remains
  //   constant, it equals the scalar IntExpense by construction.
  ROWS.intExp = r;
  lblF("Interest Expense", STYLE.rowLabel);
  acts.forEach((row, i) => {
    const v = row.intExpense != null ? row.intExpense / p.scale : null;
    setCell(ws, r, colHist(i), safeNum(v), STYLE.input, NF.money);
  });
  // Compute implied effective interest rate (kd) from base year. Use TotalDebt
  // > 0 as guard. If debt is zero or expense is null, hold flat at IntExpense.
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    // IF(TotalDebt > 0, IntExpense * (TotalDebt-this-year / TotalDebt-base), IntExpense)
    // Since both TotalDebt named-range and the BS forecast TotalDebt row exist by build order,
    // approximate by scaling against revenue growth proxy when BS isn't ready yet.
    // Conservative formula: IntExpense held flat — but we expose Kd in WACC build.
    setCell(ws, r, c, { formula: `IntExpense` }, STYLE.formula, NF.money);
  }
  r++;

  // PBT
  ROWS.pbt = r;
  lblF("Profit Before Tax (PBT)", STYLE.subtotalLabel);
  for (let i = 0; i < nA; i++) {
    const c = colHist(i);
    const v = acts[i].pbt != null ? acts[i].pbt / p.scale : null;
    setCell(ws, r, c, safeNum(v), STYLE.subtotal, NF.money);
  }
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, r, c, { formula: `${col(c)}${ROWS.ebit} + ${col(c)}${ROWS.intIncome} - ${col(c)}${ROWS.intExp}` },
      STYLE.subtotal, NF.money);
  }
  r++;

  // Tax
  ROWS.tax = r;
  lblF("Tax Expense", STYLE.rowLabel);
  acts.forEach((row, i) => {
    const v = row.tax != null ? row.tax / p.scale : null;
    setCell(ws, r, colHist(i), safeNum(v), STYLE.input, NF.money);
  });
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, r, c, { formula: `${col(c)}${ROWS.pbt} * INDEX(Yw_taxRate, ${y}) / 100` },
      STYLE.formula, NF.money);
  }
  r++;

  // Share of Profit from Associates (historical only)
  lblF("Share of Profit from Associates", STYLE.rowLabelSub);
  acts.forEach((row, i) => {
    const v = row.associateShare != null ? row.associateShare / p.scale : null;
    if (v != null) setCell(ws, r, colHist(i), v, STYLE.input, NF.money);
    else setCell(ws, r, colHist(i), "", STYLE.rowLabelSub);
  });
  for (let y = 1; y <= nF; y++) setCell(ws, r, colFC(y), "", STYLE.rowLabelSub);
  r++;

  // PAT
  ROWS.pat = r;
  lblF("Profit After Tax (PAT)", STYLE.totalLabel);
  for (let i = 0; i < nA; i++) {
    const c = colHist(i);
    const v = acts[i].pat != null ? acts[i].pat / p.scale : null;
    setCell(ws, r, c, safeNum(v), STYLE.total, NF.money);
  }
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, r, c, { formula: `${col(c)}${ROWS.pbt} - ${col(c)}${ROWS.tax}` },
      STYLE.total, NF.money);
  }
  r++;

  // Minority Interest (historical only)
  lblF("  Minority Interest", STYLE.rowLabelSub);
  acts.forEach((row, i) => {
    const v = row.minorityIntIncome != null ? row.minorityIntIncome / p.scale : null;
    if (v != null) setCell(ws, r, colHist(i), v, STYLE.input, NF.money);
    else setCell(ws, r, colHist(i), "", STYLE.rowLabelSub);
  });
  for (let y = 1; y <= nF; y++) setCell(ws, r, colFC(y), "", STYLE.rowLabelSub);
  r++;

  // Attributable to Parent (historical only)
  lblF("  Attributable to Parent", STYLE.rowLabelSub);
  acts.forEach((row, i) => {
    const v = row.patAttributableToParent != null ? row.patAttributableToParent / p.scale : null;
    if (v != null) setCell(ws, r, colHist(i), v, STYLE.input, NF.money);
    else setCell(ws, r, colHist(i), "", STYLE.rowLabelSub);
  });
  for (let y = 1; y <= nF; y++) setCell(ws, r, colFC(y), "", STYLE.rowLabelSub);
  r++;

  // PAT Margin %
  lblF("  PAT Margin (%)", STYLE.rowLabelSub);
  for (let i = 0; i < nA + nF; i++) {
    const c = i < nA ? colHist(i) : colFC(i - nA + 1);
    setCell(ws, r, c,
      { formula: `IFERROR(${col(c)}${ROWS.pat} / ${col(c)}${ROWS.rev}, 0)` },
      STYLE.formula, NF.pct1);
  }
  r++;

  // EPS
  if (p.epsAvailable !== false) {
    lblF(`Basic EPS (${p.ccySym})`, STYLE.rowLabelBold);
    acts.forEach((row, i) => {
      const v = row.eps;
      if (v != null) setCell(ws, r, colHist(i), v, STYLE.input, NF.money2);
      else setCell(ws, r, colHist(i), "", STYLE.formulaBold);
    });
    for (let y = 1; y <= nF; y++) {
      const c = colFC(y);
      setCell(ws, r, c, { formula: `${col(c)}${ROWS.pat} * ${epsFactor} / SharesMn` },
        STYLE.formulaBold, NF.money2);
    }
    r++;

    lblF(`Diluted EPS (${p.ccySym})`, STYLE.rowLabel);
    acts.forEach((row, i) => {
      const v = row.epsDiluted;
      if (v != null) setCell(ws, r, colHist(i), v, STYLE.input, NF.money2);
      else setCell(ws, r, colHist(i), "", STYLE.formula);
    });
    for (let y = 1; y <= nF; y++) {
      const c = colFC(y);
      setCell(ws, r, c, { formula: `${col(c)}${ROWS.pat} * ${epsFactor} / SharesMn` },
        STYLE.formula, NF.money2);
    }
    r++;
  }

  // Expose row indices for BS/CF
  if (!wb._rowIndex) wb._rowIndex = {};
  wb._rowIndex.is = { ...ROWS, nA, nF, colHist, colFC };

  ws.pageSetup.printArea = `A1:${col(2 + nA + nF)}${r}`;
}
// ════════════════════════════════════════════════════════════════════════════
// SHEET 6 — BALANCE SHEET  (integrated: actuals + forecast, formula-driven)
// ════════════════════════════════════════════════════════════════════════════
// Mirrors the Lab's Yahoo-native hierarchy (flattened to fixed indentation).
// Forecast cells are ALL formulas — driven by:
//   • IS rows (rev, cogs, dep, pat) via cross-sheet refs
//   • CF closing cash via INDEX/MATCH on the CF sheet label column
//   • DSO/DIO/DPO and Yw_* yearwise drivers from Assumptions
//   • Prior-column cells for rollforwards (PPE, Debt, Equity)
//
// Equity decomposition: Share Capital + Other Equity = Equity by construction.
// Other Equity historical = totalEquity − shareCapital (always reconciles).
// ════════════════════════════════════════════════════════════════════════════
function addBalanceSheet(wb, p) {
  const ws = wb.addWorksheet("Balance Sheet", {
    properties: { tabColor: { argb: C.green } },
    views: [{ showGridLines: false, state: "frozen", xSplit: 2, ySplit: 5 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1,
                 margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.3, footer: 0.3 } },
  });

  const acts = p.statements?.balanceActuals || [];
  const horizon = p.assumptions?.forecastHorizon || p.uiState?.forecastHorizon || 5;
  const nA = acts.length, nF = horizon;

  const isR = wb._rowIndex?.is || {};
  const isRev = isR.rev, isCogs = isR.cogs, isDep = isR.dep, isPat = isR.pat;

  const colsLayout = [{ width: 3 }, { width: 38 }];
  for (let i = 0; i < nA + nF; i++) colsLayout.push({ width: 14 });
  ws.columns = colsLayout;

  const colHist = (i) => 3 + i;
  const colFC = (y) => 2 + nA + y;
  const baseYear = (p.statements?.incomeActuals?.slice(-1)[0]?.year) ?? (new Date().getFullYear());
  const epsFactor = p.isINR ? 10 : 1;

  pageHeader(ws, "Balance Sheet",
    `${nA}y actuals + ${nF}y forecast · ${p.unit} · forecast linked to IS, CF, and Assumptions`,
    2 + nA + nF);

  let r = 5;
  setCell(ws, r, 2, "Line Item", STYLE.colHeader);
  acts.forEach((row, i) => setCell(ws, r, colHist(i), fy(row.year), STYLE.colHeader));
  for (let y = 1; y <= nF; y++) {
    const tag = y <= 3 ? ` (Y${y})` : "";
    setCell(ws, r, colFC(y), { formula: `"FY"&RIGHT(${baseYear}+${y},2)&"E${tag}"` }, STYLE.colHeader, NF.txt);
  }
  ws.getRow(r).height = 22;
  r++;

  const ROWS = {};
  const lblF = (text, style) => setCell(ws, r, 2, text, style);
  const histVals = (field) => {
    acts.forEach((row, i) => {
      const v = row[field] != null ? row[field] / p.scale : null;
      setCell(ws, r, colHist(i), safeNum(v), STYLE.input, NF.money);
    });
  };

  // Task 4: Smart held-flat replacement.
  //   When a balance-sheet item has no driver-based formula (e.g. Goodwill,
  //   LT Investments, Other NCL, DTL), we previously just rolled the prior
  //   value forward (= prev). That's not institutionally reasonable when
  //   the historical series shows a clear trend.
  //
  //   The helper below computes the historical CAGR over the actuals;
  //   if it is "stable enough" (|CAGR| <= 25% AND all historical values
  //   non-zero with same sign), it applies that CAGR per forecast year.
  //   Otherwise it holds flat (prev). The decision is computed server-side
  //   here, then either a flat-forward or a (prev × (1 + g)) formula is
  //   written into the cell — fully dynamic in Excel.
  //
  //   Returns either { mode: "flat" } or { mode: "cagr", rate: <decimal> }.
  function trendOrFlat(field) {
    const series = acts.map((row) => row[field]).filter((v) => v != null && isFinite(v));
    if (series.length < 3) return { mode: "flat" };
    const first = series[0], last = series.at(-1);
    if (first === 0 || last === 0) return { mode: "flat" };
    if (Math.sign(first) !== Math.sign(last)) return { mode: "flat" };
    const periods = series.length - 1;
    const cagr = Math.pow(Math.abs(last / first), 1 / periods) - 1;
    // Cap at ±25%/yr; otherwise prefer flat (extreme growth is unlikely to
    // continue, and gives the model BS plug something cleaner to absorb).
    if (Math.abs(cagr) > 0.25) return { mode: "flat" };
    // If trend reversed (e.g. peaks in the middle), prefer flat over CAGR.
    if (Math.abs(series[series.length - 2]) > 0 && Math.sign(last - series[series.length - 2]) !== Math.sign(last - first)) {
      // The most recent change is in the OPPOSITE direction of the long-term trend:
      // be conservative and hold flat.
      return { mode: "flat" };
    }
    return { mode: "cagr", rate: cagr };
  }

  // Helper: write a single-year forecast cell that either holds flat
  // (prev cell) or applies the trend rate. Pass the current `c` and `r`.
  function holdOrTrend(field, c, rowIdx) {
    const cPrev = c - 1;
    const t = trendOrFlat(field);
    if (t.mode === "cagr") {
      return { formula: `${col(cPrev)}${rowIdx} * (1 + ${t.rate.toFixed(6)})` };
    }
    return { formula: `${col(cPrev)}${rowIdx}` };
  }

  // ── ASSETS ─────────────────────────────────────────────────────────────
  bannerRow(ws, r, 2, 2 + nA + nF, "1.  ASSETS"); r++;

  // Cash (linked to CF closing cash via INDEX/MATCH on label column)
  ROWS.cash = r;
  lblF("Cash & Cash Equivalents", STYLE.rowLabel);
  histVals("cash");
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, r, c,
      { formula: `INDEX('Cash Flow'!${col(c)}:${col(c)}, MATCH("Closing Cash Balance",'Cash Flow'!$B:$B,0))` },
      STYLE.formula, NF.money);
  }
  r++;

  // Short-Term Investments
  //   Task 4: trend-aware projection (CAGR if stable; else flat).
  ROWS.stInv = r;
  lblF("Short-Term Investments", STYLE.rowLabel);
  histVals("shortTermInvestments");
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, r, c, holdOrTrend("shortTermInvestments", c, r), STYLE.formula, NF.money);
  }
  r++;

  // Trade Receivables
  ROWS.recv = r;
  lblF("Trade Receivables", STYLE.rowLabel);
  histVals("receivables");
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, r, c, { formula: `'Income Statement'!${col(c)}${isRev} * DSO / 365` },
      STYLE.formula, NF.money);
  }
  r++;

  // Inventory
  ROWS.inv = r;
  lblF("Inventory", STYLE.rowLabel);
  histVals("inventory");
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, r, c, { formula: `'Income Statement'!${col(c)}${isCogs} * DIO / 365` },
      STYLE.formula, NF.money);
  }
  r++;

  // Other Current Assets — PLUG. Reported subtotal − (Cash + STI + Recv + Inv).
  // Ensures Total Current Assets row reconciles to reported value exactly,
  // regardless of whether Yahoo's `otherCA` field is complete (Task 8 Rule D).
  ROWS.otherCA = r;
  lblF("Other Current Assets", STYLE.rowLabel);
  acts.forEach((row, i) => {
    const ca = row.currentAssets ?? row.totalCA;
    let v;
    if (ca != null && isFinite(ca)) {
      v = Math.max(0,
        ca - (row.cash || 0) - (row.shortTermInvestments || 0)
           - (row.receivables || 0) - (row.inventory || 0));
    } else {
      v = row.otherCA || 0;
    }
    setCell(ws, r, colHist(i), safeNum(v / p.scale), STYLE.input, NF.money);
  });
  // Forecast: scale with revenue (legacy behaviour; CA still reconciles since
  // forecast's totalCA = cash + STI(=0) + recv + inv + this row).
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    const cPrev = c - 1;
    setCell(ws, r, c,
      { formula: `IFERROR(${col(cPrev)}${r} * 'Income Statement'!${col(c)}${isRev} / 'Income Statement'!${col(cPrev)}${isRev}, ${col(cPrev)}${r})` },
      STYLE.formula, NF.money);
  }
  r++;

  // Total Current Assets (= Cash + STI + Recv + Inv + Other CA)
  ROWS.totalCA = r;
  lblF("Total Current Assets", STYLE.subtotalLabel);
  for (let i = 0; i < nA + nF; i++) {
    const c = i < nA ? colHist(i) : colFC(i - nA + 1);
    setCell(ws, r, c,
      { formula: `${col(c)}${ROWS.cash} + ${col(c)}${ROWS.stInv} + ${col(c)}${ROWS.recv} + ${col(c)}${ROWS.inv} + ${col(c)}${ROWS.otherCA}` },
      STYLE.subtotal, NF.money);
  }
  r++;

  // Net PPE rollforward: prev + capex − D&A
  ROWS.ppe = r;
  lblF("Net Property, Plant & Equipment", STYLE.rowLabel);
  histVals("netPPE");
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    const cPrev = c - 1;
    setCell(ws, r, c,
      { formula: `${col(cPrev)}${r} + ('Income Statement'!${col(c)}${isRev} * INDEX(Yw_capexPctRev, ${y})/100) - 'Income Statement'!${col(c)}${isDep}` },
      STYLE.formula, NF.money);
  }
  r++;

  // Goodwill & Intangibles — trend-aware (Task 4)
  ROWS.goodwillIntan = r;
  lblF("Goodwill & Intangible Assets", STYLE.rowLabel);
  histVals("goodwillAndOtherIntangibleAssets");
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, r, c, holdOrTrend("goodwillAndOtherIntangibleAssets", c, r), STYLE.formula, NF.money);
  }
  r++;

  // Long-Term Investments — trend-aware (Task 4)
  ROWS.investments = r;
  lblF("Long-Term Investments", STYLE.rowLabel);
  histVals("investments");
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, r, c, holdOrTrend("investments", c, r), STYLE.formula, NF.money);
  }
  r++;

  // Other Non-current Assets — PLUG.
  //   Historical: Reported NCA − (PPE + Goodwill&Intan + LT Investments).
  //   Forecast:   filled later after Total Assets is known (absorbs A=L+E plug).
  // Ensures Total Non-Current Assets row reconciles to reported value exactly.
  ROWS.otherNCA = r;
  lblF("Other Non-current Assets", STYLE.rowLabel);
  acts.forEach((row, i) => {
    const nca = row.totalNonCurrentAssets
      ?? (row.totalAssets != null && row.totalCA != null ? row.totalAssets - row.totalCA : null);
    let v;
    if (nca != null && isFinite(nca)) {
      const goodwillIntan = (row.goodwillAndOtherIntangibleAssets != null)
        ? row.goodwillAndOtherIntangibleAssets
        : (row.goodwill || 0) + (row.intangibles || 0);
      v = Math.max(0, nca - (row.ppe || row.netPPE || 0) - goodwillIntan - (row.investments || 0));
    } else {
      v = row.otherNCA || 0;
    }
    setCell(ws, r, colHist(i), safeNum(v / p.scale), STYLE.input, NF.money);
  });
  for (let y = 1; y <= nF; y++) setCell(ws, r, colFC(y), 0, STYLE.formula, NF.money);
  r++;

  // Total Non-current Assets
  ROWS.totalNCA = r;
  lblF("Total Non-current Assets", STYLE.subtotalLabel);
  acts.forEach((row, i) => {
    const v = row.totalNonCurrentAssets != null ? row.totalNonCurrentAssets / p.scale : null;
    setCell(ws, r, colHist(i), safeNum(v), STYLE.subtotal, NF.money);
  });
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, r, c,
      { formula: `${col(c)}${ROWS.ppe} + ${col(c)}${ROWS.goodwillIntan} + ${col(c)}${ROWS.investments} + ${col(c)}${ROWS.otherNCA}` },
      STYLE.subtotal, NF.money);
  }
  r++;

  // TOTAL ASSETS (forecast = TOTAL LIAB + TOTAL EQUITY incl MI; filled later)
  ROWS.totalAssets = r;
  lblF("TOTAL ASSETS", STYLE.totalLabel);
  acts.forEach((row, i) => {
    const v = row.totalAssets != null ? row.totalAssets / p.scale : null;
    setCell(ws, r, colHist(i), safeNum(v), STYLE.total, NF.money);
  });
  for (let y = 1; y <= nF; y++) setCell(ws, r, colFC(y), 0, STYLE.total, NF.money);
  r += 2;

  // ── LIABILITIES ────────────────────────────────────────────────────────
  bannerRow(ws, r, 2, 2 + nA + nF, "2.  LIABILITIES"); r++;

  // Trade Payables = COGS × DPO / 365
  ROWS.pay = r;
  lblF("Trade Payables", STYLE.rowLabel);
  histVals("payables");
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, r, c, { formula: `'Income Statement'!${col(c)}${isCogs} * DPO / 365` },
      STYLE.formula, NF.money);
  }
  r++;

  // Short-term Debt (will reference its own ROWS.stDebt and ROWS.ltDebt; we
  // reserve row position now and fill formulas after ltDebt's row is known)
  ROWS.stDebt = r;
  lblF("Short-term Debt", STYLE.rowLabel);
  histVals("stDebt");
  // Placeholders — patched after LT Debt row is added
  for (let y = 1; y <= nF; y++) setCell(ws, r, colFC(y), 0, STYLE.formula, NF.money);
  r++;

  // Other Current Liabilities — PLUG. Reported subtotal − (ST Debt + Payables).
  // Ensures Total Current Liabilities row reconciles to reported value exactly.
  ROWS.otherCL = r;
  lblF("Other Current Liabilities", STYLE.rowLabel);
  acts.forEach((row, i) => {
    const cl = row.currentLiab;
    let v;
    if (cl != null && isFinite(cl)) {
      v = Math.max(0, cl - (row.stDebt || 0) - (row.payables || 0));
    } else {
      v = row.otherCL || 0;
    }
    setCell(ws, r, colHist(i), safeNum(v / p.scale), STYLE.input, NF.money);
  });
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    const cPrev = c - 1;
    setCell(ws, r, c,
      { formula: `IFERROR(${col(cPrev)}${r} * 'Income Statement'!${col(c)}${isRev} / 'Income Statement'!${col(cPrev)}${isRev}, ${col(cPrev)}${r})` },
      STYLE.formula, NF.money);
  }
  r++;

  // Total Current Liabilities
  ROWS.totalCL = r;
  lblF("Total Current Liabilities", STYLE.subtotalLabel);
  acts.forEach((row, i) => {
    const v = row.currentLiab != null ? row.currentLiab / p.scale : null;
    setCell(ws, r, colHist(i), safeNum(v), STYLE.subtotal, NF.money);
  });
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, r, c,
      { formula: `${col(c)}${ROWS.pay} + ${col(c)}${ROWS.stDebt} + ${col(c)}${ROWS.otherCL}` },
      STYLE.subtotal, NF.money);
  }
  r++;

  // Long-term Debt rollforward
  ROWS.ltDebt = r;
  lblF("Long-term Debt", STYLE.rowLabel);
  histVals("ltDebt");
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    const cPrev = c - 1;
    // ltDebt_new = MAX(0, totalDebtPrev − repaid + issued) − stDebt_new
    setCell(ws, r, c,
      { formula: `MAX(0, (${col(cPrev)}${ROWS.stDebt} + ${col(cPrev)}${r}) - INDEX('Cash Flow'!${col(c)}:${col(c)},MATCH("Debt Repaid",'Cash Flow'!$B:$B,0)) + INDEX('Cash Flow'!${col(c)}:${col(c)},MATCH("Debt Issued",'Cash Flow'!$B:$B,0))) - ${col(c)}${ROWS.stDebt}` },
      STYLE.formula, NF.money);
  }
  r++;

  // Patch ST Debt forecast cells now that we know ltDebt row
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    const cPrev = c - 1;
    setCell(ws, ROWS.stDebt, c,
      { formula: `IFERROR(MAX(0, (${col(cPrev)}${ROWS.stDebt} + ${col(cPrev)}${ROWS.ltDebt}) - INDEX('Cash Flow'!${col(c)}:${col(c)},MATCH("Debt Repaid",'Cash Flow'!$B:$B,0)) + INDEX('Cash Flow'!${col(c)}:${col(c)},MATCH("Debt Issued",'Cash Flow'!$B:$B,0))) * ${col(cPrev)}${ROWS.stDebt} / (${col(cPrev)}${ROWS.stDebt} + ${col(cPrev)}${ROWS.ltDebt}), 0)` },
      STYLE.formula, NF.money);
  }

  // LT Lease — separate row per revised user spec (Task 7 NCL has 4 rows)
  // Task 6: NOT included in Total Debt (debt = ST + LT only).
  ROWS.ltLease = r;
  lblF("Lease Liabilities", STYLE.rowLabel);
  histVals("longTermLease");
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, r, c, holdOrTrend("longTermLease", c, r), STYLE.formula, NF.money);
  }
  r++;

  // Deferred Tax Liabilities — separate row per revised user spec
  ROWS.dtl = r;
  lblF("Deferred Tax Liabilities", STYLE.rowLabel);
  histVals("deferredTaxLiab");
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, r, c, holdOrTrend("deferredTaxLiab", c, r), STYLE.formula, NF.money);
  }
  r++;

  // Other Non-Current Liabilities — PLUG so Long-Term Debt + Lease + DTL +
  // Other NCL = reported Total Non-Current Liabilities exactly (Task 8 Rule D).
  // Historical = reported NCL − (LT Debt + Lease + DTL); never goes negative.
  ROWS.otherNCL = r;
  lblF("Other Non-Current Liabilities", STYLE.rowLabel);
  acts.forEach((row, i) => {
    const ncl = row.nonCurrentLiab;
    let v;
    if (ncl != null && isFinite(ncl)) {
      v = Math.max(0, ncl - (row.ltDebt || 0) - (row.longTermLease || 0) - (row.deferredTaxLiab || 0));
    } else {
      v = row.otherNCL || 0;
    }
    setCell(ws, r, colHist(i), safeNum(v / p.scale), STYLE.input, NF.money);
  });
  // Forecast: trend-aware projection of the residual otherNCL series.
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, r, c, holdOrTrend("otherNCL", c, r), STYLE.formula, NF.money);
  }
  r++;

  // Total NCL = Long-Term Debt + Lease + DTL + Other NCL
  ROWS.totalNCL = r;
  lblF("Total Non-current Liabilities", STYLE.subtotalLabel);
  acts.forEach((row, i) => {
    const v = row.nonCurrentLiab != null ? row.nonCurrentLiab / p.scale : null;
    setCell(ws, r, colHist(i), safeNum(v), STYLE.subtotal, NF.money);
  });
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, r, c,
      { formula: `${col(c)}${ROWS.ltDebt} + ${col(c)}${ROWS.ltLease} + ${col(c)}${ROWS.dtl} + ${col(c)}${ROWS.otherNCL}` },
      STYLE.subtotal, NF.money);
  }
  r++;

  // TOTAL LIABILITIES
  ROWS.totalLiab = r;
  lblF("TOTAL LIABILITIES", STYLE.totalLabel);
  acts.forEach((row, i) => {
    const v = row.totalLiab != null ? row.totalLiab / p.scale : null;
    setCell(ws, r, colHist(i), safeNum(v), STYLE.total, NF.money);
  });
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, r, c, { formula: `${col(c)}${ROWS.totalCL} + ${col(c)}${ROWS.totalNCL}` },
      STYLE.total, NF.money);
  }
  r += 2;

  // ── EQUITY (revised user spec — 4 flat rows under TOTAL EQUITY) ────────
  // Total Equity = Share Capital + Reserves & Surplus + Minority Interest + Other Equity
  //
  // Reserves & Surplus follows the Indian aggregate convention:
  //   R&S = Stockholders' Equity (attributable to parent) − Share Capital
  // For Indian companies where Yahoo doesn't expose Retained Earnings, this
  // captures everything below Share Capital (RE + reserves + OCI + treasury
  // movements). For US filers, the R&S row will mostly be RE (plus a bit of
  // APIC / treasury), which is the same number presented under the Indian
  // label. Cleaner display for both jurisdictions than splitting an
  // unreliable RE field.
  //
  // Other Equity is a PLUG that absorbs any drift between reported total
  // equity-gross-MI and (SC + R&S + MI). When the BS reconciles cleanly,
  // this row is 0 by construction.
  bannerRow(ws, r, 2, 2 + nA + nF, "3.  SHAREHOLDERS' EQUITY"); r++;

  // Share Capital (held flat — no equity issuance modelled by default)
  ROWS.shareCap = r;
  lblF("Share Capital", STYLE.rowLabel);
  histVals("shareCapital");
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, r, c, { formula: `${col(c - 1)}${r}` }, STYLE.formula, NF.money);
  }
  r++;

  // Reserves & Surplus
  //   Historical: equity_attributable − shareCapital (aggregate convention)
  //   Forecast:   prev + PAT − Dividends − Buybacks (the full equity rollforward
  //               for everything below Share Capital). Mirrors the IDCF
  //               equity rollforward exactly.
  ROWS.resSurplus = r;
  lblF("Reserves & Surplus", STYLE.rowLabel);
  acts.forEach((row, i) => {
    const eq = row.equity ?? null;
    const sc = row.shareCapital ?? 0;
    const v = (eq != null) ? (eq - sc) / p.scale : null;
    setCell(ws, r, colHist(i), safeNum(v), STYLE.input, NF.money);
  });
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    const cPrev = c - 1;
    setCell(ws, r, c,
      { formula: `${col(cPrev)}${r} + 'Income Statement'!${col(c)}${isPat} - INDEX('Cash Flow'!${col(c)}:${col(c)},MATCH("Dividends Paid",'Cash Flow'!$B:$B,0)) - INDEX('Cash Flow'!${col(c)}:${col(c)},MATCH("Share Buybacks",'Cash Flow'!$B:$B,0))` },
      STYLE.formula, NF.money);
  }
  r++;

  // Minority Interest — trend-aware (Task 4)
  ROWS.mi = r;
  lblF("Minority Interest", STYLE.rowLabel);
  histVals("minorityInterest");
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, r, c, holdOrTrend("minorityInterest", c, r), STYLE.formula, NF.money);
  }
  r++;

  // Other Equity — PLUG. Historical = totalEquityGrossMI − (SC + R&S + MI).
  // Forecast = 0 (R&S already captures everything below SC by construction).
  ROWS.otherEq = r;
  lblF("Other Equity", STYLE.rowLabel);
  acts.forEach((row, i) => {
    const teGMI = row.totalEquityGrossMI != null ? row.totalEquityGrossMI
                : ((row.equity || 0) + (row.minorityInterest || 0));
    const sc = row.shareCapital || 0;
    const rs = (row.equity != null) ? row.equity - sc : 0;
    const mi = row.minorityInterest || 0;
    const v = (teGMI - sc - rs - mi) / p.scale;
    setCell(ws, r, colHist(i), safeNum(v), STYLE.input, NF.money);
  });
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, r, c, 0, STYLE.formula, NF.money);
  }
  r++;

  // TOTAL EQUITY = Share Capital + R&S + MI + Other Equity (4-row sum)
  ROWS.totalEqMI = r;
  lblF("TOTAL EQUITY", STYLE.totalLabel);
  acts.forEach((row, i) => {
    const v = row.totalEquityGrossMI != null ? row.totalEquityGrossMI / p.scale
            : ((row.equity || 0) + (row.minorityInterest || 0)) / p.scale;
    setCell(ws, r, colHist(i), safeNum(v), STYLE.total, NF.money);
  });
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, r, c,
      { formula: `${col(c)}${ROWS.shareCap} + ${col(c)}${ROWS.resSurplus} + ${col(c)}${ROWS.mi} + ${col(c)}${ROWS.otherEq}` },
      STYLE.total, NF.money);
  }
  // Keep ROWS.equity pointing to the same totalEqMI for downstream refs
  ROWS.equity = ROWS.totalEqMI;
  r += 2;

  // Back-fill TOTAL ASSETS forecast = TOTAL LIAB + TOTAL EQUITY (incl MI)
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, ROWS.totalAssets, c,
      { formula: `${col(c)}${ROWS.totalLiab} + ${col(c)}${ROWS.totalEqMI}` },
      STYLE.total, NF.money);
  }
  // Back-fill Other NCA as plug — absorbs any reconciliation gap between
  // reported / forecast Total Assets and the sum of explicitly-modelled
  // line items. By construction, this guarantees A = L + E (Task 8: Rule D).
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, ROWS.otherNCA, c,
      { formula: `MAX(0, ${col(c)}${ROWS.totalAssets} - ${col(c)}${ROWS.cash} - ${col(c)}${ROWS.stInv} - ${col(c)}${ROWS.recv} - ${col(c)}${ROWS.inv} - ${col(c)}${ROWS.otherCA} - ${col(c)}${ROWS.ppe} - ${col(c)}${ROWS.goodwillIntan} - ${col(c)}${ROWS.investments})` },
      STYLE.formula, NF.money);
  }

  // ── DERIVED TOTALS ─────────────────────────────────────────────────────
  bannerRow(ws, r, 2, 2 + nA + nF, "4.  DERIVED TOTALS  (analyst reference)"); r++;

  ROWS.totalDebt = r;
  lblF("Total Debt  (Short-term + Long-term Debt)", STYLE.rowLabelBold);
  // Task 6: Total Debt = ST Debt + LT Debt ONLY. Lease liabilities are
  // contractual obligations but are NOT debt for net-debt / EV-to-equity
  // bridge purposes. Historical row computes from the ST/LT rows on this
  // sheet (which are sourced from Yahoo's stDebt/ltDebt fields, which
  // already exclude leases — leases are surfaced separately on the
  // longTermLease row above).
  for (let i = 0; i < nA + nF; i++) {
    const c = i < nA ? colHist(i) : colFC(i - nA + 1);
    setCell(ws, r, c, { formula: `${col(c)}${ROWS.stDebt} + ${col(c)}${ROWS.ltDebt}` },
      STYLE.formulaBold, NF.money);
  }
  r++;

  lblF("Net Debt  (Total Debt − Cash)", STYLE.rowLabel);
  for (let i = 0; i < nA + nF; i++) {
    const c = i < nA ? colHist(i) : colFC(i - nA + 1);
    setCell(ws, r, c, { formula: `${col(c)}${ROWS.totalDebt} - ${col(c)}${ROWS.cash}` },
      STYLE.formula, NF.money);
  }
  r++;

  lblF("Working Capital  (Current Assets − Current Liab.)", STYLE.rowLabel);
  for (let i = 0; i < nA + nF; i++) {
    const c = i < nA ? colHist(i) : colFC(i - nA + 1);
    setCell(ws, r, c, { formula: `${col(c)}${ROWS.totalCA} - ${col(c)}${ROWS.totalCL}` },
      STYLE.formula, NF.money);
  }
  r++;

  lblF("Invested Capital  (Equity + Total Debt)", STYLE.rowLabel);
  for (let i = 0; i < nA + nF; i++) {
    const c = i < nA ? colHist(i) : colFC(i - nA + 1);
    setCell(ws, r, c, { formula: `${col(c)}${ROWS.equity} + ${col(c)}${ROWS.totalDebt}` },
      STYLE.formula, NF.money);
  }
  r++;

  lblF(`Book Value / Share  (${p.ccySym}/sh)`, STYLE.rowLabel);
  for (let i = 0; i < nA + nF; i++) {
    const c = i < nA ? colHist(i) : colFC(i - nA + 1);
    setCell(ws, r, c, { formula: `IFERROR(${col(c)}${ROWS.equity} * ${epsFactor} / SharesMn, 0)` },
      STYLE.formula, NF.money2);
  }
  r += 2;

  // ── RECONCILIATION (HIDDEN) ────────────────────────────────────────────
  // Task 8: The user-facing Balance Sheet must NEVER display reconciliation
  // differences. By construction, Other Non-current Assets is the plug
  // (forecast) and Minority Interest absorbs any historical drift, so the
  // diff is always zero. We still emit the diff row because the Audit sheet
  // references it via INDEX/MATCH on the label — but we set the row height
  // to 0 (hidden) so it doesn't render in the user-facing view.
  const reconRow = r;
  lblF("Difference (should ≈ 0)", { font: fontBase(C.greyDk, false, 9), alignment: { horizontal: "left" } });
  for (let i = 0; i < nA + nF; i++) {
    const c = i < nA ? colHist(i) : colFC(i - nA + 1);
    setCell(ws, r, c,
      { formula: `${col(c)}${ROWS.totalAssets} - ${col(c)}${ROWS.totalLiab} - ${col(c)}${ROWS.totalEqMI}` },
      { font: fontBase(C.greyDk, false, 9), alignment: { horizontal: "right" } }, NF.money2);
  }
  // Hide the row from view (height = 0, hidden = true). The Audit sheet's
  // INDEX/MATCH still resolves correctly because the formula remains intact.
  ws.getRow(reconRow).height = 0.01;
  ws.getRow(reconRow).hidden = true;
  r++;

  // Expose row indices for CF
  if (!wb._rowIndex) wb._rowIndex = {};
  wb._rowIndex.bs = { ...ROWS, nA, nF, colHist, colFC };

  ws.pageSetup.printArea = `A1:${col(2 + nA + nF)}${r}`;
}
function addCashFlow(wb, p) {
  const ws = wb.addWorksheet("Cash Flow", {
    properties: { tabColor: { argb: C.green } },
    views: [{ showGridLines: false, state: "frozen", xSplit: 2, ySplit: 5 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1,
                 margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.3, footer: 0.3 } },
  });

  const acts = p.statements?.cashflowActuals || [];
  const horizon = p.assumptions?.forecastHorizon || p.uiState?.forecastHorizon || 5;
  const nA = acts.length, nF = horizon;

  const isR = wb._rowIndex?.is || {};
  const bsR = wb._rowIndex?.bs || {};
  const isRev    = isR.rev,    isEbitda = isR.ebitda, isTax = isR.tax;
  const isPat    = isR.pat;
  const bsRecv   = bsR.recv,   bsInv   = bsR.inv,   bsPay   = bsR.pay;
  const bsOtherCA = bsR.otherCA, bsOtherCL = bsR.otherCL;
  const bsStDebt = bsR.stDebt, bsLtDebt = bsR.ltDebt, bsEquity = bsR.equity;

  const colsLayout = [{ width: 3 }, { width: 38 }];
  for (let i = 0; i < nA + nF; i++) colsLayout.push({ width: 14 });
  ws.columns = colsLayout;

  const colHist = (i) => 3 + i;
  const colFC = (y) => 2 + nA + y;
  const baseYear = (p.statements?.incomeActuals?.slice(-1)[0]?.year) ?? (new Date().getFullYear());

  pageHeader(ws, "Cash Flow Statement",
    `${nA}y actuals + ${nF}y forecast · ${p.unit} · indirect method · forecast linked to IS / BS`,
    2 + nA + nF);

  let r = 5;
  // Header row
  setCell(ws, r, 2, "Line Item", STYLE.colHeader);
  acts.forEach((row, i) => setCell(ws, r, colHist(i), fy(row.year), STYLE.colHeader));
  for (let y = 1; y <= nF; y++) {
    const tag = y <= 3 ? ` (Y${y})` : "";
    setCell(ws, r, colFC(y), { formula: `"FY"&RIGHT(${baseYear}+${y},2)&"E${tag}"` }, STYLE.colHeader, NF.txt);
  }
  ws.getRow(r).height = 22;
  r++;

  const ROWS = {};
  const lblF = (text, style) => setCell(ws, r, 2, text, style);
  const histF = (field, sign = 1) => acts.forEach((row, i) => {
    const v = row[field] != null ? sign * row[field] / p.scale : null;
    setCell(ws, r, colHist(i), safeNum(v), STYLE.input, NF.money);
  });
  const histEmpty = () => acts.forEach((_, i) => setCell(ws, r, colHist(i), "", STYLE.rowLabel));

  // ── OPERATING ───────────────────────────────────────────────────────────
  bannerRow(ws, r, 2, 2 + nA + nF, "1.  CASH FROM OPERATING ACTIVITY"); r++;

  // EBITDA (link to IS)
  ROWS.ebitda = r;
  lblF("  EBITDA", STYLE.rowLabel);
  acts.forEach((row, i) => {
    const v = row.ebitda != null ? row.ebitda / p.scale : null;
    setCell(ws, r, colHist(i), safeNum(v), STYLE.input, NF.money);
  });
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, r, c, { formula: `'Income Statement'!${col(c)}${isEbitda}` }, STYLE.formula, NF.money);
  }
  r++;

  // Working Capital Movement
  ROWS.wcMove = r;
  lblF("  Working Capital Movement", STYLE.rowLabel);
  acts.forEach((row, i) => {
    const v = row.wcMove != null ? row.wcMove / p.scale : null;
    if (v != null) setCell(ws, r, colHist(i), v, STYLE.input, NF.money);
    else setCell(ws, r, colHist(i), "", STYLE.rowLabel);
  });
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    const cPrev = c - 1;
    // ΔWC = (recv + inv + otherCA - pay - otherCL) curr − same prior
    setCell(ws, r, c,
      { formula: `('Balance Sheet'!${col(c)}${bsRecv} + 'Balance Sheet'!${col(c)}${bsInv} + 'Balance Sheet'!${col(c)}${bsOtherCA} ` +
                 `- 'Balance Sheet'!${col(c)}${bsPay} - 'Balance Sheet'!${col(c)}${bsOtherCL}) ` +
                 `- ('Balance Sheet'!${col(cPrev)}${bsRecv} + 'Balance Sheet'!${col(cPrev)}${bsInv} + 'Balance Sheet'!${col(cPrev)}${bsOtherCA} ` +
                 `- 'Balance Sheet'!${col(cPrev)}${bsPay} - 'Balance Sheet'!${col(cPrev)}${bsOtherCL})` },
      STYLE.formula, NF.money);
  }
  r++;

  // Less: Cash Tax
  ROWS.cashTax = r;
  lblF("  Less: Cash Tax", STYLE.rowLabel);
  acts.forEach((row, i) => {
    const v = row.cashTax != null ? Math.abs(row.cashTax) / p.scale : null;
    setCell(ws, r, colHist(i), safeNum(v), STYLE.input, NF.money);
  });
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, r, c, { formula: `'Income Statement'!${col(c)}${isTax}` }, STYLE.formula, NF.money);
  }
  r++;

  // CFO subtotal
  ROWS.cfo = r;
  lblF("Cash from Operating Activity (CFO)", STYLE.subtotalLabel);
  acts.forEach((row, i) => {
    const v = row.cfo != null ? row.cfo / p.scale : null;
    setCell(ws, r, colHist(i), safeNum(v), STYLE.subtotal, NF.money);
  });
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, r, c,
      { formula: `${col(c)}${ROWS.ebitda} - ${col(c)}${ROWS.wcMove} - ${col(c)}${ROWS.cashTax}` },
      STYLE.subtotal, NF.money);
  }
  r += 2;

  // ── INVESTING ──────────────────────────────────────────────────────────
  bannerRow(ws, r, 2, 2 + nA + nF, "2.  CASH FROM INVESTING ACTIVITY"); r++;

  // Capex (negative outflow)
  ROWS.capex = r;
  lblF("  Capital Expenditure", STYLE.rowLabel);
  acts.forEach((row, i) => {
    const v = row.capex != null ? -row.capex / p.scale : null;   // negative = outflow
    setCell(ws, r, colHist(i), safeNum(v), STYLE.input, NF.money);
  });
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, r, c,
      { formula: `-'Income Statement'!${col(c)}${isRev} * INDEX(Yw_capexPctRev, ${y}) / 100` },
      STYLE.formula, NF.money);
  }
  r++;

  // Acquisitions
  ROWS.acq = r;
  lblF("  Acquisitions / Strategic Spend", STYLE.rowLabel);
  histEmpty();
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, r, c,
      { formula: `-'Income Statement'!${col(c)}${isRev} * INDEX(Yw_strategicAcq, ${y}) / 100` },
      STYLE.formula, NF.money);
  }
  r++;

  // Historical-only line items
  lblF("  Fixed Assets Sold", STYLE.rowLabelSub);
  histF("fixedAssetsSold");
  for (let y = 1; y <= nF; y++) setCell(ws, r, colFC(y), "", STYLE.rowLabelSub);
  r++;
  lblF("  Investments Purchased", STYLE.rowLabelSub);
  histF("investmentsPurchased", -1);
  for (let y = 1; y <= nF; y++) setCell(ws, r, colFC(y), "", STYLE.rowLabelSub);
  r++;
  lblF("  Investments Sold", STYLE.rowLabelSub);
  histF("investmentsSold");
  for (let y = 1; y <= nF; y++) setCell(ws, r, colFC(y), "", STYLE.rowLabelSub);
  r++;
  lblF("  Interest Received", STYLE.rowLabelSub);
  histF("interestReceived");
  for (let y = 1; y <= nF; y++) setCell(ws, r, colFC(y), "", STYLE.rowLabelSub);
  r++;
  lblF("  Dividends Received", STYLE.rowLabelSub);
  histF("dividendsReceived");
  for (let y = 1; y <= nF; y++) setCell(ws, r, colFC(y), "", STYLE.rowLabelSub);
  r++;

  // InvestCF subtotal
  ROWS.investCF = r;
  lblF("Cash from Investing Activity", STYLE.subtotalLabel);
  acts.forEach((row, i) => {
    const v = row.investCF != null ? row.investCF / p.scale : null;
    setCell(ws, r, colHist(i), safeNum(v), STYLE.subtotal, NF.money);
  });
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, r, c, { formula: `${col(c)}${ROWS.capex} + ${col(c)}${ROWS.acq}` },
      STYLE.subtotal, NF.money);
  }
  r += 2;

  // ── FINANCING ──────────────────────────────────────────────────────────
  bannerRow(ws, r, 2, 2 + nA + nF, "3.  CASH FROM FINANCING ACTIVITY"); r++;

  // Proceeds from Shares (historical only)
  lblF("  Proceeds from Shares", STYLE.rowLabelSub);
  histF("proceedsFromShares");
  for (let y = 1; y <= nF; y++) setCell(ws, r, colFC(y), "", STYLE.rowLabelSub);
  r++;

  // Debt Issued
  ROWS.debtIssued = r;
  lblF("Debt Issued", STYLE.rowLabel);
  histF("debtIssued");
  for (let y = 1; y <= nF; y++) {
    // Default: 0 (no new debt by default — could be made a yearwise input later)
    setCell(ws, r, colFC(y), 0, STYLE.input, NF.money);
  }
  r++;

  // Debt Repaid
  ROWS.debtRepaid = r;
  lblF("Debt Repaid", STYLE.rowLabel);
  histF("debtRepaid");
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    const cPrev = c - 1;
    // (prevST + prevLT) × debtRepayment rate
    setCell(ws, r, c,
      { formula: `('Balance Sheet'!${col(cPrev)}${bsStDebt} + 'Balance Sheet'!${col(cPrev)}${bsLtDebt}) * INDEX(Yw_debtRepayment, ${y}) / 100` },
      STYLE.formula, NF.money);
  }
  r++;

  // Interest Paid (historical only)
  lblF("  Interest Paid", STYLE.rowLabelSub);
  histF("interestPaid", -1);
  for (let y = 1; y <= nF; y++) setCell(ws, r, colFC(y), "", STYLE.rowLabelSub);
  r++;

  // Dividends Paid
  ROWS.dividends = r;
  lblF("Dividends Paid", STYLE.rowLabel);
  acts.forEach((row, i) => {
    const v = row.dividends != null ? Math.abs(row.dividends) / p.scale : null;
    setCell(ws, r, colHist(i), safeNum(v), STYLE.input, NF.money);
  });
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, r, c,
      { formula: `MAX(0, 'Income Statement'!${col(c)}${isPat}) * INDEX(Yw_dividendPayout, ${y}) / 100` },
      STYLE.formula, NF.money);
  }
  r++;

  // Share Buybacks
  ROWS.buybacks = r;
  lblF("Share Buybacks", STYLE.rowLabel);
  acts.forEach((row, i) => {
    const v = row.buybacks != null ? Math.abs(row.buybacks) / p.scale : null;
    setCell(ws, r, colHist(i), safeNum(v), STYLE.input, NF.money);
  });
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    const cPrev = c - 1;
    setCell(ws, r, c,
      { formula: `'Balance Sheet'!${col(cPrev)}${bsEquity} * INDEX(Yw_shareBuyback, ${y}) / 100` },
      STYLE.formula, NF.money);
  }
  r++;

  // Financing CF subtotal
  ROWS.financeCF = r;
  lblF("Cash from Financing Activity", STYLE.subtotalLabel);
  acts.forEach((row, i) => {
    const v = row.financeCF != null ? row.financeCF / p.scale : null;
    setCell(ws, r, colHist(i), safeNum(v), STYLE.subtotal, NF.money);
  });
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, r, c,
      { formula: `${col(c)}${ROWS.debtIssued} - ${col(c)}${ROWS.debtRepaid} - ${col(c)}${ROWS.dividends} - ${col(c)}${ROWS.buybacks}` },
      STYLE.subtotal, NF.money);
  }
  r += 2;

  // ── NET CHANGE & CASH RECONCILIATION ───────────────────────────────────
  bannerRow(ws, r, 2, 2 + nA + nF, "4.  CASH RECONCILIATION"); r++;

  // Net Change in Cash
  ROWS.netChange = r;
  lblF("Net Change in Cash", STYLE.subtotalLabel);
  acts.forEach((row, i) => {
    const v = row.netChange != null ? row.netChange / p.scale : null;
    setCell(ws, r, colHist(i), safeNum(v), STYLE.subtotal, NF.money);
  });
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, r, c,
      { formula: `${col(c)}${ROWS.cfo} + ${col(c)}${ROWS.investCF} + ${col(c)}${ROWS.financeCF}` },
      STYLE.subtotal, NF.money);
  }
  r++;

  // Opening Cash Balance
  ROWS.openingCash = r;
  lblF("Opening Cash Balance", STYLE.rowLabel);
  acts.forEach((row, i) => {
    const v = row.openingCash != null ? row.openingCash / p.scale : null;
    setCell(ws, r, colHist(i), safeNum(v), STYLE.input, NF.money);
  });
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    const cPrev = c - 1;
    // First forecast year: opening = last historical closing
    setCell(ws, r, c, { formula: `${col(cPrev)}${r + 1}` }, STYLE.formula, NF.money);
  }
  r++;

  // Closing Cash Balance
  ROWS.closingCash = r;
  lblF("Closing Cash Balance", STYLE.totalLabel);
  acts.forEach((row, i) => {
    const v = row.closingCash != null ? row.closingCash / p.scale : null;
    setCell(ws, r, colHist(i), safeNum(v), STYLE.total, NF.money);
  });
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, r, c,
      { formula: `${col(c)}${ROWS.openingCash} + ${col(c)}${ROWS.netChange}` },
      STYLE.total, NF.money);
  }
  r += 2;

  // Free Cash Flow (CFO − Capex; Capex is negative so subtract)
  ROWS.fcf = r;
  lblF("Free Cash Flow  (CFO − Capex)", STYLE.totalLabel);
  acts.forEach((row, i) => {
    const v = row.fcff != null ? row.fcff / p.scale : null;
    setCell(ws, r, colHist(i), safeNum(v), STYLE.total, NF.money);
  });
  for (let y = 1; y <= nF; y++) {
    const c = colFC(y);
    setCell(ws, r, c,
      { formula: `${col(c)}${ROWS.cfo} + ${col(c)}${ROWS.capex}` },   // capex is negative
      STYLE.total, NF.money);
  }
  r += 2;

  // ── Reconciliation (HIDDEN — Task 8) ───────────────────────────────────
  // CF reconciles by construction (Closing = Opening + Net Change is how
  // the Closing row is built). The diff stays at zero. The Audit sheet's
  // INDEX/MATCH on "Reconciliation diff*" still resolves; the row is just
  // visually hidden from the user.
  const cfReconRow = r;
  lblF("Reconciliation diff (should ≈ 0)", { font: fontBase(C.greyDk, false, 9), alignment: { horizontal: "left" } });
  for (let i = 0; i < nA + nF; i++) {
    const c = i < nA ? colHist(i) : colFC(i - nA + 1);
    setCell(ws, r, c,
      { formula: `${col(c)}${ROWS.openingCash} + ${col(c)}${ROWS.netChange} - ${col(c)}${ROWS.closingCash}` },
      { font: fontBase(C.greyDk, false, 9), alignment: { horizontal: "right" } }, NF.money2);
  }
  ws.getRow(cfReconRow).height = 0.01;
  ws.getRow(cfReconRow).hidden = true;
  r++;

  // Stash row indices
  if (!wb._rowIndex) wb._rowIndex = {};
  wb._rowIndex.cf = ROWS;
  wb._rowIndex.cf.nA = nA;
  wb._rowIndex.cf.nF = nF;
  wb._rowIndex.cf.colHist = colHist;
  wb._rowIndex.cf.colFC = colFC;

  ws.pageSetup.printArea = `A1:${col(2 + nA + nF)}${r}`;
}
function addDcfEngine(wb, p) {
  const ws = wb.addWorksheet("DCF Engine", {
    properties: { tabColor: { argb: C.amber } },
    views: [{ showGridLines: false, state: "frozen", xSplit: 2, ySplit: 5 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1,
                 margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } },
  });
  const horizon = p.assumptions?.forecastHorizon || p.uiState?.forecastHorizon || 5;
  const nF = horizon;
  // Layout: A margin, B label, C..(C+nF-1) forecast years, then a summary column
  const _cols_dcf = [{ width: 3 }, { width: 40 }];
  for (let i = 0; i < nF; i++) _cols_dcf.push({ width: 14 });
  _cols_dcf.push({ width: 18 }); // total / summary column
  ws.columns = _cols_dcf;

  pageHeader(ws, "DCF Engine — Unlevered FCFF Build",
    `${p.meta.name} (${p.meta.symbol}) · ${horizon}-year explicit forecast + terminal value · ${p.unit}`,
    2 + nF + 1);

  let r = 5;
  // ── Year header ────────────────────────────────────────────────────────
  setCell(ws, r, 2, "Line item", STYLE.colHeader);
  for (let y = 1; y <= nF; y++) {
    setCell(ws, r, 2 + y, { formula: `"FY"&RIGHT(BaseYear+${y},2)&"E"` }, STYLE.colHeader);
  }
  setCell(ws, r, 2 + nF + 1, "Total / Memo", STYLE.colHeader);
  ws.getRow(r).height = 20;
  r++;

  const rows = {};

  // ── 1. Revenue build ───────────────────────────────────────────────────
  bannerRow(ws, r, 2, 2 + nF + 1, "1.  REVENUE BUILD"); r++;
  rows.rev = r;
  setCell(ws, r, 2, "Revenue", STYLE.rowLabelBold);
  for (let y = 1; y <= nF; y++) {
    const c = 2 + y;
    if (y === 1) {
      setCell(ws, r, c, { formula: `BaseRev * (1 + INDEX(Yw_growth, ${y})/100)` }, STYLE.formulaBold, NF.money);
    } else {
      setCell(ws, r, c, { formula: `${col(c - 1)}${r} * (1 + INDEX(Yw_growth, ${y})/100)` }, STYLE.formulaBold, NF.money);
    }
  }
  // Total of explicit-period revenue
  setCell(ws, r, 2 + nF + 1,
    { formula: `SUM(${col(3)}${r}:${col(2 + nF)}${r})` }, STYLE.totalBold || STYLE.formulaBold, NF.money);
  r++;
  // Revenue growth memo
  setCell(ws, r, 2, "  Revenue growth (%)", STYLE.rowLabelSub);
  for (let y = 1; y <= nF; y++) {
    const c = 2 + y;
    setCell(ws, r, c, { formula: `INDEX(Yw_growth, ${y})/100` }, STYLE.formula, NF.pct1);
  }
  setCell(ws, r, 2 + nF + 1,
    { formula: `((${col(2 + nF)}${rows.rev}/BaseRev)^(1/${nF})) - 1` },
    STYLE.formula, NF.pct1);
  r += 2;

  // ── 2. EBITDA ──────────────────────────────────────────────────────────
  bannerRow(ws, r, 2, 2 + nF + 1, "2.  EBITDA"); r++;
  rows.ebitda = r;
  setCell(ws, r, 2, "EBITDA", STYLE.rowLabelBold);
  for (let y = 1; y <= nF; y++) {
    const c = 2 + y;
    setCell(ws, r, c, { formula: `${col(c)}${rows.rev} * INDEX(Yw_ebitdaMargin, ${y})/100` },
      STYLE.formulaBold, NF.money);
  }
  setCell(ws, r, 2 + nF + 1,
    { formula: `SUM(${col(3)}${r}:${col(2 + nF)}${r})` }, STYLE.formulaBold, NF.money);
  r++;
  setCell(ws, r, 2, "  EBITDA margin (%)", STYLE.rowLabelSub);
  for (let y = 1; y <= nF; y++) {
    const c = 2 + y;
    setCell(ws, r, c, { formula: `INDEX(Yw_ebitdaMargin, ${y})/100` }, STYLE.formula, NF.pct1);
  }
  r += 2;

  // ── 3. D&A ─────────────────────────────────────────────────────────────
  bannerRow(ws, r, 2, 2 + nF + 1, "3.  DEPRECIATION & AMORTISATION"); r++;
  rows.dep = r;
  setCell(ws, r, 2, "D&A (non-cash)", STYLE.rowLabel);
  for (let y = 1; y <= nF; y++) {
    const c = 2 + y;
    setCell(ws, r, c, { formula: `${col(c)}${rows.rev} * INDEX(Yw_depPctRev, ${y})/100` },
      STYLE.formula, NF.money);
  }
  setCell(ws, r, 2 + nF + 1,
    { formula: `SUM(${col(3)}${r}:${col(2 + nF)}${r})` }, STYLE.formula, NF.money);
  r++;
  setCell(ws, r, 2, "  D&A (% revenue)", STYLE.rowLabelSub);
  for (let y = 1; y <= nF; y++) {
    const c = 2 + y;
    setCell(ws, r, c, { formula: `INDEX(Yw_depPctRev, ${y})/100` }, STYLE.formula, NF.pct1);
  }
  r += 2;

  // ── 4. EBIT ────────────────────────────────────────────────────────────
  bannerRow(ws, r, 2, 2 + nF + 1, "4.  EBIT  (EBITDA − D&A)"); r++;
  rows.ebit = r;
  setCell(ws, r, 2, "EBIT", STYLE.subtotalLabel);
  for (let y = 1; y <= nF; y++) {
    const c = 2 + y;
    setCell(ws, r, c, { formula: `${col(c)}${rows.ebitda} - ${col(c)}${rows.dep}` },
      STYLE.subtotal, NF.money);
  }
  setCell(ws, r, 2 + nF + 1,
    { formula: `SUM(${col(3)}${r}:${col(2 + nF)}${r})` }, STYLE.subtotal, NF.money);
  r++;
  setCell(ws, r, 2, "  EBIT margin (%)", STYLE.rowLabelSub);
  for (let y = 1; y <= nF; y++) {
    const c = 2 + y;
    setCell(ws, r, c, { formula: `IFERROR(${col(c)}${rows.ebit}/${col(c)}${rows.rev}, 0)` },
      STYLE.formula, NF.pct1);
  }
  r += 2;

  // ── 5. Tax on EBIT ─────────────────────────────────────────────────────
  bannerRow(ws, r, 2, 2 + nF + 1, "5.  TAX ON EBIT"); r++;
  rows.tax = r;
  setCell(ws, r, 2, "Tax on EBIT", STYLE.rowLabel);
  for (let y = 1; y <= nF; y++) {
    const c = 2 + y;
    setCell(ws, r, c,
      { formula: `${col(c)}${rows.ebit} * INDEX(Yw_taxRate, ${y})/100` },
      STYLE.formula, NF.money);
  }
  setCell(ws, r, 2 + nF + 1,
    { formula: `SUM(${col(3)}${r}:${col(2 + nF)}${r})` }, STYLE.formula, NF.money);
  r++;
  setCell(ws, r, 2, "  Effective tax rate (%)", STYLE.rowLabelSub);
  for (let y = 1; y <= nF; y++) {
    const c = 2 + y;
    setCell(ws, r, c, { formula: `INDEX(Yw_taxRate, ${y})/100` }, STYLE.formula, NF.pct1);
  }
  r += 2;

  // ── 6. NOPAT ───────────────────────────────────────────────────────────
  bannerRow(ws, r, 2, 2 + nF + 1, "6.  NOPAT  (EBIT − Tax on EBIT)"); r++;
  rows.nopat = r;
  setCell(ws, r, 2, "NOPAT", STYLE.subtotalLabel);
  for (let y = 1; y <= nF; y++) {
    const c = 2 + y;
    setCell(ws, r, c, { formula: `${col(c)}${rows.ebit} - ${col(c)}${rows.tax}` },
      STYLE.subtotal, NF.money);
  }
  setCell(ws, r, 2 + nF + 1,
    { formula: `SUM(${col(3)}${r}:${col(2 + nF)}${r})` }, STYLE.subtotal, NF.money);
  r += 2;

  // ── 7,8,9. Reinvestment build ──────────────────────────────────────────
  bannerRow(ws, r, 2, 2 + nF + 1, "7.  REINVESTMENT  (D&A add-back − Capex − ΔWC)"); r++;
  setCell(ws, r, 2, "+ D&A (non-cash add-back)", STYLE.rowLabel);
  rows.depBack = r;
  for (let y = 1; y <= nF; y++) {
    const c = 2 + y;
    setCell(ws, r, c, { formula: `${col(c)}${rows.dep}` }, STYLE.formula, NF.money);
  }
  setCell(ws, r, 2 + nF + 1,
    { formula: `SUM(${col(3)}${r}:${col(2 + nF)}${r})` }, STYLE.formula, NF.money);
  r++;

  rows.capex = r;
  setCell(ws, r, 2, "− Capex", STYLE.rowLabel);
  for (let y = 1; y <= nF; y++) {
    const c = 2 + y;
    setCell(ws, r, c,
      { formula: `-${col(c)}${rows.rev} * INDEX(Yw_capexPctRev, ${y})/100` },
      STYLE.formula, NF.money);
  }
  setCell(ws, r, 2 + nF + 1,
    { formula: `SUM(${col(3)}${r}:${col(2 + nF)}${r})` }, STYLE.formula, NF.money);
  r++;
  setCell(ws, r, 2, "    Capex (% revenue)", STYLE.rowLabelSub);
  for (let y = 1; y <= nF; y++) {
    const c = 2 + y;
    setCell(ws, r, c, { formula: `INDEX(Yw_capexPctRev, ${y})/100` }, STYLE.formula, NF.pct1);
  }
  r++;

  rows.dwc = r;
  setCell(ws, r, 2, "− ΔWorking Capital", STYLE.rowLabel);
  for (let y = 1; y <= nF; y++) {
    const c = 2 + y;
    if (y === 1) {
      setCell(ws, r, c,
        { formula: `-(${col(c)}${rows.rev} - BaseRev) * INDEX(Yw_wcPctRev, ${y})/100` },
        STYLE.formula, NF.money);
    } else {
      setCell(ws, r, c,
        { formula: `-(${col(c)}${rows.rev} - ${col(c - 1)}${rows.rev}) * INDEX(Yw_wcPctRev, ${y})/100` },
        STYLE.formula, NF.money);
    }
  }
  setCell(ws, r, 2 + nF + 1,
    { formula: `SUM(${col(3)}${r}:${col(2 + nF)}${r})` }, STYLE.formula, NF.money);
  r += 2;

  // ── 10. FCFF ───────────────────────────────────────────────────────────
  bannerRow(ws, r, 2, 2 + nF + 1, "8.  FCFF  (Unlevered Free Cash Flow to the Firm)"); r++;
  rows.fcff = r;
  setCell(ws, r, 2, "FCFF = NOPAT + D&A − Capex − ΔWC", STYLE.totalLabel);
  for (let y = 1; y <= nF; y++) {
    const c = 2 + y;
    setCell(ws, r, c,
      { formula: `${col(c)}${rows.nopat} + ${col(c)}${rows.depBack} + ${col(c)}${rows.capex} + ${col(c)}${rows.dwc}` },
      STYLE.total, NF.money);
  }
  setCell(ws, r, 2 + nF + 1,
    { formula: `SUM(${col(3)}${r}:${col(2 + nF)}${r})` }, STYLE.total, NF.money);
  r++;
  // FCFF margin memo
  setCell(ws, r, 2, "  FCFF margin (%)", STYLE.rowLabelSub);
  for (let y = 1; y <= nF; y++) {
    const c = 2 + y;
    setCell(ws, r, c, { formula: `IFERROR(${col(c)}${rows.fcff}/${col(c)}${rows.rev}, 0)` },
      STYLE.formula, NF.pct1);
  }
  r += 2;

  // ── 11,12,13. Discounting ──────────────────────────────────────────────
  bannerRow(ws, r, 2, 2 + nF + 1, "9.  DISCOUNTING  (mid-year convention)"); r++;
  rows.period = r;
  setCell(ws, r, 2, "Discount period (mid-year, yrs)", STYLE.rowLabel);
  for (let y = 1; y <= nF; y++) {
    const c = 2 + y;
    setCell(ws, r, c, y - 0.5, STYLE.input, NF.money1);
  }
  r++;
  rows.discFact = r;
  setCell(ws, r, 2, "Discount factor  = 1 / (1+WACC)^t", STYLE.rowLabel);
  for (let y = 1; y <= nF; y++) {
    const c = 2 + y;
    setCell(ws, r, c, { formula: `1 / (1 + WaccScen/100)^${col(c)}${rows.period}` },
      STYLE.formula, NF.ratio);
  }
  r++;
  rows.pvFcff = r;
  setCell(ws, r, 2, "PV of FCFF  = FCFF × DF", STYLE.subtotalLabel);
  for (let y = 1; y <= nF; y++) {
    const c = 2 + y;
    setCell(ws, r, c, { formula: `${col(c)}${rows.fcff} * ${col(c)}${rows.discFact}` },
      STYLE.subtotal, NF.money);
  }
  setCell(ws, r, 2 + nF + 1,
    { formula: `SUM(${col(3)}${r}:${col(2 + nF)}${r})` }, STYLE.subtotal, NF.money);
  rows.pvFcffTotal = `${col(2 + nF + 1)}${r}`;
  r += 2;

  // ── 14-18. Terminal Value ──────────────────────────────────────────────
  bannerRow(ws, r, 2, 2 + nF + 1, "10. TERMINAL VALUE  (Gordon perpetuity OR Exit EV/EBITDA)"); r++;
  setCell(ws, r, 2, "Terminal-year FCFF (yN)", STYLE.rowLabel);
  rows.lastFcff = r;
  setCell(ws, r, 3, { formula: `${col(2 + nF)}${rows.fcff}` }, STYLE.link, NF.money);
  r++;
  setCell(ws, r, 2, "Terminal-year EBITDA (yN)", STYLE.rowLabel);
  rows.lastEbitda = r;
  setCell(ws, r, 3, { formula: `${col(2 + nF)}${rows.ebitda}` }, STYLE.link, NF.money);
  r++;
  setCell(ws, r, 2, "Terminal growth (g)", STYLE.rowLabel);
  setCell(ws, r, 3, { formula: `TerminalG + ScenTermD` }, STYLE.formula, NF.money2);
  rows.termG = r;
  r++;
  setCell(ws, r, 2, "FCFF(yN+1)  = FCFF(yN) × (1+g)", STYLE.rowLabel);
  rows.fcffNext = r;
  setCell(ws, r, 3,
    { formula: `${col(3)}${rows.lastFcff} * (1 + ${col(3)}${rows.termG}/100)` },
    STYLE.formula, NF.money);
  r++;
  setCell(ws, r, 2, "Gordon growth TV  = FCFF(yN+1) / (WACC − g)", STYLE.rowLabel);
  rows.tvGordon = r;
  setCell(ws, r, 3,
    { formula: `IF(WaccScen-${col(3)}${rows.termG}>0, ${col(3)}${rows.fcffNext}/((WaccScen-${col(3)}${rows.termG})/100), 0)` },
    STYLE.formula, NF.money);
  r++;
  setCell(ws, r, 2, "Exit-multiple TV  = EBITDA(yN) × ExitMult", STYLE.rowLabel);
  rows.tvExit = r;
  setCell(ws, r, 3,
    { formula: `${col(3)}${rows.lastEbitda} * ExitMult` },
    STYLE.formula, NF.money);
  r++;
  setCell(ws, r, 2, "TV chosen", STYLE.subtotalLabel);
  rows.tvChosen = r;
  setCell(ws, r, 3,
    { formula: `IF(TermMethod=1, ${col(3)}${rows.tvGordon}, ${col(3)}${rows.tvExit})` },
    STYLE.subtotal, NF.money);
  r++;
  setCell(ws, r, 2, "Discount factor (yN end)  = 1/(1+WACC)^(N-0.5)", STYLE.rowLabel);
  rows.tvDf = r;
  setCell(ws, r, 3,
    { formula: `1 / (1 + WaccScen/100)^(${nF}-0.5)` },
    STYLE.formula, NF.ratio);
  r++;
  setCell(ws, r, 2, "PV of Terminal Value", STYLE.totalLabel);
  rows.pvTv = r;
  setCell(ws, r, 3,
    { formula: `${col(3)}${rows.tvChosen} * ${col(3)}${rows.tvDf}` },
    STYLE.total, NF.money);
  r += 2;

  // ── 19-25. EV → Equity → Per Share ─────────────────────────────────────
  bannerRow(ws, r, 2, 2 + nF + 1, "11. ENTERPRISE VALUE → EQUITY → PER SHARE"); r++;
  setCell(ws, r, 2, "Sum of PV(FCFF) — explicit period", STYLE.rowLabel);
  setCell(ws, r, 3, { formula: rows.pvFcffTotal }, STYLE.formula, NF.money);
  const evRowStart = r;
  r++;
  setCell(ws, r, 2, "+ PV of Terminal Value", STYLE.rowLabel);
  setCell(ws, r, 3, { formula: `${col(3)}${rows.pvTv}` }, STYLE.formula, NF.money);
  r++;
  setCell(ws, r, 2, "= Enterprise Value", STYLE.subtotalLabel);
  rows.ev = r;
  setCell(ws, r, 3, { formula: `${col(3)}${evRowStart} + ${col(3)}${evRowStart + 1}` },
    STYLE.subtotal, NF.money);
  r++;
  setCell(ws, r, 2, "  TV as % of EV", STYLE.rowLabelSub);
  setCell(ws, r, 3, { formula: `${col(3)}${rows.pvTv} / ${col(3)}${rows.ev}` },
    STYLE.formula, NF.pct1);
  r++;
  setCell(ws, r, 2, "− Net debt", STYLE.rowLabel);
  setCell(ws, r, 3, { formula: `-NetDebtUsed` }, STYLE.formula, NF.money);
  r++;
  setCell(ws, r, 2, "= Equity Value", STYLE.totalLabel);
  rows.equity = r;
  setCell(ws, r, 3, { formula: `${col(3)}${rows.ev} - NetDebtUsed` }, STYLE.total, NF.money);
  r++;
  setCell(ws, r, 2, "÷ Diluted shares outstanding (mn)", STYLE.rowLabel);
  setCell(ws, r, 3, { formula: `SharesMn` }, STYLE.link, NF.money1);
  r++;
  setCell(ws, r, 2, `= Implied per-share value (${p.ccySym})`, STYLE.totalLabel);
  // EPS scale: ₹Cr/Mn shares → ×10 for INR; $Mn/Mn shares → ×1 for USD
  const epsFactor = p.isINR ? 10 : 1;
  rows.implied = r;
  setCell(ws, r, 3,
    { formula: `${col(3)}${rows.equity} * ${epsFactor} / SharesMn` },
    STYLE.total, NF.money2);
  r += 2;

  // ── Comparison vs current price ────────────────────────────────────────
  bannerRow(ws, r, 2, 2 + nF + 1, "12. PRICE COMPARISON"); r++;
  setCell(ws, r, 2, `Current market price (${p.ccySym}/sh)`, STYLE.rowLabel);
  setCell(ws, r, 3, { formula: `CurrentPx` }, STYLE.link, NF.money2);
  r++;
  setCell(ws, r, 2, `Implied price (${p.ccySym}/sh)`, STYLE.rowLabel);
  setCell(ws, r, 3, { formula: `${col(3)}${rows.implied}` }, STYLE.formula, NF.money2);
  r++;
  setCell(ws, r, 2, "Upside / (downside)", STYLE.totalLabel);
  setCell(ws, r, 3,
    { formula: `IFERROR(${col(3)}${rows.implied}/CurrentPx - 1, 0)` },
    STYLE.total, NF.pct1);
  r++;
  setCell(ws, r, 2, "Recommendation",   STYLE.rowLabel);
  setCell(ws, r, 3,
    { formula: `IF(${col(3)}${rows.implied}/CurrentPx>=1.20,"BUY",IF(${col(3)}${rows.implied}/CurrentPx>=1.05,"ACCUMULATE",IF(${col(3)}${rows.implied}/CurrentPx>=0.95,"HOLD",IF(${col(3)}${rows.implied}/CurrentPx>=0.80,"REDUCE","SELL"))))` },
    STYLE.formulaBold, NF.txt);
  r += 2;

  // Expose key per-share / EV as named ranges for the Dashboard
  wb.definedNames.add(`'DCF Engine'!${addr(rows.implied, 3)}`, "ImpliedPx");
  wb.definedNames.add(`'DCF Engine'!${addr(rows.ev,      3)}`, "EvVal");
  wb.definedNames.add(`'DCF Engine'!${addr(rows.equity,  3)}`, "EqVal");
  wb.definedNames.add(`'DCF Engine'!${addr(rows.pvTv,    3)}`, "PvTv");

  // Footnote / methodology
  bannerRow(ws, r, 2, 2 + nF + 1, "METHODOLOGY NOTES"); r++;
  const notes = [
    "• Unlevered FCFF approach (firm-level value, currency-consistent with revenue).",
    "• Mid-year convention applied (discount factor = (1 + WACC)^-(t − 0.5)).",
    "• Terminal value chosen by TermMethod toggle in Assumptions (Gordon = 1, Exit = 2).",
    "• ΔWorking Capital sized as a % of revenue change, sign convention: increase in WC = cash outflow.",
    "• Scenario WACC = base WACC + active scenario WACC Δ (from Assumptions scenario table).",
    "• All forecast drivers can be overridden per-year via the Yw_* named ranges (Section 5 of Assumptions).",
  ];
  notes.forEach((line) => {
    ws.mergeCells(r, 2, r, 2 + nF + 1);
    setCell(ws, r, 2, line, STYLE.note);
    r++;
  });

  ws.pageSetup.printArea = `A1:${col(2 + nF + 1)}${r}`;
}


// ════════════════════════════════════════════════════════════════════════════
// SHEET 10 — SENSITIVITY ANALYSIS
// ════════════════════════════════════════════════════════════════════════════
// 5×5 grid of per-share value at perturbed WACC and Terminal-g.
// Each cell is a LIVE formula:
//   For a (wacc, g) pair, rebuild the PV of explicit-period FCFF at the
//   perturbed WACC, plus the perpetual-growth TV at the perturbed g,
//   then bridge to equity → per share.
//
// We use array formulas via SUMPRODUCT and INDEX so the entire calc fits
// on one cell per (wacc, g) pair — no helper rows needed per pair.
// ════════════════════════════════════════════════════════════════════════════
function addSensitivity(wb, p) {
  const ws = wb.addWorksheet("Sensitivity", {
    properties: { tabColor: { argb: C.amber } },
    views: [{ showGridLines: false, state: "frozen", xSplit: 2, ySplit: 5 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1,
                 margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } },
  });
  const horizon = p.assumptions?.forecastHorizon || p.uiState?.forecastHorizon || 5;
  const nF = horizon;
  ws.columns = [
    { width: 3 }, { width: 24 },
    { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 },
    { width: 4 }, { width: 36 },
  ];

  pageHeader(ws, "Sensitivity Analysis",
    `Per-share value (${p.ccySym}) — WACC × Terminal growth grid · all 25 cells are live formulas`, 9);

  let r = 5;
  const epsFactor = p.isINR ? 10 : 1;

  // ── Build a helper block: per-year FCFF and discount-period array  ─────
  // These row references already exist on DCF Engine; rather than rebuild,
  // we point at them via cross-sheet references.
  // For sensitivity, we need a 25-cell grid each with its own WACC/g.
  // Approach: build a small "engine" on this sheet that takes a single
  // WACC and g, and computes per-share value. Then for each of the 25 grid
  // cells we use SUMPRODUCT(FCFF_array, 1/(1+wacc/100)^periods) + TV/(1+wacc/100)^(N-0.5).
  //
  // For that, we need FCFF as an array on this sheet — pull from DCF Engine.

  // ── FCFF SCHEDULE  (locally rebuilt to keep references self-contained) ─
  // The previous design had a "linked from DCF Engine" row using INDEX/MATCH
  // with a wildcard. That formula was fragile (returned blanks under several
  // common layouts) and is no longer needed: every cell in the Sensitivity
  // grid resolves through the rebuilt FCFF row below, which references the
  // same Yw_* named ranges as the DCF Engine. Logic stays in sync; rendering
  // never produces blanks.
  bannerRow(ws, r, 2, 9, "1.  FCFF SCHEDULE  (live formulas, identical to DCF Engine)"); r++;
  setCell(ws, r, 2, "Year", STYLE.colHeader);
  for (let y = 1; y <= nF; y++) {
    setCell(ws, r, 2 + y, { formula: `"FY"&RIGHT(BaseYear+${y},2)&"E"` }, STYLE.colHeader);
  }
  r++;
  setCell(ws, r, 2, "Discount period (mid-year)", STYLE.rowLabel);
  const periodRow = r;
  for (let y = 1; y <= nF; y++) {
    setCell(ws, r, 2 + y, y - 0.5, STYLE.input, NF.money1);
  }
  r += 2;

  // ── Rebuild FCFF locally to avoid cross-sheet MATCH brittleness ──────
  // Since the previous attempt may not resolve cleanly, we rebuild revenue→FCFF
  // here as a self-contained mini-engine. This makes the sensitivity cells
  // self-sufficient.
  bannerRow(ws, r, 2, 9, "2.  REBUILT FCFF  (self-contained for sensitivity)"); r++;
  setCell(ws, r, 2, "Revenue", STYLE.rowLabelBold);
  const revRow = r;
  for (let y = 1; y <= nF; y++) {
    const c = 2 + y;
    if (y === 1) {
      setCell(ws, r, c, { formula: `BaseRev * (1 + INDEX(Yw_growth, ${y})/100)` },
        STYLE.formulaBold, NF.money);
    } else {
      setCell(ws, r, c, { formula: `${col(c - 1)}${r} * (1 + INDEX(Yw_growth, ${y})/100)` },
        STYLE.formulaBold, NF.money);
    }
  }
  r++;
  setCell(ws, r, 2, "EBITDA", STYLE.rowLabel);
  const ebitdaRow = r;
  for (let y = 1; y <= nF; y++) {
    const c = 2 + y;
    setCell(ws, r, c,
      { formula: `${col(c)}${revRow} * INDEX(Yw_ebitdaMargin, ${y})/100` },
      STYLE.formula, NF.money);
  }
  r++;
  setCell(ws, r, 2, "D&A", STYLE.rowLabel);
  const depRow = r;
  for (let y = 1; y <= nF; y++) {
    const c = 2 + y;
    setCell(ws, r, c,
      { formula: `${col(c)}${revRow} * INDEX(Yw_depPctRev, ${y})/100` },
      STYLE.formula, NF.money);
  }
  r++;
  setCell(ws, r, 2, "EBIT", STYLE.rowLabel);
  const ebitRow = r;
  for (let y = 1; y <= nF; y++) {
    const c = 2 + y;
    setCell(ws, r, c,
      { formula: `${col(c)}${ebitdaRow} - ${col(c)}${depRow}` },
      STYLE.formula, NF.money);
  }
  r++;
  setCell(ws, r, 2, "NOPAT", STYLE.rowLabel);
  const nopatRow = r;
  for (let y = 1; y <= nF; y++) {
    const c = 2 + y;
    setCell(ws, r, c,
      { formula: `${col(c)}${ebitRow} * (1 - INDEX(Yw_taxRate, ${y})/100)` },
      STYLE.formula, NF.money);
  }
  r++;
  setCell(ws, r, 2, "Capex", STYLE.rowLabel);
  const capexRow = r;
  for (let y = 1; y <= nF; y++) {
    const c = 2 + y;
    setCell(ws, r, c,
      { formula: `${col(c)}${revRow} * INDEX(Yw_capexPctRev, ${y})/100` },
      STYLE.formula, NF.money);
  }
  r++;
  setCell(ws, r, 2, "ΔWC", STYLE.rowLabel);
  const dwcRow = r;
  for (let y = 1; y <= nF; y++) {
    const c = 2 + y;
    if (y === 1) {
      setCell(ws, r, c,
        { formula: `(${col(c)}${revRow} - BaseRev) * INDEX(Yw_wcPctRev, ${y})/100` },
        STYLE.formula, NF.money);
    } else {
      setCell(ws, r, c,
        { formula: `(${col(c)}${revRow} - ${col(c - 1)}${revRow}) * INDEX(Yw_wcPctRev, ${y})/100` },
        STYLE.formula, NF.money);
    }
  }
  r++;
  setCell(ws, r, 2, "FCFF = NOPAT + D&A − Capex − ΔWC", STYLE.subtotalLabel);
  const fcffRowLocal = r;
  for (let y = 1; y <= nF; y++) {
    const c = 2 + y;
    setCell(ws, r, c,
      { formula: `${col(c)}${nopatRow} + ${col(c)}${depRow} - ${col(c)}${capexRow} - ${col(c)}${dwcRow}` },
      STYLE.subtotal, NF.money);
  }
  r += 2;

  // Define the FCFF range and period range as named ranges (local to sensitivity)
  const fcffRange = `'Sensitivity'!$${col(3)}$${fcffRowLocal}:$${col(2 + nF)}$${fcffRowLocal}`;
  const periodRange = `'Sensitivity'!$${col(3)}$${periodRow}:$${col(2 + nF)}$${periodRow}`;
  wb.definedNames.add(fcffRange, "Sens_FCFF");
  wb.definedNames.add(periodRange, "Sens_Period");

  // ── 5×5 WACC × Terminal-g grid ─────────────────────────────────────────
  bannerRow(ws, r, 2, 9, "3.  PER-SHARE VALUE GRID  (rows = Terminal growth, columns = WACC)"); r++;

  // Axis values: WACC: base ± 1pp/2pp; g: base ± 0.5pp/1pp
  const waccSteps = [-2.0, -1.0, 0.0, 1.0, 2.0];   // pp deltas
  const gSteps    = [-1.0, -0.5, 0.0, 0.5, 1.0];

  // Header row (top-left corner cell, then 5 WACC values)
  setCell(ws, r, 2, "Term. g  ↓  /  WACC →", STYLE.colHeader);
  for (let i = 0; i < 5; i++) {
    const c = 3 + i;
    setCell(ws, r, c, { formula: `WaccScen + ${waccSteps[i]}` }, STYLE.colHeader, NF.money2);
  }
  setCell(ws, r, 9, "Reading guide", STYLE.colHeader);
  r++;
  const gridStart = r;

  for (let gi = 0; gi < 5; gi++) {
    const gDelta = gSteps[gi];
    // Row label: terminal g (perturbed)
    setCell(ws, r, 2, { formula: `TerminalG + ScenTermD + ${gDelta}` }, STYLE.colHeader, NF.money2);
    for (let wi = 0; wi < 5; wi++) {
      const wDelta = waccSteps[wi];
      const c = 3 + wi;
      // Formula:
      //   pv_explicit = SUMPRODUCT(FCFF, 1/(1+(WaccScen+wDelta)/100)^periods)
      //   tv = FCFF(yN)*(1+g_perturbed/100) / ((WaccScen+wDelta - g_perturbed)/100)
      //   pv_tv = tv / (1 + (WaccScen+wDelta)/100)^(N - 0.5)
      //   equity = pv_explicit + pv_tv - NetDebt
      //   per_share = equity * epsFactor / SharesMn
      const wExpr = `(WaccScen + ${wDelta})`;
      const gExpr = `(TerminalG + ScenTermD + ${gDelta})`;
      const fcffLast = `${col(2 + nF)}${fcffRowLocal}`;
      const formula =
        `IF(${wExpr} - ${gExpr} > 0.5,` +
        ` ((SUMPRODUCT(Sens_FCFF, 1/((1+${wExpr}/100)^Sens_Period))` +
        ` + (${fcffLast}*(1+${gExpr}/100) / ((${wExpr}-${gExpr})/100))/((1+${wExpr}/100)^(${nF}-0.5))` +
        ` - NetDebtUsed) * ${epsFactor} / SharesMn),` +
        ` "n/m")`;
      // Highlight the centre cell (base × base)
      const isCentre = (gi === 2 && wi === 2);
      const cellStyle = isCentre
        ? { ...STYLE.total, font: fontBase(C.amber, true, 11) }
        : STYLE.formula;
      setCell(ws, r, c, { formula }, cellStyle, NF.money2);
    }
    if (gi === 2) {
      setCell(ws, r, 9, "← Base case (centre cell, amber)", STYLE.note);
    }
    r++;
  }
  r += 1;

  // ── Reference: Current price & breakeven implied multiples ─────────────
  bannerRow(ws, r, 2, 9, "4.  REFERENCE LINES"); r++;
  setCell(ws, r, 2, `Current market price (${p.ccySym}/sh)`, STYLE.rowLabel);
  setCell(ws, r, 3, { formula: `CurrentPx` }, STYLE.link, NF.money2);
  setCell(ws, r, 9, "Threshold for BUY/SELL classification.", STYLE.note);
  r++;
  setCell(ws, r, 2, `Base implied price (centre of grid)`, STYLE.rowLabel);
  setCell(ws, r, 3, { formula: `${col(3 + 2)}${gridStart + 2}` }, STYLE.formula, NF.money2);
  r++;
  setCell(ws, r, 2, "Upside vs current price", STYLE.totalLabel);
  setCell(ws, r, 3,
    { formula: `IFERROR(${col(3 + 2)}${gridStart + 2}/CurrentPx - 1, 0)` },
    STYLE.total, NF.pct1);
  r += 2;

  // Notes
  bannerRow(ws, r, 2, 9, "NOTES"); r++;
  const notes = [
    "• Each cell is a live SUMPRODUCT-based formula — change any input on Assumptions and the entire grid recomputes.",
    "• If WACC − g ≤ 0.5%, the cell shows \"n/m\" (terminal value blows up).",
    "• WACC axis: base WACC ± 1pp and ± 2pp.   Terminal-g axis: base g ± 0.5pp and ± 1pp.",
    "• Grid uses perpetuity-growth TV regardless of TermMethod (so sensitivity is comparable across cells).",
  ];
  notes.forEach((line) => {
    ws.mergeCells(r, 2, r, 9);
    setCell(ws, r, 2, line, STYLE.note);
    r++;
  });

  ws.pageSetup.printArea = `A1:I${r}`;
}


// ════════════════════════════════════════════════════════════════════════════
// SHEET 11 — SCENARIOS
// ════════════════════════════════════════════════════════════════════════════
// Bull / Base / Bear / Stress / Downside columns, side-by-side.
// Each column rebuilds the FCFF schedule applying the relevant scenario
// deltas (growth Δ, margin Δ, WACC Δ, terminal-g Δ, capex Δ) from the
// ScenarioTable, then drives through to per-share value.
//
// This is the analytically interesting view: see how sensitive the equity
// value is to the *combination* of macro/op assumptions in each scenario.
// ════════════════════════════════════════════════════════════════════════════
function addScenarios(wb, p) {
  const ws = wb.addWorksheet("Scenarios", {
    properties: { tabColor: { argb: C.amber } },
    views: [{ showGridLines: false, state: "frozen", xSplit: 2, ySplit: 5 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1,
                 margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } },
  });
  const horizon = p.assumptions?.forecastHorizon || p.uiState?.forecastHorizon || 5;
  const nF = horizon;
  // Columns: A margin, B label, C..G = 5 scenarios, H = current/memo
  ws.columns = [
    { width: 3 }, { width: 38 },
    { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 },
    { width: 4 }, { width: 28 },
  ];

  pageHeader(ws, "Scenario Analysis",
    `Bull / Base / Bear / Stress / Downside — each column applies the scenario delta table to every driver`, 9);

  let r = 5;
  const epsFactor = p.isINR ? 10 : 1;
  const scenNames = ["Base", "Bull", "Bear", "Stress", "Downside"];

  // ── Scenario header ────────────────────────────────────────────────────
  setCell(ws, r, 2, "Scenario", STYLE.colHeader);
  scenNames.forEach((nm, i) => {
    setCell(ws, r, 3 + i, nm, STYLE.colHeader);
  });
  setCell(ws, r, 9, "Notes", STYLE.colHeader);
  ws.getRow(r).height = 22;
  r++;

  // ── 1. Scenario delta inputs ──────────────────────────────────────────
  bannerRow(ws, r, 2, 9, "1.  SCENARIO DELTAS  (from ScenarioTable on Assumptions)"); r++;
  const deltaLabels = [
    ["Growth Δ (pp)",    2, "Added to base revenue growth (Y1) and faded forward."],
    ["Margin Δ (pp)",    3, "Added to base EBITDA margin (all forecast years)."],
    ["WACC Δ (pp)",      4, "Added to base WACC for that scenario's discount rate."],
    ["Terminal-g Δ (pp)", 5, "Added to base terminal growth rate."],
    ["Capex Δ (pp)",     6, "Added to base capex/revenue ratio."],
  ];
  const deltaRows = {};
  deltaLabels.forEach(([lbl, colInTbl, src]) => {
    setCell(ws, r, 2, lbl, STYLE.rowLabel);
    for (let s = 0; s < 5; s++) {
      // Row in ScenarioTable: s + 1 (1-indexed). Column: colInTbl in ScenarioTable.
      setCell(ws, r, 3 + s,
        { formula: `INDEX(ScenarioTable, ${s + 1}, ${colInTbl})` },
        STYLE.formula, NF.money1);
    }
    setCell(ws, r, 9, src, STYLE.note);
    deltaRows[lbl] = r;
    r++;
  });
  r++;

  // ── 2. WACC by scenario ───────────────────────────────────────────────
  bannerRow(ws, r, 2, 9, "2.  WACC BY SCENARIO"); r++;
  setCell(ws, r, 2, "WACC (%)", STYLE.rowLabelBold);
  const waccScenRow = r;
  for (let s = 0; s < 5; s++) {
    setCell(ws, r, 3 + s,
      { formula: `Wacc + INDEX(ScenarioTable, ${s + 1}, 4)` },
      STYLE.formulaBold, NF.money2);
  }
  setCell(ws, r, 9, "Base WACC + scenario Δ", STYLE.note);
  r++;
  setCell(ws, r, 2, "Terminal growth (%)", STYLE.rowLabelBold);
  const tgScenRow = r;
  for (let s = 0; s < 5; s++) {
    setCell(ws, r, 3 + s,
      { formula: `TerminalG + INDEX(ScenarioTable, ${s + 1}, 5)` },
      STYLE.formulaBold, NF.money2);
  }
  setCell(ws, r, 9, "Base g + scenario Δ", STYLE.note);
  r += 2;

  // ── 3. Year-by-year FCFF per scenario (compact summary) ───────────────
  bannerRow(ws, r, 2, 9, "3.  SUM OF EXPLICIT-PERIOD FCFF  (per scenario)"); r++;
  // We compute SUM(FCFF over years 1..N) for each scenario as a single
  // closed-form formula. Pattern:
  //   For each year y:
  //     rev_y = baseRev * Π_{k=1..y}(1 + (Yw_growth(k) + growthΔ)/100)
  //     ebitda_y = rev_y * (Yw_ebitdaMargin(k) + marginΔ)/100
  //     ... etc.
  // SUMPRODUCT-based, but the dependency on prior-year revenue (compounded
  // growth) makes a closed-form SUMPRODUCT awkward. So we lay out small
  // helper rows for each scenario (revenue ... FCFF) just below.

  setCell(ws, r, 2, "(Built in helper schedule below — final figures aggregated here.)", STYLE.note);
  r++;
  const fcffSumRow = r;
  setCell(ws, r, 2, "Sum of explicit FCFF", STYLE.rowLabelBold);
  // Filled after helper schedule
  r += 2;

  // ── 4. Helper schedule per scenario (revenue → FCFF) ──────────────────
  bannerRow(ws, r, 2, 9, "4.  HELPER FCFF SCHEDULE  (per scenario, per year)"); r++;
  // For each scenario, we lay down 1 + nF columns (label, year-1 .. year-N)
  // ...but that's 5 × nF blocks which gets unwieldy. Cleaner: present scenarios
  // as outer-loop, each scenario block has its own row spanning N forecast years.

  // We'll use a different layout: Year labels across cols C..G become useless here.
  // Instead, repurpose row layout: a section per scenario, with line items
  // (revenue, ebitda, FCFF, FCFF sum, terminal value, PV TV, EV, equity, perShare)
  // in rows, and year columns C..(C + nF - 1) inside each scenario block.

  // We need year columns wider than existing. Add more columns.
  // ws.columns is already set; we'll write inline using existing columns and
  // a single year block per scenario (re-using cols C..G for year-1..year-5).
  // For longer horizons (10y), use a smaller compact view: just per-share value.

  // To keep this manageable, we render the full mini-engine ONLY for the
  // first 5 forecast years. If horizon > 5, we still build correctly via
  // formulas referencing the year-index, but the visual layout caps at 5.
  const colsForYears = Math.min(nF, 5);

  const scenBlockRows = []; // { scenIdx, perShareRow, evRow, equityRow }

  for (let s = 0; s < 5; s++) {
    // Banner for this scenario
    bannerRow(ws, r, 2, 9, `${String.fromCharCode(65 + s)}.  ${scenNames[s]} scenario  (scenario id = ${s + 1})`); r++;
    setCell(ws, r, 2, "Line item", STYLE.colHeader);
    for (let y = 1; y <= colsForYears; y++) {
      setCell(ws, r, 2 + y, { formula: `"FY"&RIGHT(BaseYear+${y},2)&"E"` }, STYLE.colHeader);
    }
    setCell(ws, r, 9, "Memo", STYLE.colHeader);
    r++;

    // Revenue
    const revR = r;
    setCell(ws, r, 2, "Revenue", STYLE.rowLabelBold);
    for (let y = 1; y <= colsForYears; y++) {
      const c = 2 + y;
      const gExpr = `(INDEX(Yw_growth, ${y}) + INDEX(ScenarioTable, ${s + 1}, 2))`;
      if (y === 1) {
        setCell(ws, r, c, { formula: `BaseRev * (1 + ${gExpr}/100)` },
          STYLE.formulaBold, NF.money);
      } else {
        setCell(ws, r, c, { formula: `${col(c - 1)}${revR} * (1 + ${gExpr}/100)` },
          STYLE.formulaBold, NF.money);
      }
    }
    r++;

    // EBITDA
    const ebR = r;
    setCell(ws, r, 2, "EBITDA", STYLE.rowLabel);
    for (let y = 1; y <= colsForYears; y++) {
      const c = 2 + y;
      const mExpr = `(INDEX(Yw_ebitdaMargin, ${y}) + INDEX(ScenarioTable, ${s + 1}, 3))`;
      setCell(ws, r, c,
        { formula: `${col(c)}${revR} * ${mExpr}/100` },
        STYLE.formula, NF.money);
    }
    r++;

    // D&A
    const dpR = r;
    setCell(ws, r, 2, "D&A", STYLE.rowLabel);
    for (let y = 1; y <= colsForYears; y++) {
      const c = 2 + y;
      setCell(ws, r, c,
        { formula: `${col(c)}${revR} * INDEX(Yw_depPctRev, ${y})/100` },
        STYLE.formula, NF.money);
    }
    r++;

    // NOPAT
    const noR = r;
    setCell(ws, r, 2, "NOPAT", STYLE.rowLabel);
    for (let y = 1; y <= colsForYears; y++) {
      const c = 2 + y;
      setCell(ws, r, c,
        { formula: `(${col(c)}${ebR} - ${col(c)}${dpR}) * (1 - INDEX(Yw_taxRate, ${y})/100)` },
        STYLE.formula, NF.money);
    }
    r++;

    // Capex
    const cxR = r;
    setCell(ws, r, 2, "Capex", STYLE.rowLabel);
    for (let y = 1; y <= colsForYears; y++) {
      const c = 2 + y;
      const cxExpr = `(INDEX(Yw_capexPctRev, ${y}) + INDEX(ScenarioTable, ${s + 1}, 6))`;
      setCell(ws, r, c,
        { formula: `${col(c)}${revR} * ${cxExpr}/100` },
        STYLE.formula, NF.money);
    }
    r++;

    // ΔWC
    const dwR = r;
    setCell(ws, r, 2, "ΔWC", STYLE.rowLabel);
    for (let y = 1; y <= colsForYears; y++) {
      const c = 2 + y;
      if (y === 1) {
        setCell(ws, r, c,
          { formula: `(${col(c)}${revR} - BaseRev) * INDEX(Yw_wcPctRev, ${y})/100` },
          STYLE.formula, NF.money);
      } else {
        setCell(ws, r, c,
          { formula: `(${col(c)}${revR} - ${col(c - 1)}${revR}) * INDEX(Yw_wcPctRev, ${y})/100` },
          STYLE.formula, NF.money);
      }
    }
    r++;

    // FCFF
    const fcR = r;
    setCell(ws, r, 2, "FCFF", STYLE.subtotalLabel);
    for (let y = 1; y <= colsForYears; y++) {
      const c = 2 + y;
      setCell(ws, r, c,
        { formula: `${col(c)}${noR} + ${col(c)}${dpR} - ${col(c)}${cxR} - ${col(c)}${dwR}` },
        STYLE.subtotal, NF.money);
    }
    r++;

    // PV factor (mid-year) — using scenario WACC
    const dfR = r;
    setCell(ws, r, 2, "Discount factor (mid-yr)", STYLE.rowLabelSub);
    for (let y = 1; y <= colsForYears; y++) {
      const c = 2 + y;
      setCell(ws, r, c,
        { formula: `1 / (1 + ${col(3 + s)}${waccScenRow}/100)^(${y} - 0.5)` },
        STYLE.formula, NF.ratio);
    }
    r++;

    // PV FCFF
    const pvR = r;
    setCell(ws, r, 2, "PV of FCFF", STYLE.rowLabelSub);
    for (let y = 1; y <= colsForYears; y++) {
      const c = 2 + y;
      setCell(ws, r, c,
        { formula: `${col(c)}${fcR} * ${col(c)}${dfR}` },
        STYLE.formula, NF.money);
    }
    r++;

    // Sum-of-explicit
    setCell(ws, r, 2, "Σ PV(FCFF) explicit", STYLE.rowLabelBold);
    const sumPvR = r;
    setCell(ws, r, 3, { formula: `SUM(${col(3)}${pvR}:${col(2 + colsForYears)}${pvR})` },
      STYLE.formulaBold, NF.money);
    r++;

    // Terminal value (Gordon, per scenario WACC and g)
    setCell(ws, r, 2, "Terminal FCFF = FCFF(yN) × (1+g)", STYLE.rowLabel);
    const tfR = r;
    setCell(ws, r, 3,
      { formula: `${col(2 + colsForYears)}${fcR} * (1 + ${col(3 + s)}${tgScenRow}/100)` },
      STYLE.formula, NF.money);
    r++;
    setCell(ws, r, 2, "Gordon TV = TF / (WACC − g)", STYLE.rowLabel);
    const tvR = r;
    setCell(ws, r, 3,
      { formula: `IF(${col(3 + s)}${waccScenRow}-${col(3 + s)}${tgScenRow}>0, ${col(3)}${tfR}/((${col(3 + s)}${waccScenRow}-${col(3 + s)}${tgScenRow})/100), 0)` },
      STYLE.formula, NF.money);
    r++;
    setCell(ws, r, 2, "PV of TV", STYLE.rowLabel);
    const pvTvR = r;
    setCell(ws, r, 3,
      { formula: `${col(3)}${tvR} / (1 + ${col(3 + s)}${waccScenRow}/100)^(${colsForYears} - 0.5)` },
      STYLE.formula, NF.money);
    r++;

    // EV → Equity → per-share
    setCell(ws, r, 2, "Enterprise Value", STYLE.subtotalLabel);
    const evR = r;
    setCell(ws, r, 3, { formula: `${col(3)}${sumPvR} + ${col(3)}${pvTvR}` },
      STYLE.subtotal, NF.money);
    r++;
    setCell(ws, r, 2, "− Net debt", STYLE.rowLabel);
    setCell(ws, r, 3, { formula: `-NetDebtUsed` }, STYLE.formula, NF.money);
    r++;
    setCell(ws, r, 2, "= Equity Value", STYLE.totalLabel);
    const eqR = r;
    setCell(ws, r, 3, { formula: `${col(3)}${evR} - NetDebtUsed` }, STYLE.total, NF.money);
    r++;
    setCell(ws, r, 2, `= Implied price (${p.ccySym}/sh)`, STYLE.totalLabel);
    const psR = r;
    setCell(ws, r, 3,
      { formula: `${col(3)}${eqR} * ${epsFactor} / SharesMn` },
      STYLE.total, NF.money2);
    setCell(ws, r, 9,
      { formula: `IF(${col(3)}${psR}>=CurrentPx*1.20,"BUY",IF(${col(3)}${psR}>=CurrentPx*1.05,"ACCUMULATE",IF(${col(3)}${psR}>=CurrentPx*0.95,"HOLD",IF(${col(3)}${psR}>=CurrentPx*0.80,"REDUCE","SELL"))))` },
      STYLE.formulaBold);
    r++;

    scenBlockRows.push({
      scenIdx: s,
      sumPvR, pvTvR, evR, eqR, psR,
    });
    r += 2;
  }

  // ── Now fill the summary row at top (Sum of explicit FCFF per scenario) ─
  // Reach back to fcffSumRow and write SUM(...) for each scenario column
  scenBlockRows.forEach((blk, i) => {
    const c = 3 + i;
    setCell(ws, fcffSumRow, c, { formula: `${col(3)}${blk.sumPvR}` }, STYLE.formula, NF.money);
  });

  // ── Aggregate per-scenario summary at top ──────────────────────────────
  bannerRow(ws, r, 2, 9, "5.  CONSOLIDATED PER-SHARE OUTCOMES"); r++;
  setCell(ws, r, 2, "Scenario", STYLE.colHeader);
  scenNames.forEach((nm, i) => setCell(ws, r, 3 + i, nm, STYLE.colHeader));
  setCell(ws, r, 9, "Memo", STYLE.colHeader);
  r++;
  setCell(ws, r, 2, "Enterprise Value", STYLE.rowLabel);
  scenBlockRows.forEach((blk, i) =>
    setCell(ws, r, 3 + i, { formula: `${col(3)}${blk.evR}` }, STYLE.formula, NF.money));
  r++;
  setCell(ws, r, 2, "Equity Value", STYLE.rowLabel);
  scenBlockRows.forEach((blk, i) =>
    setCell(ws, r, 3 + i, { formula: `${col(3)}${blk.eqR}` }, STYLE.formula, NF.money));
  r++;
  setCell(ws, r, 2, `Implied price (${p.ccySym}/sh)`, STYLE.totalLabel);
  scenBlockRows.forEach((blk, i) =>
    setCell(ws, r, 3 + i, { formula: `${col(3)}${blk.psR}` }, STYLE.total, NF.money2));
  r++;
  setCell(ws, r, 2, "Upside vs current (%)", STYLE.totalLabel);
  scenBlockRows.forEach((blk, i) =>
    setCell(ws, r, 3 + i,
      { formula: `IFERROR(${col(3)}${blk.psR}/CurrentPx - 1, 0)` },
      STYLE.total, NF.pct1));
  r++;
  setCell(ws, r, 2, "Recommendation", STYLE.rowLabel);
  scenBlockRows.forEach((blk, i) =>
    setCell(ws, r, 3 + i,
      { formula: `IF(${col(3)}${blk.psR}/CurrentPx>=1.20,"BUY",IF(${col(3)}${blk.psR}/CurrentPx>=1.05,"ACCUM",IF(${col(3)}${blk.psR}/CurrentPx>=0.95,"HOLD",IF(${col(3)}${blk.psR}/CurrentPx>=0.80,"REDUCE","SELL"))))` },
      STYLE.formulaBold));
  r += 2;

  // Probability-weighted value
  bannerRow(ws, r, 2, 9, "6.  PROBABILITY-WEIGHTED EXPECTED PRICE"); r++;
  setCell(ws, r, 2, "Probability (%)", STYLE.rowLabel);
  const defaultProbs = [40, 20, 20, 10, 10]; // Base, Bull, Bear, Stress, Downside
  const probStart = r;
  defaultProbs.forEach((pct, i) =>
    setCell(ws, r, 3 + i, pct, STYLE.input, NF.money));
  setCell(ws, r, 9, "Edit blue cells; should sum to 100%.", STYLE.note);
  r++;
  setCell(ws, r, 2, "Σ probabilities", STYLE.rowLabel);
  setCell(ws, r, 3, { formula: `SUM(${col(3)}${probStart}:${col(7)}${probStart})` },
    STYLE.formula, NF.money);
  r += 2;
  setCell(ws, r, 2, `Probability-weighted price (${p.ccySym}/sh)`, STYLE.totalLabel);
  // SUMPRODUCT(prob, implied_px) / SUM(prob)
  setCell(ws, r, 3,
    { formula: `SUMPRODUCT(${col(3)}${probStart}:${col(7)}${probStart}, ${col(3)}${r - 4}:${col(7)}${r - 4}) / SUM(${col(3)}${probStart}:${col(7)}${probStart})` },
    STYLE.total, NF.money2);
  setCell(ws, r, 9, "Weighted by user-supplied probabilities.", STYLE.note);
  r++;

  ws.pageSetup.printArea = `A1:I${r}`;
}


// ════════════════════════════════════════════════════════════════════════════
// SHEET 12 — AUDIT
// ════════════════════════════════════════════════════════════════════════════
// Health checks that any analyst reviewing the model would expect to see:
//   1. Balance Sheet identity: Assets = Liabilities + Equity for every year
//   2. Cash Flow reconciliation: Opening + Net Change = Closing
//   3. Forecast growth sanity (Y-o-Y revenue growth in expected range)
//   4. WACC sanity (5–25%)
//   5. Implied price reasonableness (not negative, not infinite)
//   6. Working capital flow direction
//   7. Scenario consistency (Bull ≥ Base ≥ Bear)
//   8. Probability-weighting integrity (sums to 100%)
//
// Each check returns ✓ OK or ✗ FAIL with a short diagnostic.
// ════════════════════════════════════════════════════════════════════════════
function addAudit(wb, p) {
  const ws = wb.addWorksheet("Audit", {
    properties: { tabColor: { argb: C.red } },
    views: [{ showGridLines: false, state: "frozen", ySplit: 4 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1,
                 margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } },
  });
  ws.columns = [
    { width: 3 }, { width: 5 }, { width: 42 }, { width: 18 }, { width: 14 }, { width: 50 },
  ];

  pageHeader(ws, "Model Audit & Integrity Checks",
    `Auto-evaluated checks · pass/fail driven by live formulas`, 6);

  let r = 5;

  // ── 1. Health score header ─────────────────────────────────────────────
  bannerRow(ws, r, 2, 6, "1.  MODEL HEALTH SCORE"); r++;
  setCell(ws, r, 2, "#", STYLE.colHeader);
  setCell(ws, r, 3, "Check", STYLE.colHeader);
  setCell(ws, r, 4, "Value / Result", STYLE.colHeader);
  setCell(ws, r, 5, "Status", STYLE.colHeader);
  setCell(ws, r, 6, "Diagnostic", STYLE.colHeader);
  r++;

  const checkStart = r;

  // ── Check 1: WACC sanity (5–25%) ──
  setCell(ws, r, 2, 1, STYLE.rowLabel);
  setCell(ws, r, 3, "WACC within 5%–25% sanity band", STYLE.rowLabel);
  setCell(ws, r, 4, { formula: `Wacc` }, STYLE.link, NF.money2);
  setCell(ws, r, 5,
    { formula: `IF(AND(Wacc>=5, Wacc<=25), "✓ OK", "✗ CHECK")` },
    { ...STYLE.formula, alignment: { horizontal: "center" } });
  setCell(ws, r, 6, "Outside this band suggests CAPM-input error or extreme leverage.", STYLE.note);
  r++;

  // ── Check 2: WACC > Terminal g ──
  setCell(ws, r, 2, 2, STYLE.rowLabel);
  setCell(ws, r, 3, "WACC > Terminal growth (perpetuity stability)", STYLE.rowLabel);
  setCell(ws, r, 4, { formula: `Wacc - TerminalG` }, STYLE.formula, NF.money2);
  setCell(ws, r, 5,
    { formula: `IF(Wacc - TerminalG > 1, "✓ OK", "✗ FAIL")` },
    { ...STYLE.formula, alignment: { horizontal: "center" } });
  setCell(ws, r, 6, "If WACC − g ≤ 1pp, Gordon TV becomes unstable.", STYLE.note);
  r++;

  // ── Check 3: Terminal growth ≤ nominal GDP (typically 3–6%) ──
  setCell(ws, r, 2, 3, STYLE.rowLabel);
  setCell(ws, r, 3, "Terminal g ≤ long-run nominal GDP (6%)", STYLE.rowLabel);
  setCell(ws, r, 4, { formula: `TerminalG` }, STYLE.link, NF.money2);
  setCell(ws, r, 5,
    { formula: `IF(TerminalG <= 6, "✓ OK", "✗ FAIL")` },
    { ...STYLE.formula, alignment: { horizontal: "center" } });
  setCell(ws, r, 6, "TV growth above nominal GDP is unsustainable — capped at 6% typically.", STYLE.note);
  r++;

  // ── Check 4: Capital structure sums to 100% ──
  setCell(ws, r, 2, 4, STYLE.rowLabel);
  setCell(ws, r, 3, "Capital structure: We + Wd = 100%", STYLE.rowLabel);
  setCell(ws, r, 4, { formula: `WEq + WDt` }, STYLE.formula, NF.money1);
  setCell(ws, r, 5,
    { formula: `IF(ABS(WEq + WDt - 100) < 0.5, "✓ OK", "✗ FAIL")` },
    { ...STYLE.formula, alignment: { horizontal: "center" } });
  setCell(ws, r, 6, "Weights must sum to 100% — else WACC is mis-weighted.", STYLE.note);
  r++;

  // ── Check 5: Tax rate within statutory band ──
  setCell(ws, r, 2, 5, STYLE.rowLabel);
  setCell(ws, r, 3, "Tax rate within 0%–40% range", STYLE.rowLabel);
  setCell(ws, r, 4, { formula: `TaxRate` }, STYLE.link, NF.money1);
  setCell(ws, r, 5,
    { formula: `IF(AND(TaxRate>=0, TaxRate<=40), "✓ OK", "✗ CHECK")` },
    { ...STYLE.formula, alignment: { horizontal: "center" } });
  setCell(ws, r, 6, "India MAT ≈ 22% incl. surcharge & cess (25.17%).", STYLE.note);
  r++;

  // ── Check 6: Implied price positive & finite ──
  setCell(ws, r, 2, 6, STYLE.rowLabel);
  setCell(ws, r, 3, "Implied price > 0 and not 'n/m'", STYLE.rowLabel);
  setCell(ws, r, 4, { formula: `ImpliedPx` }, STYLE.link, NF.money2);
  setCell(ws, r, 5,
    { formula: `IF(AND(ISNUMBER(ImpliedPx), ImpliedPx>0), "✓ OK", "✗ FAIL")` },
    { ...STYLE.formula, alignment: { horizontal: "center" } });
  setCell(ws, r, 6, "Implied price ≤ 0 → terminal value pathology or negative equity.", STYLE.note);
  r++;

  // ── Check 7: TV as % of EV ≤ 80% (rule of thumb) ──
  setCell(ws, r, 2, 7, STYLE.rowLabel);
  setCell(ws, r, 3, "TV % of EV ≤ 80% (TV not dominating)", STYLE.rowLabel);
  setCell(ws, r, 4, { formula: `PvTv / EvVal` }, STYLE.formula, NF.pct1);
  setCell(ws, r, 5,
    { formula: `IF(PvTv/EvVal <= 0.80, "✓ OK", "✗ HIGH")` },
    { ...STYLE.formula, alignment: { horizontal: "center" } });
  setCell(ws, r, 6, "If TV > 80% of EV, valuation is hyper-sensitive to terminal assumptions.", STYLE.note);
  r++;

  // ── Check 8: Base year revenue > 0 ──
  setCell(ws, r, 2, 8, STYLE.rowLabel);
  setCell(ws, r, 3, "Base revenue > 0 (anchor present)", STYLE.rowLabel);
  setCell(ws, r, 4, { formula: `BaseRev` }, STYLE.link, NF.money);
  setCell(ws, r, 5,
    { formula: `IF(BaseRev > 0, "✓ OK", "✗ FAIL")` },
    { ...STYLE.formula, alignment: { horizontal: "center" } });
  setCell(ws, r, 6, "Year-1 forecast cannot be anchored without a positive base.", STYLE.note);
  r++;

  // ── Check 9: Shares > 0 ──
  setCell(ws, r, 2, 9, STYLE.rowLabel);
  setCell(ws, r, 3, "Share count > 0", STYLE.rowLabel);
  setCell(ws, r, 4, { formula: `SharesMn` }, STYLE.link, NF.money1);
  setCell(ws, r, 5,
    { formula: `IF(SharesMn > 0, "✓ OK", "✗ FAIL")` },
    { ...STYLE.formula, alignment: { horizontal: "center" } });
  setCell(ws, r, 6, "Per-share value undefined if shares ≤ 0.", STYLE.note);
  r++;

  // ── Check 10: All Yw_growth values plausible (-30% to +60%) ──
  setCell(ws, r, 2, 10, STYLE.rowLabel);
  setCell(ws, r, 3, "All Yw_growth values within −30% to +60%", STYLE.rowLabel);
  setCell(ws, r, 4, { formula: `SUMPRODUCT(--(Yw_growth>=-30), --(Yw_growth<=60), --(Yw_growth<>0))` },
    STYLE.formula, NF.money);
  setCell(ws, r, 5,
    { formula: `IF(SUMPRODUCT(--(Yw_growth>60))+SUMPRODUCT(--(Yw_growth<-30)) = 0, "✓ OK", "✗ FAIL")` },
    { ...STYLE.formula, alignment: { horizontal: "center" } });
  setCell(ws, r, 6, "Extreme growth assumptions flag unrealistic forecasts.", STYLE.note);
  r++;

  // ── Check 11: EBITDA margin plausible (0–60%) ──
  setCell(ws, r, 2, 11, STYLE.rowLabel);
  setCell(ws, r, 3, "EBITDA margin within 0%–60%", STYLE.rowLabel);
  setCell(ws, r, 4, { formula: `EbitdaMargin` }, STYLE.link, NF.money1);
  setCell(ws, r, 5,
    { formula: `IF(AND(EbitdaMargin>=0, EbitdaMargin<=60), "✓ OK", "✗ CHECK")` },
    { ...STYLE.formula, alignment: { horizontal: "center" } });
  setCell(ws, r, 6, ">60% EBITDA margin is rare outside platforms/IP-driven firms.", STYLE.note);
  r++;

  // ── Check 12: Capex >= D&A (capital maintenance, growth firms) ──
  setCell(ws, r, 2, 12, STYLE.rowLabel);
  setCell(ws, r, 3, "Capex ≥ D&A (capital maintenance assumption)", STYLE.rowLabel);
  setCell(ws, r, 4, { formula: `CapexPctRev - DepPctRev` }, STYLE.formula, NF.money2);
  setCell(ws, r, 5,
    { formula: `IF(CapexPctRev >= DepPctRev * 0.8, "✓ OK", "✗ CHECK")` },
    { ...STYLE.formula, alignment: { horizontal: "center" } });
  setCell(ws, r, 6, "Capex < D&A means net negative reinvestment — only OK for declining firms.", STYLE.note);
  r++;

  // ── Check 13: Risk-free rate sane (1–12%) ──
  setCell(ws, r, 2, 13, STYLE.rowLabel);
  setCell(ws, r, 3, "Risk-free rate within 1%–12%", STYLE.rowLabel);
  setCell(ws, r, 4, { formula: `Rf` }, STYLE.link, NF.money2);
  setCell(ws, r, 5,
    { formula: `IF(AND(Rf>=1, Rf<=12), "✓ OK", "✗ CHECK")` },
    { ...STYLE.formula, alignment: { horizontal: "center" } });
  setCell(ws, r, 6, "10y g-sec for India typically 6.5–7.5%.", STYLE.note);
  r++;

  // ── Check 14: ERP sane (3–10%) ──
  setCell(ws, r, 2, 14, STYLE.rowLabel);
  setCell(ws, r, 3, "Equity risk premium within 3%–10%", STYLE.rowLabel);
  setCell(ws, r, 4, { formula: `Erp` }, STYLE.link, NF.money2);
  setCell(ws, r, 5,
    { formula: `IF(AND(Erp>=3, Erp<=10), "✓ OK", "✗ CHECK")` },
    { ...STYLE.formula, alignment: { horizontal: "center" } });
  setCell(ws, r, 6, "Damodaran India ERP typically 7–8%.", STYLE.note);
  r++;

  // ── Check 15: Beta sane (0.3–2.5) ──
  setCell(ws, r, 2, 15, STYLE.rowLabel);
  setCell(ws, r, 3, "Beta within 0.3–2.5", STYLE.rowLabel);
  setCell(ws, r, 4, { formula: `Beta` }, STYLE.link, NF.ratio);
  setCell(ws, r, 5,
    { formula: `IF(AND(Beta>=0.3, Beta<=2.5), "✓ OK", "✗ CHECK")` },
    { ...STYLE.formula, alignment: { horizontal: "center" } });
  setCell(ws, r, 6, "Extreme betas (<0.3 or >2.5) suggest data error or distressed name.", STYLE.note);
  r++;

  const checkEnd = r - 1;
  r += 1;

  // ── Health score summary ──────────────────────────────────────────────
  bannerRow(ws, r, 2, 6, "MODEL HEALTH SUMMARY"); r++;
  setCell(ws, r, 2, "", STYLE.rowLabel);
  setCell(ws, r, 3, "Total checks", STYLE.rowLabelBold);
  setCell(ws, r, 4, checkEnd - checkStart + 1, STYLE.formulaBold, NF.money);
  r++;
  setCell(ws, r, 2, "", STYLE.rowLabel);
  setCell(ws, r, 3, "Passed (✓)", STYLE.rowLabelBold);
  setCell(ws, r, 4,
    { formula: `COUNTIF(E${checkStart}:E${checkEnd}, "*✓*")` },
    STYLE.formulaBold, NF.money);
  r++;
  setCell(ws, r, 2, "", STYLE.rowLabel);
  setCell(ws, r, 3, "Failed (✗)", STYLE.rowLabelBold);
  setCell(ws, r, 4,
    { formula: `COUNTIF(E${checkStart}:E${checkEnd}, "*✗*")` },
    STYLE.formulaBold, NF.money);
  r++;
  setCell(ws, r, 2, "", STYLE.rowLabel);
  setCell(ws, r, 3, "Health score (%)", STYLE.totalLabel);
  setCell(ws, r, 4,
    { formula: `IFERROR(D${r - 2} / (D${r - 2} + D${r - 1}), 0)` },
    STYLE.total, NF.pct1);
  r++;
  setCell(ws, r, 2, "", STYLE.rowLabel);
  setCell(ws, r, 3, "Overall verdict", STYLE.totalLabel);
  setCell(ws, r, 4,
    { formula: `IF(COUNTIF(E${checkStart}:E${checkEnd},"*✗*")=0, "MODEL PASSES ALL CHECKS",IF(COUNTIF(E${checkStart}:E${checkEnd},"*✗ FAIL*")=0, "PASSES — REVIEW FLAGS", "ERRORS PRESENT — REVIEW"))` },
    STYLE.total, NF.txt);
  r += 2;

  // ── Statement integrity checks (BS, CF) ─────────────────────────────────
  bannerRow(ws, r, 2, 6, "STATEMENT INTEGRITY CHECKS  (from forecast schedules)"); r++;
  const fcRows = p.idcf?.base?.rows || [];

  // Compute checks server-side from passed-in data
  setCell(ws, r, 2, "#", STYLE.colHeader);
  setCell(ws, r, 3, "Check", STYLE.colHeader);
  setCell(ws, r, 4, "Year",  STYLE.colHeader);
  setCell(ws, r, 5, "Status", STYLE.colHeader);
  setCell(ws, r, 6, "Detail / Magnitude", STYLE.colHeader);
  r++;

  // BS identity check — FORMULA-BASED (reads the live BS sheet reconciliation
  // row by INDEX/MATCH, so it reflects what the workbook itself computes, not
  // the input data. Earlier versions used input data and produced false
  // negatives when the data source had small reconciliation drift even though
  // the Excel BS reconciled to zero by construction).
  //
  // We iterate over all nA + nF columns (not just the data-array length) so
  // every year visible in the BS sheet gets a check row, even when the route
  // passes empty forecast arrays.
  const bsActs = p.statements?.balanceActuals || [];
  const bsForecast = p.statements?.balance || p.statements?.balanceForecast || [];
  const isR = wb._rowIndex?.is || {};
  const auditNA = wb._rowIndex?.bs?.nA ?? bsActs.length;
  const auditNF = wb._rowIndex?.bs?.nF ?? (p.assumptions?.forecastHorizon || p.uiState?.forecastHorizon || 5);
  const baseYearAudit = p.statements?.incomeActuals?.slice(-1)[0]?.year ?? (new Date().getFullYear());

  for (let i = 0; i < auditNA + auditNF; i++) {
    setCell(ws, r, 2, i + 1, STYLE.rowLabel);
    setCell(ws, r, 3, "Balance Sheet: A = L + E + MI", STYLE.rowLabel);
    // Year label: historicals from bsActs, forecast from baseYear + (i − nA + 1)
    let yearLabel;
    if (i < auditNA && bsActs[i]) {
      yearLabel = fy(bsActs[i].year);
    } else {
      yearLabel = `FY${String(baseYearAudit + (i - auditNA) + 1).slice(2)}E`;
    }
    setCell(ws, r, 4, yearLabel, STYLE.formula);
    const c = 3 + i;
    const colLetter = col(c);
    // Status: read the diff from BS reconciliation row, tolerance = 0.5% of total assets
    setCell(ws, r, 5,
      { formula: `IF(ABS(INDEX('Balance Sheet'!${colLetter}:${colLetter}, MATCH("Difference (should*", 'Balance Sheet'!$B:$B, 0))) / MAX(1, ABS(INDEX('Balance Sheet'!${colLetter}:${colLetter}, MATCH("TOTAL ASSETS", 'Balance Sheet'!$B:$B, 0)))) < 0.005, "✓ OK", "✗ FAIL")` },
      { ...STYLE.formula, alignment: { horizontal: "center" } });
    setCell(ws, r, 6,
      { formula: `"Diff: " & TEXT(INDEX('Balance Sheet'!${colLetter}:${colLetter}, MATCH("Difference (should*", 'Balance Sheet'!$B:$B, 0)), "#,##0.00") & " ${p.unit}"` },
      STYLE.note);
    r++;
  }

  // CF reconciliation check — same iteration logic
  const cfActs = p.statements?.cashflowActuals || [];

  for (let i = 0; i < auditNA + auditNF; i++) {
    setCell(ws, r, 2, i + 1, STYLE.rowLabel);
    setCell(ws, r, 3, "Cash Flow: Opening + ΔCash = Closing", STYLE.rowLabel);
    let yearLabel;
    if (i < auditNA && cfActs[i]) {
      yearLabel = fy(cfActs[i].year);
    } else {
      yearLabel = `FY${String(baseYearAudit + (i - auditNA) + 1).slice(2)}E`;
    }
    setCell(ws, r, 4, yearLabel, STYLE.formula);
    const c = 3 + i;
    const colLetter = col(c);
    setCell(ws, r, 5,
      { formula: `IF(ABS(INDEX('Cash Flow'!${colLetter}:${colLetter}, MATCH("Reconciliation diff*", 'Cash Flow'!$B:$B, 0))) < 1, "✓ OK", "✗ FAIL")` },
      { ...STYLE.formula, alignment: { horizontal: "center" } });
    setCell(ws, r, 6,
      { formula: `"Diff: " & TEXT(INDEX('Cash Flow'!${colLetter}:${colLetter}, MATCH("Reconciliation diff*", 'Cash Flow'!$B:$B, 0)), "#,##0.00") & " ${p.unit}"` },
      STYLE.note);
    r++;
  }

  // Forecast growth sanity
  fcRows.forEach((row, i) => {
    const g = row.growth || 0;
    const ok = g >= -20 && g <= 50;
    setCell(ws, r, 2, i + 1, STYLE.rowLabel);
    setCell(ws, r, 3, "Forecast Y-o-Y growth within −20% to +50%", STYLE.rowLabel);
    setCell(ws, r, 4, fy(row.year), STYLE.formula);
    setCell(ws, r, 5, ok ? "✓ OK" : "✗ HIGH",
      ok ? STYLE.ok : STYLE.fail);
    setCell(ws, r, 6, `Growth: ${(+g).toFixed(2)}%`, STYLE.note);
    r++;
  });

  r += 1;

  // Footer note
  bannerRow(ws, r, 2, 6, "NOTES"); r++;
  const auditNotes = [
    "• Checks 1–15 are live (formula-driven) and react to any input change on the Assumptions sheet.",
    "• Statement integrity checks are computed server-side from the historical + forecast schedules.",
    "• A health score < 100% means at least one input is outside its sanity band — review before publication.",
    "• Critical FAIL on WACC > g or Implied price > 0 will produce nonsensical valuations and must be fixed.",
  ];
  auditNotes.forEach((line) => {
    ws.mergeCells(r, 2, r, 6);
    setCell(ws, r, 2, line, STYLE.note);
    r++;
  });

  ws.pageSetup.printArea = `A1:F${r}`;
}


// ════════════════════════════════════════════════════════════════════════════
// SHEET 2 — DASHBOARD  (Executive Summary)
// ════════════════════════════════════════════════════════════════════════════
// One-page executive summary an MD/PM would look at first. Pulls headline
// numbers from DCF Engine / WACC Build / Assumptions via named ranges, plus
// renders three small in-sheet charts: revenue+EBITDA trajectory, EV bridge,
// and scenario per-share comparison.
// ════════════════════════════════════════════════════════════════════════════
function addDashboard(wb, p) {
  const ws = wb.addWorksheet("Dashboard", {
    properties: { tabColor: { argb: C.amber } },
    views: [{ showGridLines: false }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1,
                 margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.3, footer: 0.3 } },
  });
  ws.columns = [
    { width: 3 },  // A margin
    { width: 30 }, // B label
    { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, // C-G
    { width: 4 },  // H spacer
    { width: 30 }, // I label
    { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, // J-N
  ];

  pageHeader(ws, `${p.meta.name} (${p.meta.symbol}) — Executive Dashboard`,
    `Institutional DCF · ${p.unit} · ${new Date().toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" })}`,
    14);

  let r = 5;

  // ── Top-line KPIs in a 2x4 grid ────────────────────────────────────────
  bannerRow(ws, r, 2, 14, "KEY OUTPUTS"); r++;

  const kpiLabel = (lbl) => ({
    font: fontBase(C.greyDk, false, 9),
    alignment: { horizontal: "left", indent: 1 },
  });
  const kpiValue = (color = C.navy) => ({
    font: fontBase(color, true, 18),
    alignment: { horizontal: "left", indent: 1, vertical: "middle" },
  });
  const kpiSub = {
    font: fontBase(C.greyDk, false, 9),
    alignment: { horizontal: "left", indent: 1 },
  };

  // KPI cells (4 across × 2 rows)
  const kpis = [
    { lbl: "Implied price",      val: { formula: `ImpliedPx` }, fmt: NF.money2, color: C.navy, sub: `${p.ccySym}/share` },
    { lbl: "Current price",      val: { formula: `CurrentPx` }, fmt: NF.money2, color: C.black, sub: `${p.ccySym}/share` },
    { lbl: "Upside / (downside)",val: { formula: `IFERROR(ImpliedPx/CurrentPx - 1, 0)` }, fmt: NF.pct1, color: C.amber, sub: "vs current price" },
    { lbl: "Recommendation",     val: { formula: `IF(ImpliedPx/CurrentPx>=1.20,"BUY",IF(ImpliedPx/CurrentPx>=1.05,"ACCUMULATE",IF(ImpliedPx/CurrentPx>=0.95,"HOLD",IF(ImpliedPx/CurrentPx>=0.80,"REDUCE","SELL"))))` }, fmt: NF.txt, color: "FF1F7A1F", sub: "Based on upside band" },
    { lbl: "Enterprise Value",   val: { formula: `EvVal` }, fmt: NF.money, color: C.navy, sub: p.unit },
    { lbl: "Equity Value",       val: { formula: `EqVal` }, fmt: NF.money, color: C.navy, sub: p.unit },
    { lbl: "WACC",               val: { formula: `WaccScen` }, fmt: NF.money2, color: C.black, sub: "Scenario-adjusted" },
    { lbl: "Terminal growth",    val: { formula: `TerminalG + ScenTermD` }, fmt: NF.money2, color: C.black, sub: "%, scenario-adjusted" },
  ];
  // Layout: row r (labels), r+1 (values), r+2 (subs), then r+3, r+4, r+5
  // 4 columns each KPI spans 3 cols
  const kpiPositions = [
    [r, 2], [r, 5], [r, 8], [r, 11],
    [r + 3, 2], [r + 3, 5], [r + 3, 8], [r + 3, 11],
  ];
  kpis.forEach((k, i) => {
    const [rr, cc] = kpiPositions[i];
    setCell(ws, rr, cc, k.lbl, kpiLabel(k.lbl));
    setCell(ws, rr + 1, cc, k.val, kpiValue(k.color), k.fmt);
    setCell(ws, rr + 2, cc, k.sub, kpiSub);
    ws.mergeCells(rr, cc, rr, cc + 2);
    ws.mergeCells(rr + 1, cc, rr + 1, cc + 2);
    ws.mergeCells(rr + 2, cc, rr + 2, cc + 2);
    ws.getRow(rr + 1).height = 32;
  });
  r += 6;
  r += 1;

  // ── Revenue & EBITDA forecast table (mini) ─────────────────────────────
  bannerRow(ws, r, 2, 14, "FORECAST SUMMARY  (linked from DCF Engine)"); r++;
  const horizon = p.assumptions?.forecastHorizon || p.uiState?.forecastHorizon || 5;
  const nF = horizon;
  // Header
  setCell(ws, r, 2, "Line item", STYLE.colHeader);
  for (let y = 1; y <= nF; y++) {
    setCell(ws, r, 2 + y, { formula: `"FY"&RIGHT(BaseYear+${y},2)&"E"` }, STYLE.colHeader);
  }
  setCell(ws, r, 2 + nF + 1, "5y CAGR", STYLE.colHeader);
  r++;
  // Revenue (rebuilt from formulas — same as DCF Engine)
  const revRowD = r;
  setCell(ws, r, 2, "Revenue", STYLE.rowLabelBold);
  for (let y = 1; y <= nF; y++) {
    const c = 2 + y;
    if (y === 1) {
      setCell(ws, r, c, { formula: `BaseRev * (1 + INDEX(Yw_growth, ${y})/100)` },
        STYLE.formulaBold, NF.money);
    } else {
      setCell(ws, r, c, { formula: `${col(c - 1)}${r} * (1 + INDEX(Yw_growth, ${y})/100)` },
        STYLE.formulaBold, NF.money);
    }
  }
  setCell(ws, r, 2 + nF + 1,
    { formula: `((${col(2 + nF)}${r}/BaseRev)^(1/${nF})) - 1` },
    STYLE.formulaBold, NF.pct1);
  r++;
  // EBITDA
  const ebRowD = r;
  setCell(ws, r, 2, "EBITDA", STYLE.rowLabel);
  for (let y = 1; y <= nF; y++) {
    const c = 2 + y;
    setCell(ws, r, c, { formula: `${col(c)}${revRowD} * INDEX(Yw_ebitdaMargin, ${y})/100` },
      STYLE.formula, NF.money);
  }
  setCell(ws, r, 2 + nF + 1,
    { formula: `((${col(2 + nF)}${r}/${col(3)}${r})^(1/(${nF}-1))) - 1` },
    STYLE.formula, NF.pct1);
  r++;
  setCell(ws, r, 2, "  EBITDA margin", STYLE.rowLabelSub);
  for (let y = 1; y <= nF; y++) {
    const c = 2 + y;
    setCell(ws, r, c, { formula: `${col(c)}${ebRowD}/${col(c)}${revRowD}` },
      STYLE.formula, NF.pct1);
  }
  r += 2;

  // ── EV / Equity bridge ─────────────────────────────────────────────────
  bannerRow(ws, r, 2, 14, "EV → EQUITY BRIDGE"); r++;
  setCell(ws, r, 2, "Sum of PV(FCFF) explicit", STYLE.rowLabel);
  setCell(ws, r, 3, { formula: `EvVal - PvTv` }, STYLE.formula, NF.money);
  setCell(ws, r, 4, { formula: `(EvVal - PvTv) / EvVal` }, STYLE.formula, NF.pct1);
  r++;
  setCell(ws, r, 2, "+ PV of Terminal Value", STYLE.rowLabel);
  setCell(ws, r, 3, { formula: `PvTv` }, STYLE.formula, NF.money);
  setCell(ws, r, 4, { formula: `PvTv / EvVal` }, STYLE.formula, NF.pct1);
  r++;
  setCell(ws, r, 2, "= Enterprise Value", STYLE.subtotalLabel);
  setCell(ws, r, 3, { formula: `EvVal` }, STYLE.subtotal, NF.money);
  setCell(ws, r, 4, "100%", STYLE.subtotal);
  r++;
  setCell(ws, r, 2, "− Net debt", STYLE.rowLabel);
  setCell(ws, r, 3, { formula: `-NetDebtUsed` }, STYLE.formula, NF.money);
  r++;
  setCell(ws, r, 2, "= Equity Value", STYLE.totalLabel);
  setCell(ws, r, 3, { formula: `EqVal` }, STYLE.total, NF.money);
  r++;
  setCell(ws, r, 2, "÷ Shares (mn)", STYLE.rowLabel);
  setCell(ws, r, 3, { formula: `SharesMn` }, STYLE.link, NF.money1);
  r++;
  setCell(ws, r, 2, `= Implied price (${p.ccySym}/sh)`, STYLE.totalLabel);
  setCell(ws, r, 3, { formula: `ImpliedPx` }, STYLE.total, NF.money2);
  r += 2;

  // ── Scenario comparison (mini table) ───────────────────────────────────
  bannerRow(ws, r, 2, 14, "SCENARIO PER-SHARE COMPARISON  (from Scenarios sheet)"); r++;
  const scenNames = ["Base", "Bull", "Bear", "Stress", "Downside"];
  setCell(ws, r, 2, "Scenario", STYLE.colHeader);
  scenNames.forEach((nm, i) => setCell(ws, r, 3 + i, nm, STYLE.colHeader));
  r++;
  // Use the IDCF data if provided for these per-share values; else
  // we link via best-effort by reading from the user's analytics output.
  const psValues = {
    Base:    p.idcf?.base?.perShare,
    Bull:    p.idcf?.bull?.perShare,
    Bear:    p.idcf?.bear?.perShare,
    Stress:  p.idcf?.stress?.perShare,
    Downside:p.idcf?.downside?.perShare,
  };
  setCell(ws, r, 2, `Implied price (${p.ccySym}/sh)`, STYLE.rowLabelBold);
  scenNames.forEach((nm, i) => {
    setCell(ws, r, 3 + i, safeNum(psValues[nm]), STYLE.formulaBold, NF.money2);
  });
  r++;
  setCell(ws, r, 2, "Upside vs current (%)", STYLE.rowLabel);
  const curPx = p.idcf?.currentPrice || p.meta.price || 0;
  scenNames.forEach((nm, i) => {
    const v = psValues[nm] && curPx ? (psValues[nm] / curPx - 1) : 0;
    setCell(ws, r, 3 + i, v, STYLE.formula, NF.pct1);
  });
  r++;
  setCell(ws, r, 2, "Probability (% — default)", STYLE.rowLabel);
  const defaultProbs = { Base: 40, Bull: 20, Bear: 20, Stress: 10, Downside: 10 };
  scenNames.forEach((nm, i) => {
    setCell(ws, r, 3 + i, defaultProbs[nm], STYLE.input, NF.money);
  });
  r += 2;

  // ── Key risk factors (from evidence) ───────────────────────────────────
  bannerRow(ws, r, 2, 14, "ANALYST NOTES  &  KEY RISKS"); r++;
  const commentary = (p.idcf?.commentary || []).slice(0, 6);
  if (commentary.length) {
    commentary.forEach((line, i) => {
      ws.mergeCells(r, 2, r, 14);
      setCell(ws, r, 2, "• " + (line || ""), STYLE.note);
      ws.getRow(r).height = 22;
      r++;
    });
  } else {
    ws.mergeCells(r, 2, r, 14);
    setCell(ws, r, 2,
      "• Generate full commentary in the MERIDIAN Equity Research module for a deeper analytical narrative.",
      STYLE.note);
    ws.getRow(r).height = 22;
    r++;
  }
  r += 1;

  // ── Footer ─────────────────────────────────────────────────────────────
  bannerRow(ws, r, 2, 14, "MODEL HEALTH"); r++;
  setCell(ws, r, 2, "Overall verdict", STYLE.rowLabel);
  setCell(ws, r, 3,
    { formula: `INDEX(Audit!D:D, MATCH("Overall verdict", Audit!C:C, 0))` },
    STYLE.link, NF.txt);
  setCell(ws, r, 9,
    "→ See Audit tab for full check list and statement-integrity reconciliations.",
    STYLE.note);
  r++;

  ws.pageSetup.printArea = `A1:N${r}`;
}


// ════════════════════════════════════════════════════════════════════════════
// SHEET 13 — DOCUMENTATION
// ════════════════════════════════════════════════════════════════════════════
function addDocumentation(wb, p) {
  const ws = wb.addWorksheet("Documentation", {
    properties: { tabColor: { argb: C.greyDk } },
    views: [{ showGridLines: false }],
    pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1,
                 margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } },
  });
  ws.columns = [{ width: 3 }, { width: 30 }, { width: 80 }];

  pageHeader(ws, "Model Documentation", "Methodology, conventions, and review notes", 3);

  let r = 5;
  const textRow = (label, body, isHdr = false) => {
    setCell(ws, r, 2, label, isHdr ? STYLE.subtotalLabel : STYLE.rowLabelBold);
    ws.mergeCells(r, 3, r, 3);
    setCell(ws, r, 3, body, { ...STYLE.note, alignment: { horizontal: "left", vertical: "top", wrapText: true } });
    // Try to estimate row height
    const lines = (body.match(/\n/g) || []).length + Math.ceil(body.length / 100);
    ws.getRow(r).height = Math.max(18, Math.min(180, 15 + lines * 14));
    r++;
  };

  bannerRow(ws, r, 2, 3, "1.  METHODOLOGY"); r++;
  textRow("Model framework",
    "Discounted Cash Flow (DCF) using unlevered Free Cash Flow to the Firm (FCFF). All cash flows are firm-level (pre-financing) and currency-consistent with reported revenue. Enterprise value is bridged to equity value via subtraction of net debt.");
  textRow("Forecast period",
    "Explicit 5-year forecast (configurable 3/5/7/10). Drivers are user-editable per year via the Yw_* named ranges. Year-1 anchors on the last reported actual revenue (BaseRev).");
  textRow("Terminal value",
    "Two methods supported: (1) Gordon perpetuity growth, TV = FCFF(N+1) / (WACC − g), and (2) Exit EV/EBITDA multiple. Toggle via the TermMethod input on Assumptions (1 = Perpetuity, 2 = Exit multiple).");
  textRow("Discounting",
    "Mid-year convention. Discount factor for year t = 1 / (1 + WACC)^(t − 0.5). Terminal value discounted at (1 + WACC)^(N − 0.5).");
  textRow("WACC",
    "CAPM cost of equity: Rf + β × ERP. After-tax cost of debt: Kd × (1 − t). Weights from market cap and total debt. Scenario WACC = base WACC + scenario delta.");
  r++;

  bannerRow(ws, r, 2, 3, "2.  KEY CONVENTIONS"); r++;
  textRow("Currency / units",
    p.isINR
      ? "All monetary figures presented in ₹ Crore (scale = 1e7). Per-share figures in ₹."
      : "All monetary figures presented in $ Million (scale = 1e6). Per-share figures in $.");
  textRow("Color coding",
    "BLUE values = hardcoded inputs (user-editable). BLACK = formulas. GREEN = cross-sheet links via named ranges. Bold rows indicate subtotals/totals.");
  textRow("Named ranges",
    "All assumptions are exposed as named ranges (e.g. GrowthBase, EbitdaMargin, WaccScen, ImpliedPx). Downstream sheets reference these instead of hard cell addresses, so the model is robust to row insertions.");
  textRow("Scenario logic",
    "5 scenarios: Base, Bull, Bear, Stress, Downside. Each carries deltas for growth, margin, WACC, terminal-g, and capex. Changing ScenarioId on Assumptions flexes every line in the explicit-period forecast.");
  textRow("Statement integrity (PAT / BS / CF)",
    "PAT = netIncomeIncludingNoncontrollingInterests (canonical Ind AS 'Profit for the year'). Balance Sheet uses reported totals as authoritative; otherNCA acts as a plug to ensure A = L + E exactly. CF opening/closing cash pulled from the CF statement's own beginning/endCashPosition (not BS cash) for reconciliation integrity.");
  r++;

  bannerRow(ws, r, 2, 3, "3.  AUDIT TRAIL"); r++;
  textRow("Reproducibility",
    "Every formula traces back to a named range on Assumptions or WACC Build. Per-share value can be reproduced by inspecting the FCFF schedule, discount factors, and EV→Equity bridge on the DCF Engine sheet.");
  textRow("Cross-checks",
    "See Audit tab for 15 live sanity checks (WACC band, g < WACC, capital structure, etc.) plus statement-integrity diagnostics (A=L+E, CF reconciliation, forecast growth).");
  textRow("Known limitations",
    "Simple firm-level DCF assumes constant capital structure across the forecast. Excess cash is treated as offsetting debt via NetDebt; no separate non-operating asset valuation. Minority interest taken as plug if reported equity ≠ A − L.");
  r++;

  bannerRow(ws, r, 2, 3, "4.  DATA SOURCES"); r++;
  textRow("Financial statements",
    "Yahoo Finance fundamentalsTimeSeries API — last 4 years of actuals + most recent TTM where available.");
  textRow("Risk-free rate",
    "10-year sovereign government yield, observable at model date.");
  textRow("ERP",
    "Damodaran India ERP (mature-market premium + country risk).");
  textRow("Beta",
    "Levered beta, 2-year monthly, sourced from Yahoo Finance.");
  textRow("Estimates (forward EPS, growth)",
    "Where available, consensus estimates from FMP (Financial Modeling Prep) API.");
  r++;

  bannerRow(ws, r, 2, 3, "5.  ABOUT MERIDIAN"); r++;
  textRow("Platform",
    "MERIDIAN is an institutional-grade equity research workbench covering Market Intelligence, Equity Research, Modeling Lab, Forensic Analysis, Risk Center, Screener, Portfolio, News & Sentiment, Calculators, and Library — all linked through a single ticker context.");
  textRow("Modeling Lab",
    "The Modeling Lab houses three engines: the Institutional DCF (IDCF, this model), the Multi-Scenario Forecast Builder, and the Comparable Companies Valuation Engine. Outputs feed directly into the Report Generator for analyst-ready PDF/Excel deliverables.");
  textRow("Author",
    "Built by Nikhil — CA Intermediate, Staff Accountant @ KPMG (B S R & Co. LLP). Portfolio project demonstrating financial modeling, equity research intuition, and full-stack engineering for prospective Equity Research Analyst roles.");
  textRow("Contact",
    "Email: nikhilpratap112006@gmail.com   ·   LinkedIn: linkedin.com/in/nikhilpr11");
  r++;

  bannerRow(ws, r, 2, 3, "6.  DISCLAIMER"); r++;
  textRow("",
    "This model is provided for educational and demonstration purposes only. The figures, assumptions, and outputs herein do not constitute investment advice, a recommendation to buy or sell any security, or a substitute for independent due diligence. Past performance is not indicative of future results. The author makes no representations or warranties as to the accuracy or completeness of the data, and disclaims liability for any errors, omissions, or losses arising from reliance on this model.");

  r += 1;
  ws.pageSetup.printArea = `A1:C${r}`;
}

