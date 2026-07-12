/**
 * MERIDIAN — auth & per-user data routes.
 *   GET  /api/config          → public client id for Google Identity Services
 *   POST /api/auth/google     → verify Google credential, start session
 *   GET  /api/auth/me         → current signed-in user (or null)
 *   POST /api/auth/logout     → end session
 *   PUT  /api/auth/profile    → update editable profile fields (contact)
 *   GET  /api/userdata        → per-user key/value blob (portfolio mirror)
 *   PUT  /api/userdata        → replace per-user key/value blob
 */
const express = require("express");
const router = express.Router();
const A = require("../lib/auth");

const publicUser = (u) => ({
  sub: u.sub, email: u.email || "", name: u.name || "",
  picture: u.picture || "", contact: u.contact || "",
  createdAt: u.createdAt || null, lastLogin: u.lastLogin || null,
});

router.get("/config", (_req, res) => res.json({ googleClientId: A.CLIENT_ID }));

router.post("/auth/google", express.json({ limit: "16kb" }), async (req, res) => {
  const credential = req.body && req.body.credential;
  if (!credential) return res.status(400).json({ error: "Missing credential" });
  try {
    const profile = await A.verifyGoogleToken(credential);
    const user = A.upsertUser(profile);
    const token = A.signSession({ sub: user.sub, email: user.email, name: user.name, picture: user.picture });
    A.setSessionCookie(req, res, token);
    res.json({ user: publicUser(user) });
  } catch (e) {
    res.status(401).json({ error: e.message || "Authentication failed" });
  }
});

router.get("/auth/me", (req, res) => {
  const sess = A.currentUser(req);
  if (!sess) return res.json({ user: null });
  const user = A.getUser(sess.sub) || sess;
  res.json({ user: publicUser(user) });
});

router.post("/auth/logout", (req, res) => { A.clearSessionCookie(req, res); res.json({ ok: true }); });

router.put("/auth/profile", express.json({ limit: "16kb" }), A.requireUser, (req, res) => {
  const user = A.updateUserContact(req.user.sub, req.body && req.body.contact);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user: publicUser(user) });
});

/* ── per-user key/value store (browser localStorage mirror) ── */
router.get("/userdata", A.requireUser, (req, res) => res.json({ data: A.readUserData(req.user.sub) }));

router.put("/userdata", express.json({ limit: "4mb" }), A.requireUser, (req, res) => {
  const data = req.body && req.body.data;
  if (!data || typeof data !== "object") return res.status(400).json({ error: "Bad payload" });
  const clean = {};
  for (const k of Object.keys(data).slice(0, 60)) {
    const v = data[k];
    if (typeof v === "string" && v.length < 2_000_000) clean[k] = v;
  }
  A.writeUserData(req.user.sub, clean);
  res.json({ ok: true });
});

module.exports = router;
