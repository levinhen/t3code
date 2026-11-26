import {
  type ApplicationTaskGroupEvent,
  IsoDateTime,
  type MessageId,
  ProjectId,
  OrchestrationTaskGroupShell,
  TaskGroupId,
  ThreadId,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import { messageSearchText } from "./messageSearchIndex.ts";

export class TaskGroupStoreError extends Schema.TaggedError<TaskGroupStoreError>()(
  "TaskGroupStoreError",
  { operation: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Task group store operation '${this.operation}' failed.`;
  }
}

const TaskGroupDbRow = OrchestrationTaskGroupShell.mapFields((fields) => ({
  ...fields,
  hasCustomTitle: Schema.BooleanFromBit,
  deletedAt: Schema.NullOr(IsoDateTime),
}));

interface TaskGroupTitleContextRow {
  readonly projectId: ProjectId;
  readonly title: string;
  readonly message: string | null;
}

export class TaskGroupStore extends Context.Service<
  TaskGroupStore,
  {
    /** Call inside the commit transaction. */
    readonly apply: (event: ApplicationTaskGroupEvent) => Effect.Effect<void, TaskGroupStoreError>;
    readonly getShell: (
      taskGroupId: TaskGroupId,
      options?: { readonly includeDeleted?: boolean },
    ) => Effect.Effect<Option.Option<OrchestrationTaskGroupShell>, TaskGroupStoreError>;
    readonly listShells: () => Effect.Effect<
      ReadonlyArray<OrchestrationTaskGroupShell>,
      TaskGroupStoreError
    >;
    readonly findForFirstUserMessage: (
      threadId: ThreadId,
      messageId: MessageId,
    ) => Effect.Effect<TaskGroupId | null, TaskGroupStoreError>;
    readonly readTitleContext: (
      taskGroupId: TaskGroupId,
    ) => Effect.Effect<ReadonlyArray<TaskGroupTitleContextRow>, TaskGroupStoreError>;
    readonly listMemberIds: (
      taskGroupId: TaskGroupId,
    ) => Effect.Effect<ReadonlyArray<ThreadId>, TaskGroupStoreError>;
  }
>()("t3/orchestration-v2/TaskGroupStore") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const mapError = (operation: string) =>
    Effect.mapError((cause) => new TaskGroupStoreError({ operation, cause }));

  const selectRows = SqlSchema.findAll({
    Request: Schema.Struct({
      taskGroupId: Schema.optionalKey(TaskGroupId),
      includeDeleted: Schema.Boolean,
    }),
    Result: TaskGroupDbRow,
    execute: ({ taskGroupId, includeDeleted }) =>
      sql`
      SELECT task_group_id AS "id", title, has_custom_title AS "hasCustomTitle", color,
        pinned_at AS "pinnedAt", pin_order_key AS "pinOrderKey", archived_at AS "archivedAt",
        created_at AS "createdAt", updated_at AS "updatedAt", deleted_at AS "deletedAt"
      FROM projection_task_groups
      WHERE ${includeDeleted ? sql`1` : sql`deleted_at IS NULL`}
        ${taskGroupId === undefined ? sql`` : sql`AND task_group_id = ${taskGroupId}`}
      ORDER BY created_at, task_group_id
    `.pipe(NodeSqliteClient.readOnly),
  });

  const apply = Effect.fn("TaskGroupStore.apply")(function* (event: ApplicationTaskGroupEvent) {
    if (event.type === "task_group.deleted") {
      yield* sql`
        UPDATE projection_task_groups
        SET deleted_at = ${event.payload.deletedAt}, updated_at = ${event.payload.deletedAt}
        WHERE task_group_id = ${event.aggregateId}
      `;
      return;
    }

    const group = event.payload;
    yield* sql`
      INSERT INTO projection_task_groups (
        task_group_id, title, has_custom_title, color, pinned_at, pin_order_key, archived_at,
        created_at, updated_at, deleted_at
      ) VALUES (
        ${event.aggregateId}, ${group.title}, ${Number(group.hasCustomTitle)}, ${group.color},
        ${group.pinnedAt}, ${group.pinOrderKey}, ${group.archivedAt},
        ${group.createdAt}, ${group.updatedAt}, NULL
      )
      ON CONFLICT(task_group_id) DO UPDATE SET
        title = excluded.title, has_custom_title = excluded.has_custom_title, color = excluded.color,
        pinned_at = excluded.pinned_at, pin_order_key = excluded.pin_order_key,
        archived_at = excluded.archived_at, updated_at = excluded.updated_at
      WHERE projection_task_groups.deleted_at IS NULL
    `;
  }, mapError("apply"));

  const getShell = Effect.fn("TaskGroupStore.getShell")(function* (
    taskGroupId: TaskGroupId,
    options?: { readonly includeDeleted?: boolean },
  ) {
    const rows = yield* selectRows({
      taskGroupId,
      includeDeleted: options?.includeDeleted === true,
    });
    return Option.map(
      Option.fromNullishOr(rows[0]),
      ({ deletedAt: _deletedAt, ...shell }) => shell,
    );
  }, mapError("getShell"));

  const listShells = Effect.fn("TaskGroupStore.listShells")(function* () {
    const rows = yield* selectRows({ includeDeleted: false });
    return rows.map(({ deletedAt: _deletedAt, ...shell }) => shell);
  }, mapError("listShells"));

  const listMemberIds = Effect.fn("TaskGroupStore.listMemberIds")(function* (
    taskGroupId: TaskGroupId,
  ) {
    const rows = yield* sql<{ readonly thread_id: string }>`
      SELECT thread_id FROM orchestration_v2_projection_threads
      WHERE deleted_at IS NULL
        AND CASE WHEN json_valid(payload_json) THEN json_extract(payload_json, '$.taskGroupId') END = ${taskGroupId}
      ORDER BY updated_at DESC, thread_id
    `.pipe(NodeSqliteClient.readOnly);
    return rows.map((row) => ThreadId.make(row.thread_id));
  }, mapError("listMemberIds"));

  const findForFirstUserMessage = Effect.fn("TaskGroupStore.findForFirstUserMessage")(function* (
    threadId: ThreadId,
    messageId: MessageId,
  ) {
    const rows = yield* sql<{ readonly id: string }>`
      SELECT g.task_group_id AS id
      FROM orchestration_v2_projection_threads t
      JOIN projection_task_groups g ON g.task_group_id = json_extract(t.payload_json, '$.taskGroupId')
      WHERE t.thread_id = ${threadId} AND t.deleted_at IS NULL
        AND g.deleted_at IS NULL AND g.has_custom_title = 0
        AND ${messageId} = (
          SELECT m.message_id FROM orchestration_v2_projection_messages m
          WHERE m.thread_id = t.thread_id AND m.role = 'user' AND m.streaming = 0
            AND COALESCE(json_extract(m.payload_json, '$.createdBy'), 'user') = 'user'
          ORDER BY m.created_at, m.message_id
          LIMIT 1
        )
    `.pipe(NodeSqliteClient.readOnly);
    return rows[0] === undefined ? null : TaskGroupId.make(rows[0].id);
  }, mapError("findForFirstUserMessage"));

  const readTitleContext = Effect.fn("TaskGroupStore.readTitleContext")(function* (
    taskGroupId: TaskGroupId,
  ) {
    const messageText = messageSearchText(sql);
    const rows = yield* sql<{
      readonly project_id: string;
      readonly title: string;
      readonly message: string | null;
    }>`
      SELECT t.project_id, substr(t.title, 1, 200) AS title, (
        SELECT substr(${messageText}, 1, 500)
        FROM orchestration_v2_projection_messages messages
        WHERE messages.thread_id = t.thread_id AND messages.role = 'user' AND messages.streaming = 0
          AND COALESCE(json_extract(messages.payload_json, '$.createdBy'), 'user') = 'user'
          AND trim(${messageText}) <> ''
        ORDER BY messages.updated_at DESC, messages.message_id DESC LIMIT 1
      ) AS message
      FROM orchestration_v2_projection_threads t
      WHERE t.deleted_at IS NULL
        AND CASE WHEN json_valid(t.payload_json) THEN json_extract(t.payload_json, '$.taskGroupId') END = ${taskGroupId}
      ORDER BY t.updated_at DESC, t.thread_id
      LIMIT 8
    `.pipe(NodeSqliteClient.readOnly);
    return rows.map((row): TaskGroupTitleContextRow => ({
      projectId: ProjectId.make(row.project_id),
      title: row.title,
      message: row.message,
    }));
  }, mapError("readTitleContext"));

  return TaskGroupStore.of({
    apply,
    getShell,
    listShells,
    listMemberIds,
    findForFirstUserMessage,
    readTitleContext,
  });
});

export const layer = Layer.effect(TaskGroupStore, make);
