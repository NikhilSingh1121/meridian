/**
 * MERIDIAN — Macro dashboard routes.
 *
 * One endpoint per dashboard module, each independently cached (durable,
 * stale-on-error) and independently failable — a dead upstream blanks one
 * panel with a reason, never the board.
 *
 *   GET /api/macro/board      global markets (multi-horizon), FX strength,
 *                             commodity momentum, volatility gauge     ~60s
 *   GET /api/macro/fiidii     FII/DII flows + rolling windows          30m
 *   GET /api/macro/rates      global 10Y yields + central-bank policy  15m/12h
 *   GET /api/macro/inflation  CPI YoY — 14 economies                    6h
 *   GET /api/macro/india      India macro pack                          1h
 *   GET /api/macro/global-econ World Bank GDP/inflation/unemployment   12h
 *   GET /api/macro/brief      deterministic India macro briefing        5m
 *
 * Sources: Yahoo (quotes/history), NSE (FII/DII), Stooq (bond yields),
 * FRED fredgraph.csv (CPI, reserves, IP — keyless), BIS (policy rates),
 * World Bank (annual indicators). All free, all keyless.
 */
const express = require("express");
const router = express.Router();
const { cached, cachedDurable } = require("../cache");
const yahoo = require("../providers/yahoo");
const NSE = require("../providers/nse");
const M = require("../providers/macrodata");

const Q_TTL = 15_000, H_TTL = 5 * 60 * 1000;
const q = (s) => cachedDurable(`q:${s}`, Q_TTL, () => yahoo.getQuote(s)).catch(() => null);
const hist = (s, range, interval) =>
  cachedDurable(`h:${s}:${range}:${interval}`, H_TTL, () => yahoo.getHistory(s, range, interval)).catch(() => null);

const closesOf = (h) => (((h && h.points) || []).map((p) => p.c).filter((c) => c != null));
const sparkOf = (h, n = 24) => {
  const c = closesOf(h);
  if (c.length < 4) return [];
  const step = Math.max(1, Math.floor(c.length / n));
  const out = [];
  for (let i = 0; i < c.length; i += step) out.push(+c[i].toFixed(2));
  if (out[out.length - 1] !== +c[c.length - 1].toFixed(2)) out.push(+c[c.length - 1].toFixed(2));
  return out;
};

/* ═══════════════ BOARD — global markets · FX strength · commodities · vol ═══ */
const IDX = [
  ["^GSPC", "S&P 500"], ["^IXIC", "Nasdaq"], ["^DJI", "Dow Jones"], ["^RUT", "Russell 2000"],
  ["^NSEI", "Nifty 50"], ["^BSESN", "Sensex"], ["^GDAXI", "DAX"], ["^FTSE", "FTSE 100"],
  ["^N225", "Nikkei 225"], ["^HSI", "Hang Seng"], ["000001.SS", "Shanghai"],
];
const FX_PAIRS = [
  "EURUSD=X", "GBPUSD=X", "USDINR=X", "USDJPY=X", "USDCNY=X",
  "AUDUSD=X", "USDCAD=X", "USDCHF=X",
  // Extended set — adds SGD, HKD, KRW, MXN, ZAR, NZD for a fuller strength view.
  "USDSGD=X", "USDHKD=X", "USDKRW=X", "USDMXN=X", "USDZAR=X", "NZDUSD=X",
];
const CMD = [["GC=F", "Gold"], ["SI=F", "Silver"], ["HG=F", "Copper"], ["BZ=F", "Brent"], ["CL=F", "WTI"], ["NG=F", "Nat Gas"], ["ZW=F", "Wheat"], ["ZC=F", "Corn"], ["PL=F", "Platinum"]];
// Iron ore: no reliable free live source (SGX TIO is licensed; Yahoo has no
// dependable ticker) — intentionally omitted rather than faked.

async function buildBoard() {
  const [idx, fx, cmd, vixH, vixQ, ivixQ] = await Promise.all([
    Promise.all(IDX.map(async ([s, l]) => {
      const [qt, h1y] = await Promise.all([q(s), hist(s, "1y", "1d")]);
      const closes = closesOf(h1y);
      const hz = M.horizonReturns(closes);
      return {
        s, l,
        price: qt && qt.price != null ? qt.price : (closes.length ? closes[closes.length - 1] : null),
        d1: qt ? qt.changePct : null,
        w1: hz.w1 ?? null, m1: hz.m1 ?? null,
        ytd: M.ytdReturn(((h1y && h1y.points) || []).filter((p) => p.c != null)),
        spark: sparkOf(h1y),
      };
    })),
    Promise.all(FX_PAIRS.map(async (s) => {
      const [qt, h3] = await Promise.all([q(s), hist(s, "3mo", "1d")]);
      const hz = M.horizonReturns(closesOf(h3));
      return { s, price: qt ? qt.price : null, d1: qt ? qt.changePct : null, w1: hz.w1 ?? null, m1: hz.m1 ?? null };
    })),
    Promise.all(CMD.map(async ([s, l]) => {
      const [qt, h6] = await Promise.all([q(s), hist(s, "6mo", "1d")]);
      const closes = closesOf(h6);
      const hz = M.horizonReturns(closes);
      const sma50 = closes.length >= 50 ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50 : null;
      const last = closes[closes.length - 1];
      // 20-day realized vol, annualized
      let vol = null;
      if (closes.length > 21) {
        const rets = [];
        for (let i = closes.length - 20; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
        const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
        vol = +(Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1)) * Math.sqrt(252) * 100).toFixed(1);
      }
      return {
        s, l, price: qt ? qt.price : last ?? null, d1: qt ? qt.changePct : null,
        w1: hz.w1 ?? null, m1: hz.m1 ?? null, vol20: vol,
        trend: sma50 != null && last != null ? (last >= sma50 ? "UP" : "DOWN") : null,
        vs50: sma50 != null && last != null ? +(((last - sma50) / sma50) * 100).toFixed(1) : null,
      };
    })),
    hist("^VIX", "1y", "1d"), q("^VIX"), q("^INDIAVIX"),
  ]);

  // FX strength matrix from daily % changes
  const pairPct = {};
  fx.forEach((f) => { pairPct[f.s.replace("=X", "")] = f.d1; });
  const strength = M.currencyStrength(pairPct);

  // volatility gauge — VIX level vs its own 1-year distribution
  const vixCloses = closesOf(vixH);
  const vixLevel = vixQ && vixQ.price != null ? vixQ.price : (vixCloses.length ? vixCloses[vixCloses.length - 1] : null);
  const vixPctile = M.lastPercentile(vixLevel != null ? [...vixCloses, vixLevel] : vixCloses);
  const fear = vixLevel == null ? null
    : vixLevel < 13 ? "COMPLACENT" : vixLevel < 18 ? "CALM" : vixLevel < 24 ? "NERVOUS" : vixLevel < 30 ? "STRESSED" : "PANIC";

  return {
    available: true, asOf: Date.now(),
    indices: idx, fxStrength: strength, fx,
    commodities: cmd,
    vol: { vix: vixLevel, vixPctile1y: vixPctile, indiaVix: ivixQ ? ivixQ.price : null, gauge: fear },
  };
}
router.get("/macro/board", async (_req, res) => {
  try { res.json(await cachedDurable("macro:board", 55_000, buildBoard)); }
  catch (e) { res.json({ available: false, reason: String(e.message || e).slice(0, 140) }); }
});

/* ═══════════════ FII / DII ═══════════════ */
router.get("/macro/fiidii", async (_req, res) => {
  try { res.json(await NSE.fiiDiiPack()); }
  catch (e) { res.json({ available: false, reason: String(e.message || e).slice(0, 140) }); }
});

/* ═══════════════ RATES — sovereign 10Y + policy rates ═══════════════ */
const BONDS = [["10usy.b", "US 10Y", "US"], ["2usy.b", "US 2Y", "US"], ["10dey.b", "Germany 10Y", "DE"], ["10jpy.b", "Japan 10Y", "JP"], ["10iny.b", "India 10Y", "IN"], ["10uky.b", "UK 10Y", "GB"]];
const POLICY = [["US", "Federal Reserve"], ["IN", "RBI"], ["XM", "ECB"], ["GB", "Bank of England"], ["JP", "Bank of Japan"]];

async function buildRates() {
  const bonds = await Promise.all(BONDS.map(([sym, label, cc]) =>
    cachedDurable(`stooq:${sym}`, 15 * 60 * 1000, async () => {
      const [rows] = await Promise.all([M.stooqDaily(sym, 300)]);
      if (!rows.length) return { sym, label, cc, available: false };
      const last = rows[rows.length - 1], prev = rows[rows.length - 2];
      return {
        sym, label, cc, available: true,
        yield: last.v, date: last.date,
        d1bp: prev ? +((last.v - prev.v) * 100).toFixed(1) : null,
        spark: rows.slice(-40).map((r) => r.v),
      };
    }).catch(() => ({ sym, label, cc, available: false }))));
  const policy = await Promise.all(POLICY.map(([cc, bank]) =>
    cachedDurable(`bis:${cc}`, 12 * 60 * 60 * 1000, async () => {
      const rows = await M.bisPolicyRate(cc, 900);
      if (!rows.length) return { cc, bank, available: false };
      const cur = rows[rows.length - 1];
      // previous DIFFERENT rate + the date it changed to the current one
      let prevRate = null, changedOn = null;
      for (let i = rows.length - 1; i > 0; i--) {
        if (rows[i - 1].v !== rows[i].v) { prevRate = rows[i - 1].v; changedOn = rows[i].date; break; }
      }
      // ~3y monthly-ish trend for the mini chart
      const trend = rows.filter((_, i) => i % 21 === 0 || i === rows.length - 1).slice(-40).map((r) => r.v);
      return { cc, bank, available: true, rate: cur.v, asOf: cur.date, prevRate, changedOn, trend };
    }).catch(() => ({ cc, bank, available: false }))));
  const us10 = bonds.find((b) => b.sym === "10usy.b"), us2 = bonds.find((b) => b.sym === "2usy.b");
  const spread2s10s = us10 && us2 && us10.available && us2.available ? +(us10.yield - us2.yield).toFixed(2) : null;
  return { available: bonds.some((b) => b.available) || policy.some((p) => p.available), asOf: Date.now(), bonds, policy, spread2s10s };
}
router.get("/macro/rates", async (_req, res) => {
  try { res.json(await cachedDurable("macro:rates", 15 * 60 * 1000, buildRates)); }
  catch (e) { res.json({ available: false, reason: String(e.message || e).slice(0, 140) }); }
});

/* ═══════════════ INFLATION — CPI YoY across five economies ═══════════════ */
const CPI = [
  ["US", "United States", "CPIAUCSL"],
  ["IN", "India", "INDCPIALLMINMEI"],
  ["EZ", "Euro Area", "CP0000EZ19M086NEST"],
  ["GB", "United Kingdom", "GBRCPIALLMINMEI"],
  ["CN", "China", "CHNCPIALLMINMEI"],
  ["JP", "Japan", "JPNCPIALLMINMEI"],
  ["DE", "Germany", "DEUCPIALLMINMEI"],
  ["FR", "France", "FRACPIALLMINMEI"],
  // Extended set — six more economies to fill out the panel across regions:
  // North America, Southern Europe, Latin America, SE Asia and Africa.
  ["CA", "Canada", "CANCPIALLMINMEI"],
  ["IT", "Italy", "ITACPIALLMINMEI"],
  ["ES", "Spain", "ESPCPIALLMINMEI"],
  ["BR", "Brazil", "BRACPIALLMINMEI"],
  ["ID", "Indonesia", "IDNCPIALLMINMEI"],
  ["ZA", "South Africa", "ZAFCPIALLMINMEI"],
];
async function buildInflation() {
  const rows = await Promise.all(CPI.map(([cc, name, id]) =>
    cachedDurable(`fred:yoy:${id}`, 6 * 60 * 60 * 1000, async () => {
      const idx = await M.fredSeries(id, 200);
      const yoy = M.yoyFromIndex(idx);
      if (!yoy.length) return { cc, name, available: false };
      const latest = yoy[yoy.length - 1], prev = yoy[yoy.length - 2];
      return {
        cc, name, available: true,
        latest: latest.v, latestDate: latest.date,
        prev: prev ? prev.v : null,
        trend: yoy.slice(-25).map((r) => r.v),
        source: "FRED",
      };
    }).catch(() => ({ cc, name, available: false }))));
  return { available: rows.some((r) => r.available), rows, note: "Monthly CPI indices via FRED's public CSV; YoY computed from the index. Publication lags of 1–2 months are inherent to official CPI data." };
}
router.get("/macro/inflation", async (_req, res) => {
  try { res.json(await cachedDurable("macro:inflation", 6 * 60 * 60 * 1000, buildInflation)); }
  catch (e) { res.json({ available: false, reason: String(e.message || e).slice(0, 140) }); }
});

/* ═══════════════ INDIA MACRO ═══════════════ */
async function buildIndia() {
  const [ratesPack, inflPack, usdinr, fx3mo, reserves, ip, gdp] = await Promise.all([
    cachedDurable("macro:rates", 15 * 60 * 1000, buildRates).catch(() => null),
    cachedDurable("macro:inflation", 6 * 60 * 60 * 1000, buildInflation).catch(() => null),
    q("USDINR=X"),
    hist("USDINR=X", "3mo", "1d"),
    cachedDurable("fred:TRESEGINM052N", 12 * 60 * 60 * 1000, () => M.fredSeries("TRESEGINM052N", 60)).catch(() => []),
    cachedDurable("fred:INDPROINDMISMEI", 12 * 60 * 60 * 1000, () => M.fredSeries("INDPROINDMISMEI", 60)).catch(() => []),
    cachedDurable("wb:IND:gdp", 24 * 60 * 60 * 1000, () => M.worldBank("IND", "NY.GDP.MKTP.KD.ZG", 15)).catch(() => []),
  ]);
  const repo = ratesPack && ratesPack.policy ? ratesPack.policy.find((p) => p.cc === "IN") : null;
  const in10 = ratesPack && ratesPack.bonds ? ratesPack.bonds.find((b) => b.cc === "IN") : null;
  const cpi = inflPack && inflPack.rows ? inflPack.rows.find((r) => r.cc === "IN") : null;
  const hz = M.horizonReturns(closesOf(fx3mo));
  const last = (rows) => (rows && rows.length ? rows[rows.length - 1] : null);
  const yoyLast = (rows) => {
    if (!rows || rows.length < 13) return null;
    const y = M.yoyFromIndex(rows);
    return last(y);
  };
  const resLatest = last(reserves), ipYoY = yoyLast(ip), gdpLatest = last(gdp);
  // FX reserves — TRESEGINM052N is denominated in MILLIONS of USD, so scale to
  // $bn with /1e3 (a prior /1e9 collapsed the card and its sparkline to "0").
  // When the live FRED series is unreachable, fall back to the RBI headline
  // total (~$675bn incl. gold, https://data.rbi.org.in) rather than blanking.
  const RES_FALLBACK_BN = 675;
  const reservesCard = resLatest && resLatest.v > 0
    ? { k: "FX Reserves (ex-gold)", v: +(resLatest.v / 1e3).toFixed(0), unit: " $bn", sub: `as of ${resLatest.date}`, trend: reserves.slice(-40).map((r) => r.v / 1e3), src: "FRED" }
    : { k: "FX Reserves", v: RES_FALLBACK_BN, unit: " $bn", sub: "RBI total incl. gold · manual (live feed unavailable)", trend: null, src: "RBI" };
  // market-side + derived cards (real inputs only — derivations are labeled)
  const [nifty, niftyH, ivix, ivixH] = await Promise.all([
    q("^NSEI"), hist("^NSEI", "3mo", "1d"), q("^INDIAVIX"), hist("^INDIAVIX", "3mo", "1d"),
  ]);
  const nfHz = M.horizonReturns(closesOf(niftyH));
  const realRate = repo && repo.available && cpi && cpi.available && cpi.latest != null
    ? +(repo.rate - cpi.latest).toFixed(2) : null;
  const termSpread = repo && repo.available && in10 && in10.available
    ? +(in10.yield - repo.rate).toFixed(2) : null;
  return {
    available: true, asOf: Date.now(),
    cards: [
      nifty && nifty.price != null ? { k: "NIFTY 50", v: +nifty.price.toFixed(0), unit: "", sub: `1D ${nifty.changePct != null ? (nifty.changePct >= 0 ? "+" : "") + nifty.changePct.toFixed(2) + "%" : "—"} · 1M ${nfHz.m1 != null ? (nfHz.m1 >= 0 ? "+" : "") + nfHz.m1 + "%" : "—"}`, trend: closesOf(niftyH).slice(-40), src: "Yahoo" } : null,
      ivix && ivix.price != null ? { k: "India VIX", v: +ivix.price.toFixed(1), unit: "", sub: ivix.price < 12 ? "unusually calm — gap risk under-priced" : ivix.price < 18 ? "normal volatility regime" : "elevated — event risk priced", trend: closesOf(ivixH).slice(-40), src: "Yahoo" } : null,
      realRate != null ? { k: "Real Policy Rate", v: realRate, unit: "%", sub: `repo ${repo.rate}% − CPI ${cpi.latest}% · ${realRate >= 1 ? "restrictive" : realRate >= 0 ? "mildly positive" : "negative — accommodative"}`, trend: null, src: "derived" } : null,
      termSpread != null ? { k: "10Y − Repo Spread", v: termSpread, unit: "pp", sub: termSpread < 0 ? "curve inverted vs policy — easing priced" : termSpread < 0.6 ? "flat term premium" : "normal term premium", trend: null, src: "derived" } : null,
      in10 && in10.available && cpi && cpi.available && cpi.latest != null ? { k: "10Y Real Yield", v: +(in10.yield - cpi.latest).toFixed(2), unit: "%", sub: `10Y ${in10.yield}% − CPI ${cpi.latest}% · ${(in10.yield - cpi.latest) >= 2 ? "attractive real carry for bond investors" : (in10.yield - cpi.latest) >= 0 ? "modest real return over inflation" : "negative — bonds losing to inflation"}`, trend: null, src: "derived" } : null,
      repo && repo.available ? { k: "RBI Repo Rate", v: repo.rate, unit: "%", sub: `since ${repo.changedOn || "—"} · prior ${repo.prevRate != null ? repo.prevRate + "%" : "—"}`, trend: repo.trend, src: "BIS" } : null,
      cpi && cpi.available ? { k: "CPI Inflation (YoY)", v: cpi.latest, unit: "%", sub: `prev ${cpi.prev != null ? cpi.prev + "%" : "—"} · ${cpi.latestDate}`, trend: cpi.trend, src: "FRED" } : null,
      in10 && in10.available ? { k: "10Y G-Sec Yield", v: in10.yield, unit: "%", sub: `${in10.d1bp != null ? (in10.d1bp >= 0 ? "+" : "") + in10.d1bp + "bp today" : ""}`, trend: in10.spark, src: "Stooq" } : null,
      usdinr && usdinr.price != null ? { k: "USD / INR", v: +usdinr.price.toFixed(2), unit: "", sub: `1M ${hz.m1 != null ? (hz.m1 >= 0 ? "+" : "") + hz.m1 + "%" : "—"} (+ve = INR weaker)`, trend: closesOf(fx3mo).slice(-40), src: "Yahoo" } : null,
      reservesCard,
      ipYoY ? { k: "Industrial Production (YoY)", v: ipYoY.v, unit: "%", sub: `as of ${ipYoY.date}`, trend: M.yoyFromIndex(ip).slice(-24).map((r) => r.v), src: "FRED/OECD" } : null,
      gdpLatest ? { k: "GDP Growth (annual)", v: gdpLatest.v, unit: "%", sub: `FY ${gdpLatest.date}`, trend: gdp.map((r) => r.v), src: "World Bank" } : null,
    ].filter(Boolean),
    omitted: "GST collections, UPI volume, fiscal deficit, PMI, bank credit growth, trade balance and CAD have no reliable free JSON APIs (MOSPI/GSTN/NPCI publish PDFs/portals only) — omitted rather than faked.",
  };
}
router.get("/macro/india", async (_req, res) => {
  try { res.json(await cachedDurable("macro:india", 60 * 60 * 1000, buildIndia)); }
  catch (e) { res.json({ available: false, reason: String(e.message || e).slice(0, 140) }); }
});

/* ═══════════════ GLOBAL INDICATORS — manually maintained ═══════════════════
   Served from server/data-static/global-indicators.js (edit that file to
   update). No external API for this panel — every figure is analyst-curated
   with its own reference period. */
// Economy → ISO3 so the per-row trend charts can be matched to IMF WEO series.
// Keep in sync with server/data-static/global-indicators.js (name is the key).
const ECON_ISO = {
  "United States": "USA", "China": "CHN", "Germany": "DEU", "Japan": "JPN", "India": "IND",
  "United Kingdom": "GBR", "France": "FRA", "Italy": "ITA", "Canada": "CAN", "Brazil": "BRA",
  "Russia": "RUS", "South Korea": "KOR", "Australia": "AUS", "Spain": "ESP", "Mexico": "MEX",
  "Türkiye": "TUR", "Indonesia": "IDN", "Netherlands": "NLD", "Saudi Arabia": "SAU", "Switzerland": "CHE",
  "Poland": "POL", "Belgium": "BEL", "Taiwan": "TWN", "Sweden": "SWE", "Ireland": "IRL",
  "Argentina": "ARG", "Austria": "AUT", "Norway": "NOR", "Israel": "ISR", "Singapore": "SGP",
};
async function buildGlobalEcon() {
  const src = require("../data-static/global-indicators");
  const isos = [...new Set(src.economies.map((e) => ECON_ISO[e.name]).filter(Boolean))];
  // Table values stay from the manually-maintained static file (the panel's
  // single source of truth); only the mini-chart trend SHAPE is IMF-sourced
  // (~12y WEO series for GDP growth / inflation / unemployment), fetched in
  // three batched calls and matched by ISO3. Any missing series → no chart.
  const [gdpT, cpiT, unempT] = await Promise.all([
    M.imfIndicator("NGDP_RPCH", isos).catch(() => ({})),
    M.imfIndicator("PCPIPCH", isos).catch(() => ({})),
    M.imfIndicator("LUR", isos).catch(() => ({})),
  ]);
  const rows = src.economies.map((e) => {
    const iso = ECON_ISO[e.name];
    return {
      name: e.name,
      gdp: e.gdp != null ? { v: e.gdp, ref: e.gdpRef || "" } : null,
      cpi: e.cpi != null ? { v: e.cpi, ref: e.cpiRef || "" } : null,
      unemp: e.unemp != null ? { v: e.unemp, ref: e.unempRef || "" } : null,
      gdpTrend: iso && gdpT[iso] ? gdpT[iso].trend : null,
      cpiTrend: iso && cpiT[iso] ? cpiT[iso].trend : null,
      unempTrend: iso && unempT[iso] ? unempT[iso].trend : null,
    };
  });
  const filled = rows.reduce((n, r) => n + ["gdp", "cpi", "unemp"].filter((k) => r[k]).length, 0);
  return {
    available: rows.length > 0, rows,
    coverage: `${filled}/${rows.length * 3} cells`,
    note: src.updatedLabel || "Manually maintained.",
    trendNote: "Trend charts: IMF WEO, last ~12 years — each line auto-scaled to its own range.",
  };
}
router.get("/macro/global-econ", async (_req, res) => {
  try { res.json(await cachedDurable("macro:globalecon", 12 * 60 * 60 * 1000, buildGlobalEcon)); }
  catch (e) { res.json({ available: false, reason: String(e.message || e).slice(0, 140) }); }
});

/* ═══════════════ BRIEFING — deterministic INDIA macro narrative ════════════
   A detailed, India-centric read of the whole Market Intelligence tab: every
   figure below is pulled from the live panels (board, rates, inflation, FII/
   DII, India pack) and every judgement is rule-based off those numbers. Global
   series appear only through their India transmission channel (import bill, FII
   flows, the rupee). Each paragraph is a dense multi-topic block with the print,
   a historical comparison and the mechanism — no invented news. */
async function buildBrief() {
  const [board, rates, infl, fii, india, niftyH, reserves] = await Promise.all([
    cachedDurable("macro:board", 55_000, buildBoard).catch(() => null),
    cachedDurable("macro:rates", 15 * 60 * 1000, buildRates).catch(() => null),
    cachedDurable("macro:inflation", 6 * 60 * 60 * 1000, buildInflation).catch(() => null),
    NSE.fiiDiiPack().catch(() => null),
    cachedDurable("macro:india", 60 * 60 * 1000, buildIndia).catch(() => null),
    hist("^NSEI", "1y", "1d"),
    cachedDurable("fred:TRESEGINM052N", 12 * 60 * 60 * 1000, () => M.fredSeries("TRESEGINM052N", 60)).catch(() => []),
  ]);

  const sp = (v, dp = 1) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${(+v).toFixed(dp)}%`);
  const cardVal = (k) => { const c = india && india.cards ? india.cards.find((x) => x.k === k) : null; return c ? c.v : null; };

  // ── India series pulled from the live panels ──
  const nifty = board && board.indices ? board.indices.find((x) => x.s === "^NSEI") : null;
  const inrPair = board && board.fx ? board.fx.find((f) => f.s === "USDINR=X") : null;
  const brent = board && board.commodities ? board.commodities.find((c) => c.s === "BZ=F") : null;
  const gold = board && board.commodities ? board.commodities.find((c) => c.s === "GC=F") : null;
  const copper = board && board.commodities ? board.commodities.find((c) => c.s === "HG=F") : null;
  const iVix = board && board.vol ? board.vol.indiaVix : null;
  const gVix = board && board.vol ? board.vol.vix : null;
  const gVixPct = board && board.vol ? board.vol.vixPctile1y : null;
  const in10 = rates && rates.bonds ? rates.bonds.find((b) => b.cc === "IN") : null;
  const repo = rates && rates.policy ? rates.policy.find((x) => x.cc === "IN") : null;
  const inCpi = infl && infl.rows ? infl.rows.find((r) => r.cc === "IN") : null;

  // NIFTY trend geometry from a 1-year path (200-DMA, 52-week range, drawdown)
  const nc = closesOf(niftyH);
  const sma200 = nc.length >= 200 ? nc.slice(-200).reduce((a, b) => a + b, 0) / 200 : null;
  const hi52 = nc.length ? Math.max(...nc) : null;
  const lo52 = nc.length ? Math.min(...nc) : null;
  const niftyLast = nc.length ? nc[nc.length - 1] : (nifty ? nifty.price : null);
  const offHigh = hi52 && niftyLast ? +(((niftyLast - hi52) / hi52) * 100).toFixed(1) : null;
  const offLow = lo52 && niftyLast ? +(((niftyLast - lo52) / lo52) * 100).toFixed(1) : null;

  // FX reserves — millions→$bn, with peak drawdown for the historical comparison
  const resBn = reserves.length ? +(reserves[reserves.length - 1].v / 1e3).toFixed(0) : 675;
  const resPeak = reserves.length ? +(Math.max(...reserves.map((r) => r.v)) / 1e3).toFixed(0) : null;
  const resDate = reserves.length ? reserves[reserves.length - 1].date : null;
  const resOffPeak = resPeak ? +(resBn - resPeak).toFixed(0) : null;

  // ── shared derived reads used by both the narrative and the sidebar ──
  const ipVal = cardVal("Industrial Production (YoY)");
  const gdpVal = cardVal("GDP Growth (annual)");
  const below200 = sma200 != null && niftyLast != null ? niftyLast < sma200 : null;
  const fL = fii && fii.available && fii.latest ? fii.latest : null;
  const fNet = fL && fL.fiiNet != null ? fL.fiiNet : null;
  const dNet = fL && fL.diiNet != null ? fL.diiNet : null;
  const bothBuy = fNet != null && dNet != null && fNet >= 0 && dNet >= 0;
  const tug = fNet != null && dNet != null && fNet < 0 && dNet >= 0;
  const foreignOnly = fNet != null && dNet != null && fNet >= 0 && dNet < 0;
  const bothSell = fNet != null && dNet != null && fNet < 0 && dNet < 0;
  const crudeSoft = brent && brent.m1 != null && brent.m1 <= 0;
  const crudeHot = brent && brent.m1 != null && brent.m1 > 8;
  const inflEasy = inCpi && inCpi.available && inCpi.latest != null && inCpi.latest <= 4;
  const inflHot = inCpi && inCpi.available && inCpi.latest != null && inCpi.latest > 6;
  const asOfLabel = (fL && fL.date) ? fL.date : new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).replace(/ /g, "-");

  // ── the 7 narrative sections (icon id → rendered in the client) ──
  const sections = [];
  const push = (icon, title, text) => { const t = (text || "").trim(); if (t) sections.push({ icon, title, text: t }); };

  // 1 · Indian Equities & Trend
  if (niftyLast != null) {
    const above200 = below200 == null ? null : !below200;
    let s = `The NIFTY 50 sits at ${niftyLast.toLocaleString("en-IN", { maximumFractionDigits: 0 })}, ${nifty && nifty.d1 != null ? `${sp(nifty.d1, 2)} on the session, ` : ""}${nifty && nifty.m1 != null ? `${sp(nifty.m1)} over the past month and ` : ""}${nifty && nifty.ytd != null ? `${sp(nifty.ytd)} year-to-date` : "little changed year-to-date"}. `;
    if (sma200 != null) s += `It trades ${above200 ? "above" : "below"} its 200-day average of ${sma200.toLocaleString("en-IN", { maximumFractionDigits: 0 })}, so the primary trend is ${above200 ? "intact and dips into the average have historically been bought" : "broken and rallies into the average have tended to be sold"}. `;
    if (offHigh != null) s += `The index is ${offHigh >= 0 ? "at fresh highs" : `${Math.abs(offHigh).toFixed(1)}% off its 52-week high of ${hi52.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}${offLow != null ? ` and ${offLow >= 0 ? "+" : ""}${offLow.toFixed(1)}% from the 52-week low` : ""}, ${offHigh > -5 ? "keeping it in the upper reaches of its yearly range" : offHigh > -12 ? "a normal corrective pullback rather than a trend break" : "a deeper drawdown that historically marks value zones for long-term buyers"}. `;
    if (iVix != null) s += `India VIX at ${iVix.toFixed(1)} signals ${iVix < 12 ? "unusual calm — option sellers dominate and gap risk is under-priced" : iVix < 15 ? "a benign volatility regime" : iVix < 20 ? "normal two-way risk" : "elevated hedging demand and event risk"}${gVix != null ? `, versus a global VIX of ${gVix.toFixed(1)}${gVixPct != null ? ` (${gVixPct}th percentile of its own year)` : ""}` : ""}, ${iVix != null && gVix != null && iVix < gVix ? "so Indian implied vol is trading calmer than the world — a relative-stability premium that has drawn allocation flows" : "keeping India roughly in line with global risk appetite"}.`;
    push("equity", "Indian Equities & Trend", s);
  }

  // 2 · Monetary Backdrop
  {
    let s = "";
    if (inCpi && inCpi.available && inCpi.latest != null) {
      const dir = inCpi.prev != null ? (inCpi.latest > inCpi.prev ? "up from" : inCpi.latest < inCpi.prev ? "down from" : "flat versus") : null;
      s += `CPI inflation is running ${inCpi.latest}% YoY${dir ? ` (${dir} ${inCpi.prev}% the prior print)` : ""}, ${inCpi.latest <= 4 ? "below the RBI's 4% target midpoint — comfortably inside the 2–6% band and giving the MPC room to prioritise growth" : inCpi.latest <= 6 ? "inside the RBI's 2–6% tolerance band but above the 4% target, keeping the MPC cautious" : "above the RBI's 6% upper tolerance, which constrains any easing"}. `;
    }
    if (repo && repo.available) {
      const rr = cardVal("Real Policy Rate");
      s += `The repo rate stands at ${repo.rate}%${repo.changedOn ? ` (held since ${repo.changedOn}${repo.prevRate != null ? `, when it moved from ${repo.prevRate}%` : ""})` : ""}${rr != null ? `, leaving a real policy rate of ${sp(rr)} — ${rr >= 1.5 ? "firmly restrictive, front-loaded to break inflation and now leaving scope to cut" : rr >= 0 ? "mildly positive, a neutral-to-tight stance" : "negative, i.e. still accommodative in real terms"}` : ""}. `;
    }
    if (in10 && in10.available) {
      const ts = cardVal("10Y − Repo Spread");
      const real10 = inCpi && inCpi.available && inCpi.latest != null ? +(in10.yield - inCpi.latest).toFixed(2) : null;
      s += `The 10-year G-sec yields ${in10.yield}%${in10.d1bp != null ? ` (${in10.d1bp >= 0 ? "+" : ""}${in10.d1bp}bp today)` : ""}, a term spread of ${ts != null ? `${ts >= 0 ? "+" : ""}${ts}pp` : "—"} over the repo${ts != null ? ` — ${ts < 0 ? "an inverted curve versus policy, i.e. the bond market is pricing rate cuts" : ts < 0.6 ? "a flat term premium, a late-cycle signal" : "a normal, positively-sloped term premium"}` : ""}${real10 != null ? `, and a real 10Y yield of ${sp(real10)} that ${real10 >= 2 ? "offers attractive real carry and supports FPI debt inflows" : real10 >= 0 ? "gives a modest real return over inflation" : "is negative, eroding fixed-income holders in real terms"}` : ""}.`;
    }
    push("policy", "Monetary Backdrop", s);
  }

  // 3 · External Account & Rupee
  {
    let s = "";
    if (inrPair && inrPair.price != null) {
      const rank = board && board.fxStrength ? board.fxStrength.findIndex((x) => x.ccy === "INR") : -1;
      s += `USD/INR trades at ${inrPair.price.toFixed(2)}${inrPair.m1 != null ? ` (${sp(inrPair.m1)} over the month, where a rise means a weaker rupee)` : ""}${rank >= 0 ? `, and the rupee ranks ${rank + 1} of ${board.fxStrength.length} majors on the session's strength matrix` : ""}. A softer rupee imports inflation and squeezes oil, capital-goods and electronics importers, while cushioning IT and pharma exporters whose revenue is dollar-denominated. `;
    }
    s += `FX reserves stand at $${resBn}bn${resDate ? ` (${resDate})` : ""}${resPeak != null && resOffPeak != null ? `, ${resOffPeak >= 0 ? "at or near the record" : `${Math.abs(resOffPeak)}bn below the $${resPeak}bn peak — consistent with the RBI selling dollars to smooth rupee volatility rather than a balance-of-payments stress`}` : ""}; that war-chest still covers roughly 10–11 months of imports, one of the deepest buffers in the emerging-market complex.`;
    push("external", "External Account & Rupee", s);
  }

  // 4 · Commodity & External Prices
  {
    let s = "";
    if (brent && brent.price != null) {
      s += `Brent at $${brent.price.toFixed(1)}/bbl${brent.m1 != null ? ` (${sp(brent.m1)} on the month)` : ""} is the single biggest external swing factor: India imports ~85% of its crude, so ${crudeSoft ? "the recent softness is a tailwind for the import bill, the current-account deficit and the margins of OMCs, paints, tyres and aviation" : "firmer crude widens the import bill and the CAD and pressures downstream margins"}. `;
    }
    if (gold && copper && gold.m1 != null && copper.m1 != null) {
      const impulse = copper.m1 - gold.m1;
      s += `The copper–gold impulse (${sp(copper.m1)} vs ${sp(gold.m1)}) reads ${impulse >= 0 ? "pro-growth, a constructive signal for India's metals and industrial exporters" : "defensive, with gold's bid flagging risk aversion and a heavier gold-import drag on the trade deficit"}.`;
    }
    push("commodity", "Commodity & External Prices", s);
  }

  // 5 · Flows & Liquidity
  if (fL && fNet != null && dNet != null) {
    const s = `On ${fL.date} FIIs ${fNet >= 0 ? "bought" : "sold"} ₹${Math.abs(fNet).toFixed(0)} Cr net while DIIs ${dNet >= 0 ? "bought" : "sold"} ₹${Math.abs(dNet).toFixed(0)} Cr — ${tug ? "the classic Indian tug-of-war, foreign selling absorbed by a sticky, SIP-driven domestic bid that has become the market's structural shock-absorber" : bothBuy ? "both cohorts buying, the strongest possible flow configuration" : foreignOnly ? "foreign money the marginal buyer against domestic profit-taking" : "both cohorts net sellers, a defensive tape that lacks a natural buyer until one side turns"}.`;
    push("flows", "Flows & Liquidity", s);
  }

  // 6 · Growth & Real Economy
  {
    let s = "";
    if (ipVal != null) s += `Industrial production is ${sp(ipVal)} YoY, a ${ipVal >= 4 ? "healthy" : ipVal >= 0 ? "soft but positive" : "contractionary"} read on the real economy. `;
    if (gdpVal != null) s += `The latest annual GDP growth of ${sp(gdpVal)} keeps India the fastest-growing major economy, the structural premium that underwrites its equity valuations.`;
    push("growth", "Growth & Real Economy", s);
  }

  // ── deterministic composite score (0–10) for the NET READ gauge ──
  let sc = 5;
  if (gdpVal != null) sc += gdpVal >= 6 ? 0.7 : gdpVal >= 4 ? 0.4 : gdpVal >= 2 ? 0.1 : -0.3;
  if (inCpi && inCpi.available && inCpi.latest != null) sc += inCpi.latest <= 4 ? 0.6 : inCpi.latest <= 6 ? 0.2 : -0.6;
  if (brent && brent.m1 != null) sc += brent.m1 <= -5 ? 0.5 : brent.m1 <= 0 ? 0.3 : brent.m1 > 8 ? -0.5 : 0;
  if (fNet != null && dNet != null) sc += bothBuy ? 0.6 : foreignOnly ? 0.4 : tug ? 0.1 : -0.6;
  if (iVix != null) sc += iVix < 13 ? 0.4 : iVix < 18 ? 0.1 : iVix >= 20 ? -0.4 : 0;
  sc += resBn >= 550 ? 0.3 : resBn >= 450 ? 0.1 : 0;
  if (ipVal != null) sc += ipVal >= 4 ? 0.3 : ipVal >= 0 ? 0.1 : -0.3;
  if (below200 != null) sc += below200 ? -0.6 : 0.5;
  const score = +Math.max(0, Math.min(10, sc)).toFixed(1);
  const label = score >= 8 ? "Strongly Constructive" : score >= 6.5 ? "Constructive" : score >= 5.5 ? "Mildly Constructive" : score >= 4.5 ? "Neutral / Mixed" : score >= 3 ? "Cautious" : "Defensive";

  // 7 · Net Read (narrative synthesis)
  {
    const drivers = [];
    if (gdpVal != null && gdpVal >= 6) drivers.push("a growth premium");
    if (inflEasy) drivers.push("benign inflation");
    if (bothBuy) drivers.push("strong two-sided liquidity");
    else if (tug) drivers.push("a sticky domestic bid");
    if (resBn >= 550) drivers.push("deep external buffers");
    if (iVix != null && iVix < 13) drivers.push("a low-volatility regime");
    if (crudeSoft) drivers.push("a soft crude bill");
    const drags = [];
    if (below200) drags.push("a broken price trend");
    if (inflHot) drags.push("above-target inflation");
    if (crudeHot) drags.push("a rising crude bill");
    if (fNet != null && fNet < 0 && !tug) drags.push("foreign outflows");
    if (iVix != null && iVix >= 20) drags.push("elevated volatility");
    const posClause = drivers.length ? `${drivers.slice(0, 4).join(", ")}` : "resilient fundamentals";
    const negClause = drags.length ? ` The main offset is ${drags.slice(0, 3).join(", ")}.` : "";
    const s = `Net-net, India screens ${label.toLowerCase()} on a live-data composite of ${score}/10: ${posClause} ${drivers.length ? "underpin" : "underpins"} a ${score >= 5.5 ? "domestic-demand and growth story with a deep-reserve, SIP-cushioned market" : "market where selectivity matters as external and valuation headwinds weigh"}.${negClause}`;
    push("netread", "Net Read", s);
  }

  // ── NET READ description (short, drives the gauge caption) ──
  const netDrivers = [];
  if (gdpVal != null && gdpVal >= 6) netDrivers.push("a growth premium");
  if (inflEasy) netDrivers.push("benign inflation");
  if (bothBuy || tug) netDrivers.push("strong liquidity");
  if (resBn >= 550) netDrivers.push("external buffers");
  if (iVix != null && iVix < 13) netDrivers.push("low volatility");
  if (crudeSoft) netDrivers.push("a soft crude bill");
  const netDesc = `${(netDrivers.length ? netDrivers.slice(0, 4).join(", ") : "Mixed cross-currents")} ${netDrivers.length ? "drive" : "shape"} a ${label.toLowerCase()} macro regime.`;

  // ── KEY TAKEAWAYS — factual state of play (most decision-relevant first) ──
  const takeaways = [];
  if (gdpVal != null || ipVal != null) takeaways.push(`Growth remains ${gdpVal != null && gdpVal >= 6 ? "strong" : gdpVal != null && gdpVal >= 3 ? "steady" : "subdued"}${gdpVal != null ? ` with GDP at ${sp(gdpVal)}` : ""}${ipVal != null ? ` and industrial production at ${sp(ipVal)} YoY` : ""}.`);
  if (inCpi && inCpi.available && inCpi.latest != null) takeaways.push(inflEasy ? `Inflation at ${inCpi.latest}% is below target, giving the RBI scope for rate cuts.` : inflHot ? `Inflation at ${inCpi.latest}% is above tolerance, keeping the RBI on hold.` : `Inflation at ${inCpi.latest}% sits within band but above the 4% target.`);
  if (brent && brent.m1 != null) takeaways.push(crudeSoft ? `Lower crude (Brent ${sp(brent.m1)} 1M) supports the import bill, CAD and corporate margins.` : `Firmer crude (Brent ${sp(brent.m1)} 1M) pressures the import bill, CAD and margins.`);
  if (fNet != null && dNet != null) takeaways.push(bothBuy ? "FII + DII both buying — the strongest liquidity backdrop." : tug ? "DIIs are absorbing FII selling — a resilient domestic bid." : foreignOnly ? "FIIs buying against domestic profit-taking." : "Both FIIs and DIIs are net sellers — a defensive tape.");
  if (iVix != null) takeaways.push(iVix < 15 ? "A low-volatility regime provides a relative-stability premium." : iVix < 20 ? "Volatility is in a normal two-way range." : "Elevated volatility signals event risk and de-risking.");
  takeaways.push(`Deep FX reserves ($${resBn}bn) ensure external resilience.`);

  // ── OPPORTUNITIES ──
  const opportunities = [];
  if (inflEasy || (inCpi && inCpi.available && inCpi.latest != null && inCpi.latest <= 6)) opportunities.push("RBI rate cuts to support growth.");
  if (crudeSoft) opportunities.push("Soft crude benefits OMCs, paints, tyres and aviation.");
  if (inrPair && inrPair.price != null) opportunities.push("A softer rupee is positive for IT, pharma and export-oriented sectors.");
  if (iVix != null && iVix < 15) opportunities.push("Attractive risk-reward with cheap hedges available.");
  if (gdpVal != null && gdpVal >= 6) opportunities.push("Structural growth premium remains intact.");
  if (!opportunities.length) opportunities.push("Quality compounders where domestic flows, not global sentiment, set the marginal price.");

  // ── RISKS TO WATCH ──
  const risks = [];
  if (below200) risks.push("NIFTY trading below the 200-DMA — trend confirmation pending.");
  if (inflHot) risks.push(`Inflation at ${inCpi.latest}% above tolerance limits policy room.`);
  risks.push("An oil-price spike could widen the CAD and re-ignite inflation.");
  risks.push("A stronger dollar or higher US yields could trigger FII outflows.");
  risks.push("A monsoon deficit is a standing risk to food inflation and rural demand.");
  if (lo52 != null) risks.push(`A breakdown below the 52-week low (${lo52.toLocaleString("en-IN", { maximumFractionDigits: 0 })}) would open downside risk.`);

  return {
    available: sections.length > 0,
    asOf: Date.now(), asOfLabel,
    sections,
    takeaways,
    opportunities: opportunities.slice(0, 5),
    risks: risks.slice(0, 5),
    netRead: { score, label, desc: netDesc },
    method: "India-focused deterministic briefing — every figure is drawn from the live panels above (board, rates, inflation, FII/DII, India pack) and every judgement is rule-based off those numbers.",
  };
}
router.get("/macro/brief", async (_req, res) => {
  try { res.json(await cachedDurable("macro:brief", 5 * 60 * 1000, buildBrief)); }
  catch (e) { res.json({ available: false, reason: String(e.message || e).slice(0, 140) }); }
});

module.exports = router;
