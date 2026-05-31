#!/bin/sh

MODDIR=${0%/*}
KPNDIR="/data/adb/kp-next"
PATH="$MODDIR/bin:$PATH"
CONFIG="$KPNDIR/package_config"
REHOOK="$(cat $KPNDIR/rehook 2>/dev/null)"
LOG="$KPNDIR/service.log"
KPM_DIR="$KPNDIR/kpm"
KPM_EVENT_DIR="$KPNDIR/kpm_events"

# Helper: read a key from module.prop
get_prop() {
    grep "^${1}=" "$2" 2>/dev/null | head -1 | cut -d'=' -f2-
}

# Rotate log on boot
mkdir -p "$KPNDIR" "$KPM_DIR/failed" "$KPM_EVENT_DIR"
echo "=== $(date) service.sh started ===" > "$LOG"
echo "[$(date)] MODDIR=$MODDIR" >> "$LOG"
echo "[$(date)] PATH=$PATH" >> "$LOG"

# Detect root manager
ROOT_MGR="unknown"
if [ -f "$KPNDIR/root_manager" ]; then
    ROOT_MGR="$(cat $KPNDIR/root_manager)"
fi
echo "[$(date)] root_manager=$ROOT_MGR" >> "$LOG"

# Check if kpatch binary exists and is executable
if [ ! -x "$MODDIR/bin/kpatch" ]; then
    echo "[$(date)] ERROR: kpatch binary not found or not executable" >> "$LOG"
    touch "$MODDIR/unresolved"
    exit 0
fi

# Retry kpatch hello
retries=0
while [ -z "$(kpatch hello 2>/dev/null)" ] && [ $retries -lt 3 ]; do
    echo "[$(date)] kpatch hello attempt $((retries + 1)) failed, retrying..." >> "$LOG"
    sleep 2
    retries=$((retries + 1))
done
if [ -z "$(kpatch hello 2>/dev/null)" ]; then
    echo "[$(date)] kpatch hello failed after $retries retries" >> "$LOG"
    echo "[$(date)] Kernel may not be patched yet. Open WebUI and click Start." >> "$LOG"
    touch "$MODDIR/unresolved"
    exit 0
fi
echo "[$(date)] kpatch hello OK" >> "$LOG"

# Safe KPM load
for kpm in "$KPM_DIR"/*.kpm "$KPM_DIR"/*.ko "$KPM_DIR"/*.o; do
    [ -s "$kpm" ] || continue
    mod_basename=$(basename "$kpm" | sed 's/\.\(kpm\|ko\|o\)$//')
    args=""
    if [ -f "$KPM_EVENT_DIR/${mod_basename}.args" ]; then
        args="$(cat "$KPM_EVENT_DIR/${mod_basename}.args")"
    fi
    if ! kpatch kpm load "$kpm" $args; then
        echo "[$(date)] Failed to load: $(basename "$kpm"), moving to failed/" >> "$LOG"
        mv "$kpm" "$KPM_DIR/failed/$(basename "$kpm")"
    else
        echo "[$(date)] Loaded: $(basename "$kpm") args=[$args]" >> "$LOG"
    fi
done

# Rehook
if [ -n "$REHOOK" ]; then
    if [ "$REHOOK" = "enable" ] || [ "$REHOOK" = "disable" ]; then
        kpatch rehook $REHOOK
        echo "[$(date)] rehook $REHOOK" >> "$LOG"
    else
        rm -f "$KPNDIR/rehook"
    fi
fi

# Dispatch events
dispatch_event() {
    echo "[$(date)] Dispatching event: $1" >> "$LOG"
    kpatch event "$1" "" "" 2>/dev/null
}

dispatch_event "POST_FS_DATA"

# Wait for boot completion
until [ "$(getprop sys.boot_completed)" = "1" ]; do
    sleep 1
done

dispatch_event "BOOT_COMPLETED"

# Apply exclusion config
if [ -f "$CONFIG" ]; then
    tail -n +2 "$CONFIG" | while IFS=, read -r pkg exclude allow uid; do
        if [ "$exclude" = "1" ]; then
            UID=$(grep "^$pkg $uid" /data/system/packages.list 2>/dev/null | cut -d' ' -f2)
            [ -z "$UID" ] && UID=$(grep "^$pkg " /data/system/packages.list 2>/dev/null | cut -d' ' -f2)
            [ -n "$UID" ] && kpatch exclude_set "$UID" 1
        fi
    done
fi

echo "[$(date)] service.sh completed" >> "$LOG"
