/**
 * /api/data-sources
 *
 * GET   list every DataSource visible to the caller (Phase 1 = single-tenant; we
 *       still filter by organizationId to be future-proof).
 * POST  create a new DataSource (encrypts the password before storing).
 *
 * The shape used by both the UI and `lib/datasource/secrets.ts` keeps the
 * encryptedSecret field opaque — no client ever sees plaintext credentials,
 * not even on read.
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type { DbAuthMode, DbKind, SpLoggingMode } from "@prisma/client";
import { authOptions } from "@/lib/auth-options";
import { getOrganizationId } from "@/lib/datasource/scope";
import { prisma } from "@/lib/db";
import { encryptDataSourceSecret } from "@/lib/datasource/secrets";

type Body = {
  name?: string;
  kind?: DbKind;
  host?: string;
  port?: number;
  database?: string;
  authMode?: DbAuthMode;
  username?: string | null;
  password?: string | null;
  trustServerCert?: boolean;
  enabled?: boolean;
  spLoggingMode?: SpLoggingMode;
  enabledFeeds?: string[];
  redactSqlText?: boolean;
  defaultIntervalSec?: number;
  feedIntervalsSec?: Record<string, number> | null;
  connectionParams?: Record<string, unknown> | null;
  applicationId?: string | null;
};


export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = getOrganizationId(session);

  // Optional ?applicationId=... filter — when present, restrict to that app.
  const applicationId = req.nextUrl.searchParams.get("applicationId");

  const where: { organizationId: string; applicationId?: string | null } = { organizationId };
  if (applicationId) {
    where.applicationId = applicationId;
  }

  const rows = await prisma.dataSource.findMany({
    where,
    orderBy: [{ enabled: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      kind: true,
      host: true,
      port: true,
      database: true,
      authMode: true,
      username: true,
      trustServerCert: true,
      enabled: true,
      spLoggingMode: true,
      enabledFeeds: true,
      redactSqlText: true,
      defaultIntervalSec: true,
      feedIntervalsSec: true,
      connectionParams: true,
      lastTestedAt: true,
      lastTestResult: true,
      consecutiveFailures: true,
      createdAt: true,
      updatedAt: true,
      applicationId: true,
      application: { select: { id: true, name: true, osType: true } },
      _count: { select: { ingestionRuns: true, watermarks: true } },
    },
  });

  return NextResponse.json({ dataSources: rows });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = getOrganizationId(session);

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const validation = validateBody(body);
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });

  // applicationId is required — every DataSource must belong to an Application.
  if (!body.applicationId) {
    return NextResponse.json({ error: "applicationId is required." }, { status: 400 });
  }

  // Verify the application exists and is owned by the same org.
  const app = await prisma.application.findFirst({
    where: { id: body.applicationId, organizationId },
    select: { id: true },
  });
  if (!app) {
    return NextResponse.json({ error: "Application not found." }, { status: 404 });
  }

  const encrypted = encryptDataSourceSecret(body.password ?? null);

  try {
    const created = await prisma.dataSource.create({
      data: {
        organizationId,
        applicationId: app.id,
        name: body.name!,
        kind: body.kind!,
        host: body.host!,
        port: body.port!,
        database: body.database!,
        authMode: body.authMode!,
        username: body.username ?? null,
        encryptedSecret: encrypted ?? undefined,
        trustServerCert: body.trustServerCert ?? true,
        enabled: body.enabled ?? true,
        spLoggingMode: body.spLoggingMode ?? "NONE",
        enabledFeeds: body.enabledFeeds ?? ["jobHistory"],
        redactSqlText: body.redactSqlText ?? false,
        defaultIntervalSec: clampInterval(body.defaultIntervalSec ?? 60),
        feedIntervalsSec: (body.feedIntervalsSec as never) ?? undefined,
        connectionParams: (body.connectionParams as never) ?? undefined,
        createdBy: (session.user as { id?: string }).id ?? null,
      },
      select: {
        id: true,
        name: true,
        kind: true,
        host: true,
        port: true,
        database: true,
        enabled: true,
      },
    });
    return NextResponse.json({ dataSource: created }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Unique constraint")) {
      return NextResponse.json({ error: "A data source with that name already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function validateBody(b: Body): { ok: true } | { ok: false; error: string } {
  if (!b.name || typeof b.name !== "string" || b.name.length < 2) {
    return { ok: false, error: "name is required (min 2 chars)." };
  }
  if (!b.kind) return { ok: false, error: "kind is required." };
  if (!["MSSQL", "POSTGRES", "MYSQL", "ORACLE"].includes(b.kind)) {
    return { ok: false, error: `Unsupported kind: ${b.kind}` };
  }
  if (!b.host) return { ok: false, error: "host is required." };
  if (typeof b.port !== "number" || b.port < 1 || b.port > 65535) {
    return { ok: false, error: "port must be 1–65535." };
  }
  if (!b.database) return { ok: false, error: "database is required." };
  if (!b.authMode || !["SQL_AUTH", "WINDOWS_AUTH", "IAM", "TOKEN"].includes(b.authMode)) {
    return { ok: false, error: "authMode must be SQL_AUTH | WINDOWS_AUTH | IAM | TOKEN." };
  }
  if (b.authMode === "SQL_AUTH" && (!b.username || !b.password)) {
    return { ok: false, error: "SQL_AUTH requires username + password." };
  }
  if (b.authMode === "WINDOWS_AUTH" && (!b.username || !b.password)) {
    return { ok: false, error: "WINDOWS_AUTH requires username + password (NTLM)." };
  }
  return { ok: true };
}

function clampInterval(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 60;
  if (n > 86_400) return 86_400;
  return Math.floor(n);
}
