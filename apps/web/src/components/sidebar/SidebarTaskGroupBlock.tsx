import { useDroppable } from "@dnd-kit/core";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { ContextMenuSource } from "@t3tools/contracts";
import {
  ChevronDownIcon,
  EllipsisIcon,
  FolderIcon,
  LayersIcon,
  PinIcon,
  SquarePenIcon,
  Undo2Icon,
} from "lucide-react";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import {
  memo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

import { cn } from "~/lib/utils";
import { contextMenuSourceOf } from "../../contextMenuSource";
import type { EnvironmentTaskGroupShell } from "../../state/taskGroups";
import { taskGroupColorClasses } from "../../taskGroupColors";
import { useUiStateStore } from "../../uiStateStore";
import { resolveSidebarFolderDot, resolveThreadLastVisitedAt } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SortableSidebarMarker } from "./SidebarListMarkers";
import { sidebarTaskGroupDropId, sidebarTaskGroupRowId } from "./taskGroups.logic";

const GROUP_DOT_CLASS_NAME = {
  attention: "bg-warning",
  failed: "bg-error",
  unread: "bg-success",
  working: "bg-info",
} as const;

const GROUP_DOT_LABEL = {
  attention: msg(", needs you", { $context: "project folder status, read after its name" }),
  failed: msg(", failed", { $context: "project folder status, read after its name" }),
  unread: msg(", done", { $context: "project folder status, read after its name" }),
  working: msg(", working", { $context: "project folder status, read after its name" }),
} as const;

type GroupMenuHandler = (
  group: EnvironmentTaskGroupShell,
  position: { x: number; y: number },
  source: ContextMenuSource,
) => void;

/** One sortable row holding every task group, so the list's drag projection measures them as one. */
export function SidebarTaskGroupRegion(props: { readonly children: ReactNode }) {
  return (
    <SortableSidebarMarker
      marker="task-groups"
      data-testid="sidebar-task-groups"
      className="relative mx-0.5 mb-1"
    >
      <ul role="presentation" className="flex flex-col gap-1.5">
        {props.children}
      </ul>
    </SortableSidebarMarker>
  );
}

/**
 * A task group reads like a Chrome tab group: a tinted title chip, then its threads on a
 * rail of the same colour. A closed group keeps the open thread and a status dot showing.
 */
export const SidebarTaskGroupBlock = memo(function SidebarTaskGroupBlock(props: {
  readonly groupKey: string;
  readonly group: EnvironmentTaskGroupShell;
  readonly collapsed: boolean;
  readonly memberCount: number;
  /** Members a closed group hides; its dot speaks for them. */
  readonly hiddenThreads: readonly EnvironmentThreadShell[];
  readonly canOperate: boolean;
  readonly canStartThread: boolean;
  /** A dragged thread from outside the group is over it. */
  readonly isDropTarget: boolean;
  readonly isRenaming: boolean;
  readonly settledCount: number;
  readonly settledExpanded: boolean;
  readonly memberRows: readonly ReactNode[];
  /** Every settled member while the fold is open; otherwise only the open thread, if settled. */
  readonly settledRows: readonly ReactNode[];
  readonly onToggle: (groupKey: string, collapsed: boolean) => void;
  readonly onToggleSettled: (groupKey: string, expanded: boolean) => void;
  readonly onNewThread: (group: EnvironmentTaskGroupShell) => void;
  readonly onStartRename: (groupKey: string) => void;
  readonly onCommitRename: (group: EnvironmentTaskGroupShell, title: string) => void;
  readonly onCancelRename: () => void;
  readonly onContextMenu: GroupMenuHandler;
}) {
  const gt = useGT();
  const m = useMessages();
  const { group, groupKey, collapsed } = props;
  const colors = taskGroupColorClasses(group.color);
  const rowId = sidebarTaskGroupRowId(groupKey);
  const { setNodeRef } = useDroppable({
    id: sidebarTaskGroupDropId(groupKey),
    disabled: !props.canOperate,
  });
  const localLastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const dot =
    collapsed && props.hiddenThreads.length > 0
      ? resolveSidebarFolderDot(
          props.hiddenThreads.map((thread) => ({
            ...thread,
            lastVisitedAt: resolveThreadLastVisitedAt(
              thread.lastVisitedAt,
              localLastVisitedAtById[
                scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))
              ],
            ),
          })),
        )
      : null;
  const { isDropTarget } = props;
  const hasMembers = props.memberRows.length > 0;
  const openContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    props.onContextMenu(group, { x: event.clientX, y: event.clientY }, contextMenuSourceOf(event));
  };
  return (
    <li
      ref={setNodeRef}
      data-testid="sidebar-task-group"
      data-task-group={groupKey}
      className={cn(
        "group/task-group relative list-none rounded-lg transition-colors motion-reduce:transition-none",
        isDropTarget && "bg-primary/6 ring-1 ring-inset ring-primary/45",
      )}
    >
      <div className="relative">
        {props.isRenaming ? (
          <div className="flex h-8 items-center gap-1.5 px-1.5">
            <LayersIcon aria-hidden className="size-3.5 shrink-0 text-sidebar-muted-foreground" />
            <TaskGroupRenameInput
              title={group.title}
              onCommit={(title) => props.onCommitRename(group, title)}
              onCancel={props.onCancelRename}
            />
          </div>
        ) : (
          <button
            type="button"
            data-sidebar-row={rowId}
            data-testid="sidebar-task-group-header"
            aria-expanded={!collapsed}
            onClick={() => props.onToggle(groupKey, collapsed)}
            onDoubleClick={(event) => {
              if (!props.canOperate) return;
              event.preventDefault();
              props.onStartRename(groupKey);
            }}
            onContextMenu={openContextMenu}
            className="flex h-8 w-full cursor-pointer items-center gap-1.5 rounded-md ps-1 pe-2 text-left outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <ChevronDownIcon
              aria-hidden
              className={cn(
                "size-3.5 shrink-0 text-sidebar-muted-foreground transition-transform motion-reduce:transition-none",
                collapsed && "-rotate-90",
              )}
            />
            <span
              className={cn(
                "inline-flex h-5.5 min-w-0 items-center rounded-md px-2 text-xs font-semibold",
                colors.chip,
              )}
            >
              <span dir="auto" className="truncate">
                {group.title}
              </span>
            </span>
            {group.pinnedAt !== null ? (
              <PinIcon aria-hidden className="size-3 shrink-0 text-sidebar-muted-foreground" />
            ) : null}
            {group.pinnedAt !== null ? (
              <span className="sr-only">{gt("Pinned", { $context: "sidebar section" })}</span>
            ) : null}
            {dot ? (
              <span className={cn("size-1.5 shrink-0 rounded-full", GROUP_DOT_CLASS_NAME[dot])}>
                <span className="sr-only">{m(GROUP_DOT_LABEL[dot])}</span>
              </span>
            ) : null}
            <span className="ms-auto shrink-0 text-xs tabular-nums text-sidebar-muted-foreground group-hover/task-group:invisible group-has-[[data-sidebar-action-for]:focus]/task-group:invisible pointer-coarse:invisible">
              {isDropTarget ? (
                <span className="font-medium text-primary">
                  <T>Add here</T>
                </span>
              ) : (
                props.memberCount
              )}
            </span>
          </button>
        )}
        {props.isRenaming ? null : (
          <span className="absolute inset-y-0 right-1 flex items-center gap-0.5 opacity-0 focus-within:opacity-100 group-hover/task-group:opacity-100 pointer-coarse:opacity-100">
            {props.canStartThread ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      data-sidebar-action-for={rowId}
                      size="icon-xs"
                      variant="ghost-muted"
                      aria-label={gt("New thread in {group}", { group: group.title })}
                      onClick={() => props.onNewThread(group)}
                    />
                  }
                >
                  <SquarePenIcon aria-hidden />
                </TooltipTrigger>
                <TooltipPopup>
                  <T>
                    New thread in <Var>{group.title}</Var>
                  </T>
                </TooltipPopup>
              </Tooltip>
            ) : null}
            <Button
              data-sidebar-action-for={rowId}
              size="icon-xs"
              variant="ghost-muted"
              aria-label={gt("Task group actions")}
              onClick={openContextMenu}
            >
              <EllipsisIcon aria-hidden />
            </Button>
          </span>
        )}
      </div>
      {!collapsed || hasMembers ? (
        <div className="relative ms-3 ps-2">
          <span
            aria-hidden
            className={cn("absolute inset-y-1 left-0 w-0.5 rounded-full opacity-70", colors.accent)}
          />
          {hasMembers ? (
            <ul role="presentation" className="flex flex-col gap-px">
              {props.memberRows}
            </ul>
          ) : collapsed ? null : (
            <div className="flex h-9 items-center rounded-md border border-dashed border-sidebar-foreground/20 px-2.5 text-xs text-sidebar-muted-foreground">
              <T>Drag threads here</T>
            </div>
          )}
          {!collapsed && props.settledCount > 0 ? (
            <div className="mt-px">
              <CollapsibleSectionHeader
                data-sidebar-row={`${rowId}:settled`}
                data-sidebar-parent={rowId}
                onClick={() => props.onToggleSettled(groupKey, props.settledExpanded)}
                expanded={props.settledExpanded}
                tone="muted"
                accessory={<span className="font-normal tabular-nums">{props.settledCount}</span>}
              >
                {gt("Settled", { $context: "sidebar section" })}
              </CollapsibleSectionHeader>
              {props.settledRows.length > 0 ? (
                <ul role="presentation" className="flex flex-col gap-px">
                  {props.settledRows}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
});

/** A working folder inside a task group, shown when the Labs setting splits groups by folder. */
export function SidebarTaskGroupFolderHeader(props: {
  readonly label: string;
  readonly count: number;
  readonly navigationParent: string;
  readonly onNewThread: (() => void) | null;
}) {
  const gt = useGT();
  return (
    <li className="group/task-folder relative list-none">
      <div className="flex h-7 items-center gap-1.5 px-2 text-xs text-sidebar-muted-foreground">
        <FolderIcon aria-hidden className="size-3.5 shrink-0" />
        <span dir="auto" className="min-w-0 flex-1 truncate font-medium">
          {props.label}
        </span>
        <span className="shrink-0 tabular-nums group-hover/task-folder:invisible">
          {props.count}
        </span>
      </div>
      {props.onNewThread ? (
        <span className="absolute inset-y-0 right-1 flex items-center opacity-0 focus-within:opacity-100 group-hover/task-folder:opacity-100 pointer-coarse:opacity-100">
          <Button
            size="icon-xs"
            variant="ghost-muted"
            data-sidebar-parent={props.navigationParent}
            aria-label={gt("New thread in {project}", { project: props.label })}
            onClick={props.onNewThread}
          >
            <SquarePenIcon aria-hidden />
          </Button>
        </span>
      ) : null}
    </li>
  );
}

/** Completed groups fold under the live ones; each can come back or be dissolved. */
export function SidebarArchivedTaskGroups(props: {
  readonly groups: readonly { readonly key: string; readonly group: EnvironmentTaskGroupShell }[];
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly onRestore: (group: EnvironmentTaskGroupShell) => void;
  readonly onContextMenu: GroupMenuHandler;
}) {
  const gt = useGT();
  if (props.groups.length === 0) return null;
  return (
    <li className="list-none">
      <CollapsibleSectionHeader
        data-sidebar-row="task-groups:archived"
        data-testid="sidebar-archived-task-groups-toggle"
        onClick={props.onToggle}
        expanded={props.expanded}
        tone="muted"
        accessory={<span className="font-normal tabular-nums">{props.groups.length}</span>}
      >
        {gt("Completed tasks")}
      </CollapsibleSectionHeader>
      {props.expanded ? (
        <ul role="presentation" className="flex flex-col gap-px">
          {props.groups.map(({ key, group }) => (
            <li key={key} className="group/archived-group relative list-none">
              <div
                role="button"
                tabIndex={-1}
                data-sidebar-row={sidebarTaskGroupRowId(key)}
                data-sidebar-parent="task-groups:archived"
                onContextMenu={(event) => {
                  event.preventDefault();
                  props.onContextMenu(
                    group,
                    { x: event.clientX, y: event.clientY },
                    contextMenuSourceOf(event),
                  );
                }}
                className="flex h-8 items-center gap-2 rounded-md ps-2.5 pe-9 text-sm text-sidebar-muted-foreground outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span
                  aria-hidden
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    taskGroupColorClasses(group.color).accent,
                  )}
                />
                <span dir="auto" className="min-w-0 flex-1 truncate">
                  {group.title}
                </span>
              </div>
              <span className="absolute inset-y-0 right-1 flex items-center opacity-0 focus-within:opacity-100 group-hover/archived-group:opacity-100 pointer-coarse:opacity-100">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        size="icon-xs"
                        variant="ghost-muted"
                        aria-label={gt("Restore task group")}
                        onClick={() => props.onRestore(group)}
                      />
                    }
                  >
                    <Undo2Icon aria-hidden />
                  </TooltipTrigger>
                  <TooltipPopup>
                    <T>Restore task group</T>
                  </TooltipPopup>
                </Tooltip>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function TaskGroupRenameInput(props: {
  readonly title: string;
  readonly onCommit: (title: string) => void;
  readonly onCancel: () => void;
}) {
  const gt = useGT();
  const [title, setTitle] = useState(props.title);
  // Enter and Escape blur the input as it unmounts; that blur must not commit again.
  const settledRef = useRef(false);
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") {
      event.preventDefault();
      settledRef.current = true;
      props.onCommit(title);
    } else if (event.key === "Escape") {
      event.preventDefault();
      settledRef.current = true;
      props.onCancel();
    }
  };
  return (
    <input
      autoFocus
      value={title}
      dir="auto"
      aria-label={gt("Task group name")}
      onChange={(event) => setTitle(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={handleKeyDown}
      onBlur={() => {
        if (!settledRef.current) props.onCommit(title);
      }}
      className="min-w-0 flex-1 rounded-sm bg-card px-1 text-xs font-semibold text-card-foreground outline-none ring-1 ring-inset ring-input focus:ring-foreground"
    />
  );
}
