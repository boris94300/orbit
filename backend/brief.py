"""Fiche d'une page pour le rendez-vous avec le conseiller bancaire (PDF, chiffres du moteur Orbit)."""
import time

from fpdf import FPDF

from . import fees, immo, life, risks

REPL = {"€": " EUR", "−": "-", "→": "->", "≈": "~", "’": "'", "«": '"', "»": '"', "…": "...", "œ": "oe", " ": " ", " ": " ", "–": "-", "—": "-"}


def _t(s):
    s = str(s)
    for a, b in REPL.items():
        s = s.replace(a, b)
    return s.encode("latin-1", "replace").decode("latin-1")


def _k(v):
    return f"{round(v / 1000):,}".replace(",", " ") + " k€"


def _e(v):
    return f"{round(v):,}".replace(",", " ") + " €"


def build(p, journal, stats):
    g = p.get("goal_month") or 0
    age = 2026 - p["birth_year"]
    r = life.project(p)
    sc, ref = r["scenarios"], r["ref"]
    st = stats(p, g)
    fz = fees.annual(p)
    paid = sc["mid"]["rows"][ref]["fees"]
    alt = max(((stats(life.merge(p, {"broker": k}), g)["net"] - st["net"], b["name"]) for k, b in fees.BROKERS.items() if k not in (p.get("broker"), "degiro_actions")), default=None)
    rk = risks.assess(p, g, stats)
    im = immo.CACHE.get((p.get("city") or "").strip())

    pdf = FPDF(format="A4")
    pdf.set_auto_page_break(True, 14)
    pdf.add_page()
    pdf.set_margins(16, 14, 16)
    W = pdf.w - 32

    def h(t):
        pdf.ln(3)
        pdf.set_font("Helvetica", "B", 11)
        pdf.set_text_color(30, 60, 140)
        pdf.cell(W, 7, _t(t), new_x="LMARGIN", new_y="NEXT")
        pdf.set_text_color(20, 20, 25)

    def line(a, b=""):
        pdf.set_font("Helvetica", "", 9.5)
        if b:
            pdf.cell(W * 0.55, 5.4, _t(a))
            pdf.set_font("Helvetica", "B", 9.5)
            pdf.cell(W * 0.45, 5.4, _t(b), align="R", new_x="LMARGIN", new_y="NEXT")
        else:
            pdf.multi_cell(W, 5, _t(a), new_x="LMARGIN", new_y="NEXT")

    pdf.set_font("Helvetica", "B", 17)
    pdf.cell(W, 9, _t("Fiche rendez-vous bancaire"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(110, 110, 120)
    pdf.cell(W, 5, _t(f"Préparée par Orbit le {time.strftime('%d/%m/%Y')} · {p['first_name']} {p['last_name']}, {age} ans, {p['city']}"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(20, 20, 25)

    h("1. Ma situation")
    line("Revenu net mensuel", _e(p["income_month"]))
    line("Épargne mise de côté chaque mois", _e(p["savings_month"]))
    line("Livrets et compte", _e(p["cash"]))
    line(f"Placements ({p['equity_share']} % actions)", _e(p["invested"]))
    line("Logement", f"{p['housing']}" + (f", loyer {_e(p['rent_month'])}" if p["housing"] == "locataire" else ""))

    h("2. Mon objectif et ma trajectoire")
    line(f"Revenu visé à la retraite ({p['retire_age']} ans)", f"{_e(g)} / mois")
    line("Chances de l'atteindre (30 séquences de marché réelles)", f"{round(st['prob'] * 100)} %")
    line(f"Patrimoine à {p['retire_age']} ans : défavorable / médian / favorable",
         f"{_k(sc['bad']['rows'][ref]['net'])} / {_k(sc['mid']['rows'][ref]['net'])} / {_k(sc['good']['rows'][ref]['net'])}")

    h("3. Mes frais")
    line(f"Support actuel : {fz['broker']}", f"{_k(paid)} d'ici {p['retire_age']} ans")
    line(fz["note"])
    if alt and alt[0] > 5000:
        line(f"Alternative la moins chère : {alt[1]}", f"+{_k(alt[0])}")

    if im and p["housing"] == "locataire":
        cap = immo.capacity(p, im["med"])
        h("4. Mon projet immobilier")
        line(f"Prix médian à {im['city']} ({im['n']} ventes DVF {im['year']})", f"{_e(im['med'])} / m²")
        line(f"Budget maximal (35 % d'endettement, {cap['years']} ans à {cap['rate']} %)", f"{_k(cap['price'])} · {round(cap['m2'])} m²")

    h("5. Coups durs testés par Orbit")
    for x in rk:
        line(f"{x['title']} ({x['age']} ans)", f"{_k(x['loss'])} à {x['at']} ans")

    ok = [j for j in journal if j.get("ok")]
    if ok:
        h("6. Décisions que j'ai validées")
        for j in ok[-5:]:
            line(f"{time.strftime('%d/%m', time.localtime(j['t']))} · {j['title']}", f"+{_k(j.get('gain', 0))}")

    h("Questions à poser à mon conseiller")
    qs = [f"Quels sont les frais exacts (entrée, gestion, arbitrage) de mes placements ? Orbit les estime à {_k(paid)} d'ici la retraite.",
          "Mon épargne de précaution (3 à 6 mois de dépenses) est-elle suffisante avant d'investir davantage ?",
          "Quelle prévoyance couvre un arrêt de travail ou une invalidité ?",
          "PEA, assurance-vie ou PER : quelle enveloppe pour mes prochains versements ?"]
    for i, q in enumerate(qs, 1):
        line(f"{i}. {q}")
    pdf.ln(3)
    pdf.set_font("Helvetica", "I", 7.5)
    pdf.set_text_color(120, 120, 130)
    pdf.multi_cell(W, 4, _t("Simulation Orbit en euros d'aujourd'hui, rejouée sur les marchés réels 1996-2025. Sources : Yahoo Finance, BCE, Eurostat, DVF (data.gouv.fr), INSEE, Assurance maladie, DREES, tarifs publics des courtiers. Illustration, pas un conseil en investissement ni une promesse de rendement."))
    return bytes(pdf.output())
