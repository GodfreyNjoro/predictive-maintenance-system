/**
 * Application-server metrics mapper (`appMetrics` feed).
 *
 * Source: Edge collector agent running on the APPLICATION server (not the DB server).
 * Collects request throughput, latency percentiles, error rates, thread pool health,
 * and dependency call stats via OpenTelemetry, Application Insights, or custom APM.
 *
 * This feed is CRITICAL for split-server architectures where the app and DB are on
 * different hosts. Without it, PMS is blind to application-level failures that
 * the database doesn't see.
 *
 * Raw row shape (pushed by edge collector):
 *   { metric_name, metric_value, metric_unit, detail?, category?, snapshot_time }
 *
 * Cursor shape: { lastSnapshotAt: string | null }
 */

import type { ParsedLogEntry } from "../../log-parser";
import type { FeedMapper, MapResult } from "../types";
import { toIsoString } from "../cumulative";

export interface AppMetricsRawRow {
  metric_name: string;
  metric_value: number;
  metric_unit: string;
  category?: string;   // "request", "dependency", "threadpool", "exception"
  detail?: string;
  snapshot_time: string | Date;
}

export interface AppMetricsCursor {
  lastSnapshotAt: string | null;
}

const PARSED_SOURCE = "App.Metrics";

// Thresholds
const RESPONSE_TIME_P95_WARN_MS = 2000;
const RESPONSE_TIME_P95_CRIT_MS = 5000;
const ERROR_RATE_WARN_PCT = 2;
const ERROR_RATE_CRIT_PCT = 10;
const THREAD_POOL_USAGE_WARN_PCT = 75;
const THREAD_POOL_USAGE_CRIT_PCT = 90;
const QUEUE_LENGTH_WARN = 50;
const QUEUE_LENGTH_CRIT = 200;
const GC_TIME_WARN_PCT = 10;
const GC_TIME_CRIT_PCT = 25;

function classify(name: string, value: number): "info" | "warning" | "error" | "critical" {
  const n = name.toLowerCase();
  if (n.includes("response_time") || n.includes("latency_p95") || n.includes("latency_p99")) {
    if (value >= RESPONSE_TIME_P95_CRIT_MS) return "critical";
    if (value >= RESPONSE_TIME_P95_WARN_MS) return "warning";
  }
  if (n.includes("error_rate")) {
    if (value >= ERROR_RATE_CRIT_PCT) return "critical";
    if (value >= ERROR_RATE_WARN_PCT) return "warning";
  }
  if (n.includes("thread_pool_usage") || n.includes("threadpool_pct")) {
    if (value >= THREAD_POOL_USAGE_CRIT_PCT) return "critical";
    if (value >= THREAD_POOL_USAGE_WARN_PCT) return "warning";
  }
  if (n.includes("queue_length") || n.includes("request_queue")) {
    if (value >= QUEUE_LENGTH_CRIT) return "error";
    if (value >= QUEUE_LENGTH_WARN) return "warning";
  }
  if (n.includes("gc_time") || n.includes("gc_pct")) {
    if (value >= GC_TIME_CRIT_PCT) return "critical";
    if (value >= GC_TIME_WARN_PCT) return "warning";
  }
  return "info";
}

export const appMetricsMapper: FeedMapper<AppMetricsRawRow, AppMetricsCursor> = {
  feed: "appMetrics",
  parsedSource: PARSED_SOURCE,
  isCumulative: false,

  map(rows, previousCursor): MapResult<AppMetricsCursor> {
    const entries: ParsedLogEntry[] = [];
    const syntheticEvents: ParsedLogEntry[] = [];
    const now = rows[0]?.snapshot_time ? new Date(rows[0].snapshot_time) : new Date();

    for (const row of rows) {
      const level = classify(row.metric_name, row.metric_value);
      const ts = new Date(row.snapshot_time);

      entries.push({
        timestamp: ts,
        logLevel: level,
        source: PARSED_SOURCE,
        message: `[${row.category ?? "app"}] ${row.metric_name} = ${row.metric_value} ${row.metric_unit}${row.detail ? " (" + row.detail + ")" : ""}`,
        features: {
          metric_value: row.metric_value,
        },
      });
    }

    // Emit summary synthetic event if any non-info metrics
    const elevated = entries.filter((e) => e.logLevel !== "info");
    if (elevated.length > 0) {
      const worst = elevated.some((e) => e.logLevel === "critical")
        ? "critical"
        : elevated.some((e) => e.logLevel === "error")
        ? "error"
        : "warning";
      syntheticEvents.push({
        timestamp: now,
        logLevel: worst,
        source: PARSED_SOURCE,
        message: `App-server pressure: ${elevated.length} elevated metric(s) — ${elevated.map((e) => e.message).join("; ")}`,
      });
    }

    return {
      entries,
      syntheticEvents,
      nextCursor: { lastSnapshotAt: toIsoString(now) },
    };
  },
};
