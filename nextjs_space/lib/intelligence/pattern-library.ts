/**
 * Pattern Library — Phase 9.3
 *
 * Auto-catalogues recurring failure signatures extracted from analysis reports.
 * Matches new patterns against existing ones, increments counts, adjusts confidence.
 *
 * CRITICAL: All operations are scoped by applicationId. Data from one
 * application is NEVER mixed with another.
 */

import { prisma } from "@/lib/db";

export interface PatternInput {
  title: string;
  description: string;
  severity: string;
  affectedSources: string[];
  category?: string;
}

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  performance: ["slow", "latency", "timeout", "degradation", "response time", "throughput"],
  reliability: ["error", "failure", "crash", "restart", "down", "unavailable", "flapping"],
  security: ["auth", "login", "unauthorized", "breach", "permission", "access denied"],
  capacity: ["memory", "cpu", "disk", "connection pool", "exhaust", "overflow", "queue"],
  network: ["network", "dns", "tcp", "connection", "packet", "latency", "rtt"],
  database: ["query", "deadlock", "lock", "transaction", "index", "sql", "io stall"],
};

/** Infer a category from the pattern title + description. */
function inferCategory(title: string, description: string): string {
  const text = `${title} ${description}`.toLowerCase();
  let bestCategory = "reliability";
  let bestScore = 0;
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const score = keywords.filter((k) => text.includes(k)).length;
    if (score > bestScore) {
      bestScore = score;
      bestCategory = cat;
    }
  }
  return bestCategory;
}

/** Fuzzy match: do two pattern titles refer to the same issue? */
function isSamePattern(existing: string, incoming: string): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const a = normalize(existing);
  const b = normalize(incoming);
  if (a === b) return true;

  // Token overlap >= 60%
  const tokA = new Set(a.split(/\s+/));
  const tokB = new Set(b.split(/\s+/));
  let overlap = 0;
  for (const t of tokA) if (tokB.has(t)) overlap++;
  const minSize = Math.min(tokA.size, tokB.size);
  return minSize > 0 && overlap / minSize >= 0.6;
}

/**
 * Upsert patterns from a new analysis. If a similar pattern exists for this
 * application, increment its count and boost confidence. Otherwise create new.
 */
export async function upsertPatterns(
  applicationId: string,
  patterns: PatternInput[],
): Promise<{ created: number; updated: number }> {
  const existing = await prisma.patternSignature.findMany({
    where: { applicationId },
    orderBy: { lastSeenAt: "desc" },
    take: 100,
  });

  let created = 0;
  let updated = 0;

  for (const pat of patterns) {
    const category = pat.category || inferCategory(pat.title, pat.description);
    const match = existing.find((e) => isSamePattern(e.title, pat.title));

    if (match) {
      // Update existing pattern
      const newCount = match.occurrenceCount + 1;
      // Confidence grows: 0.5 base, +0.08 per occurrence, capped at 0.95
      const newConfidence = Math.min(0.95, 0.5 + newCount * 0.08);
      // Severity trend
      const severityOrder = ["low", "medium", "high", "critical"];
      const prevIdx = severityOrder.indexOf(match.severity);
      const currIdx = severityOrder.indexOf(pat.severity);
      let trend = match.severityTrend ?? "stable";
      if (currIdx > prevIdx) trend = "escalating";
      else if (currIdx < prevIdx) trend = "improving";

      await prisma.patternSignature.update({
        where: { id: match.id },
        data: {
          occurrenceCount: newCount,
          confidence: newConfidence,
          severity: pat.severity,
          severityTrend: trend,
          lastSeenAt: new Date(),
          description: pat.description,
          affectedSources: pat.affectedSources,
        },
      });
      updated++;
    } else {
      // Create new pattern
      await prisma.patternSignature.create({
        data: {
          applicationId,
          title: pat.title,
          description: pat.description,
          category,
          affectedSources: pat.affectedSources,
          severity: pat.severity,
          occurrenceCount: 1,
          confidence: 0.5,
          lastSeenAt: new Date(),
        },
      });
      created++;
    }
  }

  return { created, updated };
}

/** Get all patterns for an application, sorted by confidence descending. */
export async function getPatterns(applicationId: string, limit = 50) {
  return prisma.patternSignature.findMany({
    where: { applicationId },
    orderBy: [{ confidence: "desc" }, { lastSeenAt: "desc" }],
    take: limit,
  });
}

/** Get high-confidence patterns for RAG injection. */
export async function getEstablishedPatterns(applicationId: string, minConfidence = 0.6) {
  return prisma.patternSignature.findMany({
    where: {
      applicationId,
      confidence: { gte: minConfidence },
      operatorVerdict: { not: "false_positive" },
    },
    orderBy: { confidence: "desc" },
    take: 20,
  });
}

/** Update operator verdict on a pattern. */
export async function setPatternVerdict(
  patternId: string,
  applicationId: string,
  verdict: "confirmed" | "false_positive",
  notes?: string,
) {
  // If confirmed, boost confidence; if false_positive, reduce
  const pattern = await prisma.patternSignature.findFirst({
    where: { id: patternId, applicationId },
  });
  if (!pattern) return null;

  const confidenceAdjust = verdict === "confirmed" ? 0.15 : -0.2;
  const newConfidence = Math.max(0.1, Math.min(0.99, pattern.confidence + confidenceAdjust));

  return prisma.patternSignature.update({
    where: { id: patternId },
    data: {
      operatorVerdict: verdict,
      operatorNotes: notes ?? null,
      operatorAt: new Date(),
      confidence: newConfidence,
    },
  });
}
