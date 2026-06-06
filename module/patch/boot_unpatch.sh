#!/system/bin/sh
#######################################################################################
# APatch Boot Image Unpatcher
# Imported from https://github.com/bmax121/APatch/blob/main/app/src/main/assets/boot_unpatch.sh
#######################################################################################

MODPATH=${0%/*}
ARCH=$(getprop ro.product.cpu.abi)
KPNDIR="/data/adb/kp-next"
BACKUP_DIR="$KPNDIR/backup"
AUTORECOVERY_MARKER="$KPNDIR/autorecovery_active"

# Load utility functions
. "$MODPATH/util_functions.sh"

BOOTIMAGE=$1

# ============================================================
# auto_unpatch()
# Bootloop Auto-Recovery entry point.
# Flashes back the LATEST backup boot image from
# /data/adb/kp-next/backup/ to the active boot slot.
# Leaves the autorecovery_active marker in place until a
# healthy boot clears it (so the WebUI can show the status).
# Returns 0 on success, non-zero on failure.
# ============================================================
auto_unpatch() {
    if [ -z "$BOOTIMAGE" ] || [ ! -e "$BOOTIMAGE" ]; then
        >&2 echo "! auto_unpatch: BOOTIMAGE not set or missing ($BOOTIMAGE)"
        return 1
    fi

    command -v flash_image >/dev/null 2>&1 || {
        >&2 echo "! auto_unpatch: flash_image function not available"
        return 2
    }

    if [ ! -d "$BACKUP_DIR" ]; then
        >&2 echo "! auto_unpatch: backup dir not found: $BACKUP_DIR"
        return 3
    fi

    # Pick the newest backup by modification time.
    latest_backup=$(ls -1t "$BACKUP_DIR"/boot_backup_*.img 2>/dev/null | head -n 1)
    if [ -z "$latest_backup" ] || [ ! -f "$latest_backup" ]; then
        >&2 echo "! auto_unpatch: no backup images in $BACKUP_DIR"
        return 4
    fi

    echo "- auto_unpatch: using latest backup: $latest_backup"

    if ! flash_image "$latest_backup" "$BOOTIMAGE"; then
        >&2 echo "! auto_unpatch: flash failed"
        return 5
    fi

    # Best-effort cleanup of the counter so we don't immediately
    # re-trigger on the next boot. Keep the marker so the WebUI
    # can show that auto-recovery was activated.
    echo "0" > "$KPNDIR/boot_count" 2>/dev/null
    echo "- auto_unpatch: flash successful"
    return 0
}

[ -e "$BOOTIMAGE" ] || { echo "- $BOOTIMAGE does not exist!"; exit 1; }

echo "- Target image: $BOOTIMAGE"

  # Check for dependencies
command -v magiskboot >/dev/null 2>&1 || { echo "- Command magiskboot not found!"; exit 1; }
command -v kptools >/dev/null 2>&1 || { echo "- Command kptools not found!"; exit 1; }

if [ ! -f kernel ]; then
echo "- Unpacking boot image"
magiskboot unpack "$BOOTIMAGE" >/dev/null 2>&1
if [ $? -ne 0 ]; then
    >&2 echo "! Unpack error: $?"
    exit 1
  fi
fi

if [ -n "$(kptools -i kernel -l 2>/dev/null | grep patched=false)" ]; then
	echo "- kernel has been patched "
  if [ -f "new-boot.img" ]; then
    echo "- found backup boot.img ,use it for recovery"
  else
    mv kernel kernel.ori
    echo "- Unpatching kernel"
    kptools -u --image kernel.ori --out kernel
    if [ $? -ne 0 ]; then
      >&2 echo "! Unpatch error: $?"
      exit 1
    fi
    echo "- Repacking boot image"
    magiskboot repack "$BOOTIMAGE" >/dev/null 2>&1
    if [ $? -ne 0 ]; then
      >&2 echo "! Repack error: $?"
      exit 1
    fi
  fi

else
  echo "- no need unpatch"
  exit 0
fi

if [ -f "new-boot.img" ]; then
  echo "- Flashing boot image"
  flash_image new-boot.img "$BOOTIMAGE"

  if [ $? -ne 0 ]; then
    >&2 echo "! Flash error: $?"
    save_image_to_storage "new-boot.img"
    exit 1
  fi
fi

echo "- Flash successful"

# Reset any error code
true
