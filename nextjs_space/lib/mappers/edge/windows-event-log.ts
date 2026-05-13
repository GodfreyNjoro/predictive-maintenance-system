/**
 * Windows Event Log mapper (`windowsEventLog` feed).
 *
 * Source: Edge collector agent on the APPLICATION or DB server.
 * Reads Windows Application / System / Security event logs via
 * wevtutil, PowerShell Get-WinEvent, or WMI.
 *
 * Raw row shape (pushed by edge collector):
 *   { eventId, level, logName, source, message, timeCreated, machineName?,
 *     category?, userId?, providerName? }
 *
 * Cursor shape: { lastRecordId: number | null }
 */

import type { ParsedLogEntry } from "../../log-parser";
import type { FeedMapper, MapResult } from "../types";

export interface WindowsEventLogRawRow {
  eventId: number;
  level: string;            // "Information", "Warning", "Error", "Critical"
  logName: string;          // "Application", "System", "Security"
  source: string;           // e.g. ".NET Runtime", "W3SVC", "Service Control Manager"
  message: string;
  timeCreated: string | Date;
  machineName?: string;
  category?: string;
  userId?: string;
  providerName?: string;
  recordId?: number;
}

export interface WindowsEventLogCursor {
  lastRecordId: number | null;
}

const PARSED_SOURCE = "Windows.EventLog";

// High-value event IDs for prediction
const CRITICAL_EVENT_IDS = new Set([
  1000, 1026, // .NET Runtime crashes
  7034, 7031, // Service crashed / terminated unexpectedly
  5001, 5002, // App pool failure, worker process crash
  6008,       // Unexpected shutdown
  41,         // Kernel-Power (unexpected reboot)
  1001,       // Windows Error Reporting (BugCheck)
]);

const WARNING_EVENT_IDS = new Set([
  5010, 5011, 5012, 5013, // IIS app pool events
  5117, 5186,             // App pool recycle
  2004, 2003,             // Resource exhaustion
  36888, 36887,           // Schannel TLS errors
  1008,                   // Performance counter issue
]);

const CRITICAL_SOURCE_PATTERNS = [
  /\.NET Runtime/i,
  /Application Error/i,
  /Windows Error Reporting/i,
  /BugCheck/i,
];

function normalizeWinLevel(raw: string): "info" | "warning" | "error" | "critical" {
  const l = raw.toLowerCase().trim();
  if (l === "critical") return "critical";
  if (l === "error") return "error";
  if (l === "warning") return "warning";
  return "info";
}

function classifyEvent(row: WindowsEventLogRawRow): "info" | "warning" | "error" | "critical" {
  if (CRITICAL_EVENT_IDS.has(row.eventId)) return "critical";
  if (WARNING_EVENT_IDS.has(row.eventId)) return "warning";
  for (const p of CRITICAL_SOURCE_PATTERNS) {
    if (p.test(row.source) && (row.level === "Error" || row.level === "Critical")) return "critical";
  }
  return normalizeWinLevel(row.level);
}

export const windowsEventLogMapper: FeedMapper<WindowsEventLogRawRow, WindowsEventLogCursor> = {
  feed: "windowsEventLog",
  parsedSource: PARSED_SOURCE,
  isCumulative: false,

  map(rows, previousCursor): MapResult<WindowsEventLogCursor> {
    const entries: ParsedLogEntry[] = [];
    const syntheticEvents: ParsedLogEntry[] = [];
    let maxRecordId = previousCursor?.lastRecordId ?? 0;

    for (const row of rows) {
      const ts = new Date(row.timeCreated);
      const level = classifyEvent(row);
      if (row.recordId && row.recordId > maxRecordId) maxRecordId = row.recordId;

      entries.push({
        timestamp: ts,
        logLevel: level,
        source: PARSED_SOURCE,
        message: `[${row.logName}/${row.source}] EventID=${row.eventId}: ${row.message.slice(0, 500)}`,
        features: {
          eventId: row.eventId,
        },
      });
    }

    // Count critical/error for synthetic summary
    const critCount = entries.filter((e) => e.logLevel === "critical").length;
    const errCount = entries.filter((e) => e.logLevel === "error").length;
    if (critCount + errCount > 0) {
      syntheticEvents.push({
        timestamp: new Date(),
        logLevel: critCount > 0 ? "critical" : "error",
        source: PARSED_SOURCE,
        message: `Windows Event Log: ${critCount} critical + ${errCount} error events out of ${entries.length} total.`,
      });
    }

    return {
      entries,
      syntheticEvents,
      nextCursor: { lastRecordId: maxRecordId },
    };
  },
};
