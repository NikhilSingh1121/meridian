/**
 * Research-layer validator — applied to every sentence the synthesis model
 * writes, before anything reaches the report.
 *
 * A sentence is REMOVED when it:
 *   · states a figure that appears neither in the deterministic facts nor in
 *     a verified evidence claim — and a figure found only in evidence must be
 *     cited to that evidence item ([E#]) in the same sentence
 *   · cites an evidence id that does not exist in the pack
 *   · issues a rating / price target / fair value of its own
 *   · asserts an overall moat rating different from the report's scorecard
 *   · uses self-referential or promotional language
 * Everything else passes through untouched; [E#] markers are kept for the
 * renderer to turn into source references.
 */

// figures worth checking: unit-bearing numbers, currency amounts, and any
// number with thousands separators or decimals (years are exempt)
const FIG_RE = /(?:[₹$€£]\s?)?-?\d[\d,]*(?:\.\d+)?\s?(?:%|pp\b|bps?\b|x\b|×|bn\b|billion|mn\b|million|crores?\b|cr\b|lakh|trillion|k\b)|[₹$€£]\s?-?\d[\d,]*(?:\.\d+)?|\b\d{1,3}(?:,\d{2,3})+(?:\.\d+)?\b|\b\d+\.\d+\b/gi;

function collectNumbers(node, out = []) {
  if (node == null) return out;
  if (typeof node === "number" && isFinite(node)) out.push(Math.abs(node));
  else if (Array.isArray(node)) node.forEach((x) => collectNumbers(x, out));
  else if (typeof node === "object") Object.values(node).forEach((x) => collectNumbers(x, out));
  else if (typeof node === "string") for (const m of node.matchAll(/\d[\d,]*(?:\.\d+)?/g)) { const v = parseFloat(m[0].replace(/,/g, "")); if (isFinite(v)) out.push(v); }
  return out;
}
const near = (a, b) => Math.abs(a - b) <= Math.max(0.051, Math.abs(b) * 0.006);
const figValue = (raw) => parseFloat(String(raw).replace(/[₹$€£,\s]/g, ""));

const BANNED = /\b(as an ai|ai (believes|says|thinks|view|analysis)|language model|chatgpt|\bgpt\b|llm|game[- ]changer|strong signal|the market will love|could explode|this validates the thesis|interestingly|exciting|here'?s what we think|in conclusion|it is worth noting|delve)\b/i;
const RATING = /\b(we|i)\s+(recommend|rate|would\s+(buy|sell|accumulate))\b|\b(upgrade|downgrade)\s+(to|the stock)\b|\bour\s+(new\s+)?(target|rating|fair value)\b|\b(re-?rate|revise)\s+(our|the)\s+(rating|target)\b/i;

/* grouped citations — "[E12, E30]", "[FACTS, E12]", "[E3; E4]", "(E7)" — become
   one marker per item, "[E12][E30]"; a bracket that only says FACTS is dropped */
function normCites(t) {
  return String(t)
    .replace(/[[(]((?:\s*(?:E\d+|FACTS?)\s*[,;&]?\s*(?:and\s+)?)+)[\])]/gi, (m, inner) => {
      const ids = [...inner.matchAll(/E(\d+)/gi)].map((x) => `[E${x[1]}]`);
      return ids.join("");
    })
    .replace(/\s+([.,;])/g, "$1");
}

function splitSentences(p) {
  return String(p).replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+(?=[A-Z₹$"“(\[])/).filter(Boolean);
}

function makeValidator({ facts, evidence, moatOverall, officialTarget, streetTarget }) {
  const factNums = collectNumbers(facts);
  const byId = new Map((evidence || []).map((e) => [e.id, e]));
  const evNums = new Map((evidence || []).map((e) => [e.id, collectNumbers(e.claim)]));
  // removed sentences are kept (capped) for auditing — never rendered
  const stats = { sentences: 0, dropped: 0, reasons: {}, removed: [] };
  let cur = "";
  const drop = (why) => { stats.dropped++; stats.reasons[why] = (stats.reasons[why] || 0) + 1; if (stats.removed.length < 40) stats.removed.push({ why, sentence: cur.slice(0, 240) }); return null; };

  function sentence(s) {
    stats.sentences++;
    cur = String(s || "");
    let t = normCites(s.trim());
    if (!t) return null;
    if (BANNED.test(t)) return drop("style");
    if (RATING.test(t)) return drop("rating");
    // citations: keep valid ones, strip unknown ids
    const cites = [...t.matchAll(/\[E(\d+)\]/g)].map((m) => +m[1]);
    const valid = cites.filter((id) => byId.has(id));
    if (cites.length && !valid.length) return drop("bad_citation");
    t = t.replace(/\[E(\d+)\]/g, (m, id) => (byId.has(+id) ? m : "")).replace(/\s+([.,;])/g, "$1");
    // figures
    for (const m of t.matchAll(FIG_RE)) {
      // magnitudes are compared: facts and evidence numbers are stored unsigned,
      // so "−38.5%" must match the fact 38.5 (the sign is the sentence's wording)
      const v = Math.abs(figValue(m[0]));
      if (!isFinite(v) || (Number.isInteger(v) && v >= 1990 && v <= 2100)) continue;
      if (factNums.some((n) => near(v, n))) continue;
      if (valid.some((id) => (evNums.get(id) || []).some((n) => near(v, n)))) continue;
      return drop("ungrounded_figure");
    }
    // a price target other than the official / consensus one
    // — only the amount attached to the word "target" is checked, so a sentence may
    //   also mention the current price or the DCF value alongside the official target
    if (/\btarget\b/i.test(t)) {
      const near_target = /\btarget(?:\s+price)?(?:\s+(?:of|at|is|to|stands at|set at))?\s*(?:of\s*)?([₹$]\s?\d[\d,]*(?:\.\d+)?)|([₹$]\s?\d[\d,]*(?:\.\d+)?)\s*(?:\(\s*)?(?:12-month\s+|official\s+|blended\s+|price\s+)*target\b/gi;
      for (const mm of t.matchAll(near_target)) {
        const m = [mm[1] || mm[2]];
        const v = figValue(m[0]);
        if (officialTarget && near(v, officialTarget)) continue;
        if (streetTarget && near(v, streetTarget)) continue;
        if (valid.length) continue;           // a cited external target (e.g. brokerage) is context, not ours
        return drop("target");
      }
    }
    // a cash conversion CYCLE is measured in days — a % is the conversion ratio
    if (/cash conversion cycle/i.test(t) && /\d\s*%/.test(t)) return drop("terminology");
    // overall moat rating must match the scorecard
    const mo = t.match(/\b(wide|narrow|no)[- ](economic\s+)?moats?\b/i) || t.match(/\bmoats?\s+(?:is|are|remains?|appears?|looks?)\s+(?:\w+\s+)?(wide|narrow)\b/i);
    if (mo && moatOverall && mo[1].toLowerCase() !== (moatOverall === "None" ? "no" : moatOverall.toLowerCase())) return drop("moat");
    return t;
  }
  const para = (p) => { const kept = splitSentences(p).map(sentence).filter(Boolean); return kept.length ? kept.join(" ") : ""; };
  const paras = (list) => (Array.isArray(list) ? list : []).map(para).filter(Boolean);
  const cell = (s) => (typeof s === "string" ? para(s) : "");
  const ids = (list) => (Array.isArray(list) ? [...new Set(list.filter((i) => Number.isInteger(i) && byId.has(i)))] : []);
  return { para, paras, cell, ids, stats };
}

module.exports = { makeValidator, collectNumbers, splitSentences, FIG_RE };
