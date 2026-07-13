/* Earnings Call intelligence.
   Transcript source: API Ninjas (/v1/earningstranscript + /v1/earningstranscriptsearch),
   gated behind API_NINJAS_KEY. The FREE/base tier returns the raw `transcript` string;
   the analysis below (sentiment, guidance, competitor/risk mentions, topics, tone) is
   computed deterministically by Meridian so it works on any tier. When the account tier
   returns the richer fields (overall_sentiment, guidance, transcript_split…), we surface
   those too. Everything is auditable; nothing is fabricated.

   Network note: api.api-ninjas.com must be reachable from the host (it is from a normal
   machine; the build sandbox is firewalled, so this is exercised on the user's machine). */

const NINJA_BASE = "https://api.api-ninjas.com/v1";
const hasNinjaKey = () => !!process.env.API_NINJAS_KEY;
const FMP_BASE = "https://financialmodelingprep.com/stable";
const hasFmpKey = () => !!process.env.FMP_API_KEY;

async function fmpGet(path, params) {
  if (!hasFmpKey()) throw new Error("NO_FMP_KEY");
  const url = new URL(FMP_BASE + path);
  Object.entries(params || {}).forEach(([k, v]) => { if (v != null && v !== "") url.searchParams.set(k, v); });
  url.searchParams.set("apikey", process.env.FMP_API_KEY);
  const r = await fetch(url);
  if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error(`FMP ${r.status}: ${t.slice(0, 140)}`); }
  return r.json();
}

// FMP earnings report / estimates → [{ symbol, date, epsActual, epsEstimated, revenueActual, revenueEstimated, lastUpdated }]
async function fmpEarnings(symbol, limit = 8) {
  const rows = await fmpGet("/earnings", { symbol, limit });
  return Array.isArray(rows) ? rows : [];
}
// FMP earnings-call transcript (if the plan includes it)
async function fmpTranscript(symbol, year, quarter) {
  const rows = await fmpGet("/earning-call-transcript", { symbol, year, quarter });
  // FMP returns an array of { symbol, period/quarter, year, date, content }
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) return null;
  return { ticker: symbol, year: row.year ?? year, quarter: row.quarter ?? row.period ?? quarter, date: row.date, transcript: row.content || row.transcript || "" };
}

// FMP revenue segmentation (business + geographic). Availability varies by
// plan and issuer — callers must treat empty results as "not disclosed".
// Rows arrive as [{ symbol, fiscalYear, period, date, data: { SegmentName: value } }]
async function fmpRevenueSegments(symbol) {
  const norm = (rows) => (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r.data && Object.keys(r.data).length)
    .map((r) => ({ year: r.fiscalYear ?? (r.date ? new Date(r.date).getFullYear() : null), period: r.period || "FY", data: r.data }))
    .filter((r) => r.year)
    .sort((a, b) => a.year - b.year)
    .slice(-4);
  const [product, geographic] = await Promise.all([
    fmpGet("/revenue-product-segmentation", { symbol, period: "annual" }).then(norm).catch(() => []),
    fmpGet("/revenue-geographic-segmentation", { symbol, period: "annual" }).then(norm).catch(() => []),
  ]);
  return { product, geographic };
}

async function ninjaGet(path, params) {
  if (!hasNinjaKey()) throw new Error("NO_KEY");
  const url = new URL(NINJA_BASE + path);
  Object.entries(params || {}).forEach(([k, v]) => { if (v != null && v !== "") url.searchParams.set(k, v); });
  const r = await fetch(url, { headers: { "X-Api-Key": process.env.API_NINJAS_KEY } });
  if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error(`API Ninjas ${r.status}: ${t.slice(0, 140)}`); }
  return r.json();
}

// list available calls for a ticker → [{ ticker, year, quarter, date }]
async function listCalls(ticker) {
  const rows = await ninjaGet("/earningstranscriptsearch", { ticker });
  return Array.isArray(rows) ? rows : [];
}

// fetch one transcript (latest if year/quarter omitted)
async function fetchTranscript(ticker, year, quarter) {
  return ninjaGet("/earningstranscript", { ticker, year, quarter });
}

/* ─────────────  ANALYSIS ENGINE (runs on the raw transcript string)  ───────────── */

const POS = ["strong", "growth", "record", "beat", "exceeded", "momentum", "robust", "improved", "improving", "accelerat", "expand", "outperform", "confident", "pleased", "healthy", "raise", "raised", "upside", "tailwind", "demand", "win", "wins", "gain", "gains", "double-digit", "all-time high", "best"];
const NEG = ["decline", "declined", "weak", "weakness", "soft", "softness", "headwind", "challeng", "pressure", "miss", "missed", "below", "slow", "slowdown", "loss", "losses", "cautious", "uncertain", "uncertainty", "deceler", "downturn", "shortfall", "impairment", "litigation", "delay", "disrupt"];
const HEDGE = ["however", "but", "although", "despite", "nevertheless", "that said", "on the other hand", "to be fair", "we'll see", "remains to be seen", "difficult to predict"];
const GUIDANCE_CUES = ["we expect", "we anticipate", "guidance", "we are guiding", "for the full year", "for fiscal", "next quarter", "we forecast", "we project", "outlook for", "we are targeting", "we continue to expect", "for the year", "we now expect", "we see", "we believe we will"];
const RISK_CUES = ["risk", "headwind", "uncertain", "pressure", "challeng", "macro", "fx", "currency", "regulat", "competition", "competitive", "supply chain", "inflation", "recession", "litigation", "tariff", "cost pressure"];

function sentences(text) {
  return (text || "").replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z(])/).map((s) => s.trim()).filter((s) => s.length > 8);
}
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function countHits(lower, words) {
  let n = 0;
  for (const w of words) {
    if (!w || w.length < 3) continue; // ignore too-short cues to avoid spurious substring hits
    // word-ish boundary: not preceded/followed by a letter (allows plurals/suffixes after the stem)
    const re = new RegExp("(?<![a-z])" + escapeRe(w), "g");
    const m = lower.match(re);
    if (m) n += m.length;
  }
  return n;
}
// count occurrences of a single term with a leading boundary (for peer names / cues)
function countTerm(lower, term) {
  if (!term || term.length < 3) return 0;
  const re = new RegExp("(?<![a-z])" + escapeRe(term.toLowerCase()), "g");
  const m = lower.match(re);
  return m ? m.length : 0;
}

// Non-speakers: labels that look like "Name:" but are transcript furniture, not
// people. Reject these (and anything with an @, a digit, or all-lowercase) so
// contact lines / section labels never become "speakers".
const NON_SPEAKER = new Set([
  "operator", "moderator", "email", "e-mail", "website", "web", "contact", "tel",
  "telephone", "phone", "fax", "mobile", "note", "notes", "source", "sources",
  "disclaimer", "disclosure", "safe harbor", "safe harbour", "cin", "isin",
  "registered office", "corporate office", "investor relations", "media contact",
  "date", "time", "venue", "agenda", "topic", "subject", "re", "to", "from", "cc",
  "management", "participants", "analysts", "attendees", "call", "transcript",
]);
function isRealSpeaker(name) {
  const n = (name || "").trim();
  if (!n || n.length < 2 || n.length > 48) return false;
  if (/[@\d]/.test(n)) return false;                 // emails / codes
  if (!/[A-Z]/.test(n)) return false;                 // must have a capital
  if (NON_SPEAKER.has(n.toLowerCase())) return false;
  return true;
}

// split a single transcript string into speaker turns when it follows "Name: text" convention
function splitSpeakers(text) {
  const turns = [];
  const re = /(^|\n|\s)([A-Z][A-Za-z.\-]+(?:\s[A-Z][A-Za-z.\-]+){0,3}):\s/g;
  let m;
  const pushes = [];
  while ((m = re.exec(text)) !== null) { if (isRealSpeaker(m[2])) pushes.push({ name: m[2], idx: m.index + m[0].length, start: m.index }); }
  if (pushes.length < 2) return null; // not speaker-formatted
  for (let i = 0; i < pushes.length; i++) {
    const cur = pushes[i], next = pushes[i + 1];
    const body = text.slice(cur.idx, next ? next.start : text.length).trim();
    if (body.length > 20) turns.push({ speaker: cur.name, text: body });
  }
  return turns.length ? turns : null;
}

function scoreText(text) {
  const lower = text.toLowerCase();
  const pos = countHits(lower, POS), neg = countHits(lower, NEG);
  const total = pos + neg;
  const score = total ? (pos - neg) / total : 0; // -1..1
  return { pos, neg, score };
}

// broker / institution names for Q&A attribution
const INSTITUTIONS = ["Nuvama", "Nomura", "Goldman Sachs", "Goldman", "Jefferies", "HSBC", "IIFL", "Morgan Stanley", "JP Morgan", "JPMorgan", "UBS", "Kotak", "Motilal Oswal", "Motilal", "Axis Capital", "Axis", "ICICI Securities", "ICICI", "CLSA", "Macquarie", "Citi", "Citigroup", "BofA", "Bank of America", "Bernstein", "Ambit", "Antique", "Emkay", "Elara", "Investec", "Spark", "Edelweiss", "Avendus", "PhillipCapital", "Systematix", "Dolat", "Prabhudas"];

// Guard against binary/font-stream garbage that survives PDF extraction
// (e.g. "V , oX / (a x= |? 9 CE Da"): real prose is mostly letters, has proper
// words, and few one-character tokens.
function looksLikeProse(s) {
  if (!s || s.length < 24) return false;
  const nonspace = (s.match(/\S/g) || []).length;
  if (nonspace < 20) return false;
  const letters = (s.match(/[A-Za-z]/g) || []).length;
  if (letters / nonspace < 0.62) return false;             // too many symbols/digits
  const words = (s.match(/[A-Za-z]{3,}/g) || []).length;
  if (words < 6) return false;                              // needs real words
  const toks = s.trim().split(/\s+/);
  if (toks.filter((t) => t.length <= 1).length / toks.length > 0.34) return false; // token soup
  return true;
}

// Financial figures — capture every number that carries a unit (₹/$/%/bps/cr/mn…)
// alongside its metric context. Numbers without a unit are skipped as ambiguous.
const FIN_NOUN = /\b(revenue|sales|top-?line|ebitda|ebit|pat|profit|net income|margin|eps|cash flow|fcf|capex|dividend|payout|buyback|order book|roce|roe|arr|guidance|growth|volume|realis|realiz|price hike|market share|penetration|working capital|debt|net cash|tax rate|utilis|utiliz)\b/i;
const NUM_UNIT = /(?:₹|rs\.?|inr|usd|us\$|\$)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:cr|crore|lakh|bn|billion|mn|million|k))?|\d[\d,]*(?:\.\d+)?\s?(?:%|bps|bn|billion|mn|million|cr|crore|lakh|bbl|x\b)/gi;
function extractFinancials(sents) {
  const rows = [], seen = new Set();
  for (const s of sents) {
    if (!FIN_NOUN.test(s) || !looksLikeProse(s)) continue;
    const nums = [...s.matchAll(NUM_UNIT)].map((m) => m[0].replace(/\s+/g, " ").trim()).filter((n) => /\d/.test(n));
    if (!nums.length) continue;
    const mm = s.match(FIN_NOUN);
    const key = s.slice(0, 70);
    if (seen.has(key)) continue; seen.add(key);
    rows.push({
      metric: (mm ? mm[0] : "Metric").replace(/\b\w/, (c) => c.toUpperCase()),
      figures: [...new Set(nums)].slice(0, 5),
      quote: s.length > 240 ? s.slice(0, 240) + "…" : s,
    });
  }
  return rows.slice(0, 24);
}

// Q&A — questions plus the broker/institution asking (best-effort, deterministic)
function extractQA(sents) {
  const qa = [];
  for (let i = 0; i < sents.length; i++) {
    const s = sents[i];
    if (!/\?$/.test(s) || s.length < 15) continue;
    let inst = null;
    for (const name of INSTITUTIONS) { const re = new RegExp("(?<![a-z])" + escapeRe(name), "i"); if (re.test(s) || (sents[i - 1] && re.test(sents[i - 1]))) { inst = name; break; } }
    qa.push({ question: s.length > 220 ? s.slice(0, 220) + "…" : s, institution: inst });
  }
  return qa.slice(0, 15);
}

// Remove contact furniture that can appear mid-line (emails, URLs, phone
// numbers) so it never lands in a speaker turn or the word/sentiment counts.
function scrubInline(t) {
  return (t || "")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, " ")          // emails
    .replace(/\bhttps?:\/\/\S+/gi, " ")                       // urls
    .replace(/\bwww\.\S+/gi, " ")                             // bare www
    .replace(/\b\+?\d[\d().\-]{6,}\d\b/g, " ")               // phone-ish runs
    .replace(/[ \t]{2,}/g, " ");
}

/* ── build the structured 9-section dashboard, fully deterministically ── */
const GENERIC_SUBJ = new Set(["we", "the", "our", "this", "that", "it", "they", "management", "company", "i", "and", "in", "on", "for", "as", "so", "these", "those", "there", "here", "overall", "however", "meanwhile", "additionally", "further", "also"]);
function buildDashboard(ctx) {
  const { sents, lower, turns, tone, toneScore, toneLabel, hedges, words, guidance, riskSents, topRisks, financials, qa, topics, scorecard, summary } = ctx;
  const clamp = (x, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
  const scoreOf = (s) => { const r = scoreText(s); return Math.round(50 + (r.score) * 50); };
  const stripLabel = (s) => s.replace(/^[A-Z][A-Za-z.,'\- ]{0,42}:\s*/, "");
  const speakerFor = (sent) => { if (!turns) return null; const key = stripLabel(sent).slice(0, 46); for (const t of turns) if (t.text.includes(key)) return t.speaker; return null; };
  const hasNum = (s) => { NUM_UNIT.lastIndex = 0; return NUM_UNIT.test(s); };
  // pick the unit-bearing number physically closest to a metric keyword
  const nearestFigure = (sent, src, pref) => {
    const re = new RegExp(src, "i"); const mm = re.exec(sent); if (!mm) return null;
    const at = mm.index; let best = null, bd = 1e9, bestP = null, bdP = 1e9, n; NUM_UNIT.lastIndex = 0;
    while ((n = NUM_UNIT.exec(sent)) !== null) {
      const fig = n[0].replace(/\s+/g, " ").trim(), d = Math.abs(n.index - at);
      if (d < bd) { bd = d; best = fig; }
      if (pref && pref(fig) && d < bdP) { bdP = d; bestP = fig; }
    }
    return bestP || best;
  };
  const trim = (s, n = 240) => (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, "") + "…" : s);

  // 1 · overall assessment + momentum
  const beatRate = summary && summary.stats && summary.stats.hitRate != null ? summary.stats.hitRate : null;
  let m = 5 + (toneScore - 50) / 12.5;
  if (beatRate != null) m += (beatRate - 50) / 25;
  m += Math.min(1.5, guidance.length * 0.12) - Math.min(1.5, riskSents.length * 0.06);
  const momentum = +clamp(m, 0, 10).toFixed(1);
  const assessment = {
    label: momentum >= 7.5 ? "Very Bullish" : momentum >= 6 ? "Bullish" : momentum >= 4.5 ? "Neutral" : momentum >= 3 ? "Bearish" : "Very Bearish",
    momentum, tone: toneScore, toneLabel,
    confidence: Math.round(clamp(60 + Math.min(20, financials.length * 1.3) + (turns ? 6 : 0), 55, 90)),
  };

  // 2 · highlights (positive, evidence-bearing) & thesis
  // highlights = management statements (not analyst questions), positive & substantive
  const isQuestion = (s) => /\?\s*$/.test(s) || /^(can|could|would|what|how|why|when|is there|do you|are you|any )\b/i.test(stripLabel(s));
  const posSents = sents.map((s) => ({ s, sc: scoreText(s) })).filter((x) => x.sc.pos >= 2 && x.sc.pos > x.sc.neg && !isQuestion(x.s) && looksLikeProse(x.s));
  const highlights = posSents.filter((x) => hasNum(x.s)).concat(posSents.filter((x) => !hasNum(x.s))).slice(0, 8).map((x) => trim(stripLabel(x.s), 150));
  const watch = sents.map((s) => ({ s, sc: scoreText(s) })).filter((x) => x.sc.neg >= 1 && !isQuestion(x.s) && looksLikeProse(x.s)).sort((a, b) => b.sc.neg - a.sc.neg).slice(0, 6).map((x) => trim(stripLabel(x.s), 150));
  const thesis = { positives: highlights.slice(0, 6), watchpoints: watch };

  // 3 · financial snapshot (live EPS + extracted metrics)
  const snapRows = [];
  if (summary && summary.available && (summary.history || []).length) {
    const h = summary.history, last = h[h.length - 1], ccy = summary.currency || "";
    const pfx = ccy === "INR" ? "₹" : ccy === "USD" ? "$" : "";
    const yrAgo = h.length >= 4 ? h[h.length - 4] : null; // ~same quarter prior year (4 prints back)
    const prev = h.length >= 2 ? h[h.length - 2] : null;
    const yoy = yrAgo && yrAgo.epsActual ? ((last.epsActual - yrAgo.epsActual) / Math.abs(yrAgo.epsActual)) * 100 : null;
    const qoq = prev && prev.epsActual ? ((last.epsActual - prev.epsActual) / Math.abs(prev.epsActual)) * 100 : null;
    if (last.epsActual != null) snapRows.push({ metric: "EPS (reported)", value: pfx + last.epsActual.toFixed(2), yoy, qoq, note: last.surprisePct != null ? `${last.surprisePct >= 0 ? "beat" : "miss"} est. by ${Math.abs(last.surprisePct).toFixed(1)}%` : "", src: "consensus" });
    if (last.epsEstimate != null) snapRows.push({ metric: "EPS (estimate)", value: pfx + last.epsEstimate.toFixed(2), yoy: null, qoq: null, note: "street consensus", src: "consensus" });
  }
  // add extracted headline metrics — prefer the figure whose UNIT fits the metric
  // (absolute value for Revenue/EBITDA/PAT/Capex; a percentage for margins).
  const ABS = new Set(["Revenue", "EBITDA", "PAT", "Capex", "Order Book"]);
  const isPct = (f) => /%|bps/.test(f), isAbs = (f) => /(cr\b|crore|bn\b|mn\b|lakh|billion|million|₹|\$|\brs)/i.test(f);
  const wantMetrics = [["Revenue", /revenue|net sales|\bsales\b|top-?line/i], ["EBITDA", /ebitda/i], ["EBITDA Margin", /ebitda margin|operating margin|\bopm\b/i], ["Gross Margin", /gross margin/i], ["PAT", /\bpat\b|net profit|net income|profit after tax/i], ["Capex", /capex|capital expenditure/i], ["Order Book", /order book|order intake/i]];
  for (const [label, re] of wantMetrics) {
    if (snapRows.some((r) => r.metric.toLowerCase().startsWith(label.toLowerCase()))) continue;
    const wantAbs = ABS.has(label), pref = wantAbs ? isAbs : (/margin/i.test(label) ? isPct : null);
    const cands = financials.filter((f) => re.test(f.quote));
    let pick = null, pfig = null;
    for (const c of cands) {
      const fig = nearestFigure(c.quote, re.source, pref); if (!fig) continue;
      const good = pref ? pref(fig) : true;
      if (good) { pick = c; pfig = fig; break; }
      if (!pick) { pick = c; pfig = fig; }
    }
    if (pick && pfig) snapRows.push({ metric: label, value: pfig, yoy: null, qoq: null, note: trim(stripLabel(pick.quote), 90), src: "transcript" });
  }

  // 4 · sentiment timeline across the call
  const timeline = [];
  {
    const N = sents.length;
    if (N >= 6) {
      // find Q&A boundary
      let qaStart = sents.findIndex((s, i) => i > N * 0.3 && (/\?$/.test(s) || /question-and-answer|q&a|first question|take (the )?questions/i.test(s)));
      if (qaStart < 0) qaStart = Math.round(N * 0.7);
      const prep = sents.slice(0, qaStart), qaS = sents.slice(qaStart, Math.max(qaStart + 1, N - 2)), close = sents.slice(N - 2);
      const seg = (arr) => arr.join(" ");
      const labels = ["Opening", "Business Review", "Financial Review"];
      const chunk = Math.max(1, Math.ceil(prep.length / 3));
      for (let i = 0; i < 3 && i * chunk < prep.length; i++) timeline.push({ label: labels[i], score: scoreOf(seg(prep.slice(i * chunk, (i + 1) * chunk))) });
      if (qaS.length) timeline.push({ label: "Q&A", score: scoreOf(seg(qaS)) });
      if (close.length) timeline.push({ label: "Closing", score: scoreOf(seg(close)) });
    }
  }

  // 5 · key management messages (notable quotes with speaker)
  const keyMessages = sents.map((s) => ({ s, sc: scoreText(s), num: hasNum(s), guide: GUIDANCE_CUES.some((c) => s.toLowerCase().includes(c)) }))
    .filter((x) => ((x.sc.pos + x.sc.neg >= 2) || x.num || x.guide) && !isQuestion(x.s) && looksLikeProse(x.s))
    .sort((a, b) => (b.num + b.guide + b.sc.pos) - (a.num + a.guide + a.sc.pos)).slice(0, 8)
    .map((x) => ({
      quote: trim(stripLabel(x.s), 240), speaker: speakerFor(x.s),
      tone: x.sc.pos > x.sc.neg ? "pos" : x.sc.neg > x.sc.pos ? "neg" : "neu",
      tag: x.guide ? "Guidance" : x.num ? "Metric" : "Strategy",
    }));

  // 6 · segments (best-effort: capitalized subject + growth figure)
  const segMap = {};
  const segRe = /([A-Z][A-Za-z&'.\-]+(?:\s[A-Z0-9][A-Za-z0-9&'.\-]+){0,3})\s+(?:grew|growth|rose|gained|up|delivered|reported|revenue|volume|sales|posted|clocked|scaled|crossed)[^.]{0,60}?(\d[\d.,]*\s?%|(?:₹|rs\.?|inr|\$)\s?\d[\d,]*)/gi;
  let sm;
  for (const s of sents) {
    segRe.lastIndex = 0;
    while ((sm = segRe.exec(s)) !== null) {
      const nm = sm[1].trim();
      const first = nm.split(/\s+/)[0].toLowerCase();
      if (GENERIC_SUBJ.has(first) || nm.length < 3 || /^(we|our|the|this|management)\b/i.test(nm)) continue;
      if (!segMap[nm]) segMap[nm] = { name: nm, figure: sm[2].replace(/\s+/g, " ").trim(), note: trim(stripLabel(s), 150) };
    }
  }
  const segments = Object.values(segMap).slice(0, 8);

  // 7 · guidance items with a confidence read
  const HIGHC = /\b(will|expect|confident|committed|guide|reiterat|on track|targeting|raised)\b/i, LOWC = /\b(may|could|aim|hope|aspir|potential|explore|likely|should)\b/i;
  const guidanceItems = guidance.map((g) => {
    const c = HIGHC.test(g) ? 82 : LOWC.test(g) ? 58 : 70;
    const dir = /raise|increas|upgrad|improv|accelerat|higher/i.test(g) ? "Upgrade" : /lower|reduc|cut|downgrad|weaker/i.test(g) ? "Downgrade" : "Maintained";
    return { statement: trim(g, 220), confidence: c, direction: dir };
  }).slice(0, 10);

  // 8 · risk matrix (probability × impact for the heat map)
  const HIGH_IMPACT = /inflation|crude|oil|disrupt|litigation|default|regulat|recession|demand|slowdown|currency|forex|competit|margin|supply/i;
  const maxRiskCount = Math.max(1, ...topRisks.map((r) => r.count));
  const risks = topRisks.slice(0, 8).map((r) => {
    const ex = riskSents.find((s) => new RegExp("(?<![a-z])" + escapeRe(r.cue), "i").test(s)) || "";
    return {
      risk: r.cue.replace(/\b\w/, (c) => c.toUpperCase()),
      mentions: r.count,
      probability: +Math.min(3, 1 + (r.count / maxRiskCount) * 2).toFixed(2),
      impact: HIGH_IMPACT.test(r.cue) || HIGH_IMPACT.test(ex) ? 2.6 : 1.6,
      horizon: /monsoon|quarter|near|q[1-4]|month/i.test(ex) ? "Near term" : "Medium term",
      note: trim(ex, 150),
    };
  });

  // 9 · transcript evidence appendix
  const themeOf = (s) => { for (const t of topics) { const re = { Revenue: /revenue|sales/i, Margins: /margin|cost|profit/i, Growth: /growth|expand/i, Guidance: /guidance|outlook|expect/i, Demand: /demand|order/i, Capital: /capex|dividend|buyback|capital/i, Product: /product|launch/i, Customers: /customer|client/i }[t.topic]; if (re && re.test(s)) return t.topic; } return "General"; };
  const evidence = financials.slice(0, 14).map((f, i) => ({
    n: i + 1, extract: trim(stripLabel(f.quote), 200), figures: f.figures.join(", "), speaker: speakerFor(f.quote), theme: themeOf(f.quote),
    confidence: Math.round(clamp(70 + (f.figures.length * 6) + (speakerFor(f.quote) ? 8 : 0), 60, 98)),
    impact: (() => { const sc = scoreText(f.quote); return sc.pos > sc.neg ? "Positive" : sc.neg > sc.pos ? "Negative" : "Neutral"; })(),
  }));

  // key drivers this quarter (topic emphasis + sentiment) — the "what changed" panel
  const drivers = topics.slice(0, 7).map((t) => {
    const re = { Revenue: /revenue|top.?line|sales/i, Margins: /margin|profitab|cost/i, Growth: /growth|expand|scal/i, Guidance: /guidance|outlook|expect/i, Demand: /demand|order|backlog|pipeline/i, Capital: /capital|buyback|dividend|capex|allocat/i, Product: /product|launch|innovat|platform/i, Customers: /customer|client|user|subscriber/i }[t.topic] || new RegExp(t.topic, "i");
    const sc = scoreOf(sents.filter((s) => re.test(s)).join(" "));
    return { driver: t.topic, emphasis: t.count, sentiment: sc, read: sc >= 60 ? "Constructive" : sc <= 42 ? "Cautionary" : "Balanced" };
  });

  return { assessment, highlights, thesis, financialSnapshot: snapRows, sentimentTimeline: timeline, keyMessages, segments, guidanceItems, risks, evidence, drivers };
}

function analyzeTranscript(raw, meta = {}, peers = []) {
  const text = scrubInline(typeof raw === "string" ? raw : (raw.transcript || ""));
  if (!text || text.length < 100) return { error: "Transcript too short or empty to analyse." };
  const lower = text.toLowerCase();
  const sents = sentences(text);
  const words = (text.match(/\b[\w'-]+\b/g) || []).length;

  // overall management tone
  const tone = scoreText(text);
  const toneScore = Math.round(50 + tone.score * 50); // 0..100
  const toneLabel = toneScore >= 60 ? "Confident" : toneScore >= 45 ? "Measured" : "Cautious";
  const hedges = countHits(lower, HEDGE);

  // speaker-level (if formatted)
  const turns = splitSpeakers(text);
  let speakers = null;
  if (turns) {
    const byName = {};
    turns.forEach((t) => { const s = scoreText(t.text); (byName[t.speaker] ||= { speaker: t.speaker, turns: 0, words: 0, pos: 0, neg: 0 }); const b = byName[t.speaker]; b.turns++; b.words += (t.text.match(/\b[\w'-]+\b/g) || []).length; b.pos += s.pos; b.neg += s.neg; });
    speakers = Object.values(byName).map((b) => ({ ...b, score: Math.round(50 + ((b.pos - b.neg) / (b.pos + b.neg || 1)) * 50) }))
      .sort((a, b) => b.words - a.words).slice(0, 8);
  }

  // guidance: sentences containing forward-looking cues
  const guidance = sents.filter((s) => { const l = s.toLowerCase(); return GUIDANCE_CUES.some((c) => l.includes(c)); }).slice(0, 12);

  // risk mentions: sentences containing risk cues
  const riskSents = sents.filter((s) => { const l = s.toLowerCase(); return RISK_CUES.some((c) => l.includes(c)); });
  const riskByCue = {};
  RISK_CUES.forEach((c) => { const n = countTerm(lower, c); if (n) riskByCue[c] = n; });
  const topRisks = Object.entries(riskByCue).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([cue, count]) => ({ cue, count }));

  // competitor mentions — scan for peer names + any "competit*" sentences
  const competitorMentions = [];
  (peers || []).forEach((p) => {
    if (!p) return;
    const name = (p.name || p.symbol || "").split(/[ .,]/)[0];
    if (name && name.length > 2) { const n = countTerm(lower, name.toLowerCase()); if (n) competitorMentions.push({ name: p.name || p.symbol, count: n }); }
  });
  competitorMentions.sort((a, b) => b.count - a.count);
  const competitiveContext = sents.filter((s) => /competit/i.test(s)).slice(0, 5);

  // topic frequency — business themes
  const TOPICS = { Revenue: /revenue|top.?line|sales/i, Margins: /margin|profitab|cost/i, Growth: /growth|expand|scal/i, Guidance: /guidance|outlook|expect/i, Demand: /demand|order|backlog|pipeline/i, Capital: /capital|buyback|dividend|capex|allocat/i, Product: /product|launch|innovat|platform/i, Customers: /customer|client|user|subscriber/i, Margins2: /efficien|productiv/i };
  const topics = Object.entries(TOPICS).filter(([k]) => k !== "Margins2").map(([topic, re]) => ({ topic, count: (text.match(new RegExp(re, "gi")) || []).length })).filter((t) => t.count > 0).sort((a, b) => b.count - a.count);

  // financial figures + Q&A (structured extraction)
  const financials = extractFinancials(sents);
  const qa = extractQA(sents);
  const institutions = [...new Set(INSTITUTIONS.filter((n) => countTerm(lower, n.toLowerCase()) > 0))];

  // management tone scorecard (0–100, deterministic heuristics off the lexicon)
  const clamp = (x) => Math.max(0, Math.min(100, Math.round(x)));
  const avgSentLen = sents.length ? words / sents.length : 20;
  const optimism = clamp(50 + ((tone.pos - tone.neg) / (tone.pos + tone.neg || 1)) * 50);
  // Density-normalised (per-1000-words) so scores don't saturate on long calls.
  const kw = Math.max(1, words / 1000);
  const dens = (n, per) => n / kw * per;
  const scorecard = {
    confidence: toneScore,
    optimism,
    transparency: clamp(48 + dens(financials.length, 9)),
    defensiveness: clamp(22 + dens(hedges, 6.5)),
    conservatism: clamp(34 + dens(countHits(lower, ["cautious", "calibrat", "threshold", "disciplined", "prudent", "selective", "conservative", "measured"]), 14)),
    riskAwareness: clamp(34 + dens(riskSents.length, 11)),
    clarity: clamp(132 - avgSentLen * 1.9),
    consistency: clamp(100 - Math.abs(50 - optimism) * 0.7),
    executionConfidence: clamp(44 + dens(countHits(lower, ["delivered", "execution", "on track", "ahead of", "commit", "achieved", "ramp", "milestone", "record"]), 11)),
  };

  // insights (deterministic synthesis)
  const insights = [];
  insights.push(`Management tone reads **${toneLabel.toLowerCase()}** (${toneScore}/100), with ${tone.pos} positive vs ${tone.neg} cautionary signal words across ~${words.toLocaleString()} words.`);
  if (financials.length) insights.push(`${financials.length} quantified statement(s) extracted — see the Financial Evidence section for figures with their context.`);
  if (hedges > 6) insights.push(`Elevated hedging language (${hedges} qualifiers like "however"/"although") suggests management is tempering the message.`);
  if (guidance.length) insights.push(`${guidance.length} forward-looking statement(s) detected — see the Guidance section for the verbatim language.`);
  if (topRisks.length) insights.push(`Most-cited concerns: ${topRisks.slice(0, 3).map((r) => r.cue).join(", ")}.`);
  if (competitorMentions.length) insights.push(`Competitors referenced: ${competitorMentions.slice(0, 3).map((c) => c.name).join(", ")}.`);
  if (topics.length) insights.push(`Call centred on ${topics.slice(0, 3).map((t) => t.topic.toLowerCase()).join(", ")}.`);

  const report = buildDashboard({ sents, lower, turns, tone, toneScore, toneLabel, hedges, words, guidance, riskSents, topRisks, financials, qa, topics, scorecard, summary: meta.summary || null });

  return {
    meta, words, toneScore, toneLabel, hedges,
    sentimentDetail: tone, speakers, scorecard,
    guidance, topRisks, riskCount: riskSents.length,
    competitorMentions, competitiveContext, topics,
    financials, qa, institutions, insights,
    report,
    method: "deterministic-lexicon",
  };
}

module.exports = { hasNinjaKey, listCalls, fetchTranscript, analyzeTranscript, hasFmpKey, fmpEarnings, fmpTranscript, fmpRevenueSegments };
