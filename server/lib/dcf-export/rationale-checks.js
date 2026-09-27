/**
 * Assumption Rationale — the website's assumption table (how each driver is built, the adjustment
 * factors, the rationale, the commentary) — and Checks — model integrity plus a reconciliation of
 * every headline number to the website's values at export.
 */
const { SN, FLEX, RA, RF, RD, RT } = require("./context");
const { colName: CN, a1 } = require("../xlsx-tpl");
const { newSheet, bar } = require("./analysis-sheets");

const f = (x) => ({ f: x });
const fin = (v) => v != null && isFinite(v);

/* ═══════════════════════════════ ASSUMPTION RATIONALE ═══════════════════════════════ */
function buildRationale(X) {
  const p = X.p, plan = p.plan, S = X.S, st = X.wb.styles;
  const sh = newSheet(X, SN.rat, { tab: "FF44B774", freeze: { y: 5 }, cols: [[1, 1, 4.58], [2, 2, 1.58], [3, 3, 40], [4, 4, 13.58], [5, 5, 13.58], [6, 6, 13.58], [7, 7, 90]] });
  sh.set(4, 3, "Assumption Rationale — how every driver was set", S.section);
  sh.set(5, 3, "The M-Terminal assumption engine (deterministic). Commentary marked AI is wording only — it never changes a number.", S.amounts);
  const wrap = st.variant(S.lbl, { wrap: true, valign: "top" }), wrapNote = S.noteWrap;
  let r = 7;
  const para = (text, style = wrap, h) => { if (!text) return; sh.set(r, 3, text, style); sh.merge(`C${r}:G${r}`); sh.height(r, h || Math.max(15, 15 * Math.ceil(String(text).length / 185))); r++; };
  if (!plan) { para("No assumption plan is available for this company — the model runs on single-value defaults."); return; }
  const cm = X.commentary || {};
  bar(X, sh, r, 3, 7, "Overview"); r++;
  para(cm.overview);
  if (cm.aiOverview) { para(`AI · ${cm.aiOverview}`, wrapNote); }
  r++;
  const yrs = plan.years || [];
  const drivers = [["growth", "Revenue growth"], ["ebitdaMargin", "EBITDA margin"], ["depPctRev", "D&A % of revenue"], ["capexPctRev", "Capex % of revenue"], ["wcPctRev", "Working capital (% of Δ revenue)"], ["taxRate", "Tax rate"]];
  for (const [key, title] of drivers) {
    const d = plan.drivers[key]; if (!d) continue;
    bar(X, sh, r, 3, 7, `${d.label || title}  ·  confidence ${d.confidence || "—"}`); r++;
    // path (engine plan) vs the model input row
    sh.set(r, 3, "Plan path (%)", S.lblB);
    const show = [0, 1, 2, 4, 9].filter((k) => k < (d.path || []).length);
    show.forEach((k, j) => { sh.set(r - 0, 4 + Math.min(j, 3), null); });
    sh.set(r, 4, `FY${String(yrs[0] || "").slice(-2)}: ${fmt(d.path[0])}`, S.textLeft);
    sh.set(r, 5, d.path[1] != null ? `FY${String(yrs[1] || "").slice(-2)}: ${fmt(d.path[1])}` : "", S.textLeft);
    sh.set(r, 6, d.path[4] != null ? `FY${String(yrs[4] || "").slice(-2)}: ${fmt(d.path[4])}` : "", S.textLeft);
    sh.set(r, 7, `Full path: ${(d.path || []).map((x, k) => `FY${String(yrs[k] || "").slice(-2)} ${fmt(x)}`).join(" · ")}`, S.noteWrap); sh.height(r, 30); r++;
    if (d.hist) { sh.set(r, 3, "History", S.lblB); sh.set(r, 7, `latest ${fmt(d.latest)} · average ${fmt(d.hist.avg)}${d.hist.min != null ? ` · range ${fmt(d.hist.min)} – ${fmt(d.hist.max)}` : ""}${d.hist.n ? ` · ${d.hist.n} years` : ""}`, S.textLeft); r++; }
    if ((d.build || []).length) {
      sh.set(r, 3, "How it is built", S.lblB); sh.set(r, 4, "Value", S.hdrText); sh.set(r, 5, "Weight", S.hdrText); r++;
      d.build.forEach((b) => { sh.set(r, 3, b.label, wrap); sh.set(r, 4, fin(b.value) ? b.value / 100 : null, S.pct2); sh.set(r, 5, fin(b.weight) ? b.weight : null, S.pctN); sh.set(r, 7, b.source || "", wrapNote); r++; });
    }
    if ((d.adjustments || []).length) {
      sh.set(r, 3, "Adjustment factors", S.lblB); sh.set(r, 4, "Δ (pp)", S.hdrText); sh.set(r, 5, "Effect", S.hdrText); r++;
      d.adjustments.forEach((a) => { sh.set(r, 3, a.label, wrap); sh.set(r, 4, fin(a.delta) ? a.delta : null, S.pp); sh.set(r, 5, a.effect || "", S.textLeft); sh.set(r, 7, a.why || "", wrapNote); r++; });
    }
    sh.set(r, 3, "Rationale (engine)", S.lblB); r++; para(d.rationale);
    const ai = cm.ai && cm.ai[key]; if (ai) para(`AI · ${ai}`, wrapNote);
    const cor = cm.corroboration && cm.corroboration[key];
    if (cor) para(`AI corroboration · ${cor.verdict}${fin(cor.suggested) ? ` (suggested ${cor.suggested.toFixed(2)}%)` : ""} — ${cor.reason}`, wrapNote);
    r++;
  }
  // cost of capital
  const w = plan.wacc || {};
  bar(X, sh, r, 3, 7, `Cost of capital  ·  WACC ${fmt(w.value)}  ·  confidence ${w.confidence || "—"}`); r++;
  (w.build || []).forEach((b) => { sh.set(r, 3, b.label, wrap); sh.set(r, 4, fin(b.value) ? (b.label.startsWith("Beta") ? b.value : b.value / 100) : null, b.label.startsWith("Beta") ? S.dec : S.pct2); sh.set(r, 5, fin(b.weight) ? b.weight : null, S.pctN); sh.set(r, 7, b.source || "", wrapNote); r++; });
  (w.adjustments || []).forEach((a) => { sh.set(r, 3, a.label, wrap); sh.set(r, 4, fin(a.delta) ? a.delta : null, S.pp); sh.set(r, 5, a.effect || "", S.textLeft); sh.set(r, 7, a.why || "", wrapNote); r++; });
  para(w.rationale); if (cm.ai && cm.ai.wacc) para(`AI · ${cm.ai.wacc}`, wrapNote); r++;
  // terminal value
  const t = plan.terminal || {};
  bar(X, sh, r, 3, 7, `Terminal value  ·  g ${fmt(t.value)}  ·  RONIC ${fmt(t.ronic)}  ·  stage-2 ${t.stage2Years || 0} years`); r++;
  (t.build || []).forEach((b) => { sh.set(r, 3, b.label, wrap); sh.set(r, 4, fin(b.value) ? b.value / 100 : null, S.pct2); sh.set(r, 7, b.source || "", wrapNote); r++; });
  (t.adjustments || []).forEach((a) => { sh.set(r, 3, a.label, wrap); sh.set(r, 4, fin(a.delta) ? a.delta : null, S.pp); sh.set(r, 5, a.effect || "", S.textLeft); sh.set(r, 7, a.why || "", wrapNote); r++; });
  para(t.rationale); if (cm.ai && cm.ai.terminal) para(`AI · ${cm.ai.terminal}`, wrapNote); r++;
  // watch list, notes, warnings
  if ((cm.watch || []).length) { bar(X, sh, r, 3, 7, "What would change these assumptions"); r++; cm.watch.forEach((x) => para(`• ${x.text}${x.ai ? "  (AI)" : ""}`)); r++; }
  if ((plan.notes || []).length) { bar(X, sh, r, 3, 7, "Notes"); r++; plan.notes.forEach((n) => para(`• ${typeof n === "string" ? n : n.text || JSON.stringify(n)}`)); r++; }
  if ((plan.warnings || []).length) { bar(X, sh, r, 3, 7, "Warnings"); r++; plan.warnings.forEach((n) => para(`• ${typeof n === "string" ? n : n.text || JSON.stringify(n)}`, st.variant(wrap, { color: "FF9C0006" }))); r++; }
  const q = plan.quality || {};
  bar(X, sh, r, 3, 7, "Quality inputs used by the engine"); r++;
  [["Economic moat", q.moat], ["Earnings quality grade", q.earningsQualityGrade], ["ROIC (%)", q.roic], ["Cash conversion (%)", q.cashConversion], ["Beneish M-score", q.beneish], ["Altman Z zone", q.altmanZone]]
    .forEach(([k, v]) => { sh.set(r, 3, k, S.lbl); sh.set(r, 4, v == null ? "—" : v, typeof v === "number" ? S.dec : S.textLeft); r++; });
}
const fmt = (v) => (v == null || !isFinite(v) ? "—" : `${(+v).toFixed(2)}%`);

/* ═══════════════════════════════ CHECKS ═══════════════════════════════ */
function buildChecks(X) {
  const S = X.S, st = X.wb.styles, i = X.idcf, N = X.N, p = X.p;
  const sh = newSheet(X, SN.chk, { tab: "FFC00000", freeze: { y: 8 }, cols: [[1, 1, 4.58], [2, 2, 1.58], [3, 3, 7], [4, 4, 22], [5, 5, 62], [6, 6, 15], [7, 7, 15], [8, 8, 13], [9, 9, 12], [10, 10, 11], [11, 11, 4], [12, 12, 22], [13, 22, 12]] });
  sh.set(4, 3, "Model Checks — integrity and reconciliation to the M-Terminal website", S.section);
  sh.set(5, 4, "Failed checks", S.lblB); sh.set(5, 7, f(`COUNTIF(J9:J200,"CHECK")`), S.int);
  sh.set(6, 4, "Warnings", S.lblB); sh.set(6, 7, f(`COUNTIF(J9:J200,"WARN")`), S.int);
  const okD = st.dxf({ color: "FF006100", fill: "FFC6EFCE", bold: true }), badD = st.dxf({ color: "FF9C0006", fill: "FFFFC7CE", bold: true }), wD = st.dxf({ color: "FF9C5700", fill: "FFFFEB9C", bold: true });
  ["#", "Area", "Check", "Excel", "Reference", "Difference", "Tolerance", "Status"].forEach((h, j) => sh.set(8, 3 + j, h, S.hdrText));
  // reference data block (website values at export) — far right
  const RC = 12; let rr = 9;
  bar(X, sh, 7, RC, RC + N, "Reference data: website values at export (inputs)", S.subHdr);
  const refRow = (label, arr, style = S.numIn) => { sh.set(rr, RC, label, S.lbl); arr.forEach((v, k) => sh.set(rr, RC + 1 + k, v, style)); return rr++; };
  const rRev = refRow(`Revenue (${X.unit})`, X.rows.map((r) => X.d(r.rev)));
  const rFcff = refRow(`FCFF (${X.unit})`, X.rows.map((r) => X.d(r.fcff)));
  const rEbitda = refRow(`EBITDA (${X.unit})`, X.rows.map((r) => X.d(r.ebitda)));
  const rDf = refRow("Discount factor", X.rows.map((r) => r.df), S.z);
  for (let k = 1; k <= N; k++) sh.set(8, RC + k, `Y${k}`, S.hdrText);
  const range = (row) => `$${CN(RC + 1)}$${row}:$${CN(RC + N)}$${row}`;
  const finRow = (r_) => `Financials!$${CN(X.fF(1))}$${r_}:$${CN(X.fLast)}$${r_}`;
  const dcfRow = (r_) => `DCF!$${CN(X.dF(1))}$${r_}:$${CN(X.dLast)}$${r_}`;
  let r = 9, n = 0;
  const add = (area, text, excel, ref, tol, { rel = false, warn = false, fmt = S.num, abs = true } = {}) => {
    n++; sh.set(r, 3, n, S.int); sh.set(r, 4, area, S.lbl); sh.set(r, 5, text, S.lbl);
    sh.set(r, 6, typeof excel === "string" ? f(excel) : excel, fmt); sh.set(r, 7, typeof ref === "string" ? f(ref) : ref, typeof ref === "number" ? st.variant(fmt, { color: "FF0000FF" }) : fmt);
    sh.set(r, 8, f(rel ? `IFERROR(IF(G${r}=0,F${r},F${r}/G${r}-1),1)` : `IFERROR(F${r}-G${r},1)`), rel ? S.upPct : fmt);
    sh.set(r, 9, tol, rel ? st.variant(S.pctN, { numFmt: "0.000%" }) : fmt);
    sh.set(r, 10, f(`IF(ISERROR(H${r}),"${warn ? "WARN" : "CHECK"}",IF(ABS(H${r})<=I${r},"OK","${warn ? "WARN" : "CHECK"}"))`), S.status);
    r++;
  };
  const tolRel = 1e-6;
  // integrity
  add("Integrity", "Balance sheet balances in every year (Σ assets − liabilities & equity)", `Financials!${a1(3, X.fChk)}*0+Financials!${a1(RF.bsChk, X.fChk)}`, 0, 0.001);
  add("Integrity", "Cash-flow statement ties to balance-sheet cash", `Financials!${a1(RF.cashChk, X.fChk)}`, 0, 0.001);
  add("Integrity", "Net income: Assumptions = Financials", `Financials!${a1(RF.niChk, X.fChk)}`, 0, 0.001);
  add("Integrity", "Invested capital = capital employed", `Financials!${a1(RF.icChk, X.fChk)}`, 0, 0.001);
  add("Integrity", "Working-capital schedule ties to the balance sheet", `Financials!${a1(RF.nwcChk, X.fChk)}`, 0, 0.001);
  add("Integrity", "Fixed-asset roll-forward ties", `Financials!${a1(RF.faNet, X.fChk)}`, 0, 0.001);
  add("Integrity", "FCFF build sums (DCF sheet)", `DCF!${a1(3, X.dChk)}`, 0, 0.001);
  add("Integrity", "Enterprise value = PV of explicit FCFF + PV of terminal value", `DCF!$M$${RD.ev}`, `SUM(DCF!${a1(RD.pvF, X.dF(1))}:${a1(RD.pvF, X.dLast)})+DCF!${a1(RD.pvTv, X.dLast)}`, 0.001);
  add("Integrity", "Executive Summary checks (NI, balance sheet, cash)", `'Executive Summary'!${a1(3, X.eChk)}`, 0, 0.001);
  add("Integrity", "Terminal-value exit bridges", `'Terminal Value'!$U$3`, 0, 0.001);
  add("Integrity", "Two Stage Value Driver totals", `'Two Stage Value Driver Model'!${a1(3, X.vChk)}`, 0, 0.001);
  add("Integrity", "Analysis flex cells are all zero (base case intact)", `SUMPRODUCT(ABS(Assumptions!$G$${RA.flex0}:$G$${RA.flex0 + Object.keys(FLEX).length - 1}))`, 0, 1e-12, { fmt: S.dec });
  add("Integrity", "WACC exceeds terminal growth", `Assumptions!$G$${RA.waccUsed}-Assumptions!$G$${RA.vdf.g}`, `MAX(0,Assumptions!$G$${RA.waccUsed}-Assumptions!$G$${RA.vdf.g})`, 0, { fmt: S.pct2 });
  add("Integrity", "WACC weights sum to 100%", `Assumptions!$G$${RA.wt}`, 1, 1e-9, { fmt: S.pctN });
  add("Integrity", "Blended-target weights sum to 100%", `'${SN.val}'!$G$${X.valBlendRow}`, 1, 1e-9, { fmt: S.pctN });
  // website reconciliation
  add("Website", "WACC", `Assumptions!$G$${RA.waccLink}`, i.waccBuild.wacc / 100, tolRel, { rel: true, fmt: S.pct2 });
  add("Website", "Cost of equity", `Assumptions!$G$${RA.ke}`, i.waccBuild.costEquity / 100, tolRel, { rel: true, fmt: S.pct2 });
  add("Website", "Revenue — largest gap across the forecast years", `SUMPRODUCT(MAX(ABS(${finRow(RF.rev)}/${range(rRev)}-1)))`, 0, tolRel, { fmt: st.variant(S.pctN, { numFmt: "0.0000%" }) });
  add("Website", "EBITDA — largest gap across the forecast years", `SUMPRODUCT(MAX(ABS(${finRow(RF.ebitda)}/${range(rEbitda)}-1)))`, 0, tolRel, { fmt: st.variant(S.pctN, { numFmt: "0.0000%" }) });
  add("Website", "FCFF — largest gap across the forecast years (relative to revenue)", `SUMPRODUCT(MAX(ABS(${dcfRow(RD.fcff)}-${range(rFcff)})/${range(rRev)}))`, 0, tolRel, { fmt: st.variant(S.pctN, { numFmt: "0.0000%" }) });
  add("Website", "Discount factors — largest gap", `SUMPRODUCT(MAX(ABS(${dcfRow(RD.df)}-${range(rDf)})))`, 0, 1e-9, { fmt: S.z });
  add("Website", `PV of explicit FCFF (${X.unit})`, `DCF!$M$${RD.rPvF}`, X.d(i.base.pvExplicit), tolRel, { rel: true });
  add("Website", `PV of terminal value (${X.unit})`, `DCF!$M$${RD.rPvTv}`, X.d(i.base.tvPv), tolRel, { rel: true });
  add("Website", `Enterprise value (${X.unit})`, `DCF!$M$${RD.ev}`, X.d(i.base.ev), tolRel, { rel: true });
  add("Website", `Net debt (${X.unit})`, `-DCF!$M$${RD.debt}-DCF!$M$${RD.cash}`, X.d(i.netDebt), 0.0005, { fmt: S.num });
  add("Website", `Equity value (${X.unit})`, `DCF!$M$${RD.eqv}`, X.d(i.base.equity), tolRel, { rel: true });
  add("Website", "Value per share", `DCF!$M$${RD.ps}`, i.base.perShare, tolRel, { rel: true, fmt: S.px });
  add("Website", "Terminal value share of EV", `DCF!$N$${RD.rPvTv}`, i.base.terminalShare, 1e-6, { fmt: S.pctN });
  const sc = X.scen; ["Bull", "Base", "Bear"].forEach((nm, k) => add("Scenarios", `${nm} value per share`, `'${SN.scen}'!${sc.excel[k]}`, `'${SN.scen}'!${sc.web[k]}`, 1e-6, { rel: true, fmt: S.px }));
  add("Sensitivity", "WACC × g grid — largest gap vs the website grid", `SUMPRODUCT(MAX(IFERROR(ABS('${SN.sens}'!${X.sens.grid}/'${SN.sens}'!${X.sens.web}-1),0)))`, 0, 1e-6, { fmt: st.variant(S.pctN, { numFmt: "0.0000%" }) });
  add("Tornado", "Low / high values — largest gap vs the website", `SUMPRODUCT(MAX(IFERROR(ABS('${SN.torn}'!${X.torn.excel}/'${SN.torn}'!${X.torn.web}-1),0)))`, 0, 0.0001, { fmt: st.variant(S.pctN, { numFmt: "0.0000%" }), warn: true });
  add("Reverse DCF", "Implied Year-1 growth (Excel interpolation vs website bisection, pp)", `IFERROR(('${SN.rev}'!${X.rev.g}-'${SN.rev}'!${X.rev.gWeb})*100,0)`, 0, 0.05, { fmt: S.dec, warn: true });
  add("Reverse DCF", "Implied WACC (pp)", `IFERROR(('${SN.rev}'!${X.rev.w}-'${SN.rev}'!${X.rev.wWeb})*100,0)`, 0, 0.05, { fmt: S.dec, warn: true });
  [["Mean", X.mc.mean], ["Median", X.mc.median], ["5th percentile", X.mc.p5], ["95th percentile", X.mc.p95], ["Base case", X.mc.base]].forEach(([nm, row]) => add("Monte Carlo", `${nm} value per share`, `'${SN.mc}'!E${row}`, `'${SN.mc}'!F${row}`, 1e-6, { rel: true, fmt: S.px }));
  add("Monte Carlo", "P(value > price)", `'${SN.mc}'!E${X.mc.prob}`, `'${SN.mc}'!F${X.mc.prob}`, 0.0001, { fmt: S.pctN });
  add("Valuation", "Blended target", `'${SN.val}'!E${X.valBlendRow}`, `'${SN.val}'!H${X.valBlendRow}`, 1e-6, { rel: true, fmt: S.px });
  // warnings (informational)
  add("Warning", "Terminal value above 75% of enterprise value", `DCF!$N$${RD.rPvTv}`, 0.75, 0, { warn: true, fmt: S.pctN });
  sh.set(r - 1, 8, f(`MAX(0,F${r - 1}-G${r - 1})`), S.pctN);
  add("Warning", "Net fixed assets stay positive (D&A may include intangibles / leases)", `MIN(Financials!$${CN(X.fF(1))}$${RF.nfa}:$${CN(X.fLast)}$${RF.nfa})`, `MAX(0,MIN(Financials!$${CN(X.fF(1))}$${RF.nfa}:$${CN(X.fLast)}$${RF.nfa}))`, 0, { warn: true });
  const last = r - 1;
  sh.cf.push(`<conditionalFormatting sqref="J9:J${last}"><cfRule type="cellIs" dxfId="${okD}" priority="1" operator="equal"><formula>"OK"</formula></cfRule><cfRule type="cellIs" dxfId="${badD}" priority="2" operator="equal"><formula>"CHECK"</formula></cfRule><cfRule type="cellIs" dxfId="${wD}" priority="3" operator="equal"><formula>"WARN"</formula></cfRule></conditionalFormatting>`);
  sh.set(last + 2, 4, "Reference values are the website's own engine outputs at export; tolerances are relative unless stated. Monte Carlo and the scenario/tornado/reverse-DCF runs use Excel data tables over this workbook's model.", S.note);
  // make the array-style checks array formulas
  for (let rr2 = 9; rr2 <= last; rr2++) { const c = sh.get(rr2, 6); if (c && c.f && /SUMPRODUCT\(MAX/.test(c.f)) c.arr = true; }
}

module.exports = { buildRationale, buildChecks };
