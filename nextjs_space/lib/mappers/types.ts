/**
 * Shared mapper contract.
 *
 * A mapper is a *pure* function from (raw rows + previous cursor) to canonical
 * `ParsedLogEntry[]` + a fresh cursor. Mappers contain ZERO IO — the connector
 * does the database work; the mapper does the shape work. This separation
 * lets us reuse the same mapper from a future edge-collector agent without
 * touching the schema.
 */

import type { ParsedLogEntry } from "../log-parser";
import type { FeedId } from "../connectors/types";

export interface MapResult<TCursor> {
  /** Canonical entries ready for ParsedLog persistence. */
  entries: ParsedLogEntry[];
  /** Synthetic events the mapper inferred (e.g. ServerRestart on cumulative-counter rollback). */
  syntheticEvents: ParsedLogEntry[];
  /** Cursor to persist on success — callers MUST treat this as opaque. */
  nextCursor: TCursor;
  /** Optional human-readable note, surfaces on IngestionRun. */
  note?: string;
}

export interface FeedMapper<TRaw, TCursor> {
  /** Stable feed identifier shared with the connector. */
  feed: FeedId;
  /** ParsedLog.source string, e.g. "MSSQL.JobHistory". */
  parsedSource: string;
  /** Whether this feed needs delta logic (see lib/mappers/cumulative.ts in later phases). */
  isCumulative: boolean;
  /** Pure transform. MUST NOT throw — invalid rows should be skipped & logged via `note`. */
  map(rows: TRaw[], previousCursor: TCursor | null, opts?: MapOptions): MapResult<TCursor>;
}

export interface MapOptions {
  /** When true, scrub anything that looks like a SQL string literal from `message`. */
  redactSqlText?: boolean;
  /** Optional clock override for tests. */
  now?: () => Date;
}
