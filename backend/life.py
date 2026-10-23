"""Projection de vie : patrimoine année par année, rejouée sur chaque séquence historique de marché (1996-2025)."""
import copy

from . import history

DEMO = {
    "first_name": "Camille", "last_name": "Moreau", "birth_year": 1994, "city": "Créteil",
    "income_month": 3400, "savings_month": 450, "cash": 18400, "invested": 16000,
    "equity_share": 60, "retire_age": 64, "goal_month": 1800, "housing": "locataire", "rent_month": 1150,
    "home_value": 0, "loan_remaining": 0, "loan_payment": 0,
    "buy": {"enabled": False, "in_years": 3, "price": 285000, "down": 30000, "rate": 3.2, "years": 25},
}
BLANK = {
    "first_name": "", "last_name": "", "birth_year": 1995, "city": "",
    "income_month": 2500, "savings_month": 200, "cash": 5000, "invested": 0,
    "equity_share": 30, "retire_age": 64, "goal_month": 1500, "housing": "locataire", "rent_month": 800,
    "home_value": 0, "loan_remaining": 0, "loan_payment": 0,
    "buy": {"enabled": False, "in_years": 5, "price": 250000, "down": 25000, "rate": 3.2, "years": 25},
}
LIMITS = {"birth_year": (1930, 2008), "income_month": (0, 100000), "savings_month": (0, 20000), "cash": (0, 1e7),
          "invested": (0, 2e7), "equity_share": (0, 100), "retire_age": (50, 75), "goal_month": (0, 20000), "rent_month": (0, 20000),
          "home_value": (0, 2e7), "loan_remaining": (0, 2e7), "loan_payment": (0, 50000)}
BUY_LIMITS = {"in_years": (0, 30), "price": (20000, 1e7), "down": (0, 1e7), "rate": (0, 12), "years": (5, 30)}
CHARGES = 0.012      # taxe foncière + entretien, en % de la valeur du bien
FEES = 0.075         # frais de notaire dans l'ancien
HOME_REAL = 0.005    # revalorisation réelle annuelle du bien (hypothèse)
END_AGE = 90


def _payment(capital, rate, years):
    r = rate / 100 / 12
    n = years * 12
    return capital / n if r == 0 else capital * r / (1 - (1 + r) ** -n)


def _path(p, seq, start_year, horizon):
    age0 = start_year - p["birth_year"]
    reserve = 3 * p["income_month"]
    cash, eq = float(p["cash"]), float(p["invested"])
    renting = p["housing"] == "locataire"
    home, debt, pay, loan_left = float(p["home_value"]), float(p["loan_remaining"]), float(p["loan_payment"]), 0
    if debt and pay:
        loan_left = 999
    budget0 = p["savings_month"] + (p["rent_month"] if renting else pay)
    buy = p.get("buy") or {}
    idx, rows, cap_ret, withdraw = 1.0, [], None, 0.0
    for k in range(horizon + 1):
        age = age0 + k
        fin = cash + eq
        rows.append({"net": (fin + home - debt) / idx, "fin": fin / idx, "home": home / idx, "debt": debt / idx,
                     "rent": (p["rent_month"] if renting else 0), "withdraw": withdraw / 12 / idx if withdraw else 0})
        if k == horizon:
            break
        y = seq[k % len(seq)]
        if buy.get("enabled") and renting and k == int(buy["in_years"]):
            price = buy["price"] * idx
            need = buy["down"] * idx + price * FEES
            take = min(cash, need)
            cash -= take
            eq -= need - take
            home, debt = price, price - buy["down"] * idx
            pay = _payment(debt, buy["rate"], buy["years"])
            loan_left, renting = buy["years"], False
        working = age < p["retire_age"]
        housing = (p["rent_month"] * 12 * idx) if renting else ((pay * 12 if debt > 1 else 0) + CHARGES * home)
        flow = (budget0 * 12 * idx - housing) if working else 0.0
        if not working:
            if cap_ret is None:
                cap_ret = (cash + eq) / idx
            withdraw = cap_ret / max(1, END_AGE - p["retire_age"]) * idx
            flow -= withdraw
        w = p["equity_share"] / 100 if working else max(0.2, p["equity_share"] / 100 - 0.02 * (age - p["retire_age"]))
        total = cash + eq + flow
        safe = min(total, max(reserve * idx, (1 - w) * total))
        cash, eq = safe * (1 + y["safe"]), (total - safe) * (1 + y["equity"])
        if debt > 1:
            interest = debt * buy.get("rate", 3.2) / 100 if loan_left != 999 else debt * 0.03
            debt = max(0.0, debt + interest - pay * 12)
        home *= (1 + y["infl"]) * (1 + HOME_REAL)
        idx *= 1 + y["infl"]
    return rows


def _num(v, lo, hi, default):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return default
    return min(max(v, lo), hi)


def sanitize(p, base=None):
    base = base or BLANK
    out = copy.deepcopy(base)
    for k in ("first_name", "last_name", "city"):
        if k in p:
            out[k] = str(p[k] or "").strip()[:60]
    for k, (lo, hi) in LIMITS.items():
        if k in p:
            out[k] = _num(p[k], lo, hi, out[k])
    for k in ("birth_year", "retire_age", "equity_share"):
        out[k] = int(out[k])
    if p.get("housing") in ("locataire", "proprietaire", "heberge"):
        out["housing"] = p["housing"]
    b = dict(out.get("buy") or BLANK["buy"])
    for k, (lo, hi) in BUY_LIMITS.items():
        if k in (p.get("buy") or {}):
            b[k] = _num(p["buy"][k], lo, hi, b[k])
    if "enabled" in (p.get("buy") or {}):
        b["enabled"] = bool(p["buy"]["enabled"])
    b["down"] = min(b["down"], b["price"])
    b["in_years"], b["years"] = int(b["in_years"]), int(b["years"])
    out["buy"] = b
    if out["housing"] != "locataire":
        out["rent_month"] = 0
        out["buy"]["enabled"] = False
    age0 = 2026 - out["birth_year"]
    out["retire_age"] = max(out["retire_age"], min(age0 + 1, 75))
    return out


def merge(p, over):
    m = copy.deepcopy(p)
    for k, v in (over or {}).items():
        if k == "buy":
            m["buy"] = dict(m.get("buy") or {}, **v)
        else:
            m[k] = v
    return sanitize(m, p)


def compare(p, variants, start_year=2026):
    out = []
    for v in variants[:4]:
        r = project(merge(p, v.get("set")), start_year)
        mid = r["scenarios"]["mid"]["rows"]
        ret = r["retire_age"] - r["age0"]
        out.append({"label": str(v.get("label", ""))[:40], "mid": [x["net"] for x in mid], "band": r["band"],
                    "bad": [x["net"] for x in r["scenarios"]["bad"]["rows"]], "good": [x["net"] for x in r["scenarios"]["good"]["rows"]],
                    "home": [x["home"] - x["debt"] for x in mid], "fin": [x["fin"] for x in mid],
                    "income": mid[min(len(mid) - 1, ret + 1)]["withdraw"] if 0 <= ret < len(mid) - 1 else 0,
                    "by_start": r["by_start"], "ref": r["ref"], "profile": r["profile"]})
    return {"age0": 2026 - p["birth_year"], "start_year": start_year, "retire_age": p["retire_age"],
            "horizon": len(out[0]["mid"]) - 1 if out else 0, "variants": out}


def project(p, start_year=2026, horizon=None):
    h = history.load()
    seqs = h["years"]
    age0 = start_year - p["birth_year"]
    horizon = horizon or max(10, min(70, 100 - age0))
    paths = []
    for i in range(len(seqs)):
        seq = seqs[i:] + seqs[:i]
        paths.append((seqs[i]["year"], _path(p, seq, start_year, horizon)))
    ref = min(horizon, max(0, p["retire_age"] - age0))
    ranked = sorted(paths, key=lambda x: x[1][ref]["net"])
    pick = lambda q: ranked[min(len(ranked) - 1, int(q * (len(ranked) - 1) + 0.5))]
    sc = {}
    for key, q, name in (("bad", 0.1, "Défavorable"), ("mid", 0.5, "Médian"), ("good", 0.9, "Favorable")):
        y0, _ = pick(q)
        rows = []
        for k in range(horizon + 1):
            rows.append({f: sorted(r[k][f] for _, r in paths)[int(q * (len(paths) - 1) + 0.5)] for f in paths[0][1][k]})
        sc[key] = {"name": name, "replay": y0, "q": q, "rows": rows}
    band = []
    for k in range(horizon + 1):
        v = sorted(r[k]["net"] for _, r in paths)
        band.append([v[int(0.1 * (len(v) - 1))], v[int(0.9 * (len(v) - 1))]])
    return {"start_year": start_year, "age0": age0, "horizon": horizon, "retire_age": p["retire_age"], "ref": ref,
            "scenarios": sc, "band": band, "n_paths": len(paths),
            "by_start": [[y, r[ref]["net"]] for y, r in paths],
            "incomes": sorted(r[min(ref + 1, horizon)]["withdraw"] for _, r in paths), "history": {k: h[k] for k in ("method", "sources", "status", "fetched")},
            "profile": p}


def _med_income(p, extra):
    inc = project(merge(p, {"savings_month": p["savings_month"] + extra}))["incomes"]
    return inc[len(inc) // 2]


def goal(p, r):
    g, inc = p.get("goal_month") or 0, r["incomes"]
    if not g or not inc:
        return None
    med = inc[len(inc) // 2]
    extra = None
    if med < g and _med_income(p, 3000) >= g:
        lo, hi = 0, 3000
        while hi - lo > 25:
            m = (lo + hi) // 2
            lo, hi = (lo, m) if _med_income(p, m) >= g else (m, hi)
        extra = hi
    return {"goal": g, "prob": sum(x >= g for x in inc) / len(inc), "median": med, "extra": extra}
