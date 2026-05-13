/**
 * PostgreSQL `queryStore` mapper.
 *
 * Source: `pg_stat_statements` — extension that tracks query execution
 * statistics. This is the Postgres analog of MSSQL Query Store.
 *
 * `pg_stat_statements` is cumulative: `total_exec_time`, `calls`, etc.
 * grow monotonically until `pg_stat_statements_reset()` is called.
 * We use the cumulative-delta helper for correct delta computation.
 *
 * Cursor shape:
 *   {
 *     lastQueryAt: ISO string | null,
 *     counters: { [queryid]: { calls, total_exec_time, rows } }
 *   }
 *
 * Emission semantics:
 *   - One `ParsedLogEntry` per query with significant delta activity.
 *   - source = `Postgres.QueryStats`
 *   - logLevel: info baseline; warning if avg_exec_time > 5000ms; critical if > 30000ms.
 */

import type { ParsedLogEntry } from "../../log-parser";
import type { FeedMapper, MapResult, MapOptions } from "../types";
import { computeDelta, toIsoString } from "../cumulative";

export interface PgQueryStatsRawRow {
  queryid: string | number;
  query: string;
  calls: number;
  total_exec_time: number;      // ms (cumulative)
  mean_exec_time: number;       // ms (point-in-time avg)
  rows: number;                 // cumulative
  shared_blks_hit: number;
  shared_blks_read: number;
  blk_read_time: number;        // ms, cumulative (if track_io_timing)
  blk_write_time: number;
  datname: string;
  snapshot_time: Date | string;
}

export interface PgQueryStatsCounterRow {
  calls: number;
  total_exec_time: number;
  rows: number;
}

export interface PgQueryStatsCursor {
  lastQueryAt: string | null;
  counters: Record<string, PgQueryStatsCounterRow>;
}

const PARSED_SOURCE = "Postgres.QueryStats";
const TOP_N = 30;
const WARN_AVG_MS = 5_000;
const CRIT_AVG_MS = 30_000;

function mapQueryStats(
  rows: PgQueryStatsRawRow[],
  previousCursor: PgQueryStatsCursor | null,
  opts?: MapOptions,
): MapResult<PgQueryStatsCursor> {
  const entries: ParsedLogEntry[] = [];
  const prevCounters = previousCursor?.counters ?? {};
  const newCounters: Record<string, PgQueryStatsCounterRow> = {};

  const snapshotTime = rows[0] ? toIsoString(rows[0].snapshot_time) : null;

  // First pull primes cursor — emit nothing
  if (!previousCursor) {
    for (const row of rows) {
      const key = String(row.queryid);
      newCounters[key] = {
        calls: row.calls,
        total_exec_time: row.total_exec_time,
        rows: row.rows,
      };
    }
    return {
      entries: [],
      syntheticEvents: [],
      nextCursor: { lastQueryAt: snapshotTime, counters: newCounters },
      note: "First pull — primed cursor. Deltas will be emitted on next pull.",
    };
  }

  // Compute deltas
  const deltas: Array<{ row: PgQueryStatsRawRow; deltaCalls: number; deltaExecTime: number }> = [];

  for (const row of rows) {
    const key = String(row.queryid);
    const prev = prevCounters[key];
    const dc = computeDelta(row.calls, prev?.calls);
    const dt = computeDelta(row.total_exec_time, prev?.total_exec_time);

    newCounters[key] = {
      calls: row.calls,
      total_exec_time: row.total_exec_time,
      rows: row.rows,
    };

    if (dc.delta > 0) {
      deltas.push({ row, deltaCalls: dc.delta, deltaExecTime: dt.delta });
    }
  }

  // Sort by delta exec time DESC, take top N
  deltas.sort((a, b) => b.deltaExecTime - a.deltaExecTime);
  const topDeltas = deltas.slice(0, TOP_N);

  for (const { row, deltaCalls, deltaExecTime } of topDeltas) {
    const avgMs = deltaCalls > 0 ? deltaExecTime / deltaCalls : 0;
    let level: "info" | "warning" | "critical" = "info";
    if (avgMs > CRIT_AVG_MS) level = "critical";
    else if (avgMs > WARN_AVG_MS) level = "warning";

    const queryText = opts?.redactSqlText
      ? redactSql(row.query)
      : truncate(row.query, 500);

    entries.push({
      timestamp: new Date(snapshotTime ?? new Date().toISOString()),
      logLevel: level,
      source: PARSED_SOURCE,
      message: `Query ${row.queryid}: ${deltaCalls} calls, avg ${avgMs.toFixed(1)}ms — ${queryText}`,
      rawData: JSON.stringify({
        queryid: String(row.queryid),
        database: row.datname,
        deltaCalls,
        deltaExecTimeMs: Math.round(deltaExecTime),
        avgExecTimeMs: Math.round(avgMs),
        meanExecTimeMs: Math.round(row.mean_exec_time),
      }),
      features: {
        deltaCalls,
        deltaExecTimeMs: deltaExecTime,
        avgExecTimeMs: avgMs,
        sharedBlksHit: row.shared_blks_hit,
        sharedBlksRead: row.shared_blks_read,
      },
    });
  }

  return {
    entries,
    syntheticEvents: [],
    nextCursor: { lastQueryAt: snapshotTime, counters: newCounters },
  };
}

function redactSql(sql: string): string {
  return truncate(sql.replace(/'[^']*'/g, "'***'"), 500);
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "\u2026";
}

export const pgQueryStatsMapper: FeedMapper<PgQueryStatsRawRow, PgQueryStatsCursor> = {
  feed: "queryStore",
  parsedSource: PARSED_SOURCE,
  isCumulative: true,
  map: mapQueryStats,
};
