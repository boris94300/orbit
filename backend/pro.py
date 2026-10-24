"""Espace conseiller bancaire : portefeuille de clients (fictifs + le compte démo), classés par Score Orbit, avec alertes et actions."""
from . import life, pension, projects, score, transmission

CLIENTS = {
    "lea": {"first_name": "Léa", "last_name": "Martin", "birth_year": 1998, "city": "Lyon", "income_month": 2600, "savings_month": 150, "cash": 2500, "invested": 0, "equity_share": 20, "goal_month": 250, "rent_month": 850, "projects": [{"kind": "voyage", "label": "Voyage au Japon", "age": 30, "cost": 5000}], "budget": {"income": 2600, "spend": 2310, "capacity": 290, "subs_total": 96, "months": 3}},
    "karim": {"first_name": "Karim", "last_name": "Benali", "birth_year": 1984, "city": "Marseille", "income_month": 4200, "savings_month": 600, "cash": 30000, "invested": 60000, "equity_share": 70, "goal_month": 1300, "broker": "degiro", "rent_month": 1100, "children": 2, "projects": [{"kind": "etudes", "label": "Études des enfants", "age": 52, "monthly": 450, "years": 5}]},
    "sophie": {"first_name": "Sophie", "last_name": "Laurent", "birth_year": 1975, "city": "Nantes", "income_month": 3800, "savings_month": 300, "cash": 12000, "invested": 45000, "equity_share": 40, "goal_month": 350, "housing": "proprietaire", "rent_month": 0, "home_value": 320000, "loan_remaining": 90000, "loan_payment": 900, "children": 2, "projects": [{"kind": "travaux", "label": "Rénovation énergétique", "age": 53, "cost": 35000}]},
    "thomas": {"first_name": "Thomas", "last_name": "Petit", "birth_year": 2001, "city": "Bordeaux", "income_month": 2100, "savings_month": 100, "cash": 1500, "invested": 3000, "equity_share": 90, "goal_month": 250, "tool": "tv_plus", "rent_month": 700, "projects": [{"kind": "voiture", "label": "Voiture d'occasion", "age": 28, "cost": 6000}], "budget": {"income": 2100, "spend": 1980, "capacity": 120, "subs_total": 142, "months": 3}},
    "camille": {"first_name": "Camille", "last_name": "Robert", "birth_year": 1990, "city": "Lille", "income_month": 3100, "savings_month": 400, "cash": 9000, "invested": 15000, "equity_share": 50, "goal_month": 200, "rent_month": 900, "children": 1, "projects": [{"kind": "enfant", "label": "Avoir un enfant", "age": 38, "cost": 3000, "monthly": 350, "years": 18}],
                "buy": {"enabled": True, "in_years": 2, "price": 240000, "down": 25000, "rate": 3.2, "years": 25}},
    "marc": {"first_name": "Marc", "last_name": "Dubois", "birth_year": 1968, "city": "Toulouse", "income_month": 5200, "savings_month": 800, "cash": 60000, "invested": 180000, "equity_share": 50, "goal_month": 850, "broker": "av_ligne", "housing": "proprietaire", "rent_month": 0, "home_value": 450000, "children": 3},
    "ines": {"first_name": "Inès", "last_name": "Garcia", "birth_year": 1995, "city": "Créteil", "income_month": 2900, "savings_month": 250, "cash": 4000, "invested": 8000, "equity_share": 60, "goal_month": 600, "rent_month": 950, "budget": {"income": 2900, "spend": 2180, "capacity": 720, "subs_total": 88, "months": 3}},
    "paul": {"first_name": "Paul", "last_name": "Girard", "birth_year": 1980, "city": "Rennes", "income_month": 3600, "savings_month": 200, "cash": 6000, "invested": 20000, "equity_share": 30, "goal_month": 250, "tool": "tv_essential", "rent_month": 1000, "children": 1},
}
_cache = {}


def _flags(p, sc, r, prob):
    out, row = [], r["scenarios"]["mid"]["rows"][r["ref"]]
    parts = {x["id"]: x for x in sc["parts"]}
    if p.get("goal_month") and prob < 0.5:
        out.append({"k": "retraite", "t": "Retraite menacée", "d": f"{round(prob * 100)} % de chances d'atteindre {round(p['goal_month'])} €/mois", "a": "Proposer un plan d'épargne retraite et revoir l'objectif ensemble"})
    if parts["frais"]["pts"] < 10 or p.get("tool", "aucun") != "aucun":
        alt = life.project(life.merge(p, {"broker": "fortuneo", "tool": "aucun"}))
        gain = alt["scenarios"]["mid"]["rows"][alt["ref"]]["net"] - row["net"]
        if gain > 5000:
            out.append({"k": "frais", "t": "Frais élevés", "d": f"{round(row['fees'] / 1000)} k€ de frais d'ici la retraite, {round(gain / 1000)} k€ récupérables", "a": "Présenter une gestion en ETF à frais réduits", "gain": gain})
    if parts["precaution"]["pts"] < 10:
        out.append({"k": "precaution", "t": "Précaution insuffisante", "d": parts["precaution"]["text"], "a": "Ouvrir ou alimenter un livret d'épargne de précaution"})
    if parts["resilience"]["pts"] < 8:
        out.append({"k": "prevoyance", "t": "Peu protégé", "d": parts["resilience"]["text"], "a": "Proposer une prévoyance invalidité et décès"})
    for x in r.get("_projects", []):
        if x["s"] == "credit":
            out.append({"k": "projets", "t": "Projet à financer", "d": f"{x['label']} à {x['age']} ans · {x['t'].lower()}", "a": "Proposer un crédit projet ou une épargne dédiée"})
            break
    tr = r.get("_trans")
    if tr and tr["saving"] > 10000 and 2026 - p["birth_year"] >= 35:
        out.append({"k": "transmission", "t": "Transmission à préparer", "d": f"{round(tr['base']['tax'] / 1000)} k€ de droits estimés pour {tr['children']} enfant{'s' if tr['children'] > 1 else ''}, dont {round(tr['saving'] / 1000)} k€ évitables", "a": "Présenter l'assurance-vie et les donations", "gain": tr["saving"]})
    b = p.get("budget")
    if b and b.get("capacity", 0) > p["savings_month"] + 150:
        out.append({"k": "budget", "t": "Épargne sous-exploitée", "d": f"Capacité réelle {round(b['capacity'])} €/mois d'après ses relevés, épargne actuelle {round(p['savings_month'])} €/mois", "a": "Proposer un virement programmé vers l'épargne"})
    if p["buy"]["enabled"]:
        pay = life._payment(p["buy"]["price"] - p["buy"]["down"], p["buy"]["rate"], p["buy"]["years"])
        out.append({"k": "immo", "t": "Projet immobilier", "d": f"Achat de {round(p['buy']['price'] / 1000)} k€ dans {p['buy']['in_years']} ans · mensualité {round(pay)} € ({round(pay / max(1, p['income_month']) * 100)} %)", "a": "Préparer une simulation de crédit immobilier"})
    return out


def card(cid, p, journal=None):
    p = life.sanitize(p, life.BLANK)
    r = life.project(p)
    sc = score.compute(p, r)
    inc, g = r["incomes"], p.get("goal_month") or 0
    prob = sum(x >= g for x in inc) / len(inc) if g else 1.0
    row = r["scenarios"]["mid"]["rows"][r["ref"]]
    j = journal or []
    pe = pension.estimate(p, savings_income=inc[len(inc) // 2])
    r["_projects"] = [dict(x, **projects.status(p, r, x)) for x in p.get("projects") or []]
    n = p.get("children", 2)
    r["_trans"] = transmission.estimate(p, r, n, 85)
    return {"id": cid, "name": f"{p['first_name']} {p['last_name']}".strip(), "age": 2026 - p["birth_year"], "city": p["city"],
            "score": sc["score"], "label": sc["label"], "headline": sc["headline"], "parts": sc["parts"],
            "income": p["income_month"], "savings": p["savings_month"], "cash": p["cash"], "invested": p["invested"], "goal": g,
            "retire_age": p["retire_age"], "net": row["net"], "fees": row["fees"], "median": inc[len(inc) // 2], "prob": prob,
            "flags": _flags(p, sc, r, prob),
            "pension": pe["cur"]["total"], "repl": pe["replacement"], "repl_all": pe["replacement_all"], "pension_age": pe["cur"]["age"],
            "projects": [{"label": x["label"], "age": x["age"], "s": x["s"], "t": x["t"]} for x in r["_projects"]],
            "trans": {"children": n, "estate": r["_trans"]["estate"], "tax": r["_trans"]["base"]["tax"], "best": r["_trans"]["best"]["tax"], "saving": r["_trans"]["saving"]},
            "budget": p.get("budget"), "journal": j[-8:], "accepted": sum(e.get("gain", 0) for e in j if e.get("ok")), "live": journal is not None}


def portfolio(demo_profile):
    if not _cache:
        for cid, over in CLIENTS.items():
            _cache[cid] = card(cid, life.merge(life.sanitize(dict(life.BLANK, **{k: v for k, v in over.items() if k != "buy"}), life.BLANK), {"buy": over["buy"]} if "buy" in over else {}))
    me = card("boris", demo_profile, demo_profile.get("journal") or [])
    cl = sorted([me] + list(_cache.values()), key=lambda c: c["score"])
    kinds = {}
    for c in cl:
        for f in c["flags"]:
            kinds[f["k"]] = kinds.get(f["k"], 0) + 1
    return {"clients": cl, "kpi": {"n": len(cl), "avg": round(sum(c["score"] for c in cl) / len(cl)), "fragile": sum(c["score"] < 60 for c in cl),
                                   "kinds": kinds, "recoverable": sum(f.get("gain", 0) for c in cl for f in c["flags"] if f["k"] == "frais")}}


def profile_of(cid, demo_profile):
    if cid == "boris":
        return life.sanitize(demo_profile, life.BLANK), demo_profile.get("journal") or []
    over = CLIENTS[cid]
    p = life.sanitize(dict(life.BLANK, **{k: v for k, v in over.items() if k != "buy"}), life.BLANK)
    return (life.merge(p, {"buy": over["buy"]}) if "buy" in over else p), []
