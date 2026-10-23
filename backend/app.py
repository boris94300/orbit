import os

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import feeds, horizon, portfolio

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONT = os.path.join(ROOT, "frontend")

app = FastAPI(title="Orbit")


@app.get("/api/feeds")
async def all_feeds():
    payload = await feeds.collect()
    feeds.save_snapshot(payload)
    return payload


@app.get("/api/feeds/{name}")
async def one_feed(name: str):
    if name not in feeds.BY_NAME:
        return {"error": "flux inconnu"}
    return (await feeds.collect([name]))[name]


@app.get("/api/portfolio")
async def get_portfolio():
    payload = await feeds.collect()
    return portfolio.build(payload, await portfolio.georisques())


@app.get("/api/horizon")
async def get_horizon(savings: float = 650, retire_age: int = 60, equity: int = 55, target: float = 420000):
    payload = await feeds.collect()
    pf = portfolio.build(payload, await portfolio.georisques())
    savings = min(max(savings, 0), 5000)
    retire_age = min(max(retire_age, pf["client"]["age"] + 1), 70)
    equity = min(max(equity, 0), 100)
    return horizon.project(pf, (payload.get("rates") or {}).get("data") or [], savings, retire_age, equity, target)


app.mount("/static", StaticFiles(directory=FRONT), name="static")


@app.get("/")
def index():
    return FileResponse(os.path.join(FRONT, "index.html"))
