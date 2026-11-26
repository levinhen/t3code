import { EnvironmentId, ProjectId, TaskGroupId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture } from "../../test-fixtures";
import {
  compareTaskGroups,
  groupTaskGroupThreadsByFolder,
  partitionTaskGroupMembers,
  sidebarJoinId,
  sidebarJoinKey,
  sidebarTaskGroupDropId,
  sidebarTaskGroupDropKey,
  taskGroupKey,
} from "./taskGroups.logic";

const environmentId = EnvironmentId.make("environment-test");
const otherEnvironmentId = EnvironmentId.make("environment-other");

const group = (id: string, overrides: Record<string, unknown> = {}) => ({
  id: TaskGroupId.make(id),
  environmentId,
  archivedAt: null,
  pinnedAt: null,
  createdAt: "2026-11-26T10:00:00.000Z",
  ...overrides,
});

const thread = (
  id: string,
  taskGroupId: string | null,
  overrides: Record<string, unknown> = {},
) => ({
  ...makeThreadFixture({ id: ThreadId.make(id), environmentId }),
  taskGroupId: taskGroupId === null ? null : TaskGroupId.make(taskGroupId),
  ...overrides,
});

const ids = (threads: ReadonlyArray<{ readonly id: string }>) => threads.map((t) => t.id);

describe("partitionTaskGroupMembers", () => {
  const partition = (
    threads: ReturnType<typeof thread>[],
    groups: ReturnType<typeof group>[],
    options: Partial<Parameters<typeof partitionTaskGroupMembers>[0]> = {},
  ) =>
    partitionTaskGroupMembers({
      threads,
      groups,
      isSnoozed: (candidate) => candidate.snoozedUntil != null,
      isSettled: (candidate) => candidate.settledOverride === "settled",
      keepEmptyGroups: true,
      ...options,
    });

  it("pulls live members into their group, open and settled apart", () => {
    const result = partition(
      [
        thread("a", "g1"),
        thread("b", null),
        thread("c", "g1", { settledOverride: "settled", settledAt: "2026-11-26T11:00:00.000Z" }),
      ],
      [group("g1")],
    );
    expect(ids(result.rest)).toEqual(["b"]);
    expect(result.blocks).toHaveLength(1);
    expect(ids(result.blocks[0]!.openThreads)).toEqual(["a"]);
    expect(ids(result.blocks[0]!.settledThreads)).toEqual(["c"]);
    expect(result.memberKeys.size).toBe(2);
  });

  it("leaves members of archived, missing, or other-environment groups as ordinary threads", () => {
    const result = partition(
      [
        thread("archived", "g-archived"),
        thread("missing", "g-gone"),
        { ...thread("elsewhere", "g1"), environmentId: otherEnvironmentId },
      ],
      [group("g1"), group("g-archived", { archivedAt: "2026-11-26T12:00:00.000Z" })],
    );
    expect(ids(result.rest)).toEqual(["archived", "missing", "elsewhere"]);
    expect(ids(result.blocks.flatMap((block) => block.openThreads))).toEqual([]);
  });

  it("keeps snoozed members in the rest, and a thread leaving its group out of it", () => {
    const leaving = thread("leaving", "g1");
    const result = partition(
      [thread("snoozed", "g1", { snoozedUntil: "2099-01-01T00:00:00.000Z" }), leaving],
      [group("g1")],
      { leavingKey: `${environmentId}:${leaving.id}` },
    );
    expect(ids(result.rest)).toEqual(["snoozed", "leaving"]);
    expect(result.memberKeys.size).toBe(0);
  });

  it("hides empty groups only when asked to", () => {
    expect(partition([], [group("g1")]).blocks).toHaveLength(1);
    expect(partition([], [group("g1")], { keepEmptyGroups: false }).blocks).toHaveLength(0);
  });
});

describe("compareTaskGroups", () => {
  it("puts pinned groups first by pin time, then the newest group first", () => {
    const groups = [
      group("old", { createdAt: "2026-11-01T00:00:00.000Z" }),
      group("pinned-late", { pinnedAt: "2026-11-20T00:00:00.000Z" }),
      group("new", { createdAt: "2026-11-25T00:00:00.000Z" }),
      group("pinned-early", { pinnedAt: "2026-11-10T00:00:00.000Z" }),
    ];
    expect(groups.toSorted(compareTaskGroups).map((candidate) => candidate.id)).toEqual([
      "pinned-early",
      "pinned-late",
      "new",
      "old",
    ]);
  });
});

describe("groupTaskGroupThreadsByFolder", () => {
  it("splits members by working folder in first-seen order", () => {
    const folders = groupTaskGroupThreadsByFolder(
      [
        { ...thread("a", "g1"), projectId: ProjectId.make("web") },
        { ...thread("b", "g1"), projectId: ProjectId.make("api") },
        { ...thread("c", "g1"), projectId: ProjectId.make("web") },
      ],
      (member) => member.projectId,
    );
    expect(folders.map((folder) => [folder.folderKey, ids(folder.threads)])).toEqual([
      ["web", ["a", "c"]],
      ["api", ["b"]],
    ]);
  });
});

describe("task group drop ids", () => {
  it("round-trips group and join targets", () => {
    const key = taskGroupKey(environmentId, TaskGroupId.make("g1"));
    expect(sidebarTaskGroupDropKey(sidebarTaskGroupDropId(key))).toBe(key);
    expect(sidebarJoinKey(sidebarJoinId("env:thread"))).toBe("env:thread");
    expect(sidebarJoinKey("nest:env:thread")).toBeNull();
    expect(sidebarTaskGroupDropKey("env:thread")).toBeNull();
  });
});
