/**
 * /api/applications/:id/logs
 *
 * Returns the LogFile rows linked to a given application.
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getOrganizationId } from "@/lib/datasource/scope";
import { prisma } from "@/lib/db";

export async function GET(_req: NextRequest, ctx: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = getOrganizationId(session);

  const app = await prisma.application.findFirst({
    where: { id: ctx.params.id, organizationId },
    select: { id: true },
  });
  if (!app) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rows = await prisma.logFile.findMany({
    where: { applicationId: app.id },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      fileName: true,
      fileType: true,
      logSource: true,
      fileSize: true,
      status: true,
      recordCount: true,
      errorMessage: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ logFiles: rows });
}
