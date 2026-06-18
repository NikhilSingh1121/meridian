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

app.use("/api", require("./routes/market"));
app.use("/api", require("./routes/company"));
app.use("/api", require("./routes/intel"));

app.use(express.static(path.join(__dirname, "..", "public"), { extensions: ["html"] }));
app.get("/healthz", (_req, res) => res.json({ ok: true, ts: Date.now() }));
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

app.listen(PORT, () => {
  console.log(`MERIDIAN running → http://localhost:${PORT}`);
  console.log(`Terminal        → http://localhost:${PORT}/terminal`);
  console.log(`Narrative engine: ${process.env.ANTHROPIC_API_KEY ? "Claude API (key detected)" : "deterministic rules (add ANTHROPIC_API_KEY in .env for AI-written reports)"}`);
  console.log(`Earnings transcripts: ${process.env.FMP_API_KEY ? "FMP (key detected)" : process.env.API_NINJAS_KEY ? "API Ninjas (key detected)" : "paste-only (add FMP_API_KEY or API_NINJAS_KEY in .env to fetch automatically)"}`);
  console.log(`Earnings estimates: ${process.env.FMP_API_KEY ? "FMP (key detected)" : "off (add FMP_API_KEY in .env)"}`);
});
