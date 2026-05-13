/**
 * Explainable AI Module — Refined Root-Cause Analysis
 *
 * Goes beyond a single anomaly score to produce:
 *   • A natural-language narrative explaining WHAT is happening
 *   • A detailed per-source breakdown explaining WHERE
 *   • Pattern-matched root causes explaining WHY (with probabilities & evidence)
 *   • A causal chain showing HOW issues propagate
 *   • Confidence breakdown explaining WHY we trust the prediction
 *   • Temporal context explaining WHEN failure may occur
 *   • Prioritized recommendations explaining WHAT TO DO and the EXPECTED IMPACT
 *   • Feature importance explaining WHICH SIGNALS drove the verdict
 */

import { SourceFeatures, DynamicFeatureVector } from "./feature-extractor";

export interface ExplanationNode {
  id: string;
  label: string;
  type: "root_cause" | "contributing" | "effect" | "symptom";
  severity: "critical" | "high" | "medium" | "low";
  confidence: number;
  description: string;
  evidence: string[];
}

export interface CausalChain {
  nodes: ExplanationNode[];
  edges: { from: string; to: string; strength: number; relationship: string }[];
}

export interface RootCauseHypothesis {
  /** Short label, e.g. "Resource Exhaustion" */
  cause: string;
  /** Pattern category used by the UI to pick an icon */
  category:
    | "resource_exhaustion"
    | "dependency_cascade"
    | "traffic_spike"
    | "configuration_drift"
    | "intermittent_component"
    | "network_incident"
    | "security_event"
    | "scheduled_collision"
    | "data_quality"
    | "plan_regression"
    | "wait_contention"
    | "io_latency"
    | "deadlock"
    | "query_timeout"
    | "error_log"
    | "os_resource_pressure"
    | "app_server_pressure"
    | "network_degradation"
    | "windows_event_failure"
    | "iis_error_spike"
    | "unknown";
  /** Plain-language story of what likely happened */
  narrative: string;
  /** 0–1 probability we believe this is the cause */
  probability: number;
  /** Concrete evidence supporting the hypothesis */
  evidence: string[];
  /** What an operator should do next to confirm or refute */
  diagnosticSteps: string[];
  /** Sources most implicated in this hypothesis */
  affectedSources: string[];
}

export interface ExplainablePrediction {
  /** One-sentence headline a busy operator can read in 2 seconds */
  summary: string;
  /** Multi-paragraph narrative explaining what's going on */
  detailedExplanation: string;
  /** A short "story" connecting symptoms → likely cause → expected effect */
  narrative: string;

  confidenceBreakdown: {
    overall: number;
    factors: { factor: string; contribution: number; reasoning: string }[];
  };

  rootCauseChain: CausalChain;
  likelyRootCauses: RootCauseHypothesis[];

  temporalContext: {
    timeToFailure: string;
    trendDirection: "worsening" | "improving" | "stable";
    historicalPattern: string;
    /** Optional: descriptive timeline events */
    timeline: { phase: string; description: string }[];
  };

  recommendations: {
    action: string;
    priority: "immediate" | "soon" | "scheduled";
    expectedImpact: string;
    reasoning: string;
  }[];

  featureImportance: {
    feature: string;
    importance: number;
    direction: "positive" | "negative";
    explanation: string;
  }[];
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function generateExplanation(
  features: DynamicFeatureVector,
  anomalyScore: number,
  sourceHealthScores: Record<string, number>
): ExplainablePrediction {
  const sourceNames = Object.keys(features.sources);
  const criticalSources = sourceNames.filter(s => (sourceHealthScores[s] ?? 100) < 50);
  const warningSources = sourceNames.filter(s => {
    const score = sourceHealthScores[s] ?? 100;
    return score >= 50 && score < 75;
  });

  const summary = generateSummary(anomalyScore, criticalSources, warningSources, features);
  const detailedExplanation = generateDetailedExplanation(features, sourceHealthScores);
  const narrative = generateNarrative(features, sourceHealthScores, anomalyScore);
  const confidenceBreakdown = calculateConfidenceBreakdown(features, anomalyScore);
  const rootCauseChain = buildRootCauseChain(features, sourceHealthScores);
  const likelyRootCauses = identifyLikelyRootCauses(features, sourceHealthScores, anomalyScore);
  const temporalContext = analyzeTemporalContext(features, anomalyScore);
  const recommendations = generateRecommendations(features, sourceHealthScores, anomalyScore, likelyRootCauses);
  const featureImportance = calculateFeatureImportance(features);

  return {
    summary,
    detailedExplanation,
    narrative,
    confidenceBreakdown,
    rootCauseChain,
    likelyRootCauses,
    temporalContext,
    recommendations,
    featureImportance,
  };
}

// ---------------------------------------------------------------------------
// Summary & narrative
// ---------------------------------------------------------------------------

function generateSummary(
  anomalyScore: number,
  criticalSources: string[],
  warningSources: string[],
  features: DynamicFeatureVector
): string {
  if (anomalyScore < 0.3) {
    return "System health is normal. All monitored components are operating within expected parameters with no anomalies detected.";
  }

  if (anomalyScore < 0.6) {
    const warningList =
      warningSources.length > 0
        ? `Minor irregularities detected in ${humanList(warningSources)}.`
        : "";
    return `System is stable with minor concerns. ${warningList} Continued monitoring is recommended.`.trim();
  }

  if (anomalyScore < 0.8) {
    const issues =
      criticalSources.length > 0
        ? `Issues detected in ${humanList(criticalSources)}.`
        : "Multiple subsystems are showing stress.";
    const cascade =
      features.correlations.cascadeScore > 0.5
        ? " A cascade pattern has been detected — issues are likely to propagate to dependent services."
        : "";
    return `Warning: ${issues}${cascade} Proactive intervention is recommended.`;
  }

  const criticalList = criticalSources.length > 0 ? humanList(criticalSources) : "multiple components";
  return `Critical: Imminent failure risk in ${criticalList}. Immediate attention is required to prevent a system-wide outage.`;
}

function generateDetailedExplanation(
  features: DynamicFeatureVector,
  healthScores: Record<string, number>
): string {
  const parts: string[] = [];

  for (const [source, sourceFeatures] of Object.entries(features.sources)) {
    const health = healthScores[source] ?? 100;
    const analysis = analyzeSourceFeatures(source, sourceFeatures, health);
    if (analysis) parts.push(analysis);
  }

  if (features.correlations.crossSourceErrorOverlap > 0.3) {
    parts.push(
      `Cross-system error correlation of ${(features.correlations.crossSourceErrorOverlap * 100).toFixed(0)}% suggests a shared underlying issue affecting multiple components simultaneously rather than isolated failures.`
    );
  }
  if (features.correlations.cascadeScore > 0.5) {
    parts.push(
      `High cascade risk (${(features.correlations.cascadeScore * 100).toFixed(0)}%) indicates that failures in one subsystem are propagating to others within minutes — typical of tightly coupled service dependencies.`
    );
  }
  if (features.correlations.temporalClusteringScore > 0.6) {
    parts.push(
      `Events are tightly clustered in time, which is consistent with an active incident in progress rather than steady-state noise.`
    );
  }

  if (parts.length === 0) {
    return "No significant anomalies were detected. All log sources are within their expected operating envelopes.";
  }
  return parts.join(" ");
}

/**
 * Compose a short narrative tying symptoms → suspected cause → expected effect.
 */
function generateNarrative(
  features: DynamicFeatureVector,
  healthScores: Record<string, number>,
  anomalyScore: number
): string {
  if (anomalyScore < 0.3) {
    return "Across all log streams, error and warning rates remain at baseline. There is no indication of a developing incident.";
  }

  const sourcesByHealth = Object.entries(healthScores).sort(([, a], [, b]) => a - b);
  const worstSource = sourcesByHealth[0]?.[0];
  const worstHealth = sourcesByHealth[0]?.[1] ?? 100;
  const worstFeatures = worstSource ? features.sources[worstSource] : undefined;

  const lines: string[] = [];

  if (worstSource && worstFeatures) {
    lines.push(
      `The investigation begins with ${worstSource}, the most degraded source (health ${worstHealth.toFixed(0)}%). It is producing errors at ${(worstFeatures.errorRate * 100).toFixed(1)}% — well above the typical sub-5% baseline — alongside ${worstFeatures.criticalCount} critical event(s).`
    );
  }

  if (features.correlations.cascadeScore > 0.5) {
    lines.push(
      `Other sources are showing correlated spikes shortly after, with a cascade score of ${(features.correlations.cascadeScore * 100).toFixed(0)}%. This pattern is characteristic of an upstream component pulling its dependents down with it.`
    );
  } else if (features.correlations.crossSourceErrorOverlap > 0.4) {
    lines.push(
      `Multiple sources are erroring at the same time, yet not in a strict propagation order — suggesting a shared external factor (network, identity provider, or platform outage) rather than internal cascade.`
    );
  }

  if (features.correlations.temporalClusteringScore > 0.6) {
    lines.push(
      `Event volume is bursty rather than steady, which typically rules out gradual leak-style issues and points to a single triggering event or load spike.`
    );
  }

  if (anomalyScore >= 0.8) {
    lines.push(
      `If the current trend continues without intervention, the affected components are on a trajectory toward partial outage within the next operational window.`
    );
  } else if (anomalyScore >= 0.6) {
    lines.push(
      `The system is not yet failing, but several leading indicators have left their normal range. Acting now is significantly cheaper than acting after the first user-visible failure.`
    );
  }

  return lines.join(" ");
}

function analyzeSourceFeatures(source: string, features: SourceFeatures, health: number): string | null {
  const issues: string[] = [];

  if (features.errorRate > 0.1) issues.push(`an error rate of ${(features.errorRate * 100).toFixed(1)}% (baseline ≈ 1–3%)`);
  if (features.warningRate > 0.2) issues.push(`a warning rate of ${(features.warningRate * 100).toFixed(1)}%`);
  if (features.criticalCount > 5) issues.push(`${features.criticalCount} critical events`);
  if (features.burstScore > 0.7) issues.push(`a clear burst pattern in event arrival times`);
  if (features.patternScore > 0.5) issues.push(`recurring error signatures across many entries`);
  if (features.severityScore > 1.5) issues.push(`an elevated severity concentration`);

  if (issues.length === 0) return null;

  const healthLabel =
    health < 50 ? "is critically degraded" : health < 75 ? "is under stress" : "is showing early signs of strain";
  return `${source} ${healthLabel}, with ${humanList(issues)}.`;
}

// ---------------------------------------------------------------------------
// Confidence breakdown
// ---------------------------------------------------------------------------

function calculateConfidenceBreakdown(
  features: DynamicFeatureVector,
  anomalyScore: number
): ExplainablePrediction["confidenceBreakdown"] {
  const factors: { factor: string; contribution: number; reasoning: string }[] = [];

  const totalLogs = Object.values(features.sources).reduce((sum, s) => sum + (s.logCount || 0), 0);
  const dataQuality = Math.min(totalLogs / 100, 1);
  factors.push({
    factor: "Data Volume",
    contribution: dataQuality * 0.2,
    reasoning:
      totalLogs > 100
        ? `Sufficient log volume (${totalLogs} entries) for reliable analysis.`
        : `Only ${totalLogs} log entries available — limited data may reduce prediction accuracy.`,
  });

  const patternConsistency = 1 - (features.correlations.temporalClusteringScore || 0) * 0.5;
  factors.push({
    factor: "Pattern Consistency",
    contribution: patternConsistency * 0.25,
    reasoning:
      patternConsistency > 0.7
        ? "Patterns are consistent across the analysis window."
        : "Patterns are irregular, which reduces certainty about their cause.",
  });

  const sourceCount = Object.keys(features.sources).length;
  const crossValidation = Math.min(sourceCount / 3, 1);
  factors.push({
    factor: "Cross-Source Validation",
    contribution: crossValidation * 0.3,
    reasoning:
      sourceCount >= 3
        ? `${sourceCount} independent log sources corroborate these findings.`
        : `Only ${sourceCount} source(s) — limited diversity to triangulate the root cause.`,
  });

  const anomalyClarity = Math.abs(anomalyScore - 0.5) * 2;
  factors.push({
    factor: "Signal Clarity",
    contribution: anomalyClarity * 0.25,
    reasoning:
      anomalyClarity > 0.6
        ? "The anomaly score is far from the decision boundary — a clear deviation from baseline."
        : "The score is near the decision boundary; closer monitoring is advised before acting.",
  });

  const overall = factors.reduce((sum, f) => sum + f.contribution, 0);
  return { overall: Math.min(overall, 1), factors };
}

// ---------------------------------------------------------------------------
// Causal chain
// ---------------------------------------------------------------------------

function buildRootCauseChain(
  features: DynamicFeatureVector,
  healthScores: Record<string, number>
): CausalChain {
  const nodes: ExplanationNode[] = [];
  const edges: CausalChain["edges"] = [];

  const sourcesByHealth = Object.entries(healthScores).sort(([, a], [, b]) => a - b);
  if (sourcesByHealth.length === 0) return { nodes: [], edges: [] };

  const [rootSource, rootHealth] = sourcesByHealth[0];
  const rootFeatures = features.sources[rootSource];

  if (rootFeatures) {
    nodes.push({
      id: "root",
      label: rootSource,
      type: "root_cause",
      severity: rootHealth < 30 ? "critical" : rootHealth < 50 ? "high" : "medium",
      confidence: 0.8,
      description: `Primary source of anomalies — error rate ${(rootFeatures.errorRate * 100).toFixed(1)}% with ${rootFeatures.criticalCount} critical event(s).`,
      evidence: [
        `Error rate: ${(rootFeatures.errorRate * 100).toFixed(1)}%`,
        `Critical events: ${rootFeatures.criticalCount}`,
        `Health score: ${rootHealth.toFixed(0)}%`,
        rootFeatures.burstScore > 0.5 ? `Burst score: ${(rootFeatures.burstScore * 100).toFixed(0)}%` : null,
      ].filter(Boolean) as string[],
    });
  }

  for (let i = 1; i < Math.min(sourcesByHealth.length, 4); i++) {
    const [source, health] = sourcesByHealth[i];
    const sourceFeatures = features.sources[source];
    if (!sourceFeatures || health > 75) continue;

    nodes.push({
      id: `contrib_${i}`,
      label: source,
      type: "contributing",
      severity: health < 50 ? "high" : "medium",
      confidence: 0.6,
      description: `Contributing factor — degraded performance correlated with the root cause.`,
      evidence: [
        `Error rate: ${(sourceFeatures.errorRate * 100).toFixed(1)}%`,
        `Health score: ${health.toFixed(0)}%`,
      ],
    });

    if (features.correlations.crossSourceErrorOverlap > 0.3) {
      edges.push({
        from: "root",
        to: `contrib_${i}`,
        strength: features.correlations.crossSourceErrorOverlap,
        relationship: "propagates to",
      });
    }
  }

  if (features.correlations.cascadeScore > 0.5) {
    nodes.push({
      id: "effect_cascade",
      label: "Cascade Risk",
      type: "effect",
      severity: features.correlations.cascadeScore > 0.7 ? "critical" : "high",
      confidence: features.correlations.cascadeScore,
      description: "High probability of failure cascade across systems.",
      evidence: [`Cascade score: ${(features.correlations.cascadeScore * 100).toFixed(0)}%`],
    });
    edges.push({
      from: "root",
      to: "effect_cascade",
      strength: features.correlations.cascadeScore,
      relationship: "may cause",
    });
  }

  if (features.correlations.temporalClusteringScore > 0.6) {
    nodes.push({
      id: "symptom_burst",
      label: "Event Burst",
      type: "symptom",
      severity: "medium",
      confidence: features.correlations.temporalClusteringScore,
      description: "Events are clustered in time, consistent with an in-progress incident.",
      evidence: [`Clustering score: ${(features.correlations.temporalClusteringScore * 100).toFixed(0)}%`],
    });
    edges.push({
      from: "root",
      to: "symptom_burst",
      strength: features.correlations.temporalClusteringScore,
      relationship: "manifests as",
    });
  }

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Likely root causes — pattern-matched hypotheses with narratives & next steps
// ---------------------------------------------------------------------------

function identifyLikelyRootCauses(
  features: DynamicFeatureVector,
  healthScores: Record<string, number>,
  anomalyScore: number
): RootCauseHypothesis[] {
  const hypotheses: RootCauseHypothesis[] = [];
  const sources = features.sources;
  const sourceNames = Object.keys(sources);

  const avg = (fn: (s: SourceFeatures) => number) =>
    sourceNames.length === 0 ? 0 : sourceNames.reduce((sum, n) => sum + fn(sources[n]), 0) / sourceNames.length;

  const max = (fn: (s: SourceFeatures) => number) =>
    sourceNames.length === 0 ? 0 : Math.max(...sourceNames.map(n => fn(sources[n])));

  const avgErrorRate = avg(s => s.errorRate);
  const maxErrorRate = max(s => s.errorRate);
  const avgBurst = avg(s => s.burstScore);
  const maxBurst = max(s => s.burstScore);
  const totalCritical = sourceNames.reduce((sum, n) => sum + (sources[n]?.criticalCount ?? 0), 0);
  const avgPattern = avg(s => s.patternScore);
  const cascade = features.correlations.cascadeScore;
  const overlap = features.correlations.crossSourceErrorOverlap;
  const clustering = features.correlations.temporalClusteringScore;
  const sourcesAffected = sourceNames.filter(n => (healthScores[n] ?? 100) < 75);
  const sourcesCritical = sourceNames.filter(n => (healthScores[n] ?? 100) < 50);

  // ---- Pattern: Resource Exhaustion ----
  // Persistent rising errors + recurring patterns + few sources affected
  if (avgErrorRate > 0.08 && avgPattern > 0.3 && cascade < 0.5 && maxBurst < 0.6) {
    const probability = clamp(avgErrorRate * 1.5 + avgPattern * 0.5, 0.4, 0.9);
    hypotheses.push({
      cause: "Resource Exhaustion",
      category: "resource_exhaustion",
      narrative:
        "Errors are accumulating steadily and the same error signature recurs across many entries. This is the fingerprint of a slowly saturating resource (memory, file handles, database connections, or thread pool) rather than an external trigger.",
      probability,
      evidence: [
        `Sustained error rate: ${(avgErrorRate * 100).toFixed(1)}%`,
        `High pattern recurrence: ${(avgPattern * 100).toFixed(0)}%`,
        `Low cascade score: ${(cascade * 100).toFixed(0)}% (issue is local, not propagating)`,
      ],
      diagnosticSteps: [
        "Inspect process-level memory/CPU/handle counts on the affected hosts.",
        "Review connection pool and thread pool utilization graphs.",
        "Check for log entries containing OutOfMemory, EMFILE, deadlock or pool-exhausted patterns.",
      ],
      affectedSources: sourcesAffected.slice(0, 5),
    });
  }

  // ---- Pattern: Dependency Cascade ----
  // High cascade + multiple sources affected
  if (cascade > 0.5 && sourcesCritical.length >= 1 && sourceNames.length >= 2) {
    const probability = clamp(cascade * 0.7 + Math.min(sourcesCritical.length / 3, 1) * 0.3, 0.5, 0.95);
    hypotheses.push({
      cause: "Dependency Cascade Failure",
      category: "dependency_cascade",
      narrative:
        "Errors are appearing in one source and then propagating to its dependents within a short window. This pattern is characteristic of an upstream component (database, auth service, queue, or shared cache) failing and dragging its callers with it.",
      probability,
      evidence: [
        `Cascade score: ${(cascade * 100).toFixed(0)}%`,
        `${sourcesCritical.length} source(s) in critical state`,
        `Cross-source error overlap: ${(overlap * 100).toFixed(0)}%`,
      ],
      diagnosticSteps: [
        "Identify the source that started erroring first — that is your suspected root.",
        "Check the health of shared dependencies (DB, cache, identity provider, message broker).",
        "Verify recent network ACL or DNS changes that could affect inter-service connectivity.",
      ],
      affectedSources: sourcesCritical,
    });
  }

  // ---- Pattern: Traffic Spike / DDoS-like ----
  // High burst + temporal clustering + relatively low pattern recurrence
  if (maxBurst > 0.6 && clustering > 0.5 && avgPattern < 0.5) {
    const probability = clamp(maxBurst * 0.6 + clustering * 0.4, 0.4, 0.9);
    hypotheses.push({
      cause: "Traffic Spike or DDoS-like Pattern",
      category: "traffic_spike",
      narrative:
        "Event volume jumped sharply rather than rising gradually, and the burst is concentrated in a narrow time window. This is consistent with a marketing event, retry storm, scraper, or denial-of-service attempt rather than a code bug.",
      probability,
      evidence: [
        `Peak burst score: ${(maxBurst * 100).toFixed(0)}%`,
        `Temporal clustering: ${(clustering * 100).toFixed(0)}%`,
        `Pattern recurrence is low (${(avgPattern * 100).toFixed(0)}%) — errors are heterogeneous, not a single bug`,
      ],
      diagnosticSteps: [
        "Check ingress request rate by client IP / user-agent / route.",
        "Review CDN/WAF dashboards for rate-limit or block events.",
        "Confirm that no upstream client is in a retry loop (check 5xx → retry ratios).",
      ],
      affectedSources: sourcesAffected.slice(0, 5),
    });
  }

  // ---- Pattern: Configuration / Deployment Drift ----
  // Sudden onset of errors with low burst (sustained, not bursty), high pattern recurrence in one source
  if (anomalyScore > 0.5 && avgPattern > 0.4 && maxBurst < 0.5 && sourcesCritical.length === 1 && cascade < 0.4) {
    const probability = clamp(0.55 + avgPattern * 0.3, 0.45, 0.85);
    hypotheses.push({
      cause: "Configuration or Deployment Drift",
      category: "configuration_drift",
      narrative:
        "A single source has shifted into an error regime with the same signature repeating. The lack of bursting and lack of cascade points away from external triggers and toward an internal change — a recent deploy, feature flag, secret rotation, or config push that broke an assumption.",
      probability,
      evidence: [
        `Single critical source: ${sourcesCritical[0] ?? "unknown"}`,
        `High pattern recurrence: ${(avgPattern * 100).toFixed(0)}%`,
        `Low burst (${(maxBurst * 100).toFixed(0)}%) and low cascade (${(cascade * 100).toFixed(0)}%)`,
      ],
      diagnosticSteps: [
        "Cross-reference the start of the anomaly with deploy/CI logs and feature-flag changes.",
        "Compare current config (env vars, secrets, ConfigMaps) against last known-good revision.",
        "If a change is found, attempt a controlled rollback in a canary environment first.",
      ],
      affectedSources: sourcesCritical,
    });
  }

  // ---- Pattern: Intermittent / Flapping Component ----
  // Moderate error rate but irregular (low temporal clustering, low cascade)
  if (maxErrorRate > 0.1 && clustering < 0.3 && cascade < 0.3 && avgPattern < 0.4) {
    const probability = clamp(maxErrorRate * 0.8 + 0.2, 0.35, 0.7);
    hypotheses.push({
      cause: "Intermittent Component Failure",
      category: "intermittent_component",
      narrative:
        "Errors are present but scattered in time, without strong clustering or cascade. This suggests a flaky underlying component — a single replica, a degrading disk, an unreliable network path, or a noisy hardware host — rather than a system-wide event.",
      probability,
      evidence: [
        `Peak error rate: ${(maxErrorRate * 100).toFixed(1)}%`,
        `Low clustering: ${(clustering * 100).toFixed(0)}% (errors are dispersed)`,
        `Low cascade: ${(cascade * 100).toFixed(0)}% (no propagation)`,
      ],
      diagnosticSteps: [
        "Group errors by host / pod / replica ID — look for one outlier carrying most of the load.",
        "Check infrastructure dashboards (disk SMART, network retransmits, CPU steal).",
        "Cordon the suspect node and observe whether the error rate drops to baseline.",
      ],
      affectedSources: sourcesAffected.slice(0, 5),
    });
  }

  // ---- Pattern: Network / Connectivity Incident ----
  // High overlap + low pattern recurrence (heterogeneous errors) + multiple sources
  if (overlap > 0.5 && avgPattern < 0.4 && sourceNames.length >= 2) {
    const probability = clamp(overlap * 0.7 + 0.15, 0.4, 0.85);
    hypotheses.push({
      cause: "Network or Connectivity Incident",
      category: "network_incident",
      narrative:
        "Multiple unrelated sources are erroring at the same time but with different error signatures. This is uncharacteristic of a single bug and instead points to a shared transport-layer issue — DNS, load balancer, VPC peering, or upstream cloud-provider event.",
      probability,
      evidence: [
        `Cross-source overlap: ${(overlap * 100).toFixed(0)}%`,
        `Low pattern recurrence: ${(avgPattern * 100).toFixed(0)}% (errors are heterogeneous)`,
        `${sourceNames.length} sources affected concurrently`,
      ],
      diagnosticSteps: [
        "Check cloud-provider status pages and any internal network dashboards.",
        "Review DNS resolution times and load-balancer 5xx rates.",
        "Probe critical inter-service paths with synthetic checks.",
      ],
      affectedSources: sourcesAffected,
    });
  }

  // ---- Pattern: Security / Authentication Event ----
  // High critical count concentrated, plus elevated error rate
  if (totalCritical > 10 && avgErrorRate > 0.1 && clustering > 0.4) {
    const probability = clamp(0.4 + Math.min(totalCritical / 50, 0.4), 0.4, 0.8);
    hypotheses.push({
      cause: "Security or Authentication Event",
      category: "security_event",
      narrative:
        "A burst of critical-level events combined with rising error rates can indicate an authentication outage, credential expiry, or active abuse (brute force, token replay). This warrants a security-aware investigation in parallel with the operational one.",
      probability,
      evidence: [
        `${totalCritical} critical events across all sources`,
        `Average error rate: ${(avgErrorRate * 100).toFixed(1)}%`,
        `Temporal clustering: ${(clustering * 100).toFixed(0)}%`,
      ],
      diagnosticSteps: [
        "Audit recent auth failures, locked accounts, and 401/403 spikes.",
        "Verify certificate / token expiry and recent secret rotations.",
        "Look for unusual source IPs or user-agents in access logs.",
      ],
      affectedSources: sourcesAffected,
    });
  }

  // ---- Pattern: Scheduled-Job Collision ----
  // Strong temporal clustering with otherwise low cascade and moderate error rate
  if (clustering > 0.6 && cascade < 0.4 && avgErrorRate > 0.05 && avgErrorRate < 0.2) {
    const probability = clamp(clustering * 0.6 + 0.2, 0.4, 0.8);
    hypotheses.push({
      cause: "Scheduled-Job or Batch Collision",
      category: "scheduled_collision",
      narrative:
        "Errors are tightly clustered in time but do not cascade across services. This is the signature of a scheduled job (cron, ETL, backup, batch report) overlapping with peak traffic or with another job, briefly starving shared resources.",
      probability,
      evidence: [
        `Temporal clustering: ${(clustering * 100).toFixed(0)}%`,
        `Moderate error rate: ${(avgErrorRate * 100).toFixed(1)}%`,
        `Low cascade: ${(cascade * 100).toFixed(0)}%`,
      ],
      diagnosticSteps: [
        "Cross-reference the time of the spike with cron/ETL schedules.",
        "Check for long-running queries or table locks during that window.",
        "Stagger overlapping jobs or move heavy ones to off-peak hours.",
      ],
      affectedSources: sourcesAffected,
    });
  }

  // ---- Pattern: Data Quality / Schema Drift ----
  // High pattern recurrence + moderate errors but low criticals
  if (avgPattern > 0.5 && totalCritical < 3 && avgErrorRate > 0.05 && cascade < 0.4) {
    const probability = clamp(avgPattern * 0.6 + 0.2, 0.35, 0.75);
    hypotheses.push({
      cause: "Data Quality or Schema Drift",
      category: "data_quality",
      narrative:
        "The same error signature is repeating frequently without producing critical-level events. This pattern is typical of a parser, validator, or downstream consumer rejecting newly malformed payloads — often the result of an upstream schema change or a bad batch of input data.",
      probability,
      evidence: [
        `High pattern recurrence: ${(avgPattern * 100).toFixed(0)}%`,
        `Few criticals (${totalCritical}) — failures are graceful`,
        `Steady error rate: ${(avgErrorRate * 100).toFixed(1)}%`,
      ],
      diagnosticSteps: [
        "Sample the failing messages and diff their structure against the expected schema.",
        "Check whether an upstream producer recently deployed a schema change.",
        "Quarantine bad messages and replay once a fix or migration is in place.",
      ],
      affectedSources: sourcesAffected,
    });
  }

  // ---- Pattern: SQL Server Plan Regression / Query-Performance Degradation ----
  // Fires when a Query Store source (or a parent source containing those events)
  // shows elevated warning/pattern signals — synthetic plan-regression events
  // surface here as warnings, so we lean on warningRate + patternScore + severity.
  const queryStoreSourceNames = sourceNames.filter((n) => /query.?store/i.test(n));
  if (queryStoreSourceNames.length > 0) {
    let strongest = "";
    let bestScore = 0;
    let bestSf: SourceFeatures | undefined;
    for (const n of queryStoreSourceNames) {
      const sf = features.sources[n];
      if (!sf) continue;
      const score = sf.warningRate * 1.0 + sf.patternScore * 0.6 + sf.severityScore * 0.5;
      if (score > bestScore) {
        bestScore = score;
        strongest = n;
        bestSf = sf;
      }
    }
    if (bestSf && bestScore > 0.15) {
      const probability = clamp(
        Math.min(bestSf.warningRate * 2, 0.45) +
          bestSf.patternScore * 0.25 +
          bestSf.severityScore * 0.3 +
          0.3,
        0.45,
        0.92,
      );
      hypotheses.push({
        cause: "SQL Server Plan Regression / Query Performance Degradation",
        category: "plan_regression",
        narrative:
          "Query Store flagged one or more queries whose average duration jumped sharply after the SQL Server optimizer chose a new execution plan. " +
          "This is the classic signature of plan-cache invalidation triggered by parameter sniffing, stale statistics, an index change, or a recent CE-version flip. " +
          "Left unattended, even a single regressed plan can saturate CPU and IO and drag latency-sensitive workloads with it.",
        probability,
        evidence: [
          `Query Store source flagged: ${strongest}`,
          `Warning rate: ${(bestSf.warningRate * 100).toFixed(1)}% (synthetic plan-regression events fire as warnings)`,
          `Pattern recurrence: ${(bestSf.patternScore * 100).toFixed(0)}%`,
          `Severity score: ${(bestSf.severityScore * 100).toFixed(0)}%`,
        ],
        diagnosticSteps: [
          "Open the affected MSSQL.QueryStore entries in System Analysis and pull the regressed query_id values from the rawData JSON.",
          "Connect to the user database and run sys.query_store_runtime_stats / sys.query_store_plan to see the previous and current plan side-by-side.",
          "If the previous plan was clearly faster, force it: EXEC sp_query_store_force_plan @query_id = ?, @plan_id = ?;",
          "Refresh statistics on the underlying tables: UPDATE STATISTICS [schema].[table] WITH FULLSCAN; consider rebuilding the most-used indexes.",
          "If the regression coincides with a recent code or deploy event, audit the parameter types — implicit conversions trigger fresh plans.",
        ],
        affectedSources: queryStoreSourceNames,
      });
    }
  }

  // ---- Pattern: SQL Server Wait-Contention (Phase 3) ----
  // Fires when MSSQL.WaitStats sources show elevated warning/critical signal.
  // Wait stats deltas are emitted as info by default; the mapper escalates
  // CXPACKET/PAGEIOLATCH_*/LCK_* to warning/critical when delta_wait_ms is
  // high, so warningRate + severityScore is the right composite.
  const waitStatsSourceNames = sourceNames.filter((n) => /wait.?stats/i.test(n));
  if (waitStatsSourceNames.length > 0) {
    let strongest = "";
    let bestScore = 0;
    let bestSf: SourceFeatures | undefined;
    for (const n of waitStatsSourceNames) {
      const sf = features.sources[n];
      if (!sf) continue;
      const score = sf.warningRate * 0.9 + sf.severityScore * 0.7 + sf.patternScore * 0.4;
      if (score > bestScore) {
        bestScore = score;
        strongest = n;
        bestSf = sf;
      }
    }
    if (bestSf && bestScore > 0.18) {
      const probability = clamp(
        Math.min(bestSf.warningRate * 1.8, 0.4) +
          bestSf.severityScore * 0.3 +
          bestSf.patternScore * 0.2 +
          0.3,
        0.4,
        0.9,
      );
      hypotheses.push({
        cause: "SQL Server Wait Contention",
        category: "wait_contention",
        narrative:
          "Wait-statistics snapshots show a sustained spike in contention-class waits (CXPACKET, PAGEIOLATCH_*, LCK_*, etc.). " +
          "These waits accumulate when the engine is forced to coordinate parallel workers, fetch pages from disk, or queue behind held locks. " +
          "If the trend continues, query latency will degrade across the workload and connection pools will start to back up.",
        probability,
        evidence: [
          `Wait-stats source flagged: ${strongest}`,
          `Warning rate: ${(bestSf.warningRate * 100).toFixed(1)}%`,
          `Severity score: ${(bestSf.severityScore * 100).toFixed(0)}%`,
          `Pattern recurrence: ${(bestSf.patternScore * 100).toFixed(0)}%`,
        ],
        diagnosticSteps: [
          "Open recent MSSQL.WaitStats entries in System Analysis and sort by delta_wait_ms (in rawData) — the top waits are the contention drivers.",
          "If CXPACKET dominates, inspect MAXDOP and Cost Threshold for Parallelism; large parallel scans are usually parameter-sniffing victims.",
          "If PAGEIOLATCH_* dominates, correlate with MSSQL.IoStats — the bottleneck is the data files and likely the underlying disk.",
          "If LCK_* dominates, capture sys.dm_tran_locks and identify the head blocker; check for long-running transactions.",
          "Confirm there has been no SQL Server restart in the window — restart resets reset all wait counters and the next snapshot will spike.",
        ],
        affectedSources: waitStatsSourceNames,
      });
    }
  }

  // ---- Pattern: SQL Server File IO Latency (Phase 3) ----
  // Fires when MSSQL.IoStats sources show elevated warning/critical signal.
  // IO entries escalate to warning at 50ms avg latency (with >100 ops) and to
  // critical at 200ms, so high warningRate + severityScore is the strongest tell.
  const ioStatsSourceNames = sourceNames.filter((n) => /io.?stats/i.test(n));
  if (ioStatsSourceNames.length > 0) {
    let strongest = "";
    let bestScore = 0;
    let bestSf: SourceFeatures | undefined;
    for (const n of ioStatsSourceNames) {
      const sf = features.sources[n];
      if (!sf) continue;
      const score = sf.warningRate * 0.9 + sf.severityScore * 0.8 + sf.patternScore * 0.4;
      if (score > bestScore) {
        bestScore = score;
        strongest = n;
        bestSf = sf;
      }
    }
    if (bestSf && bestScore > 0.18) {
      const probability = clamp(
        Math.min(bestSf.warningRate * 1.8, 0.4) +
          bestSf.severityScore * 0.35 +
          bestSf.patternScore * 0.2 +
          0.3,
        0.4,
        0.92,
      );
      hypotheses.push({
        cause: "SQL Server File IO Latency",
        category: "io_latency",
        narrative:
          "Per-file IO snapshots show average read/write latency well above the 50ms warning threshold for one or more database files. " +
          "Latency this high typically points to disk saturation, a noisy-neighbour storage tenant, or a tempdb-spill workload pattern, and will translate into PAGEIOLATCH waits visible in waitStats. " +
          "Sustained over hours it signals an impending IO-bound stall; transient spikes still warrant correlation with the underlying storage stack.",
        probability,
        evidence: [
          `IO-stats source flagged: ${strongest}`,
          `Warning rate: ${(bestSf.warningRate * 100).toFixed(1)}%`,
          `Severity score: ${(bestSf.severityScore * 100).toFixed(0)}%`,
          `Pattern recurrence: ${(bestSf.patternScore * 100).toFixed(0)}%`,
        ],
        diagnosticSteps: [
          "Open recent MSSQL.IoStats entries and identify the hot files (sort by avg_read_latency_ms / avg_write_latency_ms in rawData).",
          "If tempdb files (database_name = tempdb) lead the list, audit query plans for spool / sort spills and consider adding tempdb data files.",
          "If a user-database log file (type_desc = LOG) leads with high write latency, check log autogrowth and disk-queue depth on the log volume.",
          "Cross-check OS-level disk counters (Avg. Disk sec/Read, sec/Write) — sustained values above 25ms confirm a storage bottleneck.",
          "Cross-correlate with MSSQL.WaitStats — IO latency almost always co-occurs with PAGEIOLATCH_SH / WRITELOG waits.",
        ],
        affectedSources: ioStatsSourceNames,
      });
    }
  }

  // ---- Pattern: Deadlock Detection (Phase 4) ----
  const deadlockSourceNames = Object.keys(features.sources).filter(
    (s) => /xevents/i.test(s) || /deadlock/i.test(s),
  );
  if (deadlockSourceNames.length > 0) {
    for (const sourceName of deadlockSourceNames) {
      const sf = features.sources[sourceName];
      if (!sf) continue;
      const criticalRate = sf.criticalCount / Math.max(sf.logCount, 1);
      const score = criticalRate * 0.6 + sf.warningRate * 0.3 + (sf.errorRate > 0 ? 0.2 : 0);
      if (score > 0.1) {
        hypotheses.push({
          cause: "SQL Server Deadlock",
          category: "deadlock",
          narrative: `Deadlock events detected in ${sourceName}. ${sf.criticalCount} critical event(s) observed, indicating concurrent transactions are competing for the same resources in an incompatible order.`,
          probability: clamp(score, 0.3, 0.95),
          evidence: [
            `${sf.criticalCount} deadlock event(s) detected`,
            `Error rate: ${(sf.errorRate * 100).toFixed(1)}%`,
            `Source: ${sourceName}`,
          ],
          diagnosticSteps: [
            "Review the deadlock XML graph to identify the victim and survivor sessions.",
            "Check which tables/indexes are involved — add missing indexes to reduce lock escalation.",
            "Consider shorter transactions, optimistic concurrency (RCSI), or reordering resource access.",
            "Monitor MSSQL.WaitStats for LCK_M_* waits trending upward.",
          ],
          affectedSources: [sourceName],
        });
      }
    }
  }

  // ---- Pattern: Query Timeout Detection (Phase 4) ----
  const timeoutSourceNames = Object.keys(features.sources).filter(
    (s) => /xevents/i.test(s) || /timeout/i.test(s),
  );
  if (timeoutSourceNames.length > 0) {
    for (const sourceName of timeoutSourceNames) {
      const sf = features.sources[sourceName];
      if (!sf) continue;
      const score = sf.errorRate * 0.5 + sf.warningRate * 0.3 + (sf.criticalCount > 0 ? 0.3 : 0);
      if (score > 0.12) {
        hypotheses.push({
          cause: "Query Timeout",
          category: "query_timeout",
          narrative: `Query timeout events detected in ${sourceName}. This indicates queries are exceeding their configured timeout threshold, possibly due to blocking, resource pressure, or parameter sniffing.`,
          probability: clamp(score, 0.25, 0.85),
          evidence: [
            `Error rate: ${(sf.errorRate * 100).toFixed(1)}%`,
            `${sf.logCount} total events from ${sourceName}`,
          ],
          diagnosticSteps: [
            "Identify the timed-out queries from the XE session data — check sql_text and duration_ms.",
            "Cross-reference with MSSQL.WaitStats for RESOURCE_SEMAPHORE or LCK_M_* waits.",
            "Check for parameter sniffing: compare execution plans for the same query with different parameter values.",
            "Consider increasing timeout thresholds only as a last resort — fix the root cause first.",
          ],
          affectedSources: [sourceName],
        });
      }
    }
  }

  // ---- Pattern: Error Log Anomalies (Phase 4) ----
  const errorLogSourceNames = Object.keys(features.sources).filter(
    (s) => /error.?log/i.test(s),
  );
  if (errorLogSourceNames.length > 0) {
    for (const sourceName of errorLogSourceNames) {
      const sf = features.sources[sourceName];
      if (!sf) continue;
      const score = sf.errorRate * 0.5 + sf.warningRate * 0.3 + (sf.criticalCount > 0 ? 0.4 : 0);
      if (score > 0.15) {
        hypotheses.push({
          cause: "Server Error Log Anomalies",
          category: "error_log",
          narrative: `Elevated error activity detected in ${sourceName}. ${sf.criticalCount} critical entries and ${(sf.errorRate * 100).toFixed(1)}% error rate indicate server-level issues that may affect availability.`,
          probability: clamp(score, 0.2, 0.8),
          evidence: [
            `${sf.criticalCount} critical entries`,
            `Error rate: ${(sf.errorRate * 100).toFixed(1)}%`,
            `${sf.logCount} total log entries from ${sourceName}`,
          ],
          diagnosticSteps: [
            "Review the most recent critical ERRORLOG entries for stack dumps, corruption, or access violations.",
            "Check for memory pressure indicators (insufficient memory, buffer pool shrink).",
            "Verify backup chain integrity if corruption is mentioned.",
            "Cross-correlate timestamps with waitStats and ioStats for coinciding pressure.",
          ],
          affectedSources: [sourceName],
        });
      }
    }
  }

  // ---- Pattern: OS Resource Pressure (Phase 6) ----
  const osMetricsSourceNames = Object.keys(features.sources).filter(
    (s) => /os.?metrics/i.test(s),
  );
  if (osMetricsSourceNames.length > 0) {
    for (const sourceName of osMetricsSourceNames) {
      const sf = features.sources[sourceName];
      if (!sf) continue;
      const score = sf.errorRate * 0.4 + sf.warningRate * 0.35 + (sf.criticalCount > 0 ? 0.35 : 0);
      if (score > 0.1) {
        hypotheses.push({
          cause: "OS-Level Resource Pressure",
          category: "os_resource_pressure",
          narrative: `Operating-system-level resource pressure detected via ${sourceName}. Elevated CPU, memory, disk, or connection metrics suggest the host is under strain, which can cascade into query slowdowns, timeouts, and instability.`,
          probability: clamp(score, 0.2, 0.85),
          evidence: [
            `Warning rate: ${(sf.warningRate * 100).toFixed(1)}%`,
            `Error rate: ${(sf.errorRate * 100).toFixed(1)}%`,
            `${sf.criticalCount} critical entries`,
            `${sf.logCount} total metrics from ${sourceName}`,
          ],
          diagnosticSteps: [
            "Review the OS-metrics snapshot for the specific resource(s) under pressure (CPU, RAM, disk, connections).",
            "Check if connection_usage_pct is above 80% — consider increasing max_connections or pooling.",
            "For memory pressure, verify if the database buffer pool is sized correctly relative to available RAM.",
            "For disk pressure, check for log file growth, temp-file bloat, or low free space.",
            "Cross-correlate with waitStats/ioStats to see if OS pressure explains query-level degradation.",
          ],
          affectedSources: [sourceName],
        });
      }
    }
  }

  // ---- Pattern: Application Server Pressure (Phase 7) ----
  const appMetricsSources = Object.keys(features.sources).filter(
    (s) => /app\.?(metrics|logs)/i.test(s),
  );
  if (appMetricsSources.length > 0) {
    for (const sourceName of appMetricsSources) {
      const sf = features.sources[sourceName];
      if (!sf) continue;
      const score = sf.errorRate * 0.4 + sf.warningRate * 0.35 + (sf.criticalCount > 0 ? 0.35 : 0);
      if (score > 0.1) {
        hypotheses.push({
          cause: "Application Server Pressure",
          category: "app_server_pressure",
          narrative: `Application-level pressure detected via ${sourceName}. This may include rising response times, error rates, thread pool exhaustion, or exception storms on the app server — issues the database cannot see.`,
          probability: clamp(score, 0.2, 0.85),
          evidence: [
            `Warning rate: ${(sf.warningRate * 100).toFixed(1)}%`,
            `Error rate: ${(sf.errorRate * 100).toFixed(1)}%`,
            `${sf.criticalCount} critical entries`,
            `${sf.logCount} total events from ${sourceName}`,
          ],
          diagnosticSteps: [
            "Check response time percentiles (p95/p99) — sustained increases predict imminent outages.",
            "Review thread pool usage and GC time — .NET apps freeze when the thread pool is exhausted.",
            "Look for retry storms or circuit-breaker opens in app logs — these cascade into DB connection pool exhaustion.",
            "Cross-correlate with DB waitStats/ioStats — if DB is healthy but app is failing, the bottleneck is app-side or network.",
            "Check for memory leaks (steadily climbing process memory) on the app server.",
          ],
          affectedSources: [sourceName],
        });
      }
    }
  }

  // ---- Pattern: Network Degradation (Phase 7) ----
  const networkSources = Object.keys(features.sources).filter(
    (s) => /network\.?metrics/i.test(s),
  );
  if (networkSources.length > 0) {
    for (const sourceName of networkSources) {
      const sf = features.sources[sourceName];
      if (!sf) continue;
      const score = sf.errorRate * 0.5 + sf.warningRate * 0.3 + (sf.criticalCount > 0 ? 0.4 : 0);
      if (score > 0.1) {
        hypotheses.push({
          cause: "Network Degradation (App ↔ DB)",
          category: "network_degradation",
          narrative: `Network-layer issues detected between the application and database servers via ${sourceName}. High latency, retransmissions, or port exhaustion on the network path can cause timeouts that appear as DB errors but originate from the network.`,
          probability: clamp(score, 0.25, 0.9),
          evidence: [
            `Warning rate: ${(sf.warningRate * 100).toFixed(1)}%`,
            `Error rate: ${(sf.errorRate * 100).toFixed(1)}%`,
            `${sf.criticalCount} critical entries`,
            `${sf.logCount} total metrics from ${sourceName}`,
          ],
          diagnosticSteps: [
            "Check RTT/latency between app and DB servers — spikes above 10ms can cascade into query timeouts.",
            "Look for TCP retransmissions — even 1-2% retransmit rate degrades throughput significantly.",
            "Verify ephemeral port availability — exhaustion causes 'cannot open new connection' errors.",
            "Check DNS resolution time — intermittent DNS failures cause random connection failures.",
            "If app sees 'timeout' but DB shows 'no issues', the network gap is almost certainly the cause.",
            "Ensure both servers use the same NTP time source — clock drift breaks cross-server correlation.",
          ],
          affectedSources: [sourceName],
        });
      }
    }
  }

  // ---- Pattern: Windows Event Log Failures (Phase 7) ----
  const winEventSources = Object.keys(features.sources).filter(
    (s) => /windows\.?event/i.test(s),
  );
  if (winEventSources.length > 0) {
    for (const sourceName of winEventSources) {
      const sf = features.sources[sourceName];
      if (!sf) continue;
      const score = sf.errorRate * 0.4 + sf.warningRate * 0.2 + (sf.criticalCount > 0 ? 0.5 : 0);
      if (score > 0.12) {
        hypotheses.push({
          cause: "Windows Event Log Failures",
          category: "windows_event_failure",
          narrative: `Critical events detected in the Windows Event Log via ${sourceName}. These may include .NET runtime crashes, service terminations, app pool failures, or unexpected reboots — host-level events that precede or explain application outages.`,
          probability: clamp(score, 0.2, 0.85),
          evidence: [
            `${sf.criticalCount} critical entries (service crashes, .NET errors, unexpected shutdowns)`,
            `Error rate: ${(sf.errorRate * 100).toFixed(1)}%`,
            `${sf.logCount} total Windows events from ${sourceName}`,
          ],
          diagnosticSteps: [
            "Filter for EventID 1000/1026 (.NET Runtime crashes) — these indicate unhandled exceptions killing the process.",
            "Check EventID 7034/7031 (Service terminated unexpectedly) — indicates the app service is crashing.",
            "Look for EventID 5001/5002 (App pool failure / worker process crash) — IIS-hosted apps.",
            "Check EventID 6008/41 (unexpected shutdown / kernel-power) — hardware or OS-level failure.",
            "Pair these events with app-server logs at the same timestamps to find the triggering code path.",
          ],
          affectedSources: [sourceName],
        });
      }
    }
  }

  // ---- Pattern: IIS Error Spike (Phase 7) ----
  const iisSources = Object.keys(features.sources).filter(
    (s) => /iis\.?(access|log)/i.test(s),
  );
  if (iisSources.length > 0) {
    for (const sourceName of iisSources) {
      const sf = features.sources[sourceName];
      if (!sf) continue;
      const score = sf.errorRate * 0.5 + sf.warningRate * 0.3 + (sf.criticalCount > 0 ? 0.3 : 0);
      if (score > 0.1) {
        hypotheses.push({
          cause: "IIS Error Spike",
          category: "iis_error_spike",
          narrative: `Elevated HTTP error rate detected in IIS access logs via ${sourceName}. Rising 5xx errors, request queue growth, or app pool recycles indicate the web server layer is failing — even if the underlying app code and database are healthy.`,
          probability: clamp(score, 0.2, 0.85),
          evidence: [
            `Error rate: ${(sf.errorRate * 100).toFixed(1)}%`,
            `Warning rate: ${(sf.warningRate * 100).toFixed(1)}%`,
            `${sf.logCount} total IIS log entries from ${sourceName}`,
          ],
          diagnosticSteps: [
            "Check the HTTP 503 (Service Unavailable) count — this means IIS is rejecting requests.",
            "Review the request queue length — sustained high queue means IIS can't keep up.",
            "Check for app pool recycles in Windows Event Log — recycles cause cold starts and request drops.",
            "Look at slow requests (>3s) — if they correlate with DB wait spikes, the root cause is the DB.",
            "If slow requests DON'T correlate with DB issues, check app-server CPU/memory and thread pool.",
          ],
          affectedSources: [sourceName],
        });
      }
    }
  }

  // ---- Component-specific fallback hypotheses ----
  for (const sourceName of sourcesCritical) {
    const sf = features.sources[sourceName];
    const health = healthScores[sourceName] ?? 100;
    if (!sf) continue;
    hypotheses.push({
      cause: `${sourceName} component issue`,
      category: "unknown",
      narrative: `${sourceName} has a health score of ${health.toFixed(0)}% with an error rate of ${(sf.errorRate * 100).toFixed(1)}%. Whatever the broader pattern, this component is locally unhealthy and is likely contributing to the overall anomaly.`,
      probability: clamp((100 - health) / 100 * 0.7, 0.25, 0.7),
      evidence: [
        `Health score: ${health.toFixed(0)}%`,
        `Error rate: ${(sf.errorRate * 100).toFixed(1)}%`,
        `${sf.criticalCount} critical event(s)`,
      ],
      diagnosticSteps: [
        `Open the most recent error logs from ${sourceName} and group by message signature.`,
        `Compare ${sourceName}'s metrics against its baseline over the past 7 days.`,
      ],
      affectedSources: [sourceName],
    });
  }

  // De-duplicate by cause label, keep the highest-probability one
  const dedup = new Map<string, RootCauseHypothesis>();
  for (const h of hypotheses) {
    const existing = dedup.get(h.cause);
    if (!existing || h.probability > existing.probability) dedup.set(h.cause, h);
  }

  return Array.from(dedup.values())
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 6);
}

// ---------------------------------------------------------------------------
// Temporal context
// ---------------------------------------------------------------------------

function analyzeTemporalContext(
  features: DynamicFeatureVector,
  anomalyScore: number
): ExplainablePrediction["temporalContext"] {
  const avgBurstScore =
    Object.values(features.sources).reduce((sum, s) => sum + s.burstScore, 0) /
    Math.max(Object.keys(features.sources).length, 1);

  let trendDirection: "worsening" | "improving" | "stable" = "stable";
  if (avgBurstScore > 0.6 || anomalyScore > 0.75) {
    trendDirection = "worsening";
  } else if (anomalyScore < 0.25 && avgBurstScore < 0.15) {
    // Very quiet system with no burst signature -> treat as actively improving / recovered
    trendDirection = "improving";
  } else {
    trendDirection = "stable";
  }

  let timeToFailure = "No imminent failure expected";
  if (features.correlations.cascadeScore > 0.8 || anomalyScore > 0.9) timeToFailure = "< 1 hour if unaddressed";
  else if (features.correlations.cascadeScore > 0.5 || anomalyScore > 0.75) timeToFailure = "2–4 hours if the trend continues";
  else if (features.correlations.cascadeScore > 0.3 || anomalyScore > 0.6) timeToFailure = "12–24 hours without intervention";
  else if (anomalyScore > 0.4) timeToFailure = "> 24 hours — pre-failure window";

  let historicalPattern = "Normal operational variance";
  if (features.correlations.temporalClusteringScore > 0.7) historicalPattern = "Resembles previous incident patterns";
  else if (features.correlations.temporalClusteringScore > 0.4) historicalPattern = "Some similarity to past degradation events";

  // Build a synthetic timeline that puts the operator in time
  const timeline: { phase: string; description: string }[] = [
    {
      phase: "Baseline window",
      description: "Logs prior to the anomaly window were within expected operating ranges.",
    },
    {
      phase: "Onset",
      description:
        avgBurstScore > 0.5
          ? "A sharp rise in event volume marks the start of the anomaly — sudden onset rather than gradual."
          : "Error rates began drifting upward gradually, suggesting accumulation rather than a single trigger.",
    },
    {
      phase: "Current",
      description:
        anomalyScore > 0.7
          ? "The system is in an active degraded state — leading indicators are far above baseline."
          : anomalyScore > 0.4
            ? "Indicators have left the normal envelope but no hard failure has occurred yet."
            : "Indicators are within tolerance.",
    },
    {
      phase: "Projected next step",
      description:
        trendDirection === "worsening"
          ? "Without intervention, severity is likely to escalate within the time-to-failure window above."
          : trendDirection === "improving"
            ? "Current signals are de-escalating — if the trend holds, the system will return to baseline."
            : "Indicators are stable; no escalation is currently projected.",
    },
  ];

  return { timeToFailure, trendDirection, historicalPattern, timeline };
}

// ---------------------------------------------------------------------------
// Recommendations (priority + reasoning + expected impact)
// ---------------------------------------------------------------------------

function generateRecommendations(
  features: DynamicFeatureVector,
  healthScores: Record<string, number>,
  anomalyScore: number,
  hypotheses: RootCauseHypothesis[]
): ExplainablePrediction["recommendations"] {
  const recommendations: ExplainablePrediction["recommendations"] = [];

  // 1) Recommendations driven by the top hypotheses (most actionable)
  for (const h of hypotheses.slice(0, 2)) {
    switch (h.category) {
      case "resource_exhaustion":
        recommendations.push({
          action: "Inspect process-level memory, file-handle, and connection-pool utilization on the affected hosts",
          priority: "immediate",
          expectedImpact: "Confirms or refutes resource exhaustion within minutes; enables targeted restart or scale-up",
          reasoning: "Sustained errors with high pattern recurrence and no cascade signature strongly suggests a slowly saturating local resource",
        });
        break;
      case "dependency_cascade":
        recommendations.push({
          action: "Identify the earliest erroring source and check the health of its shared dependencies (DB, cache, identity, queue)",
          priority: "immediate",
          expectedImpact: "Locates the upstream component pulling its dependents down — fixing it stabilizes the whole chain",
          reasoning: "High cascade score and multiple critical sources match a textbook dependency-failure pattern",
        });
        recommendations.push({
          action: "Enable circuit breakers / bulkheads between the affected services",
          priority: "soon",
          expectedImpact: "Prevents further propagation while the upstream is being repaired",
          reasoning: "Cascade containment reduces blast radius of any future flap",
        });
        break;
      case "traffic_spike":
        recommendations.push({
          action: "Apply rate limiting or queue throttling at the ingress/edge",
          priority: "immediate",
          expectedImpact: "Caps the spike and gives downstream services head-room to recover",
          reasoning: "Burst plus temporal clustering plus heterogeneous errors is the classic load-spike fingerprint",
        });
        break;
      case "configuration_drift":
        recommendations.push({
          action: "Cross-reference the anomaly start time with deploy / feature-flag / secret-rotation timestamps and rollback the most recent suspect change",
          priority: "immediate",
          expectedImpact: "If a configuration change introduced the regression, rollback returns the system to a known-good state",
          reasoning: "Single-source critical state with high pattern recurrence and no cascade is a hallmark of internal change, not external trigger",
        });
        break;
      case "intermittent_component":
        recommendations.push({
          action: "Group errors by host / pod / replica ID and cordon any clear outlier",
          priority: "soon",
          expectedImpact: "Removes the flaky node from rotation; usually drops the error rate sharply if hardware is at fault",
          reasoning: "Dispersed errors without cascade typically concentrate on a single bad replica or noisy host",
        });
        break;
      case "network_incident":
        recommendations.push({
          action: "Check cloud-provider and internal network dashboards (DNS, LB, VPC) before pursuing application-level fixes",
          priority: "immediate",
          expectedImpact: "Avoids wasted effort on application changes if the issue is at the transport layer",
          reasoning: "Heterogeneous errors across multiple unrelated sources at the same time is rarely an application bug",
        });
        break;
      case "security_event":
        recommendations.push({
          action: "Audit recent auth failures, lockouts, and 401/403 spikes; verify certificate and token expiry",
          priority: "immediate",
          expectedImpact: "Detects abuse or expired credentials early; minimizes credential-related outage time",
          reasoning: "Critical-event bursts with rising error rates are consistent with auth or security incidents",
        });
        break;
      case "scheduled_collision":
        recommendations.push({
          action: "Cross-reference the spike window with cron / ETL / backup schedules and stagger overlapping jobs",
          priority: "scheduled",
          expectedImpact: "Eliminates recurring spike if a scheduled-job collision is the cause",
          reasoning: "Tight temporal clustering without cascade is the fingerprint of a transient batch overlap",
        });
        break;
      case "data_quality":
        recommendations.push({
          action: "Sample failing messages and diff their structure against the expected schema; quarantine bad batches",
          priority: "soon",
          expectedImpact: "Stops error generation at the producer side rather than retrying bad data forever",
          reasoning: "Recurring identical errors with few criticals usually indicate validator/schema rejections, not a runtime bug",
        });
        break;
      default:
        break;
    }
  }

  // 2) Source-health driven actions (catch any sources not covered above)
  for (const [source, health] of Object.entries(healthScores)) {
    if (health < 30) {
      recommendations.push({
        action: `Restart or fail over ${source} immediately`,
        priority: "immediate",
        expectedImpact: "Prevents complete service failure for this component",
        reasoning: `${source} is at ${health.toFixed(0)}% health — past the point where graceful degradation is possible`,
      });
    } else if (health < 50) {
      recommendations.push({
        action: `Investigate ${source} errors and scale resources if needed`,
        priority: "soon",
        expectedImpact: "Stabilizes the degraded component before it crosses into critical territory",
        reasoning: `${source} is showing significant stress (health ${health.toFixed(0)}%)`,
      });
    }
  }

  // 3) System-wide guard rails
  if (features.correlations.cascadeScore > 0.5) {
    recommendations.push({
      action: "Enable circuit breakers between dependent services",
      priority: "immediate",
      expectedImpact: "Prevents failure propagation across the dependency graph",
      reasoning: `Cascade risk is high (${(features.correlations.cascadeScore * 100).toFixed(0)}%)`,
    });
  }

  if (anomalyScore > 0.4 && anomalyScore < 0.7) {
    recommendations.push({
      action: "Increase monitoring granularity for affected systems and enable alert escalation",
      priority: "scheduled",
      expectedImpact: "Earlier detection of further degradation; shorter MTTR if it escalates",
      reasoning: "Borderline anomaly state warrants closer observation before user-visible failure",
    });
  }

  // 4) Always-on baseline if nothing actionable surfaced
  if (recommendations.length === 0) {
    recommendations.push({
      action: "Continue regular monitoring — no immediate action required",
      priority: "scheduled",
      expectedImpact: "Maintains current healthy state",
      reasoning: "All sources are within healthy operating envelopes",
    });
  }

  // De-duplicate by action text
  const seen = new Set<string>();
  return recommendations
    .filter(r => {
      if (seen.has(r.action)) return false;
      seen.add(r.action);
      return true;
    })
    .slice(0, 7);
}

// ---------------------------------------------------------------------------
// Feature importance — with one-line explanation per feature
// ---------------------------------------------------------------------------

function calculateFeatureImportance(
  features: DynamicFeatureVector
): ExplainablePrediction["featureImportance"] {
  const importance: ExplainablePrediction["featureImportance"] = [];
  const sourceCount = Object.keys(features.sources).length;

  let totalErrorRate = 0;
  let totalBurstScore = 0;
  let totalCriticalCount = 0;
  let totalPatternScore = 0;
  for (const sourceFeatures of Object.values(features.sources)) {
    totalErrorRate += sourceFeatures.errorRate;
    totalBurstScore += sourceFeatures.burstScore;
    totalCriticalCount += sourceFeatures.criticalCount;
    totalPatternScore += sourceFeatures.patternScore;
  }

  if (sourceCount > 0) {
    const avgErrorRate = totalErrorRate / sourceCount;
    const avgBurstScore = totalBurstScore / sourceCount;
    const avgPatternScore = totalPatternScore / sourceCount;

    importance.push({
      feature: "Error Rate",
      importance: Math.min(avgErrorRate * 2, 1),
      direction: avgErrorRate > 0.1 ? "negative" : "positive",
      explanation:
        avgErrorRate > 0.1
          ? `Error rate (${(avgErrorRate * 100).toFixed(1)}%) is well above the typical 1–3% baseline.`
          : `Error rate (${(avgErrorRate * 100).toFixed(1)}%) is within the typical baseline.`,
    });

    importance.push({
      feature: "Event Burst Pattern",
      importance: Math.min(avgBurstScore, 1),
      direction: avgBurstScore > 0.5 ? "negative" : "positive",
      explanation:
        avgBurstScore > 0.5
          ? "Events arrived in sharp bursts rather than evenly — a sign of an in-progress incident."
          : "Event arrival is evenly distributed in time — no burst signature.",
    });

    importance.push({
      feature: "Critical Event Count",
      importance: Math.min(totalCriticalCount / 20, 1),
      direction: totalCriticalCount > 5 ? "negative" : "positive",
      explanation:
        totalCriticalCount > 5
          ? `${totalCriticalCount} critical events across all sources — well above the noise floor.`
          : `Only ${totalCriticalCount} critical event(s) — within normal operational noise.`,
    });

    importance.push({
      feature: "Pattern Recurrence",
      importance: Math.min(avgPatternScore, 1),
      direction: avgPatternScore > 0.4 ? "negative" : "positive",
      explanation:
        avgPatternScore > 0.4
          ? "The same error signatures repeat often — indicates a single bug or systematic failure rather than random noise."
          : "Errors are heterogeneous — no single dominant signature.",
    });
  }

  importance.push({
    feature: "Cross-Source Correlation",
    importance: features.correlations.crossSourceErrorOverlap,
    direction: features.correlations.crossSourceErrorOverlap > 0.3 ? "negative" : "positive",
    explanation:
      features.correlations.crossSourceErrorOverlap > 0.3
        ? "Multiple sources error at the same time — points to a shared cause (network, dependency, or external event)."
        : "Sources error independently — no shared upstream cause is implied.",
  });

  importance.push({
    feature: "Cascade Risk",
    importance: features.correlations.cascadeScore,
    direction: features.correlations.cascadeScore > 0.4 ? "negative" : "positive",
    explanation:
      features.correlations.cascadeScore > 0.4
        ? "Errors propagate from one source to its dependents — characteristic of dependency cascade failures."
        : "No propagation pattern — failures stay local.",
  });

  importance.push({
    feature: "Temporal Clustering",
    importance: features.correlations.temporalClusteringScore,
    direction: features.correlations.temporalClusteringScore > 0.5 ? "negative" : "positive",
    explanation:
      features.correlations.temporalClusteringScore > 0.5
        ? "Events are clustered in time — consistent with an active, in-progress incident."
        : "Events are evenly distributed in time — consistent with steady-state noise.",
  });

  return importance.sort((a, b) => b.importance - a.importance);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function humanList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}
