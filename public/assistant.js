/* ═══ M-Terminal Assistant — floating chat on every tab ═══════════════════════
   Ready-made questions → /api/assistant/answer (no AI, no tokens).
   ✦ questions and "Ask anything" → /api/assistant/chat (budgeted Gemini chat, grounded
                           in the company on screen; server enforces the token ceilings).
   The company in context is whatever the terminal has open (CURRENT). */
(() => {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // light markdown: **bold**, *italic*, "* " / "- " bullets
  const para = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|\n)\s*[*-] /g, "$1• ").replace(/\*([^*\n]+)\*/g, "<i>$1</i>").replace(/\n\n/g, "<br><br>").replace(/\n/g, "<br>");
  const curSym = () => (typeof CURRENT !== "undefined" && CURRENT && CURRENT.symbol) || null;
  const curName = () => (typeof CURRENT !== "undefined" && CURRENT && CURRENT.name) || null;
  const mode = (s) => (s && typeof DCFUSE !== "undefined" && DCFUSE.on(s) ? "lab" : "market");
  const TAB = { research: "Company Analysis", models: "Modeling Lab", forensic: "Forensic Analysis", earnings: "Earnings Call", reports: "Report Generation" };
  const S = { open: false, symbol: undefined, name: null, questions: [], chatId: null, history: [], budget: null, busy: false, asked: new Set(), loading: false, cat: null };

  const ICON = {
    // four-point spark — the assistant's mark (terminal amber on hover / in the header)
    mark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5c.5 4.6 2.4 7.9 9.5 9.5-7.1 1.6-9 4.9-9.5 9.5-.5-4.6-2.4-7.9-9.5-9.5 7.1-1.6 9-4.9 9.5-9.5z" fill="currentColor"/></svg>',
    reset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  };
  const mark = (cls = "") => `<span class="mta-mark ${cls}">${ICON.mark}</span>`;

  // ── DOM ──
  const launch = document.createElement("button");
  launch.className = "mta-launch"; launch.type = "button"; launch.setAttribute("aria-label", "Open the M-Terminal assistant"); launch.setAttribute("aria-expanded", "false");
  launch.innerHTML = mark();
  const panel = document.createElement("section");
  panel.className = "mta-panel"; panel.hidden = true; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "M-Terminal assistant");
  panel.innerHTML = `
    <header class="mta-head">${mark("head")}
      <div class="mta-ttl"><b>M-Terminal Assistant</b><span id="mtaSub">Platform help</span></div>
      <button class="mta-icon" type="button" id="mtaReset" title="New chat" aria-label="New chat">${ICON.reset}</button>
      <button class="mta-icon" type="button" id="mtaClose" title="Close" aria-label="Close">${ICON.close}</button>
    </header>
    <div class="mta-body" id="mtaBody" aria-live="polite"></div>
    <footer class="mta-foot">
      <form class="mta-input" id="mtaForm" autocomplete="off">
        <input id="mtaIn" maxlength="400" placeholder="Ask anything…" aria-label="Ask the assistant" />
        <button class="mta-send" type="submit" id="mtaSend" aria-label="Send">${ICON.send}</button>
      </form>
      <div class="mta-meta"><span id="mtaBudget">Ready-made questions use no AI</span><span>Not investment advice</span></div>
    </footer>`;
  document.body.append(launch, panel);
  const $ = (id) => panel.querySelector("#" + id);
  const body = $("mtaBody");

  const scroll = () => { body.scrollTop = body.scrollHeight; };
  const bot = (html) => { const d = document.createElement("div"); d.className = "mta-msg mta-bot"; d.innerHTML = `${mark("msg")}<div class="mta-txt">${html}</div>`; body.appendChild(d); scroll(); return d; };
  const user = (text) => { const d = document.createElement("div"); d.className = "mta-msg mta-user"; d.innerHTML = `<div class="mta-txt">${esc(text)}</div>`; body.appendChild(d); scroll(); };
  const label = (t) => { const h = document.createElement("div"); h.className = "mta-cat"; h.textContent = t; body.appendChild(h); };
  // one question chip: ✦ questions go to the AI chat, the rest are answered from platform data
  const chip = (q, cls = "") => {
    const b = document.createElement("button"); b.type = "button"; b.className = `mta-chip ${cls}`.trim();
    b.innerHTML = `${cls.includes("pin") ? ICON.down : ""}<span>${esc(q.text)}</span>${q.ai ? '<i class="mta-ai" title="Uses AI">✦</i>' : ""}`;
    b.onclick = () => (q.ai ? send(q.text, true) : ask(q));
    return b;
  };
  const chips = (list, extra = [], into) => {
    const w = into || document.createElement("div"); w.className = "mta-chips";
    for (const q of list) w.appendChild(chip(q));
    for (const x of extra) { const b = document.createElement("button"); b.type = "button"; b.className = "mta-chip " + (x.cls || ""); b.textContent = x.label; b.onclick = x.run; w.appendChild(b); }
    if (!into) body.appendChild(w);
    scroll(); return w;
  };
  const budgetLine = () => {
    const b = S.budget; const el = $("mtaBudget");
    if (!b) { el.textContent = "Ready-made questions use no AI"; return; }
    if (!b.available) { el.textContent = "AI chat unavailable · ready-made questions work"; return; }
    el.textContent = `AI: ${b.turnsLeft} question${b.turnsLeft === 1 ? "" : "s"} · ${Math.round(b.tokensLeft / 1000)}k/${Math.round(b.limits.chatTokens / 1000)}k tokens left`;
  };
  const byOrder = (a, b) => (a.order || 99) - (b.order || 99);

  // ── views ──
  function pinned() {
    const pins = S.questions.filter((q) => q.pin);
    if (!pins.length) return;
    label("Downloads");
    const w = document.createElement("div"); w.className = "mta-chips";
    for (const q of pins) w.appendChild(chip(q, "pin"));
    body.appendChild(w);
  }
  function menu() {
    pinned();
    label(S.symbol ? "Start here" : "Getting started");
    chips(S.questions.filter((q) => q.top).sort(byOrder), [
      { label: "More questions", cls: "ghost", run: () => allQuestions() },
      { label: "Ask anything", cls: "accent", run: () => $("mtaIn").focus() },
    ]);
  }
  /* every question, one category at a time behind a row of text tabs */
  function allQuestions() {
    const cats = [...new Set(S.questions.map((q) => q.cat))];
    if (!cats.length) return;
    const box = document.createElement("div"); box.className = "mta-more";
    const tabs = document.createElement("div"); tabs.className = "mta-tabs"; tabs.setAttribute("role", "tablist");
    const list = document.createElement("div");
    const show = (c) => {
      S.cat = c;
      for (const t of tabs.children) t.setAttribute("aria-selected", String(t.dataset.cat === c));
      list.innerHTML = "";
      chips(S.questions.filter((q) => q.cat === c).sort((a, b) => (b.top - a.top) || byOrder(a, b)), [], list);
      body.scrollTop = Math.max(0, box.offsetTop - 8);   // keep the tab row in view
    };
    for (const c of cats) {
      const t = document.createElement("button"); t.type = "button"; t.className = "mta-tab"; t.setAttribute("role", "tab"); t.dataset.cat = c;
      t.textContent = c.replace("Using M-Terminal", "M-Terminal"); t.onclick = () => show(c); tabs.appendChild(t);
    }
    box.append(tabs, list); body.appendChild(box);
    show(cats.includes(S.cat) ? S.cat : cats[0]);
    const foot = document.createElement("div"); foot.className = "mta-note";
    foot.innerHTML = `Answered instantly from M-Terminal's data · <i class="mta-ai">✦</i> uses AI`;
    body.appendChild(foot);
    chips([], [{ label: "Ask anything", cls: "accent", run: () => $("mtaIn").focus() }]);
    body.scrollTop = Math.max(0, box.offsetTop - 8);
  }
  function greet() {
    body.innerHTML = "";
    const who = S.name ? `<b>${esc(S.name)}</b> and how to use M-Terminal` : "how to use M-Terminal — open a company (Ctrl+K) for company questions";
    bot(`I answer questions about ${who}. Picked questions are answered instantly from the platform's data; ask anything for a custom answer.`);
    menu();
    body.scrollTop = 0;   // the downloads row sits at the top — start there
  }
  async function load(force) {
    const sym = curSym();
    if (!force && sym === S.symbol && S.questions.length) return;
    S.symbol = sym; S.name = curName(); S.history = []; S.asked.clear(); S.loading = true;
    $("mtaSub").textContent = sym ? `${S.name || sym} · ${sym}` : "Platform help";
    body.innerHTML = ""; const w = bot('<span class="mta-think">Loading the company’s figures…</span>');
    try {
      const r = await fetch(`/api/assistant/questions?symbol=${encodeURIComponent(sym || "")}&dcf=${mode(sym)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "unavailable");
      S.questions = d.questions || []; S.chatId = d.chatId; S.budget = d.budget; S.name = d.name || S.name;
      if (d.name) $("mtaSub").textContent = `${d.name} · ${d.symbol}`;
    } catch { S.questions = []; }
    S.loading = false; w.remove(); budgetLine();
    if (!S.questions.length) {
      bot("Couldn't load the questions just now — the server is busy. You can still ask anything below.");
      chips([], [{ label: "Try again", cls: "ghost", run: () => load(true) }]);
      return;
    }
    greet();
  }

  // ── ready-made question (no AI) ──
  async function ask(q) {
    if (S.busy) return;
    S.busy = true; S.asked.add(q.id); user(q.text);
    const w = bot('<span class="mta-think">Looking it up…</span>');
    let a = null;
    try {
      a = await fetch("/api/assistant/answer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: q.id, symbol: S.symbol, dcf: mode(S.symbol) }) }).then((r) => r.json());
      const pts = (a.points || []).filter(Boolean);
      w.querySelector(".mta-txt").innerHTML = `${para(a.text || "No answer available.")}${pts.length ? `<ul>${pts.map((p) => `<li>${para(p)}</li>`).join("")}</ul>` : ""}${a.tab && TAB[a.tab] && typeof showTab === "function" ? `<button class="mta-go" type="button" data-tab="${esc(a.tab)}">Open ${esc(TAB[a.tab])} →</button>` : ""}`;
      S.history.push({ role: "user", text: q.text }, { role: "assistant", text: a.text || "" });
    } catch { w.querySelector(".mta-txt").textContent = "Couldn't load that answer — please try again."; }
    S.busy = false;
    const next = S.questions.filter((x) => x.top && !S.asked.has(x.id)).sort(byOrder).slice(0, 3);
    const extra = [];
    // the platform lacks this data → offer one AI research turn for it
    if (a && a.research && a.research.prompt) extra.push({ label: a.research.label, cls: "accent", run: () => send(a.research.prompt, true) });
    extra.push({ label: "All questions", cls: "ghost", run: () => allQuestions() });
    chips(next, extra);
  }

  // ── ask anything / ✦ questions (AI, budgeted) ──
  async function send(text, deep = false) {
    if (S.busy || !text) return;
    S.busy = true; $("mtaSend").disabled = true; user(text);
    const w = bot('<span class="mta-think">Thinking…</span>');
    try {
      const r = await fetch("/api/assistant/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatId: S.chatId, symbol: S.symbol, dcf: mode(S.symbol), message: text, deep, history: S.history.slice(-4) }) }).then((x) => x.json());
      if (r.chatId) S.chatId = r.chatId;
      S.budget = { tokensLeft: r.tokensLeft, turnsLeft: r.turnsLeft, limits: r.limits || (S.budget && S.budget.limits), available: r.available !== false };
      const tag = { platform: "AI · from platform data", research: "AI · web research", general: "AI · general knowledge", declined: "AI", limit: "limit", error: "unavailable", off: "unavailable" }[r.basis] || "AI";
      const src = (r.urls || []).length ? `<div class="mta-src">${r.urls.map((u) => `<a href="${esc(u.url)}" target="_blank" rel="noopener noreferrer">↗ ${esc(u.title)}</a>`).join("")}</div>` : "";
      w.querySelector(".mta-txt").innerHTML = `<span class="mta-tag ${/AI/.test(tag) ? "ai" : ""}">${esc(tag)}</span><div>${para(r.text || r.error || "No answer.")}</div>${src}`;
      S.history.push({ role: "user", text }, { role: "assistant", text: r.text || "" });
    } catch { w.querySelector(".mta-txt").textContent = "The assistant is unavailable right now — the ready-made questions still work."; }
    budgetLine(); S.busy = false; $("mtaSend").disabled = false; scroll();
  }

  // ── wiring ──
  function toggle(open) {
    S.open = open == null ? !S.open : open;
    panel.hidden = !S.open; launch.setAttribute("aria-expanded", String(S.open));
    if (S.open) { load(false); setTimeout(() => $("mtaIn").focus(), 60); }
  }
  launch.addEventListener("click", () => toggle());
  $("mtaClose").addEventListener("click", () => toggle(false));
  $("mtaReset").addEventListener("click", () => { S.chatId = null; S.questions = []; load(true); });
  $("mtaForm").addEventListener("submit", (e) => { e.preventDefault(); const i = $("mtaIn"); const t = i.value.trim(); if (!t) return; i.value = ""; send(t); });
  panel.addEventListener("click", (e) => { const g = e.target.closest(".mta-go"); if (g && typeof showTab === "function") showTab(g.dataset.tab); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.open) toggle(false); });
  // the company changed while the panel is open → refresh the questions for it
  setInterval(() => { if (S.open && !S.loading && !S.busy && curSym() !== S.symbol) load(true); }, 1500);
})();
