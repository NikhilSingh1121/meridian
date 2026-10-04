/**
 * Scan-builder condition language.
 *   rule  = { field, op, value }        op: > >= < <= == != between crossAbove crossBelow
 *           value: number | [lo, hi] (between) | "@otherField" (compare two fields) | true/false | string (sector)
 *   group = { op: "AND" | "OR", rules: [rule | group, …] }   (nest up to 3 levels)
 * Cross operators compare the previous evaluation's value with the current one.
 */
const FIELDS = [
  { key: "s", label: "Symbol", type: "str" },
  { key: "pct", label: "% change today", unit: "%", type: "num" },
  { key: "ltp", label: "Last price", unit: "₹", type: "num" },
  { key: "rvol", label: "Relative volume (vs time-of-day avg)", unit: "×", type: "num" },
  { key: "vspike", label: "1-min volume spike (vs same minute avg)", unit: "×", type: "num" },
  { key: "m1", label: "Momentum 1 min", unit: "%", type: "num" },
  { key: "m5", label: "Momentum 5 min", unit: "%", type: "num" },
  { key: "m15", label: "Momentum 15 min", unit: "%", type: "num" },
  { key: "vwapD", label: "Distance from VWAP", unit: "%", type: "num" },
  { key: "gap", label: "Opening gap", unit: "%", type: "num" },
  { key: "orb", label: "Opening-range breakout (1 up · −1 down · 0 inside)", type: "enum", values: [-1, 0, 1] },
  { key: "brkN", label: "N-day breakout (1 above high · −1 below low)", type: "enum", values: [-1, 0, 1] },
  { key: "brk52", label: "52-week breakout (1 high · −1 low)", type: "enum", values: [-1, 0, 1] },
  { key: "distN", label: "Distance to N-day high", unit: "%", type: "num" },
  { key: "sqz", label: "Squeeze on (BB inside Keltner)", type: "bool" },
  { key: "sqzBars", label: "Squeeze length (1-min bars)", type: "num" },
  { key: "sqzFire", label: "Squeeze released (1 up · −1 down, last 10 min)", type: "enum", values: [-1, 0, 1] },
  { key: "atrPct", label: "Daily ATR", unit: "% of price", type: "num" },
  { key: "rangeAtr", label: "Today's range ÷ daily ATR", unit: "×", type: "num" },
  { key: "rsN", label: "Relative strength vs NIFTY (pp)", unit: "pp", type: "num" },
  { key: "rsS", label: "Relative strength vs sector (pp)", unit: "pp", type: "num" },
  { key: "nh", label: "New intraday highs (count)", type: "num" },
  { key: "nl", label: "New intraday lows (count)", type: "num" },
  { key: "oiPct", label: "OI change today", unit: "%", type: "num" },
  { key: "score", label: "Signal score (0–100)", type: "num" },
  { key: "vol", label: "Volume today", type: "num" },
  { key: "fno", label: "In F&O", type: "bool" },
  // price levels — mostly used as references, e.g. { field: "ltp", op: ">", value: "@orbH" }
  { key: "vwap", label: "VWAP", unit: "₹", type: "num", level: true },
  { key: "orbH", label: "Opening-range high", unit: "₹", type: "num", level: true },
  { key: "orbL", label: "Opening-range low", unit: "₹", type: "num", level: true },
  { key: "hiN", label: "N-day high", unit: "₹", type: "num", level: true },
  { key: "hi52", label: "52-week high", unit: "₹", type: "num", level: true },
  { key: "lo52", label: "52-week low", unit: "₹", type: "num", level: true },
  { key: "pc", label: "Previous close", unit: "₹", type: "num", level: true },
  { key: "o", label: "Day open", unit: "₹", type: "num", level: true },
  { key: "h", label: "Day high", unit: "₹", type: "num", level: true },
  { key: "l", label: "Day low", unit: "₹", type: "num", level: true },
  { key: "sec", label: "Sector", type: "str" },
];
const FIELD = Object.fromEntries(FIELDS.map((f) => [f.key, f]));
const OPS = [">", ">=", "<", "<=", "==", "!=", "between", "crossAbove", "crossBelow"];

function validate(node, depth = 0) {
  if (!node || typeof node !== "object") throw new Error("empty condition");
  if (node.rules) {
    if (!["AND", "OR"].includes(node.op)) throw new Error("group op must be AND or OR");
    if (!Array.isArray(node.rules) || !node.rules.length) throw new Error("empty group");
    if (depth > 3) throw new Error("groups nest at most 3 deep");
    if (node.rules.length > 20) throw new Error("at most 20 rules per group");
    return { op: node.op, rules: node.rules.map((r) => validate(r, depth + 1)) };
  }
  const f = FIELD[node.field]; if (!f) throw new Error("unknown field " + node.field);
  if (!OPS.includes(node.op)) throw new Error("unknown operator " + node.op);
  let v = node.value;
  if (node.op === "between") { if (!Array.isArray(v) || v.length !== 2 || !v.every(Number.isFinite)) throw new Error(`${f.key}: between needs [lo, hi]`); v = [Math.min(...v), Math.max(...v)]; }
  else if (typeof v === "string" && v.startsWith("@")) { if (!FIELD[v.slice(1)]) throw new Error("unknown field " + v); }
  else if (f.type === "bool") v = v === true || v === "true" || v === 1;
  else if (f.type === "str") v = String(v).slice(0, 60);
  else { v = +v; if (!Number.isFinite(v)) throw new Error(`${f.key}: value must be a number`); }
  if ((f.type === "bool" || f.type === "str") && !["==", "!="].includes(node.op)) throw new Error(`${f.key}: use == or !=`);
  return { field: f.key, op: node.op, value: v };
}

/** evaluate → { ok, met:[description…] }. prev = previous row (for cross ops). */
function evaluate(node, row, prev) {
  if (node.rules) {
    const met = [];
    if (node.op === "AND") { for (const r of node.rules) { const e = evaluate(r, row, prev); if (!e.ok) return { ok: false, met: [] }; met.push(...e.met); } return { ok: true, met }; }
    for (const r of node.rules) { const e = evaluate(r, row, prev); if (e.ok) met.push(...e.met); }
    return { ok: met.length > 0, met };
  }
  const x = row[node.field];
  const v = typeof node.value === "string" && node.value.startsWith("@") ? row[node.value.slice(1)] : node.value;
  if (x === null || x === undefined || (typeof x === "number" && !Number.isFinite(x))) return { ok: false, met: [] };
  let ok;
  switch (node.op) {
    case ">": ok = x > v; break; case ">=": ok = x >= v; break; case "<": ok = x < v; break; case "<=": ok = x <= v; break;
    case "==": ok = x === v || (typeof x === "boolean" && x === !!v); break; case "!=": ok = x !== v; break;
    case "between": ok = x >= v[0] && x <= v[1]; break;
    case "crossAbove": { const p = prev && prev[node.field]; ok = Number.isFinite(p) && p <= v && x > v; break; }
    case "crossBelow": { const p = prev && prev[node.field]; ok = Number.isFinite(p) && p >= v && x < v; break; }
    default: ok = false;
  }
  return ok ? { ok, met: [describe(node, x)] } : { ok: false, met: [] };
}
function fmt(v) { return typeof v === "number" ? (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en-IN") : +v.toFixed(2)) : String(v); }
function describe(node, actual) {
  const f = FIELD[node.field], u = f.unit && f.unit !== "₹" ? f.unit : "";
  const val = Array.isArray(node.value) ? `${fmt(node.value[0])}–${fmt(node.value[1])}` : fmt(node.value);
  const opTxt = { crossAbove: "crossed above", crossBelow: "crossed below", between: "in" }[node.op] || node.op;
  return `${f.label.replace(/ \(.*\)$/, "")} ${opTxt} ${val}${typeof node.value === "number" ? u : ""}${actual !== undefined ? ` (now ${fmt(actual)}${typeof actual === "number" ? u : ""})` : ""}`;
}
/** fields a scan references (for UI + dependency checks) */
function fieldsOf(node, out = new Set()) { if (node.rules) node.rules.forEach((r) => fieldsOf(r, out)); else { out.add(node.field); if (typeof node.value === "string" && node.value.startsWith("@")) out.add(node.value.slice(1)); } return out; }
module.exports = { FIELDS, FIELD, OPS, validate, evaluate, describe, fieldsOf };
