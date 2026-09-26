/**
 * M-Terminal — Earnings Call Analysis report → .docx
 *
 * Follows the MTerminal earnings-call framework (12 modules, cited to
 * transcript pages). Built as WordprocessingML with a real style sheet
 * (readable 10.5 pt body, 9.5 pt tables), full-width tables whose header
 * rows repeat across pages, and a running header / page-numbered footer.
 * Rule-based modules always render; model-assisted modules (environment,
 * segments, costs, strategy, bull/bear) render when available and say so.
 */
const JSZip = require("jszip");

const INK = "1F2328", MUTE = "5F6670", AMBER = "B7791F", RULE = "C8862A", GREEN = "1E7B4F", RED = "B3372B", HEAD = "F3EEE3", ZEBRA = "FAF8F4", LINE = "D9D4C7";
const W = 9638;                                   // A4 text width at 2 cm margins (twips)
// XML-safe text: escape, and drop characters Word cannot open (control / private-use)
const esc = (s) => String(s == null ? "" : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿-]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pg = (c) => { const a = (Array.isArray(c) ? c : [c]).filter((x) => x != null && x !== ""); return a.length ? "p." + [...new Set(a)].join(", ") : "—"; };

/* ── primitives ───────────────────────────────────────────────────────── */
function run(text, o = {}) {
  const r = [];
  if (o.b) r.push("<w:b/>"); if (o.i) r.push("<w:i/>");
  if (o.color) r.push(`<w:color w:val="${o.color}"/>`);
  if (o.sz) r.push(`<w:sz w:val="${o.sz}"/><w:szCs w:val="${o.sz}"/>`);
  if (o.caps) r.push("<w:caps/>");
  return `<w:r>${r.length ? `<w:rPr>${r.join("")}</w:rPr>` : ""}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}
function para(runs, o = {}) {
  const p = [];
  if (o.style) p.push(`<w:pStyle w:val="${o.style}"/>`);
  if (o.keepNext) p.push("<w:keepNext/>");
  if (o.border) p.push(`<w:pBdr><w:bottom w:val="single" w:sz="${o.borderSz || 6}" w:space="3" w:color="${o.border}"/></w:pBdr>`);
  if (o.shade) p.push(`<w:shd w:val="clear" w:color="auto" w:fill="${o.shade}"/>`);
  if (o.before != null || o.after != null) p.push(`<w:spacing${o.before != null ? ` w:before="${o.before}"` : ""}${o.after != null ? ` w:after="${o.after}"` : ""}/>`);
  if (o.indent) p.push(`<w:ind w:left="${o.indent}" w:hanging="${o.hanging || 0}"/>`);
  if (o.align) p.push(`<w:jc w:val="${o.align}"/>`);
  return `<w:p>${p.length ? `<w:pPr>${p.join("")}</w:pPr>` : ""}${Array.isArray(runs) ? runs.join("") : run(runs, o.run || {})}</w:p>`;
}
const H1 = (t) => para(t, { style: "Title" });
const H2 = (t) => para(t, { style: "Heading1" });
const H3 = (t) => para(t, { style: "Heading2" });
const P = (t, o = {}) => para([run(t, o)], { after: o.after });
const note = (t) => para(t, { style: "Caption" });
const bullet = (t, cite, o = {}) => para([run(o.mark || "•", { color: RULE, b: true }), run("  " + t), cite ? run(`  (${cite})`, { color: MUTE, sz: 17 }) : ""], { indent: 360, hanging: 240, after: 70 });
const numbered = (i, t, cite) => bullet(t, cite, { mark: `${i}.` });

/* table(rows, widths%, {header, zebra, sizes}) — widths are fractions of the text width */
function table(rows, fr, o = {}) {
  const ws = fr.map((f) => Math.round(W * f));
  const grid = ws.map((w) => `<w:gridCol w:w="${w}"/>`).join("");
  const trs = rows.map((cells, ri) => {
    const head = o.header !== false && ri === 0;
    const tcs = cells.map((c, ci) => {
      const cell = c && typeof c === "object" && !Array.isArray(c) ? c : { text: c };
      const fill = head ? HEAD : cell.fill || (o.zebra && ri % 2 === 0 ? ZEBRA : null);
      const lines = String(cell.text == null ? "—" : cell.text).split("\n");
      const ps = lines.map((ln) => para([run(ln, { b: head || cell.b, color: cell.color || (head ? INK : INK), sz: head ? 18 : cell.sz || 19, i: cell.i })], { style: "TableText", align: cell.align })).join("");
      return `<w:tc><w:tcPr><w:tcW w:w="${ws[ci]}" w:type="dxa"/>${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ""}<w:vAlign w:val="${head ? "bottom" : "top"}"/></w:tcPr>${ps}</w:tc>`;
    }).join("");
    return `<w:tr><w:trPr><w:cantSplit/>${head ? "<w:tblHeader/>" : ""}</w:trPr>${tcs}</w:tr>`;
  }).join("");
  return `<w:tbl><w:tblPr><w:tblStyle w:val="MTable"/><w:tblW w:w="${W}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${trs}</w:tbl>` + para("", { after: 120 });
}
const up = (v) => ({ text: v, color: GREEN, b: true }), down = (v) => ({ text: v, color: RED, b: true });
const arrow = (d) => ({ up: "↗ up", down: "↘ down", flat: "→ flat", watch: "? watch", mixed: "↕ mixed" }[d] || d || "—");
const sev = (s) => (s === "high" ? { text: "High", color: RED, b: true } : s === "medium" ? { text: "Medium", color: AMBER, b: true } : { text: "Low", color: MUTE });
const score5 = (v) => (v == null ? "—" : `${v} / 5`);

/* ── the report ───────────────────────────────────────────────────────── */
function buildBody(a, summary, meta) {
  const out = [];
  const m = a.meta || {}, ai = a.ai || null, s = a.snapshot || {}, sc = s.scores || {};
  const name = meta.name || m.company || meta.symbol || "Company";
  const sym = meta.symbol || m.symbol || "";
  const mgmt = (a.participants && a.participants.management) || [], analysts = (a.participants && a.participants.analysts) || [];
  const firms = [...new Set(analysts.map((x) => x.firm).filter(Boolean))];
  let n = 0; const sec = (title) => out.push(H2(`${++n}. ${title}`));

  // ── cover / call metadata (M1)
  out.push(para([run("EARNINGS CALL ANALYSIS  ·  M-TERMINAL", { b: true, color: RULE, sz: 17 })], { after: 40 }));
  out.push(H1(`${name}${m.period ? ` — ${m.period} earnings call` : " — earnings call"}`));
  out.push(para([run(`${sym ? sym + "  ·  " : ""}${m.callDate ? "Call held " + new Date(m.callDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) + "  ·  " : ""}Report generated ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`, { color: MUTE, sz: 19 })], { border: LINE, after: 200 }));
  out.push(table([
    ["Field", "Value"],
    ["Company", `${name}${sym ? ` (${sym})` : ""}${m.sector ? ` · ${m.sector}` : ""}`],
    ["Event", `${m.period || "Earnings"} call${m.callDate ? ` · ${m.callDate}` : ""}`],
    ["Management", mgmt.length ? mgmt.slice(0, 8).map((x) => `${x.name}${x.title ? ` (${x.title})` : ""}`).join("\n") : "Not disclosed"],
    ["Analysts on Q&A", analysts.length ? `${analysts.length}${firms.length ? " — " + firms.slice(0, 14).join(", ") : ""}` : "Not identified"],
    ["Transcript", `${m.pages ? m.pages + " pages · " : ""}~${(a.stats.preparedWords || 0).toLocaleString("en-IN")} words of prepared remarks, ~${(a.stats.qaWords || 0).toLocaleString("en-IN")} words of management answers`],
    ["Source note", m.editedTranscript ? "Transcript edited for readability — quotes may not be verbatim" : "Transcript as filed"],
  ], [0.24, 0.76], { zebra: true }));

  // ── 1 · executive snapshot (M2)
  sec("Executive snapshot");
  const headline = (ai && ai.headline) || s.headline;
  if (headline) out.push(para([run("Headline: ", { b: true }), run(headline)], { after: 100 }));
  if (ai && ai.thesisImpact) out.push(para([run("Thesis impact: ", { b: true }), run(`${ai.thesisImpact[0].toUpperCase()}${ai.thesisImpact.slice(1)}`, { b: true, color: ai.thesisImpact === "positive" ? GREEN : ai.thesisImpact === "negative" ? RED : AMBER }), ai.thesisReason ? run(` — ${ai.thesisReason}`) : ""], { after: 120 }));
  const cred = sc.credibility;
  out.push(table([
    ["Score", "Value", "Why"],
    ["Overall tone", score5(sc.tone), a.tone && a.tone.reading ? a.tone.reading[0] : "—"],
    ["Guidance quality", score5(sc.guidanceQuality), `${a.guidance.filter((g) => g.quantified).length} quantified of ${a.guidance.length} forward-looking statements${a.guidance.some((g) => g.condition) ? "; some carry conditions" : ""}`],
    ["Avg answer quality", sc.answerQuality == null ? "—" : `${sc.answerQuality} / 5`, `${a.qa.exchanges.length} exchanges scored; ${a.qa.exchanges.filter((x) => x.score != null && x.score <= 2).length} deflected or refused`],
    ["Credibility", cred ? `${cred.share}%` : "Insufficient history", cred ? `${cred.delivered} of ${cred.graded} prior-call monitorables delivered` : "Needs the previous call in the context store"],
    ["Red-flag level", sev(sc.redFlagLevel || "low"), `${a.redFlags.flags.length} flag(s); clean on ${a.redFlags.clean.length} checks`],
  ], [0.2, 0.16, 0.64], { zebra: true }));
  out.push(H3("Top positives"));
  (s.positives || []).forEach((x, i) => out.push(numbered(i + 1, x.text, pg(x.cite))));
  if (!(s.positives || []).length) out.push(P("Not disclosed.", { color: MUTE }));
  out.push(H3("Top negatives / watch-items"));
  (s.negatives || []).forEach((x, i) => out.push(numbered(i + 1, x.text, pg(x.cite))));
  if (!(s.negatives || []).length) out.push(P("None stated.", { color: MUTE }));

  // ── 2 · operating environment (M3)
  sec("Operating environment");
  if (ai && ai.environment && ai.environment.length) out.push(table([["Factor", "Management read", "Direction", "Page"], ...ai.environment.map((e) => [{ text: e.factor, b: true }, e.read, arrow(e.direction), pg(e.cite)])], [0.2, 0.56, 0.12, 0.12], { zebra: true }));
  else {
    const ext = a.themes.find((t) => /external|regulation/i.test(t.theme));
    if (ext) ext.points.forEach((p) => out.push(bullet(p.text, pg(p.page)))); else out.push(P("Not disclosed.", { color: MUTE }));
    if (!ai) out.push(note("Factor-by-factor environment table appears when the AI modules are available."));
  }

  // ── 3 · reported performance (M4)
  sec("Reported performance");
  const facts = a.facts || [];
  if (facts.length) out.push(table([["Metric", "Business", "Value", "Change", "Basis", "Page"], ...facts.map((f) => [{ text: f.metric, b: true }, f.qualifier || "Company", f.value || "—", f.change ? (/^-/.test(f.change) ? down : up)(`${f.change}${f.period ? " " + f.period : ""}${f.computed ? " (computed)" : ""}`) : "—", f.basis || "—", pg(f.page)])], [0.22, 0.17, 0.2, 0.19, 0.1, 0.12], { zebra: true }));
  else out.push(P("No quantified results were stated on the call (the numbers are likely in the results presentation).", { color: MUTE }));
  out.push(note("Basis: value = reported-currency amounts and growth; volume = units or tonnes; price = realisation / pricing; cc = constant currency; margin = a margin or its change in bps; ratio = other ratios (share, NPA, returns)."));

  // ── 4 · segment scorecard (M5)
  sec("Segment scorecard");
  if (ai && ai.segments && ai.segments.length) out.push(table([["Segment", "This quarter", "Year", "Driver", "Outlook", "Signal", "Page"], ...ai.segments.map((x) => [{ text: x.name, b: true }, x.quarter, x.year, x.driver, x.outlook, arrow(x.signal), pg(x.cite)])], [0.14, 0.15, 0.12, 0.22, 0.2, 0.08, 0.09], { zebra: true }));
  else {
    const seg = facts.filter((f) => f.qualifier);
    if (seg.length) out.push(table([["Business", "Metric", "Value", "Change", "Page"], ...seg.map((f) => [{ text: f.qualifier, b: true }, f.metric, f.value || "—", f.change || "—", pg(f.page)])], [0.26, 0.24, 0.2, 0.18, 0.12], { zebra: true }));
    else out.push(P("No business-level figures were stated.", { color: MUTE }));
  }

  // ── 5 · guidance tracker (M6)
  sec("Guidance tracker");
  if (a.guidance.length) {
    out.push(table([["Metric", "Period", "Guidance", "Condition", "vs prior call", "Score", "Speaker, page"],
      ...a.guidance.map((g) => [{ text: g.metric || "—", b: true }, g.period || "—", g.target || { text: "Qualitative", i: true }, g.condition || "—", g.vsPrior ? (g.vsPrior === "raised" ? up("Raised") : g.vsPrior === "cut" ? down("Cut") : "Maintained") : "Not stated", `${g.score}/5`, `${g.speaker || "Management"}, ${pg(g.page)}`])], [0.15, 0.1, 0.14, 0.2, 0.12, 0.08, 0.21], { zebra: true }));
    out.push(H3("Statements"));
    a.guidance.slice(0, 10).forEach((g) => out.push(bullet(g.statement, pg(g.page))));
    out.push(note("Guidance quality (1–5): 5 quantified, time-bound, unconditional and raised · 4 quantified and time-bound · 3 directional range (e.g. \"high single digit\") · 2 qualitative · 1 cut or withdrawn. \"vs prior\" is shown only where the transcript says so or the previous call is in the context store."));
  } else out.push(P("No explicit forward guidance was given.", { color: MUTE }));

  // ── 6 · cost & margin (M7)
  sec("Cost, pricing & margin");
  const rc = a.reconciliation;
  if (rc) out.push(para([run("Margin bridge: ", { b: true }), run(`${rc.components.join(" − ")} ⇒ implied ${rc.implied}; stated ${rc.stated}. `), run(rc.reconciles ? "The components reconcile to the headline guide." : "The components do NOT add up to the headline guide.", { b: true, color: rc.reconciles ? GREEN : RED }), run(`  (${pg(rc.cite)})`, { color: MUTE, sz: 17 })], { after: 120 }));
  if (ai && ai.costs && ai.costs.length) out.push(table([["Input / cost", "Direction", "Magnitude", "Action taken", "Net read", "Page"], ...ai.costs.map((c) => [{ text: c.input, b: true }, arrow(c.direction), c.magnitude, c.action, c.net === "tailwind" ? up("Tailwind") : c.net === "headwind" ? down("Headwind") : "Neutral", pg(c.cite)])], [0.18, 0.11, 0.17, 0.3, 0.12, 0.12], { zebra: true }));
  else {
    const t = a.themes.find((x) => /pricing|margins|costs/i.test(x.theme));
    if (t) t.points.forEach((p) => out.push(bullet(p.text, pg(p.page)))); else if (!rc) out.push(P("Not disclosed.", { color: MUTE }));
  }

  // ── 7 · strategy & capital allocation (M8)
  sec("Strategy & capital allocation");
  if (ai && ai.strategy && ai.strategy.length) out.push(table([["Move", "Horizon", "Page"], ...ai.strategy.map((x) => [x.item, x.horizon || "—", pg(x.cite)])], [0.68, 0.18, 0.14], { zebra: true }));
  const strat = a.themes.filter((t) => /capital allocation|strategy|balance sheet/i.test(t.theme));
  if (strat.length) strat.forEach((t) => { out.push(H3(t.theme)); t.points.forEach((p) => out.push(bullet(p.text, pg(p.page)))); });
  if (!(ai && ai.strategy && ai.strategy.length) && !strat.length) out.push(P("Not disclosed.", { color: MUTE }));

  // ── 8 · Q&A analytics (M9)
  sec("Q&A analytics");
  const qa = a.qa;
  if (qa.exchanges.length) {
    out.push(P(`${qa.exchanges.length} exchanges with ${analysts.length} analyst(s). Average answer quality ${qa.avgScore ?? "—"} / 5. The Street focused on ${qa.themes.slice(0, 3).map((t) => `${t.theme.toLowerCase()} (${t.questions})`).join(", ")}.`));
    out.push(table([["Theme", "Questions", "Asked by", "Avg answer"], ...qa.themes.map((t) => [{ text: t.theme, b: true }, String(t.questions), t.analysts.slice(0, 6).join(", ") || "—", t.avgScore == null ? "—" : `${t.avgScore} / 5`])], [0.26, 0.12, 0.46, 0.16], { zebra: true }));
    out.push(H3("Exchange-level scoring"));
    out.push(table([["Analyst (firm)", "Question", "Answer", "Score"], ...qa.exchanges.map((x) => [`${x.analyst || "Analyst"}${x.firm ? ` (${x.firm})` : ""}\n${pg(x.page)}`, x.question, x.answer || "—", x.score == null ? "—" : { text: `${x.score} · ${x.label}${x.phrase ? `\n"${x.phrase}"` : ""}`, color: x.score <= 2 ? RED : x.score >= 5 ? GREEN : INK, b: x.score <= 2 }])], [0.18, 0.34, 0.34, 0.14], { zebra: true }));
    const hm = qa.heatmap;
    if (hm && hm.rows.length > 1 && hm.themes.length > 1) {
      out.push(H3("Analyst × theme heat map"));
      const th = hm.themes.slice(0, 7);
      out.push(table([["Firm / analyst", ...th], ...hm.rows.map((r) => [r.who, ...th.map((t) => (r.counts[t] ? "●".repeat(Math.min(3, r.counts[t])) : ""))])], [0.22, ...th.map(() => 0.78 / th.length)], { zebra: true }));
    }
    out.push(note("Answer quality (1–5): 5 direct and quantified · 4 direct · 3 partial · 2 deflected · 1 refused. Deflecting phrases are quoted."));
  } else out.push(P("No analyst Q&A was found in the transcript.", { color: MUTE }));

  // ── 9 · tone & language (M10)
  sec("Tone & language");
  const t = a.tone;
  out.push(table([["Segment", "Confidence share", "Hedges / 1,000 words", "Tone score"],
    ["Prepared remarks", t.remarks.share == null ? "—" : `${t.remarks.share}%`, String(t.remarks.hedgePerK), score5(t.remarks.score)],
    ...(t.answers ? [["Q&A (management answers)", t.answers.share == null ? "—" : `${t.answers.share}%`, String(t.answers.hedgePerK), score5(t.answers.score)]] : []),
    ...t.speakers.map((sp) => [`Q&A — ${sp.name}`, sp.share == null ? "—" : `${sp.share}%`, String(sp.hedgePerK), score5(sp.score)]),
    [{ text: "Blended", b: true }, { text: t.overall.share == null ? "—" : `${t.overall.share}%`, b: true }, String(t.overall.hedgePerK), { text: score5(t.blendedScore), b: true }],
  ], [0.4, 0.2, 0.2, 0.2], { zebra: true }));
  (t.reading || []).forEach((r) => out.push(bullet(r)));
  if (t.phrases && t.phrases.length) { out.push(H3("Signature phrases")); out.push(table([["Phrase", "Speaker, page", "Read"], ...t.phrases.map((p) => [{ text: `"${p.text}"`, i: true }, `${p.speaker || "Management"}, ${pg(p.page)}`, p.read])], [0.56, 0.2, 0.24], { zebra: true })); }
  out.push(note("Tone (rubric): confidence markers ÷ (confidence markers + hedges) — ≥80% = 5, 70–79% = 4, 60–69% = 3, 50–59% = 2, <50% = 1. Hedges are labelled by object: the macro environment or the company's own execution."));

  // ── 10 · red flags (M11)
  sec("Red flags, evasions & inconsistencies");
  const rf = a.redFlags;
  if (rf.flags.length) out.push(table([["#", "Flag", "Evidence", "Severity", "What to do"], ...rf.flags.map((f, i) => [String(i + 1), { text: f.flag, b: true }, `${f.evidence}${f.cite.length ? ` (${pg(f.cite)})` : ""}`, sev(f.severity), f.action])], [0.05, 0.19, 0.4, 0.1, 0.26], { zebra: true }));
  else out.push(P("No red flags detected.", { color: GREEN, b: true }));
  if (rf.clean.length) out.push(para([run("No flags found for: ", { b: true }), run(rf.clean.map((c) => c.replace(/_/g, " ")).join(", ") + ". "), run("The absence of red flags is itself a finding.", { i: true, color: MUTE })], { after: 120 }));

  // ── 11 · bull / bear (M12)
  sec("Bull / bear case");
  if (ai && ((ai.bull && ai.bull.length) || (ai.bear && ai.bear.length))) {
    const len = Math.max(ai.bull.length, ai.bear.length);
    out.push(table([["Bull case", "Page", "Bear case", "Page"], ...Array.from({ length: len }, (_, i) => [ai.bull[i] ? ai.bull[i].point : "", ai.bull[i] ? pg(ai.bull[i].cite) : "", ai.bear[i] ? ai.bear[i].point : "", ai.bear[i] ? pg(ai.bear[i].cite) : ""])], [0.38, 0.12, 0.38, 0.12], { zebra: true }));
    if (ai.matrix && ai.matrix.length) { out.push(H3("Likelihood × impact (analyst judgment)")); out.push(table([["Thesis item", "Likelihood", "Impact", "Direction"], ...ai.matrix.map((x) => [x.item, x.likelihood, x.impact, x.sign === "up" ? up("Upside") : down("Downside")])], [0.55, 0.15, 0.15, 0.15], { zebra: true })); }
  } else {
    out.push(table([["Positives (from the call)", "Watch-items"], ...Array.from({ length: Math.max((s.positives || []).length, (s.negatives || []).length) }, (_, i) => [(s.positives[i] || {}).text || "", (s.negatives[i] || {}).text || ""])], [0.5, 0.5], { zebra: true }));
    if (!ai) out.push(note("A full bull / bear matrix appears when the AI modules are available."));
  }

  // ── 12 · monitorables & next-call questions (M12)
  sec("Monitorables — next-quarter checklist");
  if (a.monitorables.length) out.push(table([["KPI", "Management said", "Pass", "Watch", "Fail", "Page"], ...a.monitorables.map((x) => [{ text: x.kpi, b: true }, x.management, up(x.pass), { text: x.watch, color: AMBER }, down(x.fail), pg(x.cite)])], [0.2, 0.34, 0.11, 0.12, 0.11, 0.12], { zebra: true }));
  else out.push(P("No quantified targets to monitor were stated.", { color: MUTE }));
  if (a.context && a.context.graded && a.context.graded.length) { out.push(H3(`Last call's checklist, graded (${a.context.prior.period})`)); out.push(table([["KPI", "Guided", "Actual", "Result"], ...a.context.graded.map((g) => [g.kpi, g.guided, g.actual, g.result === "pass" ? up("Pass") : g.result === "fail" ? down("Fail") : { text: "Watch", color: AMBER }])], [0.3, 0.3, 0.2, 0.2], { zebra: true })); }
  if (a.nextQuestions.length) { out.push(H3("Questions for the next call")); a.nextQuestions.forEach((q, i) => out.push(numbered(i + 1, q))); }

  // ── appendix: management commentary, consensus, method
  out.push(H2("Appendix A — Management commentary by theme"));
  if (a.themes.length) a.themes.forEach((th) => { out.push(H3(th.theme)); th.points.forEach((p) => out.push(bullet(p.text, `${p.speaker ? p.speaker + ", " : ""}${pg(p.page)}`))); });
  else out.push(P("Not available.", { color: MUTE }));
  if (summary && summary.available && (summary.history || []).length) {
    const ccy = summary.currency === "INR" ? "₹" : summary.currency === "USD" ? "$" : "";
    const eps = (v) => (v == null ? "—" : ccy + (Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1)));
    out.push(H2("Appendix B — Results against consensus"));
    out.push(table([["Quarter end", "Reported EPS", "Consensus EPS", "Surprise", "Result"], ...summary.history.slice(-8).reverse().map((h) => [new Date(h.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }), eps(h.epsActual), eps(h.epsEstimate), h.surprisePct == null ? "—" : (h.surprisePct >= 0 ? up : down)(`${h.surprisePct >= 0 ? "+" : ""}${h.surprisePct.toFixed(1)}%`), h.beat == null ? "—" : h.beat ? up("Beat") : down("Miss")])], [0.24, 0.19, 0.19, 0.19, 0.19], { zebra: true }));
    if ((summary.forward || []).length) out.push(table([["Forward consensus", "EPS", "Growth", "Analysts"], ...summary.forward.map((f) => [f.label, eps(f.epsAvg), f.growthPct == null ? "—" : `${f.growthPct >= 0 ? "+" : ""}${f.growthPct.toFixed(0)}%`, String(f.numAnalysts ?? "—")])], [0.4, 0.2, 0.2, 0.2], { zebra: true }));
    out.push(note("Source: sell-side consensus via market-data provider — context only."));
  }
  out.push(H2("Methodology & disclaimer"));
  out.push(P(`Every statement in this report is taken from the transcript and cited to its page; where the transcript is silent the report says "not disclosed". Figures, guidance, Q&A scoring, tone, red flags and monitorables are computed by M-Terminal's rule-based analyser (${a.method}).${ai ? ` Operating environment, segment scorecard, cost matrix, strategy and the bull / bear case were drafted by a language model from page-tagged extracts of the transcript; each item cites its pages and any number not found in the transcript was removed${ai.dropped ? ` (${ai.dropped} item(s) removed)` : ""}.` : " Model-assisted modules were not available for this report."}${(a.warnings || []).length ? " Notes: " + a.warnings.join(" ") : ""}`, { sz: 18, color: MUTE }));
  out.push(P("For information only — not investment advice, an offer or a solicitation. Verify against the company's filings before acting.", { sz: 18, color: MUTE, i: true }));
  return out.join("");
}

/* ── package parts ────────────────────────────────────────────────────── */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:color w:val="${INK}"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="80"/></w:pPr><w:rPr><w:b/><w:color w:val="${INK}"/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:pBdr><w:bottom w:val="single" w:sz="8" w:space="3" w:color="${RULE}"/></w:pBdr><w:spacing w:before="360" w:after="140"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="${INK}"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="220" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="${AMBER}"/><w:sz w:val="23"/><w:szCs w:val="23"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="40" w:after="160"/></w:pPr><w:rPr><w:i/><w:color w:val="${MUTE}"/><w:sz w:val="17"/><w:szCs w:val="17"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table Text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="20" w:after="20" w:line="252" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:pPr><w:tabs><w:tab w:val="right" w:pos="${W}"/></w:tabs><w:spacing w:after="0"/></w:pPr><w:rPr><w:color w:val="${MUTE}"/><w:sz w:val="16"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:after="0"/></w:pPr><w:rPr><w:color w:val="${MUTE}"/><w:sz w:val="16"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="MTable"><w:name w:val="M Table"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="6" w:color="${LINE}"/><w:bottom w:val="single" w:sz="6" w:color="${LINE}"/><w:insideH w:val="single" w:sz="4" w:color="E8E3D6"/></w:tblBorders><w:tblCellMar><w:top w:w="50" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="50" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;
const fld = (instr) => `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
const NS = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;

async function buildDocx(analysis, summary, meta) {
  const m = analysis.meta || {};
  const title = `${meta.name || m.company || meta.symbol || "Company"}${m.period ? " · " + m.period : ""}`;
  const body = buildBody(analysis, summary, meta || {});
  const sect = `<w:sectPr><w:headerReference w:type="default" r:id="rIdH"/><w:footerReference w:type="default" r:id="rIdF"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>`;
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${NS}><w:body>${body}${sect}</w:body></w:document>`;
  const header = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:hdr ${NS}><w:p><w:pPr><w:pStyle w:val="Header"/><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="4" w:color="${LINE}"/></w:pBdr></w:pPr>${run("M-Terminal  ·  Earnings Call Analysis")}<w:r><w:tab/></w:r>${run(title)}</w:p></w:hdr>`;
  const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr ${NS}><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr>${run("Page ")}${fld("PAGE")}${run(" of ")}${fld("NUMPAGES")}${run("   ·   Cited to transcript pages · not investment advice")}</w:p></w:ftr>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdH" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdF" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)} — Earnings Call Analysis</dc:title><dc:creator>M-Terminal</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`;
  const zip = new JSZip();
  zip.file("[Content_Types].xml", types);
  zip.file("_rels/.rels", rels);
  zip.file("word/document.xml", doc);
  zip.file("word/styles.xml", STYLES);
  zip.file("word/header1.xml", header);
  zip.file("word/footer1.xml", footer);
  zip.file("word/_rels/document.xml.rels", docRels);
  zip.file("docProps/core.xml", core);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

module.exports = { buildDocx };
