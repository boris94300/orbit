"""L'équipe d'agents : Vigie, Analyste, Stratège, Gardien, Conseiller. Chiffres déterministes, IA seulement pour rédiger."""
import statistics, time

import httpx

from . import history, life, llm
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
            if not g or base["prob"] >= 0.999:
                await R.emit("analyste", "handoff", "Objectif déjà sécurisé dans tous les scénarios. Rien à optimiser.", to="stratege")
            else:
                await R.emit("analyste", "handoff", f"{round(base['prob'] * 100)} % de chances seulement. Trouve comment passer à {round(target * 100)} %, avec le moins d'efforts.", to="stratege")
                # Stratège
                await R.emit("stratege", "start", f"Je teste des combinaisons pour atteindre {round(target * 100)} % de chances")
                found, tries = [], 0
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
                sav = next((f for f in found if f["lever"] == "savings_month"), None)
                if sav and sav["d"] >= 100:
                    for d in [x for x in STEPS["savings_month"] if x < sav["d"]]:
                        q = life.merge(p, {"savings_month": p["savings_month"] + d, "retire_age": p["retire_age"] + 1})
                        st = _stats(q, g)
                        tries += 1
                        ok = st["prob"] >= target
                        await R.emit("stratege", "try", f"Combiné : +{d} €/mois et 1 an plus tard → {round(st['prob'] * 100)} %", ok=ok)
                        if ok:
                            found.append({"lever": "mix", "set": {"savings_month": p["savings_month"] + d, "retire_age": p["retire_age"] + 1}, "profile": q, "st": st, "title": f"+{d} €/mois et partir 1 an plus tard"})
                            break
                await R.emit("stratege", "result", f"{tries} combinaisons testées, {len(found)} solution{'s' if len(found) > 1 else ''} retenue{'s' if len(found) > 1 else ''}")
                await R.emit("stratege", "handoff", "Voici mes solutions. Vérifie qu'elles sont sans risque avant de les proposer.", to="gardien")
                # Gardien
                await R.emit("gardien", "start", "Je vérifie chaque solution : budget, profil de risque, endettement, précaution")
                for f in found:
                    v, why = guard(p, f)
                    await R.emit("gardien", "check", f"{f['title']} : {'validée' if v == 'ok' else 'validée avec réserve' if v == 'warn' else 'bloquée'}", ok=v != "block", lines=why)
                    s["options"].append({"title": f["title"], "set": f["set"], "verdict": v, "why": why, "prob": f["st"]["prob"], "gain": f["st"]["net"] - base["net"], "med": f["st"]["med"]})
                n_ok = sum(o["verdict"] != "block" for o in s["options"])
                await R.emit("gardien", "result", f"{n_ok} solution{'s' if n_ok > 1 else ''} autorisée{'s' if n_ok > 1 else ''}, {len(s['options']) - n_ok} bloquée{'s' if len(s['options']) - n_ok > 1 else ''}")
                await R.emit("gardien", "handoff", "Solutions contrôlées. Explique-les simplement.", to="conseiller")

            # Conseiller
            await R.emit("conseiller", "start", "Je rédige ta synthèse en langage clair")
            facts = _facts(p, s)
            note = None
            if s["mode"] != "règles":
                t0 = time.perf_counter()
                await R.emit("conseiller", "call", f"Rédaction par {s['mode']}", url="POST https://api.mistral.ai/v1/chat/completions" if s["mode"] == "Mistral" else s["mode"])
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
    ok = [o for o in s["options"] if o["verdict"] != "block"]
    if ok:
        b = ok[0]
        out.append(f"La solution la plus simple : {b['title'].lower()}, ce qui porte tes chances à {round(b['prob'] * 100)} %.")
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
         "achat_apport": {"type": "number", "description": "apport en euros"}}}}},
]
ASK = ("Tu es le Conseiller d'Orbit, une app bancaire qui projette l'avenir financier d'un particulier. Tu tutoies, en français simple. "
       "Pour tout chiffre, appelle l'outil simuler : n'invente jamais un nombre, utilise uniquement ceux du profil ou de l'outil. "
       "4 phrases maximum, sans titre ni emoji ni liste. Termine par ce que tu conseilles de faire. Tu ne passes aucun ordre réel.")


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
    g = p.get("goal_month") or 0
    st, base = _stats(q, g), _stats(p, g)
    v, why = guard(p, {"profile": q})
    out = {"chances_objectif_pct": round(st["prob"] * 100), "objectif_eur_mois": g, "revenu_median_retraite_eur_mois": round(st["med"]),
           "patrimoine_median_retraite_eur": round(st["net"], -3), "ecart_vs_aujourdhui_eur": round(st["net"] - base["net"], -3), "age_retraite": q["retire_age"],
           "controle": {"ok": "validé", "warn": "validé avec réserve", "block": "bloqué"}[v], "raisons": why}
    if q["buy"]["enabled"]:
        pay = life._payment(q["buy"]["price"] - q["buy"]["down"], q["buy"]["rate"], q["buy"]["years"])
        out.update(mensualite_credit_eur=round(pay), taux_endettement_pct=round(pay / max(1, q["income_month"]) * 100), taux_credit_pct=q["buy"]["rate"], duree_ans=q["buy"]["years"])
    return out


def _profile_text(p):
    return (f"Profil : {p['first_name']}, {2026 - p['birth_year']} ans, {p['city']}, revenu {round(p['income_month'])} €/mois, épargne {round(p['savings_month'])} €/mois, "
            f"livrets {round(p['cash'])} €, placements {round(p['invested'])} € dont {p['equity_share']} % actions, logement : {p['housing']}, loyer {round(p['rent_month'])} €/mois, "
            f"retraite visée à {p['retire_age']} ans, objectif {round(p.get('goal_month') or 0)} €/mois.")


async def ask(p, question, history_msgs=None):
    import json
    trace, t0 = [], time.perf_counter()
    msgs = [{"role": "system", "content": ASK + "\n" + _profile_text(p)}] + (history_msgs or [])[-6:] + [{"role": "user", "content": question[:600]}]
    for _ in range(4):
        d = await llm.mistral(msgs, TOOLS)
        m = d["choices"][0]["message"]
        calls = m.get("tool_calls") or []
        if not calls:
            src = _profile_text(p) + json.dumps([t["result"] for t in trace], ensure_ascii=False)
            ans = (m.get("content") or "").strip()
            return {"answer": ans, "trace": trace, "checked": llm.guard(src + question, ans), "ms": round((time.perf_counter() - t0) * 1000), "model": d.get("model")}
        msgs.append({"role": "assistant", "content": m.get("content") or "", "tool_calls": calls})
        for c in calls:
            try:
                args = json.loads(c["function"]["arguments"] or "{}")
            except Exception:
                args = {}
            res = simulate(p, args)
            trace.append({"tool": c["function"]["name"], "args": args, "result": res})
            msgs.append({"role": "tool", "name": c["function"]["name"], "content": json.dumps(res, ensure_ascii=False), "tool_call_id": c["id"]})
    return {"answer": "Je n'ai pas réussi à conclure, reformule ta question.", "trace": trace, "checked": True, "ms": 0}
