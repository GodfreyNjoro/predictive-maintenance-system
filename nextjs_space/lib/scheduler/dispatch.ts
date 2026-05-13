/**
 * Ingestion dispatcher.
 *
 * One entry point — `runDispatcher()` — which:
 *   1. Loads every enabled DataSource (filtered by organizationId when supplied).
 *   2. For each (DataSource, enabled feed) pair:
 *      a. Determines per-feed cadence (defaultIntervalSec or feedIntervalsSec[feed]).
 *      b. Acquires a Prisma-row mutex on the corresponding Watermark (lockedUntil).
 *      c. Calls `connector.pull(ds, feed, cursor)`.
 *      d. Persists a synthetic LogFile + ParsedLog batch on success.
 *      e. Updates Watermark.cursor and IngestionRun row.
 *      f. Releases the mutex.
 *
 * The dispatcher is DB-agnostic — it never imports a specific connector.
 * It calls `getConnector(ds.kind)` from the registry, which is populated
 * via `lib/connectors/register.ts`.
 *
 * It is also re-entrant safe: two parallel invocations on different
 * processes will lose at most one tick because of the row-level lock
 * (lockedUntil is set inside a transaction and respected by every worker).
 */

import "../connectors/register"; // populate the connector registry once.

import type { DataSource, Watermark } from "@prisma/client";

import { prisma } from "../db";
import { getConnector } from "../connectors";
import type { FeedId } from "../connectors/types";
import { redactForLog } from "../datasource/secrets";

// -----------------------------------------------------------------------------
// Tunables
// -----------------------------------------------------------------------------

/** Mutex hold time — a stuck pull should free its lock automatically. */
const MUTEX_TTL_MS = 5 * 60 * 1000; // 5 min

/** Hard ceiling on a single dispatcher tick. We never block longer than this. */
const TICK_BUDGET_MS = 50 * 1000; // 50s of a 60s schedule

/** Hard cap on how many ParsedLog rows we persist per pull batch. */
const MAX_ROWS_PER_BATCH = 5000;

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export interface DispatchOptions {
  organizationId?: string;
  /** Limit to a specific data source id (used by /data-sources "Run now" button). */
  dataSourceId?: string;
  /** Optional caller name for log + IngestionRun.lockedBy. */
  workerId?: string;
  /** Override the wall clock (for tests). */
  now?: () => Date;
}

export interface DispatchSummary {
  ranAt: Date;
  totalDataSources: number;
  totalAttempts: number;
  successes: number;
  errors: number;
  skipped: number;
  feedsConsidered: string[];
  budgetExceeded: boolean;
}

export async function runDispatcher(options: DispatchOptions = {}): Promise<DispatchSummary> {
  const { organizationId, dataSourceId, workerId = "dispatcher", now = () => new Date() } = options;
  const tickStart = now().getTime();
  const ranAt = now();

  const dataSources = await prisma.dataSource.findMany({
    where: {
      enabled: true,
      ...(organizationId ? { organizationId } : {}),
      ...(dataSourceId ? { id: dataSourceId } : {}),
    },
  });

  const summary: DispatchSummary = {
    ranAt,
    totalDataSources: dataSources.length,
    totalAttempts: 0,
    successes: 0,
    errors: 0,
    skipped: 0,
    feedsConsidered: [],
    budgetExceeded: false,
  };

  for (const ds of dataSources) {
    if (now().getTime() - tickStart >= TICK_BUDGET_MS) {
      summary.budgetExceeded = true;
      break;
    }
    const feeds = enabledFeedsFor(ds);
    for (const feed of feeds) {
      if (now().getTime() - tickStart >= TICK_BUDGET_MS) {
        summary.budgetExceeded = true;
        break;
      }
      summary.feedsConsidered.push(`${ds.name}/${feed}`);
      summary.totalAttempts += 1;
      const outcome = await runOneFeed(ds, feed, { workerId, now });
      switch (outcome) {
        case "ok": summary.successes += 1; break;
        case "err": summary.errors += 1; break;
        case "skip": summary.skipped += 1; break;
      }
    }
  }

  return summary;
}

// -----------------------------------------------------------------------------
// Per-feed worker
// -----------------------------------------------------------------------------

export async function runOneFeed(
  ds: DataSource,
  feed: FeedId,
  opts: { workerId: string; now: () => Date },
): Promise<"ok" | "err" | "skip"> {
  const { workerId, now } = opts;
  const intervalSec = feedIntervalSec(ds, feed);
  const tickAt = now();

  // 1) Acquire watermark + cadence + mutex in one transaction.
  const lock = await acquireWatermarkLock(ds, feed, intervalSec, tickAt, workerId);
  if (!lock.acquired) {
    return "skip";
  }

  // 2) Open IngestionRun row.
  const run = await prisma.ingestionRun.create({
    data: {
      dataSourceId: ds.id,
      feed,
      status: "ok", // overwritten on completion
      cursorBefore: (lock.watermark.cursor ?? null) as never,
    },
  });

  const startedAt = now().getTime();
  let outcome: "ok" | "err" = "ok";
  let errorMessage: string | null = null;
  let rowsFetched = 0;
  let rowsEmitted = 0;
  let nextCursor: unknown = lock.watermark.cursor ?? {};
  let note: string | null = null;
  let partial = false;

  try {
    const connector = getConnector(ds.kind);
    const pull = await connector.pull(ds, feed, lock.watermark.cursor ?? {});
    rowsFetched = pull.rowsFetched;
    nextCursor = pull.nextCursor;
    note = pull.note ?? null;
    partial = !!pull.partial;

    const allEntries = [...(pull.syntheticEvents ?? []), ...(pull.entries ?? [])];
    if (allEntries.length > 0) {
      // Persist a synthetic LogFile + the ParsedLog batch.
      const userId = await resolveSystemUserId(ds);
      const logFile = await prisma.logFile.create({
        data: {
          fileName: synthFileName(ds, feed, tickAt),
          fileType: "db",
          logSource: synthLogSource(ds, feed),
          fileSize: allEntries.length, // approximate; we don't stream bytes
          cloudStoragePath: synthStoragePath(ds, feed, tickAt),
          isPublic: false,
          status: "processed",
          recordCount: allEntries.length,
          uploadedBy: userId,
          dataSourceId: ds.id,
          ingestionFeed: feed,
        },
      });
      // Cap the batch (defence in depth) — connectors enforce TOP @rowCap themselves.
      const limited = allEntries.slice(0, MAX_ROWS_PER_BATCH);
      if (limited.length > 0) {
        await prisma.parsedLog.createMany({
          data: limited.map((e) => ({
            logFileId: logFile.id,
            timestamp: e.timestamp,
            logLevel: e.logLevel,
            source: e.source,
            eventId: e.eventId ?? null,
            message: e.message,
            rawData: e.rawData ?? null,
            features: e.features ? JSON.stringify(e.features) : null,
          })),
        });
      }
      rowsEmitted = limited.length;
    }
  } catch (err) {
    outcome = "err";
    errorMessage = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(
      `[dispatcher] pull failed for ${JSON.stringify(redactForLog(ds))} feed=${feed}: ${errorMessage}`,
    );
  }

  // 3) Persist watermark + IngestionRun completion + release mutex — even on error.
  const finishedAt = now();
  const durationMs = finishedAt.getTime() - startedAt;
  await prisma.$transaction(async (tx) => {
    await tx.ingestionRun.update({
      where: { id: run.id },
      data: {
        finishedAt,
        durationMs,
        rowsFetched,
        rowsEmitted,
        status: outcome === "ok" ? (partial ? "partial" : "ok") : "error",
        errorMessage,
        cursorAfter: outcome === "ok" ? (nextCursor as never) : (lock.watermark.cursor as never),
      },
    });
    if (outcome === "ok") {
      await tx.watermark.update({
        where: { id: lock.watermark.id },
        data: {
          cursor: nextCursor as never,
          lockedUntil: null,
          lockedBy: null,
        },
      });
    } else {
      // Release the lock without advancing cursor.
      await tx.watermark.update({
        where: { id: lock.watermark.id },
        data: { lockedUntil: null, lockedBy: null },
      });
    }
    // Update DataSource health flags.
    await tx.dataSource.update({
      where: { id: ds.id },
      data:
        outcome === "ok"
          ? {
              consecutiveFailures: 0,
              lastTestedAt: finishedAt,
              lastTestResult: partial ? "degraded" : "ok",
            }
          : {
              consecutiveFailures: { increment: 1 },
              lastTestedAt: finishedAt,
              lastTestResult: `error: ${truncate(errorMessage ?? "unknown", 240)}`,
            },
    });
  });

  // Optional note logging.
  if (note && outcome === "ok") {
    // eslint-disable-next-line no-console
    console.warn(`[dispatcher] ${ds.name}/${feed}: ${note}`);
  }

  return outcome;
}

// -----------------------------------------------------------------------------
// Mutex / cadence
// -----------------------------------------------------------------------------

interface AcquireLockResult {
  acquired: boolean;
  watermark: Watermark;
}

/**
 * Atomically: upsert the Watermark for (ds, feed); refuse if another worker
 * holds a non-expired lock OR if the cadence hasn't elapsed since the last run.
 */
async function acquireWatermarkLock(
  ds: DataSource,
  feed: FeedId,
  intervalSec: number,
  now: Date,
  workerId: string,
): Promise<AcquireLockResult> {
  return prisma.$transaction(async (tx) => {
    let watermark = await tx.watermark.findUnique({
      where: { dataSourceId_feed: { dataSourceId: ds.id, feed } },
    });
    if (!watermark) {
      watermark = await tx.watermark.create({
        data: { dataSourceId: ds.id, feed, cursor: {} as never },
      });
    }
    if (watermark.lockedUntil && watermark.lockedUntil.getTime() > now.getTime()) {
      return { acquired: false, watermark };
    }
    // Cadence — only run if `intervalSec` has elapsed since the last successful pull.
    // We approximate "last successful pull" via Watermark.updatedAt.
    if (intervalSec > 0) {
      const ageMs = now.getTime() - watermark.updatedAt.getTime();
      if (ageMs < intervalSec * 1000) {
        return { acquired: false, watermark };
      }
    }
    const refreshed = await tx.watermark.update({
      where: { id: watermark.id },
      data: {
        lockedUntil: new Date(now.getTime() + MUTEX_TTL_MS),
        lockedBy: `${workerId}/${process.pid}`,
      },
    });
    return { acquired: true, watermark: refreshed };
  });
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function enabledFeedsFor(ds: DataSource): FeedId[] {
  // Each DataSource carries a String[] of feed ids the operator has enabled.
  // Phase 1 ships only `jobHistory`; if the array is empty we default to that
  // for safety (zero-config first-time setup).
  const enabled = (ds.enabledFeeds && ds.enabledFeeds.length > 0)
    ? ds.enabledFeeds
    : ["jobHistory"];
  return enabled.filter(isFeedId);
}

function isFeedId(x: string): x is FeedId {
  return [
    "jobHistory",
    "queryStore",
    "spExec",
    "waitStats",
    "ioStats",
    "xevents",
    "osMetrics",
    "errorLog",
    "appMetrics",
    "appLogs",
    "windowsEventLog",
    "iisLogs",
    "networkMetrics",
  ].includes(x);
}

function feedIntervalSec(ds: DataSource, feed: FeedId): number {
  const overrides = (ds.feedIntervalsSec as Record<string, unknown> | null | undefined) ?? null;
  const override = overrides && typeof overrides === "object" ? overrides[feed] : undefined;
  if (typeof override === "number" && Number.isFinite(override) && override >= 0) return override;
  return Math.max(0, ds.defaultIntervalSec);
}

function synthFileName(ds: DataSource, feed: FeedId, ts: Date): string {
  return `${ds.name}/${feed}/${ts.toISOString()}`;
}

function synthLogSource(ds: DataSource, feed: FeedId): string {
  // e.g. "mssql.jobHistory" — lower-case kind + dot + camelCase feed.
  return `${ds.kind.toLowerCase()}.${feed}`;
}

function synthStoragePath(ds: DataSource, feed: FeedId, ts: Date): string {
  // Synthetic path — `LogFile.cloudStoragePath` is required (String) but DB
  // ingestion never writes a real file, so we record a logical pointer.
  return `db://${ds.kind.toLowerCase()}/${ds.id}/${feed}/${ts.toISOString()}`;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

/**
 * Resolve the user id used as `LogFile.uploadedBy` for synthetic ingestion files.
 * Strategy:
 *   1. ds.createdBy if it points at a real User row.
 *   2. Otherwise the first User in the same organisation (admin-seeded).
 *   3. Otherwise any User row (single-tenant fallback).
 * Throws if no users exist — the operator must have at least one account.
 */
async function resolveSystemUserId(ds: DataSource): Promise<string> {
  if (ds.createdBy) {
    const u = await prisma.user.findUnique({ where: { id: ds.createdBy }, select: { id: true } });
    if (u) return u.id;
  }
  const fallback = await prisma.user.findFirst({ select: { id: true } });
  if (!fallback) {
    throw new Error(
      "Cannot dispatch ingestion: no User rows exist. Sign up at least one account first.",
    );
  }
  return fallback.id;
}
