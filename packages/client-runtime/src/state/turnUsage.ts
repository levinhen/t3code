import type { OrchestrationV2ProviderTurn } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

type UsageTurn = Pick<
  OrchestrationV2ProviderTurn,
  "providerThreadId" | "startedAt" | "completedAt" | "turnTokenUsage"
>;

export interface TurnUsageSummary {
  /** Includes cache reads and writes. */
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly cacheHitRate: number | null;
  readonly durationMs: number | null;
  readonly outputTokensPerSecond: number | null;
}

// Shorter turns give a speed dominated by clock rounding.
const MIN_SPEED_DURATION_MS = 1_000;

/**
 * The newest completed turn on the active provider thread whose provider reported complete
 * main-agent usage. Returns the turn itself so callers can memoize on its identity.
 */
export function latestUsageTurn<Turn extends UsageTurn>(
  turns: ReadonlyArray<Turn>,
  activeProviderThreadId: OrchestrationV2ProviderTurn["providerThreadId"] | null,
): Turn | null {
  let latest: Turn | null = null;
  let latestAtMs = Number.NEGATIVE_INFINITY;
  for (const turn of turns) {
    if (summarizeTurnUsage(turn) === null || turn.completedAt === null) continue;
    if (activeProviderThreadId !== null && turn.providerThreadId !== activeProviderThreadId) {
      continue;
    }
    const atMs = DateTime.toEpochMillis(turn.completedAt);
    if (atMs >= latestAtMs) {
      latest = turn;
      latestAtMs = atMs;
    }
  }
  return latest;
}

/** Speed divides output by the turn's wall time, which includes tool calls and waits. */
export function summarizeTurnUsage(turn: UsageTurn): TurnUsageSummary | null {
  const usage = turn.turnTokenUsage;
  if (usage?.usageStatus !== "complete" || usage.localCommand === true) return null;
  const { inputTokens, outputTokens } = usage;
  const totalTokens = inputTokens + outputTokens;
  if (totalTokens === 0) return null;
  const cachedInputTokens = usage.cachedInputTokens ?? 0;
  const durationMs =
    turn.startedAt === null || turn.completedAt === null
      ? null
      : Math.max(
          0,
          DateTime.toEpochMillis(turn.completedAt) - DateTime.toEpochMillis(turn.startedAt),
        );
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    totalTokens,
    cacheHitRate: inputTokens === 0 ? null : cachedInputTokens / inputTokens,
    durationMs,
    outputTokensPerSecond:
      durationMs === null || durationMs < MIN_SPEED_DURATION_MS
        ? null
        : outputTokens / (durationMs / 1_000),
  };
}
