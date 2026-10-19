#!/bin/sh
# Runs before the server starts: finds the game files in the project folder (data packs, app packages and Sonic
# Origins audio; any name), identifies them and extracts what is missing or older than them into /app/data.
# Safe to run on every start.
set -u
cd /app
npm ci --no-audit --no-fund >/dev/null 2>&1 || npm ci --no-audit --no-fund || exit 1
npx tsx tools/rsdk-detect.ts /app

stale() { # $1 = output file; true when missing or older than any game file
  [ ! -f "$1" ] && return 0
  [ -n "$(find /app -maxdepth 1 \( -iname '*.rsdk' -o -iname '*.xmf' -o -iname '*.apk' -o -iname '*.apks' -o -iname '*.xapk' \
    -o -iname '*.ipa' -o -iname '*.acb' -o -iname '*.awb' \) -newer "$1" 2>/dev/null)" ]
}

if stale data/sonic1/core.pak || stale data/sonic2/core.pak; then
  npx tsx tools/extract.ts --out data || echo "sonic 1/2 extraction failed"
fi
if stale data/sonic3/experimental.pak; then
  npx tsx tools/export-rsdkv5.ts || echo "sonic 3 export failed"
fi
exit 0
