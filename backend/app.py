import os
import time

import json

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, Response, JSONResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import brief, advisor, agents, auth, feeds, horizon, life, live, llm, portfolio, pro, score, team, pension, projects, transmission, budget

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONT = os.path.join(ROOT, "frontend")

app = FastAPI(title="Orbit")
auth.init()


def _ip(req: Request):
    return req.headers.get("cf-connecting-ip") or (req.client.host if req.client else "?")


def _me(req: Request):
    u = auth.session_user(req.cookies.get(auth.COOKIE))
    if not u:
        raise HTTPException(401, "non connecté")
    return u


def _with_cookie(res: dict, req: Request):
    if not res.get("ok"):
        return JSONResponse({k: v for k, v in res.items() if k != "cookie"}, status_code=400 if "error" in res else 200)
    r = JSONResponse({"ok": True, "user": res["user"]})
    secure = req.url.scheme == "https" or req.headers.get("x-forwarded-proto") == "https"
    r.set_cookie(auth.COOKIE, res["cookie"], max_age=auth.SESSION_AGE, httponly=True, samesite="lax", secure=secure)
    return r


@app.post("/api/auth/register")
async def register(req: Request):
    b = await req.json()
    if not auth.ip_allowed(_ip(req)):
        return JSONResponse({"error": "Trop de tentatives. Réessaie dans quelques minutes."}, status_code=429)
    uid, err = auth.register(b.get("email"), b.get("password"))
    if err:
        return JSONResponse({"error": err}, status_code=400)
    return _with_cookie(auth.login(b.get("email"), b.get("password"), _ip(req)), req)


@app.get("/api/auth/backup")
def auth_backup(req: Request):
    return {"backup": auth.backup(_me(req))}


@app.post("/api/auth/restore")
async def auth_restore(req: Request):
    b = await req.json()
    return {"status": auth.restore(b.get("backup"))}


@app.post("/api/auth/login")
async def login(req: Request):
    b = await req.json()
    return _with_cookie(auth.login(b.get("email"), b.get("password"), _ip(req)), req)


@app.post("/api/auth/2fa")
async def login_2fa(req: Request):
    b = await req.json()
    return _with_cookie(auth.second_factor(b.get("ticket"), b.get("code"), _ip(req)), req)


@app.post("/api/auth/logout")
def logout(req: Request):
    r = JSONResponse({"ok": True})
    r.delete_cookie(auth.COOKIE)
    return r


@app.get("/api/me")
def me(req: Request):
    return auth.public(_me(req))


@app.post("/api/security/totp/setup")
def totp_setup(req: Request):
    return auth.totp_setup(_me(req))


@app.post("/api/security/totp/enable")
async def totp_enable(req: Request):
    return _with_cookie(auth.totp_enable(_me(req), (await req.json()).get("code")), req)


@app.post("/api/security/totp/disable")
async def totp_disable(req: Request):
    res = auth.totp_disable(_me(req), (await req.json()).get("code"))
    return JSONResponse(res, status_code=400 if "error" in res else 200)


@app.post("/api/security/logout-all")
def logout_all(req: Request):
    auth.logout_all(_me(req))
    return logout(req)


@app.get("/api/profile")
def get_profile(req: Request):
    return auth.get_profile(_me(req))


@app.put("/api/profile")
async def put_profile(req: Request):
    u = _me(req)
    p = life.sanitize(await req.json(), auth.get_profile(u))
    auth.save_profile(u, p)
    return p


@app.post("/api/compare")
async def compare(req: Request):
    u = _me(req)
    return life.compare(auth.get_profile(u), (await req.json()).get("variants") or [])


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


@app.post("/api/agents/live")
async def live_start(req: Request):
    u = _me(req)
    return {"run": live.start(u["id"], life.sanitize(auth.get_profile(u), life.BLANK))}


@app.post("/api/agents/decide")
async def agents_decide(req: Request):
    u, b = _me(req), await req.json()
    p = auth.get_profile(u)
    cur = life.sanitize(p, life.BLANK)
    entry = {"t": int(time.time()), "title": str(b.get("title", ""))[:80], "ok": bool(b.get("ok")), "gain": 0}
    if entry["ok"]:
        nxt = life.merge(cur, b.get("set") or {})
        g = cur.get("goal_month") or 0
        entry["gain"] = round(team._stats(nxt, g)["net"] - team._stats(cur, g)["net"])
        entry["score"] = [score.compute(cur)["score"], score.compute(nxt)["score"]]
        p = dict(p, **nxt)
    p["journal"] = (p.get("journal") or [])[-49:] + [entry]
    auth.save_profile(u, p)
    return {"entry": entry, "journal": p["journal"]}


@app.get("/api/advisor/brief")
def advisor_brief(req: Request):
    u = _me(req)
    p = auth.get_profile(u)
    pdf = brief.build(life.sanitize(p, life.BLANK), p.get("journal") or [], team._stats)
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": 'inline; filename="orbit-rendez-vous-banque.pdf"'})


@app.get("/api/pension")
def api_pension(req: Request, start: int = 22, growth: float = 1.0, retire: int = 0):
    p = auth.get_profile(_me(req))
    r = life.project(life.merge(p, {"retire_age": retire}) if retire else p)
    inc = r["incomes"][len(r["incomes"]) // 2]
    return pension.estimate(p, max(14, min(40, start)), max(0, min(3, growth)) / 100, retire or None, inc)


@app.post("/api/projects/preview")
async def api_projects(req: Request):
    p = auth.get_profile(_me(req))
    return projects.preview(p, (await req.json()).get("projects") or [])


@app.get("/api/transmission")
def api_transmission(req: Request, children: int = -1, age: int = 85, av: float = 0, donation: float = 0):
    p = auth.get_profile(_me(req))
    n = p.get("children", 2) if children < 0 else max(0, min(6, children))
    return transmission.estimate(p, life.project(p), n, max(60, min(100, age)), max(0, min(100, av)) / 100, max(0, min(131865, donation)))


@app.post("/api/budget")
async def api_budget(req: Request):
    p = auth.get_profile(_me(req))
    try:
        res = budget.analyze((await req.json()).get("csv") or "", p["savings_month"])
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    r0, r1 = life.project(p), life.project(life.merge(p, {"savings_month": p["savings_month"] + 100}))
    res["per_eur"] = (r1["scenarios"]["mid"]["rows"][r1["ref"]]["net"] - r0["scenarios"]["mid"]["rows"][r0["ref"]]["net"]) / 100
    res["retire_age"] = p["retire_age"]
    return res


@app.get("/api/score")
def get_score(req: Request):
    return score.compute(life.sanitize(auth.get_profile(_me(req)), life.BLANK))


def _demo_profile():
    return auth.get_profile(auth._user(email=auth.DEMO_EMAIL))


@app.get("/api/pro/clients")
def pro_clients(req: Request):
    _me(req)
    return pro.portfolio(_demo_profile())


@app.get("/api/pro/brief/{cid}")
def pro_brief(cid: str, req: Request):
    _me(req)
    if cid != "boris" and cid not in pro.CLIENTS:
        raise HTTPException(404, "client inconnu")
    p, j = pro.profile_of(cid, _demo_profile())
    return Response(brief.build(p, j, team._stats), media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="orbit-{cid}.pdf"'})


@app.get("/api/llm")
def llm_mode():
    return {"mode": llm.mode()}


@app.post("/api/advisor/ask")
async def advisor_ask(req: Request):
    u, b = _me(req), await req.json()
    p = life.sanitize(auth.get_profile(u), life.BLANK)
    if llm.mode() == "règles":
        r = team.local(p, str(b.get("q", ""))[:600])
        return dict(r, checked=True, ms=0, model="règles" if not b.get("local") else "local")
    try:
        return await team.ask(life.sanitize(auth.get_profile(u), life.BLANK), str(b.get("q", "")), b.get("history"))
    except Exception as e:  # noqa: BLE001
        print(f"conseiller {llm.mode()} : {type(e).__name__} {e}", flush=True)
        return dict(team.local(p, str(b.get("q", ""))[:600]), checked=True, ms=0, model="règles")


@app.get("/api/agents/live/{rid}")
def live_poll(rid: str, req: Request, since: int = 0):
    res = live.poll(_me(req)["id"], rid, max(0, since))
    if res is None:
        raise HTTPException(404, "analyse inconnue")
    return res


@app.get("/api/life")
def get_life(req: Request):
    p = life.sanitize(auth.get_profile(_me(req)), life.BLANK)
    r = life.project(p)
    r["goal"] = life.goal(p, r)
    r["score"] = score.compute(p, r)
    return r


@app.post("/api/life/simulate")
async def simulate_life(req: Request):
    body = await req.json()
    p = life.merge(life.sanitize(auth.get_profile(_me(req)), life.BLANK), body.get("set") or {})
    r = life.project(p)
    r["goal"] = life.goal(p, r)
    r["score"] = score.compute(p, r)
    return r


@app.get("/api/today")
async def today(req: Request):
    p = life.sanitize(auth.get_profile(_me(req)), life.BLANK)
    d = await feeds.collect(["markets", "rates"])
    mk = {m["symbol"]: m for m in (d["markets"].get("data") or [])}
    rt = {r["id"]: r for r in (d["rates"].get("data") or [])}
    fr = lambda v: f"{v:+.2f} %".replace(".", ",")  # noqa: E731
    items = []
    cac, spx = mk.get("^FCHI"), mk.get("^GSPC")
    if cac and spx:
        ch = 0.6 * spx["change"] + 0.4 * cac["change"]
        items.append({"label": "Bourse", "value": f"CAC 40 {fr(cac['change'])}", "src": "Yahoo Finance", "effect": p["invested"] * p["equity_share"] / 100 * ch / 100, "note": "sur tes placements aujourd'hui"})
    if "dfr" in rt:
        items.append({"label": "Taux BCE", "value": f"{rt['dfr']['value']:.2f} %".replace(".", ","), "src": f"BCE · {rt['dfr']['date']}", "note": "guide le Livret A et les taux de crédit"})
    if "infl_fr" in rt:
        items.append({"label": "Inflation", "value": f"{rt['infl_fr']['value']:.1f} %".replace(".", ","), "src": f"Eurostat · {rt['infl_fr']['date']}", "effect": -p["cash"] * rt["infl_fr"]["value"] / 100, "note": "de pouvoir d'achat par an sur tes livrets"})
    return {"items": items, "points": [{"lat": m["lat"], "lng": m["lng"], "chg": m["change"], "name": m["name"]} for m in mk.values() if m.get("lat") is not None]}


@app.get("/api/advisor")
async def get_advisor():
    payload, pf = await _pf_payload()
    return advisor.build(payload, pf)


@app.get("/api/investigate")
async def get_investigate(id: str):
    payload, pf = await _pf_payload()
    return advisor.investigate(pf, advisor.build(payload, pf), id)


class Static(StaticFiles):
    async def get_response(self, path, scope):
        r = await super().get_response(path, scope)
        r.headers["Cache-Control"] = "no-cache"
        return r


app.mount("/static", Static(directory=FRONT), name="static")


@app.get("/")
def index(req: Request):
    if not auth.session_user(req.cookies.get(auth.COOKIE)):
        return RedirectResponse("/login")
    return FileResponse(os.path.join(FRONT, "index.html"), headers={"Cache-Control": "no-store"})


@app.get("/login")
def login_page():
    return FileResponse(os.path.join(FRONT, "login.html"))


@app.get("/pro")
def pro_page(req: Request):
    if not auth.session_user(req.cookies.get(auth.COOKIE)):
        return RedirectResponse("/login?next=/pro")
    return FileResponse(os.path.join(FRONT, "conseiller.html"), headers={"Cache-Control": "no-store"})
