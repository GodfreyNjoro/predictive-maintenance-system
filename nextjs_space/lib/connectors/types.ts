/**
 * DB-agnostic connector contract.
 *
 * Each supported DBMS (MSSQL, Postgres, MySQL, Oracle, ...) implements
 * `DbConnector` once. The scheduler / mapper layers above never depend
 * on a specific DBMS — they just dispatch by `DataSource.kind`.
 *
 * Adding a new DBMS is a purely additive operation:
 *   1. Create lib/connectors/<dbms>.ts that implements DbConnector.
 *   2. Call registerConnector() in lib/connectors/index.ts.
 *   3. Add corresponding mappers in lib/mappers/<dbms>/.
 */

import type { DataSource as PrismaDataSource } from "@prisma/client";
import type { ParsedLogEntry } from "../log-parser";

/** The `DbKind` enum mirrored as a TS union for ergonomic typing. */
export type DbmsKind = "MSSQL" | "POSTGRES" | "MYSQL" | "ORACLE";

/**
 * The set of feed identifiers PMS knows how to consume.
 * Not every DBMS implements every feed; `listFeeds()` reports what an
 * adapter can actually produce, and the UI greys-out the rest.
 */
export type FeedId =
  // --- Database-server feeds (pulled by connectors) ---
  | "jobHistory"      // scheduled-job execution history (MSSQL: msdb; Postgres: pg_cron / pgAgent; MySQL: events)
  | "queryStore"      // historical query runtime stats   (MSSQL: Query Store; Postgres: pg_stat_statements; MySQL: perf_schema digests)
  | "spExec"          // stored-procedure execution log   (MSSQL: SP_ExecutionLog/XE; Postgres: pg_stat_user_functions)
  | "waitStats"       // server-wide wait statistics      (MSSQL: dm_os_wait_stats; Postgres: pg_stat_activity wait_event)
  | "ioStats"         // file IO latency                  (MSSQL: dm_io_virtual_file_stats; Postgres: pg_stat_io)
  | "xevents"         // failure events (deadlocks/etc.)  (MSSQL: Extended Events; Postgres: log_destination=csvlog)
  | "osMetrics"       // CPU/RAM/disk derived from DB     (MSSQL: dm_os_performance_counters; Postgres: pg_stat_database)
  | "errorLog"        // server error log                 (MSSQL: ERRORLOG; Postgres: pg_log)
  // --- Application-server feeds (pushed via Edge Collector) ---
  | "appMetrics"      // request throughput, latency, error rate, thread pool (OTel / APM agent)
  | "appLogs"         // structured app logs: exceptions, startup/shutdown, retries (Serilog / NLog / log4net)
  | "windowsEventLog" // Windows Application / System / Security event logs (wevtutil / PowerShell)
  | "iisLogs"         // IIS W3C access logs: status codes, queue length, app pool recycles
  | "networkMetrics"; // network health between app & DB: latency, retransmits, port exhaustion, DNS

/** Logical category, used by the scheduler for retry / cadence policy. */
export type FeedKind = "event" | "interval" | "cumulative";

export interface FeedDescriptor {
  feed: FeedId;
  kind: FeedKind;
  /** Stable string used as `ParsedLog.source`, e.g. "MSSQL.JobHistory". */
  parsedSource: string;
  /** Default cadence for this feed (overridable per DataSource). */
  defaultIntervalSec: number;
  /** Human-readable description for the /data-sources UI. */
  description: string;
  /** True when the feed's runtime requirements are met (e.g. Query Store is enabled). */
  available: boolean;
  /** Reason for unavailability, surfaced on the UI. */
  unavailableReason?: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  serverVersion?: string;
  /** Optional capability map detected during the probe (e.g. queryStoreEnabled). */
  capabilities?: Record<string, boolean | string | number>;
  latencyMs?: number;
}

/**
 * Result of one pull cycle for one feed.
 *
 * `entries` are already in canonical `ParsedLogEntry` shape — the connector
 * is allowed to call its associated mapper directly, OR return raw rows in
 * `rawRows` and let the dispatcher invoke the mapper. The MSSQL adapter we
 * ship with Phase 1 returns canonical `entries`; both paths are supported
 * to keep the contract usable from a thin edge-collector agent later.
 */
export interface PullResult {
  /** Canonical entries ready for ParsedLog persistence and feature extraction. */
  entries: ParsedLogEntry[];
  /** Raw rows fetched (informational; counts toward IngestionRun.rowsFetched). */
  rowsFetched: number;
  /** Cursor to persist on success. */
  nextCursor: unknown;
  /** True when a row cap was hit and the dispatcher should re-pull soon. */
  partial?: boolean;
  /** Synthetic events the mapper emitted (e.g. ServerRestart). */
  syntheticEvents?: ParsedLogEntry[];
  /** Optional human-readable note (surfaces on IngestionRun). */
  note?: string;
}

export interface DbConnector {
  /** Stable identifier, equal to DbKind enum values. */
  readonly kind: DbmsKind;

  /** Quick reachability + auth probe. Should never throw — always return a result. */
  testConnection(ds: PrismaDataSource): Promise<ConnectionTestResult>;

  /**
   * Enumerate feeds this adapter can produce against `ds`. The UI uses this
   * to render available toggles; unavailable feeds carry `unavailableReason`.
   */
  listFeeds(ds: PrismaDataSource): Promise<FeedDescriptor[]>;

  /**
   * Pull one feed since `cursor`. The adapter is responsible for honouring
   * any per-pull row cap (typical: TOP 5000).
   *
   * Implementations MUST be idempotent on cursor failure: if `pull` throws,
   * the dispatcher does NOT advance the watermark and will retry next tick.
   */
  pull(ds: PrismaDataSource, feed: FeedId, cursor: unknown): Promise<PullResult>;

  /** Release any pooled resources. Safe to call multiple times. */
  close(): Promise<void>;
}

/**
 * Helper type the registry uses internally. Adapters are constructed lazily
 * to avoid pulling in heavy DB drivers at app startup.
 */
export type ConnectorFactory = () => DbConnector;
