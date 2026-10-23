"""Projection Monte-Carlo du patrimoine financier jusqu'à l'âge de retraite (euros constants)."""
import math
import random

ASSUMPTIONS_DOC = [
    ("Actions", "rendement réel 4,5 %/an, volatilité 15 %", "historique MSCI World long terme"),
    ("Obligations", "€STR + 0,9 pt, volatilité 5 %", "€STR BCE du jour"),
    ("Fonds euros", "€STR + 0,6 pt, sans volatilité", "€STR BCE du jour"),
    ("Monétaire", "€STR", "€STR BCE du jour"),
    ("Crypto", "rendement réel 0 %, volatilité 60 %", "hypothèse prudente"),
    ("Inflation", "convergence de l'IPCH actuel vers 2 % en 3 ans", "Eurostat · cible BCE"),
]


def _quant(sorted_vals, q):
    i = q * (len(sorted_vals) - 1)
    lo = int(i)
    hi = min(lo + 1, len(sorted_vals) - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (i - lo)


def simulate(start, savings_month, years, equity_share, estr, infl_now, n=3000, seed=60):
    rng = random.Random(seed)
    eq_mu, eq_vol = 0.045, 0.15
    safe = start["Obligations"] + start["Fonds euros"] + start["Monétaire"]
    paths = []
    for _ in range(n):
        eq, sf, cr = start["Actions"], safe, start["Crypto"]
        row = [eq + sf + cr]
        for y in range(years):
            infl = 0.02 + (infl_now - 0.02) * max(0.0, 1 - y / 3)
            r_eq = math.exp(rng.gauss(eq_mu - eq_vol ** 2 / 2, eq_vol)) - 1
            r_sf = (estr + 0.006) - infl + rng.gauss(0, 0.02)
            r_cr = math.exp(rng.gauss(-0.6 ** 2 / 2, 0.6)) - 1
            eq *= 1 + r_eq
            sf *= 1 + r_sf
            cr *= 1 + r_cr
            total = eq + sf + cr + savings_month * 12
            target_eq = (total - cr) * equity_share
            eq, sf = target_eq, total - cr - target_eq
            row.append(eq + sf + cr)
        paths.append(row)
    return paths


def annuity(capital, years=25, real_rate=0.01):
    return capital * real_rate / (1 - (1 + real_rate) ** -years) / 12


def project(pf, rates, savings, retire_age, equity_pct, target):
    alloc = {a["cls"]: a["value"] for a in pf["allocation"]}
    start = {k: alloc.get(k, 0.0) for k in ("Actions", "Obligations", "Fonds euros", "Monétaire", "Crypto")}
    start["Actions"] += alloc.get("Diversifié", 0.0)
    r = {x["id"]: x for x in rates}
    estr = (r["estr"]["value"] if "estr" in r else 2.0) / 100
    infl = (r["infl_ea"]["value"] if "infl_ea" in r else 2.0) / 100
    age = pf["client"]["age"]
    years = max(1, retire_age - age)
    eq = equity_pct / 100

    paths = simulate(start, savings, years, eq, estr, infl)
    bands = []
    for y in range(years + 1):
        col = sorted(p[y] for p in paths)
        bands.append({"age": age + y, "p5": _quant(col, .05), "p25": _quant(col, .25), "p50": _quant(col, .5),
                      "p75": _quant(col, .75), "p95": _quant(col, .95)})
    final = sorted(p[-1] for p in paths)
    prob = sum(1 for v in final if v >= target) / len(final)

    def median_with(**kw):
        a = dict(start=start, savings_month=savings, years=years, equity_share=eq, estr=estr, infl_now=infl, n=1200)
        a.update(kw)
        return _quant(sorted(p[-1] for p in simulate(**a)), .5)

    base = median_with()
    pnl = pf["totals"]["pnl"]
    yday = dict(start)
    yday["Actions"] -= pnl
    sens = {
        "today": base - median_with(start=yday),
        "plus100": median_with(savings_month=savings + 100) - base,
        "plus2y": median_with(years=years + 2) - base,
        "equity_plus10": median_with(equity_share=min(0.95, eq + 0.10)) - base,
    }
    return {
        "inputs": {"savings": savings, "retire_age": retire_age, "equity_pct": equity_pct, "target": target, "age": age,
                   "years": years, "start": sum(start.values()), "estr": estr * 100, "inflation": infl * 100},
        "bands": bands, "paths": [p for p in paths[:90]], "prob": prob,
        "final": {k: _quant(final, q) for k, q in (("p5", .05), ("p25", .25), ("p50", .5), ("p75", .75), ("p95", .95))},
        "income": {k: annuity(_quant(final, q)) for k, q in (("p25", .25), ("p50", .5), ("p75", .75))},
        "sensitivity": sens, "assumptions": ASSUMPTIONS_DOC, "n": len(paths),
    }
