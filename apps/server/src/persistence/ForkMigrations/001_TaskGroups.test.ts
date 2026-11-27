import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { hasPendingMigrations, migrationManifest, runMigrations } from "../Migrations.ts";

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

const shellIndexSql = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly sql: string }>`
    SELECT sql FROM sqlite_schema WHERE name = 'orchestration_v2_projection_threads_active_shell_idx'
  `;
  return rows[0]?.sql ?? "";
});

const insertGroup = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO projection_task_groups (task_group_id, title, color, created_at, updated_at)
    VALUES ('group', 'Runtime checks', 'cyan', '2026-11-26T00:00:00Z', '2026-11-26T00:00:00Z')
  `;
});

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))("fork 001_TaskGroups", (it) => {
  it.effect("adds task groups in the fork ledger, leaving upstream's ledger untouched", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();

      assert.deepStrictEqual(yield* upstreamHistory, migrationManifest);
      assert.deepStrictEqual(yield* forkHistory, [{ migration_id: 1, name: "TaskGroups" }]);
      assert.isFalse(yield* hasPendingMigrations());
      const indexSql = yield* shellIndexSql;
      assert.include(indexSql, "$.sidebarParent.threadId");
      assert.include(indexSql, "$.taskGroupId");
      yield* insertGroup;
      assert.deepStrictEqual(
        yield* sql`SELECT has_custom_title, archived_at, deleted_at FROM projection_task_groups`,
        [{ has_custom_title: 0, archived_at: null, deleted_at: null }],
      );
    }),
  );
});

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))("fork ledger upgrade", (it) => {
  it.effect("moves task groups that older fork builds recorded as 113 without losing groups", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();
      yield* insertGroup;
      yield* sql`DROP TABLE fork_sql_migrations`;
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (112, 'SidebarParentShellIndex'), (113, 'TaskGroups')
      `;
      assert.isTrue(yield* hasPendingMigrations());

      assert.deepStrictEqual(yield* runMigrations(), []);

      assert.deepStrictEqual(yield* upstreamHistory, migrationManifest);
      assert.deepStrictEqual(yield* forkHistory, [{ migration_id: 1, name: "TaskGroups" }]);
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
      yield* sql`DROP TABLE fork_sql_migrations`;
      yield* sql`DROP TABLE projection_task_groups`;
      yield* sql`DROP INDEX orchestration_v2_projection_threads_task_group_idx`;
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (112, 'SidebarParentShellIndex')
      `;

      yield* runMigrations();

      assert.deepStrictEqual(yield* upstreamHistory, migrationManifest);
      assert.deepStrictEqual(yield* forkHistory, [{ migration_id: 1, name: "TaskGroups" }]);
      assert.include(yield* shellIndexSql, "$.taskGroupId");
      yield* insertGroup;
    }),
  );
});
