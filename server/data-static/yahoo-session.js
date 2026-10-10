/**
 * Optional backup for the Yahoo session token on Render.
 *
 * The server sets up its own Yahoo session at start-up (fc.yahoo.com cookie → getcrumb, or the
 * crumb in the quote page) and re-tries with spacing when Yahoo refuses. If Yahoo ever refuses
 * Render's IP on every route, a session created here (a home connection Yahoo does not refuse)
 * can be given to the server instead: the token is tied to the cookie, not the IP.
 *
 *   node server/data-static/yahoo-session.js
 *
 * Writes YAHOO_COOKIE and YAHOO_CRUMB to .env.yahoo-session.local (git-ignored; the values are
 * not printed). Copy both into Render → Environment. If Yahoo later rejects them, the server
 * notices and goes back to minting its own session.
 */
const https = require("https");
const fs = require("fs");
const path = require("path");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const get = (url, headers = {}) => new Promise((resolve) => {
  const req = https.get(url, { headers: { "User-Agent": UA, ...headers }, maxHeaderSize: 256 * 1024 }, (res) => {
    let body = ""; res.setEncoding("utf8"); res.on("data", (d) => { if (body.length < 3e6) body += d; }); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
  });
  req.on("error", () => resolve(null)); req.setTimeout(15000, () => req.destroy());
});
(async () => {
  const a = await get("https://fc.yahoo.com/", { Accept: "text/html" });
  const cookie = ((a && a.headers["set-cookie"]) || []).map((c) => c.split(";")[0]).join("; ");
  if (!cookie) { console.error("Yahoo did not return a session cookie — try again in a few minutes."); process.exit(1); }
  let crumb = "";
  const r = await get("https://query2.finance.yahoo.com/v1/test/getcrumb", { cookie, Accept: "*/*" });
  if (r && r.status === 200) crumb = String(r.body || "").trim();
  if (!crumb || crumb.length > 64) {
    const p = await get("https://finance.yahoo.com/quote/AAPL/", { cookie, Accept: "text/html" });
    const m = p && /"crumb"\s*:\s*"([^"]{5,64})"/.exec(p.body || ""); crumb = m ? m[1].replace(/\\u002F/gi, "/") : "";
  }
  if (!crumb) { console.error("Could not obtain a crumb — try again in a few minutes."); process.exit(1); }
  // prove it works before saving it
  const t = await get(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/RELIANCE.NS?modules=price&crumb=${encodeURIComponent(crumb)}`, { cookie, Accept: "application/json" });
  if (!t || t.status !== 200) { console.error(`Yahoo did not accept the new session (status ${t && t.status}) — try again later.`); process.exit(1); }
  const out = path.join(__dirname, "..", "..", ".env.yahoo-session.local");
  fs.writeFileSync(out, `YAHOO_COOKIE=${cookie}\nYAHOO_CRUMB=${crumb}\n`);
  console.log(`Saved a working Yahoo session to ${path.relative(process.cwd(), out)} (git-ignored).`);
  console.log("Copy YAHOO_COOKIE and YAHOO_CRUMB from that file into Render → Environment, then redeploy. Do not commit the file.");
})();
