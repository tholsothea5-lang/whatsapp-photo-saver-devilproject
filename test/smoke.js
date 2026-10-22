'use strict';

/**
 * Offline smoke test: exercises config, store, media resolution, filename
 * generation, the downloader and the HTTP API using a mocked WhatsApp client.
 *
 * Run with: npm test
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const { loadConfig } = require('../src/config');
const StateStore = require('../src/store');
const {
    Downloader,
    safeName,
    typeAllowed,
    dateFolderName,
} = require('../src/downloader');
const { extensionFor, descriptorFromModel } = require('../src/media');
const { createServer } = require('../src/server');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'waps-'));

let passed = 0;
function check(name, fn) {
    try {
        fn();
        passed += 1;
        console.log(`  ok  ${name}`);
    } catch (err) {
        console.error(`  FAIL ${name}: ${err.message}`);
        process.exitCode = 1;
    }
}

console.log('config');
const cfg = loadConfig(path.join(__dirname, '..', 'config.json'));
check('downloadDir is absolute', () => assert.ok(path.isAbsolute(cfg.downloadDir)));
check('default includes images', () => assert.strictEqual(cfg.includeImages, true));

console.log('filenames');
check('safeName strips path chars', () => {
    assert.strictEqual(safeName('a/b\\c:d*e?f'), 'abcdef');
});
check('safeName trims and caps', () => {
    assert.ok(safeName('x'.repeat(300)).length <= 120);
});
check('extensionFor uses mimetype', () => {
    assert.strictEqual(extensionFor({ mimetype: 'image/png' }), 'png');
});
check('extensionFor falls back by type', () => {
    assert.strictEqual(extensionFor({ type: 'video' }), 'mp4');
});

console.log('type filter');
check('images allowed by default', () => assert.ok(typeAllowed('image', cfg)));
check('audio not allowed', () => assert.ok(!typeAllowed('audio', cfg)));

console.log('store');
const store = new StateStore(path.join(tmp, 'state.json'));
check('new store is empty', () => assert.ok(!store.has('abc')));
store.mark('abc', { file: 'x.jpg' });
check('marked id is remembered', () => assert.ok(store.has('abc')));
const reloaded = new StateStore(path.join(tmp, 'state.json'));
check('state survives reload', () => assert.ok(reloaded.has('abc')));

console.log('media descriptors');
check('descriptor picks up fields', () => {
    const d = descriptorFromModel({
        id: { _serialized: 'ID' },
        type: 'image',
        mimetype: 'image/jpeg',
        directPath: '/v/t62',
    });
    assert.strictEqual(d.id, 'ID');
    assert.strictEqual(d.mimetype, 'image/jpeg');
    assert.strictEqual(d.directPath, '/v/t62');
});

console.log('downloader (mocked client)');
const fakeClient = {
    pupPage: {
        evaluate: async (fn, arg) => {
            // Emulate the browser returning a base64 payload.
            return {
                data: Buffer.from('fake-image-bytes').toString('base64'),
                mimetype: 'image/jpeg',
            };
        },
    },
};

const dlCfg = {
    ...cfg,
    downloadDir: path.join(tmp, 'downloads'),
    stateFile: path.join(tmp, 'dl-state.json'),
    saveCaptionToMetadata: true,
};

const dlStore = new StateStore(dlCfg.stateFile);
const events = [];
const downloader = new Downloader({
    client: fakeClient,
    store: dlStore,
    config: dlCfg,
    onEvent: (e) => events.push(e),
});

const fakeMessage = {
    id: { _serialized: 'MSG_1' },
    type: 'image',
    timestamp: 1700000000,
    body: 'hello caption',
    author: '123@c.us',
    _data: {
        id: { _serialized: 'MSG_1' },
        type: 'image',
        mimetype: 'image/jpeg',
        directPath: '/v/t62',
        mediaKey: 'key',
    },
};

(async () => {
    await downloader.process(fakeMessage, {
        groupName: 'Test Group',
        senderName: 'Alice',
    });

    const sent = new Date(fakeMessage.timestamp * 1000);
    const outDir = path.join(
        dlCfg.downloadDir,
        dateFolderName(sent),
        'hello caption',
    );
    const files = fs.existsSync(outDir) ? fs.readdirSync(outDir) : [];
    check('media file was written', () =>
        assert.ok(files.some((f) => f.endsWith('.jpg'))));
    check('sidecar metadata was written', () =>
        assert.ok(files.some((f) => f.endsWith('.jpg.json'))));
    check('file is named <sender>_<DD-MM-YYYY>', () =>
        assert.ok(
            files.some(
                (f) =>
                    f.startsWith('Alice_') &&
                    f.endsWith(dateFolderName(sent) + '.jpg'),
            ),
        ));
    check('stats counted one download', () =>
        assert.strictEqual(downloader.stats.downloaded, 1));
    check('downloaded event emitted', () =>
        assert.ok(events.some((e) => e.type === 'downloaded')));

    // Second pass must be deduplicated.
    await downloader.process(fakeMessage, {
        groupName: 'Test Group',
        senderName: 'Alice',
    });
    check('duplicate is skipped', () =>
        assert.strictEqual(downloader.stats.downloaded, 1));
    check('duplicate counted as skipped', () =>
        assert.ok(downloader.stats.skipped >= 1));

    console.log('http api');
    const monitor = {
        ready: false,
        groupCache: [
            { id: 'g1', name: 'Test Group', participants: 3, selected: true },
        ],
        selectedGroups: new Set(['Test Group']),
        config: dlCfg,
        downloader,
        events: [],
        subscribe: (fn) => {
            monitor.events.push(fn);
            return () => {};
        },
        refreshGroups: async () => monitor.groupCache,
        saveSelection: async (names) => {
            monitor.selectedGroups = new Set(names);
        },
    };

    const app = createServer(monitor);
    const server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    const port = server.address().port;

    const get = (p) =>
        new Promise((resolve, reject) => {
            http
                .get({ host: '127.0.0.1', port, path: p }, (res) => {
                    let data = '';
                    res.on('data', (c) => (data += c));
                    res.on('end', () =>
                        resolve({ status: res.statusCode, body: data }),
                    );
                })
                .on('error', reject);
        });

    const status = await get('/api/status');
    check('/api/status returns 200', () => assert.strictEqual(status.status, 200));
    check('/api/status includes groups', () =>
        assert.ok(JSON.parse(status.body).groups.length === 1));

    const filesRes = await get('/api/files');
    check('/api/files lists the saved file', () =>
        assert.ok(JSON.parse(filesRes.body).total >= 1));

    const groupsRes = await get('/api/groups');
    check('/api/groups returns 200', () =>
        assert.strictEqual(groupsRes.status, 200));

    const qrRes = await get('/api/qr.png?data=test');
    check('/api/qr.png returns png', () => assert.strictEqual(qrRes.status, 200));

    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });

    console.log(`\n${passed} checks passed`);
})();

