'use strict';

const supportsColor =
    process.stdout.isTTY && process.env.NO_COLOR === undefined;

const CODES = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m',
};

function paint(color, text) {
    if (!supportsColor || !CODES[color]) return String(text);
    return `${CODES[color]}${text}${CODES.reset}`;
}

function timestamp() {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

const logger = {
    info: (...args) =>
        console.log(`${paint('gray', `[${timestamp()}]`)} ${paint('cyan', 'INFO')} ${args.join(' ')}`),
    ok: (...args) =>
        console.log(`${paint('gray', `[${timestamp()}]`)} ${paint('green', 'OK  ')} ${args.join(' ')}`),
    warn: (...args) =>
        console.log(`${paint('gray', `[${timestamp()}]`)} ${paint('yellow', 'WARN')} ${args.join(' ')}`),
    error: (...args) =>
        console.log(`${paint('gray', `[${timestamp()}]`)} ${paint('red', 'ERROR')} ${args.join(' ')}`),
    debug: (...args) => {
        if (process.env.DEBUG) {
            console.log(
                `${paint('gray', `[${timestamp()}]`)} ${paint('magenta', 'DEBUG')} ${args.join(' ')}`,
            );
        }
    },
};

module.exports = { logger, paint };
