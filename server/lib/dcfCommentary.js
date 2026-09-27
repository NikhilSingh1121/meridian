/**
 * Deterministic DCF commentary — the "key assumptions" note written from the assumption plan
 * and the model outputs alone. No AI is involved, so it is always available, always consistent
 * with the numbers, and identical on the website and in the Excel export.
 *
 * The AI layer (dcfAI.js) only adds a corroboration of each assumption on top of this; the
 * model and this commentary work without it.
 */
const fin = (v) => v != null && isFinite(v);
const p1 = (v) => (fin(v) ? (+v).toFixed(1) : "—");
const p2 = (v) => (fin(v) ? (+v).toFixed(2) : "—");
const fy = (y) => (y ? `FY${String(y).slice(-2)}` : "");

function commentary(plan, idcf, meta = {}) {
  if (!plan || !idcf || idcf.error || !idcf.base) return null;
  const rows = idcf.base.rows, N = rows.length, a = idcf.assumptions || {}, wb = idcf.waccBuild || {};
  const first = rows[0], last = rows[N - 1];
  const G = plan.drivers.growth, M = plan.drivers.ebitdaMargin, T = plan.terminal || {};
  const s2 = idcf.stage2 ? idcf.stage2.years : 0;
  const anchor = (G.build || [])[0];
  const cur = meta.currencySymbol || "";
  const px = (v) => (fin(v) ? `${cur}${(+v).toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}` : "—");
  const up = idcf.upside;
  const ts = idcf.base.terminalShare * 100;
  const tvText = idcf.terminalMethod === "exitMultiple" ? `an exit at ${p1(idcf.exitMultiple)}× EBITDA`
    : s2 ? `a ${s2}-year fade to ${p2(a.terminalG)}% terminal growth and a perpetuity that reinvests ${p1(T.reinvestmentRate)}% of NOPAT at a ${p1(T.ronic)}% return on new capital`
    : `a perpetuity growing at ${p2(a.terminalG)}%`;
  const overview = [
    `${meta.name || "The company"} is valued on a ${N}-year explicit forecast (${fy(first.year)}–${fy(last.year)}) followed by ${tvText}.`,
    `Revenue grows ${p1(first.growth)}% in ${fy(first.year)}${anchor ? ` (anchored on ${anchor.label.replace(/\s*\(.*\)$/, "")})` : ""}, ${last.growth < first.growth ? "easing" : "moving"} to ${p1(last.growth)}% by ${fy(last.year)}; the EBITDA margin goes from ${p1(first.margin)}% to ${p1(last.margin)}%.`,
    `Discounted at a WACC of ${p2(a.wacc)}% (cost of equity ${p2(wb.costEquity)}%: risk-free ${p2(wb.rf)}%, β ${p2(wb.beta)} × ERP ${p2(wb.erp)}%${wb.premium ? ` + ${p2(wb.premium)}pp company-specific premium` : ""}), the model gives ${px(idcf.base.perShare)} per share${fin(up) ? `, ${up >= 0 ? "+" : ""}${p1(up)}% against the current ${px(idcf.currentPrice)}` : ""}.`,
    `The terminal value is ${p1(ts)}% of enterprise value${ts > 75 ? " — long-run assumptions dominate, so treat the output with care" : ""}.`,
  ].join(" ");

  // what would change these assumptions — the largest tornado swings, plus the plan's own flags
  const watch = [];
  const tor = (meta.tornado && meta.tornado.bars) || [];
  tor.slice(0, 3).forEach((b) => watch.push({ text: `${b.label}: ±${b.step}pp moves value between ${px(b.lowPx)} and ${px(b.highPx)} — ${b.key === "wacc" ? "a change in rates or in the risk profile" : b.key === "growth" ? "consensus revisions or a change in the growth runway" : b.key === "margin" ? "pricing power, input costs or mix" : b.key === "terminalG" ? "a different view of long-run nominal growth" : "a change in the investment cycle"} would move the target most here.` }));
  if (ts > 70) watch.push({ text: `The terminal value carries ${p1(ts)}% of the value: evidence on the durability of returns (the ${plan.quality?.moat || "—"} moat) matters more than near-term numbers.` });
  (plan.warnings || []).forEach((w) => watch.push({ text: typeof w === "string" ? w : w.text || String(w) }));
  if (plan.quality && plan.quality.earningsQualityGrade && plan.quality.earningsQualityGrade !== "A") watch.push({ text: `Earnings quality grade ${plan.quality.earningsQualityGrade}: better cash backing of profits would lower the risk premium.` });

  const byDriver = {};
  for (const k of Object.keys(plan.drivers)) byDriver[k] = plan.drivers[k].rationale || "";
  return { overview, watch: watch.slice(0, 6), drivers: byDriver, wacc: plan.wacc?.rationale || "", terminal: T.rationale || "", source: "engine" };
}

module.exports = { commentary };
