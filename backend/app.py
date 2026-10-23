import os

from fastapi import FastAPI
import json

from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import advisor, agents, feeds, horizon, portfolio

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


@app.get("/api/agents/state")
def agents_state():
    return agents.state()


@app.get("/api/agents/run")
async def agents_run():
    async def sse():
        async for ev in agents.run():
            yield "data: " + json.dumps(ev, ensure_ascii=False) + "\n\n"
    return StreamingResponse(sse(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/agents/decide/{aid}/{decision}")
def agents_decide(aid: str, decision: str):
    return agents.decide(aid, decision)


async def _pf_payload():
    payload = await feeds.collect()
    return payload, portfolio.build(payload, await portfolio.georisques())


@app.get("/api/advisor")
async def get_advisor():
    payload, pf = await _pf_payload()
    return advisor.build(payload, pf)


@app.get("/api/investigate")
async def get_investigate(id: str):
    payload, pf = await _pf_payload()
    return advisor.investigate(pf, advisor.build(payload, pf), id)


app.mount("/static", StaticFiles(directory=FRONT), name="static")


@app.get("/")
def index():
    return FileResponse(os.path.join(FRONT, "index.html"))
