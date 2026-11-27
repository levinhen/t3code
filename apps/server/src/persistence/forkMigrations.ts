import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

import ForkTaskGroups from "./ForkMigrations/001_TaskGroups.ts";
import ForkOwnIndexes from "./ForkMigrations/002_OwnIndexes.ts";

// The migrator skips every id up to the highest recorded, so fork ids in effect_sql_migrations
// would swallow upstream's next migrations. Fork schema runs after upstream's, in its own ledger,
// and never redefines an upstream table or index: fork reads use fork-named indexes.
const FORK_LEDGER = "fork_sql_migrations";

const forkMigrationEntries = [
  [1, "TaskGroups", ForkTaskGroups],
  [2, "OwnIndexes", ForkOwnIndexes],
] as const;
const forkHead = Math.max(...forkMigrationEntries.map(([id]) => id));

const run = Migrator.make({});

const tableExists = Effect.fn("forkMigrations.tableExists")(function* (table: string) {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${table}`;
  return rows.length > 0;
});

// Fork builds before 2026-11-27 recorded their migrations in upstream's ledger at ids upstream reuses.
const legacyForkRows = Effect.fn("forkMigrations.legacyForkRows")(function* () {
  if (!(yield* tableExists("effect_sql_migrations"))) return [];
  const sql = yield* SqlClient.SqlClient;
  return yield* sql<{ readonly migration_id: number }>`
    SELECT migration_id FROM effect_sql_migrations
    WHERE (migration_id = 112 AND name = 'SidebarParentShellIndex')
      OR (migration_id = 113 AND name = 'TaskGroups')
  `;
});

const forkLedgerBehind = Effect.fn("forkMigrations.forkLedgerBehind")(function* () {
  if (!(yield* tableExists(FORK_LEDGER))) return true;
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly latestId: number | null }>`
    SELECT MAX(migration_id) AS latestId FROM ${sql(FORK_LEDGER)}
  `;
  return (rows[0]?.latestId ?? 0) < forkHead;
});

export const hasPendingForkMigrations = Effect.fn("hasPendingForkMigrations")(function* () {
  return (yield* legacyForkRows()).length > 0 || (yield* forkLedgerBehind());
});

/** Moves rows older fork builds left in upstream's ledger into the fork ledger, without rerunning them. */
export const reconcileLegacyForkLedger = Effect.fn("reconcileLegacyForkLedger")(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.withTransaction(
    Effect.gen(function* () {
      const legacy = yield* legacyForkRows();
      if (legacy.length === 0) return;
      // An empty run creates the fork ledger with the migrator's own schema.
      yield* run({ loader: Migrator.fromRecord({}), table: FORK_LEDGER });
      // A database recorded at 112 never ran TaskGroups, so it still runs below.
      if (legacy.some((row) => row.migration_id === 113)) {
        yield* sql`INSERT OR IGNORE INTO ${sql(FORK_LEDGER)} (migration_id, name) VALUES (1, 'TaskGroups')`;
      }
      yield* sql`
        DELETE FROM effect_sql_migrations
        WHERE (migration_id = 112 AND name = 'SidebarParentShellIndex')
          OR (migration_id = 113 AND name = 'TaskGroups')
      `;
    }),
  );
});

export const runForkMigrations = Effect.fn("runForkMigrations")(function* () {
  if (!(yield* forkLedgerBehind())) return [];
  return yield* run({
    loader: Migrator.fromRecord(
      Object.fromEntries(
        forkMigrationEntries.map(([id, name, migration]) => [`${id}_${name}`, migration]),
      ),
    ),
    table: FORK_LEDGER,
  });
});
