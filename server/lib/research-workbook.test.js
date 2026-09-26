/**
 * MERIDIAN — consolidated research workbook tests.
 * Builds the full workbook from a synthetic company pack (no network) and
 * reads it back with ExcelJS to prove every sheet assembles without error,
 * including the failure-isolated paths (null packs).
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("./analytics");
const { buildResearchWorkbook } = require("./research-workbook");

function syntheticCo() {
  const years = [2021, 2022, 2023, 2024, 2025];
  const income = [], balance = [], cashflow = [];
  let rev = 800e7;
  for (const year of years) {
    rev *= 1.12;
    const ebitda = rev * 0.24, dep = rev * 0.04, op = ebitda - dep, int = rev * 0.01;
    const pretax = op - int, tax = pretax * 0.25, ni = pretax - tax;
    income.push({ year, revenue: rev, grossProfit: rev * 0.42, ebitda, opIncome: op, ebit: op, interest: int, pretax, tax, netIncome: ni, basicEPS: ni / 10e7 });
    balance.push({ year, assets: rev * 1.5, equity: rev * 0.8, currentAssets: rev * 0.5, currentLiab: rev * 0.3, stDebt: rev * 0.05, ltDebt: rev * 0.15, cash: rev * 0.1, totalDebt: rev * 0.2, receivables: rev * 0.12, inventory: rev * 0.1 });
    cashflow.push({ year, ocf: ni + dep, cfo: ni + dep, dep, capex: rev * 0.05, fcf: ni + dep - rev * 0.05 });
  }
  const st = { income, balance, cashflow };
  const bundle = { financialData: {}, defaultKeyStatistics: {}, price: { currency: "INR" }, summaryDetail: { marketCap: 5e12 } };
  const { ratios } = A.computeRatios(bundle, st);
  return {
    symbol: "SYNTH.NS", name: "Synthetic Industries", exchange: "NSE", currency: "INR", price: 2450, changePct: 0.8,
    profile: { sector: "Industrials", industry: "Diversified", employees: 12000, summary: "A synthetic compounder used to exercise every sheet of the research workbook in tests." },
    keyStats: { beta: 1.1, marketCap: 5e12, high52: 2800, low52: 1900 },
    statements: st, ratios, dupont: A.computeDuPont(st),
    growth: A.computeGrowth(st), variance: A.varianceAnalysis(st),
    ownership: { topInstitutions: [{ name: "LIC of India", pctHeld: 6.2 }, { name: "SBI MF", pctHeld: 3.1 }] },
    dcf: { inputs: { sharesOut: 10e7, netDebt: 100e7 } },
  };
}

const EXPECTED_SHEETS = ["Cover", "Snapshot", "Income Statement", "Balance Sheet", "Cash Flow", "Ratios", "DuPont", "Growth & Variance", "Valuation", "Reverse DCF & Tornado", "Forensic", "Risk", "Peers", "Ownership"];

test("workbook: all 14 sheets assemble from a full synthetic pack", async () => {
  const co = syntheticCo();
  const bundle = { financialData: {}, defaultKeyStatistics: {}, price: { currency: "INR" }, summaryDetail: { marketCap: 5e12 } };
  const forensic = A.forensicScores(bundle, co.statements);
  const risk = A.riskAssessment({ ratios: co.ratios, forensic, dcf: null, growth: co.growth, variance: co.variance, beta: 1.1, price: co.price, sector: "Industrials" });
  const pack = {
    co,
    forensicPack: { forensic, flags: [] },
    riskPack: { risk },
    valuationPack: { valuation: { methods: [{ name: "EV/EBITDA (peer median)", value: 2600, inputs: { multiple: "14.2x" }, note: "peer-anchored" }] } },
    idcfPack: {
      reverse: { currentPrice: 2450, basePerShare: 2610, impliedGrowth: 10.4, impliedGrowthBounded: true, assumedGrowth: 12, impliedWacc: 11.6, impliedWaccBounded: true, assumedWacc: 11.2 },
      tornado: { basePerShare: 2610, bars: [{ key: "growth", label: "Revenue growth (Y1–5)", step: 3, lowPx: 2200, highPx: 3080, swing: 880, swingPct: 33.7 }] },
    },
    bands: { available: true, pe: { current: 24.1, pctile: 71, min: 15.2, p25: 19.1, med: 22.0, p75: 25.3, max: 31.8, series: [] }, pb: null, note: "test band" },
    peers: [{ symbol: "SYNTH.NS", name: "Synthetic", pe: 24, evEbitda: 14, pb: 4, roe: 18, netMargin: 12, revGrowth: 12, de: 0.25, divYield: 1.1, mcap: 5e12 }],
  };
  const wb = await buildResearchWorkbook(pack);
  assert.deepEqual(wb.worksheets.map((w) => w.name), EXPECTED_SHEETS, "sheet set + order");
  const buf = await wb.xlsx.writeBuffer();
  assert.ok(buf.byteLength > 20000, `real xlsx produced (${buf.byteLength} bytes)`);
  // read-back: revenue label present on the Income Statement sheet
  const ExcelJS = require("exceljs");
  const rb = new ExcelJS.Workbook();
  await rb.xlsx.load(buf);
  const inc = rb.getWorksheet("Income Statement");
  let found = false;
  inc.eachRow((row) => row.eachCell((cell) => { if (cell.value === "Revenue") found = true; }));
  assert.ok(found, "Income Statement carries the Revenue line");
});

test("workbook: failure-isolated — every analytics pack null still exports", async () => {
  const co = syntheticCo();
  const wb = await buildResearchWorkbook({ co, forensicPack: null, riskPack: null, valuationPack: null, idcfPack: null, bands: null, peers: null });
  assert.equal(wb.worksheets.length, EXPECTED_SHEETS.length, "all sheets present even with missing packs");
  const buf = await wb.xlsx.writeBuffer();
  assert.ok(buf.byteLength > 10000, "valid xlsx despite null packs");
});
