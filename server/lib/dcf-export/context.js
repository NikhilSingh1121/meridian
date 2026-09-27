/**
 * Shared context for the template DCF workbook: units, the historical columns, the per-year
 * driver inputs the engine used, sheet names, fixed row layouts, style roles and A1 helpers.
 *
 * Layout convention (all template sheets keep the template's row structure; only the year
 * columns change with the forecast horizon N = the website's 3/5/7/10 selection):
 *   Assumptions   hist M,N,O · forecast P … (15+N)
 *   Financials    hist K,L,M · forecast N … (13+N) · total (15+N)
 *   DCF           base M · forecast N … (13+N)
 *   2-Stage VD    base M · forecast N … (13+N) · competitive-advantage years after
 */
const { colName, a1, sref } = require("../xlsx-tpl");

const SN = {
  title: "Title", terms: "Terms", exec: "Executive Summary", ass: "Assumptions", fin: "Financials", dcf: "DCF",
  tv: "Terminal Value", vd2: "Two Stage Value Driver Model",
  sens: "Sensitivity", scen: "Scenarios", rev: "Reverse DCF", torn: "Tornado", comps: "Comparable Companies",
  val: "Valuation Methods", mc: "Monte Carlo", rat: "Assumption Rationale", chk: "Checks",
};
/* the analysis sheets that drive the model through data tables — each keeps its flex cells in
   column D at these rows (percentage points; all zero unless a data table is substituting) */
const FLEX = { g: 9, m: 10, tilt: 11, mrel: 12, cap: 13, tax: 14, wc: 15, w: 16, tg: 17, gmc: 18 };
const FLEX_SHEETS = [SN.sens, SN.scen, SN.rev, SN.torn, SN.mc];
const FLEX_LABEL = {
  g: "Revenue growth shift (pp; tapers to 0 by the last year on a plan)", m: "EBITDA margin shift (pp, every year)",
  tilt: "EBITDA margin tilt (pp, ramps in linearly to the last year)", mrel: "EBITDA margin shock (% relative)",
  cap: "Capex % of revenue shift (pp)", tax: "Tax rate shift (pp)", wc: "Incremental NWC % shift (pp)",
  w: "WACC shift (pp)", tg: "Terminal growth shift (pp)", gmc: "Revenue growth shock (pp, tapers to 0 — Monte Carlo)",
};

/* ── Assumptions rows ── */
const RA = {
  yr: 7, idx: 8,
  // left block (C label · E unit · G value)
  genHdr: 7, model: 9, project: 10, version: 11, settings: 13, ccy: 14, ffy: 15, horizon: 16, other: 17,
  price: 18, intRate: 19, taxStat: 20, payout: 21, shares: 22,
  nwcHdr: 23, recD: 24, invD: 25, payD: 26, ocaP: 27, oclP: 28, nwcImpl: 29,
  waccHdr: 31, wHdr: 33, we: 34, wd: 35, wt: 36, keHdr: 38, rf: 39, bu: 40, bl: 41, mrp: 42, erp: 43, prem: 44, ke: 45,
  kdHdr: 47, rf2: 48, drp: 49, kdPre: 50, kdTax: 51, kdPost: 52, wacc: 54,
  dcfHdr: 57, disc: 59, waccLink: 60, waccUsed: 61,
  chkHdr: 63, chk0: 65,
  // right block (K label · L unit · M..O hist · P.. forecast)
  isHdr: 10, rev: 12, g: 13, dc: 15, gp: 16, gpm: 17, opex: 19, ebitda: 20, m: 21, mUsed: 22, dep: 23, depPct: 24,
  extra: 25, int: 26, tax: 27, taxRate: 28, ni: 29, nim: 30,
  bsHdr: 32, cash: 34, rec: 35, inv: 36, oca: 37, ca: 38, nfa: 40, onca: 41, nca: 42, assets: 44,
  stp: 46, pay: 47, ocl: 48, stl: 49, oltl: 51, debt: 52, ltl: 53, eq: 55, le: 57,
  cfHdr: 59, capexPct: 61, capex: 62, dDebt: 63, wcPct: 64,
  tvHdr: 66, tvHead: 68, tv0: 69,        // 11 terminal-value methods: rows 69–79
  // terminal-value assumptions (template rows 79–100, +3)
  tvaHdr: 82, capHdr: 84, capRate: 85, gorHdr: 87, gorW: 88, gT: 89, hHdr: 91, hHigh: 92, hLow: 93, hPeriod: 94,
  exHdr: 96, exLbl: 97, exRev: 98, exEbitda: 99, exEbit: 100, exPe: 101, exPb: 102,
  os: { hdr: 84, w: 85, spread: 86, roic: 87, g: 88 },
  ts: { hdr: 90, stages: 91, timeline: 93, dur: 94, start: 95, end: 96, w: 97, vd: 99, g: 100, spread: 101, roic: 102, curve: 103 },
  sel: { hdr: 82, discHdr: 84, mid: 85, end: 86, roceHdr: 88, steady: 89, expo: 90, jump: 91, linksHdr: 94, link0: 95 },
  vdf: { hdr: 105, years: 106, ronic: 107, g: 108 },
  flexHdr: 110, flexNote: 111, flex0: 112,  // one row per FLEX key, in FLEX order
  planFlag: 123, taperNote: 124,
};
/* ── Financials rows ── */
const RF = {
  yr: 7, idx: 8, rev: 10, g: 11, dc: 13, gp: 14, gpm: 15, opex: 17, ebitda: 18, m: 19, dep: 21, ebit: 22, ebitm: 23,
  extra: 25, int: 26, ebt: 27, ebtm: 28, tax: 30, ni: 31, nim: 32, niChk: 33,
  bsAmt: 37, bsHdr: 38, bsIdx: 39, cash: 41, rec: 42, inv: 43, oca: 44, ca: 45, nfa: 47, onca: 48, nca: 49, assets: 51,
  stp: 53, pay: 54, ocl: 55, stl: 56, oltl: 58, debt: 59, ltl: 60, eq: 62, le: 64, bsChk: 65,
  cfAmt: 70, cfHdr: 71, cfIdx: 72, cfoHdr: 74, cNi: 75, cDep: 76, cRec: 77, cInv: 78, cOca: 79, cStp: 80, cPay: 81, cOcl: 82, cfo: 83,
  cfiHdr: 85, cCapex: 86, cfi: 87, cffHdr: 89, cOltl: 90, cDebt: 91, cDiv: 92, cff: 93, dCash: 95, cash0: 97, cash1: 98, cashChk: 99,
  ratHdr: 103, ratAmt: 104, ratHdr2: 105, ratIdx: 106, days: 107,
  bankHdr: 109, debtEbitda: 110, intCov: 111, dsc: 112, eqPct: 113, de: 114, intRate: 115,
  liqHdr: 117, cashR: 118, quick: 119, curR: 120,
  grHdr: 122, grRev: 123, grGp: 124, grEbitda: 125, grEbit: 126, grNi: 127, grAssets: 128, grEq: 129,
  profHdr: 131, noplat: 132, revIc: 133, roic: 134, roa: 135, roe: 136, revAssets: 138,
  effHdr: 140, recDays: 141, invDays: 142, payDays: 143, ccc: 144, taxRate: 145,
  ebsHdr: 147, eEq: 148, eOltl: 149, eDebt: 150, eCash: 151, ic: 152, eNwc: 154, eFa: 155, ce: 156, icChk: 157,
  nwcHdr: 159, nRec: 160, nInv: 161, nOca: 162, nStp: 163, nPay: 164, nOcl: 165, nwc: 166, nwcChk: 167,
  faAmt: 170, faHdr: 171, faIdx: 172, faDepPct: 174, faCapex: 176, faOpen: 178, faAdd: 179, faDep: 180, faClose: 181,
  faDepLine: 185, faGross: 187, faAcc: 188, faNet: 189,
  chAmt: 194, chHdr: 195, chIdx: 196, chRevHdr: 198, chRev: 199, chEbitda: 200, chM: 201, chNi: 202, chRoic: 203,
  chBsHdr: 205, chNwc: 206, chFa: 207, chCash: 208, chFcfHdr: 210, chFcf: 211, chTv: 212, chDf: 213, chDcf: 214,
  chSel: 216, chTvHdr: 217, chTvFlag: 218, chPvFlag: 219, chTv0: 221,   // 11 rows: 221–231
};
/* ── DCF rows ── */
const RD = {
  hdr: 5, amt: 6, yr: 7, idx: 8, w: 10, method: 11, mid: 12, end: 13, sel: 15,
  fHdr: 17, ebit: 18, tax: 19, dep: 20, nwc: 21, capex: 22, fcff: 23, nopat: 24,
  vHdr: 27, vAmt: 28, vYr: 29, vIdx: 30, vFcff: 32, vTv: 33, vTot: 34, period: 35, df: 37, pvF: 39, pvTv: 40, pvTot: 41,
  resHdr: 45, rPvTv: 46, rPvF: 47, ev: 48, debt: 49, cash: 50, eqv: 51, shares: 52, ps: 53, px: 54, up: 55, psTable: 56,
  mHdr: 58, mRev: 59, mEbitda: 60, mEbit: 61, mPe: 62, mPb: 63,
};
/* ── Terminal Value rows (template) ── */
const RT = {
  capHdr: 7, capEbit: 12, capTaxR: 13, capTax: 14, capNopat: 15, capW: 17, capTv: 18,
  gorHdr: 24, gorFcf: 34, gorW: 35, gorG: 36, gorTv: 37,
  hHdr: 43, hFcf: 56, hW: 57, hHigh: 58, hLow: 59, hPer: 60, hStart: 61, hStartL: 62, hTv: 64,
  exHdr: 70, ex0: 74,  // 5 rows 74–78
  osHdr: 84, osTbl: 91, osW: 100, osSpread: 101, osRoic: 102, osIc: 103, osNopat: 104, osG: 105, osTv: 106,
  tsHdr: 111, tsTv: 113,
  sumHdr: 120, sum0: 126, sel: 138,     // 11 rows 126–136
  vdfHdr: 142,
};
/* ── Two Stage Value Driver rows (template) ── */
const R2 = {
  yr: 7, idx: 8, tvYr: 9, roceHdr: 11, steady: 12, expo: 13, jump: 14, roic: 15, fHdr: 17, rev: 18, g: 19, ebitda: 21, m: 22,
  dep: 24, ebit: 25, taxR: 26, tax: 27, noplat: 28, netInv: 29, fcf: 30, capex: 32, ic: 34, turn: 35,
  tvHdr: 37, fcfCap: 38, tvEnd: 39, fcfTv: 40, df: 41, v1: 43, v2: 44, vTot: 45, tv: 47,
  aHdr: 50, stage: 52, dur: 54, start: 55, end: 56, w: 57, g2: 58, spread: 59, roic2: 60, curve: 61,
  gsHdr: 64, rTvHdr: 73, rV1: 75, rV2: 76, rTv: 78, chHdr: 81, chYr: 82, chFcf: 84, chFcfG: 85, chFcf2: 86, chRoicG: 87, chRoic2: 88, chW: 89,
  CAP_YEARS: 30,
};

/* ── historical columns (last 3 fiscal years, aligned across the statements) ── */
function histYears(st) {
  const inc = st.income || [], bal = st.balance || [], cf = st.cashflow || [];
  const years = inc.map((r) => r.year).filter(Boolean).slice(-3);
  while (years.length < 3) years.unshift(null);
  return years.map((y) => y == null ? null : ({ year: y, inc: inc.find((r) => r.year === y) || {}, bal: bal.find((r) => r.year === y) || {}, cf: cf.find((r) => r.year === y) || {} }));
}

function buildContext(p, wb) {
  const idcf = p.idcf;
  const rows = idcf.base.rows;
  const N = rows.length;
  const ccy = p.meta.currency || "INR";
  const isINR = ccy === "INR";
  const scale = isINR ? 1e7 : 1e6;
  const unit = isINR ? "INR Cr" : `${ccy} Mn`;
  const sym = isINR ? "₹" : ccy === "USD" ? "$" : "";
  const d = (x) => (x == null || !isFinite(x) ? null : x / scale);
  const hist = histYears(p.statements);
  const baseYear = rows[0].year - 1;

  const S = styleRoles(wb);
  const X = {
    p, wb, idcf, rows, N, ccy, isINR, scale, unit, sym, d, hist, baseYear, SN, FLEX, FLEX_SHEETS, FLEX_LABEL, RA, RF, RD, RT, R2, S,
    planDriven: !!idcf.assumptions.planDriven,
    // column helpers
    aF: (k) => 15 + k, aH: (i) => 13 + i,            // Assumptions forecast k=1..N · hist i=0..2
    fF: (k) => 13 + k, fH: (i) => 11 + i,            // Financials
    dF: (k) => 13 + k, dBase: 13,                    // DCF
    tF: (k) => 13 + k,                               // Two-stage explicit years
    col: colName, a1,
    ref: (sheet, r, c, abs = false) => `${sref(sheet)}${a1(r, c, abs, abs)}`,
    rng: (sheet, r1, c1, r2, c2, abs = false) => `${sref(sheet)}${a1(r1, c1, abs, abs)}:${a1(r2, c2, abs, abs)}`,
  };
  X.fLast = X.fF(N); X.aLast = X.aF(N); X.dLast = X.dF(N);
  X.fTot = 15 + N; X.fChk = 18 + N;              // Financials total / check columns
  X.aChk = 18 + N;                                // Assumptions check column
  X.dChk = 21 + N - 5;                            // DCF check column
  X.flexRef = (key, abs = true) => X.ref(SN.ass, RA.flex0 + Object.keys(FLEX).indexOf(key), 7, abs);
  X.waccUsed = () => X.ref(SN.ass, RA.waccUsed, 7, true);
  X.gUsed = () => X.ref(SN.ass, RA.vdf.g, 7, true);
  return X;
}

/* ── style roles, all taken from template cells so fonts / fills / borders / formats match ── */
function styleRoles(wb) {
  const A = wb.sheet(SN.ass), F = wb.sheet(SN.fin), D = wb.sheet(SN.dcf), T = wb.sheet(SN.tv), st = wb.styles;
  const t = (sh, ref) => sh.tplStyle(ref);
  // year-index formats: "Year -2" rather than "-Year 2" for the actual columns
  st.numFmts = st.numFmts.map((x) => x.replace(/formatCode="&quot;Year &quot;#,##0"/, "formatCode=\"&quot;Year &quot;#,##0;&quot;Year &quot;\-#,##0\"").replace(/formatCode="&quot;Year &quot;0"/, "formatCode=\"&quot;Year &quot;0;&quot;Year &quot;\-0\""));
  const S = {
    title: t(F, "B2"), section: t(F, "C5"), amounts: t(F, "C6"),
    hdrBar: t(F, "C7"), hdrUnit: t(F, "G7"), hdrYearA: t(F, "K7"), hdrYearF: t(F, "O7"), badge: t(F, "A7"),
    idxLbl: t(F, "C8"), idxVal: t(F, "O8"),
    lbl: t(F, "C13"), lblB: t(F, "C14"), lblShade: t(F, "C11"), unit: t(F, "G13"), unitB: t(F, "G14"),
    num: t(A, "Q12"), numB: t(A, "Q16"), numIn: t(A, "M12"), numLinked: t(A, "P12"), numLink: t(A, "Q23"), numLinkB: t(A, "P52"),
    pct: t(A, "M13"), pctIn: t(A, "Q13"), pctLinked: t(A, "P13"), pctShade: t(F, "O11"),
    subHdr: t(A, "C33"), barHdr: t(A, "C7"), sel: t(A, "G59"), hyper: t(A, "R92"), text: t(A, "P67"),
    lLbl: t(A, "C19"), lUnit: t(A, "E19"), lPctIn: t(A, "G19"), lPct: t(A, "G35"), lPctB: t(A, "G45"), lNum: t(A, "G41"), lNumIn: t(A, "G18"),
    lLblB: t(A, "C36"), lInText: t(A, "G14"),
    chkVal: t(F, "K33"), chkSum: t(F, "X33"), chkLbl: t(F, "C33"),
    mult: t(F, "K110"),
    dcfHdr: t(D, "C45"), tvLbl: t(T, "C12"), tvVal: t(T, "H12"),
  };
  // derived variants (same base font/fill, different number format or colour)
  const NF2 = '_(* #,##0.00_);_(* (#,##0.00);_(* "-"??_);_(@_)';
  const NF0 = '_(* #,##0_);_(* (#,##0);_(* "-"??_);_(@_)';
  S.nf2 = NF2; S.nf0 = NF0;
  S.px = st.variant(S.num, { numFmt: NF2 });
  S.pxB = st.variant(S.numB, { numFmt: NF2 });
  S.pxIn = st.variant(S.numIn, { numFmt: NF2 });
  S.pxLink = st.variant(S.numLink, { numFmt: NF2 });
  S.pct2 = st.variant(S.pct, { numFmt: "0.00%" });
  S.pctN = st.variant(S.num, { numFmt: "0.0%" });
  S.pct2In = st.variant(S.pctIn, { numFmt: "0.00%" });
  S.pct2B = st.variant(S.pct, { numFmt: "0.00%", bold: true });
  S.pctB = st.variant(S.pct, { bold: true });
  S.pctLink = st.variant(S.numLink, { numFmt: "0.0%" });
  S.pct2Link = st.variant(S.numLink, { numFmt: "0.00%" });
  S.xIn = st.variant(S.numIn, { numFmt: "0.0x" });
  S.x = st.variant(S.num, { numFmt: "0.0x" });
  S.x2 = st.variant(S.num, { numFmt: "0.00x" });
  S.x2In = st.variant(S.numIn, { numFmt: "0.00x" });
  S.x2Link = st.variant(S.numLink, { numFmt: "0.00x" });
  S.dec = st.variant(S.num, { numFmt: "0.00" });
  S.decIn = st.variant(S.numIn, { numFmt: "0.00" });
  S.dec4In = st.variant(S.numIn, { numFmt: "0.0000" });
  S.intIn = st.variant(S.numIn, { numFmt: "0" });
  S.int = st.variant(S.num, { numFmt: "0" });
  S.numInNf2 = st.variant(S.numIn, { numFmt: NF2 });
  S.textIn = st.variant(S.numIn, { numFmt: "@", halign: "left" });
  S.textLeft = st.variant(S.num, { numFmt: "@", halign: "left" });
  S.textWrap = st.variant(S.lbl, { wrap: true, valign: "top" });
  S.note = st.variant(S.lbl, { italic: true, color: "FF7F7F7F" });
  S.noteWrap = st.variant(S.lbl, { italic: true, color: "FF7F7F7F", wrap: true, valign: "top" });
  S.lblBold = st.variant(S.lbl, { bold: true });
  S.ok = st.variant(S.num, { numFmt: "@", halign: "center", bold: true, color: "FF1E7B34" });
  S.status = st.variant(S.num, { numFmt: "@", halign: "center", bold: true });
  S.hdrText = st.variant(S.hdrUnit, { halign: "center" });
  S.hdrTextR = st.variant(S.hdrUnit, { halign: "right" });
  S.hdrNum2 = st.variant(S.hdrUnit, { numFmt: "0.00%", halign: "right" });
  S.hdrPp = st.variant(S.hdrUnit, { numFmt: '+0.00"pp";-0.00"pp";0.00"pp"', halign: "right" });
  S.pp = st.variant(S.num, { numFmt: '+0.00"pp";-0.00"pp";0.00"pp"' });
  S.ppIn = st.variant(S.numIn, { numFmt: '+0.00"pp";-0.00"pp";0.00"pp"' });
  S.upPct = st.variant(S.num, { numFmt: '+0.0%;-0.0%;0.0%' });
  S.upPctB = st.variant(S.numB, { numFmt: '+0.0%;-0.0%;0.0%' });
  S.dateIn = st.variant(S.numIn, { numFmt: "dd-mmm-yyyy" });
  S.z = st.variant(S.numIn, { numFmt: "0.0000" });
  return S;
}

module.exports = { buildContext, SN, FLEX, FLEX_SHEETS, FLEX_LABEL, RA, RF, RD, RT, R2 };
