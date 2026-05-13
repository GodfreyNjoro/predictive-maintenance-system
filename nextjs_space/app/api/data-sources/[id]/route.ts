/**
 * /api/data-sources/:id
 *
 * GET    fetch one DataSource (no plaintext secret).
 * PATCH  update fields. Re-encrypts password only if a new one is supplied.
 * DELETE remove the DataSource (Watermarks + IngestionRuns cascade; LogFiles keep dataSourceId nulled).
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type { DbAuthMode, DbKind, SpLoggingMode } from "@prisma/client";
import { authOptions } from "@/lib/auth-options";
import { getOrganizationId } from "@/lib/datasource/scope";
import { prisma } from "@/lib/db";
import { encryptDataSourceSecret } from "@/lib/datasource/secrets";
import { getConnector, hasConnector } from "@/lib/connectors";
import "@/lib/connectors/register";

type PatchBody = {
  name?: string;
  kind?: DbKind;
  host?: string;
  port?: number;
  database?: string;
  authMode?: DbAuthMode;
  username?: string | null;
  /**
   * Send a non-empty string to ROTATE the password. Send `null` to leave the
   * existing password untouched. Sending `""` clears the stored password.
   */
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


export async function GET(_req: NextRequest, ctx: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = getOrganizationId(session);

  const ds = await prisma.dataSource.findFirst({
    where: { id: ctx.params.id, organizationId },
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
    },
  });
  if (!ds) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ dataSource: ds });
}

export async function PATCH(req: NextRequest, ctx: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = getOrganizationId(session);

  const body = (await req.json().catch(() => null)) as PatchBody | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const existing = await prisma.dataSource.findFirst({
    where: { id: ctx.params.id, organizationId },
    select: { id: true, kind: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Build the patch map. Only include fields the caller actually sent.
  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.kind !== undefined) data.kind = body.kind;
  if (body.host !== undefined) data.host = body.host;
  if (body.port !== undefined) data.port = body.port;
  if (body.database !== undefined) data.database = body.database;
  if (body.authMode !== undefined) data.authMode = body.authMode;
  if (body.username !== undefined) data.username = body.username;
  if (body.password !== undefined && body.password !== null) {
    data.encryptedSecret = encryptDataSourceSecret(body.password) ?? null;
  }
  if (body.trustServerCert !== undefined) data.trustServerCert = body.trustServerCert;
  if (body.enabled !== undefined) data.enabled = body.enabled;
  if (body.spLoggingMode !== undefined) data.spLoggingMode = body.spLoggingMode;
  if (body.enabledFeeds !== undefined) data.enabledFeeds = body.enabledFeeds;
  if (body.redactSqlText !== undefined) data.redactSqlText = body.redactSqlText;
  if (body.defaultIntervalSec !== undefined) {
    data.defaultIntervalSec = clampInterval(body.defaultIntervalSec);
  }
  if (body.feedIntervalsSec !== undefined) data.feedIntervalsSec = body.feedIntervalsSec ?? undefined;
  if (body.connectionParams !== undefined) data.connectionParams = body.connectionParams ?? undefined;
  if (body.applicationId !== undefined) {
    if (body.applicationId === null) {
      data.applicationId = null;
    } else {
      const app = await prisma.application.findFirst({
        where: { id: body.applicationId, organizationId },
        select: { id: true },
      });
      if (!app) return NextResponse.json({ error: "Application not found." }, { status: 404 });
      data.applicationId = app.id;
    }
  }

  // Drop any cached connector pool so the next pull picks up the new credentials.
  if (hasConnector(existing.kind)) {
    try { await getConnector(existing.kind).close(); } catch { /* ignore */ }
  }

  try {
    const updated = await prisma.dataSource.update({ where: { id: existing.id }, data, select: { id: true, name: true } });
    return NextResponse.json({ dataSource: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Unique constraint")) {
      return NextResponse.json({ error: "A data source with that name already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = getOrganizationId(session);

  const existing = await prisma.dataSource.findFirst({
    where: { id: ctx.params.id, organizationId },
    select: { id: true, kind: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Drop any cached connector pool first.
  if (hasConnector(existing.kind)) {
    try { await getConnector(existing.kind).close(); } catch { /* ignore */ }
  }

  await prisma.dataSource.delete({ where: { id: existing.id } });
  return NextResponse.json({ ok: true });
}

function clampInterval(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 60;
  if (n > 86_400) return 86_400;
  return Math.floor(n);
}
