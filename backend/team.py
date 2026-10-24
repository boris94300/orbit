"""L'équipe d'agents : Vigie, Analyste, Stratège, Gardien, Conseiller. Chiffres déterministes, IA seulement pour rédiger."""
import re, statistics, time

import httpx

from . import fees, history, immo, life, llm, risks
from .live import Run, _ecb, _eurostat, _yahoo, _fmt, _keur

STEPS = {"savings_month": [50, 100, 150, 200, 300, 400, 600, 800], "retire_age": [1, 2, 3, 4, 5], "equity_share": [10, 20, 30]}
LABEL = {"savings_month": "Épargner {v} €/mois de plus", "retire_age": "Partir {v} an{s} plus tard", "equity_share": "Passer à {t} % d'actions"}


def _eur(v):
    return f"{'+' if v >= 0 else '−'}{_fmt(abs(v), 0)} €"


def _stats(p, g):
    r = life.project(p)
    inc, ref = r["incomes"], r["ref"]
    return {"net": r["scenarios"]["mid"]["rows"][ref]["net"], "med": inc[len(inc) // 2], "prob": sum(x >= g for x in inc) / len(inc) if g else 1.0}


def guard(p, opt):
    q, age, out = opt["profile"], 2026 - p["birth_year"], []
    inc = max(1, q["income_month"])
    rate = q["savings_month"] / inc
    if rate > 0.45:
        out.append(("block", f"Effort d'épargne de {round(rate * 100)} % des revenus : intenable sur la durée."))
    elif rate > 0.3:
        out.append(("warn", f"Effort d'épargne de {round(rate * 100)} % des revenus : élevé, vérifie ton budget."))
    cap = max(30, 110 - age)
    if q["equity_share"] > cap:
        out.append(("block", f"{q['equity_share']} % d'actions à {age} ans dépasse ton profil de risque (plafond {cap} %)."))
    if q["retire_age"] > 67:
        out.append(("warn", f"Travailler jusqu'à {q['retire_age']} ans : à confirmer avec ta caisse de retraite."))
    months = q["cash"] / max(1, inc - q["savings_month"])
    if months < 3:
        out.append(("warn", f"Épargne de précaution de {_fmt(months, 1)} mois de dépenses, sous les 3 mois conseillés."))
    if q["buy"]["enabled"]:
        pay = life._payment(q["buy"]["price"] - q["buy"]["down"], q["buy"]["rate"], q["buy"]["years"])
        if pay / inc > 0.35:
            out.append(("block", f"Endettement de {round(pay / inc * 100)} % : au-delà des 35 % autorisés (règle HCSF)."))
    v = "block" if any(k == "block" for k, _ in out) else "warn" if out else "ok"
    return v, [t for _, t in out] or ["Budget, profil de risque et précaution respectés."]


async def run(R: Run, p):
    s = R.summary
    s.update(alerts=[], options=[], data=[], note=None, mode=llm.mode())
    g = p.get("goal_month") or 0
    age, name = 2026 - p["birth_year"], p["first_name"] or "toi"
    try:
        async with httpx.AsyncClient() as c:
            # Vigie
            await R.emit("vigie", "start", "Je surveille l'actualité économique et ne garde que ce qui te concerne")
            dfr = await R.call(c, "vigie", "Taux de dépôt BCE", "https://data-api.ecb.europa.eu/service/data/FM/B.U2.EUR.4F.KR.DFR.LEV", {"lastNObservations": 1, "format": "csvdata"}, _ecb)
            estr = await R.call(c, "vigie", "€STR, taux au jour le jour", "https://data-api.ecb.europa.eu/service/data/EST/B.EU000A2X2A25.WT", {"lastNObservations": 1, "format": "csvdata"}, _ecb)
            infl = await R.call(c, "vigie", "Inflation France (Eurostat)", "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_manr", {"geo": "FR", "coicop": "CP00", "lastTimePeriod": 1}, _eurostat)
            cac = await R.call(c, "vigie", "CAC 40", "https://query1.finance.yahoo.com/v8/finance/chart/%5EFCHI", {"range": "5d", "interval": "1d"}, _yahoo)
            spx = await R.call(c, "vigie", "S&P 500", "https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC", {"range": "5d", "interval": "1d"}, _yahoo)
            h = history.load()["years"]
            real = statistics.geometric_mean([(1 + y["equity"]) / (1 + y["infl"]) for y in h]) - 1
            yrs = max(1, p["retire_age"] - age)
            infl_avg = statistics.mean(y["infl"] for y in h) * 100
            ch = [(v["value"] / v["prev"] - 1) for v in (spx, cac) if v and v.get("prev")]
            if len(ch) == 2:
                move = 0.6 * ch[0] + 0.4 * ch[1]
                today = p["invested"] * p["equity_share"] / 100 * move
                fut = today * (1 + real) ** yrs
                await R.emit("vigie", "calc", "Effet de la séance sur tes placements", formula=f"{_fmt(p['invested'], 0)} € × {p['equity_share']} % actions × ({_fmt(move * 100)} %) = {_eur(today)} aujourd'hui",
                             lines=[f"projeté à {p['retire_age']} ans : × (1 + {_fmt(real * 100, 1)} %)^{yrs} = {_eur(fut)} (rendement réel historique)"])
                if abs(move) > 0.004:
                    s["alerts"].append({"title": f"Bourse {'en hausse' if move > 0 else 'en baisse'} de {_fmt(abs(move) * 100, 1)} %", "text": f"{_eur(today)} sur tes placements aujourd'hui. Sur le long terme, une séance pèse peu : rien à faire.", "effect": fut, "src": "Yahoo Finance"})
            if infl:
                gap = infl["value"] - infl_avg
                await R.emit("vigie", "calc", "Inflation comparée à la moyenne 1996-2025", formula=f"{_fmt(infl['value'])} % − {_fmt(infl_avg)} % = {'+' if gap >= 0 else ''}{_fmt(gap)} pt")
            if estr and infl:
                la = max(0.5, round((estr["value"] + infl["value"]) / 2 * 10) / 10)
                gain = p["cash"] * (la - infl["value"]) / 100
                await R.emit("vigie", "calc", "Taux du Livret A selon la formule de la Banque de France", formula=f"(€STR {_fmt(estr['value'])} % + inflation {_fmt(infl['value'])} %) / 2 = {_fmt(la, 1)} %",
                             lines=[f"rendement réel de tes livrets : {_fmt(p['cash'], 0)} € × ({_fmt(la, 1)} % − {_fmt(infl['value'])} %) = {_eur(gain)} de pouvoir d'achat par an"])
                s["alerts"].append({"title": f"Inflation à {_fmt(infl['value'], 1)} %, Livret A vers {_fmt(la, 1)} %",
                                    "text": f"Inflation {'sous' if gap < 0 else 'au-dessus de'} sa moyenne historique ({_fmt(infl_avg, 1)} %). Tes {_fmt(p['cash'], 0)} € de livrets {'gagnent' if gain >= 0 else 'perdent'} {_fmt(abs(gain), 0)} € de pouvoir d'achat par an.",
                                    "effect": gain * yrs, "src": f"BCE · Eurostat {infl['date']}"})
            elif infl:
                loss = p["cash"] * infl["value"] / 100
                s["alerts"].append({"title": f"Inflation à {_fmt(infl['value'], 1)} %", "text": f"Tes {_fmt(p['cash'], 0)} € de livrets perdent jusqu'à {_fmt(loss, 0)} € de pouvoir d'achat par an.", "effect": -loss * yrs, "src": "Eurostat"})
            await R.emit("vigie", "result", f"{len(s['alerts'])} information{'s' if len(s['alerts']) > 1 else ''} te concernent aujourd'hui")
            await R.emit("vigie", "handoff", f"Voici ce qui bouge aujourd'hui pour {name}. Que change son futur ?", to="analyste")

            # Analyste
            await R.emit("analyste", "start", f"Je rejoue les 30 dernières années de marché sur la vie de {name}")
            t0 = time.perf_counter()
            base = _stats(p, g)
            await R.emit("analyste", "calc", f"Projection sur {len(h)} séquences historiques en {round((time.perf_counter() - t0) * 1000)} ms",
                         formula=f"patrimoine médian à {p['retire_age']} ans : {_keur(base['net'])} · revenu médian : {_fmt(base['med'], 0)} €/mois")
            s["projection"] = {"age": p["retire_age"], "net": base["net"], "med": base["med"], "prob": base["prob"], "goal": g}
            if g:
                await R.emit("analyste", "result", f"Objectif {_fmt(g, 0)} €/mois : {round(base['prob'] * 100)} % de chances de l'atteindre")
            target = 0.75 if base["prob"] < 0.75 else 0.9
            s["target"] = target
            secured = not g or base["prob"] >= target
            await R.emit("analyste", "handoff", (f"Objectif sécurisé à {round(base['prob'] * 100)} %. Cherche ce qui coûte de l'argent à {name} et ce qu'il peut s'offrir." if secured
                         else f"{round(base['prob'] * 100)} % de chances seulement. Trouve comment passer à {round(target * 100)} %, avec le moins d'efforts."), to="stratege")
            # Stratège
            found, tries = [], 0
            await R.emit("stratege", "start", "J'examine tes frais, tes enveloppes, l'immobilier de ta ville et tes leviers")
            fz = fees.annual(p)
            await R.emit("stratege", "calc", f"Frais actuels · {fz['broker']}", formula=f"{_fmt(p['savings_month'] * p['equity_share'] / 100, 0)} €/mois investis → {_eur(-fz['orders'])}/an d'ordres + {_fmt(fz['ter'] * 100)} %/an sur l'encours" + (f" + {_eur(-fz['sub'])}/an d'abonnement" if fz["sub"] else ""), lines=[fz["note"], f"source : {fz['src']}"])
            proj = life.project(p)
            paid = proj["scenarios"]["mid"]["rows"][proj["ref"]]["fees"]
            alts = []
            for k, br in fees.BROKERS.items():
                if k in (p.get("broker"), "degiro_actions"):
                    continue
                q = life.merge(p, {"broker": k})
                st = _stats(q, g)
                tries += 1
                alts.append((st["net"] - base["net"], k, br, st, q))
                await R.emit("stratege", "try", f"{br['name']} → {_keur(st['net'])} à {p['retire_age']} ans ({_eur(st['net'] - base['net'])})", ok=st["net"] > base["net"] + 5000)
            alts.sort(key=lambda x: -x[0])
            s["fees"] = {"broker": fz["broker"], "note": fz["note"], "src": fz["src"], "paid": paid, "sub": fz["sub"], "orders": fz["orders"], "ter": fz["ter"],
                         "alts": [{"name": br["name"], "gain": d, "note": br["note"], "src": br["src"]} for d, k, br, st, q in alts], "cfd": fees.CFD_WARNING, "sources": fees.SOURCES}
            if p.get("tool", "aucun") != "aucun":
                q = life.merge(p, {"tool": "aucun"})
                st = _stats(q, g)
                found.append({"lever": "tool", "set": {"tool": "aucun"}, "profile": q, "st": st, "title": f"Résilier {fees.TOOLS[p['tool']]['name']}"})
            if alts and alts[0][0] > 5000:
                d, k, br, st, q = alts[0]
                found.append({"lever": "broker", "set": {"broker": k}, "profile": q, "st": st, "title": f"Passer à : {br['name']}"})
            await R.emit("stratege", "result", f"Tes frais te coûteront {_keur(paid)} d'ici {p['retire_age']} ans" + (f" · {_keur(alts[0][0])} récupérables" if alts and alts[0][0] > 5000 else ""))
            if p["housing"] == "locataire":
                im = await immo.lookup(R, c, "stratege", p["city"])
                if im:
                    cap = immo.capacity(p, im["med"])
                    await R.emit("stratege", "calc", f"Capacité d'achat à {im['city']}", formula=f"mensualité max 35 % × {_fmt(p['income_month'], 0)} € = {_fmt(cap['pay'], 0)} € → prêt {_keur(cap['loan'])} sur {cap['years']} ans à {_fmt(cap['rate'])} %",
                                 lines=[f"apport mobilisable {_keur(cap['down'])} (précaution de 3 mois gardée), frais de notaire 7,5 %", f"prix médian {_fmt(im['med'], 0)} €/m² sur {im['n']} ventes d'appartements en {im['year']}"])
                    s["immo"] = dict(im, **cap)
                    await R.emit("stratege", "result", f"À {im['city']}, tu peux viser environ {_fmt(cap['m2'], 0)} m² ({_keur(cap['price'])}) au prix médian de {_fmt(im['med'], 0)} €/m²")
            if not secured:
                for k, steps in STEPS.items():
                    for d in steps:
                        v = p[k] + d
                        if k == "equity_share" and v > 100 or k == "retire_age" and v > 70:
                            break
                        q = life.merge(p, {k: v})
                        st = _stats(q, g)
                        tries += 1
                        ok = st["prob"] >= target
                        await R.emit("stratege", "try", f"{LABEL[k].format(v=d, s='s' if d > 1 else '', t=v)} → {round(st['prob'] * 100)} %", ok=ok)
                        if ok:
                            found.append({"lever": k, "d": d, "set": {k: v}, "profile": q, "st": st, "title": LABEL[k].format(v=d, s="s" if d > 1 else "", t=v)})
                            break
                    else:
                        await R.emit("stratege", "calc", f"Levier « {k.replace('_', ' ')} » insuffisant à lui seul")
            else:
                best = next((f["profile"] for f in found if f["lever"] == "broker"), p)
                early = None
                for d in range(1, 6):
                    if best["retire_age"] - d < 60:
                        break
                    q = life.merge(best, {"retire_age": best["retire_age"] - d})
                    st = _stats(q, g)
                    tries += 1
                    ok = st["prob"] >= 0.9
                    await R.emit("stratege", "try", f"Partir {d} an{'s' if d > 1 else ''} plus tôt{' (avec les frais réduits)' if best is not p else ''} → {round(st['prob'] * 100)} %", ok=ok)
                    if not ok:
                        break
                    early = (d, q, st)
                if early:
                    d, q, st = early
                    found.append({"lever": "early", "set": {"retire_age": q["retire_age"], "broker": q["broker"]}, "profile": q, "st": st, "title": f"Partir à {q['retire_age']} ans" + (" en réduisant tes frais" if q["broker"] != p["broker"] else "")})
            await R.emit("stratege", "result", f"{tries} combinaisons testées, {len(found)} solution{'s' if len(found) > 1 else ''} retenue{'s' if len(found) > 1 else ''}")
            await R.emit("stratege", "handoff", "Voici mes solutions. Vérifie qu'elles sont sans risque, et teste les coups durs de la vie.", to="gardien")
            # Gardien
            await R.emit("gardien", "start", "Je vérifie chaque solution, puis je teste les coups durs de la vie sur ta trajectoire")
            for f in found:
                v, why = guard(p, f)
                await R.emit("gardien", "check", f"{f['title']} : {'validée' if v == 'ok' else 'validée avec réserve' if v == 'warn' else 'bloquée'}", ok=v != "block", lines=why)
                s["options"].append({"title": f["title"], "set": f["set"], "verdict": v, "why": why, "prob": f["st"]["prob"], "gain": f["st"]["net"] - base["net"], "med": f["st"]["med"]})
            s["risks"] = risks.assess(p, g, _stats)
            for r in s["risks"]:
                await R.emit("gardien", "calc", f"Coup dur testé : {r['title'].lower()} à {r['age']} ans", formula=f"{r['how']} → {_eur(r['loss'])} à {r['at']} ans" + (f" · chances {round(r['prob0'] * 100)} % → {round(r['prob'] * 100)} %" if r.get("prob") is not None else ""), lines=[r["stat"]])
            worst = min(s["risks"], key=lambda r: r["loss"]) if s["risks"] else None
            n_ok = sum(o["verdict"] != "block" for o in s["options"])
            await R.emit("gardien", "result", f"{n_ok} solution{'s' if n_ok > 1 else ''} autorisée{'s' if n_ok > 1 else ''}" + (f" · coup dur le plus lourd : {worst['title'].lower()} ({_keur(worst['loss'])})" if worst else ""))
            await R.emit("gardien", "handoff", "Solutions contrôlées et risques chiffrés. Explique-les simplement.", to="conseiller")

            # Conseiller
            await R.emit("conseiller", "start", "Je rédige ta synthèse en langage clair")
            facts = _facts(p, s)
            note = None
            if s["mode"] != "règles":
                t0 = time.perf_counter()
                await R.emit("conseiller", "call", f"Rédaction par {s['mode']}", url={"Mistral": "POST https://api.mistral.ai/v1/chat/completions", "Claude": "POST https://api.anthropic.com/v1/messages"}.get(s["mode"], s["mode"]))
                note = await llm.write(facts)
                ms = round((time.perf_counter() - t0) * 1000)
                if note and llm.guard(facts, note):
                    await R.emit("conseiller", "data", f"Réponse reçue en {ms} ms · chiffres vérifiés un par un : conformes")
                else:
                    await R.emit("conseiller", "error", "Texte rejeté (chiffre absent des calculs) : synthèse par règles utilisée" if note else "Modèle indisponible : synthèse par règles utilisée")
                    note = None
            s["note"] = note or facts
            await R.emit("conseiller", "result", "Synthèse prête. Rien n'est appliqué sans ta validation.")
    except Exception as e:  # noqa: BLE001
        await R.emit("conseiller", "error", f"Analyse interrompue : {type(e).__name__}")
    R.done = True


def _facts(p, s):
    pr = s.get("projection") or {}
    out = [f"À {pr.get('age')} ans, ton patrimoine médian serait de {_keur(pr.get('net', 0))}, avec un revenu de {_fmt(pr.get('med', 0), 0)} € par mois."]
    if pr.get("goal"):
        out.append(f"Tu as {round(pr['prob'] * 100)} % de chances d'atteindre ton objectif de {_fmt(pr['goal'], 0)} € par mois.")
    fz = s.get("fees")
    if fz and fz["paid"] > 1000:
        out.append(f"Tes frais de placement te coûteront environ {_keur(fz['paid'])} d'ici la retraite.")
    ok = [o for o in s["options"] if o["verdict"] != "block"]
    if ok:
        b = ok[0]
        out.append(f"La solution la plus utile : {b['title'][0].lower() + b['title'][1:]}, qui te laisserait {_keur(b['gain'])} de plus à la retraite, avec {round(b['prob'] * 100)} % de chances d'atteindre ton objectif.")
    bl = [o for o in s["options"] if o["verdict"] == "block"]
    if bl:
        out.append(f"La piste « {bl[0]['title'].lower()} » a été écartée : {bl[0]['why'][0][0].lower() + bl[0]['why'][0][1:]}")
    return " ".join(out)


TOOLS = [
    {"type": "function", "function": {"name": "simuler", "description": "Recalcule la retraite du client avec des changements (les champs absents restent inchangés). Renvoie chances d'atteindre l'objectif, revenu médian, patrimoine médian à la retraite, mensualité et contrôle de risque.",
     "parameters": {"type": "object", "properties": {
         "epargne_mois": {"type": "number", "description": "épargne mensuelle totale en euros"},
         "part_actions": {"type": "number", "description": "part en actions, en %"},
         "age_retraite": {"type": "number"},
         "achat_prix": {"type": "number", "description": "prix d'un logement à acheter, en euros"},
         "achat_dans_ans": {"type": "number", "description": "achat dans combien d'années"},
         "achat_apport": {"type": "number", "description": "apport en euros"},
         "objectif_eur_mois": {"type": "number", "description": "revenu visé à la retraite, si différent de l'objectif du profil"}}}}},
    {"type": "function", "function": {"name": "epargne_necessaire", "description": "Calcule l'épargne mensuelle minimale pour atteindre un revenu visé à la retraite avec une probabilité donnée.",
     "parameters": {"type": "object", "properties": {
         "objectif_eur_mois": {"type": "number"}, "chances_pct": {"type": "number", "description": "probabilité visée, 50 par défaut"},
         "age_retraite": {"type": "number"}}, "required": ["objectif_eur_mois"]}}},
]
ASK = ("Tu es le Conseiller d'Orbit, une app bancaire qui projette l'avenir financier d'un particulier. Tu tutoies, en français simple. "
       "Pour tout chiffre, appelle l'outil simuler : n'invente jamais un nombre, utilise uniquement ceux du profil ou de l'outil. "
       "Si tu suggères un levier (épargne, âge, actions), simule-le d'abord et cite son effet ; n'affirme aucun effet non calculé. "
       "Un taux d'endettement est acceptable jusqu'à 35 %. 4 phrases maximum, texte brut sans markdown, sans titre ni emoji ni liste. "
       "Termine par ce que tu conseilles de faire. Tu ne passes aucun ordre réel.")


def simulate(p, a):
    over = {}
    for k, f in (("epargne_mois", "savings_month"), ("part_actions", "equity_share"), ("age_retraite", "retire_age")):
        if a.get(k) is not None:
            over[f] = a[k]
    if a.get("achat_prix"):
        over["buy"] = {"enabled": True, "price": a["achat_prix"], "in_years": a.get("achat_dans_ans", p["buy"]["in_years"]), "down": a.get("achat_apport", p["buy"]["down"])}
        if p["housing"] != "locataire":
            over["housing"] = "locataire"
    q = life.merge(p, over)
    g = a.get("objectif_eur_mois") or p.get("goal_month") or 0
    st, base = _stats(q, g), _stats(p, g)
    v, why = guard(p, {"profile": q})
    out = {"chances_objectif_pct": round(st["prob"] * 100), "chances_situation_actuelle_pct": round(base["prob"] * 100), "revenu_median_situation_actuelle_eur_mois": round(base["med"]), "objectif_eur_mois": g, "revenu_median_retraite_eur_mois": round(st["med"]),
           "patrimoine_median_retraite_eur": round(st["net"], -3), "ecart_vs_aujourdhui_eur": round(st["net"] - base["net"], -3), "age_retraite": q["retire_age"],
           "controle": {"ok": "validé", "warn": "validé avec réserve", "block": "bloqué"}[v], "raisons": why}
    if q["buy"]["enabled"]:
        pay = life._payment(q["buy"]["price"] - q["buy"]["down"], q["buy"]["rate"], q["buy"]["years"])
        out["note"] = f"Le logement acheté n'est pas compté dans ce revenu : à la retraite, plus de loyer à payer ({round(p['rent_month'])} €/mois aujourd'hui) et un bien de {round(q['buy']['price'])} € en patrimoine."
        out.update(mensualite_credit_eur=round(pay), taux_endettement_pct=round(pay / max(1, q["income_month"]) * 100), taux_credit_pct=q["buy"]["rate"], duree_ans=q["buy"]["years"])
    return out


def needed(p, a):
    g, target = a.get("objectif_eur_mois") or p.get("goal_month") or 0, (a.get("chances_pct") or 50) / 100
    q0 = life.merge(p, {"retire_age": a["age_retraite"]}) if a.get("age_retraite") else p
    if not g:
        return {"erreur": "objectif manquant"}
    prob = lambda sv: _stats(life.merge(q0, {"savings_month": sv}), g)["prob"]
    lo, hi = 0, 20000
    if prob(hi) < target:
        return {"objectif_eur_mois": g, "atteignable": False, "message": "objectif hors de portée même avec 20 000 €/mois"}
    while hi - lo > 10:
        mid = (lo + hi) / 2
        lo, hi = (lo, mid) if prob(mid) >= target else (mid, hi)
    sv = round(hi / 10) * 10
    q = life.merge(q0, {"savings_month": sv})
    v, why = guard(p, {"profile": q})
    return {"objectif_eur_mois": g, "chances_pct": round(target * 100), "age_retraite": q["retire_age"], "epargne_necessaire_eur_mois": sv,
            "epargne_actuelle_eur_mois": round(p["savings_month"]), "effort_supplementaire_eur_mois": round(sv - p["savings_month"]),
            "part_des_revenus_pct": round(sv / max(1, p["income_month"]) * 100), "controle": {"ok": "validé", "warn": "validé avec réserve", "block": "bloqué"}[v], "raisons": why}


def _profile_text(p):
    return (f"Profil : {p['first_name']}, {2026 - p['birth_year']} ans, {p['city']}, revenu {round(p['income_month'])} €/mois, épargne {round(p['savings_month'])} €/mois, "
            f"livrets {round(p['cash'])} €, placements {round(p['invested'])} € dont {p['equity_share']} % actions, logement : {p['housing']}, loyer {round(p['rent_month'])} €/mois, "
            f"retraite visée à {p['retire_age']} ans, objectif {round(p.get('goal_month') or 0)} €/mois. "
            f"Hypothèses de crédit par défaut : apport {round(p['buy']['down'])} €, taux {p['buy']['rate']} %, durée {p['buy']['years']} ans.")


def _run_tool(p, name, args):
    return needed(p, args) if name == "epargne_necessaire" else simulate(p, args)


async def ask_claude(p, question, history_msgs=None):
    import json
    trace, t0 = [], time.perf_counter()
    tools = [{"name": t["function"]["name"], "description": t["function"]["description"], "input_schema": t["function"]["parameters"]} for t in TOOLS]
    hist = [{"role": m["role"], "content": str(m["content"])} for m in (history_msgs or [])[-6:] if m.get("role") in ("user", "assistant") and m.get("content")]
    while hist and hist[0]["role"] != "user":
        hist.pop(0)
    msgs = hist + [{"role": "user", "content": question[:600]}]
    for _ in range(4):
        d = await llm.claude(ASK + "\n" + _profile_text(p), msgs, tools)
        uses = [b for b in d["content"] if b["type"] == "tool_use"]
        if not uses:
            src = _profile_text(p) + json.dumps([t["result"] for t in trace], ensure_ascii=False)
            ans = llm._clean("".join(b.get("text", "") for b in d["content"]))
            return {"answer": ans, "trace": trace, "checked": llm.guard(src + question, ans), "ms": round((time.perf_counter() - t0) * 1000), "model": d.get("model")}
        msgs.append({"role": "assistant", "content": d["content"]})
        out = []
        for b in uses:
            res = _run_tool(p, b["name"], b.get("input") or {})
            trace.append({"tool": b["name"], "args": b.get("input") or {}, "result": res})
            out.append({"type": "tool_result", "tool_use_id": b["id"], "content": json.dumps(res, ensure_ascii=False)})
        msgs.append({"role": "user", "content": out})
    return {"answer": "Je n'ai pas réussi à conclure, reformule ta question.", "trace": trace, "checked": True, "ms": 0}


async def ask(p, question, history_msgs=None):
    import json
    if llm.mode() == "Claude":
        return await ask_claude(p, question, history_msgs)
    trace, t0 = [], time.perf_counter()
    msgs = [{"role": "system", "content": ASK + "\n" + _profile_text(p)}] + (history_msgs or [])[-6:] + [{"role": "user", "content": question[:600]}]
    for _ in range(4):
        d = await llm.mistral(msgs, TOOLS)
        m = d["choices"][0]["message"]
        calls = m.get("tool_calls") or []
        if not calls:
            src = _profile_text(p) + json.dumps([t["result"] for t in trace], ensure_ascii=False)
            ans = (m.get("content") or "").replace("**", "").replace("__", "").strip()
            return {"answer": ans, "trace": trace, "checked": llm.guard(src + question, ans), "ms": round((time.perf_counter() - t0) * 1000), "model": d.get("model")}
        msgs.append({"role": "assistant", "content": m.get("content") or "", "tool_calls": calls})
        for c in calls:
            try:
                args = json.loads(c["function"]["arguments"] or "{}")
            except Exception:
                args = {}
            res = needed(p, args) if c["function"]["name"] == "epargne_necessaire" else simulate(p, args)
            trace.append({"tool": c["function"]["name"], "args": args, "result": res})
            msgs.append({"role": "tool", "name": c["function"]["name"], "content": json.dumps(res, ensure_ascii=False), "tool_call_id": c["id"]})
    return {"answer": "Je n'ai pas réussi à conclure, reformule ta question.", "trace": trace, "checked": True, "ms": 0}


def _n(t):
    t = t.replace("\u202f", " ").replace("\xa0", " ").lower()
    m = re.search(r"(\d[\d ]*(?:[.,]\d+)?)\s*(k|m|000)?\s*(?:k€|€|euros?)", t)
    if not m:
        return None
    v = float(m.group(1).replace(" ", "").replace(",", "."))
    return v * 1000 if m.group(2) == "k" else v * 1e6 if m.group(2) == "m" else v


def local(p, q):
    """Sans modèle distant : détecte l'intention par règles, calcule avec le moteur, rédige une réponse sûre."""
    t, trace = q.lower(), []
    yrs = re.search(r"dans\s+(\d{1,2})\s*ans?", t)
    age = re.search(r"(\d{2})\s*ans", t)
    num = _n(q)
    if re.search(r"achet|acqu|appartement|maison|immobili|logement", t) and num:
        a = {"achat_prix": num if num > 20000 else num * 1000}
        if yrs:
            a["achat_dans_ans"] = int(yrs.group(1))
        r = simulate(p, a)
        trace.append({"tool": "simuler", "args": a, "result": r})
        ans = (f"Pour un achat à {_fmt(a['achat_prix'], 0)} €, la mensualité serait de {_fmt(r['mensualite_credit_eur'], 0)} €, soit {r['taux_endettement_pct']} % de ton revenu "
               f"({'au-delà' if r['taux_endettement_pct'] > 35 else 'en dessous'} de la limite de 35 %). Tes chances d'atteindre ton objectif de retraite passeraient de {r['chances_situation_actuelle_pct']} % à {r['chances_objectif_pct']} %. "
               f"Contrôle du Gardien : {r['controle']}.")
    elif re.search(r"combien|épargn|epargn|mettre de côté", t) and num and re.search(r"mois|retraite", t):
        a = {"objectif_eur_mois": num}
        r = needed(p, a)
        trace.append({"tool": "epargne_necessaire", "args": a, "result": r})
        ans = (f"Pour viser {_fmt(num, 0)} €/mois à la retraite avec {r['chances_pct']} % de chances, il faut épargner {_fmt(r['epargne_necessaire_eur_mois'], 0)} €/mois, "
               f"soit {r['effort_supplementaire_eur_mois']:+d} € par rapport à aujourd'hui ({r['part_des_revenus_pct']} % de ton revenu). Contrôle du Gardien : {r['controle']}."
               if r.get("epargne_necessaire_eur_mois") is not None else r.get("message") or r.get("erreur"))
    elif re.search(r"retraite|partir|arrêter|arreter", t) and age and 50 <= int(age.group(1)) <= 75:
        a = {"age_retraite": int(age.group(1))}
        r = simulate(p, a)
        trace.append({"tool": "simuler", "args": a, "result": r})
        ans = (f"En partant à {a['age_retraite']} ans, ton revenu médian à la retraite serait de {_fmt(r['revenu_median_retraite_eur_mois'], 0)} €/mois, "
               f"avec {r['chances_objectif_pct']} % de chances d'atteindre ton objectif (contre {r['chances_situation_actuelle_pct']} % aujourd'hui). Contrôle du Gardien : {r['controle']}.")
    else:
        r = simulate(p, {})
        trace.append({"tool": "simuler", "args": {}, "result": r})
        ans = (f"Aujourd'hui, ton revenu médian à la retraite est estimé à {_fmt(r['revenu_median_retraite_eur_mois'], 0)} €/mois et tu as {r['chances_objectif_pct']} % de chances "
               f"d'atteindre ton objectif. Pose-moi une question sur un achat, ton épargne ou ton âge de départ pour que je la calcule.")
    import json
    return {"answer": ans, "trace": trace, "facts": _profile_text(p) + " Résultats du moteur : " + json.dumps([x["result"] for x in trace], ensure_ascii=False)}
