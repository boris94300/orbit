const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const eur = (v) => Math.round(v).toLocaleString("fr-FR") + " €";
const keur = (v) => (Math.abs(v) >= 1e6 ? (v / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 2 }) + " M€" : Math.round(v / 1000).toLocaleString("fr-FR") + " k€");
const pct = (v) => Math.round(v * 100) + " %";
const J = { "Content-Type": "application/json" };
let P = null, sec = "retraite", loaded = false, timer, seq = 0;
const st = { retraite: { start: 22, growth: 1, retire: null, bumpOn: false, bump: 200, every: 3 }, trans: { children: null, age: 85, av: 0, donation: 0 }, projects: null, dirty: false, presets: null };

addEventListener("orbit:view", (e) => { if (e.detail === "avenir") open(); });
addEventListener("orbit:profile", async () => { if (!loaded) return; P = await (await fetch("/api/profile")).json(); st.projects = null; st.dirty = false; st.retraite.retire = null; if ($("#v-avenir").classList.contains("on")) render(); });
async function open() { if (!loaded) { P = await (await fetch("/api/profile")).json(); loaded = true; } render(); }
$("#av-list").addEventListener("click", (e) => {
  const b = e.target.closest("[data-a]"); if (!b) return;
  $$("#av-list [data-a]").forEach((x) => x.classList.toggle("on", x === b));
  sec = b.dataset.a; render();
});
function render() { const m = $("#av-main"); seq++; ({ retraite, projets, transmettre })[sec](m); }
const slider = (k, label, min, max, step, val, f) => `<label class="cp"><span>${label}</span><b data-o="${k}">${f(val)}</b><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${val}"></label>`;
function count(el, to, f) { const o = { v: +el.dataset.v || 0 }; el.dataset.v = to; gsap.to(o, { v: to, duration: 0.8, ease: "power2.out", onUpdate: () => (el.textContent = f(o.v)) }); }
const enter = (m) => gsap.fromTo(m.children, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.45, stagger: 0.04, ease: "power2.out" });
async function saveProfile(patch) {
  const r = await fetch("/api/profile", { method: "PUT", headers: J, body: JSON.stringify(patch) });
  if (r.ok) { P = await r.json(); dispatchEvent(new Event("orbit:profile")); }
}

/* ---------- Ma retraite réelle ---------- */
function retraite(m) {
  const s = st.retraite; if (s.retire == null) s.retire = P.retire_age;
  const F = { start: (v) => v + " ans", growth: (v) => (+v).toLocaleString("fr-FR") + " % / an", retire: (v) => v + " ans", bump: (v) => "+" + eur(v), every: (v) => `${v} an${v > 1 ? "s" : ""}` };
  m.innerHTML = `<div class="c-top"><div><h2>Ma retraite réelle</h2><p>Ce que la retraite de l'État te versera, calculé avec les règles officielles, et ce que ton épargne y ajoute.</p></div></div>
    <div class="c-params">${slider("start", "Début de carrière", 16, 30, 1, s.start, F.start)}${slider("growth", "Hausse de salaire", 0, 3, 0.5, s.growth, F.growth)}${slider("retire", "Départ à", 62, 70, 1, s.retire, F.retire)}
      <button class="av-tg${s.bumpOn ? " on" : ""}" id="r-bump" type="button"><i></i>Augmentation ponctuelle</button></div>
    <div class="c-params av-bump${s.bumpOn ? " on" : ""}" id="r-bumps">${slider("bump", "Hausse nette / mois", 50, 1000, 50, s.bump, F.bump)}${slider("every", "Tous les", 1, 10, 1, s.every, F.every)}<p class="av-bump-t" id="r-bump-t"></p></div>
    <div class="av-hero"><div class="av-big" id="r-total">—</div><div class="cc-s" id="r-sub"></div><div class="av-stack" id="r-stack"></div><div class="av-leg" id="r-leg"></div></div>
    <p class="av-say" id="r-say"></p>
    <div class="av-h">Ta pension de l'État selon l'âge de départ</div>
    <div class="av-bars" id="r-bars"></div>
    <div class="av-facts" id="r-facts"></div>
    <div class="av-cta" id="r-cta"></div>
    <p class="av-note" id="r-note"></p>`;
  enter(m);
  const set = (k, v) => { s[k] = v; $(`[data-k="${k}"]`, m).value = v; $(`[data-o="${k}"]`, m).textContent = F[k](v); };
  $$(".c-params", m).forEach((el) => el.addEventListener("input", (e) => { const k = e.target.dataset.k; if (!k) return; set(k, +e.target.value); clearTimeout(timer); timer = setTimeout(go, 160); }));
  $("#r-bump", m).addEventListener("click", () => {
    s.bumpOn = !s.bumpOn; $("#r-bump", m).classList.toggle("on", s.bumpOn); $("#r-bumps", m).classList.toggle("on", s.bumpOn);
    if (s.bumpOn) gsap.fromTo("#r-bumps", { opacity: 0, y: -6 }, { opacity: 1, y: 0, duration: 0.35, ease: "power2.out" });
    go();
  });
  $("#r-bars", m).addEventListener("click", (e) => { const b = e.target.closest("[data-age]"); if (b) { set("retire", +b.dataset.age); go(); } });
  $("#r-cta", m).addEventListener("click", (e) => { if (e.target.closest("button")) saveProfile({ retire_age: s.retire }); });
  const go = async () => {
    const my = ++seq;
    const d = await (await fetch(`/api/pension?start=${s.start}&growth=${s.growth}&retire=${s.retire}` + (s.bumpOn ? `&bump=${s.bump}&every=${s.every}` : ""))).json();
    if (my !== seq) return;
    const c = d.cur, tot = c.total + d.savings_income;
    count($("#r-total"), tot, (v) => eur(v) + " / mois");
    $("#r-sub").textContent = `nets par mois, en euros d'aujourd'hui, si tu pars à ${c.age} ans`;
    const parts = [["Retraite de base (État)", c.base, "#f5f5f7"], ["Complémentaire Agirc-Arrco", c.compl, "#8ab4ff"], ["Ton épargne", d.savings_income, "#7fd1a8"]];
    $("#r-stack").innerHTML = parts.map(([, v, col]) => `<i style="background:${col};flex:${Math.max(0.001, v)}"></i>`).join("");
    gsap.fromTo("#r-stack i", { scaleX: 0 }, { scaleX: 1, transformOrigin: "left", duration: 0.7, stagger: 0.08, ease: "power3.out" });
    $("#r-leg").innerHTML = parts.map(([l, v, col]) => `<span><i style="background:${col}"></i>${l}<b>${eur(v)}</b></span>`).join("");
    $("#r-say").innerHTML = `Avec la seule retraite de l'État, tu toucherais <b>${pct(d.replacement)}</b> de ton dernier salaire (${eur(d.last_net)} nets). Avec ton épargne, tu montes à <b>${pct(tot / Math.max(1, d.last_net))}</b>.` +
      (d.n_bumps ? ` Tes ${d.n_bumps} augmentations ponctuelles ajoutent <b class="up">+${eur(d.bump_salary)}</b> à ton dernier salaire et <b class="up">+${eur(d.bump_gain)}</b> à ta pension.` : "") +
      (c.allowed ? "" : ` <span class="dn">Avant ${d.legal} ans, partir n'est possible qu'avec une carrière longue (travail commencé avant 21 ans).</span>`);
    const mx = Math.max(...d.ages.map((a) => a.total));
    $("#r-bars").innerHTML = d.ages.map((a) => `<button data-age="${a.age}" class="${a.age === c.age ? "on" : ""}${a.allowed ? "" : " off"}"><em>${keur(a.total * 1000 / 1000).replace(" k€", "")}${a.total >= 1000 ? " k€" : ""}</em><i style="height:${(a.total / mx) * 100}%"></i><span>${a.age}</span></button>`).join("");
    $$("#r-bars em").forEach((el, i) => (el.textContent = eur(d.ages[i].total)));
    gsap.fromTo("#r-bars i", { scaleY: 0 }, { scaleY: 1, transformOrigin: "bottom", duration: 0.6, stagger: 0.03, ease: "power3.out" });
    $("#r-facts").innerHTML = [["Trimestres validés", `${c.trims} / ${d.required}`],
      [c.missing ? "Décote" : c.surcote ? "Surcote" : "Taux plein", c.missing ? `${c.missing} trimestres manquants` : c.surcote ? `+${(c.surcote * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %` : "atteint"],
      ["Points Agirc-Arrco", c.points.toLocaleString("fr-FR")], ["Salaire annuel moyen retenu", eur(c.sam * 12)]].map(([l, v]) => `<div><span>${l}</span><b>${v}</b></div>`).join("");
    $("#r-bump-t").textContent = s.bumpOn ? `Soit ${d.n_bumps} hausse${d.n_bumps > 1 ? "s" : ""} de ${eur(s.bump)} nets par mois d'ici ${c.age} ans, en plus des ${(+s.growth).toLocaleString("fr-FR")} % par an.` : "";
    $("#r-cta").innerHTML = s.retire !== P.retire_age ? `<button class="primary-sm">Utiliser ${s.retire} ans dans mes projections</button><span>Ton profil prévoit ${P.retire_age} ans. Rien ne change sans ton accord.</span>` : "";
    $("#r-note").textContent = `${d.hyp} ${d.sources}. Estimation indicative : ton relevé officiel est sur info-retraite.fr.`;
  };
  go();
}

/* ---------- Mes projets ---------- */
function lanes(items) {
  const a0 = 2026 - P.birth_year, last = [-99, -99, -99, -99];
  return items.map((it, i) => [it, i]).sort((a, b) => a[0].age - b[0].age).map(([it, i]) => {
    const x = ((it.age - a0) / (90 - a0)) * 100;
    let ln = last.findIndex((v) => x - v > 11); if (ln < 0) ln = last.indexOf(Math.min(...last));
    last[ln] = x; return [it, i, ln];
  });
}
const OFFSET = { voiture: 3, enfant: 7, voyage: 4, mariage: 6, etudes: 26, entreprise: 8, travaux: 12, autre: 5 };
const ST = { ok: "var(--good)", tendu: "var(--acc)", credit: "var(--bad)" };
function projets(m) {
  if (!st.projects) st.projects = JSON.parse(JSON.stringify(P.projects || []));
  const L = st.projects, a0 = 2026 - P.birth_year, end = 90;
  m.innerHTML = `<div class="c-top"><div><h2>Mes projets</h2><p>Pose tes projets sur ta vie. Orbit les intègre au calcul, te dit s'ils sont finançables et ce qu'ils changent pour ta retraite.</p></div></div>
    <div class="pj-add" id="pj-add"></div>
    <div class="pj-frise" id="pj-frise"></div>
    <svg id="pj-chart"></svg>
    <p class="av-say" id="pj-say"></p>
    <div class="pj-list" id="pj-list"></div>
    <div class="av-cta" id="pj-cta"></div>
    <p class="av-note" id="pj-note"></p>`;
  enter(m);
  const X = (age) => ((age - a0) / (end - a0)) * 100;
  let D = null;
  const go = () => { clearTimeout(timer); timer = setTimeout(preview, 180); };
  async function preview() {
    const my = ++seq;
    D = await (await fetch("/api/projects/preview", { method: "POST", headers: J, body: JSON.stringify({ projects: L }) })).json();
    if (my !== seq) return;
    st.presets = D.presets;
    D.items.forEach((it, i) => Object.assign(L[i], { age: it.age }));
    paint();
  }
  function paint() {
    $("#pj-add").innerHTML = Object.entries(D.presets).map(([k, v]) => `<button data-kind="${k}">+ ${v.label}</button>`).join("");
    $("#pj-frise").innerHTML = `<div class="pj-line"></div><div class="pj-ret" style="left:${X(D.retire_age)}%"><span>Retraite</span></div>` +
      [a0, a0 + 10, a0 + 20, a0 + 30, a0 + 40, a0 + 50, a0 + 60].filter((a) => a <= end).map((a) => `<div class="pj-tick" style="left:${X(a)}%">${a} ans</div>`).join("") +
      lanes(D.items).map(([it, i, ln]) => `<div class="pj-b l${ln}" data-i="${i}" style="left:${X(it.age)}%;--c:${ST[it.s] || "var(--tx2)"}"><i></i><span>${it.label}<small>${it.age} ans</small></span></div>`).join("");
    gsap.from("#pj-frise .pj-b", { scale: 0.4, opacity: 0, duration: 0.45, stagger: 0.05, ease: "back.out(2)" });
    chart();
    const dr = D.delta_ret;
    $("#pj-say").innerHTML = D.items.length ? `Avec ces projets, ton patrimoine à ${D.retire_age} ans serait de <b>${keur(D.with[Math.min(D.horizon, D.retire_age - D.age0)])}</b>, soit <b class="dn">${dr <= 0 ? "−" : "+"}${keur(Math.abs(dr))}</b> par rapport à une vie sans ces projets. Ton complément de retraite passerait de ${eur(D.income0)} à <b>${eur(D.income)}</b> par mois.` : "Ajoute un projet ci-dessus : il apparaît sur la frise et Orbit calcule aussitôt s'il est finançable.";
    $("#pj-list").innerHTML = D.items.map((it, i) => `<div class="pj-c" data-i="${i}" style="--c:${ST[it.s]}">
        <div class="pj-ch"><i></i><input data-f="label" value="${it.label.replace(/"/g, "&quot;")}" maxlength="40"><button class="pj-x" data-del="${i}" aria-label="Retirer">×</button></div>
        <div class="pj-f"><label>Âge<input type="number" data-f="age" value="${it.age}" min="${a0}" max="${end}"></label><label>Coût (€)<input type="number" data-f="cost" value="${Math.round(it.cost)}" step="1000"></label>
        <label>€ / mois<input type="number" data-f="monthly" value="${Math.round(it.monthly)}" step="50"></label><label>Durée (ans)<input type="number" data-f="years" value="${it.years}" min="0" max="30"></label></div>
        <div class="pj-s">${it.t}</div></div>`).join("");
    gsap.from("#pj-list .pj-c", { opacity: 0, y: 8, duration: 0.35, stagger: 0.04 });
    $("#pj-cta").innerHTML = st.dirty ? `<button class="primary-sm" id="pj-save">Enregistrer mes projets</button><button class="ghost-sm" id="pj-undo">Annuler</button><span>Une fois enregistrés, ils comptent dans toutes tes projections (Ma vie, Score, Agents).</span>` : "";
    $("#pj-note").textContent = D.note + " Un manque d'épargne au moment d'un projet est financé par un crédit sur 5 ans à 5 %.";
  }
  function chart() {
    const svg = d3.select("#pj-chart"), W = $("#pj-chart").clientWidth || 700, H = 200, pad = { l: 8, r: 8, t: 14, b: 22 };
    svg.attr("viewBox", `0 0 ${W} ${H}`).selectAll("*").remove();
    const n = D.with.length, x = d3.scaleLinear().domain([0, n - 1]).range([pad.l, W - pad.r]);
    const y = d3.scaleLinear().domain([Math.min(0, d3.min(D.with), d3.min(D.without)), Math.max(d3.max(D.with), d3.max(D.without))]).nice().range([H - pad.b, pad.t]);
    const line = (a) => d3.line().x((_, i) => x(i)).y((v) => y(v)).curve(d3.curveMonotoneX)(a);
    svg.append("line").attr("x1", x(D.retire_age - D.age0)).attr("x2", x(D.retire_age - D.age0)).attr("y1", pad.t).attr("y2", H - pad.b).attr("stroke", "rgba(255,255,255,.18)").attr("stroke-dasharray", "2 4");
    svg.append("path").attr("d", line(D.without)).attr("fill", "none").attr("stroke", "rgba(255,255,255,.3)").attr("stroke-width", 1.5).attr("stroke-dasharray", "4 4");
    const p = svg.append("path").attr("d", line(D.with)).attr("fill", "none").attr("stroke", "#f5f5f7").attr("stroke-width", 2);
    const len = p.node().getTotalLength(); p.attr("stroke-dasharray", len).attr("stroke-dashoffset", len).transition().duration(900).attr("stroke-dashoffset", 0);
    D.items.forEach((it) => { const k = it.age - D.age0; if (k >= 0 && k < n) svg.append("circle").attr("cx", x(k)).attr("cy", y(D.with[k])).attr("r", 4).attr("fill", ST[it.s]).attr("stroke", "#050506").attr("stroke-width", 1.5); });
    [0, 10, 20, 30, 40, 50, 60].filter((k) => k < n).forEach((k) => svg.append("text").attr("x", x(k)).attr("y", H - 4).attr("fill", "var(--tx3)").attr("font-size", 10.5).attr("text-anchor", k ? "middle" : "start").text(D.age0 + k + " ans"));
    svg.append("text").attr("x", W - pad.r).attr("y", pad.t).attr("text-anchor", "end").attr("fill", "var(--tx3)").attr("font-size", 10.5).text("— avec tes projets   - - sans");
  }
  m.addEventListener("click", (e) => {
    const k = e.target.closest("[data-kind]")?.dataset.kind;
    if (k) { const v = D.presets[k]; L.push({ id: Date.now().toString(36), kind: k, label: v.label, age: Math.min(85, a0 + OFFSET[k]), cost: v.cost, monthly: v.monthly, years: v.years }); st.dirty = true; return preview(); }
    const del = e.target.closest("[data-del]");
    if (del) { L.splice(+del.dataset.del, 1); st.dirty = true; return preview(); }
    if (e.target.id === "pj-save") { e.target.disabled = true; return saveProfile({ projects: L }); }
    if (e.target.id === "pj-undo") { st.projects = null; st.dirty = false; return projets(m); }
  });
  m.addEventListener("input", (e) => {
    const f = e.target.dataset.f; if (!f) return;
    const i = +e.target.closest("[data-i]").dataset.i;
    L[i][f] = f === "label" ? e.target.value : +e.target.value || 0; st.dirty = true;
    if (f !== "label") go(); else { $("#pj-cta").innerHTML || paint(); }
  });
  m.addEventListener("change", (e) => { if (e.target.dataset.f === "label") preview(); });
  m.addEventListener("pointerdown", (e) => {
    const b = e.target.closest(".pj-b"); if (!b) return;
    const fr = $("#pj-frise").getBoundingClientRect(), i = +b.dataset.i;
    b.setPointerCapture(e.pointerId); b.classList.add("drag");
    const mv = (ev) => {
      const age = Math.round(a0 + Math.max(0, Math.min(1, (ev.clientX - fr.left) / fr.width)) * (end - a0));
      L[i].age = age; b.style.left = X(age) + "%"; b.querySelector("small").textContent = age + " ans";
    };
    const up = () => { b.removeEventListener("pointermove", mv); b.classList.remove("drag"); st.dirty = true; preview(); };
    b.addEventListener("pointermove", mv); b.addEventListener("pointerup", up, { once: true });
  });
  preview();
}

/* ---------- Transmettre ---------- */
function transmettre(m) {
  const s = st.trans; if (s.children == null) s.children = P.children ?? 2;
  const F = { children: (v) => (+v ? `${v} enfant${v > 1 ? "s" : ""}` : "Aucun"), age: (v) => v + " ans", av: (v) => v + " %", donation: (v) => keur(v) };
  m.innerHTML = `<div class="c-top"><div><h2>Transmettre</h2><p>Ce que tes proches recevront un jour, ce que l'État prélèvera, et comment l'assurance-vie et les donations changent la donne.</p></div></div>
    <div class="c-params">${slider("children", "Enfants", 0, 5, 1, s.children, F.children)}${slider("age", "Succession à", 75, 95, 1, s.age, F.age)}${slider("av", "Part en assurance-vie", 0, 100, 10, s.av, F.av)}${slider("donation", "Donation par enfant", 0, 131865, 5000, s.donation, F.donation)}</div>
    <div class="av-hero"><div class="av-big" id="t-big">—</div><div class="cc-s" id="t-sub"></div></div>
    <div class="tr-cmp" id="t-cmp"></div>
    <div class="tr-best" id="t-best"></div>
    <div class="av-h">Ce que dit la loi</div>
    <div class="av-facts tr-rules">
      <div><span>Abattement par enfant</span><b>100 000 €</b><small>renouvelé tous les 15 ans</small></div>
      <div><span>Assurance-vie, par bénéficiaire</span><b>152 500 €</b><small>versements avant 70 ans</small></div>
      <div><span>Don familial de sommes d'argent</span><b>31 865 €</b><small>donateur de moins de 80 ans</small></div>
      <div><span>Conjoint marié ou pacsé</span><b>0 €</b><small>totalement exonéré</small></div></div>
    <p class="av-note" id="t-note"></p>`;
  enter(m);
  const set = (k, v) => { s[k] = v; $(`[data-k="${k}"]`, m).value = v; $(`[data-o="${k}"]`, m).textContent = F[k](v); };
  $(".c-params", m).addEventListener("input", (e) => { const k = e.target.dataset.k; if (!k) return; set(k, +e.target.value); clearTimeout(timer); timer = setTimeout(go, 160); });
  let D = null;
  $("#t-best", m).addEventListener("click", (e) => {
    if (!e.target.closest("button") || !D) return;
    set("av", Math.round((D.best.av / Math.max(1, D.fin)) * 10) * 10); set("donation", Math.round(D.best.don / Math.max(1, D.children))); go();
  });
  const go = async () => {
    const my = ++seq;
    D = await (await fetch(`/api/transmission?children=${s.children}&age=${s.age}&av=${s.av}&donation=${s.donation}`)).json();
    if (my !== seq) return;
    const d = D, n = d.children;
    count($("#t-big"), n ? d.mine.per : d.mine.net, (v) => keur(v) + (n ? " par enfant" : " transmis"));
    $("#t-sub").textContent = `après droits de succession, sur un patrimoine médian de ${keur(d.estate)} à ${d.age} ans${d.home > 1 ? `, dont ${keur(d.home)} de logement` : ""}`;
    const row = (l, c) => `<div class="tr-r"><span>${l}</span><div class="tr-bar"><i style="flex:${Math.max(0.001, c.net)}"></i><b style="flex:${Math.max(0.001, c.tax)}"></b></div><em>${c.tax > 1 ? "−" + keur(c.tax) + " de droits" : "aucun droit"}</em></div>`;
    $("#t-cmp").innerHTML = row("Sans rien préparer", d.base) + row("Avec tes choix", d.mine) + `<div class="tr-k"><span><i></i>Reçu par tes proches</span><span><b></b>Droits de succession</span></div>`;
    gsap.fromTo("#t-cmp .tr-bar", { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 0.8, stagger: 0.12, ease: "power3.out" });
    $("#t-best").innerHTML = !n ? `<p>Sans enfant, un héritier qui n'est pas de ta famille proche paie jusqu'à <b>60 %</b> de droits. L'assurance-vie reste l'outil le plus efficace pour transmettre à qui tu veux.</p>`
      : d.mine.tax > d.best.tax + 500 ? `<p>En plaçant <b>${keur(d.best.av)}</b> en assurance-vie et en donnant <b>${keur(d.best.don / n)}</b> à chaque enfant de ton vivant, les droits passent de ${keur(d.mine.tax)} à <b>${keur(d.best.tax)}</b>.</p><button class="primary-sm">Voir avec cette stratégie</button>`
      : d.base.tax > 1 ? `<p class="up">Avec tes choix, tu évites ${keur(d.base.tax - d.mine.tax)} de droits.</p>` : `<p class="up">Avec ce patrimoine, tes enfants ne paieraient aucun droit de succession.</p>`;
    $("#t-note").textContent = `${d.hyp} ${d.sources}. Estimation indicative, un notaire reste indispensable.`;
  };
  go();
}
