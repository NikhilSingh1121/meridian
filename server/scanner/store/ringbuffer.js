/** Fixed-capacity numeric ring buffer (Float64Array) — O(1) push, no allocation per push. */
class Ring {
  constructor(capacity) { this.cap = capacity; this.buf = new Float64Array(capacity); this.start = 0; this.length = 0; }
  push(v) {
    if (this.length < this.cap) { this.buf[(this.start + this.length) % this.cap] = v; this.length++; }
    else { this.buf[this.start] = v; this.start = (this.start + 1) % this.cap; }
  }
  /** i-th oldest (0 = oldest) */
  get(i) { return i < 0 || i >= this.length ? undefined : this.buf[(this.start + i) % this.cap]; }
  /** k-th newest (0 = newest) */
  back(k = 0) { return this.get(this.length - 1 - k); }
  set(i, v) { if (i >= 0 && i < this.length) this.buf[(this.start + i) % this.cap] = v; }
  setBack(k, v) { this.set(this.length - 1 - k, v); }
  clear() { this.start = 0; this.length = 0; }
  toArray(last = this.length) { const n = Math.min(last, this.length), o = new Array(n); for (let i = 0; i < n; i++) o[i] = this.get(this.length - n + i); return o; }
}
module.exports = { Ring };
