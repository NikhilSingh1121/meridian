/**
 * MERIDIAN — rate limiting (dependency-free).
 *
 * Fixed-window counter per client IP per tier. In-memory (single-instance
 * deployment on Render), self-pruning, ~O(1) per request. Two tiers:
 *
 *   standard : general /api traffic          — 240 req / min / IP
 *   compute  : Quant Lab engines             —  60 req / min / IP
 *              (parameter surfaces, walk-forward folds and bootstrap paths are
 *               CPU-bound but sub-second and cached, so they sit between the
 *               two other tiers rather than in `heavy`)
 *   heavy    : CPU / LLM / scan endpoints    —  10 req / min / IP
 *              (/api/report, /api/earnings/analyze,
 *               /api/idcf/:sym/excel)
 *
 * 429 responses carry Retry-After. Health checks and static assets are not
 * routed through this middleware.
 */

const WINDOW_MS = 60 * 1000;

/* Client identity for the limiter. The raw first X-Forwarded-For entry is
   client-controlled, so keying on it let anyone reset their bucket per request.
   Render sits behind Cloudflare, which OVERWRITES CF-Connecting-IP with the
   real client address; locally (no Cloudflare) fall back to Express's req.ip,
   which honours `trust proxy` instead of a spoofable header. */
function clientIp(req) {
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf.trim()) return cf.trim();
  return req.ip || (req.socket && req.socket.remoteAddress) || "unknown";
}

function makeLimiter({ max, name }) {
  const hits = new Map(); // ip -> { count, windowStart }
  // prune dead entries every few windows so the map can't grow unbounded
  setInterval(() => {
    const cutoff = Date.now() - 2 * WINDOW_MS;
    for (const [ip, rec] of hits) if (rec.windowStart < cutoff) hits.delete(ip);
  }, 5 * WINDOW_MS).unref();

  return function limiter(req, res, next) {
    const ip = clientIp(req);
    const now = Date.now();
    let rec = hits.get(ip);
    if (!rec || now - rec.windowStart >= WINDOW_MS) {
      rec = { count: 0, windowStart: now };
      hits.set(ip, rec);
    }
    rec.count++;
    if (rec.count > max) {
      const retryAfter = Math.ceil((rec.windowStart + WINDOW_MS - now) / 1000);
      res.set("Retry-After", String(Math.max(retryAfter, 1)));
      return res.status(429).json({ error: `Rate limit exceeded (${name}) — retry in ${retryAfter}s` });
    }
    next();
  };
}

const standard = makeLimiter({ max: 240, name: "standard" });
const compute = makeLimiter({ max: 60, name: "compute" });
const heavy = makeLimiter({ max: 10, name: "heavy" });

/** Heavy-endpoint matcher — applied before the standard limiter. */
const HEAVY_PATTERNS = [
  /^\/report$/,
  /^\/company\/[^/]+\/workbook$/,
  /^\/earnings\/analyze$/,
  /^\/idcf\/[^/]+\/excel$/,
];

/** Quant Lab: CPU-bound but fast and cached — its own middle tier. */
const COMPUTE_PATTERNS = [/^\/quant\//];

function apiLimiter(req, res, next) {
  const p = req.path;
  if (HEAVY_PATTERNS.some((re) => re.test(p))) return heavy(req, res, next);
  // starting document reading spends model quota (polling its progress does not)
  if (req.method === "POST" && /^\/company\/[^/]+\/deep$/.test(p)) return heavy(req, res, next);
  if (COMPUTE_PATTERNS.some((re) => re.test(p))) return compute(req, res, next);
  return standard(req, res, next);
}

module.exports = { apiLimiter, standard, compute, heavy };
