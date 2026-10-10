/** NSE session clock helpers — all in IST, independent of the host time zone.
 *  Exchange holidays are known from NSE's trading-holiday list (or, when NSE refuses,
 *  from Yahoo's session times for NIFTY 50 — see index.js); isMarketOpen() honours them,
 *  so a holiday reads as "closed", never as a frozen open market. */
const IST_OFFSET = 5.5 * 3600 * 1000;
const OPEN_MIN = 9 * 60 + 15, CLOSE_MIN = 15 * 60 + 30, SESSION_MIN = CLOSE_MIN - OPEN_MIN; // 375
const istParts = (ts) => { const d = new Date(ts + IST_OFFSET); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), dow: d.getUTCDay(), min: d.getUTCHours() * 60 + d.getUTCMinutes(), sec: d.getUTCSeconds() }; };
/** "YYYY-MM-DD" trading date in IST */
const istDate = (ts) => new Date(ts + IST_OFFSET).toISOString().slice(0, 10);
/** minute of the session (0 = 09:15), may be negative (pre-open) or ≥ 375 (post-close) */
const sessionMinute = (ts) => istParts(ts).min - OPEN_MIN;
/** epoch ms of IST 09:15 on the IST date of ts */
const sessionOpenTs = (ts) => { const p = istParts(ts); return Date.UTC(p.y, p.m, p.d, 9, 15) - IST_OFFSET; };
const minuteFloor = (ts) => Math.floor(ts / 60000) * 60000;

/* exchange holidays: "YYYY-MM-DD" → description */
const holidays = new Map();
function setHolidays(list) { for (const h of list || []) if (h && /^\d{4}-\d{2}-\d{2}$/.test(h.date)) holidays.set(h.date, h.name || "Exchange holiday"); }
const holidayOn = (ts = Date.now()) => holidays.get(istDate(ts)) || null;

function isMarketOpen(ts = Date.now()) { const p = istParts(ts); return p.dow >= 1 && p.dow <= 5 && p.min >= OPEN_MIN && p.min < CLOSE_MIN && !holidays.has(istDate(ts)); }

/** what the session is doing right now, in words the UI can show as-is */
function marketStatus(ts = Date.now()) {
  const p = istParts(ts), hol = holidayOn(ts);
  if (p.dow === 0 || p.dow === 6) return { open: false, reason: "weekend", text: "NSE is closed for the weekend — showing the last session." };
  if (hol) return { open: false, reason: "holiday", holiday: hol, text: `No trading session today — NSE holiday (${hol}). Showing the last session.` };
  if (p.min < OPEN_MIN) return { open: false, reason: "pre-open", text: "NSE opens at 09:15 IST — showing the last session until then." };
  if (p.min >= CLOSE_MIN) return { open: false, reason: "closed", text: "NSE closed at 15:30 IST — showing today's session as of close." };
  return { open: true, reason: "open", text: "NSE is open." };
}
const holidayList = () => [...holidays].map(([date, name]) => ({ date, name })).sort((a, b) => a.date.localeCompare(b.date));
module.exports = { holidayList, IST_OFFSET, OPEN_MIN, CLOSE_MIN, SESSION_MIN, istParts, istDate, sessionMinute, sessionOpenTs, minuteFloor, isMarketOpen, marketStatus, setHolidays, holidayOn };
