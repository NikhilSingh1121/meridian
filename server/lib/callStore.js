/**
 * Earnings-call context store — what each company guided on each call.
 *
 * A single transcript cannot say whether guidance was raised; the previous
 * call's guidance can. Stored per ticker per quarter (small JSON files, the
 * same durability as the research cache), used to set `vsPrior` on guidance
 * items and to grade last quarter's monitorables into a credibility score.
 */
const fs = require("fs");
const path = require("path");

const DIR = process.env.MERIDIAN_CALLS_DIR || path.join(__dirname, "..", "data", "calls");
const fileOf = (sym) => path.join(DIR, String(sym).toUpperCase().replace(/[^A-Z0-9.&-]/g, "_") + ".json");
const read = (sym) => { try { return JSON.parse(fs.readFileSync(fileOf(sym), "utf8")); } catch { return { calls: {} }; } };
// "Q1 FY27" → 27*4+1 for ordering
const ord = (p) => { const m = String(p || "").match(/Q([1-4]) FY(\d{2})/); return m ? +m[2] * 4 + +m[1] : null; };
const norm = (s) => String(s || "").toLowerCase().replace(/\s+—\s+.*$/, "").replace(/[^a-z ]/g, "").trim();
const mid = (g) => (g.low != null && g.high != null ? (g.low + g.high) / 2 : null);
const VERBAL_MID = [[/low[- ]single/i, 2], [/mid[- ]single/i, 5], [/high[- ]single/i, 8], [/low[- ]double|early double/i, 11], [/double[- ]digit/i, 11], [/low[- ]teens?/i, 12], [/mid[- ]teens?/i, 15], [/high[- ]teens?/i, 18], [/low[- ]twenties/i, 21], [/mid[- ]twenties/i, 25]];
const level = (g) => { const m = mid(g); if (m != null) return m; for (const [re, v] of VERBAL_MID) if (re.test(g.target || "")) return v; const n = String(g.target || "").match(/^(\d+(?:\.\d+)?)\s?%/); return n ? +n[1] : null; };

function save(symbol, period, analysis) {
  if (!symbol || !ord(period)) return;
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const d = read(symbol);
    d.calls[period] = {
      savedAt: new Date().toISOString(), callDate: analysis.meta.callDate || null,
      guidance: analysis.guidance.filter((g) => g.hasMetric && g.target).map((g) => ({ metric: g.metric, period: g.period, target: g.target, low: g.low, high: g.high, page: g.page })),
      monitorables: analysis.monitorables,
    };
    const f = fileOf(symbol), tmp = f + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(d)); fs.renameSync(tmp, f);
  } catch (e) { console.warn("[calls] store write failed:", e.message); }
}

// the most recent stored call before this one
function prior(symbol, period) {
  if (!symbol || !ord(period)) return null;
  const d = read(symbol);
  const earlier = Object.keys(d.calls).filter((p) => ord(p) && ord(p) < ord(period)).sort((a, b) => ord(b) - ord(a));
  return earlier.length ? { period: earlier[0], ...d.calls[earlier[0]] } : null;
}

/* compare this call's guidance with the prior call's and grade last quarter's monitorables */
function applyPrior(analysis, pr) {
  if (!pr) { analysis.context = { prior: null, note: "No earlier call for this company in the context store — revisions and credibility need at least two calls." }; return analysis; }
  let compared = 0;
  for (const g of analysis.guidance) {
    if (!g.hasMetric || !g.target) continue;
    const p = pr.guidance.find((x) => norm(x.metric) === norm(g.metric) && (!x.period || !g.period || x.period === g.period));
    if (!p) continue;
    const a = level(g), b = level(p);
    compared++;
    g.priorTarget = p.target; g.priorPeriod = pr.period;
    if (g.vsPrior) continue;                                        // the transcript's own words take precedence
    g.vsPrior = a == null || b == null ? (g.target === p.target ? "maintained" : null) : a > b + 0.5 ? "raised" : a < b - 0.5 ? "cut" : "maintained";
  }
  // credibility: last call's monitorables graded against this call's stated growth figures
  const graded = [];
  for (const m of pr.monitorables || []) {
    const f = analysis.facts.find((x) => norm(x.metric) === norm(m.kpi.replace(/\s*\(.*\)$/, "")) && x.change && /%/.test(x.change));
    if (!f) continue;
    const v = parseFloat(f.change), pass = parseFloat(String(m.pass).replace(/[^\d.]/g, "")), fail = parseFloat(String(m.fail).replace(/[^\d.]/g, ""));
    if (!Number.isFinite(v) || !Number.isFinite(pass)) continue;
    graded.push({ kpi: m.kpi, guided: m.management, actual: f.change, result: v >= pass ? "pass" : Number.isFinite(fail) && v < fail ? "fail" : "watch", page: f.page });
  }
  const delivered = graded.filter((g) => g.result === "pass").length;
  analysis.context = { prior: { period: pr.period, callDate: pr.callDate }, compared, graded };
  analysis.snapshot.scores.credibility = graded.length >= 2 ? { delivered, graded: graded.length, share: Math.round((delivered / graded.length) * 100) } : null;
  return analysis;
}

module.exports = { save, prior, applyPrior, ord };
