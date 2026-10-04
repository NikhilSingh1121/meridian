/**
 * STAGE 2 — research synthesis (Gemini, JSON schema output, no tools).
 *
 * The report is written in five section groups rather than one call: focused
 * prompts produce denser, better-sourced prose, and a failed group costs only
 * its own sections. Each group gets
 * only the deterministic facts and the verified evidence it needs.
 *
 * Output is prose for the EXISTING report sections — no separate chapter.
 * Every sentence then goes through validate.js before it can be rendered.
 */

const gemini = require("./gemini");
const { estimate } = require("./budget");
const { makeValidator } = require("./validate");

const STR = { type: "string" };
const STRS = { type: "array", items: STR };
const INTS = { type: "array", items: { type: "integer" } };
const obj = (p) => ({ type: "object", properties: p, required: Object.keys(p), additionalProperties: false });
const arr = (items) => ({ type: "array", items });

const PROMPT_BUDGET = 30000;                      // est. prompt tokens per request
const est = (s) => Math.ceil(String(s).length / 3.2);

const SYSTEM = (ctx) => `You are the lead analyst writing an institutional equity-research report on ${ctx.name} (${ctx.symbol}), dated ${ctx.date}. The quantitative work — statements, ratios, valuation, scenarios, scores and the official ${ctx.rec} rating with a ${ctx.target} target — is already done by the firm's deterministic engine and is FINAL. Your job is the analysis a senior analyst adds: what is driving the numbers, what changed, what management says, how the company compares, what the valuation embeds, what could go right or wrong.

Business model: ${ctx.profile.model}. Analyse it through the KPIs that matter for this model: ${ctx.profile.kpis.join(", ")}.

WRITING
- Formal, precise, evidence-led institutional prose. Connected paragraphs with causal logic (what → why → so what). Third person ("the company", "management", "we" only for the house view).
- No chatbot or promotional language ("interestingly", "game changer", "strong signal", "well positioned for growth" without evidence). No mention of AI, models or prompts.
- Never write generic sentences that would fit any company; every paragraph must contain company-specific evidence.

EVIDENCE DISCIPLINE
- FACTS = deterministic data (authoritative). EVIDENCE = verified external research items E1…En with dates and sources.
- Every statement drawn from EVIDENCE must carry its marker, e.g. "Management guided to double-digit revenue growth [E6]." Attribute correctly: company documents → "management" / "the company disclosed"; newspapers → "Reuters reported".
- Every figure must come from FACTS or from a cited EVIDENCE item. Do not compute new figures, do not estimate undisclosed values, do not round differently from the source.
- Where FACTS and EVIDENCE differ (e.g. different EBITDA definitions), say so briefly rather than choosing silently.
- Do not issue a rating, price target or fair value of your own; do not contradict the official rating, the target, the scores or the moat scorecard (overall moat: ${ctx.moat}). Explain the tensions instead.
- The latest quarter: FACTS.latest_quarter holds the figures exactly as filed with the exchange — use them for revenue, margins, EBITDA, profit and segments, and cite EVIDENCE only for what the filing does not contain (volume growth, pricing, category or channel detail, commentary). Never state a latest-quarter figure that contradicts FACTS.latest_quarter.
- Fiscal periods: label annual figures only with the fy_label values in FACTS (fiscal_calendar.latest_completed_fy is the last COMPLETED year — never call it the current or next year); label quarters only as the EVIDENCE labels them.
- Terminology: operating cash flow ÷ net income is the "cash conversion ratio" (a %); the "cash conversion cycle" is measured in days — never mix them. Use the moat classification exactly as the scorecard states it (overall: ${ctx.moat}), even where a factor description elsewhere uses a different adjective.
- Only use information dated on or before ${ctx.date}. If evidence for a topic is missing, write less — never fill gaps with plausible-sounding text. An empty array is acceptable.`;

function evidenceBlock(items) {
  return items.map((e) => `E${e.id} | ${e.date} | ${e.type} | ${e.source.slice(0, 60)} | ${e.claim}`).join("\n");
}

/* build a prompt within budget: drop the lowest-priority evidence first */
function fit(system, header, facts, evidence) {
  let ev = evidence.slice();
  const render = () => `${header}\n\nFACTS (deterministic, authoritative):\n${JSON.stringify(facts)}\n\nEVIDENCE (verified, cite as [E#]):\n${evidenceBlock(ev) || "(none)"}`;
  let user = render();
  while (est(system) + est(user) > PROMPT_BUDGET && ev.length) { ev = ev.slice(0, -1); user = render(); }
  return { user, used: ev };
}

const pick = (evidence, passes, cap) => evidence.filter((e) => passes.includes(e.pass)).slice(0, cap);

/* ── the five section groups ───────────────────────────────────────────── */
function groups(F, evidence) {
  const core = {
    company: F.company, official_conclusion: F.official_conclusion_do_not_change, units: F.units,
  };
  const fy = F.financials_by_year;
  return [
    {
      key: "financials", label: "financial analysis",
      schema: obj({
        latest_results: obj({ period: STR, rows: arr(obj({ metric: STR, value: STR, change: STR, source_ids: INTS })), commentary: STRS }),
        financial_analysis: obj({ revenue: STRS, gross_margin: STRS, ebitda: STRS, pat: STRS, cash_flow: STRS, capital_efficiency: STRS, balance_sheet: STRS, divergences: STRS }),
        forensic_context: STRS,
      }),
      facts: { ...core, latest_quarter: F.latest_quarter, consensus: F.consensus, annual_ladder: F.annual_ladder, financials_by_year: fy, growth: F.growth, latest_year_variance: F.latest_year_variance, ratios: (F.ratios || []).map(({ name, value }) => ({ name, value })), forensic: F.forensic },
      evidence: [...pick(evidence, ["results"], 16), ...pick(evidence, ["management"], 6)],
      ask: `Write the FINANCIAL ANALYSIS section.
- If FACTS.consensus is present, one latest_results.commentary paragraph must explain the latest quarter against consensus: the EPS surprise (FACTS.consensus.eps_surprise_history, last entry) and its drivers as shown by FACTS.latest_quarter and EVIDENCE (revenue growth, gross-margin and EBITDA-margin change, advertising, segment mix) — the reason for the beat or miss, not just its size.
- latest_results: the most recent reported quarter (and full year if recent) from EVIDENCE — period label (e.g. "Q1 FY27"), 5–9 rows of metric / value / change with source_ids; plus 1–2 paragraphs on what changed versus the prior quarter/year.
- financial_analysis: 1–2 dense paragraphs each for revenue (growth history, acceleration, volume vs price, segment/geography contribution), gross_margin (trajectory, input costs, mix, pricing, sustainability), ebitda (operating leverage, cost structure, reinvestment), pat (vs EBITDA, tax/other), cash_flow (OCF, FCF, working capital, capex, conversion), capital_efficiency (ROCE, ROE, asset turns), balance_sheet (debt, liquidity, coverage, allocation capacity), divergences (explicitly name any divergence — e.g. revenue accelerating while margins compress — and what the evidence says drives it).
- forensic_context: 1 paragraph interpreting the Piotroski / Altman / Beneish / cash-quality results in light of the operating trends (do not change the scores).`,
    },
    {
      key: "business", label: "business, management & developments",
      schema: obj({
        business_overview: STRS, management: STRS,
        guidance_tracker: arr(obj({ metric: STR, previous_guidance: STR, latest_guidance: STR, delivered: STR, source_ids: INTS })),
        timeline: arr(obj({ date: STR, period: STR, event: STR, source_ids: INTS })),
        transactions: arr(obj({ date: STR, target: STR, stake: STR, value: STR, rationale: STR, detail: STR, source_ids: INTS })),
      }),
      facts: { ...core, ownership: F.ownership, key_stats: F.key_stats, fiscal_calendar: F.fiscal_calendar, latest_completed_fy: fy[fy.length - 1], latest_quarter: F.latest_quarter, promoter_holding: F.promoter_holding },
      evidence: [...pick(evidence, ["management"], 14), ...pick(evidence, ["developments"], 14), ...pick(evidence, ["results"], 6)],
      ask: `Write BUSINESS OVERVIEW and MANAGEMENT & GOVERNANCE.
- business_overview: 3–5 paragraphs — how the company actually makes money, key franchises and categories, revenue mix, profitability characteristics, distribution and digital channels, international operations, portfolio evolution and acquisitions, structural growth drivers and areas of strategic investment. Where data permits, distinguish core-franchise growth from new-category / acquired-business growth. Weave in material recent developments where they belong.
- management: 3–5 paragraphs — stated priorities, strategy, capital allocation (reinvestment, dividends, buybacks, M&A philosophy), international strategy, medium-term targets, and execution: compare what management previously targeted with what was subsequently reported, and note where commentary has changed. Use only dated evidence.
- guidance_tracker: one row per explicitly guided metric (revenue, volume, margin, EBITDA, capex, mix, international…): previous guidance, latest guidance, delivered (reported actual) — write "not disclosed" where a cell is unknown. Omit rows without real guidance.
- timeline: material dated developments of the last 12 months in chronological order (results, guidance, acquisitions, launches, leadership, regulatory) — only genuinely material items, each with source_ids.
- transactions: every material acquisition / investment / divestment: date, target, stake, value ("Transaction value not disclosed" if not stated — never estimate), strategic rationale, and disclosed revenue / profitability / integration detail.`,
    },
    {
      key: "industry", label: "industry & competition",
      schema: obj({ industry: STRS, competitive: STRS, moat: STRS }),
      facts: { ...core, peers: F.peers, ratios: (F.ratios || []).filter((r) => /margin|ROE|ROCE|Debt|P\/E|EV \/ EBITDA|P\/B/i.test(r.name)).map(({ name, value }) => ({ name, value })), moat_scorecard: F.moat_scorecard, fiscal_calendar: F.fiscal_calendar, latest_completed_fy: fy[fy.length - 1], latest_quarter: F.latest_quarter, promoter_holding: F.promoter_holding },
      evidence: [...pick(evidence, ["industry"], 14), ...pick(evidence, ["results"], 5), ...pick(evidence, ["management"], 3)],
      ask: `Write INDUSTRY ANALYSIS, COMPETITIVE POSITIONING and ECONOMIC MOAT commentary.
- industry: 3–4 paragraphs — market / category growth, demand, pricing and volume, input-cost and commodity environment, channel shifts, consumer or customer behaviour, competitive intensity, regulation — and explicitly connect each to this company's earnings.
- competitive: 2–4 paragraphs interpreting the deterministic peer table: relative growth, margins, returns, leverage and valuation versus named peers, then competitive intelligence from EVIDENCE. Never compare a metric that is missing (null) for the peers. Separate observed positioning from the likely reasons for it. No ranking.
- moat: 2–3 paragraphs explaining the moat scorecard with company-specific evidence — brand, pricing power, distribution, scale, supply chain, category leadership, innovation, cost position; switching costs or network effects only if genuinely applicable — and its durability. Do not re-rate it.`,
    },
    {
      key: "valuation", label: "valuation, thesis & risks",
      schema: obj({
        valuation: STRS,
        thesis_pillars: arr(obj({ title: STR, evidence: STR, current_status: STR, why_it_matters: STR, what_needs_to_happen: STR, what_would_challenge: STR, source_ids: INTS })),
        catalysts: arr(obj({ catalyst: STR, why_it_matters: STR, evidence: STR, horizon: STR, monitor: STR, source_ids: INTS })),
        risks: arr(obj({ category: STR, risk: STR, mechanism: STR, financial_consequence: STR, evidence: STR, monitor: STR, source_ids: INTS })),
      }),
      facts: { ...core, valuation: F.valuation, peers: (F.peers || []).map(({ name, pe, ev_ebitda, revenue_growth_pct }) => ({ name, pe, ev_ebitda, revenue_growth_pct })), growth: F.growth, key_ratios: (F.ratios || []).filter((r) => /P\/E|EV|ROCE|ROE|margin|yield/i.test(r.name)).map(({ name, value }) => ({ name, value })) },
      evidence: [...pick(evidence, ["management"], 6), ...pick(evidence, ["results"], 5), ...pick(evidence, ["developments"], 4), ...pick(evidence, ["industry"], 5)],
      ask: `Write VALUATION commentary, the INVESTMENT THESIS, CATALYSTS and RISKS.
${F.valuation && F.valuation.basis === "market" ? "- valuation: 3–5 paragraphs — what the current multiple implies, the growth and margin expectations embedded in the price, how the target is built from the market-based methods in FACTS (peer multiples, PEG, residual income, dividend discount" + (F.valuation.published_fair_value ? ", the published third-party fair value" : "") + ") and whether the implied multiples look conservative or demanding, peer valuation, why investors may pay a premium, and what operating outcomes would justify the current valuation. NO DCF is used in this report — do not mention a DCF, WACC, terminal value or intrinsic cash-flow value. Do not create a target." : "- valuation: 3–5 paragraphs — what the current multiple implies, the growth and margin expectations embedded in the price, the DCF assumptions (growth, margin, WACC, terminal growth) and whether they look conservative or demanding, terminal-value concentration, peer valuation, sensitivity, the gap between intrinsic value and market price, why investors may nevertheless pay a premium, and what operating outcomes would justify the current valuation. Balanced — no 'DCF says sell but quality says buy'. Do not create a target."}
- thesis_pillars: 3–5 pillars specific to this company, each with evidence, current status, why it matters, what needs to happen, what would challenge it.
- catalysts: only genuine ones — catalyst, why it matters, evidence, time horizon (e.g. "next 2 quarters"), what to monitor.
- risks: 6–10 across relevant categories (business, industry, input-cost, execution, competitive, international, acquisition/integration, regulatory, valuation, capital allocation, macro): mechanism, potential financial consequence, evidence, monitoring indicator. No probabilities, no invented impact numbers.`,
    },
    {
      key: "summary", label: "executive summary",
      schema: obj({ executive_summary: STRS, highlights: arr(obj({ h: STR, p: STR })), investment_summary: STRS, recommendation: STRS }),
      facts: { ...core, fiscal_calendar: F.fiscal_calendar, latest_completed_fy: fy[fy.length - 1], latest_quarter: F.latest_quarter, annual_ladder: F.annual_ladder, growth: F.growth, forensic: F.forensic && { earnings_quality_grade: F.forensic.earnings_quality_grade, piotroski: F.forensic.piotroski }, valuation: F.valuation && { dcf_value_per_share: F.valuation.dcf_value_per_share, terminal_value_share_of_ev_pct: F.valuation.terminal_value_share_of_ev_pct, assumptions: F.valuation.assumptions }, moat_overall: F.moat_scorecard && F.moat_scorecard.overall },
      evidence: evidence.slice(0, 40),
      ask: `Write the EXECUTIVE SUMMARY, HIGHLIGHTS, INVESTMENT SUMMARY and the RECOMMENDATION rationale.
- executive_summary: 6–8 connected paragraphs, about 650 words in total (never under 500, never over 800), opening a professional report. The FIRST paragraph states the official conclusion exactly as given in FACTS — "The official rating is <rating> with a 12-month target of <target>" — and the one or two reasons that matter most. Then cover: current fundamental trajectory, latest earnings development, key earnings driver, margin and profitability trend, cash-flow quality, balance sheet, strategic developments, management outlook, key valuation consideration, primary upside drivers, primary downside risks, what has changed recently, and what matters most over the next 2–4 quarters. A narrative, not a list.
- highlights: 4–6 items (h = 2–5 word heading, p = one evidence-led sentence).
- investment_summary: 3–5 paragraphs — business quality, growth, profitability, cash generation, capital efficiency, balance sheet, competitive position, strategic direction, recent developments, execution, valuation, catalysts, risks; use the composite score and its factors as inputs (never a new score).
- recommendation: 2–3 paragraphs — why the deterministic framework arrives at the official rating, what supports it, what contradicts it, what needs to happen for the thesis to work, and what would cause it to fail.`,
    },
  ];
}

/**
 * @returns { sections, sources, stats }
 */
async function synthesizeResearch({ report, facts, research, profile, onProgress, deadline = Infinity, budget = null }) {
  const m = report.meta;
  const evidence = (research.evidence || []).filter((e) => e.verified);
  const ctx = {
    name: m.name, symbol: m.symbol, date: m.date, rec: m.recommendation,
    target: `${m.currency === "INR" ? "₹" : m.currency === "USD" ? "$" : ""}${Number(m.target).toFixed(2)}`,
    profile, moat: facts.moat_scorecard ? facts.moat_scorecard.overall : "n/a",
  };
  const system = SYSTEM(ctx);
  const V = makeValidator({
    facts, evidence, moatOverall: facts.moat_scorecard && facts.moat_scorecard.overall,
    officialTarget: m.target, streetTarget: report.data && report.data.street && report.data.street.targetMean,
  });
  const out = {}, models = {}, failures = [];
  let tokens = 0;
  // most valuable first: if the time budget runs out, industry prose is the
  // group left to the deterministic text (the peer table still carries it)
  const ORDER = ["financials", "business", "valuation", "summary", "industry"];
  const list = groups(facts, evidence).sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
  let pillarTitles = [];
  for (let i = 0; i < list.length; i++) {
    const g = list[i];
    onProgress && onProgress(`s:${g.key}`);
    if (deadline - Date.now() < 25_000) { failures.push({ group: g.key, error: "time_budget" }); continue; }
    const header = g.ask + (g.key === "summary" && pillarTitles.length ? `\n\nFor coherence, the thesis pillars already written are: ${pillarTitles.join("; ")}.` : "");
    const { user } = fit(system, header, g.facts, g.evidence);
    // per-report token cap: a section that does not fit keeps its deterministic text
    if (budget && !budget.fits(estimate(system.length + user.length, 6000))) { failures.push({ group: g.key, error: "token_budget" }); budget.skip(`write:${g.key}`); continue; }
    try {
      const r = await gemini.chat({
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        feature: "report", tag: `${m.symbol} write:${g.key}`, schema: { name: `report_${g.key}`, schema: g.schema }, reasoning: "low", maxTokens: 9000, timeoutMs: 150_000, deadline,   // thinking tokens count toward the output limit
      });
      out[g.key] = r.json; models[g.key] = r.model;
      tokens += (r.usage && r.usage.total_tokens) || 0;
      if (budget) budget.add((r.usage && r.usage.total_tokens) || 0);
      if (g.key === "valuation") pillarTitles = (r.json.thesis_pillars || []).map((p) => p.title).filter(Boolean).slice(0, 5);
      // an executive summary well short of the brief gets one expansion pass, time permitting
      const words = (x) => (Array.isArray(x) ? x.join(" ") : "").split(/\s+/).filter(Boolean).length;
      const n = g.key === "summary" ? words(r.json.executive_summary) : Infinity;
      if (n < 450 && deadline - Date.now() > 45_000 && (!budget || budget.fits(estimate(system.length + user.length + (r.content || "").length, 7000)))) {
        onProgress && onProgress("s:summary");
        try {
          const r2 = await gemini.chat({
            messages: [{ role: "system", content: system }, { role: "user", content: user }, { role: "assistant", content: r.content || JSON.stringify(r.json) },
              { role: "user", content: `The executive_summary is ${n} words; the brief requires about 650 (500–800). Return the complete JSON again with an executive_summary of 6–8 connected paragraphs totalling 600–700 words. Add analysis, not repetition: what drives the latest results, margin and cash-flow quality, balance sheet capacity, strategic developments, management outlook, what the valuation implies, upside and downside drivers, and what to watch over the next 2–4 quarters — every figure from FACTS or cited EVIDENCE. Keep the other fields.` }],
            feature: "report", tag: `${m.symbol} write:summary (expand)`, schema: { name: `report_${g.key}`, schema: g.schema }, reasoning: "low", maxTokens: 9000, timeoutMs: 150_000, deadline,
          });
          tokens += (r2.usage && r2.usage.total_tokens) || 0;
          if (budget) budget.add((r2.usage && r2.usage.total_tokens) || 0);
          if (words(r2.json.executive_summary) > n) { out[g.key] = r2.json; models[g.key] = r2.model; }
        } catch (e) { console.warn(`[synthesis] ${m.symbol} summary expansion: ${e.code || ""} ${e.message || e}`); }
      }
    } catch (e) {
      failures.push({ group: g.key, error: e.code || "error" });
      console.warn(`[synthesis] ${m.symbol} ${g.key}: ${e.code || ""} ${e.message || e}`);
      if (e.code === "auth" || e.code === "no_key") break;
    }
  }

  /* ── validate & assemble into the existing report's section slots ── */
  onProgress && onProgress("validate");
  const withIds = (text, ids) => V.para(`${text} ${ids.map((i) => `[E${i}]`).join("")}`).replace(/\s*\[E\d+\]/g, "").trim();
  const rows = (list, fn) => (Array.isArray(list) ? list.map(fn).filter(Boolean) : []);
  const f = out.financials || {}, b = out.business || {}, n = out.industry || {}, v = out.valuation || {}, s = out.summary || {};
  const fa = f.financial_analysis || {};
  const sections = {
    executive_summary: V.paras(s.executive_summary),
    highlights: rows(s.highlights, (h) => { const p = V.para(h.p || ""); return p && h.h ? { h: String(h.h).slice(0, 60), p } : null; }).slice(0, 6),
    investment_summary: V.paras(s.investment_summary),
    recommendation: V.paras(s.recommendation),
    business_overview: V.paras(b.business_overview),
    management: V.paras(b.management),
    guidance_tracker: rows(b.guidance_tracker, (r) => {
      const ids = V.ids(r.source_ids); if (!ids.length || !r.metric) return null;
      const cells = ["previous_guidance", "latest_guidance", "delivered"].map((k) => withIds(r[k] || "not disclosed", ids) || "not disclosed");
      return { metric: String(r.metric).slice(0, 60), previous: cells[0], latest: cells[1], delivered: cells[2], source_ids: ids };
    }),
    timeline: rows(b.timeline, (r) => { const ids = V.ids(r.source_ids); const ev = ids.length && withIds(r.event || "", ids); return ev ? { date: String(r.date || "").slice(0, 20), period: String(r.period || "").slice(0, 20), event: ev, source_ids: ids } : null; })
      .sort((a, c) => String(a.date).localeCompare(String(c.date))),
    transactions: rows(b.transactions, (r) => {
      const ids = V.ids(r.source_ids); if (!ids.length || !r.target) return null;
      const value = withIds(r.value || "", ids);
      return { date: String(r.date || "").slice(0, 20), target: withIds(r.target, ids) || String(r.target).slice(0, 80), stake: withIds(r.stake || "", ids), value: value || "Transaction value not disclosed", rationale: withIds(r.rationale || "", ids), detail: withIds(r.detail || "", ids), source_ids: ids };
    }),
    industry: V.paras(n.industry),
    competitive: V.paras(n.competitive),
    moat: V.paras(n.moat),
    latest_results: f.latest_results ? {
      period: String(f.latest_results.period || "").slice(0, 30),
      rows: rows(f.latest_results.rows, (r) => { const ids = V.ids(r.source_ids); const val = ids.length && withIds(r.value || "", ids); return val ? { metric: String(r.metric || "").slice(0, 50), value: val, change: withIds(r.change || "", ids) || "—", source_ids: ids } : null; }),
      commentary: V.paras(f.latest_results.commentary),
    } : null,
    financial_analysis: Object.fromEntries(["revenue", "gross_margin", "ebitda", "pat", "cash_flow", "capital_efficiency", "balance_sheet", "divergences"].map((k) => [k, V.paras(fa[k])])),
    forensic_context: V.paras(f.forensic_context),
    valuation: V.paras(v.valuation),
    thesis_pillars: rows(v.thesis_pillars, (p) => {
      const ids = V.ids(p.source_ids);
      const g = (k) => V.para(`${p[k] || ""}`);
      const x = { title: String(p.title || "").slice(0, 80), evidence: g("evidence"), current_status: g("current_status"), why_it_matters: g("why_it_matters"), what_needs_to_happen: g("what_needs_to_happen"), what_would_challenge: g("what_would_challenge"), source_ids: ids };
      return x.title && (x.evidence || x.why_it_matters) ? x : null;
    }).slice(0, 5),
    catalysts: rows(v.catalysts, (c) => { const ids = V.ids(c.source_ids); const t = V.para(c.catalyst || ""); return t ? { catalyst: t, why_it_matters: V.para(c.why_it_matters || ""), evidence: V.para(c.evidence || ""), horizon: String(c.horizon || "").slice(0, 40), monitor: V.para(c.monitor || ""), source_ids: ids } : null; }).slice(0, 7),
    risks: rows(v.risks, (c) => { const ids = V.ids(c.source_ids); const t = V.para(c.risk || ""); return t ? { category: String(c.category || "Business").slice(0, 40), risk: t, mechanism: V.para(c.mechanism || ""), financial_consequence: V.para(c.financial_consequence || ""), evidence: V.para(c.evidence || ""), monitor: V.para(c.monitor || ""), source_ids: ids } : null; }).slice(0, 10),
  };

  /* sources actually cited, in order of first appearance → reference numbers */
  const order = [];
  const see = (id) => { if (!order.includes(id)) order.push(id); };
  const walk = (x) => {
    if (typeof x === "string") for (const mm of x.matchAll(/\[E(\d+)\]/g)) see(+mm[1]);
    else if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object") { if (Array.isArray(x.source_ids)) x.source_ids.forEach(see); Object.values(x).forEach(walk); }
  };
  walk(sections);
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const sources = order.filter((id) => byId.has(id)).map((id, k) => {
    const e = byId.get(id);
    return { ref: k + 1, id, source: e.source, url: e.url, date: e.date, type: e.type, tier: e.tier, claim: e.claim };
  });
  const filled = Object.values(sections).filter((x) => (Array.isArray(x) ? x.length : x && (x.rows || []).length)).length;
  return { sections, sources, stats: { ...V.stats, failures, models, tokens, filledSections: filled } };
}

module.exports = { synthesizeResearch, PROMPT_BUDGET };
