/**
 * NSE derivative expiry calendar (rule-based, holidays NOT applied — a broker or NSE
 * contract list overrides this whenever available).
 * Since Sep-2025: NIFTY weekly + monthly expiries on Tuesday; all other index and
 * stock derivatives expire monthly on the last Tuesday of the month.
 */
const { istDate, IST_OFFSET } = require("../store/session");
const TUE = 2;
function dayUTC(dateStr) { return new Date(dateStr + "T00:00:00Z"); }
function lastTuesday(y, m) { const d = new Date(Date.UTC(y, m + 1, 0)); while (d.getUTCDay() !== TUE) d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }
function expiries(underlying, fromTs = Date.now(), { weeks = 4, months = 3 } = {}) {
  const today = istDate(fromTs);
  const out = new Set();
  if (underlying === "NIFTY") {
    const d = dayUTC(today);
    while (out.size < weeks) { if (d.getUTCDay() === TUE && d.toISOString().slice(0, 10) >= today) out.add(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  }
  const t = dayUTC(today);
  for (let k = 0, got = 0; got < months && k < 6; k++) {
    const e = lastTuesday(t.getUTCFullYear(), t.getUTCMonth() + k);
    if (e >= today) { out.add(e); got++; }
  }
  return [...out].sort();
}
/** year fraction from ts to expiry at 15:30 IST */
function yearsTo(expiry, ts = Date.now()) {
  const end = Date.parse(expiry + "T15:30:00Z") - IST_OFFSET;
  return Math.max(0, (end - ts) / (365 * 86400000));
}
module.exports = { expiries, yearsTo, lastTuesday };
