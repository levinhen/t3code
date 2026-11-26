import { expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import {
  ApplicationTaskGroupEvent,
  AuthOrchestrationOperateScope,
  CLIENT_GUARDED_RPC_SCOPES,
  ClientSettingsPatch,
  DEFAULT_CLIENT_SETTINGS,
  OrchestrationTaskGroupShell,
  OrchestrationV2Command,
  OrchestrationV2ShellSnapshot,
  OrchestrationV2ShellStreamItem,
  TaskGroupCreateInput,
  WS_METHODS,
} from "./index.ts";

const decodeSnapshot = Schema.decodeSync(OrchestrationV2ShellSnapshot);
const decodeDelta = Schema.decodeSync(OrchestrationV2ShellStreamItem);
const decodeShell = Schema.decodeSync(OrchestrationTaskGroupShell);
const decodeUnknownShell = Schema.decodeUnknownSync(OrchestrationTaskGroupShell);
const decodeEvent = Schema.decodeSync(ApplicationTaskGroupEvent);
const decodeCommand = Schema.decodeSync(OrchestrationV2Command);
const decodeCreateInput = Schema.decodeSync(TaskGroupCreateInput);
const decodeSettingsPatch = Schema.decodeSync(ClientSettingsPatch);

const now = "2026-11-26T00:00:00.000Z";
const shell = {
  id: "group-one",
  title: "  Export improvements  ",
  hasCustomTitle: true,
  color: "purple" as const,
  pinnedAt: now,
  pinOrderKey: "a",
  archivedAt: null,
  createdAt: now,
  updatedAt: now,
};

it("accepts old shell snapshots and decodes task groups in snapshots and deltas", () => {
  const snapshot = {
    schemaVersion: 1,
    snapshotSequence: 0,
    projects: [],
    threads: [],
    archivedThreads: [],
  };
  expect(decodeSnapshot(snapshot).taskGroups ?? []).toEqual([]);
  expect(decodeSnapshot({ ...snapshot, taskGroups: [shell] }).taskGroups?.[0]?.title).toBe(
    "Export improvements",
  );
  expect(
    decodeDelta({
      kind: "task_group.removed",
      sequence: 2,
      taskGroupId: shell.id,
    }),
  ).toMatchObject({ kind: "task_group.removed" });
  expect(() => decodeShell({ ...shell, title: "  " })).toThrow();
  expect(() => decodeUnknownShell({ ...shell, color: "red" })).toThrow();
});

it("decodes task group events, nullable membership commands, and create inputs", () => {
  expect(
    decodeEvent({
      sequence: 1,
      eventId: "group-created",
      aggregateKind: "task_group",
      aggregateId: shell.id,
      type: "task_group.created",
      payload: shell,
      occurredAt: now,
      commandId: null,
      correlationId: null,
      causationEventId: null,
      metadata: {},
    }).payload,
  ).toMatchObject({ id: shell.id, title: "Export improvements" });
  expect(
    decodeCommand({
      type: "thread.taskGroup.set",
      commandId: "move",
      threadId: "thread-one",
      taskGroupId: null,
    }),
  ).toMatchObject({ type: "thread.taskGroup.set", taskGroupId: null });
  expect(decodeCreateInput({ title: "  Export improvements  " })).toEqual({
    title: "Export improvements",
  });
  expect(DEFAULT_CLIENT_SETTINGS.taskGroupDirectoryGroupingEnabled).toBe(false);
  expect(decodeSettingsPatch({ taskGroupDirectoryGroupingEnabled: true })).toMatchObject({
    taskGroupDirectoryGroupingEnabled: true,
  });
  expect(
    [
      WS_METHODS.taskGroupCreate,
      WS_METHODS.taskGroupUpdate,
      WS_METHODS.taskGroupDelete,
      WS_METHODS.taskGroupRegenerateTitle,
    ].map((method) => CLIENT_GUARDED_RPC_SCOPES[method]),
  ).toEqual(Array.from({ length: 4 }, () => AuthOrchestrationOperateScope));
});
