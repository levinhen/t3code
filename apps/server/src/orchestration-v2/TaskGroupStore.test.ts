import { assert, it } from "@effect/vitest";
import { EventId, TaskGroupId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as OrchestrationEventStore from "../persistence/OrchestrationEventStore.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as TaskGroupStore from "./TaskGroupStore.ts";

const layer = Layer.merge(TaskGroupStore.layer, OrchestrationEventStore.layer).pipe(
  Layer.provide(SqlitePersistence.layerMemory),
);

it.effect("replays task group events with application cursors and preserves group tombstones", () =>
  Effect.gen(function* () {
    const store = yield* TaskGroupStore.TaskGroupStore;
    const events = yield* OrchestrationEventStore.OrchestrationEventStore;
    const id = TaskGroupId.make("group-one");
    const now = "2026-11-26T00:00:00.000Z";
    const base = {
      aggregateKind: "task_group",
      aggregateId: id,
      occurredAt: now,
      commandId: null,
      correlationId: null,
      causationEventId: null,
      metadata: {},
    } as const;
    const created = yield* events.appendTaskGroupEvent({
      ...base,
      eventId: EventId.make("group-create"),
      type: "task_group.created",
      payload: {
        id,
        title: "Improve import",
        hasCustomTitle: false,
        color: "cyan",
        pinnedAt: null,
        pinOrderKey: null,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    });
    if (created.type !== "task_group.created") return yield* Effect.die("Wrong event type");
    yield* store.apply(created);
    const updated = yield* events.appendTaskGroupEvent({
      ...base,
      eventId: EventId.make("group-update"),
      type: "task_group.updated",
      payload: {
        ...created.payload,
        hasCustomTitle: true,
        pinnedAt: now,
        pinOrderKey: "a",
        archivedAt: now,
      },
    });
    if (updated.type !== "task_group.updated") return yield* Effect.die("Wrong event type");
    yield* store.apply(updated);
    assert.deepEqual(yield* store.listShells(), [updated.payload]);
    assert.equal(yield* events.latestApplicationSequence, updated.sequence);
    const stats = yield* events.getReplayStats({
      afterSequence: 0,
      throughSequence: updated.sequence,
    });
    assert.equal(stats.eventCount, 2);

    const deleted = yield* events.appendTaskGroupEvent({
      ...base,
      eventId: EventId.make("group-delete"),
      type: "task_group.deleted",
      payload: { taskGroupId: id, deletedAt: now },
    });
    yield* store.apply(deleted);
    assert.isTrue(Option.isNone(yield* store.getShell(id)));
    assert.isTrue(Option.isSome(yield* store.getShell(id, { includeDeleted: true })));
    assert.deepEqual(yield* store.listShells(), []);
    const replayed = yield* events
      .readApplicationEvents({ afterSequence: created.sequence, throughSequence: deleted.sequence })
      .pipe(Stream.runCollect);
    assert.deepEqual(replayed, [updated, deleted]);
  }).pipe(Effect.provide(layer)),
);
