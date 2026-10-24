"""Frais réels d'investissement : courtage par ordre, frais de gestion annuels, abonnements. Tarifs publics relevés en octobre 2026."""

# order(amount) -> frais d'un ordre en euros ; ter = frais annuels prélevés sur l'encours
BROKERS = {
    "banque": {"name": "Fonds de ta banque (réseau)", "kind": "Fonds actions maison",
               "order": lambda a: a * 0.02, "ter": 0.018,
               "note": "Droits d'entrée jusqu'à 2 % par versement + frais courants ≈ 1,8 %/an (ordre de grandeur des fonds actions vendus en agence)",
               "src": "AMF · Document d'informations clés des fonds (frais courants)"},
    "av_ligne": {"name": "Assurance-vie en ligne (ETF)", "kind": "Unités de compte ETF",
                 "order": lambda a: 0.0, "ter": 0.0060 + 0.0020,
                 "note": "0 € par versement, frais de gestion du contrat ≈ 0,6 %/an + ETF ≈ 0,2 %/an",
                 "src": "Grilles tarifaires publiques des contrats en ligne"},
    "fortuneo": {"name": "Fortuneo · offre Starter", "kind": "ETF monde sur PEA",
                 "order": lambda a: 0.0 if a <= 500 else a * 0.0035, "ter": 0.0020, "first_free": True,
                 "note": "1er ordre du mois ≤ 500 € gratuit, sinon 0,35 % par ordre · ETF ≈ 0,2 %/an",
                 "src": "fortuneo.fr/bourse/tarifs"},
    "degiro": {"name": "DEGIRO · sélection principale d'ETF", "kind": "ETF monde",
               "order": lambda a: 1.0, "ter": 0.0020,
               "note": "0 € de courtage + 1 € de frais de gestion par ordre · ETF ≈ 0,2 %/an",
               "src": "degiro.fr/tarifs (mis à jour le 01.10.2025)"},
    "degiro_actions": {"name": "DEGIRO · actions Euronext Paris", "kind": "Actions en direct",
                       "order": lambda a: 2.0, "ter": 0.0,
                       "note": "1 € de courtage + 1 € de frais de gestion par ordre, pas de frais annuels",
                       "src": "degiro.fr/tarifs (mis à jour le 01.10.2025)"},
}
# Abonnements d'outils (pas des courtiers) : prix mensuels publics de TradingView
TOOLS = {
    "aucun": {"name": "Aucun outil payant", "month": 0.0},
    "tv_essential": {"name": "TradingView Essential", "month": 14.95},
    "tv_plus": {"name": "TradingView Plus", "month": 34.95},
    "tv_premium": {"name": "TradingView Premium", "month": 69.95},
}
CFD_WARNING = ("MetaTrader est une plateforme de trading de CFD à effet de levier, pas une banque ni un placement : "
               "selon l'avertissement obligatoire de l'ESMA, 74 à 89 % des comptes de particuliers y perdent de l'argent. Orbit ne le simule pas comme une épargne.")
SOURCES = ["fortuneo.fr/bourse/tarifs", "degiro.fr/tarifs", "tradingview.com/pricing", "ESMA · avertissement CFD", "AMF · frais courants des fonds"]


def annual(p):
    """Frais de la première année, en euros d'aujourd'hui, et taux annuel sur l'encours."""
    b = BROKERS.get(p.get("broker"), BROKERS["banque"])
    monthly = p["savings_month"] * p["equity_share"] / 100
    orders = 12 * b["order"](monthly) if monthly > 0 else 0.0
    sub = 12 * TOOLS.get(p.get("tool"), TOOLS["aucun"])["month"]
    return {"broker": b["name"], "ter": b["ter"], "orders": orders, "sub": sub, "note": b["note"], "src": b["src"],
            "order_rate": orders / max(1, 12 * monthly)}
