import os

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import feeds, portfolio

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


app.mount("/static", StaticFiles(directory=FRONT), name="static")


@app.get("/")
def index():
    return FileResponse(os.path.join(FRONT, "index.html"))
