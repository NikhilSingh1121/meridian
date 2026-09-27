/**
 * Earnings-call analysis — deterministic, no model.
 *
 * Reads the structured call from callParse and produces what an analyst
 * wants from a transcript:
 *   · takeaways          the handful of things that matter, in plain sentences
 *   · kpis               headline numbers management stated (value, change, margin)
 *   · themes             management commentary grouped by topic, verbatim
 *   · guidance           forward-looking statements (quantified first)
 *   · qa                 who asked what, from which firm, and what management said
 *   · concerns           what the analysts pressed on, and how often
 *   · tone               a calibrated reading of the language, prepared vs Q&A
 * Every sentence shown is taken from the transcript; nothing is invented.
 */
const { parseCall, unmark } = require("./callParse");

/* ── sentences ────────────────────────────────────────────────────────── */
const ABBR = /\b(Rs|Mr|Ms|Mrs|Dr|No|Nos|vs|approx|Co|Ltd|Inc|St|Jr|Sr|e\.g|i\.e|etc|Sh|Smt|Govt|Dept|Fig|Q|U\.S|U\.K)\./g;
function rawSentences(text) {
  const t = String(text || "").replace(/\s+/g, " ").replace(ABBR, (m) => m.replace(/\./g, "§")).replace(/(\d)\.(\d)/g, "$1§$2");
  return t.split(/(?<=[.?!])\s+(?=(?:⟦\d+⟧\s*)?["'(]?[A-Z0-9₹])/).map((s) => s.replace(/§/g, ".").trim());
}
function sentences(text) { return rawSentences(text).map(unmark).filter((s) => s.length > 3); }
// sentences with the page each one sits on (page marks travel inline as ⟦n⟧)
function sentencesPaged(text, startPage) {
  const out = []; let page = startPage == null ? null : startPage;
  for (const raw of rawSentences(text)) {
    const lead = raw.match(/^\s*⟦(\d+)⟧/); if (lead) page = +lead[1];
    const s = unmark(raw); if (s.length > 3) out.push({ text: s, page });
    const all = [...raw.matchAll(/⟦(\d+)⟧/g)]; if (all.length) page = +all[all.length - 1][1];
  }
  return out;
}
const words = (s) => (String(s || "").match(/[A-Za-z0-9₹%'-]+/g) || []).length;
const FILLER_START = /^(so|and|but|now|okay|ok|yeah|yes|well|see|also|then|like|right|sure|actually|basically|again|firstly|secondly|thirdly|finally)[,\s]+/i;
function tidy(s, max = 300) {
  let t = unmark(String(s || "")).replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3 && FILLER_START.test(t); i++) t = t.replace(FILLER_START, "");
  t = t.replace(/\b(you know|I mean|kind of|sort of),?\s+/gi, "").replace(/\s{2,}/g, " ");
  if (t) t = t[0].toUpperCase() + t.slice(1);
  if (t.length > max) { const cut = t.slice(0, max); const at = Math.max(cut.lastIndexOf(", "), cut.lastIndexOf("; ")); t = (at > max * 0.6 ? cut.slice(0, at) : cut.replace(/\s+\S*$/, "")) + "…"; }
  return t;
}
const CHATTER = /\b(thank(s| you)|good (morning|afternoon|evening|day)|welcome|over to|hand (it )?over|next question|join(ing)? (us|the call)|this call|presentation (is|has been) (uploaded|available)|safe harbou?r|forward-looking statements?|recorded|press (\*|star)|question queue|please go ahead|can you hear|audio|line is (open|unmuted)|let me (just )?(start|begin)|as (you|we) (can )?see (on|in) (the )?slide|slide (no\.? ?)?\d+)\b/i;
function isSubstantive(s) {
  if (!s || s.length < 45 || s.length > 600) return false;
  if (CHATTER.test(s) || /\?\s*$/.test(s)) return false;
  const letters = (s.match(/[A-Za-z]/g) || []).length;
  if (letters / s.replace(/\s/g, "").length < 0.6) return false;
  return words(s) >= 8;
}

/* ── figures ──────────────────────────────────────────────────────────── */
const FIG = /(?:(₹|Rs\.?|INR|US\$|USD|\$|€|EUR)\s?)?(\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)(\s?(?:lakh crores?|crores?|cr\b\.?|lakhs?|lacs?|billion|bn\b|million|mn\b|mln\b|trillion|tn\b|thousand))?(\s?(?:%|per ?cent|percent|bps|basis points?|x\b|times\b|million tons?|million tonnes?|mtpa\b|mt\b|tonnes?|tons?|gw\b|mw\b|units\b|vehicles\b|customers\b|subscribers\b|stores\b|msf\b|million sq(?:uare)?\.? ?f(?:ee|oo)?t))?/gi;
function figures(s) {
  const out = []; let m; FIG.lastIndex = 0;
  while ((m = FIG.exec(s)) !== null) {
    const [raw, cur, num, scale, unit] = m;
    const v = parseFloat(num.replace(/,/g, ""));
    const before = s.slice(Math.max(0, m.index - 4), m.index);
    // years, fiscal labels and quarter names are not figures
    if (!cur && !scale && !unit) { if (/^(19|20)\d{2}$/.test(num) || /(FY|Q|H)\s?$/i.test(before)) continue; }
    if (/FY\s?$|Q$|H$/i.test(before) && !unit) continue;
    const u = (unit || "").trim().toLowerCase(), sc = (scale || "").trim().toLowerCase();
    // money needs a currency sign, or an Indian money scale (crore / lakh); "3.3 million" alone is a count
    const kind = /%|per ?cent|percent/.test(u) ? "pct" : /bps|basis/.test(u) ? "bps" : u && !/x|times/.test(u) ? "volume" : cur || /crore|cr\b|lakh|lac/.test(sc) ? "amount" : /x|times/.test(u) ? "multiple" : sc ? "count" : "number";
    if (kind === "number") continue;
    out.push({ raw: raw.replace(/\s+/g, " ").trim(), kind, value: v, at: m.index, end: m.index + raw.length });
  }
  return out;
}
const QUAL_FIG = /\b(high|mid|low|early)[- ](single|double)[- ]digits?\b|\b(double|single)[- ]digits?\b|\b(low|mid|high|early)[- ]teens?\b|\b(low|mid|high|early)[- ]twenties\b/i;

/* ── metric vocabulary (generic + sector) ─────────────────────────────── */
// [label, pattern, type] — type "level": a % is a level (margin, ratio); otherwise a % is growth
const METRICS = [
  ["EBITDA margin", /\b(ebitda margins?|operating (profit )?margins?|opm)\b/i, "level"],
  ["Gross margin", /\bgross margins?\b/i, "level"],
  ["Net interest margin", /\b(net interest margins?|nims?)\b/i, "level"],
  ["EBITDA per tonne", /\bebitda (per|\/) ?(tonne|ton|t)\b/i, "value"],
  ["Realisation per tonne", /\b(realis|realiz)ations? (per|\/) ?(tonne|ton)\b/i, "value"],
  ["Revenue", /\b(revenues? from operations|revenues?(?![- ](earning|generating|market share|mix|per))|net sales|top[- ]?line|turnover|total income|sales growth|consolidated sales)\b/i, "value"],
  ["Volume", /\b(underlying volume growth|uvg|volume growth|volumes?|sales volumes?|deliveries|dispatches)\b/i, "value"],
  ["EBITDA", /\b(ebitda|operating profit)\b/i, "value"],
  ["Net profit", /\b(pat|net profit|profit after tax|net income|bottom[- ]?line)\b/i, "value"],
  ["EPS", /\b(eps|earnings per share)\b/i, "value"],
  ["Net interest income", /\b(nii|net interest income)\b/i, "value"],
  ["Loan book", /\b(loan book|loans|advances|loan growth|credit growth|loan portfolio)\b/i, "value"],
  ["AUM", /\b(aum|assets under management)\b/i, "value"],
  ["Disbursements", /\bdisbursements?\b/i, "value"],
  ["Deposits", /\bdeposits?\b/i, "value"],
  ["CASA ratio", /\bcasa\b/i, "level"],
  ["Gross NPA", /\b(gnpa|gross npa|gross non-performing)\b/i, "level"],
  ["Net NPA", /\b(nnpa|net npa)\b/i, "level"],
  ["Credit cost", /\bcredit costs?\b/i, "level"],
  ["Return on assets", /\b(roa|return on assets)\b/i, "level"],
  ["Return on equity", /\b(roe|return on equity)\b/i, "level"],
  ["Cost-to-income", /\bcost[- ]to[- ]income\b/i, "level"],
  ["Deal wins (TCV)", /\b(tcv|total contract value|deal wins?)\b/i, "value"],
  ["Attrition", /\battrition\b/i, "level"],
  ["Utilisation", /\butili[sz]ation\b/i, "level"],
  ["APE", /\b(ape|annuali[sz]ed premium equivalent)\b/i, "value"],
  ["VNB margin", /\b(vnb margins?|new business margins?)\b/i, "level"],
  ["VNB", /\b(vnb|value of new business)\b/i, "value"],
  ["Solvency ratio", /\bsolvency\b/i, "level"],
  ["ARPU", /\barpu\b/i, "value"],
  ["Pre-sales / bookings", /\b(pre-?sales|sales bookings|new bookings)\b/i, "value"],
  ["Collections", /\bcollections\b/i, "value"],
  ["Order inflow", /\b(order inflows?|order intake|new orders)\b/i, "value"],
  ["Order book", /\b(order book|order backlog)\b/i, "value"],
  ["Capacity", /\b(installed capacity|capacity)\b/i, "value"],
  ["Plant load factor", /\b(plf|plant load factor)\b/i, "level"],
  ["Capex", /\b(capex|capital expenditure)\b/i, "value"],
  ["Net debt", /\bnet debt\b/i, "value"],
  ["Net cash", /\bnet cash\b/i, "value"],
  ["Free cash flow", /\b(free cash flows?|fcf)\b/i, "value"],
  ["Advertising spend", /\b(advertising|a&p|ad spends?|ad spend)\b/i, "value"],
  ["Market share", /\bmarket shares?\b/i, "level"],
  ["Price increase", /\bprice (hikes?|increases?)\b/i, "value"],
  ["Tax rate", /\b(effective )?tax rate\b/i, "level"],
  ["R&D spend", /\b(r&d|research and development)\b/i, "value"],
  ["Dividend", /\bdividend\b/i, "value"],
];
const GROWTH_WORD = /\b(grew|grow(?:th|ing|s)?|up|increas\w*|rose|rise|higher|expan\w*|improv\w*|jump\w*|surg\w*|declin\w*|down|fell|fall\w*|lower|drop\w*|contract\w*|compress\w*|y-?o-?y|yoy|year[- ]on[- ]year|q-?o-?q|qoq|quarter[- ]on[- ]quarter|sequential\w*|cagr)\b/i;
const NEG_WORD = /\b(declin\w*|down|fell|fall\w*|lower|drop\w*|contract\w*|compress\w*|negative|degrow\w*|de-grow\w*)\b/i;
const QUALIFIER = /\b(consolidated|standalone|domestic|international|india|exports?|overseas|us|north america|europe|rural|urban|core)\b(?:\s+(business|operations|portfolio|market))?/i;

function metricMentions(s) {
  const out = [];
  for (const [label, re, type] of METRICS) {
    const g = new RegExp(re.source, "gi"); let m;
    while ((m = g.exec(s)) !== null) out.push({ label, type, at: m.index, end: m.index + m[0].length, text: m[0] });
  }
  // keep the longest mention at any overlapping position ("EBITDA margin" over "EBITDA")
  out.sort((a, b) => a.at - b.at || (b.end - b.at) - (a.end - a.at));
  const kept = [];
  for (const x of out) if (!kept.some((k) => x.at < k.end && x.end > k.at)) kept.push(x);
  return kept;
}

// words that start a capitalised run but do not name a business / brand / geography
const NOT_QUAL = new Set(("The We Our This That These Those In On At As For And But So Also Overall However Hence Further Total Consolidated Standalone Q1 Q2 Q3 Q4 QI 1Q 2Q 3Q 4Q FY H1 H2 YoY QoQ EBITDA EBITDAaL EBIT PBT PBDIT PBIT PAT OPM ROCE ROE ROA NII NIM CASA NPA GNPA NNPA ARPU APE VNB TCV AUM EPS CAGR MTPA MT KL GW MW WRP I It Its With From During Rs INR USD Crore Crores Moving Coming Talking Now Let If Of To By Year Quarter First Second Third Fourth Last Next Operating Gross Net Revenue Revenues Sales Profit Margin Margins Volume Volumes Growth Mr Ms Sir Madam Thank Thanks Yes Okay One Two Three There Here While Despite Given Within Across Both Similarly Likewise Meanwhile Lastly Finally Firstly Secondly Out " +
  "Absolute Reported Adjusted Normalised Normalized Underlying Organic Recurring Strong Healthy Robust Good Great Better Best Record Highest Lowest Higher Lower Key Top Average Quarterly Annual Sequentially Interestingly Importantly Clearly Basically Just Even Only All Some Most Many Each Every Other Another New Accordingly Therefore Thus Again Well Yeah Sure Hi Hello Good Starting Turning Looking Coming Going Speaking Regarding Around About Approximately Nearly Almost Over Under Above Below Close Roughly " +
  "January February March April May June July August September October November December").split(" "));
// a lowercase business word right before the metric, allowing a period word in between ("oil and gas, year-on-year revenues")
const SEGMENT_NOUN = /\b(formulations?|api|generics?|specialty|domestic|exports?|retail|wholesale|mobile|enterprise|broadband|home|b2b|b2c|institutional|government|rural|urban|digital|international|consumer|industrial|bfsi|premium|mass|e-?commerce|modern trade|general trade|quick commerce|oil and gas|oil & gas|o2c|oil to chemicals|refining|petrochemicals?|upstream|downstream|telecom|connectivity|digital services|media|new energy|renewables?|power|cement|steel|chemicals|segment)\b[,\s]*(?:(?:year|quarter)[- ]on[- ](?:year|quarter)|yoy|qoq|sequential(?:ly)?)?[,\s]*$/i;
function qualifierOf(s, m) {
  const pre = s.slice(Math.max(0, m.at - 55), m.at), base = Math.max(0, m.at - 55);
  const scope = pre.match(/\b(consolidated|standalone|domestic|international|exports?|overseas|rural|urban)\b/i);
  // a named business, brand or geography just before the metric ("Tata Tiscon grew volumes", "India business revenue");
  // a run followed by a fresh clause (", our …", ", we …") belongs to that clause, not to the metric
  const runs = [...pre.matchAll(/\b([A-Z][A-Za-z&'-]*(?:\s+[A-Z][A-Za-z&'-]*){0,3})/g)]
    .map((x) => ({ t: x[1].split(/\s+/).filter((w) => !NOT_QUAL.has(w)).join(" "), at: base + x.index, end: base + x.index + x[1].length }))
    .filter((x) => x.t && x.t.length > 1 && !/,\s*(our|we|the company|it|they|this)\b/i.test(s.slice(x.end, m.at)));
  const named = runs.length ? runs[runs.length - 1].t : null;
  if (named) return named;
  const noun = pre.match(SEGMENT_NOUN);
  if (noun) return cap(noun[1].toLowerCase());
  if (scope && !/consolidated/i.test(scope[1])) return cap(scope[1].toLowerCase());
  const post = s.slice(m.end, m.end + 50).match(/^[^.,;]{0,20}\b(?:in|from|for) (?:the )?(India|US|Europe|North America|emerging markets|rest of (?:the )?world|international markets|domestic market|[A-Z][a-z]+ markets?)\b/);
  return post ? cap(post[1]) : null;
}
const SHARE_OF = /^\s*(of|share of|contribution to|of our|of total|of the)\b/i;
// what kind of figure each metric's value can be
const VOLUME_METRICS = new Set(["Volume", "Capacity"]);
const valueFits = (label, f) => (VOLUME_METRICS.has(label) ? f.kind === "volume" || f.kind === "count" : f.kind === "amount");
// annualised run-rates, ambitions and targets are not reported figures
const NOT_REPORTED = /\b(run[- ]?rate|annuali[sz]ed|arr\b|aspir\w*|ambition|vision 20\d\d|target(s|ed|ing)?|to achieve|by 20\d\d|by fy ?\d{2}|guid\w*|will|expect\w*|potential|could|would)\b/i;
const REPORTING_VERB = /\b(was|were|is at|are at|stood|came in|grew|reported|delivered|increased|declined|rose|fell|registered|clocked|posted|improved|expanded|contracted|at about|at around|at roughly)\b/i;
const HEADLINE_SCOPE = /\b(consolidated|overall|group|total|company[- ]level|at the company|for the quarter|for q[1-4])\b/i;
function extractKpis(items) {
  const found = new Map();
  const upsert = (key, init) => { if (!found.has(key)) found.set(key, init); return found.get(key); };
  for (const it of items) {
    const s = it.text;
    if (NOT_REPORTED.test(s)) continue;
    if (!it.prepared && !REPORTING_VERB.test(s)) continue;                              // Q&A: only stated results, not musings
    const ms = metricMentions(s); if (!ms.length) continue;
    const fs = figures(s); if (!fs.length) continue;
    for (const f of fs) {
      // "from Rs 15,907 … to Rs 19,162": the current figure is the "to" one
      if (/\bfrom\s+(about\s+|around\s+|roughly\s+)?$/i.test(s.slice(Math.max(0, f.at - 20), f.at)) && /\bto\b/i.test(s.slice(f.end, f.end + 60))) continue;
      const after = s.slice(f.end, f.end + 34);
      // a comparison figure ("… against INR 5,671 crores of last year", "45.6% in the last quarter") is not this quarter's
      if (/^[^.;]{0,24}\b((in|during|of|for) (the )?(last|previous|preceding|same) (quarter|year|period)|a year ago|last year|of last year)\b/i.test(after) && !/\b(grew|growth|up|increase|higher|down|declin)\w*\b/i.test(after)) continue;
      if (/\b(against|versus|vs\.?|compared (to|with)|as against)\s+(about\s+)?$/i.test(s.slice(Math.max(0, f.at - 22), f.at))) continue;
      // nearest metric before the figure; a metric after the figure only in "23% growth in revenue" form
      let m = null, gap = 1e9;
      for (const x of ms) { const d = f.at - x.end; if (d >= 0 && d <= 110 && d < gap) { gap = d; m = x; } }
      if (!m) for (const x of ms) { const d = x.at - f.end; if (d >= 0 && d <= 30 && d < gap && /^\s*(y-?o-?y\s+|q-?o-?q\s+)?(growth|increase|rise|decline|jump|expansion)?\s*(in|of)\s+(the\s+|our\s+|its\s+)?$/i.test(s.slice(f.end, x.at))) { gap = d; m = x; } }
      if (!m) continue;
      if (/\b(minus|less|excluding|net of|ex-?|before|after)\s*$/i.test(s.slice(Math.max(0, m.at - 14), m.at))) continue;   // "EBITDAaL minus capex" is not capex
      const between = s.slice(Math.min(m.end, f.at), Math.max(m.end, f.at));
      if (ms.some((x) => x !== m && x.at >= m.end && x.end <= f.at)) continue;       // another metric sits in between
      if (!it.prepared && gap > 45) continue;                                            // answers: only tightly-bound figures
      if (/^\s*(of|from|at) [A-Z][a-z]+/.test(after) && !/^\s*(of|from|at) (Rs|INR|USD|Q[1-4]|FY)/.test(after)) continue;   // "Rs 8,900 crores of Asian Paints" belongs to that entity
      if (/\b(add(ed|ition|ing)|net new|incremental)\s+(a\s+)?(record\s+)?(of\s+)?(about\s+)?$/i.test(s.slice(Math.max(0, f.at - 28), f.at))) continue;
      const ctx = s.slice(Math.max(0, m.at - 12), Math.min(s.length, f.end + 45));
      let kind;
      // bps: a level when it is the stated ratio ("GNPA at 29 bps"), otherwise a change
      if (f.kind === "bps" && m.type !== "level") continue;                                  // bps describes a ratio, not volume or revenue
      if (f.kind === "bps") kind = m.type === "level" && /\b(at|was|of|stood at|is)\s+(about\s+|around\s+)?$/i.test(s.slice(Math.max(0, f.at - 16), f.at)) && !GROWTH_WORD.test(between) && /npa|credit cost/i.test(m.label) ? "value" : "change";
      else if (f.kind === "pct") {
        if (m.type === "level") kind = /\bby\s*$/i.test(between) || /^\s*(percentage )?points?\b/i.test(after) ? "change" : "value";
        else if (SHARE_OF.test(after) && f.at < m.at) continue;                           // "5% of India revenue" is a share, not growth
        else if (GROWTH_WORD.test(between) || GROWTH_WORD.test(after)) kind = "change";
        else continue;
      } else if (f.kind === "multiple") { if (m.type !== "level") continue; kind = "value"; }
      else { if (m.type === "level" || !valueFits(m.label, f)) continue; kind = "value"; }   // a margin quoted in rupees is not a margin
      const neg = NEG_WORD.test(between) || NEG_WORD.test(after.slice(0, 18));
      // the period is named right after the figure ("3.6% year-on-year and 1.2% sequentially"); fall back to the wider context
      const perOf = (t) => (/^\W{0,3}(\bcagr\b|compound)/i.test(t) || /\bcagr\b/i.test(t.slice(0, 14)) ? "CAGR" : /^[^,;]{0,14}\b(q-?o-?q|quarter[- ]on[- ]quarter|sequential\w*|over (the )?(last|previous|preceding) quarter|over [1-4]q)\b/i.test(t) ? "QoQ" : /^[^,;]{0,18}\b(y-?o-?y|yoy|year[- ]on[- ]year|over (the )?(same (quarter|period) )?last year|over q[1-4] (of )?(last year|fy ?\d{2}))\b/i.test(t) ? "YoY" : null);
      const period = perOf(after) || (/\bcagr\b/i.test(ctx) ? "CAGR" : /y-?o-?y|yoy|year[- ]on[- ]year/i.test(between) ? "YoY" : /q-?o-?q|sequential/i.test(between) ? "QoQ" : null);
      if (period === "CAGR" && m.type !== "level") continue;                              // multi-year CAGRs are history, not this quarter
      // a presenter's section ("Sh Ishan Chatterjee … (JioStar)") scopes every figure in it to that business
      const secQ = it.section && !/group|consolidated|overall|company|financial|performance|highlights|summary/i.test(it.section) ? it.section.replace(/,.*$/, "").trim() : null;
      const qual = qualifierOf(s, m) || secQ;
      const prio = HEADLINE_SCOPE.test(s.slice(Math.max(0, m.at - 45), m.at + 10)) ? 2 : 1;
      const row = upsert(m.label + "|" + (qual || ""), { metric: m.label, qualifier: qual, value: null, change: null, period: null, valueQuote: null, changeQuote: null, vPrio: 0, cPrio: 0, speaker: it.speaker, prepared: it.prepared, at: it.idx, page: it.page, basis: null });
      // basis tag — FMCG calls mix volume, value, price and constant-currency growth constantly
      const bctx = s.slice(Math.max(0, m.at - 30), Math.min(s.length, f.end + 30));
      // margin = a margin level or its bps change; ratio = other levels (share, NPA, ROE…); per-unit profit is value, per-unit realisation is price
      const basis = /constant currency|\bcc\b/i.test(bctx) ? "cc"
        : m.type === "level" && (f.kind === "pct" || f.kind === "bps") ? (/margin/i.test(m.label) ? "margin" : "ratio")
        : /realis|realiz|arpu|price/i.test(m.label) ? "price" : /per tonne/i.test(m.label) ? "value"
        : m.label === "Volume" || /\bvolumes?\b|\buvg\b|tonnes?|tons?\b|units\b/i.test(bctx) ? "volume" : /\bpric(e|ing)|realis|realiz|arpu/i.test(bctx) ? "price" : "value";
      if (!row.basis) row.basis = basis;
      if (row.page == null) row.page = it.page;
      const fig = (kind === "change" && f.kind !== "bps" ? (neg ? "-" : "+") : kind === "change" && neg ? "-" : "") + f.raw.replace(/\s?(per ?cent|percent)/i, "%").replace(/\s+%/, "%").replace(/\s?basis points?/i, " bps");
      // first figure wins, unless a later one is explicitly company-level ("consolidated", "overall", "total")
      if (kind === "value" && (!row.value || prio > row.vPrio)) {
        row.value = f.raw.replace(/\s?(per ?cent|percent)/i, "%").replace(/\s?basis points?/i, " bps"); row.valueQuote = tidy(s, 260); row.vPrio = prio;
        // "INR 6,610 crores against INR 5,671 crores of last year" → derive the change
        const vs = s.slice(f.end, f.end + 80).match(/^[^.;]{0,12}\b(?:against|versus|vs\.?|compared (?:to|with)|as against)\s+(?:about\s+)?(?:₹|Rs\.?|INR|US\$|USD|\$)?\s?(\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s?(?:crores?|cr|million|mn|billion|bn|lakh)?[^.;]{0,24}\b(last year|same (?:quarter|period) last year|q[1-4] (?:of )?(?:last year|fy ?\d{2})|a year ago)/i);
        if (vs && f.kind === "amount" && !row.change) { const prev = parseFloat(vs[1].replace(/,/g, "")); if (prev > 0) { const g = (f.value / prev - 1) * 100; row.change = `${g >= 0 ? "+" : ""}${g.toFixed(1)}%`; row.period = "YoY"; row.changeQuote = row.valueQuote; row.computed = true; row.cPrio = prio; } }
      }
      if (kind === "change" && (!row.change || prio > row.cPrio)) { row.change = fig.replace(/^\+-/, "-"); row.period = period; row.changeQuote = tidy(s, 260); row.cPrio = prio; row.computed = false; }
    }
    // distributive: "EBITDA and PAT growth of 25%" — the figure applies to every metric in the chain
    for (let i = ms.length - 2; i >= 0; i--) {
      const a = ms[i], b = ms[i + 1];
      if (!/^\s*(and|&|,)\s*$/i.test(s.slice(a.end, b.at))) continue;
      const kb = found.get(b.label + "|"), ka = found.get(a.label + "|");
      if (kb && kb.change && kb.changeQuote === tidy(s, 260) && (!ka || !ka.change)) found.set(a.label + "|", { ...(ka || { metric: a.label, qualifier: null, value: null, valueQuote: null, speaker: it.speaker, prepared: it.prepared, at: it.idx, page: it.page, basis: kb.basis }), change: kb.change, period: kb.period, changeQuote: kb.changeQuote });
    }
  }
  const order = new Map(METRICS.map(([l], i) => [l, i]));
  let rows = [...found.values()].filter((r) => r.value || r.change).map((r) => ({ ...r, quote: r.valueQuote || r.changeQuote, source: r.prepared ? "Prepared remarks" : "Q&A" }));
  // figures from the Q&A only fill in when the prepared remarks carry few numbers (some companies leave them to the presentation)
  const prepN = rows.filter((r) => r.prepared && !r.qualifier).length;
  if (prepN >= 4) rows = rows.filter((r) => r.prepared);
  return rows.sort((a, b) => (a.qualifier ? 1 : 0) - (b.qualifier ? 1 : 0) || (b.prepared - a.prepared) || order.get(a.metric) - order.get(b.metric) || a.at - b.at).slice(0, 20);
}
const cap = (s) => String(s || "").replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bUs\b/, "US");

/* ── themes ───────────────────────────────────────────────────────────── */
const THEMES = [
  ["Demand & growth", /\b(demand|volumes?|offtake|consumption|traction|order(s| book| inflow| intake)?|bookings|pre-?sales|disbursements?|loan growth|credit growth|advances|subscribers?|customer additions?|deal (wins?|pipeline)|pipeline|market share|penetration|footfalls?|growth momentum|rural|urban|exports?)\b/gi],
  ["Pricing, margins & costs", /\b(pric(e|es|ing)|realis\w*|realiz\w*|arpu|margins?|ebitda|gross margin|costs?|inflation\w*|input|raw materials?|commodit\w*|crude|copra|coal|coking|gas prices?|freight|employee (cost|expense)s?|operating leverage|cost[- ]to[- ]income|nim|yields?|spreads?|cost of funds)\b/gi],
  ["Asset quality & credit", /\b(npa|gnpa|nnpa|slippages?|credit costs?|provisions?|provisioning|delinquenc\w*|stress\w*|write-?offs?|collection efficiency|asset quality|pcr|restructur\w*|bounce rates?)\b/gi],
  ["Capital allocation & expansion", /\b(capex|capital expenditure|capacity|expansion|acquisitions?|acquire\w*|investments?|invest\w*|dividends?|buy-?backs?|stake|greenfield|brownfield|commission\w*|new plants?|m&a|inorganic)\b/gi],
  ["Balance sheet & cash flow", /\b(net debt|debt|leverage|cash flows?|free cash|working capital|liquidity|borrowings?|net cash|deleverag\w*|capital adequacy|crar|cet ?1|solvency|receivables?|inventor(y|ies))\b/gi],
  ["Strategy, products & innovation", /\b(strateg\w*|new (business|products?|categor\w*|launch\w*)|launch\w*|portfolio|digital|premiumi\w*|d2c|quick commerce|e-?commerce|ai\b|innovation|brands?|distribution|franchise|platform|pilot|scale up|diversif\w*)\b/gi],
  ["Regulation & external environment", /\b(regulat\w*|rbi|sebi|irdai|usfda|fda|government|policy|gst|tariffs?|duty|duties|cbam|safeguard|compliance|geopolitic\w*|war|west asia|middle east|monsoon|weather|macro\w*|currency|forex|fx|rupee|dollar|elections?|interest rates?|repo rate)\b/gi],
];
function themeOf(s) {
  let best = null, n = 0;
  for (const [name, re] of THEMES) { const c = (s.match(re) || []).length; if (c > n) { n = c; best = name; } }
  return best;
}

/* ── guidance ─────────────────────────────────────────────────────────── */
const FUTURE = /\b(will|would expect|expect(s|ed|ing)?|anticipat\w*|guid(e|ed|ance|ing)|target(s|ed|ing)?|aim(s|ing)? (to|for|at)|aspir\w*|outlook|going forward|in the coming (quarters?|years?|months)|over the next|next (quarter|year|few (quarters|years))|for the (full|entire|rest of the) year|for fy ?\d{2,4}|in fy ?\d{2,4}|by (fy ?)?20\d\d|by fy ?\d{2}|medium[- ]term|long[- ]term|on track (to|for)|remain (confident|committed)|should (see|be|grow|improve|come)|plan (to|for)|pipeline of|we see .{0,30}\b(next|coming|ahead))\b/i;
const NOT_GUIDANCE = /\b(thank|guidance (of|from) (the|our) (board|chairman)|under the (guidance|leadership)|will now|will be (happy|glad) to|will take (the )?questions|will hand|will request|i will (start|begin|now|just|take|come|answer|try|leave|let)|will be (available|uploaded)|let me|will you|you will (see|notice)|as you will)\b/i;
// what a guidance line is about: the metric it names, else the business it names, else a short theme label
const THEME_SHORT = { "Demand & growth": "Growth", "Pricing, margins & costs": "Costs & pricing", "Asset quality & credit": "Asset quality", "Capital allocation & expansion": "Capex / investment", "Balance sheet & cash flow": "Balance sheet", "Strategy, products & innovation": "Strategy", "Regulation & external environment": "External factors" };
function guidanceMetric(s) {
  const m = metricMentions(s)[0];
  if (m) { const q = qualifierOf(s, m); return q ? `${m.label} — ${q}` : m.label; }
  const seg = s.match(/\b(?:the |our )?([A-Z][A-Za-z&'-]+(?: [A-Z][A-Za-z&'-]+){0,2}) (?:business|segment|portfolio|franchise|division|brand|category)\b/)
    || s.match(/\b(?:guidance|growth|target|outlook)\b[^.]{0,40}\bfor (?:the |our )?([A-Z][A-Za-z&'-]+(?: [A-Z][A-Za-z&'-]+){0,2})\b/);
  if (seg && !NOT_QUAL.has(seg[1]) && !/^(FY|Q[1-4]|H[12])/.test(seg[1])) return seg[1];
  const th = themeOf(s);
  return th ? THEME_SHORT[th] || th : null;
}
// "fy27" → "FY27", "q2 fy 27" → "Q2 FY27", "next year" → "Next year"
function fmtPeriod(p) {
  const t = String(p).replace(/\s+/g, " ").trim();
  if (/^(fy|q[1-4]|h[12])/i.test(t)) return t.toUpperCase().replace(/\s?FY\s?'?(\d{2,4})/, (m, y) => ` FY${String(y).length === 4 ? y.slice(2) : y}`).replace(/^ /, "").replace(/^FY(\d{2})\d{0,2}/, "FY$1");
  return t[0].toUpperCase() + t.slice(1).toLowerCase();
}
function guidanceItems(items) {
  const out = [];
  for (let ii = 0; ii < items.length; ii++) {
    const it = items[ii], s = it.text;
    if (!FUTURE.test(s) || NOT_GUIDANCE.test(s) || /\?\s*$/.test(s) || s.length < 50 || s.length > 520) continue;
    // speculation ("If that changes the growth rates… that will be wonderful") is not guidance; a conditional
    // commitment ("If situations normalize, we would target high-teens EBITDA growth") is — its condition is kept
    const commits = /\b(target\w*|guid\w*|expect\w*|will deliver|aim\w*|we would (target|expect|guide|deliver))\b/i.test(s) && metricMentions(s).length > 0;
    if ((/^(if|when|whether|unless|suppose|assuming)\b/i.test(tidy(s)) && !commits) || /\b(i hope|hopefully|wonderful|let's see|we'll see)\b/i.test(s)) continue;
    // a business metric, or explicit outlook language — not just a forward-leaning verb
    const explicit = /\b(guid(ance|ing|e)|outlook|we expect|we anticipate|target(ing)?|aspir\w*|on track|going forward|medium[- ]term|by (fy ?)?20\d\d|next (year|quarter|few quarters))\b/i.test(s);
    if (!metricMentions(s).length && !explicit) continue;
    if (/\b(we have seen|we saw|was|were|had been|last year we)\b/i.test(s) && !explicit) continue;
    // a reported result with a forward-leaning tail ("A&P grew 25% as we continue to invest for the long term") is not guidance
    if (/\b(grew|delivered|reported|posted|registered|stood at|came in|increased|declined|achieved|clocked|expanded|contracted|improved|already)\b/i.test(s) && !/\b(expect\w*|guid\w*|target\w*|will|would|aspir\w*|outlook|plan(s|ning)? to|intend\w*|aim(s|ing)? (to|for)|going forward|next (year|quarter))\b/i.test(s)) continue;
    const quant = figures(s).some((f) => f.kind === "pct" || f.kind === "amount" || f.kind === "bps" || f.kind === "volume") || QUAL_FIG.test(s);
    const horizon = (s.match(/\b(next (quarter|year|few quarters|two quarters|2-3 years|three years)|coming (quarters?|years?)|(q[1-4]|h[12])\s?(fy)?\s?'?\d{0,4}|fy ?'?\d{2,4}|full[- ]year|this year|medium[- ]term|long[- ]term|near[- ]term|by 20\d\d)\b/i) || [])[0] || null;
    const dir = /\b(rais\w*|upgrad\w*|increas\w* (our|the) (guidance|target)|better than (earlier|expected|guided))\b/i.test(s) ? "Raised"
      : /\b(lower\w* (our|the) (guidance|target)|cut\w*|downgrad\w*|revis\w* down|below (our|the) (earlier|guidance))\b/i.test(s) ? "Lowered"
      : /\b(reiterat\w*|maintain\w*|retain\w*|stay (on|with)|continue to (expect|guide)|on track)\b/i.test(s) ? "Reiterated" : "Stated";
    const firm = /\b(will|expect|guid\w*|target|committed|confident|on track)\b/i.test(s) && !/\b(may|might|could|hope|aspir\w*|try|potential(ly)?|possibly)\b/i.test(s) ? "Firm" : "Tentative";
    // the target in management's own words: a verbal range ("high teens") or the stated figures
    const verbal = (s.match(QUAL_FIG) || [])[0] || null;
    const fs = figures(s).filter((f) => f.kind === "pct" || f.kind === "bps" || f.kind === "amount" || f.kind === "volume");
    const range = s.match(/(\d+(?:\.\d+)?)\s?(?:%|bps|basis points?)?\s?(?:-|–|to)\s?(\d+(?:\.\d+)?)\s?(%|bps|basis points?)/i);
    const target = verbal ? verbal.replace(/-/g, " ").replace(/\s+/g, " ") : range ? `${range[1]}–${range[2]}${/bps|basis/i.test(range[3]) ? " bps" : "%"}` : fs.length ? fs.slice(0, 2).map((f) => f.raw).join(" / ") : null;
    const cond = (s.match(/\b(if|subject to|assuming|provided( that)?|unless|as long as|barring|given that|contingent on)\b[^.;]{4,110}/i) || [])[0] || null;
    const period = (s.match(/\b(fy ?'?\d{2,4}(?:-\d{2})?|q[1-4] ?fy ?'?\d{2}|h[12] ?fy ?'?\d{2}|next (?:financial )?year|this (?:financial )?year|full[- ]year|next quarter|coming quarters?|medium[- ]term|long[- ]term|by 20\d\d|over the next \w+ (?:years?|quarters?))\b/i) || [])[0] || null;
    // vs prior call — only when the transcript itself says so (the context store adds the rest)
    const vsPrior = /\b(higher|more|better) than (what we (had )?(guided|said|indicated)|(our |the )?(earlier|previous|last) (guidance|call|quarter's guidance))|\b(rais(e|ed|ing)|upgrad(e|ed|ing)|revis(e|ed|ing) (it )?upward)\b[^.]{0,40}\b(guidance|target|outlook)/i.test(s) ? "raised"
      : /\b(lower|less) than (what we (had )?(guided|said)|(our |the )?(earlier|previous) guidance)|\b(cut|lower(ed|ing)?|reduc(e|ed|ing)|revis(e|ed|ing) (it )?down(ward)?)\b[^.]{0,30}\b(guidance|target|outlook)/i.test(s) ? "cut"
      : /\b(reiterat\w*|maintain\w*|said consistently|consistently (said|guided)|no change (in|to)|stick(ing)? (to|with)|retain\w*)\b/i.test(s) ? "maintained" : null;
    const numeric = fs.length > 0 || !!range;
    // guidance quality, rubric 4.1: 5 quantified+time-bound+unconditional+raised · 4 quantified+time-bound (± condition) · 3 verbal range · 2 qualitative · 1 cut/withdrawn
    const score = vsPrior === "cut" || /\b(withdraw\w*|suspend\w*|not (giving|providing) (any )?guidance)\b/i.test(s) ? 1
      : numeric && period && !cond && vsPrior === "raised" ? 5 : numeric && period ? 4 : verbal || numeric ? 3 : 2;
    out.push({ statement: tidy(s, 320), quantified: quant, horizon: horizon ? horizon.replace(/\s+/g, " ") : null, direction: dir, conviction: firm,
      // a guide like "about 18% for FY27" often names its metric one sentence earlier (same speaker)
      ...(() => {
        const own = metricMentions(s).length > 0, prev = items[ii - 1];
        const borrow = !own && prev && prev.speaker === it.speaker && prev.idx === it.idx - 1 && metricMentions(prev.text).length && (fs.length || verbal);
        return { metric: borrow ? guidanceMetric(prev.text) : guidanceMetric(s), hasMetric: own || !!borrow };
      })(),
      target, low: range ? +range[1] : null, high: range ? +range[2] : null,
      period: period ? fmtPeriod(period) : null,
      condition: cond ? tidy(cond, 140).replace(/…$/, "") : null, vsPrior, score, committed: !/\b(want to|would like to|wish|dream)\b/i.test(s) && (commits || (/\b(expect\w*|guid\w*|target\w*|will|aim\w*|on track)\b/i.test(s) && !/^(if|when|whether|unless)\b/i.test(tidy(s)))), speaker: it.speaker, page: it.page, prepared: it.prepared, idx: it.idx });
  }
  // quantified first, prepared remarks first, then transcript order; drop near-duplicates
  const seen = new Set();
  return out.sort((a, b) => (b.quantified - a.quantified) || (b.prepared - a.prepared) || a.idx - b.idx)
    .filter((g) => { const k = g.statement.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 14);
}

/* ── tone ─────────────────────────────────────────────────────────────── */
const POS = ["strong", "stronger", "strongest", "robust", "healthy", "record", "best", "highest", "improv", "accelerat", "outperform", "momentum", "confident", "confidence", "pleased", "happy", "encourag", "resilien", "beat", "ahead of", "upside", "tailwind", "positive", "favourabl", "favorabl", "success", "optimis", "solid", "excellent", "gain", "gains", "expanded", "expansion in margin", "win", "wins", "won", "sustained", "leadership"];
const NEG = ["weak", "weaker", "weakness", "declin", "soft", "softer", "softness", "slowdown", "slower", "sluggish", "subdued", "muted", "pressure", "headwind", "challeng", "difficult", "uncertain", "volatil", "disrupt", "delay", "loss", "losses", "miss", "missed", "concern", "stress", "impair", "deteriorat", "drag", "adverse", "decelerat", "contraction", "downturn", "cautious", "caution", "shortfall", "shortage", "dampen", "hit", "hurt", "tough", "worse", "worst", "lower than expected", "below expectation"];
const NEGATORS = /\b(not|no|never|without|hardly|neither|nor|isn't|wasn't|aren't|don't|doesn't|didn't|won't|cannot|can't)\b/i;
function lexCount(text, list) {
  const toks = String(text || "").toLowerCase().split(/[^a-z']+/);
  let hits = 0, flipped = 0;
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i]; if (!w) continue;
    if (list.some((stem) => !stem.includes(" ") && w.startsWith(stem))) {
      if (NEGATORS.test(toks.slice(Math.max(0, i - 3), i).join(" "))) flipped++; else hits++;
    }
  }
  for (const phrase of list.filter((x) => x.includes(" "))) hits += (String(text).toLowerCase().split(phrase).length - 1);
  return { hits, flipped };
}
function toneOf(text) {
  const p = lexCount(text, POS), n = lexCount(text, NEG);
  const pos = p.hits + n.flipped, neg = n.hits + p.flipped;
  const w = Math.max(1, words(text));
  return { pos, neg, net: (pos - neg) / (pos + neg + 4), per1k: { pos: +(pos / w * 1000).toFixed(1), neg: +(neg / w * 1000).toFixed(1) } };
}
const HEDGE = /\b(may|might|could|possibly|perhaps|uncertain\w*|difficult to (say|predict|comment)|hard to (say|predict)|too early|remains to be seen|we('ll| will) (have to )?see|depends on|subject to|not sure|wait and watch|visibility is (low|limited)|it is early)\b/gi;
// bands set on a 21-call cross-sector sample: most calls read Constructive; the labels spread the rest
function toneLabel(score) { return score >= 80 ? "Upbeat" : score >= 68 ? "Constructive" : score >= 56 ? "Balanced" : score >= 45 ? "Cautious" : "Defensive"; }
const toneScore = (net) => Math.max(0, Math.min(100, Math.round(50 + net * 50)));

/* ── concerns (what analysts pressed on) ──────────────────────────────── */
const CONCERN = /\b(pressure|declin\w*|weak\w*|concern\w*|slowdown|slow(er)?|risk\w*|worr\w*|headwind\w*|why (is|was|has|did|are)|miss\w*|lower|drop\w*|stress\w*|competi\w*|sustainab\w*|visibility|disrupt\w*|impact of|downside|dilut\w*|loss\w*)\b/i;

/* ── main ─────────────────────────────────────────────────────────────── */
const M = require("./callModules");

function detectCallDate(text) {
  const t = unmark(String(text || "").slice(0, 6000));
  const MON = "January|February|March|April|May|June|July|August|September|October|November|December";
  const m = t.match(new RegExp(`\\b(?:held on|dated|call on|conducted on|date[d]?:?)\\s*(?:[A-Za-z]+,?\\s*)?(\\d{1,2})(?:st|nd|rd|th)?\\s*(${MON}),?\\s*(20\\d\\d)`, "i"))
    || t.match(new RegExp(`\\b(?:held on|dated|call on|conducted on)\\s*(?:[A-Za-z]+,?\\s*)?(${MON})\\s*(\\d{1,2})(?:st|nd|rd|th)?,?\\s*(20\\d\\d)`, "i"));
  if (!m) return null;
  const [d, mo, y] = /^\d/.test(m[1]) ? [m[1], m[2], m[3]] : [m[2], m[1], m[3]];
  const i = MON.split("|").findIndex((x) => x.toLowerCase() === mo.toLowerCase());
  return i < 0 ? null : `${y}-${String(i + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function analyzeCall(raw, meta = {}, peers = []) {
  const text = typeof raw === "string" ? raw : (raw && raw.transcript) || "";
  if (!text || text.length < 400) return { error: "The transcript is too short to analyse — paste the full call (prepared remarks and Q&A)." };
  const call = parseCall(text, { company: meta.company || null });
  const mgmtTurns = call.turns.filter((t) => t.role === "management" || t.role === "unknown");
  if (!mgmtTurns.length) return { error: "No management remarks were found in this text — is it an earnings-call transcript?" };
  const firstQ = call.turns.findIndex((t) => t.role === "analyst");
  const pagesSeen = new Set();

  // every management sentence, with speaker, page and whether it was prepared or an answer
  const items = []; let idx = 0;
  call.turns.forEach((t, ti) => {
    if (!(t.role === "management" || t.role === "unknown")) return;
    for (const s of sentencesPaged(t.text, t.page)) { items.push({ text: s.text, page: s.page, speaker: t.speaker || null, section: t.section || null, prepared: firstQ < 0 || ti < firstQ, idx: idx++ }); if (s.page != null) pagesSeen.add(s.page); }
  });
  const substantive = items.filter((x) => isSubstantive(x.text));
  const prepText = items.filter((x) => x.prepared).map((x) => x.text).join(" ");
  const mgmtText = items.map((x) => x.text).join(" ");

  // M4 · reported performance (facts)
  const facts = extractKpis(substantive);
  // M6 · guidance tracker — relative periods resolve to the call's fiscal year ("this year" on a Q1 FY27 call is FY27)
  const guidance = guidanceItems(substantive);
  const fyNow = (call.period || "").match(/FY(\d{2})/);
  if (fyNow) for (const g of guidance) {
    if (/^(this( financial)? year|full[- ]year)$/i.test(g.period || "")) g.period = `FY${fyNow[1]}`;
    else if (/^next( financial)? year$/i.test(g.period || "")) g.period = `FY${String(+fyNow[1] + 1).padStart(2, "0")}`;
  }
  const guidanceKeys = new Set(guidance.map((g) => g.idx));
  const recon = M.reconcile(guidance);

  // management commentary by theme (verbatim, cited; guidance lines stay in M6)
  const byTheme = {};
  for (const it of substantive) {
    if (guidanceKeys.has(it.idx)) continue;
    const th = themeOf(it.text); if (!th) continue;
    const figs = figures(it.text).length, ms = metricMentions(it.text).length;
    const score = (figs ? 3 : 0) + Math.min(2, ms) + (it.prepared ? 2 : 0) + (it.text.length >= 70 && it.text.length <= 280 ? 1 : 0) - (/\b(i think|you know|i mean|kind of|sort of)\b/i.test(it.text) ? 1 : 0);
    (byTheme[th] ||= []).push({ ...it, score });
  }
  const themes = THEMES.map(([name]) => {
    const list = (byTheme[name] || []).sort((a, b) => b.score - a.score).slice(0, 4).sort((a, b) => a.idx - b.idx);
    return list.length ? { theme: name, mentions: (byTheme[name] || []).length, points: list.map((x) => ({ text: tidy(x.text, 300), speaker: x.speaker, page: x.page, prepared: x.prepared })) } : null;
  }).filter(Boolean).sort((a, b) => b.mentions - a.mentions);

  // M9 · Q&A analytics
  const exchanges = call.qa.map((q) => {
    const qs = sentences(q.question), asks = qs.filter((s) => /\?/.test(s));
    const as = sentences(q.answer).filter((s) => isSubstantive(s));
    const pick = [...as.filter((s) => figures(s).length).slice(0, 1), ...as].filter((v, i, a) => a.indexOf(v) === i).slice(0, 2).sort((a, b) => as.indexOf(a) - as.indexOf(b));
    return {
      analyst: q.analyst, firm: q.firm, page: q.page, answerPage: q.answerPage,
      question: tidy((asks.length ? asks.slice(0, 2) : qs.slice(0, 2)).join(" "), 320),
      answer: pick.length ? tidy(pick.join(" "), 380) : (q.answer ? tidy(sentences(q.answer).slice(0, 2).join(" "), 300) : ""),
      questionFull: unmark(q.question), answerFull: unmark(q.answer), responder: q.responder, concern: CONCERN.test(q.question),
      answerWords: words(unmark(q.answer)), questionWords: words(unmark(q.question)),
      responderTitle: q.responder ? ((call.participants.management.find((p) => p.name === q.responder || String(p.name).split(" ").pop() === String(q.responder).split(" ").pop()) || {}).title || null) : null,
    };
  }).filter((q) => q.question && q.question.length > 20 && (/\?/.test(q.questionFull) || words(q.questionFull) >= 30));   // "Got it, thanks" is not a question
  const qa = M.qaAnalytics(exchanges);
  qa.exchanges.forEach((x) => { delete x.questionFull; delete x.answerFull; });

  // M10 · tone: rubric 4.3 (confidence vs hedges), plus the lexical sentiment reading
  const rubric = M.toneRubric(items);
  const tAll = toneOf(mgmtText), tPrep = toneOf(prepText), ansItems = items.filter((x) => !x.prepared), tAns = ansItems.length ? toneOf(ansItems.map((x) => x.text).join(" ")) : null;
  const concernShare = exchanges.length ? exchanges.filter((q) => q.concern).length / exchanges.length : null;
  const sentiment = { score: toneScore(tAll.net), label: toneLabel(toneScore(tAll.net)), prepared: toneScore(tPrep.net), answers: tAns ? toneScore(tAns.net) : null, positive: tAll.pos, negative: tAll.neg, analystConcern: concernShare == null ? null : Math.round(concernShare * 100) };
  const phrases = M.signaturePhrases(items.filter((x) => x.text.length < 600));
  // sentence-level tone split: positive / neutral / cautious (hedged) / negative
  const dist = { positive: 0, neutral: 0, cautious: 0, negative: 0 };
  for (const it of substantive) {
    const tt = toneOf(it.text), hedged = (it.text.match(HEDGE) || []).length > 0;
    dist[tt.neg > tt.pos ? "negative" : hedged ? "cautious" : tt.pos > tt.neg ? "positive" : "neutral"]++;
  }
  const nd = Math.max(1, substantive.length);
  const distribution = Object.fromEntries(Object.entries(dist).map(([k, v]) => [k, Math.round((v / nd) * 100)]));
  // the business vocabulary management leaned on, with the theme it mostly sat in
  const VOCAB = ["growth", "demand", "margin", "pricing", "volume", "cost", "inflation", "capex", "investment", "market share", "digital", "premium", "innovation", "launch", "distribution", "rural", "urban", "exports", "international", "acquisition", "capacity", "efficiency", "profitability", "cash flow", "debt", "dividend", "execution", "competition", "regulation", "outlook", "confident", "momentum", "volatile", "pressure", "headwind", "tailwind", "recovery", "consumption", "customers", "deals", "AI", "new energy", "credit", "deposits", "asset quality"];
  const keyPhrases = VOCAB.map((w) => {
    const re = new RegExp(`\\b${w.replace(/ /g, "\\s+")}\\w*\\b`, w === "AI" ? "g" : "gi");
    const hits = items.filter((x) => re.test(x.text)), n = items.reduce((a, x) => a + (x.text.match(re) || []).length, 0);
    if (n < 3) return null;
    const th = {}; for (const h of hits) { const t = themeOf(h.text); if (t) th[t] = (th[t] || 0) + 1; }
    return { phrase: w, count: n, context: Object.entries(th).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([t]) => t).join(", ") || null };
  }).filter(Boolean).sort((a, b) => b.count - a.count).slice(0, 10);
  // hedging phrases by frequency (management speech only)
  const hedgeCounts = {};
  for (const m of mgmtText.matchAll(HEDGE)) { const k = m[0].toLowerCase().replace(/\s+/g, " "); hedgeCounts[k] = (hedgeCounts[k] || 0) + 1; }
  const hedgeList = Object.entries(hedgeCounts).map(([phrase, count]) => ({ phrase, count })).sort((a, b) => b.count - a.count).slice(0, 8);
  const tone = {
    ...rubric, sentiment, phrases, distribution, keyPhrases, hedges: hedgeList,
    reading: [
      rubric.remarks.score != null ? `Prepared remarks score ${rubric.remarks.score}/5 (${rubric.remarks.share}% confidence markers vs hedges)${rubric.answers && rubric.answers.score != null ? `; Q&A ${rubric.answers.score}/5 (${rubric.answers.share}%)` : ""}.` : null,
      rubric.drop != null && rubric.drop >= 2 ? `A ${rubric.drop}-point drop from the prepared remarks to the Q&A — management was noticeably less assured under questioning.` : rubric.drop != null && rubric.drop <= -1 ? "Management sounded more assured in the Q&A than in the prepared remarks." : null,
      rubric.hedgeObjects ? `Hedges sit ${Math.round(rubric.hedgeObjects.macro * 100)}% on the macro and ${Math.round(rubric.hedgeObjects.company * 100)}% on the company's own execution — a ${rubric.profile} profile.` : "Very few hedging expressions.",
      `Word-level sentiment reads ${sentiment.label.toLowerCase()} (${sentiment.score}/100: ${sentiment.positive} positive vs ${sentiment.negative} negative expressions).`,
      sentiment.analystConcern != null ? `${sentiment.analystConcern}% of analyst questions probed a weakness or risk.` : null,
    ].filter(Boolean),
  };

  // M11 · red flags, evasions and the checks that came back clean
  const edited = /edited (to improve|for) (readability|clarity)|may not be (a )?verbatim|has been edited/i.test(text);
  const flags = M.redFlags({ items, guidance, qa, rawText: text });
  // M12 · monitorables and next-call questions
  const monitor = M.monitorables(guidance, flags.flags);
  const nextQ = M.nextQuestions({ flags: flags.flags, qa, guidance, recon });

  // M2 · executive snapshot (deterministic; the AI layer may add a headline and thesis impact)
  const k = (label) => facts.find((x) => x.metric === label && !x.qualifier);
  const headlineFacts = ["Revenue", "EBITDA", "EBITDA margin", "Net profit", "Net interest income", "Loan book", "APE", "VNB", "Volume", "Deal wins (TCV)"].map(k).filter(Boolean).slice(0, 4);
  const reported = headlineFacts.map((x) => `${x.metric} ${[x.value, x.change ? `${x.change}${x.period ? " " + x.period : ""}` : null].filter(Boolean).join(", ")}`).join("; ");
  const scored = (s) => ({ s, t: toneOf(s.text) });
  const posPool = (list) => list.map(scored).filter((x) => x.t.pos > x.t.neg).sort((a, b) => (b.t.pos - b.t.neg) - (a.t.pos - a.t.neg) || a.s.idx - b.s.idx);
  // numbers-backed positives from the prepared remarks first; companies that leave numbers to the presentation fall back to their statements
  const positives = [...posPool(substantive.filter((x) => x.prepared && figures(x.text).length)), ...posPool(substantive.filter((x) => !figures(x.text).length || !x.prepared))]
    .filter((v, i, a) => a.findIndex((y) => y.s.idx === v.s.idx) === i).slice(0, 3).map((x) => ({ text: tidy(x.s.text, 220), cite: [x.s.page].filter((p) => p != null) }));
  const negatives = [
    ...flags.flags.filter((f) => f.severity !== "low").slice(0, 2).map((f) => ({ text: `${f.flag}: ${f.evidence}`.slice(0, 220), cite: f.cite })),
    ...substantive.map(scored).filter((x) => x.t.neg > x.t.pos && x.t.neg >= 1).sort((a, b) => b.t.neg - a.t.neg).slice(0, 3).map((x) => ({ text: tidy(x.s.text, 220), cite: [x.s.page].filter((p) => p != null) })),
  ].slice(0, 3);
  const gScores = guidance.filter((g) => g.quantified).map((g) => g.score);
  const scores = {
    tone: rubric.blendedScore, guidanceQuality: gScores.length ? Math.round(gScores.reduce((a, b) => a + b, 0) / gScores.length) : guidance.length ? 2 : null,
    answerQuality: qa.avgScore, credibility: null, redFlagLevel: flags.level,
  };
  const g0 = guidance.find((g) => g.hasMetric && g.quantified && g.conviction === "Firm") || guidance.find((g) => g.hasMetric && g.quantified) || guidance.find((g) => g.hasMetric);
  const snapshot = {
    headline: [
      reported ? `${reported}.` : `Few figures were stated on the call — management tone read ${sentiment.label.toLowerCase()}.`,
      g0 && g0.target ? `Outlook: ${g0.metric} ${g0.target}${g0.period ? " for " + g0.period : ""}${g0.condition ? ` (${g0.condition})` : ""}.` : null,
      qa.themes.length ? `The Street focused on ${qa.themes.filter((t) => t.theme !== "Other topics").slice(0, 2).map((t) => t.theme.toLowerCase()).join(" and ")}.` : null,
    ].filter(Boolean).join(" "),
    thesisImpact: null, positives, negatives, scores,
  };

  // takeaways (kept for the quick-read panel)
  const takeaways = [];
  if (reported) takeaways.push(`Reported: ${reported}.`);
  themes.slice(0, 3).forEach((t) => { const p = t.points.find((x) => x.prepared && figures(x.text).length) || t.points.find((x) => x.prepared) || t.points[0]; if (p) takeaways.push(`${t.theme}: ${p.text}`); });
  if (g0) takeaways.push(`Outlook: ${g0.statement}`);
  if (qa.themes.length) takeaways.push(`Analysts focused on ${qa.themes.filter((t) => t.theme !== "Other topics").slice(0, 3).map((t) => `${t.theme.toLowerCase()} (${t.questions})`).join(", ")}; average answer quality ${qa.avgScore ?? "—"}/5.`);
  takeaways.push(tone.reading[0] || tone.reading[tone.reading.length - 1]);

  // competitor mentions (peer names from the data provider)
  const lower = unmark(text).toLowerCase();
  const competitors = (peers || []).map((p) => { const nm = String((p && (p.name || p.symbol)) || "").split(/[ .,]/)[0]; return nm && nm.length > 2 ? { name: p.name || p.symbol, count: (lower.match(new RegExp("\\b" + nm.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "g")) || []).length } : null; })
    .filter((c) => c && c.count).sort((a, b) => b.count - a.count);

  const wAll = words(unmark(text));
  return {
    version: "call-v3", method: "deterministic transcript analysis",
    meta: { ...meta, company: meta.company || call.company, period: call.period, callDate: detectCallDate(text), format: call.format, pages: pagesSeen.size ? Math.max(...pagesSeen) : null, editedTranscript: edited },
    stats: { words: wAll, managementWords: words(mgmtText), preparedWords: words(prepText), qaWords: words(ansItems.map((x) => x.text).join(" ")), questions: exchanges.length, analysts: call.participants.analysts.length, managementSpeakers: call.participants.management.length },
    participants: call.participants,
    snapshot, takeaways, facts, kpis: facts, themes, guidance, reconciliation: recon, qa, tone, redFlags: flags, monitorables: monitor, nextQuestions: nextQ, competitors,
    warnings: call.warnings, words: wAll, ai: null,
  };
}

/* every substantive management sentence with page / speaker / prepared-or-answer — the evidence the AI layer reads */
function managementEvidence(text, company) {
  const call = parseCall(text, { company: company || null });
  const firstQ = call.turns.findIndex((t) => t.role === "analyst");
  const items = []; let idx = 0;
  call.turns.forEach((t, ti) => {
    if (!(t.role === "management" || t.role === "unknown")) return;
    for (const s of sentencesPaged(t.text, t.page)) if (isSubstantive(s.text)) items.push({ text: s.text, page: s.page, speaker: t.speaker || null, prepared: firstQ < 0 || ti < firstQ, idx: idx++ });
  });
  return { call, items };
}

module.exports = { managementEvidence, analyzeCall, sentences, sentencesPaged, figures, extractKpis, metricMentions, toneOf, themeOf, isSubstantive, guidanceItems };
