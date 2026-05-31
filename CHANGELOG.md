# KPatch Next Module

## Changelog

### v0.0.2

**Improvements:**
- Updated Magiskboot dependency to v30.7
- service.sh: Added retry logic (3 attempts) for kpatch hello on boot
- service.sh: Failed KPM modules now moved to `failed/` directory instead of being deleted
- service.sh: Added service.log for boot-time diagnostics
- boot_patch.sh: Boot image backup now saved persistently to `/data/adb/kp-next/backup/`
- util_functions.sh: Added vendor_boot and init_boot partition fallback for GKI devices
- Added KernelPatch (original) as alternative binary source alongside KPatch-Next
- Binary source selection via volume keys at install time
- Binary source switching via WebUI Settings (requires reboot)

**WebUI:**
- Added Log viewer page (accessible from Settings)
- Added Backup management page (accessible from Settings)
- Added Binary Source selector in Settings
- Added i18n strings for all new features (en, zh-CN)

