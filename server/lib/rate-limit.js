/**
 * MERIDIAN — rate limiting (dependency-free).
 *
 * Fixed-window counter per client IP per tier. In-memory (single-instance
 * deployment on Render), self-pruning, ~O(1) per request. Two tiers:
 *
 *   standard : general /api traffic          — 240 req / min / IP
 *   heavy    : CPU / LLM / scan endpoints    —  10 req / min / IP
 *              (/api/report, /api/screener/run, /api/earnings/analyze,
 *               /api/idcf/:sym/excel)
 *
 * 429 responses carry Retry-After. Health checks and static assets are not
 * routed through this middleware.
 */

const WINDOW_MS = 60 * 1000;

function makeLimiter({ max, name }) {
  const hits = new Map(); // ip -> { count, windowStart }
  // prune dead entries every few windows so the map can't grow unbounded
  setInterval(() => {
    const cutoff = Date.now() - 2 * WINDOW_MS;
    for (const [ip, rec] of hits) if (rec.windowStart < cutoff) hits.delete(ip);
  }, 5 * WINDOW_MS).unref();

  return function limiter(req, res, next) {
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || req.socket.remoteAddress || "unknown";
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
const heavy = makeLimiter({ max: 10, name: "heavy" });

/** Heavy-endpoint matcher — applied before the standard limiter. */
const HEAVY_PATTERNS = [
  /^\/report$/,
  /^\/company\/[^/]+\/workbook$/,
  /^\/screener\/run$/,
  /^\/earnings\/analyze$/,
  /^\/idcf\/[^/]+\/excel$/,
];

function apiLimiter(req, res, next) {
  const p = req.path;
  if (HEAVY_PATTERNS.some((re) => re.test(p))) return heavy(req, res, next);
  return standard(req, res, next);
}

module.exports = { apiLimiter, standard, heavy };
