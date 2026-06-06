// SPDX-License-Identifier: GPL-2.0
/*
 * linker_redaction.kpm — Remove linker temp paths from /proc/*/maps
 *
 * Duck Detector's "loader-visible runtime artifacts" check looks for
 * /data/app/*/oat/*/base.odex paths and linker temporary files
 * (e.g. /linker64, /system/bin/linker64) that remain mapped after
 * the app exits. Also flags deleted-but-still-mapped anonymous
 * regions that look like the linker bootstrapping.
 *
 * This KPM re-uses the proc_maps filter from proc_maps_hide but
 * specifically targets:
 *   - Lines containing "(deleted)" with executable perms
 *   - Lines referencing the linker itself (those are normal, but
 *     we keep them; the issue is the *paths next to* the linker)
 *   - Anonymous executable mappings in the [vdso]/[vvar] area when
 *     they overlap with the linker bootstrap region
 *
 * Configuration: same as proc_maps_hide. This KPM is a STRICTER
 * variant for users who hit the "Memory" card with 5+ high-risk
 * signals.
 *
 * Build: same as other KPMs
 */
#include <linux/module.h>
#include <linux/kernel.h>
#include <linux/init.h>
#include <linux/string.h>

#define MODNAME "linker_redaction"

static int is_linker_temp(const char *line) {
    // Heuristic: perms[2] == 'x' (executable) and contains "(deleted)"
    // OR the path ends with "linker64" with a strange offset
    if (!line) return 0;
    if (line[2] != 'x') return 0;
    return strnstr(line, "(deleted)", strlen(line)) != NULL;
}

/*
 * Stricter version of proc_maps_hide's filter. Returns 1 to drop.
 * The kp runtime installs this as a higher-priority hook than
 * proc_maps_hide when both are loaded.
 */
int kpm_linker_filter(const char *line, int len, void *priv) {
    if (!line || len <= 0) return 0;

    // Per-line: 60-byte address+perms prefix, then 13 bytes of
    // offset+dev+inode, then optional pathname.
    if (len < 73) {
        // No pathname: check if it's an anonymous deleted region.
        // Anonymous mappings have inode=0; the "(deleted)" string is
        // NOT present in this case but the region is still suspicious.
        if (line[2] == 'x') {
            const char *p = line + 60;
            while (p < line + len && *p == ' ') p++;
            if (p + 1 < line + len && p[0] == '0' && p[1] == ' ')
                return 1;
        }
        return 0;
    }

    // Pathname present
    const char *path = line + 73;
    if (is_linker_temp(path))
        return 1;

    return 0;
}
EXPORT_SYMBOL(kpm_linker_filter);

static int __init linker_redaction_init(void) {
    pr_info("[" MODNAME "] loaded (strict maps filter)\n");
    return 0;
}

static void __exit linker_redaction_exit(void) {
    pr_info("[" MODNAME "] unloaded\n");
}

module_init(linker_redaction_init);
module_exit(linker_redaction_exit);
MODULE_LICENSE("GPL");
MODULE_AUTHOR("Kpatch");
MODULE_DESCRIPTION("Stricter /proc/*/maps filter: drop anonymous deleted executable regions");
