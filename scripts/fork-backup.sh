#!/bin/bash
# Daily backup of the shared T3 Code database (~/.t3/userdata/statev2.sqlite), keeping the newest 7.
#   scripts/fork-backup.sh install    run it hourly through launchd; backs up at most once a day
#   scripts/fork-backup.sh uninstall  remove the launchd job; existing backups stay
#   scripts/fork-backup.sh            back up now unless today's backup exists
set -euo pipefail

label="local.t3code-fork-backup"
dir="$HOME/.t3/backups/daily"
db="$HOME/.t3/userdata/statev2.sqlite"
installed="$dir/fork-backup.sh"
plist="$HOME/Library/LaunchAgents/$label.plist"
keep=7

case "${1:-}" in
  install)
    mkdir -p "$dir"
    # launchd runs a copy, so checking out a branch without this script cannot stop backups.
    [ "$0" -ef "$installed" ] || cp "$0" "$installed"
    cat >"$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$installed</string></array>
  <key>StartInterval</key><integer>3600</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardErrorPath</key><string>$dir/backup.log</string>
</dict>
</plist>
EOF
    launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$plist"
    echo "Installed $label. Backups go to $dir."
    exit 0
    ;;
  uninstall)
    launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
    rm -f "$plist" "$installed"
    echo "Removed $label. Backups in $dir are kept."
    exit 0
    ;;
  "") ;;
  *)
    echo "usage: $0 [install|uninstall]" >&2
    exit 2
    ;;
esac

today="$dir/statev2-$(date +%Y%m%d).sqlite"
[ -f "$today" ] && exit 0
# A read-only open of a WAL database needs its -wal/-shm files, which exist only while T3 Code
# runs. The data cannot change while it is closed, so the next hourly run catches up.
[ -f "$db-wal" ] && [ -f "$db-shm" ] || exit 0

mkdir -p "$dir"
tmp="$dir/.partial.sqlite"
rm -f "$tmp" "$tmp-wal" "$tmp-shm"
sqlite3 -readonly "$db" ".backup '$tmp'"
# Make the copy one self-contained file; the server switches it back to WAL when it opens it.
sqlite3 "$tmp" "PRAGMA journal_mode=DELETE;" >/dev/null
rm -f "$tmp-shm"
mv "$tmp" "$today"

ls -1 "$dir"/statev2-*.sqlite | sort -r | tail -n +$((keep + 1)) | while read -r old; do
  rm -f "$old"
done
