/**
 * MySQL `osMetrics` mapper.
 *
 * Source: SHOW GLOBAL STATUS + INFORMATION_SCHEMA.INNODB_BUFFER_POOL_STATS +
 *         performance_schema.threads
 *
 * Metrics captured:
 *   - Threads_connected / max_connections → connection pressure
 *   - Threads_running → active query pressure
 *   - Innodb_buffer_pool_reads / read_requests → buffer pool miss ratio
 *   - Innodb_data_pending_reads / writes → pending IO
 *   - Uptime_since_flush_status → time metrics
 *   - Open_files / Open_tables → descriptor pressure
 *
 * Snapshot feed with derived pressure indicators.
 *
 * Cursor shape (opaque):
 *   { lastSnapshotAt: ISO string }
 */

import type { ParsedLogEntry } from "../../log-parser";
import type { FeedMapper, MapResult, MapOptions } from "../types";
import { toIsoString } from "../cumulative";

export interface MysqlOsMetricsRawRow {
  metric_name: string;
  metric_value: number;
  metric_unit: string;
  detail?: string;
  snapshot_time: string | Date;
}

export interface MysqlOsMetricsCursor {
  lastSnapshotAt: string | null;
}

const PARSED_SOURCE = "MySQL.OsMetrics";

// Thresholds
const CONN_USAGE_WARNING_PCT = 80;
const CONN_USAGE_CRITICAL_PCT = 95;
const THREADS_RUNNING_WARNING = 50;
const BUFFER_MISS_WARNING_PCT = 5;
const PENDING_IO_WARNING = 100;

function classifyLevel(
  metricName: string,
  value: number,
): "info" | "warning" | "critical" {
  if (metricName === "connection_usage_pct") {
    if (value >= CONN_USAGE_CRITICAL_PCT) return "critical";
    if (value >= CONN_USAGE_WARNING_PCT) return "warning";
    return "info";
  }
  if (metricName === "threads_running") {
    if (value >= THREADS_RUNNING_WARNING) return "warning";
    return "info";
  }
  if (metricName === "buffer_pool_miss_pct") {
    if (value >= BUFFER_MISS_WARNING_PCT) return "warning";
    return "info";
  }
  if (metricName === "pending_io_total") {
    if (value >= PENDING_IO_WARNING) return "warning";
    return "info";
  }
  return "info";
}

export const mysqlOsMetricsMapper: FeedMapper<MysqlOsMetricsRawRow, MysqlOsMetricsCursor> = {
  feed: "osMetrics",
  parsedSource: PARSED_SOURCE,
  isCumulative: false,

  map(
    rows: MysqlOsMetricsRawRow[],
    previousCursor: MysqlOsMetricsCursor | null,
    opts?: MapOptions,
  ): MapResult<MysqlOsMetricsCursor> {
    const now = opts?.now?.() ?? new Date();
    const entries: ParsedLogEntry[] = [];
    const syntheticEvents: ParsedLogEntry[] = [];
    const features: Record<string, number> = {};

    for (const row of rows) {
      const ts = row.snapshot_time instanceof Date
        ? row.snapshot_time
        : new Date(row.snapshot_time);

      const level = classifyLevel(row.metric_name, row.metric_value);
      features[row.metric_name] = row.metric_value;

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

    // Summary entry
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
        message: `MySQL OS metrics: connections=${features["connection_usage_pct"] ?? "?"}%, threads_running=${features["threads_running"] ?? "?"}`,
        rawData: JSON.stringify(features),
        features,
      });
    }

    return {
      entries,
      syntheticEvents,
      nextCursor: { lastSnapshotAt: toIsoString(now) },
    };
  },
};
