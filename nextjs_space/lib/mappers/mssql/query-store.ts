/**
 * MSSQL `queryStore` mapper.
 *
 * Source: `sys.query_store_query` JOIN `sys.query_store_plan` JOIN
 *         `sys.query_store_runtime_stats` JOIN `sys.query_store_query_text`
 *         in the configured user database.
 *
 * Produces:
 *   1. One canonical `ParsedLogEntry` per runtime-stats row, source =
 *      `MSSQL.QueryStore`, logLevel = `info`.
 *   2. Synthetic plan-regression events tagged
 *      `MSSQL.QueryStore.PlanRegression` (logLevel = `warning`) emitted by
 *      the in-line `detectPlanRegressions` call. Baselines persist inside
 *      the cursor so we don't need a new schema column.
 *
 * Cursor shape:
 *   {
 *     lastIntervalEndTime: ISO string — the highest `last_execution_time`
 *                          seen so far,
 *     baselines:           { [query_id]: PlanBaseline }
 *   }
 *
 * Connector contract:
 *   The connector pulls `WHERE rs.last_execution_time > @lastIntervalEndTime
 *   ORDER BY rs.last_execution_time ASC` and feeds the rows here. The
 *   mapper is pure — no IO, no Prisma access.
 */

import type { ParsedLogEntry } from "../../log-parser";
import type { FeedMapper, MapResult, MapOptions } from "../types";
import {
  detectPlanRegressions,
  type PlanBaseline,
  type PlanRegressionInput,
} from "../../detectors/plan-regression";
import { redactSqlLiterals } from "./redact";

export interface QueryStoreRawRow {
  query_id: number;
  plan_id: number | null;
  query_hash: string | null;        // varbinary(8) rendered as 0x... by mssql driver
  query_plan_hash: string | null;   // varbinary(8) rendered as 0x... by mssql driver
  execution_count: number;
  avg_duration_us: number;          // micro-seconds (Query Store native)
  avg_cpu_time_us: number;
  avg_logical_io_reads: number;
  avg_physical_io_reads: number;
  last_execution_time: Date | string;
  query_sql_text: string | null;
  database_name: string | null;
  server: string | null;
}

export interface QueryStoreCursor {
  /** ISO string — the high watermark of `last_execution_time` consumed. */
  lastIntervalEndTime: string | null;
  /** Per-query plan-regression baselines, keyed by query_id. */
  baselines?: Record<string, PlanBaseline>;
}

export const PARSED_SOURCE = "MSSQL.QueryStore";
export const PARSED_SOURCE_PLAN_REGRESSION = "MSSQL.QueryStore.PlanRegression";

const QUERY_TEXT_MAX = 200;

export const queryStoreMapper: FeedMapper<QueryStoreRawRow, QueryStoreCursor> = {
  feed: "queryStore",
  parsedSource: PARSED_SOURCE,
  isCumulative: false,
  map(rows, previousCursor, opts) {
    const baselines: Record<string, PlanBaseline> = {
      ...(previousCursor?.baselines ?? {}),
    };
    let highWatermark: Date | null =
      previousCursor?.lastIntervalEndTime
        ? coerceDate(previousCursor.lastIntervalEndTime)
        : null;

    const entries: ParsedLogEntry[] = [];
    /**
     * For plan-regression detection we want one observation per query per
     * batch (the most recent). Map by query_id, replacing earlier rows.
     */
    const dedup = new Map<string, PlanRegressionInput>();
    let skipped = 0;

    for (const row of rows) {
      try {
        const ts = coerceDate(row.last_execution_time) ?? new Date();
        if (!highWatermark || ts > highWatermark) highWatermark = ts;

        const entry = mapRuntimeStatsRow(row, ts, opts);
        if (entry) entries.push(entry);

        const planHash = normaliseHash(row.query_plan_hash);
        const avgMs = microToMs(row.avg_duration_us);
        if (typeof row.query_id === "number" && planHash && Number.isFinite(avgMs)) {
          dedup.set(String(row.query_id), {
            queryId: row.query_id,
            planHash,
            avgDurationMs: avgMs,
            executionCount: row.execution_count,
            observedAt: ts,
            queryTextSnippet: snippetFromText(row.query_sql_text, opts),
          });
        }
      } catch {
        skipped++;
      }
    }

    const detection = detectPlanRegressions(
      Array.from(dedup.values()),
      baselines,
      opts?.now,
    );

    const cursor: QueryStoreCursor = {
      lastIntervalEndTime: highWatermark ? highWatermark.toISOString() : (previousCursor?.lastIntervalEndTime ?? null),
      baselines: detection.updatedBaselines,
    };

    const result: MapResult<QueryStoreCursor> = {
      entries,
      syntheticEvents: detection.syntheticEvents,
      nextCursor: cursor,
    };
    const noteParts: string[] = [];
    if (skipped > 0) noteParts.push(`${skipped} row(s) skipped`);
    if (detection.regressionsFound > 0)
      noteParts.push(`${detection.regressionsFound} plan regression(s) detected`);
    if (noteParts.length > 0) result.note = noteParts.join("; ");
    return result;
  },
};

// ---------------------------------------------------------------------------
// Per-row mapping
// ---------------------------------------------------------------------------

function mapRuntimeStatsRow(
  row: QueryStoreRawRow,
  ts: Date,
  opts: MapOptions | undefined,
): ParsedLogEntry | null {
  if (typeof row.query_id !== "number") return null;

  const durationMs = microToMs(row.avg_duration_us);
  const cpuMs = microToMs(row.avg_cpu_time_us);
  const snippet = snippetFromText(row.query_sql_text, opts);
  const planHash = normaliseHash(row.query_plan_hash) ?? "unknown";

  const messageParts = [
    `Query Store query_id=${row.query_id}`,
    `avg ${durationMs.toFixed(0)}ms`,
    `cpu ${cpuMs.toFixed(0)}ms`,
    `exec_count ${row.execution_count}`,
    `plan_hash ${truncateHash(planHash)}`,
  ];
  if (snippet) messageParts.push(`— ${snippet}`);

  const entry: ParsedLogEntry = {
    timestamp: ts,
    logLevel: "info",
    source: PARSED_SOURCE,
    message: messageParts.join(" "),
    rawData: JSON.stringify({
      query_id: row.query_id,
      plan_id: row.plan_id ?? null,
      query_hash: row.query_hash ?? null,
      query_plan_hash: planHash,
      execution_count: row.execution_count,
      avg_duration_ms: durationMs,
      avg_cpu_time_ms: cpuMs,
      avg_logical_io_reads: row.avg_logical_io_reads,
      avg_physical_io_reads: row.avg_physical_io_reads,
      last_execution_time: ts.toISOString(),
      database_name: row.database_name ?? null,
      server: row.server ?? null,
    }),
  };

  entry.features = {
    durationMs,
    cpuMs,
    logicalReads: numericOr(row.avg_logical_io_reads, 0),
    physicalReads: numericOr(row.avg_physical_io_reads, 0),
    executionCount: numericOr(row.execution_count, 0),
  };

  return entry;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function microToMs(us: unknown): number {
  const n = typeof us === "number" ? us : Number(us);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n / 1000;
}

function numericOr(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function snippetFromText(
  text: string | null | undefined,
  opts: MapOptions | undefined,
): string | undefined {
  if (!text) return undefined;
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return undefined;
  const truncated = flat.length > QUERY_TEXT_MAX ? `${flat.slice(0, QUERY_TEXT_MAX)}…` : flat;
  return opts?.redactSqlText ? redactSqlLiterals(truncated) : truncated;
}

function normaliseHash(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = String(v).trim();
  return s || null;
}

function truncateHash(h: string): string {
  return h.length > 18 ? `${h.slice(0, 18)}…` : h;
}

function coerceDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
