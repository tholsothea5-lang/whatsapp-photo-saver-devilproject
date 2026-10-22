'use strict';

/**
 * Patch whatsapp-web.js 1.34.7 for the current WhatsApp Web internals.
 *
 * Applied to: node_modules/whatsapp-web.js/src/util/Injected/Utils.js
 *
 * The changes make the injected `WWebJS` helpers tolerate WhatsApp Web
 * payloads that use `$1` (instead of `_serialized`) as the serialized id
 * field, plus a small MediaData internal-field cleanup. The rest of the
 * library is untouched.
 *
 * Idempotent: each replacement asserts it matches exactly once.
 */

const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, '..', 'node_modules', 'whatsapp-web.js', 'src', 'util', 'Injected', 'Utils.js');
const BUGGY = fs.readFileSync(TARGET, 'utf8');

const PATCHES = [
    {
        name: 'getMessageModel: accept $1 remote id + normalize _serialized',
        search: [
            '        if (typeof msg.id.remote === \'object\') {',
            '            msg.id = Object.assign({}, msg.id, {',
            "                remote: msg.id.remote._serialized,",
            '            });',
            '        }',
        ].join('\n'),
        replace: [
            '        if (typeof msg.id.remote === \'object\') {',
            '            msg.id = Object.assign({}, msg.id, {',
            "                remote: msg.id.remote._serialized || msg.id.remote.$1,",
            '            });',
            '        }',
            '',
            '        // WhatsApp Web changed _serialized to $1 in message IDs (2026-07 update).',
            '        // Normalize here so all downstream Node.js code can keep using _serialized.',
            '        if (msg.id && msg.id._serialized == null && msg.id.$1 != null) {',
            '            msg.id = Object.assign({}, msg.id, { _serialized: msg.id.$1 });',
            '        }',
        ].join('\n'),
    },
    {
        name: 'getChatModel: widen chat id before createWid',
        search: [
            '            const chatWid = window',
            "                .require('WAWebWidFactory')",
            '                .createWid(chat.id._serialized);',
        ].join('\n'),
        replace: [
            '            const chatWid = window',
            "                .require('WAWebWidFactory')",
            '                .createWid(chat.id._serialized || chat.id.$1);',
        ].join('\n'),
    },
    {
        name: 'getChatModel: lastReceivedKey accepts $1',
        search: [
            '                      .Msg.get(chat.lastReceivedKey._serialized) ||',
        ].join('\n'),
        replace: [
            '                      .Msg.get(chat.lastReceivedKey._serialized || chat.lastReceivedKey.$1) ||',
        ].join('\n'),
    },
    {
        name: 'getChatModel: Msg.getMessagesById accepts $1',
        search: [
            '                          .Msg.getMessagesById([',
            '                              chat.lastReceivedKey._serialized,',
            '                          ])',
        ].join('\n'),
        replace: [
            '                          .Msg.getMessagesById([',
            '                              chat.lastReceivedKey._serialized || chat.lastReceivedKey.$1,',
            '                          ])',
        ].join('\n'),
    },
    {
        name: 'sendMessage: newMsgKey accepts $1',
        search: [
            "            .Msg.get(newMsgKey._serialized);",
        ].join('\n'),
        replace: [
            "            .Msg.get(newMsgKey._serialized || newMsgKey.$1);",
        ].join('\n'),
    },
    {
        name: 'editMessage: msg.id accepts $1',
        search: [
            "        return window.require('WAWebCollections').Msg.get(msg.id._serialized);",
        ].join('\n'),
        replace: [
            '        return window',
            "            .require('WAWebCollections')",
            "            .Msg.get(msg.id._serialized || msg.id.$1);",
        ].join('\n'),
    },
    {
        name: 'message: drop private __x_id to avoid Msg collision',
        search: [
            "        // Bot's won't reply if canonicalUrl is set (linking)",
        ].join('\n'),
        replace: [
            '        // MediaData is a model whose private __x_id field collides with Msg\'s',
            '        // internal id field when its enumerable properties are spread above,',
            '        // breaking getValidatedSender() during Msg initialization.',
            '        if (message.__x_id) {',
            '            delete message.__x_id;',
            '        }',
            '',
            "        // Bot's won't reply if canonicalUrl is set (linking)",
        ].join('\n'),
    },
];

function applyPatch(name, target, patch) {
    if (!target.includes(patch.search)) {
        throw new Error(`[${name}] HUNK NOT FOUND. The installed Utils.js no longer matches this patch.`);
    }
    const count = (target.split(patch.search).length - 1);
    if (count !== 1) {
        throw new Error(`[${name}] EXPECTED 1 MATCH, GOT ${count}. Aborting to avoid partial patch.`);
    }
    return target.split(patch.search).join(patch.replace);
}

function main() {
    // The patch is applied automatically by `postinstall`, so it must survive
    // being run again on an already-patched file (npm install, npm ci, etc.).
    const alreadyPatched = PATCHES.filter((p) => BUGGY.includes(p.replace));
    if (alreadyPatched.length === PATCHES.length) {
        console.log('[skip] whatsapp-web.js is already patched');
        return;
    }
    if (alreadyPatched.length > 0) {
        console.error(
            `[error] partially patched (${alreadyPatched.length}/${PATCHES.length} hunks); ` +
                'reinstall whatsapp-web.js@1.34.7 and run this script again',
        );
        process.exit(1);
    }

    let fixed = BUGGY;
    for (const p of PATCHES) {
        try {
            fixed = applyPatch(p.name, fixed, p);
            console.log(`[ok] ${p.name}`);
        } catch (err) {
            console.error(err.message);
            process.exit(1);
        }
    }
    fs.writeFileSync(TARGET, fixed, 'utf8');
    const size = fs.statSync(TARGET).size;
    console.log(`[done] Patched ${TARGET} (${size} bytes)`);
}

main();
