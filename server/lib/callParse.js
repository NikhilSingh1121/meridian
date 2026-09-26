/**
 * Earnings-call transcript → structured call (deterministic, no model).
 *
 * Handles the layouts Indian and global transcripts actually use:
 *   · "Name:" labels at the start of a turn         (most transcripts)
 *   · a label on its own line, "Name – Role, Firm"  (e.g. Bharti Airtel)
 *   · role labels, "CMD:" / "Participant:"          (e.g. NTPC)
 *   · no labels at all — prose with moderator cues  (e.g. Tata Steel)
 * and strips the stock-exchange cover letter (addresses, "Sub:", "Encl.")
 * that precedes the call in every exchange filing.
 *
 * Output: { company, period, format, participants, turns, prepared, qa, warnings }
 *   turns: [{ speaker, role: "management"|"analyst"|"moderator"|"unknown", firm, title, text }]
 *   qa:    [{ analyst, firm, question, answer, responder }]
 */

const HONORIFIC = /^(?:mr|ms|mrs|dr|shri|smt|prof)\.?\s+/i;
const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
const normName = (s) => clean(s).replace(HONORIFIC, "").replace(/[.,]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

// labels that look like "Word:" but are letter / transcript furniture
const FURNITURE = new Set([
  "sub", "subject", "ref", "ref no", "reference", "encl", "enclosure", "symbol", "scrip code", "scrip id", "security code", "stock code",
  "date", "dated", "time", "venue", "dear sir", "dear sirs", "dear sir/madam", "dear madam", "regd office", "registered office", "corporate office",
  "cin", "isin", "tel", "telephone", "phone", "fax", "email", "e-mail", "website", "web", "note", "notes", "page", "event", "duration",
  "management", "participants", "speakers", "analysts", "attendees", "company participants", "conference call participants", "call participants",
  "source", "disclaimer", "disclosure", "kind attn", "attn", "to", "from", "cc", "re", "place", "for", "yours faithfully", "yours sincerely",
]);
const ROLE_LABEL = /^(moderator|operator|host|coordinator|management|participant|analyst|unidentified (analyst|participant|speaker)|chairman|chairperson|cmd|ceo|cfo|coo|md|ed|cmd & ceo|director( \([a-z &]+\))?|company secretary)$/i;
const MGMT_TITLE = /\b(chief|ceo|cfo|coo|cto|cmd|md\b|managing director|chairman|chairperson|president|director|head\b|officer|founder|executive|vice president|vp\b|general manager|company secretary|investor relations|treasurer|controller|group cfo|business head|partner)\b/i;
const MODERATOR = /^(moderator|operator|host|coordinator)$/i;

/* ── 1 · text normalisation ───────────────────────────────────────────── */
function normalise(raw) {
  return String(raw || "")
    .replace(/\r/g, "")
    .replace(/^\s*\[\[p(\d+)\]\]\s*$/gm, "⟦$1⟧")
    .replace(/[‘’‚‛′]/g, "'").replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-").replace(/…/g, "...").replace(/[  -​﻿]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/^ +| +$/gm, "")
    // contact / website furniture that PDFs leave mid-page
    .split("\n").filter((ln) => !/(please visit (our )?(website|www)|feel free to (contact|write|reach)|for (further|any) (updates|information|queries|clarification)|www\.[a-z0-9-]+\.|[\w.+-]+@[\w-]+\.[a-z]{2,})/i.test(ln) || ln.length > 400).join("\n");
}

/* ── 2 · where the call itself starts (everything above is the cover letter) ── */
const START_CUES = [
  /^(moderator|operator)\s*:/im,
  /^\s*(presentation|opening remarks|prepared remarks)\s*$/im,
  /ladies and gentlemen,?\s+(we\s+|i\s+)?(good|welcome)/i,
  /good (morning|afternoon|evening|day)[^.\n]{0,80}\bwelcome to\b/i,
  /welcome to (the )?[^.\n]{0,120}\b(earnings|conference|investor|analyst)s?\b[^.\n]{0,40}\bcall\b/i,
  /\bwelcome (you )?(all )?to (this|the|our)\b[^.\n]{0,120}\b(call|meet|meeting)\b/i,
];
function callStart(text) {
  let best = -1;
  for (const re of [...START_CUES, /thank you (all )?for joining (us )?(on |in )?(our |the |this |today's )?[^.\n]{0,60}\b(call|conference|meet)/i]) { const m = re.exec(text); if (m && (best < 0 || m.index < best)) best = m.index; }
  // or the first genuine speaker label that opens a real passage of speech
  const lines = text.split("\n"); let pos = 0;
  for (const ln of lines) {
    if (best >= 0 && pos >= best) break;
    const lab = labelOf(ln);
    if (lab && lab.inline && lab.rest && lab.rest.split(/\s+/).length >= 8 && !/^(the|dear|sub|ref)\b/i.test(lab.name)) { best = pos; break; }
    pos += ln.length + 1;
  }
  if (best < 0) return 0;
  // start at the beginning of that line / paragraph
  const ls = text.lastIndexOf("\n", best);
  return ls < 0 ? 0 : ls + 1;
}

/* ── 3 · participants block (before or just after the call start) ──────── */
function parseParticipants(head, company) {
  const mgmt = [];
  const lines = head.split("\n").map(clean).filter(Boolean);
  let inMgmt = false;
  for (const ln of lines) {
    if (/^(management|company participants|speakers?|from the management|management team)\b\s*[:\-]?/i.test(ln)) inMgmt = true;
    else if (/^(analysts?|participants?|moderator|conference call participants)\s*[:\-]/i.test(ln)) inMgmt = false;
    const body = ln.replace(/^(management|company participants|speakers?)\s*[:\-]\s*/i, "");
    // "Mr. Saugata Gupta – MD & CEO" · "Mr. Gurdeep Singh, CMD" · "SAUGATA GUPTA - MANAGING DIRECTOR"
    const m = body.match(/^((?:(?:mr|ms|mrs|dr|shri|sh|smt)\.?\s+)?[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,4})\s*(?:[-–,:]|\s{2,})\s*(.{2,120})$/i);
    if (m && (inMgmt || MGMT_TITLE.test(m[2])) && !FURNITURE.has(normName(m[1]))) {
      const name = personName(m[1]);
      if (name && titleOk(m[2])) mgmt.push({ name, role: clean(m[2]).replace(/\s*[-–,]\s*$/, "") });
    }
  }
  return dedupe(mgmt, (x) => normName(x.name));
}
function titleCase(s) { return /^[A-Z .'-]+$/.test(s) ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : s; }
function dedupe(arr, key) { const seen = new Set(); return arr.filter((x) => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; }); }

/* ── 4 · re-join PDF line breaks into paragraphs ──────────────────────── */
function isLabelLine(ln) { return !!labelOf(ln); }
function labelOf(ln) {
  const t = clean(ln);
  if (!t) return null;
  // (a) "Name:" / "Name: text" — pasted transcripts put a whole turn on one line, so no length limit here
  let m = t.match(/^((?:(?:Mr|Ms|Mrs|Dr|Shri)\.?\s+)?[A-Z][A-Za-z.'&()-]*(?:\s+[A-Za-z(][A-Za-z.'&()-]*){0,5})\s*:\s*([\s\S]*)$/);
  if (m && validLabel(m[1])) return { name: clean(m[1]), rest: m[2], inline: true };
  if (t.length > 170) return null;
  // (b) "Name - Designation, Firm" on its own line (no sentence punctuation at the end)
  m = t.match(/^((?:(?:Mr|Ms|Mrs|Dr)\.?\s+)?[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})\s+[-–]\s+([A-Z][^.?!]{1,150})$/);
  if (m && validLabel(m[1]) && !/\d{3,}/.test(m[2])) return { name: clean(m[1]), title: clean(m[2]), rest: "", inline: false };
  // (c) "Sh V Srikanth 00:00:01 - 00:09:45 (Group Performance)" — timestamped section labels
  m = t.match(/^((?:(?:Sh|Smt|Shri|Mr|Ms|Dr)\.?\s+)?[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){1,4})\s+\d{1,2}:\d{2}(?::\d{2})?\s*[-–]\s*\d{1,2}:\d{2}(?::\d{2})?(?:\s*\(([^)]{2,80})\))?$/);
  if (m && validLabel(m[1].replace(/^(Sh|Smt|Shri)\.?\s+/, ""))) return { name: clean(m[1]).replace(/^(Sh|Smt|Shri)\.?\s+/, ""), title: null, section: m[2] || null, rest: "", inline: false };
  return null;
}
// a participant-list name: 2–5 capitalised tokens (initials allowed), no job-title words
const TITLE_WORDS = /\b(chief|officer|director|group|global|company|secretary|the|vice|president|and|executive|managing|head|limited|ltd|investor|relations|finance|financial|operating|business|international|india|welcome|thank|okay|yeah|so|at|for)\b/i;
function personName(s) {
  const n = clean(s).replace(HONORIFIC, "").replace(/^(Sh|Smt|Shri)\.?\s+/, "");
  if (TITLE_WORDS.test(n)) return null;
  const toks = n.split(" ");
  if (toks.length < 2 || toks.length > 5) return null;
  return toks.every((w) => /^[A-Z](?:[A-Za-z'-]+|\.)?\.?$|^[A-Z]\.[A-Z]\.?$/.test(w) || /^[A-Z][a-z]+[A-Z][a-z]+$/.test(w)) ? titleCase(n) : null;
}
const titleOk = (t) => t && t.length <= 110 && MGMT_TITLE.test(t) && !/\b(welcome|thank|good (morning|afternoon|evening))\b|\b(mr|ms|mrs|dr)\.\s/i.test(t);
function validLabel(name) {
  const n = normName(name);
  if (!n || FURNITURE.has(n) || FURNITURE.has(n.replace(/\s+no$/, ""))) return false;
  if (ROLE_LABEL.test(clean(name))) return true;
  // a person's name: every word capitalised (particles excepted) — "Key highlights:" is a heading, not a speaker
  if (!clean(name).replace(HONORIFIC, "").split(" ").every((w) => /^[A-Z(]/.test(w) || /^(de|da|van|von|bin|al|del|la|di)$/.test(w))) return false;
  const words = n.split(" ");
  if (words.length > 6) return false;
  if (/\b(the|of|for|with|we|our|this|that|in|on|at|to|is|are|was|quarter|year|revenue|growth|margin|thank|thanks|question|answer|note|please|so|yes|no|okay|sir|madam|all|let|me)\b/.test(n)) return false;
  return /^[a-z][a-z.'-]*(\s[a-z(][a-z.'&()-]*)*$/.test(n);
}
/* page marks: "[[p7]]" lines from the PDF extractor become inline "⟦7⟧" tokens that
   ride along with the text, so every turn and sentence can cite its page */
const MK = /⟦(\d+)⟧/g;
const unmark = (s) => String(s || "").replace(/\s*⟦\d+⟧\s*/g, " ").replace(/\s{2,}/g, " ").trim();
function paragraphs(text) {
  const lines = text.split("\n");
  const out = []; let cur = "", pend = "";
  const flush = () => { if (unmark(cur)) out.push(cur.trim()); cur = ""; };
  for (const raw of lines) {
    const ln = raw.trim();
    const pm = ln.match(/^⟦(\d+)⟧$/);
    if (pm) { if (cur) cur += ` ⟦${pm[1]}⟧`; else pend = `⟦${pm[1]}⟧ `; continue; }
    if (!ln) { if (/[.?!:"')](\s*⟦\d+⟧)?$/.test(cur)) flush(); continue; }
    if (isLabelLine(ln)) {
      flush();
      const lab = labelOf(ln);
      out.push(pend && lab && lab.inline ? ln.replace(/^([^:]{1,90}:)\s*/, `$1 ${pend}`) : ln);
      if (lab && lab.inline) pend = "";
      continue;
    }
    if (cur && /-$/.test(cur) && /^[a-z]/.test(ln)) cur = cur.slice(0, -1) + ln;          // hyphenated line break
    else cur = cur ? cur + " " + ln : pend + ln;
    pend = "";
  }
  flush();
  return out;
}
// the page each turn starts on (and ends on), carried across turns
function assignPages(turns) {
  let page = null;
  for (const t of turns) {
    const first = t.text.match(/^\s*⟦(\d+)⟧/);
    if (first) page = +first[1];
    t.page = page;
    const all = [...t.text.matchAll(MK)];
    if (all.length) page = +all[all.length - 1][1];
    t.pageEnd = page;
  }
  return turns;
}

/* ── 5 · moderator cues: "the next question is from the line of X from Y" ── */
// the lead-in is case-insensitive ("Next question…"), the name and firm must be capitalised
const CUE = /\b(?:[Ff]irst|[Nn]ext|[Ll]ast|[Ff]ollowing|[Aa]nother|[Ff]inal)\s+(?:[Ff]ollow[- ]?up\s+)?[Qq]uestion\s+(?:is\s+|if\s+|comes\s+|will\s+be\s+)?(?:from|on behalf of)\s+(?:the\s+line\s+of\s+)?(?:(?:Mr|Ms|Mrs|Dr)\.?\s+)?([A-Z][A-Za-z'-]+(?:\s+(?:[A-Z]\.\s?)?[A-Z][A-Za-z'-]+){0,3})(?:\s*(?:,|from|with|of|representing)\s+([A-Z][A-Za-z0-9&'-]*(?:\.(?=[A-Za-z]))?(?:[ \t]+(?:[A-Z&][A-Za-z0-9&'-]*(?:\.(?=[A-Za-z]))?|of|and))*))?/g;
function analystCues(text) {
  const out = []; let m; CUE.lastIndex = 0;
  while ((m = CUE.exec(text)) !== null) {
    let firm = m[2] ? clean(m[2]).replace(/\s+(Please|You may|Go ahead|Over to you|May proceed|Is on the line|Thank you)\b.*$/i, "").replace(/\s+(and|of)$/i, "").replace(/[.,]$/, "") : null;
    if (firm && /^(Mr|Ms|Mrs|Dr)$/i.test(firm)) firm = null;
    out.push({ at: m.index, end: m.index + m[0].length, name: clean(m[1]).replace(/[.,]$/, ""), firm: firm && firm.length > 1 ? firm : null });
  }
  return out;
}

/* ── 6 · turns ────────────────────────────────────────────────────────── */
function labelledTurns(paras) {
  const turns = []; let cur = null;
  for (const p of paras) {
    const lab = labelOf(p);
    if (lab) {
      if (cur && cur.text) turns.push(cur);
      cur = { speaker: lab.name.replace(HONORIFIC, ""), title: lab.title || null, section: lab.section || null, text: lab.rest ? lab.rest.trim() : "" };
      continue;
    }
    if (!cur) cur = { speaker: null, title: null, text: "" };
    cur.text = cur.text ? cur.text + "\n\n" + p : p;
  }
  if (cur && cur.text) turns.push(cur);
  return turns;
}
/* Q&A without speaker labels: classify paragraphs.
   A moderator cue names the next analyst; the analyst's paragraphs run until
   one opens like an answer ("Thank you, Ritu…", "Sure…", "So,…"). Without
   cues, a question-shaped paragraph that opens like a question starts a new
   (unnamed) analyst turn. */
const ANSWER_OPEN = /^(thank(s| you)\b(?![^.]{0,30}\b(for (the|taking|giving|this) (opportunity|question)|so much for (the|taking)))|sure\b|yes\b|yeah\b|okay\b|ok\b|so,? |good question|first of all|let me\b|i think\b|see,|right,|absolutely|to answer|on the (first|second)|as (i|we) (said|mentioned))/i;
const ANALYST_OPEN = /^(hi\b|hello\b|good (morning|afternoon|evening)|thanks?( you)? (for|so much for) (the|taking|giving|this)|congratulations|my (first|second|next|last|follow-?up) question|i have (a|two|three|a couple of) (questions?|follow-?ups?)|a couple of questions|two questions|just (one|a) (question|follow-?up)|one question)/i;
const questionLike = (p) => /\?/.test(p) && (/\?\s*["')]?\s*$/.test(p) || /\b(question|could you|can you|would you|what is|what are|how do|how should|why|any (colour|color|sense|update))\b/i.test(p));
function proseQA(paras) {
  const turns = []; let state = null, cur = null;
  const push = (t) => { if (cur && cur.text) turns.push(cur); cur = t; };
  const anyCue = paras.some((p) => analystCues(p).length);
  for (const p of paras) {
    const u = unmark(p), cs = analystCues(u);
    if (cs.length) { push({ speaker: null, role: "moderator", text: p }); push(null); cur = { speaker: cs[0].name, firm: cs[0].firm, role: "analyst", text: "" }; state = "await-q"; continue; }
    if (state === "await-q") { cur.text = p; state = "q"; continue; }
    if (state === "q") {
      // management often opens by addressing the analyst: "Ashish, let me put it this way…"
      const first = cur && cur.speaker ? String(cur.speaker).split(/\s+/)[0] : null;
      const addressed = first && first.length > 2 && new RegExp(`^(so,?\\s+|yes,?\\s+|well,?\\s+|thanks?,?\\s+(you,?\\s+)?)?${first}\\b\\s*,`, "i").test(u);
      if (!addressed && (questionLike(u) || !/[.!]\s*$/.test(u)) && !ANSWER_OPEN.test(u)) { cur.text += "\n\n" + p; continue; }
      push({ speaker: null, role: "management", text: p }); state = "a"; continue;
    }
    // answering (or before the first question)
    if (!anyCue && questionLike(u) && (ANALYST_OPEN.test(u) || u.length < 900) && !ANSWER_OPEN.test(u)) { push({ speaker: null, role: "analyst", text: p }); state = "q"; continue; }
    if (cur && cur.role === "management") cur.text += "\n\n" + p;
    else push({ speaker: null, role: "management", text: p });
    state = state || "a";
  }
  push(null);
  return turns;
}
const QA_MARKER = /^(q\s?&\s?a|question[- ]and[- ]answer)(\s+session)?\b.{0,60}$|we (will )?(now )?(begin|start|open)( the)? (the )?(q\s?&\s?a|question[- ]and[- ]answer)/i;

/* ── 7 · roles ────────────────────────────────────────────────────────── */
function assignRoles(turns, { mgmt, cues, company }) {
  const mgmtNames = new Set(mgmt.map((x) => normName(x.name)));
  const cueBy = new Map(); cues.forEach((c) => { const k = normName(c.name); if (!cueBy.has(k)) cueBy.set(k, c); });
  const firstLast = (n) => { const w = normName(n).split(" "); return [w[0], w.at(-1)]; };
  const matchIn = (name, set) => { const k = normName(name); if (set.has(k)) return k; const [f, l] = firstLast(name); for (const s of set) { const [f2, l2] = firstLast(s); if ((f === f2 && l === l2) || (l === l2 && l.length > 3 && (f[0] === f2[0]))) return s; } return null; };
  const cueNames = new Set(cueBy.keys());
  const coWord = company ? normName(company).split(" ")[0] : null;
  // per-speaker question share, as a fallback signal
  const stats = {};
  turns.forEach((t, i) => {
    if (!t.speaker) return;
    const k = normName(t.speaker); const s = (stats[k] ||= { q: 0, n: 0, words: 0, afterCue: 0 });
    const sents = t.text.split(/(?<=[.?!])\s+/); s.n += sents.length; s.q += sents.filter((x) => /\?\s*$/.test(x)).length; s.words += t.text.split(/\s+/).length;
    const prev = turns[i - 1];
    // introduced by the moderator as the next questioner
    if (prev && (MODERATOR.test(clean(prev.speaker || "")) || !prev.speaker) && /\bquestion\s+(is\s+|if\s+|comes\s+)?from\b|\bfollow[- ]?up (question )?(from|by)\b/i.test(prev.text)) s.afterCue++;
  });
  for (const t of turns) {
    if (t.role) continue;
    if (!t.speaker) { t.role = "unknown"; continue; }
    const sp = clean(t.speaker), k = normName(sp);
    if (MODERATOR.test(sp)) { t.role = "moderator"; continue; }
    if (/^(participant|analyst|unidentified)/i.test(sp)) { t.role = "analyst"; continue; }
    if (/^(management|chairman|chairperson|cmd|ceo|cfo|coo|md|ed|director|company secretary|cmd & ceo)/i.test(sp)) { t.role = "management"; continue; }
    const cm = matchIn(sp, cueNames);
    if (cm) { t.role = "analyst"; t.firm = cueBy.get(cm).firm; continue; }
    if (matchIn(sp, mgmtNames)) { t.role = "management"; t.title = t.title || (mgmt.find((x) => normName(x.name) === matchIn(sp, mgmtNames)) || {}).role || null; continue; }
    if (t.title) {
      if (MGMT_TITLE.test(t.title) || (coWord && normName(t.title).includes(coWord))) { t.role = "management"; continue; }
      t.role = "analyst"; t.firm = t.title.replace(/^.*?,\s*/, "") || t.title; continue;
    }
    const s = stats[k];
    t.role = s && (s.afterCue > 0 || (s.n && s.q / s.n >= 0.25 && s.words < 1500)) ? "analyst" : "management";
  }
  // a moderator is also whoever says "ladies and gentlemen" / hands the call over, when unlabelled as such
  for (const t of turns) if (t.role !== "moderator" && /ladies and gentlemen|the (first|next) question is from/i.test(t.text) && t.text.length < 900 && !/\?\s*$/.test(t.text)) t.role = "moderator";
  return turns;
}

/* ── 8 · Q&A pairs ────────────────────────────────────────────────────── */
function qaPairs(turns) {
  const qa = [];
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (t.role !== "analyst") continue;
    let answer = "", responder = null, answerPage = null, j = i + 1;
    // a follow-up from the same analyst after the answer starts a new pair
    for (; j < turns.length && turns[j].role === "management"; j++) { answer += (answer ? "\n\n" : "") + turns[j].text; responder = responder || turns[j].speaker; if (answerPage == null) answerPage = turns[j].page; }
    qa.push({ analyst: t.speaker, firm: t.firm || null, question: t.text, answer, responder, page: t.page, answerPage });
  }
  return qa;
}

/* the quarter the call discusses: the most frequent quarter reference near the
   top (the first one is often a comparison period) */
function detectPeriod(text) {
  const t = text.slice(0, 12000), votes = {};
  const add = (q, y, w = 1) => { const k = `Q${q} FY${String(y).slice(-2)}`; votes[k] = (votes[k] || 0) + w; };
  // "Q1 FY2026-27" / "Q1 FY2026 - 2027" name the later year
  for (const m of t.matchAll(/\bQ([1-4])\s?[-']?\s?(?:FY|F\.Y\.)\s?'?(\d{2,4})(?:\s?[-–]\s?(\d{2,4}))?\b/gi)) add(m[1], m[3] || m[2]);
  for (const m of t.matchAll(/\b([1-4])Q\s?FY\s?'?(\d{2,4})\b/gi)) add(m[1], m[2]);
  for (const m of t.matchAll(/\bQ([1-4])[-\s](20\d{2})\b/g)) add(m[1], m[2]);
  for (const m of t.matchAll(/\b(first|second|third|fourth) quarter (?:of |for )?(?:the )?(?:fiscal |financial year |FY\s?)?'?(\d{2,4})\b/gi)) add(["first", "second", "third", "fourth"].indexOf(m[1].toLowerCase()) + 1, m[2], 2);
  const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  if (best) return best[0];
  // Indian fiscal year (April–March): "quarter ended June 30, 2026" → Q1 FY27
  const qe = t.match(/\bquarter ended (?:on )?(?:(\d{1,2})(?:st|nd|rd|th)? )?(June|September|December|March)(?: (\d{1,2})(?:st|nd|rd|th)?)?,? (20\d\d)/i);
  if (qe && /\b(FY|crores?|lakhs?|₹|Rs\.?|INR)\b/.test(text)) {
    const mo = qe[2].toLowerCase(), y = +qe[4];
    const [q, fy] = mo === "june" ? [1, y + 1] : mo === "september" ? [2, y + 1] : mo === "december" ? [3, y + 1] : [4, y];
    return `Q${q} FY${String(fy).slice(-2)}`;
  }
  const h = t.match(/\b(H[12]|9M)\s?FY\s?'?(\d{2,4})/i);
  return h ? `${h[1].toUpperCase()} FY${String(h[2]).slice(-2)}` : null;
}
const NOT_COMPANY = /\b(bse|nse|national stock exchange|stock exchange|exchange of india|secretary|listing|department|corporate (services|relationship))\b|^(india|of india|limited|bank|the company)$/i;
function detectCompany(text) {
  const t = text.slice(0, 12000);
  const cands = [];
  for (const m of t.matchAll(/welcome (?:you )?(?:all )?to (?:the |this )?([A-Z][A-Za-z&.'-]+(?:\s+[A-Z][A-Za-z&.'-]+){0,5}?)(?:'s|\s+(?:Limited|Ltd\.?))?\s+(?:Q[1-4]|[1-4]Q|FY|first|second|third|fourth|earnings|conference|investor|analyst|results|quarterly|post)/g)) cands.push(m[1]);
  for (const m of t.matchAll(/\b([A-Z][A-Za-z&.'-]+(?:\s+[A-Z][A-Za-z&.'-]+){0,4})\s+(?:Limited|Ltd\.?)\b/g)) cands.push(m[1]);
  // the company is the candidate the transcript names most often (the first one is often a subsidiary or the exchange)
  const ok = [...new Set(cands.map((x) => clean(x).replace(/^(the|for|of)\s+/i, "").replace(/'s$/, "")).filter((x) => !NOT_COMPANY.test(x) && x.length > 2))];
  if (!ok.length) return null;
  const count = (c) => text.split(c).length - 1;
  return ok.map((c, i) => ({ c, n: count(c) + (i === 0 && /welcome/i.test(t) ? 1 : 0) })).sort((a, b) => b.n - a.n)[0].c;
}

function parseCall(raw, { company } = {}) {
  const warnings = [];
  const text = normalise(raw);
  const start = callStart(text);
  const head = text.slice(0, start + 3000);
  if (start > 0) warnings.push(`Cover letter removed (${text.slice(0, start).split(/\s+/).length} words before the call).`);
  // the page the call starts on (the last page mark inside the cover letter), so the first turns are citable too
  const before = [...text.slice(0, start).matchAll(/⟦(\d+)⟧/g)];
  const body = (before.length && !/^\s*⟦\d+⟧/.test(text.slice(start)) ? `⟦${before[before.length - 1][1]}⟧\n` : "") + text.slice(start);
  const co = company || detectCompany(text);
  const mgmt = parseParticipants(head, co);
  const paras = paragraphs(body);
  const cues = analystCues(paras.join(" "));
  // where the Q&A starts: an explicit marker, else the first moderator cue
  let qaAt = paras.findIndex((p) => QA_MARKER.test(unmark(p)));
  const firstCue = paras.findIndex((p) => analystCues(p).length);
  if (qaAt < 0 || (firstCue >= 0 && firstCue < qaAt)) qaAt = firstCue;
  let turns = labelledTurns(paras);
  const labelled = turns.filter((t) => t.speaker).length;
  let format = turns.some((t) => t.title) ? "labelled-lines" : "labelled";
  const qaParas = qaAt >= 0 ? paras.slice(qaAt + (QA_MARKER.test(unmark(paras[qaAt])) ? 1 : 0)) : [];
  const qaLabelled = qaAt >= 0 ? labelledTurns(qaParas).filter((t) => t.speaker).length : 0;
  if (labelled < 4 || (qaAt >= 0 && qaParas.length > 6 && qaLabelled < 3)) {
    // labels are missing everywhere, or only the prepared remarks carry them (timestamped sections)
    const pre = qaAt >= 0 ? paras.slice(0, qaAt) : paras;
    const preTurns = labelled >= 2 ? labelledTurns(pre) : [{ speaker: null, role: "management", text: pre.join("\n\n") }];
    turns = [...preTurns, ...(qaAt >= 0 ? proseQA(qaParas) : [])];
    format = labelled >= 2 ? "sections" : "prose";
    warnings.push(format === "prose" ? "Transcript has no speaker labels — speakers inferred from the moderator's hand-overs and the shape of each paragraph." : "The Q&A carries no speaker labels — questions and answers were separated by the shape of each paragraph.");
  }
  turns = assignRoles(turns.map((t) => ({ ...t, text: t.text.trim() })).filter((t) => t.text), { mgmt, cues, company: co });
  // an opening block before the first label is the moderator / IR introduction
  if (turns[0] && !turns[0].speaker && format !== "prose") turns[0].role = "moderator";

  const firstQ = turns.findIndex((t) => t.role === "analyst");
  const prepared = (firstQ < 0 ? turns : turns.slice(0, firstQ)).filter((t) => t.role === "management");

  // role labels ("CMD", "Director (Finance)") → the participant who holds that role
  const byRole = new Map(mgmt.map((x) => [normName(x.role), x.name]));
  for (const t of turns) if (t.speaker && t.role === "management" && byRole.has(normName(t.speaker))) { t.title = t.speaker; t.speaker = byRole.get(normName(t.speaker)); }
  for (const t of turns) if (t.role === "analyst" && /^participant$/i.test(t.speaker || "")) t.speaker = "Unnamed participant";
  // unnamed questioners often introduce themselves: "I am Vivekanand from Ambit", "This is Piyush from HSBC"
  for (const t of turns) {
    if (t.role !== "analyst" || (t.speaker && t.firm)) continue;
    const m = t.text.slice(0, 260).match(/\b(?:I am|I'm|this is|my name is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s+(?:from|with|of|representing)\s+([A-Z][A-Za-z&'-]+(?:\s+[A-Z][A-Za-z&'-]+){0,3})/);
    if (m) { t.speaker = t.speaker && !/^unnamed/i.test(t.speaker) ? t.speaker : m[1]; t.firm = t.firm || m[2]; }
  }

  assignPages(turns);
  const qa = qaPairs(turns);

  // roster
  const people = {};
  for (const t of turns) {
    if (!t.speaker || t.role === "moderator") continue;
    const k = normName(t.speaker);
    const p = (people[k] ||= { name: t.speaker.replace(HONORIFIC, ""), role: t.role, title: t.title || null, firm: t.firm || null, turns: 0, words: 0, questions: 0 });
    p.turns++; p.words += t.text.split(/\s+/).length; if (t.role === "analyst") p.questions++;
    if (!p.firm && t.firm) p.firm = t.firm;
  }
  const mgmtRoster = dedupe([...Object.values(people).filter((p) => p.role === "management").map((p) => ({ ...p, title: p.title || (mgmt.find((x) => normName(x.name) === normName(p.name)) || {}).role || null })), ...mgmt.map((x) => ({ name: x.name, title: x.role, role: "management", turns: 0, words: 0 }))], (x) => normName(x.name).split(" ").slice(-1)[0] + normName(x.name)[0]);
  const analysts = Object.values(people).filter((p) => p.role === "analyst").sort((a, b) => b.questions - a.questions);
  if (format === "prose") cues.forEach((c) => { if (!analysts.some((a) => normName(a.name) === normName(c.name))) analysts.push({ name: c.name, firm: c.firm, role: "analyst", questions: 1 }); });

  return { company: co, period: detectPeriod(text), format, participants: { management: mgmtRoster, analysts }, turns, prepared, qa, warnings };
}

module.exports = { unmark, parseCall, normalise, callStart, labelOf, analystCues, detectPeriod, detectCompany };
