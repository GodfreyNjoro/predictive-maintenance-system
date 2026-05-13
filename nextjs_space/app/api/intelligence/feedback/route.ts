/**
 * POST /api/intelligence/feedback
 * Submit operator verdict on a report or pattern.
 *
 * Body: {
 *   type: "report" | "pattern",
 *   id: string,
 *   applicationId: string,
 *   verdict: "confirmed" | "false_positive",
 *   notes?: string
 * }
 */
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { setReportVerdict } from "@/lib/intelligence/analysis-store";
import { setPatternVerdict } from "@/lib/intelligence/pattern-library";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const { type, id, applicationId, verdict, notes } = body;

  if (!type || !id || !applicationId || !verdict) {
    return NextResponse.json({ error: "type, id, applicationId, and verdict are required" }, { status: 400 });
  }

  if (!['confirmed', 'false_positive'].includes(verdict)) {
    return NextResponse.json({ error: "verdict must be 'confirmed' or 'false_positive'" }, { status: 400 });
  }

  try {
    if (type === "report") {
      await setReportVerdict(id, applicationId, verdict, (session.user as any).id ?? "unknown", notes);
    } else if (type === "pattern") {
      await setPatternVerdict(id, applicationId, verdict, notes);
    } else {
      return NextResponse.json({ error: "type must be 'report' or 'pattern'" }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[intelligence/feedback] Error:", err);
    return NextResponse.json({ error: err.message ?? "Failed to save feedback" }, { status: 500 });
  }
}
