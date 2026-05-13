/**
 * /api/applications/:id
 *
 * GET    fetch one Application (with counts).
 * PATCH  update fields (name, osType, description, hostname, environment).
 * DELETE remove the Application. DataSources and LogFiles get applicationId set to null (SetNull cascade).
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type { OsType } from "@prisma/client";
import { authOptions } from "@/lib/auth-options";
import { getOrganizationId } from "@/lib/datasource/scope";
import { prisma } from "@/lib/db";

type PatchBody = {
  name?: string;
  osType?: OsType;
  description?: string | null;
  hostname?: string | null;
  environment?: string | null;
};

export async function GET(_req: NextRequest, ctx: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = getOrganizationId(session);

  const app = await prisma.application.findFirst({
    where: { id: ctx.params.id, organizationId },
    select: {
      id: true,
      name: true,
      osType: true,
      description: true,
      hostname: true,
      environment: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { dataSources: true, logFiles: true } },
    },
  });
  if (!app) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ application: app });
}

export async function PATCH(req: NextRequest, ctx: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = getOrganizationId(session);

  const body = (await req.json().catch(() => null)) as PatchBody | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const existing = await prisma.application.findFirst({
    where: { id: ctx.params.id, organizationId },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = body.name.trim();
    if (name.length < 2) {
      return NextResponse.json({ error: "name must be at least 2 chars." }, { status: 400 });
    }
    data.name = name;
  }
  if (body.osType !== undefined) {
    if (body.osType !== "WINDOWS" && body.osType !== "LINUX") {
      return NextResponse.json({ error: "osType must be WINDOWS or LINUX." }, { status: 400 });
    }
    data.osType = body.osType;
  }
  if (body.description !== undefined) data.description = body.description ?? null;
  if (body.hostname !== undefined) data.hostname = body.hostname ?? null;
  if (body.environment !== undefined) data.environment = body.environment ?? null;

  try {
    const updated = await prisma.application.update({
      where: { id: existing.id },
      data,
      select: { id: true, name: true, osType: true },
    });
    return NextResponse.json({ application: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Unique constraint")) {
      return NextResponse.json({ error: "An application with that name already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = getOrganizationId(session);

  const existing = await prisma.application.findFirst({
    where: { id: ctx.params.id, organizationId },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.application.delete({ where: { id: existing.id } });
  return NextResponse.json({ ok: true });
}
