import * as THREE from "three";
import { RoomEnvironment } from "/static/vendor/three/examples/jsm/environments/RoomEnvironment.js";

const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
const AG = [
  ["vigie", "Vigie", "Surveille la Bourse, la BCE et l'inflation, et traduit en euros ce qui te touche", "#7fd6ff"],
  ["analyste", "Analyste", "Rejoue 30 ans de marchés réels sur ta vie et mesure tes chances", "#8ab4ff"],
  ["stratege", "Stratège", "Teste des combinaisons et trouve la solution la moins coûteuse", "#b9a2ff"],
  ["gardien", "Gardien", "Bloque ce qui est risqué ou intenable, et teste les coups durs de la vie", "#7fd1a8"],
  ["conseiller", "Conseiller IA", "T'explique tout en clair et répond à tes questions", "#ffd59a"],
];
const IDX = Object.fromEntries(AG.map(([id], i) => [id, i]));
const NAME = Object.fromEntries(AG.map(([id, n]) => [id, n]));
const COL = Object.fromEntries(AG.map(([id, , , c]) => [id, c]));
const KIND = { start: "Mission", call: "Appel", data: "Réponse", calc: "Calcul", check: "Contrôle", result: "Résultat", error: "Secours", handoff: "Message", try: "Essai" };
const TECH = new Set(["call", "data", "calc", "error"]);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const nf = (v, d = 0) => Number(v).toLocaleString("fr-FR", { maximumFractionDigits: d, minimumFractionDigits: d });
const keur = (v) => (v >= 0 ? "+" : "−") + (Math.abs(v) >= 10000 ? nf(Math.abs(v) / 1000) + " k€" : nf(Math.abs(v)) + " €");
const hms = (t) => new Date(t * 1000).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris" });
const sec = $("#v-agents");
let rid = null, since = 0, st = {}, running = false, started = false, last = {}, chat = [];

/* ---------- équipe (liste) ---------- */
function team() {
  $("#a-team").innerHTML = AG.map(([id, n, m, c]) => `<li class="${st[id] || ""}" data-id="${id}" style="--c:${c}"><div class="ag-slot"></div><div><b>${n}</b><span>${m}</span><small>${esc(last[id] || "")}</small></div></li>`).join("");
}
function setState(id, s) {
  st[id] = s;
  const li = $(`.ag-team li[data-id="${id}"]`);
  if (li) { li.className = s; li.querySelector("small").textContent = last[id] || ""; }
  orbs.state(id, s);
}

/* ---------- boules de cristal (Three.js) ---------- */
const orbs = (() => {
  const nop = { state() {}, hand() {}, intro() { $$(".ag-team li").forEach((l) => (l.style.opacity = 1)); }, layout() {} };
  let R;
  try { R = new THREE.WebGLRenderer({ canvas: $("#ag-orbs"), antialias: true, alpha: true }); } catch (e) { sec.classList.add("no3d"); return nop; }
  R.setPixelRatio(Math.min(2, devicePixelRatio));
  R.toneMapping = THREE.ACESFilmicToneMapping;
  const S = new THREE.Scene();
  S.environment = new THREE.PMREMGenerator(R).fromScene(new RoomEnvironment(), 0.04).texture;
  const cam = new THREE.OrthographicCamera(0, 1, 0, -1, -2000, 2000);
  cam.position.z = 1000;
  const dot = (() => { const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d"); const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.25, "rgba(255,255,255,.45)"); r.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
  const glass = new THREE.SphereGeometry(1, 64, 32), coreG = new THREE.IcosahedronGeometry(0.42, 1), facetG = new THREE.IcosahedronGeometry(0.7, 0);
  const O = AG.map(([id, , , c]) => {
    const col = new THREE.Color(c), g = new THREE.Group();
    const shell = new THREE.Mesh(glass, new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.03, transmission: 1, thickness: 1.4, ior: 1.5, iridescence: 0.7, iridescenceIOR: 1.35, clearcoat: 1, envMapIntensity: 1.6, specularIntensity: 1 }));
    const core = new THREE.Mesh(coreG, new THREE.MeshBasicMaterial({ color: col }));
    const facet = new THREE.Mesh(facetG, new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(0.55), wireframe: true }));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: col, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 }));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.012, 8, 96), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0 }));
    ring.rotation.x = 1.2;
    g.add(core, facet, shell, ring); S.add(g, halo);
    return { id, g, core, facet, halo, ring, col, x: 0, y: 0, r: 30, pop: 1, s: "", glow: 0.35, spin: 0.3, float: 1, seed: Math.random() * 10 };
  });
  const sparks = Array.from({ length: 8 }, (_, k) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 })); S.add(s); s.k = k; return s; });
  let W = 1, H = 1, settled = false, introDone = false, t0 = performance.now(), flight = null;
  const slot = (i) => { const el = $$(".ag-slot")[i]; if (!el) return null; const a = el.getBoundingClientRect(), b = sec.getBoundingClientRect();
    return { x: a.left - b.left + a.width / 2 + sec.scrollLeft, y: a.top - b.top + a.height / 2 + sec.scrollTop, r: a.width * 0.36 }; };
  function size() {
    W = sec.clientWidth; H = Math.max(sec.clientHeight, sec.scrollHeight);
    if (!W) return;
    R.setSize(W, H, false); $("#ag-orbs").style.height = H + "px";
    cam.left = 0; cam.right = W; cam.top = 0; cam.bottom = -H; cam.updateProjectionMatrix();
  }
  function layout() {
    size();
    if (settled) O.forEach((o, i) => { const s = slot(i); if (s) Object.assign(o, s); });
  }
  function intro() {
    size();
    const lis = $$(".ag-team li");
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { settled = true; layout(); lis.forEach((l) => (l.style.opacity = 1)); introDone = true; return; }
    const cx = W * 0.56, cy = Math.min(H, sec.clientHeight) * 0.5, r = Math.min(46, W / 16);
    gsap.set(lis, { opacity: 0, x: -12 });
    O.forEach((o, i) => { o.x = cx + (i - 2) * r * 3.1; o.y = cy + Math.sin(i * 1.7) * 26; o.r = r * 0.2; o.float = 1; o.glow = 0.7; });
    gsap.to(O, { r, duration: 0.9, ease: "back.out(1.6)", stagger: 0.07 });
    O.forEach((o, i) => {
      const s = slot(i); if (!s) return;
      gsap.to(o, { x: s.x, y: s.y, r: s.r, float: 0.12, glow: 0.4, duration: 1.1, delay: 1.3 + i * 0.08, ease: "power3.inOut", onComplete: () => { if (i === 4) { settled = true; introDone = true; layout(); } } });
    });
    gsap.to(lis, { opacity: 1, x: 0, duration: 0.6, delay: 1.9, stagger: 0.07, ease: "power2.out" });
  }
  function state(id, s) {
    const o = O[IDX[id]]; if (!o) return;
    const prev = o.s; o.s = s || "";
    const v = { run: [1, 2.6, 0.55], done: [0.55, 0.5, 0], warn: [0.8, 0.8, 0.3], "": [0.4, 0.3, 0] }[s || ""] || [0.4, 0.3, 0];
    gsap.to(o, { glow: v[0], spin: v[1], duration: 0.5 });
    gsap.to(o.ring.material, { opacity: v[2], duration: 0.5 });
    if (s === "run" && prev !== "run") gsap.fromTo(o, { pop: 1.25 }, { pop: 1, duration: 0.7, ease: "elastic.out(1,.5)", overwrite: true });
  }
  function hand(from, to) {
    const a = O[IDX[from]], b = O[IDX[to]]; if (!a || !b) return;
    flight = { a, b, t: 0, col: a.col.clone().lerp(b.col, 0.5) };
    gsap.to(flight, { t: 1, duration: 0.9, ease: "power2.inOut", onComplete: () => { gsap.fromTo(b, { glow: 1.6 }, { glow: b.glow, duration: 0.6 }); flight = null; } });
  }
  const P = (f, t) => { const { a, b } = f, mx = Math.max(a.x, b.x) + 70; const u = 1 - t; return [u * u * a.x + 2 * u * t * mx + t * t * b.x, u * u * a.y + 2 * u * t * ((a.y + b.y) / 2) + t * t * b.y]; };
  function frame(now) {
    requestAnimationFrame(frame);
    if (!sec.classList.contains("on")) return;
    if (sec.clientWidth !== W) layout();
    const t = (now - t0) / 1000;
    O.forEach((o) => {
      const fy = Math.sin(t * 1.3 + o.seed) * 9 * o.float, fx = Math.cos(t * 0.9 + o.seed) * 5 * o.float;
      o.g.position.set(o.x + fx, -(o.y + fy), 0); o.g.scale.setScalar(o.r * o.pop);
      o.g.rotation.y += 0.004 * o.spin * 4; o.facet.rotation.x += 0.003 * o.spin * 3; o.ring.rotation.z += 0.02 * o.spin;
      const pulse = 1 + (st[o.id] === "run" ? Math.sin(t * 6) * 0.12 : Math.sin(t * 1.5 + o.seed) * 0.04);
      o.halo.position.set(o.x + fx, -(o.y + fy), -5); o.halo.scale.setScalar(o.r * 4.2 * pulse * (0.6 + o.glow * 0.5));
      o.halo.material.opacity = 0.18 + o.glow * 0.45;
      o.core.material.color.copy(o.col).multiplyScalar(0.6 + o.glow * 0.8);
    });
    sparks.forEach((s) => {
      if (!flight) { s.material.opacity = 0; return; }
      const tt = Math.max(0, flight.t - s.k * 0.035), [x, y] = P(flight, tt);
      s.position.set(x, -y, 10); s.scale.setScalar((22 - s.k * 2.2)); s.material.color.copy(flight.col); s.material.opacity = (1 - s.k / 8) * (tt > 0 ? 1 : 0);
    });
    R.render(S, cam);
  }
  new ResizeObserver(() => sec.classList.contains("on") && layout()).observe(sec);
  requestAnimationFrame(frame);
  return { state, hand, intro, layout };
})();

/* ---------- onglets ---------- */
function tab(t) {
  $$("#ag-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
  $$(".ag-pane").forEach((p) => p.classList.toggle("on", p.id === "p-" + t));
  const b = $(`#ag-tabs button[data-t="${t}"]`), k = $(".ag-k");
  if (b && b.offsetWidth) { k.style.left = b.offsetLeft + "px"; k.style.width = b.offsetWidth + "px"; }
  const pane = $("#p-" + t); pane && gsap.fromTo(pane, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.35, ease: "power2.out" });
  if (t === "live") { const l = $("#a-log"); l.scrollTop = l.scrollHeight; }
}
$("#ag-tabs").onclick = (e) => { const b = e.target.closest("button"); if (b) tab(b.dataset.t); };

/* ---------- résultats ---------- */
function count(root) {
  root.querySelectorAll("[data-n]").forEach((el) => {
    const to = +el.dataset.n, f = el.dataset.f || "n", o = { v: 0 };
    const fmt = (v) => f === "k" ? keur(v) : f === "p" ? Math.round(v) + " %" : nf(v);
    gsap.to(o, { v: to, duration: 1.2, ease: "power3.out", onUpdate: () => (el.textContent = fmt(o.v)) });
  });
}
function empty() {
  $("#a-out").innerHTML = `<div class="ag-empty">${AG.map(([id, n, m, c]) => `<div style="--c:${c}"><i></i><b>${n}</b><p>${m}</p></div>`).join("")}</div>`;
}
function say(html) {
  const el = $("#a-say"); el.innerHTML = html;
  gsap.fromTo(el, { opacity: 0, y: 3 }, { opacity: 1, y: 0, duration: 0.3 });
}
function step(a, text) {
  const out = $("#a-out");
  if (out.querySelector(".ag-empty")) out.innerHTML = "";
  out.insertAdjacentHTML("beforeend", `<div class="step" style="--c:${COL[a]}"><i></i><b>${NAME[a]}</b><span>${esc(text)}</span></div>`);
  gsap.from(out.lastElementChild, { opacity: 0, y: 10, duration: 0.45, ease: "power2.out" });
}

async function impact(bump) {
  const r = await fetch("/api/profile"); if (!r.ok) return;
  const p = await r.json(), j = (p.journal || []), ok = j.filter((e) => e.ok), sum = ok.reduce((a, e) => a + (e.gain || 0), 0);
  $("#a-impact").innerHTML = j.length ? `<b class="${sum >= 0 ? "up" : "dn"}">${keur(sum)}</b><span>gagnés grâce à tes agents · ${ok.length} acceptée${ok.length > 1 ? "s" : ""}, ${j.length - ok.length} refusée${j.length - ok.length > 1 ? "s" : ""}</span>`
    : `<b>0 €</b><span>Compteur d'impact : accepte une solution pour le voir monter</span>`;
  if (bump) gsap.fromTo("#a-impact b", { scale: 1.3 }, { scale: 1, duration: 0.7, ease: "back.out(3)" });
}

async function start() {
  if (running) return;
  running = started = true; since = 0; st = {}; last = {};
  $("#a-run").disabled = true; $("#a-run").textContent = "Analyse en cours…";
  $("#ag-live").classList.add("on");
  $("#a-log").innerHTML = ""; $("#a-out").innerHTML = ""; team(); AG.forEach(([id]) => orbs.state(id, ""));
  $$(".ag-team li").forEach((l) => (l.style.opacity = 1));
  say("<b>Analyse en cours</b> · l'équipe se met au travail");
  const r = await fetch("/api/agents/live", { method: "POST" });
  if (r.status === 401) return (location.href = "/login");
  rid = (await r.json()).run; poll();
}
async function poll() {
  const r = await fetch(`/api/agents/live/${rid}?since=${since}`);
  if (!r.ok) { running = false; $("#a-run").disabled = false; $("#a-run").textContent = "Relancer l'analyse"; $("#ag-live").classList.remove("on"); return; }
  const d = await r.json();
  d.events.forEach(add); since += d.events.length;
  d.done ? finish(d.summary) : setTimeout(poll, 350);
}
function add(e) {
  const a = e.agent, x = e.detail || {};
  AG.forEach(([id]) => { if (id !== a && st[id] === "run") setState(id, "done"); });
  if (["result", "start"].includes(e.kind)) last[a] = e.text;
  setState(a, e.kind === "error" && a === "conseiller" && /interrompue/.test(e.text) ? "warn" : "run");
  if (e.kind === "handoff") { orbs.hand(a, x.to); say(`<b>${NAME[a]} → ${NAME[x.to]}</b> « ${esc(e.text)} »`); }
  else if (!TECH.has(e.kind)) say(`<b>Analyse en cours · ${NAME[a]}</b> ${esc(e.text)}`);
  if (e.kind === "result") step(a, e.text);
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
  AG.forEach(([id]) => st[id] === "run" && setState(id, "done"));
  $("#a-run").disabled = false; $("#a-run").textContent = "Relancer l'analyse"; $("#ag-live").classList.remove("on");
  say(`<b>Analyse terminée.</b> Rien n'est appliqué sans ta validation.`);
  const pr = s.projection || {}, card = (a, title, body, wide) => `<div class="cd ${wide ? "wide" : ""}" style="--c:${COL[a]}"><div class="cd-h"><i></i>${NAME[a]} · ${title}</div>${body}</div>`;
  let h = "";
  if ((s.alerts || []).length) h += card("vigie", "ce qui te concerne aujourd'hui", s.alerts.map((a) => `<div class="al"><b>${esc(a.title)}</b><p>${esc(a.text)}</p>${a.effect != null ? `<em class="${a.effect >= 0 ? "up" : "dn"}">≈ ${keur(a.effect)} à ${pr.age} ans</em>` : ""}<small>${esc(a.src)}</small></div>`).join(""));
  if (pr.goal) h += card("analyste", `objectif ${nf(pr.goal)} €/mois à ${pr.age} ans`, `<div class="cd-big" data-n="${Math.round(pr.prob * 100)}" data-f="p">0 %</div><div class="cd-sub">de chances d'y arriver, sur 30 séquences de marché réelles</div>
    <div class="gl" style="margin-top:14px"><div class="gl-b"><i style="width:${Math.round(pr.prob * 100)}%"></i><u style="left:${Math.round((s.target || 0.75) * 100)}%"></u></div><span>Cible du Stratège : ${Math.round((s.target || 0.75) * 100)} % · patrimoine médian <b data-n="${Math.round(pr.net)}" data-f="k"></b></span></div>`);
  const V = { ok: ["Validée par le Gardien", "v-ok"], warn: ["Validée avec réserve", "v-warn"], block: ["Bloquée par le Gardien", "v-block"] };
  if ((s.options || []).length) h += card("stratege", "solutions trouvées, contrôlées par le Gardien", `<div class="ops">${s.options.map((o, i) => `<div class="ao-c op ${V[o.verdict][1]}" data-i="${i}">
      <div class="op-h"><b>${esc(o.title)}</b><span class="vb">${V[o.verdict][0]}</span></div>
      <div class="op-n"><span><b data-n="${Math.round(o.prob * 100)}" data-f="p"></b> de chances</span><span><b class="g ${o.gain >= 0 ? "up" : "dn"}" data-n="${Math.round(o.gain)}" data-f="k"></b></span></div>
      <p>${o.why.map(esc).join("<br>")}</p>
      <div class="btns">${o.verdict === "block" ? `<span class="no">Non proposée</span>` : `<button class="primary-sm" data-do="ok">Accepter</button><button data-do="no">Refuser</button>`}</div></div>`).join("")}</div>`, true);
  const f = s.fees;
  if (f) h += card("stratege", "ce que te coûtent tes placements", `<div class="cd-big dn" data-n="${-Math.round(f.paid)}" data-f="k"></div><div class="cd-sub">de frais d'ici ${pr.age} ans · ${esc(f.broker)}</div>
    <p class="cd-p">${esc(f.note)}</p><div class="fee-alts">${f.alts.map((a) => `<div><span>${esc(a.name)}<small>${esc(a.note)}</small></span><b class="${a.gain >= 0 ? "up" : "dn"}">${keur(a.gain)}</b></div>`).join("")}</div>
    <small class="cd-src">${esc(f.cfd)}<br>Sources : ${f.sources.map(esc).join(" · ")}</small>`);
  const im = s.immo;
  if (im) h += card("stratege", `acheter à ${esc(im.city)}`, `<div class="cd-big" data-n="${Math.round(im.m2)}">0</div><div class="cd-sub">m² environ, au prix médian de ${nf(im.med)} €/m²</div>
    <dl class="cd-dl"><dt>Budget maximal</dt><dd>${keur(im.price)}</dd><dt>Mensualité (35 % de ton revenu)</dt><dd>${nf(im.pay)} €</dd><dt>Prêt sur ${im.years} ans à ${nf(im.rate, 2)} %</dt><dd>${keur(im.loan)}</dd><dt>Apport mobilisable</dt><dd>${keur(im.down)}</dd><dt>Prix au m², 25 % les moins chers / les plus chers</dt><dd>${nf(im.q1)} – ${nf(im.q3)} €</dd></dl>
    <small class="cd-src">${im.n} ventes réelles d'appartements en ${im.year} · DVF, data.gouv.fr</small>`);
  if ((s.risks || []).length) h += card("gardien", "les coups durs de la vie, chiffrés pour toi", `<div class="rks">${s.risks.map((r) => `<div class="rk"><div class="rk-h"><b>${esc(r.title)}</b><em class="dn">${keur(r.loss)}</em></div>
    <div class="rk-s">${esc(r.how)} Effet à ${r.at} ans${r.prob != null ? ` · chances ${Math.round(r.prob0 * 100)} % → ${Math.round(r.prob * 100)} %` : ""}</div>
    <div class="rk-p">${esc(r.protect)}</div><small>${esc(r.stat)}</small></div>`).join("")}</div>`, true);
  if (s.note) h += card("conseiller", "en résumé", `<div class="nt">${esc(s.note)}<small>${s.mode !== "règles" ? `Rédigé par ${s.mode} · chiffres vérifiés un par un` : "Rédigé par règles (IA non configurée)"}</small></div>
    <div class="brief"><div><b>Ton rendez-vous à la banque</b><span>Une fiche d'une page avec ta situation, tes frais, tes risques et les questions à poser.</span></div><a class="primary-sm" href="/api/advisor/brief" target="_blank" rel="noopener">Préparer ma fiche PDF</a></div>`, true);
  const out = $("#a-out");
  gsap.to(out.children, { opacity: 0, y: -6, duration: 0.25, stagger: 0.03, onComplete: () => {
    out.innerHTML = h; count(out);
    gsap.from(out.children, { opacity: 0, y: 16, scale: 0.98, duration: 0.6, stagger: 0.09, ease: "power3.out" });
  } });
  out.onclick = async (e) => {
    const b = e.target.closest("[data-do]"); if (!b) return;
    const cardEl = b.closest(".ao-c"), o = s.options[+cardEl.dataset.i], ok = b.dataset.do === "ok";
    cardEl.querySelector(".btns").innerHTML = `<span>…</span>`;
    const r = await fetch("/api/agents/decide", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: o.title, set: o.set, ok }) });
    const d = await r.json();
    cardEl.querySelector(".btns").innerHTML = ok ? `<span class="ok">Acceptée · profil mis à jour</span>` : `<span class="no">Refusée</span>`;
    if (!ok) { gsap.to(cardEl, { opacity: 0.45, duration: 0.4 }); return impact(); }
    out.querySelectorAll(".op .btns button").forEach((x) => (x.closest(".btns").innerHTML = `<span class="no">Relance l'analyse pour de nouvelles solutions</span>`));
    dispatchEvent(new Event("orbit:profile"));
    const g = cardEl.querySelector(".g").getBoundingClientRect(), t = $("#a-impact").getBoundingClientRect();
    const f = document.createElement("div"); f.className = "fly"; f.textContent = keur(d.entry.gain); document.body.append(f);
    gsap.fromTo(f, { left: g.left, top: g.top }, { left: t.right - 90, top: t.top, duration: 0.9, ease: "power2.inOut", onComplete: () => { f.remove(); impact(true); } });
    gsap.to(f, { scale: 1.4, duration: 0.45, yoyo: true, repeat: 1 });
  };
}

/* ---------- Conseiller (chat) ---------- */
const SUGG = ["Puis-je acheter un appartement à 300 000 € dans 2 ans ?", "Et si je partais à la retraite à 62 ans ?", "Combien épargner pour avoir 2 000 € par mois ?"];
$("#a-sugg").innerHTML = SUGG.map((q) => `<button type="button">${q}</button>`).join("");
$("#a-sugg").onclick = (e) => { const b = e.target.closest("button"); if (b) { $("#a-q").value = b.textContent; $("#a-chat").requestSubmit(); } };
const ARG = { epargne_mois: (v) => `épargne ${nf(v)} €/mois`, part_actions: (v) => `${nf(v)} % actions`, age_retraite: (v) => `retraite à ${nf(v)} ans`, objectif_eur_mois: (v) => `objectif ${nf(v)} €/mois`, chances_pct: (v) => `${nf(v)} % de chances`, achat_prix: (v) => `achat ${nf(v)} €`, achat_dans_ans: (v) => `dans ${nf(v)} ans`, achat_apport: (v) => `apport ${nf(v)} €` };
$("#a-chat").onsubmit = async (e) => {
  e.preventDefault();
  const q = $("#a-q").value.trim(); if (!q) return;
  $("#a-q").value = ""; $("#a-sugg").style.display = "none";
  const box = $("#a-msgs");
  box.insertAdjacentHTML("beforeend", `<div class="m-u">${esc(q)}</div><div class="m-a wait">Le Conseiller interroge le moteur de calcul…</div>`);
  gsap.from(box.lastElementChild.previousElementSibling, { opacity: 0, x: 12, duration: 0.3 });
  box.scrollTop = box.scrollHeight;
  orbs.state("conseiller", "run");
  const r = await fetch("/api/advisor/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q, history: chat }) });
  orbs.state("conseiller", "done");
  const el = box.lastElementChild; el.classList.remove("wait");
  if (!r.ok) { el.textContent = (await r.json().catch(() => ({}))).detail || "Conseiller indisponible."; return; }
  const d = await r.json();
  let how = d.model === "règles" ? "Réponse calculée par règles (IA non configurée)" : `${String(d.model || "").startsWith("claude") ? "Claude" : "Mistral"} · ${nf(d.ms / 1000, 1)} s`;
  chat.push({ role: "user", content: q }, { role: "assistant", content: d.answer });
  const args = (a) => Object.entries(a).map(([k, v]) => (ARG[k] || ((x) => k.replace(/_/g, " ") + " " + x))(v)).join(", ");
  const tr = d.trace.map((t) => { const r = t.result;
    if (t.tool === "epargne_necessaire") return `<span>epargne_necessaire(${args(t.args)}) → ${r.epargne_necessaire_eur_mois != null ? `${nf(r.epargne_necessaire_eur_mois)} €/mois (${r.effort_supplementaire_eur_mois >= 0 ? "+" : ""}${nf(r.effort_supplementaire_eur_mois)}) · ${r.controle}` : esc(r.message || r.erreur)}</span>`;
    return `<span>simuler(${args(t.args) || "profil actuel"}) → ${r.chances_objectif_pct} % · ${nf(r.revenu_median_retraite_eur_mois)} €/mois${r.taux_endettement_pct != null ? ` · endettement ${r.taux_endettement_pct} %` : ""} · ${r.controle}</span>`; }).join("");
  el.innerHTML = `${tr ? `<div class="m-tr">${tr}</div>` : ""}${esc(d.answer)}<small>${how} · ${d.trace.length} calcul${d.trace.length > 1 ? "s" : ""} du moteur · ${d.checked ? "chiffres vérifiés" : "à vérifier : un chiffre ne vient pas du moteur"}</small>`;
  gsap.from(el, { opacity: 0, y: 6, duration: 0.4 });
  box.scrollTop = box.scrollHeight;
};

$("#a-tech").onchange = (e) => $("#a-log").classList.toggle("simple", !e.target.checked);
$("#a-run").addEventListener("click", start);
let introduced = false;
addEventListener("orbit:view", (e) => {
  if (e.detail !== "agents") return;
  impact();
  requestAnimationFrame(() => {
    tab($("#ag-tabs button.on").dataset.t);
    if (!introduced) { introduced = true; orbs.intro(); setTimeout(() => !started && start(), 2600); } else orbs.layout();
  });
});
fetch("/api/llm").then((r) => r.ok ? r.json() : null).then((d) => { const m = d?.mode || "règles"; $("#a-mode").textContent = m === "règles" ? "· réponses par règles" : "· " + m; }).catch(() => {});
team(); empty(); impact(); say("Les agents sont prêts. Lance l'analyse pour les voir travailler.");
