/**
 * IIS W3C access logs mapper (`iisLogs` feed).
 *
 * Source: Edge collector agent on the APPLICATION server.
 * Parses IIS W3C Extended Log Format entries for request-level metrics.
 *
 * Tracks: HTTP status codes, request latency (time-taken), queue length,
 * app pool recycles, and worker process health.
 *
 * Raw row shape (pushed by edge collector):
 *   { timestamp, method, uri, status, substatus?, win32status?,
 *     timeTakenMs, clientIp?, serverIp?, serverPort?, bytesReceived?,
 *     bytesSent?, queueLength?, appPoolName? }
 *
 * Cursor shape: { lastTimestamp: string | null, counters: { total, errors5xx, errors4xx, slowRequests } }
 */

import type { ParsedLogEntry } from "../../log-parser";
import type { FeedMapper, MapResult } from "../types";
import { toIsoString } from "../cumulative";

export interface IisLogsRawRow {
  timestamp: string | Date;
  method: string;         // GET, POST, etc.
  uri: string;            // /api/orders, /login, etc.
  status: number;         // HTTP status code
  substatus?: number;
  win32status?: number;
  timeTakenMs: number;    // request duration in milliseconds
  clientIp?: string;
  serverIp?: string;
  serverPort?: number;
  bytesReceived?: number;
  bytesSent?: number;
  queueLength?: number;   // IIS request queue length at time of request
  appPoolName?: string;
}

export interface IisLogsCursor {
  lastTimestamp: string | null;
  counters: {
    total: number;
    errors5xx: number;
    errors4xx: number;
    slowRequests: number;
  };
}

const PARSED_SOURCE = "IIS.AccessLog";

const SLOW_REQUEST_WARN_MS = 3000;
const SLOW_REQUEST_CRIT_MS = 10000;
const QUEUE_LENGTH_WARN = 50;
const QUEUE_LENGTH_CRIT = 200;

function classifyRequest(row: IisLogsRawRow): "info" | "warning" | "error" | "critical" {
  // 5xx = server error
  if (row.status >= 500) {
    if (row.status === 503) return "critical"; // Service Unavailable
    return "error";
  }
  // Extreme latency
  if (row.timeTakenMs >= SLOW_REQUEST_CRIT_MS) return "error";
  // High queue
  if (row.queueLength !== undefined && row.queueLength >= QUEUE_LENGTH_CRIT) return "critical";
  if (row.queueLength !== undefined && row.queueLength >= QUEUE_LENGTH_WARN) return "warning";
  // Slow request
  if (row.timeTakenMs >= SLOW_REQUEST_WARN_MS) return "warning";
  // 4xx (client error) — noteworthy but info-level
  return "info";
}

export const iisLogsMapper: FeedMapper<IisLogsRawRow, IisLogsCursor> = {
  feed: "iisLogs",
  parsedSource: PARSED_SOURCE,
  isCumulative: false,

  map(rows, previousCursor): MapResult<IisLogsCursor> {
    const entries: ParsedLogEntry[] = [];
    const syntheticEvents: ParsedLogEntry[] = [];
    let latestTs: Date | null = null;

    let total = 0, errors5xx = 0, errors4xx = 0, slowRequests = 0;

    for (const row of rows) {
      const ts = new Date(row.timestamp);
      if (!latestTs || ts > latestTs) latestTs = ts;
      total++;

      const level = classifyRequest(row);
      if (row.status >= 500) errors5xx++;
      else if (row.status >= 400) errors4xx++;
      if (row.timeTakenMs >= SLOW_REQUEST_WARN_MS) slowRequests++;

      // Only emit non-info entries to avoid flooding with normal 200s
      if (level !== "info") {
        entries.push({
          timestamp: ts,
          logLevel: level,
          source: PARSED_SOURCE,
          message: `${row.method} ${row.uri} → ${row.status} (${row.timeTakenMs}ms)${row.queueLength !== undefined ? " queue=" + row.queueLength : ""}`,
          features: {
            status: row.status,
            timeTakenMs: row.timeTakenMs,
            queueLength: row.queueLength ?? 0,
          },
        });
      }
    }

    // Always emit a summary entry
    const errorRate = total > 0 ? (errors5xx / total * 100) : 0;
    const summaryLevel = errorRate >= 10 ? "critical" : errorRate >= 2 ? "warning" : "info";
    const summaryTs = latestTs ?? new Date();
    entries.push({
      timestamp: summaryTs,
      logLevel: summaryLevel,
      source: PARSED_SOURCE,
      message: `IIS summary: ${total} requests, ${errors5xx} 5xx, ${errors4xx} 4xx, ${slowRequests} slow (>3s). Error rate: ${errorRate.toFixed(1)}%.`,
      features: {
        total,
        errors5xx,
        errors4xx,
        slowRequests,
        errorRatePct: Math.round(errorRate * 100) / 100,
      },
    });

    if (errors5xx > 0) {
      syntheticEvents.push({
        timestamp: summaryTs,
        logLevel: errors5xx >= 10 ? "critical" : "error",
        source: PARSED_SOURCE,
        message: `IIS: ${errors5xx} server errors (5xx) detected out of ${total} requests.`,
      });
    }

    return {
      entries,
      syntheticEvents,
      nextCursor: {
        lastTimestamp: toIsoString(latestTs),
        counters: { total, errors5xx, errors4xx, slowRequests },
      },
    };
  },
};
