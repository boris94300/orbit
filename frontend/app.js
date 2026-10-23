(() => {
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const nf = (d) => new Intl.NumberFormat("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmt = (v, d = 2) => (v == null || isNaN(v) ? "—" : nf(d).format(v));
const sign = (v, d = 2) => (v > 0 ? "+" : v < 0 ? "−" : "") + fmt(Math.abs(v), d);
const cls = (v) => (v > 0.005 ? "up" : v < -0.005 ? "down" : "flat");
const hhmm = (ms) => new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const ago = (ms) => {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `il y a ${h} h` : new Date(ms).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
};
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const NAT_FR = { "Wildfires": "Feu de forêt", "Severe Storms": "Tempête", "Volcanoes": "Volcan", "Sea and Lake Ice": "Glace de mer",
  "Floods": "Inondation", "Drought": "Sécheresse", "Earthquakes": "Séisme", "Landslides": "Glissement de terrain", "Dust and Haze": "Brume de poussière" };
const COL = { up: "#3fb27f", down: "#e5534b", quake: "#d4a24c", nat: "#c9783e", news: "#8fa8c8", acc: "#5b9cf0" };

let state = {}, prev = {}, globe, filter = "all", selected = null;

/* ---------- globe ---------- */
function plainTexture() {
  const c = document.createElement("canvas"); c.width = 16; c.height = 8;
  const g = c.getContext("2d"); g.fillStyle = "#0f1419"; g.fillRect(0, 0, 16, 8);
  return c.toDataURL();
}
async function initGlobe() {
  const el = $("#globe");
  globe = Globe()(el)
    .backgroundColor("rgba(0,0,0,0)")
    .globeImageUrl(plainTexture())
    .showAtmosphere(true).atmosphereColor("#4a7bb7").atmosphereAltitude(0.13)
    .hexPolygonResolution(3).hexPolygonMargin(0.42).hexPolygonUseDots(true)
    .hexPolygonColor(() => "rgba(150,170,195,0.38)")
    .pointLat("lat").pointLng("lng").pointAltitude((d) => d.alt).pointRadius((d) => d.r).pointColor((d) => d.color)
    .pointResolution(10).pointsMerge(false).pointLabel((d) => d.tip)
    .onPointClick((d) => d.ev && selectEvent(d.ev.id, true))
    .labelLat("lat").labelLng("lng").labelText("text").labelSize(0.45).labelDotRadius(0)
    .labelColor((d) => d.color).labelResolution(2).labelAltitude(0.012)
    .ringLat("lat").ringLng("lng").ringColor((d) => (t) => hexA(d.color, 1 - t))
    .ringMaxRadius((d) => d.max).ringPropagationSpeed((d) => d.speed).ringRepeatPeriod((d) => d.period);
  globe.pointOfView({ lat: 38, lng: 8, altitude: 2.3 }, 0);
  const ctr = globe.controls();
  ctr.autoRotate = true; ctr.autoRotateSpeed = 0.32; ctr.enableZoom = true; ctr.minDistance = 160; ctr.maxDistance = 700;
  el.addEventListener("pointerdown", () => { ctr.autoRotate = false; clearTimeout(initGlobe.t); initGlobe.t = setTimeout(() => (ctr.autoRotate = true), 9000); });
  try {
    const topo = await fetch("/static/img/countries-110m.json").then((r) => r.json());
    globe.hexPolygonsData(topojson.feature(topo, topo.objects.countries).features.filter((f) => f.properties.name !== "Antarctica"));
  } catch (e) { console.warn("pays indisponibles", e); }
  sizeGlobe();
  window.addEventListener("resize", sizeGlobe);
}
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${Math.max(0, a).toFixed(3)})`;
}
function globeRect(view) {
  const m = $("#main").getBoundingClientRect();
  if (view === "monde") {
    const l = 300, r = 360;
    return { left: l, top: 0, width: m.width - l - r, height: m.height };
  }
  return { left: m.width - 236, top: m.height - 236, width: 220, height: 220 };
}
function sizeGlobe(animate = false, view = currentView()) {
  const w = $("#globe-wrap"), r = globeRect(view);
  if (animate) {
    gsap.to(w, { ...px(r), duration: 0.5, ease: "power3.inOut", onUpdate: () => globe.width(w.offsetWidth).height(w.offsetHeight) });
  } else { Object.assign(w.style, pxs(r)); globe.width(r.width).height(r.height); }
}
const px = (r) => ({ left: r.left, top: r.top, width: r.width, height: r.height });
const pxs = (r) => ({ left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });

function renderGlobe() {
  const pts = [], labels = [], rings = [];
  for (const m of data("markets") || []) {
    const c = m.change >= 0 ? COL.up : COL.down;
    pts.push({ lat: m.lat, lng: m.lng, r: 0.42, alt: 0.01 + Math.min(Math.abs(m.change), 4) * 0.035, color: c,
      tip: `<div class="gt">${esc(m.name)} · ${esc(m.city)}<small>${fmt(m.price)} · ${sign(m.change)} %</small></div>`, ev: { id: "mk-" + m.symbol } });
    labels.push({ lat: m.lat, lng: m.lng + 1.2, text: `${m.name} ${sign(m.change, 1)}%`, color: hexA(c, 0.9) });
  }
  for (const q of data("quakes") || []) {
    pts.push({ lat: q.lat, lng: q.lng, r: 0.12 + (q.mag - 4.5) * 0.12, alt: 0.004, color: COL.quake,
      tip: `<div class="gt">Séisme M${fmt(q.mag, 1)}<small>${esc(q.place)} · ${ago(q.time)}</small></div>`, ev: { id: "q-" + q.id } });
    if (Date.now() - q.time < 36e5 * 24 && q.mag >= 5) rings.push({ lat: q.lat, lng: q.lng, color: COL.quake, max: 2 + q.mag - 5, speed: 1.6, period: 2400 });
  }
  for (const n of data("natural") || []) {
    pts.push({ lat: n.lat, lng: n.lng, r: 0.16, alt: 0.004, color: COL.nat,
      tip: `<div class="gt">${esc(NAT_FR[n.category] || n.category)}<small>${esc(n.title)}</small></div>`, ev: { id: "n-" + n.id } });
  }
  const seen = new Set();
  for (const a of (data("news") || []).slice(0, 18)) {
    const k = a.place; if (seen.has(k)) continue; seen.add(k);
    rings.push({ lat: a.lat, lng: a.lng, color: COL.news, max: 3.2, speed: 1.1, period: 3800 });
  }
  if (selected) {
    const e = events().find((x) => x.id === selected);
    if (e) rings.push({ lat: e.lat, lng: e.lng, color: "#ffffff", max: 5, speed: 3, period: 1100 });
  }
  globe.pointsData(pts).labelsData(labels).ringsData(rings);
}

/* ---------- data ---------- */
const data = (k) => state[k]?.data;
async function load(names) {
  const url = names ? `/api/feeds/${names}` : "/api/feeds";
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.status);
  const j = await r.json();
  if (names) state[names] = j; else state = j;
}
function srcTag(...keys) {
  const f = keys.map((k) => state[k]).filter(Boolean);
  if (!f.length) return "";
  const worst = f.find((x) => x.status !== "live");
  const ts = Math.max(...f.map((x) => x.ts || 0)) * 1000;
  const label = worst ? (worst.status === "secours" ? "instantané" : worst.status) : hhmm(ts);
  return `<span class="st-${worst ? worst.status : "live"}" title="${esc(f.map((x) => x.source).join(" · "))}">${esc(f[0].source.split(" ")[0])} · ${label}</span>`;
}
function spark(arr, up) {
  if (!arr || arr.length < 2) return "<svg></svg>";
  const min = Math.min(...arr), max = Math.max(...arr), w = 64, h = 20, rng = max - min || 1;
  const d = arr.map((v, i) => `${(i / (arr.length - 1)) * w},${h - 2 - ((v - min) / rng) * (h - 4)}`).join(" ");
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${d}" fill="none" stroke="${up ? COL.up : COL.down}" stroke-width="1.2" vector-effect="non-scaling-stroke"/></svg>`;
}
function tween(el, to, d) {
  const from = parseFloat(el.dataset.v);
  el.dataset.v = to;
  if (isNaN(from) || from === to) { el.textContent = fmt(to, d); return; }
  const o = { v: from };
  gsap.to(o, { v: to, duration: 0.6, ease: "power2.out", onUpdate: () => (el.textContent = fmt(o.v, d)) });
  const row = el.closest(".row, .tk");
  if (row) { row.classList.remove("flash-up", "flash-down"); void row.offsetWidth; row.classList.add(to > from ? "flash-up" : "flash-down"); }
}

function renderMarkets() {
  const box = $("#markets"), ms = data("markets") || [];
  if (!ms.length) { box.innerHTML = `<div class="empty">Flux marchés indisponible.</div>`; return; }
  if (box.children.length !== ms.length || box.querySelector(".empty")) {
    box.innerHTML = ms.map((m) => `<div class="row click" data-ev="mk-${m.symbol}"><div class="n">${esc(m.name)}<small>${esc(m.city)}</small></div><div class="sp"></div><div><div class="v" data-k="p"></div><div class="c" data-k="c"></div></div></div>`).join("");
  }
  ms.forEach((m, i) => {
    const row = box.children[i];
    tween($('[data-k="p"]', row), m.price, 2);
    const c = $('[data-k="c"]', row); c.className = "c " + cls(m.change); c.textContent = sign(m.change) + " %";
    $(".sp", row).innerHTML = spark(m.spark, m.change >= 0);
  });
  $("#src-markets").innerHTML = srcTag("markets");
}
function renderRates() {
  const rs = data("rates") || [];
  $("#rates").innerHTML = rs.length ? rs.map((r) => {
    const dlt = r.prev == null ? null : r.value - r.prev;
    const date = r.date.length === 7 ? new Date(r.date + "-01").toLocaleDateString("fr-FR", { month: "short", year: "numeric" }) : new Date(r.date).toLocaleDateString("fr-FR");
    return `<div class="row r2"><div class="n">${esc(r.label)}<small>${esc(r.src)} · ${date}</small></div><div><div class="v">${fmt(r.value, r.id === "estr" ? 3 : 2)} %</div><div class="c ${dlt == null ? "flat" : cls(dlt)}">${dlt == null ? "" : sign(dlt, 2) + " pt"}</div></div></div>`;
  }).join("") : `<div class="empty">Flux macro indisponible.</div>`;
  $("#src-rates").innerHTML = srcTag("rates");
}
function renderCommodities() {
  const cs = data("commodities") || [], fx = data("fx"), cr = data("crypto") || [];
  let h = cs.map((c) => `<div class="row"><div class="n">${esc(c.name)}<small>${esc(c.unit)}</small></div><div>${spark(c.spark, c.change >= 0)}</div><div><div class="v">${fmt(c.price, c.unit === "%" ? 3 : 2)}</div><div class="c ${cls(c.change)}">${sign(c.change)} %</div></div></div>`).join("");
  if (fx) h += ["USD", "GBP", "CHF", "JPY"].map((k) => `<div class="row"><div class="n">EUR/${k}<small>BCE · ${new Date(fx.date).toLocaleDateString("fr-FR")}</small></div><div></div><div><div class="v">${fmt(fx.rates[k], k === "JPY" ? 2 : 4)}</div></div></div>`).join("");
  h += cr.map((c) => `<div class="row" data-pair="${c.pair}"><div class="n">${c.pair}<small>Kraken · 24 h</small></div><div></div><div><div class="v" data-k="p"></div><div class="c ${cls(c.change)}">${sign(c.change)} %</div></div></div>`).join("");
  const box = $("#commodities"), old = Object.fromEntries($$("[data-pair]", box).map((r) => [r.dataset.pair, $('[data-k="p"]', r).dataset.v]));
  box.innerHTML = h || `<div class="empty">Flux indisponibles.</div>`;
  cr.forEach((c) => { const el = $(`[data-pair="${c.pair}"] [data-k="p"]`, box); if (old[c.pair]) el.dataset.v = old[c.pair]; tween(el, c.price, 0); });
  $("#src-cmd").innerHTML = srcTag("commodities", "fx", "crypto");
}
function renderTicker() {
  const items = [];
  for (const m of data("markets") || []) items.push(`<span class="tk"><b>${esc(m.name)}</b>${fmt(m.price)}<span class="${cls(m.change)}">${sign(m.change)}%</span></span>`);
  for (const c of data("crypto") || []) items.push(`<span class="tk"><b>${c.pair}</b>${fmt(c.price, 0)}<span class="${cls(c.change)}">${sign(c.change)}%</span></span>`);
  const fx = data("fx"); if (fx) items.push(`<span class="tk"><b>EUR/USD</b>${fmt(fx.rates.USD, 4)}</span>`);
  for (const r of (data("rates") || []).slice(0, 2)) items.push(`<span class="tk"><b>${esc(r.id === "dfr" ? "BCE dépôt" : "€STR")}</b>${fmt(r.value, r.id === "estr" ? 3 : 2)}%</span>`);
  for (const c of data("commodities") || []) items.push(`<span class="tk"><b>${esc(c.name)}</b>${fmt(c.price)}<span class="${cls(c.change)}">${sign(c.change)}%</span></span>`);
  const t = $("#ticker"), html = items.join("");
  if (t.dataset.h === html) return;
  t.dataset.h = html; t.innerHTML = html + html;
  gsap.killTweensOf(t); gsap.set(t, { x: 0 });
  gsap.to(t, { x: -t.scrollWidth / 2, duration: t.scrollWidth / 90, ease: "none", repeat: -1 });
}
function renderStatus() {
  const fs = Object.values(state), live = fs.filter((f) => f.status === "live").length;
  const el = $("#feeds-status");
  el.className = "feeds-status" + (live < fs.length ? " degraded" : "");
  el.innerHTML = `<i></i>${live}/${fs.length} flux en direct`;
  el.title = Object.entries(state).map(([k, f]) => `${f.source} : ${f.status}`).join("\n");
}

/* ---------- events ---------- */
function events() {
  const ev = [];
  for (const m of data("markets") || []) if (Math.abs(m.change) >= 0.8)
    ev.push({ id: "mk-" + m.symbol, kind: "marche", t: `${m.name} ${sign(m.change)} % sur la séance`, sub: `${m.city} · ${fmt(m.price)} pts`, time: (m.time || 0) * 1000, lat: m.lat, lng: m.lng, src: "Yahoo Finance" });
  for (const r of data("rates") || []) if (r.prev != null && Math.abs(r.value - r.prev) >= 0.1 && ["dfr", "infl_fr", "infl_ea"].includes(r.id))
    ev.push({ id: "r-" + r.id, kind: "marche", t: `${r.label} : ${fmt(r.value, 2)} % (${sign(r.value - r.prev, 2)} pt)`, sub: `Publication ${r.date}`, time: Date.parse(r.date), lat: 50.11, lng: 8.68, src: r.src });
  for (const a of data("news") || [])
    ev.push({ id: "nw-" + a.url, kind: "news", t: a.title, sub: a.place, time: (a.time || 0) * 1000, lat: a.lat, lng: a.lng, src: a.source, url: a.url });
  for (const q of data("quakes") || []) if (q.mag >= 5)
    ev.push({ id: "q-" + q.id, kind: "quake", t: `Séisme M${fmt(q.mag, 1)}${q.tsunami ? " · alerte tsunami" : ""}`, sub: q.place, time: q.time, lat: q.lat, lng: q.lng, src: "USGS" });
  for (const n of data("natural") || [])
    ev.push({ id: "n-" + n.id, kind: "nat", t: n.title, sub: NAT_FR[n.category] || n.category, time: Date.parse(n.date), lat: n.lat, lng: n.lng, src: "NASA EONET" });
  return ev.sort((a, b) => b.time - a.time);
}
function renderEvents() {
  const all = events(), list = all.filter((e) => filter === "all" || e.kind === filter).slice(0, 80);
  $("#ev-count").textContent = `${list.length} / ${all.length}`;
  const box = $("#events"), known = new Set($$(".ev", box).map((e) => e.dataset.id));
  box.innerHTML = list.length ? list.map((e) => `<div class="ev k-${e.kind}${e.id === selected ? " sel" : ""}" data-id="${esc(e.id)}"><div class="bar"></div><div><div class="meta"><span>${esc(e.src)}</span><span>${e.time ? ago(e.time) : ""}</span></div><div class="t">${esc(e.t)}</div><div class="sub">${esc(e.sub || "")}</div></div></div>`).join("") : `<div class="empty">Aucun événement pour ce filtre.</div>`;
  if (known.size) {
    const fresh = $$(".ev", box).filter((e) => !known.has(e.dataset.id));
    if (fresh.length) gsap.from(fresh, { opacity: 0, x: 12, duration: 0.35, stagger: 0.04, ease: "power2.out" });
  }
}
function selectEvent(id, scroll) {
  const e = events().find((x) => x.id === id);
  if (!e) return;
  selected = id;
  globe.controls().autoRotate = false;
  globe.pointOfView({ lat: e.lat, lng: e.lng, altitude: 1.5 }, 1100);
  clearTimeout(initGlobe.t); initGlobe.t = setTimeout(() => (globe.controls().autoRotate = true), 12000);
  $$(".ev").forEach((x) => x.classList.toggle("sel", x.dataset.id === id));
  if (scroll) $(`.ev[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  renderGlobe();
}

/* ---------- navigation ---------- */
const currentView = () => $(".rail-btn.active")?.dataset.view || "monde";
function go(view) {
  if (view === currentView()) return;
  const from = $(".view.active"), to = $("#view-" + view);
  $$(".rail-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  gsap.to(from, { opacity: 0, y: 6, duration: 0.15, ease: "power1.in", onComplete: () => {
    from.classList.remove("active"); gsap.set(from, { clearProps: "all" });
    to.classList.add("active");
    gsap.fromTo(to, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.28, ease: "power2.out", clearProps: "all" });
  } });
  $("#globe-wrap").classList.toggle("mini", view !== "monde");
  sizeGlobe(true, view);
  globe.pointOfView({ altitude: view === "monde" ? 2.3 : 2.6 }, 500);
}

/* ---------- boot ---------- */
async function boot() {
  const lines = $("#boot-lines");
  const say = (txt, st) => { const d = document.createElement("div"); d.innerHTML = txt + (st ? ` <span class="${st === "ok" ? "ok" : "ko"}">${st}</span>` : ""); lines.appendChild(d); gsap.from(d, { opacity: 0, x: -6, duration: 0.2 }); return d; };
  say("Initialisation du globe");
  const g = initGlobe();
  say("Connexion aux flux : BCE, Eurostat, Yahoo, Kraken, USGS, NASA, presse");
  let ok = true;
  try { await load(); } catch { ok = false; }
  await g;
  if (ok) for (const [k, f] of Object.entries(state)) say(`  ${f.source.padEnd(28, "\u00a0")}`, f.status === "live" ? "ok" : f.status);
  else say("Serveur injoignable", "erreur");
  renderAll();
  await new Promise((r) => setTimeout(r, 450));
  gsap.to("#boot", { opacity: 0, duration: 0.45, ease: "power2.out", onComplete: () => $("#boot").remove() });
  gsap.from(".panel.left .row", { opacity: 0, x: -8, duration: 0.3, stagger: 0.015, delay: 0.15 });
  gsap.from(".ev", { opacity: 0, x: 8, duration: 0.3, stagger: 0.02, delay: 0.25 });
  gsap.from("#globe-wrap", { opacity: 0, scale: 0.94, duration: 0.9, ease: "power2.out" });
}
function renderAll() {
  renderMarkets(); renderRates(); renderCommodities(); renderTicker(); renderStatus(); renderEvents(); renderGlobe();
}

$$(".rail-btn").forEach((b) => b.addEventListener("click", () => go(b.dataset.view)));
$("#globe-wrap").addEventListener("click", () => { if (currentView() !== "monde") go("monde"); });
$("#filters").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  filter = b.dataset.f; $$("#filters button").forEach((x) => x.classList.toggle("on", x === b)); renderEvents();
});
$("#events").addEventListener("click", (e) => { const ev = e.target.closest(".ev"); if (ev) selectEvent(ev.dataset.id); });
$("#markets").addEventListener("click", (e) => { const r = e.target.closest("[data-ev]"); if (r) { const m = (data("markets") || []).find((x) => "mk-" + x.symbol === r.dataset.ev); if (m) globe.pointOfView({ lat: m.lat, lng: m.lng, altitude: 1.6 }, 1000); } });

setInterval(() => { $("#clock").textContent = new Date().toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris" }) + " Paris"; }, 1000);
setInterval(async () => { try { await load("crypto"); renderCommodities(); renderTicker(); } catch {} }, 10000);
setInterval(async () => { try { await load(); renderAll(); } catch {} }, 60000);
boot();
})();
