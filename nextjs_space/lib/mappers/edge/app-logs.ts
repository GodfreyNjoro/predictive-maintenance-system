/**
 * Structured application logs mapper (`appLogs` feed).
 *
 * Source: Edge collector agent shipping structured logs from the APPLICATION server.
 * Typically from Serilog, NLog, log4net, or OpenTelemetry log exporter.
 *
 * Raw row shape (pushed by edge collector):
 *   { timestamp, level, message, exception?, correlationId?, service?, machine?,
 *     category?, stackTrace?, userId? }
 *
 * Cursor shape: { lastTimestamp: string | null }
 */

import type { ParsedLogEntry } from "../../log-parser";
import type { FeedMapper, MapResult } from "../types";
import { toIsoString } from "../cumulative";

export interface AppLogsRawRow {
  timestamp: string | Date;
  level: string;          // INFO, WARN, WARNING, ERROR, FATAL, CRITICAL, DEBUG
  message: string;
  exception?: string;
  correlationId?: string;
  service?: string;
  machine?: string;
  category?: string;      // "startup", "shutdown", "auth_failure", "timeout", "circuit_breaker", "retry"
  stackTrace?: string;
  userId?: string;
}

export interface AppLogsCursor {
  lastTimestamp: string | null;
}

const PARSED_SOURCE = "App.Logs";

const CRITICAL_PATTERNS = [
  /out\s*of\s*memory/i,
  /stack\s*overflow/i,
  /unhandled\s*exception/i,
  /app\s*pool.*recycle/i,
  /process.*crash/i,
  /fatal/i,
  /circuit\s*breaker.*open/i,
];

const WARNING_PATTERNS = [
  /timeout/i,
  /retry/i,
  /connection.*refused/i,
  /auth.*fail/i,
  /login.*fail/i,
  /high\s*memory/i,
  /thread\s*pool.*exhaust/i,
  /slow\s*response/i,
  /degraded/i,
];

function normalizeLevel(raw: string): "info" | "warning" | "error" | "critical" {
  const l = raw.toUpperCase().trim();
  if (l === "FATAL" || l === "CRITICAL") return "critical";
  if (l === "ERROR" || l === "ERR") return "error";
  if (l === "WARN" || l === "WARNING") return "warning";
  return "info";
}

function classifyByContent(msg: string, baseLevel: "info" | "warning" | "error" | "critical"): "info" | "warning" | "error" | "critical" {
  for (const p of CRITICAL_PATTERNS) {
    if (p.test(msg)) return "critical";
  }
  if (baseLevel === "info" || baseLevel === "warning") {
    for (const p of WARNING_PATTERNS) {
      if (p.test(msg)) return "warning";
    }
  }
  return baseLevel;
}

export const appLogsMapper: FeedMapper<AppLogsRawRow, AppLogsCursor> = {
  feed: "appLogs",
  parsedSource: PARSED_SOURCE,
  isCumulative: false,

  map(rows, previousCursor): MapResult<AppLogsCursor> {
    const entries: ParsedLogEntry[] = [];
    const syntheticEvents: ParsedLogEntry[] = [];
    let latestTs: Date | null = null;

    for (const row of rows) {
      const ts = new Date(row.timestamp);
      if (!latestTs || ts > latestTs) latestTs = ts;

      const baseLevel = normalizeLevel(row.level);
      const level = classifyByContent(row.message + (row.exception ?? ""), baseLevel);

      const parts = [
        row.service ? `[${row.service}]` : null,
        row.category ? `(${row.category})` : null,
        row.message,
        row.exception ? `\nException: ${row.exception}` : null,
      ].filter(Boolean);

      entries.push({
        timestamp: ts,
        logLevel: level,
        source: PARSED_SOURCE,
        message: parts.join(" "),
        features: {
          hasException: row.exception ? 1 : 0,
          hasStackTrace: row.stackTrace ? 1 : 0,
        },
      });
    }

    return {
      entries,
      syntheticEvents,
      nextCursor: { lastTimestamp: toIsoString(latestTs) },
    };
  },
};
