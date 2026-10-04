/* ════════════════════════════════════════════════════════════════════════════
   M-TERMINAL — Earnings Call workstation
   Same building blocks as the Company Analysis workstation (12-column grid,
   44 px panel bars, .dt tables, SVG charts, one tooltip). Sections render
   only when their data exists — nothing is shown as "not available".
     1  Earnings call preview      recent calls · consensus · price · transcript preview
     2  Upload & analyse           PDF · pasted text · NSE filing
     3+ Analysis                   reported performance · segments · guidance · costs &
                                   margin bridge · strategy · environment · Q&A analytics ·
                                   management statements · tone · red flags · thesis ·
                                   transcript highlights · peers · upcoming events
   ════════════════════════════════════════════════════════════════════════════ */
TABS.earnings = (() => {
  const S = { sym: null, co: null, sum: null, pack: null, peers: null, text: null, source: null, srcMeta: null, analysis: null, ai: null, tok: 0, filter: "all", chartKey: "revenue" };
  const K = () => WS.kit;
  const $e = (id) => document.getElementById(id);

  /* ── formatting ────────────────────────────────────────────────────── */
  let UNIT = "₹ Cr", SCALE = 1e7, CCY = "INR";
  const setCcy = (c) => { CCY = c || "INR"; const u = ersUnits(CCY); UNIT = u.unit; SCALE = u.scale; };
  const n1 = (v, dp = 1) => (v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp }));
  const U = (v, dp = 0) => (v == null || !Number.isFinite(v) ? "—" : (v / SCALE).toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp }));
  const amt = (v) => (CCY === "INR" ? `₹${U(v)} Cr` : `${U(v)} ${UNIT}`);
  const sgn = (v, dp = 1, suf = "%") => (v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${n1(v, dp)}${suf}`);
  const cls = (v) => (v == null || !Number.isFinite(v) ? "" : v >= 0 ? "up" : "down");
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fd = (iso) => { const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${+m[3]} ${MON[+m[2] - 1]} ${m[1]}` : "—"; };
  const fq = (iso) => { const m = String(iso || "").match(/^(\d{4})-(\d{2})/); if (!m) return "—"; const y = +m[1], mo = +m[2]; if (CCY !== "INR") return `Q${Math.ceil(mo / 3)} ${y}`; const q = mo <= 3 ? 4 : mo <= 6 ? 1 : mo <= 9 ? 2 : 3; return `Q${q} FY${String(mo <= 3 ? y : y + 1).slice(2)}`; };
  const pg = (c) => { const a = (Array.isArray(c) ? c : [c]).filter((x) => x != null && x !== ""); return a.length ? `<span class="ec-pg">p.${[...new Set(a)].join(", ")}</span>` : ""; };
  const arrow = (d) => (d === "up" ? `<span class="up">↑</span>` : d === "down" ? `<span class="down">↓</span>` : d === "watch" ? `<span class="ec-amb">?</span>` : `<span class="ws-dim">→</span>`);
  const badge = (t, k) => `<span class="ec-badge ${k || ""}">${esc(t)}</span>`;
  const scoreBadge = (x) => (x.score == null ? "—" : badge(x.label, x.score >= 5 ? "up" : x.score === 4 ? "ok" : x.score === 3 ? "amb" : "down"));
  const tbl = (head, rows, o = {}) => `<div class="table-wrap"><table class="dt ws-t ec-t ${o.cls || ""}"><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr>${rows.map((r) => `<tr${r.attr ? " " + r.attr : ""}>${(r.cells || r).map((c) => `<td>${c == null ? "—" : c}</td>`).join("")}</tr>`).join("")}</table></div>`;
  const panel = (t, b, o) => K().panel(t, b, o), row = (c) => K().row(c);
  let secN = 0;
  const band = (title, sub) => `<div class="ec-band"><span class="ec-n">${++secN}</span><h3>${esc(title)}</h3>${sub ? `<span class="ec-band-sub">${esc(sub)}</span>` : ""}</div>`;
  const grid = (html) => (html ? `<div class="ws-grid">${html}</div>` : "");
  const section = (title, sub, ...rows) => { const body = rows.filter(Boolean).map(grid).join(""); return body ? band(title, sub) + body : ""; };

  /* ═══════════════ HEADER ═══════════════ */
  function header(co) {
    const ks = co.keyStats || {}, r = (nm) => (co.ratios.find((x) => x.name === nm) || {}).value;
    const cell = (k, v) => `<div class="ws-stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;
    return `<div class="ws-head ec-head">
      <div class="ws-id"><h2>${esc(co.name)}</h2>
        <div class="ws-meta">${esc(co.symbol)} <i>·</i> ${esc(co.exchange || "")}${co.profile.sector ? ` <i>·</i> ${esc(co.profile.sector)}` : ""}${co.profile.industry ? ` › ${esc(co.profile.industry)}` : ""}</div>
        <div class="ws-actions"><button class="ws-watch mono" type="button" id="ecOpenER">▤ Company Analysis</button><button class="ws-watch mono" type="button" id="ecDocxTop" ${S.analysis ? "" : "disabled"}>⬇ DOCX report</button></div></div>
      <div class="ws-quote"><div class="ws-px">${F.px(co.price, co.currency)}</div><div class="ws-change ${F.cls(co.changePct)}">${(co.changePct >= 0 ? "+" : "") + F.pct(co.changePct, 2)}</div></div>
      <div class="ws-stats">${cell("MARKET CAP", F.cap(ks.mcap, co.currency))}${cell("P/E (TTM)", r("P/E (TTM)") == null ? "—" : n1(r("P/E (TTM)")) + "×")}${cell("EV/EBITDA", r("EV / EBITDA") == null ? "—" : n1(r("EV / EBITDA")) + "×")}${cell("DIV YIELD", r("Dividend yield") == null ? "—" : n1(r("Dividend yield")) + "%")}</div>
    </div>`;
  }

  /* ═══════════════ 1 · EARNINGS CALL PREVIEW ═══════════════ */
  function recentCalls() {
    const h = ((S.sum && S.sum.history) || []).slice(-6).reverse();
    if (!h.length) return "";
    const qs = (S.pack && S.pack.quarterly && S.pack.quarterly.quarters) || [];
    const revOf = (d) => { const q = qs.find((x) => String(x.qe || "").slice(0, 7) === String(d || "").slice(0, 7)); return q ? q.pl.revenue : null; };
    const hasRev = h.some((x) => revOf(x.date) != null);
    const rows = h.map((x) => [`<b>${fq(x.date)}</b>`, fd(x.date), n1(x.epsActual, 2), n1(x.epsEstimate, 2), ...(hasRev ? [U(revOf(x.date))] : []), `<span class="${cls(x.surprisePct)}">${sgn(x.surprisePct)}</span>`, x.beat == null ? "—" : badge(x.beat ? "Beat" : "Miss", x.beat ? "up" : "down")]);
    const st = S.sum.stats || {};
    return panel("RECENT EARNINGS", tbl(["Quarter", "Quarter end", "EPS", "Estimate", ...(hasRev ? [`Revenue (${UNIT})`] : []), "Surprise", "Result"], rows) + (st.quarters ? `<div class="ec-foot">Beat ${st.beats} of ${st.quarters} · average surprise ${sgn(st.avgSurprise)}</div>` : ""), { icon: "cal", sub: "reported vs consensus" });
  }
  function consensus() {
    const s = S.sum; if (!s || !s.available) return "";
    const n = s.next || {}, fw = (s.forward || []).filter((x) => x.epsAvg != null || x.revenueAvg != null);
    if (!n.epsEstimate && !n.revenueEstimate && !fw.length) return "";
    const tile = (k, v, sub) => `<div class="ec-tile"><div class="k">${k}</div><div class="v">${v}</div>${sub ? `<div class="s">${sub}</div>` : ""}</div>`;
    const nq = fw.find((x) => /current qtr|0q/i.test(x.label || x.period || "")) || fw[0] || {};
    return panel(`CONSENSUS · NEXT QUARTER`, `<div class="ec-sub2">${n.date ? `Results ${n.isEstimate ? "expected" : "on"} ${fd(n.date)}${n.daysUntil != null && n.daysUntil >= 0 ? ` · in ${n.daysUntil} days` : ""}` : ""}</div>
      <div class="ec-tiles3">${tile("EPS", n.epsEstimate != null ? n1(n.epsEstimate, 2) : n1(nq.epsAvg, 2), nq.growthPct != null ? `<span class="${cls(nq.growthPct)}">${sgn(nq.growthPct)} YoY</span>` : "")}${n.revenueEstimate != null || nq.revenueAvg != null ? tile(`Revenue (${UNIT})`, U(n.revenueEstimate ?? nq.revenueAvg), nq.revenueGrowthPct != null ? `<span class="${cls(nq.revenueGrowthPct)}">${sgn(nq.revenueGrowthPct)} YoY</span>` : "") : ""}${nq.numAnalysts ? tile("Analysts", nq.numAnalysts, "covering") : ""}</div>
      ${fw.length ? tbl(["Period", "EPS", "Low – High", "Growth", "Analysts"], fw.map((x) => [esc(x.label || x.period), n1(x.epsAvg, 2), x.epsLow != null ? `${n1(x.epsLow, 2)} – ${n1(x.epsHigh, 2)}` : "—", `<span class="${cls(x.growthPct)}">${sgn(x.growthPct, 0)}</span>`, x.numAnalysts ?? "—"])) : ""}`, { icon: "target", sub: "street estimates" });
  }
  function transcriptPreview() {
    const a = S.analysis; if (!a) return "";
    const m = a.meta || {}, mg = (a.participants && a.participants.management) || [];
    const src = S.srcMeta || {};
    const meta = [
      ["Title", `${esc(m.company || S.co?.name || "")}${m.period ? ` — ${esc(m.period)} earnings call` : " — earnings call"}`],
      m.callDate ? ["Call date", fd(m.callDate)] : null,
      mg.length ? ["Management", mg.slice(0, 6).map((p) => `${esc(p.name)}${p.title ? ` <span class="ws-dim">(${esc(p.title)})</span>` : ""}`).join("<br>")] : null,
      ["Source", src.url ? `<a href="${escUrl(src.url)}" target="_blank" rel="noopener noreferrer">${esc(src.label || "Exchange filing")}</a>` : esc(src.label || "Pasted text")],
      ["Length", `${(a.stats.words || 0).toLocaleString("en-IN")} words${m.pages ? ` · ${m.pages} pages` : ""}`],
      a.stats.analysts ? ["Analysts", `${a.stats.analysts} · ${a.stats.questions} questions`] : null,
    ].filter(Boolean);
    const metaP = panel("TRANSCRIPT", `<div class="ec-kv">${meta.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("")}</div>${m.editedTranscript || src.notice ? `<div class="ec-note">${esc([src.notice, m.editedTranscript ? "Transcript edited for readability — quotes may not be verbatim." : null].filter(Boolean).join(" "))}</div>` : ""}`, { icon: "doc", sub: m.period || "" });
    // key extracted insights: company-level figures first, then management's framing
    const ins = [];
    // the filed quarter is authoritative for the headline numbers; call statements fill in the rest
    const L = S.pack && S.pack.quarterly && S.pack.quarterly.quarters && S.pack.quarterly.quarters[0];
    const filedKeys = new Set();
    if (L) {
      const y = L.yoy || {};
      [["Revenue", L.pl.revenue, y.revenue], ["EBITDA", L.derived.ebitda, y.ebitda], ["Net profit", L.pl.pat, y.pat]].forEach(([k, v, g]) => { if (v != null) { filedKeys.add(k); ins.push({ t: `${k} ${amt(v)}${g != null ? `, ${sgn(g)} YoY` : ""} (filed, ${L.label})`, d: g == null ? "flat" : g >= 0 ? "up" : "down", p: null }); } });
      if (L.derived.ebitdaMargin != null) { filedKeys.add("EBITDA margin"); ins.push({ t: `EBITDA margin ${n1(L.derived.ebitdaMargin)}%${y.ebitdaMarginBps != null ? `, ${sgn(y.ebitdaMarginBps, 0, " bps")} YoY` : ""}`, d: y.ebitdaMarginBps == null ? "flat" : y.ebitdaMarginBps >= 0 ? "up" : "down", p: null }); }
    }
    for (const f of (a.facts || []).filter((x) => !x.qualifier && !filedKeys.has(x.metric)).slice(0, L ? 2 : 4)) ins.push({ t: `${f.metric} ${[f.value, f.change ? `${f.change}${f.period ? " " + f.period : ""}` : null].filter(Boolean).join(", ")}`, d: f.change ? (/^-/.test(f.change) ? "down" : "up") : "flat", p: f.page });
    for (const x of (a.snapshot.negatives || []).slice(0, 2)) ins.push({ t: x.text, d: "down", p: x.cite });
    const insP = ins.length ? panel("KEY EXTRACTED INSIGHTS", `<ul class="ec-ins">${ins.slice(0, 6).map((x) => `<li>${arrow(x.d)}<span>${esc(x.t)}</span>${pg(x.p)}</li>`).join("")}</ul>`, { icon: "bolt" }) : "";
    const q = (a.tone.phrases || []).find((p) => /conviction|condition|downside/i.test(p.read)) || (a.snapshot.positives || [])[0];
    const quoteP = q ? panel("IN MANAGEMENT'S WORDS", `<blockquote class="ec-quote">“${esc(q.text)}”</blockquote><div class="ec-quote-by">${esc(q.speaker || "Management")}${pg(q.page ?? q.cite)}${q.read ? `<br><span class="ws-dim">${esc(q.read)}</span>` : ""}</div>`, { icon: "news" }) : "";
    return row([[metaP, 5], [insP, 4], [quoteP, 3]]);
  }
  function preview() {
    if (!S.co) return "";
    return section("Earnings Call Preview", `${S.co.name} · consensus, recent results and the transcript`,
      row([[recentCalls(), 5], [consensus(), 4], [panel("PRICE PERFORMANCE", `<div id="ecPriceChart"></div>`, { icon: "chart", flush: true }), 3]]),
      transcriptPreview());
  }

  /* ═══════════════ 2 · UPLOAD & ANALYSE ═══════════════ */
  function inputs() {
    const calls = ((S.pack && S.pack.filings) || []).filter((f) => f.kind === "call").slice(0, 4);
    const isIN = S.sym ? /\.(NS|BO)$/i.test(S.sym) : true;
    const card = (ic, title, sub, body, id) => `<div class="ec-card${S.source === id ? " on" : ""}" data-src="${id}"><div class="ec-card-h">${K().ic(ic)}<div><b>${title}</b><span>${sub}</span></div></div>${body}</div>`;
    const up = card("doc", "Upload transcript (PDF)", "Exchange filing, company site or broker PDF", `<label class="ec-drop" id="ecDrop"><input type="file" id="ecPdf" accept="application/pdf,.pdf" hidden><span class="ec-drop-t">Drop a PDF here, or click to browse</span><span class="ec-drop-f mono" id="ecPdfName">${S.source === "pdf" && S.srcMeta ? esc(S.srcMeta.label) : ""}</span></label>`, "pdf");
    const paste = card("news", "Paste transcript text", "Headers, footers and page numbers are removed automatically", `<textarea id="ecPaste" placeholder="Paste the call transcript here…">${S.source === "paste" && S.text ? esc(S.text) : ""}</textarea>`, "paste");
    const nse = isIN ? card("layers", "Fetch from NSE", "The latest transcript the company filed with the exchange", `${calls.length ? `<ul class="ec-filed">${calls.map((c) => `<li><span>${fd(c.date)}</span><a href="${escUrl(c.url)}" target="_blank" rel="noopener noreferrer">${esc(c.text || "Transcript").slice(0, 70)}</a></li>`).join("")}</ul>` : `<div class="ws-dim ec-small">${S.sym ? "Load fetches the most recent filing." : "Enter an NSE ticker above first."}</div>`}<button class="mini-btn" type="button" id="ecNse">⬇ Fetch latest transcript</button><span class="ec-drop-f mono" id="ecNseMeta">${S.source === "nse" && S.srcMeta ? esc(S.srcMeta.label) : ""}</span>`, "nse") : "";
    const act = `<div class="ec-actions"><button class="btn btn-amber" type="button" id="ecAnalyze">${window.MT_AI && window.MT_AI.available ? "✦ " : ""}Analyse transcript</button><button class="btn" type="button" id="ecDocx">⬇ Extract report (DOCX)</button>
      <div class="ec-status mono" id="ecStatus">${S.text ? `Ready — ${S.source === "pdf" ? "PDF" : S.source === "nse" ? "NSE filing" : "pasted text"} · ${(S.text.split(/\s+/).length).toLocaleString("en-IN")} words` : "Provide a transcript to begin."}</div>
      <div class="ec-small ws-dim">Figures, guidance, Q&amp;A scoring, tone and red flags are rule-based and cited to pages${window.MT_AI && window.MT_AI.available ? "; environment, segments, costs, strategy and the bull / bear case are read by AI once per transcript and cached" : ""}.</div></div>`;
    return band("Upload & Analyse Transcript", "PDF · pasted text · NSE filing") + `<div class="ec-inrow">${up}${paste}${nse}${act}</div>`;
  }

  /* ═══════════════ 3+ · ANALYSIS ═══════════════ */
  // reported performance: the filed quarter (exchange XBRL) and the figures stated on the call
  function performance(a) {
    const qs = (S.pack && S.pack.quarterly && S.pack.quarterly.quarters) || [];
    let filed = "", mix = "", charts = "";
    if (qs.length) {
      const L = qs[0], P = qs.find((x) => x.qe && L.qe && +x.qe.slice(0, 4) === +L.qe.slice(0, 4) - 1 && x.qe.slice(5, 7) === L.qe.slice(5, 7));
      const y = L.yoy || {};
      const line = (lbl, cur, prev, chg, fmt, isPct) => cur == null ? null : [`<b>${lbl}</b>`, fmt(cur), prev != null ? fmt(prev) : "—", chg == null ? "—" : `<span class="${cls(chg)}">${isPct ? sgn(chg, 0, " bps") : sgn(chg)}</span>`, chg == null ? "" : arrow(chg >= 0 ? "up" : "down")];
      const pct = (v) => `${n1(v)}%`;
      const rows = [
        line("Revenue", L.pl.revenue, P && P.pl.revenue, y.revenue, (v) => U(v)),
        line("Gross margin", L.derived.grossMargin, P && P.derived.grossMargin, y.grossMarginBps, pct, true),
        line("EBITDA", L.derived.ebitda, P && P.derived.ebitda, y.ebitda, (v) => U(v)),
        line("EBITDA margin", L.derived.ebitdaMargin, P && P.derived.ebitdaMargin, y.ebitdaMarginBps, pct, true),
        line("Net profit", L.pl.pat, P && P.pl.pat, y.pat, (v) => U(v)),
        line("EPS (₹)", L.pl.eps, P && P.pl.eps, P && P.pl.eps ? ((L.pl.eps / P.pl.eps) - 1) * 100 : null, (v) => n1(v, 2)),
      ].filter(Boolean);
      filed = panel(`FILED RESULTS · ${esc(L.label)}`, tbl(["Metric", esc(L.label), P ? esc(P.label) : "Year ago", "YoY", ""], rows) + `<div class="ec-foot">${esc(S.pack.quarterly.scope || "Consolidated")} results filed with NSE (XBRL) · ${UNIT}</div>`, { icon: "grid", sub: "exchange filing" });
      const segs = (L.segments || []).filter((s) => s.revenue > 0);
      if (segs.length > 1) {
        const colors = [K().PAL.c1, K().PAL.c2, K().PAL.c3, K().PAL.c4];
        const top = segs.sort((a2, b) => b.revenue - a2.revenue), items = top.slice(0, 4).map((s, i) => ({ name: s.name, value: s.revenue / SCALE, color: colors[i] }));
        const other = top.slice(4).reduce((t, s) => t + s.revenue, 0); if (other > 0) items.push({ name: "Others", value: other / SCALE, color: "#6b7280" });
        mix = panel(`REVENUE MIX · ${esc(L.label)}`, K().chart({ kind: "donut", h: 190, items, center: U(L.pl.revenue), centerSub: UNIT, fmt: (v) => `${n1(v, 0)} ${UNIT}`, label: "Revenue by segment" }), { icon: "pie", sub: "segment revenue" });
      }
      if (qs.length >= 3) charts = panel("QUARTERLY TREND", `<div class="mc-tf ec-tf" id="ecChartKeys">${[["revenue", "Revenue"], ["ebitda", "EBITDA"], ["margin", "EBITDA margin"], ["pat", "PAT"]].map(([k, l]) => `<button class="mc-tfb${S.chartKey === k ? " on" : ""}" type="button" data-ck="${k}">${l}</button>`).join("")}</div><div id="ecTrend">${trendChart()}</div>`, { icon: "bars", sub: `${Math.min(8, qs.length)} quarters` });
    }
    const co = (a.facts || []).filter((f) => !f.qualifier), biz = (a.facts || []).filter((f) => f.qualifier);
    const stated = co.length ? panel("STATED ON THE CALL", tbl(["Metric", "Value", "Change", "Basis", "Page"], co.map((f) => [`<b>${esc(f.metric)}</b>`, esc(f.value || "—"), f.change ? `<span class="${/^-/.test(f.change) ? "down" : "up"}">${esc(f.change)}</span>${f.period ? ` <span class="ws-dim">${esc(f.period)}</span>` : ""}${f.computed ? ` <span class="ws-dim">(computed)</span>` : ""}` : "—", badge(f.basis || "value"), pg(f.page)])), { icon: "news", sub: "management's own figures" }) : "";
    const bizP = biz.length ? panel("BUSINESS-LEVEL FIGURES", tbl(["Business", "Metric", "Value", "Change", "Page"], biz.map((f) => [`<b>${esc(f.qualifier)}</b>`, esc(f.metric), esc(f.value || "—"), f.change ? `<span class="${/^-/.test(f.change) ? "down" : "up"}">${esc(f.change)}</span>` : "—", pg(f.page)])), { icon: "layers", sub: "brands · segments · geographies" }) : "";
    return section("Reported Performance — Company Level", "exchange-filed results and the figures management stated",
      row([[filed, 5], [mix, 3], [charts, 4]]), row([[stated, 7], [bizP, 5]]));
  }
  function trendChart() {
    const qs = ((S.pack && S.pack.quarterly && S.pack.quarterly.quarters) || []).slice(0, 8).reverse();
    const k = S.chartKey, pick = { revenue: (q) => q.pl.revenue / SCALE, ebitda: (q) => q.derived.ebitda / SCALE, margin: (q) => q.derived.ebitdaMargin, pat: (q) => q.pl.pat / SCALE }[k];
    const name = { revenue: "Revenue", ebitda: "EBITDA", margin: "EBITDA margin", pat: "Net profit" }[k];
    return K().chart({ kind: k === "margin" ? "lines" : "bars", h: 200, cats: qs.map((q) => q.label), pct: k === "margin", fmt: (v) => (k === "margin" ? `${n1(v)}%` : `${n1(v, 0)} ${UNIT}`), label: name, series: [{ name, color: K().PAL.c1, values: qs.map((q) => { const v = pick(q); return Number.isFinite(v) ? v : null; }) }] });
  }

  // segments: filed segment numbers (XBRL) merged with the AI-read commentary
  function segments(a) {
    const L = S.pack && S.pack.quarterly && S.pack.quarterly.quarters && S.pack.quarterly.quarters[0];
    const xs = L ? (L.segments || []).filter((s) => s.revenue != null) : [];
    const ai = (a.ai && a.ai.segments) || [];
    if (!xs.length && !ai.length) return "";
    const key = (s) => String(s || "").toLowerCase().replace(/[^a-z ]/g, "").split(" ").filter((w) => w.length > 2 && !/business|segment|division|limited/.test(w));
    const match = (name) => ai.find((g) => { const a1 = key(name), b1 = key(g.name); return a1.some((w) => b1.includes(w)); });
    const used = new Set();
    const hasNum = xs.length > 0, hasAI = ai.length > 0;
    const rows = xs.map((s) => { const g = match(s.name); if (g) used.add(g); return { s, g }; }).concat(ai.filter((g) => !used.has(g)).map((g) => ({ s: null, g })));
    const head = ["Segment", ...(hasNum ? [`Revenue (${UNIT})`, "YoY", "Share", "EBIT margin", "Δ margin"] : []), ...(hasAI ? ["Management commentary", "Outlook", ""] : []), "Page"];
    const body = rows.map(({ s, g }) => [
      `<b>${esc((s && s.name) || g.name)}</b>`,
      ...(hasNum ? (s ? [U(s.revenue), `<span class="${cls(s.revenueYoy)}">${sgn(s.revenueYoy)}</span>`, L.pl.revenue ? `${n1((s.revenue / L.pl.revenue) * 100)}%` : "—", s.margin != null ? `${n1(s.margin)}%` : "—", s.marginYoyBps != null ? `<span class="${cls(s.marginYoyBps)}">${sgn(s.marginYoyBps, 0, " bps")}</span>` : "—"] : ["—", "—", "—", "—", "—"]) : []),
      ...(hasAI ? (g ? [esc([g.quarter, g.driver].filter((x) => x && !/not disclosed/i.test(x)).join(" — ")), esc(g.outlook && !/not disclosed/i.test(g.outlook) ? g.outlook : "—"), arrow(g.signal)] : ["—", "—", ""]) : []),
      g ? pg(g.cite) : "",
    ]);
    const cards = ai.slice(0, 4).map((g) => `<div class="ec-seg"><div class="ec-seg-h"><b>${esc(g.name)}</b>${arrow(g.signal)}${pg(g.cite)}</div>${g.quarter && !/not disclosed/i.test(g.quarter) ? `<div><span>This quarter</span>${esc(g.quarter)}</div>` : ""}${g.driver ? `<div><span>Driver</span>${esc(g.driver)}</div>` : ""}${g.outlook && !/not disclosed/i.test(g.outlook) ? `<div><span>Outlook</span>${esc(g.outlook)}</div>` : ""}</div>`).join("");
    return section("Segment Performance & Commentary", hasNum ? `filed segment results${hasAI ? " with management's commentary" : ""}` : "from management's discussion",
      hasAI && ai.length >= 2 ? row([[panel("SEGMENTS AT A GLANCE", `<div class="ec-segs">${cards}</div>`, { icon: "layers", sub: `${ai.length} businesses discussed` }), 12]]) : "",
      row([[panel(hasNum ? `SEGMENT SCORECARD${L ? " · " + esc(L.label) : ""}` : "SEGMENT SCORECARD", tbl(head, body), { icon: "grid" }), 12]]));
  }

  // guidance: bucketed by horizon, then the full tracker
  function horizonOf(g) {
    const p = `${g.period || ""} ${g.horizon || ""}`.toLowerCase(), fy = (g.period || "").match(/FY(\d{2})/), now = ((S.analysis.meta.period || "").match(/FY(\d{2})/) || [])[1];
    if (/20(2[89]|3\d)|long[- ]term|vision|fy3\d/.test(p) || (fy && now && +fy[1] - +now >= 2)) return "long";
    if (/next quarter|coming quarter|near[- ]term|q[1-4]\b|this quarter/.test(p)) return "near";
    return "medium";
  }
  function guidance(a) {
    const g = a.guidance || []; if (!g.length) return "";
    const buckets = { near: [], medium: [], long: [] };
    for (const x of g) buckets[horizonOf(x)].push(x);
    const col = (k, title, sub, ic) => buckets[k].length ? panel(title, tbl(["Metric", "Guidance / commentary"], buckets[k].slice(0, 6).map((x) => [`<b>${esc(x.metric || "Outlook")}</b>`, `${x.target ? `<b class="ec-amb">${esc(x.target)}</b> · ` : ""}${esc(x.statement.length > 150 ? x.statement.slice(0, 150).replace(/\s+\S*$/, "") + "…" : x.statement)} ${pg(x.page)}`])), { icon: ic, sub }) : "";
    const type = (x) => (x.low != null || /\d/.test(x.target || "") ? "Quantified" : x.target ? "Directional" : "Qualitative");
    const hasRev = g.some((x) => x.vsPrior);
    const tracker = panel("GUIDANCE TRACKER", tbl(["Metric", "Period", "Guidance / target", "Condition", "Type", "Conviction", "Quality", ...(hasRev ? ["Revision (as stated)"] : []), "Source"], g.map((x) => [`<b>${esc(x.metric || "Outlook")}</b>`, esc(x.period || "—"), x.target ? `<b>${esc(x.target)}</b>` : `<span class="ws-dim">qualitative</span>`, esc(x.condition || "—"), badge(type(x), type(x) === "Quantified" ? "up" : type(x) === "Directional" ? "amb" : ""), esc(x.conviction), `${x.score}/5`, ...(hasRev ? [x.vsPrior ? badge(x.vsPrior, x.vsPrior === "raised" ? "up" : x.vsPrior === "cut" ? "down" : "") : "—"] : []), `${esc(x.speaker || "Mgmt")} ${pg(x.page)}`])), { icon: "target", sub: `${g.length} forward-looking statements` });
    const rc = a.reconciliation;
    const recon = rc ? `<div class="ec-note ${rc.reconciles ? "ok" : "bad"}"><b>Guidance reconciliation:</b> ${esc(rc.components.join(" − "))} ⇒ implied ${esc(rc.implied)}; stated ${esc(rc.stated)} — ${rc.reconciles ? "the components add up" : "the components do not add up"} ${pg(rc.cite)}</div>` : "";
    return section("Management Guidance & Outlook", "forward-looking statements and targets, in management's words",
      row([[col("near", "NEAR TERM · NEXT QUARTER", "", "cal"), 4], [col("medium", "MEDIUM TERM · 1–3 YEARS", "", "bars"), 4], [col("long", "LONG TERM · 2030+", "", "target"), 4]]),
      row([[tracker, 12]]), recon ? `<div class="ws-cell" style="grid-column:span 12">${recon}</div>` : "");
  }

  // cost, pricing & margin: AI-read input matrix + the filed EBITDA bridge
  function costs(a) {
    const c = (a.ai && a.ai.costs) || [];
    const costP = c.length ? panel("INPUT COSTS & PRICING", tbl(["Input / cost", "Trend", "Magnitude", "Impact", "Management response", "Page"], c.map((x) => [`<b>${esc(x.input)}</b>`, arrow(x.direction), esc(x.magnitude || "—"), badge(x.net === "tailwind" ? "Tailwind" : x.net === "headwind" ? "Headwind" : "Neutral", x.net === "tailwind" ? "up" : x.net === "headwind" ? "down" : ""), esc(x.action || "—"), pg(x.cite)])), { icon: "scale", sub: "inputs, pricing actions and their effect" }) : "";
    const q = S.pack && S.pack.quarterly, br = q && q.bridge;
    let bridge = "";
    if (br && br.steps && br.steps.length >= 3) {
      const st = br.steps, max = Math.max(...st.filter((x) => x.kind === "delta").map((x) => Math.abs(x.value)), 1);
      const L = q.quarters[0], P = q.quarters.find((x) => x.label === br.from);
      bridge = panel(`EBITDA BRIDGE · ${esc(br.from)} → ${esc(br.to)}`, `<div class="ec-bridge">${st.map((x) => x.kind !== "delta" ? `<div class="ec-br tot"><span>${esc(x.label)}</span><b>${U(x.value)}</b></div>` : `<div class="ec-br"><span>${x.value >= 0 ? "＋" : "－"} ${esc(x.label)}</span><i class="t"><i class="${x.value >= 0 ? "up" : "down"}" style="width:${(Math.abs(x.value) / max * 100).toFixed(1)}%"></i></i><b class="${cls(x.value)}">${x.value >= 0 ? "+" : ""}${U(x.value)}</b></div>`).join("")}</div>
        ${L && P ? `<div class="ec-note">EBITDA margin ${n1(P.derived.ebitdaMargin)}% → <b>${n1(L.derived.ebitdaMargin)}%</b> (<span class="${cls(L.derived.ebitdaMargin - P.derived.ebitdaMargin)}">${sgn((L.derived.ebitdaMargin - P.derived.ebitdaMargin) * 100, 0, " bps")}</span>) · ${UNIT} · from the exchange filings</div>` : ""}`, { icon: "bars", sub: "year-on-year, from filed results" });
    }
    const priceTheme = !c.length ? a.themes.find((t) => /pricing|margins|costs/i.test(t.theme)) : null;
    const themeP = priceTheme ? panel("MANAGEMENT ON COSTS & PRICING", `<ul class="ec-list">${priceTheme.points.map((p) => `<li>${esc(p.text)} ${pg(p.page)}</li>`).join("")}</ul>`, { icon: "scale" }) : "";
    return section("Cost, Pricing & Margin Analysis", "input costs, pricing actions and the margin walk", row([[costP || themeP, 7], [bridge, 5]]));
  }

  // strategy & capital allocation
  function strategy(a) {
    const ai = (a.ai && a.ai.strategy) || [];
    const th = (re) => a.themes.find((t) => re.test(t.theme));
    const cap = th(/capital allocation/i), bs = th(/balance sheet/i), strat = th(/strategy/i);
    const money = (a.facts || []).filter((f) => /capex|dividend|net debt|net cash|free cash|r&d|capacity/i.test(f.metric));
    const mna = [...(cap ? cap.points : []), ...(strat ? strat.points : [])].filter((p) => /acqui|merger|stake|inorganic|joint venture|divest/i.test(p.text));
    const card = (title, ic, body, cite) => (body ? panel(title, body, { icon: ic, sub: cite || "" }) : "");
    const li = (arr) => (arr.length ? `<ul class="ec-list">${arr.join("")}</ul>` : "");
    const pri = card("STRATEGIC PRIORITIES", "flag", li(ai.map((x) => `<li>${esc(x.item)}${x.horizon && !/not/i.test(x.horizon) ? ` <span class="ws-dim">· ${esc(x.horizon)}</span>` : ""} ${pg(x.cite)}</li>`)) || (strat ? li(strat.points.map((p) => `<li>${esc(p.text)} ${pg(p.page)}</li>`)) : ""));
    const capP = card("CAPITAL ALLOCATION", "scale", money.length ? tbl(["Item", "Figure", "Page"], money.map((f) => [`${esc(f.metric)}${f.qualifier ? ` <span class="ws-dim">(${esc(f.qualifier)})</span>` : ""}`, `<b>${esc(f.value || f.change || "—")}</b>`, pg(f.page)])) : "");
    const proj = card("PROJECTS & INVESTMENTS", "layers", cap ? li(cap.points.filter((p) => !mna.includes(p)).map((p) => `<li>${esc(p.text)} ${pg(p.page)}</li>`)) : "");
    const mP = card(mna.length ? "M&A / INORGANIC" : "BALANCE SHEET & CASH", mna.length ? "users" : "shield", mna.length ? li(mna.map((p) => `<li>${esc(p.text)} ${pg(p.page)}</li>`)) : bs ? li(bs.points.map((p) => `<li>${esc(p.text)} ${pg(p.page)}</li>`)) : "");
    return section("Strategy & Capital Allocation", "priorities, capital deployment and inorganic moves", row([[pri, 3], [capP, 3], [proj, 3], [mP, 3]]));
  }

  // operating environment
  function environment(a) {
    const env = (a.ai && a.ai.environment) || [];
    const ext = a.themes.find((t) => /external|regulation/i.test(t.theme));
    if (!env.length && !ext) return "";
    const tableP = env.length ? panel("OPERATING ENVIRONMENT", tbl(["Factor", "Trend", "Management commentary", "Page"], env.map((e) => [`<b>${esc(e.factor)}</b>`, `${arrow(e.direction)} <span class="ws-dim">${esc({ up: "rising", down: "easing", flat: "stable", watch: "watch" }[e.direction] || "")}</span>`, esc(e.read), pg(e.cite)])), { icon: "news", sub: "management's read of the macro and industry" }) : "";
    const view = ext ? panel("MANAGEMENT'S VIEW", `<ul class="ec-list">${ext.points.slice(0, 4).map((p) => `<li>${esc(p.text)} ${pg(p.page)}</li>`).join("")}</ul>`, { icon: "doc", sub: "verbatim" }) : "";
    return section("Operating Environment & Industry Commentary", "macro, policy and demand backdrop", row([[tableP, 8], [view, 4]]));
  }

  // Q&A analytics — the deepest section
  function qa(a) {
    const Q = a.qa, ex = Q.exchanges || [];
    if (!ex.length) return "";
    const scored = ex.filter((x) => x.score != null);
    const firms = [...new Set(ex.map((x) => x.firm).filter(Boolean))];
    const analysts = [...new Set(ex.map((x) => x.analyst).filter(Boolean))];
    const avgWords = Math.round(ex.reduce((t, x) => t + (x.answerWords || 0), 0) / Math.max(1, ex.length));
    const tile = (k, v, s) => `<div class="ec-kpi"><div class="k">${k}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ""}</div>`;
    const kpis = `<div class="ec-kpis">${tile("Questions", ex.length, `${Q.themes.length} themes`)}${tile("Analysts", analysts.length || "—", firms.length ? `from ${firms.length} institutions` : "")}${tile("Avg answer length", `${avgWords}<small> words</small>`, "")}${tile("Answer quality", Q.avgScore != null ? `${Q.avgScore}<small>/5</small>` : "—", `${scored.filter((x) => x.score >= 4).length} direct · ${scored.filter((x) => x.score <= 2).length} evasive`)}${tile("Probing questions", `${Math.round(ex.filter((x) => x.concern).length / ex.length * 100)}%`, "asked about a weakness or risk")}</div>`;
    const maxT = Math.max(1, ...Q.themes.map((t) => t.questions));
    const byTheme = panel("QUESTIONS BY THEME", `<div class="ec-bars">${Q.themes.map((t) => `<div class="ec-bar"><span class="n">${esc(t.theme)}</span><i class="t"><i style="width:${(t.questions / maxT * 100).toFixed(1)}%"></i></i><b>${t.questions}</b><em>${Math.round(t.questions / ex.length * 100)}%</em></div>`).join("")}</div>`, { icon: "bars", sub: "# questions · share" });
    const qual = [["Direct + quantified", (x) => x.score === 5, K().PAL.up], ["Direct", (x) => x.score === 4, "#5a9d7c"], ["Partial", (x) => x.score === 3, K().PAL.hold], ["Deflected", (x) => x.score === 2, "#c77a3c"], ["Refused", (x) => x.score === 1, K().PAL.down]].map(([l, f, c]) => [l, scored.filter(f).length, c]);
    const qualP = panel("ANSWER QUALITY", `<div class="ec-bars">${qual.map(([l, n2, c]) => `<div class="ec-bar"><span class="n">${l}</span><i class="t"><i style="width:${(n2 / Math.max(1, scored.length) * 100).toFixed(1)}%;background:${c}"></i></i><b>${n2}</b><em>${Math.round(n2 / Math.max(1, scored.length) * 100)}%</em></div>`).join("")}</div><div class="ec-foot">Rubric: 5 direct and quantified · 4 direct · 3 partial · 2 deflected · 1 refused</div>`, { icon: "shield", sub: `average ${Q.avgScore ?? "—"}/5` });
    // benchmarking: how well each theme was answered, and which themes several analysts pressed on
    const bench = panel("THEME BENCHMARK", tbl(["Theme", "Analysts", "Avg answer", "Weakest"], Q.themes.map((t) => { const xs = ex.filter((x) => x.theme === t.theme && x.score != null), w = xs.sort((p, q2) => p.score - q2.score)[0]; return [`<b>${esc(t.theme)}</b>`, t.analysts.length, t.avgScore != null ? `<span class="${t.avgScore >= 4 ? "up" : t.avgScore < 3 ? "down" : ""}">${t.avgScore}/5</span>` : "—", w && w.score <= 3 ? badge(w.label, w.score <= 2 ? "down" : "amb") : `<span class="ws-dim">—</span>`]; })), { icon: "target", sub: "answer quality by topic" });
    // analyst benchmarking
    const byA = {};
    for (const x of ex) { const k = x.analyst || x.firm || "Unnamed"; (byA[k] ||= { analyst: x.analyst, firm: x.firm, xs: [] }).xs.push(x); }
    const aRows = Object.values(byA).sort((p, q2) => q2.xs.length - p.xs.length).map((r) => {
      const sc = r.xs.filter((x) => x.score != null), avg = sc.length ? sc.reduce((t, x) => t + x.score, 0) / sc.length : null, worst = sc.sort((p, q2) => p.score - q2.score)[0];
      return [`<b>${esc(r.analyst || "Unnamed")}</b>`, esc(r.firm || "—"), r.xs.length, [...new Set(r.xs.map((x) => x.theme))].map((t) => badge(t)).join(" "), `${Math.round(r.xs.reduce((t, x) => t + (x.answerWords || 0), 0) / r.xs.length)} words`, avg != null ? `<b class="${avg >= 4 ? "up" : avg < 3 ? "down" : ""}">${n1(avg)}/5</b>` : "—", worst && worst.score <= 3 ? `${scoreBadge(worst)}${worst.phrase ? ` <span class="ws-dim">“${esc(worst.phrase)}”</span>` : ""}` : `<span class="ws-dim">all answered directly</span>`];
    });
    const aP = panel("ANALYST BENCHMARKING", tbl(["Analyst", "Institution", "Questions", "Themes", "Avg answer", "Answer quality", "Weakest response"], aRows), { icon: "users", sub: `${Object.keys(byA).length} participants` });
    // every exchange, filterable by theme
    const chips = `<div class="mc-tf ec-tf" id="ecQaFilter"><button class="mc-tfb${S.filter === "all" ? " on" : ""}" data-f="all" type="button">All (${ex.length})</button>${Q.themes.map((t) => `<button class="mc-tfb${S.filter === t.theme ? " on" : ""}" data-f="${esc(t.theme)}" type="button">${esc(t.theme)} (${t.questions})</button>`).join("")}</div>`;
    const exRows = ex.map((x, i) => ({ attr: `data-theme="${esc(x.theme)}"${S.filter !== "all" && S.filter !== x.theme ? " hidden" : ""}`, cells: [String(i + 1), `<b>${esc(x.analyst || "Analyst")}</b>${x.firm ? `<br><span class="ws-dim">${esc(x.firm)}</span>` : ""}`, esc(x.question), `${esc(x.answer || "—")}${x.responder ? `<br><span class="ws-dim">— ${esc(x.responder)}${x.responderTitle ? `, ${esc(x.responderTitle)}` : ""}</span>` : ""}`, badge(x.theme), `${scoreBadge(x)}${x.phrase ? `<br><span class="ws-dim">“${esc(x.phrase)}”</span>` : ""}`, pg(x.page)] }));
    const all = panel("ALL EXCHANGES — WHO ASKED WHAT, AND WHAT MANAGEMENT SAID", chips + tbl(["#", "Analyst", "Question", "Management response", "Theme", "Answer", "Page"], exRows, { cls: "ec-qa" }), { icon: "news", sub: `${ex.length} exchanges` });
    return section("Q&A Analytics", "analyst questions, management responses and how well they were answered",
      `<div class="ws-cell" style="grid-column:span 12">${kpis}</div>`,
      row([[byTheme, 4], [qualP, 4], [bench, 4]]), row([[aP, 12]]), row([[all, 12]]));
  }

  // key management statements
  function statements(a) {
    const out = [], seen = new Set();
    const titleOf = (sp) => { const m = ((a.participants && a.participants.management) || []).find((p) => p.name === sp); return m && m.title ? m.title : ""; };
    const push = (text, speaker, page, tag) => { const k = String(text).toLowerCase().slice(0, 50); if (!text || seen.has(k) || out.length >= 6) return; seen.add(k); out.push({ text, speaker, page, tag }); };
    for (const p of a.tone.phrases || []) push(p.text, p.speaker, p.page, p.read);
    for (const t of a.themes.slice(0, 5)) { const p = t.points.find((x) => x.prepared) || t.points[0]; if (p) push(p.text, p.speaker, p.page, t.theme); }
    if (!out.length) return "";
    return section("Key Management Statements", "important quotes from the prepared remarks and the Q&A",
      `<div class="ws-cell" style="grid-column:span 12"><div class="ec-quotes">${out.map((q) => `<div class="ec-qcard"><div class="q">“${esc(q.text)}”</div><div class="by"><b>${esc(q.speaker || "Management")}</b>${titleOf(q.speaker) ? `<span>${esc(titleOf(q.speaker))}</span>` : ""}</div><div class="ft">${badge(q.tag)}${pg(q.page)}</div></div>`).join("")}</div></div>`);
  }

  // tone & language
  function tone(a) {
    const t = a.tone, d = t.distribution;
    const distP = d ? panel("TONE DISTRIBUTION", `<div class="ec-stack">${[["positive", K().PAL.up], ["neutral", "#64748b"], ["cautious", K().PAL.hold], ["negative", K().PAL.down]].map(([k, c]) => (d[k] ? `<i style="width:${d[k]}%;background:${c}" data-tip="${esc(`${k}\n${d[k]}% of statements`)}"></i>` : "")).join("")}</div><div class="ec-legend">${[["Positive", "positive", K().PAL.up], ["Neutral", "neutral", "#64748b"], ["Cautious", "cautious", K().PAL.hold], ["Negative", "negative", K().PAL.down]].map(([l, k, c]) => `<div><i style="background:${c}"></i>${l}<b>${d[k]}%</b></div>`).join("")}</div><div class="ec-foot">Share of management statements · overall reading: <b>${esc(t.sentiment.label)}</b> (${t.sentiment.score}/100)</div>`, { icon: "pie", sub: "management statements" }) : "";
    const kp = (t.keyPhrases || []).length ? panel("KEY PHRASES", tbl(["Phrase", "Count", "Context"], t.keyPhrases.slice(0, 8).map((p) => [`<b>${esc(p.phrase)}</b>`, p.count, `<span class="ws-dim">${esc(p.context || "—")}</span>`])), { icon: "news", sub: "most-used business language" }) : "";
    const blk = (label, b) => (b ? `<div class="ec-pq"><div class="h">${label}</div><div class="v">${b.score != null ? `${b.score}<small>/5</small>` : "—"}</div><div class="s">${b.share != null ? `${b.share}% confidence vs hedges` : "few markers"} · ${b.hedgePerK} hedges / 1k words</div></div>` : "");
    const pq = panel("PREPARED REMARKS vs Q&A", `<div class="ec-pq2">${blk("Prepared remarks", t.remarks)}${blk("Q&A answers", t.answers)}</div><ul class="ec-list sm">${(t.reading || []).slice(0, 3).map((r) => `<li>${esc(r)}</li>`).join("")}</ul>`, { icon: "scale", sub: t.profile || "" });
    const hMax = Math.max(1, ...(t.hedges || []).map((h) => h.count));
    const hed = (t.hedges || []).length ? panel("HEDGING INDICATORS", `<div class="ec-bars">${t.hedges.map((h) => `<div class="ec-bar"><span class="n">“${esc(h.phrase)}”</span><i class="t"><i class="hedge" style="width:${(h.count / hMax * 100).toFixed(1)}%"></i></i><b>${h.count}</b></div>`).join("")}</div>${t.hedgeObjects ? `<div class="ec-foot">Hedges on the macro ${Math.round(t.hedgeObjects.macro * 100)}% · on the company ${Math.round(t.hedgeObjects.company * 100)}%</div>` : ""}`, { icon: "shield", sub: "qualifiers in management speech" }) : "";
    return section("Tone & Language Analysis", "how confident management sounded, and where it hedged", row([[distP, 3], [kp, 3], [pq, 3], [hed, 3]]));
  }

  // red flags, evasions & clean areas
  function flags(a) {
    const f = a.redFlags.flags || [], ex = a.qa.exchanges || [];
    const partial = ex.filter((x) => x.score != null && x.score <= 3);
    const clean = ex.filter((x) => x.score === 5);
    const fP = f.length ? panel("POTENTIAL RED FLAGS", tbl(["Issue", "Evidence", "Severity"], f.map((x) => [`<b>${esc(x.flag)}</b>`, `${esc(x.evidence)} ${pg(x.cite)}`, badge(x.severity, x.severity === "high" ? "down" : x.severity === "medium" ? "amb" : "")])), { icon: "flag", sub: `${f.length} flagged` }) : "";
    const pP = partial.length ? panel("PARTIAL / LIMITED ANSWERS", tbl(["Topic", "Asked", "Response", "Page"], partial.map((x) => [`<b>${esc(x.theme)}</b>`, esc(x.question.length > 110 ? x.question.slice(0, 110).replace(/\s+\S*$/, "") + "…" : x.question), `${scoreBadge(x)}${x.phrase ? ` <span class="ws-dim">“${esc(x.phrase)}”</span>` : ""}`, pg(x.page)])), { icon: "news", sub: `${partial.length} instances` }) : "";
    const cP = clean.length || a.redFlags.clean.length ? panel("CLEAN AREAS — GOOD DISCLOSURE", `${clean.length ? tbl(["Topic", "Answered with", "Page"], clean.slice(0, 8).map((x) => [`<b>${esc(x.theme)}</b>`, esc(x.answer.length > 130 ? x.answer.slice(0, 130).replace(/\s+\S*$/, "") + "…" : x.answer), pg(x.page)])) : ""}${a.redFlags.clean.length ? `<div class="ec-chips"><span class="ws-dim">No issues found on:</span> ${a.redFlags.clean.map((c) => badge(c.replace(/_/g, " "), "up")).join(" ")}</div>` : ""}`, { icon: "shield", sub: `${clean.length} direct, quantified answers` }) : "";
    return section("Red Flags, Evasions & Clean Areas", "where management was non-committal — and where it disclosed clearly", row([[fP, 4], [pP, 4], [cP, 4]]));
  }

  // thesis, monitorables & next steps
  function thesis(a) {
    const ai = a.ai || {}, g = (a.guidance || []).filter((x) => x.hasMetric || x.target);
    const list = (arr, cl) => `<ul class="ec-list ${cl}">${arr.join("")}</ul>`;
    const bull = (ai.bull || []).length ? panel("BULL CASE", list(ai.bull.map((x) => `<li>${esc(x.point)} ${pg(x.cite)}</li>`), "pos"), { icon: "bolt" }) : "";
    const base = g.length ? panel("BASE CASE — MANAGEMENT OUTLOOK", list(g.slice(0, 5).map((x) => `<li>${esc(x.metric || "Outlook")}: ${x.target ? `<b>${esc(x.target)}</b>` : ""}${x.period ? ` <span class="ws-dim">${esc(x.period)}</span>` : ""}${x.condition ? ` <span class="ws-dim">· ${esc(x.condition)}</span>` : ""} ${pg(x.page)}</li>`), ""), { icon: "target" }) : "";
    const bear = (ai.bear || []).length ? panel("BEAR CASE RISKS", list(ai.bear.map((x) => `<li>${esc(x.point)} ${pg(x.cite)}</li>`), "neg"), { icon: "flag" }) : "";
    const mon = a.monitorables || [];
    const monP = mon.length ? panel("KEY MONITORABLES", `<ol class="ec-num">${mon.slice(0, 6).map((m) => `<li><span>${esc(m.kpi)}</span><b class="up">${esc(m.pass)}</b>${pg(m.cite)}</li>`).join("")}</ol>`, { icon: "cal", sub: "next quarter" }) : "";
    const monT = mon.length ? panel("MONITORABLES — PASS / WATCH / FAIL", tbl(["KPI", "Management said", "Pass", "Watch", "Fail", "Page"], mon.map((m) => [`<b>${esc(m.kpi)}</b>`, esc(m.management), `<b class="up">${esc(m.pass)}</b>`, `<span class="ec-amb">${esc(m.watch)}</span>`, `<b class="down">${esc(m.fail)}</b>`, pg(m.cite)])), { icon: "grid", sub: "thresholds from management's own words" }) : "";
    const nq = a.nextQuestions || [];
    const nqP = nq.length ? panel("NEXT CALL CHECKLIST", `<ul class="ec-check">${nq.map((q) => `<li><span class="box"></span>${esc(q)}</li>`).join("")}</ul>`, { icon: "doc", sub: "questions to ask" }) : "";
    const mx = (ai.matrix || []).length ? panel("LIKELIHOOD × IMPACT", `<div class="ec-matrix">${["high", "medium", "low"].map((imp) => `<div class="r"><span class="ax">${imp} impact</span>${["low", "medium", "high"].map((lk) => `<div class="c${imp === "high" && lk === "high" ? " hot" : ""}">${ai.matrix.filter((x) => x.impact === imp && x.likelihood === lk).map((x) => `<span class="${x.sign === "up" ? "up" : "down"}">${esc(x.item)}</span>`).join("")}</div>`).join("")}</div>`).join("")}<div class="r"><span class="ax"></span><span class="lk">low likelihood</span><span class="lk">medium</span><span class="lk">high</span></div></div><div class="ec-foot">Analyst judgment drawn from the transcript evidence.</div>`, { icon: "grid" }) : "";
    return section("Thesis, Monitorables & Next Steps", "what drives the view, what to watch and what to ask next",
      row([[bull, 3], [base, 3], [bear, 3], [monP, 3]]), row([[monT, 8], [nqP, 4]]), row([[mx, 12]]));
  }

  // transcript highlights
  function highlights(a) {
    const rows = [];
    for (const t of a.themes) for (const p of t.points.slice(0, 2)) rows.push({ t, p });
    if (!rows.length) return "";
    const segs = ((a.ai && a.ai.segments) || []).map((g) => g.name);
    const segOf = (txt) => segs.find((n) => new RegExp(`\\b${n.split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(txt)) || null;
    const hasSeg = rows.some((r) => segOf(r.p.text));
    return section("Transcript Highlights", "key excerpts with their category and page",
      row([[panel("HIGHLIGHTS", tbl(["#", "Excerpt", "Category", ...(hasSeg ? ["Segment"] : []), "Speaker", "Page"], rows.slice(0, 12).map((r, i) => [String(i + 1), `“${esc(r.p.text)}”`, badge(r.t.theme), ...(hasSeg ? [esc(segOf(r.p.text) || "—")] : []), esc(r.p.speaker || "—"), pg(r.p.page)])), { icon: "doc", sub: `${Math.min(12, rows.length)} excerpts` }), 12]]));
  }

  // peers (latest filed quarter) — shown only once the data has arrived
  function peers() {
    const rows = ((S.peers && S.peers.rows) || []).filter((r) => r.available);
    if (rows.length < 2) return "";
    return section("Peer Comparison", "each listed peer's latest quarter, as filed with the exchange",
      row([[panel("PEERS · LATEST FILED QUARTER", tbl(["Company", "Quarter", `Revenue (${UNIT})`, "YoY", "Gross margin", "EBITDA margin", "Δ YoY", "Net profit YoY"], rows.map((r) => ({ attr: r.isSelf ? 'class="ws-self"' : "", cells: [`<b>${esc(r.name)}</b>`, esc(r.label), U(r.revenue), `<span class="${cls(r.revenueYoy)}">${sgn(r.revenueYoy)}</span>`, r.grossMargin != null ? `${n1(r.grossMargin)}%` : "—", r.ebitdaMargin != null ? `${n1(r.ebitdaMargin)}%` : "—", `<span class="${cls(r.ebitdaMarginYoyBps)}">${sgn(r.ebitdaMarginYoyBps, 0, " bps")}</span>`, `<span class="${cls(r.patYoy)}">${sgn(r.patYoy)}</span>`] }))), { icon: "users", sub: "consolidated results · NSE XBRL" }), 12]]));
  }

  // upcoming events
  function events() {
    const c = S.pack && S.pack.calendar, n = S.sum && S.sum.next, today = new Date().toISOString().slice(0, 10), ev = [];
    if (n && n.date && n.date.slice(0, 10) >= today) ev.push([n.date.slice(0, 10), `Quarterly results${n.isEstimate ? " (estimated)" : ""}`, "Results"]);
    if (c) { (c.upcoming || []).forEach((x) => ev.push([x.date, `${x.purpose} — board meeting`, "Board"])); (c.actions || []).filter((x) => (x.exDate || x.recordDate || "") >= today).forEach((x) => ev.push([x.exDate || x.recordDate, `${x.subject} — ex-date`, "Corporate action"])); }
    if (!ev.length) return "";
    return section("Upcoming Events", "", row([[panel("CALENDAR", tbl(["Date", "Event", "Type"], ev.sort((p, q) => p[0].localeCompare(q[0])).map((e) => [fd(e[0]), esc(e[1]), badge(e[2])])), { icon: "cal" }), 12]]));
  }

  function renderAnalysis() {
    const a = S.analysis; if (!a) return "";
    const aiNote = a.ai ? "" : S.ai && S.ai.status === "running" ? `<div class="ec-wait"><span class="rg-spin"></span>Reading the transcript for the environment, segments, costs, strategy and bull / bear case — these sections appear in a few seconds.</div>` : "";
    return aiNote + [performance(a), segments(a), guidance(a), costs(a), strategy(a), environment(a), qa(a), statements(a), tone(a), flags(a), thesis(a), highlights(a), peers(), events()].join("")
      + `<div class="ws-foot">Every item is taken from the transcript and cited to its page, or from the company's exchange filings. ${a.ai ? "Environment, segments, costs, strategy and the bull / bear case were read by AI from page-tagged extracts; numbers not found in the transcript were removed." : ""} Not investment advice.</div>`;
  }

  /* ═══════════════ PAINT ═══════════════ */
  function paint() {
    secN = 0;
    const root = $e("ecRoot"); if (!root) return;
    const y = window.scrollY;
    $e("ecHead").innerHTML = S.co ? header(S.co) : "";
    $e("ecPreview").innerHTML = preview();
    $e("ecInput").innerHTML = inputs();
    $e("ecOut").innerHTML = renderAnalysis();
    wire();
    K().drawCharts(root); K().wireTips(root);
    if (S.co && $e("ecPriceChart") && typeof mountPriceChart === "function") mountPriceChart({ containerId: "ecPriceChart", symbol: S.co.symbol, defaultRange: "1Y", compact: true, height: 230, liveRefresh: false });
    window.scrollTo(0, y);
  }
  function wire() {
    const drop = $e("ecDrop"), inp = $e("ecPdf");
    if (inp) inp.addEventListener("change", () => { if (inp.files && inp.files[0]) handlePdf(inp.files[0]); });
    if (drop) {
      ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("drag"); }));
      ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("drag"); }));
      drop.addEventListener("drop", (e) => { const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) handlePdf(f); });
    }
    const ta = $e("ecPaste");
    if (ta) ta.addEventListener("input", () => { S.text = ta.value.trim() || null; S.source = S.text ? "paste" : null; S.srcMeta = S.text ? { label: "Pasted text" } : null; status(S.text ? `Ready — pasted text · ${S.text.split(/\s+/).length.toLocaleString("en-IN")} words` : "Provide a transcript to begin."); });
  }
  const status = (html, kind) => { const s = $e("ecStatus"); if (s) s.innerHTML = kind ? `<span class="${kind}">${html}</span>` : html; };

  /* ═══════════════ ACTIONS ═══════════════ */
  async function loadCore(sym) {
    sym = String(sym || "").trim().toUpperCase();
    if (!sym) { $e("ecCoreStatus").innerHTML = `<span class="down">Enter a ticker.</span>`; return; }
    const tok = ++S.tok;
    Object.assign(S, { sym, co: null, sum: null, pack: null, peers: null, analysis: null, ai: null, filter: "all" });
    if (S.source === "nse") { S.text = null; S.source = null; S.srcMeta = null; }
    $e("ecCoreStatus").textContent = "loading…";
    const isIN = /\.(NS|BO)$/.test(sym);
    const [co, sum, pack] = await Promise.all([
      api(`/api/company/${encodeURIComponent(sym)}`).catch(() => null),
      api(`/api/earnings/summary/${encodeURIComponent(sym)}`).catch(() => null),
      isIN ? api(`/api/company/${encodeURIComponent(sym)}/pack`).catch(() => null) : null,
    ]);
    if (tok !== S.tok) return;
    if (!co || co.error) { $e("ecCoreStatus").innerHTML = `<span class="down">Could not load ${esc(sym)} — check the ticker (e.g. RELIANCE.NS).</span>`; return; }
    Object.assign(S, { co, sum: sum && sum.available !== false ? sum : null, pack: pack && !pack.error ? pack : null });
    setCcy(co.currency);
    $e("ecCoreStatus").innerHTML = `<span class="up">${esc(co.name)}</span> · ${esc(co.exchange || "")}`;
    paint();
    // peers' latest filed quarter arrives in the background; the section appears when it lands
    if (isIN) api(`/api/company/${encodeURIComponent(sym)}/peer-quarters`).then((p) => { if (tok === S.tok && p && p.rows) { S.peers = p; if (S.analysis) paint(); } }).catch(() => { });
  }
  async function handlePdf(file) {
    if (!/pdf$/i.test(file.name) && file.type !== "application/pdf") return status("Please choose a PDF file.", "down");
    status(`${esc(file.name)} — extracting…`);
    try {
      const d = await api("/api/earnings/extract-pdf", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pdf: _b64(await file.arrayBuffer()) }) });
      if (d.error || !d.text) throw new Error(d.error || "could not read text from this PDF");
      Object.assign(S, { text: d.text, source: "pdf", srcMeta: { label: `${file.name} · ${d.pages || "?"} pages` } });
      const n = $e("ecPdfName"); if (n) n.textContent = S.srcMeta.label;
      status(`Ready — PDF · ${d.words.toLocaleString("en-IN")} words · click Analyse`, "up");
    } catch (e) { status(`${esc(e.message)}. If it is a scanned PDF, paste the text instead.`, "down"); }
  }
  async function loadNseTranscript() {
    const sym = ($e("ecSym").value || (typeof CURRENT !== "undefined" && CURRENT && CURRENT.symbol) || "").trim().toUpperCase();
    if (!sym) return status("Enter an NSE ticker first (e.g. MARICO.NS).", "down");
    if (sym !== S.sym) await loadCore(sym);
    const btn = $e("ecNse"); if (btn) { btn.disabled = true; btn.textContent = "Fetching from NSE…"; }
    status("Locating the latest transcript filed with the exchange…");
    try {
      const d = await api(`/api/earnings/nse-transcript/${encodeURIComponent(sym)}`);
      if (d.error || !d.text) throw new Error(d.error || "no transcript text");
      Object.assign(S, { text: d.text, source: "nse", srcMeta: { label: `NSE filing · ${fd(d.date)} · ${d.pages || "?"} pages`, url: d.url, notice: d.notice || null } });
      await analyze();
    } catch (e) { status(esc(e.message), "down"); if (btn) { btn.disabled = false; btn.textContent = "⬇ Fetch latest transcript"; } }
  }
  async function analyze() {
    const ta = $e("ecPaste");
    if (!S.text && ta && ta.value.trim()) Object.assign(S, { text: ta.value.trim(), source: "paste", srcMeta: { label: "Pasted text" } });
    if (!S.text || S.text.length < 100) return status("Upload a PDF, paste the transcript or fetch it from NSE first.", "down");
    const sym = S.sym || ($e("ecSym").value || "").trim().toUpperCase() || undefined;
    status(`<span class="rg-spin"></span> Analysing — speakers, figures, guidance, Q&amp;A, tone…`);
    try {
      const d = await api("/api/earnings/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transcript: S.text, symbol: sym }) });
      if (d.error) throw new Error(d.error);
      Object.assign(S, { analysis: d.analysis, ai: d.ai || null, filter: "all" });
      if (!S.co) setCcy((d.summary && d.summary.currency) || d.analysis.meta.currency || "INR");
      paint();
      const first = document.querySelector("#ecPreview .ec-band") || document.querySelector("#ecOut .ec-band");
      if (first) first.scrollIntoView({ behavior: "smooth", block: "start" });
      pollAI();
    } catch (e) { status(esc(e.message), "down"); }
  }
  async function pollAI() {
    const ai = S.ai; if (!ai || ai.status !== "running" || !ai.key) return;
    const tok = S.tok, key = ai.key;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      if (tok !== S.tok || !S.ai || S.ai.key !== key) return;
      let s; try { s = await api(`/api/earnings/ai/${key}`); } catch { continue; }
      if (s.status === "running") continue;
      S.ai = { key, status: s.status };
      if (s.status === "done" && s.result) S.analysis.ai = s.result;
      paint(); return;
    }
  }
  async function downloadDocx() {
    if (!S.text) return status("Add a transcript first.", "down");
    const btns = [$e("ecDocx"), $e("ecDocxTop")].filter(Boolean);
    btns.forEach((b) => { b.disabled = true; b.dataset.t = b.textContent; b.textContent = "Building report…"; });
    try {
      const sym = S.sym || undefined;
      const res = await fetch("/api/earnings/report.docx", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transcript: S.text, symbol: sym }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || "HTTP " + res.status); }
      const blob = await res.blob(), url = URL.createObjectURL(blob), a = document.createElement("a");
      const cd = res.headers.get("content-disposition") || "", m = cd.match(/filename="([^"]+)"/);
      a.href = url; a.download = m ? m[1] : `${sym || "earnings"}_earnings_call_analysis.docx`;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
      status("DOCX report downloaded.", "up");
    } catch (e) { status(esc(e.message), "down"); }
    finally { btns.forEach((b) => { b.disabled = false; b.textContent = b.dataset.t || b.textContent; }); }
  }

  function init() {
    const load = () => loadCore($e("ecSym").value);
    $e("ecLoad").addEventListener("click", load);
    $e("ecSym").addEventListener("keydown", (e) => { if (e.key === "Enter") load(); });
    const root = $e("ecRoot");
    root.addEventListener("click", (e) => {
      if (e.target.closest("#ecAnalyze")) return analyze();
      if (e.target.closest("#ecDocx") || e.target.closest("#ecDocxTop")) return downloadDocx();
      if (e.target.closest("#ecNse")) return loadNseTranscript();
      if (e.target.closest("#ecOpenER") && S.co) { showTab("research"); if (typeof loadCompany === "function") loadCompany(S.co.symbol); return; }
      const ck = e.target.closest("[data-ck]");
      if (ck) { S.chartKey = ck.dataset.ck; document.querySelectorAll("#ecChartKeys .mc-tfb").forEach((b) => b.classList.toggle("on", b === ck)); const box = $e("ecTrend"); if (box) { box.innerHTML = trendChart(); K().drawCharts(box); } return; }
      const fb = e.target.closest("#ecQaFilter [data-f]");
      if (fb) { S.filter = fb.dataset.f; document.querySelectorAll("#ecQaFilter .mc-tfb").forEach((b) => b.classList.toggle("on", b === fb)); document.querySelectorAll(".ec-qa tr[data-theme]").forEach((tr) => { tr.hidden = S.filter !== "all" && tr.dataset.theme !== S.filter; }); }
    });
    let rt = null;
    window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (!$e("tab-earnings").hidden) K().drawCharts(root); }, 150); });
    paint();
    syncContext();
  }
  // a company opened elsewhere in the terminal is loaded here too
  function syncContext() {
    const cur = typeof CURRENT !== "undefined" && CURRENT && CURRENT.symbol;
    if (cur && cur !== S.sym && !S.analysis) { $e("ecSym").value = cur; loadCore(cur); }
  }

  return { init, syncContext, loadCore, loadNseTranscript, analyze, downloadDocx, loaded: false, get state() { return S; } };
})();
