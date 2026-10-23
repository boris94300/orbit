const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
const AG = [
  ["veille", "Veille marchés", "BCE · Eurostat · Yahoo Finance · Frankfurter"],
  ["historien", "Historien", "30 ans de marchés réels"],
  ["projection", "Projection", "Tes trajectoires jusqu'à la retraite"],
  ["logement", "Logement", "geo.api.gouv.fr · Géorisques · crédit"],
  ["conseil", "Conseil et conformité", "Propositions et contrôles"],
];
const KIND = { start: "Début", call: "Appel", data: "Réponse", calc: "Calcul", check: "Contrôle", result: "Résultat", error: "Secours" };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const hhmmss = (t) => { const d = new Date(t * 1000); return d.toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris" }) + "," + String(d.getMilliseconds()).padStart(3, "0"); };
let rid = null, since = 0, st = {}, running = false, started = false;

function pipe() {
  $("#a-pipe").innerHTML = AG.map(([id, n, r]) => `<li data-a="${id}" class="${st[id]?.s || ""}"><i></i><div><b>${n}</b><span>${r}</span></div><em>${st[id]?.ms ? (st[id].ms / 1000).toFixed(1) + " s" : ""}</em><small>${st[id]?.calls ? st[id].calls + " appel" + (st[id].calls > 1 ? "s" : "") : ""}</small></li>`).join("");
}
pipe();

async function start() {
  if (running) return;
  running = true; started = true; since = 0; st = {};
  $("#a-run").disabled = true; $("#a-run").textContent = "Analyse en cours…";
  $("#a-log").innerHTML = ""; $("#a-out").innerHTML = ""; pipe();
  const r = await fetch("/api/agents/live", { method: "POST" });
  if (r.status === 401) return (location.href = "/login");
  rid = (await r.json()).run;
  poll();
}
async function poll() {
  const r = await fetch(`/api/agents/live/${rid}?since=${since}`);
  const d = await r.json();
  d.events.forEach(add);
  since += d.events.length;
  if (d.done) return finish(d.summary);
  setTimeout(poll, 300);
}
function add(e) {
  const a = st[e.agent] || (st[e.agent] = { s: "run", t0: e.t, calls: 0 });
  AG.forEach(([id]) => { if (id !== e.agent && st[id]?.s === "run" && e.kind === "start") st[id].s = "done"; });
  a.s = e.kind === "error" ? "warn" : a.s === "warn" ? "warn" : "run";
  if (e.kind === "result") a.s = a.s === "warn" ? "warn done" : "done";
  if (e.kind === "call") a.calls++;
  a.ms = (e.t - a.t0) * 1000;
  pipe();
  const name = AG.find((x) => x[0] === e.agent)[1], dt = e.detail || {};
  let det = "";
  if (dt.url) det += `<code class="url">GET ${esc(dt.url)}</code>`;
  if (dt.excerpt) det += `<code>${esc(dt.excerpt)}${dt.excerpt.length >= 220 ? "…" : ""}</code>`;
  if (dt.formula) det += `<code class="f">${esc(dt.formula)}</code>`;
  if (dt.lines) det += dt.lines.map((l) => `<code>${esc(l)}</code>`).join("");
  const row = document.createElement("div");
  row.className = `ev k-${e.kind}${dt.ok === false ? " ko" : ""}`;
  row.innerHTML = `<time>${hhmmss(e.t)}</time><span class="ag">${name}</span><span class="kd">${KIND[e.kind]}</span><div class="tx">${esc(e.text)}${det ? `<div class="det">${det}</div>` : ""}</div>`;
  $("#a-log").appendChild(row);
  gsap.from(row, { opacity: 0, y: 6, duration: 0.3 });
  $("#a-log").scrollTo({ top: $("#a-log").scrollHeight, behavior: "smooth" });
}
function finish(s) {
  running = false;
  AG.forEach(([id]) => st[id] && st[id].s === "run" && (st[id].s = "done")); pipe();
  $("#a-run").disabled = false; $("#a-run").textContent = "Relancer l'analyse";
  const keur = (v) => Math.round(v / 1000).toLocaleString("fr-FR") + " k€";
  let h = `<div class="ao-t">Données du jour</div><dl class="ao-d">${s.data.map((d) => `<dt>${d.label}<small>${d.src}</small></dt><dd class="${d.chg > 0 ? "up" : d.chg < 0 ? "dn" : ""}">${d.value}</dd>`).join("")}</dl>`;
  if (s.projection) h += `<div class="ao-t">À ${s.projection.age} ans</div><div class="ao-p"><b>${keur(s.projection.mid)}</b><span>médiane · de ${keur(s.projection.bad)} à ${keur(s.projection.good)}</span></div>`;
  if (s.risks) h += `<div class="ao-t">Risques à ${s.risks.city}</div><div class="ao-r">${s.risks.list.map((r) => `<span>${r}</span>`).join("")}</div>`;
  h += `<div class="ao-t">Propositions à valider</div>` + (s.proposals.length ? s.proposals.map((p, i) => `<div class="ao-c" data-i="${i}"><b>${p.title}</b><p>${p.why}</p><div class="eff">${p.effect}</div><div class="btns"><button class="primary-sm" data-do="ok">Adopter</button><button data-do="no">Ignorer</button></div></div>`).join("") : `<p class="ao-none">Aucun ajustement nécessaire pour l'instant.</p>`);
  $("#a-out").innerHTML = h;
  $("#a-out").onclick = async (e) => {
    const b = e.target.closest("[data-do]"); if (!b) return;
    const card = b.closest(".ao-c"), p = s.proposals[+card.dataset.i];
    if (b.dataset.do === "ok") {
      await fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p.set) });
      dispatchEvent(new Event("orbit:profile"));
      card.querySelector(".btns").innerHTML = `<span class="ok">Adopté le ${new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" })} · profil mis à jour</span>`;
    } else card.querySelector(".btns").innerHTML = `<span class="no">Ignoré</span>`;
  };
  gsap.from("#a-out > *", { opacity: 0, y: 8, duration: 0.4, stagger: 0.05 });
}
$("#a-run").addEventListener("click", start);
addEventListener("orbit:view", (e) => { if (e.detail === "agents" && !started) start(); });
