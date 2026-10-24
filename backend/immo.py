"""Prix immobiliers réels : ventes notariales DVF (data.gouv.fr) de la commune du client."""
import csv, io, statistics

from . import life

CACHE = {}


def _commune(r):
    d = r.json()
    if not d:
        raise ValueError("commune introuvable")
    c = d[0]
    return {"code": c["code"], "dep": c["codeDepartement"], "name": c["nom"]}


def _dvf(r):
    muts = {}
    for row in csv.DictReader(io.StringIO(r.text)):
        if row.get("nature_mutation") != "Vente":
            continue
        m = muts.setdefault(row["id_mutation"], {"v": row.get("valeur_fonciere"), "rows": []})
        m["rows"].append(row)
    ppm, n_house = [], 0
    for m in muts.values():
        locs = [x for x in m["rows"] if x.get("type_local") in ("Appartement", "Maison")]
        if len(locs) != 1 or not m["v"] or not locs[0].get("surface_reelle_bati"):
            continue
        v, s = float(m["v"]), float(locs[0]["surface_reelle_bati"])
        if s < 9 or not 20000 < v < 5e6:
            continue
        if locs[0]["type_local"] == "Appartement":
            ppm.append(v / s)
        else:
            n_house += 1
    if len(ppm) < 10:
        raise ValueError("pas assez de ventes")
    q = statistics.quantiles(ppm, n=4)
    return {"n": len(ppm), "med": statistics.median(ppm), "q1": q[0], "q3": q[2], "houses": n_house}


def capacity(p, ppm):
    """Budget maximal avec la règle HCSF (35 % d'endettement), l'apport disponible et les frais de notaire."""
    b = p["buy"]
    pay = 0.35 * p["income_month"]
    r, n = b["rate"] / 1200, b["years"] * 12
    loan = pay * (1 - (1 + r) ** -n) / r if r else pay * n
    down = max(0.0, p["cash"] - 3 * (p["income_month"] - p["savings_month"])) + p["invested"]
    price = (loan + down) / (1 + life.FEES)
    return {"pay": pay, "loan": loan, "down": down, "price": price, "m2": price / ppm, "rate": b["rate"], "years": b["years"]}


async def lookup(R, client, agent, city):
    city = (city or "Paris").strip()
    if city in CACHE:
        return CACHE[city]
    c = await R.call(client, agent, f"Code INSEE de {city}", "https://geo.api.gouv.fr/communes", {"nom": city, "fields": "code,codeDepartement,nom", "boost": "population", "limit": 1}, _commune)
    if not c:
        return None
    for y in (2025, 2024, 2023):
        d = await R.call(client, agent, f"Ventes DVF {y} · {c['name']}", f"https://files.data.gouv.fr/geo-dvf/latest/csv/{y}/communes/{c['dep']}/{c['code']}.csv", None, _dvf)
        if d:
            CACHE[city] = dict(d, year=y, city=c["name"])
            return CACHE[city]
    return None
