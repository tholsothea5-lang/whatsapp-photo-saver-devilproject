# WhatsApp Photo Saver

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
  `http://localhost:3000`.

## Requirements

- Node.js 18+ ([nodejs.org](https://nodejs.org)) — that's it. A dedicated
  Chromium is downloaded automatically on first install; you don't need
  Google Chrome or any other browser.

## Quick start (from the GitHub repo)

```bash
git clone https://github.com/tholsothea5/whatsapp-photo-saver.git
cd whatsapp-photo-saver
```

**Windows:** double-click `start.bat` — it installs everything on first
run, then starts the app.

**macOS / Linux:** run `sh start.sh`.

Or the classic way:

```bash
npm install
npm start
```

Then open <http://localhost:3000>, scan the QR code, tick the groups you
want, pick a date range and press **Download range** (the ticked chats are
saved automatically).

> On PowerShell you may need `npm.cmd start` if script execution is disabled.

## Configuration

`config.json` is optional – the app ships with sensible defaults (see
[`config.example.json`](config.example.json)) and creates/uses `config.json`
automatically when you save a group selection. All settings:

| Key | Default | Meaning |
| --- | --- | --- |
| `downloadDir` | `./downloads` | Where files are stored |
| `sessionDir` | `./.wwebjs_auth` | Stored WhatsApp session |
| `stateFile` | `./.state.json` | Downloaded-id index (dedupe) |
| `port` | `3000` | Web UI port |
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
index.js            entry point (starts the web server + WhatsApp client)
start.bat / start.sh easy-start scripts (install on first run, then start)
src/config.js       configuration loading
src/logger.js       small colored logger (CommonJS friendly)
src/media.js        album resolution + encrypted media download/decrypt
src/downloader.js   writes files, names them, handles dedupe
src/store.js        JSON index of already-downloaded media
src/monitor.js      WhatsApp client lifecycle, group discovery, back-fill
src/server.js       Express REST + SSE API
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
