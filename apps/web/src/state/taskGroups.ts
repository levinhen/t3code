import { useAtomValue } from "@effect/atom-react";
import {
  createEnvironmentTaskGroupAtoms,
  createTaskGroupEnvironmentAtoms,
  type EnvironmentTaskGroupShell,
} from "@t3tools/client-runtime/state/task-groups";

import { environmentCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import { environmentSnapshotAtom } from "./shell";

export type { EnvironmentTaskGroupShell };

const environmentTaskGroups = createEnvironmentTaskGroupAtoms({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  snapshotAtom: environmentSnapshotAtom,
});
export const taskGroupEnvironment = createTaskGroupEnvironmentAtoms(connectionAtomRuntime);

/** Every task group on the enabled environments, archived ones included. */
export function useTaskGroups(): ReadonlyArray<EnvironmentTaskGroupShell> {
  return useAtomValue(environmentTaskGroups.taskGroupsAtom);
}
