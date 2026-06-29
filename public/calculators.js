/* ════════════════════════════════════════════════════════════════════
   MERIDIAN · CALCULATORS — Investment Suite + ESOP Suite
   Every calculator follows the spec: Input panel, Assumption panel,
   Formula display, Interactive chart, Scenario analysis, Explanation.
   For ESOP, listed-company data auto-fills via /api/company/:symbol.
   ════════════════════════════════════════════════════════════════════ */

const CALCS = {
  investment: {
    label: "Investment Suite",
    items: [
      { id: "sip",       label: "SIP Calculator",        desc: "Monthly investment → corpus" },
      { id: "swp",       label: "SWP Calculator",        desc: "Withdraw a fixed amount monthly" },
      { id: "lumpsum",   label: "Lumpsum Calculator",    desc: "One-time investment growth" },
      { id: "retirement",label: "Retirement Calculator", desc: "How much do I need to retire?" },
      { id: "inflation", label: "Inflation Calculator",  desc: "Real purchasing power over time" },
      { id: "wealth",    label: "Wealth Projection",     desc: "Multi-stage life-stage plan" },
    ],
  },
  esop: {
    label: "ESOP Suite",
    items: [
      { id: "esopval",     label: "ESOP Valuation",      desc: "What are my stock options worth?" },
      { id: "vesting",     label: "Vesting Schedule",    desc: "When do my options vest?" },
      { id: "esoptax",     label: "ESOP Tax",            desc: "Tax on exercise + sale (India)" },
      { id: "esopexit",    label: "Exit Proceeds",       desc: "What I get if the company exits" },
      { id: "esopdilution",label: "Dilution",            desc: "How new funding affects my stake" },
      { id: "esopwaterfall",label: "Waterfall Analysis", desc: "Preference-stack payouts on exit" },
    ],
  },
};

// helpers
const NF = (v, dp = 2) => v == null || !isFinite(v) ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const RP = (v) => "₹" + (v == null || !isFinite(v) ? "—" : Math.round(v).toLocaleString("en-IN"));
const RPshort = (v) => { if (v == null || !isFinite(v)) return "—"; if (Math.abs(v) >= 1e7) return "₹" + (v / 1e7).toFixed(2) + " Cr"; if (Math.abs(v) >= 1e5) return "₹" + (v / 1e5).toFixed(2) + " L"; if (Math.abs(v) >= 1000) return "₹" + (v / 1000).toFixed(1) + "K"; return "₹" + Math.round(v); };

/* ════════ TABS.calc — main controller ════════ */
TABS.calc = {
  current: null,
  init() {
    // build the side nav
    const nav = $("#calcNav");
    nav.innerHTML = Object.entries(CALCS).map(([gk, g]) => `
      <div class="calc-grp"><div class="calc-gl">${g.label}</div>
        ${g.items.map((c) => `<button class="calc-link" data-id="${c.id}"><b>${c.label}</b><span>${c.desc}</span></button>`).join("")}
      </div>`).join("");
    $$("#calcNav .calc-link").forEach((b) => b.addEventListener("click", () => this.open(b.dataset.id)));
    // open SIP by default
    this.open("sip");
  },
  open(id) {
    this.current = id;
    $$("#calcNav .calc-link").forEach((b) => b.classList.toggle("active", b.dataset.id === id));
    const c = CALC_ENGINES[id];
    if (!c) { $("#calcOut").innerHTML = `<div class="empty-mini">Calculator not built yet.</div>`; return; }
    $("#calcTitle").textContent = c.title;
    $("#calcSub").textContent = c.sub || "";
    $("#calcOut").innerHTML = c.render();
    if (c.bind) c.bind();
  },
};

/* ════════ shared rendering helpers ════════ */
function calcShell({ inputs, assumptions, formula, output, chartId, scenarioId, explanation }) {
  return `<div class="cal">
    <div class="cal-grid">
      <div class="cal-card"><div class="cal-h">INPUTS</div>${inputs}</div>
      ${assumptions ? `<div class="cal-card"><div class="cal-h">ASSUMPTIONS</div>${assumptions}</div>` : ""}
      <div class="cal-card cal-output"><div class="cal-h">RESULT</div><div id="calcResult">${output || "—"}</div></div>
    </div>
    ${formula ? `<div class="cal-formula"><div class="cal-h">FORMULA</div>${formula}</div>` : ""}
    ${chartId ? `<div class="cal-chart-wrap"><div class="cal-h">CHART</div><canvas id="${chartId}" class="cal-chart"></canvas><div class="cal-legend" id="${chartId}Legend"></div></div>` : ""}
    ${scenarioId ? `<div class="cal-scenario"><div class="cal-h">SCENARIO ANALYSIS</div><div id="${scenarioId}"></div></div>` : ""}
    ${explanation ? `<div class="cal-explain"><div class="cal-h">DETAILED EXPLANATION</div>${explanation}</div>` : ""}
  </div>`;
}

function numInput(id, label, value, suffix = "", step = "") {
  return `<div class="cal-field"><label for="${id}">${label}</label><div class="cal-input-row"><input type="number" id="${id}" value="${value}" ${step ? `step="${step}"` : ""}/>${suffix ? `<span class="cal-suffix">${suffix}</span>` : ""}</div></div>`;
}

function drawLineChart(canvasId, series, labels, opts = {}) {
  const cv = document.getElementById(canvasId);
  if (!cv) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const W = cv.offsetWidth || 600, H = opts.height || 240;
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext("2d"); ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  const pad = { l: 60, r: 20, t: 20, b: 28 };
  const cw = W - pad.l - pad.r, ch = H - pad.t - pad.b;
  const all = series.flatMap((s) => s.data);
  const lo = Math.min(0, ...all), hi = Math.max(...all);
  const span = (hi - lo) || 1;
  const x = (i) => pad.l + (i / Math.max(1, series[0].data.length - 1)) * cw;
  const y = (v) => pad.t + ch - ((v - lo) / span) * ch;
  // gridlines + y labels
  ctx.strokeStyle = "rgba(35,42,51,.7)"; ctx.fillStyle = "#7a8290"; ctx.font = "10px monospace"; ctx.textAlign = "right";
  for (let i = 0; i <= 4; i++) {
    const yv = lo + (span * i / 4);
    const yy = y(yv);
    ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(W - pad.r, yy); ctx.stroke();
    ctx.fillText(RPshort(yv), pad.l - 6, yy + 3);
  }
  // x labels (a few)
  ctx.textAlign = "center";
  const xTicks = Math.min(6, labels.length);
  for (let i = 0; i < xTicks; i++) {
    const idx = Math.floor(i * (labels.length - 1) / (xTicks - 1));
    ctx.fillText(labels[idx], x(idx), H - 8);
  }
  // series
  series.forEach((s) => {
    ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.beginPath();
    s.data.forEach((v, i) => { i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v)); });
    ctx.stroke();
    if (s.fill) { ctx.fillStyle = s.fill; ctx.lineTo(x(s.data.length - 1), y(0)); ctx.lineTo(x(0), y(0)); ctx.closePath(); ctx.fill(); }
  });
  // legend
  const legendEl = document.getElementById(canvasId + "Legend");
  if (legendEl) legendEl.innerHTML = series.map((s) => `<span class="cal-leg"><i style="background:${s.color}"></i>${s.label}</span>`).join("");
}

/* ════════ INDIVIDUAL CALCULATORS ════════ */
const CALC_ENGINES = {

  /* ───── SIP ───── */
  sip: {
    title: "SIP Calculator",
    sub: "monthly investment → wealth corpus",
    render() {
      const sd = this.state || (this.state = { amt: 5000, years: 15, rate: 12, step: 0 });
      return calcShell({
        inputs: numInput("sipAmt", "Monthly investment", sd.amt, "₹") + numInput("sipYears", "Investment period", sd.years, "years") + numInput("sipStep", "Annual step-up", sd.step, "%", "0.5"),
        assumptions: numInput("sipRate", "Expected annual return", sd.rate, "%", "0.5") + `<div class="cal-note">12% is the long-term Nifty 50 average. Equity mutual funds historically range 10–14%.</div>`,
        formula: `<div class="cal-fcode">FV = P × [((1 + r)^n − 1) / r] × (1 + r)</div><div class="cal-fnote">where P = monthly SIP, r = monthly return, n = months. Step-up adds yearly increment to P.</div>`,
        chartId: "sipChart",
        scenarioId: "sipScen",
        explanation: `<p><b>What is SIP?</b> A Systematic Investment Plan lets you invest a fixed amount every month into a fund. The same way an EMI works — but in reverse. Instead of paying off a loan, you're building wealth.</p>
          <p><b>Why it works:</b> Two forces multiply your money. <b>Compounding</b> — earlier investments grow longer. <b>Rupee-cost averaging</b> — you automatically buy more units when markets are low and fewer when high, so your average cost is lower than if you tried to time the market.</p>
          <p><b>Real example:</b> ₹5,000/month for 20 years at 12% return = ₹50 lakh corpus. You invested ₹12 lakh; the rest is compound interest.</p>
          <p><b>Common mistakes:</b> Stopping during market crashes (worst time to stop), not stepping up with salary growth, picking funds based on last year's returns.</p>`,
      });
    },
    bind() { ["sipAmt", "sipYears", "sipRate", "sipStep"].forEach((id) => $("#" + id).addEventListener("input", () => CALC_ENGINES.sip.recompute())); this.recompute(); },
    recompute() {
      const P = +$("#sipAmt").value, yrs = +$("#sipYears").value, R = +$("#sipRate").value, step = +$("#sipStep").value;
      const r = R / 100 / 12;
      let corpus = 0, monthly = P, invested = 0;
      const monthlyCorpus = [], monthlyInvested = [], labels = [];
      for (let y = 0; y < yrs; y++) {
        if (y > 0) monthly = monthly * (1 + step / 100);
        for (let m = 0; m < 12; m++) {
          corpus = corpus * (1 + r) + monthly;
          invested += monthly;
        }
        monthlyCorpus.push(corpus); monthlyInvested.push(invested); labels.push("Y" + (y + 1));
      }
      const gain = corpus - invested;
      $("#calcResult").innerHTML = `<div class="cal-kv"><div><span>Total invested</span><b>${RPshort(invested)}</b></div><div><span>Wealth gained</span><b class="up">${RPshort(gain)}</b></div><div class="cal-big"><span>Final corpus</span><b>${RPshort(corpus)}</b></div></div>`;
      drawLineChart("sipChart", [
        { label: "Invested", data: monthlyInvested, color: "#7a8290", fill: "rgba(122,130,144,.08)" },
        { label: "Corpus", data: monthlyCorpus, color: "#c8862a", fill: "rgba(200,134,42,.1)" },
      ], labels);
      // scenario analysis
      const scen = [8, 10, 12, 14, 16].map((rate) => {
        let c = 0, mo = P;
        for (let y = 0; y < yrs; y++) { if (y > 0) mo *= (1 + step / 100); for (let m = 0; m < 12; m++) c = c * (1 + rate / 100 / 12) + mo; }
        return { rate, corpus: c };
      });
      $("#sipScen").innerHTML = `<table class="cal-stable"><tr><th>Annual return</th><th>Final corpus</th><th>Wealth gained</th></tr>${scen.map((s) => `<tr class="${s.rate === R ? "self" : ""}"><td>${s.rate}%</td><td>${RPshort(s.corpus)}</td><td class="up">${RPshort(s.corpus - invested)}</td></tr>`).join("")}</table>`;
    },
  },

  /* ───── SWP ───── */
  swp: {
    title: "SWP Calculator",
    sub: "systematic withdrawal — make your corpus last",
    render() {
      const sd = this.state || (this.state = { corpus: 5000000, withdraw: 30000, rate: 9, years: 25 });
      return calcShell({
        inputs: numInput("swpCorpus", "Starting corpus", sd.corpus, "₹") + numInput("swpW", "Monthly withdrawal", sd.withdraw, "₹") + numInput("swpYears", "Withdrawal period", sd.years, "years"),
        assumptions: numInput("swpRate", "Expected annual return", sd.rate, "%", "0.5") + `<div class="cal-note">Use 8–10% for balanced funds, 5–7% for debt-heavy retirement portfolios.</div>`,
        formula: `<div class="cal-fcode">Balance(t+1) = Balance(t) × (1 + r/12) − W</div><div class="cal-fnote">Each month: corpus earns return, then withdrawal is taken out. Runs out when balance hits zero.</div>`,
        chartId: "swpChart",
        scenarioId: "swpScen",
        explanation: `<p><b>What is SWP?</b> Systematic Withdrawal Plan — the reverse of SIP. You park a lump sum and withdraw a fixed amount every month. Popular for post-retirement income.</p>
          <p><b>How long will my money last?</b> It depends on three things: how much you withdraw, what return you earn, and inflation. If withdrawals exceed returns, your corpus shrinks.</p>
          <p><b>Real example:</b> ₹50 lakh corpus earning 9%, withdrawing ₹30,000/month = lasts ~25 years. Withdrawing ₹50,000/month = lasts only 12 years.</p>
          <p><b>Common mistakes:</b> Not adjusting withdrawal for inflation (₹30K today = ₹15K real value in 12 years at 6% inflation), withdrawing during market crashes (sequence-of-returns risk).</p>`,
      });
    },
    bind() { ["swpCorpus", "swpW", "swpRate", "swpYears"].forEach((id) => $("#" + id).addEventListener("input", () => CALC_ENGINES.swp.recompute())); this.recompute(); },
    recompute() {
      const C = +$("#swpCorpus").value, W = +$("#swpW").value, R = +$("#swpRate").value / 100 / 12, yrs = +$("#swpYears").value;
      let bal = C; const series = [], labels = [];
      let exhaustedAtMonth = null;
      for (let m = 0; m <= yrs * 12; m++) {
        if (m > 0) { bal = bal * (1 + R) - W; if (bal < 0 && exhaustedAtMonth == null) exhaustedAtMonth = m; }
        if (m % 12 === 0) { series.push(Math.max(0, bal)); labels.push("Y" + (m / 12)); }
      }
      const totalW = W * (exhaustedAtMonth || yrs * 12);
      $("#calcResult").innerHTML = `<div class="cal-kv">
        <div><span>Total withdrawn</span><b>${RPshort(totalW)}</b></div>
        <div><span>Ending balance</span><b class="${bal >= 0 ? "up" : "down"}">${RPshort(Math.max(0, bal))}</b></div>
        <div class="cal-big"><span>${exhaustedAtMonth ? "Lasts" : "Corpus lasts >"+yrs+"y"}</span><b>${exhaustedAtMonth ? Math.floor(exhaustedAtMonth / 12) + "y " + (exhaustedAtMonth % 12) + "m" : yrs + "y+"}</b></div>
      </div>`;
      drawLineChart("swpChart", [{ label: "Corpus balance", data: series, color: "#c8862a", fill: "rgba(200,134,42,.12)" }], labels);
      const scen = [20000, 30000, 40000, 50000, 75000].map((w) => {
        let b = C, mon = 0; while (b > 0 && mon < 600) { b = b * (1 + R) - w; mon++; if (b < 0) break; }
        return { w, months: mon };
      });
      $("#swpScen").innerHTML = `<table class="cal-stable"><tr><th>Monthly withdrawal</th><th>Lasts</th></tr>${scen.map((s) => `<tr class="${s.w === W ? "self" : ""}"><td>${RPshort(s.w)}</td><td>${Math.floor(s.months / 12)}y ${s.months % 12}m</td></tr>`).join("")}</table>`;
    },
  },

  /* ───── Lumpsum ───── */
  lumpsum: {
    title: "Lumpsum Calculator",
    sub: "one-time investment growth",
    render() {
      const sd = this.state || (this.state = { amt: 100000, years: 15, rate: 12 });
      return calcShell({
        inputs: numInput("lsAmt", "Lumpsum amount", sd.amt, "₹") + numInput("lsYears", "Period", sd.years, "years"),
        assumptions: numInput("lsRate", "Expected annual return", sd.rate, "%", "0.5"),
        formula: `<div class="cal-fcode">FV = P × (1 + r)^n</div><div class="cal-fnote">Pure compound interest. P = principal, r = annual return, n = years.</div>`,
        chartId: "lsChart",
        scenarioId: "lsScen",
        explanation: `<p><b>What is a lumpsum?</b> Investing a single large amount at once — like putting a bonus or inheritance into mutual funds in one go.</p>
          <p><b>SIP vs Lumpsum:</b> Lumpsum benefits if markets go up steadily after you invest. SIP benefits if markets are volatile (you buy lower on dips). Historically, lumpsum wins ~60% of the time but with much higher risk.</p>
          <p><b>Real example:</b> ₹1 lakh invested at 12% for 20 years = ₹9.6 lakh. The same ₹1 lakh in your savings account at 3% = ₹1.8 lakh.</p>
          <p><b>Common mistakes:</b> Investing the whole amount when markets are at peaks. A middle path — split into 3-6 month STP (Systematic Transfer) — reduces timing risk.</p>`,
      });
    },
    bind() { ["lsAmt", "lsYears", "lsRate"].forEach((id) => $("#" + id).addEventListener("input", () => CALC_ENGINES.lumpsum.recompute())); this.recompute(); },
    recompute() {
      const P = +$("#lsAmt").value, n = +$("#lsYears").value, R = +$("#lsRate").value / 100;
      const FV = P * Math.pow(1 + R, n);
      const series = [], labels = [];
      for (let y = 0; y <= n; y++) { series.push(P * Math.pow(1 + R, y)); labels.push("Y" + y); }
      $("#calcResult").innerHTML = `<div class="cal-kv"><div><span>Invested</span><b>${RPshort(P)}</b></div><div><span>Wealth gained</span><b class="up">${RPshort(FV - P)}</b></div><div class="cal-big"><span>Future value</span><b>${RPshort(FV)}</b></div></div>`;
      drawLineChart("lsChart", [{ label: "Value", data: series, color: "#c8862a", fill: "rgba(200,134,42,.12)" }], labels);
      const scen = [6, 8, 10, 12, 14].map((rate) => ({ rate, fv: P * Math.pow(1 + rate / 100, n) }));
      $("#lsScen").innerHTML = `<table class="cal-stable"><tr><th>Annual return</th><th>Future value</th><th>Multiple</th></tr>${scen.map((s) => `<tr class="${s.rate === +$("#lsRate").value ? "self" : ""}"><td>${s.rate}%</td><td>${RPshort(s.fv)}</td><td>${(s.fv / P).toFixed(1)}×</td></tr>`).join("")}</table>`;
    },
  },

  /* ───── Retirement ───── */
  retirement: {
    title: "Retirement Calculator",
    sub: "how much do I need to retire — and what should I save?",
    render() {
      const sd = this.state || (this.state = { age: 30, retAge: 60, lifeExp: 85, monthlySpend: 50000, infl: 6, preRet: 12, postRet: 8, currentSav: 0 });
      return calcShell({
        inputs: numInput("rtAge", "Current age", sd.age) + numInput("rtRet", "Retirement age", sd.retAge) + numInput("rtLife", "Life expectancy", sd.lifeExp) + numInput("rtSpend", "Monthly spend today", sd.monthlySpend, "₹") + numInput("rtSav", "Current savings", sd.currentSav, "₹"),
        assumptions: numInput("rtInfl", "Inflation", sd.infl, "%", "0.5") + numInput("rtPre", "Pre-retirement return", sd.preRet, "%", "0.5") + numInput("rtPost", "Post-retirement return", sd.postRet, "%", "0.5"),
        formula: `<div class="cal-fcode">Corpus needed = Monthly spend (inflated) × 12 × annuity factor</div><div class="cal-fnote">Adjusted for inflation in retirement; annuity factor depends on post-retirement return vs inflation gap.</div>`,
        chartId: "rtChart",
        scenarioId: "rtScen",
        explanation: `<p><b>How much do I need to retire?</b> Most people underestimate by 3–5×. The trick is inflation compounds for 30+ years — ₹50,000/month today becomes ₹2.87 lakh/month in 30 years at 6% inflation.</p>
          <p><b>The 4% rule (adjusted for India):</b> Roughly, you need 30× your annual expenses as corpus. So ₹50K/month spend = ₹6 lakh/year × 30 = ₹1.8 Cr corpus, in <i>today's money</i>. In retirement-age money it's much more.</p>
          <p><b>Why early start matters:</b> Starting at 25 vs 35 with the same goal means saving HALF the amount per month — because 10 extra years of compounding does the heavy lifting.</p>
          <p><b>Common mistakes:</b> Ignoring inflation, forgetting healthcare costs balloon in old age, withdrawing too aggressively in early retirement.</p>`,
      });
    },
    bind() { ["rtAge","rtRet","rtLife","rtSpend","rtSav","rtInfl","rtPre","rtPost"].forEach((id) => $("#" + id).addEventListener("input", () => CALC_ENGINES.retirement.recompute())); this.recompute(); },
    recompute() {
      const age = +$("#rtAge").value, retAge = +$("#rtRet").value, life = +$("#rtLife").value;
      const spend = +$("#rtSpend").value, infl = +$("#rtInfl").value / 100, pre = +$("#rtPre").value / 100, post = +$("#rtPost").value / 100, sav = +$("#rtSav").value;
      const yrsToRet = Math.max(0, retAge - age), retYrs = Math.max(1, life - retAge);
      // monthly spend at retirement (inflated)
      const spendAtRet = spend * Math.pow(1 + infl, yrsToRet);
      // corpus needed: PV of inflation-adjusted spending over retYrs at post-ret return
      let corpus = 0; let monthly = spendAtRet;
      for (let y = 0; y < retYrs; y++) {
        // need PV at retirement of this year's annual spend
        corpus += (monthly * 12) / Math.pow(1 + post, y + 1);
        monthly *= (1 + infl);
      }
      // SIP needed to bridge gap
      const futureSav = sav * Math.pow(1 + pre, yrsToRet);
      const gap = Math.max(0, corpus - futureSav);
      const r = pre / 12, n = yrsToRet * 12;
      const sipNeeded = n > 0 && r > 0 ? gap * r / (Math.pow(1 + r, n) - 1) / (1 + r) : 0;
      // chart: corpus growth path
      const series = [], labels = []; let bal = sav, mo = 0;
      for (let y = 0; y <= yrsToRet; y++) {
        labels.push("Age " + (age + y));
        series.push(bal);
        for (let m = 0; m < 12; m++) bal = bal * (1 + pre / 12) + sipNeeded;
      }
      $("#calcResult").innerHTML = `<div class="cal-kv">
        <div><span>Monthly spend at retirement</span><b>${RPshort(spendAtRet)}</b></div>
        <div><span>Corpus needed</span><b>${RPshort(corpus)}</b></div>
        <div class="cal-big"><span>SIP required</span><b>${RPshort(sipNeeded)}/mo</b></div>
      </div>`;
      drawLineChart("rtChart", [{ label: "Projected corpus", data: series, color: "#c8862a", fill: "rgba(200,134,42,.12)" }], labels);
      const scen = [40000, 50000, 75000, 100000, 150000].map((s) => {
        let c = 0, m = s * Math.pow(1 + infl, yrsToRet);
        for (let y = 0; y < retYrs; y++) { c += (m * 12) / Math.pow(1 + post, y + 1); m *= (1 + infl); }
        return { spend: s, corpus: c };
      });
      $("#rtScen").innerHTML = `<table class="cal-stable"><tr><th>Monthly spend today</th><th>Corpus needed</th></tr>${scen.map((sc) => `<tr class="${sc.spend === spend ? "self" : ""}"><td>${RPshort(sc.spend)}</td><td>${RPshort(sc.corpus)}</td></tr>`).join("")}</table>`;
    },
  },

  /* ───── Inflation ───── */
  inflation: {
    title: "Inflation Calculator",
    sub: "what your money will be worth in the future",
    render() {
      const sd = this.state || (this.state = { amt: 100000, years: 20, rate: 6 });
      return calcShell({
        inputs: numInput("infAmt", "Today's amount", sd.amt, "₹") + numInput("infYears", "Years from now", sd.years),
        assumptions: numInput("infRate", "Inflation rate", sd.rate, "%", "0.5") + `<div class="cal-note">India's long-term inflation has averaged 5–7%. Use 6% as a baseline.</div>`,
        formula: `<div class="cal-fcode">Future value of expense = Today × (1 + inflation)^n<br>Real purchasing power = Today / (1 + inflation)^n</div>`,
        chartId: "infChart",
        scenarioId: "infScen",
        explanation: `<p><b>What is inflation?</b> The silent thief. Same ₹100 buys less every year because prices keep rising. India's official CPI inflation averages 5–6%, but for things like education and healthcare it's often 10%+.</p>
          <p><b>Real example:</b> A ₹100 movie ticket in 2004 costs about ₹400 today. That's 4× in 20 years — roughly 7% annual inflation.</p>
          <p><b>Why your salary increase doesn't feel like one:</b> If you got a 8% raise but inflation was 7%, your real income only went up 1%.</p>
          <p><b>What this means for investing:</b> If your FD earns 6% and inflation is 6%, your real return is 0%. Equity's job is to beat inflation by 5–8 percentage points over the long term.</p>`,
      });
    },
    bind() { ["infAmt", "infYears", "infRate"].forEach((id) => $("#" + id).addEventListener("input", () => CALC_ENGINES.inflation.recompute())); this.recompute(); },
    recompute() {
      const amt = +$("#infAmt").value, n = +$("#infYears").value, r = +$("#infRate").value / 100;
      const futureCost = amt * Math.pow(1 + r, n);
      const realValue = amt / Math.pow(1 + r, n);
      const series = [], realSer = [], labels = [];
      for (let y = 0; y <= n; y++) { series.push(amt * Math.pow(1 + r, y)); realSer.push(amt / Math.pow(1 + r, y)); labels.push("Y" + y); }
      $("#calcResult").innerHTML = `<div class="cal-kv">
        <div><span>Same items will cost</span><b class="down">${RPshort(futureCost)}</b></div>
        <div><span>Real value of your ₹${NF(amt, 0)}</span><b>${RPshort(realValue)}</b></div>
        <div class="cal-big"><span>Loss in purchasing power</span><b class="down">${(((futureCost - amt) / futureCost) * 100).toFixed(0)}%</b></div>
      </div>`;
      drawLineChart("infChart", [
        { label: "Future cost of same items", data: series, color: "#c84b3c", fill: "rgba(200,75,60,.08)" },
        { label: "Real value of ₹" + NF(amt, 0), data: realSer, color: "#2e9e6b", fill: "rgba(46,158,107,.08)" },
      ], labels);
      const scen = [4, 5, 6, 7, 8, 10].map((rate) => ({ rate, fv: amt * Math.pow(1 + rate / 100, n), real: amt / Math.pow(1 + rate / 100, n) }));
      $("#infScen").innerHTML = `<table class="cal-stable"><tr><th>Inflation</th><th>Future cost</th><th>Real value of ₹${NF(amt, 0)}</th></tr>${scen.map((s) => `<tr class="${s.rate === +$("#infRate").value ? "self" : ""}"><td>${s.rate}%</td><td>${RPshort(s.fv)}</td><td>${RPshort(s.real)}</td></tr>`).join("")}</table>`;
    },
  },

  /* ───── Wealth Projection ───── */
  wealth: {
    title: "Wealth Projection",
    sub: "multi-stage life-stage planning",
    render() {
      const sd = this.state || (this.state = { age: 28, initial: 200000, sip: 15000, rate: 12, infl: 6, retAge: 60 });
      return calcShell({
        inputs: numInput("wpAge", "Current age", sd.age) + numInput("wpInit", "Current savings", sd.initial, "₹") + numInput("wpSip", "Monthly SIP", sd.sip, "₹") + numInput("wpRetAge", "Target retirement age", sd.retAge),
        assumptions: numInput("wpRate", "Equity return", sd.rate, "%", "0.5") + numInput("wpInfl", "Inflation", sd.infl, "%", "0.5"),
        formula: `<div class="cal-fcode">Stages: Initial × (1 + r)^n + SIP × FV-annuity-factor</div><div class="cal-fnote">Tracks both nominal and inflation-adjusted (real) wealth at each life stage.</div>`,
        chartId: "wpChart",
        scenarioId: "wpScen",
        explanation: `<p><b>Multi-stage thinking:</b> Most calculators show only one number. This shows your wealth at <i>every stage</i> — age 30, 40, 50, 60 — in both nominal and real (today's purchasing power) terms.</p>
          <p><b>The 30s lesson:</b> The wealth you build by age 35 typically grows 5–8× by retirement. Money invested in your 20s is 5× more valuable than money invested in your 40s, due to compounding.</p>
          <p><b>What 'real wealth' means:</b> ₹5 Cr at retirement sounds great. But if inflation has been 6% for 30 years, that's only ₹87 lakh in today's purchasing power. Always check real, not nominal.</p>`,
      });
    },
    bind() { ["wpAge","wpInit","wpSip","wpRate","wpInfl","wpRetAge"].forEach((id) => $("#" + id).addEventListener("input", () => CALC_ENGINES.wealth.recompute())); this.recompute(); },
    recompute() {
      const age = +$("#wpAge").value, init = +$("#wpInit").value, sip = +$("#wpSip").value, rate = +$("#wpRate").value / 100, infl = +$("#wpInfl").value / 100, retAge = +$("#wpRetAge").value;
      const yrs = Math.max(1, retAge - age);
      const series = [], realSer = [], labels = []; let bal = init;
      const stages = [];
      for (let y = 0; y <= yrs; y++) {
        labels.push("Age " + (age + y));
        series.push(bal);
        realSer.push(bal / Math.pow(1 + infl, y));
        if ((age + y) % 5 === 0 || y === yrs) stages.push({ age: age + y, nominal: bal, real: bal / Math.pow(1 + infl, y) });
        for (let m = 0; m < 12; m++) bal = bal * (1 + rate / 12) + sip;
      }
      const final = series[series.length - 1], finalReal = realSer[realSer.length - 1];
      $("#calcResult").innerHTML = `<div class="cal-kv">
        <div><span>Nominal at ${retAge}</span><b>${RPshort(final)}</b></div>
        <div><span>Real (today's value)</span><b>${RPshort(finalReal)}</b></div>
        <div class="cal-big"><span>Multiple of current</span><b>${(final / Math.max(init, 1)).toFixed(0)}×</b></div>
      </div>`;
      drawLineChart("wpChart", [
        { label: "Nominal wealth", data: series, color: "#c8862a", fill: "rgba(200,134,42,.08)" },
        { label: "Real wealth (today's money)", data: realSer, color: "#3a6ea5", fill: "rgba(58,110,165,.08)" },
      ], labels);
      $("#wpScen").innerHTML = `<table class="cal-stable"><tr><th>Stage</th><th>Nominal wealth</th><th>Real (today's value)</th></tr>${stages.map((s) => `<tr><td>Age ${s.age}</td><td>${RPshort(s.nominal)}</td><td>${RPshort(s.real)}</td></tr>`).join("")}</table>`;
    },
  },

  /* ════════ ESOP SUITE ════════ */

  /* ───── ESOP Valuation ───── */
  esopval: {
    title: "ESOP Valuation",
    sub: "what your stock options are worth",
    render() {
      const sd = this.state || (this.state = { sym: "", options: 1000, strike: 100, fmv: 500, vested: 50 });
      return calcShell({
        inputs: `<div class="cal-field"><label>Listed company ticker (optional)</label><div class="cal-input-row"><input type="text" id="evSym" value="${sd.sym}" placeholder="e.g. INFY.NS, AAPL"/><button class="mini-btn" id="evFetch">Fetch FMV</button></div></div>` + numInput("evOpts", "Options granted", sd.options) + numInput("evStrike", "Strike price", sd.strike, "₹") + numInput("evVested", "Vested %", sd.vested, "%"),
        assumptions: numInput("evFmv", "Current share price (FMV)", sd.fmv, "₹") + `<div class="cal-note">For listed companies — enter the ticker and click Fetch. For pre-IPO startups, FMV typically equals the latest funding-round price per share.</div>`,
        formula: `<div class="cal-fcode">Intrinsic value = Options × max(0, FMV − Strike)<br>Vested value = Intrinsic × (Vested % / 100)</div>`,
        chartId: "evChart",
        scenarioId: "evScen",
        explanation: `<p><b>What is an ESOP?</b> Employee Stock Option Plan. Your company grants you the right to <i>buy</i> shares at a fixed (strike) price, later. If the share price rises, you exercise (buy at strike) and either keep or sell at the higher price.</p>
          <p><b>Example:</b> You're granted 1,000 options at ₹100 strike. Today the share is worth ₹500. If 50% have vested, your vested value is 500 × (500 − 100) = ₹2.5 lakh. But this is paper value — you only realise it on exercise + sale.</p>
          <p><b>For listed companies:</b> FMV is the current share price (live from market). For pre-IPO startups, FMV is set at each funding round.</p>
          <p><b>Common mistakes:</b> Treating ESOP value as cash (it's not until you sell), ignoring strike price (high-strike options can be worthless), ignoring vesting cliffs (1-year cliff is standard).</p>`,
      });
    },
    bind() {
      ["evOpts", "evStrike", "evFmv", "evVested"].forEach((id) => $("#" + id).addEventListener("input", () => CALC_ENGINES.esopval.recompute()));
      $("#evFetch").addEventListener("click", () => this.fetchFmv());
      this.recompute();
    },
    async fetchFmv() {
      const sym = ($("#evSym").value || "").trim().toUpperCase();
      if (!sym) return;
      try {
        const q = await api("/api/quote/" + encodeURIComponent(sym));
        if (q && q.price) { $("#evFmv").value = q.price.toFixed(2); this.recompute(); }
      } catch { }
    },
    recompute() {
      const opts = +$("#evOpts").value, strike = +$("#evStrike").value, fmv = +$("#evFmv").value, vested = +$("#evVested").value / 100;
      const perOpt = Math.max(0, fmv - strike);
      const total = opts * perOpt, vestedV = total * vested;
      $("#calcResult").innerHTML = `<div class="cal-kv">
        <div><span>Gain per option</span><b class="${perOpt > 0 ? "up" : "down"}">${RPshort(perOpt)}</b></div>
        <div><span>Total intrinsic value</span><b>${RPshort(total)}</b></div>
        <div class="cal-big"><span>Vested value (${(vested * 100).toFixed(0)}%)</span><b>${RPshort(vestedV)}</b></div>
      </div>`;
      // chart: value vs FMV scenarios
      const range = []; const data = [];
      for (let p = Math.max(0, strike * 0.5); p <= strike * 3; p += strike * 0.1) { range.push("₹" + p.toFixed(0)); data.push(opts * Math.max(0, p - strike) * vested); }
      drawLineChart("evChart", [{ label: "ESOP value vs share price", data, color: "#c8862a", fill: "rgba(200,134,42,.12)" }], range);
      const scen = [-50, -25, 0, 25, 50, 100, 200].map((pct) => { const np = fmv * (1 + pct / 100); return { pct, fmv: np, val: opts * Math.max(0, np - strike) * vested }; });
      $("#evScen").innerHTML = `<table class="cal-stable"><tr><th>FMV change</th><th>New FMV</th><th>Vested value</th></tr>${scen.map((s) => `<tr class="${s.pct === 0 ? "self" : ""}"><td class="${s.pct > 0 ? "up" : s.pct < 0 ? "down" : ""}">${s.pct >= 0 ? "+" : ""}${s.pct}%</td><td>${RPshort(s.fmv)}</td><td>${RPshort(s.val)}</td></tr>`).join("")}</table>`;
    },
  },

  /* ───── Vesting Schedule ───── */
  vesting: {
    title: "Vesting Schedule",
    sub: "when do my options vest?",
    render() {
      const sd = this.state || (this.state = { total: 4000, years: 4, cliff: 12 });
      return calcShell({
        inputs: numInput("vsTotal", "Total options granted", sd.total) + numInput("vsYears", "Vesting period", sd.years, "years") + numInput("vsCliff", "Cliff", sd.cliff, "months"),
        formula: `<div class="cal-fcode">Standard 4-year vest, 1-year cliff:<br>Month 0–11: 0 vested<br>Month 12: 25% vest in one shot (cliff)<br>Month 13–48: ~2.08% vest per month</div>`,
        chartId: "vsChart",
        explanation: `<p><b>What is vesting?</b> You don't get all your options on day one. They unlock (vest) over time — usually 4 years — to retain you. If you leave early, you forfeit unvested options.</p>
          <p><b>What's a cliff?</b> The minimum time you must stay before any options vest. Standard is 12 months. Leave on month 11 = zero. Stay one more month and 25% vest instantly.</p>
          <p><b>Real schedule:</b> 4,000 options, 4yr vest, 1yr cliff = 1,000 vest on day 365, then ~83 every month for 3 more years.</p>
          <p><b>Tip:</b> If you're leaving a job, check your vesting date — staying 2 extra weeks could be worth lakhs.</p>`,
      });
    },
    bind() { ["vsTotal","vsYears","vsCliff"].forEach((id) => $("#" + id).addEventListener("input", () => CALC_ENGINES.vesting.recompute())); this.recompute(); },
    recompute() {
      const total = +$("#vsTotal").value, yrs = +$("#vsYears").value, cliff = +$("#vsCliff").value;
      const months = yrs * 12;
      const series = [], labels = [];
      const cliffVest = total * (cliff / months);
      const postCliffPerMonth = (total - cliffVest) / (months - cliff);
      let vested = 0;
      for (let m = 0; m <= months; m++) {
        if (m < cliff) vested = 0;
        else if (m === cliff) vested = cliffVest;
        else vested = Math.min(total, cliffVest + (m - cliff) * postCliffPerMonth);
        if (m % 3 === 0) { series.push(vested); labels.push("M" + m); }
      }
      $("#calcResult").innerHTML = `<div class="cal-kv">
        <div><span>At cliff (month ${cliff})</span><b>${NF(cliffVest, 0)} options</b></div>
        <div><span>After cliff, per month</span><b>${NF(postCliffPerMonth, 0)} options</b></div>
        <div class="cal-big"><span>Fully vested in</span><b>${yrs}y</b></div>
      </div>`;
      drawLineChart("vsChart", [{ label: "Vested options over time", data: series, color: "#c8862a", fill: "rgba(200,134,42,.12)" }], labels);
    },
  },

  /* ───── ESOP Tax ───── */
  esoptax: {
    title: "ESOP Tax Calculator (India)",
    sub: "tax on exercise and on sale",
    render() {
      const sd = this.state || (this.state = { opts: 1000, strike: 100, fmvEx: 500, salePrice: 800, holdDays: 400, slab: 30 });
      return calcShell({
        inputs: numInput("etOpts", "Options exercised", sd.opts) + numInput("etStrike", "Strike price", sd.strike, "₹") + numInput("etFmv", "FMV on exercise day", sd.fmvEx, "₹") + numInput("etSale", "Sale price", sd.salePrice, "₹") + numInput("etHold", "Holding days (after exercise)", sd.holdDays),
        assumptions: numInput("etSlab", "Your income tax slab", sd.slab, "%", "1") + `<div class="cal-note">Perquisite tax is at slab rate. Capital gains: STCG 20% if held &lt; 12 months (listed) / &lt; 24 months (unlisted); LTCG 12.5% (listed equity, above ₹1.25L exempt).</div>`,
        formula: `<div class="cal-fcode">Step 1 (on exercise): Perquisite = (FMV − Strike) × Options → taxed at slab<br>Step 2 (on sale): Capital gain = (Sale − FMV) × Options → STCG or LTCG</div>`,
        chartId: "etChart",
        explanation: `<p><b>Two tax events:</b> Unlike a salary, ESOPs are taxed twice — once when you <i>exercise</i> (buy the shares) and again when you <i>sell</i> them. This trips up most employees.</p>
          <p><b>Tax 1 — on exercise (perquisite):</b> The gap between strike and FMV on exercise day is treated as salary income, taxed at your slab. Even if you don't sell the shares, you owe this tax.</p>
          <p><b>Tax 2 — on sale (capital gains):</b> Any further gain from FMV to sale price is capital gains. Listed: STCG 20% (under 12m) or LTCG 12.5% (over 12m, first ₹1.25L exempt). Unlisted: STCG slab (under 24m), LTCG 12.5% (over 24m).</p>
          <p><b>Common mistake:</b> Exercising options without funds set aside for perquisite tax — you may have to sell shares immediately just to pay the tax. Plan for ~30% cash outlay on exercise.</p>`,
      });
    },
    bind() { ["etOpts","etStrike","etFmv","etSale","etHold","etSlab"].forEach((id) => $("#" + id).addEventListener("input", () => CALC_ENGINES.esoptax.recompute())); this.recompute(); },
    recompute() {
      const opts = +$("#etOpts").value, strike = +$("#etStrike").value, fmv = +$("#etFmv").value, sale = +$("#etSale").value, hold = +$("#etHold").value, slab = +$("#etSlab").value / 100;
      const perq = Math.max(0, (fmv - strike) * opts);
      const tax1 = perq * slab;
      const cg = Math.max(0, (sale - fmv) * opts);
      const isLTCG = hold > 365;
      const cgRate = isLTCG ? 0.125 : 0.20;
      const tax2 = isLTCG ? Math.max(0, cg - 125000) * cgRate : cg * cgRate;
      const grossSale = sale * opts;
      const totalCost = strike * opts;
      const net = grossSale - totalCost - tax1 - tax2;
      $("#calcResult").innerHTML = `<div class="cal-kv">
        <div><span>Gross proceeds</span><b>${RPshort(grossSale)}</b></div>
        <div><span>Cost (strike × options)</span><b>${RPshort(totalCost)}</b></div>
        <div><span>Perquisite tax (slab)</span><b class="down">${RPshort(tax1)}</b></div>
        <div><span>${isLTCG ? "LTCG" : "STCG"} tax</span><b class="down">${RPshort(tax2)}</b></div>
        <div class="cal-big"><span>Net in hand</span><b class="up">${RPshort(net)}</b></div>
      </div>`;
      // chart: gross vs net over different sale prices
      const range = [], gross = [], netS = [];
      for (let p = strike; p <= sale * 1.5; p += sale * 0.1) {
        range.push("₹" + p.toFixed(0));
        gross.push((p - strike) * opts);
        const t1 = Math.max(0, (fmv - strike) * opts) * slab;
        const cg2 = Math.max(0, (p - fmv) * opts);
        const t2 = isLTCG ? Math.max(0, cg2 - 125000) * cgRate : cg2 * cgRate;
        netS.push((p - strike) * opts - t1 - t2);
      }
      drawLineChart("etChart", [
        { label: "Gross gain", data: gross, color: "#7a8290" },
        { label: "Net after tax", data: netS, color: "#2e9e6b", fill: "rgba(46,158,107,.08)" },
      ], range);
    },
  },

  /* ───── Exit Proceeds ───── */
  esopexit: {
    title: "Exit Proceeds Simulator",
    sub: "what I get if the company exits (IPO, acquisition)",
    render() {
      const sd = this.state || (this.state = { opts: 5000, strike: 50, exitVal: 5000, sharesOut: 1000000 });
      return calcShell({
        inputs: numInput("eeOpts", "Options vested", sd.opts) + numInput("eeStrike", "Strike", sd.strike, "₹") + numInput("eeExit", "Exit valuation", sd.exitVal, "₹ Cr") + numInput("eeShares", "Total shares outstanding", sd.sharesOut),
        formula: `<div class="cal-fcode">Exit price per share = (Exit valuation × 1Cr) / Total shares<br>Your proceeds = Options × (Exit price − Strike) − tax</div>`,
        chartId: "eeChart",
        scenarioId: "eeScen",
        explanation: `<p><b>What's an exit?</b> When the company gets acquired or goes public (IPO). This is when ESOPs typically turn into real cash for employees.</p>
          <p><b>Why valuation matters:</b> If your company is bought for ₹500 Cr and there are 1 Cr shares outstanding, the exit price is ₹500/share. Your 5,000 options at ₹50 strike are worth (500−50) × 5,000 = ₹22.5 lakh.</p>
          <p><b>Watch for:</b> Preference shares in waterfall (investors get paid first — see the Waterfall calculator). Lockup periods (you can't sell at IPO for 6–12 months). Acquihires (acquirer cancels options).</p>`,
      });
    },
    bind() { ["eeOpts","eeStrike","eeExit","eeShares"].forEach((id) => $("#" + id).addEventListener("input", () => CALC_ENGINES.esopexit.recompute())); this.recompute(); },
    recompute() {
      const opts = +$("#eeOpts").value, strike = +$("#eeStrike").value, exitVal = +$("#eeExit").value * 1e7, shares = +$("#eeShares").value;
      const priceShare = exitVal / shares;
      const gross = opts * Math.max(0, priceShare - strike);
      $("#calcResult").innerHTML = `<div class="cal-kv">
        <div><span>Exit price per share</span><b>${RP(priceShare)}</b></div>
        <div><span>Gain per option</span><b class="up">${RP(Math.max(0, priceShare - strike))}</b></div>
        <div class="cal-big"><span>Gross proceeds</span><b>${RPshort(gross)}</b></div>
      </div>`;
      const vals = [], labels = [];
      [50, 100, 250, 500, 1000, 2500, 5000, 10000].forEach((cr) => {
        labels.push("₹" + cr + "Cr"); const p = cr * 1e7 / shares; vals.push(opts * Math.max(0, p - strike));
      });
      drawLineChart("eeChart", [{ label: "Proceeds vs exit valuation", data: vals, color: "#c8862a", fill: "rgba(200,134,42,.12)" }], labels);
      const scen = [-50, -25, 0, 25, 50, 100, 200].map((pct) => { const ne = exitVal * (1 + pct / 100); const np = ne / shares; return { pct, val: ne / 1e7, proceeds: opts * Math.max(0, np - strike) }; });
      $("#eeScen").innerHTML = `<table class="cal-stable"><tr><th>Exit valuation change</th><th>Valuation</th><th>Your proceeds</th></tr>${scen.map((s) => `<tr class="${s.pct === 0 ? "self" : ""}"><td class="${s.pct > 0 ? "up" : s.pct < 0 ? "down" : ""}">${s.pct >= 0 ? "+" : ""}${s.pct}%</td><td>₹${s.val.toFixed(0)}Cr</td><td>${RPshort(s.proceeds)}</td></tr>`).join("")}</table>`;
    },
  },

  /* ───── Dilution ───── */
  esopdilution: {
    title: "Dilution Calculator",
    sub: "how new funding affects your stake",
    render() {
      const sd = this.state || (this.state = { myShares: 5000, totalShares: 1000000, newCapital: 50, preMoney: 200 });
      return calcShell({
        inputs: numInput("ddMy", "My shares", sd.myShares) + numInput("ddTotal", "Current total shares", sd.totalShares) + numInput("ddNew", "New capital raised", sd.newCapital, "₹ Cr") + numInput("ddPre", "Pre-money valuation", sd.preMoney, "₹ Cr"),
        formula: `<div class="cal-fcode">Post-money = Pre-money + New capital<br>New shares issued = Total × (New capital / Post-money)<br>My new % = My shares / (Total + New shares issued)</div>`,
        chartId: "ddChart",
        explanation: `<p><b>What is dilution?</b> When a startup raises new funding, it issues fresh shares. Existing shareholders' percentage ownership decreases — that's dilution.</p>
          <p><b>Why it's not necessarily bad:</b> If your 0.5% stake in a ₹100 Cr company becomes a 0.4% stake in a ₹500 Cr company, you went from ₹50 lakh to ₹2 Cr. Bigger pie, smaller slice — usually a win.</p>
          <p><b>Example:</b> You own 5,000 of 10 lakh shares (0.5%). Company raises ₹50 Cr at ₹200 Cr pre-money → post-money ₹250 Cr → new shares = 10 lakh × (50/250) = 2 lakh new shares. Your new %: 5,000 / 12 lakh = 0.42%. Diluted by 17%.</p>
          <p><b>Common mistake:</b> Panicking about dilution. Focus on the absolute value of your stake, not the %.</p>`,
      });
    },
    bind() { ["ddMy","ddTotal","ddNew","ddPre"].forEach((id) => $("#" + id).addEventListener("input", () => CALC_ENGINES.esopdilution.recompute())); this.recompute(); },
    recompute() {
      const my = +$("#ddMy").value, total = +$("#ddTotal").value, newCap = +$("#ddNew").value * 1e7, pre = +$("#ddPre").value * 1e7;
      const post = pre + newCap;
      const newShares = total * (newCap / post);
      const newTotal = total + newShares;
      const oldPct = (my / total) * 100, newPct = (my / newTotal) * 100;
      const oldVal = (my / total) * pre, newVal = (my / newTotal) * post;
      $("#calcResult").innerHTML = `<div class="cal-kv">
        <div><span>Old stake %</span><b>${oldPct.toFixed(3)}%</b></div>
        <div><span>New stake %</span><b class="down">${newPct.toFixed(3)}%</b></div>
        <div><span>Dilution</span><b class="down">${(((oldPct - newPct) / oldPct) * 100).toFixed(1)}%</b></div>
        <div><span>Stake value (pre)</span><b>${RPshort(oldVal)}</b></div>
        <div class="cal-big"><span>Stake value (post)</span><b class="${newVal > oldVal ? "up" : "down"}">${RPshort(newVal)}</b></div>
      </div>`;
      // chart: stake value vs new round valuation
      const vals = [], labels = [];
      for (let valCr = 50; valCr <= 1000; valCr += 50) {
        labels.push("₹" + valCr + "Cr");
        const p = valCr * 1e7;
        const ns = total * (newCap / (p + newCap));
        vals.push((my / (total + ns)) * (p + newCap));
      }
      drawLineChart("ddChart", [{ label: "Your stake value vs round valuation", data: vals, color: "#c8862a", fill: "rgba(200,134,42,.12)" }], labels);
    },
  },

  /* ───── Waterfall ───── */
  esopwaterfall: {
    title: "Waterfall Analysis",
    sub: "preference-stack payouts on exit",
    render() {
      const sd = this.state || (this.state = { exitVal: 1000, prefInvested: 200, prefMult: 1, common: 8000000, esop: 1000000 });
      return calcShell({
        inputs: numInput("wfExit", "Exit valuation", sd.exitVal, "₹ Cr") + numInput("wfPref", "Preference capital invested", sd.prefInvested, "₹ Cr") + numInput("wfMult", "Liquidation preference", sd.prefMult, "× (1x typical)", "0.5") + numInput("wfCommon", "Common shares", sd.common) + numInput("wfEsop", "ESOP pool", sd.esop),
        formula: `<div class="cal-fcode">1. Preference shareholders get paid first: pref × multiple<br>2. Remaining distributed pro-rata to common + ESOP<br>(Simplified — actual deals have caps, participation, multiple series)</div>`,
        chartId: "wfChart",
        explanation: `<p><b>What is a waterfall?</b> In a startup exit, money doesn't go pro-rata to everyone. Investors with <i>preferred</i> shares get paid first (their preference). Common shareholders and employees get whatever's left.</p>
          <p><b>Why this matters for employees:</b> If your company exits for less than the preference stack, employees can get ZERO even though the company "sold for ₹500 Cr". This is why understanding the cap table matters.</p>
          <p><b>Example:</b> Investors put in ₹200 Cr with 1× preference. Company exits at ₹250 Cr. Investors take ₹200 Cr first. Only ₹50 Cr left to split among employees and founders.</p>
          <p><b>1× vs 2× preference:</b> 1× is standard. 2× or higher (common in down-rounds) means investors get 2× their money back before anyone else sees a rupee. Avoid joining companies with high preference stacks.</p>`,
      });
    },
    bind() { ["wfExit","wfPref","wfMult","wfCommon","wfEsop"].forEach((id) => $("#" + id).addEventListener("input", () => CALC_ENGINES.esopwaterfall.recompute())); this.recompute(); },
    recompute() {
      const exitVal = +$("#wfExit").value * 1e7, prefInv = +$("#wfPref").value * 1e7, mult = +$("#wfMult").value;
      const common = +$("#wfCommon").value, esop = +$("#wfEsop").value;
      const prefPayout = Math.min(exitVal, prefInv * mult);
      const remaining = Math.max(0, exitVal - prefPayout);
      const commonPct = common / (common + esop), esopPct = esop / (common + esop);
      const commonPay = remaining * commonPct, esopPay = remaining * esopPct;
      const perEsopShare = esop > 0 ? esopPay / esop : 0;
      $("#calcResult").innerHTML = `<div class="cal-kv">
        <div><span>Preference paid</span><b>${RPshort(prefPayout)}</b></div>
        <div><span>Common shareholders get</span><b>${RPshort(commonPay)}</b></div>
        <div><span>ESOP pool gets</span><b>${RPshort(esopPay)}</b></div>
        <div class="cal-big"><span>Per ESOP share</span><b class="${perEsopShare > 0 ? "up" : "down"}">${RP(perEsopShare)}</b></div>
      </div>`;
      // chart: ESOP per share vs exit valuation
      const vals = [], labels = [];
      for (let cr = Math.max(prefInv / 1e7, 50); cr <= 2000; cr += 100) {
        const ex = cr * 1e7;
        const pp = Math.min(ex, prefInv * mult);
        const rem = Math.max(0, ex - pp);
        const ep = rem * esopPct;
        vals.push(esop > 0 ? ep / esop : 0);
        labels.push("₹" + cr + "Cr");
      }
      drawLineChart("wfChart", [{ label: "ESOP per share vs exit valuation", data: vals, color: "#c8862a", fill: "rgba(200,134,42,.12)" }], labels);
    },
  },
};
