/**
 * MERIDIAN — deterministic-engine test suite.
 * Run: npm test  (node --test, zero dependencies)
 *
 * The analytics engine is pure functions, so it is directly testable with
 * synthetic inputs — no network, no Yahoo. These tests pin the mathematical
 * contracts that the terminal, the report engine and the Excel export all
 * rely on:
 *   · DuPont identity + exact log-attribution
 *   · institutionalDCF monotonicity (↑growth ⇒ ↑value, ↑WACC ⇒ ↓value)
 *   · reverse-DCF round trip (solver recovers the growth that priced it)
 *   · tornado ordering + WACC bar bracketing the base value
 *   · simple-DCF sanity
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("./analytics");

/* ── synthetic company: steady compounder, INR-style magnitudes ─────────── */
function syntheticStatements() {
  const years = [2021, 2022, 2023, 2024, 2025];
  const income = [], balance = [], cashflow = [];
  let rev = 800e7; // ₹800 Cr in raw units
  for (const year of years) {
    rev = rev * 1.12;
    const ebitda = rev * 0.24;
    const dep = rev * 0.04;
    const opIncome = ebitda - dep;
    const interest = rev * 0.01;
    const pretax = opIncome - interest;
    const tax = pretax * 0.25;
    const netIncome = pretax - tax;
    income.push({ year, revenue: rev, grossProfit: rev * 0.42, ebitda, opIncome, ebit: opIncome, interest, pretax, tax, netIncome, basicEPS: netIncome / 10e7 });
    balance.push({ year, assets: rev * 1.5, equity: rev * 0.8, currentAssets: rev * 0.5, currentLiab: rev * 0.3, stDebt: rev * 0.05, ltDebt: rev * 0.15, cash: rev * 0.1, totalDebt: rev * 0.2 });
    const capex = rev * 0.05;
    cashflow.push({ year, cfo: netIncome + dep, dep, capex, fcf: netIncome + dep - capex });
  }
  return { income, balance, cashflow };
}

function syntheticInputs() {
  const st = syntheticStatements();
  const li = st.income.at(-1);
  const bundle = {
    financialData: { ebitdaMargins: 0.24 },
    defaultKeyStatistics: {},
    price: {},
  };
  const dcfIn = {
    baseFcf: st.cashflow.at(-1).fcf,
    sharesOut: 10e7,                       // 10 Cr shares
    netDebt: st.balance.at(-1).totalDebt - st.balance.at(-1).cash,
    growthY1_5: 12,
    fade: 1.5,
    terminalG: 4,
    wacc: 11,                              // engine recomputes proper WACC from CAPM
    currentPrice: 250,
    rationale: { rf: 7, beta: 1.0, erp: 5.5 },
  };
  const growth = A.computeGrowth(st);
  return { bundle, st, dcfIn, growth };
}

/* ═══════════════ DuPont ═══════════════ */
test("DuPont: 3-stage identity reproduces ROE from components", () => {
  const st = syntheticStatements();
  const d = A.computeDuPont(st);
  assert.ok(d && d.rows.length === 5, "one DuPont row per fiscal year");
  for (const r of d.rows) {
    const rebuilt = (r.netMargin / 100) * r.turnover * r.leverage * 100;
    assert.ok(Math.abs(rebuilt - r.roe) < 1e-9, `identity holds for FY${r.year}`);
  }
});

test("DuPont: log-attribution components sum exactly to the ROE change", () => {
  const st = syntheticStatements();
  // introduce a real driver mix: margin up, leverage down in the last year
  const last = st.income.at(-1);
  last.netIncome = last.netIncome * 1.10;
  st.balance.at(-1).equity = st.balance.at(-1).equity * 1.06;
  const d = A.computeDuPont(st);
  const a = d.attribution;
  assert.ok(a, "attribution computed for latest YoY");
  const sum = a.marginPp + a.turnoverPp + a.leveragePp;
  assert.ok(Math.abs(sum - a.roeDeltaPp) < 0.02, `parts (${sum.toFixed(2)}) ≈ total (${a.roeDeltaPp})`);
});

/* ═══════════════ institutionalDCF contracts ═══════════════ */
test("IDCF: produces a finite per-share value on the synthetic set", () => {
  const { bundle, st, dcfIn, growth } = syntheticInputs();
  const r = A.institutionalDCF(bundle, st, dcfIn, growth, {});
  assert.ok(r && !r.error, "model builds");
  assert.ok(Number.isFinite(r.base.perShare) && r.base.perShare > 0, "per-share value is a positive finite number");
  assert.ok(r.base.terminalShare > 0 && r.base.terminalShare < 1, "terminal share within (0,1)");
});

test("IDCF: value is monotonically increasing in first-stage growth", () => {
  const { bundle, st, dcfIn, growth } = syntheticInputs();
  const px = (g) => A.institutionalDCF(bundle, st, { ...dcfIn, growthY1_5: g }, growth, {}).base.perShare;
  assert.ok(px(6) < px(12) && px(12) < px(20), "6% < 12% < 20% growth ⇒ rising value");
});

test("IDCF: value is monotonically decreasing in WACC (via waccOverridePct)", () => {
  const { bundle, st, dcfIn, growth } = syntheticInputs();
  const px = (w) => A.institutionalDCF(bundle, st, dcfIn, growth, { waccOverridePct: w }).base.perShare;
  assert.ok(px(9) > px(11) && px(11) > px(14), "9% > 11% > 14% WACC ⇒ falling value");
});

/* ═══════════════ Reverse DCF ═══════════════ */
test("Reverse DCF: recovers the growth that produced the price (round trip)", () => {
  const { bundle, st, dcfIn, growth } = syntheticInputs();
  const base = A.institutionalDCF(bundle, st, dcfIn, growth, {});
  const priceAtBase = base.base.perShare;
  const rev = A.reverseDCF(bundle, st, dcfIn, growth, {}, priceAtBase);
  assert.ok(rev && rev.impliedGrowthBounded, "solver converged inside bounds");
  assert.ok(Math.abs(rev.impliedGrowth - dcfIn.growthY1_5) < 0.05,
    `implied growth ${rev.impliedGrowth}% ≈ assumed ${dcfIn.growthY1_5}%`);
});

test("Reverse DCF: implied WACC round trip at the base price", () => {
  const { bundle, st, dcfIn, growth } = syntheticInputs();
  const base = A.institutionalDCF(bundle, st, dcfIn, growth, {});
  const effectiveWacc = base.assumptions.wacc; // proper WACC the engine actually used
  const rev = A.reverseDCF(bundle, st, dcfIn, growth, {}, base.base.perShare);
  assert.ok(rev.impliedWaccBounded, "WACC solver converged");
  assert.ok(Math.abs(rev.impliedWacc - effectiveWacc) < 0.05,
    `implied WACC ${rev.impliedWacc}% ≈ effective ${effectiveWacc}%`);
});

test("Reverse DCF: cheap price ⇒ implied growth below assumed; rich ⇒ above", () => {
  const { bundle, st, dcfIn, growth } = syntheticInputs();
  const base = A.institutionalDCF(bundle, st, dcfIn, growth, {});
  const p0 = base.base.perShare;
  const cheap = A.reverseDCF(bundle, st, dcfIn, growth, {}, p0 * 0.6);
  const rich = A.reverseDCF(bundle, st, dcfIn, growth, {}, p0 * 1.6);
  assert.ok(cheap.impliedGrowth < dcfIn.growthY1_5, "60% of value ⇒ market pricing LESS growth");
  assert.ok(rich.impliedGrowth > dcfIn.growthY1_5, "160% of value ⇒ market pricing MORE growth");
});

/* ═══════════════ Tornado ═══════════════ */
test("Tornado: bars sorted by swing; WACC bar brackets the base value", () => {
  const { bundle, st, dcfIn, growth } = syntheticInputs();
  const idcf = A.institutionalDCF(bundle, st, dcfIn, growth, {});
  const t = A.tornadoAnalysis(bundle, st, dcfIn, growth, {}, idcf);
  assert.ok(t && t.bars.length >= 5, "at least five drivers flexed");
  for (let i = 1; i < t.bars.length; i++) {
    assert.ok(Math.abs(t.bars[i - 1].swing) >= Math.abs(t.bars[i].swing) - 1e-9, "descending swing order");
  }
  const w = t.bars.find((b) => b.key === "wacc");
  assert.ok(w && w.lowPx < t.basePerShare && w.highPx > t.basePerShare, "±1pp WACC brackets base per-share");
});

test("Tornado: yearwise margin overrides are shifted in parallel", () => {
  const { bundle, st, dcfIn, growth } = syntheticInputs();
  const ov = { yearwise: { ebitdaMargin: [26, 25, 24] } };
  const idcf = A.institutionalDCF(bundle, st, dcfIn, growth, ov);
  const t = A.tornadoAnalysis(bundle, st, dcfIn, growth, ov, idcf);
  const m = t.bars.find((b) => b.key === "margin");
  assert.ok(m && m.lowPx < m.highPx, "margin flex still produces a spread under yearwise edits");
});

/* ═══════════════ terminal-growth sanity ═══════════════ */
test("IDCF: value is monotonically increasing in terminal growth", () => {
  const { bundle, st, dcfIn, growth } = syntheticInputs();
  const px = (g) => A.institutionalDCF(bundle, st, { ...dcfIn, terminalG: g }, growth, {}).base.perShare;
  assert.ok(px(3) < px(4) && px(4) < px(5), "3% < 4% < 5% terminal growth ⇒ rising value");
});

/* ═══════════════ XIRR ═══════════════ */
test("XIRR: single-period 10% gain resolves to ~10%", () => {
  const r = A.xirr([
    { date: "2024-01-01", amount: -100 },
    { date: "2025-01-01", amount: 110 },
  ]);
  assert.ok(Math.abs(r - 10) < 0.15, `xirr ${r}% ≈ 10%`);
});

test("XIRR: multi-flow ledger with interim buy", () => {
  // -100 at t0, -100 at 6m, +231 at 1y → money-weighted ≈ 20.4% annualized
  const r = A.xirr([
    { date: "2024-01-01", amount: -100 },
    { date: "2024-07-01", amount: -100 },
    { date: "2025-01-01", amount: 231 },
  ]);
  assert.ok(r > 15 && r < 30, `xirr ${r}% in a sane band for this ledger`);
  // and NPV at the solved rate must be ~0 (self-consistency)
  const y = (d) => (new Date(d) - new Date("2024-01-01")) / (365.25 * 24 * 3600e3);
  const npv = -100 - 100 / Math.pow(1 + r / 100, y("2024-07-01")) + 231 / Math.pow(1 + r / 100, y("2025-01-01"));
  assert.ok(Math.abs(npv) < 0.05, `NPV at solved rate ≈ 0 (got ${npv.toFixed(4)})`);
});

test("XIRR: degenerate ledgers return null", () => {
  assert.equal(A.xirr([{ date: "2024-01-01", amount: -100 }]), null, "single flow");
  assert.equal(A.xirr([{ date: "2024-01-01", amount: -100 }, { date: "2024-06-01", amount: -50 }]), null, "single-signed");
});

test("XIRR: loss-making ledger solves negative", () => {
  const r = A.xirr([
    { date: "2023-01-01", amount: -100 },
    { date: "2025-01-01", amount: 64 },
  ]);
  assert.ok(r < -15 && r > -30, `two-year 36% loss → ~−20%/yr (got ${r}%)`);
});

/* ═══════════════ Multiple bands ═══════════════ */
test("Bands: constant price over constant EPS gives a flat P/E band", () => {
  const st = syntheticStatements();
  // force EPS to exactly 10/share on 10 Cr shares for every year
  st.income.forEach((r) => { r.netIncome = 10 * 10e7; });
  const monthly = [];
  const t0 = new Date("2021-06-01").getTime();
  for (let i = 0; i < 48; i++) monthly.push({ t: t0 + i * 30.44 * 24 * 3600e3, c: 100 });
  const b = A.computeMultipleBands(monthly, st, 10e7);
  assert.ok(b && b.pe, "P/E band built");
  assert.ok(Math.abs(b.pe.min - 10) < 0.01 && Math.abs(b.pe.max - 10) < 0.01, "flat band at 10×");
  assert.equal(b.pe.current, 10);
});

test("Bands: rising price over flat EPS puts current at the top of the band", () => {
  const st = syntheticStatements();
  st.income.forEach((r) => { r.netIncome = 10 * 10e7; });
  const monthly = [];
  const t0 = new Date("2021-06-01").getTime();
  for (let i = 0; i < 48; i++) monthly.push({ t: t0 + i * 30.44 * 24 * 3600e3, c: 100 + i * 5 });
  const b = A.computeMultipleBands(monthly, st, 10e7);
  assert.ok(b.pe.current > b.pe.p75, "current multiple above the 75th percentile");
  assert.ok(b.pe.pctile >= 95, `percentile ${b.pe.pctile} at the top of the band`);
});

test("Bands: insufficient data returns null instead of throwing", () => {
  const st = syntheticStatements();
  assert.equal(A.computeMultipleBands([{ t: Date.now(), c: 100 }], st, 10e7), null, "too few points");
  assert.equal(A.computeMultipleBands(null, st, 10e7), null, "no series");
});

/* ── composite: earnings quality is its own factor and scores cash backing + beat record ── */
test("ruleNarrative: earnings-quality factor with forensic data and consensus record", () => {
  const base = {
    symbol: "X.NS", name: "X", price: 100, currency: "INR", growth: { revYoy: 10, revCagr: 11 },
    ratiosFlat: { ROCE: 20, ROE: 18, "Net margin": 12, "Debt / Equity": 0.2, "Interest coverage": 20 }, variance: {}, holders: {},
    street: { rec: "buy", targetMean: 120 }, dcf: { perShare: 90, wacc: 11, terminalG: 5, terminalShare: 0.6 }, summary: "", targetPrice: 110,
    forensic: { piotroski: { score: 7 }, altman: { zone: "Safe" }, beneish: { score: -2.5, flag: "Unlikely" }, earningsQualityGrade: "A", cash: { cashConversion: 1.1, accrualRatio: 3 } },
  };
  const good = A.ruleNarrative({ ...base, consensus: { beats: 4, quarters: 4 } });
  const eq = good.factorBreakdown.find((f) => f.name === "Earnings Quality");
  assert.ok(eq, "earnings quality factor present");
  assert.match(eq.evidence, /beat consensus EPS 4\/4/);
  const poor = A.ruleNarrative({ ...base, consensus: { beats: 0, quarters: 4 }, forensic: { ...base.forensic, earningsQualityGrade: "D", cash: { cashConversion: 0.5, accrualRatio: 14 } } });
  assert.ok(poor.factorBreakdown.find((f) => f.name === "Earnings Quality").score < eq.score - 40);
  assert.ok(!/Grade/.test(good.factorBreakdown.find((f) => f.name === "Forensic Health").evidence), "grade is not double-counted in forensic health");
});

test("fiscalYearRows: drops balance-sheet-only half-year rows (NSE issuers like RELIANCE.NS)", () => {
  const { fiscalYearRows } = require("../providers/fundamentals");
  const rows = [
    { date: new Date("2024-03-31"), totalRevenue: 9e12, netIncome: 7e11, totalAssets: 17e12 },
    { date: new Date("2025-03-31"), totalRevenue: 9.6e12, netIncome: 8e11, totalAssets: 19e12 },
    { date: new Date("2025-09-30"), totalAssets: 20e12, stockholdersEquity: 9e12 },
  ];
  const kept = fiscalYearRows(rows);
  assert.equal(kept.length, 2);
  assert.equal(kept.at(-1).totalRevenue, 9.6e12, "latest row carries revenue so the DCF can build");
  const bsOnly = [{ date: new Date("2025-09-30"), totalAssets: 1 }];
  assert.deepEqual(fiscalYearRows(bsOnly), bsOnly, "no income rows at all → unchanged");
});

test("dcfDefaults: share count falls back when Yahoo omits sharesOutstanding", () => {
  const st = { income: [], balance: [], cashflow: [] };
  const implied = A.dcfDefaults({ defaultKeyStatistics: { impliedSharesOutstanding: 1.35e10 }, price: {} }, st, {}, {});
  assert.equal(implied.sharesOut, 1.35e10);
  const fromCap = A.dcfDefaults({ defaultKeyStatistics: {}, price: { marketCap: 2e13, regularMarketPrice: 1000 } }, st, {}, {});
  assert.equal(fromCap.sharesOut, 2e10);
});
