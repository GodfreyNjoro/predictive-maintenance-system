/**
 * MSSQL `jobHistory` mapper.
 *
 * Source: `msdb.dbo.sysjobhistory` joined to `sysjobs` and `sysjobsteps`.
 * Output: one canonical `ParsedLogEntry` per row, tagged `MSSQL.JobHistory`.
 *
 * Cursor: `{ lastInstanceId }` — monotonically increasing identity column on
 * sysjobhistory. The connector pulls `WHERE instance_id > @lastInstanceId
 * ORDER BY instance_id ASC TOP 5000`, so the mapper just records the max id
 * it observed.
 */

import type { ParsedLogEntry } from "../../log-parser";
import type { FeedMapper, MapResult, MapOptions } from "../types";

export interface JobHistoryRawRow {
  instance_id: number;
  job_name: string | null;
  job_id?: string | null;
  step_id: number;
  step_name: string | null;
  command?: string | null;
  run_status: number;          // 0 Failed | 1 Succeeded | 2 Retry | 3 Canceled | 4 InProgress
  run_duration: number;        // HHMMSS as integer (e.g. 130 = 1m30s)
  run_dt: Date | string | null; // agent_datetime(run_date, run_time) — driver returns Date
  message: string | null;
  server?: string | null;
}

export interface JobHistoryCursor {
  lastInstanceId: number;
}

export const PARSED_SOURCE = "MSSQL.JobHistory";

export const jobHistoryMapper: FeedMapper<JobHistoryRawRow, JobHistoryCursor> = {
  feed: "jobHistory",
  parsedSource: PARSED_SOURCE,
  isCumulative: false,
  map(rows, previousCursor, opts) {
    const cursor: JobHistoryCursor = {
      lastInstanceId: previousCursor?.lastInstanceId ?? 0,
    };

    const entries: ParsedLogEntry[] = [];
    let skipped = 0;

    for (const row of rows) {
      try {
        const entry = mapRow(row, opts);
        if (entry) {
          entries.push(entry);
          if (typeof row.instance_id === "number" && row.instance_id > cursor.lastInstanceId) {
            cursor.lastInstanceId = row.instance_id;
          }
        } else {
          skipped++;
        }
      } catch {
        // Defensive: a single bad row must not poison the whole batch.
        skipped++;
      }
    }

    const result: MapResult<JobHistoryCursor> = {
      entries,
      syntheticEvents: [],
      nextCursor: cursor,
    };
    if (skipped > 0) {
      result.note = `${skipped} row(s) skipped due to malformed data`;
    }
    return result;
  },
};

function mapRow(row: JobHistoryRawRow, opts: MapOptions | undefined): ParsedLogEntry | null {
  if (typeof row.instance_id !== "number") return null;

  // step_id = 0 is the job-summary row; step_id > 0 are individual step rows.
  const isSummary = row.step_id === 0;
  const jobName = (row.job_name ?? "<unknown-job>").trim();
  const stepName = isSummary ? "<job summary>" : (row.step_name ?? `step ${row.step_id}`);
  const outcome = runStatusLabel(row.run_status);
  const durationStr = formatRunDuration(row.run_duration);
  const ts = coerceDate(row.run_dt) ?? new Date();

  // Render the message and (optionally) redact embedded SQL string literals.
  // We always include the SQL Agent error text — it's the highest-signal field.
  let messagePayload = (row.message ?? "").toString().trim();
  if (opts?.redactSqlText && messagePayload) {
    messagePayload = redactSqlLiterals(messagePayload);
  }

  const messageParts = [
    `Job '${jobName}'`,
    isSummary ? "summary" : `step ${row.step_id} '${stepName}'`,
    outcome,
    `in ${durationStr}`,
  ];
  if (messagePayload) messageParts.push(`— ${messagePayload}`);

  const entry: ParsedLogEntry = {
    timestamp: ts,
    logLevel: runStatusToLogLevel(row.run_status, isSummary),
    source: PARSED_SOURCE,
    message: messageParts.join(" "),
    rawData: JSON.stringify({
      instance_id: row.instance_id,
      job_id: row.job_id ?? null,
      job_name: jobName,
      step_id: row.step_id,
      step_name: row.step_name ?? null,
      run_status: row.run_status,
      run_status_label: outcome,
      run_duration_seconds: runDurationSeconds(row.run_duration),
      run_dt: ts.toISOString(),
      server: row.server ?? null,
    }),
  };

  // We piggy-back numeric features so the predictor sees them without parsing the message.
  entry.features = {
    durationSec: runDurationSeconds(row.run_duration),
    isFailure: row.run_status === 0 ? 1 : 0,
    isRetry: row.run_status === 2 ? 1 : 0,
    isCancel: row.run_status === 3 ? 1 : 0,
    stepId: row.step_id,
  };

  return entry;
}

/** Map SQL Agent run_status to PMS canonical log level. */
function runStatusToLogLevel(status: number, _isSummary: boolean): string {
  switch (status) {
    case 0:
      return "error";
    case 2:
      return "warning";
    case 3:
      return "warning";
    case 1:
    case 4:
    default:
      return "info";
  }
}

function runStatusLabel(status: number): string {
  switch (status) {
    case 0: return "Failed";
    case 1: return "Succeeded";
    case 2: return "Retry";
    case 3: return "Canceled";
    case 4: return "In progress";
    default: return `Unknown(${status})`;
  }
}

/**
 * SQL Agent stores run_duration as the integer HHMMSS (e.g. 10130 = 1h 1m 30s).
 * We convert it to total seconds (lossless) and to a short human string.
 */
function runDurationSeconds(d: number | null | undefined): number {
  if (typeof d !== "number" || !Number.isFinite(d) || d < 0) return 0;
  const ss = d % 100;
  const mm = Math.floor(d / 100) % 100;
  const hh = Math.floor(d / 10000);
  return hh * 3600 + mm * 60 + ss;
}

function formatRunDuration(d: number | null | undefined): string {
  const total = runDurationSeconds(d);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m < 60) return `${m}m${s}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h${mm}m${s}s`;
}

function coerceDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Conservative SQL-literal redactor used when DataSource.redactSqlText is true.
 * Scrubs `'...'` and `N'...'` payloads in error text. Not a full SQL parser —
 * good enough to reduce PII leakage in audit messages.
 */
function redactSqlLiterals(s: string): string {
  return s
    .replace(/N'([^']|'')*'/g, "N'…'")
    .replace(/'([^']|'')*'/g, "'…'");
}
