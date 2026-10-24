"""Comptes : mot de passe bcrypt, session signée, double authentification TOTP (RFC 6238), anti-bruteforce."""
import base64, copy, hashlib, hmac, io, json, os, re, secrets, sqlite3, struct, threading, time
from urllib.parse import quote

import bcrypt
import qrcode
import qrcode.image.svg
from cryptography.fernet import Fernet, InvalidToken
from itsdangerous import BadSignature, URLSafeTimedSerializer

from . import life

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, "data", "orbit.db")
KEYFILE = os.path.join(ROOT, "data", "secret.key")
COOKIE = "orbit_s"
SESSION_AGE = 12 * 3600
MAX_FAILS, LOCK_S = 5, 300
DEMO_EMAIL, DEMO_PASSWORD = "camille.moreau@orbit.demo", "Orbit-2026"
_lock = threading.Lock()
_ip_hits = {}


def _key():
    if os.environ.get("ORBIT_SECRET"):
        return os.environ["ORBIT_SECRET"]
    if not os.path.exists(KEYFILE):
        with open(KEYFILE, "w") as f:
            f.write(secrets.token_hex(32))
        os.chmod(KEYFILE, 0o600)
    return open(KEYFILE).read().strip()


SER = URLSafeTimedSerializer(_key())
# Render (offre gratuite) efface data/ à chaque redémarrage : le navigateur garde une copie chiffrée du compte pour le restaurer.
BOX = Fernet(base64.urlsafe_b64encode(hashlib.sha256(("orbit-backup:" + _key()).encode()).digest()))
BACKUP_AGE = 60 * 24 * 3600


def _db():
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    return c


def init():
    with _db() as c:
        c.execute("""create table if not exists users(id integer primary key, email text unique not null, pw blob not null,
            totp text, totp_on integer default 0, profile text not null, fails integer default 0, locked_until real default 0,
            ver integer default 0, created real)""")
        if not c.execute("select 1 from users where email=?", (DEMO_EMAIL,)).fetchone():
            c.execute("insert into users(email,pw,profile,created) values(?,?,?,?)",
                      (DEMO_EMAIL, bcrypt.hashpw(DEMO_PASSWORD.encode(), bcrypt.gensalt()), json.dumps(life.DEMO), time.time()))


def _user(uid=None, email=None):
    with _db() as c:
        r = c.execute("select * from users where " + ("id=?" if uid else "email=?"), (uid or email,)).fetchone()
    return dict(r) if r else None


def public(u):
    p = json.loads(u["profile"])
    return {"email": u["email"], "totp_on": bool(u["totp_on"]), "first_name": p.get("first_name", ""), "last_name": p.get("last_name", ""),
            "demo": u["email"] == DEMO_EMAIL}


# ---------- TOTP ----------
def _hotp(secret, counter):
    h = hmac.new(base64.b32decode(secret), struct.pack(">Q", counter), hashlib.sha1).digest()
    o = h[-1] & 15
    return "%06d" % ((struct.unpack(">I", h[o:o + 4])[0] & 0x7FFFFFFF) % 1_000_000)


def totp_ok(secret, code):
    code = re.sub(r"\D", "", code or "")
    t = int(time.time() // 30)
    return len(code) == 6 and any(hmac.compare_digest(_hotp(secret, t + d), code) for d in (-1, 0, 1))


# ---------- anti-bruteforce ----------
def ip_allowed(ip):
    now = time.time()
    hits = [t for t in _ip_hits.get(ip, []) if now - t < 600]
    _ip_hits[ip] = hits
    return len(hits) < 30


def _fail(u, ip):
    _ip_hits.setdefault(ip, []).append(time.time())
    if not u:
        return
    fails = u["fails"] + 1
    with _db() as c:
        c.execute("update users set fails=?, locked_until=? where id=?",
                  (fails if fails < MAX_FAILS else 0, time.time() + LOCK_S if fails >= MAX_FAILS else u["locked_until"], u["id"]))


def _locked(u):
    return u and u["locked_until"] > time.time()


# ---------- parcours ----------
def register(email, password):
    email = (email or "").strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        return None, "Adresse email invalide."
    if len(password or "") < 10 or not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        return None, "Le mot de passe doit faire au moins 10 caractères, avec des lettres et des chiffres."
    prof = copy.deepcopy(life.BLANK)
    prof["first_name"] = email.split("@")[0].split(".")[0].capitalize()
    try:
        with _lock, _db() as c:
            cur = c.execute("insert into users(email,pw,profile,created) values(?,?,?,?)",
                            (email, bcrypt.hashpw(password.encode(), bcrypt.gensalt()), json.dumps(prof), time.time()))
            return cur.lastrowid, None
    except sqlite3.IntegrityError:
        return None, "Un compte existe déjà avec cette adresse."


def login(email, password, ip):
    if not ip_allowed(ip):
        return {"error": "Trop de tentatives depuis cette connexion. Réessaie dans quelques minutes."}
    u = _user(email=(email or "").strip().lower())
    if _locked(u):
        return {"error": f"Compte verrouillé après {MAX_FAILS} essais. Réessaie dans {int((u['locked_until'] - time.time()) // 60) + 1} min."}
    if not u or not bcrypt.checkpw((password or "").encode(), u["pw"]):
        bcrypt.checkpw(b"x", bcrypt.hashpw(b"y", bcrypt.gensalt(4))) if not u else None
        _fail(u, ip)
        return {"error": "Email ou mot de passe incorrect."}
    if u["totp_on"]:
        return {"need_totp": True, "ticket": SER.dumps({"uid": u["id"], "ver": u["ver"]}, salt="2fa")}
    return _ok(u)


def second_factor(ticket, code, ip):
    if not ip_allowed(ip):
        return {"error": "Trop de tentatives. Réessaie dans quelques minutes."}
    try:
        d = SER.loads(ticket, salt="2fa", max_age=300)
    except BadSignature:
        return {"error": "Session expirée, reconnecte-toi.", "restart": True}
    u = _user(uid=d["uid"])
    if not u or _locked(u):
        return {"error": "Compte temporairement verrouillé.", "restart": True}
    if not totp_ok(u["totp"], code):
        _fail(u, ip)
        return {"error": "Code incorrect."}
    return _ok(u)


def _ok(u):
    with _db() as c:
        c.execute("update users set fails=0, locked_until=0 where id=?", (u["id"],))
    return {"ok": True, "cookie": SER.dumps({"uid": u["id"], "em": u["email"], "ver": u["ver"]}, salt="session"), "user": public(u)}


def session_user(token):
    if not token:
        return None
    try:
        d = SER.loads(token, salt="session", max_age=SESSION_AGE)
    except BadSignature:
        return None
    u = _user(email=d["em"]) if d.get("em") else _user(uid=d["uid"])
    return u if u and u["ver"] == d["ver"] else None


def backup(u):
    pw = u["pw"].decode() if isinstance(u["pw"], bytes) else u["pw"]
    d = {"t": time.time(), "email": u["email"], "pw": pw, "totp": u["totp"], "totp_on": u["totp_on"], "ver": u["ver"], "profile": u["profile"]}
    return BOX.encrypt(json.dumps(d).encode()).decode()


def restore(token):
    try:
        d = json.loads(BOX.decrypt((token or "").encode(), ttl=BACKUP_AGE))
    except (InvalidToken, ValueError, TypeError):
        return "invalid"
    vals = (d["pw"].encode(), d["totp"], d["totp_on"], d["profile"], d["ver"], d["t"])
    with _lock, _db() as c:
        row = c.execute("select created from users where email=?", (d["email"],)).fetchone()
        if not row:
            c.execute("insert into users(pw,totp,totp_on,profile,ver,created,email) values(?,?,?,?,?,?,?)", vals + (d["email"],))
            return "restored"
        if row["created"] > d["t"]:
            c.execute("update users set pw=?,totp=?,totp_on=?,profile=?,ver=?,created=? where email=?", vals + (d["email"],))
            return "restored"
    return "current"


def logout_all(u):
    with _db() as c:
        c.execute("update users set ver=ver+1 where id=?", (u["id"],))


def totp_setup(u):
    secret = base64.b32encode(secrets.token_bytes(20)).decode()
    with _db() as c:
        c.execute("update users set totp=?, totp_on=0 where id=?", (secret, u["id"]))
    uri = f"otpauth://totp/Orbit:{quote(u['email'])}?secret={secret}&issuer=Orbit&digits=6&period=30"
    buf = io.BytesIO()
    qrcode.make(uri, image_factory=qrcode.image.svg.SvgPathImage, box_size=8, border=1).save(buf)
    return {"secret": secret, "svg": buf.getvalue().decode()}


def totp_enable(u, code):
    if not u["totp"] or not totp_ok(u["totp"], code):
        return {"error": "Code incorrect. Vérifie l'heure de ton téléphone et réessaie."}
    with _db() as c:
        c.execute("update users set totp_on=1, ver=ver+1 where id=?", (u["id"],))
    return _ok(_user(uid=u["id"]))


def totp_disable(u, code):
    if not u["totp_on"] or not totp_ok(u["totp"], code):
        return {"error": "Code incorrect."}
    with _db() as c:
        c.execute("update users set totp=null, totp_on=0 where id=?", (u["id"],))
    return {"ok": True}


def get_profile(u):
    return json.loads(u["profile"])


def save_profile(u, p):
    with _db() as c:
        c.execute("update users set profile=? where id=?", (json.dumps(p), u["id"]))
