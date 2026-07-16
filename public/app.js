/* MERIDIAN landing — Tres Mares-style motion + live data ticker. */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ── unified scroll dispatcher: ONE listener, rAF-batched, one read/frame ── */
const _scrollSubs = [];
let _scrollY = window.scrollY || 0;
let _scrollQueued = false;
function onScrollFrame(fn) { _scrollSubs.push(fn); }
function _flushScroll() {
  _scrollQueued = false;
  _scrollY = window.scrollY || 0;
  for (let i = 0; i < _scrollSubs.length; i++) _scrollSubs[i](_scrollY);
}
addEventListener("scroll", () => {
  if (_scrollQueued) return;
  _scrollQueued = true;
  requestAnimationFrame(_flushScroll);
}, { passive: true });

/* ── nav scrolled state ── */
onScrollFrame((y) => $("#nav").classList.toggle("scrolled", y > 40));

/* ── word-by-word reveal (the Tres Mares signature) ── */
function setupWordReveal() {
  $$(".reveal-words").forEach((el) => {
    const accentText = el.querySelector(".accent")?.textContent || "";
    const words = el.textContent.trim().split(/\s+/);
    el.textContent = "";
    words.forEach((w, i) => {
      const span = document.createElement("span");
      span.className = "word";
      span.textContent = w + (i < words.length - 1 ? " " : "");
      el.appendChild(span);
    });
    el._words = $$(".word", el);
  });
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const words = e.target._words || [];
      words.forEach((w, i) => setTimeout(() => w.classList.add("lit"), reduced ? 0 : i * 55));
      io.unobserve(e.target);
    });
  }, { threshold: 0.35 });
  $$(".reveal-words").forEach((el) => io.observe(el));
}

/* ── reveal-up / rise-in elements ── */
function setupReveal() {
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    e.target.classList.add("vis");
    io.unobserve(e.target);
    // stagger delay is entrance-only: clear it so hover transitions stay instant
    setTimeout(() => e.target.style.removeProperty("--d"), 1700);
  }), { threshold: 0.12 });
  $$(".reveal-up, .rise-in").forEach((el) => io.observe(el));
}

/* ── entrance staggering for grouped elements ── */
function applyStagger() {
  // grids whose cells enter together get an index-based delay
  const groups = [".caps-grid > .cap", ".samples-grid > .sample", ".price-grid > .price-card",
                  ".stats-right > .stat-cell", ".trust-list > .tl-row"];
  groups.forEach((sel) => $$(sel).forEach((el, i) => {
    el.classList.add("reveal-up");
    if (!el.style.getPropertyValue("--d")) el.style.setProperty("--d", (Math.min(i, 7) * 0.07) + "s");
  }));
  // feedback cards animate via one-shot keyframe so hover lifts never slow down
  $$(".fb-grid > .fb-card").forEach((el, i) => {
    el.classList.add("rise-in");
    el.style.setProperty("--d", (i * 0.12) + "s");
  });
}

/* ── reveal orchestration: everything waits for the intro curtain ── */
function startReveals() {
  if (startReveals.done) return;
  startReveals.done = true;
  applyStagger();
  setupWordReveal();
  setupReveal();
  initCounters();
}

/* ── INTRO — multilingual greeting curtain (reference-style) ── */
function initIntro() {
  const el = document.getElementById("intro");
  const word = document.getElementById("introWord");
  if (!el || !word || reduced) { if (el) el.remove(); startReveals(); return; }
  // the curtain choreography assumes we start at the top — don't let the
  // browser async-restore a deep scroll offset underneath it
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  window.scrollTo(0, 0);
  const html = document.documentElement;
  html.classList.add("intro-hold");
  if (lenis) lenis.stop();
  let lifted = false;
  function lift() {
    if (lifted) return;
    lifted = true;
    startReveals();                       // hero rises while the curtain lifts
    el.classList.add("lift");
    html.classList.remove("intro-hold");
    if (lenis) lenis.start();
    const cleanup = () => { if (el.parentNode) el.remove(); };
    el.addEventListener("transitionend", cleanup, { once: true });
    setTimeout(cleanup, 1400);            // safety net
  }
  const words = ["Hello", "नमस्ते", "Bonjour", "Hola", "Ciao", "こんにちは", "안녕하세요", "Olá"];
  let i = 0;
  function next() {
    if (lifted) return;
    i++;
    if (i >= words.length) { lift(); return; }
    word.textContent = words[i];
    setTimeout(next, i === 1 ? 320 : 250);
  }
  // background-tab load: hold the curtain and start the sequence only once
  // the tab is actually visible, so the choreography is never wasted
  function begin() { setTimeout(next, 540); }
  if (document.visibilityState === "hidden") {
    const onVis = () => {
      if (document.visibilityState !== "hidden") { document.removeEventListener("visibilitychange", onVis); begin(); }
    };
    document.addEventListener("visibilitychange", onVis);
  } else {
    begin();
  }
  el.addEventListener("pointerdown", lift, { once: true });   // click to skip
}

/* ── HERO globe: five exchange hubs on a fine dot world, market arcs ── */
/* ── HERO: dynamic layered mountain terrain with scroll parallax ──
   Grayscale ridged layers + drifting fog, fading into the paper background.
   Mirrors the reference's misty, dimensional mountain that the hero text
   scrolls over with parallax. */
function startTerrain() {
  const cv = document.getElementById("terrain");
  if (!cv) return;
  const ctx = cv.getContext("2d");
  const dpr = Math.min(devicePixelRatio || 1, 1.25);
  let W, H, layers = [], fog = [], fogSprite = null, topFade = null;

  // value-noise ridgeline generator (deterministic per layer seed)
  function ridge(seed, points, roughness) {
    const r = [];
    let prev = 0.5 + (Math.sin(seed) * 0.1);
    for (let i = 0; i <= points; i++) {
      const n = Math.sin(i * 0.5 + seed) * 0.5 + Math.sin(i * 0.17 + seed * 2.1) * 0.3 + Math.sin(i * 1.3 + seed * 0.7) * 0.2;
      prev = prev * 0.55 + (0.5 + n * roughness) * 0.45;
      r.push(prev);
    }
    return r;
  }

  function build() {
    // 4 depth layers: far (light) → near (darker), each a ridgeline
    const defs = [
      { seed: 1.2, top: 0.46, amp: 0.16, tone: 224, rough: 0.5, par: 0.12 },
      { seed: 3.7, top: 0.54, amp: 0.20, tone: 210, rough: 0.62, par: 0.20 },
      { seed: 6.1, top: 0.62, amp: 0.24, tone: 192, rough: 0.74, par: 0.30 },
      { seed: 9.4, top: 0.72, amp: 0.30, tone: 172, rough: 0.9, par: 0.44 },
    ];
    layers = defs.map((d) => ({ ...d, pts: ridge(d.seed, 18, d.rough), fill: `rgb(${d.tone - 8},${d.tone - 8},${d.tone - 10})` }));
    fog = Array.from({ length: 5 }, (_, i) => ({
      y: 0.5 + Math.random() * 0.45, x: Math.random(), r: 0.18 + Math.random() * 0.22,
      v: (0.004 + Math.random() * 0.006) * (Math.random() > 0.5 ? 1 : -1), o: 0.25 + Math.random() * 0.3,
    }));
  }
  function buildSprites() {
    // one reusable soft fog blob, drawn via drawImage (no per-frame radial gradients)
    const s = 256;
    const fc = document.createElement("canvas"); fc.width = fc.height = s;
    const fx = fc.getContext("2d");
    const rg = fx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    rg.addColorStop(0, "rgba(247,246,243,1)");
    rg.addColorStop(1, "rgba(247,246,243,0)");
    fx.fillStyle = rg; fx.fillRect(0, 0, s, s);
    fogSprite = fc;
    // cached top fade
    topFade = ctx.createLinearGradient(0, 0, 0, H * 0.5);
    topFade.addColorStop(0, "#f7f6f3"); topFade.addColorStop(1, "rgba(247,246,243,0)");
  }
  function resize() { W = cv.width = innerWidth * dpr; H = cv.height = innerHeight * dpr; build(); buildSprites(); }
  resize();
  addEventListener("resize", resize);

  let scrollY = window.scrollY || 0;
  let active = true;
  let rafId = 0;
  function updateActive() {
    const stats = document.getElementById("stats");
    const cutoff = stats ? stats.offsetTop + stats.offsetHeight : window.innerHeight * 2;
    const shouldShow = scrollY < cutoff;
    if (shouldShow !== active) {
      active = shouldShow;
      cv.style.opacity = active ? "1" : "0";
      cv.style.visibility = active ? "visible" : "hidden";
      if (active && !rafId) { rafId = requestAnimationFrame(frame); }      // restart loop
      else if (!active && rafId) { cancelAnimationFrame(rafId); rafId = 0; } // truly stop
    }
  }
  cv.style.transition = "opacity .5s ease";
  onScrollFrame((y) => { scrollY = y; updateActive(); });
  addEventListener("resize", updateActive);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  function drawLayer(L, t, sp) {
    const baseTop = H * L.top - sp * L.par * dpr; // parallax: shift up slower than scroll
    ctx.beginPath();
    ctx.moveTo(0, H);
    const n = L.pts.length - 1;
    for (let i = 0; i <= n; i++) {
      const x = (i / n) * W;
      const y = baseTop + (L.pts[i] - 0.5) * L.amp * H;
      if (i === 0) ctx.lineTo(x, y); else {
        const px = ((i - 1) / n) * W, py = baseTop + (L.pts[i - 1] - 0.5) * L.amp * H;
        ctx.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
      }
    }
    ctx.lineTo(W, H); ctx.closePath();
    // cheap flat fill (no per-frame gradient allocation)
    ctx.fillStyle = L.fill;
    ctx.fill();
  }

  let t0 = performance.now();
  let smoothScroll = scrollY;
  let lastDraw = 0;
  function frame(now) {
    if (!active) { rafId = 0; return; } // stop scheduling; updateActive restarts
    rafId = requestAnimationFrame(frame);
    if (now - lastDraw < 33) return; // ~30fps cap
    lastDraw = now;
    const t = (now - t0) / 1000;
    smoothScroll += (scrollY - smoothScroll) * 0.12; // eased follow
    const sp = smoothScroll;
    ctx.fillStyle = "#f7f6f3"; ctx.fillRect(0, 0, W, H);
    for (const L of layers) drawLayer(L, t, sp);
    // fog via cheap drawImage of a pre-rendered sprite
    for (const f of fog) {
      if (!reduce) { f.x += f.v; if (f.x > 1.2) f.x = -0.2; if (f.x < -0.2) f.x = 1.2; }
      const cx = f.x * W, cy = f.y * H - sp * 0.18 * dpr, rad = f.r * W;
      ctx.globalAlpha = f.o;
      ctx.drawImage(fogSprite, cx - rad, cy - rad, rad * 2, rad * 2);
    }
    ctx.globalAlpha = 1;
    if (topFade) { ctx.fillStyle = topFade; ctx.fillRect(0, 0, W, H * 0.5); }
  }
  updateActive();
  if (active) rafId = requestAnimationFrame(frame);
}

/* ── LIVE ticker ── */
const TICK = [
  ["NIFTY 50", "^NSEI"], ["SENSEX", "^BSESN"], ["NASDAQ", "^IXIC"], ["S&P 500", "^GSPC"],
  ["USD/INR", "USDINR=X"], ["GOLD", "GC=F"], ["WTI CRUDE", "CL=F"],
];
async function loadTicker() {
  try {
    const data = await (await fetch("/api/pulse")).json();
    const all = Object.values(data.groups).flat();
    const by = Object.fromEntries(all.map((q) => [q.symbol, q]));
    const html = TICK.map(([label, sym]) => {
      const q = by[sym]; if (!q || q.price == null) return "";
      const dir = q.change >= 0 ? "up" : "down";
      const v = q.price.toLocaleString("en-IN", { maximumFractionDigits: 2 });
      return `<span class="tk"><span class="tk-l">${label}</span><span class="tk-v">${v}</span><span class="${dir}">${q.changePct >= 0 ? "+" : ""}${(q.changePct ?? 0).toFixed(2)}%</span></span>`;
    }).join("");
    $("#tickerTrack").innerHTML = html + html;
  } catch { $("#tickerTrack").innerHTML = `<span class="tk"><span class="tk-l">Live market feed connecting…</span></span>`; }
}

/* ── PIPELINE mockups ── */
const PIPE = [
  `<span class="dim">$</span> meridian open <span class="am">RELIANCE.NS</span>\n\nResolving issuer · NSE / BSE\nCurrency  INR\nSector    Energy · Conglomerates\n\n<span class="ok">✓</span> Workspace created`,
  `<span class="dim">extracting filings…</span>\n\n<span class="ok">✓</span> Annual report ............ 412 pp\n<span class="ok">✓</span> Quarterly results ........ 4 filings\n<span class="ok">✓</span> Transcripts .............. 8 quarters\n\nBasis <span class="am">CONSOLIDATED</span> · Ind AS · tie-outs passed`,
  `<span class="dim">computing analytics…</span>\n\nRevenue CAGR (5y)   11.8%\nEBITDA margin       15.9% → 17.1%  <span class="ok">▲</span>\nROCE                9.6%\nCash conversion     87%            <span class="ok">healthy</span>\nAccruals ratio      2.1%           <span class="ok">low</span>`,
  `<span class="dim">three-stage FCFF…</span>\n\nWACC        <span class="am">10.9%</span>  rf 7.1% · β 1.02 · ERP 6.0%\nTerminal g  <span class="am">4.5%</span>\n\nBear  ₹1,210   Base  ₹1,640   Bull  ₹1,890\nCross-check: comps · SOTP · 10y bands`,
  `<span class="dim">drafting · adversarial review…</span>\n\nThesis framing 2 of 3 selected\nBusiness ............ <span class="ok">31 citations</span>\nFinancials .......... <span class="ok">24 citations</span>\nBear-case agent ..... <span class="am">3 objections → Risks</span>\nVerifier ............ <span class="ok">132/132 claims checked</span>`,
  `<span class="dim">composite scorecard…</span>\n\nValuation vs intrinsic   30%  <span class="ok">+18.2%</span>\nFundamental trajectory   25%  <span class="ok">improving</span>\nQuality & forensics      20%  <span class="ok">clean</span>\nIndustry · sentiment     25%  positive\n\nRATING  <span class="ok">BUY</span> · TP ₹1,640 · 3m 41s`,
];
function initPipeline() {
  const steps = $$(".pstep"), mock = $("#pipeMock"), meta = $("#pipeMeta");
  let cur = -1, timer;
  function show(i) { cur = i; steps.forEach((s, j) => s.classList.toggle("active", j === i)); mock.innerHTML = PIPE[i]; const secs = [4, 38, 84, 132, 199, 221][i]; meta.textContent = `RELIANCE.NS · elapsed ${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, "0")}s`; }
  function auto() { timer = setInterval(() => show((cur + 1) % PIPE.length), 4200); }
  steps.forEach((s) => s.addEventListener("click", () => { clearInterval(timer); show(+s.dataset.i); auto(); }));
  show(0); if (!reduced) auto();
}

/* ── SHOWCASE mockups ── */
const SHOW = [
  { title: "meridian · research workspace", body: `<div class="mk-head"><h5>Reliance Industries</h5><span class="mk-px">₹1,388.40</span></div><div class="mk-kv"><div><div class="k">Market cap</div><div class="v">₹18.7 L Cr</div></div><div><div class="k">EV / EBITDA</div><div class="v">11.2x</div></div><div><div class="k">ROE</div><div class="v">9.5%</div></div><div><div class="k">P/E</div><div class="v">24.5x</div></div><div><div class="k">Beta</div><div class="v">1.02</div></div><div><div class="k">Promoter</div><div class="v">50.3%</div></div></div><p class="mk-cap">A persistent workstation builds itself from live filings — overview, statements, ratios, ownership and valuation, each cell traceable to its source.</p>` },
  { title: "meridian · financial statements", body: `<div class="mk-head"><h5>Income statement</h5><span class="mono" style="font-size:11px;color:var(--muted)">CONSOLIDATED · ₹ Cr</span></div><div style="margin-top:16px"><div class="mk-row"><span class="lbl">Revenue</span><span>9,74,864</span><span>10,00,122</span><span>10,71,174</span></div><div class="mk-row"><span class="lbl">Operating income</span><span>1,20,341</span><span>1,30,210</span><span>1,45,008</span></div><div class="mk-row"><span class="lbl">Net income</span><span>73,670</span><span>79,020</span><span>81,309</span></div><div class="mk-row"><span class="lbl">EBITDA margin</span><span>15.9%</span><span>16.5%</span><span>17.1%</span></div></div><p class="mk-cap">Standardized, tied out and common-sized — every figure clicks through to the filing page it came from.</p>` },
  { title: "meridian · valuation model", body: `<div class="mk-head"><h5>DCF · base case</h5><span class="mk-px">₹1,640</span></div><div class="mk-kv"><div><div class="k">WACC</div><div class="v">10.9%</div></div><div><div class="k">Terminal g</div><div class="v">4.5%</div></div><div><div class="k">Upside</div><div class="v" style="color:var(--up)">+18.2%</div></div></div><div class="mk-bars"><div class="mk-bar"><span class="bl">DCF base</span><span class="bt"><i style="left:34%;width:30%"></i></span></div><div class="mk-bar"><span class="bl">EV/EBITDA</span><span class="bt"><i style="left:28%;width:28%"></i></span></div><div class="mk-bar"><span class="bl">SOTP</span><span class="bt"><i style="left:40%;width:34%"></i></span></div></div><p class="mk-cap">Every assumption is editable and carries its derivation; the football field feeds the report directly.</p>` },
  { title: "meridian · peer comparison", body: `<div class="mk-head"><h5>Peer set</h5><span class="mono" style="font-size:11px;color:var(--muted)">AUTO-SELECTED</span></div><div style="margin-top:16px"><div class="mk-row" style="color:var(--muted);font-size:10px"><span class="lbl">COMPANY</span><span>P/E</span><span>ROE</span><span>NET MGN</span></div><div class="mk-row"><span class="lbl">Reliance</span><span>24.5x</span><span>9.5%</span><span>7.6%</span></div><div class="mk-row"><span class="lbl">ONGC</span><span>8.1x</span><span>16.2%</span><span>9.1%</span></div><div class="mk-row"><span class="lbl">BPCL</span><span>6.4x</span><span>21.0%</span><span>3.2%</span></div><div class="mk-row"><span class="lbl">IOC</span><span>7.8x</span><span>18.4%</span><span>2.9%</span></div></div><p class="mk-cap">Peers proposed on business mix and size, then compared on growth, returns and multiples — a premium has to be earned.</p>` },
  { title: "meridian · quality of earnings", body: `<div class="mk-head"><h5>Forensic screen</h5><span class="rec watch" style="font-size:10px">3 FLAGS</span></div><div style="margin-top:16px"><div class="mk-row"><span class="lbl">Accruals ratio</span><span style="color:var(--up)">2.1% · low</span></div><div class="mk-row"><span class="lbl">Cash conversion</span><span style="color:var(--up)">87%</span></div><div class="mk-row"><span class="lbl">Promoter pledge</span><span style="color:var(--up)">0.0%</span></div><div class="mk-row"><span class="lbl">Receivable days</span><span style="color:var(--accent)">+11 YoY</span></div><div class="mk-row"><span class="lbl">Related-party txns</span><span style="color:var(--accent)">review</span></div></div><p class="mk-cap">Accruals, cash backing and pledge data — each flag is a claim with a citation, never a naked accusation.</p>` },
  { title: "meridian · research report", body: `<div class="mk-head"><h5>Initiating coverage</h5><span class="rec buy" style="font-size:10px">BUY</span></div><p style="font-size:12px;color:var(--muted-ink);margin-top:8px">All figures in &#8377; Cr unless stated &middot; TP &#8377;1,640 (+18.2%)</p><div style="margin-top:14px"><div style="font-family:var(--mono);font-size:9px;letter-spacing:.12em;color:var(--accent)">EXHIBIT 3 &middot; DCF &mdash; EXPLICIT FCFF FORECAST</div><div class="mk-row" style="color:var(--muted);font-size:9.5px;margin-top:6px"><span class="lbl">FY</span><span>FY26E</span><span>FY27E</span><span>FY28E</span></div><div class="mk-row"><span class="lbl">Revenue</span><span>10,71,174</span><span>11,89,002</span><span>13,06,131</span></div><div class="mk-row"><span class="lbl">EBITDA</span><span>1,83,422</span><span>2,06,151</span><span>2,29,887</span></div><div class="mk-row"><span class="lbl">FCFF</span><span>62,140</span><span>71,408</span><span>80,225</span></div><div class="mk-row"><span class="lbl">PV @ 10.9%</span><span>56,032</span><span>58,066</span><span>58,829</span></div></div><p class="mk-cap">Full working — WACC build, valuation bridge, sensitivity grid, football field and comps. Cover page, numbered exhibits, print-ready.</p>` },
];
const SHOW_CAP = [
  "A persistent workstation builds itself from live filings — overview, statements, ratios, ownership and valuation, each cell traceable to its source.",
  "Five-year income, balance sheet and cash flow — standardized, tied out and common-sized, every figure clicking through to its filing.",
  "A full FCFF working — forecast schedule, WACC build, valuation bridge, sensitivity grid and football field. Every assumption editable.",
  "Peers proposed on business mix and size, then compared on growth, returns and multiples — a premium has to be earned.",
  "Accruals, cash conversion, pledge and related-party screens — each flag a claim with a citation, never a naked accusation.",
  "Initiating coverage to a bulge-bracket standard — cover page, numbered exhibits, full DCF working and comps, print-ready.",
];
function initShowcase() {
  const tabs = $$(".show-tab"), body = $("#showBody"), title = $("#mockTitle"), cap = $("#showCaption");
  if (!tabs.length) return;
  let cur = -1;
  function show(i) {
    if (i === cur) return; cur = i;
    tabs.forEach((t, j) => t.classList.toggle("active", j === i));
    // brief fade for a "camera-like" transition
    body.style.opacity = 0; body.style.transform = "translateY(8px)";
    setTimeout(() => {
      body.innerHTML = SHOW[i].body; title.innerHTML = SHOW[i].title;
      if (cap) cap.textContent = SHOW_CAP[i] || "";
      body.style.transition = "opacity .45s ease, transform .45s ease";
      body.style.opacity = 1; body.style.transform = "none";
    }, reduced ? 0 : 150);
  }
  tabs.forEach((t) => t.addEventListener("click", () => show(+t.dataset.s)));
  show(0);
  startAmbient();
}

/* ambient organic background behind the showcase (the reference's plant/3D object feel) */
function startAmbient() {
  const cv = $("#showAmbient"); if (!cv) return;
  const ctx = cv.getContext("2d");
  const dpr = Math.min(devicePixelRatio || 1, 1.25);
  let W, H, branches = [];
  function build() {
    branches = [];
    const rx = W * 0.5, ry = H * 0.98;
    function grow(x, y, ang, len, depth) {
      if (depth > 9 || len < 6 * dpr) return;
      const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len;
      branches.push({ x1: x, y1: y, x2: ex, y2: ey, depth, w: Math.max(0.4, (10 - depth) * 0.4) * dpr, seed: Math.random() });
      const s = 0.4 + Math.random() * 0.45;
      grow(ex, ey, ang - s * Math.random(), len * (0.72 + Math.random() * 0.12), depth + 1);
      grow(ex, ey, ang + s * Math.random(), len * (0.72 + Math.random() * 0.12), depth + 1);
      if (Math.random() > 0.55) grow(ex, ey, ang + (Math.random() - 0.5) * 0.3, len * 0.62, depth + 1);
    }
    grow(rx, ry, -Math.PI / 2, H * 0.2, 0);
  }
  function resize() { W = cv.width = cv.offsetWidth * dpr; H = cv.height = cv.offsetHeight * dpr; build(); }
  resize(); addEventListener("resize", resize);
  // only render while the showcase is on-screen
  const section = document.getElementById("showcase");
  let visible = false;
  if (section && "IntersectionObserver" in window) {
    new IntersectionObserver((es) => es.forEach((e) => { visible = e.isIntersecting; }), { threshold: 0 }).observe(section);
  } else { visible = true; }
  let t0 = performance.now(), last = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!visible) return;
    if (now - last < 33) return; // ~30fps
    last = now;
    const t = (now - t0) / 1000;
    // once the growth-in animation has settled and reduced-motion is off, it's static after ~3s:
    // still cap to 30fps; sway keeps it subtly alive
    ctx.clearRect(0, 0, W, H);
    const prog = reduced ? 1 : Math.min(t / 2.4, 1);
    for (const b of branches) {
      const bp = Math.max(0, Math.min(1, (prog - b.depth * 0.06) / 0.4));
      if (bp <= 0) continue;
      const sway = reduced ? 0 : Math.sin(t * 0.5 + b.seed * 6) * (b.depth * 0.4) * dpr;
      ctx.strokeStyle = `rgba(30,30,32,${0.5 - b.depth * 0.035})`;
      ctx.lineWidth = b.w; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(b.x1, b.y1);
      ctx.lineTo(b.x1 + (b.x2 - b.x1) * bp + sway, b.y1 + (b.y2 - b.y1) * bp); ctx.stroke();
      if (bp >= 1 && b.depth >= 6) {
        const fl = 1 + (reduced ? 0 : Math.sin(t * 1.4 + b.seed * 9) * 0.5);
        ctx.fillStyle = "rgba(30,30,32,0.4)";
        ctx.beginPath(); ctx.arc(b.x2 + sway, b.y2, b.seed * 2.2 * dpr * fl, 0, 7); ctx.fill();
      }
    }
  }
  requestAnimationFrame(frame);
}

/* ── SERVICES section: left-nav switch + ghost word + copy + stats + ink canvas ── */
const SVC = [
  { word: "Workspace", h: "Research Workspace",
    p: "Type any ticker and a full analyst workstation builds itself from live filings — overview, statements, ratio library, ownership and valuation, each cell traceable to its source.",
    stats: [["Sections built", "9"], ["Ratios computed", "20"], ["Source drawer", "Per claim"], ["Build time", "< 90s"]] },
  { word: "Valuation", h: "Valuation & DCF Engine",
    p: "A complete FCFF working — revenue and EBITDA forecasts, capex, working capital, the WACC build, discount factors, terminal value, a sensitivity grid and a football field. Every assumption is editable.",
    stats: [["Methods", "DCF · Comps · SOTP"], ["Scenarios", "Bull · Base · Bear"], ["Sensitivity", "WACC × g grid"], ["Excel export", "Formula-intact"]] },
  { word: "Forensic", h: "Forensic & Quality of Earnings",
    p: "Accruals ratios, cash conversion, promoter pledge, related-party transactions and audit-qualification flags — each flag is a claim with a citation, never a naked accusation.",
    stats: [["Checks", "12+"], ["Pledge tracking", "Live"], ["Accrual screen", "Beneish-style"], ["Flags", "Cited"]] },
  { word: "Reports", h: "Report Generation",
    p: "Initiating coverage, earnings reviews, forensic notes and memoranda — cover page, numbered exhibits, full DCF working and comps, typeset to bulge-bracket standard and print-ready.",
    stats: [["Templates", "5"], ["Avg exhibits", "40+"], ["Citations / note", "130+"], ["Formats", "PDF · Word"]] },
];
/* SVG path shapes per slide (the morphing crimson mark, in a 400×400 box) */
const SVC_SHAPES = [
  // 0 — the "X" brand blocks (two offset rectangles)
  "M70,70 L210,70 L210,210 L70,210 Z M190,190 L330,190 L330,330 L190,330 Z",
  // 1 — vertical split bars (valuation columns)
  "M80,60 L180,60 L180,340 L80,340 Z M220,110 L320,110 L320,290 L220,290 Z",
  // 2 — pie / circle segments (forensic lens)
  "M200,200 L200,40 A160,160 0 0,1 360,200 Z M200,200 L200,360 A160,160 0 0,1 40,200 Z",
  // 3 — solid document block
  "M90,60 L310,60 L310,340 L90,340 Z",
];
function initServices() {
  const section = $("#services");
  if (!section) return;
  const nav = $$("#svcNav li"), ghost = $("#ghostWord"), copy = $("#svcCopy"),
        stats = $("#svcStats"), prog = $("#svcProgress"), shapePath = $("#svcShapePath");
  if (prog) prog.innerHTML = SVC.map(() => "<i></i>").join("");
  const dots = prog ? $$("#svcProgress i") : [];
  let cur = -1;
  function show(i) {
    if (i === cur) return; cur = i;
    nav.forEach((li, j) => li.classList.toggle("active", j === i));
    dots.forEach((d, j) => d.classList.toggle("on", j === i));
    const s = SVC[i];
    ghost.style.opacity = 0;
    setTimeout(() => { ghost.textContent = s.word; ghost.style.opacity = 1; }, 150);
    if (shapePath) shapePath.setAttribute("d", SVC_SHAPES[i]);
    copy.innerHTML = "<h3>" + s.h + "</h3><p>" + s.p + "</p><a class=\"svc-link\" href=\"/terminal\">Open in the Terminal <span class=\"arr\">&rarr;</span></a>";
    stats.innerHTML = s.stats.map(function (kv) { return "<div class=\"svc-stat\"><div class=\"k\">" + kv[0] + "</div><div class=\"v\">" + kv[1] + "</div></div>"; }).join("");
    drawOrganic(i);
  }
  const isPinned = () => matchMedia("(min-width: 1025px)").matches && !reduced;
  const shapeEl = $("#svcShape");
  function onScroll() {
    if (!isPinned()) { if (cur < 0) show(0); return; }
    const rect = section.getBoundingClientRect();
    // off-screen guard: skip all work unless the pinned section is in/near viewport
    if (rect.bottom < 0 || rect.top > window.innerHeight) return;
    const total = section.offsetHeight - window.innerHeight;
    const scrolled = Math.min(Math.max(-rect.top, 0), total);
    const p = total > 0 ? scrolled / total : 0;
    const idx = Math.min(SVC.length - 1, Math.floor(p * SVC.length));
    show(idx);
    // subtle parallax drift on the shape + ghost as you move within a slide
    const within = (p * SVC.length) % 1;
    if (shapeEl) shapeEl.style.transform = "translate(-50%, " + (-50 + (within - 0.5) * 6) + "%) rotate(" + (within - 0.5) * 4 + "deg)";
  }
  nav.forEach(function (li) {
    li.addEventListener("click", function () {
      const i = +li.dataset.s;
      if (!isPinned()) { show(i); return; }
      const total = section.offsetHeight - window.innerHeight;
      const targetTop = section.offsetTop + (total * (i + 0.5) / SVC.length);
      if (lenis) lenis.scrollTo(targetTop, { duration: 1.1 });
      else window.scrollTo({ top: targetTop, behavior: "smooth" });
    });
  });
  onScrollFrame(onScroll);
  addEventListener("resize", onScroll);
  show(0); onScroll();
}

/* per-slide organic grayscale illustration (seed-head / branch / veined forms) on canvas */
let _svcCanvasInit = false, _svcCtx = null, _svcW = 0, _svcH = 0, _svcDpr = 1, _svcSeedFor = -1, _svcParts = [];
function setupOrganicCanvas() {
  const cv = $("#svcCanvas"); if (!cv) return false;
  _svcCtx = cv.getContext("2d");
  _svcDpr = Math.min(devicePixelRatio || 1, 1.25);
  function resize() { _svcW = cv.width = cv.offsetWidth * _svcDpr; _svcH = cv.height = cv.offsetHeight * _svcDpr; if (_svcSeedFor >= 0) buildOrganic(_svcSeedFor); }
  resize(); addEventListener("resize", resize);
  _svcCanvasInit = true;
  const section = document.getElementById("services");
  let visible = true;
  if (section && "IntersectionObserver" in window) {
    new IntersectionObserver((es) => es.forEach((e) => { visible = e.isIntersecting; }), { threshold: 0 }).observe(section);
  }
  let t0 = performance.now(), last = 0;
  (function loop(now) {
    requestAnimationFrame(loop);
    if (!visible || _svcSeedFor < 0 || !_svcCtx) return;
    if (now - last < 33) return; // ~30fps
    last = now;
    renderOrganic((now - t0) / 1000);
  })(t0);
  return true;
}
function buildOrganic(slide) {
  _svcSeedFor = slide;
  _svcParts = [];
  const cx = _svcW * 0.5, cy = _svcH * 0.52, dpr = _svcDpr;
  // a radial seed-head: many fine stems from center with floating tufts (dandelion/veined feel)
  const arms = 34 + slide * 6;
  for (let i = 0; i < arms; i++) {
    const ang = (i / arms) * Math.PI * 2 + (slide * 0.3);
    const len = (_svcH * 0.18) + Math.random() * (_svcH * 0.26);
    const segs = 5 + Math.floor(Math.random() * 4);
    _svcParts.push({ ang, len, segs, drift: Math.random() * 6.28, sway: 0.4 + Math.random() * 0.9, tuft: Math.random() > 0.35, seed: Math.random() });
  }
}
function renderOrganic(t) {
  const ctx = _svcCtx, cx = _svcW * 0.5, cy = _svcH * 0.52, dpr = _svcDpr;
  ctx.clearRect(0, 0, _svcW, _svcH);
  for (const p of _svcParts) {
    const sway = reduced ? 0 : Math.sin(t * 0.4 + p.drift) * p.sway * 0.04;
    const a = p.ang + sway;
    let x = cx, y = cy;
    ctx.beginPath(); ctx.moveTo(x, y);
    const stepLen = p.len / p.segs;
    let curA = a;
    for (let s = 0; s < p.segs; s++) {
      curA += (reduced ? 0 : Math.sin(t * 0.3 + p.seed * 9 + s) * 0.05) + (Math.sin(p.seed * 20 + s) * 0.08);
      x += Math.cos(curA) * stepLen; y += Math.sin(curA) * stepLen;
      ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "rgba(40,40,42,0.32)";
    ctx.lineWidth = 0.7 * dpr; ctx.lineCap = "round"; ctx.stroke();
    // tuft / seed at the tip
    if (p.tuft) {
      const fl = 1 + (reduced ? 0 : Math.sin(t * 1.2 + p.seed * 9) * 0.4);
      ctx.fillStyle = "rgba(40,40,42,0.4)";
      ctx.beginPath(); ctx.arc(x, y, (0.8 + p.seed * 1.8) * dpr * fl, 0, 7); ctx.fill();
      // fine filaments radiating from the seed
      for (let f = 0; f < 4; f++) {
        const fa = curA + (f - 1.5) * 0.4;
        ctx.beginPath(); ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(fa) * 8 * dpr, y + Math.sin(fa) * 8 * dpr);
        ctx.strokeStyle = "rgba(40,40,42,0.18)"; ctx.lineWidth = 0.5 * dpr; ctx.stroke();
      }
    }
  }
}
function drawOrganic(slide) {
  if (!_svcCanvasInit) { if (!setupOrganicCanvas()) return; }
  buildOrganic(slide);
}

/* ── FEEDBACK: opens a pre-drafted email in Gmail or Outlook web compose ── */
function initFeedback() {
  const rating = $("#fbRating");
  if (!rating) return;
  let stars = 0;
  rating.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    stars = +b.dataset.r;
    rating.querySelectorAll("button").forEach((x) => x.classList.toggle("sel", +x.dataset.r === stars));
  }));
  const CREATOR = "nikhilpratap112006@gmail.com";
  function buildMail() {
    const name = ($("#fbName").value || "").trim();
    const email = ($("#fbEmail").value || "").trim();
    const phone = ($("#fbPhone").value || "").trim();
    const msg = ($("#fbMsg").value || "").trim();
    if (!name || !email || !msg) { $("#fbNote").textContent = "Please fill in name, email and a message first."; return null; }
    const subject = `Meridian feedback from ${name}${stars ? " (" + stars + "\u2605)" : ""}`;
    const body =
      `Name: ${name}\n` +
      `Email: ${email}\n` +
      (phone ? `Contact: ${phone}\n` : "") +
      (stars ? `Rating: ${stars}/5\n` : "") +
      `\nFeedback:\n${msg}\n\n— Sent from the Meridian website`;
    return { subject, body };
  }
  $("#fbGmail").addEventListener("click", () => {
    const m = buildMail(); if (!m) return;
    const url = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(CREATOR)}&su=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`;
    window.open(url, "_blank", "noopener");
    $("#fbNote").textContent = "Gmail compose opened in a new tab — just press Send.";
  });
  $("#fbOutlook").addEventListener("click", () => {
    const m = buildMail(); if (!m) return;
    const url = `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(CREATOR)}&subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`;
    window.open(url, "_blank", "noopener");
    $("#fbNote").textContent = "Outlook compose opened in a new tab — just press Send.";
  });
}

/* ── Support (Razorpay Checkout API flow) ──
   Backend endpoints:
     POST /api/support/order    → creates order, returns key_id + order_id
     POST /api/support/verify   → verifies checkout signature, records payment
     GET  /api/support/goal     → community goal state (raised, target, pct, count)
   Falls back to a "launching soon" note if the server reports payments
   aren't configured (i.e. env vars missing on Render).
*/
function initSupport() {
  const fixed = document.getElementById("supFixed");
  const custom = document.getElementById("supCustom");
  const note = document.getElementById("supNote");
  if (!fixed && !custom) return;

  const setNote = (msg, isError) => {
    if (!note) return;
    note.textContent = msg || "";
    note.style.color = isError ? "var(--accent)" : "var(--ink-soft)";
  };
  const busy = (btn, on) => {
    if (!btn) return;
    btn.disabled = !!on;
    btn.style.opacity = on ? "0.65" : "";
    btn.style.pointerEvents = on ? "none" : "";
  };

  async function go(amount_inr, sourceBtn) {
    if (!(amount_inr > 0)) return;
    if (typeof window.Razorpay !== "function") {
      setNote("Payment system is still loading. Please try again in a moment.", true);
      return;
    }
    busy(sourceBtn, true);
    setNote("Opening secure checkout…");

    let order;
    try {
      const r = await fetch("/api/support/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount_inr }),
      });
      const data = await r.json();
      if (!r.ok || !data.order_id) {
        if (r.status === 503 || data.enabled === false) {
          setNote("Payments are launching shortly — thank you for wanting to support Meridian!", true);
        } else {
          setNote(data.error || "Could not start checkout. Please try again.", true);
        }
        busy(sourceBtn, false);
        return;
      }
      order = data;
    } catch (e) {
      setNote("Network error. Please check your connection and try again.", true);
      busy(sourceBtn, false);
      return;
    }

    const rzp = new window.Razorpay({
      key: order.key_id,
      order_id: order.order_id,
      amount: order.amount,
      currency: order.currency,
      name: "Meridian",
      description: "Support Meridian development",
      image: "/logo.png",
      theme: { color: "#c2181b" },
      prefill: {},
      notes: { source: "meridian_landing" },
      modal: {
        ondismiss: () => {
          busy(sourceBtn, false);
          setNote("Checkout closed. No amount was charged.");
        },
      },
      handler: async (response) => {
        setNote("Verifying payment…");
        try {
          const v = await fetch("/api/support/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              amount_inr,
            }),
          });
          const vd = await v.json();
          if (vd.verified) {
            setNote(`Thank you! Your ₹${amount_inr} contribution helps keep Meridian independent.`);
            // Refresh the community goal widget so the user sees their impact.
            if (window.__refreshGoal) window.__refreshGoal(true);
          } else {
            setNote("Payment could not be verified. If you were charged, please email the creator.", true);
          }
        } catch {
          setNote("Payment succeeded but confirmation failed to reach the server. If you were charged, please email the creator.", true);
        } finally {
          busy(sourceBtn, false);
        }
      },
    });
    rzp.on("payment.failed", (resp) => {
      const desc = resp && resp.error && resp.error.description;
      setNote(desc ? `Payment failed: ${desc}` : "Payment failed. Please try again.", true);
      busy(sourceBtn, false);
    });
    rzp.open();
  }

  if (fixed) fixed.addEventListener("click", () => go(99, fixed));
  if (custom) custom.addEventListener("click", () => {
    const v = parseFloat((document.getElementById("supAmount") || {}).value);
    if (!v || v < 1) { setNote("Please enter a valid amount first.", true); return; }
    if (v > 100000) { setNote("Amount looks unusually high. Please double-check.", true); return; }
    go(v, custom);
  });
}

/* ── Community Goal tracker ──
   Polls /api/support/goal on load and every 45 seconds. When a payment
   verifies in this tab we also call window.__refreshGoal(true) for an
   immediate refresh + a subtle pulse animation on the raised amount. */
function initGoalTracker() {
  const wrap = document.getElementById("sideGoal");
  if (!wrap) return;
  const raisedEl = document.getElementById("sgRaised");
  const targetEl = document.getElementById("sgTarget");
  const fillEl   = document.getElementById("sgFill");
  const pctEl    = document.getElementById("sgPct");
  const countEl  = document.getElementById("sgCount");
  const trackEl  = wrap.querySelector(".side-goal-track");

  const fmt = (n) => Math.round(n).toLocaleString("en-IN");

  async function pull(pulse) {
    try {
      const r = await fetch("/api/support/goal", { cache: "no-store" });
      if (!r.ok) return;
      const d = await r.json();
      if (raisedEl) raisedEl.textContent = fmt(d.raised_inr || 0);
      if (targetEl) targetEl.textContent = fmt(d.target_inr || 10000);
      if (countEl)  countEl.textContent  = String(d.count || 0);
      const pct = Math.max(0, Math.min(100, d.pct || 0));
      if (fillEl)  fillEl.style.width = pct.toFixed(1) + "%";
      if (pctEl)   pctEl.textContent  = Math.round(pct) + "%";
      if (trackEl) trackEl.setAttribute("aria-valuenow", Math.round(pct));
      if (pulse) {
        wrap.classList.remove("pulse");
        // reflow to restart the animation
        void wrap.offsetWidth;
        wrap.classList.add("pulse");
      }
    } catch { /* offline / server down — leave last known values */ }
  }
  window.__refreshGoal = pull;
  pull(false);
  setInterval(() => pull(false), 45000);
}

/* ── Wave-terrain background: fade in on feedback, stay through CTA, fade at showcase ── */
function initWaveTerrain() {
  const bg = document.getElementById("waveTerrain");
  const feedback = document.getElementById("feedback");
  const finalSec = document.getElementById("final");
  if (!bg || !feedback) return;
  const vh = () => window.innerHeight || document.documentElement.clientHeight;
  function check() {
    const fb = feedback.getBoundingClientRect();
    const fn = finalSec ? finalSec.getBoundingClientRect() : null;
    // "on" whenever any part of feedback or final is within a soft viewport window
    const softTop = vh() * 0.85;
    const inFB = fb.top < softTop && fb.bottom > 0;
    const inFN = fn && fn.top < softTop && fn.bottom > 0;
    bg.classList.toggle("on", !!(inFB || inFN));
  }
  let raf = 0;
  function onScroll() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; check(); });
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", check);
  check();
}

/* ── PROCESS — dashed connector that draws itself with scroll ──
   The path is generated from the real layout positions of the step
   numerals, then revealed through an SVG mask whose stroke-dashoffset
   tracks scroll progress (one cheap style write per scroll frame). */
function initProcess() {
  const flow = document.getElementById("processFlow");
  const svg = document.getElementById("processLine");
  if (!flow || !svg) return;
  const steps = $$(".pr-step", flow);
  if (steps.length < 2) return;
  let maskPath = null, cursor = null, pathLen = 0, lastP = reduced ? 1 : 0;

  function placeCursor(p) {
    if (!cursor || !maskPath) return;
    if (reduced || p < 0.015) { cursor.style.opacity = "0"; return; }
    const L = pathLen * p;
    const a = maskPath.getPointAtLength(Math.max(0, L - 2));
    const b = maskPath.getPointAtLength(Math.min(pathLen, L + 2));
    const ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
    const pt = maskPath.getPointAtLength(L);
    cursor.setAttribute("transform", "translate(" + pt.x.toFixed(1) + " " + pt.y.toFixed(1) + ") rotate(" + ang.toFixed(1) + ")");
    cursor.style.opacity = "1";
  }

  function build() {
    if (matchMedia("(max-width: 900px)").matches) { svg.innerHTML = ""; maskPath = null; cursor = null; return; }
    const fr = flow.getBoundingClientRect();
    const W = Math.max(1, Math.round(flow.offsetWidth));
    const H = Math.max(1, Math.round(flow.offsetHeight));
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    const pts = steps.map((s) => {
      const n = s.querySelector(".pr-num").getBoundingClientRect();
      return { x: n.left - fr.left + n.width * 0.52, y: n.top - fr.top + n.height * 0.5 };
    });
    let d = "M " + pts[0].x.toFixed(1) + " " + pts[0].y.toFixed(1);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const my = ((a.y + b.y) / 2).toFixed(1);
      d += " C " + a.x.toFixed(1) + " " + my + ", " + b.x.toFixed(1) + " " + my + ", " + b.x.toFixed(1) + " " + b.y.toFixed(1);
    }
    svg.innerHTML =
      '<defs><mask id="prLineMask"><path d="' + d + '" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/></mask></defs>' +
      '<path d="' + d + '" fill="none" stroke="currentColor" stroke-opacity=".55" stroke-width="1.6" stroke-dasharray="1 9" stroke-linecap="round" mask="url(#prLineMask)"/>' +
      '<g class="pr-cursor" style="opacity:0; transition: opacity .3s ease;"><path d="M0,-5.5 L13,0 L0,5.5 L3.4,0 Z" fill="currentColor"/></g>';
    maskPath = svg.querySelector("mask path");
    cursor = svg.querySelector(".pr-cursor");
    pathLen = maskPath.getTotalLength();
    maskPath.style.strokeDasharray = pathLen + " " + pathLen;
    maskPath.style.strokeDashoffset = String(pathLen * (1 - lastP));
    placeCursor(lastP);
  }

  function onScroll() {
    if (!maskPath) return;
    const r = flow.getBoundingClientRect();
    if (r.bottom < -100 || r.top > innerHeight + 100) return;   // off-screen guard
    let p = reduced ? 1 : (innerHeight * 0.78 - r.top) / (r.height || 1);
    p = Math.max(0, Math.min(1, p));
    if (Math.abs(p - lastP) < 0.003) return;
    lastP = p;
    maskPath.style.strokeDashoffset = String(pathLen * (1 - p));
    placeCursor(p);
  }

  build();
  onScroll();
  addEventListener("resize", () => { build(); onScroll(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { build(); onScroll(); });
  onScrollFrame(onScroll);
}

/* ── animated counters ── */
function initCounters() {
  function run(el) {
    const to = +el.dataset.to, suf = el.dataset.suf || "", t0 = performance.now();
    function tick(now) {
      const p = Math.min((now - t0) / 1400, 1);
      const v = Math.round(to * (1 - Math.pow(1 - p, 3)));
      el.textContent = v.toLocaleString("en-IN") + (p === 1 ? suf : "");
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
  const io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { io.unobserve(e.target); run(e.target); }
    });
  }, { threshold: 0.5 });
  $$(".metric-n, .stat-num").forEach((el) => io.observe(el));
}

/* ── boot ── */
let lenis = null;
function initSmoothScroll() {
  if (reduced || typeof Lenis === "undefined") return;
  try {
    lenis = new Lenis({
      duration: 1.05,            // glide length
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), // expo-out
      smoothWheel: true,
      wheelMultiplier: 1,
      touchMultiplier: 1.4,
    });
    function raf(time) { lenis.raf(time); requestAnimationFrame(raf); }
    requestAnimationFrame(raf);
  } catch (e) { lenis = null; }
}

function boot() {
  initSmoothScroll();
  // smooth anchor links via Lenis
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener("click", (e) => {
      const id = a.getAttribute("href");
      if (id.length < 2) return;
      const el = document.querySelector(id);
      if (!el) return;
      e.preventDefault();
      if (lenis) lenis.scrollTo(el, { offset: -10 });
      else el.scrollIntoView({ behavior: "smooth" });
    });
  });
  startTerrain();
  initServices(); initProductExperience(); initShowcase(); initFeedback();
  initSupport();
  initGoalTracker();
  initWaveTerrain();
  initMotionEnhancements();
  initProcess();
  loadTicker(); setInterval(loadTicker, 60000);
  initIntro();   // plays the greeting curtain, then releases all reveals
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();

/* ── Motion enhancements: scroll-progress bar ──
   (grid stagger now lives in applyStagger, gated behind the intro) */
function initMotionEnhancements() {
  if (reduced) return;
  const bar = document.createElement("div");
  bar.className = "scroll-prog";
  document.body.appendChild(bar);
  onScrollFrame(() => {
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = "scaleX(" + (max > 0 ? Math.min(1, _scrollY / max) : 0) + ")";
  });
}

/* ════ REAL PRODUCT EXPERIENCE — immersive terminal walkthrough ════
   Manual carousel over 18 real screenshots. Lazy-loads current ±1 only,
   adapts layout to each screenshot's shape, keyboard + swipe + dots,
   IntersectionObserver-driven enter/leave immersion, reduced-motion aware. */
function initProductExperience() {
  const root = document.getElementById("experience");
  const area = document.getElementById("pxSlideArea");
  if (!root || !area) return;

  const P = "/product/";
  const S = [
    { f: "01-portfolio-overview.webp", w: 1600, h: 1190, lay: "square",
      t: "Portfolio Overview", s: "A twenty-company technical command center — every holding scanned, scored and signalled in one screen.",
      feats: ["15-indicator screener: SMA cross, BB%, ATR, VWAP, MFI, CCI, Stochastics, S/R and 52-week positioning", "Composite 0–100 technical score with Accumulate / Watch / Hold signal badges", "Score distribution, sector allocation and signal donuts refresh with every scan", "Typed alert cards — breakouts, golden crosses, RSI extremes, volume spikes — each with a sparkline"],
      why: "One screen answers the analyst's first question every morning: <b>what does my book look like right now?</b>" },
    { f: "02-candlestick-workspace.webp", w: 1600, h: 1000, lay: "wide",
      t: "Interactive Candlestick Workspace", s: "A full charting engine scoped to your own portfolio — built from scratch on canvas, no third-party chart library.",
      feats: ["Wheel-zoom anchored at the cursor, drag-to-pan, crosshair with live OHLC / volume / change readout", "Volume pane plus a selectable momentum panel — RSI, MACD, ADX, ATR, OBV, MFI, ROC or CCI", "Overlay toggles: EMAs, VWAP, Bollinger, Supertrend, Ichimoku, S/R levels, auto trendlines", "Nine timeframes from intraday 1D to MAX, per-company navigator with live prices"],
      why: "TradingView-class interaction, <b>scoped to the names you actually hold</b> — no tab-switching to a separate charting product." },
    { f: "03-pattern-intelligence.webp", w: 1600, h: 998, lay: "wide",
      t: "Pattern Intelligence", s: "Nineteen classical candlestick patterns detected in context — the same shape reads differently after a decline than after an advance.",
      feats: ["Context-aware detection: a hammer requires a decline into it; the identical candle after an advance is a hanging man", "Refractory suppression — a sustained run reads as one event, not thirty repeated flags", "Recent-pattern stack with strength labels and a chronological timeline strip", "Click any marker or timeline chip to focus the chart and update the insight panel instantly"],
      why: "Patterns are treated as <b>alerts, not orders</b> — every detection is judged against trend, structure and volume before it earns a score." },
    { f: "04-pattern-detail.webp", w: 1035, h: 1799, lay: "tall",
      t: "Pattern Detail Engine", s: "A ten-section institutional briefing generated for every detected pattern — anatomy to risk management.",
      feats: ["Candle-by-candle anatomy quoting the actual OHLC of the signal bar", "Market-psychology narrative explaining who is trapped and why it matters", "Live confluence checklist — trend, structure, EMA alignment, momentum, volume, confirmation — each ✓ or ✗", "Trading strategy with entry, stop and target expressed in R-multiples; invalidation defined before entry"],
      why: "The engine teaches the <b>why</b> behind every signal — analysis you can defend in an interview, not a black-box arrow." },
    { f: "05-market-dashboard.webp", w: 1600, h: 1150, lay: "square",
      t: "Market Dashboard", s: "The day's context before any single-name work — indices, rates, currencies, commodities and breadth in one view.",
      feats: ["Interactive price chart for any instrument — index, stock, currency, commodity or crypto, 1D to 5Y", "Global tape: NIFTY, SENSEX, S&P 500, NASDAQ, FTSE, Nikkei, gold, crude, USD/INR, US yields, BTC/ETH", "NIFTY-universe breadth: advancers vs decliners, A/D ratio, names near 52-week highs and lows", "NSE sector heatmap coloured by day change"],
      why: "Top-down discipline made effortless — <b>read the market before you read the stock</b>." },
    { f: "06-sector-heatmap.webp", w: 1600, h: 852, lay: "wide",
      t: "Sector Heatmap", s: "Eleven GICS sectors and forty-nine industries across ₹259 lakh crore of market cap, mapped by size and day return.",
      feats: ["Cap-weighted squarified treemap — tile size is market cap, colour is the day's move", "Sector table with market weights and YTD returns, sorted for rotation reads", "Hover tooltips with cap, weight, day and YTD detail per sector", "Click any sector to drill into its industries and constituents"],
      why: "Sector rotation is visible <b>in one glance</b> — where money is flowing today, and what it has done all year." },
    { f: "07-sector-industry.webp", w: 1600, h: 1448, lay: "square",
      t: "Sector & Industry Analysis", s: "Every sector benchmarked against NIFTY 50, S&P 500, NASDAQ or Russell — then decomposed into its industries.",
      feats: ["Dual-line performance chart, rebased to zero, with crosshair, zoom-pan and PNG export", "Day / YTD / 1-year / 3-year / 5-year return grid, sector vs benchmark side by side", "Industry weight table with per-industry YTD and an industry-level treemap", "Constituent drill-down filters the company table beneath"],
      why: "Leadership <b>within</b> the sector, quantified — the difference between owning a sector and owning its winner." },
    { f: "08-news-sentiment.webp", w: 1600, h: 879, lay: "wide",
      t: "News & Market Sentiment", s: "Headline flow quantified — a lexicon-scored sentiment gauge over live news, scoped to company, industry or the broad market.",
      feats: ["0–100 sentiment score with trend read — improving, flat or deteriorating", "Positive / neutral / negative distribution bar over the last thirty headlines", "Scope switch: single company, its industry, or the whole market", "Every headline tagged, sourced and time-stamped with recency"],
      why: "A <b>directional read on narrative</b> — honest about being a lexicon score, not a trading signal." },
    { f: "09-company-overview.webp", w: 1600, h: 753, lay: "wide",
      t: "Company Overview", s: "The thirty-second brief: identity, size, ownership, street view and an intraday chart on one card.",
      feats: ["Market cap, enterprise value, 52-week range, beta, promoter and institutional holdings", "Street target and consensus view pulled live", "Full business description with segment detail and key management", "Intraday price chart with timeframe switch"],
      why: "Everything a PM asks in the first thirty seconds of a pitch, <b>answered before they ask</b>." },
    { f: "10-business-analysis.webp", w: 1600, h: 1110, lay: "square",
      t: "Business Analysis", s: "The model behind the price — revenue bridge, margin structure and a scored read on business quality.",
      feats: ["Revenue bridge: prior year → organic/price/mix delta → current year, with implied growth", "Margin structure: gross, operating and net, latest reported", "Business quality score 0–100 across growth, margin, capital returns and cash conversion", "Long-term CAGR snapshot — revenue, EBITDA, EPS, ROE, ROCE, FCF — each with a trend sparkline"],
      why: "Separates <b>the business from the stock</b> — quality measured before valuation is discussed." },
    { f: "11-ratio-analysis.webp", w: 1600, h: 863, lay: "wide",
      t: "Ratio Analysis", s: "Twenty-four ratios across six lenses — each with a plain-English interpretation, not just a number.",
      feats: ["Profitability, liquidity, leverage, efficiency, valuation and market lenses in one grid", "Trend sparklines on the ratios where history matters — ROE, ROCE, margins", "Every ratio annotated: what it measures and how to read it", "Capital allocation table — capex, dividends, debt reduction over four years — with a written verdict"],
      why: "Numbers with <b>meaning attached</b> — the difference between a data dump and analysis." },
    { f: "12-forensic-scorecard.webp", w: 1600, h: 385, lay: "wide",
      t: "Forensic Scorecard", s: "Manipulation and distress screens before you trust the P&L — Piotroski, Altman and Beneish with reasoned red flags.",
      feats: ["Composite earnings-quality grade A–D from cash conversion, accruals and model scores", "Piotroski F-Score with all nine tests, calculations and benchmarks behind it", "Altman Z with zone classification and full component backup", "Red flags state the metric, the threshold breached and why it matters — not just a warning icon"],
      why: "A CA's instinct, systematised: <b>verify the accounting before valuing the business</b>." },
    { f: "13-risk-assessment.webp", w: 1600, h: 767, lay: "wide",
      t: "Risk Assessment", s: "Risk enumerated, weighted and mapped — eight categories rolled into one score, every risk placed on a probability × impact matrix.",
      feats: ["Composite 0–100 risk score with severity band", "Eight category scores: valuation, industry, financial, governance, regulatory, ESG, business, market", "Each category names its top risk and counts the rest", "Probability × impact matrix places every lettered risk by likelihood and severity"],
      why: "Replaces \u201cwhat could go wrong?\u201d hand-waving with a <b>structured, defensible risk register</b>." },
    { f: "14-valuation-framework.webp", w: 1600, h: 1054, lay: "square",
      t: "Valuation Framework", s: "Seven methods, one football field — the spread between them is itself information about valuation uncertainty.",
      feats: ["Football field across EV/EBITDA, P/E, PEG, residual income, dividend discount, sum-of-the-parts and DCF", "Blended target weighting DCF 40% and relative methods 60%, per institutional convention", "Method workings shown in full — every multiple, every input, every intermediate figure", "5,000-run Monte Carlo over growth, margin, WACC and terminal assumptions with percentile bands and P(value &gt; price)"],
      why: "A valuation <b>range with reasoning</b>, not a single number pretending to be precise." },
    { f: "15-dcf-model.webp", w: 1600, h: 915, lay: "wide",
      t: "Institutional DCF Model", s: "A ten-year driver-based FCFF model with editable assumptions, quality diagnostics and a reconciling Excel export.",
      feats: ["Every driver anchored to four years of reported actuals — growth, margin, capex, working capital, tax", "Next-three-years assumptions editable with AI-recommended values and confidence tags", "Model-quality score with diagnostics — flags a WACC below market norms and suggests the fix", "One-click Excel export that ties out to the app at 0.00 difference"],
      why: "An <b>audit-ready model</b>, not a black box — every number traceable to a driver, every driver to history." },
    { f: "16-research-report.webp", w: 1315, h: 1623, lay: "tall",
      t: "Research Report Generator", s: "From analysis to a publishable initiating-coverage note in one click — rating, target and evidence-backed highlights.",
      feats: ["Rating band with 12-month target synced live from the Modeling Lab valuation", "Snapshot table: ticker, sector, price, target, upside, market cap, 52-week range, beta", "Highlights cite the evidence — moat points, growth trajectory, forensic grades, balance-sheet strength", "Print / PDF, Word download, and save-to-library in one bar"],
      why: "The final mile of the workflow: <b>research that ships</b>, formatted like a sell-side note." },
    { f: "17-learning-center.webp", w: 1600, h: 1216, lay: "square",
      t: "Learning Center", s: "The terminal teaches the concepts it uses — plain-language finance from first principles to professional practice.",
      feats: ["Structured tracks: foundations, valuation, analysis, startup & ESOP, professional finance", "Numbered walkthroughs with worked ₹ examples — DCF explained through a chai-shop purchase", "Visual explanations: discounting shown as future rupees shrinking to present value", "40+ term financial dictionary for quick reference"],
      why: "Understanding compounds like capital — the platform <b>explains itself</b> instead of assuming prior knowledge." },
    { f: "18-calculators.webp", w: 1600, h: 1287, lay: "square",
      t: "Professional Calculators", s: "Practitioner-grade tools with the mathematics visible — an investment suite and a full ESOP suite.",
      feats: ["Investment suite: SIP, SWP, lumpsum, retirement, inflation and multi-stage wealth projection", "ESOP suite: valuation, vesting schedule, India tax on exercise and sale, exit proceeds, dilution, waterfall", "Live FMV fetch for listed tickers; scenario table stress-tests the outcome across FMV moves", "Formula and payoff chart shown for every calculation — nothing hidden"],
      why: "Tools that show their working — <b>trust through transparency</b>, exactly like the rest of the terminal." },
  ];

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let cur = 0, inView = false;

  /* build DOM */
  const slides = S.map((d, i) => {
    const el = document.createElement("article");
    el.className = `px-slide px-slide--${d.lay}`;
    el.setAttribute("role", "group");
    el.setAttribute("aria-roledescription", "slide");
    el.setAttribute("aria-label", `${i + 1} of ${S.length}: ${d.t}`);
    el.innerHTML = `
      <div class="px-frame"><img class="px-shot" data-src="${P}${d.f}" width="${d.w}" height="${d.h}" alt="${d.t} — Meridian Terminal screenshot" decoding="async"></div>
      <div class="px-copy">
        <div class="px-num mono">${String(i + 1).padStart(2, "0")}</div>
        <div class="px-copy-body">
          <h3 class="px-fname">${d.t}</h3>
          <p class="px-fsub">${d.s}</p>
          <ul class="px-feats">${d.feats.map((x) => `<li>${x}</li>`).join("")}</ul>
          <div class="px-why"><b>Why it matters.</b> ${d.why}</div>
        </div>
      </div>`;
    area.appendChild(el);
    return el;
  });

  const ensure = (i) => {
    for (const j of [i - 1, i, i + 1]) {
      if (j < 0 || j >= slides.length) continue;
      const img = slides[j].querySelector("img[data-src]");
      if (img) { img.src = img.dataset.src; img.removeAttribute("data-src"); }
    }
  };

  /* controls */
  const prevB = document.getElementById("pxPrev"), nextB = document.getElementById("pxNext");
  const curEl = document.getElementById("pxCur"), totEl = document.getElementById("pxTotal");
  const dotsEl = document.getElementById("pxDots");
  totEl.textContent = String(S.length).padStart(2, "0");
  const dots = S.map((d, i) => {
    const b = document.createElement("button");
    b.className = "px-dot"; b.setAttribute("role", "tab");
    b.setAttribute("aria-label", `Slide ${i + 1}: ${d.t}`);
    b.addEventListener("click", () => go(i));
    dotsEl.appendChild(b); return b;
  });

  function go(i, from) {
    i = Math.max(0, Math.min(slides.length - 1, i));
    if (i === cur && from !== "init") return;
    const dir = i >= cur ? 1 : -1;
    slides.forEach((el, j) => {
      el.classList.remove("on");
      /* resting side: slides before the active one sit to the left,
         slides after it to the right — so travel direction reads naturally */
      el.classList.toggle("off-l", j < i);
    });
    const incoming = slides[i];
    if (from !== "init" && !reduced) {
      /* place the incoming slide on the side it travels in from, then reflow */
      incoming.classList.toggle("off-l", dir === -1);
      void incoming.offsetWidth;
    }
    incoming.classList.remove("off-l");
    incoming.classList.add("on");
    cur = i;
    ensure(i);
    curEl.textContent = String(i + 1).padStart(2, "0");
    curEl.classList.remove("tick"); void curEl.offsetWidth; curEl.classList.add("tick");
    dots.forEach((d, j) => d.classList.toggle("on", j === i));
    prevB.disabled = i === 0;
    nextB.disabled = i === slides.length - 1;
  }
  prevB.addEventListener("click", () => go(cur - 1));
  nextB.addEventListener("click", () => go(cur + 1));

  /* keyboard — active while the chapter is on screen or the carousel is focused */
  document.addEventListener("keydown", (e) => {
    if (!inView && document.activeElement !== document.getElementById("pxCarousel")) return;
    if (e.key === "ArrowRight") { e.preventDefault(); go(cur + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); go(cur - 1); }
  });

  /* swipe — axis-locked drag (Android fix).
     The first significant finger movement decides the gesture's axis once:
     · horizontal → we preventDefault() every subsequent move so the page
       cannot scroll vertically, and the active slide follows the finger
       (transform-only, GPU-composited);
     · vertical → we never interfere and the page scrolls natively.
     CSS `touch-action: pan-y` on the slide area keeps the browser from
     claiming horizontal strokes before we do. */
  let tx = 0, ty = 0, axis = null, dragX = 0, lastX = 0, lastT = 0, velX = 0;
  const dragEl = () => slides[cur];
  area.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) { axis = "y"; return; }
    tx = lastX = e.touches[0].clientX; ty = e.touches[0].clientY;
    lastT = performance.now(); axis = null; dragX = 0; velX = 0;
  }, { passive: true });
  area.addEventListener("touchmove", (e) => {
    if (axis === "y") return;
    const t = e.touches[0];
    const dx = t.clientX - tx, dy = t.clientY - ty;
    if (!axis) {
      if (Math.abs(dx) < 7 && Math.abs(dy) < 7) return;      // not decided yet
      axis = Math.abs(dx) > Math.abs(dy) * 1.15 ? "x" : "y";
      if (axis === "y") return;                              // vertical → native scroll
      dragEl().classList.add("dragging");
    }
    if (e.cancelable) e.preventDefault();                    // lock page scroll
    const now = performance.now();
    if (now - lastT > 16) { velX = (t.clientX - lastX) / (now - lastT); lastX = t.clientX; lastT = now; }
    const atEdge = (dx > 0 && cur === 0) || (dx < 0 && cur === slides.length - 1);
    dragX = dx * (atEdge ? 0.28 : 0.9);
    dragEl().style.transform = "translateX(" + dragX.toFixed(1) + "px)";
  }, { passive: false });
  const endDrag = () => {
    if (axis !== "x") { axis = null; return; }
    const el = dragEl();
    el.classList.remove("dragging");
    const w = area.offsetWidth || 1;
    const dir = dragX < 0 ? 1 : -1;
    const target = cur + dir;
    const fling = Math.abs(velX) > 0.45 && Math.sign(velX) === Math.sign(dragX);
    const far = Math.abs(dragX) > w * 0.18;
    el.classList.add("settling");
    void el.offsetWidth;                       // commit .settling before moving
    el.style.transform = "";
    if ((far || fling) && target >= 0 && target < slides.length) go(target);
    setTimeout(() => el.classList.remove("settling"), 500);
    axis = null; dragX = 0;
  };
  area.addEventListener("touchend", endDrag, { passive: true });
  area.addEventListener("touchcancel", endDrag, { passive: true });

  /* immersion: enter/leave + nav re-skin over the dark chapter */
  const nav = document.getElementById("nav");
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((es) => es.forEach((en) => {
      if (en.isIntersecting) { root.classList.add("in"); ensure(cur); }
      else root.classList.remove("in");
    }), { threshold: 0.14 }).observe(root);
  } else { root.classList.add("in"); ensure(cur); }

  const navSync = () => {
    const r = root.getBoundingClientRect();
    const navH = nav ? nav.offsetHeight : 64;
    inView = r.top < innerHeight * 0.7 && r.bottom > innerHeight * 0.3;
    if (nav) nav.classList.toggle("over-dark", r.top <= navH && r.bottom >= navH);
  };
  let rafPending = false;
  addEventListener("scroll", () => {
    if (rafPending) return; rafPending = true;
    requestAnimationFrame(() => { navSync(); rafPending = false; });
  }, { passive: true });
  navSync();

  go(0, "init");
}
