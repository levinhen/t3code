import type { VcsStatusLocalResult } from "@t3tools/contracts";
import { normalizeProjectPathForComparison } from "@t3tools/shared/path";
import { msg } from "gt-react";

import { m, type MessageResolver } from "./i18n/messages";
import type { ThreadShell } from "./types";

export function getOrphanedWorktreePathForThread(
  threads: ReadonlyArray<Pick<ThreadShell, "id" | "worktreePath">>,
  threadId: ThreadShell["id"],
): string | null {
  const targetThread = threads.find((thread) => thread.id === threadId);
  if (!targetThread) {
    return null;
  }

  const targetWorktreePath = targetThread.worktreePath?.trim();
  if (!targetWorktreePath) {
    return null;
  }

  // Threads can store one worktree as `/repo/wt` and `/repo/wt/`, and
  // confirming deletion force-removes the checkout for every thread on it.
  const targetKey = normalizeProjectPathForComparison(targetWorktreePath);
  const isShared = threads.some(
    (thread) =>
      thread.id !== threadId &&
      thread.worktreePath !== null &&
      normalizeProjectPathForComparison(thread.worktreePath) === targetKey,
  );

  return isShared ? null : targetWorktreePath;
}

export function formatWorktreePathForDisplay(worktreePath: string): string {
  const trimmed = worktreePath.trim();
  if (!trimmed) {
    return worktreePath;
  }

  const normalized = trimmed.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/");
  const lastPart = parts[parts.length - 1]?.trim() ?? "";
  return lastPart.length > 0 ? lastPart : trimmed;
}

/** Lines for the delete-worktree prompt: what the forced removal discards and what it keeps. */
export function describeWorktreeRemoval(
  input: {
    readonly branch: string | null;
    readonly status: Pick<VcsStatusLocalResult, "hasWorkingTreeChanges" | "workingTree"> | null;
  },
  resolve: MessageResolver = m,
): string[] {
  const lines: string[] = [];
  if (input.status?.hasWorkingTreeChanges) {
    const count = input.status.workingTree.files.length;
    lines.push(
      count > 0
        ? resolve(
            msg(
              "{count, plural, one {It has uncommitted changes in {count} file, which deleting the worktree discards.} other {It has uncommitted changes in {count} files, which deleting the worktree discards.}}",
              { count },
            ),
          )
        : resolve(msg("It has uncommitted changes, which deleting the worktree discards.")),
    );
  }
  if (input.branch) {
    lines.push(resolve(msg("Commits stay on its branch, {branch}.", { branch: input.branch })));
  }
  return lines.length > 0 ? [...lines, ""] : lines;
}
