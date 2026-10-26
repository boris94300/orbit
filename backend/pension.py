"""Retraite réelle : pension de base (régime général) + complémentaire Agirc-Arrco, pour un salarié du privé.
Règles de la réforme 2023 (âge légal 64 ans, 172 trimestres). La loi peut évoluer : ce sont des hypothèses, pas un relevé officiel."""
PASS = 47100            # plafond annuel de la Sécurité sociale 2025 (Urssaf)
NET_TO_GROSS = 0.78     # salaire net ≈ 78 % du brut (salarié non cadre, ordre de grandeur)
AA_T1, AA_T2 = 0.062, 0.17          # taux contractuels Agirc-Arrco, tranches 1 et 2
AA_BUY, AA_VALUE = 20.1877, 1.4386  # prix d'achat et valeur de service du point (Agirc-Arrco 2025)
NET_BASE, NET_AA = 0.909, 0.899     # après CSG, CRDS, Casa (et 1 % maladie sur la complémentaire)
LEGAL, FULL, REQUIRED = 64, 67, 172
SOURCES = "Règles : service-public.fr, info-retraite.fr, Agirc-Arrco · plafond Urssaf 2025"


def _salaries(p, start, growth, bump=0, every=0):
    a0 = 2026 - p["birth_year"]
    s0, step = p["income_month"] * 12 / NET_TO_GROSS, bump * 12 / NET_TO_GROSS
    return {a: s0 * (1 + growth) ** (a - a0) + (step * ((a - a0) // every) if every and a > a0 else 0) for a in range(start, 90)}


def at_age(p, retire, start=22, growth=0.01, bump=0, every=0):
    a0 = 2026 - p["birth_year"]
    start = min(start, a0)
    sal = _salaries(p, start, growth, bump, every)
    years = [sal[a] for a in range(start, retire)]
    trims = 4 * len(years)
    best = sorted((min(s, PASS) for s in years), reverse=True)[:25]
    sam = sum(best) / max(1, len(best))
    missing = max(0, min(REQUIRED - trims, (FULL - retire) * 4)) if retire < FULL else 0
    missing = min(20, missing)
    rate = 0.5 - 0.00625 * missing
    surcote = 0.0125 * max(0, min(trims - REQUIRED, (retire - LEGAL) * 4)) if retire > LEGAL else 0
    base = sam * rate * min(trims, REQUIRED) / REQUIRED * (1 + surcote)
    pts = sum((min(s, PASS) * AA_T1 + max(0, min(s, 8 * PASS) - PASS) * AA_T2) / AA_BUY for s in years)
    aa = pts * AA_VALUE * (1 - 0.0125 * missing) * (1 + surcote)
    return {"age": retire, "base": base * NET_BASE / 12, "compl": aa * NET_AA / 12, "total": (base * NET_BASE + aa * NET_AA) / 12,
            "trims": trims, "missing": missing, "surcote": surcote, "sam": sam / 12, "points": round(pts), "last_net": years[-1] * NET_TO_GROSS / 12 if years else 0,
            "allowed": retire >= LEGAL}


def estimate(p, start=22, growth=0.01, retire=None, savings_income=0, bump=0, every=0):
    retire = int(retire or p["retire_age"])
    cur = at_age(p, max(retire, 50), start, growth, bump, every)
    ages = [at_age(p, a, start, growth, bump, every) for a in range(LEGAL - 2, 71)]
    base = at_age(p, max(retire, 50), start, growth) if bump and every else cur
    n_bumps = max(0, (max(retire, 50) - 1 - (2026 - p["birth_year"])) // every) if bump and every else 0
    last = cur["last_net"] or p["income_month"]
    total = cur["total"] + savings_income
    return {"cur": cur, "ages": ages, "savings_income": savings_income, "total": total, "last_net": last,
            "replacement": cur["total"] / max(1, last), "replacement_all": total / max(1, last),
            "start": start, "growth": growth, "bump": bump, "every": every, "n_bumps": n_bumps,
            "bump_gain": cur["total"] - base["total"], "bump_salary": cur["last_net"] - base["last_net"], "legal": LEGAL, "full": FULL, "required": REQUIRED, "sources": SOURCES,
            "hyp": f"Salarié du privé depuis {start} ans, salaire qui progresse de {growth * 100:.1f} % par an au-delà de l'inflation" + (f", plus {round(bump)} € nets par mois tous les {every} ans" if bump and every else "") + ". Réforme 2023 : 64 ans, 172 trimestres. Montants nets, en euros d'aujourd'hui."}
