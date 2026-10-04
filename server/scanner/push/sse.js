/**
 * Server-Sent Events push. The hub computes rows once per second; each client gets
 * only the rows (and events) that changed since ITS last push, at ITS chosen interval
 * (1–60 s). No per-tab polling: one long-lived HTTP response per open tab.
 */
class SsePush {
  constructor({ maxClients = 50 } = {}) { this.clients = new Set(); this.maxClients = maxClients; this.sent = 0; this.bytes = 0; }
  attach(req, res, opts = {}) {
    if (this.clients.size >= this.maxClients) { res.status(503).json({ error: "too many live connections" }); return null; }
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders && res.flushHeaders();
    const c = { res, every: Math.max(1, Math.min(60, +opts.every || 1)) * 1000, nextAt: 0, lastSeq: -1, lastEv: opts.lastEv ?? -1, filter: opts.filter || null, channels: opts.channels || null, lastBeat: Date.now(), id: Math.random().toString(36).slice(2, 8), delta: !!opts.delta, sent: null };
    this.clients.add(c);
    res.write(`retry: 3000\n\n`);
    req.on("close", () => this.clients.delete(c));
    return c;
  }
  send(c, event, data) {
    const s = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    try { c.res.write(s); this.sent++; this.bytes += s.length; c.lastBeat = Date.now(); if (typeof c.res.flush === "function") c.res.flush(); } catch { this.clients.delete(c); }
  }
  setEvery(id, sec) { for (const c of this.clients) if (c.id === id) c.every = Math.max(1, Math.min(60, +sec || 1)) * 1000; }
  /**
   * pump(now, source) — source provides:
   *   rowsSince(seq, filter) → { rows:[…], seq }     events(seq) → { events:[…], seq }     extra(c) → object|null
   */
  pump(now, source) {
    for (const c of this.clients) {
      if (now < c.nextAt) { if (now - c.lastBeat > 15000) { try { c.res.write(": beat\n\n"); if (c.res.flush) c.res.flush(); c.lastBeat = now; } catch { this.clients.delete(c); } } continue; }
      c.nextAt = now + c.every;
      const { rows, seq } = source.rowsSince(c.lastSeq, c.filter);
      const ev = source.eventsSince ? source.eventsSince(c.lastEv) : { events: [], seq: c.lastEv };
      const extra = source.extra ? source.extra(c) : null;
      const full = c.lastSeq < 0;
      c.lastSeq = seq; c.lastEv = ev.seq;
      if (!rows.length && !ev.events.length && !extra && !full) continue;
      if (c.delta) {
        // per-client field diff: full rows on the first frame, then only the fields that changed for this client
        if (full || !c.sent) c.sent = new Map();
        const d = [];
        for (const r of rows) {
          const last = c.sent.get(r.s);
          if (!last || full) { d.push(r); c.sent.set(r.s, { ...r }); continue; }
          const ch = {}; let n = 0;
          for (const k in r) { if (k === "_seq") continue; const a = r[k], b = last[k]; if (a !== b && !(Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]))) { ch[k] = a; last[k] = a; n++; } }
          if (n) { ch.s = r.s; d.push(ch); }
        }
        this.send(c, "frame", { ts: now, full, delta: !full, rows: d, events: ev.events, ...(extra || {}) });
      } else this.send(c, "frame", { ts: now, full, rows, events: ev.events, ...(extra || {}) });
    }
  }
  stats() { return { clients: this.clients.size, framesSent: this.sent, bytesSent: this.bytes }; }
  closeAll() { for (const c of this.clients) { try { c.res.end(); } catch { } } this.clients.clear(); }
}
module.exports = { SsePush };
