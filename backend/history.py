"""Historique annuel 1996-2025 : actions monde en euros, Livret A, inflation France. Mis en cache dans data/history.json."""
import datetime as dt
import json
import os

import httpx

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "data", "history.json")
UA = {"User-Agent": "Mozilla/5.0"}
# Taux du Livret A, moyenne annuelle pondérée par la durée d'application (taux réglementés, Banque de France).
LIVRET_A = {1996: 3.6, 1997: 3.5, 1998: 3.25, 1999: 2.5, 2000: 2.6, 2001: 3.0, 2002: 3.0, 2003: 2.6, 2004: 2.25, 2005: 2.1,
            2006: 2.4, 2007: 2.9, 2008: 3.8, 2009: 1.9, 2010: 1.4, 2011: 2.1, 2012: 2.25, 2013: 1.6, 2014: 1.1, 2015: 0.85,
            2016: 0.75, 2017: 0.75, 2018: 0.75, 2019: 0.75, 2020: 0.6, 2021: 0.5, 2022: 1.4, 2023: 2.9, 2024: 3.0, 2025: 2.1}
FIRST, LAST = 1996, 2025


def _dec_close(symbol, client):
    r = client.get(f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}", params={"period1": 0, "period2": 2000000000, "interval": "1mo"})
    d = r.json()["chart"]["result"][0]
    out = {}
    for t, c in zip(d["timestamp"], d["indicators"]["quote"][0]["close"]):
        day = dt.datetime.utcfromtimestamp(t)
        if c is not None and day.month == 12:
            out[day.year] = c
    return out


def _fetch():
    with httpx.Client(timeout=20, headers=UA) as c:
        spx, cac = _dec_close("%5EGSPC", c), _dec_close("%5EFCHI", c)
        fx = {}
        for line in c.get("https://data-api.ecb.europa.eu/service/data/EXR/M.USD.EUR.SP00.A", params={"format": "csvdata", "startPeriod": "1999-01"}).text.splitlines()[1:]:
            f = line.split(",")
            if f[6].endswith("-12"):
                fx[int(f[6][:4])] = float(f[7])
        d = c.get("https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_aind",
                  params={"geo": "FR", "coicop": "CP00", "unit": "RCH_A_AVG"}).json()
        idx = d["dimension"]["time"]["category"]["index"]
        infl = {int(y): d["value"][str(i)] for y, i in idx.items() if str(i) in d["value"]}
    years = []
    for y in range(FIRST, LAST + 1):
        r_us = spx[y] / spx[y - 1] - 1
        if y - 1 in fx and y in fx:
            r_us = (1 + r_us) * fx[y - 1] / fx[y] - 1
        r_fr = cac[y] / cac[y - 1] - 1
        years.append({"year": y, "equity": round(0.6 * r_us + 0.4 * r_fr + 0.02, 5), "safe": LIVRET_A[y] / 100, "infl": infl[y] / 100})
    return {"years": years, "fetched": dt.datetime.utcnow().isoformat() + "Z",
            "method": "60 % S&P 500 converti en euros (BCE) + 40 % CAC 40, cours de fin décembre, + 2 % de dividendes",
            "sources": ["Yahoo Finance · ^GSPC, ^FCHI", "BCE · EXR USD/EUR", "Eurostat · prc_hicp_aind (IPCH France)", "Banque de France · taux du Livret A"]}


_MEM = None


def load():
    global _MEM
    if _MEM:
        return _MEM
    try:
        _MEM = dict(_fetch(), status="live")
        with open(CACHE, "w") as f:
            json.dump(_MEM, f)
    except Exception:
        with open(CACHE) as f:
            _MEM = dict(json.load(f), status="cache")
    return _MEM
