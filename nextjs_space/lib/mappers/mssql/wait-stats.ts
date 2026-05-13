/**
 * MSSQL `waitStats` mapper.
 *
 * Source: `sys.dm_os_wait_stats` joined with `sys.dm_os_sys_info` for the
 *         `sqlserver_start_time` so we can detect server restarts.
 *
 * `sys.dm_os_wait_stats` is a *cumulative* DMV — every counter monotonically
 * increases since server start (or since the last `DBCC SQLPERF` reset).
 * To turn it into actionable signal we have to compute a delta against the
 * previous snapshot. There are TWO reset paths:
 *   1. **Server restart** → all counters reset to 0 simultaneously. Detected
 *      via `detectServerRestart` against the persisted start time.
 *   2. **Per-counter rollback** → very rare, but possible if an operator
 *      runs `DBCC SQLPERF ("sys.dm_os_wait_stats", CLEAR)`. Handled by
 *      `computeDelta` returning `reset = true` when current < previous.
 *
 * Cursor shape (opaque to callers):
 *   {
 *     lastSnapshotAt:   ISO string — when this snapshot was taken,
 *     serverStartTime:  ISO string — `sqlserver_start_time` at snapshot,
 *     counters:         { [wait_type]: { wait_ms, wait_count, signal_wait_ms } }
 *   }
 *
 * First call: prime the cursor and emit zero entries (we have no baseline
 * to subtract from). The `previousCursor === null` check handles this.
 *
 * Emission semantics:
 *   - One `ParsedLogEntry` per top-N (=20) wait type, sorted by
 *     `delta_wait_ms` DESC, source = `MSSQL.WaitStats`.
 *   - logLevel scales with `delta_wait_ms`: `info` (default), `warning`
 *     when delta > 60 000ms AND wait type is contention class
 *     (CXPACKET / PAGEIOLATCH_* / LCK_*), `critical` when delta > 300 000ms.
 *   - Idle waits (SLEEP_TASK, WAITFOR, BROKER_*, ...) are filtered out
 *     server-side via the SQL `WHERE` clause. We also defensively re-filter
 *     here to be robust against connector-side query mistakes.
 *   - On server restart, emit one synthetic `MSSQL.WaitStats.ServerRestart`
 *     warning entry; treat all current counters as deltas (i.e. previous=0).
 */

import type { ParsedLogEntry } from "../../log-parser";
import type { FeedMapper, MapResult, MapOptions } from "../types";
import { computeDelta, detectServerRestart, toIsoString } from "../cumulative";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface WaitStatsRawRow {
  wait_type: string;
  wait_time_ms: number;       // cumulative — total time tasks waited
  waiting_tasks_count: number; // cumulative — number of waits
  signal_wait_time_ms: number; // cumulative — time on runnable queue
  /** From sys.dm_os_sys_info — same value on every row, replicated by the connector. */
  sqlserver_start_time: Date | string | null;
  /** Snapshot timestamp injected by the connector (typically `new Date()`). */
  snapshot_time: Date | string;
  /** Optional server label, surfaces in rawData. */
  server?: string | null;
}

export interface WaitStatsCursorRow {
  wait_ms: number;
  wait_count: number;
  signal_wait_ms: number;
}

export interface WaitStatsCursor {
  lastSnapshotAt: string | null;
  serverStartTime: string | null;
  counters: Record<string, WaitStatsCursorRow>;
}

export const PARSED_SOURCE = "MSSQL.WaitStats";
export const PARSED_SOURCE_RESTART = "MSSQL.WaitStats.ServerRestart";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOP_N_WAITS = 20;

/**
 * Idle / benign waits that should never raise an alert. Curated from
 * Paul Randal's well-known reference list. The connector SQL filters most
 * of these out; this set acts as a defence-in-depth filter on the mapper.
 */
const IDLE_WAIT_TYPES = new Set<string>([
  "SLEEP_TASK",
  "WAITFOR",
  "WAITFOR_TASKSHUTDOWN",
  "LAZYWRITER_SLEEP",
  "LOGMGR_QUEUE",
  "CHECKPOINT_QUEUE",
  "REQUEST_FOR_DEADLOCK_SEARCH",
  "XE_TIMER_EVENT",
  "XE_DISPATCHER_WAIT",
  "XE_DISPATCHER_JOIN",
  "BROKER_TASK_STOP",
  "BROKER_TO_FLUSH",
  "BROKER_RECEIVE_WAITFOR",
  "BROKER_TRANSMITTER",
  "BROKER_EVENTHANDLER",
  "DBMIRROR_EVENTS_QUEUE",
  "DBMIRROR_WORKER_QUEUE",
  "DIRTY_PAGE_POLL",
  "FT_IFTS_SCHEDULER_IDLE_WAIT",
  "FT_IFTSHC_MUTEX",
  "HADR_FILESTREAM_IOMGR_IOCOMPLETION",
  "HADR_LOGCAPTURE_WAIT",
  "HADR_NOTIFICATION_DEQUEUE",
  "HADR_TIMER_TASK",
  "HADR_WORK_QUEUE",
  "KSOURCE_WAKEUP",
  "LOGMGR_FLUSH",
  "ONDEMAND_TASK_QUEUE",
  "PWAIT_ALL_COMPONENTS_INITIALIZED",
  "QDS_ASYNC_QUEUE",
  "QDS_CLEANUP_STALE_QUERIES_TASK_MAIN_LOOP_SLEEP",
  "QDS_PERSIST_TASK_MAIN_LOOP_SLEEP",
  "REDO_THREAD_PENDING_WORK",
  "SLEEP_BPOOL_FLUSH",
  "SLEEP_DBSTARTUP",
  "SLEEP_DCOMSTARTUP",
  "SLEEP_MASTERDBREADY",
  "SLEEP_MASTERMDREADY",
  "SLEEP_MASTERUPGRADED",
  "SLEEP_MSDBSTARTUP",
  "SLEEP_SYSTEMTASK",
  "SQLTRACE_BUFFER_FLUSH",
  "SQLTRACE_INCREMENTAL_FLUSH_SLEEP",
  "SQLTRACE_WAIT_ENTRIES",
  "WAIT_FOR_RESULTS",
  "WAIT_XTP_OFFLINE_CKPT_NEW_LOG",
  "WAIT_XTP_HOST_WAIT",
  "WAIT_XTP_RECOVERY",
  "WAIT_XTP_CKPT_CLOSE",
]);

/**
 * Wait-type prefixes that classify as "contention" — these escalate the log
 * level when delta_wait_ms is high. Anything else stays at `info` regardless
 * of magnitude (still surfaced as features for the predictor).
 */
function isContentionWait(waitType: string): boolean {
  return (
    waitType === "CXPACKET" ||
    waitType === "CXCONSUMER" ||
    waitType.startsWith("PAGEIOLATCH_") ||
    waitType.startsWith("PAGELATCH_") ||
    waitType.startsWith("LCK_") ||
    waitType === "WRITELOG" ||
    waitType === "ASYNC_NETWORK_IO" ||
    waitType === "RESOURCE_SEMAPHORE" ||
    waitType === "RESOURCE_SEMAPHORE_QUERY_COMPILE" ||
    waitType === "THREADPOOL" ||
    waitType === "SOS_SCHEDULER_YIELD"
  );
}

const WARNING_DELTA_MS = 60_000;     // 1 min cumulative wait in window
const CRITICAL_DELTA_MS = 300_000;   // 5 min

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

export const waitStatsMapper: FeedMapper<WaitStatsRawRow, WaitStatsCursor> = {
  feed: "waitStats",
  parsedSource: PARSED_SOURCE,
  isCumulative: true,
  map(rows, previousCursor, opts) {
    const now = (opts?.now?.() ?? new Date());
    let snapshotTime: Date = now;
    let currentServerStartTime: string | null = null;

    // Pull snapshot metadata from the first row (connector replicates it).
    if (rows.length > 0) {
      const firstRow = rows[0];
      const ts = coerceDate(firstRow.snapshot_time);
      if (ts) snapshotTime = ts;
      currentServerStartTime = toIsoString(firstRow.sqlserver_start_time);
    }

    const isFirstSnapshot =
      !previousCursor ||
      !previousCursor.lastSnapshotAt ||
      !previousCursor.counters;

    const restarted = !isFirstSnapshot &&
      detectServerRestart(
        previousCursor?.serverStartTime ?? null,
        currentServerStartTime,
      );

    // Build the next cursor from current snapshot regardless of emission.
    const nextCounters: Record<string, WaitStatsCursorRow> = {};
    let skipped = 0;
    for (const row of rows) {
      if (!row || typeof row.wait_type !== "string" || !row.wait_type) {
        skipped++;
        continue;
      }
      if (IDLE_WAIT_TYPES.has(row.wait_type)) continue;
      nextCounters[row.wait_type] = {
        wait_ms: numericOr(row.wait_time_ms, 0),
        wait_count: numericOr(row.waiting_tasks_count, 0),
        signal_wait_ms: numericOr(row.signal_wait_time_ms, 0),
      };
    }

    const nextCursor: WaitStatsCursor = {
      lastSnapshotAt: snapshotTime.toISOString(),
      serverStartTime: currentServerStartTime,
      counters: nextCounters,
    };

    // First-snapshot priming: persist cursor, emit nothing.
    if (isFirstSnapshot) {
      return {
        entries: [],
        syntheticEvents: [],
        nextCursor,
        note: skipped > 0
          ? `Primed cursor (first snapshot); ${skipped} row(s) skipped`
          : "Primed cursor (first snapshot)",
      };
    }

    const previousCounters: Record<string, WaitStatsCursorRow> = restarted
      ? {}
      : (previousCursor?.counters ?? {});

    const syntheticEvents: ParsedLogEntry[] = [];
    if (restarted) {
      syntheticEvents.push(buildRestartEntry(snapshotTime, {
        previousServerStartTime: previousCursor?.serverStartTime ?? null,
        currentServerStartTime: currentServerStartTime,
      }));
    }

    type Computed = {
      waitType: string;
      deltaWaitMs: number;
      deltaWaitCount: number;
      deltaSignalWaitMs: number;
      reset: boolean;
    };
    const computed: Computed[] = [];
    for (const [waitType, current] of Object.entries(nextCounters)) {
      const prev = previousCounters[waitType];
      const dWait = computeDelta(current.wait_ms, prev?.wait_ms ?? null);
      const dCount = computeDelta(current.wait_count, prev?.wait_count ?? null);
      const dSignal = computeDelta(current.signal_wait_ms, prev?.signal_wait_ms ?? null);

      // If we treat as fresh due to per-counter reset OR server restart, the
      // delta equals the current value. Skip noisy zero rows.
      if (dWait.delta <= 0 && dCount.delta <= 0) continue;
      computed.push({
        waitType,
        deltaWaitMs: dWait.delta,
        deltaWaitCount: dCount.delta,
        deltaSignalWaitMs: dSignal.delta,
        reset: dWait.reset || dCount.reset,
      });
    }
    computed.sort((a, b) => b.deltaWaitMs - a.deltaWaitMs);
    const top = computed.slice(0, TOP_N_WAITS);

    const entries: ParsedLogEntry[] = top.map((c) =>
      buildWaitEntry(c, snapshotTime, rows[0]?.server ?? null),
    );

    const noteParts: string[] = [];
    if (skipped > 0) noteParts.push(`${skipped} row(s) skipped`);
    if (restarted) noteParts.push("server restart detected");
    if (computed.length > top.length)
      noteParts.push(`emitted top ${TOP_N_WAITS} of ${computed.length} waits`);

    const result: MapResult<WaitStatsCursor> = {
      entries,
      syntheticEvents,
      nextCursor,
    };
    if (noteParts.length > 0) result.note = noteParts.join("; ");
    return result;
  },
};

// ---------------------------------------------------------------------------
// Per-row entry builders
// ---------------------------------------------------------------------------

function buildWaitEntry(
  c: { waitType: string; deltaWaitMs: number; deltaWaitCount: number; deltaSignalWaitMs: number; reset: boolean },
  snapshotTime: Date,
  server: string | null,
): ParsedLogEntry {
  const avgWaitMs = c.deltaWaitCount > 0 ? c.deltaWaitMs / c.deltaWaitCount : 0;

  let logLevel: "info" | "warning" | "critical" = "info";
  if (c.deltaWaitMs > CRITICAL_DELTA_MS && isContentionWait(c.waitType)) {
    logLevel = "critical";
  } else if (c.deltaWaitMs > WARNING_DELTA_MS && isContentionWait(c.waitType)) {
    logLevel = "warning";
  }

  const messageParts = [
    `Wait ${c.waitType}`,
    `${c.deltaWaitMs.toFixed(0)}ms over ${c.deltaWaitCount} wait(s)`,
    `avg ${avgWaitMs.toFixed(1)}ms`,
    `signal ${c.deltaSignalWaitMs.toFixed(0)}ms`,
  ];
  if (c.reset) messageParts.push("(counter reset)");

  const entry: ParsedLogEntry = {
    timestamp: snapshotTime,
    logLevel,
    source: PARSED_SOURCE,
    message: messageParts.join(" "),
    rawData: JSON.stringify({
      wait_type: c.waitType,
      delta_wait_ms: c.deltaWaitMs,
      delta_wait_count: c.deltaWaitCount,
      delta_signal_wait_ms: c.deltaSignalWaitMs,
      avg_wait_ms: avgWaitMs,
      reset: c.reset,
      server,
      snapshot_time: snapshotTime.toISOString(),
    }),
  };
  entry.features = {
    deltaWaitMs: c.deltaWaitMs,
    deltaWaitCount: c.deltaWaitCount,
    deltaSignalWaitMs: c.deltaSignalWaitMs,
    avgWaitMs,
  };
  return entry;
}

function buildRestartEntry(
  snapshotTime: Date,
  ctx: { previousServerStartTime: string | null; currentServerStartTime: string | null },
): ParsedLogEntry {
  return {
    timestamp: snapshotTime,
    logLevel: "warning",
    source: PARSED_SOURCE_RESTART,
    message: `SQL Server restart detected (sqlserver_start_time advanced from ${ctx.previousServerStartTime ?? "null"} to ${ctx.currentServerStartTime ?? "null"}); wait counters reset`,
    rawData: JSON.stringify({
      previous_start_time: ctx.previousServerStartTime,
      current_start_time: ctx.currentServerStartTime,
      detected_at: snapshotTime.toISOString(),
    }),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function coerceDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function numericOr(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
