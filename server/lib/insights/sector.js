/**
 * Sector profile — decides WHAT to research and analyse before any model call.
 * Matched on the deterministic sector / industry strings (Yahoo taxonomy), so
 * a bank is researched on NIM and asset quality, an IT services firm on
 * constant-currency growth and deal wins, a staples company on volume/price/mix.
 */

const PROFILES = [
  {
    key: "bank", match: /bank|credit services|mortgage|thrift/i,
    model: "lender — earns net interest income on its loan book plus fee income",
    kpis: ["loan growth", "deposit growth", "CASA ratio", "net interest margin (NIM)", "credit cost", "GNPA / NNPA", "provision coverage", "capital adequacy (CET1/CRAR)", "RoA / RoE", "cost-to-income"],
    drivers: ["rate cycle and deposit repricing", "systemic credit growth", "asset-quality cycle", "regulatory actions (central bank)", "unsecured lending stress"],
    risks: ["asset quality", "deposit competition / funding cost", "regulatory", "capital adequacy", "concentration"],
  },
  {
    key: "insurance_nbfc", match: /insurance|asset management|capital markets|financial data|financial conglomerates|nbfc|consumer finance/i,
    model: "financial services — earnings driven by AUM / book growth, spreads or underwriting and operating leverage",
    kpis: ["AUM / premium growth", "spread or yield", "cost ratio", "credit cost or combined ratio", "RoA / RoE", "capital position"],
    drivers: ["financialisation of savings", "rate cycle", "regulatory changes", "competitive pricing"],
    risks: ["asset quality / claims", "regulatory", "funding", "market-linked volatility"],
  },
  {
    key: "it_services", match: /information technology services|software|it services|internet|computer/i,
    model: "technology services — revenue from client contracts; margins from utilisation, pricing, pyramid and currency",
    kpis: ["constant-currency revenue growth", "deal wins / TCV", "EBIT margin", "utilisation", "attrition", "headcount", "vertical mix (BFSI, retail…)", "geography mix", "top-client concentration", "AI / GenAI revenue exposure"],
    drivers: ["client discretionary spend", "US/Europe macro", "GenAI adoption and pricing deflation", "currency", "vendor consolidation"],
    risks: ["demand slowdown", "pricing pressure", "currency", "talent cost", "client concentration"],
  },
  {
    key: "consumer", match: /household|personal products|packaged foods|beverages|confectioner|tobacco|food|consumer defensive|farm products|grocery|discount stores|apparel|footwear|leisure|restaurants|retail/i,
    model: "branded consumer — growth from volume, price and mix; margins from input costs, pricing power and brand/A&P spend",
    kpis: ["volume growth", "price / mix", "gross margin", "A&P spend", "EBITDA margin", "market share", "category / segment growth", "rural vs urban demand", "channel mix (general trade, modern trade, e-commerce, quick commerce)", "international growth"],
    drivers: ["input / commodity costs", "rural and urban consumption", "premiumisation or down-trading", "distribution and quick-commerce shift", "competitive intensity from D2C and regional brands"],
    risks: ["input-cost inflation", "demand slowdown", "competition", "channel disruption", "international / currency", "acquisition integration"],
  },
  {
    key: "pharma_health", match: /drug|pharma|biotech|medical|health|diagnostic|hospital/i,
    model: "healthcare — growth from product launches, market share and pricing; margins from mix, R&D and regulatory compliance",
    kpis: ["domestic formulations growth", "US generics / specialty sales", "new launches / ANDA approvals", "R&D % of sales", "EBITDA margin", "price erosion", "USFDA inspection status"],
    drivers: ["US generic price erosion", "regulatory (USFDA, NPPA)", "chronic vs acute mix", "patent cliffs / biosimilars"],
    risks: ["regulatory / compliance", "price erosion", "concentration in key products", "litigation"],
  },
  {
    key: "industrial", match: /industrial|machinery|engineering|construction|electrical|aerospace|defen[cs]e|infrastructure|capital goods|conglomerate|building products|railroads|airlines|trucking|marine|logistics|integrated freight/i,
    model: "industrial — revenue from order execution; margins from pricing, commodity pass-through and operating leverage",
    kpis: ["order inflow", "order book / book-to-bill", "execution rate", "EBITDA margin", "commodity pass-through", "working capital days", "capacity utilisation", "capex plans"],
    drivers: ["public and private capex cycle", "commodity prices", "government spending", "export demand"],
    risks: ["execution delays", "commodity costs", "working capital stretch", "order-inflow slowdown"],
  },
  {
    key: "materials_energy", match: /steel|metal|mining|aluminium|aluminum|copper|chemicals|cement|paper|oil|gas|energy|coal|refin|utilities|power|renewable/i,
    model: "materials / energy — earnings driven by volumes, realisations / spreads and input costs over the commodity cycle",
    kpis: ["volumes", "realisation / spread per unit", "EBITDA per tonne or unit", "capacity and utilisation", "input costs", "net debt / EBITDA", "capex pipeline"],
    drivers: ["commodity price cycle", "demand from end-markets", "capacity additions", "regulation and duties"],
    risks: ["commodity price volatility", "leverage", "regulatory / environmental", "capacity overbuild"],
  },
  {
    key: "auto", match: /auto|vehicle|tyre|tire/i,
    model: "automotive — volumes, mix, pricing and commodity costs drive margins",
    kpis: ["volume growth by segment", "market share", "realisation per unit", "EBITDA margin", "EV mix", "exports", "inventory levels"],
    drivers: ["demand cycle", "commodity costs", "EV transition", "regulation (emissions, safety)"],
    risks: ["demand slowdown", "commodity costs", "EV disruption", "competition"],
  },
  {
    key: "realestate_telecom", match: /real estate|reit|telecom|communication services|media|entertainment/i,
    model: "asset-heavy / subscription business — growth from pricing (ARPU / realisations) and volumes; returns shaped by capex",
    kpis: ["pre-sales / ARPU", "subscriber or volume growth", "EBITDA margin", "capex", "net debt"],
    drivers: ["pricing actions", "regulation", "competitive intensity", "interest rates"],
    risks: ["leverage", "regulatory", "competition", "execution"],
  },
];
const DEFAULT = {
  key: "general", model: "operating company — growth, margins and capital efficiency drive value",
  kpis: ["revenue growth", "volume vs price", "gross and EBITDA margin", "cash conversion", "capex", "market share"],
  drivers: ["end-market demand", "input costs", "competition", "regulation"],
  risks: ["demand", "costs", "competition", "execution", "regulatory"],
};

function sectorProfile(sector, industry) {
  const s = `${industry || ""} | ${sector || ""}`;
  // industry string is more specific than sector — test it first
  return PROFILES.find((p) => p.match.test(industry || "")) || PROFILES.find((p) => p.match.test(s)) || DEFAULT;
}

module.exports = { sectorProfile };
