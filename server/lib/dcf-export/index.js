/**
 * Template-based DCF workbook (server/templates/dcf-model-template.xlsx).
 *
 * The template's sheets, styles, colour code, charts, check boxes and list selectors are kept;
 * the cells are regenerated from the website's engine run so the workbook reconciles to the
 * screen, and M-Terminal's own analyses are added as linked sheets:
 *
 *   Title · Terms · Executive Summary · Assumptions · Assumption Rationale · Financials · DCF ·
 *   Terminal Value · Two Stage Value Driver Model · Sensitivity · Scenarios · Reverse DCF ·
 *   Tornado · Comparable Companies · Valuation Methods · Monte Carlo · Checks
 */
const fs = require("fs");
const path = require("path");
const { TplWorkbook } = require("../xlsx-tpl");
const { buildContext, SN, RA, RT, R2, RD } = require("./context");
const core = require("./core-sheets");
const summ = require("./summary-sheets");
const an = require("./analysis-sheets");
const rc = require("./rationale-checks");
const { commentary } = require("../dcfCommentary");

const TEMPLATE = path.join(__dirname, "..", "..", "templates", "dcf-model-template.xlsx");

function commentaryFor(p) {
  const det = commentary(p.plan, p.idcf, { name: p.meta.name, currencySymbol: p.meta.currency === "INR" ? "₹" : p.meta.currency === "USD" ? "$" : "", tornado: p.tornado }) || {};
  const ai = p.planAI && p.planAI.status === "done" && p.planAI.result ? p.planAI.result : null;
  const out = { overview: det.overview, watch: det.watch || [], ai: {}, corroboration: (ai && ai.corroboration) || {} };
  if (ai) {
    if (ai.overview) out.aiOverview = ai.overview;
    const map = { growth: "growth", ebitdaMargin: "ebitdaMargin", reinvestment: ["depPctRev", "capexPctRev"], workingCapital: "wcPctRev", taxRate: "taxRate", wacc: "wacc", terminal: "terminal" };
    for (const [k, v] of Object.entries(map)) if (ai[k]) (Array.isArray(v) ? v : [v]).forEach((x) => { out.ai[x] = ai[k]; });
    (ai.watch || []).forEach((w) => out.watch.push({ text: w, ai: true }));
  }
  return out;
}

async function buildDcfWorkbook(p) {
  if (!p || !p.idcf || !p.idcf.base || !(p.idcf.base.rows || []).length) throw new Error("no DCF to export");
  const wb = await TplWorkbook.load(fs.readFileSync(TEMPLATE));
  const X = buildContext(p, wb);
  const N = X.N;
  X.aChk = 19 + N; X.eChk = 15 + 2 * N; X.vChk = 46 + N;
  X.commentary = commentaryFor(p);
  const i = p.idcf;
  X.selectedTv = i.terminalMethod === "exitMultiple" ? `EV/EBITDA Exit Multiple (${(+i.exitMultiple || 12).toFixed(1)}x)`
    : i.stage2 && i.assumptions.planDriven ? "Value Driver Fade (M-Terminal)" : "Gordon Growth";
  X.linkList = [
    [SN.terms, "C21", "Terms, abbreviations and the colour code"], [SN.exec, "F10", "Financial summary, DCF result, charts"], [SN.ass, "G14", "All inputs: actuals, per-year drivers, WACC, terminal-value settings"],
    [SN.rat, "C7", "How every driver was set (engine), commentary"], [SN.fin, "K10", "Income statement, balance sheet, cash flow, ratios, schedules"],
    [SN.dcf, "M53", "FCFF build, discounting, value per share"], [SN.tv, "H138", "Eleven terminal-value models and the selection"], [SN.vd2, `R${R2.tv}`, "Two-stage value driver (ROIC curve) terminal value"],
    [SN.sens, "F10", "WACC × terminal growth grid (data table)"], [SN.scen, "E16", "Bull / base / bear (data table)"], [SN.rev, "E9", "Market-implied growth and WACC"],
    [SN.torn, "C42", "One-way sensitivity ranking"], [SN.comps, "C9", "Peer multiples and medians"], [SN.val, "E8", "Every valuation method and the blended target"],
    [SN.mc, "E9", "5,000-run simulation on the live model"], [SN.chk, "G5", "Integrity checks and reconciliation to the website"],
  ];
  // analysis sheets first — their flex cells are referenced by the model
  an.buildSensitivity(X); an.buildScenarios(X); an.buildReverse(X); an.buildTornado(X); an.buildMonteCarlo(X); an.finishMonteCarloTable(X);
  an.buildComps(X); an.buildValuation(X);
  core.buildAssumptions(X); core.buildFinancials(X); core.buildDcf(X); core.buildTerminalValue(X); core.buildTwoStage(X);
  summ.buildExec(X); summ.buildTitle(X); summ.buildTerms(X);
  rc.buildRationale(X); rc.buildChecks(X);
  await summ.patchPackage(X);
  // tab order
  const order = [SN.title, SN.terms, SN.exec, SN.ass, SN.rat, SN.fin, SN.dcf, SN.tv, SN.vd2, SN.sens, SN.scen, SN.rev, SN.torn, SN.comps, SN.val, SN.mc, SN.chk];
  wb.order = order.filter((n) => wb.sheets.has(n));
  wb.definedNames = [
    { name: "ImpliedPx", ref: `DCF!$M$${RD.ps}` }, { name: "EvVal", ref: `DCF!$M$${RD.ev}` }, { name: "Wacc", ref: `Assumptions!$G$${RA.waccUsed}` },
    { name: "TermG", ref: `Assumptions!$G$${RA.vdf.g}` }, { name: "PvTv", ref: `DCF!$M$${RD.rPvTv}` }, { name: "BlendedTarget", ref: `'${SN.val}'!$E$${X.valBlendRow}` },
  ];
  return wb.toBuffer();
}

module.exports = { buildDcfWorkbook };
