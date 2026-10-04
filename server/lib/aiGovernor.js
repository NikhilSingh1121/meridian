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

/* what a finished call cost */
function record(feature, tokens = 0, searches = 0) {
  const s = load(), f = (s.byFeature[feature || "other"] = s.byFeature[feature || "other"] || { calls: 0, tokens: 0, searches: 0 });
  const t = Math.max(0, Math.round(+tokens || 0)), q = Math.max(0, Math.round(+searches || 0));
  s.calls++; s.tokens += t; s.searches += q;
  f.calls++; f.tokens += t; f.searches += q;
  save();
}

/* for the UI: is AI usable right now? (never exposes keys) */
function status() {
  const s = load(), L = LIMITS();
  const available = enabled() && s.tokens < L.dailyTokens;
  return { enabled: enabled(), available, day: s.day, tokens: s.tokens, searches: s.searches, calls: s.calls, refused: s.refused, limits: L, byFeature: s.byFeature };
}

module.exports = { allow, record, status, enabled, LIMITS };
