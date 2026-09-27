/**
 * xlsx-tpl — a small XML-level engine for filling an .xlsx TEMPLATE without
 * losing anything the template carries (charts, form controls, sparklines,
 * data validations, images, print setup, styles).
 *
 * ExcelJS round-trips drop charts and form controls, so the DCF export works on
 * the package itself: each sheet's <sheetData> is regenerated from template rows
 * ("clone the template row's styled cells, then write values/formulas"), while
 * everything outside <sheetData> is kept and patched surgically.
 *
 *   const wb = await TplWorkbook.load(buffer);
 *   const s = wb.sheet("Assumptions");
 *   s.cloneRow(12, 12, colMap);            // template row 12 → new row 12
 *   s.set(12, 16, { f: "O12*(1+P13)" });  // formula, keeps the cloned style
 *   s.set(12, 13, 4500, s.tplStyle("M12"));
 *   const buf = await wb.toBuffer();
 */
const JSZip = require("jszip");

/* ── A1 helpers ─────────────────────────────────────────────────────────── */
function colName(n) { let s = ""; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; }
function colNum(s) { let n = 0; for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }
function a1(r, c, absR = false, absC = false) { return `${absC ? "$" : ""}${colName(c)}${absR ? "$" : ""}${r}`; }
function parseA1(ref) { const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(ref); return m ? { c: colNum(m[1]), r: +m[2] } : null; }
const xmlEsc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const xmlUnesc = (s) => String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
/* sheet reference prefix for formulas: Financials! / 'Terminal Value'! */
function sref(name) { return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? `${name}!` : `'${name.replace(/'/g, "''")}'!`; }

/* ── styles.xml: clone cell formats with tweaks ─────────────────────────── */
class StyleTable {
  constructor(xml) {
    this.xml = xml;
    this.fonts = xml.match(/<fonts[^>]*>([\s\S]*?)<\/fonts>/)[1].match(/<font\/>|<font>[\s\S]*?<\/font>/g);
    this.fills = xml.match(/<fills[^>]*>([\s\S]*?)<\/fills>/)[1].match(/<fill\/>|<fill>[\s\S]*?<\/fill>/g);
    this.borders = xml.match(/<borders[^>]*>([\s\S]*?)<\/borders>/)[1].match(/<border\/>|<border[ >][\s\S]*?<\/border>|<border [^>]*\/>/g);
    this.xfs = xml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)[1].match(/<xf [^>]*\/>|<xf [^>]*>[\s\S]*?<\/xf>/g);
    const nf = xml.match(/<numFmts[^>]*>([\s\S]*?)<\/numFmts>/);
    this.numFmts = nf ? nf[1].match(/<numFmt [^>]*\/>/g) : [];
    this.nfByCode = new Map(this.numFmts.map((x) => [xmlUnesc(/formatCode="([^"]*)"/.exec(x)[1]), +/numFmtId="(\d+)"/.exec(x)[1]]));
    this.nextNf = Math.max(163, ...[...this.nfByCode.values()]) + 1;
    this.dxfs = [];
    this.cache = new Map();
  }
  numFmtId(code) {
    const builtin = { General: 0, "0": 1, "0.00": 2, "#,##0": 3, "#,##0.00": 4, "0%": 9, "0.00%": 10, "@": 49 };
    if (builtin[code] != null) return builtin[code];
    if (this.nfByCode.has(code)) return this.nfByCode.get(code);
    const id = this.nextNf++;
    this.numFmts.push(`<numFmt numFmtId="${id}" formatCode="${xmlEsc(code)}"/>`);
    this.nfByCode.set(code, id);
    return id;
  }
  /* derive a new xf from base xf index `s`. opts: numFmt, color (ARGB), bold, italic, size,
     fill (ARGB | null to clear), halign, wrap, indent, borderFrom (xf index to copy border from) */
  variant(s, opts = {}) {
    const key = s + "|" + JSON.stringify(opts);
    if (this.cache.has(key)) return this.cache.get(key);
    let xf = this.xfs[s] || this.xfs[0];
    const attr = (name, val) => { xf = new RegExp(` ${name}="[^"]*"`).test(xf) ? xf.replace(new RegExp(` ${name}="[^"]*"`), ` ${name}="${val}"`) : xf.replace(/^<xf /, `<xf ${name}="${val}" `); };
    if (opts.numFmt != null) { attr("numFmtId", this.numFmtId(opts.numFmt)); attr("applyNumberFormat", 1); }
    if (opts.color != null || opts.bold != null || opts.italic != null || opts.size != null || opts.underline != null) {
      const fid = +(/fontId="(\d+)"/.exec(xf) || [0, 0])[1];
      let f = this.fonts[fid] || this.fonts[0];
      if (f === "<font/>") f = "<font></font>";
      const strip = (tag) => { f = f.replace(new RegExp(`<${tag}(?: [^>]*)?/>`), ""); };
      if (opts.bold != null) { strip("b"); if (opts.bold) f = f.replace("<font>", "<font><b/>"); }
      if (opts.italic != null) { strip("i"); if (opts.italic) f = f.replace("<font>", "<font><i/>"); }
      if (opts.underline != null) { strip("u"); if (opts.underline) f = f.replace(/(<sz )/, "<u/>$1"); }
      if (opts.size != null) f = f.replace(/<sz val="[^"]*"\/>/, `<sz val="${opts.size}"/>`);
      if (opts.color != null) { strip("color"); f = f.replace(/(<sz [^>]*\/>)/, `$1<color rgb="${opts.color}"/>`); }
      this.fonts.push(f);
      attr("fontId", this.fonts.length - 1); attr("applyFont", 1);
    }
    if (opts.fill !== undefined) {
      if (opts.fill === null) attr("fillId", 0);
      else { this.fills.push(`<fill><patternFill patternType="solid"><fgColor rgb="${opts.fill}"/><bgColor indexed="64"/></patternFill></fill>`); attr("fillId", this.fills.length - 1); }
      attr("applyFill", 1);
    }
    if (opts.borderFrom != null) { const b = /borderId="(\d+)"/.exec(this.xfs[opts.borderFrom] || ""); attr("borderId", b ? b[1] : 0); attr("applyBorder", 1); }
    if (opts.noBorder) { attr("borderId", 0); attr("applyBorder", 1); }
    if (opts.border) {   // { bottom: "thin", top: "thin", left, right, color: "FFD9D9D9" }
      const b = opts.border, side = (n) => (b[n] ? `<${n} style="${b[n]}"><color rgb="${b.color || "FFBFBFBF"}"/></${n}>` : `<${n}/>`);
      this.borders.push(`<border>${side("left")}${side("right")}${side("top")}${side("bottom")}<diagonal/></border>`);
      attr("borderId", this.borders.length - 1); attr("applyBorder", 1);
    }
    if (opts.halign != null || opts.wrap != null || opts.indent != null || opts.valign != null) {
      let al = (/<alignment [^>]*\/>/.exec(xf) || [""])[0];
      const set = (n, v) => { al = al ? (new RegExp(` ${n}="[^"]*"`).test(al) ? al.replace(new RegExp(` ${n}="[^"]*"`), ` ${n}="${v}"`) : al.replace("<alignment ", `<alignment ${n}="${v}" `)) : `<alignment ${n}="${v}"/>`; };
      if (opts.halign != null) set("horizontal", opts.halign);
      if (opts.valign != null) set("vertical", opts.valign);
      if (opts.wrap != null) set("wrapText", opts.wrap ? 1 : 0);
      if (opts.indent != null) set("indent", opts.indent);
      if (/<alignment /.test(xf)) xf = xf.replace(/<alignment [^>]*\/>/, al);
      else if (/\/>$/.test(xf)) xf = xf.replace(/\/>$/, `>${al}</xf>`);
      else xf = xf.replace(/<\/xf>$/, `${al}</xf>`);
      attr("applyAlignment", 1);
    }
    xf = xf.replace(/ xfId="\d+"/, ' xfId="0"');
    this.xfs.push(xf);
    const id = this.xfs.length - 1;
    this.cache.set(key, id);
    return id;
  }
  /* conditional-format style (differential). font color / fill / bold */
  dxf({ color, fill, bold } = {}) {
    const f = color || bold ? `<font>${bold ? "<b/>" : ""}${color ? `<color rgb="${color}"/>` : ""}</font>` : "";
    const fl = fill ? `<fill><patternFill patternType="solid"><fgColor rgb="${fill}"/><bgColor rgb="${fill}"/></patternFill></fill>` : "";
    this.dxfs.push(`<dxf>${f}${fl}</dxf>`);
    return this.dxfs.length - 1;
  }
  toXml() {
    let x = this.xml;
    const rep = (tag, items, extra = "") => {
      x = x.replace(new RegExp(`<${tag}( [^>]*)?(?:/>|>[\\s\\S]*?</${tag}>)`), (m, attrs) => {
        const a = (attrs || "").replace(/ count="\d+"/, "");
        return `<${tag} count="${items.length}"${a}${extra}>${items.join("")}</${tag}>`;
      });
    };
    if (/<numFmts/.test(x)) rep("numFmts", this.numFmts); else x = x.replace(/(<styleSheet[^>]*>)/, `$1<numFmts count="${this.numFmts.length}">${this.numFmts.join("")}</numFmts>`);
    rep("fonts", this.fonts); rep("fills", this.fills); rep("borders", this.borders); rep("cellXfs", this.xfs);
    if (this.dxfs.length) rep("dxfs", this.dxfs);
    return x;
  }
}

/* ── one worksheet ──────────────────────────────────────────────────────── */
class TplSheet {
  constructor(wb, name, path, xml, relsPath) {
    this.wb = wb; this.name = name; this.path = path; this.xml = xml; this.relsPath = relsPath;
    this.tpl = new Map();     // template cells: "r,c" → { s, raw }
    this.tplRows = new Map(); // template row attrs
    this.rows = new Map();    // new content: r → Map(c → cell)
    this.rowAttr = new Map();
    this.merges = [];
    this.cf = [];             // conditionalFormatting blocks (xml)
    this.dv = [];             // dataValidation blocks (xml)
    this.links = [];          // internal hyperlinks { ref, location, display }
    this.cols = null;         // replaced <cols> xml (null = keep template)
    if (xml) this._parseTemplate();
  }
  _parseTemplate() {
    const sd = /<sheetData>([\s\S]*?)<\/sheetData>|<sheetData\/>/.exec(this.xml);
    const body = sd && sd[1] ? sd[1] : "";
    const rowRe = /<row ([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g; let m;
    while ((m = rowRe.exec(body))) {
      const r = +/r="(\d+)"/.exec(m[1])[1];
      this.tplRows.set(r, (" " + m[1]).replace(/\sr="\d+"/, "").replace(/\sspans="[^"]*"/, "").replace(/\sx14ac:dyDescent="[^"]*"/, "").trim());
      const cellRe = /<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g; let cm;
      while ((cm = cellRe.exec(m[2] || ""))) {
        const ref = /r="([A-Z]+\d+)"/.exec(cm[1])[1]; const p = parseA1(ref);
        const s = +(/ s="(\d+)"/.exec(" " + cm[1]) || [0, 0])[1];
        this.tpl.set(p.r + "," + p.c, { s, attrs: cm[1], inner: cm[2] || "" });
      }
    }
  }
  /* rebuild <cols> by sending every template column through the same column map as the cells;
     `override` (col → attrs string) wins, e.g. to un-hide or re-width a column */
  remapCols(map, override = {}) {
    const m = /<cols>([\s\S]*?)<\/cols>/.exec(this.xml); if (!m) return;
    const spec = new Map(); let tail = null;
    for (const c of m[1].matchAll(/<col ([^>]*)\/>/g)) {
      const a = c[1], min = +/min="(\d+)"/.exec(a)[1], max = +/max="(\d+)"/.exec(a)[1];
      const attrs = a.replace(/\s*min="\d+"/, "").replace(/\s*max="\d+"/, "").trim();
      if (max > 200) { tail = { min, attrs }; continue; }
      for (let k = min; k <= max; k++) spec.set(k, attrs);
    }
    const out = new Map();
    for (const [c, attrs] of spec) { let t = map(c); if (t == null) continue; if (!Array.isArray(t)) t = [t]; t.forEach((x) => { if (!out.has(x)) out.set(x, attrs); }); }
    for (const [c, attrs] of Object.entries(override)) out.set(+c, attrs);
    const maxC = Math.max(...out.keys());
    const parts = [];
    for (let k = 1; k <= maxC; k++) parts.push(`<col min="${k}" max="${k}" ${out.get(k) || (tail ? tail.attrs.replace(/\s*collapsed="1"/, "") : 'width="11"')}/>`);
    if (tail) parts.push(`<col min="${maxC + 1}" max="16384" ${tail.attrs.replace(/\s*collapsed="1"/, "")}/>`);
    this.cols = `<cols>${parts.join("")}</cols>`;
  }
  tplStyle(ref, fallback = 0) { const p = typeof ref === "string" ? parseA1(ref) : ref; const t = p && this.tpl.get(p.r + "," + p.c); return t ? t.s : fallback; }
  /* template row → new row; colMap(c) returns a column number, an array of columns, or null to drop */
  cloneRow(newR, tplR, colMap = (c) => c, { attrs = true, values = false } = {}) {
    if (attrs && this.tplRows.has(tplR)) this.rowAttr.set(newR, this.tplRows.get(tplR));
    for (const [k, t] of this.tpl) {
      const [r, c] = k.split(",").map(Number);
      if (r !== tplR) continue;
      let targets = colMap(c);
      if (targets == null) continue;
      if (!Array.isArray(targets)) targets = [targets];
      for (const tc of targets) {
        const prev = this._row(newR).get(tc);
        // a cell already written keeps its value and gets the template style only if it has none
        if (prev && (prev.v !== undefined || prev.f != null || prev.dt)) { if (prev.s == null || prev.s === 0) prev.s = t.s; continue; }
        const cell = { s: t.s };
        if (values && targets.length === 1 && tc === c) { cell.rawAttrs = t.attrs; cell.rawInner = t.inner; }
        this._row(newR).set(tc, cell);
      }
    }
  }
  _row(r) { if (!this.rows.has(r)) this.rows.set(r, new Map()); return this.rows.get(r); }
  get(r, c) { return this.rows.get(r)?.get(c); }
  /* value: number | string | boolean | null | { f: formula } | { dt: {...} } ; s: style index (undefined = keep cloned) */
  set(r, c, value, s) {
    const row = this._row(r); const prev = row.get(c) || {};
    const cell = { s: s != null ? s : prev.s != null ? prev.s : 0 };
    if (value && typeof value === "object" && !(value instanceof Date)) {
      if (value.f != null) cell.f = String(value.f).replace(/^=/, "");
      if (value.dt) cell.dt = value.dt;
      if (value.arr) cell.arr = true;
    } else cell.v = value;
    row.set(c, cell);
    return cell;
  }
  style(r, c, s) { const row = this._row(r); const prev = row.get(c) || {}; row.set(c, { ...prev, s, rawAttrs: undefined }); }
  height(r, ht) { const a = this.rowAttr.get(r) || ""; this.rowAttr.set(r, a.replace(/ ?ht="[^"]*"/, "").replace(/ ?customHeight="[^"]*"/, "") + ` ht="${ht}" customHeight="1"`); }
  hideRow(r) { const a = this.rowAttr.get(r) || ""; if (!/hidden=/.test(a)) this.rowAttr.set(r, a + ' hidden="1"'); }
  merge(ref) { this.merges.push(ref); }
  link(r, c, location, display, s) { this.set(r, c, display, s); this.links.push({ ref: a1(r, c), location }); }
  _cellXml(r, c, cell) {
    const ref = a1(r, c);
    if (cell.rawAttrs != null && cell.v === undefined && cell.f == null && !cell.dt) {
      return `<c ${cell.rawAttrs.replace(/ s="\d+"/, "").replace(/^/, "")}${cell.s ? ` s="${cell.s}"` : ""}>${cell.rawInner}</c>`.replace(/<c r=/, "<c r=");
    }
    const s = cell.s ? ` s="${cell.s}"` : "";
    if (cell.dt) {
      const d = cell.dt;
      return `<c r="${ref}"${s}><f t="dataTable" ref="${d.ref}"${d.dt2D ? ' dt2D="1"' : ""}${d.dtr ? ' dtr="1"' : ' dtr="0"'} r1="${d.r1}"${d.r2 ? ` r2="${d.r2}"` : ""}/></c>`;
    }
    if (cell.f != null) {
      const f = xmlEsc(cell.f);
      return cell.arr ? `<c r="${ref}"${s}><f t="array" ref="${ref}">${f}</f></c>` : `<c r="${ref}"${s}><f>${f}</f></c>`;
    }
    const v = cell.v;
    if (v == null || v === "" || (typeof v === "number" && !isFinite(v))) return `<c r="${ref}"${s}/>`;
    if (typeof v === "number") return `<c r="${ref}"${s}><v>${+v.toPrecision(15)}</v></c>`;
    if (typeof v === "boolean") return `<c r="${ref}"${s} t="b"><v>${v ? 1 : 0}</v></c>`;
    const txt = String(v);
    return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(txt)}</t></is></c>`;
  }
  _sheetDataXml() {
    const rows = [...new Set([...this.rows.keys(), ...this.rowAttr.keys()])].sort((a, b) => a - b);
    let out = "<sheetData>"; this.maxR = 1; this.maxC = 1;
    for (const r of rows) {
      const cells = this.rows.get(r) || new Map();
      const cs = [...cells.keys()].sort((a, b) => a - b);
      const attrs = (this.rowAttr.get(r) || "").trim();
      out += `<row r="${r}"${attrs ? " " + attrs : ""}>`;
      for (const c of cs) { out += this._cellXml(r, c, cells.get(c)); this.maxC = Math.max(this.maxC, c); }
      out += "</row>"; this.maxR = Math.max(this.maxR, r);
    }
    return out + "</sheetData>";
  }
  render() {
    let x = this.xml;
    const sd = this._sheetDataXml();
    x = x.replace(/<sheetData>[\s\S]*?<\/sheetData>|<sheetData\/>/, () => sd);
    x = x.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:${a1(this.maxR, this.maxC)}"/>`);
    if (this.cols != null) x = /<cols>[\s\S]*?<\/cols>/.test(x) ? x.replace(/<cols>[\s\S]*?<\/cols>/, () => this.cols) : x.replace(/<sheetData>/, () => this.cols + "<sheetData>");
    // merges
    x = x.replace(/<mergeCells[^>]*>[\s\S]*?<\/mergeCells>/, "");
    // conditional formatting / data validations (plain), hyperlinks → rebuilt
    x = x.replace(/<conditionalFormatting[\s\S]*?<\/conditionalFormatting>/g, "");
    x = x.replace(/<dataValidations[^>]*>[\s\S]*?<\/dataValidations>/, "");
    x = x.replace(/<hyperlinks>[\s\S]*?<\/hyperlinks>/, "");
    const after = (xmlTag) => x.search(new RegExp(`<(?:${xmlTag})[ >/]`));
    // element order: sheetData, sheetCalcPr, sheetProtection, protectedRanges, scenarios, autoFilter, sortState,
    // dataConsolidate, customSheetViews, mergeCells, phoneticPr, conditionalFormatting, dataValidations, hyperlinks, printOptions, pageMargins ...
    const tailStart = (() => { const i = after("phoneticPr|printOptions|pageMargins|pageSetup|headerFooter|rowBreaks|colBreaks|drawing|legacyDrawing|controls|mc:AlternateContent|extLst"); return i < 0 ? x.indexOf("</worksheet>") : i; })();
    let ins = "";
    if (this.merges.length) ins += `<mergeCells count="${this.merges.length}">${this.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`;
    ins += this.cf.join("");
    if (this.dv.length) ins += `<dataValidations count="${this.dv.length}">${this.dv.join("")}</dataValidations>`;
    if (this.links.length) ins += `<hyperlinks>${this.links.map((l) => `<hyperlink ref="${l.ref}" location="${xmlEsc(l.location)}" display="${xmlEsc(l.display || "")}"/>`).join("")}</hyperlinks>`;
    // mergeCells must come right after sheetData-ish block; hyperlinks after DV; everything before printOptions
    x = x.slice(0, tailStart) + ins + x.slice(tailStart);
    return x;
  }
}

/* ── workbook ───────────────────────────────────────────────────────────── */
class TplWorkbook {
  static async load(buf) {
    const wb = new TplWorkbook();
    wb.zip = await JSZip.loadAsync(buf);
    wb.workbookXml = await wb.zip.file("xl/workbook.xml").async("string");
    wb.relsXml = await wb.zip.file("xl/_rels/workbook.xml.rels").async("string");
    wb.ctXml = await wb.zip.file("[Content_Types].xml").async("string");
    wb.styles = new StyleTable(await wb.zip.file("xl/styles.xml").async("string"));
    wb.sheets = new Map(); wb.order = [];
    const rels = new Map([...wb.relsXml.matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2]]));
    for (const m of wb.workbookXml.matchAll(/<sheet name="([^"]+)" sheetId="(\d+)" r:id="([^"]+)"\/>/g)) {
      const name = xmlUnesc(m[1]), target = rels.get(m[3]).replace(/^\/?xl\//, "");
      const path = "xl/" + target;
      const xml = await wb.zip.file(path).async("string");
      const relsPath = path.replace(/worksheets\//, "worksheets/_rels/") + ".rels";
      const sh = new TplSheet(wb, name, path, xml, relsPath);
      sh.sheetId = +m[2]; sh.rid = m[3];
      wb.sheets.set(name, sh); wb.order.push(name);
    }
    return wb;
  }
  sheet(name) { return this.sheets.get(name); }
  async text(path) { const f = this.zip.file(path); return f ? f.async("string") : null; }
  put(path, content) { this.zip.file(path, content); }
  remove(path) { this.zip.remove(path); this.ctXml = this.ctXml.replace(new RegExp(`<Override PartName="/${path.replace(/[.[\]]/g, "\\$&")}"[^>]*/>`), ""); }
  /* a brand-new sheet, styled by the caller; `like` copies sheetPr/sheetViews/format from a template sheet */
  addSheet(name, { like, tabColor, freeze, zoom = 90, cols = "", landscape = false } = {}) {
    const n = Math.max(0, ...[...this.sheets.values()].map((s) => +/sheet(\d+)\.xml/.exec(s.path)[1])) + 1;
    const path = `xl/worksheets/sheet${n}.xml`;
    const sheetId = Math.max(...[...this.sheets.values()].map((s) => s.sheetId)) + 1;
    const rid = "rIdS" + n;
    const pane = freeze ? `<pane${freeze.x ? ` xSplit="${freeze.x}"` : ""}${freeze.y ? ` ySplit="${freeze.y}"` : ""} topLeftCell="${a1((freeze.y || 0) + 1, (freeze.x || 0) + 1)}" activePane="${freeze.x && freeze.y ? "bottomRight" : freeze.y ? "bottomLeft" : "topRight"}" state="frozen"/>` : "";
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac" mc:Ignorable="x14ac"><sheetPr>${tabColor ? `<tabColor rgb="${tabColor}"/>` : ""}<pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1"/><sheetViews><sheetView showGridLines="0" zoomScale="${zoom}" zoomScaleNormal="${zoom}" workbookViewId="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultColWidth="11" defaultRowHeight="15" customHeight="1" outlineLevelCol="1" x14ac:dyDescent="0.35"/>${cols ? cols : ""}<sheetData/><printOptions horizontalCentered="1"/><pageMargins left="0.5" right="0.5" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" scale="55" fitToHeight="0" orientation="${landscape ? "landscape" : "portrait"}"/><headerFooter><oddFooter>&amp;L&amp;"Calibri,Regular"&amp;K000000Strictly private and confidential&amp;C&amp;"Calibri,Regular"&amp;K000000Page &amp;P of &amp;N&amp;R&amp;"Helvetica,Regular"&amp;12&amp;K000000&amp;F</oddFooter></headerFooter></worksheet>`;
    const sh = new TplSheet(this, name, path, xml, null);
    sh.sheetId = sheetId; sh.rid = rid; sh.isNew = true;
    this.sheets.set(name, sh); this.order.push(name);
    return sh;
  }
  moveSheet(name, beforeName) { this.order = this.order.filter((x) => x !== name); const i = beforeName ? this.order.indexOf(beforeName) : -1; if (i < 0) this.order.push(name); else this.order.splice(i, 0, name); }
  async toBuffer() {
    // sheets
    for (const sh of this.sheets.values()) {
      this.put(sh.path, sh.render());
      if (sh.isNew) {
        this.relsXml = this.relsXml.replace("</Relationships>", `<Relationship Id="${sh.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/${sh.path.split("/").pop()}"/></Relationships>`);
        this.ctXml = this.ctXml.replace("</Types>", `<Override PartName="/${sh.path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
      }
    }
    // sheet order + names
    const sheetsXml = this.order.map((n) => { const s = this.sheets.get(n); return `<sheet name="${xmlEsc(n)}" sheetId="${s.sheetId}" r:id="${s.rid}"/>`; }).join("");
    let wx = this.workbookXml.replace(/<sheets>[\s\S]*?<\/sheets>/, () => `<sheets>${sheetsXml}</sheets>`);
    // always recalculate on open (no cached values are written) + drop the calc chain
    wx = wx.replace(/<calcPr[^>]*\/>/, '<calcPr calcId="191029" fullCalcOnLoad="1"/>');
    wx = wx.replace(/<bookViews>[\s\S]*?<\/bookViews>/, (m) => m.replace(/ activeTab="\d+"/, "").replace(/ firstSheet="\d+"/, ""));
    if (this.definedNames && this.definedNames.length) {
      const dn = `<definedNames>${this.definedNames.map((d) => `<definedName name="${d.name}"${d.hidden ? ' hidden="1"' : ""}>${xmlEsc(d.ref)}</definedName>`).join("")}</definedNames>`;
      wx = wx.replace(/<definedNames>[\s\S]*?<\/definedNames>/, "");
      wx = wx.replace(/(<\/sheets>)/, (m) => m + dn);
    }
    this.put("xl/workbook.xml", wx);
    if (this.zip.file("xl/calcChain.xml")) {
      this.zip.remove("xl/calcChain.xml");
      this.relsXml = this.relsXml.replace(/<Relationship [^>]*Target="calcChain.xml"\/>/, "");
      this.ctXml = this.ctXml.replace(/<Override PartName="\/xl\/calcChain.xml"[^>]*\/>/, "");
    }
    this.put("xl/_rels/workbook.xml.rels", this.relsXml);
    this.put("[Content_Types].xml", this.ctXml);
    this.put("xl/styles.xml", this.styles.toXml());
    return this.zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  }
}

module.exports = { TplWorkbook, TplSheet, StyleTable, colName, colNum, a1, parseA1, sref, xmlEsc, xmlUnesc };
