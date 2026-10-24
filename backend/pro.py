"""Espace conseiller bancaire : portefeuille de clients (fictifs + le compte démo), classés par Score Orbit, avec alertes et actions."""
from . import life, score

CLIENTS = {
    "lea": {"first_name": "Léa", "last_name": "Martin", "birth_year": 1998, "city": "Lyon", "income_month": 2600, "savings_month": 150, "cash": 2500, "invested": 0, "equity_share": 20, "goal_month": 250, "rent_month": 850},
    "karim": {"first_name": "Karim", "last_name": "Benali", "birth_year": 1984, "city": "Marseille", "income_month": 4200, "savings_month": 600, "cash": 30000, "invested": 60000, "equity_share": 70, "goal_month": 1300, "broker": "degiro", "rent_month": 1100},
    "sophie": {"first_name": "Sophie", "last_name": "Laurent", "birth_year": 1975, "city": "Nantes", "income_month": 3800, "savings_month": 300, "cash": 12000, "invested": 45000, "equity_share": 40, "goal_month": 350, "housing": "proprietaire", "rent_month": 0, "home_value": 320000, "loan_remaining": 90000, "loan_payment": 900},
    "thomas": {"first_name": "Thomas", "last_name": "Petit", "birth_year": 2001, "city": "Bordeaux", "income_month": 2100, "savings_month": 100, "cash": 1500, "invested": 3000, "equity_share": 90, "goal_month": 250, "tool": "tv_plus", "rent_month": 700},
    "camille": {"first_name": "Camille", "last_name": "Robert", "birth_year": 1990, "city": "Lille", "income_month": 3100, "savings_month": 400, "cash": 9000, "invested": 15000, "equity_share": 50, "goal_month": 200, "rent_month": 900,
                "buy": {"enabled": True, "in_years": 2, "price": 240000, "down": 25000, "rate": 3.2, "years": 25}},
    "marc": {"first_name": "Marc", "last_name": "Dubois", "birth_year": 1968, "city": "Toulouse", "income_month": 5200, "savings_month": 800, "cash": 60000, "invested": 180000, "equity_share": 50, "goal_month": 850, "broker": "av_ligne", "housing": "proprietaire", "rent_month": 0, "home_value": 450000},
    "ines": {"first_name": "Inès", "last_name": "Garcia", "birth_year": 1995, "city": "Créteil", "income_month": 2900, "savings_month": 250, "cash": 4000, "invested": 8000, "equity_share": 60, "goal_month": 600, "rent_month": 950},
    "paul": {"first_name": "Paul", "last_name": "Girard", "birth_year": 1980, "city": "Rennes", "income_month": 3600, "savings_month": 200, "cash": 6000, "invested": 20000, "equity_share": 30, "goal_month": 250, "tool": "tv_essential", "rent_month": 1000},
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
    return {"id": cid, "name": f"{p['first_name']} {p['last_name']}".strip(), "age": 2026 - p["birth_year"], "city": p["city"],
            "score": sc["score"], "label": sc["label"], "headline": sc["headline"], "parts": sc["parts"],
            "income": p["income_month"], "savings": p["savings_month"], "cash": p["cash"], "invested": p["invested"], "goal": g,
            "retire_age": p["retire_age"], "net": row["net"], "fees": row["fees"], "median": inc[len(inc) // 2], "prob": prob,
            "flags": _flags(p, sc, r, prob), "journal": j[-8:], "accepted": sum(e.get("gain", 0) for e in j if e.get("ok")), "live": journal is not None}


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
                                   "kinds": kinds, "recoverable": sum(f.get("gain", 0) for c in cl for f in c["flags"])}}


def profile_of(cid, demo_profile):
    if cid == "boris":
        return life.sanitize(demo_profile, life.BLANK), demo_profile.get("journal") or []
    over = CLIENTS[cid]
    p = life.sanitize(dict(life.BLANK, **{k: v for k, v in over.items() if k != "buy"}), life.BLANK)
    return (life.merge(p, {"buy": over["buy"]}) if "buy" in over else p), []
