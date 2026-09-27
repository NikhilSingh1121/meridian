const express = require("express");
const router = express.Router();
const F = require("../providers/fundamentals");
const A = require("../lib/analytics");
const E = require("../lib/earnings");
const PDF = require("../lib/pdftext");
const { buildDocx } = require("../lib/docx-report");
const { generateNarrative, hasKey } = require("../lib/ai");
const { researchForReport, jobStatus, documentsFor } = require("../lib/insights");
const { buildPack, quarterlyResults } = require("../lib/companyPack");
const { runChecks } = require("../lib/reportChecks");
const { filings: nseFilings } = require("../lib/insights/sources");
const { cached, cachedDurable, get: cacheGet, set: cacheSet } = require("../cache");

const Y = require("../providers/yahoo");

// Fundamentals (statements, profile, ownership, ratios) only change on filings,
// so they are held for 24h. Anything market-live — price, day change — is
// overlaid from the 15s quote cache on every request (see getCo).
const STATIC_TTL = 24 * 60 * 60 * 1000;
const BUNDLE_TTL = STATIC_TTL;
const MINI_TTL = STATIC_TTL;
const QUOTE_TTL = 15 * 1000;

const getBundle = (symbol) => {
  const s = String(symbol).toUpperCase();
  return cached(`bundle:${s}`, BUNDLE_TTL, () => F.quoteSummary(s));
};

/* Company pack: 24h static fundamentals + live price overlay. Upside/DCF
   consumers therefore always compare against the current market price. */
async function getCo(symbol) {
  const s = String(symbol).toUpperCase();
  const co = await cachedDurable(`co:${s}`, BUNDLE_TTL, () => buildCompany(s));
  // an incomplete provider response (no share count → no market cap or DCF)
  // must not be pinned for a day: keep it for 10 minutes, then rebuild
  if (co && co.keyStats && co.keyStats.sharesOut == null && !co.__retrySoon) cacheSet(`co:${s}`, { ...co, __retrySoon: true }, 10 * 60 * 1000);
  try {
    const q = await cachedDurable(`q:${s}`, QUOTE_TTL, () => Y.getQuote(s));
    if (q && q.price != null) {
      return { ...co, price: q.price, change: q.change, changePct: q.changePct, marketState: q.marketState || co.marketState };
    }
  } catch { /* quote unavailable — serve the pack's own price */ }
  return co;
}

/* Build the complete research pack for one company. */
async function buildCompany(symbol) {
  const bundle = await F.quoteSummary(symbol);
  const st = A.normStatements(bundle);
  const { ratios, series, mcap, ev, debt } = A.computeRatios(bundle, st);
  const growth = A.computeGrowth(st);
  const variance = A.varianceAnalysis(st);
  const dcfIn = A.dcfDefaults(bundle, st, { debt }, growth);
  const rv = (nm) => { const r = ratios.find((x) => x.name === nm); return r && r.value != null ? r.value : null; };
  const liM = st.income.at(-1) || {};
  const moat = A.moatAssessment({
    roce: rv("ROCE"), netMargin: rv("Net margin"), de: rv("Debt / Equity"),
    grossMargin: liM.revenue && liM.grossProfit != null ? (liM.grossProfit / liM.revenue) * 100 : null,
  });
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
    keyStats: {
      mcap, ev, debt, high52: bundle.summaryDetail?.fiftyTwoWeekHigh ?? null, low52: bundle.summaryDetail?.fiftyTwoWeekLow ?? null, beta: bundle.defaultKeyStatistics?.beta ?? null,
      volume: bundle.summaryDetail?.volume ?? pr.regularMarketVolume ?? null, avgVolume: bundle.summaryDetail?.averageVolume ?? null,
      avgVolume10d: bundle.summaryDetail?.averageDailyVolume10Day ?? null, sharesOut: bundle.defaultKeyStatistics?.sharesOutstanding ?? null, sharesSource: bundle.__sharesSource || null,
      marketTime: pr.regularMarketTime ? new Date(pr.regularMarketTime).toISOString() : null,
    },
    statements: st, quarterly: qInc,
    ratios, series, growth, variance, moat,
    dupont: A.computeDuPont(st),
    dcf: { inputs: dcfIn, result: dcf },
    street: {
      targetMean: bundle.financialData?.targetMeanPrice ?? null,
      rec: bundle.financialData?.recommendationKey || null,
      analysts: bundle.financialData?.numberOfAnalystOpinions ?? null,
      trend: (bundle.recommendationTrend?.trend || []).slice(0, 1)[0] || null,
      trends: (bundle.recommendationTrend?.trend || []).slice(0, 4),
      targetHigh: bundle.financialData?.targetHighPrice ?? null, targetLow: bundle.financialData?.targetLowPrice ?? null,
      targetMedian: bundle.financialData?.targetMedianPrice ?? null, recMean: bundle.financialData?.recommendationMean ?? null,
    },
    aiAvailable: hasKey(),
  };
}

router.get("/company/:symbol", async (req, res) => {
  try {
    const data = await getCo(req.params.symbol);
    res.json(data);
  } catch (e) {
    res.status(404).json({ error: `Could not build research pack for ${req.params.symbol}`, detail: String(e.message || e).slice(0, 120) });
  }
});

/* Company Research Pack · Layer 1 — exchange-filed quarterly results (XBRL),
   earnings bridges, shareholding & pledges, insider trades, corporate actions,
   calendar, material filings and news. Shared by the workstation and the report;
   refreshed every 3 hours so results-day filings appear the same day. */
const PACK_TTL = 3 * 60 * 60 * 1000;
function packFor(symbol, co) {
  return cachedDurable(`pack3:${symbol}`, PACK_TTL, () => buildPack(symbol, co));
}
router.get("/company/:symbol/pack", async (req, res) => {
  const s = req.params.symbol.toUpperCase();
  try {
    const co = await getCo(s);
    res.set("Cache-Control", "no-store").json(await packFor(s, co));
  } catch (e) {
    res.status(502).json({ error: `Research pack unavailable for ${s}`, detail: String(e.message || e).slice(0, 120) });
  }
});

/* Valuation lens — the official target method by method, what today's price
   implies (reverse DCF) and where the multiple sits in its own 5-year history. */
const LENS_TTL = 30 * 60 * 1000;
async function buildLens(s, { mode = "market", labDcf = null } = {}) {
  const co = await getCo(s);
  const bundle = await getBundle(s);
  const idcf = mode === "lab" && !labDcf ? await engineDcf(s, co, bundle) : null;
  const [peers, bands, fairValue] = await Promise.all([peerSet(s), buildBands(s).catch(() => null), mode === "lab" ? null : fairValueFor(s, co.price)]);
  const V = valuationFor(co, bundle, idcf, peers, { mode, fairValue, labDcf, bands });
  const ok = (V.methods || []).filter((m) => m.weight > 0);
  const isAnchor = (m) => m.name.startsWith("DCF") || m.name.startsWith("Fair value (");
  const dcfM = ok.find(isAnchor);
  const rel = ok.filter((m) => !isAnchor(m));
  const w = (m) => m.weight;
  const labD = mode !== "lab" ? null : labDcf ? { value: labDcf.target, wacc: labDcf.assumptions.wacc, terminalG: labDcf.assumptions.terminalG, growth: labDcf.assumptions.growthY1_5, terminalShare: labDcf.terminalShare }
    : idcf && !idcf.error ? { value: idcf.target, wacc: idcf.assumptions.wacc, terminalG: idcf.assumptions.terminalG, growth: idcf.assumptions.growthY1_5, terminalShare: idcf.base.terminalShare } : null;
  let reverse = null;
  try { reverse = A.reverseDCF(bundle, co.statements, co.dcf.inputs, co.growth, {}, co.price); } catch { reverse = null; }
  const band = (b) => (b ? { current: b.current, pctile: b.pctile, min: b.min, p25: b.p25, med: b.med, p75: b.p75, max: b.max } : null);
  return {
    symbol: s, currency: co.currency, price: co.price,
    target: V.blended, upside: V.upside,
    basis: mode, targetMethod: V.targetMethod, fairValue: fairValue ? { value: fairValue.value, provider: fairValue.provider, label: fairValue.label, discountPct: fairValue.discountPct } : null,
    methods: [...(dcfM ? [dcfM] : []), ...rel].map((m) => ({ name: m.name, value: m.value, weight: w(m), note: m.note })),
    dcf: labD,
    reverse: reverse && !reverse.error ? { impliedGrowth: reverse.impliedGrowth, bounded: reverse.impliedGrowthBounded, side: reverse.impliedGrowthSide, impliedWacc: reverse.impliedWacc, waccBounded: reverse.impliedWaccBounded } : null,
    history: { revCagr: co.growth && co.growth.revCagr, revYoy: co.growth && co.growth.revYoy },
    bands: bands && bands.available ? { pe: band(bands.pe), pb: band(bands.pb) } : null,
    street: co.street ? { target: co.street.targetMean, rec: co.street.rec, analysts: co.street.analysts } : null,
  };
}
router.get("/company/:symbol/valuation-lens", async (req, res) => {
  const s = req.params.symbol.toUpperCase(), mode = dcfModeOf(req);
  try { res.json(await cachedDurable(`lens2:${mode}:${s}`, LENS_TTL, () => buildLens(s, { mode }))); }
  catch (e) { res.status(502).json({ error: "valuation lens unavailable", detail: String(e.message || e).slice(0, 120) }); }
});
/* lab basis with the user's own Modeling Lab result (not cached — it is theirs) */
router.post("/company/:symbol/valuation-lens", express.json(), async (req, res) => {
  const s = req.params.symbol.toUpperCase();
  try { res.json(await buildLens(s, { mode: "lab", labDcf: labDcfFrom(req.body) })); }
  catch (e) { res.status(502).json({ error: "valuation lens unavailable", detail: String(e.message || e).slice(0, 120) }); }
});

/* Peers from filings — each listed peer's latest quarter as filed with the
   exchange (XBRL), for a like-for-like quarterly comparison. On demand. */
const PEERQ_TTL = 6 * 60 * 60 * 1000;
async function buildPeerQuarters(s) {
  const peers = (await peerSet(s)).filter((p) => /\.(NS|BO)$/i.test(p.symbol || ""));
  const rows = [];
  // sequential (NSE throttles bursts); a peer whose filings do not come back is retried once
  const read = async (sym) => (await quarterlyResults(sym, 5).catch(() => null)) || (await new Promise((r) => setTimeout(r, 1200)), await quarterlyResults(sym, 5).catch(() => null));
  for (const p of peers.slice(0, 7)) {
    const q = await read(p.symbol);
    const L = q && q.quarters && q.quarters[0];
    if (!L) { rows.push({ symbol: p.symbol, name: p.name, isSelf: p.symbol === s, available: false }); continue; }
    const ap = (L.expenses || []).find((e) => /advertis|promotion/i.test(e.label));
    rows.push({
      symbol: p.symbol, name: p.name, isSelf: p.symbol === s, available: true, scope: q.scope, label: L.label, qe: L.qe, filed: L.filed,
      revenue: L.pl.revenue, revenueYoy: L.yoy && L.yoy.revenue, grossMargin: L.derived.grossMargin, grossMarginYoyBps: L.yoy && L.yoy.grossMarginBps,
      ebitdaMargin: L.derived.ebitdaMargin, ebitdaMarginYoyBps: L.yoy && L.yoy.ebitdaMarginBps, pat: L.pl.pat, patYoy: L.yoy && L.yoy.pat,
      apPct: ap && L.pl.revenue ? (ap.value / L.pl.revenue) * 100 : null,
    });
  }
  // an all-failed read is an exchange outage, not an answer — never cache it
  if (!rows.some((r) => r.available)) throw new Error("exchange filings unavailable — try again shortly");
  return { symbol: s, asOf: new Date().toISOString(), rows };
}
router.get("/company/:symbol/peer-quarters", async (req, res) => {
  const s = req.params.symbol.toUpperCase();
  const key = `peerq3:${s}`;
  // a retry re-reads only when the cached answer has peers whose filing did not come back
  // (successful XBRL reads are cached per filing, so the re-read is cheap)
  if (req.query.retry === "1") { const hit = cacheGet(key); if (hit && hit.rows && hit.rows.some((r) => !r.available)) cacheSet(key, null, -1); }
  try { res.set("Cache-Control", "no-store").json(await cachedDurable(key, PEERQ_TTL, () => buildPeerQuarters(s))); }
  catch (e) { res.status(502).json({ error: "peer quarters unavailable", detail: String(e.message || e).slice(0, 120) }); }
});

/* Company Research Pack · Layer 2 — management commentary, guidance and deals
   read from the primary documents. POST starts (or joins) the reading, GET
   reports progress; the reads are shared with report generation. */
async function docsContext(s) {
  const co = await getCo(s);
  const peers = await peerSet(s).catch(() => []);
  return {
    meta: { symbol: s, name: co.name, date: new Date().toISOString().slice(0, 10), exchange: co.exchange, sector: co.profile.sector, industry: co.profile.industry, currency: co.currency },
    data: { profile: co.profile, peers },
  };
}
router.post("/company/:symbol/deep", async (req, res) => {
  const s = req.params.symbol.toUpperCase();
  try { res.set("Cache-Control", "no-store").json(documentsFor(await docsContext(s))); }
  catch (e) { res.status(502).json({ error: "document reading unavailable", detail: String(e.message || e).slice(0, 120) }); }
});
router.get("/company/:symbol/deep", async (req, res) => {
  const s = req.params.symbol.toUpperCase();
  try { res.set("Cache-Control", "no-store").json(documentsFor(await docsContext(s), { start: false })); }
  catch (e) { res.status(502).json({ error: "document reading unavailable", detail: String(e.message || e).slice(0, 120) }); }
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

/* Report generation: computed pack + narrative layer → structured report JSON. */
router.post("/report", express.json(), async (req, res) => {
  const { symbol, type = "Initiating Coverage", _idcfSnapshot, ai = true, useLabDcf = false } = req.body || {};
  // DCF policy: the Modeling Lab DCF enters the report only when the user switched it on
  const mode = useLabDcf === true ? "lab" : "market";
  if (!symbol) return res.status(400).json({ error: "symbol required" });
  try {
    const co = await getCo(symbol);
    const bundle = await getBundle(symbol);
    const ratiosFlat = Object.fromEntries(co.ratios.map((r) => [r.name, r.value]));

    // ── Prefer idcf from valuationModelState snapshot (user-adjusted assumptions)
    //    Fall back to server-computed idcf only if no snapshot was sent.
    const fromLab = mode === "lab" && _idcfSnapshot?.idcf && !_idcfSnapshot.idcf.error;
    const idcf = mode !== "lab" ? null : fromLab ? _idcfSnapshot.idcf : await engineDcf(symbol.toUpperCase(), co, bundle);
    const fairValue = mode === "lab" ? null : await fairValueFor(symbol.toUpperCase(), co.price);

    // forensic / earnings-quality scores
    const forensic = A.forensicScores(bundle, co.statements);

    // peers — the same set the Equity Research valuation panel uses; the research
    // pack (exchange filings) is shared with the workstation and usually cached
    const [peers, researchPack, earnSum, rBands] = await Promise.all([
      peerSet(symbol), packFor(symbol.toUpperCase(), co).catch(() => null),
      cached(`earnsum:${symbol.toUpperCase()}`, STATIC_TTL, () => F.earningsSummary(symbol.toUpperCase())).catch(() => null),
      buildBands(symbol.toUpperCase()).catch(() => null),
    ]);
    const consensus = compactConsensus(earnSum, co);

    const target = idcf && !idcf.error ? idcf.target : null;   // DCF value — lab basis only
    const upside = target && co.price ? (target / co.price - 1) * 100 : null;
    // the ONE official target — identical to the Equity Research valuation panel and the
    // report's valuation table: lab basis 40% DCF + 60% relative; market basis relative
    // methods (+ a published fair value at 40% where one exists)
    const valuation = valuationFor(co, bundle, idcf, peers, { mode, fairValue, bands: rBands });
    const officialTarget = valuation.blended ?? target;
    const officialUpside = officialTarget && co.price ? (officialTarget / co.price - 1) * 100 : null;

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
      valuationBasis: mode, targetMethod: valuation.targetMethod,
      summary: co.profile.summary.slice(0, 900),
      targetPrice: officialTarget,
      consensus: consensus && consensus.stats && consensus.stats.quarters ? { beats: consensus.stats.beats, quarters: consensus.stats.quarters } : null,
    };
    const narrative = await generateNarrative(pack, type);

    const blendedTarget = officialTarget;
    const blendedUpsidePct = officialUpside;

    // ── deterministic report — the source of truth, built exactly as before ──
    const report = {
      meta: {
        symbol, name: co.name, type, date: new Date().toISOString().slice(0, 10),
        price: co.price, currency: co.currency, sector: co.profile.sector, industry: co.profile.industry,
        exchange: co.exchange, analyst: "M-Terminal Research Engine",
        target: blendedTarget, upside: blendedUpsidePct, dcfTarget: target, dcfUpside: upside,
        recommendation: narrative.recommendation, mode: narrative.mode, unitNote: currencyUnit(co.currency),
        targetMethod: valuation.targetMethod || (target != null ? "DCF (Modeling Lab)" : null),
        valuationBasis: mode,
        fairValue: fairValue ? { value: fairValue.value, provider: fairValue.provider, label: fairValue.label, discountPct: fairValue.discountPct } : null,
        valuationSource: mode === "lab"
          ? (fromLab ? "Modeling Lab DCF (switched on by the user)" : "Modeling Lab DCF (default assumptions)")
          : `Market-based methods${fairValue ? ` + ${fairValue.provider} fair value` : ""} (Modeling Lab DCF not switched on)`,
        vmsModelStatus: _idcfSnapshot?.modelStatus ?? null,
        vmsLastRecalcAt: _idcfSnapshot?.lastRecalcAt ?? null,
      },
      narrative,
      data: {
        growth: co.growth, variance: co.variance, ratios: co.ratios, series: co.series,
        idcf, statements: co.statements, quarterly: co.quarterly, street: co.street,
        holders: co.holders, keyStats: co.keyStats, peers, profile: co.profile, forensic, valuation, moat: co.moat, pack: compactPack(researchPack), consensus,
        evidence: mode === "lab" ? (_idcfSnapshot?.evidence ?? null) : null,  // DCF evidence — lab basis only
      },
    };

    // ── fact-checker: cross-section consistency of the deterministic report
    try { report.qa = runChecks(report); } catch (e) { report.qa = null; }

    // management commentary, guidance and deals already read from the filings
    // (Equity Research or an earlier report) — from cache only, no model call
    try {
      const d = documentsFor(report, { start: false });
      if (d && d.count) report.data.documents = { readAt: d.readAt, items: d.items };
    } catch { }

    // ── Research layer — reads `report`, never alters it. The deterministic
    // report is returned now; cached research is attached, otherwise a
    // background research job is started and its id returned for polling.
    let research = null, researchJob = null, researchStatus = { available: false, reason: "skipped" };
    if (ai !== false) {
      try {
        const r = researchForReport(report);
        research = r.research || null; researchJob = r.job || null; researchStatus = r.status || { available: false, running: !!r.job };
      } catch { researchStatus = { available: false, reason: "research layer error" }; }
    }
    res.json({ ...report, research, researchJob, researchStatus });
  } catch (e) {
    res.status(502).json({ error: "Report generation failed", detail: String(e.message || e).slice(0, 160) });
  }
});

/* research job status — polled by the report page until the researched
   sections arrive (status: running | done | partial | failed) */
router.get("/report/research/:id", (req, res) => {
  const j = jobStatus(req.params.id);
  if (!j) return res.status(404).json({ error: "Unknown or expired research job" });
  res.set("Cache-Control", "no-store");
  res.json(j);
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
    const co = await getCo(symbol);
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
/* ── DCF assumption plan (server/lib/dcfAssumptions.js) ──────────────────────
   The self-built default behind every engine DCF: consensus, history, peers,
   a regression beta against the local index, the live 10-year sovereign yield,
   forensic and moat signals → year-by-year drivers with their rationale. */
const DA = require("../lib/dcfAssumptions");
const DcfAI = require("../lib/dcfAI");
const PLAN_TTL = 6 * 60 * 60 * 1000;
const INDEX_OF = { IN: "^NSEI", US: "^GSPC", GB: "^FTSE", EU: "^STOXX50E", JP: "^N225" };
const RF_BOND = { IN: "IN", US: "US", GB: "GB", EU: "DE", JP: "JP" };
/* OLS beta of 3 years of weekly returns against the local index (cached a day) */
function regressionBetaFor(symbol, indexSym) {
  return cachedDurable(`beta3y:${symbol}:${indexSym}`, 24 * 60 * 60 * 1000, async () => {
    const [a, b] = await Promise.all([Y.getHistory(symbol, "5y", "1wk"), Y.getHistory(indexSym, "5y", "1wk")]);
    const r = DA.regressionBeta((a && a.points) || [], (b && b.points) || []);
    return r ? { raw: r.raw, n: r.n } : { none: true };
  }).then((r) => (r && !r.none ? r : null)).catch(() => null);
}
async function usdPerUnit(ccy) {
  if (!ccy || ccy === "USD") return 1;
  const sub = { GBp: ["GBP", 0.01], ZAc: ["ZAR", 0.01], ILA: ["ILS", 0.01] }[ccy] || [ccy, 1];
  const r = await cached(`fxusd:${sub[0]}`, 6 * 60 * 60 * 1000, async () => { const q = await F.batchQuotes([`${sub[0]}USD=X`]); return q[0] && q[0].regularMarketPrice; }).catch(() => null);
  return r ? r * sub[1] : null;
}
function planFor(symbol, co, bundle) {
  return cachedDurable(`dcfplan:v8:${symbol}`, PLAN_TTL, async () => {
    const mk = DA.marketOf(co.currency, co.exchange), idx = INDEX_OF[mk] || null;
    const macro = require("./macro");
    const [peers, consensus, rates, fx, own] = await Promise.all([
      peerSet(symbol).catch(() => []),
      cached(`earnsum:${symbol}`, STATIC_TTL, () => F.earningsSummary(symbol)).catch(() => null),
      macro.buildRates ? macro.buildRates().catch(() => null) : null,
      usdPerUnit(co.currency),
      idx ? regressionBetaFor(symbol, idx) : null,
    ]);
    const peerRows = (peers || []).slice(1);
    const peerBetas = idx ? await Promise.all(peerRows.slice(0, 6).map((p) => regressionBetaFor(p.symbol, idx).then((b) => (b ? b.raw : null)))) : [];
    let bond = rates && rates.bonds ? rates.bonds.find((b) => b.cc === RF_BOND[mk] && /10/.test(b.label) && b.available) : null;
    if (!bond && mk === "US") {   // Yahoo ^TNX when the Stooq feed is down
      const t = await F.batchQuotes(["^TNX"]).catch(() => []);
      if (t[0] && t[0].regularMarketPrice) bond = { yield: t[0].regularMarketPrice, label: "US 10Y", date: new Date(t[0].regularMarketTime || Date.now()).toISOString().slice(0, 10), src: "Yahoo ^TNX" };
    }
    const lb = co.statements.balance.at(-1) || {};
    const totalDebt = lb.totalDebt > 0 ? lb.totalDebt : (lb.ltDebt || 0) + (lb.stDebt || 0);
    const plan = DA.buildPlan({
      symbol, st: co.statements, currency: co.currency, exchange: co.exchange, sector: co.profile && co.profile.sector, industry: co.profile && co.profile.industry,
      price: co.price, sharesOut: co.dcf.inputs.sharesOut, netDebt: co.dcf.inputs.netDebt, totalDebt,
      consensus, peers: peerRows, forensic: A.forensicScores(bundle, co.statements), moat: co.moat,
      rf: bond ? { value: bond.yield, source: `${bond.label} government bond yield (${bond.src || "Stooq"}, ${bond.date})`, asOf: bond.date } : null,
      ...(() => {
        // ROIC on all invested capital, and on operating capital (acquired goodwill and
        // intangibles excluded) — new capital is spent on operations, not on acquisitions
        const li = co.statements.income.at(-1) || {}, e = li.ebit ?? li.opIncome;
        const t = li.pretax > 0 && li.tax != null ? Math.min(Math.max(li.tax / li.pretax, 0), 0.45) : 0.25;
        const ic = (lb.equity || 0) + totalDebt - (lb.cash || 0), icOp = ic - (lb.goodwill || 0) - (lb.intangibles || 0);
        const nopat = e != null ? e * (1 - t) : null;
        // operating capital at or below zero (goodwill and brands exceed the equity, negative working
        // capital) means returns on operating capital are effectively unbounded — the plan caps them
        return { roic: nopat != null && ic > 0 ? (nopat / ic) * 100 : null, roicExGoodwill: nopat != null && nopat > 0 ? (icOp > 0 ? (nopat / icOp) * 100 : 999) : null };
      })(),
      beta: own ? { raw: own.raw, n: own.n, source: `${own.n} weekly returns vs ${DA.MARKET[mk].idx}` } : null,
      peerBetas, usdPerUnit: fx,
    });
    if (!plan) throw new Error("plan unavailable");
    return plan;
  });
}
/* engine inputs: the pack's share count / net debt / price + the plan's drivers */
async function engineInputs(symbol, co, bundle) {
  const plan = await planFor(symbol, co, bundle).catch(() => null);
  const eng = DA.planToEngine(plan);
  const base = { ...co.dcf.inputs, currentPrice: co.price ?? co.dcf.inputs.currentPrice };
  const dcfIn = eng ? { ...base, ...eng, rationale: { ...base.rationale, ...eng.rationale, note: "Plan-driven WACC — see the assumption table" } } : base;
  return { dcfIn, plan };
}
/* the engine-default DCF (plan-driven) — what every lab-basis view uses without user edits */
async function engineDcf(symbol, co, bundle, ov = {}) {
  const { dcfIn } = await engineInputs(symbol, co, bundle);
  return A.institutionalDCF(bundle, co.statements, dcfIn, co.growth, ov);
}

async function buildInstitutionalDCF(symbol, overrides = {}, opts = {}) {
  const co = await getCo(symbol);
  const bundle = await getBundle(symbol);
  const { dcfIn: planIn, plan } = await engineInputs(symbol, co, bundle);
  const dcfIn = { ...planIn };
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
    if (k === "forecastHorizon") return +overrides[k] !== (dcfIn.horizon || 5); // default: the plan's horizon
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
    reverse, tornado, plan,
    // the same forecast under seven terminal-value methods (matches the Excel Terminal Value sheet)
    tvCheck: idcf && !idcf.error ? A.tvCrossCheck(idcf, A.tradingMultiples(co.statements, idcf)) : null,
    // deterministic key-assumptions note — always available; AI only corroborates on top
    commentary: (() => { try { return require("../lib/dcfCommentary").commentary(plan, idcf, { name: co.name, currencySymbol: co.currency === "INR" ? "₹" : co.currency === "USD" ? "$" : "", tornado }); } catch { return null; } })(),
    // analyst commentary on the default plan — started once per plan, cached; never alters a number
    planAI: (() => { try { const r = DcfAI.ensure(plan, { name: co.name, symbol, sector: co.profile.sector }, { start: opts.ai !== false }); return { key: r.key || null, status: r.status, reason: r.reason || null, result: r.result || null }; } catch { return { status: "off" }; } })(),
    assumptionsUsed: { ...dcfIn, paths: undefined },
    evidence,
  };
}

router.get("/idcf-rationale/:key", (req, res) => {
  const k = String(req.params.key || "").replace(/[^a-f0-9]/g, "").slice(0, 24);
  res.set("Cache-Control", "no-store").json(DcfAI.status(k));
});
router.get("/idcf/:symbol", async (req, res) => {
  try { res.json(await buildInstitutionalDCF(req.params.symbol.toUpperCase())); }
  catch (e) { res.status(502).json({ error: "DCF build failed", detail: String(e.message || e).slice(0, 160) }); }
});
router.post("/idcf/:symbol", express.json(), async (req, res) => {
  try { res.json(await buildInstitutionalDCF(req.params.symbol.toUpperCase(), req.body || {})); }
  catch (e) { res.status(502).json({ error: "DCF build failed", detail: String(e.message || e).slice(0, 160) }); }
});

/* Excel export — the template-based DCF workbook (server/lib/dcf-export). Everything the
   Modeling Lab shows is rebuilt from the same engine run with the user's overrides, so the
   workbook reconciles to the screen; the legacy ExcelJS workbook is the fallback. */
async function buildDcfExportPayload(symbol, body = {}) {
  const co = await getCo(symbol);
  const bundle = await getBundle(symbol);
  // The IDCF rebuild honours the user's horizon, terminal method and exit multiple; they are
  // read from userOverrides and, for older clients, from uiState.
  const ui = body.uiState || {};
  const userOv = { ...(body.userOverrides || {}) };
  if (ui.forecastHorizon != null && userOv.forecastHorizon == null) userOv.forecastHorizon = ui.forecastHorizon;
  if (ui.terminalMethod != null && userOv.terminalMethod == null) userOv.terminalMethod = ui.terminalMethod;
  if (ui.exitMultiple != null && userOv.exitMultiple == null) userOv.exitMultiple = ui.exitMultiple;
  if (ui.yearwise && !userOv.yearwise) userOv.yearwise = ui.yearwise;
  if (ui.capitalAllocation && !userOv.capitalAllocation) userOv.capitalAllocation = ui.capitalAllocation;
  const built = await buildInstitutionalDCF(symbol, userOv);
  const idcf = built.idcf && !built.idcf.error ? built.idcf : null;
  const mode = body.dcfMode === "lab" ? "lab" : "market";

  // peers: the comparable-companies panel (custom list or the auto suggestions, up to 10)
  // and the valuation peer set (first 6 suggestions) — the website uses both
  const self = symbol.toUpperCase();
  let panelSyms = Array.isArray(body.peers) && body.peers.length ? body.peers.map((x) => String(x).trim().toUpperCase()) : await F.peerSuggestions(symbol).catch(() => []);
  panelSyms = [...new Set(panelSyms.filter((x) => x && x !== self))].slice(0, 10);
  const [panelRows, valRows, bands, fairValue] = await Promise.all([
    F.pool([self, ...panelSyms], 3, peerRow).then((r) => r.filter((x) => x && !x.error)).catch(() => []),
    peerSet(symbol),
    buildBands(symbol).catch(() => null),
    mode === "lab" ? null : fairValueFor(symbol, co.price),
  ]);
  const labDcf = mode === "lab" && idcf ? { target: idcf.target, terminalShare: idcf.base.terminalShare, assumptions: idcf.assumptions, waccBuild: idcf.waccBuild } : null;
  const valuation = valuationFor(co, bundle, idcf, valRows, { mode, fairValue, labDcf, bands });
  // the inputs multiValuation works from, so the workbook can rebuild every method with formulas
  const sd = bundle.summaryDetail || {}, li = co.statements.income.at(-1) || {}, lb = co.statements.balance.at(-1) || {};
  const rv = (nm) => { const r = (co.ratios || []).find((x) => x.name === nm); return r && r.value != null ? r.value : null; };
  const valInputs = {
    ebitda: li.ebitda || li.opIncome || null, netIncome: li.netIncome ?? null, bookEquity: lb.equity ?? null,
    sharesOut: co.dcf.inputs.sharesOut, netDebt: co.dcf.inputs.netDebt, price: co.price,
    ke: labDcf ? labDcf.waccBuild.costEquity : costEquityOf(co),
    payout: sd.payoutRatio != null && isFinite(sd.payoutRatio) ? sd.payoutRatio : null,
    roe: rv("ROE"), revCagr: co.growth?.revCagr ?? co.growth?.revYoy ?? null,
    divRate: sd.dividendRate ?? sd.trailingAnnualDividendRate ?? (sd.dividendYield && co.price ? sd.dividendYield * co.price : null),
    pe5: bands?.available && bands.pe ? bands.pe.med : null, peNow: bands?.available && bands.pe ? bands.pe.current : null,
    pb5: bands?.available && bands.pb ? bands.pb.med : null, pbNow: bands?.available && bands.pb ? bands.pb.current : null,
    street: co.street || null, fairValue: fairValue || null, isFin: /financial/i.test(co.profile?.sector || ""),
  };
  const monteCarlo = idcf ? A.monteCarlo(idcf, 5000) : null;
  const lastInc = co.statements.income.at(-1) || {};
  return {
    meta: {
      symbol, name: co.name || symbol, currency: co.currency || "INR", exchange: co.exchange || "",
      sector: co.profile?.sector || "", industry: co.profile?.industry || "", country: co.profile?.country || "",
      website: co.profile?.website || "", summary: co.profile?.summary || "", employees: co.profile?.employees ?? null,
      price: co.price ?? idcf?.currentPrice ?? null, lastFyEnd: lastInc.periodEnd || null,
      modelStatus: built.meta?.modelStatus || "Evidence-Based", userOverrides: built.meta?.userOverrides || [],
      builtAt: built.meta?.builtAt || new Date().toISOString(), dcfMode: mode,
    },
    statements: co.statements, growth: co.growth, ratios: co.ratios, moat: co.moat || null,
    idcf, idcfError: built.idcf && built.idcf.error ? built.idcf.error : null,
    dcfIn: built.assumptionsUsed || {}, plan: built.plan || null, planAI: built.planAI || null,
    evidence: built.evidence || null, reverse: built.reverse || null, tornado: built.tornado || null,
    valuation, valInputs, peers: { panel: panelRows, valuation: valRows }, monteCarlo, mcDraws: A.mcDraws(5000),
    // legacy workbook inputs (fallback path)
    legacy: { clientStatements: body.statements || {}, uiState: ui },
  };
}
router.post("/idcf/:symbol/excel", express.json({ limit: "10mb" }), async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  try {
    const p = await buildDcfExportPayload(symbol, req.body || {});
    let buf;
    try {
      if (!p.idcf) throw new Error(p.idcfError || "DCF not available");
      buf = await require("../lib/dcf-export").buildDcfWorkbook(p);
    } catch (e) {
      console.error("Template DCF workbook failed, using the legacy workbook:", e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e);
      buf = await legacyWorkbook(symbol, p);
    }
    const fileName = symbol + "_DCF_Model_" + new Date().toISOString().slice(0, 10) + ".xlsx";
    res.setHeader("Content-Disposition", 'attachment; filename="' + fileName + '"');
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Length", Buffer.byteLength(buf));
    res.send(Buffer.from(buf));
  } catch (e) {
    console.error("Excel export failed:", e);
    res.status(500).json({ error: "Excel export failed", detail: String(e.message || e).slice(0, 240) });
  }
});
/* the previous ExcelJS workbook — kept as the fallback */
async function legacyWorkbook(symbol, p) {
  const { buildWorkbook } = require("../lib/excel-export");
  const cs = p.legacy.clientStatements || {};
  const statements = {
    incomeActuals: cs.incomeActuals || p.statements?.income || [], balanceActuals: cs.balanceActuals || p.statements?.balance || [],
    cashflowActuals: cs.cashflowActuals || p.statements?.cashflow || [], income: cs.income || (p.idcf?.base?.rows || []),
    balance: cs.balance || [], cashflow: cs.cashflow || [], balanceForecast: cs.balance || [], cashflowForecast: cs.cashflow || [],
  };
  return buildWorkbook({
    meta: { symbol, name: p.meta.name, currency: p.meta.currency, price: p.meta.price || 0, sector: p.meta.sector, industry: p.meta.industry, exchange: p.meta.exchange, modelStatus: p.meta.modelStatus, builtAt: p.meta.builtAt },
    idcf: p.idcf || {}, assumptions: p.idcf?.assumptions || {}, evidence: p.evidence || {}, waccBuild: p.idcf?.waccBuild || {},
    statements, uiState: p.legacy.uiState || {}, epsAvailable: cs.epsAvailable !== false, equitySplitAvailable: cs.equitySplitAvailable === true,
  });
}

/* FORENSIC ANALYSIS — full scorecard for the dedicated module. */
async function buildForensic(symbol) {
  const co = await getCo(symbol);
  const bundle = await getBundle(symbol);
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
async function buildRisk(symbol, { mode = "market", labDcf = null } = {}) {
  const co = await getCo(symbol);
  const bundle = await getBundle(symbol);
  const forensic = A.forensicScores(bundle, co.statements);
  let dcf = null;
  if (mode === "lab") {
    const idcf = labDcf ? null : await engineDcf(symbol, co, bundle);
    dcf = labDcf ? { upside: labDcf.upside, terminalShare: labDcf.terminalShare, bear: labDcf.bear, base: labDcf.base, bull: labDcf.bull, label: "The Modeling Lab base-case DCF" }
      : idcf && !idcf.error ? { upside: idcf.upside, terminalShare: idcf.base.terminalShare, bear: idcf.bear ? idcf.bear.perShare : null, base: idcf.base.perShare, bull: idcf.bull ? idcf.bull.perShare : null, label: "The Modeling Lab base-case DCF" } : null;
  } else {
    // market basis: the valuation cushion is measured against the blended fair value
    const [rPeers, rBands, rFv] = await Promise.all([peerSet(symbol), buildBands(symbol).catch(() => null), fairValueFor(symbol, co.price)]);
    const V = valuationFor(co, bundle, null, rPeers, { mode: "market", fairValue: rFv, bands: rBands });
    if (V.blended && co.price) dcf = { upside: (V.blended / co.price - 1) * 100, terminalShare: null, bear: null, base: V.blended, bull: null, label: "The market-based fair value" };
  }
  const risk = A.riskAssessment({
    ratios: co.ratios, forensic, dcf, growth: co.growth, variance: co.variance,
    beta: co.keyStats.beta, price: co.price, sector: co.profile.sector,
  });
  return { meta: { symbol, name: co.name, currency: co.currency, sector: co.profile.sector, price: co.price, unitNote: currencyUnit(co.currency) }, risk };
}
router.get("/risk/:symbol", async (req, res) => {
  try { res.json(await buildRisk(req.params.symbol.toUpperCase(), { mode: dcfModeOf(req) })); }
  catch (e) { res.status(502).json({ error: "Risk build failed", detail: String(e.message || e).slice(0, 160) }); }
});
router.post("/risk/:symbol", express.json(), async (req, res) => {
  try { res.json(await buildRisk(req.params.symbol.toUpperCase(), { mode: dcfModeOf(req), labDcf: labDcfFrom(req.body) })); }
  catch (e) { res.status(502).json({ error: "Risk build failed", detail: String(e.message || e).slice(0, 160) }); }
});

/* MULTI-METHOD VALUATION + MONTE CARLO for the Modeling Lab. */
/* consensus a report carries: EPS surprise record, forward estimates, targets */
function compactConsensus(e, co) {
  if (!e || !e.available) return null;
  const st = co.street || {};
  return {
    next: e.next || null, history: (e.history || []).slice(-4), stats: e.stats || null,
    forward: (e.forward || []).map((x) => ({ period: x.period, label: x.label, endDate: x.endDate, epsAvg: x.epsAvg, epsLow: x.epsLow, epsHigh: x.epsHigh, growthPct: x.growthPct, revenueAvg: x.revenueAvg, revenueGrowthPct: x.revenueGrowthPct, numAnalysts: x.numAnalysts })),
    targets: { mean: st.targetMean ?? null, median: st.targetMedian ?? null, high: st.targetHigh ?? null, low: st.targetLow ?? null, analysts: st.analysts ?? null, rec: st.rec ?? null },
  };
}

/* the part of the research pack a report carries (exhibits + research facts) */
function compactPack(p) {
  if (!p) return null;
  const q = p.quarterly;
  return {
    asOf: p.asOf,
    quarterly: q ? {
      scope: q.scope, bridge: q.bridge,
      quarters: q.quarters.slice(0, 8).map((x) => ({ label: x.label, qe: x.qe, filed: x.filed, audited: x.audited, pl: x.pl, derived: x.derived, expenses: x.expenses, segments: x.segments, yoy: x.yoy, qoq: x.qoq })),
    } : null,
    annualBridge: p.annualBridge,
    shareholding: p.shareholding ? { quarters: p.shareholding.quarters.slice(0, 8), change: p.shareholding.change, pledge: p.shareholding.pledge, detail: p.shareholding.detail || null } : null,
    insiders: p.insiders ? { last12m: p.insiders.last12m } : null,
    calendar: p.calendar ? { upcoming: p.calendar.upcoming, lastResults: p.calendar.lastResults } : null,
  };
}

/* one peer set (self + up to 6 suggested peers) for every relative-valuation view */
async function peerSet(symbol, n = 6) {
  try {
    const syms = await F.peerSuggestions(symbol);
    return [await peerRow(symbol), ...(await Promise.all(syms.slice(0, n).map((s) => peerRow(s).catch(() => null))))].filter(Boolean);
  } catch { return [await peerRow(symbol).catch(() => null)].filter(Boolean); }
}
/* ── DCF policy ────────────────────────────────────────────────────────────
   The Modeling Lab DCF feeds research ONLY when the user switches it on for the
   company (the client sends ?dcf=lab, or { dcfMode:"lab", labDcf } in a POST).
   Otherwise research runs on the MARKET basis: relative methods, plus a
   published third-party fair value where one exists. */
const FV_TTL = 6 * 60 * 60 * 1000;
async function fairValueFor(symbol, price) {
  const v = await cachedDurable(`fv:${symbol}`, FV_TTL, async () => (await F.marketFairValue(symbol, price)) || { none: true }).catch(() => null);
  if (!v || v.none || !price) return null;
  return { ...v, value: price * (1 + v.discountPct / 100) };   // re-anchored to today's price
}
const dcfModeOf = (req) => ((req.query && req.query.dcf === "lab") || (req.body && req.body.dcfMode === "lab") ? "lab" : "market");
/* a Modeling Lab DCF summary sent by the client (the user's own assumptions) */
function labDcfFrom(body) {
  const d = body && body.labDcf; const num = (v) => (v != null && isFinite(+v) ? +v : null);
  if (!d || num(d.target) == null) return null;
  return {
    target: num(d.target), terminalShare: num(d.terminalShare), upside: num(d.upside),
    bear: num(d.bear), base: num(d.base ?? d.target), bull: num(d.bull),
    assumptions: { wacc: num(d.wacc), terminalG: num(d.terminalG), growthY1_5: num(d.growth) },
    waccBuild: { costEquity: num(d.costEquity) },
  };
}
const costEquityOf = (co) => { const r = (co.dcf && co.dcf.inputs && co.dcf.inputs.rationale) || {}; return r.rf != null && r.beta != null && r.erp != null ? r.rf + r.beta * r.erp : null; };
/* the official multi-method valuation. mode "lab" → 40% DCF + 60% relative;
   mode "market" → fair value (if published) 40% + relative 60%, else relative only */
function valuationFor(co, bundle, idcf, peers, { mode = "lab", fairValue = null, labDcf = null, bands = null } = {}) {
  const dcf = mode !== "lab" ? null
    : labDcf || (idcf && !idcf.error ? { target: idcf.target, terminalShare: idcf.base.terminalShare, assumptions: idcf.assumptions, waccBuild: idcf.waccBuild } : null);
  return A.multiValuation({
    bundle, st: co.statements, ratios: co.ratios, growth: co.growth, dcf, peers,
    sharesOut: co.dcf.inputs.sharesOut, netDebt: co.dcf.inputs.netDebt, price: co.price,
    basis: mode, fairValue: mode === "lab" ? null : fairValue, costEquityPct: costEquityOf(co),
    bands: bands && bands.available ? bands : null, street: co.street, sector: co.profile && co.profile.sector,
  });
}

async function buildValuation(symbol, { mode = "market", labDcf = null } = {}) {
  const co = await getCo(symbol);
  const bundle = await getBundle(symbol);
  const idcf = await engineDcf(symbol, co, bundle);
  const fairValue = mode === "lab" ? null : await fairValueFor(symbol, co.price);
  const [vPeers, vBands] = await Promise.all([peerSet(symbol), buildBands(symbol).catch(() => null)]);
  const valuation = valuationFor(co, bundle, idcf, vPeers, { mode, fairValue, labDcf, bands: vBands });
  // Monte Carlo is a Modeling Lab tool on the DCF engine — shown whatever the research basis
  const mc = idcf && !idcf.error ? A.monteCarlo(idcf, 5000) : null;
  return { meta: { symbol, name: co.name, currency: co.currency, price: co.price, unitNote: currencyUnit(co.currency), basis: mode }, valuation, monteCarlo: mc };
}
router.get("/valuation/:symbol", async (req, res) => {
  try { res.json(await buildValuation(req.params.symbol.toUpperCase(), { mode: dcfModeOf(req) })); }
  catch (e) { res.status(502).json({ error: "Valuation build failed", detail: String(e.message || e).slice(0, 160) }); }
});
router.post("/valuation/:symbol", express.json(), async (req, res) => {
  try { res.json(await buildValuation(req.params.symbol.toUpperCase(), { mode: dcfModeOf(req), labDcf: labDcfFrom(req.body) })); }
  catch (e) { res.status(502).json({ error: "Valuation build failed", detail: String(e.message || e).slice(0, 160) }); }
});

/* INDUSTRY ANALYSIS — sector aggregates, market share, Porter's, economics. */
async function buildIndustry(symbol) {
  const co = await getCo(symbol);
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
    const data = await cached(`earnsum:${symbol}`, STATIC_TTL, () => F.earningsSummary(symbol));
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
    try { const co = await getCo(raw); const syms = await F.peerSuggestions(raw); peers = (await Promise.all(syms.slice(0, 6).map((s) => peerRow(s).catch(() => null)))).filter(Boolean); }
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

/* ── Earnings-call transcripts: fetch, extract, analyse, export ───────────
   Extraction uses PDF.js (embedded / CID fonts decode correctly) with page
   marks for citations. The analysis is deterministic; the model-assisted
   modules run once per transcript and are cached (callAI). */
const CallAI = require("../lib/callAI");
const CallStore = require("../lib/callStore");
const TX_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const txWords = (t) => PDF.stripPageMarks(t).split(/\s+/).filter(Boolean).length;
// only public http(s) hosts — a link inside a filing must never reach the server's own network
function publicUrl(u) {
  try {
    const x = new URL(u);
    if (!/^https?:$/.test(x.protocol)) return null;
    if (/^(localhost|0\.|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)|^\[|\.local$|\.internal$/i.test(x.hostname) || !/\./.test(x.hostname)) return null;
    return x.toString();
  } catch { return null; }
}
async function pdfFrom(url) {
  const u = publicUrl(url); if (!u) return null;
  const r = await fetch(u, { headers: { "User-Agent": TX_UA }, signal: AbortSignal.timeout(30000), redirect: "follow" }).catch(() => null);
  if (!r || !r.ok) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  return buf.length <= 25 * 1024 * 1024 && buf.subarray(0, 5).toString("latin1") === "%PDF-" ? buf : null;
}
async function transcriptFromPdf(buf, minWords = 300) {
  const x = await PDF.extractPdf(buf);
  const text = PDF.readableText(PDF.stripBoilerplate(x.text), { minWords });
  return { text, pages: x.pages, links: x.links, engine: x.engine, raw: x.text };
}
// cover letters point to the transcript on the company website — collect those links
function linksIn(x) {
  const flat = PDF.stripPageMarks(x.raw || "").replace(/\s*\n\s*/g, "");
  // a wrapped URL is re-joined with the next word ("…call.pdfKindly") — a PDF link ends at ".pdf"
  const pdfs = flat.match(/https?:\/\/[^\s"'<>]+?\.pdf/gi) || [];
  return [...new Set([...(x.links || []), ...pdfs, ...(flat.match(/https?:\/\/[^\s"'<>]+/gi) || [])])].map((u) => u.replace(/[).,;]+$/, ""));
}

router.get("/earnings/nse-transcript/:symbol", async (req, res) => {
  const s = req.params.symbol.toUpperCase();
  if (!/\.(NS|BO)$/.test(s)) return res.status(400).json({ error: "Exchange transcripts are available for NSE/BSE-listed companies (e.g. MARICO.NS)." });
  const today = new Date().toISOString().slice(0, 10);
  try {
    const out = await cachedDurable(`nsetx3:${s}:${today}`, 12 * 60 * 60 * 1000, async () => {
      const f = await nseFilings(s, today);
      if (!f) throw Object.assign(new Error("The exchange did not return the company filings — try again shortly."), { status: 502 });
      const calls = f.filter((x) => x.kind === "call" && x.url && /\.pdf$/i.test(x.url)).slice(0, 4);
      if (!calls.length) throw Object.assign(new Error("No earnings-call transcript was filed with the exchange in the last year."), { status: 404 });
      const notes = [];
      for (const t of calls) {
        const buf = await pdfFrom(t.url);
        if (!buf) { notes.push(`The ${t.date} filing could not be downloaded.`); continue; }
        const x = await transcriptFromPdf(buf);
        if (x.text && txWords(x.text) >= 1200) return { symbol: s, date: t.date, url: t.url, title: t.category, text: x.text, pages: x.pages, words: txWords(x.text), notice: notes.length ? notes.join(" ") + ` Showing the transcript filed on ${t.date}.` : null };
        // a cover letter: follow a direct PDF link to the transcript on the company's website
        const links = linksIn(x), pdfLink = links.find((u) => /\.pdf(\?|$)/i.test(u) && publicUrl(u));
        if (pdfLink) {
          const b2 = await pdfFrom(pdfLink);
          const y = b2 ? await transcriptFromPdf(b2) : null;
          if (y && y.text && txWords(y.text) >= 1200) return { symbol: s, date: t.date, url: pdfLink, filingUrl: t.url, title: t.category, text: y.text, pages: y.pages, words: txWords(y.text), notice: `The exchange filing of ${t.date} is a cover letter; the transcript was read from the company's website.` };
        }
        const site = links.find((u) => publicUrl(u) && !/^mailto:/i.test(u));
        notes.push(`The ${t.date} filing is only a cover letter${site ? ` pointing to ${site}` : ""}.`);
      }
      throw Object.assign(new Error(`${notes.join(" ")} No transcript text could be read from the exchange filings — paste it or import the PDF from the company's website.`), { status: 422 });
    });
    res.json(out);
  } catch (e) {
    res.status(e.status || 502).json({ error: String((e && e.message) || e).slice(0, 300) });
  }
});

router.post("/earnings/extract-pdf", express.json({ limit: "30mb" }), async (req, res) => {
  try {
    const b64 = (req.body && req.body.pdf) || "";
    if (!b64) return res.status(400).json({ error: "No PDF provided." });
    const buf = Buffer.from(b64, "base64");
    if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") return res.status(400).json({ error: "That does not look like a PDF file." });
    const x = await transcriptFromPdf(buf, 60);
    if (!x.text) return res.status(422).json({ error: "Could not extract usable text — this looks like a scanned/image PDF. Paste the text instead." });
    res.json({ text: x.text, pages: x.pages, words: txWords(x.text), engine: x.engine });
  } catch (e) {
    res.status(500).json({ error: "PDF extraction failed: " + String((e && e.message) || e).slice(0, 120) });
  }
});

/* one analysis path for the dashboard and the DOCX export */
async function analyseTranscript(transcript, symbol, { withPeers = false } = {}) {
  const clean = PDF.stripBoilerplate(transcript);
  const text = clean.length >= 100 ? clean : transcript;
  const SYM = symbol ? String(symbol).toUpperCase() : null;
  const [summary, co, peers] = await Promise.all([
    SYM ? cached(`earnsum:${SYM}`, STATIC_TTL, () => F.earningsSummary(SYM)).catch(() => null) : null,
    SYM ? getCo(SYM).catch(() => null) : null,
    SYM && withPeers ? F.peerSuggestions(SYM).then((syms) => Promise.all(syms.slice(0, 6).map((x) => peerRow(x).catch(() => null)))).then((r) => r.filter(Boolean)).catch(() => []) : [],
  ]);
  const meta = { symbol: SYM, company: (co && co.name) || (summary && summary.name) || null, sector: co && co.profile ? [co.profile.sector, co.profile.industry].filter(Boolean).join(" › ") : null, currency: (summary && summary.currency) || (co && co.currency) || null };
  const analysis = E.analyzeTranscript(text, meta, peers);
  if (analysis.error) return { error: analysis.error };
  // context store: last call's guidance → revisions and credibility; then remember this call
  if (SYM && analysis.meta.period) { CallStore.applyPrior(analysis, CallStore.prior(SYM, analysis.meta.period)); CallStore.save(SYM, analysis.meta.period, analysis); }
  return { analysis, summary, text };
}

router.post("/earnings/analyze", express.json({ limit: "4mb" }), async (req, res) => {
  const { transcript, symbol } = req.body || {};
  if (!transcript || transcript.length < 100) return res.status(400).json({ error: "Provide an earnings-call transcript (at least a few paragraphs)." });
  try {
    const r = await analyseTranscript(transcript, symbol, { withPeers: true });
    if (r.error) return res.status(400).json({ error: r.error });
    // model-assisted modules: cached per transcript, otherwise started in the background
    const ai = CallAI.ensure(r.text, r.analysis);
    r.analysis.ai = ai.result || null;
    res.json({ meta: { source: "pasted", symbol: symbol || null }, analysis: r.analysis, summary: r.summary, ai: { key: ai.key, status: ai.status, reason: ai.reason || null } });
  } catch (e) {
    res.status(500).json({ error: "Analysis failed: " + String((e && e.message) || e).slice(0, 140) });
  }
});
// poll the model-assisted modules for a transcript
router.get("/earnings/ai/:key", (req, res) => {
  if (!/^[a-f0-9]{24}$/.test(req.params.key)) return res.status(400).json({ error: "bad key" });
  res.set("Cache-Control", "no-store").json(CallAI.status(req.params.key));
});

// .docx research report — the same analysis, plus the AI modules when available
router.post("/earnings/report.docx", express.json({ limit: "4mb" }), async (req, res) => {
  const { transcript, symbol } = req.body || {};
  if (!transcript || transcript.length < 100) return res.status(400).json({ error: "Provide a transcript to build the report." });
  try {
    const r = await analyseTranscript(transcript, symbol);
    if (r.error) return res.status(400).json({ error: r.error });
    const ai = CallAI.ensure(r.text, r.analysis);
    let aiResult = ai.result || null;
    if (!aiResult && ai.promise) aiResult = await Promise.race([ai.promise, new Promise((ok) => setTimeout(() => ok(null), 75_000))]);
    r.analysis.ai = aiResult;
    const buf = await buildDocx(r.analysis, r.summary, { symbol: symbol || null, name: r.analysis.meta.company || (r.summary ? r.summary.name : null) });
    const fname = `${(symbol || r.analysis.meta.company || "earnings").replace(/[^A-Za-z0-9.\-]/g, "_")}_${(r.analysis.meta.period || "call").replace(/\s+/g, "")}_earnings_call_analysis.docx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: "Report generation failed: " + String((e && e.message) || e).slice(0, 140) });
  }
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
    const co = await getCo(symbol);
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
    const fname = `M-TERMINAL_${symbol.replace(/[^A-Z0-9.]/g, "")}_Research_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
    res.send(Buffer.from(buf));
  } catch (e) {
    res.status(502).json({ error: "Workbook build failed", detail: String(e.message || e).slice(0, 160) });
  }
});

/* ASSISTANT — the floating help / research chat (server/lib/assistant.js).
   Ready-made questions are answered from the platform's own figures without AI; "ask
   anything" runs a budgeted Gemini chat grounded in the same fact pack. */
const Assistant = require("../lib/assistant");
const ASSIST_TTL = 20 * 60 * 1000;
const assistSym = (x) => { const v = String(x || "").toUpperCase().replace(/[^A-Z0-9.\-^&=]/g, "").slice(0, 24); return v || null; };
const assistMode = (x) => (x === "lab" ? "lab" : "market");
/* price change over 1 / 3 / 12 months, for the stock and its local index */
async function assistantMoves(symbol, co) {
  const idx = INDEX_OF[DA.marketOf(co.currency, co.exchange)] || null;
  const [a, b] = await Promise.all([Y.getHistory(symbol, "1y", "1d").catch(() => null), idx ? Y.getHistory(idx, "1y", "1d").catch(() => null) : null]);
  const ret = (h, d) => { const p = (h && h.points) || []; if (p.length < 2) return null; const l = p.at(-1).c, o = p[Math.max(0, p.length - 1 - d)].c; return o ? +(((l / o) - 1) * 100).toFixed(1) : null; };
  if (!a) return null;
  return { m1: ret(a, 21), m3: ret(a, 63), m12: ret(a, 400), index: idx ? { "^NSEI": "Nifty 50", "^GSPC": "S&P 500", "^FTSE": "FTSE 100", "^STOXX50E": "Euro Stoxx 50", "^N225": "Nikkei 225" }[idx] : null,
    idx1: ret(b, 21), idx3: ret(b, 63), idx12: ret(b, 400) };
}
async function assistantFacts(symbol, mode) {
  if (!symbol) return null;
  const key = `assist:${symbol}:${mode}`;
  const facts = await cached(key, ASSIST_TTL, async () => {
    const co = await getCo(symbol);
    // the filings pack can take a while on first build — wait up to 12 s, then answer without it
    const packWait = Promise.race([packFor(symbol, co).catch(() => null), new Promise((r) => setTimeout(() => r({ __timeout: true }), 12_000))]);
    const [dcf, val, forensic, peers, pack, cons, moves] = await Promise.all([
      buildInstitutionalDCF(symbol, {}, { ai: false }).catch(() => null),   // never starts an AI job
      buildValuation(symbol, { mode }).catch(() => null),
      buildForensic(symbol).catch(() => null),
      peerSet(symbol).catch(() => []),
      packWait,
      cached(`earnsum:${symbol}`, STATIC_TTL, () => F.earningsSummary(symbol)).catch(() => null),
      assistantMoves(symbol, co).catch(() => null),
    ]);
    return Assistant.factPack({ co, dcf, val, forensic, peers, mode, pack, cons, moves });
  });
  // built without the filings pack: keep it briefly so the next open picks the pack up
  if (facts && facts.partial) cacheSet(key, facts, 60 * 1000);
  return facts;
}
const clientIp = (req) => String(req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim().slice(0, 64);
router.get("/assistant/questions", async (req, res) => {
  const s = assistSym(req.query.symbol);
  let F = null; try { F = s ? await assistantFacts(s, assistMode(req.query.dcf)) : null; } catch { F = null; }
  res.set("Cache-Control", "no-store").json({ symbol: F ? F.symbol : null, name: F ? F.name : null, questions: Assistant.questions(F), chatId: Assistant.newChatId(), budget: Assistant.status("") });
});
router.post("/assistant/answer", express.json({ limit: "8kb" }), async (req, res) => {
  const s = assistSym(req.body && req.body.symbol);
  let F = null; try { F = s ? await assistantFacts(s, assistMode(req.body.dcf)) : null; } catch { F = null; }
  const a = Assistant.answer(String((req.body && req.body.id) || ""), F);
  if (!a) return res.status(404).json({ error: "unknown question" });
  res.set("Cache-Control", "no-store").json(a);
});
router.post("/assistant/chat", express.json({ limit: "32kb" }), async (req, res) => {
  const b = req.body || {};
  const chatId = /^[a-f0-9]{18}$/.test(String(b.chatId || "")) ? b.chatId : Assistant.newChatId();
  const s = assistSym(b.symbol);
  let F = null; try { F = s ? await assistantFacts(s, assistMode(b.dcf)) : null; } catch { F = null; }
  const history = Array.isArray(b.history) ? b.history.slice(-4).map((h) => ({ role: h && h.role === "user" ? "user" : "assistant", text: String((h && h.text) || "").slice(0, 300) })) : [];
  try { res.set("Cache-Control", "no-store").json({ chatId, ...(await Assistant.chat({ chatId, ip: clientIp(req), message: b.message, F, history, deep: b.deep === true })) }); }
  catch (e) { res.status(502).json({ error: "assistant unavailable" }); }
});

module.exports = router;
module.exports.buildDcfExportPayload = buildDcfExportPayload;
