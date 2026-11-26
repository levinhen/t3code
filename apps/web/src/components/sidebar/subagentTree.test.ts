import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  sidebarChildrenWithListedParents,
  type IdleSubagentChildren,
} from "@t3tools/client-runtime/state/threads";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture, type ThreadFixtureOverrides } from "../../test-fixtures";
import {
  buildSidebarChildThreadsByParent,
  collectVisibleSidebarDescendants,
  canNestSidebarThread,
  summarizeSidebarSubtree,
} from "./subagentTree";

const localEnv = EnvironmentId.make("local");
const remoteEnv = EnvironmentId.make("remote");
const projectId = ProjectId.make("project-1");
const NONE: ReadonlySet<string> = new Set();
const NO_IDLE: ReadonlyMap<string, IdleSubagentChildren> = new Map();
const codex = ProviderInstanceId.make("codex");
const claude = ProviderInstanceId.make("claudeAgent");
const running = (providerInstanceId: ProviderInstanceId) => ({
  status: "running" as const,
  activeRunId: null,
  providerInstanceId,
  providerName: providerInstanceId,
  lastError: null,
  updatedAt: "2026-03-09T10:00:00.000Z",
});

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
      providerInstanceIds: [codex],
      runningProviderInstanceIds: [],
    });
  });

  it("moves display subtrees independently of lineage and rejects a descendant as a parent", () => {
    const root = makeThread({ id: ThreadId.make("root") });
    const target = makeThread({ id: ThreadId.make("target") });
    const child = makeThread({
      id: ThreadId.make("child"),
      sidebarParent: { kind: "thread", threadId: target.id },
      lineage: { parentThreadId: root.id, rootThreadId: root.id, relationshipToParent: "subagent" },
    });
    const grandchild = makeThread({
      id: ThreadId.make("grandchild"),
      lineage: {
        parentThreadId: child.id,
        rootThreadId: root.id,
        relationshipToParent: "subagent",
      },
    });
    const promoted = makeThread({
      id: ThreadId.make("promoted"),
      sidebarParent: { kind: "top_level" },
      lineage: { parentThreadId: root.id, rootThreadId: root.id, relationshipToParent: "subagent" },
    });
    const rows = [root, target, child, grandchild, promoted];
    const grouped = buildSidebarChildThreadsByParent(rows, sidebarChildrenWithListedParents(rows));
    const key = (thread: typeof root) =>
      scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
    expect(grouped.get(key(root))).toBeUndefined();
    expect(grouped.get(key(target))).toEqual([child]);
    expect(grouped.get(key(child))).toEqual([grandchild]);
    expect(canNestSidebarThread(target, grandchild, grouped)).toBe(false);
    expect(canNestSidebarThread(child, root, grouped)).toBe(true);
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

    expect(collectVisibleSidebarDescendants(rootKey, idleByParent, NO_IDLE, {}, null).rows).toEqual(
      [],
    );

    const manualExpanded = collectVisibleSidebarDescendants(
      rootKey,
      idleByParent,
      NO_IDLE,
      { [rootKey]: true },
      null,
    );
    expect(manualExpanded.isExpanded).toBe(true);
    expect(manualExpanded.rows.map((row) => [row.thread.id, row.depth])).toEqual([[childId, 1]]);

    const activeGrandchild = collectVisibleSidebarDescendants(
      rootKey,
      idleByParent,
      NO_IDLE,
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
      NO_IDLE,
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
        runtime: running(codex),
      }),
    ];
    const runningByParent = buildSidebarChildThreadsByParent(runningThreads, new Set());
    const autoRunning = collectVisibleSidebarDescendants(
      rootKey,
      runningByParent,
      NO_IDLE,
      {},
      null,
    );
    expect(autoRunning.isExpanded).toBe(true);
    expect(autoRunning.summary).toEqual({
      totalCount: 1,
      runningCount: 1,
      attentionStatus: "working",
      providerInstanceIds: [codex],
      runningProviderInstanceIds: [codex],
    });
    expect(autoRunning.rows.map((row) => row.threadKey)).toEqual([childKey]);
  });

  it("counts and names the idle children the shell left out before and after their rows load", () => {
    const rootId = ThreadId.make("root");
    const childId = ThreadId.make("child");
    const otherId = ThreadId.make("other");
    const rootKey = scopedThreadKey(scopeThreadRef(localEnv, rootId));
    const childKey = scopedThreadKey(scopeThreadRef(localEnv, childId));
    const otherKey = scopedThreadKey(scopeThreadRef(localEnv, otherId));
    const idle = new Map<string, IdleSubagentChildren>([
      [rootKey, { threadKeys: [childKey, otherKey], providerInstanceIds: [claude] }],
    ]);
    const shellOnly = buildSidebarChildThreadsByParent([makeThread({ id: rootId })], NONE);

    const collapsed = collectVisibleSidebarDescendants(rootKey, shellOnly, idle, {}, null);
    expect(collapsed).toMatchObject({ isExpanded: false, familyKeys: [] });
    expect(collapsed.summary).toMatchObject({ totalCount: 2, providerInstanceIds: [claude] });

    const loading = collectVisibleSidebarDescendants(
      rootKey,
      shellOnly,
      idle,
      { [rootKey]: true },
      null,
    );
    expect(loading).toMatchObject({ isExpanded: true, rows: [], familyKeys: [rootKey] });

    const subagent = (id: ThreadId) =>
      makeThread({
        id,
        providerInstanceId: claude,
        lineage: { rootThreadId: rootId, parentThreadId: rootId, relationshipToParent: "subagent" },
      });
    const oneLoaded = buildSidebarChildThreadsByParent(
      [makeThread({ id: rootId }), subagent(childId)],
      NONE,
    );
    const partly = collectVisibleSidebarDescendants(
      rootKey,
      oneLoaded,
      idle,
      { [rootKey]: true },
      null,
    );
    // A loaded child is not counted again, and the parent keeps its family mounted.
    expect(partly.summary.totalCount).toBe(2);
    expect(partly.rows.map((row) => row.threadKey)).toEqual([childKey]);
    expect(partly.familyKeys).toEqual([rootKey]);
  });

  it("names every provider in the subtree and which of them are working", () => {
    const rootId = ThreadId.make("root");
    const rootKey = scopedThreadKey(scopeThreadRef(localEnv, rootId));
    const childKey = (id: string) => scopedThreadKey(scopeThreadRef(localEnv, ThreadId.make(id)));
    const threads = [
      makeThread({ id: rootId }),
      makeThread({
        id: ThreadId.make("claude-child"),
        providerInstanceId: claude,
        runtime: running(claude),
        lineage: { rootThreadId: rootId, parentThreadId: rootId, relationshipToParent: "subagent" },
      }),
      makeThread({
        id: ThreadId.make("codex-grandchild"),
        lineage: {
          rootThreadId: rootId,
          parentThreadId: ThreadId.make("claude-child"),
          relationshipToParent: "subagent",
        },
      }),
    ];
    const idle = new Map<string, IdleSubagentChildren>([
      [
        childKey("codex-grandchild"),
        {
          threadKeys: [childKey("idle-gemini")],
          providerInstanceIds: [ProviderInstanceId.make("gemini")],
        },
      ],
    ]);
    const summary = summarizeSidebarSubtree(
      rootKey,
      buildSidebarChildThreadsByParent(threads, NONE),
      idle,
    );
    expect(summary).toMatchObject({
      totalCount: 3,
      runningCount: 1,
      runningProviderInstanceIds: [claude],
    });
    expect([...summary.providerInstanceIds].toSorted()).toEqual(
      [claude, codex, ProviderInstanceId.make("gemini")].toSorted(),
    );
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
    const result = collectVisibleSidebarDescendants(
      aKey,
      byParent,
      NO_IDLE,
      { [aKey]: true },
      null,
    );
    expect(result.summary.totalCount).toBe(1);
    expect(result.rows.map((row) => row.thread.id)).toEqual([bId]);
  });
});
