#!/system/bin/sh
#
# Root Manager Environment Detection
# Source this file: . "$MODDIR/detect_env.sh"
#
# Sets: ROOT_MGR, HAS_WEBUI, WEBUI_PKG, MODDIR, KPNDIR
#

KPNDIR="/data/adb/kp-next"
MODDIR="${MODDIR:-/data/adb/modules/KPatch-Next}"

# Detect root manager
detect_root_manager() {
    if [ -n "$APATCH" ]; then
        ROOT_MGR="apatch"
    elif [ -n "$KSU" ] || [ -f "/data/adb/ksu" ]; then
        ROOT_MGR="ksu"
    elif pm path me.weishu.kernelsu >/dev/null 2>&1; then
        ROOT_MGR="ksu"
    elif pm path me.bmax.apatch >/dev/null 2>&1; then
        ROOT_MGR="apatch"
    elif pm path com.topjohnwu.magisk >/dev/null 2>&1; then
        ROOT_MGR="magisk"
    elif [ -f "/data/adb/magisk" ]; then
        ROOT_MGR="magisk"
    else
        ROOT_MGR="unknown"
    fi
}

# Detect WebUI capability
detect_webui() {
    HAS_WEBUI="false"
    WEBUI_PKG=""

    # KSUWebUIStandalone (works with all managers)
    if pm path io.github.a13e300.ksuwebui >/dev/null 2>&1; then
        HAS_WEBUI="true"
        WEBUI_PKG="io.github.a13e300.ksuwebui"
        return
    fi

    # KernelSU native WebUI
    if [ "$ROOT_MGR" = "ksu" ]; then
        if pm path me.weishu.kernelsu >/dev/null 2>&1; then
            HAS_WEBUI="true"
            WEBUI_PKG="me.weishu.kernelsu"
            return
        fi
    fi

    # ReSukiSU
    if pm path com.sukisu.ultra >/dev/null 2>&1; then
        HAS_WEBUI="true"
        WEBUI_PKG="com.sukisu.ultra"
        return
    fi

    # APatch
    if [ "$ROOT_MGR" = "apatch" ]; then
        if pm path me.bmax.apatch >/dev/null 2>&1; then
            HAS_WEBUI="true"
            WEBUI_PKG="me.bmax.apatch"
            return
        fi
    fi
}

# Check if kpatch binary is functional
detect_kpatch() {
    KPATCH_BIN="$MODDIR/bin/kpatch"
    KPATCH_OK="false"
    if [ -x "$KPATCH_BIN" ]; then
        if "$KPATCH_BIN" hello >/dev/null 2>&1; then
            KPATCH_OK="true"
        fi
    fi
}

# Run all detection
detect_root_manager
detect_webui
detect_kpatch
