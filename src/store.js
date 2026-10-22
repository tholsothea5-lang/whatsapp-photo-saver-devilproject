'use strict';

const fs = require('fs');
const path = require('path');
const { logger } = require('./logger');

class StateStore {
    constructor(filePath) {
        this.filePath = path.resolve(filePath);
        this.data = { downloaded: {}, updatedAt: null };
        this.load();
    }

    load() {
        try {
            if (fs.existsSync(this.filePath)) {
                const raw = fs.readFileSync(this.filePath, 'utf8');
                const parsed = JSON.parse(raw);
                this.data = {
                    downloaded: parsed.downloaded || {},
                    updatedAt: parsed.updatedAt || null,
                };
                logger.info(
                    `State loaded: ${Object.keys(this.data.downloaded).length} previously downloaded media`,
                );
            }
        } catch (err) {
            logger.warn(`Could not read state file (${err.message}); starting fresh`);
            this.data = { downloaded: {}, updatedAt: null };
        }
    }

    has(messageId) {
        return Object.prototype.hasOwnProperty.call(this.data.downloaded, messageId);
    }

    mark(messageId, meta = {}) {
        this.data.downloaded[messageId] = {
            at: new Date().toISOString(),
            ...meta,
        };
        this.save();
    }

    save() {
        try {
            this.data.updatedAt = new Date().toISOString();
            const dir = path.dirname(this.filePath);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
        } catch (err) {
            logger.error(`Failed to persist state: ${err.message}`);
        }
    }
}

module.exports = StateStore;
