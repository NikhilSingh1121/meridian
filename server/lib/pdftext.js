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

  const kept = [];
  for (const ln of lines) {
    const t = ln.trim();
    if (!t) { if (kept.length && kept[kept.length - 1] !== "") kept.push(""); continue; }
    if (repeated.has(t)) continue;
    if (JUNK_PATTERNS.some((re) => re.test(t))) continue;
    kept.push(ln);
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

module.exports = { extractText, stripBoilerplate };
