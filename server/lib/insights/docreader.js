/**
 * Research document reader — the token-saving half of the research pipeline.
 *
 * Instead of handing Gemini a filing URL (its URL-context tool then reads the
 * WHOLE PDF into the prompt: a 60-page results pack or investor presentation is
 * tens of thousands of tokens), the server downloads the filing once, extracts
 * its text, caches it, and sends the model only the pages that answer the
 * question being asked:
 *   results      → statement tables, segment / KPI pages, highlights
 *   management   → outlook, guidance, strategy, capital allocation
 *   developments → transaction terms, counterparties, consideration
 * Pages are ranked by keyword relevance (and figure density for results),
 * boilerplate (disclaimers, safe-harbour, addresses) is pushed down, and the
 * selection stops at a character budget. The selected text is also what every
 * extracted figure is checked against.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const PDF = require("../pdftext");

const CACHE_DIR = path.join(process.env.MERIDIAN_RESEARCH_DIR || path.join(__dirname, "..", "..", "data", "research"), "docs");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MAX_BYTES = 25 * 1024 * 1024;
const CACHE_V = 2;   // bump when extraction rules change, so old cache files are re-read

/* only public http(s) hosts — a link inside a filing must never reach the server's own network */
function publicUrl(u) {
  try {
    const x = new URL(u);
    if (!/^https?:$/.test(x.protocol)) return null;
    if (/^(localhost|0\.|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)|^\[|\.local$|\.internal$/i.test(x.hostname) || !/\./.test(x.hostname)) return null;
    return x.toString();
  } catch { return null; }
}
const fileOf = (url) => path.join(CACHE_DIR, crypto.createHash("sha1").update(String(url)).digest("hex").slice(0, 24) + ".json");
const htmlText = (h) => String(h).replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

/* share of ordinary text characters (letters, digits, punctuation, ₹, whitespace) */
const legible = (t) => { const s = String(t); if (!s.length) return 0; const ok = (s.match(/[A-Za-z0-9\s.,;:%()\/&'"+\-–—₹$€£]/g) || []).length; return ok / s.length; };
const inflight = new Map();
/**
 * Download + extract a filing; cached on disk by URL (filings never change).
 * @returns {Promise<{ pages: string[], chars: number } | null>} null when it cannot be read
 */
function fetchDoc(url) {
  const u = publicUrl(url); if (!u) return Promise.resolve(null);
  try { const j = JSON.parse(fs.readFileSync(fileOf(u), "utf8")); if (j && j.v === CACHE_V && j.url === u && Array.isArray(j.pages)) return Promise.resolve(j); } catch { }
  if (inflight.has(u)) return inflight.get(u);
  const p = (async () => {
    let r = null;
    for (let attempt = 0; attempt < 2 && !(r && r.ok); attempt++) {
      r = await fetch(u, { headers: { "User-Agent": UA, Accept: "application/pdf,text/html,*/*" }, signal: AbortSignal.timeout(30000), redirect: "follow" }).catch(() => null);
      if (!(r && r.ok) && attempt === 0) await new Promise((res) => setTimeout(res, 1500));
    }
    if (!r || !r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > MAX_BYTES) return null;
    let pages;
    if (buf.subarray(0, 5).toString("latin1") === "%PDF-") {
      const x = await PDF.extractPdf(buf, { maxPages: 150 });
      const raw = String(x.text || "");
      if (/\[\[p\d+\]\]/.test(raw)) { pages = raw.split(/\[\[p\d+\]\]/); pages.shift(); pages = pages.map((t) => t.trim()); }   // index = page − 1
      else { pages = []; for (let i = 0; i < raw.length; i += 3000) pages.push(raw.slice(i, i + 3000)); }               // basic extractor: no page marks
    } else {
      const raw = buf.toString("utf8");
      if (/access denied|request blocked|captcha/i.test(raw.slice(0, 2000))) return null;   // a block page, not a filing
      const t = htmlText(raw);
      // HTML: split into ~3,000-character "pages" so the same ranking applies
      pages = []; for (let i = 0; i < t.length; i += 3000) pages.push(t.slice(i, i + 3000));
    }
    const chars = pages.reduce((a, x) => a + x.length, 0);
    if (chars < 80) return null;                                // scanned / image-only: nothing to read
    // a PDF the extractor could not decode comes back as binary noise: unreadable, not worth a single token
    const clear = pages.filter((t) => t.length > 40 && legible(t) >= 0.9).length;
    if (clear < Math.max(1, Math.ceil(pages.filter((t) => t.length > 40).length * 0.2))) return null;
    const doc = { v: CACHE_V, url: u, pages, chars, savedAt: Date.now() };
    try { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(fileOf(u), JSON.stringify(doc)); } catch { }
    return doc;
  })().catch(() => null).finally(() => inflight.delete(u));
  inflight.set(u, p);
  return p;
}

/* what each research question looks for */
const WANT = {
  results: /revenue|income from operations|total income|turnover|ebitda|operating profit|\bpat\b|profit after tax|net profit|profit before tax|margin|segment|volume|underlying|growth|y-?o-?y|q-?o-?q|quarter|\bq[1-4]\b|\bh[12]\b|fy\s?\d{2}|crore|\bcr\b|₹|\brs\.?|\beps\b|capex|cash flow|net debt|consolidated|standalone|highlights|key metrics|performance/gi,
  management: /outlook|guidance|expect|target|aspir|medium[- ]term|long[- ]term|strateg|priorit|demand|pricing|price increase|capex|capital allocation|dividend|buyback|acquisition|we will|going forward|plan to|confident|headwind|tailwind|inflation|market share|distribution|innovation|new launches|rural|urban|international|margin/gi,
  developments: /acqui|stake|subsidiar|merger|amalgamat|divest|consideration|valuation|investment|agreement|joint venture|capacity|commission|launch|appoint|resign|scheme of arrangement|shareholding|equity shares|cash consideration|enterprise value|rationale/gi,
};
const NOISE = /independent auditor|auditor.s (review )?report|limited review|chartered accountants|firm.s registration|membership no|udin|basis for (conclusion|opinion)|we conducted our review|disclaimer|forward[- ]looking statements|safe harbou?r|registered office|corporate identity number|\bcin\b|this presentation (does not|may contain)|not an offer|investor relations contact|thank you|www\.|e-?mail:|tel:|fax:/gi;
const numberDensity = (t) => (String(t).match(/\d[\d,]*(?:\.\d+)?/g) || []).length / Math.max(1, t.length / 1000);

/* running headers / footers / letterheads: lines that repeat on most pages carry no information */
function cleanPages(doc) {
  if (doc._clean) return doc._clean;
  const pages = doc.pages;
  if (pages.length < 4) return (doc._clean = pages);
  const freq = new Map();
  for (const p of pages) for (const l of new Set(p.split("\n").map((x) => x.trim()).filter((x) => x.length > 8))) freq.set(l, (freq.get(l) || 0) + 1);
  const rep = new Set([...freq].filter(([, n]) => n >= Math.max(3, pages.length * 0.6)).map(([l]) => l));
  return (doc._clean = rep.size ? pages.map((p) => p.split("\n").filter((l) => !rep.has(l.trim())).join("\n").trim()) : pages);
}

/** a ranked, budget-capped excerpt of a document for one research question */
function relevant(doc, pass, maxChars) {
  if (!doc || !doc.pages || !doc.pages.length) return { text: "", pages: [] };
  const re = WANT[pass] || WANT.results;
  const scored = cleanPages(doc).map((t, i) => {
    const hits = (t.match(re) || []).length, noise = (t.match(NOISE) || []).length;
    let score = Math.min(hits, 40) - noise * 4;
    if (pass === "results") {
      score += Math.min(numberDensity(t), 60) / 3;                            // statement tables are figure-dense
      if (/consolidated.{0,40}financial results|financial results.{0,60}consolidated|key (financial )?highlights|performance highlights/i.test(t)) score += 12;
    }
    if (pass !== "developments" && /review report|independent auditor|chartered accountants|we conducted our review|nothing has come to our attention/i.test(t)) score -= 25;   // the auditor's letter, not the results
    if (i === 0 && pass !== "developments") score += 2;                      // cover / highlights page
    if (t.length < 60) score -= 10;                                          // section dividers, blank slides
    if (legible(t) < 0.9) score -= 30;                                       // fonts PDF.js could not map: glyph soup costs tokens, says nothing
    return { i, t, score };
  }).filter((p) => p.score > 0).sort((a, b) => b.score - a.score);
  const pick = [];
  let used = 0;
  for (const p of scored) {
    const chunk = p.t.length > 5000 ? p.t.slice(0, 5000) : p.t;
    if (used + chunk.length > maxChars && pick.length) continue;
    pick.push({ i: p.i, t: chunk }); used += chunk.length;
    if (used >= maxChars) break;
  }
  // nothing matched (a short notice in unusual wording): a short document goes in whole, a long one by its opening pages
  if (!pick.length) for (let i = 0; i < doc.pages.length && used < maxChars; i++) { const t = cleanPages(doc)[i].slice(0, Math.max(0, maxChars - used)); if (t.trim().length > 40) { pick.push({ i, t }); used += t.length; } }
  pick.sort((a, b) => a.i - b.i);                                            // keep the document's order
  return { text: pick.map((p) => `[p${p.i + 1}]\n${p.t}`).join("\n\n"), pages: pick.map((p) => p.i + 1), totalPages: doc.pages.length };
}

/* per-document character budget by filing kind (≈ 4 characters per token) */
const DOC_CHARS = { results: 16000, press: 9000, presentation: 14000, call: 20000, deal: 5000 };
const charsFor = (kind) => DOC_CHARS[kind] || 8000;

module.exports = { fetchDoc, relevant, charsFor, publicUrl };
