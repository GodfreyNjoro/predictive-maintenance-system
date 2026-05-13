/**
 * PostgreSQL `osMetrics` mapper.
 *
 * Source: pg_stat_database + pg_stat_bgwriter + pg_settings
 *   - pg_stat_database: xact_commit, xact_rollback, deadlocks, conflicts, temp_bytes
 *   - pg_stat_bgwriter: buffers_alloc, buffers_checkpoint, buffers_backend
 *   - pg_settings: shared_buffers, effective_cache_size, work_mem
 *   - pg_stat_activity: connection count, active queries
 *
 * Snapshot feed with derived pressure indicators.
 *
 * Cursor shape (opaque):
 *   { lastSnapshotAt: ISO string }
 */

import type { ParsedLogEntry } from "../../log-parser";
import type { FeedMapper, MapResult, MapOptions } from "../types";
import { toIsoString } from "../cumulative";

export interface PgOsMetricsRawRow {
  metric_name: string;
  metric_value: number;
  metric_unit: string;
  detail?: string;
  snapshot_time: string | Date;
}

export interface PgOsMetricsCursor {
  lastSnapshotAt: string | null;
}

const PARSED_SOURCE = "Postgres.OsMetrics";

// Thresholds
const CONN_USAGE_WARNING_PCT = 80;
const CONN_USAGE_CRITICAL_PCT = 95;
const ROLLBACK_RATIO_WARNING = 5; // percent
const TEMP_BYTES_WARNING_MB = 1024;

function classifyLevel(
  metricName: string,
  value: number,
): "info" | "warning" | "critical" {
  if (metricName === "connection_usage_pct") {
    if (value >= CONN_USAGE_CRITICAL_PCT) return "critical";
    if (value >= CONN_USAGE_WARNING_PCT) return "warning";
    return "info";
  }
  if (metricName === "rollback_ratio_pct") {
    if (value >= ROLLBACK_RATIO_WARNING) return "warning";
    return "info";
  }
  if (metricName === "temp_bytes_mb") {
    if (value >= TEMP_BYTES_WARNING_MB) return "warning";
    return "info";
  }
  if (metricName === "deadlocks") {
    if (value > 0) return "warning";
    return "info";
  }
  return "info";
}

export const pgOsMetricsMapper: FeedMapper<PgOsMetricsRawRow, PgOsMetricsCursor> = {
  feed: "osMetrics",
  parsedSource: PARSED_SOURCE,
  isCumulative: false,

  map(
    rows: PgOsMetricsRawRow[],
    previousCursor: PgOsMetricsCursor | null,
    opts?: MapOptions,
  ): MapResult<PgOsMetricsCursor> {
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
        message: `PG OS metrics: connections=${features["connection_usage_pct"] ?? "?"}%, rollback_ratio=${features["rollback_ratio_pct"] ?? "?"}%`,
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
