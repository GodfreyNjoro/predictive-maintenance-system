/**
 * /api/data-sources/:id/run
 *
 * "Run now" endpoint — invokes the dispatcher scoped to a single DataSource.
 * Useful for operators who just edited a connection and want to verify
 * end-to-end ingestion without waiting for the next scheduled tick.
 */

export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getOrganizationId } from "@/lib/datasource/scope";
import { prisma } from "@/lib/db";
import { runDispatcher } from "@/lib/scheduler/dispatch";


export async function POST(_req: Request, ctx: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = getOrganizationId(session);

  const ds = await prisma.dataSource.findFirst({
    where: { id: ctx.params.id, organizationId },
    select: { id: true, enabled: true },
  });
  if (!ds) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!ds.enabled) return NextResponse.json({ error: "DataSource is disabled." }, { status: 400 });

  // Bypass cadence: temporarily clear watermark.lockedUntil & advance updatedAt
  // backwards so the dispatcher actually fires this tick. We use a transaction
  // rather than special-casing the dispatcher with a `force` flag.
  await prisma.watermark.updateMany({
    where: { dataSourceId: ds.id },
    data: { lockedUntil: null, updatedAt: new Date(0) },
  });

  const summary = await runDispatcher({
    dataSourceId: ds.id,
    organizationId,
    workerId: "manual",
  });
  return NextResponse.json({ summary });
}
