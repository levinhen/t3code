import {
  CommandId,
  EventId,
  type OrchestrationTaskGroupShell,
  type TaskGroupCreateInput,
  TaskGroupError,
  TaskGroupId,
  type TaskGroupUpdateInput,
} from "@t3tools/contracts";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as EventSink from "./EventSink.ts";
import * as TaskGroupStore from "./TaskGroupStore.ts";
import * as TaskGroupTitleService from "./TaskGroupTitleService.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";

export class TaskGroupService extends Context.Service<
  TaskGroupService,
  {
    readonly create: (
      input: TaskGroupCreateInput,
    ) => Effect.Effect<{ readonly taskGroup: OrchestrationTaskGroupShell }, TaskGroupError>;
    readonly update: (
      input: TaskGroupUpdateInput,
    ) => Effect.Effect<{ readonly taskGroup: OrchestrationTaskGroupShell }, TaskGroupError>;
    readonly remove: (input: {
      readonly taskGroupId: TaskGroupId;
    }) => Effect.Effect<{ readonly ok: true }, TaskGroupError>;
    readonly regenerateTitle: (input: {
      readonly taskGroupId: TaskGroupId;
    }) => Effect.Effect<{ readonly ok: true }, TaskGroupError>;
  }
>()("t3/orchestration-v2/TaskGroupService") {}

function eventFields(
  taskGroupId: TaskGroupId,
  occurredAt: string,
  eventId: string,
  commandId: CommandId | null,
) {
  return {
    aggregateKind: "task_group",
    aggregateId: taskGroupId,
    eventId: EventId.make(eventId),
    occurredAt,
    commandId,
    causationEventId: null,
    correlationId: commandId,
    metadata: {},
  } as const;
}

const isTaskGroupError = Schema.is(TaskGroupError);

const make = Effect.gen(function* () {
  const taskGroups = yield* TaskGroupStore.TaskGroupStore;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const titles = yield* TaskGroupTitleService.TaskGroupTitleService;
  const events = yield* EventSink.EventSinkV2;
  const scope = yield* Effect.scope;

  const mapError = (taskGroupId: TaskGroupId) =>
    Effect.mapError(
      (error: TaskGroupError | TaskGroupStore.TaskGroupStoreError | EventSink.EventSinkV2Error) => {
        const cause = error._tag === "EventSinkWriteError" ? error.cause : error;
        return isTaskGroupError(cause)
          ? cause
          : new TaskGroupError({ taskGroupId, reason: "unavailable", cause: error });
      },
    );

  const requireGroup = Effect.fn("TaskGroupService.requireGroup")(function* (
    taskGroupId: TaskGroupId,
  ) {
    const group = yield* taskGroups.getShell(taskGroupId);
    return yield* Option.match(group, {
      onSome: Effect.succeed,
      onNone: () => new TaskGroupError({ taskGroupId, reason: "not-found" }),
    });
  });

  const create = Effect.fn("TaskGroupService.create")(function* (input: TaskGroupCreateInput) {
    const taskGroupId = input.taskGroupId ?? TaskGroupId.make(yield* randomUuidV4);
    const members = [...new Set(input.threadIds)];
    const { taskGroup, created } = yield* events
      .commitTaskGroupChange(
        Effect.gen(function* () {
          const current = yield* taskGroups.getShell(taskGroupId);
          if (Option.isSome(current))
            return { result: { taskGroup: current.value, created: false } };
          const reserved = yield* taskGroups.getShell(taskGroupId, { includeDeleted: true });
          if (Option.isSome(reserved)) {
            return yield* new TaskGroupError({ taskGroupId, reason: "already-exists" });
          }
          const now = DateTime.formatIso(yield* DateTime.now);
          const taskGroup: OrchestrationTaskGroupShell = {
            id: taskGroupId,
            title: input.title ?? "New task group",
            hasCustomTitle: input.title !== undefined,
            color: input.color ?? "slate",
            pinnedAt: null,
            pinOrderKey: null,
            archivedAt: null,
            createdAt: now,
            updatedAt: now,
          };
          const commandId = CommandId.make(
            `${TaskGroupTitleService.TASK_GROUP_CREATION_COMMAND_PREFIX}${yield* randomUuidV4}`,
          );
          return {
            result: { taskGroup, created: true },
            event: {
              ...eventFields(taskGroupId, now, yield* randomUuidV4, commandId),
              type: "task_group.created",
              payload: taskGroup,
            } as const,
            memberships: members.map((threadId) => ({ threadId, taskGroupId })),
          };
        }),
      )
      .pipe(mapError(taskGroupId));

    if (
      created &&
      !taskGroup.hasCustomTitle &&
      members.length > 0 &&
      input.autoSummarizeTitle !== false
    ) {
      yield* titles.request(taskGroupId);
    }
    return { taskGroup };
  });

  const update = Effect.fn("TaskGroupService.update")(function* (input: TaskGroupUpdateInput) {
    const { taskGroupId } = input;
    const { taskGroup, members } = yield* events
      .commitTaskGroupChange(
        Effect.gen(function* () {
          const current = yield* requireGroup(taskGroupId);
          const now = DateTime.formatIso(yield* DateTime.now);
          const taskGroup: OrchestrationTaskGroupShell = {
            ...current,
            title: input.title ?? current.title,
            hasCustomTitle:
              input.hasCustomTitle ?? (input.title !== undefined || current.hasCustomTitle),
            color: input.color ?? current.color,
            pinnedAt:
              input.pinned === undefined
                ? current.pinnedAt
                : input.pinned
                  ? (current.pinnedAt ?? now)
                  : null,
            pinOrderKey:
              input.pinned === false
                ? null
                : input.pinOrderKey === undefined
                  ? current.pinOrderKey
                  : input.pinOrderKey,
            archivedAt:
              input.archived === undefined
                ? current.archivedAt
                : input.archived
                  ? (current.archivedAt ?? now)
                  : null,
            updatedAt: now,
          };
          const members =
            input.archived === true && input.settleMemberThreads === true
              ? yield* taskGroups.listMemberIds(taskGroupId)
              : [];
          return {
            result: { taskGroup, members },
            event: {
              ...eventFields(taskGroupId, now, yield* randomUuidV4, null),
              type: "task_group.updated",
              payload: taskGroup,
            } as const,
          };
        }),
      )
      .pipe(mapError(taskGroupId));

    const archivedAt = taskGroup.archivedAt;
    if (archivedAt !== null && members.length > 0) {
      yield* Effect.forEach(
        members,
        (threadId) =>
          Effect.gen(function* () {
            const shell = yield* threads.getThreadShell(threadId);
            if (
              shell === null ||
              shell.archivedAt !== null ||
              shell.settledOverride === "settled" ||
              shell.taskGroupId !== taskGroupId
            )
              return;
            const expectedArchivedTaskGroup = { taskGroupId, archivedAt };
            if (shell.activeRunId !== null) {
              yield* threads
                .settleAfterRun({
                  projectId: shell.projectId,
                  threadId,
                  runId: shell.activeRunId,
                  expectedArchivedTaskGroup,
                })
                .pipe(Effect.ignore({ log: true }), Effect.forkIn(scope));
              return;
            }
            yield* threads.dispatch({
              type: "thread.settle",
              commandId: CommandId.make(`server:task-group-settle:${yield* randomUuidV4}`),
              threadId,
              expectedArchivedTaskGroup,
            });
          }).pipe(Effect.ignore({ log: true })),
        { concurrency: 4, discard: true },
      );
    }
    return { taskGroup };
  });

  const remove = Effect.fn("TaskGroupService.remove")(function* ({
    taskGroupId,
  }: {
    readonly taskGroupId: TaskGroupId;
  }) {
    yield* events
      .commitTaskGroupChange(
        Effect.gen(function* () {
          const current = yield* taskGroups.getShell(taskGroupId);
          if (Option.isNone(current)) return { result: undefined };
          const members = yield* taskGroups.listMemberIds(taskGroupId);
          const now = DateTime.formatIso(yield* DateTime.now);
          return {
            result: undefined,
            event: {
              ...eventFields(taskGroupId, now, yield* randomUuidV4, null),
              type: "task_group.deleted",
              payload: { taskGroupId, deletedAt: now },
            } as const,
            memberships: members.map((threadId) => ({ threadId, taskGroupId: null })),
          };
        }),
      )
      .pipe(mapError(taskGroupId));
    return { ok: true } as const;
  });

  const regenerateTitle = Effect.fn("TaskGroupService.regenerateTitle")(function* ({
    taskGroupId,
  }: {
    readonly taskGroupId: TaskGroupId;
  }) {
    yield* requireGroup(taskGroupId).pipe(mapError(taskGroupId));
    yield* titles.request(taskGroupId, true);
    return { ok: true } as const;
  });

  return TaskGroupService.of({ create, update, remove, regenerateTitle });
});

export const layer = Layer.effect(TaskGroupService, make);
