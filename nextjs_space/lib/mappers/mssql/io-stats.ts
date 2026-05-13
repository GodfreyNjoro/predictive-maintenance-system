/**
 * MSSQL `ioStats` mapper.
 *
 * Source: `sys.dm_io_virtual_file_stats(NULL, NULL)` joined with
 *         `sys.master_files` for the file path / database name, plus
 *         `sys.dm_os_sys_info` for the `sqlserver_start_time` (so we can
 *         detect server restarts the same way as `waitStats`).
 *
 * Like `waitStats`, the underlying DMV is *cumulative* — every counter
 * monotonically increases since server start. We compute deltas against
 * the previous snapshot, with two reset paths:
 *   1. **Server restart** → all counters reset; detected via
 *      `detectServerRestart`.
 *   2. **Per-counter rollback** → handled by `computeDelta`.
 *
 * Cursor shape (opaque):
 *   {
 *     lastSnapshotAt:   ISO string,
 *     serverStartTime:  ISO string,
 *     counters:         { [database_id:file_id]: {
 *                          num_reads, num_writes,
 *                          io_stall_read_ms, io_stall_write_ms,
 *                        } }
 *   }
 *
 * First call: prime cursor, emit nothing.
 *
 * Emission semantics:
 *   - One `ParsedLogEntry` per active database file (skip files with no
 *     IO in the window). Source = `MSSQL.IoStats`.
 *   - Skip files where (`delta_num_reads + delta_num_writes`) === 0.
 *   - logLevel scales with computed average latency:
 *       avg_latency_ms <= 50           → `info`
 *       avg_latency_ms 50..200, ops>100 → `warning`
 *       avg_latency_ms > 200, ops>100   → `critical`
 *   - On server restart, emit one synthetic `MSSQL.IoStats.ServerRestart`
 *     warning entry; treat all counters as deltas.
 */

import type { ParsedLogEntry } from "../../log-parser";
import type { FeedMapper, MapResult, MapOptions } from "../types";
import { computeDelta, detectServerRestart, toIsoString } from "../cumulative";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface IoStatsRawRow {
  database_id: number;
  file_id: number;
  database_name: string | null;
  logical_name: string | null;
  physical_name: string | null;
  type_desc: string | null;          // ROWS / LOG / FILESTREAM / ...
  num_of_reads: number;
  num_of_writes: number;
  num_of_bytes_read: number;
  num_of_bytes_written: number;
  io_stall_read_ms: number;
  io_stall_write_ms: number;
  size_on_disk_bytes: number | null;
  /** From sys.dm_os_sys_info — replicated by the connector on every row. */
  sqlserver_start_time: Date | string | null;
  /** Snapshot timestamp injected by the connector. */
  snapshot_time: Date | string;
  /** Optional server label, surfaces in rawData. */
  server?: string | null;
}

export interface IoStatsCursorRow {
  num_reads: number;
  num_writes: number;
  io_stall_read_ms: number;
  io_stall_write_ms: number;
}

export interface IoStatsCursor {
  lastSnapshotAt: string | null;
  serverStartTime: string | null;
  counters: Record<string, IoStatsCursorRow>;
}

export const PARSED_SOURCE = "MSSQL.IoStats";
export const PARSED_SOURCE_RESTART = "MSSQL.IoStats.ServerRestart";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WARNING_LATENCY_MS = 50;
const CRITICAL_LATENCY_MS = 200;
const MIN_OPS_FOR_ESCALATION = 100;

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

export const ioStatsMapper: FeedMapper<IoStatsRawRow, IoStatsCursor> = {
  feed: "ioStats",
  parsedSource: PARSED_SOURCE,
  isCumulative: true,
  map(rows, previousCursor, opts) {
    const now = (opts?.now?.() ?? new Date());
    let snapshotTime: Date = now;
    let currentServerStartTime: string | null = null;

    if (rows.length > 0) {
      const ts = coerceDate(rows[0].snapshot_time);
      if (ts) snapshotTime = ts;
      currentServerStartTime = toIsoString(rows[0].sqlserver_start_time);
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

    // Build next cursor from current snapshot.
    const nextCounters: Record<string, IoStatsCursorRow> = {};
    const sizesOnDisk: Record<string, number> = {};
    const meta: Record<string, { databaseName: string | null; logicalName: string | null; physicalName: string | null; typeDesc: string | null }> = {};
    let skipped = 0;

    for (const row of rows) {
      if (
        !row ||
        typeof row.database_id !== "number" ||
        typeof row.file_id !== "number"
      ) {
        skipped++;
        continue;
      }
      const key = `${row.database_id}:${row.file_id}`;
      nextCounters[key] = {
        num_reads: numericOr(row.num_of_reads, 0),
        num_writes: numericOr(row.num_of_writes, 0),
        io_stall_read_ms: numericOr(row.io_stall_read_ms, 0),
        io_stall_write_ms: numericOr(row.io_stall_write_ms, 0),
      };
      if (row.size_on_disk_bytes != null) {
        const n = numericOr(row.size_on_disk_bytes, 0);
        if (n > 0) sizesOnDisk[key] = n;
      }
      meta[key] = {
        databaseName: row.database_name ?? null,
        logicalName: row.logical_name ?? null,
        physicalName: row.physical_name ?? null,
        typeDesc: row.type_desc ?? null,
      };
    }

    const nextCursor: IoStatsCursor = {
      lastSnapshotAt: snapshotTime.toISOString(),
      serverStartTime: currentServerStartTime,
      counters: nextCounters,
    };

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

    const previousCounters: Record<string, IoStatsCursorRow> = restarted
      ? {}
      : (previousCursor?.counters ?? {});

    const syntheticEvents: ParsedLogEntry[] = [];
    if (restarted) {
      syntheticEvents.push(buildRestartEntry(snapshotTime, {
        previousServerStartTime: previousCursor?.serverStartTime ?? null,
        currentServerStartTime,
      }));
    }

    const entries: ParsedLogEntry[] = [];
    let activeFiles = 0;

    for (const [key, current] of Object.entries(nextCounters)) {
      const prev = previousCounters[key];
      const dReads = computeDelta(current.num_reads, prev?.num_reads ?? null);
      const dWrites = computeDelta(current.num_writes, prev?.num_writes ?? null);
      const dStallR = computeDelta(current.io_stall_read_ms, prev?.io_stall_read_ms ?? null);
      const dStallW = computeDelta(current.io_stall_write_ms, prev?.io_stall_write_ms ?? null);

      const totalOps = dReads.delta + dWrites.delta;
      if (totalOps <= 0) continue;

      const avgReadLatencyMs = dReads.delta > 0 ? dStallR.delta / dReads.delta : 0;
      const avgWriteLatencyMs = dWrites.delta > 0 ? dStallW.delta / dWrites.delta : 0;
      const peakLatencyMs = Math.max(avgReadLatencyMs, avgWriteLatencyMs);

      let logLevel: "info" | "warning" | "critical" = "info";
      if (peakLatencyMs > CRITICAL_LATENCY_MS && totalOps > MIN_OPS_FOR_ESCALATION) {
        logLevel = "critical";
      } else if (peakLatencyMs > WARNING_LATENCY_MS && totalOps > MIN_OPS_FOR_ESCALATION) {
        logLevel = "warning";
      }

      const sizeOnDiskMb = sizesOnDisk[key] ? sizesOnDisk[key] / (1024 * 1024) : 0;
      const m = meta[key] ?? { databaseName: null, logicalName: null, physicalName: null, typeDesc: null };
      const reset = dReads.reset || dWrites.reset || dStallR.reset || dStallW.reset;

      const messageParts = [
        `IO db=${m.databaseName ?? key.split(":")[0]}`,
        `file=${m.logicalName ?? key.split(":")[1]}`,
        m.typeDesc ? `(${m.typeDesc})` : null,
        `reads ${dReads.delta} avg ${avgReadLatencyMs.toFixed(1)}ms`,
        `writes ${dWrites.delta} avg ${avgWriteLatencyMs.toFixed(1)}ms`,
        reset ? "(counter reset)" : null,
      ].filter(Boolean);

      const entry: ParsedLogEntry = {
        timestamp: snapshotTime,
        logLevel,
        source: PARSED_SOURCE,
        message: messageParts.join(" "),
        rawData: JSON.stringify({
          database_id: Number(key.split(":")[0]),
          file_id: Number(key.split(":")[1]),
          database_name: m.databaseName,
          logical_name: m.logicalName,
          physical_name: m.physicalName,
          type_desc: m.typeDesc,
          delta_num_reads: dReads.delta,
          delta_num_writes: dWrites.delta,
          delta_io_stall_read_ms: dStallR.delta,
          delta_io_stall_write_ms: dStallW.delta,
          avg_read_latency_ms: avgReadLatencyMs,
          avg_write_latency_ms: avgWriteLatencyMs,
          size_on_disk_mb: sizeOnDiskMb,
          reset,
          server: rows[0]?.server ?? null,
          snapshot_time: snapshotTime.toISOString(),
        }),
      };
      entry.features = {
        avgReadLatencyMs,
        avgWriteLatencyMs,
        deltaReads: dReads.delta,
        deltaWrites: dWrites.delta,
        sizeOnDiskMb,
      };
      entries.push(entry);
      activeFiles++;
    }

    const noteParts: string[] = [];
    if (skipped > 0) noteParts.push(`${skipped} row(s) skipped`);
    if (restarted) noteParts.push("server restart detected");
    if (activeFiles === 0 && rows.length > 0)
      noteParts.push("no IO activity in window");

    const result: MapResult<IoStatsCursor> = {
      entries,
      syntheticEvents,
      nextCursor,
    };
    if (noteParts.length > 0) result.note = noteParts.join("; ");
    return result;
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildRestartEntry(
  snapshotTime: Date,
  ctx: { previousServerStartTime: string | null; currentServerStartTime: string | null },
): ParsedLogEntry {
  return {
    timestamp: snapshotTime,
    logLevel: "warning",
    source: PARSED_SOURCE_RESTART,
    message: `SQL Server restart detected (sqlserver_start_time advanced from ${ctx.previousServerStartTime ?? "null"} to ${ctx.currentServerStartTime ?? "null"}); IO counters reset`,
    rawData: JSON.stringify({
      previous_start_time: ctx.previousServerStartTime,
      current_start_time: ctx.currentServerStartTime,
      detected_at: snapshotTime.toISOString(),
    }),
  };
}

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
