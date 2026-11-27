import { threadKey } from "@t3tools/client-runtime/state/entities";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  sidebarParentThreadRef,
  type IdleSubagentChildren,
} from "@t3tools/client-runtime/state/threads";
import { type ProviderInstanceId } from "@t3tools/contracts";

import type { SidebarThreadSummary } from "../../types";
import { resolveSidebarThreadStatus } from "../Sidebar.logic";

export type SidebarTreeThread = Pick<
  SidebarThreadSummary,
  | "id"
  | "environmentId"
  | "archivedAt"
  | "createdAt"
  | "modelSelection"
  | "lineage"
  | "sidebarParent"
  | "delegatedFrom"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "pendingSubagentRequest"
  | "pendingGuestMessageCount"
  | "runtime"
  | "blockedOnThreadWait"
>;

export interface SidebarSubtreeSummary {
  readonly totalCount: number;
  readonly runningCount: number;
  /** Waiting on the user: an approval, an answer, or a guest's message. */
  readonly attentionCount: number;
  /** Failed, or stopped at a usage limit. */
  readonly failedCount: number;
  /** Finished, or never ran. */
  readonly doneCount: number;
  /** Every provider in the subtree, in the order the walk meets them. */
  readonly providerInstanceIds: ReadonlyArray<ProviderInstanceId>;
  /** The providers of its working threads. */
  readonly runningProviderInstanceIds: ReadonlyArray<ProviderInstanceId>;
}

export interface SidebarDescendantRow<T extends SidebarTreeThread> {
  readonly thread: T;
  readonly threadKey: string;
  readonly parentKey: string;
  readonly depth: number;
  readonly childSummary: SidebarSubtreeSummary;
  readonly isExpanded: boolean;
  /** Shown under a collapsed ancestor because it is running, waiting on the user, or open. */
  readonly peek: boolean;
}

const EMPTY_SUBTREE_SUMMARY: SidebarSubtreeSummary = {
  totalCount: 0,
  runningCount: 0,
  attentionCount: 0,
  failedCount: 0,
  doneCount: 0,
  providerInstanceIds: [],
  runningProviderInstanceIds: [],
};

const NO_IDLE_CHILDREN: ReadonlyMap<string, IdleSubagentChildren> = new Map();

const treeThreadKey = (thread: Pick<SidebarTreeThread, "environmentId" | "id">) =>
  scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));

const sidebarThreadProviderInstanceId = (
  thread: Pick<SidebarTreeThread, "runtime" | "modelSelection">,
) => thread.runtime?.providerInstanceId ?? thread.modelSelection.instanceId;

/** Where a thread counts in its parent's summary. */
export type SidebarSubtreeState = "running" | "attention" | "failed" | "done";

export function sidebarSubtreeState(thread: SidebarTreeThread): SidebarSubtreeState {
  switch (resolveSidebarThreadStatus(thread)) {
    case "working":
    case "preparing":
      return "running";
    case "waiting":
      // Blocked on a thread of its own, so its turn is still going.
      return thread.runtime?.status === "running" ? "running" : "done";
    case "approval":
    case "input":
    case "request":
      return "attention";
    case "failed":
    case "limited":
      return "failed";
    case "ready":
      return "done";
  }
}

/** The idle children the shell left out that no loaded row stands for yet. */
function unloadedIdleChildren<T extends SidebarTreeThread>(
  parentKey: string,
  children: readonly T[] | undefined,
  idleChildren: ReadonlyMap<string, IdleSubagentChildren>,
): {
  readonly count: number;
  readonly failedCount: number;
  readonly entry: IdleSubagentChildren | undefined;
} {
  const entry = idleChildren.get(parentKey);
  if (entry === undefined) return { count: 0, failedCount: 0, entry };
  const loaded = new Set((children ?? []).map(treeThreadKey));
  const unloaded = entry.threadKeys.filter((key) => !loaded.has(key));
  return {
    count: unloaded.length,
    failedCount: unloaded.filter((key) => entry.failedThreadKeys.has(key)).length,
    entry,
  };
}

function resolveSidebarTreeParentKey(
  thread: Pick<
    SidebarTreeThread,
    "id" | "environmentId" | "archivedAt" | "lineage" | "delegatedFrom" | "sidebarParent"
  >,
  delegatedUnderParent: ReadonlySet<string>,
): string | null {
  if (thread.archivedAt !== null) return null;
  const parent = sidebarParentThreadRef(thread);
  if (parent === null) return null;
  if (
    (thread.sidebarParent != null ||
      (thread.delegatedFrom != null && thread.lineage.relationshipToParent !== "subagent")) &&
    !delegatedUnderParent.has(
      threadKey({ environmentId: thread.environmentId, threadId: thread.id }),
    ) &&
    !delegatedUnderParent.has(treeThreadKey(thread))
  )
    return null;
  return scopedThreadKey(parent);
}

function compareSidebarChildThreads<T extends Pick<SidebarTreeThread, "createdAt" | "id">>(
  left: T,
  right: T,
): number {
  const leftMs = Date.parse(left.createdAt);
  const rightMs = Date.parse(right.createdAt);
  if (Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs !== rightMs) {
    return leftMs - rightMs;
  }
  return left.id.localeCompare(right.id);
}

export function buildSidebarChildThreadsByParent<T extends SidebarTreeThread>(
  threads: readonly T[],
  delegatedUnderParent: ReadonlySet<string>,
): Map<string, T[]> {
  const byParent = new Map<string, T[]>();
  for (const thread of threads) {
    const parentKey = resolveSidebarTreeParentKey(thread, delegatedUnderParent);
    if (parentKey === null) continue;
    const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
    if (parentKey === key) continue;
    const list = byParent.get(parentKey);
    if (list) list.push(thread);
    else byParent.set(parentKey, [thread]);
  }
  for (const list of byParent.values()) {
    if (list.length > 1) list.sort(compareSidebarChildThreads);
  }
  return byParent;
}

export function summarizeSidebarSubtree<T extends SidebarTreeThread>(
  rootKey: string,
  childrenByParent: ReadonlyMap<string, readonly T[]>,
  idleChildren: ReadonlyMap<string, IdleSubagentChildren> = NO_IDLE_CHILDREN,
): SidebarSubtreeSummary {
  const direct = childrenByParent.get(rootKey);
  const rootIdle = unloadedIdleChildren(rootKey, direct, idleChildren);
  if ((!direct || direct.length === 0) && rootIdle.count === 0) return EMPTY_SUBTREE_SUMMARY;

  let totalCount = 0;
  let runningCount = 0;
  let attentionCount = 0;
  let failedCount = 0;
  const providers = new Set<ProviderInstanceId>();
  const runningProviders = new Set<ProviderInstanceId>();
  // The shell leaves out only children that cannot be live, so these are finished or failed.
  const addIdle = (idle: ReturnType<typeof unloadedIdleChildren>) => {
    if (idle.count === 0 || idle.entry === undefined) return;
    totalCount += idle.count;
    failedCount += idle.failedCount;
    for (const providerInstanceId of idle.entry.providerInstanceIds)
      providers.add(providerInstanceId);
  };
  addIdle(rootIdle);
  const visited = new Set<string>([rootKey]);
  const stack: T[] = [...(direct ?? [])];

  while (stack.length > 0) {
    const child = stack.pop()!;
    const childKey = treeThreadKey(child);
    if (visited.has(childKey)) continue;
    visited.add(childKey);
    totalCount += 1;
    const providerInstanceId = sidebarThreadProviderInstanceId(child);
    providers.add(providerInstanceId);

    const state = sidebarSubtreeState(child);
    if (state === "running") {
      runningCount += 1;
      runningProviders.add(providerInstanceId);
    } else if (state === "attention") {
      attentionCount += 1;
    } else if (state === "failed") {
      failedCount += 1;
    }

    const nested = childrenByParent.get(childKey);
    addIdle(unloadedIdleChildren(childKey, nested, idleChildren));
    if (nested) {
      for (const grandchild of nested) stack.push(grandchild);
    }
  }

  return {
    totalCount,
    runningCount,
    attentionCount,
    failedCount,
    doneCount: totalCount - runningCount - attentionCount - failedCount,
    providerInstanceIds: [...providers],
    runningProviderInstanceIds: [...runningProviders],
  };
}

/** Running children show under a collapsed parent, so only an open descendant expands it. */
function isSidebarSubtreeExpanded(
  threadKey: string,
  expandedById: Readonly<Record<string, boolean>>,
  hasActiveDescendant: boolean,
): boolean {
  return expandedById[threadKey] ?? hasActiveDescendant;
}

function collectActiveAncestors<T extends SidebarTreeThread>(
  rootKey: string,
  childrenByParent: ReadonlyMap<string, readonly T[]>,
  routeThreadKey: string | null,
): Set<string> {
  const activeAncestors = new Set<string>();
  if (routeThreadKey === null || routeThreadKey === rootKey) return activeAncestors;

  const visited = new Set<string>([rootKey]);
  const walk = (parentKey: string): boolean => {
    const children = childrenByParent.get(parentKey);
    if (!children) return false;
    for (const child of children) {
      const childKey = scopedThreadKey(scopeThreadRef(child.environmentId, child.id));
      if (visited.has(childKey)) continue;
      visited.add(childKey);
      if (childKey === routeThreadKey || walk(childKey)) {
        activeAncestors.add(parentKey);
        return true;
      }
    }
    return false;
  };
  walk(rootKey);
  return activeAncestors;
}

/**
 * `idleChildren` are the children the shell left out, counted before their rows load.
 * `familyKeys` lists the expanded parents that have them, whose thread family to read; a parent
 * stays listed once its rows load, so they stay mounted while it is open.
 */
export function collectVisibleSidebarDescendants<T extends SidebarTreeThread>(
  rootKey: string,
  childrenByParent: ReadonlyMap<string, readonly T[]>,
  idleChildren: ReadonlyMap<string, IdleSubagentChildren>,
  expandedById: Readonly<Record<string, boolean>>,
  routeThreadKey: string | null,
): {
  readonly summary: SidebarSubtreeSummary;
  readonly isExpanded: boolean;
  readonly rows: readonly SidebarDescendantRow<T>[];
  readonly familyKeys: readonly string[];
} {
  const summary = summarizeSidebarSubtree(rootKey, childrenByParent, idleChildren);
  if (summary.totalCount === 0) {
    return { summary, isExpanded: false, rows: [], familyKeys: [] };
  }

  const activeAncestors = collectActiveAncestors(rootKey, childrenByParent, routeThreadKey);
  const rows: SidebarDescendantRow<T>[] = [];
  const visited = new Set<string>([rootKey]);
  // Every descendant of a collapsed parent that is running, waiting on the user, or open, one
  // level under it: a peek row has no subtree of its own to open.
  const peek = (parentKey: string, depth: number) => {
    for (const child of childrenByParent.get(parentKey) ?? []) {
      const childKey = treeThreadKey(child);
      if (visited.has(childKey)) continue;
      visited.add(childKey);
      const state = sidebarSubtreeState(child);
      if (state === "running" || state === "attention" || childKey === routeThreadKey) {
        rows.push({
          thread: child,
          threadKey: childKey,
          parentKey,
          depth,
          childSummary: EMPTY_SUBTREE_SUMMARY,
          isExpanded: false,
          peek: true,
        });
      }
      peek(childKey, depth);
    }
  };
  if (!isSidebarSubtreeExpanded(rootKey, expandedById, activeAncestors.has(rootKey))) {
    peek(rootKey, 1);
    return { summary, isExpanded: false, rows, familyKeys: [] };
  }

  const familyKeys = idleChildren.has(rootKey) ? [rootKey] : [];
  const walk = (parentKey: string, depth: number) => {
    const children = childrenByParent.get(parentKey);
    if (!children) return;
    for (const child of children) {
      const childKey = treeThreadKey(child);
      if (visited.has(childKey)) continue;
      visited.add(childKey);
      const childSummary = summarizeSidebarSubtree(childKey, childrenByParent, idleChildren);
      const childExpanded =
        childSummary.totalCount > 0 &&
        isSidebarSubtreeExpanded(childKey, expandedById, activeAncestors.has(childKey));
      if (childExpanded && idleChildren.has(childKey)) familyKeys.push(childKey);
      rows.push({
        thread: child,
        threadKey: childKey,
        parentKey,
        depth,
        childSummary,
        isExpanded: childExpanded,
        peek: false,
      });
      if (childExpanded) {
        walk(childKey, depth + 1);
      } else {
        peek(childKey, depth + 1);
      }
    }
  };
  walk(rootKey, 1);

  return { summary, isExpanded: true, rows, familyKeys };
}

export function canNestSidebarThread<T extends SidebarTreeThread>(
  source: T,
  target: T,
  childrenByParent: ReadonlyMap<string, readonly T[]>,
): boolean {
  if (
    source.environmentId !== target.environmentId ||
    source.id === target.id ||
    [source, target].some(
      (thread) =>
        thread.archivedAt !== null ||
        thread.lineage.sideChat === true ||
        thread.lineage.workflowStep === true,
    )
  )
    return false;
  const sourceKey = treeThreadKey(source);
  const targetKey = treeThreadKey(target);
  if ((childrenByParent.get(targetKey) ?? []).some((child) => treeThreadKey(child) === sourceKey)) {
    return false;
  }
  const stack = [sourceKey];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const key = stack.pop()!;
    if (key === targetKey) return false;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const child of childrenByParent.get(key) ?? []) stack.push(treeThreadKey(child));
  }
  return true;
}
