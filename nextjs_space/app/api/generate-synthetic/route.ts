export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import {
  generateSyntheticLogs,
  logsToCSV,
  logsToJSON,
  logsToTXT,
  type SyntheticLogConfig,
} from "@/lib/synthetic-generator";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      logSource = "windows_event",
      count = 100,
      startDate,
      endDate,
      anomalyPercentage = 10,
      outputFormat = "csv",
    } = body ?? {};

    const config: SyntheticLogConfig = {
      logSource,
      count: Math.min(Math.max(count, 10), 10000),
      startDate: startDate ? new Date(startDate) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      endDate: endDate ? new Date(endDate) : new Date(),
      anomalyPercentage: Math.min(Math.max(anomalyPercentage, 0), 50),
    };

    const logs = generateSyntheticLogs(config);

    let content: string;
    let contentType: string;
    let fileExtension: string;

    switch (outputFormat) {
      case "json":
        content = logsToJSON(logs);
        contentType = "application/json";
        fileExtension = "json";
        break;
      case "txt":
        content = logsToTXT(logs);
        contentType = "text/plain";
        fileExtension = "txt";
        break;
      case "csv":
      default:
        content = logsToCSV(logs);
        contentType = "text/csv";
        fileExtension = "csv";
        break;
    }

    const fileName = `synthetic_${logSource}_${Date.now()}.${fileExtension}`;

    return NextResponse.json({
      content,
      fileName,
      contentType,
      recordCount: logs.length,
      anomalyCount: Math.floor(logs.length * (anomalyPercentage / 100)),
    });
  } catch (error) {
    console.error("Generate synthetic error:", error);
    return NextResponse.json(
      { error: "Failed to generate synthetic logs" },
      { status: 500 }
    );
  }
}