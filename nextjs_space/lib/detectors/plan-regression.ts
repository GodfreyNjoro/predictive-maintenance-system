/**
 * Plan-regression detector — pure function.
 *
 * Given a batch of Query Store runtime-stats rows + a baseline cache, decide
 * which queries have regressed (slowed materially) since their baseline AND
 * are running a different execution plan. Emit synthetic events tagged
 * `MSSQL.QueryStore.PlanRegression` for each detected regression.
 *
 * Baselines are persisted INSIDE the queryStore Watermark.cursor JSON so we
 * don't need a new schema column. Each baseline tracks a per-`query_id`
 * EWMA of avg_duration plus the last observed plan_hash and a sample count.
 *
 * Rationale
 * ---------
 * • Plan changes are common and almost always benign. We only alert when
 *   the new plan is materially slower than the established baseline.
 * • A minimum sample count avoids alerting on the very first observation.
 * • EWMA (alpha = 0.2) lets the baseline drift slowly, so a query that
 *   gradually gets faster over weeks is not falsely accused of regression.
 */

import type { ParsedLogEntry } from "../log-parser";

/** Threshold: current avg duration must be >= this multiple of the baseline. */
export const PLAN_REGRESSION_RATIO = 1.5;
/** Baseline must have at least this many samples before we'll alert. */
export const PLAN_REGRESSION_MIN_SAMPLES = 5;
/** EWMA smoothing factor for baseline avg_duration. */
export const PLAN_REGRESSION_EWMA_ALPHA = 0.2;

export interface PlanBaseline {
  /** Hash of the last *baseline* execution plan we observed (hex string). */
  planHash: string;
  /** Smoothed average duration in ms across past observations. */
  avgDurationMs: number;
  /** How many observations this baseline has absorbed. */
  sampleCount: number;
  /** ISO timestamp of the last update. */
  updatedAt: string;
}

export interface PlanRegressionInput {
  queryId: number | string;
  planHash: string;
  /** Most recent avg execution duration in ms (microseconds / 1000 from QS). */
  avgDurationMs: number;
  /** Optional execution count used for evidence. */
  executionCount?: number;
  /** Most recent observation timestamp (used for the synthetic event). */
  observedAt: Date;
  /** Optional truncated query text for the synthetic event message. */
  queryTextSnippet?: string;
}

export interface DetectorResult {
  /** ParsedLogEntries (logLevel = warning, source = MSSQL.QueryStore.PlanRegression). */
  syntheticEvents: ParsedLogEntry[];
  /** Updated baselines map (caller persists into Watermark.cursor). */
  updatedBaselines: Record<string, PlanBaseline>;
  /** Number of regressions detected this batch (for IngestionRun.note). */
  regressionsFound: number;
}

/**
 * @param observations Rows from the current pull, deduplicated to one entry
 *   per `query_id` (caller chooses the most recent runtime_stats row per query).
 * @param baselines    Existing baselines from previous cursor (or {} if first run).
 * @param now          Optional clock override for tests.
 */
export function detectPlanRegressions(
  observations: PlanRegressionInput[],
  baselines: Record<string, PlanBaseline>,
  now?: () => Date,
): DetectorResult {
  const updated: Record<string, PlanBaseline> = { ...baselines };
  const events: ParsedLogEntry[] = [];
  const clock = now ?? (() => new Date());

  for (const obs of observations) {
    if (!obs || !Number.isFinite(obs.avgDurationMs) || obs.avgDurationMs < 0) continue;
    const key = String(obs.queryId);
    const baseline = updated[key];

    if (!baseline) {
      // First time we see this query — seed baseline, no event.
      updated[key] = {
        planHash: obs.planHash,
        avgDurationMs: obs.avgDurationMs,
        sampleCount: 1,
        updatedAt: obs.observedAt.toISOString(),
      };
      continue;
    }

    const ratio = baseline.avgDurationMs > 0 ? obs.avgDurationMs / baseline.avgDurationMs : 0;
    const planChanged = obs.planHash !== baseline.planHash;
    const enoughSamples = baseline.sampleCount >= PLAN_REGRESSION_MIN_SAMPLES;
    const isRegression =
      enoughSamples && planChanged && ratio >= PLAN_REGRESSION_RATIO;

    if (isRegression) {
      events.push(buildSyntheticEvent(obs, baseline, ratio, clock()));
      // Reset baseline to the new plan — next observations track the new normal.
      updated[key] = {
        planHash: obs.planHash,
        avgDurationMs: obs.avgDurationMs,
        sampleCount: 1,
        updatedAt: obs.observedAt.toISOString(),
      };
      continue;
    }

    // Either same plan or modest variation — fold into EWMA baseline.
    const newAvg =
      baseline.avgDurationMs * (1 - PLAN_REGRESSION_EWMA_ALPHA) +
      obs.avgDurationMs * PLAN_REGRESSION_EWMA_ALPHA;
    updated[key] = {
      planHash: planChanged ? obs.planHash : baseline.planHash,
      avgDurationMs: newAvg,
      sampleCount: baseline.sampleCount + 1,
      updatedAt: obs.observedAt.toISOString(),
    };
  }

  return {
    syntheticEvents: events,
    updatedBaselines: updated,
    regressionsFound: events.length,
  };
}

function buildSyntheticEvent(
  obs: PlanRegressionInput,
  baseline: PlanBaseline,
  ratio: number,
  generatedAt: Date,
): ParsedLogEntry {
  const baseMs = baseline.avgDurationMs.toFixed(0);
  const currMs = obs.avgDurationMs.toFixed(0);
  const ratioStr = ratio.toFixed(2);
  const snippet = obs.queryTextSnippet ? ` — ${obs.queryTextSnippet}` : "";

  return {
    timestamp: obs.observedAt,
    logLevel: "warning",
    source: "MSSQL.QueryStore.PlanRegression",
    message:
      `Plan regression detected for query_id=${obs.queryId} (avg duration ${currMs}ms ` +
      `vs baseline ${baseMs}ms; ratio ${ratioStr}×; plan_hash changed)${snippet}`,
    rawData: JSON.stringify({
      query_id: obs.queryId,
      previous_plan_hash: baseline.planHash,
      current_plan_hash: obs.planHash,
      previous_avg_duration_ms: baseline.avgDurationMs,
      current_avg_duration_ms: obs.avgDurationMs,
      ratio,
      baseline_sample_count: baseline.sampleCount,
      execution_count: obs.executionCount ?? null,
      observed_at: obs.observedAt.toISOString(),
      detected_at: generatedAt.toISOString(),
    }),
    features: {
      ratio,
      currentAvgMs: obs.avgDurationMs,
      baselineAvgMs: baseline.avgDurationMs,
      isPlanChanged: 1,
      executionCount: obs.executionCount ?? 0,
    },
  };
}
