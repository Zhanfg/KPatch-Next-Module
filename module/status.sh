#!/bin/sh

MODDIR="/data/adb/modules/KPatch-Next"
KPNDIR="/data/adb/kp-next"
PATH="$MODDIR/bin:$PATH"

PROP_FILE="$MODDIR/module.prop"
PROP_BAK="$PROP_FILE.bak"

set_prop() {
    local prop="$1"
    local value="$2"
    local file="$3"

    if ! grep -q "^$prop=" "$file"; then
        echo "$prop=$value" >> "$file"
        return
    fi
    sed "s/^$prop=.*/$prop=$value/" "$file" > "$file.tmp"
    cat "$file.tmp" > "$file"
    rm -f "$file.tmp"
}

restore_prop_if_needed() {
    grep -q "^id=" "$PROP_FILE" && return
    [ -f "$PROP_BAK" ] && cat "$PROP_BAK" > "$PROP_FILE"
}

# self cleanup if module removed improperly
if [ ! -d "$MODDIR" ]; then
    rm -f "$(realpath "$0")"
    exit 0
fi

# Detect root manager
ROOT_MGR="unknown"
if [ -f "$KPNDIR/root_manager" ]; then
    ROOT_MGR="$(cat $KPNDIR/root_manager)"
elif [ -n "$APATCH" ]; then
    ROOT_MGR="apatch"
elif [ -n "$KSU" ]; then
    ROOT_MGR="ksu"
elif [ -n "$MAGISK_VER" ]; then
    ROOT_MGR="magisk"
fi

active="Status: active"
inactive="Status: inactive"
info="info: kernel not patched yet"
string="$inactive | $info | $ROOT_MGR"

until [ "$(getprop sys.boot_completed)" = "1" ]; do
    sleep 1
done

if kpatch hello >/dev/null 2>&1; then
    KPM_COUNT="$(kpatch kpm num 2>/dev/null || echo 0)"
    [ -z "$KPM_COUNT" ] && KPM_COUNT=0

    REHOOK_MODE="$(kpatch rehook_status 2>/dev/null | awk '{print $NF}')"
    [ -z "$REHOOK_MODE" ] && REHOOK_MODE="enabled"

    string="$active | kpmodule: $KPM_COUNT | rehook: $REHOOK_MODE | $ROOT_MGR"
fi

restore_prop_if_needed

set_prop "description" "$string" "$PROP_FILE"
