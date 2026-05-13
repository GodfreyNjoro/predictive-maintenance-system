export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const applicationId = searchParams.get("applicationId");

    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // When scoped to an Application, every count/aggregate joins through
    // LogFile.applicationId. Predictions / ParsedLogs join transitively
    // via their logFile relation. Synthetic predictions without a logFile
    // are excluded when scoping (same convention as /api/predictions).
    const logFileWhere: any = applicationId ? { applicationId } : {};
    const predictionScope: any = applicationId ? { logFile: { applicationId } } : {};
    const parsedLogScope: any = applicationId ? { logFile: { applicationId } } : {};

    // Batch 1 - File and prediction counts
    const [totalFiles, processedFiles, totalPredictions, recentPredictions] = await Promise.all([
      prisma.logFile.count({ where: logFileWhere }),
      prisma.logFile.count({ where: { ...logFileWhere, status: "processed" } }),
      prisma.prediction.count({ where: predictionScope }),
      prisma.prediction.count({ where: { ...predictionScope, predictedAt: { gte: last24h } } }),
    ]);

    // Batch 2 - Severity counts
    const [criticalAlerts, highAlerts, mediumAlerts, lowAlerts] = await Promise.all([
      prisma.prediction.count({ where: { ...predictionScope, severity: "critical" } }),
      prisma.prediction.count({ where: { ...predictionScope, severity: "high" } }),
      prisma.prediction.count({ where: { ...predictionScope, severity: "medium" } }),
      prisma.prediction.count({ where: { ...predictionScope, severity: "low" } }),
    ]);

    // Batch 3 - Feedback and model
    // Feedback is scoped via prediction.logFile.applicationId when filtering.
    const feedbackScope: any = applicationId
      ? { prediction: { logFile: { applicationId } } }
      : {};
    const [totalFeedback, truePositives, falsePositives, activeModel] = await Promise.all([
      prisma.feedback.count({ where: feedbackScope }),
      prisma.feedback.count({ where: { ...feedbackScope, feedbackType: "true_positive" } }),
      prisma.feedback.count({ where: { ...feedbackScope, feedbackType: "false_positive" } }),
      prisma.modelVersion.findFirst({ where: { isActive: true } }),
    ]);

    // Batch 4 - Stats and activity
    const [logStats, recentActivity] = await Promise.all([
      prisma.parsedLog.groupBy({
        by: ["logLevel"],
        where: parsedLogScope,
        _count: true,
      }),
      prisma.prediction.findMany({
        where: { ...predictionScope, predictedAt: { gte: last7d } },
        select: {
          predictedAt: true,
          severity: true,
          predictionType: true,
          confidence: true,
        },
        orderBy: { predictedAt: "desc" },
        take: 50,
      }),
    ]);

    // Calculate health score
    const criticalWeight = criticalAlerts * 4;
    const highWeight = highAlerts * 2;
    const mediumWeight = mediumAlerts * 1;
    const totalWeight = criticalWeight + highWeight + mediumWeight;
    const healthScore = Math.max(0, 100 - totalWeight * 2);

    // Calculate accuracy if feedback exists
    let accuracy = 0;
    if (totalFeedback > 0) {
      accuracy = (truePositives / totalFeedback) * 100;
    }

    const logLevelStats = logStats.reduce(
      (acc, stat) => {
        acc[stat.logLevel] = stat._count;
        return acc;
      },
      {} as Record<string, number>
    );

    return NextResponse.json({
      scope: {
        applicationId: applicationId ?? null,
      },
      overview: {
        totalFiles,
        processedFiles,
        totalPredictions,
        recentPredictions,
        healthScore,
      },
      alerts: {
        critical: criticalAlerts,
        high: highAlerts,
        medium: mediumAlerts,
        low: lowAlerts,
      },
      model: {
        version: activeModel?.version ?? "v1.0.0",
        trainedAt: activeModel?.trainedAt,
        trainingSamples: activeModel?.trainingSamples ?? 0,
        feedbackIncluded: activeModel?.feedbackIncluded ?? 0,
      },
      feedback: {
        total: totalFeedback,
        truePositives,
        falsePositives,
        accuracy,
      },
      logStats: logLevelStats,
      recentActivity,
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    return NextResponse.json(
      { error: "Failed to fetch dashboard data" },
      { status: 500 }
    );
  }
}
