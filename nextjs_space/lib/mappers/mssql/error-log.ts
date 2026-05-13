/**
 * MSSQL `errorLog` mapper.
 *
 * Source: `sp_readerrorlog` — reads the SQL Server ERRORLOG file(s).
 *
 * The ERRORLOG is a text-based log that SQL Server writes to for server-level
 * events: startup, shutdown, backup operations, severity >= 19 errors,
 * configuration changes, memory/IO warnings.
 *
 * The mapper operates in event mode (not cumulative). The cursor tracks the
 * last-seen `log_date` to avoid re-ingesting the same rows.
 *
 * Cursor shape (opaque to callers):
 *   { lastLogDate: ISO string | null }
 *
 * Emission semantics:
 *   - One `ParsedLogEntry` per ERRORLOG line, source = `MSSQL.ErrorLog`.
 *   - logLevel:
 *       `critical`  → severity keywords: "stack dump", "fatal", "corrupted"
 *       `error`     → "error", "fail", "cannot", "could not"
 *       `warning`   → "warning", "suspect", "insufficient"
 *       `info`      → everything else (startup messages, backup success, etc.)
 */

import type { ParsedLogEntry } from "../../log-parser";
import type { FeedMapper, MapResult, MapOptions } from "../types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ErrorLogRawRow {
  LogDate: Date | string;
  ProcessInfo: string | null;  // e.g. "spid52", "Server", "Logon"
  Text: string;
  server?: string | null;
}

export interface ErrorLogCursor {
  lastLogDate: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PARSED_SOURCE = "MSSQL.ErrorLog";

/** Patterns that indicate critical severity. Case-insensitive. */
const CRITICAL_PATTERNS = [
  /stack\s*dump/i,
  /\bfatal\b/i,
  /\bcorrupt(ed|ion)?\b/i,
  /\bpanic\b/i,
  /access\s+violation/i,
  /severity:\s*(2[0-9]|[3-9][0-9])/i,   // severity >= 20
];

/** Patterns that indicate error level. */
const ERROR_PATTERNS = [
  /\berror\b/i,
  /\bfail(ed|ure)?\b/i,
  /\bcannot\b/i,
  /\bcould\s+not\b/i,
  /\bdenied\b/i,
  /\btimeout\b/i,
  /\bdeadlock\b/i,
  /severity:\s*(1[1-9])/i,               // severity 11-19
];

/** Patterns that indicate warning level. */
const WARNING_PATTERNS = [
  /\bwarning\b/i,
  /\bsuspect\b/i,
  /\binsufficient\b/i,
  /\bretry/i,
  /\bslow\b/i,
  /\bgrowing\b/i,
  /auto-?grow/i,
];

// ---------------------------------------------------------------------------
// Mapper implementation
// ---------------------------------------------------------------------------

function mapErrorLog(
  rows: ErrorLogRawRow[],
  previousCursor: ErrorLogCursor | null,
  _opts?: MapOptions,
): MapResult<ErrorLogCursor> {
  const entries: ParsedLogEntry[] = [];
  let latestLogDate = previousCursor?.lastLogDate ?? null;

  for (const row of rows) {
    const ts = toTimestamp(row.LogDate);
    if (!ts) continue;

    const text = (row.Text ?? "").trim();
    if (!text) continue;

    // Skip noise lines
    if (isNoiseLine(text)) continue;

    // Advance cursor
    if (!latestLogDate || ts > latestLogDate) latestLogDate = ts;

    const level = classifyLevel(text);
    const processInfo = (row.ProcessInfo ?? "").trim();

    const entry: ParsedLogEntry = {
      timestamp: new Date(ts),
      logLevel: level,
      source: PARSED_SOURCE,
      message: text,
      rawData: JSON.stringify({
        processInfo: processInfo || undefined,
        server: row.server ?? undefined,
      }),
      features: {
        isCritical: level === "critical" ? 1 : 0,
        isError: level === "error" ? 1 : 0,
        isWarning: level === "warning" ? 1 : 0,
        textLength: text.length,
      },
    };

    entries.push(entry);
  }

  return {
    entries,
    syntheticEvents: [],
    nextCursor: { lastLogDate: latestLogDate },
    note: entries.length === 0 ? "No new ERRORLOG entries." : undefined,
  };
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function classifyLevel(text: string): "info" | "warning" | "error" | "critical" {
  for (const p of CRITICAL_PATTERNS) {
    if (p.test(text)) return "critical";
  }
  for (const p of ERROR_PATTERNS) {
    if (p.test(text)) return "error";
  }
  for (const p of WARNING_PATTERNS) {
    if (p.test(text)) return "warning";
  }
  return "info";
}

/** Filter out common noise lines that add no diagnostic value. */
function isNoiseLine(text: string): boolean {
  // Informational copyright / version lines
  if (/^\(c\)\s+\d{4}\s+Microsoft/i.test(text)) return true;
  if (/^Microsoft SQL Server \d{4}/i.test(text)) return true;
  // Blank or whitespace-only after trim
  if (text.length === 0) return true;
  // "Using 'dbghelp.dll' version ..." — internal debug info
  if (/Using\s+'dbghelp\.dll'/i.test(text)) return true;
  return false;
}

function toTimestamp(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const errorLogMapper: FeedMapper<ErrorLogRawRow, ErrorLogCursor> = {
  feed: "errorLog",
  parsedSource: PARSED_SOURCE,
  isCumulative: false,
  map: mapErrorLog,
};
