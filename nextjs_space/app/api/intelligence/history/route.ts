/**
 * GET /api/intelligence/history?applicationId=...&limit=20
 * Returns past analysis reports for an application.
 */
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getRecentReports } from "@/lib/intelligence/analysis-store";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const applicationId = req.nextUrl.searchParams.get("applicationId");
  if (!applicationId) return NextResponse.json({ error: "applicationId required" }, { status: 400 });

  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || 20, 50);
  const reports = await getRecentReports(applicationId, limit);

  return NextResponse.json({
    reports: reports.map((r) => ({
      id: r.id,
      summary: r.summary,
      tags: r.tags,
      verdict: r.verdict,
      verdictNotes: r.verdictNotes,
      logFingerprint: r.logFingerprint,
      createdAt: r.createdAt,
    })),
  });
}
