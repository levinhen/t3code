import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import { useEnvironmentScope } from "../../state/session";
import { sidebarNestId } from "../Sidebar.drag";
import { toServerClock } from "@t3tools/client-runtime/clock";
import {
  parseScopedThreadKey,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import { formatWorkingDurationLabel } from "@t3tools/client-runtime/state/models";
import { resolveThreadActivityTimestamp } from "@t3tools/client-runtime/state/thread-sort";
import {
  type ContextMenuSource,
  type EnvironmentId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import {
  BotIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  FolderGit2Icon,
  GitBranchIcon,
  MessageCircleQuestionIcon,
  MessagesSquareIcon,
  ShieldQuestionIcon,
} from "lucide-react";
import {
  memo,
  useEffect,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { msg, useGT, useMessages } from "gt-react";

import type { MessageResolver } from "../../i18n/messages";
import { contextMenuSourceOf } from "../../contextMenuSource";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useNowSecond } from "../../hooks/useNowSecond";
import { shouldShowInstanceBadge } from "../../providerInstances";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { useThreadShell } from "../../state/entities";
import { threadFamilies } from "../../state/threads";
import { formatRelativeTime } from "../../timestampFormat";
import type { SidebarThreadSummary } from "../../types";
import { cn } from "~/lib/utils";
import { textDirection } from "~/textDirection";
import { formatWorktreePathForDisplay } from "../../worktreeCleanup";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { getTriggerDisplayModelName } from "../chat/providerIconUtils";
import {
  resolveSidebarThreadStatus,
  resolveWorkingStartedAt,
  type SidebarDropVerb,
} from "../Sidebar.logic";
import { ThreadHoverCard, ThreadHoverCardPopup } from "../ThreadHoverCard";
import { MiddleTruncate } from "../ui/middle-truncate";
import { Tooltip, TooltipTrigger } from "../ui/tooltip";
import { dropVerbBadge, type SidebarProviderEntry } from "./SidebarThreadRow";
import { SidebarSubtreeCounts } from "./SidebarSubtreeCounts";
import type { SidebarSubtreeSummary } from "./subagentTree";

function compactTimeLabel(timestamp: string, nowMs: number, resolve: MessageResolver) {
  const parts = formatRelativeTime(timestamp, nowMs, resolve);
  if (parts === null) return "";
  return parts.suffix === null ? resolve(msg("now", { $context: "relative time" })) : parts.value;
}

function SubagentRelativeTime(props: { timestamp: string | null }) {
  const nowMinute = useNowMinute();
  const messages = useMessages();
  return props.timestamp === null
    ? null
    : compactTimeLabel(props.timestamp, Date.parse(`${nowMinute}:00.000Z`), messages);
}

function SubagentWorkingDuration(props: {
  environmentId: EnvironmentId;
  startedAt: string | null;
}) {
  const startedMs = props.startedAt !== null ? Date.parse(props.startedAt) : Number.NaN;
  if (Number.isNaN(startedMs)) return null;
  return <SubagentWorkingDurationTick environmentId={props.environmentId} startedMs={startedMs} />;
}

function SubagentWorkingDurationTick(props: { environmentId: EnvironmentId; startedMs: number }) {
  const nowMs = useNowSecond();
  const messages = useMessages();
  return (
    <span className="tabular-nums">
      {formatWorkingDurationLabel(
        toServerClock(props.environmentId, nowMs) - props.startedMs,
        messages,
      )}
    </span>
  );
}

/** Holds a thread's family in the shell rows while its subtree is open, so idle children load. */
export function SidebarThreadFamilyMount({ threadKey }: { threadKey: string }) {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- holds the family in the thread family registry while the subtree is open
  useEffect(() => {
    const ref = parseScopedThreadKey(threadKey);
    if (ref === null) return;
    return threadFamilies.mount(appAtomRegistry, ref.environmentId, ref.threadId);
  }, [threadKey]);
  return null;
}

export interface SidebarSubagentTreeRowProps {
  readonly thread: SidebarThreadSummary;
  readonly parentKey: string;
  readonly depth: number;
  readonly childSummary: SidebarSubtreeSummary;
  readonly isExpanded: boolean;
  /** Shown under a collapsed parent because it is running, waiting on the user, or open. */
  readonly peek?: boolean | undefined;
  /** Under a folder row, whose chevron sits in the gutter left of its title. */
  readonly inFolder?: boolean | undefined;
  readonly isActive: boolean;
  readonly contextDrag?: boolean | undefined;
  readonly draggingOverNest?: boolean | undefined;
  readonly isAncestorDragging?: boolean | undefined;
  readonly dropVerb?: SidebarDropVerb | null | undefined;
  readonly revealRef?:
    | ((row: HTMLElement, threadKey: string) => (() => void) | undefined)
    | undefined;
  readonly providerEntryByInstanceId: ReadonlyMap<string, SidebarProviderEntry>;
  readonly onToggleExpand: (threadKey: string, currentlyExpanded: boolean) => void;
  readonly onThreadClick: (event: ReactMouseEvent, threadRef: ScopedThreadRef) => void;
  readonly onThreadActivate: (threadRef: ScopedThreadRef) => void;
  readonly onContextMenu: (
    threadRef: ScopedThreadRef,
    position: { x: number; y: number },
    source: ContextMenuSource,
  ) => void;
}

export const SidebarSubagentTreeRow = memo(function SidebarSubagentTreeRow(
  props: SidebarSubagentTreeRowProps,
) {
  const gt = useGT();
  const threadRef = scopeThreadRef(props.thread.environmentId, props.thread.id);
  const threadKey = scopedThreadKey(threadRef);
  const thread = useThreadShell(threadRef) ?? props.thread;
  const canOperate = useEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope);
  const disabled =
    !canOperate ||
    thread.archivedAt !== null ||
    thread.lineage.sideChat === true ||
    thread.lineage.workflowStep === true;
  const drag = useDraggable({ id: threadKey, disabled });
  const nest = useDroppable({ id: sidebarNestId(threadKey), disabled });
  const isDragging = drag.isDragging && props.contextDrag !== true;
  const isNestOver = nest.isOver && props.contextDrag !== true;
  const setDragRef = (node: HTMLElement | null) => {
    drag.setNodeRef(node);
    nest.setNodeRef(node);
  };
  const status = resolveSidebarThreadStatus(thread);
  const isWorking = status === "working" || status === "preparing";
  const isSideChat = thread.lineage.sideChat === true;

  const modelInstanceId = thread.runtime?.providerInstanceId ?? thread.modelSelection.instanceId;
  const providerEntry = props.providerEntryByInstanceId.get(modelInstanceId) ?? null;
  const showInstanceBadge =
    providerEntry !== null &&
    shouldShowInstanceBadge(providerEntry, props.providerEntryByInstanceId.values());
  const selectedModel = providerEntry?.models.find(
    (model) => model.slug === thread.modelSelection.model,
  );
  const modelLabel = selectedModel
    ? getTriggerDisplayModelName(selectedModel, providerEntry?.driverKind)
    : thread.modelSelection.model;

  const statusDotClass = isWorking
    ? "bg-info"
    : status === "approval" || status === "input" || status === "request" || status === "limited"
      ? "bg-warning"
      : status === "failed"
        ? "bg-error"
        : thread.latestRun?.status === "completed"
          ? "bg-success/80"
          : "bg-muted-foreground/45";

  const hasChildren = props.childSummary.totalCount > 0;
  const childrenLabel = gt(
    "{count, plural, one {{count} nested thread} other {{count} nested threads}}",
    { count: props.childSummary.totalCount },
  );
  const cappedDepth = Math.min(props.depth, 5);
  // The first guide runs under the parent's chevron.
  const guideBasePx = props.inFolder ? 24 : 10;
  const indentPx = guideBasePx + 2 + (cappedDepth - 1) * 14;
  const { revealRef } = props;
  const rowRef = (row: HTMLElement | null) =>
    row === null ? undefined : revealRef?.(row, threadKey);

  const handleKeyDown = (event: ReactKeyboardEvent) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    props.onThreadActivate(threadRef);
  };

  const handleToggleClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    props.onToggleExpand(threadKey, props.isExpanded);
  };

  const worktreePath = thread.worktreePath?.trim();
  const guideLevels = Array.from({ length: cappedDepth }, (_, index) => index);

  const dragDestination =
    isDragging && props.dropVerb ? (
      <span
        role="status"
        className="pointer-events-none ml-auto inline-flex h-5 shrink-0 items-center gap-1 rounded-sm border border-primary/40 bg-primary/10 px-1.5 text-2xs font-medium text-primary"
      >
        {dropVerbBadge[props.dropVerb]}
      </span>
    ) : null;

  return (
    <li
      ref={setDragRef}
      {...drag.listeners}
      data-subagent-tree-item={threadKey}
      data-subagent-depth={props.depth}
      data-subagent-peek={props.peek || undefined}
      style={
        isDragging && drag.transform
          ? { transform: CSS.Translate.toString(drag.transform) }
          : undefined
      }
      className={cn(
        "relative list-none [content-visibility:auto] [contain-intrinsic-size:auto_--spacing(7.5)]",
        isDragging && "z-20",
        props.isAncestorDragging && !isDragging && "pointer-events-none opacity-35",
      )}
    >
      {isNestOver && (
        <span className="pointer-events-none absolute right-2 top-1/2 z-20 -translate-y-1/2 rounded-sm bg-primary px-1.5 py-0.5 text-2xs font-medium text-primary-foreground shadow-xs">
          {gt("Nest here")}
        </span>
      )}
      {!isDragging &&
        guideLevels.map((level) => (
          <span
            key={level}
            aria-hidden
            style={{ left: `${guideBasePx + level * 14}px` }}
            className="pointer-events-none absolute inset-y-0 w-px bg-sidebar-border/65"
          />
        ))}
      <Tooltip disabled={isDragging}>
        <TooltipTrigger
          render={
            <div
              ref={rowRef}
              role="button"
              tabIndex={0}
              data-sidebar-row={threadKey}
              data-sidebar-parent={props.parentKey}
              data-testid="sidebar-subagent-row"
              aria-current={props.isActive ? "page" : undefined}
              style={{ paddingLeft: `${indentPx}px` }}
              className={cn(
                "group/subagent-row relative flex h-7.5 w-full cursor-pointer items-center gap-1.5 rounded-md pr-2 text-left text-xs outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                isNestOver && "ring-1 ring-inset ring-primary/70 bg-primary/10",
                isDragging
                  ? props.draggingOverNest
                    ? "bg-sidebar-row-active/90 text-sidebar-foreground opacity-80 shadow-md ring-1 ring-inset ring-sidebar-border/70"
                    : "bg-sidebar-row-active text-sidebar-foreground shadow-md ring-1 ring-inset ring-sidebar-border/70"
                  : props.isActive
                    ? "bg-sidebar-row-active text-sidebar-foreground light:ring-1 light:ring-inset light:ring-sidebar-border/70"
                    : "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
              )}
              onClick={(event) => props.onThreadClick(event, threadRef)}
              onKeyDown={handleKeyDown}
              onContextMenu={(event) => {
                event.preventDefault();
                props.onContextMenu(
                  threadRef,
                  { x: event.clientX, y: event.clientY },
                  contextMenuSourceOf(event),
                );
              }}
            />
          }
        >
          {hasChildren ? (
            <button
              type="button"
              data-sidebar-tree-toggle
              data-testid="sidebar-subagent-tree-toggle"
              aria-expanded={props.isExpanded}
              aria-label={
                props.isExpanded
                  ? gt("Collapse {label}", { label: childrenLabel })
                  : gt("Expand {label}", { label: childrenLabel })
              }
              onPointerDown={(event) => event.stopPropagation()}
              onClick={handleToggleClick}
              className="-ml-1 inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-sidebar-muted-foreground hover:bg-sidebar-control-surface hover:text-sidebar-foreground"
            >
              <ChevronRightIcon
                aria-hidden
                className={cn("size-3 transition-transform", props.isExpanded && "rotate-90")}
              />
            </button>
          ) : (
            <span aria-hidden className="h-px w-2 shrink-0 bg-sidebar-border/70" />
          )}
          <span className="relative inline-flex size-3.5 shrink-0 items-center justify-center">
            {providerEntry ? (
              <ProviderInstanceIcon
                driverKind={providerEntry.driverKind}
                displayName={providerEntry.displayName}
                accentColor={providerEntry.accentColor}
                acpRegistryAgentId={providerEntry.acpRegistryAgentId}
                acpRegistryIconUrl={providerEntry.acpRegistryIconUrl}
                showBadge={false}
                size="compact"
                iconClassName="size-3.5 opacity-75"
              />
            ) : isSideChat ? (
              <MessagesSquareIcon aria-hidden className="size-3.5 text-muted-foreground" />
            ) : (
              <BotIcon aria-hidden className="size-3.5 text-muted-foreground" />
            )}
            <span
              aria-hidden
              className={cn(
                "absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full ring-1 ring-sidebar",
                statusDotClass,
              )}
            />
          </span>
          <span
            dir={textDirection(thread.title)}
            className={cn(
              "min-w-0 flex-1 truncate",
              props.isActive ? "font-medium text-sidebar-foreground" : "font-normal",
            )}
          >
            {thread.title}
          </span>
          {hasChildren && !props.isExpanded ? (
            <SidebarSubtreeCounts summary={props.childSummary} />
          ) : null}
          {dragDestination ?? (
            <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-2xs text-secondary-label tabular-nums">
              {isWorking ? (
                <span className="inline-flex items-center gap-1 font-medium text-info-foreground">
                  <CircleDashedIcon aria-hidden className="size-3 shrink-0" />
                  <SubagentWorkingDuration
                    environmentId={thread.environmentId}
                    startedAt={resolveWorkingStartedAt(thread)}
                  />
                </span>
              ) : status === "approval" ? (
                <ShieldQuestionIcon aria-hidden className="size-3 text-warning-foreground" />
              ) : status === "input" ? (
                <MessageCircleQuestionIcon aria-hidden className="size-3 text-warning-foreground" />
              ) : status === "failed" ? (
                <CircleAlertIcon aria-hidden className="size-3 text-error-foreground" />
              ) : thread.latestRun?.status === "completed" ? (
                <>
                  <CircleCheckIcon aria-hidden className="size-3 text-success-foreground/75" />
                  <SubagentRelativeTime timestamp={resolveThreadActivityTimestamp(thread)} />
                </>
              ) : (
                <SubagentRelativeTime timestamp={resolveThreadActivityTimestamp(thread)} />
              )}
            </span>
          )}
        </TooltipTrigger>
        <ThreadHoverCardPopup side="right" align="start" sideOffset={4}>
          <ThreadHoverCard title={thread.title}>
            {providerEntry ? (
              <div className="flex min-w-0 items-center gap-2">
                <ProviderInstanceIcon
                  driverKind={providerEntry.driverKind}
                  displayName={providerEntry.displayName}
                  accentColor={providerEntry.accentColor}
                  acpRegistryAgentId={providerEntry.acpRegistryAgentId}
                  acpRegistryIconUrl={providerEntry.acpRegistryIconUrl}
                  showBadge={showInstanceBadge && providerEntry.accentColor !== undefined}
                  badgeContent="none"
                  badgeClassName="h-2 min-w-2 px-0"
                  iconClassName="size-3 shrink-0 opacity-60"
                />
                <div className="min-w-0 truncate text-foreground/75">
                  {showInstanceBadge ? `${modelLabel} · ${providerEntry.displayName}` : modelLabel}
                </div>
              </div>
            ) : null}
            {thread.branch ? (
              <div className="flex min-w-0 items-center gap-2">
                <GitBranchIcon className="size-3 shrink-0 stroke-muted-foreground" />
                <MiddleTruncate value={thread.branch} className="flex" />
              </div>
            ) : null}
            {worktreePath ? (
              <div className="flex min-w-0 items-center gap-2">
                <FolderGit2Icon className="size-3 shrink-0 stroke-muted-foreground" />
                <MiddleTruncate
                  value={formatWorktreePathForDisplay(worktreePath)}
                  className="flex"
                />
              </div>
            ) : null}
            {thread.runtime?.lastError ? (
              <div className="flex min-w-0 items-center gap-2 text-error">
                <CircleAlertIcon className="size-3 shrink-0 stroke-current" />
                <div className="min-w-0 truncate">{thread.runtime.lastError}</div>
              </div>
            ) : null}
          </ThreadHoverCard>
        </ThreadHoverCardPopup>
      </Tooltip>
    </li>
  );
});
