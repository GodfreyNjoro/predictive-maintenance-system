/**
 * PostgreSQL `waitStats` mapper.
 *
 * Source: `pg_stat_activity` wait events — sampled snapshot of current waits.
 *
 * Unlike MSSQL's cumulative dm_os_wait_stats, Postgres pg_stat_activity is a
 * point-in-time snapshot (not cumulative). We aggregate by wait_event_type +
 * wait_event and emit one entry per active wait type.
 *
 * Cursor shape:
 *   { lastSnapshotAt: ISO string | null }
 *
 * Emission semantics:
 *   - One `ParsedLogEntry` per wait_event_type group, source = `Postgres.WaitEvents`.
 *   - logLevel: info baseline; warning if count > 5 concurrent sessions waiting;
 *     critical if > 10 sessions on a blocking wait.
 */

import type { ParsedLogEntry } from "../../log-parser";
import type { FeedMapper, MapResult, MapOptions } from "../types";
import { toIsoString } from "../cumulative";

export interface PgWaitEventRawRow {
  wait_event_type: string;
  wait_event: string;
  count: number;
  datname: string | null;
  snapshot_time: Date | string;
}

export interface PgWaitEventsCursor {
  lastSnapshotAt: string | null;
}

const PARSED_SOURCE = "Postgres.WaitEvents";

/** Wait event types that indicate blocking contention. */
const BLOCKING_WAIT_TYPES = new Set([
  "Lock",
  "BufferPin",
  "LWLock",
  "IO",
]);

function mapWaitEvents(
  rows: PgWaitEventRawRow[],
  previousCursor: PgWaitEventsCursor | null,
  _opts?: MapOptions,
): MapResult<PgWaitEventsCursor> {
  const entries: ParsedLogEntry[] = [];
  const snapshotTime = rows[0] ? toIsoString(rows[0].snapshot_time) : null;

  for (const row of rows) {
    if (!row.wait_event_type || !row.wait_event) continue;
    if (row.count === 0) continue;

    const isBlocking = BLOCKING_WAIT_TYPES.has(row.wait_event_type);
    let level: "info" | "warning" | "critical" = "info";
    if (isBlocking && row.count > 10) level = "critical";
    else if (isBlocking && row.count > 5) level = "warning";
    else if (row.count > 10) level = "warning";

    entries.push({
      timestamp: new Date(snapshotTime ?? new Date().toISOString()),
      logLevel: level,
      source: PARSED_SOURCE,
      message: `${row.count} session(s) waiting on ${row.wait_event_type}:${row.wait_event}${row.datname ? ` in ${row.datname}` : ""}`,
      rawData: JSON.stringify({
        waitEventType: row.wait_event_type,
        waitEvent: row.wait_event,
        count: row.count,
        database: row.datname ?? undefined,
      }),
      features: {
        sessionCount: row.count,
        isBlocking: isBlocking ? 1 : 0,
      },
    });
  }

  return {
    entries,
    syntheticEvents: [],
    nextCursor: { lastSnapshotAt: snapshotTime },
  };
}

export const pgWaitEventsMapper: FeedMapper<PgWaitEventRawRow, PgWaitEventsCursor> = {
  feed: "waitStats",
  parsedSource: PARSED_SOURCE,
  isCumulative: false,
  map: mapWaitEvents,
};
