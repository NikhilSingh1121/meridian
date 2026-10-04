/**
 * Research layer — traceability, grounding, model fallback and failure isolation.
 * Gemini, NSE and Google News are never called: global fetch and the NSE
 * provider are replaced per test.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
process.env.MERIDIAN_RESEARCH_DIR = path.join(os.tmpdir(), `mt-research-test-${process.pid}`);

const { makeValidator } = require("./insights/validate");
const research = require("./insights/research");
const { sectorProfile } = require("./insights/sector");
const { buildFacts, moatScorecard } = require("./insights/facts");
const gemini = require("./insights/gemini");
const nse = require("../providers/nse");
const { researchForReport, jobStatus } = require("./insights");

const FAKE_KEY = "AQ.TEST_SECRET_should_never_leak_123";
let n = 0;
function report() {
  n++;
  return {
    meta: { symbol: `TEST${n}.NS`, name: `Test Co ${n} Limited`, type: "Initiating Coverage", date: "2026-09-25", price: 819, currency: "INR", sector: "Consumer Defensive", industry: "Household & Personal Products", exchange: "NSE", recommendation: "BUY", target: 695.12, upside: -15.13, dcfTarget: 427.57, dcfUpside: -47.79 },
    narrative: { execSummary: "Existing summary.", thesis: "Existing thesis.", catalysts: ["c1"], risks: ["r1"], compositeScore: 73, factorBreakdown: [], blendedUpside: -15.1 },
    data: {
      statements: {
        income: [{ year: 2025, revenue: 107340e6, grossProfit: 50430e6, ebitda: 23000e6, netIncome: 16290e6 }, { year: 2026, revenue: 135480e6, grossProfit: 56040e6, ebitda: 25170e6, netIncome: 17620e6 }],
        balance: [{ year: 2026, totalDebt: 5570e6, cash: 4040e6, equity: 42100e6 }],
        cashflow: [{ year: 2026, ocf: 20840e6, capex: 3190e6, fcf: 17650e6 }],
      },
      ratios: [{ name: "ROCE", value: 38.75 }, { name: "Net margin", value: 13.16 }, { name: "Debt / Equity", value: 0.12 }, { name: "P/E (TTM)", value: 56.44 }],
      growth: { revYoy: 26.23 }, variance: { commentary: "Revenue grew 26.2%.", drivers: [] },
      peers: [{ name: "Test Co", pe: 56.4, netMargin: 13.2, revGrowth: 21.4, de: 0.12, mcap: 1e12 }],
      idcf: null, forensic: null, holders: { insiders: 59.3, institutions: 30.1 }, keyStats: { mcap: 1.06e12, beta: 0.17 },
      street: { targetMean: 962.67, rec: "buy", analysts: 30 }, profile: { summary: "Consumer products.", website: "https://www.testco.com" },
    },
  };
}

/* ── validator ─────────────────────────────────────────────────────────── */
test("validator · grounding, citations, rating, target, moat and style rules", () => {
  const facts = buildFacts(report());
  const evidence = [{ id: 1, claim: "Revenue from operations was ₹14,211 crore, up 26% YoY", verified: true }];
  const V = makeValidator({ facts, evidence, moatOverall: facts.moat_scorecard.overall, officialTarget: 695.12, streetTarget: 962.67 });
  assert.equal(V.para("Revenue grew 26.2% in the latest year."), "Revenue grew 26.2% in the latest year.", "fact-grounded figure kept");
  assert.equal(V.para("Revenue reached ₹14,211 crore."), "", "evidence-only figure without a citation dropped");
  assert.equal(V.para("Revenue reached ₹14,211 crore [E1]."), "Revenue reached ₹14,211 crore [E1].", "evidence figure with its citation kept");
  assert.equal(V.para("Revenue will reach ₹77,777 crore [E1]."), "", "figure absent from the cited evidence dropped");
  assert.equal(V.para("Management raised guidance [E9]."), "", "unknown evidence id dropped");
  assert.equal(V.para("We recommend a SELL on the stock."), "", "a rating of its own dropped");
  assert.equal(V.para("The stock deserves a target of ₹427.57."), "", "a target other than the official / consensus one dropped");
  assert.equal(V.para("The official target of ₹695.12 blends DCF and consensus."), "The official target of ₹695.12 blends DCF and consensus.");
  assert.equal(facts.moat_scorecard.overall, "Narrow");
  assert.equal(V.para("The company enjoys a wide moat."), "", "moat rating contradicting the scorecard dropped");
  assert.equal(V.para("Interestingly, this is a game changer."), "", "promotional / chatbot phrasing dropped");
  assert.equal(V.para("Revenue grew 26.2% in the latest year. We recommend a SELL."), "Revenue grew 26.2% in the latest year.", "only the offending sentence is removed");
  for (const r of ["ungrounded_figure", "bad_citation", "rating", "target", "moat", "style"]) assert.ok(V.stats.reasons[r] >= 1, `reason counted: ${r}`);
  // grouped citation styles are normalised, not mistaken for missing sources
  assert.equal(V.para("Revenue reached ₹14,211 crore [E1, E1]."), "Revenue reached ₹14,211 crore [E1][E1].");
  assert.equal(V.para("Revenue reached ₹14,211 crore [FACTS, E1]."), "Revenue reached ₹14,211 crore [E1].");
  assert.equal(V.para("Revenue reached ₹77,777 crore [FACTS, E1]."), "", "a grouped citation does not rescue an unsupported figure");
  assert.equal(V.para("The company benefits from wide economic moats."), "", "plural moat wording is checked too");
  assert.equal(V.para("The cash conversion cycle stood at 26.2%."), "", "a % is a conversion ratio, not a cycle");
  // negative figures match their unsigned facts (expected return −15.1%, margin −29 bps)
  assert.equal(V.para("The expected return is -15.1% to the target."), "The expected return is -15.1% to the target.");
});

/* ── evidence traceability ───────────────────────────────────────────── */
const DOCS = [
  { date: "2026-08-04", kind: "results", category: "Outcome of Board Meeting", url: "https://nsearchives.nseindia.com/corporate/test_results.pdf", source: "Test Co — Outcome of Board Meeting (exchange filing)" },
  { date: "2026-08-04", kind: "presentation", category: "Investor Presentation", url: "https://nsearchives.nseindia.com/corporate/test_pres.pdf", source: "Test Co — Investor Presentation (exchange filing)" },
];

test("research · document lines count only for listed, actually-retrieved documents", () => {
  const content = [
    "- doc: D1 | type: company_filing | claim: Consolidated revenue from operations was ₹3,957 crore in Q1 FY27",
    "- doc: D2 | type: investor_presentation | claim: Domestic volume growth was 9%",
    "- doc: D9 | type: company_filing | claim: A buyback of ₹1,000 crore was approved",
    "- date: 2026-08-05 | source: Somewhere | url: https://invented.example.com | claim: Something happened",
    "Some prose the model added.",
  ].join("\n");
  const retrieved = [{ url: DOCS[0].url, ok: true }, { url: DOCS[1].url, ok: false }];
  const { items, dropped } = research.parseDocEvidence(content, DOCS, retrieved, { cutoff: "2026-09-25", pass: "results" });
  assert.equal(items.length, 1, "only D1 — retrieved and listed");
  assert.equal(dropped, 2, "D2 not retrieved, D9 unknown");
  assert.equal(items[0].url, DOCS[0].url, "cited with the code-assigned URL, never a model-written one");
  assert.equal(items[0].date, "2026-08-04", "dated by the filing");
  assert.equal(items[0].tier, 1);
});

test("research · search evidence needs Google grounding support and is cited with the resolved page URL", async () => {
  const grounding = {
    queries: ["test co results"],
    chunks: [{ uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", title: "reuters.com" }],
    supports: [{ text: "Test Co's quarterly profit rose 25% on strong demand", chunks: [0] }],
  };
  const content = [
    "- date: 2026-08-04 | type: news | source: Reuters | url: https://www.reuters.com/made-up | claim: Test Co's quarterly profit rose 25% on strong demand",
    "- date: 2026-08-04 | type: news | source: Reuters | url: https://www.reuters.com/x | claim: An ungrounded statement the model wrote from memory",
    "- date: 2026-12-01 | type: news | source: Reuters | url: https://www.reuters.com/y | claim: Test Co's quarterly profit rose 25% on strong demand",
  ].join("\n");
  const resolve = async (u) => (u.includes("/abc") ? "https://www.reuters.com/business/test-co-q1" : null);
  const { items, dropped } = await research.parseSearchEvidence(content, grounding, { cutoff: "2026-09-25", pass: "results", resolve });
  assert.equal(items.length, 1);
  assert.equal(dropped, 2, "ungrounded line and look-ahead line dropped");
  assert.equal(items[0].url, "https://www.reuters.com/business/test-co-q1", "Google's page, not the model's URL");
  assert.equal(items[0].tier, 2);
});

test("research · filing summaries and headlines become verbatim evidence; boilerplate is skipped", () => {
  const f = research.filingEvidence([
    { date: "2026-06-01", kind: "deal", category: "Acquisition", text: "The Company has acquired a 60% stake in Example Foods Private Limited.", url: "https://nsearchives.nseindia.com/a.pdf", informative: true },
    { date: "2026-08-04", kind: "results", category: "Outcome of Board Meeting", text: "Please find enclosed outcome of the Board Meeting.", url: "https://nsearchives.nseindia.com/b.pdf", informative: false },
  ], "Test Co Limited");
  assert.equal(f.length, 1);
  assert.equal(f[0].claim, "The Company has acquired a 60% stake in Example Foods Private Limited.");
  assert.equal(f[0].pass, "developments");
  const nw = research.newsEvidence([
    { title: "Test Co Q1 profit rises 25%", publisher: "Business Standard", url: "https://news.google.com/rss/articles/x", date: "2026-08-04", scope: "company", tier: 2 },
    { title: "Buy Test Co; target of Rs 1050: Broker", publisher: "Moneycontrol", url: "https://news.google.com/rss/articles/y", date: "2026-08-05", scope: "company", tier: 2 },
    { title: "Peer Co results", publisher: "Reuters", url: "https://news.google.com/rss/articles/z", date: "2026-08-06", scope: "peer", tier: 2 },
  ]);
  assert.deepEqual(nw.map((x) => x.pass), ["results", "industry", "industry"]);
  assert.equal(nw[0].claim, "Test Co Q1 profit rises 25%");
});

test("research · document plan picks the latest results, presentation, transcript and deal filings", () => {
  const plan = research.documentPlan([
    { date: "2026-09-01", kind: "deal", url: "u-deal" },
    { date: "2026-08-11", kind: "call", url: "u-transcript" },
    { date: "2026-08-04", kind: "results", url: "u-q1" },
    { date: "2026-08-04", kind: "press", url: "u-press" },
    { date: "2026-08-04", kind: "presentation", url: "u-pres" },
    { date: "2026-05-05", kind: "results", url: "u-q4" },
    { date: "2026-05-05", kind: "press", url: "u-old-press" },
  ]);
  assert.deepEqual(plan.results.map((x) => x.url), ["u-q1", "u-press", "u-pres"]);
  assert.deepEqual(plan.management.map((x) => x.url), ["u-transcript"]);
  assert.deepEqual(plan.developments.map((x) => x.url), ["u-deal"]);
});

test("sector · business model drives the research KPIs", () => {
  assert.equal(sectorProfile("Financial Services", "Banks - Regional").key, "bank");
  assert.equal(sectorProfile("Technology", "Information Technology Services").key, "it_services");
  assert.equal(sectorProfile("Consumer Defensive", "Household & Personal Products").key, "consumer");
  assert.ok(sectorProfile("Financial Services", "Banks - Regional").kpis.some((k) => /NIM|net interest/i.test(k)));
});

test("facts · moat scorecard mirrors the report's rules", () => {
  assert.equal(moatScorecard([{ name: "ROCE", value: 38.75 }, { name: "Net margin", value: 13.16 }, { name: "Debt / Equity", value: 0.12 }]).overall, "Narrow");
  assert.equal(moatScorecard([{ name: "ROCE", value: 20 }, { name: "Net margin", value: 20 }, { name: "Debt / Equity", value: 0.1 }]).overall, "Wide");
});

/* ── Gemini client ───────────────────────────────────────────────────── */
const origFetch = global.fetch, origWarn = console.warn, origLog = console.log, origAnn = nse.corporateAnnouncements;
let logs = [];
const RSS = `<rss><channel><item><title>Test Co Q1 profit rises 25% - Business Standard</title><link>https://news.google.com/rss/articles/abc</link><pubDate>Tue, 04 Aug 2026 10:00:00 GMT</pubDate><source url="https://www.business-standard.com">Business Standard</source></item></channel></rss>`;
function mock(handler, key = FAKE_KEY) {
  if (key == null) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = key;
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith("https://news.google.com/")) return { ok: true, status: 200, text: async () => RSS };
    if (!u.startsWith("https://generativelanguage.googleapis.com/")) throw new Error(`unexpected fetch ${u}`);
    const body = JSON.parse(opts.body);
    const call = { ...body, _url: u, _model: decodeURIComponent(u.match(/models\/([^:]+):/)[1]), _key: opts.headers["x-goog-api-key"] };
    calls.push(call);
    return handler(call, calls.length);
  };
  logs = []; console.warn = (...a) => logs.push(a.join(" ")); console.log = (...a) => logs.push(a.join(" "));
  return calls;
}
const hdrs = () => ({ get: () => null });
const ok = (text, extra = {}) => ({
  ok: true, status: 200, headers: hdrs(),
  json: async () => ({
    modelVersion: extra.model || "gemini-flash-latest",
    candidates: [{
      content: { parts: [...(extra.thought ? [{ text: extra.thought, thought: true }] : []), { text }] }, finishReason: extra.finish || "STOP",
      ...(extra.urls ? { urlContextMetadata: { urlMetadata: extra.urls.map((u) => ({ retrievedUrl: u, urlRetrievalStatus: "URL_RETRIEVAL_STATUS_SUCCESS" })) } } : {}),
    }],
    usageMetadata: { totalTokenCount: 1000 },
  }),
});
const err = (status, statusStr = "", retrySecs, message = "") => ({
  ok: false, status, headers: hdrs(),
  json: async () => ({ error: { code: status, status: statusStr, message: message || `error for ${FAKE_KEY.slice(0, 3)}`, details: retrySecs ? [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: `${retrySecs}s` }] : [] } }),
});
const isSearch = (c) => (c.tools || []).some((t) => t.google_search);
test.afterEach(() => {
  global.fetch = origFetch; console.warn = origWarn; console.log = origLog; nse.corporateAnnouncements = origAnn;
  delete process.env.GEMINI_API_KEY; delete process.env.GEMINI_SEARCH; delete process.env.GEMINI_MODELS; delete process.env.GEMINI_RESEARCH_BUDGET_S; gemini._resetQuota(); research._resetSearch();
});
test.after(() => { try { fs.rmSync(process.env.MERIDIAN_RESEARCH_DIR, { recursive: true, force: true }); } catch { } });

test("gemini · missing or placeholder key → not configured, no request", async () => {
  const calls = mock(() => { throw new Error("must not be called"); }, "your_gemini_api_key_here");
  assert.equal(gemini.hasKey(), false);
  await assert.rejects(gemini.chat({ messages: [] }), (e) => e.code === "no_key");
  mock(() => { throw new Error("must not be called"); }, null);
  assert.equal(gemini.hasKey(), false);
  assert.equal(calls.length, 0);
});

test("gemini · key only in the x-goog-api-key header; invalid key → auth error, no fallback, key never logged", async () => {
  const calls = mock(() => err(400, "INVALID_ARGUMENT", null, "API key not valid. Please pass a valid API key."));
  await assert.rejects(gemini.chat({ messages: [{ role: "user", content: "hi" }] }), (e) => e.code === "auth" && !String(e.message).includes(FAKE_KEY));
  assert.equal(calls.length, 1);
  assert.equal(calls[0]._key, FAKE_KEY);
  assert.ok(!calls[0]._url.includes(FAKE_KEY), "key never in the URL");
  assert.ok(!JSON.stringify({ ...calls[0], _key: 0 }).includes(FAKE_KEY), "key never in the body");
  assert.ok(!logs.join("\n").includes(FAKE_KEY));
});

test("gemini · request shape: system instruction, thinking level, tools, JSON schema", async () => {
  const calls = mock(() => ok("{}"));
  await gemini.chat({ messages: [{ role: "system", content: "SYS" }, { role: "user", content: "U" }], tools: [{ url_context: {} }], reasoning: "low" });
  await gemini.chat({ messages: [{ role: "user", content: "U" }], schema: { name: "s", schema: { type: "object" } } });
  assert.deepEqual(calls[0].systemInstruction, { parts: [{ text: "SYS" }] });
  assert.deepEqual(calls[0].contents, [{ role: "user", parts: [{ text: "U" }] }]);
  assert.deepEqual(calls[0].tools, [{ url_context: {} }]);
  assert.equal(calls[0].generationConfig.thinkingConfig.thinkingLevel, "low");
  assert.equal(calls[0].generationConfig.responseMimeType, undefined);
  assert.equal(calls[1].tools, undefined);
  assert.equal(calls[1].generationConfig.responseMimeType, "application/json");
  assert.deepEqual(calls[1].generationConfig.responseJsonSchema, { type: "object" });
});

test("gemini · thought parts are never part of the content", async () => {
  mock(() => ok("final answer", { thought: "internal reasoning" }));
  const r = await gemini.chat({ messages: [{ role: "user", content: "U" }] });
  assert.equal(r.content, "final answer");
});

const CHAIN = ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.6-flash", "gemini-3.7-flash", "gemini-3.8-flash", "gemini-3.1-flash-lite"];

test("gemini · model chain follows the configured priority order", () => {
  assert.deepEqual(gemini.MODELS(), CHAIN);
  process.env.GEMINI_MODELS = "a-model, b-model";
  assert.deepEqual(gemini.MODELS(), ["a-model", "b-model"]);
});

test("gemini · a failing model hands over to the next one in the chain", async () => {
  const calls = mock((c) => (c._model === CHAIN[0] ? err(404, "NOT_FOUND") : ok("ok", { model: CHAIN[1] })));
  const r = await gemini.chat({ messages: [] });
  assert.equal(r.fellBack, true);
  assert.deepEqual(calls.map((c) => c._model), CHAIN.slice(0, 2));
});

test("gemini · every model down → walks the whole chain in order, then fails", async () => {
  const calls = mock(() => err(503, "UNAVAILABLE"));
  await assert.rejects(gemini.chat({ messages: [] }), (e) => e.code === "upstream");
  assert.deepEqual(calls.map((c) => c._model).slice(0, 6), CHAIN, "each model once, in priority order");
});

test("gemini · an overloaded model is rested: the next call starts at the next model", async () => {
  const calls = mock((c) => (c._model === CHAIN[0] ? err(503, "UNAVAILABLE") : ok("fine")));
  assert.equal((await gemini.chat({ messages: [] })).fellBack, true);
  assert.equal((await gemini.chat({ messages: [] })).fellBack, true);
  assert.deepEqual(calls.map((c) => c._model), [CHAIN[0], CHAIN[1], CHAIN[1]], "no second attempt on the overloaded model");
});

test("gemini · unusable output (malformed JSON) is retried on the next model", async () => {
  const calls = mock((c) => (c._model === CHAIN[0] ? ok("{ not json") : ok('{"a":1}')));
  const r = await gemini.chat({ messages: [], schema: { name: "x", schema: { type: "object" } } });
  assert.deepEqual(r.json, { a: 1 });
  assert.equal(calls.length, 2);
});

test("gemini · bad request → no fallback (fallback is for infrastructure failures only)", async () => {
  const calls = mock(() => err(400, "INVALID_ARGUMENT"));
  await assert.rejects(gemini.chat({ messages: [] }), (e) => e.code === "bad_request");
  assert.equal(calls.length, 1);
});

test("gemini · rate limit: next model at once; the last model waits once for RetryInfo", async () => {
  let calls = mock((c, i) => (i === 1 ? err(429, "RESOURCE_EXHAUSTED", 30) : ok("fine")));
  assert.equal((await gemini.chat({ messages: [] })).fellBack, true);
  assert.deepEqual(calls.map((c) => c._model), CHAIN.slice(0, 2), "no waiting while other models remain");
  gemini._resetQuota();
  process.env.GEMINI_MODELS = "only-model";
  calls = mock((c, i) => (i === 1 ? err(429, "RESOURCE_EXHAUSTED", 1) : ok("fine")));
  assert.equal((await gemini.chat({ messages: [] })).content, "fine");
  assert.deepEqual(calls.map((c) => c._model), ["only-model", "only-model"]);
});

test("gemini · no search quota → circuit-breaker blocks search calls only, plain calls still run", async () => {
  const calls = mock((c) => (isSearch(c) ? err(429, "RESOURCE_EXHAUSTED") : ok("plain")));
  await assert.rejects(gemini.chat({ messages: [], tools: [{ google_search: {} }] }), (e) => e.code === "quota");
  assert.equal(calls.length, CHAIN.length, "one attempt per model");
  await assert.rejects(gemini.chat({ messages: [], tools: [{ google_search: {} }] }), (e) => e.code === "quota");
  assert.equal(calls.length, CHAIN.length, "no further search requests while blocked");
  assert.equal((await gemini.chat({ messages: [] })).content, "plain");
});

test("gemini · a request past the report's deadline is never sent", async () => {
  const calls = mock(() => ok("late"));
  await assert.rejects(gemini.chat({ messages: [], deadline: Date.now() + 1000 }), (e) => e.code === "time_budget");
  assert.equal(calls.length, 0);
});

test("gemini · blocked output → typed error", async () => {
  mock(() => ok("", { finish: "SAFETY" }));
  await assert.rejects(gemini.chat({ messages: [] }), (e) => e.code === "blocked");
});

/* ── orchestration: background job, cache, failure isolation ─────────── */
async function waitJob(id) {
  for (let i = 0; i < 1500; i++) { const j = jobStatus(id); if (j && j.status !== "running") return j; await new Promise((r) => setTimeout(r, 10)); }
  throw new Error("job did not finish");
}
const RESULTS_PDF = "https://nsearchives.nseindia.com/corporate/testco_results.pdf";
const DEAL_PDF = "https://nsearchives.nseindia.com/corporate/testco_deal.pdf";
function stubFilings(withDeal = false) {
  nse.corporateAnnouncements = async () => [
    ...(withDeal ? [{ date: "2026-09-01", category: "Acquisition", text: "The Company has acquired a 60% stake in Example Foods Private Limited.", url: DEAL_PDF }] : []),
    { date: "2026-08-04", category: "Outcome of Board Meeting", text: "Please find enclosed outcome of the Board Meeting held on August 4, 2026.", url: RESULTS_PDF },
  ];
}
const SYN = {
  financials: { latest_results: { period: "Q1 FY27", rows: [{ metric: "Revenue", value: "₹3,957 crore", change: "+23% YoY", source_ids: [1] }], commentary: ["Quarterly revenue rose 23% [E1]."] }, financial_analysis: { revenue: ["Revenue grew 26.2% in FY2026, and the latest quarter shows revenue of ₹3,957 crore [E1]."], gross_margin: [], ebitda: [], pat: [], cash_flow: [], capital_efficiency: [], balance_sheet: [], divergences: [] }, forensic_context: [] },
  business: { business_overview: ["The company sells branded consumer products."], management: ["Management reported revenue growth of 23% [E1]."], guidance_tracker: [], timeline: [], transactions: [] },
  industry: { industry: ["Demand remained steady."], competitive: ["The company grew faster than most peers."], moat: ["The scorecard's Narrow overall rating reflects margins below the Wide threshold."] },
  valuation: { valuation: ["The valuation embeds sustained premium growth."], thesis_pillars: [{ title: "Core franchise", evidence: "Revenue grew 26.2%.", current_status: "On track.", why_it_matters: "Drives compounding.", what_needs_to_happen: "Margins stabilise.", what_would_challenge: "Input-cost inflation.", source_ids: [] }], catalysts: [], risks: [{ category: "Input-cost", risk: "Raw-material inflation", mechanism: "Compresses gross margin.", financial_consequence: "Lower EBITDA.", evidence: "Gross margin fell.", monitor: "Gross margin", source_ids: [] }] },
  summary: { executive_summary: ["The company enters FY27 with accelerating revenue.", "Recent results show revenue of ₹3,957 crore [E1]. We recommend a SELL."], highlights: [{ h: "Growth", p: "Revenue grew 26.2%." }], investment_summary: ["Business quality is high."], recommendation: ["The framework arrives at BUY on quality and consensus."] },
};
const GROUP = [["FINANCIAL ANALYSIS section", "financials"], ["BUSINESS OVERVIEW and MANAGEMENT", "business"], ["INDUSTRY ANALYSIS, COMPETITIVE", "industry"], ["VALUATION commentary", "valuation"], ["EXECUTIVE SUMMARY, HIGHLIGHTS", "summary"]];
function geminiOk(c) {
  const user = c.contents[0].parts[0].text;
  if (c.generationConfig.responseJsonSchema) return ok(JSON.stringify(SYN[GROUP.find(([k]) => user.includes(k))[1]]));
  if (isSearch(c)) return err(429, "RESOURCE_EXHAUSTED");                    // a free key: no search-grounding quota
  if (user.includes(DEAL_PDF)) return ok("- doc: D1 | type: company_filing | claim: The consideration for the 60% stake was not disclosed", { urls: [DEAL_PDF] });
  return ok("- doc: D1 | type: company_filing | claim: Consolidated revenue from operations was ₹3,957 crore in Q1 FY27, up 23% YoY", { urls: [RESULTS_PDF] });
}

test("pipeline · no key → no job, research reported as not configured", () => {
  mock(() => { throw new Error("must not be called"); }, null);
  const r = researchForReport(report());
  assert.equal(r.research, undefined);
  assert.equal(r.job, undefined);
  assert.equal(r.status.available, false);
});

test("pipeline · filings + headlines + document reading → validated sections; search quota missing is handled; deterministic report untouched", async () => {
  stubFilings();
  process.env.GEMINI_SEARCH = "auto";   // search is off by default (it is billed per request); this test covers it switched on
  const calls = mock(geminiOk);
  const rep = report();
  const before = JSON.stringify(rep);
  const first = researchForReport(rep);
  assert.equal(first.job && first.job.status, "running", "returns at once with a running job");
  const done = await waitJob(first.job.id);
  assert.equal(done.status, "done", JSON.stringify(done.reason));
  const s = done.research.sections;
  assert.equal(s.executive_summary.length, 2);
  assert.ok(!JSON.stringify(s).includes("SELL"), "a rating sentence never survives");
  assert.equal(s.latest_results.rows[0].value, "₹3,957 crore");
  assert.equal(done.research.sources[0].url, RESULTS_PDF, "E1 is the retrieved results filing");
  assert.equal(done.research.meta.mode, "documents", "continued without search grounding");
  assert.equal(done.research.meta.removedBy.rating, 1);
  assert.equal(JSON.stringify(rep), before, "deterministic report object never mutated");
  assert.equal(calls.filter(isSearch).length, 6, "search tried once per model in the chain, then switched off");
  assert.equal(calls.filter((c) => c.generationConfig.responseJsonSchema).length, 6, "five synthesis groups + one expansion of the short executive summary");
  assert.equal(calls.filter((c) => c.contents.length === 3).length, 1, "the expansion replays the draft and asks for the full length");
  const n0 = calls.length;
  const again = researchForReport(rep);
  assert.ok(again.research && again.status.cached, "second request served from cache");
  assert.equal(calls.length, n0, "no new Gemini calls for a cached report");
});

test("pipeline · research failure → job fails cleanly with no content, key never logged", async () => {
  process.env.GEMINI_SEARCH = "off";
  stubFilings();
  mock(() => err(400, "INVALID_ARGUMENT"));
  const r = researchForReport(report());
  const done = await waitJob(r.job.id);
  assert.equal(done.status, "failed");
  assert.equal(done.research, null);
  assert.ok(!logs.join("\n").includes(FAKE_KEY));
});

test("pipeline · a job that fails part-way resumes on retry without re-reading completed documents", async () => {
  process.env.GEMINI_SEARCH = "off";
  stubFilings(true);
  const rep = report();
  // attempt 1: the results document pass succeeds, then every call fails
  let docCalls = 0;
  mock((c) => (!c.generationConfig.responseJsonSchema && ++docCalls === 1 ? geminiOk(c) : err(400, "INVALID_ARGUMENT")));
  const a = await waitJob(researchForReport(rep).job.id);
  assert.equal(a.status, "failed");
  // attempt 2: only the transaction document still needs reading
  const calls = mock(geminiOk);
  const b = await waitJob(researchForReport(rep).job.id);
  assert.equal(b.status, "done");
  const reads = calls.filter((c) => (c.tools || []).some((t) => t.url_context));
  assert.equal(reads.length, 1, "completed pass reused, not re-read");
  assert.ok(reads[0].contents[0].parts[0].text.includes(DEAL_PDF));
  assert.equal(b.research.meta.passes.filter((p) => p.reused).length, 1);
});

test("pipeline · a failed writing group → partial report shown, not cached; progress steps reported", async () => {
  process.env.GEMINI_SEARCH = "off";
  stubFilings();
  mock((c) => (c.generationConfig.responseJsonSchema && c.contents[0].parts[0].text.includes("VALUATION commentary") ? err(400, "INVALID_ARGUMENT") : geminiOk(c)));
  const rep = report();
  const r = researchForReport(rep);
  assert.equal(r.job.steps.length, 11);
  assert.ok(r.job.budget >= 60 && r.job.progress >= 0 && r.job.progress < 1);
  const done = await waitJob(r.job.id);
  assert.equal(done.status, "partial");
  assert.equal(done.progress, 1);
  assert.ok(done.research.sections.executive_summary.length, "completed groups are delivered");
  assert.equal(done.research.sections.valuation.length, 0, "the failed group stays deterministic");
  assert.deepEqual(done.research.meta.failures, [{ group: "valuation", error: "bad_request" }]);
  const again = researchForReport(rep);
  assert.ok(again.job && !again.research, "a partial result is not cached — the next request completes it");
  await waitJob(again.job.id);
});

test("pipeline · time budget: research that cannot fit is skipped, the job still ends inside the budget", async () => {
  process.env.GEMINI_SEARCH = "off";
  process.env.GEMINI_RESEARCH_BUDGET_S = "20";      // document reading needs 30 s of headroom, writing 25 s
  stubFilings();
  const calls = mock(geminiOk);
  const t0 = Date.now();
  const done = await waitJob(researchForReport(report()).job.id);
  assert.ok(Date.now() - t0 < 20_000);
  assert.equal(calls.length, 0, "no call is started that could overrun the budget");
  assert.equal(done.status, "failed", "nothing written → deterministic report only");
});
