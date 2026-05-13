/**
 * Network metrics mapper (`networkMetrics` feed).
 *
 * Source: Edge collector agent measuring the NETWORK LAYER between
 * the application server and the database server.
 *
 * This is the most critical feed for split-server architectures.
 * The document states: "Performance degradation often isn't because the code
 * is slow or the DB is slow — it's because the conversation between them
 * is lagging or failing."
 *
 * Metrics captured:
 *   - Latency (RTT) between app and DB server
 *   - TCP retransmissions / packet loss
 *   - Connection pool usage (active vs max)
 *   - Ephemeral port exhaustion
 *   - DNS resolution time
 *   - Bandwidth utilization
 *
 * Raw row shape (pushed by edge collector):
 *   { metric_name, metric_value, metric_unit, source_host?, target_host?,
 *     detail?, snapshot_time }
 *
 * Cursor shape: { lastSnapshotAt: string | null }
 */

import type { ParsedLogEntry } from "../../log-parser";
import type { FeedMapper, MapResult } from "../types";
import { toIsoString } from "../cumulative";

export interface NetworkMetricsRawRow {
  metric_name: string;
  metric_value: number;
  metric_unit: string;
  source_host?: string;  // app server hostname
  target_host?: string;  // DB server hostname
  detail?: string;
  snapshot_time: string | Date;
}

export interface NetworkMetricsCursor {
  lastSnapshotAt: string | null;
}

const PARSED_SOURCE = "Network.Metrics";

// Thresholds
const LATENCY_WARN_MS = 10;
const LATENCY_CRIT_MS = 50;
const RETRANSMIT_WARN_PCT = 1;
const RETRANSMIT_CRIT_PCT = 5;
const CONN_POOL_WARN_PCT = 80;
const CONN_POOL_CRIT_PCT = 95;
const EPHEMERAL_PORT_WARN_PCT = 70;
const EPHEMERAL_PORT_CRIT_PCT = 90;
const DNS_WARN_MS = 100;
const DNS_CRIT_MS = 500;
const PACKET_LOSS_WARN_PCT = 0.5;
const PACKET_LOSS_CRIT_PCT = 2;

function classify(name: string, value: number): "info" | "warning" | "error" | "critical" {
  const n = name.toLowerCase();

  if (n.includes("latency") || n.includes("rtt")) {
    if (value >= LATENCY_CRIT_MS) return "critical";
    if (value >= LATENCY_WARN_MS) return "warning";
  }
  if (n.includes("retransmit")) {
    if (value >= RETRANSMIT_CRIT_PCT) return "critical";
    if (value >= RETRANSMIT_WARN_PCT) return "warning";
  }
  if (n.includes("conn_pool") || n.includes("connection_pool")) {
    if (value >= CONN_POOL_CRIT_PCT) return "critical";
    if (value >= CONN_POOL_WARN_PCT) return "warning";
  }
  if (n.includes("ephemeral_port") || n.includes("port_usage")) {
    if (value >= EPHEMERAL_PORT_CRIT_PCT) return "critical";
    if (value >= EPHEMERAL_PORT_WARN_PCT) return "warning";
  }
  if (n.includes("dns")) {
    if (value >= DNS_CRIT_MS) return "critical";
    if (value >= DNS_WARN_MS) return "warning";
  }
  if (n.includes("packet_loss")) {
    if (value >= PACKET_LOSS_CRIT_PCT) return "critical";
    if (value >= PACKET_LOSS_WARN_PCT) return "warning";
  }
  return "info";
}

export const networkMetricsMapper: FeedMapper<NetworkMetricsRawRow, NetworkMetricsCursor> = {
  feed: "networkMetrics",
  parsedSource: PARSED_SOURCE,
  isCumulative: false,

  map(rows, previousCursor): MapResult<NetworkMetricsCursor> {
    const entries: ParsedLogEntry[] = [];
    const syntheticEvents: ParsedLogEntry[] = [];
    const now = rows[0]?.snapshot_time ? new Date(rows[0].snapshot_time) : new Date();

    for (const row of rows) {
      const level = classify(row.metric_name, row.metric_value);
      const ts = new Date(row.snapshot_time);
      const hostPair = row.source_host && row.target_host
        ? ` (${row.source_host} → ${row.target_host})`
        : "";

      entries.push({
        timestamp: ts,
        logLevel: level,
        source: PARSED_SOURCE,
        message: `${row.metric_name} = ${row.metric_value} ${row.metric_unit}${hostPair}${row.detail ? " — " + row.detail : ""}`,
        features: {
          metric_value: row.metric_value,
        },
      });
    }

    // Synthetic summary for elevated metrics
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
        message: `Network degradation: ${elevated.length} metric(s) above threshold — ${elevated.map((e) => e.message).join("; ")}`,
      });
    }

    return {
      entries,
      syntheticEvents,
      nextCursor: { lastSnapshotAt: toIsoString(now) },
    };
  },
};
