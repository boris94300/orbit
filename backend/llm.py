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
    if os.getenv("MISTRAL_API_KEY"):
        return "Mistral"
    if os.getenv("ANTHROPIC_API_KEY"):
        return "Claude"
    if os.getenv("OLLAMA_MODEL"):
        return "Ollama · " + os.getenv("OLLAMA_MODEL")
    return "règles"


def numbers(s):
    return {re.sub(r"[\s\u202f\u00a0]", "", n).replace(",", ".") for n in re.findall(r"\d[\d\s\u202f\u00a0.,]*\d|\d", s)}


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
                                 json={"model": os.getenv("ANTHROPIC_MODEL", "claude-3-5-haiku-latest"), "max_tokens": 400,
                                       "system": PROMPT, "messages": msgs[1:]})
                out = r.json()["content"][0]["text"]
            else:
                r = await c.post(os.getenv("OLLAMA_HOST", "http://localhost:11434") + "/api/chat",
                                 json={"model": os.environ["OLLAMA_MODEL"], "messages": msgs, "stream": False})
                out = r.json()["message"]["content"]
        return out.strip()
    except Exception:
        return None
