@AGENTS.md

## Fork: desktop app

- `scripts/fork-desktop-install.sh` builds this checkout and installs it as `/Applications/T3 Code (Fork).app` (`com.t3tools.t3code.fork`) beside the official app. Run it on the Mac. Without Rust it reuses the official app's resource monitor; it backs up `~/.t3/userdata/statev2.sqlite` to `~/.t3/backups` before installing.
- `scripts/fork-sign.sh <app>` signs with a self-signed identity kept in `~/.config/t3code-fork-signing` (created on first use). The install script calls it. Builds keep the same signing requirement, so Keychain "Always Allow" and macOS privacy grants carry over to later builds; deleting that keychain costs one more prompt. Never re-sign a running app.
- Both apps share `~/.t3/userdata` and the Electron profile, so only one runs at a time.
- A dev server (`vp run dev`) can start under the `mac` runner's sandbox (using `~/.t3/dev` or the worktree's `.t3`, never `~/.t3/userdata`): `/bin/ps` is allowed, and blocked reads of `~/.claude` / `~/.claude.json` / `~/.codex` only log non-fatal provider/telemetry warnings (the "Replay (dev)" provider works without them).
- `scripts/fork-backup.sh install` sets up a launchd job that copies `statev2.sqlite` to `~/.t3/backups/daily` at most once a day, keeping 7. `uninstall` removes it. The `mac` runner can write `~/Library/LaunchAgents/local.t3code-*.plist` and run `launchctl bootout` (`uninstall` works), but `launchd` blocks `launchctl bootstrap` from inside any Seatbelt sandbox (`Input/output error`), so `install` (loading the job) still needs to run from Mac Terminal. To restore, quit T3 Code, delete `statev2.sqlite-wal` and `statev2.sqlite-shm` (a stale WAL would be replayed onto the restored file), then copy a backup over `statev2.sqlite`.
