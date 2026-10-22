'use strict';

const path = require('path');

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Make an arbitrary string safe to use as a single directory/file segment.
 *
 * - removes control characters
 * - replaces characters that are illegal on Windows (<>:"/\|?*)
 * - collapses whitespace, trims trailing dots/spaces (illegal on Windows)
 * - caps the length
 * - never returns '.' / '..' / a Windows device name
 *
 * @param {*} value
 * @param {{maxLength?: number, fallback?: string}} [options]
 * @returns {string}
 */
function sanitizeSegment(value, options = {}) {
    const maxLength = options.maxLength || 80;
    const fallback = options.fallback === undefined ? '' : options.fallback;

    let out = String(value === null || value === undefined ? '' : value);
    out = out.replace(/[\u0000-\u001f\u007f]/g, ' ');
    out = out.replace(/[<>:"/\\|?*]/g, '_');
    out = out.replace(/\s+/g, ' ').trim();
    out = out.replace(/[. ]+$/g, '');

    if (out.length > maxLength) {
        out = out.slice(0, maxLength).trim();
        out = out.replace(/[. ]+$/g, '');
    }

    if (!out) return fallback;
    if (out === '.' || out === '..') return fallback;
    if (WINDOWS_RESERVED.test(out)) return `_${out}`;
    return out;
}

/**
 * Directory segment for a message caption. Falls back to "NoCaption".
 */
function captionSegment(caption, options = {}) {
    const cleaned = sanitizeSegment(caption, {
        maxLength: options.maxLength || 80,
        fallback: '',
    });
    return cleaned || 'NoCaption';
}

/**
 * Directory segment for a group name.
 */
function groupSegment(name, options = {}) {
    return sanitizeSegment(name, {
        maxLength: options.maxLength || 60,
        fallback: 'Unknown group',
    });
}

/**
 * Directory segment for a calendar date: YYYY-MM-DD (local time).
 */
function dateSegment(date) {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return 'unknown-date';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Build the full target path for a media file:
 *   <root>/<group>/<YYYY-MM-DD>/<caption|NoCaption>/<fileName>
 *
 * The result is guaranteed to stay inside <root>.
 */
function buildTargetPath(rootDir, parts) {
    const root = path.resolve(rootDir);
    const group = groupSegment(parts.group);
    const date = sanitizeSegment(parts.date, { maxLength: 10, fallback: 'unknown-date' });
    const caption = captionSegment(parts.caption);
    const fileName = sanitizeSegment(parts.fileName, {
        maxLength: 200,
        fallback: 'file',
    });

    const target = path.resolve(
        root,
        group,
        date,
        caption,
        fileName,
    );

    // Safety net: never escape the download root.
    if (target !== root && !target.startsWith(root + path.sep)) {
        throw new Error(`Refusing to write outside the download directory: ${target}`);
    }
    return target;
}

/**
 * Parse a "YYYY-MM-DD" string (or Date) into a Date at local midnight.
 * @returns {Date|null}
 */
function parseDateInput(value, endOfDay = false) {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) {
        if (isNaN(value.getTime())) return null;
        return value;
    }
    const text = String(value).trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!m) {
        const parsed = new Date(text);
        return isNaN(parsed.getTime()) ? null : parsed;
    }
    const d = new Date(
        Number(m[1]),
        Number(m[2]) - 1,
        Number(m[3]),
        endOfDay ? 23 : 0,
        endOfDay ? 59 : 0,
        endOfDay ? 59 : 0,
        endOfDay ? 999 : 0,
    );
    return d;
}

module.exports = {
    sanitizeSegment,
    captionSegment,
    groupSegment,
    dateSegment,
    buildTargetPath,
    parseDateInput,
};
