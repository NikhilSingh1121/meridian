/**
 * M-TERMINAL — Gemini client (Google Generative Language API, generateContent).
 *
 *   · an ordered model chain (GEMINI_MODELS): the first model that answers is
 *     used; the next one is tried ONLY for recoverable failures (overloaded,
 *     unavailable, quota, rate limit, unusable output) — never for a bad
 *     request or an invalid key
 *   · two call shapes: research (url_context and, where the key has quota,
 *     google_search tools; free text) and synthesis (JSON schema, no tools)
 *   · every call goes through one serial queue; a model that fails is rested
 *     (circuit-breaker) so later calls go straight to the next model; the last
 *     model in the chain waits once for Google's RetryInfo before giving up
 *   · every request carries the job's deadline, so a report never waits past
 *     its time budget
 *   · plain fetch, like the rest of the backend; the key travels only in the
 *     x-goog-api-key header — never in a URL, log line, error or response
 */

const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";
// priority order — the user's choice; override with GEMINI_MODELS=a,b,c
const DEFAULT_CHAIN = ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.6-flash", "gemini-3.7-flash", "gemini-3.8-flash", "gemini-3.1-flash-lite"];
const MODELS = () => {
  const env = String(process.env.GEMINI_MODELS || "").split(",").map((m) => m.trim()).filter(Boolean);
  return env.length ? env : DEFAULT_CHAIN;
};
const PRIMARY = () => MODELS()[0];
// the .env.example placeholder counts as "not configured", not as a key to try
const PLACEHOLDER = /^(your_gemini_api_key_here|<.*>|changeme)$/i;
const key = () => (process.env.GEMINI_API_KEY || "").trim();
const hasKey = () => !!key() && !PLACEHOLDER.test(key());
// longest single rate-limit wait accepted on the last model of the chain
const MAX_WAIT_MS = Number(process.env.GEMINI_MAX_WAIT_MS) || 60_000;
// how long a model/tool combination is skipped after a quota refusal
const QUOTA_BLOCK_MS = 15 * 60 * 1000;
// how long an overloaded / unavailable model is skipped in favour of the next one
const OVERLOAD_BLOCK_MS = 5 * 60 * 1000;

class GeminiError extends Error {
  constructor(code, message, { transient = false, retryAfterMs = null, fallbackable = false } = {}) {
    super(message); this.code = code; this.transient = transient; this.retryAfterMs = retryAfterMs; this.fallbackable = fallbackable;
  }
}

/* one call at a time: per-minute token limits are shared, parallel calls only collide */
let queue = Promise.resolve();
function serial(fn) { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; }

const usesSearch = (tools) => (tools || []).some((t) => t && (t.google_search || t.googleSearch));
const retryDelayMs = (details) => {
  const ri = (details || []).find((d) => /RetryInfo$/.test(d["@type"] || ""));
  const m = ri && String(ri.retryDelay || "").match(/^([\d.]+)s$/);
  return m ? Math.ceil(parseFloat(m[1]) * 1000) : null;
};

function toRequest({ messages, tools, schema, maxTokens, reasoning }) {
  const system = (messages || []).filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const contents = (messages || []).filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: String(m.content || "") }] }));
  const body = { contents, generationConfig: { maxOutputTokens: maxTokens } };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (reasoning) body.generationConfig.thinkingConfig = { thinkingLevel: reasoning };
  if (tools && tools.length) body.tools = tools;
  else body.generationConfig.temperature = 0.35;
  if (schema) { body.generationConfig.responseMimeType = "application/json"; body.generationConfig.responseJsonSchema = schema.schema; }
  return body;
}

function grounding(gm) {
  if (!gm) return { chunks: [], supports: [], queries: [] };
  return {
    queries: gm.webSearchQueries || [],
    chunks: (gm.groundingChunks || []).map((c) => ({ uri: (c.web && c.web.uri) || "", title: (c.web && c.web.title) || "" })),
    supports: (gm.groundingSupports || []).map((s) => ({ text: (s.segment && s.segment.text) || "", chunks: s.groundingChunkIndices || [] })),
  };
}

async function callOnce(model, req) {
  const base = (process.env.GEMINI_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");
  let res;
  try {
    res = await fetch(`${base}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key() },
      body: JSON.stringify(toRequest(req)),
      signal: AbortSignal.timeout(req.timeoutMs),
    });
  } catch (e) {
    const timedOut = e && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new GeminiError(timedOut ? "timeout" : "network", timedOut ? `no response within ${Math.round(req.timeoutMs / 1000)}s` : "network error reaching Gemini", { transient: !timedOut, fallbackable: timedOut });
  }
  if (!res.ok) {
    let status = "", msg = "", details = [];
    try { const j = await res.json(); status = (j.error && j.error.status) || ""; msg = (j.error && j.error.message) || ""; details = (j.error && j.error.details) || []; } catch { }
    // key-free, short reason (Google messages never echo the key; trimmed anyway)
    const why = `Gemini HTTP ${res.status}${status ? ` (${String(status).slice(0, 40)})` : ""}`;
    if (res.status === 401 || res.status === 403 || /API_KEY_INVALID|API key not valid|API key expired/i.test(msg + JSON.stringify(details))) throw new GeminiError("auth", why);
    if (res.status === 404) throw new GeminiError("model_unavailable", why, { fallbackable: true });
    if (res.status === 429) {
      const wait = retryDelayMs(details);
      // with RetryInfo: per-minute throttling, worth waiting for; without: the
      // key has no quota for this model/tool (e.g. search grounding on a free key)
      if (wait != null) throw new GeminiError("rate_limited", `${why}, retry after ${Math.round(wait / 1000)}s`, { transient: true, retryAfterMs: wait, fallbackable: true });
      throw new GeminiError("quota", `${why}, quota not available`, { fallbackable: true });
    }
    if (res.status >= 500) throw new GeminiError("upstream", why, { transient: true, fallbackable: true });
    throw new GeminiError("bad_request", why);
  }
  const data = await res.json().catch(() => null);
  const cand = data && data.candidates && data.candidates[0];
  if (!cand) {
    if (data && data.promptFeedback && data.promptFeedback.blockReason) throw new GeminiError("blocked", `prompt blocked (${data.promptFeedback.blockReason})`);
    throw new GeminiError("empty", "empty completion", { fallbackable: true });
  }
  if (/SAFETY|RECITATION|BLOCKLIST|PROHIBITED|SPII/.test(cand.finishReason || "")) throw new GeminiError("blocked", `completion blocked (${cand.finishReason})`);
  const text = ((cand.content && cand.content.parts) || []).filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("");
  const out = {
    content: text,
    grounding: grounding(cand.groundingMetadata),
    urls: ((cand.urlContextMetadata && cand.urlContextMetadata.urlMetadata) || []).map((u) => ({ url: u.retrievedUrl || "", ok: u.urlRetrievalStatus === "URL_RETRIEVAL_STATUS_SUCCESS" })),
    usage: { total_tokens: (data.usageMetadata && data.usageMetadata.totalTokenCount) || 0 },
    model: data.modelVersion || model,
    finishReason: cand.finishReason || "",
  };
  if (req.schema) {
    if (!text) throw new GeminiError("empty", "empty completion", { fallbackable: true });
    try { out.json = JSON.parse(text); } catch { throw new GeminiError("malformed", cand.finishReason === "MAX_TOKENS" ? "JSON cut off at the output limit" : "completion was not valid JSON", { fallbackable: true }); }
  }
  return out;
}

/* circuit-breaker per model + tool shape: a key without search-grounding quota
   must not block plain synthesis calls on the same model; a model that is
   overloaded or rate-limited is rested so later calls skip straight past it */
const blockedUntil = new Map();
const BLOCK_LABEL = { quota: "quota unavailable", upstream: "model overloaded", rate_limited: "rate limited", model_unavailable: "model unavailable" };

async function tryModel(model, req, isLast) {
  const bk = `${model}|${usesSearch(req.tools) ? "search" : "plain"}`;
  const block = blockedUntil.get(bk);
  if (block && block.until > Date.now()) throw new GeminiError(block.code, `${BLOCK_LABEL[block.code] || block.code}, retry after ${Math.ceil((block.until - Date.now()) / 1000)}s`, { fallbackable: true });
  const rest = (code, ms) => blockedUntil.set(bk, { until: Date.now() + ms, code });
  for (let attempt = 0; ; attempt++) {
    const left = req.deadline ? req.deadline - Date.now() : Infinity;
    if (left < 5000) throw new GeminiError("time_budget", "report time budget reached");
    try { return await callOnce(model, { ...req, timeoutMs: Math.min(req.timeoutMs, left) }); }
    catch (e) {
      if (!(e instanceof GeminiError)) throw e;
      if (e.code === "quota") rest("quota", QUOTA_BLOCK_MS);
      else if (e.code === "model_unavailable") rest("model_unavailable", QUOTA_BLOCK_MS);
      else if (e.code === "upstream") rest("upstream", OVERLOAD_BLOCK_MS);
      else if (e.code === "rate_limited") rest("rate_limited", Math.min(e.retryAfterMs || 30_000, QUOTA_BLOCK_MS));
      // with more models left, move on at once; the last model gets one patient retry
      if (!isLast || !e.transient || attempt >= 1) throw e;
      const wait = e.retryAfterMs != null ? e.retryAfterMs + 750 : 2500;
      if (wait > MAX_WAIT_MS || Date.now() + wait > (req.deadline || Infinity) - 5000) throw e;
      blockedUntil.delete(bk);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

/**
 * @param req { messages:[{role:"system"|"user", content}], tools?: Gemini tools[],
 *              schema?: {name, schema}, maxTokens, reasoning: "low"|"medium"|"high",
 *              timeoutMs, deadline?: epoch ms }
 * @returns { content, json?, grounding, urls, usage, model, fellBack }
 */
function chat(req) {
  if (!hasKey()) return Promise.reject(new GeminiError("no_key", "GEMINI_API_KEY not configured"));
  const r = { maxTokens: 8000, reasoning: "medium", timeoutMs: Number(process.env.GEMINI_TIMEOUT_MS) || 150_000, ...req };
  return serial(async () => {
    const chain = MODELS();
    let last = null;
    for (let i = 0; i < chain.length; i++) {
      try { return { ...(await tryModel(chain[i], r, i === chain.length - 1)), fellBack: i > 0 }; }
      catch (e) {
        if (!(e instanceof GeminiError) || !e.fallbackable || e.code === "time_budget") throw e;
        last = e;
        if (i < chain.length - 1) console.warn(`[gemini] ${chain[i]}: ${e.code} — trying ${chain[i + 1]}`);
      }
    }
    throw last;
  });
}

module.exports = { chat, hasKey, MODELS, PRIMARY, GeminiError, _resetQuota: () => blockedUntil.clear() };
