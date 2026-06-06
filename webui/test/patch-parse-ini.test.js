/**
 * Tests for parseIni() — the ad-hoc INI parser used by the patch page
 * to decode `kptools -l` output.
 *
 * parseIni() is intentionally lenient (no quoting, no escaping) so
 * the tests focus on the behaviors it actually promises:
 *   - `[section]` headers open a new sub-object
 *   - `key=value` lines land in the current section (or top-level)
 *   - values may contain `=` (we split on the first `=`)
 *   - blank lines and `;` comments are skipped
 *   - whitespace around keys/values is trimmed
 */
import { describe, it, expect } from 'vitest';
import { parseIni } from '../page/patch.js';

describe('parseIni', () => {
    it('parses a flat key=value document with no sections', () => {
        const ini = parseIni('name=kpatch\nversion=0.6\n');
        expect(ini).toEqual({ name: 'kpatch', version: '0.6' });
    });

    it('groups keys under [section] headers and supports multiple sections', () => {
        const text = `
            [kernel]
            banner = 6.18-Linux
            patched = true

            [kpimg]
            version = 0xc06
            compile_time = 11:08:10 Dec 30 2025
        `;
        const ini = parseIni(text);
        expect(ini.kernel).toEqual({ banner: '6.18-Linux', patched: 'true' });
        expect(ini.kpimg.version).toBe('0xc06');
        expect(ini.kpimg.compile_time).toBe('11:08:10 Dec 30 2025');
    });

    it('preserves `=` characters inside values (split on the first =)', () => {
        // Common case: a URL or expression with multiple `=`.
        const ini = parseIni('download = https://x.example/a?b=1&c=2\n');
        expect(ini.download).toBe('https://x.example/a?b=1&c=2');
    });

    it('skips empty lines and `;` comment lines', () => {
        const text = `
            ; this is a comment
            name=foo

            ; another comment
            version=1
        `;
        const ini = parseIni(text);
        expect(ini).toEqual({ name: 'foo', version: '1' });
    });

    it('parses the real-world kptools output shape', () => {
        // Snippet modeled on the actual [kpimg] block produced by
        // `kptools -l -k <kpimg>`. Pin it down so a parser regression
        // breaks the patch page's metadata display.
        const text = [
            '[kpimg]',
            'version=0xc06',
            'compile_time=11:08:10 Dec 30 2025',
            'config=linux,release',
            '',
        ].join('\n');
        const ini = parseIni(text);
        expect(ini.kpimg).toEqual({
            version: '0xc06',
            compile_time: '11:08:10 Dec 30 2025',
            config: 'linux,release',
        });
    });
});
