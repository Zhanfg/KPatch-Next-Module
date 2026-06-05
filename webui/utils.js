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
