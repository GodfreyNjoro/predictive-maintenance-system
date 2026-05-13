/**
 * Test Harness — Synthetic Telemetry Generator
 *
 * POST /api/test-harness/generate
 *
 * Creates a test Application + DataSource (idempotent), then generates
 * realistic synthetic telemetry for chosen feeds and ingests it through
 * the same pipeline as real data.
 *
 * Body: {
 *   feeds: FeedId[],          // which feeds to generate
 *   scenario: "healthy" | "degraded" | "critical",
 *   rowsPerFeed: number,      // 10–500
 * }
 */
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";
import type { FeedId } from "@/lib/connectors/types";

const TEST_APP_NAME = "PMS Test Harness";
const TEST_DS_NAME = "Test-MSSQL-01";

const ALL_FEEDS: FeedId[] = [
  "jobHistory", "queryStore", "spExec", "waitStats", "ioStats",
  "xevents", "errorLog", "osMetrics",
  "appMetrics", "appLogs", "windowsEventLog", "iisLogs", "networkMetrics",
];

type Scenario = "healthy" | "degraded" | "critical";

// ── helpers ──────────────────────────────────────────────────────────

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function rand(min: number, max: number) { return Math.random() * (max - min) + min; }
function randInt(min: number, max: number) { return Math.floor(rand(min, max + 1)); }
function ts(base: Date, offsetMs: number) { return new Date(base.getTime() + offsetMs); }

function levelFor(scenario: Scenario): string {
  if (scenario === "critical") return pick(["critical", "critical", "error", "error", "warning"]);
  if (scenario === "degraded") return pick(["warning", "warning", "error", "info", "info"]);
  return pick(["info", "info", "info", "info", "warning"]);
}

// ── per-feed generators ──────────────────────────────────────────────

function genJobHistory(n: number, scenario: Scenario, base: Date) {
  const jobs = ["Backup_Full", "Index_Rebuild", "ETL_Nightly", "Stats_Update", "LogShip_Copy"];
  return Array.from({ length: n }, (_, i) => {
    const ok = scenario === "healthy" ? Math.random() > 0.05 : scenario === "degraded" ? Math.random() > 0.25 : Math.random() > 0.5;
    return {
      timestamp: ts(base, i * 60_000).toISOString(),
      logLevel: ok ? "info" : "error",
      source: "MSSQL.JobHistory",
      message: `Job [${pick(jobs)}] ${ok ? "succeeded" : "FAILED"} — duration ${randInt(5, ok ? 120 : 3600)}s`,
      features: { run_status: ok ? 1 : 0, duration_seconds: randInt(5, 3600) },
    };
  });
}

function genQueryStore(n: number, scenario: Scenario, base: Date) {
  const queries = ["SELECT * FROM Orders WHERE…", "INSERT INTO AuditLog…", "UPDATE Inventory SET…", "EXEC usp_ProcessBatch…"];
  return Array.from({ length: n }, (_, i) => ({
    timestamp: ts(base, i * 30_000).toISOString(),
    logLevel: levelFor(scenario),
    source: "MSSQL.QueryStore",
    message: `${pick(queries)} — avg ${scenario === "critical" ? randInt(5000, 30000) : scenario === "degraded" ? randInt(500, 5000) : randInt(10, 500)}ms, ${randInt(100, 50000)} executions`,
    features: { avg_duration_ms: scenario === "critical" ? randInt(5000, 30000) : randInt(10, 500), exec_count: randInt(100, 50000) },
  }));
}

function genSpExec(n: number, scenario: Scenario, base: Date) {
  const sps = ["usp_ProcessOrder", "usp_GenerateReport", "usp_SyncInventory", "usp_RecalcPricing"];
  return Array.from({ length: n }, (_, i) => {
    const hasErr = scenario === "critical" ? Math.random() > 0.4 : scenario === "degraded" ? Math.random() > 0.75 : Math.random() > 0.95;
    return {
      timestamp: ts(base, i * 20_000).toISOString(),
      logLevel: hasErr ? "error" : "info",
      source: "MSSQL.SpExec",
      message: `${pick(sps)} — ${hasErr ? "ERROR 8152: String truncation" : "OK"} (${randInt(10, hasErr ? 15000 : 200)}ms)`,
      features: { duration_ms: randInt(10, 15000), has_error: hasErr ? 1 : 0 },
    };
  });
}

function genWaitStats(n: number, scenario: Scenario, base: Date) {
  const waits = ["CXPACKET", "PAGEIOLATCH_SH", "LCK_M_X", "WRITELOG", "ASYNC_NETWORK_IO", "SOS_SCHEDULER_YIELD", "RESOURCE_SEMAPHORE"];
  return Array.from({ length: n }, (_, i) => {
    const wt = pick(waits);
    const ms = scenario === "critical" ? randInt(50000, 500000) : scenario === "degraded" ? randInt(5000, 60000) : randInt(100, 5000);
    return {
      timestamp: ts(base, i * 60_000).toISOString(),
      logLevel: ms > 300000 ? "critical" : ms > 60000 ? "warning" : "info",
      source: "MSSQL.WaitStats",
      message: `${wt}: delta ${ms}ms / ${randInt(100, 10000)} waits — avg ${(ms / randInt(100, 10000)).toFixed(1)}ms`,
      features: { delta_wait_ms: ms, delta_wait_count: randInt(100, 10000) },
    };
  });
}

function genIoStats(n: number, scenario: Scenario, base: Date) {
  const files = ["Orders_Data.mdf", "tempdb.mdf", "Orders_Log.ldf", "AuditLog_Data.ndf"];
  return Array.from({ length: n }, (_, i) => {
    const lat = scenario === "critical" ? randInt(100, 500) : scenario === "degraded" ? randInt(30, 150) : randInt(1, 30);
    return {
      timestamp: ts(base, i * 60_000).toISOString(),
      logLevel: lat > 200 ? "critical" : lat > 50 ? "warning" : "info",
      source: "MSSQL.IoStats",
      message: `${pick(files)}: avg read ${lat}ms, avg write ${randInt(1, lat)}ms — ${randInt(1000, 100000)} ops`,
      features: { avg_read_latency_ms: lat, avg_write_latency_ms: randInt(1, lat) },
    };
  });
}

function genXEvents(n: number, scenario: Scenario, base: Date) {
  const events = scenario === "critical"
    ? ["deadlock_detected", "query_timeout", "deadlock_detected", "error_raised", "login_failure"]
    : scenario === "degraded"
    ? ["long_running_query", "query_timeout", "login_failure", "attention", "error_raised"]
    : ["rpc_completed", "sql_batch_completed", "attention", "login_success"];
  return Array.from({ length: n }, (_, i) => ({
    timestamp: ts(base, i * 15_000).toISOString(),
    logLevel: pick(events).includes("deadlock") ? "critical" : pick(events).includes("timeout") ? "error" : levelFor(scenario),
    source: "MSSQL.XEvents",
    message: `[XE] ${pick(events)} — session: system_health, database: OrdersDB`,
    features: { event_count: 1 },
  }));
}

function genErrorLog(n: number, scenario: Scenario, base: Date) {
  const msgs = scenario === "critical"
    ? ["I/O error detected on file Orders_Data.mdf", "Database corruption detected in table Orders", "Login failed for user 'svc_app'", "Deadlock victim chosen"]
    : scenario === "degraded"
    ? ["Autogrow of file 'tempdb' took 1500ms", "Login failed for user 'svc_app'", "Backup completed with warnings"]
    : ["Database backup completed successfully", "CHECKDB completed with no errors", "Recovery of database 'OrdersDB' complete"];
  return Array.from({ length: n }, (_, i) => ({
    timestamp: ts(base, i * 120_000).toISOString(),
    logLevel: levelFor(scenario),
    source: "MSSQL.ErrorLog",
    message: pick(msgs),
    features: { entry_count: 1 },
  }));
}

function genOsMetrics(n: number, scenario: Scenario, base: Date) {
  return Array.from({ length: n }, (_, i) => {
    const cpu = scenario === "critical" ? rand(85, 100) : scenario === "degraded" ? rand(60, 90) : rand(10, 60);
    const mem = scenario === "critical" ? rand(90, 99) : scenario === "degraded" ? rand(70, 92) : rand(30, 70);
    return {
      timestamp: ts(base, i * 60_000).toISOString(),
      logLevel: cpu > 95 || mem > 95 ? "critical" : cpu > 80 || mem > 85 ? "warning" : "info",
      source: "MSSQL.OsMetrics",
      message: `CPU: ${cpu.toFixed(1)}%, Memory: ${mem.toFixed(1)}%, Disk free: ${scenario === "critical" ? rand(0.5, 3) : rand(10, 200)}GB`,
      features: { cpu_pct: Math.round(cpu * 10) / 10, memory_pct: Math.round(mem * 10) / 10 },
    };
  });
}

function genAppMetrics(n: number, scenario: Scenario, base: Date) {
  const metrics = ["response_time_p95", "error_rate", "thread_pool_usage", "gc_time_pct", "request_queue_length"];
  return Array.from({ length: n }, (_, i) => {
    const m = pick(metrics);
    let val: number;
    if (m === "response_time_p95") val = scenario === "critical" ? rand(5000, 20000) : scenario === "degraded" ? rand(1500, 5000) : rand(50, 500);
    else if (m === "error_rate") val = scenario === "critical" ? rand(10, 40) : scenario === "degraded" ? rand(2, 12) : rand(0, 1.5);
    else if (m === "thread_pool_usage") val = scenario === "critical" ? rand(90, 100) : scenario === "degraded" ? rand(70, 92) : rand(20, 60);
    else if (m === "gc_time_pct") val = scenario === "critical" ? rand(25, 60) : scenario === "degraded" ? rand(8, 25) : rand(1, 8);
    else val = scenario === "critical" ? randInt(200, 1000) : scenario === "degraded" ? randInt(30, 200) : randInt(0, 20);
    return {
      timestamp: ts(base, i * 30_000).toISOString(),
      logLevel: val > (m === "response_time_p95" ? 5000 : m === "error_rate" ? 10 : 90) ? "critical" : val > (m === "response_time_p95" ? 2000 : m === "error_rate" ? 2 : 75) ? "warning" : "info",
      source: "App.Metrics",
      message: `[app] ${m} = ${typeof val === "number" ? val.toFixed(1) : val} ${m.includes("time") || m.includes("p95") ? "ms" : m.includes("rate") || m.includes("pct") || m.includes("usage") ? "%" : ""}`,
      features: { metric_value: Math.round(val * 100) / 100 },
    };
  });
}

function genAppLogs(n: number, scenario: Scenario, base: Date) {
  const critMsgs = ["System.OutOfMemoryException in OrderProcessor", "Unhandled exception in PaymentService", "Circuit breaker OPEN for InventoryAPI", "App pool recycled — worker process crash"];
  const warnMsgs = ["Connection timeout to Redis cache", "Retry #3 for external API call", "Authentication failed for user svc_batch", "Slow response from DB: 4500ms"];
  const infoMsgs = ["Request completed: GET /api/orders (200)", "Cache hit for product catalog", "Background job BatchProcessor completed", "Health check passed"];
  return Array.from({ length: n }, (_, i) => {
    const level = levelFor(scenario);
    const msg = level === "critical" ? pick(critMsgs) : level === "error" ? pick(critMsgs) : level === "warning" ? pick(warnMsgs) : pick(infoMsgs);
    return {
      timestamp: ts(base, i * 10_000).toISOString(),
      logLevel: level,
      source: "App.Logs",
      message: `[OrderService] ${msg}`,
      features: { hasException: level === "critical" || level === "error" ? 1 : 0, hasStackTrace: level === "critical" ? 1 : 0 },
    };
  });
}

function genWindowsEventLog(n: number, scenario: Scenario, base: Date) {
  const critEvents = ["EventID=1000: .NET Runtime — Application crash", "EventID=7034: Service 'OrderService' terminated unexpectedly", "EventID=6008: Unexpected system shutdown"];
  const warnEvents = ["EventID=5117: IIS app pool 'DefaultAppPool' recycled", "EventID=2004: Resource exhaustion detected", "EventID=36888: Schannel TLS handshake error"];
  const infoEvents = ["EventID=4624: Successful logon", "EventID=7036: Service entered running state", "EventID=1: Informational event"];
  return Array.from({ length: n }, (_, i) => {
    const level = levelFor(scenario);
    const msg = level === "critical" || level === "error" ? pick(critEvents) : level === "warning" ? pick(warnEvents) : pick(infoEvents);
    return {
      timestamp: ts(base, i * 45_000).toISOString(),
      logLevel: level,
      source: "Windows.EventLog",
      message: `[Application/W3SVC] ${msg}`,
      features: { eventId: randInt(1, 10000) },
    };
  });
}

function genIisLogs(n: number, scenario: Scenario, base: Date) {
  const uris = ["/api/orders", "/api/products", "/login", "/api/payments", "/api/inventory", "/healthcheck"];
  const methods = ["GET", "POST", "GET", "GET", "PUT"];
  return Array.from({ length: n }, (_, i) => {
    const is5xx = scenario === "critical" ? Math.random() > 0.5 : scenario === "degraded" ? Math.random() > 0.8 : Math.random() > 0.97;
    const status = is5xx ? pick([500, 502, 503]) : pick([200, 200, 200, 200, 301, 404]);
    const latency = is5xx ? randInt(5000, 30000) : scenario === "degraded" ? randInt(200, 8000) : randInt(10, 500);
    return {
      timestamp: ts(base, i * 5_000).toISOString(),
      logLevel: status >= 500 ? (status === 503 ? "critical" : "error") : latency > 3000 ? "warning" : "info",
      source: "IIS.AccessLog",
      message: `${pick(methods)} ${pick(uris)} → ${status} (${latency}ms)`,
      features: { status, timeTakenMs: latency, queueLength: scenario === "critical" ? randInt(50, 300) : randInt(0, 30) },
    };
  });
}

function genNetworkMetrics(n: number, scenario: Scenario, base: Date) {
  const metrics = ["rtt_latency_ms", "tcp_retransmit_pct", "conn_pool_usage_pct", "ephemeral_port_usage_pct", "dns_resolution_ms", "packet_loss_pct"];
  return Array.from({ length: n }, (_, i) => {
    const m = pick(metrics);
    let val: number;
    if (m === "rtt_latency_ms") val = scenario === "critical" ? rand(50, 300) : scenario === "degraded" ? rand(8, 60) : rand(0.5, 5);
    else if (m === "tcp_retransmit_pct") val = scenario === "critical" ? rand(5, 20) : scenario === "degraded" ? rand(1, 6) : rand(0, 0.8);
    else if (m === "conn_pool_usage_pct") val = scenario === "critical" ? rand(95, 100) : scenario === "degraded" ? rand(75, 96) : rand(20, 60);
    else if (m === "ephemeral_port_usage_pct") val = scenario === "critical" ? rand(90, 99) : scenario === "degraded" ? rand(60, 90) : rand(10, 50);
    else if (m === "dns_resolution_ms") val = scenario === "critical" ? rand(500, 3000) : scenario === "degraded" ? rand(80, 500) : rand(1, 30);
    else val = scenario === "critical" ? rand(2, 10) : scenario === "degraded" ? rand(0.3, 2) : rand(0, 0.3);
    return {
      timestamp: ts(base, i * 30_000).toISOString(),
      logLevel: levelFor(scenario),
      source: "Network.Metrics",
      message: `${m} = ${val.toFixed(2)} ${m.includes("ms") ? "ms" : "%"} (APP-SVR-01 → DB-SVR-01)`,
      features: { metric_value: Math.round(val * 100) / 100 },
    };
  });
}

const GENERATORS: Record<FeedId, (n: number, s: Scenario, b: Date) => any[]> = {
  jobHistory: genJobHistory,
  queryStore: genQueryStore,
  spExec: genSpExec,
  waitStats: genWaitStats,
  ioStats: genIoStats,
  xevents: genXEvents,
  errorLog: genErrorLog,
  osMetrics: genOsMetrics,
  appMetrics: genAppMetrics,
  appLogs: genAppLogs,
  windowsEventLog: genWindowsEventLog,
  iisLogs: genIisLogs,
  networkMetrics: genNetworkMetrics,
};

// ── main handler ─────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const feeds: FeedId[] = Array.isArray(body.feeds) && body.feeds.length > 0
    ? body.feeds.filter((f: string) => ALL_FEEDS.includes(f as FeedId))
    : ALL_FEEDS;
  const scenario: Scenario = ["healthy", "degraded", "critical"].includes(body.scenario) ? body.scenario : "degraded";
  const rowsPerFeed = Math.min(Math.max(Number(body.rowsPerFeed) || 50, 10), 500);

  const userId = (session.user as any).id as string;

  // 1. Ensure test Application exists
  let app = await prisma.application.findFirst({
    where: { name: TEST_APP_NAME, organizationId: "default" },
  });
  if (!app) {
    app = await prisma.application.create({
      data: {
        name: TEST_APP_NAME,
        osType: "WINDOWS",
        hostname: "APP-SVR-01",
        environment: "test",
        description: "Auto-created by PMS Test Harness for end-to-end testing.",
        createdById: userId,
        organizationId: "default",
      },
    });
  }

  // 2. Ensure test DataSource exists
  let ds = await prisma.dataSource.findFirst({
    where: { name: TEST_DS_NAME, organizationId: "default" },
  });
  if (!ds) {
    ds = await prisma.dataSource.create({
      data: {
        name: TEST_DS_NAME,
        kind: "MSSQL",
        host: "DB-SVR-01",
        port: 1433,
        database: "OrdersDB",
        authMode: "SQL_AUTH",
        username: "pms_collector",
        trustServerCert: true,
        enabled: true,
        enabledFeeds: feeds,
        applicationId: app.id,
        organizationId: "default",
      },
    });
  }

  // 3. Generate + ingest per feed
  const base = new Date(Date.now() - rowsPerFeed * 60_000); // spread back in time
  const results: { feed: string; rows: number; level: string }[] = [];

  for (const feed of feeds) {
    const gen = GENERATORS[feed];
    if (!gen) continue;
    const entries = gen(rowsPerFeed, scenario, base);

    // Create LogFile + ParsedLog rows (same as /api/ingest/batch)
    const logFile = await prisma.logFile.create({
      data: {
        fileName: `test-harness/${feed}/${new Date().toISOString().slice(0, 19)}`,
        fileType: "test-harness",
        fileSize: JSON.stringify(entries).length,
        logSource: feed,
        cloudStoragePath: `test-harness/${ds.id}/${feed}`,
        status: "processed",
        uploadedBy: userId,
        dataSourceId: ds.id,
        ingestionFeed: feed,
        applicationId: app.id,
      },
    });

    await prisma.parsedLog.createMany({
      data: entries.map((e: any) => ({
        logFileId: logFile.id,
        timestamp: new Date(e.timestamp),
        logLevel: e.logLevel ?? "info",
        source: e.source ?? feed,
        message: (e.message ?? "").slice(0, 4000),
        rawData: null,
        features: e.features ? JSON.stringify(e.features) : null,
      })),
    });

    // Summary per feed
    const critCount = entries.filter((e: any) => e.logLevel === "critical").length;
    const errCount = entries.filter((e: any) => e.logLevel === "error").length;
    const warnCount = entries.filter((e: any) => e.logLevel === "warning").length;
    results.push({
      feed,
      rows: entries.length,
      level: critCount > 0 ? "critical" : errCount > 0 ? "error" : warnCount > 0 ? "warning" : "info",
    });
  }

  return NextResponse.json({
    ok: true,
    applicationId: app.id,
    applicationName: app.name,
    dataSourceId: ds.id,
    dataSourceName: ds.name,
    scenario,
    totalRows: results.reduce((s, r) => s + r.rows, 0),
    feeds: results,
  });
}
