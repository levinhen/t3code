import { CornerDownRightIcon, LayersIcon } from "lucide-react";
import { useGT } from "gt-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

/**
 * Covers the row a dragged thread hovers. The pointer's half picks the outcome: the left
 * half groups the two threads into a task group, the right half nests the dragged thread
 * under this one.
 */
export function SidebarRowDropCard(props: {
  readonly target: "join" | "nest";
  /** The task group the left half adds to, or a new one; null when the threads cannot group. */
  readonly joinLabel: string | null;
  readonly canNest: boolean;
}) {
  const gt = useGT();
  return (
    <div
      role="status"
      data-testid="sidebar-row-drop-card"
      data-drop-target={props.target}
      // Above the dragged row, which follows the pointer underneath it.
      className="pointer-events-none absolute inset-0.5 z-30 flex overflow-hidden rounded-md border border-primary/45 bg-sidebar shadow-sm"
    >
      <DropCardHalf
        active={props.target === "join"}
        disabled={props.joinLabel === null}
        icon={<LayersIcon aria-hidden className="size-3.5 shrink-0" />}
        title={gt("Task group")}
        detail={props.joinLabel}
      />
      <span aria-hidden className="my-1.5 w-px shrink-0 bg-border" />
      <DropCardHalf
        active={props.target === "nest"}
        disabled={!props.canNest}
        icon={<CornerDownRightIcon aria-hidden className="size-3.5 shrink-0" />}
        title={gt("Sub-thread")}
        detail={gt("Nest under this thread")}
      />
    </div>
  );
}

function DropCardHalf(props: {
  readonly active: boolean;
  readonly disabled: boolean;
  readonly icon: ReactNode;
  readonly title: string;
  readonly detail: string | null;
}) {
  return (
    <span
      className={cn(
        "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-2 text-center",
        props.active ? "bg-primary/12 text-primary" : "text-sidebar-muted-foreground",
        props.disabled && "opacity-40",
      )}
    >
      <span className="flex max-w-full items-center gap-1 text-xs font-medium">
        {props.icon}
        <span className="truncate">{props.title}</span>
      </span>
      {props.detail ? (
        <span
          className={cn(
            "max-w-full truncate text-2xs",
            props.active ? "text-primary/80" : "text-sidebar-muted-foreground/80",
          )}
        >
          {props.detail}
        </span>
      ) : null}
    </span>
  );
}
