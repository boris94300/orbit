"""Dossier de données inscriptible : data/ en local et sur Render, /tmp sur Vercel (disque en lecture seule)."""
import os
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEED = os.path.join(ROOT, "data")
DATA = os.environ.get("ORBIT_DATA") or ("/tmp/orbit" if os.environ.get("VERCEL") else SEED)
os.makedirs(DATA, exist_ok=True)

if DATA != SEED:
    for name in ("snapshot.json", "history.json"):
        src, dst = os.path.join(SEED, name), os.path.join(DATA, name)
        if os.path.exists(src) and not os.path.exists(dst):
            shutil.copyfile(src, dst)
