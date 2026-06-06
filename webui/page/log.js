import { exec } from 'kernelsu-alt';
import { persistDir, modDir, escapeShell } from '../constants.js';
import { getString } from '../language.js';
import { setupPullToRefresh } from '../pull-to-refresh.js';

const LOG_PATH = `${persistDir}/service.log`;

async function refreshLog() {
    const container = document.getElementById('log-content');
    const emptyMsg = document.getElementById('log-empty-msg');

    container.textContent = '';
    emptyMsg.textContent = getString('status_loading');
    emptyMsg.classList.remove('hidden');

    try {
        const result = await exec(`tail -n 200 ${escapeShell(LOG_PATH)}`, { env: { PATH: `${modDir}/bin` } });
        if (result.errno === 0 && result.stdout.trim()) {
            container.textContent = result.stdout;
            emptyMsg.classList.add('hidden');
            container.scrollTop = container.scrollHeight;
        } else {
            emptyMsg.textContent = getString('msg_no_log');
        }
    } catch (_) {
        emptyMsg.textContent = getString('msg_error', '');
    }
}

export function initLogPage() {
    document.getElementById('log-refresh').onclick = refreshLog;

    setupPullToRefresh(document.querySelector('#log-page .page-content'), refreshLog);
}

export { refreshLog };
