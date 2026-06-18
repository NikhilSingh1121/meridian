# MERIDIAN — AI-Native Institutional Equity Research Platform

A full research & analytics platform — not a data dashboard. Live market
intelligence, an equity research workstation, a valuation lab, an automated
report engine, screener, portfolio analytics, and a news/sentiment desk — all
fed by **live data** and a **deterministic analytics engine** (every number is
computed, never guessed).

## Run it

```bash
npm install
npm start
```

- Public website -> http://localhost:3000
- Terminal       -> http://localhost:3000/terminal

Node 18+ required. No API key needed to start.

> Optional - AI-written reports. Copy `.env.example` to `.env` and add an
> `ANTHROPIC_API_KEY`. With a key, report narratives (thesis, SWOT, Porter,
> risks, recommendation) are written by Claude, constrained to the computed
> numbers. Without one, a deterministic commentary engine writes them. Every
> *number* is computed the same way either way.

## The eight terminal modules

1. Market Intelligence - live global tape, NSE sector heatmap, market breadth
   (advance/decline from a live universe scan), and a cross-asset engine
   computing correlation matrices, annualised volatility, max drawdown and
   momentum - with auto-generated analysis.
2. Equity Research Workstation - type any ticker -> a full workstation builds
   itself: overview, statements (income/balance/cash-flow), a 20-metric ratio
   library with trends and interpretation, variance analysis with analyst-style
   commentary, auto-selected peers with relative positioning, and a DCF
   valuation summary. Sections reveal progressively on scroll.
3. Modeling Lab - a live DCF with every assumption editable; recomputes on each
   keystroke and renders a WACC x terminal-growth sensitivity grid, plus a
   comparable-companies relative-valuation table.
4. Research Engine - generate Initiating Coverage / Sell-Side / Buy-Side / Memo
   / Earnings Review reports on a clean white page, print to PDF, download as
   .doc, or save to the Library.
5. Screener - scans a NIFTY-class universe (editable), filter on mcap, P/E,
   ROE, growth, margin, D/E, sector; sortable; with auto-discovered
   quality-at-a-reasonable-price ideas. Click any name to open it in Research.
6. Portfolio - add holdings (stored in your browser), live P/L, allocation,
   concentration, and a holdings correlation + risk decomposition.
7. News & Sentiment - live headlines with keyword-lexicon sentiment and event
   tagging (results, M&A, management, regulatory).
8. Library - server-side store of saved reports; survives restarts.

## How data flows (the architecture that matters)

```
Browser (terminal.js + terminal-modules.js)
        |  fetch /api/*
        v
Express routes  -->  Analytics engine (deterministic: ratios, DCF,
 (market, company,        variance, correlation, momentum) - NO AI here
  intel)                  |
        |                 +-> AI/narrative layer (Claude, optional) writes
        v                     prose AROUND the computed numbers
Providers
  +- yahoo.js            quotes, history, search (no key)
  +- fundamentals.js     statements via fundamentalsTimeSeries, peers, news
```

The split is the whole point: the LLM never computes a figure. Ratios, growth,
DCF, sensitivity, correlations are all pure functions in
`server/lib/analytics.js`. The AI only writes the qualitative sections, and only
from the numbers it is handed.

## API (all live)

```
GET  /api/pulse                      homepage + tape board
GET  /api/quote/:symbol              live quote
GET  /api/history/:symbol            OHLC history
GET  /api/search?q=                  symbol search
GET  /api/company/:symbol            FULL research pack
GET  /api/peers/:symbol              auto peer set + metrics
POST /api/report  {symbol,type}      structured report (computed + narrative)
POST /api/dcf     {assumptions}      recompute DCF + sensitivity
GET  /api/news/:query                headlines + sentiment + event tags
GET  /api/intel/sectors              NSE sector heatmap
GET  /api/intel/breadth              market breadth
GET  /api/intel/matrix?symbols=      correlation/vol/momentum
GET  /api/screener/run               universe scan (cached 6h)
GET  /api/quotes?symbols=            batch quotes (portfolio)
GET/POST/DELETE /api/library         research document store
```

## Data provider & upgrade path

Default: Yahoo Finance (via `yahoo-finance2`, which handles auth) - free,
covers NSE `.NS`, BSE `.BO`, US, global indices, FX, commodities, crypto.
Statements come from `fundamentalsTimeSeries` (Yahoo's current API; the old
statement modules were deprecated in late 2024).

To go to a paid/real-time feed (TrueData or Kite Connect for live NSE ticks,
Finnhub/Polygon globally), implement the same functions in a new
`server/providers/*.js` and swap the import. Quote shape is provider-agnostic.

## Structure

```
server/
  index.js                  app + routes
  cache.js                  TTL cache
  lib/analytics.js          deterministic engine (ratios, DCF, variance, stats)
  lib/ai.js                 Claude narrative <-> deterministic fallback
  providers/yahoo.js        quotes / history / search
  providers/fundamentals.js statements / peers / news
  routes/{market,company,intel}.js
public/
  index.html / styles.css / app.js           public website
  terminal.html / terminal.css               terminal shell
  terminal.js / terminal-modules.js          8 modules
```

## Deploy

Needs a Node host (it is a real backend) - Render, Railway, Fly.io, or any VPS.
Netlify alone will not run it; use Netlify for the static site + Render for the
API, or host both on Render together.

## Notes

- First Screener/Breadth load scans the universe (~30s), then caches 6h.
- If everything shows "-", your network is blocking Yahoo endpoints - try a
  different network or plug in a paid provider.
- Statement depth and some ratios vary by issuer and by what Yahoo exposes; the
  engine degrades gracefully (shows what it can compute, hides what it cannot).
