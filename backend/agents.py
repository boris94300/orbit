"""Pipeline d'agents gouverné : calculs déterministes, mandat, conformité et journal d'audit chaîné."""
import asyncio
import hashlib
import json
import os
import time
import uuid

from . import feeds, horizon, llm, portfolio

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIT = os.path.join(ROOT, "data", "audit.jsonl")

AGENTS = [
    {"id": "veille", "name": "Veille", "role": "Collecte les flux et retient les événements matériels"},
    {"id": "exposition", "name": "Analyste d'exposition", "role": "Relie événements et positions, chiffre l'impact"},
    {"id": "projection", "name": "Projectionniste", "role": "Recalcule la trajectoire à 60 ans"},
    {"id": "action", "name": "Agent d'action", "role": "Formule des opérations candidates"},
    {"id": "conformite", "name": "Conformité", "role": "Adéquation MiFID, mandat, traçabilité"},
    {"id": "note", "name": "Moi à 60 ans", "role": "Rédige la note client"},
]
NAMES = {a["id"]: a["name"] for a in AGENTS} | {"client": "Client", "systeme": "Système"}

PROFILE_LIMITS = {"Équilibré": {"equity_max": 0.70, "crypto_max": 0.03}}

STATE = {
    "mandate": {
        "id": "MDT-2026-0417",
        "signed": "2026-09-30",
        "expires": "2027-09-30",
        "monthly_cap": 250.0,
        "used": 0.0,
        "allowed": ["Versement programmé PER ou assurance-vie", "Arbitrage ≤ 5 % de l'encours financier"],
        "forbidden": ["Crypto-actifs", "Produits à effet de levier", "Rachat ou retrait"],
        "validation": "Validation explicite du client pour chaque opération",
    },
    "pending": [],
    "log": [],
    "last_hash": "0" * 64,
    "note": None,
}


def _load():
    if not os.path.exists(AUDIT):
        return
    with open(AUDIT, encoding="utf-8") as f:
        for line in f:
            try:
                STATE["log"].append(json.loads(line))
            except ValueError:
                pass
    STATE["log"] = STATE["log"][-300:]
    if STATE["log"]:
        STATE["last_hash"] = STATE["log"][-1]["hash"]


_load()


def log(agent, op, detail, source="", decision=""):
    e = {"ts": time.time(), "agent": agent, "agent_name": NAMES.get(agent, agent), "op": op, "detail": detail,
         "source": source, "decision": decision, "prev": STATE["last_hash"]}
    e["hash"] = hashlib.sha256(json.dumps(e, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    STATE["last_hash"] = e["hash"]
    STATE["log"].append(e)
    os.makedirs(os.path.dirname(AUDIT), exist_ok=True)
    with open(AUDIT, "a", encoding="utf-8") as f:
        f.write(json.dumps(e, ensure_ascii=False) + "\n")
    return e


def fr(v, d=0):
    s = f"{v:,.{d}f}".replace(",", "\u202f").replace(".", ",")
    return s


def state():
    return {"agents": AGENTS, "mandate": STATE["mandate"], "pending": STATE["pending"], "log": STATE["log"][-120:],
            "mode": llm.mode(), "note": STATE["note"]}


async def run():
    t_run = time.time()
    rid = "R-" + uuid.uuid4().hex[:6].upper()
    yield {"type": "start", "run": rid, "mode": llm.mode()}

    async def step(agent):
        return {"type": "step", "agent": agent, "status": "running"}

    def done(agent, t0, summary, status="done"):
        return {"type": "step_end", "agent": agent, "status": status, "summary": summary, "ms": int((time.time() - t0) * 1000)}

    def out(e):
        return {"type": "log", "entry": e}

    # Veille
    t0 = time.time(); yield await step("veille")
    payload = await feeds.collect()
    live = sum(1 for f in payload.values() if f.get("status") == "live")
    items = sum(len(f.get("data") or []) for f in payload.values() if isinstance(f.get("data"), list))
    srcs = sorted({f.get("source", "") for f in payload.values() if f.get("status") in ("live", "cache")})
    yield out(log("veille", "Collecte", f"{live}/{len(payload)} flux en direct · {items} éléments lus · cycle {rid}", ", ".join(srcs)))
    pf = portfolio.build(payload, await portfolio.georisques())
    exps = pf["exposures"]
    material = [e for e in exps if (e["impact"] is not None and abs(e["impact"]) >= 20) or (e["impact"] is None and e["exposed"] >= 10000)]
    yield out(log("veille", "Filtrage", f"{len(material)} événements matériels sur {len(exps)} reliés au portefeuille (seuils : impact ≥ 20 € ou encours exposé ≥ 10 k€)"))
    await asyncio.sleep(0.3)
    yield done("veille", t0, f"{len(material)} événements retenus")

    # Exposition
    t0 = time.time(); yield await step("exposition")
    calc = [e for e in exps if e["impact"] is not None]
    total = sum(e["impact"] for e in calc)
    yield out(log("exposition", "Chiffrage", f"{len(calc)} liens chiffrés · impact cumulé du jour {total:+.2f} €".replace(".", ","), "Yahoo Finance, Kraken"))
    if calc:
        top = max(calc, key=lambda e: abs(e["impact"]))
        yield out(log("exposition", "Contributeur principal", f"{top['label']} : {top['impact']:+.2f} € ({top['rationale']})".replace(f"{top['impact']:+.2f}", f"{top['impact']:+.2f}".replace(".", ","))))
    unq = [e for e in exps if e["impact"] is None]
    if unq:
        big = max(unq, key=lambda e: e["exposed"])
        yield out(log("exposition", "Exposition non chiffrable", f"{len(unq)} liens qualitatifs · plus large : {big['label'][:70]} (encours {fr(big['exposed'])} €)"))
    await asyncio.sleep(0.3)
    yield done("exposition", t0, f"{total:+.2f} € aujourd'hui".replace(".", ","))

    # Projection
    t0 = time.time(); yield await step("projection")
    rates = (payload.get("rates") or {}).get("data") or []
    savings = pf["client"]["savings_month"]
    h = await asyncio.to_thread(horizon.project, pf, rates, savings, 60, 55, 420000)
    S = h["sensitivity"]
    yield out(log("projection", "Monte-Carlo", f"{fr(h['n'])} scénarios · médiane à 60 ans {fr(h['final']['p50'])} € · P(objectif 420 k€) = {h['prob'] * 100:.0f} %", "BCE €STR, Eurostat IPCH"))
    yield out(log("projection", "Effet du jour", f"{S['today']:+.0f} € sur la médiane à 60 ans · leviers : +100 €/mois +{fr(S['plus100'])} € · départ +2 ans +{fr(S['plus2y'])} €"))
    await asyncio.sleep(0.3)
    yield done("projection", t0, f"P(objectif) {h['prob'] * 100:.0f} %")

    # Action
    t0 = time.time(); yield await step("action")
    fin = pf["totals"]["financial"]
    btc = next((c for c in ((payload.get("crypto") or {}).get("data") or []) if c.get("pair") == "BTC/EUR"), None)
    props = [
        {"id": "A-" + uuid.uuid4().hex[:6].upper(), "kind": "versement", "title": "Versement programmé PER +100 €/mois",
         "target": "Gestion pilotée · horizon 2045", "amount": 100.0, "unit": "€/mois", "effect": S["plus100"],
         "rationale": f"Levier le plus efficace à effort comparable : +{fr(S['plus100'])} € sur la médiane à 60 ans. Versements déductibles du revenu imposable (TMI 30 % supposée : économie ≈ 360 €/an)."},
        {"id": "A-" + uuid.uuid4().hex[:6].upper(), "kind": "arbitrage", "title": "Arbitrage fonds euros → UC actions (+10 pts)",
         "target": "Assurance-vie", "amount": round(fin * 0.10, 2), "unit": "€", "effect": S["equity_plus10"],
         "rationale": f"Hausse de la part actions de 55 % à 65 % : +{fr(S['equity_plus10'])} € sur la médiane, au prix d'une dispersion plus forte."},
    ]
    if btc:
        props.append({"id": "A-" + uuid.uuid4().hex[:6].upper(), "kind": "crypto", "title": "Renforcer la position Bitcoin (500 €)",
                      "target": "Compte crypto", "amount": 500.0, "unit": "€", "effect": None,
                      "rationale": f"Signal de marché : Bitcoin {btc['change']:+.2f} % sur 24 h.".replace(".", ",", 1)})
    for p in props:
        yield out(log("action", "Proposition", f"{p['id']} · {p['title']}", decision="soumis à conformité"))
    await asyncio.sleep(0.3)
    yield done("action", t0, f"{len(props)} opérations candidates")

    # Conformité
    t0 = time.time(); yield await step("conformite")
    M, lim = STATE["mandate"], PROFILE_LIMITS[pf["client"]["profile"]]
    alloc = {a["cls"]: a["value"] for a in pf["allocation"]}
    crypto_share = alloc.get("Crypto", 0) / fin
    remaining = M["monthly_cap"] - M["used"]
    for p in props:
        if p["kind"] == "versement":
            ok = p["amount"] <= remaining
            p["checks"] = [["Adéquation au profil Équilibré", True, "gestion pilotée, risque décroissant"],
                           ["Opération autorisée par le mandat", True, "versement programmé PER"],
                           ["Plafond mensuel", ok, f"{fr(p['amount'])} € pour {fr(remaining)} € disponibles"],
                           ["Information précontractuelle", True, "DIC du PER remis le 12/03/2026"]]
            p["status"] = "pending" if ok else "blocked"
        elif p["kind"] == "arbitrage":
            share = 0.65
            within = p["amount"] <= fin * 0.05
            p["checks"] = [["Part actions après opération", share <= lim["equity_max"], f"65 % pour une limite de {lim['equity_max'] * 100:.0f} %"],
                           ["Montant dans le mandat", within, f"{fr(p['amount'])} € pour une limite de {fr(fin * 0.05)} € (5 %)"]]
            p["status"] = "escalated"
        else:
            p["checks"] = [["Classe d'actifs autorisée", False, "crypto-actifs exclus du mandat"],
                           ["Concentration crypto", crypto_share <= lim["crypto_max"], f"{crypto_share * 100:.1f} % pour une limite de {lim['crypto_max'] * 100:.0f} %".replace(".", ",")],
                           ["Motif de la proposition", False, "signal de court terme, non lié à l'objectif retraite"]]
            p["status"] = "blocked"
        label = {"pending": "validation client requise", "escalated": "hors mandat · transmis au conseiller", "blocked": "bloqué"}[p["status"]]
        fails = [c[0] for c in p["checks"] if not c[1]]
        yield out(log("conformite", "Contrôle", f"{p['id']} · {p['title']}" + (f" · motifs : {', '.join(fails).lower()}" if fails else " · tous contrôles satisfaits"),
                      "Profil MiFID 12/03/2026 · mandat " + M["id"], label))
    STATE["pending"] = [p for p in STATE["pending"] if p["status"] == "executed"][-3:] + props
    await asyncio.sleep(0.3)
    yield done("conformite", t0, f"1 à valider · {sum(p['status'] == 'blocked' for p in props)} bloquée(s)")

    # Note
    t0 = time.time(); yield await step("note")
    pnl = pf["totals"]["pnl"]
    text = (f"Si je garde mon rythme de {fr(savings)} € par mois, j'aurai environ {fr(round(h['final']['p50'], -3))} € d'épargne financière à 60 ans, "
            f"en euros d'aujourd'hui, avec {h['prob'] * 100:.0f} % de chances d'atteindre mon objectif de {fr(420000)} €. "
            f"Les marchés ont fait varier mon portefeuille de {pnl:+.0f} € aujourd'hui, soit {S['today']:+.0f} € sur ce capital : rien qui justifie de changer de cap. "
            f"En ajoutant 100 € par mois sur mon PER, la médiane gagnerait environ {fr(round(S['plus100'], -2))} €, et mes impôts baisseraient.")
    src = "règles"
    rew = await llm.rewrite(text)
    if rew and llm.guard(text, rew):
        text, src = rew, llm.mode()
        yield out(log("note", "Rédaction", f"Note reformulée par {src} · contrôle des chiffres conforme", decision="publié"))
    elif rew:
        yield out(log("note", "Rédaction", f"Reformulation {llm.mode()} rejetée : chiffres non conformes · note de règles conservée", decision="rejeté"))
    else:
        yield out(log("note", "Rédaction", "Note produite par règles déterministes (aucun modèle configuré)", decision="publié"))
    STATE["note"] = {"text": text, "source": src, "ts": time.time()}
    await asyncio.sleep(0.2)
    yield done("note", t0, "note publiée")

    yield out(log("systeme", "Fin de cycle", f"Cycle {rid} terminé en {time.time() - t_run:.1f} s".replace(".", ",")))
    yield {"type": "done", "pending": STATE["pending"], "mandate": STATE["mandate"], "note": STATE["note"]}


def decide(aid, decision):
    p = next((x for x in STATE["pending"] if x["id"] == aid), None)
    if not p or p["status"] != "pending":
        return {"error": "proposition introuvable ou non validable"}
    M, entries = STATE["mandate"], []
    if decision == "approve":
        entries.append(log("client", "Validation", f"{p['id']} · {p['title']}", "authentification forte (simulée)", "approuvé"))
        if p["amount"] > M["monthly_cap"] - M["used"]:
            p["status"] = "blocked"
            entries.append(log("conformite", "Contrôle pré-exécution", f"{p['id']} · plafond dépassé", decision="bloqué"))
        else:
            entries.append(log("conformite", "Contrôle pré-exécution", f"{p['id']} · mandat {M['id']} valide · plafond respecté", decision="conforme"))
            M["used"] += p["amount"]
            p["status"], p["ref"], p["executed_at"] = "executed", "ORB-" + uuid.uuid4().hex[:8].upper(), time.time()
            entries.append(log("action", "Exécution", f"{p['id']} · ordre transmis au teneur de compte (simulation, aucun flux réel) · réf {p['ref']}", decision="exécuté"))
    else:
        p["status"] = "rejected"
        entries.append(log("client", "Refus", f"{p['id']} · {p['title']}", decision="refusé"))
    return {"proposal": p, "entries": entries, "mandate": M}
