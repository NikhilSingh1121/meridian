/**
 * M-TERMINAL — visitor activity in the server log (Render → Logs).
 *
 * Lines it writes:
 *   [visit]  guest 3f9a2c · IN · Chrome / Windows · opened /terminal
 *   [visit]  Nikhil (n***@gmail.com) · IN · Safari / iPhone · opened /terminal
 *   [tab]    guest 3f9a2c → Live Scanner
 *   [active] 4 online (1 signed in, 3 guests) · Live Scanner 2, Company Analysis 1, Quant Lab 1
 *
 * Privacy: guests are a short hash of IP + browser with a salt that changes on
 * every restart — no cookie, no stored identifier, the IP itself is never logged.
 * Signed-in users are shown by first name and a masked email. Country comes from
 * Cloudflare's CF-IPCountry header when present. ACTIVITY_LOG=0 turns it off.
 */
const crypto = require("crypto");
const express = require("express");
const A = require("./auth");

const SALT = crypto.randomBytes(12).toString("hex");
const ACTIVE_MS = 5 * 60e3, NEW_VISIT_MS = 30 * 60e3;
const on = () => process.env.ACTIVITY_LOG !== "0";
const visitors = new Map();   // id → { id, user, first, last, tab, country, device }

const TABS = {
  markets: "Market Intelligence", ixa: "Index Chart Analysis", scanner: "Live Scanner", sector: "Sector Analysis", portfolio: "Portfolio Analysis",
  research: "Company Analysis", earnings: "Earnings Call", forensic: "Forensic Analysis", models: "Modeling Lab",
  risk: "Risk Center", reports: "Report Generation", quant: "Quant Lab", calc: "Calculators", learn: "Learning Center", library: "Library",
};
const maskEmail = (e) => { const [u, d] = String(e || "").split("@"); return u && d ? `${u[0]}***@${d}` : ""; };
function device(ua) {
  ua = String(ua || "");
  const b = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Other";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "Other";
  return `${b} / ${os}`;
}
const BOT = /bot|crawl|spider|slurp|preview|monitor|uptime|curl|wget|python|node-fetch|axios|headless|lighthouse/i;

function who(v) { return v.user ? `${v.user.name || "User"}${v.user.email ? ` (${maskEmail(v.user.email)})` : ""}` : `guest ${v.id}`; }

/** record a sign of life; logs a new visit, a return after 30 idle minutes, and tab changes */
function touch(req, { page = null, tab = null } = {}) {
  if (!on()) return;
  const ua = req.get("user-agent") || "";
  if (BOT.test(ua)) return;
  let user = null;
  try { const u = A.currentUser(req); if (u) user = { name: String(u.name || "").split(" ")[0], email: u.email }; } catch { }
  const anon = crypto.createHash("sha256").update(SALT + (req.ip || "") + ua).digest("hex").slice(0, 6);
  const id = user && user.email ? "u:" + user.email : anon;
  const now = Date.now();
  let v = visitors.get(id);
  const fresh = !v || now - v.last > NEW_VISIT_MS;
  if (!v) { v = { id: anon, user, first: now, last: now, tab: null, country: req.get("cf-ipcountry") || "", device: device(ua) }; visitors.set(id, v); }
  v.last = now; v.user = user || v.user;
  if (fresh) console.log(`[visit] ${who(v)}${v.country ? ` · ${v.country}` : ""} · ${v.device} · ${page ? `opened ${page}` : tab ? `on ${TABS[tab] || tab}` : "active"}`);
  if (tab && TABS[tab] && tab !== v.tab) { if (v.tab && !fresh) console.log(`[tab] ${who(v)} → ${TABS[tab]}`); v.tab = tab; }
}

/* page views: the HTML pages themselves (/, /terminal, /learn …), never assets or API calls */
function pageViews(req, _res, next) {
  if (req.method === "GET" && !req.path.startsWith("/api") && /^\/[\w-]*(\.html)?$/.test(req.path) && /text\/html/.test(req.get("accept") || "")) touch(req, { page: req.path });
  next();
}

/* heartbeat from the terminal: current tab, once a minute while the page is visible */
const router = express.Router();
router.post("/activity", express.json({ limit: "1kb" }), (req, res) => {
  const tab = String((req.body && req.body.tab) || "").replace(/[^a-z]/g, "").slice(0, 20);
  touch(req, { tab: TABS[tab] ? tab : null });
  res.status(204).end();
});

/* every 5 minutes while anyone is around: who is online and where */
let wasActive = false;
const summary = setInterval(() => {
  if (!on()) return;
  const now = Date.now(), act = [...visitors.values()].filter((v) => now - v.last <= ACTIVE_MS);
  for (const [k, v] of visitors) if (now - v.last > 6 * 3600e3) visitors.delete(k);
  if (!act.length) { if (wasActive) console.log("[active] nobody online"); wasActive = false; return; }
  wasActive = true;
  const signed = act.filter((v) => v.user).length, byTab = {};
  for (const v of act) { const t = TABS[v.tab] || "landing page"; byTab[t] = (byTab[t] || 0) + 1; }
  console.log(`[active] ${act.length} online (${signed} signed in, ${act.length - signed} guest${act.length - signed === 1 ? "" : "s"}) · ${Object.entries(byTab).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(", ")}`);
}, ACTIVE_MS);
if (summary.unref) summary.unref();

module.exports = { pageViews, router, touch, _visitors: visitors };
