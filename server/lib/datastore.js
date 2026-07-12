/**
 * MERIDIAN — datastore (blob model, file backend).
 *
 * Single point of persistence for the app's durable blobs — users, per-user
 * synced data (portfolios / watchlists / scenarios / transactions), payments,
 * research library. Memory-authority design:
 *   · init() hydrates every blob into memory at boot (the server starts
 *     listening only after hydration), so reads are SYNCHRONOUS — the
 *     contract the existing stores rely on.
 *   · setBlob() updates memory and writes the JSON file atomically
 *     (tmp + rename). File layout is identical to the legacy layout
 *     (users.json, payments.json, library.json, userdata/<sub>.json).
 *
 * NOTE ON DURABILITY: the host disk on Render is ephemeral — these files do
 * not survive a redeploy. Abstracting persistence behind this one module
 * means a durable backend can be added later by changing ONLY this file.
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.MERIDIAN_DATA_DIR || path.join(__dirname, "..", "data");

const mem = new Map(); // key → parsed value
let inited = false;

/* ── key ↔ file mapping (legacy-identical layout) ─────────────────────────── */
function fileFor(key) {
  if (key.startsWith("userdata/")) {
    return path.join(DATA_DIR, "userdata", encodeURIComponent(key.slice("userdata/".length)) + ".json");
  }
  return path.join(DATA_DIR, key + ".json");
}

/* ── local file IO (atomic, never throws) ─────────────────────────────────── */
function fileRead(key) {
  try { return JSON.parse(fs.readFileSync(fileFor(key), "utf8")); } catch { return undefined; }
}
function fileWrite(key, value) {
  try {
    const f = fileFor(key);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = f + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(value));
    fs.renameSync(tmp, f);
  } catch (e) { console.warn(`[datastore] file write failed for ${key}:`, e.message); }
}
function fileDelete(key) {
  try { fs.unlinkSync(fileFor(key)); } catch { }
}
function fileListKeys() {
  const keys = [];
  try {
    for (const f of fs.readdirSync(DATA_DIR)) {
      if (f.endsWith(".json") && !f.endsWith(".tmp")) keys.push(f.slice(0, -5));
    }
  } catch { }
  try {
    for (const f of fs.readdirSync(path.join(DATA_DIR, "userdata"))) {
      if (f.endsWith(".json")) keys.push("userdata/" + decodeURIComponent(f.slice(0, -5)));
    }
  } catch { }
  return keys;
}

/* ── public API ───────────────────────────────────────────────────────────── */
async function init() {
  if (inited) return;
  inited = true;
  for (const key of fileListKeys()) {
    const v = fileRead(key);
    if (v !== undefined) mem.set(key, v);
  }
  console.log(`[datastore] file backend (server/data) · ${mem.size} blob(s) hydrated`);
}

/** Synchronous read from the hydrated memory authority. */
function getBlob(key, fallback) {
  const v = mem.get(key);
  return v === undefined ? fallback : v;
}

/** Synchronous write: memory + atomic local file. */
function setBlob(key, value) {
  mem.set(key, value);
  fileWrite(key, value);
  return value;
}

function deleteBlob(key) {
  mem.delete(key);
  fileDelete(key);
}

function listBlobs(prefix = "") {
  return [...mem.keys()].filter((k) => k.startsWith(prefix));
}

function backend() { return "file"; }

module.exports = { init, getBlob, setBlob, deleteBlob, listBlobs, backend };
