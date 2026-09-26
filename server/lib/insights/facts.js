/**
 * M-TERMINAL — research layer · deterministic fact sheet.
 *
 * buildFacts() is a READ-ONLY projection of the deterministic report the
 * /api/report route already produced: it selects fields, rescales currency to
 * the units the report displays (₹ Cr / Mn) and rounds for compactness. It does
 * not recompute ratios, growth, valuation, scores or the recommendation — the
 * only arithmetic is unit scaling and the same year-on-year / margin division
 * the report's own Financial Summary table shows, so the model can reference
 * those printed figures.
 */

const r1 = (v) => (v == null || !isFinite(v) ? null : Math.round(v * 10) / 10);
const r2 = (v) => (v == null || !isFinite(v) ? null : Math.round(v * 100) / 100);

/* The report page rates moat sources with fixed thresholds (renderReport,
   "6 · Economic Moat Analysis"). This mirrors those exact rules so the
   narrative can explain the rating the reader sees — and so the validator
   can reject any sentence that asserts a different overall rating. */
function moatScorecard(ratios) {
  const get = (n) => { const r = (ratios || []).find((x) => x.name === n); return r && r.value != null ? r.value : null; };
  const roce = get("ROCE"), nm = get("Net margin"), de = get("Debt / Equity");
  const rows = [
    ["Returns on capital", roce == null ? null : roce > 15 ? "Wide" : roce > 8 ? "Narrow" : "None"],
    ["Margin durability", nm == null ? null : nm > 15 ? "Wide" : nm > 5 ? "Narrow" : "None"],
    ["Balance-sheet resilience", de == null ? null : de < 0.5 ? "Wide" : de < 1.5 ? "Narrow" : "None"],
    ["Profitability vs peers", "Narrow"],
  ];
  const wide = rows.filter((r) => r[1] === "Wide").length;
  return { sources: Object.fromEntries(rows), overall: wide >= 3 ? "Wide" : wide >= 1 ? "Narrow" : "None" };
}

/* the latest quarter exactly as filed with the exchange (XBRL), in report units */
function latestQuarter(pack, S) {
  const q = pack && pack.quarterly && pack.quarterly.quarters && pack.quarterly.quarters[0];
  if (!q) return null;
  const ap = (q.expenses || []).find((e) => /advertis|promotion/i.test(e.label));
  return {
    period: q.label, scope: pack.quarterly.scope, source: "results filed with the exchange (XBRL) — authoritative",
    revenue: S(q.pl.revenue), revenue_yoy_pct: r1(q.yoy && q.yoy.revenue), revenue_qoq_pct: r1(q.qoq && q.qoq.revenue),
    gross_margin_pct: r1(q.derived.grossMargin), gross_margin_yoy_bps: q.yoy && q.yoy.grossMarginBps != null ? Math.round(q.yoy.grossMarginBps) : null,
    ebitda: S(q.derived.ebitda), ebitda_yoy_pct: r1(q.yoy && q.yoy.ebitda), ebitda_margin_pct: r1(q.derived.ebitdaMargin),
    net_profit: S(q.pl.pat), net_profit_yoy_pct: r1(q.yoy && q.yoy.pat), eps: r2(q.pl.eps),
    advertising: ap ? S(ap.value) : null,
    segments: (q.segments || []).map((s) => ({ name: s.name, revenue: S(s.revenue), revenue_yoy_pct: r1(s.revenueYoy), ebit: S(s.ebit), ebit_margin_pct: r1(s.margin) })),
    compared_with: q.yoy ? q.yoy.against : null,
  };
}

function buildFacts(rep) {
  const m = rep.meta || {}, nv = rep.narrative || {}, d = rep.data || {};
  const isINR = m.currency === "INR";
  const scale = isINR ? 1e7 : 1e6, unit = isINR ? "₹ Cr" : `${m.currency || ""} Mn`;
  const S = (v) => r1(v == null ? null : v / scale);
  const st = d.statements || { income: [], balance: [], cashflow: [] };
  const byYear = (rows) => Object.fromEntries((rows || []).map((r) => [r.year, r]));
  const bal = byYear(st.balance), cf = byYear(st.cashflow);
  const inc = st.income || [];

  // fiscal-year labels exactly as the report prints them (Indian FY ends in March:
  // the year ending 2026 is FY26) — the writer may use only these labels
  const fyLabel = (y) => (y == null ? null : isINR ? `FY${String(y).slice(-2)}` : `FY${y}`);
  const years = inc.map((r, i) => {
    const prev = inc[i - 1], ebitda = r.ebitda ?? r.opIncome;
    const pct = (a, b) => (a != null && b ? r1((a / b - 1) * 100) : null);
    const b = bal[r.year] || {}, c = cf[r.year] || {};
    return {
      fy: r.year, fy_label: fyLabel(r.year),
      revenue: S(r.revenue), gross_profit: S(r.grossProfit), ebitda: S(ebitda), net_income: S(r.netIncome),
      revenue_yoy_pct: prev ? pct(r.revenue, prev.revenue) : null,
      ebitda_yoy_pct: prev ? pct(ebitda, prev.ebitda ?? prev.opIncome) : null,
      net_income_yoy_pct: prev ? pct(r.netIncome, prev.netIncome) : null,
      gross_margin_pct: r.revenue ? r1((r.grossProfit / r.revenue) * 100) : null,
      ebitda_margin_pct: r.revenue && ebitda != null ? r1((ebitda / r.revenue) * 100) : null,
      net_margin_pct: r.revenue ? r1((r.netIncome / r.revenue) * 100) : null,
      operating_cash_flow: S(c.ocf), capex: S(c.capex), free_cash_flow: S(c.fcf), acquisitions: S(c.acquisitions),
      dividends_paid: S(c.dividends), working_capital_change: S(c.wcChange),
      total_debt: S(b.totalDebt), cash: S(b.cash), equity: S(b.equity), inventory: S(b.inventory), receivables: S(b.receivables),
      diluted_eps: r2(r.dilutedEPS),
    };
  });

  const idcf = d.idcf && !d.idcf.error ? d.idcf : null;
  const valuation = idcf ? {
    method: "5-year explicit FCFF DCF, perpetual-growth terminal value",
    assumptions: {
      revenue_growth_y1_5_pct: r2(idcf.assumptions.growthY1_5), growth_fade_pct: r2(idcf.assumptions.fade),
      ebitda_margin_pct: r2(idcf.assumptions.ebitdaMargin), capex_pct_revenue: r2(idcf.assumptions.capexPctRev),
      tax_rate_pct: r2(idcf.assumptions.taxRate), wc_pct_revenue: r2(idcf.assumptions.wcPctRev),
      wacc_pct: r2(idcf.assumptions.wacc), terminal_growth_pct: r2(idcf.assumptions.terminalG),
    },
    wacc_build: idcf.waccBuild ? Object.fromEntries(Object.entries(idcf.waccBuild).map(([k, v]) => [k, r2(v)])) : null,
    forecast: (idcf.base.rows || []).map((x) => ({ fy: x.year, revenue: S(x.rev), growth_pct: r1(x.growth), ebitda: S(x.ebitda), ebitda_margin_pct: r1(x.margin), fcff: S(x.fcff) })),
    enterprise_value: S(idcf.base.ev), pv_explicit_fcff: S(idcf.base.pvExplicit), pv_terminal_value: S(idcf.base.tvPv),
    terminal_value_share_of_ev_pct: r1(idcf.base.terminalShare * 100),
    dcf_value_per_share: r2(idcf.base.perShare), bull_value_per_share: r2(idcf.bull && idcf.bull.perShare), bear_value_per_share: r2(idcf.bear && idcf.bear.perShare),
    sensitivity_value_range: (() => { const v = (idcf.sens || []).flatMap((s) => s.values || []).filter((x) => x != null); return v.length ? { min: r2(Math.min(...v)), max: r2(Math.max(...v)) } : null; })(),
    net_debt: S(idcf.netDebt),
  } : null;

  const fr = d.forensic;
  return {
    units: `Currency amounts are in ${unit}. Percentages are percent values. Ratios are as computed by the platform.`,
    company: {
      name: m.name, symbol: m.symbol, exchange: m.exchange, sector: m.sector, industry: m.industry,
      report_type: m.type, report_date: m.date, price: r2(m.price), currency: m.currency,
      employees: d.profile && d.profile.employees, description: d.profile && (d.profile.summary || "").slice(0, 900),
    },
    official_conclusion_do_not_change: {
      recommendation: m.recommendation, target_price: r2(m.target), upside_pct: r1(m.upside),
      dcf_value: r2(m.dcfTarget), dcf_upside_pct: r1(m.dcfUpside),
      target_method: m.targetMethod || null,
      rating_basis: nv.ratingBasis ? { composite_rating: nv.ratingBasis.compositeRating, final_rating: nv.ratingBasis.rating, adjusted_for_expected_return: nv.ratingBasis.adjusted, explanation: nv.ratingBasis.note || null, rule: "Buy requires ≥ +5% expected return to the target, Strong Buy ≥ +15%; a Sell becomes Hold above +15%" } : null,
      composite_score: nv.compositeScore, blended_upside_pct: r1(nv.blendedUpside),
      factor_breakdown: (nv.factorBreakdown || []).map((f) => ({ factor: f.name, weight_pct: f.weight, score: f.score, evidence: f.evidence })),
      street: d.street ? { consensus_target: r2(d.street.targetMean), consensus_rating: d.street.rec, analysts: d.street.analysts } : null,
    },
    fiscal_calendar: years.length ? {
      latest_completed_fy: years[years.length - 1].fy_label,
      current_fy_in_progress: fyLabel(years[years.length - 1].fy + 1),
      rule: "Annual figures in FACTS belong to latest_completed_fy or earlier; quarterly periods (e.g. Q1 of the current year) only as labelled in EVIDENCE.",
    } : null,
    financials_by_year: years,
    latest_quarter: latestQuarter(d.pack, S),
    consensus: d.consensus ? {
      eps_surprise_history: (d.consensus.history || []).map((h) => ({ quarter_ended: String(h.date || "").slice(0, 10), eps_estimate: r2(h.epsActual != null ? h.epsEstimate : null), eps_actual: r2(h.epsActual), surprise_pct: r1(h.surprisePct) })),
      beat_record: d.consensus.stats ? `${d.consensus.stats.beats}/${d.consensus.stats.quarters}` : null,
      forward: (d.consensus.forward || []).map((x) => ({ period: x.label, eps: r2(x.epsAvg), eps_growth_pct: r1(x.growthPct), revenue: x.revenueAvg != null ? S(x.revenueAvg) : null, analysts: x.numAnalysts })),
      source: "sell-side consensus (data provider) — context only, never the house view",
    } : null,
    annual_ladder: d.pack && d.pack.annualBridge ? { from: d.pack.annualBridge.from, to: d.pack.annualBridge.to, growth_pct: Object.fromEntries(d.pack.annualBridge.ladder.map((x) => [x.label, r1(x.growth)])), divergences: d.pack.annualBridge.flags } : null,
    promoter_holding: d.pack && d.pack.shareholding ? { latest_pct: r2(d.pack.shareholding.quarters[0].promoter), change_qoq_pp: r2(d.pack.shareholding.change.qoq), change_yoy_pp: r2(d.pack.shareholding.change.yoy), pledged_pct_of_promoter: d.pack.shareholding.pledge && !d.pack.shareholding.pledge.none ? r2(d.pack.shareholding.pledge.pledgedPctOfPromoter) : 0 } : null,
    growth: d.growth ? Object.fromEntries(Object.entries(d.growth).map(([k, v]) => [k, r1(v)])) : null,
    latest_year_variance: d.variance ? { commentary: d.variance.commentary, drivers: (d.variance.drivers || []).map((x) => ({ label: x.label, value: r1(x.value), unit: x.unit })) } : null,
    ratios: (d.ratios || []).map((x) => ({ name: x.name, value: r2(x.value), note: x.note })),
    moat_scorecard: nv.moatAssessment
      ? { overall: nv.moatAssessment.overall, sources: Object.fromEntries(nv.moatAssessment.sources.map((x) => [x.name, x.rating])), rule: nv.moatAssessment.rule }
      : moatScorecard(d.ratios),
    forensic: fr ? {
      piotroski: { score: fr.piotroski.score, max: fr.piotroski.max, grade: fr.piotroski.grade },
      altman_z: { score: r2(fr.altman.score), zone: fr.altman.zone },
      beneish_m: { score: r2(fr.beneish.score), flag: fr.beneish.flag, threshold: fr.beneish.threshold },
      cash_quality: { cash_conversion_x: r2(fr.cash.cashConversion), fcf_margin_pct: r1(fr.cash.fcfMargin), accrual_ratio_pct: r1(fr.cash.accrualRatio) },
      earnings_quality_grade: fr.earningsQualityGrade,
    } : null,
    peers: (d.peers || []).map((p, i) => ({
      name: p.name, is_subject: i === 0, market_cap: S(p.mcap), pe: r1(p.pe), ev_ebitda: r1(p.evEbitda), pb: r1(p.pb),
      roe_pct: r1(p.roe), net_margin_pct: r1(p.netMargin), revenue_growth_pct: r1(p.revGrowth), debt_equity: r2(p.de),
    })),
    valuation,
    ownership: d.holders ? { insider_pct: r1(d.holders.insiders), institutional_pct: r1(d.holders.institutions) } : null,
    key_stats: d.keyStats ? { market_cap: S(d.keyStats.mcap), enterprise_value: S(d.keyStats.ev), high_52w: r2(d.keyStats.high52), low_52w: r2(d.keyStats.low52), beta: r2(d.keyStats.beta) } : null,
    existing_report_text_do_not_repeat: {
      executive_summary: (nv.execSummary || "").slice(0, 900),
      thesis: (nv.thesis || "").slice(0, 700),
      catalysts: nv.catalysts || [], risks: nv.risks || [],
    },
  };
}

/* Earnings track record (deterministic, from the market-data provider) —
   gives the model "what changed recently" without external claims. */
function buildEarnings(es) {
  if (!es || !es.available) return null;
  return {
    next_report_date: es.next && es.next.date ? es.next.date.slice(0, 10) : null,
    recent_quarters: (es.history || []).slice(-4).map((h) => ({ quarter_end: h.date && h.date.slice(0, 10), eps_actual: r2(h.epsActual), eps_estimate: r2(h.epsEstimate), surprise_pct: r1(h.surprisePct) })),
    beat_rate_pct: es.stats ? r1(es.stats.hitRate) : null,
  };
}

module.exports = { buildFacts, buildEarnings, moatScorecard };
