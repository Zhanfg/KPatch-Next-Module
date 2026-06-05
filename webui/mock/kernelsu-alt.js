/**
 * Mock implementation of kernelsu-alt for local browser preview.
 * Provides stubbed device APIs so the WebUI can render without a real device.
 */

const mockPackages = [
    { packageName: 'com.android.chrome', appLabel: 'Chrome', isSystem: false, uid: 10001, versionName: '120.0', versionCode: 12000 },
    { packageName: 'com.whatsapp', appLabel: 'WhatsApp', isSystem: false, uid: 10002, versionName: '2.24', versionCode: 22400 },
    { packageName: 'com.android.settings', appLabel: 'Settings', isSystem: true, uid: 1000, versionName: '14', versionCode: 1400 },
    { packageName: 'com.android.systemui', appLabel: 'System UI', isSystem: true, uid: 1001, versionName: '14', versionCode: 1400 },
    { packageName: 'com.google.android.gms', appLabel: 'Google Play Services', isSystem: true, uid: 10017, versionName: '24.10', versionCode: 241000 },
    { packageName: 'io.github.a13e300.ksuwebui', appLabel: 'KSUWebUIStandalone', isSystem: false, uid: 10050, versionName: '1.0', versionCode: 1 },
];

export async function exec(command, options) {
    console.log('[mock-exec]', command);

    // kpatch hello → simulate kernel not patched
    if (command.includes('kpatch hello')) {
        return { errno: 0, stdout: 'mock-hello', stderr: '' };
    }

    // kpatch kpver → version
    if (command.includes('kpatch kpver')) {
        return { errno: 0, stdout: '0x0c06', stderr: '' };
    }

    // kpatch kpm list → empty
    if (command.includes('kpatch kpm list')) {
        return { errno: 0, stdout: '', stderr: '' };
    }

    // kpatch kpm num
    if (command.includes('kpatch kpm num')) {
        return { errno: 0, stdout: '0', stderr: '' };
    }

    // kpatch rehook_status
    if (command.includes('kpatch rehook_status')) {
        return { errno: 0, stdout: 'rehook status: enabled', stderr: '' };
    }

    // uname + getprop → system info
    if (command.includes('uname -r')) {
        return {
            errno: 0,
            stdout: '6.6.139-android15-8\n16\nOnePlus/PJZ110/OP5D0DL1:16\nEnforcing',
            stderr: ''
        };
    }

    // getconf ARG_MAX
    if (command.includes('getconf ARG_MAX')) {
        return { errno: 0, stdout: '2097152', stderr: '' };
    }

    // cat source file
    if (command.includes('cat') && command.includes('source')) {
        return { errno: 0, stdout: 'kernelpatch', stderr: '' };
    }

    // logcat / service.log
    if (command.includes('service.log') || command.includes('tail')) {
        return {
            errno: 0,
            stdout: `=== ${new Date().toISOString()} service.sh started ===\n[${new Date().toISOString()}] kpatch hello OK\n[${new Date().toISOString()}] Loaded KPM: test_module.kpm\n[${new Date().toISOString()}] Dispatching event: POST_FS_DATA\n[${new Date().toISOString()}] Dispatching event: BOOT_COMPLETED\n[${new Date().toISOString()}] service.sh completed`,
            stderr: ''
        };
    }

    // ls backup dir
    if (command.includes('ls -l') && command.includes('backup')) {
        return {
            errno: 0,
            stdout: '-rw-r--r-- 1 root root 180016 May 31 10:00 boot_backup_2605311000.img\n-rw-r--r-- 1 root root 180016 May 30 15:30 boot_backup_2605301530.img',
            stderr: ''
        };
    }

    // ls kpm directory
    if (command.includes('ls') && command.includes('kpm')) {
        return { errno: 0, stdout: '', stderr: '' };
    }

    // pm path → WebUI apps
    if (command.includes('pm path')) {
        return { errno: 0, stdout: 'package:io.github.a13e300.ksuwebui', stderr: '' };
    }

    // curl → repo fetch
    if (command.includes('curl')) {
        return {
            errno: 0,
            stdout: JSON.stringify({
                name: 'KPM Community Repository',
                modules: [
                    { id: 'selinux_hook', name: 'SELinux Hook', version: '1.1.0', author: 'community', description: 'SELinux access filter', downloadUrl: '#', size: 65648 },
                    { id: 'devsafe', name: 'DevSafe', version: '3.0', author: 'community', description: 'Development safety module for Android 15', downloadUrl: '#', size: 209288 },
                ]
            }),
            stderr: ''
        };
    }

    // kpatch event
    if (command.includes('kpatch event')) {
        return { errno: 0, stdout: '', stderr: '' };
    }

    // Default
    return { errno: 0, stdout: '', stderr: '' };
}

export function spawn(command, args, options) {
    console.log('[mock-spawn]', command, args);
    const listeners = {};
    const stdoutListeners = [];
    const stderrListeners = [];

    const child = {
        stdout: {
            on(event, fn) { if (event === 'data') stdoutListeners.push(fn); },
            emit(event, data) { if (event === 'data') stdoutListeners.forEach(fn => fn(data)); }
        },
        stderr: {
            on(event, fn) { if (event === 'data') stderrListeners.push(fn); },
            emit(event, data) { if (event === 'data') stderrListeners.forEach(fn => fn(data)); }
        },
        stdin: { on() {}, emit() {} },
        on(event, fn) {
            if (!listeners[event]) listeners[event] = [];
            listeners[event].push(fn);
        },
        emit(event, ...args) {
            (listeners[event] || []).forEach(fn => fn(...args));
        }
    };

    // Simulate async output for spawn commands
    setTimeout(() => {
        if (command.includes('busybox') || command.includes('magiskboot')) {
            child.stdout.emit('data', '- Unpacking boot image');
            setTimeout(() => {
                child.stdout.emit('data', '- Patching kernel');
                setTimeout(() => {
                    child.stdout.emit('data', '- Successfully Patched!');
                    child.emit('exit', 0);
                }, 100);
            }, 100);
        } else if (command.includes('kptools')) {
            child.stdout.emit('data', '[kpimg]\nversion=0xc06\ncompile_time=11:08:10 Dec 30 2025\nconfig=linux,release');
            child.emit('exit', 0);
        } else {
            child.emit('exit', 0);
        }
    }, 50);

    return child;
}

export function toast(message) {
    console.log('[toast]', message);
    // Show a simple browser notification-style toast
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:8px 16px;border-radius:8px;z-index:99999;font-size:14px;max-width:90vw;text-align:center;';
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

export function fullScreen(isFullScreen) {
    console.log('[mock-fullScreen]', isFullScreen);
}

export function enableEdgeToEdge(isEnable) {
    console.log('[mock-edgeToEdge]', isEnable);
    return Promise.resolve(true);
}

export async function listPackages(type) {
    console.log('[mock-listPackages]', type);
    return mockPackages.map(p => p.packageName);
}

export async function getPackagesInfo(pkg) {
    console.log('[mock-getPackagesInfo]', pkg);
    if (Array.isArray(pkg)) {
        return pkg.map(name => mockPackages.find(p => p.packageName === name) || { packageName: name, appLabel: name, isSystem: false, uid: 10099, versionName: '1.0', versionCode: 1 });
    }
    return mockPackages.find(p => p.packageName === pkg) || { packageName: pkg, appLabel: pkg, isSystem: false, uid: 10099, versionName: '1.0', versionCode: 1 };
}
