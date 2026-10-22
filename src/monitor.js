'use strict';

const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { logger } = require('./logger');
const { Downloader, safeName } = require('./downloader');
const StateStore = require('./store');

/**
 * Watches WhatsApp Web and downloads photos from selected group chats.
 */
class Monitor {
    constructor(config) {
        this.config = config;
        this.client = null;
        this.store = new StateStore(config.stateFile);
        this.downloader = null;
        this.ready = false;
        this.selectedGroups = new Set(config.groupNames || []);
        this.events = [];
        this.listeners = new Set();
        this.groupCache = [];
        this.contactNameCache = new Map();
    }

    /** Subscribe to progress events (used by the web UI). */
    subscribe(fn) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    emit(event) {
        const payload = { at: Date.now(), ...event };
        this.events.push(payload);
        if (this.events.length > 500) this.events.shift();
        for (const fn of this.listeners) {
            try {
                fn(payload);
            } catch (err) {
                logger.debug(`Event listener failed: ${err.message}`);
            }
        }
    }

    /**
     * Start WhatsApp Web and begin monitoring.
     */
    async start() {
        fs.mkdirSync(this.config.downloadDir, { recursive: true });
        fs.mkdirSync(this.config.sessionDir, { recursive: true });

        this.client = new Client({
            authStrategy: new LocalAuth({
                clientId: 'whatsapp-photo-saver',
                dataPath: this.config.sessionDir,
            }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                ],
            },
        });

        this.downloader = new Downloader({
            client: this.client,
            store: this.store,
            config: this.config,
            onEvent: (e) => this.emit(e),
        });

        this.client.on('qr', (qr) => {
            this.emit({ type: 'qr', qr });
            logger.info('Scan the QR code below with WhatsApp (Link a device):');
            QRCode.generate(qr, { small: true });
        });

        this.client.on('authenticated', () => {
            logger.ok('Authenticated with WhatsApp');
            this.emit({ type: 'authenticated' });
        });

        this.client.on('auth_failure', (msg) => {
            logger.error(`Authentication failure: ${msg}`);
            this.emit({ type: 'auth_failure', message: msg });
        });

        this.client.on('ready', async () => {
            await this.markReady();
        });

        this.client.on('disconnected', (reason) => {
            logger.warn(`Client disconnected: ${reason}`);
            this.ready = false;
            this.emit({ type: 'disconnected', reason });
        });

        this.client.on('message_create', (message) => {
            this.handleMessage(message).catch((err) =>
                logger.error(`Error handling message: ${err.message}`),
            );
        });

        await this.client.initialize();

        // whatsapp-web.js only emits `ready` when the socket *transitions* to
        // hasSynced. When the session is restored the page can already be
        // synced before that listener is attached, so the event never fires
        // and the app would sit at "not connected" forever. Poll once the
        // client is up and finish initialisation if that happened.
        this.watchForMissedReady().catch((err) =>
            logger.debug(`Readiness probe stopped: ${err.message}`),
        );
    }

    /**
     * Mark the client ready exactly once and run the post-ready work.
     */
    async markReady() {
        if (this.ready) return;
        this.ready = true;
        logger.ok('WhatsApp Web is ready');
        this.emit({ type: 'ready' });
        await this.onReady();
    }

    /**
     * Fallback for a missed `ready` event (see start()).
     */
    async watchForMissedReady() {
        for (let attempt = 0; attempt < 150 && !this.ready; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            try {
                const synced = await this.client.pupPage.evaluate(() => {
                    try {
                        return Boolean(
                            window.require('WAWebSocketModel').Socket
                                .hasSynced &&
                                document.querySelector('#pane-side'),
                        );
                    } catch (err) {
                        return false;
                    }
                });
                if (synced) {
                    await this.markReady();
                    return;
                }
            } catch (err) {
                // Page is reloading - try again on the next tick.
            }
        }
    }

    async onReady() {
        await this.refreshGroups();

        if (this.config.liveMonitoring) {
            logger.info('Live monitoring enabled - waiting for new media');
        }

        if (this.config.backfillOnStart) {
            logger.info(
                `Scanning recent history (up to ${this.config.backfillLimit} messages per group)`,
            );
            await this.backfill();
        }
    }

    /**
     * List all group chats and cache them.
     *
     * We deliberately do NOT call `client.getChats()`: whatsapp-web.js maps
     * *every* chat through `WWebJS.getChatModel()`, which awaits
     * `groupMetadata.update()` per group. With a few hundred chats that never
     * resolves inside Puppeteer's protocol timeout, and the burst of parallel
     * metadata updates eventually makes WhatsApp Web reload the page
     * ("Execution context was destroyed"). Reading the group models straight
     * from the Chat collection is synchronous and enough for the picker.
     */
    async refreshGroups() {
        try {
            const groups = await this.client.pupPage.evaluate(() => {
                const collection = window.require('WAWebCollections').Chat;
                const chats = collection.getModelsArray() || [];
                const serializedId = (id) => {
                    if (!id) return null;
                    if (typeof id === 'string') return id;
                    return id._serialized || id.$1 || null;
                };
                return chats
                    .filter((chat) => chat && chat.groupMetadata)
                    .map((chat) => ({
                        id: serializedId(chat.id),
                        name:
                            chat.formattedTitle ||
                            chat.name ||
                            'Unnamed group',
                        participants: chat.groupMetadata.participants
                            ? chat.groupMetadata.participants.length
                            : 0,
                        // Seconds since epoch of the last activity, used to
                        // show the most recently active chats first.
                        lastActivity: chat.t || 0,
                    }))
                    .filter((group) => group.id);
            });
            for (const group of groups) {
                group.selected = this.selectedGroups.has(group.name);
            }
            groups.sort(
                (a, b) =>
                    (b.lastActivity || 0) - (a.lastActivity || 0) ||
                    a.name.localeCompare(b.name),
            );
            this.groupCache = groups;
            this.emit({ type: 'groups', groups });
            logger.info(`Found ${groups.length} group chat(s)`);
            return groups;
        } catch (err) {
            logger.error(`Could not list chats: ${err.message}`);
            return [];
        }
    }

    /**
     * Persist the selected group names to config.json.
     */
    /**
     * Point future downloads at another folder and persist the choice.
     * Throws when the folder cannot be created or written to.
     */
    setDownloadDir(dir) {
        if (!dir || typeof dir !== 'string') {
            throw new Error('Download folder is required');
        }
        const resolved = path.resolve(this.config.rootDir, dir);
        fs.mkdirSync(resolved, { recursive: true });
        fs.accessSync(resolved, fs.constants.W_OK);

        this.config.downloadDir = resolved;
        const cfgPath = path.join(this.config.rootDir, 'config.json');
        try {
            const current = fs.existsSync(cfgPath)
                ? JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
                : {};
            current.downloadDir = resolved;
            fs.writeFileSync(
                cfgPath,
                JSON.stringify(current, null, 2),
                'utf8',
            );
        } catch (err) {
            logger.error(`Could not save config.json: ${err.message}`);
        }

        logger.ok(`Download folder set to ${resolved}`);
        this.emit({ type: 'settings', downloadDir: resolved });
        return resolved;
    }

    /**
     * Unlink the account, remove the stored session and start a fresh client
     * so the UI can show a new QR code without restarting the app.
     */
    async logout() {
        if (this.loggingOut) {
            throw new Error('Logout already in progress');
        }
        this.loggingOut = true;
        this.ready = false;
        logger.info('Logging out of WhatsApp…');
        const old = this.client;
        this.client = null;
        this.groupCache = [];

        try {
            if (old) {
                await Promise.race([
                    old.logout(),
                    new Promise((_, reject) =>
                        setTimeout(
                            () => reject(new Error('logout timed out')),
                            20000,
                        ),
                    ),
                ]);
            }
        } catch (err) {
            logger.warn(`Client logout failed: ${err.message}`);
        } finally {
            try {
                if (old) await old.destroy();
            } catch (e) {
                /* already closed */
            }

            // Guarantee the stored session is gone, otherwise the new client
            // would simply reconnect and no QR would ever be shown.
            const sessionDir = path.join(
                this.config.sessionDir,
                'session-whatsapp-photo-saver',
            );
            let removed = false;
            for (let attempt = 0; attempt < 10 && !removed; attempt += 1) {
                try {
                    fs.rmSync(sessionDir, { recursive: true, force: true });
                    removed = true;
                } catch (e) {
                    await new Promise((resolve) => setTimeout(resolve, 400));
                }
            }
            if (!removed) {
                logger.warn(`Could not remove session folder: ${sessionDir}`);
            }

            this.emit({ type: 'logged_out' });
            this.loggingOut = false;
        }

        // Give Windows a moment to release the profile lock, then relaunch so
        // a fresh QR code is emitted.
        await new Promise((resolve) => setTimeout(resolve, 600));
        try {
            await this.start();
            logger.ok('Logged out — waiting for the QR code');
        } catch (err) {
            logger.error(`Could not restart WhatsApp client: ${err.message}`);
            this.emit({ type: 'logout_failed', message: err.message });
        }
    }

    async saveSelection(names, options = {}) {
        const previous = new Set(this.selectedGroups);
        this.selectedGroups = new Set(names);
        const cfgPath = path.join(this.config.rootDir, 'config.json');
        try {
            const current = fs.existsSync(cfgPath)
                ? JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
                : {};
            current.groupNames = [...this.selectedGroups];
            fs.writeFileSync(
                cfgPath,
                JSON.stringify(current, null, 2),
                'utf8',
            );
            this.config.groupNames = current.groupNames;
        } catch (err) {
            logger.error(`Could not save config.json: ${err.message}`);
        }

        this.groupCache = this.groupCache.map((g) => ({
            ...g,
            selected: this.selectedGroups.has(g.name),
        }));
        logger.ok(
            `Selected groups saved: ${[...this.selectedGroups].join(', ') || 'none'}`,
        );
        this.emit({ type: 'groups', groups: this.groupCache });

        // Newly selected groups should be back-filled straight away so the
        // user does not have to restart the application.
        const newlySelected = [...this.selectedGroups].filter(
            (n) => !previous.has(n),
        );
        if (
            options.backfill !== false &&
            newlySelected.length &&
            this.config.backfillOnStart
        ) {
            if (!this.ready) {
                logger.info(
                    'WhatsApp Web is not connected yet - the history scan will ' +
                        'run automatically once it is ready',
                );
                return;
            }
            logger.info(`Back-filling newly selected group(s): ${newlySelected.join(', ')}`);
            await this.backfill(newlySelected);
        }
    }

    /**
     * Should we download media from this chat?
     */
    isSelected(chatName) {
        if (this.selectedGroups.size === 0) return false;
        return this.selectedGroups.has(chatName);
    }

    /**
     * Resolve a sender id to a readable name (best effort).
     */
    async resolveSenderName(chat, message) {
        const author = message.author;
        if (!author) return '';

        if (this.contactNameCache.has(author)) {
            return this.contactNameCache.get(author);
        }

        let name = author.split('@')[0];
        try {
            const contact = await this.client.getContactById(author);
            if (contact && contact.pushname) name = contact.pushname;
            else if (contact && contact.name) name = contact.name;
            else if (contact && contact.number) name = contact.number;
        } catch (err) {
            logger.debug(`Could not resolve sender ${author}: ${err.message}`);
        }

        this.contactNameCache.set(author, name);
        return name;
    }

    /**
     * Handle a newly received (or sent) message.
     */
    async handleMessage(message) {
        if (!this.ready) return;
        if (message.fromMe && !this.config.includeOwnMessages) return;

        let chat;
        try {
            chat = await message.getChat();
        } catch (err) {
            logger.debug(`Could not resolve chat for message: ${err.message}`);
            return;
        }

        if (!chat.isGroup) return;
        if (!this.isSelected(chat.name)) return;

        const type = (message._data && message._data.type) || message.type;
        const isMedia =
            type === 'image' ||
            type === 'video' ||
            type === 'album' ||
            type === 'sticker' ||
            type === 'document';
        if (!isMedia) return;

        const senderName = await this.resolveSenderName(chat, message);
        this.emit({
            type: 'message',
            group: chat.name,
            mediaType: type,
            sender: senderName,
        });

        this.downloader.enqueue(message, { groupName: chat.name, senderName });
    }

    /**
     * Download media from the recent history of the selected groups.
     *
     * @param {string[]} [onlyNames] limit the scan to these group names
     */
    async backfill(onlyNames) {
        const wanted = onlyNames ? new Set(onlyNames) : null;
        const groups = this.groupCache.filter(
            (g) =>
                this.isSelected(g.name) &&
                (!wanted || wanted.has(g.name)),
        );
        if (!groups.length) {
            logger.info(
                wanted
                    ? `None of the requested group(s) ${[...wanted].join(', ')} were found - skipping history scan`
                    : 'No groups selected - skipping history scan',
            );
            return;
        }

        for (const group of groups) {
            try {
                const chat = await this.client.getChatById(group.id);
                const limit = this.config.backfillLimit;
                const msgs = await chat.fetchMessages({ limit });

                let mediaCount = 0;
                for (const message of msgs) {
                    const type = (message._data && message._data.type) || message.type;
                    if (
                        type === 'image' ||
                        type === 'video' ||
                        type === 'album' ||
                        type === 'sticker' ||
                        type === 'document'
                    ) {
                        mediaCount += 1;
                        const senderName = await this.resolveSenderName(chat, message);
                        await this.downloader.process(message, {
                            groupName: chat.name,
                            senderName,
                        });
                    }
                }
                logger.info(
                    `History scan for "${chat.name}": ${msgs.length} messages, ${mediaCount} media items`,
                );
                this.emit({ type: 'backfill_done', group: chat.name });
            } catch (err) {
                logger.error(
                    `History scan failed for "${group.name}": ${err.message}`,
                );
            }
        }
    }

    /**
     * Download image messages sent between two instants, optionally limited
     * to specific groups and/or a sender name.
     *
     * @param {{start:string, end:string, groups?:string[], sender?:string,
     *          skipExisting?:boolean}} options
     */
    async downloadRange(options = {}) {
        if (this.rangeRunning) {
            throw new Error('A date-range download is already running');
        }

        const startMs = Date.parse(options.start);
        const endMs = Date.parse(options.end);
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
            throw new Error('Invalid start/end date');
        }
        if (endMs < startMs) {
            throw new Error('End date must be after the start date');
        }

        const startSec = Math.floor(startMs / 1000);
        const endSec = Math.floor(endMs / 1000);
        const wanted = Array.isArray(options.groups) ? options.groups : [];
        const wantsAll = !wanted.length || wanted.includes('__all__');
        const targets = wantsAll
            ? this.groupCache.slice()
            : this.groupCache.filter((g) => wanted.includes(g.name));
        const senderFilter = String(options.sender || '').trim().toLowerCase();

        if (!targets.length) {
            return { total: 0, downloaded: 0, skipped: 0, failed: 0, groups: 0 };
        }

        this.rangeRunning = true;
        try {
            // Pass 1: collect the messages that match, so the UI can show a
            // meaningful done/total counter.
            const jobs = [];
            for (const group of targets) {
                try {
                    const chat = await this.client.getChatById(group.id);
                    const msgs = await chat.fetchMessages({
                        limit: this.config.rangeScanLimit || 1000,
                    });
                    for (const message of msgs) {
                        if (
                            message.timestamp < startSec ||
                            message.timestamp > endSec
                        ) {
                            continue;
                        }
                        const type =
                            (message._data && message._data.type) ||
                            message.type;
                        if (type !== 'image' && type !== 'album') continue;

                        const senderName = await this.resolveSenderName(
                            chat,
                            message,
                        );
                        if (
                            senderFilter &&
                            !String(senderName).toLowerCase().includes(senderFilter)
                        ) {
                            continue;
                        }
                        jobs.push({ message, groupName: chat.name, senderName });
                    }
                } catch (err) {
                    logger.error(
                        `Range scan failed for "${group.name}": ${err.message}`,
                    );
                }
            }

            const total = jobs.length;
            this.emit({ type: 'range_start', total });
            logger.info(
                `Date range ${new Date(startMs).toISOString()} .. ${new Date(
                    endMs,
                ).toISOString()}: ${total} image message(s) in ${targets.length} group(s)`,
            );

            let downloaded = 0;
            let failed = 0;
            let done = 0;
            for (const job of jobs) {
                const beforeDownloaded = this.downloader.stats.downloaded;
                const beforeFailed = this.downloader.stats.failed;
                try {
                    await this.downloader.process(
                        job.message,
                        { groupName: job.groupName, senderName: job.senderName },
                        { skipExisting: options.skipExisting !== false },
                    );
                } catch (err) {
                    failed += 1;
                    logger.error(`Range download failed: ${err.message}`);
                }
                downloaded += this.downloader.stats.downloaded - beforeDownloaded;
                failed += this.downloader.stats.failed - beforeFailed;
                done += 1;
                this.emit({
                    type: 'range_progress',
                    done,
                    total,
                    group: job.groupName,
                });
            }

            const skipped = Math.max(0, total - downloaded - failed);
            this.emit({
                type: 'range_done',
                total,
                downloaded,
                skipped,
                failed,
            });
            logger.ok(
                `Range download finished: ${downloaded} saved, ${skipped} skipped, ${failed} failed`,
            );
            return { total, downloaded, skipped, failed, groups: targets.length };
        } finally {
            this.rangeRunning = false;
        }
    }

    /**
     * Logged-in account name + avatar URL (null when privacy-blocked).
     */
    async getProfile() {
        if (!this.client || !this.client.info) return null;
        const info = this.client.info;
        const wid = info.wid && (info.wid._serialized || info.wid.$1);
        let profilePicUrl = null;
        try {
            if (wid) profilePicUrl = await this.client.getProfilePicUrl(wid);
        } catch (err) {
            logger.debug(`Could not fetch profile picture: ${err.message}`);
        }
        return {
            name: info.pushname || info.formattedName || 'Me',
            profilePicUrl: profilePicUrl || null,
        };
    }

    async stop() {
        try {
            if (this.client) await this.client.destroy();
        } catch (err) {
            logger.debug(`Error while destroying client: ${err.message}`);
        }
        this.ready = false;
    }
}

module.exports = { Monitor, safeName };
