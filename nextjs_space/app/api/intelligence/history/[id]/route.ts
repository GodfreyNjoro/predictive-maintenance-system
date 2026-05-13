/**
 * GET /api/intelligence/history/[id]?applicationId=...
 * Returns full detail of a single analysis report.
 */
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const applicationId = req.nextUrl.searchParams.get("applicationId");
  if (!applicationId) return NextResponse.json({ error: "applicationId required" }, { status: 400 });

  const report = await prisma.analysisReport.findFirst({
    where: { id: params.id, applicationId },
  });

  if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });

  return NextResponse.json({ report });
}
