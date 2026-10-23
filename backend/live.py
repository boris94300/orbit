"""Agents en direct : chaque appel API, chaque donnée reçue et chaque calcul est publié comme un événement."""
import asyncio, csv, io, statistics, time, uuid

import httpx

from . import history, life

RUNS = {}
UA = {"User-Agent": "Mozilla/5.0 (Orbit)"}
PACE = 0.28


def _fmt(v, d=2):
    return f"{v:,.{d}f}".replace(",", " ").replace(".", ",")


def _keur(v):
    return f"{round(v / 1000):,}".replace(",", " ") + " k€"


class Run:
    def __init__(self, uid):
        self.uid, self.events, self.done, self.summary, self.created = uid, [], False, {}, time.time()

    async def emit(self, agent, kind, text, **detail):
        self.events.append({"i": len(self.events), "t": time.time(), "agent": agent, "kind": kind, "text": text, "detail": detail})
        await asyncio.sleep(PACE)

    async def call(self, client, agent, label, url, params=None, parse=None):
        full = str(httpx.URL(url, params=params or {}))
        await self.emit(agent, "call", label, url=full)
        t0 = time.perf_counter()
        try:
            r = await client.get(full, timeout=10, headers=UA, follow_redirects=True)
            ms = round((time.perf_counter() - t0) * 1000)
            r.raise_for_status()
            val = parse(r)
            await self.emit(agent, "data", f"HTTP {r.status_code} · {ms} ms · {len(r.content) / 1024:.1f} ko", excerpt=r.text[:220].replace("\n", " "), value=val if not isinstance(val, (dict, list)) else None)
            return val
        except Exception as e:  # noqa: BLE001
            await self.emit(agent, "error", f"Source indisponible ({type(e).__name__}) : valeur de secours utilisée")
            return None


def _ecb(r):
    rows = list(csv.DictReader(io.StringIO(r.text)))
    return {"value": float(rows[-1]["OBS_VALUE"]), "date": rows[-1]["TIME_PERIOD"]}


def _eurostat(r):
    d = r.json()
    idx = {v: k for k, v in d["dimension"]["time"]["category"]["index"].items()}
    last = max(int(k) for k in d["value"])
    return {"value": d["value"][str(last)], "date": idx[last]}


def _yahoo(r):
    m = r.json()["chart"]["result"][0]["meta"]
    return {"value": m["regularMarketPrice"], "prev": m.get("chartPreviousClose") or m.get("previousClose")}


async def run(R: Run, p):
    s = R.summary
    s["data"], s["proposals"] = [], []
    try:
        async with httpx.AsyncClient() as c:
            # 1. Veille
            await R.emit("veille", "start", "Collecte des indicateurs qui pèsent sur ta projection")
            dfr = await R.call(c, "veille", "Taux de dépôt BCE", "https://data-api.ecb.europa.eu/service/data/FM/B.U2.EUR.4F.KR.DFR.LEV", {"lastNObservations": 1, "format": "csvdata"}, _ecb)
            estr = await R.call(c, "veille", "€STR, taux au jour le jour", "https://data-api.ecb.europa.eu/service/data/EST/B.EU000A2X2A25.WT", {"lastNObservations": 1, "format": "csvdata"}, _ecb)
            infl = await R.call(c, "veille", "Inflation France (IPCH, sur un an)", "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_manr", {"geo": "FR", "coicop": "CP00", "lastTimePeriod": 1}, _eurostat)
            cac = await R.call(c, "veille", "CAC 40", "https://query1.finance.yahoo.com/v8/finance/chart/%5EFCHI", {"range": "5d", "interval": "1d"}, _yahoo)
            spx = await R.call(c, "veille", "S&P 500", "https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC", {"range": "5d", "interval": "1d"}, _yahoo)
            usd = await R.call(c, "veille", "Euro / dollar (BCE via Frankfurter)", "https://api.frankfurter.app/latest", {"from": "EUR", "to": "USD"}, lambda r: r.json()["rates"]["USD"])
            for lab, v, src, unit in (("Taux de dépôt BCE", dfr, "BCE", "%"), ("€STR", estr, "BCE", "%"), ("Inflation France", infl, "Eurostat", "%")):
                if v:
                    s["data"].append({"label": lab, "value": _fmt(v["value"]) + " %", "src": f"{src} · {v['date']}"})
            for lab, v in (("CAC 40", cac), ("S&P 500", spx)):
                if v and v.get("prev"):
                    ch = (v["value"] / v["prev"] - 1) * 100
                    s["data"].append({"label": lab, "value": _fmt(v["value"], 0), "src": f"Yahoo Finance · {'+' if ch >= 0 else ''}{_fmt(ch)} % sur la séance", "chg": ch})
            if usd:
                s["data"].append({"label": "EUR / USD", "value": _fmt(usd, 4), "src": "BCE via Frankfurter"})
            await R.emit("veille", "result", f"{len(s['data'])} indicateurs à jour")

            # 2. Historien
            await R.emit("historien", "start", "Chargement de 30 ans de marchés (1996-2025)")
            t0 = time.perf_counter()
            h = history.load()
            ys = h["years"]
            eq = [y["equity"] for y in ys]
            inf = [y["infl"] for y in ys]
            await R.emit("historien", "data", f"{len(ys)} années · historique {'téléchargé' if h['status'] == 'live' else 'en cache'} · {round((time.perf_counter() - t0) * 1000)} ms",
                         excerpt=" ; ".join(h["sources"]))
            worst = min(ys, key=lambda y: y["equity"])
            best = max(ys, key=lambda y: y["equity"])
            geo = (statistics.geometric_mean([1 + x for x in eq]) - 1) * 100
            await R.emit("historien", "calc", "Rendement actions annualisé (60 % S&P 500 en euros, 40 % CAC 40, dividendes 2 %)",
                         formula=f"(Π(1 + r_i))^(1/{len(eq)}) − 1 = {_fmt(geo)} %",
                         lines=[f"pire année : {worst['year']} ({_fmt(worst['equity'] * 100, 1)} %)", f"meilleure : {best['year']} (+{_fmt(best['equity'] * 100, 1)} %)",
                                f"volatilité annuelle : {_fmt(statistics.pstdev(eq) * 100, 1)} %", f"inflation moyenne : {_fmt(statistics.mean(inf) * 100, 2)} %"])
            if infl:
                gap = infl["value"] - statistics.mean(inf) * 100
                await R.emit("historien", "calc", "Inflation actuelle comparée à la moyenne historique", formula=f"{_fmt(infl['value'])} % − {_fmt(statistics.mean(inf) * 100)} % = {'+' if gap >= 0 else ''}{_fmt(gap)} pt")
            await R.emit("historien", "result", f"{len(ys)} séquences de marché prêtes à être rejouées")

            # 3. Projection
            await R.emit("projection", "start", f"Projection de {p['first_name'] or 'ton profil'} jusqu'à {min(100, 2026 - p['birth_year'] + 70)} ans")
            t0 = time.perf_counter()
            L = life.project(p)
            ms = round((time.perf_counter() - t0) * 1000)
            ref = L["ref"]
            await R.emit("projection", "calc", f"{L['n_paths']} trajectoires × {L['horizon']} ans simulées en {ms} ms",
                         lines=["chaque année : épargne versée − logement, puis rendement de l'année historique", "poche sûre rémunérée au Livret A, poche actions au rendement de l'année",
                                f"retraite à {p['retire_age']} ans : retrait constant jusqu'à 90 ans", "montants convertis en euros d'aujourd'hui (inflation réelle)"])
            mid = L["scenarios"]["mid"]["rows"]
            await R.emit("projection", "calc", f"Patrimoine à {p['retire_age']} ans : quantiles 10 % / 50 % / 90 %",
                         formula=f"{_keur(L['scenarios']['bad']['rows'][ref]['net'])} / {_keur(mid[ref]['net'])} / {_keur(L['scenarios']['good']['rows'][ref]['net'])}")
            inc = mid[min(len(mid) - 1, ref + 1)]["withdraw"]
            s["projection"] = {"age": p["retire_age"], "mid": mid[ref]["net"], "bad": L["scenarios"]["bad"]["rows"][ref]["net"], "good": L["scenarios"]["good"]["rows"][ref]["net"], "income": inc}
            await R.emit("projection", "result", f"Médiane à {p['retire_age']} ans : {_keur(mid[ref]['net'])}, soit {round(inc)} € par mois de complément")

            # 4. Logement
            await R.emit("logement", "start", f"Logement et risques à {p['city'] or 'ta commune'}")
            if p.get("city"):
                com = await R.call(c, "logement", f"Code commune de {p['city']}", "https://geo.api.gouv.fr/communes", {"nom": p["city"], "fields": "code,nom,population", "boost": "population", "limit": 1},
                                   lambda r: r.json()[0] if r.json() else None)
                if com:
                    risks = await R.call(c, "logement", f"Risques naturels et technologiques (INSEE {com['code']})", "https://georisques.gouv.fr/api/v1/gaspar/risques", {"code_insee": com["code"]},
                                         lambda r: [d["libelle_risque_long"] for d in r.json()["data"][0]["risques_detail"]])
                    if risks:
                        s["risks"] = {"city": com["nom"], "list": risks[:5]}
                        await R.emit("logement", "result", f"{len(risks)} risques recensés à {com['nom']} : {', '.join(risks[:3]).lower()}")
            b = p["buy"]
            if p["housing"] == "locataire":
                loan = b["price"] - b["down"]
                r_m = b["rate"] / 1200
                pay = life._payment(loan, b["rate"], b["years"])
                ratio = pay / max(1, p["income_month"]) * 100
                await R.emit("logement", "calc", f"Mensualité d'un achat à {_keur(b['price'])} (apport {_keur(b['down'])})",
                             formula=f"M = C·t / (1 − (1 + t)^−n) = {_fmt(loan, 0)} × {r_m:.5f} / (1 − {1 + r_m:.5f}^−{b['years'] * 12}) = {_fmt(pay, 0)} €",
                             lines=[f"taux d'endettement : {_fmt(pay, 0)} / {_fmt(p['income_month'], 0)} = {_fmt(ratio, 1)} %", f"loyer actuel : {_fmt(p['rent_month'], 0)} €"])
                ok = ratio <= 35
                await R.emit("conseil", "check", f"Règle HCSF, endettement ≤ 35 % : {'respectée' if ok else 'dépassée'} ({_fmt(ratio, 1)} %)", ok=ok)
                if ok and not b["enabled"]:
                    gain = life.compare(p, [{"set": {}}, {"set": {"buy": {"enabled": True}}}])["variants"]
                    d = gain[1]["mid"][ref] - gain[0]["mid"][ref]
                    if d > 5000:
                        s["proposals"].append({"title": f"Étudier l'achat d'un bien à {_keur(b['price'])}", "why": f"Mensualité de {_fmt(pay, 0)} €, soit {_fmt(ratio, 1)} % de tes revenus.",
                                               "effect": f"+{_keur(d)} de patrimoine médian à {p['retire_age']} ans", "set": {"buy": {"enabled": True}}})

            # 5. Conseil
            await R.emit("conseil", "start", "Recherche d'ajustements et contrôle de conformité")
            age = 2026 - p["birth_year"]
            months = p["cash"] / max(1, p["income_month"])
            await R.emit("conseil", "calc", "Épargne de précaution", formula=f"{_fmt(p['cash'], 0)} € / {_fmt(p['income_month'], 0)} € = {_fmt(months, 1)} mois de revenus (cible : 3 à 6)")
            base = life.project(p)["scenarios"]["mid"]["rows"][ref]["net"]
            cands = []
            if months > 6 and p["equity_share"] < 70 and age < 50:
                cands.append(("Investir l'excédent de livrets", f"{_fmt(months, 1)} mois de revenus dorment sur des livrets, au-delà des 6 mois de précaution.", {"equity_share": min(80, p["equity_share"] + 10)}))
            if p["savings_month"] / max(1, p["income_month"]) < 0.2:
                cands.append(("Épargner 100 € de plus par mois", f"Tu épargnes {_fmt(p['savings_month'] / max(1, p['income_month']) * 100, 0)} % de tes revenus.", {"savings_month": p["savings_month"] + 100}))
            if age < 45 and p["equity_share"] < 40:
                cands.append(("Augmenter la part d'actions", f"Avec {p['retire_age'] - age} ans devant toi, les baisses de marché ont le temps d'être absorbées.", {"equity_share": 60}))
            for title, why, st in cands:
                alt = life.project(life.merge(p, st))["scenarios"]["mid"]["rows"][ref]["net"]
                await R.emit("conseil", "calc", title, formula=f"médiane à {p['retire_age']} ans : {_keur(base)} → {_keur(alt)} ({'+' if alt >= base else ''}{_keur(alt - base)})")
                eq_after = st.get("equity_share", p["equity_share"])
                ok = eq_after <= max(30, 110 - age) and months >= 3
                await R.emit("conseil", "check", f"Profil de risque : {eq_after} % d'actions à {age} ans, précaution {_fmt(months, 1)} mois → {'conforme' if ok else 'non conforme'}", ok=ok)
                if ok and alt > base:
                    s["proposals"].append({"title": title, "why": why, "effect": f"+{_keur(alt - base)} de patrimoine médian à {p['retire_age']} ans", "set": st})
            await R.emit("conseil", "result", f"{len(s['proposals'])} proposition{'s' if len(s['proposals']) > 1 else ''} soumise{'s' if len(s['proposals']) > 1 else ''} à ta validation. Aucune opération n'est exécutée automatiquement.")
    except Exception as e:  # noqa: BLE001
        await R.emit("conseil", "error", f"Analyse interrompue : {type(e).__name__}")
    R.done = True


def start(uid, p):
    for k in [k for k, v in RUNS.items() if time.time() - v.created > 900]:
        RUNS.pop(k, None)
    rid = uuid.uuid4().hex[:12]
    RUNS[rid] = Run(uid)
    asyncio.get_running_loop().create_task(run(RUNS[rid], p))
    return rid


def poll(uid, rid, since):
    R = RUNS.get(rid)
    if not R or R.uid != uid:
        return None
    return {"events": R.events[since:], "done": R.done, "summary": R.summary if R.done else None}
