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
    const page = parseInt(searchParams.get("page") ?? "1");
    const limit = parseInt(searchParams.get("limit") ?? "20");
    const severity = searchParams.get("severity");
    const predictionType = searchParams.get("predictionType");
    const applicationId = searchParams.get("applicationId");

    const where: any = {};
    if (severity) where.severity = severity;
    if (predictionType) where.predictionType = predictionType;
    // Scope predictions to a specific application by joining through LogFile.
    // Only predictions linked to a LogFile that belongs to this application
    // are returned. Predictions without a logFile (synthetic /system-analysis
    // results, retrains, etc.) are excluded when scoping.
    if (applicationId) {
      where.logFile = { applicationId };
    }

    const [predictions, total] = await Promise.all([
      prisma.prediction.findMany({
        where,
        include: {
          logFile: {
            select: { fileName: true, logSource: true },
          },
          feedback: {
            select: { feedbackType: true, notes: true },
          },
          modelVersion: {
            select: { version: true },
          },
        },
        orderBy: { predictedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.prediction.count({ where }),
    ]);

    return NextResponse.json({
      predictions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Get predictions error:", error);
    return NextResponse.json(
      { error: "Failed to fetch predictions" },
      { status: 500 }
    );
  }
}