"""Coups durs de la vie : chocs déterministes appliqués à la projection, avec statistiques publiques sourcées."""
from . import life

RISKS = [
    {"id": "chomage", "title": "Une année de chômage", "age": lambda a0, p: max(a0 + 5, 30),
     "stat": "Taux de chômage en France : 7,5 % des actifs (INSEE, 2025). L'allocation (ARE) remplace environ 57 % du salaire journalier de référence.",
     "src": "INSEE · Unédic", "shock": lambda p: {"pause": 1.0},
     "how": "Tu ne peux plus épargner pendant 12 mois.", "protect": "Garder 3 à 6 mois de dépenses sur un livret avant d'investir."},
    {"id": "maladie", "title": "Un arrêt maladie de 6 mois", "age": lambda a0, p: max(a0 + 10, 40),
     "stat": "Plus de 13 millions de personnes sont en affection de longue durée (Assurance maladie). Les indemnités journalières couvrent 50 % du salaire, plafonnées.",
     "src": "Assurance maladie (ameli.fr)", "shock": lambda p: {"pause": 0.5, "drain": p["income_month"] * 0.5},
     "how": "6 mois sans épargne et à demi-salaire.", "protect": "Vérifier la prévoyance de ton employeur (maintien de salaire)."},
    {"id": "divorce", "title": "Un divorce", "age": lambda a0, p: max(a0 + 8, 38),
     "stat": "Environ 45 mariages sur 100 finissent par un divorce (INSEE). L'année de la rupture, le niveau de vie baisse en moyenne de 19 % pour les femmes et de 2,5 % pour les hommes (INSEE Première, 2015).",
     "src": "INSEE", "shock": lambda p: {"split": 0.5, "pause": 2.0},
     "how": "L'épargne est partagée en deux et tu n'épargnes plus pendant 2 ans (deux logements).", "protect": "Contrat de mariage ou PACS en séparation de biens, épargne au nom de chacun."},
    {"id": "invalidite", "title": "Une invalidité à 45 ans", "age": lambda a0, p: max(a0 + 3, 45),
     "stat": "La pension d'invalidité de catégorie 2 vaut 50 % du salaire annuel moyen des 10 meilleures années (Assurance maladie).",
     "src": "Assurance maladie (ameli.fr)", "shock": lambda p: {"pause": 99},
     "how": "Ton revenu est divisé par deux : plus aucune épargne jusqu'à la retraite.", "protect": "Une assurance prévoyance invalidité, souvent quelques euros par mois."},
    {"id": "dependance", "title": "Une perte d'autonomie à 85 ans", "age": lambda a0, p: 85,
     "stat": "En EHPAD, le reste à charge médian est d'environ 1 850 € par mois (DREES).",
     "src": "DREES", "shock": lambda p: {"cost": 1850},
     "how": "1 850 €/mois à financer à partir de 85 ans.", "protect": "Garder une réserve à la retraite ou souscrire une assurance dépendance."},
]


def assess(p, g, stats):
    base, out = stats(p, g), []
    a0 = 2026 - p["birth_year"]
    for r in RISKS:
        age = r["age"](a0, p)
        if age < a0:
            continue
        q = dict(p, shock=dict(r["shock"](p), age=age))
        if r["id"] == "dependance":
            proj0, proj1 = life.project(p), life.project(q)
            k = min(proj0["horizon"], 90 - a0)
            d = proj1["scenarios"]["mid"]["rows"][k]["net"] - proj0["scenarios"]["mid"]["rows"][k]["net"]
            out.append(dict(_pub(r, age), loss=d, at=90, prob=None))
            continue
        st = stats(q, g)
        out.append(dict(_pub(r, age), loss=st["net"] - base["net"], at=p["retire_age"], prob=st["prob"], prob0=base["prob"]))
    return out


def _pub(r, age):
    return {k: r[k] for k in ("id", "title", "stat", "src", "how", "protect")} | {"age": age}
