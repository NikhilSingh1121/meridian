/**
 * Core model sheets of the template workbook: Assumptions, Financials, DCF, Terminal Value and
 * the Two Stage Value Driver Model. Every forecast cell is a formula; the only constants are
 * reported actuals, market data and the per-year driver inputs the website engine used (blue).
 *
 * The forecast reproduces analytics.institutionalDCF exactly:
 *   revenue_t   = revenue_t−1 × (1 + g_t)                   g_t = driver (+ analysis flex)
 *   EBITDA_t    = revenue_t × min(60%, max(1%, margin_t))
 *   D&A_t       = revenue_t × D&A%_t            capex_t = revenue_t × capex%_t
 *   ΔNWC_t      = (revenue_t − revenue_t−1) × NWC%_t        tax on EBIT = EBIT_t × t_t
 *   FCFF_t      = EBIT_t − tax + D&A_t − capex_t − ΔNWC_t   discounted at (1+WACC)^(t−0.5)
 *   terminal    = the selected Terminal Value model (default: the engine's value-driver fade)
 */
const { SN, FLEX, FLEX_SHEETS, FLEX_LABEL, RA, RF, RD, RT, R2 } = require("./context");
const { colName: CN, a1 } = require("../xlsx-tpl");

const range = (a, b) => { const o = []; for (let i = a; i <= b; i++) o.push(i); return o; };
const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
const pctOf = (v) => (v == null || !isFinite(v) ? null : v / 100);
const fin = (v) => v != null && isFinite(v);

/* clone template rows: list of [newRow, tplRow] with a column map; `block` limits columns */
function cloneRows(sh, list, map, block = () => true) {
  for (const [nr, tr] of list) sh.cloneRow(nr, tr, (c) => (block(c) ? map(c) : null));
}

/* ═══════════════════════════════ ASSUMPTIONS ═══════════════════════════════ */
function buildAssumptions(X) {
  const sh = X.wb.sheet(SN.ass), S = X.S, N = X.N, p = X.p, i = X.idcf, rows = X.rows, st = X.wb.styles;
  const F = X.aF, H = X.aH, L = X.aLast, CHK = X.aChk;
  const ymap = (c) => { if (c <= 15) return c; if (c === 16) return null; if (c === 17) return F(1); if (c === 18) return N > 2 ? range(F(2), F(N - 1)) : null; if (c === 19 || c === 20) return null; if (c === 21) return F(N); return c + N - 6; };
  const idmap = (c) => (c >= 22 ? c + N - 6 : c);
  const LEFT = (c) => c <= 8, RIGHT = (c) => c >= 9;
  sh.remapCols(ymap);
  // header rows 2–11 (both blocks)
  cloneRows(sh, [[2, 2], [3, 3], [5, 5], [6, 6], [7, 7], [8, 8], [9, 9], [10, 10], [11, 11]], ymap);
  // left block
  cloneRows(sh, [[13, 13], [14, 14], [15, 15], [16, 15], [17, 17], [18, 18], [19, 19], [20, 20], [21, 21], [22, 18], [23, 23], [24, 24], [25, 25], [26, 26], [27, 27], [28, 28], [29, 28],
    [31, 31], [33, 33], [34, 34], [35, 35], [36, 36], [38, 38], [39, 39], [40, 40], [41, 41], [42, 42], [43, 43], [44, 44], [45, 45], [47, 47], [48, 48], [49, 49], [50, 50], [51, 51], [52, 52], [54, 54],
    [57, 57], [59, 59], [60, 60], [61, 60], [63, 63], ...range(65, 78).map((r) => [r, 65])], ymap, LEFT);
  // right block (year columns)
  cloneRows(sh, [[12, 12], [13, 13], [15, 15], [16, 16], [17, 17], [19, 19], [20, 20], [21, 21], [22, 28], [23, 23], [24, 17], [25, 24], [26, 25], [27, 26], [28, 17], [29, 27], [30, 28],
    [32, 30], [34, 32], [35, 33], [36, 34], [37, 35], [38, 36], [40, 38], [41, 38], [42, 39], [44, 41], [46, 43], [47, 44], [48, 45], [49, 46], [51, 48], [52, 49], [53, 50], [55, 52], [57, 54],
    [59, 56], [61, 17], [62, 58], [63, 59], [64, 17]], ymap, RIGHT);
  for (let r = 12; r <= 64; r++) { if (!sh.rows.has(r) || ![...sh.rows.get(r).keys()].some((c) => c >= 9)) sh.cloneRow(r, 14, (c) => (c >= 9 ? ymap(c) : null)); }
  for (let r = 12; r <= 61; r++) { if (!sh.rows.has(r) || ![...sh.rows.get(r).keys()].some((c) => c <= 8)) sh.cloneRow(r, 12, (c) => (c <= 8 ? c : null), { attrs: false }); }
  cloneRows(sh, [[66, 62], [68, 64], ...range(69, 79).map((r) => [r, Math.min(76, r - 2)])], idmap, RIGHT);
  // terminal-value assumptions, selectors and links (template rows 79–100 → 82–103)
  cloneRows(sh, range(79, 100).map((r) => [r + 3, r]), idmap);
  cloneRows(sh, [[105, 81], [106, 91], [107, 89], [108, 85], [110, 57], [111, 17], ...range(112, 121).map((r) => [r, 85]), [123, 91], [124, 17]], idmap, LEFT);

  const set = (r, c, v, s) => sh.set(r, c, v, s);
  const f = (x) => ({ f: x });
  const A = (r, c, ar, ac) => a1(r, c, ar, ac);
  const FX = (k) => X.flexRef(k);
  const fin0 = (v) => (fin(v) ? v : 0);

  // ── titles ──
  set(2, 3, f('SUBSTITUTE(Title!$B$4,CHAR(10)," · ")'));
  set(2, CHK, "Check"); set(3, CHK, f(`SUM(${A(4, CHK)}:${A(200, CHK)})`));
  set(5, 3, "Assumptions"); set(6, 3, f(`"All amounts in "&$G$${RA.ccy}`));
  // ── left block: general settings ──
  set(RA.genHdr, 3, "General Settings");
  set(RA.model, 3, "Valuation Model"); set(RA.model, 5, "M-Terminal DCF Valuation Model"); sh.merge(`E${RA.model}:G${RA.model}`);
  set(RA.project, 3, "Company (ticker)"); set(RA.project, 5, p.meta.symbol); sh.merge(`E${RA.project}:G${RA.project}`);
  set(RA.version, 3, "Model Version"); set(RA.version, 5, `${String(p.meta.builtAt).slice(0, 10)} · ${p.meta.modelStatus}`, S.lInText);
  set(RA.settings, 3, "Settings");
  set(RA.ccy, 3, "Currency / unit"); set(RA.ccy, 7, X.unit, S.lInText);
  set(RA.ffy, 3, "First Forecast Year"); set(RA.ffy, 5, "Year"); set(RA.ffy, 7, rows[0].year, S.intIn);
  set(RA.horizon, 3, "Forecast horizon"); set(RA.horizon, 5, "Years"); set(RA.horizon, 7, N, S.int);
  set(RA.other, 3, "Other Assumptions");
  set(RA.price, 3, "Current share price"); set(RA.price, 5, X.ccy); set(RA.price, 7, fin0(i.currentPrice), S.pxIn);
  const lastDebt = X.d((i.netDebt || 0) + ((X.hist[2] && X.hist[2].bal.cash) || 0));
  const lastInt = X.hist[2] && X.hist[2].inc.interest != null ? X.d(Math.abs(X.hist[2].inc.interest)) : null;
  const prevDebt = X.hist[1] ? X.d(X.hist[1].bal.totalDebt) : null;
  let rate = lastInt != null && lastDebt > 0 ? lastInt / ((fin(prevDebt) ? (prevDebt + lastDebt) / 2 : lastDebt)) : null;
  if (!fin(rate) || rate <= 0 || rate > 0.25) rate = pctOf(i.waccBuild.costDebtPre);
  set(RA.intRate, 3, "Interest rate on financial debt"); set(RA.intRate, 5, "%"); set(RA.intRate, 7, rate, S.lPctIn);
  set(RA.taxStat, 3, "Statutory tax rate (cost of debt)"); set(RA.taxStat, 5, "%"); set(RA.taxStat, 7, pctOf(i.waccBuild.kdTax), S.lPctIn);
  const vi = p.valInputs || {};
  const lastCf = X.hist[2] ? X.hist[2].cf : {}, lastInc = X.hist[2] ? X.hist[2].inc : {};
  let payout = fin(vi.payout) ? vi.payout : lastCf.dividends && lastInc.netIncome > 0 ? lastCf.dividends / lastInc.netIncome : 0.3;
  payout = Math.max(0, Math.min(1.5, payout));
  set(RA.payout, 3, "Dividend Payout Ratio"); set(RA.payout, 5, "% of Net Income"); set(RA.payout, 7, payout, S.lPctIn);
  set(RA.shares, 3, "Shares outstanding"); set(RA.shares, 5, X.isINR ? "Cr" : "Mn"); set(RA.shares, 7, X.d(i.sharesOut), st.variant(S.lNumIn, { numFmt: "#,##0.0000" }));

  // ── working capital: incremental intensities that reproduce the engine's NWC driver ──
  // The engine: ΔNWC = Δrevenue × NWC%, NWC% = average (receivables + inventory − payables) ÷ revenue.
  // Split into days of revenue so the balance sheet carries each component.
  const nwc = nwcSplit(p, rows);
  set(RA.nwcHdr, 3, "Net Working Capital (incremental, on Δ revenue)");
  set(RA.recD, 3, "Receivables"); set(RA.recD, 5, "Days of ΔRevenue"); set(RA.recD, 7, nwc.recD, st.variant(S.lNumIn, { numFmt: "0.0" }));
  set(RA.invD, 3, "Inventory"); set(RA.invD, 5, "Days of ΔRevenue"); set(RA.invD, 7, nwc.invD, st.variant(S.lNumIn, { numFmt: "0.0" }));
  set(RA.payD, 3, "Payables"); set(RA.payD, 5, "Days of ΔRevenue"); set(RA.payD, 7, nwc.payD, st.variant(S.lNumIn, { numFmt: "0.0" }));
  set(RA.ocaP, 3, "Other Current Assets"); set(RA.ocaP, 5, "% of ΔRevenue"); set(RA.ocaP, 7, 0, S.lPctIn);
  set(RA.oclP, 3, "Other Current Liabilities"); set(RA.oclP, 5, "% of ΔRevenue"); set(RA.oclP, 7, 0, S.lPctIn);
  set(RA.nwcImpl, 3, "Implied incremental NWC"); set(RA.nwcImpl, 5, "% of ΔRevenue");
  set(RA.nwcImpl, 7, f(`($G$${RA.recD}+$G$${RA.invD}-$G$${RA.payD})/365+$G$${RA.ocaP}-$G$${RA.oclP}`), st.variant(S.lPct, { numFmt: "0.00%" }));

  // ── WACC (CAPM; the engine's inputs) ──
  const wb_ = i.waccBuild, we = (wb_.weightEquity || 100) / 100, wd = (wb_.weightDebt || 0) / 100;
  const mkt = p.plan ? p.plan.marketLabel : "";
  set(RA.waccHdr, 3, "Discount Rate Estimation - Weighted Average Cost of Capital");
  set(RA.wHdr, 3, "Weight");
  set(RA.we, 3, "Equity (market value)"); set(RA.we, 5, "%"); set(RA.we, 7, we, S.lPctIn);
  set(RA.wd, 3, "Debt (book, incl. leases)"); set(RA.wd, 5, "%"); set(RA.wd, 7, f(`1-G${RA.we}`));
  set(RA.wt, 3, "Total"); set(RA.wt, 5, "%"); set(RA.wt, 7, f(`SUM(G${RA.we}:G${RA.wd})`));
  set(RA.keHdr, 3, "Cost of Equity");
  set(RA.rf, 3, `Risk free interest rate${mkt ? ` (${mkt} 10-yr)` : ""}`); set(RA.rf, 5, "%"); set(RA.rf, 7, pctOf(wb_.rf), S.pct2In);
  set(RA.bu, 3, "Beta (unlevered)"); set(RA.bu, 5, "x"); set(RA.bu, 7, wb_.beta / (1 + (we > 0 ? wd / we : 0)), S.dec4In);
  set(RA.bl, 3, "Beta (levered)"); set(RA.bl, 5, "x"); set(RA.bl, 7, f(`IFERROR(G${RA.bu}*(1+G${RA.wd}/G${RA.we}),0)`));
  set(RA.mrp, 3, `Equity Risk Premium${mkt ? ` (${mkt})` : ""}`); set(RA.mrp, 5, "%"); set(RA.mrp, 7, pctOf(wb_.erp), S.pct2In);
  set(RA.erp, 3, "Beta × Equity Risk Premium"); set(RA.erp, 5, "%"); set(RA.erp, 7, f(`G${RA.bl}*G${RA.mrp}`));
  set(RA.prem, 3, "Company-specific risk premium"); set(RA.prem, 5, "%"); set(RA.prem, 7, pctOf(wb_.premium || 0), S.pct2In);
  set(RA.ke, 3, "Cost of Equity"); set(RA.ke, 5, "%"); set(RA.ke, 7, f(`G${RA.prem}+G${RA.erp}+G${RA.rf}`), S.pct2B);
  set(RA.kdHdr, 3, "Cost of Debt");
  set(RA.rf2, 3, "Risk free interest rate"); set(RA.rf2, 5, "%"); set(RA.rf2, 7, f(`G${RA.rf}`), S.pct2);
  const rating = p.plan && p.plan.wacc && p.plan.wacc.costDebt ? p.plan.wacc.costDebt.rating : null;
  set(RA.drp, 3, `Debt risk premium${rating ? ` (synthetic rating ${rating})` : ""}`); set(RA.drp, 5, "%"); set(RA.drp, 7, pctOf(wb_.costDebtPre - wb_.rf), S.pct2In);
  set(RA.kdPre, 3, "Pre-tax cost of debt"); set(RA.kdPre, 5, "%"); set(RA.kdPre, 7, f(`G${RA.rf2}+G${RA.drp}`), S.pct2);
  set(RA.kdTax, 3, "Tax rate"); set(RA.kdTax, 5, "%"); set(RA.kdTax, 7, f(`G${RA.taxStat}`), S.pct2);
  set(RA.kdPost, 3, "Cost of Debt (after tax)"); set(RA.kdPost, 5, "%"); set(RA.kdPost, 7, f(`G${RA.kdPre}*(1-G${RA.kdTax})`), S.pct2B);
  // rounded to 4 decimals of a percent, exactly as the engine rounds the rate it discounts at
  set(RA.wacc, 3, "Discount Rate (WACC)"); set(RA.wacc, 5, "%"); set(RA.wacc, 7, f(`ROUND((G${RA.ke}*G${RA.we}+G${RA.kdPost}*G${RA.wd})*100,4)/100`), S.pct2B);
  set(RA.dcfHdr, 3, "DCF Valuation Assumptions");
  set(RA.disc, 3, "Discounting Method"); set(RA.disc, 5, "Years"); set(RA.disc, 7, "Mid-Year", S.sel);
  sh.dv.push(`<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="G${RA.disc}"><formula1>$R$${RA.sel.mid}:$R$${RA.sel.end}</formula1></dataValidation>`);
  set(RA.waccLink, 3, "Discount Rate (WACC)"); set(RA.waccLink, 5, "%"); set(RA.waccLink, 7, f(`G${RA.wacc}`), st.variant(S.pctLinked, { numFmt: "0.00%" }));
  set(RA.waccUsed, 3, "Discount rate used (incl. analysis flex)"); set(RA.waccUsed, 5, "%"); set(RA.waccUsed, 7, f(`G${RA.waccLink}+${FX("w")}/100`), S.pct2B);

  // ── model checks (links to every sheet's check total) ──
  set(RA.chkHdr, 3, "Model Checks");
  const checks = [
    ["Balance Sheet", `Financials!${a1(RF.bsChk, X.fChk)}`], ["Executive Summary", `'Executive Summary'!$${CN(X.eChk)}$3`], ["Assumptions", `${a1(3, CHK)}`],
    ["Financials", `Financials!${a1(3, X.fChk)}`], ["DCF", `DCF!${a1(3, X.dChk)}`], ["Terminal Value", `'Terminal Value'!$U$3`],
    ["Two Stage Value Driver Model", `'Two Stage Value Driver Model'!${a1(3, X.vChk)}`], ["Checks sheet (failed checks)", `Checks!$G$5`],
  ];
  checks.forEach(([nm, ref], k) => { set(RA.chk0 + k, 3, nm); set(RA.chk0 + k, 7, f(`IFERROR(ROUND(${ref},6),1)`), S.chkVal); });
  for (let r = RA.chk0 + checks.length; r <= 78; r++) { sh.rows.get(r)?.clear(); }

  // ── right block: year header ──
  set(7, 11, "Business Plan Assumptions");
  set(RA.yr, H(2), f(`$G$${RA.ffy}-1`)); set(RA.yr, H(1), f(`${a1(7, H(2))}-1`)); set(RA.yr, H(0), f(`${a1(7, H(1))}-1`));
  set(RA.idx, H(2), 0); set(RA.idx, H(1), f(`${a1(8, H(2))}-1`)); set(RA.idx, H(0), f(`${a1(8, H(1))}-1`));
  set(8, 11, f(`"Forecast "&E${RA.ffy}`));
  for (let k = 1; k <= N; k++) {
    const c = F(k), pc = c - 1;
    set(7, c, k === 1 ? f(`$G$${RA.ffy}`) : f(`${a1(7, pc)}+1`));
    set(8, c, f(`${a1(8, pc)}+1`));
  }
  set(RA.isHdr, 11, f(`Financials!C${RF.yr}`));
  const lbl = (r, t, u = f(`$G$${RA.ccy}`)) => { set(r, 11, t); set(r, 12, u); };
  lbl(RA.rev, "Revenue"); lbl(RA.g, f(`K${RA.rev}&" Growth"`), "%"); lbl(RA.dc, "Direct Costs"); lbl(RA.gp, "Gross Profit");
  lbl(RA.gpm, f(`K${RA.gp}&" Margin %"`), "%"); lbl(RA.opex, "Operating Expenses"); lbl(RA.ebitda, "EBITDA");
  lbl(RA.m, f(`K${RA.ebitda}&" Margin % (driver)"`), "%"); lbl(RA.mUsed, "EBITDA Margin % used", "%");
  lbl(RA.dep, "Depreciation & Amortisation"); lbl(RA.depPct, "D&A % of Revenue", "%"); lbl(RA.extra, "Other (income) / expense");
  lbl(RA.int, "Interest Expense"); lbl(RA.tax, "Income Taxes"); lbl(RA.taxRate, "Tax rate % (on EBIT in the DCF)", "%");
  lbl(RA.ni, "Net Income/Loss"); lbl(RA.nim, f(`K${RA.ni}&" Margin %"`), "%");
  set(RA.bsHdr, 11, f(`Financials!C${RF.bsHdr}`));
  lbl(RA.cash, "Cash"); lbl(RA.rec, "Receivables"); lbl(RA.inv, "Inventory"); lbl(RA.oca, "Other Current Assets"); lbl(RA.ca, "Current Assets");
  lbl(RA.nfa, "Net Fixed Assets (PP&E)"); lbl(RA.onca, "Other Non-Current Assets"); lbl(RA.nca, "Non-Current Assets"); lbl(RA.assets, "Assets");
  lbl(RA.stp, "Short-Term Provisions"); lbl(RA.pay, "Payables"); lbl(RA.ocl, "Other Current Liabilities"); lbl(RA.stl, "Short-term Liabilities");
  lbl(RA.oltl, "Other Long-Term Liabilities"); lbl(RA.debt, "Financial Debt (incl. leases)"); lbl(RA.ltl, "Long-term Liabilities");
  lbl(RA.eq, "Shareholder's Equity"); lbl(RA.le, "Liabilities & Shareholder's Equity");
  set(RA.cfHdr, 11, f(`Financials!C${RF.cfHdr}`));
  lbl(RA.capexPct, "Capex % of Revenue", "%"); lbl(RA.capex, "Capital Expenditures"); lbl(RA.dDebt, "Change in Financial Debt"); lbl(RA.wcPct, "Incremental NWC % of Δ Revenue", "%");

  // ── right block: historical actuals (reported data — the manual inputs) ──
  X.hist.forEach((h, j) => {
    const c = H(j), pc = c - 1, A_ = (r) => a1(r, c), P_ = (r) => a1(r, pc);
    if (!h) { [RA.rev, RA.dc, RA.opex, RA.dep, RA.extra, RA.int, RA.tax, RA.cash, RA.rec, RA.inv, RA.oca, RA.nfa, RA.onca, RA.stp, RA.pay, RA.ocl, RA.oltl, RA.debt, RA.capex].forEach((r) => set(r, c, null)); return; }
    const hv = histValues(X, h, j === 2);
    set(RA.rev, c, hv.rev, S.numIn); set(RA.g, c, f(`IFERROR(${A_(RA.rev)}/${P_(RA.rev)}-1,"NA")`), S.pct);
    set(RA.dc, c, hv.dc, S.numIn); set(RA.gp, c, f(`${A_(RA.rev)}-${A_(RA.dc)}`)); set(RA.gpm, c, f(`IFERROR(${A_(RA.gp)}/${A_(RA.rev)},0)`), S.pct);
    set(RA.opex, c, hv.opex, S.numIn); set(RA.ebitda, c, f(`${A_(RA.gp)}-${A_(RA.opex)}`)); set(RA.m, c, f(`IFERROR(${A_(RA.ebitda)}/${A_(RA.rev)},0)`), S.pct);
    set(RA.mUsed, c, null, S.pct);
    set(RA.dep, c, hv.dep, S.numIn); set(RA.depPct, c, f(`IFERROR(${A_(RA.dep)}/${A_(RA.rev)},0)`), S.pct);
    set(RA.extra, c, hv.extra, S.numIn); set(RA.int, c, hv.int, S.numIn); set(RA.tax, c, hv.tax, S.numIn);
    set(RA.taxRate, c, f(`IFERROR(${A_(RA.tax)}/(${A_(RA.ebitda)}-${A_(RA.dep)}-${A_(RA.extra)}-${A_(RA.int)}),0)`), S.pct);
    set(RA.ni, c, f(`${A_(RA.ebitda)}-SUM(${A_(RA.dep)},${A_(RA.extra)}:${A_(RA.tax)})`)); set(RA.nim, c, f(`IFERROR(${A_(RA.ni)}/${A_(RA.rev)},0)`));
    set(RA.cash, c, hv.cash, S.numIn); set(RA.rec, c, hv.rec, S.numIn); set(RA.inv, c, hv.inv, S.numIn); set(RA.oca, c, hv.oca, S.numIn);
    set(RA.ca, c, f(`SUM(${A_(RA.cash)}:${A_(RA.oca)})`));
    set(RA.nfa, c, hv.nfa, S.numIn); set(RA.onca, c, hv.onca, S.numIn); set(RA.nca, c, f(`SUM(${A_(RA.nfa)}:${A_(RA.onca)})`));
    set(RA.assets, c, f(`SUM(${A_(RA.nca)},${A_(RA.ca)})`));
    set(RA.stp, c, 0, S.numIn); set(RA.pay, c, hv.pay, S.numIn); set(RA.ocl, c, hv.ocl, S.numIn); set(RA.stl, c, f(`SUM(${A_(RA.stp)}:${A_(RA.ocl)})`));
    set(RA.oltl, c, hv.oltl, S.numIn); set(RA.debt, c, hv.debt, S.numIn); set(RA.ltl, c, f(`SUM(${A_(RA.oltl)}:${A_(RA.debt)})`));
    set(RA.eq, c, f(`${A_(RA.assets)}-SUM(${A_(RA.stl)},${A_(RA.ltl)})`)); set(RA.le, c, f(`SUM(${A_(RA.eq)},${A_(RA.ltl)},${A_(RA.stl)})`));
    set(RA.capex, c, hv.capex, S.numIn); set(RA.capexPct, c, f(`IFERROR(${A_(RA.capex)}/${A_(RA.rev)},0)`), S.pct);
    set(RA.dDebt, c, j === 0 ? null : f(`IFERROR(${A_(RA.debt)}-${P_(RA.debt)},0)`), S.num);
    set(RA.wcPct, c, j === 0 ? "NA" : f(`IFERROR(((${A_(RA.rec)}+${A_(RA.inv)}-${A_(RA.pay)})-(${P_(RA.rec)}+${P_(RA.inv)}-${P_(RA.pay)}))/(${A_(RA.rev)}-${P_(RA.rev)}),"NA")`), S.pct);
  });

  // ── right block: forecast (driver inputs blue, everything else formulas) ──
  const gpmHold = (() => { const h = X.hist[2]; if (!h) return 0.5; const hv = histValues(X, h, true); return hv.rev ? (hv.rev - hv.dc) / hv.rev : 0.5; })();
  for (let k = 1; k <= N; k++) {
    const c = F(k), pc = c - 1, r = rows[k - 1], A_ = (rr) => a1(rr, c), P_ = (rr) => a1(rr, pc);
    const tau = `MAX(0,1-(${a1(8, c, true)}-1)/MAX(1,$G$${RA.horizon}-1))`;
    const gUsed = `IF($G$${RA.planFlag}=1,${A_(RA.g)}+${FX("g")}/100*${tau},MAX(${A_(RA.g)}+${FX("g")}/100,$G$${RA.gT}))+${FX("gmc")}/100*${tau}`;
    set(RA.rev, c, f(`${P_(RA.rev)}*(1+${gUsed})`), S.num);
    set(RA.g, c, pctOf(r.inp ? r.inp.g : r.growth), S.pctIn);
    set(RA.dc, c, f(`IFERROR(${A_(RA.rev)}*(1-${A_(RA.gpm)}),0)`), S.num);
    set(RA.gp, c, f(`${A_(RA.rev)}-${A_(RA.dc)}`));
    set(RA.gpm, c, gpmHold, S.pctIn);
    set(RA.opex, c, f(`${A_(RA.gp)}-${A_(RA.rev)}*${A_(RA.mUsed)}`), S.num);
    set(RA.ebitda, c, f(`${A_(RA.gp)}-${A_(RA.opex)}`));
    set(RA.m, c, pctOf(r.inp ? r.inp.m : r.margin), S.pctIn);
    set(RA.mUsed, c, f(`MIN(0.6,MAX(0.01,MIN(0.6,MAX(0.01,${A_(RA.m)}+(${FX("m")}+${FX("tilt")}*${a1(8, c, true)}/$G$${RA.horizon})/100))*(1+${FX("mrel")}/100)))`), S.pct);
    set(RA.dep, c, f(`${A_(RA.rev)}*${A_(RA.depPct)}`), S.num);
    set(RA.depPct, c, pctOf(r.inp ? r.inp.dep : (r.dep / r.rev) * 100), S.pctIn);
    set(RA.extra, c, 0, S.numIn);
    set(RA.int, c, f(`-Financials!${a1(RF.int, X.fF(k))}`), S.numLink);
    set(RA.tax, c, f(`-Financials!${a1(RF.tax, X.fF(k))}`), S.numLink);
    set(RA.taxRate, c, pctOf(r.inp ? r.inp.tax : (r.ebit ? (r.tax / r.ebit) * 100 : 25)), S.pctIn);
    set(RA.ni, c, f(`${A_(RA.ebitda)}-SUM(${A_(RA.dep)},${A_(RA.extra)}:${A_(RA.tax)})`), S.numB);
    set(RA.nim, c, f(`IFERROR(${A_(RA.ni)}/${A_(RA.rev)},0)`));
    set(RA.cash, c, f(`Financials!${a1(RF.cash, X.fF(k))}`), S.numLink);
    set(RA.rec, c, f(`Financials!${a1(RF.rec, X.fF(k))}`), S.numLink);
    set(RA.inv, c, f(`Financials!${a1(RF.inv, X.fF(k))}`), S.numLink);
    set(RA.oca, c, f(`Financials!${a1(RF.oca, X.fF(k))}`), S.numLink);
    set(RA.ca, c, f(`SUM(${A_(RA.cash)}:${A_(RA.oca)})`));
    set(RA.nfa, c, f(`Financials!${a1(RF.nfa, X.fF(k))}`), S.numLink);
    set(RA.onca, c, f(`Financials!${a1(RF.onca, X.fF(k))}`), S.numLink);
    set(RA.nca, c, f(`SUM(${A_(RA.nfa)}:${A_(RA.onca)})`));
    set(RA.assets, c, f(`SUM(${A_(RA.nca)},${A_(RA.ca)})`));
    set(RA.stp, c, f(`${P_(RA.stp)}`), S.numLinked);
    set(RA.pay, c, f(`-Financials!${a1(RF.nPay, X.fF(k))}`), S.numLink);
    set(RA.ocl, c, f(`-Financials!${a1(RF.nOcl, X.fF(k))}`), S.numLink);
    set(RA.stl, c, f(`SUM(${A_(RA.stp)}:${A_(RA.ocl)})`));
    set(RA.oltl, c, f(`${P_(RA.oltl)}`), S.numLinked);
    set(RA.debt, c, f(`${P_(RA.debt)}+${A_(RA.dDebt)}`), S.num);
    set(RA.ltl, c, f(`SUM(${A_(RA.oltl)}:${A_(RA.debt)})`));
    set(RA.eq, c, f(`Financials!${a1(RF.eq, X.fF(k))}`), S.numLinkB);
    set(RA.le, c, f(`SUM(${A_(RA.eq)},${A_(RA.ltl)},${A_(RA.stl)})`));
    set(RA.capexPct, c, pctOf(r.inp ? r.inp.cap : (r.capex / r.rev) * 100), S.pctIn);
    set(RA.capex, c, f(`${A_(RA.rev)}*(${A_(RA.capexPct)}+${FX("cap")}/100)`), S.num);
    set(RA.dDebt, c, 0, S.numIn);
    set(RA.wcPct, c, pctOf(r.inp ? r.inp.wc : 0), S.pctIn);
  }
  // check column (hidden): forecast totals tie to Financials
  set(RA.rev, CHK, f(`ROUND(SUM(${a1(RA.rev, F(1))}:${a1(RA.rev, L)})-Financials!${a1(RF.rev, X.fTot)},6)`), S.chkSum);
  set(RA.ebitda, CHK, f(`ROUND(SUM(${a1(RA.ebitda, F(1))}:${a1(RA.ebitda, L)})-Financials!${a1(RF.ebitda, X.fTot)},6)`), S.chkSum);
  set(RA.ni, CHK, f(`ROUND(SUM(${a1(RA.ni, F(1))}:${a1(RA.ni, L)})-Financials!${a1(RF.ni, X.fTot)},6)`), S.chkSum);
  set(RA.le, CHK, f(`ROUND(SUM(${a1(RA.assets, H(0))}:${a1(RA.assets, L)})-SUM(${a1(RA.le, H(0))}:${a1(RA.le, L)}),6)`), S.chkSum);

  // ── terminal-value model list ──
  set(RA.tvHdr, 11, "Terminal Value Models");
  set(RA.tvHead, 11, "Terminal Value Model"); set(RA.tvHead, 13, f(`"Terminal Value (Year "&${a1(8, L)}&")"`)); set(RA.tvHead, 14, "Calculations"); set(RA.tvHead, 16, "Explanation");
  set(RA.tvHead, 13, f(`"Terminal Value (Year "&${a1(8, L)}&")"`));
  const TVM = tvMethods();
  TVM.forEach((m, k) => {
    const r = RA.tv0 + k;
    set(r, 11, m.label ? m.label : m.labelF ? f(m.labelF) : "", m.labelF ? null : undefined);
    set(r, 13, f(`'Terminal Value'!H${RT.sum0 + k}`), S.num);
    set(r, 14, f(`HYPERLINK("#'${m.sheet || "Terminal Value"}'!${m.anchor}","=> "&K${r})`), S.hyper);
    set(r, 16, m.expl, S.text);
  });
  sh.set(RA.tv0 + 3, 11, f(`C${RA.exRev}&" ("&FIXED(G${RA.exRev},1)&"x)"`));
  sh.set(RA.tv0 + 4, 11, f(`C${RA.exEbitda}&" ("&FIXED(G${RA.exEbitda},1)&"x)"`));
  sh.set(RA.tv0 + 5, 11, f(`C${RA.exEbit}&" ("&FIXED(G${RA.exEbit},1)&"x)"`));
  sh.set(RA.tv0 + 6, 11, f(`C${RA.exPe}&" ("&FIXED(G${RA.exPe},1)&"x)"`));
  sh.set(RA.tv0 + 7, 11, f(`C${RA.exPb}&" ("&FIXED(G${RA.exPb},1)&"x)"`));

  // ── terminal value assumptions by model ──
  set(RA.tvaHdr, 3, "Terminal Value Assumptions by Model"); set(RA.sel.hdr, 18, "Selectors");
  set(RA.capHdr, 3, f(`K${RA.tv0}`)); set(RA.capRate, 3, "Capitalization Rate"); set(RA.capRate, 5, "%"); set(RA.capRate, 7, f(`G${RA.waccUsed}`), st.variant(S.lPct, { numFmt: "0.00%" }));
  set(RA.gorHdr, 3, f(`K${RA.tv0 + 1}`)); set(RA.gorW, 3, "Discount Rate"); set(RA.gorW, 5, "%"); set(RA.gorW, 7, f(`G${RA.waccUsed}`), st.variant(S.lPct, { numFmt: "0.00%" }));
  set(RA.gT, 3, "Growth Rate (terminal)"); set(RA.gT, 5, "%"); set(RA.gT, 7, pctOf(i.assumptions.terminalG), S.pct2In);
  set(RA.hHdr, 3, f(`K${RA.tv0 + 2}`));
  set(RA.hHigh, 3, "High Growth (last explicit year)"); set(RA.hHigh, 5, "%"); set(RA.hHigh, 7, f(`Financials!${a1(RF.g, X.fLast)}`), S.pct2Link);
  set(RA.hLow, 3, "Low Growth"); set(RA.hLow, 5, "%"); set(RA.hLow, 7, f(`G${RA.vdf.g}`), st.variant(S.pctLinked, { numFmt: "0.00%" }));
  set(RA.hPeriod, 3, "Period of High Growth"); set(RA.hPeriod, 5, "Years"); set(RA.hPeriod, 7, Math.max(2, (i.stage2 && i.stage2.years) || (p.plan ? p.plan.terminal.stage2Years : 0) || 10), S.intIn);
  set(RA.exHdr, 3, f(`G${RA.exLbl}&"s"`)); set(RA.exLbl, 3, "Label"); set(RA.exLbl, 7, "Exit Multiple", st.variant(S.textIn, { halign: "right" }));
  const mult = exitMultiples(X);
  [[RA.exRev, "EV/Revenue", mult.evRev], [RA.exEbitda, "EV/EBITDA", mult.evEbitda], [RA.exEbit, "EV/EBIT", mult.evEbit], [RA.exPe, "P/E", mult.pe], [RA.exPb, "P/B", mult.pb]].forEach(([r, nm, v]) => {
    set(r, 3, f(`"${nm} "&$G$${RA.exLbl}`)); set(r, 5, "x"); set(r, 7, fin(v) && v > 0 ? v : 0, S.xIn);
  });
  // one-stage value driver
  const O = RA.os;
  set(O.hdr, 11, f(`K${RA.tv0 + 8}`)); set(O.w, 11, "Discount Rate"); set(O.w, 12, "%"); set(O.w, 13, f(`$G$${RA.waccUsed}`), S.pct2);
  set(O.spread, 11, "Spread to Discount Rate"); set(O.spread, 12, "%"); set(O.spread, 13, 0.02, S.pct2In);
  set(O.roic, 11, "ROIC"); set(O.roic, 12, "%"); set(O.roic, 13, f(`M${O.w}+M${O.spread}`), S.pct2);
  set(O.g, 11, "Growth Rate"); set(O.g, 12, "%"); set(O.g, 13, f(`G$${RA.vdf.g}`), st.variant(S.pctLinked, { numFmt: "0.00%" }));
  // two-stage value driver
  const T = RA.ts, lastRoic = rows.length ? null : null;
  set(T.hdr, 11, f(`K${RA.tv0 + 9}`)); set(T.stages, 11, "Stages"); set(T.stages, 13, "Stage I"); set(T.stages, 15, "Stage II");
  set(T.timeline, 11, "Timeline");
  set(T.dur, 11, "Duration of Competitive Advantage"); set(T.dur, 12, "Years"); set(T.dur, 13, Math.max(5, (i.stage2 && i.stage2.years) || 10), S.intIn); set(T.dur, 15, "NA");
  set(T.start, 11, "Start"); set(T.start, 12, "Year"); set(T.start, 13, f(`$G$${RA.horizon}+1`)); set(T.start, 15, f(`M${T.start}+M${T.dur}`));
  set(T.end, 11, "End "); set(T.end, 12, "Year"); set(T.end, 13, f(`M${T.start}+M${T.dur}-1`)); set(T.end, 15, "Infinite");
  set(T.w, 11, "Discount Rate"); set(T.w, 12, "%"); set(T.w, 13, f(`$G$${RA.waccUsed}`), S.pct2); set(T.w, 15, f(`M${T.w}`), S.pct2);
  set(T.vd, 11, "Value Drivers");
  const gN = rows[N - 1].growth, gTv = i.assumptions.terminalG;
  set(T.g, 11, "Growth Rate"); set(T.g, 12, "%"); set(T.g, 13, pctOf((gN + gTv) / 2), S.pct2In); set(T.g, 15, f(`G${RA.vdf.g}`), st.variant(S.pctLinked, { numFmt: "0.00%" }));
  set(T.spread, 11, "Spread to Discount Rate"); set(T.spread, 12, "%"); set(T.spread, 13, f(`M${T.roic}-M${T.w}`), S.pct2); set(T.spread, 15, 0, S.pct2In);
  set(T.roic, 11, "ROIC"); set(T.roic, 12, "%"); set(T.roic, 13, f(`'Two Stage Value Driver Model'!${a1(R2.roic, X.tF(N))}`), S.pct2Link); set(T.roic, 15, f(`O${T.w}+O${T.spread}`), S.pct2);
  set(T.curve, 11, "ROIC Curve"); set(T.curve, 12, "%"); set(T.curve, 13, f(`'Two Stage Value Driver Model'!H${R2.roic}`), S.textLeft);
  // selectors + links
  const L_ = RA.sel;
  set(L_.discHdr, 18, "Discounting Period"); set(L_.mid, 18, "Mid-Year", S.sel); set(L_.mid, 20, 0.5); set(L_.end, 18, "End of Year", S.sel); set(L_.end, 20, 1);
  set(L_.roceHdr, 18, "ROCE Stage I"); set(L_.steady, 18, "Steady Decline", S.sel); set(L_.expo, 18, "Exponential Decline", S.sel); set(L_.jump, 18, "Decline Jump at End", S.sel);
  set(L_.linksHdr, 18, "Links");
  X.linkList.forEach(([nm, anchor], k) => set(L_.link0 + k, 18, f(`HYPERLINK("#'${nm}'!${anchor}",${q(nm)})`), S.hyper));
  // value-driver fade (the engine's terminal value)
  const V = RA.vdf;
  set(V.hdr, 3, f(`K${RA.tv0 + 10}`));
  set(V.years, 3, "Stage-2 fade (competitive-advantage) period"); set(V.years, 5, "Years"); set(V.years, 7, (i.stage2 && i.stage2.years) || 0, S.intIn);
  set(V.ronic, 3, "Return on new invested capital (RONIC)"); set(V.ronic, 5, "%"); set(V.ronic, 7, pctOf(i.stage2 ? i.stage2.ronic : 0), S.pct2In);
  set(V.g, 3, "Terminal growth used (incl. analysis flex)"); set(V.g, 5, "%"); set(V.g, 7, f(`G${RA.gT}+${FX("tg")}/100`), S.pct2B);
  // analysis flex (data tables substitute these; all zero in the base case)
  set(RA.flexHdr, 3, "Analysis Flex — driven by the analysis sheets' data tables");
  set(RA.flexNote, 3, "Each value is the sum of the matching cell in column Y of Sensitivity, Scenarios, Reverse DCF, Tornado and Monte Carlo. They are 0 unless Excel is evaluating a data table.", S.note);
  Object.keys(FLEX).forEach((k, j) => {
    const r = RA.flex0 + j;
    set(r, 3, FLEX_LABEL[k]); set(r, 5, k === "mrel" ? "%" : "pp");
    set(r, 7, f(FLEX_SHEETS.map((s) => `'${s}'!$Y${FLEX[k]}`).join("+")), S.dec);
  });
  set(RA.planFlag, 3, "Plan-driven growth path (1 = flex tapers to zero; 0 = parallel shift floored at terminal growth)"); set(RA.planFlag, 7, X.planDriven ? 1 : 0, S.intIn);
  set(RA.taperNote, 3, "Mirrors the engine: a plan's growth shifts taper to zero by the last explicit year; without a plan they shift in parallel with a terminal-growth floor.", S.note);
  // footers from the template (efinancialmodels link) are dropped
}

/* incremental NWC split into days of revenue that sum to the engine's NWC % (constant path) */
function nwcSplit(p, rows) {
  const inc = p.statements.income || [], bal = p.statements.balance || [];
  const rs = [], is = [], ps = [];
  bal.forEach((b, k) => { const rv = inc[k] && inc[k].revenue; if (rv && (b.receivables || b.inventory || b.payables)) { rs.push((b.receivables || 0) / rv); is.push((b.inventory || 0) / rv); ps.push((b.payables || 0) / rv); } });
  const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  let rec = avg(rs), inv = avg(is), pay = avg(ps);
  const wc = rows.length && rows[0].inp ? rows[0].inp.wc / 100 : 0.1;
  const gap = wc - (rec + inv - pay);                    // rising-receivable-days adjustment / clamp → receivables
  rec += gap;
  return { recD: +(rec * 365).toFixed(6), invD: +(inv * 365).toFixed(6), payD: +(pay * 365).toFixed(6) };
}

/* reported figures for one historical column, in display units */
function histValues(X, h, isLast) {
  const d = X.d, inc = h.inc || {}, bal = h.bal || {}, cf = h.cf || {};
  const rev = inc.revenue || 0;
  const gp = inc.grossProfit != null ? inc.grossProfit : inc.cogs != null ? rev - inc.cogs : rev;
  const ebitda = inc.ebitda || inc.opIncome || 0;
  const dep = cf.dep != null ? Math.abs(cf.dep) : inc.ebit != null ? ebitda - inc.ebit : 0;
  const ebit = ebitda - dep, interest = inc.interest != null ? Math.abs(inc.interest) : 0;
  const pretax = inc.pretax != null ? inc.pretax : ebit - interest;
  const extra = ebit - interest - pretax;                // expense convention (positive = cost)
  const cash = bal.cash || 0, rec = bal.receivables || 0, inv = bal.inventory || 0;
  const ca = bal.currentAssets != null ? bal.currentAssets : cash + rec + inv;
  const assets = bal.assets != null ? bal.assets : ca + (bal.ppe || 0);
  const pay = bal.payables || 0, stDebt = bal.stDebt || 0;
  const cl = bal.currentLiab != null ? bal.currentLiab : pay + stDebt;
  // last reported year: the engine's debt (net debt + cash) so the equity bridge reconciles exactly
  const debt = isLast ? (X.idcf.netDebt || 0) + cash : bal.totalDebt != null ? bal.totalDebt : (bal.stDebt || 0) + (bal.ltDebt || 0);
  const equity = bal.totalEquityGrossMI != null ? bal.totalEquityGrossMI : bal.equity != null ? bal.equity + (bal.minorityInterest || 0) : assets - (bal.totalLiabilities || 0);
  const ocl = cl - pay - stDebt;
  const oltl = assets - equity - (pay + ocl) - debt;
  return {
    rev: d(rev), dc: d(rev - gp), opex: d(gp - ebitda), dep: d(dep), extra: d(extra), int: d(interest), tax: d(inc.tax || 0),
    cash: d(cash), rec: d(rec), inv: d(inv), oca: d(ca - cash - rec - inv), nfa: d(bal.ppe || 0), onca: d(assets - ca - (bal.ppe || 0)),
    pay: d(pay), ocl: d(ocl), oltl: d(oltl), debt: d(debt), capex: d(cf.capex != null ? Math.abs(cf.capex) : 0),
  };
}

/* exit multiples default to today's trading multiples (the engine's exit multiple when chosen) */
function exitMultiples(X) {
  const i = X.idcf, h = X.hist[2]; if (!h) return {};
  const px = i.currentPrice || 0, sh = i.sharesOut || 0, mcap = px * sh, ev = mcap + (i.netDebt || 0);
  const inc = h.inc || {}, bal = h.bal || {}, cf = h.cf || {};
  const ebitda = inc.ebitda || inc.opIncome, dep = cf.dep != null ? Math.abs(cf.dep) : 0;
  const ebit = ebitda != null ? ebitda - dep : null;
  const eq = bal.totalEquityGrossMI != null ? bal.totalEquityGrossMI : bal.equity;
  return {
    evRev: inc.revenue ? ev / inc.revenue : null,
    evEbitda: i.terminalMethod === "exitMultiple" && i.exitMultiple ? i.exitMultiple : ebitda > 0 ? ev / ebitda : null,
    evEbit: ebit > 0 ? ev / ebit : null, pe: inc.netIncome > 0 ? mcap / inc.netIncome : null, pb: eq > 0 ? mcap / eq : null,
  };
}

function tvMethods() {
  return [
    { label: "Capitalized Earnings", anchor: `H${RT.capTv}`, expl: "Capitalisation of EBIT less taxes at the company's discount rate" },
    { label: "Gordon Growth", anchor: `H${RT.gorTv}`, expl: "Last free cash flow to firm growing forever at the terminal growth rate" },
    { label: "H-Model", anchor: `G${RT.hTv}`, expl: "Two-stage growth: high growth fading linearly to the long-term rate" },
    { anchor: `O${RT.ex0}`, expl: "Terminal value from an exit multiple of revenue" },
    { anchor: `O${RT.ex0 + 1}`, expl: "Terminal value from an exit multiple of EBITDA (the website's exit-multiple method)" },
    { anchor: `O${RT.ex0 + 2}`, expl: "Terminal value from an exit multiple of EBIT" },
    { anchor: `O${RT.ex0 + 3}`, expl: "Terminal equity value from an exit P/E, bridged to enterprise value" },
    { anchor: `O${RT.ex0 + 4}`, expl: "Terminal equity value from an exit P/B, bridged to enterprise value" },
    { label: "One Stage Value Driver", anchor: `G${RT.osTv}`, expl: "Excess return on invested capital modelled into perpetuity" },
    { label: "Two Stage Value Driver", sheet: SN.vd2, anchor: `R${R2.tv}`, expl: "ROIC fading to WACC over a competitive-advantage period, then a perpetuity" },
    { label: "Value Driver Fade (M-Terminal)", anchor: `H${RT.vdfHdr + 25}`, expl: "The website engine: stage-2 fade to terminal growth with FCFF = NOPAT × (1 − g ÷ RONIC), then a perpetuity on the same basis" },
  ];
}

/* ═══════════════════════════════ FINANCIALS ═══════════════════════════════ */
function buildFinancials(X) {
  const sh = X.wb.sheet(SN.fin), S = X.S, N = X.N, st = X.wb.styles;
  const F = X.fF, H = X.fH, L = X.fLast, TOT = X.fTot, CHK = X.fChk;
  const ymap = (c) => { if (c <= 13) return c; if (c === 14) return null; if (c === 15) return F(1); if (c === 16) return N > 2 ? range(F(2), F(N - 1)) : null; if (c === 17 || c === 18) return null; if (c === 19) return F(N); return c + N - 6; };
  const idmap = (c) => (c >= 20 ? c + N - 6 : c);
  sh.remapCols(ymap);
  const same = (a, b) => range(a, b).map((r) => [r, r]);
  cloneRows(sh, [[2, 2], [3, 3], ...same(5, 47), [48, 47], [49, 48], [50, 49], [51, 50], [52, 52], ...same(53, 167), ...same(170, 176), [178, 187], [179, 187], [180, 188], [181, 189], [185, 185], [187, 187], [188, 188], [189, 189],
    ...same(193, 214)], ymap);
  cloneRows(sh, [...same(216, 230), [231, 230]], idmap);
  sh.cloneRow(174, 174, ymap); // D&A % row keeps the section style
  const set = (r, c, v, s) => sh.set(r, c, v, s), f = (x) => ({ f: x });
  const A = (r, c) => a1(r, c), AS = (r, c) => `Assumptions!${a1(r, c)}`;
  const allC = [H(0), H(1), H(2), ...range(1, N).map(F)];
  const aCol = (c) => (c <= 13 ? c + 2 : X.aF(c - 13));   // Financials column → Assumptions column

  set(2, 2, f('SUBSTITUTE(Title!$B$4,CHAR(10)," · ")')); set(2, CHK, "Check"); set(3, CHK, f(`SUM(${A(4, CHK)}:${A(240, CHK)})`), S.chkSum);
  set(5, 3, "Financial Projections"); set(6, 3, f(`"All amounts in "&Assumptions!$G$${RA.ccy}`));
  // header rows of each block
  const hdr = (r, title, idxRow) => {
    set(r, 1, f(`MAX(A$1:A${r - 1})+1`)); set(r, 3, title); set(r, 7, "Unit");
    allC.forEach((c) => set(r, c, f(`Assumptions!${a1(7, aCol(c))}`)));
    set(r, TOT, f(`MAX(${A(8, H(0))}:${A(8, L)})`));
    set(idxRow, 3, f(`Assumptions!K${RA.idx}`));
    allC.forEach((c) => set(idxRow, c, f(`Assumptions!${a1(8, aCol(c))}`)));
    set(idxRow, TOT, f(A(8, L)));
  };
  hdr(RF.yr, "Income Statement", RF.idx);
  const lbl = (r, t, u) => { set(r, 3, t); if (u !== undefined) set(r, 7, u); };
  const U = f(`Assumptions!$G$${RA.ccy}`);
  // ── income statement (links to Assumptions) ──
  lbl(RF.rev, f(`Assumptions!K${RA.rev}`), U); lbl(RF.g, f(`Assumptions!K${RA.g}`), "%"); lbl(RF.dc, f(`Assumptions!K${RA.dc}`), U); lbl(RF.gp, f(`Assumptions!K${RA.gp}`), U);
  lbl(RF.gpm, f(`Assumptions!K${RA.gpm}`), "% of Revenue"); lbl(RF.opex, f(`Assumptions!K${RA.opex}`), U); lbl(RF.ebitda, f(`Assumptions!K${RA.ebitda}`), U);
  lbl(RF.m, "EBITDA Margin %", "% of Revenue"); lbl(RF.dep, f(`Assumptions!K${RA.dep}`), U); lbl(RF.ebit, "EBIT", U); lbl(RF.ebitm, f(`C${RF.ebit}&" Margin %"`), "% of Revenue");
  lbl(RF.extra, f(`Assumptions!K${RA.extra}`), U); lbl(RF.int, f(`Assumptions!K${RA.int}`), U); lbl(RF.ebt, "EBT", U); lbl(RF.ebtm, f(`C${RF.ebt}&" Margin %"`), "% of Revenue");
  lbl(RF.tax, f(`Assumptions!K${RA.tax}`), U); lbl(RF.ni, f(`Assumptions!K${RA.ni}`), U); lbl(RF.nim, f(`C${RF.ni}&" Margin %"`), "% of Revenue"); lbl(RF.niChk, "Check");
  allC.forEach((c, j) => {
    const isF = c > 13, a = aCol(c), P_ = (r) => A(r, c - 1), C_ = (r) => A(r, c);
    set(RF.rev, c, f(AS(RA.rev, a)), S.numLinkB);
    set(RF.g, c, f(`IFERROR(${C_(RF.rev)}/${P_(RF.rev)}-1,"NA")`));
    set(RF.dc, c, f(`-${AS(RA.dc, a)}`), S.numLink); set(RF.gp, c, f(`${C_(RF.rev)}+${C_(RF.dc)}`)); set(RF.gpm, c, f(`IF(ISERR(${C_(RF.gp)}/${C_(RF.rev)}),"NA",${C_(RF.gp)}/${C_(RF.rev)})`));
    set(RF.opex, c, f(`-${AS(RA.opex, a)}`), S.numLink); set(RF.ebitda, c, f(`${C_(RF.gp)}+${C_(RF.opex)}`)); set(RF.m, c, f(`IF(ISERR(${C_(RF.ebitda)}/${C_(RF.rev)}),"NA",${C_(RF.ebitda)}/${C_(RF.rev)})`));
    set(RF.dep, c, f(`-${AS(RA.dep, a)}`), S.numLink); set(RF.ebit, c, f(`${C_(RF.ebitda)}+${C_(RF.dep)}`)); set(RF.ebitm, c, f(`IF(ISERR(${C_(RF.ebit)}/${C_(RF.rev)}),"NA",${C_(RF.ebit)}/${C_(RF.rev)})`));
    set(RF.extra, c, f(`-${AS(RA.extra, a)}`), S.numLink);
    set(RF.int, c, isF ? f(`-IFERROR(AVERAGE(${P_(RF.debt)}:${C_(RF.debt)})*${C_(RF.intRate)},0)`) : f(`-${AS(RA.int, a)}`), isF ? S.num : S.numLink);
    set(RF.ebt, c, f(`${C_(RF.ebit)}+SUM(${C_(RF.extra)}:${C_(RF.int)})`)); set(RF.ebtm, c, f(`IF(ISERR(${C_(RF.ebt)}/${C_(RF.rev)}),"NA",${C_(RF.ebt)}/${C_(RF.rev)})`));
    set(RF.tax, c, isF ? f(`IF(${C_(RF.ebt)}>0,-${C_(RF.ebt)}*${C_(RF.taxRate)},0)`) : f(`-${AS(RA.tax, a)}`), isF ? S.num : S.numLink);
    set(RF.ni, c, f(`${C_(RF.ebt)}+${C_(RF.tax)}`)); set(RF.nim, c, f(`IF(ISERR(${C_(RF.ni)}/${C_(RF.rev)}),"NA",${C_(RF.ni)}/${C_(RF.rev)})`));
    set(RF.niChk, c, f(`${C_(RF.ni)}-${AS(RA.ni, a)}`), S.chkVal);
  });
  const fr = (r) => `${A(r, F(1))}:${A(r, L)}`;
  [RF.rev, RF.dc, RF.gp, RF.opex, RF.ebitda, RF.dep, RF.ebit, RF.extra, RF.int, RF.ebt, RF.tax, RF.ni].forEach((r) => set(r, TOT, f(`SUM(${fr(r)})`)));
  set(RF.g, TOT, f(`IFERROR((${A(RF.rev, L)}/${A(RF.rev, H(2))})^(1/$${CN(L)}$${RF.idx})-1,"NA")`));
  [[RF.gpm, RF.gp], [RF.m, RF.ebitda], [RF.ebitm, RF.ebit], [RF.ebtm, RF.ebt], [RF.nim, RF.ni]].forEach(([r, n]) => set(r, TOT, f(`IF(ISERR(${A(n, TOT)}/${A(RF.rev, TOT)}),"NA",${A(n, TOT)}/${A(RF.rev, TOT)})`)));
  set(RF.niChk, CHK, f(`ROUND(SUM(${A(RF.niChk, H(0))}:${A(RF.niChk, L)}),6)`), S.chkSum);
  set(RF.gp, CHK, f(`ROUND(SUM(${A(RF.rev, H(0))}:${A(RF.rev, L)})+SUM(${A(RF.dc, H(0))}:${A(RF.dc, L)})-SUM(${A(RF.gp, H(0))}:${A(RF.gp, L)}),6)`), S.chkSum);

  // ── balance sheet ──
  set(RF.bsAmt, 3, f(`"All amounts in "&Assumptions!$G$${RA.ccy}`)); hdr(RF.bsHdr, "Balance Sheet", RF.bsIdx);
  [[RF.cash, RA.cash], [RF.rec, RA.rec], [RF.inv, RA.inv], [RF.oca, RA.oca], [RF.ca, RA.ca], [RF.nfa, RA.nfa], [RF.onca, RA.onca], [RF.nca, RA.nca], [RF.assets, RA.assets],
    [RF.stp, RA.stp], [RF.pay, RA.pay], [RF.ocl, RA.ocl], [RF.stl, RA.stl], [RF.oltl, RA.oltl], [RF.debt, RA.debt], [RF.ltl, RA.ltl], [RF.eq, RA.eq], [RF.le, RA.le]]
    .forEach(([r, ar]) => lbl(r, f(`Assumptions!K${ar}`), U));
  lbl(RF.bsChk, "Check");
  allC.forEach((c) => {
    const isF = c > 13, a = aCol(c), P_ = (r) => A(r, c - 1), C_ = (r) => A(r, c), k = c - 13;
    if (!isF) {
      [[RF.cash, RA.cash], [RF.rec, RA.rec], [RF.inv, RA.inv], [RF.oca, RA.oca], [RF.nfa, RA.nfa], [RF.onca, RA.onca], [RF.pay, RA.pay], [RF.ocl, RA.ocl]].forEach(([r, ar]) => set(r, c, f(AS(ar, a)), S.numLink));
      set(RF.eq, c, f(`${C_(RF.assets)}-SUM(${C_(RF.ltl)},${C_(RF.stl)})`), S.numB);
    } else {
      set(RF.cash, c, f(C_(RF.cash1))); set(RF.rec, c, f(C_(RF.nRec))); set(RF.inv, c, f(C_(RF.nInv))); set(RF.oca, c, f(C_(RF.nOca)));
      set(RF.nfa, c, f(C_(RF.faClose))); set(RF.onca, c, f(P_(RF.onca)));
      set(RF.pay, c, f(`-${C_(RF.nPay)}`)); set(RF.ocl, c, f(`-${C_(RF.nOcl)}`));
      set(RF.eq, c, f(`${P_(RF.eq)}+${C_(RF.ni)}+${C_(RF.cDiv)}`), S.numB);
    }
    set(RF.ca, c, f(`SUM(${C_(RF.cash)}:${C_(RF.oca)})`)); set(RF.nca, c, f(`SUM(${C_(RF.nfa)}:${C_(RF.onca)})`)); set(RF.assets, c, f(`SUM(${C_(RF.nca)},${C_(RF.ca)})`));
    set(RF.stp, c, f(AS(RA.stp, a)), S.numLink); set(RF.stl, c, f(`SUM(${C_(RF.stp)}:${C_(RF.ocl)})`));
    set(RF.oltl, c, f(AS(RA.oltl, a)), S.numLink); set(RF.debt, c, f(AS(RA.debt, a)), S.numLink); set(RF.ltl, c, f(`SUM(${C_(RF.oltl)}:${C_(RF.debt)})`));
    set(RF.le, c, f(`SUM(${C_(RF.eq)},${C_(RF.ltl)},${C_(RF.stl)})`)); set(RF.bsChk, c, f(`ROUND(${C_(RF.assets)}-${C_(RF.le)},6)`), S.chkVal);
  });
  [RF.cash, RF.rec, RF.inv, RF.oca, RF.ca, RF.nfa, RF.onca, RF.nca, RF.assets, RF.stp, RF.pay, RF.ocl, RF.stl, RF.oltl, RF.debt, RF.ltl, RF.eq, RF.le].forEach((r) => set(r, TOT, f(A(r, L))));
  set(RF.bsChk, CHK, f(`SUM(${A(RF.bsChk, H(0))}:${A(RF.bsChk, L)})`), S.chkSum);

  // ── cash flow statement (forecast) ──
  set(RF.cfAmt, 3, f(`"All amounts in "&Assumptions!$G$${RA.ccy}`)); hdr(RF.cfHdr, "Cash Flow Statement", RF.cfIdx);
  set(RF.cfoHdr, 3, "Cash Flow from Operations");
  lbl(RF.cNi, f(`C${RF.ni}`), U); lbl(RF.cDep, f(`"Addback "&C${RF.dep}`), U);
  [[RF.cRec, RF.rec], [RF.cInv, RF.inv], [RF.cOca, RF.oca], [RF.cStp, RF.stp], [RF.cPay, RF.pay], [RF.cOcl, RF.ocl]].forEach(([r, b]) => lbl(r, f(`"Change in "&C${b}`), U));
  lbl(RF.cfo, f(`C${RF.cfoHdr}`), U); set(RF.cfiHdr, 3, "Cash Flow from Investments"); lbl(RF.cCapex, "Capital Expenditures", U); lbl(RF.cfi, f(`C${RF.cfiHdr}`), U);
  set(RF.cffHdr, 3, "Cash Flow from Financing"); lbl(RF.cOltl, f(`"Change in "&C${RF.oltl}`), U); lbl(RF.cDebt, f(`"Change in "&C${RF.debt}`), U); lbl(RF.cDiv, "Dividends", U);
  lbl(RF.cff, f(`C${RF.cffHdr}`), U); lbl(RF.dCash, "Change in Cash", U); lbl(RF.cash0, "Cash Beginning", U); lbl(RF.cash1, "Cash End", U); lbl(RF.cashChk, "Check");
  for (let k = 1; k <= N; k++) {
    const c = F(k), a = X.aF(k), P_ = (r) => A(r, c - 1), C_ = (r) => A(r, c);
    set(RF.cNi, c, f(C_(RF.ni))); set(RF.cDep, c, f(`-${C_(RF.dep)}`));
    set(RF.cRec, c, f(`${P_(RF.rec)}-${C_(RF.rec)}`)); set(RF.cInv, c, f(`${P_(RF.inv)}-${C_(RF.inv)}`)); set(RF.cOca, c, f(`${P_(RF.oca)}-${C_(RF.oca)}`));
    set(RF.cStp, c, f(`${C_(RF.stp)}-${P_(RF.stp)}`)); set(RF.cPay, c, f(`${C_(RF.pay)}-${P_(RF.pay)}`)); set(RF.cOcl, c, f(`${C_(RF.ocl)}-${P_(RF.ocl)}`));
    set(RF.cfo, c, f(`SUM(${C_(RF.cNi)}:${C_(RF.cOcl)})`));
    set(RF.cCapex, c, f(`-${AS(RA.capex, a)}`), S.numLink); set(RF.cfi, c, f(`SUM(${C_(RF.cCapex)}:${C_(RF.cCapex)})`));
    set(RF.cOltl, c, f(`${C_(RF.oltl)}-${P_(RF.oltl)}`)); set(RF.cDebt, c, f(AS(RA.dDebt, a)), S.numLink);
    set(RF.cDiv, c, f(`MIN(-${C_(RF.cNi)}*Assumptions!$G$${RA.payout},0)`), S.numLink);
    set(RF.cff, c, f(`SUM(${C_(RF.cOltl)}:${C_(RF.cDiv)})`)); set(RF.dCash, c, f(`${C_(RF.cfo)}+${C_(RF.cfi)}+${C_(RF.cff)}`));
    set(RF.cash0, c, f(k === 1 ? A(RF.cash, H(2)) : P_(RF.cash1))); set(RF.cash1, c, f(`${C_(RF.cash0)}+${C_(RF.dCash)}`));
    set(RF.cashChk, c, f(`ROUND(${C_(RF.cash)}-${C_(RF.cash1)},6)`), S.chkVal);
  }
  [RF.cNi, RF.cDep, RF.cRec, RF.cInv, RF.cOca, RF.cStp, RF.cPay, RF.cOcl, RF.cfo, RF.cCapex, RF.cfi, RF.cOltl, RF.cDebt, RF.cDiv, RF.cff, RF.dCash].forEach((r) => set(r, TOT, f(`SUM(${fr(r)})`)));
  set(RF.cash0, TOT, f(A(RF.cash0, F(1)))); set(RF.cash1, TOT, f(`${A(RF.cash0, TOT)}+${A(RF.dCash, TOT)}`));
  set(RF.cashChk, CHK, f(`SUM(${A(RF.cashChk, F(1))}:${A(RF.cashChk, L)})`), S.chkSum);
  set(RF.cfo, CHK, f(`ROUND(SUM(${A(RF.cNi, F(1))}:${A(RF.cOcl, L)})-SUM(${fr(RF.cfo)}),6)`), S.chkSum);

  // ── financial ratios ──
  set(RF.ratHdr, 3, "Financial Ratios"); set(RF.ratAmt, 3, f(`"All amounts in "&Assumptions!$G$${RA.ccy}`)); hdr(RF.ratHdr2, f(`C${RF.ratHdr}`), RF.ratIdx);
  lbl(RF.days, "Days per Year");
  set(RF.bankHdr, 3, "Bank Ratios"); lbl(RF.debtEbitda, "Financial Debt/EBITDA", "x"); lbl(RF.intCov, "Interest Coverage", "x"); lbl(RF.dsc, "Debt Service Coverage", "x");
  lbl(RF.eqPct, "Equity % of Invested Capital", "%"); lbl(RF.de, "Net Financial Debt/Equity", "%"); lbl(RF.intRate, f(`Assumptions!C${RA.intRate}`), "%");
  set(RF.liqHdr, 3, "Liquidity Ratios"); lbl(RF.cashR, "Cash Ratio", "x"); lbl(RF.quick, "Quick Ratio", "x"); lbl(RF.curR, "Current Ratio", "x");
  set(RF.grHdr, 3, "Growth Rates"); [[RF.grRev, "Revenue growth"], [RF.grGp, "Gross Profit Growth"], [RF.grEbitda, "EBITDA Growth "], [RF.grEbit, "EBIT Growth"], [RF.grNi, "Net Income Growth"], [RF.grAssets, "Asset Growth"], [RF.grEq, "Equity Growth"]].forEach(([r, t]) => lbl(r, t, "%"));
  set(RF.profHdr, 3, "Profitability"); lbl(RF.noplat, "NOPLAT", U); lbl(RF.revIc, "Revenue/Invested Capital", "x"); lbl(RF.roic, "ROIC", "%"); lbl(RF.roa, "ROA", "%"); lbl(RF.roe, "ROE", "%"); lbl(RF.revAssets, "Revenues/Assets", "x");
  set(RF.effHdr, 3, "Efficiency"); lbl(RF.recDays, "Receivables", "Days Revenue"); lbl(RF.invDays, "Inventory", "Days Revenue"); lbl(RF.payDays, "Payables", "Days Revenue"); lbl(RF.ccc, "Cash Conversion", "Days");
  lbl(RF.taxRate, "Tax rate (on EBIT in the DCF)", "%");
  set(RF.ebsHdr, 3, "Economic Balance Sheet"); lbl(RF.eEq, f(`C${RF.eq}`), U); lbl(RF.eOltl, f(`C${RF.oltl}`), U); lbl(RF.eDebt, f(`C${RF.debt}`), U); lbl(RF.eCash, "./. Cash", U); lbl(RF.ic, "Invested Capital", U);
  lbl(RF.eNwc, "Net Working Capital", U); lbl(RF.eFa, f(`C${RF.nca}`), U); lbl(RF.ce, "Capital Employed", U); lbl(RF.icChk, "Check");
  allC.forEach((c) => {
    const isF = c > 13, a = aCol(c), P_ = (r) => A(r, c - 1), C_ = (r) => A(r, c), yr = A(RF.ratHdr2, c);
    set(RF.days, c, f(`DATE(${yr},12,31)-DATE(${yr},1,1)+1`));
    set(RF.debtEbitda, c, f(`IFERROR(${C_(RF.eDebt)}/${C_(RF.ebitda)},"NA")`)); set(RF.intCov, c, f(`IFERROR(${C_(RF.ebit)}/-${C_(RF.int)},"NA")`));
    set(RF.dsc, c, f(`IFERROR(${C_(RF.ni)}/${C_(RF.debt)},"NA")`)); set(RF.eqPct, c, f(`IFERROR(${C_(RF.eEq)}/${C_(RF.ic)},"NA")`));
    set(RF.de, c, f(`IFERROR(SUM(${C_(RF.eDebt)}:${C_(RF.eCash)})/${C_(RF.eEq)},"NA")`));
    set(RF.intRate, c, isF ? f(c === F(1) ? `Assumptions!$G$${RA.intRate}` : P_(RF.intRate)) : f(`-IFERROR(${C_(RF.int)}/AVERAGE(${P_(RF.debt)}:${C_(RF.debt)}),0)`), isF && c === F(1) ? S.pctLink : undefined);
    set(RF.cashR, c, f(`IFERROR(${C_(RF.cash)}/SUM(${C_(RF.pay)}:${C_(RF.ocl)}),"NA")`)); set(RF.quick, c, f(`IFERROR(SUM(${C_(RF.cash)}:${C_(RF.rec)})/SUM(${C_(RF.pay)}:${C_(RF.ocl)}),"NA")`));
    set(RF.curR, c, f(`IFERROR(SUM(${C_(RF.cash)}:${C_(RF.oca)})/${C_(RF.stl)},"NA")`));
    [[RF.grRev, RF.rev], [RF.grGp, RF.gp], [RF.grEbitda, RF.ebitda], [RF.grEbit, RF.ebit], [RF.grNi, RF.ni], [RF.grAssets, RF.assets], [RF.grEq, RF.eq]].forEach(([r, b]) => set(r, c, f(`IFERROR(${C_(b)}/${P_(b)}-1,"NA")`)));
    set(RF.noplat, c, isF ? f(`DCF!${a1(RD.ebit, X.dF(c - 13))}+DCF!${a1(RD.tax, X.dF(c - 13))}`) : f(`${C_(RF.ebit)}*(1-${C_(RF.taxRate)})`), isF ? S.numLink : undefined);
    set(RF.revIc, c, f(`IFERROR(${C_(RF.rev)}/AVERAGE(${P_(RF.ic)}:${C_(RF.ic)}),0)`)); set(RF.roic, c, f(`IFERROR(${C_(RF.noplat)}/AVERAGE(${P_(RF.ic)}:${C_(RF.ic)}),"NA")`));
    set(RF.roa, c, f(`IFERROR((${C_(RF.ni)}-${C_(RF.int)})/AVERAGE(${P_(RF.assets)}:${C_(RF.assets)}),"NA")`)); set(RF.roe, c, f(`IFERROR(${C_(RF.ni)}/AVERAGE(${P_(RF.eq)}:${C_(RF.eq)}),"NA")`));
    set(RF.revAssets, c, f(`IFERROR(${C_(RF.rev)}/${C_(RF.assets)},"NA")`));
    set(RF.recDays, c, f(`IFERROR(${C_(RF.rec)}/${C_(RF.rev)}*365,0)`)); set(RF.invDays, c, f(`IFERROR(${C_(RF.inv)}/${C_(RF.rev)}*365,0)`)); set(RF.payDays, c, f(`IFERROR(${C_(RF.pay)}/${C_(RF.rev)}*365,0)`));
    set(RF.ccc, c, f(`SUM(${C_(RF.recDays)}:${C_(RF.invDays)})-${C_(RF.payDays)}`));
    set(RF.taxRate, c, isF ? f(`${AS(RA.taxRate, a)}+${X.flexRef("tax")}/100`) : f(`-IFERROR(${C_(RF.tax)}/${C_(RF.ebt)},0)`), isF ? S.pctLink : undefined);
    set(RF.eEq, c, f(C_(RF.eq))); set(RF.eOltl, c, f(C_(RF.oltl))); set(RF.eDebt, c, f(C_(RF.debt))); set(RF.eCash, c, f(`-${C_(RF.cash)}`)); set(RF.ic, c, f(`SUM(${C_(RF.eEq)}:${C_(RF.eCash)})`));
    set(RF.eNwc, c, f(`SUM(${C_(RF.rec)}:${C_(RF.oca)})-${C_(RF.stl)}`)); set(RF.eFa, c, f(C_(RF.nca))); set(RF.ce, c, f(`SUM(${C_(RF.eNwc)}:${C_(RF.eFa)})`));
    set(RF.icChk, c, f(`ROUND(${C_(RF.ic)}-${C_(RF.ce)},6)`), S.chkVal);
  });
  set(RF.icChk, CHK, f(`SUM(${A(RF.icChk, H(0))}:${A(RF.icChk, L)})`), S.chkSum);
  [RF.eEq, RF.eOltl, RF.eDebt, RF.eCash, RF.ic, RF.eNwc, RF.eFa, RF.ce, RF.taxRate].forEach((r) => set(r, TOT, f(A(r, L))));

  // ── net working capital schedule (incremental intensities on Δ revenue; reconciles to the engine's ΔNWC) ──
  set(RF.nwcHdr, 3, "Net Working Capital");
  [[RF.nRec, RF.rec], [RF.nInv, RF.inv], [RF.nOca, RF.oca], [RF.nStp, RF.stp], [RF.nPay, RF.pay], [RF.nOcl, RF.ocl]].forEach(([r, b]) => lbl(r, f(`C${b}`), U));
  lbl(RF.nwc, "Net Working Capital", U); lbl(RF.nwcChk, "Check");
  set(RF.nOca, 5, "incl. true-up to the NWC driver", S.note);
  allC.forEach((c) => {
    const isF = c > 13, a = aCol(c), P_ = (r) => A(r, c - 1), C_ = (r) => A(r, c), dRev = `(${C_(RF.rev)}-${P_(RF.rev)})`;
    if (!isF) {
      set(RF.nRec, c, f(C_(RF.rec))); set(RF.nInv, c, f(C_(RF.inv))); set(RF.nOca, c, f(C_(RF.oca)));
      set(RF.nStp, c, f(`-${C_(RF.stp)}`)); set(RF.nPay, c, f(`-${C_(RF.pay)}`)); set(RF.nOcl, c, f(`-${C_(RF.ocl)}`));
    } else {
      set(RF.nRec, c, f(`${P_(RF.nRec)}+${dRev}*Assumptions!$G$${RA.recD}/365`));
      set(RF.nInv, c, f(`${P_(RF.nInv)}+${dRev}*Assumptions!$G$${RA.invD}/365`));
      set(RF.nOca, c, f(`${P_(RF.nOca)}+${dRev}*(${AS(RA.wcPct, a)}+${X.flexRef("wc")}/100-Assumptions!$G$${RA.nwcImpl}+Assumptions!$G$${RA.ocaP})`));
      set(RF.nStp, c, f(P_(RF.nStp)));
      set(RF.nPay, c, f(`${P_(RF.nPay)}-${dRev}*Assumptions!$G$${RA.payD}/365`));
      set(RF.nOcl, c, f(`${P_(RF.nOcl)}-${dRev}*Assumptions!$G$${RA.oclP}`));
    }
    set(RF.nwc, c, f(`SUM(${C_(RF.nRec)}:${C_(RF.nOcl)})`)); set(RF.nwcChk, c, f(`ROUND(${C_(RF.nwc)}-${C_(RF.eNwc)},6)`), S.chkVal);
  });
  set(RF.nwcChk, CHK, f(`SUM(${A(RF.nwcChk, H(0))}:${A(RF.nwcChk, L)})`), S.chkSum);

  // ── fixed asset schedule (net PP&E roll-forward: opening + capex − D&A) ──
  set(RF.faAmt, 3, f(`"All amounts in "&Assumptions!$G$${RA.ccy}`)); hdr(RF.faHdr, "Fixed Asset Schedule", RF.faIdx);
  lbl(RF.faDepPct, f(`Assumptions!K${RA.depPct}`), "%"); lbl(RF.faCapex, "Capital Expenditures", U);
  lbl(RF.faOpen, "Opening Net Fixed Assets", U); lbl(RF.faAdd, "+ Capital Expenditures", U); lbl(RF.faDep, "− Depreciation & Amortisation", U); lbl(RF.faClose, "Closing Net Fixed Assets", U);
  lbl(RF.faDepLine, "Depreciation & Amortisation", U); lbl(RF.faGross, "Gross Fixed Assets (from opening net)", U); lbl(RF.faAcc, "Accumulated Depreciation (forecast)", U); lbl(RF.faNet, "Fixed Assets", U);
  for (let k = 1; k <= N; k++) {
    const c = F(k), a = X.aF(k), P_ = (r) => A(r, c - 1), C_ = (r) => A(r, c);
    set(RF.faDepPct, c, f(AS(RA.depPct, a)), S.pctLink);
    set(RF.faCapex, c, f(AS(RA.capex, a)), S.numLinkB);
    set(RF.faOpen, c, f(k === 1 ? A(RF.nfa, H(2)) : P_(RF.faClose))); set(RF.faAdd, c, f(C_(RF.faCapex))); set(RF.faDep, c, f(C_(RF.dep)));
    set(RF.faClose, c, f(`SUM(${C_(RF.faOpen)}:${C_(RF.faDep)})`));
    set(RF.faDepLine, c, f(`-${C_(RF.dep)}`)); set(RF.faGross, c, f(`${k === 1 ? A(RF.nfa, H(2)) : P_(RF.faGross)}+${C_(RF.faCapex)}`));
    set(RF.faAcc, c, f(`${k === 1 ? "0" : P_(RF.faAcc)}+${C_(RF.faDepLine)}`)); set(RF.faNet, c, f(`${C_(RF.faGross)}-${C_(RF.faAcc)}`));
  }
  set(RF.faCapex, TOT, f(`SUM(${fr(RF.faCapex)})`)); set(RF.faDepLine, TOT, f(`SUM(${fr(RF.faDepLine)})`));
  set(RF.faNet, CHK, f(`ROUND(SUM(${fr(RF.faNet)})-SUM(${fr(RF.faClose)}),6)`), S.chkSum);

  // ── chart data (feeds the template charts; check boxes toggle series) ──
  set(RF.chAmt, 3, f(`"All amounts in "&Assumptions!$G$${RA.ccy}`)); hdr(RF.chHdr, "Chart Data", RF.chIdx);
  set(RF.chRevHdr, 3, "Revenues and Profits"); set(RF.chBsHdr, 3, "Balance Sheet"); set(RF.chFcfHdr, 3, "Free Cash Flows");
  [[RF.chRev, RF.rev, U], [RF.chEbitda, RF.ebitda, U], [RF.chM, RF.m, "% of Revenue"], [RF.chNi, RF.ni, U], [RF.chRoic, RF.roic, "%"], [RF.chNwc, RF.eNwc, U], [RF.chFa, RF.eFa, U], [RF.chCash, RF.cash, U]].forEach(([r, b, u]) => {
    lbl(r, f(`C${b}`), u); set(r, 5, true);
    for (let k = 1; k <= N; k++) set(r, F(k), f(`IF($E${r},${A(b, F(k))},NA())`));
  });
  for (let k = 1; k <= N; k++) set(RF.chFcfHdr, F(k), f(A(RF.chIdx, F(k))));
  set(RF.chFcfHdr, L + 1, "Terminal Value", S.idxVal);
  lbl(RF.chFcf, f(`DCF!C${RD.vFcff}`), U); lbl(RF.chTv, f(`DCF!C${RD.vTv}`), U); lbl(RF.chDf, "Discount Factor", "x"); lbl(RF.chDcf, f(`DCF!C${RD.pvTot}`), U);
  [RF.chFcf, RF.chTv, RF.chDcf].forEach((r) => set(r, 5, true));
  for (let k = 1; k <= N; k++) {
    const c = F(k), dc = X.dF(k);
    set(RF.chFcf, c, f(`IF($E${RF.chFcf},DCF!${a1(RD.vFcff, dc)},NA())`)); set(RF.chDf, c, f(`DCF!${a1(RD.df, dc)}`));
    set(RF.chDcf, c, f(`IF($E${RF.chDcf},${A(RF.chFcf, c)}*${a1(RF.chDf, c, true, false)},NA())`));
  }
  set(RF.chFcf, L + 1, f(`IF($E${RF.chTv},DCF!${a1(RD.vTv, X.dLast)},NA())`)); set(RF.chDf, L + 1, f(A(RF.chDf, L)));
  set(RF.chDcf, L + 1, f(`IF($E${RF.chDcf},${A(RF.chFcf, L + 1)}*${A(RF.chDf, L + 1)},NA())`));
  // terminal value models (chart 4) — fixed columns N/O/P/Q
  set(RF.chSel, 17, f(`"Selected: "&'Terminal Value'!C${RT.sel}`)); set(RF.chTvHdr, 17, null);
  set(RF.chTvHdr, 3, "Terminal Value Models"); set(RF.chTvHdr, 15, "TV"); set(RF.chTvHdr, 16, "PV of TV");
  set(RF.chTvFlag, 3, f(`O${RF.chTvHdr}&" "&O${RF.chTvFlag}`)); set(RF.chTvFlag, 5, true); set(RF.chTvFlag, 15, f(`"(Year "&${a1(RF.idx, L, true, true)}&")"`)); set(RF.chTvFlag, 16, "(Year 0)"); set(RF.chTvFlag, 17, f(`O${RF.chTvFlag}`));
  set(RF.chPvFlag, 3, f(`P${RF.chTvHdr}&" "&P${RF.chTvFlag}`)); set(RF.chPvFlag, 5, true);
  sh.merge(`Q${RF.chSel}:S${RF.chTvHdr}`);
  for (let k = 0; k < 11; k++) {
    const r = RF.chTv0 + k;
    set(r, 3, f(`'Terminal Value'!C${RT.sum0 + k}`)); set(r, 5, true); set(r, 7, U);
    set(r, 15, f(`IF(AND($E$${RF.chTvFlag},$E${r}),'Terminal Value'!H${RT.sum0 + k},NA())`));
    set(r, 16, f(`IF(AND($E$${RF.chPvFlag},$E${r}),'Terminal Value'!J${RT.sum0 + k},NA())`));
    set(r, 17, f(`'Terminal Value'!$H$${RT.sel}`));
  }
  X.sparkRows = [RF.rev, RF.g, RF.gp, RF.ebitda, RF.m, RF.ebit, RF.ebt, RF.ni, RF.cash, RF.ca, RF.nfa, RF.assets, RF.debt, RF.eq, RF.cNi, RF.cRec, RF.cfo, RF.cCapex, RF.cff, RF.dCash, RF.cash1,
    RF.debtEbitda, RF.intCov, RF.roic, RF.roe, RF.revIc, RF.recDays, RF.payDays, RF.ccc, RF.ic, RF.nwc, RF.faClose];
}

/* ═══════════════════════════════ DCF ═══════════════════════════════ */
function buildDcf(X) {
  const sh = X.wb.sheet(SN.dcf), S = X.S, N = X.N, st = X.wb.styles;
  const F = X.dF, L = X.dLast, CHK = X.dChk;
  const ymap = (c) => { if (c <= 13) return c; if (c === 14) return F(1); if (c === 15) return N > 2 ? range(F(2), F(N - 1)) : null; if (c === 16 || c === 17) return null; if (c === 18) return F(N); return c + N - 5; };
  const idmap = (c) => (c >= 19 ? c + N - 5 : c);
  sh.remapCols(ymap);
  const same = (a, b) => range(a, b).map((r) => [r, r]);
  cloneRows(sh, [[2, 2], [3, 3], ...same(5, 41)], ymap);
  cloneRows(sh, [...same(45, 51), [52, 50], [53, 51], [54, 50], [55, 50], [56, 50], [58, 53], [59, 54], [60, 55], [61, 56], [62, 57], [63, 58]], idmap);
  const set = (r, c, v, s) => sh.set(r, c, v, s), f = (x) => ({ f: x }), A = (r, c) => a1(r, c);
  const FIN = (r, k) => `Financials!${a1(r, X.fF(k))}`;
  set(2, 2, f('SUBSTITUTE(Title!$B$4,CHAR(10)," · ")')); set(2, CHK, "Check"); set(3, CHK, f(`SUM(${A(4, CHK)}:${A(70, CHK)})`), S.chkSum);
  set(RD.hdr, 3, "Free Cash Flow to Firm"); set(RD.amt, 3, f(`"All amounts in "&Assumptions!$G$${RA.ccy}`));
  set(RD.yr, 1, 1); set(RD.yr, 3, f(`C${RD.hdr}`)); set(RD.idx, 3, "Year");
  set(RD.yr, 13, f(`Financials!M$${RF.yr}`), S.hdrYearA); set(RD.idx, 13, f(`Financials!M$${RF.idx}`));
  for (let k = 1; k <= N; k++) { set(RD.yr, F(k), f(`Financials!${a1(RF.yr, X.fF(k), true, false)}`)); set(RD.idx, F(k), f(`Financials!${a1(RF.idx, X.fF(k), true, false)}`)); }
  set(RD.w, 3, f(`Assumptions!C${RA.waccUsed}`)); set(RD.w, 8, "%"); set(RD.w, 13, f(`Assumptions!G${RA.waccUsed}`), S.pct2Link);
  set(RD.method, 3, f(`Assumptions!C${RA.disc}&" and Period"`)); set(RD.method, 8, f(`Assumptions!E${RA.disc}`)); set(RD.method, 13, f(`Assumptions!G${RA.disc}`));
  set(RD.mid, 3, f(`Assumptions!R${RA.sel.mid}`)); set(RD.mid, 6, f(`Assumptions!T${RA.sel.mid}`));
  set(RD.end, 3, f(`Assumptions!R${RA.sel.end}`)); set(RD.end, 6, f(`Assumptions!T${RA.sel.end}`));
  set(RD.sel, 3, f(`'Terminal Value'!C${RT.sel - 1}`)); set(RD.sel, 13, f(`'Executive Summary'!$P$81`));
  set(RD.fHdr, 3, f(`C${RD.yr}`));
  const U = f(`Assumptions!$G$${RA.ccy}`);
  [[RD.ebit, "EBIT"], [RD.tax, "Adjusted Tax on EBIT (t × EBIT)"], [RD.dep, "Addback Depreciation & Amortisation"], [RD.nwc, "Change in Net Working Capital"], [RD.capex, "CAPEX"], [RD.fcff, f(`C${RD.fHdr}`)], [RD.nopat, "Memo: NOPAT (EBIT − tax)"]]
    .forEach(([r, t]) => { set(r, 3, t); set(r, 8, U); });
  sh.cloneRow(RD.nopat, 20, ymap);
  set(RD.nopat, 3, "Memo: NOPAT (EBIT − tax)", S.lbl); set(RD.nopat, 8, U, S.unit);
  for (let k = 1; k <= N; k++) {
    const c = F(k), C_ = (r) => A(r, c);
    set(RD.ebit, c, f(FIN(RF.ebit, k)), S.numLinkB);
    set(RD.tax, c, f(`-${C_(RD.ebit)}*${FIN(RF.taxRate, k)}`));
    set(RD.dep, c, f(FIN(RF.cDep, k)), S.numLink);
    set(RD.nwc, c, f(`SUM(${FIN(RF.cRec, k)}:${a1(RF.cOcl, X.fF(k))})`), S.numLink);
    set(RD.capex, c, f(FIN(RF.cCapex, k)), S.numLink);
    set(RD.fcff, c, f(`SUM(${C_(RD.ebit)}:${C_(RD.capex)})`));
    set(RD.nopat, c, f(`${C_(RD.ebit)}+${C_(RD.tax)}`), S.num);
  }
  set(RD.ebit, CHK, f(`ROUND(SUM(${A(RD.ebit, F(1))}:${A(RD.ebit, L)})-SUM(${FIN(RF.ebit, 1)}:${a1(RF.ebit, X.fLast)}),6)`), S.chkSum);
  set(RD.fcff, CHK, f(`ROUND(SUM(${A(RD.ebit, F(1))}:${A(RD.capex, L)})-SUM(${A(RD.fcff, F(1))}:${A(RD.fcff, L)}),6)`), S.chkSum);
  // valuation
  set(RD.vHdr, 3, "DCF Valuation"); set(RD.vAmt, 3, f(`"All amounts in "&Assumptions!$G$${RA.ccy}`));
  set(RD.vYr, 1, f(`A${RD.yr}+1`)); set(RD.vYr, 3, f(`C${RD.vHdr}`)); set(RD.vYr, 8, "Unit"); set(RD.vIdx, 3, "Year");
  for (let k = 1; k <= N; k++) { set(RD.vYr, F(k), f(`Financials!${a1(RF.yr, X.fF(k), true, false)}`)); set(RD.vIdx, F(k), f(`Financials!${a1(RF.idx, X.fF(k), true, false)}`)); }
  [[RD.vFcff, f(`C${RD.fHdr}`)], [RD.vTv, "Terminal Value (TV)"], [RD.vTot, f(`C${RD.vFcff}&" incl. TV"`)], [RD.period, "Discounting Period"], [RD.df, "Discount Factor"], [RD.pvF, "PV of Forecast Period"], [RD.pvTv, "PV of Terminal Value"], [RD.pvTot, "Discounted Cash Flows"]]
    .forEach(([r, t]) => set(r, 3, t));
  [RD.vFcff, RD.vTv, RD.vTot, RD.pvTot].forEach((r) => set(r, 8, U)); set(RD.period, 8, "Years"); set(RD.df, 8, "x");
  for (let k = 1; k <= N; k++) {
    const c = F(k), C_ = (r) => A(r, c);
    set(RD.vFcff, c, f(C_(RD.fcff)));
    set(RD.vTv, c, k === N ? f(`'Terminal Value'!$H$${RT.sel}`) : null, k === N ? S.numLink : undefined);
    set(RD.vTot, c, f(`SUM(${C_(RD.vFcff)}:${C_(RD.vTv)})`));
    set(RD.period, c, k === 1 ? f(`IF($M$${RD.method}=$C$${RD.mid},$F$${RD.mid},IF($M$${RD.method}=$C$${RD.end},$F$${RD.end},0))`) : f(`${A(RD.period, c - 1)}+1`));
    set(RD.df, c, f(`1/(1+$M$${RD.w})^${C_(RD.period)}`));
    set(RD.pvF, c, f(`${C_(RD.vFcff)}*${a1(RD.df, c, true, false)}`));
    set(RD.pvTv, c, k === N ? f(`${C_(RD.vTv)}*${a1(RD.df, c, true, false)}`) : null);
    set(RD.pvTot, c, f(`SUM(${C_(RD.pvF)}:${C_(RD.pvTv)})`));
  }
  // result
  const Lc = CN(L);
  set(RD.resHdr, 3, "DCF Valuation Result"); set(RD.resHdr, 13, "Value", S.hdrTextR); set(RD.resHdr, 16, f(`"Terminal Value Y"&${Lc}${RD.vIdx}`));
  const rres = [[RD.rPvTv, f(`C${RD.pvTv}`), f(`${Lc}${RD.pvTv}`)], [RD.rPvF, f(`C${RD.pvF}`), f(`M${RD.ev}-M${RD.rPvTv}`)], [RD.ev, "Enterprise Value", f(`SUM(${A(RD.pvTot, F(1))}:${A(RD.pvTot, L)})`)],
    [RD.debt, "./. Financial Debt (incl. leases)", f(`-Financials!$M$${RF.debt}`)], [RD.cash, "Cash", f(`Financials!$M$${RF.cash}`)], [RD.eqv, "Equity Value", f(`SUM(M${RD.ev}:M${RD.cash})`)]];
  rres.forEach(([r, t, v]) => { set(r, 3, t); set(r, 8, U); set(r, 13, v); set(r, 14, f(`IFERROR(M${r}/M$${RD.ev},0)`)); });
  set(RD.debt, 13, f(`-Financials!$M$${RF.debt}`), S.numLink); set(RD.cash, 13, f(`Financials!$M$${RF.cash}`), S.numLink);
  set(RD.shares, 3, "Shares outstanding"); set(RD.shares, 8, f(`Assumptions!E${RA.shares}`)); set(RD.shares, 13, f(`Assumptions!$G$${RA.shares}`), st.variant(S.numLink, { numFmt: "#,##0.0000" })); set(RD.shares, 14, null);
  set(RD.ps, 3, "Implied Value per Share"); set(RD.ps, 8, f(`Assumptions!E${RA.price}`)); set(RD.ps, 13, f(`IFERROR(M${RD.eqv}/M${RD.shares},0)`), S.pxB); set(RD.ps, 14, null);
  set(RD.px, 3, "Current Share Price"); set(RD.px, 8, f(`Assumptions!E${RA.price}`)); set(RD.px, 13, f(`Assumptions!$G$${RA.price}`), S.pxLink); set(RD.px, 14, null);
  set(RD.up, 3, "Upside / (Downside)"); set(RD.up, 8, "%"); set(RD.up, 13, f(`IFERROR(M${RD.ps}/M${RD.px}-1,0)`), S.upPctB); set(RD.up, 14, null);
  set(RD.psTable, 3, "Value per share (analysis tables)", S.note); set(RD.psTable, 8, null);
  set(RD.psTable, 13, f(`IF(AND(ISERROR(SEARCH("Exit",M${RD.sel})),Assumptions!$G$${RA.waccUsed}<=Assumptions!$G$${RA.vdf.g}),"n.m.",M${RD.ps})`), S.px); set(RD.psTable, 14, null);
  // terminal-year bridge (P–R)
  [[46, "Enterprise Value", f(`${Lc}${RD.vTv}`)], [47, "./. Financial Debt", f(`-Financials!$${CN(X.fLast)}$${RF.debt}`)], [48, "Cash", f(`Financials!$${CN(X.fLast)}$${RF.cash}`)], [49, "Equity Value", f("SUM(R46:R48)")]]
    .forEach(([r, t, v]) => { set(r, 16, t); set(r, 17, U); set(r, 18, v); });
  // implied multiples
  set(RD.mHdr, 3, "Implied Multiples"); set(RD.mHdr, 13, "Current", S.hdrTextR); set(RD.mHdr, 14, f(`"Year "&N${RD.vIdx}`)); set(RD.mHdr, 18, f(`"Terminal Value Y"&${Lc}${RD.vIdx}`));
  const mm = [[RD.mRev, RA.exRev, RF.rev, "$M$" + RD.ev, "$R$46"], [RD.mEbitda, RA.exEbitda, RF.ebitda, "$M$" + RD.ev, "$R$46"], [RD.mEbit, RA.exEbit, RF.ebit, "$M$" + RD.ev, "$R$46"], [RD.mPe, RA.exPe, RF.ni, "$M$" + RD.eqv, "$R$49"], [RD.mPb, RA.exPb, RF.eq, "$M$" + RD.eqv, "$R$49"]];
  mm.forEach(([r, ar, fr_, v0, vT]) => {
    set(r, 3, f(`Assumptions!$C$${ar}`)); set(r, 8, "x");
    set(r, 13, f(`IFERROR(${v0}/Financials!M$${fr_},"NA")`), S.x); set(r, 14, f(`IFERROR(${v0}/Financials!N$${fr_},"NA")`), S.x);
    set(r, 18, f(`IFERROR(${vT}/Financials!${CN(X.fLast)}$${fr_},0)`), S.x);
  });
}

/* ═══════════════════════════════ TERMINAL VALUE ═══════════════════════════════ */
function buildTerminalValue(X) {
  const sh = X.wb.sheet(SN.tv), S = X.S, N = X.N, st = X.wb.styles;
  const set = (r, c, v, s) => sh.set(r, c, v, s), f = (x) => ({ f: x }), A = (r, c) => a1(r, c);
  const FL = (r) => `Financials!${a1(r, X.fLast)}`;
  // template rows 2–138 (static legend rows keep their text)
  const staticRows = [29, 30, 31, 32, 49, 50, 51, 52, 53, 54, 87, 89, 92, 93, 94, 95, 96, 97, 122, 124];
  for (const r of range(2, 138)) sh.cloneRow(r, r, (c) => c, { values: staticRows.includes(r) });
  for (const r of range(91, 101)) sh.cloneRow(r, r <= 95 ? 91 : 96, (c) => (c >= 13 && c <= 16 ? c : null));
  const U = f(`Assumptions!$G$${RA.ccy}`);
  set(2, 2, f('SUBSTITUTE(Title!$B$4,CHAR(10)," · ")')); set(2, 21, "Check"); set(3, 21, f("SUM(U5:U846)"), S.chkSum);
  set(5, 3, "Terminal Value Models"); set(6, 3, f(`"All amounts in "&Assumptions!$G$${RA.ccy}`));
  const yrN = `Financials!${a1(RF.idx, X.fLast, true, true)}`;
  // 1 · capitalized earnings
  set(RT.capHdr, 1, 1); set(RT.capHdr, 3, f(`Assumptions!K${RA.tv0}`));
  set(RT.capEbit, 3, f(`Financials!C${RF.ebit}&" (Year "&${yrN}&")"`)); set(RT.capEbit, 7, U); set(RT.capEbit, 8, f(FL(RF.ebit)));
  set(RT.capTaxR, 3, "Tax Rate"); set(RT.capTaxR, 7, "%"); set(RT.capTaxR, 8, f(FL(RF.taxRate)));
  set(RT.capTax, 3, "Taxes on EBIT"); set(RT.capTax, 7, U); set(RT.capTax, 8, f(`-H${RT.capEbit}*H${RT.capTaxR}`));
  set(RT.capNopat, 3, "NOPLAT"); set(RT.capNopat, 7, U); set(RT.capNopat, 8, f(`H${RT.capEbit}+H${RT.capTax}`));
  set(RT.capW, 3, f(`Assumptions!C${RA.capRate}`)); set(RT.capW, 7, "%"); set(RT.capW, 8, f(`Assumptions!G${RA.capRate}`));
  set(RT.capTv, 3, f(`"TV "&C${RT.capHdr}`)); set(RT.capTv, 7, U); set(RT.capTv, 8, f(`MAX(IFERROR(H${RT.capNopat}/H${RT.capW},0),0)`));
  const cmp = (r) => set(r, 3, f(`HYPERLINK("#'Terminal Value'!C${RT.sel}","=> Compare "&$C$${RT.sum0 - 4})`));
  cmp(19);
  // 2 · Gordon growth (engine fallback: last FCFF × (1+g) ÷ (WACC − g), no floor)
  set(23, 3, f(`"All amounts in "&Assumptions!$G$${RA.ccy}`)); set(RT.gorHdr, 1, f(`A${RT.capHdr}+1`)); set(RT.gorHdr, 3, f(`Assumptions!K${RA.tv0 + 1}`));
  set(RT.gorFcf, 3, f(`DCF!C$${RD.fcff}&" (Year "&${yrN}&")"`)); set(RT.gorFcf, 7, U); set(RT.gorFcf, 8, f(`DCF!${a1(RD.fcff, X.dLast, true, false)}`));
  set(RT.gorW, 3, f(`Assumptions!$C$${RA.gorW}`)); set(RT.gorW, 7, "%"); set(RT.gorW, 8, f(`Assumptions!$G$${RA.gorW}`));
  set(RT.gorG, 3, "Terminal growth rate used"); set(RT.gorG, 7, "%"); set(RT.gorG, 8, f(`Assumptions!$G$${RA.vdf.g}`));
  set(RT.gorTv, 3, f(`"TV "&C${RT.gorHdr}`)); set(RT.gorTv, 7, U); set(RT.gorTv, 8, f(`IFERROR(H$${RT.gorFcf}*(1+$H$${RT.gorG})/($H$${RT.gorW}-$H$${RT.gorG}),0)`));
  cmp(38);
  // 3 · H-model
  set(42, 3, f(`"All amounts in "&Assumptions!$G$${RA.ccy}`)); set(RT.hHdr, 1, f(`A${RT.gorHdr}+1`)); set(RT.hHdr, 3, f(`Assumptions!K${RA.tv0 + 2}`)); set(RT.hHdr, 12, "Growth Rates"); set(44, 12, "%");
  set(RT.hFcf, 3, f(`DCF!C$${RD.fcff}&" (Year "&${yrN}&")"`)); set(RT.hFcf, 6, U); set(RT.hFcf, 7, f(`DCF!${a1(RD.fcff, X.dLast, true, false)}`));
  set(RT.hW, 3, "Discount Rate"); set(RT.hW, 6, "%"); set(RT.hW, 7, f(`Assumptions!$G$${RA.waccUsed}`));
  set(RT.hHigh, 3, f(`Assumptions!C${RA.hHigh}`)); set(RT.hHigh, 6, "%"); set(RT.hHigh, 7, f(`Assumptions!G${RA.hHigh}`));
  set(RT.hLow, 3, f(`Assumptions!C${RA.hLow}`)); set(RT.hLow, 6, "%"); set(RT.hLow, 7, f(`Assumptions!G${RA.hLow}`));
  set(RT.hPer, 3, f(`Assumptions!C${RA.hPeriod}`)); set(RT.hPer, 6, "Years"); set(RT.hPer, 7, f(`Assumptions!G${RA.hPeriod}`));
  set(RT.hStart, 3, "Start High Growth"); set(RT.hStart, 6, "Year"); set(RT.hStart, 7, f(`Assumptions!$G$${RA.horizon}+1`));
  set(RT.hStartL, 3, "Start Low Growth"); set(RT.hStartL, 6, "Year"); set(RT.hStartL, 7, f(`G${RT.hStart}+G${RT.hPer}`));
  set(RT.hTv, 3, f(`"TV "&C${RT.hHdr}`)); set(RT.hTv, 7, f(`IFERROR(((G${RT.hFcf}*(1+G${RT.hLow}))+(G${RT.hFcf}*(G${RT.hPer}/2)*(G${RT.hHigh}-G${RT.hLow})))/(G${RT.hW}-G${RT.hLow}),0)`));
  set(56, 12, f(`"High Growth Period (Year "&G${RT.hStart}&" - "&G${RT.hStartL}-1&")"`)); set(56, 15, f(`G${RT.hHigh}`));
  set(57, 12, f(`"Low Growth Period (Year "&G${RT.hStartL}&" - Infinity)"`)); set(57, 15, f(`G${RT.hLow}`));
  cmp(65);
  // 4 · exit multiples
  set(69, 3, f(`"All amounts in "&Assumptions!$G$${RA.ccy}`)); set(RT.exHdr, 1, f(`A${RT.hHdr}+1`)); set(RT.exHdr, 3, "Exit Multiples");
  set(72, 3, "Exit Valuation Method"); set(72, 9, "Exit Multiple"); set(72, 11, f(`"Fundamentals (Year "&${yrN}&")"`)); set(72, 15, "Terminal Value"); set(72, 16, "Debt"); set(72, 17, "Cash"); set(72, 18, "TV - Equity Value");
  [[RA.exRev, RF.rev, true], [RA.exEbitda, RF.ebitda, true], [RA.exEbit, RF.ebit, true], [RA.exPe, RF.ni, false], [RA.exPb, RF.eq, false]].forEach(([ar, fr_, isEv], k) => {
    const r = RT.ex0 + k;
    set(r, 3, f(`Assumptions!C${ar}`)); set(r, 7, "x"); set(r, 9, f(`Assumptions!G${ar}`), S.x2Link);
    set(r, 11, f(`Financials!C${fr_}`)); set(r, 12, U); set(r, 13, f(FL(fr_)));
    set(r, 16, f(`-${FL(RF.eDebt)}`)); set(r, 17, f(`-${FL(RF.eCash)}`));
    if (isEv) { set(r, 15, f(`I${r}*M${r}`)); set(r, 18, f(`SUM(O${r}:Q${r})`)); }
    else { set(r, 18, f(`I${r}*M${r}`)); set(r, 15, f(`R${r}-Q${r}-P${r}`)); }
    set(r, 21, f(`ROUND(SUM(O${r}:Q${r})-R${r},6)`), S.chkSum);
  });
  set(79, 3, f(`HYPERLINK("#'Terminal Value'!C${RT.sel}","=> Compare "&$C$${RT.sum0 - 4})`));
  // 5 · one-stage value driver (ROIC vs WACC table grows with the horizon)
  set(83, 3, f(`"All amounts in "&Assumptions!$G$${RA.ccy}`)); set(RT.osHdr, 1, f(`A${RT.exHdr}+1`)); set(RT.osHdr, 3, f(`Assumptions!K${RA.tv0 + 8}`)); set(RT.osHdr, 12, "ROIC vs. WACC");
  set(86, 12, f(`C96&" %"`)); set(86, 19, f(`C97&" %"`));
  set(87, 13, "Year"); set(87, 14, f(`Financials!C${RF.roic}`)); set(87, 15, "WACC"); set(87, 16, "Excess Return");
  set(89, 14, "%"); set(89, 15, "%"); set(89, 16, "%");
  for (let k = 1; k <= N; k++) {
    const r = RT.osTbl + k - 1;
    set(r, 13, f(`Financials!${a1(RF.idx, X.fF(k))}`)); set(r, 14, f(`Financials!${a1(RF.roic, X.fF(k))}`), S.pctLink); set(r, 15, f(`$G$${RT.osW}`), S.pct); set(r, 16, f(`N${r}-O${r}`), S.pct);
  }
  const rT = RT.osTbl + N;
  set(rT, 13, "Terminal Value"); set(rT, 14, f(`G${RT.osRoic}`), S.pct); set(rT, 15, f(`$G$${RT.osW}`), S.pct); set(rT, 16, f(`N${rT}-O${rT}`), S.pct);
  X.osLastRow = rT;
  set(99, 3, "Assumptions");
  set(RT.osW, 3, f(`Assumptions!K${RA.os.w}`)); set(RT.osW, 6, "%"); set(RT.osW, 7, f(`Assumptions!M${RA.os.w}`));
  set(RT.osSpread, 3, f(`Assumptions!K${RA.os.spread}`)); set(RT.osSpread, 6, "%"); set(RT.osSpread, 7, f(`Assumptions!M${RA.os.spread}`));
  set(RT.osRoic, 3, f(`C96`)); set(RT.osRoic, 6, "%"); set(RT.osRoic, 7, f(`G${RT.osW}+G${RT.osSpread}`));
  set(RT.osIc, 3, f(`Financials!C${RF.ic}&" (Year "&${yrN}&")"`)); set(RT.osIc, 6, U); set(RT.osIc, 7, f(FL(RF.ic)));
  set(RT.osNopat, 3, f(`"NOPLAT (Year "&${yrN}&")"`)); set(RT.osNopat, 6, U); set(RT.osNopat, 7, f(`G${RT.osIc}*G${RT.osRoic}`));
  set(RT.osG, 3, "Growth Rate"); set(RT.osG, 6, "%"); set(RT.osG, 7, f(`Assumptions!M${RA.os.g}`));
  set(RT.osTv, 3, f(`"TV "&C${RT.osHdr}`)); set(RT.osTv, 6, U); set(RT.osTv, 7, f(`MAX(IFERROR((G$${RT.osNopat}*(1+G${RT.osG})*(1-($G$${RT.osG}/G${RT.osRoic}))/($G$${RT.osW}-$G$${RT.osG})),0),0)`));
  set(107, 3, f(`HYPERLINK("#'Terminal Value'!C${RT.sel}","=> Compare "&$C$${RT.sum0 - 4})`));
  // 6 · two-stage value driver
  set(110, 3, f(`"All amounts in "&Assumptions!$G$${RA.ccy}`)); set(RT.tsHdr, 1, f(`A${RT.osHdr}+1`)); set(RT.tsHdr, 3, f(`Assumptions!K${RA.tv0 + 9}`)); set(RT.tsHdr, 12, "ROCE vs. WACC");
  set(RT.tsTv, 3, f(`"TV "&C${RT.tsHdr}`)); set(RT.tsTv, 6, U); set(RT.tsTv, 7, f(`'Two Stage Value Driver Model'!${a1(R2.tv, X.tF(N))}`), S.numLink);
  set(114, 3, f(`HYPERLINK("#'Two Stage Value Driver Model'!${a1(R2.tv, X.tF(N))}","=> Calculation of "&'Two Stage Value Driver Model'!$C$7)`));
  set(115, 3, f(`HYPERLINK("#'Terminal Value'!C${RT.sel}","=> Compare "&$C$${RT.sum0 - 4})`));
  // 7 · summary + selection
  set(119, 3, f(`"All amounts in "&Assumptions!$G$${RA.ccy}`)); set(RT.sumHdr, 1, f(`A${RT.tsHdr}+1`)); set(RT.sumHdr, 3, f(`C5&" Summary"`)); set(RT.sumHdr, 12, "Overview  - Terminal Value Results"); set(121, 12, U);
  set(122, 3, "Terminal Value Models"); set(122, 8, "TV"); set(122, 9, f(`"Factor (Y"&${yrN}&")"`)); set(122, 10, "PV of TV");
  set(123, 8, f(`"Year "&${yrN}`)); set(123, 10, "Year 0"); set(124, 8, U); set(124, 9, "x"); set(124, 10, U);
  const tvCells = [`H${RT.capTv}`, `H${RT.gorTv}`, `G${RT.hTv}`, ...range(0, 4).map((k) => `O${RT.ex0 + k}`), `G${RT.osTv}`, `G${RT.tsTv}`, `H${RT.vdfHdr + 25}`];
  tvMethods().forEach((m, k) => {
    const r = RT.sum0 + k;
    if (k === 10) { sh.cloneRow(r, 135, (c) => c); }
    set(r, 3, f(`HYPERLINK("#'${m.sheet || "Terminal Value"}'!${m.anchor}",Assumptions!$K$${RA.tv0 + k})`), S.hyper);
    set(r, 7, U); set(r, 8, f(tvCells[k])); set(r, 9, f(`I$${RT.sel}`)); set(r, 10, f(`H${r}*$I$${RT.sel}`));
  });
  set(RT.sel - 1, 3, "Selected Terminal Value Model");
  set(RT.sel, 3, f(`'Executive Summary'!$P$81`)); set(RT.sel, 7, U);
  set(RT.sel, 8, f(`IFERROR(INDEX('Terminal Value'!H${RT.sum0}:H${RT.sum0 + 10},MATCH('Terminal Value'!C${RT.sel},'Terminal Value'!C${RT.sum0}:C${RT.sum0 + 10},0)),0)`));
  set(RT.sel, 9, f(`DCF!${a1(RD.df, X.dLast)}`), st.variant(S.numLinkB, { numFmt: "0.0000" })); set(RT.sel, 10, f(`H${RT.sel}*I${RT.sel}`));
  // 8 · value driver fade — the website engine's terminal value
  const V = RT.vdfHdr, st2 = (r, t, v, s, u) => { set(r, 3, t); if (u !== undefined) set(r, 7, u); set(r, 8, v, s); };
  for (const [nr, tr] of [[V - 1, 119], [V, 120], [V + 2, 12], [V + 3, 13], [V + 4, 13], [V + 5, 13], [V + 6, 13], [V + 7, 13], [V + 8, 13], [V + 10, 122], ...range(V + 11, V + 16).map((r) => [r, 126]), ...range(V + 18, V + 25).map((r) => [r, 13]), [V + 25, 18]]) sh.cloneRow(nr, tr, (c) => c);
  set(V - 1, 3, f(`"All amounts in "&Assumptions!$G$${RA.ccy}`)); set(V, 1, f(`A${RT.sumHdr}+1`)); set(V, 3, f(`Assumptions!K${RA.tv0 + 10}`)); set(V, 12, "Stage-2 fade + value-driver perpetuity");
  st2(V + 2, f(`"NOPAT (Year "&${yrN}&")"`), f(`DCF!${a1(RD.nopat, X.dLast)}`), S.numLink, U);
  st2(V + 3, f(`"Revenue growth (Year "&${yrN}&")"`), f(FL(RF.g)), S.pct2Link, "%");
  st2(V + 4, "Terminal growth (g)", f(`Assumptions!$G$${RA.vdf.g}`), S.pct2Link, "%");
  st2(V + 5, "Return on new invested capital (RONIC)", f(`Assumptions!$G$${RA.vdf.ronic}`), S.pct2Link, "%");
  st2(V + 6, "Discount rate (WACC)", f(`Assumptions!$G$${RA.waccUsed}`), S.pct2Link, "%");
  st2(V + 7, "Stage-2 fade (years)", f(`Assumptions!$G$${RA.vdf.years}`), st.variant(S.numLink, { numFmt: "0" }), "Years");
  st2(V + 8, f(`"Discount period of Year "&${yrN}`), f(`DCF!${a1(RD.period, X.dLast)}`), st.variant(S.numLink, { numFmt: "0.0" }), "Years");
  set(V + 10, 3, "Stage-2 year k"); for (let k = 1; k <= 10; k++) set(V + 10, 7 + k, k, S.idxVal);
  const rowsV = [["Growth g(k) = g(N) + (g − g(N)) × k ÷ n", S.pct2], ["NOPAT", S.num], ["FCFF = NOPAT × (1 − max(0,g(k)) ÷ RONIC)", S.num], ["Discount period", st.variant(S.num, { numFmt: "0.0" })], ["Discount factor", st.variant(S.num, { numFmt: "0.0000" })], ["PV", S.num]];
  rowsV.forEach(([t], j) => set(V + 11 + j, 3, t, S.lbl));
  for (let k = 1; k <= 10; k++) {
    const c = 7 + k, C = CN(c), P = CN(c - 1), on = `${C}$${V + 10}<=$H$${V + 7}`;
    set(V + 11, c, f(`IF(${on},$H$${V + 3}+($H$${V + 4}-$H$${V + 3})*${C}$${V + 10}/$H$${V + 7},"")`), rowsV[0][1]);
    set(V + 12, c, f(`IF(${on},${k === 1 ? `$H$${V + 2}` : `${P}${V + 12}`}*(1+${C}${V + 11}),"")`), rowsV[1][1]);
    set(V + 13, c, f(`IF(${on},${C}${V + 12}*(1-MAX(0,${C}${V + 11})/$H$${V + 5}),"")`), rowsV[2][1]);
    set(V + 14, c, f(`IF(${on},$H$${V + 8}+${C}$${V + 10},"")`), rowsV[3][1]);
    set(V + 15, c, f(`IF(${on},1/(1+$H$${V + 6})^${C}${V + 14},"")`), rowsV[4][1]);
    set(V + 16, c, f(`IF(${on},${C}${V + 13}*${C}${V + 15},"")`), rowsV[5][1]);
  }
  st2(V + 18, "Σ PV of stage 2", f(`SUM(H${V + 16}:Q${V + 16})`), S.num, U);
  st2(V + 19, "NOPAT at the end of stage 2", f(`IF($H$${V + 7}=0,H${V + 2},INDEX(H${V + 12}:Q${V + 12},$H$${V + 7}))`), S.num, U);
  st2(V + 20, "Perpetuity = NOPAT × (1 + g) × (1 − g ÷ RONIC) ÷ (WACC − g)", f(`IFERROR(H${V + 19}*(1+H${V + 4})*(1-MAX(0,H${V + 4})/H${V + 5})/(H${V + 6}-H${V + 4}),0)`), S.num, U);
  st2(V + 21, "PV of the perpetuity", f(`H${V + 20}/(1+H${V + 6})^(H${V + 8}+H${V + 7})`), S.num, U);
  st2(V + 22, "PV of the terminal value (stage 2 + perpetuity)", f(`H${V + 18}+H${V + 21}`), S.numB, U);
  st2(V + 23, "Fallback when NOPAT ≤ 0 or RONIC ≤ 0: Gordon Growth on the last FCFF", f(`H${RT.gorTv}`), S.num, U);
  st2(V + 24, "Terminal value restated at the horizon (× (1 + WACC)^period of Year N)", f(`H${V + 22}*(1+H${V + 6})^H${V + 8}`), S.num, U);
  st2(V + 25, f(`"TV "&C${V}`), f(`IF(AND(H${V + 2}>0,H${V + 5}>0),H${V + 24},H${V + 23})`), S.numB, U);
  set(V + 26, 3, f(`HYPERLINK("#'Terminal Value'!C${RT.sel}","=> Compare "&$C$${RT.sum0 - 4})`), S.hyper);
}

/* ═══════════════════════════════ TWO STAGE VALUE DRIVER ═══════════════════════════════ */
function buildTwoStage(X) {
  const sh = X.wb.sheet(SN.vd2), S = X.S, N = X.N, Y = R2.CAP_YEARS;
  const E = X.tF, s = (j) => 13 + N + j, LE = E(N), LS = s(Y), CHK = X.vChk;
  const ymap = (c) => { if (c <= 13) return c; if (c === 14) return E(1); if (c === 15) return N > 2 ? range(E(2), E(N - 1)) : null; if (c === 16 || c === 17) return null; if (c === 18) return E(N); if (c === 19) return s(1); if (c === 20) return range(s(2), s(Y - 1)); if (c < 48) return null; if (c === 48) return s(Y); return c + N - 5; };
  const idmap = (c) => (c >= 49 ? c + N - 5 : c);
  sh.remapCols(ymap);
  for (const r of range(2, 47)) sh.cloneRow(r, r, ymap);
  for (const r of range(50, 78)) sh.cloneRow(r, r, (r === 50 || r === 51) ? idmap : ymap, { values: [52, 64].includes(r) });
  for (const r of range(81, 89)) sh.cloneRow(r, r, ymap);
  const set = (r, c, v, st_) => sh.set(r, c, v, st_), f = (x) => ({ f: x }), A = (r, c) => a1(r, c);
  const U = f(`Assumptions!$G$${RA.ccy}`);
  set(2, 2, f('SUBSTITUTE(Title!$B$4,CHAR(10)," · ")')); set(2, CHK, "Check"); set(3, CHK, f(`SUM(${A(5, CHK)}:${A(794, CHK)})`), S.chkSum);
  set(5, 3, f("C7")); set(6, 3, f(`"All amounts in "&Assumptions!$G$${RA.ccy}`));
  set(7, 1, 1); set(7, 3, f(`Assumptions!K${RA.tv0 + 9}`)); set(8, 3, "Year"); set(9, 3, "Terminal Value Year");
  set(7, 13, f(`Financials!M$${RF.yr}`)); set(8, 13, f(`Financials!M$${RF.idx}`));
  for (let k = 1; k <= N; k++) { set(7, E(k), f(`Financials!${a1(RF.yr, X.fF(k), true, false)}`)); set(8, E(k), f(`Financials!${a1(RF.idx, X.fF(k), true, false)}`)); }
  for (let j = 1; j <= Y; j++) { const c = s(j), p = CN(c - 1); set(7, c, f(`${p}7+1`)); set(8, c, f(`${p}8+1`)); set(9, c, j === 1 ? 1 : f(`${p}9+1`)); }
  // ROIC curves
  set(R2.roceHdr, 3, f(`Assumptions!R${RA.sel.roceHdr}`));
  [[R2.steady, RA.sel.steady], [R2.expo, RA.sel.expo], [R2.jump, RA.sel.jump]].forEach(([r, ar]) => { set(r, 3, f(`Assumptions!$K$${RA.ts.roic}`)); set(r, 4, f(`Assumptions!R${ar}`)); });
  set(R2.steady, 7, "Annual Decline:"); set(R2.steady, 9, f(`($I$60-$J$60)/($I$54)`)); set(R2.steady, 10, "%");
  set(R2.expo, 7, "Curve: (X-X1)² = Y"); set(R2.expo, 9, f(`($I$60-$J$60)/(($I$54)^2)`)); set(R2.expo, 10, "%");
  set(R2.roic, 3, f(`Assumptions!$K$${RA.ts.roic}`)); set(R2.roic, 4, f(`"Selected "&Assumptions!K${RA.ts.curve}`)); set(R2.roic, 8, "Exponential Decline", S.sel);
  sh.merge(`H${R2.roic}:I${R2.roic}`);
  for (let k = 1; k <= N; k++) { const c = E(k); [R2.steady, R2.expo, R2.jump].forEach((r) => set(r, c, f(`${A(R2.roic, c)}`))); set(R2.roic, c, f(`Financials!${a1(RF.roic, X.fF(k))}`), S.numLinkB && X.S.pctLink); }
  for (let j = 1; j <= Y; j++) {
    const c = s(j), C = CN(c), P = CN(c - 1);
    set(R2.steady, c, f(`IF(${C}$9<$I$54,${j === 1 ? `$I$60` : `${P}${R2.steady}`}-$I${R2.steady},$J$60)`));
    set(R2.expo, c, f(`IF(${C}$9<$I$54,$I$60-$I${R2.expo}*(${C}9^2),$J$60)`));
    set(R2.jump, c, f(`IF(${C}$9<$I$54,$I$60,$J$60)`));
    set(R2.roic, c, f(`IFERROR(INDEX(${C}$${R2.steady}:${C}$${R2.jump},MATCH($H$${R2.roic},$D$${R2.steady}:$D$${R2.jump},0)),0)`));
  }
  // financial forecast
  set(R2.fHdr, 3, "Financial Forecast");
  const lab = [[R2.rev, f(`Financials!C${RF.rev}`), U], [R2.g, f(`Financials!C${RF.g}`), "%"], [R2.ebitda, f(`Financials!C${RF.ebitda}`), U], [R2.m, f(`C${R2.ebitda}&" Margin"`), "%"], [R2.dep, f(`Financials!C${RF.dep}`), U],
    [R2.ebit, "EBIT", U], [R2.taxR, f(`Financials!C${RF.taxRate}`), "%"], [R2.tax, "Pro Forma Taxes", U], [R2.noplat, "NOPLAT", "NOPLAT"], [R2.netInv, "Net Investment", U], [R2.fcf, "Free Cash Flow to Firm", U],
    [R2.capex, f(`Financials!C${RF.cCapex}`), U], [R2.ic, "Invested Capital", U], [R2.turn, f(`Financials!C${RF.revIc}`), "x"]];
  lab.forEach(([r, t, u]) => { set(r, 3, t); set(r, 10, u); });
  for (let k = 1; k <= N; k++) {
    const c = E(k), fc = X.fF(k), C_ = (r) => A(r, c), FN = (r) => `Financials!${a1(r, fc)}`;
    set(R2.rev, c, f(FN(RF.rev))); set(R2.g, c, f(FN(RF.g))); set(R2.ebitda, c, f(FN(RF.ebitda))); set(R2.m, c, f(FN(RF.m))); set(R2.dep, c, f(FN(RF.dep)));
    set(R2.ebit, c, f(`${C_(R2.ebitda)}+${C_(R2.dep)}`)); set(R2.taxR, c, f(FN(RF.taxRate))); set(R2.tax, c, f(`${C_(R2.noplat)}-${C_(R2.ebit)}`));
    set(R2.noplat, c, f(`${C_(R2.ebit)}*(1-${C_(R2.taxR)})`)); set(R2.netInv, c, f(`${C_(R2.fcf)}-${C_(R2.noplat)}`)); set(R2.fcf, c, f(`DCF!${a1(RD.vFcff, X.dF(k))}`));
    set(R2.capex, c, f(FN(RF.cCapex))); set(R2.ic, c, f(FN(RF.ic))); set(R2.turn, c, f(FN(RF.revIc)));
  }
  for (let j = 1; j <= Y; j++) {
    const c = s(j), C = CN(c), P = CN(c - 1), C_ = (r) => `${C}${r}`, P_ = (r) => `${P}${r}`;
    set(R2.rev, c, f(`${P_(R2.rev)}*(1+${C}$${R2.g})`)); set(R2.g, c, f(`IF(${C}$9<=$I$54,$I$58,$J$58)`));
    set(R2.ebitda, c, f(`${C_(R2.ebit)}-${C_(R2.dep)}`)); set(R2.m, c, f(`IFERROR(${C_(R2.ebitda)}/${C_(R2.rev)},0)`));
    set(R2.dep, c, f(`${P_(R2.dep)}*(1+${C}$${R2.g})`)); set(R2.ebit, c, f(`IFERROR(${C_(R2.noplat)}/(1-${C_(R2.taxR)}),0)`));
    set(R2.taxR, c, f(P_(R2.taxR))); set(R2.tax, c, f(`-${C_(R2.ebit)}*${C_(R2.taxR)}`));
    set(R2.noplat, c, f(`AVERAGE(${P_(R2.ic)}:${C_(R2.ic)})*${C_(R2.roic)}`)); set(R2.netInv, c, f(`${P_(R2.ic)}-${C_(R2.ic)}`)); set(R2.fcf, c, f(`SUM(${C_(R2.noplat)}:${C_(R2.netInv)})`));
    set(R2.ic, c, f(`IFERROR(${C_(R2.rev)}/${C_(R2.turn)},0)`)); set(R2.turn, c, f(P_(R2.turn)));
  }
  // terminal value
  set(R2.tvHdr, 3, "Terminal Value Calculation");
  [[R2.fcfCap, "FCF Competitive Advantage Period"], [R2.tvEnd, "TV end of Competitive Advantage Period"], [R2.fcfTv, "FCF Including TV"], [R2.df, "Discount Factor"]].forEach(([r, t]) => { set(r, 3, t); set(r, 10, r === R2.df ? "x" : U); });
  for (let j = 1; j <= Y; j++) {
    const c = s(j), C = CN(c), P = CN(c - 1);
    set(R2.fcfCap, c, f(`IF(${C}$9<=$I$54,${C}${R2.fcf},0)`)); set(R2.tvEnd, c, f(`IF(${C}$9=$I$54,${C}${R2.fcf}/($J$57-$J$58),0)`));
    set(R2.fcfTv, c, f(`SUM(${C}${R2.fcfCap}:${C}${R2.tvEnd})`)); set(R2.df, c, f(j === 1 ? `1/(1+$I$57)` : `${P}${R2.df}/(1+$I$57)`));
    set(R2.v1, c, f(`${C}${R2.fcfCap}*${C}$${R2.df}`)); set(R2.v2, c, f(`${C}${R2.tvEnd}*${C}$${R2.df}`)); set(R2.vTot, c, f(`SUM(${C}${R2.v1}:${C}${R2.v2})`));
  }
  const rg = (r) => `${A(r, s(1))}:${A(r, LS)}`;
  set(R2.v1, 3, "Value"); set(R2.v1, 4, "Stage I"); set(R2.v1, 10, U); set(R2.v1, LE, f(`SUM(${rg(R2.v1)})`));
  set(R2.v2, 3, "Value"); set(R2.v2, 4, "Stage II"); set(R2.v2, 10, U); set(R2.v2, LE, f(`SUM(${rg(R2.v2)})`));
  set(R2.vTot, 3, "Total Value"); set(R2.vTot, 10, U); set(R2.vTot, LE, f(`SUM(${rg(R2.vTot)})`));
  set(R2.tv, 3, f(`"TV "&C7`)); set(R2.tv, 10, f(`Financials!G${RF.cfo}`)); set(R2.tv, LE, f(`SUM(${rg(R2.vTot)})`));
  // assumptions block
  set(R2.aHdr, 3, "Assumptions"); set(R2.aHdr, 14, f(`"Comparison: "&C7&" vs. "&'Terminal Value'!C${RT.gorHdr}&" (FCF and ROIC)"`));
  set(51, 14, f(`C${R2.fcf}&" ("&J${R2.fcf}&")"`)); set(51, 32, f(`C${R2.chRoic2}&" ("&J${R2.chRoic2}&")"`));
  set(R2.stage, 3, "Stage"); set(R2.stage, 9, "Stage I"); set(R2.stage, 10, "Stage II");
  [[R2.dur, RA.ts.dur], [R2.start, RA.ts.start], [R2.end, RA.ts.end], [R2.w, RA.ts.w], [R2.g2, RA.ts.g], [R2.spread, RA.ts.spread], [R2.roic2, RA.ts.roic]].forEach(([r, ar]) => {
    set(r, 3, f(`Assumptions!K${ar}`)); set(r, 8, f(`Assumptions!L${ar}`)); set(r, 9, f(`Assumptions!M${ar}`)); set(r, 10, f(`Assumptions!O${ar}`));
  });
  set(R2.curve, 3, f(`Assumptions!K${RA.ts.curve}`)); set(R2.curve, 8, f(`Assumptions!L${RA.ts.curve}`)); set(R2.curve, 9, f(`Assumptions!M${RA.ts.curve}`));
  set(R2.gsHdr, 3, "Graph Selector");
  [[66, R2.chFcf], [67, R2.chFcfG], [68, R2.chFcf2], [69, R2.chRoicG], [70, R2.chRoic2], [71, R2.chW]].forEach(([r, cr]) => set(r, 4, f(`C${cr}`)));
  set(R2.rTvHdr, 3, "Terminal Value");
  set(R2.rV1, 3, "Value"); set(R2.rV1, 4, "Stage I"); set(R2.rV1, 7, U); set(R2.rV1, 8, f(A(R2.v1, LE)));
  set(R2.rV2, 4, "Stage II"); set(R2.rV2, 7, U); set(R2.rV2, 8, f(A(R2.v2, LE)));
  set(R2.rTv, 3, f(`C${R2.tv}`)); set(R2.rTv, 7, U); set(R2.rTv, 8, f(A(R2.tv, LE))); set(R2.rTv, CHK, f(`ROUND(SUM(H${R2.rV1}:H${R2.rV1 + 2})-H${R2.rTv},6)`), S.chkSum);
  // chart data
  set(R2.chHdr, 3, "Chart Data"); set(R2.chYr, 3, f("C8"));
  for (let c = E(1); c <= LS; c++) set(R2.chYr, c, f(`${CN(c)}8`));
  const cd = [[R2.chFcf, "FCF Forecast Period", U], [R2.chFcfG, "FCF Gordon Growth", U], [R2.chFcf2, f(`"FCF "&$C$7`), U], [R2.chRoicG, f(`C${R2.roic}&" Gordon Growth"`), "%"], [R2.chRoic2, f(`C${R2.roic}&" "&$C$7`), "%"], [R2.chW, f(`Assumptions!C${RA.waccUsed}`), "%"]];
  cd.forEach(([r, t, u]) => { set(r, 3, t); set(r, 9, true); set(r, 10, u); });
  set(R2.chW, 8, f(`Assumptions!$G$${RA.waccUsed}`), S.pctLink);
  for (let k = 1; k <= N; k++) { const c = E(k), C = CN(c); set(R2.chFcf, c, f(`IF($I${R2.chFcf},${C}${R2.fcf},NA())`)); set(R2.chRoic2, c, f(`IF($I${R2.chRoic2},${C}${R2.roic},NA())`)); set(R2.chW, c, f(`IF($I${R2.chW},$H${R2.chW},NA())`)); }
  for (let j = 1; j <= Y; j++) {
    const c = s(j), C = CN(c), P = CN(c - 1);
    set(R2.chFcfG, c, f(`IF($I${R2.chFcfG},${P}${R2.fcf}*(1+'Terminal Value'!$H$${RT.gorG}),0)`));
    set(R2.chFcf2, c, f(`IF($I${R2.chFcf2},${C}${R2.fcf},NA())`));
    set(R2.chRoicG, c, f(`IF($I${R2.chRoicG},${j === 1 ? `${P}${R2.chRoic2}` : `${P}${R2.chRoicG}`},NA())`));
    set(R2.chRoic2, c, f(`IF($I${R2.chRoic2},${C}${R2.roic},NA())`)); set(R2.chW, c, f(`IF($I${R2.chW},$H${R2.chW},NA())`));
  }
  X.vdLastStage = LS;
}

module.exports = { buildAssumptions, buildFinancials, buildDcf, buildTerminalValue, buildTwoStage, tvMethods, histValues, range };
