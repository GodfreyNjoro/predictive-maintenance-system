/**
 * GET /api/intelligence/knowledge?applicationId=...
 * Returns the "System Knowledge" for an application:
 * - Established patterns (with confidence + verdicts)
 * - Baselines (rolling metrics)
 * - Report stats (count, confirmed, false positives)
 *
 * CRITICAL: All data is scoped to the specified applicationId.
 */
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPatterns } from "@/lib/intelligence/pattern-library";
import { getBaselines } from "@/lib/intelligence/baseline-learning";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const applicationId = req.nextUrl.searchParams.get("applicationId");
  if (!applicationId) return NextResponse.json({ error: "applicationId required" }, { status: 400 });

  const [patterns, baselines, reportCounts] = await Promise.all([
    getPatterns(applicationId, 50),
    getBaselines(applicationId),
    prisma.analysisReport.groupBy({
      by: ["verdict"],
      where: { applicationId },
      _count: true,
    }),
  ]);

  const totalReports = reportCounts.reduce((sum, r) => sum + r._count, 0);
  const confirmedReports = reportCounts.find((r) => r.verdict === "confirmed")?._count ?? 0;
  const falsePositiveReports = reportCounts.find((r) => r.verdict === "false_positive")?._count ?? 0;

  return NextResponse.json({
    applicationId,
    patterns: patterns.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      category: p.category,
      severity: p.severity,
      affectedSources: p.affectedSources,
      occurrenceCount: p.occurrenceCount,
      confidence: p.confidence,
      severityTrend: p.severityTrend,
      operatorVerdict: p.operatorVerdict,
      operatorNotes: p.operatorNotes,
      lastSeenAt: p.lastSeenAt,
      createdAt: p.createdAt,
    })),
    baselines: baselines.map((b) => ({
      id: b.id,
      source: b.source,
      metricName: b.metricName,
      sampleCount: b.sampleCount,
      rollingMean: b.rollingMean,
      rollingStddev: b.rollingStddev,
      lastValue: b.lastValue,
      lastUpdatedAt: b.lastUpdatedAt,
    })),
    reportStats: {
      total: totalReports,
      confirmed: confirmedReports,
      falsePositive: falsePositiveReports,
      unreviewed: totalReports - confirmedReports - falsePositiveReports,
    },
  });
}
