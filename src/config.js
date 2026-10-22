'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
    downloadDir: './downloads',
    sessionDir: './.wwebjs_auth',
    stateFile: './.state.json',
    port: 3000,
    groupNames: [],
    includeImages: true,
    includeVideos: true,
    includeDocuments: false,
    includeStickers: false,
    backfillOnStart: true,
    backfillLimit: 200,
    liveMonitoring: true,
    saveCaptionToMetadata: true,
    includeOwnMessages: false,
};

function loadConfig(filePath = path.join(__dirname, '..', 'config.json')) {
    let fileConfig = {};
    if (fs.existsSync(filePath)) {
        try {
            fileConfig = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (err) {
            throw new Error(`Invalid JSON in ${filePath}: ${err.message}`);
        }
    }
    const cfg = { ...DEFAULTS, ...fileConfig };
    cfg.rootDir = path.resolve(__dirname, '..');
    cfg.downloadDir = path.resolve(cfg.rootDir, cfg.downloadDir);
    cfg.sessionDir = path.resolve(cfg.rootDir, cfg.sessionDir);
    cfg.stateFile = path.resolve(cfg.rootDir, cfg.stateFile);
    return cfg;
}

module.exports = { loadConfig, DEFAULTS };
