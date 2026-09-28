/**
 * M-TERMINAL — Company Research Pack, Layer 1 (fast, deterministic, no AI).
 *
 * One pack per company per day, shared by the Equity Research workstation and
 * the report: exchange-filed quarterly results (XBRL), earnings bridges,
 * shareholding & promoter pledges, insider trades, corporate actions, the
 * results calendar, material filings and dated news headlines.
 *
 * Every figure here is either filed with the exchange or computed from filed
 * figures; nothing is estimated. Sections that a source cannot supply are null
 * and the UI simply omits them.
 */

const nse = require("../providers/nse");
const { parseResultsXbrl, parseShareholdingXbrl, fiscalQuarter } = require("./xbrl");
const { filings: materialFilings, googleNews, shortName, LOW } = require("./insights/sources");
const { cachedDurable } = require("../cache");

const XBRL_TTL = 30 * 86_400_000;                 // a filed XBRL never changes
const isIndian = (s) => /\.(NS|BO)$/i.test(String(s || ""));
const pct = (a, b) => (a != null && b != null && b !== 0 ? (a / b - 1) * 100 : null);
const bps = (a, b) => (a != null && b != null ? (a - b) * 100 : null);   // margin change in basis points
const settle = (p) => Promise.resolve(p).catch(() => null);

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]).catch(() => null); } }));
  return out;
}

/* ── quarterly results from exchange XBRL ─────────────────────────────── */
async function quarterlyResults(symbol, n = 8) {
  const all = await nse.resultsFilings(symbol);
  if (!all || !all.length) return null;
  const scope = all.some((r) => r.consolidated) ? true : false;           // consolidated when filed
  const rows = all.filter((r) => r.consolidated === scope).slice(0, n);
  const parsed = await pool(rows, 4, (r) => cachedDurable(`xbrl2:${r.xbrl}`, XBRL_TTL, async () => {
    const xml = await nse.archiveText(r.xbrl);
    const p = xml ? parseResultsXbrl(xml, { qe: r.qe }) : null;
    if (!p) throw new Error("unparseable XBRL");
    return p;
  }));
  const qs = rows.map((r, i) => (parsed[i] && parsed[i].pl.revenue != null ? {
    qe: r.qe, label: fiscalQuarter(r.qe), filed: r.filed, audited: r.audited, xbrl: r.xbrl, ...parsed[i],
  } : null)).filter(Boolean);
  if (!qs.length) return null;
  // YoY against the same quarter a year earlier; QoQ against the previous quarter
  const find = (qe, monthsBack) => { const d = new Date(qe + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() - monthsBack); const iso = d.toISOString().slice(0, 7); return qs.find((q) => q.qe.slice(0, 7) === iso) || null; };
  for (const q of qs) {
    const y = find(q.qe, 12), p = find(q.qe, 3);
    const ch = (o) => o ? {
      revenue: pct(q.pl.revenue, o.pl.revenue), grossProfit: pct(q.derived.grossProfit, o.derived.grossProfit), ebitda: pct(q.derived.ebitda, o.derived.ebitda),
      pat: pct(q.pl.pat, o.pl.pat), grossMarginBps: bps(q.derived.grossMargin, o.derived.grossMargin), ebitdaMarginBps: bps(q.derived.ebitdaMargin, o.derived.ebitdaMargin),
      against: o.label,
    } : null;
    q.yoy = ch(y); q.qoq = ch(p);
    q.segments = q.segments.map((s) => {
      const ys = y && y.segments.find((x) => x.name === s.name);
      return { ...s, revenueYoy: ys ? pct(s.revenue, ys.revenue) : null, marginYoyBps: ys ? bps(s.margin, ys.margin) : null };
    });
  }
  return { scope: scope ? "Consolidated" : "Standalone", quarters: qs, bridge: quarterBridge(qs[0], find(qs[0].qe, 12)) };
}

/* EBITDA bridge for the latest quarter vs the year-ago quarter:
   volume/price at the old gross margin, gross-margin change, and each cost line */
function quarterBridge(cur, prev) {
  if (!cur || !prev || cur.derived.ebitda == null || prev.derived.ebitda == null || cur.derived.grossMargin == null || prev.derived.grossMargin == null) return null;
  const adv = (q) => (q.expenses.find((e) => /advertis|promotion|a ?& ?p/i.test(e.label)) || {}).value ?? null;
  const dRev = cur.pl.revenue - prev.pl.revenue;
  const steps = [
    { label: `${prev.label} EBITDA`, value: prev.derived.ebitda, kind: "start" },
    { label: "Revenue growth at last year's gross margin", value: dRev * (prev.derived.grossMargin / 100), kind: "delta" },
    { label: "Gross-margin change", value: cur.pl.revenue * ((cur.derived.grossMargin - prev.derived.grossMargin) / 100), kind: "delta" },
  ];
  const a1 = adv(cur), a0 = adv(prev);
  if (a1 != null && a0 != null) steps.push({ label: "Advertising & promotion", value: -(a1 - a0), kind: "delta" });
  if (cur.pl.employee != null && prev.pl.employee != null) steps.push({ label: "Employee costs", value: -(cur.pl.employee - prev.pl.employee), kind: "delta" });
  const explained = steps.slice(1).reduce((s, x) => s + x.value, 0);
  steps.push({ label: "Other operating costs", value: (cur.derived.ebitda - prev.derived.ebitda) - explained, kind: "delta" });
  steps.push({ label: `${cur.label} EBITDA`, value: cur.derived.ebitda, kind: "end" });
  return { from: prev.label, to: cur.label, steps };
}

/* ── annual earnings bridge from the statements ───────────────────────── */
function annualBridge(st) {
  const inc = (st && st.income) || [], cf = (st && st.cashflow) || [];
  if (inc.length < 2) return null;
  const c = inc.at(-1), p = inc.at(-2);
  const cfOf = (y) => cf.find((x) => x.year === y) || {};
  const cc = cfOf(c.year), cp = cfOf(p.year);
  const eb = (r) => r.ebitda ?? r.opIncome ?? null;
  const ladder = [
    ["Revenue", c.revenue, p.revenue], ["Gross profit", c.grossProfit, p.grossProfit], ["EBITDA", eb(c), eb(p)],
    ["Net profit", c.netIncome, p.netIncome], ["Operating cash flow", cc.ocf, cp.ocf], ["Free cash flow", cc.fcf, cp.fcf],
  ].map(([label, cur, prev]) => ({ label, cur: cur ?? null, prev: prev ?? null, growth: pct(cur, prev) }));
  // divergences: a step whose growth falls more than 10 points behind the step above
  const flags = [];
  for (let i = 1; i < ladder.length; i++) {
    const a = ladder[i - 1], b = ladder[i];
    if (a.growth != null && b.growth != null && a.growth - b.growth > 10) flags.push(`${b.label} grew ${b.growth.toFixed(1)}% against ${a.growth.toFixed(1)}% for ${a.label.toLowerCase()} — the gap is where the incremental ${a.label.toLowerCase()} went.`);
  }
  const gm = (r) => (r.revenue && r.grossProfit != null ? r.grossProfit / r.revenue : null);
  let steps = null;
  if (gm(c) != null && gm(p) != null && eb(c) != null && eb(p) != null) {
    const dRev = c.revenue - p.revenue, opexC = c.grossProfit - eb(c), opexP = p.grossProfit - eb(p);
    steps = [
      { label: `FY${String(p.year).slice(-2)} EBITDA`, value: eb(p), kind: "start" },
      { label: "Revenue growth at last year's gross margin", value: dRev * gm(p), kind: "delta" },
      { label: "Gross-margin change", value: c.revenue * (gm(c) - gm(p)), kind: "delta" },
      { label: "Operating costs below gross profit", value: -(opexC - opexP), kind: "delta" },
      { label: `FY${String(c.year).slice(-2)} EBITDA`, value: eb(c), kind: "end" },
    ];
  }
  const conv = {
    ocfToEbitda: cc.ocf != null && eb(c) ? (cc.ocf / eb(c)) * 100 : null,
    ocfToNetProfit: cc.ocf != null && c.netIncome ? (cc.ocf / c.netIncome) * 100 : null,
    fcfToNetProfit: cc.fcf != null && c.netIncome ? (cc.fcf / c.netIncome) * 100 : null,
  };
  return { from: `FY${String(p.year).slice(-2)}`, to: `FY${String(c.year).slice(-2)}`, ladder, steps, conversion: conv, flags };
}

/* ── ownership, insiders, actions, calendar ──────────────────────────── */
/* category split + named holders from the shareholding-pattern XBRL (last 5 quarters) */
async function shareholdingDetail(rows) {
  const q = (rows || []).filter((r) => r.xbrl).slice(0, 5);
  if (!q.length) return null;
  const parsed = await pool(q, 3, (r) => cachedDurable(`shpx:${r.xbrl}`, XBRL_TTL, async () => {
    const xml = await nse.archiveText(r.xbrl, 6_000_000);
    const d = xml ? parseShareholdingXbrl(xml) : null;
    if (!d) throw new Error("unparseable shareholding XBRL");
    return d;
  }));
  const ok = q.map((r, i) => (parsed[i] ? { date: r.date, label: fiscalQuarter(r.date), ...parsed[i] } : null)).filter(Boolean);
  if (!ok.length) return null;
  const L = ok[0];
  return {
    label: L.label, categories: L.categories,
    holders: L.holders.filter((h) => h.type !== "Promoter group" && h.pct >= 1).sort((a, b) => b.pct - a.pct),
    promoterEntities: L.holders.filter((h) => h.type === "Promoter group").sort((a, b) => b.pct - a.pct).slice(0, 6),
    trend: ok.slice().reverse().map((x) => ({ label: x.label, fpi: x.categories.fpi ?? null, domesticInst: x.categories.domesticInst ?? null, mutualFunds: x.categories.mutualFunds ?? null, retail: x.categories.retail ?? null, promoter: x.categories.promoter ?? null })),
  };
}

function shareholdingView(rows, pledge, detail) {
  if (!rows || !rows.length) return null;
  const q = rows.slice(0, 12);
  const ago = (n) => q[n] || null;
  return {
    quarters: q.map((r) => ({ date: r.date, label: fiscalQuarter(r.date), promoter: r.promoter, public: r.public, employeeTrusts: r.employeeTrusts })),
    change: { qoq: ago(1) ? q[0].promoter - ago(1).promoter : null, yoy: ago(4) ? q[0].promoter - ago(4).promoter : null },
    remarks: q[0].remarks || null,
    pledge: pledge && !pledge.none ? pledge : pledge && pledge.none ? { none: true } : null,
    detail: detail || null,
  };
}

function insiderView(rows) {
  if (!rows) return null;
  const yr = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const recent = rows.filter((r) => r.date >= yr);
  const sum = (t) => recent.filter((r) => new RegExp(t, "i").test(r.type)).reduce((s, r) => s + (r.value || 0), 0);
  return { trades: rows.slice(0, 12), last12m: { buyValue: sum("buy"), sellValue: sum("sell"), count: recent.length } };
}

function calendarView(events, actions) {
  const today = new Date().toISOString().slice(0, 10);
  const ev = events || [];
  const upcoming = ev.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const lastResults = ev.find((e) => e.date < today && /result/i.test(e.purpose)) || null;
  const act = (actions || []).slice(0, 8);
  return { upcoming: upcoming.slice(0, 4), lastResults, actions: act, upcomingActions: act.filter((a) => (a.exDate || a.recordDate) >= today) };
}

/* ── exchange sections with a last-good fallback ──────────────────────────
   NSE refuses requests in bursts (bot protection; worse from cloud hosts), and a
   refused call looks exactly like "no data". Each section is therefore cached on
   its own: a success is kept (memory + disk snapshot); a failure throws, so the
   durable cache serves the last good copy instead of a blank. Only a section that
   has never loaded comes back null — and the pack records it as unavailable. */
const SECTION_TTL = { quarterly: 3 * 3_600_000, shareholding: 6 * 3_600_000, pledge: 6 * 3_600_000, insiders: 3 * 3_600_000, calendar: 3 * 3_600_000, actions: 6 * 3_600_000, filings: 3 * 3_600_000 };
function section(name, symbol, fn) {
  return cachedDurable(`nsesec:${name}:${symbol}`, SECTION_TTL[name], async () => {
    const v = await fn();
    if (v == null) throw new Error(`NSE ${name} unavailable`);
    return v;
  }).catch(() => null);
}

/* ── the pack ─────────────────────────────────────────────────────────── */
async function buildPack(symbol, co) {
  const IN = isIndian(symbol);
  const today = new Date().toISOString().slice(0, 10);
  const co0 = shortName(co.name);
  const [quarterly, shp, pledge, pit, events, actions, filings, news] = await Promise.all([
    // no results: tell "never filed" (empty list) apart from "NSE didn't answer" (null)
    IN ? section("quarterly", symbol, async () => {
      const q = await quarterlyResults(symbol);
      if (q) return q;
      const all = await nse.resultsFilings(symbol);
      return Array.isArray(all) && !all.length ? { none: true } : null;
    }) : null,
    IN ? section("shareholding", symbol, () => nse.shareholdingPattern(symbol)) : null,
    IN ? section("pledge", symbol, () => nse.pledgeSummary(symbol)) : null,
    IN ? section("insiders", symbol, () => nse.insiderTrades(symbol)) : null,
    IN ? section("calendar", symbol, () => nse.eventCalendar(symbol)) : null,
    IN ? section("actions", symbol, () => nse.corporateActions(symbol)) : null,
    IN ? section("filings", symbol, () => materialFilings(symbol, today)) : null,
    settle(googleNews(`"${co0}" when:120d`, today)),
  ]);
  // exchange sections that failed and had no earlier copy to fall back on
  const unavailable = IN ? Object.entries({ quarterly, shareholding: shp, insiders: pit, calendar: events, filings }).filter(([, v]) => v == null).map(([k]) => k) : [];
  const quarterlyData = quarterly && !quarterly.none ? quarterly : null;
  const re = new RegExp(`\\b${co0.split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
  return {
    symbol, name: co.name, asOf: new Date().toISOString(), layer: 1, currency: co.currency,
    quarterly: quarterlyData,
    unavailable,                                   // [] when every exchange section loaded
    annualBridge: annualBridge(co.statements),
    shareholding: shareholdingView(shp, pledge, shp ? await shareholdingDetail(shp).catch(() => null) : null),
    insiders: insiderView(pit),
    calendar: IN ? calendarView(events, actions) : null,
    filings: filings ? filings.filter((f) => f.informative || ["results", "deal", "presentation", "call"].includes(f.kind)).slice(0, 14)
      .map((f) => ({ date: f.date, kind: f.kind, category: f.category, text: f.text.slice(0, 260), url: f.url })) : null,
    news: news ? news.filter((n) => re.test(n.title) && !LOW.test(n.publisher)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10) : null,
  };
}

module.exports = { buildPack, quarterlyResults, quarterBridge, annualBridge, shareholdingView, insiderView, calendarView };
