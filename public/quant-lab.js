/* ════════════════════════════════════════════════════════════════════════════
   MERIDIAN — QUANT LAB (terminal module)

   Four research desks over the /api/quant/* engines:
     · Strategy Backtester   — rules, parameter surface, walk-forward, bootstrap
     · Factor Attribution    — multi-factor OLS with HAC inference
     · Pairs & Cointegration — Engle-Granger spread trading
     · Return Profile        — tail risk, drawdowns, seasonality, efficiency

   Every panel is a view over server-computed JSON. Nothing is estimated here;
   this file formats and draws.

   Depends on globals from terminal.js: $, $$, api, esc, F.
   ════════════════════════════════════════════════════════════════════════════ */

/* ── palette (canvas needs literals, these mirror terminal.css tokens) ── */
const QL_C = {
  amber: "#c8862a", amberBright: "#e8a33d",
  up: "#2e9e6b", down: "#c84b3c",
  fg: "#e8eaed", muted: "#8a93a0", mutedInk: "#6b7280",
  hairline: "#232a33", ink: "#0a0c10", ink2: "#11151c", ink3: "#151a21",
  blue: "#5b8dd6", violet: "#9b7ede",
};

/* ── formatters ─────────────────────────────────────────────────────────── */
const QF = {
  pct(v, dp = 1) { return v == null || !Number.isFinite(v) ? "—" : (v >= 0 ? "+" : "") + (v * 100).toFixed(dp) + "%"; },
  pctAbs(v, dp = 1) { return v == null || !Number.isFinite(v) ? "—" : (v * 100).toFixed(dp) + "%"; },
  num(v, dp = 2) { return v == null || !Number.isFinite(v) ? "—" : v.toFixed(dp); },
  x(v, dp = 2) { return v == null || !Number.isFinite(v) ? "—" : (v === Infinity ? "∞" : v.toFixed(dp) + "×"); },
  bp(v) { return v == null || !Number.isFinite(v) ? "—" : (v * 10000).toFixed(1) + " bp"; },
  int(v) { return v == null || !Number.isFinite(v) ? "—" : Math.round(v).toLocaleString("en-IN"); },
  p(v) {
    if (v == null || !Number.isFinite(v)) return "—";
    if (v < 0.0001) return "<0.0001";
    return v.toFixed(4);
  },
  /** Significance star ladder — the reader shouldn't have to decode p-values. */
  stars(p) { return p == null ? "" : p < 0.01 ? "***" : p < 0.05 ? "**" : p < 0.10 ? "*" : ""; },
  date(s) { return s || "—"; },
  bars(n) {
    if (n == null || !Number.isFinite(n)) return "—";
    if (n < 21) return n + "d";
    if (n < 252) return (n / 21).toFixed(1) + "mo";
    return (n / 252).toFixed(1) + "y";
  },
  cls(v, invert = false) {
    if (v == null || !Number.isFinite(v)) return "";
    const good = invert ? v < 0 : v > 0;
    return v === 0 ? "" : good ? "up" : "down";
  },
};

/* ── colour ramps ───────────────────────────────────────────────────────── */
/** Diverging amber(+)/blue(−) ramp used by correlation and surface heatmaps. */
function qlDiverge(v, max) {
  if (v == null || !Number.isFinite(v) || !max) return "background:var(--ink-3)";
  const t = Math.min(1, Math.abs(v) / max);
  return v >= 0
    ? `background:rgba(200,134,42,${(0.08 + t * 0.62).toFixed(3)})`
    : `background:rgba(91,141,214,${(0.08 + t * 0.62).toFixed(3)})`;
}
/** Green(+)/red(−) ramp used by return heatmaps. */
function qlRedGreen(v, max) {
  if (v == null || !Number.isFinite(v) || !max) return "background:var(--ink-3)";
  const t = Math.min(1, Math.abs(v) / max);
  return v >= 0
    ? `background:rgba(46,158,107,${(0.08 + t * 0.58).toFixed(3)})`
    : `background:rgba(200,75,60,${(0.08 + t * 0.58).toFixed(3)})`;
}

/* ══════════════════════════════════════════════════════════════════════════
   CANVAS CHART PRIMITIVES
   Small, dependency-free, DPR-aware. Each returns a teardown-free draw so the
   caller can simply re-invoke on resize.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Size a canvas for the device pixel ratio.
 *
 * A canvas carries an INTRINSIC aspect ratio from its width/height attributes.
 * With `width:100%` and no CSS height it stretches to keep that ratio, so a
 * `height="260"` element inside a 1,340px panel lays out 1,161px tall — and
 * writing the measured height back into the attribute locks the mistake in.
 * The authored height is therefore captured once and pinned in CSS, leaving
 * only the width responsive.
 */
function qlSizeCanvas(canvas, dpr) {
  if (canvas._qlH == null) {
    canvas._qlH = parseInt(canvas.getAttribute("height"), 10) || canvas.offsetHeight || 240;
  }
  const cssH = canvas._qlH;
  canvas.style.height = cssH + "px";
  const cssW = canvas.offsetWidth || (canvas.parentElement ? canvas.parentElement.clientWidth - 24 : 0);
  // A hidden desk measures zero wide. Resizing to that would clear the buffer
  // and leave a blank chart behind when the desk is shown again, so an
  // unlaid-out canvas is left exactly as it is.
  if (cssW < 2) return null;
  canvas.width = Math.max(1, Math.round(cssW * dpr));
  canvas.height = Math.max(1, Math.round(cssH * dpr));
  return { cssW, cssH };
}

/**
 * Multi-series line chart with grid, axis ticks, optional log scale, optional
 * horizontal bands, and a hover crosshair that reports every series at the
 * cursor's index.
 *
 * cfg: { series:[{name,color,data:[num|null],dash,fill,width}],
 *        labels:[string], log, yFmt, bands:[{y,color,label,dash}],
 *        shade:[{from,to,color}], pad, yZero }
 */
function qlLine(canvas, cfg) {
  if (!canvas) return;
  const draw = () => {
    const dpr = window.devicePixelRatio || 1;
    const size = qlSizeCanvas(canvas, dpr);
    if (!size) return;
    const { cssW, cssH } = size;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const padL = cfg.padL ?? 52, padR = cfg.padR ?? 10, padT = cfg.padT ?? 12, padB = cfg.padB ?? 22;
    const W = cssW - padL - padR, H = cssH - padT - padB;
    if (W <= 10 || H <= 10) return;

    const series = (cfg.series || []).filter((s) => s && s.data && s.data.length);
    if (!series.length) return;
    const n = Math.max(...series.map((s) => s.data.length));
    const log = !!cfg.log;

    let all = [];
    series.forEach((s) => s.data.forEach((v) => { if (v != null && Number.isFinite(v) && (!log || v > 0)) all.push(v); }));
    (cfg.bands || []).forEach((b) => { if (Number.isFinite(b.y)) all.push(b.y); });
    if (cfg.yZero) all.push(0);
    if (!all.length) return;
    let min = Math.min(...all), max = Math.max(...all);
    if (min === max) { min -= Math.abs(min) * 0.05 || 1; max += Math.abs(max) * 0.05 || 1; }
    const spanPad = (max - min) * 0.06;
    if (!log) { min -= spanPad; max += spanPad; }

    const tY = (v) => (log ? Math.log(Math.max(v, 1e-9)) : v);
    const lo = tY(min), hi = tY(max);
    const X = (i) => padL + (n <= 1 ? 0 : (i / (n - 1)) * W);
    const Y = (v) => padT + H - ((tY(v) - lo) / (hi - lo || 1)) * H;

    /* grid + y ticks */
    ctx.font = "10px Inter, sans-serif";
    ctx.textBaseline = "middle";
    const ticks = 5;
    for (let i = 0; i <= ticks; i++) {
      const v = log ? Math.exp(lo + ((hi - lo) * i) / ticks) : min + ((max - min) * i) / ticks;
      const y = Y(v);
      ctx.strokeStyle = QL_C.hairline;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, y + 0.5); ctx.lineTo(padL + W, y + 0.5); ctx.stroke();
      ctx.fillStyle = QL_C.mutedInk;
      ctx.textAlign = "right";
      ctx.fillText(cfg.yFmt ? cfg.yFmt(v) : v.toFixed(2), padL - 6, y);
    }

    /* shaded regions (position states) */
    (cfg.shade || []).forEach((s) => {
      ctx.fillStyle = s.color;
      ctx.fillRect(X(s.from), padT, Math.max(1, X(s.to) - X(s.from)), H);
    });

    /* horizontal bands (entry/exit thresholds) */
    (cfg.bands || []).forEach((b) => {
      if (!Number.isFinite(b.y)) return;
      ctx.save();
      ctx.strokeStyle = b.color || QL_C.mutedInk;
      ctx.lineWidth = 1;
      if (b.dash !== false) ctx.setLineDash([4, 4]);
      const y = Y(b.y);
      ctx.beginPath(); ctx.moveTo(padL, y + 0.5); ctx.lineTo(padL + W, y + 0.5); ctx.stroke();
      if (b.label) {
        ctx.setLineDash([]);
        ctx.fillStyle = b.color || QL_C.mutedInk;
        ctx.textAlign = "left";
        ctx.fillText(b.label, padL + 4, y - 7);
      }
      ctx.restore();
    });

    /* x tick labels */
    const labels = cfg.labels || [];
    if (labels.length) {
      ctx.fillStyle = QL_C.mutedInk;
      ctx.textAlign = "center";
      const steps = Math.min(6, labels.length);
      for (let i = 0; i < steps; i++) {
        const idx = Math.round((i / (steps - 1 || 1)) * (labels.length - 1));
        const lbl = String(labels[idx] || "").slice(0, 7);
        ctx.fillText(lbl, Math.max(padL + 14, Math.min(padL + W - 14, X(idx))), padT + H + 12);
      }
    }

    /* series */
    series.forEach((s) => {
      if (s.fill) {
        const g = ctx.createLinearGradient(0, padT, 0, padT + H);
        g.addColorStop(0, s.fill);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.beginPath();
        let started = false;
        s.data.forEach((v, i) => {
          if (v == null || !Number.isFinite(v)) return;
          started ? ctx.lineTo(X(i), Y(v)) : (ctx.moveTo(X(i), Y(v)), (started = true));
        });
        if (started) {
          const lastIdx = s.data.reduce((a, v, i) => (v != null && Number.isFinite(v) ? i : a), 0);
          const firstIdx = s.data.findIndex((v) => v != null && Number.isFinite(v));
          const base = cfg.yZero ? Y(0) : padT + H;
          ctx.lineTo(X(lastIdx), base); ctx.lineTo(X(firstIdx), base);
          ctx.closePath(); ctx.fillStyle = g; ctx.fill();
        }
      }
      ctx.beginPath();
      ctx.setLineDash(s.dash || []);
      let started = false;
      s.data.forEach((v, i) => {
        if (v == null || !Number.isFinite(v)) { started = false; return; }
        started ? ctx.lineTo(X(i), Y(v)) : (ctx.moveTo(X(i), Y(v)), (started = true));
      });
      ctx.strokeStyle = s.color || QL_C.amber;
      ctx.lineWidth = s.width || 1.5;
      ctx.lineJoin = "round";
      ctx.stroke();
      ctx.setLineDash([]);
    });

    canvas._qlGeom = { padL, padT, W, H, n, X, Y, series, labels, min, max };
  };

  draw();
  canvas._qlDraw = draw;

  /* hover crosshair */
  if (!canvas._qlHover) {
    canvas._qlHover = true;
    const tip = document.createElement("div");
    tip.className = "ql-tip";
    tip.hidden = true;
    canvas.parentElement && canvas.parentElement.appendChild(tip);
    canvas.addEventListener("mousemove", (e) => {
      const g = canvas._qlGeom;
      if (!g) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const idx = Math.round(((mx - g.padL) / (g.W || 1)) * (g.n - 1));
      if (idx < 0 || idx >= g.n) { tip.hidden = true; canvas._qlDraw(); return; }
      canvas._qlDraw();
      const ctx = canvas.getContext("2d");
      const x = g.X(idx);
      ctx.save();
      ctx.strokeStyle = "rgba(200,134,42,0.55)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x, g.padT); ctx.lineTo(x, g.padT + g.H); ctx.stroke();
      ctx.setLineDash([]);
      g.series.forEach((s) => {
        const v = s.data[idx];
        if (v == null || !Number.isFinite(v)) return;
        ctx.beginPath(); ctx.arc(x, g.Y(v), 3, 0, Math.PI * 2);
        ctx.fillStyle = s.color || QL_C.amber; ctx.fill();
      });
      ctx.restore();
      const fmt = cfg.tipFmt || cfg.yFmt || ((v) => v.toFixed(2));
      tip.innerHTML =
        `<div class="ql-tip-d">${esc(String(g.labels[idx] ?? idx))}</div>` +
        g.series.map((s) => {
          const v = s.data[idx];
          return `<div class="ql-tip-r"><i style="background:${s.color}"></i>${esc(s.name || "")}<b>${v == null || !Number.isFinite(v) ? "—" : fmt(v)}</b></div>`;
        }).join("");
      tip.hidden = false;
      const px = Math.min(canvas.offsetWidth - 150, Math.max(0, mx + 12));
      tip.style.left = px + "px";
      tip.style.top = "8px";
    });
    canvas.addEventListener("mouseleave", () => { tip.hidden = true; canvas._qlDraw && canvas._qlDraw(); });
  }
}

/** Histogram bars with a fitted-normal overlay. */
function qlHist(canvas, bins, opts = {}) {
  if (!canvas || !bins || !bins.length) return;
  const draw = () => {
    const dpr = window.devicePixelRatio || 1;
    const size = qlSizeCanvas(canvas, dpr);
    if (!size) return;
    const { cssW, cssH } = size;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const padL = 40, padR = 10, padT = 10, padB = 22;
    const W = cssW - padL - padR, H = cssH - padT - padB;
    const max = Math.max(...bins.map((b) => Math.max(b.n, b.normal || 0)));
    if (!max) return;
    const bw = W / bins.length;
    ctx.font = "10px Inter, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    for (let i = 0; i <= 4; i++) {
      const y = padT + H - (i / 4) * H;
      ctx.strokeStyle = QL_C.hairline;
      ctx.beginPath(); ctx.moveTo(padL, y + 0.5); ctx.lineTo(padL + W, y + 0.5); ctx.stroke();
      ctx.fillStyle = QL_C.mutedInk;
      ctx.fillText(Math.round((max * i) / 4), padL - 5, y);
    }
    bins.forEach((b, i) => {
      const h = (b.n / max) * H;
      ctx.fillStyle = b.x < 0 ? "rgba(200,75,60,0.55)" : "rgba(46,158,107,0.55)";
      ctx.fillRect(padL + i * bw + bw * 0.12, padT + H - h, bw * 0.76, h);
    });
    ctx.beginPath();
    bins.forEach((b, i) => {
      const y = padT + H - ((b.normal || 0) / max) * H;
      const x = padL + i * bw + bw / 2;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.strokeStyle = QL_C.amberBright;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.fillStyle = QL_C.mutedInk;
    for (let i = 0; i < 5; i++) {
      const idx = Math.round((i / 4) * (bins.length - 1));
      ctx.fillText((bins[idx].x * 100).toFixed(1) + "%", padL + idx * bw + bw / 2, padT + H + 12);
    }
  };
  draw();
  canvas._qlDraw = draw;
}

/** Horizontal bars for a labelled numeric set (factor betas, risk shares). */
function qlBarRows(rows, opts = {}) {
  const max = Math.max(...rows.map((r) => Math.abs(r.v ?? 0)), opts.min || 0.0001);
  return `<div class="ql-bars">${rows.map((r) => {
    const w = (Math.abs(r.v ?? 0) / max) * 50;
    const neg = (r.v ?? 0) < 0;
    return `<div class="ql-bar-row"${r.title ? ` title="${esc(r.title)}"` : ""}>
      <span class="ql-bar-l">${esc(r.label)}</span>
      <div class="ql-bar-track">
        <i class="ql-bar-fill ${neg ? "neg" : "pos"}" style="${neg ? `right:50%;width:${w}%` : `left:50%;width:${w}%`}"></i>
        <span class="ql-bar-mid"></span>
      </div>
      <span class="ql-bar-v ${r.cls || ""}">${r.text}</span>
    </div>`;
  }).join("")}</div>`;
}

/* ══════════════════════════════════════════════════════════════════════════
   SHARED UI BUILDERS
   ══════════════════════════════════════════════════════════════════════════ */

const qlCard = (label, value, sub, cls = "") =>
  `<div class="ql-card ${cls}"><div class="ql-card-l">${label}</div><div class="ql-card-v">${value}</div>${sub ? `<div class="ql-card-s">${sub}</div>` : ""}</div>`;

const qlSec = (title, sub, inner, note) =>
  `<section class="ql-sec"><header class="ql-sec-h"><h4>${title}</h4>${sub ? `<span>${sub}</span>` : ""}</header>${inner}${note ? `<div class="ql-note">${note}</div>` : ""}</section>`;

const qlTable = (heads, rows, cls = "") =>
  `<div class="ql-scroll"><table class="ql-t ${cls}"><thead><tr>${heads.map((h) => `<th${h.r ? ' class="r"' : ""}>${h.t ?? h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;

const qlEmpty = (msg) => `<div class="empty-mini mono">${esc(msg)}</div>`;
const qlLoading = (msg) => `<div class="loading mono" style="padding:44px">${esc(msg)}</div>`;

/** Verdict banner — the single "so what" line each desk earns. */
const qlVerdict = (tone, head, body) =>
  `<div class="ql-verdict ${tone}"><div class="ql-verdict-h">${head}</div><div class="ql-verdict-b">${body}</div></div>`;

/* ── ⓘ explanations: what each strategy means and when it is the right tool ── */
const QL_STRAT_INFO = {
  sma_cross: ["Holds the stock while its short-term average price (fast SMA) is above its long-term average (slow SMA), and sits in cash otherwise.", "Trending markets and stocks with long, persistent moves. Use it when you want a simple rule that keeps you invested through uptrends and out of long downtrends.", "Fast SMA: days in the short average (reacts quickly). Slow SMA: days in the long average (defines the trend). Common pairs are 20/100 and 50/200.", "Sideways markets produce many small losing trades (whipsaws), and it always reacts after a turn, never before."],
  ema_cross_adx: ["The same trend idea with exponential averages (more weight on recent prices), but it only buys when ADX, a gauge of trend strength, is above a floor.", "Stocks that alternate between strong trends and choppy ranges: the ADX filter is what keeps you out of the chop.", "Fast / Slow EMA: the two averages. ADX floor: minimum trend strength before a trade is allowed (20–25 is usual).", "Trades less and enters later, because it waits for the trend to be confirmed."],
  donchian_breakout: ["Buys when the price closes above its highest high of the last N days (a breakout) and exits when it closes below its lowest low of the last M days.", "Stocks prone to breakouts and long runs. This is the classic Turtle Traders system.", "Entry window: breakout look-back (20 or 55 days). Exit window: stop look-back (10 or 20 days), always shorter than the entry window.", "A low win rate (30–40%) is normal: a few large trends pay for many small losses, so long losing streaks happen."],
  atr_chandelier: ["Buys when the price is above a trend EMA, then trails a stop k × ATR below the highest close since entry. ATR is the stock's typical daily movement.", "Volatile stocks where a fixed percentage stop is either too tight or too loose: the stop adapts to the stock's own volatility.", "Trend EMA: the entry filter. ATR multiple: how far the stop trails, in units of daily range (2.5–3.5 is usual).", "A tight multiple gets stopped out by noise; a wide one gives back a large part of each gain."],
  rsi_reversion: ["Buys when RSI (a 0–100 gauge of recent gains against losses) drops below the oversold level, and sells when it recovers to the exit level.", "Range-bound, liquid large caps that tend to bounce after sharp dips. The 200-day filter only allows buying while the long-term trend is up.", "RSI period (14 is standard), entry level (about 30), exit level (about 50–60), and the 200-day filter (1 = on).", "In a real downtrend, oversold keeps getting more oversold. Keep the filter on unless you have a reason not to."],
  bollinger_reversion: ["Buys when the price closes below the lower Bollinger Band (moving average minus k standard deviations) and sells at the middle band.", "Stocks that oscillate around a stable average without a strong trend.", "Band period (20 is standard) and σ multiple (2 is standard; wider bands trade less).", "The start of a genuine breakdown looks exactly like a buy signal."],
  macd_trend: ["Holds the stock while the MACD line (the gap between a fast and a slow EMA) is above its 9-day signal line: a momentum-turn indicator.", "Stocks with medium-term swings, when you want to react earlier than a moving-average cross.", "Fast / Slow EMA (12 / 26 is the standard), signal line 9.", "Noisy: many signals, so trading costs matter more than for slower rules."],
  momentum_12_1: ["Holds the stock while its return over the past year, excluding the most recent month, is positive; re-checked at a fixed interval.", "Long-horizon investors who want an evidence-based trend filter; it comes from decades of momentum research.", "Lookback (252 days = 12 months), skip recent (21 days = 1 month, avoids short-term reversals), rebalance every N days.", "Slow to exit when a crash follows a strong year (a momentum crash)."],
  volatility_regime: ["Holds the stock only while it is above its trend SMA and its recent volatility is below a chosen percentile of the past year.", "Investors who want to sit out turbulent periods: a drawdown brake.", "Trend SMA, and the volatility percentile cap (60–80 is usual).", "It steps aside only after volatility has risen, and can miss the rebound."],
  dual_momentum_ma: ["The golden-cross regime: long when the 50-day average is above the 200-day and the price is above the 200-day.", "A slow benchmark for whether faster rules earn their extra trading; long-term investors.", "Fast SMA (50) and Slow SMA (200).", "Very late at turning points, and the few trades make the sample small."],
};
function qlStratInfoHtml(s) {
  const [what, when, params, watch] = QL_STRAT_INFO[s.id] || [s.thesis, "", "", ""];
  return `<p>${esc(what)}</p>${when ? `<p><b>When it is the right tool.</b> ${esc(when)}</p>` : ""}${params ? `<p><b>Settings.</b> ${esc(params)}</p>` : ""}${watch ? `<p><b>Weak spot.</b> ${esc(watch)}</p>` : ""}
    <div class="mt-info-rule"><span>EXACT RULE</span>${esc(s.rule || "")}</div><p class="ws-dim">Family: ${esc(s.family || "")}. A backtest describes the past; it is not a recommendation.</p>`;
}
const QL_DESK_INFO = {
  backtest: ["Strategy Backtester", "Tests a trading rule on the stock's daily history: every signal trades on the next day's close and pays costs on both sides. It then checks whether the result survives other settings (parameter surface), unseen periods (walk-forward) and luck (bootstrap). Use it before trusting any chart pattern or indicator."],
  factors: ["Factor Attribution", "Explains a stock's returns with market-wide drivers: the market itself, size, sectors, the rupee and crude. What the drivers cannot explain is alpha. Use it to see what you are really exposed to and what a hedge would need to cover."],
  pairs: ["Pairs & Cointegration", "Tests whether two related stocks move together closely enough that the gap between them keeps returning to normal (cointegration), then backtests trading that gap. Use it for market-neutral ideas between peers."],
  profile: ["Return Profile", "Describes how a stock's returns behave: how bad the bad days are, how long the drawdowns lasted, seasonality and volatility regimes. Use it to size a position and set expectations."],
};

/* ── analysis summary: conclusion · reasonableness of the inputs · suggested settings ── */
function qlSummary(as, desk) {
  if (!as || !as.conclusion) return "";
  const c = as.conclusion;
  const icon = { ok: "✓", warn: "!", bad: "✕" };
  const rows = (as.assumptions || []).map((a) => `<tr class="${a.status}"><td><i class="ql-dot ${a.status}" aria-label="${a.status}">${icon[a.status] || ""}</i></td><td><b>${esc(a.name)}</b><span class="mono">${esc(a.value)}</span></td><td>${esc(a.why)}</td><td>${a.suggest && a.status !== "ok" ? `<span class="ql-sug">${esc(a.suggest)}</span>` : `<span class="ws-dim">—</span>`}</td></tr>`).join("");
  const sug = as.suggested;
  const sugTxt = sug ? [
    sug.params && Object.keys(sug.params).length ? Object.entries(sug.params).map(([k, v]) => `${esc((sug.labels || {})[k] || k)} ${v}`).join(", ") : "",
    sug.costBps != null ? `cost ${sug.costBps} bp/side` : "",
    sug.range ? `history ${esc(String(sug.range).toUpperCase())}` : "",
    [["window", "z-window", " days"], ["entryZ", "entry |z|", ""], ["exitZ", "exit |z|", ""], ["stopZ", "stop |z|", ""]].filter(([k]) => sug[k] != null).map(([k, l, u]) => `${l} ${sug[k]}${u}`).join(", "),
    sug.rf != null ? `risk-free ${sug.rf}%` : "",
  ].filter(Boolean).join(" · ") : "";
  const rs = as.reasonableness || "reasonable";
  return `<section class="ql-sum ${c.tone}">
    <div class="ql-sum-top">
      <div class="ql-sum-c">
        <div class="ql-sum-tag mono">CONCLUSION</div>
        <h3>${esc(c.headline)}</h3>
        <ul>${(c.points || []).map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
        ${c.next ? `<p class="ql-sum-next">${esc(c.next)}</p>` : ""}
      </div>
      <div class="ql-sum-r">
        <div class="ql-sum-tag mono">YOUR ASSUMPTIONS</div>
        <div class="ql-rs ${rs.replace(/\s+/g, "-")}">${esc(rs.charAt(0).toUpperCase() + rs.slice(1))}</div>
        <p>${esc(as.reasonablenessText || "")}</p>
        ${sug ? `<div class="ql-sum-sug"><span class="mono">SUGGESTED</span>${sugTxt}</div><button class="btn btn-amber ql-apply" type="button" data-ql-apply="${desk}">Apply suggested settings &amp; re-run</button>` : `<div class="ql-sum-sug ok">No changes suggested.</div>`}
      </div>
    </div>
    ${rows ? `<details class="ql-asm-d"${(as.assumptions || []).some((a) => a.status !== "ok") ? " open" : ""}><summary class="mono">ASSUMPTION CHECK · ${(as.assumptions || []).length} inputs</summary><div class="ql-scroll"><table class="ql-asm"><thead><tr><th></th><th>Input</th><th>Assessment</th><th>Reasonable value</th></tr></thead><tbody>${rows}</tbody></table></div></details>` : ""}
  </section>`;
}

/* ── ticker autocomplete bound to any input + dropdown pair ── */
function qlSearch(input, drop, onPick) {
  let timer, items = [], active = -1;
  const close = () => { drop.hidden = true; active = -1; };
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) return close();
    timer = setTimeout(async () => {
      try {
        const { results } = await api(`/api/search?q=${encodeURIComponent(q)}`);
        items = results || [];
        if (!items.length) return close();
        drop.innerHTML = items.map((it, i) => `<button class="cmd-result" data-i="${i}"><span class="sym">${esc(it.symbol)}</span><span class="nm">${esc(it.name)}</span><span class="ex">${esc(it.exchange)}</span></button>`).join("");
        drop.hidden = false;
      } catch { close(); }
    }, 220);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const sym = active >= 0 && items[active] ? items[active].symbol : input.value.trim().toUpperCase();
      if (sym) { input.value = sym; close(); onPick(sym); }
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!items.length || drop.hidden) return;
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      $$(".cmd-result", drop).forEach((el, i) => el.classList.toggle("active", i === active));
    } else if (e.key === "Escape") close();
  });
  drop.addEventListener("click", (e) => {
    const b = e.target.closest(".cmd-result");
    if (!b) return;
    const it = items[+b.dataset.i];
    input.value = it.symbol; close(); onPick(it.symbol);
  });
  document.addEventListener("click", (e) => { if (!drop.parentElement.contains(e.target)) close(); });
}

/* redraw every mounted canvas on resize (charts are not responsive by default) */
let _qlResizeBound = false;
function qlBindResize() {
  if (_qlResizeBound) return;
  _qlResizeBound = true;
  let t;
  window.addEventListener("resize", () => {
    clearTimeout(t);
    t = setTimeout(() => {
      $$("#quantRoot canvas").forEach((c) => { try { c._qlDraw && c._qlDraw(); } catch { } });
    }, 180);
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   QUANT LAB CONTROLLER
   ══════════════════════════════════════════════════════════════════════════ */

const QUANT = {
  desk: "backtest",
  catalogue: null,
  sym: { backtest: "", factors: "", profile: "" },
  pair: { a: "", b: "" },

  DESKS: [
    { id: "backtest", label: "Strategy Backtester", sub: "rules · parameter surface · walk-forward · bootstrap" },
    { id: "factors", label: "Factor Attribution", sub: "multi-factor OLS · HAC inference · rolling beta" },
    { id: "pairs", label: "Pairs & Cointegration", sub: "Engle-Granger · half-life · spread z-score" },
    { id: "profile", label: "Return Profile", sub: "tail risk · drawdowns · seasonality · efficiency" },
  ],

  /* ── mount ─────────────────────────────────────────────────────────────── */
  async mount() {
    const root = $("#quantRoot");
    if (!root || root._mounted) return;
    root._mounted = true;
    qlBindResize();

    root.innerHTML = `
      <div class="ql-head">
        <div class="ql-head-l">
          <div class="ql-eyebrow mono">QUANT LAB</div>
          <h2>Test the idea before you trade it.</h2>
          <p>Four desks that answer what a price chart cannot. Every result opens with a plain-language conclusion and a check of the assumptions you chose, with realistic settings you can apply in one click. Everything is computed on the server from daily prices: deterministic and auditable.</p>
        </div>
      </div>
      <nav class="ql-nav" id="qlNav">
        ${this.DESKS.map((d) => `<button data-desk="${d.id}" class="${d.id === this.desk ? "active" : ""}"><span class="ql-nav-t">${d.label}</span><span class="ql-nav-s mono">${d.sub}</span></button>`).join("")}
      </nav>
      <div class="ql-intro" id="qlIntro"></div>
      <div class="ql-desk" id="qlDeskBacktest"></div>
      <div class="ql-desk" id="qlDeskFactors" hidden></div>
      <div class="ql-desk" id="qlDeskPairs" hidden></div>
      <div class="ql-desk" id="qlDeskProfile" hidden></div>`;

    $$("#qlNav button").forEach((b) => b.addEventListener("click", () => this.show(b.dataset.desk)));
    this.renderIntro();
    $("#qlIntro").addEventListener("click", (e) => {
      const b = e.target.closest("[data-desk-info]"); if (!b) return;
      const [t, txt] = QL_DESK_INFO[this.desk] || []; if (t && window.MT_INFO) MT_INFO.open(b, t, `<p>${esc(txt)}</p>`);
    });
    // "Apply suggested settings" on any desk
    root.addEventListener("click", (e) => { const b = e.target.closest("[data-ql-apply]"); if (b) this.applySuggested(b.dataset.qlApply); });

    try {
      const { strategies } = await api("/api/quant/strategies");
      this.catalogue = strategies;
    } catch { this.catalogue = []; }

    this.buildBacktest();
    this.buildFactors();
    this.buildPairs();
    this.buildProfile();

    // Adopt whatever company is open elsewhere in the terminal.
    const seed = (typeof CURRENT !== "undefined" && CURRENT && CURRENT.symbol) ? CURRENT.symbol : "";
    if (seed) this.seed(seed);
  },

  DESK_HOSTS: { backtest: "qlDeskBacktest", factors: "qlDeskFactors", pairs: "qlDeskPairs", profile: "qlDeskProfile" },

  renderIntro() {
    const el = $("#qlIntro"), info = QL_DESK_INFO[this.desk]; if (!el || !info) return;
    el.innerHTML = `<span>${esc(info[1].split(". ")[0])}.</span><button class="mt-i" type="button" data-desk-info title="What this desk does" aria-label="What ${esc(info[0])} does">i</button>`;
  },

  /** apply the assessment's suggested settings to a desk's inputs, then re-run it */
  applySuggested(desk) {
    const as = (this._assess || {})[desk], s = as && as.suggested; if (!s) return;
    const setv = (id, v) => { const el = $("#" + id); if (!el || v == null) return; if (el.tagName === "SELECT" && ![...el.options].some((o) => o.value === String(v))) return; el.value = String(v); };
    if (desk === "bt") {
      Object.entries(s.params || {}).forEach(([k, v]) => { const el = $("#btP_" + k), out = $("#btPv_" + k); if (el) { el.value = v; if (out) out.textContent = el.value; el.dispatchEvent(new Event("input")); } });
      setv("btCost", s.costBps); setv("btRange", s.range);
      this.runBacktest();
    } else if (desk === "pr") {
      setv("prWin", s.window); setv("prEntry", s.entryZ); setv("prExit", s.exitZ); setv("prStop", s.stopZ); setv("prCost", s.costBps); setv("prRange", s.range);
      this.runPairs();
    } else if (desk === "fc") { setv("fcRange", s.range); setv("fcRf", s.rf); this.runFactors(); }
    else if (desk === "rp") { setv("rpRange", s.range); this.runProfile(); }
  },
  remember(desk, as) { (this._assess = this._assess || {})[desk] = as || null; },

  show(desk) {
    this.desk = desk;
    this.renderIntro();
    $$("#qlNav button").forEach((b) => b.classList.toggle("active", b.dataset.desk === desk));
    Object.entries(this.DESK_HOSTS).forEach(([k, id]) => { const el = $("#" + id); if (el) el.hidden = k !== desk; });
    // Only the desk that just became visible is redrawn — a canvas in a hidden
    // desk measures zero wide, and drawing it there would blank it.
    const host = $("#" + this.DESK_HOSTS[desk]);
    if (host) $$("canvas", host).forEach((c) => { try { c._qlDraw && c._qlDraw(); } catch { } });
  },

  /** Push a symbol into every desk's input without firing four requests. */
  seed(symbol) {
    ["btSym", "fcSym", "rpSym", "prSymA"].forEach((id) => {
      const el = $("#" + id);
      if (el && !el.value) el.value = symbol;
    });
    this.sym.backtest = this.sym.backtest || symbol;
    this.sym.factors = this.sym.factors || symbol;
    this.sym.profile = this.sym.profile || symbol;
  },

  syncContext() {
    if (typeof CURRENT === "undefined" || !CURRENT || !CURRENT.symbol) return;
    if (this._ctxSym === CURRENT.symbol) return;
    this._ctxSym = CURRENT.symbol;
    ["btSym", "fcSym", "rpSym", "prSymA"].forEach((id) => { const el = $("#" + id); if (el) el.value = CURRENT.symbol; });
  },

  /* ════════════════════════════════════════════════════════════════════════
     DESK 1 · STRATEGY BACKTESTER
     ════════════════════════════════════════════════════════════════════════ */

  buildBacktest() {
    const host = $("#qlDeskBacktest");
    const byFamily = {};
    (this.catalogue || []).forEach((s) => { (byFamily[s.family] ||= []).push(s); });
    const first = (this.catalogue || [])[0];
    const lib = Object.entries(byFamily).map(([fam, list]) => `<div class="ql-lib-g mono">${esc(fam.toUpperCase())}</div>` +
      list.map((s) => `<div class="ql-lib-i${first && s.id === first.id ? " on" : ""}" data-strat="${esc(s.id)}" role="button" tabindex="0"><span>${esc(s.label)}</span><button class="mt-i" type="button" data-sinfo="${esc(s.id)}" title="What this strategy means" aria-label="What ${esc(s.label)} means">i</button></div>`).join("")).join("");
    host.innerHTML = `
      <div class="ql-bt">
        <aside class="ql-side">
          <div class="ql-box">
            <div class="ql-box-h mono"><b>1</b> STOCK &amp; COSTS</div>
            <label class="ql-f"><span>Ticker</span>
              <div class="ql-search"><input id="btSym" placeholder="RELIANCE.NS · TCS.NS · AAPL" autocomplete="off" spellcheck="false" /><div class="cmd-results ql-drop" id="btDrop" hidden></div></div>
            </label>
            <div class="ql-f-row">
              <label class="ql-f"><span>History</span><select id="btRange"><option value="2y">2Y</option><option value="5y" selected>5Y</option><option value="10y">10Y</option><option value="max">Max</option></select></label>
              <label class="ql-f"><span>Cost (bp / side)</span><input id="btCost" type="number" min="0" max="200" step="1" value="15" /></label>
            </div>
            <div class="ql-hint">Realistic: about 15 bp per side for Indian delivery trades (STT, stamp duty, fees, slippage), about 5 bp for US stocks.</div>
          </div>
          <div class="ql-box">
            <div class="ql-box-h mono"><b>2</b> STRATEGY <span>${(this.catalogue || []).length} rules · ⓘ explains each</span></div>
            <div class="ql-lib" id="btLib">${lib}</div>
            <input type="hidden" id="btStrat" value="${first ? esc(first.id) : "sma_cross"}" />
          </div>
          <div class="ql-box">
            <div class="ql-box-h mono"><b>3</b> SETTINGS</div>
            <div class="ql-params" id="btParams"></div>
            <div class="ql-rule" id="btRule"></div>
          </div>
          <div class="ql-side-act">
            <button class="btn btn-amber ql-run" id="btRun" type="button">Run backtest</button>
            <button class="mini-btn" id="btCmp" type="button" title="Run every strategy at its default settings on this stock and rank them">Compare all strategies</button>
          </div>
        </aside>
        <div class="ql-main">
          <div id="btStatus" class="ql-status mono"></div>
          <div id="btCompare"></div>
          <div id="btOut">${qlEmpty("Pick a ticker and a strategy, then run. Signals trade on the NEXT day's close, costs are charged on both sides of every trade, and the result is graded out of sample before anything is reported. The report opens with a conclusion and a check of your assumptions.")}</div>
        </div>
      </div>`;

    qlSearch($("#btSym"), $("#btDrop"), (s) => { this.sym.backtest = s; this.runBacktest(); });
    const lib$ = $("#btLib");
    lib$.addEventListener("click", (e) => {
      const info = e.target.closest("[data-sinfo]");
      if (info) { const s = (this.catalogue || []).find((x) => x.id === info.dataset.sinfo); if (s && window.MT_INFO) MT_INFO.open(info, s.label, qlStratInfoHtml(s)); return; }
      const row = e.target.closest("[data-strat]"); if (row) this.selectStrategy(row.dataset.strat, true);
    });
    lib$.addEventListener("keydown", (e) => { const row = e.target.closest("[data-strat]"); if (row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); this.selectStrategy(row.dataset.strat, true); } });
    $("#btRun").addEventListener("click", () => this.runBacktest());
    $("#btCmp").addEventListener("click", () => this.runCompare());
    $("#btRange").addEventListener("change", () => this.runBacktest());
    $("#btCost").addEventListener("change", () => this.runBacktest());
    $("#btCompare").addEventListener("click", (e) => {
      const info = e.target.closest("[data-sinfo]");
      if (info) { const s = (this.catalogue || []).find((x) => x.id === info.dataset.sinfo); if (s && window.MT_INFO) MT_INFO.open(info, s.label, qlStratInfoHtml(s)); return; }
      if (e.target.closest("[data-cmp-close]")) { $("#btCompare").innerHTML = ""; return; }
      const row = e.target.closest("[data-cmp]"); if (row) this.selectStrategy(row.dataset.cmp, true);
    });
    this.renderParams();
  },

  selectStrategy(id, run) {
    const el = $("#btStrat"); if (!el || !(this.catalogue || []).some((s) => s.id === id)) return;
    el.value = id;
    $$("#btLib [data-strat]").forEach((r) => r.classList.toggle("on", r.dataset.strat === id));
    this.renderParams();
    if (run) this.runBacktest();
  },

  currentStrategy() {
    const id = $("#btStrat") ? $("#btStrat").value : "sma_cross";
    return (this.catalogue || []).find((s) => s.id === id) || null;
  },

  renderParams() {
    const spec = this.currentStrategy();
    const host = $("#btParams"), rule = $("#btRule");
    if (!spec) { host.innerHTML = ""; return; }
    const typ = spec.typical || {};
    const hint = (p, v) => { const r = typ[p.key]; if (!r) return ""; const out = v < r[0] || v > r[1]; return `<small class="${out ? "out" : ""}">usual ${r[0] === r[1] ? r[0] : r[0] + "–" + r[1]}${out ? " · outside" : ""}</small>`; };
    host.innerHTML = spec.params.map((p) => `
      <div class="ql-param">
        <label>${esc(p.label)}<b id="btPv_${p.key}">${p.def}</b></label>
        <input type="range" id="btP_${p.key}" min="${p.min}" max="${p.max}" step="${p.step}" value="${p.def}" />
        <div class="ql-param-h" id="btPh_${p.key}">${hint(p, p.def)}</div>
      </div>`).join("");
    spec.params.forEach((p) => {
      const el = $("#btP_" + p.key), out = $("#btPv_" + p.key), h = $("#btPh_" + p.key);
      el.addEventListener("input", () => { out.textContent = el.value; if (h) h.innerHTML = hint(p, +el.value); });
      el.addEventListener("change", () => this.runBacktest());
    });
    rule.innerHTML = `<div class="ql-rule-r"><b>RULE</b> ${esc(spec.rule)}</div><div class="ql-rule-t">${esc(spec.thesis)}</div>`;
  },

  /* every strategy at its defaults on the chosen stock → leaderboard */
  async runCompare() {
    const sym = ($("#btSym").value || "").trim().toUpperCase();
    if (!sym) { $("#btStatus").textContent = "enter a ticker"; return; }
    const range = $("#btRange").value, cost = $("#btCost").value || "15";
    const box = $("#btCompare");
    const token = (this._cmpToken = Symbol("cmp"));
    box.innerHTML = qlLoading(`Running all ${(this.catalogue || []).length} strategies on ${sym} at their default settings…`);
    try {
      const d = await api(`/api/quant/compare/${encodeURIComponent(sym)}?range=${encodeURIComponent(range)}&costBps=${encodeURIComponent(cost)}`);
      if (token !== this._cmpToken) return;
      const b = d.benchmark || {};
      const dots = (sub) => (sub || []).map((v) => `<i class="ql-cdot ${v == null ? "" : v > 0 ? "up" : "down"}" title="Sharpe ${QF.num(v)}"></i>`).join("");
      const top = d.rows[0];
      const rows = d.rows.map((r, i) => `<tr data-cmp="${esc(r.id)}" class="${r.id === ($("#btStrat") || {}).value ? "cur" : ""}">
        <td class="r mono">${i + 1}</td>
        <td><b>${esc(r.label)}</b> <button class="mt-i" type="button" data-sinfo="${esc(r.id)}" title="What this strategy means">i</button><div class="ws-dim ec-small">${esc(r.family)}</div></td>
        <td class="r ${QF.cls(r.cagr)}">${QF.pct(r.cagr, 1)}</td>
        <td class="r">${QF.num(r.sharpe)}</td>
        <td class="r down">${QF.pctAbs(r.maxDD, 1)}</td>
        <td class="r">${QF.int(r.trades)}</td>
        <td class="r">${QF.pctAbs(r.exposure, 0)}</td>
        <td class="r"><span class="ql-cdots">${dots(r.subSharpe)}</span></td>
        <td class="r">${r.beatsHold == null ? "—" : r.beatsHold ? '<span class="up">✓</span>' : '<span class="ws-dim">✕</span>'}</td></tr>`);
      const winners = d.rows.filter((r) => r.beatsHold && r.consistent === 3);
      const summary = winners.length
        ? `${winners.length} of ${d.rows.length} strategies beat buy-and-hold on a risk-adjusted basis <b>and</b> made money in all three sub-periods: ${winners.slice(0, 3).map((r) => esc(r.label)).join(", ")}. Open one to see whether it survives the robustness checks.`
        : `No strategy beat buy-and-hold on a risk-adjusted basis and stayed positive in all three sub-periods. For ${esc(sym)}, simply holding (Sharpe ${QF.num(b.sharpe)}) has been as good as any timing rule here.`;
      box.innerHTML = qlSec("Strategy leaderboard", `${esc(sym)} · ${d.from} → ${d.to} · ${d.costBps} bp/side · default settings <button class="mini-btn" data-cmp-close type="button">Close</button>`,
        `<p class="ql-prose">${summary}</p>` + qlTable([{ t: "#", r: 1 }, { t: "Strategy" }, { t: "CAGR", r: 1 }, { t: "Sharpe", r: 1 }, { t: "Max DD", r: 1 }, { t: "Trades", r: 1 }, { t: "In market", r: 1 }, { t: "3 periods", r: 1 }, { t: "Beats hold", r: 1 }], rows, "ql-cmp") +
        `<p class="ql-prose ws-dim">Buy-and-hold: CAGR ${QF.pct(b.cagr, 1)} · Sharpe ${QF.num(b.sharpe)} · worst fall ${QF.pctAbs(b.maxDD, 1)} · 3 periods <span class="ql-cdots">${dots(b.subSharpe)}</span>. Click a row to open that strategy's full backtest.</p>`,
        "Defaults only, nothing optimised, so nothing here is curve-fitted. “3 periods” splits the history into equal thirds: green = positive Sharpe in that third. A rule that only worked in one third was a bet on that market phase.");
      if (top && !$("#btOut .ql-sum")) this.selectStrategy(top.id, false);
    } catch (e) {
      if (token !== this._cmpToken) return;
      box.innerHTML = qlEmpty(e.message || "Strategy comparison unavailable.");
    }
  },

  async runBacktest() {
    const sym = ($("#btSym").value || "").trim().toUpperCase();
    if (!sym) { $("#btStatus").textContent = "enter a ticker"; return; }
    this.sym.backtest = sym;
    const spec = this.currentStrategy();
    const qs = new URLSearchParams({
      strategy: $("#btStrat").value,
      range: $("#btRange").value,
      costBps: $("#btCost").value || "10",
    });
    (spec ? spec.params : []).forEach((p) => {
      const el = $("#btP_" + p.key);
      if (el) qs.set("p_" + p.key, el.value);
    });

    const token = (this._btToken = Symbol("bt"));
    $("#btStatus").textContent = "simulating · sweeping parameters · walking forward…";
    $("#btOut").innerHTML = qlLoading(`Backtesting ${sym} — executing signals, sweeping the parameter grid, running ${4} walk-forward folds and 1,000 bootstrap paths…`);
    try {
      const d = await api(`/api/quant/backtest/${encodeURIComponent(sym)}?${qs}`);
      if (token !== this._btToken) return;
      $("#btStatus").textContent = `${d.meta.bars.toLocaleString()} bars · ${d.meta.from} → ${d.meta.to}${d.meta.stale ? " · snapshot data" : ""}`;
      this.remember("bt", d.assessment);
      $("#btOut").innerHTML = this.renderBacktest(d);
      this.drawBacktest(d);
    } catch (e) {
      if (token !== this._btToken) return;
      $("#btStatus").textContent = "failed";
      $("#btOut").innerHTML = qlEmpty(e.message || "Backtest unavailable.");
    }
  },

  renderBacktest(d) {
    const p = d.performance, b = d.benchmark, t = d.trades, m = d.meta;
    const beat = (a, c, invert = false) => {
      if (a == null || c == null) return "";
      return (invert ? a < c : a > c) ? "up" : "down";
    };

    /* ── the honest verdict, assembled from four independent checks ── */
    const checks = [];
    if (p.pValue != null) checks.push({ ok: p.pValue < 0.05, txt: `daily returns significant at ${QF.p(p.pValue)}` });
    if (d.walkForward) checks.push({ ok: (d.walkForward.oosAvgSharpe ?? -1) > 0.3, txt: `out-of-sample Sharpe ${QF.num(d.walkForward.oosAvgSharpe)}` });
    if (d.surface) checks.push({ ok: (d.surface.plateauRatio ?? 0) > 0.2, txt: `${QF.pctAbs(d.surface.plateauRatio, 0)} of the parameter grid holds up` });
    if (p.sharpe != null && b.sharpe != null) checks.push({ ok: p.sharpe > b.sharpe, txt: `Sharpe ${QF.num(p.sharpe)} vs buy-and-hold ${QF.num(b.sharpe)}` });
    const passed = checks.filter((c) => c.ok).length;
    const tone = passed >= 3 ? "good" : passed === 2 ? "warn" : "bad";
    const headline = passed >= 3 ? "Survives every standard robustness check"
      : passed === 2 ? "Mixed evidence — parts of this result are fragile"
      : "Does not hold up — treat the headline numbers as in-sample noise";
    const verdict = qlVerdict(tone, `${passed} of ${checks.length} checks passed — ${headline}`,
      checks.map((c) => `<span class="ql-chk ${c.ok ? "ok" : "no"}">${c.ok ? "✓" : "✗"} ${c.txt}</span>`).join(""));

    /* ── headline cards ── */
    const cards = `<div class="ql-cards">
      ${qlCard("CAGR", `<span class="${QF.cls(p.cagr)}">${QF.pct(p.cagr, 1)}</span>`, `buy &amp; hold ${QF.pct(b.cagr, 1)}`, beat(p.cagr, b.cagr))}
      ${qlCard("SHARPE", QF.num(p.sharpe), `buy &amp; hold ${QF.num(b.sharpe)}`, beat(p.sharpe, b.sharpe))}
      ${qlCard("MAX DRAWDOWN", `<span class="down">${QF.pctAbs(p.maxDD, 1)}</span>`, `buy &amp; hold ${QF.pctAbs(b.maxDD, 1)}`, beat(p.maxDD, b.maxDD, true))}
      ${qlCard("SORTINO", QF.num(p.sortino), `Calmar ${QF.num(p.calmar)}`)}
      ${qlCard("TIME IN MARKET", QF.pctAbs(p.exposure, 0), `${QF.int(t.n)} trades · ${QF.bars(t.avgBars)} avg hold`)}
      ${qlCard("WIN RATE", QF.pctAbs(t.winRate, 0), `profit factor ${QF.x(t.profitFactor)}`)}
      ${qlCard("t-STAT", `${QF.num(p.tStat)}${QF.stars(p.pValue)}`, `p = ${QF.p(p.pValue)}`, p.pValue != null && p.pValue < 0.05 ? "up" : "")}
      ${qlCard("COST DRAG", QF.pctAbs(p.costDrag, 1), `${QF.num(p.turnover, 1)}× turnover @ ${m.costBps}bp`, "down")}
    </div>`;

    /* ── equity + drawdown ── */
    const chart = qlSec("Equity curve", `${esc(m.symbol)} · ${esc(m.label)} · ${m.years}y`, `
      <div class="ql-legend">
        <span><i style="background:${QL_C.amberBright}"></i>Strategy</span>
        <span><i style="background:${QL_C.muted}"></i>Buy &amp; hold</span>
        <label class="ql-toggle"><input type="checkbox" id="btLog" checked /> log scale</label>
      </div>
      <div class="ql-canvas-wrap"><canvas id="btEquity" height="260"></canvas></div>
      <div class="ql-sub-l mono">UNDERWATER — depth below the running peak</div>
      <div class="ql-canvas-wrap"><canvas id="btDD" height="120"></canvas></div>`,
      "Growth of 1 unit, net of costs. The strategy line is flat whenever the rule is out of the market — that flatness is the whole point of a timing rule, and it is also why exposure matters as much as return.");

    /* ── vs market regression ── */
    const vm = d.versusMarket;
    const alpha = vm ? qlSec("Is it timing, or just exposure?", "strategy returns regressed on buy-and-hold returns", `
      <div class="ql-grid2">
        <div>${qlTable(
          [{ t: "Term" }, { t: "Estimate", r: 1 }, { t: "t", r: 1 }, { t: "p", r: 1 }],
          [
            `<tr><td>Alpha (annualised)</td><td class="r ${QF.cls(vm.alphaAnnualised)}">${QF.pct(vm.alphaAnnualised, 2)}</td><td class="r">${QF.num(vm.alphaT)}</td><td class="r">${QF.p(vm.alphaP)}${QF.stars(vm.alphaP)}</td></tr>`,
            `<tr><td>Beta to the underlying</td><td class="r">${QF.num(vm.beta)}</td><td class="r">${QF.num(vm.betaT)}</td><td class="r">—</td></tr>`,
            `<tr><td>R²</td><td class="r">${QF.pctAbs(vm.r2, 1)}</td><td class="r">—</td><td class="r">—</td></tr>`,
          ])}</div>
        <div class="ql-prose">${vm.alphaP != null && vm.alphaP < 0.05 && vm.alphaAnnualised > 0
          ? `<p>The rule earns <b>${QF.pct(vm.alphaAnnualised, 2)} a year</b> that the underlying's own return does not explain, and the estimate clears the 5% bar. Beta of ${QF.num(vm.beta)} says the strategy carries about ${QF.pctAbs(vm.beta, 0)} of the stock's directional risk on average.</p>`
          : `<p>Alpha of ${QF.pct(vm.alphaAnnualised, 2)} a year is <b>not statistically distinguishable from zero</b> (p = ${QF.p(vm.alphaP)}). With a beta of ${QF.num(vm.beta)}, most of what this curve does is carry ${QF.pctAbs(Math.abs(vm.beta), 0)} of the underlying's exposure — which a smaller position in the stock itself would replicate more cheaply.</p>`}
        </div>
      </div>`) : "";

    /* ── parameter surface ── */
    const s = d.surface;
    let surface = "";
    if (s) {
      const flat = s.sharpe.flat().filter((v) => v != null);
      const mx = flat.length ? Math.max(...flat.map(Math.abs)) : 1;
      const curX = m.params[s.xKey], curY = m.params[s.yKey];
      const grid = `<div class="ql-heat-wrap"><table class="ql-heat">
        <tr><th class="ql-heat-corner">${esc(s.yLabel)} \\ ${esc(s.xLabel)}</th>${s.xs.map((x) => `<th>${x}</th>`).join("")}</tr>
        ${s.ys.map((y, yi) => `<tr><th>${y}</th>${s.xs.map((x, xi) => {
          const v = s.sharpe[yi][xi];
          const isCur = Math.abs(x - curX) < 1e-9 && Math.abs(y - curY) < 1e-9;
          return `<td class="${isCur ? "cur" : ""}" style="${qlDiverge(v, mx)}" title="${esc(s.xLabel)} ${x} · ${esc(s.yLabel)} ${y}&#10;Sharpe ${QF.num(v)} · CAGR ${QF.num(s.cagr[yi][xi], 1)}% · maxDD ${QF.num(s.dd[yi][xi], 1)}% · ${s.trades[yi][xi]} trades">${v == null ? "—" : v.toFixed(2)}</td>`;
        }).join("")}</tr>`).join("")}
      </table></div>`;
      surface = qlSec("Parameter surface", `Sharpe at every setting · ${s.xs.length}×${s.ys.length} grid`, grid + `
        <div class="ql-surface-foot">
          <div>${qlCard("BEST SHARPE", QF.num(s.bestSharpe), "on this grid")}${qlCard("MEDIAN", QF.num(s.medianSharpe), "across all settings")}${qlCard("PLATEAU", QF.pctAbs(s.plateauRatio, 0), "within 25% of best", s.plateauRatio > 0.2 ? "up" : "down")}</div>
          <p class="ql-prose"><b>${esc(s.robustness)}.</b> Your current setting is outlined. A real edge shows up as a broad warm region — if the only good cell is the one you happened to pick, the backtest has fitted the noise in this particular price history and will not repeat.</p>
        </div>`);
    }

    /* ── walk-forward ── */
    let wf = "";
    if (d.walkForward) {
      const w = d.walkForward;
      const rows = w.folds.map((f) => `<tr>
        <td class="mono">${f.fold}</td>
        <td class="mono ql-dim">${f.isFrom} → ${f.isTo}</td>
        <td class="mono">${f.oosFrom} → ${f.oosTo}</td>
        <td class="ql-dim">${Object.entries(f.params).map(([k, v]) => `${esc(k)}=${v}`).join(" · ")}</td>
        <td class="r">${QF.num(f.isSharpe)}</td>
        <td class="r ${QF.cls(f.oosSharpe)}">${QF.num(f.oosSharpe)}</td>
        <td class="r ${QF.cls(f.oosReturn)}">${QF.pct(f.oosReturn, 1)}</td>
      </tr>`);
      wf = qlSec("Walk-forward validation", `${w.folds.length} anchored folds · optimised in sample, graded out of sample`,
        qlTable([{ t: "#" }, { t: "In-sample window" }, { t: "Out-of-sample window" }, { t: "Chosen params" }, { t: "IS Sharpe", r: 1 }, { t: "OOS Sharpe", r: 1 }, { t: "OOS return", r: 1 }], rows) + `
        <div class="ql-wf-foot">
          ${qlCard("IN-SAMPLE", QF.num(w.isAvgSharpe), "avg Sharpe")}
          ${qlCard("OUT-OF-SAMPLE", QF.num(w.oosAvgSharpe), "avg Sharpe", (w.oosAvgSharpe ?? 0) > 0 ? "up" : "down")}
          ${qlCard("EFFICIENCY", w.efficiency == null ? "—" : QF.pctAbs(w.efficiency, 0), "OOS ÷ IS", (w.efficiency ?? 0) > 0.6 ? "up" : "down")}
          ${qlCard("STITCHED OOS", QF.pct(w.oos ? w.oos.totalReturn : null, 1), `Sharpe ${QF.num(w.oos ? w.oos.sharpe : null)}`)}
        </div>
        <p class="ql-prose"><b>${esc(w.verdict)}.</b> Each fold re-optimises using only data available at that point, then is scored on the block that follows. This is the closest a backtest gets to an honest track record — the headline numbers above are optimistic by construction, these are not.</p>`,
        "Efficiency below ~60% means the optimiser is fitting to sample-specific noise. A negative out-of-sample Sharpe means the rule has no edge at all, however good the full-sample chart looks.");
    }

    /* ── bootstrap ── */
    let mc = "";
    if (d.bootstrap) {
      const bs = d.bootstrap;
      mc = qlSec("Bootstrap significance", `${QF.int(bs.runs)} block-resampled paths · 20-day blocks`, `
        <div class="ql-cards">
          ${qlCard("P(PROFITABLE)", QF.pctAbs(bs.probProfit, 0), "of resampled paths", bs.probProfit > 0.75 ? "up" : bs.probProfit > 0.5 ? "" : "down")}
          ${qlCard("P(SHARPE > 1)", QF.pctAbs(bs.probSharpeAbove1, 0), "of resampled paths")}
          ${qlCard("CAGR · 5th pct", `<span class="${QF.cls(bs.cagr.p5)}">${QF.pct(bs.cagr.p5, 1)}</span>`, "bad-luck case")}
          ${qlCard("CAGR · median", QF.pct(bs.cagr.median, 1), `95th ${QF.pct(bs.cagr.p95, 1)}`)}
          ${qlCard("MAX DD · median", `<span class="down">${QF.pctAbs(bs.maxDD.median, 1)}</span>`, `5% tail ${QF.pctAbs(bs.maxDD.p5, 1)}`)}
          ${qlCard("MAX DD · worst", `<span class="down">${QF.pctAbs(bs.maxDD.worst, 1)}</span>`, "across all paths")}
        </div>
        <p class="ql-prose">Resampling the strategy's daily returns in 20-day blocks preserves short-run autocorrelation while scrambling the order events arrived in. The spread that comes back is the range of equity curves this same edge could plausibly have produced. <b>Size the position against the 5th-percentile drawdown, not the one that happened to occur.</b></p>`);
    }

    /* ── trade statistics ── */
    const tstats = qlSec("Trade statistics", `${QF.int(t.n)} closed positions`, `<div class="ql-grid2">
      ${qlTable([{ t: "Metric" }, { t: "Value", r: 1 }], [
        `<tr><td>Win rate</td><td class="r">${QF.pctAbs(t.winRate, 1)}</td></tr>`,
        `<tr><td>Profit factor</td><td class="r ${t.profitFactor > 1 ? "up" : "down"}">${QF.x(t.profitFactor)}</td></tr>`,
        `<tr><td>Expectancy per trade</td><td class="r ${QF.cls(t.expectancy)}">${QF.pct(t.expectancy, 2)}</td></tr>`,
        `<tr><td>Payoff ratio (avg win ÷ avg loss)</td><td class="r">${QF.x(t.payoff)}</td></tr>`,
        `<tr><td>Average win</td><td class="r up">${QF.pct(t.avgWin, 2)}</td></tr>`,
        `<tr><td>Average loss</td><td class="r down">${QF.pct(t.avgLoss, 2)}</td></tr>`,
      ])}
      ${qlTable([{ t: "Metric" }, { t: "Value", r: 1 }], [
        `<tr><td>Best trade</td><td class="r up">${QF.pct(t.best, 1)}</td></tr>`,
        `<tr><td>Worst trade</td><td class="r down">${QF.pct(t.worst, 1)}</td></tr>`,
        `<tr><td>Longest losing streak</td><td class="r">${QF.int(t.maxConsecLosses)} trades</td></tr>`,
        `<tr><td>Average hold</td><td class="r">${QF.bars(t.avgBars)}</td></tr>`,
        `<tr><td>Avg peak profit / worst dip in trade</td><td class="r">${QF.pct(t.avgMFE, 1)} / <span class="down">${QF.pct(t.avgMAE, 1)}</span></td></tr>`,
        `<tr><td>System Quality Number</td><td class="r ${t.sqn > 2 ? "up" : t.sqn > 1 ? "" : "down"}">${QF.num(t.sqn)}</td></tr>`,
      ])}
    </div>`, "SQN is expectancy divided by trade-level noise, scaled by sample size — Van Tharp's rule of thumb reads 1.6–2.0 as average, above 3 as excellent, and anything below 1 as untradeable regardless of total return.");

    /* ── drawdown episodes ── */
    const ddRows = (d.drawdowns || []).map((e) => `<tr>
      <td class="r down">${QF.pctAbs(e.depth, 1)}</td>
      <td class="mono">${e.peak}</td><td class="mono">${e.trough}</td>
      <td class="mono">${e.recovery || '<span class="ql-open">still underwater</span>'}</td>
      <td class="r">${QF.bars(e.declineBars)}</td><td class="r">${QF.bars(e.totalBars)}</td></tr>`);
    const dds = ddRows.length ? qlSec("Deepest drawdowns", "peak → trough → recovery",
      qlTable([{ t: "Depth", r: 1 }, { t: "Peak" }, { t: "Trough" }, { t: "Recovered" }, { t: "Decline", r: 1 }, { t: "Total", r: 1 }], ddRows),
      "Time underwater is the number that ends careers, not depth. A 30% drawdown that recovers in four months is survivable; a 20% one that takes three years usually is not.") : "";

    /* ── trade ledger ── */
    const tlRows = (d.tradeList || []).map((tr) => `<tr>
      <td class="mono">${esc(tr.side)}${tr.stillOpen ? ' <span class="ql-open">open</span>' : ""}</td>
      <td class="mono">${tr.entryDate}</td><td class="r mono">${QF.num(tr.entryPrice)}</td>
      <td class="mono">${tr.exitDate}</td><td class="r mono">${QF.num(tr.exitPrice)}</td>
      <td class="r">${QF.bars(tr.bars)}</td>
      <td class="r ${QF.cls(tr.ret)}">${QF.pct(tr.ret, 2)}</td>
      <td class="r ql-dim">${QF.pct(tr.mfe, 1)} / ${QF.pct(tr.mae, 1)}</td></tr>`);
    const ledger = tlRows.length ? qlSec("Trade ledger", `most recent ${tlRows.length}`,
      qlTable([{ t: "Side" }, { t: "Entry" }, { t: "Price", r: 1 }, { t: "Exit" }, { t: "Price", r: 1 }, { t: "Held", r: 1 }, { t: "Net", r: 1 }, { t: "Best / worst", r: 1 }], tlRows)) : "";

    const foot = `<div class="ql-disc">Signals are evaluated at each close and executed at the next bar's close — no signal can trade on the bar that produced it. Costs of ${m.costBps} bp are charged on the full notional at both entry and exit. Returns are unlevered, dividends are excluded, and the simulation assumes fills at the closing print with no market impact. Past behaviour of a rule on one price history is evidence about that history, not a forecast.</div>`;

    return qlSummary(d.assessment, "bt") + verdict + cards + chart + alpha + surface + wf + mc + tstats + dds + ledger + foot;
  },

  drawBacktest(d) {
    const c = d.curve || [];
    if (!c.length) return;
    const labels = c.map((r) => r.d);
    const eq = $("#btEquity");
    const paint = () => qlLine(eq, {
      labels, log: $("#btLog") && $("#btLog").checked,
      yFmt: (v) => v.toFixed(2) + "×",
      series: [
        { name: "Buy & hold", color: QL_C.muted, data: c.map((r) => r.b), width: 1.2 },
        { name: "Strategy", color: QL_C.amberBright, data: c.map((r) => r.s), width: 1.8 },
      ],
    });
    paint();
    const lg = $("#btLog");
    if (lg) lg.addEventListener("change", paint);
    qlLine($("#btDD"), {
      labels, yZero: true, padB: 18,
      yFmt: (v) => v.toFixed(0) + "%",
      series: [{ name: "Drawdown", color: QL_C.down, data: c.map((r) => r.dd), fill: "rgba(200,75,60,0.30)", width: 1.2 }],
    });
  },

  /* ════════════════════════════════════════════════════════════════════════
     DESK 2 · FACTOR ATTRIBUTION
     ════════════════════════════════════════════════════════════════════════ */

  buildFactors() {
    const host = $("#qlDeskFactors");
    host.innerHTML = `
      <div class="ql-ctl">
        <div class="ql-ctl-row">
          <label class="ql-f ql-f-sym"><span>Ticker</span>
            <div class="ql-search"><input id="fcSym" placeholder="RELIANCE.NS · INFY.NS · AAPL" autocomplete="off" spellcheck="false" /><div class="cmd-results ql-drop" id="fcDrop" hidden></div></div>
          </label>
          <label class="ql-f ql-f-sm"><span>History</span><select id="fcRange"><option value="2y">2Y</option><option value="5y" selected>5Y</option><option value="10y">10Y</option></select></label>
          <label class="ql-f ql-f-md"><span>Factor set</span><select id="fcRegion"><option value="">Auto</option><option value="india">India · NSE</option><option value="us">US / global</option></select></label>
          <label class="ql-f ql-f-sm"><span>Risk-free %</span><input id="fcRf" type="number" min="0" max="20" step="0.25" placeholder="auto" /></label>
          <button class="btn btn-amber ql-run" id="fcRun">Run attribution</button>
        </div>
      </div>
      <div id="fcStatus" class="ql-status mono"></div>
      <div id="fcOut">${qlEmpty("Regress a stock's excess return on a set of investable style and macro spreads. What is left over after every exposure is paid for is alpha — and the standard errors here are Newey-West, so the t-stats survive the serial correlation that inflates naive ones.")}</div>`;

    qlSearch($("#fcSym"), $("#fcDrop"), (s) => { this.sym.factors = s; this.runFactors(); });
    $("#fcRun").addEventListener("click", () => this.runFactors());
    $("#fcRange").addEventListener("change", () => this.runFactors());
    $("#fcRegion").addEventListener("change", () => this.runFactors());
    $("#fcRf").addEventListener("change", () => this.runFactors());
  },

  async runFactors() {
    const sym = ($("#fcSym").value || "").trim().toUpperCase();
    if (!sym) { $("#fcStatus").textContent = "enter a ticker"; return; }
    this.sym.factors = sym;
    const qs = new URLSearchParams({ range: $("#fcRange").value });
    if ($("#fcRegion").value) qs.set("region", $("#fcRegion").value);
    const rf = parseFloat($("#fcRf").value);
    if (Number.isFinite(rf)) qs.set("rf", String(rf / 100));

    const token = (this._fcToken = Symbol("fc"));
    $("#fcStatus").textContent = "fetching factor legs · aligning calendars · regressing…";
    $("#fcOut").innerHTML = qlLoading(`Building the factor model for ${sym} — fetching each index/ETF leg, intersecting trading calendars and estimating the regression with HAC standard errors…`);
    try {
      const d = await api(`/api/quant/factors/${encodeURIComponent(sym)}?${qs}`);
      if (token !== this._fcToken) return;
      $("#fcStatus").textContent = `${QF.int(d.meta.observations)} common trading days · ${d.meta.from} → ${d.meta.to}${d.meta.dropped.length ? ` · dropped: ${d.meta.dropped.join(", ")}` : ""}`;
      this.remember("fc", d.assessment);
      $("#fcOut").innerHTML = this.renderFactors(d);
      this.drawFactors(d);
    } catch (e) {
      if (token !== this._fcToken) return;
      $("#fcStatus").textContent = "failed";
      $("#fcOut").innerHTML = qlEmpty(e.message || "Factor attribution unavailable.");
    }
  },

  renderFactors(d) {
    const a = d.attribution, m = d.meta, f = a.fit, al = a.alpha;

    const tone = al.significant && al.annualised > 0 ? "good" : al.significant && al.annualised < 0 ? "bad" : "warn";
    const verdict = qlVerdict(tone,
      al.significant
        ? `Alpha of ${QF.pct(al.annualised, 2)} a year, significant at p = ${QF.p(al.pHAC)}`
        : `No statistically reliable alpha — ${QF.pct(al.annualised, 2)} a year, p = ${QF.p(al.pHAC)}`,
      `${QF.pctAbs(f.systematicShare, 0)} of this stock's variance is explained by the factor set; the remaining ${QF.pctAbs(f.specificShare, 0)} is stock-specific risk that no index hedge will remove. ` +
      (al.significant
        ? "The estimate clears the 5% bar even after Newey-West correction for serial correlation."
        : "Once standard errors are corrected for serial correlation, the intercept is indistinguishable from zero — the return is fully accounted for by the exposures below."));

    const cards = `<div class="ql-cards">
      ${qlCard("ALPHA (ANN.)", `<span class="${QF.cls(al.annualised)}">${QF.pct(al.annualised, 2)}</span>`, `HAC t = ${QF.num(al.tHAC)}${QF.stars(al.pHAC)}`, al.significant ? (al.annualised > 0 ? "up" : "down") : "")}
      ${qlCard("R²", QF.pctAbs(f.r2, 1), `adjusted ${QF.pctAbs(f.adjR2, 1)}`)}
      ${qlCard("SYSTEMATIC RISK", QF.pctAbs(f.systematicShare, 0), "of return variance")}
      ${qlCard("STOCK-SPECIFIC", QF.pctAbs(f.specificShare, 0), `${QF.pctAbs(f.residualVolAnn, 1)} idiosyncratic vol`)}
      ${qlCard("TOTAL VOL", QF.pctAbs(f.totalVolAnn, 1), "annualised")}
      ${qlCard("TRACKING ERROR", QF.pctAbs(a.active.trackingError, 1), `info ratio ${QF.num(a.active.informationRatio)}`)}
      ${qlCard("UP / DOWN CAPTURE", `${QF.pctAbs(a.capture.upCapture, 0)} / ${QF.pctAbs(a.capture.downCapture, 0)}`, `${QF.int(a.capture.upDays)} up · ${QF.int(a.capture.downDays)} down days`, (a.capture.upCapture ?? 0) > (a.capture.downCapture ?? 0) ? "up" : "down")}
      ${qlCard("DOWNSIDE BETA", QF.num(a.capture.downBeta), `upside beta ${QF.num(a.capture.upBeta)}`, (a.capture.downBeta ?? 9) < (a.capture.upBeta ?? 0) ? "up" : "down")}
    </div>`;

    /* loadings table + beta bars */
    const rows = a.loadings.map((l) => `<tr>
      <td><b>${esc(l.factor)}</b><div class="ql-dim ql-legs">${esc(l.legs)}</div></td>
      <td class="r ${QF.cls(l.beta)}">${QF.num(l.beta)}</td>
      <td class="r ql-dim">${l.ci ? `${QF.num(l.ci[0])} … ${QF.num(l.ci[1])}` : "—"}</td>
      <td class="r">${QF.num(l.tHAC)}</td>
      <td class="r">${QF.p(l.pHAC)}${QF.stars(l.pHAC)}</td>
      <td class="r ${l.collinear ? "down" : ""}">${QF.num(l.vif, 1)}</td>
      <td class="r ${QF.cls(l.contribution)}">${QF.pct(l.contribution, 2)}</td>
      <td class="ql-dim ql-fdesc">${esc(l.desc)}</td>
    </tr>`);
    const bars = qlBarRows(a.loadings.map((l) => ({
      label: l.factor, v: l.beta, text: QF.num(l.beta) + (l.significant ? QF.stars(l.pHAC) : ""),
      cls: l.significant ? QF.cls(l.beta) : "ql-dim", title: l.desc,
    })));
    const loadings = qlSec("Factor loadings", `${esc(m.regionLabel)} · risk-free ${QF.pctAbs(m.rf, 2)}`,
      `<div class="ql-loadwrap">${bars}${qlTable(
        [{ t: "Factor" }, { t: "β", r: 1 }, { t: "95% CI", r: 1 }, { t: "HAC t", r: 1 }, { t: "p", r: 1 }, { t: "VIF", r: 1 }, { t: "Contrib./yr", r: 1 }, { t: "What it measures" }], rows)}</div>`,
      `β is the return per unit of that spread. <b>Contribution</b> is β × the spread's own realised return, annualised — how much of the stock's performance that exposure actually paid for over this window. <b>VIF</b> flags overlap between factors: above 5, read the β as a blend rather than a clean exposure. Stars mark 10 / 5 / 1% significance on Newey-West standard errors (${f.hacLags} lags).`);

    /* risk decomposition */
    const riskRows = a.riskShare.filter((r) => r.share != null);
    const risk = riskRows.length ? qlSec("Where the risk comes from", "share of return variance attributable to each factor",
      qlBarRows(riskRows.map((r) => ({ label: r.factor, v: r.share, text: QF.pctAbs(r.share, 1) })).concat([
        { label: "Stock-specific", v: f.specificShare, text: QF.pctAbs(f.specificShare, 1) },
      ])),
      "Computed as β × Cov(factor, stock) ÷ Var(stock). Shares sum to R² plus the residual, and can be negative where a factor hedges the rest of the book.") : "";

    /* rolling beta */
    const stab = a.betaStability;
    const rolling = a.rolling && a.rolling.length > 2 ? qlSec("Rolling market beta", "63-day window — style drift is invisible in a full-sample number", `
      <div class="ql-canvas-wrap"><canvas id="fcRoll" height="200"></canvas></div>
      ${stab ? `<div class="ql-cards">
        ${qlCard("CURRENT β", QF.num(stab.latest), `full-sample ${QF.num(a.loadings[0].beta)}`)}
        ${qlCard("RANGE", `${QF.num(stab.min)} – ${QF.num(stab.max)}`, "over the window")}
        ${qlCard("β VOLATILITY", QF.num(stab.sd), "std dev of rolling β", stab.sd > 0.35 ? "down" : "up")}
      </div>
      <p class="ql-prose">${stab.sd > 0.35
        ? `Beta has moved between ${QF.num(stab.min)} and ${QF.num(stab.max)}. A single hedge ratio set from the full-sample number would have been wrong most of the time — size the hedge off the rolling estimate.`
        : `Beta is stable (σ = ${QF.num(stab.sd)}), so the full-sample estimate of ${QF.num(a.loadings[0].beta)} is a fair basis for hedging or position sizing.`}</p>` : ""}`) : "";

    /* factor correlation */
    const fc = d.factorCorrelation;
    const corr = fc && fc.keys.length > 1 ? qlSec("Factor correlation", "how much the proxies overlap — the visual companion to the VIF column",
      `<div class="ql-heat-wrap"><table class="ql-heat ql-heat-corr">
        <tr><th class="ql-heat-corner"></th>${fc.keys.map((k) => `<th>${esc(k)}</th>`).join("")}</tr>
        ${fc.matrix.map((row, i) => `<tr><th>${esc(fc.keys[i])}</th>${row.map((v) => `<td style="${qlDiverge(v, 1)}">${v == null ? "—" : v.toFixed(2)}</td>`).join("")}</tr>`).join("")}
      </table></div>`,
      "Style proxies built from overlapping universes are correlated by construction — a momentum ETF holds many of the same names as a quality one. High off-diagonal values are why the VIF column matters.") : "";

    /* diagnostics */
    const diag = qlSec("Regression diagnostics", "the checks that decide whether the numbers above can be quoted",
      qlTable([{ t: "Test" }, { t: "Value", r: 1 }, { t: "Reading" }], [
        `<tr><td>F-statistic (joint significance)</td><td class="r">${QF.num(f.f, 1)}</td><td>${f.fp != null && f.fp < 0.01 ? "The factor set jointly explains the return — the model is not vacuous." : "The factor set does not jointly explain much; treat individual β with caution."} (p = ${QF.p(f.fp)})</td></tr>`,
        `<tr><td>Durbin-Watson</td><td class="r">${QF.num(f.dw)}</td><td>${f.dw != null && f.dw > 1.7 && f.dw < 2.3 ? "No material residual autocorrelation." : "Residuals are serially correlated — this is exactly why HAC standard errors are used above rather than classical ones."}</td></tr>`,
        `<tr><td>Residual autocorrelation (lag 1)</td><td class="r">${QF.num(f.residualAutocorr, 3)}</td><td>${Math.abs(f.residualAutocorr ?? 0) < 0.08 ? "Negligible." : "Non-trivial — inference relies on the Newey-West correction."}</td></tr>`,
        `<tr><td>Maximum VIF</td><td class="r ${(f.maxVif ?? 0) > 5 ? "down" : ""}">${QF.num(f.maxVif, 1)}</td><td>${(f.maxVif ?? 0) > 5 ? "At least one factor is largely explained by the others; its β is imprecise." : "Multicollinearity is not distorting the estimates."}</td></tr>`,
        `<tr><td>Observations</td><td class="r">${QF.int(a.n)}</td><td>${a.n} common trading days across ${a.factorNames.length} factors plus an intercept.</td></tr>`,
      ]));

    const foot = `<div class="ql-disc">${esc(m.note)} Factors are long-short spreads between live, continuously-quoted instruments — they are proxies for the academic factors, not the Fama-French series themselves, and a loading should be read as exposure to that specific tradable spread. Alpha is measured against this model only: a return this factor set cannot price may still be compensation for a risk it does not contain.</div>`;

    return qlSummary(d.assessment, "fc") + verdict + cards + loadings + risk + rolling + corr + diag + foot;
  },

  drawFactors(d) {
    const r = d.attribution.rolling || [];
    if (r.length < 3) return;
    qlLine($("#fcRoll"), {
      labels: r.map((x) => x.d),
      yFmt: (v) => v.toFixed(2),
      bands: [{ y: d.attribution.loadings[0].beta, color: QL_C.muted, label: "full-sample β" }, { y: 1, color: QL_C.mutedInk, label: "β = 1" }],
      series: [{ name: "Rolling β", color: QL_C.amberBright, data: r.map((x) => x.beta), width: 1.6 }],
    });
  },

  /* ════════════════════════════════════════════════════════════════════════
     DESK 3 · PAIRS & COINTEGRATION
     ════════════════════════════════════════════════════════════════════════ */

  PRESETS: [
    ["HDFCBANK.NS", "ICICIBANK.NS"], ["TCS.NS", "INFY.NS"],
    ["ONGC.NS", "OIL.NS"], ["MARUTI.NS", "M&M.NS"],
    ["KO", "PEP"], ["V", "MA"],
  ],

  buildPairs() {
    const host = $("#qlDeskPairs");
    host.innerHTML = `
      <div class="ql-ctl">
        <div class="ql-ctl-row">
          <label class="ql-f ql-f-sym"><span>Leg A (long side)</span>
            <div class="ql-search"><input id="prSymA" placeholder="HDFCBANK.NS" autocomplete="off" spellcheck="false" /><div class="cmd-results ql-drop" id="prDropA" hidden></div></div>
          </label>
          <span class="ql-vs mono">vs</span>
          <label class="ql-f ql-f-sym"><span>Leg B (hedge)</span>
            <div class="ql-search"><input id="prSymB" placeholder="ICICIBANK.NS" autocomplete="off" spellcheck="false" /><div class="cmd-results ql-drop" id="prDropB" hidden></div></div>
          </label>
          <label class="ql-f ql-f-sm"><span>History</span><select id="prRange"><option value="2y">2Y</option><option value="5y" selected>5Y</option><option value="10y">10Y</option></select></label>
          <button class="btn btn-amber ql-run" id="prRun">Analyse pair</button>
        </div>
        <div class="ql-ctl-row ql-ctl-thin">
          <label class="ql-f ql-f-sm"><span>z-window (days)</span><input id="prWin" type="number" min="20" max="250" step="5" value="60" /></label>
          <label class="ql-f ql-f-sm"><span>Entry |z|</span><input id="prEntry" type="number" min="0.5" max="4" step="0.25" value="2" /></label>
          <label class="ql-f ql-f-sm"><span>Exit |z|</span><input id="prExit" type="number" min="0" max="2" step="0.25" value="0.5" /></label>
          <label class="ql-f ql-f-sm"><span>Stop |z|</span><input id="prStop" type="number" min="2" max="6" step="0.25" value="3.5" /></label>
          <label class="ql-f ql-f-sm"><span>Cost (bp)</span><input id="prCost" type="number" min="0" max="200" step="1" value="15" /></label>
          <div class="ql-presets">${this.PRESETS.map(([a, b]) => `<button class="ql-preset mono" data-a="${a}" data-b="${b}">${a.replace(/\.NS$/, "")} / ${b.replace(/\.NS$/, "")}</button>`).join("")}</div>
        </div>
      </div>
      <div id="prStatus" class="ql-status mono"></div>
      <div id="prOut">${qlEmpty("Two names that move together are not necessarily cointegrated. This desk runs the Engle-Granger test with the correct critical values for a fitted residual, measures how fast the spread actually reverts, and only then backtests the z-score rule.")}</div>`;

    qlSearch($("#prSymA"), $("#prDropA"), () => this.runPairs());
    qlSearch($("#prSymB"), $("#prDropB"), () => this.runPairs());
    $("#prRun").addEventListener("click", () => this.runPairs());
    ["prRange", "prWin", "prEntry", "prExit", "prStop", "prCost"].forEach((id) =>
      $("#" + id).addEventListener("change", () => this.runPairs()));
    $$(".ql-preset", host).forEach((b) => b.addEventListener("click", () => {
      $("#prSymA").value = b.dataset.a; $("#prSymB").value = b.dataset.b; this.runPairs();
    }));
  },

  async runPairs() {
    const a = ($("#prSymA").value || "").trim().toUpperCase();
    const b = ($("#prSymB").value || "").trim().toUpperCase();
    if (!a || !b) { $("#prStatus").textContent = "both legs required"; return; }
    if (a === b) { $("#prStatus").textContent = "a pair needs two different symbols"; return; }
    const qs = new URLSearchParams({
      a, b, range: $("#prRange").value,
      window: $("#prWin").value, entryZ: $("#prEntry").value,
      exitZ: $("#prExit").value, stopZ: $("#prStop").value, costBps: $("#prCost").value,
    });
    const token = (this._prToken = Symbol("pr"));
    $("#prStatus").textContent = "aligning calendars · estimating hedge ratio · testing for cointegration…";
    $("#prOut").innerHTML = qlLoading(`Analysing ${a} / ${b} — fitting the hedge ratio, running the Engle-Granger residual test and measuring the spread's half-life…`);
    try {
      const d = await api(`/api/quant/pairs?${qs}`);
      if (token !== this._prToken) return;
      $("#prStatus").textContent = `${QF.int(d.meta.bars)} overlapping days · ${d.meta.from} → ${d.meta.to}${d.meta.crossCurrency ? " · ⚠ cross-currency pair" : ""}`;
      this.remember("pr", d.assessment);
      $("#prOut").innerHTML = this.renderPairs(d);
      this.drawPairs(d);
    } catch (e) {
      if (token !== this._prToken) return;
      $("#prStatus").textContent = "failed";
      $("#prOut").innerHTML = qlEmpty(e.message || "Pair analysis unavailable.");
    }
  },

  renderPairs(d) {
    const m = d.meta, co = d.cointegration, mr = d.meanReversion, cu = d.current, st = d.strategy, h = d.hedge;

    const tone = d.tradeable ? "good" : co && co.cointegrated ? "warn" : "bad";
    const verdict = qlVerdict(tone,
      co ? co.verdict : "Cointegration test unavailable",
      d.tradeable
        ? `The spread reverts with a half-life of <b>${QF.num(mr.halfLifeDays, 1)} days</b>, comfortably inside the ${m.window}-day z-window — the statistical basis for the trade holds on this sample.`
        : co && co.cointegrated
          ? `Cointegration holds, but the half-life of ${QF.num(mr.halfLifeDays, 1)} days is long relative to the ${m.window}-day window. Positions would sit open through wide excursions; either lengthen the window or accept the carry.`
          : "Without cointegration the spread has no anchor to revert to. A z-score computed on a wandering series will generate signals, but they are not mean-reversion signals — they are noise dressed up as one.");

    /* current signal */
    const sigCls = cu.z == null ? "" : Math.abs(cu.z) >= m.entryZ ? (cu.z < 0 ? "up" : "down") : "";
    const signal = `<div class="ql-signal ${sigCls}">
      <div class="ql-signal-l">
        <div class="ql-signal-lbl mono">CURRENT SPREAD SIGNAL</div>
        <div class="ql-signal-v">${esc(cu.signal)}</div>
        <div class="ql-signal-s">z-score <b>${QF.num(cu.z)}</b> · entry band ±${m.entryZ} · exit ±${m.exitZ} · stop ±${m.stopZ}</div>
      </div>
      <div class="ql-signal-r">
        <div><span class="mono">${esc(m.symA)}</span><b>${QF.num(cu.priceA)}</b></div>
        <div><span class="mono">${esc(m.symB)}</span><b>${QF.num(cu.priceB)}</b></div>
        <div><span class="mono">HEDGE RATIO</span><b>${QF.num(h.beta, 3)}</b></div>
      </div>
    </div>`;

    const cards = `<div class="ql-cards">
      ${qlCard("HALF-LIFE", mr.halfLifeDays == null ? "—" : QF.num(mr.halfLifeDays, 1) + "d", "to close half the gap", mr.halfLifeDays != null && mr.halfLifeDays < 30 ? "up" : "down")}
      ${qlCard("EG STATISTIC", QF.num(co ? co.stat : null), co ? `5% critical ${QF.num(co.crit[5])}` : "", co && co.cointegrated ? "up" : "down")}
      ${qlCard("HURST", QF.num(mr.hurst, 3), esc(mr.hurstRegime || "—"), (mr.hurst ?? 0.5) < 0.5 ? "up" : "")}
      ${qlCard("RETURN CORRELATION", QF.num(d.correlation.returns), `levels ${QF.num(d.correlation.levels)}`)}
      ${qlCard("SPREAD SHARPE", QF.num(st.sharpe), `t = ${QF.num(st.tStat)}${QF.stars(st.pValue)}`, (st.sharpe ?? 0) > 0.5 ? "up" : "")}
      ${qlCard("SPREAD CAGR", `<span class="${QF.cls(st.cagr)}">${QF.pct(st.cagr, 1)}</span>`, `max DD ${QF.pctAbs(st.maxDD, 1)}`)}
      ${qlCard("TRADES", QF.int(st.trades.n), `win ${QF.pctAbs(st.trades.winRate, 0)} · PF ${QF.x(st.trades.profitFactor)}`)}
      ${qlCard("HEDGE FIT", QF.pctAbs(h.r2, 1), `R² of log-price regression`)}
    </div>`;

    const spreadChart = qlSec("Spread &amp; z-score", `${esc(h.notional)}`, `
      <div class="ql-legend"><span><i style="background:${QL_C.amberBright}"></i>z-score</span><span><i style="background:${QL_C.blue}"></i>entry / exit bands</span><span class="ql-dim">shading = position open</span></div>
      <div class="ql-canvas-wrap"><canvas id="prZ" height="240"></canvas></div>
      <div class="ql-sub-l mono">LOG SPREAD — residual of ln ${esc(m.symA)} on ln ${esc(m.symB)}</div>
      <div class="ql-canvas-wrap"><canvas id="prSpread" height="140"></canvas></div>`,
      "The z-score is the spread standardised by its own trailing mean and deviation over the chosen window. Entries fire when it stretches past the band; exits when it returns to fair value. The stop exists because a spread that keeps widening is usually telling you the relationship has broken, not that the opportunity has improved.");

    const cointest = co ? qlSec("Engle-Granger cointegration test", `augmented Dickey-Fuller on the fitted residual · ${co.lag} lag${co.lag === 1 ? "" : "s"} by AIC`,
      qlTable([{ t: "Quantity" }, { t: "Value", r: 1 }, { t: "Reading" }], [
        `<tr><td>Test statistic</td><td class="r">${QF.num(co.stat, 3)}</td><td>More negative ⇒ stronger evidence the spread is stationary.</td></tr>`,
        `<tr><td>1% critical value</td><td class="r">${QF.num(co.crit[1], 3)}</td><td>${co.stat < co.crit[1] ? "✓ rejected at 1%" : "not rejected"}</td></tr>`,
        `<tr><td>5% critical value</td><td class="r">${QF.num(co.crit[5], 3)}</td><td>${co.stat < co.crit[5] ? "✓ rejected at 5%" : "not rejected"}</td></tr>`,
        `<tr><td>10% critical value</td><td class="r">${QF.num(co.crit[10], 3)}</td><td>${co.stat < co.crit[10] ? "✓ rejected at 10%" : "not rejected"}</td></tr>`,
        `<tr><td>Observations</td><td class="r">${QF.int(co.nobs)}</td><td>Critical values are MacKinnon response surfaces adjusted for this sample size.</td></tr>`,
      ]),
      "These are <b>Engle-Granger</b> critical values for a two-variable system, not the plain Dickey-Fuller table. The residual being tested was itself estimated, which makes it look more stationary than it is — using the standard DF criticals here is the single most common way analysts talk themselves into a pair that does not exist.") : "";

    const mrSec = qlSec("Mean-reversion dynamics", "how fast, and how reliably, the spread comes back",
      qlTable([{ t: "Measure" }, { t: "Value", r: 1 }, { t: "Interpretation" }], [
        `<tr><td>Half-life (Ornstein-Uhlenbeck)</td><td class="r">${mr.halfLifeDays == null ? "—" : QF.num(mr.halfLifeDays, 1) + " days"}</td><td>${mr.halfLifeDays == null ? "The spread shows no reversion — λ ≥ 0." : `A deviation decays to half its size in ${QF.num(mr.halfLifeDays, 1)} trading days. Holding periods much shorter than this will exit before the edge is realised; much longer and capital sits idle.`}</td></tr>`,
        `<tr><td>Reversion speed λ</td><td class="r">${QF.num(mr.lambda, 4)}</td><td>Slope of Δspread on lagged spread; t = ${QF.num(mr.tStat)}. Must be negative for reversion.</td></tr>`,
        `<tr><td>Hurst exponent</td><td class="r">${QF.num(mr.hurst, 3)}</td><td>${esc(mr.hurstRegime || "—")} — below 0.5 the series retraces its steps, above 0.5 it trends.</td></tr>`,
        `<tr><td>Correlation stability (63d rolling)</td><td class="r">${d.correlation.stability ? `${QF.num(d.correlation.stability.min)} – ${QF.num(d.correlation.stability.max)}` : "—"}</td><td>${d.correlation.stability && d.correlation.stability.sd > 0.2 ? "Correlation swings materially — the economic link between these two is not constant." : "Correlation is stable across the window."}</td></tr>`,
      ]));

    const rollCorr = d.correlation.rolling && d.correlation.rolling.length > 2
      ? qlSec("Rolling return correlation", "63-day window", `<div class="ql-canvas-wrap"><canvas id="prCorr" height="170"></canvas></div>`,
        "A pair trade is a bet that a relationship persists. Correlation that decays through the sample is the clearest early warning that it is not going to.") : "";

    const perf = qlSec("Spread strategy performance", `z-entry ±${m.entryZ} · exit ±${m.exitZ} · ${m.costBps} bp per leg`, `
      <div class="ql-canvas-wrap"><canvas id="prEq" height="200"></canvas></div>
      <div class="ql-grid2">
        ${qlTable([{ t: "Metric" }, { t: "Value", r: 1 }], [
          `<tr><td>Total return</td><td class="r ${QF.cls(st.totalReturn)}">${QF.pct(st.totalReturn, 1)}</td></tr>`,
          `<tr><td>CAGR</td><td class="r ${QF.cls(st.cagr)}">${QF.pct(st.cagr, 2)}</td></tr>`,
          `<tr><td>Annualised volatility</td><td class="r">${QF.pctAbs(st.vol, 1)}</td></tr>`,
          `<tr><td>Sharpe / Sortino</td><td class="r">${QF.num(st.sharpe)} / ${QF.num(st.sortino)}</td></tr>`,
        ])}
        ${qlTable([{ t: "Metric" }, { t: "Value", r: 1 }], [
          `<tr><td>Max drawdown</td><td class="r down">${QF.pctAbs(st.maxDD, 1)}</td></tr>`,
          `<tr><td>Round trips</td><td class="r">${QF.int(st.trades.n)}</td></tr>`,
          `<tr><td>Win rate / profit factor</td><td class="r">${QF.pctAbs(st.trades.winRate, 0)} / ${QF.x(st.trades.profitFactor)}</td></tr>`,
          `<tr><td>Significance of daily returns</td><td class="r">t = ${QF.num(st.tStat)}, p = ${QF.p(st.pValue)}${QF.stars(st.pValue)}</td></tr>`,
        ])}
      </div>`);

    const tl = (d.tradeList || []).map((t) => `<tr>
      <td class="mono">${esc(t.side)}${t.stillOpen ? ' <span class="ql-open">open</span>' : ""}</td>
      <td class="mono">${t.entryDate}</td><td class="r">${QF.num(t.entryZ)}</td>
      <td class="mono">${t.exitDate}</td><td class="r">${QF.num(t.exitZ)}</td>
      <td class="r">${QF.bars(t.bars)}</td>
      <td class="r ${QF.cls(t.ret)}">${QF.pct(t.ret, 2)}</td></tr>`);
    const ledger = tl.length ? qlSec("Spread trades", `most recent ${tl.length}`,
      qlTable([{ t: "Side" }, { t: "Entry" }, { t: "z in", r: 1 }, { t: "Exit" }, { t: "z out", r: 1 }, { t: "Held", r: 1 }, { t: "Return", r: 1 }], tl)) : "";

    const warn = m.crossCurrency
      ? `<div class="ql-warn">These legs settle in different currencies (${esc(m.currencyA)} vs ${esc(m.currencyB)}). The spread shown therefore embeds an unhedged FX exposure — treat the statistics as indicative until the currency leg is modelled.</div>` : "";

    return qlSummary(d.assessment, "pr") + verdict + signal + cards + warn + spreadChart + cointest + mrSec + rollCorr + perf + ledger +
      `<div class="ql-disc">${esc(d.caveat)}</div>`;
  },

  drawPairs(d) {
    const s = d.series || [];
    if (!s.length) return;
    const labels = s.map((r) => r.d);
    const m = d.meta;

    /* shaded regions where a position is open */
    const shade = [];
    let start = null;
    s.forEach((r, i) => {
      if (r.p !== 0 && start === null) start = i;
      else if (r.p === 0 && start !== null) { shade.push({ from: start, to: i, color: "rgba(200,134,42,0.07)" }); start = null; }
    });
    if (start !== null) shade.push({ from: start, to: s.length - 1, color: "rgba(200,134,42,0.07)" });

    qlLine($("#prZ"), {
      labels, shade, yZero: true,
      yFmt: (v) => v.toFixed(1) + "σ",
      bands: [
        { y: m.entryZ, color: QL_C.blue, label: "entry" }, { y: -m.entryZ, color: QL_C.blue },
        { y: m.exitZ, color: QL_C.mutedInk }, { y: -m.exitZ, color: QL_C.mutedInk },
        { y: 0, color: QL_C.muted, dash: false },
      ],
      series: [{ name: "z-score", color: QL_C.amberBright, data: s.map((r) => r.z), width: 1.5 }],
    });
    qlLine($("#prSpread"), {
      labels, padB: 18,
      yFmt: (v) => v.toFixed(3),
      series: [{ name: "log spread", color: QL_C.violet, data: s.map((r) => r.s), width: 1.3 }],
    });

    const rc = d.correlation.rolling || [];
    if (rc.length > 2) qlLine($("#prCorr"), {
      labels: rc.map((r) => r.d),
      yFmt: (v) => v.toFixed(2),
      bands: [{ y: 0, color: QL_C.mutedInk, dash: false }],
      series: [{ name: "63d correlation", color: QL_C.blue, data: rc.map((r) => r.c), width: 1.4 }],
    });

    const eq = d.equity || [];
    if (eq.length > 2) qlLine($("#prEq"), {
      labels: eq.map((r) => r.d),
      yFmt: (v) => v.toFixed(2) + "×",
      series: [{ name: "Spread strategy", color: QL_C.amberBright, data: eq.map((r) => r.e), width: 1.6, fill: "rgba(200,134,42,0.16)" }],
    });
  },

  /* ════════════════════════════════════════════════════════════════════════
     DESK 4 · RETURN PROFILE
     ════════════════════════════════════════════════════════════════════════ */

  buildProfile() {
    const host = $("#qlDeskProfile");
    host.innerHTML = `
      <div class="ql-ctl">
        <div class="ql-ctl-row">
          <label class="ql-f ql-f-sym"><span>Ticker</span>
            <div class="ql-search"><input id="rpSym" placeholder="RELIANCE.NS · ^NSEI · AAPL" autocomplete="off" spellcheck="false" /><div class="cmd-results ql-drop" id="rpDrop" hidden></div></div>
          </label>
          <label class="ql-f ql-f-sm"><span>History</span><select id="rpRange"><option value="2y">2Y</option><option value="5y" selected>5Y</option><option value="10y">10Y</option><option value="max">Max</option></select></label>
          <button class="btn btn-amber ql-run" id="rpRun">Build profile</button>
        </div>
      </div>
      <div id="rpStatus" class="ql-status mono"></div>
      <div id="rpOut">${qlEmpty("Everything the price chart hides: how fat the left tail really is, how long the drawdowns lasted, whether the calendar matters, and whether the series is efficient enough that none of it should have worked.")}</div>`;

    qlSearch($("#rpSym"), $("#rpDrop"), (s) => { this.sym.profile = s; this.runProfile(); });
    $("#rpRun").addEventListener("click", () => this.runProfile());
    $("#rpRange").addEventListener("change", () => this.runProfile());
  },

  async runProfile() {
    const sym = ($("#rpSym").value || "").trim().toUpperCase();
    if (!sym) { $("#rpStatus").textContent = "enter a ticker"; return; }
    this.sym.profile = sym;
    const token = (this._rpToken = Symbol("rp"));
    $("#rpStatus").textContent = "computing tail risk · drawdowns · seasonality…";
    $("#rpOut").innerHTML = qlLoading(`Profiling ${sym} — fitting the return distribution, reconstructing every drawdown episode and testing the series for exploitable structure…`);
    try {
      const d = await api(`/api/quant/profile/${encodeURIComponent(sym)}?range=${$("#rpRange").value}`);
      if (token !== this._rpToken) return;
      $("#rpStatus").textContent = `${QF.int(d.meta.bars)} bars · ${d.meta.from} → ${d.meta.to}${d.meta.stale ? " · snapshot data" : ""}`;
      this.remember("rp", d.assessment);
      $("#rpOut").innerHTML = this.renderProfile(d);
      this.drawProfile(d);
    } catch (e) {
      if (token !== this._rpToken) return;
      $("#rpStatus").textContent = "failed";
      $("#rpOut").innerHTML = qlEmpty(e.message || "Return profile unavailable.");
    }
  },

  renderProfile(d) {
    const p = d.performance, di = d.distribution, tr = d.tailRisk, v = d.volatility, ef = d.efficiency;
    const v95 = tr.var95, v99 = tr.var99;

    const fat = v95 && v95.fatTailPremium != null && v95.fatTailPremium > 0.1;
    const verdict = qlVerdict(fat ? "warn" : "good",
      fat
        ? `The left tail is ${QF.pctAbs(v95.fatTailPremium, 0)} heavier than a normal distribution assumes`
        : "Tail risk is close to what a normal distribution would predict",
      `Skew ${QF.num(di.skew)}, excess kurtosis ${QF.num(di.excessKurtosis)}. ` +
      (di.jarqueBera && di.jarqueBera.pValue < 0.01
        ? `Jarque-Bera rejects normality decisively (p = ${QF.p(di.jarqueBera.pValue)}), so any risk number built on a Gaussian assumption — including a standard 95% VaR — understates what a bad day looks like. `
        : `Jarque-Bera does not reject normality (p = ${QF.p(di.jarqueBera ? di.jarqueBera.pValue : null)}). `) +
      `The worst single day in this sample was ${QF.pct(p.worstDay, 1)}, against a Gaussian 99% VaR of ${QF.pctAbs(v99 ? v99.gaussian : null, 2)}.`);

    const cards = `<div class="ql-cards">
      ${qlCard("CAGR", `<span class="${QF.cls(p.cagr)}">${QF.pct(p.cagr, 1)}</span>`, `total ${QF.pct(p.totalReturn, 0)}`)}
      ${qlCard("VOLATILITY", QF.pctAbs(p.vol, 1), `downside ${QF.pctAbs(p.downsideDev, 1)}`)}
      ${qlCard("SHARPE", QF.num(p.sharpe), `Sortino ${QF.num(p.sortino)} · Calmar ${QF.num(p.calmar)}`)}
      ${qlCard("MAX DRAWDOWN", `<span class="down">${QF.pctAbs(p.maxDD, 1)}</span>`, `longest ${QF.bars(p.longestDDBars)} underwater`)}
      ${qlCard("CURRENT DD", `<span class="${p.currentDD < -0.01 ? "down" : ""}">${QF.pctAbs(p.currentDD, 1)}</span>`, "below the running peak")}
      ${qlCard("UP DAYS", QF.pctAbs(p.winRateDaily, 1), `best ${QF.pct(p.bestDay, 1)} · worst ${QF.pct(p.worstDay, 1)}`)}
      ${qlCard("VOL REGIME", QF.pctAbs(v.current21d, 1), esc(v.regime), v.percentile > 0.8 ? "down" : v.percentile < 0.2 ? "up" : "")}
      ${qlCard("EWMA FORECAST", QF.pctAbs(v.ewmaForecast, 1), "next-day vol, λ=0.94")}
    </div>`;

    /* tail risk */
    const varRow = (lbl, o) => o ? `<tr>
      <td>${lbl}</td>
      <td class="r down">${QF.pctAbs(o.historical, 2)}</td>
      <td class="r">${QF.pctAbs(o.gaussian, 2)}</td>
      <td class="r">${QF.pctAbs(o.cornishFisher, 2)}</td>
      <td class="r down">${QF.pctAbs(o.cvarHistorical, 2)}</td>
      <td class="r ${o.fatTailPremium > 0.1 ? "down" : ""}">${o.fatTailPremium == null ? "—" : QF.pct(o.fatTailPremium, 0)}</td>
      <td class="r ql-dim">${QF.int(o.tailObservations)}</td></tr>` : "";
    const tail = qlSec("Tail risk", "one-day loss thresholds by three methods",
      qlTable([{ t: "Confidence" }, { t: "Historical", r: 1 }, { t: "Gaussian", r: 1 }, { t: "Cornish-Fisher", r: 1 }, { t: "CVaR (hist.)", r: 1 }, { t: "Fat-tail gap", r: 1 }, { t: "Tail obs", r: 1 }],
        [varRow("95%", v95), varRow("99%", v99)]) + `
      <div class="ql-sub-l mono">DAILY RETURN DISTRIBUTION vs FITTED NORMAL</div>
      <div class="ql-canvas-wrap"><canvas id="rpHist" height="200"></canvas></div>`,
      "<b>Historical</b> reads the loss straight off the empirical quantile. <b>Gaussian</b> assumes normality. <b>Cornish-Fisher</b> expands the Gaussian quantile for the observed skew and kurtosis — usually the most usable of the three. <b>CVaR</b> is the average loss on the days that breach VaR, i.e. how bad it gets once you are already in the tail. The <b>fat-tail gap</b> is how much the Gaussian number understates the historical one.");

    /* drawdowns */
    const ddRows = (d.drawdowns || []).map((e) => `<tr>
      <td class="r down">${QF.pctAbs(e.depth, 1)}</td>
      <td class="mono">${e.peak}</td><td class="mono">${e.trough}</td>
      <td class="mono">${e.recovery || '<span class="ql-open">still underwater</span>'}</td>
      <td class="r">${QF.bars(e.declineBars)}</td>
      <td class="r">${e.recoveryBars == null ? "—" : QF.bars(e.recoveryBars)}</td>
      <td class="r">${QF.bars(e.totalBars)}</td></tr>`);
    const dds = ddRows.length ? qlSec("Drawdown anatomy", "the five deepest episodes",
      qlTable([{ t: "Depth", r: 1 }, { t: "Peak" }, { t: "Trough" }, { t: "Recovered" }, { t: "Fall", r: 1 }, { t: "Recovery", r: 1 }, { t: "Total", r: 1 }], ddRows),
      "Depth is what shows up in a risk report; duration is what actually gets positions closed. Note how much longer recovery usually takes than the decline — a 50% fall needs a 100% rise to get back.") : "";

    /* seasonality matrix */
    const mat = d.seasonality.matrix || [];
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const allVals = mat.flatMap((r) => r.months).filter((x) => x != null);
    const mx = allVals.length ? Math.max(...allVals.map(Math.abs)) : 0.1;
    const heat = `<div class="ql-heat-wrap"><table class="ql-heat ql-heat-seas">
      <tr><th class="ql-heat-corner">Year</th>${MONTHS.map((m) => `<th>${m}</th>`).join("")}<th class="ql-heat-tot">Year</th></tr>
      ${mat.map((r) => `<tr><th>${r.year}</th>${r.months.map((x) => `<td style="${qlRedGreen(x, mx)}">${x == null ? "" : (x * 100).toFixed(1)}</td>`).join("")}<td class="ql-heat-tot ${QF.cls(r.total)}">${r.total == null ? "" : (r.total * 100).toFixed(1)}</td></tr>`).join("")}
    </table></div>`;
    const mStats = (d.seasonality.months || []).filter((m) => m.mean != null);
    const monthTable = mStats.length ? qlTable(
      [{ t: "Month" }, { t: "Mean", r: 1 }, { t: "Median", r: 1 }, { t: "Hit rate", r: 1 }, { t: "Best", r: 1 }, { t: "Worst", r: 1 }, { t: "t", r: 1 }, { t: "p", r: 1 }, { t: "n", r: 1 }],
      mStats.map((m) => `<tr>
        <td>${m.month}</td>
        <td class="r ${QF.cls(m.mean)}">${QF.pct(m.mean, 2)}</td>
        <td class="r">${QF.pct(m.median, 2)}</td>
        <td class="r">${QF.pctAbs(m.hitRate, 0)}</td>
        <td class="r up">${QF.pct(m.best, 1)}</td>
        <td class="r down">${QF.pct(m.worst, 1)}</td>
        <td class="r">${QF.num(m.t)}</td>
        <td class="r ${m.p != null && m.p < 0.05 ? "up" : ""}">${QF.p(m.p)}${QF.stars(m.p)}</td>
        <td class="r ql-dim">${m.n}</td></tr>`)) : "";
    const seas = mat.length ? qlSec("Seasonality", `${d.seasonality.yearsCovered} calendar years of monthly returns`,
      heat + `<div class="ql-sub-l mono">MONTH-OF-YEAR STATISTICS</div>` + monthTable,
      `With only ${d.seasonality.yearsCovered} observations per month, calendar effects need a very low p-value before they mean anything — and testing twelve months at once means roughly one will look significant at 5% by chance alone. Read this as texture, not signal.`) : "";

    /* day of week + turn of month */
    const dow = (d.seasonality.dayOfWeek || []).filter((x) => x.mean != null);
    const tom = d.seasonality.turnOfMonth;
    const cal = dow.length ? qlSec("Calendar effects", "day-of-week and turn-of-month", `<div class="ql-grid2">
      <div>${qlBarRows(dow.map((x) => ({ label: x.day, v: x.mean, text: QF.bp(x.mean), cls: QF.cls(x.mean) })))}
      <div class="ql-sub-l mono" style="margin-top:6px">AVERAGE DAILY RETURN BY WEEKDAY</div></div>
      <div>${tom ? qlTable([{ t: "Window" }, { t: "Per day", r: 1 }, { t: "Annualised", r: 1 }, { t: "Days", r: 1 }], [
        `<tr><td>Turn of month (last day + first three)</td><td class="r ${QF.cls(tom.windowMean)}">${QF.bp(tom.windowMean)}</td><td class="r ${QF.cls(tom.windowAnnualised)}">${QF.pct(tom.windowAnnualised, 1)}</td><td class="r ql-dim">${QF.int(tom.windowDays)}</td></tr>`,
        `<tr><td>Rest of month</td><td class="r ${QF.cls(tom.restMean)}">${QF.bp(tom.restMean)}</td><td class="r ${QF.cls(tom.restAnnualised)}">${QF.pct(tom.restAnnualised, 1)}</td><td class="r ql-dim">${QF.int(tom.restDays)}</td></tr>`,
        `<tr class="ql-tot"><td>Edge</td><td class="r ${QF.cls(tom.edge)}">${QF.bp(tom.edge)}</td><td class="r"></td><td class="r"></td></tr>`,
      ]) : qlEmpty("Not enough data for the turn-of-month split.")}</div>
    </div>`) : "";

    /* microstructure */
    const mi = d.microstructure;
    const micro = mi ? qlSec("Overnight vs intraday", "where the return is actually earned", `<div class="ql-grid2">
      ${qlTable([{ t: "Session" }, { t: "Annualised return", r: 1 }, { t: "Annualised vol", r: 1 }], [
        `<tr><td>Overnight (prior close → open)</td><td class="r ${QF.cls(mi.overnightAnn)}">${QF.pct(mi.overnightAnn, 1)}</td><td class="r">${QF.pctAbs(mi.overnightVol, 1)}</td></tr>`,
        `<tr><td>Intraday (open → close)</td><td class="r ${QF.cls(mi.intradayAnn)}">${QF.pct(mi.intradayAnn, 1)}</td><td class="r">${QF.pctAbs(mi.intradayVol, 1)}</td></tr>`,
      ])}
      <div class="ql-prose"><p>${({
        "overnight-dominated": `<b>${QF.pctAbs(mi.overnightShare, 0)} of the return arrives overnight</b>, in the gap between yesterday's close and today's open. That return is not capturable by any intraday rule, and it is not tradeable without holding through the close.`,
        "intraday-dominated": `Most of the return is earned <b>inside the session</b>, with the overnight gap contributing ${QF.pctAbs(mi.overnightShare, 0)}. Intraday execution matters here.`,
        "balanced": `Return is split fairly evenly between the overnight gap and the cash session.`,
        "overnight-only": `<b>The entire return is earned overnight.</b> Gaps deliver ${QF.pct(mi.overnightAnn, 1)} a year while the cash session gives back ${QF.pct(mi.intradayAnn, 1)} — buying at the close and selling at the next open would have beaten holding, before costs. A share-of-return figure is not meaningful when the two legs pull in opposite directions.`,
        "intraday-only": `<b>The entire return is earned inside the session.</b> The cash session delivers ${QF.pct(mi.intradayAnn, 1)} a year while overnight gaps subtract ${QF.pct(mi.overnightAnn, 1)} — the opening auction has consistently opened lower than the prior close.`,
      })[mi.pattern] || "Return is split between the overnight gap and the cash session."}</p>
      <p>Gap and session returns correlate at ${QF.num(mi.gapCorr)}${(mi.gapCorr ?? 0) < -0.05 ? " — negative, the classic pattern of an opening auction that overshoots and is partly retraced during the day." : "."}</p></div>
    </div>`) : "";

    /* rolling risk */
    const roll = (d.rolling || []).length > 2 ? qlSec("Rolling one-year risk", "252-day window", `
      <div class="ql-legend"><span><i style="background:${QL_C.amberBright}"></i>Volatility %</span><span><i style="background:${QL_C.blue}"></i>Return %</span></div>
      <div class="ql-canvas-wrap"><canvas id="rpRoll" height="220"></canvas></div>`,
      "Trailing volatility and return on the same axis. The gap between them is what a Sharpe ratio compresses into one number — and it moves far more than a single full-sample figure suggests.") : "";

    /* efficiency */
    const vrRows = (ef.varianceRatios || []).map((x) => `<tr>
      <td>q = ${x.q} days</td><td class="r">${QF.num(x.vr)}</td><td class="r">${QF.num(x.z)}</td>
      <td class="r ${x.pValue < 0.05 ? "up" : ""}">${QF.p(x.pValue)}${QF.stars(x.pValue)}</td>
      <td>${x.pValue < 0.05 ? `<b>${esc(x.reading)}</b> — random walk rejected` : "Consistent with a random walk"}</td></tr>`);
    const eff = qlSec("Is there anything to trade?", "tests for exploitable structure in the return series",
      qlTable([{ t: "Horizon" }, { t: "Variance ratio", r: 1 }, { t: "z", r: 1 }, { t: "p", r: 1 }, { t: "Reading" }], vrRows) + `
      <div class="ql-grid2" style="margin-top:12px">
        ${qlTable([{ t: "Test" }, { t: "Value", r: 1 }], [
          `<tr><td>Hurst exponent</td><td class="r">${QF.num(ef.hurst ? ef.hurst.h : null, 3)}</td></tr>`,
          `<tr><td>Autocorrelation, lag 1</td><td class="r">${QF.num(ef.autocorr1, 3)}</td></tr>`,
          `<tr><td>Autocorrelation, lag 5</td><td class="r">${QF.num(ef.autocorr5, 3)}</td></tr>`,
          `<tr><td>Ljung-Box Q(10)</td><td class="r">${QF.num(ef.ljungBox ? ef.ljungBox.q : null, 1)} (p = ${QF.p(ef.ljungBox ? ef.ljungBox.pValue : null)})</td></tr>`,
        ])}
        <div class="ql-prose"><p>${ef.hurst ? `<b>Hurst ${QF.num(ef.hurst.h, 3)} — ${esc(ef.hurst.regime).toLowerCase()}.</b> ` : ""}${
          (ef.varianceRatios || []).some((x) => x.pValue < 0.05)
            ? "At least one horizon rejects the random walk, which is the statistical precondition for a timing rule to have anything to work with. It does not tell you the effect survives transaction costs — that is what the backtester is for."
            : "No horizon rejects the random walk. Returns here look serially unpredictable, so any strategy that appears to work on this series is drawing on volatility timing or exposure, not on forecastable direction."}</p>
        <p>${ef.ljungBox && ef.ljungBox.pValue < 0.05
          ? "Ljung-Box detects joint autocorrelation across the first ten lags — there is structure, though it may be too small to trade net of costs."
          : "Ljung-Box finds no joint autocorrelation in the first ten lags."}</p></div>
      </div>`,
      "A variance ratio above 1 means multi-day moves are larger than daily volatility implies — trends persist. Below 1 means they are smaller — moves get retraced. Exactly 1 is a random walk, in which case nothing in the price history predicts the next move.");

    const foot = `<div class="ql-disc">Computed from ${QF.int(d.meta.bars)} daily closes (${d.meta.from} → ${d.meta.to}), price-only: dividends, splits beyond Yahoo's adjustment, and financing costs are excluded. Every test reported is a statement about this sample. Seasonality and calendar effects in particular are fragile — they are shown so that they can be discounted honestly, not so that they can be traded.</div>`;

    return qlSummary(d.assessment, "rp") + verdict + cards + tail + dds + seas + cal + micro + roll + eff + foot;
  },

  drawProfile(d) {
    qlHist($("#rpHist"), d.distribution.histogram || []);
    const r = d.rolling || [];
    if (r.length > 2) qlLine($("#rpRoll"), {
      labels: r.map((x) => x.d), yZero: true,
      yFmt: (v) => v.toFixed(0) + "%",
      bands: [{ y: 0, color: QL_C.mutedInk, dash: false }],
      series: [
        { name: "Return %", color: QL_C.blue, data: r.map((x) => x.ret), width: 1.3 },
        { name: "Volatility %", color: QL_C.amberBright, data: r.map((x) => x.vol), width: 1.5 },
      ],
    });
  },
};

/* ── tab registration ─────────────────────────────────────────────────────
   TABS is defined in terminal.js; terminal-modules.js boots after every
   module script has registered, so declaring here is safe. ── */
TABS.quant = {
  init() { QUANT.mount(); },
  syncContext() { QUANT.syncContext(); },
};
