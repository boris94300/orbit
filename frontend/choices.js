const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
const eur = (v) => Math.round(v).toLocaleString("fr-FR") + " €";
const keur = (v) => (Math.abs(v) >= 1e6 ? (v / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 2 }) + " M€" : Math.round(v / 1000).toLocaleString("fr-FR") + " k€");
const lc = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const COLORS = ["#a1a1a6", "#f5f5f7", "#8ab4ff", "#7fd1a8"];
let SEL = null, P = null, C = null, kind = "logement", H = null, par = {}, timer, seq = 0;

const DEFS = {
  logement: {
    title: "Louer ou acheter",
    q: (p) => `Rester locataire à ${eur(p.rent_month)} par mois, ou acheter un bien de ${keur(par.price)} dans ${par.in_years} an${par.in_years > 1 ? "s" : ""} ?`,
    params: (p) => [["price", "Prix du bien", 80000, 900000, 5000, "€"], ["down", "Apport", 0, Math.max(5000, p.cash + p.invested), 1000, "€"],
      ["rate", "Taux", 1, 6, 0.05, "%"], ["years", "Durée", 10, 30, 1, "ans"], ["in_years", "Achat dans", 0, 15, 1, "ans"]],
    init: (p) => ({ price: p.buy.price, down: Math.min(p.buy.down, p.cash + p.invested), rate: p.buy.rate, years: p.buy.years, in_years: p.buy.in_years }),
    variants: (p) => [{ label: "Rester locataire", set: { buy: { enabled: false } } },
      { label: `Acheter dans ${par.in_years} an${par.in_years > 1 ? "s" : ""}`, set: { buy: { enabled: true, ...par } } }],
    blocked: (p) => (p.housing !== "locataire" ? "Cette comparaison concerne les locataires. Tu es indiqué comme propriétaire ou hébergé dans ton profil." : ""),
  },
  epargne: {
    title: "Épargner pour plus tard",
    q: (p) => `Que change le montant mis de côté chaque mois, de ${eur(0)} à ${eur(par.more)} ?`,
    params: () => [["more", "Montant testé", 0, 2500, 50, "€ / mois"]],
    init: (p) => ({ more: Math.round((p.savings_month + 200) / 50) * 50 }),
    variants: (p) => [{ label: "Ne rien mettre de côté", set: { savings_month: 0 } },
      { label: `${eur(p.savings_month)} / mois, aujourd'hui`, set: {} }, { label: `${eur(par.more)} / mois`, set: { savings_month: par.more } }],
  },
  placement: {
    title: "Où placer mon épargne",
    q: () => "Même effort d'épargne, trois façons de le placer. Plus d'actions, c'est plus de rendement en moyenne, mais des années plus difficiles.",
    params: () => [],
    init: () => ({}),
    variants: (p) => {
      const v = [{ label: "Tout sur Livret A", set: { equity_share: 0 } }];
      if (p.equity_share > 5 && p.equity_share < 85) v.push({ label: `Mon allocation (${p.equity_share} % actions)`, set: {} });
      else v.push({ label: "Équilibré (50 % actions)", set: { equity_share: 50 } });
      v.push({ label: "Dynamique (90 % actions)", set: { equity_share: 90 } });
      return v;
    },
  },
  retraite: {
    title: "Quand partir à la retraite",
    q: () => "Partir plus tôt, c'est moins d'années d'épargne et plus d'années à financer.",
    params: () => [],
    init: () => ({}),
    variants: (p) => [...new Set([62, p.retire_age, 67])].sort((a, b) => a - b).map((a) => ({ label: `Partir à ${a} ans${a === p.retire_age ? ", prévu" : ""}`, set: { retire_age: a } })),
  },
  composer: {
    title: "Composer mon scénario",
    q: () => "Combine plusieurs décisions et compare le résultat à ta situation actuelle.",
    params: (p) => [["savings_month", "Épargne", 0, 3000, 50, "€ / mois"], ["equity_share", "Part actions", 0, 100, 10, "%"], ["retire_age", "Retraite", 60, 70, 1, "ans"]]
      .concat(p.housing === "locataire" ? [["buy", "Acheter mon logement", 0, 1, 1, "oui"]] : []),
    init: (p) => ({ savings_month: p.savings_month, equity_share: p.equity_share, retire_age: p.retire_age, buy: p.buy.enabled ? 1 : 0 }),
    variants: (p) => [{ label: "Ma situation actuelle", set: {} }, { label: "Mon scénario", set: { savings_month: par.savings_month, equity_share: par.equity_share, retire_age: par.retire_age, ...(p.housing === "locataire" ? { buy: { enabled: !!par.buy } } : {}) } }],
  },
};

$("#c-list").addEventListener("click", (e) => {
  const b = e.target.closest("[data-c]"); if (!b) return;
  $$("#c-list [data-c]").forEach((x) => x.classList.toggle("on", x === b));
  kind = b.dataset.c; SEL = null; par = DEFS[kind].init(P); setup(); run();
});

function setup() {
  const d = DEFS[kind];
  $("#c-title").textContent = d.title;
  $("#c-params").innerHTML = d.params(P).map(([k, l, mn, mx, st, suf]) =>
    `<label class="cp"><span>${l}</span><b data-o="${k}">${fmt(par[k], suf)}</b><input type="range" data-k="${k}" min="${mn}" max="${mx}" step="${st}" value="${par[k]}"></label>`).join("");
  gsap.fromTo(".c-main > *", { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.4, stagger: 0.04 });
}
const fmt = (v, suf) => (suf === "oui" ? (+v ? "Oui" : "Non") : suf === "€" ? keur(v) : suf === "€ / mois" ? eur(v) + " / mois" : `${(+v).toLocaleString("fr-FR")} ${suf}`);
$("#c-params").addEventListener("input", (e) => {
  const k = e.target.dataset.k; if (!k) return;
  par[k] = +e.target.value;
  const suf = DEFS[kind].params(P).find((x) => x[0] === k)[5];
  $(`[data-o="${k}"]`).textContent = fmt(par[k], suf);
  if (kind === "logement" && k === "price") { const dn = $('[data-k="down"]'); if (par.down > par.price) { par.down = par.price; dn.value = par.down; } }
  clearTimeout(timer); timer = setTimeout(run, 220);
});
$("#c-h").addEventListener("click", (e) => { const b = e.target.closest("[data-h]"); if (b) { H = +b.dataset.h; paint(true); } });

async function run() {
  const d = DEFS[kind];
  $("#c-q").textContent = d.q(P);
  const blocked = d.blocked?.(P);
  $("#c-main-block")?.remove();
  if (blocked) { C = null; d3.select("#c-chart").selectAll("*").remove(); $("#c-cards").innerHTML = `<div class="c-empty">${blocked}</div>`; $("#c-verdict").textContent = ""; return; }
  const my = ++seq;
  $(".c-main").classList.add("busy");
  const r = await fetch("/api/compare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ variants: d.variants(P) }) });
  if (r.status === 401) return (location.href = "/login");
  const res = await r.json();
  if (my !== seq) return;
  $(".c-main").classList.remove("busy");
  const first = !C;
  C = res;
  const ret = C.retire_age - C.age0;
  const opts = [10, 20, 30, 40, 50, 60].filter((h) => h <= C.horizon).map((h) => [h, `+${h} ans`]);
  if (ret > 0 && ret <= C.horizon) opts.push([ret, "Retraite"]);
  opts.sort((a, b) => a[0] - b[0]);
  if (H == null || H > C.horizon) H = ret > 0 && ret <= C.horizon ? ret : Math.min(30, C.horizon);
  $("#c-h").innerHTML = opts.map(([h, t]) => `<button data-h="${h}" title="${C.age0 + h} ans">${t}<small>${C.age0 + h} ans</small></button>`).join("");
  paint(false, first);
}

function paint(onlyH, first) {
  $$("#c-h button").forEach((b) => b.classList.toggle("on", +b.dataset.h === H));
  const svg = d3.select("#c-chart"), W = $("#c-chart").clientWidth, Ht = 230, m = { t: 10, b: 22 };
  const X = d3.scaleLinear([0, C.horizon], [0, W]);
  const Y = d3.scaleLinear([Math.min(0, d3.min(C.variants.flatMap((v) => v.bad))), d3.max(C.variants.flatMap((v) => v.good)) * 1.05], [Ht - m.b, m.t]);
  const line = d3.line().x((d, i) => X(i)).y((d) => Y(d)).curve(d3.curveMonotoneX);
  const area = d3.area().x((d, i) => X(i)).y0((d, i) => Y(d[0])).y1((d) => Y(d[1])).curve(d3.curveMonotoneX);
  if (!svg.select(".ax").node()) {
    svg.append("g").attr("class", "bands"); svg.append("g").attr("class", "lines");
    svg.append("g").attr("class", "ax");
    const mk = svg.append("g").attr("class", "mk"); mk.append("line").attr("y1", m.t).attr("y2", Ht - m.b);
    svg.append("g").attr("class", "dots");
  }
  svg.select(".ax").attr("transform", `translate(0,${Ht - m.b + 4})`).call(d3.axisBottom(X).ticks(7).tickFormat((d) => C.age0 + d + " ans"));
  const t = svg.transition().duration(first ? 0 : 600).ease(d3.easeCubicInOut);
  const bands = svg.select(".bands").selectAll("path").data(C.variants);
  bands.join("path").attr("fill", (d, i) => COLORS[(i + (C.variants.length === 2 ? 1 : 0)) % 4]).attr("opacity", 0.06)
    .transition(t).attr("d", (d) => area(d.bad.map((b, i) => [b, d.good[i]])));
  const lines = svg.select(".lines").selectAll("path").data(C.variants);
  const lj = lines.join("path").attr("fill", "none").attr("stroke-width", 2).attr("stroke", (d, i) => col(i));
  if (first) lj.attr("d", (d) => line(d.mid)).each(function () { const L = this.getTotalLength(); d3.select(this).attr("stroke-dasharray", L).attr("stroke-dashoffset", L).transition().duration(1400).ease(d3.easeCubicOut).attr("stroke-dashoffset", 0).on("end", function () { d3.select(this).attr("stroke-dasharray", null); }); });
  else lj.attr("stroke-dasharray", null).transition(t).attr("d", (d) => line(d.mid));
  svg.select(".mk").transition(t).attr("transform", `translate(${X(H)},0)`);
  svg.select(".dots").selectAll("circle").data(C.variants).join("circle").attr("r", 4.5).attr("fill", (d, i) => col(i))
    .transition(t).attr("cx", X(H)).attr("cy", (d) => Y(d.mid[H]));
  cards(first);
}
const col = (i) => COLORS[(i + (C.variants.length === 2 ? 1 : 0)) % 4];

function cards(first) {
  const base = C.variants[0], age = C.age0 + H, retired = age >= C.retire_age;
  $("#c-cards").classList.add("wallet"); $("#c-cards").style.gridTemplateColumns = "";
  if (SEL == null || SEL >= C.variants.length) SEL = C.variants.length - 1;
  const d = DEFS[kind], vs = d.variants(P);
  $("#c-cards").innerHTML = C.variants.map((v, i) => {
    const diff = v.mid[H] - base.mid[H];
    const s = vs[i].set, current = kind === "composer" ? i === 0 || (s.savings_month === P.savings_month && s.equity_share === P.equity_share && s.retire_age === P.retire_age && (!s.buy || s.buy.enabled === P.buy.enabled)) : !Object.keys(vs[i].set).length || (kind === "logement" && !vs[i].set.buy.enabled && !P.buy.enabled) ||
      (kind === "logement" && vs[i].set.buy.enabled && P.buy.enabled && P.buy.price === par.price && P.buy.down === par.down) ||
      (vs[i].set.savings_month === P.savings_month && vs[i].set.savings_month != null) || (vs[i].set.equity_share === P.equity_share && vs[i].set.equity_share != null) ||
      (vs[i].set.retire_age === P.retire_age && vs[i].set.retire_age != null);
    return `<div class="cc ${i === SEL ? "sel" : ""}" data-w="${i}" style="--c:${col(i)}">
      <div class="cc-hd"><div class="cc-l"><i></i>${v.label}</div>
      <div class="cc-v" data-v="${v.mid[H]}">${keur(v.mid[H])}</div></div><div class="cc-bd">
      <div class="cc-s">patrimoine net médian à ${age} ans</div>
      ${i ? `<div class="cc-d ${diff >= 0 ? "up" : "dn"}">${diff >= 0 ? "+" : "−"}${keur(Math.abs(diff))} par rapport à « ${lc(base.label)} »</div>` : `<div class="cc-d">Référence</div>`}
      <dl><dt>Si les marchés sont défavorables</dt><dd>${keur(v.bad[H])}</dd>
      <dt>Si les marchés sont favorables</dt><dd>${keur(v.good[H])}</dd>
      <dt>Dont logement</dt><dd>${v.home[H] > 1 ? keur(v.home[H]) : "—"}</dd>
      <dt>Complément à la retraite</dt><dd>${v.income ? eur(v.income) + " / mois" : "—"}</dd></dl>
      <div class="cc-act">${current ? `<span class="cc-cur">Ton choix actuel</span>` : `<button class="cc-apply" data-i="${i}">Adopter ce choix</button>`}<button class="cc-more" data-i="${i}">Voir le détail →</button></div>
    </div></div>`;
  }).join("");
  stack(first);
  const best = C.variants.reduce((a, b) => (b.mid[H] > a.mid[H] ? b : a));
  const worst = C.variants.reduce((a, b) => (b.mid[H] < a.mid[H] ? b : a));
  const gap = best.mid[H] - worst.mid[H];
  const badBest = C.variants.reduce((a, b) => (b.bad[H] > a.bad[H] ? b : a));
  $("#c-verdict").innerHTML = gap < 5000
    ? `À ${age} ans, les options se valent à moins de 5 k€ près dans le scénario médian.`
    : `À ${age} ans, <b>${lc(best.label)}</b> laisse en médiane <b>${keur(gap)}</b> de plus que <b>${lc(worst.label)}</b>.` +
      (badBest !== best ? ` Dans les marchés défavorables, c'est en revanche « ${lc(badBest.label)} » qui résiste le mieux.` : "") +
      ` Calcul rejoué sur ${30} séquences de marché réelles (1996-2025), en euros d'aujourd'hui.`;
}
const PEEK = 62;
function stack(first) {
  const els = $$("#c-cards .cc"); if (!els.length) return;
  const others = els.filter((el) => +el.dataset.w !== SEL), sel = els.find((el) => +el.dataset.w === SEL);
  els.forEach((el) => el.classList.toggle("sel", el === sel));
  const top = others.length * PEEK + 14;
  others.forEach((el, k) => { gsap.to(el, { y: k * PEEK, scale: 1 - (others.length - k) * 0.012, zIndex: k + 1, height: PEEK + 30, duration: first ? 0 : 0.55, ease: "power3.inOut" }); });
  const hh = sel.scrollHeight;
  gsap.to(sel, { y: top, scale: 1, zIndex: 10, height: hh, duration: first ? 0 : 0.55, ease: "power3.inOut" });
  $("#c-cards").style.height = top + hh + 6 + "px";
  if (first) gsap.from(els, { y: (i) => 260 + i * 40, opacity: 0, rotationX: -18, transformPerspective: 900, duration: 0.8, stagger: 0.08, ease: "power3.out" });
}
$("#c-cards").addEventListener("click", (e) => {
  const c = e.target.closest(".cc"); if (!c || e.target.closest("button")) return;
  if (+c.dataset.w !== SEL) { SEL = +c.dataset.w; stack(false); }
});
$("#c-cards").addEventListener("click", async (e) => {
  const m = e.target.closest(".cc-more"); if (m) return detail(+m.dataset.i);
  const b = e.target.closest(".cc-apply"); if (!b) return;
  const v = DEFS[kind].variants(P)[+b.dataset.i];
  b.disabled = true; b.textContent = "Enregistrement…";
  const r = await fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v.set) });
  P = await r.json();
  dispatchEvent(new Event("orbit:profile"));
  run();
});

async function init() {
  const r = await fetch("/api/profile"); if (r.status === 401) return;
  P = await r.json(); par = DEFS[kind].init(P); setup(); run();
}
let ready = false;
addEventListener("orbit:view", (e) => { if (e.detail === "choix") { if (!ready) { ready = true; init(); } else if (C) paint(true); } });
addEventListener("orbit:profile", async () => { if (!ready) return; P = await (await fetch("/api/profile")).json(); });
addEventListener("resize", () => C && $("#v-choix").classList.contains("on") && paint(true));

/* ---------- détail d'un scénario ---------- */
function detail(i) {
  const v = C.variants[i], p = v.profile, ret = Math.min(C.horizon, p.retire_age - C.age0), age = (y) => C.age0 + y;
  const st = [...v.by_start].sort((a, b) => a[1] - b[1]), worst = st[0], best = st[st.length - 1], y2000 = v.by_start.find((x) => x[0] === 2000);
  let credit = "";
  if (p.buy?.enabled) {
    const k = p.buy.price - p.buy.down, n = p.buy.years * 12, r = p.buy.rate / 1200, m = r ? (k * r) / (1 - (1 + r) ** -n) : k / n;
    credit = `<h4>Crédit immobilier</h4><dl class="dr-dl"><dt>Montant emprunté</dt><dd>${eur(k)}</dd><dt>Mensualité</dt><dd>${eur(m)}</dd>
      <dt>Intérêts payés sur ${p.buy.years} ans</dt><dd>${eur(m * n - k)}</dd><dt>Coût total du crédit</dt><dd>${eur(m * n)}</dd><dt>Remboursé à</dt><dd>${age(p.buy.in_years + p.buy.years)} ans</dd></dl>`;
  }
  const yrs = Math.max(0, ret), contrib = p.cash + p.invested + p.savings_month * 12 * yrs, gain = Math.max(0, v.fin[ret] - contrib) * p.equity_share / 100;
  const rows = [...new Set([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, ret].filter((y) => y <= C.horizon))].sort((a, b) => a - b);
  $("#c-drawer").style.setProperty("--c", col(i));
  $("#c-drawer").innerHTML = `<button class="dr-x" id="dr-x">×</button>
    <div class="cc-l"><i></i>${v.label}</div><h3>${keur(v.mid[ret])}</h3><p class="dr-s">patrimoine net médian à la retraite, à ${p.retire_age} ans</p>
    <h4>Si tu avais commencé à une autre époque</h4>
    <div class="dr-hist">${[["Pire départ", worst], ["Départ en 2000, bulle internet", y2000], ["Meilleur départ", best]].filter((x) => x[1]).map(([l, x]) => `<div><span>${l}</span><b>${keur(x[1])}</b><small>marchés de ${x[0]} à ${x[0] + 29}</small></div>`).join("")}</div>
    ${credit}
    <h4>Fiscalité, estimation</h4><p class="dr-p">Environ <b>${keur(gain)}</b> de plus-values sur la part actions à la retraite. Imposées à 30 % sur un compte-titres (<b>${keur(gain * 0.3)}</b>), à 17,2 % seulement dans un PEA de plus de 5 ans (<b>${keur(gain * 0.172)}</b>). Le Livret A reste exonéré.</p>
    <h4>Année par année, en euros d'aujourd'hui</h4>
    <table class="dr-t"><thead><tr><th>Âge</th><th>Défavorable</th><th>Médian</th><th>Favorable</th><th>Logement</th></tr></thead><tbody>
    ${rows.map((y) => `<tr class="${y === ret ? "ret" : ""}"><td>${age(y)} ans<small>${C.start_year + y}</small></td><td>${keur(v.bad[y])}</td><td>${keur(v.mid[y])}</td><td>${keur(v.good[y])}</td><td>${v.home[y] > 1 ? keur(v.home[y]) : "—"}</td></tr>`).join("")}</tbody></table>
    <p class="dr-n">${v.by_start.length} séquences de marché réelles (1996-2025) rejouées en boucle. Illustration, pas une promesse de rendement.</p>`;
  $("#c-drawer").classList.add("on"); $("#dr-back").classList.add("on");
  gsap.from("#c-drawer > *", { opacity: 0, x: 16, duration: 0.45, stagger: 0.03, delay: 0.1 });
}
const closeDr = () => { $("#c-drawer").classList.remove("on"); $("#dr-back").classList.remove("on"); };
$("#dr-back").addEventListener("click", closeDr);
$("#c-drawer").addEventListener("click", (e) => e.target.closest("#dr-x") && closeDr());
addEventListener("keydown", (e) => e.key === "Escape" && closeDr());
document.body.append($("#dr-back"), $("#c-drawer"));
