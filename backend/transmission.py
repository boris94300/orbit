"""Transmettre : droits de succession en ligne directe, assurance-vie et donations. Barème officiel (CGI art. 777, 779, 790 G, 990 I)."""
DIRECT = [(8072, .05), (12109, .10), (15932, .15), (552324, .20), (902838, .30), (1805677, .40), (float("inf"), .45)]
ABATT_CHILD, ABATT_AV, DON_CASH = 100000, 152500, 31865
SOURCES = "Barème : CGI art. 777, 779, 790 G, 990 I · service-public.fr"


def bareme(x):
    tax, lo = 0.0, 0.0
    for hi, r in DIRECT:
        if x > lo:
            tax += (min(x, hi) - lo) * r
        lo = hi
    return tax


def _av_tax(x):
    x = max(0.0, x - ABATT_AV)
    return min(x, 700000) * .20 + max(0, x - 700000) * .3125


def _case(estate, fin, n, av_share, donation):
    av = fin * av_share
    don = min(donation * n, max(0.0, estate - av))
    rest = max(0.0, estate - av - don)
    if n == 0:
        tax = max(0.0, rest - 1594) * .60
        return {"av": 0, "don": 0, "rest": rest, "tax": tax, "net": estate - tax, "per": estate - tax}
    tax = n * (bareme(max(0.0, rest / n - ABATT_CHILD)) + _av_tax(av / n))
    return {"av": av, "don": don, "rest": rest, "tax": tax, "net": estate - tax, "per": (estate - tax) / n}


def estimate(p, r, children=2, age=85, av_share=0.0, donation=0.0):
    a0 = r["age0"]
    k = max(0, min(r["horizon"], age - a0))
    row = r["scenarios"]["mid"]["rows"][k]
    estate, fin = max(0.0, row["net"]), max(0.0, row["fin"])
    n = int(children)
    base = _case(estate, fin, n, 0, 0)
    mine = _case(estate, fin, n, av_share, donation)
    best = min((_case(estate, fin, n, a / 10, d) for a in range(11) for d in (0, ABATT_CHILD, ABATT_CHILD + DON_CASH)), key=lambda c: c["tax"]) if n else base
    return {"age": a0 + k, "estate": estate, "fin": fin, "home": max(0.0, row["home"] - row["debt"]), "children": n,
            "base": base, "mine": mine, "best": best, "saving": base["tax"] - best["tax"],
            "rules": {"abatt": ABATT_CHILD, "av": ABATT_AV, "don": DON_CASH}, "sources": SOURCES,
            "hyp": f"Patrimoine médian projeté à {a0 + k} ans, en euros d'aujourd'hui. Assurance-vie alimentée avant 70 ans, donations faites plus de 15 ans avant la succession."}
