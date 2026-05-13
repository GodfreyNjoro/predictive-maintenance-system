/**
 * Edge Collector Batch Ingest API
 *
 * POST /api/ingest/batch
 *
 * Accepts pre-mapped ParsedLogEntry[] from an on-premise edge collector agent.
 * The agent runs `lib/connectors/*` + `lib/mappers/*` locally, then ships
 * canonical entries to PMS over HTTPS. This decouples the DB credentials
 * from the PMS cloud instance — the edge collector holds them, PMS never
 * needs direct network access to the customer's database.
 *
 * Authentication: Bearer token from `EDGE_COLLECTOR_KEY` env var, OR a valid
 * NextAuth session (for browser-based testing).
 *
 * Request body:
 *   {
 *     dataSourceId: string,              // DataSource.id this batch belongs to
 *     feed: FeedId,                      // which feed produced these entries
 *     entries: ParsedLogEntry[],         // canonical entries
 *     nextCursor: unknown,               // cursor to persist on success
 *     rowsFetched?: number,              // informational
 *     partial?: boolean,                 // if true, dispatcher should re-pull soon
 *     syntheticEvents?: ParsedLogEntry[],
 *     note?: string,
 *   }
 *
 * Response: 200 { ok: true, rowsEmitted: number }
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";
import type { FeedId } from "@/lib/connectors/types";
import type { ParsedLogEntry } from "@/lib/log-parser";

const MAX_BATCH_SIZE = 10_000;

/** Validate the bearer token against EDGE_COLLECTOR_KEY. */
function validateEdgeToken(req: NextRequest): boolean {
  const key = process.env.EDGE_COLLECTOR_KEY;
  if (!key) return false;
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  return token.length > 0 && token === key;
}

export async function POST(req: NextRequest) {
  // Auth: edge token OR session
  const isEdgeAuth = validateEdgeToken(req);
  if (!isEdgeAuth) {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized — provide a valid Bearer token (EDGE_COLLECTOR_KEY) or NextAuth session." },
        { status: 401 },
      );
    }
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const {
    dataSourceId,
    feed,
    entries,
    nextCursor,
    rowsFetched,
    partial,
    syntheticEvents,
    note,
  } = body as {
    dataSourceId: string;
    feed: FeedId;
    entries: ParsedLogEntry[];
    nextCursor: unknown;
    rowsFetched?: number;
    partial?: boolean;
    syntheticEvents?: ParsedLogEntry[];
    note?: string;
  };

  // Validate required fields
  if (!dataSourceId || typeof dataSourceId !== "string") {
    return NextResponse.json({ error: "dataSourceId is required." }, { status: 400 });
  }
  if (!feed || typeof feed !== "string") {
    return NextResponse.json({ error: "feed is required." }, { status: 400 });
  }
  if (!Array.isArray(entries)) {
    return NextResponse.json({ error: "entries must be an array." }, { status: 400 });
  }
  if (entries.length > MAX_BATCH_SIZE) {
    return NextResponse.json(
      { error: `Batch too large: ${entries.length} entries (max ${MAX_BATCH_SIZE}).` },
      { status: 413 },
    );
  }

  // Verify data source exists and find a system user for uploadedBy FK
  const ds = await prisma.dataSource.findUnique({
    where: { id: dataSourceId },
    select: { id: true, applicationId: true, organizationId: true, name: true, createdBy: true },
  });
  if (!ds) {
    return NextResponse.json({ error: `DataSource '${dataSourceId}' not found.` }, { status: 404 });
  }

  // Resolve a valid userId for the LogFile.uploadedBy FK
  let uploadUserId = ds.createdBy;
  if (!uploadUserId) {
    const fallback = await prisma.user.findFirst({ where: { role: "admin" }, select: { id: true } });
    if (!fallback) {
      return NextResponse.json({ error: "No admin user found for uploadedBy." }, { status: 500 });
    }
    uploadUserId = fallback.id;
  }

  const startedAt = new Date();

  try {
    // 1. Create a LogFile record for this batch
    const allEntries = [
      ...entries,
      ...(Array.isArray(syntheticEvents) ? syntheticEvents : []),
    ];

    const logFile = await prisma.logFile.create({
      data: {
        fileName: `edge-collector/${feed}/${new Date().toISOString().slice(0, 19)}`,
        fileType: "edge-collector",
        fileSize: JSON.stringify(allEntries).length,
        logSource: feed,
        cloudStoragePath: `edge-collector/${ds.id}/${feed}`,
        status: "processed",
        uploadedBy: uploadUserId,
        dataSourceId: ds.id,
        ingestionFeed: feed,
        applicationId: ds.applicationId,
      },
    });

    // 2. Persist ParsedLog rows
    if (allEntries.length > 0) {
      await prisma.parsedLog.createMany({
        data: allEntries.map((e: ParsedLogEntry) => ({
          logFileId: logFile.id,
          timestamp: e.timestamp instanceof Date ? e.timestamp : new Date(e.timestamp),
          logLevel: e.logLevel ?? "info",
          source: e.source ?? feed,
          message: (e.message ?? "").slice(0, 4000),
          rawData: e.rawData ?? null,
          features: e.features ? JSON.stringify(e.features) : null,
        })),
      });
    }

    // 3. Update watermark cursor
    if (nextCursor !== undefined && nextCursor !== null) {
      await prisma.watermark.upsert({
        where: {
          dataSourceId_feed: { dataSourceId: ds.id, feed },
        },
        create: {
          dataSourceId: ds.id,
          feed,
          cursor: nextCursor as any,
        },
        update: {
          cursor: nextCursor as any,
          lockedUntil: null,
          lockedBy: null,
        },
      });
    }

    // 4. Record IngestionRun
    const finishedAt = new Date();
    await prisma.ingestionRun.create({
      data: {
        dataSourceId: ds.id,
        feed,
        startedAt,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        rowsFetched: typeof rowsFetched === "number" ? rowsFetched : allEntries.length,
        rowsEmitted: allEntries.length,
        status: partial ? "partial" : "ok",
        errorMessage: note ?? null,
        cursorAfter: nextCursor as any,
      },
    });

    return NextResponse.json({
      ok: true,
      rowsEmitted: allEntries.length,
      logFileId: logFile.id,
    });
  } catch (err) {
    // Record a failed run
    const finishedAt = new Date();
    try {
      await prisma.ingestionRun.create({
        data: {
          dataSourceId: ds.id,
          feed,
          startedAt,
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          rowsFetched: 0,
          rowsEmitted: 0,
          status: "error",
          errorMessage: err instanceof Error ? err.message : String(err),
        },
      });
    } catch {
      // Best-effort audit — don't cascade failures.
    }

    console.error("[ingest/batch] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}
