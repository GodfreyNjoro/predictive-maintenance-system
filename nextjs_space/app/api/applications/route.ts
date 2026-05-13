/**
 * /api/applications
 *
 * GET   list every Application visible to the caller (filtered by organizationId).
 * POST  create a new Application.
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type { OsType } from "@prisma/client";
import { authOptions } from "@/lib/auth-options";
import { getOrganizationId } from "@/lib/datasource/scope";
import { prisma } from "@/lib/db";

type Body = {
  name?: string;
  osType?: OsType;
  description?: string | null;
  hostname?: string | null;
  environment?: string | null;
};

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = getOrganizationId(session);

  const apps = await prisma.application.findMany({
    where: { organizationId },
    orderBy: [{ createdAt: "desc" }],
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

  return NextResponse.json({ applications: apps });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = getOrganizationId(session);
  const userId = (session.user as { id?: string }).id;
  if (!userId) return NextResponse.json({ error: "Session missing user id" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const name = (body.name ?? "").trim();
  if (name.length < 2) {
    return NextResponse.json({ error: "name is required (min 2 chars)." }, { status: 400 });
  }
  if (!body.osType || (body.osType !== "WINDOWS" && body.osType !== "LINUX")) {
    return NextResponse.json({ error: "osType must be WINDOWS or LINUX." }, { status: 400 });
  }

  try {
    const app = await prisma.application.create({
      data: {
        organizationId,
        name,
        osType: body.osType,
        description: body.description ?? null,
        hostname: body.hostname ?? null,
        environment: body.environment ?? null,
        createdById: userId,
      },
      select: {
        id: true,
        name: true,
        osType: true,
        description: true,
        hostname: true,
        environment: true,
        createdAt: true,
      },
    });
    return NextResponse.json({ application: app }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Unique constraint")) {
      return NextResponse.json({ error: "An application with that name already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
