/**
 * Earnings-call analyser — the model-assisted modules (MTerminal framework
 * M2 headline / thesis impact, M3 operating environment, M5 segment scorecard,
 * M7 input-cost & pricing matrix, M8 strategy, M12 bull / bear).
 *
 * These are the parts that vary too much by industry for rules to cover (a
 * cement call's inputs are coal and pet-coke, a bank's are deposit costs, an
 * IT firm's are wages). Token-efficient by design:
 *   · one call per transcript, fed a compact page-tagged evidence pack chosen
 *     by the deterministic engine — never the whole transcript
 *   · cached by transcript hash on disk, so every later user (and the DOCX
 *     export) reuses it at zero cost
 *   · a daily cap on new runs protects the token budget
 * Every item must cite pages that exist and may only use numbers that appear
 * in the transcript; anything else is dropped before it is shown.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const gemini = require("./insights/gemini");
const { unmark } = require("./callParse");
const { managementEvidence, figures } = require("./callAnalysis");

const VERSION = "call-ai-v1";
const DIR = process.env.MERIDIAN_CALLS_DIR ? path.join(process.env.MERIDIAN_CALLS_DIR, "ai") : path.join(__dirname, "..", "data", "calls", "ai");
const DAILY_MAX = Number(process.env.EARNINGS_AI_DAILY_MAX) || 60;
const jobs = new Map();          // key → { status, promise, result, error, startedAt }
let day = null, started = 0;

const keyOf = (text) => crypto.createHash("sha1").update(VERSION + "|" + unmark(String(text || "")).replace(/\s+/g, " ").trim()).digest("hex").slice(0, 24);
const fileOf = (key) => path.join(DIR, key + ".json");
function cacheGet(key) { try { const j = JSON.parse(fs.readFileSync(fileOf(key), "utf8")); return j && j.version === VERSION ? j.result : null; } catch { return null; } }
function cachePut(key, result) {
  try { fs.mkdirSync(DIR, { recursive: true }); const f = fileOf(key), tmp = f + ".tmp"; fs.writeFileSync(tmp, JSON.stringify({ version: VERSION, savedAt: new Date().toISOString(), result })); fs.renameSync(tmp, f); }
  catch (e) { console.warn("[call-ai] cache write failed:", e.message); }
}

/* ── evidence pack: page-tagged management sentences + the extracted structure ── */
function evidencePack(text, analysis) {
  const { items } = managementEvidence(text, analysis.meta.company);
  const tag = (x) => `[p${x.page != null ? x.page : "?"}]${x.prepared ? "" : "[Q&A]"} ${x.speaker ? x.speaker + ": " : ""}${x.text}`;
  const lines = [];
  // prepared remarks carry the numbers and the framing; answers add colour — rank by informativeness
  const rank = (x) => (figures(x.text).length ? 3 : 0) + (x.prepared ? 2 : 0) + (/\b(segment|business|portfolio|brand|division|india|international|export|domestic|price|cost|input|inflation|margin|capex|acquisition|launch|strategy|demand|rural|urban|monsoon|policy|gst|regulat)\w*/i.test(x.text) ? 2 : 0);
  const chosen = items.map((x) => ({ x, r: rank(x) })).sort((a, b) => b.r - a.r || a.x.idx - b.x.idx).slice(0, 90).sort((a, b) => a.x.idx - b.x.idx);
  let budget = 15000;
  for (const { x } of chosen) { const l = tag(x); if (budget - l.length < 0) break; lines.push(l); budget -= l.length; }
  const qa = analysis.qa.exchanges.slice(0, 30).map((q) => `[p${q.page != null ? q.page : "?"}] ${q.firm || q.analyst || "Analyst"} asked (${q.theme}): ${q.question} → ${q.answer ? q.answer.slice(0, 220) : "(no answer)"}`);
  const guide = analysis.guidance.slice(0, 14).map((g) => `[p${g.page != null ? g.page : "?"}] ${g.metric || "?"} | ${g.period || "—"} | ${g.target || "qualitative"}${g.condition ? ` | condition: ${g.condition}` : ""}`);
  const facts = analysis.facts.slice(0, 16).map((f) => `[p${f.page != null ? f.page : "?"}] ${f.metric}${f.qualifier ? ` (${f.qualifier})` : ""}: ${[f.value, f.change && `${f.change} ${f.period || ""}`].filter(Boolean).join(", ")} [${f.basis}]`);
  return [
    `COMPANY: ${analysis.meta.company || "?"} · ${analysis.meta.period || "?"} · sector: ${analysis.meta.sector || "unknown"}`,
    "REPORTED FIGURES (extracted):", ...facts,
    "GUIDANCE (extracted):", ...guide,
    "MANAGEMENT STATEMENTS:", ...lines,
    "Q&A DIGEST:", ...qa.map((q) => q.slice(0, 420)),
  ].join("\n");
}

const SYSTEM = `You are the Earnings Call Analyser inside MTerminal, an institutional equity research terminal. The reader is a buy-side analyst who wants what management committed to, what they avoided and what to check next quarter — not a recap.
You receive page-tagged evidence extracted from one earnings-call transcript ([p7] = page 7; [Q&A] = said in the Q&A). Fill ONLY the requested modules.
HARD RULES
1. Every object carries "cite": page numbers taken from the [pN] tags of the lines you used. No citation, no object.
2. Never invent numbers. Use a number only if it appears in the evidence; otherwise use words or "not disclosed".
3. Use the company's own segment, brand and input names. Cover what matters for THIS industry (e.g. deposits and asset quality for a bank, deal wins and wages for IT, coal and realisation for cement).
4. Plain, specific text, at most 30 words per field. No adjectives without numbers.
5. The thesis matrix is analyst judgment: rate likelihood and impact from the evidence only.`;

const S = { type: "string" }, CITE = { type: "array", items: { type: "integer" } };
const obj = (props, req) => ({ type: "object", properties: props, required: req || Object.keys(props) });
const SCHEMA = obj({
  headline: S, thesis_impact: { type: "string", enum: ["positive", "neutral", "negative"] }, thesis_reason: S,
  environment: { type: "array", items: obj({ factor: S, read: S, direction: { type: "string", enum: ["up", "down", "flat", "watch"] }, cite: CITE }) },
  segments: { type: "array", items: obj({ name: S, quarter: S, year: S, driver: S, outlook: S, signal: { type: "string", enum: ["up", "down", "flat", "mixed"] }, cite: CITE }) },
  costs: { type: "array", items: obj({ input: S, direction: { type: "string", enum: ["up", "down", "flat"] }, magnitude: S, action: S, net: { type: "string", enum: ["tailwind", "headwind", "neutral"] }, cite: CITE }) },
  strategy: { type: "array", items: obj({ item: S, horizon: S, cite: CITE }) },
  bull: { type: "array", items: obj({ point: S, cite: CITE }) },
  bear: { type: "array", items: obj({ point: S, cite: CITE }) },
  matrix: { type: "array", items: obj({ item: S, likelihood: { type: "string", enum: ["high", "medium", "low"] }, impact: { type: "string", enum: ["high", "medium", "low"] }, sign: { type: "string", enum: ["up", "down"] } }) },
});

/* ── validation: cites must exist, numbers must be in the transcript ── */
function validate(json, text, pages) {
  const src = unmark(text).replace(/,/g, "");
  const numsOk = (s) => (String(s || "").replace(/,/g, "").match(/\d+(?:\.\d+)?/g) || []).every((n) => src.includes(n));
  const citeOk = (c) => (c || []).filter((p) => Number.isInteger(p) && p >= 1 && (!pages || p <= pages));
  const clean = (arr, fields, needCite = true) => (Array.isArray(arr) ? arr : []).map((o) => ({ ...o, cite: citeOk(o.cite) }))
    .filter((o) => (!needCite || o.cite.length || !pages) && fields.every((f) => numsOk(o[f])));
  let dropped = 0; const count = (a, b) => { dropped += (a || []).length - b.length; return b; };
  const out = {
    headline: numsOk(json.headline) ? String(json.headline || "").slice(0, 400) : null,
    thesisImpact: json.thesis_impact || null, thesisReason: numsOk(json.thesis_reason) ? json.thesis_reason : null,
    environment: count(json.environment, clean(json.environment, ["factor", "read"])),
    segments: count(json.segments, clean(json.segments, ["name", "quarter", "year", "driver", "outlook"])),
    costs: count(json.costs, clean(json.costs, ["input", "magnitude", "action"])),
    strategy: count(json.strategy, clean(json.strategy, ["item", "horizon"])),
    bull: count(json.bull, clean(json.bull, ["point"])),
    bear: count(json.bear, clean(json.bear, ["point"])),
    matrix: (json.matrix || []).filter((m) => m && m.item && numsOk(m.item)).slice(0, 10),
  };
  out.dropped = dropped;
  return out;
}

async function run(key, text, analysis) {
  const pack = evidencePack(text, analysis);
  const r = await gemini.chat({
    messages: [{ role: "system", content: SYSTEM }, { role: "user", content: `${pack}\n\nReturn the JSON: headline (<=40 words), thesis_impact + thesis_reason, environment (4-7 factors management discussed), segments (each business / geography discussed), costs (each input or cost line, with the pricing action taken), strategy (portfolio, M&A, capacity, channel moves, long-range targets), bull (3-5), bear (3-5), matrix (6-9 thesis items).` }],
    schema: { name: "call_modules", schema: SCHEMA }, maxTokens: 3200, reasoning: "low", timeoutMs: 100_000,
  });
  const result = { ...validate(r.json || {}, text, analysis.meta.pages), model: r.model, tokens: r.usage && r.usage.total_tokens, generatedAt: new Date().toISOString(), evidenceChars: pack.length };
  cachePut(key, result);
  return result;
}

/* start (or join, or read from cache) the AI modules for a transcript */
function ensure(text, analysis, { start = true } = {}) {
  const key = keyOf(text);
  const cached = cacheGet(key);
  if (cached) return { key, status: "done", result: cached, cached: true };
  const j = jobs.get(key);
  if (j) return { key, status: j.status, result: j.result || null, error: j.error || null, promise: j.promise };
  if (!gemini.hasKey()) return { key, status: "off", reason: "GEMINI_API_KEY not configured" };
  if (!start) return { key, status: "idle" };
  const today = new Date().toISOString().slice(0, 10);
  if (day !== today) { day = today; started = 0; }
  if (started >= DAILY_MAX) return { key, status: "off", reason: "daily AI budget reached — the rule-based analysis is complete" };
  started++;
  const job = { status: "running", startedAt: Date.now() };
  job.promise = run(key, text, analysis)
    .then((res) => { job.status = "done"; job.result = res; return res; })
    .catch((e) => { job.status = "failed"; job.error = String((e && e.code) || (e && e.message) || e).slice(0, 120); return null; })
    .finally(() => setTimeout(() => jobs.delete(key), 30 * 60 * 1000).unref());
  jobs.set(key, job);
  return { key, status: "running", promise: job.promise };
}
function status(key) {
  const cached = cacheGet(key);
  if (cached) return { key, status: "done", result: cached };
  const j = jobs.get(key);
  return j ? { key, status: j.status, result: j.result || null, error: j.error || null } : { key, status: "unknown" };
}

module.exports = { ensure, status, keyOf, evidencePack, validate, VERSION };
