/**
 * Shared manifest schema + AK3/Magisk/KSU detection helpers.
 *
 * The shell-side `detect_root_chain()` in module/patch/boot_patch.sh
 * is the authoritative writer of the JSON manifest. This module is
 * the JS-side reader/parser used by the WebUI to display the recovery
 * plan before the user runs auto_unpatch.
 *
 * The two implementations share a contract (field names + value
 * shapes) but are otherwise independent — the shell one writes
 * JSON, the JS one reads it. ak3-recovery.test.js pins down the
 * contract.
 */

// Schema version: bump when the on-disk format changes in a way that
// would require the WebUI to be re-deployed alongside the shell.
export const MANIFEST_VERSION = 1;

// Required top-level fields. Optional fields are listed separately.
export const REQUIRED_MANIFEST_FIELDS = [
    'boot_image',
    'taken_at',
    'kp_state',
    'magisk_version',
    'ksu_version',
    'kpimg_size',
    'kernel_cmdline_hint',
    'original_sha256',
    'backup_verified',
];

// Fields the WebUI consults to render the recovery plan.
export const OPTIONAL_MANIFEST_FIELDS = [
    // (none yet — keep this as the extension point)
];

// Possible values of `kp_state`. The WebUI maps each to a different
// "what will be preserved" bullet list.
export const KP_STATES = Object.freeze({
    PATCHED: 'patched',
    STOCK:   'stock',
    AK3:     'ak3',
    MAGISK:  'magisk',
    KSU:     'ksu',
    APATCH:  'apatch',
});

/**
 * Naive extractor for `"key": "value"` style fields. Returns
 * `null` if the field is absent, the literal string "null" if
 * the value is the JSON null literal, and the string otherwise.
 *
 * We deliberately do NOT use JSON.parse on shell output — the
 * manifest can come from a corrupted boot and we don't want any
 * hostile content to be able to run code in the WebUI process.
 *
 * @param {string} text   Manifest body (full file contents).
 * @param {string} key    Field name to look up.
 * @returns {string|null} The field value, or null if missing.
 */
export function extractJsonString(text, key) {
    if (typeof text !== 'string' || !key) return null;
    // Allow optional whitespace between tokens; the manifest writer
    // uses pretty-printed JSON, but external tools might compact it.
    const re = new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`);
    const m = text.match(re);
    return m ? m[1] : null;
}

/**
 * Same as extractJsonString but for boolean fields. Returns
 * `true`/`false` or `null` if missing.
 */
export function extractJsonBool(text, key) {
    if (typeof text !== 'string' || !key) return null;
    const re = new RegExp(`"${key}"\\s*:\\s*(true|false)`);
    const m = text.match(re);
    return m ? (m[1] === 'true') : null;
}

/**
 * Same as extractJsonString but for numeric fields. Returns the
 * number or `null` if missing or unparseable.
 */
export function extractJsonNumber(text, key) {
    if (typeof text !== 'string' || !key) return null;
    const re = new RegExp(`"${key}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, 'i');
    const m = text.match(re);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
}

/**
 * Validate a manifest body against the required-schema contract.
 * Returns an array of error strings (empty array means the
 * manifest is valid). The WebUI uses this to decide whether to
 * show "manifest not found / corrupt" UI states.
 *
 * @param {string} text Manifest body.
 * @returns {string[]} List of human-readable errors. Empty = OK.
 */
export function validateManifestSchema(text) {
    const errors = [];
    if (typeof text !== 'string' || !text.trim()) {
        return ['manifest is empty or not a string'];
    }

    for (const field of REQUIRED_MANIFEST_FIELDS) {
        // For string-valued fields we accept the JSON null literal
        // as "absent" (matches the shell writer's convention).
        if (field === 'kpimg_size') {
            const n = extractJsonNumber(text, field);
            if (n === null) {
                errors.push(`missing or non-numeric required field: ${field}`);
            }
        } else if (field === 'backup_verified') {
            const b = extractJsonBool(text, field);
            if (b === null) {
                errors.push(`missing or non-boolean required field: ${field}`);
            }
        } else {
            const v = extractJsonString(text, field);
            if (v === null) {
                errors.push(`missing required field: ${field}`);
            }
        }
    }

    // kp_state, if present and not "null", must be one of the
    // known values. We accept "null" because shell writer uses
    // it to mark "this state was not detected at backup time".
    const ks = extractJsonString(text, 'kp_state');
    if (ks && ks !== 'null' && !Object.values(KP_STATES).includes(ks)) {
        errors.push(`unknown kp_state value: ${ks}`);
    }

    // ISO-8601-ish timestamp format check: YYYY-MM-DDTHH:MM:SSZ.
    const ta = extractJsonString(text, 'taken_at');
    if (ta && ta !== 'null' && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(ta)) {
        errors.push(`taken_at is not an ISO-8601 UTC timestamp: ${ta}`);
    }

    return errors;
}

/**
 * Decide the kp_state for the current device, given a set of
 * detection signals. The shell-side `detect_root_chain()` runs
 * the same decision tree but on the live device; this JS
 * version is used by the tests to pin down the expected
 * outputs for each input combination.
 *
 * @param {object} sigs Detection signals:
 *   - kptoolsPatched: boolean   (kptools -i kernel -l says patched=true)
 *   - hasMagiskDir:  boolean    (/data/adb/magisk exists)
 *   - magiskVersion: string|null
 *   - hasKsuDir:     boolean    (/data/adb/ksu exists)
 *   - ksuVersion:    string|null
 *   - hasApatchDir:  boolean    (/data/adb/ap exists)
 * @returns {string} One of KP_STATES.
 */
export function decideKpState(sigs) {
    const s = sigs || {};
    // Precedence: APatch > Kp-patched > Magisk > KSU > patched (raw).
    // A patched kernel with Magisk/KSU underneath is still "patched"
    // — the user is running Kp over a rooted boot. APatch is its
    // own thing (it patches the kernel too but with a different
    // loader) and takes precedence over Kp.
    if (s.hasApatchDir) return KP_STATES.APATCH;
    if (s.kptoolsPatched) return KP_STATES.PATCHED;
    if (s.hasMagiskDir) return KP_STATES.MAGISK;
    if (s.hasKsuDir) return KP_STATES.KSU;
    return KP_STATES.STOCK;
}

/**
 * Decide whether to take a fresh backup, given the new boot
 * image's SHA256 and the most recent manifest (if any).
 *
 * This mirrors `is_boot_modified_externally()` in
 * module/patch/boot_patch.sh. The shell version uses `return N`
 * codes (0/1/2) because POSIX sh doesn't have a clean boolean;
 * this JS version returns a string the WebUI/tests can switch on.
 *
 * @param {object} args
 *   - currentSha:     string  SHA256 of the current boot image.
 *   - lastManifestSha: string|null  SHA256 from the latest manifest.
 *   - lastKpState:    string|null  kp_state from the latest manifest.
 *   - forceRebackup:  boolean  KP_REBACKUP=1 was set by the WebUI.
 * @returns {'rebackup_recommended'|'skip'|'no_prior_backup'}
 */
export function decideRebackup({ currentSha, lastManifestSha, lastKpState, forceRebackup } = {}) {
    if (forceRebackup === true) return 'rebackup_recommended';
    if (!lastManifestSha || !currentSha) return 'no_prior_backup';
    if (currentSha !== lastManifestSha) {
        // Only re-backup if the last known state was "patched"
        // (the user was running Kp). Re-flashing AK3 over a stock
        // boot is a no-op for us.
        if (lastKpState === KP_STATES.PATCHED) {
            return 'rebackup_recommended';
        }
        return 'skip';
    }
    return 'skip';
}
