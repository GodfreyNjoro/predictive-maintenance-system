/**
 * MySQL connector adapter.
 *
 * Implements the DB-agnostic `DbConnector` contract for MySQL / MariaDB.
 * Uses `mysql2/promise` driver. Phase 4 ships three feeds:
 *   - queryStore  → performance_schema.events_statements_summary_by_digest
 *   - waitStats   → performance_schema.events_waits_summary_global_by_event_name
 *   - ioStats     → performance_schema.file_summary_by_instance
 */

import mysql from "mysql2/promise";
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
import { getMysqlMapper } from "../mappers/mysql";
import {
  mysqlQueryDigestMapper,
  type MysqlQueryDigestCursor,
  type MysqlQueryDigestCounterRow,
  type MysqlQueryDigestRawRow,
} from "../mappers/mysql/query-digest";
import {
  mysqlWaitSummaryMapper,
  type MysqlWaitSummaryCursor,
  type MysqlWaitSummaryCounterRow,
  type MysqlWaitSummaryRawRow,
} from "../mappers/mysql/wait-summary";
import {
  mysqlIoSummaryMapper,
  type MysqlIoSummaryCursor,
  type MysqlIoSummaryCounterRow,
  type MysqlIoSummaryRawRow,
} from "../mappers/mysql/io-summary";

const PULL_ROW_CAP = 5000;
const CONNECT_TIMEOUT_MS = 10_000;
const POOL_MAX = 2;

interface MysqlConnectionParams {
  ssl?: boolean;
  charset?: string;
}

export class MysqlConnector implements DbConnector {
  public readonly kind = "MYSQL" as const;
  private readonly pools = new Map<string, mysql.Pool>();

  async testConnection(ds: PrismaDataSource): Promise<ConnectionTestResult> {
    const startedAt = Date.now();
    try {
      const pool = this.getPool(ds);
      const conn = await pool.getConnection();
      try {
        const [rows] = await conn.query<any[]>("SELECT VERSION() AS version");
        const version = rows[0]?.version ?? "unknown";
        const capabilities = await this.probeCapabilities(conn);
        return {
          ok: true,
          message: `Connected to MySQL ${version}`,
          serverVersion: version,
          capabilities,
          latencyMs: Date.now() - startedAt,
        };
      } finally {
        conn.release();
      }
    } catch (err) {
      return {
        ok: false,
        message: errorMessage(err),
        latencyMs: Date.now() - startedAt,
      };
    }
  }

  async listFeeds(ds: PrismaDataSource): Promise<FeedDescriptor[]> {
    let perfSchemaEnabled = false;
    let statementsDigestAvailable = false;

    try {
      const pool = this.getPool(ds);
      const conn = await pool.getConnection();
      try {
        // Check performance_schema
        const [rows] = await conn.query<any[]>(
          "SELECT @@performance_schema AS ps",
        );
        perfSchemaEnabled = rows[0]?.ps === 1;

        if (perfSchemaEnabled) {
          const [digest] = await conn.query<any[]>(
            `SELECT COUNT(*) AS cnt FROM performance_schema.events_statements_summary_by_digest LIMIT 1`,
          );
          statementsDigestAvailable = (digest[0]?.cnt ?? 0) >= 0;
        }
      } finally {
        conn.release();
      }
    } catch {
      // Probe failure
    }

    const feeds: FeedDescriptor[] = [
      {
        feed: "queryStore",
        kind: "cumulative",
        parsedSource: "MySQL.QueryDigest",
        defaultIntervalSec: 300,
        description: "Query digest stats from performance_schema.events_statements_summary_by_digest.",
        available: statementsDigestAvailable,
        unavailableReason: statementsDigestAvailable
          ? undefined
          : "performance_schema is not enabled or events_statements_summary_by_digest is not accessible.",
      },
      {
        feed: "waitStats",
        kind: "cumulative",
        parsedSource: "MySQL.WaitSummary",
        defaultIntervalSec: 60,
        description: "Global wait summary from performance_schema.events_waits_summary_global_by_event_name.",
        available: perfSchemaEnabled,
        unavailableReason: perfSchemaEnabled
          ? undefined
          : "performance_schema is not enabled. Set performance_schema=ON in my.cnf.",
      },
      {
        feed: "ioStats",
        kind: "cumulative",
        parsedSource: "MySQL.IoSummary",
        defaultIntervalSec: 300,
        description: "File IO stats from performance_schema.file_summary_by_instance.",
        available: perfSchemaEnabled,
        unavailableReason: perfSchemaEnabled
          ? undefined
          : "performance_schema is not enabled.",
      },
      {
        feed: "jobHistory",
        kind: "event",
        parsedSource: "MySQL.JobHistory",
        defaultIntervalSec: 60,
        description: "MySQL Event Scheduler history.",
        available: false,
        unavailableReason: "Reserved for Phase 5.",
      },
      {
        feed: "errorLog",
        kind: "event",
        parsedSource: "MySQL.ErrorLog",
        defaultIntervalSec: 300,
        description: "MySQL error log via performance_schema.error_log (MySQL 8.0.22+).",
        available: false,
        unavailableReason: "Reserved for Phase 5.",
      },
      {
        feed: "spExec",
        kind: "event",
        parsedSource: "MySQL.SpExec",
        defaultIntervalSec: 60,
        description: "N/A — not yet implemented.",
        available: false,
        unavailableReason: "Reserved for Phase 5.",
      },
      {
        feed: "xevents",
        kind: "event",
        parsedSource: "MySQL.XEvents",
        defaultIntervalSec: 60,
        description: "N/A for MySQL.",
        available: false,
        unavailableReason: "Extended Events are an MSSQL concept.",
      },
      {
        feed: "osMetrics",
        kind: "interval",
        parsedSource: "MySQL.OsMetrics",
        defaultIntervalSec: 60,
        description: "Connection pressure, threads, buffer pool, pending IO from SHOW GLOBAL STATUS + performance_schema.",
        available: perfSchemaEnabled,
        unavailableReason: perfSchemaEnabled
          ? undefined
          : "Requires performance_schema = ON in my.cnf.",
      },
    ];

    return feeds;
  }

  async pull(ds: PrismaDataSource, feed: FeedId, cursor: unknown): Promise<PullResult> {
    switch (feed) {
      case "queryStore":
        return this.pullQueryDigest(ds, cursor);
      case "waitStats":
        return this.pullWaitSummary(ds, cursor);
      case "ioStats":
        return this.pullIoSummary(ds, cursor);
      case "osMetrics":
        return this.pullOsMetrics(ds, cursor);
      default:
        throw new Error(
          `MySQL.pull('${feed}') is not implemented. Available: queryStore, waitStats, ioStats, osMetrics.`,
        );
    }
  }

  private async pullQueryDigest(ds: PrismaDataSource, cursor: unknown): Promise<PullResult> {
    const previous = parseMysqlQueryDigestCursor(cursor);
    const pool = this.getPool(ds);
    const conn = await pool.getConnection();
    try {
      const [rows] = await conn.query<any[]>(
        `SELECT
           COALESCE(DIGEST, '') AS digest,
           COALESCE(DIGEST_TEXT, '') AS digest_text,
           SCHEMA_NAME AS schema_name,
           COUNT_STAR AS count_star,
           SUM_TIMER_WAIT AS sum_timer_wait,
           AVG_TIMER_WAIT AS avg_timer_wait,
           SUM_ROWS_EXAMINED AS sum_rows_examined,
           SUM_ROWS_SENT AS sum_rows_sent,
           FIRST_SEEN AS first_seen,
           LAST_SEEN AS last_seen,
           NOW() AS snapshot_time
         FROM performance_schema.events_statements_summary_by_digest
         WHERE COUNT_STAR > 0 AND DIGEST IS NOT NULL
         ORDER BY SUM_TIMER_WAIT DESC
         LIMIT ?`,
        [PULL_ROW_CAP],
      );
      const mapped = mysqlQueryDigestMapper.map(rows as MysqlQueryDigestRawRow[], previous, { redactSqlText: ds.redactSqlText });
      return {
        entries: mapped.entries,
        rowsFetched: rows.length,
        nextCursor: mapped.nextCursor,
        partial: false,
        syntheticEvents: mapped.syntheticEvents,
        note: mapped.note,
      };
    } finally {
      conn.release();
    }
  }

  private async pullWaitSummary(ds: PrismaDataSource, cursor: unknown): Promise<PullResult> {
    const previous = parseMysqlWaitSummaryCursor(cursor);
    const pool = this.getPool(ds);
    const conn = await pool.getConnection();
    try {
      const [rows] = await conn.query<any[]>(
        `SELECT
           EVENT_NAME AS event_name,
           COUNT_STAR AS count_star,
           SUM_TIMER_WAIT AS sum_timer_wait,
           AVG_TIMER_WAIT AS avg_timer_wait,
           NOW() AS snapshot_time
         FROM performance_schema.events_waits_summary_global_by_event_name
         WHERE COUNT_STAR > 0
         ORDER BY SUM_TIMER_WAIT DESC`,
      );
      const mapped = mysqlWaitSummaryMapper.map(rows as MysqlWaitSummaryRawRow[], previous);
      return {
        entries: mapped.entries,
        rowsFetched: rows.length,
        nextCursor: mapped.nextCursor,
        partial: false,
        syntheticEvents: mapped.syntheticEvents,
        note: mapped.note,
      };
    } finally {
      conn.release();
    }
  }

  private async pullIoSummary(ds: PrismaDataSource, cursor: unknown): Promise<PullResult> {
    const previous = parseMysqlIoSummaryCursor(cursor);
    const pool = this.getPool(ds);
    const conn = await pool.getConnection();
    try {
      const [rows] = await conn.query<any[]>(
        `SELECT
           FILE_NAME AS file_name,
           EVENT_NAME AS event_name,
           COUNT_READ AS count_read,
           COUNT_WRITE AS count_write,
           SUM_TIMER_READ AS sum_timer_read,
           SUM_TIMER_WRITE AS sum_timer_write,
           SUM_NUMBER_OF_BYTES_READ AS sum_number_of_bytes_read,
           SUM_NUMBER_OF_BYTES_WRITTEN AS sum_number_of_bytes_written,
           NOW() AS snapshot_time
         FROM performance_schema.file_summary_by_instance
         WHERE COUNT_READ + COUNT_WRITE > 0
         ORDER BY SUM_TIMER_READ + SUM_TIMER_WRITE DESC
         LIMIT ?`,
        [PULL_ROW_CAP],
      );
      const mapped = mysqlIoSummaryMapper.map(rows as MysqlIoSummaryRawRow[], previous);
      return {
        entries: mapped.entries,
        rowsFetched: rows.length,
        nextCursor: mapped.nextCursor,
        partial: false,
        syntheticEvents: mapped.syntheticEvents,
        note: mapped.note,
      };
    } finally {
      conn.release();
    }
  }

  private async pullOsMetrics(ds: PrismaDataSource, cursor: unknown): Promise<PullResult> {
    const pool = this.getPool(ds);
    const conn = await pool.getConnection();
    try {
      const metrics: Array<{
        metric_name: string;
        metric_value: number;
        metric_unit: string;
        detail?: string;
        snapshot_time: string | Date;
      }> = [];
      const now = new Date();

      // 1) SHOW GLOBAL STATUS – grab key counters
      const statusKeys = [
        "Threads_connected",
        "Threads_running",
        "Max_used_connections",
        "Innodb_buffer_pool_reads",
        "Innodb_buffer_pool_read_requests",
        "Innodb_data_pending_reads",
        "Innodb_data_pending_writes",
        "Open_files",
        "Open_tables",
        "Uptime",
      ];
      try {
        const [statusRows] = await conn.query<any[]>("SHOW GLOBAL STATUS");
        const statusMap = new Map<string, string>();
        for (const r of statusRows) {
          statusMap.set(r.Variable_name, r.Value);
        }

        for (const key of statusKeys) {
          const val = statusMap.get(key);
          if (val !== undefined) {
            metrics.push({
              metric_name: key,
              metric_value: Number(val),
              metric_unit: key === "Uptime" ? "seconds" : "count",
              snapshot_time: now,
            });
          }
        }
      } catch (err) {
        console.warn("[MySQL OS-metrics] SHOW GLOBAL STATUS failed:", errorMessage(err));
      }

      // 2) max_connections from GLOBAL VARIABLES
      try {
        const [varRows] = await conn.query<any[]>(
          "SHOW GLOBAL VARIABLES WHERE Variable_name = 'max_connections'"
        );
        if (varRows[0]?.Value) {
          metrics.push({
            metric_name: "max_connections",
            metric_value: Number(varRows[0].Value),
            metric_unit: "count",
            snapshot_time: now,
          });
        }
      } catch (err) {
        console.warn("[MySQL OS-metrics] max_connections query failed:", errorMessage(err));
      }

      // 3) Derive connection usage %
      const threadConn = metrics.find((m) => m.metric_name === "Threads_connected");
      const maxConn = metrics.find((m) => m.metric_name === "max_connections");
      if (threadConn && maxConn && maxConn.metric_value > 0) {
        metrics.push({
          metric_name: "connection_usage_pct",
          metric_value: Math.round((threadConn.metric_value / maxConn.metric_value) * 10000) / 100,
          metric_unit: "percent",
          detail: `${threadConn.metric_value}/${maxConn.metric_value}`,
          snapshot_time: now,
        });
      }

      // 4) Derive buffer pool miss ratio
      const bpReads = metrics.find((m) => m.metric_name === "Innodb_buffer_pool_reads");
      const bpRequests = metrics.find((m) => m.metric_name === "Innodb_buffer_pool_read_requests");
      if (bpReads && bpRequests && bpRequests.metric_value > 0) {
        metrics.push({
          metric_name: "buffer_pool_miss_pct",
          metric_value:
            Math.round((bpReads.metric_value / bpRequests.metric_value) * 10000) / 100,
          metric_unit: "percent",
          detail: `${bpReads.metric_value} disk reads / ${bpRequests.metric_value} requests`,
          snapshot_time: now,
        });
      }

      // 5) Derive pending IO total
      const pendR = metrics.find((m) => m.metric_name === "Innodb_data_pending_reads");
      const pendW = metrics.find((m) => m.metric_name === "Innodb_data_pending_writes");
      if (pendR && pendW) {
        metrics.push({
          metric_name: "pending_io_total",
          metric_value: pendR.metric_value + pendW.metric_value,
          metric_unit: "count",
          detail: `reads=${pendR.metric_value} writes=${pendW.metric_value}`,
          snapshot_time: now,
        });
      }

      if (metrics.length === 0) {
        return { entries: [], rowsFetched: 0, nextCursor: cursor, partial: false };
      }

      const { mysqlOsMetricsMapper } = await import("../mappers/mysql/os-metrics");
      const mapped = mysqlOsMetricsMapper.map(metrics, cursor as import("../mappers/mysql/os-metrics").MysqlOsMetricsCursor | null);
      return {
        entries: mapped.entries,
        rowsFetched: metrics.length,
        nextCursor: mapped.nextCursor,
        partial: false,
        syntheticEvents: mapped.syntheticEvents,
        note: mapped.note,
      };
    } finally {
      conn.release();
    }
  }

  async close(): Promise<void> {
    const live = Array.from(this.pools.values());
    this.pools.clear();
    await Promise.allSettled(live.map((p) => p.end()));
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private getPool(ds: PrismaDataSource): mysql.Pool {
    const cached = this.pools.get(ds.id);
    if (cached) return cached;

    const config = buildMysqlPoolConfig(ds);
    const pool = mysql.createPool(config);
    this.pools.set(ds.id, pool);
    return pool;
  }

  private async probeCapabilities(conn: mysql.PoolConnection): Promise<Record<string, boolean | string | number>> {
    const caps: Record<string, boolean | string | number> = {};
    try {
      const [rows] = await conn.query<any[]>("SELECT @@performance_schema AS ps");
      caps.performanceSchema = rows[0]?.ps === 1;
    } catch {
      caps.performanceSchema = false;
    }
    return caps;
  }
}

// ---------------------------------------------------------------------------
// Pool config builder
// ---------------------------------------------------------------------------

function buildMysqlPoolConfig(ds: PrismaDataSource): mysql.PoolOptions {
  const dec = decryptDataSource(ds);
  const params = (dec.connectionParams ?? {}) as MysqlConnectionParams;

  const config: mysql.PoolOptions = {
    host: dec.host,
    port: dec.port,
    database: dec.database,
    user: dec.username ?? undefined,
    password: dec.password ?? undefined,
    connectTimeout: CONNECT_TIMEOUT_MS,
    connectionLimit: POOL_MAX,
    charset: params.charset ?? "utf8mb4",
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,
  };

  if (params.ssl) {
    config.ssl = { rejectUnauthorized: false };
  }

  return config;
}

// ---------------------------------------------------------------------------
// Cursor parsers
// ---------------------------------------------------------------------------

function parseMysqlQueryDigestCursor(c: unknown): MysqlQueryDigestCursor | null {
  if (!c || typeof c !== "object") return null;
  const obj = c as Record<string, unknown>;
  return {
    lastQueryAt: typeof obj.lastQueryAt === "string" ? obj.lastQueryAt : null,
    counters:
      obj.counters && typeof obj.counters === "object" && !Array.isArray(obj.counters)
        ? (obj.counters as Record<string, MysqlQueryDigestCounterRow>)
        : {},
  };
}

function parseMysqlWaitSummaryCursor(c: unknown): MysqlWaitSummaryCursor | null {
  if (!c || typeof c !== "object") return null;
  const obj = c as Record<string, unknown>;
  return {
    lastSnapshotAt: typeof obj.lastSnapshotAt === "string" ? obj.lastSnapshotAt : null,
    counters:
      obj.counters && typeof obj.counters === "object" && !Array.isArray(obj.counters)
        ? (obj.counters as Record<string, MysqlWaitSummaryCounterRow>)
        : {},
  };
}

function parseMysqlIoSummaryCursor(c: unknown): MysqlIoSummaryCursor | null {
  if (!c || typeof c !== "object") return null;
  const obj = c as Record<string, unknown>;
  return {
    lastSnapshotAt: typeof obj.lastSnapshotAt === "string" ? obj.lastSnapshotAt : null,
    counters:
      obj.counters && typeof obj.counters === "object" && !Array.isArray(obj.counters)
        ? (obj.counters as Record<string, MysqlIoSummaryCounterRow>)
        : {},
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try { return JSON.stringify(err); } catch { return String(err); }
}

// ---------------------------------------------------------------------------
// Module-load registration
// ---------------------------------------------------------------------------

registerConnector("MYSQL", () => new MysqlConnector());

export default MysqlConnector;
