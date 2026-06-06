/**
 * Tests for the AK3-recovery hardening features (Fixes 1-3).
 *
 * These tests verify:
 *  1. The JSON manifest written by boot_patch.sh's detect_root_chain()
 *     has all required fields and is valid JSON.
 *  2. Detection logic: given fake directory presence (Magisk dir,
 *     KSU module, etc.) the computed kp_state is correct.
 *  3. Re-backup decision: when the boot image SHA256 differs from
 *     the manifest, the function returns "rebackup_recommended".
 *
 * The shell-side detect_root_chain() is the authority for *writing*
 * the manifest. These tests exercise the *reading* side (the
 * contract parser in ak3-recovery.js) and the pure-JS detection
 * logic that mirrors the shell's decision tree.
 */
import { describe, it, expect } from 'vitest';
import {
    extractJsonString,
    extractJsonBool,
    extractJsonNumber,
    validateManifestSchema,
    decideKpState,
    decideRebackup,
    KP_STATES,
    REQUIRED_MANIFEST_FIELDS,
} from '../ak3-recovery.js';

// ---------------------------------------------------------------------------
// Fixtures — each mirrors the output of detect_root_chain() on a device
// running a particular root configuration.
// ---------------------------------------------------------------------------

const FIXTURES = {
    // Kp-patched kernel over stock boot (typical first-patch scenario).
    patchedStock: `{
  "boot_image": "boot_backup_2606060800.img",
  "taken_at": "2026-06-06T08:00:00Z",
  "kp_state": "patched",
  "magisk_version": "null",
  "ksu_version": "null",
  "kpimg_size": 49152,
  "kernel_cmdline_hint": "unknown",
  "original_sha256": "abc123def456",
  "backup_verified": true
}`,

    // Kp-patched kernel over Magisk (AK3 user scenario).
    patchedMagisk: `{
  "boot_image": "boot_backup_2606060800.img",
  "taken_at": "2026-06-06T08:00:00Z",
  "kp_state": "magisk",
  "magisk_version": "27.0",
  "ksu_version": "null",
  "kpimg_size": 49152,
  "kernel_cmdline_hint": "green",
  "original_sha256": "abc123def456",
  "backup_verified": true
}`,

    // KSU-only (no Kp, KSU root manager present).
    ksuOnly: `{
  "boot_image": "boot_backup_2606060800.img",
  "taken_at": "2026-06-06T08:00:00Z",
  "kp_state": "ksu",
  "magisk_version": "null",
  "ksu_version": "2.0.1",
  "kpimg_size": 65536,
  "kernel_cmdline_hint": "green",
  "original_sha256": "deadbeef0123",
  "backup_verified": false
}`,

    // Compact (no whitespace) — simulates a compacted writer.
    compact: `{"boot_image":"boot_backup_2606060800.img","taken_at":"2026-06-06T08:00:00Z","kp_state":"patched","magisk_version":"null","ksu_version":"null","kpimg_size":49152,"kernel_cmdline_hint":"unknown","original_sha256":"abc123","backup_verified":false}`,
};

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

describe('validateManifestSchema', () => {
    it('accepts a fully valid patchedStock manifest', () => {
        const errors = validateManifestSchema(FIXTURES.patchedStock);
        expect(errors).toEqual([]);
    });

    it('accepts a valid patchedMagisk manifest', () => {
        const errors = validateManifestSchema(FIXTURES.patchedMagisk);
        expect(errors).toEqual([]);
    });

    it('accepts a valid ksuOnly manifest', () => {
        const errors = validateManifestSchema(FIXTURES.ksuOnly);
        expect(errors).toEqual([]);
    });

    it('accepts a compacted manifest (no whitespace)', () => {
        const errors = validateManifestSchema(FIXTURES.compact);
        expect(errors).toEqual([]);
    });

    it('rejects an empty string', () => {
        const errors = validateManifestSchema('');
        expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects null / undefined', () => {
        expect(validateManifestSchema(null).length).toBeGreaterThan(0);
        expect(validateManifestSchema(undefined).length).toBeGreaterThan(0);
    });

    it('lists every missing required field by name', () => {
        // Empty object (not valid JSON) should still produce per-field errors.
        const errors = validateManifestSchema('{}');
        expect(errors).toContain('missing required field: boot_image');
        expect(errors).toContain('missing required field: taken_at');
        expect(errors).toContain('missing required field: kp_state');
        expect(errors).toContain('missing or non-numeric required field: kpimg_size');
        expect(errors).toContain('missing or non-boolean required field: backup_verified');
    });

    it('rejects a non-ISO-8601 timestamp', () => {
        const bad = `{
  "boot_image": "x.img",
  "taken_at": "June 6 2026",
  "kp_state": "patched",
  "magisk_version": "null",
  "ksu_version": "null",
  "kpimg_size": 1234,
  "kernel_cmdline_hint": "unknown",
  "original_sha256": "abc",
  "backup_verified": false
}`;
        const errors = validateManifestSchema(bad);
        expect(errors.some(e => e.includes('not an ISO-8601'))).toBe(true);
    });

    it('rejects an unknown kp_state value', () => {
        const bad = `{
  "boot_image": "x.img",
  "taken_at": "2026-06-06T08:00:00Z",
  "kp_state": "totally_invalid",
  "magisk_version": "null",
  "ksu_version": "null",
  "kpimg_size": 1234,
  "kernel_cmdline_hint": "unknown",
  "original_sha256": "abc",
  "backup_verified": false
}`;
        const errors = validateManifestSchema(bad);
        expect(errors.some(e => e.includes('unknown kp_state'))).toBe(true);
    });

    it('has exactly the 9 required fields in REQUIRED_MANIFEST_FIELDS', () => {
        expect(REQUIRED_MANIFEST_FIELDS).toHaveLength(9);
    });
});

// ---------------------------------------------------------------------------
// extractJsonString / extractJsonBool / extractJsonNumber
// ---------------------------------------------------------------------------

describe('extractJsonString', () => {
    it('extracts a normal string value', () => {
        expect(extractJsonString(FIXTURES.patchedMagisk, 'kp_state')).toBe('magisk');
    });

    it('returns the literal string "null" for JSON null values', () => {
        expect(extractJsonString(FIXTURES.patchedMagisk, 'ksu_version')).toBe('null');
    });

    it('returns null for a missing field', () => {
        expect(extractJsonString(FIXTURES.patchedStock, 'nonexistent')).toBeNull();
    });

    it('returns null for null/undefined input', () => {
        expect(extractJsonString(null, 'kp_state')).toBeNull();
        expect(extractJsonString(undefined, 'kp_state')).toBeNull();
    });
});

describe('extractJsonBool', () => {
    it('returns true when the field is true', () => {
        expect(extractJsonBool(FIXTURES.patchedStock, 'backup_verified')).toBe(true);
    });

    it('returns false when the field is false', () => {
        expect(extractJsonBool(FIXTURES.ksuOnly, 'backup_verified')).toBe(false);
    });

    it('returns null for a missing field', () => {
        expect(extractJsonBool(FIXTURES.patchedStock, 'nonexistent')).toBeNull();
    });
});

describe('extractJsonNumber', () => {
    it('extracts kpimg_size as a number', () => {
        expect(extractJsonNumber(FIXTURES.patchedStock, 'kpimg_size')).toBe(49152);
    });

    it('returns null for a missing field', () => {
        expect(extractJsonNumber(FIXTURES.patchedStock, 'nonexistent')).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// decideKpState — the pure-JS mirror of detect_root_chain() logic
// ---------------------------------------------------------------------------

describe('decideKpState', () => {
    it('returns "patched" when kptools reports the kernel as patched=true', () => {
        expect(decideKpState({
            kptoolsPatched: true,
            hasMagiskDir: false,
            magiskVersion: null,
            hasKsuDir: false,
            ksuVersion: null,
            hasApatchDir: false,
        })).toBe(KP_STATES.PATCHED);
    });

    it('returns "magisk" when /data/adb/magisk exists (and kernel is not Kp-patched)', () => {
        expect(decideKpState({
            kptoolsPatched: false,
            hasMagiskDir: true,
            magiskVersion: '27.0',
            hasKsuDir: false,
            ksuVersion: null,
            hasApatchDir: false,
        })).toBe(KP_STATES.MAGISK);
    });

    it('returns "ksu" when /data/adb/ksu exists', () => {
        expect(decideKpState({
            kptoolsPatched: false,
            hasMagiskDir: false,
            magiskVersion: null,
            hasKsuDir: true,
            ksuVersion: '2.0.1',
            hasApatchDir: false,
        })).toBe(KP_STATES.KSU);
    });

    it('returns "apatch" when /data/adb/ap exists', () => {
        expect(decideKpState({
            kptoolsPatched: false,
            hasMagiskDir: false,
            magiskVersion: null,
            hasKsuDir: false,
            ksuVersion: null,
            hasApatchDir: true,
        })).toBe(KP_STATES.APATCH);
    });

    it('gives apatch higher priority than magisk even when both are present', () => {
        expect(decideKpState({
            kptoolsPatched: false,
            hasMagiskDir: true,
            magiskVersion: '27.0',
            hasKsuDir: false,
            ksuVersion: null,
            hasApatchDir: true,
        })).toBe(KP_STATES.APATCH);
    });

    it('returns "stock" when no root markers are detected', () => {
        expect(decideKpState({
            kptoolsPatched: false,
            hasMagiskDir: false,
            magiskVersion: null,
            hasKsuDir: false,
            ksuVersion: null,
            hasApatchDir: false,
        })).toBe(KP_STATES.STOCK);
    });

    it('handles null/undefined sigs gracefully', () => {
        expect(decideKpState(null)).toBe(KP_STATES.STOCK);
        expect(decideKpState(undefined)).toBe(KP_STATES.STOCK);
        expect(decideKpState({})).toBe(KP_STATES.STOCK);
    });
});

// ---------------------------------------------------------------------------
// decideRebackup — the pure-JS mirror of is_boot_modified_externally()
// ---------------------------------------------------------------------------

describe('decideRebackup', () => {
    it('returns "rebackup_recommended" when forceRebackup=true', () => {
        expect(decideRebackup({ forceRebackup: true }))
            .toBe('rebackup_recommended');
    });

    it('returns "skip" when the SHA matches the manifest (boot unchanged)', () => {
        expect(decideRebackup({
            currentSha: 'abc123def456',
            lastManifestSha: 'abc123def456',
            lastKpState: 'patched',
            forceRebackup: false,
        })).toBe('skip');
    });

    it('returns "rebackup_recommended" when SHA differs and last kp_state is "patched"', () => {
        // The user was running Kp (patched=true), re-flashed AK3 (SHA changed),
        // and the old backup is now stale.
        expect(decideRebackup({
            currentSha: 'newsha789',
            lastManifestSha: 'oldsha123',
            lastKpState: 'patched',
            forceRebackup: false,
        })).toBe('rebackup_recommended');
    });

    it('returns "skip" when SHA differs but last kp_state is NOT "patched"', () => {
        // The backup recorded the boot as already AK3-patched. The user
        // flashed a newer AK3 — but we don't need to re-backup the
        // boot for ourselves since Kp was never running on it.
        expect(decideRebackup({
            currentSha: 'newsha789',
            lastManifestSha: 'oldsha123',
            lastKpState: 'magisk',
            forceRebackup: false,
        })).toBe('skip');
    });

    it('returns "no_prior_backup" when no manifest SHA is available', () => {
        expect(decideRebackup({
            currentSha: 'newsha789',
            lastManifestSha: null,
            lastKpState: null,
            forceRebackup: false,
        })).toBe('no_prior_backup');
    });

    it('returns "no_prior_backup" when currentSha is missing', () => {
        expect(decideRebackup({
            currentSha: null,
            lastManifestSha: 'oldsha123',
            lastKpState: 'patched',
            forceRebackup: false,
        })).toBe('no_prior_backup');
    });

    it('returns "no_prior_backup" when no args are provided', () => {
        expect(decideRebackup()).toBe('no_prior_backup');
        expect(decideRebackup({})).toBe('no_prior_backup');
    });

    it('forceRebackup=true overrides missing SHA', () => {
        expect(decideRebackup({
            currentSha: null,
            lastManifestSha: null,
            lastKpState: null,
            forceRebackup: true,
        })).toBe('rebackup_recommended');
    });
});

// ---------------------------------------------------------------------------
// KP_STATES constants
// ---------------------------------------------------------------------------

describe('KP_STATES constants', () => {
    it('includes exactly the five required values', () => {
        expect(Object.values(KP_STATES).sort()).toEqual(
            ['ak3', 'apatch', 'ksu', 'magisk', 'patched', 'stock'].sort()
        );
    });
});
