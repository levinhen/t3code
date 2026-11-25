import { ProviderThreadId, type TurnTokenUsage } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { latestUsageTurn, summarizeTurnUsage } from "./turnUsage.ts";

const active = ProviderThreadId.make("provider-thread:active");
const previous = ProviderThreadId.make("provider-thread:previous");

function turn(input: {
  readonly providerThreadId?: ProviderThreadId;
  readonly startedAt?: string | null;
  readonly completedAt?: string | null;
  readonly usage?: TurnTokenUsage;
}) {
  return {
    providerThreadId: input.providerThreadId ?? active,
    startedAt:
      input.startedAt === null
        ? null
        : DateTime.makeUnsafe(input.startedAt ?? "2026-11-24T10:00:00Z"),
    completedAt:
      input.completedAt === null
        ? null
        : DateTime.makeUnsafe(input.completedAt ?? "2026-11-24T10:00:20Z"),
    turnTokenUsage: input.usage ?? complete({ inputTokens: 1_000, outputTokens: 400 }),
  };
}

function complete(input: {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens?: number;
}): TurnTokenUsage {
  return {
    usageScope: "main_agent",
    usageStatus: "complete",
    hasSubagents: false,
    ...input,
  };
}

describe("summarizeTurnUsage", () => {
  it("reads cache hit against input that includes cache reads, and speed over wall time", () => {
    expect(
      summarizeTurnUsage(
        turn({
          usage: complete({ inputTokens: 1_000, cachedInputTokens: 900, outputTokens: 400 }),
        }),
      ),
    ).toEqual({
      inputTokens: 1_000,
      cachedInputTokens: 900,
      outputTokens: 400,
      totalTokens: 1_400,
      cacheHitRate: 0.9,
      durationMs: 20_000,
      outputTokensPerSecond: 20,
    });
  });

  it("leaves speed out when the turn is too short to time", () => {
    const summary = summarizeTurnUsage(turn({ completedAt: "2026-11-24T10:00:00.500Z" }));
    expect(summary?.durationMs).toBe(500);
    expect(summary?.outputTokensPerSecond).toBeNull();
  });

  it("ignores partial usage and local commands", () => {
    expect(
      summarizeTurnUsage(
        turn({ usage: { usageScope: "main_agent", usageStatus: "partial", hasSubagents: false } }),
      ),
    ).toBeNull();
    expect(
      summarizeTurnUsage(
        turn({ usage: { ...complete({ inputTokens: 10, outputTokens: 1 }), localCommand: true } }),
      ),
    ).toBeNull();
  });
});

describe("latestUsageTurn", () => {
  it("picks the newest completed turn on the active provider thread", () => {
    const older = turn({ completedAt: "2026-11-24T10:00:20Z" });
    const newer = turn({ completedAt: "2026-11-24T10:05:00Z" });
    const otherProvider = turn({ providerThreadId: previous, completedAt: "2026-11-24T10:09:00Z" });
    const running = turn({ completedAt: null });
    expect(latestUsageTurn([newer, older, otherProvider, running], active)).toBe(newer);
    expect(latestUsageTurn([newer, older, otherProvider], null)).toBe(otherProvider);
  });

  it("returns null when no turn reported complete usage", () => {
    expect(
      latestUsageTurn(
        [
          turn({
            usage: { usageScope: "main_agent", usageStatus: "unavailable", hasSubagents: false },
          }),
        ],
        active,
      ),
    ).toBeNull();
  });
});
