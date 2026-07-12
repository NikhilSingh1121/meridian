/* ════════════════════════════════════════════════════════════════════════
   MERIDIAN · AUTH UI
   Top-right settings popup with Google sign-in. Signed-out shows a Continue-
   with-Google button; signed-in shows profile (name / email / contact),
   Account, and Log out. Portfolio & Library are gated behind sign-in.

   Uses Google Identity Services (ID-token flow) — only the public client_id
   (fetched from /api/config); the Google client secret is never used here.
   Sign-in / sign-out reload once, after MSTORE has re-synced, so every module
   boots with the correct per-user data (bootTerminal awaits MSTORE.ready).
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  const M = {
    user: null,
    clientId: null,
    gisReady: false,
    busy: false,
  };
  const GATED = ["portfolio", "library"];
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  /* ─────────────────────────── boot ─────────────────────────── */
  async function init() {
    if (window.MSTORE && window.MSTORE.ready) { try { await window.MSTORE.ready; } catch { } }
    M.user = (window.MSTORE && window.MSTORE.user) || window.MERIDIAN_USER || null;
    try { const c = await (await fetch("/api/config")).json(); M.clientId = c.googleClientId; } catch { }

    wireGear();
    renderPopup();
    applyGating();
    loadGIS();
  }

  /* ─────────────────────── gear button + popup ─────────────────────── */
  function wireGear() {
    const btn = $("#settingsBtn"), pop = $("#settingsPop");
    if (!btn || !pop) return;
    btn.addEventListener("click", (e) => { e.stopPropagation(); togglePopup(); });
    document.addEventListener("click", (e) => {
      if (pop.hidden) return;
      if (!pop.contains(e.target) && e.target !== btn && !btn.contains(e.target)) closePopup();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePopup(); });
  }
  function togglePopup() { const pop = $("#settingsPop"); pop.hidden ? openPopup() : closePopup(); }
  function openPopup() {
    const pop = $("#settingsPop"), btn = $("#settingsBtn");
    pop.hidden = false; btn.setAttribute("aria-expanded", "true");
    renderGsiButtons(); // fill the Google button now that the slot is visible
  }
  function closePopup() {
    const pop = $("#settingsPop"), btn = $("#settingsBtn");
    if (!pop) return;
    pop.hidden = true; btn && btn.setAttribute("aria-expanded", "false");
  }

  const gearIcon = () =>
    `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`;

  /* ─────────────────────────── popup content ─────────────────────────── */
  function renderPopup() {
    const pop = $("#settingsPop");
    if (!pop) return;
    pop.innerHTML = M.user ? signedInHTML(M.user) : signedOutHTML();
    wirePopup();
  }

  function signedOutHTML() {
    return `
      <div class="sp-head"><span class="sp-title">SETTINGS</span><button class="sp-close" data-close aria-label="Close">✕</button></div>
      <div class="sp-body">
        <div class="sp-label">Profile &amp; Account</div>
        <p class="sp-note">Sign in with Google to save your portfolios and research library to your account — kept in sync across devices.</p>
        <div class="gsi-slot" data-gsi></div>
        <button class="sp-google" data-signin>
          <span class="sp-g">G</span> Continue with Google
        </button>
        <div class="sp-err" data-err hidden></div>
      </div>`;
  }

  function signedInHTML(u) {
    const initial = (u.name || u.email || "U").trim().charAt(0).toUpperCase();
    const avatar = u.picture
      ? `<img class="sp-avatar" src="${u.picture}" alt="" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'sp-avatar sp-avatar-i',textContent:'${initial}'}))">`
      : `<div class="sp-avatar sp-avatar-i">${initial}</div>`;
    const since = u.createdAt ? new Date(u.createdAt).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" }) : "—";
    const last = u.lastLogin ? new Date(u.lastLogin).toLocaleString("en-IN") : "—";
    return `
      <div class="sp-head"><span class="sp-title">SETTINGS</span><button class="sp-close" data-close aria-label="Close">✕</button></div>
      <div class="sp-body">
        <div class="sp-label">Profile &amp; Account</div>
        <div class="sp-user">
          ${avatar}
          <div class="sp-uinfo">
            <div class="sp-uname">${esc(u.name || "—")}</div>
            <div class="sp-uemail">${esc(u.email || "")}</div>
          </div>
        </div>

        <button class="sp-item" data-panel="profile">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          Profile <span class="sp-chev">›</span>
        </button>
        <div class="sp-panel" data-panel-body="profile" hidden>
          <label class="sp-field"><span>Name</span><input value="${esc(u.name || "")}" disabled></label>
          <label class="sp-field"><span>Email</span><input value="${esc(u.email || "")}" disabled></label>
          <label class="sp-field"><span>Contact <em>(optional)</em></span><input data-contact placeholder="Phone or handle" value="${esc(u.contact || "")}"></label>
          <div class="sp-panel-actions">
            <button class="sp-save" data-save-contact>Save</button>
            <span class="sp-saved" data-saved hidden>Saved</span>
          </div>
        </div>

        <button class="sp-item" data-panel="account">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-3H5a2 2 0 0 0-2 2z"/></svg>
          Account <span class="sp-chev">›</span>
        </button>
        <div class="sp-panel" data-panel-body="account" hidden>
          <div class="sp-meta"><span>Signed in with</span><b>Google</b></div>
          <div class="sp-meta"><span>Member since</span><b>${since}</b></div>
          <div class="sp-meta"><span>Last sign-in</span><b>${last}</b></div>
          <div class="sp-meta"><span>Account ID</span><b class="sp-mono">${esc((u.sub || "").slice(0, 10))}…</b></div>
        </div>

        <button class="sp-item sp-danger" data-logout>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          Log out
        </button>
        <div class="sp-err" data-err hidden></div>
      </div>`;
  }

  function wirePopup() {
    const pop = $("#settingsPop");
    if (!pop) return;
    $$("[data-close]", pop).forEach((b) => b.addEventListener("click", closePopup));
    $$("[data-signin]", pop).forEach((b) => b.addEventListener("click", promptSignIn));
    $$("[data-logout]", pop).forEach((b) => b.addEventListener("click", logout));
    $$("[data-panel]", pop).forEach((b) => b.addEventListener("click", () => togglePanel(b.dataset.panel)));
    const saveBtn = $("[data-save-contact]", pop);
    if (saveBtn) saveBtn.addEventListener("click", saveContact);
  }

  function togglePanel(name) {
    const pop = $("#settingsPop");
    $$("[data-panel-body]", pop).forEach((p) => { p.hidden = p.dataset.panelBody !== name ? true : !p.hidden; });
    $$("[data-panel]", pop).forEach((b) => b.classList.toggle("open", b.dataset.panel === name && !$(`[data-panel-body="${name}"]`, pop).hidden));
  }

  async function saveContact() {
    const pop = $("#settingsPop");
    const input = $("[data-contact]", pop), savedTag = $("[data-saved]", pop), btn = $("[data-save-contact]", pop);
    if (!input) return;
    btn.disabled = true;
    try {
      const r = await fetch("/api/auth/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ contact: input.value }) });
      if (!r.ok) throw new Error("save failed");
      const j = await r.json();
      if (window.MSTORE) window.MERIDIAN_USER = j.user;
      M.user = j.user;
      savedTag.hidden = false; setTimeout(() => (savedTag.hidden = true), 1600);
    } catch { showErr("Couldn't save. Try again."); }
    finally { btn.disabled = false; }
  }

  /* ─────────────────────── Google Identity Services ─────────────────────── */
  function loadGIS() {
    if (window.google && window.google.accounts && window.google.accounts.id) { onGisLoaded(); return; }
    if (document.getElementById("gis-script")) return; // loading
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true; s.defer = true; s.id = "gis-script";
    s.onload = onGisLoaded;
    s.onerror = () => showErr("Google sign-in failed to load (check your connection).");
    document.head.appendChild(s);
  }
  function onGisLoaded() {
    if (!(window.google && window.google.accounts && window.google.accounts.id)) return;
    M.gisReady = true;
    if (M.clientId) {
      try {
        window.google.accounts.id.initialize({
          client_id: M.clientId,
          callback: onCredential,
          auto_select: false,
          cancel_on_tap_outside: true,
          ux_mode: "popup",
        });
      } catch (e) { /* misconfigured origin surfaces on button click */ }
    }
    renderGsiButtons();
  }

  /* Render the official Google button into every visible .gsi-slot. */
  function renderGsiButtons() {
    if (!M.gisReady || !M.clientId || M.user) return;
    $$(".gsi-slot[data-gsi]").forEach((slot) => {
      if (slot.offsetParent === null && slot.getClientRects().length === 0) return; // not visible yet
      slot.innerHTML = "";
      try {
        window.google.accounts.id.renderButton(slot, {
          type: "standard", theme: "filled_black", size: "large",
          text: "continue_with", shape: "rectangular", logo_alignment: "left",
          width: Math.min(320, slot.clientWidth || 300),
        });
      } catch { /* leave the fallback button */ }
    });
  }

  function promptSignIn() {
    if (!M.gisReady || !M.clientId) { showErr("Sign-in is still loading — one moment."); return; }
    try {
      window.google.accounts.id.prompt((n) => {
        if (n && (n.isNotDisplayed && n.isNotDisplayed()) || (n && n.isSkippedMoment && n.isSkippedMoment())) {
          showErr("Use the Google button above to continue.");
        }
      });
    } catch { showErr("Use the Google button above to continue."); }
  }

  async function onCredential(resp) {
    if (!resp || !resp.credential || M.busy) return;
    M.busy = true;
    setSigningState(true);
    try {
      const r = await fetch("/api/auth/google", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ credential: resp.credential }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || "Sign-in failed"); }
      if (window.MSTORE && window.MSTORE.refresh) { try { await window.MSTORE.refresh(); } catch { } }
      location.reload();
    } catch (e) {
      M.busy = false; setSigningState(false);
      showErr(e.message || "Sign-in failed");
    }
  }

  async function logout() {
    if (M.busy) return;
    M.busy = true;
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch { }
    try { if (window.MSTORE) window.MSTORE.clearLocal(); } catch { }
    location.reload();
  }

  /* ─────────────────────── gating (Portfolio / Library) ─────────────────── */
  function applyGating() {
    GATED.forEach((tab) => {
      const sec = document.getElementById("tab-" + tab);
      if (!sec) return;
      let gate = sec.querySelector(":scope > .auth-gate");
      if (M.user) { if (gate) gate.remove(); return; }
      if (!gate) { gate = buildGate(tab); sec.appendChild(gate); }
    });
    renderGsiButtons();
  }
  function buildGate(tab) {
    const label = tab === "portfolio" ? "Portfolio" : "Library";
    const blurb = tab === "portfolio"
      ? "Build watchlists and run technical scans that are saved to your account and synced across devices."
      : "Save research reports to your account and reopen them from anywhere.";
    const g = document.createElement("div");
    g.className = "auth-gate";
    g.innerHTML = `
      <div class="auth-gate-card">
        <div class="ag-lock">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        </div>
        <h3 class="ag-title">Sign in to use your ${label}</h3>
        <p class="ag-blurb">${blurb}</p>
        <div class="gsi-slot" data-gsi></div>
        <button class="sp-google ag-google" data-signin><span class="sp-g">G</span> Continue with Google</button>
        <div class="sp-err" data-err hidden></div>
      </div>`;
    g.querySelector("[data-signin]").addEventListener("click", promptSignIn);
    return g;
  }

  /* ─────────────────────────── small helpers ─────────────────────────── */
  function setSigningState(on) {
    $$(".auth-gate .auth-gate-card, #settingsPop .sp-body").forEach((el) => el.classList.toggle("signing", on));
  }
  function showErr(msg) {
    const boxes = $$("[data-err]");
    const box = boxes.find((b) => b.closest("#settingsPop") && !b.closest("#settingsPop").hidden) || boxes.find((b) => b.offsetParent !== null) || boxes[0];
    if (box) { box.textContent = msg; box.hidden = false; setTimeout(() => (box.hidden = true), 4000); }
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  window.MAuth = { signIn: promptSignIn, logout, refresh: init, get user() { return M.user; } };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
