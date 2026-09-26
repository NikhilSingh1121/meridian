/**
 * Ind AS quarterly-results XBRL parser (NSE integrated filings and the older
 * results format). Deterministic: exact figures as filed with the exchange.
 *
 *   parseResultsXbrl(xml, { qe }) → {
 *     period: { start, end, days },
 *     pl: { revenue, otherIncome, totalIncome, materials, purchases, inventoryChange, employee,
 *           finance, da, otherExpenses, totalExpenses, exceptional, pbt, tax, pat, patOwners, eps },
 *     derived: { cogs, grossProfit, grossMargin, ebitda, ebitdaMargin, patMargin },
 *     expenses: [{ label, value }],            // "other expenses" breakdown (e.g. advertising)
 *     segments: [{ name, revenue, ebit, margin }],
 *   }
 * All amounts in the filing's currency units (₹); null when not filed.
 */

function contexts(xml) {
  const out = {};
  for (const m of xml.matchAll(/<(?:xbrli:)?context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:xbrli:)?context>/g)) {
    const body = m[2];
    const g = (t) => { const r = body.match(new RegExp(`<(?:xbrli:)?${t}>\\s*([^<\\s]+)\\s*<`)); return r ? r[1] : null; };
    const dims = [...body.matchAll(/explicitMember[^>]*dimension="([^"]+)"[^>]*>\s*([^<\s]+)\s*</g)].map((d) => ({ axis: d[1].split(":").pop(), member: d[2].split(":").pop() }));
    out[m[1]] = { start: g("startDate"), end: g("endDate"), instant: g("instant"), dims };
  }
  return out;
}

function facts(xml) {
  const out = [];
  for (const m of xml.matchAll(/<([A-Za-z][\w-]*):([A-Za-z0-9_]+)\b([^>]*?)>([^<]*)<\/\1:\2>/g)) {
    const ctx = (m[3].match(/\bcontextRef="([^"]+)"/) || [])[1];
    if (!ctx) continue;
    out.push({ tag: m[2], ctx, raw: m[4].trim() });
  }
  return out;
}

const DAY = 86_400_000;
const days = (c) => (c.start && c.end ? Math.round((Date.parse(c.end) - Date.parse(c.start)) / DAY) + 1 : null);
const num = (s) => { const v = parseFloat(String(s).replace(/,/g, "")); return Number.isFinite(v) ? v : null; };

function parseResultsXbrl(xml, { qe } = {}) {
  if (!xml || typeof xml !== "string") return null;
  const C = contexts(xml), F = facts(xml);
  // the reporting quarter: a duration context with no dimensions, ~3 months long,
  // ending on the quarter-end (a Q4 or year-to-date filing also carries longer periods)
  const plain = Object.entries(C).filter(([, c]) => c.start && c.end && !c.dims.length);
  const quarterly = plain.filter(([, c]) => days(c) <= 100 && (!qe || c.end === qe));
  const pool = quarterly.length ? quarterly : plain.filter(([, c]) => !qe || c.end === qe);
  if (!pool.length) return null;
  const end = pool.map(([, c]) => c.end).sort().pop();
  const main = pool.filter(([, c]) => c.end === end);
  const start = main.map(([, c]) => c.start).sort().pop();       // shortest period ending on the quarter-end
  // older (pre-2025) filings name their columns One…/Four… and can date the year-to-date
  // column ("Four") with the quarter's own dates — keep to the current-quarter column
  const colOf = (id) => (String(id).match(/^(One|Two|Three|Four|Five|Six)(?=[A-Z0-9_])/) || [])[1] || null;
  const ids = main.filter(([, c]) => c.start === start).map(([id]) => id);
  const legacy = ids.some((id) => colOf(id) === "One");
  const mainIds = new Set(legacy ? ids.filter((id) => colOf(id) === "One") : ids);
  // dimensional contexts covering the same period (expense and segment breakdowns)
  const sameDim = (id) => { const c = C[id]; return c && c.dims.length && c.start === start && c.end === end && (!legacy || !colOf(id) || colOf(id) === "One"); };

  const get = (...tags) => {
    for (const t of tags) { const f = F.find((x) => x.tag === t && mainIds.has(x.ctx) && num(x.raw) != null); if (f) return num(f.raw); }
    return null;
  };
  const pl = {
    revenue: get("RevenueFromOperations"), otherIncome: get("OtherIncome"), totalIncome: get("Income"),
    materials: get("CostOfMaterialsConsumed"), purchases: get("PurchasesOfStockInTrade"),
    inventoryChange: get("ChangesInInventoriesOfFinishedGoodsWorkInProgressAndStockInTrade"),
    employee: get("EmployeeBenefitExpense"), finance: get("FinanceCosts"), da: get("DepreciationDepletionAndAmortisationExpense"),
    otherExpenses: get("OtherExpenses"), totalExpenses: get("Expenses"), exceptional: get("ExceptionalItemsBeforeTax"),
    pbt: get("ProfitBeforeTax"), tax: get("TaxExpense"), pat: get("ProfitLossForPeriod"),
    patOwners: get("ProfitOrLossAttributableToOwnersOfParent", "ProfitLossAttributableToOwnersOfParent"),
    eps: get("BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations", "BasicEarningsLossPerShareFromContinuingOperations"),
  };

  const cogsParts = [pl.materials, pl.purchases, pl.inventoryChange].filter((v) => v != null);
  const cogs = cogsParts.length ? cogsParts.reduce((a, b) => a + b, 0) : null;
  const grossProfit = pl.revenue != null && cogs != null ? pl.revenue - cogs : null;
  // EBITDA = revenue − operating expenses (total expenses less finance cost and D&A)
  const ebitda = pl.revenue != null && pl.totalExpenses != null ? pl.revenue - (pl.totalExpenses - (pl.finance || 0) - (pl.da || 0)) : null;
  const pct = (a, b) => (a != null && b ? (a / b) * 100 : null);
  const derived = {
    cogs, grossProfit, grossMargin: pct(grossProfit, pl.revenue), ebitda, ebitdaMargin: pct(ebitda, pl.revenue),
    patMargin: pct(pl.pat, pl.revenue),
  };

  // breakdowns keyed by the trailing member index ("…Segments2Member", "…Revenue02Member" → 2)
  const idx = (member) => { const m = String(member).match(/(\d+)Member$/); return m ? +m[1] : null; };
  const byAxis = (descTag, valueTag, axisRe) => {
    const names = new Map(), vals = new Map();
    for (const f of F) {
      if (!sameDim(f.ctx)) continue;
      const d = C[f.ctx].dims.find((x) => axisRe.test(x.axis)); if (!d) continue;
      const k = `${d.axis}|${idx(d.member)}`;
      if (f.tag === descTag && !names.has(idx(d.member))) names.set(idx(d.member), f.raw);
      if (f.tag === valueTag && num(f.raw) != null && !vals.has(k)) vals.set(k, { i: idx(d.member), v: num(f.raw) });
    }
    return { names, vals: [...vals.values()] };
  };
  const exp = byAxis("DescriptionOfOtherExpenses", "OtherExpenses", /OtherExpenses/i);
  const expenses = exp.vals.map((x) => ({ label: exp.names.get(x.i) || `Other expense ${x.i}`, value: x.v })).filter((x) => x.label);

  const segNames = new Map();
  for (const f of F) {
    if (f.tag !== "DescriptionOfReportableSegment" || !sameDim(f.ctx)) continue;
    const d = C[f.ctx].dims.find((x) => /Segment/i.test(x.axis)); if (d && idx(d.member) != null) segNames.set(idx(d.member), f.raw);
  }
  const segVal = (tag, axisRe) => {
    const m = new Map();
    for (const f of F) {
      if (f.tag !== tag || !sameDim(f.ctx) || num(f.raw) == null) continue;
      const d = C[f.ctx].dims.find((x) => axisRe.test(x.axis)); if (d && idx(d.member) != null && !m.has(idx(d.member))) m.set(idx(d.member), num(f.raw));
    }
    return m;
  };
  const segRev = segVal("SegmentRevenue", /Segment/i);
  const segEbit = segVal("SegmentProfitLossBeforeTaxAndFinanceCosts", /Segment/i);
  const segments = [...segNames.entries()].sort((a, b) => a[0] - b[0]).map(([i, name]) => {
    const revenue = segRev.get(i) ?? null, ebit = segEbit.get(i) ?? null;
    return { name, revenue, ebit, margin: pct(ebit, revenue) };
  }).filter((s) => s.revenue != null || s.ebit != null);

  return { period: { start, end, days: days({ start, end }) }, pl, derived, expenses, segments };
}

/* Indian fiscal quarter label: Jun → Q1 … Mar → Q4; FY named by its March year */
function fiscalQuarter(qe) {
  const m = String(qe || "").match(/^(\d{4})-(\d{2})/); if (!m) return null;
  const y = +m[1], mo = +m[2];
  const q = mo >= 4 && mo <= 6 ? 1 : mo >= 7 && mo <= 9 ? 2 : mo >= 10 && mo <= 12 ? 3 : 4;
  const fy = mo >= 4 ? y + 1 : y;
  return `Q${q} FY${String(fy).slice(-2)}`;
}

/**
 * Shareholding-pattern XBRL (SEBI Reg. 31) → category split and named holders.
 *   { categories: { promoter, fpi, mutualFunds, insurance, banks, pension, aif, sovereign,
 *                   otherDomesticInst, domesticInst, retail, nri, corporates, otherPublic,
 *                   public, employeeTrusts },          // % of total shares
 *     holders: [{ name, type, pct, shares }] }       // disclosed holders (≥ 1% public, promoter entities)
 */
const SHP_CAT = {
  ShareholdingOfPromoterAndPromoterGroupMember: "promoter", InstitutionsForeignMember: "fpi", MutualFundsOrUTIMember: "mutualFunds",
  InsuranceCompaniesMember: "insurance", BanksMember: "banks", ProvidentFundsOrPensionFundsMember: "pension", AlternativeInvestmentFundsMember: "aif",
  SovereignWealthFundsDomesticMember: "sovereign", InstitutionsDomesticMember: "domesticInst", NonResidentIndiansMember: "nri", BodiesCorporateMember: "corporates",
  ResidentIndividualShareholdersHoldingNominalShareCapitalUpToRsTwoLakhMember: "retailSmall", ResidentIndividualShareholdersHoldingNominalShareCapitalInExcessOfRsTwoLakhMember: "retailLarge",
  PublicShareholdingMember: "public", EmployeeBenefitsTrustsMember: "employeeTrusts", NonInstitutionsMember: "nonInstitutions",
};
const HOLDER_TYPE = [
  [/MutualFunds/i, "Mutual fund"], [/ForeignPortfolioInvestor|InstitutionsForeign|ForeignInstitution/i, "Foreign portfolio investor"], [/Insurance/i, "Insurance"],
  [/Banks/i, "Bank"], [/Pension|ProvidentFund/i, "Pension / provident fund"], [/AlternativeInvestment/i, "Alternative investment fund"], [/SovereignWealth/i, "Sovereign fund"],
  [/PAC_Public/i, "Public shareholder"], [/BodiesCorporate/i, "Corporate body"], [/OtherNonInstitutions/i, "Other"],
  [/IndividualsOrHUF|OthersIndianShareholders|NonResidentIndividualsOrForeignIndividuals|Promoter/i, "Promoter group"],
];
function parseShareholdingXbrl(xml) {
  if (!xml || typeof xml !== "string") return null;
  const C = contexts(xml), F = facts(xml);
  // filings state percentages either as fractions (0.2340) or as whole numbers
  // (23.40); the total-shareholding row (1 or 100) tells which
  const totalId = Object.entries(C).find(([, c]) => c.dims.length === 1 && c.dims[0].member === "ShareholdingPatternMember");
  const totalRaw = totalId ? F.find((x) => x.ctx === totalId[0] && x.tag === "ShareholdingAsAPercentageOfTotalNumberOfShares") : null;
  const scale = totalRaw && num(totalRaw.raw) > 1.5 ? 1 : 100;
  const pctOf = (ctx) => { const f = F.find((x) => x.ctx === ctx && x.tag === "ShareholdingAsAPercentageOfTotalNumberOfShares" && num(x.raw) != null); return f ? num(f.raw) * scale : null; };
  const sharesOf = (ctx) => { const f = F.find((x) => x.ctx === ctx && x.tag === "NumberOfShares" && num(x.raw) != null); return f ? num(f.raw) : null; };
  const cats = {};
  for (const [id, c] of Object.entries(C)) {
    if (c.dims.length !== 1 || c.dims[0].axis !== "CategoryOfShareholdersAxis") continue;
    const key = SHP_CAT[c.dims[0].member]; if (!key || cats[key] != null) continue;
    const p = pctOf(id); if (p != null) cats[key] = p;
  }
  if (cats.promoter == null && cats.public == null) return null;
  cats.retail = (cats.retailSmall || 0) + (cats.retailLarge || 0);
  cats.otherDomesticInst = cats.domesticInst != null ? Math.max(0, cats.domesticInst - (cats.mutualFunds || 0) - (cats.insurance || 0)) : null;
  cats.otherPublic = cats.public != null ? Math.max(0, cats.public - (cats.fpi || 0) - (cats.domesticInst || 0) - cats.retail) : null;
  const holders = F.filter((f) => f.tag === "NameOfTheShareholder" && f.raw).map((f) => {
    const t = HOLDER_TYPE.find(([re]) => re.test(f.ctx));
    // the name sits in a duration context "D_<id>"; its numbers in the instant context "<id>"
    const numCtx = f.ctx.replace(/^D_/, "");
    return { name: f.raw.replace(/\s+/g, " ").trim(), type: t ? t[1] : "Shareholder", pct: pctOf(numCtx) ?? pctOf(f.ctx), shares: sharesOf(numCtx) ?? sharesOf(f.ctx) };
  }).filter((h) => h.pct != null);
  return { categories: cats, holders };
}

module.exports = { parseResultsXbrl, parseShareholdingXbrl, fiscalQuarter };
