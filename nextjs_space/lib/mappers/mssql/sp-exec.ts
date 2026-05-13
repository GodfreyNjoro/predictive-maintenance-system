/**
 * MSSQL `spExec` (INSTRUMENTED) mapper.
 *
 * Source: a customer-owned table `dbo.PMS_SP_ExecutionLog` populated by the
 * application layer (or a wrapper SP). DDL is shipped in
 * `scripts/mssql-bootstrap-phase2.sql`.
 *
 * Phase 2 only handles INSTRUMENTED mode — i.e. the SP writes execution
 * outcomes to a dedicated table. Extended-Events mode is reserved for Phase
 * 4 and is rejected at the connector level.
 *
 * Cursor: `{ lastLogId }` (identity column on PMS_SP_ExecutionLog).
 *
 * logLevel mapping:
 *   ErrorNumber NOT NULL    → "error"
 *   DurationMs >= 5000      → "warning" (slow)
 *   otherwise                → "info"
 */

import type { ParsedLogEntry } from "../../log-parser";
import type { FeedMapper, MapResult, MapOptions } from "../types";
import { redactSqlLiterals } from "./redact";

export interface SpExecRawRow {
  LogId: number;
  StartedAt: Date | string;
  FinishedAt: Date | string | null;
  DurationMs: number | null;
  ProcedureName: string | null;
  DatabaseName: string | null;
  SchemaName: string | null;
  RowsAffected: number | null;
  ErrorNumber: number | null;
  ErrorMessage: string | null;
  ParametersJson: string | null;
  ServerName: string | null;
}

export interface SpExecCursor {
  lastLogId: number;
}

export const PARSED_SOURCE = "MSSQL.SpExec";

/** A long execution worth a "warning" badge — 5 seconds. Tunable later. */
const SLOW_DURATION_MS = 5000;

export const spExecMapper: FeedMapper<SpExecRawRow, SpExecCursor> = {
  feed: "spExec",
  parsedSource: PARSED_SOURCE,
  isCumulative: false,
  map(rows, previousCursor, opts) {
    const cursor: SpExecCursor = {
      lastLogId: previousCursor?.lastLogId ?? 0,
    };

    const entries: ParsedLogEntry[] = [];
    let skipped = 0;

    for (const row of rows) {
      try {
        const entry = mapRow(row, opts);
        if (entry) {
          entries.push(entry);
          if (typeof row.LogId === "number" && row.LogId > cursor.lastLogId) {
            cursor.lastLogId = row.LogId;
          }
        } else {
          skipped++;
        }
      } catch {
        skipped++;
      }
    }

    const result: MapResult<SpExecCursor> = {
      entries,
      syntheticEvents: [],
      nextCursor: cursor,
    };
    if (skipped > 0) result.note = `${skipped} row(s) skipped due to malformed data`;
    return result;
  },
};

function mapRow(row: SpExecRawRow, opts: MapOptions | undefined): ParsedLogEntry | null {
  if (typeof row.LogId !== "number") return null;

  const startedAt = coerceDate(row.StartedAt) ?? new Date();
  const durationMs = numericOr(row.DurationMs, 0);
  const errorNumber = row.ErrorNumber == null ? null : Number(row.ErrorNumber);
  const procName =
    [row.DatabaseName, row.SchemaName, row.ProcedureName]
      .filter((p): p is string => !!p && typeof p === "string" && p.trim().length > 0)
      .join(".") || "<unknown_proc>";

  const logLevel = pickLogLevel(errorNumber, durationMs);
  let errMsg = (row.ErrorMessage ?? "").trim();
  if (opts?.redactSqlText && errMsg) errMsg = redactSqlLiterals(errMsg);

  const messageParts = [
    `SP ${procName}`,
    errorNumber != null ? `failed (error ${errorNumber})` : "completed",
    `in ${formatMs(durationMs)}`,
  ];
  if (typeof row.RowsAffected === "number" && row.RowsAffected >= 0) {
    messageParts.push(`rows_affected=${row.RowsAffected}`);
  }
  if (errMsg) messageParts.push(`— ${errMsg.slice(0, 400)}`);

  const entry: ParsedLogEntry = {
    timestamp: startedAt,
    logLevel,
    source: PARSED_SOURCE,
    message: messageParts.join(" "),
    rawData: JSON.stringify({
      LogId: row.LogId,
      ProcedureName: row.ProcedureName ?? null,
      DatabaseName: row.DatabaseName ?? null,
      SchemaName: row.SchemaName ?? null,
      DurationMs: durationMs,
      RowsAffected: row.RowsAffected ?? null,
      ErrorNumber: errorNumber,
      StartedAt: startedAt.toISOString(),
      FinishedAt: coerceDate(row.FinishedAt)?.toISOString() ?? null,
      ServerName: row.ServerName ?? null,
      // ParametersJson is intentionally excluded by default — it can carry PII.
      hasParameters: !!row.ParametersJson,
    }),
  };

  entry.features = {
    durationMs,
    isFailure: errorNumber != null ? 1 : 0,
    isSlow: durationMs >= SLOW_DURATION_MS ? 1 : 0,
    rowsAffected: numericOr(row.RowsAffected, 0),
  };

  return entry;
}

function pickLogLevel(errorNumber: number | null, durationMs: number): string {
  if (errorNumber != null && Number.isFinite(errorNumber) && errorNumber !== 0) return "error";
  if (durationMs >= SLOW_DURATION_MS) return "warning";
  return "info";
}

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0ms";
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = (s - m * 60).toFixed(0);
  return `${m}m${rem}s`;
}

function numericOr(v: unknown, fallback: number): number {
  if (v == null) return fallback;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function coerceDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
