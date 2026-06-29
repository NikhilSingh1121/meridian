/** Narrative layer for reports & competitive positioning.
    With ANTHROPIC_API_KEY in .env → Claude writes qualitative sections around computed numbers.
    Without a key → deterministic rule-based commentary (analytics.ruleNarrative). */

const { ruleNarrative } = require("./analytics");

const hasKey = () => !!process.env.ANTHROPIC_API_KEY;

async function generateNarrative(pack, reportType) {
  // Always compute the deterministic multi-factor recommendation first.
  // This guarantees the recommendation can't be overridden by the AI — the AI
  // only writes the prose around the numbers and committee call.
  const baseline = ruleNarrative(pack);
  if (!hasKey()) return baseline;
  try {
    const prompt = `You are a senior sell-side equity analyst. Using ONLY the computed data below (do not invent any figures — reference only numbers present in the data), write the qualitative sections of a ${reportType} for ${pack.name} (${pack.symbol}).

DATA:
${JSON.stringify(pack, null, 1).slice(0, 14000)}

COMMITTEE DECISION (use exactly this recommendation — do not change it):
- Recommendation: ${baseline.recommendation}
- Composite score: ${baseline.compositeScore}/100
- Factor breakdown: ${JSON.stringify(baseline.factorBreakdown)}
- Blended upside: ${baseline.blendedUpside != null ? baseline.blendedUpside.toFixed(1) + "%" : "n/a"}

Respond with ONLY a JSON object (no markdown fences, no preamble) with exactly these keys:
{
 "execSummary": "150-220 word executive summary explaining why the composite framework concluded ${baseline.recommendation}",
 "thesis": "180-260 word investment thesis with 2-3 substantive pillars grounded in the actual numbers",
 "thesisPillars": [{"h":"2-4 word pillar name","p":"one-sentence supporting point"}],
 "valuation": "100-160 words explaining valuation — DCF vs market price context, why intrinsic value may diverge from market price for quality businesses, blended target derivation",
 "business": "100-140 words on the business model, unit economics and what the margin stack reveals",
 "management": "80-120 words on management quality, capital allocation and shareholder alignment",
 "competitive": "70-110 words on competitive positioning vs the peer set",
 "forensic": "70-110 words interpreting the earnings-quality / forensic scores",
 "variance": "90-130 words on what drove the latest year, grounded in the variance drivers",
 "industry": "90-130 words on industry context for this sector",
 "moat": "70-110 words assessing competitive moat",
 "swot": {"strengths":["...","..."],"weaknesses":["..."],"opportunities":["..."],"threats":["..."]},
 "porter": {"rivalry":"one line","newEntrants":"one line","substitutes":"one line","buyerPower":"one line","supplierPower":"one line"},
 "risks": ["4-6 specific, evidence-grounded risks"],
 "catalysts": ["3-5 specific catalysts"],
 "recRationale": "3 sentences explaining the multi-factor framework conclusion — reference the composite score and the strongest/weakest factors"
}`;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
        max_tokens: 2500,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}`);
    const data = await res.json();
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    // Merge AI prose with the deterministic recommendation. The recommendation, composite score,
    // and factor breakdown are LOCKED to the deterministic output — the AI only fills in qualitative prose.
    return {
      mode: "ai",
      ...parsed,
      recommendation: baseline.recommendation,
      recommendationLabel: baseline.recommendationLabel,
      compositeScore: baseline.compositeScore,
      factorBreakdown: baseline.factorBreakdown,
      blendedUpside: baseline.blendedUpside,
      dcfUpside: baseline.dcfUpside,
      streetUpside: baseline.streetUpside,
    };
  } catch (e) {
    const fb = baseline;
    fb.note = `AI narrative unavailable (${String(e.message || e).slice(0, 60)}) — deterministic commentary shown.`;
    return fb;
  }
}

module.exports = { generateNarrative, hasKey };
