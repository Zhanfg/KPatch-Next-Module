MODDIR="/data/adb/modules/KPatch-Next"

# Conflict with APatch
if [ "$APATCH" ]; then
    abort "! APatch is unsupported"
fi

# We only support arm64
if [ "$ARCH" != "arm64" ]; then
    abort "! Only arm64 is supported"
fi

set_perm_recursive "$MODPATH/bin" 0 2000 0755 0755

mkdir -p /data/adb/kp-next

# try get package_config from APatch
if [ -f "/data/adb/ap/package_config" ] && [ ! -f "/data/adb/kp-next/package_config" ]; then
    cp "/data/adb/ap/package_config" /data/adb/kp-next/package_config
fi

# Binary source: KernelPatch-Public only (no switching)
KP_SOURCE="kernelpatch"
echo "$KP_SOURCE" > /data/adb/kp-next/source

# Copy KernelPatch binaries
ui_print "- Installing KernelPatch binaries..."
if [ -d "$MODPATH/bin/$KP_SOURCE" ]; then
    cp -f "$MODPATH/bin/$KP_SOURCE/kpatch" "$MODPATH/bin/kpatch" 2>/dev/null
    cp -f "$MODPATH/bin/$KP_SOURCE/kptools" "$MODPATH/bin/kptools"
    cp -f "$MODPATH/bin/$KP_SOURCE/kpimg" "$MODPATH/bin/kpimg"
else
    ui_print "! Warning: $KP_SOURCE binaries not found, using default"
fi

# backup module.prop
cp "$MODPATH/module.prop" "$MODPATH/module.prop.bak"

# Hot update webui, patch scripts and binaries
rm -rf "$MODDIR/webroot"/* "$MODDIR/bin"/* "$MODDIR/patch"/*
cp -Lrf "$MODPATH/webroot"/* "$MODDIR/webroot"
cp -Lrf "$MODPATH/bin"/* "$MODDIR/bin"
cp -Lrf "$MODPATH/patch"/* "$MODDIR/patch"
