import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE projection_task_groups (
      task_group_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      has_custom_title INTEGER NOT NULL DEFAULT 0,
      color TEXT NOT NULL,
      pinned_at TEXT,
      pin_order_key TEXT,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )
  `;

  // ProjectionStore.listActiveShellIndex reads these fields from the index instead of parsing
  // every active thread's payload. Keep the expressions identical to that query's.
  yield* sql`DROP INDEX IF EXISTS orchestration_v2_projection_threads_active_shell_idx`;
  yield* sql`
    CREATE INDEX IF NOT EXISTS orchestration_v2_projection_threads_active_shell_idx
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
      CASE WHEN json_valid(payload_json) THEN json_type(payload_json, '$.pullRequests[0]') END,
      CASE WHEN json_valid(payload_json) THEN json_extract(payload_json, '$.sidebarParent.kind') END,
      CASE WHEN json_valid(payload_json) THEN json_extract(payload_json, '$.sidebarParent.threadId') END,
      CASE WHEN json_valid(payload_json) THEN json_extract(payload_json, '$.taskGroupId') END
    )
    WHERE deleted_at IS NULL AND archived_at IS NULL
  `;
  yield* sql`
    CREATE INDEX orchestration_v2_projection_threads_task_group_idx
    ON orchestration_v2_projection_threads(
      CASE WHEN json_valid(payload_json) THEN json_extract(payload_json, '$.taskGroupId') END,
      updated_at DESC, thread_id
    )
    WHERE deleted_at IS NULL
      AND CASE WHEN json_valid(payload_json) THEN json_extract(payload_json, '$.taskGroupId') END IS NOT NULL
  `;
  yield* sql`DROP INDEX idx_orchestration_events_application_high_water`;
  yield* sql`
    CREATE INDEX idx_orchestration_events_application_high_water
    ON orchestration_events(sequence)
    WHERE aggregate_kind IN ('project', 'task_group')
      OR (application_event_version = 2 AND aggregate_kind = 'thread')
  `;
});
