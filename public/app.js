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

/* ── reveal-up elements ── */
function setupReveal() {
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("vis"); io.unobserve(e.target); } }), { threshold: 0.12 });
  $$(".reveal-up").forEach((el) => io.observe(el));
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
  setupWordReveal(); setupReveal(); startTerrain();
  initServices(); initPipeline(); initShowcase(); initCounters(); initFeedback();
  loadTicker(); setInterval(loadTicker, 60000);
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
