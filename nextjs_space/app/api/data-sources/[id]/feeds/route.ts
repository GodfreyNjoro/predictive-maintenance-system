/**
 * /api/data-sources/:id/feeds
 *
 * GET return the connector's `listFeeds(ds)` output — used by the UI to
 * grey-out unsupported feeds and explain why.
 */

export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getOrganizationId } from "@/lib/datasource/scope";
import { prisma } from "@/lib/db";
import { getConnector } from "@/lib/connectors";
import "@/lib/connectors/register";


export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = getOrganizationId(session);

  const ds = await prisma.dataSource.findFirst({ where: { id: ctx.params.id, organizationId } });
  if (!ds) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const feeds = await getConnector(ds.kind).listFeeds(ds);
    return NextResponse.json({ feeds });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
