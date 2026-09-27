/**
 * Analysis sheets — each one re-runs the live model through native Excel data tables:
 *
 *   Sensitivity          2-D table over (ΔWACC, Δg)             ↔ website Section 15
 *   Scenarios            1-D table over a case index             ↔ Section 16 (bull · base · bear)
 *   Reverse DCF          1-D tables over growth / WACC grids     ↔ Section 18 (interpolated root)
 *   Tornado              1-D table over 14 one-way cases         ↔ Section 19
 *   Monte Carlo          1-D table over 5,000 seeded runs        ↔ Valuation ▸ Monte Carlo
 *   Comparable Companies peer multiples + upper-median           ↔ Relative valuation panel
 *   Valuation Methods    every method rebuilt with formulas      ↔ Valuation methods · blended target
 *
 * A data table's input cell must sit on its own sheet, so each sheet owns a "case" cell (Y7/Y8)
 * and flex cells (Y9–Y18, see context.FLEX) that the Assumptions sheet sums into the model.
 */
const { SN, FLEX, FLEX_LABEL, RA, RF, RD } = require("./context");
const { colName: CN, a1 } = require("../xlsx-tpl");
const { range } = require("./core-sheets");

const f = (x) => ({ f: x });
const fin = (v) => v != null && isFinite(v);
const VPS = `DCF!$M$${RD.psTable}`;          // value per share (n.m. where WACC ≤ g)
const PX = `Assumptions!$G$${RA.price}`;

/* a new sheet in the template's look; columns X:Y hold the data-table control block */
const CTL_L = 24, CTL_V = 25, CV = CN(CTL_V);     // X (label) · Y (value)
function newSheet(X, name, { tab = "FF258A6E", cols, freeze = { y: 5 } } = {}) {
  const base = cols || [[1, 1, 4.58], [2, 2, 1.58], [3, 3, 44], [4, 22, 13.58]];
  const all = [...base, [23, 23, 2], [CTL_L, CTL_L, 46, 1], [CTL_V, CTL_V, 12, 1]];
  const colXml = `<cols>${all.map(([a, b, w, h]) => `<col min="${a}" max="${b}" width="${w}" customWidth="1"${h ? " hidden=\"1\" outlineLevel=\"1\"" : ""}/>`).join("")}</cols>`;
  const sh = X.wb.addSheet(name, { tabColor: tab, freeze, cols: colXml, zoom: 90 });
  sh.set(2, 2, f('SUBSTITUTE(Title!$B$4,CHAR(10)," · ")'), X.S.title);
  return sh;
}
function bar(X, sh, r, c1, c2, text, style) { const s = style ?? X.S.hdrBar; for (let c = c1; c <= c2; c++) sh.set(r, c, c === c1 ? text : null, s); }
function head(X, sh, r, cols, labels) { labels.forEach((t, j) => t != null && sh.set(r, cols[j], t, X.S.hdrText)); }
/* the data-table control block (right of the content): case inputs at Y7/Y8, flex cells at Y9–Y18 */
function controls(X, sh, inputs, flexFormulas) {
  const S = X.S;
  bar(X, sh, 6, CTL_L, CTL_V, "Data-table controls (0 = base case — leave as is)", S.subHdr);
  inputs.forEach(([r, label, v]) => { sh.set(r, CTL_L, label, S.lbl); sh.set(r, CTL_V, v, S.ppIn); });
  Object.keys(FLEX).forEach((k) => { sh.set(FLEX[k], CTL_L, FLEX_LABEL[k], S.lbl); sh.set(FLEX[k], CTL_V, flexFormulas[k] ? f(flexFormulas[k]) : 0, S.dec); });
}
const Y7 = `$${CV}$7`, Y8 = `$${CV}$8`, YF = (k) => `$${CV}$${FLEX[k]}`;
/* conditional formatting: green where value ≥ price, red where below */
function priceShading(X, sh, ref) {
  const st = X.wb.styles, up = st.dxf({ color: "FF006100", fill: "FFC6EFCE" }), dn = st.dxf({ color: "FF9C0006", fill: "FFFFC7CE" });
  const c = ref.split(":")[0].replace(/\$/g, "");
  sh.cf.push(`<conditionalFormatting sqref="${ref}"><cfRule type="expression" dxfId="${up}" priority="1"><formula>AND(ISNUMBER(${c}),${c}&gt;=${PX})</formula></cfRule><cfRule type="expression" dxfId="${dn}" priority="2"><formula>AND(ISNUMBER(${c}),${c}&lt;${PX})</formula></cfRule></conditionalFormatting>`);
}
function dataBar(sh, ref, color = "FF5B9BD5") {
  sh.cf.push(`<conditionalFormatting sqref="${ref}"><cfRule type="dataBar" priority="3"><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="${color}"/></dataBar></cfRule></conditionalFormatting>`);
}
const outRow = (X, sh, r, c, formula, style) => { sh.set(r, 3, "Model output (feeds the data table)", X.S.note); sh.set(r, c, f(formula), style); };

/* ═══════════════════════════════ SENSITIVITY ═══════════════════════════════ */
function buildSensitivity(X) {
  const sh = newSheet(X, SN.sens), S = X.S, i = X.idcf;
  sh.set(4, 3, "Sensitivity Analysis — value per share · WACC × terminal growth", S.section);
  sh.set(5, 3, f(`"Live data table over the full model · value per share in "&Assumptions!$E$${RA.price}`), S.amounts);
  controls(X, sh, [[7, "WACC shift input (pp)", 0], [8, "Terminal growth shift input (pp)", 0]], { w: Y7, tg: Y8 });
  const dW = [-1.5, -0.75, 0, 0.75, 1.5], dG = [-1, -0.5, 0, 0.5, 1];
  const c0 = 5;                                   // E: corner / WACC deltas; F–J: results
  bar(X, sh, 7, 3, c0 + 5, "Value per share");
  sh.set(8, 3, "Terminal growth →", S.lbl);
  dG.forEach((g, j) => sh.set(8, c0 + 1 + j, f(`Assumptions!$G$${RA.gT}+${a1(9, c0 + 1 + j)}/100`), S.hdrNum2));
  sh.set(9, 3, "WACC ↓            Δ (pp) →", S.lbl); sh.set(9, c0, f(VPS), S.px);
  dG.forEach((g, j) => sh.set(9, c0 + 1 + j, g, S.hdrPp));
  dW.forEach((w, k) => {
    const r = 10 + k;
    sh.set(r, 4, f(`Assumptions!$G$${RA.waccLink}+${a1(r, c0)}/100`), S.hdrNum2);
    sh.set(r, c0, w, S.hdrPp);
    for (let j = 0; j < 5; j++) sh.set(r, c0 + 1 + j, null, S.px);
  });
  const ref = `${a1(10, c0 + 1)}:${a1(14, c0 + 5)}`;
  sh.set(10, c0 + 1, { dt: { ref, dt2D: true, dtr: true, r1: Y8.replace(/\$/g, ""), r2: Y7.replace(/\$/g, "") } }, S.px);
  priceShading(X, sh, ref);
  sh.set(15, 3, f(`"Green: at or above the current price of "&TEXT(${PX},"#,##0.00")&" · red: below · n.m. where WACC ≤ terminal growth"`), S.note);
  bar(X, sh, 17, 3, c0 + 5, "Upside / (downside) vs current price");
  dG.forEach((g, j) => sh.set(18, c0 + 1 + j, f(a1(8, c0 + 1 + j)), S.hdrNum2));
  dW.forEach((w, k) => {
    const r = 19 + k;
    sh.set(r, 4, f(a1(10 + k, 4)), S.hdrNum2);
    for (let j = 0; j < 5; j++) sh.set(r, c0 + 1 + j, f(`IFERROR(${a1(10 + k, c0 + 1 + j)}/${PX}-1,"n.m.")`), S.upPct);
  });
  bar(X, sh, 25, 3, c0 + 5, "Reference: the website's grid at export (used by Checks)", S.subHdr);
  (i.sens || []).forEach((row, k) => {
    const r = 26 + k;
    sh.set(r, 4, row.wacc / 100, S.pct2In);
    row.values.forEach((v, j) => sh.set(r, c0 + 1 + j, fin(v) ? v : "n.m.", S.pxIn));
  });
  X.sens = { grid: ref, web: `${a1(26, c0 + 1)}:${a1(30, c0 + 5)}` };
}

/* ═══════════════════════════════ SCENARIOS ═══════════════════════════════ */
function buildScenarios(X) {
  const sh = newSheet(X, SN.scen), S = X.S, i = X.idcf;
  sh.set(4, 3, "Scenario Analysis — bull · base · bear", S.section);
  sh.set(5, 3, "Bull: growth +4pp (tapering) and margin tilting to +2pp by the last year · Bear: growth to max(2%, g − 5pp), margin tilting to −2pp.", S.amounts);
  controls(X, sh, [[7, "Scenario case index (0 = base)", 0]], { g: `IF(${Y7}=0,0,INDEX($E$9:$E$11,${Y7}))`, tilt: `IF(${Y7}=0,0,INDEX($F$9:$F$11,${Y7}))` });
  bar(X, sh, 7, 3, 6, "Scenario definitions");
  head(X, sh, 8, [3, 4, 5, 6], ["Case", "#", "Growth shift (pp)", "Margin tilt (pp)"]);
  const g1 = `Assumptions!$P$${RA.g}*100`;
  [["Bull (higher growth + margin)", 1, 4, 2], ["Base", 2, 0, 0], ["Bear (slower growth + pressure)", 3, f(`MAX(2,${g1}-5)-(${g1})`), -2]].forEach(([nm, k, g, t], j) => {
    const r = 9 + j; sh.set(r, 3, nm, S.lbl); sh.set(r, 4, k, S.int); sh.set(r, 5, g, typeof g === "number" ? S.ppIn : S.pp); sh.set(r, 6, t, S.ppIn);
  });
  bar(X, sh, 13, 3, 8, "Results (live data table)");
  head(X, sh, 14, [3, 4, 5, 6, 7, 8], ["Scenario", "Case #", "Value / share", "Enterprise value", "Equity value", "vs current"]);
  outRow(X, sh, 15, 5, VPS, S.px); sh.set(15, 6, f(`DCF!$M$${RD.ev}`), S.num); sh.set(15, 7, f(`DCF!$M$${RD.eqv}`), S.num);
  [["Bull (higher growth + margin)", 1], ["Base", 0], ["Bear (slower growth + pressure)", 3]].forEach(([nm, k], j) => {
    const r = 16 + j; sh.set(r, 3, nm, j === 1 ? S.lblB : S.lbl); sh.set(r, 4, k, S.int);
    sh.set(r, 5, null, j === 1 ? S.pxB : S.px); sh.set(r, 6, null, S.num); sh.set(r, 7, null, S.num);
    sh.set(r, 8, f(`IFERROR(E${r}/${PX}-1,"n.m.")`), S.upPct);
  });
  sh.set(16, 5, { dt: { ref: "E16:G18", r1: Y7.replace(/\$/g, "") } }, S.px);
  sh.set(19, 3, "Probability-weighted (25 / 50 / 25)", S.lblB); sh.set(19, 5, f('IFERROR(0.25*E16+0.5*E17+0.25*E18,"n.m.")'), S.pxB); sh.set(19, 8, f(`IFERROR(E19/${PX}-1,"n.m.")`), S.upPctB);
  priceShading(X, sh, "E16:E18");
  bar(X, sh, 21, 3, 8, "Reference: website values at export (used by Checks)", S.subHdr);
  [["Bull", i.bull.perShare], ["Base", i.base.perShare], ["Bear", i.bear.perShare]].forEach(([nm, v], j) => { sh.set(22 + j, 3, nm, S.lbl); sh.set(22 + j, 5, v, S.pxIn); });
  X.scen = { excel: ["E16", "E17", "E18"], web: ["E22", "E23", "E24"] };
}

/* ═══════════════════════════════ REVERSE DCF ═══════════════════════════════ */
function buildReverse(X) {
  const sh = newSheet(X, SN.rev), S = X.S, r_ = X.p.reverse || {};
  sh.set(4, 3, "Reverse DCF — What the Price Implies", S.section);
  sh.set(5, 3, "All other assumptions held; the model is re-run over a grid of Year-1 revenue growth and of WACC, and the point where value = price is interpolated.", S.amounts);
  controls(X, sh, [[7, "Growth shift input (pp vs the Year-1 driver)", 0], [8, "WACC shift input (pp)", 0]], { g: Y7, w: Y8 });
  const G0 = 20, NG = 301, NW = 250;          // grids: growth E–H, WACC J–M, both from row 20
  const gR = (c) => `$${CN(c)}$${G0}:$${CN(c)}$${G0 + NG - 1}`, wR = (c) => `$${CN(c)}$${G0}:$${CN(c)}$${G0 + NW - 1}`;
  const gk = `COUNTIF(${gR(8)},"<0")`;
  const gS = `IF(${gk}=0,"< -15%",IF(${gk}>=${NG},"> 60%",INDEX(${gR(5)},${gk})+(-INDEX(${gR(8)},${gk}))*(INDEX(${gR(5)},${gk}+1)-INDEX(${gR(5)},${gk}))/(INDEX(${gR(8)},${gk}+1)-INDEX(${gR(8)},${gk}))))`;
  const wk = `COUNTIF(${wR(13)},">0")`;
  const wS = `IF(${wk}=0,"very low",IF(${wk}>=${NW},"> 30%",INDEX(${wR(10)},${wk})+INDEX(${wR(13)},${wk})*(INDEX(${wR(10)},${wk}+1)-INDEX(${wR(10)},${wk}))/(INDEX(${wR(13)},${wk})-INDEX(${wR(13)},${wk}+1))))`;
  bar(X, sh, 7, 3, 7, "Market-implied expectations");
  head(X, sh, 8, [5, 6, 7], ["Excel (live)", "Website", "In the model"]);
  sh.set(9, 3, "Market-implied revenue growth (Year 1)", S.lblB); sh.set(9, 5, f(`IF(ISNUMBER(${gS}),${gS}/100,${gS})`), S.pct2B);
  sh.set(9, 6, r_.impliedGrowthBounded === false ? (r_.impliedGrowthSide === "below" ? "< -15%" : "> 60%") : fin(r_.impliedGrowth) ? r_.impliedGrowth / 100 : "n/a", S.pct2In);
  sh.set(9, 7, f(`Assumptions!$P$${RA.g}`), S.pct2Link);
  sh.set(10, 3, "Market-implied WACC", S.lblB); sh.set(10, 5, f(`IF(ISNUMBER(${wS}),${wS}/100,${wS})`), S.pct2B);
  sh.set(10, 6, r_.impliedWaccBounded === false ? (r_.impliedWaccSide === "below" ? "very low" : "> 30%") : fin(r_.impliedWacc) ? r_.impliedWacc / 100 : "n/a", S.pct2In);
  sh.set(10, 7, f(`Assumptions!$G$${RA.waccLink}`), S.pct2Link);
  sh.set(11, 3, "Model value per share / current price", S.lbl); sh.set(11, 5, f(`DCF!$M$${RD.ps}`), S.pxLink); sh.set(11, 6, fin(r_.basePerShare) ? r_.basePerShare : null, S.pxIn); sh.set(11, 7, f(PX), S.pxLink);
  sh.set(12, 3, "Growth gap: implied − assumed (pp)", S.lbl); sh.set(12, 5, f('IFERROR((E9-G9)*100,"n.m.")'), S.pp);
  sh.set(13, 3, f('IF(ISNUMBER(E12),IF(E12>1.5,"The market pays for more growth than the model assumes — the price already embeds expectations above the base case.",IF(E12<-1.5,"The market prices less growth than the model assumes — if the assumptions hold, expectations are beatable.","Market-implied growth is within ±1.5pp of the model: the debate is assumption quality, not an expectations gap.")),"")'), S.note);
  sh.set(14, 3, "Grids: growth −15% to 60% in 0.25pp steps; WACC from max(g + 0.35pp, 1%) to 30% in 0.1pp steps (the website's search bands).", S.note);
  // growth grid E–H (F = data-table input, G = result)
  bar(X, sh, 17, 5, 8, "Growth grid (live data table)"); bar(X, sh, 17, 10, 13, "WACC grid (live data table)");
  head(X, sh, 18, [5, 6, 7, 8, 10, 11, 12, 13], ["Year-1 growth %", "Shift (pp)", "Value / share", "Value − price", "WACC %", "Shift (pp)", "Value / share", "Value − price"]);
  sh.set(19, 3, "Model output (feeds the data tables)", S.note); sh.set(19, 7, f(VPS), S.px); sh.set(19, 12, f(VPS), S.px);
  for (let k = 0; k < NG; k++) {
    const r = G0 + k;
    sh.set(r, 5, +(-15 + 0.25 * k).toFixed(2), S.dec); sh.set(r, 6, f(`E${r}-Assumptions!$P$${RA.g}*100`), S.dec);
    sh.set(r, 7, null, S.px); sh.set(r, 8, f(`IFERROR(G${r}-${PX},"")`), S.px);
  }
  sh.set(G0, 7, { dt: { ref: `G${G0}:G${G0 + NG - 1}`, r1: Y7.replace(/\$/g, "") } }, S.px);
  for (let k = 0; k < NW; k++) {
    const r = G0 + k;
    sh.set(r, 10, f(`MAX(Assumptions!$G$${RA.gT}*100+0.35,1)+0.1*${k}`), S.dec); sh.set(r, 11, f(`J${r}-Assumptions!$G$${RA.waccLink}*100`), S.dec);
    sh.set(r, 12, null, S.px); sh.set(r, 13, f(`IFERROR(L${r}-${PX},"")`), S.px);
  }
  sh.set(G0, 12, { dt: { ref: `L${G0}:L${G0 + NW - 1}`, r1: Y8.replace(/\$/g, "") } }, S.px);
  X.rev = { g: "E9", gWeb: "F9", w: "E10", wWeb: "F10" };
}

/* ═══════════════════════════════ TORNADO ═══════════════════════════════ */
function buildTornado(X) {
  const sh = newSheet(X, SN.torn), S = X.S, t = X.p.tornado || { bars: [] };
  sh.set(4, 3, "Tornado — Where the Model Lives and Dies", S.section);
  sh.set(5, 3, "One-way sensitivity: each driver is flexed by an institutional-standard step while all other assumptions are held at their current values.", S.amounts);
  const P = (r) => `Assumptions!$P$${r}*100`;
  const D = [
    ["Revenue growth (Y1–5)", 3, "growth", { g: -3 }, { g: 3 }, f(`Assumptions!$P$${RA.g}`)],
    ["EBITDA margin", 2, "margin", { m: -2 }, { m: 2 }, f(`Assumptions!$P$${RA.m}`)],
    ["WACC", 1, "wacc", { w: 1 }, { w: -1 }, f(`Assumptions!$G$${RA.waccLink}`)],
    ["Terminal growth", 0.5, "terminalG", { tg: -0.5 }, { tg: 0.5 }, f(`Assumptions!$G$${RA.gT}`)],
    ["Capex % of revenue", 1, "capex", { cap: 1 }, { cap: `MAX(0,${P(RA.capexPct)}-1)-${P(RA.capexPct)}` }, f(`Assumptions!$P$${RA.capexPct}`)],
    ["Effective tax rate", 2, "tax", { tax: `MIN(60,${P(RA.taxRate)}+2)-${P(RA.taxRate)}` }, { tax: `MAX(0,${P(RA.taxRate)}-2)-${P(RA.taxRate)}` }, f(`Assumptions!$P$${RA.taxRate}`)],
    ["Incremental WC % of Δrevenue", 1, "wc", { wc: 1 }, { wc: `MAX(0,${P(RA.wcPct)}-1)-${P(RA.wcPct)}` }, f(`Assumptions!$P$${RA.wcPct}`)],
  ];
  const keys = ["g", "m", "cap", "tax", "wc", "w", "tg"], kc = (k) => 5 + keys.indexOf(k);   // E..K
  const C0 = 9, C1 = C0 + 13;                                                               // case rows 9–22
  const flex = {}; keys.forEach((k) => { flex[k] = `IF(${Y7}=0,0,INDEX(${CN(kc(k))}$${C0}:${CN(kc(k))}$${C1},${Y7}))`; });
  controls(X, sh, [[7, "Tornado case index (0 = base)", 0]], flex);
  bar(X, sh, 7, 3, 11, "One-way cases (flex applied to the model)");
  head(X, sh, 8, [3, 4, ...keys.map(kc)], ["Case", "#", "Growth (pp)", "Margin (pp)", "Capex (pp)", "Tax (pp)", "NWC (pp)", "WACC (pp)", "Term. g (pp)"]);
  let r = C0;
  D.forEach(([label, , , lo, hi]) => {
    [[`${label} — low`, lo], [`${label} — high`, hi]].forEach(([nm, cs]) => {
      sh.set(r, 3, nm, S.lbl); sh.set(r, 4, r - C0 + 1, S.int);
      keys.forEach((k) => { const v = cs[k]; sh.set(r, kc(k), v == null ? 0 : typeof v === "number" ? v : f(v), typeof v === "number" || v == null ? S.ppIn : S.pp); });
      r++;
    });
  });
  // data table over the 14 cases
  const T0 = C1 + 2;                          // 24
  bar(X, sh, T0, 3, 5, "Value per case (live data table)");
  head(X, sh, T0 + 1, [4, 5], ["Case #", "Value / share"]);
  outRow(X, sh, T0 + 2, 5, VPS, S.px);
  for (let k = 1; k <= 14; k++) { sh.set(T0 + 2 + k, 3, f(`C${C0 + k - 1}`), S.lbl); sh.set(T0 + 2 + k, 4, k, S.int); sh.set(T0 + 2 + k, 5, null, S.px); }
  sh.set(T0 + 3, 5, { dt: { ref: `E${T0 + 3}:E${T0 + 16}`, r1: Y7.replace(/\$/g, "") } }, S.px);
  // results in driver order
  const R0 = T0 + 18;                         // 42
  bar(X, sh, R0, 3, 11, "Tornado by driver");
  head(X, sh, R0 + 1, [3, 4, 5, 6, 7, 8, 9, 10, 11], ["Driver", "Step (pp)", "Base value", "Low / share", "High / share", "Swing", "Swing % of base", "± half-swing %", "Rank"]);
  const d0 = R0 + 2, d1 = d0 + 6;
  D.forEach(([label, step, , , , base], j) => {
    const rr = d0 + j, lo = `E${T0 + 3 + 2 * j}`, hi = `E${T0 + 4 + 2 * j}`;
    sh.set(rr, 3, label, S.lbl); sh.set(rr, 4, step, S.dec); sh.set(rr, 5, base, S.pct2Link);
    sh.set(rr, 6, f(`MIN(${lo},${hi})`), S.px); sh.set(rr, 7, f(`MAX(${lo},${hi})`), S.px);
    sh.set(rr, 8, f(`G${rr}-F${rr}`), S.px); sh.set(rr, 9, f(`IFERROR(H${rr}/DCF!$M$${RD.ps},0)`), S.pctN);
    sh.set(rr, 10, f(`I${rr}/2`), S.pctN); sh.set(rr, 11, f(`RANK(H${rr},$H$${d0}:$H$${d1},0)+COUNTIF($H$${d0}:H${rr},H${rr})-1`), S.int);
  });
  const K0 = d1 + 2;
  bar(X, sh, K0, 3, 8, "Ranked (largest swing first)");
  head(X, sh, K0 + 1, [3, 4, 5, 6, 7, 8], ["Driver", "Rank", "Low / share", "High / share", "Swing", "± half-swing %"]);
  for (let k = 1; k <= 7; k++) {
    const rr = K0 + 1 + k, m = `MATCH(${k},$K$${d0}:$K$${d1},0)`;
    sh.set(rr, 4, k, S.int); sh.set(rr, 3, f(`INDEX($C$${d0}:$C$${d1},${m})`), S.lbl);
    sh.set(rr, 5, f(`INDEX($F$${d0}:$F$${d1},${m})`), S.px); sh.set(rr, 6, f(`INDEX($G$${d0}:$G$${d1},${m})`), S.px);
    sh.set(rr, 7, f(`INDEX($H$${d0}:$H$${d1},${m})`), S.px); sh.set(rr, 8, f(`INDEX($J$${d0}:$J$${d1},${m})`), S.pctN);
  }
  dataBar(sh, `G${K0 + 2}:G${K0 + 8}`, "FFC0504D");
  sh.set(K0 + 9, 3, f(`"Largest driver: "&C${K0 + 2}&" ("&TEXT(E${K0 + 2},"#,##0.00")&" – "&TEXT(F${K0 + 2},"#,##0.00")&" per share) — the assumption to underwrite hardest."`), S.note);
  const W0 = K0 + 11;
  bar(X, sh, W0, 3, 7, "Reference: website values at export (used by Checks)", S.subHdr);
  D.forEach(([label, , key], j) => {
    const b = (t.bars || []).find((x) => x.key === key) || {};
    sh.set(W0 + 1 + j, 3, label, S.lbl); sh.set(W0 + 1 + j, 6, fin(b.lowPx) ? b.lowPx : null, S.pxIn); sh.set(W0 + 1 + j, 7, fin(b.highPx) ? b.highPx : null, S.pxIn);
  });
  X.torn = { excel: `F${d0}:G${d1}`, web: `F${W0 + 1}:G${W0 + 7}`, rankRow: K0 + 2 };
}

/* ═══════════════════════════════ MONTE CARLO ═══════════════════════════════ */
function buildMonteCarlo(X) {
  const sh = newSheet(X, SN.mc, { cols: [[1, 1, 4.58], [2, 2, 1.58], [3, 3, 34], [4, 4, 2], [5, 12, 13.58], [13, 13, 2], [14, 19, 12.5], [20, 22, 11]] }), S = X.S, mc = X.p.monteCarlo || {}, Z = X.p.mcDraws || [];
  const n = Z.length, R0 = 25;               // draws / run table start
  sh.set(4, 3, `Monte Carlo Simulation — ${n.toLocaleString("en-US")} runs on the live model`, S.section);
  sh.set(5, 3, `Seeded normal shocks (seed ${mc.seed || ""}, bounded ±3σ), identical to the website: WACC ±1.0pp, terminal growth ±0.5pp (≥ 2.5pp below WACC), revenue growth ±2.5pp tapering to zero, EBITDA margin ±10% relative.`, S.amounts);
  const z = (col) => `INDEX($${col}$${R0}:$${col}$${R0 + n - 1},${Y7})`;
  controls(X, sh, [[7, "Monte Carlo run index (0 = base)", 0]], {
    w: `IF(${Y7}=0,0,${z("F")}*1)`,
    tg: `IF(${Y7}=0,0,MIN(${z("G")}*0.5,Assumptions!$G$${RA.waccLink}*100+${YF("w")}-2.5-Assumptions!$G$${RA.gT}*100))`,
    gmc: `IF(${Y7}=0,0,${z("H")}*2.5)`,
    mrel: `IF(${Y7}=0,0,${z("I")}*10)`,
  });
  const res = `$J$${R0}:$J$${R0 + n - 1}`, cnt = `COUNT(${res})`, pct = (p) => `SMALL(${res},MIN(${cnt},INT(${p}*${cnt})+1))`;
  // statistics C–F, rows 7–19
  bar(X, sh, 7, 3, 6, "Distribution of value per share");
  head(X, sh, 8, [5, 6], ["Excel (live)", "Website"]);
  const stats = [["runs", "Runs", cnt, mc.runs, "int"], ["mean", "Mean", `AVERAGE(${res})`, mc.mean], ["median", "Median", pct(0.5), mc.median], ["p5", "5th percentile", pct(0.05), mc.p5], ["p25", "25th percentile", pct(0.25), mc.p25],
    ["p75", "75th percentile", pct(0.75), mc.p75], ["p95", "95th percentile", pct(0.95), mc.p95], ["min", "Minimum", `MIN(${res})`, mc.min], ["max", "Maximum", `MAX(${res})`, mc.max],
    ["prob", "P(value > price)", `COUNTIF(${res},">"&${PX})/${cnt}`, fin(mc.probAbove) ? mc.probAbove / 100 : null, "pct"], ["base", "Base case (all shocks 0)", `DCF!$M$${RD.ps}`, mc.baseCheck]];
  X.mc = {};
  stats.forEach(([key, nm, fx, web, kind], j) => {
    const r = 9 + j; X.mc[key] = r;
    sh.set(r, 3, nm, key === "mean" || key === "median" ? S.lblB : S.lbl);
    sh.set(r, 5, f(fx), kind === "pct" ? S.pctN : kind === "int" ? S.int : S.px);
    sh.set(r, 6, fin(web) ? web : null, kind === "pct" ? X.wb.styles.variant(S.pctIn, {}) : kind === "int" ? S.intIn : S.pxIn);
  });
  // histogram N–S, rows 7–29
  bar(X, sh, 7, 14, 19, "Histogram (20 buckets, 2nd–98th percentile)");
  sh.set(8, 14, "Lower bound (2nd pct)", S.lbl); sh.set(8, 17, f(pct(0.02)), S.px);
  sh.set(9, 14, "Upper bound (98th pct)", S.lbl); sh.set(9, 17, f(pct(0.98)), S.px);
  head(X, sh, 10, [14, 15, 16, 17, 18, 19], ["Bucket", "From", "To", "Mid-point", "Runs", "Share"]);
  for (let k = 0; k < 20; k++) {
    const r = 11 + k, lo = `$Q$8+(${k})*($Q$9-$Q$8)/20`, hi = `$Q$8+(${k + 1})*($Q$9-$Q$8)/20`;
    sh.set(r, 14, k + 1, S.int); sh.set(r, 15, f(lo), S.px); sh.set(r, 16, f(hi), S.px); sh.set(r, 17, f(`(O${r}+P${r})/2`), S.px);
    sh.set(r, 18, f(k < 19 ? `COUNTIFS(${res},">="&O${r},${res},"<"&P${r})` : `COUNTIFS(${res},">="&O${r},${res},"<="&$Q$9)`), S.int);
    sh.set(r, 19, f(`IFERROR(R${r}/${cnt},0)`), S.pctN);
  }
  dataBar(sh, "R11:R30", "FFC8862A");
  sh.set(20, 3, "Column R bars: distribution of intrinsic value per share.", S.note);
  // draws + live data table (inputs: run # in K, result in L; J mirrors L for the statistics)
  bar(X, sh, R0 - 3, 5, 12, "Seeded draws (standard normal, bounded ±3σ) and each run's value (live data table)");
  head(X, sh, R0 - 2, [5, 6, 7, 8, 9, 10, 11, 12], ["Run", "z WACC", "z terminal g", "z growth", "z margin", "Value / share", "Run (table)", "Value (table)"]);
  sh.set(R0 - 1, 3, "Model output (feeds the data table)", S.note); sh.set(R0 - 1, 12, f(VPS), S.px);
  Z.forEach((zz, k) => {
    const r = R0 + k;
    sh.set(r, 5, k + 1, S.int); sh.set(r, 6, zz[0], S.z); sh.set(r, 7, zz[1], S.z); sh.set(r, 8, zz[2], S.z); sh.set(r, 9, zz[3], S.z);
    sh.set(r, 10, f(`L${r}`), S.px); sh.set(r, 11, f(`E${r}`), S.int); sh.set(r, 12, null, S.px);
  });
  sh.set(R0, 12, { dt: { ref: `L${R0}:L${R0 + n - 1}`, r1: Y7.replace(/\$/g, "") } }, S.px);
}
function finishMonteCarloTable() { /* the run table is built with the sheet */ }

/* ═══════════════════════════════ COMPARABLE COMPANIES ═══════════════════════════════ */
function buildComps(X) {
  const sh = newSheet(X, SN.comps, { cols: [[1, 1, 4.58], [2, 2, 1.58], [3, 3, 36], [4, 4, 16], [5, 16, 13.58]] }), S = X.S, st = X.wb.styles, p = X.p;
  sh.set(4, 3, "Relative Valuation · Comparable Companies", S.section);
  sh.set(5, 3, "Trading multiples from Yahoo Finance at export (inputs). Medians use the website's rule — the upper middle value of the sorted peers, excluding the company itself.", S.amounts);
  const panel = p.peers.panel || [], val = p.peers.valuation || [];
  const selfRow = panel[0] || val[0];
  const bySym = new Map(); [...panel.slice(1), ...val.slice(1)].forEach((r) => { if (r && r.symbol && !bySym.has(r.symbol)) bySym.set(r.symbol, r); });
  const peers = [...bySym.values()];
  const inPanel = new Set(panel.slice(1).map((r) => r.symbol)), inVal = new Set(val.slice(1).map((r) => r.symbol));
  const cols = [["Company", "name"], ["Ticker", "symbol"], [`Market cap (${X.unit})`, "mcap"], ["P/E", "pe"], ["EV/EBITDA", "evEbitda"], ["P/B", "pb"], ["ROE %", "roe"], ["Net margin %", "netMargin"], ["Revenue growth %", "revGrowth"], ["Debt / equity", "de"], ["Dividend yield %", "divYield"], ["In comps panel", "inPanel"], ["In valuation set", "inVal"]];
  bar(X, sh, 7, 3, 2 + cols.length, "Peer multiples");
  const hdrW = st.variant(S.hdrText, { wrap: true, valign: "center" });
  cols.forEach(([h], j) => sh.set(8, 3 + j, h, hdrW)); sh.height(8, 30);
  const all = [selfRow, ...peers].filter(Boolean);
  const fmt = { mcap: S.numIn, pe: S.x2In, evEbitda: S.x2In, pb: S.x2In, roe: S.decIn, netMargin: S.decIn, revGrowth: S.decIn, de: S.x2In, divYield: S.decIn };
  all.forEach((row, k) => {
    const r = 9 + k;
    cols.forEach(([, key], j) => {
      const c = 3 + j;
      if (key === "name") sh.set(r, c, (k === 0 ? "★ " : "") + (row.name || row.symbol), k === 0 ? S.lblB : S.lbl);
      else if (key === "symbol") sh.set(r, c, row.symbol, S.textLeft);
      else if (key === "inPanel") sh.set(r, c, k === 0 ? 0 : inPanel.has(row.symbol) ? 1 : 0, S.intIn);
      else if (key === "inVal") sh.set(r, c, k === 0 ? 0 : inVal.has(row.symbol) ? 1 : 0, S.intIn);
      else if (key === "mcap") sh.set(r, c, fin(row.mcap) ? row.mcap / X.scale : null, fmt.mcap);
      else sh.set(r, c, fin(row[key]) ? row[key] : null, fmt[key]);
    });
  });
  const r1 = 10, r2 = 8 + all.length, last = Math.max(r1, r2);
  const flagC = (nm) => CN(3 + cols.findIndex((x) => x[1] === nm));
  const med = (colKey, flag) => {
    const C = CN(3 + cols.findIndex((x) => x[1] === colKey)), F = flagC(flag);
    const rng = `$${C}$${r1}:$${C}$${last}`, fr = `$${F}$${r1}:$${F}$${last}`;
    const nOk = `SUMPRODUCT((${fr}=1)*ISNUMBER(${rng}))`;
    return `IF(${nOk}=0,"",SMALL(IF((${fr}=1)*ISNUMBER(${rng}),${rng}),INT(${nOk}/2)+1))`;
  };
  const mr = last + 2;
  sh.set(mr, 3, "Median — comps panel (upper median)", S.lblB); sh.set(mr + 1, 3, "Median — valuation peer set (upper median)", S.lblB);
  cols.forEach(([, key], j) => {
    if (["name", "symbol", "inPanel", "inVal", "mcap"].includes(key)) return;
    const c = 3 + j, st_ = /pe|evEbitda|pb|de/.test(key) ? S.x2 : S.dec;
    const c1 = sh.set(mr, c, f(med(key, "inPanel")), st_); c1.arr = true;
    const c2 = sh.set(mr + 1, c, f(med(key, "inVal")), st_); c2.arr = true;
  });
  X.compsMed = { row: mr + 1, col: (key) => CN(3 + cols.findIndex((x) => x[1] === key)) };
  // company vs peers (the website's comps panel)
  const tr = mr + 3;
  bar(X, sh, tr, 3, 7, "Company vs peer median (comps panel)");
  ["Multiple", "Company", "Peer median", "Premium / (discount)"].forEach((h, j) => sh.set(tr + 1, 3 + j, h, hdrW)); sh.height(tr + 1, 30);
  [["P/E", "pe"], ["EV/EBITDA", "evEbitda"], ["P/B", "pb"]].forEach(([nm, key], j) => {
    const r = tr + 2 + j, C = X.compsMed.col(key);
    sh.set(r, 3, nm, S.lbl); sh.set(r, 4, f(`${C}9`), S.x2); sh.set(r, 5, f(`${C}${mr}`), S.x2); sh.set(r, 6, f(`IFERROR(D${r}/E${r}-1,"—")`), S.upPct);
  });
  sh.set(tr + 6, 3, "A premium is only warranted where growth, returns or quality exceed the peer set.", S.note);
}

/* ═══════════════════════════════ VALUATION METHODS ═══════════════════════════════ */
function buildValuation(X) {
  const sh = newSheet(X, SN.val, { cols: [[1, 1, 4.58], [2, 2, 1.58], [3, 3, 46], [4, 4, 13.58], [5, 5, 13.58], [6, 6, 11], [7, 7, 11], [8, 8, 15], [9, 9, 70]] }), S = X.S, st = X.wb.styles, p = X.p, v = p.valInputs || {}, V = p.valuation || {};
  const lab = p.meta.dcfMode === "lab";
  sh.set(4, 3, "Valuation Methods · Blended Target", S.section);
  sh.set(5, 3, V.targetMethod ? `Website: ${V.targetMethod}` : "Blended target", S.amounts);
  const d = X.d;
  // inputs
  bar(X, sh, 7, 3, 5, "Inputs");
  const inp = [];
  const put = (key, label, value, style, isLink) => { const r = 8 + inp.length; inp.push(key); sh.set(r, 3, label, S.lbl); sh.set(r, 4, value, style); return r; };
  const R = {};
  R.basis = put("basis", "Research basis (market / lab)", lab ? "lab" : "market", S.textIn);
  R.isFin = put("isFin", "Financial-sector company (1 = yes)", v.isFin ? 1 : 0, S.intIn);
  R.ebitda = put("ebitda", `EBITDA, last fiscal year (${X.unit})`, f(`Financials!$M$${RF.ebitda}`), S.numLink);
  R.ni = put("ni", `Net income attributable, last fiscal year (${X.unit})`, d(v.netIncome), S.numIn);
  R.eq = put("eq", `Book equity, last fiscal year (${X.unit})`, d(v.bookEquity), S.numIn);
  const sharesLinked = Math.abs((v.sharesOut || 0) - (X.idcf.sharesOut || 0)) < 1;
  R.sh = put("sh", `Shares outstanding (${X.isINR ? "Cr" : "Mn"})`, sharesLinked ? f(`Assumptions!$G$${RA.shares}`) : d(v.sharesOut), sharesLinked ? st.variant(S.numLink, { numFmt: "#,##0.0000" }) : st.variant(S.numIn, { numFmt: "#,##0.0000" }));
  const ndLinked = Math.abs((v.netDebt || 0) - (X.idcf.netDebt || 0)) < 1;
  R.nd = put("nd", `Net debt (${X.unit})`, ndLinked ? f(`-DCF!$M$${RD.debt}-DCF!$M$${RD.cash}`) : d(v.netDebt), ndLinked ? S.numLink : S.numIn);
  R.px = put("px", "Current share price", f(PX), S.pxLink);
  R.eps = put("eps", "EPS (net income ÷ shares)", f(`IFERROR(D${8 + inp.length - 4 + 1 - 1 + 0}/D${8 + inp.indexOf("sh")},0)`), S.px);
  sh.set(R.eps, 4, f(`IFERROR(D${R.ni}/D${R.sh},0)`), S.px);
  R.bvps = put("bvps", "Book value per share", f(`IFERROR(D${R.eq}/D${R.sh},0)`), S.px);
  R.ke = put("ke", "Cost of equity (%)", lab ? f(`Assumptions!$G$${RA.ke}*100`) : fin(v.ke) ? v.ke : 11, lab ? st.variant(S.numLink, { numFmt: "0.00" }) : S.decIn);
  R.payout = put("payout", "Payout ratio (blank = not reported)", fin(v.payout) ? v.payout : null, S.pct2In);
  R.roe = put("roe", "ROE (%) (12 if not reported)", fin(v.roe) ? v.roe : 12, S.decIn);
  R.gr = put("gr", "Revenue CAGR (%)", fin(v.revCagr) ? v.revCagr : null, S.decIn);
  R.div = put("div", "Dividend per share", fin(v.divRate) ? v.divRate : null, S.pxIn);
  R.pe5 = put("pe5", "Own 5-year median P/E", fin(v.pe5) ? v.pe5 : null, S.x2In);
  R.pb5 = put("pb5", "Own 5-year median P/B", fin(v.pb5) ? v.pb5 : null, S.x2In);
  const stt = v.street || {};
  R.stT = put("stT", "Street mean target", fin(stt.targetMean) ? stt.targetMean : null, S.pxIn);
  R.stN = put("stN", "Covering analysts", fin(stt.analysts) ? stt.analysts : 0, S.intIn);
  const fv = v.fairValue || {};
  R.fv = put("fv", `Published fair value${fv.provider ? " (" + fv.provider + ")" : ""}`, fin(fv.value) ? fv.value : null, S.pxIn);
  const M = X.compsMed;
  R.pEv = put("pEv", "Peer median EV/EBITDA (valuation set)", f(`'${SN.comps}'!$${M.col("evEbitda")}$${M.row}`), S.x2Link);
  R.pPe = put("pPe", "Peer median P/E (valuation set)", f(`'${SN.comps}'!$${M.col("pe")}$${M.row}`), S.x2Link);
  R.pGr = put("pGr", "Peer median revenue growth % (valuation set)", f(`'${SN.comps}'!$${M.col("revGrowth")}$${M.row}`), st.variant(S.numLink, { numFmt: "0.00" }));
  const D_ = (k) => `$D$${R[k]}`, num = (k) => `ISNUMBER(${D_(k)})`;
  // residual income schedule (10 years, ROE fading to the cost of equity)
  const RI0 = 8 + inp.length + 2;
  bar(X, sh, RI0, 3, 8, "Residual income schedule (per share)");
  ["Year", "ROE", "Excess return", "PV", "Closing book"].forEach((h, j) => sh.set(RI0 + 1, 4 + j, h, S.hdrText));
  sh.set(RI0 + 2, 3, "Retention = clamp(1 − payout (0.4 if blank), 0, 0.9)", S.lbl); sh.set(RI0 + 2, 8, f(`MIN(0.9,MAX(0,1-IF(${num("payout")},MIN(1.5,MAX(0,${D_("payout")})),0.4)))`), S.pctN);
  for (let y = 1; y <= 10; y++) {
    const r = RI0 + 2 + y, ke = `(${D_("ke")}/100)`, roe = `(${D_("roe")}/100)`;
    sh.set(r, 4, y, S.int);
    sh.set(r, 5, f(`${roe}+(${ke}-${roe})*D${r}/10`), S.pctN);
    const bvPrev = y === 1 ? D_("bvps") : `H${r - 1}`;
    sh.set(r, 6, f(`(E${r}-${ke})*${bvPrev}`), S.px);
    sh.set(r, 7, f(`F${r}/(1+${ke})^D${r}`), S.px);
    sh.set(r, 8, f(`${bvPrev}+${bvPrev}*E${r}*$H$${RI0 + 2}`), S.px);
  }
  const riVal = `${D_("bvps")}+SUM(G${RI0 + 3}:G${RI0 + 12})`;
  // methods
  const T0 = RI0 + 14;
  bar(X, sh, T0, 3, 9, "Methods (live formulas) and the blended target");
  ["Method", "Role", "Value / share", "Valid", "Weight", "Website value", "Working"].forEach((h, j) => sh.set(T0 + 1, 3 + j, h, S.hdrText));
  const ke = `(${D_("ke")}/100)`, roe = `(${D_("roe")}/100)`;
  const clampRel = `MIN(2,MAX(0.5,${D_("gr")}/${D_("pGr")}))`;
  const pay = `MIN(1.5,MAX(0,${D_("payout")}))`;
  const gD = `MIN(MAX(MIN(${roe}*(1-MIN(${pay},1)),IF(${num("gr")},${D_("gr")},5)/100),0),${ke}-0.02)`;
  const mkt = `${D_("basis")}="market"`;
  const methods = [
    ["EV / EBITDA", `"relative"`, `IF(AND(${num("pEv")},${D_("pEv")}<>0,${D_("ebitda")}<>0,${D_("isFin")}=0,${D_("sh")}<>0),(${D_("ebitda")}*${D_("pEv")}-${D_("nd")})/${D_("sh")},"")`, "Peer-median EV/EBITDA × EBITDA, less net debt, per share", "EV / EBITDA"],
    ["P / E", `"relative"`, `IF(AND(${num("pPe")},${D_("pPe")}<>0,${D_("eps")}>0),${D_("eps")}*${D_("pPe")},"")`, "Peer-median P/E × trailing EPS", "P / E"],
    ["PEG (growth-adjusted peer P/E)", `"relative"`, `IF(AND(${num("pPe")},${D_("pPe")}<>0,${D_("eps")}>0,${num("gr")},${D_("gr")}>0,${num("pGr")},${D_("pGr")}>0),${D_("eps")}*${D_("pPe")}*${clampRel},"")`, "Peer P/E × clamp(company growth ÷ peer growth, 0.5–2) × EPS", "PEG (growth-adjusted peer P/E)"],
    ["Own 5-year median P/E", `"relative"`, `IF(AND(${num("pe5")},${D_("eps")}>0,${D_("isFin")}=0),${D_("eps")}*${D_("pe5")},"")`, "EPS at the stock's own 5-year median P/E", "Own 5-year median P/E"],
    ["Own 5-year median P/B", `"relative"`, `IF(AND(${num("pb5")},${D_("bvps")}<>0,${D_("isFin")}=1),${D_("bvps")}*${D_("pb5")},"")`, "Book value per share at the own 5-year median P/B (financials)", "Own 5-year median P/B"],
    ["Residual Income", `IF(${mkt},"crosscheck","relative")`, `IF(AND(${D_("bvps")}<>0,${D_("eps")}<>0,${roe}>0),${riVal},"")`, "Book value + PV of excess returns, ROE fading to the cost of equity over 10 years", "Residual Income"],
    ["Dividend Discount", `IF(${mkt},"crosscheck","relative")`, `IF(AND(${num("div")},${D_("div")}>0,${num("payout")},${D_("payout")}>=0.4),${D_("div")}*(1+${gD})/(${ke}-${gD}),"")`, "Gordon growth on the dividend; growth capped at ROE × (1 − payout)", "Dividend Discount"],
    ["Sum-of-the-Parts", `"crosscheck"`, `IF(AND(${D_("ebitda")}<>0,${num("pEv")},${D_("pEv")}<>0,${D_("sh")}<>0,${D_("isFin")}=0),(${D_("ebitda")}*${D_("pEv")}-${D_("nd")})/${D_("sh")},"")`, "Single-segment proxy at the peer multiple (never weighted)", "Sum-of-the-Parts"],
    [`Street consensus target`, `"market"`, `IF(AND(${mkt},${num("stT")},${D_("stN")}>=3),${D_("stT")},"")`, "Mean 12-month target of covering analysts (market basis only)", "Street consensus"],
    [lab ? "DCF (intrinsic)" : `Fair value${fv.provider ? " (" + fv.provider + ")" : ""}`, `"anchor"`, lab ? `IF(${mkt},"",DCF!$M$${RD.ps})` : `IF(AND(${mkt},${num("fv")}),${D_("fv")},"")`, lab ? "The Modeling Lab DCF (this workbook) — the 40% intrinsic anchor" : "Published third-party fair value — the 40% anchor on the market basis", lab ? "DCF (intrinsic)" : "Fair value"],
  ];
  const webVal = (key) => { const m = (V.methods || []).find((x) => x.name.startsWith(key)); return m && fin(m.value) ? m.value : null; };
  const r1 = T0 + 2, r2 = T0 + 1 + methods.length;
  methods.forEach(([nm, role, fx, note, key], j) => {
    const r = r1 + j;
    sh.set(r, 3, nm, S.lbl); sh.set(r, 4, f(role), S.textLeft); sh.set(r, 5, f(fx), S.px);
    sh.set(r, 6, f(`IF(AND(ISNUMBER(E${r}),N(E${r})>0),1,0)`), S.int);
    sh.set(r, 8, webVal(key), S.pxIn); sh.set(r, 9, note, S.note);
  });
  const roleR = `$D$${r1}:$D$${r2}`, okR = `$F$${r1}:$F$${r2}`, valR = `$E$${r1}:$E$${r2}`;
  const nSet = `(COUNTIFS(${roleR},"relative",${okR},1)+COUNTIFS(${roleR},"market",${okR},1))`;
  const sumSet = `(SUMIFS(${valR},${roleR},"relative",${okR},1)+SUMIFS(${valR},${roleR},"market",${okR},1))`;
  const anc = `COUNTIFS(${roleR},"anchor",${okR},1)`, ancV = `SUMIFS(${valR},${roleR},"anchor",${okR},1)`;
  methods.forEach((m, j) => {
    const r = r1 + j;
    sh.set(r, 7, f(`IF(F${r}=0,0,IF(D${r}="anchor",IF(${nSet}>0,0.4,1),IF(OR(D${r}="relative",D${r}="market"),IF(${anc}>0,0.6,1)/${nSet},0)))`), S.pctN);
  });
  const B = r2 + 2;
  sh.set(B, 3, "Blended target", S.lblB);
  sh.set(B, 5, f(`IF(AND(${anc}>0,${nSet}>0),${ancV}*0.4+${sumSet}/${nSet}*0.6,IF(${nSet}>0,${sumSet}/${nSet},IF(${anc}>0,${ancV},"")))`), S.pxB);
  sh.set(B, 7, f(`SUM(G${r1}:G${r2})`), S.pctN); sh.set(B, 8, fin(V.blended) ? V.blended : null, S.pxIn);
  sh.set(B + 1, 3, "Current price", S.lbl); sh.set(B + 1, 5, f(PX), S.pxLink);
  sh.set(B + 2, 3, "Upside / (downside) to the blended target", S.lblB); sh.set(B + 2, 5, f(`IFERROR(E${B}/E${B + 1}-1,"")`), S.upPctB); sh.set(B + 2, 8, fin(V.upside) ? V.upside / 100 : null, X.wb.styles.variant(S.pctIn, {}));
  sh.set(B + 4, 3, "Each method is a cross-check, not a point forecast; the spread between them is itself information about valuation uncertainty. Cross-checks carry no weight.", S.note);
  X.valBlendRow = B; X.valBlendCol = "E"; X.valRange = { r1, r2 };
}

module.exports = { buildSensitivity, buildScenarios, buildReverse, buildTornado, buildMonteCarlo, finishMonteCarloTable, buildComps, buildValuation, newSheet, bar };
