import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture, type ThreadFixtureOverrides } from "../../test-fixtures";
import {
  buildSidebarChildThreadsByParent,
  collectVisibleSidebarDescendants,
  summarizeSidebarSubtree,
} from "./subagentTree";

const localEnv = EnvironmentId.make("local");
const remoteEnv = EnvironmentId.make("remote");
const projectId = ProjectId.make("project-1");

function makeThread(overrides: ThreadFixtureOverrides = {}) {
  return makeThreadFixture({
    environmentId: localEnv,
    projectId,
    ...overrides,
  });
}

describe("sidebar subagent tree", () => {
  it("groups multi-level subagents, side chats, and remote delegated tasks under their parent", () => {
    const rootId = ThreadId.make("root");
    const childAId = ThreadId.make("child-a");
    const childBId = ThreadId.make("child-b");
    const grandchildId = ThreadId.make("grandchild");
    const remoteChildId = ThreadId.make("remote-child");
    const archivedChildId = ThreadId.make("archived-child");

    const root = makeThread({ id: rootId, createdAt: "2026-03-09T10:00:00.000Z" });
    const childB = makeThread({
      id: childBId,
      createdAt: "2026-03-09T10:02:00.000Z",
      lineage: {
        rootThreadId: rootId,
        parentThreadId: rootId,
        relationshipToParent: "subagent",
      },
    });
    const childA = makeThread({
      id: childAId,
      createdAt: "2026-03-09T10:01:00.000Z",
      lineage: {
        rootThreadId: rootId,
        parentThreadId: rootId,
        relationshipToParent: "fork",
        sideChat: true,
      },
    });
    const grandchild = makeThread({
      id: grandchildId,
      createdAt: "2026-03-09T10:03:00.000Z",
      lineage: {
        rootThreadId: rootId,
        parentThreadId: childAId,
        relationshipToParent: "subagent",
      },
    });
    const remoteChild = makeThread({
      environmentId: remoteEnv,
      id: remoteChildId,
      createdAt: "2026-03-09T10:04:00.000Z",
      delegatedFrom: {
        environmentId: localEnv,
        threadId: rootId,
        title: "Root",
      },
    });
    const archivedChild = makeThread({
      id: archivedChildId,
      createdAt: "2026-03-09T10:05:00.000Z",
      archivedAt: "2026-03-09T10:06:00.000Z",
      lineage: {
        rootThreadId: rootId,
        parentThreadId: rootId,
        relationshipToParent: "subagent",
      },
    });

    const remoteChildKey = scopedThreadKey(scopeThreadRef(remoteEnv, remoteChildId));
    const rootKey = scopedThreadKey(scopeThreadRef(localEnv, rootId));
    const childAKey = scopedThreadKey(scopeThreadRef(localEnv, childAId));

    const byParent = buildSidebarChildThreadsByParent(
      [root, childB, childA, grandchild, remoteChild, archivedChild],
      new Set([remoteChildKey]),
    );

    expect(byParent.get(rootKey)?.map((thread) => thread.id)).toEqual([
      childAId,
      childBId,
      remoteChildId,
    ]);
    expect(byParent.get(childAKey)?.map((thread) => thread.id)).toEqual([grandchildId]);
    expect(summarizeSidebarSubtree(rootKey, byParent)).toEqual({
      totalCount: 4,
      runningCount: 0,
      attentionStatus: null,
    });
  });

  it("defaults collapsed when idle, expands on explicit toggle, and auto-expands when a descendant is active or running", () => {
    const rootId = ThreadId.make("root");
    const childId = ThreadId.make("child");
    const grandchildId = ThreadId.make("grandchild");
    const rootKey = scopedThreadKey(scopeThreadRef(localEnv, rootId));
    const childKey = scopedThreadKey(scopeThreadRef(localEnv, childId));
    const grandchildKey = scopedThreadKey(scopeThreadRef(localEnv, grandchildId));

    const idleThreads = [
      makeThread({ id: rootId }),
      makeThread({
        id: childId,
        lineage: { rootThreadId: rootId, parentThreadId: rootId, relationshipToParent: "subagent" },
      }),
      makeThread({
        id: grandchildId,
        lineage: {
          rootThreadId: rootId,
          parentThreadId: childId,
          relationshipToParent: "subagent",
        },
      }),
    ];
    const idleByParent = buildSidebarChildThreadsByParent(idleThreads, new Set());

    expect(collectVisibleSidebarDescendants(rootKey, idleByParent, {}, null).rows).toEqual([]);

    const manualExpanded = collectVisibleSidebarDescendants(
      rootKey,
      idleByParent,
      { [rootKey]: true },
      null,
    );
    expect(manualExpanded.isExpanded).toBe(true);
    expect(manualExpanded.rows.map((row) => [row.thread.id, row.depth])).toEqual([[childId, 1]]);

    const activeGrandchild = collectVisibleSidebarDescendants(
      rootKey,
      idleByParent,
      {},
      grandchildKey,
    );
    expect(activeGrandchild.rows.map((row) => [row.thread.id, row.depth])).toEqual([
      [childId, 1],
      [grandchildId, 2],
    ]);

    const explicitlyCollapsed = collectVisibleSidebarDescendants(
      rootKey,
      idleByParent,
      { [rootKey]: false },
      grandchildKey,
    );
    expect(explicitlyCollapsed.isExpanded).toBe(false);
    expect(explicitlyCollapsed.rows).toEqual([]);

    const runningThreads = [
      makeThread({ id: rootId }),
      makeThread({
        id: childId,
        lineage: { rootThreadId: rootId, parentThreadId: rootId, relationshipToParent: "subagent" },
        runtime: {
          status: "running",
          activeRunId: null,
          providerInstanceId: "codex" as never,
          providerName: "Codex",
          lastError: null,
          updatedAt: "2026-03-09T10:00:00.000Z",
        },
      }),
    ];
    const runningByParent = buildSidebarChildThreadsByParent(runningThreads, new Set());
    const autoRunning = collectVisibleSidebarDescendants(rootKey, runningByParent, {}, null);
    expect(autoRunning.isExpanded).toBe(true);
    expect(autoRunning.summary).toEqual({
      totalCount: 1,
      runningCount: 1,
      attentionStatus: "working",
    });
    expect(autoRunning.rows.map((row) => row.threadKey)).toEqual([childKey]);
  });

  it("handles parent cycles safely without looping", () => {
    const aId = ThreadId.make("a");
    const bId = ThreadId.make("b");
    const aKey = scopedThreadKey(scopeThreadRef(localEnv, aId));
    const threads = [
      makeThread({
        id: aId,
        lineage: { rootThreadId: aId, parentThreadId: bId, relationshipToParent: "subagent" },
      }),
      makeThread({
        id: bId,
        lineage: { rootThreadId: aId, parentThreadId: aId, relationshipToParent: "subagent" },
      }),
    ];
    const byParent = buildSidebarChildThreadsByParent(threads, new Set());
    const result = collectVisibleSidebarDescendants(aKey, byParent, { [aKey]: true }, null);
    expect(result.summary.totalCount).toBe(1);
    expect(result.rows.map((row) => row.thread.id)).toEqual([bId]);
  });
});
