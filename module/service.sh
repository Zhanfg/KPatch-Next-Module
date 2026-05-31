#!/bin/sh

MODDIR=${0%/*}
KPNDIR="/data/adb/kp-next"
PATH="$MODDIR/bin:$PATH"
CONFIG="$KPNDIR/package_config"
REHOOK="$(cat $KPNDIR/rehook)"
LOG="$KPNDIR/service.log"

# Rotate log on boot
mkdir -p "$KPNDIR"
echo "=== $(date) service.sh started ===" > "$LOG"

# Retry kpatch hello
retries=0
while [ -z "$(kpatch hello)" ] && [ $retries -lt 3 ]; do
    echo "[$(date)] kpatch hello attempt $((retries + 1)) failed, retrying..." >> "$LOG"
    sleep 2
    retries=$((retries + 1))
done
if [ -z "$(kpatch hello)" ]; then
    echo "[$(date)] kpatch hello failed after $retries retries" >> "$LOG"
    touch "$MODDIR/unresolved"
    exit 0
fi

echo "[$(date)] kpatch hello OK" >> "$LOG"

# Safe KPM load — move failures to failed/ instead of deleting
mkdir -p "$KPNDIR/kpm/failed"
for kpm in $KPNDIR/kpm/*.kpm; do
    [ -s "$kpm" ] || continue
    if ! kpatch kpm load "$kpm"; then
        echo "[$(date)] Failed to load KPM: $(basename "$kpm"), moving to failed/" >> "$LOG"
        mv "$kpm" "$KPNDIR/kpm/failed/$(basename "$kpm")"
    else
        echo "[$(date)] Loaded KPM: $(basename "$kpm")" >> "$LOG"
    fi
done

if [ -n "$REHOOK" ]; then
    if [ "$REHOOK" = "enable" ] || [ "$REHOOK" = "disable" ]; then
        kpatch rehook $REHOOK
        echo "[$(date)] rehook $REHOOK" >> "$LOG"
    else
        rm -f "$KPNDIR/rehook"
    fi
fi

until [ "$(getprop sys.boot_completed)" = "1" ]; do
    sleep 1
done

[ -f "$CONFIG" ] || exit 0

tail -n +2 "$CONFIG" | while IFS=, read -r pkg exclude allow uid; do
    if [ "$exclude" = "1" ]; then
        # priotize uid if exists
        UID=$(grep "^$pkg $uid" /data/system/packages.list | cut -d' ' -f2)
        # fallback to package name based
        [ -z "$UID" ] && UID=$(grep "^$pkg " /data/system/packages.list | cut -d' ' -f2)
        [ -n "$UID" ] && kpatch exclude_set "$UID" 1
    fi
done

echo "[$(date)] service.sh completed" >> "$LOG"
