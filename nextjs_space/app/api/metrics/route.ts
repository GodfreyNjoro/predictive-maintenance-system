export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get all predictions with feedback
    const predictions = await prisma.prediction.findMany({
      include: {
        feedback: true,
      },
    });

    // Calculate metrics
    let truePositives = 0;
    let falsePositives = 0;
    let trueNegatives = 0;
    let falseNegatives = 0;

    predictions.forEach((pred) => {
      const feedback = pred.feedback?.[0];
      if (!feedback) return;

      const wasAnomaly = pred.predictionType !== "normal";

      if (feedback.feedbackType === "true_positive" && wasAnomaly) {
        truePositives++;
      } else if (feedback.feedbackType === "false_positive" && wasAnomaly) {
        falsePositives++;
      } else if (feedback.feedbackType === "true_positive" && !wasAnomaly) {
        trueNegatives++;
      } else if (feedback.feedbackType === "missed_incident") {
        falseNegatives++;
      }
    });

    const total = truePositives + falsePositives + trueNegatives + falseNegatives;
    const accuracy = total > 0 ? ((truePositives + trueNegatives) / total) * 100 : 0;
    const precision = truePositives + falsePositives > 0 ? (truePositives / (truePositives + falsePositives)) * 100 : 0;
    const recall = truePositives + falseNegatives > 0 ? (truePositives / (truePositives + falseNegatives)) * 100 : 0;
    const f1Score = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    // Get model versions for trends
    const modelVersions = await prisma.modelVersion.findMany({
      orderBy: { trainedAt: "asc" },
      select: {
        version: true,
        trainedAt: true,
        trainingSamples: true,
        feedbackIncluded: true,
        metrics: true,
      },
    });

    // Get prediction distribution by severity
    const severityDistribution = await prisma.prediction.groupBy({
      by: ["severity"],
      _count: true,
    });

    // Get prediction distribution by type
    const typeDistribution = await prisma.prediction.groupBy({
      by: ["predictionType"],
      _count: true,
    });

    // Get predictions over time (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const predictionsOverTime = await prisma.prediction.findMany({
      where: { predictedAt: { gte: thirtyDaysAgo } },
      select: { predictedAt: true, severity: true },
      orderBy: { predictedAt: "asc" },
    });

    // Group by day
    const dailyPredictions: Record<string, { total: number; anomalies: number }> = {};
    predictionsOverTime.forEach((pred) => {
      const day = pred.predictedAt.toISOString().split("T")[0];
      if (!dailyPredictions[day]) {
        dailyPredictions[day] = { total: 0, anomalies: 0 };
      }
      dailyPredictions[day].total++;
      if (pred.severity !== "low") {
        dailyPredictions[day].anomalies++;
      }
    });

    return NextResponse.json({
      metrics: {
        accuracy,
        precision,
        recall,
        f1Score,
        confusionMatrix: {
          truePositives,
          falsePositives,
          trueNegatives,
          falseNegatives,
        },
      },
      modelVersions,
      severityDistribution: severityDistribution.reduce(
        (acc, item) => {
          acc[item.severity] = item._count;
          return acc;
        },
        {} as Record<string, number>
      ),
      typeDistribution: typeDistribution.reduce(
        (acc, item) => {
          acc[item.predictionType] = item._count;
          return acc;
        },
        {} as Record<string, number>
      ),
      dailyPredictions: Object.entries(dailyPredictions).map(([date, data]) => ({
        date,
        ...data,
      })),
    });
  } catch (error) {
    console.error("Metrics error:", error);
    return NextResponse.json(
      { error: "Failed to fetch metrics" },
      { status: 500 }
    );
  }
}