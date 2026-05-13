/**
 * MySQL `waitStats` mapper.
 *
 * Source: `performance_schema.events_waits_summary_global_by_event_name`
 *
 * Cumulative counters per wait event. Uses delta helper.
 *
 * Cursor shape:
 *   { lastSnapshotAt, counters: { [event_name]: { count_star, sum_timer_wait } } }
 */

import type { ParsedLogEntry } from "../../log-parser";
import type { FeedMapper, MapResult, MapOptions } from "../types";
import { computeDelta, toIsoString } from "../cumulative";

export interface MysqlWaitSummaryRawRow {
  event_name: string;
  count_star: number;
  sum_timer_wait: number;     // picoseconds (cumulative)
  avg_timer_wait: number;
  snapshot_time: Date | string;
}

export interface MysqlWaitSummaryCounterRow {
  count_star: number;
  sum_timer_wait: number;
}

export interface MysqlWaitSummaryCursor {
  lastSnapshotAt: string | null;
  counters: Record<string, MysqlWaitSummaryCounterRow>;
}

const PARSED_SOURCE = "MySQL.WaitSummary";
const PS_TO_MS = 1_000_000_000;
const TOP_N = 20;

/** Idle waits to filter out. */
const IDLE_WAITS = new Set([
  "idle",
  "wait/io/socket/sql/client_connection",
  "wait/synch/cond/sql/COND_manager",
]);

/** Contention waits that warrant escalation. */
const CONTENTION_PATTERNS = [
  /lock/i,
  /mutex/i,
  /rwlock/i,
  /wait\/synch/i,
  /wait\/io\/table/i,
];

function mapWaitSummary(
  rows: MysqlWaitSummaryRawRow[],
  previousCursor: MysqlWaitSummaryCursor | null,
  _opts?: MapOptions,
): MapResult<MysqlWaitSummaryCursor> {
  const entries: ParsedLogEntry[] = [];
  const prevCounters = previousCursor?.counters ?? {};
  const newCounters: Record<string, MysqlWaitSummaryCounterRow> = {};
  const snapshotTime = rows[0] ? toIsoString(rows[0].snapshot_time) : null;

  // First pull primes cursor
  if (!previousCursor) {
    for (const row of rows) {
      newCounters[row.event_name] = {
        count_star: row.count_star,
        sum_timer_wait: row.sum_timer_wait,
      };
    }
    return {
      entries: [],
      syntheticEvents: [],
      nextCursor: { lastSnapshotAt: snapshotTime, counters: newCounters },
      note: "First pull — primed MySQL wait summary cursor.",
    };
  }

  const deltas: Array<{ row: MysqlWaitSummaryRawRow; deltaCount: number; deltaTimeMs: number }> = [];

  for (const row of rows) {
    const prev = prevCounters[row.event_name];
    const dc = computeDelta(row.count_star, prev?.count_star);
    const dt = computeDelta(row.sum_timer_wait, prev?.sum_timer_wait);

    newCounters[row.event_name] = {
      count_star: row.count_star,
      sum_timer_wait: row.sum_timer_wait,
    };

    if (dc.delta > 0 && !IDLE_WAITS.has(row.event_name)) {
      deltas.push({ row, deltaCount: dc.delta, deltaTimeMs: dt.delta / PS_TO_MS });
    }
  }

  deltas.sort((a, b) => b.deltaTimeMs - a.deltaTimeMs);
  const topDeltas = deltas.slice(0, TOP_N);

  for (const { row, deltaCount, deltaTimeMs } of topDeltas) {
    const isContention = CONTENTION_PATTERNS.some((p) => p.test(row.event_name));
    let level: "info" | "warning" | "critical" = "info";
    if (isContention && deltaTimeMs > 5_000) level = "critical";
    else if (isContention && deltaTimeMs > 1_000) level = "warning";
    else if (deltaTimeMs > 10_000) level = "warning";

    entries.push({
      timestamp: new Date(snapshotTime ?? new Date().toISOString()),
      logLevel: level,
      source: PARSED_SOURCE,
      message: `Wait '${row.event_name}': +${deltaCount} events, +${deltaTimeMs.toFixed(1)}ms`,
      rawData: JSON.stringify({
        eventName: row.event_name,
        deltaCount,
        deltaTimeMs: Math.round(deltaTimeMs),
        isContention,
      }),
      features: {
        deltaCount,
        deltaTimeMs,
        isContention: isContention ? 1 : 0,
      },
    });
  }

  return {
    entries,
    syntheticEvents: [],
    nextCursor: { lastSnapshotAt: snapshotTime, counters: newCounters },
  };
}

export const mysqlWaitSummaryMapper: FeedMapper<MysqlWaitSummaryRawRow, MysqlWaitSummaryCursor> = {
  feed: "waitStats",
  parsedSource: PARSED_SOURCE,
  isCumulative: true,
  map: mapWaitSummary,
};
