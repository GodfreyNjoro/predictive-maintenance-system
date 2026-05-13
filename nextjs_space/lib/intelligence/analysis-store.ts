/**
 * Analysis History Store — Phase 9.1
 *
 * Saves every Intelligence report per application, computes a log fingerprint,
 * auto-extracts tags, and provides similarity search for RAG.
 *
 * CRITICAL: All operations are scoped by applicationId. Data from one
 * application is NEVER mixed with another.
 */

import { prisma } from "@/lib/db";

export interface LogFingerprint {
  sources: Record<string, { total: number; critical: number; error: number; warning: number; info: number }>;
  totalLogs: number;
  hoursBack: number;
}

export interface SaveReportInput {
  applicationId: string;
  logFingerprint: LogFingerprint;
  analysisResult: Record<string, unknown>;
  summary: string;
}

/** Extract searchable tags from the LLM analysis result. */
function extractTags(result: Record<string, unknown>, fingerprint: LogFingerprint): string[] {
  const tags = new Set<string>();

  // Sources as tags
  for (const src of Object.keys(fingerprint.sources)) {
    tags.add(`source:${src}`);
  }

  // Severity-dominant source tags
  for (const [src, stats] of Object.entries(fingerprint.sources)) {
    if (stats.critical > 0) tags.add(`critical:${src}`);
    if (stats.error > 0) tags.add(`error:${src}`);
  }

  // Pattern categories
  const patterns = result.patternInsights as Array<{ severity?: string; title?: string }> | undefined;
  if (Array.isArray(patterns)) {
    for (const p of patterns) {
      if (p.severity) tags.add(`severity:${p.severity}`);
      if (p.title) tags.add(`pattern:${p.title.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 50)}`);
    }
  }

  // Risk levels
  const risks = result.riskAssessment as Array<{ likelihood?: string; impact?: string }> | undefined;
  if (Array.isArray(risks)) {
    for (const r of risks) {
      if (r.likelihood === "high" && r.impact === "high") tags.add("risk:critical");
      else if (r.likelihood === "high" || r.impact === "high") tags.add("risk:high");
    }
  }

  // Technologies
  const profile = result.systemProfile as { technologies?: string[] } | undefined;
  if (profile?.technologies) {
    for (const t of profile.technologies) {
      tags.add(`tech:${t.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`);
    }
  }

  return Array.from(tags);
}

/** Compute Jaccard similarity between two tag sets. */
function tagSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Save a completed analysis report. */
export async function saveAnalysisReport(input: SaveReportInput) {
  const tags = extractTags(input.analysisResult, input.logFingerprint);

  return prisma.analysisReport.create({
    data: {
      applicationId: input.applicationId,
      logFingerprint: input.logFingerprint as any,
      analysisResult: input.analysisResult as any,
      summary: input.summary,
      tags,
    },
  });
}

/** Get recent analysis reports for an application (newest first). */
export async function getRecentReports(applicationId: string, limit = 20) {
  return prisma.analysisReport.findMany({
    where: { applicationId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/** Find the N most similar past reports for RAG context. */
export async function findSimilarReports(
  applicationId: string,
  currentTags: string[],
  limit = 5,
): Promise<Array<{ id: string; summary: string; tags: string[]; similarity: number; createdAt: Date; verdict: string | null }>> {
  // Fetch recent reports (up to 50) for this application only
  const candidates = await prisma.analysisReport.findMany({
    where: { applicationId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, summary: true, tags: true, createdAt: true, verdict: true },
  });

  // Rank by tag similarity
  const scored = candidates.map((c) => ({
    ...c,
    similarity: tagSimilarity(currentTags, c.tags),
  }));

  return scored
    .filter((s) => s.similarity > 0.1)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

/** Update operator verdict on a report. */
export async function setReportVerdict(
  reportId: string,
  applicationId: string,
  verdict: "confirmed" | "false_positive",
  userId: string,
  notes?: string,
) {
  return prisma.analysisReport.updateMany({
    where: { id: reportId, applicationId },
    data: {
      verdict,
      verdictNotes: notes ?? null,
      verdictAt: new Date(),
      verdictBy: userId,
    },
  });
}
