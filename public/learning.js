/* ════════════════════════════════════════════════════════════════════
   MERIDIAN · LEARNING CENTER v2 — 21 topics, all at full depth
   Sections: Definition · Why · Example · Visual · Interactive ·
   Mistakes · Related
   ════════════════════════════════════════════════════════════════════ */

const LEARN = {
  basics:    { group:"Foundations",         items:[
    {id:"equity",     label:"Equity Investing Basics",  blurb:"What is a stock, really?"},
    {id:"statements", label:"Financial Statements",     blurb:"Reading the three financials"},
    {id:"ratios",     label:"Ratio Analysis",           blurb:"P/E, ROE, D/E explained simply"},
  ]},
  valuation: { group:"Valuation",           items:[
    {id:"valuation",  label:"Valuation Concepts",       blurb:"How is a company priced?"},
    {id:"dcf",        label:"DCF Learning",             blurb:"Discounted cash flow, with chai shop"},
    {id:"perat",      label:"P/E Ratio Deep-Dive",      blurb:"Why P/E matters and what it misses"},
    {id:"moat",       label:"Economic Moats",           blurb:"Why some businesses earn more, forever"},
  ]},
  analysis:  { group:"Analysis",            items:[
    {id:"industry",   label:"Industry Analysis",        blurb:"Porter's 5 Forces in plain English"},
    {id:"risk",       label:"Risk Analysis",            blurb:"Volatility, beta, drawdown"},
    {id:"forensic",   label:"Forensic Accounting",      blurb:"Spotting accounting tricks"},
    {id:"technical",  label:"Technical Analysis",       blurb:"Charts, trends, indicators"},
    {id:"macro",      label:"Macroeconomics",           blurb:"How rates, inflation & GDP move markets"},
  ]},
  startup:   { group:"Startup & ESOP",      items:[
    {id:"esop",       label:"ESOP Education",           blurb:"Stock options for employees"},
    {id:"startup",    label:"Startup Finance",          blurb:"How startups actually work"},
    {id:"ipo",        label:"IPO Analysis",             blurb:"How to evaluate a new listing"},
  ]},
  pro:       { group:"Professional Finance", items:[
    {id:"portfolio",  label:"Portfolio Construction",   blurb:"Diversification, allocation, sizing"},
    {id:"governance", label:"Corporate Governance",     blurb:"Boards, promoters, red flags"},
    {id:"options",    label:"Options & Derivatives",    blurb:"Calls, puts, hedging"},
    {id:"tax",        label:"Tax-Efficient Investing",  blurb:"India: LTCG, STCG, ELSS"},
    {id:"ib",         label:"Investment Banking",       blurb:"What IBs actually do"},
    {id:"pevc",       label:"Private Equity & VC",      blurb:"LBOs, fund structure, startup funding"},
    {id:"dict",       label:"Financial Dictionary",     blurb:"Quick reference — 40+ terms"},
  ]},
};

TABS.learn = {
  current: null,
  init() {
    const nav = $("#learnNav");
    nav.innerHTML = Object.entries(LEARN).map(([,g]) =>
      `<div class="learn-grp"><div class="learn-gl">${g.group}</div>${
        g.items.map(it => `<button class="learn-link" data-id="${it.id}"><b>${it.label}</b><span>${it.blurb}</span></button>`).join("")
      }</div>`).join("");
    $$("#learnNav .learn-link").forEach(b => b.addEventListener("click", () => this.open(b.dataset.id)));
    this.open("dcf");
  },
  open(id) {
    this.current = id;
    $$("#learnNav .learn-link").forEach(b => b.classList.toggle("active", b.dataset.id === id));
    const t = LEARN_TOPICS[id];
    if (!t) { $("#learnOut").innerHTML = `<div class="empty-mini">Topic not found.</div>`; return; }
    $("#learnTitle").textContent = t.title;
    $("#learnOut").innerHTML = renderLearnTopic(t);
    if (t.bind) t.bind();
  },
};

function renderLearnTopic(t) {
  const sec = (n,title,body) => `<section class="learn-sec"><div class="learn-sh"><span class="learn-sn">${n}</span><h4>${title}</h4></div><div class="learn-sb">${body}</div></section>`;
  return `<div class="learn-doc">
    ${sec(1,"Simple Definition",t.definition)}
    ${sec(2,"Why It Matters",t.why)}
    ${sec(3,"Real-Life Example",t.example)}
    ${sec(4,"Visual Explanation",t.visual)}
    ${sec(5,"Interactive Example",t.interactive)}
    ${sec(6,"Common Mistakes",t.mistakes)}
    ${sec(7,"Related Concepts",t.related)}
  </div>`;
}

/* ══════════════════════ TOPIC CONTENT ══════════════════════ */
const LEARN_TOPICS = {

equity:{title:"Equity Investing Basics",
definition:`<p>A <b>share</b> (also called equity or stock) is fractional ownership of a real business. If a company has 1 crore shares and you buy 100, you own one ten-lakh-th of it — entitled to that share of its profits, assets, and growth over time.</p>
<p><b>Equity investing</b> means buying these ownership slices, expecting the business to become more valuable. When the business grows earnings, the share price typically rises. When it distributes profits, you receive dividends.</p>
<p>Two ways to profit: <b>capital appreciation</b> (share price rises) and <b>dividends</b> (company distributes cash). Most Indian growth companies reinvest rather than paying dividends, so capital appreciation is the primary driver.</p>`,
why:`<p>Over 40 years in India, equity has delivered roughly <b>12–15% per year</b> (Nifty 50), dramatically outperforming alternatives:</p>
<ul><li>₹1 lakh in a savings account for 20 years → <b>₹2.0 lakh</b></li>
<li>₹1 lakh in a fixed deposit for 20 years → <b>₹3.9 lakh</b></li>
<li>₹1 lakh in Nifty 50 for 20 years → <b>₹11.5 lakh</b></li>
<li>₹1 lakh in a top equity MF for 20 years → <b>₹16–27 lakh</b></li></ul>
<p>Why does equity deliver more? Because you own real businesses that grow earnings, hire more people, expand, and raise prices. Savings accounts just lend money at a fixed rate. <b>Businesses compound; deposits don't.</b></p>`,
example:`<p><b>The Infosys story.</b> In 1993, Infosys IPO'd at a price equivalent — adjusted for all splits and bonuses — to about ₹1.50 per share. In 2024 it traded around ₹1,500. That's a 1,000× return over 30 years. ₹10,000 invested = ₹1.5 crore today.</p>
<p><b>The other side:</b> For every Infosys there are dozens that went to zero. Kingfisher Airlines, Unitech, DHFL, Yes Bank. <b>Stock picking is genuinely hard.</b> Most retail investors are better served by Nifty 50 index funds unless willing to do real homework.</p>
<p><b>SIP illustration:</b> ₹5,000/month for 20 years at 12% → ₹49.9 lakh corpus. You invested ₹12 lakh; compounding created the rest.</p>`,
visual:`<div class="learn-table">
<div class="lt-row lt-h"><span>Asset class</span><span>20-yr return</span><span>₹1 lakh becomes</span></div>
<div class="lt-row"><span>Savings account</span><span>3.5% p.a.</span><span>~₹2.0 L</span></div>
<div class="lt-row"><span>Fixed Deposit</span><span>7.0% p.a.</span><span>~₹3.9 L</span></div>
<div class="lt-row"><span>Gold</span><span>9.0% p.a.</span><span>~₹5.6 L</span></div>
<div class="lt-row"><span>Nifty 50 index</span><span>13% p.a.</span><span>~₹11.5 L</span></div>
<div class="lt-row"><span>Top equity MF</span><span>15–18% p.a.</span><span>~₹16–27 L</span></div>
</div><p class="learn-cap">Historical approximations; past performance doesn't guarantee future results.</p>`,
interactive:`<p>The best way to understand SIP compounding is to play with the numbers.</p><button class="btn btn-amber" onclick="showTab('calc');setTimeout(()=>TABS.calc.open('sip'),100)">→ Open SIP Calculator</button>`,
mistakes:`<ul>
<li><b>Treating stocks as lottery tickets.</b> A share is part-ownership of a real business. Price reflects expected future earnings, not a random number.</li>
<li><b>Panic-selling during crashes.</b> Markets fall 20–40% every 5–7 years. Every crash in Indian history was followed by recovery to new highs. Selling at the bottom locks in losses permanently.</li>
<li><b>Concentrating in one or two stocks.</b> Even great companies can fail or commit fraud. Never put more than 10–15% in a single stock.</li>
<li><b>Chasing last year's winners.</b> The sector up 80% last year is often down 30% this year. Performance chasing reliably destroys wealth.</li>
<li><b>Trying to time the market.</b> Time <i>in</i> the market beats <i>timing</i> the market. Missing the 10 best days in a decade can halve your returns.</li>
<li><b>Ignoring costs.</b> A 1% extra expense ratio compounded over 20 years wipes out 15–20% of your wealth.</li></ul>`,
related:`<div class="learn-rel"><a onclick="TABS.learn.open('statements')">Financial Statements</a><a onclick="TABS.learn.open('ratios')">Ratio Analysis</a><a onclick="TABS.learn.open('portfolio')">Portfolio Construction</a><a onclick="TABS.learn.open('risk')">Risk Analysis</a><a onclick="TABS.learn.open('tax')">Tax-Efficient Investing</a></div>`,
},

statements:{title:"Financial Statements",
definition:`<p>Every listed company publishes three financial statements quarterly and annually. Together they are the complete financial picture of a business:</p>
<ul><li><b>Income Statement (P&L)</b> — revenue earned and profit remaining after all costs, over a period</li>
<li><b>Balance Sheet</b> — what the company owns (assets) and owes (liabilities) at a single point in time. The difference is shareholders' equity.</li>
<li><b>Cash Flow Statement</b> — actual cash in and out, split into Operations, Investing, and Financing. The most tamper-resistant of the three.</li></ul>
<p>All three are <b>inter-linked</b>: net profit flows into retained earnings on the balance sheet; cash flow reconciles to profit; capex links to asset values.</p>`,
why:`<p>Without statements, you're investing on price and rumour. Statements reveal:</p>
<ul><li><b>Is it growing?</b> → P&L revenue trends</li>
<li><b>Is it profitable?</b> → P&L gross, operating and net margins</li>
<li><b>Can it survive a downturn?</b> → Balance sheet: cash vs debt</li>
<li><b>Is profit real?</b> → Cash flow vs reported earnings</li>
<li><b>Is someone cooking the books?</b> → Forensic ratios across all three</li></ul>
<p>A business can show increasing profit while heading toward bankruptcy if cash isn't actually coming in. P&L alone misses this; you need all three.</p>`,
example:`<p><b>The cash-vs-profit trap — Vakrangee Ltd (2018).</b> Vakrangee reported explosive revenue and profit growth. The P&L looked incredible. But the cash flow statement showed almost zero operating cash flow — profit was piling up in receivables that never arrived. The stock crashed 90%+.</p>
<p><b>What cash flow told you:</b> If a company earns ₹100 Cr "profit" but generates only ₹10 Cr operating cash, that ₹90 Cr is sitting in uncollected receivables, inflated inventory, or outright fraud. Healthy businesses have <b>cash conversion ≥ 80%</b> (OCF / Net Profit).</p>
<p><b>And the balance sheet:</b> Vakrangee's receivables grew from ₹200 Cr to ₹3,000+ Cr in two years while revenue grew far less — visible in the balance sheet, not just the P&L headline.</p>`,
visual:`<div class="learn-table">
<div class="lt-row lt-h"><span>Statement</span><span>What it tells you</span><span>Key red flags</span></div>
<div class="lt-row"><span>Income Statement</span><span>Revenue growth, margins, earnings</span><span>Margin compression, one-time gains inflating profit</span></div>
<div class="lt-row"><span>Balance Sheet</span><span>Assets, debts, financial stability</span><span>Debt rising faster than equity, falling cash balances</span></div>
<div class="lt-row"><span>Cash Flow</span><span>Real cash generated</span><span>OCF consistently below net profit, rising working capital</span></div>
</div>
<p style="margin-top:10px"><b>Three key checks:</b></p>
<ul><li>Receivables growing faster than revenue? (possible fictitious sales)</li>
<li>OCF / Net Profit ≥ 80%? (earnings quality)</li>
<li>Interest coverage ≥ 4×? (debt safety)</li></ul>`,
interactive:`<p>Meridian's <b>Equity Research</b> tab loads 4 years of all three financial statements for any listed company — with color-coded YoY changes, margin trends, and automatic ratio computation.</p><button class="btn btn-amber" onclick="showTab('research')">→ Open Financial Statements</button>`,
mistakes:`<ul>
<li><b>Only reading the P&L headline.</b> Revenue and profit are most easily manipulated. Cash flow and balance sheet are where the truth hides.</li>
<li><b>Trusting "adjusted EBITDA" blindly.</b> Companies strip out anything inconvenient. Read reported (Ind-AS/GAAP) numbers first.</li>
<li><b>Looking at just one year.</b> One year can be distorted by one-time items. Always look at 3–5 year trends.</li>
<li><b>Skipping notes to accounts.</b> Footnotes disclose related-party transactions, lawsuits, and accounting policy changes. Frauds often hide in notes.</li>
<li><b>Ignoring working capital changes.</b> A company can burn cash building receivables or inventory while showing healthy profits — visible in cash flow.</li>
<li><b>Not understanding D&A.</b> Depreciation is non-cash but reduces profit. High-D&A businesses often look less profitable than they really are.</li></ul>`,
related:`<div class="learn-rel"><a onclick="TABS.learn.open('ratios')">Ratio Analysis</a><a onclick="TABS.learn.open('forensic')">Forensic Accounting</a><a onclick="TABS.learn.open('dcf')">DCF Learning</a><a onclick="TABS.learn.open('valuation')">Valuation Concepts</a></div>`,
},

ratios:{title:"Ratio Analysis",
definition:`<p>Financial ratios compress dense statement data into single comparable numbers. A ratio by itself means little — it's meaningful when compared to <b>the company's own history, industry peers, and sector benchmarks</b>.</p>
<p>Four families:</p>
<ul><li><b>Profitability</b> — Is the business earning well? (ROE, ROCE, net margin, gross margin)</li>
<li><b>Efficiency</b> — Is it using assets well? (Asset turnover, receivables days, inventory days)</li>
<li><b>Leverage / Safety</b> — Is it financially stable? (Debt/Equity, Interest Coverage, Current Ratio)</li>
<li><b>Valuation</b> — Is the stock cheap? (P/E, EV/EBITDA, P/B, PEG, Dividend Yield)</li></ul>`,
why:`<p>Ratios let you compare companies of any size, across time, and against peers. Without them you can't meaningfully compare a ₹500 Cr company to a ₹50,000 Cr one.</p>
<p>Key signals:</p>
<ul><li>ROE consistently above 15% → management creates value above cost of equity</li>
<li>Debt/Equity below 1× → conservative balance sheet</li>
<li>Interest coverage above 4× → earnings comfortably service debt</li>
<li>P/E well above peers without superior growth → potentially overvalued</li></ul>`,
example:`<p><b>HDFC Bank vs ICICI Bank — a ratio comparison:</b></p>
<ul><li><b>ROE:</b> HDFC ~17%, ICICI ~18% — both excellent</li>
<li><b>NIM:</b> HDFC ~4.1%, ICICI ~4.4% — ICICI earns more per rupee lent</li>
<li><b>GNPA:</b> HDFC ~1.2%, ICICI ~2.4% — HDFC has cleaner credit book</li>
<li><b>P/B:</b> HDFC ~3.5×, ICICI ~2.8× — ICICI cheaper per unit of book value</li></ul>
<p><b>Conclusion:</b> ICICI offers better value but HDFC is the safer franchise. Different ratios point to different conclusions — that's why you look at all of them together, not just one.</p>`,
visual:`<div class="learn-table">
<div class="lt-row lt-h"><span>Ratio</span><span>Formula</span><span>What's "good"</span></div>
<div class="lt-row"><span>ROE</span><span>Net Profit / Shareholders Equity</span><span>&gt;15% for most sectors</span></div>
<div class="lt-row"><span>ROCE</span><span>EBIT / (Assets − Current Liabilities)</span><span>&gt;12–15%; above WACC</span></div>
<div class="lt-row"><span>Net Margin</span><span>Net Profit / Revenue</span><span>Sector-dependent: IT 20%+, FMCG 15%+, retail 3–5%</span></div>
<div class="lt-row"><span>Debt / Equity</span><span>Total Debt / Shareholders Equity</span><span>&lt;1× for most; &lt;0.5× conservative</span></div>
<div class="lt-row"><span>Interest Coverage</span><span>EBIT / Interest Expense</span><span>&gt;4× healthy; &lt;1.5× danger</span></div>
<div class="lt-row"><span>P/E</span><span>Market Price / EPS</span><span>Context-dependent; compare within sector</span></div>
<div class="lt-row"><span>EV/EBITDA</span><span>Enterprise Value / EBITDA</span><span>Compare to sector median</span></div>
</div>`,
interactive:`<p>Meridian computes 40+ ratios for any listed stock, benchmarked against peer medians — all in the Equity Research tab.</p><button class="btn btn-amber" onclick="showTab('research')">→ Open Ratio Analysis</button>`,
mistakes:`<ul>
<li><b>Comparing ratios across sectors.</b> A bank's ROE is structurally different from a manufacturer's. Always compare within the same sector.</li>
<li><b>Memorising absolute thresholds.</b> "ROE above 15% is good" — not always. Capital-light tech businesses earn 40–60% ROE. Context matters.</li>
<li><b>Single year only.</b> Use 5-year averages for profitability. A single great year can mislead.</li>
<li><b>Ignoring leverage behind ROE.</b> A company can boost ROE by loading up on debt. Always check D/E ratio alongside ROE.</li>
<li><b>P/E for loss-making companies.</b> Negative earnings make P/E meaningless. Use EV/EBITDA or P/Sales instead.</li>
<li><b>Ignoring PEG.</b> A 30× P/E for a 30% grower (PEG 1.0) is often better value than 12× P/E for a 5% grower (PEG 2.4).</li></ul>`,
related:`<div class="learn-rel"><a onclick="TABS.learn.open('statements')">Financial Statements</a><a onclick="TABS.learn.open('perat')">P/E Deep-Dive</a><a onclick="TABS.learn.open('valuation')">Valuation Concepts</a><a onclick="TABS.learn.open('forensic')">Forensic Accounting</a></div>`,
},

/* ══════ VALUATION ══════ */

valuation:{title:"Valuation Concepts",
definition:`<p><b>Valuation</b> is the process of figuring out what a business is actually worth — the <i>intrinsic value</i> — independent of what the market prices it at today. Three broad approaches:</p>
<ul><li><b>Intrinsic / DCF</b> — model future cash flows and discount to today's rupees. Theoretically sound; sensitive to assumptions.</li>
<li><b>Relative / Multiples</b> — compare P/E, EV/EBITDA, P/B against similar companies. Fast and market-anchored; depends on whether the comparison group is itself fairly priced.</li>
<li><b>Asset-based</b> — value assets at liquidation or replacement cost. Mainly for holding companies, real estate, and distressed situations.</li></ul>`,
why:`<p>Without a valuation framework, you don't know if a ₹500 stock is cheap or expensive. A stock can be cheap at ₹500 (if worth ₹900) or terrifyingly expensive (if worth ₹200). <b>Price tells you nothing without value.</b></p>
<p>Valuation anchors three decisions:</p>
<ul><li><b>Buy</b> — when price is at a meaningful discount to fair value (15–30%+ margin of safety)</li>
<li><b>Hold</b> — when price is near fair value</li>
<li><b>Sell / Trim</b> — when price materially exceeds fair value</li></ul>`,
example:`<p><b>Same number, completely different conclusions.</b> HDFC Bank and Zomato have at various points traded at 50–60× P/E. Does that make them equally expensive?</p>
<ul><li>HDFC Bank at 50× P/E: mature, slow-growing bank with 15% earnings growth. Genuinely expensive for the growth rate.</li>
<li>Zomato at 50× forward P/E: platform growing 40–50% with improving unit economics. The same P/E can be "cheap" if the growth thesis holds.</li></ul>
<p>This is why professionals never rely on one method. Meridian runs seven valuation methods simultaneously and blends them — because the spread between methods is itself information about uncertainty.</p>`,
visual:`<div class="learn-table">
<div class="lt-row lt-h"><span>Method</span><span>Best for</span><span>Main weakness</span></div>
<div class="lt-row"><span>DCF</span><span>Predictable cash flow businesses</span><span>Sensitive to growth & discount rate</span></div>
<div class="lt-row"><span>P/E</span><span>Profitable, growing companies</span><span>Meaningless for loss-makers; ignores leverage</span></div>
<div class="lt-row"><span>EV/EBITDA</span><span>Capital-intensive, cross-capital-structure</span><span>Misses capex differences between companies</span></div>
<div class="lt-row"><span>P/B</span><span>Banks, insurance, asset-heavy</span><span>Book value can be manipulated; useless for asset-light tech</span></div>
<div class="lt-row"><span>PEG</span><span>Growth companies</span><span>Growth estimates are unreliable</span></div>
<div class="lt-row"><span>Dividend Discount</span><span>Mature dividend-paying businesses</span><span>Useless for non-dividend growth companies</span></div>
</div>`,
interactive:`<p>Meridian's <b>Modeling Lab</b> runs all seven methods on any listed company and plots them on a football field — the professional way to visualise valuation range and uncertainty. Blends them 40% DCF / 60% relative into one target price.</p><button class="btn btn-amber" onclick="showTab('models')">→ Open Valuation Methods</button>`,
mistakes:`<ul>
<li><b>Anchoring to the current market price.</b> If you start at ₹500 and work backwards to justify it, you'll almost always find a way. Start with the business, not the price.</li>
<li><b>False precision.</b> "Fair value: ₹3,247.83" is intellectually dishonest. The right output is "₹2,800–3,500 with base case ₹3,100".</li>
<li><b>Relying on a single method.</b> Always cross-check. If DCF says ₹1,200 but every peer trades at ₹600, either your assumptions are too bullish or the market is telling you something.</li>
<li><b>Ignoring margin of safety.</b> Fair value estimates are always wrong. The margin of safety (buying 20–30% below fair value) is your buffer for being wrong.</li>
<li><b>Not stress-testing.</b> Change revenue growth by −5pp. Change WACC by +2%. If the stock is still cheap, it's robust. If it flips to overvalued, the thesis is fragile.</li></ul>`,
related:`<div class="learn-rel"><a onclick="TABS.learn.open('dcf')">DCF Learning</a><a onclick="TABS.learn.open('perat')">P/E Ratio</a><a onclick="TABS.learn.open('moat')">Economic Moats</a><a onclick="TABS.learn.open('ratios')">Ratio Analysis</a></div>`,
},

dcf:{title:"DCF — Discounted Cash Flow",
definition:`<p>DCF stands for <b>Discounted Cash Flow</b>. It's a method for figuring out what a business is really worth today, based on the cash it will generate in the future.</p>
<p>The central idea: <b>₹1 lakh in your hand today is worth more than ₹1 lakh ten years from now.</b> Today's money can earn interest, beat inflation, or be deployed right away. So when we forecast future cash flows, we "discount" them back to today's money using a rate that reflects risk and time preference.</p>
<p>The <b>discount rate</b> (often WACC — Weighted Average Cost of Capital) is how much return you require per year. Higher risk businesses → higher discount rate → lower present value of future cash.</p>`,
why:`<p>DCF answers the most fundamental investing question: <b>what should I pay for this business today?</b> It's how serious investors decide if a stock is overpriced, fairly priced, or a bargain. Without it, valuation is sentiment.</p>
<p>DCF matters especially when:</p>
<ul><li>A company has negative earnings (no P/E to use) but generates cash</li>
<li>You want to value a private business for acquisition or investment</li>
<li>You want to test whether a high P/E growth stock is actually cheap on a 5-year view</li>
<li>You need to decide whether to buy, hold, or sell a listed stock with a margin of safety</li></ul>`,
example:`<p><b>The chai shop example.</b> You're thinking of buying a chai shop for <b>₹10 lakh</b>. It makes <b>₹2 lakh cash profit per year</b> after all expenses. Cash grows at <b>5% per year</b> with inflation. You'll run it for <b>10 years</b>, then sell. You want at least <b>15% return</b> per year (mutual funds give 12%, so chai shop must beat that).</p>
<p>DCF step by step:</p>
<ul><li>Year 1 cash: ₹2,00,000 → PV: ₹2,00,000 ÷ 1.15 = <b>₹1,73,913</b></li>
<li>Year 2 cash: ₹2,10,000 → PV: ₹2,10,000 ÷ 1.15² = <b>₹1,58,793</b></li>
<li>Year 5 cash: ₹2,55,256 → PV: <b>₹1,26,887</b></li>
<li>Year 10 cash: ₹3,25,779 → PV: <b>₹80,513</b></li>
<li>Terminal value (sell for 8× earnings in year 10): ₹26 lakh → PV today: <b>₹6.43 lakh</b></li></ul>
<p>Sum of all PVs ≈ <b>₹12.5 lakh</b>. Seller asking ₹10 lakh. Since ₹12.5L > ₹10L — <b>good buy at 15% hurdle rate.</b></p>`,
visual:`<p>Think of DCF as <b>shrinking</b> future rupees back to today's size. The further out, the more they shrink:</p>
<div class="learn-viz">
<div class="lv-row"><span class="lv-yr">Year 1</span><div class="lv-bar lv-future" style="width:90%"></div><div class="lv-bar lv-today" style="width:78%"></div><span class="lv-v">₹2.00L → ₹1.74L</span></div>
<div class="lv-row"><span class="lv-yr">Year 3</span><div class="lv-bar lv-future" style="width:100%"></div><div class="lv-bar lv-today" style="width:59%"></div><span class="lv-v">₹2.32L → ₹1.31L</span></div>
<div class="lv-row"><span class="lv-yr">Year 5</span><div class="lv-bar lv-future" style="width:115%"></div><div class="lv-bar lv-today" style="width:50%"></div><span class="lv-v">₹2.55L → ₹1.27L</span></div>
<div class="lv-row"><span class="lv-yr">Year 10</span><div class="lv-bar lv-future" style="width:145%"></div><div class="lv-bar lv-today" style="width:36%"></div><span class="lv-v">₹3.26L → ₹0.81L</span></div>
</div>
<p class="learn-cap"><span style="color:#c8862a">■</span> nominal future cash &nbsp;·&nbsp; <span style="color:#3a6ea5">■</span> present value at 15% discount rate</p>`,
interactive:`<p>Meridian's <b>Modeling Lab</b> builds a full 17-section institutional DCF for any listed company — live data, editable assumptions, sensitivity tables, and a 5,000-run Monte Carlo simulation.</p><button class="btn btn-amber" onclick="showTab('models')">→ Open Modeling Lab</button>`,
mistakes:`<ul>
<li><b>Picking a discount rate from thin air.</b> Use actual risk premium: startups 25–40%, listed small/mid-caps 14–18%, large-cap blue-chips 10–12%. Too low a rate makes everything look cheap.</li>
<li><b>Projecting too far at high growth.</b> Beyond 7–10 years your forecasts are speculation. Use a terminal value with 3–5% perpetuity growth.</li>
<li><b>Treating DCF output as exact truth.</b> Change revenue growth by 2pp — output often swings 30%. Always present a range (bear/base/bull).</li>
<li><b>Forgetting to subtract net debt.</b> DCF gives enterprise value. Subtract net debt (total debt minus cash) to get equity value, divide by shares for per-share value.</li>
<li><b>Using reported profit instead of free cash flow.</b> DCF uses FCFF, not net profit. High-capex businesses have FCF far below profits — ignoring this leads to massive overvaluation.</li></ul>`,
related:`<div class="learn-rel"><a onclick="TABS.learn.open('valuation')">Valuation Concepts</a><a onclick="TABS.learn.open('perat')">P/E Ratio</a><a onclick="TABS.learn.open('moat')">Economic Moats</a><a onclick="TABS.learn.open('risk')">Risk Analysis</a></div>`,
},

perat:{title:"P/E Ratio Deep-Dive",
definition:`<p>The <b>Price-to-Earnings ratio</b> tells you: <b>how many rupees are you paying for every ₹1 of annual profit?</b></p>
<p><code>P/E = Share price ÷ Earnings per share (EPS)</code></p>
<p>If a stock trades at ₹500 and earns ₹20/share annually, P/E = 25×. You're paying ₹25 today for every ₹1 of annual profit.</p>
<p>Variants matter: <b>Trailing P/E</b> uses last 12 months' actual earnings. <b>Forward P/E</b> uses next 12 months' consensus estimate. Forward P/E is usually lower (growth expected) and more actionable for investors.</p>`,
why:`<p>P/E is the most-used valuation number for two reasons: it's fast, and it normalises for company size. You can instantly compare a ₹500 Cr company and a ₹5 lakh Cr company.</p>
<p>P/E also <b>encodes the market's collective expectation</b> about future growth. A 40× P/E company where earnings disappoint often falls to 20× — meaning flat earnings produce a −50% stock return. This is the "P/E de-rating" risk.</p>
<p><b>The PEG ratio</b> corrects for growth: PEG = P/E ÷ annual earnings growth rate. Under 1.0 usually attractive. A 40× P/E with 40% growth = PEG 1.0 (fair). A 15× P/E with 5% growth = PEG 3.0 (expensive).</p>`,
example:`<p><b>Two restaurants, same earnings, different P/Es:</b></p>
<p>Both earn ₹50 lakh profit. Restaurant A valued at ₹10 Cr (P/E 20×). Restaurant B valued at ₹25 Cr (P/E 50×). B looks expensive. But:</p>
<ul><li>Restaurant A: single location, saturated neighbourhood, flat growth</li>
<li>Restaurant B: franchise model, opening 15 new outlets this year, 35% profit growth</li></ul>
<p>B's PEG = 50 ÷ 35 = 1.4× — borderline fair. A's PEG = 20 ÷ 2 = 10× — extremely expensive for its growth.</p>
<p>Real markets work the same way. <b>Zomato at 80× P/E</b> (growing 50%/year) can be better value than <b>a PSU bank at 5× P/E</b> (growing 3%/year, declining franchise). P/E is the starting point, not the conclusion.</p>`,
visual:`<div class="learn-table">
<div class="lt-row lt-h"><span>P/E Range</span><span>Typical reading</span><span>Common sectors</span></div>
<div class="lt-row"><span>Under 8×</span><span>Deep value, distressed, or declining</span><span>PSUs, commodity down-cycles</span></div>
<div class="lt-row"><span>8–15×</span><span>Fair value for stable, low-growth</span><span>Large auto, mature banks</span></div>
<div class="lt-row"><span>15–25×</span><span>Quality at fair price</span><span>FMCG, large IT, private banks</span></div>
<div class="lt-row"><span>25–50×</span><span>Growth premium</span><span>Specialty chemicals, platform tech</span></div>
<div class="lt-row"><span>50–100×</span><span>High-growth expectation</span><span>New-age tech, fast-scaling platforms</span></div>
<div class="lt-row"><span>Over 100×</span><span>Speculative</span><span>Early-stage listed startups</span></div>
</div>`,
interactive:`<p>Open <b>Equity Research</b> in Meridian — the Ratio Analysis panel shows trailing P/E, forward P/E, PEG, and how they compare to the peer median.</p><button class="btn btn-amber" onclick="showTab('research')">→ See P/E in Equity Research</button>`,
mistakes:`<ul>
<li><b>Comparing P/Es across sectors.</b> A 15× bank is not a 15× IT company. Sectors have structurally different fair P/Es.</li>
<li><b>Trusting "low P/E = cheap" blindly.</b> Stocks can deserve low P/Es — structural decline, poor management, existential competition. A 5× value trap is worse than a 30× quality compounder.</li>
<li><b>Ignoring quality of earnings.</b> If earnings include one-time gains (asset sales, tax adjustments), P/E looks artificially low. Always check what's in the "E".</li>
<li><b>Using P/E on loss-making companies.</b> Negative earnings make P/E meaningless. Use EV/Revenue or EV/EBITDA instead.</li>
<li><b>Not adjusting for cycles.</b> Commodity companies have very low P/Es at peak earnings (just before a crash). Cycle-adjusted P/E is more reliable.</li></ul>`,
related:`<div class="learn-rel"><a onclick="TABS.learn.open('ratios')">Ratio Analysis</a><a onclick="TABS.learn.open('valuation')">Valuation Concepts</a><a onclick="TABS.learn.open('dcf')">DCF</a><a onclick="TABS.learn.open('moat')">Economic Moats</a></div>`,
},

moat:{title:"Economic Moats",
definition:`<p>An <b>economic moat</b> is what protects a business from competition over a sustained period — like the water-filled moat around a medieval castle. The wider the moat, the longer the company earns above-average profits without competitors stealing them.</p>
<p>Term popularised by Warren Buffett. The key insight: <b>in capitalism, high profits attract competitors who eventually compete profits back to normal.</b> A moat delays or prevents this.</p>
<p>Moats are measured by <b>persistence of returns</b>. A business earning 22% ROCE for 15 consecutive years almost certainly has one — sustainable returns above cost of capital don't happen by accident.</p>`,
why:`<p>Moats determine whether a high P/E is justified or dangerous:</p>
<ul><li>A moaty business at 35× P/E can be a great investment — the moat lets it compound at high returns for years, growing into and past the valuation.</li>
<li>A commodity business at 8× P/E can be a trap — without a moat, competition compresses returns and the stock goes nowhere.</li></ul>
<p>Buffett's insight: <b>it's far better to buy a wonderful company at a fair price than a fair company at a wonderful price.</b> "Wonderful" means: wide moat, excellent returns on capital, competitive position that persists.</p>`,
example:`<p><b>Five moat types with Indian examples:</b></p>
<ul><li><b>Network Effects — UPI / WhatsApp / Zomato:</b> Each new user makes the service more valuable to all existing users. Competitors can't break in because the network itself is the product.</li>
<li><b>Switching Costs — TCS / SAP / Banks:</b> Once your organisation runs on SAP or a specific bank's software, switching is painful and expensive. TCS and Infosys earn high, sticky revenue from long-term IT contracts clients rarely break.</li>
<li><b>Brand — Asian Paints / Tata / Surf Excel:</b> Consumers pay a premium and show loyalty. Asian Paints commands a 20–25% price premium vs unbranded paint and has held 50%+ Indian market share for 30+ years.</li>
<li><b>Cost Advantage — Reliance / Cement companies:</b> If you're the lowest-cost producer, you can price competitors out or earn better margins at the same price.</li>
<li><b>Intangible Assets — CRISIL / BSE / Specialty Pharma:</b> Patents, regulatory licences. BSE and NSE's exchange licences are effectively permanent moats — you can't start a competing exchange without multi-year regulatory approval.</li></ul>`,
visual:`<div class="learn-table">
<div class="lt-row lt-h"><span>Moat type</span><span>Durability</span><span>Indian examples</span></div>
<div class="lt-row"><span>Network effects</span><span>Very high — grows stronger with scale</span><span>UPI, exchanges, WhatsApp</span></div>
<div class="lt-row"><span>Switching costs</span><span>High — but tech can disrupt</span><span>TCS, banks, SAP implementations</span></div>
<div class="lt-row"><span>Brand</span><span>High if category is habitual</span><span>Asian Paints, Tata, Surf Excel</span></div>
<div class="lt-row"><span>Cost advantage</span><span>Moderate — scale can shift</span><span>Reliance, ACC Cement, Hindalco</span></div>
<div class="lt-row"><span>Intangible assets</span><span>High if regulatory, lower if patent-only</span><span>CRISIL, BSE, specialty pharma</span></div>
</div>`,
interactive:`<p>Meridian's <b>Equity Research</b> tab computes a deterministic Moat Scorecard — rating each moat source (Wide / Narrow / None) from financial fingerprints like ROCE persistence and gross margin durability.</p><button class="btn btn-amber" onclick="showTab('research')">→ See the Economic Moat panel</button>`,
mistakes:`<ul>
<li><b>Assuming moats are permanent.</b> Kodak had a moat. Nokia had a moat. Both were destroyed by technology shifts. Revisit moat assessments at least annually.</li>
<li><b>Confusing brand awareness with brand moat.</b> Everyone knows VIP luggage (awareness). But people buy Samsonite without loyalty cost. Asian Paints genuinely has a brand moat; VIP has limited pricing power.</li>
<li><b>Paying any price for moaty stocks.</b> Even the best business has a price at which it's a bad investment. Asian Paints at 90× P/E is dangerous regardless of moat.</li>
<li><b>Ignoring moat erosion.</b> Telecom was once a moaty industry (spectrum + infrastructure). Jio's capital blitz destroyed profits for everyone. Check every 1–2 years whether the moat is widening or eroding.</li></ul>`,
related:`<div class="learn-rel"><a onclick="TABS.learn.open('valuation')">Valuation Concepts</a><a onclick="TABS.learn.open('industry')">Industry Analysis</a><a onclick="TABS.learn.open('forensic')">Forensic Accounting</a><a onclick="TABS.learn.open('governance')">Corporate Governance</a></div>`,
},

/* ══════ ANALYSIS ══════ */

industry:{title:"Industry Analysis",
definition:`<p><b>Industry analysis</b> is the process of understanding the structural economics and competitive dynamics of the sector a business operates in. The key insight: <b>a great company in a terrible industry usually loses to a mediocre company in a great industry</b> — because industry structure determines how much profit is available to be earned.</p>
<p>The classic framework is <b>Porter's Five Forces</b>, developed by Michael Porter at Harvard. The model scores five competitive pressures:</p>
<ul><li>Rivalry among existing competitors</li>
<li>Threat of new entrants</li>
<li>Bargaining power of suppliers</li>
<li>Bargaining power of buyers</li>
<li>Threat of substitute products</li></ul>`,
why:`<p>Industry structure determines the <b>return on invested capital floor</b> — the minimum sustainable return. In terrible industries (airlines, retail, commodity chemicals), even well-run companies struggle to earn above their cost of capital. In excellent industries (exchanges, ratings, premium consumer brands), even mediocre operators earn handsome returns.</p>
<p>Before analysing a single company, ask: <b>what is the base rate of success in this industry?</b> If most companies earn 8% returns and your cost of capital is 12%, you're starting with a headwind regardless of which company you pick.</p>`,
example:`<p><b>Indian airlines vs Indian exchanges — the two extremes:</b></p>
<p><b>Airlines</b> (terrible industry economics):</p>
<ul><li>5+ direct competitors, price-sensitive customers, near-zero switching cost</li>
<li>Suppliers (Boeing/Airbus, jet fuel, airports) have enormous bargaining power</li>
<li>Substitute: trains on short routes</li>
<li>Result: IndiGo dominates with 60% market share — and still earns thin margins. Every other Indian airline has lost money at some point.</li></ul>
<p><b>Exchanges</b> (excellent industry economics):</p>
<ul><li>BSE and NSE have regulatory duopoly — no new entrants possible</li>
<li>Customers (brokers) have no alternative for equity listing/trading</li>
<li>Suppliers minimal (tech infrastructure)</li>
<li>Result: NSE earns 50–60% EBITDA margins and 40%+ ROE consistently</li></ul>`,
visual:`<p>Porter's Five Forces — score 1 (favourable to incumbents) to 5 (threatening):</p>
<div class="learn-table">
<div class="lt-row lt-h"><span>Force</span><span>Airlines (bad)</span><span>Exchange (good)</span></div>
<div class="lt-row"><span>Competitive rivalry</span><span>5 — intense price war</span><span>1 — regulated duopoly</span></div>
<div class="lt-row"><span>New entrant threat</span><span>4 — Akasa launched 2022</span><span>1 — licence barrier</span></div>
<div class="lt-row"><span>Supplier power</span><span>5 — Boeing, fuel, airports</span><span>2 — commodity tech</span></div>
<div class="lt-row"><span>Buyer power</span><span>5 — lowest fare wins</span><span>1 — captive customers</span></div>
<div class="lt-row"><span>Substitute threat</span><span>3 — trains, video calls</span><span>1 — nothing replaces</span></div>
</div>`,
interactive:`<p>Meridian's <b>Market Intelligence</b> tab computes a Porter's Five Forces scorecard for any sector — auto-derived from observed industry structure (concentration, margins, peer count).</p><button class="btn btn-amber" onclick="showTab('markets')">→ Open Industry Analysis</button>`,
mistakes:`<ul>
<li><b>Falling in love with "growth industries".</b> E-commerce was a massive growth industry for 15 years. Amazon made billions; most competitors lost billions. Growth ≠ returns for investors.</li>
<li><b>Static analysis.</b> Industries change. Telecom was a moaty industry until Jio. Retail was stable until e-commerce. Ask: what could structurally change this industry in 5 years?</li>
<li><b>Ignoring regulatory risk.</b> Insurance, banking, pharma pricing, telecom spectrum — industries shaped by government policy can be transformed by a single regulation.</li>
<li><b>Confusing industry growth with industry profitability.</b> A growing pie isn't worth much if everyone gets a slice with more competition.</li></ul>`,
related:`<div class="learn-rel"><a onclick="TABS.learn.open('moat')">Economic Moats</a><a onclick="TABS.learn.open('risk')">Risk Analysis</a><a onclick="TABS.learn.open('valuation')">Valuation</a><a onclick="TABS.learn.open('macro')">Macroeconomics</a></div>`,
},

risk:{title:"Risk Analysis",
definition:`<p>In investing, <b>risk</b> is the possibility that the actual return is worse than expected — up to and including total loss. It's emphatically not the same as short-term price volatility, though the two are often conflated.</p>
<p>Key risk measures:</p>
<ul><li><b>Volatility</b> — how much the price swings day-to-day or year-to-year</li>
<li><b>Beta</b> — how much the stock moves relative to the overall market. Beta 1.5 = stock moves 1.5× the market.</li>
<li><b>Maximum Drawdown</b> — the worst peak-to-trough loss ever experienced. Tells you the "worst case you'd have lived through".</li>
<li><b>Value at Risk (VaR)</b> — maximum expected loss over a period at a given confidence level</li>
<li><b>Sharpe Ratio</b> — return per unit of volatility. Higher is better.</li></ul>`,
why:`<p>Return without context of risk is meaningless. A stock that returned 25% last year with 60% volatility and a 50% drawdown is not better than one that returned 16% with 15% volatility and a 15% drawdown.</p>
<p>Three risk rules that matter most:</p>
<ul><li><b>Never risk ruin.</b> No single investment should be able to destroy your portfolio.</li>
<li><b>Volatility is temporary; permanent loss is not.</b> Markets recovering means nothing if you sold at the bottom.</li>
<li><b>Leverage amplifies everything — including losses.</b> A 50% loss requires a 100% gain to recover. Avoid leverage unless you truly understand it.</li></ul>`,
example:`<p><b>The 2008 experience in India:</b> Nifty 50 fell from 6,357 (Jan 2008) to 2,524 (Oct 2008) — a 60% peak-to-trough drawdown in 9 months. An investor with ₹10 lakh saw it become ₹4 lakh.</p>
<p>What happened to different approaches:</p>
<ul><li><b>The panic seller</b> at ₹4 lakh → locked in 60% loss. By 2012 Nifty recovered to 6,000; they missed the entire recovery.</li>
<li><b>The "don't look at prices" holder</b> → ₹10 lakh recovered to ₹10 lakh by 2012 and grew to ₹24 lakh by 2016.</li>
<li><b>The SIP investor</b> who kept buying during the crash → average cost dropped sharply; they did better than both above.</li></ul>
<p><b>The lesson:</b> The greatest risk isn't market volatility — it's your behavioural response to it.</p>`,
visual:`<div class="learn-table">
<div class="lt-row lt-h"><span>Risk type</span><span>Diversifiable?</span><span>Example</span></div>
<div class="lt-row"><span>Market risk (systematic)</span><span>No — affects all stocks</span><span>2008 crash, COVID, war</span></div>
<div class="lt-row"><span>Company-specific risk</span><span>Yes — hold 15–25 stocks</span><span>Fraud, management failure, losing a key client</span></div>
<div class="lt-row"><span>Sector risk</span><span>Partially — across sectors</span><span>RBI rate hike hits all NBFCs</span></div>
<div class="lt-row"><span>Liquidity risk</span><span>Partially — use large-caps</span><span>Small-cap you can't sell at need</span></div>
<div class="lt-row"><span>Leverage risk</span><span>Yes — don't borrow to invest</span><span>Margin call forces selling at the worst time</span></div>
</div>`,
interactive:`<p>Meridian's <b>Risk Center</b> computes a composite risk score (0–100) for any listed company — combining beta, volatility, max drawdown, leverage, and 12 other factors.</p><button class="btn btn-amber" onclick="showTab('risk')">→ Open Risk Center</button>`,
mistakes:`<ul>
<li><b>Equating short-term volatility with risk.</b> A 20% drawdown in a quality business is an opportunity, not a risk. The real risk is buying a business you don't understand at any price.</li>
<li><b>Under-diversifying.</b> Holding 2–3 stocks concentrates company-specific risk. 15–20 across sectors removes most idiosyncratic risk.</li>
<li><b>Ignoring correlation.</b> Ten IT stocks aren't 10 different bets. In a sector correction, they all fall together. True diversification requires low correlation between holdings.</li>
<li><b>Using stop-losses mechanically.</b> In illiquid or volatile stocks, stop-losses trigger at exactly the wrong moment. They work in liquid large-caps; in small-caps they hurt.</li>
<li><b>Borrowing to invest.</b> The single most reliable way to get wiped out. A 50% market decline + 2× leverage = 100% loss. There is no recovery from zero.</li></ul>`,
related:`<div class="learn-rel"><a onclick="TABS.learn.open('portfolio')">Portfolio Construction</a><a onclick="TABS.learn.open('forensic')">Forensic Accounting</a><a onclick="TABS.learn.open('technical')">Technical Analysis</a><a onclick="TABS.learn.open('macro')">Macroeconomics</a></div>`,
},

forensic:{title:"Forensic Accounting",
definition:`<p><b>Forensic accounting</b> is the science of detecting financial statement manipulation — using publicly available data to identify signs that a company may be misrepresenting its financials. It doesn't require inside information; every signal comes from numbers the company itself reports.</p>
<p>Three quantitative models dominate:</p>
<ul><li><b>Piotroski F-Score</b> (0–9): 9 binary tests across profitability, leverage, and efficiency. Score ≥7 = financially healthy. Score ≤2 = potential short/avoid.</li>
<li><b>Altman Z-Score</b>: Predicts bankruptcy probability. Z &gt;2.99 = safe; 1.81–2.99 = grey zone; &lt;1.81 = distress.</li>
<li><b>Beneish M-Score</b>: 8 financial ratios flagging earnings manipulation. M &lt;−2.22 = unlikely manipulator; M &gt;−1.78 = high manipulation risk.</li></ul>`,
why:`<p>Accounting fraud destroys shareholder wealth completely. Satyam, Yes Bank (near-zero), Unitech, Manpasand Beverages, Vakrangee, IL&FS — the Indian fraud list is long and the pattern consistent: aggressive revenue recognition, receivables growing faster than sales, promoter pledging, CFO turnover.</p>
<p>The remarkable thing: <b>most frauds are detectable years before they explode</b> using published financial statements. Beneish flagged Satyam. Piotroski scores flagged Yes Bank. Forensic tools are not perfect but catch the majority of major frauds if you run them routinely.</p>`,
example:`<p><b>How Beneish would have saved you from Satyam (2007–2009):</b></p>
<p>Ramalinga Raju confessed to the Satyam fraud in January 2009. But running Beneish M-Score on Satyam's 2007 annual report would have shown:</p>
<ul><li><b>Days Sales Receivables Index (DSRI):</b> Receivables growing significantly faster than revenue — classic sign of fictitious sales</li>
<li><b>Asset Quality Index (AQI):</b> Non-current assets inflating, suggesting capitalisation of expenses</li>
<li><b>Total Accruals to Total Assets (TATA):</b> High accruals — earnings not backed by cash</li>
<li><b>M-Score result: above −1.78</b> → high manipulation flag</li></ul>
<p>An investor running this check in late 2007 would have been warned 15 months before the public revelation — and avoided a 99% loss.</p>`,
visual:`<div class="learn-table">
<div class="lt-row lt-h"><span>Model</span><span>What it detects</span><span>Signal to worry</span></div>
<div class="lt-row"><span>Beneish M-Score</span><span>Earnings manipulation probability</span><span>M-Score &gt; −1.78</span></div>
<div class="lt-row"><span>Altman Z-Score</span><span>Bankruptcy risk</span><span>Z &lt; 1.81</span></div>
<div class="lt-row"><span>Piotroski F-Score</span><span>Financial strength trend</span><span>Score ≤ 2</span></div>
<div class="lt-row"><span>Cash conversion</span><span>Are profits real?</span><span>OCF / Net Profit &lt; 60% consistently</span></div>
<div class="lt-row"><span>Promoter pledging</span><span>Promoter financial stress</span><span>&gt;50% of promoter shares pledged</span></div>
</div>`,
interactive:`<p>Meridian's <b>Forensic Analysis</b> tab computes all three models for any listed company — with all 22 sub-components shown transparently so you can see exactly why a score is high or low.</p><button class="btn btn-amber" onclick="showTab('forensic')">→ Open Forensic Analysis</button>`,
mistakes:`<ul>
<li><b>Treating a red flag as proof of fraud.</b> High Beneish and low Piotroski are warning signals, not verdicts. Many legitimate growing businesses trigger flags. Use forensics to prompt deeper investigation, not to automatically sell.</li>
<li><b>Skipping forensics on "respected" companies.</b> Satyam had a PWC audit and was a BSE bluechip. Forensic tools don't trust reputation; they trust numbers.</li>
<li><b>Ignoring promoter pledging.</b> Pledging over 50% of promoter shares is a significant red flag — promoter is borrowing money against equity. If stock falls, lenders sell pledged shares creating a death spiral.</li>
<li><b>Looking at only one year.</b> Most manipulations build gradually. Run models on 3–5 years and look for deteriorating trends.</li></ul>`,
related:`<div class="learn-rel"><a onclick="TABS.learn.open('statements')">Financial Statements</a><a onclick="TABS.learn.open('ratios')">Ratio Analysis</a><a onclick="TABS.learn.open('governance')">Corporate Governance</a><a onclick="TABS.learn.open('risk')">Risk Analysis</a></div>`,
},

technical:{title:"Technical Analysis",
definition:`<p><b>Technical analysis</b> is the study of price and volume data — charts, patterns, and indicators — to forecast future price movements. It operates on the hypothesis that all available information is already reflected in price, and that price movements follow recognisable patterns that tend to repeat.</p>
<p>Key tools:</p>
<ul><li><b>Price charts:</b> Candlestick, OHLC, line. Each candlestick shows Open, High, Low, Close.</li>
<li><b>Trend lines:</b> Support (price floor) and resistance (price ceiling) levels</li>
<li><b>Moving averages:</b> Simple (SMA) and Exponential (EMA) — smooth noise to reveal trend</li>
<li><b>Momentum indicators:</b> RSI, MACD, Stochastic — measure strength and speed of moves</li>
<li><b>Volume:</b> The conviction factor — price moves on high volume are more reliable</li></ul>`,
why:`<p>Technical analysis is most useful for three practical purposes:</p>
<ul><li><b>Entry timing:</b> Even with strong fundamental conviction, TA can help you enter at a better price.</li>
<li><b>Stop-loss placement:</b> Technical levels (support, moving averages) give logical stop-loss placements based on price structure, not arbitrary percentages.</li>
<li><b>Short-term trading:</b> Traders without a fundamental edge use price patterns and momentum to trade.</li></ul>
<p>Important caveat: <b>academic evidence on TA is weak.</b> Most published patterns don't persist after wide knowledge — they get arbitraged away. TA is a supplementary tool, not a standalone edge.</p>`,
example:`<p><b>The 200-day moving average — India's most-watched level:</b></p>
<p>The 200-day SMA averages closing prices over the last 200 trading days. It's widely considered the dividing line between bull and bear markets for Nifty 50:</p>
<ul><li><b>Price above 200-DMA:</b> Broad uptrend; most professional funds consider this "risk-on"</li>
<li><b>Price crosses below 200-DMA:</b> Trend may be turning; FIIs and institutions often reduce exposure</li>
<li><b>200-DMA itself rising:</b> Long-term uptrend intact even with short-term corrections</li></ul>
<p>In March 2020 (COVID crash), Nifty broke below 200-DMA dramatically. TA traders sold. Market reversed immediately — showing both the utility (signal was correct about downtrend) and the limitation (recovery was faster than any model predicted). Fundamental investors who held through it did better.</p>`,
visual:`<div class="learn-table">
<div class="lt-row lt-h"><span>Indicator</span><span>What it measures</span><span>Common use</span></div>
<div class="lt-row"><span>RSI (14)</span><span>Momentum — overbought / oversold?</span><span>&gt;70 = overbought; &lt;30 = oversold</span></div>
<div class="lt-row"><span>MACD</span><span>Trend direction and momentum shifts</span><span>Bullish crossover = potential buy signal</span></div>
<div class="lt-row"><span>50 / 200-DMA</span><span>Medium / long-term trend</span><span>"Golden cross" (50 above 200) = bullish</span></div>
<div class="lt-row"><span>Bollinger Bands</span><span>Volatility and range</span><span>Price at lower band = potential reversal</span></div>
<div class="lt-row"><span>Volume</span><span>Conviction behind moves</span><span>Breakout on high volume = more reliable</span></div>
</div>`,
interactive:`<p>Meridian's Market Intelligence shows live charts for major indices. For individual stocks, open Equity Research and the Overview panel shows 1Y price history.</p><button class="btn btn-amber" onclick="showTab('markets')">→ Open Market Intelligence</button>`,
mistakes:`<ul>
<li><b>Using TA as a standalone system without fundamentals.</b> A stock in a perfect technical setup can collapse on undisclosed fraud, debt crisis, or sector disruption. Always know what you own.</li>
<li><b>Over-fitting patterns.</b> After the fact, you can find patterns in any chart. The test is whether the pattern predicts forward — most don't.</li>
<li><b>Ignoring volume.</b> A breakout on low volume is far less reliable than one on 3× average volume. Volume is conviction.</li>
<li><b>Moving stop-losses downward.</b> If you placed a stop at ₹450 based on a technical level and price threatens it, lowering the stop to ₹420 defeats the entire purpose.</li>
<li><b>Using same indicator family twice.</b> RSI and Stochastic are both momentum oscillators — using both doesn't double information. Use indicators from different families.</li></ul>`,
related:`<div class="learn-rel"><a onclick="TABS.learn.open('risk')">Risk Analysis</a><a onclick="TABS.learn.open('macro')">Macroeconomics</a><a onclick="TABS.learn.open('portfolio')">Portfolio Construction</a></div>`,
},

macro:{title:"Macroeconomics & Markets",
definition:`<p><b>Macroeconomics</b> studies the economy as a whole — GDP growth, inflation, interest rates, currency, unemployment — and how these variables interact. For investors, macro matters because it sets the environment in which all businesses operate.</p>
<p>The four variables that most directly move markets:</p>
<ul><li><b>Interest rates</b> — the price of money. RBI's repo rate determines borrowing costs and sets the "risk-free rate" against which every valuation is measured.</li>
<li><b>Inflation</b> — rising prices erode real returns, force central banks to raise rates, squeeze consumer spending.</li>
<li><b>GDP growth</b> — economic expansion drives corporate revenues. India's 6–7% real GDP growth is the bedrock of its equity bull market.</li>
<li><b>Currency</b> — weaker rupee helps exporters (IT, pharma), hurts importers (oil, hardware).</li></ul>`,
why:`<p>Macro is the tide that raises or lowers all boats. In a rising rate environment (RBI hiking 4% → 6.5% in 2022–23), even great businesses saw valuations compressed — higher rates mean DCF values fall and credit becomes more expensive. In a falling rate environment, valuations expand and credit-sensitive sectors (real estate, NBFCs, autos) re-rate sharply.</p>
<p>Understanding macro doesn't mean predicting it — it means understanding <b>which sectors are tailwinds and which are headwinds</b> in the current environment. This shapes sector allocation.</p>`,
example:`<p><b>The 2022–23 rate cycle and Indian markets:</b></p>
<ul><li>Inflation (CPI) peaked at 7.8% in April 2022 — above RBI's 6% upper tolerance</li>
<li>RBI raised repo rate from 4.0% → 6.5% in 8 months (fastest in 20 years)</li>
<li><b>Impact:</b> Expensive growth stocks (P/E 80–100×) fell 40–60% — higher rates made distant future cash flows worth less today</li>
<li><b>But not uniformly:</b> Banks and NBFCs benefited (higher lending rates → better margins). IT exporters benefited (weaker rupee). Rate-sensitive sectors (real estate, auto) struggled initially.</li></ul>
<p><b>The lesson:</b> You don't need to predict that RBI would raise rates. You just need to know that if rates rise, valuations compress and rate-sensitive sectors struggle — and to be less exposed going in.</p>`,
visual:`<div class="learn-table">
<div class="lt-row lt-h"><span>Macro shift</span><span>Who benefits</span><span>Who gets hurt</span></div>
<div class="lt-row"><span>Rates rising</span><span>Banks, FDs, short-duration debt</span><span>High-PE growth, real estate, NBFCs</span></div>
<div class="lt-row"><span>Rates falling</span><span>Real estate, autos, NBFCs, growth stocks</span><span>Banks (NIM compression), savers</span></div>
<div class="lt-row"><span>Rupee weakening</span><span>IT exporters, pharma, metals</span><span>Oil importers, aviation, consumer electronics</span></div>
<div class="lt-row"><span>Inflation rising</span><span>Commodity producers, pricing-power brands</span><span>Margin-thin businesses, fixed-income investors</span></div>
<div class="lt-row"><span>GDP acceleration</span><span>Cyclicals, autos, capex-plays, banks</span><span>Defensives may underperform relatively</span></div>
</div>`,
interactive:`<p>Meridian's <b>Macro Indicators</b> panel in Market Intelligence shows live snapshots of Indian and global indices, USD/INR, US 10Y yields, Gold, Crude Oil, Bitcoin, and VIX.</p><button class="btn btn-amber" onclick="showTab('markets')">→ Open Macro Indicators</button>`,
mistakes:`<ul>
<li><b>Trying to time macro.</b> Even professional economists with models and teams consistently mis-predict recession timing and rate peaks. Tactical macro trading is hard; structural macro awareness is useful.</li>
<li><b>Ignoring the rupee.</b> India runs a current account deficit and is an oil importer. Weak rupee + high oil is a toxic combination — raises inflation, constrains RBI, compresses corporate margins.</li>
<li><b>Treating FII flows as fundamental.</b> Foreign Institutional Investors move on global risk sentiment, not India-specific fundamentals. FII selling doesn't make a business worse; it makes stocks cheaper.</li>
<li><b>Confusing GDP and stock returns.</b> China had 7%+ GDP growth for 20 years; Chinese equity investors made very little. Stock returns depend on earnings growth and valuations, not just economic growth.</li></ul>`,
related:`<div class="learn-rel"><a onclick="TABS.learn.open('risk')">Risk Analysis</a><a onclick="TABS.learn.open('industry')">Industry Analysis</a><a onclick="TABS.learn.open('technical')">Technical Analysis</a><a onclick="TABS.learn.open('tax')">Tax-Efficient Investing</a></div>`,
},

/* ══════ STARTUP & ESOP ══════ */

esop:{title:"ESOP — Employee Stock Options",
definition:`<p>An <b>ESOP (Employee Stock Option Plan)</b> gives you the <b>right — but not the obligation — to buy</b> shares of your employer at a predetermined fixed price called the <b>strike price</b>, after a specified vesting period.</p>
<p>You're not given shares outright. You're given an <i>option</i> to purchase them later:</p>
<ul><li>If share price rises above strike → exercise (buy at strike), own shares worth more, sell for profit</li>
<li>If share price stays below strike → simply don't exercise; option expires worthless. You don't lose money (just opportunity cost)</li></ul>
<p>In practice, most startup ESOPs are on unlisted equity — so "selling" requires either an IPO, acquisition, or a secondary sale, which may not happen for years.</p>`,
why:`<p>ESOPs are one of the most powerful but misunderstood forms of compensation:</p>
<ul><li><b>For employees at successful startups:</b> Flipkart, Zomato, Nykaa, Freshworks created hundreds of crorepatis through ESOPs. Early employees who understood and held built generational wealth.</li>
<li><b>Alignment:</b> ESOPs tie your outcome to the company's success — when the company does well, so do you.</li>
<li><b>Retention tool:</b> Vesting means you forfeit unvested options if you leave early, incentivising staying.</li></ul>
<p>The problem: <b>most employees don't understand ESOPs</b>, fail to negotiate them, forget cliff dates, don't plan for tax, and miss liquidity windows.</p>`,
example:`<p><b>Your first ESOP grant — walking through the math:</b></p>
<p>You join a Series B startup as employee #75. Offer: <b>4,000 options, strike ₹100, 4-year vesting, 1-year cliff.</b> Current 409A / FMV valuation implies ₹500 per share.</p>
<ul><li><b>Month 0–11:</b> You earn nothing. Leave before month 12 → zero options, even if the company is worth more.</li>
<li><b>Month 12 (cliff):</b> 1,000 options vest in one day (25% of 4,000). Paper value: 1,000 × (₹500 − ₹100) = <b>₹4 lakh</b> — just from staying one year.</li>
<li><b>Month 13–48:</b> ~83 more options vest every month. By month 48: 4,000 fully vested.</li>
<li><b>At IPO, 3 years later:</b> If company IPOs at ₹2,500/share — 4,000 options are worth 4,000 × (2,500 − 100) = <b>₹96 lakh gross</b>. After perquisite tax (~30%) and LTCG: roughly <b>₹60–70 lakh net.</b></li></ul>`,
visual:`<p>Standard 4-year vest, 1-year cliff (4,000 total options):</p>
<div class="learn-viz">
<div class="lv-row"><span class="lv-yr">Month 0–11</span><div class="lv-bar lv-empty" style="width:5%"></div><span class="lv-v">0 vested — cliff not crossed</span></div>
<div class="lv-row"><span class="lv-yr">Month 12</span><div class="lv-bar lv-today" style="width:25%"></div><span class="lv-v">1,000 (25%) — cliff crossed</span></div>
<div class="lv-row"><span class="lv-yr">Month 24</span><div class="lv-bar lv-today" style="width:50%"></div><span class="lv-v">2,000 (50%)</span></div>
<div class="lv-row"><span class="lv-yr">Month 36</span><div class="lv-bar lv-today" style="width:75%"></div><span class="lv-v">3,000 (75%)</span></div>
<div class="lv-row"><span class="lv-yr">Month 48</span><div class="lv-bar lv-today" style="width:100%"></div><span class="lv-v">4,000 (100%) — fully vested</span></div>
</div>`,
interactive:`<p>Meridian's ESOP Suite has six dedicated calculators — valuation (with live FMV fetch), vesting, India tax, exit proceeds, dilution, waterfall.</p><button class="btn btn-amber" onclick="showTab('calc');setTimeout(()=>TABS.calc.open('esopval'),100)">→ Open ESOP Valuation Calculator</button>`,
mistakes:`<ul>
<li><b>Taking a salary cut for ESOPs in a late-stage startup.</b> Late-stage ESOPs have less upside. Preference stack may mean zero unless exit is very large. Know the cap table first.</li>
<li><b>Leaving before the cliff.</b> 11 months vs 13 months is the difference between zero and lakhs. Always check your cliff date before resigning.</li>
<li><b>Not planning for perquisite tax.</b> When you exercise, the gain (FMV − Strike) is salary income taxed at slab rate — even if you don't sell. Plan ~30% cash outlay.</li>
<li><b>Ignoring preference stack.</b> If investors have 2× preference and invested ₹500 Cr, company must exit over ₹1,000 Cr before employees see anything. Always ask: "What is the total preference stack?"</li>
<li><b>Assuming options = shares.</b> Options are the right to buy. They expire. They can be cancelled. They have no voting rights until exercised.</li></ul>`,
related:`<div class="learn-rel"><a onclick="TABS.learn.open('startup')">Startup Finance</a><a onclick="TABS.learn.open('ipo')">IPO Analysis</a><a onclick="TABS.learn.open('tax')">Tax-Efficient Investing</a><a onclick="TABS.learn.open('governance')">Corporate Governance</a></div>`,
},

startup:{title:"Startup Finance",
definition:`<p>Startups are early-stage businesses that grow by raising <b>external equity capital</b> rather than relying on internal profits. Because they typically burn cash early on building product and acquiring customers, they need periodic funding to survive and grow.</p>
<p>The funding lifecycle: <b>Pre-seed → Seed → Series A → Series B → Series C → Growth / Pre-IPO → IPO or acquisition</b>. Each stage represents a higher valuation and bigger raise, with progressively less risk demanding progressively lower return expectations from investors.</p>
<p>Equity issued at each stage dilutes all earlier shareholders — which is why understanding dilution, preferences, and cap tables is essential for anyone receiving startup equity.</p>`,
why:`<p>If you work at, invest in, advise, or want to start a startup — understanding startup finance is not optional. It determines:</p>
<ul><li>What your ESOP is actually worth after multiple dilution rounds</li>
<li>Whether Series B investor terms leave you with anything at a modest exit</li>
<li>How much founders actually own when they ring the IPO bell (often 15–25% after all rounds)</li>
<li>Why "raising at a high valuation" is not always good — higher valuation = higher preference stack = harder to clear for employees in a down-exit</li></ul>`,
example:`<p><b>A typical startup journey:</b></p>
<ul><li><b>Seed (2020):</b> Two founders own 100%. Raise ₹2 Cr from angels at ₹10 Cr post-money. Founders diluted to 80%.</li>
<li><b>Series A (2021):</b> VC invests ₹20 Cr at ₹100 Cr post-money. ESOP pool created (10%). Founders ~54%.</li>
<li><b>Series B (2022):</b> ₹100 Cr at ₹500 Cr post-money. Founders ~40%. ESOP pool ~12%.</li>
<li><b>Series C (2023):</b> ₹300 Cr at ₹2,000 Cr post-money. Founders ~30%.</li>
<li><b>IPO (2025):</b> Lists at ₹5,000 Cr market cap. Founders ~25% = ₹1,250 Cr. Vested ESOPs ~8% = ₹400 Cr split across hundreds of employees.</li></ul>
<p><b>The real money is made early.</b> A Seed employee holding 0.5% of a ₹5,000 Cr company = ₹25 Cr. A Series C joiner holding 0.1% = ₹5 Cr. Every round dilutes, but each round also (hopefully) increases per-share value.</p>`,
visual:`<div class="learn-table">
<div class="lt-row lt-h"><span>Stage</span><span>Typical valuation</span><span>Investor type</span></div>
<div class="lt-row"><span>Pre-seed</span><span>₹2–15 Cr</span><span>Friends, family, angels</span></div>
<div class="lt-row"><span>Seed</span><span>₹10–100 Cr</span><span>Angel networks, micro-VCs</span></div>
<div class="lt-row"><span>Series A</span><span>₹100–500 Cr</span><span>Early-stage VCs (Accel, Sequoia, Matrix)</span></div>
<div class="lt-row"><span>Series B</span><span>₹300 Cr – ₹2,000 Cr</span><span>Growth VCs (Tiger Global, SoftBank early)</span></div>
<div class="lt-row"><span>Series C+</span><span>₹1,000 Cr+</span><span>Growth equity, PE, crossover funds</span></div>
<div class="lt-row"><span>IPO</span><span>₹2,000 Cr+</span><span>Public market investors</span></div>
</div>`,
interactive:`<p>The ESOP Suite calculators cover key startup finance scenarios: dilution from new rounds, waterfall on exit, exit proceeds at different valuations.</p><button class="btn btn-amber" onclick="showTab('calc');setTimeout(()=>TABS.calc.open('esopdilution'),100)">→ Open Dilution Calculator</button>`,
mistakes:`<ul>
<li><b>Joining at a high-preference, late-stage round thinking it's "safer".</b> Late-stage = lower upside; heavy preference stacks mean employees often get zero in less-than-spectacular exits.</li>
<li><b>Mistaking post-money valuation for company worth.</b> ₹1,000 Cr post-money doesn't mean the company is worth ₹1,000 Cr — it means the latest investor paid a price <i>implying</i> that valuation for their small stake. Circular.</li>
<li><b>Ignoring liquidation preference terms.</b> 1× non-participating is fair. 2× participating is aggressive. Can mean lakhs of difference for employees in an acquisition.</li>
<li><b>Not reading the SHA.</b> Anti-dilution, drag-along rights, pro-rata rights, founder vesting clauses — all materially affect your outcome. Get them reviewed by a lawyer before joining.</li></ul>`,
related:`<div class="learn-rel"><a onclick="TABS.learn.open('esop')">ESOP Education</a><a onclick="TABS.learn.open('ipo')">IPO Analysis</a><a onclick="TABS.learn.open('pevc')">Private Equity & VC</a><a onclick="TABS.learn.open('governance')">Corporate Governance</a></div>`,
},

ipo:{title:"IPO Analysis",
definition:`<p>An <b>IPO (Initial Public Offering)</b> is when a private company sells shares to the public for the first time, listing on a stock exchange. It's the moment when early investors, founders, and ESOP holders can convert paper value into cash — and when retail investors can first buy in.</p>
<p>The process in India: company hires investment bankers → files DRHP (Draft Red Herring Prospectus) with SEBI → roadshow → book opens for 3 days → lists on NSE/BSE. Price band is typically set 10–15% below banker fair value, creating potential listing-day gains.</p>`,
why:`<p>IPOs matter from two angles:</p>
<ul><li><b>For retail investors:</b> Access to fast-growing private businesses previously unavailable. But incentives are stacked against you — promoters, VCs, and bankers are selling; you're buying. Analyse carefully.</li>
<li><b>For employees:</b> IPO is the primary liquidity event for ESOPs. Understand lock-up periods (6–12 months for pre-IPO holders), tax, and whether to exercise-and-hold or exercise-and-sell.</li></ul>`,
example:`<p><b>Zomato IPO, July 2021 — a case study:</b></p>
<ul><li>IPO price band: ₹72–76. GMP before listing suggested ₹115–125.</li>
<li><b>Listing day:</b> Opened ₹116, closed ₹126. Retail allottees who sold on listing day made ~65%.</li>
<li><b>6 months later:</b> Stock peaked at ₹170 (Dec 2021), then crashed to ₹40 by July 2022 — a 76% fall from peak.</li>
<li><b>3 years later (2024):</b> Recovered to ₹220+ as unit economics improved and business matured.</li></ul>
<p><b>The lesson:</b> Listing-day gains can be real, but holding into the first year often destroys value. Best IPO investments are companies where you believe in the 5-year thesis, not the 1-day momentum play.</p>`,
visual:`<div class="learn-table">
<div class="lt-row lt-h"><span>What to check</span><span>Why it matters</span><span>Where to find it</span></div>
<div class="lt-row"><span>GMP (Grey Market Premium)</span><span>Demand signal before listing</span><span>Financial news, GMP tracker sites</span></div>
<div class="lt-row"><span>Subscription rate</span><span>&gt;100× QIB = institutional interest</span><span>NSE/BSE live during IPO</span></div>
<div class="lt-row"><span>DRHP</span><span>Business, risks, financials, use of funds</span><span>SEBI website, company IR</span></div>
<div class="lt-row"><span>P/E vs listed peers</span><span>IPO priced cheap or premium?</span><span>Compute from IPO EPS + price band</span></div>
<div class="lt-row"><span>OFS vs Fresh Issue</span><span>OFS = promoters cashing out. Fresh = growth capital.</span><span>DRHP issue structure section</span></div>
</div>`,
interactive:`<p>To analyse an IPO, start with business fundamentals — run listed peers through Meridian's Equity Research to understand industry valuation benchmarks, then compare the IPO price band.</p><button class="btn btn-amber" onclick="showTab('research')">→ Open Equity Research to compare peers</button>`,
mistakes:`<ul>
<li><b>Treating IPO allotment like a lottery win.</b> Many IPOs that get oversubscribed 100× still disappoint on listing day. Allotment odds are poor; don't build a financial plan around listing gains.</li>
<li><b>Ignoring the OFS/Fresh Issue split.</b> 80% OFS = company gets no cash; money goes to VCs and promoters. Fresh issue = company gets cash to grow. OFS = founders/VCs exit.</li>
<li><b>Not reading the risk factors in the DRHP.</b> Lawsuits, regulatory issues, concentration risks, going-concern risks. Dry but essential.</li>
<li><b>Holding through lock-up expiry without a thesis.</b> When 6-month employee/promoter lock-up expires, share supply increases sharply. Price often falls unless results are compelling.</li></ul>`,
related:`<div class="learn-rel"><a onclick="TABS.learn.open('esop')">ESOP Education</a><a onclick="TABS.learn.open('valuation')">Valuation Concepts</a><a onclick="TABS.learn.open('governance')">Corporate Governance</a><a onclick="TABS.learn.open('tax')">Tax-Efficient Investing</a></div>`,
},

/* ══════ PROFESSIONAL FINANCE ══════ */

portfolio:{title:"Portfolio Construction",
definition:`<p><b>Portfolio construction</b> is the process of combining multiple investments to achieve a target return while managing total risk — based on your goals, time horizon, and risk tolerance.</p>
<p>Three fundamental decisions:</p>
<ul><li><b>Asset allocation</b> — how to split between asset classes (equity, debt, gold, cash, real estate)</li>
<li><b>Diversification</b> — within equity, how to spread across sectors, geographies, and company sizes</li>
<li><b>Position sizing</b> — how much capital to allocate to each individual holding</li></ul>
<p>Nobel laureate Harry Markowitz showed mathematically that <b>combining assets with low correlation</b> reduces portfolio risk without necessarily reducing expected return — the only "free lunch" in finance.</p>`,
why:`<p>Decades of research show that <b>asset allocation explains 80–90% of long-term portfolio returns</b> — far more than individual stock selection or market timing. Getting allocation right is simply more important than getting any individual pick right.</p>
<p>Key principles:</p>
<ul><li><b>Time horizon drives equity allocation.</b> Money needed in 1 year: liquid debt. Money needed in 10 years: can be 80–100% equity.</li>
<li><b>Diversification ≠ owning many similar things.</b> 20 IT stocks are not diversified. True diversification crosses sectors with different economic drivers.</li>
<li><b>Rebalancing captures mean reversion.</b> When equities outperform and become overweight, trim back to target — systematically selling high and buying low.</li></ul>`,
example:`<p><b>A practical allocation framework for an Indian retail investor, age 30:</b></p>
<ul><li><b>Emergency fund (3–6 months expenses):</b> Liquid fund or savings — not invested, not in portfolio</li>
<li><b>Core equity (60%):</b> Nifty 50 index fund (45%) + Midcap 150 index fund (15%). Passive, low-cost.</li>
<li><b>Satellite equity (20%):</b> 10–12 individual stocks across 4–5 sectors. Where Meridian analysis matters.</li>
<li><b>Debt (15%):</b> PPF, NPS, short-duration bond fund. Ballast during crashes.</li>
<li><b>Gold / alternatives (5%):</b> Sovereign Gold Bond. Inflation hedge, negative correlation in crises.</li></ul>
<p><b>Review annually.</b> If equities rallied strongly, they may now be 75% — trim to 80% and move 5% to debt, locking in gains.</p>`,
visual:`<div class="learn-table">
<div class="lt-row lt-h"><span>Rule</span><span>Why it matters</span></div>
<div class="lt-row"><span>No single stock &gt;10–15%</span><span>Even great companies can fail; concentration can destroy a portfolio</span></div>
<div class="lt-row"><span>No single sector &gt;25–30%</span><span>Sector downturns hit correlated holdings simultaneously</span></div>
<div class="lt-row"><span>15–25 stocks in equity portfolio</span><span>&lt;15: concentrated. &gt;30: effectively an index (minus the lower cost)</span></div>
<div class="lt-row"><span>Rebalance when allocation drifts &gt;5%</span><span>Maintains risk discipline; forces buying low, selling high</span></div>
<div class="lt-row"><span>Match duration to goals</span><span>Short-term needs: liquid/debt. Long-term: equity.</span></div>
</div>`,
interactive:`<p>Meridian's <b>Portfolio</b> tab tracks holdings with live P&L, sector breakdown, and performance attribution.</p><button class="btn btn-amber" onclick="showTab('portfolio')">→ Open Portfolio Tracker</button>`,
mistakes:`<ul>
<li><b>Over-diversification.</b> 50+ stocks is an expensive, tax-inefficient index fund. You can't follow 50 businesses meaningfully. 15–25 high-conviction holdings is the sweet spot.</li>
<li><b>Rebalancing too frequently.</b> Quarterly creates taxes and transaction costs. Annual, or when allocation drifts >5–10%, is appropriate.</li>
<li><b>Letting winners run unchecked.</b> If one stock becomes 30% of portfolio because it tripled, risk profile has changed dramatically. Trim, regardless of love for the company.</li>
<li><b>Ignoring correlation.</b> In 2022, both equity and bonds fell simultaneously for the first time in 40 years. "Diversification" in a correlated macro shock is less effective than you think.</li>
<li><b>Recency bias in allocation.</b> Increasing equity after markets rose (when they feel "safe") and reducing after crashes (when they feel "dangerous") is the opposite of rational allocation.</li></ul>`,
related:`<div class="learn-rel"><a onclick="TABS.learn.open('risk')">Risk Analysis</a><a onclick="TABS.learn.open('equity')">Equity Basics</a><a onclick="TABS.learn.open('tax')">Tax-Efficient Investing</a><a onclick="TABS.learn.open('technical')">Technical Analysis</a></div>`,
},

governance:{title:"Corporate Governance",
definition:`<p><b>Corporate governance</b> is the system by which a company is directed and controlled — the rules, processes, and relationships between management, the board, shareholders, and other stakeholders. Good governance protects minority shareholders (like you); poor governance lets insiders extract value at your expense.</p>
<p>Key actors:</p>
<ul><li><b>Board of Directors:</b> Elected by shareholders to oversee management. Independent directors should provide oversight without conflicts.</li>
<li><b>Promoters/Founders:</b> Controlling shareholders in most Indian companies. High insider ownership aligns interests but also concentrates power.</li>
<li><b>Auditors:</b> Independent accountants who certify financial statements. Quality and continuity matter.</li>
<li><b>Management:</b> Day-to-day operators. Compensation, equity ownership, track record are key signals.</li></ul>`,
why:`<p>In India, <b>corporate governance is the single biggest risk for minority shareholders</b>. India has many family-owned, promoter-driven companies where the founding family controls the business. This can be excellent (founder-led, long-term thinking) or disastrous (tunnelling of cash to related entities, related-party transactions enriching insiders at minority shareholder expense).</p>
<p>The promoter pledging metric is particularly important: when a promoter pledges over 50% of shares as loan collateral, a stock price decline can trigger forced selling by lenders — creating a death spiral. Multiple Indian companies (Essel, ADAG group) collapsed partly due to promoter pledging.</p>`,
example:`<p><b>Good governance: Infosys.</b> Even after founder Narayana Murthy's departure, Infosys maintained strong independent board oversight, transparent compensation, consistent dividends, no related-party controversies. When the 2017 governance dispute arose (anonymous complaints about CEO compensation), the board acted — CEO resigned. Minority shareholders' interests were protected.</p>
<p><b>Poor governance: Reliance Capital (ADAG group).</b> Promoter pledging exceeded 90% of holdings. Related-party transactions moved cash between group entities. Auditors resigned. Eventually collapsed into insolvency despite the brand name.</p>
<p>Both warning signals were readable in public filings before the crisis.</p>`,
visual:`<div class="learn-table">
<div class="lt-row lt-h"><span>Governance signal</span><span>Green flag</span><span>Red flag</span></div>
<div class="lt-row"><span>Promoter pledging</span><span>&lt;10% of shares pledged</span><span>&gt;50% pledged — danger zone</span></div>
<div class="lt-row"><span>Related-party transactions</span><span>Disclosed, arms-length, minimal</span><span>Large, opaque, beneficial to promoters</span></div>
<div class="lt-row"><span>Auditor</span><span>Big 4 / top-tier, long tenure</span><span>Unknown firm; frequent auditor changes</span></div>
<div class="lt-row"><span>CEO/CFO changes</span><span>Stable leadership</span><span>Multiple C-suite exits in short period</span></div>
<div class="lt-row"><span>Cash conversion</span><span>OCF consistently ≥ 80% of net profit</span><span>Profits not converting to cash for multiple years</span></div>
<div class="lt-row"><span>Dividend history</span><span>Consistent, growing dividends</span><span>Profits retained but never distributed despite no growth</span></div>
</div>`,
interactive:`<p>Meridian's <b>Equity Research → Ownership Analysis</b> panel shows promoter holding %, institutional ownership, insider transactions, and net buying/selling.</p><button class="btn btn-amber" onclick="showTab('research')">→ Open Ownership Analysis</button>`,
mistakes:`<ul>
<li><b>Trusting brand name over governance checks.</b> Many collapsed Indian companies were household names with decades of history. Brand provides no protection.</li>
<li><b>Ignoring related-party transactions.</b> Scan notes to accounts for RPTs — if company sells goods to promoter-owned entities at below-market prices or lends to promoter firms, profits are being tunnelled.</li>
<li><b>Dismissing "technical" governance issues.</b> An auditor qualification, qualified audit opinion, or CFO resignation are not "technical" — they are serious signals. Investigate immediately.</li>
<li><b>Assuming listed = trustworthy.</b> SEBI listing requirements are a minimum bar. Listing is no guarantee of governance quality.</li></ul>`,
related:`<div class="learn-rel"><a onclick="TABS.learn.open('forensic')">Forensic Accounting</a><a onclick="TABS.learn.open('statements')">Financial Statements</a><a onclick="TABS.learn.open('ib')">Investment Banking</a><a onclick="TABS.learn.open('risk')">Risk Analysis</a></div>`,
},

options:{title:"Options & Derivatives",
definition:`<p>A <b>derivative</b> is a financial contract whose value is derived from an underlying asset — typically a stock, index, or commodity. The two most common: <b>options</b> and <b>futures</b>.</p>
<p><b>Futures:</b> An obligation to buy or sell an asset at a fixed price on a fixed date. Both parties obligated.</p>
<p><b>Options:</b> A <i>right but not an obligation</i> to buy or sell:</p>
<ul><li><b>Call option</b> — right to <i>buy</i> the underlying at strike price before expiry. Buy a call when you expect price to rise.</li>
<li><b>Put option</b> — right to <i>sell</i> the underlying at strike price before expiry. Buy a put when expecting fall, or as insurance.</li></ul>
<p>You pay a <b>premium</b> for the option. If you don't exercise, you lose the premium. Maximum loss = premium paid.</p>`,
why:`<p>Derivatives serve two legitimate purposes:</p>
<ul><li><b>Hedging:</b> An airline buying crude oil futures locks in fuel cost. An investor buying Nifty put options insures a portfolio against crash. Economically rational.</li>
<li><b>Expressing a view efficiently:</b> Options provide leverage — a ₹1 lakh investment in calls can control ₹10–20 lakh of underlying. Amplifies gains if correct.</li></ul>
<p>However: SEBI data shows <b>90%+ of individual options traders in India lose money</b>. Options are zero-sum, technically complex, and the leverage amplifying gains also amplifies losses. Not a shortcut to wealth.</p>`,
example:`<p><b>A simple call option:</b></p>
<p>Nifty at 22,000. You believe it'll rise to 23,000 in 30 days. You buy a <b>22,500 call expiring in 30 days</b>, premium ₹120.</p>
<ul><li>Nifty reaches 23,000: call worth (23,000 − 22,500) = 500. You paid ₹120. <b>Profit: ₹380 per lot</b> (317% return on premium)</li>
<li>Nifty stays at 22,000: option expires worthless. <b>Loss: ₹120 (full premium)</b></li>
<li>Nifty falls to 21,000: option worthless, <b>loss: ₹120</b>. The put seller, however, is in serious trouble.</li></ul>
<p><b>Compare to futures buyer</b> who bought Nifty at 22,000 with ₹1.1 lakh margin: if Nifty falls to 21,000, they lose ₹50,000. The option buyer's loss is capped at ₹120. This is the key advantage of buying options.</p>`,
visual:`<div class="learn-table">
<div class="lt-row lt-h"><span>Position</span><span>View</span><span>Max loss</span><span>Max gain</span></div>
<div class="lt-row"><span>Buy call</span><span>Bullish</span><span>Premium paid</span><span>Unlimited</span></div>
<div class="lt-row"><span>Buy put</span><span>Bearish / hedge</span><span>Premium paid</span><span>Strike − 0</span></div>
<div class="lt-row"><span>Sell call (naked)</span><span>Mildly bearish</span><span>Unlimited — dangerous</span><span>Premium received</span></div>
<div class="lt-row"><span>Sell put</span><span>Mildly bullish</span><span>Strike − 0 (large)</span><span>Premium received</span></div>
<div class="lt-row"><span>Buy future</span><span>Bullish</span><span>Marked to market (margin)</span><span>Unlimited</span></div>
</div>`,
interactive:`<p>Before trading options, fully understand a company's fundamental value — options don't change business economics. Use Meridian's Equity Research and Modeling Lab to anchor any options thesis.</p><button class="btn btn-amber" onclick="showTab('models')">→ Open Modeling Lab</button>`,
mistakes:`<ul>
<li><b>Selling naked calls without understanding.</b> Naked call losses are theoretically unlimited. One unexpected news event can wipe out your account. Never sell naked calls without experience.</li>
<li><b>Ignoring time decay (theta).</b> Options lose value every day as expiry approaches, even if underlying doesn't move. Buying short-dated out-of-the-money options is a fast way to lose money — must be right on direction AND timing.</li>
<li><b>Using options to gamble, not hedge.</b> "I'll buy Nifty weekly calls because the chart looks bullish" is speculation with near-100% loss probability over time. Hedging is rational; speculation without an edge is not.</li>
<li><b>Under-capitalising.</b> If losing the premium would affect your lifestyle, you're over-allocated to options.</li></ul>`,
related:`<div class="learn-rel"><a onclick="TABS.learn.open('risk')">Risk Analysis</a><a onclick="TABS.learn.open('technical')">Technical Analysis</a><a onclick="TABS.learn.open('portfolio')">Portfolio Construction</a><a onclick="TABS.learn.open('macro')">Macroeconomics</a></div>`,
},

tax:{title:"Tax-Efficient Investing (India)",
definition:`<p>Tax-efficient investing means structuring your portfolio and transactions to legally minimise tax drag on returns. In India, equity investment taxation is relatively favourable compared to many global markets — but the rules are specific and need active management.</p>
<p>Key tax categories for equity investors:</p>
<ul><li><b>STCG (Short-Term Capital Gains):</b> Gains on equity/equity MF sold within 12 months — taxed at <b>20%</b> flat (Budget 2024 onwards)</li>
<li><b>LTCG (Long-Term Capital Gains):</b> Gains on equity/equity MF sold after 12 months — taxed at <b>12.5%</b>, with ₹1.25 lakh annual exemption</li>
<li><b>Dividend income:</b> Added to your income, taxed at slab rate (effectively 30%+ for high earners)</li>
<li><b>Debt fund gains:</b> All gains taxed at slab rate (no LTCG benefit since 2023 change)</li></ul>`,
why:`<p>Tax drag compounds over time. A 2% annual tax cost on a 12% return portfolio reduces effective return to 10%, and over 20 years that's the difference between ₹11.5 lakh and ₹7.3 lakh on ₹1 lakh invested. Tax efficiency can add 1–2% per year in net returns — equivalent to choosing a better fund.</p>
<p>Three biggest opportunities for Indian investors:</p>
<ul><li><b>LTCG harvesting:</b> Selling after 12 months means 12.5% vs 20% — a 37.5% saving</li>
<li><b>₹1.25 lakh annual LTCG exemption:</b> Every year, first ₹1.25 lakh of long-term equity gains is tax-free. Use it — sell and rebuy to reset cost basis.</li>
<li><b>ELSS (Section 80C):</b> Up to ₹1.5 lakh in ELSS reduces taxable income, with 3-year lock-in</li></ul>`,
example:`<p><b>The LTCG harvesting strategy — how to save lakhs legally:</b></p>
<p>Suppose you bought Reliance for ₹1,000 in 2021. Now worth ₹3,000 (₹2,000/share gain). You hold 1,000 shares — total paper gain ₹20 lakh.</p>
<p><b>Inefficient:</b> Hold until 2026, sell all at once. LTCG: 12.5% on (₹20L − ₹1.25L exemption) = 12.5% on ₹18.75L = <b>₹2.34 lakh tax</b></p>
<p><b>Efficient:</b> Every year, sell just enough shares to realise ₹1.25 lakh of gains — completely tax-free. Rebuy immediately (no wash-sale rule in India). Over years, you've reset your cost basis at zero tax.</p>
<p><b>Disciplined harvesting on ₹20L of gains can save ₹1.5–2 lakh in tax</b> versus a single bulk sale.</p>`,
visual:`<div class="learn-table">
<div class="lt-row lt-h"><span>Instrument</span><span>Holding period</span><span>Tax rate</span></div>
<div class="lt-row"><span>Listed equity / equity MF</span><span>&lt;12 months (STCG)</span><span>20% flat</span></div>
<div class="lt-row"><span>Listed equity / equity MF</span><span>&gt;12 months (LTCG)</span><span>12.5% (first ₹1.25L exempt)</span></div>
<div class="lt-row"><span>Debt funds / bonds</span><span>Any</span><span>Slab rate (up to 30%)</span></div>
<div class="lt-row"><span>ELSS</span><span>3-year lock-in</span><span>LTCG 12.5% + 80C deduction on investment</span></div>
<div class="lt-row"><span>PPF / EPF</span><span>15 years / retirement</span><span>Fully exempt (EEE status)</span></div>
<div class="lt-row"><span>NPS</span><span>Until 60</span><span>Partial exempt; 60% corpus tax-free at exit</span></div>
</div>`,
interactive:`<p>Tax planning for ESOPs is particularly complex — two tax events (perquisite + capital gains), holding period decisions, and timing of exercise all matter.</p><button class="btn btn-amber" onclick="showTab('calc');setTimeout(()=>TABS.calc.open('esoptax'),100)">→ Open ESOP Tax Calculator</button>`,
mistakes:`<ul>
<li><b>Not using the ₹1.25 lakh LTCG exemption annually.</b> Most commonly missed free benefit. Every year, harvest ₹1.25 lakh of long-term gains tax-free — then rebuy. Compounded over 20 years, this can save ₹5–15 lakh.</li>
<li><b>Trading frequently without considering STCG.</b> At 20%, STCG is steep. A 20% gain that costs 20% in tax nets nothing. Frequent trading is a tax efficiency nightmare.</li>
<li><b>Ignoring dividend vs growth option.</b> Dividends are added to income at slab rate. If you're in 30% bracket, choose growth option — let compounding run tax-deferred.</li>
<li><b>Treating NPS as purely a tax tool.</b> NPS is excellent (₹50,000 extra deduction under 80CCD) but illiquid until 60. Don't over-allocate.</li>
<li><b>Not maintaining cost-of-acquisition records.</b> LTCG requires accurate cost basis. Inherited shares or bonus issues have specific cost rules. Maintain records from day one.</li></ul>`,
related:`<div class="learn-rel"><a onclick="TABS.learn.open('portfolio')">Portfolio Construction</a><a onclick="TABS.learn.open('esop')">ESOP Education</a><a onclick="TABS.learn.open('equity')">Equity Basics</a></div>`,
},

ib:{title:"Investment Banking",
definition:`<p>Investment banks are <b>financial intermediaries</b> that advise companies on raising capital and executing major transactions. Unlike commercial banks (which take deposits and make loans), investment banks earn <b>fees for advisory services and deal execution</b> rather than interest income.</p>
<p>Three core business lines:</p>
<ul><li><b>ECM (Equity Capital Markets):</b> IPOs, secondary offerings, rights issues. Help companies raise equity.</li>
<li><b>DCM (Debt Capital Markets):</b> Bond issuances, debentures, structured debt. Help companies borrow in capital markets rather than from banks.</li>
<li><b>M&A Advisory:</b> Mergers, acquisitions, divestitures, joint ventures. The most intellectually intensive line.</li></ul>`,
why:`<p>Understanding investment banking is valuable even if you're not planning a career in it:</p>
<ul><li>IB activity (M&A waves, IPO volumes) signals market sentiment and capital availability</li>
<li>IB-produced research reports and valuation models are the language of institutional investing — understanding them helps you read them critically</li>
<li>If your startup is heading toward M&A or IPO, IB advisory is part of the process</li></ul>`,
example:`<p><b>Zomato IPO (2021) — what the IBs actually did:</b></p>
<ul><li><b>Mandate:</b> Kotak, Morgan Stanley, Credit Suisse, BofA Securities were Book Running Lead Managers (BRLMs)</li>
<li><b>Valuation:</b> 200-page pitch on comparable companies (DoorDash, Meituan, Delivery Hero), DCF models, market positioning</li>
<li><b>SEBI filing:</b> Prepared and submitted the DRHP (500+ pages) disclosing everything about the business</li>
<li><b>Roadshow:</b> CEO + CFO did a 2-week roadshow to 50+ institutional investors in Mumbai, Singapore, London, New York</li>
<li><b>Book building:</b> Collected bids from institutions at various prices to determine market demand</li>
<li><b>Fees:</b> ~2–3% of ₹9,375 Cr raised = <b>roughly ₹187–280 Cr</b> in banker fees</li></ul>`,
visual:`<div class="learn-table">
<div class="lt-row lt-h"><span>What they do</span><span>Who pays</span><span>Typical fee</span></div>
<div class="lt-row"><span>IPO / equity raise</span><span>Issuing company (from proceeds)</span><span>2–5% of amount raised</span></div>
<div class="lt-row"><span>M&A (buy-side)</span><span>Acquiring company</span><span>Retainer + 0.5–1.5% of deal value</span></div>
<div class="lt-row"><span>M&A (sell-side)</span><span>Selling company or shareholders</span><span>1–3% of deal value (higher for smaller deals)</span></div>
<div class="lt-row"><span>Debt issuance</span><span>Borrowing company</span><span>0.5–2% of amount raised</span></div>
</div>`,
interactive:`<p>The same valuation tools investment bankers use — DCF, comparables, sum-of-parts, Monte Carlo — are in Meridian's Modeling Lab.</p><button class="btn btn-amber" onclick="showTab('models')">→ Open Modeling Lab (IB-grade tools)</button>`,
mistakes:`<ul>
<li><b>Assuming IB research is unbiased.</b> The bank underwrote the IPO and often issues "Initiate with Buy" within 40 days of listing. The conflict is real and well-documented. Read the disclosures.</li>
<li><b>Not understanding the fee structure.</b> IBs earn more on bigger, more complex deals. Creates incentive to advocate acquisitions even when they destroy value for the acquirer's shareholders.</li>
<li><b>Treating IB valuation models as truth.</b> IB DCFs are built to support a pre-determined deal price. Useful as frameworks; not as objective fair values.</li></ul>`,
related:`<div class="learn-rel"><a onclick="TABS.learn.open('valuation')">Valuation Concepts</a><a onclick="TABS.learn.open('pevc')">Private Equity & VC</a><a onclick="TABS.learn.open('ipo')">IPO Analysis</a><a onclick="TABS.learn.open('governance')">Corporate Governance</a></div>`,
},

pevc:{title:"Private Equity & Venture Capital",
definition:`<p><b>Private Equity (PE)</b> and <b>Venture Capital (VC)</b> are both forms of private market investing — but target very different types of companies at different stages:</p>
<ul><li><b>Venture Capital:</b> Invests in <i>early-stage, high-growth startups</i> (Seed through Series C). High failure rate (90%+ fail), but winners can return 100×. VCs build a portfolio of bets where one or two big wins cover all losses.</li>
<li><b>Private Equity:</b> Invests in <i>mature, profitable companies</i>. Uses debt (Leveraged Buyout / LBO) to acquire control, improve operations over 3–7 years, then sells. Lower risk, more moderate but reliable returns (15–25% IRR target).</li></ul>`,
why:`<p>PE and VC are relevant in three ways:</p>
<ul><li><b>If you work at a PE/VC-backed company:</b> Understanding their model helps interpret decisions — aggressive growth targets, eventual exit pressure, management incentive structures.</li>
<li><b>If you're a startup founder:</b> VC is your likely funding source. Understanding their math (fund size, return expectations, ownership targets) helps you negotiate better.</li>
<li><b>For public-market investing:</b> PE buyouts create acquisition premiums on listed stocks; VC-backed companies eventually IPO and become public-equity opportunities.</li></ul>`,
example:`<p><b>How a PE LBO works — the Mphasis example:</b></p>
<ul><li><b>2016:</b> Blackstone acquires ~60% of Mphasis (IT company) from HP Enterprise at ~₹430/share, paying ~₹7,100 Cr</li>
<li><b>Thesis:</b> Mphasis was profitable but under-managed under HP. Blackstone believed independent management + capital allocation focus + new clients could grow EBITDA 2–3× in 5 years</li>
<li><b>What happened:</b> Brought in new management, restructured client base toward high-growth digital services, grew revenue and margins consistently</li>
<li><b>Exit:</b> Sold most of stake by 2022 at ~₹2,400–2,600/share — ~6× return in 6 years (roughly 35% IRR)</li></ul>
<p><b>The formula:</b> Buy at low multiple, improve EBITDA, benefit from multiple expansion at exit.</p>`,
visual:`<div class="learn-table">
<div class="lt-row lt-h"><span>Feature</span><span>Venture Capital</span><span>Private Equity</span></div>
<div class="lt-row"><span>Stage</span><span>Early (Seed–Series C)</span><span>Mature, profitable</span></div>
<div class="lt-row"><span>Deal structure</span><span>Minority equity</span><span>Majority / control, often leveraged</span></div>
<div class="lt-row"><span>Debt used?</span><span>No</span><span>Yes (LBO) — key return driver</span></div>
<div class="lt-row"><span>Return target</span><span>3–10× fund (driven by a few big wins)</span><span>15–25% IRR (more consistent)</span></div>
<div class="lt-row"><span>Failure rate</span><span>~70–90% of investments fail</span><span>5–20% failure rate</span></div>
<div class="lt-row"><span>Indian examples</span><span>Sequoia India, Accel, Blume Ventures</span><span>Blackstone, KKR India, ChrysCapital</span></div>
</div>`,
interactive:`<p>Meridian's Modeling Lab runs DCF + Monte Carlo — the same framework PE firms use to build investment thesis and track IRR.</p><button class="btn btn-amber" onclick="showTab('models')">→ Open Modeling Lab</button>`,
mistakes:`<ul>
<li><b>Confusing VC and PE.</b> Fundamentally different models, risk profiles, return expectations. PE-style control approach to early-stage startups (or VC-style minority in mature companies) rarely works.</li>
<li><b>Believing fund headline IRRs.</b> Fund-level IRRs are averages. Top 20% of deals generate 80% of returns; most deals return less than invested. Ask for deal-level returns, not just fund IRR.</li>
<li><b>Ignoring fund lifecycle timing.</b> PE funds raise capital, deploy over 3–4 years, harvest over 3–5 years. LP investors can't exit early — capital locked for 7–10 years.</li>
<li><b>Underestimating leverage in PE returns.</b> A deal earning 12% unlevered can return 25% IRR with 60% debt. The same leverage amplifying returns also amplifies losses.</li></ul>`,
related:`<div class="learn-rel"><a onclick="TABS.learn.open('startup')">Startup Finance</a><a onclick="TABS.learn.open('ib')">Investment Banking</a><a onclick="TABS.learn.open('valuation')">Valuation Concepts</a><a onclick="TABS.learn.open('governance')">Corporate Governance</a></div>`,
},

dict:{title:"Financial Dictionary",
definition:`<p>Quick-reference glossary of the most-used financial terms — organised so you can look up any jargon you encounter in analyst reports, earnings calls, or business news. For deeper coverage, follow the linked topics.</p>`,
why:`<p>Finance has its own precise vocabulary. Using terms correctly isn't pedantry — it's the difference between understanding a bond issue and confusing it with an equity raise. Master this list and you'll understand 90% of financial journalism and analyst reports.</p>`,
example:`<div class="learn-table">
<div class="lt-row lt-h"><span>Term</span><span>Plain meaning</span><span>See also</span></div>
<div class="lt-row"><span>EBITDA</span><span>Earnings before interest, tax, depreciation, amortisation — operational cash profitability before financing and accounting adjustments</span><span>Ratios</span></div>
<div class="lt-row"><span>EBIT</span><span>EBITDA minus depreciation and amortisation — closer to "real" operating profit</span><span>Ratios</span></div>
<div class="lt-row"><span>FCFF</span><span>Free Cash Flow to Firm — cash left after running and reinvesting, before paying debt or equity holders</span><span>DCF</span></div>
<div class="lt-row"><span>FCFE</span><span>Free Cash Flow to Equity — FCFF minus debt repayments; available to shareholders</span><span>DCF</span></div>
<div class="lt-row"><span>ROCE</span><span>Return on Capital Employed — % earnings on every rupee of capital the business uses</span><span>Ratios</span></div>
<div class="lt-row"><span>ROE</span><span>Return on Equity — profit as % of shareholder equity; how well management uses shareholders' money</span><span>Ratios</span></div>
<div class="lt-row"><span>WACC</span><span>Weighted Average Cost of Capital — blended rate the company pays for debt and equity financing; the DCF discount rate</span><span>DCF</span></div>
<div class="lt-row"><span>CAGR</span><span>Compound Annual Growth Rate — smoothed annual growth rate as if growth happened at a steady rate</span><span>Ratios</span></div>
<div class="lt-row"><span>EV (Enterprise Value)</span><span>Market cap + net debt — total acquisition cost of a business, independent of capital structure</span><span>Valuation</span></div>
<div class="lt-row"><span>P/E</span><span>Price to Earnings — how much you pay per ₹1 of annual profit</span><span>P/E Deep-Dive</span></div>
<div class="lt-row"><span>EV/EBITDA</span><span>Enterprise value divided by EBITDA — capital-structure-neutral valuation multiple</span><span>Valuation</span></div>
<div class="lt-row"><span>P/B</span><span>Price to Book — market price vs net asset value; used for banks, insurance, asset-heavy businesses</span><span>Ratios</span></div>
<div class="lt-row"><span>PEG</span><span>P/E divided by earnings growth rate — corrects P/E for growth. Under 1 usually attractive.</span><span>P/E Deep-Dive</span></div>
<div class="lt-row"><span>NIM</span><span>Net Interest Margin — a bank's spread between rate earned on loans and paid on deposits</span><span>Ratios</span></div>
<div class="lt-row"><span>NPA / GNPA</span><span>Non-Performing Asset — loans where borrower hasn't paid in 90+ days; key credit quality metric for banks</span><span>Ratios</span></div>
<div class="lt-row"><span>CASA</span><span>Current Account Savings Account ratio — share of cheap deposits in bank funding; higher CASA = lower funding cost</span><span>Ratios</span></div>
<div class="lt-row"><span>Beta</span><span>Measures how a stock moves vs the overall market. Beta 1.5 = moves 1.5× the market</span><span>Risk</span></div>
<div class="lt-row"><span>Alpha</span><span>Return above what was expected for the risk taken — pure skill, not luck</span><span>Risk</span></div>
<div class="lt-row"><span>Drawdown</span><span>Peak-to-trough decline from a previous high. Max drawdown = worst such period</span><span>Risk</span></div>
<div class="lt-row"><span>Sharpe Ratio</span><span>(Return − Risk-free rate) / Volatility — return per unit of risk. Higher better.</span><span>Risk</span></div>
<div class="lt-row"><span>SIP / SWP</span><span>Systematic Investment / Withdrawal Plan — fixed periodic investment or withdrawal</span><span>Calculators</span></div>
<div class="lt-row"><span>ESOP</span><span>Employee Stock Option Plan — right to buy company shares at a fixed strike price after vesting</span><span>ESOP Education</span></div>
<div class="lt-row"><span>Vesting</span><span>Schedule by which options or restricted stock become yours over time</span><span>ESOP</span></div>
<div class="lt-row"><span>Cliff</span><span>Minimum tenure before any options vest — typically 12 months</span><span>ESOP</span></div>
<div class="lt-row"><span>Liquidation preference</span><span>Right of preferred shareholders (VCs) to get investment back (×1 or ×2) before common holders see anything</span><span>Startup Finance</span></div>
<div class="lt-row"><span>Dilution</span><span>Reduction in % ownership due to new shares being issued</span><span>Startup Finance</span></div>
<div class="lt-row"><span>Moat</span><span>Structural competitive advantage allowing above-average returns sustainably</span><span>Economic Moats</span></div>
<div class="lt-row"><span>Terminal Value</span><span>Value of cash flows beyond the explicit forecast — often 60–70% of total DCF value</span><span>DCF</span></div>
<div class="lt-row"><span>Capex / Opex</span><span>Capital Expenditure (long-lived assets) / Operating Expenditure (recurring costs). Capex depreciates; Opex is immediate</span><span>Statements</span></div>
<div class="lt-row"><span>Working Capital</span><span>Current assets minus current liabilities — cash tied in day-to-day operations</span><span>Statements</span></div>
<div class="lt-row"><span>LTCG / STCG</span><span>Long-Term / Short-Term Capital Gains — Indian tax based on holding period. Equity: LTCG (12.5%) after 12m; STCG (20%) under 12m</span><span>Tax Investing</span></div>
<div class="lt-row"><span>OFS</span><span>Offer for Sale — existing shareholders sell in an IPO (money goes to them, not the company)</span><span>IPO Analysis</span></div>
<div class="lt-row"><span>DRHP</span><span>Draft Red Herring Prospectus — detailed company disclosure filed before an IPO</span><span>IPO Analysis</span></div>
<div class="lt-row"><span>GMP</span><span>Grey Market Premium — unofficial pre-IPO premium indicating expected listing gain</span><span>IPO Analysis</span></div>
<div class="lt-row"><span>CRR / SLR</span><span>Cash Reserve / Statutory Liquidity Ratio — mandatory bank reserves with RBI</span><span>Macroeconomics</span></div>
<div class="lt-row"><span>FII / DII</span><span>Foreign / Domestic Institutional Investors — largest market participant groups whose flows move markets</span><span>Macroeconomics</span></div>
</div>`,
visual:`<p>Finance terms cluster around five core ideas:</p>
<div class="learn-table">
<div class="lt-row lt-h"><span>Cluster</span><span>Key terms</span></div>
<div class="lt-row"><span>Profitability</span><span>EBITDA, EBIT, Net Profit, ROCE, ROE, Margins, CAGR</span></div>
<div class="lt-row"><span>Valuation</span><span>P/E, EV/EBITDA, P/B, PEG, DCF, Terminal Value, Fair Value</span></div>
<div class="lt-row"><span>Risk & Capital</span><span>Beta, Drawdown, Sharpe, WACC, Leverage, VaR</span></div>
<div class="lt-row"><span>Startup & ESOP</span><span>ESOP, Vesting, Cliff, Dilution, Liquidation Preference, Cap Table</span></div>
<div class="lt-row"><span>Tax & Regulation</span><span>LTCG, STCG, ELSS, DRHP, OFS, NPA, CASA</span></div>
</div>`,
interactive:`<p>All these terms are used live in Meridian's analysis modules with real numbers backing them.</p><button class="btn btn-amber" onclick="showTab('research')">→ Open Equity Research (all ratios live)</button>`,
mistakes:`<ul>
<li><b>Confusing EBITDA and free cash flow.</b> EBITDA is accounting; free cash flow is what a business actually generates. High-capex businesses have FCF far below EBITDA.</li>
<li><b>Confusing market cap and enterprise value.</b> Market cap = equity value. EV = equity + net debt. For comparing companies with different capital structures, always use EV-based multiples.</li>
<li><b>Treating "consolidated" as "the company".</b> Consolidated financials include subsidiaries. Sometimes problems are buried in a subsidiary hidden from the headline. Read standalone too.</li></ul>`,
related:`<div class="learn-rel"><a onclick="TABS.learn.open('ratios')">Ratio Analysis</a><a onclick="TABS.learn.open('valuation')">Valuation</a><a onclick="TABS.learn.open('esop')">ESOP</a><a onclick="TABS.learn.open('tax')">Tax-Efficient Investing</a></div>`,
},

};
