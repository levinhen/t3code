import type { EnvironmentId, OrchestrationTaskGroupShell, TaskGroupId } from "@t3tools/contracts";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  sortActiveThreadsByOrderKey,
  sortSettledThreads,
} from "@t3tools/client-runtime/state/thread-sort";

import type { SidebarThreadSummary } from "../../types";

type TaskGroupRef = Pick<
  OrchestrationTaskGroupShell,
  "id" | "archivedAt" | "pinnedAt" | "createdAt"
> & {
  readonly environmentId: EnvironmentId;
};

export const taskGroupKey = (environmentId: EnvironmentId, taskGroupId: TaskGroupId) =>
  `${environmentId}:${taskGroupId}`;

/** The group's sidebar tree row; its member rows name it as their parent. */
export const sidebarTaskGroupRowId = (key: string) => `task-group:${key}`;

/** A whole group block accepts a dragged thread as a new member. */
export const sidebarTaskGroupDropId = (key: string) => `task-group-drop:${key}`;
export const sidebarTaskGroupDropKey = (id: string) =>
  id.startsWith("task-group-drop:") ? id.slice("task-group-drop:".length) : null;

/** The left half of a covered row: group the dragged thread with that row's thread. */
export const sidebarJoinId = (threadKey: string) => `join:${threadKey}`;
export const sidebarJoinKey = (id: string) => (id.startsWith("join:") ? id.slice(5) : null);

export function threadTaskGroupKey(
  thread: Pick<SidebarThreadSummary, "environmentId" | "taskGroupId">,
): string | null {
  return thread.taskGroupId == null ? null : taskGroupKey(thread.environmentId, thread.taskGroupId);
}

export interface SidebarTaskGroupBlock<G, T> {
  readonly key: string;
  readonly group: G;
  /** Members still in play, in the Active list's order. */
  readonly openThreads: readonly T[];
  /** Settled members, newest first; they fold at the bottom of the group. */
  readonly settledThreads: readonly T[];
}

/**
 * Pulls the members of live (unarchived) groups out of the thread list. Snoozed members stay in
 * the rest so they wait in the Snoozed shelf like any other thread, and return to their group
 * when they wake. An archived group lists nothing: its members read as ordinary threads.
 */
export function partitionTaskGroupMembers<
  G extends TaskGroupRef,
  T extends SidebarThreadSummary,
>(input: {
  readonly threads: readonly T[];
  readonly groups: readonly G[];
  readonly isSnoozed: (thread: T) => boolean;
  readonly isSettled: (thread: T) => boolean;
  /** Under a project filter, a group with no member in scope is hidden. */
  readonly keepEmptyGroups: boolean;
  /** A thread held in place by a drop that is taking it out of its group. */
  readonly leavingKey?: string | null;
}): {
  readonly blocks: readonly SidebarTaskGroupBlock<G, T>[];
  readonly memberKeys: ReadonlySet<string>;
  readonly rest: readonly T[];
} {
  const live = new Map(
    input.groups
      .filter((group) => group.archivedAt === null)
      .map((group) => [taskGroupKey(group.environmentId, group.id), group] as const),
  );
  if (live.size === 0) return { blocks: [], memberKeys: new Set(), rest: input.threads };
  const open = new Map<string, T[]>();
  const settled = new Map<string, T[]>();
  const memberKeys = new Set<string>();
  const rest: T[] = [];
  for (const thread of input.threads) {
    const key = threadTaskGroupKey(thread);
    const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
    if (
      key === null ||
      !live.has(key) ||
      threadKey === input.leavingKey ||
      input.isSnoozed(thread)
    ) {
      rest.push(thread);
      continue;
    }
    memberKeys.add(threadKey);
    const target = input.isSettled(thread) ? settled : open;
    const list = target.get(key);
    if (list) list.push(thread);
    else target.set(key, [thread]);
  }
  const blocks = [...live]
    .flatMap(([key, group]) => {
      const openThreads = open.get(key) ?? [];
      const settledThreads = settled.get(key) ?? [];
      if (!input.keepEmptyGroups && openThreads.length + settledThreads.length === 0) return [];
      return [
        {
          key,
          group,
          openThreads: sortActiveThreadsByOrderKey(openThreads),
          settledThreads: sortSettledThreads(settledThreads),
        },
      ];
    })
    .toSorted((left, right) => compareTaskGroups(left.group, right.group));
  return { blocks, memberKeys, rest };
}

/** Pinned groups first, oldest pin on top; then the newest group first. Activity never reorders. */
export function compareTaskGroups(left: TaskGroupRef, right: TaskGroupRef): number {
  if ((left.pinnedAt === null) !== (right.pinnedAt === null))
    return left.pinnedAt === null ? 1 : -1;
  if (left.pinnedAt !== null && right.pinnedAt !== null && left.pinnedAt !== right.pinnedAt) {
    return left.pinnedAt < right.pinnedAt ? -1 : 1;
  }
  if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? 1 : -1;
  return left.id.localeCompare(right.id);
}

/** Members split by working folder, in order of each folder's first member. */
export function groupTaskGroupThreadsByFolder<T>(
  threads: readonly T[],
  folderKeyOf: (thread: T) => string,
): Array<{ readonly folderKey: string; readonly threads: T[] }> {
  const byFolder = new Map<string, T[]>();
  for (const thread of threads) {
    const key = folderKeyOf(thread);
    const list = byFolder.get(key);
    if (list) list.push(thread);
    else byFolder.set(key, [thread]);
  }
  return [...byFolder].map(([folderKey, list]) => ({ folderKey, threads: list }));
}
