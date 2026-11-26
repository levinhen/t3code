import { assert, it, vi } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  TaskGroupId,
  ThreadId,
  type OrchestrationV2Command,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as ServerSettings from "../serverSettings.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as CommandReceiptStore from "./CommandReceiptStore.ts";
import * as EventSink from "./EventSink.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as TaskGroupService from "./TaskGroupService.ts";
import * as TaskGroupStore from "./TaskGroupStore.ts";
import * as TaskGroupTitleService from "./TaskGroupTitleService.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";
import * as CodexAdapter from "./Adapters/CodexAdapterV2.ts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

const projectId = ProjectId.make("task-group-project");
const instanceId = ProviderInstanceId.make("codex");

const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexAdapter.CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("No provider process required"),
} as ProviderAdapter.ProviderAdapterV2["Service"];

function makeHarness(
  generateThreadTitle: TextGeneration.TextGeneration["Service"]["generateThreadTitle"],
) {
  const database = SqlitePersistence.layerMemory;
  const runtime = ProviderReplayHarness.layerWithRegistry(
    { name: "task-groups" },
    ProviderAdapterRegistry.layerFromAdapters([adapter]),
    { databaseLayer: database, runEffectWorker: false },
  );
  const settings = ServerSettings.layerTest({});
  const persistence = Layer.mergeAll(
    TaskGroupStore.layer,
    ProjectStore.layer,
    CommandReceiptStore.layer,
  ).pipe(Layer.provide(database));
  const threads = ThreadManagement.layer.pipe(
    Layer.provide(Layer.mergeAll(runtime, settings, persistence)),
  );
  const titles = TaskGroupTitleService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        runtime,
        settings,
        persistence,
        Layer.mock(TextGeneration.TextGeneration)({ generateThreadTitle }),
      ),
    ),
  );
  const groups = TaskGroupService.layer.pipe(
    Layer.provide(Layer.mergeAll(runtime, persistence, threads, titles)),
  );
  return Layer.mergeAll(runtime, persistence, titles, groups);
}

function createThread(
  threadId: ThreadId,
  taskGroupId?: TaskGroupId,
): OrchestrationV2Command & { type: "thread.create" } {
  return {
    type: "thread.create",
    commandId: CommandId.make(`create:${threadId}`),
    threadId,
    projectId,
    ...(taskGroupId === undefined ? {} : { taskGroupId }),
    title: "Repair exports",
    runtimeMode: "full-access",
    interactionMode: "default",
    modelSelection: { instanceId, model: "gpt-5.1-codex" },
    branch: null,
    worktreePath: null,
    createdBy: "user",
    creationSource: "web",
  };
}

const seedProject = Effect.gen(function* () {
  const projects = yield* ProjectStore.ProjectStoreV2;
  const now = DateTime.formatIso(yield* DateTime.now);
  yield* projects.apply({
    aggregateKind: "project",
    aggregateId: projectId,
    eventId: EventId.make("test-project"),
    sequence: 1,
    occurredAt: now,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type: "project.created",
    payload: {
      projectId,
      title: "Data Pipeline",
      workspaceRoot: "/repo",
      defaultModelSelection: null,
      scripts: [],
      createdAt: now,
      updatedAt: now,
    },
  });
});

it.effect(
  "Orchestrator validates membership, normalizes cross-group parents, and keeps threads on delete",
  () =>
    Effect.gen(function* () {
      const groups = yield* TaskGroupService.TaskGroupService;
      const store = yield* TaskGroupStore.TaskGroupStore;
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const threadId = ThreadId.make("existing-thread");
      const parentId = ThreadId.make("sidebar-parent");
      const newId = ThreadId.make("new-thread");
      const groupId = TaskGroupId.make("group");
      const missingId = TaskGroupId.make("missing");
      const failedCreate = yield* orchestrator
        .dispatch(createThread(newId, missingId))
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(failedCreate));
      assert.isNull(yield* orchestrator.getThreadShell(newId));

      yield* orchestrator.dispatch(createThread(parentId));
      yield* orchestrator.dispatch(createThread(threadId));
      yield* orchestrator.dispatch({
        type: "thread.sidebar-parent.set",
        commandId: CommandId.make("nest"),
        threadId,
        parent: { kind: "thread", threadId: parentId },
      });
      const invalid = yield* groups
        .create({ taskGroupId: missingId, threadIds: [threadId, newId] })
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(invalid));
      assert.isTrue(Option.isNone(yield* store.getShell(missingId)));
      assert.isNull((yield* orchestrator.getThreadShell(threadId))?.taskGroupId);

      yield* groups.create({ taskGroupId: groupId, title: "Export repairs" });
      yield* orchestrator.dispatch({
        type: "thread.taskGroup.set",
        commandId: CommandId.make("move"),
        threadId,
        taskGroupId: groupId,
      });
      const shell = yield* orchestrator.getThreadShell(threadId);
      assert.deepEqual(shell?.sidebarParent, { kind: "top_level" });
      assert.equal(shell?.taskGroupId, groupId);

      yield* orchestrator.dispatch({
        ...createThread(newId, groupId),
        commandId: CommandId.make("create-in-group"),
      });
      assert.equal((yield* orchestrator.getThreadShell(newId))?.taskGroupId, groupId);
      const archived = yield* groups.update({
        taskGroupId: groupId,
        archived: true,
        settleMemberThreads: true,
      });
      assert.isNotNull(archived.taskGroup.archivedAt);
      assert.equal((yield* orchestrator.getThreadShell(newId))?.settledOverride, "settled");
      const restored = yield* groups.update({ taskGroupId: groupId, archived: false });
      assert.isNull(restored.taskGroup.archivedAt);
      yield* orchestrator.dispatch({
        type: "thread.archive",
        commandId: CommandId.make("archive-thread"),
        threadId,
      });
      yield* groups.remove({ taskGroupId: groupId });
      assert.isNull((yield* orchestrator.getThreadShell(threadId))?.taskGroupId);
      assert.isNull((yield* orchestrator.getThreadShell(newId))?.taskGroupId);
      assert.isFalse(
        Exit.isSuccess(
          yield* orchestrator
            .dispatch({
              type: "thread.taskGroup.set",
              commandId: CommandId.make("move-to-deleted"),
              threadId: newId,
              taskGroupId: groupId,
            })
            .pipe(Effect.exit),
        ),
      );
      assert.equal((yield* store.listShells()).length, 0);
    }).pipe(Effect.provide(makeHarness(() => Effect.die("Named groups do not need a provider")))),
);

it.effect("settles an archived group member after its current run completes", () =>
  Effect.gen(function* () {
    const events = yield* EventSink.EventSinkV2;
    const groups = yield* TaskGroupService.TaskGroupService;
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const threadId = ThreadId.make("running-member");
    const { taskGroup } = yield* groups.create({ title: "Background export cleanup" });
    const create = createThread(threadId, taskGroup.id);
    yield* orchestrator.dispatch(create);
    yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make("running-member-prompt"),
      threadId,
      messageId: MessageId.make("running-member-prompt"),
      text: "Finish the export cleanup.",
      modelSelection: create.modelSelection,
      attachments: [],
      createdBy: "user",
      creationSource: "web",
      dispatchMode: { type: "start_immediately" },
    });
    const run = (yield* orchestrator.getThreadProjection(threadId)).runs[0];
    if (run === undefined) return yield* Effect.die("Missing run");

    const settled = yield* orchestrator
      .streamStoredEventsFrom({ threadId, afterSequence: 0, eventType: "thread.settled" })
      .pipe(Stream.runHead, Effect.forkChild);
    yield* groups.update({ taskGroupId: taskGroup.id, archived: true, settleMemberThreads: true });
    assert.isNull((yield* orchestrator.getThreadShell(threadId))?.settledOverride);

    const now = yield* DateTime.now;
    yield* events.write({
      events: [
        {
          id: EventId.make("running-member-completed"),
          type: "run.updated",
          threadId,
          runId: run.id,
          occurredAt: now,
          payload: { ...run, status: "completed", startedAt: now, completedAt: now },
        },
      ],
    });
    yield* Fiber.join(settled);
    assert.equal((yield* orchestrator.getThreadShell(threadId))?.settledOverride, "settled");
  }).pipe(Effect.provide(makeHarness(() => Effect.die("Named groups do not need a provider")))),
);

it.effect("coalesces automatic titles and keeps a manual rename made while the provider runs", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const generate = vi.fn<TextGeneration.TextGeneration["Service"]["generateThreadTitle"]>(
      (input) =>
        Effect.gen(function* () {
          assert.include(input.message, "Repair exports");
          assert.include(input.message, "Data Pipeline");
          if (input.previousTitle === undefined) {
            yield* Deferred.succeed(started, undefined);
            yield* Deferred.await(release);
          }
          return { title: "Export Pipeline Recovery With Verified Rollback Instructions" };
        }),
    );
    yield* Effect.gen(function* () {
      yield* seedProject;
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const groups = yield* TaskGroupService.TaskGroupService;
      const titles = yield* TaskGroupTitleService.TaskGroupTitleService;
      const store = yield* TaskGroupStore.TaskGroupStore;
      const threadId = ThreadId.make("repair");
      yield* orchestrator.dispatch(createThread(threadId));
      const { taskGroup } = yield* groups.create({ threadIds: [threadId] });
      yield* Deferred.await(started);
      yield* titles.request(taskGroup.id);
      yield* titles.request(taskGroup.id);
      yield* groups.update({ taskGroupId: taskGroup.id, title: "Manual title" });
      yield* Deferred.succeed(release, undefined);
      yield* titles.drain;
      assert.equal(generate.mock.calls.length, 1);
      assert.equal(Option.getOrNull(yield* store.getShell(taskGroup.id))?.title, "Manual title");

      yield* groups.regenerateTitle({ taskGroupId: taskGroup.id });
      yield* titles.drain;
      const regenerated = Option.getOrNull(yield* store.getShell(taskGroup.id));
      assert.equal(regenerated?.title, "Export Pipeline Recovery With Verified Rollback");
      assert.isTrue(regenerated?.hasCustomTitle);
      assert.equal(generate.mock.calls[1]?.[0].previousTitle, "Manual title");
    }).pipe(Effect.provide(makeHarness(generate)));
  }),
);

it.effect("defers opt-out groups until a member receives its first user message", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const generate = vi.fn<TextGeneration.TextGeneration["Service"]["generateThreadTitle"]>(() =>
      Effect.gen(function* () {
        yield* Deferred.succeed(started, undefined);
        return { title: "CSV Export Cleanup" };
      }),
    );
    yield* Effect.gen(function* () {
      yield* seedProject;
      const events = yield* EventSink.EventSinkV2;
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const groups = yield* TaskGroupService.TaskGroupService;
      const titles = yield* TaskGroupTitleService.TaskGroupTitleService;
      const store = yield* TaskGroupStore.TaskGroupStore;
      const threadId = ThreadId.make("csv");
      yield* orchestrator.dispatch(createThread(threadId));
      const { taskGroup } = yield* groups.create({
        threadIds: [threadId],
        autoSummarizeTitle: false,
      });
      assert.equal(generate.mock.calls.length, 0);

      const now = yield* DateTime.now;
      yield* events.write({
        events: [
          {
            id: EventId.make("first-user-message"),
            threadId,
            type: "message.updated",
            occurredAt: now,
            payload: {
              id: MessageId.make("message-one"),
              threadId,
              nodeId: null,
              runId: null,
              role: "user",
              createdBy: "user",
              creationSource: "web",
              text: "Fix blank CSV rows",
              attachments: [],
              streaming: false,
              createdAt: now,
              updatedAt: now,
            },
          },
        ],
      });
      assert.include(
        (yield* store.readTitleContext(taskGroup.id))[0]?.message,
        "Fix blank CSV rows",
      );
      yield* Deferred.await(started);
      yield* titles.drain;
      assert.include(generate.mock.calls[0]?.[0].message, "Fix blank CSV rows");
      assert.equal(
        Option.getOrNull(yield* store.getShell(taskGroup.id))?.title,
        "CSV Export Cleanup",
      );
    }).pipe(Effect.provide(makeHarness(generate)));
  }),
);
