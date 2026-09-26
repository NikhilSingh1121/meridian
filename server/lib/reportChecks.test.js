/**
 * Report fact-checker — a consistent report passes; each class of
 * contradiction is caught.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { runChecks } = require("./reportChecks");

const Cr = 1e7;
function report() {
  const base = { ev: 67000 * Cr, perShare: 0, equity: 0, terminalShare: 0.7 };
  const netDebt = 153 * Cr, shares = 129.8 * Cr;
  base.equity = base.ev - netDebt; base.perShare = base.equity / shares;
  return {
    meta: { currency: "INR", price: 819, target: 504.64, upside: (504.64 / 819 - 1) * 100, recommendation: "HOLD", targetMethod: "40% DCF + 60% average of relative methods", valuationSource: "Server default" },
    narrative: { moatAssessment: { overall: "Wide" }, ratingBasis: { rule: { buyMin: 5, strongBuyMin: 15, sellCapUpside: 15 } } },
    data: {
      valuation: { blended: 504.64 },
      moat: { overall: "Wide" },
      idcf: { netDebt, sharesOut: shares, target: base.perShare, base, bear: { perShare: base.perShare * 0.8 }, bull: { perShare: base.perShare * 1.3 } },
      statements: {
        balance: [{ year: 2026, totalDebt: 557 * Cr, cash: 404 * Cr }],
        income: [{ year: 2025, revenue: 10733 * Cr, ebitda: 2329 * Cr }, { year: 2026, revenue: 13548 * Cr, ebitda: 2517 * Cr }],
      },
      ratios: [{ name: "EBITDA margin", value: 16.84 }],
      pack: { annualBridge: { to: "FY26" }, quarterly: { quarters: [{ label: "Q1 FY27", qe: "2026-06-30" }] } },
    },
  };
}
const byId = (qa, id) => qa.checks.find((c) => c.id === id);

test("checks · a consistent report passes every check (one explained note)", () => {
  const qa = runChecks(report());
  assert.equal(qa.failed, 0, JSON.stringify(qa.checks.filter((c) => c.status === "fail")));
  assert.equal(qa.total, 11);
  assert.equal(byId(qa, "ebitda_basis").status, "note", "TTM ratio vs FY statement margin is explained, not failed");
  assert.match(byId(qa, "ebitda_basis").detail, /trailing-twelve-month/);
});

test("checks · two different targets → fail", () => {
  const r = report(); r.meta.target = 695.12; r.meta.upside = (695.12 / 819 - 1) * 100;
  assert.equal(byId(runChecks(r), "target").status, "fail");
});

test("checks · net debt that ignores leases → fail (unless adjusted in the Modeling Lab)", () => {
  const r = report(); r.data.idcf.netDebt = -49 * Cr;
  assert.equal(byId(runChecks(r), "net_debt").status, "fail");
  r.meta.valuationSource = "Modeling Lab (user assumptions)";
  assert.equal(byId(runChecks(r), "net_debt").status, "note");
});

test("checks · BUY with a negative expected return → fail", () => {
  const r = report(); r.meta.recommendation = "BUY";
  assert.equal(byId(runChecks(r), "rating").status, "fail");
});

test("checks · two moat verdicts → fail", () => {
  const r = report(); r.data.moat.overall = "Narrow";
  assert.equal(byId(runChecks(r), "moat").status, "fail");
});

test("checks · mislabelled fiscal year and out-of-order scenarios → fail", () => {
  const r = report(); r.data.pack.annualBridge.to = "FY27"; r.data.idcf.bull.perShare = 1;
  const qa = runChecks(r);
  assert.equal(byId(qa, "fiscal").status, "fail");
  assert.equal(byId(qa, "scenarios").status, "fail");
});

test("checks · missing sections are skipped, never thrown on", () => {
  const qa = runChecks({ meta: {}, narrative: {}, data: {} });
  assert.equal(qa.total, 0);
});
