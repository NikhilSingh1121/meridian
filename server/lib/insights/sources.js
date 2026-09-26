/**
 * Research source discovery — deterministic, no model involved.
 *
 *   · exchange filings (NSE corporate announcements): results outcomes,
 *     investor presentations, call transcripts, acquisitions, management
 *     changes, dividends, ratings … with NSE's own summary and the filing PDF
 *   · news headlines (Google News RSS): dated, publisher-attributed headlines
 *     for the company, its listed peers and its industry
 *
 * The research stage may only cite what is discovered here (or what Google
 * Search grounding returns when the key has that quota), so every source in
 * the report is one the system actually retrieved.
 */

const nse = require("../../providers/nse");

const DAY = 86_400_000;
const shortName = (n) => String(n || "").replace(/\b(limited|ltd\.?|inc\.?|incorporated|corporation|corp\.?|plc|company|co\.)\s*$/i, "").replace(/[,.]+$/, "").trim();

/* ── exchange filings ─────────────────────────────────────────────────── */
const FILING_KIND = [
  ["results", /outcome of board meeting|financial result|integrated filing- financial/i],
  ["presentation", /investor presentation/i],
  ["press", /press release/i],
  ["call", /analysts\/institutional investor meet|con\. call/i],
  ["deal", /acquisition|amalgamation|merger|restructuring|scheme of arrangement|joint venture|divest/i],
  ["people", /change in management|change in director|appointment|cessation|resignation/i],
  ["capital", /dividend|buy ?back|allotment of securities|record date|credit rating|fund raising|issue of securities/i],
  ["legal", /litigation|dispute|regulatory|penalt/i],
];
const BOILER = /^(please find (enclosed|attached)|we (wish to|hereby) inform|pursuant to regulation 30)[^.]*\.?$/i;

async function filings(symbol, cutoff) {
  if (!/\.(NS|BO)$/i.test(symbol)) return [];
  const list = await nse.corporateAnnouncements(symbol).catch(() => null);
  if (!list) return null;                       // unavailable (not the same as "no filings")
  const from = new Date(Date.parse(cutoff) - 400 * DAY).toISOString().slice(0, 10);
  return list
    .filter((a) => a.date <= cutoff && a.date >= from)
    .map((a) => {
      const k = FILING_KIND.find(([, re]) => re.test(a.category));
      // a call-update filing matters only when it carries the transcript / recording
      const kind = k ? k[0] : null;
      if (kind === "call" && !/transcript/i.test(a.text)) return null;
      return kind ? { ...a, kind, informative: a.text.length > 30 && !BOILER.test(a.text) } : null;
    })
    .filter(Boolean);
}

/* ── news headlines ───────────────────────────────────────────────────── */
const TIER2 = /reuters|bloomberg|times of india|fortune india|economic times|economictimes|business standard|mint|moneycontrol|cnbc|financial express|hindu ?business ?line|the hindu|ndtv profit|bq prime|forbes india|financial times|wall street journal|nikkei|barron/i;
const LOW = /market ?research|marketsandmarkets|imarc|insights|mordor|grand ?view|precedence|allied market|research ?and ?markets|expert market|sns insider|market.us|6wresearch|simply ?wall|marketbeat|stock ?titan|zacks|motley|seeking alpha|investing\.com|tickertape|scanx|equitypandit|trendlyne|ad-hoc|press ?release ?(distribution|point)|globenewswire|prnewswire|business ?wire/i;

function tag(s, t) {
  const a = s.indexOf("<" + t); if (a < 0) return "";
  const b = s.indexOf(">", a) + 1, c = s.indexOf("</" + t + ">", b);
  return c < 0 ? "" : s.slice(b, c).replace("<![CDATA[", "").replace("]]>", "").trim();
}
const unescape = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

async function googleNews(query, cutoff) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (M-Terminal research)" }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return [];
    const x = await r.text();
    return x.split("<item>").slice(1).map((it) => {
      const publisher = unescape(tag(it, "source"));
      let title = unescape(tag(it, "title"));
      if (publisher && title.endsWith(` - ${publisher}`)) title = title.slice(0, -(publisher.length + 3));
      const d = Date.parse(tag(it, "pubDate"));
      return { title, publisher, url: tag(it, "link"), date: isFinite(d) ? new Date(d).toISOString().slice(0, 10) : null };
    }).filter((n) => n.title && n.url && n.date && n.date <= cutoff && /^https:\/\/news\.google\.com\//.test(n.url));
  } catch { return []; }
}

/* industry headlines by business model (sector.js profile key) */
const INDUSTRY_QUERY = {
  bank: "India banks credit growth deposits NIM", insurance_nbfc: "India NBFC insurance AUM growth asset quality",
  it_services: "Indian IT services demand deal wins outlook", consumer: "India FMCG demand volume growth rural urban",
  pharma_health: "India pharma US generics USFDA domestic formulations", industrial: "India capex order inflows infrastructure",
  materials_energy: "India steel cement commodity prices demand", auto: "India auto sales demand passenger vehicles two-wheelers",
  realestate_telecom: "India real estate housing sales telecom tariffs",
};

async function news({ name, peers, industry, profileKey, cutoff }) {
  const co = shortName(name);
  const mentions = (t, who) => new RegExp(`\\b${who.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").split(/\s+/)[0]}`, "i").test(t);
  const out = [], seen = new Set();
  const add = (list, scope, who, cap) => {
    let n = 0;
    for (const it of list) {
      if (n >= cap) break;
      if (who && !mentions(it.title, who)) continue;               // relevance: the headline names the company
      if (LOW.test(it.publisher)) continue;
      const k = it.title.toLowerCase().slice(0, 70);
      if (seen.has(k)) continue;
      seen.add(k); n++;
      out.push({ ...it, scope, tier: TIER2.test(it.publisher) ? 2 : 3 });
    }
  };
  const [a, b, c] = await Promise.all([
    googleNews(`"${co}" when:365d`, cutoff),
    googleNews(`"${co}" (results OR guidance OR acquisition OR outlook) when:365d`, cutoff),
    googleNews(`${INDUSTRY_QUERY[profileKey] || `India ${industry || ""} industry outlook`} when:180d`, cutoff),
  ]);
  add([...b, ...a].sort((x, y) => y.date.localeCompare(x.date)), "company", co, 24);
  add(c, "industry", null, 8);
  for (const p of (peers || []).slice(0, 4)) add(await googleNews(`"${shortName(p)}" when:180d`, cutoff), "peer", shortName(p), 4);
  return out;
}

async function discoverSources({ report, peers, profileKey }) {
  const m = report.meta;
  const [f, n] = await Promise.all([
    filings(m.symbol, m.date),
    news({ name: m.name, peers, industry: m.industry, profileKey, cutoff: m.date }),
  ]);
  return { filings: f, news: n };
}

module.exports = { discoverSources, filings, googleNews, shortName, TIER2, LOW };
