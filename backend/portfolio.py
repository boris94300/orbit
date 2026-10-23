"""Portefeuille de démonstration et moteur d'exposition événement → position.

Les pondérations des ETF sont des approximations de réplication (indice le plus proche),
documentées dans `drivers`. Aucun montant n'est produit par un modèle de langage.
"""
import re
import time

import httpx

CLIENT = {
    "id": "C-0482-117", "name": "Camille Moreau", "age": 41, "birth_year": 1985, "city": "Créteil", "insee": "94028",
    "lat": 48.7904, "lng": 2.4556, "profile": "Équilibré", "mifid_date": "2026-03-12", "retirement_age": 60,
    "income_month": 4230, "savings_month": 650, "agency": "Agence Créteil Préfecture", "advisor": "J. Lefèvre",
}

# value = valorisation à la clôture précédente (€) ; drivers = (clé de marché, poids)
POSITIONS = [
    {"id": "pea-cw8", "env": "PEA", "name": "Amundi MSCI World UCITS ETF", "isin": "LU1681043599", "cls": "Actions",
     "value": 31846.12, "drivers": [("^GSPC", 0.72), ("^STOXX50E", 0.12), ("^N225", 0.055), ("^FTSE", 0.035)],
     "regions": {"Amérique du Nord": 0.72, "Zone euro": 0.12, "Japon": 0.055, "Royaume-Uni": 0.035, "Autres": 0.07}},
    {"id": "pea-c40", "env": "PEA", "name": "Amundi CAC 40 UCITS ETF", "isin": "FR0007052782", "cls": "Actions",
     "value": 12309.55, "drivers": [("^FCHI", 1.0)], "regions": {"Zone euro": 1.0}},
    {"id": "pea-tte", "env": "PEA", "name": "TotalEnergies SE", "isin": "FR0000120271", "cls": "Actions",
     "value": 4112.40, "drivers": [("^FCHI", 0.55), ("CL=F", 0.30)], "regions": {"Zone euro": 1.0},
     "keywords": r"TotalEnergies|Total\b|pétrole|oil|Opep|OPEC|brent"},
    {"id": "pea-or", "env": "PEA", "name": "L'Oréal SA", "isin": "FR0000120321", "cls": "Actions",
     "value": 3268.00, "drivers": [("^FCHI", 0.85)], "regions": {"Zone euro": 1.0}, "keywords": r"L.Or[ée]al"},
    {"id": "av-fe", "env": "Assurance-vie", "name": "Fonds en euros", "isin": "—", "cls": "Fonds euros",
     "value": 42750.00, "drivers": [], "regions": {"Zone euro": 1.0}, "rate_sensitive": "fonds_euros"},
    {"id": "av-sx5", "env": "Assurance-vie", "name": "UC · Euro Stoxx 50 ETF", "isin": "LU1681047236", "cls": "Actions",
     "value": 15630.80, "drivers": [("^STOXX50E", 1.0)], "regions": {"Zone euro": 1.0}},
    {"id": "av-asia", "env": "Assurance-vie", "name": "UC · Actions Asie émergente", "isin": "LU1681044480", "cls": "Actions",
     "value": 7905.25, "drivers": [("^HSI", 0.60)], "regions": {"Asie émergente": 1.0}},
    {"id": "per-pil", "env": "PER", "name": "Gestion pilotée · horizon 2045", "isin": "—", "cls": "Diversifié",
     "value": 21420.66, "drivers": [("^GSPC", 0.42), ("^STOXX50E", 0.12), ("^N225", 0.03)],
     "regions": {"Amérique du Nord": 0.42, "Zone euro": 0.52, "Japon": 0.03, "Autres": 0.03}, "rate_sensitive": "bonds",
     "bond_share": 0.40, "duration": 6.5},
    {"id": "liv-a", "env": "Épargne réglementée", "name": "Livret A", "isin": "—", "cls": "Monétaire",
     "value": 18420.37, "drivers": [], "regions": {"Zone euro": 1.0}},
    {"id": "cto-btc", "env": "Compte crypto", "name": "Bitcoin", "isin": "—", "cls": "Crypto", "qty": 0.0815,
     "value": None, "drivers": [], "regions": {"Autres": 1.0}, "keywords": r"[Bb]itcoin|crypto|BTC"},
    {"id": "immo-rp", "env": "Immobilier", "name": "Résidence principale · Créteil (94)", "isin": "—", "cls": "Immobilier",
     "value": 312000.00, "drivers": [], "regions": {"Zone euro": 1.0}, "geo": "home",
     "keywords": r"immobilier|logement|housing|crédit immobilier|mortgage"},
]
LIABILITIES = [{"id": "pret-rp", "name": "Prêt immobilier · taux fixe 3,45 %", "outstanding": 186540.22, "rate": 3.45,
                "end": "2046-06", "monthly": 1182.40}]
LABELS = {"^GSPC": "S&P 500", "^STOXX50E": "Euro Stoxx 50", "^N225": "Nikkei 225", "^FTSE": "FTSE 100", "^FCHI": "CAC 40",
          "^HSI": "Hang Seng", "CL=F": "Pétrole WTI"}

REGIONS_BOX = {  # (lat_min, lat_max, lng_min, lng_max)
    "Japon": (30, 46, 128, 147), "Asie émergente": (-10, 45, 95, 128),
    "Royaume-Uni": (49.5, 59, -8.5, 2),
}
MARKET_CLS = {"Actions", "Diversifié"}
NEWS_LINKS = [
    (r"\b(BCE|ECB|Lagarde|taux directeur|taux d.intérêt|interest rate)", ["av-fe", "per-pil"], "Taux : fonds en euros et poche obligataire du PER"),
    (r"Wall Street|S&P|Nasdaq|Dow Jones|Fed\b|Federal Reserve", ["pea-cw8", "per-pil"], "Marché américain : ~72 % du MSCI World"),
    (r"\bCAC\b|Bourse de Paris", ["pea-c40", "pea-tte", "pea-or"], "Marché français : ETF CAC 40 et titres vifs"),
    (r"Japon|Japan|Nikkei|Tokyo|\byen\b", ["pea-cw8", "per-pil"], "Japon : ~5,5 % du MSCI World"),
    (r"Chine|China|Hong Kong|Hang Seng|Pékin|Beijing", ["av-asia"], "Asie émergente : UC dédiée"),
]
_geo = {"data": None, "ts": 0.0, "status": "init"}


def _in(box, lat, lng):
    a, b, c, d = box
    return a <= lat <= b and c <= lng <= d


async def georisques():
    if _geo["data"] is not None and time.time() - _geo["ts"] < 86400:
        return _geo
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get("https://georisques.gouv.fr/api/v1/gaspar/risques",
                                 params={"code_insee": CLIENT["insee"]}, timeout=12)
            r.raise_for_status()
            det = r.json()["data"][0]["risques_detail"]
        _geo.update(data=[d["libelle_risque_long"] for d in det], ts=time.time(), status="live")
    except Exception:  # noqa: BLE001
        if _geo["data"] is None:
            _geo.update(data=["Inondation", "Mouvement de terrain", "Transport de marchandises dangereuses"],
                        status="secours")
    return _geo


def build(feeds_payload, geo):
    d = lambda k: (feeds_payload.get(k) or {}).get("data") or []  # noqa: E731
    moves = {m["symbol"]: m["change"] for m in d("markets")}
    moves.update({c["symbol"]: c["change"] for c in d("commodities")})
    btc = next((c for c in d("crypto") if c["pair"] == "BTC/EUR"), None)

    positions, contrib = [], {}
    for p in POSITIONS:
        q = {k: v for k, v in p.items() if k not in ("drivers", "keywords")}
        if p["id"] == "cto-btc":
            price, chg = (btc["price"], btc["change"]) if btc else (72800.0, 0.0)
            now = p["qty"] * price
            prev = now / (1 + chg / 100)
        else:
            prev = p["value"]
            chg = sum(w * moves.get(k, 0.0) for k, w in p["drivers"])
            now = prev * (1 + chg / 100)
            for k, w in p["drivers"]:
                if k in moves:
                    contrib.setdefault(k, []).append((p["id"], prev * w * moves[k] / 100))
        q.update(value=round(now, 2), pnl=round(now - prev, 2), chg=chg,
                 drivers=[{"key": k, "label": LABELS.get(k, k), "w": w} for k, w in p["drivers"]])
        positions.append(q)

    fin = sum(p["value"] for p in positions if p["cls"] != "Immobilier")
    immo = sum(p["value"] for p in positions if p["cls"] == "Immobilier")
    debt = sum(l["outstanding"] for l in LIABILITIES)
    pnl = sum(p["pnl"] for p in positions)
    for p in positions:
        p["weight"] = p["value"] / (fin + immo) * 100

    alloc, regions = {}, {}
    for p in positions:
        cls = p["cls"]
        if p["id"] == "per-pil":
            alloc["Actions"] = alloc.get("Actions", 0) + p["value"] * (1 - p["bond_share"])
            alloc["Obligations"] = alloc.get("Obligations", 0) + p["value"] * p["bond_share"]
        else:
            alloc[cls] = alloc.get(cls, 0) + p["value"]
        if cls != "Immobilier":
            for r, w in p["regions"].items():
                regions[r] = regions.get(r, 0) + p["value"] * w
    total = fin + immo

    exposures = []
    for m in d("markets"):
        items = contrib.get(m["symbol"], [])
        if items and abs(m["change"]) >= 0.2:
            exposures.append({"event_id": "mk-" + m["symbol"], "kind": "marche", "label": f"{m['name']} {m['change']:+.2f} %",
                              "lat": m["lat"], "lng": m["lng"], "positions": [i for i, _ in items],
                              "impact": round(sum(v for _, v in items), 2), "rationale": "Variation de séance × poids de réplication"})
    for c in d("commodities"):
        items = contrib.get(c["symbol"], [])
        if items and abs(c["change"]) >= 0.5:
            exposures.append({"event_id": "cm-" + c["symbol"], "kind": "marche", "label": f"{c['name']} {c['change']:+.2f} %",
                              "lat": 24.7, "lng": 46.7, "positions": [i for i, _ in items],
                              "impact": round(sum(v for _, v in items), 2), "rationale": "Sensibilité du titre au prix du baril (0,30)"})
    if btc and abs(btc["change"]) >= 0.5:
        p = next(x for x in positions if x["id"] == "cto-btc")
        exposures.append({"event_id": "cr-BTC", "kind": "marche", "label": f"Bitcoin {btc['change']:+.2f} % (24 h)",
                          "lat": 47.37, "lng": 8.54, "positions": ["cto-btc"], "impact": p["pnl"], "rationale": "Détention directe"})

    def region_hits(lat, lng):
        hits = []
        for p in positions:
            if p["cls"] not in MARKET_CLS:
                if p.get("geo") == "home" and abs(lat - CLIENT["lat"]) < 2.5 and abs(lng - CLIENT["lng"]) < 3.5:
                    hits.append((p["id"], p["value"]))
                continue
            for r, w in p["regions"].items():
                if r in REGIONS_BOX and w >= 0.03 and _in(REGIONS_BOX[r], lat, lng):
                    hits.append((p["id"], p["value"] * w))
        return hits

    for q in d("quakes"):
        if q["mag"] < 5:
            continue
        hits = region_hits(q["lat"], q["lng"])
        if hits:
            exposures.append({"event_id": "q-" + q["id"], "kind": "quake", "label": f"Séisme M{q['mag']:.1f} · {q['place']}",
                              "lat": q["lat"], "lng": q["lng"], "positions": sorted({h for h, _ in hits}),
                              "exposed": round(sum(v for _, v in hits), 2), "impact": None,
                              "rationale": "Encours investi dans la zone touchée (exposition, pas une perte)"})
    for n in d("natural"):
        if n["title"].lower().startswith("prescribed"):
            continue
        hits = region_hits(n["lat"], n["lng"])
        if hits:
            home = any(h == "immo-rp" for h, _ in hits)
            exposures.append({"event_id": "n-" + n["id"], "kind": "nat", "label": n["title"], "lat": n["lat"], "lng": n["lng"],
                              "positions": sorted({h for h, _ in hits}), "exposed": round(sum(v for _, v in hits), 2),
                              "impact": None, "rationale": ("Bien situé en zone à risque inondation (Géorisques)" if home
                                                            else "Encours investi dans la zone touchée")})
    for a in d("news"):
        text = a["title"]
        ids, why = [], []
        for pat, pids, reason in NEWS_LINKS:
            if re.search(pat, text, re.I):
                ids += pids
                why.append(reason)
        for p in POSITIONS:
            if p.get("keywords") and re.search(p["keywords"], text):
                ids.append(p["id"])
                why.append(f"Mention directe : {p['name']}")
        if ids:
            ids = sorted(set(ids))
            exposures.append({"event_id": "nw-" + a["url"], "kind": "news", "label": text, "lat": a["lat"], "lng": a["lng"],
                              "positions": ids, "impact": None,
                              "exposed": round(sum(p["value"] for p in positions if p["id"] in ids), 2),
                              "rationale": " · ".join(dict.fromkeys(why))})

    dfr = next((r for r in d("rates") if r["id"] == "dfr"), None)
    per = next(p for p in positions if p["id"] == "per-pil")
    sens = {"bp25_bonds": round(-per["value"] * per["bond_share"] * per["duration"] * 0.0025, 2),
            "dfr": dfr["value"] if dfr else None}

    return {
        "client": CLIENT, "asof": time.time(), "positions": positions, "liabilities": LIABILITIES,
        "totals": {"financial": round(fin, 2), "real_estate": immo, "liabilities": debt, "gross": round(total, 2),
                   "net": round(total - debt, 2), "pnl": round(pnl, 2), "pnl_pct": pnl / (total - pnl) * 100},
        "allocation": sorted(({"cls": k, "value": round(v, 2), "pct": v / total * 100} for k, v in alloc.items()),
                             key=lambda x: -x["value"]),
        "regions": sorted(({"region": k, "value": round(v, 2), "pct": v / fin * 100} for k, v in regions.items()),
                          key=lambda x: -x["value"]),
        "risks": {"items": geo["data"], "status": geo["status"], "source": "Géorisques (GASPAR)", "commune": "Créteil"},
        "sensitivity": sens,
        "exposures": sorted(exposures, key=lambda e: -(abs(e["impact"]) if e["impact"] is not None else e.get("exposed", 0) / 1e6)),
    }
