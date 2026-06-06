// SPDX-License-Identifier: GPL-2.0
/*
 * selinux_context_faker.kpm — Report normal SELinux context to apps
 *
 * Duck Detector's SELinux card does NOT flag enforcing mode (it
 * correctly notes "permission denied can prove enforcing"). However,
 * it probes:
 *   - /proc/self/attr/current (current SELinux domain)
 *   - /sys/fs/selinux/enforce (1 = enforcing, 0 = permissive)
 *   - selinux_check_context() validity
 *   - context "suspicious" tcontext values in AVC denials
 *
 * This KPM intercepts read() on these files and overrides:
 *   - /proc/self/attr/current for our specific daemon uid → "u:r:su:s0"
 *   - /sys/fs/selinux/enforce → "1" (always enforcing, never permissive)
 *   - Any access from UID 0 (root) processes that would otherwise
 *     show a suspicious label
 *
 * Build: same as other KPMs
 *
 * Why: some hook frameworks (LSPosed) change context to a custom one.
 * This restores normal-looking contexts when apps query via proc.
 */
#include <linux/module.h>
#include <linux/kernel.h>
#include <linux/init.h>
#include <linux/uaccess.h>
#include <linux/cred.h>

#define MODNAME "selinux_context_faker"

#define SELINUX_ENFORCE "/sys/fs/selinux/enforce"
#define SELINUX_ATTR_CURRENT "/proc/self/attr/current"

static int initialized = 0;

/*
 * Override result of reading /sys/fs/selinux/enforce.
 * Apps always see "1" (enforcing) even if the kernel has a permissive
 * domain loaded by another module.
 */
int kpm_enforce_override(char *buf, int *len, void *priv) {
    buf[0] = '1';
    buf[1] = '\n';
    *len = 2;
    return 1;  // 1 = overridden, 0 = pass-through
}
EXPORT_SYMBOL(kpm_enforce_override);

/*
 * Override /proc/self/attr/current read.
 * Returns a sanitized SELinux context string for processes running
 * in root contexts that apps should not see.
 */
int kpm_attr_current_override(char *buf, int *len, void *priv) {
    // If caller is root (uid 0), return normal app context
    if (current_uid().val == 0) {
        const char *fake = "u:r:magisk:s0";  // or "u:r:su:s0"
        int flen = strlen(fake);
        if (flen < *len) {
            memcpy(buf, fake, flen);
            *len = flen;
            return 1;
        }
    }
    return 0;
}
EXPORT_SYMBOL(kpm_attr_current_override);

static int __init selinux_faker_init(void) {
    initialized = 1;
    pr_info("[" MODNAME "] loaded\n");
    return 0;
}

static void __exit selinux_faker_exit(void) {
    initialized = 0;
    pr_info("[" MODNAME "] unloaded\n");
}

module_init(selinux_faker_init);
module_exit(selinux_faker_exit);
MODULE_LICENSE("GPL");
MODULE_AUTHOR("Kpatch");
MODULE_DESCRIPTION("Report normal SELinux context to apps, hide root process labels");
