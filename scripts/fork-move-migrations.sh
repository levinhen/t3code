#!/bin/bash
# Moves numbered migrations the fork added to upstream's Migrations/ into the fork ledger
# (ForkMigrations/, next fork id). Upstream keeps numbering past the fork's base, and the migrator
# skips every id up to the highest recorded, so a fork id there would block upstream's next ones.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
persistence="apps/server/src/persistence"
upstream_dir="$persistence/Migrations"
fork_dir="$persistence/ForkMigrations"

base="$(git -C "$repo" merge-base HEAD upstream/main 2>/dev/null || true)"
if [ -z "$base" ]; then
  echo "fork-move-migrations: no upstream/main to compare with; skipped." >&2
  exit 0
fi

added="$(
  {
    git -C "$repo" diff --name-only --diff-filter=A "$base" -- "$upstream_dir"
    git -C "$repo" ls-files --others --exclude-standard -- "$upstream_dir"
  } | grep -E "^$upstream_dir/[0-9]+_[A-Za-z0-9]+\.ts$" | sed "s#^$upstream_dir/##" | sort -n || true
)"
[ -z "$added" ] && exit 0

replace_file() {
  # $1: file, rest: command that reads the file on stdin and writes the new contents.
  local file="$1" tmp
  shift
  tmp="$(mktemp)"
  "$@" <"$file" >"$tmp"
  mv "$tmp" "$file"
}

move() {
  git -C "$repo" mv "$1" "$2" 2>/dev/null || mv "$repo/$1" "$repo/$2"
}

for file in $added; do
  id="${file%%_*}"
  name="${file#*_}"
  name="${name%.ts}"
  latest="$(
    ls "$repo/$fork_dir" | grep -E '^[0-9]+_[A-Za-z0-9]+\.ts$' | sed -E 's/^0*([0-9]+)_.*/\1/' |
      sort -n | tail -1
  )"
  next=$((${latest:-0} + 1))
  target="$(printf '%03d' "$next")_$name.ts"

  move "$upstream_dir/$file" "$fork_dir/$target"
  # Both directories sit in persistence/, so only same-directory imports change.
  replace_file "$repo/$fork_dir/$target" sed 's#from "\./#from "../Migrations/#'
  if [ -f "$repo/$upstream_dir/${file%.ts}.test.ts" ]; then
    move "$upstream_dir/${file%.ts}.test.ts" "$fork_dir/${target%.ts}.test.ts"
    replace_file "$repo/$fork_dir/${target%.ts}.test.ts" sed "s#\"\./${file%.ts}\.ts\"#\"./${target%.ts}.ts\"#"
  fi

  replace_file "$repo/$persistence/Migrations.ts" grep -v -E \
    "\"\./Migrations/${file%.ts}\.ts\"|^[[:space:]]*\[$id, \"$name\","
  replace_file "$repo/$persistence/forkMigrations.ts" awk \
    -v import_line="import Fork$name from \"./ForkMigrations/$target\";" \
    -v entry_line="  [$next, \"$name\", Fork$name]," '
      { lines[NR] = $0 }
      /^import Fork[A-Za-z0-9]+ from "\.\/ForkMigrations\// { last_import = NR }
      END {
        for (i = 1; i <= NR; i++) {
          if (lines[i] == "] as const;" && !entered) { print entry_line; entered = 1 }
          print lines[i]
          if (i == last_import) print import_line
        }
      }'
  if ! grep -qF "[$next, \"$name\", Fork$name]" "$repo/$persistence/forkMigrations.ts"; then
    echo "fork-move-migrations: could not register $target in forkMigrations.ts." >&2
    exit 1
  fi
  echo "Moved $upstream_dir/$file to $fork_dir/$target (fork migration $next). Commit it, and check"
  echo "  that its test no longer assumes upstream ids and that it redefines no upstream index."
done
