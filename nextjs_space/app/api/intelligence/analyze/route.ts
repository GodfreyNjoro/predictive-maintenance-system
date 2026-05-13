/**
 * Log Intelligence API — Phase 9: Adaptive Intelligence Engine
 *
 * POST /api/intelligence/analyze
 *
 * Pulls recent parsed logs FOR A SPECIFIC APPLICATION, enriches the prompt
 * with RAG context (past analyses, baselines, patterns), sends to LLM,
 * then persists the report + updates baselines + catalogues patterns.
 *
 * CRITICAL: applicationId is REQUIRED. All data is strictly per-application.
 *
 * Body: { applicationId: string, hoursBack?: number, maxLogs?: number }
 * Streams SSE back to the client.
 */
export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";
import { saveAnalysisReport, type LogFingerprint } from "@/lib/intelligence/analysis-store";
import { updateBaselines, statsToSamples } from "@/lib/intelligence/baseline-learning";
import { upsertPatterns, type PatternInput } from "@/lib/intelligence/pattern-library";
import { buildRAGContext, formatRAGPromptSection } from "@/lib/intelligence/rag-pipeline";

const LLM_URL = "https://apps.abacus.ai/v1/chat/completions";
const MODEL = "gpt-4.1-mini";

interface LogSample {
  timestamp: string;
  level: string;
  source: string;
  message: string;
  features?: string | null;
}

function buildPrompt(
  logs: LogSample[],
  appName: string,
  sources: string[],
  stats: Record<string, { total: number; critical: number; error: number; warning: number; info: number }>,
  ragSection: string,
) {
  const sourceStats = Object.entries(stats)
    .map(([src, s]) => `  ${src}: ${s.total} entries (${s.critical} critical, ${s.error} error, ${s.warning} warning, ${s.info} info)`)
    .join("\n");

  // Sample a representative slice: all critical/error + some warnings + a few info
  const critical = logs.filter((l) => l.level === "critical");
  const errors = logs.filter((l) => l.level === "error").slice(0, 30);
  const warnings = logs.filter((l) => l.level === "warning").slice(0, 20);
  const infos = logs.filter((l) => l.level === "info").slice(0, 10);
  const sample = [...critical, ...errors, ...warnings, ...infos].slice(0, 100);

  const logBlock = sample
    .map((l) => {
      const feat = l.features ? ` | features: ${l.features}` : "";
      return `[${l.timestamp}] [${l.level.toUpperCase()}] [${l.source}] ${l.message}${feat}`;
    })
    .join("\n");

  return `You are an expert systems engineer and database administrator analyzing telemetry from a production infrastructure monitoring system called "Predictive Maintenance System" (PMS).

You are analyzing application: "${appName}"
All data below comes exclusively from this application. Do NOT reference or assume data from any other application.

The system collects data from ${sources.length} distinct telemetry sources:
${sourceStats}

Here are ${sample.length} representative log entries (sampled from ${logs.length} total in the time window):

${logBlock}
${ragSection}

Please analyze this data and respond with a JSON object containing exactly these fields:

{
  "systemProfile": {
    "description": "2-3 sentence overview of what kind of system this appears to be",
    "components": ["list of identified components/services/servers"],
    "architecture": "brief architecture description",
    "technologies": ["identified technologies"]
  },
  "activityNarrative": "A 3-5 paragraph narrative in plain English explaining what was happening during this time window. Write it like a story. Be specific about timestamps and events.",
  "patternInsights": [
    {
      "title": "Short pattern name",
      "description": "What the pattern is and why it matters",
      "severity": "critical|high|medium|low",
      "evidence": "Specific log entries or metrics that support this",
      "affectedComponents": ["which components are affected"]
    }
  ],
  "riskAssessment": [
    {
      "risk": "What could go wrong",
      "likelihood": "high|medium|low",
      "impact": "high|medium|low",
      "recommendation": "What to do about it",
      "timeframe": "How soon this might happen"
    }
  ],
  "correlations": [
    {
      "sources": ["source A", "source B"],
      "relationship": "How these sources relate",
      "significance": "Why this correlation matters"
    }
  ],
  "summary": "A single paragraph executive summary of system health and the most important finding.",
  "baselineComparison": "If baselines are available, describe how current metrics compare to this application's historical norms. Highlight any significant deviations."
}

IMPORTANT:
- ALL analysis must be about the specific application "${appName}" only.
- Be specific — reference actual log messages, timestamps, sources, and metrics.
- Look for CAUSAL RELATIONSHIPS between sources.
- If adaptive context is provided above, compare current state against historical baselines and known patterns.
- If a known pattern recurs, note whether it's escalating, stable, or improving.
- Respect operator verdicts — deprioritize patterns marked as false positives.

Respond with raw JSON only. Do not include code blocks, markdown, or any other formatting.`;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const applicationId: string | undefined = body.applicationId;
  const hoursBack = Math.min(Math.max(Number(body.hoursBack) || 24, 1), 168);
  const maxLogs = Math.min(Math.max(Number(body.maxLogs) || 500, 50), 2000);

  if (!applicationId) {
    return new Response(
      JSON.stringify({ error: "applicationId is required. Select an application to analyze." }),
      { status: 400 },
    );
  }

  // Verify application exists
  const app = await prisma.application.findUnique({
    where: { id: applicationId },
    select: { id: true, name: true },
  });
  if (!app) {
    return new Response(JSON.stringify({ error: "Application not found." }), { status: 404 });
  }

  const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

  // Fetch logs ONLY for this application
  const logs = await prisma.parsedLog.findMany({
    where: {
      timestamp: { gte: since },
      logFile: { applicationId },
    },
    orderBy: { timestamp: "desc" },
    take: maxLogs,
    select: {
      timestamp: true,
      logLevel: true,
      source: true,
      message: true,
      features: true,
    },
  });

  if (logs.length === 0) {
    return new Response(
      JSON.stringify({
        error: `No logs found for application "${app.name}" in the last ${hoursBack} hours. Generate some test data first using the Test Harness.`,
      }),
      { status: 404 },
    );
  }

  // Compute per-source stats
  const stats: Record<string, { total: number; critical: number; error: number; warning: number; info: number }> = {};
  for (const log of logs) {
    if (!stats[log.source]) stats[log.source] = { total: 0, critical: 0, error: 0, warning: 0, info: 0 };
    stats[log.source].total++;
    const lvl = log.logLevel as "critical" | "error" | "warning" | "info";
    if (stats[log.source][lvl] !== undefined) stats[log.source][lvl]++;
  }

  const sources = Object.keys(stats);
  const samples: LogSample[] = logs.map((l) => ({
    timestamp: l.timestamp.toISOString(),
    level: l.logLevel,
    source: l.source,
    message: l.message,
    features: l.features,
  }));

  // ---- Phase 9: Baseline deviations + RAG context ----
  const metricSamples = statsToSamples(stats);
  let deviations: Awaited<ReturnType<typeof updateBaselines>> = [];
  try {
    deviations = await updateBaselines(applicationId, metricSamples);
  } catch (e) {
    console.error("[intelligence] Baseline update error:", e);
    deviations = [];
  }

  // Build tags for similarity search
  const currentTags: string[] = [];
  for (const src of sources) currentTags.push(`source:${src}`);
  for (const [src, s] of Object.entries(stats)) {
    if (s.critical > 0) currentTags.push(`critical:${src}`);
    if (s.error > 0) currentTags.push(`error:${src}`);
  }

  let ragSection = "";
  try {
    const ragCtx = await buildRAGContext(applicationId, currentTags, deviations);
    ragSection = formatRAGPromptSection(ragCtx);
  } catch (e) {
    console.error("[intelligence] RAG context error:", e);
  }

  const prompt = buildPrompt(samples, app.name, sources, stats, ragSection);

  const apiKey = process.env.ABACUSAI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "LLM API key not configured" }), { status: 500 });
  }

  // Stream from LLM
  const llmRes = await fetch(LLM_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      stream: true,
      max_tokens: 4000,
      temperature: 0.3,
      response_format: { type: "json_object" },
    }),
  });

  if (!llmRes.ok) {
    const errText = await llmRes.text().catch(() => "Unknown LLM error");
    return new Response(JSON.stringify({ error: `LLM API error: ${errText}` }), { status: 502 });
  }

  const reader = llmRes.body?.getReader();
  if (!reader) {
    return new Response(JSON.stringify({ error: "No response body from LLM" }), { status: 502 });
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const fingerprint: LogFingerprint = { sources: stats, totalLogs: logs.length, hoursBack };

  const stream = new ReadableStream({
    async start(controller) {
      let buffer = "";
      let partialRead = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          partialRead += decoder.decode(value, { stream: true });
          const lines = partialRead.split("\n");
          partialRead = lines.pop() || "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") {
                await finalize(buffer, controller, encoder, fingerprint, applicationId, stats, logs.length, sources.length, deviations);
                return;
              }
              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content || "";
                buffer += content;
                const progressData = JSON.stringify({ status: "processing", chunk: content });
                controller.enqueue(encoder.encode(`data: ${progressData}\n\n`));
              } catch {
                // skip
              }
            }
          }
        }
        // If we exit loop without [DONE]
        if (buffer.length > 0) {
          await finalize(buffer, controller, encoder, fingerprint, applicationId, stats, logs.length, sources.length, deviations);
        }
      } catch (err: any) {
        const errData = JSON.stringify({ status: "error", message: err.message ?? "Stream error" });
        controller.enqueue(encoder.encode(`data: ${errData}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

async function finalize(
  buffer: string,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  fingerprint: LogFingerprint,
  applicationId: string,
  stats: Record<string, { total: number; critical: number; error: number; warning: number; info: number }>,
  logCount: number,
  sourceCount: number,
  deviations: Array<{ source: string; metricName: string; currentValue: number; baselineMean: number; baselineStddev: number; deviationSigma: number; direction: string; sampleCount: number }>,
) {
  let finalResult: any;
  try {
    finalResult = JSON.parse(buffer);
  } catch {
    finalResult = { summary: buffer };
  }

  // ---- Phase 9: Persist report + update patterns ----
  let reportId: string | null = null;
  try {
    const report = await saveAnalysisReport({
      applicationId,
      logFingerprint: fingerprint,
      analysisResult: finalResult,
      summary: finalResult.summary ?? "",
    });
    reportId = report.id;
  } catch (e) {
    console.error("[intelligence] Failed to save report:", e);
  }

  // Upsert patterns from pattern insights
  let patternStats = { created: 0, updated: 0 };
  try {
    const insights = finalResult.patternInsights;
    if (Array.isArray(insights) && insights.length > 0) {
      const patternInputs: PatternInput[] = insights.map((p: any) => ({
        title: p.title ?? "Unknown",
        description: p.description ?? "",
        severity: p.severity ?? "medium",
        affectedSources: Array.isArray(p.affectedComponents) ? p.affectedComponents : [],
      }));
      patternStats = await upsertPatterns(applicationId, patternInputs);
    }
  } catch (e) {
    console.error("[intelligence] Failed to upsert patterns:", e);
  }

  const finalData = JSON.stringify({
    status: "completed",
    result: finalResult,
    logCount,
    sourceCount,
    stats,
    reportId,
    deviations,
    patternStats,
    applicationId,
  });
  controller.enqueue(encoder.encode(`data: ${finalData}\n\n`));
}
