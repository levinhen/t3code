import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  ListTreeIcon,
  ShieldQuestionIcon,
  type LucideIcon,
} from "lucide-react";
import { useGT } from "gt-react";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { SidebarSubtreeSummary } from "./subagentTree";

interface CountPart {
  readonly key: string;
  readonly count: number;
  readonly Icon: LucideIcon;
  readonly className: string;
  readonly label: string;
}

/** A parent's nested threads, then how many need the user, run, failed, and finished. */
export function SidebarSubtreeCounts(props: {
  readonly summary: SidebarSubtreeSummary;
  readonly className?: string;
}) {
  const gt = useGT();
  const { summary } = props;
  const states: ReadonlyArray<CountPart> = [
    {
      key: "attention",
      count: summary.attentionCount,
      Icon: ShieldQuestionIcon,
      className: "text-warning-foreground",
      label: gt("{count} waiting on you", { count: summary.attentionCount }),
    },
    {
      key: "running",
      count: summary.runningCount,
      Icon: CircleDashedIcon,
      className: "text-info-foreground",
      label: gt("{count} running", { count: summary.runningCount }),
    },
    {
      key: "failed",
      count: summary.failedCount,
      Icon: CircleAlertIcon,
      className: "text-error-foreground",
      label: gt("{count} failed", { count: summary.failedCount }),
    },
    {
      key: "done",
      count: summary.doneCount,
      Icon: CircleCheckIcon,
      className: "text-success-foreground/75",
      label: gt("{count} done", { count: summary.doneCount }),
    },
  ];
  const shown = states.filter((part) => part.count > 0);
  const totalLabel = gt(
    "{count, plural, one {{count} nested thread} other {{count} nested threads}}",
    { count: summary.totalCount },
  );
  const label = [totalLabel, ...shown.map((part) => part.label)].join(" · ");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={label}
            data-testid="sidebar-subtree-counts"
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 text-2xs tabular-nums",
              props.className,
            )}
          />
        }
      >
        <span className="inline-flex items-center gap-0.5 text-secondary-label">
          <ListTreeIcon aria-hidden className="size-3 shrink-0" />
          {summary.totalCount}
        </span>
        {shown.length > 0 ? (
          <span aria-hidden className="h-2.5 w-px shrink-0 bg-sidebar-border" />
        ) : null}
        {shown.map(({ key, count, Icon, className }) => (
          <span key={key} className={cn("inline-flex items-center gap-0.5", className)}>
            <Icon aria-hidden className="size-3 shrink-0" />
            {count}
          </span>
        ))}
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}
