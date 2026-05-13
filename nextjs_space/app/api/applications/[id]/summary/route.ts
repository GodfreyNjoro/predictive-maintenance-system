/**
 * /api/applications/:id/summary
 *
 * Aggregated health snapshot for an application's overview tab.
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

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [
    totalDataSources,
    totalLogFiles,
    totalPredictions,
    highSeverityCount,
    lastLogFile,
  ] = await Promise.all([
    prisma.dataSource.count({ where: { applicationId: app.id, organizationId } }),
    prisma.logFile.count({ where: { applicationId: app.id } }),
    prisma.prediction.count({
      where: { logFile: { applicationId: app.id } },
    }),
    prisma.prediction.count({
      where: {
        logFile: { applicationId: app.id },
        predictedAt: { gte: since },
        severity: { in: ["high", "critical"] },
      },
    }),
    prisma.logFile.findFirst({
      where: { applicationId: app.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  return NextResponse.json({
    summary: {
      totalDataSources,
      totalLogFiles,
      totalPredictions,
      highSeverityCount,
      lastIngestionAt: lastLogFile?.createdAt ?? null,
    },
  });
}
