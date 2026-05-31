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

# Binary source selection: KPatch-Next (default) or KernelPatch
# Restore previous choice if available
KP_SOURCE="kpatch-next"
if [ -f "/data/adb/kp-next/source" ]; then
    KP_SOURCE="$(cat /data/adb/kp-next/source)"
fi

# Volume key selection at install time
ui_print ""
ui_print "- Select kernel patch binary source:"
ui_print "  Vol+ = KPatch-Next (default)"
ui_print "  Vol- = KernelPatch (original)"
ui_print ""

# Wait for volume key (timeout 10s, default to KPatch-Next)
chooseport() {
    local cnt
    for cnt in $(seq 1 50); do
        local event
        event=$(getevent -lqc 1 2>/dev/null)
        if echo "$event" | grep -q "VOLUMEUP.*DOWN"; then
            return 0
        elif echo "$event" | grep -q "VOLUMEDOWN.*DOWN"; then
            return 1
        fi
        sleep 0.2
    done
    return 0
}

if chooseport; then
    KP_SOURCE="kpatch-next"
    ui_print "- Selected: KPatch-Next"
else
    KP_SOURCE="kernelpatch"
    ui_print "- Selected: KernelPatch (original)"
fi

# Save source preference
echo "$KP_SOURCE" > /data/adb/kp-next/source

# Copy the selected binary set
ui_print "- Installing $KP_SOURCE binaries..."
if [ -d "$MODPATH/bin/$KP_SOURCE" ]; then
    cp -f "$MODPATH/bin/$KP_SOURCE/kpatch" "$MODPATH/bin/kpatch"
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
