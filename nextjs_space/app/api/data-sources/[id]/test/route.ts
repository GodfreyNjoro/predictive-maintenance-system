/**
 * /api/data-sources/:id/test
 *
 * Calls connector.testConnection on the named DataSource. Surfaces both
 * the human-readable result and the capability map so the UI can colour
 * the feed toggles (e.g. msdb readable → jobHistory available).
 *
 * Updates `lastTestedAt` / `lastTestResult` so operators see the most
 * recent probe outcome on /data-sources without clicking again.
 */

export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getOrganizationId } from "@/lib/datasource/scope";
import { prisma } from "@/lib/db";
import { getConnector } from "@/lib/connectors";
import "@/lib/connectors/register";


export async function POST(_req: Request, ctx: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = getOrganizationId(session);

  const ds = await prisma.dataSource.findFirst({ where: { id: ctx.params.id, organizationId } });
  if (!ds) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let result;
  try {
    const connector = getConnector(ds.kind);
    result = await connector.testConnection(ds);
  } catch (err) {
    result = {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  const status = result.ok ? "ok" : `error: ${result.message.slice(0, 240)}`;
  await prisma.dataSource.update({
    where: { id: ds.id },
    data: {
      lastTestedAt: new Date(),
      lastTestResult: status,
      consecutiveFailures: result.ok ? 0 : { increment: 1 },
    },
  });

  return NextResponse.json({ result });
}
