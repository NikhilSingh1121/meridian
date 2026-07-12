const express = require("express");
const router = express.Router();
const F = require("../providers/fundamentals");
const A = require("../lib/analytics");
const E = require("../lib/earnings");
const { generateNarrative, hasKey } = require("../lib/ai");
const { cached, cachedDurable } = require("../cache");

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
    dupont: A.computeDuPont(st),
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
    const data = await cachedDurable(`co:${req.params.symbol}`, BUNDLE_TTL, () => buildCompany(req.params.symbol));
    res.json(data);
  } catch (e) {
    res.status(404).json({ error: `Could not build research pack for ${req.params.symbol}`, detail: String(e.message || e).slice(0, 120) });
  }
});

/* Peer comparison: auto-suggest + compute compact metric rows. */
async function peerRow(symbol) {
  const b = await cached(`mini:${symbol}`, MINI_TTL, () => F.miniSummary(symbol));
  const fd = b.financialData || {}, ks = b.defaultKeyStatistics || {}, sd = b.summaryDetail || {}, pr = b.price || {};
  // Yahoo scatters the same figure across modules and often omits a field it
  // reports elsewhere, so each metric falls back through every place it can
  // legitimately be sourced or derived from — a blank should mean "genuinely
  // not applicable" (e.g. EV/EBITDA or D/E for a bank), never "Yahoo put it in
  // a different module". `pick` also keeps a real 0 (e.g. a non-payer's 0%
  // dividend yield) instead of collapsing it to a dash.
  const num = (v) => (v !== undefined && v !== null && Number.isFinite(v) ? v : null);
  const pick = (...cands) => { for (const c of cands) { const v = num(c); if (v !== null) return v; } return null; };
  const price = pick(pr.regularMarketPrice, sd.previousClose);
  const eps = pick(ks.trailingEps, pr.epsTrailingTwelveMonths);
  const book = num(ks.bookValue); // book value per share

  // P/E — summaryDetail, then keyStats, then price/EPS (only when EPS is positive;
  // a negative EPS has no meaningful trailing P/E and stays blank).
  const pe = pick(sd.trailingPE, ks.trailingPE, pr.trailingPE, price !== null && eps !== null && eps > 0 ? price / eps : null);
  // P/B — keyStats, summaryDetail, then price/bookValue.
  const pb = pick(ks.priceToBook, sd.priceToBook, price !== null && book !== null && book > 0 ? price / book : null);
  // ROE — financialData, else trailing EPS / book value per share (both per-share → a ratio).
  const roeRaw = pick(fd.returnOnEquity, eps !== null && book !== null && book > 0 ? eps / book : null);
  // Dividend yield — summaryDetail's yield, else the trailing annual yield, else
  // dividendRate/price. Yahoo reports these as fractions; a genuine 0 is kept.
  const divRaw = pick(sd.dividendYield, sd.trailingAnnualDividendYield, price !== null && sd.dividendRate != null ? sd.dividendRate / price : null);
  return {
    symbol, name: pr.shortName || symbol, sector: b.assetProfile?.sector || "",
    mcap: pick(sd.marketCap, pr.marketCap), price, currency: pr.currency || "",
    pe, evEbitda: pick(ks.enterpriseToEbitda), pb,
    roe: roeRaw !== null ? +(roeRaw * 100).toFixed(2) : null,
    netMargin: pick(fd.profitMargins) !== null ? +(fd.profitMargins * 100).toFixed(2) : null,
    revGrowth: pick(fd.revenueGrowth) !== null ? +(fd.revenueGrowth * 100).toFixed(2) : null,
    de: pick(fd.debtToEquity) !== null ? +(fd.debtToEquity / 100).toFixed(2) : null,
    divYield: divRaw !== null ? +(divRaw * 100).toFixed(2) : null,
  };
}

router.get("/peers/:symbol", async (req, res) => {
  try {
    let peers = String(req.query.peers || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (!peers.length) peers = await F.peerSuggestions(req.params.symbol);
    // custom peer groups support up to 10 comparables (Equity Research spec)
    const self = req.params.symbol.toUpperCase();
    peers = [...new Set(peers.filter((p) => p !== self))].slice(0, 10);
    const rows = await F.pool([self, ...peers], 3, peerRow);
    res.json({ rows: rows.filter((r) => r && !r.error) });
  } catch (e) {
    res.status(502).json({ error: "Peer analysis unavailable" });
  }
});

/* Business-segment & geographic revenue mix (FMP; availability varies by
   issuer/plan). Returns { available:false } rather than erroring so the UI
   can omit the section entirely — never an empty visualisation. */
router.get("/segments/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  try {
    if (!E.hasFmpKey()) return res.json({ available: false, reason: "no FMP key" });
    const data = await cached(`seg:${symbol}`, 24 * 60 * 60 * 1000, async () => {
      // try the exchange-suffixed symbol first, then the bare ticker
      let seg = await E.fmpRevenueSegments(symbol);
      if (!seg.product.length && !seg.geographic.length && /\./.test(symbol)) {
        seg = await E.fmpRevenueSegments(symbol.replace(/\..*$/, ""));
      }
      return seg;
    });
    const available = !!(data.product.length || data.geographic.length);
    res.json({ available, ...data });
  } catch {
    res.json({ available: false });
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
      try { const co = await cachedDurable(`co:${q}`, BUNDLE_TTL, () => buildCompany(q)); if (co.profile.sector) extra.push(co.profile.sector); if (co.profile.industry) extra.push(co.profile.industry); } catch { }
    } else if (mode === "market") {
      extra = ["stock market", "economy"];
    }
    const data = await newsIntel(q, extra);
    res.json({ query: q, mode, ...data });
  } catch (e) { res.status(502).json({ error: "News intelligence unavailable", detail: String(e.message || e).slice(0, 120) }); }
});

/* Report generation: computed pack + narrative layer → structured report JSON. */
router.post("/report", express.json(), async (req, res) => {
  const { symbol, type = "Initiating Coverage", _idcfSnapshot } = req.body || {};
  if (!symbol) return res.status(400).json({ error: "symbol required" });
  try {
    const co = await cachedDurable(`co:${symbol}`, BUNDLE_TTL, () => buildCompany(symbol));
    const bundle = await cached(`bundle:${symbol}`, BUNDLE_TTL, () => F.quoteSummary(symbol));
    const ratiosFlat = Object.fromEntries(co.ratios.map((r) => [r.name, r.value]));

    // ── Prefer idcf from valuationModelState snapshot (user-adjusted assumptions)
    //    Fall back to server-computed idcf only if no snapshot was sent.
    const idcf = (_idcfSnapshot?.idcf && !_idcfSnapshot.idcf.error)
      ? _idcfSnapshot.idcf
      : A.institutionalDCF(bundle, co.statements, co.dcf.inputs, co.growth);

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
      grossMarginPct: (() => {
        const li = co.statements?.income?.at(-1);
        return li && li.grossProfit != null && li.revenue ? (li.grossProfit / li.revenue) * 100 : null;
      })(),
      dcf: idcf && !idcf.error ? { perShare: idcf.target, wacc: idcf.assumptions.wacc, terminalG: idcf.assumptions.terminalG, terminalShare: idcf.base.terminalShare } : null,
      summary: co.profile.summary.slice(0, 900),
    };
    const narrative = await generateNarrative(pack, type);

    const blendedTarget = narrative.blendedUpside != null && co.price
      ? co.price * (1 + narrative.blendedUpside / 100)
      : target;
    const blendedUpsidePct = narrative.blendedUpside != null ? narrative.blendedUpside : upside;

    res.json({
      meta: {
        symbol, name: co.name, type, date: new Date().toISOString().slice(0, 10),
        price: co.price, currency: co.currency, sector: co.profile.sector, industry: co.profile.industry,
        exchange: co.exchange, analyst: "Meridian Research Engine",
        target: blendedTarget, upside: blendedUpsidePct, dcfTarget: target, dcfUpside: upside,
        recommendation: narrative.recommendation, mode: narrative.mode, unitNote: currencyUnit(co.currency),
        // Expose whether the idcf came from user-adjusted VMS or fresh server computation
        valuationSource: (_idcfSnapshot?.idcf && !_idcfSnapshot.idcf.error) ? "Modeling Lab (user assumptions)" : "Server default",
        vmsModelStatus: _idcfSnapshot?.modelStatus ?? null,
        vmsLastRecalcAt: _idcfSnapshot?.lastRecalcAt ?? null,
      },
      narrative,
      data: {
        growth: co.growth, variance: co.variance, ratios: co.ratios, series: co.series,
        idcf, statements: co.statements, quarterly: co.quarterly, street: co.street,
        holders: co.holders, keyStats: co.keyStats, peers, profile: co.profile, forensic,
        evidence: _idcfSnapshot?.evidence ?? null,  // pass evidence to report renderer
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
/* Historical valuation bands — trailing P/E and P/B over 5 years of monthly
   closes, banded against the stock's own history (min / quartiles / max).
   Deterministic; reuses the cached company pack + the standard history
   provider. Degrades to { available:false } rather than erroring. */
async function buildBands(symbol) {
  return cached(`bands:${symbol}`, MINI_TTL, async () => {
    const co = await cachedDurable(`co:${symbol}`, BUNDLE_TTL, () => buildCompany(symbol));
    const sharesOut = co.dcf?.inputs?.sharesOut;
    const yahoo = require("../providers/yahoo");
    const h = await yahoo.getHistory(symbol, "5y", "1mo");
    const monthly = (h && (h.points || h)) || [];
    const bands = A.computeMultipleBands(monthly, co.statements, sharesOut);
    if (!bands) return { available: false, reason: "Insufficient history or per-share denominators for this issuer" };
    return { available: true, symbol, name: co.name, currency: co.currency, price: co.price, ...bands };
  });
}
router.get("/bands/:symbol", async (req, res) => {
  try { res.json(await buildBands(req.params.symbol.toUpperCase())); }
  catch (e) { res.json({ available: false, reason: String(e.message || e).slice(0, 140) }); }
});

router.post("/dcf", express.json(), (req, res) => {
  const r = A.runDCF(req.body || {});
  if (!r) return res.status(400).json({ error: "baseFcf and sharesOut required" });
  res.json(r);
});

/* Full institutional DCF working for the Modeling Lab.
   GET returns defaults; POST applies assumption overrides and recomputes the
   entire 17-section model live. Overrides: growthY1_5, fade, terminalG, wacc,
   ebitdaMargin, capexPctRev, taxRate, depPctRev, wcPctRev, beta, rf, erp,
   forecastHorizon, terminalMethod, exitMultiple, yearwise, capitalAllocation. */
async function buildInstitutionalDCF(symbol, overrides = {}) {
  const co = await cachedDurable(`co:${symbol}`, BUNDLE_TTL, () => buildCompany(symbol));
  const bundle = await cached(`bundle:${symbol}`, BUNDLE_TTL, () => F.quoteSummary(symbol));
  const dcfIn = { ...co.dcf.inputs };
  // scalar assumption overrides
  ["growthY1_5", "fade", "terminalG", "wacc"].forEach((k) => {
    if (overrides[k] != null && isFinite(+overrides[k])) dcfIn[k] = +overrides[k];
  });
  // Net debt / capital-structure overrides — flow into EV→Equity bridge.
  //   netDebt: scalar override of total net debt (in raw currency units)
  //   stDebt / ltDebt / cash: capital-structure components; if any is set,
  //                            netDebt is recomputed as (st + lt − cash) and
  //                            also fed back into the IDCF engine so the
  //                            sensitivity / scenario sheets reconcile.
  let capStructureTouched = false;
  ["netDebt", "stDebt", "ltDebt", "cash"].forEach((k) => {
    if (overrides[k] != null && isFinite(+overrides[k])) capStructureTouched = true;
  });
  if (capStructureTouched) {
    const o = overrides;
    if (o.stDebt != null || o.ltDebt != null || o.cash != null) {
      // Component-based: derive net debt from the parts; missing parts fall
      // back to the engine's existing components so partial edits work too.
      const baseSt = +o.stDebt;
      const baseLt = +o.ltDebt;
      const baseCash = +o.cash;
      const lastBal = co.statements.balance.at(-1) || {};
      const st = isFinite(baseSt) ? baseSt : (lastBal.stDebt || 0);
      const lt = isFinite(baseLt) ? baseLt : (lastBal.ltDebt || 0);
      const c  = isFinite(baseCash) ? baseCash : (lastBal.cash || 0);
      dcfIn.netDebt = st + lt - c;
      dcfIn._stDebtOverride = isFinite(baseSt) ? baseSt : null;
      dcfIn._ltDebtOverride = isFinite(baseLt) ? baseLt : null;
      dcfIn._cashOverride   = isFinite(baseCash) ? baseCash : null;
    }
    if (o.netDebt != null && isFinite(+o.netDebt)) {
      dcfIn.netDebt = +o.netDebt;
    }
  }
  if (overrides.rationale) dcfIn.rationale = { ...dcfIn.rationale, ...overrides.rationale };
  ["rf", "beta", "erp"].forEach((k) => {
    if (overrides[k] != null && isFinite(+overrides[k])) dcfIn.rationale = { ...dcfIn.rationale, [k]: +overrides[k] };
  });
  // ── BUG FIX: WACC must recompute when any CAPM input (rf/beta/erp) changes ──
  // dcfIn.wacc is the discount rate the engine ACTUALLY uses for everything
  // downstream (FCFF discounting, sensitivity grid, scenarios, peer DCF
  // comparison). Without this recompute it stayed stale at the build-time
  // value, making rf/beta/erp edits visible only in the WACC build display
  // but invisible to the model. If the user explicitly overrode `wacc`
  // directly, that wins and we don't touch it.
  const waccDirectlyOverridden = overrides.wacc != null && isFinite(+overrides.wacc);
  const capmTouched = ["rf", "beta", "erp"].some((k) => overrides[k] != null && isFinite(+overrides[k]));
  if (capmTouched && !waccDirectlyOverridden) {
    const { rf, beta, erp } = dcfIn.rationale;
    // Matches dcfDefaults() — CAPM cost-of-equity proxy is the engine baseline
    dcfIn.wacc = +(rf + beta * erp).toFixed(2);
  }
  const idcf = A.institutionalDCF(bundle, co.statements, dcfIn, co.growth, {
    ebitdaMargin: overrides.ebitdaMargin != null ? +overrides.ebitdaMargin / 100 : undefined,
    capexPctRev: overrides.capexPctRev != null ? +overrides.capexPctRev / 100 : undefined,
    taxRate: overrides.taxRate != null ? +overrides.taxRate / 100 : undefined,
    depPctRev: overrides.depPctRev != null ? +overrides.depPctRev / 100 : undefined,
    wcPctRev: overrides.wcPctRev != null ? +overrides.wcPctRev / 100 : undefined,
    // Expanded-mode params (passed through as-is, validated downstream)
    forecastHorizon: overrides.forecastHorizon,
    terminalMethod: overrides.terminalMethod,
    exitMultiple: overrides.exitMultiple,
    yearwise: overrides.yearwise,
    capitalAllocation: overrides.capitalAllocation,
  });

  // ── Assumption Evidence Layer (new) ──────────────────────────────────────
  // Attach tvWarn flag to dcfIn so evidence engine can use it
  const dcfInWithMeta = { ...dcfIn, _tvWarn: idcf && !idcf.error && idcf.base?.terminalShare > 0.75 };
  let evidence = null;
  try {
    evidence = A.assumptionEvidence(bundle, co.statements, dcfInWithMeta);
    // Enrich diagnostics with live IDCF outputs (TV share, negative FCFF, etc.)
    if (idcf && !idcf.error) evidence = A.enrichDiagnostics(evidence, idcf);
  } catch (e) {
    evidence = { error: "Evidence build failed: " + e.message };
  }

  // Track which assumptions were user-overridden
  const userOverrides = Object.keys(overrides).filter((k) =>
    ["growthY1_5", "fade", "terminalG", "wacc", "ebitdaMargin", "capexPctRev", "taxRate", "depPctRev", "wcPctRev", "rf", "beta", "erp",
     "forecastHorizon", "terminalMethod", "exitMultiple", "yearwise", "capitalAllocation",
     "netDebt", "stDebt", "ltDebt", "cash"].includes(k)
  );
  // yearwise / capitalAllocation only count as user-adjusted if non-empty
  const meaningfulOverrides = userOverrides.filter((k) => {
    if (k === "yearwise" || k === "capitalAllocation") {
      const obj = overrides[k] || {};
      return Object.values(obj).some((arr) => Array.isArray(arr) && arr.some((v) => v != null && isFinite(+v)));
    }
    if (k === "forecastHorizon") return +overrides[k] !== 5; // default is 5
    if (k === "terminalMethod") return overrides[k] === "exitMultiple";
    return true;
  });

  // ── Reverse DCF + Tornado sensitivity (S18/S19) ──────────────────────────
  // Both re-run the same institutionalDCF engine (no parallel math). They are
  // additive response fields: the Excel export and every existing consumer
  // read named fields and are unaffected. Guarded so a solver failure can
  // never take down the model response.
  let reverse = null, tornado = null;
  if (idcf && !idcf.error && idcf.base && isFinite(idcf.base.perShare) && co.price) {
    const solverOv = {
      ebitdaMargin: overrides.ebitdaMargin != null ? +overrides.ebitdaMargin / 100 : undefined,
      capexPctRev: overrides.capexPctRev != null ? +overrides.capexPctRev / 100 : undefined,
      taxRate: overrides.taxRate != null ? +overrides.taxRate / 100 : undefined,
      depPctRev: overrides.depPctRev != null ? +overrides.depPctRev / 100 : undefined,
      wcPctRev: overrides.wcPctRev != null ? +overrides.wcPctRev / 100 : undefined,
      forecastHorizon: overrides.forecastHorizon,
      terminalMethod: overrides.terminalMethod,
      exitMultiple: overrides.exitMultiple,
      yearwise: overrides.yearwise,
      capitalAllocation: overrides.capitalAllocation,
    };
    try { reverse = A.reverseDCF(bundle, co.statements, dcfIn, co.growth, solverOv, co.price); }
    catch (e) { reverse = { error: "Reverse-DCF solve failed: " + String(e.message || e).slice(0, 120) }; }
    try { tornado = A.tornadoAnalysis(bundle, co.statements, dcfIn, co.growth, solverOv, idcf); }
    catch (e) { tornado = { error: "Tornado build failed: " + String(e.message || e).slice(0, 120) }; }
  }

  return {
    meta: {
      symbol, name: co.name, currency: co.currency, exchange: co.exchange,
      price: co.price, sector: co.profile.sector, unitNote: currencyUnit(co.currency),
      modelStatus: meaningfulOverrides.length > 0 ? "User-Adjusted" : "Evidence-Based",
      userOverrides,
      builtAt: new Date().toISOString(),
    },
    statements: co.statements, growth: co.growth, idcf,
    reverse, tornado,
    assumptionsUsed: { ...dcfIn },
    evidence,
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

/* Excel export — institutional-grade .xlsx workbook with live formulas */
router.post("/idcf/:symbol/excel", express.json({ limit: "10mb" }), async (req, res) => {
  try {
    const { buildWorkbook } = require("../lib/excel-export");
    const symbol = req.params.symbol.toUpperCase();
    // Build full IDCF data + statements server-side, then merge with any
    // client-supplied uiState / overrides so the workbook reflects the
    // exact state of the user's screen.
    const co = await cachedDurable(`co:${symbol}`, BUNDLE_TTL, () => buildCompany(symbol));
    // ── BUG FIX (v42): The IDCF rebuild for the Excel must honor the user's
    // forecast-horizon, terminal-method, and exit-multiple selections. The
    // client now ships those inside userOverrides (see exportExcel in
    // terminal-modules.js), but for backward compatibility — and as a
    // belt-and-suspenders safeguard — we also merge them in from uiState
    // here. This means even if a client forgets to populate userOverrides
    // with these three fields, the export still picks them up from uiState.
    const ui = req.body?.uiState || {};
    const userOv = { ...(req.body?.userOverrides || {}) };
    if (ui.forecastHorizon != null && userOv.forecastHorizon == null) {
      userOv.forecastHorizon = ui.forecastHorizon;
    }
    if (ui.terminalMethod != null && userOv.terminalMethod == null) {
      userOv.terminalMethod = ui.terminalMethod;
    }
    if (ui.exitMultiple != null && userOv.exitMultiple == null) {
      userOv.exitMultiple = ui.exitMultiple;
    }
    if (ui.yearwise && !userOv.yearwise) userOv.yearwise = ui.yearwise;
    if (ui.capitalAllocation && !userOv.capitalAllocation) userOv.capitalAllocation = ui.capitalAllocation;
    const idcfData = await buildInstitutionalDCF(symbol, userOv);

    // Pull integrated statements (income/balance/cashflow actuals + forecast).
    // Forecast-side rows come from the IDCF engine output (idcf.base.rows);
    // for BS/CF, the client-side computeIntegratedStatements is the canonical
    // source — but we accept it pre-computed via the request body to avoid
    // duplicating the logic server-side. If not provided, we fall back to
    // empty forecast arrays (the workbook still builds correctly).
    const clientStatements = req.body?.statements || {};
    const statements = {
      incomeActuals:   clientStatements.incomeActuals   || co.statements?.income   || [],
      balanceActuals:  clientStatements.balanceActuals  || co.statements?.balance  || [],
      cashflowActuals: clientStatements.cashflowActuals || co.statements?.cashflow || [],
      income:          clientStatements.income   || (idcfData.idcf?.base?.rows || []),
      balance:         clientStatements.balance  || [],
      cashflow:        clientStatements.cashflow || [],
      // Aliases for the audit sheet
      balanceForecast:  clientStatements.balance  || [],
      cashflowForecast: clientStatements.cashflow || [],
    };

    const payload = {
      meta: {
        symbol,
        name: co.name || symbol,
        currency: co.currency || "INR",
        price: co.price || idcfData.idcf?.currentPrice || 0,
        // ── BUG FIX (v42): sector/industry live at co.profile.*, not co.*
        // (see buildCompany — assetProfile flattens into co.profile).
        // Previous lookup of co.sector was always undefined so the cover
        // page rendered an empty Sector field. Same for industry.
        sector: co.profile?.sector || "",
        industry: co.profile?.industry || "",
        exchange: co.exchange || "",
        // ── Forward IDCF-rebuild metadata so the cover page reflects the
        // exact state of the export (Built-at timestamp, Evidence-Based vs
        // User-Adjusted model status). Without this, the cover always
        // defaults to the cover-sheet local fallback.
        modelStatus: idcfData.meta?.modelStatus || "Evidence-Based",
        builtAt: idcfData.meta?.builtAt || new Date().toISOString(),
      },
      idcf: idcfData.idcf || {},
      // ── FIELD-PATH FIX ──────────────────────────────────────────────────
      // `assumptionsUsed: { ...dcfIn }` only contains the scalar inputs
      // (growthY1_5, fade, terminalG, wacc, rationale, sharesOut, netDebt).
      // The Excel needs the FULL operating-driver set (ebitdaMargin,
      // capexPctRev, depPctRev, taxRate, wcPctRev, terminalMethod,
      // exitMultiple). Those live at idcf.assumptions (built by
      // analytics.institutionalDCF). Same correction for waccBuild —
      // idcf.waccBuild has the rf/beta/erp/weightEquity/weightDebt
      // structure. Previous paths (`idcfData.assumptionsUsed` and
      // `idcf.wacc`) returned partial/empty objects, which silently zeroed
      // out every input cell in the Assumptions sheet and cascaded errors
      // through the entire workbook.
      assumptions: idcfData.idcf?.assumptions || {},
      evidence: idcfData.evidence || {},
      waccBuild: idcfData.idcf?.waccBuild || {},
      statements,
      uiState: req.body?.uiState || {},
      // Flags forwarded from the client-side computeIntegratedStatements
      epsAvailable:          clientStatements.epsAvailable !== false,
      equitySplitAvailable:  clientStatements.equitySplitAvailable === true,
    };

    const buf = await buildWorkbook(payload);
    const fileName = `${symbol}_DCF_Model_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Length", Buffer.byteLength(buf));
    res.send(Buffer.from(buf));
  } catch (e) {
    console.error("Excel export failed:", e);
    res.status(500).json({ error: "Excel export failed", detail: String(e.message || e).slice(0, 240) });
  }
});

/* FORENSIC ANALYSIS — full scorecard for the dedicated module. */
async function buildForensic(symbol) {
  const co = await cachedDurable(`co:${symbol}`, BUNDLE_TTL, () => buildCompany(symbol));
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
  // red-flag detection (deterministic rules) — each carries the reason for the conclusion
  const flags = [];
  const f = forensic;
  if (f) {
    if (f.beneish.score != null && f.beneish.score > -1.78) flags.push({ sev: "high", t: "Beneish M-Score above −1.78 — statistically elevated earnings-manipulation risk.", why: `M-Score of ${f.beneish.score} exceeds the −1.78 threshold Beneish derived from manipulator samples. It is driven by the 8 indices above (receivables, margins, asset quality, growth and accruals); a reading this high means the accrual and revenue signals collectively resemble firms that later restated.` });
    if (f.altman.zone === "Distress") flags.push({ sev: "high", t: "Altman Z in the distress zone — heightened bankruptcy risk on this model.", why: `Z-Score of ${f.altman.score} is below 1.81. Weighted working-capital, retained-earnings, EBIT, equity-coverage and turnover ratios sum to a level historically associated with financial distress within two years.` });
    else if (f.altman.zone === "Grey") flags.push({ sev: "med", t: "Altman Z in the grey zone — financial resilience is not clearly safe.", why: `Z-Score of ${f.altman.score} sits between 1.81 and 2.99 — neither clearly safe nor distressed; solvency depends on sustaining EBIT and turnover.` });
    if (f.cash.cashConversion != null && f.cash.cashConversion < 0.7) flags.push({ sev: "med", t: `Weak cash conversion (${f.cash.cashConversion}× OCF/NI) — earnings run ahead of cash generation.`, why: `Only ${(f.cash.cashConversion * 100).toFixed(0)}% of reported net income converted to operating cash. Persistent readings under 0.7× suggest profit is being recognised faster than cash is collected — a working-capital or revenue-recognition question.` });
    if (f.cash.accrualRatio != null && Math.abs(f.cash.accrualRatio) > 12) flags.push({ sev: "med", t: `Elevated accrual ratio (${f.cash.accrualRatio}%) — a larger share of earnings is non-cash.`, why: `(Net income − OCF) is ${f.cash.accrualRatio}% of assets. High accruals mean earnings lean on estimates and timing rather than cash, and tend to mean-revert — a headwind to future reported profit.` });
    if (f.piotroski.score <= 3) flags.push({ sev: "med", t: `Low Piotroski F-Score (${f.piotroski.score}/9) — weak fundamental momentum across profitability, leverage and efficiency.`, why: `Only ${f.piotroski.score} of 9 binary tests passed. The failing tests (shown in the Piotroski table) point to deteriorating returns, rising leverage or falling efficiency versus the prior year.` });
    const r0 = wcTrend.at(-2)?.recvDays, r1 = wcTrend.at(-1)?.recvDays;
    if (r0 && r1 && r1 > r0 * 1.25) flags.push({ sev: "med", t: `Receivable days expanded sharply (${r0}→${r1}d) — possible channel stuffing or collection issues.`, why: `Days-sales-outstanding rose ${(((r1 - r0) / r0) * 100).toFixed(0)}% year-on-year. A jump this size means sales are increasingly on credit not yet collected, which can flatter revenue while cash lags.` });
    if (!flags.length) flags.push({ sev: "low", t: "No material red flags detected across the forensic screens.", why: "Beneish, Altman, cash-conversion, accrual and Piotroski screens are all within normal ranges on the reported figures." });
  }
  return { meta: { symbol, name: co.name, currency: co.currency, sector: co.profile.sector, unitNote: currencyUnit(co.currency) }, forensic, wcTrend, flags };
}
router.get("/forensic/:symbol", async (req, res) => {
  try { res.json(await buildForensic(req.params.symbol.toUpperCase())); }
  catch (e) { res.status(502).json({ error: "Forensic build failed", detail: String(e.message || e).slice(0, 160) }); }
});

/* RISK CENTER — scored, evidence-backed risk assessment. */
async function buildRisk(symbol) {
  const co = await cachedDurable(`co:${symbol}`, BUNDLE_TTL, () => buildCompany(symbol));
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
  const co = await cachedDurable(`co:${symbol}`, BUNDLE_TTL, () => buildCompany(symbol));
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
  const co = await cachedDurable(`co:${symbol}`, BUNDLE_TTL, () => buildCompany(symbol));
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

/* Keyless earnings pack (yahoo-finance2) — next call, recent calls with
   actual/estimate/surprise, forward consensus and transcript links. Works for
   any ticker (NSE/BSE/US/global). Powers the schedule + recent-calls panels. */
router.get("/earnings/summary/:symbol", async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const data = await cached(`earnsum:${symbol}`, 30 * 60 * 1000, () => F.earningsSummary(symbol));
    res.json(data);
  } catch (e) {
    res.status(502).json({ available: false, error: `Earnings data unavailable for ${req.params.symbol}`, detail: String((e && e.message) || e).slice(0, 140) });
  }
});

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
    try { const co = await cachedDurable(`co:${raw}`, BUNDLE_TTL, () => buildCompany(raw)); const syms = await F.peerSuggestions(raw); peers = (await Promise.all(syms.slice(0, 6).map((s) => peerRow(s).catch(() => null)))).filter(Boolean); }
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

/* MACRO COMMAND — full macro universe: global equities, rates, FX, commodities,
   volatility, crypto. Per-symbol quotes flow through the durable q: cache
   (15s TTL + stale-on-error snapshots), so one upstream hiccup never blanks
   the board. Response stays backward-compatible ({ rows }). */
const MACRO_UNIVERSE = [
  // ── Equity — India ──
  { s: "^NSEI", l: "NIFTY 50", g: "India Equity" },
  { s: "^BSESN", l: "SENSEX", g: "India Equity" },
  { s: "^NSEBANK", l: "BANK NIFTY", g: "India Equity" },
  // ── Equity — Global ──
  { s: "^GSPC", l: "S&P 500", g: "Global Equity" },
  { s: "^IXIC", l: "Nasdaq", g: "Global Equity" },
  { s: "^DJI", l: "Dow Jones", g: "Global Equity" },
  { s: "^FTSE", l: "FTSE 100", g: "Global Equity" },
  { s: "^GDAXI", l: "DAX", g: "Global Equity" },
  { s: "^N225", l: "Nikkei 225", g: "Global Equity" },
  { s: "^HSI", l: "Hang Seng", g: "Global Equity" },
  { s: "^RUT", l: "Russell 2000", g: "Global Equity" },
  { s: "000001.SS", l: "Shanghai", g: "Global Equity" },
  // ── Rates (US treasury yields, %) ──
  { s: "^IRX", l: "US 3M", g: "Rates", unit: "%" },
  { s: "^FVX", l: "US 5Y", g: "Rates", unit: "%" },
  { s: "^TNX", l: "US 10Y", g: "Rates", unit: "%" },
  { s: "^TYX", l: "US 30Y", g: "Rates", unit: "%" },
  // ── FX ──
  { s: "USDINR=X", l: "USD/INR", g: "FX" },
  { s: "EURUSD=X", l: "EUR/USD", g: "FX" },
  { s: "GBPUSD=X", l: "GBP/USD", g: "FX" },
  { s: "USDJPY=X", l: "USD/JPY", g: "FX" },
  { s: "USDCNY=X", l: "USD/CNY", g: "FX" },
  { s: "AUDUSD=X", l: "AUD/USD", g: "FX" },
  { s: "USDCAD=X", l: "USD/CAD", g: "FX" },
  { s: "USDCHF=X", l: "USD/CHF", g: "FX" },
  { s: "DX-Y.NYB", l: "Dollar Index", g: "FX" },
  // ── Commodities ──
  { s: "GC=F", l: "Gold", g: "Commodities" },
  { s: "SI=F", l: "Silver", g: "Commodities" },
  { s: "HG=F", l: "Copper", g: "Commodities" },
  { s: "CL=F", l: "WTI Crude", g: "Commodities" },
  { s: "BZ=F", l: "Brent", g: "Commodities" },
  { s: "NG=F", l: "Nat Gas", g: "Commodities" },
  { s: "ZW=F", l: "Wheat", g: "Commodities" },
  { s: "ZC=F", l: "Corn", g: "Commodities" },
  { s: "PL=F", l: "Platinum", g: "Commodities" },
  // ── Volatility ──
  { s: "^VIX", l: "VIX", g: "Volatility" },
  { s: "^INDIAVIX", l: "India VIX", g: "Volatility" },
  // ── Crypto ──
  { s: "BTC-USD", l: "Bitcoin", g: "Crypto" },
  { s: "ETH-USD", l: "Ethereum", g: "Crypto" },
];

router.get("/macro", async (_req, res) => {
  try {
    const Y = require("../providers/yahoo");
    const rows = await Promise.all(MACRO_UNIVERSE.map(async (t) => {
      try {
        const q = await cachedDurable(`q:${t.s}`, 15_000, () => Y.getQuote(t.s));
        return { ...t, price: q.price ?? null, change: q.changePct ?? null, stale: q.stale || undefined };
      } catch { return { ...t, price: null, change: null }; }
    }));
    res.json({ rows, asOf: Date.now() });
  } catch (e) { res.status(502).json({ error: "Macro fetch failed", detail: String(e.message || e).slice(0, 120) }); }
});

/* CONSOLIDATED RESEARCH WORKBOOK — one .xlsx with every analytical surface
   (statements, ratios, DuPont, growth/variance, valuation methods + bands,
   reverse DCF + tornado, forensic, risk, peers, ownership). Each section is
   assembled independently and failure-isolated: one missing pack renders an
   explanatory row, never a failed download. Heavy-tier rate limited. */
router.get("/company/:symbol/workbook", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  try {
    const co = await cachedDurable(`co:${symbol}`, BUNDLE_TTL, () => buildCompany(symbol));
    const safe = (fn) => fn().catch(() => null);
    const [forensicPack, riskPack, valuationPack, idcfPack, bands, peers] = await Promise.all([
      safe(() => buildForensic(symbol)),
      safe(() => buildRisk(symbol)),
      safe(() => buildValuation(symbol)),
      safe(() => buildInstitutionalDCF(symbol, {})),
      safe(() => buildBands(symbol)),
      safe(async () => {
        const syms = await F.peerSuggestions(symbol);
        const rows = [await peerRow(symbol), ...(await Promise.all(syms.slice(0, 6).map((x) => peerRow(x).catch(() => null))))];
        return rows.filter(Boolean);
      }),
    ]);
    const { buildResearchWorkbook } = require("../lib/research-workbook");
    const wb = await buildResearchWorkbook({ co, forensicPack, riskPack, valuationPack, idcfPack, bands, peers });
    const buf = await wb.xlsx.writeBuffer();
    const fname = `MERIDIAN_${symbol.replace(/[^A-Z0-9.]/g, "")}_Research_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
    res.send(Buffer.from(buf));
  } catch (e) {
    res.status(502).json({ error: "Workbook build failed", detail: String(e.message || e).slice(0, 160) });
  }
});

module.exports = router;
