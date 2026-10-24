import * as THREE from "three";
import { GLTFLoader } from "/static/vendor/three/examples/jsm/loaders/GLTFLoader.js";

const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
const eur = (v) => Math.round(v).toLocaleString("fr-FR") + " €";
const keur = (v) => (Math.abs(v) >= 1e6 ? (v / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 2 }) + " M€" : Math.round(v / 1000).toLocaleString("fr-FR") + " k€");
let L = null, sc = "mid", target = 0, cur = 0;

/* ---------- navigation ---------- */
$("#tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  $$("#tabs button").forEach((x) => x.classList.toggle("on", x === b));
  const v = $("#v-" + b.dataset.v);
  $$(".view").forEach((x) => x.classList.toggle("on", x === v));
  gsap.fromTo(v, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.45, ease: "power2.out", clearProps: "transform" });
  if (b.dataset.v === "vie") resize();
  dispatchEvent(new CustomEvent("orbit:view", { detail: b.dataset.v }));
});
export function show(v) { $(`#tabs button[data-v="${v}"]`).click(); }
window.orbitShow = show;
async function me() {
  const r = await fetch("/api/me");
  if (r.status === 401) return (location.href = "/login");
  const u = await r.json();
  const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email;
  $("#me-name").textContent = name;
  $("#me-ini").textContent = ((u.first_name || u.email)[0] + (u.last_name || "")[0 || 0] || "").toUpperCase().slice(0, 2);
  $("#me-mail").textContent = u.email;
}
$("#me").addEventListener("click", (e) => {
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (act === "logout") return fetch("/api/auth/logout", { method: "POST" }).then(() => (location.href = "/login"));
  if (act === "pro") return (location.href = "/pro");
  if (act === "security") { show("profil"); setTimeout(() => $("#security").scrollIntoView({ behavior: "smooth" }), 300); }
  $("#menu").classList.toggle("open", !act && !$("#menu").classList.contains("open"));
});
addEventListener("click", (e) => { if (!e.target.closest("#me")) $("#menu").classList.remove("open"); });
addEventListener("orbit:profile", () => { me(); load(); });

/* ---------- données ---------- */
const at = (key, t) => {
  const rows = L.scenarios[sc].rows, i = Math.min(Math.floor(t), rows.length - 2), f = t - i;
  const a = rows[i][key], b = rows[i + 1][key];
  return a + (b - a) * f;
};
async function load() {
  const r = await fetch("/api/life");
  if (r.status === 401) return (location.href = "/login");
  L = await r.json(); sim = {};
  target = Math.min(target, L.horizon); cur = Math.min(cur, L.horizon);
  const p = L.profile;
  $("#t").max = L.horizon;
  const ret = p.retire_age - L.age0;
  const marks = [0, 10, 20, 30, 40, 50, 60].filter((y) => y <= L.horizon);
  $("#ticks").innerHTML = marks.map((y) => `<button data-y="${y}" style="left:${(y / L.horizon) * 100}%">${y ? "+" + y + " ans" : "Aujourd'hui"}<small>${L.age0 + y} ans</small></button>`).join("") +
"";
  renderExtras();
  $("#foot").textContent = `Historique ${L.history.status === "live" ? "en direct" : "en cache"} · ${L.history.sources.join(" · ")}`;
  drawChart();
}
$("#ticks").addEventListener("click", (e) => { const b = e.target.closest("[data-y]"); if (b) go(+b.dataset.y); });
function go(y) { gsap.to({ v: target }, { v: y, duration: 1.4, ease: "power2.inOut", onUpdate() { target = this.targets()[0].v; $("#t").value = target; } }); }
$("#t").addEventListener("input", (e) => (target = +e.target.value));
$("#seg").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  sc = b.dataset.s;
  $$("#seg button").forEach((x) => x.classList.toggle("on", x === b));
  $(".seg-k").style.transform = `translateX(${["bad", "mid", "good"].indexOf(sc) * 100}%)`;
  drawChart(true);
});
$(".seg-k").style.transform = "translateX(100%)";

/* ---------- graphique ---------- */
let X, Y, gMark;
function drawChart(anim) {
  const svg = d3.select("#chart"), W = $("#chart").clientWidth, H = 170, m = { l: 0, r: 0, t: 8, b: 18 };
  X = d3.scaleLinear([0, L.horizon], [m.l, W - m.r]);
  const all = Object.values(L.scenarios).flatMap((s) => s.rows.map((r) => r.net)).concat(L.band.flat());
  Y = d3.scaleLinear([0, d3.max(all) * 1.05], [H - m.b, m.t]);
  const line = d3.line().x((d, i) => X(i)).y((d) => Y(d.net)).curve(d3.curveMonotoneX);
  if (!anim) {
    svg.selectAll("*").remove();
    svg.append("path").attr("class", "band").attr("fill", "rgba(138,180,255,.08)")
      .attr("d", d3.area().x((d, i) => X(i)).y0((d) => Y(d[0])).y1((d) => Y(d[1])).curve(d3.curveMonotoneX)(L.band));
    const ret = L.retire_age - L.age0;
    if (ret > 0 && ret < L.horizon) svg.append("line").attr("x1", X(ret)).attr("x2", X(ret)).attr("y1", m.t).attr("y2", H - m.b).attr("stroke", "rgba(138,180,255,.35)").attr("stroke-dasharray", "2 4");
    ["bad", "mid", "good"].forEach((k) => svg.append("path").attr("class", "ln ln-" + k).attr("fill", "none"));
    svg.append("g").attr("class", "ax").attr("transform", `translate(0,${H - m.b + 4})`)
      .call(d3.axisBottom(X).ticks(6).tickFormat((d) => L.start_year + d));
    gMark = svg.append("g");
    gMark.append("line").attr("y1", m.t).attr("y2", H - m.b).attr("stroke", "rgba(255,255,255,.25)");
    gMark.append("circle").attr("r", 4.5).attr("fill", "#fff");
  }
  ["bad", "mid", "good"].forEach((k) => {
    const p = svg.select(".ln-" + k).datum(L.scenarios[k].rows).attr("d", line);
    p.transition().duration(400).attr("stroke", k === sc ? "#f5f5f7" : "rgba(255,255,255,.18)").attr("stroke-width", k === sc ? 2 : 1);
  });
  svg.selectAll(".ev").remove();
  const evs = L.scenarios.bad.events || [], badRows = L.scenarios.bad.rows, on = sc === "bad";
  evs.forEach((e, i) => {
    const g = svg.append("g").attr("class", "ev").attr("transform", `translate(${X(e.y)},${Y(badRows[e.y].net)})`).attr("opacity", on ? 1 : 0.35);
    g.append("circle").attr("r", on ? 4 : 3).attr("fill", "var(--bad)").attr("stroke", "#050506").attr("stroke-width", 1.5);
    if (on) g.append("text").attr("y", i % 2 ? 17 : -9).attr("text-anchor", "middle").attr("fill", "var(--bad)").attr("font-size", 10.5).text(e.t);
  });
  if (!anim) {
    const p = svg.select(".ln-mid").node(), len = p.getTotalLength();
    d3.select(p).attr("stroke-dasharray", len).attr("stroke-dashoffset", len).transition().duration(1600).ease(d3.easeCubicOut).attr("stroke-dashoffset", 0).on("end", () => d3.select(p).attr("stroke-dasharray", null));
  }
}

/* ---------- panneau ---------- */
let lastTxt = "";
function updatePanel(t) {
  const p = L.profile, age = L.age0 + t, year = Math.floor(L.start_year + t);
  const net = at("net", t), fin = at("fin", t), home = at("home", t), debt = at("debt", t), wd = at("withdraw", Math.min(L.horizon, Math.max(t, L.profile.retire_age - L.age0 + 1)));
  $("#age").textContent = Math.floor(age);
  $("#yr").textContent = year;
  $("#net").textContent = eur(net);
  $("#when").textContent = t < 0.5 ? "Aujourd'hui" : `Dans ${Math.round(t)} an${Math.round(t) > 1 ? "s" : ""}`;
  gMark?.attr("transform", `translate(${X(t)},0)`).select("circle").attr("cy", Y(net));
  const s = L.scenarios[sc];
  const ev = s.events || [], evTxt = ev.map((e) => `${e.t.toLowerCase()} à ${e.age} ans`).join(", ").replace(/, ([^,]*)$/, " et $1");
  if (s.q < 0.5) $("#replay").textContent = `Marchés de ${s.replay} à ${s.replay + 29} (seules 10 % des séquences font moins bien)${ev.length ? `, avec les coups durs de la vie : ${evTxt}` : ""}`;
  else $("#replay").textContent = s.q === 0.5 ? `Médiane de ${L.n_paths} séquences de marché réelles (1996-2025) rejouées à partir d'aujourd'hui` : `${s.q < 0.5 ? "Seules 10 %" : "Seules 10 %"} des ${L.n_paths} séquences historiques font ${s.q < 0.5 ? "moins bien" : "mieux"} · proche des marchés de ${s.replay} à ${s.replay + 29}`;
  const retired = age >= p.retire_age, owner = home > 1;
  const txt = [
    ["Épargne financière", keur(fin), retired ? "en cours de retrait" : t >= 0.5 ? `dont ${keur(Math.max(0, fin - at("paid", t)))} de gains` : `${eur(p.savings_month)} par mois`],
    ["Logement", owner ? keur(home - debt) : "Locataire", owner ? (debt > 1 ? `crédit restant ${keur(debt)}` : "bien remboursé") : `loyer ${eur(p.rent_month)} par mois`],
    [retired ? "Complément mensuel" : "Retraite", retired ? eur(wd) : `${p.retire_age} ans`, retired ? "tiré de l'épargne jusqu'à 90 ans" : `dans ${Math.max(0, Math.ceil(p.retire_age - age))} ans`],
  ];
  const html = txt.map(([l, v, s2]) => `<div><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s2}</div></div>`).join("");
  if (html !== lastTxt) { $("#facts").innerHTML = html; lastTxt = html; }
  const y = Math.round(t);
  const story = y === 0
    ? `Aujourd'hui, ${p.first_name} a <b>${keur(fin)}</b> d'épargne et met de côté <b>${eur(p.savings_month)}</b> par mois. Fais glisser le temps pour voir où mènent ces choix.`
    : retired
      ? `À ${Math.floor(age)} ans, ${p.first_name} est à la retraite. Son épargne lui verse <b>${eur(wd)}</b> par mois${owner ? ", et elle n'a plus de loyer à payer." : `, alors que le loyer reste de <b>${eur(p.rent_month)}</b>.`}`
      : `En ${year}, ${s.q === 0.5 ? "dans un scénario de marché médian" : `si les marchés rejouent la période ${s.replay}-${s.replay + 29}`}, ${p.first_name} aurait <b>${keur(net)}</b> de patrimoine net, en euros d'aujourd'hui.`;
  if ($("#story").dataset.k !== story) { $("#story").innerHTML = story; $("#story").dataset.k = story; }
  $("#t").style.setProperty("--p", (t / L.horizon) * 100 + "%");
  $$("#ticks button").forEach((b) => b.classList.toggle("on", Math.abs(+b.dataset.y - t) < 0.5));
}

/* ---------- leviers, objectif, jalons ---------- */
let sim = {}, simT;
function renderExtras() {
  const p = L.profile;
  $$(".lv").forEach((el) => { el.querySelector("b").textContent = Math.round(p[el.dataset.k]).toLocaleString("fr-FR") + el.dataset.u; el.classList.toggle("ch", el.dataset.k in sim); });
  $("#lv-act").classList.toggle("on", Object.keys(sim).length > 0);
  const g = L.goal, sc = L.score;
  if (sc) {
    const C = 2 * Math.PI * 22, col = sc.score >= 80 ? "var(--good)" : sc.score >= 60 ? "var(--acc)" : "var(--bad)";
    const sub = g && g.goal ? `${Math.round(g.prob * 100)} % de chances d'avoir ${eur(g.goal)} par mois à la retraite.${g.extra ? ` Il manque +${eur(g.extra)} d'épargne par mois.` : ""}` : sc.parts[0].text;
    $("#goal").innerHTML = `<div class="sc-ring"><svg viewBox="0 0 54 54"><circle cx="27" cy="27" r="22"/><circle class="arc" cx="27" cy="27" r="22" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - sc.score / 100)}" style="stroke:${col}"/></svg><b>${sc.score}</b></div><div><b>Score Orbit ${sc.score}/100</b> · ${sc.headline.toLowerCase()}<small>${sub}</small></div>`;
    $("#goal").title = "Voir le détail du Score Orbit";
    if (!Object.keys(sim).length) renderScore(sc);
  } else $("#goal").innerHTML = "";
  const rows = L.scenarios.mid.rows, ret = p.retire_age - L.age0, ms = [];
  if (p.buy?.enabled) ms.push({ y: p.buy.in_years, l: "Achat du logement", k: "buy" });
  let deb = rows.findIndex((r, i) => i > 0 && r.debt < 1 && rows[i - 1].debt >= 1);
  if (deb > 0) ms.push({ y: deb, l: "Crédit remboursé", k: "loan" });
  if (ret > 0 && ret < L.horizon) ms.push({ y: ret, l: "Retraite", k: "ret" });
  const out = rows.findIndex((r, i) => i > ret && r.fin < 1);
  if (out > 0) ms.push({ y: out, l: "Épargne épuisée", k: "out" });
  const y80 = 80 - L.age0; if (y80 > 0 && y80 < L.horizon) ms.push({ y: y80, l: "80 ans", k: "80" });
  $("#ms").innerHTML = ms.map((m) => `<button class="m-${m.k}" data-y="${m.y}" style="left:calc(11px + (100% - 22px) * ${m.y / L.horizon})"><i></i>${m.l}</button>`).join("");
}
function renderScore(sc) {
  const col = (v) => (v >= 0.8 ? "var(--good)" : v >= 0.5 ? "var(--acc)" : "var(--bad)");
  $("#sc-body").innerHTML = `<div class="sc-top"><div class="sc-big">${sc.score}<small>/100</small></div><div><b>${sc.label}</b><p>Le Score Orbit résume en un chiffre si ton avenir financier tient debout. Il est recalculé à chaque changement de ton profil, à partir des mêmes 30 séquences de marché que tes projections. Pour progresser : ${sc.advice}.</p></div></div>
    ${sc.parts.map((x) => `<div class="sc-row"><div class="sc-l"><span>${x.label}</span><b>${Math.round(x.pts)} / ${x.max}</b></div><div class="sc-bar"><i style="width:${(x.pts / x.max) * 100}%;background:${col(x.pts / x.max)}"></i></div><small>${x.text}</small></div>`).join("")}
    <p class="sc-note">Calcul déterministe, sans IA : objectif 40 points, précaution 20, coups durs 20, frais 20. Ce n'est ni une notation de crédit ni une prédiction.</p>`;
}
$("#goal").addEventListener("click", () => { if (!L.score) return; show("profil"); setTimeout(() => $("#score-x").scrollIntoView({ behavior: "smooth" }), 300); });
async function simulate() {
  const r = await fetch("/api/life/simulate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ set: sim }) });
  if (!r.ok) return;
  const keep = sim; L = await r.json(); sim = keep;
  drawChart(true); renderExtras();
  const svg = d3.select("#chart");
  svg.select(".band").transition().duration(400).attr("d", d3.area().x((d, i) => X(i)).y0((d) => Y(d[0])).y1((d) => Y(d[1])).curve(d3.curveMonotoneX)(L.band));
}
$("#levers").addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b || !L) return;
  if (b.id === "lv-save") { await fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sim) }); sim = {}; return dispatchEvent(new Event("orbit:profile")); }
  if (b.id === "lv-reset") { sim = {}; return load(); }
  const el = b.closest(".lv"), k = el.dataset.k;
  sim[k] = Math.min(+el.dataset.max, Math.max(+el.dataset.min, L.profile[k] + b.dataset.d * el.dataset.step));
  L.profile[k] = sim[k]; renderExtras();
  clearTimeout(simT); simT = setTimeout(simulate, 220);
});
$("#ms").addEventListener("click", (e) => {
  const b = e.target.closest("[data-y]"); if (!b) return;
  const y = +b.dataset.y, r = L.scenarios.mid.rows[y], p = L.profile, age = L.age0 + y;
  go(y);
  const desc = {
    buy: `Apport de ${eur(p.buy.down)}, crédit sur ${p.buy.years} ans à ${String(p.buy.rate).replace(".", ",")} %. Le loyer s'arrête, la mensualité commence.`,
    loan: `Plus de mensualité : ce budget peut être épargné ou dépensé. Le logement vaut ${keur(r.home)}.`,
    ret: `L'épargne commence à verser ${eur(L.scenarios.mid.rows[Math.min(y + 1, L.horizon)].withdraw)} par mois en complément de la pension.`,
    out: `Dans le scénario médian, l'épargne financière est entièrement consommée à ${age} ans. Épargner un peu plus ou partir plus tard repousse ce moment.`,
    80: `Patrimoine net médian : ${keur(r.net)}, dont ${keur(r.fin)} d'épargne financière.`,
  }[b.className.replace("m-", "")];
  $("#ms-card").innerHTML = `<button class="x">×</button><div class="lv-t">${L.start_year + y} · ${age} ans</div><b>${b.textContent}</b><p>${desc}</p><div class="mc-n"><span>Patrimoine net médian</span><strong>${keur(r.net)}</strong></div>`;
  $("#ms-card").classList.add("on");
});
$("#ms-card").addEventListener("click", (e) => e.target.closest(".x") && $("#ms-card").classList.remove("on"));

/* ---------- aujourd'hui pour toi ---------- */
let mini;
async function today() {
  const r = await fetch("/api/today"); if (!r.ok) return;
  const d = await r.json();
  $("#td-list").innerHTML = d.items.map((i) => `<div class="td"><span>${i.label}<small>${i.src}</small></span><b>${i.value}</b>${i.effect != null ? `<em class="${i.effect < 0 ? "dn" : "up"}">${i.effect < 0 ? "−" : "+"}${eur(Math.abs(i.effect))} ${i.note}</em>` : `<em>${i.note}</em>`}</div>`).join("");
  if (!window.Globe) return;
  mini = mini || Globe()($("#mini-globe")).width($("#mini-globe").clientWidth || 96).height($("#mini-globe").clientWidth || 96).backgroundColor("rgba(0,0,0,0)").showAtmosphere(false).showGlobe(false)
    .hexPolygonResolution(2).hexPolygonMargin(0.35).hexPolygonColor(() => "rgba(170,190,230,.55)")
    .pointAltitude(0.02).pointRadius(2.4).pointColor((p) => (p.chg >= 0 ? "#7fd1a8" : "#ff9f6b"))
    .ringColor((p) => () => (p.chg >= 0 ? "rgba(127,209,168,.6)" : "rgba(255,159,107,.6)")).ringMaxRadius(6).ringPropagationSpeed(2).ringRepeatPeriod(1600);
  mini.pointsData(d.points).ringsData(d.points).pointOfView({ lat: 35, lng: 10, altitude: 2.2 });
  mini.controls().autoRotate = true; mini.controls().autoRotateSpeed = 0.6; mini.controls().enableZoom = false;
  fetch("/static/img/countries-110m.json").then((x) => x.json()).then((topo) => mini.hexPolygonsData(topojson.feature(topo, topo.objects.countries).features.filter((f) => f.properties.name !== "Antarctica")));
}
today();

/* ---------- avatar ---------- */
const canvas = $("#avatar");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
camera.position.set(0, 1.05, 5.2);
camera.lookAt(0, 0.92, 0);
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x101018, 1.2));
const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(2, 4, 3); scene.add(key);

const uni = { rim: { value: new THREE.Color(0xbcd4ff) }, alpha: { value: 0.07 } };
function holo(color, base, rimPow) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.1, transparent: true, depthWrite: false, side: THREE.FrontSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.rimColor = uni.rim; sh.uniforms.baseAlpha = { value: base };
    sh.fragmentShader = "uniform vec3 rimColor; uniform float baseAlpha;\n" + sh.fragmentShader.replace("#include <dithering_fragment>",
      `float fr = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), ${rimPow.toFixed(1)});
       gl_FragColor.rgb = gl_FragColor.rgb * 0.35 + rimColor * fr * 1.25;
       gl_FragColor.a = clamp(baseAlpha + fr * 0.85, 0.0, 1.0);
       #include <dithering_fragment>`);
  };
  return m;
}
const bodyMat = holo(0x2a3140, 0.06, 2.2), jointMat = holo(0x8ab4ff, 0.18, 1.4);
const floor = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.44, 96), new THREE.MeshBasicMaterial({ color: 0x8ab4ff, transparent: true, opacity: 0.35 }));
floor.rotation.x = -Math.PI / 2; scene.add(floor);
const glow = new THREE.Mesh(new THREE.CircleGeometry(0.9, 64), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false,
  map: (() => { const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d"); const r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, "rgba(138,180,255,.35)"); r.addColorStop(1, "rgba(138,180,255,0)"); g.fillStyle = r; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })() }));
glow.rotation.x = -Math.PI / 2; glow.position.y = 0.001; scene.add(glow);

const hairMat = new THREE.MeshStandardMaterial({ color: 0x3b2a20, roughness: 0.9, transparent: true, opacity: 0.55, depthWrite: false });
const hair = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.42), hairMat);
scene.add(hair);
let model, mixer, bones = {}, idle, run, walk, sad, drag = 0, dragging = null, phase = 0;
const sm = (a, b, x) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/* chemin lumineux qui défile sous les pas */
const path = new THREE.Group(); scene.add(path);
const N_DOT = 150, dots = new Float32Array(N_DOT * 3), dcol = new Float32Array(N_DOT * 3), base = [];
for (let i = 0; i < N_DOT; i++) { const row = i % 3; base.push([(row - 1) * 0.32, (Math.floor(i / 3) / (N_DOT / 3)) * 12 - 6]); }
const dotGeo = new THREE.BufferGeometry();
dotGeo.setAttribute("position", new THREE.BufferAttribute(dots, 3)); dotGeo.setAttribute("color", new THREE.BufferAttribute(dcol, 3));
const dotTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 32; const g = c.getContext("2d"); const r = g.createRadialGradient(16, 16, 0, 16, 16, 16); r.addColorStop(0, "#fff"); r.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); })();
path.add(new THREE.Points(dotGeo, new THREE.PointsMaterial({ size: 0.05, map: dotTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
let pathOff = 0;
/* canne */
const caneMat = holo(0xc9b28a, 0.35, 1.2);
const cane = new THREE.Group();
const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.013, 1, 12), caneMat); shaft.position.y = 0.5; cane.add(shaft);
const crook = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.011, 8, 24, Math.PI), caneMat); crook.position.set(0.045, 1, 0); cane.add(crook);
cane.visible = false; scene.add(cane);
new GLTFLoader().load("/static/vendor/xbot.glb", (g) => {
  model = g.scene;
  model.traverse((o) => {
    if (o.isBone) bones[o.name.replace("mixamorig", "").replace(":", "")] = o;
    if (o.isMesh) { o.material = o.name.includes("Joints") || o.material.name.includes("Joints") ? jointMat : bodyMat; o.renderOrder = o.material === jointMat ? 1 : 2; o.frustumCulled = false; }
  });
  scene.add(model);
  mixer = new THREE.AnimationMixer(model);
  const clip = (n) => g.animations.find((a) => a.name === n);
  [idle, run, walk] = ["idle", "run", "walk"].map((n) => { const a = mixer.clipAction(clip(n)); a.play(); a.timeScale = 0; a.setEffectiveWeight(0); return a; });
  idle.timeScale = 1;
  const sadClip = clip("sad_pose");
  THREE.AnimationUtils.makeClipAdditive(sadClip);
  sad = mixer.clipAction(THREE.AnimationUtils.subclip(sadClip, "sad", 2, 3, 30));
  sad.blendMode = THREE.AdditiveAnimationBlendMode; sad.setEffectiveWeight(0); sad.play();
  $("#av-load").remove();
  window.orbitAvatarReady = true; dispatchEvent(new Event("orbit:avatar"));
  gsap.from(uni.alpha, { value: 0, duration: 1.2 });
  gsap.from(model.position, { y: -0.15, duration: 1.4, ease: "power3.out" });
});
canvas.addEventListener("pointerdown", (e) => (dragging = e.clientX));
addEventListener("pointerup", () => (dragging = null));
addEventListener("pointermove", (e) => { if (dragging !== null) { drag += (e.clientX - dragging) * 0.01; dragging = e.clientX; } });

function resize() {
  const r = canvas.getBoundingClientRect(); if (!r.width) return;
  renderer.setSize(r.width, r.height, false); camera.aspect = r.width / r.height; camera.updateProjectionMatrix();
}
addEventListener("resize", () => { resize(); if (L) drawChart(); });

const cGood = new THREE.Color(0xbcd4ff), cBad = new THREE.Color(0xffb38a), young = new THREE.Color(0x3b2a20), grey = new THREE.Color(0x8d8d8d), white = new THREE.Color(0xe9e9e9);
const vA = new THREE.Vector3(), vB = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
let tension = 0;
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  if (L) {
    cur += (target - cur) * Math.min(1, dt * 7);
    if (Math.abs(target - cur) < 0.002) cur = target;
    updatePanel(cur);
  }
  if (model && L) {
    const age = L.age0 + cur, a = THREE.MathUtils.clamp((age - 35) / 55, 0, 1), ae = a * a * (3 - 2 * a);
    const mid = L.scenarios.mid.rows, i = Math.min(Math.floor(cur), mid.length - 1);
    const rel = mid[i].net > 0 ? at("net", cur) / mid[i].net : 1;
    const tTarget = THREE.MathUtils.clamp((1 - rel) * 2.2, 0, 1) * (0.35 + 0.65 * ae);
    tension += (tTarget - tension) * dt * 2;
    /* allure : course → marche → pas courts avec canne */
    const runW = 1 - sm(40, 52, age), damp = 0.5 * sm(72, 95, age), slow = 1 - 0.55 * sm(52, 92, age);
    const rd = run.getClip().duration, wd = walk.getClip().duration;
    phase = (phase + dt * (runW / rd + (1 - runW) * slow / wd)) % 1;
    run.time = phase * rd; walk.time = phase * wd;
    run.setEffectiveWeight(runW * (1 - damp)); walk.setEffectiveWeight((1 - runW) * (1 - damp)); idle.setEffectiveWeight(damp);
    sad.setEffectiveWeight(tension * 0.85);
    mixer.update(dt);
    const old = sm(60, 95, age);
    ["Spine", "Spine1", "Spine2"].forEach((n) => (bones[n].rotation.x += ae * 0.1 + old * 0.12));
    bones.Neck.rotation.x += ae * 0.14 + old * 0.12; bones.Head.rotation.x -= ae * 0.06;
    bones.LeftArm.rotation.z += ae * 0.06; bones.RightArm.rotation.z -= ae * 0.06;
    bones.LeftUpLeg.rotation.x -= old * 0.12; bones.RightUpLeg.rotation.x -= old * 0.12;
    bones.LeftLeg.rotation.x += old * 0.2; bones.RightLeg.rotation.x += old * 0.2;
    const trem = sm(80, 95, age) * 0.012;
    bones.Head.rotation.y += Math.sin(clock.elapsedTime * 23) * trem; bones.RightHand.rotation.z += Math.sin(clock.elapsedTime * 19) * trem * 1.5;
    model.scale.setScalar(1 - 0.06 * ae);
    model.position.y = -old * 0.035;
    const yaw = 0.95 + drag;
    model.rotation.y = yaw; path.rotation.y = yaw;
    const speed = runW * 2.6 + (1 - runW) * 1.15 * slow;
    pathOff = (pathOff + dt * speed * (1 - damp * 0.6)) % 12;
    for (let k = 0; k < N_DOT; k++) {
      let z = base[k][1] - pathOff; if (z < -6) z += 12;
      dots[k * 3] = base[k][0]; dots[k * 3 + 1] = 0.004; dots[k * 3 + 2] = z;
      const f = Math.max(0, 1 - Math.abs(z) / 6) ** 1.6;
      dcol[k * 3] = uni.rim.value.r * f; dcol[k * 3 + 1] = uni.rim.value.g * f; dcol[k * 3 + 2] = uni.rim.value.b * f;
    }
    dotGeo.attributes.position.needsUpdate = dotGeo.attributes.color.needsUpdate = true;
    uni.rim.value.copy(cGood).lerp(cBad, tension * 0.9);
    floor.material.color.copy(uni.rim.value);
    model.updateMatrixWorld(true);
    bones.Head.getWorldPosition(vA); bones.HeadTop_End.getWorldPosition(vB);
    const d = vB.clone().sub(vA), len = d.length();
    hair.position.copy(vA).addScaledVector(d, 0.42);
    hair.quaternion.setFromUnitVectors(up, d.normalize());
    hair.scale.set(len * 0.62, len * 0.62, len * 0.68);
    const h = THREE.MathUtils.clamp((age - 42) / 30, 0, 1);
    hairMat.color.copy(young).lerp(grey, Math.min(1, h * 1.6)).lerp(white, Math.max(0, h * 1.6 - 0.6) / 1);
    hairMat.opacity = 0.5 - 0.12 * ae;
    const caneW = sm(78, 82, age);
    cane.visible = caneW > 0.01;
    if (cane.visible) {
      bones.RightHand.getWorldPosition(vA);
      const fw = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      vB.set(vA.x, 0, vA.z).addScaledVector(fw, 0.1);
      const dir = vA.clone().sub(vB), L2 = dir.length();
      cane.position.copy(vB); cane.quaternion.setFromUnitVectors(up, dir.normalize()); cane.scale.set(1, L2, 1);
      crook.scale.set(1, 1 / L2, 1);
      caneMat.opacity = caneW;
      cane.traverse((o) => o.material && (o.material.visible = caneW > 0.05));
    }
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
resize(); me(); load(); frame();
