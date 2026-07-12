/**
 * MERIDIAN — backend server
 * Public website + Terminal (8 modules) + live-data & analytics API.
 * Run:  npm install && npm start  →  http://localhost:3000
 */
require("dotenv").config();
const path = require("path");
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;
app.disable("x-powered-by");
app.set("trust proxy", 1); // Render terminates TLS at its proxy; lets req.secure + Secure cookies work

// ── gzip/brotli-negotiated compression — ~70% smaller JS/CSS/JSON payloads ──
app.use(require("compression")());

// ── rate limiting: 240/min standard, 10/min on heavy endpoints (report,
//    screener scan, earnings analyze, Excel export). 429 + Retry-After. ──
app.use("/api", require("./lib/rate-limit").apiLimiter);

// ── short shared-cache headers on cheap idempotent market GETs. Upstream
//    responses are already TTL-cached in-process; this additionally lets the
//    browser / Render edge absorb refresh-storm traffic. Never applied to
//    auth'd or user-specific routes. ──
const CACHEABLE = [/^\/pulse$/, /^\/quote\//, /^\/quotes$/, /^\/intel\/sectors$/, /^\/history\//];
app.use("/api", (req, res, next) => {
  if (req.method === "GET" && CACHEABLE.some((re) => re.test(req.path))) {
    res.set("Cache-Control", "public, max-age=15, stale-while-revalidate=30");
  }
  next();
});

app.use("/api", require("./routes/auth"));
app.use("/api", require("./routes/market"));
app.use("/api", require("./routes/company"));
app.use("/api", require("./routes/intel"));
app.use("/api", require("./routes/portfolio"));
app.use("/api", require("./routes/sectors"));
app.use("/api", require("./routes/support"));
app.use("/api", require("./routes/macro"));

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
app.listen(PORT, () => {
  console.log(`MERIDIAN running → http://localhost:${PORT}`);
  console.log(`Terminal        → http://localhost:${PORT}/terminal`);
  console.log(`Narrative engine: ${process.env.ANTHROPIC_API_KEY ? "Claude API (key detected)" : "deterministic rules (add ANTHROPIC_API_KEY in .env for AI-written reports)"}`);
  console.log(`Earnings transcripts: ${process.env.FMP_API_KEY ? "FMP (key detected)" : process.env.API_NINJAS_KEY ? "API Ninjas (key detected)" : "paste-only (add FMP_API_KEY or API_NINJAS_KEY in .env to fetch automatically)"}`);
  console.log(`Earnings estimates: ${process.env.FMP_API_KEY ? "FMP (key detected)" : "off (add FMP_API_KEY in .env)"}`);
  console.log(`Google sign-in: enabled (client ${(process.env.GOOGLE_CLIENT_ID || "default project client").slice(0, 24)}…)${process.env.SESSION_SECRET ? "" : " · ⚠ set SESSION_SECRET for persistent sessions"}`);
});
});
