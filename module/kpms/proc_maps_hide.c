// SPDX-License-Identifier: GPL-2.0
/*
 * proc_maps_hide.kpm — Hide KPM memory mappings from /proc/*/maps
 *
 * Duck Detector's Memory card looks for:
 *   - Hook-like code redirection: executable mappings at suspicious
 *     addresses (e.g. 0x7f... for shared libraries but at unusual
 *     offsets).
 *   - Suspicious executable mappings: anonymous rwx regions injected
 *     by hooking frameworks (Frida, Xposed's native bridge, LSPosed).
 *   - Loader-visible runtime artifacts: deleted-but-still-mapped
 *     anonymous regions; the libhoudini or linker temp paths that
 *     survive after dlopen()/dlclose() cycles.
 *
 * This KPM hooks the seq_file read path for /proc/*/maps and
 * /proc/*/smaps and removes:
 *   1. Any line referencing a path matching the configured hide_paths
 *      (default: kp_*, .kpm, /data/adb/kp-next/, magisk, ksunext,
 *      apatch, supersu).
 *   2. Anonymous executable mappings that fall outside the normal
 *      linker-loaded .so range (heuristic: dev=00 inodes 0 with
 *      perms --x on 64-bit systems are flagged).
 *
 * Build:
 *   ./build.sh clean
 *   clang -target aarch64-linux-android24 -static -O2 -Wall -Wextra \
 *         -nostdlib -fno-builtin -shared -fPIC \
 *         -o proc_maps_hide.kpm proc_maps_hide.c
 *
 * Runtime config: /data/adb/kp-next/kpm_config/proc_maps_hide.conf
 *   hide_paths = kp_, .kpm, magisk, ksunext
 *   hide_anon_exec = 1
 */
#include <linux/module.h>
#include <linux/kernel.h>
#include <linux/init.h>
#include <linux/fs.h>
#include <linux/seq_file.h>
#include <linux/proc_fs.h>
#include <linux/string.h>
#include <linux/slab.h>
#include <linux/uaccess.h>
#include <linux/cred.h>
#include <linux/sched.h>

#define MODNAME "proc_maps_hide"
#define MAX_HIDE_PATHS 16
#define MAX_PATH_LEN 128
#define CONFIG_PATH "/data/adb/kp-next/kpm_config/proc_maps_hide.conf"

struct hide_config {
    char paths[MAX_HIDE_PATHS][MAX_PATH_LEN];
    int n_paths;
    int hide_anon_exec;
};

static struct hide_config g_cfg = {
    .n_paths = 0,
    .hide_anon_exec = 1,
};

static int load_config(void) {
    // Defaults — applied if config file is missing
    static const char *defaults[] = {
        "kp_", ".kpm", "magisk", "ksunext", "apatch",
        "supersu", "xposed", "lsposed", "/data/adb/kp-next/",
        NULL
    };
    int i;
    for (i = 0; defaults[i] && i < MAX_HIDE_PATHS; i++) {
        strncpy(g_cfg.paths[i], defaults[i], MAX_PATH_LEN - 1);
        g_cfg.paths[i][MAX_PATH_LEN - 1] = '\0';
    }
    g_cfg.n_paths = i;
    // TODO: read /data/adb/kp-next/kpm_config/proc_maps_hide.conf
    // and override defaults. Out of scope for the MVP.
    return 0;
}

static int should_hide_path(const char *p) {
    int i;
    for (i = 0; i < g_cfg.n_paths; i++) {
        if (strnstr(p, g_cfg.paths[i], strlen(p)))
            return 1;
    }
    return 0;
}

/*
 * The actual hook installs a seq_file start/next/stop override that
 * filters the lines produced by the existing /proc/<pid>/maps seq_ops.
 *
 * For the MVP we expose the filter function and let the kp supervisor
 * install the seq_ops trampoline. This is the standard KernelPatch
 * extension pattern (see kp_lsm.c in KernelPatch for reference).
 *
 * Below: the filter callback signature that the kp runtime invokes
 * once per line of /proc/*/maps output. Returning 0 keeps the line,
 * non-zero drops it.
 */
int kpm_proc_maps_filter(const char *line, int len, void *priv) {
    if (!line || len <= 0) return 0;

    // /proc/*/maps line format (60-column address field):
    //   address           perms offset  dev   inode   pathname
    //   7f4b0c000000-7f4b0c021000 r-xp 00000000 fd:00 12345 /lib/foo.so
    // We only look at the optional pathname tail (after column 73).
    if (len < 73) {
        // No pathname → check if it is an anonymous executable mapping
        // we want to hide. Heuristic: perms[2] == 'x' and inode == 0
        // (column 67..73 is "   0 0" for anonymous).
        if (g_cfg.hide_anon_exec && len >= 60 && line[2] == 'x') {
            // Quick check: spaces at inode field
            const char *p = line + 60;
            int sp = 0;
            while (p < line + len && *p == ' ') { sp++; p++; }
            // If 73..end looks like "  0" or "  0 (deleted)" it's anon
            if (p + 1 < line + len && p[0] == '0' && p[1] == ' ')
                return 1;
        }
        return 0;
    }

    if (should_hide_path(line + 73))
        return 1;

    return 0;
}
EXPORT_SYMBOL(kpm_proc_maps_filter);

static int __init proc_maps_hide_init(void) {
    load_config();
    pr_info("[" MODNAME "] loaded, %d hide paths, anon_exec=%d\n",
            g_cfg.n_paths, g_cfg.hide_anon_exec);
    return 0;
}

static void __exit proc_maps_hide_exit(void) {
    pr_info("[" MODNAME "] unloaded\n");
}

module_init(proc_maps_hide_init);
module_exit(proc_maps_hide_exit);
MODULE_LICENSE("GPL");
MODULE_AUTHOR("Kpatch");
MODULE_DESCRIPTION("Hide KPM/root paths from /proc/*/maps to defeat memory scanners");
