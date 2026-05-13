/**
 * RAG Pipeline — Phase 9.4
 *
 * Before the LLM call, this module:
 * 1. Fingerprints the current situation
 * 2. Searches similar past analyses for this application
 * 3. Retrieves established patterns for this application
 * 4. Compares against baselines for this application
 * 5. Builds an enriched prompt section with prior knowledge
 *
 * CRITICAL: All context is scoped by applicationId. Data from one
 * application is NEVER mixed with another.
 */

import { findSimilarReports, type LogFingerprint } from "./analysis-store";
import { getBaselines, type BaselineDeviation } from "./baseline-learning";
import { getEstablishedPatterns } from "./pattern-library";

interface RAGContext {
  /** Past analysis summaries with similarity scores */
  similarReports: Array<{
    summary: string;
    similarity: number;
    createdAt: string;
    verdict: string | null;
  }>;
  /** Established patterns the system has learned */
  knownPatterns: Array<{
    title: string;
    description: string;
    severity: string;
    confidence: number;
    occurrenceCount: number;
    severityTrend: string | null;
    operatorVerdict: string | null;
  }>;
  /** Baseline deviations detected */
  baselineDeviations: BaselineDeviation[];
  /** Current baselines for reference */
  baselines: Array<{
    source: string;
    metricName: string;
    rollingMean: number;
    rollingStddev: number;
    sampleCount: number;
  }>;
}

/** Build RAG context for an application. */
export async function buildRAGContext(
  applicationId: string,
  currentTags: string[],
  currentDeviations: BaselineDeviation[],
): Promise<RAGContext> {
  const [similarReports, knownPatterns, baselines] = await Promise.all([
    findSimilarReports(applicationId, currentTags, 5),
    getEstablishedPatterns(applicationId, 0.6),
    getBaselines(applicationId),
  ]);

  return {
    similarReports: similarReports.map((r) => ({
      summary: r.summary,
      similarity: Math.round(r.similarity * 100) / 100,
      createdAt: r.createdAt.toISOString(),
      verdict: r.verdict,
    })),
    knownPatterns: knownPatterns.map((p) => ({
      title: p.title,
      description: p.description,
      severity: p.severity,
      confidence: Math.round(p.confidence * 100) / 100,
      occurrenceCount: p.occurrenceCount,
      severityTrend: p.severityTrend,
      operatorVerdict: p.operatorVerdict,
    })),
    baselineDeviations: currentDeviations,
    baselines: baselines
      .filter((b) => b.sampleCount >= 3)
      .map((b) => ({
        source: b.source,
        metricName: b.metricName,
        rollingMean: Math.round(b.rollingMean * 1000) / 1000,
        rollingStddev: Math.round(b.rollingStddev * 1000) / 1000,
        sampleCount: b.sampleCount,
      })),
  };
}

/** Format RAG context as a prompt section for the LLM. */
export function formatRAGPromptSection(ctx: RAGContext): string {
  const sections: string[] = [];

  // 1. Baseline deviations (highest priority)
  if (ctx.baselineDeviations.length > 0) {
    sections.push(`⚠️ BASELINE DEVIATIONS DETECTED (compared to this application's historical norms):
${ctx.baselineDeviations.map((d) =>
  `  - ${d.source} / ${d.metricName}: current=${d.currentValue.toFixed(3)} vs baseline mean=${d.baselineMean.toFixed(3)} ± ${d.baselineStddev.toFixed(3)} → ${d.deviationSigma}σ ${d.direction} (based on ${d.sampleCount} prior observations)`
).join("\n")}`);
  }

  // 2. Known patterns
  if (ctx.knownPatterns.length > 0) {
    sections.push(`🔍 KNOWN PATTERNS FOR THIS APPLICATION (previously identified, confidence-ranked):
${ctx.knownPatterns.map((p) => {
  const verdict = p.operatorVerdict === "confirmed" ? " [OPERATOR CONFIRMED]" : p.operatorVerdict === "false_positive" ? " [OPERATOR: FALSE POSITIVE]" : "";
  return `  - "${p.title}" (${p.severity}, confidence: ${(p.confidence * 100).toFixed(0)}%, seen ${p.occurrenceCount}x, trend: ${p.severityTrend ?? "unknown"})${verdict}\n    ${p.description}`;
}).join("\n")}`);
  }

  // 3. Similar past reports
  if (ctx.similarReports.length > 0) {
    sections.push(`📋 SIMILAR PAST ANALYSES FOR THIS APPLICATION (for reference — compare/contrast with current):
${ctx.similarReports.map((r, i) => {
  const verdict = r.verdict === "confirmed" ? " [confirmed by operator]" : r.verdict === "false_positive" ? " [marked as false positive]" : "";
  return `  ${i + 1}. [${r.createdAt}] (similarity: ${(r.similarity * 100).toFixed(0)}%)${verdict}\n     ${r.summary}`;
}).join("\n")}`);
  }

  // 4. Baseline reference
  if (ctx.baselines.length > 0) {
    sections.push(`📊 ESTABLISHED BASELINES FOR THIS APPLICATION:
${ctx.baselines.map((b) =>
  `  ${b.source} / ${b.metricName}: mean=${b.rollingMean} ± ${b.rollingStddev} (${b.sampleCount} samples)`
).join("\n")}`);
  }

  if (sections.length === 0) {
    return "\nThis is the first analysis for this application — no historical context available yet. Establish baselines from this run.";
  }

  return `\n--- ADAPTIVE INTELLIGENCE CONTEXT (learned from this application's history) ---\n\n${sections.join("\n\n")}\n\nIMPORTANT: Use this historical context to:\n1. Compare current metrics against established baselines — highlight any deviations.\n2. Reference known patterns — note if they recur, are escalating, or have been resolved.\n3. Build on past analyses — avoid repeating the same findings; focus on what's NEW or CHANGED.\n4. Respect operator verdicts — if a pattern was marked as false positive, deprioritize it.\n\n--- END ADAPTIVE CONTEXT ---`;
}
