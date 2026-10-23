"""Vue conseiller : portefeuille d'agence simulé, expositions du jour et file de priorité déterministe."""
import math
import random
from functools import lru_cache

FIRST = ["Camille", "Thomas", "Sophie", "Nicolas", "Julie", "Antoine", "Claire", "Mehdi", "Laura", "Hugo", "Inès", "Julien",
         "Sarah", "Karim", "Émilie", "Pierre", "Nadia", "Olivier", "Léa", "Vincent", "Amina", "François", "Chloé", "Yann",
         "Isabelle", "Samir", "Hélène", "Romain", "Fatou", "Marc", "Aurélie", "David", "Céline", "Paul", "Manon", "Éric"]
LAST = ["Martin", "Bernard", "Dubois", "Petit", "Durand", "Leroy", "Garcia", "Roux", "Fournier", "Girard", "Bonnet", "Lambert",
        "Fontaine", "Rousseau", "Vincent", "Muller", "Faure", "Mercier", "Blanc", "Guerin", "Boyer", "Chevalier", "Benali",
        "Nguyen", "Lopez", "Diallo", "Perrin", "Morel", "Gauthier", "Henry", "Masson", "Robin", "Haddad", "Colin", "Lemoine"]
COMMUNES = ["Créteil", "Saint-Maur-des-Fossés", "Vincennes", "Maisons-Alfort", "Champigny-sur-Marne", "Nogent-sur-Marne",
            "Ivry-sur-Seine", "Vitry-sur-Seine", "Joinville-le-Pont", "Bonneuil-sur-Marne"]
PROFILES = {"Prudent": (0.25, 0.30, 0.01), "Équilibré": (0.50, 0.70, 0.03), "Dynamique": (0.75, 0.90, 0.05)}
EQ_SPLIT = ["^GSPC", "^STOXX50E", "^FCHI", "^HSI", "^N225"]
LABEL = {"^GSPC": "S&P 500", "^STOXX50E": "Euro Stoxx 50", "^FCHI": "CAC 40", "^HSI": "Hang Seng", "^N225": "Nikkei 225",
         "CL=F": "Pétrole WTI", "BTC": "Bitcoin"}


def _phi(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


@lru_cache(maxsize=1)
def book(n=184, seed=94):
    rng = random.Random(seed)
    out = []
    for i in range(n):
        prof = rng.choices(list(PROFILES), [0.35, 0.45, 0.20])[0]
        tgt, eq_max, cr_max = PROFILES[prof]
        fin = round(rng.lognormvariate(10.9, 0.75), 2)
        eq = max(0.0, min(0.95, rng.gauss(tgt, 0.12)))
        raw = [rng.uniform(0.2, 0.6), rng.uniform(0.1, 0.3), rng.uniform(0.1, 0.4), rng.uniform(0, 0.12), rng.uniform(0, 0.06)]
        s = sum(raw)
        w = {k: eq * v / s for k, v in zip(EQ_SPLIT, raw)}
        if rng.random() < 0.25:
            w["CL=F"] = rng.uniform(0.02, 0.08)
        crypto = rng.uniform(0.004, 0.05) if rng.random() < 0.28 else 0.0
        if crypto:
            w["BTC"] = crypto
        income = round(rng.uniform(2100, 9200), -1)
        out.append({
            "id": f"C-{rng.randint(100, 999):04d}-{rng.randint(100, 999)}",
            "name": f"{rng.choice(FIRST)} {rng.choice(LAST)}", "age": rng.randint(27, 63), "profile": prof,
            "commune": rng.choice(COMMUNES), "fin": fin, "eq": eq, "eq_target": tgt, "eq_max": eq_max, "crypto": crypto,
            "crypto_max": cr_max, "w": w, "income": income, "savings": rng.choice([0, 50, 100, 150, 200, 300, 400, 500, 800]),
            "mifid_months": rng.randint(1, 30), "home": rng.random() < 0.6, "goal_f": rng.uniform(0.7, 1.25),
        })
    return out


def _moves(payload):
    d = lambda k: (payload.get(k) or {}).get("data") or []
    mv = {m["symbol"]: m["change"] for m in d("markets") + d("commodities")}
    btc = next((c for c in d("crypto") if c.get("pair") == "BTC/EUR"), None)
    if btc:
        mv["BTC"] = btc["change"]
    return mv


def _score(c, mv, camille=None):
    impact = sum(c["fin"] * wt * mv.get(k, 0) / 100 for k, wt in c["w"].items())
    years = max(1, 60 - c["age"]) if c["age"] < 59 else 2
    r = c["eq"] * 0.045 + (1 - c["eq"]) * 0.004
    proj = c["fin"] * (1 + r) ** years + c["savings"] * 12 * (((1 + r) ** years - 1) / r if r else years)
    target = max(10000, round(proj * c.get("goal_f", 1.0), -4))
    sig = max(0.02, c["eq"] * 0.15 * math.sqrt(years))
    prob = 1 - _phi((math.log(target / proj) + sig ** 2 / 2) / sig)
    if camille:
        impact, prob, target = camille["impact"], camille["prob"], camille["target"]
    reasons, score = [], 0.0
    pct = impact / c["fin"] * 100
    if pct < -0.15:
        score += min(35, -pct * 25)
        reasons.append(("marche", f"Variation du jour {pct:+.2f} %".replace(".", ",")))
    if c["crypto"] > c["crypto_max"]:
        score += 25
        reasons.append(("crypto", f"Crypto {c['crypto'] * 100:.1f} % > limite {c['crypto_max'] * 100:.0f} %".replace(".", ",")))
    if c["eq"] > c["eq_max"] or abs(c["eq"] - c["eq_target"]) > 0.2:
        score += 18
        reasons.append(("alloc", f"Actions {c['eq'] * 100:.0f} % pour une cible de {c['eq_target'] * 100:.0f} %"))
    if prob < 0.5:
        score += 22 * (1 - prob)
        reasons.append(("retraite", f"Objectif retraite atteint dans {prob * 100:.0f} % des cas"))
    if c["mifid_months"] > 18:
        score += 10
        reasons.append(("mifid", f"Questionnaire MiFID daté de {c['mifid_months']} mois"))
    return impact, prob, target, score, reasons


MESSAGES = {
    "crypto": "votre exposition aux crypto-actifs dépasse désormais la limite prévue par votre profil. Je vous propose d'en parler pour décider ensemble d'un éventuel rééquilibrage.",
    "alloc": "la répartition de votre épargne s'est éloignée de votre profil. Un rééquilibrage permettrait de revenir au niveau de risque que nous avions défini.",
    "retraite": "au rythme actuel, votre objectif de capital pour la retraite n'est atteint que dans une minorité de scénarios. Quelques ajustements simples peuvent changer la trajectoire.",
    "marche": "les marchés ont reculé aujourd'hui et votre portefeuille y est sensible. Rien d'alarmant à votre horizon, mais je reste disponible si vous souhaitez faire le point.",
    "mifid": "votre questionnaire de profil investisseur doit être mis à jour pour que nos conseils restent adaptés à votre situation.",
}


def build(payload, pf):
    mv = _moves(payload)
    cam = pf["client"]
    rows = []
    for i, c in enumerate(book()):
        camille = None
        if i == 0:
            c = dict(c, id=cam["id"], name=cam["name"], age=cam["age"], profile="Équilibré", commune=cam["city"], fin=pf["totals"]["financial"],
                     crypto=next((a["value"] for a in pf["allocation"] if a["cls"] == "Crypto"), 0) / pf["totals"]["financial"], crypto_max=0.03,
                     eq=0.55, eq_target=0.5, eq_max=0.7, savings=cam["savings_month"], mifid_months=7)
            camille = {"impact": pf["totals"]["pnl"], "prob": 0.57, "target": 420000}
        impact, prob, target, score, reasons = _score(c, mv, camille)
        main = reasons[0][0] if reasons else None
        if reasons:
            main = max(reasons, key=lambda r: ["mifid", "marche", "alloc", "retraite", "crypto"].index(r[0]))[0]
        msg = (f"Bonjour {c['name'].split()[0]}, " + MESSAGES[main] + f" Bien à vous, {cam['advisor']}") if main else ""
        rows.append({"id": c["id"], "name": c["name"], "age": c["age"], "profile": c["profile"], "commune": c["commune"],
                     "fin": c["fin"], "impact": impact, "prob": prob, "target": target, "score": round(min(100, score)),
                     "reasons": [r[1] for r in reasons], "kinds": [r[0] for r in reasons], "message": msg,
                     "drivers": {k: round(v, 4) for k, v in c["w"].items()}})
    rows.sort(key=lambda r: -r["score"])
    events = []
    for k, chg in mv.items():
        if k not in LABEL:
            continue
        ex = [(r, r["drivers"].get(k, 0)) for r in rows if r["drivers"].get(k, 0) > 0]
        if not ex:
            continue
        expo = sum(r["fin"] * w for r, w in ex)
        events.append({"key": k, "event_id": ("cr-BTC" if k == "BTC" else ("cm-" if k == "CL=F" else "mk-") + k),
                       "label": f"{LABEL[k]} {chg:+.2f} %".replace(".", ","), "clients": len(ex), "exposed": expo, "impact": expo * chg / 100})
    events.sort(key=lambda e: -abs(e["impact"]))
    kinds = {}
    for r in rows:
        for k in r["kinds"]:
            kinds[k] = kinds.get(k, 0) + 1
    return {"agency": cam["agency"], "advisor": cam["advisor"], "n": len(rows), "aum": sum(r["fin"] for r in rows),
            "impact": sum(r["impact"] for r in rows), "to_contact": sum(r["score"] >= 40 for r in rows),
            "at_risk": sum(r["prob"] < 0.5 for r in rows), "kinds": kinds,
            "clients": rows[:60] + [r for r in rows[60:] if r["id"] == cam["id"]], "events": events}


def investigate(pf, adv, event_id):
    e = next((x for x in pf["exposures"] if x["event_id"] == event_id), None)
    if not e:
        return {"error": "événement non relié au portefeuille"}
    key = event_id.split("-", 1)[1] if event_id[:3] in ("mk-", "cm-") else ("BTC" if event_id == "cr-BTC" else None)
    pos = {p["id"]: p for p in pf["positions"]}
    rows = []
    for pid in e["positions"]:
        p = pos[pid]
        w = next((d["w"] for d in p.get("drivers", []) if d["key"] == key), 1.0 if key == "BTC" and p["cls"] == "Crypto" else None)
        rows.append({"id": pid, "name": p["name"], "env": p["env"], "value": p["value"], "w": w,
                     "contrib": (p["value"] * w * (e["impact"] / max(1e-9, sum(pos[q]["value"] * (next((d["w"] for d in pos[q].get("drivers", []) if d["key"] == key), 1.0 if key == "BTC" else 0)) for q in e["positions"]))) if (w is not None and e["impact"] is not None) else None)})
    agency = next((x for x in adv["events"] if x["event_id"] == event_id), None)
    years = 60 - pf["client"]["age"]
    return {"exposure": e, "positions": rows, "agency": agency,
            "horizon_effect": e["impact"] * 1.025 ** years if e["impact"] is not None else None, "years": years,
            "total_fin": pf["totals"]["financial"]}
