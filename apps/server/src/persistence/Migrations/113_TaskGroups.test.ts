import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { runMigrations } from "../Migrations.ts";

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))("113_TaskGroups", (it) => {
  it.effect("upgrades the thread shell index and creates the task group projection", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 112 });
      const indexSql = sql<{ sql: string }>`
        SELECT sql FROM sqlite_schema WHERE name = 'orchestration_v2_projection_threads_active_shell_idx'
      `;
      const before = (yield* indexSql)[0]?.sql ?? "";
      assert.include(before, "$.sidebarParent.threadId");
      yield* runMigrations();
      const after = (yield* indexSql)[0]?.sql ?? "";
      assert.equal(
        after.replace(
          /,\s*CASE WHEN json_valid\(payload_json\) THEN json_extract\(payload_json, '\$\.taskGroupId'\) END/u,
          "",
        ),
        before,
      );
      yield* sql`
        INSERT INTO projection_task_groups (task_group_id, title, color, created_at, updated_at)
        VALUES ('group', 'Runtime checks', 'cyan', '2026-11-26T00:00:00Z', '2026-11-26T00:00:00Z')
      `;
      assert.deepEqual(
        yield* sql`SELECT has_custom_title, archived_at, deleted_at FROM projection_task_groups`,
        [{ has_custom_title: 0, archived_at: null, deleted_at: null }],
      );
    }),
  );
});
