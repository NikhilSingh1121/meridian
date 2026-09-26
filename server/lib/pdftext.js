/**
 * MERIDIAN — dependency-free PDF text extraction + transcript boilerplate strip.
 *
 * extractText(buffer): pulls readable text out of a (text-based) PDF using only
 *   Node's built-in zlib — no external library. It inflates FlateDecode content
 *   streams and reads the Tj / TJ text-showing operators. It does NOT OCR, so a
 *   scanned/image PDF yields little/no text (the caller tells the user to paste).
 *
 * stripBoilerplate(text): removes the non-content furniture of an earnings-call
 *   transcript — page numbers, running headers/footers, legal/safe-harbour and
 *   operator/disclaimer lines — so the analysis engine sees only spoken content.
 */
const zlib = require("zlib");

/* ── decode a single PDF literal string, resolving escapes ── */
function decodeLiteral(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") {
      const n = s[i + 1];
      if (n === "n") { out += "\n"; i++; }
      else if (n === "r") { out += "\r"; i++; }
      else if (n === "t") { out += "\t"; i++; }
      else if (n === "b" || n === "f") { out += " "; i++; }
      else if (n === "(" || n === ")" || n === "\\") { out += n; i++; }
      else if (n >= "0" && n <= "7") { // octal escape \ddd
        let oct = n; i++;
        for (let k = 0; k < 2 && s[i + 1] >= "0" && s[i + 1] <= "7"; k++) { oct += s[i + 1]; i++; }
        out += String.fromCharCode(parseInt(oct, 8) & 0xff);
      } else if (n === "\n") { i++; } // line continuation
      else { out += n; i++; }
    } else out += c;
  }
  return out;
}

/* ── extract text from a decoded content stream ──
   Reads text-showing operators (Tj and TJ) and treats the text-positioning
   operators (Td, TD, T-star, quote and double-quote) as line/space breaks. */
function textFromContent(content) {
  let out = "";
  let i = 0;
  const N = content.length;
  const pushStr = (raw) => { out += decodeLiteral(raw); };
  while (i < N) {
    const c = content[i];
    if (c === "(") {
      // read a balanced literal string
      let depth = 1, j = i + 1, buf = "";
      while (j < N && depth > 0) {
        const ch = content[j];
        if (ch === "\\") { buf += ch + (content[j + 1] || ""); j += 2; continue; }
        if (ch === "(") depth++;
        else if (ch === ")") { depth--; if (depth === 0) break; }
        buf += ch; j++;
      }
      pushStr(buf);
      i = j + 1;
      continue;
    }
    if (c === "<" && content[i + 1] !== "<") {
      // hex string <....>
      let j = i + 1, hex = "";
      while (j < N && content[j] !== ">") { if (/[0-9a-fA-F]/.test(content[j])) hex += content[j]; j++; }
      if (hex.length % 2) hex += "0";
      for (let k = 0; k < hex.length; k += 2) { const code = parseInt(hex.substr(k, 2), 16); if (code) out += String.fromCharCode(code); }
      i = j + 1;
      continue;
    }
    // positioning / show operators → whitespace hints
    if (c === "T" && (content[i + 1] === "d" || content[i + 1] === "D" || content[i + 1] === "*")) { out += "\n"; i += 2; continue; }
    if ((c === "'" || c === '"')) { out += "\n"; i += 1; continue; }
    if (c === "]" && content.slice(i + 1, i + 4).trim().startsWith("TJ")) { out += " "; i += 1; continue; }
    i++;
  }
  return out;
}

function extractText(buffer) {
  const raw = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const latin = raw.toString("latin1");
  const pages = (latin.match(/\/Type\s*\/Page[^s]/g) || []).length || 1;

  let text = "";
  const re = /stream\r?\n?/g;
  let m;
  while ((m = re.exec(latin))) {
    const start = m.index + m[0].length;
    const end = latin.indexOf("endstream", start);
    if (end < 0) continue;
    // slice from the ORIGINAL bytes so binary flate data survives
    let chunk = raw.subarray(start, end);
    // trim a trailing EOL that precedes endstream
    while (chunk.length && (chunk[chunk.length - 1] === 0x0a || chunk[chunk.length - 1] === 0x0d)) chunk = chunk.subarray(0, chunk.length - 1);
    let content = null;
    try { content = zlib.inflateSync(chunk).toString("latin1"); }
    catch { try { content = zlib.inflateRawSync(chunk).toString("latin1"); } catch { content = null; } }
    if (content == null) {
      // maybe an uncompressed content stream already containing text operators
      const s = chunk.toString("latin1");
      if (/\bTj\b|\bTJ\b/.test(s)) content = s; else continue;
    }
    if (/\bTj\b|\bTJ\b|\bT[dD*]\b/.test(content)) text += textFromContent(content) + "\n";
  }
  // normalise whitespace
  text = text.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return { text, pages };
}

/* ── boilerplate / furniture removal for transcripts ── */
const JUNK_PATTERNS = [
  /^\s*page\s+\d+(\s+of\s+\d+)?\s*$/i,
  /^\s*\d+\s*$/,                                   // bare page number
  /^\s*[-–—]\s*\d+\s*[-–—]\s*$/,                   // - 12 -
  /copyright|all rights reserved|©|\(c\)\s*\d{4}/i,
  /^\s*(refinitiv|thomson reuters|bloomberg|s&p global|factset|capital iq|seeking alpha|the motley fool|verbatim|streetevents)\b/i,
  /forward[- ]looking statement|safe harbor|safe harbour|private securities litigation|risks and uncertainties|actual results (may|could) differ/i,
  /this (transcript|document|call|recording) (is|may|contains)/i,
  /^\s*(disclaimer|important information|legal notice|non-gaap)\b/i,
  /^\s*(operator|moderator)\s*:?\s*$/i,
  /^\s*\[?(music|applause|inaudible|technical difficulties|end of (call|transcript|q&a))\]?\.?\s*$/i,
  /good (morning|afternoon|evening),?\s+(and\s+)?welcome to.*conference call/i,
  /^\s*https?:\/\/\S+\s*$/i,
  /conference call (transcript|has (now )?(ended|concluded))/i,
  // contact / IR footer furniture
  /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i,                        // any line containing an email
  /\b(investor relations|for further information|for more information|media (relations|contact)|registered office|corporate office)\b/i,
  /\bCIN\s*[:\-]/i,
  /^\s*(tel|phone|fax|mob(ile)?|website|web|www)\.?\s*[:\-]/i,
  /^\s*www\.\S+\s*$/i,
  /^\s*\+?\d[\d\s().\-]{7,}\d\s*$/,                      // bare phone number line
];

// Normalise typography and strip the garbage glyphs that font-encoded PDFs
// leave behind (mis-decoded ligatures / private-use chars like "Íʐà"). Keep
// ASCII, the rupee sign and whitespace; fold smart quotes/dashes to plain.
function sanitizeText(t) {
  return (t || "")
    .normalize("NFKC")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[  -​﻿]/g, " ")
    .replace(/[^\x09\x0A\x0D\x20-\x7E₹]+/g, " ") // drop non-ASCII garbage runs (keep ₹)
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ *\n */g, "\n");
}

function stripBoilerplate(text) {
  if (!text) return "";
  const lines = sanitizeText(text).split(/\n/);
  // 1) repeated running headers/footers: identical short lines appearing many times
  const freq = {};
  for (const ln of lines) { const k = ln.trim(); if (k && k.length <= 90) freq[k] = (freq[k] || 0) + 1; }
  const repeated = new Set(Object.entries(freq).filter(([k, c]) => c >= 3 && k.length <= 90 && !/[.?!]$/.test(k)).map(([k]) => k));
  // running headers / footers that differ only by the page number ("18 Reliance Industries Limited 2020")
  const dfreq = {};
  const dkey = (k) => k.replace(/\d+/g, "#");
  for (const ln of lines) { const k = ln.trim(); if (k && k.length <= 90 && /\d/.test(k) && !/^\[\[p\d+\]\]$/.test(k)) dfreq[dkey(k)] = (dfreq[dkey(k)] || 0) + 1; }
  for (const ln of lines) { const k = ln.trim(); if (k && /\d/.test(k) && dfreq[dkey(k)] >= 4 && k.length <= 90 && !/[.?!]$/.test(k) && /[A-Za-z]{3}/.test(k)) repeated.add(k); }

  const kept = [];
  for (const ln of lines) {
    const t = ln.trim();
    if (!t) { if (kept.length && kept[kept.length - 1] !== "") kept.push(""); continue; }
    if (/^\[\[p\d+\]\]$/.test(t)) { kept.push(t); continue; }   // page marks survive for citations
    if (repeated.has(t)) continue;
    if (JUNK_PATTERNS.some((re) => re.test(t))) continue;
    kept.push(ln);
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/* ── readability ─────────────────────────────────────────────────────────
   A PDF's font programs, images and signature blocks can decode to long runs
   of symbol noise mixed into the real text. readability() measures how much
   of a text is ordinary English (share of very common words — ~25-35% in real
   prose, ~0% in noise); proseOnly() keeps only runs of word-like tokens. */
const COMMON = new Set("the and to of we in is that for our on with this you have are be as it was at by from an or will which not but so there what they their also can been has its all more if would about into year quarter growth".split(" "));
function readability(text) {
  const tk = String(text || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!tk.length) return 0;
  return tk.filter((t) => COMMON.has(t.replace(/[^a-z]/g, ""))).length / tk.length;
}
const isWordTok = (t) => (/^[("“‘]?[A-Za-z]*[a-z][A-Za-z’'-]*[.,;:!?)”’"]*$/.test(t) && /[a-z]{2}/i.test(t))
  || /^(I|a|A)[.,]?$/.test(t) || /^\(?[₹$]?\d[\d,.]*%?(cr|bn|mn)?[.,;:)]?$/i.test(t) || /^[A-Z][A-Za-z]+:$/.test(t) || /^[-–—&]$/.test(t);
function proseOnly(text, W = 12, min = 0.8) {
  const tk = String(text || "").split(/\s+/).filter(Boolean);
  const ok = tk.map(isWordTok), keep = new Array(tk.length).fill(false);
  let sum = 0;
  for (let i = 0; i < tk.length; i++) {
    sum += ok[i] ? 1 : 0;
    if (i >= W) sum -= ok[i - W] ? 1 : 0;
    if (i >= W - 1 && sum / W >= min) for (let k = i - W + 1; k <= i; k++) keep[k] = true;
  }
  const out = []; let run = [];
  for (let i = 0; i <= tk.length; i++) {
    if (i < tk.length && keep[i]) { run.push(tk[i]); continue; }
    if (run.length >= W) out.push(run.join(" "));
    run = [];
  }
  return out.join("\n");
}
/* clean an extraction: noise removed when mixed in; null when no readable text layer */
function readableText(text, { minRatio = 0.08, minWords = 300 } = {}) {
  let t = String(text || "");
  if (readability(t) < 0.15) t = proseOnly(t);
  const words = t.split(/\s+/).filter(Boolean).length;
  return readability(t) >= minRatio && words >= minWords ? t : null;
}

/* ── PDF.js extraction (preferred) ────────────────────────────────────────
   Mozilla's PDF.js (bundled by `unpdf`) decodes embedded / CID fonts through
   their ToUnicode maps, which the hand-rolled reader above cannot — many
   exchange-filed transcripts (TCS, HDFC Bank, Eicher…) are only readable this
   way. Pages are marked "[[p7]]" on their own line so the analysis can cite
   pages; link annotations are returned for cover letters that only point to
   the transcript on the company's website. Falls back to extractText(). */
let _pdfjs = null;
async function pdfjs() { if (!_pdfjs) _pdfjs = import("unpdf").then((m) => m.getDocumentProxy); return _pdfjs; }
async function extractPdf(buffer, { maxPages = 120 } = {}) {
  try {
    const getDocumentProxy = await pdfjs();
    const doc = await getDocumentProxy(new Uint8Array(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)));
    const pages = [], links = [];
    const n = Math.min(doc.numPages, maxPages);
    for (let p = 1; p <= n; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      let out = "", lastY = null;
      for (const it of tc.items) {
        if (!("str" in it)) continue;
        const y = it.transform[5];
        if (lastY != null && Math.abs(y - lastY) > 2 && !out.endsWith("\n")) out += "\n";
        out += it.str;
        if (it.hasEOL) out += "\n";
        lastY = y;
      }
      pages.push(`[[p${p}]]\n${out}`);
      if (doc.numPages <= 4) {
        try { for (const a of await page.getAnnotations()) if (a && a.url) links.push(a.url); } catch { /* annotations are optional */ }
      }
    }
    try { await doc.destroy(); } catch { }
    const text = pages.join("\n\n").replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    return { text, pages: doc.numPages, links, engine: "pdfjs" };
  } catch (e) {
    const r = extractText(buffer);
    return { ...r, links: [], engine: "basic", error: String((e && e.message) || e).slice(0, 120) };
  }
}
const stripPageMarks = (t) => String(t || "").replace(/^\[\[p\d+\]\]\s*$/gm, "").replace(/\n{3,}/g, "\n\n");

module.exports = { extractText, extractPdf, stripPageMarks, stripBoilerplate, readability, proseOnly, readableText };
