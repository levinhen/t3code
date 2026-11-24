@AGENTS.md

## Fork: desktop app

- `scripts/fork-desktop-install.sh` builds this checkout and installs it as `/Applications/T3 Code (Fork).app` (`com.t3tools.t3code.fork`) beside the official app. Run it on the Mac. Without Rust it reuses the official app's resource monitor; it backs up `~/.t3/userdata/statev2.sqlite` to `~/.t3/backups` before installing.
- Both apps share `~/.t3/userdata` and the Electron profile, so only one runs at a time.
- A dev server cannot start under the `mac` runner's sandbox: it blocks `/bin/ps` and the provider auth files.
