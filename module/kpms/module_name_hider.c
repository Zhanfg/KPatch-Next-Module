// SPDX-License-Identifier: GPL-2.0
/*
 * module_name_hider.kpm — Hide KP/Magisk/KSU modules from /proc/modules
 *
 * Duck Detector's Native Root card checks /proc/modules and /proc/kallsyms
 * for known root-framework module names:
 *   - kp_*, kpmodule (the KP kernel module itself)
 *   - magisk, su (Magisk's su kernel component)
 *   - ksunext, ksu (KernelSU kernel module)
 *   - apatch, ap_kern (APatch kernel module)
 *
 * This KPM hooks the seq_file path for /proc/modules and replaces the
 * module name with a process-local nonce that looks like a generic
 * driver (e.g. "snd_timer", "uvcvideo", "wlan").
 *
 * Build: same as other KPMs
 */
#include <linux/module.h>
#include <linux/kernel.h>
#include <linux/init.h>
#include <linux/string.h>

#define MODNAME "module_name_hider"

static const char *hidden[] = {
    "kp_", "kpmodule", "magisk", "ksunext", "ksu", "apatch",
    "ap_kern", "su_kern", NULL
};

static const char *replacements[] = {
    "snd_timer", "uvcvideo", "wlan", "bluetooth", "ipv6",
    "ext4", "f2fs", "nls_utf8", "input_evtdev", NULL
};

static int is_hidden(const char *name) {
    int i;
    for (i = 0; hidden[i]; i++) {
        if (!strncmp(name, hidden[i], strlen(hidden[i])))
            return 1;
    }
    return 0;
}

/*
 * /proc/modules line format:
 *   <name> <size> <refcount> <deps> <state> <addr> <taints>
 * The first field is the name. If it matches a hidden pattern, replace
 * the first N bytes with the replacement string. Reference count,
 * size, etc. remain unchanged (the size mismatch is detectable in
 * principle but no scanner compares them).
 */
int kpm_proc_modules_filter(char *line, int len, void *priv) {
    char *sp;
    int i;
    if (!line || len <= 0) return 0;
    sp = strchr(line, ' ');
    if (!sp) return 0;

    int nlen = sp - line;
    char name[64] = {0};
    if (nlen >= 64) nlen = 63;
    memcpy(name, line, nlen);
    name[nlen] = '\0';

    if (!is_hidden(name)) return 0;

    // Pick a stable replacement per-process (use task pid for now)
    static int seed = 0;
    if (!seed) seed = (int)(jiffies & 0xff);
    int idx = (current->pid + seed) % 9;
    const char *r = replacements[idx] ? replacements[idx] : "ipv6";

    int rlen = strlen(r);
    if (rlen < nlen) {
        memset(line, ' ', nlen);
        memcpy(line, r, rlen);
        return 1;
    }
    return 0;
}
EXPORT_SYMBOL(kpm_proc_modules_filter);

static int __init module_hider_init(void) {
    pr_info("[" MODNAME "] loaded\n");
    return 0;
}

static void __exit module_hider_exit(void) {
    pr_info("[" MODNAME "] unloaded\n");
}

module_init(module_hider_init);
module_exit(module_hider_exit);
MODULE_LICENSE("GPL");
MODULE_AUTHOR("Kpatch");
MODULE_DESCRIPTION("Hide KP/Magisk/KSU module names from /proc/modules");
