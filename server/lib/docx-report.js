/**
 * MERIDIAN — deterministic Earnings-Call research report → .docx
 *
 * Builds a formatted WordprocessingML document from the (deterministic) analysis
 * object + the live earnings summary, zipped with jszip. No `docx` npm library,
 * no template, no AI — the same analysis always yields the same document.
 */
const JSZip = require("jszip");

const AMBER = "C8862A", INK = "1A1D24", MUTE = "6B7280", GREEN = "2E8B57", RED = "C0392B", LINE = "D9D9D9", HEADBG = "F2ECE0", ZEBRA = "F7F7F5";
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function run(text, o = {}) {
  // rPr children must follow the schema order: rFonts, b, i, color, sz.
  const r = [`<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>`];
  if (o.b) r.push("<w:b/>");
  if (o.i) r.push("<w:i/>");
  if (o.color) r.push(`<w:color w:val="${o.color}"/>`);
  r.push(`<w:sz w:val="${o.sz || 20}"/>`);
  return `<w:r><w:rPr>${r.join("")}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}
function P(text, o = {}) {
  // pPr children order: pBdr, shd, spacing, jc.
  const p = [];
  if (o.border) p.push(`<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="2" w:color="${o.border}"/></w:pBdr>`);
  if (o.bg) p.push(`<w:shd w:val="clear" w:color="auto" w:fill="${o.bg}"/>`);
  p.push(`<w:spacing w:before="${o.before != null ? o.before : 0}" w:after="${o.after != null ? o.after : 60}" w:line="${o.line || 240}" w:lineRule="auto"/>`);
  if (o.align) p.push(`<w:jc w:val="${o.align}"/>`);
  const runs = Array.isArray(o.runs) ? o.runs.join("") : run(text, o);
  return `<w:p><w:pPr>${p.join("")}</w:pPr>${runs}</w:p>`;
}
const H1 = (t) => P(t, { b: true, sz: 30, color: INK, before: 60, after: 40 });
const H2 = (t) => P(t, { b: true, sz: 24, color: AMBER, before: 200, after: 90, border: AMBER });
const H3 = (t) => P(t, { b: true, sz: 21, color: INK, before: 140, after: 60 });
const body = (t) => P(t, { sz: 20, color: INK, after: 100, line: 264 });
const bullet = (t) => P("", { after: 50, line: 252, runs: [run("•  ", { color: AMBER, b: true }), run(t, { sz: 20, color: INK })] });

function table(rows, widths, opt = {}) {
  const total = widths.reduce((a, b) => a + b, 0);
  const grid = widths.map((w) => `<w:gridCol w:w="${w}"/>`).join("");
  const borders = `<w:tblBorders><w:top w:val="single" w:sz="4" w:color="${LINE}"/><w:left w:val="single" w:sz="4" w:color="${LINE}"/><w:bottom w:val="single" w:sz="4" w:color="${LINE}"/><w:right w:val="single" w:sz="4" w:color="${LINE}"/><w:insideH w:val="single" w:sz="4" w:color="EDEDED"/><w:insideV w:val="single" w:sz="4" w:color="EDEDED"/></w:tblBorders>`;
  const trs = rows.map((cells, ri) => {
    const head = ri === 0 && opt.header;
    const tcs = cells.map((c, ci) => {
      const cell = typeof c === "object" && c !== null ? c : { text: c };
      const fill = head ? HEADBG : (opt.zebra && ri % 2 === 0 ? ZEBRA : null);
      const shd = fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : "";
      const tcPr = `<w:tcPr><w:tcW w:w="${widths[ci]}" w:type="dxa"/>${shd}<w:tcMar><w:top w:w="30" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="30" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tcMar><w:vAlign w:val="center"/></w:tcPr>`;
      return `<w:tc>${tcPr}${P(cell.text, { sz: cell.sz || 18, b: head || cell.b, color: cell.color || (head ? MUTE : INK), align: cell.align, after: 0, before: 0, line: 240 })}</w:tc>`;
    }).join("");
    return `<w:tr>${tcs}</w:tr>`;
  }).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/>${borders}<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${trs}</w:tbl>` + P("", { after: 80 });
}

const pctCell = (v, dp = 1) => (v == null ? { text: "—" } : { text: (v >= 0 ? "+" : "") + v.toFixed(dp) + "%", color: v >= 0 ? GREEN : RED, align: "right" });

function buildBody(a, summary, meta) {
  const parts = [];
  const name = (summary && summary.name) || meta.name || meta.symbol || "Company";
  const sym = meta.symbol || (summary && summary.symbol) || "";
  const ex = (summary && summary.exchange) || "";
  const ccy = (summary && summary.currency) || "";
  const eps = (v) => (v == null ? "—" : (ccy === "INR" ? "₹" : ccy === "USD" ? "$" : "") + (Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1)));

  // ── header ──
  parts.push(P("EARNINGS CALL ANALYSIS", { b: true, sz: 16, color: AMBER, after: 30 }));
  parts.push(H1(esc(name) + (sym ? "  (" + esc(sym) + ")" : "")));
  parts.push(P(`${ex ? ex + "  ·  " : ""}Institutional transcript intelligence  ·  generated ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`, { sz: 18, color: MUTE, after: 40, border: LINE }));

  // ── report snapshot ──
  parts.push(H2("1 · Report Snapshot"));
  parts.push(table([
    [{ text: "Parameter", b: true }, { text: "Reading", b: true }],
    ["Overall management tone", `${a.toneLabel} (${a.toneScore}/100)`],
    ["Positive vs cautionary signals", `${a.sentimentDetail.pos} positive · ${a.sentimentDetail.neg} cautionary`],
    ["Forward-looking statements", `${a.guidance.length}`],
    ["Risk-related statements", `${a.riskCount}`],
    ["Quantified statements extracted", `${a.financials.length}`],
    ["Analyst questions detected", `${a.qa.length}${a.institutions.length ? " · " + a.institutions.slice(0, 6).join(", ") : ""}`],
    ["Transcript length", `${a.words.toLocaleString()} words`],
  ], [3200, 5800], { header: true, zebra: true }));

  // ── earnings snapshot (live numbers) ──
  if (summary && summary.available) {
    parts.push(H2("2 · Earnings Snapshot"));
    const n = summary.next || {};
    parts.push(body(`Next earnings call: ${n.date ? new Date(n.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "not scheduled"}${n.daysUntil != null ? ` (in ${n.daysUntil} days)` : ""}${n.epsEstimate != null ? ` · consensus EPS ${eps(n.epsEstimate)}` : ""}.`));
    if ((summary.history || []).length) {
      parts.push(H3("Recent reported quarters (actual vs estimate)"));
      const rows = [[{ text: "Quarter end", b: true }, { text: "Actual EPS", b: true, align: "right" }, { text: "Estimate", b: true, align: "right" }, { text: "Surprise", b: true, align: "right" }, { text: "Result", b: true, align: "right" }]];
      summary.history.slice(-8).reverse().forEach((h) => rows.push([
        new Date(h.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
        { text: eps(h.epsActual), align: "right" }, { text: eps(h.epsEstimate), align: "right" },
        pctCell(h.surprisePct), { text: h.beat == null ? "—" : h.beat ? "Beat" : "Miss", color: h.beat ? GREEN : RED, align: "right" },
      ]));
      parts.push(table(rows, [2600, 1700, 1700, 1600, 1400], { header: true, zebra: true }));
    }
    if ((summary.forward || []).length) {
      parts.push(H3("Forward consensus (analyst estimates)"));
      const rows = [[{ text: "Period", b: true }, { text: "EPS est.", b: true, align: "right" }, { text: "YoY", b: true, align: "right" }, { text: "Analysts", b: true, align: "right" }]];
      summary.forward.forEach((f) => rows.push([f.label, { text: eps(f.epsAvg), align: "right" }, pctCell(f.growthPct, 0), { text: String(f.numAnalysts ?? "—"), align: "right" }]));
      parts.push(table(rows, [3400, 2200, 1800, 1600], { header: true, zebra: true }));
    }
  }

  // ── executive summary ──
  parts.push(H2("3 · Executive Summary"));
  a.insights.forEach((t) => parts.push(bullet(t.replace(/\*\*/g, ""))));

  // ── management tone scorecard ──
  if (a.scorecard) {
    parts.push(H2("4 · Management Tone Scorecard"));
    const sc = a.scorecard;
    const order = [["Confidence", sc.confidence], ["Transparency", sc.transparency], ["Optimism", sc.optimism], ["Defensiveness", sc.defensiveness], ["Conservatism", sc.conservatism], ["Risk Awareness", sc.riskAwareness], ["Clarity", sc.clarity], ["Consistency", sc.consistency], ["Execution Confidence", sc.executionConfidence]];
    const rows = [[{ text: "Dimension", b: true }, { text: "Score", b: true, align: "right" }, { text: "Reading", b: true }]];
    order.forEach(([k, v]) => rows.push([k, { text: `${v}/100`, align: "right", color: v >= 70 ? GREEN : v >= 45 ? INK : RED, b: true }, { text: v >= 75 ? "High" : v >= 55 ? "Moderate" : v >= 40 ? "Guarded" : "Low", color: MUTE }]));
    parts.push(table(rows, [3600, 2200, 3200], { header: true, zebra: true }));
    parts.push(P("Scores are computed deterministically from the transcript's lexical signals (tone, hedging, specificity, risk and execution language).", { sz: 16, i: true, color: MUTE, after: 80 }));
  }

  // ── financial evidence ──
  if (a.financials.length) {
    parts.push(H2("5 · Financial Evidence — Extracted Figures"));
    const rows = [[{ text: "Metric", b: true }, { text: "Figures", b: true }, { text: "Statement", b: true }]];
    a.financials.forEach((f) => rows.push([{ text: f.metric, b: true }, f.figures.join(", "), { text: f.quote, sz: 17 }]));
    parts.push(table(rows, [1700, 1900, 5400], { header: true, zebra: true }));
  }

  // ── guidance ──
  if (a.guidance.length) {
    parts.push(H2("6 · Guidance & Forward-Looking Statements"));
    a.guidance.forEach((g) => parts.push(bullet(g)));
  }

  // ── risks ──
  parts.push(H2("7 · Risks & Monitorables"));
  if (a.topRisks.length) {
    const rows = [[{ text: "Concern cue", b: true }, { text: "Mentions", b: true, align: "right" }]];
    a.topRisks.forEach((r) => rows.push([r.cue, { text: String(r.count), align: "right" }]));
    parts.push(table(rows, [6400, 2600], { header: true, zebra: true }));
  } else parts.push(body("No notable risk language detected in the transcript."));

  // ── topics ──
  if (a.topics.length) {
    parts.push(H2("8 · Topic Focus"));
    const rows = [[{ text: "Topic", b: true }, { text: "Frequency", b: true, align: "right" }]];
    a.topics.forEach((t) => rows.push([t.topic, { text: String(t.count), align: "right" }]));
    parts.push(table(rows, [6400, 2600], { header: true, zebra: true }));
  }

  // ── speakers ──
  if (a.speakers && a.speakers.length) {
    parts.push(H2("9 · Speaker Analytics"));
    const rows = [[{ text: "Speaker", b: true }, { text: "Turns", b: true, align: "right" }, { text: "Words", b: true, align: "right" }, { text: "Tone", b: true, align: "right" }]];
    a.speakers.forEach((s) => rows.push([s.speaker, { text: String(s.turns), align: "right" }, { text: s.words.toLocaleString(), align: "right" }, { text: `${s.score}/100`, align: "right", color: s.score >= 60 ? GREEN : s.score < 45 ? RED : INK }]));
    parts.push(table(rows, [3800, 1600, 2000, 1600], { header: true, zebra: true }));
  }

  // ── Q&A ──
  if (a.qa.length) {
    parts.push(H2("10 · Selected Q&A"));
    a.qa.forEach((q) => parts.push(bullet(`${q.institution ? "[" + q.institution + "] " : ""}${q.question}`)));
  }

  // ── competitors ──
  if (a.competitorMentions.length) {
    parts.push(H2("11 · Competitor Mentions"));
    parts.push(body(a.competitorMentions.map((c) => `${c.name} (${c.count})`).join("  ·  ")));
  }

  // ── disclaimer ──
  parts.push(H2("Disclaimer"));
  parts.push(P("This report is generated deterministically from the earnings-call transcript for informational and educational purposes only. All figures and statements are extracted from the transcript text. It is not investment advice, an offer, or a solicitation. Conduct your own due diligence and consult a registered investment adviser before investing.", { sz: 16, color: MUTE, i: true, after: 40 }));

  const sect = `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1000" w:bottom="1000" w:left="1000" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`;
  return parts.join("") + sect;
}

async function buildDocx(analysis, summary, meta) {
  const bodyXml = buildBody(analysis, summary, meta || {});
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}</w:body></w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypes);
  zip.file("_rels/.rels", rels);
  zip.file("word/document.xml", doc);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

module.exports = { buildDocx };
