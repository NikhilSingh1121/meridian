/**
 * M-TERMINAL — research layer orchestration.
 *
 *   deterministic report (source of truth, rendered immediately)
 *        ↓ sectorProfile()              what to research for this business model
 *   STAGE 1  conductDeepCompanyResearch  exchange filings + news (code), primary
 *                                        documents read by Gemini (+ search grounding
 *                                        when the key has quota) → evidence pack
 *        ↓ (URL, date-cutoff and figure verification in code)
 *   STAGE 2  synthesizeResearch          Gemini, JSON schema → section prose
 *        ↓ (sentence-level grounding validator)
 *   research { sections, sources }       merged by the renderer INTO the existing
 *                                        report sections — no separate chapter
 *
 * The pipeline takes minutes (multiple browser sessions under a tokens-per-
 * minute limit), longer than a proxied HTTP request may stay open, so it runs
 * as a background job: /api/report returns the deterministic report at once
 * plus a job id; the client polls and re-renders when the research lands.
 * Results are cached per company + report date + pipeline version, in memory
 * and on disk, so reopening or regenerating the same report never re-researches.
 * Nothing here can throw into the report path.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const gemini = require("./gemini");
const { sectorProfile } = require("./sector");
const { buildFacts } = require("./facts");
const { conductDeepCompanyResearch } = require("./research");
const { synthesizeResearch } = require("./synthesis");

const VERSION = "research-v3";
const CACHE_DIR = process.env.MERIDIAN_RESEARCH_DIR || path.join(__dirname, "..", "..", "data", "research");
const mem = new Map();    // key → research object
const jobs = new Map();   // id  → job

/* hard time budget per report (research + writing); whatever is ready when it
   runs out is shown, the rest of the report stays deterministic */
const BUDGET_MS = () => (Number(process.env.GEMINI_RESEARCH_BUDGET_S) || 270) * 1000;
/* the steps the report page shows while a job runs */
/* [key, label, typical share of the run time] — the weights drive the progress bar */
const STEPS = [
  ["discover", "Collecting exchange filings & news", 3],
  ["r:results", "Reading the latest results filing", 10],
  ["r:management", "Reading management commentary & guidance", 7],
  ["r:developments", "Reading transaction & corporate filings", 5],
  ["r:industry", "Researching industry & competitors", 2],
  ["s:financials", "Writing financial analysis", 15],
  ["s:business", "Writing business, management & developments", 15],
  ["s:valuation", "Writing valuation, thesis & risks", 15],
  ["s:summary", "Writing the executive summary", 15],
  ["s:industry", "Writing industry & competitive analysis", 11],
  ["validate", "Checking every figure & source", 2],
];
const WEIGHT = STEPS.reduce((a, s) => a + s[2], 0);
function step(job, key) {
  const i = STEPS.findIndex((s) => s[0] === key);
  if (i >= 0 && i >= (job.step == null ? -1 : job.step)) { job.step = i; job.stage = STEPS[i][1]; }
}

const keyOf = (meta) => `${VERSION}|${String(meta.symbol).toUpperCase()}|${meta.date}`;
const gov = require("../aiGovernor");
/* research and document readings are reused for AI_RESEARCH_REUSE_DAYS (default 7)
   instead of being redone every day: filings change quarterly, not daily */
const REUSE_DAYS = () => { const v = +process.env.AI_RESEARCH_REUSE_DAYS; return Number.isFinite(v) && v >= 0 ? Math.min(30, v) : 7; };
function recentKeys(meta) {
  const out = [], d0 = new Date(String(meta.date) + "T00:00:00Z");
  if (isNaN(d0)) return [keyOf(meta)];
  for (let i = 0; i <= REUSE_DAYS(); i++) { const d = new Date(d0); d.setUTCDate(d.getUTCDate() - i); out.push(keyOf({ ...meta, date: d.toISOString().slice(0, 10) })); }
  return out;
}
const aiUsable = () => gemini.hasKey() && gov.status().available;
const { TokenBudget, capFromEnv } = require("./budget");
/* tokens kept back for the write-up while research reads documents (≈ five section calls) */
const SYNTH_RESERVE = () => capFromEnv("REPORT_SYNTH_RESERVE", 45_000);
/* the terminal's own figures, so research asks the model only for what they do not already cover */
function knownFacts(facts) {
  try {
    const out = [];
    const yrs = facts.financials_by_year || [], last = yrs[yrs.length - 1];
    if (facts.units) out.push(facts.units);
    if (last) out.push("Latest completed year: " + JSON.stringify(last).slice(0, 700));
    if (facts.latest_quarter) out.push("Latest quarter: " + JSON.stringify(facts.latest_quarter).slice(0, 600));
    if (facts.growth) out.push("Growth: " + JSON.stringify(facts.growth).slice(0, 300));
    return out.join("\n");
  } catch { return ""; }
}
const fileOf = (key) => path.join(CACHE_DIR, crypto.createHash("sha1").update(key).digest("hex").slice(0, 24) + ".json");

const stale = (r) => !!(r && r.meta && r.meta.retryAt && Date.now() > r.meta.retryAt);
function cacheGet(key) {
  if (mem.has(key)) { const v = mem.get(key); if (!stale(v)) return v; mem.delete(key); return null; }
  try {
    const j = JSON.parse(fs.readFileSync(fileOf(key), "utf8"));
    if (j && j.key === key && j.research && !stale(j.research)) { mem.set(key, j.research); return j.research; }
  } catch { }
  return null;
}
function cachePut(key, research) {
  mem.set(key, research);
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const f = fileOf(key), tmp = f + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ key, savedAt: Date.now(), research }));
    fs.renameSync(tmp, f);
  } catch (e) { console.warn("[research] cache write failed:", e.message); }
}

/* completed research passes are kept per report key, so a job that fails
   part-way (typically a quota or capacity limit) resumes on the next attempt
   rather than repeating browser sessions it already paid for */
const passKey = (key) => `${key}|passes`;
/* the most recent key in the reuse window whose document reading completed */
function recentPassKey(meta) {
  for (const k of recentKeys(meta)) { const p = passesGet(k); if (p.__complete) return k; }
  return keyOf(meta);
}
function passesGet(key) {
  try { const j = JSON.parse(fs.readFileSync(fileOf(passKey(key)), "utf8")); if (j && j.key === passKey(key)) return j.passes || {}; } catch { }
  return {};
}
function passesPut(key, passes) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const f = fileOf(passKey(key)), tmp = f + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ key: passKey(key), savedAt: Date.now(), passes }));
    fs.renameSync(tmp, f);
  } catch (e) { console.warn("[research] pass cache write failed:", e.message); }
}

async function runPipeline(job, report) {
  const t0 = Date.now(), budget = BUDGET_MS();
  const onProgress = (k) => step(job, k);
  try {
    const profile = sectorProfile(report.meta.sector, report.meta.industry);
    const facts = buildFacts(report);
    job.stage = "Planning research";
    const reading = [...jobs.values()].find((j) => j.key === job.key && j.kind === "docs" && j.status === "running" && j.promise);
    if (reading) { onProgress("discover"); await Promise.race([reading.promise, new Promise((r) => setTimeout(r, Math.round(budget * 0.45)))]); }
    const done = passesGet(recentPassKey(report.meta));
    const tb = new TokenBudget();
    const research = await conductDeepCompanyResearch({
      report, profile, onProgress, donePasses: done, deadline: t0 + Math.round(budget * 0.45),
      onPass: (k, rec) => { done[k] = rec; passesPut(job.key, done); },
      budget: tb, reserve: Math.min(SYNTH_RESERVE(), Math.round(tb.cap * 0.6)), known: knownFacts(facts),
    });
    const verified = research.evidence.filter((e) => e.verified).length;
    if (!research.passes.some((p) => p.ok)) throw Object.assign(new Error("all research passes failed"), { code: research.passes[0] && research.passes[0].error || "research_failed" });
    const syn = await synthesizeResearch({ report, facts, research, profile, onProgress, deadline: t0 + budget - 3000, budget: tb });
    if (!syn.stats.filledSections) throw Object.assign(new Error("synthesis produced no usable content"), { code: (syn.stats.failures[0] || {}).error || "synthesis_failed" });
    const result = {
      version: VERSION, generatedAt: new Date().toISOString(), cutoff: report.meta.date,
      sections: syn.sections, sources: syn.sources,
      meta: {
        sector: profile.key, evidence: research.evidence.length, verifiedEvidence: verified, searches: research.searches, mode: research.mode, discovered: research.discovered,
        tokens: { research: research.tokens, synthesis: syn.stats.tokens, reusedReading: research.reusedTokens || 0, cap: tb.cap, capped: tb.skipped },
        passes: research.passes, synthesisModels: syn.stats.models, failures: syn.stats.failures,
        budgetSeconds: Math.round(budget / 1000), sentences: syn.stats.sentences, removedSentences: syn.stats.dropped, removedBy: syn.stats.reasons, removed: syn.stats.removed,
        seconds: Math.round((Date.now() - t0) / 1000),
      },
    };
    const FINAL = /^(token_budget|time_budget)$/;
    const transient = syn.stats.failures.filter((f) => !FINAL.test(f.error));
    job.status = transient.length ? "partial" : "done";
    // cached either way, so views do not re-spend tokens: a capped report is final; one with a transient
    // failure (rate limit, provider error) is retried after REPORT_RETRY_H hours (default 6)
    if (transient.length) result.meta.retryAt = Date.now() + capFromEnv("REPORT_RETRY_H", 6) * 3600e3;
    cachePut(job.key, result);
    job.research = result;
    job.stage = "Complete";
    const reused = research.reusedTokens || 0;
    console.log(`[research] ${report.meta.symbol}: ${job.status} in ${result.meta.seconds}s — ${research.evidence.length} evidence (${verified} verified), ${research.searches} searches, ${(research.tokens + syn.stats.tokens).toLocaleString("en-US")} tokens this run (reading ${research.tokens.toLocaleString("en-US")} + writing ${syn.stats.tokens.toLocaleString("en-US")}${reused ? `; + ${reused.toLocaleString("en-US")} from an earlier document reading` : ""}) of a ${tb.cap.toLocaleString("en-US")} cap${tb.skipped.length ? ` — capped: ${tb.skipped.join(", ")}` : ""}, ${syn.sources.length} sources cited, ${syn.stats.dropped}/${syn.stats.sentences} sentences removed by validator`);
  } catch (e) {
    job.status = "failed";
    job.reason = e && e.code ? `${e.code}: ${e.message}` : "research pipeline error";
    job.stage = "Unavailable";
    console.warn(`[research] ${report.meta.symbol}: failed — ${job.reason}`);
  } finally {
    job.finishedAt = Date.now();
    // forget finished jobs after an hour (the result itself stays cached)
    setTimeout(() => jobs.delete(job.id), 60 * 60 * 1000).unref();
  }
}

/**
 * Called by /api/report with the finished deterministic report.
 * @returns { research } when cached, { job } when running/started, or { status } when off
 */
function researchForReport(report) {
  const key = keyOf(report.meta);
  for (const k of recentKeys(report.meta)) { const cached = cacheGet(k); if (cached) return { research: cached, status: { available: true, cached: true } }; }
  if (!aiUsable()) return { status: { available: false, reason: "off" } };
  const running = [...jobs.values()].find((j) => j.key === key && j.kind !== "docs" && j.status === "running");
  if (running) return { job: publicJob(running) };
  const job = { id: crypto.randomBytes(8).toString("hex"), kind: "report", key, symbol: report.meta.symbol, status: "running", stage: "Queued", step: -1, startedAt: Date.now(), budget: BUDGET_MS() };
  jobs.set(job.id, job);
  runPipeline(job, report);                       // fire and forget — never awaited by the request
  return { job: publicJob(job) };
}

function publicJob(j) {
  const running = j.status === "running", at = j.step == null ? -1 : j.step;
  return {
    id: j.id, symbol: j.symbol, status: j.status, stage: j.stage, reason: j.reason || null,
    elapsed: Math.round(((j.finishedAt || Date.now()) - j.startedAt) / 1000), budget: Math.round((j.budget || BUDGET_MS()) / 1000),
    progress: running ? (STEPS.slice(0, Math.max(0, at)).reduce((a, s) => a + s[2], 0) + (at >= 0 ? STEPS[at][2] / 2 : 0)) / WEIGHT : 1,
    steps: STEPS.map(([, label], i) => ({ label, state: i < at || (!running && i <= at) ? "done" : i === at && running ? "active" : "pending" })),
  };
}
function jobStatus(id) {
  const j = jobs.get(String(id || ""));
  if (!j) return null;
  const fin = j.status === "done" || j.status === "partial";
  // the filings the research read (same cached passes as the workstation's document reader)
  let documents = null;
  if (fin && j.kind === "report") { try { const v = docsView(j.key, null); if (v.count) documents = { readAt: v.readAt, items: v.items }; } catch { documents = null; } }
  return { ...publicJob(j), research: fin ? j.research : null, documents };
}

/* ── Layer 2 for the Equity Research workstation ───────────────────────
   Reads the primary documents (latest results filing, call transcript,
   transaction filings) under the SAME key the report uses: the passes are
   cached, so a report generated afterwards only has to write. */
const DOC_KINDS = ["results", "management", "developments"];
const DOCS_BUDGET_MS = 150_000;

function docsView(key, job) {
  const done = passesGet(key);
  const items = Object.fromEntries(DOC_KINDS.map((k) => [k, (done[k] && done[k].items) || []]));
  const count = DOC_KINDS.reduce((a, k) => a + items[k].length, 0);
  const status = job && job.status === "running" ? "running" : done.__complete || count ? "done" : job && job.status === "failed" ? "failed" : "idle";
  return {
    status, stage: job && job.status === "running" ? job.stage : null, elapsed: job ? Math.round(((job.finishedAt || Date.now()) - job.startedAt) / 1000) : null,
    reason: job && job.status === "failed" ? job.reason : null, readAt: done.__complete || null, items, count,
  };
}

/* start (or join) document reading for a company; returns the current view */
function documentsFor(report, { start = true } = {}) {
  const key = recentPassKey(report.meta);
  // a reading already on file is shown even when AI is off; nothing new is started then
  if (!aiUsable()) { const v = docsView(key, null); return v.count ? v : { status: "off" }; }
  const done = passesGet(key);
  const running = [...jobs.values()].find((j) => j.key === key && j.status === "running");
  if (running || done.__complete || !start) return docsView(key, running);
  const job = { id: crypto.randomBytes(8).toString("hex"), kind: "docs", key, symbol: report.meta.symbol, status: "running", stage: "Collecting exchange filings", startedAt: Date.now() };
  jobs.set(job.id, job);
  job.promise = (async () => {
    try {
      const profile = sectorProfile(report.meta.sector, report.meta.industry);
      const labels = { discover: "Collecting exchange filings", "r:results": "Reading the latest results filing", "r:management": "Reading the call transcript & presentation", "r:developments": "Reading transaction filings", "r:industry": "Checking industry sources" };
      const tb = new TokenBudget(capFromEnv("DOCS_TOKEN_CAP", 60_000));
      const res = await conductDeepCompanyResearch({
        report, profile, donePasses: done, deadline: Date.now() + DOCS_BUDGET_MS, budget: tb, known: knownFacts(buildFacts(report)),
        onProgress: (k) => { if (labels[k]) job.stage = labels[k]; },
        onPass: (k, rec) => { done[k] = rec; passesPut(key, done); },
      });
      if (res.discovered && res.discovered.filingsUnavailable) throw Object.assign(new Error("the exchange did not return the company filings — try again shortly"), { code: "filings_unavailable" });
      const failed = res.passes.filter((x) => DOC_KINDS.includes(x.key) && x.ok === false);
      if (failed.length && !DOC_KINDS.some((k) => done[k] && done[k].items && done[k].items.length)) throw Object.assign(new Error(`document reading failed (${failed.map((x) => x.error).join(", ")})`), { code: failed[0].error || "reading_failed" });
      // complete only when every document pass succeeded; otherwise the next visit reads the rest
      if (!failed.length) { done.__complete = new Date().toISOString(); passesPut(key, done); }
      job.status = "done";
      console.log(`[research] ${report.meta.symbol}: documents read for the workstation — ${DOC_KINDS.map((k) => `${k} ${(done[k] && done[k].items || []).length}`).join(", ")} · ${res.tokens.toLocaleString("en-US")} tokens of a ${tb.cap.toLocaleString("en-US")} cap${tb.skipped.length ? ` (capped: ${tb.skipped.join(", ")})` : ""}`);
    } catch (e) {
      job.status = "failed"; job.reason = e && e.code ? `${e.code}: ${e.message}` : "document reading failed";
      console.warn(`[research] ${report.meta.symbol}: document reading failed — ${job.reason}`);
    } finally {
      job.finishedAt = Date.now();
      setTimeout(() => jobs.delete(job.id), 60 * 60 * 1000).unref();
    }
  })();
  return docsView(key, job);
}

module.exports = { researchForReport, jobStatus, documentsFor, VERSION, keyOf };
