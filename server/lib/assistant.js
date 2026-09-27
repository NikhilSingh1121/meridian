/**
 * M-Terminal Assistant — the floating help / research chat.
 *
 * Two tiers, cheapest first:
 *   1. Deterministic questions (no AI, no tokens). ~55 fixed questions answered from the
 *      platform's own computed data (the "fact pack" below) with templated text.
 *   2. "Ask anything" — a Gemini chat grounded in the same fact pack. It answers from
 *      platform data first; only when the platform has no answer does it run ONE web-search
 *      call (where the key has search quota), otherwise it answers from general knowledge
 *      and says so. Hard ceilings per chat, per visitor and per day.
 *
 * Rules the AI follows: numbers come from the fact pack (or a cited web source); no
 * personalised buy/sell advice; out-of-scope questions are declined briefly.
 */
const crypto = require("crypto");
const gemini = require("./insights/gemini");
const groq = require("./insights/groq");

/* ── which AI answers the chat ──────────────────────────────────────────────
   Groq (gpt-oss) by default when GROQ_API_KEY is set — fast and inexpensive, and its
   browser_search tool does the web research. Gemini is the fallback if a Groq call
   fails. Force one with ASSISTANT_AI=groq|gemini. */
const PROVIDER = () => {
  const want = String(process.env.ASSISTANT_AI || "").toLowerCase();
  if (want === "gemini" && gemini.hasKey()) return "gemini";
  if (want === "groq" && groq.hasKey()) return "groq";
  return groq.hasKey() ? "groq" : gemini.hasKey() ? "gemini" : null;
};

/* ── budget ceilings (override in .env) ─────────────────────────────────────
   Groq: an answer turn ≈ 3–4k tokens (fact pack + question + short answer); a
   web-research turn ≈ 8k, because the search results count as input. 30k per chat ≈
   5–8 questions. Gemini turns are similar in size; the same ceilings apply. */
const LIMITS = {
  chatTokens: Number(process.env.ASSISTANT_CHAT_TOKENS) || 30000,   // per conversation
  chatTurns: Number(process.env.ASSISTANT_CHAT_TURNS) || 8,          // AI questions per conversation
  visitorDailyTurns: Number(process.env.ASSISTANT_VISITOR_DAILY) || 30,
  dailyTurns: Number(process.env.ASSISTANT_DAILY_MAX) || 400,        // whole site
  answerTokens: 450, researchTokens: 700, messageChars: 400,
};
const chats = new Map();       // chatId → { tokens, turns, startedAt }
const visitors = new Map();    // day|ip → turns
let day = null, dayTurns = 0;

const fin = (v) => v != null && isFinite(v);
const r1 = (v) => (fin(v) ? +(+v).toFixed(1) : null);
const r2 = (v) => (fin(v) ? +(+v).toFixed(2) : null);

/* ═══════════════════════ fact pack (compact, rounded) ═══════════════════════
   Everything the ready-made answers and the AI chat may quote. Amounts are in the
   display unit (₹ Cr for INR, Mn otherwise); keys starting with "_" never go to the AI. */
function factPack({ co, dcf, val, forensic, peers, mode, pack, cons, moves }) {
  const rv = (nm) => { const r = (co.ratios || []).find((x) => x.name === nm); return r && fin(r.value) ? r1(r.value) : null; };
  const ccy = co.currency || "", sym = ccy === "INR" ? "₹" : ccy === "USD" ? "$" : "";
  const scale = ccy === "INR" ? 1e7 : 1e6, unit = ccy === "INR" ? "₹ Cr" : `${ccy} Mn`, unitWord = ccy === "INR" ? "Cr" : "Mn";
  // banks, insurers and lenders: the engine's own test (the FCFF DCF is not applicable)
  const lender = /financial/i.test(co.profile?.sector || "") && /bank|insur|credit|mortgage|lend|financ|thrift/i.test(co.profile?.industry || co.profile?.sector || "");
  const plan = dcf && dcf.plan;
  const i = !lender && plan?.applicable !== false && dcf && dcf.idcf && !dcf.idcf.error ? dcf.idcf : null;
  const med = (arr) => { const v = arr.filter(fin).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
  const pr = (peers || []).slice(1);
  const f = forensic && forensic.forensic;
  const V = val && val.valuation, mc = i && val && val.monteCarlo;
  const st = co.statements || {}, inc = st.income || [], bal = st.balance || [], cfs = st.cashflow || [];
  const li = inc.at(-1) || {};
  const sc = (v) => (fin(v) ? Math.round(v / scale) : null);
  const pct = (a, b) => (fin(a) && fin(b) && b !== 0 ? r1((a / b) * 100) : null);
  // per-year history (oldest → newest, last 4 years)
  const hist = inc.slice(-4).map((row) => {
    const b = bal.find((x) => x.year === row.year) || {}, c = cfs.find((x) => x.year === row.year) || {};
    const rev = row.revenue, cogs = fin(rev) && fin(row.grossProfit) ? rev - row.grossProfit : null;
    const ce = fin(b.assets) && fin(b.currentLiab) ? b.assets - b.currentLiab : null;
    const debt = fin(b.totalDebt) ? b.totalDebt : (b.ltDebt || 0) + (b.stDebt || 0);
    return {
      year: row.year, revenue: sc(rev), netIncome: sc(row.netIncome), ebitda: sc(row.ebitda),
      grossMargin: pct(row.grossProfit, rev), ebitdaMargin: row.ebitda > 0 ? pct(row.ebitda, rev) : null, netMargin: pct(row.netIncome, rev),
      roe: pct(row.netIncome, b.equity), roce: pct(row.ebit ?? row.opIncome, ce),
      ocf: sc(c.ocf), fcf: sc(c.fcf), capex: fin(c.capex) ? sc(Math.abs(c.capex)) : null, divPaid: fin(c.dividends) ? sc(Math.abs(c.dividends)) : null,
      ocfToNi: pct(c.ocf, row.netIncome), fcfMargin: pct(c.fcf, rev), capexPct: fin(c.capex) ? pct(Math.abs(c.capex), rev) : null,
      de: fin(b.equity) && b.equity > 0 ? r2(debt / b.equity) : null, netDebt: fin(b.cash) ? sc(debt - b.cash) : null,
      recvDays: fin(b.receivables) && rev ? Math.round((b.receivables / rev) * 365) : null,
      invDays: fin(b.inventory) && cogs ? Math.round((b.inventory / cogs) * 365) : null,
      payDays: fin(b.payables) && cogs ? Math.round((b.payables / cogs) * 365) : null,
      assetTurn: fin(b.assets) && b.assets > 0 && fin(rev) ? r2(rev / b.assets) : null,
      ppeTurn: fin(b.ppe) && b.ppe > 0 && fin(rev) ? r1(rev / b.ppe) : null,
      dRecv: sc(c.deltaReceivables), dInv: sc(c.deltaInventory), dPay: sc(c.deltaPayables), wcChange: sc(c.wcChange),
    };
  });
  const dup = (co.dupont && co.dupont.rows) || [];
  const q0 = pack && pack.quarterly && pack.quarterly.quarters && pack.quarterly.quarters[0];
  const segTotal = q0 ? (q0.segments || []).reduce((s, x) => s + (x.revenue > 0 ? x.revenue : 0), 0) : 0;
  const ab = pack && pack.annualBridge;
  const sh = pack && pack.shareholding;
  const fwdRow = (p) => cons && cons.available && (cons.forward || []).find((y) => y.period === p);
  const fwd = (p) => { const x = fwdRow(p), prev = p === "+1y" ? fwdRow("0y") : null; if (!x) return null;
    let revG = prev && prev.revenueAvg > 0 && x.revenueAvg > 0 ? (x.revenueAvg / prev.revenueAvg - 1) * 100 : p === "0y" && x.revenueAvg > 0 && li.revenue > 0 ? (x.revenueAvg / li.revenue - 1) * 100 : x.revenueGrowthPct;
    if (!fin(revG) || Math.abs(revG) > 60) revG = null;
    const epsG = prev && prev.epsAvg > 0 && x.epsAvg > 0 ? (x.epsAvg / prev.epsAvg - 1) * 100 : x.growthPct;
    return { label: p === "0y" ? "this year" : "next year", end: String(x.endDate || "").slice(0, 10), epsGrowth: r1(epsG), revGrowth: lender ? null : r1(revG), analysts: x.numAnalysts || 0, up30: x.revisions ? x.revisions.up30 : null, down30: x.revisions ? x.revisions.down30 : null }; };
  const tr = co.street && co.street.trends || [];
  const recCount = (t) => (t ? (t.strongBuy || 0) + (t.buy || 0) : null);
  const newsRows = ((pack && pack.news) || []).filter((n) => !/^\S+(\s\S+){0,3}\s(share|stock)\s(price|quote)\b/i.test(n.title || "")).slice(0, 5);
  return {
    symbol: co.symbol, name: co.name, short: String(co.name || co.symbol).replace(/[,.]?\s+(Limited|Ltd\.?|Inc\.?|Corporation|Corp\.?|Company|Co\.|PLC|N\.V\.|S\.A\.|AG|SE)$/i, "").trim(), sector: co.profile?.sector || "", industry: co.profile?.industry || "", country: co.profile?.country || "",
    exchange: co.exchange || "", currency: ccy, sym, unit, unitWord, scale, fy: li.year || null, basis: mode, bank: lender,
    about: String(co.profile?.summary || "").slice(0, 420),
    price: r2(co.price), changePct: r2(co.changePct), mcap: co.keyStats && fin(co.keyStats.mcap) ? Math.round(co.keyStats.mcap / scale) : null,
    high52: r2(co.keyStats?.high52), low52: r2(co.keyStats?.low52),
    ratios: { roe: rv("ROE"), roce: rv("ROCE"), roa: rv("ROA"), ebitdaMargin: rv("EBITDA margin"), netMargin: rv("Net margin"), currentRatio: rv("Current ratio"),
      de: rv("Debt / Equity"), interestCover: rv("Interest coverage"), pe: rv("P/E (TTM)"), fwdPe: rv("Forward P/E"), evEbitda: rv("EV / EBITDA"), pb: rv("P/B"),
      peg: rv("PEG"), divYield: rv("Dividend yield"), fcfYield: rv("FCF yield"), receivableDays: rv("Receivable days") },
    growth: { revCagr: r1(co.growth?.revCagr), niCagr: r1(co.growth?.niCagr), revYoy: r1(co.growth?.revYoy), niYoy: r1(co.growth?.niYoy), cashConversion: r1(co.growth?.cashConversion) },
    hist,
    dupont: dup.length >= 2 ? [dup[0], dup.at(-1)].map((d) => ({ year: d.year, roe: r1(d.roe), netMargin: r1(d.netMargin), turnover: r2(d.turnover), leverage: r2(d.leverage) })) : [],
    variance: (co.variance?.drivers || []).slice(0, 6).map((d) => ({ label: d.label, value: r1(d.value), unit: d.unit })),
    quarter: q0 ? { label: q0.label, scope: pack.quarterly.scope, revYoy: r1(q0.yoy && q0.yoy.revenue), ebitdaYoy: r1(q0.yoy && q0.yoy.ebitda), patYoy: r1(q0.yoy && q0.yoy.pat),
      gmBps: q0.yoy && fin(q0.yoy.grossMarginBps) ? Math.round(q0.yoy.grossMarginBps) : null, ebitdaMBps: q0.yoy && fin(q0.yoy.ebitdaMarginBps) ? Math.round(q0.yoy.ebitdaMarginBps) : null, against: q0.yoy && q0.yoy.against,
      bridge: pack.quarterly.bridge ? pack.quarterly.bridge.steps.map((s) => ({ label: s.label, value: sc(s.value), kind: s.kind })) : null } : null,
    segments: q0 && segTotal > 0 ? q0.segments.filter((s) => s.revenue > 0).slice(0, 6).map((s) => ({ name: s.name, revenue: sc(s.revenue), share: r1((s.revenue / segTotal) * 100), yoy: r1(s.revenueYoy), margin: r1(s.margin), marginBps: fin(s.marginYoyBps) ? Math.round(s.marginYoyBps) : null })) : [],
    annual: ab ? { from: ab.from, to: ab.to, ladder: ab.ladder.map((l) => ({ label: l.label, growth: r1(l.growth) })), steps: ab.steps ? ab.steps.map((s) => ({ label: s.label, value: sc(s.value), kind: s.kind })) : null, flags: ab.flags || [] } : null,
    street: co.street ? { rec: co.street.rec || null, target: r2(co.street.targetMean), high: r2(co.street.targetHigh), low: r2(co.street.targetLow), analysts: co.street.analysts || 0,
      trend: co.street.trend ? { strongBuy: co.street.trend.strongBuy, buy: co.street.trend.buy, hold: co.street.trend.hold, sell: co.street.trend.sell, strongSell: co.street.trend.strongSell } : null,
      buysNow: recCount(tr[0]), buys3mAgo: recCount(tr[3]) } : null,
    consensus: cons && cons.available ? { fy: fwd("0y"), next: fwd("+1y"), beats: cons.stats ? { quarters: cons.stats.quarters, beats: cons.stats.beats, avgSurprise: r1(cons.stats.avgSurprise) } : null } : null,
    holders: { promotersInsiders: r1(co.holders?.insiders), institutions: r1(co.holders?.institutions) },
    shareholding: sh ? { latest: sh.detail && sh.detail.trend ? sh.detail.trend.at(-1) : null, first: sh.detail && sh.detail.trend && sh.detail.trend.length > 1 ? sh.detail.trend[0] : null,
      promoterQoq: r2(sh.change && sh.change.qoq), promoterYoy: r2(sh.change && sh.change.yoy), pledgePct: sh.pledge && !sh.pledge.none ? r2(sh.pledge.pledgedPctOfPromoter) : sh.pledge && sh.pledge.none ? 0 : null,
      topHolders: sh.detail ? (sh.detail.holders || []).slice(0, 4).map((h) => ({ name: h.name, pct: r2(h.pct) })) : [] } : null,
    insiders12m: pack && pack.insiders && pack.insiders.last12m ? { buy: sc(pack.insiders.last12m.buyValue), sell: sc(pack.insiders.last12m.sellValue), count: pack.insiders.last12m.count } : null,
    dividends: ((pack && pack.calendar && pack.calendar.actions) || []).filter((a) => /dividend/i.test(a.subject)).slice(0, 6).map((a) => ({ date: a.exDate || a.recordDate, text: a.subject })),
    moves: moves || null,
    news: newsRows.map((n) => ({ date: String(n.date || "").slice(0, 10), title: String(n.title || "").slice(0, 140), publisher: n.publisher || "" })),
    _newsUrls: newsRows.map((n) => n.url || null),
    moat: co.moat ? { overall: co.moat.overall, sources: (co.moat.sources || []).map((s) => ({ name: s.name, rating: s.rating, evidence: s.evidence })) } : null,
    dcf: i ? {
      perShare: r2(i.base.perShare), upside: r1(i.upside), wacc: r2(i.assumptions.wacc), terminalG: r2(i.assumptions.terminalG), tvShare: r1(i.base.terminalShare * 100),
      horizon: i.forecastHorizon, stage2Years: i.stage2 ? i.stage2.years : 0, ronic: i.stage2 ? r1(i.stage2.ronic) : null,
      bull: r2(i.bull.perShare), bear: r2(i.bear.perShare), costEquity: r2(i.waccBuild.costEquity), beta: r2(i.waccBuild.beta), rf: r2(i.waccBuild.rf), erp: r2(i.waccBuild.erp), premium: r2(i.waccBuild.premium),
      growthY1: r1(i.base.rows[0].growth), growthLast: r1(i.base.rows.at(-1).growth), marginY1: r1(i.base.rows[0].margin), marginLast: r1(i.base.rows.at(-1).margin),
      capexPct: r1(i.assumptions.capexPctRev), taxRate: r1(i.assumptions.taxRate), warnings: (plan && plan.warnings || []).slice(0, 3),
      moat: plan?.quality?.moat || null, eqGrade: plan?.quality?.earningsQualityGrade || null,
    } : null,
    reverse: i && dcf.reverse && !dcf.reverse.error ? { impliedGrowth: r1(dcf.reverse.impliedGrowth), assumedGrowth: r1(dcf.reverse.assumedGrowth), impliedWacc: r1(dcf.reverse.impliedWacc), bounded: dcf.reverse.impliedGrowthBounded } : null,
    tornado: i && dcf.tornado && dcf.tornado.bars ? dcf.tornado.bars.map((b) => ({ key: b.key, label: b.label, step: b.step, low: r2(b.lowPx), high: r2(b.highPx) })) : [],
    valuation: V ? { blended: r2(V.blended), upside: r1(V.upside), method: V.targetMethod || null, methods: (V.methods || []).filter((m) => fin(m.value)).map((m) => ({ name: m.name, value: r2(m.value), weight: r2(m.weight) })) } : null,
    monteCarlo: mc ? { median: r2(mc.median), p5: r2(mc.p5), p95: r2(mc.p95), probAbove: r1(mc.probAbove), runs: mc.runs } : null,
    peers: { names: pr.map((p) => p.name).slice(0, 6), pe: r1(med(pr.map((p) => p.pe))), evEbitda: r1(med(pr.map((p) => p.evEbitda))), pb: r1(med(pr.map((p) => p.pb))), roe: r1(med(pr.map((p) => p.roe))), revGrowth: r1(med(pr.map((p) => p.revGrowth))) },
    forensic: f ? {
      grade: f.earningsQualityGrade, piotroski: f.piotroski ? { score: f.piotroski.score, max: f.piotroski.max, grade: f.piotroski.grade } : null,
      altman: f.altman ? { score: r2(f.altman.score), zone: f.altman.zone } : null, beneish: f.beneish ? { score: r2(f.beneish.score), flag: f.beneish.flag } : null,
      cash: f.cash ? { cashConversion: f.cash.cashConversion, accrualRatio: f.cash.accrualRatio, fcfMargin: f.cash.fcfMargin, capexToRevenue: f.cash.capexToRevenue } : null,
      flags: (forensic.flags || []).slice(0, 4).map((x) => ({ severity: x.sev, text: x.t, why: x.why })),
    } : null,
    // cost of equity even where the FCFF DCF doesn't apply — the P/B–ROE bridge for lenders uses it
    coe: dcf && dcf.idcf && !dcf.idcf.error && dcf.idcf.waccBuild ? r2(dcf.idcf.waccBuild.costEquity) : null,
    partial: !!(pack && pack.__timeout),
  };
}
/* lenders: long-run growth implied by the price, from justified P/B = (ROE − g) ÷ (COE − g) */
function impliedBankGrowth(F) {
  const pb = F.ratios.pb, roe = F.ratios.roe, coe = F.coe;
  if (!fin(pb) || !fin(roe) || !fin(coe) || Math.abs(pb - 1) < 0.1) return null;
  const g = (roe - pb * coe) / (1 - pb);
  return g > -5 && g < coe - 0.5 ? g : null;
}

/* ═══════════════════════ deterministic questions ═══════════════════════ */
const N = (v, dp = 1, loc = "en-IN") => (fin(v) ? (+v === 0 ? 0 : +v).toLocaleString(loc, { minimumFractionDigits: dp, maximumFractionDigits: dp }) : "—");
const loc = (F) => (F.currency === "INR" ? "en-IN" : "en-US");
const px = (F, v) => (fin(v) ? `${v < 0 ? "−" : ""}${F.sym}${N(Math.abs(v), 2, loc(F))}` : "—");
const pc = (v, dp = 1) => (fin(v) ? `${v >= 0 ? "+" : ""}${N(v, dp)}%` : "—");
const pp = (v, dp = 1) => (fin(v) ? `${v >= 0 ? "+" : ""}${N(v, dp)}pp` : "—");
const amt = (F, v) => (fin(v) ? `${v < 0 ? "−" : ""}${F.sym || ""}${N(Math.abs(v), 0, loc(F))} ${F.sym ? F.unitWord : F.unit}` : "—");
const cmp = (a, b, hi = "above", lo = "below") => (fin(a) && fin(b) ? (a > b ? hi : a < b ? lo : "in line with") : null);
const NO_DCF = (F) => (F.bank ? "A free-cash-flow DCF isn’t meaningful for a bank, insurer or lender — interest and deposits are its operating business. M-Terminal values it on P/E, P/B and residual income instead: ask “What is M-Terminal’s fair value?”" : "The DCF isn’t available for this company (the data is incomplete or the model could not be built).");
const need = (x, msg) => (x ? null : { text: msg || "That data isn't available for this company on the platform yet." });
const poss = (F) => (/s$/i.test(F.short) ? `${F.short}'` : `${F.short}'s`);
const fy = (y) => `FY${String(y).slice(-2)}`;
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const an = (v, dp = 1) => (/^(8|11|18)(\D|$)/.test(N(v, dp)) ? "an" : "a");
const lc = (s) => String(s).replace(/\b([A-Z])([a-z]+)/g, (m, a, b) => a.toLowerCase() + b);
/* a metric across the history: "FY23 34.3% → FY26 41.9%" */
const path = (F, k, sfx = "%", dp = 1) => { const h = F.hist.filter((x) => fin(x[k])); return h.length >= 2 ? `${fy(h[0].year)} ${N(h[0][k], dp)}${sfx} → ${fy(h.at(-1).year)} ${N(h.at(-1)[k], dp)}${sfx}` : h.length ? `${fy(h[0].year)} ${N(h[0][k], dp)}${sfx}` : null; };
const series = (F, k, fmt) => { const h = F.hist.filter((x) => fin(x[k])); return h.length ? h.map((x) => `${fy(x.year)} ${fmt(x[k])}`).join(" · ") : null; };
const moved = (F, k) => { const h = F.hist.filter((x) => fin(x[k])); return h.length >= 2 ? { from: h[0], to: h.at(-1), d: h.at(-1)[k] - h[0][k] } : null; };
const last = (F) => F.hist.at(-1) || {};
const bar = (F, key) => F.tornado.find((b) => b.key === key);
const DOWN = { growth: (s) => `revenue growth ${s}pp lower`, margin: (s) => `EBITDA margin ${s}pp lower`, wacc: (s) => `WACC ${s}pp higher`, terminalG: (s) => `terminal growth ${s}pp lower`, capex: (s) => `capex ${s}pp of revenue higher`, tax: (s) => `tax rate ${s}pp higher`, wc: (s) => `working-capital needs ${s}pp higher` };
const UP = { growth: (s) => `revenue growth ${s}pp higher`, margin: (s) => `EBITDA margin ${s}pp higher`, wacc: (s) => `WACC ${s}pp lower`, terminalG: (s) => `terminal growth ${s}pp higher`, capex: (s) => `capex ${s}pp of revenue lower`, tax: (s) => `tax rate ${s}pp lower`, wc: (s) => `working-capital needs ${s}pp lower` };
const vsBase = (F, v) => (F.dcf && fin(v) && fin(F.dcf.perShare) && F.dcf.perShare ? ` (${pc((v / F.dcf.perShare - 1) * 100)})` : "");
/* hand a question the platform can't answer from its own data to the AI chat */
const research = (label, prompt) => ({ label, prompt });

const COMPANY = [
  // ── first screen: ten questions an analyst asks when opening a company ──
  { id: "about", cat: "Business & growth", top: 1, q: (F) => `What does ${F.short} do, and how does it make money?`, tab: "research",
    a: (F) => ({ text: F.about ? F.about + (F.about.length >= 420 ? "…" : "") : `${F.name} — ${F.sector}${F.industry ? " · " + F.industry : ""}.`,
      points: [F.segments.length ? `Revenue mix (${F.quarter.label}): ${F.segments.map((s) => `${s.name} ${N(s.share, 0)}%`).join(" · ")}` : null,
        fin(last(F).revenue) ? `${fy(last(F).year)} revenue ${amt(F, last(F).revenue)}${fin(last(F).ebitdaMargin) ? `, EBITDA margin ${N(last(F).ebitdaMargin)}%` : ""}${fin(last(F).netMargin) ? `, net margin ${N(last(F).netMargin)}%` : ""}` : null,
        `Sector: ${F.sector || "—"}${F.industry ? " · " + F.industry : ""}`, `Market cap: ${fin(F.mcap) ? amt(F, F.mcap) : "—"}`],
      research: F.segments.length ? null : research("✦ Research the business model", `How does ${F.name} make money? Break revenue down by segment, product and geography.`) }) },
  { id: "revdrivers", cat: "Business & growth", top: 2, q: (F) => `What is driving ${poss(F)} revenue growth?`, tab: "research",
    a: (F) => { const s = [...F.segments].filter((x) => fin(x.yoy)).sort((a, b) => b.yoy - a.yoy), lead = s.find((x) => !/^(other|unallocat|elimin|inter-?segment)/i.test(x.name)) || s[0], c = F.consensus && F.consensus.fy;
      return { text: `Revenue grew ${pc(F.growth.revYoy)} in ${fy(F.fy)}, against ${an(F.growth.revCagr)} ${N(F.growth.revCagr)}% compound rate over the years on record.${F.quarter && fin(F.quarter.revYoy) ? ` In ${F.quarter.label} it grew ${pc(F.quarter.revYoy)} year on year.` : ""}${s.length ? ` By segment, ${lead.name} led at ${pc(lead.yoy)}.` : ""}`,
        points: [...s.map((x) => `${x.name}: ${pc(x.yoy)} YoY, ${N(x.share, 0)}% of revenue`),
          c && fin(c.revGrowth) ? `Consensus: ${pc(c.revGrowth)} revenue growth ${c.label} (${c.analysts} analysts)` : null,
          F.dcf ? `The DCF assumes ${N(F.dcf.growthY1)}% next year, fading to ${N(F.dcf.growthLast)}%` : null,
          "Filed data doesn't split growth into volume and price — use the research button below"].filter(Boolean),
        research: research("✦ Research volume vs price", `How much of ${F.name}'s recent revenue growth came from volume versus pricing, by segment?`) }; } },
  { id: "margins", cat: "Profitability & cash flow", top: 3, q: () => "How are margins and profitability trending?", tab: "research",
    a: (F) => { const e = moved(F, F.bank ? "netMargin" : "ebitdaMargin"), r = moved(F, "roe");
      return { text: [e ? `${F.bank ? "Net" : "EBITDA"} margin moved from ${N(e.from[F.bank ? "netMargin" : "ebitdaMargin"])}% in ${fy(e.from.year)} to ${N(e.to[F.bank ? "netMargin" : "ebitdaMargin"])}% in ${fy(e.to.year)} (${pp(e.d)})` : null,
        r ? `ROE went from ${N(r.from.roe)}% to ${N(r.to.roe)}%` : null].filter(Boolean).join("; ") + "." + (F.quarter && fin(F.quarter.ebitdaMBps) ? ` Latest quarter (${F.quarter.label}): EBITDA margin ${F.quarter.ebitdaMBps >= 0 ? "+" : ""}${F.quarter.ebitdaMBps} bps and gross margin ${F.quarter.gmBps >= 0 ? "+" : ""}${F.quarter.gmBps} bps year on year.` : ""),
        points: [F.bank ? null : path(F, "grossMargin") && `Gross margin: ${path(F, "grossMargin")}`, F.bank ? null : path(F, "ebitdaMargin") && `EBITDA margin: ${path(F, "ebitdaMargin")}`,
          path(F, "netMargin") && `Net margin: ${path(F, "netMargin")}`, path(F, "roe") && `ROE: ${path(F, "roe")}`, F.bank ? null : path(F, "roce") && `ROCE: ${path(F, "roce")}`].filter(Boolean) }; } },
  { id: "cashflow", cat: "Profitability & cash flow", top: 4, q: (F) => `Is ${F.short} generating strong cash flows?`, tab: "forensic",
    a: (F) => { const L = last(F); if (F.bank) return { text: "For a bank, operating cash flow mostly reflects deposit and loan movements, so it isn't a useful test of earnings quality. Look at ROA, ROE and asset quality instead.", points: [path(F, "roe") && `ROE: ${path(F, "roe")}`].filter(Boolean) };
      if (!fin(L.ocf)) return { text: "Cash-flow statements aren't available for this company." };
      const v = L.ocfToNi >= 90 ? "Profit is well backed by cash." : L.ocfToNi >= 70 ? "Most of the profit converts to cash." : "Cash is lagging reported profit — check working capital.";
      return { text: `In ${fy(L.year)} operating cash flow was ${amt(F, L.ocf)} and free cash flow ${amt(F, L.fcf)}: ${N(L.ocfToNi, 0)}% of net profit arrived as operating cash. ${v}`,
        points: [series(F, "fcf", (x) => amt(F, x)) && `Free cash flow: ${series(F, "fcf", (x) => amt(F, x))}`, series(F, "ocfToNi", (x) => N(x, 0) + "%") && `Operating cash ÷ net profit: ${series(F, "ocfToNi", (x) => N(x, 0) + "%")}`,
          fin(L.fcfMargin) ? `FCF margin ${N(L.fcfMargin)}% of revenue; capex ${N(L.capexPct)}% of revenue` : null, fin(F.ratios.fcfYield) ? `FCF yield ${N(F.ratios.fcfYield)}% at today's price` : null].filter(Boolean) }; } },
  { id: "balance", cat: "Balance sheet & forensics", top: 5, q: (F) => `How strong is ${poss(F)} balance sheet?`, tab: "research",
    a: (F) => { const R = F.ratios, de = R.de, L = last(F);
      if (F.bank) return { text: `For a bank, leverage is the business model — capital adequacy, asset quality (NPAs) and the deposit franchise matter more than debt/equity${fin(de) ? ` (reported ${N(de, 2)}×)` : ""}. These regulatory ratios aren't in the platform's data yet.`, points: [], research: research("✦ Research capital & asset quality", `What are ${F.name}'s latest capital adequacy (CET1/CRAR), gross and net NPA ratios and provision coverage?`) };
      const parts = [fin(de) ? `Debt/equity is ${N(de, 2)}×` : null, fin(L.netDebt) ? (L.netDebt < 0 ? `the company holds net cash of ${amt(F, -L.netDebt)}` : `net debt is ${amt(F, L.netDebt)}`) : null, fin(R.interestCover) ? `interest is covered ${N(R.interestCover)}× by operating profit` : null].filter(Boolean);
      return { text: `${parts.length ? cap(parts.join(", ")) + " — " : ""}${fin(de) ? (de < 0.4 ? "a conservative" : de < 1.4 ? "a moderate" : "a stretched") + " balance sheet." : "leverage data isn't reported."}`,
        points: [`Current ratio ${N(R.currentRatio, 2)}×`, F.forensic && F.forensic.altman && fin(F.forensic.altman.score) ? `Altman Z ${N(F.forensic.altman.score, 2)} (${F.forensic.altman.zone} zone)` : null, path(F, "de", "×", 2) && `Debt/equity: ${path(F, "de", "×", 2)}`].filter(Boolean) }; } },
  { id: "fvdrivers", cat: "Valuation", top: 6, q: (F) => `What is driving ${poss(F)} fair value?`, tab: "models",
    a: (F) => { const V = F.valuation, top = [...F.tornado].sort((a, b) => (b.high - b.low) - (a.high - a.low)).slice(0, 2);
      if (!V && !F.dcf) return { text: "No fair value could be built for this company." };
      return { text: `${V && fin(V.blended) ? `M-Terminal's fair value is ${px(F, V.blended)} (${pc(V.upside)} vs price), a weighted blend of ${V.methods.filter((m) => m.weight).length} methods. ` : ""}${F.dcf ? `In the DCF, ${N(F.dcf.tvShare, 0)}% of enterprise value sits in the terminal value, so the long-run growth rate (${N(F.dcf.terminalG, 2)}%) and the discount rate (${N(F.dcf.wacc, 2)}%) carry most of the weight.` : ""}${top.length ? ` The biggest single swings come from ${top.map((b) => lc(b.label)).join(" and ")}.` : ""}`,
        points: [...(V ? V.methods.filter((m) => m.weight).map((m) => `${m.name}: ${px(F, m.value)} × ${Math.round(m.weight * 100)}%`) : []), ...top.map((b) => `${b.label} ±${b.step}pp → ${px(F, b.low)} – ${px(F, b.high)} per share`)] }; } },
  { id: "implied", cat: "Valuation", top: 7, q: () => "What growth is the current share price pricing in?", tab: "models",
    a: (F) => F.bank ? (() => { const g = impliedBankGrowth(F);
      return g == null ? { text: NO_DCF(F) } : { text: `For a bank the cleaner test is price-to-book. At ${N(F.ratios.pb)}× book, with ROE of ${N(F.ratios.roe)}% and ${an(F.coe, 2)} ${N(F.coe, 2)}% cost of equity, the price implies long-run growth of about ${N(g)}% a year — from justified P/B = (ROE − g) ÷ (cost of equity − g).`,
        points: [`If ROE holds at ${N(F.ratios.roe)}%, a higher P/B needs faster growth; if ROE slips, the price needs more growth to hold`, F.consensus && F.consensus.next && fin(F.consensus.next.epsGrowth) ? `Consensus EPS growth next year: ${pc(F.consensus.next.epsGrowth)}` : null, fin(F.growth.niCagr) ? `Historical profit CAGR: ${N(F.growth.niCagr)}%` : null].filter(Boolean) }; })() : need(F.reverse && fin(F.reverse.impliedGrowth), F.dcf ? "The reverse DCF could not be solved for this company." : NO_DCF(F)) || ({
      text: `At ${px(F, F.price)} the market is pricing ${N(F.reverse.impliedGrowth)}% revenue growth next year (tapering as in the model), against ${N(F.reverse.assumedGrowth)}% in the base case — ${F.reverse.impliedGrowth > F.reverse.assumedGrowth + 1.5 ? "the market expects more than the model" : F.reverse.impliedGrowth < F.reverse.assumedGrowth - 1.5 ? "the market expects less than the model" : "roughly in line with the model"}.${F.reverse.bounded === false ? " (The answer lies outside the solver's −15% to 60% range, so treat it as a bound.)" : ""}`,
      points: [F.consensus && F.consensus.fy && fin(F.consensus.fy.revGrowth) ? `Consensus revenue growth this year: ${pc(F.consensus.fy.revGrowth)}` : null, fin(F.growth.revCagr) ? `Historical revenue CAGR: ${N(F.growth.revCagr)}%` : null,
        fin(F.reverse.impliedWacc) ? `Equivalently, the price implies a discount rate of ${N(F.reverse.impliedWacc)}% vs the model's ${N(F.dcf && F.dcf.wacc, 2)}%` : null].filter(Boolean) }) },
  { id: "peers", cat: "Valuation", top: 8, q: (F) => `How does ${poss(F)} valuation compare with peers?`, tab: "research",
    a: (F) => { const R = F.ratios, P = F.peers, prem = fin(R.pe) && fin(P.pe) ? (R.pe / P.pe - 1) * 100 : null;
      return { text: prem == null ? `Peer set: ${P.names.join(", ") || "—"}.` : `${F.short} trades at ${Math.abs(prem).toFixed(0)}% ${prem >= 0 ? "above" : "below"} the peer median on P/E. A premium is justified only where growth, returns or quality are higher — ROE is ${N(R.roe)}% against ${N(P.roe)}% for peers, and revenue growth ${N(F.growth.revYoy)}% against ${N(P.revGrowth)}%.`,
        points: [`P/E ${N(R.pe)}× vs peer median ${N(P.pe)}×`, `EV/EBITDA ${N(R.evEbitda)}× vs ${N(P.evEbitda)}×`, `P/B ${N(R.pb)}× vs ${N(P.pb)}×`, P.names.length ? `Peers: ${P.names.join(", ")}` : null].filter(Boolean) }; } },
  { id: "downside", cat: "Valuation", top: 9, q: (F) => `What could cause ${poss(F)} fair value to fall?`, tab: "models",
    a: (F) => { if (!F.dcf && F.bank && F.valuation) { const C = F.consensus && F.consensus.fy;
        return { text: `${F.short} is valued on market multiples, so its fair value of ${px(F, F.valuation.blended)} falls if earnings estimates are cut or the peer group de-rates. Each method below moves one-for-one with the earnings, book value or multiple it rests on.`,
          points: [...F.valuation.methods.filter((m) => m.weight).map((m) => `${m.name}: ${px(F, m.value)} × ${Math.round(m.weight * 100)}%`), C && fin(C.down30) ? `30-day EPS revisions this year: ${C.up30} up / ${C.down30} down` : null,
            "Lower ROE also justifies a lower price-to-book — watch asset quality and margins"].filter(Boolean) }; }
      if (!F.dcf) return { text: NO_DCF(F) };
      const b = [...F.tornado].filter((x) => fin(x.low) && DOWN[x.key]).sort((a, c) => a.low - c.low).slice(0, 3);
      return { text: `The DCF value of ${px(F, F.dcf.perShare)} is most exposed to ${b.map((x) => DOWN[x.key](x.step)).join(", ")}. The bear case — slower growth and thinner margins together — gives ${px(F, F.dcf.bear)}.`,
        points: [...b.map((x) => `${cap(DOWN[x.key](x.step))} → ${px(F, x.low)}${vsBase(F, x.low)}`),
          F.dcf.tvShare > 70 ? `${N(F.dcf.tvShare, 0)}% of the value is terminal value — a lower long-run outlook moves it a lot` : null,
          F.reverse && fin(F.reverse.impliedGrowth) && F.reverse.impliedGrowth > F.reverse.assumedGrowth + 1.5 ? `The price already assumes ${N(F.reverse.impliedGrowth)}% growth vs the model's ${N(F.reverse.assumedGrowth)}% — a miss against market expectations would weigh on the share price` : null,
          ...F.dcf.warnings.map((w) => (typeof w === "string" ? w : w.text || w.msg || "")).filter(Boolean)].filter(Boolean) }; } },
  { id: "flags", cat: "Balance sheet & forensics", top: 10, q: () => "Are there any accounting or forensic red flags?", tab: "forensic",
    a: (F) => need(F.forensic, "Forensic screens need at least two years of statements.") || (() => { const x = F.forensic, real = x.flags.filter((y) => y.severity !== "low");
      return { text: `Earnings quality grade ${x.grade || "—"}. ${real.length ? `${real.length} flag${real.length > 1 ? "s" : ""} raised:` : "No material red flags across the Beneish, Altman, cash-conversion, accrual and Piotroski screens."}`,
        points: real.length ? real.map((y) => `${y.severity === "high" ? "High" : "Medium"}: ${y.text}`) : [x.piotroski ? `Piotroski F-score ${x.piotroski.score}/${x.piotroski.max} (${x.piotroski.grade})` : null, x.beneish ? `Beneish M-score ${N(x.beneish.score, 2)} — ${x.beneish.flag}` : null, x.cash ? `Operating cash ÷ net income ${N(x.cash.cashConversion, 2)}×` : null].filter(Boolean) }; })() },

  // ── valuation ──
  { id: "target", cat: "Valuation", q: () => "What is M-Terminal's fair value?", tab: "research",
    a: (F) => need(F.valuation && fin(F.valuation.blended), "No blended fair value could be built for this company.") || ({
      text: `The fair value is ${px(F, F.valuation.blended)}, ${pc(F.valuation.upside)} against the current ${px(F, F.price)}. Method: ${F.valuation.method || "weighted blend of the valuation methods"}.`,
      points: F.valuation.methods.map((m) => `${m.name}: ${px(F, m.value)}${m.weight ? ` (weight ${Math.round(m.weight * 100)}%)` : " (cross-check)"}`) }) },
  { id: "dcf", cat: "Valuation", q: () => "What does the DCF model say?", tab: "models",
    a: (F) => need(F.dcf, NO_DCF(F)) || ({
      text: `The DCF gives ${px(F, F.dcf.perShare)} per share (${pc(F.dcf.upside)} vs price), on a ${F.dcf.horizon}-year forecast discounted at ${N(F.dcf.wacc, 2)}% with ${N(F.dcf.terminalG, 2)}% terminal growth. The terminal value is ${N(F.dcf.tvShare)}% of enterprise value.`,
      points: [`Revenue growth ${N(F.dcf.growthY1)}% in year 1 → ${N(F.dcf.growthLast)}% by year ${F.dcf.horizon}`, `EBITDA margin ${N(F.dcf.marginY1)}% → ${N(F.dcf.marginLast)}%`, `Bull / bear: ${px(F, F.dcf.bull)} / ${px(F, F.dcf.bear)}`,
        F.basis === "lab" ? "The DCF is switched on for research (40% of the blended target)." : "Research uses market-based methods; switch on “Use this DCF in research” in the Modeling Lab to include it."] }) },
  { id: "assumptions", cat: "Valuation", q: () => "What assumptions drive the DCF valuation?", tab: "models",
    a: (F) => need(F.dcf, NO_DCF(F)) || ({ text: `A ${F.dcf.horizon}-year free-cash-flow forecast${F.dcf.stage2Years ? `, a ${F.dcf.stage2Years}-year fade stage` : ""} and a terminal value, discounted at ${N(F.dcf.wacc, 2)}%. The assumptions come from the Assumption Plan in the Modeling Lab, each with its evidence.`,
      points: [`Revenue growth: ${N(F.dcf.growthY1)}% → ${N(F.dcf.growthLast)}% (history ${N(F.growth.revCagr)}% CAGR)`, `EBITDA margin: ${N(F.dcf.marginY1)}% → ${N(F.dcf.marginLast)}%`, `Capex: ${N(F.dcf.capexPct)}% of revenue`, fin(F.dcf.taxRate) ? `Tax rate: ${N(F.dcf.taxRate)}%` : null,
        `WACC ${N(F.dcf.wacc, 2)}% · terminal growth ${N(F.dcf.terminalG, 2)}%`, F.dcf.ronic ? `Return on new capital in the fade stage: ${N(F.dcf.ronic)}%` : null].filter(Boolean) }) },
  { id: "wacc", cat: "Valuation", q: () => "How is WACC calculated?", tab: "models",
    a: (F) => need(F.dcf, NO_DCF(F)) || ({ text: `WACC is ${N(F.dcf.wacc, 2)}%. Cost of equity ${N(F.dcf.costEquity, 2)}% = risk-free ${N(F.dcf.rf, 2)}% + β ${N(F.dcf.beta, 2)} × equity risk premium ${N(F.dcf.erp, 2)}%${F.dcf.premium ? ` + ${N(F.dcf.premium, 2)}pp company-specific premium` : ""}, weighted with the after-tax cost of debt at market-value weights.`, points: ["β is a 3-year weekly regression against the local index, Blume-adjusted and blended with peers.", "The risk-free rate is the local 10-year government bond yield."] }) },
  { id: "terminal", cat: "Valuation", q: () => "What terminal growth rate does the model use?", tab: "models",
    a: (F) => need(F.dcf, NO_DCF(F)) || ({ text: `${N(F.dcf.terminalG, 2)}% perpetual growth — below long-run nominal GDP and the risk-free rate.${F.dcf.stage2Years ? ` Before it, growth fades over ${F.dcf.stage2Years} years (the ${lc(F.dcf.moat || "")} moat's competitive-advantage period), with growth funded by reinvestment at a ${N(F.dcf.ronic)}% return on new capital.` : ""}`, points: [F.dcf.tvShare ? `Terminal value is ${N(F.dcf.tvShare)}% of enterprise value` : null].filter(Boolean) }) },
  { id: "waccup", cat: "Valuation", q: () => "What happens to fair value if WACC increases?", tab: "models",
    a: (F) => { const b = bar(F, "wacc"); return need(b && F.dcf, F.dcf ? "The sensitivity isn't available for this company." : NO_DCF(F)) || ({ text: `A ${b.step}pp higher WACC (${N(F.dcf.wacc + b.step, 2)}%) cuts the DCF value to ${px(F, b.low)}${vsBase(F, b.low)}; ${b.step}pp lower lifts it to ${px(F, b.high)}${vsBase(F, b.high)}. The effect is large because ${N(F.dcf.tvShare, 0)}% of the value lies beyond the forecast.`, points: ["The full WACC × terminal-growth grid is in Modeling Lab ▸ Sensitivity."] }); } },
  { id: "tgdown", cat: "Valuation", q: () => "What happens if terminal growth decreases?", tab: "models",
    a: (F) => { const b = bar(F, "terminalG"); return need(b && F.dcf, F.dcf ? "The sensitivity isn't available for this company." : NO_DCF(F)) || ({ text: `Cutting terminal growth by ${b.step}pp to ${N(F.dcf.terminalG - b.step, 2)}% gives ${px(F, b.low)}${vsBase(F, b.low)}; raising it by ${b.step}pp gives ${px(F, b.high)}${vsBase(F, b.high)}.`, points: [`Terminal value is ${N(F.dcf.tvShare)}% of enterprise value`] }); } },
  { id: "sensitive", cat: "Valuation", q: () => "Which DCF assumptions have the biggest impact on valuation?", tab: "models",
    a: (F) => { const b = [...F.tornado].filter((x) => fin(x.low) && fin(x.high)).sort((a, c) => (c.high - c.low) - (a.high - a.low));
      return need(b.length, F.dcf ? "The tornado analysis isn't available for this company." : NO_DCF(F)) || ({ text: `Ranked by how far each moves the value per share: ${b.slice(0, 3).map((x) => lc(x.label)).join(", ")} matter most.`, points: b.map((x) => `${x.label} ±${x.step}pp → ${px(F, x.low)} – ${px(F, x.high)} (range ${px(F, x.high - x.low)})`) }); } },
  { id: "montecarlo", cat: "Valuation", q: () => "What does the Monte Carlo simulation show?", tab: "models",
    a: (F) => need(F.monteCarlo, F.dcf ? "The simulation needs a valid DCF." : NO_DCF(F)) || ({ text: `Across ${N(F.monteCarlo.runs, 0)} runs that vary growth, margin, WACC and terminal growth together, the median value is ${px(F, F.monteCarlo.median)}; 90% of outcomes fall between ${px(F, F.monteCarlo.p5)} and ${px(F, F.monteCarlo.p95)}.`,
      points: [`Probability the value exceeds today's price: ${N(F.monteCarlo.probAbove, 0)}%`] }) },
  { id: "scenarios", cat: "Valuation", q: () => "What are the bull and bear valuation cases?", tab: "models",
    a: (F) => need(F.dcf, NO_DCF(F)) || ({ text: `Bull ${px(F, F.dcf.bull)}, base ${px(F, F.dcf.perShare)}, bear ${px(F, F.dcf.bear)} per share. The bull case adds 4pp growth and 2pp margin by the final year; the bear case cuts growth by up to 5pp and margin by 2pp.`,
      points: [fin(F.dcf.bull) && fin(F.dcf.bear) && fin(F.dcf.perShare) ? `Probability-weighted (25/50/25): ${px(F, 0.25 * F.dcf.bull + 0.5 * F.dcf.perShare + 0.25 * F.dcf.bear)}` : null].filter(Boolean) }) },
  { id: "goright", cat: "Valuation", q: (F) => `What would have to go right for ${F.short} to justify its current valuation?`, tab: "models",
    a: (F) => { const R = F.reverse; if (!F.dcf || !R || !fin(R.impliedGrowth)) return { text: F.dcf ? "The reverse DCF could not be solved for this company." : NO_DCF(F) };
      const above = F.price > F.dcf.perShare, up = F.tornado.filter((x) => fin(x.high) && UP[x.key] && ["growth", "margin", "wacc"].includes(x.key));
      return { text: above ? `At ${px(F, F.price)} the stock is above the DCF value of ${px(F, F.dcf.perShare)}. To justify the price, revenue would need to grow about ${N(R.impliedGrowth)}% next year (tapering as in the model) — against ${N(R.assumedGrowth)}% in the base case and ${N(F.growth.revCagr)}% historically — or investors would have to accept ${an(R.impliedWacc)} ${N(R.impliedWacc)}% discount rate.`
        : `At ${px(F, F.price)} the stock is below the DCF value of ${px(F, F.dcf.perShare)}: the price implies only ${N(R.impliedGrowth)}% growth against the model's ${N(R.assumedGrowth)}%, so the base case doesn't need anything extra to go right.`,
        points: [...up.map((x) => `${cap(UP[x.key](x.step))} → ${px(F, x.high)}${vsBase(F, x.high)}`), F.consensus && F.consensus.fy && fin(F.consensus.fy.revGrowth) ? `Consensus revenue growth this year: ${pc(F.consensus.fy.revGrowth)}` : null, fin(F.dcf.bull) ? `Bull case: ${px(F, F.dcf.bull)}` : null].filter(Boolean) }; } },

  // ── business & growth ──
  { id: "growthdrivers", cat: "Business & growth", ai: true, q: (F) => `What are ${poss(F)} main growth drivers?` },
  { id: "segments", cat: "Business & growth", q: () => "Which segments are growing fastest?", tab: "research",
    a: (F) => { const s = [...F.segments].filter((x) => fin(x.yoy)).sort((a, b) => b.yoy - a.yoy), lead = s.find((x) => !/^(other|unallocat|elimin|inter-?segment)/i.test(x.name)) || s[0];
      if (!s.length) return { text: "Segment results aren't in the filed data the platform reads for this company.", research: research("✦ Research segment growth", `Which of ${F.name}'s business segments are growing fastest? Give recent growth rates by segment.`) };
      return { text: `In ${F.quarter.label} (${F.quarter.scope.toLowerCase()}, as filed), ${lead.name} grew fastest at ${pc(lead.yoy)} year on year.`, points: s.map((x) => `${x.name}: revenue ${pc(x.yoy)}, ${N(x.share, 0)}% of the total${fin(x.margin) ? `, segment margin ${N(x.margin)}%${fin(x.marginBps) ? ` (${x.marginBps >= 0 ? "+" : ""}${x.marginBps} bps)` : ""}` : ""}`) }; } },
  { id: "volprice", cat: "Business & growth", ai: true, q: () => "How have volumes and pricing contributed to growth?" },
  { id: "latest", cat: "Business & growth", q: (F) => `What changed in ${fy(F.fy)}?`, tab: "research",
    a: (F) => { const A = F.annual;
      return { text: A ? `${A.from} → ${A.to}, line by line:` : "The drivers of the latest year against the one before:",
        points: [...(A ? A.ladder.filter((l) => fin(l.growth)).map((l) => `${l.label}: ${pc(l.growth)}`) : []), ...F.variance.filter((d) => d.unit !== "%").map((d) => `${d.label}: ${+N(d.value) > 0 ? "+" : ""}${N(d.value)} ${d.unit}`), ...(A && !F.bank ? A.flags : [])] }; } },
  { id: "sustain", cat: "Business & growth", q: () => "How sustainable is the current growth rate?", tab: "models",
    a: (F) => { const L = last(F), payout = fin(L.divPaid) && L.netIncome > 0 ? Math.min(100, (L.divPaid / L.netIncome) * 100) : null, roe = F.ratios.roe;
      const sg = fin(roe) && fin(payout) && roe <= 60 ? roe * (1 - payout / 100) : null;
      return { text: `Revenue grew ${pc(F.growth.revYoy)} last year against ${an(F.growth.revCagr)} ${N(F.growth.revCagr)}% compound rate.${fin(sg) ? ` With ROE of ${N(roe)}% and ${N(payout, 0)}% of profit paid out, the business can fund about ${N(sg)}% growth a year from retained earnings (ROE × retention) without new capital.` : fin(roe) && roe > 60 ? ` ROE of ${N(roe)}% is inflated by a small equity base (buybacks), so ROE × retention would overstate how fast it can grow.` : ""}`,
        points: [F.consensus && F.consensus.next && fin(F.consensus.next.revGrowth) ? `Consensus revenue growth next year: ${pc(F.consensus.next.revGrowth)}` : null, F.dcf ? `The DCF fades growth from ${N(F.dcf.growthY1)}% to ${N(F.dcf.growthLast)}%, then ${N(F.dcf.terminalG, 2)}% forever` : null,
          fin(F.peers.revGrowth) ? `Peer median revenue growth: ${N(F.peers.revGrowth)}%` : null, F.moat ? `Moat: ${F.moat.overall} — the wider the moat, the longer above-average growth can last` : null].filter(Boolean) }; } },
  { id: "advantages", cat: "Business & growth", ai: true, q: (F) => `What are ${poss(F)} key competitive advantages?` },
  { id: "moat", cat: "Business & growth", q: (F) => `Does ${F.short} have an economic moat?`, tab: "research",
    a: (F) => need(F.moat) || ({ text: `M-Terminal rates the moat ${F.moat.overall}, from four measurable sources. Wide = at least 3 of 4 sources wide; narrow = at least one wide or three narrow.`, points: F.moat.sources.map((s) => `${s.name}: ${s.rating || "n/a"} (${s.evidence})`) }) },

  // ── profitability & cash flow ──
  { id: "profit", cat: "Profitability & cash flow", q: (F) => `How profitable is ${F.short}?`, tab: "research",
    a: (F) => { const R = F.ratios, bank = F.bank; const m = [!bank && fin(R.ebitdaMargin) && R.ebitdaMargin > 0 ? `EBITDA margin ${N(R.ebitdaMargin)}%` : null, fin(R.netMargin) ? `net margin ${N(R.netMargin)}%` : null].filter(Boolean).join(" and ");
      const ret = [fin(R.roe) ? `ROE ${N(R.roe)}%` : null, fin(R.roce) && !bank ? `ROCE ${N(R.roce)}%` : null].filter(Boolean).join(", ");
      return { text: `${m ? `On trailing-twelve-month figures, ${m}. ` : ""}${ret ? `Returns: ${ret}${fin(F.peers.roe) ? ` — the peers' median ROE is ${N(F.peers.roe)}%` : ""}.` : ""}${bank ? " For a bank, ROE and ROA are the measures that matter; EBITDA isn't meaningful." : ""}`.trim(),
        points: [`ROA ${N(R.roa)}%`, fin(F.ratios.fcfYield) ? `FCF yield ${N(R.fcfYield)}%` : null].filter(Boolean) }; } },
  { id: "roe", cat: "Profitability & cash flow", q: () => "How has ROE changed?", tab: "research",
    a: (F) => { const d = F.dupont; if (d.length < 2) return { text: path(F, "roe") ? `ROE: ${path(F, "roe")}.` : "ROE history isn't available." };
      const [a, b] = d, drv = [["net margin", b.netMargin / a.netMargin], ["asset turnover", b.turnover / a.turnover], ["financial leverage", b.leverage / a.leverage]].filter((x) => fin(x[1])).sort((x, y) => Math.abs(Math.log(y[1])) - Math.abs(Math.log(x[1])))[0];
      return { text: `ROE moved from ${N(a.roe)}% in ${fy(a.year)} to ${N(b.roe)}% in ${fy(b.year)}. Splitting it DuPont-style (margin × turnover × leverage), the biggest change came from ${drv ? drv[0] : "—"}.`,
        points: [`Net margin ${N(a.netMargin)}% → ${N(b.netMargin)}%`, `Asset turnover ${N(a.turnover, 2)}× → ${N(b.turnover, 2)}×`, `Leverage (assets ÷ equity) ${N(a.leverage, 2)}× → ${N(b.leverage, 2)}×`] }; } },
  { id: "roce", cat: "Profitability & cash flow", q: () => "How has ROCE changed?", tab: "research",
    a: (F) => { const r = moved(F, "roce"); return need(r && !F.bank, F.bank ? "ROCE isn't meaningful for a bank — see ROE and ROA." : "ROCE history isn't available.") || ({ text: `ROCE (operating profit on capital employed) went from ${N(r.from.roce)}% in ${fy(r.from.year)} to ${N(r.to.roce)}% in ${fy(r.to.year)} (${pp(r.d)}).${fin(F.dcf && F.dcf.wacc) ? ` Against ${an(F.dcf.wacc, 2)} ${N(F.dcf.wacc, 2)}% cost of capital, each rupee invested ${r.to.roce > F.dcf.wacc ? "creates" : "does not create"} value.` : ""}`.replace("each rupee", F.currency === "INR" ? "each rupee" : "each unit of capital"),
      points: [series(F, "roce", (x) => N(x) + "%"), path(F, "ebitdaMargin") && `EBITDA margin: ${path(F, "ebitdaMargin")}`, path(F, "assetTurn", "×", 2) && `Asset turnover: ${path(F, "assetTurn", "×", 2)}`].filter(Boolean) }); } },
  { id: "conversion", cat: "Profitability & cash flow", q: () => "Are profits converting into cash?", tab: "forensic",
    a: (F) => { if (F.bank) return { text: "For a bank, operating and free cash flow mostly reflect deposit and loan movements, so they aren’t a test of earnings quality. Look at ROE, ROA and asset quality instead." }; const s = series(F, "ocfToNi", (x) => N(x, 0) + "%"); if (!s) return { text: "Cash-flow data isn't available for this company." };
      const c = F.forensic && F.forensic.cash;
      return { text: `Operating cash as a share of net profit: ${s}. Above ~90% means reported profit is backed by cash${c && fin(c.accrualRatio) ? `; accruals are ${N(c.accrualRatio)}% of assets (small is better)` : ""}.`, points: [series(F, "fcf", (x) => amt(F, x)) && `Free cash flow: ${series(F, "fcf", (x) => amt(F, x))}`].filter(Boolean) }; } },
  { id: "fcf", cat: "Profitability & cash flow", q: () => "How strong is free cash flow?", tab: "research",
    a: (F) => { const L = last(F); if (F.bank) return { text: "For a bank, operating and free cash flow mostly reflect deposit and loan movements, so they aren’t a test of earnings quality. Look at ROE, ROA and asset quality instead." }; if (!fin(L.fcf)) return { text: "Free-cash-flow data isn't available for this company." };
      return { text: `${fy(L.year)} free cash flow was ${amt(F, L.fcf)} — ${N(L.fcfMargin)}% of revenue after ${amt(F, L.capex)} of capex.${fin(L.divPaid) && L.fcf > 0 ? ` Dividends of ${amt(F, L.divPaid)} took ${N((L.divPaid / L.fcf) * 100, 0)}% of it.` : ""}`,
        points: [series(F, "fcf", (x) => amt(F, x)) && `Trend: ${series(F, "fcf", (x) => amt(F, x))}`, path(F, "capexPct") && `Capex % of revenue: ${path(F, "capexPct")}`, fin(F.ratios.fcfYield) ? `FCF yield at today's price: ${N(F.ratios.fcfYield)}%` : null].filter(Boolean) }; } },
  { id: "ebitdachg", cat: "Profitability & cash flow", q: () => "What is driving the change in EBITDA margin?", tab: "research",
    a: (F) => { const A = F.annual, Q = F.quarter; if (F.bank) return { text: "EBITDA isn't meaningful for a bank — see net interest margin and ROA." };
      const steps = (s) => s.filter((x) => x.kind === "delta").map((x) => `${x.label}: ${x.value >= 0 ? "+" : "−"}${amt(F, Math.abs(x.value))}`);
      return { text: `${path(F, "ebitdaMargin") ? `EBITDA margin: ${path(F, "ebitdaMargin")}.` : ""}${A && A.steps ? ` ${A.from} → ${A.to} EBITDA bridge — what added to and took away from EBITDA:` : ""}`.trim() || "The EBITDA bridge isn't available for this company.",
        points: [...(A && A.steps ? steps(A.steps) : []), ...(Q && Q.bridge ? [`Latest quarter (${Q.label} vs ${Q.against}): ${steps(Q.bridge).join("; ")}`] : [])] }; } },
  { id: "wc", cat: "Profitability & cash flow", q: () => "What is driving the change in working capital?", tab: "forensic",
    a: (F) => { if (F.bank) return { text: "Working capital isn’t a meaningful concept for a bank — its balance sheet is loans and deposits." }; const L = last(F), k = [["receivables", "dRecv"], ["inventory", "dInv"], ["payables", "dPay"]];
      return { text: `Working-capital days (receivables + inventory − payables): ${series(F, "recvDays", () => "") ? F.hist.filter((x) => fin(x.recvDays)).map((x) => `${fy(x.year)} ${N((x.recvDays || 0) + (x.invDays || 0) - (x.payDays || 0), 0)}d`).join(" · ") : "—"}.${fin(L.wcChange) ? ` In ${fy(L.year)} working capital ${L.wcChange < 0 ? "absorbed" : "released"} ${amt(F, Math.abs(L.wcChange))} of cash.` : ""}`,
        points: [path(F, "recvDays", " days", 0) && `Receivable days: ${path(F, "recvDays", " days", 0)}`, path(F, "invDays", " days", 0) && `Inventory days: ${path(F, "invDays", " days", 0)}`, path(F, "payDays", " days", 0) && `Payable days: ${path(F, "payDays", " days", 0)}`,
          ...k.filter(([, f]) => fin(L[f]) && L[f] !== 0).map(([n, f]) => `Cash effect of ${n} in ${fy(L.year)}: ${L[f] < 0 ? "−" : "+"}${amt(F, Math.abs(L[f]))}`)].filter(Boolean) }; } },
  { id: "capeff", cat: "Profitability & cash flow", q: () => "How has capital efficiency changed?", tab: "research",
    a: (F) => (F.bank ? { text: `For a bank, capital efficiency is return on equity and on assets.${path(F, "roe") ? ` ROE: ${path(F, "roe")}.` : ""}`, points: [fin(F.ratios.roa) ? `ROA ${N(F.ratios.roa)}% (trailing twelve months)` : null].filter(Boolean) } : { text: `Capital efficiency is how much revenue and profit each unit of capital produces.${moved(F, "roce") && !F.bank ? ` ROCE ${moved(F, "roce").d >= 0 ? "rose" : "fell"} ${pp(Math.abs(moved(F, "roce").d)).replace("+", "")} over the period.` : ""}`,
      points: [!F.bank && path(F, "roce") && `ROCE: ${path(F, "roce")}`, path(F, "assetTurn", "×", 2) && `Revenue ÷ total assets: ${path(F, "assetTurn", "×", 2)}`, path(F, "ppeTurn", "×") && `Revenue ÷ fixed assets: ${path(F, "ppeTurn", "×")}`, path(F, "capexPct") && `Capex % of revenue: ${path(F, "capexPct")}`].filter(Boolean) }) },

  // ── balance sheet & forensics ──
  { id: "leverage", cat: "Balance sheet & forensics", q: () => "How has leverage changed?", tab: "research",
    a: (F) => { const d = moved(F, "de"); return { text: d ? `Debt/equity went from ${N(d.from.de, 2)}× in ${fy(d.from.year)} to ${N(d.to.de, 2)}× in ${fy(d.to.year)}.${fin(last(F).netDebt) ? ` ${last(F).netDebt < 0 ? `The company has net cash of ${amt(F, -last(F).netDebt)}.` : `Net debt is ${amt(F, last(F).netDebt)}.`}` : ""}` : "Leverage history isn't available.",
      points: [series(F, "netDebt", (x) => (x < 0 ? `net cash ${amt(F, -x)}` : amt(F, x))) && `Net debt: ${series(F, "netDebt", (x) => (x < 0 ? `net cash ${amt(F, -x)}` : amt(F, x)))}`, fin(F.ratios.interestCover) ? `Interest cover ${N(F.ratios.interestCover)}×` : null, F.bank ? "For a bank, debt/equity reflects deposits and borrowings — capital adequacy is the relevant measure" : null].filter(Boolean) }; } },
  { id: "forensic", cat: "Balance sheet & forensics", q: () => "What does the forensic analysis indicate?", tab: "forensic",
    a: (F) => need(F.forensic, "Forensic screens need at least two years of statements.") || (() => { const x = F.forensic;
      return { text: `Earnings quality grade ${x.grade || "—"}, from four independent screens:`,
        points: [x.piotroski ? `Piotroski F-score ${x.piotroski.score}/${x.piotroski.max} (${x.piotroski.grade}) — 9 tests of profitability, leverage and efficiency; 7+ strong, 3 or less weak` : null,
          x.altman && fin(x.altman.score) ? `Altman Z ${N(x.altman.score, 2)} — ${x.altman.zone} zone (above 2.99 safe, below 1.81 distress; built for manufacturers)` : null,
          x.beneish ? `Beneish M-score ${N(x.beneish.score, 2)} — ${x.beneish.flag} (above −1.78 resembles companies that later restated)` : null,
          x.cash ? `Operating cash ÷ net income ${N(x.cash.cashConversion, 2)}×, accruals ${N(x.cash.accrualRatio)}% of assets — profit backed by cash when ≥ 0.9× and accruals are small` : null].filter(Boolean) }; })() },
  { id: "wcmove", cat: "Balance sheet & forensics", q: () => "Are there unusual working-capital movements?", tab: "forensic",
    a: (F) => { if (F.bank) return { text: "Working capital isn’t a meaningful concept for a bank — its balance sheet is loans and deposits." }; const h = F.hist, a = h.at(-2), b = h.at(-1); if (!a || !b) return { text: "At least two years of balance sheets are needed." };
      const chk = [["Receivable days", "recvDays", "customers are taking longer to pay — or sales are being booked ahead of collection"], ["Inventory days", "invDays", "stock is building faster than sales"], ["Payable days", "payDays", "the company is stretching suppliers, which flatters operating cash"]];
      const odd = chk.filter(([, k]) => fin(a[k]) && fin(b[k]) && a[k] > 0 && Math.abs(b[k] / a[k] - 1) > 0.2 && Math.abs(b[k] - a[k]) >= 5);
      return { text: odd.length ? `${odd.length} movement${odd.length > 1 ? "s" : ""} of more than 20% in ${fy(b.year)}:` : `No working-capital line moved more than 20% in ${fy(b.year)} — nothing unusual on these measures.`,
        points: [...odd.map(([n, k, why]) => `${n} ${a[k]} → ${b[k]}${k === "payDays" ? (b[k] > a[k] ? ` — ${why}` : " — paying suppliers faster") : b[k] > a[k] ? ` — ${why}` : " — improving"}`), ...chk.filter((c) => !odd.includes(c) && fin(b[c[1]])).map(([n, k]) => `${n}: ${fin(a[k]) ? a[k] + " → " : ""}${b[k]}`)] }; } },
  { id: "rpt", cat: "Balance sheet & forensics", ai: true, q: () => "Are there any unusual related-party transactions?" },
  { id: "watch", cat: "Balance sheet & forensics", q: () => "Are there any warning signs investors should monitor?", tab: "forensic",
    a: (F) => { const w = [], x = F.forensic, L = last(F), S = F.shareholding;
      if (x) x.flags.filter((y) => y.severity !== "low").forEach((y) => w.push(y.text));
      if (F.dcf && !F.bank) F.dcf.warnings.forEach((y) => w.push(typeof y === "string" ? y : y.text || y.msg || ""));
      if (fin(L.ocfToNi) && L.ocfToNi < 70) w.push(`Only ${N(L.ocfToNi, 0)}% of ${fy(L.year)} profit arrived as operating cash`);
      if (F.annual && !F.bank) F.annual.flags.forEach((y) => w.push(y));
      if (S && fin(S.promoterYoy) && S.promoterYoy <= -1) w.push(`Promoter holding fell ${N(Math.abs(S.promoterYoy), 2)}pp over the year`);
      if (S && fin(S.pledgePct) && S.pledgePct > 5) w.push(`${N(S.pledgePct, 1)}% of promoter shares are pledged`);
      if (F.insiders12m && F.insiders12m.sell > 0 && F.insiders12m.sell > 3 * (F.insiders12m.buy || 0)) w.push(`Insiders sold ${amt(F, F.insiders12m.sell)} of shares in the last 12 months against ${amt(F, F.insiders12m.buy || 0)} bought`);
      if (F.reverse && fin(F.reverse.impliedGrowth) && F.reverse.impliedGrowth > F.reverse.assumedGrowth + 5) w.push(`The share price implies ${N(F.reverse.impliedGrowth)}% revenue growth against ${N(F.reverse.assumedGrowth)}% in the base case`);
      if (F.dcf && F.dcf.tvShare > 75) w.push(`${N(F.dcf.tvShare, 0)}% of the DCF value is terminal value`);
      if (fin(F.ratios.de) && F.ratios.de > 1.5 && !F.bank) w.push(`Debt/equity of ${N(F.ratios.de, 2)}×`);
      const out = [...new Set(w.filter(Boolean))];
      return { text: out.length ? `${out.length} item${out.length > 1 ? "s" : ""} worth watching, from the forensic screens, the model and ownership data:` : "Nothing stands out on the forensic screens, cash conversion, leverage, ownership or the model's own checks.", points: out.slice(0, 7) }; } },

  // ── market & ownership ──
  { id: "move", cat: "Market & ownership", q: () => "What has driven the recent share-price movement?", tab: "research",
    a: (F) => { const m = F.moves;
      return { text: m ? `The stock is ${pc(m.m1)} over a month, ${pc(m.m3)} over three months and ${pc(m.m12)} over a year${fin(m.idx3) ? `, against ${pc(m.idx1)}, ${pc(m.idx3)} and ${pc(m.idx12)} for the ${m.index}` : ""}.${F.news.length ? " Recent headlines (reported news — not proof of cause):" : ""}` : "Price history isn't available right now.",
        points: [...F.news.slice(0, 4).map((n) => `${n.date}: ${n.title}${n.publisher ? ` (${n.publisher})` : ""}`), F.street && fin(F.street.buysNow) && fin(F.street.buys3mAgo) && F.street.buysNow !== F.street.buys3mAgo ? `Analyst buy ratings: ${F.street.buys3mAgo} three months ago → ${F.street.buysNow} now` : null].filter(Boolean),
        research: research("✦ Research the price move", `What has driven ${F.name}'s share price over the last three months? Cite dated news, results or rating changes.`) }; } },
  { id: "range", cat: "Market & ownership", q: () => "Where is the stock versus its 52-week range?", tab: "research",
    a: (F) => ({ text: `${px(F, F.price)} against a 52-week range of ${px(F, F.low52)} – ${px(F, F.high52)}${fin(F.high52) && fin(F.low52) && F.high52 > F.low52 ? ` (${N(((F.price - F.low52) / (F.high52 - F.low52)) * 100, 0)}% of the way up)` : ""}.`, points: [fin(F.changePct) ? `Today: ${pc(F.changePct, 2)}` : null, fin(F.high52) ? `${pc((F.price / F.high52 - 1) * 100)} from the high` : null].filter(Boolean) }) },
  { id: "owners", cat: "Market & ownership", q: (F) => `Who owns ${F.short}?`, tab: "research",
    a: (F) => { const S = F.shareholding, L = S && S.latest, P = S && S.first;
      if (L) { const row = (k, n) => (fin(L[k]) ? `${n} ${N(L[k], 2)}%${P && fin(P[k]) ? ` (${pp(L[k] - P[k], 2)} since ${P.label})` : ""}` : null);
        return { text: `Shareholding as of ${L.label}, as filed with the exchange:`, points: [row("promoter", "Promoters"), row("fpi", "Foreign institutions"), row("mutualFunds", "Mutual funds"), row("domesticInst", "Domestic institutions (incl. mutual funds)"), row("retail", "Retail"),
          fin(S.pledgePct) ? (S.pledgePct > 0 ? `Pledged: ${N(S.pledgePct, 2)}% of promoter shares` : "No promoter shares pledged") : null, S.topHolders.length ? `Largest public holders: ${S.topHolders.map((h) => `${h.name} ${N(h.pct, 2)}%`).join(", ")}` : null].filter(Boolean) }; }
      return { text: `Insiders hold ${N(F.holders.promotersInsiders)}% and institutions ${N(F.holders.institutions)}%.`, points: [] }; } },
  { id: "dividend", cat: "Market & ownership", q: (F) => `What dividend does ${F.short} pay?`, tab: "research",
    a: (F) => { const L = last(F), payout = fin(L.divPaid) && L.netIncome > 0 ? (L.divPaid / L.netIncome) * 100 : null;
      return { text: fin(F.ratios.divYield) && F.ratios.divYield > 0 ? `The dividend yield is ${N(F.ratios.divYield, 2)}% at the current price${fin(payout) ? `, and ${fy(L.year)} dividends took ${N(payout, 0)}% of net profit` : ""}.` : "The stock pays little or no dividend.",
        points: [...F.dividends.slice(0, 3).map((d) => `${d.date}: ${d.text}`), fin(F.ratios.fcfYield) ? `FCF yield ${N(F.ratios.fcfYield)}% — the cash that could fund dividends or buybacks` : null].filter(Boolean) }; } },
  { id: "divchange", cat: "Market & ownership", q: () => "How has the dividend changed?", tab: "research",
    a: (F) => { const s = series(F, "divPaid", (x) => amt(F, x));
      return { text: s ? `Total dividends paid: ${s}.` : "Dividend history isn't available for this company.", points: F.dividends.map((d) => `${d.date}: ${d.text}`) }; } },
  { id: "street", cat: "Market & ownership", q: () => "What are analysts expecting?", tab: "research",
    a: (F) => { const s = F.street, C = F.consensus; if (!(s && s.analysts) && !C) return { text: "No analyst coverage is reported for this stock." };
      const t = (s && s.trend) || {}, e = (x) => x ? `${cap(x.label)}: EPS ${pc(x.epsGrowth)}, revenue ${pc(x.revGrowth)} (${x.analysts} analysts${fin(x.up30) ? `; 30-day revisions ${x.up30} up / ${x.down30} down` : ""})` : null;
      return { text: s && s.analysts ? `${s.analysts} analysts cover the stock, with a mean target of ${px(F, s.target)} (${fin(s.target) && fin(F.price) ? pc((s.target / F.price - 1) * 100) : "—"}) and a range of ${px(F, s.low)} – ${px(F, s.high)}.` : "Consensus estimates:",
        points: [C && e(C.fy), C && e(C.next), C && C.beats ? `Beat EPS estimates in ${C.beats.beats} of the last ${C.beats.quarters} quarters (average surprise ${pc(C.beats.avgSurprise)})` : null,
          s && s.trend ? `Ratings: strong buy ${t.strongBuy ?? "—"} · buy ${t.buy ?? "—"} · hold ${t.hold ?? "—"} · sell ${t.sell ?? "—"} · strong sell ${t.strongSell ?? "—"}` : null].filter(Boolean) }; } },
  { id: "priced", cat: "Market & ownership", q: () => "What expectations are already priced in?", tab: "models",
    a: (F) => { const R = F.reverse, C = F.consensus && F.consensus.fy;
      return need(R && fin(R.impliedGrowth), F.dcf ? "The reverse DCF could not be solved for this company." : NO_DCF(F)) || ({ text: `Working backwards from ${px(F, F.price)}, the market is paying for about ${N(R.impliedGrowth)}% revenue growth next year, tapering over the forecast. Here is how that compares:`,
        points: [C && fin(C.revGrowth) ? `Analysts expect ${pc(C.revGrowth)} revenue growth this year` : null, `The M-Terminal base case assumes ${N(R.assumedGrowth)}%`, fin(F.growth.revCagr) ? `The company has delivered ${N(F.growth.revCagr)}% a year historically` : null,
          fin(F.ratios.pe) && fin(F.peers.pe) ? `P/E ${N(F.ratios.pe)}× vs the peer median ${N(F.peers.pe)}×` : null, fin(R.impliedWacc) ? `Or: the price is consistent with ${an(R.impliedWacc)} ${N(R.impliedWacc)}% discount rate at the base-case growth` : null].filter(Boolean) }); } },
];

/* platform how-to. The two export questions are pinned to the top of every greeting. */
const PLATFORM = [
  { id: "p-excel", cat: "Using M-Terminal", pin: true, top: 1, q: () => "How do I export the detailed DCF model to Excel?", tab: "models",
    a: () => ({ text: "Open a company, go to **Modeling Lab**, and once the Institutional DCF Model has loaded click **↓ Export to Excel** at the top right of that panel. The workbook uses your current assumptions and the forecast horizon you picked (3, 5, 7 or 10 years).",
      points: ["Sheets: company title page, assumptions, three statements, DCF, terminal value (11 methods), two-stage DCF, sensitivity, scenarios, reverse DCF, tornado, comparable companies, valuation methods & blended target, Monte Carlo, assumption rationale", "Only the blue cells are inputs — everything else is a live formula, so changing an assumption recalculates the whole model", "A Checks sheet reconciles every figure to the website", "Open it in desktop Excel: the sensitivity tables use Excel data tables, which Google Sheets doesn't recalculate", "Want the research data rather than the model? **⬇ Workbook** in the company header (Company Analysis) downloads a consolidated research workbook"] }) },
  { id: "p-report", cat: "Using M-Terminal", pin: true, top: 2, q: () => "How do I export the equity research report?", tab: "reports",
    a: () => ({ text: "Go to **Report Generation**, check the symbol (it is prefilled with the company on screen) and click **Generate report**. It reads the latest filings, runs every model and drafts an initiating-coverage report — this takes a few minutes.",
      points: ["Shortcut: **▤ Generate report** in the company header opens it with the symbol filled in", "When it's ready: **Print / PDF** saves a PDF through your browser, **Download .doc** gives an editable Word file, **Save to Library** keeps it in the Library tab", "The valuation follows your “Use this DCF in research” choice in the Modeling Lab", "Every number in the report comes from the models; AI only writes the prose, and each claim is checked against the data"] }) },
  { id: "p-start", cat: "Using M-Terminal", top: 3, q: () => "What can I do on M-Terminal?", a: () => ({ text: "The tabs come in three groups. Macro: Market Intelligence, Sector Analysis and Portfolio Analysis. Equity research — search any listed company (Ctrl+K), then: Company Analysis (financials, ratios, peers, filings), Earnings Call (upload a transcript), Forensic Analysis (accounting quality), Modeling Lab (DCF, scenarios, Monte Carlo, Excel export), Risk Center, Report Generation (a full research report) and Quant Lab. Utilities: Calculators, Learning Center and Library.", points: [] }) },
  { id: "p-rating", cat: "Using M-Terminal", top: 4, q: () => "How does M-Terminal determine its rating?", a: () => ({ text: "A composite of seven scored factors — valuation, business quality, moat, forensic health, earnings quality, growth momentum and the street view — computed without AI. The rating can't contradict the expected return to the target (e.g. no Buy below +5%).", points: [] }) },
  { id: "p-fv", cat: "Using M-Terminal", top: 5, q: () => "How is the fair value calculated?", tab: "research", a: () => ({ text: "By default the fair value blends market-based methods — peer multiples, the stock's own P/E history, the street target and a published fair value — each weighted by how reliable it is for that company. Switch on “Use this DCF in research” and your Modeling Lab DCF becomes a 40% intrinsic anchor, with the market methods making up the other 60%.", points: [] }) },
  { id: "p-basis", cat: "Using M-Terminal", top: 12, q: () => "What does “Use this DCF in research” do?", tab: "models", a: () => ({ text: "Off (default): research, reports and the target use market-based methods. On: your Modeling Lab DCF becomes the 40% intrinsic anchor of the blended target, in research and in reports. The choice is saved per company in your browser.", points: [] }) },
  { id: "p-data", cat: "Using M-Terminal", top: 6, q: () => "Where does the financial data come from?", a: () => ({ text: "Market data and financial statements from Yahoo Finance; quarterly results, shareholding, pledges, insider trades and corporate actions from NSE filings (XBRL); bond yields and macro series from public sources. Every model figure is recomputed from these and shown with its source in each module.", points: [] }) },
  { id: "p-ai", cat: "Using M-Terminal", top: 7, q: () => "Where is AI used?", a: () => ({ text: "AI writes report prose, reads filings for cited evidence, analyses earnings calls, cross-checks the DCF assumptions (a verdict you can ignore) and answers custom questions in this chat. These ready-made questions use no AI at all; the few marked ✦ hand over to the AI chat.", points: [] }) },
  { id: "p-aicalc", cat: "Using M-Terminal", top: 8, q: () => "Does AI change the financial calculations?", a: () => ({ text: "No. Every number, ratio, rating and target is computed by deterministic models from the source data. AI suggestions for DCF assumptions are shown as a check next to the engine's own value and are never applied automatically; the model works the same with AI switched off.", points: [] }) },
  { id: "p-forensic", cat: "Using M-Terminal", top: 9, q: () => "How do I read the forensic scores?", tab: "forensic", a: () => ({ text: "Piotroski F-score (0–9, higher = stronger fundamentals), Altman Z (distress risk; >2.99 safe, <1.81 distress), Beneish M-score (manipulation risk; above −1.78 is a warning) and cash-flow checks (profit backed by cash, low accruals). Together they give an earnings quality grade A–D.", points: [] }) },
  { id: "p-call", cat: "Using M-Terminal", top: 10, q: () => "How do I analyse an earnings call?", tab: "earnings", a: () => ({ text: "Open the Earnings Call tab and upload the transcript PDF (or paste the text). You get tone, guidance, KPIs, Q&A pressure points and industry-specific modules; results are cached per transcript.", points: [] }) },
  { id: "p-peers", cat: "Using M-Terminal", q: () => "How do I change the peer group?", tab: "research", a: () => ({ text: "Company Analysis ▸ Peers: search and add up to 10 comparables or remove suggested ones; the relative-valuation table updates immediately.", points: [] }) },
  { id: "p-sector", cat: "Using M-Terminal", top: 11, q: () => "How do I compare companies across sectors?", a: () => ({ text: "Open the Sector Analysis tab: choose a country and exchange (India defaults to NSE) to see sector aggregates, leaders and valuation dispersion. For a head-to-head on specific names, use Company Analysis ▸ Peers.", points: [] }) },
];

function questions(F) {
  const withCo = !!F;
  const co = withCo ? COMPANY.map((q) => ({ id: q.id, cat: q.cat, top: !!q.top, order: q.top || 99, ai: !!q.ai, text: q.q(F), tab: q.tab || null })) : [];
  // with a company open the first screen is the ten company questions; without one, the platform ones
  const pl = PLATFORM.map((q) => ({ id: q.id, cat: q.cat, pin: !!q.pin, top: !withCo && !!q.top && !q.pin, order: q.top || 99, text: q.q(), tab: q.tab || null }));
  return [...co, ...pl];
}
function answer(id, F) {
  const q = COMPANY.find((x) => x.id === id) || PLATFORM.find((x) => x.id === id);
  if (!q || q.ai) return null;
  if (!q.id.startsWith("p-") && !F) return { text: "Open a company first (Ctrl+K) — this question is about the company on screen." };
  try {
    const a = q.a(F);
    const missing = /—×|—%|[₹$]—|— (Cr|Mn)|\(n\/a\)|: —$|^[^:]+: —(\s|$)| — \(|^— |→ —|—d\b|NaN|undefined/;
    const points = (a.points || []).filter((p) => p && !missing.test(p));
    const text = a.text && /NaN|undefined/.test(a.text) ? "That data isn't available for this company on the platform yet." : a.text;
    return { ...a, text, points, tab: q.tab || null, question: q.q(F || {}) };
  }
  catch { return { text: "That data isn't available for this company on the platform yet." }; }
}

/* ═══════════════════════ AI chat (budgeted) ═══════════════════════ */
const SYSTEM = `You are the M-Terminal assistant inside an equity research platform. Scope: the company on screen, investing and finance concepts, and how to use M-Terminal. Rules:
- Answer from PLATFORM DATA first and say so. Quote only numbers that appear there (keep units). When describing a change, check its direction: a lower number is a fall.
- If the question is in scope but PLATFORM DATA does not contain the answer, set basis "research" and write a short web search query; do not guess numbers.
- For general finance concepts you may answer from knowledge (basis "general").
- Never tell the user to buy, sell or hold, and give no personalised advice; you may state M-Terminal's own model outputs and rating inputs.
- Out of scope (not finance / not this platform): decline in one sentence (basis "declined").
- At most 120 words, plain English, no markdown headings.`;
const SCHEMA = { type: "object", additionalProperties: false, required: ["answer", "basis"],
  properties: { answer: { type: "string" }, basis: { type: "string", enum: ["platform", "general", "research", "declined"] }, research_query: { type: "string" } } };
const PLATFORM_HELP = PLATFORM.map((q) => `${q.q()} ${q.a().text.replace(/\*\*/g, "")}`).join(" ");

function numbersKnown(F) { const out = []; JSON.stringify(F).replace(/-?\d+(?:\.\d+)?/g, (m) => { out.push(+m); return m; }); return out; }
function unverifiedNumbers(text, F) {
  const known = numbersKnown(F);
  const nums = String(text).replace(/FY\d{2,4}|Q[1-4]|20\d\d|\b\d{1,2}\b(?=\s*(?:years?|analysts?|runs?))/g, "").match(/\d[\d,]*(?:\.\d+)?/g) || [];
  return nums.map((n) => +n.replace(/,/g, "")).filter((v) => v > 12 && !known.some((k) => Math.abs(Math.abs(k) - v) <= Math.max(0.051, v * 0.002)));
}
function budgetOf(chatId) { return chats.get(chatId) || { tokens: 0, turns: 0 }; }
function status(chatId) {
  const b = budgetOf(chatId);
  return { tokensUsed: b.tokens, tokensLeft: Math.max(0, LIMITS.chatTokens - b.tokens), turnsLeft: Math.max(0, LIMITS.chatTurns - b.turns), limits: { chatTokens: LIMITS.chatTokens, chatTurns: LIMITS.chatTurns }, available: !!PROVIDER(), provider: PROVIDER() };
}

/* what the AI sees of the fact pack: no links, no empty fields, no working detail the
   ready-made answers use (per-year day counts, bridges) — keeps a turn near 3k tokens */
const AI_DROP = new Set(["scale", "unit", "unitWord", "sym", "dRecv", "dInv", "dPay", "wcChange", "ppeTurn", "assetTurn", "invDays", "payDays", "recvDays", "bridge", "steps", "topHolders", "end", "up30", "down30", "partial", "coe"]);
const aiFacts = (k, v) => (k.startsWith("_") || AI_DROP.has(k) || v === null || (Array.isArray(v) && !v.length) ? undefined : v);
// a few headline figures for a research call, so the web answer can sit next to the platform's own numbers
const brief = (F) => (F ? JSON.stringify({ sector: F.sector, industry: F.industry, fy: F.fy, revenue: (F.hist.at(-1) || {}).revenue, unit: F.unit, growth: F.growth, moat: F.moat && F.moat.overall, segments: F.segments.map((s) => ({ name: s.name, share: s.share, yoy: s.yoy })) }, aiFacts) : "");
// Groq's browser_search leaves citation markers such as 【0†L41-L50】 in the text
const tidy = (s) => String(s || "").replace(/【[^】]*】/g, "").replace(/[ \t]+\n/g, "\n").replace(/ {2,}/g, " ").trim();
const JSON_RULE = 'Reply with a JSON object only: {"answer": string, "basis": "platform" | "general" | "research" | "declined", "research_query": string (only when basis is "research")}.';

/* one answer call on the chosen provider → { json, tokens, model } */
async function answerCall(provider, user) {
  if (provider === "groq") {
    const r = await groq.chat({ messages: [{ role: "system", content: `${SYSTEM}\n${JSON_RULE}` }, { role: "user", content: user }], json: true, maxTokens: 1200, timeoutMs: 30_000 });
    return { json: r.json, tokens: r.usage.total_tokens, model: r.model };
  }
  const r = await gemini.chat({ messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }], schema: { name: "assistant_answer", schema: SCHEMA }, maxTokens: LIMITS.answerTokens, reasoning: "low", timeoutMs: 45_000, direct: true });
  return { json: r.json, tokens: (r.usage && r.usage.total_tokens) || 0, model: r.model };
}
/* one web-research call → { text, urls, tokens, model } */
async function researchCall(provider, F, msg, query) {
  const sys = "Answer the investor's question from web search results in at most 120 words, plain English. State figures with their date and source. No buy/sell advice. No citation markers.";
  const ask = `Company: ${F ? `${F.name} (${F.symbol})` : "—"}.${F ? ` Platform figures: ${brief(F)}.` : ""} Question: ${msg}${query ? ` Search: ${query}` : ""}`;
  if (provider === "groq") {
    const r = await groq.chat({ messages: [{ role: "system", content: sys }, { role: "user", content: ask }], search: true, maxTokens: 1500, timeoutMs: 45_000 });
    const seen = new Set(), urls = r.urls.filter((u) => !seen.has(u.url) && seen.add(u.url)).slice(0, 4);
    return { text: tidy(r.content), urls, tokens: r.usage.total_tokens, model: r.model };
  }
  const r = await gemini.chat({ messages: [{ role: "system", content: sys }, { role: "user", content: ask }], tools: [{ google_search: {} }], maxTokens: LIMITS.researchTokens, reasoning: "low", timeoutMs: 45_000, direct: true });
  return { text: tidy(r.content), urls: ((r.grounding && r.grounding.chunks) || []).slice(0, 4).map((c) => ({ url: c.uri, title: c.title || c.uri })), tokens: (r.usage && r.usage.total_tokens) || 0, model: r.model };
}
/* the chosen provider first; the other one only if the first call fails */
async function withFallback(fn) {
  const first = PROVIDER(), second = first === "groq" ? (gemini.hasKey() ? "gemini" : null) : (groq.hasKey() ? "groq" : null);
  try { return await fn(first); }
  catch (e) { if (!second) throw e; console.warn(`[assistant] ${first}: ${e.code || "error"} — trying ${second}`); return fn(second); }
}

async function chat({ chatId, ip, message, F, history = [], deep = false }) {
  const today = new Date().toISOString().slice(0, 10);
  if (day !== today) { day = today; dayTurns = 0; visitors.clear(); }
  if (!PROVIDER()) return { text: "Custom questions need the AI service, which isn't configured. The questions above are answered without it.", basis: "off", ...status(chatId) };
  const msg = String(message || "").trim().slice(0, LIMITS.messageChars);
  if (!msg) return { text: "Type a question.", basis: "off", ...status(chatId) };
  const b = chats.get(chatId) || { tokens: 0, turns: 0, startedAt: Date.now() };
  if (b.tokens >= LIMITS.chatTokens || b.turns >= LIMITS.chatTurns) return { text: "This chat has reached its AI limit. Start a new chat (↻) or use the ready-made questions — they don't use AI.", basis: "limit", ...status(chatId) };
  const vk = `${today}|${ip}`, vt = visitors.get(vk) || 0;
  if (vt >= LIMITS.visitorDailyTurns || dayTurns >= LIMITS.dailyTurns) return { text: "Today's AI question allowance is used up. The ready-made questions still work.", basis: "limit", ...status(chatId) };
  visitors.set(vk, vt + 1); dayTurns++; b.turns++; chats.set(chatId, b);

  // ✦ questions need business context the platform doesn't hold → straight to one research call
  if (deep && F) {
    try {
      const rr = await withFallback((p) => researchCall(p, F, msg));
      b.tokens += rr.tokens; chats.set(chatId, b);
      if (rr.text) return { text: rr.text, basis: "research", urls: rr.urls, model: rr.model, ...status(chatId) };
    } catch { /* fall through to the ordinary answer */ }
  }

  const facts = F ? JSON.stringify(F, aiFacts) : "No company is open.";
  const hist = history.slice(-4).map((h) => `${h.role === "user" ? "User" : "Assistant"}: ${String(h.text || "").slice(0, 300)}`).join("\n");
  // the how-to notes only when the question is about the platform (or no company is open)
  const help = !F || /m-?terminal|platform|export|excel|download|report|workbook|tab\b|how (do|can) i|where (is|do|can)|rating|use this dcf/i.test(msg) ? `PLATFORM HELP: ${PLATFORM_HELP}\n\n` : "";
  const user = `PLATFORM DATA (company on screen, computed by M-Terminal; currency ${F ? F.currency + ", amounts in " + F.unit + " unless per share" : "n/a"}):\n${facts}\n\n${help}${hist ? `CONVERSATION SO FAR:\n${hist}\n\n` : ""}QUESTION: ${msg}`;
  let r;
  try { r = await withFallback((p) => answerCall(p, user)); }
  catch (e) { chats.set(chatId, b); return { text: "The AI service is busy right now — please try again in a moment, or pick a ready-made question.", basis: "error", ...status(chatId) }; }
  b.tokens += r.tokens;
  const j = r.json || {};
  let text = tidy(j.answer) || "I couldn't form an answer to that — try rephrasing.";
  let basis = ["platform", "general", "research", "declined"].includes(j.basis) ? j.basis : "platform", urls = [];
  // one web-research call when the platform lacks the answer and the budget allows
  if (basis === "research") {
    if (b.tokens < LIMITS.chatTokens - 6000) {
      try {
        const rr = await withFallback((p) => researchCall(p, F, msg, j.research_query));
        b.tokens += rr.tokens;
        if (rr.text) { text = rr.text; urls = rr.urls; }
      } catch {
        basis = "general";
        text = `${text}\n\n(Web research isn't available right now, so this couldn't be checked against live sources — the platform doesn't hold this data.)`;
      }
    } else { basis = "general"; text += "\n\n(Not enough of this chat's AI allowance is left for a web search — start a new chat to research it.)"; }
  }
  if (basis === "platform" && F) { const bad = unverifiedNumbers(text, F); if (bad.length) text += "\n\n(Some figures above could not be matched to platform data — verify before use.)"; }
  chats.set(chatId, b);
  return { text, basis, urls, model: r.model, ...status(chatId) };
}
const newChatId = () => crypto.randomBytes(9).toString("hex");
// forget idle chats after 6 hours
setInterval(() => { const cut = Date.now() - 6 * 3600_000; for (const [k, v] of chats) if (v.startedAt < cut) chats.delete(k); }, 3600_000).unref();

module.exports = { factPack, questions, answer, chat, status, newChatId, LIMITS };
