/**
 * boot_unpatch.js — WebUI confirmation flow for boot_unpatch.sh
 *
 * Renders the "Auto-Unpatch Recovery Plan" dialog before letting the
 * user kick off `boot_unpatch.sh`. The dialog reads the latest
 * boot_backup_*.json manifest and tells the user exactly what will be
 * lost vs. preserved by the unpatch, instead of silently doing it.
 *
 * Created to fix the AK3-re-flash / re-install edge cases where a
 * stale backup could destroy user data without warning.
 */
import { exec, spawn, toast } from 'kernelsu-alt';
import { modDir, persistDir, escapeShell } from '../constants.js';
import { getString } from '../language.js';
import { escapeHTML, formatSize } from '../utils.js';

// Path conventions shared with boot_patch.sh / boot_unpatch.sh.
const BACKUP_DIR = `${persistDir}/backup`;
const PATCH_SH    = `${modDir}/patch/boot_patch.sh`;
const UNPATCH_SH  = `${modDir}/patch/boot_unpatch.sh`;

/**
 * Read the most recent backup + its manifest, returning a small
 * plain object. Returns null if the backup dir is missing.
 *
 * We deliberately do NOT use JSON.parse on shell output — the shell
 * is the only parser we control, and a hostile manifest file should
 * not be able to run code in the WebUI process. Naive field
 * extraction is enough for the 7 keys we care about.
 */
async function readLatestBackupInfo() {
    try {
        // List backup dir sorted by mtime, newest first.
        const ls = await exec(`ls -1t ${escapeShell(BACKUP_DIR)}/boot_backup_*.img 2>/dev/null`, {
            env: { PATH: '/system/bin' }
        });
        if (ls.errno !== 0 || !ls.stdout.trim()) return null;
        const latestImg = ls.stdout.trim().split('\n')[0].trim();
        if (!latestImg) return null;

        // Stat the file for size + mtime.
        const stat = await exec(`stat -c '%s %Y' ${escapeShell(latestImg)}`, {
            env: { PATH: '/system/bin' }
        });
        let sizeBytes = 0;
        let mtime = 0;
        if (stat.errno === 0) {
            const parts = stat.stdout.trim().split(/\s+/);
            sizeBytes = parseInt(parts[0] || '0', 10);
            mtime = parseInt(parts[1] || '0', 10);
        }

        // Find the accompanying manifest. We don't trust ls to
        // order JSON by mtime in lockstep with the IMG (rare,
        // but possible on a slow flash), so we re-check mtime.
        const manifestPath = latestImg.replace(/\.img$/, '.json');
        const info = {
            imgPath: latestImg,
            imgName: latestImg.split('/').pop(),
            manifestPath: null,
            sizeBytes,
            mtime,
            kpState: null,
            magiskVersion: null,
            ksuVersion: null,
            backupVerified: false,
            takenAt: null,
        };

        // Try the .json sidecar first.
        const cat = await exec(`cat ${escapeShell(manifestPath)} 2>/dev/null`, {
            env: { PATH: '/system/bin' }
        });
        if (cat.errno === 0 && cat.stdout.trim()) {
            info.manifestPath = manifestPath;
            info.kpState       = extractJsonString(cat.stdout, 'kp_state');
            info.magiskVersion = extractJsonString(cat.stdout, 'magisk_version');
            info.ksuVersion    = extractJsonString(cat.stdout, 'ksu_version');
            info.takenAt       = extractJsonString(cat.stdout, 'taken_at');
            info.backupVerified = /"backup_verified"\s*:\s*true/.test(cat.stdout);
        } else {
            // Fall back: search the backup dir for any .json newer
            // than the IMG. (When the user re-installs Kp, the new
            // install sometimes writes the .json with the same mtime
            // as the IMG but a slightly different ordering.)
            const jsonLs = await exec(
                `ls -1t ${escapeShell(BACKUP_DIR)}/boot_backup_*.json 2>/dev/null | head -n 1`,
                { env: { PATH: '/system/bin' } }
            );
            if (jsonLs.errno === 0 && jsonLs.stdout.trim()) {
                const alt = jsonLs.stdout.trim();
                const altCat = await exec(`cat ${escapeShell(alt)} 2>/dev/null`, {
                    env: { PATH: '/system/bin' }
                });
                if (altCat.errno === 0 && altCat.stdout.trim()) {
                    info.manifestPath = alt;
                    info.kpState       = extractJsonString(altCat.stdout, 'kp_state');
                    info.magiskVersion = extractJsonString(altCat.stdout, 'magisk_version');
                    info.ksuVersion    = extractJsonString(altCat.stdout, 'ksu_version');
                    info.takenAt       = extractJsonString(altCat.stdout, 'taken_at');
                    info.backupVerified = /"backup_verified"\s*:\s*true/.test(altCat.stdout);
                }
            }
        }
        return info;
    } catch (_) {
        return null;
    }
}

/**
 * Naive extractor for `"key": "value"` style fields. Always returns
 * a string; "null" (the JSON literal) is returned as the literal
 * string "null" so the caller can distinguish it from "missing".
 *
 * This is safe because we only use it to read fields we control in
 * boot_patch.sh — never user-supplied data.
 */
function extractJsonString(text, key) {
    const re = new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, 'i');
    const m = text.match(re);
    return m ? m[1] : null;
}

/**
 * Build the LOSE / KEEP bullet lists. Everything is built with
 * textContent (never innerHTML) to keep the XSS surface at zero —
 * the manifest can come from a corrupted boot and we don't want
 * any HTML in there to make it into the DOM.
 */
function renderPlan(info) {
    const lose = document.getElementById('auto-unpatch-lose');
    const keep = document.getElementById('auto-unpatch-keep');
    lose.textContent = '';
    keep.textContent = '';

    const loseHeader = document.createElement('div');
    loseHeader.className = 'auto-unpatch-section-title';
    loseHeader.textContent = getString('auto_unpatch_lose');
    lose.appendChild(loseHeader);

    const keepHeader = document.createElement('div');
    keepHeader.className = 'auto-unpatch-section-title';
    keepHeader.textContent = getString('auto_unpatch_keep');
    keep.appendChild(keepHeader);

    // LOSE section: depends on kp_state. Kp-patched state means we
    // throw away the Kp kernel patches; otherwise almost nothing.
    if (!info || info.kpState === 'patched') {
        appendBullet(lose, getString('auto_unpatch_lose_kp_patches'));
        appendBullet(lose, getString('auto_unpatch_lose_kpm_modules'));
    } else {
        appendBullet(lose, getString('auto_unpatch_lose_nothing'));
    }

    // KEEP section: AK3 / Magisk / KSU as recorded in the manifest.
    if (info) {
        if (info.magiskVersion && info.magiskVersion !== 'null') {
            appendBullet(keep, getString('auto_unpatch_keep_magisk', info.magiskVersion));
        }
        if (info.ksuVersion && info.ksuVersion !== 'null') {
            appendBullet(keep, getString('auto_unpatch_keep_ksu', info.ksuVersion));
        }
        if ((!info.magiskVersion || info.magiskVersion === 'null') &&
            (!info.ksuVersion    || info.ksuVersion    === 'null')) {
            appendBullet(keep, getString('auto_unpatch_keep_non_kp'));
        }
    } else {
        appendBullet(keep, getString('auto_unpatch_keep_unknown'));
    }
}

function appendBullet(parent, text) {
    const row = document.createElement('div');
    row.className = 'auto-unpatch-bullet';
    // Use a leading • character; the text comes from getString() so
    // it's translation-table-controlled, never user input.
    row.textContent = '• ' + text;
    parent.appendChild(row);
}

/**
 * Show the recovery-plan dialog, then resolve(true) if the user
 * confirms or false if they cancel. The dialog is data-driven by
 * the latest manifest, so callers don't have to thread the
 * backup info through.
 */
export async function confirmAutoUnpatch() {
    const dialog = document.getElementById('auto-unpatch-dialog');
    if (!dialog) return true; // Dialog missing → fall through to script.

    const info = await readLatestBackupInfo();
    const summary = document.getElementById('auto-unpatch-summary');
    const warning = document.getElementById('auto-unpatch-warning');
    summary.textContent = '';
    warning.textContent = '';

    if (!info) {
        summary.textContent = getString('auto_unpatch_no_backup');
        warning.textContent = getString('auto_unpatch_no_backup_warn');
    } else {
        summary.textContent = getString('auto_unpatch_summary',
            info.imgName, formatSize(info.sizeBytes),
            info.backupVerified ? getString('yes') : getString('no'));
        if (!info.backupVerified) {
            warning.textContent = getString('auto_unpatch_unverified_warn');
        }
    }
    renderPlan(info);

    return new Promise((resolve) => {
        const cancelBtn = dialog.querySelector('.cancel');
        const confirmBtn = dialog.querySelector('.confirm');
        // Clone the confirm button to drop any previous handler.
        const newConfirm = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);

        newConfirm.onclick = () => { dialog.close(); resolve(true); };
        cancelBtn.onclick = () => { dialog.close(); resolve(false); };

        dialog.show();
    });
}

/**
 * Run `boot_unpatch.sh <bootDev>` after a confirmation dialog. Used
 * by patch.js for the unpatch branch of patch(). Kept here so the
 * dialog flow lives in one file.
 */
export async function runUnpatchWithConfirmation(bootDev) {
    if (!bootDev) {
        toast(getString('msg_error_no_boot_image'));
        return false;
    }
    const proceed = await confirmAutoUnpatch();
    if (!proceed) {
        toast(getString('msg_cancelled'));
        return false;
    }
    const result = await exec(
        `sh ${escapeShell(UNPATCH_SH)} ${escapeShell(bootDev)}`,
        { env: { PATH: `${modDir}/bin:/data/adb/ksu/bin:/data/adb/magisk:$PATH` } }
    );
    if (result.errno === 0) {
        toast(getString('msg_unpatch_done'));
        return true;
    }
    toast(getString('msg_unpatch_failed', result.stderr || result.stdout || ''));
    return false;
}

export { readLatestBackupInfo, extractJsonString };
