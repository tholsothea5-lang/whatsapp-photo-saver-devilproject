'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const express = require('express');
const QRCode = require('qrcode');
const { logger } = require('./logger');
const { createPasswordGate } = require('./password');

/**
 * Open a file or folder in the OS file manager, refusing anything outside the
 * download root.
 */
function revealInFileManager(target, rootDir) {
    const abs = path.resolve(target);
    if (rootDir) {
        const root = path.resolve(rootDir);
        if (abs !== root && !abs.startsWith(root + path.sep)) {
            throw new Error('Refusing to open a path outside the download directory');
        }
    }

    let isFile = false;
    try {
        isFile = fs.statSync(abs).isFile();
    } catch (err) {
        isFile = false;
    }

    let cmd;
    let args;
    if (process.platform === 'win32') {
        cmd = 'explorer.exe';
        args = isFile ? [`/select,${abs}`] : [abs];
    } else if (process.platform === 'darwin') {
        cmd = 'open';
        args = isFile ? ['-R', abs] : [abs];
    } else {
        cmd = 'xdg-open';
        args = [isFile ? path.dirname(abs) : abs];
    }

    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', (err) => logger.warn(`Could not open ${abs}: ${err.message}`));
    child.unref();
}

/**
 * Small Express server exposing:
 *  GET  /api/status        -> connection state + stats
 *  GET  /api/groups        -> list of group chats
 *  POST /api/groups        -> save selected group names
 *  POST /api/refresh       -> re-scan chats
 *  POST /api/reveal        -> open the latest download in the file manager
 *  GET  /api/qr.png?data=  -> QR code as PNG (for the web UI)
 *  GET  /api/events        -> Server-Sent Events stream
 *  GET  /api/files         -> list downloaded files
 */
function createServer(monitor) {
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Password gate (active only when config.password is set) must come before
    // every route and static folder - including the personal photo dirs below.
    const passwordGate = createPasswordGate(monitor.config);
    app.use(passwordGate);

    app.use(express.static(path.join(__dirname, '..', 'public')));
    app.use(
        '/close-photos/dont',
        express.static(path.join(__dirname, '..', 'dont want to close photos')),
    );
    app.use(
        '/close-photos/closing',
        express.static(path.join(__dirname, '..', 'closing photos')),
    );

    const CLOSE_PHOTO_DIRS = {
        dont: path.join(__dirname, '..', 'dont want to close photos'),
        closing: path.join(__dirname, '..', 'closing photos'),
    };
    const IMAGE_FILE = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;

    app.get('/api/close-photos', (req, res) => {
        const kind = req.query.kind === 'closing' ? 'closing' : 'dont';
        let files = [];
        try {
            files = fs
                .readdirSync(CLOSE_PHOTO_DIRS[kind])
                .filter((f) => IMAGE_FILE.test(f))
                .sort();
        } catch (err) {
            files = [];
        }
        res.json({
            kind,
            photos: files.map(
                (f) => `/close-photos/${kind}/${encodeURIComponent(f)}`,
            ),
        });
    });

    app.post('/api/shutdown', (req, res) => {
        res.json({ ok: true });
        const stop = async () => {
            try {
                await monitor.stop();
            } catch (err) {
                /* client already gone */
            }
            process.exit(0);
        };
        setTimeout(stop, 300);
        setTimeout(() => process.exit(0), 5000);
    });

    let lastQr = null;
    let lastDownload = null;

    monitor.subscribe((event) => {
        if (event.type === 'qr') lastQr = event.qr;
        // Once linked, a QR is stale: never serve it alongside ready=true.
        if (event.type === 'ready') lastQr = null;
        if (event.type === 'downloaded') {
            lastDownload = {
                file: event.file,
                group: event.group,
                at: event.at,
            };
        }
    });

    app.get('/api/status', (req, res) => {
        res.json({
            ready: monitor.ready,
            qr: lastQr,
            groups: monitor.groupCache,
            selected: [...monitor.selectedGroups],
            stats: monitor.downloader ? monitor.downloader.stats : null,
            downloadDir: monitor.config.downloadDir,
            lastDownload,
        });
    });

    app.post('/api/reveal', (req, res) => {
        const body = req.body || {};
        const requested = typeof body.path === 'string' ? body.path.trim() : '';
        const root = monitor.config.downloadDir;
        let target = root;
        let boundary = root;

        if (requested) {
            // Open exactly the folder the user typed in "Download folder".
            target = path.resolve(monitor.config.rootDir, requested);
            try {
                if (!fs.statSync(target).isDirectory()) {
                    return res.status(400).json({ ok: false, error: 'Not a folder' });
                }
            } catch (err) {
                return res.status(400).json({
                    ok: false,
                    error: 'Folder does not exist',
                });
            }
            boundary = null;
        } else if (lastDownload && lastDownload.file) {
            const candidate = path.join(root, lastDownload.file);
            if (fs.existsSync(candidate)) target = candidate;
        }

        try {
            revealInFileManager(target, boundary);
            res.json({ ok: true, path: target });
        } catch (err) {
            res.status(400).json({ ok: false, error: err.message });
        }
    });

    app.post('/api/logout', async (req, res) => {
        try {
            lastQr = null;
            await monitor.logout();
            res.json({ ok: true });
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    app.post('/api/settings', (req, res) => {
        const body = req.body || {};
        try {
            const downloadDir = monitor.setDownloadDir(body.downloadDir);
            res.json({ ok: true, downloadDir });
        } catch (err) {
            res.status(400).json({ ok: false, error: err.message });
        }
    });

    app.get('/api/profile', async (req, res) => {
        try {
            res.json({ ready: monitor.ready, profile: await monitor.getProfile() });
        } catch (err) {
            res.json({ ready: monitor.ready, profile: null, error: err.message });
        }
    });

    app.post('/api/download-range', async (req, res) => {
        const body = req.body || {};
        try {
            const result = await monitor.downloadRange({
                start: body.start,
                end: body.end,
                groups: body.groups,
                sender: body.sender,
                skipExisting: body.skipExisting,
            });
            res.json({ ok: true, ...result });
        } catch (err) {
            res.status(400).json({ ok: false, error: err.message });
        }
    });

    app.get('/api/groups', async (req, res) => {
        const groups = await monitor.refreshGroups();
        res.json({ groups });
    });

    app.post('/api/groups', async (req, res) => {
        const body = req.body || {};
        const names = Array.isArray(body.groups) ? body.groups : [];
        await monitor.saveSelection(names, { backfill: body.backfill !== false });
        res.json({ ok: true, selected: [...monitor.selectedGroups] });
    });

    app.post('/api/refresh', async (req, res) => {
        const groups = await monitor.refreshGroups();
        res.json({ ok: true, groups });
    });

    app.get('/api/qr.png', async (req, res) => {
        const data = req.query.data || lastQr;
        if (!data) {
            res.status(404).send('No QR code available');
            return;
        }
        try {
            const png = await QRCode.toBuffer(data, { type: 'png', width: 320, margin: 1 });
            res.set('Content-Type', 'image/png');
            res.send(png);
        } catch (err) {
            res.status(500).send(err.message);
        }
    });

    app.get('/api/events', (req, res) => {
        res.set({
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
        });
        res.flushHeaders && res.flushHeaders();

        const send = (event) => {
            res.write(`data: ${JSON.stringify(event)}\n\n`);
        };

        send({
            type: 'status',
            ready: monitor.ready,
            qr: lastQr,
            groups: monitor.groupCache,
            selected: [...monitor.selectedGroups],
            lastDownload,
        });

        const unsubscribe = monitor.subscribe(send);
        const keepAlive = setInterval(() => res.write(': ping\n\n'), 20000);

        req.on('close', () => {
            clearInterval(keepAlive);
            unsubscribe();
        });
    });

    app.get('/api/files', (req, res) => {
        const files = [];
        const root = monitor.config.downloadDir;

        const walk = (dir) => {
            let entries = [];
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch (err) {
                return;
            }
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) walk(full);
                else if (!entry.name.endsWith('.json')) {
                    const stat = fs.statSync(full);
                    files.push({
                        name: entry.name,
                        group: path.relative(root, path.dirname(full)),
                        size: stat.size,
                        modified: stat.mtime.toISOString(),
                    });
                }
            }
        };

        walk(root);
        files.sort((a, b) => (a.modified < b.modified ? 1 : -1));
        res.json({ files: files.slice(0, 500), total: files.length });
    });

    return app;
}

module.exports = { createServer };
