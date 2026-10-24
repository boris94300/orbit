const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const eur = (v) => Math.round(v).toLocaleString("fr-FR") + " €";
const keur = (v) => (Math.abs(v) >= 1e6 ? (v / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 2 }) + " M€" : Math.round(v / 1000).toLocaleString("fr-FR") + " k€");
const J = { "Content-Type": "application/json" };
const COL = { Logement: "#8ab4ff", Courses: "#7fd1a8", Abonnements: "#ff9f6b", Transports: "#c9a7ff", Restaurants: "#ffd479", Santé: "#7fe0e0", Loisirs: "#f5a3c7", Shopping: "#a1a1a6", Autres: "#6e6e73" };
let R = null, cut = new Set(), shown = false;
const root = $("#mo");
addEventListener("orbit:view", (e) => { if (e.detail === "mois" && !shown) { shown = true; empty(); } });
function count(el, to, f) { const o = { v: 0 }; gsap.to(o, { v: to, duration: 0.9, ease: "power2.out", onUpdate: () => (el.textContent = f(o.v)) }); }

function empty(err) {
  root.innerHTML = `<div class="mo-head"><h2>Mon mois</h2><p>Importe un relevé de compte : Orbit classe tes dépenses, repère tes abonnements et calcule ce que tu peux vraiment mettre de côté.</p></div>
    <label class="mo-drop" id="mo-drop"><input type="file" accept=".csv,text/csv" id="mo-file" hidden>
      <div class="mo-ic"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3"/></svg></div>
      <b>Dépose ton relevé ici</b><span>Fichier CSV exporté depuis ton espace bancaire (date, libellé, montant)</span></label>
    <button class="ghost-sm mo-demo" id="mo-demo">Essayer avec un relevé d'exemple</button>
    ${err ? `<p class="mo-err">${err}</p>` : ""}
    <p class="av-note">Le fichier est lu puis oublié : aucune opération n'est enregistrée. Seul un résumé est partagé avec ton conseiller, et seulement si tu le décides.</p>`;
  gsap.fromTo(root.children, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.45, stagger: 0.06 });
  const drop = $("#mo-drop");
  ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("hot"); }));
  ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, () => drop.classList.remove("hot")));
  drop.addEventListener("drop", (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) f.text().then(send); });
  $("#mo-file").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) f.text().then(send); });
  $("#mo-demo").onclick = async () => send(await (await fetch("/static/demo/releve-exemple.csv")).text());
}

async function send(csv) {
  root.classList.add("busy");
  const r = await fetch("/api/budget", { method: "POST", headers: J, body: JSON.stringify({ csv }) });
  root.classList.remove("busy");
  const d = await r.json();
  if (!r.ok) return empty(d.error || "Fichier illisible.");
  R = d; cut = new Set(); result();
}

function result() {
  const d = R, cap = Math.max(0, d.capacity), target = Math.floor(cap / 50) * 50;
  root.innerHTML = `<div class="mo-head"><h2>Mon mois</h2><p>Moyenne sur ${d.months.length} mois (${d.n} opérations). <button class="link" id="mo-again">Importer un autre relevé</button></p></div>
    <div class="mo-kpi"><div><span>Revenus</span><b id="k-in">—</b></div><div><span>Dépenses</span><b id="k-out">—</b></div><div class="hl"><span>Ce que tu peux mettre de côté</span><b id="k-cap">—</b></div></div>
    <div class="mo-gap">${cap > d.declared + 25 ? `Dans ton profil, tu indiques <b>${eur(d.declared)}</b> d'épargne par mois. Ton relevé montre que tu peux mettre de côté jusqu'à <b>${eur(cap)}</b>.
      <div class="mo-act"><button class="primary-sm" id="mo-use">Utiliser ${eur(target)} / mois dans mes projections</button><span>soit <b class="up">+${keur((target - d.declared) * d.per_eur)}</b> à ${d.retire_age} ans</span></div>`
      : cap < d.declared - 25 ? `Attention : ton profil prévoit <b>${eur(d.declared)}</b> d'épargne par mois, mais ton relevé ne laisse que <b>${eur(cap)}</b>. Tes projections sont sans doute trop optimistes.
      <div class="mo-act"><button class="primary-sm" id="mo-use">Corriger à ${eur(target)} / mois</button></div>` : `Ton épargne déclarée (${eur(d.declared)} par mois) correspond à ton relevé.`}</div>
    <div class="mo-grid">
      <div><div class="av-h">Où part ton argent</div><div class="mo-cats">${d.cats.map((c) => `<div class="mo-cat"><span>${c.name}</span><div class="mo-bar"><i style="width:${c.share * 100}%;background:${COL[c.name] || "#a1a1a6"}"></i></div><b>${eur(c.amount)}</b></div>`).join("")}</div>
        ${d.fixed.length ? `<div class="av-h" style="margin-top:26px">Charges fixes</div><div class="mo-fixed">${d.fixed.map((f) => `<span>${f.name}<b>${eur(f.amount)}</b></span>`).join("")}</div>` : ""}</div>
      <div><div class="av-h">Tes abonnements · ${eur(d.subs_total)} par mois, ${eur(d.subs_total * 12)} par an</div>
        <div class="mo-subs">${d.subs.map((s, i) => `<button class="mo-sub" data-i="${i}"><span>${s.name}<small>${s.cat} · ${s.months} mois de suite</small></span><b>${eur(s.amount)}</b><em>Je garde</em></button>`).join("") || `<p class="av-note">Aucun abonnement récurrent repéré.</p>`}</div>
        <div class="mo-save" id="mo-save"></div></div>
    </div>
    <div class="av-cta"><button class="ghost-sm" id="mo-share">Partager ce résumé avec mon conseiller</button><span id="mo-shared">Seuls les totaux sont transmis, jamais le détail des opérations.</span></div>`;
  gsap.fromTo(root.children, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.45, stagger: 0.05 });
  count($("#k-in"), d.income, eur); count($("#k-out"), d.spend, eur); count($("#k-cap"), d.capacity, eur);
  gsap.from(".mo-bar i", { width: 0, duration: 0.8, stagger: 0.05, ease: "power3.out", delay: 0.2 });
  saveLine();
}
function saveLine() {
  const m = [...cut].reduce((a, i) => a + R.subs[i].amount, 0);
  $("#mo-save").innerHTML = m ? `En résiliant ces abonnements : <b class="up">+${eur(m)} / mois</b>, soit <b class="up">+${keur(m * R.per_eur)}</b> de patrimoine à ${R.retire_age} ans si tu places cette somme.` : "Touche un abonnement pour simuler sa résiliation.";
}
root.addEventListener("click", async (e) => {
  const s = e.target.closest(".mo-sub");
  if (s) { const i = +s.dataset.i; cut.has(i) ? cut.delete(i) : cut.add(i); s.classList.toggle("cut", cut.has(i)); s.querySelector("em").textContent = cut.has(i) ? "Je résilie" : "Je garde"; gsap.fromTo(s, { scale: 0.98 }, { scale: 1, duration: 0.3 }); return saveLine(); }
  if (e.target.id === "mo-again") { shown = true; return empty(); }
  if (e.target.id === "mo-use") {
    const v = Math.floor(Math.max(0, R.capacity) / 50) * 50; e.target.disabled = true;
    const r = await fetch("/api/profile", { method: "PUT", headers: J, body: JSON.stringify({ savings_month: v }) });
    if (r.ok) { e.target.textContent = `Enregistré : ${eur(v)} / mois`; R.declared = v; dispatchEvent(new Event("orbit:profile")); }
  }
  if (e.target.id === "mo-share") {
    const b = { income: R.income, spend: R.spend, capacity: R.capacity, subs_total: R.subs_total, months: R.months.length };
    const r = await fetch("/api/profile", { method: "PUT", headers: J, body: JSON.stringify({ budget: b }) });
    if (r.ok) { $("#mo-shared").textContent = "Résumé partagé : ton conseiller le voit dans ta fiche."; e.target.disabled = true; }
  }
});
