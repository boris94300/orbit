(() => {
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const nf = (d) => new Intl.NumberFormat("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmt = (v, d = 2) => (v == null || isNaN(v) ? "—" : nf(d).format(v));
const sign = (v, d = 2) => (v > 0 ? "+" : v < 0 ? "−" : "") + fmt(Math.abs(v), d);
const cls = (v) => (v > 0.005 ? "up" : v < -0.005 ? "down" : "flat");
const hhmm = (ms) => new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
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

let state = {}, prev = {}, globe, filter = "all", selected = null, pf = null;
const eur = (v, d = 0) => fmt(v, d) + " €";
const keur = (v) => (Math.abs(v) >= 1e4 ? fmt(v / 1000, 1) + " k€" : fmt(v, 0) + " €");
const PAL = { "Immobilier": "#4f5d6e", "Actions": "#5b9cf0", "Fonds euros": "#8fa8c8", "Monétaire": "#6b7684", "Obligations": "#3fb27f", "Crypto": "#d4a24c", "Diversifié": "#7b8fd4" };

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
    .arcStartLat("sLat").arcStartLng("sLng").arcEndLat("eLat").arcEndLng("eLng").arcColor((d) => d.colors)
    .arcStroke((d) => d.w).arcDashLength(0.35).arcDashGap(0.15).arcDashAnimateTime(2600).arcAltitudeAutoScale(0.28)
    .arcLabel((d) => d.tip)
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
  return { left: m.width - 196, top: m.height - 196, width: 180, height: 180 };
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
  const arcs = [];
  if (pf) {
    const c = pf.client;
    pts.push({ lat: c.lat, lng: c.lng, r: 0.32, alt: 0.02, color: "#e6e9ee", tip: `<div class="gt">${esc(c.name)} · ${esc(c.city)}<small>Patrimoine net ${keur(pf.totals.net)}</small></div>` });
    labels.push({ lat: c.lat - 1.6, lng: c.lng - 0.4, text: "Portefeuille C. Moreau", color: "rgba(230,233,238,.85)" });
    const top = pf.exposures.filter((e) => e.impact != null || e.kind !== "news").slice(0, 10);
    const sel = selected && pf.exposures.find((e) => e.event_id === selected);
    for (const e of sel && !top.includes(sel) ? [...top, sel] : top) {
      if (Math.abs(e.lat - c.lat) + Math.abs(e.lng - c.lng) < 1) continue;
      const col = e.impact == null ? "#c9d1db" : e.impact >= 0 ? COL.up : COL.down;
      const on = !selected || e.event_id === selected;
      arcs.push({ sLat: e.lat, sLng: e.lng, eLat: c.lat, eLng: c.lng, w: e.event_id === selected ? 0.9 : 0.35,
        colors: [hexA(col, on ? 0.15 : 0.04), hexA(col, on ? 0.9 : 0.12)],
        tip: `<div class="gt">${esc(e.label)}<small>${e.impact != null ? sign(e.impact, 0) + " € aujourd'hui" : "Encours exposé " + keur(e.exposed)}</small></div>` });
    }
  }
  globe.pointsData(pts).labelsData(labels).ringsData(rings).arcsData(arcs);
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
  for (const c of data("commodities") || []) if (Math.abs(c.change) >= 1 && c.symbol === "CL=F")
    ev.push({ id: "cm-" + c.symbol, kind: "marche", t: `${c.name} ${sign(c.change)} % sur la séance`, sub: `${fmt(c.price)} ${c.unit}`, time: Date.now() - 6e4, lat: 24.7, lng: 46.7, src: "Yahoo Finance" });
  for (const c of data("crypto") || []) if (Math.abs(c.change) >= 0.5 && c.pair === "BTC/EUR")
    ev.push({ id: "cr-BTC", kind: "marche", t: `Bitcoin ${sign(c.change)} % sur 24 h`, sub: `${fmt(c.price, 0)} €`, time: Date.now() - 3e4, lat: 47.37, lng: 8.54, src: "Kraken" });
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
  box.innerHTML = list.length ? list.map((e) => `<div class="ev k-${e.kind}${e.id === selected ? " sel" : ""}" data-id="${esc(e.id)}"><div class="bar"></div><div><div class="meta"><span>${esc(e.src)}</span><span>${e.time ? ago(e.time) : ""}</span></div><div class="t">${esc(e.t)}${impTag(e.id)}</div>${pf && pf.exposures.some((x) => x.event_id === e.id) ? `<button class="open" data-inv="${esc(e.id)}">Ouvrir l'enquête →</button>` : ""}<div class="sub">${esc(e.sub || "")}</div></div></div>`).join("") : `<div class="empty">Aucun événement pour ce filtre.</div>`;
  if (known.size) {
    const fresh = $$(".ev", box).filter((e) => !known.has(e.dataset.id));
    if (fresh.length) gsap.from(fresh, { opacity: 0, x: 12, duration: 0.35, stagger: 0.04, ease: "power2.out" });
  }
}
function impTag(id) {
  const x = pf && pf.exposures.find((e) => e.event_id === id);
  if (!x) return "";
  return x.impact != null ? `<span class="imp ${cls(x.impact)}" title="Impact estimé sur le portefeuille">${sign(x.impact, 0)} €</span>`
    : `<span class="imp exp" title="Encours du portefeuille exposé">exposé ${keur(x.exposed)}</span>`;
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

/* ---------- portefeuille ---------- */
async function loadPf() { const r = await fetch("/api/portfolio"); if (r.ok) pf = await r.json(); }
function renderPortfolio(first) {
  if (!pf) return;
  const c = pf.client, t = pf.totals;
  $("#pf-id").textContent = `${c.id} · profil ${c.profile} · MiFID ${new Date(c.mifid_date).toLocaleDateString("fr-FR")}`;
  $("#pf-name").textContent = `${c.name}, ${c.age} ans`;
  $("#pf-sub").textContent = `${c.city} · ${c.agency} · conseiller ${c.advisor} · revenus nets ${eur(c.income_month)}/mois`;
  $("#pf-kpis").innerHTML = [
    ["Patrimoine net", eur(t.net), `brut ${keur(t.gross)}`],
    ["Actifs financiers", eur(t.financial), `${fmt(t.financial / t.gross * 100, 1)} % du brut`],
    ["Variation du jour", `<span class="${cls(t.pnl)}">${sign(t.pnl, 2)} €</span>`, `${sign(t.pnl_pct, 3)} %`],
    ["Encours de crédit", eur(t.liabilities), pf.liabilities[0].name.split("·")[1]?.trim() || ""],
  ].map(([l, v, s2]) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s2}</div></div>`).join("");
  let rows = "", env = null;
  for (const p of pf.positions) {
    if (p.env !== env) { env = p.env; const tot = pf.positions.filter((x) => x.env === env).reduce((a, x) => a + x.value, 0); rows += `<tr class="grp"><td colspan="3">${esc(env)}</td><td>${eur(tot)}</td><td colspan="2"></td></tr>`; }
    const drv = p.drivers.length ? p.drivers.map((d) => `${d.label} ${fmt(d.w * 100, 0)} %`).join(" · ") : (p.qty ? `${fmt(p.qty, 4)} BTC` : "—");
    rows += `<tr data-pos="${p.id}"><td class="txt">${esc(p.name)}<small>${esc(p.isin)} · ${esc(p.cls)}</small></td><td class="txt"><small>${esc(drv)}</small></td><td>${fmt(p.weight, 1)} %<span class="wbar"><i style="width:${Math.min(100, p.weight * 1.5)}%"></i></span></td><td>${eur(p.value, 2)}</td><td class="${cls(p.pnl)}">${p.pnl ? sign(p.pnl, 2) : "—"}</td><td class="${cls(p.chg)}">${p.chg ? sign(p.chg, 2) + " %" : "—"}</td></tr>`;
  }
  const l = pf.liabilities[0];
  rows += `<tr class="grp"><td colspan="3">Passif</td><td>−${eur(l.outstanding, 2)}</td><td colspan="2"></td></tr><tr><td class="txt">${esc(l.name)}<small>échéance ${l.end} · mensualité ${eur(l.monthly, 2)}</small></td><td></td><td></td><td>−${eur(l.outstanding, 2)}</td><td>—</td><td>—</td></tr>`;
  $("#pf-table").innerHTML = `<thead><tr><th>Ligne</th><th style="text-align:left">Réplication / moteur de prix</th><th>Poids</th><th>Valorisation</th><th>Var. jour</th><th>%</th></tr></thead><tbody>${rows}</tbody>`;
  $("#pf-src").textContent = `valorisé ${hhmm(pf.asof * 1000)} · cours Yahoo, Kraken`;
  // donut
  const svg = d3.select("#pf-donut").attr("viewBox", "-75 -75 150 150");
  const arc = d3.arc().innerRadius(50).outerRadius(70).padAngle(0.012);
  const pie = d3.pie().value((d) => d.value).sort(null);
  const sel = svg.selectAll("path").data(pie(pf.allocation), (d) => d.data.cls);
  sel.enter().append("path").attr("fill", (d) => PAL[d.data.cls] || "#555").each(function (d) { this._c = { startAngle: d.startAngle, endAngle: d.startAngle }; })
    .merge(sel).transition().duration(first ? 900 : 400).ease(d3.easeCubicOut)
    .attrTween("d", function (d) { const i = d3.interpolate(this._c, d); this._c = i(1); return (tt) => arc(i(tt)); });
  svg.selectAll("text").data([0]).join("text").attr("text-anchor", "middle").attr("dy", "-0.1em").attr("fill", "#d5dbe1").style("font", "500 13px JetBrains Mono").text(keur(t.gross));
  svg.selectAll("text.s").data([0]).join("text").attr("class", "s").attr("text-anchor", "middle").attr("dy", "1.3em").attr("fill", "#5b6672").style("font", "10px Inter").text("actif brut");
  $("#pf-alloc").innerHTML = pf.allocation.map((a) => `<div><i style="background:${PAL[a.cls]}"></i>${esc(a.cls)}<span>${keur(a.value)}</span><span>${fmt(a.pct, 1)} %</span></div>`).join("");
  $("#pf-regions").innerHTML = pf.regions.map((r) => `<div class="rbar"><div>${esc(r.region)}</div><div class="t"><i data-w="${r.pct}"></i></div><span>${fmt(r.pct, 1)} %</span></div>`).join("");
  $$("#pf-regions .t i").forEach((el) => gsap.to(el, { width: el.dataset.w + "%", duration: first ? 0.8 : 0.3, ease: "power2.out" }));
  $("#pf-risks").innerHTML = pf.risks.items.map((r) => `<span class="chip${/inondation/i.test(r) ? " warn" : ""}">${esc(r)}</span>`).join("");
  $("#pf-risk-src").textContent = `${pf.risks.source}${pf.risks.status !== "live" ? " · instantané" : ""}`;
  // exposures table
  $("#pf-exp-n").textContent = `${pf.exposures.length} liens · méthode déterministe`;
  const name = Object.fromEntries(pf.positions.map((p) => [p.id, p.name]));
  $("#pf-exp").innerHTML = `<thead><tr><th>Événement</th><th style="text-align:left">Positions concernées</th><th style="text-align:left">Justification</th><th>Impact / exposition</th></tr></thead><tbody>` +
    pf.exposures.slice(0, 24).map((e) => `<tr data-ev="${esc(e.event_id)}" style="cursor:pointer"><td class="txt">${esc(e.label)}</td><td class="txt"><small>${e.positions.map((i) => esc(name[i])).join(" · ")}</small></td><td class="txt"><small>${esc(e.rationale)}</small></td><td class="${e.impact == null ? "flat" : cls(e.impact)}">${e.impact != null ? sign(e.impact, 2) + " €" : "exposé " + keur(e.exposed)}</td></tr>`).join("") + "</tbody>";
  renderGraph(first);
}
function renderGraph(animate) {
  const box = $("#pf-graph"), W = box.clientWidth - 28 || 1000;
  const evs = [...pf.exposures.filter((e) => e.impact != null).slice(0, 6), ...pf.exposures.filter((e) => e.impact == null).slice(0, 3)];
  const posIds = [...new Set(evs.flatMap((e) => e.positions))];
  const pos = pf.positions.filter((p) => posIds.includes(p.id));
  const envs = [...new Set(pos.map((p) => p.env))];
  const rowH = 34, H = Math.max(evs.length, pos.length, envs.length) * rowH + 10;
  const colX = [0, W * 0.4, W * 0.78], nodeW = [W * 0.27, W * 0.25, W * 0.22];
  const place = (arr, i) => 5 + i * (H - 10) / arr.length + ((H - 10) / arr.length - 26) / 2;
  const nE = evs.map((e, i) => ({ id: "e:" + e.event_id, x: colX[0], y: place(evs, i), w: nodeW[0], t: e.label, m: e.impact != null ? sign(e.impact, 0) + " €" : "exposé " + keur(e.exposed), ev: e }));
  const nP = pos.map((p, i) => ({ id: "p:" + p.id, x: colX[1], y: place(pos, i), w: nodeW[1], t: p.name, m: keur(p.value) }));
  const nV = envs.map((v, i) => ({ id: "v:" + v, x: colX[2], y: place(envs, i), w: nodeW[2], t: v, m: keur(pos.filter((p) => p.env === v).reduce((a, p) => a + p.value, 0)) }));
  const N = Object.fromEntries([...nE, ...nP, ...nV].map((n) => [n.id, n]));
  const links = [];
  evs.forEach((e) => e.positions.filter((p) => posIds.includes(p)).forEach((p) => links.push({ s: "e:" + e.event_id, t: "p:" + p, c: e.impact == null ? "#8b96a3" : e.impact >= 0 ? COL.up : COL.down, k: e.event_id })));
  pos.forEach((p) => links.push({ s: "p:" + p.id, t: "v:" + p.env, c: "#5b6672", k: null }));
  const path = (l) => { const a = N[l.s], b = N[l.t], x1 = a.x + a.w, y1 = a.y + 13, x2 = b.x, y2 = b.y + 13, m = (x1 + x2) / 2; return `M${x1},${y1} C${m},${y1} ${m},${y2} ${x2},${y2}`; };
  const clip = (s, w, m = "") => { const room = w - 26 - m.length * 6.6; return s.length * 6.4 > room ? s.slice(0, Math.max(8, Math.floor(room / 6.4) - 1)) + "…" : s; };
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}">${links.map((l) => `<path class="glink" data-s="${esc(l.s)}" data-t="${esc(l.t)}" d="${path(l)}" stroke="${l.c}" stroke-width="1.3"/>`).join("")}${Object.values(N).map((n) => `<g class="gnode" data-id="${esc(n.id)}" transform="translate(${n.x},${n.y})"><rect width="${n.w}" height="26" rx="3"/><text x="9" y="17">${esc(clip(n.t, n.w, n.m))}</text><text class="m" x="${n.w - 8}" y="17" text-anchor="end">${esc(n.m)}</text></g>`).join("")}</svg>`;
  const svg = $("svg", box);
  if (animate) {
    $$(".glink", svg).forEach((p) => { const L = p.getTotalLength(); p.style.strokeDasharray = L; p.style.strokeDashoffset = L; });
    gsap.from($$(".gnode", svg), { opacity: 0, x: -10, duration: 0.35, stagger: 0.025, ease: "power2.out" });
    gsap.to($$(".glink", svg), { strokeDashoffset: 0, duration: 0.9, stagger: 0.02, delay: 0.25, ease: "power2.inOut", onComplete() { this.targets().forEach((p) => (p.style.strokeDasharray = "none")); } });
  }
  $$(".gnode", svg).forEach((g) => {
    g.addEventListener("mouseenter", () => {
      const id = g.dataset.id, on = new Set([id]);
      const fwd = (x) => links.filter((l) => l.s === x).forEach((l) => { on.add(l.t); fwd(l.t); });
      const back = (x) => links.filter((l) => l.t === x).forEach((l) => { on.add(l.s); back(l.s); });
      fwd(id); back(id);
      svg.classList.add("dim");
      $$(".gnode", svg).forEach((n) => n.classList.toggle("on", on.has(n.dataset.id)));
      $$(".glink", svg).forEach((p) => p.classList.toggle("on", on.has(p.dataset.s) && on.has(p.dataset.t)));
    });
    g.addEventListener("mouseleave", () => svg.classList.remove("dim"));
    g.addEventListener("click", () => { const n = N[g.dataset.id]; if (n.ev) { go("monde"); setTimeout(() => selectEvent(n.ev.event_id, true), 550); } });
  });
}

/* ---------- horizon 60 ---------- */
let hz = null, hzT = null;
const hzp = { savings: 650, retire_age: 60, equity: 55, target: 420000 };
const hzFmt = { savings: (v) => eur(v) + "/mois", retire_age: (v) => v + " ans", equity: (v) => v + " %", target: (v) => keur(v) };
async function loadHz() { const r = await fetch("/api/horizon?" + new URLSearchParams(hzp)); if (r.ok) hz = await r.json(); }
for (const k of Object.keys(hzp)) {
  const el = $("#s-" + k);
  $("#v-" + k).textContent = hzFmt[k](hzp[k]);
  el.addEventListener("input", () => {
    hzp[k] = +el.value; $("#v-" + k).textContent = hzFmt[k](hzp[k]);
    clearTimeout(hzT); hzT = setTimeout(async () => { await loadHz(); renderHz(false); }, 200);
  });
}
function renderHz(first) {
  if (!hz) return;
  const h = hz, I = h.inputs, c = pf ? pf.client : { name: "", age: I.age };
  $("#hz-sub").textContent = `${c.name} · ${I.age} ans · départ à ${I.retire_age} ans (${new Date().getFullYear() + I.years}) · capital initial ${eur(I.start)} · hors immobilier`;
  $("#hz-n").textContent = `${fmt(h.n, 0)} scénarios · pas annuel · rééquilibrage annuel`;
  $("#hz-hyp").innerHTML = h.assumptions.map(([k, v, s]) => `<tr><td class="txt">${esc(k)}<small>${esc(v)}</small><small>${esc(s)}</small></td></tr>`).join("");
  $("#hz-live").textContent = `€STR ${fmt(I.estr, 3)} % · IPCH zone euro ${fmt(I.inflation, 1)} % · BCE, Eurostat`;
  // chart
  const box = $("#hz-chart"), W = box.clientWidth || 700, H = 430, m = { l: 58, r: 18, t: 16, b: 28 };
  const x = d3.scaleLinear().domain([I.age, I.age + I.years]).range([m.l, W - m.r]);
  const ymax = Math.max(d3.max(h.bands, (b) => b.p95), I.target) * 1.08;
  const y = d3.scaleLinear().domain([0, ymax]).range([H - m.b, m.t]).nice();
  const area = (lo, hi) => d3.area().x((d) => x(d.age)).y0((d) => y(d[lo])).y1((d) => y(d[hi])).curve(d3.curveMonotoneX);
  const med = d3.line().x((d) => x(d.age)).y((d) => y(d.p50)).curve(d3.curveMonotoneX);
  const pl = d3.line().x((d, i) => x(I.age + i)).y((d) => y(Math.min(d, y.domain()[1]))).curve(d3.curveMonotoneX);
  let svg = d3.select(box).select("svg");
  if (first || svg.empty()) {
    box.innerHTML = '<div class="hz-tip"></div>';
    svg = d3.select(box).append("svg").attr("width", W).attr("height", H);
    ["grid", "ax x", "ax y", "paths", "b95", "b50", "tg", "med", "hover"].forEach((g) => svg.append("g").attr("class", g));
  }
  const T = svg.transition().duration(first ? 0 : 420).ease(d3.easeCubicOut);
  svg.select(".ax.x").attr("transform", `translate(0,${H - m.b})`).transition(T).call(d3.axisBottom(x).ticks(Math.min(I.years, 10)).tickFormat((v) => v + " ans").tickSizeOuter(0));
  svg.select(".ax.y").attr("transform", `translate(${m.l},0)`).transition(T).call(d3.axisLeft(y).ticks(6).tickFormat((v) => (v ? fmt(v / 1000, 0) + " k€" : "0")).tickSizeOuter(0));
  svg.select(".grid").transition(T).call((g) => g.attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(6).tickSize(-(W - m.l - m.r)).tickFormat("")).call((g) => g.select(".domain").remove()));
  const ps = svg.select(".paths").selectAll("path").data(h.paths).join("path").attr("fill", "none").attr("stroke", COL.acc).attr("stroke-width", 0.8).attr("d", pl);
  const b95 = svg.select(".b95").selectAll("path").data([h.bands]).join("path").attr("fill", "rgba(91,156,240,.13)");
  const b50 = svg.select(".b50").selectAll("path").data([h.bands]).join("path").attr("fill", "rgba(91,156,240,.26)");
  const ml = svg.select(".med").selectAll("path").data([h.bands]).join("path").attr("fill", "none").attr("stroke", "#d5dbe1").attr("stroke-width", 1.8);
  const tg = svg.select(".tg").selectAll("g").data([I.target]).join((e) => { const g = e.append("g"); g.append("line").attr("stroke", "#d4a24c").attr("stroke-dasharray", "4 4"); g.append("text").attr("fill", "#d4a24c").attr("text-anchor", "end").style("font", "10.5px JetBrains Mono"); return g; });
  tg.select("line").transition(T).attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(I.target)).attr("y2", y(I.target));
  tg.select("text").text(`objectif ${keur(I.target)}`).transition(T).attr("x", W - m.r - 4).attr("y", y(I.target) - 6);
  if (first) {
    b95.attr("d", area("p5", "p95")).attr("opacity", 0); b50.attr("d", area("p25", "p75")).attr("opacity", 0); ml.attr("d", med(h.bands));
    ps.attr("opacity", 0.16).each(function () { const L = this.getTotalLength(); this.style.strokeDasharray = L; this.style.strokeDashoffset = L; });
    const Lm = ml.node().getTotalLength(); ml.style("stroke-dasharray", Lm).style("stroke-dashoffset", Lm);
    const tl = gsap.timeline();
    tl.to(ps.nodes(), { strokeDashoffset: 0, duration: 1.1, stagger: 0.012, ease: "power1.inOut" })
      .to(ps.nodes(), { opacity: 0.06, duration: 0.5 }, "-=0.2")
      .to([b95.node(), b50.node()], { opacity: 1, duration: 0.5, stagger: 0.12 }, "<")
      .to(ml.node(), { strokeDashoffset: 0, duration: 0.7, ease: "power2.out" }, "<0.1");
  } else {
    ps.attr("opacity", 0.06).style("stroke-dasharray", "none");
    b95.transition(T).attr("d", area("p5", "p95")).attr("opacity", 1); b50.transition(T).attr("d", area("p25", "p75")).attr("opacity", 1);
    ml.style("stroke-dasharray", "none").transition(T).attr("d", med(h.bands));
  }
  // hover
  const hv = svg.select(".hover"), tip = $(".hz-tip", box);
  hv.selectAll("*").remove();
  const vl = hv.append("line").attr("y1", m.t).attr("y2", H - m.b).attr("stroke", "#5b6672").attr("opacity", 0);
  const dot = hv.append("circle").attr("r", 3).attr("fill", "#d5dbe1").attr("opacity", 0);
  hv.append("rect").attr("x", m.l).attr("y", m.t).attr("width", W - m.l - m.r).attr("height", H - m.t - m.b).attr("fill", "transparent")
    .on("mousemove", (e) => {
      const [mx] = d3.pointer(e), i = Math.max(0, Math.min(I.years, Math.round(x.invert(mx) - I.age))), b = h.bands[i];
      vl.attr("x1", x(b.age)).attr("x2", x(b.age)).attr("opacity", 1); dot.attr("cx", x(b.age)).attr("cy", y(b.p50)).attr("opacity", 1);
      tip.innerHTML = `<b>${b.age} ans · ${new Date().getFullYear() + i}</b><br>favorable (95e) ${keur(b.p95)}<br>médiane <b>${keur(b.p50)}</b><br>défavorable (5e) ${keur(b.p5)}`;
      tip.style.left = Math.min(x(b.age) + 12, W - 190) + "px"; tip.style.top = y(b.p50) - 40 + "px"; tip.style.opacity = 1;
    })
    .on("mouseleave", () => { vl.attr("opacity", 0); dot.attr("opacity", 0); tip.style.opacity = 0; });
  // kpis
  const p = h.prob * 100, pc = p >= 70 ? COL.up : p >= 45 ? "#d4a24c" : COL.down;
  const pe = $("#hz-prob"), from = +(pe.dataset.v || 0);
  gsap.to({ v: from }, { v: p, duration: first ? 1.4 : 0.4, ease: "power2.out", onUpdate() { pe.textContent = fmt(this.targets()[0].v, 0) + " %"; } });
  pe.dataset.v = p; pe.style.color = pc;
  gsap.to("#hz-pbar", { width: p + "%", backgroundColor: pc, duration: first ? 1.4 : 0.4 });
  $("#hz-prob-s").textContent = `${fmt(Math.round(h.prob * h.n), 0)} scénarios sur ${fmt(h.n, 0)} au-dessus de ${keur(I.target)}`;
  const S = h.sensitivity, pnl = pf ? pf.totals.pnl : 0;
  $("#hz-kpis").innerHTML = [
    ["Capital médian à " + I.retire_age + " ans", keur(h.final.p50), `1 chance sur 2 entre ${keur(h.final.p25)} et ${keur(h.final.p75)}`],
    ["Complément de revenu", eur(h.income.p50) + "/mois", "rente sur 25 ans, taux réel 1 %"],
    ["Marchés du jour", `<span class="${cls(S.today)}">${sign(S.today, 0)} €</span>`, `${sign(pnl, 2)} € aujourd'hui → effet à ${I.retire_age} ans`],
  ].map(([l, v, s]) => `<div class="row"><div>${l}<small>${s}</small></div><b>${v}</b></div>`).join("");
  const lev = [["Épargner 100 €/mois de plus", S.plus100], [`Partir à ${I.retire_age + 2} ans`, S.plus2y], ["Part actions +10 pts", S.equity_plus10]];
  $("#hz-sens").innerHTML = lev.map(([l, v]) => `<div class="row"><div>${l}</div><b class="${cls(v)}">${sign(v / 1000, 1)} k€</b></div>`).join("");
  // note
  const best = lev.slice().sort((a, b) => b[1] - a[1])[0];
  const gap = I.target - h.final.p50;
  $("#hz-brief").innerHTML = `<p>À ${I.age} ans, ${esc(c.name)} détient ${keur(I.start)} d'actifs financiers et épargne ${eur(I.savings)} par mois. Avec une allocation à ${I.equity_pct} % en actions, le capital projeté à ${I.retire_age} ans atteint ${keur(h.final.p50)} en médiane, exprimé en euros d'aujourd'hui. Dans un scénario sur deux, il se situe entre ${keur(h.final.p25)} et ${keur(h.final.p75)}. Dans les 5 % de scénarios les plus défavorables, il reste inférieur à ${keur(h.final.p5)}.</p>
  <p>L'objectif de ${keur(I.target)} est atteint dans ${fmt(p, 0)} % des scénarios. ${gap > 0 ? `La médiane reste ${keur(gap)} en dessous de l'objectif. Le levier le plus efficace est : ${best[0].toLowerCase()} (${sign(best[1] / 1000, 1)} k€ sur la médiane).` : `La médiane dépasse l'objectif de ${keur(-gap)}. La priorité est donc de sécuriser progressivement le capital à l'approche de l'échéance, plutôt que d'augmenter le risque.`}</p>
  <p>Les mouvements de marché du jour (${sign(pnl, 2)} € sur le portefeuille) représentent ${sign(S.today, 0)} € sur le capital médian à ${I.retire_age} ans. À cet horizon, l'effet est ${Math.abs(S.today) < h.final.p50 * 0.005 ? "négligeable et ne justifie aucun arbitrage" : "sensible et mérite un point avec le conseiller"}.</p>
  <div class="foot">Projection indicative, hors immobilier, fiscalité et frais de gestion. Les performances passées ne préjugent pas des performances futures.</div>`;
  $("#hz-note-src").textContent = `calcul ${hhmm(Date.now())} · ${fmt(h.n, 0)} scénarios`;
}

/* ---------- agents ---------- */
let ag = null, agRunning = false;
const hms = (t) => new Date(t * 1000).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris" });
const ST = { pending: "validation client requise", escalated: "transmis au conseiller", blocked: "bloqué par conformité", executed: "exécuté", rejected: "refusé" };
async function loadAg() { const r = await fetch("/api/agents/state"); if (r.ok) ag = await r.json(); }
function renderPipe(st = {}) {
  $("#ag-pipe").innerHTML = ag.agents.map((a) => `<div class="ag ${st[a.id]?.status || ""}" data-a="${a.id}"><div class="n">${esc(a.name)}<i></i></div><div class="r">${esc(a.role)}</div><div class="o">${st[a.id]?.summary ? esc(st[a.id].summary) + ` · ${st[a.id].ms} ms` : "en attente"}</div></div>`).join("");
}
function setAgent(id, status, summary, ms) {
  const el = $(`.ag[data-a="${id}"]`); if (!el) return;
  el.className = "ag " + status;
  $(".o", el).textContent = summary ? `${summary} · ${ms} ms` : "en cours…";
}
function logRow(e, fresh) {
  return `<tr class="${fresh ? "new" : ""}"><td>${hms(e.ts)}</td><td class="txt">${esc(e.agent_name)}</td><td class="txt">${esc(e.op)}</td><td class="txt">${esc(e.detail)}${e.source ? `<small>${esc(e.source)}</small>` : ""}</td><td class="txt">${e.decision ? `<span class="badge ${{ "validation client requise": "pending", "hors mandat · transmis au conseiller": "escalated", "bloqué": "blocked", "rejeté": "blocked", "refusé": "blocked", "exécuté": "executed", "approuvé": "executed", "conforme": "executed" }[e.decision] || ""}">${esc(e.decision)}</span>` : ""}</td><td class="hash">${e.hash.slice(0, 10)}</td></tr>`;
}
function renderLog() {
  $("#ag-log").innerHTML = `<thead><tr><th style="text-align:left">Heure</th><th style="text-align:left">Agent</th><th style="text-align:left">Opération</th><th style="text-align:left">Détail · source</th><th style="text-align:left">Décision</th><th style="text-align:left">Empreinte</th></tr></thead><tbody>${ag.log.slice().reverse().map((e) => logRow(e)).join("")}</tbody>`;
  $("#ag-ln").textContent = `${ag.log.length} entrées`;
}
function addLog(e) {
  ag.log.push(e);
  const tb = $("#ag-log tbody"); tb.insertAdjacentHTML("afterbegin", logRow(e, true));
  gsap.from(tb.firstElementChild, { opacity: 0, y: -6, duration: 0.3 });
  $("#ag-ln").textContent = `${ag.log.length} entrées`;
}
function renderMandate() {
  const M = ag.mandate, used = (M.used / M.monthly_cap) * 100;
  $("#ag-mid").textContent = `${M.id} · signé le ${new Date(M.signed).toLocaleDateString("fr-FR")}`;
  $("#ag-mandate").innerHTML = `<div class="md"><div class="row">Plafond mensuel<b>${eur(M.monthly_cap)}</b></div><div class="row">Engagé ce mois<b id="md-used">${eur(M.used)}</b></div><div class="pbar" style="margin:6px 0 4px"><i id="md-bar" style="width:${used}%"></i></div><div class="row">Échéance<b>${new Date(M.expires).toLocaleDateString("fr-FR")}</b></div>
  <div class="lbl">Opérations autorisées</div><div class="lst">${M.allowed.map((x) => `<div>${esc(x)}</div>`).join("")}</div>
  <div class="lbl">Exclusions</div><div class="lst no">${M.forbidden.map((x) => `<div>${esc(x)}</div>`).join("")}</div>
  <div class="lbl">Règle</div><div class="lst"><div>${esc(M.validation)}</div></div></div>`;
}
function propHtml(p) {
  return `<div class="prop" data-p="${p.id}"><div class="h"><div><div class="t">${esc(p.title)}</div><div class="id">${p.id} · ${esc(p.target)} · ${eur(p.amount, p.amount % 1 ? 2 : 0)}${p.unit === "€/mois" ? "/mois" : ""}${p.effect != null ? ` · effet médiane ${sign(p.effect / 1000, 1)} k€` : ""}</div></div><span class="badge ${p.status}">${ST[p.status]}</span></div>
  <div class="why">${esc(p.rationale)}</div>
  <div class="checks">${(p.checks || []).map(([l, ok, d]) => `<i class="k ${ok ? "y" : "n"}"></i><span>${esc(l)}</span><span class="d">${esc(d)}</span>`).join("")}</div>
  ${p.status === "pending" ? `<div class="acts"><button class="btn ok" data-d="approve">Valider l'opération</button><button class="btn ghost" data-d="reject">Refuser</button></div>` : ""}
  ${p.status === "executed" ? `<div class="stamp-wrap"><div class="stamp">Exécuté · ${hms(p.executed_at)}<small>réf. ${p.ref}</small></div></div>` : ""}</div>`;
}
function renderProps() {
  const ps = ag.pending.slice().reverse();
  if (!ps.length) return;
  $("#ag-props").innerHTML = ps.map(propHtml).join("");
  $("#ag-pn").textContent = `${ps.filter((p) => p.status === "pending").length} en attente de validation`;
}
function renderNote() {
  if (!ag.note) return;
  $("#ag-note").innerHTML = `<p>${esc(ag.note.text)}</p><div class="foot">Chiffres issus du moteur de projection. Toute reformulation par un modèle est vérifiée chiffre à chiffre avant publication.</div>`;
  $("#ag-note-src").textContent = `${ag.note.source === "règles" ? "rédaction par règles" : "reformulé · " + ag.note.source} · ${hms(ag.note.ts)}`;
}
function renderAgents() {
  if (!ag) return;
  $("#ag-mode").textContent = `modèle de rédaction : ${ag.mode}`;
  renderPipe(); renderMandate(); renderProps(); renderNote(); renderLog();
}
$("#ag-run").addEventListener("click", () => {
  if (agRunning) return;
  agRunning = true; $("#ag-run").disabled = true; $("#ag-run").textContent = "Cycle en cours…";
  renderPipe();
  const es = new EventSource("/api/agents/run");
  es.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.type === "step") setAgent(d.agent, "running");
    else if (d.type === "step_end") setAgent(d.agent, "done", d.summary, d.ms);
    else if (d.type === "log") addLog(d.entry);
    else if (d.type === "done") {
      es.close(); Object.assign(ag, { pending: d.pending, mandate: d.mandate, note: d.note });
      renderProps(); renderMandate(); renderNote();
      gsap.from("#ag-props .prop", { opacity: 0, y: 8, duration: 0.35, stagger: 0.08 });
      agRunning = false; $("#ag-run").disabled = false; $("#ag-run").textContent = "Relancer un cycle";
    }
  };
  es.onerror = () => { es.close(); agRunning = false; $("#ag-run").disabled = false; $("#ag-run").textContent = "Relancer un cycle"; };
});
$("#ag-props").addEventListener("click", async (ev) => {
  const btn = ev.target.closest("[data-d]"); if (!btn) return;
  const card = btn.closest(".prop"), id = card.dataset.p;
  $$(".acts .btn", card).forEach((b) => (b.disabled = true));
  const r = await (await fetch(`/api/agents/decide/${id}/${btn.dataset.d}`, { method: "POST" })).json();
  if (r.error) return;
  for (const e of r.entries) { addLog(e); await new Promise((res) => setTimeout(res, 260)); }
  const i = ag.pending.findIndex((p) => p.id === id); ag.pending[i] = r.proposal; ag.mandate = r.mandate;
  card.outerHTML = propHtml(r.proposal);
  renderMandate(); renderProps();
  const st = $(`.prop[data-p="${id}"] .stamp`);
  if (st) gsap.from(st, { scale: 1.6, opacity: 0, duration: 0.35, ease: "back.out(2)" });
  if (r.proposal.status === "executed" && r.proposal.kind === "versement") {
    hzp.savings += r.proposal.amount; $("#s-savings").value = hzp.savings; $("#v-savings").textContent = hzFmt.savings(hzp.savings); hz = null;
  }
});

/* ---------- conseiller ---------- */
let cs = null, csSel = null;
const KIND = { crypto: "Concentration crypto", alloc: "Allocation hors profil", retraite: "Objectif retraite à risque", marche: "Sensibilité au marché du jour", mifid: "MiFID à renouveler" };
async function loadCs() { const r = await fetch("/api/advisor"); if (r.ok) cs = await r.json(); }
function renderCs(first) {
  if (!cs) return;
  $("#cs-k").textContent = `${cs.agency} · conseiller ${cs.advisor} · ${cs.n} clients`;
  $("#cs-kpis").innerHTML = [["Encours financier", keur(cs.aum).replace(" k€", " k€"), `${cs.n} clients`], ["Impact marché du jour", `<span class="${cls(cs.impact)}">${sign(cs.impact, 0)} €</span>`, "agence, cours en direct"],
    ["À contacter", cs.to_contact, "score ≥ 40"], ["Objectif retraite à risque", cs.at_risk, "probabilité < 50 %"]]
    .map(([l, v, s]) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join("");
  $("#cs-n").textContent = `${cs.clients.length} premiers · tri par score`;
  const col = (s) => (s >= 60 ? COL.down : s >= 40 ? "#d4a24c" : COL.acc);
  $("#cs-table").innerHTML = `<thead><tr><th style="text-align:left">Score</th><th style="text-align:left">Client</th><th>Encours</th><th>Jour</th><th>P(obj.)</th></tr></thead><tbody>` +
    cs.clients.map((c) => `<tr data-c="${c.id}" class="${c.id === (pf && pf.client.id) ? "me" : ""} ${c.id === csSel ? "sel" : ""}"><td><div class="sc">${c.score}<i><b style="width:${c.score}%;background:${col(c.score)}"></b></i></div></td><td class="txt">${esc(c.name)} <small>${c.age} ans · ${esc(c.profile)} · ${esc(c.commune)}</small><div class="why">${c.kinds.map((k, i) => `<span class="${k}" title="${esc(c.reasons[i])}">${esc(c.reasons[i])}</span>`).join("")}</div></td><td>${keur(c.fin)}</td><td class="${cls(c.impact)}">${sign(c.impact, 0)} €</td><td>${fmt(c.prob * 100, 0)} %</td></tr>`).join("") + "</tbody>";
  if (first) gsap.from("#cs-table tbody tr", { opacity: 0, y: 6, duration: 0.3, stagger: 0.012 });
  $("#cs-ev").innerHTML = cs.events.map((e) => `<div class="evr" data-inv="${esc(e.event_id)}"><div>${esc(e.label)}<small>${e.clients} clients · encours exposé ${keur(e.exposed)}</small></div><div class="m ${cls(e.impact)}">${sign(e.impact, 0)} €</div><div class="m" style="color:var(--acc)">→</div></div>`).join("");
  const mx = Math.max(...Object.values(cs.kinds));
  $("#cs-kinds").innerHTML = Object.entries(cs.kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<div class="rbar"><div>${KIND[k]}</div><div class="t"><i style="width:${(n / mx) * 100}%"></i></div><span>${n}</span></div>`).join("");
  if (csSel) showMsg(csSel);
}
function showMsg(id) {
  const c = cs.clients.find((x) => x.id === id); if (!c) return;
  csSel = id; $$("#cs-table tr").forEach((r) => r.classList.toggle("sel", r.dataset.c === id));
  $("#cs-who").textContent = `${c.name} · ${c.id}`;
  $("#cs-msg").innerHTML = c.message ? `<div class="msg"><div class="q">${esc(c.message)}</div><div class="acts"><button class="btn ok" id="cs-send">Envoyer via messagerie sécurisée</button><button class="btn ghost" id="cs-rdv">Proposer un rendez-vous</button></div></div>` : `<div class="empty">Aucun motif de contact.</div>`;
  gsap.from("#cs-msg .q", { opacity: 0, x: 8, duration: 0.25 });
}
$("#cs-table").addEventListener("click", (e) => { const r = e.target.closest("[data-c]"); if (r) showMsg(r.dataset.c); });
$("#cs-msg").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  b.textContent = b.id === "cs-send" ? `Envoyé · ${hhmm(Date.now())} (simulation)` : `Créneau proposé · ${hhmm(Date.now())} (simulation)`; b.disabled = true;
});

/* ---------- enquête ---------- */
const inv = { tabs: [], on: null, cache: {} };
async function openInv(id) {
  if (!inv.tabs.includes(id)) inv.tabs.push(id);
  inv.on = id;
  if (!inv.cache[id]) { const r = await fetch("/api/investigate?id=" + encodeURIComponent(id)); inv.cache[id] = await r.json(); }
  renderInv();
  gsap.to("#inv", { x: 0, xPercent: 0, duration: 0.4, ease: "power3.out", onStart() { $("#inv").style.transform = ""; } });
}
function closeInv(id) {
  inv.tabs = id ? inv.tabs.filter((t) => t !== id) : [];
  if (!inv.tabs.length) { gsap.to("#inv", { xPercent: 102, duration: 0.3, ease: "power2.in" }); inv.on = null; return; }
  if (inv.on === id) inv.on = inv.tabs[inv.tabs.length - 1];
  renderInv();
}
function renderInv() {
  $("#inv-tabs").innerHTML = inv.tabs.map((t) => `<div class="inv-tab ${t === inv.on ? "on" : ""}" data-t="${esc(t)}"><span>${esc(inv.cache[t]?.exposure?.label || t)}</span><b data-x="${esc(t)}">×</b></div>`).join("") + `<button class="x" data-x="">Fermer tout</button>`;
  const d = inv.cache[inv.on], body = $("#inv-body");
  if (!d || d.error) { body.innerHTML = `<p>${esc(d?.error || "Chargement…")}</p>`; return; }
  const x = d.exposure, ev = events().find((e) => e.id === inv.on) || {}, envs = [...new Set(d.positions.map((p) => p.env))];
  const val = d.positions.reduce((a, p) => a + p.value, 0);
  body.innerHTML = `<div class="meta">${esc(ev.src || x.kind)} · ${ev.time ? new Date(ev.time).toLocaleString("fr-FR", { timeZone: "Europe/Paris" }) : "séance en cours"}</div><h3>${esc(x.label)}</h3>${ev.url ? `<a class="meta" style="color:var(--acc)" href="${esc(ev.url)}" target="_blank" rel="noopener">source ↗</a>` : ""}
  <div class="chain"><div>Événement<b>${esc(x.label.split(" ").slice(-2).join(" "))}</b></div><div>Positions<b>${d.positions.length}</b></div><div>Encours concerné<b>${keur(val)}</b></div><div>Impact du jour<b class="${x.impact == null ? "" : cls(x.impact)}">${x.impact == null ? "non chiffrable" : sign(x.impact, 2) + " €"}</b></div><div>Effet à 60 ans<b>${d.horizon_effect == null ? "—" : sign(d.horizon_effect, 0) + " €"}</b></div></div>
  <div class="inv-sec">Transmission au portefeuille</div>
  <table class="tbl"><thead><tr><th style="text-align:left">Position</th><th style="text-align:left">Enveloppe</th><th>Valorisation</th><th>Poids du facteur</th><th>Contribution</th></tr></thead><tbody>${d.positions.map((p) => `<tr><td class="txt">${esc(p.name)}</td><td class="txt">${esc(p.env)}</td><td>${eur(p.value, 2)}</td><td>${p.w == null ? "—" : fmt(p.w * 100, 1) + " %"}</td><td class="${p.contrib == null ? "" : cls(p.contrib)}">${p.contrib == null ? "—" : sign(p.contrib, 2) + " €"}</td></tr>`).join("")}</tbody></table>
  <div class="inv-sec">Méthode</div><p>${esc(x.rationale)}. ${x.impact != null ? `Contribution = valorisation × poids du facteur dans la réplication × variation de séance. L'effet à 60 ans capitalise l'impact du jour à 2,5 % réel par an sur ${d.years} ans : c'est un ordre de grandeur, pas une prévision.` : "L'événement ne se transmet pas mécaniquement à un prix de marché. Orbit signale l'encours concerné sans inventer de perte."}</p>
  ${d.agency ? `<div class="inv-sec">Exposition de l'agence</div><p>${d.agency.clients} clients exposés, pour un encours de ${keur(d.agency.exposed)} et un impact estimé de ${sign(d.agency.impact, 0)} € sur la séance.</p>` : ""}
  <div class="inv-sec">Limites</div><p>Les poids de réplication sont des approximations publiques des indices de référence. Les variations sont celles de la séance en cours (Yahoo Finance, Kraken) et peuvent différer de la valeur liquidative de fin de journée.</p>`;
  gsap.from(body.children, { opacity: 0, y: 6, duration: 0.3, stagger: 0.03 });
}
$("#inv-tabs").addEventListener("click", (e) => { const xb = e.target.closest("[data-x]"); if (xb) return closeInv(xb.dataset.x || null); const t = e.target.closest("[data-t]"); if (t) { inv.on = t.dataset.t; renderInv(); } });
document.addEventListener("click", (e) => { const b = e.target.closest("[data-inv]"); if (b) { e.stopPropagation(); openInv(b.dataset.inv); } }, true);

/* ---------- navigation ---------- */
const currentView = () => $(".rail-btn.active")?.dataset.view || "monde";
function go(view) {
  if (view === currentView()) return;
  const from = $(".view.active"), to = $("#view-" + view);
  $$(".rail-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  if (view === "portefeuille") setTimeout(() => renderPortfolio(true), 180);
  if (view === "conseiller") setTimeout(async () => { if (!cs) await loadCs(); renderCs(true); }, 180);
  if (view === "agents") setTimeout(async () => { if (!ag) await loadAg(); if (!agRunning) renderAgents(); }, 180);
  if (view === "horizon") setTimeout(async () => { if (!hz) await loadHz(); renderHz(true); }, 180);
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
  say("Valorisation du portefeuille client");
  try { await loadPf(); } catch {}
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
setInterval(async () => { try { await load(); await loadPf(); renderAll(); if (currentView() === "portefeuille") renderPortfolio(false); if (cs) { await loadCs(); if (currentView() === "conseiller") renderCs(false); } if (hz) { await loadHz(); if (currentView() === "horizon") renderHz(false); } } catch {} }, 60000);
$("#pf-exp").addEventListener("click", (e) => { const r = e.target.closest("[data-ev]"); if (r) { go("monde"); setTimeout(() => selectEvent(r.dataset.ev, true), 550); } });
boot();
})();
