/**
 * MERIDIAN — backend server
 * Public website + Terminal (8 modules) + live-data & analytics API.
 * Run:  npm install && npm start  →  http://localhost:3000
 */
require("dotenv").config();
require("./lib/upstream").install();              // every outbound call is metered; Yahoo calls are coalesced, paced and guarded
const path = require("path");
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;
app.disable("x-powered-by");
app.set("trust proxy", 1); // Render terminates TLS at its proxy; lets req.secure + Secure cookies work

// ── security headers on every response ──
// CSP allow-list = exactly the third parties the site uses: Google Fonts,
// Google Identity Services (sign-in) and Razorpay Checkout. 'unsafe-inline'
// stays on script-src because the Learning Center / legal pages use inline
// handlers; external script ORIGINS, framing, plugins and exfil targets are
// still locked down.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://accounts.google.com https://*.razorpay.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://accounts.google.com https://*.razorpay.com",
  "frame-src https://accounts.google.com https://*.razorpay.com https://www.youtube-nocookie.com https://www.youtube.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://*.razorpay.com",
  "frame-ancestors 'none'",
].join("; ");
app.use((req, res, next) => {
  res.set({
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(self \"https://checkout.razorpay.com\" \"https://api.razorpay.com\")",
    // allow-popups: Google sign-in popup must be able to message back
    "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
  });
  if (req.secure) res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});

// ── gzip/brotli-negotiated compression — ~70% smaller JS/CSS/JSON payloads ──
app.use(require("compression")());

// ── rate limiting: 240/min standard, 10/min on heavy endpoints (report,
//    earnings analyze, Excel export). 429 + Retry-After. ──
app.use("/api", require("./lib/rate-limit").apiLimiter);

// ── short shared-cache headers on cheap idempotent market GETs. Upstream
//    responses are already TTL-cached in-process; this additionally lets the
//    browser / Render edge absorb refresh-storm traffic. Never applied to
//    auth'd or user-specific routes. ──
const CACHEABLE = [/^\/pulse$/, /^\/quote\//, /^\/quotes$/, /^\/intel\/sectors$/, /^\/history\//];
app.use("/api", (req, res, next) => {
  if (req.method === "GET" && CACHEABLE.some((re) => re.test(req.path))) {
    res.set("Cache-Control", "public, max-age=1, stale-while-revalidate=5"); // live prices are overlaid per request
  }
  next();
});

// visitor activity → server log (who is online, which tab); no cookies, IPs never logged
const activity = require("./lib/activity");
app.use(activity.pageViews);
app.use("/api", activity.router);
app.use("/api", require("./routes/auth"));
app.use("/api", require("./routes/market"));
app.use("/api", require("./routes/company"));
app.use("/api", require("./routes/intel"));
app.use("/api", require("./routes/portfolio"));
app.use("/api", require("./routes/sectors"));
app.use("/api", require("./routes/support"));
app.use("/api", require("./routes/macro"));
app.use("/api", require("./routes/quant"));
// sector rotation (RRG) on official NSE indices, and the Yahoo load meter (diagnostics)
app.get("/api/market/rotation", async (req, res) => {
  try { const tf = req.query.tf === "daily" ? "daily" : "weekly"; res.json(await require("./cache").cached(`rrg:out:${tf}`, 60e3, () => require("./lib/rotation").rotation(tf))); }
  catch (e) { res.status(502).json({ error: "rotation unavailable" }); }
});
app.get("/api/upstream/status", (_req, res) => res.json(require("./lib/upstream").status()));
// Live Scanner (/api/scanner/*) + terminal-wide live quotes; the scanner starts on its first viewer
require("./scanner").mount(app);

app.use(express.static(path.join(__dirname, "..", "public"), { extensions: ["html"] }));
app.get("/healthz", (_req, res) => res.json({ ok: true, ts: Date.now() }));
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

// ── global error handler: never leak stacks, always answer JSON on /api ──
app.use((err, req, res, _next) => {
  console.error(`[error] ${req.method} ${req.originalUrl} →`, err && err.message);
  if (res.headersSent) return;
  if (req.originalUrl.startsWith("/api")) return res.status(500).json({ error: "Internal error" });
  res.status(500).send("Internal error");
});

require("./lib/datastore").init().then(() => {
// Restore ephemeral counters from env seeds (Render wipes the disk on redeploy):
//   SUPPORT_SEED_INR → community-goal total ; FIIDII_SEED → FII/DII chart history.
try { require("./lib/payments-store").seedFromEnv(); } catch (e) { console.warn("[seed] payments:", e.message); }
try { require("./providers/nse").seedHistoryFromEnv(); } catch (e) { console.warn("[seed] fiidii:", e.message); }
app.listen(PORT, () => {
  console.log(`MERIDIAN running → http://localhost:${PORT}`);
  console.log(`Terminal        → http://localhost:${PORT}/terminal`);
  console.log(`Narrative engine: ${process.env.ANTHROPIC_API_KEY ? "Claude API (key detected)" : "deterministic rules (add ANTHROPIC_API_KEY in .env for AI-written reports)"}`);
  { const g = require("./lib/insights/gemini"); console.log(`Research layer: ${g.hasKey() ? `Gemini ${g.MODELS().join(" → ")} · exchange filings + news + document reading${(process.env.GEMINI_SEARCH || "off") === "off" ? "" : " + Google Search grounding when available"}` : "off (set GEMINI_API_KEY in .env for researched reports)"}`); }
  console.log(`Earnings transcripts: ${process.env.FMP_API_KEY ? "FMP (key detected)" : process.env.API_NINJAS_KEY ? "API Ninjas (key detected)" : "paste-only (add FMP_API_KEY or API_NINJAS_KEY in .env to fetch automatically)"}`);
  console.log(`Earnings estimates: ${process.env.FMP_API_KEY ? "FMP (key detected)" : "off (add FMP_API_KEY in .env)"}`);
  console.log(`Google sign-in: enabled (client ${(process.env.GOOGLE_CLIENT_ID || "default project client").slice(0, 24)}…)${process.env.SESSION_SECRET ? "" : " · ⚠ set SESSION_SECRET for persistent sessions"}`);
});
});
