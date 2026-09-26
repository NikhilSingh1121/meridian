/**
 * MERIDIAN — Sector Analysis engine
 * ════════════════════════════════════════════════════════════════════════
 * Sourced LIVE from Yahoo Finance's own sector/industry taxonomy API — the
 * exact feed behind finance.yahoo.com/sectors. This gives 100% coverage of the
 * global market: all 11 sectors, all ~145 industries, true market caps, market
 * weights, day/YTD/1Y/3Y/5Y performance, per-industry company counts and top
 * companies — nothing hardcoded, nothing scanned/approximated.
 *
 *   GET /api/sectors                 → all-sectors overview (aggregate + rows)
 *   GET /api/sectors/:key            → one sector: header, metrics, industries,
 *                                      company table
 *   GET /api/sectors/:key/chart      → sector INDEX vs benchmark, rebased %
 *                                      (?range=6M&benchmark=^GSPC)
 *   GET /api/sectors/benchmark-metrics → benchmark day/ytd/1y/3y/5y
 *
 * Yahoo returns figures as { raw, fmt } with fractional values (0.3173 = 31.73%);
 * `num`/`pct` normalise those. The taxonomy calls are authenticated via the
 * shared yahoo-finance2 session (F.sectorApi) and cached (durable, stale-on-error).
 */
const express = require("express");
const router = express.Router();
const F = require("../providers/fundamentals");
const yahoo = require("../providers/yahoo");
const { cached, cachedDurable } = require("../cache");

// Yahoo's canonical sector keys (match the finance.yahoo.com/sectors/* slugs).
const SECTOR_KEYS = [
  "technology", "financial-services", "healthcare", "consumer-cyclical",
  "communication-services", "industrials", "consumer-defensive", "energy",
  "basic-materials", "real-estate", "utilities",
];

/* Benchmarks for the sector performance chart. The data is now global, so the
   S&P 500 is the default; NASDAQ / Russell 1000 / NIFTY 50 remain comparators
   (every series is rebased to 0% at the range start). */
const BENCHMARKS = {
  "^GSPC": "S&P 500",
  "^IXIC": "NASDAQ",
  "^RUI": "Russell 1000",
  "^NSEI": "NIFTY 50",
};

/* Range label → Yahoo range / interval. No native 3y range → pull 5y weekly and slice. */
const RANGE_MAP = {
  "1D": { range: "1d", interval: "5m" },
  "5D": { range: "5d", interval: "30m" },
  "1M": { range: "1mo", interval: "1d" },
  "6M": { range: "6mo", interval: "1d" },
  "YTD": { range: "ytd", interval: "1d" },
  "1Y": { range: "1y", interval: "1d" },
  "3Y": { range: "5y", interval: "1wk", sliceYears: 3 },
  "5Y": { range: "5y", interval: "1wk" },
  "All": { range: "max", interval: "1mo" },
};

const OVERVIEW_TTL = 20 * 60 * 1000;   // day returns move; refresh a few times/hour
const DETAIL_TTL = 20 * 60 * 1000;
const TAX_TTL = 20 * 60 * 1000;        // per-sector / per-industry taxonomy blobs
const SHIST_TTL = 30 * 60 * 1000;
const DAY_MS = 24 * 3600 * 1000;

/* ── value normalisers for Yahoo's { raw, fmt } fractional figures ─────────── */
const num = (x) => (x && typeof x === "object" ? (x.raw != null ? x.raw : null) : (typeof x === "number" ? x : null));
const pct = (x) => { const v = num(x); return v == null ? null : v * 100; };

/* ── authenticated taxonomy fetchers (durable-cached) ─────────────────────── */
const allSectorsRaw = () => cachedDurable("yfsec:__all", OVERVIEW_TTL, async () => {
  const r = await F.sectorApi("sectors");
  if (!r || !r.sectors) throw new Error("no sectors payload");
  return r.sectors;
});
const sectorRaw = (key) => cachedDurable(`yfsec:${key}`, TAX_TTL, async () => {
  const r = await F.sectorApi("sectors/" + key);
  if (!r || !r.data) throw new Error("no sector data");
  return r.data;
});
const industryRaw = (key) => cachedDurable(`yfind:${key}`, TAX_TTL, async () => {
  const r = await F.sectorApi("industries/" + key);
  return r && r.data ? r.data : null;
});

/* ── small helpers (chart math) ───────────────────────────────────────────── */
const chartTtl = (range) => (range === "1D" || range === "5D" ? 60 * 1000 : 30 * 60 * 1000);
function dayReturn(points) {
  const p = (points || []).filter((x) => x && x.c != null && isFinite(x.c));
  if (p.length < 2) return null;
  const a = p[p.length - 2].c, b = p[p.length - 1].c;
  return a ? (b / a - 1) * 100 : null;
}
function ytdReturn(points) {
  const p = (points || []).filter((x) => x && x.c != null && isFinite(x.c));
  if (p.length < 2) return null;
  const yr = new Date().getFullYear();
  let idx = p.findIndex((x) => new Date(x.t).getFullYear() >= yr);
  if (idx < 0) idx = p.length - 1;
  const base = (idx > 0 ? p[idx - 1] : p[idx]).c;
  const last = p[p.length - 1].c;
  return base ? (last / base - 1) * 100 : null;
}
function retOverDays(points, days) {
  const p = (points || []).filter((x) => x && x.c != null && isFinite(x.c));
  if (p.length < 2) return null;
  const cutoff = Date.now() - days * DAY_MS;
  let base = null;
  for (let i = p.length - 1; i >= 0; i--) { if (p[i].t <= cutoff) { base = p[i].c; break; } }
  if (base == null) return null;
  const last = p[p.length - 1].c;
  return base ? (last / base - 1) * 100 : null;
}
function retFirst(points) {
  const p = (points || []).filter((x) => x && x.c != null && isFinite(x.c));
  if (p.length < 2) return null;
  return p[0].c ? (p[p.length - 1].c / p[0].c - 1) * 100 : null;
}
function sliceYears(points, yrs) {
  if (!yrs) return points || [];
  const cutoff = Date.now() - yrs * 365 * DAY_MS;
  return (points || []).filter((p) => p && p.t >= cutoff);
}
function rebase(points) {
  const p = (points || []).filter((x) => x && x.c != null && isFinite(x.c)).sort((a, b) => a.t - b.t);
  if (p.length < 2) return [];
  const c0 = p[0].c;
  if (!c0) return [];
  return p.map((x) => ({ t: x.t, pct: (x.c / c0 - 1) * 100 }));
}

/* ═══════════════ OVERVIEW — all sectors ═══════════════ */
async function buildOverview() {
  const all = await allSectorsRaw();
  const list = (all.list || []).filter((s) => s.key); // drop the "All Sectors" aggregate row
  const sectors = await Promise.all(list.map(async (s) => {
    let ov = {};
    try { ov = (await sectorRaw(s.key)).overview || {}; } catch { /* mcap/counts optional */ }
    return {
      key: s.key,
      name: s.name,
      weight: pct(s.marketWeight) ?? pct(ov.marketWeight),
      dayPct: pct(s.regMarketChangePercent),
      ytdPct: pct(s.ytdReturn),
      mcap: num(ov.marketCap),
      industries: ov.industriesCount != null ? ov.industriesCount : null,
      companies: ov.companiesCount != null ? ov.companiesCount : null,
    };
  }));
  return {
    asOf: Date.now(),
    currency: "USD",
    totalSectors: all.sectorsCount != null ? all.sectorsCount : sectors.length,
    totalIndustries: all.industriesCount != null ? all.industriesCount : sectors.reduce((a, s) => a + (s.industries || 0), 0),
    totalMcap: num(all.marketCap),
    sectors: sectors.sort((a, b) => (b.weight || 0) - (a.weight || 0)),
  };
}
router.get("/sectors", async (_req, res) => {
  try { res.json({ status: "done", ...(await cachedDurable("sectors:overview", OVERVIEW_TTL, buildOverview)) }); }
  catch (e) { res.status(502).json({ error: String((e && e.message) || e).slice(0, 140) }); }
});

/* ═══════════════ DETAIL — one sector ═══════════════ */
function mapCompany(c, ikey, iname, sectorMcap) {
  const price = num(c.lastPrice), target = num(c.targetPrice), mcap = num(c.marketCap);
  return {
    symbol: c.symbol,
    ticker: c.symbol,
    name: c.name || c.symbol,
    industry: iname || "",
    industryKey: ikey || null,
    price,
    currency: "USD",
    target,
    upside: target && price ? (target / price - 1) * 100 : null,
    // sector-relative weight, recomputed so every row is on the same basis
    weight: mcap != null && sectorMcap ? (mcap / sectorMcap) * 100 : pct(c.marketWeight),
    mcap,
    dayPct: pct(c.regMarketChangePercent),
    ytdPct: pct(c.ytdReturn),
    pe: null, fwdPe: null, evEbitda: null, divYield: null, // not exposed by the sector API
    rating: c.rating || null,
  };
}

async function buildDetail(key) {
  const d = await sectorRaw(key);
  const ov = d.overview || {};
  const sectorMcap = num(ov.marketCap);
  const perf = d.performance || {};
  const metrics = {
    day: pct(perf.regMarketChangePercent),
    ytd: pct(perf.ytdChangePercent),
    y1: pct(perf.oneYearChangePercent),
    y3: pct(perf.threeYearChangePercent),
    y5: pct(perf.fiveYearChangePercent),
  };

  // Per-industry detail (company counts + constituents), fetched in parallel and
  // cached. Failures degrade to null counts rather than dropping the industry.
  const rawInds = (d.industries || []).filter((i) => i.key);
  const indDetails = await Promise.all(rawInds.map(async (i) => {
    let id = null;
    try { id = await industryRaw(i.key); } catch { /* count/companies optional */ }
    return { i, id };
  }));

  const industries = indDetails.map(({ i, id }) => {
    const w = pct(i.marketWeight);
    return {
      key: i.key,
      name: i.name,
      weight: w,
      mcap: w != null && sectorMcap != null ? sectorMcap * (w / 100) : null,
      dayPct: pct(i.regMarketChangePercent),
      ytdPct: pct(i.ytdReturn),
      companies: id && id.overview && id.overview.companiesCount != null ? id.overview.companiesCount : null,
    };
  }).sort((a, b) => (b.weight || 0) - (a.weight || 0));

  // Company universe = union of every industry's top companies (tagged with
  // their industry so the industry→company filter works), then any sector-level
  // top company not already present. Deduped by symbol, ranked by market cap.
  const cmap = new Map();
  const add = (c, ikey, iname) => { if (c && c.symbol && !cmap.has(c.symbol)) cmap.set(c.symbol, mapCompany(c, ikey, iname, sectorMcap)); };
  for (const { i, id } of indDetails) for (const c of ((id && id.topCompanies) || [])) add(c, i.key, i.name);
  for (const c of (d.topCompanies || [])) add(c, null, "");
  const companies = [...cmap.values()].sort((a, b) => (b.mcap || 0) - (a.mcap || 0));

  return {
    key,
    name: d.name,
    description: ov.description || "",
    currency: "USD",
    mcap: sectorMcap,
    weight: pct(ov.marketWeight),
    industriesCount: ov.industriesCount != null ? ov.industriesCount : industries.length,
    companiesCount: ov.companiesCount != null ? ov.companiesCount : companies.length,
    metrics,
    industries,
    companies,
    benchmarks: BENCHMARKS,
    indexSymbol: d.symbol || null,
  };
}
router.get("/sectors/:key", async (req, res) => {
  const key = req.params.key;
  if (!SECTOR_KEYS.includes(key)) return res.status(404).json({ error: "Unknown sector" });
  try { res.json(await cachedDurable(`sectors:detail:${key}`, DETAIL_TTL, () => buildDetail(key))); }
  catch (e) { res.status(502).json({ error: "Sector detail unavailable", detail: String((e && e.message) || e).slice(0, 120) }); }
});

/* ═══════════════ CHART — sector index vs benchmark (rebased %) ═══════════════ */
router.get("/sectors/:key/chart", async (req, res) => {
  const key = req.params.key;
  if (!SECTOR_KEYS.includes(key)) return res.status(404).json({ error: "Unknown sector" });
  const range = RANGE_MAP[req.query.range] ? String(req.query.range) : "6M";
  const rm = RANGE_MAP[range];
  const benchmark = BENCHMARKS[req.query.benchmark] ? String(req.query.benchmark) : "^GSPC";
  try {
    const idx = (await sectorRaw(key)).symbol; // Yahoo sector index, e.g. ^YH311
    const data = await cached(`sec-chart:${key}:${range}:${benchmark}`, chartTtl(range), async () => {
      let sector = [], bench = [];
      if (idx) {
        try {
          const h = await cached(`sh:${idx}:${rm.range}:${rm.interval}`, SHIST_TTL, () => yahoo.getHistory(idx, rm.range, rm.interval));
          sector = rebase(sliceYears(h.points, rm.sliceYears));
        } catch { /* leave empty */ }
      }
      try {
        const bh = await cached(`sh:${benchmark}:${rm.range}:${rm.interval}`, SHIST_TTL, () => yahoo.getHistory(benchmark, rm.range, rm.interval));
        bench = rebase(sliceYears(bh.points, rm.sliceYears));
      } catch { /* leave empty */ }
      return { range, benchmark, benchmarkName: BENCHMARKS[benchmark] || benchmark, sector, bench };
    });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: "Chart data unavailable", detail: String((e && e.message) || e).slice(0, 120) });
  }
});

router.get("/sectors/benchmark-metrics", async (req, res) => {
  const symbol = BENCHMARKS[req.query.symbol] ? String(req.query.symbol) : "^GSPC";
  try {
    const data = await cached(`bench-metrics:${symbol}`, 30 * 60 * 1000, async () => {
      const [d1, w5] = await Promise.all([
        cached(`sh:${symbol}:1y:1d`, SHIST_TTL, () => yahoo.getHistory(symbol, "1y", "1d")).catch(() => null),
        cached(`sh:${symbol}:5y:1wk`, SHIST_TTL, () => yahoo.getHistory(symbol, "5y", "1wk")).catch(() => null),
      ]);
      const p1 = (d1 && d1.points) || [], p5 = (w5 && w5.points) || [];
      return {
        symbol, name: BENCHMARKS[symbol] || symbol,
        day: dayReturn(p1),
        ytd: ytdReturn(p1),
        y1: retOverDays(p1, 365) ?? retFirst(p1),
        y3: retOverDays(p5, 365 * 3),
        y5: retOverDays(p5, 365 * 5) ?? retFirst(p5),
      };
    });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: "Benchmark metrics unavailable" });
  }
});

module.exports = router;
