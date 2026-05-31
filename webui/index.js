import '@material/web/all.js';
import { exec, toast } from 'kernelsu-alt';
import { setupRoute } from './route.js';
import { getString, loadTranslations } from './language.js';
import * as patchModule from './page/patch.js';
import * as kpmModule from './page/kpm.js';
import * as excludeModule from './page/exclude.js';
import * as logModule from './page/log.js';
import * as backupModule from './page/backup.js';
import * as repoModule from './page/kpm_repo.js';

export const modDir = '/data/adb/modules/KPatch-Next';
export const persistDir = '/data/adb/kp-next';

export let MAX_CHUNK_SIZE = 96 * 1024;

async function updateStatus() {
    const version = await patchModule.getInstalledVersion();
    const versionText = document.getElementById('version');
    const notInstalled = document.getElementById('not-installed');
    const working = document.getElementById('working');
    const installedOnly = document.querySelectorAll('.installed-only');
    if (version) {
        versionText.textContent = version;
        kpmModule.refreshKpmList();
        initRehook();
        installedOnly.forEach(el => el.removeAttribute('hidden'));
    } else {
        installedOnly.forEach(el => el.setAttribute('hidden', ''));
    }
    notInstalled.classList.toggle('hidden', version);
    working.classList.toggle('hidden', !version);
}

export function escapeShell(cmd) {
    if (cmd === '' || cmd === null || cmd === undefined) return '""';
    return '"' + cmd.replace(/[\\"$`'[\]]/g, '\\$&') + '"';
}

export async function initInfo() {
    const result = await exec('uname -r && getprop ro.build.version.release && getprop ro.build.fingerprint && getenforce');
    if (import.meta.env.DEV) { // vite debug
        result.stdout = '6.18.2-linux\n16\nLinuxPC\nEnforcing';
    }
    const info = result.stdout.trim().split('\n');
    document.getElementById('kernel-release').textContent = info[0];
    document.getElementById('system').textContent = info[1];
    document.getElementById('fingerprint').textContent = info[2];
    document.getElementById('selinux').textContent = info[3];
}

async function reboot(reason = "") {
    if (reason === "recovery") {
        // KEYCODE_POWER = 26, hide incorrect "Factory data reset" message
        await exec("/system/bin/input keyevent 26");
    }
    exec(`/system/bin/svc power reboot ${reason} || /system/bin/reboot ${reason}`);
}

async function initRehook() {
    const rehook = document.getElementById('rehook');
    const rehookRipple = rehook.querySelector('md-ripple');
    const rehookSwitch = rehook.querySelector('md-switch');
    const isEnabled = await updateRehookStatus();
    if (isEnabled === null) {
        rehookRipple.disabled = true;
        rehookSwitch.disabled = true;
        return;
    }
    rehookSwitch.addEventListener('change', () => {
        setRehookMode(rehookSwitch.selected);
    });
}

async function updateRehookStatus() {
    const rehook = document.getElementById('rehook');
    const rehookSwitch = rehook.querySelector('md-switch');

    let isEnabled = null;

    const result = await exec(`kpatch rehook_status`, { env: { PATH: `${modDir}/bin` } });
    if (result.errno === 0) {
        const mode = result.stdout.split(':')[1].trim();
        if (mode === 'enabled') {
            isEnabled = true;
        } else if (mode === 'disabled') {
            isEnabled = false;
        }
        rehookSwitch.selected = isEnabled;
    }

    return isEnabled;
}

function setRehookMode(isEnable) {
    const mode = isEnable ? "enable" : "disable";
    exec(`
        kpatch rehook ${mode} && echo ${mode} > ${persistDir}/rehook && sh "${modDir}/status.sh"`,
        { env: { PATH: `${modDir}/bin:$PATH` } }
    ).then((result) => {
        if (result.errno !== 0) {
            toast(getString('msg_error', result.stderr));
            return;
        }
        updateRehookStatus();
    })
}

async function initBinarySource() {
    const sourceItem = document.getElementById('binary-source');
    const sourceDetail = document.getElementById('current-source');
    const sourceDialog = document.getElementById('source-dialog');

    const result = await exec(`cat "${persistDir}/source"`, { env: { PATH: `${modDir}/bin` } });
    const currentSource = (result.errno === 0 && result.stdout.trim()) ? result.stdout.trim() : 'kpatch-next';

    sourceDetail.textContent = currentSource === 'kernelpatch' ? 'KernelPatch' : 'KPatch-Next';

    sourceItem.onclick = () => {
        const radios = sourceDialog.querySelectorAll('md-radio');
        radios.forEach(r => r.checked = r.value === currentSource);

        sourceDialog.querySelector('.cancel').onclick = () => sourceDialog.close();
        sourceDialog.querySelector('.confirm').onclick = async () => {
            const selected = sourceDialog.querySelector('md-radio[checked]')?.value
                || sourceDialog.querySelector('md-radio:checked')?.value;
            if (!selected || selected === currentSource) {
                sourceDialog.close();
                return;
            }

            const switchResult = await exec(`
                cp -f "${modDir}/bin/${selected}/kpatch" "${modDir}/bin/kpatch"
                cp -f "${modDir}/bin/${selected}/kptools" "${modDir}/bin/kptools"
                cp -f "${modDir}/bin/${selected}/kpimg" "${modDir}/bin/kpimg"
                echo "${selected}" > "${persistDir}/source"
            `);

            if (switchResult.errno === 0) {
                sourceDetail.textContent = selected === 'kernelpatch' ? 'KernelPatch' : 'KPatch-Next';
                toast(getString('msg_source_switched'));
            } else {
                toast(getString('msg_error', switchResult.stderr));
            }
            sourceDialog.close();
        };

        // Radio click handling
        radios.forEach(radio => {
            radio.onclick = () => {
                radios.forEach(r => r.checked = false);
                radio.checked = true;
            };
        });

        sourceDialog.show();
    };
}

function initRepoSettings() {
    const repoItem = document.getElementById('repository');
    const repoUrlDetail = document.getElementById('current-repo-url');
    const repoUrlDialog = document.getElementById('repo-url-dialog');
    const repoUrlInput = document.getElementById('repo-url-input');

    // Show current URL
    repoUrlDetail.textContent = repoModule.getRepoUrl();

    repoItem.onclick = () => {
        repoUrlInput.value = repoModule.getRepoUrl();
        repoUrlDialog.querySelector('.cancel').onclick = () => repoUrlDialog.close();
        repoUrlDialog.querySelector('.confirm').onclick = () => {
            const newUrl = repoUrlInput.value.trim();
            repoModule.setRepoUrl(newUrl);
            repoUrlDetail.textContent = repoModule.getRepoUrl();
            toast(getString('msg_repo_url_updated'));
            repoUrlDialog.close();
        };
        repoUrlDialog.show();
    };
}

function getMaxChunkSize() {
    exec('getconf ARG_MAX').then((result) => {
        try {
            const max_arg = parseInt(result.stdout.trim());
            if (!isNaN(max_arg)) {
                // max_arg * 0.75 (base64 size increase) - command length
                MAX_CHUNK_SIZE = Math.floor(max_arg * 0.75) - 1024;
            }
        } catch (e) { }
    });
}

export function linkRedirect(link) {
    toast(getString('msg_redirecting_to', link));
    setTimeout(() => {
        exec(`am start -a android.intent.action.VIEW -d ${link}`)
            .then(({ errno }) => {
                if (errno !== 0) {
                    toast(getString('msg_failed_open_link'));
                    window.open(link, "_blank");
                }
            });
    }, 100);
}

document.addEventListener('DOMContentLoaded', async () => {
    document.querySelectorAll('[unresolved]').forEach(el => el.removeAttribute('unresolved'));
    const splash = document.getElementById('splash');
    if (splash) setTimeout(() => splash.querySelector('.splash-icon').classList.add('show'), 20);

    setupRoute();

    // language
    const language = document.getElementById('language');
    const languageDialog = document.getElementById('language-dialog');
    language.onclick = () => languageDialog.show();
    languageDialog.querySelector('.cancel').onclick = () => languageDialog.close();

    // patch/unpatch
    document.getElementById('embed').onclick = patchModule.embedKPM;
    document.getElementById('start').onclick = () => {
        document.querySelector('.trailing-btn').style.display = 'none';
        patchModule.patch("patch");
    }
    document.getElementById('unpatch').onclick = () => {
        document.querySelector('.trailing-btn').style.display = 'none';
        patchModule.patch("unpatch");
    }

    // reboot
    const rebootMenu = document.getElementById('reboot-menu');
    document.getElementById('reboot-btn').onclick = () => {
        rebootMenu.open = !rebootMenu.open;
    }
    rebootMenu.querySelectorAll('md-menu-item').forEach(item => {
        item.onclick = () => {
            reboot(item.getAttribute('data-reason'));
        }
    });
    document.getElementById('reboot-fab').onclick = () => reboot();

    getMaxChunkSize();

    await loadTranslations();
    await Promise.all([updateStatus(), initInfo()]);

    excludeModule.initExcludePage();
    kpmModule.initKPMPage();
    logModule.initLogPage();
    backupModule.initBackupPage();
    repoModule.initRepoPage();
    initBinarySource();
    initRepoSettings();

    // splash screen
    if (splash) {
        setTimeout(() => splash.classList.add('exit'), 50);
        setTimeout(() => splash.remove(), 400);
    }
});

// Overwrite default dialog animation
document.querySelectorAll('md-dialog').forEach(dialog => {
    const defaultOpenAnim = dialog.getOpenAnimation;
    const defaultCloseAnim = dialog.getCloseAnimation;

    dialog.getOpenAnimation = () => {
        const defaultAnim = defaultOpenAnim.call(dialog);
        const customAnim = {};
        Object.keys(defaultAnim).forEach(key => customAnim[key] = defaultAnim[key]);

        customAnim.dialog = [
            [
                [{ opacity: 0, transform: 'translateY(50px)' }, { opacity: 1, transform: 'translateY(0)' }],
                { duration: 300, easing: 'ease' }
            ]
        ];
        customAnim.scrim = [
            [
                [{ 'opacity': 0 }, { 'opacity': 0.32 }],
                { duration: 300, easing: 'linear' },
            ],
        ];
        customAnim.container = [];

        return customAnim;
    };

    dialog.getCloseAnimation = () => {
        const defaultAnim = defaultCloseAnim.call(dialog);
        const customAnim = {};
        Object.keys(defaultAnim).forEach(key => customAnim[key] = defaultAnim[key]);

        customAnim.dialog = [
            [
                [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-50px)' }],
                { duration: 300, easing: 'ease' }
            ]
        ];
        customAnim.scrim = [
            [
                [{ 'opacity': 0.32 }, { 'opacity': 0 }],
                { duration: 300, easing: 'linear' },
            ],
        ];
        customAnim.container = [];

        return customAnim;
    };
});
