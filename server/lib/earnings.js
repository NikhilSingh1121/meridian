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

// split a single transcript string into speaker turns when it follows "Name: text" convention
function splitSpeakers(text) {
  const turns = [];
  const re = /(^|\n|\s)([A-Z][A-Za-z.\-]+(?:\s[A-Z][A-Za-z.\-]+){0,3}):\s/g;
  let m, last = null, lastIdx = 0;
  const pushes = [];
  while ((m = re.exec(text)) !== null) pushes.push({ name: m[2], idx: m.index + m[0].length, start: m.index });
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

function analyzeTranscript(raw, meta = {}, peers = []) {
  const text = typeof raw === "string" ? raw : (raw.transcript || "");
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

  // insights (deterministic synthesis)
  const insights = [];
  insights.push(`Management tone reads **${toneLabel.toLowerCase()}** (${toneScore}/100), with ${tone.pos} positive vs ${tone.neg} cautionary signal words across ~${words.toLocaleString()} words.`);
  if (hedges > 6) insights.push(`Elevated hedging language (${hedges} qualifiers like "however"/"although") suggests management is tempering the message.`);
  if (guidance.length) insights.push(`${guidance.length} forward-looking statement(s) detected — see the Guidance section for the verbatim language.`);
  if (topRisks.length) insights.push(`Most-cited concerns: ${topRisks.slice(0, 3).map((r) => r.cue).join(", ")}.`);
  if (competitorMentions.length) insights.push(`Competitors referenced: ${competitorMentions.slice(0, 3).map((c) => c.name).join(", ")}.`);
  if (topics.length) insights.push(`Call centred on ${topics.slice(0, 3).map((t) => t.topic.toLowerCase()).join(", ")}.`);

  return {
    meta, words, toneScore, toneLabel, hedges,
    sentimentDetail: tone, speakers,
    guidance, topRisks, riskCount: riskSents.length,
    competitorMentions, competitiveContext, topics, insights,
    method: "deterministic-lexicon",
  };
}

module.exports = { hasNinjaKey, listCalls, fetchTranscript, analyzeTranscript, hasFmpKey, fmpEarnings, fmpTranscript };
