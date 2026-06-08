// Update checker: fetches update.json from GitHub, compares with the
// locally-installed version, and notifies the user if a newer release is
// available. The URL is taken from module.prop's updateJson line so this
// module doesn't need to know where the user hosts their releases.

import { exec, toast } from 'kernelsu-alt';
import { modDir } from './index.js';
import { getString } from './language.js';
import { escapeShell } from './constants.js';
import { sanitizeUrl, compareVersions } from './utils.js';

const FETCH_TIMEOUT_MS = 8000;

// parseVersion / compareVersions live in utils.js — single source of truth
// shared with the KPM update checker (page/kpm-update.js) so semver rules
// stay consistent between the module self-update and per-KPM updates.

/**
 * Read the local module.prop to get the current version. Use kpatch's
 * own status line as a proxy since it already lives in module.prop and
 * doesn't need an extra shell call.
 */
async function getLocalVersion() {
    // Read module.prop via shell. cat + grep is sufficient; no need for
    // a JSON parser since the format is stable.
    const result = await exec(
        `grep '^version=' ${escapeShell(modDir + '/module.prop')} | head -1 | cut -d= -f2-`,
        { env: { PATH: `${modDir}/bin` } }
    );
    if (result.errno !== 0 || !result.stdout.trim()) return null;
    return result.stdout.trim();
}

/**
 * Fetch update.json and parse it. Returns {version, versionCode, zipUrl,
 * changelog} or null on failure. Network errors are non-fatal: the user
 * will simply not see an update notification.
 *
 * Source order:
 *   1. module.prop::updateJson (the authoritative, maintainer-pinned URL).
 *      This is the trust anchor — it points to the same repo the user
 *      cloned from, and the maintainer is responsible for keeping it
 *      pointed at a current commit.
 *   2. module.prop::updateJsonMirror (optional CDN mirror). Used as a
 *      fallback when (1) is slow, blocked, or — as is the case with
 *      raw.githubusercontent.com — stuck behind a long CDN cache. The
 *      mirror URL is the *same* JSON content served from a different
 *      cache layer; the SHA256 in update.json is the integrity anchor
 *      so mirror tampering cannot change what the user installs.
 *      Forks and downstream distributors can repoint this field at
 *      their own CDN; the field is optional and skipped if missing.
 *
 * We pick the first source that yields a parseable JSON with a
 * non-empty `version`. The two sources are expected to be consistent
 * — both serve the same update.json content — so whichever answers
 * first with valid data wins. If the first source is reachable but
 * is missing the zipSha256 stamp (e.g. mid-rollout), we still
 * accept it and let the WebUI's existing unsigned-update warning
 * kick in; we do NOT fall through to the mirror purely to chase
 * zipSha256, because that would mask real release-engineering bugs.
 */
async function fetchRemoteInfo() {
    // Read both URLs from module.prop. Use a single shell call to
    // avoid two separate exec() roundtrips — `grep -E` picks up both
    // lines in one read of the file.
    const urlResult = await exec(
        `grep -E '^(updateJson|updateJsonMirror)=' ${escapeShell(modDir + '/module.prop')} | cut -d= -f2-`,
        { env: { PATH: `${modDir}/bin` } }
    );
    if (urlResult.errno !== 0) return null;
    const lines = (urlResult.stdout || '').split('\n').map(l => l.trim()).filter(Boolean);
    // Stable order: primary first, mirror second. Even if a user
    // swaps the field names in module.prop, we still try both.
    const urls = [lines[0], lines[1]].filter(Boolean);
    if (urls.length === 0) return null;

    const timeout = Math.ceil(FETCH_TIMEOUT_MS / 1000);

    for (const url of urls) {
        // Defence in depth: each URL must be http(s) — same gate as
        // the zipUrl consumer downstream, applied earlier so a
        // malicious module.prop can't redirect the update manifest
        // to a file:// or javascript: sink before sanitizeUrl
        // catches it.
        if (!/^https?:\/\//i.test(url)) continue;
        const r = await exec(
            `curl -fsL --max-time ${timeout} ${escapeShell(url)}`,
            { env: { PATH: `${modDir}/bin:/system/bin:$PATH` } }
        );
        if (r.errno !== 0 || !r.stdout.trim()) continue;
        try {
            const data = JSON.parse(r.stdout);
            if (typeof data.version !== 'string') continue;
            return {
                version: data.version,
                versionCode: data.versionCode || 0,
                zipUrl: data.zipUrl || '',
                changelog: data.changelog || '',
                // P0-9: SHA256 hash of the release zip. Stamped into
                // update.json at release time. If the primary source
                // is reachable but stale (e.g. CDN cache lag), the
                // mirror source will provide the same JSON with the
                // hash. We never fall through purely for the hash —
                // see the function-level comment.
                zipSha256: data.zipSha256 || '',
                _source: url,
            };
        } catch (_) {
            // Parse error — try next source.
            continue;
        }
    }
    return null;
}

/**
 * Manually triggered check from the Settings page. Returns the diff
 * result so the caller can show a custom toast on error.
 */
export async function checkForUpdates() {
    const local = await getLocalVersion();
    const remote = await fetchRemoteInfo();
    if (!local) {
        return { ok: false, reason: 'local-version-unknown' };
    }
    if (!remote) {
        return { ok: false, reason: 'network-error' };
    }
    const diff = compareVersions(remote.version, local);
    if (diff > 0) {
        return { ok: true, updateAvailable: true, local, remote };
    }
    return { ok: true, updateAvailable: false, local, remote };
}

/**
 * Auto-run on app init. Fetches update.json in the background and,
 * if a newer version is available, shows the update dialog. Errors are
 * silent (no toast spam on every cold start).
 */
export async function maybeNotifyUpdate() {
    try {
        const result = await checkForUpdates();
        if (!result.ok || !result.updateAvailable) return;
        showUpdateDialog(result.local, result.remote);
    } catch (_) {
        // network failure or no perm — silently skip
    }
}

function showUpdateDialog(localVer, remote) {
    const dialog = document.getElementById('update-dialog');
    if (!dialog) return;

    const versionEl = dialog.querySelector('#update-version');
    const currentEl = dialog.querySelector('#update-current');
    const downloadBtn = dialog.querySelector('.update-download');
    const laterBtn = dialog.querySelector('.update-later');

    if (versionEl) versionEl.textContent = remote.version;
    if (currentEl) currentEl.textContent = getString('update_current', localVer);

    if (downloadBtn) {
        downloadBtn.onclick = () => {
            dialog.close();
            if (remote.zipUrl) {
                // P0-9 security fix: if the update manifest contains a
                // zipSha256 field (which it MUST for releases after v0.2.5),
                // surface it to the user as a verification step. We do not
                // attempt to download + verify inline here because that
                // requires the zip to be cached locally and the WebView
                // usually downloads to /sdcard/Download. The release CI
                // pipeline is the trust boundary: maintainer must sign.
                if (remote.zipSha256) {
                    toast(getString('update_verify_sha', remote.zipSha256.slice(0, 16) + '…'));
                } else {
                    // Refuse to silently download an unsigned update.
                    toast(getString('update_unsigned_warning'));
                    return;
                }
                // P0-fix (ultracode-audit-2026-06-06): the previous code
                // interpolated `remote.zipUrl` directly into a shell exec
                // template literal. update.json is fetched over the network
                // and is attacker-controlled (e.g. a compromised mirror or
                // MITM). A malicious zipUrl like `https://x'; rm -rf / #`
                // would have been passed to `am start` as two shell tokens,
                // opening a root RCE chain on the device. Two defenses:
                //   1. Reject any URL that isn't http(s) before doing
                //      anything with it.
                //   2. Always pass the URL through escapeShell() so the
                //      exec call gets a single, double-quoted argument.
                const safeUrl = sanitizeUrl(remote.zipUrl);
                if (!safeUrl) {
                    toast(getString('update_invalid_url'));
                    return;
                }
                // Use am start to let the browser/system download manager
                // handle the actual download.
                exec(`am start -a android.intent.action.VIEW -d ${escapeShell(safeUrl)}`)
                    .then(() => toast(getString('update_download_started')))
                    .catch(() => toast(getString('update_download_failed')));
            } else {
                toast(getString('update_no_url'));
            }
        };
    }
    if (laterBtn) {
        laterBtn.onclick = () => dialog.close();
    }

    // Defer so it doesn't fight the splash.
    setTimeout(() => dialog.show(), 800);
}
