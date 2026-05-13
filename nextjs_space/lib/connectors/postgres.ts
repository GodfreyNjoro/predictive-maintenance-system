/**
 * PostgreSQL connector adapter.
 *
 * Implements the DB-agnostic `DbConnector` contract for PostgreSQL.
 * Uses the `pg` driver. Phase 4 ships three feeds:
 *   - queryStore  → pg_stat_statements
 *   - waitStats   → pg_stat_activity (wait_event snapshot)
 *   - ioStats     → pg_stat_io (PG16+) or pg_statio_user_tables
 *
 * Future phases can add:
 *   - jobHistory  → pg_cron / pgAgent history
 *   - errorLog    → csvlog / pg_log parsing
 *   - spExec      → pg_stat_user_functions
 */

import { Pool, type PoolConfig } from "pg";
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
import { getPostgresMapper } from "../mappers/postgres";
import {
  pgQueryStatsMapper,
  type PgQueryStatsCursor,
  type PgQueryStatsCounterRow,
  type PgQueryStatsRawRow,
} from "../mappers/postgres/query-stats";
import {
  pgWaitEventsMapper,
  type PgWaitEventsCursor,
  type PgWaitEventRawRow,
} from "../mappers/postgres/wait-events";
import {
  pgIoStatsMapper,
  type PgIoStatsCursor,
  type PgIoStatsCounterRow,
  type PgIoStatsRawRow,
} from "../mappers/postgres/io-stats";

const PULL_ROW_CAP = 5000;
const CONNECT_TIMEOUT_MS = 10_000;
const QUERY_TIMEOUT_MS = 30_000;
const POOL_MAX = 2;
const POOL_IDLE_TIMEOUT_MS = 30_000;

interface PgConnectionParams {
  schema?: string;
  sslMode?: "disable" | "require" | "verify-ca" | "verify-full";
  ssl?: boolean;
  applicationName?: string;
}

export class PostgresConnector implements DbConnector {
  public readonly kind = "POSTGRES" as const;
  private readonly pools = new Map<string, Pool>();

  async testConnection(ds: PrismaDataSource): Promise<ConnectionTestResult> {
    const startedAt = Date.now();
    try {
      const pool = await this.getPool(ds);
      const client = await pool.connect();
      try {
        const vRes = await client.query("SELECT version() AS version");
        const version = vRes.rows[0]?.version ?? "unknown";
        const capabilities = await this.probeCapabilities(client);
        return {
          ok: true,
          message: `Connected to PostgreSQL`,
          serverVersion: shortenVersion(version),
          capabilities,
          latencyMs: Date.now() - startedAt,
        };
      } finally {
        client.release();
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
    let pgStatStatementsAvailable = false;
    let pgStatIoAvailable = false;
    let pgVersion = 0;

    try {
      const pool = await this.getPool(ds);
      const client = await pool.connect();
      try {
        // Check pg_stat_statements extension
        const extRes = await client.query(
          `SELECT 1 FROM pg_available_extensions WHERE name = 'pg_stat_statements' AND installed_version IS NOT NULL`,
        );
        pgStatStatementsAvailable = (extRes.rows?.length ?? 0) > 0;

        // Check PG version for pg_stat_io (PG16+)
        const verRes = await client.query("SHOW server_version_num");
        pgVersion = parseInt(verRes.rows[0]?.server_version_num ?? "0", 10);
        pgStatIoAvailable = pgVersion >= 160000;
      } finally {
        client.release();
      }
    } catch {
      // Probe failure
    }

    const feeds: FeedDescriptor[] = [
      {
        feed: "queryStore",
        kind: "cumulative",
        parsedSource: "Postgres.QueryStats",
        defaultIntervalSec: 300,
        description: "Query execution stats from pg_stat_statements.",
        available: pgStatStatementsAvailable,
        unavailableReason: pgStatStatementsAvailable
          ? undefined
          : "pg_stat_statements extension is not installed. Run: CREATE EXTENSION IF NOT EXISTS pg_stat_statements;",
      },
      {
        feed: "waitStats",
        kind: "interval",
        parsedSource: "Postgres.WaitEvents",
        defaultIntervalSec: 60,
        description: "Active wait events from pg_stat_activity.",
        available: true, // Always available in PG9.6+
      },
      {
        feed: "ioStats",
        kind: "cumulative",
        parsedSource: "Postgres.IoStats",
        defaultIntervalSec: 300,
        description: `IO statistics from ${pgVersion >= 160000 ? "pg_stat_io" : "pg_statio_user_tables"}.`,
        available: true,
      },
      {
        feed: "jobHistory",
        kind: "event",
        parsedSource: "Postgres.JobHistory",
        defaultIntervalSec: 60,
        description: "pg_cron / pgAgent job history.",
        available: false,
        unavailableReason: "Reserved for Phase 5 — pg_cron support not yet shipped.",
      },
      {
        feed: "spExec",
        kind: "cumulative",
        parsedSource: "Postgres.FunctionStats",
        defaultIntervalSec: 300,
        description: "Function/procedure stats from pg_stat_user_functions.",
        available: false,
        unavailableReason: "Reserved for Phase 5.",
      },
      {
        feed: "errorLog",
        kind: "event",
        parsedSource: "Postgres.ErrorLog",
        defaultIntervalSec: 300,
        description: "PostgreSQL server log (csvlog).",
        available: false,
        unavailableReason: "Reserved for Phase 5 — csvlog ingestion not yet shipped.",
      },
      {
        feed: "xevents",
        kind: "event",
        parsedSource: "Postgres.XEvents",
        defaultIntervalSec: 60,
        description: "N/A for PostgreSQL.",
        available: false,
        unavailableReason: "Extended Events are an MSSQL concept. Postgres equivalents are captured via other feeds.",
      },
      {
        feed: "osMetrics",
        kind: "interval",
        parsedSource: "Postgres.OsMetrics",
        defaultIntervalSec: 60,
        description: "Connection pressure, rollback ratio, deadlocks, temp usage from pg_stat_database + pg_stat_activity.",
        available: true,
      },
    ];

    return feeds;
  }

  async pull(ds: PrismaDataSource, feed: FeedId, cursor: unknown): Promise<PullResult> {
    switch (feed) {
      case "queryStore":
        return this.pullQueryStats(ds, cursor);
      case "waitStats":
        return this.pullWaitEvents(ds, cursor);
      case "ioStats":
        return this.pullIoStats(ds, cursor);
      case "osMetrics":
        return this.pullOsMetrics(ds, cursor);
      default:
        throw new Error(
          `Postgres.pull('${feed}') is not implemented in this build. ` +
            `Available: queryStore, waitStats, ioStats, osMetrics.`,
        );
    }
  }

  private async pullQueryStats(ds: PrismaDataSource, cursor: unknown): Promise<PullResult> {
    const previous = parsePgQueryStatsCursor(cursor);
    const pool = await this.getPool(ds);
    const client = await pool.connect();
    try {
      const result = await client.query<PgQueryStatsRawRow>(
        `SELECT
           s.queryid::text          AS queryid,
           s.query                  AS query,
           s.calls::bigint          AS calls,
           s.total_exec_time        AS total_exec_time,
           s.mean_exec_time         AS mean_exec_time,
           s.rows::bigint           AS rows,
           s.shared_blks_hit::bigint AS shared_blks_hit,
           s.shared_blks_read::bigint AS shared_blks_read,
           COALESCE(s.blk_read_time, 0) AS blk_read_time,
           COALESCE(s.blk_write_time, 0) AS blk_write_time,
           d.datname                AS datname,
           NOW()                    AS snapshot_time
         FROM pg_stat_statements s
         JOIN pg_database d ON d.oid = s.dbid
         WHERE s.calls > 0
         ORDER BY s.total_exec_time DESC
         LIMIT $1`,
        [PULL_ROW_CAP],
      );
      const rows = result.rows ?? [];
      const mapped = pgQueryStatsMapper.map(rows, previous, { redactSqlText: ds.redactSqlText });
      return {
        entries: mapped.entries,
        rowsFetched: rows.length,
        nextCursor: mapped.nextCursor,
        partial: false,
        syntheticEvents: mapped.syntheticEvents,
        note: mapped.note,
      };
    } finally {
      client.release();
    }
  }

  private async pullWaitEvents(ds: PrismaDataSource, cursor: unknown): Promise<PullResult> {
    const previous = parsePgWaitEventsCursor(cursor);
    const pool = await this.getPool(ds);
    const client = await pool.connect();
    try {
      const result = await client.query<PgWaitEventRawRow>(
        `SELECT
           wait_event_type,
           wait_event,
           COUNT(*)::int AS count,
           datname,
           NOW() AS snapshot_time
         FROM pg_stat_activity
         WHERE state = 'active'
           AND wait_event_type IS NOT NULL
           AND wait_event IS NOT NULL
           AND pid <> pg_backend_pid()
         GROUP BY wait_event_type, wait_event, datname
         ORDER BY count DESC`,
      );
      const rows = result.rows ?? [];
      const mapped = pgWaitEventsMapper.map(rows, previous);
      return {
        entries: mapped.entries,
        rowsFetched: rows.length,
        nextCursor: mapped.nextCursor,
        partial: false,
        syntheticEvents: mapped.syntheticEvents,
        note: mapped.note,
      };
    } finally {
      client.release();
    }
  }

  private async pullIoStats(ds: PrismaDataSource, cursor: unknown): Promise<PullResult> {
    const previous = parsePgIoStatsCursor(cursor);
    const pool = await this.getPool(ds);
    const client = await pool.connect();
    try {
      // Check if pg_stat_io exists (PG16+)
      const checkRes = await client.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = 'pg_catalog' AND table_name = 'pg_stat_io'`,
      );
      const hasPgStatIo = (checkRes.rows?.length ?? 0) > 0;

      let rows: PgIoStatsRawRow[];
      if (hasPgStatIo) {
        const result = await client.query<PgIoStatsRawRow>(
          `SELECT
             backend_type,
             object           AS io_object,
             context          AS io_context,
             COALESCE(reads, 0)::bigint   AS reads,
             COALESCE(writes, 0)::bigint  AS writes,
             COALESCE(hits, 0)::bigint    AS hits,
             COALESCE(read_time, 0)       AS read_time,
             COALESCE(write_time, 0)      AS write_time,
             NOW()                        AS snapshot_time
           FROM pg_stat_io
           WHERE COALESCE(reads, 0) + COALESCE(writes, 0) + COALESCE(hits, 0) > 0`,
        );
        rows = result.rows ?? [];
      } else {
        // Fallback: pg_statio_user_tables for older PG versions
        const result = await client.query<PgIoStatsRawRow>(
          `SELECT
             'client backend'         AS backend_type,
             'relation'               AS io_object,
             schemaname || '.' || relname AS io_context,
             COALESCE(heap_blks_read, 0)::bigint + COALESCE(idx_blks_read, 0)::bigint AS reads,
             0::bigint                AS writes,
             COALESCE(heap_blks_hit, 0)::bigint + COALESCE(idx_blks_hit, 0)::bigint AS hits,
             NULL::double precision   AS read_time,
             NULL::double precision   AS write_time,
             NOW()                    AS snapshot_time
           FROM pg_statio_user_tables
           WHERE COALESCE(heap_blks_read, 0) + COALESCE(idx_blks_read, 0) +
                 COALESCE(heap_blks_hit, 0) + COALESCE(idx_blks_hit, 0) > 0`,
        );
        rows = result.rows ?? [];
      }

      const mapped = pgIoStatsMapper.map(rows, previous);
      return {
        entries: mapped.entries,
        rowsFetched: rows.length,
        nextCursor: mapped.nextCursor,
        partial: false,
        syntheticEvents: mapped.syntheticEvents,
        note: mapped.note,
      };
    } finally {
      client.release();
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

  private async getPool(ds: PrismaDataSource): Promise<Pool> {
    const cached = this.pools.get(ds.id);
    if (cached) return cached;

    const config = buildPgPoolConfig(ds);
    const pool = new Pool(config);
    pool.on("error", (err: Error) => {
      console.error(
        `[PostgresConnector] pool error on ${JSON.stringify(redactForLog(ds))}: ${err.message}`,
      );
    });
    this.pools.set(ds.id, pool);
    return pool;
  }

  private async probeCapabilities(client: any): Promise<Record<string, boolean | string | number>> {
    const caps: Record<string, boolean | string | number> = {};
    try {
      const ext = await client.query(
        `SELECT 1 FROM pg_available_extensions WHERE name = 'pg_stat_statements' AND installed_version IS NOT NULL`,
      );
      caps.pgStatStatements = (ext.rows?.length ?? 0) > 0;
    } catch {
      caps.pgStatStatements = false;
    }
    try {
      const ver = await client.query("SHOW server_version_num");
      const v = parseInt(ver.rows[0]?.server_version_num ?? "0", 10);
      caps.pgVersion = v;
      caps.pgStatIo = v >= 160000;
    } catch {
      caps.pgStatIo = false;
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
    const client = await this.getPool(ds);
    const now = new Date();
    const snapshotTime = now.toISOString();
    const rows: import("../mappers/postgres/os-metrics").PgOsMetricsRawRow[] = [];

    // 1. Connection usage (current_connections / max_connections)
    try {
      const r = await client.query<{ current: string; max: string }>(
        `SELECT
           (SELECT count(*)::text FROM pg_stat_activity) AS current,
           current_setting('max_connections') AS max`,
      );
      const row = r.rows[0];
      if (row) {
        const current = parseInt(row.current, 10);
        const max = parseInt(row.max, 10);
        const pct = max > 0 ? Math.round((current / max) * 100 * 10) / 10 : 0;
        rows.push(
          { metric_name: "connections_current", metric_value: current, metric_unit: "", snapshot_time: snapshotTime },
          { metric_name: "connections_max", metric_value: max, metric_unit: "", snapshot_time: snapshotTime },
          { metric_name: "connection_usage_pct", metric_value: pct, metric_unit: "%", snapshot_time: snapshotTime },
        );
      }
    } catch { /* skip */ }

    // 2. Database stats (rollback ratio, deadlocks, temp bytes)
    try {
      const dbName = (ds.database as string) || "postgres";
      const r = await client.query<{
        xact_commit: string;
        xact_rollback: string;
        deadlocks: string;
        temp_bytes: string;
        blks_hit: string;
        blks_read: string;
      }>(
        `SELECT xact_commit::text, xact_rollback::text, deadlocks::text,
                temp_bytes::text, blks_hit::text, blks_read::text
         FROM pg_stat_database WHERE datname = $1`,
        [dbName],
      );
      const row = r.rows[0];
      if (row) {
        const commits = parseInt(row.xact_commit, 10);
        const rollbacks = parseInt(row.xact_rollback, 10);
        const total = commits + rollbacks;
        const rollbackPct = total > 0 ? Math.round((rollbacks / total) * 100 * 10) / 10 : 0;
        const tempMb = Math.round(parseInt(row.temp_bytes, 10) / (1024 * 1024));
        const hit = parseInt(row.blks_hit, 10);
        const read = parseInt(row.blks_read, 10);
        const cacheHitPct = (hit + read) > 0 ? Math.round((hit / (hit + read)) * 100 * 10) / 10 : 100;

        rows.push(
          { metric_name: "rollback_ratio_pct", metric_value: rollbackPct, metric_unit: "%", snapshot_time: snapshotTime },
          { metric_name: "deadlocks", metric_value: parseInt(row.deadlocks, 10), metric_unit: "", snapshot_time: snapshotTime },
          { metric_name: "temp_bytes_mb", metric_value: tempMb, metric_unit: "MB", snapshot_time: snapshotTime },
          { metric_name: "cache_hit_pct", metric_value: cacheHitPct, metric_unit: "%", snapshot_time: snapshotTime },
        );
      }
    } catch { /* skip */ }

    // 3. Active queries count
    try {
      const r = await client.query<{ active: string }>(
        `SELECT count(*)::text AS active FROM pg_stat_activity WHERE state = 'active'`,
      );
      if (r.rows[0]) {
        rows.push({
          metric_name: "active_queries",
          metric_value: parseInt(r.rows[0].active, 10),
          metric_unit: "",
          snapshot_time: snapshotTime,
        });
      }
    } catch { /* skip */ }

    const { pgOsMetricsMapper } = await import("../mappers/postgres/os-metrics");
    const result = pgOsMetricsMapper.map(rows, cursor as any);

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

// ---------------------------------------------------------------------------
// Pool config builder
// ---------------------------------------------------------------------------

function buildPgPoolConfig(ds: PrismaDataSource): PoolConfig {
  const dec = decryptDataSource(ds);
  const params = (dec.connectionParams ?? {}) as PgConnectionParams;

  const config: PoolConfig = {
    host: dec.host,
    port: dec.port,
    database: dec.database,
    user: dec.username ?? undefined,
    password: dec.password ?? undefined,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
    max: POOL_MAX,
    idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
    application_name: params.applicationName ?? "pms-collector",
  };

  // SSL configuration
  const sslMode = params.sslMode ?? (params.ssl ? "require" : undefined);
  if (sslMode === "require") {
    config.ssl = { rejectUnauthorized: false };
  } else if (sslMode === "verify-ca" || sslMode === "verify-full") {
    config.ssl = { rejectUnauthorized: true };
  }
  // "disable" or undefined → no SSL by default (trust on-prem)

  // Search path
  if (params.schema) {
    (config as any).options = `--search_path=${params.schema}`;
  }

  return config;
}

// ---------------------------------------------------------------------------
// Cursor parsers
// ---------------------------------------------------------------------------

function parsePgQueryStatsCursor(c: unknown): PgQueryStatsCursor | null {
  if (!c || typeof c !== "object") return null;
  const obj = c as Record<string, unknown>;
  return {
    lastQueryAt:
      typeof obj.lastQueryAt === "string" ? obj.lastQueryAt : null,
    counters:
      obj.counters && typeof obj.counters === "object" && !Array.isArray(obj.counters)
        ? (obj.counters as Record<string, PgQueryStatsCounterRow>)
        : {},
  };
}

function parsePgWaitEventsCursor(c: unknown): PgWaitEventsCursor | null {
  if (!c || typeof c !== "object") return null;
  const obj = c as Record<string, unknown>;
  return {
    lastSnapshotAt:
      typeof obj.lastSnapshotAt === "string" ? obj.lastSnapshotAt : null,
  };
}

function parsePgIoStatsCursor(c: unknown): PgIoStatsCursor | null {
  if (!c || typeof c !== "object") return null;
  const obj = c as Record<string, unknown>;
  return {
    lastSnapshotAt:
      typeof obj.lastSnapshotAt === "string" ? obj.lastSnapshotAt : null,
    counters:
      obj.counters && typeof obj.counters === "object" && !Array.isArray(obj.counters)
        ? (obj.counters as Record<string, PgIoStatsCounterRow>)
        : {},
  };
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try { return JSON.stringify(err); } catch { return String(err); }
}

function shortenVersion(v: string): string {
  if (!v) return v;
  const firstLine = v.split(/\r?\n/)[0]?.trim() ?? v;
  return firstLine.length > 200 ? `${firstLine.slice(0, 200)}…` : firstLine;
}

// ---------------------------------------------------------------------------
// Module-load registration
// ---------------------------------------------------------------------------

registerConnector("POSTGRES", () => new PostgresConnector());

export default PostgresConnector;
