"""
WhatsApp Photo Saver - main web app (Python / FastAPI).

This is the ONLY internet-facing component. It sits in front of the local
WhatsApp engine (Node worker on http://127.0.0.1:3000) and:

  * enforces the shared access password taken from config.json ("password")
  * proxies every page, API call and live event stream to the engine
  * shows a friendly message when the engine is not running

Run:  python app.py          (starts on http://0.0.0.0:8000)
"""

from __future__ import annotations

import hashlib
import json
import os
import pathlib
import sys

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.responses import HTMLResponse, RedirectResponse, StreamingResponse

ROOT = pathlib.Path(__file__).resolve().parent
ENGINE_HOST = os.environ.get("ENGINE_BASE_URL", "http://127.0.0.1:3000")
PUBLIC_PORT = int(os.environ.get("PORT", "8000"))
COOKIE_NAME = "wps_auth"


def load_config() -> dict:
    path = ROOT / "config.json"
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001
            print(f"[python] WARNING: config.json unreadable ({exc})", file=sys.stderr)
    return {}


CONFIG = load_config()
PASSWORD: str = str(CONFIG.get("password") or "").strip()
AUTH_TOKEN = hashlib.sha256(f"wps-auth:{PASSWORD}".encode()).hexdigest() if PASSWORD else None

ERROR_PAGE = """<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Engine not running</title>
<style>
  body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0f10;
       color:#e8f0f0;font-family:'Segoe UI',system-ui,Arial,sans-serif;text-align:center}
  .card{background:#131a1c;border:1px solid #243034;border-radius:14px;padding:36px;max-width:30rem}
  h1{color:#ff7b7b;font-size:1.3rem;margin-bottom:10px}
  p{color:#9ab3b3}
  code{background:#182124;border:1px solid #243034;padding:2px 7px;border-radius:6px}
</style></head><body>
<div class="card"><h1>Engine not running</h1>
<p>The WhatsApp engine on this computer (Node worker on port 3000) is not
reached. Start it first:</p>
<p><code>start-web.bat</code></p></div></body></html>"""

LOGIN_PAGE = """<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>WhatsApp Photo Saver — sign in</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{min-height:100vh;display:flex;align-items:center;justify-content:center;
       background:#0b0f10;color:#e8f0f0;font-family:'Segoe UI',system-ui,Arial,sans-serif}
  .card{background:#131a1c;border:1px solid #243034;border-radius:14px;padding:32px;width:min(340px,90vw)}
  h1{font-size:1.15rem;color:#fff;margin-bottom:6px}
  .saver{color:#28d86b}
  p{color:#9ab3b3;font-size:.9rem;margin-bottom:18px}
  input{width:100%;padding:11px 13px;border-radius:9px;border:1px solid #243034;
        background:#182124;color:#e8f0f0;font-size:1rem;margin-bottom:14px}
  input:focus{outline:none;border-color:#28d86b}
  button{width:100%;padding:11px;border:none;border-radius:9px;background:#28d86b;
         color:#04170b;font-weight:700;font-size:1rem;cursor:pointer}
  button:hover{background:#3ae07f}
  .err{color:#ff7b7b;font-size:.85rem;margin-bottom:12px;display:none}
  .err.show{display:block}
</style></head><body>
  <form class="card" method="post" action="/login">
    <h1><span>WhatsApp</span> <span class="saver">Photo Saver</span></h1>
    <p>Enter the shared access password.</p>
    <div class="err" id="err">Wrong password — try again.</div>
    <input type="password" name="password" autofocus required>
    <button type="submit">Sign in</button>
  </form>
  <script>
    if (new URLSearchParams(location.search).get('e') === '1') {
      document.getElementById('err').className = 'err show';
    }
  </script>
</body></html>"""


app = FastAPI(title="WhatsApp Photo Saver")


@app.middleware("http")
async def password_gate(request: Request, call_next):
    if not AUTH_TOKEN:
        return await call_next(request)

    if request.url.path == "/login":
        if request.method == "GET":
            return HTMLResponse(LOGIN_PAGE)
        if request.method == "POST":
            form = await request.form()
            submitted = str(form.get("password") or "")
            if hashlib.sha256(f"wps-auth:{submitted}".encode()).hexdigest() == AUTH_TOKEN:
                response = RedirectResponse("/", status_code=302)
                response.set_cookie(
                    COOKIE_NAME, AUTH_TOKEN, max_age=60 * 60 * 24 * 30,
                    httponly=True, samesite="lax",
                )
                return response
            return HTMLResponse(
                LOGIN_PAGE.replace("<div class=\"err\"", "<div class=\"err show\"", 1),
                status_code=401,
            )

    cookie = request.cookies.get(COOKIE_NAME)
    if cookie == AUTH_TOKEN:
        return await call_next(request)

    if request.url.path.startswith("/api/"):
        return Response('{"ok":false,"error":"Password required"}',
                        status_code=401, media_type="application/json")
    return RedirectResponse("/login", status_code=302)


@app.api_route("/{full_path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"])
async def proxy(request: Request, full_path: str) -> Response:
    """Pass everything through to the local engine, including live SSE streams."""
    target_url = f"{ENGINE_HOST}/{full_path}"
    if request.url.query:
        target_url += f"?{request.url.query}"

    headers = {
        k: v for k, v in request.headers.items()
        if k.lower() not in {"host", "connection", "cookie", "transfer-encoding", "accept-encoding"}
    }
    # The engine has its own identical gate (used only on the local network);
    # log the proxy session in so the proxied calls never hit a redirect.
    if AUTH_TOKEN:
        headers["cookie"] = f"wps_auth={AUTH_TOKEN}"

    body = await request.body() if request.method in {"POST", "PUT", "PATCH"} else None

    try:
        client = httpx.AsyncClient(base_url=ENGINE_HOST, timeout=httpx.Timeout(600.0))
        engine_req = client.build_request(
            request.method, target_url,
            headers=headers, content=body,
        )
        engine_response = await client.send(engine_req, stream=True)
    except httpx.HTTPError:
        if request.method == "GET" and not request.url.path.startswith("/api/"):
            return HTMLResponse(ERROR_PAGE, status_code=503)
        return Response('{"ok":false,"error":"Engine unreachable"}',
                        status_code=502, media_type="application/json")

    media_type = engine_response.headers.get("content-type", "application/octet-stream")

    if media_type.startswith("text/event-stream"):
        async def sse_stream():
            try:
                async for chunk in engine_response.aiter_bytes():
                    yield chunk
            finally:
                await engine_response.aclose()
                await client.aclose()
        return StreamingResponse(
            sse_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    response_headers = {}
    for h in ("set-cookie",):
        if h in engine_response.headers:
            response_headers[h] = engine_response.headers[h]

    try:
        payload = await engine_response.aread()
    finally:
        await engine_response.aclose()
        await client.aclose()

    return Response(payload, status_code=engine_response.status_code,
                    media_type=media_type, headers=response_headers)


if __name__ == "__main__":
    import uvicorn

    if AUTH_TOKEN:
        print("[python] Password gate is active (password from config.json).")
    else:
        print("[python] WARNING: no password in config.json - access is OPEN. "
              "Set \"password\" in config.json before sharing.", file=sys.stderr)
    print(f"[python] http://localhost:{PUBLIC_PORT}  ->  engine {ENGINE_HOST}")
    uvicorn.run(app, host="0.0.0.0", port=PUBLIC_PORT, log_level="warning")
