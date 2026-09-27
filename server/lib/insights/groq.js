/**
 * M-TERMINAL — Groq client (OpenAI-compatible chat completions) for the assistant chat.
 *
 *   · small interactive calls only: JSON answers, and web research through Groq's built-in
 *     browser_search tool on the gpt-oss models
 *   · an ordered model chain (GROQ_MODELS); the next model is tried only for recoverable
 *     failures (rate limit, overloaded, unusable output), never for a bad key
 *   · plain fetch; the key travels only in the Authorization header — never in a URL,
 *     log line, error or response
 */
const BASE = "https://api.groq.com/openai/v1";
const DEFAULT_CHAIN = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];
const MODELS = () => {
  const env = String(process.env.GROQ_MODELS || "").split(",").map((m) => m.trim()).filter(Boolean);
  return env.length ? env : DEFAULT_CHAIN;
};
const PLACEHOLDER = /^(your_groq_api_key_here|<.*>|changeme)$/i;
const key = () => String(process.env.GROQ_API_KEY || "").trim();
const hasKey = () => !!key() && !PLACEHOLDER.test(key());

class GroqError extends Error {
  constructor(code, message, fallbackable = false) { super(message); this.code = code; this.fallbackable = fallbackable; }
}

async function callOnce(model, { messages, json, maxTokens, search, timeoutMs }) {
  const body = { model, messages, max_completion_tokens: maxTokens, temperature: 0.3 };
  if (/gpt-oss/.test(model)) body.reasoning_effort = "low";
  if (json && !search) body.response_format = { type: "json_object" };
  if (search) body.tools = [{ type: "browser_search" }];
  let res;
  try {
    res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key()}` },
      body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new GroqError("network", e && e.name === "TimeoutError" ? "no response in time" : "network error reaching Groq", true);
  }
  if (!res.ok) {
    let code = "";
    try { const j = await res.json(); code = String((j.error && (j.error.code || j.error.type)) || "").slice(0, 40); } catch { }
    const why = `Groq HTTP ${res.status}${code ? ` (${code})` : ""}`;
    if (res.status === 401 || res.status === 403) throw new GroqError("auth", why);
    if (res.status === 429 || res.status >= 500 || res.status === 404) throw new GroqError("upstream", why, true);
    // tool or JSON-mode refusal on this model — let the next model try
    throw new GroqError("bad_request", why, /tool|json|response_format|model/i.test(code));
  }
  const data = await res.json().catch(() => null);
  const msg = data && data.choices && data.choices[0] && data.choices[0].message;
  const text = String((msg && msg.content) || "").trim();
  if (!text) throw new GroqError("empty", "empty completion", true);
  const out = { content: text, usage: { total_tokens: (data.usage && data.usage.total_tokens) || 0 }, model: data.model || model, urls: [] };
  // browser_search results come back on the message as executed_tools[].search_results
  for (const t of (msg.executed_tools || [])) {
    const r = t.search_results && (t.search_results.results || t.search_results);
    if (Array.isArray(r)) for (const x of r) if (x && x.url) out.urls.push({ url: x.url, title: x.title || x.url });
  }
  if (json) {
    const m = text.match(/\{[\s\S]*\}/);
    try { out.json = JSON.parse(m ? m[0] : text); } catch { throw new GroqError("malformed", "completion was not valid JSON", true); }
  }
  return out;
}

/**
 * @param req { messages:[{role, content}], json?: bool, search?: bool, maxTokens, timeoutMs }
 * @returns { content, json?, urls, usage, model }
 */
async function chat(req) {
  if (!hasKey()) throw new GroqError("no_key", "GROQ_API_KEY not configured");
  const r = { maxTokens: 1200, timeoutMs: 30_000, ...req };
  const chain = MODELS().filter((m) => !r.search || /gpt-oss/.test(m));   // browser_search is a gpt-oss tool
  let last = null;
  for (const model of chain) {
    try { return await callOnce(model, r); }
    catch (e) { if (!(e instanceof GroqError) || !e.fallbackable) throw e; last = e; }
  }
  throw last || new GroqError("no_model", "no Groq model available");
}

module.exports = { chat, hasKey, MODELS, GroqError };
