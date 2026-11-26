import { FolderGitIcon } from "lucide-react";

import { type RecentWorktree, resolveRecentWorktreeLabel } from "./BranchToolbar.logic";
import { MiddleTruncate } from "./ui/middle-truncate";

export function RecentWorktreeItemContent({ worktree }: { worktree: RecentWorktree }) {
  return (
    <span className="flex min-w-0 items-start gap-1.5">
      <FolderGitIcon className="mt-1 size-3 shrink-0" />
      <span className="flex min-w-0 flex-col">
        <MiddleTruncate value={resolveRecentWorktreeLabel(worktree)} showTitle={false} />
        {worktree.threadTitle ? (
          <span className="min-w-0 truncate text-muted-foreground text-xs">
            {worktree.threadTitle}
          </span>
        ) : null}
      </span>
    </span>
  );
}
