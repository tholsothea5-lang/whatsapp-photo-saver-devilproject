'use strict';

const fs = require('fs');
const path = require('path');
const { logger } = require('./logger');
const { resolveDescriptors, fetchMediaData, extensionFor } = require('./media');

/** Strip characters that are not safe on Windows/Linux filesystems. */
function safeName(name, maxLength = 120) {
    return String(name || '')
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength)
        .trim()
        // Windows silently strips trailing dots/spaces, which makes the
        // directory unreadable later.
        .replace(/[. ]+$/g, '');
}

/** Date the message was sent, as DD-MM-YYYY (no slashes in folder names). */
function dateFolderName(date = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`;
}

/** Append _2, _3 ... until the path does not exist. */
function uniquePath(dir, base, ext) {
    let filePath = path.join(dir, `${base}.${ext}`);
    let counter = 2;
    while (fs.existsSync(filePath)) {
        filePath = path.join(dir, `${base}_${counter}.${ext}`);
        counter += 1;
    }
    return filePath;
}

function timestampName(date = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return (
        `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
        `_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
    );
}

/**
 * Decide whether a message type should be saved, based on config.
 */
function typeAllowed(type, cfg) {
    switch (type) {
        case 'image':
            return cfg.includeImages !== false;
        case 'video':
            return cfg.includeVideos !== false;
        case 'sticker':
            return !!cfg.includeStickers;
        case 'document':
            return !!cfg.includeDocuments;
        case 'ptt':
        case 'audio':
            return false;
        default:
            return false;
    }
}

class Downloader {
    /**
     * @param {object} options
     * @param {import('whatsapp-web.js').Client} options.client
     * @param {import('./store').StateStore} options.store
     * @param {object} options.config
     * @param {Function} [options.onEvent] progress callback
     */
    constructor({ client, store, config, onEvent }) {
        this.client = client;
        this.store = store;
        this.config = config;
        this.onEvent = onEvent || (() => {});
        this.queue = [];
        this.running = false;
        this.stats = { downloaded: 0, skipped: 0, failed: 0 };
        // Carry the lifetime total into the UI, otherwise a restart shows
        // "0 saved" next to a full list of downloaded files.
        const known =
            store && store.data && store.data.downloaded
                ? Object.keys(store.data.downloaded).length
                : 0;
        if (known) this.stats.downloaded = known;
    }

    /**
     * Queue a message for processing. Returns immediately.
     */
    enqueue(message, chatInfo) {
        this.queue.push({ message, chatInfo });
        this.pump();
    }

    async pump() {
        if (this.running) return;
        this.running = true;
        try {
            while (this.queue.length) {
                const job = this.queue.shift();
                try {
                    await this.process(job.message, job.chatInfo);
                } catch (err) {
                    this.stats.failed += 1;
                    logger.error(
                        `Failed to process message: ${err.message}`,
                    );
                }
            }
        } finally {
            this.running = false;
        }
    }

    /**
     * Resolve, download and store every media item of a message.
     */
    async process(message, chatInfo = {}, options = {}) {
        const raw = message._data || {};
        const type = raw.type || message.type;
        const isAlbum = type === 'album';

        if (!isAlbum && !typeAllowed(type, this.config)) {
            this.stats.skipped += 1;
            return;
        }

        const descriptors = await resolveDescriptors(this.client, message);
        if (!descriptors.length) {
            this.stats.skipped += 1;
            logger.debug(`No downloadable media for message type "${type}"`);
            return;
        }

        // downloads/<DD-MM-YYYY sent>/<caption | No caption>/
        const sentAt =
            message && message.timestamp
                ? new Date(message.timestamp * 1000)
                : new Date();
        const dateFolder = dateFolderName(sentAt);
        const captionText = String(message.body || '').trim();
        const captionFolder = safeName(captionText, 60) || 'No caption';
        const groupDir = path.join(
            this.config.downloadDir,
            dateFolder,
            captionFolder,
        );

        const caption = this.config.saveCaptionToMetadata ? captionText : '';
        const senderRaw =
            chatInfo.senderName ||
            (message.author ? String(message.author).split('@')[0] : '') ||
            'Unknown';
        const sender = safeName(senderRaw, 60) || 'Unknown';
        const skipExisting = options.skipExisting !== false;

        for (const desc of descriptors) {
            if (!typeAllowed(desc.type, this.config)) {
                this.stats.skipped += 1;
                continue;
            }

            const key = desc.id || desc.directPath;
            if (skipExisting && this.store.has(key)) {
                this.stats.skipped += 1;
                logger.debug(`Already downloaded: ${key}`);
                continue;
            }

            let payload;
            try {
                payload = await fetchMediaData(this.client, desc);
            } catch (err) {
                this.stats.failed += 1;
                logger.warn(`Media download failed (${err.message})`);
                this.onEvent({ type: 'error', message: err.message, key });
                continue;
            }

            if (!payload || !payload.data) {
                this.stats.failed += 1;
                logger.warn(
                    'Media unavailable on WhatsApp servers (expired or not downloaded yet)',
                );
                continue;
            }

            const ext = extensionFor(desc);
            const filePath = uniquePath(
                groupDir,
                `${sender}_${dateFolder}`,
                ext,
            );

            try {
                fs.mkdirSync(groupDir, { recursive: true });
                fs.writeFileSync(filePath, Buffer.from(payload.data, 'base64'));
            } catch (err) {
                this.stats.failed += 1;
                logger.error(`Could not write ${filePath}: ${err.message}`);
                continue;
            }

            this.store.mark(key, {
                file: path.relative(this.config.downloadDir, filePath),
                type: desc.type,
                mimetype: desc.mimetype,
                group: chatInfo.groupName || null,
                sender: sender || null,
            });

            this.stats.downloaded += 1;
            logger.ok(
                `Saved ${path.basename(filePath)} -> ${chatInfo.groupName || 'Unknown group'}`,
            );
            this.onEvent({
                type: 'downloaded',
                file: path.relative(this.config.downloadDir, filePath),
                group: chatInfo.groupName || null,
                mediaType: desc.type,
            });

            if (caption) {
                this.writeSidecar(filePath, { caption, sender, id: desc.id });
            }
        }
    }

    /**
     * Write a small .json sidecar with caption / sender metadata.
     */
    writeSidecar(filePath, meta) {
        try {
            fs.writeFileSync(
                `${filePath}.json`,
                JSON.stringify(meta, null, 2),
                'utf8',
            );
        } catch (err) {
            logger.debug(`Could not write metadata sidecar: ${err.message}`);
        }
    }
}

module.exports = {
    Downloader,
    safeName,
    typeAllowed,
    timestampName,
    dateFolderName,
};
