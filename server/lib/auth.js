/**
 * MERIDIAN — authentication core.
 *
 * Sign-in uses Google Identity Services (ID-token flow). The browser obtains a
 * signed Google ID token; here we VERIFY it (signature + audience + issuer),
 * upsert a user record, and issue our own HMAC-signed session token stored in
 * an httpOnly cookie. The Google *client secret* is NOT used or required for
 * this flow — only the public client_id.
 *
 * Storage is flat JSON files (mirrors the existing Library store); swap for a
 * real DB later without touching callers.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const UDATA_DIR = path.join(DATA_DIR, "userdata");

/* Public OAuth client id (safe to expose — it ships in the frontend anyway).
   Overridable via env; defaults to the project's registered web client. */
const CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID ||
  "1059224783085-hm6qv8fpj843eabhnvqcm5tdeld6dfmo.apps.googleusercontent.com";

/* Session signing secret. MUST be set in production so sessions survive
   restarts / multiple instances. Falls back to an ephemeral random secret. */
let SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  SESSION_SECRET = crypto.randomBytes(32).toString("hex");
  console.warn(
    "⚠  SESSION_SECRET not set — using an ephemeral secret. Signed-in users will be\n" +
    "   logged out on every restart/redeploy. Set SESSION_SECRET in .env / Render env."
  );
}

const COOKIE = "mrd_session";
const SESSION_TTL = 30 * 24 * 3600 * 1000; // 30 days

/* ───────────────────────── base64url + session token ───────────────────── */
const b64u = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64uJSON = (obj) => b64u(JSON.stringify(obj));
const unb64u = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

function signSession(payload) {
  const body = b64uJSON({ ...payload, iat: Date.now(), exp: Date.now() + SESSION_TTL });
  const sig = b64u(crypto.createHmac("sha256", SESSION_SECRET).update(body).digest());
  return body + "." + sig;
}
function verifySession(token) {
  if (!token || typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot), sig = token.slice(dot + 1);
  const expect = b64u(crypto.createHmac("sha256", SESSION_SECRET).update(body).digest());
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let obj;
  try { obj = JSON.parse(unb64u(body)); } catch { return null; }
  if (!obj || (obj.exp && Date.now() > obj.exp)) return null;
  return obj;
}

/* ───────────────────────────── cookie helpers ──────────────────────────── */
function parseCookies(req) {
  const out = {};
  const h = req.headers && req.headers.cookie;
  if (!h) return out;
  h.split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function isSecure(req) {
  return !!(req.secure || (req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https");
}
function setSessionCookie(req, res, token) {
  const parts = [
    `${COOKIE}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL / 1000)}`,
  ];
  if (isSecure(req)) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}
function clearSessionCookie(req, res) {
  const parts = [`${COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (isSecure(req)) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

/* ───────────────────────────── user store ──────────────────────────────── */
/* Users + per-user data now persist through the datastore abstraction —
 * same local files as before, plus durable Firestore when configured. */
const DS = require("./datastore");
function readUsers() { return DS.getBlob("users", {}); }
function writeUsers(u) { DS.setBlob("users", u); }

function upsertUser(profile) {
  const users = readUsers();
  const now = Date.now();
  const prev = users[profile.sub] || {};
  users[profile.sub] = {
    sub: profile.sub,
    email: profile.email || prev.email || "",
    name: profile.name || prev.name || "",
    picture: profile.picture || prev.picture || "",
    contact: prev.contact || "",          // user-editable, preserved across logins
    createdAt: prev.createdAt || now,
    lastLogin: now,
  };
  writeUsers(users);
  return users[profile.sub];
}
function getUser(sub) { return readUsers()[sub] || null; }
function updateUserContact(sub, contact) {
  const users = readUsers();
  if (!users[sub]) return null;
  users[sub].contact = String(contact == null ? "" : contact).slice(0, 120);
  writeUsers(users);
  return users[sub];
}

/* ─────────────────────── per-user key/value data store ─────────────────── */
/* Mirrors the browser's localStorage `meridian_*` keys (portfolios, etc.). */
function readUserData(sub) { return DS.getBlob("userdata/" + String(sub), {}); }
function writeUserData(sub, map) { DS.setBlob("userdata/" + String(sub), map); }

/* ─────────────────────── Google ID-token verification ──────────────────── */
async function verifyGoogleToken(idToken) {
  // Primary path: official library (verifies RS256 signature against Google's
  // rotating JWKS). Falls back to Google's tokeninfo endpoint if the library
  // isn't installed, so the system works even before `npm install`.
  try {
    const { OAuth2Client } = require("google-auth-library");
    const client = new OAuth2Client(CLIENT_ID);
    const ticket = await client.verifyIdToken({ idToken, audience: CLIENT_ID });
    return normalizePayload(ticket.getPayload());
  } catch (e) {
    if (e && (e.code === "MODULE_NOT_FOUND" || /Cannot find module 'google-auth-library'/.test(String(e.message)))) {
      return verifyViaTokenInfo(idToken);
    }
    throw new Error("Google token verification failed");
  }
}
async function verifyViaTokenInfo(idToken) {
  const resp = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken));
  if (!resp.ok) throw new Error("Google token verification failed");
  return normalizePayload(await resp.json());
}
function normalizePayload(p) {
  if (!p) throw new Error("Invalid Google token");
  const iss = p.iss || "";
  const okIss = iss === "accounts.google.com" || iss === "https://accounts.google.com";
  const okAud = p.aud === CLIENT_ID;
  const expMs = p.exp ? Number(p.exp) * 1000 : null;      // exp is in seconds
  const okExp = !expMs || expMs > Date.now() - 60_000;    // 60s clock skew
  if (!okIss || !okAud || !okExp) throw new Error("Invalid Google token");
  if (p.email && (p.email_verified === false || p.email_verified === "false")) throw new Error("Email not verified");
  return {
    sub: String(p.sub),
    email: p.email || "",
    name: p.name || p.given_name || (p.email ? p.email.split("@")[0] : "User"),
    picture: p.picture || "",
  };
}

/* ───────────────────────────── middleware ──────────────────────────────── */
function currentUser(req) {
  const sess = verifySession(parseCookies(req)[COOKIE]);
  return sess && sess.sub ? sess : null;
}
function attachUser(req, _res, next) { req.user = currentUser(req); next(); }
function requireUser(req, res, next) {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: "Sign in required" });
  req.user = u;
  next();
}

module.exports = {
  CLIENT_ID,
  signSession, verifySession,
  setSessionCookie, clearSessionCookie,
  upsertUser, getUser, updateUserContact,
  readUserData, writeUserData,
  verifyGoogleToken,
  attachUser, requireUser, currentUser,
};
