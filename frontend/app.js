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
  box.innerHTML = list.length ? list.map((e) => `<div class="ev k-${e.kind}${e.id === selected ? " sel" : ""}" data-id="${esc(e.id)}"><div class="bar"></div><div><div class="meta"><span>${esc(e.src)}</span><span>${e.time ? ago(e.time) : ""}</span></div><div class="t">${esc(e.t)}${impTag(e.id)}</div><div class="sub">${esc(e.sub || "")}</div></div></div>`).join("") : `<div class="empty">Aucun événement pour ce filtre.</div>`;
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

/* ---------- navigation ---------- */
const currentView = () => $(".rail-btn.active")?.dataset.view || "monde";
function go(view) {
  if (view === currentView()) return;
  const from = $(".view.active"), to = $("#view-" + view);
  $$(".rail-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  if (view === "portefeuille") setTimeout(() => renderPortfolio(true), 180);
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
setInterval(async () => { try { await load(); await loadPf(); renderAll(); if (currentView() === "portefeuille") renderPortfolio(false); } catch {} }, 60000);
$("#pf-exp").addEventListener("click", (e) => { const r = e.target.closest("[data-ev]"); if (r) { go("monde"); setTimeout(() => selectEvent(r.dataset.ev, true), 550); } });
boot();
})();
