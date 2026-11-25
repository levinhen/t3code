import { TurnTokenUsage, type UsageTokenTotals } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

export class TurnUsageHistoryReadError extends Schema.TaggedError<TurnUsageHistoryReadError>()(
  "TurnUsageHistoryReadError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not read the usage of T3 turns.";
  }
}

export interface TurnUsage {
  readonly driver: string;
  readonly model: string;
  readonly completedAtMs: number;
  /** Wall time from start to completion; null when the turn never recorded its start. */
  readonly durationMs: number | null;
  readonly totals: UsageTokenTotals;
}

const decodeTurnTokenUsage = Schema.decodeUnknownOption(Schema.fromJsonString(TurnTokenUsage));

export class TurnUsageHistory extends Context.Service<
  TurnUsageHistory,
  {
    /** Turns completed in `[sinceMs, untilMs)` whose provider reported complete main-agent usage. */
    readonly read: (window: {
      readonly sinceMs: number;
      readonly untilMs: number;
    }) => Effect.Effect<readonly TurnUsage[], TurnUsageHistoryReadError>;
  }
>()("t3/usage/TurnUsageHistory") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const read = Effect.fn("TurnUsageHistory.read")(function* (window: {
    readonly sinceMs: number;
    readonly untilMs: number;
  }) {
    const rows = yield* sql<{
      readonly driver: string | null;
      readonly model: string | null;
      readonly usage_json: string | null;
      readonly started_at: string | null;
      readonly completed_at: string;
    }>`
      SELECT thread.driver AS driver,
        json_extract(turn.payload_json, '$.model') AS model,
        json_extract(turn.payload_json, '$.turnTokenUsage') AS usage_json,
        turn.started_at AS started_at,
        turn.completed_at AS completed_at
      FROM orchestration_v2_projection_provider_turns AS turn
      JOIN orchestration_v2_projection_provider_threads AS thread
        ON thread.provider_thread_id = turn.provider_thread_id
      WHERE turn.completed_at >= ${DateTime.formatIso(DateTime.makeUnsafe(window.sinceMs))}
        AND turn.completed_at < ${DateTime.formatIso(DateTime.makeUnsafe(window.untilMs))}
        AND json_extract(turn.payload_json, '$.turnTokenUsage.usageStatus') = 'complete'
    `.pipe(
      NodeSqliteClient.readOnly,
      Effect.mapError((cause) => new TurnUsageHistoryReadError({ cause })),
    );

    return rows.flatMap((row): TurnUsage[] => {
      const usage = decodeTurnTokenUsage(row.usage_json);
      const completedAt = DateTime.make(row.completed_at);
      if (
        row.driver === null ||
        Option.isNone(usage) ||
        Option.isNone(completedAt) ||
        usage.value.usageStatus !== "complete" ||
        usage.value.localCommand === true
      ) {
        return [];
      }
      const { inputTokens, outputTokens, models } = usage.value;
      // A turn whose models are not one known id cannot be attributed to a model.
      const model = (row.model ?? (models?.length === 1 ? models[0] : undefined))?.trim();
      if (!model || inputTokens + outputTokens === 0) return [];
      const cachedInputTokens = usage.value.cachedInputTokens ?? 0;
      const cacheCreationTokens = usage.value.cacheCreationTokens ?? 0;
      const completedAtMs = DateTime.toEpochMillis(completedAt.value);
      const startedAt = row.started_at === null ? Option.none() : DateTime.make(row.started_at);
      return [
        {
          driver: row.driver,
          model,
          completedAtMs,
          durationMs: Option.isNone(startedAt)
            ? null
            : Math.max(0, completedAtMs - DateTime.toEpochMillis(startedAt.value)),
          totals: {
            // Reported input includes cache reads and writes.
            uncachedInputTokens: Math.max(0, inputTokens - cachedInputTokens - cacheCreationTokens),
            cachedInputTokens,
            cacheCreationTokens,
            outputTokens,
            reasoningTokens: usage.value.reasoningTokens ?? 0,
          },
        },
      ];
    });
  });
  return TurnUsageHistory.of({ read });
});

export const layer = Layer.effect(TurnUsageHistory, make);
