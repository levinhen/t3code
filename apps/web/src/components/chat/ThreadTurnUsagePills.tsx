import type { OrchestrationV2ProviderTurn } from "@t3tools/contracts";
import { summarizeTurnUsage } from "@t3tools/client-runtime/state/turn-usage";
import { formatDuration } from "@t3tools/shared/orchestrationTimingCopy";
import { formatCount, formatPercent, formatTokens } from "@t3tools/shared/usageFormat";
import { useGT, useLocale, useMessages } from "gt-react";
import { memo, type ReactNode } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export type UsageTurn = Pick<
  OrchestrationV2ProviderTurn,
  "providerThreadId" | "startedAt" | "completedAt" | "turnTokenUsage"
>;

function UsagePill({ children, tooltip }: { children: ReactNode; tooltip: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex h-5 shrink-0 items-center rounded-full border border-border px-2 text-xs whitespace-nowrap tabular-nums text-muted-foreground" />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{tooltip}</TooltipPopup>
    </Tooltip>
  );
}

/** Usage of the thread's last finished turn, shown beside its title. */
export const ThreadTurnUsagePills = memo(function ThreadTurnUsagePills({
  turn,
}: {
  turn: UsageTurn;
}) {
  const gt = useGT();
  const m = useMessages();
  const locale = useLocale();
  const usage = summarizeTurnUsage(turn);
  if (usage === null) return null;
  const duration = usage.durationMs === null ? null : formatDuration(usage.durationMs, m);
  return (
    // Electron's titlebar drag region swallows hover, so the pills opt out to show their tooltips.
    <div
      role="group"
      aria-label={gt("Last turn usage")}
      className="hidden shrink-0 items-center gap-1 [-webkit-app-region:no-drag] md:flex"
    >
      {usage.cacheHitRate === null ? null : (
        <UsagePill
          tooltip={gt("Last turn read {cached} of its {input} input tokens from cache.", {
            cached: formatTokens(usage.cachedInputTokens),
            input: formatTokens(usage.inputTokens),
          })}
        >
          {gt("Cache {rate}", { rate: formatPercent(usage.cacheHitRate, 0) })}
        </UsagePill>
      )}
      <UsagePill
        tooltip={gt("Last turn used {input} input and {output} output tokens.", {
          input: formatTokens(usage.inputTokens),
          output: formatTokens(usage.outputTokens),
        })}
      >
        {gt("Turn {tokens}", { tokens: formatTokens(usage.totalTokens) })}
      </UsagePill>
      {usage.outputTokensPerSecond === null || duration === null ? null : (
        <UsagePill
          tooltip={gt(
            "Output tokens per second across the last turn's {duration}, including tool calls and waits.",
            { duration },
          )}
        >
          {gt("{speed} tok/s", { speed: formatCount(usage.outputTokensPerSecond, locale) })}
        </UsagePill>
      )}
    </div>
  );
});
