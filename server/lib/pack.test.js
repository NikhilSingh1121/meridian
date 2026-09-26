/**
 * Company Research Pack — XBRL parsing and the deterministic bridges.
 * Offline: a synthetic Ind AS results filing in the NSE integrated format.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseResultsXbrl, fiscalQuarter } = require("./xbrl");
const { quarterBridge, annualBridge, shareholdingView, calendarView } = require("./companyPack");

const ctx = (id, s, e, dim) => `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="x">X</xbrli:identifier>${dim ? `<xbrli:segment><xbrldi:explicitMember dimension="in-capmkt:${dim[0]}">in-capmkt:${dim[1]}</xbrldi:explicitMember></xbrli:segment>` : ""}</xbrli:entity><xbrli:period><xbrli:startDate>${s}</xbrli:startDate><xbrli:endDate>${e}</xbrli:endDate></xbrli:period></xbrli:context>`;
const f = (tag, c, v) => `<in-capmkt:${tag} contextRef="${c}" unitRef="INR" decimals="-5">${v}</in-capmkt:${tag}>`;
function filing({ rev, mat, pur, inv, emp, fin, da, oth, other, pbt, tax, pat, eps, ap, segs }) {
  const exp = mat + pur + inv + emp + fin + da + oth;
  return `<xbrli:xbrl>
    ${ctx("Q", "2026-04-01", "2026-06-30")}${ctx("Y", "2025-04-01", "2026-06-30")}
    ${ctx("E1", "2026-04-01", "2026-06-30", ["DetailsOfOtherExpensesAxis", "OtherExpenses1Member"])}
    ${ctx("E2", "2026-04-01", "2026-06-30", ["DetailsOfOtherExpensesAxis", "OtherExpenses2Member"])}
    ${segs.map((s, i) => ctx(`R${i + 1}`, "2026-04-01", "2026-06-30", ["ReportableSegmentsAxis", `ReportableSegments${i + 1}Member`]) + ctx(`P${i + 1}`, "2026-04-01", "2026-06-30", ["ReportableSegmentsFinanceCostsAxis", `ReportableSegments${i + 1}Member`])).join("")}
    ${f("RevenueFromOperations", "Q", rev)}${f("RevenueFromOperations", "Y", rev * 5)}${f("OtherIncome", "Q", other)}
    ${f("CostOfMaterialsConsumed", "Q", mat)}${f("PurchasesOfStockInTrade", "Q", pur)}${f("ChangesInInventoriesOfFinishedGoodsWorkInProgressAndStockInTrade", "Q", inv)}
    ${f("EmployeeBenefitExpense", "Q", emp)}${f("FinanceCosts", "Q", fin)}${f("DepreciationDepletionAndAmortisationExpense", "Q", da)}
    ${f("OtherExpenses", "Q", oth)}${f("Expenses", "Q", exp)}${f("ProfitBeforeTax", "Q", pbt)}${f("TaxExpense", "Q", tax)}
    ${f("ProfitLossForPeriod", "Q", pat)}${f("BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations", "Q", eps)}
    ${f("DescriptionOfOtherExpenses", "E1", "Advertisement and sales promotion")}${f("OtherExpenses", "E1", ap)}
    ${f("DescriptionOfOtherExpenses", "E2", "Others")}${f("OtherExpenses", "E2", oth - ap)}
    ${segs.map((s, i) => f("DescriptionOfReportableSegment", `R${i + 1}`, s.name) + f("SegmentRevenue", `R${i + 1}`, s.rev) + f("DescriptionOfReportableSegment", `P${i + 1}`, s.name) + f("SegmentProfitLossBeforeTaxAndFinanceCosts", `P${i + 1}`, s.ebit)).join("")}
  </xbrli:xbrl>`;
}
const Q1 = { rev: 39570, mat: 17510, pur: 4880, inv: -1270, emp: 2690, fin: 210, da: 560, oth: 7570, other: 480, pbt: 7900, tax: 1380, pat: 6520, eps: 4.86, ap: 3270,
  segs: [{ name: "India", rev: 30030, ebit: 5800 }, { name: "International", rev: 9540, ebit: 2570 }] };

test("xbrl · reads the quarter, not the year-to-date period", () => {
  const p = parseResultsXbrl(filing(Q1), { qe: "2026-06-30" });
  assert.equal(p.period.start, "2026-04-01");
  assert.equal(p.pl.revenue, 39570, "quarter revenue, not the longer period's");
  assert.equal(p.pl.pat, 6520);
  assert.equal(p.pl.eps, 4.86);
});

test("xbrl · gross profit, EBITDA and margins derived from the filed lines", () => {
  const p = parseResultsXbrl(filing(Q1), { qe: "2026-06-30" });
  assert.equal(p.derived.cogs, 17510 + 4880 - 1270);
  assert.equal(p.derived.grossProfit, 39570 - 21120);
  // EBITDA = revenue − (total expenses − finance − D&A); total expenses = 32,150
  assert.equal(p.pl.totalExpenses, 32150);
  assert.equal(p.derived.ebitda, 39570 - (32150 - 210 - 560));
  assert.ok(Math.abs(p.derived.ebitdaMargin - (8190 / 39570) * 100) < 1e-9);
});

test("xbrl · expense breakdown and segments paired by member", () => {
  const p = parseResultsXbrl(filing(Q1), { qe: "2026-06-30" });
  assert.deepEqual(p.expenses.map((e) => e.label), ["Advertisement and sales promotion", "Others"]);
  assert.equal(p.expenses[0].value, 3270);
  assert.deepEqual(p.segments.map((s) => [s.name, s.revenue, s.ebit]), [["India", 30030, 5800], ["International", 9540, 2570]]);
});

test("xbrl · garbage in → null, never a throw", () => {
  assert.equal(parseResultsXbrl("<html>not xbrl</html>"), null);
  assert.equal(parseResultsXbrl(null), null);
});

test("fiscal quarter labels follow the Indian April–March year", () => {
  assert.equal(fiscalQuarter("2026-06-30"), "Q1 FY27");
  assert.equal(fiscalQuarter("2026-03-31"), "Q4 FY26");
  assert.equal(fiscalQuarter("2025-12-31"), "Q3 FY26");
});

test("quarter bridge · steps sum exactly from last year's EBITDA to this year's", () => {
  const mk = (label, rev, gm, ebitda, ap, emp) => ({ label, pl: { revenue: rev, employee: emp }, derived: { grossMargin: gm, ebitda }, expenses: [{ label: "Advertisement and sales promotion", value: ap }] });
  const b = quarterBridge(mk("Q1 FY27", 3957, 46.6, 819, 327, 269), mk("Q1 FY26", 3259, 46.9, 655, 299, 220));
  const deltas = b.steps.filter((s) => s.kind === "delta").reduce((a, s) => a + s.value, 0);
  assert.ok(Math.abs(655 + deltas - 819) < 1e-9);
  assert.equal(b.steps.find((s) => s.label === "Advertising & promotion").value, -28);
});

test("annual bridge · ladder, divergence flag and conversion", () => {
  const st = {
    income: [{ year: 2025, revenue: 10733, grossProfit: 5045, ebitda: 2329, netIncome: 1629 }, { year: 2026, revenue: 13548, grossProfit: 5604, ebitda: 2517, netIncome: 1762 }],
    cashflow: [{ year: 2025, ocf: 1363, fcf: 1202 }, { year: 2026, ocf: 2084, fcf: 1765 }],
  };
  const b = annualBridge(st);
  assert.equal(b.from, "FY25"); assert.equal(b.to, "FY26");
  assert.ok(Math.abs(b.ladder[0].growth - 26.23) < 0.01);
  assert.equal(b.flags.length, 1, "gross profit lags revenue by > 10 points");
  assert.match(b.flags[0], /^Gross profit grew 11\.1% against 26\.2% for revenue/);
  const sum = b.steps.filter((s) => s.kind === "delta").reduce((a, s) => a + s.value, 0);
  assert.ok(Math.abs(2329 + sum - 2517) < 1e-6, "EBITDA bridge reconciles");
  assert.ok(Math.abs(b.conversion.ocfToNetProfit - (2084 / 1762) * 100) < 1e-9);
});

test("shareholding view · QoQ and YoY promoter change, pledge passthrough", () => {
  const rows = [58.91, 58.93, 58.93, 58.95, 59.03].map((v, i) => ({ date: ["2026-06-30", "2026-03-31", "2025-12-31", "2025-09-30", "2025-06-30"][i], promoter: v, public: 100 - v }));
  const v = shareholdingView(rows, { pledgedPctOfPromoter: 2.02 });
  assert.ok(Math.abs(v.change.qoq - -0.02) < 1e-9);
  assert.ok(Math.abs(v.change.yoy - -0.12) < 1e-9);
  assert.equal(v.pledge.pledgedPctOfPromoter, 2.02);
  assert.equal(shareholdingView([], null), null);
});

test("calendar view · upcoming events sorted soonest first", () => {
  const future = (d) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
  const v = calendarView([{ date: future(30), purpose: "Financial Results" }, { date: future(5), purpose: "Fund Raising" }, { date: "2020-01-01", purpose: "Financial Results" }], []);
  assert.deepEqual(v.upcoming.map((e) => e.purpose), ["Fund Raising", "Financial Results"]);
  assert.equal(v.lastResults.date, "2020-01-01");
});
