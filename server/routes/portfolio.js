/**
 * MERIDIAN — Portfolio Technical Screener API.
 *
 *   POST /api/portfolio/technicals  { symbols: ["RELIANCE.NS", ...] }
 *     → { asOf, rows: [{ symbol, name, sector, currency, price, ..., score, signal, spark }] }
 *
 *   GET  /api/portfolio/universes
 *     → { universes: { nifty50: { label, symbols }, ... } }
 *
 * One year of daily candles per name is enough to compute every indicator in
 * the screener (EMA200 + 52-week ranges fit comfortably). Per-symbol cache is
 * 4 minutes — long enough to absorb a 20-name refresh without re-hitting
 * Yahoo, short enough that intraday signal changes still propagate.
 */
const express = require("express");
const router = express.Router();
const yahoo = require("../providers/yahoo");
const F = require("../providers/fundamentals");
const T = require("../lib/technicals");
const { cached } = require("../cache");

const MAX_SYMBOLS = 20;
const TECH_TTL = 4 * 60 * 1000;       // computed indicator pack
const META_TTL = 24 * 60 * 60 * 1000; // sector / company-name metadata

/* ── Universe presets ─────────────────────────────────────────────────────
   Lists are static and intentionally lean — they exist to seed a portfolio
   quickly. Search remains the primary path; universes drive "Add top N".
   Indian: composite of liquid large-caps and mid-caps. US: index leaders.
*/
const UNIVERSES = {
  nifty50: {
    label: "Nifty 50",
    symbols: [
      "RELIANCE.NS", "HDFCBANK.NS", "TCS.NS", "BHARTIARTL.NS", "ICICIBANK.NS",
      "SBIN.NS", "INFY.NS", "BAJFINANCE.NS", "HINDUNILVR.NS", "ITC.NS",
      "LT.NS", "HCLTECH.NS", "KOTAKBANK.NS", "SUNPHARMA.NS", "MARUTI.NS",
      "M&M.NS", "AXISBANK.NS", "ULTRACEMCO.NS", "NTPC.NS", "TITAN.NS",
      "BAJAJFINSV.NS", "ONGC.NS", "ADANIPORTS.NS", "ADANIENT.NS", "POWERGRID.NS",
      "TATAMOTORS.NS", "WIPRO.NS", "JSWSTEEL.NS", "COALINDIA.NS", "BAJAJ-AUTO.NS",
      "NESTLEIND.NS", "ASIANPAINT.NS", "TATASTEEL.NS", "GRASIM.NS", "TRENT.NS",
      "SBILIFE.NS", "HDFCLIFE.NS", "TECHM.NS", "EICHERMOT.NS", "HINDALCO.NS",
      "CIPLA.NS", "DRREDDY.NS", "SHRIRAMFIN.NS", "BRITANNIA.NS", "APOLLOHOSP.NS",
      "INDUSINDBK.NS", "HEROMOTOCO.NS", "TATACONSUM.NS", "BPCL.NS", "BEL.NS",
    ],
  },
  niftyNext50: {
    label: "Nifty Next 50",
    symbols: [
      "DMART.NS", "LICI.NS", "HAL.NS", "DLF.NS", "PIDILITIND.NS",
      "GODREJCP.NS", "VBL.NS", "SIEMENS.NS", "AMBUJACEM.NS", "VEDL.NS",
      "TVSMOTOR.NS", "ABB.NS", "BANKBARODA.NS", "ZOMATO.NS", "JINDALSTEL.NS",
      "ICICIPRULI.NS", "GAIL.NS", "DABUR.NS", "TATAPOWER.NS", "PNB.NS",
      "INDIGO.NS", "IOC.NS", "BAJAJHLDNG.NS", "CHOLAFIN.NS", "PFC.NS",
      "RECLTD.NS", "MARICO.NS", "TORNTPHARM.NS", "HAVELLS.NS", "ZYDUSLIFE.NS",
      "GODREJPROP.NS", "LODHA.NS", "BOSCHLTD.NS", "COLPAL.NS", "IOB.NS",
      "ICICIGI.NS", "BERGEPAINT.NS", "IRFC.NS", "CGPOWER.NS", "MOTHERSON.NS",
      "MUTHOOTFIN.NS", "INDHOTEL.NS", "BHEL.NS", "TIINDIA.NS", "PIIND.NS",
      "POLYCAB.NS", "SRF.NS", "UNIONBANK.NS", "CANBK.NS", "MAZDOCK.NS",
    ],
  },
  nifty100: { label: "Nifty 100", symbols: [] /* filled below */ },
  bse500top: {
    label: "BSE Large & Midcap",
    symbols: [
      "ASIANPAINT.NS", "BIOCON.NS", "CADILAHC.NS", "CONCOR.NS", "CUMMINSIND.NS",
      "DIVISLAB.NS", "ESCORTS.NS", "FEDERALBNK.NS", "GLENMARK.NS", "GMRINFRA.NS",
      "HDFCAMC.NS", "HINDPETRO.NS", "IDFCFIRSTB.NS", "INDIANB.NS", "JUBLFOOD.NS",
      "LICHSGFIN.NS", "LUPIN.NS", "MFSL.NS", "MPHASIS.NS", "NMDC.NS",
      "OBEROIRLTY.NS", "PAGEIND.NS", "PETRONET.NS", "PRESTIGE.NS", "RBLBANK.NS",
      "SAIL.NS", "TATACOMM.NS", "TORNTPOWER.NS", "VOLTAS.NS", "YESBANK.NS",
    ],
  },
  sp500: {
    label: "S&P 500 Leaders",
    symbols: [
      "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "BRK-B",
      "LLY", "AVGO", "JPM", "V", "UNH", "XOM", "MA", "JNJ", "PG",
      "HD", "ABBV", "COST", "MRK", "BAC", "ADBE", "CVX", "KO", "PEP",
      "ORCL", "WMT", "TMO", "ACN", "MCD", "DIS", "CRM", "ABT", "AMD",
      "NFLX", "CSCO", "WFC", "CMCSA", "PFE", "INTC", "VZ", "TXN", "DHR",
      "QCOM", "PM", "NKE", "NEE", "HON", "UPS", "AMGN",
    ],
  },
  nasdaq100: {
    label: "NASDAQ 100",
    symbols: [
      "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AVGO",
      "COST", "ADBE", "PEP", "NFLX", "CSCO", "AMD", "INTC", "QCOM",
      "TXN", "AMGN", "INTU", "BKNG", "HON", "AMAT", "SBUX", "GILD",
      "MDLZ", "ADP", "REGN", "VRTX", "ISRG", "LRCX", "PYPL", "PANW",
      "MU", "KLAC", "SNPS", "CDNS", "MELI", "MAR", "ASML", "CHTR",
      "ABNB", "FTNT", "ORLY", "WDAY", "MNST", "ADI", "ROST", "NXPI",
      "KDP", "PCAR",
    ],
  },
  dowjones: {
    label: "Dow Jones",
    symbols: [
      "AAPL", "AMGN", "AXP", "BA", "CAT", "CRM", "CSCO", "CVX",
      "DIS", "DOW", "GS", "HD", "HON", "IBM", "INTC", "JNJ",
      "JPM", "KO", "MCD", "MMM", "MRK", "MSFT", "NKE", "PG",
      "TRV", "UNH", "V", "VZ", "WBA", "WMT",
    ],
  },
  ftse100: {
    label: "FTSE 100",
    symbols: [
      "SHEL.L", "AZN.L", "HSBA.L", "ULVR.L", "BP.L", "GSK.L",
      "DGE.L", "RIO.L", "REL.L", "BATS.L", "GLEN.L", "LSEG.L",
      "AAL.L", "BARC.L", "PRU.L", "NWG.L", "ABF.L", "LLOY.L",
      "SAGE.L", "EXPN.L",
    ],
  },
  custom: { label: "Custom (Search-driven)", symbols: [] },
};

// Build Nifty 100 = Nifty 50 ∪ Nifty Next 50 (deduped, order-preserving)
UNIVERSES.nifty100.symbols = [
  ...new Set([...UNIVERSES.nifty50.symbols, ...UNIVERSES.niftyNext50.symbols]),
];

router.get("/portfolio/universes", (_req, res) => {
  const summary = {};
  for (const [k, v] of Object.entries(UNIVERSES)) {
    summary[k] = { label: v.label, symbols: v.symbols, count: v.symbols.length };
  }
  res.json({ universes: summary });
});

/* ── Per-symbol "tech pack" builder ────────────────────────────────────────
   - Pulls a year of daily candles from Yahoo (cached 4m via TECH_TTL key)
   - Pulls minimal fundamentals once a day (sector, long name) — separate key
   - Computes the full indicator/score/signal pack via lib/technicals
*/
async function metaFor(symbol) {
  return cached(`pmeta:${symbol}`, META_TTL, async () => {
    try {
      const b = await F.miniSummary(symbol);
      const pr = b?.price || {}, ap = b?.assetProfile || {};
      return {
        symbol,
        name: pr.longName || pr.shortName || symbol,
        sector: ap.sector || "—",
        currency: pr.currency || "",
      };
    } catch {
      // Fall back to a Yahoo quote — works for indices/FX/crypto too
      try {
        const q = await yahoo.getQuote(symbol);
        return { symbol, name: q.name || symbol, sector: "—", currency: q.currency || "" };
      } catch {
        return { symbol, name: symbol, sector: "—", currency: "" };
      }
    }
  });
}

async function techPackFor(symbol) {
  return cached(`ptech:${symbol}`, TECH_TTL, async () => {
    const [hist, meta] = await Promise.all([
      yahoo.getHistory(symbol, "1y", "1d").catch(() => null),
      metaFor(symbol).catch(() => ({ symbol, name: symbol, sector: "—", currency: "" })),
    ]);
    if (!hist || !hist.points || hist.points.length < 50) {
      return { symbol, name: meta.name, sector: meta.sector, currency: meta.currency, error: "Insufficient history" };
    }
    return T.computeTechnicals(hist, meta);
  });
}

router.post("/portfolio/technicals", express.json({ limit: "64kb" }), async (req, res) => {
  const symbols = Array.isArray(req.body?.symbols)
    ? req.body.symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean)
    : [];
  if (!symbols.length) return res.json({ asOf: Date.now(), rows: [] });

  const capped = [...new Set(symbols)].slice(0, MAX_SYMBOLS);

  try {
    // Pool with concurrency to avoid Yahoo rate-limits; reuses provider pool semantics
    const rows = await F.pool(capped, 4, techPackFor);
    res.json({ asOf: Date.now(), rows });
  } catch (e) {
    res.status(502).json({ error: "Technical scan failed", detail: String(e.message || e).slice(0, 140) });
  }
});

/**
 * Lightweight metadata lookup — used by the frontend when the user adds a
 * company so the row can show sector/name immediately even before the next
 * full technicals refresh.
 */
router.get("/portfolio/meta/:symbol", async (req, res) => {
  try {
    const m = await metaFor(req.params.symbol.toUpperCase());
    res.json(m);
  } catch (e) {
    res.status(404).json({ error: "Lookup failed", detail: String(e.message || e).slice(0, 80) });
  }
});

/* ════════════════════════════════════════════════════════════════════════════
   POST /api/portfolio/performance
   Body: { transactions: [{ symbol, side: "BUY"|"SELL", qty, price, date }],
           benchmark?: "^NSEI" }

   Transactions live client-side (per-user localStorage, synced by the
   user-store); the server is the single computation engine so the math is
   deterministic, testable and identical everywhere:
     · Holdings via weighted-average cost (disclosed; FIFO tax lots are a
       reporting concern, WAC is the standard display convention)
     · Realized P&L on sells, unrealized on live quotes
     · Money-weighted return (XIRR) over the actual dated cashflows
     · Benchmark XIRR: the SAME cashflows hypothetically buying the benchmark
       at each transaction date's close — a true opportunity-cost comparison
   ════════════════════════════════════════════════════════════════════════════ */
router.post("/portfolio/performance", express.json({ limit: "1mb" }), async (req, res) => {
  try {
    const A = require("../lib/analytics");
    const raw = Array.isArray(req.body?.transactions) ? req.body.transactions : [];
    const benchmark = String(req.body?.benchmark || "^NSEI").slice(0, 16);

    // ── validate + normalize ──
    const txns = raw.slice(0, 500).map((t) => ({
      symbol: String(t.symbol || "").toUpperCase().trim().slice(0, 20),
      side: t.side === "SELL" ? "SELL" : "BUY",
      qty: +t.qty, price: +t.price,
      date: new Date(t.date).getTime(),
    })).filter((t) => t.symbol && Number.isFinite(t.qty) && t.qty > 0 &&
                      Number.isFinite(t.price) && t.price > 0 &&
                      Number.isFinite(t.date) && t.date <= Date.now())
      .sort((a, b) => a.date - b.date);
    if (!txns.length) return res.json({ available: false, reason: "No valid transactions" });
    const symbols = [...new Set(txns.map((t) => t.symbol))].slice(0, 30);

    // ── per-symbol weighted-average-cost ledger ──
    const warnings = [];
    const ledger = {};
    for (const t of txns) {
      if (!symbols.includes(t.symbol)) continue;
      const L = (ledger[t.symbol] ||= { qty: 0, cost: 0, realized: 0, buys: 0, sells: 0 });
      if (t.side === "BUY") {
        L.cost += t.qty * t.price; L.qty += t.qty; L.buys++;
      } else {
        const sellQty = Math.min(t.qty, L.qty);
        if (sellQty < t.qty) warnings.push(`${t.symbol}: sell of ${t.qty} exceeds held ${L.qty.toFixed(2)} — clamped to holdings`);
        if (sellQty > 0) {
          const avg = L.qty > 0 ? L.cost / L.qty : 0;
          L.realized += sellQty * (t.price - avg);
          L.cost -= sellQty * avg; L.qty -= sellQty; L.sells++;
        }
      }
    }

    // ── live quotes for open positions ──
    const openSyms = symbols.filter((s) => ledger[s] && ledger[s].qty > 1e-9);
    const quotes = {};
    await Promise.all(openSyms.map(async (s) => {
      try { quotes[s] = await cached(`q:${s}`, 15_000, () => yahoo.getQuote(s)); }
      catch { quotes[s] = null; }
    }));

    const holdings = openSyms.map((s) => {
      const L = ledger[s], q = quotes[s];
      const avgCost = L.qty > 0 ? L.cost / L.qty : null;
      const price = q && q.price != null ? q.price : null;
      const value = price != null ? L.qty * price : null;
      return {
        symbol: s, name: q?.shortName || q?.longName || s, currency: q?.currency || null,
        qty: +L.qty.toFixed(4), avgCost: avgCost != null ? +avgCost.toFixed(2) : null,
        invested: +L.cost.toFixed(2), price, value: value != null ? +value.toFixed(2) : null,
        unrealized: value != null ? +(value - L.cost).toFixed(2) : null,
        unrealizedPct: value != null && L.cost > 0 ? +(((value - L.cost) / L.cost) * 100).toFixed(2) : null,
        dayChangePct: q?.changePct ?? null,
        realized: +L.realized.toFixed(2),
        quoteMissing: price == null,
      };
    }).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    const realizedTotal = Object.values(ledger).reduce((s, L) => s + L.realized, 0);
    const investedOpen = holdings.reduce((s, h) => s + (h.invested || 0), 0);
    const currentValue = holdings.reduce((s, h) => s + (h.value || 0), 0);
    const unrealizedTotal = holdings.reduce((s, h) => s + (h.unrealized || 0), 0);
    holdings.forEach((h) => { h.weightPct = currentValue > 0 && h.value != null ? +((h.value / currentValue) * 100).toFixed(1) : null; });

    // ── money-weighted return over the actual cashflows ──
    const flows = txns.map((t) => ({ date: t.date, amount: (t.side === "BUY" ? -1 : 1) * t.qty * t.price }));
    if (currentValue > 0) flows.push({ date: Date.now(), amount: currentValue });
    const portfolioXirr = A.xirr(flows);

    // ── benchmark: identical cashflows buying the index at each date's close ──
    let benchXirr = null, benchNote = null;
    try {
      const earliest = txns[0].date;
      const yearsBack = (Date.now() - earliest) / (365.25 * 24 * 3600 * 1000);
      const range = yearsBack <= 1 ? "2y" : yearsBack <= 4.5 ? "5y" : yearsBack <= 9.5 ? "10y" : "max";
      const h = await cached(`h:${benchmark}:${range}:1d`, 60 * 60 * 1000, () => yahoo.getHistory(benchmark, range, "1d"));
      const pts = ((h && (h.points || h)) || []).filter((p) => p.c != null && Number.isFinite(p.t));
      if (pts.length > 20) {
        const closeAt = (ts) => {
          // nearest close at-or-before ts; falls back to the first close
          let best = pts[0].c;
          for (const p of pts) { if (p.t <= ts) best = p.c; else break; }
          return best;
        };
        let units = 0;
        const bFlows = [];
        for (const t of txns) {
          const c = closeAt(t.date);
          if (!c) continue;
          const amt = t.qty * t.price;
          if (t.side === "BUY") { units += amt / c; bFlows.push({ date: t.date, amount: -amt }); }
          else { units -= amt / c; bFlows.push({ date: t.date, amount: amt }); }
        }
        const lastClose = pts.at(-1).c;
        if (units > 0 && lastClose) bFlows.push({ date: Date.now(), amount: units * lastClose });
        benchXirr = A.xirr(bFlows);
        if (txns[0].date < pts[0].t) benchNote = "Benchmark history starts after your earliest transaction — early flows use the first available close.";
      }
    } catch { benchNote = "Benchmark series unavailable — index comparison skipped."; }

    res.json({
      available: true,
      asOf: new Date().toISOString(),
      benchmark,
      holdings,
      totals: {
        investedOpen: +investedOpen.toFixed(2),
        currentValue: +currentValue.toFixed(2),
        unrealized: +unrealizedTotal.toFixed(2),
        unrealizedPct: investedOpen > 0 ? +((unrealizedTotal / investedOpen) * 100).toFixed(2) : null,
        realized: +realizedTotal.toFixed(2),
        xirr: portfolioXirr,
        benchXirr,
        alphaPp: portfolioXirr != null && benchXirr != null ? +(portfolioXirr - benchXirr).toFixed(2) : null,
      },
      costBasis: "weighted-average",
      warnings, benchNote,
    });
  } catch (e) {
    res.json({ available: false, reason: String(e.message || e).slice(0, 140) });
  }
});

module.exports = router;
