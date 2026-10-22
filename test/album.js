'use strict';

/**
 * Album resolution test.
 *
 * whatsapp-web.js has no album support, so the album children are resolved
 * by running code inside the WhatsApp Web page. This test mocks that browser
 * context (via `vm`) so the album logic can be verified offline.
 *
 * Run with: node test/album.js
 */

const assert = require('assert');
const vm = require('vm');
const { resolveDescriptors, fetchMediaData } = require('../src/media');

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

/** Build a fake WhatsApp message model. */
function model(id, extra = {}) {
    return {
        id: {
            _serialized: id,
            remote: { _serialized: 'GROUP_1@g.us' },
        },
        type: 'image',
        mimetype: 'image/jpeg',
        directPath: `/v/t62/${id}`,
        encFilehash: `enc_${id}`,
        filehash: `fh_${id}`,
        mediaKey: `mk_${id}`,
        mediaKeyTimestamp: 1700000000,
        mediaData: { mediaStage: 'RESOLVED' },
        ...extra,
    };
}

/**
 * Create a fake puppeteer page whose evaluate() runs the given function
 * inside a sandboxed browser-like context.
 */
function fakePage(models, chatModels) {
    return {
        evaluate: async (fn, arg) => {
            const sandbox = {
                AbortController,
                console,
                window: {
                    require: (mod) => {
                        if (mod === 'WAWebCollections') {
                            return {
                                Msg: {
                                    get: (id) => models[id] || null,
                                    getMessagesById: async () => ({
                                        messages: [],
                                    }),
                                },
                            };
                        }
                        if (mod === 'WAWebDownloadManager') {
                            return {
                                downloadManager: {
                                    downloadAndMaybeDecrypt: async () =>
                                        new Uint8Array([1, 2, 3, 4]),
                                },
                            };
                        }
                        throw new Error('Unknown module: ' + mod);
                    },
                    WWebJS: {
                        getChat: async () => ({
                            msgs: {
                                getModelsArray: () => chatModels,
                            },
                        }),
                        arrayBufferToBase64Async: async (buf) =>
                            Buffer.from(buf).toString('base64'),
                    },
                },
            };
            vm.createContext(sandbox);
            return vm.runInContext(`(${fn.toString()})`, sandbox)(arg);
        },
    };
}

console.log('album resolution');

const parent = model('PARENT', { type: 'album', albumId: 'ALB_1' });
const child1 = model('CHILD_1', { albumId: 'ALB_1' });
const child2 = model('CHILD_2', { albumId: 'ALB_1' });
const unrelated = model('OTHER', { albumId: 'ALB_2' });

const client = {
    pupPage: fakePage(
        { PARENT: parent, CHILD_1: child1, CHILD_2: child2 },
        [parent, child1, child2, unrelated],
    ),
};

(async () => {
    const descriptors = await resolveDescriptors(client, {
        id: { _serialized: 'PARENT' },
        type: 'album',
        _data: parent,
    });

    check('album yields multiple descriptors', () =>
        assert.ok(descriptors.length >= 2));
    check('album children are included', () => {
        const ids = descriptors.map((d) => d.id);
        assert.ok(ids.includes('CHILD_1'));
        assert.ok(ids.includes('CHILD_2'));
    });
    check('unrelated messages are excluded', () =>
        assert.ok(!descriptors.map((d) => d.id).includes('OTHER')));
    check('descriptors carry directPath', () =>
        assert.ok(descriptors.every((d) => !!d.directPath)));
    check('descriptors carry mediaKey', () =>
        assert.ok(descriptors.every((d) => !!d.mediaKey)));
    check('parent is not downloaded twice', () =>
        assert.ok(!descriptors.map((d) => d.id).includes('PARENT')));
    check('album indices are assigned', () =>
        assert.deepStrictEqual(
            descriptors.map((d) => d.albumIndex),
            descriptors.map((_, i) => i),
        ));

    console.log('album fallback (children unavailable)');
    const lonelyClient = {
        pupPage: fakePage({ PARENT: parent }, [parent]),
    };
    const fallback = await resolveDescriptors(lonelyClient, {
        id: { _serialized: 'PARENT' },
        type: 'album',
        _data: parent,
    });
    check('falls back to the parent descriptor', () =>
        assert.strictEqual(fallback.length, 1));
    check('fallback keeps the parent id', () =>
        assert.strictEqual(fallback[0].id, 'PARENT'));

    console.log('single image message');
    const singleClient = {
        pupPage: fakePage({ IMG: model('IMG') }, []),
    };
    const single = await resolveDescriptors(singleClient, {
        id: { _serialized: 'IMG' },
        type: 'image',
        _data: model('IMG'),
    });
    check('single image yields exactly one descriptor', () =>
        assert.strictEqual(single.length, 1));
    check('single image keeps its id', () =>
        assert.strictEqual(single[0].id, 'IMG'));

    console.log('media download');
    const payload = await fetchMediaData(singleClient, single[0]);
    check('download returns base64 data', () =>
        assert.ok(payload && typeof payload.data === 'string'));
    check('download decodes to the raw bytes', () =>
        assert.deepStrictEqual(
            Buffer.from(payload.data, 'base64'),
            Buffer.from([1, 2, 3, 4]),
        ));
    check('download reports the mimetype', () =>
        assert.strictEqual(payload.mimetype, 'image/jpeg'));

    console.log(`\n${passed} checks passed`);
})();
