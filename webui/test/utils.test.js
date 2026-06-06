/**
 * Tests for the shared utility helpers in webui/utils.js.
 *
 * Covers the four exported functions: escapeHTML, sanitizeFilename,
 * sanitizeUrl, formatSize. Each test pins down one or two
 * behaviorally important properties (XSS escaping, empty-input
 * fallback, size-class boundaries, protocol allowlist) so a future
 * refactor that loosens a guard fails loudly.
 */
import { describe, it, expect } from 'vitest';
import {
    escapeHTML,
    sanitizeFilename,
    sanitizeUrl,
    formatSize,
} from '../utils.js';

describe('escapeHTML', () => {
    it('escapes the five HTML-significant characters', () => {
        const payload = `<script>alert("xss'&")</script>`;
        const out = escapeHTML(payload);
        // Order matters: & must be escaped first so the other entities
        // we introduce don't get double-encoded.
        expect(out.startsWith('&lt;script&gt;')).toBe(true);
        expect(out).toContain('&quot;');
        expect(out).toContain('&#39;');
        expect(out).toContain('&amp;');
        // No raw < > " ' should remain in the output.
        expect(out).not.toMatch(/[<>"]/);
    });

    it('returns empty string for null and undefined', () => {
        expect(escapeHTML(null)).toBe('');
        expect(escapeHTML(undefined)).toBe('');
    });
});

describe('sanitizeFilename', () => {
    it('strips path-traversal and shell metacharacters', () => {
        // "Bad" input that would let a caller escape a quoted shell arg.
        const evil = '../../etc/passwd; rm -rf $HOME`';
        const out = sanitizeFilename(evil);
        // Only [a-zA-Z0-9._-] survive; slashes, spaces, semicolons, etc.
        // are all replaced. The string should contain no slashes or spaces.
        expect(out).not.toMatch(/[\/\\\s;`$]/);
    });

    it('falls back to "unnamed" for empty / all-stripped input', () => {
        expect(sanitizeFilename('')).toBe('unnamed');
        expect(sanitizeFilename('   ')).toBe('unnamed');
        // After stripping non-allowed chars, nothing is left.
        expect(sanitizeFilename(';;;')).toBe('unnamed');
    });
});

describe('sanitizeUrl', () => {
    it('accepts http and https URLs and normalizes them', () => {
        const http = sanitizeUrl('http://example.com/path');
        expect(http).toBe('http://example.com/path');
        const https = sanitizeUrl('HTTPS://Example.COM/x');
        // URL constructor lowercases the host; we expect the normalized href.
        expect(https).toBe('https://example.com/x');
    });

    it('rejects non-http(s) protocols and malformed URLs', () => {
        expect(sanitizeUrl('javascript:alert(1)')).toBeNull();
        expect(sanitizeUrl('file:///etc/passwd')).toBeNull();
        expect(sanitizeUrl('data:text/html,<script>')).toBeNull();
        expect(sanitizeUrl('not a url')).toBeNull();
        expect(sanitizeUrl('')).toBeNull();
        expect(sanitizeUrl(null)).toBeNull();
    });
});

describe('formatSize', () => {
    it('formats across the B / KB / MB / GB boundaries', () => {
        // Just under 1 KB → bytes.
        expect(formatSize(512)).toBe('512 B');
        // 1 KB → one decimal.
        expect(formatSize(1024)).toBe('1.0 KB');
        // 1.5 MB → one decimal in MB.
        expect(formatSize(Math.floor(1.5 * 1024 * 1024))).toBe('1.5 MB');
        // 2 GB → two decimals.
        expect(formatSize(2 * 1024 * 1024 * 1024)).toBe('2.00 GB');
    });

    it('returns "? B" for null, undefined, and NaN', () => {
        // The helper is defensive against missing / bad input from
        // shell output, so lock down the fallback.
        expect(formatSize(null)).toBe('? B');
        expect(formatSize(undefined)).toBe('? B');
        expect(formatSize(NaN)).toBe('? B');
    });
});
