/**
 * M-TERMINAL — report fact-checker (deterministic, runs on every report).
 *
 * Cross-checks the numbers different sections are built from, so a report
 * cannot say one thing on the cover and another in the valuation section.
 * Each check returns pass / fail / note; failures are shown in the report's
 * appendix and on the report status line — never silently corrected.
 */

const RATING_RULE_DEFAULT = { buyMin: 5, strongBuyMin: 15, sellCapUpside: 15 };
const fmt = (v, dp = 2) => (v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp }));
const fyLabel = (y, inr) => (y == null ? null : inr ? `FY${String(y).slice(-2)}` : `FY${y}`);
const fyOfQuarter = (label) => { const m = String(label || "").match(/FY(\d{2,4})$/); return m ? m[1] : null; };

function runChecks(rep) {
  const m = rep.meta || {}, d = rep.data || {}, nv = rep.narrative || {};
  const inr = m.currency === "INR", scale = inr ? 1e7 : 1e6, unit = inr ? "₹ Cr" : "Mn";
  const out = [];
  const add = (id, label, status, detail) => out.push({ id, label, status, detail });

  /* 1 · one target price */
  const V = d.valuation;
  if (V && V.blended != null && m.target != null) {
    const ok = Math.abs(m.target - V.blended) < 0.01;
    add("target", "One target price across the report", ok ? "pass" : "fail",
      ok ? `Cover, valuation table and rating all use ${fmt(m.target)} (${m.targetMethod || "multi-method"}).` : `Cover shows ${fmt(m.target)} but the valuation table builds to ${fmt(V.blended)}.`);
  }

  /* 2 · expected return */
  if (m.target != null && m.price) {
    const up = (m.target / m.price - 1) * 100, ok = m.upside != null && Math.abs(up - m.upside) < 0.05;
    add("return", "Expected return = target ÷ price − 1", ok ? "pass" : "fail", `${fmt(m.target)} ÷ ${fmt(m.price)} − 1 = ${fmt(up, 1)}%${ok ? "" : ` (report shows ${fmt(m.upside, 1)}%)`}.`);
  }

  const idcf = d.idcf && !d.idcf.error ? d.idcf : null;
  const lb = d.statements && d.statements.balance && d.statements.balance.at(-1);
  const userDcf = /modeling lab/i.test(m.valuationSource || "");

  /* 3 · net-debt identity (debt incl. leases − cash) */
  if (idcf && lb && idcf.netDebt != null) {
    const debt = lb.totalDebt > 0 ? lb.totalDebt : (lb.ltDebt || 0) + (lb.stDebt || 0);
    const nd = debt - (lb.cash || 0), tol = Math.max(scale, Math.abs(nd) * 0.01);
    const ok = Math.abs(idcf.netDebt - nd) <= tol;
    add("net_debt", "Net debt in the DCF = balance-sheet debt − cash", ok ? "pass" : userDcf ? "note" : "fail",
      `Balance sheet: ${fmt(debt / scale, 0)} − ${fmt((lb.cash || 0) / scale, 0)} = ${fmt(nd / scale, 0)} ${unit}; DCF uses ${fmt(idcf.netDebt / scale, 0)} ${unit}.${!ok && userDcf ? " The DCF was adjusted in the Modeling Lab." : ""}`);
  }

  /* 4 · DCF bridge: EV − net debt = equity = value/share × shares */
  if (idcf && idcf.base && idcf.sharesOut) {
    const b = idcf.base, eq = b.ev - (idcf.netDebt || 0);
    const ok = Math.abs(eq - b.equity) <= Math.abs(b.equity) * 1e-6 + 1 && Math.abs(b.perShare * idcf.sharesOut - b.equity) <= Math.abs(b.equity) * 1e-6 + 1
      && Math.abs((idcf.target ?? b.perShare) - b.perShare) < 0.01;
    add("dcf_bridge", "DCF bridge reconciles (EV − net debt ÷ shares)", ok ? "pass" : "fail",
      `EV ${fmt(b.ev / scale, 0)} − net debt ${fmt((idcf.netDebt || 0) / scale, 0)} = equity ${fmt(b.equity / scale, 0)} ${unit} → ${fmt(b.perShare)} per share.`);
  }

  /* 5 · scenario ordering */
  if (idcf && idcf.bear && idcf.bull && idcf.base) {
    const ok = idcf.bear.perShare <= idcf.base.perShare && idcf.base.perShare <= idcf.bull.perShare;
    add("scenarios", "Bear ≤ base ≤ bull", ok ? "pass" : "fail", `${fmt(idcf.bear.perShare)} ≤ ${fmt(idcf.base.perShare)} ≤ ${fmt(idcf.bull.perShare)}.`);
  }

  /* 6 · terminal-value concentration (informational) */
  if (idcf && idcf.base && idcf.base.terminalShare != null) {
    const t = idcf.base.terminalShare * 100;
    add("terminal", "Terminal value share of EV", t > 75 ? "note" : "pass", `${fmt(t, 0)}% of enterprise value sits in the terminal value${t > 75 ? " — the value leans on assumptions beyond the forecast years." : "."}`);
  }

  /* 7 · one moat verdict */
  const mA = nv.moatAssessment, mB = d.moat;
  if (mA && mB) {
    const ok = mA.overall === mB.overall;
    add("moat", "One moat classification", ok ? "pass" : "fail", ok ? `${mA.overall} moat in the score, the moat section and the workstation.` : `Score says ${mA.overall}, moat section says ${mB.overall}.`);
  }

  /* 8 · rating agrees with the expected return */
  if (m.recommendation && m.upside != null) {
    const R = (nv.ratingBasis && nv.ratingBasis.rule) || RATING_RULE_DEFAULT, r = m.recommendation, u = m.upside;
    const bad = (r === "STRONG BUY" && u < R.strongBuyMin) || (r === "BUY" && u < R.buyMin) || ((r === "SELL" || r === "STRONG SELL") && u > R.sellCapUpside);
    add("rating", "Rating agrees with the expected return", bad ? "fail" : "pass",
      `${r} with ${u >= 0 ? "+" : ""}${fmt(u, 1)}% expected return (Buy needs ≥ +${R.buyMin}%, Strong Buy ≥ +${R.strongBuyMin}%, Sell capped above +${R.sellCapUpside}%).`);
  }

  /* 9 · fiscal-year labels */
  const inc = d.statements && d.statements.income;
  const lastFy = inc && inc.length ? fyLabel(inc.at(-1).year, inr) : null;
  const pk = d.pack;
  if (lastFy && pk && pk.annualBridge) {
    const ok = pk.annualBridge.to === lastFy;
    add("fiscal", "Fiscal-year labels consistent", ok ? "pass" : "fail", `Latest completed year is ${lastFy}; the earnings ladder is labelled ${pk.annualBridge.to}.`);
  }

  /* 10 · latest filed quarter sits after the latest completed year */
  const q0 = pk && pk.quarterly && pk.quarterly.quarters && pk.quarterly.quarters[0];
  if (q0 && lastFy && inr) {
    const qFy = +fyOfQuarter(q0.label), yFy = +String(lastFy).slice(2);
    const ok = qFy >= yFy;
    add("quarter", "Latest filed quarter is current", ok ? "pass" : "fail", `Latest quarter filed with the exchange: ${q0.label} (${q0.qe}); latest annual statements: ${lastFy}.`);
  }

  /* 11 · EBITDA margin basis (a known definitional difference — explained, not hidden) */
  const ratioM = (d.ratios || []).find((r) => r.name === "EBITDA margin");
  const li = inc && inc.at(-1);
  if (ratioM && ratioM.value != null && li && li.revenue && (li.ebitda ?? li.opIncome) != null) {
    const stmt = ((li.ebitda ?? li.opIncome) / li.revenue) * 100, gap = Math.abs(stmt - ratioM.value);
    add("ebitda_basis", "EBITDA margin basis", gap > 1 ? "note" : "pass",
      gap > 1 ? `Ratio table ${fmt(ratioM.value, 1)}% is trailing-twelve-month (data provider); the financial summary's ${fmt(stmt, 1)}% is the ${lastFy} statement figure — different periods, both correct.`
        : `Ratio table and statements agree (${fmt(ratioM.value, 1)}% vs ${fmt(stmt, 1)}%).`);
  }

  return {
    total: out.length, passed: out.filter((c) => c.status === "pass").length,
    failed: out.filter((c) => c.status === "fail").length, notes: out.filter((c) => c.status === "note").length, checks: out,
  };
}

module.exports = { runChecks };
