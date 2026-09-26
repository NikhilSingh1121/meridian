/**
 * Earnings-call analyser — regression tests (synthetic transcripts, offline).
 * Pins the behaviours found while testing ~20 real NSE transcripts: cover-letter
 * removal, the three speaker layouts, analyst / firm attribution, page citations,
 * metric attribution (distributive growth, "from X to Y", segment qualifiers,
 * run-rates / targets excluded), guidance scoring, answer-quality scoring,
 * red flags and a valid .docx package.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCall } = require("./callParse");
const { analyzeCall, extractKpis, guidanceItems } = require("./callAnalysis");
const { scoreAnswer, thresholds } = require("./callModules");
const { buildDocx } = require("./docx-report");
const JSZip = require("jszip");

const COVER = `[[p1]]
Ref: SEC/2026
Symbol: DEMO
Sub: Transcript of the earnings call
Dear Sir,
Please find enclosed the transcript.
Encl.: as above
[[p2]]
`;
const LABELLED = COVER + `Moderator: Ladies and gentlemen, good day and welcome to the Demo Limited Q1 FY27 earnings conference call. I now hand the conference over to Mr. Ravi Kumar.
Ravi Kumar: Thank you. We have started the year on a very strong note with consolidated revenue growth of 23% and EBITDA and PAT growth of 25%. EBITDA margin improved 40 basis points year-on-year to 20.7%. Our well-established brand, Tiscon, grew volumes 33% YoY. EBITDA per ton improved from about Rs. 15,907 per ton in 4Q to about Rs. 19,162 per ton in 1Q. Foods crossed an annualised revenue run rate of INR 1,300 crores. We expect India to deliver high single-digit volume growth for FY27. If situations normalize, we would target high-teens EBITDA growth for FY27.
[[p3]]
Moderator: The first question is from the line of Abneesh Roy from Nuvama. Please go ahead.
Abneesh Roy: How has April been in the Middle East? And what is the price versus volume split?
Ravi Kumar: Let me not get into quarter-wise numbers; we will wait and see how the situation unfolds.
Moderator: The next question is from the line of Mihir Shah with Nomura.
Mihir Shah: What tax rate should we assume for FY27?
Ravi Kumar: The consolidated tax rate should be about 20% for FY27, in line with the last year.
`;

test("parseCall: cover letter removed, speakers, analysts with firms, pages", () => {
  const c = parseCall(LABELLED);
  assert.match(c.warnings.join(" "), /Cover letter removed/);
  assert.ok(!c.turns.some((t) => /^(Sub|Ref|Encl|Symbol)/.test(t.speaker || "")), "letter furniture is not a speaker");
  assert.equal(c.period, "Q1 FY27");
  const an = c.participants.analysts.map((a) => `${a.name}@${a.firm}`);
  assert.ok(an.includes("Abneesh Roy@Nuvama") && an.includes("Mihir Shah@Nomura"), an.join(","));
  assert.equal(c.qa.length, 2);
  assert.equal(c.qa[0].page, 3);
  assert.ok(c.turns.find((t) => t.speaker === "Ravi Kumar").page === 2);
});

test("parseCall: prose transcript split by moderator cues and answer openers", () => {
  const prose = `Ladies and gentlemen, good day and welcome to the Steelco earnings call.
Thank you. Our India deliveries were 5.17 million tons and EBITDA margin was 27%.

We will take our first question from Ritu Singh from CNBC-TV18. Please go ahead.

Good evening. How sustainable are these margins? Do you have levers to expand further?

Thank you, Ritu. The margin benefited from realisations and should hold near these levels.

Next question is from Satyadeep Jain of Ambit Capital. Please go ahead.

Hi, thank you. What is the capex plan for this year?

So, capex will be about Rs. 15,000 crores for the year.`;
  const c = parseCall(prose);
  assert.equal(c.format, "prose");
  assert.deepEqual(c.qa.map((q) => `${q.analyst}@${q.firm}`), ["Ritu Singh@CNBC-TV18", "Satyadeep Jain@Ambit Capital"]);
  assert.match(c.qa[0].answer, /realisations/);
  assert.match(c.qa[1].question, /capex plan/);
});

test("extractKpis: distributive growth, from→to, brand qualifier, run-rates excluded, basis tags", () => {
  const items = [
    "We have started the year on a very strong note with consolidated revenue growth of 23% and EBITDA and PAT growth of 25%.",
    "EBITDA margin improved 40 basis points year-on-year to 20.7%.",
    "Our well-established brand, Tiscon, grew volumes 33% YoY.",
    "EBITDA per ton improved from about Rs. 15,907 per ton in 4Q to about Rs. 19,162 per ton in 1Q.",
    "Foods crossed an annualised revenue run rate of INR 1,300 crores.",
    "It now contributes to around 5% of India business revenues.",
  ].map((text, idx) => ({ text, prepared: true, idx, page: 2, speaker: "CFO" }));
  const k = extractKpis(items), by = (m, q = null) => k.find((x) => x.metric === m && (x.qualifier || null) === q);
  assert.equal(by("Revenue").change, "+23%");
  assert.equal(by("EBITDA").change, "+25%");
  assert.equal(by("Net profit").change, "+25%");
  assert.equal(by("EBITDA margin").value, "20.7%");
  assert.equal(by("EBITDA margin").change, "40 bps");
  assert.equal(by("EBITDA margin").basis, "margin");
  assert.equal(by("EBITDA per tonne").value, "Rs. 19,162");
  assert.ok(by("Volume", "Tiscon"), "brand-level volume is qualified, not company-wide");
  assert.ok(!by("Volume"), "no company-wide volume from a brand figure");
  assert.ok(!k.some((x) => /1,300/.test(x.value || "")), "run-rate is not reported revenue");
  assert.ok(!k.some((x) => x.change === "+5%"), "a share of revenue is not growth");
});

test("guidance: verbal ranges, conditions, periods and the 1–5 quality score", () => {
  const items = [
    "We expect India to deliver high single-digit volume growth for FY27.",
    "If situations normalize, we would target high-teens EBITDA growth for FY27.",
    "Advertising grew 25% as we continue to invest for the long term.",
    "I also sincerely thank the board for their guidance.",
  ].map((text, idx) => ({ text, prepared: true, idx, page: 4, speaker: "CEO" }));
  const g = guidanceItems(items);
  assert.equal(g.length, 2, g.map((x) => x.statement).join(" | "));
  const vol = g.find((x) => /volume/i.test(x.statement)), eb = g.find((x) => /EBITDA/.test(x.statement));
  assert.equal(vol.target, "high single digit");
  assert.equal(vol.period, "FY27");
  assert.equal(eb.target, "high teens");
  assert.match(eb.condition, /^If situations normalize/);
  assert.equal(vol.score, 3);
  assert.deepEqual(thresholds(vol), { pass: "≥7%", watch: "5–7%", fail: "<5%" });
});

test("answer quality rubric: deflected, refused, quantified, partial", () => {
  assert.equal(scoreAnswer("How was April?", "Let me not get into quarter-wise numbers; we will wait and see.").score, 2);
  assert.equal(scoreAnswer("Split of price and volume?", "We don't give that split.").score, 1);
  assert.equal(scoreAnswer("Tax rate?", "The consolidated tax rate should be about 20% for FY27.").score, 5);
  assert.equal(scoreAnswer("Margin? And capex? And debt?", "Margins will hold.").score, 3);
});

test("analyzeCall: modules, red flags, citations; docx package opens", async () => {
  const a = analyzeCall(LABELLED, { symbol: "DEMO.NS" });
  assert.ok(!a.error, a.error);
  assert.equal(a.meta.period, "Q1 FY27");
  assert.ok(a.facts.every((f) => f.page != null), "every fact cites a page");
  assert.ok(a.qa.exchanges.some((x) => x.score === 2 && /not get into|wait and see/i.test(x.phrase || "")));
  assert.ok(a.redFlags.flags.some((f) => /condition/i.test(f.flag)), a.redFlags.flags.map((f) => f.flag).join(","));
  assert.ok(a.monitorables.length >= 1);
  const buf = await buildDocx(a, null, { symbol: "DEMO.NS", name: "Demo" });
  const zip = await JSZip.loadAsync(buf);
  for (const part of ["word/document.xml", "word/styles.xml", "word/header1.xml", "word/footer1.xml", "word/_rels/document.xml.rels", "[Content_Types].xml"]) assert.ok(zip.file(part), part);
  const doc = await zip.file("word/document.xml").async("string");
  assert.ok(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(doc), "no XML-invalid control characters");
  assert.match(doc, /Guidance tracker/);
});
