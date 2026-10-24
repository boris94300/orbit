"""Mes projets : chaque projet de vie posé sur la frise est intégré au moteur, puis on dit s'il est finançable et ce qu'il coûte à la retraite."""
from . import life

PRESETS = {
    "voiture": {"label": "Acheter une voiture", "cost": 25000, "monthly": 0, "years": 0},
    "enfant": {"label": "Avoir un enfant", "cost": 3000, "monthly": 550, "years": 18},
    "voyage": {"label": "Tour du monde", "cost": 15000, "monthly": 0, "years": 0},
    "mariage": {"label": "Se marier", "cost": 15000, "monthly": 0, "years": 0},
    "etudes": {"label": "Études d'un enfant", "cost": 0, "monthly": 700, "years": 5},
    "entreprise": {"label": "Créer mon entreprise", "cost": 30000, "monthly": 0, "years": 0},
    "travaux": {"label": "Gros travaux", "cost": 20000, "monthly": 0, "years": 0},
    "autre": {"label": "Autre projet", "cost": 10000, "monthly": 0, "years": 0},
}
NOTE = "Montants indicatifs, à ajuster : ce sont des ordres de grandeur, pas des devis."


def status(p, r, prj):
    a0, rows = r["age0"], r["scenarios"]["mid"]["rows"]
    bad = r["scenarios"]["bad"]["rows"]
    reserve = 3 * p["income_month"]
    k = max(0, min(r["horizon"], prj["age"] - a0))
    fin, fin_bad = rows[k]["fin"], bad[k]["fin"]
    out = {"fin": fin, "short": 0.0}
    if prj["cost"]:
        if fin - prj["cost"] >= reserve and fin_bad - prj["cost"] >= 0:
            out["s"], out["t"] = "ok", "Finançable sur ton épargne"
        elif fin >= prj["cost"]:
            out["s"], out["t"] = "tendu", "Finançable, mais ton épargne de précaution baisse"
        else:
            out["short"] = prj["cost"] - max(0.0, fin - reserve / 2)
            out["s"], out["t"] = "credit", f"Il manquera environ {round(out['short'] / 1000)} k€ : crédit à prévoir"
    if prj["monthly"]:
        share = prj["monthly"] / max(1, p["savings_month"])
        s, t = ("ok", "Ton épargne mensuelle absorbe ce coût") if share <= 0.5 else ("tendu", "Ce coût prend l'essentiel de ton épargne mensuelle") if share <= 1 else ("credit", "Ce coût dépasse ton épargne mensuelle")
        if not prj["cost"] or ["ok", "tendu", "credit"].index(s) > ["ok", "tendu", "credit"].index(out["s"]):
            out["s"], out["t"] = s, t
    return out


def preview(p, lst):
    p = life.merge(p, {"projects": lst})
    r = life.project(p)
    r0 = life.project(dict(p, use_projects=False))
    m, m0 = r["scenarios"]["mid"]["rows"], r0["scenarios"]["mid"]["rows"]
    ref = r["ref"]
    inc = lambda x: x["incomes"][len(x["incomes"]) // 2]
    items = [dict(x, **status(p, r, x)) for x in p["projects"]]
    return {"age0": r["age0"], "horizon": r["horizon"], "retire_age": p["retire_age"], "with": [x["net"] for x in m], "without": [x["net"] for x in m0],
            "bad": [x["net"] for x in r["scenarios"]["bad"]["rows"]], "items": items,
            "delta_ret": m[ref]["net"] - m0[ref]["net"], "income": inc(r), "income0": inc(r0), "presets": PRESETS, "note": NOTE}
