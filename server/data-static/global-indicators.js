/**
 * MERIDIAN — Global Economic Indicators (manually maintained).
 *
 * ── HOW TO UPDATE ──────────────────────────────────────────────────────────
 * This is the single source of truth for the GLOBAL INDICATORS panel. Edit the
 * numbers below whenever fresh prints land; each field carries its own "ref"
 * (the period the figure is for) so the UI shows provenance. No external API
 * is called for this panel — you control every value here.
 *
 * Per economy: name · gdp (%) + gdpRef · cpi (%) + cpiRef · unemp (%) + unempRef
 * Order = display order (first 8 render inline, all show in the popup).
 * Any value set to null renders as "—".
 * ───────────────────────────────────────────────────────────────────────────
 */
module.exports = {
  updatedLabel: "Manually maintained · latest official prints per economy (reference period shown on each figure).",
  economies: [
    { name: "United States",  gdp: 2.2, gdpRef: "2025",      cpi: 3.0,  cpiRef: "2025",      unemp: 4.2,  unempRef: "2025" },
    { name: "China",          gdp: 5.0, gdpRef: "2025",      cpi: 0.1,  cpiRef: "2025",      unemp: 5.0,  unempRef: "2025" },
    { name: "Germany",        gdp: 0.2, gdpRef: "2025",      cpi: 2.0,  cpiRef: "2025",      unemp: 3.7,  unempRef: "2025" },
    { name: "Japan",          gdp: 0.8, gdpRef: "2025",      cpi: 3.5,  cpiRef: "2025",      unemp: 2.5,  unempRef: "2025" },
    { name: "India",          gdp: 7.6, gdpRef: "FY2025/26", cpi: 2.1,  cpiRef: "FY2025/26", unemp: 4.2,  unempRef: "FY2025/26" },
    { name: "United Kingdom", gdp: 1.4, gdpRef: "2025",      cpi: 3.9,  cpiRef: "2025",      unemp: 4.8,  unempRef: "2025" },
    { name: "France",         gdp: 0.8, gdpRef: "2025",      cpi: 1.0,  cpiRef: "2025",      unemp: 7.4,  unempRef: "2025" },
    { name: "Italy",          gdp: 0.7, gdpRef: "2025",      cpi: 1.8,  cpiRef: "2025",      unemp: 6.5,  unempRef: "2025" },
    { name: "Canada",         gdp: 1.6, gdpRef: "2025",      cpi: 1.7,  cpiRef: "2025",      unemp: 7.1,  unempRef: "2025" },
    { name: "Brazil",         gdp: 2.3, gdpRef: "2025",      cpi: 5.0,  cpiRef: "2025",      unemp: 6.0,  unempRef: "2025" },
    { name: "Russia",         gdp: 1.8, gdpRef: "2025",      cpi: 9.4,  cpiRef: "2025",      unemp: 2.4,  unempRef: "2025" },
    { name: "South Korea",    gdp: 1.3, gdpRef: "2025",      cpi: 2.2,  cpiRef: "2025",      unemp: 2.8,  unempRef: "2025" },
    { name: "Australia",      gdp: 1.8, gdpRef: "2025",      cpi: 2.4,  cpiRef: "2025",      unemp: 4.1,  unempRef: "2025" },
    { name: "Spain",          gdp: 2.5, gdpRef: "2025",      cpi: 2.3,  cpiRef: "2025",      unemp: 10.8, unempRef: "2025" },
    { name: "Mexico",         gdp: 0.9, gdpRef: "2025",      cpi: 4.3,  cpiRef: "2025",      unemp: 2.6,  unempRef: "2025" },
    { name: "Türkiye",        gdp: 3.1, gdpRef: "2025",      cpi: 35.1, cpiRef: "2025",      unemp: 8.4,  unempRef: "2025" },
    { name: "Indonesia",      gdp: 5.0, gdpRef: "2025",      cpi: 2.2,  cpiRef: "2025",      unemp: 4.8,  unempRef: "2025" },
    { name: "Netherlands",    gdp: 1.4, gdpRef: "2025",      cpi: 3.1,  cpiRef: "2025",      unemp: 3.8,  unempRef: "2025" },
    { name: "Saudi Arabia",   gdp: 3.4, gdpRef: "2025",      cpi: 2.2,  cpiRef: "2025",      unemp: 3.5,  unempRef: "2025" },
    { name: "Switzerland",    gdp: 1.3, gdpRef: "2025",      cpi: 0.2,  cpiRef: "2025",      unemp: 2.9,  unempRef: "2025" },
    { name: "Poland",         gdp: 3.2, gdpRef: "2025",      cpi: 4.0,  cpiRef: "2025",      unemp: 3.3,  unempRef: "2025" },
    { name: "Belgium",        gdp: 1.1, gdpRef: "2025",      cpi: 2.5,  cpiRef: "2025",      unemp: 5.9,  unempRef: "2025" },
    { name: "Taiwan",         gdp: 5.4, gdpRef: "2025",      cpi: 1.8,  cpiRef: "2025",      unemp: 3.3,  unempRef: "2025" },
    { name: "Sweden",         gdp: 1.9, gdpRef: "2025",      cpi: 0.7,  cpiRef: "2025",      unemp: 8.5,  unempRef: "2025" },
    { name: "Ireland",        gdp: 2.5, gdpRef: "2025",      cpi: 1.7,  cpiRef: "2025",      unemp: 4.3,  unempRef: "2025" },
    { name: "Argentina",      gdp: 5.5, gdpRef: "2025",      cpi: 39.4, cpiRef: "2025",      unemp: 7.8,  unempRef: "2025" },
    { name: "Austria",        gdp: 0.6, gdpRef: "2025",      cpi: 2.8,  cpiRef: "2025",      unemp: 5.5,  unempRef: "2025" },
    { name: "Norway",         gdp: 1.6, gdpRef: "2025",      cpi: 2.9,  cpiRef: "2025",      unemp: 4.2,  unempRef: "2025" },
    { name: "Israel",         gdp: 3.5, gdpRef: "2025",      cpi: 3.1,  cpiRef: "2025",      unemp: 2.8,  unempRef: "2025" },
    { name: "Singapore",      gdp: 3.7, gdpRef: "2025",      cpi: 0.9,  cpiRef: "2025",      unemp: 2.1,  unempRef: "2025" },
  ],
};
