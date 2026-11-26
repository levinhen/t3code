import {
  WS_METHODS,
  type EnvironmentId,
  type OrchestrationTaskGroupShell,
  type OrchestrationV2ShellSnapshot,
  type TaskGroupId,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { enabledEnvironmentIds, type EnvironmentCatalogState } from "./connections.ts";
import { arrayElementsEqual } from "./entities.ts";
import type { EnvironmentTaskGroupShell } from "./models.ts";
import { createAtomCommandScheduler, createEnvironmentRpcCommand } from "./runtime.ts";

export type { EnvironmentTaskGroupShell } from "./models.ts";

const EMPTY_GROUPS: ReadonlyArray<OrchestrationTaskGroupShell> = [];

export function createEnvironmentTaskGroupAtoms(input: {
  readonly catalogValueAtom: Atom.Atom<EnvironmentCatalogState>;
  readonly snapshotAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<OrchestrationV2ShellSnapshot | null>;
}) {
  const groupRowsAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get) => get(input.snapshotAtom(environmentId))?.taskGroups ?? EMPTY_GROUPS),
  );
  const environmentTaskGroupsAtom = Atom.family((environmentId: EnvironmentId) => {
    const scopedRows = new WeakMap<OrchestrationTaskGroupShell, EnvironmentTaskGroupShell>();
    return Atom.make((get) =>
      get(groupRowsAtom(environmentId)).map((row) => {
        let scoped = scopedRows.get(row);
        if (scoped === undefined) {
          scoped = { ...row, environmentId };
          scopedRows.set(row, scoped);
        }
        return scoped;
      }),
    ).pipe(Atom.withLabel(`environment-task-groups:${environmentId}`));
  });
  const environmentTaskGroupIndexAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make(
      (get): ReadonlyMap<TaskGroupId, EnvironmentTaskGroupShell> =>
        new Map(get(environmentTaskGroupsAtom(environmentId)).map((group) => [group.id, group])),
    ).pipe(Atom.withLabel(`environment-task-group-index:${environmentId}`)),
  );
  const taskGroupAtomFamily = Atom.family((environmentId: EnvironmentId) =>
    Atom.family((taskGroupId: TaskGroupId) =>
      Atom.make(
        (get) => get(environmentTaskGroupIndexAtom(environmentId)).get(taskGroupId) ?? null,
      ),
    ),
  );
  let previous: ReadonlyArray<EnvironmentTaskGroupShell> = [];
  const taskGroupsAtom = Atom.make((get) => {
    const next = [...enabledEnvironmentIds(get(input.catalogValueAtom))].flatMap((environmentId) =>
      get(environmentTaskGroupsAtom(environmentId)),
    );
    if (arrayElementsEqual(previous, next)) return previous;
    previous = next;
    return next;
  }).pipe(Atom.withLabel("environment-task-group-list"));

  return {
    environmentTaskGroupsAtom,
    environmentTaskGroupIndexAtom,
    taskGroupsAtom,
    taskGroupAtom: (ref: {
      readonly environmentId: EnvironmentId;
      readonly taskGroupId: TaskGroupId;
    }) => taskGroupAtomFamily(ref.environmentId)(ref.taskGroupId),
  };
}

export function createTaskGroupEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const scheduler = createAtomCommandScheduler();
  const concurrency = {
    mode: "serial" as const,
    key: ({
      environmentId,
      input,
    }: {
      environmentId: EnvironmentId;
      input: { readonly taskGroupId?: TaskGroupId };
    }) => JSON.stringify([environmentId, input.taskGroupId]),
  };
  return {
    createTaskGroup: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commands:task-group:create",
      tag: WS_METHODS.taskGroupCreate,
      scheduler,
      concurrency,
    }),
    updateTaskGroup: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commands:task-group:update",
      tag: WS_METHODS.taskGroupUpdate,
      scheduler,
      concurrency,
    }),
    deleteTaskGroup: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commands:task-group:delete",
      tag: WS_METHODS.taskGroupDelete,
      scheduler,
      concurrency,
    }),
    regenerateTaskGroupTitle: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commands:task-group:regenerate-title",
      tag: WS_METHODS.taskGroupRegenerateTitle,
      scheduler,
      concurrency,
    }),
  };
}
