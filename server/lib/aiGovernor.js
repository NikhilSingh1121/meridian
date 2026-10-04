/**
 * M-TERMINAL — AI governor: one place that decides whether an AI call may run,
 * and counts what every call costs.
 *
 *   · AI_ENABLED=0 (or off/false) turns every AI feature off; the app then runs
 *     fully deterministic and the UI hides every AI element (see status()).
 *   · Daily site-wide caps (UTC day): AI_DAILY_TOKENS (input + output + thinking,
 *     all models) and AI_DAILY_SEARCHES (web-search-grounded calls, which Google
 *     bills per request). Past a cap, calls are refused until the next UTC day and
 *     the features fall back to their deterministic versions.
 *   · Every Gemini / Groq call goes through allow() before it is sent and record()
 *     after it returns — no feature can bypass the budget.
 * Counters are kept in memory and mirrored to the datastore so a restart within
 * the day doesn't reset the budget.
 */
const DS = require("./datastore");

const BLOB = "ai_usage";
const num = (v, d) => (Number.isFinite(+v) && +v >= 0 && String(v).trim() !== "" ? +v : d);
const LIMITS = () => ({
  dailyTokens: num(process.env.AI_DAILY_TOKENS, 1_500_000),   // ≈ $1–2 a day on Flash-Lite
  dailySearches: num(process.env.AI_DAILY_SEARCHES, 40),
});
const enabled = () => !/^(0|off|false|no)$/i.test(String(process.env.AI_ENABLED || "").trim());
const today = () => new Date().toISOString().slice(0, 10);

let state = null;
function load() {
  if (state && state.day === today()) return state;
  let saved = null;
  try { saved = DS.getBlob(BLOB); } catch { saved = null; }
  state = saved && saved.day === today() ? saved : { day: today(), tokens: 0, searches: 0, calls: 0, refused: 0, byFeature: {} };
  return state;
}
let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; try { DS.setBlob(BLOB, state); } catch { /* best-effort */ } }, 2000);
  if (saveTimer.unref) saveTimer.unref();
}

/* may this call run? search = the call uses a web-search tool */
function allow({ search = false } = {}) {
  if (!enabled()) return { ok: false, reason: "ai_off" };
  const s = load(), L = LIMITS();
  if (s.tokens >= L.dailyTokens) { s.refused++; save(); return { ok: false, reason: "budget" }; }
  if (search && s.searches >= L.dailySearches) { s.refused++; save(); return { ok: false, reason: "search_budget" }; }
  return { ok: true };
}

/* ── price list (USD per million tokens) for the cost estimate in the logs ──
   Matched by model-name prefix, longest first. Unknown models are logged without
   a cost. Override or extend with AI_PRICES='{"gemini-3.5-flash":[0.5,3]}'. */
const BASE_PRICES = { "gemini-3.5-flash-lite": [0.30, 2.50], "claude-sonnet": [3, 15] };
function prices() {
  let extra = {};
  try { extra = JSON.parse(process.env.AI_PRICES || "{}"); } catch { extra = {}; }
  return { ...BASE_PRICES, ...extra };
}
function costOf(model, inTok, outTok) {
  const P = prices(), m = String(model || "").toLowerCase();
  const k = Object.keys(P).filter((x) => m.startsWith(x.toLowerCase())).sort((a, b) => b.length - a.length)[0];
  if (!k || !Array.isArray(P[k])) return null;
  return (inTok * P[k][0] + outTok * P[k][1]) / 1e6;
}
const n0 = (v) => Math.max(0, Math.round(+v || 0));
const fmt = (v) => n0(v).toLocaleString("en-US");

/**
 * What a finished call cost. `usage` is a number (total) or
 * { total_tokens, input, tool, output, thinking }; info = { model, tag }.
 * Every call is written to the server log (Render → Logs) as one line:
 *   [ai] report · RELIANCE.NS write:summary · gemini-3.5-flash-lite · in 6,210 · out 2,050 · think 640 · total 8,900 · ≈$0.0076 · today 152,300 / 1,500,000
 */
function record(feature, usage = 0, searches = 0, info = {}) {
  const u = typeof usage === "object" && usage ? usage : { total_tokens: usage };
  const s = load(), key = feature || "other", f = (s.byFeature[key] = s.byFeature[key] || { calls: 0, tokens: 0, searches: 0 });
  const t = n0(u.total_tokens), q = n0(searches);
  s.calls++; s.tokens += t; s.searches += q;
  f.calls++; f.tokens += t; f.searches += q;
  const inTok = n0(u.input) + n0(u.tool), outTok = n0(u.output) + n0(u.thinking);
  const cost = inTok || outTok ? costOf(info.model, inTok, outTok) : null;
  if (cost != null) { s.costUsd = (s.costUsd || 0) + cost; f.costUsd = (f.costUsd || 0) + cost; }
  save();
  if (process.env.AI_LOG !== "0") {
    const parts = [`[ai] ${key}`];
    if (info.tag) parts.push(String(info.tag).slice(0, 60));
    if (info.model) parts.push(info.model);
    if (inTok || outTok) {
      parts.push(`in ${fmt(u.input)}${n0(u.tool) ? ` + docs ${fmt(u.tool)}` : ""}`, `out ${fmt(u.output)}`);
      if (n0(u.thinking)) parts.push(`think ${fmt(u.thinking)}`);
    }
    parts.push(`total ${fmt(t)}`);
    if (q) parts.push(`${q} search${q > 1 ? "es" : ""}`);
    if (cost != null) parts.push(`≈$${cost.toFixed(4)}`);
    parts.push(`today ${fmt(s.tokens)} / ${fmt(LIMITS().dailyTokens)}${s.costUsd ? ` (≈$${s.costUsd.toFixed(2)})` : ""}`);
    console.log(parts.join(" · "));
  }
}

/* for the UI: is AI usable right now? (never exposes keys) */
function status() {
  const s = load(), L = LIMITS();
  const available = enabled() && s.tokens < L.dailyTokens;
  return { enabled: enabled(), available, day: s.day, tokens: s.tokens, searches: s.searches, calls: s.calls, refused: s.refused, limits: L, byFeature: s.byFeature };
}

module.exports = { allow, record, status, enabled, LIMITS };
