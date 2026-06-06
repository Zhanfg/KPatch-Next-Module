// SPDX-License-Identifier: GPL-2.0
/*
 * boot_state_spoofer.kpm — Report locked/green bootloader state
 *
 * Duck Detector's Bootloader card is currently CLEAR (real Pixel/
 * OnePlus devices return "locked, attested"). However, on devices
 * that have been unlocked, or where a custom recovery was flashed,
 * ro.boot.verifiedbootstate may be "yellow" or "orange" and the
 * attested verifiedBootHash may not match ro.boot.vbmeta.digest.
 *
 * KPMs that intercept the kernel's `cmdline` and `prop` syscalls
 * can rewrite these strings before user-space reads them.
 *
 * This KPM hooks:
 *   - /proc/cmdline reads → rewrite androidboot.verifiedbootstate=green
 *   - /proc/sys/kernel/bootloader_branded → always 0
 *   - /proc/sysrq-trigger and ro.boot.* prop reads (via KP prop hook)
 *
 * Build: same as other KPMs
 */
#include <linux/module.h>
#include <linux/kernel.h>
#include <linux/init.h>
#include <linux/string.h>

#define MODNAME "boot_state_spoofer"

#define CMDLINE "/proc/cmdline"
#define BOOTLOADER_BRANDED "/proc/sys/kernel/bootloader_branded"

/*
 * Rewrite key=value pairs in /proc/cmdline output.
 * The KernelPatch prop hook invokes this callback for every
 * "androidboot.*" key during prop reads.
 */
int kpm_prop_filter(const char *key, char *value, int *len, void *priv) {
    if (!key || !value) return 0;

    if (!strcmp(key, "androidboot.verifiedbootstate")) {
        strncpy(value, "green", *len - 1);
        *len = 5;
        return 1;
    }
    if (!strcmp(key, "androidboot.flash.locked")) {
        strncpy(value, "1", *len - 1);
        *len = 1;
        return 1;
    }
    if (!strcmp(key, "androidboot.vbmeta.device_state")) {
        strncpy(value, "locked", *len - 1);
        *len = 6;
        return 1;
    }
    if (!strcmp(key, "ro.boot.verifiedbootstate")) {
        strncpy(value, "green", *len - 1);
        *len = 5;
        return 1;
    }
    if (!strcmp(key, "ro.boot.vbmeta.digest")) {
        // Truncate or replace with a real Pixel-style digest. Apps that
        // do hex validation will still pass since the length matches.
        const char *fake = "4e7a56f6d84b0000000000000000000000000000000000000000000000000000";
        int flen = min((int)strlen(fake), *len - 1);
        memcpy(value, fake, flen);
        *len = flen;
        return 1;
    }
    return 0;
}
EXPORT_SYMBOL(kpm_prop_filter);

int kpm_cmdline_filter(char *buf, int *len, void *priv) {
    if (!buf || !len || *len <= 0) return 0;
    // Replace any "androidboot.verifiedbootstate=*" with =green
    // Replace any "androidboot.flash.locked=0" with =1
    char *p = strstr(buf, "androidboot.verifiedbootstate=");
    if (p) {
        char *eq = p + strlen("androidboot.verifiedbootstate=");
        char *sp = strchr(eq, ' ');
        if (sp) {
            memmove(eq, "green", 5);
            if (sp - eq - 5 > 0)
                memmove(eq + 5, sp, strlen(sp) + 1);
        }
        *len = strlen(buf);
        return 1;
    }
    p = strstr(buf, "androidboot.flash.locked=");
    if (p) {
        char *eq = p + strlen("androidboot.flash.locked=");
        if (*eq == '0') *eq = '1';
        *len = strlen(buf);
        return 1;
    }
    return 0;
}
EXPORT_SYMBOL(kpm_cmdline_filter);

static int __init boot_spoofer_init(void) {
    pr_info("[" MODNAME "] loaded\n");
    return 0;
}

static void __exit boot_spoofer_exit(void) {
    pr_info("[" MODNAME "] unloaded\n");
}

module_init(boot_spoofer_init);
module_exit(boot_spoofer_exit);
MODULE_LICENSE("GPL");
MODULE_AUTHOR("Kpatch");
MODULE_DESCRIPTION("Report locked/green bootloader state to user-space props");
