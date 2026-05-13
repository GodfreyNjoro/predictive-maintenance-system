export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";
import { 
  extractDynamicFeatures, 
  DynamicMultiSourceLogs,
  DynamicFeatureVector 
} from "@/lib/feature-extractor";
import { makeDynamicPrediction, DynamicPredictionResult } from "@/lib/ml-model";
import { ParsedLogEntry } from "@/lib/log-parser";
import { generateExplanation, ExplainablePrediction } from "@/lib/explainable-ai";

interface SystemAnalysisResponse {
  success: boolean;
  analysis?: DynamicPredictionResult;
  explanation?: ExplainablePrediction;
  features?: DynamicFeatureVector;
  logSummary?: {
    sources: { [sourceName: string]: number };
    total: number;
    timeRange: { start: string; end: string } | null;
  };
  error?: string;
}

/**
 * Build a {sourceName -> healthScore} record from the dynamic prediction result,
 * which is what the explainable-ai module needs.
 */
function extractHealthScores(analysis: DynamicPredictionResult): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, sh] of Object.entries(analysis.sourceAnalysis)) {
    out[name] = sh.score;
  }
  return out;
}

export async function GET(request: NextRequest): Promise<NextResponse<SystemAnalysisResponse>> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const hoursBack = parseInt(searchParams.get("hours") ?? "24");
    const applicationId = searchParams.get("applicationId");
    const startDate = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

    // Fetch logs from all sources within the time window. When scoped to a
    // specific Application, only ParsedLog rows whose parent LogFile belongs
    // to that Application are considered.
    const logsWhere: any = { timestamp: { gte: startDate } };
    if (applicationId) {
      logsWhere.logFile = { applicationId };
    }

    const logs = await prisma.parsedLog.findMany({
      where: logsWhere,
      include: {
        logFile: {
          select: { logSource: true, applicationId: true },
        },
      },
      orderBy: { timestamp: "desc" },
    });

    if (logs.length === 0) {
      return NextResponse.json({
        success: true,
        analysis: {
          isAnomaly: false,
          anomalyScore: 0,
          confidence: 0,
          severity: "low",
          predictionType: "normal",
          overallSystemHealth: 100,
          description: "No logs found in the specified time window. Upload logs to begin analysis.",
          sourceAnalysis: {},
          correlationInsights: {
            crossSourceCorrelation: "No data available",
            cascadeRisk: "No data available",
            temporalClustering: "No data available",
          },
          recommendations: ["📤 Upload system logs to enable predictive analysis"],
        },
        logSummary: {
          sources: {},
          total: 0,
          timeRange: null,
        },
      });
    }

    // Categorize logs dynamically by logSource field
    const multiSourceLogs: DynamicMultiSourceLogs = {};

    logs.forEach((log) => {
      const entry: ParsedLogEntry = {
        timestamp: log.timestamp,
        logLevel: log.logLevel as "info" | "warning" | "error" | "critical",
        source: log.source,
        eventId: log.eventId ?? undefined,
        message: log.message,
        rawData: log.rawData ?? undefined,
      };

      // Use the logSource from the file, or extract from source field, or use "General"
      let sourceName = log.logFile?.logSource ?? log.source ?? "General";
      
      // Normalize source name (capitalize, remove underscores)
      sourceName = sourceName
        .replace(/_/g, " ")
        .replace(/\b\w/g, c => c.toUpperCase())
        .trim() || "General";

      if (!multiSourceLogs[sourceName]) {
        multiSourceLogs[sourceName] = [];
      }
      multiSourceLogs[sourceName].push(entry);
    });

    // Extract dynamic features
    const features = extractDynamicFeatures(multiSourceLogs);
    
    // Make dynamic prediction
    const analysis = makeDynamicPrediction(features);

    // Generate explainable AI insights (rich root-cause analysis)
    const explanation = generateExplanation(
      features,
      analysis.anomalyScore,
      extractHealthScores(analysis)
    );

    // Get time range
    const timestamps = logs.map(l => l.timestamp.getTime());
    const minTime = new Date(Math.min(...timestamps));
    const maxTime = new Date(Math.max(...timestamps));

    // Build source counts for summary
    const sourceCounts: { [sourceName: string]: number } = {};
    Object.entries(multiSourceLogs).forEach(([name, entries]) => {
      sourceCounts[name] = entries.length;
    });

    // Store the prediction
    const modelVersion = await prisma.modelVersion.findFirst({
      where: { isActive: true },
      orderBy: { trainedAt: "desc" },
    });

    if (modelVersion) {
      await prisma.prediction.create({
        data: {
          modelVersionId: modelVersion.id,
          predictionType: analysis.predictionType,
          severity: analysis.severity,
          confidence: analysis.confidence,
          anomalyScore: analysis.anomalyScore,
          affectedSystem: Object.keys(multiSourceLogs).join(", "),
          description: analysis.description,
          features: JSON.stringify(features),
        },
      });

      // Create audit entry
      await prisma.auditEntry.create({
        data: {
          action: "SYSTEM_ANALYSIS",
          userId: (session.user as any).id,
          details: JSON.stringify({
            logsAnalyzed: logs.length,
            sources: sourceCounts,
            severity: analysis.severity,
            healthScore: analysis.overallSystemHealth,
          }),
        },
      });
    }

    return NextResponse.json({
      success: true,
      analysis,
      explanation,
      features,
      logSummary: {
        sources: sourceCounts,
        total: logs.length,
        timeRange: {
          start: minTime.toISOString(),
          end: maxTime.toISOString(),
        },
      },
    });
  } catch (error) {
    console.error("System analysis error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to perform system analysis" },
      { status: 500 }
    );
  }
}

// POST endpoint for on-demand analysis with specific log files
export async function POST(request: NextRequest): Promise<NextResponse<SystemAnalysisResponse>> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { logFileIds } = body;

    if (!logFileIds || !Array.isArray(logFileIds) || logFileIds.length === 0) {
      return NextResponse.json(
        { success: false, error: "Please provide log file IDs to analyze" },
        { status: 400 }
      );
    }

    // Fetch logs from specified files
    const logs = await prisma.parsedLog.findMany({
      where: {
        logFileId: { in: logFileIds },
      },
      include: {
        logFile: {
          select: { logSource: true },
        },
      },
      orderBy: { timestamp: "desc" },
    });

    if (logs.length === 0) {
      return NextResponse.json(
        { success: false, error: "No parsed logs found for the specified files" },
        { status: 404 }
      );
    }

    // Categorize logs dynamically by logSource field
    const multiSourceLogs: DynamicMultiSourceLogs = {};

    logs.forEach((log) => {
      const entry: ParsedLogEntry = {
        timestamp: log.timestamp,
        logLevel: log.logLevel as "info" | "warning" | "error" | "critical",
        source: log.source,
        eventId: log.eventId ?? undefined,
        message: log.message,
        rawData: log.rawData ?? undefined,
      };

      // Use the logSource from the file, or extract from source field, or use "General"
      let sourceName = log.logFile?.logSource ?? log.source ?? "General";
      
      // Normalize source name
      sourceName = sourceName
        .replace(/_/g, " ")
        .replace(/\b\w/g, c => c.toUpperCase())
        .trim() || "General";

      if (!multiSourceLogs[sourceName]) {
        multiSourceLogs[sourceName] = [];
      }
      multiSourceLogs[sourceName].push(entry);
    });

    // Extract dynamic features and make prediction
    const features = extractDynamicFeatures(multiSourceLogs);
    const analysis = makeDynamicPrediction(features);

    // Generate explainable AI insights (rich root-cause analysis)
    const explanation = generateExplanation(
      features,
      analysis.anomalyScore,
      extractHealthScores(analysis)
    );

    // Get time range
    const timestamps = logs.map(l => l.timestamp.getTime());
    const minTime = new Date(Math.min(...timestamps));
    const maxTime = new Date(Math.max(...timestamps));

    // Build source counts for summary
    const sourceCounts: { [sourceName: string]: number } = {};
    Object.entries(multiSourceLogs).forEach(([name, entries]) => {
      sourceCounts[name] = entries.length;
    });

    return NextResponse.json({
      success: true,
      analysis,
      explanation,
      features,
      logSummary: {
        sources: sourceCounts,
        total: logs.length,
        timeRange: {
          start: minTime.toISOString(),
          end: maxTime.toISOString(),
        },
      },
    });
  } catch (error) {
    console.error("System analysis error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to perform system analysis" },
      { status: 500 }
    );
  }
}
