/**
 * Shared utility functions for WebUI
 */

/**
 * Escape HTML special characters to prevent XSS
 * @param {string} str - Raw string to escape
 * @returns {string} - HTML-safe string
 */
export function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Sanitize a filename for safe use in shell commands.
 * Removes characters that could break out of quotes or cause injection.
 * @param {string} name - Raw filename
 * @returns {string} - Shell-safe filename
 */
export function sanitizeFilename(name) {
    if (!name) return 'unnamed';
    return String(name)
        .replace(/[^a-zA-Z0-9._\-]/g, '_')
        .replace(/_{2,}/g, '_')
        .replace(/^_|_$/g, '')
        || 'unnamed';
}

/**
 * Sanitize a URL for safe use in shell commands.
 * Only allows http/https URLs.
 * @param {string} url - Raw URL
 * @returns {string|null} - Safe URL or null if invalid
 */
export function sanitizeUrl(url) {
    if (!url) return null;
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
        return parsed.href;
    } catch {
        return null;
    }
}

/**
 * Format bytes into a human-readable size string.
 * Centralised here to remove the 3 duplicate copies that previously
 * lived in backup.js, kpm_repo.js, and patch.js.
 * @param {number} bytes - Byte count
 * @returns {string} - e.g. "1.4 MB" / "2.50 GB" / "512 B"
 */
export function formatSize(bytes) {
    if (bytes == null || isNaN(bytes)) return '? B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

/**
 * Parse a semver-style version string ("v0.2.4" / "1.10.0-rc1") into a
 * comparable tuple. Pre-release tags sort as: final > rc > beta > alpha.
 *
 * Returns null when the input doesn't match semver. Both `compareVersions`
 * below and `parseVersion` callers should null-check the result.
 *
 * @param {string} s
 * @returns {[number,number,number,number,number]|null}
 */
export function parseVersion(s) {
    if (!s) return null;
    const m = String(s).trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/i);
    if (!m) return null;
    const [, major, minor, patch, pre] = m;
    // Pre-release structure: [finalFlag, tagRank, preNumber].
    //   finalFlag: 1 (final) > 0 (pre-release). This is an ascending
    //   sort key, so a pre-release of the same X.Y.Z sorts below its
    //   final release. We use 1 for final (no '-' suffix) so that
    //   final(1) - pre(0) = +1, which means "final is newer" — matching
    //   the semver spec §11.4.
    //   tagRank: 4 (rc), 3 (beta), 2 (alpha), 1 (unknown). Higher is
    //   more mature; rc2, rc1 are then broken out by preNumber.
    //   preNumber: numeric suffix after the tag. "rc1" -> 1, "rc" -> 0.
    let finalFlag = 1;
    let tagRank = 4;
    let preNumber = 0;
    if (pre) {
        finalFlag = 0;
        const lower = pre.toLowerCase();
        const tagMatch = lower.match(/^([a-z]+)(?:[.\-_]?(\d+))?$/);
        if (tagMatch) {
            const tag = tagMatch[1];
            const num = tagMatch[2];
            if (tag.startsWith('rc')) tagRank = 4;
            else if (tag.startsWith('beta')) tagRank = 3;
            else if (tag.startsWith('alpha')) tagRank = 2;
            else tagRank = 1;
            preNumber = num ? parseInt(num, 10) : 0;
        } else {
            tagRank = 1;
        }
    }
    return [
        parseInt(major, 10),
        parseInt(minor, 10),
        parseInt(patch, 10),
        finalFlag,
        tagRank,
        preNumber,
    ];
}

/**
 * Compare two semver strings. Returns >0 if a > b, <0 if a < b, 0 if
 * equal or either side unparseable. Callers wanting strict "is newer"
 * should treat 0 as "unknown" rather than "equal" because null inputs
 * collapse to 0 silently.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareVersions(a, b) {
    const av = parseVersion(a);
    const bv = parseVersion(b);
    if (!av || !bv) return 0;
    for (let i = 0; i < Math.max(av.length, bv.length); i++) {
        const diff = (av[i] || 0) - (bv[i] || 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

/**
 * "Is a strictly newer than b?" — semver comparison with a sane
 * false-on-unparseable default. Use this for "is there an update?".
 */
export function isNewerVersion(a, b) {
    return compareVersions(a, b) > 0;
}
