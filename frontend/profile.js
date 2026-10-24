const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
let P = null, dirty = false;

const GROUPS = [
  ["Toi", [
    ["first_name", "Prénom", "text"], ["last_name", "Nom", "text"],
    ["birth_year", "Année de naissance", "number", "", { min: 1930, max: 2008 }], ["city", "Ville", "text"],
  ]],
  ["Revenus et épargne", [
    ["income_month", "Revenu net mensuel", "number", "€"], ["savings_month", "Épargne mise de côté chaque mois", "number", "€"],
    ["cash", "Épargne disponible (livrets, compte)", "number", "€"], ["invested", "Placements (PEA, assurance-vie, PER…)", "number", "€"],
    ["equity_share", "Part investie en actions", "range", "%", { min: 0, max: 100, step: 5 }], ["retire_age", "Âge de départ à la retraite", "number", "ans", { min: 50, max: 75 }],
  ]],
  ["Où tu investis", [
    ["broker", "Établissement et support", "select", "", { opts: [["banque", "Fonds de ma banque (agence)"], ["av_ligne", "Assurance-vie en ligne (ETF)"], ["fortuneo", "Fortuneo · Starter (ETF sur PEA)"], ["degiro", "DEGIRO · ETF sélection principale"], ["degiro_actions", "DEGIRO · actions Euronext Paris"]] }],
    ["tool", "Outil d'analyse payant", "select", "", { opts: [["aucun", "Aucun"], ["tv_essential", "TradingView Essential · 14,95 €/mois"], ["tv_plus", "TradingView Plus · 34,95 €/mois"], ["tv_premium", "TradingView Premium · 69,95 €/mois"]] }],
  ]],
  ["Logement", [
    ["housing", "Situation", "seg", "", { opts: [["locataire", "Locataire"], ["proprietaire", "Propriétaire"], ["heberge", "Hébergé"]] }],
    ["rent_month", "Loyer mensuel", "number", "€", { show: (p) => p.housing === "locataire" }],
    ["home_value", "Valeur estimée du bien", "number", "€", { show: (p) => p.housing === "proprietaire" }],
    ["loan_remaining", "Capital restant dû", "number", "€", { show: (p) => p.housing === "proprietaire" }],
    ["loan_payment", "Mensualité du crédit", "number", "€", { show: (p) => p.housing === "proprietaire" }],
  ]],
  ["Projet immobilier", [
    ["buy.enabled", "J'envisage d'acheter ma résidence principale", "toggle", "", { show: (p) => p.housing === "locataire" }],
    ["buy.in_years", "Dans", "number", "ans", { show: (p) => p.housing === "locataire" && p.buy.enabled }],
    ["buy.price", "Prix du bien", "number", "€", { show: (p) => p.housing === "locataire" && p.buy.enabled }],
    ["buy.down", "Apport", "number", "€", { show: (p) => p.housing === "locataire" && p.buy.enabled }],
    ["buy.rate", "Taux du crédit", "number", "%", { step: 0.05, show: (p) => p.housing === "locataire" && p.buy.enabled }],
    ["buy.years", "Durée du crédit", "number", "ans", { show: (p) => p.housing === "locataire" && p.buy.enabled }],
  ]],
];
const get = (k) => k.split(".").reduce((o, x) => o?.[x], P);
const set = (k, v) => { const ks = k.split("."); let o = P; ks.slice(0, -1).forEach((x) => (o = o[x])); o[ks.at(-1)] = v; };

function field([k, label, type, suf, o = {}]) {
  const v = get(k), id = "pf-" + k.replace(".", "-");
  let ctl;
  if (type === "seg") ctl = `<div class="p-seg" data-k="${k}">${o.opts.map(([val, t]) => `<button type="button" data-val="${val}" class="${v === val ? "on" : ""}">${t}</button>`).join("")}</div>`;
  else if (type === "select") ctl = `<div class="p-in"><select id="${id}" data-k="${k}">${o.opts.map(([val, t]) => `<option value="${val}" ${v === val ? "selected" : ""}>${t}</option>`).join("")}</select></div>`;
  else if (type === "toggle") ctl = `<button type="button" class="p-tog ${v ? "on" : ""}" data-k="${k}" aria-pressed="${!!v}"><i></i></button>`;
  else if (type === "range") ctl = `<div class="p-range"><input type="range" id="${id}" data-k="${k}" min="${o.min}" max="${o.max}" step="${o.step}" value="${v}"><output>${v} %</output></div>`;
  else ctl = `<div class="p-in"><input id="${id}" data-k="${k}" type="${type}" value="${v ?? ""}" ${o.min != null ? `min="${o.min}"` : ""} ${o.max != null ? `max="${o.max}"` : ""} step="${o.step || (type === "number" ? 1 : "")}">${suf ? `<span>${suf}</span>` : ""}</div>`;
  const hidden = o.show && !o.show(P);
  return `<div class="p-row${hidden ? " off" : ""}" data-row="${k}"><label for="${id}">${label}</label>${ctl}</div>`;
}
function render() {
  $("#p-form").innerHTML = GROUPS.map(([t, fs]) => `<div class="p-group"><div class="p-gt">${t}</div><div class="p-card">${fs.map(field).join("")}</div></div>`).join("");
}
function refreshVisibility() {
  GROUPS.forEach(([, fs]) => fs.forEach(([k, , , , o = {}]) => {
    const row = $(`[data-row="${k}"]`); if (!row || !o.show) return;
    const on = o.show(P);
    if (on === row.classList.contains("off")) { row.classList.toggle("off", !on); if (on) gsap.from(row, { opacity: 0, height: 0, duration: 0.3 }); }
  }));
}
function touch() {
  dirty = true;
  $("#p-save").classList.add("show");
  $("#p-status").textContent = "Modifications non enregistrées";
  refreshVisibility();
}
$("#p-form").addEventListener("input", (e) => {
  const k = e.target.dataset.k; if (!k) return;
  const v = e.target.type === "text" || e.target.tagName === "SELECT" ? e.target.value : e.target.value === "" ? 0 : +e.target.value;
  set(k, v);
  if (e.target.type === "range") e.target.nextElementSibling.textContent = v + " %";
  touch();
});
$("#p-form").addEventListener("click", (e) => {
  const sb = e.target.closest(".p-seg button");
  if (sb) { set(sb.parentNode.dataset.k, sb.dataset.val); sb.parentNode.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === sb)); touch(); }
  const tg = e.target.closest(".p-tog");
  if (tg) { const v = !get(tg.dataset.k); set(tg.dataset.k, v); tg.classList.toggle("on", v); tg.setAttribute("aria-pressed", v); touch(); }
});
$("#p-btn").addEventListener("click", async () => {
  $("#p-btn").disabled = true;
  const r = await fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(P) });
  $("#p-btn").disabled = false;
  if (r.status === 401) return (location.href = "/login");
  P = await r.json(); dirty = false; render();
  $("#p-status").textContent = "Enregistré. Tes projections sont à jour.";
  setTimeout(() => !dirty && $("#p-save").classList.remove("show"), 1800);
  dispatchEvent(new Event("orbit:profile"));
});

/* ---------- sécurité ---------- */
async function security() {
  const u = await (await fetch("/api/me")).json();
  $("#sec-body").innerHTML = u.totp_on
    ? `<div class="p-row"><label>Double authentification</label><div class="sec-ok">Activée</div></div>
       <div class="p-row"><label>Pour la désactiver, saisis un code</label><div class="p-in sm"><input id="sec-code" inputmode="numeric" maxlength="6" placeholder="000000"></div></div>
       <div class="p-row"><label>Sessions ouvertes</label><button type="button" class="link" id="sec-all">Déconnecter tous les appareils</button></div>`
    : `<div class="p-row"><label>Double authentification<small>Un code à 6 chiffres te sera demandé à chaque connexion, depuis Google Authenticator, Authy ou l'app Mots de passe d'iOS.</small></label><button type="button" class="primary-sm" id="sec-on">Activer</button></div>
       <div class="p-row"><label>Sessions ouvertes</label><button type="button" class="link" id="sec-all">Déconnecter tous les appareils</button></div>
       <div class="sec-setup" id="sec-setup"></div>`;
  $("#sec-all").onclick = () => fetch("/api/security/logout-all", { method: "POST" }).then(() => (location.href = "/login"));
  if (u.totp_on) {
    $("#sec-code").oninput = async (e) => {
      if (e.target.value.replace(/\D/g, "").length !== 6) return;
      const r = await fetch("/api/security/totp/disable", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: e.target.value }) });
      if (r.ok) security(); else { e.target.value = ""; e.target.placeholder = "Code incorrect"; }
    };
    return;
  }
  $("#sec-on").onclick = async () => {
    const s = await (await fetch("/api/security/totp/setup", { method: "POST" })).json();
    $("#sec-setup").innerHTML = `<div class="qr">${s.svg}</div><div class="qr-t"><b>1.</b> Scanne ce QR code avec ton application d'authentification.<br>
      <span class="key">Ou saisis la clé : ${s.secret.match(/.{1,4}/g).join(" ")}</span><br><b>2.</b> Entre le code affiché pour confirmer.
      <div class="p-in sm"><input id="sec-new" inputmode="numeric" maxlength="6" placeholder="000000" autocomplete="one-time-code"></div><div class="sec-err" id="sec-err"></div></div>`;
    gsap.from("#sec-setup", { opacity: 0, y: 8, duration: 0.4 });
    $("#sec-new").focus();
    $("#sec-new").oninput = async (e) => {
      if (e.target.value.replace(/\D/g, "").length !== 6) return;
      const r = await fetch("/api/security/totp/enable", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: e.target.value }) });
      if (r.ok) security(); else { e.target.value = ""; $("#sec-err").textContent = (await r.json()).error; }
    };
  };
}
async function init() {
  const r = await fetch("/api/profile");
  if (r.status === 401) return;
  P = await r.json(); render(); security();
}
addEventListener("orbit:view", (e) => { if (e.detail === "profil" && !dirty) init(); });
addEventListener("beforeunload", (e) => { if (dirty) e.preventDefault(); });
init();
