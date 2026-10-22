# HANDOVER — state as of 2026-10-22 (release: Python main web app)

## What exists now (exact repo state at commit `6f91de1`)

Repo: https://github.com/tholsothea5-lang/whatsapp-photo-saver-devilproject (public, MIT)
Pages: https://tholsothea5-lang.github.io/whatsapp-photo-saver-devilproject/ (LIVE, /docs folder, main branch)

### Architecture (two layers)

1. **Python main web app — `app.py`** (FastAPI, listens `0.0.0.0:8000`)
   - Password gate: reads `"password"` from `config.json` at startup; hash
     `sha256("wps-auth:" + password)`; cookie `wps_auth` (HttpOnly, sameSite=lax, 30 days).
   - Full reverse proxy to the Node engine at `http://127.0.0.1:3000`
     (all routes + SSE `/api/events` streaming passthrough).
   - `/login` (GET/POST) implemented in Python when password set.
   - Engine down → friendly 503 page ("Engine not running").
2. **Node WhatsApp engine — `index.js` + `src/*.js`** (loopback-only since this release)
   - `src/config.js` default `listenHost: '127.0.0.1'` (LAN/port 3000 is NOT reachable externally).
   - Has its own identical password gate (`src/password.js`) — Python proxy
     logs itself in by injecting the same cookie value.
   - Public UI `public/index.html`, patch via `scripts/patch-whatsapp-web.js` (postinstall).

### Launch scripts (Windows, on Tyr's machine)

- `start-web.bat` — preferred launcher: checks Node, checks/creates Python env
  (portable via `tools/uv.exe`, no admin; falls back to system `python`/`py` if
  `.venv` empty), starts engine minimized + Python app, opens `localhost:8000`.
- `share.bat` — checks `127.0.0.1:8000` is serving `/login`, downloads
  `tools/cloudflared.exe` if missing, opens quick tunnel → prints
  `https://<random>.trycloudflare.com` link (rotates each run).
- `setup.bat` (downloaded from the Pages page) — downloads repo zip, npm install,
  then hands over to `start-web.bat`.
- `start.bat` / `start.sh` — engine-only. Tests: `npm.cmd test` (PowerShell blocks
  plain `npm`; use `npm.cmd`) — currently **24 + 14 = 38 checks pass**.

### Secrets & config (verified)

- `config.json` (LOCAL ONLY, gitignored): includes `"password": "pickastrong@123"`,
  downloadDir `D:\New folder`, real group names. NEVER commit/paste into chat.
- Godot rules: `.gitignore` covers config.json, .state.json, .wwebjs_auth,
  downloads/, personal photo dirs, .venv/, tools/.
- Nothing secret is committed. Password provided by user lives only in local
  `config.json`.

### Live verification done this session

- Engine restarted with new build (loopback + password): OK.
- End-to-end through Python: no-cookie → 302/401; wrong pw → 401; correct pw →
  cookie; `/api/status` via proxy → 200 ready:true (real WhatsApp session
  restored); UI via proxy → 200; SSE passthrough → 200 text/event-stream.
- Bug fixes included in release: call_next(request) middleware bug,
  python-multipart dep, form-body parser mis-configuration (Node gate),
  smoke-test config pollution (test section now forces password '').

## Runtime state on Tyr's PC right now

- Python web app RUNNING in background shell (`sh_1658b37a9001DHFR1YHLKw87BU`)
  on port 8000; engine RUNNING in background shell `sh_1658a0bc6001XBL5YVy5yE1jAC`
  on port 3000 (both started by this session via `npm.cmd start` /
  `.venv\Scripts\python.exe app.py`).
- Portable Python: `.venv/` (CPython 3.12.15) + `tools/uv.exe` +
  `tools/cloudflared.exe` may/may not exist yet (share.bat fetches on demand).
- Old consumer approach: `python`/`py` on PATH are broken (leftover Python314
  registration); that's why uv-portable is used.

## How to give the coworker access (3-step routine for Tyr)

1. Ensure `start-web.bat` window is open (app at 8000).
2. Double-click `share.bat` → wait for the printed trycloudflare URL.
3. Send link + password `pickastrong@123` to coworker. Coworker clicks link,
   signs in once, uses the same web UI on the web. Photos keep saving into
   `D:\New folder`. Link valid while share.bat window stays open.

## Known limitations / tomorrow-items

- trycloudflare URL rotates on every share.bat restart (paid/named tunnel or
  localhost.run fixed subdomain could stabilize; needs a domain/account).
- The engine serves 2 personal photo folders internally (`/close-photos/...`
  static dirs from `src/server.js`) — now behind password; consider removing
  from a public release if not wanted.
- `npm test` currently requires the gate-disabled test config trick (done).
- If extended: consider core auth rate limiting (currently none) and a
  `POST /logout` for revocation beyond cookie expiry.

## Rollback path

Engine-only mode still fully works: `start.bat` (or `npm start`) + open
localhost:3000 — engine previously listened on all interfaces; since
`6f91de1` engine defaults to loopback; to intentionally re-expose (LAN), set
`"listenHost": "0.0.0.0"` in config.json. Pages/installs unchanged.
