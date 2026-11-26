import * as Schema from "effect/Schema";

import { IsoDateTime, TaskGroupId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const TaskGroupColor = Schema.Literals([
  "slate",
  "blue",
  "cyan",
  "green",
  "amber",
  "orange",
  "pink",
  "purple",
]);
export type TaskGroupColor = typeof TaskGroupColor.Type;

export const OrchestrationTaskGroupShell = Schema.Struct({
  id: TaskGroupId,
  title: TrimmedNonEmptyString,
  hasCustomTitle: Schema.Boolean,
  color: TaskGroupColor,
  pinnedAt: Schema.NullOr(IsoDateTime),
  pinOrderKey: Schema.NullOr(Schema.String),
  archivedAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationTaskGroupShell = typeof OrchestrationTaskGroupShell.Type;

export const TaskGroupCreateInput = Schema.Struct({
  taskGroupId: Schema.optionalKey(TaskGroupId),
  title: Schema.optionalKey(TrimmedNonEmptyString),
  color: Schema.optionalKey(TaskGroupColor),
  threadIds: Schema.optionalKey(Schema.Array(ThreadId)),
  autoSummarizeTitle: Schema.optionalKey(Schema.Boolean),
});
export type TaskGroupCreateInput = typeof TaskGroupCreateInput.Type;

export const TaskGroupUpdateInput = Schema.Struct({
  taskGroupId: TaskGroupId,
  title: Schema.optionalKey(TrimmedNonEmptyString),
  hasCustomTitle: Schema.optionalKey(Schema.Boolean),
  color: Schema.optionalKey(TaskGroupColor),
  pinned: Schema.optionalKey(Schema.Boolean),
  pinOrderKey: Schema.optionalKey(Schema.NullOr(Schema.String)),
  archived: Schema.optionalKey(Schema.Boolean),
  settleMemberThreads: Schema.optionalKey(Schema.Boolean),
});
export type TaskGroupUpdateInput = typeof TaskGroupUpdateInput.Type;

export const TaskGroupIdInput = Schema.Struct({ taskGroupId: TaskGroupId });
export const TaskGroupResult = Schema.Struct({ taskGroup: OrchestrationTaskGroupShell });
export const TaskGroupActionResult = Schema.Struct({ ok: Schema.Literal(true) });

export class TaskGroupError extends Schema.TaggedError<TaskGroupError>()("TaskGroupError", {
  taskGroupId: TaskGroupId,
  reason: Schema.Literals(["not-found", "already-exists", "unavailable", "invalid-member"]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    switch (this.reason) {
      case "not-found":
        return "Task group was not found.";
      case "already-exists":
        return "Task group already exists.";
      case "invalid-member":
        return "A task group member could not be moved.";
      case "unavailable":
        return "Task group operation failed.";
    }
  }
}
