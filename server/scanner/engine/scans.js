/**
 * Preset scans + user-saved custom scans (server/data/scanner/scans.json).
 * Thresholds are starting points, documented in SCANNER_PROGRESS.md; every preset can be
 * cloned and edited in the scan builder.
 */
const fs = require("fs");
const path = require("path");
const C = require("./conditions");

const R = (field, op, value) => ({ field, op, value });
const AND = (...rules) => ({ op: "AND", rules }), OR = (...rules) => ({ op: "OR", rules });
const PRESETS = [
  { id: "vol_breakout", name: "Volume spike + breakout", bias: 1, tag: "VOL▲BRK", logic: AND(R("rvol", ">=", 2), OR(R("brkN", "==", 1), R("orb", "==", 1), R("brk52", "==", 1)), R("m5", ">", 0.3)) },
  { id: "vol_breakdown", name: "Volume spike + breakdown", bias: -1, tag: "VOL▼BRK", logic: AND(R("rvol", ">=", 2), OR(R("brkN", "==", -1), R("orb", "==", -1), R("brk52", "==", -1)), R("m5", "<", -0.3)) },
  { id: "squeeze_release", name: "Squeeze release", bias: 0, tag: "SQZ FIRE", logic: AND(R("sqzFire", "!=", 0), R("vspike", ">=", 1.5)) },
  { id: "squeeze_building", name: "Squeeze building (coiling)", bias: 0, tag: "SQZ", logic: AND(R("sqz", "==", true), R("sqzBars", ">=", 20)) },
  { id: "gap_and_go", name: "Gap and go", bias: 1, tag: "GAP&GO", logic: AND(R("gap", ">=", 1), R("orb", "==", 1), R("vwapD", ">", 0), R("rvol", ">=", 1.5)) },
  { id: "gap_down_go", name: "Gap down and follow-through", bias: -1, tag: "GAP▼GO", logic: AND(R("gap", "<=", -1), R("orb", "==", -1), R("vwapD", "<", 0), R("rvol", ">=", 1.5)) },
  { id: "gap_fill", name: "Gap fading (fill in progress)", bias: 0, tag: "GAP FILL", logic: OR(AND(R("gap", ">=", 1.5), R("vwapD", "<", 0), R("m15", "<", 0)), AND(R("gap", "<=", -1.5), R("vwapD", ">", 0), R("m15", ">", 0))) },
  { id: "rs_leaders", name: "Relative strength leaders", bias: 1, tag: "RS▲", logic: AND(R("rsN", ">=", 1.5), R("rsS", ">=", 0.75), R("vwapD", ">", 0), R("m15", ">", 0)) },
  { id: "rs_laggards", name: "Relative weakness", bias: -1, tag: "RS▼", logic: AND(R("rsN", "<=", -1.5), R("rsS", "<=", -0.75), R("vwapD", "<", 0), R("m15", "<", 0)) },
  { id: "momentum_burst", name: "Momentum burst (1-min)", bias: 0, tag: "BURST", logic: AND(OR(R("m1", ">=", 0.5), R("m1", "<=", -0.5)), R("vspike", ">=", 3)) },
  { id: "hi52", name: "52-week high with volume", bias: 1, tag: "52W▲", logic: AND(R("brk52", "==", 1), R("rvol", ">=", 1.5)) },
  { id: "lo52", name: "52-week low with volume", bias: -1, tag: "52W▼", logic: AND(R("brk52", "==", -1), R("rvol", ">=", 1.5)) },
  { id: "near_high", name: "Coiling under N-day high", bias: 1, tag: "NEAR HI", logic: AND(R("distN", "between", [-1, 0]), R("rvol", ">=", 1.2), R("rangeAtr", "<", 0.8)) },
  { id: "vwap_reclaim", name: "VWAP reclaim on volume", bias: 1, tag: "VWAP▲", logic: AND(R("vwapD", "crossAbove", 0), R("rvol", ">=", 1.5)) },
  { id: "oi_long_buildup", name: "F&O long build-up (price ↑ OI ↑)", bias: 1, tag: "LONG BU", logic: AND(R("fno", "==", true), R("pct", ">=", 0.75), R("oiPct", ">=", 4)) },
  { id: "oi_short_buildup", name: "F&O short build-up (price ↓ OI ↑)", bias: -1, tag: "SHORT BU", logic: AND(R("fno", "==", true), R("pct", "<=", -0.75), R("oiPct", ">=", 4)) },
  { id: "range_expansion", name: "Range expansion (> 1.5× ATR)", bias: 0, tag: "RANGE+", logic: AND(R("rangeAtr", ">=", 1.5), R("rvol", ">=", 1.5)) },
].map((p) => ({ ...p, preset: true, enabled: true, cooldownSec: 900 }));

class ScanBook {
  constructor(dir) { this.file = dir ? path.join(dir, "scans.json") : null; this.custom = []; this.overrides = {}; this.load(); }
  load() {
    if (!this.file) return;
    try { const j = JSON.parse(fs.readFileSync(this.file, "utf8")); this.custom = (j.custom || []).map((s) => ({ ...s, logic: C.validate(s.logic) })); this.overrides = j.overrides || {}; } catch { }
  }
  save() {
    if (!this.file) return;
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); const tmp = this.file + ".tmp"; fs.writeFileSync(tmp, JSON.stringify({ custom: this.custom, overrides: this.overrides }, null, 1)); fs.renameSync(tmp, this.file); } catch (e) { console.warn("[scanner] scans save:", e.message); }
  }
  all() { return [...PRESETS.map((p) => ({ ...p, ...(this.overrides[p.id] || {}) })), ...this.custom]; }
  active() { return this.all().filter((s) => s.enabled !== false); }
  get(id) { return this.all().find((s) => s.id === id) || null; }
  upsert(input) {
    const name = String(input.name || "").trim().slice(0, 60); if (!name) throw new Error("scan needs a name");
    const logic = C.validate(input.logic);
    const cooldownSec = Math.max(30, Math.min(86400, +input.cooldownSec || 900));
    const bias = [1, -1, 0].includes(+input.bias) ? +input.bias : 0;
    const tag = String(input.tag || name).toUpperCase().slice(0, 10);
    let id = input.id && !PRESETS.some((p) => p.id === input.id) ? String(input.id).replace(/[^a-z0-9_-]/gi, "").slice(0, 40) : null;
    if (!id) id = "u_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const scan = { id, name, logic, cooldownSec, bias, tag, enabled: input.enabled !== false, preset: false, alert: !!input.alert, createdAt: input.createdAt || Date.now() };
    const i = this.custom.findIndex((s) => s.id === id);
    if (i >= 0) this.custom[i] = scan; else { if (this.custom.length >= 100) throw new Error("at most 100 custom scans"); this.custom.push(scan); }
    this.save(); return scan;
  }
  remove(id) { const n = this.custom.length; this.custom = this.custom.filter((s) => s.id !== id); if (this.custom.length !== n) this.save(); return this.custom.length !== n; }
  setFlags(id, flags) {
    const allowed = {}; if ("enabled" in flags) allowed.enabled = !!flags.enabled; if ("alert" in flags) allowed.alert = !!flags.alert; if ("cooldownSec" in flags) allowed.cooldownSec = Math.max(30, Math.min(86400, +flags.cooldownSec || 900));
    if (PRESETS.some((p) => p.id === id)) { this.overrides[id] = { ...(this.overrides[id] || {}), ...allowed }; this.save(); return this.get(id); }
    const s = this.custom.find((x) => x.id === id); if (!s) return null; Object.assign(s, allowed); this.save(); return s;
  }
}
module.exports = { PRESETS, ScanBook, AND, OR, R };
