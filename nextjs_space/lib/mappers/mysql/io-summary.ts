/**
 * MySQL `ioStats` mapper.
 *
 * Source: `performance_schema.file_summary_by_instance`
 *
 * Cumulative file IO stats per MySQL data file.
 *
 * Cursor shape:
 *   { lastSnapshotAt, counters: { [file_name]: { count_read, count_write, sum_timer_read, sum_timer_write } } }
 */

import type { ParsedLogEntry } from "../../log-parser";
import type { FeedMapper, MapResult, MapOptions } from "../types";
import { computeDelta, toIsoString } from "../cumulative";

export interface MysqlIoSummaryRawRow {
  file_name: string;
  event_name: string;
  count_read: number;
  count_write: number;
  sum_timer_read: number;     // picoseconds cumulative
  sum_timer_write: number;
  sum_number_of_bytes_read: number;
  sum_number_of_bytes_written: number;
  snapshot_time: Date | string;
}

export interface MysqlIoSummaryCounterRow {
  count_read: number;
  count_write: number;
  sum_timer_read: number;
  sum_timer_write: number;
}

export interface MysqlIoSummaryCursor {
  lastSnapshotAt: string | null;
  counters: Record<string, MysqlIoSummaryCounterRow>;
}

const PARSED_SOURCE = "MySQL.IoSummary";
const PS_TO_MS = 1_000_000_000;
const TOP_N = 20;

function mapIoSummary(
  rows: MysqlIoSummaryRawRow[],
  previousCursor: MysqlIoSummaryCursor | null,
  _opts?: MapOptions,
): MapResult<MysqlIoSummaryCursor> {
  const entries: ParsedLogEntry[] = [];
  const prevCounters = previousCursor?.counters ?? {};
  const newCounters: Record<string, MysqlIoSummaryCounterRow> = {};
  const snapshotTime = rows[0] ? toIsoString(rows[0].snapshot_time) : null;

  // First pull primes cursor
  if (!previousCursor) {
    for (const row of rows) {
      newCounters[row.file_name] = {
        count_read: row.count_read,
        count_write: row.count_write,
        sum_timer_read: row.sum_timer_read,
        sum_timer_write: row.sum_timer_write,
      };
    }
    return {
      entries: [],
      syntheticEvents: [],
      nextCursor: { lastSnapshotAt: snapshotTime, counters: newCounters },
      note: "First pull — primed MySQL IO summary cursor.",
    };
  }

  const deltas: Array<{ row: MysqlIoSummaryRawRow; deltaReads: number; deltaWrites: number; deltaReadMs: number; deltaWriteMs: number }> = [];

  for (const row of rows) {
    const prev = prevCounters[row.file_name];
    const dr = computeDelta(row.count_read, prev?.count_read);
    const dw = computeDelta(row.count_write, prev?.count_write);
    const dtr = computeDelta(row.sum_timer_read, prev?.sum_timer_read);
    const dtw = computeDelta(row.sum_timer_write, prev?.sum_timer_write);

    newCounters[row.file_name] = {
      count_read: row.count_read,
      count_write: row.count_write,
      sum_timer_read: row.sum_timer_read,
      sum_timer_write: row.sum_timer_write,
    };

    const totalOps = dr.delta + dw.delta;
    if (totalOps === 0) continue;

    deltas.push({
      row,
      deltaReads: dr.delta,
      deltaWrites: dw.delta,
      deltaReadMs: dtr.delta / PS_TO_MS,
      deltaWriteMs: dtw.delta / PS_TO_MS,
    });
  }

  deltas.sort((a, b) => (b.deltaReadMs + b.deltaWriteMs) - (a.deltaReadMs + a.deltaWriteMs));
  const topDeltas = deltas.slice(0, TOP_N);

  for (const { row, deltaReads, deltaWrites, deltaReadMs, deltaWriteMs } of topDeltas) {
    const totalMs = deltaReadMs + deltaWriteMs;
    const totalOps = deltaReads + deltaWrites;
    const avgLatencyMs = totalOps > 0 ? totalMs / totalOps : 0;

    let level: "info" | "warning" | "critical" = "info";
    if (avgLatencyMs > 200 && totalOps > 100) level = "critical";
    else if (avgLatencyMs > 50 && totalOps > 100) level = "warning";

    // Extract just the filename from the full path
    const shortName = row.file_name.split(/[\\/]/).pop() ?? row.file_name;

    entries.push({
      timestamp: new Date(snapshotTime ?? new Date().toISOString()),
      logLevel: level,
      source: PARSED_SOURCE,
      message: `File '${shortName}': +${deltaReads}R/+${deltaWrites}W, avg latency ${avgLatencyMs.toFixed(1)}ms`,
      rawData: JSON.stringify({
        fileName: row.file_name,
        eventName: row.event_name,
        deltaReads,
        deltaWrites,
        deltaReadMs: Math.round(deltaReadMs),
        deltaWriteMs: Math.round(deltaWriteMs),
        avgLatencyMs: Math.round(avgLatencyMs),
      }),
      features: {
        deltaReads,
        deltaWrites,
        deltaReadMs,
        deltaWriteMs,
        avgLatencyMs,
      },
    });
  }

  return {
    entries,
    syntheticEvents: [],
    nextCursor: { lastSnapshotAt: snapshotTime, counters: newCounters },
  };
}

export const mysqlIoSummaryMapper: FeedMapper<MysqlIoSummaryRawRow, MysqlIoSummaryCursor> = {
  feed: "ioStats",
  parsedSource: PARSED_SOURCE,
  isCumulative: true,
  map: mapIoSummary,
};
