#!/bin/bash
# Builds this checkout's desktop app and installs it as "T3 Code (Fork)" beside the official app.
# Both apps use ~/.t3/userdata and the same Electron profile, so only one can run at a time:
# quit one before opening the other.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
app_name="T3 Code (Fork)"
bundle_id="com.t3tools.t3code.fork"
dest="/Applications/${app_name}.app"
official="/Applications/T3 Code (Beta).app"
out="$repo/.t3/fork-desktop-build"
backup_dir="$HOME/.t3/backups"

bash "$repo/scripts/fork-move-migrations.sh"

base="$(node -p "require('$repo/apps/desktop/package.json').version")"
# A preview version has no update feed, so no updater replaces this build. The next patch keeps it
# ordered after the release it was built from.
build_version="${base%.*}.$((${base##*.} + 1))-preview.$(date +%Y%m%d).$(date +%H%M)"

monitor="$repo/native/resource-monitor/target/aarch64-apple-darwin/release/t3-resource-monitor"
reuse_monitor=0
if ! command -v cargo >/dev/null 2>&1; then
  # Without Rust, reuse the official app's resource monitor binary.
  mkdir -p "$(dirname "$monitor")"
  cp "$official/Contents/Resources/resource-monitor/t3-resource-monitor" "$monitor"
  reuse_monitor=1
fi

rm -rf "$out"
(cd "$repo" && T3CODE_DESKTOP_REUSE_RESOURCE_MONITOR=$reuse_monitor node scripts/build-desktop-artifact.ts \
  --platform mac --target dir --arch arm64 --build-version "$build_version" --output-dir "$out")
built="$(ls -d "$out"/mac-arm64/*.app | head -1)"

# Replacing or re-signing a running app breaks it, so build first and swap once it has quit.
while pgrep -qf '/Applications/T3 Code \(Fork\)\.app/Contents/MacOS/'; do
  echo "Built. Quit $app_name to finish installing..."
  sleep 3
done

# The fork applies newer migrations to the shared database; keep a copy from before this build.
db="$HOME/.t3/userdata/statev2.sqlite"
if [ -f "$db" ]; then
  mkdir -p "$backup_dir"
  tmp="$backup_dir/.partial.sqlite"
  rm -f "$tmp" "$tmp-wal" "$tmp-shm"
  if [ -f "$db-wal" ] && [ -f "$db-shm" ]; then
    sqlite3 -readonly "$db" ".backup '$tmp'"
  else
    # A closed WAL database has no -shm, so sqlite3 -readonly cannot open it.
    cp "$db" "$tmp"
    if [ -f "$db-wal" ]; then
      cp "$db-wal" "$tmp-wal"
    fi
  fi
  sqlite3 "$tmp" "PRAGMA journal_mode=DELETE;" >/dev/null
  rm -f "$tmp-wal" "$tmp-shm"
  mv "$tmp" "$backup_dir/statev2-before-fork-$build_version.sqlite"
fi

rm -rf "$dest"
ditto "$built" "$dest"
plist="$dest/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $bundle_id" "$plist"
# Leave CFBundleName alone: Electron finds "<CFBundleName> Helper.app" at startup and aborts if it is missing.
/usr/libexec/PlistBuddy -c "Delete :CFBundleDisplayName" "$plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string $app_name" "$plist"
bash "$repo/scripts/fork-sign.sh" "$dest"

echo "Installed $dest ($build_version)."
