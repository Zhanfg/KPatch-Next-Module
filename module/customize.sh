MODDIR="/data/adb/modules/KPatch-Next"

# We only support arm64
if [ "$ARCH" != "arm64" ]; then
    abort "! Only arm64 is supported"
fi

# Detect root manager
ROOT_MGR="unknown"
if [ -n "$APATCH" ]; then
    ROOT_MGR="apatch"
elif [ -n "$KSU" ]; then
    ROOT_MGR="ksu"
elif [ -n "$MAGISK_VER" ]; then
    ROOT_MGR="magisk"
fi

ui_print "- Root manager: $ROOT_MGR"
ui_print "- Architecture: $ARCH"

set_perm_recursive "$MODPATH/bin" 0 2000 0755 0755

mkdir -p /data/adb/kp-next

# Migrate package_config from APatch if present
if [ -f "/data/adb/ap/package_config" ] && [ ! -f "/data/adb/kp-next/package_config" ]; then
    cp "/data/adb/ap/package_config" /data/adb/kp-next/package_config
    ui_print "- Migrated APatch package_config"
fi

# Copy binaries (single source: KernelPatch-Public)
ui_print "- Installing KernelPatch binaries..."
# Binaries are already in module/bin/ from the zip — no copy needed

# Verify critical binaries
if [ ! -x "$MODPATH/bin/kpatch" ]; then
    ui_print "! Warning: kpatch binary missing or not executable"
fi
if [ ! -x "$MODPATH/bin/kptools" ]; then
    ui_print "! Warning: kptools binary missing or not executable"
fi

# Save root manager info
echo "$ROOT_MGR" > /data/adb/kp-next/root_manager

# backup module.prop
cp "$MODPATH/module.prop" "$MODPATH/module.prop.bak"

# Hot update webui, patch scripts and binaries
rm -rf "$MODDIR/webroot"/* "$MODDIR/bin"/* "$MODDIR/patch"/*
cp -Lrf "$MODPATH/webroot"/* "$MODDIR/webroot"
cp -Lrf "$MODPATH/bin"/* "$MODDIR/bin"
cp -Lrf "$MODPATH/patch"/* "$MODDIR/patch"

# Copy environment detection script
cp -f "$MODPATH/detect_env.sh" "$MODDIR/detect_env.sh" 2>/dev/null

ui_print "- Installation complete"
ui_print ""
ui_print "  Next steps:"
ui_print "  1. Reboot your device"
if [ "$ROOT_MGR" = "magisk" ]; then
    ui_print "  2. Install KSUWebUIStandalone app"
    ui_print "     (no native WebUI support in Magisk)"
    ui_print "  3. Open WebUI via Manager → Action button"
else
    ui_print "  2. Open WebUI via Manager → KPatch-Next → Action"
fi
ui_print "  4. Click 'Start' to patch kernel"
ui_print "  5. Reboot again to activate"
