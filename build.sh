#!/bin/bash

if [[ $1 == "clean" ]]; then
    rm -rf out module/bin module/webroot
    exit 0
fi

mkdir -p out module/bin module/webroot

# Build WebUI
cd webui
pnpm build || pnpm install && pnpm build
cd ..

# Read versions from version.properties
get_ver() {
    [ -f version.properties ] && grep "^$1[[:space:]]*=" version.properties | cut -d'=' -f2 | xargs | sed 's/^"//;s/"$//'
}

download_assets() {
    local repo="$1"
    local tag="$2"
    local outdir="$3"
    shift 3
    local patterns=("$@")

    local url="https://api.github.com/repos/$repo/releases"
    if [[ "$tag" == "latest" ]]; then
        url="$url/latest"
    else
        url="$url/tags/$tag"
    fi

    local release_json=$(curl -s "$url")

    for pattern in "${patterns[@]}"; do
        local regex="${pattern//\*/.*}"
        local asset_data=$(echo "$release_json" | jq -r ".assets[] | select(.name | test(\"$regex\")) | .name + \"\t\" + .browser_download_url" | head -n 1)
        if [[ -z "$asset_data" ]]; then
            echo "Error: Could not find asset matching $pattern in $repo $tag"
            continue
        fi
        local asset_name=$(echo "$asset_data" | cut -f1)
        local download_url=$(echo "$asset_data" | cut -f2)
        echo "Downloading $asset_name from $download_url"
        curl -L "$download_url" -o "$outdir/$asset_name"
    done
}

VERSION_KPATCH_NEXT=$(get_ver "kpatch-next")
VERSION_KPATCH_NEXT="${VERSION_KPATCH_NEXT:-latest}"
VERSION_KERNELPATCH=$(get_ver "kernelpatch")
VERSION_KERNELPATCH="${VERSION_KERNELPATCH:-latest}"
VERSION_MAGISKBOOT=$(get_ver "magiskboot")
VERSION_MAGISKBOOT="${VERSION_MAGISKBOOT:-latest}"

# Fetch KPatch-Next binaries → module/bin/kpatch-next/
mkdir -p module/bin/kpatch-next
if [[ ! -f "module/bin/kpatch-next/kpatch" || ! -f "module/bin/kpatch-next/kpimg" || ! -f "module/bin/kpatch-next/kptools" ]]; then
    download_assets "KernelSU-Next/KPatch-Next" "$VERSION_KPATCH_NEXT" "module/bin/kpatch-next" "kpatch-android" "kpimg-linux" "kptools-android"

    mv module/bin/kpatch-next/kpatch-android module/bin/kpatch-next/kpatch
    mv module/bin/kpatch-next/kptools-android module/bin/kpatch-next/kptools
    mv module/bin/kpatch-next/kpimg-linux module/bin/kpatch-next/kpimg
fi

# Fetch KernelPatch binaries → module/bin/kernelpatch/
mkdir -p module/bin/kernelpatch
if [[ ! -f "module/bin/kernelpatch/kpatch" || ! -f "module/bin/kernelpatch/kpimg" || ! -f "module/bin/kernelpatch/kptools" ]]; then
    download_assets "Zhanfg/KernelPatch-Public" "$VERSION_KERNELPATCH" "module/bin/kernelpatch" "kpuser.zip" "kpimg-linux" "kptools-android"

    # kpuser.zip contains the user-space binary
    cd module/bin/kernelpatch
    unzip -o kpuser.zip -d kpuser_tmp 2>/dev/null
    # Find the android binary (arm64)
    KPUSER=$(find kpuser_tmp -name "kpuser" -o -name "kpuser_*android*" -o -name "kpuser_*aarch64*" | head -n 1)
    if [[ -z "$KPUSER" ]]; then
        # fallback: take any binary
        KPUSER=$(find kpuser_tmp -type f ! -name "*.txt" ! -name "*.md" | head -n 1)
    fi
    [[ -n "$KPUSER" ]] && cp "$KPUSER" kpatch
    rm -rf kpuser_tmp kpuser.zip
    mv kptools-android kptools
    mv kpimg-linux kpimg
    cd ../../..
fi

# Default active binaries: copy KPatch-Next → module/bin/
# (customize.sh switches source at install time)
cp module/bin/kpatch-next/kpatch module/bin/kpatch 2>/dev/null
cp module/bin/kpatch-next/kptools module/bin/kptools 2>/dev/null
cp module/bin/kpatch-next/kpimg module/bin/kpimg 2>/dev/null

# Fetch magiskboot
if [[ ! -f "module/bin/magiskboot" ]]; then
    download_assets "topjohnwu/Magisk" "$VERSION_MAGISKBOOT" "module/bin" "Magisk*.apk"

    APK=$(ls module/bin/Magisk*.apk | head -n 1)
    unzip -p "$APK" 'lib/arm64-v8a/libmagiskboot.so' > "module/bin/magiskboot"
    rm "$APK"
fi

# zip module
commit_number=$(git rev-list --count HEAD)
commit_hash=$(git rev-parse --short HEAD)

cd module
zip -r ../out/KPatch-Next-${commit_number}-${commit_hash}.zip .
cd ..
