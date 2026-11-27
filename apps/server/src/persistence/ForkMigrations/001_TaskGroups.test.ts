import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { hasPendingMigrations, migrationManifest, runMigrations } from "../Migrations.ts";

const FORK_HISTORY = [
  { migration_id: 1, name: "TaskGroups" },
  { migration_id: 2, name: "OwnIndexes" },
];

const upstreamHistory = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly migration_id: number; readonly name: string }>`
    SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
  `;
  return rows.map((row) => [row.migration_id, row.name] as const);
});

const forkHistory = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql`SELECT migration_id, name FROM fork_sql_migrations ORDER BY migration_id`;
});

// Restored definitions match upstream's up to whitespace and IF NOT EXISTS.
const indexDefinitions = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly name: string; readonly sql: string }>`
    SELECT name, sql FROM sqlite_schema
    WHERE type = 'index' AND name IN (
      'orchestration_v2_projection_threads_active_shell_idx',
      'idx_orchestration_events_application_high_water',
      'fork_projection_threads_sidebar_idx',
      'fork_orchestration_events_application_high_water',
      'orchestration_v2_projection_threads_task_group_idx'
    )
    ORDER BY name
  `;
  return rows.map((row) => ({
    name: row.name,
    sql: row.sql
      .replace(/ IF NOT EXISTS/u, "")
      .replace(/\s+/gu, " ")
      .replace(/\( /gu, "(")
      .replace(/ \)/gu, ")"),
  }));
});

const insertGroup = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO projection_task_groups (task_group_id, title, color, created_at, updated_at)
    VALUES ('group', 'Runtime checks', 'cyan', '2026-11-26T00:00:00Z', '2026-11-26T00:00:00Z')
  `;
});

const field = (path: string) =>
  `CASE WHEN json_valid(payload_json) THEN json_extract(payload_json, '${path}') END`;

// What fork builds before the fork ledger left on a database: upstream's two indexes redefined.
const restoreOldForkIndexes = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const shell = yield* sql<{ readonly sql: string }>`
    SELECT sql FROM sqlite_schema WHERE name = 'orchestration_v2_projection_threads_active_shell_idx'
  `;
  yield* sql`DROP INDEX orchestration_v2_projection_threads_active_shell_idx`;
  yield* sql.unsafe(
    shell[0]!.sql.replace(
      /\)\s*WHERE deleted_at/u,
      `, ${field("$.sidebarParent.kind")}, ${field("$.sidebarParent.threadId")}, ${field("$.taskGroupId")}) WHERE deleted_at`,
    ),
  );
  yield* sql`DROP INDEX idx_orchestration_events_application_high_water`;
  yield* sql`
    CREATE INDEX idx_orchestration_events_application_high_water
    ON orchestration_events(sequence)
    WHERE aggregate_kind IN ('project', 'task_group')
      OR (application_event_version = 2 AND aggregate_kind = 'thread')
  `;
  yield* sql`DROP INDEX fork_projection_threads_sidebar_idx`;
  yield* sql`DROP INDEX fork_orchestration_events_application_high_water`;
});

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))("fork migrations", (it) => {
  it.effect("add task groups and fork indexes without touching upstream's ledger or indexes", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();

      assert.deepStrictEqual(yield* upstreamHistory, migrationManifest);
      assert.deepStrictEqual(yield* forkHistory, FORK_HISTORY);
      assert.isFalse(yield* hasPendingMigrations());
      const indexes = yield* indexDefinitions;
      assert.lengthOf(indexes, 5);
      for (const upstream of indexes.filter((index) => !index.name.startsWith("fork_"))) {
        if (upstream.name.endsWith("task_group_idx")) continue;
        assert.notMatch(upstream.sql, /sidebarParent|taskGroupId|task_group/u);
      }
      yield* insertGroup;
      assert.deepStrictEqual(
        yield* sql`SELECT has_custom_title, archived_at, deleted_at FROM projection_task_groups`,
        [{ has_custom_title: 0, archived_at: null, deleted_at: null }],
      );
    }),
  );
});

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))("fork index upgrade", (it) => {
  it.effect("puts back upstream's index definitions an earlier fork build replaced", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();
      const fresh = yield* indexDefinitions;
      yield* restoreOldForkIndexes;
      yield* sql`DELETE FROM fork_sql_migrations WHERE migration_id = 2`;
      assert.isTrue(yield* hasPendingMigrations());

      yield* runMigrations();

      assert.deepStrictEqual(yield* indexDefinitions, fresh);
      assert.deepStrictEqual(yield* forkHistory, FORK_HISTORY);
    }),
  );
});

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))("fork ledger upgrade", (it) => {
  it.effect("moves task groups that older fork builds recorded as 113 without losing groups", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();
      const fresh = yield* indexDefinitions;
      yield* insertGroup;
      yield* restoreOldForkIndexes;
      yield* sql`DROP TABLE fork_sql_migrations`;
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (112, 'SidebarParentShellIndex'), (113, 'TaskGroups')
      `;
      assert.isTrue(yield* hasPendingMigrations());

      assert.deepStrictEqual(yield* runMigrations(), []);

      assert.deepStrictEqual(yield* upstreamHistory, migrationManifest);
      assert.deepStrictEqual(yield* forkHistory, FORK_HISTORY);
      assert.deepStrictEqual(yield* indexDefinitions, fresh);
      assert.deepStrictEqual(yield* sql`SELECT task_group_id FROM projection_task_groups`, [
        { task_group_id: "group" },
      ]);
      assert.isFalse(yield* hasPendingMigrations());
    }),
  );
});

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))("fork ledger upgrade at 112", (it) => {
  it.effect("runs task groups on a database an older fork build left at 112", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();
      const fresh = yield* indexDefinitions;
      yield* restoreOldForkIndexes;
      yield* sql`DROP TABLE fork_sql_migrations`;
      yield* sql`DROP TABLE projection_task_groups`;
      yield* sql`DROP INDEX orchestration_v2_projection_threads_task_group_idx`;
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (112, 'SidebarParentShellIndex')
      `;

      yield* runMigrations();

      assert.deepStrictEqual(yield* upstreamHistory, migrationManifest);
      assert.deepStrictEqual(yield* forkHistory, FORK_HISTORY);
      assert.deepStrictEqual(yield* indexDefinitions, fresh);
      yield* insertGroup;
    }),
  );
});
