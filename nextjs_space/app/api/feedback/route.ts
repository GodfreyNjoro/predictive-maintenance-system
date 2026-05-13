export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as any).id;
    const body = await request.json();
    const { predictionId, feedbackType, notes } = body ?? {};

    if (!predictionId || !feedbackType) {
      return NextResponse.json(
        { error: "predictionId and feedbackType are required" },
        { status: 400 }
      );
    }

    const validTypes = ["true_positive", "false_positive", "missed_incident"];
    if (!validTypes.includes(feedbackType)) {
      return NextResponse.json(
        { error: "Invalid feedback type" },
        { status: 400 }
      );
    }

    // Upsert feedback
    const feedback = await prisma.feedback.upsert({
      where: {
        predictionId_userId: {
          predictionId,
          userId,
        },
      },
      update: {
        feedbackType,
        notes,
      },
      create: {
        predictionId,
        userId,
        feedbackType,
        notes,
      },
    });

    // Create audit entry
    await prisma.auditEntry.create({
      data: {
        userId,
        predictionId,
        action: "feedback_submitted",
        details: JSON.stringify({ feedbackType, notes }),
      },
    });

    return NextResponse.json(feedback);
  } catch (error) {
    console.error("Feedback error:", error);
    return NextResponse.json(
      { error: "Failed to submit feedback" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const predictionId = searchParams.get("predictionId");

    const where: any = {};
    if (predictionId) where.predictionId = predictionId;

    const feedback = await prisma.feedback.findMany({
      where,
      include: {
        user: { select: { name: true, email: true } },
        prediction: { select: { predictionType: true, severity: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ feedback });
  } catch (error) {
    console.error("Get feedback error:", error);
    return NextResponse.json(
      { error: "Failed to fetch feedback" },
      { status: 500 }
    );
  }
}