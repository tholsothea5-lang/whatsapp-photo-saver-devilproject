'use strict';

/**
 * Helpers that turn a whatsapp-web.js Message into one or more *media
 * descriptors* and download those descriptors to disk.
 *
 * A descriptor is a plain object describing a single downloadable file:
 *   { id, type, mimetype, filename, size, directPath, encFilehash,
 *     filehash, mediaKey, mediaKeyTimestamp, albumIndex }
 *
 * Why descriptors instead of using `message.downloadMedia()` directly?
 * WhatsApp "album" messages (several photos sent at once) arrive as a single
 * `type: 'album'` message whose children are NOT emitted as separate
 * messages. whatsapp-web.js has no album support, so we resolve the children
 * ourselves and decrypt them with the same mechanism the library uses
 * (WAWebDownloadManager.downloadAndMaybeDecrypt).
 */

const TYPE_TO_MIME = {
    image: 'image/jpeg',
    video: 'video/mp4',
    sticker: 'image/webp',
    ptt: 'audio/ogg',
    audio: 'audio/mpeg',
    document: 'application/octet-stream',
};

const MIME_EXTENSIONS = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'image/bmp': 'bmp',
    'video/mp4': 'mp4',
    'video/3gpp': '3gp',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/ogg': 'ogg',
    'audio/opus': 'opus',
    'application/pdf': 'pdf',
    'application/zip': 'zip',
    'text/plain': 'txt',
};

/**
 * Build a descriptor from a raw (serialized) WhatsApp message model.
 *
 * `model.id` may be either an id object ({ _serialized }) or an already
 * serialized string (as returned by the in-page album resolver).
 */
function descriptorFromModel(model, extra = {}) {
    if (!model) return null;

    let id = null;
    if (typeof model.id === 'string') {
        id = model.id;
    } else if (model.id && model.id._serialized) {
        id = model.id._serialized;
    }

    const mimetype = model.mimetype || TYPE_TO_MIME[model.type] || null;
    return {
        id,
        type: model.type,
        mimetype,
        filename: model.filename || null,
        size: model.size || null,
        directPath: model.directPath || null,
        encFilehash: model.encFilehash || null,
        filehash: model.filehash || null,
        mediaKey: model.mediaKey || null,
        mediaKeyTimestamp: model.mediaKeyTimestamp || null,
        ...extra,
    };
}

/**
 * Expand a message into descriptors.
 *
 * - Regular media messages yield exactly one descriptor.
 * - Album messages yield one descriptor per image/video in the album.
 *
 * @param {import('whatsapp-web.js').Client} client
 * @param {import('whatsapp-web.js').Message} message
 * @returns {Promise<Array<object>>}
 */
async function resolveDescriptors(client, message) {
    const raw = message._data || {};
    const isAlbum = raw.type === 'album' || message.type === 'album';

    if (!isAlbum) {
        const desc = descriptorFromModel(raw, {
            id: message.id && message.id._serialized ? message.id._serialized : null,
        });
        if (!desc || !desc.directPath) return [];
        return [desc];
    }

    // Album: ask the page for the sibling messages that share the albumId.
    const msgId = message.id && message.id._serialized;
    let children = [];

    try {
        children = await client.pupPage.evaluate(async (id) => {
            const Msg = window.require('WAWebCollections').Msg;
            const model = Msg.get(id);
            if (!model) return [];

            const albumId = model.albumId || (model.album && model.album.id) || null;
            const chatId =
                model.id && model.id.remote && model.id.remote._serialized
                    ? model.id.remote._serialized
                    : null;

            const found = [];
            const collect = (models) => {
                if (!models) return;
                for (const m of models) {
                    const mid = m.id && m.id._serialized;
                    if (!mid || mid === id) continue;
                    const mAlbum = m.albumId || (m.album && m.album.id) || null;
                    const matches =
                        (albumId && mAlbum === albumId) ||
                        (albumId && m.album && m.album.id === albumId);
                    if (matches) found.push(m);
                }
            };

            // 1) siblings living in the chat's message collection
            if (chatId) {
                try {
                    const chat = await window.WWebJS.getChat(chatId, {
                        getAsModel: false,
                    });
                    collect(chat && chat.msgs && chat.msgs.getModelsArray());
                } catch (e) {
                    /* ignore - fall through to other strategies */
                }
            }

            // 2) explicit child list on the album model
            if (!found.length && model.album && model.album.messages) {
                const list = Array.isArray(model.album.messages)
                    ? model.album.messages
                    : Object.values(model.album.messages);
                for (const child of list) {
                    const childModel =
                        child && child.id && child.id._serialized
                            ? Msg.get(child.id._serialized)
                            : child;
                    if (childModel) found.push(childModel);
                }
            }

            // 3) parent/child links on the model itself
            if (!found.length && model.parentMsgId) {
                const parent = Msg.get(model.parentMsgId);
                if (parent && parent.mediaObject) {
                    collect(parent.mediaObject);
                }
            }

            return found.map((m) => ({
                id: m.id && m.id._serialized,
                type: m.type,
                mimetype: m.mimetype || null,
                filename: m.filename || null,
                size: m.size || null,
                directPath: m.directPath || null,
                encFilehash: m.encFilehash || null,
                filehash: m.filehash || null,
                mediaKey: m.mediaKey || null,
                mediaKeyTimestamp: m.mediaKeyTimestamp || null,
                albumId: albumId || null,
            }));
        }, msgId);
    } catch (err) {
        return [];
    }

    // The album parent itself sometimes carries the first media item.
    const parentDesc = descriptorFromModel(raw, {
        id: msgId,
        albumIndex: 0,
    });

    const childDescs = children
        .map((child) => descriptorFromModel(child))
        .filter((d) => d && d.directPath);

    // When the children could be resolved they cover every item of the
    // album, so the parent is dropped to avoid downloading the first
    // image twice. Otherwise we fall back to the parent alone.
    const useChildren = childDescs.length > 0;
    const all = useChildren
        ? childDescs.map((d, index) => ({ ...d, albumIndex: index }))
        : parentDesc && parentDesc.directPath
          ? [parentDesc]
          : [];

    // De-duplicate by id (falling back to directPath) preserving order.
    const seen = new Set();
    return all.filter((d) => {
        const key = d.id || `${d.directPath}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * Download & decrypt a single descriptor inside the browser context.
 *
 * This mirrors whatsapp-web.js' own `Message.downloadMedia()` implementation
 * (see node_modules/whatsapp-web.js/src/structures/Message.js) with one
 * important addition: the media stage is resolved *before* decrypting.
 * Without that step WhatsApp refuses to serve media that has not been
 * downloaded to the device yet, and the download fails with a 404.
 *
 * @returns {Promise<{data: string, mimetype: string}|null>} base64 payload
 */
async function fetchMediaData(client, desc) {
    const result = await client.pupPage.evaluate(async (d) => {
        if (!d || !d.directPath) return null;

        // Prefer the live message model - it carries the up-to-date
        // media stage, which we need in order to resolve media.
        let msg = null;
        if (d.id) {
            try {
                msg =
                    window.require('WAWebCollections').Msg.get(d.id) ||
                    (
                        await window
                            .require('WAWebCollections')
                            .Msg.getMessagesById([d.id])
                    )?.messages?.[0];
            } catch (e) {
                msg = null;
            }
        }

        const source = msg || d;
        const stage = source.mediaData && source.mediaData.mediaStage;

        // "REUPLOADING" means the media expired and is being re-uploaded;
        // it cannot be downloaded right now.
        if (stage === 'REUPLOADING') {
            return null;
        }

        // Resolve the media (download it from WhatsApp into memory).
        if (
            stage &&
            stage !== 'RESOLVED' &&
            typeof source.downloadMedia === 'function'
        ) {
            try {
                await source.downloadMedia({
                    downloadEvenIfExpensive: true,
                    rmrReason: 1,
                    isUserInitiated: true,
                });
            } catch (e) {
                /* resolution failure is reported below via mediaStage */
            }
        }

        const finalStage =
            source.mediaData && source.mediaData.mediaStage;
        if (
            finalStage &&
            (finalStage.includes('ERROR') ||
                finalStage === 'FETCHING' ||
                finalStage === 'REUPLOADING')
        ) {
            return null;
        }

        // Preferred path: after resolution WhatsApp keeps the decrypted bytes
        // in an in-memory blob. Going through it avoids the mimetype check in
        // downloadAndMaybeDecrypt, which rejects `type: 'image'` without a
        // MIME hint ("Unexpected mimetype application/octet-stream ...").
        let buffer = null;
        try {
            const mediaObject = source.mediaObject || {};
            const cached = mediaObject.filehash
                ? window
                      .require('WAWebMediaInMemoryBlobCache')
                      .InMemoryMediaBlobCache.get(mediaObject.filehash)
                : null;
            const blob =
                cached ||
                (mediaObject.mediaBlob
                    ? mediaObject.mediaBlob.forceToBlob()
                    : null);
            if (blob) buffer = await blob.arrayBuffer();
        } catch (e) {
            /* fall back to the download manager below */
        }

        // Fallback: download + decrypt directly. The mimetype is required by
        // current WhatsApp Web builds.
        if (!buffer) {
            const mockQpl = {
                addAnnotations: function () {
                    return this;
                },
                addPoint: function () {
                    return this;
                },
            };

            try {
                buffer = await window
                    .require('WAWebDownloadManager')
                    .downloadManager.downloadAndMaybeDecrypt({
                        directPath: source.directPath || d.directPath,
                        encFilehash: source.encFilehash || d.encFilehash,
                        filehash: source.filehash || d.filehash,
                        mediaKey: source.mediaKey || d.mediaKey,
                        mediaKeyTimestamp:
                            source.mediaKeyTimestamp || d.mediaKeyTimestamp,
                        type: source.type || d.type,
                        mimetype: source.mimetype || d.mimetype,
                        signal: new AbortController().signal,
                        downloadQpl: mockQpl,
                    });
            } catch (e) {
                if (e && e.status === 404) return null;
                return { error: (e && e.message) || 'unknown error' };
            }
        }

        if (!buffer) return null;

        const data = await window.WWebJS.arrayBufferToBase64Async(buffer);

        return {
            data,
            mimetype: source.mimetype || d.mimetype,
            filename: source.filename || d.filename,
            filesize: source.size || d.size,
        };
    }, desc);

    if (!result) return null;
    if (result.error) {
        const err = new Error(result.error);
        err.whatsappDownloadFailure = true;
        throw err;
    }
    return result;
}

/**
 * Guess the file extension for a descriptor.
 */
function extensionFor(desc) {
    const mime = (desc.mimetype || '').toLowerCase();
    if (MIME_EXTENSIONS[mime]) return MIME_EXTENSIONS[mime];

    const type = desc.type;
    if (type === 'image') return 'jpg';
    if (type === 'video') return 'mp4';
    if (type === 'sticker') return 'webp';
    if (type === 'ptt') return 'ogg';
    if (type === 'audio') return 'mp3';

    const fromName = desc.filename && /\.[a-z0-9]{2,5}$/i.exec(desc.filename);
    if (fromName) return fromName[0].slice(1).toLowerCase();

    return 'bin';
}

module.exports = {
    resolveDescriptors,
    fetchMediaData,
    extensionFor,
    descriptorFromModel,
    TYPE_TO_MIME,
    MIME_EXTENSIONS,
};
