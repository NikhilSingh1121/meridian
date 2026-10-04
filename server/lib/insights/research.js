/**
 * STAGE 1 — company research (Gemini + URL context, and Google Search
 * grounding when the key has that quota).
 *
 *   1. Source discovery in code (sources.js): exchange filings and dated news
 *      headlines. Filing summaries and headlines become evidence VERBATIM —
 *      no model touches them.
 *   2. Document reading: Gemini reads the primary documents themselves (latest
 *      results filing, press release, investor presentation, call transcript,
 *      transaction filings) through the url_context tool and extracts evidence
 *      lines, each tied to a document id [D#] the code assigned.
 *   3. With search grounding available, passes may also search the web; such
 *      evidence is accepted only when Google's grounding metadata ties the line
 *      to a retrieved page, and it is cited with that page's URL.
 *
 * Traceability rules enforced in code, not trusted to the model:
 *   · a document line counts only if that document was actually retrieved
 *     (urlContextMetadata status SUCCESS); a line naming an unknown document or
 *     URL is discarded — the model cannot introduce a source
 *   · evidence dated after the report date is discarded (no look-ahead)
 *   · verbatim items (filing summaries, headlines) are verified by
 *     construction; document items are marked as read from the retrieved file
 */

const gemini = require("./gemini");
const { discoverSources } = require("./sources");

const TYPES = ["company_filing", "investor_presentation", "earnings_call", "annual_report", "regulatory", "news", "industry", "research"];
const TIER1_TYPES = new Set(["company_filing", "investor_presentation", "earnings_call", "annual_report", "regulatory"]);
const TIER2 = /reuters|bloomberg|ft\.com|economictimes|business-standard|moneycontrol|livemint|cnbc|wsj|thehindubusinessline|financialexpress|nikkei|barrons|marketwatch|ndtvprofit/i;
const EXCHANGE = /nseindia|bseindia|sebi\.gov|sec\.gov|rbi\.org|gov\.in|nasdaq\.com\/market-activity|londonstockexchange/i;
const KIND_TYPE = { results: "company_filing", press: "company_filing", presentation: "investor_presentation", call: "earnings_call", deal: "company_filing", people: "company_filing", capital: "company_filing", legal: "regulatory" };

const DR = require("./docreader");
const { estimate } = require("./budget");

function normUrl(u) { return String(u || "").trim().replace(/[)\].,;]+$/, "").replace(/#.*$/, "").replace(/\/$/, "").toLowerCase(); }
function numbersIn(s) {
  return [...String(s).matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => parseFloat(m[0].replace(/,/g, ""))).filter((v) => isFinite(v));
}
function figuresVerified(claim, text) {
  if (!text) return false;
  const have = numbersIn(text);
  const need = numbersIn(claim).filter((v) => !(v >= 1990 && v <= 2100 && Number.isInteger(v)));   // years are dates, not figures
  if (!need.length) return true;
  return need.every((v) => have.some((h) => Math.abs(h - v) <= Math.max(0.051, v * 0.005)));
}
const clean = (s, n = 420) => String(s || "").replace(/【[^】]*】/g, "").replace(/\s+/g, " ").trim().slice(0, n);
const fields = (line) => {
  const f = {};
  for (const part of line.replace(/^\s*[-*]\s*/, "").split(/\s+\|\s+/)) {
    const m = part.match(/^\s*(doc|date|type|source|url|claim)\s*:\s*(.*)$/i);
    if (m) f[m[1].toLowerCase()] = m[2].trim();
  }
  return f;
};

/* ── verbatim evidence (no model) ─────────────────────────────────────── */
function filingEvidence(filings, company) {
  return filings.filter((f) => f.informative && f.kind !== "call").slice(0, 16).map((f) => ({
    source: `${company} — exchange filing (${f.category})`, url: f.url, date: f.date, type: KIND_TYPE[f.kind] || "company_filing",
    claim: clean(f.text), pass: f.kind === "results" || f.kind === "press" ? "results" : "developments", tier: 1, verified: true, method: "filing summary",
  })).filter((e) => e.url);
}
function newsEvidence(news) {
  return news.map((n) => ({
    source: n.publisher, url: n.url, date: n.date, type: n.scope === "industry" ? "industry" : "news", claim: clean(n.title),
    pass: n.scope !== "company" ? "industry"
      : /\btarget\b|\b(buy|sell|accumulate|reduce|top pick)s?\b|brokerage|downgrade|upgrade/i.test(n.title) ? "industry"
        : /result|profit|revenue|sales|margin|ebitda|\bq[1-4]\b|quarter|volume/i.test(n.title) ? "results" : "developments",
    tier: n.tier, verified: true, method: "headline",
  }));
}

/* ── document-reading passes ──────────────────────────────────────────── */
function documentPlan(filings) {
  const latest = (kind, n) => filings.filter((f) => f.kind === kind && f.url).slice(0, n);
  const results = latest("results", 1);
  const near = (f) => results[0] && Math.abs(Date.parse(f.date) - Date.parse(results[0].date)) <= 4 * 86_400_000;
  const press = filings.filter((f) => f.kind === "press" && f.url && near(f)).slice(0, 1);
  // a presentation or call belongs to the latest results only when filed around them — an older one is stale
  const within = (f, days) => !results[0] || Math.abs(Date.parse(f.date) - Date.parse(results[0].date)) <= days * 86_400_000;
  const pres = filings.filter((f) => f.kind === "presentation" && f.url && within(f, 10)).slice(0, 1);
  const call = filings.filter((f) => f.kind === "call" && f.url && within(f, 45)).slice(0, 1);
  const deals = latest("deal", 3);
  return {
    results: [...results, ...press, ...(call.length ? pres : [])],
    management: call.length ? call : pres,
    developments: deals,
  };
}

function passes(ctx) {
  const { name, cutoff, prof, peers } = ctx;
  const kpis = prof.kpis.join(", ");
  return [
    {
      key: "results", label: "Latest results & operating KPIs",
      brief: `From the documents, extract the LATEST reported quarter (and latest full year where given) for ${name}: revenue, growth, ${kpis}; EBITDA, margin, PAT; segment and geography performance; volume vs price; cash flow and capex where disclosed; what changed versus the prior quarter / year; any figures management highlights.`,
      search: `Also search the web for coverage of ${name}'s latest quarterly results published on or before ${cutoff} (company release, Reuters, Economic Times, Business Standard, Mint, Moneycontrol).`,
    },
    {
      key: "management", label: "Management commentary & guidance",
      brief: `From the documents, extract MANAGEMENT COMMENTARY of ${name}: stated priorities, explicit guidance (revenue, volume, margin, EBITDA, capex, market share, international), medium-term targets, capital allocation (dividends, buybacks, M&A philosophy), risks management flagged, demand and pricing commentary, and any comparison with EARLIER guidance. Attribute statements to management only when the document is the company's own.`,
      search: `Also search for ${name} earnings-call commentary, guidance and medium-term targets published on or before ${cutoff}.`,
    },
    {
      key: "developments", label: "Corporate developments & transactions",
      brief: `From the documents, extract MATERIAL CORPORATE DEVELOPMENTS of ${name}: acquisitions, stake purchases, divestments, mergers, restructuring — for each: counterparty / target, stake, consideration ("value not disclosed" if the document does not state it — never estimate), strategic rationale, and any disclosed revenue, profitability or integration detail.`,
      search: `Also search for ${name} acquisitions, investments, capacity expansion, launches and leadership changes in the 12 months to ${cutoff}.`,
    },
    {
      key: "industry", label: "Industry, competitors & market expectations", searchOnly: true,
      brief: `Research the INDUSTRY and COMPETITIVE context of ${name} as of ${cutoff}: category growth, demand, pricing, input costs, ${prof.drivers.join(", ")}; recent results and moves of ${peers.length ? peers.join(", ") : "its main listed peers"}; consensus and brokerage expectations (context only).`,
      search: `Search the web for these topics; prefer Reuters, Economic Times, Business Standard, Mint, Moneycontrol and industry bodies.`,
    },
  ];
}

const SEARCH_FORMAT = (cutoff) => `
OUTPUT FORMAT — plain text only, no tables, no prose paragraphs. List 5–12 lines, most important first, one fact per line, each exactly:
- date: YYYY-MM-DD | type: ${TYPES.join("|")} | source: <publisher> | claim: <one factual sentence, figures copied exactly as the source states them, with units and period>
Rules: only information published on or before ${cutoff}; every line must come from a page you found with Google Search; never invent a date, figure or value; no commentary.`;

const FORMAT = (cutoff, withSearch) => `
OUTPUT FORMAT — plain text only, no tables, no prose paragraphs. List 6–16 evidence lines, most important first, one fact per line:
- doc: D# | type: ${TYPES.join("|")} | claim: <one factual sentence, figures copied exactly as the document states them, with units>
${withSearch ? `For a fact found through web search instead of a listed document, write:
- date: YYYY-MM-DD | type: … | source: <publisher> | url: <exact URL of the page> | claim: <…>
` : ""}Rules: only information published on or before ${cutoff}; never invent a document id, URL, date, figure or value; if a figure is not in the source, leave it out; state the period each figure refers to (e.g. "Q1 FY27"); no commentary.`;

/* lines tied to a listed, actually-retrieved document */
function parseDocEvidence(content, docs, retrieved, { cutoff, pass }) {
  const ok = new Set((retrieved || []).filter((u) => u.ok).map((u) => normUrl(u.url)));
  const items = []; let dropped = 0;
  for (const line of String(content || "").split(/\r?\n/)) {
    if (!/^\s*[-*]\s*doc\s*:/i.test(line)) continue;
    const f = fields(line);
    const d = docs[(parseInt(String(f.doc || "").replace(/\D/g, ""), 10) || 0) - 1];
    // the model sometimes echoes page / document markers ("[1.6]", "[D1]") into the claim
    const claim = clean(String(f.claim || "").replace(/\s*\[(?:[DE]\s?)?\d+(?:\.\d+)*\]/g, ""));
    if (!d || !claim || !ok.has(normUrl(d.url)) || d.date > cutoff) { dropped++; continue; }
    const type = TYPES.includes((f.type || "").toLowerCase()) ? f.type.toLowerCase() : KIND_TYPE[d.kind] || "company_filing";
    items.push({ source: d.source, url: d.url, date: d.date, type, claim, pass, tier: 1, verified: true, method: "document" });
  }
  return { items, dropped };
}

/* lines found through search: accepted only when Google's grounding supports
   tie the line to a retrieved page; cited with that page's resolved URL */
async function parseSearchEvidence(content, grounding, { cutoff, site, pass, resolve = resolveRedirect }) {
  const items = []; let dropped = 0;
  const g = grounding || { chunks: [], supports: [] };
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
  for (const line of String(content || "").split(/\r?\n/)) {
    if (!/^\s*[-*]\s*date\s*:/i.test(line)) continue;
    const f = fields(line);
    const claim = clean(f.claim);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(f.date || "") ? f.date : null;
    if (!claim || (date && date > cutoff)) { dropped++; continue; }
    const nc = norm(claim);
    const idx = [...new Set(g.supports.filter((s) => { const t = norm(s.text); return t.length > 15 && (nc.includes(t) || t.includes(nc)); }).flatMap((s) => s.chunks))];
    if (!idx.length) { dropped++; continue; }                              // not grounded in a retrieved page
    let url = null, title = "";
    for (const i of idx) {
      const c = g.chunks[i]; if (!c || !c.uri) continue;
      url = await resolve(c.uri); title = c.title;
      if (url) break;
    }
    if (!url) { dropped++; continue; }
    const type = TYPES.includes((f.type || "").toLowerCase()) ? f.type.toLowerCase() : "news";
    const u = url.toLowerCase();
    const tier = TIER1_TYPES.has(type) && ((site && u.includes(site.replace(/^www\./, "").split("/")[0])) || EXCHANGE.test(u)) ? 1 : TIER2.test(u) ? 2 : 3;
    items.push({ source: clean(f.source || title, 140), url, date: date || "undated", type, claim, pass, tier, verified: true, method: "search grounding" });
  }
  return { items, dropped };
}

/* Google's grounding links are redirects — resolve to the publisher URL */
async function resolveRedirect(uri) {
  if (!/^https:\/\/vertexaisearch\.cloud\.google\.com\//.test(uri)) return /^https?:\/\//.test(uri) ? uri : null;
  try {
    const r = await fetch(uri, { redirect: "manual", signal: AbortSignal.timeout(6000) });
    const loc = r.headers.get("location");
    return loc && /^https?:\/\//.test(loc) ? loc : null;
  } catch { return null; }
}

/* search grounding is used only while the key has quota for it */
let searchOffUntil = 0;
// web-search grounding is billed per request on top of tokens — off unless GEMINI_SEARCH=auto
const SEARCH_MODE = () => (process.env.GEMINI_SEARCH || "off").toLowerCase();
const searchWanted = () => SEARCH_MODE() !== "off" && Date.now() >= searchOffUntil;

/**
 * @param donePasses  { [passKey]: record } document passes already completed for
 *                    this report (a retry resumes instead of re-reading)
 * @param onPass      (passKey, record) after each successful document pass
 * @returns { evidence, passes, searches, tokens, cutoff, mode, discovered }
 */
async function conductDeepCompanyResearch({ report, profile, onProgress, donePasses = {}, onPass, resolve = resolveRedirect, deadline = Infinity, budget = null, reserve = 0, known = "" }) {
  const m = report.meta, d = report.data || {};
  const site = d.profile && d.profile.website ? d.profile.website.replace(/^https?:\/\//, "").replace(/\/$/, "") : "";
  const peers = (d.peers || []).slice(1, 5).map((p) => String(p.name || "").replace(/\b(LIMITED|LTD\.?|INC\.?)\b/gi, "").trim()).filter(Boolean);
  const ctx = { name: m.name, cutoff: m.date, prof: profile, peers };

  onProgress && onProgress("discover");
  const src = await discoverSources({ report, peers, profileKey: profile.key });
  const filingsUnavailable = src.filings == null && /\.(NS|BO)$/i.test(m.symbol);
  src.filings = src.filings || [];
  const evidence = [...filingEvidence(src.filings, m.name), ...newsEvidence(src.news)];
  const plan = documentPlan(src.filings);
  const meta = [{ key: "filings", label: "Exchange filings", ok: true, count: src.filings.length }, { key: "news", label: "News headlines", ok: true, count: src.news.length }];
  let searches = 0, tokens = 0, reusedTokens = 0, usedSearch = false;

  const list = passes(ctx);
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    onProgress && onProgress(`r:${p.key}`);
    const prior = donePasses[p.key];
    if (prior && Array.isArray(prior.items)) {
      evidence.push(...prior.items.map((x) => ({ ...x })));
      meta.push({ ...prior.meta, reused: true });
      searches += prior.searches || 0;
      reusedTokens += (prior.meta && prior.meta.tokens) || 0;
      continue;
    }
    const docs = (plan[p.key] || []).map((f) => ({ ...f, source: `${m.name} — ${f.category} (exchange filing)` }));
    const withSearch = searchWanted();
    if (deadline - Date.now() < 30_000) { meta.push({ key: p.key, label: p.label, ok: false, count: 0, error: "time_budget" }); continue; }
    if (!docs.length && !(withSearch && p.searchOnly)) { meta.push({ key: p.key, label: p.label, ok: true, count: 0, skipped: p.searchOnly ? "search grounding off" : "no documents" }); continue; }

    const sys = (how) => `You are a senior equity research associate gathering evidence for a report on ${m.name} dated ${m.date}. ${how} Report only what the sources state; copy figures exactly with their units and periods.`;
    const call = (how, user, t, maxTokens) => gemini.chat({ feature: "research", tag: `${m.symbol} ${p.key}`, messages: [{ role: "system", content: sys(how) }, { role: "user", content: user }], tools: t, reasoning: "low", maxTokens, timeoutMs: 120_000, deadline });
    // the terminal's own data comes first: the model is told what is already known and asked only for what adds to it
    const brief = known ? `${p.brief}\n\nALREADY KNOWN from the terminal's own financial data — do not extract these again; report only facts that add to them (segments, volumes, KPIs, guidance, one-offs, management commentary, transactions):\n${known}` : p.brief;
    try {
      const items = []; let dropped = 0, passSearches = 0, passTokens = 0, retrieved = 0, unreadable = 0, unverified = 0, model = null, skippedForBudget = false;
      const spend = (r) => { const t = (r.usage && r.usage.total_tokens) || 0; passTokens += t; if (budget) budget.add(t); model = model || r.model; };
      if (docs.length) {
        // 1 · download + extract on the server, send only the relevant pages
        const texts = await Promise.all(docs.map((d) => DR.fetchDoc(d.url)));
        let readable = docs.map((d, k) => ({ d, x: texts[k] && DR.relevant(texts[k], p.key, DR.charsFor(d.kind)) })).filter((r) => r.x && r.x.text);
        unreadable = docs.length - readable.length;
        // fit the budget: drop the least important documents (listed last) before skipping the pass
        const promptChars = (list) => brief.length + 1200 + list.reduce((a, r) => a + r.x.text.length + 120, 0);
        while (readable.length > 1 && budget && !budget.fits(estimate(promptChars(readable), 6000), reserve)) readable = readable.slice(0, -1);
        if (readable.length && budget && !budget.fits(estimate(promptChars(readable), 6000), reserve)) { budget.skip(`${p.key}: documents`); readable = []; skippedForBudget = true; }
        if (readable.length) {
          const list = readable.map((r) => r.d);
          const body = readable.map((r, k) => `=== [D${k + 1}] ${r.d.date} · ${r.d.category} · ${r.x.pages.length} of ${r.x.totalPages} pages (most relevant) ===\n${r.x.text}`).join("\n\n");
          const r = await call("Read the document excerpts below.", `${brief}\n\nDOCUMENT EXCERPTS:\n${body}\n${FORMAT(m.date, false)}`, undefined, 6000);
          spend(r);
          const ev = parseDocEvidence(r.content, list, list.map((d) => ({ url: d.url, ok: true })), { cutoff: m.date, pass: p.key });
          // every figure in a claim must appear in the excerpt it cites
          const textOf = new Map(readable.map((x) => [normUrl(x.d.url), x.x.text]));
          for (const it of ev.items) { if (figuresVerified(it.claim, textOf.get(normUrl(it.url)))) items.push(it); else unverified++; }
          dropped += ev.dropped + unverified; retrieved += readable.length;
        }
        // 2 · optional: let Google fetch documents our server could not download (unbounded size — off by default)
        const missed = docs.filter((d, k) => !texts[k] && d.kind !== "presentation");
        if (missed.length && process.env.RESEARCH_URL_CONTEXT === "1") {
          for (const d of missed.slice(0, 1)) {
            if (budget && !budget.fits(60_000, reserve)) { budget.skip(`${p.key}: url-context`); break; }
            try {
              const r = await call("Read the listed document with the URL context tool.", `${brief}\n\nDOCUMENTS:\n[D1] ${d.date} · ${d.category} · ${d.url}\n${FORMAT(m.date, false)}`, [{ url_context: {} }], 6000);
              spend(r);
              const ev = parseDocEvidence(r.content, [d], r.urls, { cutoff: m.date, pass: p.key });
              items.push(...ev.items); dropped += ev.dropped; retrieved += (r.urls || []).filter((u) => u.ok).length;
            } catch (e) { if (e.code !== "bad_request") throw e; }
          }
        }
      }
      // 3 · web search only where the filings left gaps (or for the industry pass), and only within budget
      if (withSearch && (p.searchOnly || items.length < 6) && deadline - Date.now() > 25_000) {
        if (budget && !budget.fits(estimate(brief.length + 1500, 4000) + 6000, reserve)) budget.skip(`${p.key}: search`);
        else {
          try {
            const r = await call("Use Google Search.", `${brief}\n${p.search}\n${SEARCH_FORMAT(m.date)}`, [{ google_search: {} }], 4000);
            spend(r);
            usedSearch = true;
            const ev = await parseSearchEvidence(r.content, r.grounding, { cutoff: m.date, site, pass: p.key, resolve });
            items.push(...ev.items); dropped += ev.dropped;
            passSearches = (r.grounding && r.grounding.queries || []).length;
          } catch (e) {
            // no search-grounding quota on this key → documents and headlines only
            if (e.code !== "quota") throw e;
            searchOffUntil = Date.now() + 6 * 3600_000;
            console.warn(`[research] search grounding unavailable for this key — continuing with filings, documents and headlines`);
          }
        }
      }
      if (unreadable) console.warn(`[research] ${m.symbol} ${p.key}: ${unreadable} of ${docs.length} filing${docs.length > 1 ? "s" : ""} could not be downloaded — skipped`);
      searches += passSearches; tokens += passTokens;
      // not saved as done when nothing could be read (download refused) or the budget ran out — the next run retries it
      if (!items.length && docs.length && (unreadable === docs.length || skippedForBudget)) {
        meta.push({ key: p.key, label: p.label, ok: false, count: 0, error: skippedForBudget ? "token_budget" : "download_failed", documents: docs.length, tokens: passTokens });
        continue;
      }
      const pm = { key: p.key, label: p.label, ok: true, count: items.length, dropped, documents: docs.length, retrieved, unreadable, unverified, model, tokens: passTokens };
      if (onPass) onPass(p.key, JSON.parse(JSON.stringify({ items, meta: pm, searches: passSearches })));
      evidence.push(...items);
      meta.push(pm);
    } catch (e) {
      meta.push({ key: p.key, label: p.label, ok: false, count: 0, error: e.code || "error" });
      console.warn(`[research] ${m.symbol} ${p.key}: ${e.code || ""} ${e.message || e}`);
      if (e.code === "auth" || e.code === "no_key") break;   // no point continuing
    }
  }
  // de-duplicate (same claim from the same URL), primary sources first, newest first
  const seen = new Set();
  const uniq = evidence.filter((e) => e.date <= m.date || e.date === "undated")
    .filter((e) => { const k = normUrl(e.url) + "|" + e.claim.toLowerCase().slice(0, 80); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.tier - b.tier || String(b.date).localeCompare(String(a.date)));
  uniq.forEach((e, i) => (e.id = i + 1));
  return { evidence: uniq, passes: meta, searches, tokens, reusedTokens, cutoff: m.date, mode: usedSearch ? "documents + search" : "documents", discovered: { filings: src.filings.length, news: src.news.length, filingsUnavailable } };
}

module.exports = { conductDeepCompanyResearch, parseDocEvidence, parseSearchEvidence, filingEvidence, newsEvidence, documentPlan, figuresVerified, _resetSearch: () => (searchOffUntil = 0) };
