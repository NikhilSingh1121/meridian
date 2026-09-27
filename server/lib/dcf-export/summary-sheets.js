/**
 * Title (cover + company profile), Terms and the Executive Summary of the template workbook,
 * plus the package-level patches: charts re-pointed to the horizon, sparklines, controls,
 * list validations, and removal of the template vendor's logo/links.
 */
const { SN, RA, RF, RD, RT, R2 } = require("./context");
const { colName: CN, a1, xmlEsc } = require("../xlsx-tpl");
const { range } = require("./core-sheets");

const f = (x) => ({ f: x });

/* ═══════════════════════════════ TITLE ═══════════════════════════════ */
/* Cover: a boxed two-column sheet (B labels · C values) with teal section bars — company profile,
   valuation summary, business description and the sheet index. B5 holds the model title
   ("<company>⏎DCF Valuation Model"); every other sheet shows it in B2 on one line. */
function buildTitle(X) {
  const sh = X.wb.sheet(SN.title), p = X.p, st = X.wb.styles, S = X.S;
  sh.cols = `<cols><col min="1" max="1" width="2.9140625" customWidth="1"/><col min="2" max="2" width="36" customWidth="1"/><col min="3" max="3" width="70" customWidth="1"/><col min="4" max="4" width="2.9140625" customWidth="1"/><col min="5" max="16384" width="11"/></cols>`;
  const base = S.lbl, TEAL = "FF215967", GRID = "FFBFBFBF";
  // every cell is gridded; column B carries the box's left edge, column C its right edge
  const mk = (o, side, extra = {}) => st.variant(base, { ...o, border: { left: side === "B" ? "medium" : "thin", right: side === "C" ? "medium" : "thin", top: extra.top || "thin", bottom: extra.bottom || "thin", color: extra.dark ? "FF000000" : GRID } });
  const pair = (o, extra) => [mk(o, "B", extra), mk(o, "C", extra)];
  const Y = {
    brand: pair({ bold: true, size: 16, halign: "center", valign: "center", color: "FF000000" }, { top: "medium", dark: true }),
    tag: pair({ italic: true, size: 13, halign: "center", valign: "center", color: "FF000000" }, { dark: true }),
    title: pair({ bold: true, size: 20, halign: "center", valign: "center", wrap: true, color: "FF000000" }, { dark: true }),
    sec: pair({ fill: TEAL, color: "FFFFFFFF", bold: true, halign: "center", valign: "center" }, { dark: true }),
    kv: [mk({ bold: true, halign: "left", valign: "center", color: "FF000000", wrap: true }, "B"), mk({ halign: "left", valign: "center", color: "FF000000", wrap: true }, "C")],
    text: pair({ halign: "center", valign: "top", wrap: true, color: "FF000000" }),
    link: [mk({ halign: "center", valign: "center", color: "FF0563C1", underline: true }, "B"), mk({ halign: "left", valign: "center", color: "FF000000" }, "C")],
    note: pair({ italic: true, halign: "center", valign: "center", wrap: true, color: "FF7F7F7F" }, { bottom: "medium", dark: true }),
  };
  const set = (r, c, v, s) => sh.set(r, c, v, s);
  const band = (r, [sB, sC], v, h, merge = true) => { set(r, 2, v, sB); set(r, 3, null, sC); if (merge) sh.merge(`B${r}:C${r}`); if (h) sh.height(r, h); };
  band(2, Y.brand, "M-TERMINAL", 22);
  band(3, Y.tag, "Institutional Equity Research · Modeling Lab", 20);
  band(4, Y.title, `${p.meta.name}\nDCF Valuation Model`, 56);
  let r = 5;
  const section = (t) => { set(r, 2, t, Y.sec[0]); set(r, 3, null, Y.sec[1]); sh.height(r, 17); r++; };
  const kv = (k, v, fmt) => { set(r, 2, k, Y.kv[0]); set(r, 3, v, fmt ? st.variant(Y.kv[1], { numFmt: fmt }) : Y.kv[1]); const len = typeof v === "string" ? v.length : 0; sh.height(r, len > 90 ? 15 * Math.ceil(len / 90) + 2 : 15.5); r++; };
  section("Company Profile");
  kv("Company", p.meta.name);
  kv("Ticker / Exchange", `${p.meta.symbol}${p.meta.exchange ? " · " + p.meta.exchange : ""}`);
  kv("Sector / Industry", [p.meta.sector, p.meta.industry].filter(Boolean).join(" · ") || "—");
  kv("Country", p.meta.country || "—");
  kv("Reporting currency · model unit", `${X.ccy} · ${X.unit}`);
  kv("Current share price", f(`Assumptions!$G$${RA.price}`), "#,##0.00");
  kv("Shares outstanding", f(`Assumptions!$G$${RA.shares}`), `#,##0.00" ${X.isINR ? "Cr" : "Mn"}"`);
  kv("Market capitalisation", f(`Assumptions!$G$${RA.price}*Assumptions!$G$${RA.shares}`), `#,##0" ${X.unit}"`);
  kv("Net debt (incl. leases)", f(`-DCF!$M$${RD.debt}-DCF!$M$${RD.cash}`), `#,##0" ${X.unit}";(#,##0)" ${X.unit}"`);
  kv("Last reported fiscal year", `FY${X.baseYear}${p.meta.lastFyEnd ? " (period end " + p.meta.lastFyEnd + ")" : ""}`);
  kv("Forecast horizon", `${X.N} years (FY${X.rows[0].year}–FY${X.rows[X.N - 1].year}) + terminal value`);
  kv("Economic moat", p.plan && p.plan.quality ? `${p.plan.quality.moat || "—"} · earnings quality grade ${p.plan.quality.earningsQualityGrade || "—"}` : "—");
  kv("Model status", `${p.meta.modelStatus}${p.meta.userOverrides && p.meta.userOverrides.length ? " — user-adjusted: " + p.meta.userOverrides.join(", ") : ""}`);
  kv("Research basis", p.meta.dcfMode === "lab" ? "Modeling Lab DCF switched on — the DCF is the 40% intrinsic anchor of the blended target" : "Market basis — the blended target uses market-based methods (the DCF is shown for reference)");
  kv("Built", String(p.meta.builtAt).replace("T", " ").slice(0, 16) + " UTC");
  section("Valuation Summary");
  kv("DCF value per share", f(`DCF!$M$${RD.ps}`), "#,##0.00");
  kv("Upside / (downside) vs price", f(`DCF!$M$${RD.up}`), "+0.0%;-0.0%;0.0%");
  kv("Blended target (Valuation Methods)", f(`'${SN.val}'!$E$${X.valBlendRow || 6}`), "#,##0.00");
  kv("Selected terminal value model", f(`'Executive Summary'!$P$81`));
  kv("WACC · terminal growth", f(`TEXT(Assumptions!$G$${RA.waccUsed},"0.00%")&" · "&TEXT(Assumptions!$G$${RA.vdf.g},"0.00%")`));
  kv("Model checks", f(`IF(Checks!$G$5=0,"All checks pass","ATTENTION: "&Checks!$G$5&" check(s) failing — see Checks")`));
  if (p.meta.summary) {
    section("Business Description");
    const txt = p.meta.summary.length > 1600 ? p.meta.summary.slice(0, 1600).replace(/\s+\S*$/, "") + "…" : p.meta.summary;
    band(r, Y.text, txt, Math.min(320, 15 * Math.ceil(txt.length / 150) + 4)); r++;
  }
  section("Worksheets");
  X.linkList.forEach(([nm, anchor, what]) => { set(r, 2, f(`HYPERLINK("#'${nm}'!${anchor}",${JSON.stringify(nm)})`), Y.link[0]); set(r, 3, what, Y.link[1]); sh.height(r, 15.5); r++; });
  band(r, Y.note, "Source: M-Terminal — company filings via Yahoo Finance; assumptions from the M-Terminal assumption engine. Blue cells are inputs, black cells formulas, green cells links to other sheets.", 32);
}

/* ═══════════════════════════════ TERMS ═══════════════════════════════ */
function buildTerms(X) {
  const sh = X.wb.sheet(SN.terms), st = X.wb.styles;
  for (const r of range(1, 68)) sh.cloneRow(r, r, (c) => c, { values: true });
  sh.set(2, 2, f('SUBSTITUTE(Title!$B$4,CHAR(10)," · ")'));
  const lblS = sh.tplStyle("C21"), descS = sh.tplStyle("E21"), subS = sh.tplStyle("F37");
  const extra = [
    ["NOPAT", "Net Operating Profit After Tax = EBIT × (1 − tax rate); used for the terminal value"],
    ["RONIC", "Return On New Invested Capital — the return earned on capital reinvested in the terminal state"],
    ["Stage-2 fade", "Years after the explicit forecast in which growth fades linearly to terminal growth (wide moat 10, narrow 5, none 0)"],
    ["Value Driver Fade", "Terminal value with FCFF = NOPAT × (1 − g ÷ RONIC): reinvestment is exactly what the growth needs"],
    ["Blume beta", "Regression beta adjusted towards 1: 0.67 × raw + 0.33"],
    ["ERP", "Equity Risk Premium over the local 10-year government bond"],
    ["Mid-year", "Cash flows discounted at (1 + WACC)^(t − 0.5): they arrive through the year, not at its end"],
    ["Data table", "Excel what-if table (Data ▸ What-If Analysis) — re-runs this whole model for each input value"],
    ["Flex cell", "An analysis-sheet cell (column D) a data table substitutes; 0 in the base case"],
    ["Reverse DCF", "The growth rate / WACC at which the model's value equals today's price"],
    ["Tornado", "One-way sensitivity: each driver flexed by a standard step with the others held"],
    ["Monte Carlo", "5,000 runs with seeded normal shocks to growth, margin, WACC and terminal growth"],
    ["Upper median", "Middle value of a sorted list; for an even count the higher of the two middle values (the website's rule)"],
  ];
  let r = 64;
  sh.set(r, 3, "M-Terminal model terms", sh.tplStyle("C17")); r += 2;
  extra.forEach(([k, v]) => { sh.set(r, 3, k, lblS); sh.set(r, 5, v, descS); r++; });
  r++;
  sh.set(r, 3, "Colour code (strictly as the template)", sh.tplStyle("C17")); r++;
  [["Blue", "Inputs: reported actuals, market data and the engine's per-year drivers — the only numbers typed in"], ["Light blue", "Linked assumptions: default to another assumption, can be overwritten"],
    ["Black", "Calculations"], ["Green", "Links to other sheets"]].forEach(([k, v]) => { sh.set(r, 3, k, lblS); sh.set(r, 5, v, descS); r++; });
}

/* ═══════════════════════════════ EXECUTIVE SUMMARY ═══════════════════════════════ */
function buildExec(X) {
  const sh = X.wb.sheet(SN.exec), S = X.S, N = X.N, d = N - 5, st = X.wb.styles;
  const G = (k) => 6 + k;                  // IS forecast col (k = 1..N); F (6) = last actual
  const BL = 14 + d, BU = 16 + d, BQ = 17 + d, B = (k) => 17 + d + k;
  const tmap = (c) => { if (c <= 6) return c; if (c === 7) return G(1); if (c === 8) return N > 2 ? range(G(2), G(N - 1)) : null; if (c === 9 || c === 10) return null; if (c === 11) return G(N);
    if (c <= 17) return c + d; if (c === 18) return B(1); if (c === 19) return N > 2 ? range(B(2), B(N - 1)) : null; if (c === 20 || c === 21) return null; if (c === 22) return B(N); return c + 2 * d; };
  const cmap = (c) => (c >= 12 ? c + d : c);
  for (const r of range(1, 53)) sh.cloneRow(r, r, tmap);
  for (const r of range(54, 75)) sh.cloneRow(r, r, cmap);
  for (const r of range(76, 140)) sh.cloneRow(r, r, (c) => c);
  // columns: IS block + BS block widths
  const colsXml = [`<col min="1" max="1" width="4.58203125" customWidth="1"/>`, `<col min="2" max="2" width="1.58203125" customWidth="1"/>`, `<col min="3" max="3" width="14" customWidth="1"/>`,
    `<col min="4" max="${G(N)}" width="${N > 5 ? 12 : 14}" customWidth="1"/>`, `<col min="${G(N) + 1}" max="${G(N) + 2}" width="1.58203125" customWidth="1"/>`,
    `<col min="${BL}" max="${BL}" width="26" customWidth="1"/>`, `<col min="${BL + 1}" max="${BL + 1}" width="2" customWidth="1"/>`, `<col min="${BU}" max="${B(N)}" width="${N > 5 ? 12 : 14}" customWidth="1"/>`, `<col min="${B(N) + 1}" max="${B(N) + 1}" width="1.58203125" customWidth="1"/>`,
    `<col min="${B(N) + 2}" max="${B(N) + 3}" width="12.58203125" hidden="1" customWidth="1" outlineLevel="1"/>`, `<col min="${B(N) + 4}" max="16384" width="11"/>`];
  sh.cols = `<cols>${colsXml.join("")}</cols>`;
  const CHK = X.eChk;
  const set = (r, c, v, s) => sh.set(r, c, v, s), A = (r, c) => a1(r, c);
  const FC = (k) => X.fF(k), FIN = (r, c) => `Financials!${a1(r, c)}`;
  set(2, 2, f('SUBSTITUTE(Title!$B$4,CHAR(10)," · ")')); set(2, CHK, "Checks"); set(3, CHK, f(`SUM(${A(5, CHK)}:${A(141, CHK + 1)})`), S.chkSum);
  set(5, 3, "Financial Summary"); set(6, 3, f(`"All amounts in "&Assumptions!$G$${RA.ccy}`));
  set(7, 1, 1);
  // income statement block (F = last actual, G.. = forecast)
  const isCols = [[6, 13], ...range(1, N).map((k) => [G(k), FC(k)])];
  set(7, 3, f(`Financials!C${RF.yr}`)); set(7, 5, f(`Financials!G${RF.yr}`)); set(8, 3, f(`Financials!C${RF.idx}`));
  isCols.forEach(([c, fc]) => { set(7, c, f(FIN(RF.yr, fc)), c === 6 ? S.hdrYearA : undefined); set(8, c, f(FIN(RF.idx, fc))); });
  const isRows = [[10, RF.rev], [11, RF.g], [13, RF.dc], [15, RF.gpm], [17, RF.opex], [19, RF.m], [21, RF.dep], [22, RF.extra], [24, RF.ebitm], [26, RF.int], [27, RF.tax], [29, RF.nim], [32, RF.revIc], [33, RF.roic], [34, RF.roa], [35, RF.roe]];
  isRows.forEach(([r, fr]) => { set(r, 3, f(`Financials!C${fr}`)); set(r, 5, f(`Financials!G${fr}`)); isCols.forEach(([c, fc]) => set(r, c, f(FIN(fr, fc)))); });
  [[14, RF.gp], [18, RF.ebitda], [23, RF.ebit], [28, RF.ni]].forEach(([r, fr]) => { set(r, 3, f(`Financials!C${fr}`)); set(r, 5, f(`Financials!G${fr}`)); });
  isCols.forEach(([c]) => {
    set(14, c, f(`${A(10, c)}+${A(13, c)}`)); set(18, c, f(`${A(14, c)}+${A(17, c)}`)); set(23, c, f(`${A(18, c)}+${A(21, c)}`)); set(28, c, f(`${A(23, c)}+${A(22, c)}+${A(26, c)}+${A(27, c)}`));
  });
  set(31, 3, "Profitability & Efficiency");
  // cash flow block (forecast years)
  set(39, 3, f(`Financials!C${RF.cfHdr}`)); set(39, 5, "Unit"); set(40, 3, f("C8"));
  isCols.forEach(([c]) => { set(39, c, f(A(7, c)), c === 6 ? S.hdrYearA : undefined); set(40, c, f(A(8, c))); });
  [[42, RF.cfo], [43, RF.cfi], [44, RF.cff]].forEach(([r, fr]) => { set(r, 3, f(`Financials!C${fr}`)); set(r, 5, f(`Financials!G${fr}`)); for (let k = 1; k <= N; k++) set(r, G(k), f(FIN(fr, FC(k)))); set(r, 6, null); });
  set(45, 3, f(`Financials!C${RF.dCash}`)); set(45, 5, f(`Financials!G${RF.dCash}`)); for (let k = 1; k <= N; k++) set(45, G(k), f(`SUM(${A(42, G(k))}:${A(44, G(k))})`)); set(45, 6, null);
  set(47, 3, "Financial Ratios");
  [[48, RF.intCov], [49, RF.dsc]].forEach(([r, fr]) => { set(r, 3, f(`Financials!C${fr}`)); set(r, 5, f(`Financials!G${fr}`)); isCols.forEach(([c, fc]) => set(r, c, f(FIN(fr, fc)))); });
  set(51, 3, "Check"); isCols.forEach(([c, fc]) => set(51, c, f(`ROUND(${A(28, c)}-${FIN(RF.ni, fc)},6)`)));
  // balance sheet block
  const bsCols = [[BQ, 13], ...range(1, N).map((k) => [B(k), FC(k)])];
  set(7, BL, f(`Financials!C${RF.bsHdr}`)); set(7, BU, f("E7")); set(8, BL, f("C8"));
  bsCols.forEach(([c, fc]) => { set(7, c, f(FIN(RF.yr, fc)), c === BQ ? S.hdrYearA : undefined); set(8, c, f(FIN(RF.idx, fc))); });
  const bsRows = [[10, RF.cash], [11, RF.rec], [12, RF.inv], [13, RF.oca], [16, RF.nfa], [17, RF.nca], [21, RF.stp], [22, RF.pay], [23, RF.ocl], [26, RF.oltl], [27, RF.debt], [30, RF.eq], [36, RF.cashR], [37, RF.quick], [38, RF.curR],
    [41, RF.debtEbitda], [42, RF.eqPct], [43, RF.de], [46, RF.noplat], [47, RF.roic], [48, RF.roa], [49, RF.roe]];
  bsRows.forEach(([r, fr]) => { set(r, BL, f(`Financials!C${fr}`)); set(r, BU, f(`Financials!G${fr}`)); bsCols.forEach(([c, fc]) => set(r, c, f(FIN(fr, fc)))); });
  [[14, RF.ca], [19, RF.assets], [24, RF.stl], [28, RF.ltl], [32, RF.le]].forEach(([r, fr]) => { set(r, BL, f(`Financials!C${fr}`)); set(r, BU, f(`Financials!G${fr}`)); });
  bsCols.forEach(([c]) => {
    set(14, c, f(`SUM(${A(10, c)}:${A(13, c)})`)); set(19, c, f(`SUM(${A(17, c)},${A(14, c)})`)); set(24, c, f(`SUM(${A(21, c)}:${A(23, c)})`));
    set(28, c, f(`SUM(${A(26, c)}:${A(27, c)})`)); set(32, c, f(`SUM(${A(30, c)},${A(28, c)},${A(24, c)})`));
  });
  set(34, BL, "Financial Ratios"); set(35, BL, f(`Financials!C${RF.liqHdr}`)); set(40, BL, f(`Financials!C${RF.bankHdr}`)); set(45, BL, f(`Financials!C${RF.profHdr}`));
  set(51, BL, "Check BS"); set(52, BL, "Check CF"); set(53, BL, "Check Cash");
  bsCols.forEach(([c], j) => set(51, c, f(`ROUND(${A(19, c)}-${A(32, c)},6)`)));
  for (let k = 1; k <= N; k++) {
    const c = B(k), ic = G(k);
    set(52, c, f(`ROUND(SUM(${A(42, ic)}:${A(44, ic)})-${A(45, ic)},6)`));
    set(53, c, f(`ROUND(${A(10, c - 1)}+${A(45, ic)}-${A(10, c)},6)`));
  }
  set(51, CHK, f(`SUM(${A(51, 6)}:${A(51, B(N))})`), S.chkSum); set(52, CHK, f(`SUM(${A(52, 6)}:${A(52, B(N))})`), S.chkSum); set(53, CHK, f(`SUM(${A(53, 6)}:${A(53, B(N))})`), S.chkSum);
  // chart captions
  set(55, 3, "Profitability"); set(55, BL, "Balance Sheet"); set(56, 3, f(`Assumptions!$G$${RA.ccy}`)); set(56, 11, "%"); set(56, BL, f(`Assumptions!$G$${RA.ccy}`));
  set(72, 4, f(`Financials!C${RF.chRev}`)); set(72, 7, f(`Financials!C${RF.chNi}`)); set(72, 10, f(`Financials!C${RF.chRoic}`));
  set(73, 4, f(`Financials!C${RF.chEbitda}`)); set(73, 7, f(`Financials!C${RF.chM}`));
  set(73, 15 + d, f(`Financials!C${RF.chNwc}`)); set(73, 18 + d, f(`Financials!C${RF.chFa}`)); set(73, 21 + d, f(`Financials!C${RF.chCash}`));
  // DCF valuation summary
  set(77, 3, "DCF Valuation Summary"); set(78, 3, f(`"All amounts in "&Assumptions!$G$${RA.ccy}`));
  set(79, 1, f("A7+1")); set(79, 3, "Free Cash Flow Forecast"); set(79, 14, "DCF Valuation Result");
  set(80, 3, f(`Assumptions!$G$${RA.ccy}`)); set(80, 19, "Composition of Enterprise Value");
  set(81, 14, "Selected TV Model");
  set(81, 16, X.selectedTv, S.sel);
  set(81, 19, f(`Assumptions!$G$${RA.ccy}`));
  set(82, 14, f(`Assumptions!C${RA.waccUsed}`)); set(82, 16, "%"); set(82, 17, f(`Assumptions!G${RA.waccUsed}`), S.pct2Link);
  set(84, 14, f(`"DCF Valuation Result @"&FIXED(Assumptions!$G$${RA.waccUsed}*100,2)&"% "&Assumptions!$C$${RA.waccLink}`));
  set(85, 17, f(`DCF!M${RD.resHdr}`));
  [[86, RD.rPvTv], [87, RD.rPvF], [88, RD.ev], [89, RD.debt], [90, RD.cash], [91, RD.eqv]].forEach(([r, dr]) => {
    set(r, 14, f(`DCF!C${dr}`)); set(r, 16, f(`Assumptions!$G$${RA.ccy}`)); set(r, 17, f(`DCF!M${dr}`)); set(r, 18, r === 88 ? f("SUM(R86:R87)") : f(`IFERROR(Q${r}/Q$88,0)`));
  });
  sh.cloneRow(92, 91, (c) => (c >= 14 && c <= 18 ? c : null)); sh.cloneRow(93, 90, (c) => (c >= 14 && c <= 18 ? c : null));
  set(92, 14, f(`DCF!C${RD.ps}`)); set(92, 16, f(`Assumptions!E${RA.price}`)); set(92, 17, f(`DCF!M${RD.ps}`), S.pxB); set(92, 18, f(`DCF!M${RD.up}`), S.upPctB);
  set(93, 14, f(`DCF!C${RD.px}`)); set(93, 16, f(`Assumptions!E${RA.price}`)); set(93, 17, f(`DCF!M${RD.px}`), S.pxLink); set(93, 18, null);
  set(94, 14, f(`DCF!C${RD.mHdr}`)); set(94, 17, f(`DCF!N${RD.mHdr}`)); set(94, 18, f(`DCF!R${RD.mHdr}`));
  [[95, RD.mRev], [96, RD.mEbitda], [97, RD.mEbit], [98, RD.mPe], [99, RD.mPb]].forEach(([r, dr]) => { set(r, 14, f(`DCF!C${dr}`)); set(r, 16, f(`DCF!H${dr}`)); set(r, 17, f(`DCF!N${dr}`)); set(r, 18, f(`DCF!R${dr}`)); });
  set(100, 4, f(`Financials!C${RF.chFcf}`)); set(100, 7, f(`Financials!C${RF.chTv}`)); set(100, 10, f(`Financials!C${RF.chDcf}`));
  set(103, 3, "Terminal Value Models"); set(104, 3, f(`Assumptions!$G$${RA.ccy}`));
  set(133, 4, f(`Financials!C${RF.chTvFlag}`)); set(134, 4, f(`Financials!C${RF.chPvFlag}`));
  [[133, 6, 0], [134, 6, 1], [133, 8, 2], [134, 8, 3], [133, 12, 4], [134, 12, 5], [133, 17, 6], [134, 17, 7], [133, 21, 8], [134, 21, 9]].forEach(([r, c, k]) => set(r, c, f(`Financials!C${RF.chTv0 + k}`)));
  sh.merge("P81:R81");
  X.execShift = d;
}

/* ═══════════════════════════════ PACKAGE PATCHES ═══════════════════════════════ */
async function patchPackage(X) {
  const wb = X.wb, N = X.N, d = N - 5;
  // 1) charts: re-point ranges to the horizon, drop cached values
  const F1 = CN(X.fF(1)), FN = CN(X.fLast), FT = CN(X.fLast + 1), LS = CN(X.vdLastStage), osEnd = X.osLastRow;
  const rules = {
    1: [], 2: [[/Financials!\$O\$(\d+):\$S\$(\d+)/g, (m, a, b) => `Financials!$${F1}$${a}:$${FN}$${b}`]],
    3: [[/Financials!\$O\$(\d+):\$S\$(\d+)/g, (m, a, b) => `Financials!$${F1}$${a}:$${FN}$${b}`]],
    4: [[/\$(C|O|P|Q)\$221:\$\1\$230/g, (m, c) => `$${c}$221:$${c}$231`]],
    5: [[/Financials!\$M\$(\d+):\$S\$(\d+)/g, (m, a, b) => `Financials!$${F1}$${a}:$${FT}$${b}`]],
    6: [], 7: [[/\$(M|N|O|P)\$91:\$\1\$96/g, (m, c) => `$${c}$91:$${c}$${osEnd}`]],
    8: [[/\$(C|H|J)\$126:\$\1\$135/g, (m, c) => `$${c}$126:$${c}$136`]],
    9: [[/\$N\$(\d+):\$AV\$(\d+)/g, (m, a, b) => `$N$${a}:$${LS}$${b}`]],
  };
  for (const [n, rs] of Object.entries(rules)) {
    const path = `xl/charts/chart${n}.xml`; let x = await wb.text(path); if (!x) continue;
    x = x.replace(/<c:f>([^<]*)<\/c:f>/g, (m, ref) => { let r = ref.replace(/&apos;/g, "'"); for (const [re, fn] of rs) r = r.replace(re, fn); return `<c:f>${xmlEsc(r).replace(/&quot;/g, '"')}</c:f>`; });
    x = x.replace(/<c:numCache>[\s\S]*?<\/c:numCache>/g, "").replace(/<c:strCache>[\s\S]*?<\/c:strCache>/g, "");
    wb.put(path, x);
  }
  // 2) Executive Summary drawings / controls: the balance-sheet chart area moves with the BS table
  if (d !== 0) {
    const shiftAnchor = (xml) => xml.replace(/<xdr:from><xdr:col>(\d+)<\/xdr:col>([\s\S]*?)<xdr:row>(\d+)<\/xdr:row>([\s\S]*?)<\/xdr:from><xdr:to><xdr:col>(\d+)<\/xdr:col>([\s\S]*?)<\/xdr:to>/g,
      (m, c1, a, r1, b, c2, rest) => (+c1 >= 11 && +r1 < 76 ? `<xdr:from><xdr:col>${+c1 + d}</xdr:col>${a}<xdr:row>${r1}</xdr:row>${b}</xdr:from><xdr:to><xdr:col>${+c2 + d}</xdr:col>${rest}</xdr:to>` : m));
    let dr = await wb.text("xl/drawings/drawing1.xml"); wb.put("xl/drawings/drawing1.xml", shiftAnchor(dr));
    const es = wb.sheet(SN.exec);
    es.xml = es.xml.replace(/<from><xdr:col>(\d+)<\/xdr:col>([\s\S]*?)<xdr:row>(\d+)<\/xdr:row>([\s\S]*?)<\/from><to><xdr:col>(\d+)<\/xdr:col>/g,
      (m, c1, a, r1, b, c2) => (+c1 >= 11 && +r1 < 76 ? `<from><xdr:col>${+c1 + d}</xdr:col>${a}<xdr:row>${r1}</xdr:row>${b}</from><to><xdr:col>${+c2 + d}</xdr:col>` : m));
    let vml = await wb.text("xl/drawings/vmlDrawing1.vml");
    vml = vml.replace(/<x:Anchor>\s*([^<]*)<\/x:Anchor>/g, (m, s) => { const v = s.split(",").map((t) => +t.trim()); if (v[0] >= 11 && v[2] < 76) { v[0] += d; v[4] += d; } return `<x:Anchor>\n    ${v.join(", ")}</x:Anchor>`; });
    wb.put("xl/drawings/vmlDrawing1.vml", vml);
  }
  // 3) list validations living in extLst (x14)
  const es = wb.sheet(SN.exec), vd = wb.sheet(SN.vd2);
  es.xml = es.xml.replace(/Assumptions!\$K\$67:\$K\$76/g, () => `Assumptions!$K$${RA.tv0}:$K$${RA.tv0 + 10}`);
  vd.xml = vd.xml.replace(/Assumptions!\$R\$86:\$R\$88/g, () => `Assumptions!$R$${RA.sel.steady}:$R$${RA.sel.jump}`);
  // 4) Financials sparklines, regenerated for the horizon
  const fs_ = wb.sheet(SN.fin);
  fs_.xml = fs_.xml.replace(/(<x14:sparklineGroups[^>]*>)[\s\S]*?(<\/x14:sparklineGroups>)/, (m, open, close) => {
    const proto = /<x14:sparklineGroup [\s\S]*?<x14:sparklines>/.exec(m)[0];
    const groups = X.sparkRows.map((r) => `${proto}<x14:sparkline><xm:f>Financials!K${r}:${FN}${r}</xm:f><xm:sqref>I${r}</xm:sqref></x14:sparkline></x14:sparklines></x14:sparklineGroup>`);
    return open + groups.join("").replace(/ xr2:uid="\{[^}]*\}"/g, "") + close;
  });
  // 5) the template vendor's logo drawings and web links are not carried into M-Terminal's model
  for (const [name, rel] of [[SN.ass, "drawing2"], [SN.dcf, "drawing3"]]) {
    const sh = wb.sheet(name);
    let rels = await wb.text(sh.relsPath);
    const m = new RegExp(`<Relationship Id="([^"]+)" Type="[^"]*/drawing" Target="../drawings/${rel}.xml"/>`).exec(rels);
    if (m) { sh.xml = sh.xml.replace(`<drawing r:id="${m[1]}"/>`, ""); rels = rels.replace(m[0], ""); }
    rels = rels.replace(/<Relationship Id="[^"]+" Type="[^"]*\/hyperlink" Target="http:\/\/www\.efinancialmodels\.com\/" TargetMode="External"\/>/g, "");
    wb.put(sh.relsPath, rels);
    wb.remove(`xl/drawings/${rel}.xml`); wb.remove(`xl/drawings/_rels/${rel}.xml.rels`);
  }
  {
    const sh = wb.sheet(SN.fin); let rels = await wb.text(sh.relsPath);
    rels = rels.replace(/<Relationship Id="[^"]+" Type="[^"]*\/hyperlink" Target="http:\/\/www\.efinancialmodels\.com\/" TargetMode="External"\/>/g, ""); wb.put(sh.relsPath, rels);
  }
  // no image part is referenced by anything but the removed logo drawings → keep image1 out
  wb.remove("xl/media/image1.png");
  // 6) document properties
  let core = await wb.text("docProps/core.xml");
  if (core) {
    core = core.replace(/<dc:creator>[^<]*<\/dc:creator>/, "<dc:creator>M-Terminal Modeling Lab</dc:creator>").replace(/<cp:lastModifiedBy>[^<]*<\/cp:lastModifiedBy>/, "<cp:lastModifiedBy>M-Terminal</cp:lastModifiedBy>");
    core = core.replace(/<dc:title>[^<]*<\/dc:title>/, "");
    core = core.replace("</cp:coreProperties>", `<dc:title>${xmlEsc(X.p.meta.symbol + " DCF Valuation Model")}</dc:title></cp:coreProperties>`);
    wb.put("docProps/core.xml", core);
  }
  const app = await wb.text("docProps/app.xml");
  if (app) wb.put("docProps/app.xml", app.replace(/<HeadingPairs>[\s\S]*?<\/HeadingPairs>/, "").replace(/<TitlesOfParts>[\s\S]*?<\/TitlesOfParts>/, "").replace(/<Company>[^<]*<\/Company>/, "<Company>M-Terminal</Company>"));
}

module.exports = { buildTitle, buildTerms, buildExec, patchPackage };
