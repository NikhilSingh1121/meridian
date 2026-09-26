/**
 * Earnings-call analyser — the rule-based modules of the MTerminal framework
 * (answer quality, tone rubric, red flags, reconciliation, monitorables).
 * Inputs are the parsed call and the extracted facts; every output object
 * carries the page(s) it rests on (`cite`), and nothing is invented: where the
 * transcript is silent the module says so.
 */

/* ── Q&A analytics (M9) — rubric 4.2 ──────────────────────────────────── */
const REFUSE = /\b(we (don't|do not|won't|will not) (give|provide|share|comment|disclose|guide|break (it|this|that) (up|down))|not in a position to (share|comment|disclose|give)|can'?t (share|comment on|disclose)|cannot (share|comment|disclose)|no comments?\b|would not like to comment|decline to|not something we (share|disclose))/i;
const DEFLECT = /\b(let me not get into|not (get|go) into (the )?(quarter|specifics|details|granular)|without getting into (the )?specifics|(we'?ll|we will|let's|let us) (have to )?(wait and )?see\b|wait and (see|watch)|take (it|that|this) (further )?offline|(very |quite |a bit )?(difficult|hard|tough) to (say|predict|comment|quantify|allocate|split|break (it|this|that) (up|down)|give (a|an|the|you) (number|exact|precise|split)|pinpoint|put a number)|too early to (say|comment|call)|don'?t read too much|would not like to (get into|speculate|guess)|(i|we) (would|will) not (like to )?(get into|speculate)|let the situation stabili[sz]e|hard to (say|predict)|can'?t predict|not going to (give|get into))/i;
const FIGURE = /(?:₹|rs\.?|inr|us\$|\$)\s?\d|\d(?:[\d,.]*)\s?(?:%|bps|basis points?|crores?|cr\b|million|billion|mn\b|bn\b|mtpa|tons?|tonnes?|x\b)|\b(high|mid|low)[- ](single|double)[- ]digits?|\b(high|mid|low)[- ]teens?|\bdouble[- ]digits?/i;
const QA_THEMES = [
  ["Guidance & margins", /\b(guid\w*|outlook|target|margin|ebitda|profitab\w*|operating leverage|next year|fy ?\d{2})\b/i],
  ["Pricing & costs", /\b(pric\w*|realis\w*|realiz\w*|arpu|cost\w*|inflation|input|raw material|commodit\w*|crude|copra|coal|freight|tariff hike|wage\w*|salar\w*|headcount|attrition|utili[sz]ation|pyramid|subcontract\w*)\b/i],
  ["Demand & volumes", /\b(demand|volume\w*|consumption|offtake|rural|urban|growth rate|traction|footfall|order(s| book| inflow)?|disburse\w*|loan growth|credit growth|deal\w*|tcv|pipeline|clients?|customers?|discretionary|spend(s|ing)?|ramp[- ]?ups?|bfsi|verticals?|macro demand)\b/i],
  ["Asset quality", /\b(npa|slippage\w*|credit cost\w*|provision\w*|delinquen\w*|asset quality|stress|collection efficiency|write-?off)\b/i],
  ["Competition & share", /\b(compet\w*|market share|share gain\w*|peers?|players?|pricing power|disrupt\w*)\b/i],
  ["International / segments", /\b(international|export\w*|overseas|geograph\w*|us market|europe|bangladesh|mena|africa|vietnam|segment\w*|division)\b/i],
  ["New business & digital", /\b(new business\w*|digital|d2c|e-?commerce|quick commerce|launch\w*|innovation|new product\w*|ai\b|gen ?ai|agentic|automation|platform|brand\w*|premium\w*)\b/i],
  ["Capital & balance sheet", /\b(capex|capacity|acquisition\w*|m&a|inorganic|dividend|buyback|debt|leverage|cash flow|working capital|capital allocation|fund ?rais\w*|solvency|capital adequacy)\b/i],
  ["Regulation & macro", /\b(regulat\w*|policy|government|gst|rbi|sebi|fda|tariffs?|duty|geopolit\w*|war|monsoon|el nino|macro\w*|currency|rupee|interest rates?)\b/i],
];
// the theme with the most hits wins (a question on "margins after wage hikes" is about margins, not just costs)
function qaTheme(q) {
  let best = "Other topics", n = 0;
  for (const [name, re] of QA_THEMES) { const c = (String(q).match(new RegExp(re.source, "gi")) || []).length; if (c > n) { n = c; best = name; } }
  return best;
}
function scoreAnswer(question, answer) {
  const a = String(answer || ""), q = String(question || "");
  const aw = (a.match(/\S+/g) || []).length, subQs = (q.match(/\?/g) || []).length;
  const ref = a.match(REFUSE), dfl = a.match(DEFLECT), fig = FIGURE.test(a);
  if (!aw) return { score: null, label: "No answer recorded", phrase: null };
  if (ref && !fig) return { score: 1, label: "Refused", phrase: ref[0] };
  if (dfl && !fig) return { score: 2, label: "Deflected", phrase: dfl[0] };
  if (dfl && fig) return { score: 3, label: "Partial", phrase: dfl[0] };
  if (subQs >= 2 && aw < 70) return { score: 3, label: "Partial", phrase: null };
  if (fig) return { score: 5, label: "Direct + quantified", phrase: null };
  if (aw >= 25) return { score: 4, label: "Direct", phrase: null };
  return { score: 3, label: "Partial", phrase: null };
}
function qaAnalytics(exchanges) {
  const rows = exchanges.map((x) => ({ ...x, theme: qaTheme(x.questionFull || x.question), ...scoreAnswer(x.questionFull || x.question, x.answerFull || x.answer) }));
  const scored = rows.filter((r) => r.score != null);
  const avg = scored.length ? +(scored.reduce((s, r) => s + r.score, 0) / scored.length).toFixed(1) : null;
  // theme counts and the analyst × theme heat map
  const themes = {}, heat = {};
  for (const r of rows) {
    themes[r.theme] = (themes[r.theme] || 0) + 1;
    const who = r.firm || r.analyst || "Unnamed";
    (heat[who] ||= {})[r.theme] = (heat[who][r.theme] || 0) + 1;
  }
  const themeList = Object.entries(themes).map(([theme, n]) => {
    const t = rows.filter((r) => r.theme === theme && r.score != null);
    return { theme, questions: n, avgScore: t.length ? +(t.reduce((s, r) => s + r.score, 0) / t.length).toFixed(1) : null, analysts: [...new Set(rows.filter((r) => r.theme === theme).map((r) => r.firm || r.analyst).filter(Boolean))] };
  }).sort((a, b) => b.questions - a.questions);
  return { exchanges: rows, avgScore: avg, themes: themeList, heatmap: { themes: themeList.map((t) => t.theme), rows: Object.entries(heat).map(([who, m]) => ({ who, counts: m })) } };
}

/* ── tone (M10) — rubric 4.3 ──────────────────────────────────────────── */
const CONF = /\b(confident|confidence|will deliver|for sure|extremely|definitely|certainly|committed|on track|no doubt|absolutely|very (strong|good|happy|pleased|confident)|sticking (out )?our neck|firmly|clearly (see|believe)|we are sure|strongly believe|remain(s)? (strong|robust)|well[- ]placed|well[- ]positioned)\b/gi;
const HEDGE = /\b(subject to|difficult to (predict|say|comment)|hard to (say|predict)|(we'?ll|we will|let's) (have to )?see\b|wait and (see|watch)|if (the )?situations? (were to )?normali[sz]e|if things normali[sz]e|uncertain\w*|too early|remains to be seen|depends on|depending on|cautious\w*|might|may not|not sure|visibility (is )?(low|limited)|let the situation stabili[sz]e|volatil\w*|best case)\b/gi;
const MACRO = /\b(macro\w*|inflation\w*|crude|oil prices?|geopolit\w*|war|west asia|middle east|monsoon|el nino|weather|interest rates?|rates|currency|rupee|dollar|global|government|policy|regulat\w*|tariffs?|situation|environment|economy|economic|consumption|market conditions|demand environment|supply chain|shipping|commodit\w*|input (cost|price)s?|raw material|copra|coal|gas prices?|freight|client (budgets?|spending)|discretionary spend\w*)\b/i;
const count = (text, re) => (String(text || "").match(re) || []).length;
function toneBlock(text) {
  const w = Math.max(1, (String(text || "").match(/\S+/g) || []).length);
  const c = count(text, CONF), h = count(text, HEDGE);
  const share = c + h ? c / (c + h) : null;
  const score = share == null ? null : share >= 0.8 ? 5 : share >= 0.7 ? 4 : share >= 0.6 ? 3 : share >= 0.5 ? 2 : 1;
  return { words: w, confidence: c, hedges: h, confPerK: +(c / w * 1000).toFixed(1), hedgePerK: +(h / w * 1000).toFixed(1), share: share == null ? null : Math.round(share * 100), score };
}
function toneRubric(items, speakersOf) {
  const prep = items.filter((x) => x.prepared).map((x) => x.text).join(" ");
  const qa = items.filter((x) => !x.prepared).map((x) => x.text).join(" ");
  const remarks = toneBlock(prep), answers = qa ? toneBlock(qa) : null;
  const all = toneBlock(items.map((x) => x.text).join(" "));
  // per speaker in the Q&A (and overall for single-speaker calls)
  const bySp = {};
  for (const it of items) if (it.speaker) (bySp[it.speaker] ||= []).push(it.text);
  const speakers = Object.entries(bySp).map(([name, t]) => ({ name, ...toneBlock(t.join(" ")) })).filter((s) => s.words >= 250).sort((a, b) => b.words - a.words).slice(0, 6);
  // hedges by object: the macro environment vs the company's own execution
  const hedgeSents = items.filter((x) => count(x.text, HEDGE));
  const macroN = hedgeSents.filter((x) => MACRO.test(x.text)).length;
  const hedgeObjects = hedgeSents.length ? { macro: +(macroN / hedgeSents.length).toFixed(2), company: +(1 - macroN / hedgeSents.length).toFixed(2) } : null;
  const blended = remarks.score != null && answers && answers.score != null ? Math.round(remarks.score * 0.4 + answers.score * 0.6) : all.score;
  const profile = hedgeObjects ? (hedgeObjects.macro >= 0.65 ? "macro-hedged, execution-confident" : hedgeObjects.company >= 0.6 ? "hedged on the company's own execution" : "hedged on both macro and execution") : "few hedges";
  return { remarks, answers, overall: all, blendedScore: blended, speakers, hedgeObjects, profile, drop: remarks.score != null && answers && answers.score != null ? remarks.score - answers.score : null };
}
const SIGNATURE = [
  [/\bif (the )?(situation|situations|things|conditions|crude|prices|macro)\b[^.]{0,80}\b(normali[sz]e|stabili[sz]e|improve|settle|ease)/i, "Key condition on the outlook"],
  [/\bbest[- ]case\b/i, "Caution — the guidance has little cushion"],
  [/\b(sticking (out )?our neck|very confident|for sure|we are committed|firmly believe|no doubt)\b/i, "Conviction"],
  [/\b(biggest|main|key) (enemy|risk|worry|concern|headwind)\b/i, "Names the main downside"],
  [/\b(wait and see|we'?ll see|let's see)\b/i, "Open-ended — no commitment"],
  [/\b(don'?t know where you are coming from|not conservative|i disagree|that's not (right|correct))\b/i, "Defensive on pushback"],
  [/\b(vectors of growth|strings? (not )?working|multiple engines|diversif\w*)\b/i, "Diversification narrative"],
  [/\b(one-?off|exceptional|non-recurring)\b/i, "Flags a one-off"],
];
function signaturePhrases(items) {
  const out = [], seen = new Set();
  for (const [re, read] of SIGNATURE) {
    for (const it of items) {
      const m = it.text.match(re); if (!m) continue;
      // quote the sentence, trimmed at a word boundary
      const q = it.text.length <= 200 ? it.text : it.text.slice(0, 200).replace(/\s+\S*$/, "") + "…";
      const k = q.toLowerCase().slice(0, 40);
      if (seen.has(k) || q.length < 12) continue; seen.add(k);
      out.push({ text: q, speaker: it.speaker, page: it.page, read });
      break;
    }
  }
  return out.slice(0, 8);
}

/* ── guidance reconciliation (M7) — do the components add up? ──────────── */
function reconcile(guidance) {
  const pick = (re) => guidance.find((g) => re.test(g.statement) && g.low != null && g.high != null && /bps|basis/i.test(g.target || g.statement));
  const gm = pick(/gross margin/i), ap = pick(/\b(a&p|advertis\w*|ad spends?|brand investment)\b/i), eb = pick(/\bebitda margin|operating margin\b/i);
  if (!gm || !eb) return null;
  const mid = (g) => (g.low + g.high) / 2;
  const implied = mid(gm) - (ap ? mid(ap) : 0);
  const stated = mid(eb);
  return {
    components: [`Gross margin +${gm.low}–${gm.high} bps`, ap ? `A&P +${ap.low}–${ap.high} bps` : null].filter(Boolean),
    implied: `+${Math.round(implied)} bps EBITDA margin`, stated: `+${eb.low}–${eb.high} bps`,
    reconciles: Math.abs(implied - stated) <= 50, cite: [gm.page, ap && ap.page, eb.page].filter((x) => x != null),
  };
}

/* ── red flags, evasions and inconsistencies (M11) ─────────────────────── */
const SEV = { high: 3, medium: 2, low: 1 };
function redFlags({ items, guidance, qa, rawText }) {
  const flags = [];
  // evidence quotes are cut at a word boundary, never mid-word
  const cut = (t, n = 240) => (t.length <= n ? t : t.slice(0, n).replace(/\s+\S*$/, "") + "…");
  const add = (flag, evidence, severity, action, cite) => flags.push({ flag, evidence: cut(String(evidence)), severity, action, cite: (cite || []).filter((x) => x != null) });
  const find = (re) => items.find((x) => re.test(x.text) && !/\?\s*["')]?\s*$/.test(x.text));   // statements only, not questions
  // conditional / best-case guidance
  const condRaised = guidance.find((g) => g.condition && g.vsPrior === "raised" && g.committed);
  const condAny = guidance.filter((g) => g.condition && g.quantified && g.hasMetric && g.committed);
  const best = find(/\bbest[- ]case\b/i);
  if (condRaised) add("Upgrade is conditional", `${condRaised.metric || "Guidance"} raised, but "${condRaised.condition}"${best ? `; "${best.text.slice(0, 90)}…"` : ""}`, "high", "Treat the raised guide as the ceiling, not the base; model a stress case for the condition.", [condRaised.page, best && best.page]);
  else if (condAny.length) add("Guidance carries conditions", condAny.slice(0, 2).map((g) => `${g.metric || "Guidance"}: "${g.condition}"`).join("; "), best ? "high" : "medium", "Track the stated condition; the guide is at risk if it does not hold.", condAny.slice(0, 2).map((g) => g.page));
  else if (best) add("Outlook framed as a best case", `"${best.text.slice(0, 140)}"`, "medium", "Assume little cushion in the guidance.", [best.page]);
  // cuts
  const guideCut = guidance.find((g) => g.vsPrior === "cut" && g.hasMetric);
  if (guideCut) add("Guidance cut", guideCut.statement, "high", "Revisit estimates for the affected metric.", [guideCut.page]);
  // evasions
  const weak = qa.exchanges.filter((x) => x.score != null && x.score <= 2);
  const byTheme = {};
  for (const x of weak) (byTheme[x.theme] ||= []).push(x);
  // a single "we don't guide on that" is usually standing policy (low); a pattern of non-answers is not (medium)
  for (const [theme, list] of Object.entries(byTheme)) {
    if (list.length >= 2) add(`Repeated non-answers on ${theme.toLowerCase()}`, list.map((x) => `${x.firm || x.analyst || "Analyst"}: "${x.phrase || x.label}"`).join("; "), "medium", `Press on ${theme.toLowerCase()} next quarter.`, list.map((x) => x.page));
    else list.forEach((x) => add(`${x.label} — ${theme.toLowerCase()}`, `${x.firm || x.analyst || "Analyst"} asked: "${x.question.slice(0, 110)}" — answer: "${x.phrase || x.label}"`, "low", "Ask again on the next call.", [x.page]));
  }
  const scoredN = qa.exchanges.filter((x) => x.score != null).length;
  if (weak.length >= 4 && scoredN && weak.length / scoredN >= 0.2) add("Frequent non-answers", `${weak.length} of ${scoredN} questions were deflected or declined.`, "medium", "Weigh management's qualitative claims accordingly.", []);
  // inconsistencies: the same metric guided on two bases
  const byMetric = {};
  for (const g of guidance.filter((g) => g.target && g.metric)) (byMetric[g.metric + "|" + (g.period || "")] ||= []).push(g);
  let inconsistent = false;
  for (const list of Object.values(byMetric)) {
    const ts = [...new Set(list.map((g) => g.target))];
    if (ts.length > 1 && list.every((g) => g.low != null || /%|bps/.test(g.target))) { inconsistent = true; add(`${list[0].metric} guided on two bases`, ts.slice(0, 3).map((t, i) => `${t} (p.${list[i] && list[i].page != null ? list[i].page : "?"})`).join(" vs "), "low", "Ask which base is official; keep both, do not average.", list.map((g) => g.page)); }
  }
  // accounting / auditor / one-offs / leverage
  const acct = find(/\b(auditor|qualified opinion|restat(e|ed|ement)|change in accounting|accounting (policy|change)|emphasis of matter)\b/i);
  if (acct) add("Accounting or auditor language", `"${acct.text.slice(0, 150)}"`, "high", "Read the auditor's report and notes to accounts.", [acct.page]);
  const one = find(/\b(one-?off|exceptional (item|gain|loss|income)|non-recurring|write-?(off|down)|impairment|reversal of provision)\b/i);
  if (one) add("One-off item mentioned", `"${one.text.slice(0, 150)}"`, "medium", "Adjust the base for the one-off before comparing growth.", [one.page]);
  const lev = find(/\b(working capital (stretch|pressure|went up|increased)|receivables? (went up|increased|stretch)|debt (went up|increased|rose)|liquidity (pressure|tight)|higher borrowings)\b/i);
  if (lev) add("Working-capital or leverage pressure", `"${lev.text.slice(0, 150)}"`, "medium", "Check the cash-flow statement and net debt.", [lev.page]);
  if (/edited (to improve|for) (readability|clarity)|may not be (a )?verbatim|has been edited/i.test(rawText || "")) add("Transcript is edited", "The transcript notes it was edited for readability — quotes may not be verbatim.", "low", "Cross-check key lines against the call audio.", []);
  flags.sort((a, b) => SEV[b.severity] - SEV[a.severity]);
  const clean = [["accounting", !acct], ["auditor", !acct], ["one_offs", !one], ["leverage", !lev], ["guidance_consistency", !inconsistent], ["guidance_cut", !guideCut]].filter(([, ok]) => ok).map(([k]) => k);
  const level = flags.length ? Object.keys(SEV).find((k) => SEV[k] === Math.max(...flags.map((f) => SEV[f.severity]))) : "low";
  return { flags: flags.slice(0, 12), clean, level };
}

/* ── monitorables (M12) — thresholds from management's own words ─────── */
const VERBAL = [
  [/low[- ]single[- ]digits?/i, 1, 3], [/mid[- ]single[- ]digits?/i, 4, 6], [/high[- ]single[- ]digits?/i, 7, 9],
  [/low[- ]double[- ]digits?|early double[- ]digits?/i, 10, 12], [/double[- ]digits?/i, 10, null], [/low[- ]teens?/i, 11, 13],
  [/mid[- ]teens?/i, 14, 16], [/high[- ]teens?/i, 17, 19], [/low[- ]twenties/i, 20, 23], [/mid[- ]twenties/i, 24, 26], [/high[- ]twenties/i, 27, 29],
];
function thresholds(g) {
  let lo = null, unit = "%";
  if (g.low != null) { lo = g.low; unit = /bps/.test(g.target || "") ? " bps" : "%"; }
  else { for (const [re, a] of VERBAL) if (re.test(g.target || g.statement)) { lo = a; break; } }
  if (lo == null) { const m = String(g.target || "").match(/^(\d+(?:\.\d+)?)\s?%/); if (m) lo = +m[1]; }
  if (lo == null) return null;
  const band = unit === "%" ? Math.max(2, Math.round(lo * 0.3)) : Math.round(lo * 0.3);
  return { pass: `≥${lo}${unit}`, watch: `${Math.max(0, lo - band)}–${lo}${unit}`, fail: `<${Math.max(0, lo - band)}${unit}` };
}
function monitorables(guidance, flags) {
  const out = [], seen = new Set();
  for (const g of guidance) {
    // only a business metric with a forward target in management's words (not a statistic that happens to sit in the sentence)
    if (!g.hasMetric || !(g.low != null || /single|double|teens|twenties/i.test(g.target || "") || /\b(growth of|grow (by|at)|to grow|margin(s)? of|to reach|at least)\s*(about\s*|around\s*)?\d/i.test(g.statement))) continue;
    const th = thresholds(g); if (!th) continue;
    const k = (g.metric || "") + (g.period || ""); if (seen.has(k)) continue; seen.add(k);
    out.push({ kpi: `${g.metric || "Guided metric"}${g.period ? ` (${g.period})` : ""}`, management: g.target + (g.condition ? ` — ${g.condition}` : ""), ...th, cite: [g.page].filter((x) => x != null) });
  }
  return out.slice(0, 12);
}
function nextQuestions({ flags, qa, guidance, recon }) {
  const qs = [];
  for (const f of flags) {
    if (/upgrade is conditional/i.test(f.flag)) qs.push("Is the raised guidance still conditional, and at what level of the stated condition does it break?");
    else if (/carries conditions/i.test(f.flag)) qs.push("Do the conditions attached to the guidance still hold, and what happens to the guide if they do not?");
    else if (/two bases/i.test(f.flag)) qs.push(`${f.flag.replace(/ guided on two bases/, "")}: which base does the guidance use?`);
    else if (/one-off/i.test(f.flag)) qs.push("What was the size of the one-off item, and what is growth excluding it?");
  }
  for (const x of qa.exchanges.filter((e) => e.score != null && e.score <= 2).slice(0, 3)) {
    const ask = (x.question.split(/(?<=[.?!])\s+(?=[A-Z])/).find((p) => /\?/.test(p)) || x.question).trim();
    const short = ask.length > 150 ? ask.slice(0, 150).replace(/\s+\S*$/, "") + "…" : ask.replace(/\?*$/, "?");
    qs.push(`${x.theme} (${x.label.toLowerCase()} last call): ${short}`);
  }
  if (recon && !recon.reconciles) qs.push("The component guides do not add up to the EBITDA-margin guide — what closes the gap?");
  for (const g of guidance.filter((x) => x.hasMetric && x.target && (x.low != null || /single|double|teens/i.test(x.target))).slice(0, 2)) qs.push(`Is the ${g.metric.toLowerCase()} guide of ${g.target}${g.period ? ` for ${g.period}` : ""} still on track?`);
  return [...new Set(qs)].slice(0, 6);
}

module.exports = { qaAnalytics, scoreAnswer, qaTheme, toneRubric, toneBlock, signaturePhrases, reconcile, redFlags, monitorables, nextQuestions, thresholds };
