export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";
import { getOrganizationId } from "@/lib/datasource/scope";

/**
 * GET /api/data-sources/[id]/runs?limit=50
 *
 * Lists IngestionRun rows for a single DataSource, most recent first.
 * Caller must own (or share an organisation with) the DataSource.
 */
export async function GET(request: NextRequest, ctx: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const orgId = getOrganizationId(session);
  const dsId = ctx.params.id;

  // Confirm the data source exists & belongs to caller's org.
  const ds = await prisma.dataSource.findFirst({
    where: { id: dsId, organizationId: orgId },
    select: { id: true, name: true, kind: true },
  });
  if (!ds) {
    return NextResponse.json({ success: false, error: "Data source not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1),
    200,
  );

  const runs = await prisma.ingestionRun.findMany({
    where: { dataSourceId: dsId },
    orderBy: { startedAt: "desc" },
    take: limit,
    select: {
      id: true,
      feed: true,
      status: true,
      startedAt: true,
      finishedAt: true,
      durationMs: true,
      rowsFetched: true,
      rowsEmitted: true,
      cursorBefore: true,
      cursorAfter: true,
      errorMessage: true,
    },
  });

  return NextResponse.json({ success: true, dataSource: ds, runs });
}
