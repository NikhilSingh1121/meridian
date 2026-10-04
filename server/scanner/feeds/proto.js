/**
 * Minimal protobuf wire-format reader (no dependency). Enough to decode flat
 * messages: varint (incl. zig-zag sint64), fixed32 float, fixed64 double,
 * length-delimited strings / nested bytes. Unknown fields are skipped.
 */
function readVarint(buf, pos) {
  // returns [value as Number (safe for < 2^53), newPos]
  let result = 0, mul = 1, b;
  do {
    if (pos >= buf.length) throw new Error("proto: truncated varint");
    b = buf[pos++];
    result += (b & 0x7f) * mul;
    mul *= 128;
  } while (b & 0x80);
  return [result, pos];
}
const zigzag = (n) => (n % 2 === 0 ? n / 2 : -(n + 1) / 2);

/** decode(buf, schema) — schema: { fieldNo: [name, type] }, type ∈ string|float|double|sint64|int64|enum|bool|bytes */
function decode(buf, schema) {
  const out = {};
  let pos = 0;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  while (pos < buf.length) {
    let key; [key, pos] = readVarint(buf, pos);
    const field = Math.floor(key / 8), wire = key & 7;
    const spec = schema[field];
    if (wire === 0) {
      let v; [v, pos] = readVarint(buf, pos);
      if (spec) out[spec[0]] = spec[1] === "sint64" ? zigzag(v) : spec[1] === "bool" ? !!v : v;
    } else if (wire === 5) {
      if (spec) out[spec[0]] = dv.getFloat32(pos, true);
      pos += 4;
    } else if (wire === 1) {
      if (spec) out[spec[0]] = dv.getFloat64(pos, true);
      pos += 8;
    } else if (wire === 2) {
      let len; [len, pos] = readVarint(buf, pos);
      if (spec) out[spec[0]] = spec[1] === "string" ? buf.toString("utf8", pos, pos + len) : buf.subarray(pos, pos + len);
      pos += len;
    } else {
      throw new Error("proto: unsupported wire type " + wire);
    }
  }
  return out;
}

/* ── encoder (used by tests to build fixtures in the exact wire format) ── */
function encVarint(n) { const o = []; do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 0x80; o.push(b); } while (n > 0); return o; }
function encode(obj, schema) {
  const bytes = [];
  for (const [no, [name, type]] of Object.entries(schema)) {
    const v = obj[name]; if (v === undefined || v === null) continue;
    const f = +no;
    if (type === "string") { const s = Buffer.from(String(v), "utf8"); bytes.push(...encVarint(f * 8 + 2), ...encVarint(s.length), ...s); }
    else if (type === "float") { const b = Buffer.alloc(4); b.writeFloatLE(v); bytes.push(...encVarint(f * 8 + 5), ...b); }
    else if (type === "double") { const b = Buffer.alloc(8); b.writeDoubleLE(v); bytes.push(...encVarint(f * 8 + 1), ...b); }
    else if (type === "sint64") bytes.push(...encVarint(f * 8), ...encVarint(v >= 0 ? v * 2 : -v * 2 - 1));
    else bytes.push(...encVarint(f * 8), ...encVarint(+v));
  }
  return Buffer.from(bytes);
}

module.exports = { decode, encode, readVarint, zigzag };
