// Shared constants and pure utilities — all page modules import from here
// This breaks circular dependency with index.js
import { exec, toast } from 'kernelsu-alt';
import { getString } from './language.js';

export const modDir = '/data/adb/modules/KPatch-Next';
export const persistDir = '/data/adb/kp-next';

export let MAX_CHUNK_SIZE = 96 * 1024;

export function escapeShell(cmd) {
    if (cmd === '' || cmd === null || cmd === undefined) return '""';
    return '"' + cmd.replace(/[\\"$`'[\]]/g, '\\$&') + '"';
}

export function linkRedirect(link) {
    toast(getString('msg_redirecting_to', link));
    setTimeout(() => {
        exec(`am start -a android.intent.action.VIEW -d ${link}`)
            .then(({ errno }) => {
                if (errno !== 0) {
                    toast(getString('msg_failed_open_link'));
                    window.open(link, '_blank');
                }
            });
    }, 100);
}

export function getMaxChunkSize() {
    exec('getconf ARG_MAX').then((result) => {
        try {
            const max_arg = parseInt(result.stdout.trim());
            if (!isNaN(max_arg)) {
                MAX_CHUNK_SIZE = Math.floor(max_arg * 0.75) - 1024;
            }
        } catch (e) { }
    });
}
