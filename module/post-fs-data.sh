#!/system/bin/sh

MODDIR=${0%/*}
SERVICE_D="/data/adb/service.d"
STATUS_SH="$SERVICE_D/kp-next.sh"
KPNDIR="/data/adb/kp-next"
BOOT_COUNT_FILE="$KPNDIR/boot_count"
AUTORECOVERY_MARKER="$KPNDIR/autorecovery_active"

mkdir -p "$SERVICE_D" "$KPNDIR"
cp "$MODDIR/status.sh" "$STATUS_SH"
chmod 755 "$STATUS_SH"

# ============================================================
# Bootloop Auto-Recovery counter
# - Increments on every post-fs-data.sh run.
# - If counter reaches >= 3 consecutive failed boots, do NOT
#   increment further; instead signal auto-unpatch by leaving
#   the marker file. service.sh will reset it on a healthy boot.
# ============================================================
current_count=0
if [ -f "$BOOT_COUNT_FILE" ]; then
    current_count=$(cat "$BOOT_COUNT_FILE" 2>/dev/null)
    # Sanitize to digits
    current_count=$(printf '%s' "$current_count" | tr -cd '0-9')
    [ -n "$current_count" ] || current_count=0
fi

if [ "$current_count" -ge 3 ]; then
    # Bootloop detected — signal auto-unpatch. Counter stays at 3
    # so we never miss the signal until service.sh clears it.
    touch "$AUTORECOVERY_MARKER"
    # Mark auto-unpatch request for boot_unpatch.sh consumers (e.g. WebUI action).
    touch "$KPNDIR/auto_unpatch_requested"
else
    current_count=$((current_count + 1))
    echo "$current_count" > "$BOOT_COUNT_FILE"
    # If we just transitioned into the danger zone this boot, surface it.
    if [ "$current_count" -ge 3 ]; then
        touch "$AUTORECOVERY_MARKER"
        touch "$KPNDIR/auto_unpatch_requested"
    else
        rm -f "$AUTORECOVERY_MARKER" "$KPNDIR/auto_unpatch_requested"
    fi
fi
