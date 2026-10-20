#!/bin/sh
# Run with sh tests/docker-extract.test.sh from the repository root.
set -eu
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin" "$work/tools" "$work/games/soniccd" "$work/packages/engine/src/core"
mkdir -p "$work/game-files"
printf 'original game data\n' > "$work/game-files/SonicCDu.rsdk"
printf 'original audio\n' > "$work/game-files/SCD_music.acb"
cp "$work/game-files/SonicCDu.rsdk" "$work/original.rsdk"
cp "$work/game-files/SCD_music.acb" "$work/original.acb"
mkdir -p "$work/data/sonic3"
touch "$work/data/sonic3/experimental.pak"
printf 'original\n' > "$work/games/soniccd/patches.ts"
sed "s|/app|$work|g" docker/extract.sh > "$work/extract.sh"
cat > "$work/bin/npm" <<'EOF'
#!/bin/sh
echo "Dependencies must be installed at image build time, not during extraction" >&2
exit 1
EOF
cat > "$work/bin/npx" <<'EOF'
#!/bin/sh
if [ "$RSDK_DIR" != "$PWD/game-files" ]; then
  echo "Wrong game files directory: $RSDK_DIR" >&2
  exit 1
fi
if [ "$2" = tools/rsdk-detect.ts ]; then
  [ "$3" = "$RSDK_DIR" ] || exit 1
fi
if [ "$2" = tools/extract-ui.ts ]; then
  printf 'ui\n' >> ui-calls
  for game in sonic1 sonic2 soniccd; do
    mkdir -p "data/ui/$game"
    touch "data/ui/$game/ui.json"
  done
fi
if [ "$2" = tools/extract.ts ]; then
  [ "$3" = --source ] && [ "$4" = "$RSDK_DIR" ] || exit 1
  printf 'extract\n' >> calls
  [ ! -f fail-extraction ] || exit 1
  for game in sonic1 sonic2 soniccd; do
    mkdir -p "data/$game"
    touch "data/$game/core.pak"
  done
fi
EOF
chmod +x "$work/bin/npm" "$work/bin/npx"
export PATH="$work/bin:$PATH"

run_extract() { RSDK_DIR="$work/game-files" sh "$work/extract.sh"; }
assert_calls() {
  actual=$(wc -l < "$work/calls" | tr -d ' ')
  [ "$actual" = "$1" ] || { echo "Expected $1 extractions, got $actual" >&2; exit 1; }
}

# Existing, unpatched packs must be refreshed on the first run after this fix.
for game in sonic1 sonic2 soniccd; do
  mkdir -p "$work/data/$game"
  touch "$work/data/$game/core.pak"
done
run_extract
assert_calls 1
run_extract
assert_calls 1
# UI artwork is rendered once from the new packs, then left alone until they change.
[ "$(wc -l < "$work/ui-calls" | tr -d ' ')" = 1 ] || { echo "UI artwork should be rendered once" >&2; exit 1; }

# Content, not timestamps, determines whether patched scripts have changed.
printf 'co-op patch\n' > "$work/games/soniccd/patches.ts"
run_extract
assert_calls 2

# CD must be checked even when the other games and script hash are current.
rm "$work/data/soniccd/core.pak"
run_extract
assert_calls 3

# A failed extraction must block startup and remain eligible for retry.
old_hash=$(cat "$work/data/.extract-scripts.sha256")
printf 'next patch\n' > "$work/games/soniccd/patches.ts"
touch "$work/fail-extraction"
if run_extract; then
  echo "Extraction failure incorrectly reported success" >&2
  exit 1
fi
[ "$(cat "$work/data/.extract-scripts.sha256")" = "$old_hash" ]
assert_calls 4
rm "$work/fail-extraction"
run_extract
assert_calls 5
run_extract
assert_calls 5

# Replacing an input with an older timestamp must still trigger extraction.
printf 'updated game data\n' > "$work/game-files/SonicCDu.rsdk"
touch -t 200001010000 "$work/game-files/SonicCDu.rsdk"
run_extract
assert_calls 6
printf 'updated game data\n' > "$work/updated.rsdk"
cmp "$work/game-files/SonicCDu.rsdk" "$work/updated.rsdk"
cmp "$work/game-files/SCD_music.acb" "$work/original.acb"
run_extract
assert_calls 6

# Audio-only additions trigger processing without deleting the originals.
printf 'new sound effects\n' > "$work/game-files/SCD_sfx.awb"
run_extract
assert_calls 7
[ -f "$work/game-files/SCD_sfx.awb" ]
cmp "$work/game-files/SonicCDu.rsdk" "$work/updated.rsdk"
cmp "$work/game-files/SCD_music.acb" "$work/original.acb"

# Ignore arbitrary contents, not just recognized game-file extensions.
git check-ignore --no-index -q game-files/notes.txt
git check-ignore --no-index -q game-files/nested/file.txt
if git check-ignore --no-index -q game-files/.gitkeep; then
  echo "The folder placeholder must not be ignored" >&2
  exit 1
fi
echo "Docker extraction freshness tests passed"
