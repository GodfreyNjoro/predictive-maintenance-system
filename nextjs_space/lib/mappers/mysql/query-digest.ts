/**
 * MySQL `queryStore` mapper.
 *
 * Source: `performance_schema.events_statements_summary_by_digest`
 *
 * This is MySQL's analog of MSSQL Query Store / pg_stat_statements.
 * The table accumulates counts per digest since server start (cumulative).
 *
 * Cursor shape:
 *   { lastQueryAt, counters: { [digest]: { count_star, sum_timer_wait } } }
 *
 * Emission semantics:
 *   - One `ParsedLogEntry` per digest with significant delta activity.
 *   - source = `MySQL.QueryDigest`
 */

import type { ParsedLogEntry } from "../../log-parser";
import type { FeedMapper, MapResult, MapOptions } from "../types";
import { computeDelta, toIsoString } from "../cumulative";

export interface MysqlQueryDigestRawRow {
  digest: string;
  digest_text: string;
  schema_name: string | null;
  count_star: number;
  sum_timer_wait: number;        // picoseconds (cumulative)
  avg_timer_wait: number;        // picoseconds
  sum_rows_examined: number;
  sum_rows_sent: number;
  first_seen: Date | string;
  last_seen: Date | string;
  snapshot_time: Date | string;
}

export interface MysqlQueryDigestCounterRow {
  count_star: number;
  sum_timer_wait: number;
}

export interface MysqlQueryDigestCursor {
  lastQueryAt: string | null;
  counters: Record<string, MysqlQueryDigestCounterRow>;
}

const PARSED_SOURCE = "MySQL.QueryDigest";
const TOP_N = 30;
const PS_TO_MS = 1_000_000_000; // picoseconds to milliseconds
const WARN_AVG_MS = 5_000;
const CRIT_AVG_MS = 30_000;

function mapQueryDigest(
  rows: MysqlQueryDigestRawRow[],
  previousCursor: MysqlQueryDigestCursor | null,
  opts?: MapOptions,
): MapResult<MysqlQueryDigestCursor> {
  const entries: ParsedLogEntry[] = [];
  const prevCounters = previousCursor?.counters ?? {};
  const newCounters: Record<string, MysqlQueryDigestCounterRow> = {};
  const snapshotTime = rows[0] ? toIsoString(rows[0].snapshot_time) : null;

  // First pull primes cursor
  if (!previousCursor) {
    for (const row of rows) {
      const key = row.digest;
      newCounters[key] = {
        count_star: row.count_star,
        sum_timer_wait: row.sum_timer_wait,
      };
    }
    return {
      entries: [],
      syntheticEvents: [],
      nextCursor: { lastQueryAt: snapshotTime, counters: newCounters },
      note: "First pull — primed MySQL query digest cursor.",
    };
  }

  const deltas: Array<{ row: MysqlQueryDigestRawRow; deltaCalls: number; deltaTimeMs: number }> = [];

  for (const row of rows) {
    const key = row.digest;
    const prev = prevCounters[key];
    const dc = computeDelta(row.count_star, prev?.count_star);
    const dt = computeDelta(row.sum_timer_wait, prev?.sum_timer_wait);

    newCounters[key] = {
      count_star: row.count_star,
      sum_timer_wait: row.sum_timer_wait,
    };

    if (dc.delta > 0) {
      deltas.push({ row, deltaCalls: dc.delta, deltaTimeMs: dt.delta / PS_TO_MS });
    }
  }

  deltas.sort((a, b) => b.deltaTimeMs - a.deltaTimeMs);
  const topDeltas = deltas.slice(0, TOP_N);

  for (const { row, deltaCalls, deltaTimeMs } of topDeltas) {
    const avgMs = deltaCalls > 0 ? deltaTimeMs / deltaCalls : 0;
    let level: "info" | "warning" | "critical" = "info";
    if (avgMs > CRIT_AVG_MS) level = "critical";
    else if (avgMs > WARN_AVG_MS) level = "warning";

    const digestText = opts?.redactSqlText
      ? truncate(row.digest_text.replace(/'[^']*'/g, "'***'"), 500)
      : truncate(row.digest_text, 500);

    entries.push({
      timestamp: new Date(snapshotTime ?? new Date().toISOString()),
      logLevel: level,
      source: PARSED_SOURCE,
      message: `Digest ${row.digest.slice(0, 16)}: ${deltaCalls} calls, avg ${avgMs.toFixed(1)}ms — ${digestText}`,
      rawData: JSON.stringify({
        digest: row.digest,
        schema: row.schema_name ?? undefined,
        deltaCalls,
        deltaTimeMs: Math.round(deltaTimeMs),
        avgExecTimeMs: Math.round(avgMs),
      }),
      features: {
        deltaCalls,
        deltaTimeMs,
        avgExecTimeMs: avgMs,
        sumRowsExamined: row.sum_rows_examined,
        sumRowsSent: row.sum_rows_sent,
      },
    });
  }

  return {
    entries,
    syntheticEvents: [],
    nextCursor: { lastQueryAt: snapshotTime, counters: newCounters },
  };
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "\u2026";
}

export const mysqlQueryDigestMapper: FeedMapper<MysqlQueryDigestRawRow, MysqlQueryDigestCursor> = {
  feed: "queryStore",
  parsedSource: PARSED_SOURCE,
  isCumulative: true,
  map: mapQueryDigest,
};
