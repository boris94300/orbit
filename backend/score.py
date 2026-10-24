"""Score Orbit : une note sur 100 qui dit si l'avenir financier tient debout. Calcul déterministe, 4 critères."""
from . import life

SHOCKS = [("chômage", {"pause": 1.0}), ("arrêt maladie", {"pause": 0.5}), ("invalidité", {"pause": 99})]
LABELS = [(80, "Solide"), (60, "Sur la bonne voie"), (40, "Fragile"), (0, "À risque")]


def _clip(x):
    return max(0.0, min(1.0, x))


def _at_ref(p):
    r = life.project(p)
    return r, r["scenarios"]["mid"]["rows"][r["ref"]]


def compute(p, r=None):
    r = r or life.project(p)
    row, inc, g = r["scenarios"]["mid"]["rows"][r["ref"]], r["incomes"], p.get("goal_month") or 0
    a0 = 2026 - p["birth_year"]
    prob = sum(x >= g for x in inc) / len(inc) if g and inc else 1.0
    months = p["cash"] / max(1, p["income_month"] - p["savings_month"])
    kept = []
    for _, sh in SHOCKS:
        _, s = _at_ref(dict(p, shock=dict(sh, drain=0, age=max(a0 + 3, 30))))
        kept.append(_clip(s["net"] / row["net"]) if row["net"] > 0 else 0)
    res = sum(kept) / len(kept)
    drag = row["fees"] / max(1, row["net"] + row["fees"])
    parts = [
        {"id": "objectif", "label": "Objectif de retraite", "max": 40, "pts": 40 * prob,
         "text": f"{round(prob * 100)} % des séquences historiques atteignent {round(g)} €/mois" if g else "Aucun objectif fixé",
         "fix": "épargner un peu plus ou partir un peu plus tard"},
        {"id": "precaution", "label": "Épargne de précaution", "max": 20, "pts": 20 * _clip(months / 6),
         "text": f"{months:.1f} mois de dépenses de côté (6 conseillés)".replace(".", ","),
         "fix": "garder 6 mois de dépenses sur un livret"},
        {"id": "resilience", "label": "Résistance aux coups durs", "max": 20, "pts": 20 * _clip((res - 0.6) / 0.4),
         "text": f"Chômage, maladie ou invalidité : tu gardes en moyenne {round(res * 100)} % de ton patrimoine",
         "fix": "une prévoyance invalidité et une réserve plus solide"},
        {"id": "frais", "label": "Frais de placement", "max": 20, "pts": 20 * _clip(1 - drag / 0.2),
         "text": f"Les frais absorbent {round(drag * 100)} % de ce que tu aurais à {p['retire_age']} ans",
         "fix": "des supports moins chers (ETF, courtier en ligne)"},
    ]
    for x in parts:
        x["pts"] = round(x["pts"], 1)
    total = round(sum(x["pts"] for x in parts))
    weak = min(parts, key=lambda x: x["pts"] / x["max"])
    label = next(l for s, l in LABELS if total >= s)
    return {"score": total, "label": label, "parts": parts, "weak": weak["id"],
            "headline": f"{label}, à renforcer : {weak['label'].lower()}" if total < 90 else label,
            "advice": weak["fix"]}
