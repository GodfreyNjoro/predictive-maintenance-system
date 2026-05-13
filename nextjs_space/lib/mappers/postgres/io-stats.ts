/**
 * PostgreSQL `ioStats` mapper.
 *
 * Source: `pg_stat_io` (PG16+) or `pg_statio_user_tables` (older versions).
 *
 * pg_stat_io is cumulative, so we use the delta helper.
 *
 * Cursor shape:
 *   {
 *     lastSnapshotAt: ISO string | null,
 *     counters: { [context:object]: { reads, writes, hits } }
 *   }
 *
 * Emission semantics:
 *   - One `ParsedLogEntry` per IO context with significant delta, source = `Postgres.IoStats`.
 *   - logLevel: info baseline; warning if read ratio > 50% (low cache hit); critical if > 80%.
 */

import type { ParsedLogEntry } from "../../log-parser";
import type { FeedMapper, MapResult, MapOptions } from "../types";
import { computeDelta, toIsoString } from "../cumulative";

export interface PgIoStatsRawRow {
  backend_type: string;
  io_object: string;        // "relation", "temp relation", etc.
  io_context: string;       // "normal", "vacuum", "bulkread", "bulkwrite"
  reads: number;            // cumulative
  writes: number;
  hits: number;
  read_time: number | null; // ms, cumulative (if track_io_timing)
  write_time: number | null;
  snapshot_time: Date | string;
}

export interface PgIoStatsCounterRow {
  reads: number;
  writes: number;
  hits: number;
}

export interface PgIoStatsCursor {
  lastSnapshotAt: string | null;
  counters: Record<string, PgIoStatsCounterRow>;
}

const PARSED_SOURCE = "Postgres.IoStats";

function mapIoStats(
  rows: PgIoStatsRawRow[],
  previousCursor: PgIoStatsCursor | null,
  _opts?: MapOptions,
): MapResult<PgIoStatsCursor> {
  const entries: ParsedLogEntry[] = [];
  const prevCounters = previousCursor?.counters ?? {};
  const newCounters: Record<string, PgIoStatsCounterRow> = {};
  const snapshotTime = rows[0] ? toIsoString(rows[0].snapshot_time) : null;

  // First pull primes cursor
  if (!previousCursor) {
    for (const row of rows) {
      const key = `${row.io_context}:${row.io_object}`;
      newCounters[key] = { reads: row.reads, writes: row.writes, hits: row.hits };
    }
    return {
      entries: [],
      syntheticEvents: [],
      nextCursor: { lastSnapshotAt: snapshotTime, counters: newCounters },
      note: "First pull — primed IO stats cursor.",
    };
  }

  for (const row of rows) {
    const key = `${row.io_context}:${row.io_object}`;
    const prev = prevCounters[key];
    const dr = computeDelta(row.reads, prev?.reads);
    const dw = computeDelta(row.writes, prev?.writes);
    const dh = computeDelta(row.hits, prev?.hits);

    newCounters[key] = { reads: row.reads, writes: row.writes, hits: row.hits };

    const totalOps = dr.delta + dw.delta + dh.delta;
    if (totalOps === 0) continue;

    const readRatio = totalOps > 0 ? dr.delta / totalOps : 0;
    let level: "info" | "warning" | "critical" = "info";
    if (readRatio > 0.8 && totalOps > 100) level = "critical";
    else if (readRatio > 0.5 && totalOps > 100) level = "warning";

    entries.push({
      timestamp: new Date(snapshotTime ?? new Date().toISOString()),
      logLevel: level,
      source: PARSED_SOURCE,
      message: `IO ${row.io_context}/${row.io_object}: +${dr.delta} reads, +${dw.delta} writes, +${dh.delta} hits (${(readRatio * 100).toFixed(0)}% read ratio)`,
      rawData: JSON.stringify({
        backendType: row.backend_type,
        ioObject: row.io_object,
        ioContext: row.io_context,
        deltaReads: dr.delta,
        deltaWrites: dw.delta,
        deltaHits: dh.delta,
      }),
      features: {
        deltaReads: dr.delta,
        deltaWrites: dw.delta,
        deltaHits: dh.delta,
        readRatio,
      },
    });
  }

  return {
    entries,
    syntheticEvents: [],
    nextCursor: { lastSnapshotAt: snapshotTime, counters: newCounters },
  };
}

export const pgIoStatsMapper: FeedMapper<PgIoStatsRawRow, PgIoStatsCursor> = {
  feed: "ioStats",
  parsedSource: PARSED_SOURCE,
  isCumulative: true,
  map: mapIoStats,
};
