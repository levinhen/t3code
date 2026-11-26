import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, TaskGroupId } from "@t3tools/contracts";

import {
  compareTaskGroups,
  taskGroupKey,
  threadTaskGroupKey,
} from "../components/sidebar/taskGroups.logic";
import type {
  ThreadActionMenuId,
  ThreadActionMenuState,
} from "../components/threadActionMenu.logic";
import {
  taskGroupEnvironment,
  useTaskGroups,
  type EnvironmentTaskGroupShell,
} from "../state/taskGroups";
import { threadEnvironment } from "../state/threads";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { nextTaskGroupColor } from "../taskGroupColors";
import { useUiStateStore } from "../uiStateStore";

/** Where the sidebar keeps a task group's open state, beside thread subtrees. */
export const taskGroupExpansionKey = (groupKey: string) => `task-group:${groupKey}`;

type GroupableThread = Pick<
  EnvironmentThreadShell,
  "environmentId" | "id" | "taskGroupId" | "lineage"
>;

/** Joining, starting, and leaving task groups, shared by the sidebar and the thread menu. */
export function useTaskGroupActions() {
  const taskGroups = useTaskGroups();
  const setSidebarParent = useOrchestrationCommand(threadEnvironment.setSidebarParent, {
    reportFailure: true,
  });
  const setThreadTaskGroup = useOrchestrationCommand(threadEnvironment.setTaskGroup, {
    reportFailure: true,
  });
  const createTaskGroup = useOrchestrationCommand(taskGroupEnvironment.createTaskGroup, {
    reportFailure: true,
  });
  const setThreadSubtreeExpanded = useUiStateStore((store) => store.setThreadSubtreeExpanded);
  const taskGroupByKey = new Map(
    taskGroups.map((group) => [taskGroupKey(group.environmentId, group.id), group] as const),
  );
  const liveTaskGroupOf = (thread: Pick<GroupableThread, "environmentId" | "taskGroupId">) => {
    const key = threadTaskGroupKey(thread);
    const group = key === null ? undefined : taskGroupByKey.get(key);
    return group !== undefined && group.archivedAt === null ? group : null;
  };
  const expand = (environmentId: EnvironmentId, taskGroupId: TaskGroupId) =>
    setThreadSubtreeExpanded(taskGroupExpansionKey(taskGroupKey(environmentId, taskGroupId)), true);
  // A subagent shown under its parent leaves the tree first, or its group would not show it.
  const promoteForGrouping = async (thread: GroupableThread, isChild: boolean) => {
    if (!isChild) return true;
    const result = await setSidebarParent({
      environmentId: thread.environmentId,
      input: { threadId: thread.id, parent: { kind: "top_level" } },
    });
    return result._tag === "Success";
  };
  const joinTaskGroup = async (
    thread: GroupableThread,
    group: EnvironmentTaskGroupShell,
    isChild: boolean,
  ) => {
    if (!isChild && liveTaskGroupOf(thread)?.id === group.id) return;
    expand(group.environmentId, group.id);
    if (!(await promoteForGrouping(thread, isChild))) return;
    await setThreadTaskGroup({
      environmentId: thread.environmentId,
      input: { threadId: thread.id, taskGroupId: group.id },
    });
  };
  /** The server names the group from its threads with the small model. */
  const startTaskGroup = async (
    environmentId: EnvironmentId,
    members: readonly Pick<GroupableThread, "id">[],
  ) => {
    const result = await createTaskGroup({
      environmentId,
      input: {
        threadIds: members.map((thread) => thread.id),
        color: nextTaskGroupColor(
          taskGroups
            .filter((group) => group.environmentId === environmentId && group.archivedAt === null)
            .map((group) => group.color),
        ),
      },
    });
    if (result._tag === "Success") expand(environmentId, result.value.taskGroup.id);
  };
  const leaveTaskGroup = (thread: GroupableThread) =>
    setThreadTaskGroup({
      environmentId: thread.environmentId,
      input: { threadId: thread.id, taskGroupId: null },
    });
  const menuState = (thread: GroupableThread): Pick<ThreadActionMenuState, "taskGroups"> =>
    thread.lineage.sideChat === true || thread.lineage.workflowStep === true
      ? {}
      : {
          taskGroups: {
            currentId: liveTaskGroupOf(thread)?.id ?? null,
            options: taskGroups
              .filter(
                (group) =>
                  group.environmentId === thread.environmentId && group.archivedAt === null,
              )
              .toSorted(compareTaskGroups)
              .map((group) => ({ id: group.id, label: group.title })),
          },
        };
  /** Runs a task group item from the thread menu; false for any other item. */
  const runMenuAction = (
    action: ThreadActionMenuId,
    thread: GroupableThread,
    isChild: boolean,
  ): boolean => {
    if (action.startsWith("task-group:set:")) {
      const group = taskGroupByKey.get(
        taskGroupKey(thread.environmentId, action.slice("task-group:set:".length) as TaskGroupId),
      );
      if (group) void joinTaskGroup(thread, group, isChild);
      return true;
    }
    if (action === "task-group:new") {
      void (async () => {
        if (await promoteForGrouping(thread, isChild)) {
          await startTaskGroup(thread.environmentId, [thread]);
        }
      })();
      return true;
    }
    if (action === "task-group:remove") {
      void leaveTaskGroup(thread);
      return true;
    }
    return false;
  };
  return {
    taskGroups,
    taskGroupByKey,
    liveTaskGroupOf,
    promoteForGrouping,
    joinTaskGroup,
    startTaskGroup,
    leaveTaskGroup,
    menuState,
    runMenuAction,
  };
}
