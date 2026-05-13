/**
 * MSSQL `osMetrics` mapper.
 *
 * Source: snapshot from multiple DMVs:
 *   - sys.dm_os_sys_memory       → total/available physical memory
 *   - sys.dm_os_process_memory   → SQL Server process memory usage
 *   - sys.dm_os_sys_info         → CPU count, scheduler count
 *   - sys.dm_os_ring_buffers     → recent CPU history (ring buffer type = RING_BUFFER_SCHEDULER_MONITOR)
 *   - sys.dm_os_volume_stats     → disk free space per volume
 *
 * This is a **snapshot** feed, not cumulative. Each pull captures a point-in-time
 * snapshot and classifies it based on pressure thresholds.
 *
 * Cursor shape (opaque):
 *   { lastSnapshotAt: ISO string }
 */

import type { ParsedLogEntry } from "../../log-parser";
import type { FeedMapper, MapResult, MapOptions } from "../types";
import { toIsoString } from "../cumulative";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MssqlOsMetricsRawRow {
  metric_name: string;
  metric_value: number;
  metric_unit: string;
  detail?: string;
  snapshot_time: string | Date;
}

export interface MssqlOsMetricsCursor {
  lastSnapshotAt: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PARSED_SOURCE = "MSSQL.OsMetrics";

// Thresholds
const CPU_WARNING_PCT = 80;
const CPU_CRITICAL_PCT = 95;
const MEMORY_WARNING_PCT = 85;
const MEMORY_CRITICAL_PCT = 95;
const DISK_FREE_WARNING_GB = 10;
const DISK_FREE_CRITICAL_GB = 2;

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

function classifyLevel(
  metricName: string,
  value: number,
): "info" | "warning" | "critical" {
  if (metricName.includes("cpu_pct")) {
    if (value >= CPU_CRITICAL_PCT) return "critical";
    if (value >= CPU_WARNING_PCT) return "warning";
    return "info";
  }
  if (metricName.includes("memory_used_pct")) {
    if (value >= MEMORY_CRITICAL_PCT) return "critical";
    if (value >= MEMORY_WARNING_PCT) return "warning";
    return "info";
  }
  if (metricName === "disk_free_gb") {
    if (value <= DISK_FREE_CRITICAL_GB) return "critical";
    if (value <= DISK_FREE_WARNING_GB) return "warning";
    return "info";
  }
  return "info";
}

export const mssqlOsMetricsMapper: FeedMapper<MssqlOsMetricsRawRow, MssqlOsMetricsCursor> = {
  feed: "osMetrics",
  parsedSource: PARSED_SOURCE,
  isCumulative: false,

  map(
    rows: MssqlOsMetricsRawRow[],
    previousCursor: MssqlOsMetricsCursor | null,
    opts?: MapOptions,
  ): MapResult<MssqlOsMetricsCursor> {
    const now = opts?.now?.() ?? new Date();
    const entries: ParsedLogEntry[] = [];
    const syntheticEvents: ParsedLogEntry[] = [];
    const features: Record<string, number> = {};

    for (const row of rows) {
      const ts = row.snapshot_time instanceof Date
        ? row.snapshot_time
        : new Date(row.snapshot_time);

      const level = classifyLevel(row.metric_name, row.metric_value);

      // Collect features for the summary entry
      features[row.metric_name] = row.metric_value;

      // Only emit individual entries for non-info metrics (reduce noise)
      if (level !== "info") {
        entries.push({
          timestamp: ts,
          logLevel: level,
          source: PARSED_SOURCE,
          message: `${row.metric_name}: ${row.metric_value}${row.metric_unit}${row.detail ? ` (${row.detail})` : ""}`,
          rawData: JSON.stringify(row),
          features: { [row.metric_name]: row.metric_value },
        });
      }
    }

    // Always emit one summary entry with all features
    if (rows.length > 0) {
      const worstLevel = entries.some((e) => e.logLevel === "critical")
        ? "critical"
        : entries.some((e) => e.logLevel === "warning")
          ? "warning"
          : "info";

      const ts = rows[0].snapshot_time instanceof Date
        ? rows[0].snapshot_time
        : new Date(rows[0].snapshot_time);

      entries.push({
        timestamp: ts,
        logLevel: worstLevel,
        source: PARSED_SOURCE,
        message: `OS metrics snapshot: CPU=${features["cpu_pct"] ?? "?"}%, Memory=${features["memory_used_pct"] ?? "?"}%`,
        rawData: JSON.stringify(features),
        features,
      });
    }

    return {
      entries,
      syntheticEvents,
      nextCursor: {
        lastSnapshotAt: toIsoString(now),
      },
    };
  },
};
