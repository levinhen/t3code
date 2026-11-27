import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const definition = (name: string) =>
    sql<{ readonly sql: string }>`
      SELECT sql FROM sqlite_schema WHERE type = 'index' AND name = ${name}
    `.pipe(Effect.map((rows) => rows[0]?.sql ?? ""));

  // Earlier fork builds redefined these two upstream indexes. Restore upstream's definitions
  // (migration 98 and the V2 sequence indexes) only where the fork's are still in place.
  if (/sidebarParent|taskGroupId/u.test(yield* definition("orchestration_v2_projection_threads_active_shell_idx"))) {
    yield* sql`DROP INDEX orchestration_v2_projection_threads_active_shell_idx`;
    yield* sql`
      CREATE INDEX orchestration_v2_projection_threads_active_shell_idx
      ON orchestration_v2_projection_threads(
        updated_at,
        thread_id,
        project_id,
        CASE WHEN json_valid(payload_json) THEN json_extract(payload_json, '$.lineage.relationshipToParent') END,
        CASE WHEN json_valid(payload_json) THEN json_extract(payload_json, '$.lineage.parentThreadId') END,
        CASE WHEN json_valid(payload_json) THEN json_extract(payload_json, '$.lineage.rootThreadId') END,
        CASE WHEN json_valid(payload_json) THEN json_extract(payload_json, '$.lineage.sideChat') END,
        CASE WHEN json_valid(payload_json) THEN json_extract(payload_json, '$.settledOverride') END,
        CASE WHEN json_valid(payload_json) THEN json_extract(payload_json, '$.settledAt') END,
        CASE WHEN json_valid(payload_json) THEN json_extract(payload_json, '$.pinnedAt') END,
        CASE WHEN json_valid(payload_json) THEN json_extract(payload_json, '$.pinOrderKey') END,
        CASE WHEN json_valid(payload_json) THEN json_extract(payload_json, '$.snoozedUntil') END,
        CASE WHEN json_valid(payload_json) THEN json_type(payload_json, '$.pullRequests[0]') END
      )
      WHERE deleted_at IS NULL AND archived_at IS NULL
    `;
  }
  if ((yield* definition("idx_orchestration_events_application_high_water")).includes("task_group")) {
    yield* sql`DROP INDEX idx_orchestration_events_application_high_water`;
    yield* sql`
      CREATE INDEX idx_orchestration_events_application_high_water
      ON orchestration_events(sequence)
      WHERE aggregate_kind = 'project'
        OR (application_event_version = 2 AND aggregate_kind = 'thread')
    `;
  }

  // ProjectionStore.listActiveShellIndex reads these fields from this index; keep the expressions
  // identical to that query's.
  yield* sql`
    CREATE INDEX fork_projection_threads_sidebar_idx
    ON orchestration_v2_projection_threads(
      thread_id,
      CASE WHEN json_valid(payload_json) THEN json_extract(payload_json, '$.sidebarParent.kind') END,
      CASE WHEN json_valid(payload_json) THEN json_extract(payload_json, '$.sidebarParent.threadId') END,
      CASE WHEN json_valid(payload_json) THEN json_extract(payload_json, '$.taskGroupId') END
    )
    WHERE deleted_at IS NULL
      AND archived_at IS NULL
      AND (
        CASE WHEN json_valid(payload_json) THEN json_extract(payload_json, '$.sidebarParent.kind') END IS NOT NULL
        OR CASE WHEN json_valid(payload_json) THEN json_extract(payload_json, '$.taskGroupId') END IS NOT NULL
      )
  `;
  yield* sql`
    CREATE INDEX fork_orchestration_events_application_high_water
    ON orchestration_events(sequence)
    WHERE aggregate_kind IN ('project', 'task_group')
      OR (application_event_version = 2 AND aggregate_kind = 'thread')
  `;
});
