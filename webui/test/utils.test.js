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
    parseVersion,
    compareVersions,
    isNewerVersion,
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

// ---------------------------------------------------------------------------
// semver helpers — added with the APM-style KPM update flow (page/kpm-
// update.js). Pin down the corner cases that bit the first draft:
//   * 1.10.0 must read as newer than 1.9.0 (lexicographic gotcha)
//   * 1.0.0 must read as newer than 1.0.0-rc1 (final > pre of same X.Y.Z)
//   * 1.0.0-rc2 must read as newer than 1.0.0-rc1 (numeric pre suffix)
//   * Malformed input must NOT throw — diffInstalledVsRepo() relies
//     on the helpers being non-fatal for partial catalog data.
// ---------------------------------------------------------------------------

describe('parseVersion', () => {
    it('parses a clean semver triple', () => {
        const p = parseVersion('1.2.3');
        expect(p).toEqual([1, 2, 3, 1, 4, 0]);
    });

    it('strips an optional leading v', () => {
        expect(parseVersion('v0.2.4')).toEqual([0, 2, 4, 1, 4, 0]);
    });

    it('extracts the numeric suffix from pre-release tags', () => {
        expect(parseVersion('1.0.0-rc1')).toEqual([1, 0, 0, 0, 4, 1]);
        expect(parseVersion('1.0.0-beta.2')).toEqual([1, 0, 0, 0, 3, 2]);
    });

    it('returns null for null / undefined / malformed input', () => {
        expect(parseVersion(null)).toBeNull();
        expect(parseVersion(undefined)).toBeNull();
        expect(parseVersion('')).toBeNull();
        expect(parseVersion('not-a-version')).toBeNull();
    });
});

describe('isNewerVersion', () => {
    // Each row pins one behavioural property from the regression
    // log so a future refactor that loosens ordering fails loudly.
    const cases = [
        // patch / minor / major bumps
        ['v0.2.5', 'v0.2.4', true,  'patch bump'],
        ['v0.2.4', 'v0.2.5', false, 'patch bump reverse'],
        ['1.10.0', '1.9.0',  true,  'minor 1.9 -> 1.10 (lexicographic gotcha)'],
        ['1.9.0',  '1.10.0', false, 'minor 1.10 -> 1.9 (reverse)'],
        ['2.0.0',  '1.99.99', true, 'major bump'],
        // pre-release ordering
        ['1.0.0',        '1.0.0-rc1',    true,  'final > pre of same X.Y.Z'],
        ['1.0.0-rc1',    '1.0.0',        false, 'pre < final of same X.Y.Z'],
        ['1.0.0-rc2',    '1.0.0-rc1',    true,  'rc2 > rc1'],
        ['1.0.0-rc1',    '1.0.0-rc2',    false, 'rc1 < rc2'],
        ['1.0.0-rc1',    '1.0.0-beta1',  true,  'rc > beta'],
        ['1.0.0-beta2',  '1.0.0-beta1',  true,  'beta2 > beta1'],
        ['1.0.0-alpha1', '1.0.0-beta1',  false, 'alpha < beta'],
        // equality & null safety
        ['1.0.0', '1.0.0', false, 'equal versions are not "newer"'],
        [null,    '1.0.0', false, 'null safe — never throws'],
    ];

    for (const [a, b, expected, note] of cases) {
        it(`${note}: isNewer(${JSON.stringify(a)}, ${JSON.stringify(b)}) === ${expected}`, () => {
            expect(isNewerVersion(a, b)).toBe(expected);
        });
    }

    it('compareVersions returns the sign expected by isNewerVersion', () => {
        // Spot-check that the public surface and the low-level compare
        // agree on direction, since diffInstalledVsRepo uses the raw
        // sign and isNewerVersion wraps it.
        expect(Math.sign(compareVersions('v0.2.5', 'v0.2.4'))).toBe(1);
        expect(Math.sign(compareVersions('v0.2.4', 'v0.2.5'))).toBe(-1);
        expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    });
});
