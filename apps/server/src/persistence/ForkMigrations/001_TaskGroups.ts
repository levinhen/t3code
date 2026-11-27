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
  yield* sql`
    CREATE INDEX orchestration_v2_projection_threads_task_group_idx
    ON orchestration_v2_projection_threads(
      CASE WHEN json_valid(payload_json) THEN json_extract(payload_json, '$.taskGroupId') END,
      updated_at DESC, thread_id
    )
    WHERE deleted_at IS NULL
      AND CASE WHEN json_valid(payload_json) THEN json_extract(payload_json, '$.taskGroupId') END IS NOT NULL
  `;
});
