/**
 * MSSQL `xevents` mapper.
 *
 * Source: Extended Events ring buffer or `.xel` file targets.
 *
 * XE sessions capture discrete failure events — deadlocks, query timeouts,
 * login failures, long-running queries, errors above a severity threshold.
 * Unlike cumulative DMVs, each event is already a point-in-time record, so
 * the mapper is event-based (not cumulative). The cursor tracks the last
 * seen `event_timestamp` to support incremental pulls.
 *
 * Cursor shape (opaque to callers):
 *   {
 *     lastEventTimestamp: ISO string | null,
 *     lastFileName: string | null,      // .xel file-target only
 *     lastFileOffset: number | null      // .xel file-target only
 *   }
 *
 * Emission semantics:
 *   - One `ParsedLogEntry` per XE event, source = `MSSQL.XEvents`.
 *   - logLevel:
 *       `critical`  → deadlock, severity >= 20
 *       `error`     → error events (severity 11-19), query timeouts
 *       `warning`   → long-running queries (>5s), login failures
 *       `info`      → everything else
 *   - Synthetic sub-source events:
 *       `MSSQL.XEvents.Deadlock`       → deadlock_xml or xml_deadlock_report
 *       `MSSQL.XEvents.QueryTimeout`   → query_timeout or attention
 *       `MSSQL.XEvents.LongRunning`    → query_post_execution_showplan (> threshold)
 *       `MSSQL.XEvents.Error`          → error_reported
 *       `MSSQL.XEvents.LoginFailure`   → login_failed
 */

import type { ParsedLogEntry } from "../../log-parser";
import type { FeedMapper, MapResult, MapOptions } from "../types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface XEventsRawRow {
  event_name: string;
  event_timestamp: Date | string;
  event_data_xml: string | null;  // full XML payload
  // Pre-extracted fields the connector shreds from XML or ring_buffer
  session_id?: number | null;
  database_name?: string | null;
  sql_text?: string | null;
  username?: string | null;
  client_hostname?: string | null;
  duration_ms?: number | null;
  severity?: number | null;
  error_number?: number | null;
  error_message?: string | null;
  wait_type?: string | null;
  wait_resource?: string | null;
  deadlock_xml?: string | null;
  object_name?: string | null;
  server?: string | null;
  /** File-target bookmarks — null when reading from ring_buffer. */
  file_name?: string | null;
  file_offset?: number | null;
}

export interface XEventsCursor {
  lastEventTimestamp: string | null;
  lastFileName: string | null;
  lastFileOffset: number | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PARSED_SOURCE = "MSSQL.XEvents";

/** Deadlock event names from various XE sessions. */
const DEADLOCK_EVENTS = new Set([
  "xml_deadlock_report",
  "deadlock_report",
  "lock_deadlock",
  "lock_deadlock_chain",
]);

const TIMEOUT_EVENTS = new Set([
  "query_timeout",
  "attention",           // client-side cancel / query timeout
  "rpc_completed",       // when result = 2 (abort)
]);

const LOGIN_FAILURE_EVENTS = new Set([
  "login_failed",
  "connectivity_ring_buffer_recorded",
]);

const ERROR_EVENTS = new Set([
  "error_reported",
  "errorlog_written",
]);

const LONG_QUERY_EVENTS = new Set([
  "query_post_execution_showplan",
  "sql_batch_completed",
  "rpc_completed",
  "sp_statement_completed",
]);

/** Duration threshold in ms to flag a query as "long-running". */
const LONG_QUERY_THRESHOLD_MS = 5_000;

// ---------------------------------------------------------------------------
// Mapper implementation
// ---------------------------------------------------------------------------

function mapXEvents(
  rows: XEventsRawRow[],
  previousCursor: XEventsCursor | null,
  opts?: MapOptions,
): MapResult<XEventsCursor> {
  const entries: ParsedLogEntry[] = [];
  const syntheticEvents: ParsedLogEntry[] = [];

  let latestTimestamp = previousCursor?.lastEventTimestamp ?? null;
  let latestFileName = previousCursor?.lastFileName ?? null;
  let latestFileOffset = previousCursor?.lastFileOffset ?? null;

  for (const row of rows) {
    const ts = toTimestamp(row.event_timestamp);
    if (!ts) continue;

    // Advance cursor bookmarks
    if (!latestTimestamp || ts > latestTimestamp) latestTimestamp = ts;
    if (row.file_name) latestFileName = row.file_name;
    if (typeof row.file_offset === "number") latestFileOffset = row.file_offset;

    const classification = classifyEvent(row);
    const message = buildMessage(row, classification, opts);

    const entry: ParsedLogEntry = {
      timestamp: new Date(ts),
      logLevel: classification.logLevel,
      source: PARSED_SOURCE,
      message,
      rawData: JSON.stringify({
        eventName: row.event_name,
        subSource: classification.subSource,
        database: row.database_name ?? undefined,
        sessionId: row.session_id ?? undefined,
        username: row.username ?? undefined,
        clientHostname: row.client_hostname ?? undefined,
        durationMs: row.duration_ms ?? undefined,
        severity: row.severity ?? undefined,
        errorNumber: row.error_number ?? undefined,
        objectName: row.object_name ?? undefined,
        waitType: row.wait_type ?? undefined,
        waitResource: row.wait_resource ?? undefined,
        hasDeadlockXml: !!row.deadlock_xml,
        server: row.server ?? undefined,
      }),
      features: {
        durationMs: row.duration_ms ?? 0,
        severity: row.severity ?? 0,
        isDeadlock: classification.isDeadlock ? 1 : 0,
        isTimeout: classification.isTimeout ? 1 : 0,
        isLoginFailure: classification.isLoginFailure ? 1 : 0,
        isError: classification.isError ? 1 : 0,
      },
    };

    entries.push(entry);
  }

  return {
    entries,
    syntheticEvents,
    nextCursor: {
      lastEventTimestamp: latestTimestamp,
      lastFileName: latestFileName,
      lastFileOffset: latestFileOffset,
    },
    note: entries.length === 0 ? "No new XE events in this window." : undefined,
  };
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

interface EventClassification {
  logLevel: "info" | "warning" | "error" | "critical";
  subSource: string;
  isDeadlock: boolean;
  isTimeout: boolean;
  isLoginFailure: boolean;
  isError: boolean;
  isLongQuery: boolean;
}

function classifyEvent(row: XEventsRawRow): EventClassification {
  const name = (row.event_name ?? "").toLowerCase();
  const severity = row.severity ?? 0;

  // Deadlocks
  if (DEADLOCK_EVENTS.has(name) || !!row.deadlock_xml) {
    return {
      logLevel: "critical",
      subSource: "MSSQL.XEvents.Deadlock",
      isDeadlock: true,
      isTimeout: false,
      isLoginFailure: false,
      isError: false,
      isLongQuery: false,
    };
  }

  // Query timeouts / attention events
  if (TIMEOUT_EVENTS.has(name) && (name === "attention" || name === "query_timeout")) {
    return {
      logLevel: "error",
      subSource: "MSSQL.XEvents.QueryTimeout",
      isDeadlock: false,
      isTimeout: true,
      isLoginFailure: false,
      isError: false,
      isLongQuery: false,
    };
  }

  // Login failures
  if (LOGIN_FAILURE_EVENTS.has(name)) {
    return {
      logLevel: "warning",
      subSource: "MSSQL.XEvents.LoginFailure",
      isDeadlock: false,
      isTimeout: false,
      isLoginFailure: true,
      isError: false,
      isLongQuery: false,
    };
  }

  // Error events
  if (ERROR_EVENTS.has(name) || severity >= 11) {
    const level: "critical" | "error" = severity >= 20 ? "critical" : "error";
    return {
      logLevel: level,
      subSource: "MSSQL.XEvents.Error",
      isDeadlock: false,
      isTimeout: false,
      isLoginFailure: false,
      isError: true,
      isLongQuery: false,
    };
  }

  // Long-running queries
  if (
    LONG_QUERY_EVENTS.has(name) &&
    typeof row.duration_ms === "number" &&
    row.duration_ms > LONG_QUERY_THRESHOLD_MS
  ) {
    return {
      logLevel: "warning",
      subSource: "MSSQL.XEvents.LongRunning",
      isDeadlock: false,
      isTimeout: false,
      isLoginFailure: false,
      isError: false,
      isLongQuery: true,
    };
  }

  // Default — info
  return {
    logLevel: "info",
    subSource: PARSED_SOURCE,
    isDeadlock: false,
    isTimeout: false,
    isLoginFailure: false,
    isError: false,
    isLongQuery: false,
  };
}

// ---------------------------------------------------------------------------
// Message builder
// ---------------------------------------------------------------------------

function buildMessage(
  row: XEventsRawRow,
  classification: EventClassification,
  opts?: MapOptions,
): string {
  const parts: string[] = [];

  if (classification.isDeadlock) {
    parts.push(`Deadlock detected`);
    if (row.database_name) parts.push(`in [${row.database_name}]`);
    if (row.wait_resource) parts.push(`— resource: ${row.wait_resource}`);
    return parts.join(" ");
  }

  if (classification.isTimeout) {
    parts.push(`Query timeout`);
    if (row.duration_ms) parts.push(`after ${row.duration_ms}ms`);
    if (row.database_name) parts.push(`in [${row.database_name}]`);
    if (row.sql_text && !opts?.redactSqlText) {
      parts.push(`— ${truncate(row.sql_text, 200)}`);
    }
    return parts.join(" ");
  }

  if (classification.isLoginFailure) {
    parts.push(`Login failed`);
    if (row.username) parts.push(`for '${row.username}'`);
    if (row.client_hostname) parts.push(`from ${row.client_hostname}`);
    if (row.error_message) parts.push(`— ${row.error_message}`);
    return parts.join(" ");
  }

  if (classification.isError) {
    parts.push(`Error ${row.error_number ?? ""} (severity ${row.severity ?? "?"})`);
    if (row.error_message) parts.push(`— ${truncate(row.error_message, 300)}`);
    if (row.database_name) parts.push(`in [${row.database_name}]`);
    return parts.join(" ");
  }

  if (classification.isLongQuery) {
    parts.push(`Long-running query (${row.duration_ms}ms)`);
    if (row.database_name) parts.push(`in [${row.database_name}]`);
    if (row.object_name) parts.push(`— ${row.object_name}`);
    if (row.sql_text && !opts?.redactSqlText) {
      parts.push(`— ${truncate(row.sql_text, 200)}`);
    }
    return parts.join(" ");
  }

  // Generic fallback
  parts.push(`XE event '${row.event_name}'`);
  if (row.database_name) parts.push(`in [${row.database_name}]`);
  if (row.error_message) parts.push(`— ${truncate(row.error_message, 200)}`);
  return parts.join(" ");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
}

function toTimestamp(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const xeventsMapper: FeedMapper<XEventsRawRow, XEventsCursor> = {
  feed: "xevents",
  parsedSource: PARSED_SOURCE,
  isCumulative: false,
  map: mapXEvents,
};
