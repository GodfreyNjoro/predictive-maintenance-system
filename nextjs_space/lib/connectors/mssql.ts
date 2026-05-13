/**
 * MSSQL connector adapter.
 *
 * Implements the DB-agnostic `DbConnector` contract for Microsoft SQL Server,
 * using the `mssql` (tedious) driver. Phase 1 ships only `pull("jobHistory")` —
 * every other feed is enumerated by `listFeeds()` but reported as unavailable
 * with a clear `unavailableReason`. Subsequent phases unlock them additively
 * by registering the corresponding mapper in `lib/mappers/mssql/index.ts` and
 * adding the SQL probe here.
 *
 * Responsibilities (Phase 1):
 *  - testConnection: reachability + auth probe, returns serverVersion + lightweight capability map.
 *  - listFeeds:      describe what we _can_ pull; mark unsupported feeds disabled.
 *  - pull:           jobHistory only. TOP 5000 cap, cursor = lastInstanceId.
 *  - close:          drain pooled connections; idempotent.
 *
 * Notes:
 *  - This module ALWAYS resolves DSN secrets via `lib/datasource/secrets.ts`.
 *    Never log plaintext credentials.
 *  - Connection pool is per-DataSource and lazy. We do NOT keep idle pools
 *    around indefinitely — `close()` releases everything.
 *  - All error paths must be safe: `testConnection` never throws; `pull`
 *    throws so the dispatcher does not advance the watermark.
 */

import sql from "mssql";
import type { DataSource as PrismaDataSource } from "@prisma/client";

import {
  type ConnectionTestResult,
  type DbConnector,
  type FeedDescriptor,
  type FeedId,
  type PullResult,
} from "./types";
import { registerConnector } from "./index";
import { decryptDataSource, redactForLog } from "../datasource/secrets";
import { getMssqlMapper } from "../mappers/mssql";
import {
  jobHistoryMapper,
  type JobHistoryCursor,
  type JobHistoryRawRow,
} from "../mappers/mssql/job-history";
import {
  queryStoreMapper,
  type QueryStoreCursor,
  type QueryStoreRawRow,
} from "../mappers/mssql/query-store";
import {
  spExecMapper,
  type SpExecCursor,
  type SpExecRawRow,
} from "../mappers/mssql/sp-exec";
import {
  waitStatsMapper,
  type WaitStatsCursor,
  type WaitStatsCursorRow,
  type WaitStatsRawRow,
} from "../mappers/mssql/wait-stats";
import {
  ioStatsMapper,
  type IoStatsCursor,
  type IoStatsCursorRow,
  type IoStatsRawRow,
} from "../mappers/mssql/io-stats";
import {
  xeventsMapper,
  type XEventsCursor,
  type XEventsRawRow,
} from "../mappers/mssql/xevents";
import {
  errorLogMapper,
  type ErrorLogCursor,
  type ErrorLogRawRow,
} from "../mappers/mssql/error-log";

/** Default per-pull row cap. Keeps pulls bounded; `partial=true` forces a fast retry. */
const PULL_ROW_CAP = 5000;

/** Connection / request timeouts. Generous enough for slow VPN links, tight enough to fail fast. */
const CONNECT_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 30_000;

/** Pool sizing — each DataSource gets at most a couple of concurrent connections. */
const POOL_MIN = 0;
const POOL_MAX = 2;
const POOL_IDLE_TIMEOUT_MS = 30_000;

/** Optional connectionParams shape (extras passed through DataSource.connectionParams). */
interface MssqlConnectionParams {
  /** Named instance, e.g. "SQL2K22". When set we omit the port and use `\\<instance>` syntax. */
  instance?: string;
  /** AlwaysOn read-only routing hint. */
  applicationIntent?: "ReadOnly" | "ReadWrite";
  /** Windows domain — required for WINDOWS_AUTH (NTLM). */
  domain?: string;
  /** Encrypt connection (defaults true). Set to false for legacy on-prem servers without TLS. */
  encrypt?: boolean;
}

export class MssqlConnector implements DbConnector {
  public readonly kind = "MSSQL" as const;

  /**
   * Cache of pools keyed by DataSource id. The `updatedAt` of the row is
   * NOT tracked here — operator UI calls `close()` after editing a source.
   */
  private readonly pools = new Map<string, sql.ConnectionPool>();

  // ---------------------------------------------------------------------------
  // Public DbConnector surface
  // ---------------------------------------------------------------------------

  async testConnection(ds: PrismaDataSource): Promise<ConnectionTestResult> {
    const startedAt = Date.now();
    try {
      const pool = await this.getPool(ds);
      const versionRow = await pool
        .request()
        .query<{ version: string; servername: string }>(
          "SELECT @@VERSION AS version, @@SERVERNAME AS servername",
        );
      const version = versionRow.recordset[0]?.version ?? "unknown";
      const serverName = versionRow.recordset[0]?.servername ?? null;
      const capabilities = await this.probeCapabilities(pool);
      return {
        ok: true,
        message: serverName ? `Connected to ${serverName}` : "Connected",
        serverVersion: shortenVersion(version),
        capabilities,
        latencyMs: Date.now() - startedAt,
      };
    } catch (err) {
      // testConnection is contractually no-throw.
      return {
        ok: false,
        message: errorMessage(err),
        latencyMs: Date.now() - startedAt,
      };
    }
  }

  async listFeeds(ds: PrismaDataSource): Promise<FeedDescriptor[]> {
    // Phase 1 + 2 + 3 probe results. We check msdb (jobHistory), Query Store
    // state (queryStore), PMS_SP_ExecutionLog presence (spExec INSTRUMENTED),
    // and VIEW SERVER STATE permission (waitStats / ioStats).
    let msdbReadable = false;
    let queryStoreEnabled = false;
    let queryStoreState: number | undefined;
    let spExecTableExists = false;
    let viewServerState = false;
    try {
      const pool = await this.getPool(ds);
      const probe = await pool
        .request()
        .query<{ jobs: number }>("SELECT COUNT(*) AS jobs FROM msdb.dbo.sysjobs");
      msdbReadable = (probe.recordset[0]?.jobs ?? -1) >= 0;
    } catch {
      // Probe failure is fine — surfaced via unavailableReason on the feed.
    }
    try {
      const pool = await this.getPool(ds);
      const r = await pool
        .request()
        .query<{ s: number }>("SELECT actual_state AS s FROM sys.database_query_store_options");
      queryStoreState = r.recordset[0]?.s;
      queryStoreEnabled = queryStoreState === 2; // 2 = READ_WRITE
    } catch {
      // Query Store may not be enabled or not readable — surfaced below.
    }
    try {
      const pool = await this.getPool(ds);
      const r = await pool
        .request()
        .query<{ id: number | null }>(
          "SELECT OBJECT_ID(N'dbo.PMS_SP_ExecutionLog') AS id",
        );
      spExecTableExists = (r.recordset[0]?.id ?? null) !== null;
    } catch {
      // ignore
    }
    try {
      const pool = await this.getPool(ds);
      // Cheap probe — succeeds iff the login has VIEW SERVER STATE.
      await pool
        .request()
        .query("SELECT TOP 1 wait_type FROM sys.dm_os_wait_stats");
      viewServerState = true;
    } catch {
      // VIEW SERVER STATE missing — Phase 3 feeds reported as unavailable.
    }

    // Phase 4 probes: XE session + ERRORLOG access
    let xeSessionExists = false;
    let xeSessionName: string | undefined;
    try {
      const pool = await this.getPool(ds);
      // Look for a running PMS XE session or the well-known system_health session
      const r = await pool
        .request()
        .query<{ name: string }>(
          `SELECT TOP 1 name FROM sys.dm_xe_sessions
           WHERE name IN (N'pms_collector', N'system_health')
           ORDER BY CASE name WHEN 'pms_collector' THEN 0 ELSE 1 END`,
        );
      if (r.recordset.length > 0) {
        xeSessionExists = true;
        xeSessionName = r.recordset[0]!.name;
      }
    } catch {
      // VIEW SERVER STATE required — surfaced below.
    }

    let errorLogReadable = false;
    try {
      const pool = await this.getPool(ds);
      // sp_readerrorlog returns rows only if the login has sysadmin or securityadmin role,
      // or VIEW SERVER STATE + being part of ##xp_cmdshell## proxy. We probe gently.
      await pool
        .request()
        .query("EXEC sp_readerrorlog 0, 1, NULL, NULL, NULL, NULL");
      errorLogReadable = true;
    } catch {
      // Not readable — surfaced below.
    }

    const spExecAvailable =
      ds.spLoggingMode === "INSTRUMENTED" && spExecTableExists;
    let spExecUnavailableReason: string | undefined;
    if (ds.spLoggingMode === "NONE") {
      spExecUnavailableReason =
        "spLoggingMode is NONE — set it to INSTRUMENTED via the data-source UI to enable.";
    } else if (ds.spLoggingMode === "XEVENTS") {
      spExecUnavailableReason =
        "Extended Events ingestion is reserved for Phase 4 — switch spLoggingMode to INSTRUMENTED for now.";
    } else if (!spExecTableExists) {
      spExecUnavailableReason =
        "dbo.PMS_SP_ExecutionLog not found — run scripts/mssql-bootstrap-phase2.sql against the user database.";
    }

    let queryStoreUnavailableReason: string | undefined;
    if (typeof queryStoreState !== "number") {
      queryStoreUnavailableReason =
        "Could not query sys.database_query_store_options — grant SELECT on the user database to the collector login (see scripts/mssql-bootstrap-phase2.sql).";
    } else if (queryStoreState === 0) {
      queryStoreUnavailableReason =
        "Query Store is OFF on this database. Enable with: ALTER DATABASE [...] SET QUERY_STORE = ON (OPERATION_MODE = READ_WRITE).";
    } else if (queryStoreState === 3) {
      queryStoreUnavailableReason =
        "Query Store is in ERROR state. Investigate sys.query_store_options.actual_state_desc and re-enable.";
    } else if (queryStoreState === 1) {
      queryStoreUnavailableReason =
        "Query Store is READ_ONLY. Switch to READ_WRITE for runtime stats to be captured.";
    }

    const feeds: FeedDescriptor[] = [
      {
        feed: "jobHistory",
        kind: "event",
        parsedSource: "MSSQL.JobHistory",
        defaultIntervalSec: 60,
        description: "SQL Agent job history (msdb.dbo.sysjobhistory).",
        available: msdbReadable,
        unavailableReason: msdbReadable
          ? undefined
          : "msdb.dbo.sysjobs is not readable — grant SELECT on msdb to the collector login.",
      },
      {
        feed: "queryStore",
        kind: "interval",
        parsedSource: "MSSQL.QueryStore",
        defaultIntervalSec: 300,
        description:
          "Query Store runtime stats with plan-regression detection (sys.query_store_runtime_stats).",
        available: queryStoreEnabled,
        unavailableReason: queryStoreUnavailableReason,
      },
      {
        feed: "spExec",
        kind: "event",
        parsedSource: "MSSQL.SpExec",
        defaultIntervalSec: 60,
        description:
          "Stored-procedure execution log (INSTRUMENTED: dbo.PMS_SP_ExecutionLog).",
        available: spExecAvailable,
        unavailableReason: spExecUnavailableReason,
      },
      {
        feed: "waitStats",
        kind: "cumulative",
        parsedSource: "MSSQL.WaitStats",
        defaultIntervalSec: 60,
        description:
          "Server-wide wait statistics (sys.dm_os_wait_stats); cumulative deltas with restart detection.",
        available: viewServerState,
        unavailableReason: viewServerState
          ? undefined
          : "Collector login lacks VIEW SERVER STATE — see scripts/mssql-bootstrap.sql or scripts/mssql-bootstrap-phase3.sql.",
      },
      {
        feed: "ioStats",
        kind: "cumulative",
        parsedSource: "MSSQL.IoStats",
        defaultIntervalSec: 60,
        description:
          "Per-file IO latency (sys.dm_io_virtual_file_stats); cumulative deltas with restart detection.",
        available: viewServerState,
        unavailableReason: viewServerState
          ? undefined
          : "Collector login lacks VIEW SERVER STATE — see scripts/mssql-bootstrap.sql or scripts/mssql-bootstrap-phase3.sql.",
      },
      {
        feed: "xevents",
        kind: "event",
        parsedSource: "MSSQL.XEvents",
        defaultIntervalSec: 60,
        description: `Extended Events (deadlocks, timeouts, errors)${xeSessionName ? ` — reading from session '${xeSessionName}'` : ""}.`,
        available: xeSessionExists,
        unavailableReason: xeSessionExists
          ? undefined
          : "No 'pms_collector' or 'system_health' XE session found. Run scripts/mssql-bootstrap-phase4.sql to create the pms_collector session.",
      },
      {
        feed: "errorLog",
        kind: "event",
        parsedSource: "MSSQL.ErrorLog",
        defaultIntervalSec: 300,
        description: "SQL Server ERRORLOG via sp_readerrorlog.",
        available: errorLogReadable,
        unavailableReason: errorLogReadable
          ? undefined
          : "sp_readerrorlog is not accessible — collector login needs VIEW SERVER STATE or sysadmin/securityadmin role membership.",
      },
      {
        feed: "osMetrics",
        kind: "interval",
        parsedSource: "MSSQL.OsMetrics",
        defaultIntervalSec: 60,
        description: "CPU/RAM/disk from sys.dm_os_sys_memory, dm_os_process_memory, dm_os_volume_stats, ring buffers.",
        available: viewServerState,
        unavailableReason: viewServerState
          ? undefined
          : "Requires VIEW SERVER STATE. Run scripts/mssql-bootstrap.sql.",
      },
    ];

    return feeds;
  }

  async pull(ds: PrismaDataSource, feed: FeedId, cursor: unknown): Promise<PullResult> {
    switch (feed) {
      case "jobHistory":
        return this.pullJobHistory(ds, cursor);
      case "queryStore":
        return this.pullQueryStore(ds, cursor);
      case "spExec":
        return this.pullSpExec(ds, cursor);
      case "waitStats":
        return this.pullWaitStats(ds, cursor);
      case "ioStats":
        return this.pullIoStats(ds, cursor);
      case "xevents":
        return this.pullXEvents(ds, cursor);
      case "errorLog":
        return this.pullErrorLog(ds, cursor);
      case "osMetrics":
        return this.pullOsMetrics(ds, cursor);
      default:
        throw new Error(
          `MSSQL.pull('${feed}') is not implemented in this build. ` +
            `Available: jobHistory, queryStore, spExec, waitStats, ioStats, xevents, errorLog.`,
        );
    }
  }

  private async pullJobHistory(ds: PrismaDataSource, cursor: unknown): Promise<PullResult> {
    const mapper = getMssqlMapper("jobHistory");
    if (!mapper) throw new Error("MSSQL jobHistory mapper is not registered.");

    const pool = await this.getPool(ds);
    const previous = parseJobHistoryCursor(cursor);

    const result = await pool
      .request()
      .input("lastInstanceId", sql.Int, previous.lastInstanceId)
      .input("rowCap", sql.Int, PULL_ROW_CAP)
      .query<JobHistoryRawRow>(JOB_HISTORY_QUERY);

    const rows = result.recordset ?? [];

    const mapped = jobHistoryMapper.map(rows, previous, {
      redactSqlText: ds.redactSqlText,
    });

    return {
      entries: mapped.entries,
      rowsFetched: rows.length,
      nextCursor: mapped.nextCursor,
      partial: rows.length >= PULL_ROW_CAP,
      syntheticEvents: mapped.syntheticEvents,
      note: mapped.note,
    };
  }

  private async pullQueryStore(ds: PrismaDataSource, cursor: unknown): Promise<PullResult> {
    const previous = parseQueryStoreCursor(cursor);
    const pool = await this.getPool(ds);

    // Hard-fail early if Query Store is not READ_WRITE.
    const stateRow = await pool
      .request()
      .query<{ s: number }>(
        "SELECT actual_state AS s FROM sys.database_query_store_options",
      );
    const state = stateRow.recordset[0]?.s;
    if (state !== 2) {
      throw new Error(
        `Query Store is not READ_WRITE on database '${ds.database}' (actual_state=${state ?? "?"}). ` +
          `Enable with: ALTER DATABASE [${ds.database}] SET QUERY_STORE = ON (OPERATION_MODE = READ_WRITE).`,
      );
    }

    const lastIso = previous.lastIntervalEndTime ?? "1970-01-01T00:00:00.000Z";
    const result = await pool
      .request()
      .input("lastTime", sql.DateTime2, new Date(lastIso))
      .input("rowCap", sql.Int, PULL_ROW_CAP)
      .query<QueryStoreRawRow>(QUERY_STORE_QUERY);

    const rows = result.recordset ?? [];

    const mapped = queryStoreMapper.map(rows, previous, {
      redactSqlText: ds.redactSqlText,
    });

    return {
      entries: mapped.entries,
      rowsFetched: rows.length,
      nextCursor: mapped.nextCursor,
      partial: rows.length >= PULL_ROW_CAP,
      syntheticEvents: mapped.syntheticEvents,
      note: mapped.note,
    };
  }

  private async pullSpExec(ds: PrismaDataSource, cursor: unknown): Promise<PullResult> {
    if (ds.spLoggingMode === "NONE") {
      throw new Error(
        `spLoggingMode is NONE on '${ds.name}'. Set it to INSTRUMENTED in the data-source UI to enable spExec ingestion.`,
      );
    }
    if (ds.spLoggingMode === "XEVENTS") {
      throw new Error(
        `spLoggingMode is XEVENTS on '${ds.name}', which is reserved for Phase 4. Switch to INSTRUMENTED for now.`,
      );
    }

    const previous = parseSpExecCursor(cursor);
    const pool = await this.getPool(ds);

    // Verify the table exists at runtime — operator may have toggled the
    // feed without running the bootstrap script.
    const objectIdRow = await pool
      .request()
      .query<{ id: number | null }>(
        "SELECT OBJECT_ID(N'dbo.PMS_SP_ExecutionLog') AS id",
      );
    if ((objectIdRow.recordset[0]?.id ?? null) === null) {
      throw new Error(
        "Table dbo.PMS_SP_ExecutionLog does not exist. Run scripts/mssql-bootstrap-phase2.sql against the user database.",
      );
    }

    const result = await pool
      .request()
      .input("lastLogId", sql.BigInt, previous.lastLogId)
      .input("rowCap", sql.Int, PULL_ROW_CAP)
      .query<SpExecRawRow>(SP_EXEC_QUERY);

    const rows = result.recordset ?? [];

    const mapped = spExecMapper.map(rows, previous, {
      redactSqlText: ds.redactSqlText,
    });

    return {
      entries: mapped.entries,
      rowsFetched: rows.length,
      nextCursor: mapped.nextCursor,
      partial: rows.length >= PULL_ROW_CAP,
      syntheticEvents: mapped.syntheticEvents,
      note: mapped.note,
    };
  }

  private async pullWaitStats(ds: PrismaDataSource, cursor: unknown): Promise<PullResult> {
    const previous = parseWaitStatsCursor(cursor);
    const pool = await this.getPool(ds);

    const result = await pool
      .request()
      .query<WaitStatsRawRow>(WAIT_STATS_QUERY);
    const rows = result.recordset ?? [];

    const mapped = waitStatsMapper.map(rows, previous, {
      redactSqlText: ds.redactSqlText,
    });

    return {
      entries: mapped.entries,
      rowsFetched: rows.length,
      nextCursor: mapped.nextCursor,
      // Wait stats is a snapshot pull (no row cap behaviour) — never partial.
      partial: false,
      syntheticEvents: mapped.syntheticEvents,
      note: mapped.note,
    };
  }

  private async pullIoStats(ds: PrismaDataSource, cursor: unknown): Promise<PullResult> {
    const previous = parseIoStatsCursor(cursor);
    const pool = await this.getPool(ds);

    const result = await pool
      .request()
      .query<IoStatsRawRow>(IO_STATS_QUERY);
    const rows = result.recordset ?? [];

    const mapped = ioStatsMapper.map(rows, previous, {
      redactSqlText: ds.redactSqlText,
    });

    return {
      entries: mapped.entries,
      rowsFetched: rows.length,
      nextCursor: mapped.nextCursor,
      partial: false,
      syntheticEvents: mapped.syntheticEvents,
      note: mapped.note,
    };
  }

  private async pullXEvents(ds: PrismaDataSource, cursor: unknown): Promise<PullResult> {
    const previous = parseXEventsCursor(cursor);
    const pool = await this.getPool(ds);

    // Determine which XE session to read from
    const sessionRow = await pool
      .request()
      .query<{ name: string }>(
        `SELECT TOP 1 name FROM sys.dm_xe_sessions
         WHERE name IN (N'pms_collector', N'system_health')
         ORDER BY CASE name WHEN 'pms_collector' THEN 0 ELSE 1 END`,
      );
    if (sessionRow.recordset.length === 0) {
      throw new Error(
        "No 'pms_collector' or 'system_health' XE session found. Run scripts/mssql-bootstrap-phase4.sql.",
      );
    }
    const sessionName = sessionRow.recordset[0]!.name;

    // Read from the ring_buffer target of the session. We shred the XML to
    // extract individual events with their key attributes.
    const lastTs = previous.lastEventTimestamp
      ? new Date(previous.lastEventTimestamp)
      : new Date("1970-01-01T00:00:00Z");

    const result = await pool
      .request()
      .input("sessionName", sql.NVarChar(128), sessionName)
      .input("lastTimestamp", sql.DateTime2, lastTs)
      .input("rowCap", sql.Int, PULL_ROW_CAP)
      .query<XEventsRawRow>(XEVENTS_QUERY);

    const rows = result.recordset ?? [];

    const mapped = xeventsMapper.map(rows, previous, {
      redactSqlText: ds.redactSqlText,
    });

    return {
      entries: mapped.entries,
      rowsFetched: rows.length,
      nextCursor: mapped.nextCursor,
      partial: rows.length >= PULL_ROW_CAP,
      syntheticEvents: mapped.syntheticEvents,
      note: mapped.note,
    };
  }

  private async pullErrorLog(ds: PrismaDataSource, cursor: unknown): Promise<PullResult> {
    const previous = parseErrorLogCursor(cursor);
    const pool = await this.getPool(ds);

    // sp_readerrorlog params: LogNumber, LogType(1=SQL 2=Agent), SearchString1, SearchString2, StartDate, EndDate
    const startDate = previous.lastLogDate
      ? new Date(previous.lastLogDate)
      : null;

    let result;
    if (startDate) {
      result = await pool
        .request()
        .input("startDate", sql.DateTime, startDate)
        .query<ErrorLogRawRow>(
          `CREATE TABLE #el (LogDate datetime, ProcessInfo nvarchar(100), Text nvarchar(max));
           INSERT INTO #el EXEC sp_readerrorlog 0, 1, NULL, NULL, @startDate, NULL;
           SELECT TOP (${PULL_ROW_CAP}) LogDate, ProcessInfo, Text, @@SERVERNAME AS server
           FROM #el
           WHERE LogDate > @startDate
           ORDER BY LogDate ASC;
           DROP TABLE #el;`,
        );
    } else {
      // First pull — get most recent entries only (last ~500 rows)
      result = await pool
        .request()
        .query<ErrorLogRawRow>(
          `CREATE TABLE #el (LogDate datetime, ProcessInfo nvarchar(100), Text nvarchar(max));
           INSERT INTO #el EXEC sp_readerrorlog 0, 1;
           SELECT TOP (500) LogDate, ProcessInfo, Text, @@SERVERNAME AS server
           FROM #el
           ORDER BY LogDate DESC;
           DROP TABLE #el;`,
        );
    }

    // Re-sort ascending for the mapper
    const rows = (result.recordset ?? []).sort((a, b) => {
      const ta = new Date(a.LogDate).getTime();
      const tb = new Date(b.LogDate).getTime();
      return ta - tb;
    });

    const mapped = errorLogMapper.map(rows, previous);

    return {
      entries: mapped.entries,
      rowsFetched: rows.length,
      nextCursor: mapped.nextCursor,
      partial: rows.length >= PULL_ROW_CAP,
      syntheticEvents: mapped.syntheticEvents,
      note: mapped.note,
    };
  }

  async close(): Promise<void> {
    const live = Array.from(this.pools.values());
    this.pools.clear();
    await Promise.allSettled(live.map((p) => p.close()));
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Lazily build / reuse a per-DataSource pool. Pool config is rebuilt only
   * when the row id is unknown to us — operator-driven edits invoke `close()`
   * which empties the cache.
   */
  private async getPool(ds: PrismaDataSource): Promise<sql.ConnectionPool> {
    const cached = this.pools.get(ds.id);
    if (cached && cached.connected) return cached;
    if (cached && !cached.connected) {
      // Stale pool — drop and rebuild.
      this.pools.delete(ds.id);
      try { await cached.close(); } catch { /* ignore */ }
    }

    const config = buildPoolConfig(ds);
    const pool = new sql.ConnectionPool(config);
    pool.on("error", (err: unknown) => {
      // Surface pool-level errors but never crash the process.
      // eslint-disable-next-line no-console
      console.error(
        `[MssqlConnector] pool error on ${JSON.stringify(redactForLog(ds))}: ${errorMessage(err)}`,
      );
    });
    await pool.connect();
    this.pools.set(ds.id, pool);
    return pool;
  }

  /**
   * Probe a small set of capabilities used to populate `listFeeds()` and to
   * give operators an early signal that the collector account is misconfigured.
   */
  private async probeCapabilities(pool: sql.ConnectionPool): Promise<Record<string, boolean | string | number>> {
    const caps: Record<string, boolean | string | number> = {};

    // VIEW SERVER STATE → required for every DMV-based feed.
    try {
      await pool.request().query("SELECT TOP 1 wait_type FROM sys.dm_os_wait_stats");
      caps.viewServerState = true;
    } catch {
      caps.viewServerState = false;
    }

    // msdb readable → jobHistory.
    try {
      await pool.request().query("SELECT TOP 1 name FROM msdb.dbo.sysjobs");
      caps.msdbReadable = true;
    } catch {
      caps.msdbReadable = false;
    }

    // Query Store enabled on the configured database (Phase 2 prep).
    try {
      const r = await pool
        .request()
        .query<{ s: number }>(
          "SELECT actual_state AS s FROM sys.database_query_store_options",
        );
      const state = r.recordset[0]?.s;
      caps.queryStoreEnabled = state === 2; // 2 = READ_WRITE
      if (typeof state === "number") caps.queryStoreState = state;
    } catch {
      caps.queryStoreEnabled = false;
    }

    return caps;
  }

  // ---------------------------------------------------------------------------
  // osMetrics pull
  // ---------------------------------------------------------------------------

  private async pullOsMetrics(
    ds: PrismaDataSource,
    cursor: unknown,
  ): Promise<PullResult> {
    const pool = await this.getPool(ds);
    const now = new Date();

    const rows: import("../mappers/mssql/os-metrics").MssqlOsMetricsRawRow[] = [];
    const snapshotTime = now.toISOString();

    // 1. System memory
    try {
      const r = await pool.request().query<{
        total_physical_memory_kb: number;
        available_physical_memory_kb: number;
        system_memory_state_desc: string;
      }>(
        "SELECT total_physical_memory_kb, available_physical_memory_kb, system_memory_state_desc FROM sys.dm_os_sys_memory",
      );
      const row = r.recordset[0];
      if (row) {
        const totalMb = row.total_physical_memory_kb / 1024;
        const availMb = row.available_physical_memory_kb / 1024;
        const usedPct = totalMb > 0 ? Math.round(((totalMb - availMb) / totalMb) * 100 * 10) / 10 : 0;
        rows.push(
          { metric_name: "memory_total_mb", metric_value: Math.round(totalMb), metric_unit: "MB", snapshot_time: snapshotTime },
          { metric_name: "memory_available_mb", metric_value: Math.round(availMb), metric_unit: "MB", snapshot_time: snapshotTime },
          { metric_name: "memory_used_pct", metric_value: usedPct, metric_unit: "%", detail: row.system_memory_state_desc, snapshot_time: snapshotTime },
        );
      }
    } catch { /* VIEW SERVER STATE not granted — skip */ }

    // 2. SQL Server process memory
    try {
      const r = await pool.request().query<{
        physical_memory_in_use_kb: number;
        memory_utilization_percentage: number;
        page_fault_count: number;
      }>(
        "SELECT physical_memory_in_use_kb, memory_utilization_percentage, page_fault_count FROM sys.dm_os_process_memory",
      );
      const row = r.recordset[0];
      if (row) {
        rows.push(
          { metric_name: "sql_memory_used_mb", metric_value: Math.round(row.physical_memory_in_use_kb / 1024), metric_unit: "MB", snapshot_time: snapshotTime },
          { metric_name: "sql_memory_utilization_pct", metric_value: row.memory_utilization_percentage, metric_unit: "%", snapshot_time: snapshotTime },
        );
      }
    } catch { /* skip */ }

    // 3. CPU from ring buffers (recent scheduler monitor samples)
    try {
      const r = await pool.request().query<{ cpu_pct: number }>(
        `SELECT TOP 1
           100 - y.SystemIdle AS cpu_pct
         FROM (
           SELECT
             record.value('(./Record/SchedulerMonitorEvent/SystemHealth/SystemIdle)[1]', 'int') AS SystemIdle
           FROM (
             SELECT CAST(record AS xml) AS record
             FROM sys.dm_os_ring_buffers
             WHERE ring_buffer_type = N'RING_BUFFER_SCHEDULER_MONITOR'
               AND record LIKE N'%<SystemHealth>%'
           ) AS x
         ) AS y
         ORDER BY y.SystemIdle ASC`,
      );
      const row = r.recordset[0];
      if (row) {
        rows.push({
          metric_name: "cpu_pct",
          metric_value: row.cpu_pct,
          metric_unit: "%",
          snapshot_time: snapshotTime,
        });
      }
    } catch { /* ring buffers may be unavailable */ }

    // 4. Disk volumes from dm_os_volume_stats (one row per mounted volume)
    try {
      const r = await pool.request().query<{
        volume_mount_point: string;
        total_bytes: number;
        available_bytes: number;
      }>(
        `SELECT DISTINCT
           vs.volume_mount_point,
           vs.total_bytes,
           vs.available_bytes
         FROM sys.master_files AS f
         CROSS APPLY sys.dm_os_volume_stats(f.database_id, f.file_id) AS vs`,
      );
      for (const vol of r.recordset) {
        const freeGb = Math.round((vol.available_bytes / (1024 ** 3)) * 10) / 10;
        const totalGb = Math.round((vol.total_bytes / (1024 ** 3)) * 10) / 10;
        const usedPct = totalGb > 0 ? Math.round(((totalGb - freeGb) / totalGb) * 100 * 10) / 10 : 0;
        rows.push(
          { metric_name: "disk_free_gb", metric_value: freeGb, metric_unit: "GB", detail: vol.volume_mount_point.trim(), snapshot_time: snapshotTime },
          { metric_name: "disk_used_pct", metric_value: usedPct, metric_unit: "%", detail: vol.volume_mount_point.trim(), snapshot_time: snapshotTime },
        );
      }
    } catch { /* skip */ }

    // 5. Scheduler count / CPU count from sys.dm_os_sys_info
    try {
      const r = await pool.request().query<{
        cpu_count: number;
        scheduler_count: number;
      }>(
        "SELECT cpu_count, scheduler_count FROM sys.dm_os_sys_info",
      );
      const row = r.recordset[0];
      if (row) {
        rows.push(
          { metric_name: "cpu_count", metric_value: row.cpu_count, metric_unit: "", snapshot_time: snapshotTime },
          { metric_name: "scheduler_count", metric_value: row.scheduler_count, metric_unit: "", snapshot_time: snapshotTime },
        );
      }
    } catch { /* skip */ }

    // Map through the mapper
    const { mssqlOsMetricsMapper } = await import("../mappers/mssql/os-metrics");
    const result = mssqlOsMetricsMapper.map(rows, cursor as any);

    return {
      entries: [...result.entries, ...result.syntheticEvents],
      rowsFetched: rows.length,
      nextCursor: result.nextCursor,
      partial: false,
      syntheticEvents: result.syntheticEvents,
      note: result.note,
    };
  }
}

// -----------------------------------------------------------------------------
// Module-load registration
// -----------------------------------------------------------------------------

registerConnector("MSSQL", () => new MssqlConnector());

export default MssqlConnector;

// -----------------------------------------------------------------------------
// Pool config builder
// -----------------------------------------------------------------------------

/**
 * Translate a `DataSource` row into an `mssql` driver config. The plaintext
 * password is fetched here via `decryptDataSource` and lives only on the
 * stack — never logged.
 */
export function buildPoolConfig(ds: PrismaDataSource): sql.config {
  const dec = decryptDataSource(ds);
  const params = (dec.connectionParams ?? {}) as MssqlConnectionParams;

  // Named instance overrides port — `mssql` accepts `server\\instance` syntax
  // and ignores `port` when an instanceName is given. We mirror that here.
  const useInstance = !!params.instance;
  const baseConfig: sql.config = {
    server: dec.host,
    database: dec.database,
    requestTimeout: REQUEST_TIMEOUT_MS,
    connectionTimeout: CONNECT_TIMEOUT_MS,
    pool: {
      min: POOL_MIN,
      max: POOL_MAX,
      idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
    },
    options: {
      encrypt: params.encrypt ?? true,
      trustServerCertificate: dec.trustServerCert,
      ...(params.applicationIntent ? { appIntent: params.applicationIntent } : {}),
      ...(useInstance ? { instanceName: params.instance } : {}),
    },
  };
  if (!useInstance) {
    baseConfig.port = dec.port;
  }

  switch (dec.authMode) {
    case "SQL_AUTH": {
      if (!dec.username) {
        throw new Error(`DataSource '${dec.name}' uses SQL_AUTH but has no username configured.`);
      }
      baseConfig.user = dec.username;
      baseConfig.password = dec.password ?? "";
      break;
    }
    case "WINDOWS_AUTH": {
      // NTLM via tedious. Domain MUST be supplied via connectionParams.domain.
      if (!params.domain) {
        throw new Error(
          `DataSource '${dec.name}' uses WINDOWS_AUTH but connectionParams.domain is missing.`,
        );
      }
      if (!dec.username) {
        throw new Error(`DataSource '${dec.name}' uses WINDOWS_AUTH but has no username configured.`);
      }
      // Cast: the @types/mssql ntlm authentication shape is exposed via the driver.
      (baseConfig as unknown as { authentication: unknown }).authentication = {
        type: "ntlm",
        options: {
          userName: dec.username,
          password: dec.password ?? "",
          domain: params.domain,
        },
      };
      break;
    }
    case "IAM":
    case "TOKEN": {
      throw new Error(
        `Auth mode ${dec.authMode} is not supported for MSSQL in Phase 1. Use SQL_AUTH or WINDOWS_AUTH.`,
      );
    }
    default: {
      const exhaustive: never = dec.authMode as never;
      throw new Error(`Unhandled MSSQL auth mode: ${exhaustive as string}`);
    }
  }

  return baseConfig;
}

// -----------------------------------------------------------------------------
// Cursor helpers
// -----------------------------------------------------------------------------

function parseJobHistoryCursor(c: unknown): JobHistoryCursor {
  if (!c || typeof c !== "object") return { lastInstanceId: 0 };
  const v = (c as Record<string, unknown>).lastInstanceId;
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
    return { lastInstanceId: Math.floor(v) };
  }
  // Defensive: accept stringified numbers from older Json columns.
  if (typeof v === "string" && /^\d+$/.test(v)) {
    return { lastInstanceId: Number(v) };
  }
  return { lastInstanceId: 0 };
}

function parseQueryStoreCursor(c: unknown): QueryStoreCursor {
  if (!c || typeof c !== "object") {
    return { lastIntervalEndTime: null, baselines: {} };
  }
  const obj = c as Record<string, unknown>;
  const lastIntervalEndTime =
    typeof obj.lastIntervalEndTime === "string" && obj.lastIntervalEndTime.length > 0
      ? obj.lastIntervalEndTime
      : null;
  let baselines: Record<string, any> = {};
  if (obj.baselines && typeof obj.baselines === "object" && !Array.isArray(obj.baselines)) {
    baselines = obj.baselines as Record<string, any>;
  }
  return { lastIntervalEndTime, baselines };
}

function parseSpExecCursor(c: unknown): SpExecCursor {
  if (!c || typeof c !== "object") return { lastLogId: 0 };
  const v = (c as Record<string, unknown>).lastLogId;
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
    return { lastLogId: Math.floor(v) };
  }
  if (typeof v === "string" && /^\d+$/.test(v)) {
    return { lastLogId: Number(v) };
  }
  return { lastLogId: 0 };
}

/**
 * Parse a persisted waitStats cursor. Defensive: any malformed shape is
 * treated as "no previous snapshot" so the next pull primes a fresh cursor.
 */
function parseWaitStatsCursor(c: unknown): WaitStatsCursor {
  const empty: WaitStatsCursor = {
    lastSnapshotAt: null,
    serverStartTime: null,
    counters: {},
  };
  if (!c || typeof c !== "object") return empty;
  const obj = c as Record<string, unknown>;
  const lastSnapshotAt =
    typeof obj.lastSnapshotAt === "string" && obj.lastSnapshotAt.length > 0
      ? obj.lastSnapshotAt
      : null;
  const serverStartTime =
    typeof obj.serverStartTime === "string" && obj.serverStartTime.length > 0
      ? obj.serverStartTime
      : null;
  let counters: Record<string, WaitStatsCursorRow> = {};
  if (
    obj.counters &&
    typeof obj.counters === "object" &&
    !Array.isArray(obj.counters)
  ) {
    counters = obj.counters as Record<string, WaitStatsCursorRow>;
  }
  return { lastSnapshotAt, serverStartTime, counters };
}

/**
 * Parse a persisted ioStats cursor. Same defensive shape as
 * `parseWaitStatsCursor` — anything we can't recognise is dropped on the floor
 * so the mapper falls into priming mode on the next pull.
 */
function parseIoStatsCursor(c: unknown): IoStatsCursor {
  const empty: IoStatsCursor = {
    lastSnapshotAt: null,
    serverStartTime: null,
    counters: {},
  };
  if (!c || typeof c !== "object") return empty;
  const obj = c as Record<string, unknown>;
  const lastSnapshotAt =
    typeof obj.lastSnapshotAt === "string" && obj.lastSnapshotAt.length > 0
      ? obj.lastSnapshotAt
      : null;
  const serverStartTime =
    typeof obj.serverStartTime === "string" && obj.serverStartTime.length > 0
      ? obj.serverStartTime
      : null;
  let counters: Record<string, IoStatsCursorRow> = {};
  if (
    obj.counters &&
    typeof obj.counters === "object" &&
    !Array.isArray(obj.counters)
  ) {
    counters = obj.counters as Record<string, IoStatsCursorRow>;
  }
  return { lastSnapshotAt, serverStartTime, counters };
}

function parseXEventsCursor(c: unknown): XEventsCursor {
  const empty: XEventsCursor = {
    lastEventTimestamp: null,
    lastFileName: null,
    lastFileOffset: null,
  };
  if (!c || typeof c !== "object") return empty;
  const obj = c as Record<string, unknown>;
  return {
    lastEventTimestamp:
      typeof obj.lastEventTimestamp === "string" && obj.lastEventTimestamp.length > 0
        ? obj.lastEventTimestamp
        : null,
    lastFileName:
      typeof obj.lastFileName === "string" && obj.lastFileName.length > 0
        ? obj.lastFileName
        : null,
    lastFileOffset:
      typeof obj.lastFileOffset === "number" ? obj.lastFileOffset : null,
  };
}

function parseErrorLogCursor(c: unknown): ErrorLogCursor {
  if (!c || typeof c !== "object") return { lastLogDate: null };
  const obj = c as Record<string, unknown>;
  return {
    lastLogDate:
      typeof obj.lastLogDate === "string" && obj.lastLogDate.length > 0
        ? obj.lastLogDate
        : null,
  };
}

// -----------------------------------------------------------------------------
// SQL
// -----------------------------------------------------------------------------

// Job-history pull — instance_id is the monotonic identity column on sysjobhistory.
// We always order by it and cap with TOP @rowCap so the cursor is durable even
// across server restarts. step_id = 0 rows are summary entries.
const JOB_HISTORY_QUERY = `
  SELECT TOP (@rowCap)
    h.instance_id            AS instance_id,
    j.name                   AS job_name,
    CONVERT(varchar(36), j.job_id) AS job_id,
    h.step_id                AS step_id,
    s.step_name              AS step_name,
    s.command                AS command,
    h.run_status             AS run_status,
    h.run_duration           AS run_duration,
    msdb.dbo.agent_datetime(h.run_date, h.run_time) AS run_dt,
    h.message                AS message,
    @@SERVERNAME             AS server
  FROM msdb.dbo.sysjobhistory h
  INNER JOIN msdb.dbo.sysjobs   j ON j.job_id  = h.job_id
  LEFT  JOIN msdb.dbo.sysjobsteps s ON s.job_id = h.job_id AND s.step_id = h.step_id
  WHERE h.instance_id > @lastInstanceId
  ORDER BY h.instance_id ASC
`;

// Query Store pull — joins runtime_stats → plan → query → query_text in the
// connected user database. We pick the *latest* row per (query_id) within the
// poll window so the plan-regression detector compares like-for-like. The
// connector is responsible for advancing `last_execution_time` past everything
// returned. Note Query Store stores avg_duration in micro-seconds.
const QUERY_STORE_QUERY = `
  WITH latest AS (
    SELECT
      rs.runtime_stats_id,
      rs.plan_id,
      rs.execution_type,
      rs.count_executions,
      rs.avg_duration,
      rs.avg_cpu_time,
      rs.avg_logical_io_reads,
      rs.avg_physical_io_reads,
      rs.last_execution_time,
      ROW_NUMBER() OVER (PARTITION BY rs.plan_id ORDER BY rs.last_execution_time DESC) AS rn
    FROM sys.query_store_runtime_stats AS rs
    WHERE rs.last_execution_time > @lastTime
  )
  SELECT TOP (@rowCap)
    q.query_id                                            AS query_id,
    p.plan_id                                             AS plan_id,
    CONVERT(varchar(34), q.query_hash, 1)                 AS query_hash,
    CONVERT(varchar(34), p.query_plan_hash, 1)            AS query_plan_hash,
    CAST(latest.count_executions AS bigint)               AS execution_count,
    CAST(latest.avg_duration AS float)                    AS avg_duration_us,
    CAST(latest.avg_cpu_time AS float)                    AS avg_cpu_time_us,
    CAST(latest.avg_logical_io_reads AS float)            AS avg_logical_io_reads,
    CAST(latest.avg_physical_io_reads AS float)           AS avg_physical_io_reads,
    latest.last_execution_time                            AS last_execution_time,
    CAST(qt.query_sql_text AS nvarchar(2000))             AS query_sql_text,
    DB_NAME()                                             AS database_name,
    @@SERVERNAME                                          AS server
  FROM latest
  INNER JOIN sys.query_store_plan       AS p  ON p.plan_id = latest.plan_id
  INNER JOIN sys.query_store_query      AS q  ON q.query_id = p.query_id
  INNER JOIN sys.query_store_query_text AS qt ON qt.query_text_id = q.query_text_id
  WHERE latest.rn = 1
  ORDER BY latest.last_execution_time ASC
`;

// SP-exec pull — INSTRUMENTED mode reads from a customer-owned table seeded
// by scripts/mssql-bootstrap-phase2.sql. LogId is the identity-PK cursor.
const SP_EXEC_QUERY = `
  SELECT TOP (@rowCap)
    LogId,
    StartedAt,
    FinishedAt,
    DurationMs,
    ProcedureName,
    DatabaseName,
    SchemaName,
    RowsAffected,
    ErrorNumber,
    CAST(ErrorMessage AS nvarchar(4000))    AS ErrorMessage,
    CAST(ParametersJson AS nvarchar(4000))  AS ParametersJson,
    ServerName
  FROM dbo.PMS_SP_ExecutionLog
  WHERE LogId > @lastLogId
  ORDER BY LogId ASC
`;

// Wait-stats pull — server-wide cumulative DMV. We pre-filter the most common
// idle waits in the WHERE clause to keep the row count low; the mapper does a
// defensive second-pass filter via IDLE_WAIT_TYPES. `sys.dm_os_sys_info` is
// joined cross-product so every row carries `sqlserver_start_time` for
// restart detection. `SYSUTCDATETIME()` produces the snapshot timestamp on
// the SQL Server clock so all rows share the same `snapshot_time` value.
const WAIT_STATS_QUERY = `
  SELECT
    ws.wait_type                        AS wait_type,
    CAST(ws.wait_time_ms AS bigint)     AS wait_time_ms,
    CAST(ws.waiting_tasks_count AS bigint) AS waiting_tasks_count,
    CAST(ws.signal_wait_time_ms AS bigint) AS signal_wait_time_ms,
    si.sqlserver_start_time             AS sqlserver_start_time,
    SYSUTCDATETIME()                    AS snapshot_time,
    @@SERVERNAME                        AS server
  FROM sys.dm_os_wait_stats AS ws
  CROSS JOIN sys.dm_os_sys_info AS si
  WHERE ws.wait_time_ms > 0
    AND ws.wait_type NOT IN (
      N'SLEEP_TASK', N'WAITFOR', N'WAITFOR_TASKSHUTDOWN',
      N'LAZYWRITER_SLEEP', N'LOGMGR_QUEUE', N'CHECKPOINT_QUEUE',
      N'REQUEST_FOR_DEADLOCK_SEARCH',
      N'XE_TIMER_EVENT', N'XE_DISPATCHER_WAIT', N'XE_DISPATCHER_JOIN',
      N'BROKER_TASK_STOP', N'BROKER_TO_FLUSH', N'BROKER_RECEIVE_WAITFOR',
      N'BROKER_TRANSMITTER', N'BROKER_EVENTHANDLER',
      N'DBMIRROR_EVENTS_QUEUE', N'DBMIRROR_WORKER_QUEUE',
      N'DIRTY_PAGE_POLL',
      N'FT_IFTS_SCHEDULER_IDLE_WAIT', N'FT_IFTSHC_MUTEX',
      N'HADR_FILESTREAM_IOMGR_IOCOMPLETION', N'HADR_LOGCAPTURE_WAIT',
      N'HADR_NOTIFICATION_DEQUEUE', N'HADR_TIMER_TASK', N'HADR_WORK_QUEUE',
      N'KSOURCE_WAKEUP', N'LOGMGR_FLUSH', N'ONDEMAND_TASK_QUEUE',
      N'PWAIT_ALL_COMPONENTS_INITIALIZED',
      N'QDS_ASYNC_QUEUE',
      N'QDS_CLEANUP_STALE_QUERIES_TASK_MAIN_LOOP_SLEEP',
      N'QDS_PERSIST_TASK_MAIN_LOOP_SLEEP',
      N'REDO_THREAD_PENDING_WORK',
      N'SLEEP_BPOOL_FLUSH', N'SLEEP_DBSTARTUP', N'SLEEP_DCOMSTARTUP',
      N'SLEEP_MASTERDBREADY', N'SLEEP_MASTERMDREADY',
      N'SLEEP_MASTERUPGRADED', N'SLEEP_MSDBSTARTUP', N'SLEEP_SYSTEMTASK',
      N'SQLTRACE_BUFFER_FLUSH', N'SQLTRACE_INCREMENTAL_FLUSH_SLEEP',
      N'SQLTRACE_WAIT_ENTRIES',
      N'WAIT_FOR_RESULTS',
      N'WAIT_XTP_OFFLINE_CKPT_NEW_LOG', N'WAIT_XTP_HOST_WAIT',
      N'WAIT_XTP_RECOVERY', N'WAIT_XTP_CKPT_CLOSE'
    )
`;

// IO-stats pull — virtual file stats joined with master_files for the file
// path / database name. `sys.dm_os_sys_info` cross-joined for restart detection,
// same pattern as waitStats. Tempdb files are included; mapper handles them.
const IO_STATS_QUERY = `
  SELECT
    vfs.database_id                              AS database_id,
    vfs.file_id                                  AS file_id,
    DB_NAME(vfs.database_id)                     AS database_name,
    mf.name                                      AS logical_name,
    mf.physical_name                             AS physical_name,
    mf.type_desc                                 AS type_desc,
    CAST(vfs.num_of_reads AS bigint)             AS num_of_reads,
    CAST(vfs.num_of_writes AS bigint)            AS num_of_writes,
    CAST(vfs.num_of_bytes_read AS bigint)        AS num_of_bytes_read,
    CAST(vfs.num_of_bytes_written AS bigint)     AS num_of_bytes_written,
    CAST(vfs.io_stall_read_ms AS bigint)         AS io_stall_read_ms,
    CAST(vfs.io_stall_write_ms AS bigint)        AS io_stall_write_ms,
    CAST(vfs.size_on_disk_bytes AS bigint)       AS size_on_disk_bytes,
    si.sqlserver_start_time                      AS sqlserver_start_time,
    SYSUTCDATETIME()                             AS snapshot_time,
    @@SERVERNAME                                 AS server
  FROM sys.dm_io_virtual_file_stats(NULL, NULL) AS vfs
  INNER JOIN sys.master_files AS mf
    ON mf.database_id = vfs.database_id
   AND mf.file_id     = vfs.file_id
  CROSS JOIN sys.dm_os_sys_info AS si
`;

// XEvents pull — reads from the ring_buffer target of the named XE session.
// We use sys.dm_xe_session_targets + CAST(target_data AS XML) to shred the
// ring buffer. The query pre-filters by @lastTimestamp to skip already-seen
// events. Key attributes are extracted from the event XML via XQuery.
// For the system_health session we focus on: xml_deadlock_report, error_reported,
// connectivity_ring_buffer_recorded. For pms_collector we capture all events.
const XEVENTS_QUERY = `
  ;WITH rb AS (
    SELECT CAST(target_data AS xml) AS xdata
    FROM sys.dm_xe_session_targets AS st
    INNER JOIN sys.dm_xe_sessions AS s ON s.address = st.event_session_address
    WHERE s.name = @sessionName
      AND st.target_name = N'ring_buffer'
  ),
  events AS (
    SELECT
      evt.value('(@name)',                  'nvarchar(128)')  AS event_name,
      evt.value('(@timestamp)',             'datetime2')      AS event_timestamp,
      evt.query('.')                                          AS event_xml,
      evt.value('(data[@name="database_name"]/value)[1]',     'nvarchar(256)') AS database_name,
      evt.value('(action[@name="sql_text"]/value)[1]',        'nvarchar(2000)') AS sql_text,
      evt.value('(action[@name="username"]/value)[1]',        'nvarchar(256)')  AS username,
      evt.value('(action[@name="client_hostname"]/value)[1]', 'nvarchar(256)')  AS client_hostname,
      evt.value('(data[@name="duration"]/value)[1]',          'bigint')         AS duration_us,
      evt.value('(data[@name="severity"]/value)[1]',          'int')            AS severity,
      evt.value('(data[@name="error_number"]/value)[1]',      'int')            AS error_number,
      evt.value('(data[@name="message"]/value)[1]',           'nvarchar(4000)') AS error_message,
      evt.value('(data[@name="wait_type"]/value)[1]',         'nvarchar(128)')  AS wait_type,
      evt.value('(data[@name="wait_resource"]/value)[1]',     'nvarchar(256)')  AS wait_resource,
      evt.value('(data[@name="xml_report"]/value)[1]',        'nvarchar(max)')  AS deadlock_xml,
      evt.value('(data[@name="object_name"]/value)[1]',       'nvarchar(256)')  AS object_name,
      evt.value('(action[@name="session_id"]/value)[1]',      'int')            AS session_id
    FROM rb
    CROSS APPLY xdata.nodes('/RingBufferTarget/event') AS T(evt)
  )
  SELECT TOP (@rowCap)
    event_name,
    event_timestamp,
    NULL AS event_data_xml,
    session_id,
    database_name,
    sql_text,
    username,
    client_hostname,
    CASE WHEN duration_us IS NOT NULL THEN duration_us / 1000 ELSE NULL END AS duration_ms,
    severity,
    error_number,
    error_message,
    wait_type,
    wait_resource,
    deadlock_xml,
    object_name,
    @@SERVERNAME AS server,
    NULL AS file_name,
    NULL AS file_offset
  FROM events
  WHERE event_timestamp > @lastTimestamp
  ORDER BY event_timestamp ASC
`;

// -----------------------------------------------------------------------------
// Misc helpers
// -----------------------------------------------------------------------------

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try { return JSON.stringify(err); } catch { return String(err); }
}

/** Trim @@VERSION to a single useful line for the UI. */
function shortenVersion(v: string): string {
  if (!v) return v;
  const firstLine = v.split(/\r?\n/)[0]?.trim() ?? v;
  return firstLine.length > 200 ? `${firstLine.slice(0, 200)}…` : firstLine;
}