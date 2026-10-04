/**
 * DCF assumption rationale — the analyst commentary on the default plan.
 *
 * The numbers are the assumption engine's (server/lib/dcfAssumptions.js) and
 * are FINAL; the model only explains them, as a sell-side analyst would in the
 * "key assumptions" section of an initiation. Token-efficient:
 *   · one call per plan, fed a compact digest of the plan — never statements
 *   · cached on disk by a hash of the plan, so every later user reuses it
 *   · a daily cap on new runs (DCF_AI_DAILY_MAX, default 60)
 * Validation: any rationale that quotes a number not present in the plan is
 * dropped, so the commentary can never contradict the table.
 *
 * Role of the AI: a second pair of eyes. For each assumption it returns a verdict
 * (consistent / aggressive / conservative), optionally the value it would use and one
 * sentence of evidence. The model NEVER applies it — the engine numbers stand, the
 * deterministic commentary (dcfCommentary.js) is always shown, and everything works
 * without a key.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const gemini = require("./insights/gemini");
const gov = require("./aiGovernor");

const VERSION = "dcf-ai-v2";
const DIR = process.env.MERIDIAN_DCF_AI_DIR || path.join(__dirname, "..", "data", "dcf-ai");
const DAILY_MAX = Number(process.env.DCF_AI_DAILY_MAX) || 60;
const jobs = new Map();
let day = null, started = 0;

const DRIVERS = ["growth", "ebitdaMargin", "depPctRev", "capexPctRev", "wcPctRev", "taxRate"];

/* the compact digest the model sees (and the hash the cache is keyed on) */
function digest(plan, meta) {
  const d = (k) => { const x = plan.drivers[k]; return { label: x.label, path: x.path, latest: x.latest, history: x.hist, build: x.build, adjustments: x.adjustments.map((a) => ({ label: a.label, effect: a.effect, why: a.why })) }; };
  const w = plan.wacc;
  return {
    company: meta.name, symbol: meta.symbol, sector: meta.sector, market: plan.marketLabel, forecast_years: plan.years,
    quality: plan.quality,
    drivers: Object.fromEntries(DRIVERS.map((k) => [k, d(k)])),
    cost_of_capital: { rf: w.rf.value, rf_source: w.rf.source, beta_used: w.beta.used, beta_raw: w.beta.raw, beta_peer_median: w.beta.peerMedian, erp: w.erp.value, premium: w.premium, cost_of_equity: w.costEquity, cost_of_debt_pre_tax: w.costDebt.pre, rating: w.costDebt.rating, weight_debt_pct: w.weights.debt, wacc: w.value, adjustments: w.adjustments.map((a) => ({ label: a.label, effect: a.effect })) },
    terminal: { growth: plan.terminal.value, ronic: plan.terminal.ronic, reinvestment_rate_pct: plan.terminal.reinvestmentRate, adjustments: plan.terminal.adjustments.map((a) => ({ label: a.label, effect: a.effect })) },
    notes: plan.notes, warnings: plan.warnings,
  };
}
const keyOf = (dg) => crypto.createHash("sha1").update(VERSION + "|" + JSON.stringify(dg)).digest("hex").slice(0, 24);
const fileOf = (key) => path.join(DIR, key + ".json");
function cacheGet(key) { try { const j = JSON.parse(fs.readFileSync(fileOf(key), "utf8")); return j && j.version === VERSION ? j.result : null; } catch { return null; } }
function cachePut(key, result) {
  try { fs.mkdirSync(DIR, { recursive: true }); const f = fileOf(key), tmp = f + ".tmp"; fs.writeFileSync(tmp, JSON.stringify({ version: VERSION, savedAt: new Date().toISOString(), result })); fs.renameSync(tmp, f); }
  catch (e) { console.warn("[dcf-ai] cache write failed:", e.message); }
}

const SYSTEM = `You are the lead equity analyst at an institutional research desk reviewing a DCF built by a rules-based assumption engine. Two jobs. (1) Write the "Key DCF assumptions" note: explain, for a portfolio manager, why each default is or is not reasonable for THIS company — what in its history, consensus, peers, moat, earnings quality and market it reflects — and what would make you revise it. (2) Corroborate each assumption: judge the engine value as consistent, aggressive or conservative against the evidence in the data and your knowledge of the company and its industry; if you would use a different starting value, give it (same unit, percent) with one sentence of evidence. Plain, specific, no hype. In prose quote only figures that appear in the data (to the decimals given). No target price, no recommendation.`;
const STR = { type: "string" };
const CORR_KEYS = ["growth", "ebitdaMargin", "capexPctRev", "wcPctRev", "taxRate", "wacc", "terminalG"];
const VERDICT = { type: "object", additionalProperties: false, required: ["verdict", "reason"], properties: { verdict: { type: "string", enum: ["consistent", "aggressive", "conservative"] }, suggested: { type: "number" }, reason: STR } };
const SCHEMA = { type: "object", additionalProperties: false, required: ["overview", "growth", "ebitdaMargin", "reinvestment", "workingCapital", "taxRate", "wacc", "terminal", "watch", "corroboration"],
  properties: {
    overview: STR, growth: STR, ebitdaMargin: STR, reinvestment: STR, workingCapital: STR, taxRate: STR, wacc: STR, terminal: STR,
    watch: { type: "array", items: STR },
    corroboration: { type: "object", additionalProperties: false, required: CORR_KEYS, properties: Object.fromEntries(CORR_KEYS.map((k) => [k, VERDICT])) },
  } };
/* the engine value each verdict is about (first forecast year; WACC / terminal g scalars) */
const engineValue = (dg, k) => (k === "wacc" ? dg.cost_of_capital.wacc : k === "terminalG" ? dg.terminal.growth : dg.drivers[k] && dg.drivers[k].path ? dg.drivers[k].path[0] : null);

/* every number the model quotes must exist in the digest (±0.05 rounding) */
function numbersIn(obj) { const out = []; JSON.stringify(obj).replace(/-?\d+(?:\.\d+)?/g, (m) => { out.push(+m); return m; }); return out; }
function validate(json, dg) {
  const known = numbersIn(dg);
  const ok = (text) => {
    const nums = String(text || "").replace(/FY\d{2,4}|Y\d{1,2}|20\d\d/g, "").match(/\d+(?:\.\d+)?/g) || [];
    return nums.every((n) => { const v = +n; return v <= 12 && Number.isInteger(v) ? true : known.some((k) => Math.abs(Math.abs(k) - v) <= 0.051); });
  };
  const out = {}, dropped = [];
  for (const k of ["overview", "growth", "ebitdaMargin", "reinvestment", "workingCapital", "taxRate", "wacc", "terminal"]) {
    if (json[k] && ok(json[k])) out[k] = String(json[k]).trim(); else if (json[k]) dropped.push(k);
  }
  out.watch = (json.watch || []).filter((w) => ok(w)).slice(0, 6).map((w) => String(w).trim());
  // corroboration: a suggested value must stay within a sane band of the engine value; the
  // evidence sentence may quote the suggestion itself but no other unknown number
  const corr = {};
  for (const k of CORR_KEYS) {
    const c = json.corroboration && json.corroboration[k]; if (!c || !["consistent", "aggressive", "conservative"].includes(c.verdict)) continue;
    const ev = engineValue(dg, k);
    let sug = Number.isFinite(c.suggested) ? +c.suggested : null;
    if (sug != null && (ev == null || Math.abs(sug - ev) > Math.max(5, Math.abs(ev) * 0.6) || (c.verdict === "consistent" && Math.abs(sug - ev) < 0.05))) sug = null;
    const reason = String(c.reason || "").trim();
    const okReason = ok(sug != null ? reason.split(String(sug)).join("") : reason);
    if (reason && okReason) corr[k] = { verdict: c.verdict, suggested: sug, engine: ev, reason };
  }
  out.corroboration = corr;
  out.dropped = dropped;
  return out;
}

async function run(key, dg) {
  const r = await gemini.chat({
    messages: [{ role: "system", content: SYSTEM }, { role: "user", content: `DATA (JSON):\n${JSON.stringify(dg)}\n\nWrite: overview (3-4 sentences on the shape of the forecast and what drives value), then 2-4 sentences each for growth, ebitdaMargin, reinvestment (capex and D&A), workingCapital, taxRate, wacc and terminal, and watch (3-5 short items: what would make you revise the assumptions). Then corroboration: for growth, ebitdaMargin, capexPctRev, wcPctRev, taxRate (each about its first forecast year value), wacc and terminalG give verdict, suggested (only if you would use a different value, in percent) and a one-sentence reason.` }],
    feature: "dcf", tag: [dg.symbol, "DCF check"].filter(Boolean).join(" "), schema: { name: "dcf_rationale", schema: SCHEMA }, maxTokens: 2600, reasoning: "low", timeoutMs: 60_000,
  });
  const result = { ...validate(r.json || {}, dg), model: r.model, tokens: r.usage && r.usage.total_tokens, generatedAt: new Date().toISOString() };
  cachePut(key, result);
  return result;
}

/* start (or join, or read from cache) the rationale for a plan */
function ensure(plan, meta, { start = true } = {}) {
  if (!plan) return { status: "off", reason: "no plan" };
  const dg = digest(plan, meta), key = keyOf(dg);
  const hit = cacheGet(key);
  if (hit) return { key, status: "done", result: hit };
  const j = jobs.get(key);
  if (j) return { key, status: j.status, result: j.result || null, error: j.error || null };
  if (!gemini.hasKey() || !gov.status().available) return { key, status: "off" };
  if (!start) return { key, status: "idle" };
  const today = new Date().toISOString().slice(0, 10);
  if (day !== today) { day = today; started = 0; }
  if (started >= DAILY_MAX) return { key, status: "off" };
  started++;
  const job = { status: "running" };
  job.promise = run(key, dg)
    .then((res) => { job.status = "done"; job.result = res; return res; })
    .catch((e) => { job.status = "failed"; job.error = String((e && e.code) || (e && e.message) || e).slice(0, 120); return null; })
    .finally(() => setTimeout(() => jobs.delete(key), 30 * 60 * 1000).unref());
  jobs.set(key, job);
  return { key, status: "running" };
}
function status(key) {
  const hit = cacheGet(key);
  if (hit) return { key, status: "done", result: hit };
  const j = jobs.get(key);
  return j ? { key, status: j.status, result: j.result || null, error: j.error || null } : { key, status: "unknown" };
}

module.exports = { ensure, status, digest, validate, keyOf, VERSION };
