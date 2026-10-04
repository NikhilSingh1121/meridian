/* Yahoo Finance streamer PricingData message (wss://streamer.finance.yahoo.com, version=2).
   Field numbers match the public pricing.proto used by yfinance / yliveticker. */
const { decode, encode } = require("./proto");
const SCHEMA = {
  1: ["id", "string"], 2: ["price", "float"], 3: ["time", "sint64"], 4: ["currency", "string"], 5: ["exchange", "string"],
  6: ["quoteType", "enum"], 7: ["marketHours", "enum"], 8: ["changePercent", "float"], 9: ["dayVolume", "sint64"],
  10: ["dayHigh", "float"], 11: ["dayLow", "float"], 12: ["change", "float"], 13: ["shortName", "string"],
  14: ["expireDate", "sint64"], 15: ["openPrice", "float"], 16: ["previousClose", "float"], 17: ["strikePrice", "float"],
  18: ["underlyingSymbol", "string"], 19: ["openInterest", "sint64"], 20: ["optionsType", "enum"], 21: ["miniOption", "sint64"],
  22: ["lastSize", "sint64"], 23: ["bid", "float"], 24: ["bidSize", "sint64"], 25: ["ask", "float"], 26: ["askSize", "sint64"],
  27: ["priceHint", "sint64"], 28: ["vol24hr", "sint64"],
};
/** one streamer frame (JSON envelope or bare base64) → PricingData object, or null */
function parseFrame(data) {
  let b64 = data;
  if (typeof data === "string" && data.trimStart().startsWith("{")) {
    try { const j = JSON.parse(data); if (j.type && j.type !== "pricing") return null; b64 = j.message; } catch { return null; }
  }
  if (!b64) return null;
  const buf = Buffer.isBuffer(b64) ? b64 : Buffer.from(String(b64), "base64");
  const m = decode(buf, SCHEMA);
  if (!m.id) return null;
  // `time` is epoch ms in the v2 stream; guard against seconds
  if (m.time && m.time < 1e11) m.time *= 1000;
  return m;
}
const encodePricing = (obj) => encode(obj, SCHEMA).toString("base64");
module.exports = { parseFrame, encodePricing, SCHEMA };
