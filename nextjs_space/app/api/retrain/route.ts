export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";
import { retrainModel, getModel } from "@/lib/ml-model";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as any).id;
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (user?.role !== "admin") {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    }

    // Get all predictions with feedback
    const feedbackData = await prisma.feedback.findMany({
      include: {
        prediction: {
          select: { features: true, predictionType: true },
        },
      },
    });

    // Prepare training data from feedback
    const trainingFeedback = feedbackData
      .filter((f) => f.prediction?.features)
      .map((f) => ({
        isAnomaly: f.feedbackType === "true_positive" || f.feedbackType === "missed_incident",
        features: JSON.parse(f.prediction?.features ?? "[]") as number[],
      }));

    // Get baseline normal data
    const normalData: number[][] = [];
    for (let i = 0; i < 300; i++) {
      normalData.push([
        Math.random() * 0.1,
        Math.random() * 0.15,
        Math.floor(Math.random() * 2),
        0.3 + Math.random() * 0.4,
        0.2 + Math.random() * 0.3,
        Math.random() * 0.2,
        Math.random() * 0.3,
        Math.random() * 0.1,
        Math.random() * 0.3,
        Math.random() * 0.1,
      ]);
    }

    // Retrain model
    retrainModel(normalData, trainingFeedback);

    // Deactivate old model version
    await prisma.modelVersion.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    });

    // Create new model version
    const versionNum = await prisma.modelVersion.count();
    const params = getModel().getParameters();

    const newModel = await prisma.modelVersion.create({
      data: {
        version: `v1.${versionNum}.0`,
        modelType: "isolation_forest",
        parameters: JSON.stringify(params),
        isActive: true,
        trainingSamples: normalData.length + trainingFeedback.length,
        feedbackIncluded: trainingFeedback.length,
      },
    });

    // Audit
    await prisma.auditEntry.create({
      data: {
        userId,
        action: "model_retrained",
        details: JSON.stringify({
          newVersion: newModel.version,
          trainingSamples: newModel.trainingSamples,
          feedbackIncluded: newModel.feedbackIncluded,
        }),
      },
    });

    return NextResponse.json({
      success: true,
      modelVersion: newModel.version,
      trainingSamples: newModel.trainingSamples,
      feedbackIncluded: newModel.feedbackIncluded,
    });
  } catch (error) {
    console.error("Retrain error:", error);
    return NextResponse.json(
      { error: "Failed to retrain model" },
      { status: 500 }
    );
  }
}