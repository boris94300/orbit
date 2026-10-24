"""Mon mois : lecture d'un relevé CSV, classement des dépenses, abonnements récurrents, capacité d'épargne réelle. Rien n'est stocké."""
import csv
import io
import re
import unicodedata
from collections import defaultdict

CATS = [
    ("Épargne", ["livret", "epargne", "assurance vie", "pea", "vers compte", "virement interne"]),
    ("Logement", ["loyer", "edf", "engie", "totalenergies elec", "veolia", "eau ", "assurance habitation", "habitation", "syndic", "taxe fonciere"]),
    ("Abonnements", ["netflix", "spotify", "disney", "amazon prime", "prime video", "canal", "deezer", "apple.com", "icloud", "youtube", "free mobile", "freebox", "sfr", "orange", "bouygues", "sosh", "basic fit", "basic-fit", "fitness", "salle de sport", "chatgpt", "openai", "dazn", "audible", "tradingview"]),
    ("Courses", ["carrefour", "leclerc", "auchan", "lidl", "monoprix", "franprix", "intermarche", "casino", "picard", "super u", "aldi", "biocoop", "naturalia"]),
    ("Restaurants", ["uber eats", "deliveroo", "just eat", "mcdonald", "burger king", "kfc", "restaurant", "boulangerie", "starbucks", "brasserie", "sushi", "pizza"]),
    ("Transports", ["sncf", "ratp", "navigo", "uber", "bolt", "blablacar", "total", "esso", "shell", "bp ", "peage", "parking", "velib"]),
    ("Santé", ["pharmacie", "docteur", "medecin", "doctolib", "dentiste", "mutuelle", "opticien"]),
    ("Loisirs", ["fnac", "cinema", "ugc", "pathe", "steam", "playstation", "decathlon", "concert", "ticketmaster"]),
    ("Shopping", ["zara", "h&m", "amazon", "zalando", "uniqlo", "ikea", "vinted", "sephora", "darty", "boulanger"]),
]
INCOME = ["salaire", "paie", "caf", "remboursement", "virement recu", "vir recu", "pole emploi", "france travail"]


def _norm(s):
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", s).strip()


def _num(s):
    s = str(s or "").replace("\u00a0", "").replace(" ", "").replace("€", "")
    if not s:
        return None
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")
    else:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def _month(s):
    s = str(s).strip()
    m = re.match(r"(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})", s)
    if m:
        y = m.group(3)
        return f"{'20' + y if len(y) == 2 else y}-{int(m.group(2)):02d}"
    m = re.match(r"(\d{4})-(\d{2})", s)
    return f"{m.group(1)}-{m.group(2)}" if m else None


def _key(label):
    s = _norm(label)
    s = re.sub(r"\b(prlv|prelevement|sepa|cb|carte|paiement|achat|facture|du|le|vir|virement)\b", " ", s)
    s = re.sub(r"[^a-z& ]", " ", s)
    w = [x for x in s.split() if len(x) > 1]
    return " ".join(w[:2]) or _norm(label)[:12]


def _cat(label, amount):
    s = _norm(label)
    for name, kws in CATS:
        if any(k in s for k in kws):
            return name
    if amount > 0 and any(k in s for k in INCOME):
        return "Revenus"
    return "Revenus" if amount > 0 else "Autres"


def parse(text):
    text = (text or "")[:1_500_000]
    lines = [l for l in text.splitlines() if l.strip()]
    if not lines:
        raise ValueError("Fichier vide.")
    delim = ";" if lines[0].count(";") >= lines[0].count(",") else ","
    rows = list(csv.reader(io.StringIO("\n".join(lines)), delimiter=delim))
    head = [_norm(h) for h in rows[0]]
    find = lambda *ks: next((i for i, h in enumerate(head) if any(k in h for k in ks)), None)
    di, li = find("date"), find("libell", "label", "description", "operation", "intitul", "detail")
    ai, de, cr = find("montant", "amount", "valeur"), find("debit"), find("credit")
    if di is None or li is None or (ai is None and de is None):
        raise ValueError("Colonnes introuvables : il faut une date, un libellé et un montant (ou débit / crédit).")
    out = []
    for r in rows[1:5001]:
        if len(r) <= max(i for i in (di, li, ai, de, cr) if i is not None):
            continue
        if ai is not None:
            a = _num(r[ai])
        else:
            d, c = _num(r[de]) or 0, _num(r[cr]) if cr is not None else 0
            a = (c or 0) - abs(d)
        m = _month(r[di])
        if a is None or not m:
            continue
        out.append({"m": m, "label": r[li].strip()[:80], "a": a})
    if not out:
        raise ValueError("Aucune opération lisible dans ce fichier.")
    return out


def analyze(text, declared=0):
    ops = parse(text)
    months = sorted({o["m"] for o in ops})
    n = max(1, len(months))
    cats, inc, spend, saved = defaultdict(float), 0.0, 0.0, 0.0
    groups = defaultdict(list)
    for o in ops:
        c = _cat(o["label"], o["a"])
        if c == "Revenus":
            inc += o["a"]
            continue
        if o["a"] >= 0:
            continue
        if c == "Épargne":
            saved += -o["a"]
            continue
        cats[c] += -o["a"]
        spend += -o["a"]
        groups[_key(o["label"])].append((o["m"], -o["a"], c, o["label"]))
    subs, fixed = [], []
    for k, g in groups.items():
        ms = {x[0] for x in g}
        if len(ms) < min(2, n):
            continue
        amts = [x[1] for x in g]
        avg = sum(amts) / len(ms)
        if max(amts) > 1.2 * min(amts) or len(g) > len(ms) + 1:
            continue
        nm = re.sub(r"^(prlv|prelevement|sepa|cb|carte|vir)\s+", "", re.sub(r"^(prlv|cb|carte)\s+(sepa\s+)?", "", g[0][3].strip(), flags=re.I), flags=re.I).replace(".COM", "").replace(".com", "").replace(",COM", "").replace(",com", "")
        item = {"name": nm.title()[:40], "key": k, "amount": round(avg, 2), "cat": g[0][2], "months": len(ms), "year": round(avg * 12)}
        (subs if g[0][2] in ("Abonnements", "Loisirs", "Autres", "Shopping") and avg < 80 else fixed).append(item)
    subs.sort(key=lambda x: -x["amount"])
    cl = sorted(({"name": c, "amount": v / n, "share": v / max(1, spend)} for c, v in cats.items()), key=lambda x: -x["amount"])
    return {"months": months, "n": len(ops), "income": inc / n, "spend": spend / n, "saved": saved / n, "capacity": (inc - spend) / n,
            "declared": declared, "cats": cl, "subs": subs, "subs_total": sum(s["amount"] for s in subs), "fixed": fixed[:8]}
