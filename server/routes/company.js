const express = require("express");
const router = express.Router();
const F = require("../providers/fundamentals");
const A = require("../lib/analytics");
const E = require("../lib/earnings");
const { generateNarrative, hasKey } = require("../lib/ai");
const { cached } = require("../cache");

const BUNDLE_TTL = 30 * 60 * 1000;
const MINI_TTL = 6 * 60 * 60 * 1000;

/* Build the complete research pack for one company. */
async function buildCompany(symbol) {
  const bundle = await F.quoteSummary(symbol);
  const st = A.normStatements(bundle);
  const { ratios, series, mcap, ev, debt } = A.computeRatios(bundle, st);
  const growth = A.computeGrowth(st);
  const variance = A.varianceAnalysis(st);
  const dcfIn = A.dcfDefaults(bundle, st, { debt }, growth);
  const dcf = A.runDCF(dcfIn);

  const pr = bundle.price || {}, ap = bundle.assetProfile || {}, hold = bundle.majorHoldersBreakdown || {};
  // Quarterly income trend isn't reliably available post-2024; show annual revenue/NI trend instead.
  const qInc = st.income.map((r) => ({ q: String(r.year), revenue: r.revenue, netIncome: r.netIncome }));

  return {
    symbol,
    name: pr.longName || pr.shortName || symbol,
    price: pr.regularMarketPrice ?? null,
    change: pr.regularMarketChange ?? null,
    changePct: pr.regularMarketChangePercent !== undefined && pr.regularMarketChangePercent !== null ? pr.regularMarketChangePercent * 100 : null,
    currency: pr.currency || "", exchange: pr.exchangeName || "", marketState: pr.marketState || "",
    profile: {
      sector: ap.sector || "", industry: ap.industry || "", employees: ap.fullTimeEmployees ?? null,
      summary: ap.longBusinessSummary || "", website: ap.website || "", city: ap.city || "", country: ap.country || "",
      officers: (ap.companyOfficers || []).slice(0, 6).map((o) => ({ name: o.name, title: o.title, age: o.age ?? null })),
    },
    holders: {
      insiders: hold.insidersPercentHeld !== undefined && hold.insidersPercentHeld !== null ? hold.insidersPercentHeld * 100 : null,
      institutions: hold.institutionsPercentHeld !== undefined && hold.institutionsPercentHeld !== null ? hold.institutionsPercentHeld * 100 : null,
    },
    ownership: (() => {
      const inst = (bundle.institutionOwnership?.ownershipList || []).slice(0, 8).map((o) => ({
        name: o.organization, pct: o.pctHeld != null ? o.pctHeld * 100 : null, shares: o.position ?? null, value: o.value ?? null,
        change: o.pctChange != null ? o.pctChange * 100 : null,
      }));
      const funds = (bundle.fundOwnership?.ownershipList || []).slice(0, 6).map((o) => ({
        name: o.organization, pct: o.pctHeld != null ? o.pctHeld * 100 : null, value: o.value ?? null,
      }));
      const insiderTx = bundle.netSharePurchaseActivity || {};
      const insiders = (bundle.insiderHolders?.holders || []).slice(0, 8).map((h) => ({
        name: h.name, relation: h.relation || "", shares: h.positionDirect?.raw ?? null, latest: h.latestTransDate?.fmt || null, txn: h.transactionDescription || "",
      }));
      return {
        topInstitutions: inst, topFunds: funds, insiders,
        netInsider: { buyShares: insiderTx.buyInfoShares ?? null, sellShares: insiderTx.sellInfoShares ?? null, netShares: insiderTx.netInfoShares ?? null, netPct: insiderTx.netPercentInsiderShares != null ? insiderTx.netPercentInsiderShares * 100 : null, period: insiderTx.period || "6m" },
        instCount: bundle.institutionOwnership?.ownershipList?.length ?? null,
      };
    })(),
    keyStats: { mcap, ev, debt, high52: bundle.summaryDetail?.fiftyTwoWeekHigh ?? null, low52: bundle.summaryDetail?.fiftyTwoWeekLow ?? null, beta: bundle.defaultKeyStatistics?.beta ?? null },
    statements: st, quarterly: qInc,
    ratios, series, growth, variance,
    dcf: { inputs: dcfIn, result: dcf },
    street: {
      targetMean: bundle.financialData?.targetMeanPrice ?? null,
      rec: bundle.financialData?.recommendationKey || null,
      analysts: bundle.financialData?.numberOfAnalystOpinions ?? null,
      trend: (bundle.recommendationTrend?.trend || []).slice(0, 1)[0] || null,
    },
    aiAvailable: hasKey(),
  };
}

router.get("/company/:symbol", async (req, res) => {
  try {
    const data = await cached(`co:${req.params.symbol}`, BUNDLE_TTL, () => buildCompany(req.params.symbol));
    res.json(data);
  } catch (e) {
    res.status(404).json({ error: `Could not build research pack for ${req.params.symbol}`, detail: String(e.message || e).slice(0, 120) });
  }
});

/* Peer comparison: auto-suggest + compute compact metric rows. */
async function peerRow(symbol) {
  const b = await cached(`mini:${symbol}`, MINI_TTL, () => F.miniSummary(symbol));
  const fd = b.financialData || {}, ks = b.defaultKeyStatistics || {}, sd = b.summaryDetail || {}, pr = b.price || {};
  return {
    symbol, name: pr.shortName || symbol, sector: b.assetProfile?.sector || "",
    mcap: sd.marketCap ?? pr.marketCap ?? null, price: pr.regularMarketPrice ?? null, currency: pr.currency || "",
    pe: sd.trailingPE ?? null, evEbitda: ks.enterpriseToEbitda ?? null, pb: ks.priceToBook ?? null,
    roe: fd.returnOnEquity !== undefined && fd.returnOnEquity !== null ? fd.returnOnEquity * 100 : null,
    netMargin: fd.profitMargins !== undefined && fd.profitMargins !== null ? fd.profitMargins * 100 : null,
    revGrowth: fd.revenueGrowth !== undefined && fd.revenueGrowth !== null ? fd.revenueGrowth * 100 : null,
    de: fd.debtToEquity !== undefined && fd.debtToEquity !== null ? fd.debtToEquity / 100 : null,
    divYield: sd.dividendYield !== undefined && sd.dividendYield !== null ? sd.dividendYield * 100 : null,
  };
}

router.get("/peers/:symbol", async (req, res) => {
  try {
    let peers = String(req.query.peers || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!peers.length) peers = await F.peerSuggestions(req.params.symbol);
    const rows = await F.pool([req.params.symbol, ...peers.slice(0, 6)], 3, peerRow);
    res.json({ rows: rows.filter((r) => r && !r.error) });
  } catch (e) {
    res.status(502).json({ error: "Peer analysis unavailable" });
  }
});

/* News + lexicon sentiment + event tagging (labelled as such in UI). */
const POS = ["beat", "beats", "surge", "record", "growth", "upgrade", "profit", "wins", "win", "strong", "rally", "expansion", "raises", "buyback", "approves"];
const NEG = ["miss", "misses", "fall", "falls", "drop", "downgrade", "loss", "probe", "fraud", "weak", "cuts", "decline", "slump", "penalty", "default", "resigns"];
const EVENTS = { results: /result|earnings|q[1-4]|quarter/i, dividend: /dividend|buyback|bonus/i, "M&A": /acqui|merger|stake|takeover/i, mgmt: /ceo|cfo|resign|appoint/i, regulatory: /sebi|rbi|court|penalt|probe/i, order: /order|contract|wins|deal/i };

router.get("/news/:query", async (req, res) => {
  try {
    const items = await cached(`news:${req.params.query}`, 10 * 60 * 1000, () => F.newsFor(req.params.query));
    const scored = items.map((it) => {
      const t = it.title.toLowerCase();
      const s = POS.reduce((a, w) => a + (t.includes(w) ? 1 : 0), 0) - NEG.reduce((a, w) => a + (t.includes(w) ? 1 : 0), 0);
      const tags = Object.entries(EVENTS).filter(([, re]) => re.test(it.title)).map(([k]) => k);
      return { ...it, sentiment: s > 0 ? "positive" : s < 0 ? "negative" : "neutral", tags };
    });
    res.json({ items: scored, method: "keyword-lexicon" });
  } catch { res.status(502).json({ error: "News unavailable" }); }
});

/* Enhanced News Intelligence: scored sentiment, distribution, event tracker.
   mode: company (default) | industry (sector peers) | market */
function scoreHeadline(title) {
  const t = (title || "").toLowerCase();
  let score = 0;
  POS.forEach((w) => { if (t.includes(w)) score += 1; });
  NEG.forEach((w) => { if (t.includes(w)) score -= 1; });
  const tags = Object.entries(EVENTS).filter(([, re]) => re.test(title || "")).map(([k]) => k);
  return { score, sentiment: score > 0 ? "positive" : score < 0 ? "negative" : "neutral", tags };
}
async function newsIntel(query, extraQueries = []) {
  const queries = [query, ...extraQueries];
  const seen = new Set();
  let all = [];
  for (const q of queries) {
    try { const items = await cached(`news:${q}`, 10 * 60 * 1000, () => F.newsFor(q)); for (const it of items) { const k = it.title; if (!seen.has(k)) { seen.add(k); all.push({ ...it, q }); } } } catch { }
  }
  const items = all.map((it) => ({ ...it, ...scoreHeadline(it.title) })).sort((a, b) => (b.time || 0) - (a.time || 0));
  const pos = items.filter((i) => i.sentiment === "positive").length;
  const neg = items.filter((i) => i.sentiment === "negative").length;
  const neu = items.length - pos - neg;
  // sentiment score 0-100 (50 = neutral)
  const net = items.length ? (pos - neg) / items.length : 0;
  const sentimentScore = Math.round(50 + net * 50);
  const tone = sentimentScore >= 62 ? "Positive" : sentimentScore >= 45 ? "Balanced" : "Negative";
  // recency-split trend: compare first half (older) vs second half (newer) by time
  const dated = items.filter((i) => i.time).sort((a, b) => a.time - b.time);
  let trend = "flat";
  if (dated.length >= 4) {
    const mid = Math.floor(dated.length / 2);
    const sc = (arr) => arr.reduce((s, i) => s + i.score, 0) / (arr.length || 1);
    const older = sc(dated.slice(0, mid)), newer = sc(dated.slice(mid));
    trend = newer > older + 0.2 ? "improving" : newer < older - 0.2 ? "deteriorating" : "flat";
  }
  // event tracker — counts per event type
  const eventCounts = {};
  Object.keys(EVENTS).forEach((k) => { eventCounts[k] = items.filter((i) => i.tags.includes(k)).length; });
  const events = Object.entries(eventCounts).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]).map(([type, count]) => ({ type, count }));
  return { items, count: items.length, pos, neg, neu, sentimentScore, tone, trend, events };
}
router.get("/newsintel", async (req, res) => {
  try {
    const q = (req.query.q || "NIFTY").toString();
    const mode = (req.query.mode || "company").toString();
    let extra = [];
    if (mode === "industry") {
      // resolve sector + a couple of peer names for broader industry coverage
      try { const co = await cached(`co:${q}`, BUNDLE_TTL, () => buildCompany(q)); if (co.profile.sector) extra.push(co.profile.sector); if (co.profile.industry) extra.push(co.profile.industry); } catch { }
    } else if (mode === "market") {
      extra = ["stock market", "economy"];
    }
    const data = await newsIntel(q, extra);
    res.json({ query: q, mode, ...data });
  } catch (e) { res.status(502).json({ error: "News intelligence unavailable", detail: String(e.message || e).slice(0, 120) }); }
});

/* Report generation: computed pack + narrative layer → structured report JSON. */
router.post("/report", express.json(), async (req, res) => {
  const { symbol, type = "Initiating Coverage" } = req.body || {};
  if (!symbol) return res.status(400).json({ error: "symbol required" });
  try {
    const co = await cached(`co:${symbol}`, BUNDLE_TTL, () => buildCompany(symbol));
    const bundle = await cached(`bundle:${symbol}`, BUNDLE_TTL, () => F.quoteSummary(symbol));
    const ratiosFlat = Object.fromEntries(co.ratios.map((r) => [r.name, r.value]));

    // full institutional DCF working
    const idcf = A.institutionalDCF(bundle, co.statements, co.dcf.inputs, co.growth);
    // forensic / earnings-quality scores
    const forensic = A.forensicScores(bundle, co.statements);

    // peers (best-effort)
    let peers = [];
    try {
      const peerSyms = await F.peerSuggestions(symbol);
      peers = (await F.pool([symbol, ...peerSyms.slice(0, 5)], 3, async (s) => {
        const b = await cached(`mini:${s}`, MINI_TTL, () => F.miniSummary(s));
        const f = b.financialData || {}, k = b.defaultKeyStatistics || {}, d = b.summaryDetail || {}, p = b.price || {};
        const pc = (v) => (v == null ? null : v * 100);
        return { symbol: s, name: p.shortName || s, mcap: d.marketCap ?? null, pe: d.trailingPE ?? null, evEbitda: k.enterpriseToEbitda ?? null, pb: k.priceToBook ?? null, roe: pc(f.returnOnEquity), netMargin: pc(f.profitMargins), revGrowth: pc(f.revenueGrowth), de: f.debtToEquity != null ? f.debtToEquity / 100 : null };
      })).filter((r) => r && !r.error);
    } catch {}

    const target = idcf && !idcf.error ? idcf.target : (co.dcf.result?.perShare ?? null);
    const upside = target && co.price ? (target / co.price - 1) * 100 : null;

    const pack = {
      symbol, name: co.name, sector: co.profile.sector, industry: co.profile.industry,
      price: co.price, currency: co.currency,
      growth: co.growth, ratiosFlat, variance: co.variance,
      forensic, holders: co.holders, street: co.street,
      // Gross margin for moat scoring (Equity Research uses this exact computation)
      grossMarginPct: (() => {
        const li = co.statements?.income?.at(-1);
        return li && li.grossProfit != null && li.revenue ? (li.grossProfit / li.revenue) * 100 : null;
      })(),
      dcf: idcf && !idcf.error ? { perShare: idcf.target, wacc: idcf.assumptions.wacc, terminalG: idcf.assumptions.terminalG, terminalShare: idcf.base.terminalShare } : null,
      summary: co.profile.summary.slice(0, 900),
    };
    const narrative = await generateNarrative(pack, type);

    // Use the blended target (DCF + street consensus) for the verdict box when available,
    // since the recommendation now uses blended upside, not DCF-only upside.
    const blendedTarget = narrative.blendedUpside != null && co.price
      ? co.price * (1 + narrative.blendedUpside / 100)
      : target;
    const blendedUpsidePct = narrative.blendedUpside != null ? narrative.blendedUpside : upside;

    res.json({
      meta: {
        symbol, name: co.name, type, date: new Date().toISOString().slice(0, 10),
        price: co.price, currency: co.currency, sector: co.profile.sector, industry: co.profile.industry,
        exchange: co.exchange, analyst: "Meridian Research Engine",
        target: blendedTarget,
        upside: blendedUpsidePct,
        dcfTarget: target,
        dcfUpside: upside,
        recommendation: narrative.recommendation,
        mode: narrative.mode,
        unitNote: currencyUnit(co.currency),
      },
      narrative,
      data: {
        growth: co.growth, variance: co.variance, ratios: co.ratios, series: co.series,
        idcf, statements: co.statements, quarterly: co.quarterly, street: co.street,
        holders: co.holders, keyStats: co.keyStats, peers, profile: co.profile, forensic,
      },
    });
  } catch (e) {
    res.status(502).json({ error: "Report generation failed", detail: String(e.message || e).slice(0, 160) });
  }
});

function currencyUnit(ccy) {
  if (ccy === "INR") return "All financial figures are presented in \u20b9 Crore unless otherwise stated.";
  if (ccy === "USD") return "All financial figures are presented in USD Million unless otherwise stated.";
  return `All financial figures are presented in ${ccy || "local currency"} (millions) unless otherwise stated.`;
}

/* Recompute DCF with user assumptions (Models lab). */
router.post("/dcf", express.json(), (req, res) => {
  const r = A.runDCF(req.body || {});
  if (!r) return res.status(400).json({ error: "baseFcf and sharesOut required" });
  res.json(r);
});

/* Full institutional DCF working for the Modeling Lab.
   GET returns defaults; POST applies assumption overrides and recomputes the
   entire 17-section model live. Overrides: growthY1_5, fade, terminalG, wacc,
   ebitdaMargin, capexPctRev, taxRate, depPctRev, wcPctRev, beta, rf, erp. */
async function buildInstitutionalDCF(symbol, overrides = {}) {
  const co = await cached(`co:${symbol}`, BUNDLE_TTL, () => buildCompany(symbol));
  const bundle = await cached(`bundle:${symbol}`, BUNDLE_TTL, () => F.quoteSummary(symbol));
  const dcfIn = { ...co.dcf.inputs };
  // scalar assumption overrides
  ["growthY1_5", "fade", "terminalG", "wacc"].forEach((k) => {
    if (overrides[k] != null && isFinite(+overrides[k])) dcfIn[k] = +overrides[k];
  });
  if (overrides.rationale) dcfIn.rationale = { ...dcfIn.rationale, ...overrides.rationale };
  ["rf", "beta", "erp"].forEach((k) => {
    if (overrides[k] != null && isFinite(+overrides[k])) dcfIn.rationale = { ...dcfIn.rationale, [k]: +overrides[k] };
  });
  const idcf = A.institutionalDCF(bundle, co.statements, dcfIn, co.growth, {
    ebitdaMargin: overrides.ebitdaMargin != null ? +overrides.ebitdaMargin / 100 : undefined,
    capexPctRev: overrides.capexPctRev != null ? +overrides.capexPctRev / 100 : undefined,
    taxRate: overrides.taxRate != null ? +overrides.taxRate / 100 : undefined,
    depPctRev: overrides.depPctRev != null ? +overrides.depPctRev / 100 : undefined,
    wcPctRev: overrides.wcPctRev != null ? +overrides.wcPctRev / 100 : undefined,
  });
  return {
    meta: { symbol, name: co.name, currency: co.currency, exchange: co.exchange, price: co.price, sector: co.profile.sector, unitNote: currencyUnit(co.currency) },
    statements: co.statements, growth: co.growth, idcf,
    assumptionsUsed: { ...dcfIn },
  };
}

router.get("/idcf/:symbol", async (req, res) => {
  try { res.json(await buildInstitutionalDCF(req.params.symbol.toUpperCase())); }
  catch (e) { res.status(502).json({ error: "DCF build failed", detail: String(e.message || e).slice(0, 160) }); }
});
router.post("/idcf/:symbol", express.json(), async (req, res) => {
  try { res.json(await buildInstitutionalDCF(req.params.symbol.toUpperCase(), req.body || {})); }
  catch (e) { res.status(502).json({ error: "DCF build failed", detail: String(e.message || e).slice(0, 160) }); }
});

/* FORENSIC ANALYSIS — full scorecard for the dedicated module. */
async function buildForensic(symbol) {
  const co = await cached(`co:${symbol}`, BUNDLE_TTL, () => buildCompany(symbol));
  const bundle = await cached(`bundle:${symbol}`, BUNDLE_TTL, () => F.quoteSummary(symbol));
  const forensic = A.forensicScores(bundle, co.statements);
  const st = co.statements;
  // working-capital trend (receivable / inventory / payable days proxy by year)
  const wcTrend = st.income.map((row, i) => {
    const b = st.balance[i] || {}, rev = row.revenue;
    const cogs = rev != null && row.grossProfit != null ? rev - row.grossProfit : null;
    return {
      year: row.year,
      recvDays: b.receivables != null && rev ? +(b.receivables / rev * 365).toFixed(0) : null,
      invDays: b.inventory != null && cogs ? +(b.inventory / cogs * 365).toFixed(0) : null,
      ocfToNi: (st.cashflow[i]?.ocf != null && row.netIncome) ? +(st.cashflow[i].ocf / row.netIncome).toFixed(2) : null,
      accrual: (row.netIncome != null && st.cashflow[i]?.ocf != null && b.assets) ? +(((row.netIncome - st.cashflow[i].ocf) / b.assets) * 100).toFixed(1) : null,
    };
  });
  // red-flag detection (deterministic rules)
  const flags = [];
  const f = forensic;
  if (f) {
    if (f.beneish.score != null && f.beneish.score > -1.78) flags.push({ sev: "high", t: "Beneish M-Score above −1.78 — statistically elevated earnings-manipulation risk." });
    if (f.altman.zone === "Distress") flags.push({ sev: "high", t: "Altman Z in the distress zone — heightened bankruptcy risk on this model." });
    else if (f.altman.zone === "Grey") flags.push({ sev: "med", t: "Altman Z in the grey zone — financial resilience is not clearly safe." });
    if (f.cash.cashConversion != null && f.cash.cashConversion < 0.7) flags.push({ sev: "med", t: `Weak cash conversion (${f.cash.cashConversion}× OCF/NI) — earnings run ahead of cash generation.` });
    if (f.cash.accrualRatio != null && Math.abs(f.cash.accrualRatio) > 12) flags.push({ sev: "med", t: `Elevated accrual ratio (${f.cash.accrualRatio}%) — a larger share of earnings is non-cash.` });
    if (f.piotroski.score <= 3) flags.push({ sev: "med", t: `Low Piotroski F-Score (${f.piotroski.score}/9) — weak fundamental momentum across profitability, leverage and efficiency.` });
    // receivable-days expansion
    const r0 = wcTrend.at(-2)?.recvDays, r1 = wcTrend.at(-1)?.recvDays;
    if (r0 && r1 && r1 > r0 * 1.25) flags.push({ sev: "med", t: `Receivable days expanded sharply (${r0}→${r1}d) — possible channel stuffing or collection issues.` });
    if (!flags.length) flags.push({ sev: "low", t: "No material red flags detected across the forensic screens." });
  }
  return { meta: { symbol, name: co.name, currency: co.currency, sector: co.profile.sector, unitNote: currencyUnit(co.currency) }, forensic, wcTrend, flags };
}
router.get("/forensic/:symbol", async (req, res) => {
  try { res.json(await buildForensic(req.params.symbol.toUpperCase())); }
  catch (e) { res.status(502).json({ error: "Forensic build failed", detail: String(e.message || e).slice(0, 160) }); }
});

/* RISK CENTER — scored, evidence-backed risk assessment. */
async function buildRisk(symbol) {
  const co = await cached(`co:${symbol}`, BUNDLE_TTL, () => buildCompany(symbol));
  const bundle = await cached(`bundle:${symbol}`, BUNDLE_TTL, () => F.quoteSummary(symbol));
  const forensic = A.forensicScores(bundle, co.statements);
  const idcf = A.institutionalDCF(bundle, co.statements, co.dcf.inputs, co.growth);
  const dcf = idcf && !idcf.error ? {
    upside: idcf.upside, terminalShare: idcf.base.terminalShare,
    bear: idcf.bear ? idcf.bear.perShare : null, base: idcf.base.perShare, bull: idcf.bull ? idcf.bull.perShare : null,
  } : null;
  const risk = A.riskAssessment({
    ratios: co.ratios, forensic, dcf, growth: co.growth, variance: co.variance,
    beta: co.keyStats.beta, price: co.price, sector: co.profile.sector,
  });
  return { meta: { symbol, name: co.name, currency: co.currency, sector: co.profile.sector, price: co.price, unitNote: currencyUnit(co.currency) }, risk };
}
router.get("/risk/:symbol", async (req, res) => {
  try { res.json(await buildRisk(req.params.symbol.toUpperCase())); }
  catch (e) { res.status(502).json({ error: "Risk build failed", detail: String(e.message || e).slice(0, 160) }); }
});

/* MULTI-METHOD VALUATION + MONTE CARLO for the Modeling Lab. */
async function buildValuation(symbol) {
  const co = await cached(`co:${symbol}`, BUNDLE_TTL, () => buildCompany(symbol));
  const bundle = await cached(`bundle:${symbol}`, BUNDLE_TTL, () => F.quoteSummary(symbol));
  const idcf = A.institutionalDCF(bundle, co.statements, co.dcf.inputs, co.growth);
  const dcf = idcf && !idcf.error ? {
    target: idcf.target, terminalShare: idcf.base.terminalShare, assumptions: idcf.assumptions, waccBuild: idcf.waccBuild,
  } : null;
  // peers
  let peers = [];
  try { const syms = await F.peerSuggestions(symbol); peers = [await peerRow(symbol), ...(await Promise.all(syms.slice(0, 6).map((s) => peerRow(s).catch(() => null))))].filter(Boolean); }
  catch { peers = [await peerRow(symbol).catch(() => null)].filter(Boolean); }
  const valuation = A.multiValuation({
    bundle, st: co.statements, ratios: co.ratios, growth: co.growth, dcf, peers,
    sharesOut: co.dcf.inputs.sharesOut, netDebt: co.dcf.inputs.netDebt, price: co.price,
  });
  const mc = idcf && !idcf.error ? A.monteCarlo(idcf, 5000) : null;
  return { meta: { symbol, name: co.name, currency: co.currency, price: co.price, unitNote: currencyUnit(co.currency) }, valuation, monteCarlo: mc };
}
router.get("/valuation/:symbol", async (req, res) => {
  try { res.json(await buildValuation(req.params.symbol.toUpperCase())); }
  catch (e) { res.status(502).json({ error: "Valuation build failed", detail: String(e.message || e).slice(0, 160) }); }
});

/* INDUSTRY ANALYSIS — sector aggregates, market share, Porter's, economics. */
async function buildIndustry(symbol) {
  const co = await cached(`co:${symbol}`, BUNDLE_TTL, () => buildCompany(symbol));
  let peers = [];
  try { const syms = await F.peerSuggestions(symbol); peers = [await peerRow(symbol), ...(await Promise.all(syms.slice(0, 8).map((s) => peerRow(s).catch(() => null))))].filter(Boolean); }
  catch { peers = [await peerRow(symbol).catch(() => null)].filter(Boolean); }
  const self = peers[0];
  const median = (arr) => { const v = arr.filter((x) => x != null && isFinite(x)).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
  const mean = (arr) => { const v = arr.filter((x) => x != null && isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };

  // market share by market cap (within the observed peer set)
  const totalMcap = peers.reduce((s, p) => s + (p.mcap || 0), 0);
  const shares = peers.map((p) => ({ symbol: p.symbol, name: p.name, mcap: p.mcap, share: totalMcap ? (p.mcap / totalMcap) * 100 : null, isSelf: p.symbol === symbol }))
    .filter((x) => x.mcap).sort((a, b) => b.mcap - a.mcap);
  // concentration (HHI-style) on observed set
  const hhi = shares.reduce((s, x) => s + Math.pow(x.share || 0, 2), 0);
  const concentration = hhi > 2500 ? "Concentrated" : hhi > 1500 ? "Moderately concentrated" : "Fragmented";

  // industry aggregates
  const agg = {
    medGrowth: median(peers.map((p) => p.revGrowth)), medNetMargin: median(peers.map((p) => p.netMargin)),
    medRoe: median(peers.map((p) => p.roe)), medPe: median(peers.map((p) => p.pe)), medEvEbitda: median(peers.map((p) => p.evEbitda)),
    n: peers.length,
  };

  // Porter's Five Forces — scored 1 (favourable) to 5 (threatening) from structure + economics
  const margin = self?.netMargin ?? agg.medNetMargin, growth = agg.medGrowth, conc = hhi;
  const porter = [
    { force: "Competitive rivalry", score: conc > 2500 ? 2 : conc > 1500 ? 3 : 5, note: `${concentration} industry (HHI ≈ ${Math.round(conc)}); ${conc > 2500 ? "few large players limit price wars" : "many players intensify competition"}.` },
    { force: "Threat of new entrants", score: margin != null && margin > 18 ? 4 : margin != null && margin > 8 ? 3 : 2, note: margin != null ? `${margin.toFixed(0)}% net margins ${margin > 15 ? "attract entrants" : "offer limited incentive to enter"}.` : "Entry economics unclear." },
    { force: "Supplier power", score: 3, note: "Supplier leverage is sector-specific; assess input concentration and switching costs." },
    { force: "Buyer power", score: agg.medNetMargin != null && agg.medNetMargin < 8 ? 4 : 3, note: agg.medNetMargin != null && agg.medNetMargin < 8 ? "Thin industry margins suggest buyers hold pricing leverage." : "Buyers have moderate leverage." },
    { force: "Threat of substitutes", score: 3, note: "Substitution risk depends on product differentiation and technological change." },
  ];
  const porterAvg = mean(porter.map((p) => p.score));
  const attractiveness = porterAvg <= 2.5 ? "Attractive" : porterAvg <= 3.5 ? "Average" : "Challenging";

  // industry lifecycle from growth
  const lifecycle = growth == null ? "Unknown" : growth > 15 ? "Growth" : growth > 5 ? "Maturing" : growth > 0 ? "Mature" : "Declining";

  return {
    meta: { symbol, name: co.name, currency: co.currency, sector: co.profile.sector, industry: co.profile.industry },
    self, peers, shares, concentration, hhi: Math.round(hhi), agg, porter, porterAvg, attractiveness, lifecycle,
  };
}
router.get("/industry/:symbol", async (req, res) => {
  try { res.json(await buildIndustry(req.params.symbol.toUpperCase())); }
  catch (e) { res.status(502).json({ error: "Industry build failed", detail: String(e.message || e).slice(0, 160) }); }
});

/* EARNINGS CALL — list available calls, fetch+analyze a transcript, or analyze pasted text.
   Transcript fetch requires API_NINJAS_KEY; the analysis engine runs regardless. */
router.get("/earnings/status", (_req, res) => res.json({ keyPresent: E.hasNinjaKey() || E.hasFmpKey(), ninja: E.hasNinjaKey(), fmp: E.hasFmpKey() }));

// FMP earnings report / estimates (next report date, consensus EPS & revenue, beat/miss)
router.get("/earnings/estimates/:symbol", async (req, res) => {
  try {
    const ticker = req.params.symbol.toUpperCase().replace(/\..*$/, "");
    const rows = await cached(`fmpearn:${ticker}`, 6 * 60 * 60 * 1000, () => E.fmpEarnings(ticker));
    res.json({ ticker, rows });
  } catch (e) {
    const msg = e.message === "NO_FMP_KEY" ? "Add FMP_API_KEY to .env for earnings estimates (financialmodelingprep.com)." : String(e.message || e).slice(0, 160);
    res.status(e.message === "NO_FMP_KEY" ? 400 : 502).json({ error: msg });
  }
});

router.get("/earnings/list/:symbol", async (req, res) => {
  try {
    const ticker = req.params.symbol.toUpperCase().replace(/\..*$/, ""); // API Ninjas uses bare US tickers
    const calls = await cached(`eclist:${ticker}`, 6 * 60 * 60 * 1000, () => E.listCalls(ticker));
    res.json({ ticker, calls });
  } catch (e) {
    const msg = e.message === "NO_KEY" ? "Add API_NINJAS_KEY to .env to fetch transcripts (free key at api-ninjas.com)." : String(e.message || e).slice(0, 160);
    res.status(e.message === "NO_KEY" ? 400 : 502).json({ error: msg, keyPresent: E.hasNinjaKey() });
  }
});

router.get("/earnings/call/:symbol", async (req, res) => {
  try {
    const raw = req.params.symbol.toUpperCase();
    const ticker = raw.replace(/\..*$/, "");
    const { year, quarter } = req.query;
    const t = await cached(`ec:${ticker}:${year || "L"}:${quarter || "L"}`, 6 * 60 * 60 * 1000, async () => {
      // prefer FMP transcript if its key is set, else API Ninjas
      if (E.hasFmpKey()) { try { const ft = await E.fmpTranscript(ticker, year, quarter); if (ft && ft.transcript) return ft; } catch (e) { if (!E.hasNinjaKey()) throw e; } }
      return E.fetchTranscript(ticker, year, quarter);
    });
    // peers for competitor detection
    let peers = [];
    try { const co = await cached(`co:${raw}`, BUNDLE_TTL, () => buildCompany(raw)); const syms = await F.peerSuggestions(raw); peers = (await Promise.all(syms.slice(0, 6).map((s) => peerRow(s).catch(() => null)))).filter(Boolean); }
    catch { }
    const analysis = E.analyzeTranscript(t, { ticker, year: t.year, quarter: t.quarter, date: t.date, timing: t.earnings_timing }, peers);
    // surface API-provided richer fields when the tier includes them
    const apiExtras = {};
    ["summary", "guidance", "risk_factors", "overall_sentiment", "overall_sentiment_rationale"].forEach((k) => { if (t[k] != null && t[k] !== "") apiExtras[k] = t[k]; });
    res.json({ meta: { ticker, year: t.year, quarter: t.quarter, date: t.date, timing: t.earnings_timing }, analysis, apiExtras, transcript: t.transcript });
  } catch (e) {
    const msg = e.message === "NO_KEY" ? "Add API_NINJAS_KEY to .env to fetch transcripts (free key at api-ninjas.com)." : String(e.message || e).slice(0, 160);
    res.status(e.message === "NO_KEY" ? 400 : 502).json({ error: msg, keyPresent: E.hasNinjaKey() });
  }
});

// analyze a pasted transcript — works with no key at all
router.post("/earnings/analyze", express.json({ limit: "2mb" }), async (req, res) => {
  const { transcript, symbol } = req.body || {};
  if (!transcript || transcript.length < 100) return res.status(400).json({ error: "Paste an earnings-call transcript (at least a few paragraphs)." });
  let peers = [];
  if (symbol) { try { const syms = await F.peerSuggestions(symbol.toUpperCase()); peers = (await Promise.all(syms.slice(0, 6).map((s) => peerRow(s).catch(() => null)))).filter(Boolean); } catch { } }
  const analysis = E.analyzeTranscript(transcript, { source: "pasted" }, peers);
  res.json({ meta: { source: "pasted" }, analysis, apiExtras: {}, transcript });
});

/* MACRO INDICATORS — live snapshot of key rates, indices, FX, commodities. */
router.get("/macro", async (_req, res) => {
  const tickers = [
    { s: "^NSEI", l: "NIFTY 50", g: "Equity" }, { s: "^GSPC", l: "S&P 500", g: "Equity" }, { s: "^IXIC", l: "Nasdaq", g: "Equity" },
    { s: "^TNX", l: "US 10Y yield", g: "Rates" }, { s: "USDINR=X", l: "USD/INR", g: "FX" }, { s: "DX-Y.NYB", l: "Dollar index", g: "FX" },
    { s: "GC=F", l: "Gold", g: "Commodity" }, { s: "CL=F", l: "WTI crude", g: "Commodity" }, { s: "BTC-USD", l: "Bitcoin", g: "Crypto" },
    { s: "^VIX", l: "VIX", g: "Volatility" },
  ];
  try {
    const Y = require("../providers/yahoo");
    const rows = await Promise.all(tickers.map(async (t) => {
      try { const q = await Y.getQuote(t.s); return { ...t, price: q.price ?? null, change: q.changePct ?? null }; }
      catch { return { ...t, price: null, change: null }; }
    }));
    res.json({ rows });
  } catch (e) { res.status(502).json({ error: "Macro fetch failed", detail: String(e.message || e).slice(0, 120) }); }
});

module.exports = router;
