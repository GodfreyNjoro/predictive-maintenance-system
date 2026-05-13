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
    const limit = parseInt(searchParams.get("limit") ?? "50");
    const action = searchParams.get("action");

    const where: any = {};
    if (action) where.action = action;

    const [entries, total] = await Promise.all([
      prisma.auditEntry.findMany({
        where,
        include: {
          user: { select: { name: true, email: true } },
          prediction: {
            select: { predictionType: true, severity: true, confidence: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.auditEntry.count({ where }),
    ]);

    return NextResponse.json({
      entries,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Audit trail error:", error);
    return NextResponse.json(
      { error: "Failed to fetch audit trail" },
      { status: 500 }
    );
  }
}