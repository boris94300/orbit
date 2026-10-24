"""Reformulation optionnelle par LLM (Mistral, Claude ou Ollama local), avec contrôle des chiffres."""
import os
import re

import httpx

PROMPT = (
    "Tu reformules une note patrimoniale écrite à la première personne par le client à 60 ans. "
    "Règles strictes : conserve exactement tous les nombres et montants, n'ajoute aucun chiffre, "
    "aucune recommandation ni produit nouveau, 4 phrases maximum, français sobre de banque privée, "
    "pas d'emoji, pas de titre. Réponds uniquement par la note."
)


def mode():
    if os.getenv("ANTHROPIC_API_KEY"):
        return "Claude"
    if os.getenv("MISTRAL_API_KEY"):
        return "Mistral"
    if os.getenv("OLLAMA_MODEL"):
        return "Ollama · " + os.getenv("OLLAMA_MODEL")
    return "règles"


def numbers(s):
    out = set()
    for n, k in re.findall(r"(\d[\d\s\u202f\u00a0.,]*\d|\d)(\s?k€)?", s):
        n = re.sub(r"[\s\u202f\u00a0]", "", n).replace(",", ".")
        try:
            v = float(n) * (1000 if k else 1)
            out.add(f"{v:g}" if v != int(v) else str(int(v)))
        except ValueError:
            out.add(n)
    return out


def guard(src, out):
    return bool(out) and numbers(out) <= numbers(src)


async def rewrite(text):
    m = mode()
    if m == "règles":
        return None
    msgs = [{"role": "system", "content": PROMPT}, {"role": "user", "content": text}]
    try:
        async with httpx.AsyncClient(timeout=20) as c:
            if m == "Mistral":
                r = await c.post("https://api.mistral.ai/v1/chat/completions",
                                 headers={"Authorization": "Bearer " + os.environ["MISTRAL_API_KEY"]},
                                 json={"model": os.getenv("MISTRAL_MODEL", "mistral-small-latest"), "messages": msgs, "temperature": 0.2})
                out = r.json()["choices"][0]["message"]["content"]
            elif m == "Claude":
                r = await c.post("https://api.anthropic.com/v1/messages",
                                 headers={"x-api-key": os.environ["ANTHROPIC_API_KEY"], "anthropic-version": "2023-06-01"},
                                 json={"model": "claude-haiku-4-5", "max_tokens": 400,
                                       "system": PROMPT, "messages": msgs[1:]})
                out = r.json()["content"][0]["text"]
            else:
                r = await c.post(os.getenv("OLLAMA_HOST", "http://localhost:11434") + "/api/chat",
                                 json={"model": os.environ["OLLAMA_MODEL"], "messages": msgs, "stream": False})
                out = r.json()["message"]["content"]
        return out.strip()
    except Exception:
        return None


WRITE = (
    "Tu es le conseiller d'Orbit. Réécris ce constat pour un particulier, en français simple et chaleureux, tutoiement, "
    "3 phrases maximum. Règles strictes : garde exactement les nombres fournis, n'en ajoute aucun, aucun produit nouveau, "
    "pas d'emoji, pas de titre. Réponds uniquement par le texte."
)


def _key():
    return os.environ["MISTRAL_API_KEY"]


MODELS = ["mistral-small-latest", "open-mistral-nemo", "ministral-8b-latest"]


async def mistral(messages, tools=None, temperature=0.2):
    first = os.getenv("MISTRAL_MODEL")
    models = ([first] if first else []) + [m for m in MODELS if m != first]
    async with httpx.AsyncClient(timeout=30) as c:
        for i, model in enumerate(models):
            body = {"model": model, "messages": messages, "temperature": temperature}
            if tools:
                body["tools"], body["tool_choice"] = tools, "auto"
            r = await c.post("https://api.mistral.ai/v1/chat/completions", headers={"Authorization": "Bearer " + _key()}, json=body)
            if r.status_code in (403, 429) and i < len(models) - 1:
                print(f"mistral {model}: HTTP {r.status_code}, modèle suivant", flush=True)
                continue
            r.raise_for_status()
            return r.json()


CLAUDE = "https://api.anthropic.com/v1/messages"


async def claude(system, messages, tools=None, max_tokens=700, models=None):
    first = os.getenv("ANTHROPIC_MODEL")
    models = models or ([first] if first else []) + [m for m in ("claude-haiku-4-5", "claude-sonnet-4-6") if m != first]
    async with httpx.AsyncClient(timeout=40) as c:
        for i, model in enumerate(models):
            body = {"model": model, "max_tokens": max_tokens, "system": system, "messages": messages, "temperature": 0.2}
            if tools:
                body["tools"] = tools
            r = await c.post(CLAUDE, headers={"x-api-key": os.environ["ANTHROPIC_API_KEY"], "anthropic-version": "2023-06-01"}, json=body)
            if r.status_code in (404, 429, 500, 529) and i < len(models) - 1:
                print(f"claude {model}: HTTP {r.status_code}, modèle suivant", flush=True)
                continue
            r.raise_for_status()
            return r.json()


def _clean(t):
    return t.replace("**", "").replace("__", "").strip()


async def write(text):
    if mode() == "Claude":
        try:
            d = await claude(WRITE, [{"role": "user", "content": text}], max_tokens=400, models=["claude-haiku-4-5", "claude-sonnet-4-6"])
            return _clean("".join(b.get("text", "") for b in d["content"]))
        except Exception:
            return None
    if mode() != "Mistral":
        return await rewrite(text)
    try:
        d = await mistral([{"role": "system", "content": WRITE}, {"role": "user", "content": text}])
        return d["choices"][0]["message"]["content"].replace("**", "").replace("__", "").strip()
    except Exception:
        return None
