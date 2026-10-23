const $ = (s) => document.querySelector(s);
const AG = [
  ["vigie", "Vigie", "Surveille l'actualité et traduit en euros ce qui te touche"],
  ["analyste", "Analyste", "Rejoue 30 ans de marchés réels sur ta vie"],
  ["stratege", "Stratège", "Teste des combinaisons pour atteindre ton objectif"],
  ["gardien", "Gardien", "Bloque ce qui est risqué ou intenable pour toi"],
  ["conseiller", "Conseiller IA", "T'explique tout en clair et répond à tes questions"],
];
const NAME = Object.fromEntries(AG.map(([id, n]) => [id, n]));
const KIND = { start: "Mission", call: "Appel", data: "Réponse", calc: "Calcul", check: "Contrôle", result: "Résultat", error: "Secours", handoff: "Message", try: "Essai" };
const TECH = new Set(["call", "data", "calc", "error"]);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const nf = (v, d = 0) => Number(v).toLocaleString("fr-FR", { maximumFractionDigits: d, minimumFractionDigits: d });
const keur = (v) => (v >= 0 ? "+" : "−") + (Math.abs(v) >= 10000 ? nf(Math.abs(v) / 1000) + " k€" : nf(Math.abs(v)) + " €");
const hms = (t) => new Date(t * 1000).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris" });
let rid = null, since = 0, st = {}, running = false, started = false, last = {}, chat = [];

const POS = AG.map((_, i) => { const a = (-90 + i * 72) * Math.PI / 180; return [150 + 112 * Math.cos(a), 150 + 112 * Math.sin(a)]; });
function sky() {
  $("#a-sky").innerHTML = `<circle cx="150" cy="150" r="112" class="ring"/><circle cx="150" cy="150" r="70" class="ring r2"/>
    <circle cx="150" cy="150" r="34" class="me"/><text x="150" y="155" class="me-t" id="a-me">Toi</text>
    ${AG.map(([id, n], i) => `<g class="sat" id="s-${id}" transform="translate(${POS[i][0]},${POS[i][1]})"><circle r="17" class="halo"/><circle r="9" class="core"/><text y="32">${n}</text></g>`).join("")}
    <circle r="4" class="msg" id="a-dot" cx="-20" cy="-20"/>`;
}
function team() {
  $("#a-team").innerHTML = AG.map(([id, n, m]) => `<li class="${st[id]?.s || ""}"><b>${n}</b><span>${m}</span>${last[id] ? `<small>${esc(last[id])}</small>` : ""}</li>`).join("");
  AG.forEach(([id]) => { const g = $("#s-" + id); g && g.setAttribute("class", "sat " + (st[id]?.s || "")); });
}
function fly(from, to, text) {
  const a = POS[AG.findIndex((x) => x[0] === from)], b = POS[AG.findIndex((x) => x[0] === to)];
  $("#a-say").innerHTML = `<b>${NAME[from]} → ${NAME[to]}</b> « ${esc(text)} »`;
  gsap.fromTo("#a-say", { opacity: 0, y: 4 }, { opacity: 1, y: 0, duration: 0.3 });
  if (!a || !b) return;
  gsap.fromTo("#a-dot", { attr: { cx: a[0], cy: a[1] }, opacity: 1 }, { attr: { cx: b[0], cy: b[1] }, duration: 0.9, ease: "power2.inOut", onComplete: () => gsap.to("#a-dot", { opacity: 0, duration: 0.3 }) });
}

async function impact() {
  const r = await fetch("/api/profile"); if (!r.ok) return;
  const p = await r.json(), j = (p.journal || []), ok = j.filter((e) => e.ok), sum = ok.reduce((a, e) => a + (e.gain || 0), 0);
  $("#a-me").textContent = p.first_name || "Toi";
  $("#a-impact").innerHTML = j.length ? `<b class="${sum >= 0 ? "up" : "dn"}">${keur(sum)}</b><span>gagnés grâce à tes agents · ${ok.length} acceptée${ok.length > 1 ? "s" : ""}, ${j.length - ok.length} refusée${j.length - ok.length > 1 ? "s" : ""}</span>`
    : `<b>0 €</b><span>Compteur d'impact : accepte une solution pour le voir monter</span>`;
}

async function start() {
  if (running) return;
  running = started = true; since = 0; st = {}; last = {};
  $("#a-run").disabled = true; $("#a-run").textContent = "Analyse en cours…";
  $("#a-log").innerHTML = ""; $("#a-out").innerHTML = ""; team();
  const r = await fetch("/api/agents/live", { method: "POST" });
  if (r.status === 401) return (location.href = "/login");
  rid = (await r.json()).run; poll();
}
async function poll() {
  const r = await fetch(`/api/agents/live/${rid}?since=${since}`);
  if (!r.ok) { running = false; $("#a-run").disabled = false; $("#a-run").textContent = "Relancer l'analyse"; return; }
  const d = await r.json();
  d.events.forEach(add); since += d.events.length;
  d.done ? finish(d.summary) : setTimeout(poll, 350);
}
function add(e) {
  const a = e.agent, x = e.detail || {};
  AG.forEach(([id]) => { if (id !== a && st[id]?.s === "run") st[id].s = "done"; });
  st[a] = { s: e.kind === "error" && a === "conseiller" && /interrompue/.test(e.text) ? "warn" : "run" };
  if (["result", "start"].includes(e.kind)) last[a] = e.text;
  team();
  if (e.kind === "handoff") fly(a, x.to, e.text);
  let more = "";
  if (x.url) more += `<code>${esc(x.url)}</code>`;
  if (x.excerpt) more += `<pre>${esc(x.excerpt)}</pre>`;
  if (x.formula) more += `<div class="fm">${esc(x.formula)}</div>`;
  if (x.lines) more += x.lines.map((l) => `<div class="ln">${esc(l)}</div>`).join("");
  const cls = `ev k-${e.kind} ${TECH.has(e.kind) ? "tech" : ""} ${x.ok === false ? "ko" : x.ok === true ? "okk" : ""}`;
  const who = e.kind === "handoff" ? `${NAME[a]} → ${NAME[x.to]}` : NAME[a];
  const el = document.createElement("div"); el.className = cls;
  el.innerHTML = `<time>${hms(e.t)}</time><span class="ag">${who}</span><span class="kd">${KIND[e.kind] || e.kind}</span><div class="tx">${esc(e.text)}${more}</div>`;
  const log = $("#a-log"); log.append(el); log.scrollTop = log.scrollHeight;
}
function finish(s) {
  running = false;
  AG.forEach(([id]) => st[id]?.s === "run" && (st[id].s = "done")); team();
  $("#a-run").disabled = false; $("#a-run").textContent = "Relancer l'analyse";
  $("#a-say").innerHTML = `<b>Analyse terminée.</b> Rien n'est appliqué sans ta validation.`;
  const pr = s.projection || {};
  let h = `<div class="ao-t">Vigie · ce qui te concerne aujourd'hui</div>` + (s.alerts || []).map((a) => `<div class="al"><b>${esc(a.title)}</b><p>${esc(a.text)}</p>${a.effect != null ? `<em class="${a.effect >= 0 ? "up" : "dn"}">≈ ${keur(a.effect)} à ${pr.age} ans</em>` : ""}<small>${esc(a.src)}</small></div>`).join("");
  if (pr.goal) h += `<div class="ao-t">Analyste · ton objectif de ${nf(pr.goal)} €/mois</div><div class="gl"><div class="gl-b"><i style="width:${Math.round(pr.prob * 100)}%"></i><u style="left:${Math.round((s.target || 0.75) * 100)}%"></u></div><span><b>${Math.round(pr.prob * 100)} %</b> de chances aujourd'hui · cible ${Math.round((s.target || 0.75) * 100)} %</span></div>`;
  const V = { ok: ["Validée par le Gardien", "v-ok"], warn: ["Validée avec réserve", "v-warn"], block: ["Bloquée par le Gardien", "v-block"] };
  if ((s.options || []).length) h += `<div class="ao-t">Stratège + Gardien · solutions proposées</div>` + s.options.map((o, i) => `<div class="ao-c op ${V[o.verdict][1]}" data-i="${i}">
      <div class="op-h"><b>${esc(o.title)}</b><span class="vb">${V[o.verdict][0]}</span></div>
      <div class="op-n"><span><b>${Math.round(o.prob * 100)} %</b> de chances</span><span><b class="${o.gain >= 0 ? "up" : "dn"}">${keur(o.gain)}</b> de patrimoine médian</span></div>
      <p>${o.why.map(esc).join("<br>")}</p>
      <div class="btns">${o.verdict === "block" ? `<span class="no">Non proposée</span>` : `<button class="primary-sm" data-do="ok">Accepter</button><button data-do="no">Refuser</button>`}</div></div>`).join("");
  if (s.note) h += `<div class="ao-t">Conseiller · en résumé</div><div class="nt">${esc(s.note)}<small>${s.mode === "Mistral" ? "Rédigé par Mistral · chiffres vérifiés un par un" : "Rédigé par règles (IA non configurée)"}</small></div>`;
  $("#a-out").innerHTML = h;
  $("#a-out").onclick = async (e) => {
    const b = e.target.closest("[data-do]"); if (!b) return;
    const card = b.closest(".ao-c"), o = s.options[+card.dataset.i], ok = b.dataset.do === "ok";
    card.querySelector(".btns").innerHTML = `<span>…</span>`;
    const r = await fetch("/api/agents/decide", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: o.title, set: o.set, ok }) });
    const d = await r.json();
    card.querySelector(".btns").innerHTML = ok ? `<span class="ok">Acceptée · ${keur(d.entry.gain)} ajoutés au compteur · profil mis à jour</span>` : `<span class="no">Refusée</span>`;
    if (ok) { card.parentNode.querySelectorAll(".op .btns button").forEach((x) => x.closest(".btns").innerHTML = `<span class="no">Relance l'analyse pour de nouvelles solutions</span>`); dispatchEvent(new Event("orbit:profile")); }
    impact();
    gsap.fromTo("#a-impact b", { scale: 1.25 }, { scale: 1, duration: 0.6, ease: "back.out(3)" });
  };
  gsap.from("#a-out > *", { opacity: 0, y: 8, duration: 0.4, stagger: 0.05 });
}

const SUGG = ["Puis-je acheter un appartement à 300 000 € dans 2 ans ?", "Et si je partais à la retraite à 62 ans ?", "Combien épargner pour avoir 2 000 € par mois ?"];
$("#a-sugg").innerHTML = SUGG.map((q) => `<button type="button">${q}</button>`).join("");
$("#a-sugg").onclick = (e) => { const b = e.target.closest("button"); if (b) { $("#a-q").value = b.textContent; $("#a-chat").requestSubmit(); } };
const ARG = { epargne_mois: (v) => `épargne ${nf(v)} €/mois`, part_actions: (v) => `${nf(v)} % actions`, age_retraite: (v) => `retraite à ${nf(v)} ans`, achat_prix: (v) => `achat ${nf(v)} €`, achat_dans_ans: (v) => `dans ${nf(v)} ans`, achat_apport: (v) => `apport ${nf(v)} €` };
$("#a-chat").onsubmit = async (e) => {
  e.preventDefault();
  const q = $("#a-q").value.trim(); if (!q) return;
  $("#a-q").value = ""; $("#a-sugg").style.display = "none";
  const box = $("#a-msgs");
  box.insertAdjacentHTML("beforeend", `<div class="m-u">${esc(q)}</div><div class="m-a wait">Le Conseiller interroge le moteur de calcul…</div>`);
  box.scrollTop = box.scrollHeight;
  const r = await fetch("/api/advisor/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q, history: chat }) });
  const el = box.lastElementChild; el.classList.remove("wait");
  if (!r.ok) { el.textContent = (await r.json().catch(() => ({}))).detail || "Conseiller indisponible."; return; }
  const d = await r.json();
  chat.push({ role: "user", content: q }, { role: "assistant", content: d.answer });
  const tr = d.trace.map((t) => `<span>simuler(${Object.entries(t.args).map(([k, v]) => (ARG[k] || ((x) => k + " " + x))(v)).join(", ") || "profil actuel"}) → ${t.result.chances_objectif_pct} % · ${nf(t.result.revenu_median_retraite_eur_mois)} €/mois${t.result.taux_endettement_pct != null ? ` · endettement ${t.result.taux_endettement_pct} %` : ""} · ${t.result.controle}</span>`).join("");
  el.innerHTML = `${tr ? `<div class="m-tr">${tr}</div>` : ""}${esc(d.answer)}<small>Mistral · ${nf(d.ms / 1000, 1)} s · ${d.trace.length} calcul${d.trace.length > 1 ? "s" : ""} du moteur · ${d.checked ? "chiffres vérifiés" : "à vérifier : un chiffre ne vient pas du moteur"}</small>`;
  box.scrollTop = box.scrollHeight;
};
$("#a-tech").onchange = (e) => $("#a-log").classList.toggle("simple", !e.target.checked);
$("#a-run").addEventListener("click", start);
addEventListener("orbit:view", (e) => { if (e.detail === "agents") { impact(); if (!started) start(); } });
fetch("/api/llm").then((r) => r.ok ? r.json() : null).then((d) => { $("#a-mode").textContent = d && d.mode === "Mistral" ? "· Mistral" : "· IA non configurée"; }).catch(() => {});
sky(); team(); impact();
