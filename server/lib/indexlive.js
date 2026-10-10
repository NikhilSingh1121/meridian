/**
 * M-TERMINAL — Index Analyser live pipeline (/api/ix/*).
 *
 * One shared computation per index, pushed to every viewer over Server-Sent Events:
 *   · price: ticks from the terminal-wide Yahoo stream (no polling) build 1-minute bars;
 *   · history: 1-minute (5 sessions, ≤ every 10 min), 5-minute (60 sessions), daily (1 y),
 *     weekly (5 y) and monthly (10 y) — all ≤ every 6 h; indices Yahoo keeps no daily history
 *     for get daily / weekly / monthly bars built from their 5-minute data;
 *   · derivatives: NSE option chain + index futures at most once a minute while open;
 *   · market context (breadth, sectors, global, FII/DII): shared, ≤ every 15 s;
 *   · analysis every 5 s while open (30 s when closed); the reliability backtest once a day
 *     in a worker thread.
 * An index nobody watches for 3 minutes stops its loop and drops its tick listener.
 *
 * SSE events: init · tick · analysis · oi · alert · bars
 * REST: /ix/indices · /ix/bars · /ix/chain · /ix/seasonality · /ix/calendar · /ix/snapshot · /ix/replay
 *
 * Replay (/ix/replay?at=…): the same analysis rebuilt from the bars that existed at that moment —
 * nothing later. Live-only inputs (breadth, sectors, global markets, VIX quote, FII/DII, option
 * chain) have no intraday history, so a replayed analysis leaves them out instead of borrowing
 * today's values. Model weights come from a walk-forward run on the sessions before that day.
 */
const express = require("express");
const Q = require("./indexquant");
const OC = require("./optionchain");
const MK = require("./ixmarket");
const S = require("../scanner/store/session");
const C = require("../cache");
const Y = require("../providers/yahoo");
const { runEvaluate } = require("./indexquant-worker");
let replayEvalQueue = Promise.resolve();   // replay-day reliability runs, one at a time across indices

const INDICES = {
  NIFTY: { y: "^NSEI", name: "NIFTY 50", oc: "NIFTY", group: "Broad market" },
  BANKNIFTY: { y: "^NSEBANK", name: "NIFTY BANK", oc: "BANKNIFTY", group: "Broad market" },
  FINNIFTY: { y: "NIFTY_FIN_SERVICE.NS", name: "NIFTY FIN SERVICE", oc: "FINNIFTY", group: "Broad market" },
  MIDCPNIFTY: { y: "NIFTY_MID_SELECT.NS", name: "NIFTY MIDCAP SELECT", oc: "MIDCPNIFTY", group: "Broad market" },
  SENSEX: { y: "^BSESN", name: "SENSEX", oc: null, group: "Broad market" },
  NIFTY500: { y: "^CRSLDX", name: "NIFTY 500", oc: null, group: "Broad market" },
  MIDCAP100: { y: "NIFTY_MIDCAP_100.NS", name: "NIFTY MIDCAP 100", oc: null, group: "Broad market" },
  SMALLCAP100: { y: "^CNXSC", name: "NIFTY SMALLCAP 100", oc: null, group: "Broad market" },
  NIFTYIT: { y: "^CNXIT", name: "NIFTY IT", oc: null, group: "Sectoral" },
  NIFTYFMCG: { y: "^CNXFMCG", name: "NIFTY FMCG", oc: null, group: "Sectoral" },
  NIFTYPHARMA: { y: "^CNXPHARMA", name: "NIFTY PHARMA", oc: null, group: "Sectoral" },
  NIFTYAUTO: { y: "^CNXAUTO", name: "NIFTY AUTO", oc: null, group: "Sectoral" },
  NIFTYMETAL: { y: "^CNXMETAL", name: "NIFTY METAL", oc: null, group: "Sectoral" },
  NIFTYREALTY: { y: "^CNXREALTY", name: "NIFTY REALTY", oc: null, group: "Sectoral" },
  NIFTYENERGY: { y: "^CNXENERGY", name: "NIFTY ENERGY", oc: null, group: "Sectoral" },
  NIFTYPSUBANK: { y: "^CNXPSUBANK", name: "NIFTY PSU BANK", oc: null, group: "Sectoral" },
  INDIAVIX: { y: "^INDIAVIX", name: "INDIA VIX", oc: null, group: "Volatility" },
};
const TICKER = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "INDIAVIX"];
const VIX = "^INDIAVIX";
const TFS = ["1m", "5m", "15m", "1h", "1d", "1wk", "1mo"];
let LIVE = null;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const r2 = (v) => (isNum(v) ? Math.round(v * 100) / 100 : null);
const r4 = (v) => (isNum(v) ? Math.round(v * 10000) / 10000 : null);
const clean = (pts) => (pts || []).filter((x) => x && x.c > 0 && x.o > 0 && x.h > 0 && x.l > 0).map((x) => ({ t: Math.floor(x.t / 60000) * 60000, o: x.o, h: x.h, l: x.l, c: x.c, v: x.v || 0 }));

/* history through the shared cache; a refused refresh falls back to the last snapshot */
async function hist(y, range, interval, ttl) {
  const key = `ix:${y}:${range}:${interval}`;
  try { return clean((await C.cachedPersistent(key, ttl, () => Y.getHistory(y, range, interval))).points); }
  catch { const s = C.snap.read(key); return s && s.value ? clean(s.value.points) : []; }
}
function prevWeek(daily, day) {
  const wk = (t) => { const d = new Date(t + Q.IST); const dow = (d.getUTCDay() + 6) % 7; return Q.dayKey(t - dow * 86400e3); };
  const cur = wk(Date.parse(day + "T06:00:00Z")), past = daily.filter((x) => wk(x.t) < cur);
  if (!past.length) return null;
  const w = wk(past[past.length - 1].t), bars = past.filter((x) => wk(x.t) === w);
  return { h: Math.max(...bars.map((x) => x.h)), l: Math.min(...bars.map((x) => x.l)), c: bars[bars.length - 1].c };
}
const fmt = (v) => (isNum(v) ? v.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—");

class Ix {
  constructor(key) {
    this.key = key; this.cfg = INDICES[key]; this.clients = new Set();
    this.b1 = []; this.b5h = []; this.d1 = []; this.w1 = []; this.m1 = []; this.lastPrice = null; this.lastTs = 0; this.tickSeq = 0; this.sentSeq = 0;
    this.fitted = null; this.fitDay = null; this.evalRes = null; this.evalDay = null; this.evalRunning = false;
    this.analysis = null; this.analysisAt = 0; this.oi = null; this.oiAt = 0; this.oiSentAt = 0; this.hist1At = 0; this.histLongAt = 0; this.beatAt = 0;
    this.loading = null; this.timer = null; this.idleSince = null; this.unsub = null;
    this.alerts = []; this.changes = []; this.cool = new Map(); this.prev = null; this.sigmaHist = []; this.dailyFc = null; this.dailyFcAt = 0;
    this.rFit = new Map(); this.rEval = new Map(); this.rCache = new Map(); this.rBusy = new Map();
  }

  /* ── data ── */
  async load() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const y = this.cfg.y, longDue = Date.now() - this.histLongAt > 6 * 3600e3 || !this.d1.length;
      const [b1, b5, d, w, m] = await Promise.all([
        hist(y, "5d", "1m", 9 * 60e3),
        longDue ? hist(y, "60d", "5m", 6 * 3600e3) : null,
        longDue ? hist(y, "1y", "1d", 6 * 3600e3) : null,
        longDue ? hist(y, "5y", "1wk", 6 * 3600e3) : null,
        longDue ? hist(y, "10y", "1mo", 6 * 3600e3) : null,
      ]);
      this.mergeHistory(b1);
      if (longDue) {
        this.b5h = b5 || this.b5h;
        // Yahoo keeps daily history for some indices only: otherwise build it from the 5-minute bars
        const fromB5 = Q.aggregate(this.b5h, "1d");
        this.d1 = d && d.length > 100 ? d : fromB5;
        this.w1 = w && w.length > 50 ? w : Q.aggregate(this.d1, "1wk");
        this.m1 = m && m.length > 24 ? m : Q.aggregate(this.d1, "1mo");
        this.shortHistory = !(d && d.length > 100);
        this.histLongAt = Date.now();
      }
      this.hist1At = Date.now();
      this.maybeEvaluate();
    })().finally(() => { this.loading = null; });
    return this.loading;
  }
  mergeHistory(bars) {
    if (!bars || !bars.length) return;
    const byT = new Map(); for (const b of bars) byT.set(b.t, b);
    const lastHist = bars[bars.length - 1].t;
    const merged = [...byT.values(), ...this.b1.filter((b) => b.t > lastHist)].sort((a, b) => a.t - b.t);
    const days = [...new Set(merged.map((b) => Q.dayKey(b.t)))].slice(-6);
    this.b1 = merged.filter((b) => days.includes(Q.dayKey(b.t)));
  }
  onTick(t) {
    if (t.s !== this.cfg.y || !(t.ltp > 0) || !S.isMarketOpen(t.ts)) return;
    const m = Math.floor(t.ts / 60000) * 60000, last = this.b1[this.b1.length - 1];
    if (last && last.t === m) { last.h = Math.max(last.h, t.ltp); last.l = Math.min(last.l, t.ltp); last.c = t.ltp; }
    else if (!last || m > last.t) this.b1.push({ t: m, o: t.ltp, h: t.ltp, l: t.ltp, c: t.ltp, v: 0 });
    this.lastPrice = t.ltp; this.lastTs = t.ts; this.tickSeq++;
  }
  maybeEvaluate() {
    const day = Q.dayKey(Date.now());
    if (this.evalDay === day || this.evalRunning || this.b5h.length < 1000) return;
    this.evalRunning = true;
    runEvaluate(this.b5h.filter((x) => Q.dayKey(x.t) < day), { days: 15, h: 30 })
      .then((r) => { this.evalRes = r; this.evalDay = day; })
      .catch((e) => console.warn(`[ix] ${this.key} reliability backtest: ${e.message}`))
      .finally(() => { this.evalRunning = false; });
  }
  async refreshOi(open) {
    if (!this.cfg.oc) return false;
    const every = open ? 60e3 : 15 * 60e3;
    if (Date.now() - this.oiAt < every) return false;
    this.oiAt = Date.now();
    const r = await OC.get(this.cfg.oc, every - 5000);
    this.oi = { data: r.data || (this.oi && this.oi.data) || null, at: r.at || (this.oi && this.oi.at) || null, error: r.error || null, expiries: r.expiries || [] };
    return true;
  }
  /** today's session bars and the session-adjusted series every timeframe uses */
  sessionView() {
    const b1 = this.b1; if (!b1.length) return null;
    const day = Q.dayKey(b1[b1.length - 1].t), today1 = Q.sessionOf(b1, day);
    const b5 = [...this.b5h.filter((x) => Q.dayKey(x.t) < day), ...Q.resample(today1, 5)];
    const todayBar = today1.length ? { t: today1[0].t, o: today1[0].o, h: Math.max(...today1.map((x) => x.h)), l: Math.min(...today1.map((x) => x.l)), c: today1[today1.length - 1].c } : null;
    const withToday = (arr, unit) => {
      if (!todayBar) return arr;
      const key = (t) => { if (unit === "1d") return Q.dayKey(t); if (unit === "1mo") return Q.dayKey(t).slice(0, 7); const dow = (new Date(t + Q.IST).getUTCDay() + 6) % 7; return Q.dayKey(t - dow * 86400e3); };
      const out = arr.slice(), last = out[out.length - 1];
      if (last && key(last.t) === key(todayBar.t)) {
        if (unit === "1d") out[out.length - 1] = { ...last, ...todayBar, t: last.t };
        else out[out.length - 1] = { ...last, h: Math.max(last.h, todayBar.h), l: Math.min(last.l, todayBar.l), c: todayBar.c };
      } else if (!last || todayBar.t > last.t) out.push({ ...todayBar });
      return out;
    };
    return { day, today1, b5, d1: withToday(this.d1, "1d"), w1: withToday(this.w1, "1wk"), m1: withToday(this.m1, "1mo") };
  }
  /** replay: the series exactly as they stood at time `at` — completed bars before `at`, nothing later.
      1-minute bars cover the last ~5 sessions; earlier days fall back to 5-minute bars. */
  viewAt(at) {
    const b1 = this.b1.filter((b) => b.t + 60e3 <= at), b5p = this.b5h.filter((b) => b.t + 300e3 <= at);
    // the session in force: the last day with a completed bar before `at` (weekends, holidays and after-hours resolve to it)
    const lastT = Math.max(b1.length ? b1[b1.length - 1].t : 0, b5p.length ? b5p[b5p.length - 1].t : 0);
    if (!lastT) return null;
    const day = Q.dayKey(lastT);
    let today1 = Q.sessionOf(b1, day), barMin = 1;
    if (!today1.length) { today1 = Q.sessionOf(b5p, day); barMin = 5; }
    if (!today1.length) return null;
    const b5 = [...this.b5h.filter((x) => Q.dayKey(x.t) < day), ...(barMin === 5 ? today1 : Q.resample(today1, 5))];
    const todayBar = { t: today1[0].t, o: today1[0].o, h: Math.max(...today1.map((x) => x.h)), l: Math.min(...today1.map((x) => x.l)), c: today1[today1.length - 1].c };
    const dBar = this.d1.find((x) => Q.dayKey(x.t) === day);
    const d1 = [...this.d1.filter((x) => Q.dayKey(x.t) < day), { ...todayBar, t: dBar ? dBar.t : todayBar.t }];
    const wk = (t) => { const dow = (new Date(t + Q.IST).getUTCDay() + 6) % 7; return Q.dayKey(t - dow * 86400e3); }, mo = (t) => Q.dayKey(t).slice(0, 7);
    const cut = (arr, key, unit) => { const k = key(lastT); return [...arr.filter((x) => key(x.t) < k), ...Q.aggregate(d1.filter((x) => key(x.t) === k), unit)]; };
    return { day, today1, b1, b5, barMin, d1, w1: cut(this.w1, wk, "1wk"), m1: cut(this.m1, mo, "1mo") };
  }
  fitFor(day) {
    if (!this.rFit.has(day)) { this.rFit.set(day, Q.fit(this.b5h.filter((x) => Q.dayKey(x.t) < day))); if (this.rFit.size > 12) this.rFit.delete(this.rFit.keys().next().value); }
    return this.rFit.get(day);
  }
  /** reliability weights for a replayed day: walk-forward on the sessions before it (worker thread; null until ready) */
  evalFor(day) {
    if (this.rEval.has(day)) return this.rEval.get(day);
    this.rEval.set(day, null); if (this.rEval.size > 10) this.rEval.delete(this.rEval.keys().next().value);
    const hist = this.b5h.filter((x) => Q.dayKey(x.t) < day);
    if (hist.length < 1000) { this.rEval.set(day, false); return false; }   // too few earlier sessions: equal weights
    replayEvalQueue = replayEvalQueue.then(() => runEvaluate(hist, { days: 15, h: 30 }).then((r) => this.rEval.set(day, r)).catch(() => this.rEval.delete(day)));
    return null;
  }
  /** cached, de-duplicated replay analysis for a minute */
  async replayAt(at) {
    const v = this.viewAt(at); if (!v) return null;
    const key = `${at}|${this.rEval.get(v.day) ? 1 : 0}`;
    if (this.rCache.has(key)) return this.rCache.get(key);
    if (this.rBusy.has(key)) return this.rBusy.get(key);
    const p = this.compute(at).then((a) => { this.rCache.set(key, a); if (this.rCache.size > 150) this.rCache.delete(this.rCache.keys().next().value); return a; }).finally(() => this.rBusy.delete(key));
    this.rBusy.set(key, p);
    return p;
  }
  barsFor(tf, full = false) {
    const v = this.sessionView(); if (!v) return [];
    const recent = (bars, days) => { if (full) return bars; const keys = [...new Set(bars.map((b) => Q.dayKey(b.t)))].slice(-days); return bars.filter((b) => keys.includes(Q.dayKey(b.t))); };
    switch (tf) {
      case "1m": return recent(this.b1, 3);
      case "5m": return recent(v.b5, 12);
      case "15m": return Q.resample(recent(v.b5, 30), 15);
      case "1h": return Q.resample(v.b5, 60);
      case "1d": return v.d1;
      case "1wk": return v.w1;
      case "1mo": return v.m1;
      default: return [];
    }
  }

  /* ── analysis ── */
  async compute(at) {
    const replay = isNum(at);
    if ((!replay && this.b1.length < 30) || this.b5h.length < 200) return null;
    const v = replay ? this.viewAt(at) : this.sessionView(); if (!v || !v.today1.length) return null;
    const now = replay ? at : Date.now(), status = S.marketStatus(now), open = status.open, { day, today1, b5 } = v;
    const last = !replay && open && this.lastPrice ? this.lastPrice : today1[today1.length - 1].c;
    const prevDays = v.d1.filter((x) => Q.dayKey(x.t) < day), pd = prevDays[prevDays.length - 1] || null;
    const today = { o: today1[0].o, h: Math.max(...today1.map((x) => x.h)), l: Math.min(...today1.map((x) => x.l)) };
    const orbBars = today1.filter((x) => Q.minuteOfDay(x.t) < Q.OPEN_MIN + 15);
    const orb = orbBars.length ? { h: Math.max(...orbBars.map((x) => x.h)), l: Math.min(...orbBars.map((x) => x.l)) } : null;
    const adr = prevDays.length >= 5 ? prevDays.slice(-10).reduce((a, x) => a + (x.h - x.l), 0) / Math.min(10, prevDays.length) : null;
    const tech = Q.technicals(b5.slice(-300), today1);
    const minuteNow = open ? S.istParts(now).min : Q.CLOSE_MIN;
    const minutesIn = Math.max(0, Math.min(minuteNow, Q.CLOSE_MIN) - Q.OPEN_MIN);
    // live-only inputs are left out of a replay (no intraday history exists for them)
    const vq = !replay && LIVE && LIVE.quote(VIX);
    const vixChgPct = vq && vq.prevClose ? ((vq.price / vq.prevClose) - 1) * 100 : null;
    const market = replay ? null : await MK.get();
    const vix = vq ? { price: r2(vq.price), changePct: r4(vixChgPct) } : (market && market.ticker && market.ticker.INDIAVIX) || null;
    const setup = Q.setup({ tech, last, orb, today, prevDay: pd, open, vixChgPct, minutesIn });
    const lv = Q.levels({ last, prevDay: pd ? { h: pd.h, l: pd.l, c: pd.c } : null, prevWeek: prevWeek(v.d1, day), today, orb: minutesIn >= 15 ? orb : null, adr, bars5: b5.slice(-450) });
    const oi = replay ? null : this.oi && this.oi.data;
    if (oi) {
      const add = (key, label, price) => isNum(price) && lv.push({ key, label, price: r2(price), group: "options", kind: price >= last ? "resistance" : "support" });
      if (oi.callWall) add("CW", `Call wall (max CE OI ${Math.round(oi.callWall.oi / 1000)}k)`, oi.callWall.strike);
      if (oi.putWall) add("PW", `Put wall (max PE OI ${Math.round(oi.putWall.oi / 1000)}k)`, oi.putWall.strike);
      add("MP", "Max pain", oi.maxPain);
      lv.sort((a, b) => b.price - a.price);
    }
    // multi-timeframe
    const oneMin = replay ? (v.barMin === 1 ? v.b1 : []) : this.b1;
    const mtf = Q.multiTimeframe({ "1m": v.barMin === 5 ? null : today1.length >= 30 ? today1 : oneMin.slice(-120), "5m": b5.slice(-200), "15m": Q.resample(b5.slice(-600), 15), "1h": Q.resample(b5, 60).slice(-200), "1d": v.d1.slice(-250), "1wk": v.w1.slice(-200), "1mo": v.m1 });
    // intraday forecast with bands widened by the measured under-coverage
    if (!replay && this.fitDay !== day) { this.fitted = Q.fit(this.b5h.filter((x) => Q.dayKey(x.t) < day)); this.fitDay = day; }
    const fitted = replay ? this.fitFor(day) : this.fitted, evalRes = replay ? this.evalFor(day) : this.evalRes;
    const ens = evalRes && evalRes.stats.ensemble;
    const k = ens && ens.coverage80 ? Math.max(0.85, Math.min(1.6, Q.invPhi(0.9) / Q.invPhi(0.5 + ens.coverage80 / 2))) : 1;
    let fc = null;
    if (open && minuteNow <= Q.CLOSE_MIN - 5 && minutesIn >= 5) {
      fc = Q.forecast({ last, b1today: today1, barMin: v.barMin || 1, b5, fitted, weights: evalRes && evalRes.weights, minuteNow, twapNow: tech && tech.twap });
      if (fc && k !== 1) {
        const widen = (st) => { const med = Math.log(st.q[2] / last); st.q = st.q.map((x) => r2(last * Math.exp(med + k * (Math.log(x / last) - med)))); };
        fc.ensemble.steps.forEach(widen); Object.values(fc.models).forEach((m) => m.steps.forEach(widen));
        fc.ensemble.steps.forEach((s) => (s.sdLog = r4(s.sdLog * k)));
      }
    }
    // multi-day forecast (daily / weekly / monthly charts); refreshed each minute
    let dailyFc = this.dailyFc;
    if (replay || !this.dailyFc || now - this.dailyFcAt > 60e3) {
      const dSeries = v.d1.map((x, i, a) => (i === a.length - 1 ? { ...x, c: last } : x));
      dailyFc = Q.forecastDaily(dSeries, { horizons: [1, 2, 3, 5, 10, 21, 42, 63, 126], ivPct: oi && oi.atmIv });
      if (!replay) { this.dailyFc = dailyFc; this.dailyFcAt = now; }
    }
    // touch probabilities to the close (next session's 1-σ when closed)
    const end = fc && fc.ensemble.steps[fc.ensemble.steps.length - 1];
    const d1Step = dailyFc && dailyFc.ensemble.steps[0];
    const mu = end ? Math.log(end.q[2] / last) : 0, sd = end ? end.sdLog : d1Step ? d1Step.sdLog : null;
    for (const l of lv) l.pTouch = r4(Q.touchProb(last, l.price, mu, sd));
    const near = lv.filter((l) => Math.abs(l.price / last - 1) > 0.0002);
    const up = near.filter((l) => l.price > last).sort((a, b) => a.price - b.price)[0] || null;
    const down = near.filter((l) => l.price < last).sort((a, b) => b.price - a.price)[0] || null;
    const atr5 = tech && tech.atr;
    const breakout = {
      up: up && { ...up, distPct: r4((up.price / last - 1) * 100), distAtr: atr5 ? r2((up.price - last) / atr5) : null },
      down: down && { ...down, distPct: r4((down.price / last - 1) * 100), distAtr: atr5 ? r2((last - down.price) / atr5) : null },
      watch: tech && atr5 && up && down ? ((up.price - last) / atr5 <= 0.75 && setup.bias > 15 ? "up" : (last - down.price) / atr5 <= 0.75 && setup.bias < -15 ? "down" : null) : null,
    };
    // scenarios: intraday (to the close), one week, one month
    const dSteps = (hs) => dailyFc ? dailyFc.ensemble.steps.filter((s) => hs.includes(s.h)) : null;
    // swing scenarios use structural levels only (weekly pivots, swings, OI walls, outer daily pivots) — not intraday ones
    const swingLv = lv.filter((l) => ["weekly", "swing", "options"].includes(l.group) || ["R2", "R3", "S2", "S3", "PDH", "PDL"].includes(l.key));
    const sc = {
      intraday: fc ? Q.scenarios(last, fc.ensemble.steps, lv, { horizonLabel: `to the close (${fc.minutesToClose} min)`, atr: atr5 }) : null,
      week: dailyFc ? Q.scenarios(last, dSteps([1, 2, 3, 5]), swingLv, { horizonLabel: "next 1 week", atr: adr }) : null,
      sessions: dailyFc ? Q.scenarios(last, dSteps([1, 2, 3]), swingLv, { horizonLabel: "next 1–3 sessions", atr: adr }) : null,
      month: dailyFc ? Q.scenarios(last, dSteps([1, 5, 10, 21]), swingLv, { horizonLabel: "next 1 month", atr: adr }) : null,
    };
    // regime engine
    const atrHist = []; { const at = Q.atr(b5.slice(-900), 14), cs = b5.slice(-900).map((x) => x.c); for (let i = 20; i < at.length; i += 6) atrHist.push(at[i] / cs[i] * 100); }
    const atrPctMedian = atrHist.length ? atrHist.sort((a, b) => a - b)[Math.floor(atrHist.length / 2)] : null;
    const reg = Q.regime({ tech, mtf, orb: minutesIn >= 15 ? orb : null, last, breadth: market && market.breadth, sectors: market && market.sectors, vix, oi, futures: oi && oi.futures, globalTone: market && market.globalTone, positioning: market && market.positioning, atrPctMedian, open, prevLabel: !replay && this.prev && this.prev.regime && this.prev.regime.label });
    // whole-session analogs for the chart (paths in price terms, the fitted mean and percentile bands ahead)
    const sa = fc && fc.sessionAnalogs;
    let analogs = null;
    if (sa && sa.analogs.length >= 6 && pd) {
      const open0 = S.sessionOpenTs(today1[0].t), tOf = (slot) => open0 + (slot + 1) * 300e3, px = (r) => r2(pd.c * Math.exp(r));
      const slots = [...new Set(sa.analogs.flatMap((a) => a.path.map((p) => p.slot)))].sort((x, y) => x - y);
      // every analog is shifted so it passes through today's current level: the drawing, the fitted mean and the probability then all describe moves from here
      const shift = new Map(sa.analogs.map((a) => { const p = a.path.find((q) => q.slot === sa.slotNow); return [a, p ? sa.rNow - p.r : 0]; }));
      const at = (a, sl) => { const p = a.path.find((q) => q.slot === sl); return p ? p.r + shift.get(a) : null; };
      const qs = (arr, q) => { const v = arr.slice().sort((x, y) => x - y); return v[Math.min(v.length - 1, Math.max(0, Math.round(q * (v.length - 1))))]; };
      analogs = {
        n: sa.analogs.length, slotNow: sa.slotNow,
        paths: sa.analogs.map((a) => ({ day: a.day, dist: r4(a.dist * 1e4), pts: a.path.map((p) => [tOf(p.slot), px(p.r + shift.get(a))]) })),
        fit: slots.map((sl) => { const v = sa.analogs.map((a) => at(a, sl)).filter(isNum); return v.length ? [tOf(sl), px(v.reduce((x, y) => x + y, 0) / v.length)] : null; }).filter(Boolean),
        bands: slots.filter((sl) => sl >= sa.slotNow).map((sl) => { const v = sa.analogs.map((a) => at(a, sl)).filter(isNum); return v.length >= 4 ? { t: tOf(sl), q: [0.1, 0.25, 0.5, 0.75, 0.9].map((q) => px(qs(v, q))) } : null; }).filter(Boolean),
        pUpClose: r4(sa.analogs.filter((a) => a.path.length && a.path[a.path.length - 1].r + shift.get(a) > sa.rNow).length / sa.analogs.length),
        days: sa.analogs.map((a) => a.day),
      };
    }
    // realised volatility (annualised, close-to-close) and the 1-day expected move
    const rv = (n) => { const c = v.d1.slice(-(n + 1)).map((x) => x.c); if (c.length < n + 1) return null; const r = []; for (let i = 1; i < c.length; i++) r.push(Math.log(c[i] / c[i - 1])); const m = r.reduce((x, y) => x + y, 0) / r.length; return r2(Math.sqrt(r.reduce((x, y) => x + (y - m) ** 2, 0) / (r.length - 1)) * Math.sqrt(252) * 100); };
    const volatility = { rv5: rv(5), rv10: rv(10), rv20: rv(20), rv60: rv(60), atmIv: oi ? oi.atmIv : null, atmIvChange: oi ? oi.atmIvChange : null, expectedMove1dPct: d1Step ? r4((Math.exp(d1Step.sdLog) - 1) * 100) : null, impliedMove1dPct: oi && oi.atmIv ? r4(oi.atmIv / Math.sqrt(252)) : null, atrPct5m: tech ? tech.atrPct : null };
    const prevClose = pd ? pd.c : null;
    const a = {
      key: this.key, name: this.cfg.name, group: this.cfg.group, hasOi: !!this.cfg.oc, shortHistory: !!this.shortHistory, asOf: now, status,
      last: r2(last), prevClose: r2(prevClose), change: prevClose ? r2(last - prevClose) : null, changePct: prevClose ? r4((last / prevClose - 1) * 100) : null,
      today, orb, adr: r2(adr), vix, tech, setup, regime: reg, mtf, levels: lv, breakout, scenarios: sc, volatility,
      forecast: fc && { ensemble: fc.ensemble, models: fc.models, minutesToClose: fc.minutesToClose, sigma1: r4(fc.sigma1), bandInflation: r4(k), neighbours: fc.neighbours },
      forecastDaily: dailyFc, analogs,
      reliability: evalRes ? { horizon: evalRes.horizon, sessions: evalRes.sessions, stats: Object.fromEntries(Object.entries(evalRes.stats).map(([kk, s]) => [kk, { samples: s.samples, coverage50: s.coverage50, coverage80: s.coverage80, hitRate: s.hitRate, leaned: s.leaned }])), weights: evalRes.weights } : { pending: true },
      fitted: fitted && { momentumBeta: r4(fitted.beta), reversionPhi5: r4(fitted.phi5), sessions: fitted.sessions },
      oi: oi ? this.oiSummary() : replay ? null : this.cfg.oc ? { error: (this.oi && this.oi.error) || "loading option chain…" } : null,
      market,
    };
    if (replay) { a.replay = { at, day, barMin: v.barMin, weights: evalRes ? "walk-forward before this day" : evalRes === false ? "equal (too few earlier sessions)" : "pending" }; a.alerts = []; a.changes = []; return a; }
    if (fc) { this.sigmaHist.push({ t: now, s: fc.sigma1 }); this.sigmaHist = this.sigmaHist.filter((x) => now - x.t < 45 * 60e3); }
    this.detect(a, today1);
    a.alerts = this.alerts.slice(0, 20); a.changes = this.changes.slice(0, 20);
    this.prev = a;
    return a;
  }
  oiSummary() {
    const d = this.oi && this.oi.data; if (!d) return null;
    const { chain, profile, flow, flowLog, ...rest } = d;
    return { ...rest, at: this.oi.at, error: this.oi.error };
  }

  /* ── smart alerts + "what changed" ─────────────────────────────────────
     Alerts fire only when every stated condition holds, with a 10-minute cool-down per
     rule; each says which conditions were met. Index prices carry no volume on the free
     feed, so "volume confirmation" is replaced by breadth confirmation (A/D ratio). */
  detect(a, today1) {
    const p = this.prev, now = Date.now(), b = a.market && a.market.breadth, t = a.tech || {};
    const fire = (rule, severity, title, text) => {
      const ck = rule; if (this.cool.has(ck) && now - this.cool.get(ck) < 10 * 60e3) return;
      this.cool.set(ck, now);
      const al = { id: `${this.key}-${now}-${rule}`, ts: now, index: this.key, name: this.cfg.name, rule, severity, title, text, price: a.last };
      this.alerts.unshift(al); this.alerts = this.alerts.slice(0, 50);
      this.broadcast("alert", al);
      this.note(`Alert — ${title}`);
    };
    if (p && a.status.open) {
      const crossed = (lvl) => isNum(lvl) && ((p.last < lvl && a.last >= lvl) ? 1 : (p.last > lvl && a.last <= lvl) ? -1 : 0);
      const closes = today1.slice(-2).map((x) => x.c);
      // 1 · TWAP (session-average) cross, confirmed by the last two 1-min closes and breadth
      const tc = crossed(t.twap);
      if (tc && closes.every((c) => (tc > 0 ? c >= t.twap : c <= t.twap))) {
        const conf = b && isNum(b.adRatio) && (tc > 0 ? b.adRatio > 1.1 : b.adRatio < 0.9);
        fire(`twap${tc}`, conf ? "high" : "info", `${this.cfg.name} crossed ${tc > 0 ? "above" : "below"} the session average (TWAP ${fmt(t.twap)})`,
          `Held for two 1-min closes.${conf ? ` Breadth confirms (A/D ${b.adRatio}).` : " Breadth does not confirm yet."}`);
      }
      // 2 · opening-range break while breadth improves
      if (a.orb && Q.OPEN_MIN + 15 <= S.istParts(now).min) {
        const oc = crossed(a.orb.h) > 0 ? 1 : crossed(a.orb.l) < 0 ? -1 : 0;
        const pb = p.market && p.market.breadth;
        const improving = b && pb && isNum(b.adRatio) && isNum(pb.adRatio) ? (oc > 0 ? b.adRatio >= pb.adRatio && b.adRatio > 1 : b.adRatio <= pb.adRatio && b.adRatio < 1) : false;
        if (oc) fire(`orb${oc}`, improving ? "high" : "info", `Opening-range ${oc > 0 ? "high" : "low"} broken at ${fmt(oc > 0 ? a.orb.h : a.orb.l)}`, improving ? `Breadth ${oc > 0 ? "improving" : "weakening"} (A/D ${b.adRatio}).` : "Breadth is not confirming — breakouts without participation fail more often.");
      }
      // 3 · key level breaks; support breaks need bearish momentum and derivatives alignment
      for (const l of a.levels.filter((x) => ["R1", "R2", "S1", "S2", "PDH", "PDL", "CW", "PW", "DH", "DL"].includes(x.key))) {
        const c = crossed(l.price); if (!c) continue;
        if (c < 0 && /^(S|PDL|PW|DL)/.test(l.key)) {
          const mom = t.macdHist < 0 && t.supertrend < 0, der = a.oi && ((isNum(a.oi.pcr) && p.oi && isNum(p.oi.pcr) && a.oi.pcr < p.oi.pcr) || (a.oi.futures && a.oi.futures.buildup === "Short build-up"));
          fire(`brk-${l.key}`, mom && der ? "high" : "warn", `Support broken: ${l.label} ${fmt(l.price)}`, `${mom ? "Bearish momentum (MACD < signal, Supertrend down)" : "Momentum not yet bearish"}${der ? " · derivatives align (PCR falling / futures short build-up)" : ""}.`);
        } else if (c > 0 && /^(R|PDH|CW|DH)/.test(l.key)) {
          const mom = t.macdHist > 0 && t.supertrend > 0;
          fire(`brk-${l.key}`, mom ? "high" : "info", `Resistance cleared: ${l.label} ${fmt(l.price)}`, mom ? "Momentum confirms (MACD > signal, Supertrend up)." : "Momentum not yet confirming.");
        }
      }
      // 4 · approaching a breakout level with the bias behind it
      if (a.breakout.watch) { const lvl = a.breakout[a.breakout.watch]; fire(`near-${lvl.key}`, "info", `Approaching ${lvl.label} ${fmt(lvl.price)} (${Math.abs(lvl.distAtr)} ATR away)`, `Setup bias ${a.setup.bias > 0 ? "+" : ""}${a.setup.bias}; P(touch by close) ${Math.round((lvl.pTouch || 0) * 100)}%.`); }
      // 5 · volatility expansion
      const old = this.sigmaHist.find((x) => now - x.t >= 25 * 60e3);
      if (a.forecast && old && a.forecast.sigma1 > 1.8 * old.s) fire("volx", "warn", "Volatility expansion", `1-minute volatility is ${(a.forecast.sigma1 / old.s).toFixed(1)}× what it was 30 minutes ago — ranges widen, stops get hit more easily.`);
      if (a.vix && p.vix && isNum(a.vix.changePct) && isNum(p.vix.changePct) && a.vix.changePct - p.vix.changePct >= 3) fire("vix", "warn", `India VIX jumped to ${a.vix.price}`, `Up ${(a.vix.changePct - p.vix.changePct).toFixed(1)} pts of % since the last reading.`);
      // 6 · sudden OI change between option-chain snapshots
      const fl = this.oi && this.oi.data && this.oi.data.flow && this.oi.data.flow[0], tot = this.oi && this.oi.data && this.oi.data.totals;
      if (fl && tot && Math.abs(fl.dOi) > 0.01 * (fl.type === "CE" ? tot.ceOi : tot.peOi) && this.oi.at > now - 70e3) fire(`oi-${fl.strike}${fl.type}`, "warn", `Sudden OI change: ${fl.strike} ${fl.type} ${fl.dOi > 0 ? "+" : ""}${Math.round(fl.dOi / 1000)}k in a minute`, `${fl.buildup || "Price/OI reading unclear"} — OI alone is not proof of direction.`);
    }
    // what changed (setup, regime, dominant scenario, probabilities)
    if (p) {
      if (p.regime && a.regime.label !== p.regime.label) this.note(`Regime: ${p.regime.label} → ${a.regime.label} (score ${p.regime.score} → ${a.regime.score})`);
      else if (p.regime && Math.abs(a.regime.score - p.regime.score) >= 8) this.note(`Regime score ${p.regime.score} → ${a.regime.score}`);
      if (p.setup && a.setup.label !== p.setup.label) this.note(`Setup: ${p.setup.label} → ${a.setup.label}`);
      const dom = (s) => s && ["bull", "base", "bear"].reduce((x, y) => (s[y].p > s[x].p ? y : x), "base");
      const ps = p.scenarios && p.scenarios.intraday, cs = a.scenarios && a.scenarios.intraday;
      if (ps && cs && dom(ps) !== dom(cs)) this.note(`Most likely scenario (to close): ${dom(ps)} → ${dom(cs)} (${Math.round(cs[dom(cs)].p * 100)}%)`);
      else if (ps && cs && Math.abs(cs.bull.p - ps.bull.p) >= 0.1) this.note(`Bullish scenario ${Math.round(ps.bull.p * 100)}% → ${Math.round(cs.bull.p * 100)}%`);
    }
  }
  note(text) { this.changes.unshift({ ts: Date.now(), text }); this.changes = this.changes.slice(0, 30); }

  /* ── push ── */
  send(res, event, data) { try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); if (res.flush) res.flush(); } catch { this.clients.delete(res); } }
  broadcast(event, data) { for (const res of this.clients) this.send(res, event, data); }
  async attach(req, res) {
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders && res.flushHeaders();
    this.clients.add(res); this.idleSince = null;
    req.on("close", () => { this.clients.delete(res); if (!this.clients.size) this.idleSince = Date.now(); });
    this.start();
    try { if (!this.b5h.length) await this.load(); } catch (e) { this.send(res, "error", { message: "history unavailable right now" }); }
    if (!this.analysis || Date.now() - this.analysisAt > 5000) { try { await this.refreshOi(S.isMarketOpen()); } catch { } this.analysis = await this.compute().catch(() => null); this.analysisAt = Date.now(); }
    this.send(res, "init", { meta: { key: this.key, name: this.cfg.name, hasOi: !!this.cfg.oc }, analysis: this.analysis });
    if (this.oi && this.oi.data) this.send(res, "oi", { ...this.oi.data, at: this.oi.at, error: this.oi.error, expiries: this.oi.expiries });
  }
  start() {
    if (this.timer) return;
    if (LIVE) { LIVE.ensure([this.cfg.y, VIX, ...TICKER.map((k) => INDICES[k].y)]); this.unsub = LIVE.onTicks((t) => this.onTick(t)); }
    this.timer = setInterval(() => this.loop().catch(() => {}), 1000);
    if (this.timer.unref) this.timer.unref();
  }
  stop() { clearInterval(this.timer); this.timer = null; if (this.unsub) this.unsub(); this.unsub = null; }
  async loop() {
    const now = Date.now(), open = S.isMarketOpen(now);
    if (!this.clients.size) { if (this.idleSince && now - this.idleSince > 3 * 60e3) this.stop(); return; }
    if (this.tickSeq !== this.sentSeq && this.b1.length) { this.sentSeq = this.tickSeq; this.broadcast("tick", { bar: this.b1[this.b1.length - 1], price: this.lastPrice, ts: this.lastTs }); }
    if (now - this.hist1At > 10 * 60e3 && !this.loading) { await this.load().catch(() => {}); this.broadcast("bars", { at: now }); }
    if (now - this.analysisAt >= (open ? 5000 : 30000)) {
      this.analysisAt = now;
      const fresh = await this.refreshOi(open).catch(() => false);
      const a = await this.compute().catch((e) => { console.warn(`[ix] ${this.key} analysis: ${e.message}`); return null; });
      if (a) { this.analysis = a; this.broadcast("analysis", a); }
      if (fresh && this.oi && this.oi.data) this.broadcast("oi", { ...this.oi.data, at: this.oi.at, error: this.oi.error, expiries: this.oi.expiries });
    }
    if (now - this.beatAt > 15000) { this.beatAt = now; for (const res of this.clients) { try { res.write(": beat\n\n"); if (res.flush) res.flush(); } catch { this.clients.delete(res); } } }
  }
}

const ixs = new Map();
const get = (key) => { const k = String(key || "").toUpperCase(); if (!INDICES[k]) return null; if (!ixs.has(k)) ixs.set(k, new Ix(k)); return ixs.get(k); };

function mount(app, live) {
  LIVE = live; MK.setLive(live);
  const r = express.Router();
  r.get("/ix/indices", (_req, res) => res.json({ indices: Object.entries(INDICES).map(([k, v]) => ({ key: k, name: v.name, group: v.group, options: !!v.oc, yahoo: v.y })), ticker: TICKER }));
  r.get("/ix/stream", (req, res) => { const ix = get(req.query.symbol || "NIFTY"); if (!ix) return res.status(404).json({ error: "unknown index" }); ix.attach(req, res); });
  r.get("/ix/bars", async (req, res) => {
    const ix = get(req.query.symbol || "NIFTY"), tf = TFS.includes(req.query.tf) ? req.query.tf : "5m";
    if (!ix) return res.status(404).json({ error: "unknown index" });
    try { if (!ix.b5h.length) await ix.load(); res.json({ symbol: ix.key, tf, bars: ix.barsFor(tf, req.query.full === "1"), shortHistory: !!ix.shortHistory }); }
    catch { res.status(502).json({ error: "bars unavailable right now" }); }
  });
  r.get("/ix/chain", async (req, res) => {
    const ix = get(req.query.symbol || "NIFTY"); if (!ix || !ix.cfg.oc) return res.status(404).json({ error: "no listed options for this index" });
    try { const x = await OC.get(ix.cfg.oc, 60e3, req.query.expiry ? String(req.query.expiry).slice(0, 20) : null); res.json({ data: x.data, at: x.at, error: x.error, expiries: x.expiries }); }
    catch { res.status(502).json({ error: "option chain unavailable right now" }); }
  });
  r.get("/ix/seasonality", async (req, res) => {
    const ix = get(req.query.symbol || "NIFTY"); if (!ix) return res.status(404).json({ error: "unknown index" });
    try { if (!ix.b5h.length) await ix.load(); res.json(Q.seasonality(ix.b5h, ix.d1)); } catch { res.status(502).json({ error: "seasonality unavailable" }); }
  });
  r.get("/ix/calendar", async (_req, res) => {
    const exp = {};
    for (const k of ["NIFTY", "BANKNIFTY", "FINNIFTY"]) { try { exp[k] = (await OC.get(k, 15 * 60e3)).expiries.slice(0, 6); } catch { exp[k] = []; } }
    res.json({ expiries: exp, holidays: S.holidayList().filter((h) => h.date >= Q.dayKey(Date.now())).slice(0, 12) });
  });
  /* index lot sizes from NSE's F&O lot file (the planner pre-fills them; they change every few months) */
  r.get("/ix/lots", async (_req, res) => {
    try { const lots = await C.cached("ix:lots", 12 * 3600e3, async () => (await require("../scanner/data/loader").loadUniverse("fno", { dir: require("path").join(__dirname, "..", "data", "scanner") })).indexLots || {}); res.json({ lots }); }
    catch { res.json({ lots: {} }); }
  });
  r.get("/ix/replay", async (req, res) => {
    const ix = get(req.query.symbol || "NIFTY"); if (!ix) return res.status(404).json({ error: "unknown index" });
    const at = Math.floor(Number(req.query.at) / 60000) * 60000;
    if (!isNum(at) || at > Date.now() || at < Date.now() - 400 * 86400e3) return res.status(400).json({ error: "Pick a moment inside the loaded history." });
    try {
      if (!ix.b5h.length) await ix.load();
      const a = await ix.replayAt(at);
      res.json(a || { error: "No intraday bars for that moment — the replayed forecast covers the sessions in Yahoo's 5-minute history (about 60). Candles and patterns still replay." });
    } catch { res.status(502).json({ error: "replay unavailable right now" }); }
  });
  r.get("/ix/snapshot", async (req, res) => {
    const ix = get(req.query.symbol || "NIFTY"); if (!ix) return res.status(404).json({ error: "unknown index" });
    try { if (!ix.b5h.length) await ix.load(); await ix.refreshOi(S.isMarketOpen()); res.json((await ix.compute()) || { error: "not enough data yet" }); }
    catch (e) { res.status(502).json({ error: "index data unavailable right now" }); }
  });
  app.use("/api", r);
}

module.exports = { mount, INDICES, _get: get };
