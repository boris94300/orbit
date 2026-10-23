"""Agrégation des flux temps réel, avec cache et repli sur un instantané local."""
import asyncio
import csv
import io
import json
import os
import re
import time
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime

import httpx

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAPSHOT = os.path.join(ROOT, "data", "snapshot.json")
UA = {"User-Agent": "Mozilla/5.0 (Orbit)"}

INDICES = [
    ("^FCHI", "CAC 40", "Paris", 48.8566, 2.3522),
    ("^GDAXI", "DAX", "Francfort", 50.1109, 8.6821),
    ("^FTSE", "FTSE 100", "Londres", 51.5074, -0.1278),
    ("^STOXX50E", "Euro Stoxx 50", "Zone euro", 50.85, 4.35),
    ("^GSPC", "S&P 500", "New York", 40.7069, -74.0113),
    ("^IXIC", "Nasdaq", "New York", 40.7569, -73.9860),
    ("^N225", "Nikkei 225", "Tokyo", 35.6812, 139.7671),
    ("^HSI", "Hang Seng", "Hong Kong", 22.2855, 114.1577),
    ("^BVSP", "Bovespa", "São Paulo", -23.5505, -46.6333),
]
COMMODITIES = [("CL=F", "Pétrole WTI", "$/baril"), ("GC=F", "Or", "$/once"), ("^TNX", "Taux US 10 ans", "%")]

COUNTRIES = {
    "France": (46.6, 2.4), "United States": (39.8, -98.6), "United Kingdom": (54.0, -2.0), "Germany": (51.2, 10.4),
    "Italy": (42.8, 12.8), "Spain": (40.4, -3.7), "China": (35.9, 104.2), "Japan": (36.2, 138.3), "India": (21.1, 78.0),
    "Canada": (56.1, -106.3), "Australia": (-25.3, 133.8), "Brazil": (-14.2, -51.9), "Russia": (61.5, 105.3),
    "Switzerland": (46.8, 8.2), "Netherlands": (52.1, 5.3), "Belgium": (50.5, 4.5), "Singapore": (1.35, 103.8),
    "Hong Kong": (22.3, 114.2), "South Korea": (35.9, 127.8), "Ireland": (53.4, -8.2), "South Africa": (-30.6, 22.9),
    "Nigeria": (9.1, 8.7), "Mexico": (23.6, -102.6), "Turkey": (39.0, 35.2), "Saudi Arabia": (23.9, 45.1),
    "United Arab Emirates": (23.4, 53.8), "Israel": (31.0, 34.9), "Ukraine": (48.4, 31.2), "Poland": (51.9, 19.1),
    "Sweden": (60.1, 18.6), "Norway": (60.5, 8.5), "Argentina": (-38.4, -63.6), "Indonesia": (-0.8, 113.9),
    "Pakistan": (30.4, 69.3), "Philippines": (12.9, 121.8), "Kenya": (-0.02, 37.9), "Egypt": (26.8, 30.8),
    "Taiwan": (23.7, 121.0), "Luxembourg": (49.8, 6.1), "Austria": (47.5, 14.6), "Portugal": (39.4, -8.2),
}


class Feed:
    def __init__(self, name, source, ttl, fn):
        self.name, self.source, self.ttl, self.fn = name, source, ttl, fn
        self.data, self.ts, self.status, self.error = None, 0.0, "init", ""

    async def get(self, client, snapshot):
        if self.data is not None and time.time() - self.ts < self.ttl:
            return self.payload()
        try:
            self.data = await self.fn(client)
            self.ts, self.status, self.error = time.time(), "live", ""
        except Exception as e:  # noqa: BLE001
            self.error = f"{type(e).__name__}: {e}"[:160]
            if self.data is not None:
                self.status = "cache"
            elif self.name in snapshot:
                snap = snapshot[self.name]
                self.data, self.ts, self.status = snap["data"], snap["ts"], "secours"
            else:
                self.status = "indisponible"
        return self.payload()

    def payload(self):
        return {"data": self.data, "ts": self.ts, "status": self.status, "source": self.source}


async def _json(client, url, **kw):
    r = await client.get(url, headers=UA, timeout=12, **kw)
    r.raise_for_status()
    return r.json()


async def _ecb(client, key):
    r = await client.get(f"https://data-api.ecb.europa.eu/service/data/{key}",
                         params={"lastNObservations": 2, "format": "csvdata"}, headers=UA, timeout=12)
    r.raise_for_status()
    rows = list(csv.DictReader(io.StringIO(r.text)))
    last, prev = rows[-1], rows[0]
    return {"value": float(last["OBS_VALUE"]), "prev": float(prev["OBS_VALUE"]), "date": last["TIME_PERIOD"]}


async def _eurostat(client, dataset, params):
    d = await _json(client, f"https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/{dataset}",
                    params={**params, "sinceTimePeriod": "2025-01"})
    times = sorted(d["dimension"]["time"]["category"]["index"].items(), key=lambda kv: kv[1])
    vals = {int(k): v for k, v in d["value"].items()}
    idx = max(vals)
    period = next(t for t, i in times if i == idx)
    prev = vals.get(idx - 1)
    return {"value": vals[idx], "prev": prev, "date": period}


async def rates(client):
    dfr, estr = await asyncio.gather(_ecb(client, "FM/B.U2.EUR.4F.KR.DFR.LEV"), _ecb(client, "EST/B.EU000A2X2A25.WT"))
    infl_fr, infl_ea, chom = await asyncio.gather(
        _eurostat(client, "prc_hicp_manr", {"geo": "FR", "coicop": "CP00"}),
        _eurostat(client, "prc_hicp_manr", {"geo": "EA", "coicop": "CP00"}),
        _eurostat(client, "une_rt_m", {"geo": "FR", "age": "TOTAL", "sex": "T", "unit": "PC_ACT", "s_adj": "SA"}),
    )
    return [
        {"id": "dfr", "label": "BCE · taux de dépôt", "unit": "%", **dfr, "src": "BCE"},
        {"id": "estr", "label": "€STR", "unit": "%", **estr, "src": "BCE"},
        {"id": "infl_fr", "label": "Inflation France (IPCH, a/a)", "unit": "%", **infl_fr, "src": "Eurostat"},
        {"id": "infl_ea", "label": "Inflation zone euro (IPCH, a/a)", "unit": "%", **infl_ea, "src": "Eurostat"},
        {"id": "chom_fr", "label": "Chômage France", "unit": "%", **chom, "src": "Eurostat"},
    ]


async def _spark(client, symbols):
    d = await _json(client, "https://query1.finance.yahoo.com/v7/finance/spark",
                    params={"symbols": ",".join(symbols), "range": "1d", "interval": "15m"})
    out = {}
    for r in d["spark"]["result"]:
        resp = r["response"][0]
        meta = resp["meta"]
        closes = [c for c in resp["indicators"]["quote"][0].get("close", []) if c is not None]
        price = meta.get("regularMarketPrice") or (closes[-1] if closes else None)
        prev = meta.get("chartPreviousClose") or meta.get("previousClose")
        out[r["symbol"]] = {"price": price, "prev": prev, "spark": closes[-40:], "time": meta.get("regularMarketTime"),
                            "currency": meta.get("currency")}
    return out


async def markets(client):
    q = await _spark(client, [s for s, *_ in INDICES])
    res = []
    for sym, name, city, lat, lng in INDICES:
        v = q.get(sym)
        if not v or v["price"] is None:
            continue
        chg = (v["price"] / v["prev"] - 1) * 100 if v["prev"] else 0.0
        res.append({"symbol": sym, "name": name, "city": city, "lat": lat, "lng": lng, "price": v["price"],
                    "change": chg, "spark": v["spark"], "time": v["time"], "currency": v["currency"]})
    return res


async def commodities(client):
    q = await _spark(client, [s for s, *_ in COMMODITIES])
    res = []
    for sym, name, unit in COMMODITIES:
        v = q.get(sym)
        if not v or v["price"] is None:
            continue
        chg = (v["price"] / v["prev"] - 1) * 100 if v["prev"] else 0.0
        res.append({"symbol": sym, "name": name, "unit": unit, "price": v["price"], "change": chg, "spark": v["spark"]})
    return res


async def fx(client):
    d = await _json(client, "https://api.frankfurter.app/latest", params={"from": "EUR", "to": "USD,GBP,JPY,CHF,CNY"},
                    follow_redirects=True)
    return {"date": d["date"], "rates": d["rates"]}


async def crypto(client):
    d = await _json(client, "https://api.kraken.com/0/public/Ticker", params={"pair": "XBTEUR,ETHEUR"})
    out = []
    for key, label in (("XXBTZEUR", "BTC/EUR"), ("XETHZEUR", "ETH/EUR")):
        t = d["result"][key]
        last, opn = float(t["c"][0]), float(t["o"])
        out.append({"pair": label, "price": last, "change": (last / opn - 1) * 100})
    return out


async def quakes(client):
    d = await _json(client, "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson")
    out = []
    for f in d["features"][:60]:
        p, (lng, lat, depth) = f["properties"], f["geometry"]["coordinates"]
        out.append({"id": f["id"], "mag": p["mag"], "place": p["place"], "time": p["time"], "lat": lat, "lng": lng,
                    "depth": depth, "tsunami": p.get("tsunami", 0), "url": p["url"]})
    return out


async def natural(client):
    d = await _json(client, "https://eonet.gsfc.nasa.gov/api/v3/events", params={"status": "open", "days": 30, "limit": 80})
    out = []
    for e in d["events"]:
        g = e["geometry"][-1]
        if g["type"] != "Point":
            continue
        lng, lat = g["coordinates"]
        out.append({"id": e["id"], "title": e["title"], "category": e["categories"][0]["title"],
                    "date": g["date"], "lat": lat, "lng": lng})
    return out


NEWS_RSS = [
    ("BCE", "https://www.ecb.europa.eu/rss/press.html", (50.1109, 8.6821, "Francfort")),
    ("Le Monde", "https://www.lemonde.fr/economie/rss_full.xml", (48.8566, 2.3522, "Paris")),
    ("Google Actualités", "https://news.google.com/rss/search?q=%22Banque+centrale%22+OR+%22CAC+40%22+OR+%22taux+d%27int%C3%A9r%C3%AAt%22+OR+inflation+OR+%22Wall+Street%22+when:1d&hl=fr&gl=FR&ceid=FR:fr",
     (48.8566, 2.3522, "Paris")),
    ("BBC", "https://feeds.bbci.co.uk/news/business/rss.xml", (51.5074, -0.1278, "Londres")),
]
PLACES = [
    (r"\b(BCE|ECB|Lagarde|zone euro|eurozone|euro area)\b", (50.1109, 8.6821, "Francfort")),
    (r"\b(Fed|Federal Reserve|Powell|Wall Street|Etats-Unis|États-Unis|US|USA|Trump|Washington|américain\w*)\b", (38.9, -77.04, "Washington")),
    (r"\b(Chine|China|Chinese|chinois\w*|Pékin|Beijing|Shanghai)\b", (39.9, 116.4, "Pékin")),
    (r"\b(Japon|Japan|japonais\w*|Tokyo|BoJ|yen)\b", (35.68, 139.77, "Tokyo")),
    (r"\b(Allemagne|Germany|German|allemand\w*|Berlin)\b", (52.52, 13.4, "Berlin")),
    (r"\b(Royaume-Uni|UK|Britain|British|Bank of England|Londres|London)\b", (51.5074, -0.1278, "Londres")),
    (r"\b(Russie|Russia|Russian|russe\w*|Moscou|Moscow)\b", (55.75, 37.62, "Moscou")),
    (r"\b(Ukraine|ukrainien\w*|Kyiv|Kiev)\b", (50.45, 30.52, "Kyiv")),
    (r"\b(Inde|India|Indian|indien\w*)\b", (28.61, 77.21, "New Delhi")),
    (r"\b(Brésil|Brazil)\b", (-15.79, -47.88, "Brasília")),
    (r"\b(Opep|OPEC|Arabie|Saudi|pétrole|oil|Moyen-Orient|Middle East|Iran|Israël|Israel|Gaza)\b", (24.7, 46.7, "Riyad")),
    (r"\b(Suisse|Swiss|Switzerland|BNS|SNB)\b", (46.95, 7.45, "Berne")),
    (r"\b(Italie|Italy|Italian|italien\w*|Rome)\b", (41.9, 12.5, "Rome")),
    (r"\b(Espagne|Spain|Spanish|espagnol\w*|Madrid)\b", (40.42, -3.7, "Madrid")),
    (r"\b(Bruxelles|Brussels|Commission européenne|European Commission|UE|EU)\b", (50.85, 4.35, "Bruxelles")),
    (r"\b(Sénégal|Senegal|Dakar)\b", (14.69, -17.45, "Dakar")),
    (r"\b(Microsoft|Apple|Google|Amazon|Nvidia|Meta|OpenAI|Tesla)\b", (37.39, -122.08, "Silicon Valley")),
    (r"\b(France|français\w*|French|Paris|Bercy|CAC)\b", (48.8566, 2.3522, "Paris")),
]


FINANCE = re.compile(
    r"(bours|march[ée]s?\\b|action|obligat|taux|inflation|prix|BCE|ECB|Fed|banque|bank|crédit|credit|dette|debt|budget|"
    r"croissance|growth|PIB|GDP|récession|recession|emploi|chômage|jobs|pétrole|oil|or\\b|gold|dollar|euro|yen|devise|"
    r"tarif|tariff|douane|impôt|tax|fiscal|immobilier|housing|mortgage|épargne|savings|retraite|pension|invest|"
    r"résultats|earnings|profit|faillite|redressement|liquidation|stocks?\\b|shares|bond|yield|currency|economy|économi)",
    re.I)


def _locate(text, default):
    for pat, place in PLACES:
        if re.search(pat, text):
            return place
    return default


async def _rss(client, feed, url, default):
    r = await client.get(url, headers=UA, timeout=12, follow_redirects=True)
    r.raise_for_status()
    root = ET.fromstring(r.content)
    out = []
    for it in root.iter("item"):
        name = feed
        title = (it.findtext("title") or "").strip()
        if not title:
            continue
        desc = re.sub(r"<[^>]+>", "", it.findtext("description") or "").strip()
        try:
            ts = parsedate_to_datetime(it.findtext("pubDate")).timestamp()
        except (TypeError, ValueError):
            ts = None
        if name != "BCE" and not FINANCE.search(f"{title} {desc[:300]}"):
            continue
        if " - " in title and name.startswith("Google"):
            title, _, outlet = title.rpartition(" - ")
            name = outlet.strip() or name
        lat, lng, place = _locate(f"{title} {desc[:200]}", default)
        out.append({"title": title, "url": (it.findtext("link") or "").strip(), "source": name, "place": place,
                    "lat": lat, "lng": lng, "time": ts})
    return out[:12]


async def news(client):
    res = await asyncio.gather(*(_rss(client, n, u, d) for n, u, d in NEWS_RSS), return_exceptions=True)
    items = [x for r in res if isinstance(r, list) for x in r]
    if not items:
        raise RuntimeError("aucun flux d'actualité disponible")
    items.sort(key=lambda x: x["time"] or 0, reverse=True)
    return items[:36]


FEEDS = [
    Feed("rates", "BCE · Eurostat", 3600, rates),
    Feed("markets", "Yahoo Finance", 60, markets),
    Feed("commodities", "Yahoo Finance", 60, commodities),
    Feed("fx", "BCE via Frankfurter", 1800, fx),
    Feed("crypto", "Kraken", 10, crypto),
    Feed("quakes", "USGS", 300, quakes),
    Feed("natural", "NASA EONET", 900, natural),
    Feed("news", "BCE · Le Monde · BBC (RSS)", 600, news),
]
BY_NAME = {f.name: f for f in FEEDS}


def load_snapshot():
    try:
        with open(SNAPSHOT, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


async def collect(names=None):
    snapshot = load_snapshot()
    feeds = [BY_NAME[n] for n in names] if names else FEEDS
    async with httpx.AsyncClient() as client:
        results = await asyncio.gather(*(f.get(client, snapshot) for f in feeds))
    return {f.name: r for f, r in zip(feeds, results)}


def save_snapshot(payload):
    keep = load_snapshot()
    for name, p in payload.items():
        if p["status"] == "live":
            keep[name] = {"data": p["data"], "ts": p["ts"]}
    os.makedirs(os.path.dirname(SNAPSHOT), exist_ok=True)
    with open(SNAPSHOT, "w", encoding="utf-8") as fh:
        json.dump(keep, fh, ensure_ascii=False)
