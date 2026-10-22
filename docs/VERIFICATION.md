# WhatsApp Photo Saver — Verification

## Symptom

The UI loads, the QR links successfully, the log says `WhatsApp Web is ready`,
then `Could not list chats: r` and **No group chats found.** Nothing downloads.

## Actual root causes (found by attaching to the live session, 2026-10-23)

1. **`client.getChats()` never resolves.** whatsapp-web.js maps *every* chat
   through `WWebJS.getChatModel()`, which awaits `groupMetadata.update()` per
   group. With 178 chats this exceeds Puppeteer's protocol timeout (180 s); the
   failure surfaces as `Runtime.callFunctionOn timed out` (earlier runs showed
   the minified `r`). The burst of parallel metadata updates also reloads the
   page (`Execution context was destroyed`).
2. **`ready` never fires with a restored session.** The library emits `READY`
   only from `WAWebSocketModel.Socket.on('change:hasSynced')`. On a restored
   session the socket is already synced before that listener is attached, so
   the app sits at "not connected" even though the page is fully loaded.
3. **Media resolution used the wrong API.** `downloadAndMaybeDecrypt({ type:
   'image' })` throws `Unexpected mimetype application/octet-stream for media
   type image` before fetching anything. Current WhatsApp Web keeps the
   decrypted bytes in an in-memory blob after `msg.downloadMedia()`.

## The `$1` patch — what it does and does not fix

Live inspection showed group chat ids still expose `_serialized`
(`120363...@g.us`) and `chat.id.$1` is a **function**, so the `$1` theory did
**not** explain the `getChats()` failure.

`Chat.lastReceivedKey` *does* only expose `$1`, and it is a LID key string
(`false_<chat>_<hash>_<user>@lid`), so patch hunks 3–5 are still useful for the
`getChatModel` / `sendMessage` paths. The patch is kept.

Diff of the installed file against a pristine `whatsapp-web.js@1.34.7` tarball:
exactly the 7 documented hunks (21 insertions / 6 deletions), no other edits.
The script is now idempotent, so `postinstall` can run on every `npm install`.

## Fixes (application code)

| File | Change |
|---|---|
| `src/monitor.js` | `refreshGroups()` enumerates groups synchronously from `WAWebCollections.Chat` instead of calling `client.getChats()`. |
| `src/monitor.js` | `markReady()` runs once; `watchForMissedReady()` polls `Socket.hasSynced` + `#pane-side` and finishes init if the event was missed. |
| `src/media.js` | `fetchMediaData()` resolves with `msg.downloadMedia()`, then reads `InMemoryMediaBlobCache` / `mediaObject.mediaBlob`; `downloadAndMaybeDecrypt` is only a fallback and now receives `mimetype`. `REUPLOADING` / `ERROR_*` return `null`. |
| `scripts/patch-whatsapp-web.js` | Idempotent: skips when every hunk is present, aborts clearly on a partial patch. |
| `package.json` | `whatsapp-web.js` pinned to `1.34.7` (the patch is version-specific). |
| `public/index.html` | Participant count hidden when unknown instead of showing `(0)`. |

## Verified live (2026-10-23)

- `ready` ~1 s after start, **129 group chats** listed.
- History paging: **101 messages / 31 media** in one group.
- Fresh image: **306,758 bytes**, JPEG magic `ff d8 ff`, sidecar metadata and
  dedupe entry written through the real `Downloader`.
- Expired media (`REUPLOADING` / `ERROR_MISSING`) skipped and logged as
  unavailable rather than crashing.

## Known limits

- Media WhatsApp has expired cannot be fetched. Old/dormant groups will log
  warnings; re-sending or forwarding the photo does not make the original
  downloadable.
- Participant counts are 0/unavailable until group metadata is loaded; the UI
  now hides the count instead of printing `(0)`.
- The web UI listens on all interfaces (`::3000`). Bind `127.0.0.1` if the
  machine is on an untrusted network.

## Re-verify

```bash
npm test                              # 37 offline checks
node scripts/patch-whatsapp-web.js    # prints [skip] when already patched
npm start                             # UI at http://localhost:3000
```
