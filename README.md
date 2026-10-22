# WhatsApp Photo Saver

> **Easiest install (Windows):** open the [one-click setup page](https://tholsothea5-lang.github.io/whatsapp-photo-saver-devilproject/)
> and follow the 4 steps — no git or command line needed.

Automatically downloads photos from selected WhatsApp group chats via WhatsApp Web.

The app drives a headless Chrome instance with [`whatsapp-web.js`](https://github.com/pedroslopez/whatsapp-web.js),
links your account with a QR code, then watches the group chats you select and
saves every image (and optionally video) to disk.

## Features

- **QR login** – shown in the terminal *and* in the web UI (scan with
  *WhatsApp → Linked devices → Link a device*).
- **Session persistence** – the login is stored locally, so you only scan once.
- **Group selection** – pick exactly which groups to watch; the selection is
  saved to `config.json` and re-applied on the next start.
- **Chat search** – filter the group list by name as you type; ticks are kept
  while the list is filtered.
- **Recent-first ordering** – chats are sorted by their last activity, so the
  groups you actually use are at the top.
- **“Show downloaded photos” button** – appears as soon as a file lands and
  opens the newest download in Explorer/Finder.
- **Live monitoring** – new photos are downloaded as they arrive.
- **History back-fill** – scans the recent history of every selected group on
  startup (configurable depth).
- **Album support** – multi-photo "album" messages are expanded into their
  individual images, which `whatsapp-web.js` does not do on its own.
- **Deduplication** – every downloaded media id is recorded in `.state.json`,
  so restarting never downloads the same photo twice.
- **Web UI** – live activity feed, group picker and download list on
  `http://localhost:8000` (Python main app; the engine itself is engine-only
  on loopback port 3000).

## Requirements

- Node.js 18+ ([nodejs.org](https://nodejs.org)) — that's it. A dedicated
  Chromium is downloaded automatically on first install; you don't need
  Google Chrome or any other browser.

## Quick start (from the GitHub repo)

```bash
git clone https://github.com/tholsothea5-lang/whatsapp-photo-saver-devilproject.git
cd whatsapp-photo-saver-devilproject
```

**Windows:** double-click `start-web.bat` — it installs the engine and the
Python app on first run, then starts them both.

**macOS / Linux:** run `sh start.sh` (engine only; run `pip install -r requirements.txt && python app.py` in a venv for the Python layer).

Or the classic way (engine only):

```bash
npm install
npm start
```

Then open <http://localhost:8000> (the Python web app), scan the QR code,
tick the groups you want, pick a date range and press **Download range**
(the ticked chats are saved automatically).

> On PowerShell you may need `npm.cmd start` if script execution is disabled.

## Share with coworkers (no install for them)

1. Set a password in `config.json` (`"password": "our-team-code"`) — **do this
   first**, otherwise whoever gets the link can change the group selection.
2. Start everything (`start-web.bat`).
3. Run `share.bat` — it opens a free Cloudflare HTTPS tunnel to the Python web
   app (port 8000) on your PC and prints a `https://<something>.trycloudflare.com`
   link. Anyone can open that link, sign in with the password, and use the app
   in their browser. The link changes each time you run `share.bat`; close the
   window to stop sharing. No system-wide install: `cloudflared.exe` sits in
   `tools/`.

The photos themselves keep landing in the download folder on the machine
running the app — point `downloadDir` at a network/OneDrive folder if the
team should see the files directly.

## Configuration

`config.json` is optional – the app ships with sensible defaults (see
[`config.example.json`](config.example.json)) and creates/uses `config.json`
automatically when you save a group selection. All settings:

| Key | Default | Meaning |
| --- | --- | --- |
| `downloadDir` | `./downloads` | Where files are stored |
| `sessionDir` | `./.wwebjs_auth` | Stored WhatsApp session |
| `stateFile` | `./.state.json` | Downloaded-id index (dedupe) |
| `port` | `3000` | Engine port (internal, localhost only) |
| `password` | *(empty)* | Shared web-access password. When empty the web UI is unguarded — **set this before sharing** |
| `groupNames` | `[]` | Names of the groups to watch |
| `includeImages` | `true` | Download photos |
| `includeVideos` | `true` | Download videos |
| `includeDocuments` | `false` | Download documents |
| `includeStickers` | `false` | Download stickers |
| `backfillOnStart` | `true` | Scan history on startup |
| `backfillLimit` | `200` | Messages scanned per group |
| `liveMonitoring` | `true` | Download new media as it arrives |
| `saveCaptionToMetadata` | `true` | Write a `.json` sidecar with the caption |
| `includeOwnMessages` | `false` | Also download media you send yourself |

## Output layout

```
downloads/
  My Group/
    20240115_183045_Alice_1a2b3c.jpg        # the photo
    20240115_183045_Alice_1a2b3c.jpg.json   # caption / sender metadata
```

File names contain the timestamp, the sender, an album index (if any) and a
short hash that guarantees uniqueness.

## HTTP API

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/status` | Connection state, groups, stats |
| `GET` | `/api/groups` | Rescan and list group chats |
| `POST` | `/api/groups` | Save the selected groups; `backfill: false` skips the automatic history scan (`{"groups": ["Name"]}`) |
| `GET` | `/api/qr.png?data=` | Render the QR code as a PNG |
| `GET` | `/api/events` | Server-Sent Events stream of live activity |
| `GET` | `/api/files` | List everything downloaded so far |
| `POST` | `/api/reveal` | Open the latest download (or the downloads folder) in the OS file manager |

## Tests

```bash
npm test
```

The suite runs fully offline: it mocks the browser context with Node's `vm`
module to verify album resolution, media decryption, filename generation,
deduplication and the HTTP API.

## Project layout

```
app.py              main web app (Python/FastAPI): password gate + reverse proxy
index.js            engine entry point (starts the worker API + WhatsApp client)
start-web.bat       one-click launcher: engine + Python app
start.bat / start.sh engine-only easy-start scripts
setup.bat           downloads + installs everything, then calls start-web.bat
share.bat           publishes the web app to the internet (Cloudflare tunnel)
src/config.js       configuration loading
src/logger.js       small colored logger (CommonJS friendly)
src/media.js        album resolution + encrypted media download/decrypt
src/downloader.js   writes files, names them, handles dedupe
src/store.js        JSON index of already-downloaded media
src/monitor.js      WhatsApp client lifecycle, group discovery, back-fill
src/server.js       Express REST + SSE API (worker)
src/password.js     shared-password gate (worker side, mirrors app.py)
public/index.html   web UI
test/               offline test suite
```

## Notes & limitations

- Media that WhatsApp has already expired (or that was never downloaded to the
  device) cannot be fetched; the app logs a warning and moves on.
- `whatsapp-web.js` talks to WhatsApp's private Web API, so an occasional
  upstream change can break album resolution. The app falls back to
  downloading the album's parent item in that case.
- The first scan of a group is limited by `backfillLimit`; raise it to pull in
  more history (it takes longer).

## Disclaimer

This project is for personal use and automating access to *your own* account.
WhatsApp's Terms of Service prohibit unofficial automation – use it at your own
risk and consider the official WhatsApp Business API for production use.

## License

[MIT](LICENSE)
