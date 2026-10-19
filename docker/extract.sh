#!/bin/sh
# Runs before the server starts: finds the game files in the read-only game-files folder (data packs, app packages and Sonic
# Origins audio; any name), identifies them and extracts what is missing or older than them into /app/data.
# Safe to run on every start.
set -u
cd /app
export RSDK_DIR="${RSDK_DIR:-/app/game-files}"
[ -d "$RSDK_DIR" ] || { echo "Game files folder not found: $RSDK_DIR" >&2; exit 1; }
npm ci --no-audit --no-fund >/dev/null 2>&1 || npm ci --no-audit --no-fund || exit 1
npx tsx tools/rsdk-detect.ts "$RSDK_DIR" || exit 1

stale() { # $1 = output file; true when missing or older than any game file
  [ ! -f "$1" ] && return 0
  [ -n "$(find "$RSDK_DIR" -maxdepth 1 \( -iname '*.rsdk' -o -iname '*.xmf' -o -iname '*.apk' -o -iname '*.apks' -o -iname '*.xapk' \
    -o -iname '*.ipa' -o -iname '*.acb' -o -iname '*.awb' \) -newer "$1" 2>/dev/null)" ]
}

# Packs contain patched scripts, so rebuilding images alone cannot update them.
script_hash=$(find tools games packages/engine/src/core -type f \( -name '*.ts' -o -name '*.json' \) \
  -exec sha256sum {} + | LC_ALL=C sort | sha256sum) || exit 1
source_hash=$(find "$RSDK_DIR" -maxdepth 1 -type f \( -iname '*.rsdk' -o -iname '*.xmf' -o -iname '*.apk' \
  -o -iname '*.apks' -o -iname '*.xapk' -o -iname '*.ipa' -o -iname '*.acb' -o -iname '*.awb' \) \
  -exec sha256sum {} + | LC_ALL=C sort | sha256sum) || exit 1
saved_hash=$(cat data/.extract-scripts.sha256 2>/dev/null || true)
saved_source_hash=$(cat data/.extract-sources.sha256 2>/dev/null || true)
sources_changed=false
[ "$source_hash" = "$saved_source_hash" ] || sources_changed=true
if [ "$script_hash" != "$saved_hash" ] || "$sources_changed" || stale data/sonic1/core.pak || stale data/sonic2/core.pak || stale data/soniccd/core.pak; then
  npx tsx tools/extract.ts --source "$RSDK_DIR" --out data || { echo "sonic 1/2/CD extraction failed" >&2; exit 1; }
  printf '%s\n' "$script_hash" > data/.extract-scripts.sha256 || exit 1
fi
if "$sources_changed" || stale data/sonic3/experimental.pak; then
  npx tsx tools/export-rsdkv5.ts || { echo "sonic 3 export failed" >&2; exit 1; }
fi
if "$sources_changed" || stale data/ui/sonic1/Title/Title.png; then
  npx tsx tools/extract-ui.ts --out data/ui || echo "ui sprite export failed"
fi
printf '%s\n' "$source_hash" > data/.extract-sources.sha256 || exit 1
exit 0
