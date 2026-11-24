import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { IdleSubagentChildren } from "@t3tools/client-runtime/state/threads";
import { isListedThreadLineage, type ProviderInstanceId } from "@t3tools/contracts";

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
  readonly attentionStatus: "attention" | "failed" | "working" | null;
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
}

const EMPTY_SUBTREE_SUMMARY: SidebarSubtreeSummary = {
  totalCount: 0,
  runningCount: 0,
  attentionStatus: null,
  providerInstanceIds: [],
  runningProviderInstanceIds: [],
};

const NO_IDLE_CHILDREN: ReadonlyMap<string, IdleSubagentChildren> = new Map();

const treeThreadKey = (thread: Pick<SidebarTreeThread, "environmentId" | "id">) =>
  scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));

const sidebarThreadProviderInstanceId = (
  thread: Pick<SidebarTreeThread, "runtime" | "modelSelection">,
) => thread.runtime?.providerInstanceId ?? thread.modelSelection.instanceId;

/** The idle children the shell left out that no loaded row stands for yet. */
function unloadedIdleChildren<T extends SidebarTreeThread>(
  parentKey: string,
  children: readonly T[] | undefined,
  idleChildren: ReadonlyMap<string, IdleSubagentChildren>,
): { readonly count: number; readonly entry: IdleSubagentChildren | undefined } {
  const entry = idleChildren.get(parentKey);
  if (entry === undefined) return { count: 0, entry };
  if (children === undefined || children.length === 0) {
    return { count: entry.threadKeys.length, entry };
  }
  const loaded = new Set(children.map(treeThreadKey));
  return { count: entry.threadKeys.filter((key) => !loaded.has(key)).length, entry };
}

function resolveSidebarTreeParentKey(
  thread: Pick<
    SidebarTreeThread,
    "id" | "environmentId" | "archivedAt" | "lineage" | "delegatedFrom"
  >,
  delegatedUnderParent: ReadonlySet<string>,
): string | null {
  if (thread.archivedAt !== null) return null;
  if (!isListedThreadLineage(thread.lineage)) {
    if (thread.lineage.parentThreadId === null) return null;
    return scopedThreadKey(scopeThreadRef(thread.environmentId, thread.lineage.parentThreadId));
  }
  if (thread.delegatedFrom != null) {
    const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
    if (!delegatedUnderParent.has(key)) return null;
    return scopedThreadKey(
      scopeThreadRef(thread.delegatedFrom.environmentId, thread.delegatedFrom.threadId),
    );
  }
  return null;
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
  let hasAttention = false;
  let hasFailed = false;
  const providers = new Set<ProviderInstanceId>();
  const runningProviders = new Set<ProviderInstanceId>();
  const addIdle = (idle: ReturnType<typeof unloadedIdleChildren>) => {
    if (idle.count === 0 || idle.entry === undefined) return;
    totalCount += idle.count;
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

    const status = resolveSidebarThreadStatus(child);
    if (status === "working" || status === "preparing") {
      runningCount += 1;
      runningProviders.add(providerInstanceId);
    } else if (
      status === "approval" ||
      status === "input" ||
      status === "request" ||
      status === "limited"
    ) {
      hasAttention = true;
    } else if (status === "failed") {
      hasFailed = true;
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
    attentionStatus: hasAttention
      ? "attention"
      : hasFailed
        ? "failed"
        : runningCount > 0
          ? "working"
          : null,
    providerInstanceIds: [...providers],
    runningProviderInstanceIds: [...runningProviders],
  };
}

function isSidebarSubtreeExpanded(
  threadKey: string,
  expandedById: Readonly<Record<string, boolean>>,
  summary: SidebarSubtreeSummary,
  hasActiveDescendant: boolean,
): boolean {
  const explicit = expandedById[threadKey];
  if (explicit !== undefined) return explicit;
  return summary.runningCount > 0 || hasActiveDescendant;
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
  const rootExpanded = isSidebarSubtreeExpanded(
    rootKey,
    expandedById,
    summary,
    activeAncestors.has(rootKey),
  );
  if (!rootExpanded) {
    return { summary, isExpanded: false, rows: [], familyKeys: [] };
  }

  const rows: SidebarDescendantRow<T>[] = [];
  const familyKeys = idleChildren.has(rootKey) ? [rootKey] : [];
  const visited = new Set<string>([rootKey]);
  const walk = (parentKey: string, depth: number) => {
    const children = childrenByParent.get(parentKey);
    if (!children) return;
    for (const child of children) {
      const childKey = scopedThreadKey(scopeThreadRef(child.environmentId, child.id));
      if (visited.has(childKey)) continue;
      visited.add(childKey);
      const childSummary = summarizeSidebarSubtree(childKey, childrenByParent, idleChildren);
      const childExpanded =
        childSummary.totalCount > 0 &&
        isSidebarSubtreeExpanded(
          childKey,
          expandedById,
          childSummary,
          activeAncestors.has(childKey),
        );
      if (childExpanded && idleChildren.has(childKey)) familyKeys.push(childKey);
      rows.push({
        thread: child,
        threadKey: childKey,
        parentKey,
        depth,
        childSummary,
        isExpanded: childExpanded,
      });
      if (childExpanded) {
        walk(childKey, depth + 1);
      }
    }
  };
  walk(rootKey, 1);

  return { summary, isExpanded: true, rows, familyKeys };
}
