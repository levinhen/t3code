import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { isListedThreadLineage } from "@t3tools/contracts";

import type { SidebarThreadSummary } from "../../types";
import { resolveSidebarThreadStatus } from "../Sidebar.logic";

export type SidebarTreeThread = Pick<
  SidebarThreadSummary,
  | "id"
  | "environmentId"
  | "archivedAt"
  | "createdAt"
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
}

export interface SidebarDescendantRow<T extends SidebarTreeThread> {
  readonly thread: T;
  readonly threadKey: string;
  readonly parentKey: string;
  readonly depth: number;
  readonly childSummary: SidebarSubtreeSummary;
  readonly isExpanded: boolean;
}

export const EMPTY_SUBTREE_SUMMARY: SidebarSubtreeSummary = {
  totalCount: 0,
  runningCount: 0,
  attentionStatus: null,
};

export function resolveSidebarTreeParentKey(
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
): SidebarSubtreeSummary {
  const direct = childrenByParent.get(rootKey);
  if (!direct || direct.length === 0) return EMPTY_SUBTREE_SUMMARY;

  let totalCount = 0;
  let runningCount = 0;
  let hasAttention = false;
  let hasFailed = false;
  const visited = new Set<string>([rootKey]);
  const stack: T[] = [...direct];

  while (stack.length > 0) {
    const child = stack.pop()!;
    const childKey = scopedThreadKey(scopeThreadRef(child.environmentId, child.id));
    if (visited.has(childKey)) continue;
    visited.add(childKey);
    totalCount += 1;

    const status = resolveSidebarThreadStatus(child);
    if (status === "working" || status === "preparing") {
      runningCount += 1;
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
  };
}

export function isSidebarSubtreeExpanded(
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

export function collectVisibleSidebarDescendants<T extends SidebarTreeThread>(
  rootKey: string,
  childrenByParent: ReadonlyMap<string, readonly T[]>,
  expandedById: Readonly<Record<string, boolean>>,
  routeThreadKey: string | null,
): {
  readonly summary: SidebarSubtreeSummary;
  readonly isExpanded: boolean;
  readonly rows: readonly SidebarDescendantRow<T>[];
} {
  const summary = summarizeSidebarSubtree(rootKey, childrenByParent);
  if (summary.totalCount === 0) {
    return { summary, isExpanded: false, rows: [] };
  }

  const activeAncestors = collectActiveAncestors(rootKey, childrenByParent, routeThreadKey);
  const rootExpanded = isSidebarSubtreeExpanded(
    rootKey,
    expandedById,
    summary,
    activeAncestors.has(rootKey),
  );
  if (!rootExpanded) {
    return { summary, isExpanded: false, rows: [] };
  }

  const rows: SidebarDescendantRow<T>[] = [];
  const visited = new Set<string>([rootKey]);
  const walk = (parentKey: string, depth: number) => {
    const children = childrenByParent.get(parentKey);
    if (!children) return;
    for (const child of children) {
      const childKey = scopedThreadKey(scopeThreadRef(child.environmentId, child.id));
      if (visited.has(childKey)) continue;
      visited.add(childKey);
      const childSummary = summarizeSidebarSubtree(childKey, childrenByParent);
      const childExpanded =
        childSummary.totalCount > 0 &&
        isSidebarSubtreeExpanded(
          childKey,
          expandedById,
          childSummary,
          activeAncestors.has(childKey),
        );
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

  return { summary, isExpanded: true, rows };
}
