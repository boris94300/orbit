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
  L = await r.json();
  target = Math.min(target, L.horizon); cur = Math.min(cur, L.horizon);
  const p = L.profile;
  $("#t").max = L.horizon;
  const ret = p.retire_age - L.age0;
  const marks = [0, 10, 20, 30, 40, 50, 60].filter((y) => y <= L.horizon);
  $("#ticks").innerHTML = marks.map((y) => `<button data-y="${y}" style="left:${(y / L.horizon) * 100}%">${y ? "+" + y + " ans" : "Aujourd'hui"}<small>${L.age0 + y} ans</small></button>`).join("") +
    (ret > 0 && ret < L.horizon ? `<button class="ret" data-y="${ret}" style="left:${(ret / L.horizon) * 100}%;top:-38px">Retraite</button>` : "");
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
  if (!anim) {
    const p = svg.select(".ln-mid").node(), len = p.getTotalLength();
    d3.select(p).attr("stroke-dasharray", len).attr("stroke-dashoffset", len).transition().duration(1600).ease(d3.easeCubicOut).attr("stroke-dashoffset", 0).on("end", () => d3.select(p).attr("stroke-dasharray", null));
  }
}

/* ---------- panneau ---------- */
let lastTxt = "";
function updatePanel(t) {
  const p = L.profile, age = L.age0 + t, year = Math.floor(L.start_year + t);
  const net = at("net", t), fin = at("fin", t), home = at("home", t), debt = at("debt", t), wd = at("withdraw", t);
  $("#age").textContent = Math.floor(age);
  $("#yr").textContent = year;
  $("#net").textContent = eur(net);
  $("#when").textContent = t < 0.5 ? "Aujourd'hui" : `Dans ${Math.round(t)} an${Math.round(t) > 1 ? "s" : ""}`;
  gMark?.attr("transform", `translate(${X(t)},0)`).select("circle").attr("cy", Y(net));
  const s = L.scenarios[sc];
  $("#replay").textContent = s.q === 0.5 ? `Médiane de ${L.n_paths} séquences de marché réelles (1996-2025) rejouées à partir d'aujourd'hui` : `${s.q < 0.5 ? "Seules 10 %" : "Seules 10 %"} des ${L.n_paths} séquences historiques font ${s.q < 0.5 ? "moins bien" : "mieux"} · proche des marchés de ${s.replay} à ${s.replay + 29}`;
  const retired = age >= p.retire_age, owner = home > 1;
  const txt = [
    ["Épargne financière", keur(fin), retired ? "en cours de retrait" : `${eur(p.savings_month)} par mois`],
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
let model, mixer, bones = {}, idle, sad, sway = 0, drag = 0, dragging = null;
new GLTFLoader().load("/static/vendor/xbot.glb", (g) => {
  model = g.scene;
  model.traverse((o) => {
    if (o.isBone) bones[o.name.replace("mixamorig", "").replace(":", "")] = o;
    if (o.isMesh) { o.material = o.name.includes("Joints") || o.material.name.includes("Joints") ? jointMat : bodyMat; o.renderOrder = o.material === jointMat ? 1 : 2; o.frustumCulled = false; }
  });
  scene.add(model);
  mixer = new THREE.AnimationMixer(model);
  const clip = (n) => g.animations.find((a) => a.name === n);
  idle = mixer.clipAction(clip("idle")); idle.play();
  const sadClip = clip("sad_pose");
  THREE.AnimationUtils.makeClipAdditive(sadClip);
  sad = mixer.clipAction(THREE.AnimationUtils.subclip(sadClip, "sad", 2, 3, 30));
  sad.blendMode = THREE.AdditiveAnimationBlendMode; sad.setEffectiveWeight(0); sad.play();
  $("#av-load").remove();
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
    idle.timeScale = 1 - 0.45 * ae;
    sad.setEffectiveWeight(tension * 0.85);
    mixer.update(dt);
    ["Spine", "Spine1", "Spine2"].forEach((n) => (bones[n].rotation.x += ae * 0.11));
    bones.Neck.rotation.x += ae * 0.16; bones.Head.rotation.x -= ae * 0.05;
    bones.LeftArm.rotation.z += ae * 0.06; bones.RightArm.rotation.z -= ae * 0.06;
    model.scale.setScalar(1 - 0.035 * ae);
    sway += dt;
    model.rotation.y = Math.sin(sway * 0.25) * 0.28 + drag;
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
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
resize(); me(); load(); frame();
