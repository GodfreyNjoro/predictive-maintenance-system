/**
 * Baseline Learning — Phase 9.2
 *
 * Tracks rolling mean/stddev per application × source × metric.
 * After ~5 samples, can flag deviations. Uses Welford's online algorithm
 * for numerically stable incremental updates.
 *
 * CRITICAL: All operations are scoped by applicationId. Data from one
 * application is NEVER mixed with another.
 */

import { prisma } from "@/lib/db";

export interface MetricSample {
  source: string;
  metricName: string;
  value: number;
}

export interface BaselineDeviation {
  source: string;
  metricName: string;
  currentValue: number;
  baselineMean: number;
  baselineStddev: number;
  deviationSigma: number; // how many stddevs from mean
  direction: "above" | "below";
  sampleCount: number;
}

const MIN_SAMPLES_FOR_DEVIATION = 5;
const DEVIATION_THRESHOLD_SIGMA = 2.0; // flag at 2σ

/**
 * Update baselines for an application from the per-source stats
 * produced during an analysis run.
 *
 * Uses Welford's online algorithm:
 *   mean(n) = mean(n-1) + (x - mean(n-1)) / n
 *   M2(n)   = M2(n-1) + (x - mean(n-1)) * (x - mean(n))
 *   var(n)  = M2(n) / (n - 1)  [sample variance]
 */
export async function updateBaselines(
  applicationId: string,
  samples: MetricSample[],
): Promise<BaselineDeviation[]> {
  const deviations: BaselineDeviation[] = [];

  for (const sample of samples) {
    const existing = await prisma.baselineMetric.findUnique({
      where: {
        applicationId_source_metricName: {
          applicationId,
          source: sample.source,
          metricName: sample.metricName,
        },
      },
    });

    if (!existing) {
      // First sample — create baseline
      await prisma.baselineMetric.create({
        data: {
          applicationId,
          source: sample.source,
          metricName: sample.metricName,
          sampleCount: 1,
          rollingMean: sample.value,
          rollingStddev: 0,
          lastValue: sample.value,
          lastUpdatedAt: new Date(),
        },
      });
    } else {
      const n = existing.sampleCount + 1;
      const oldMean = existing.rollingMean;
      const newMean = oldMean + (sample.value - oldMean) / n;

      // Reconstruct M2 from existing stddev and count
      // M2(n-1) = stddev^2 * (n-2) when n-1 >= 2, else 0
      const M2prev = existing.sampleCount >= 2
        ? existing.rollingStddev * existing.rollingStddev * (existing.sampleCount - 1)
        : 0;
      const M2new = M2prev + (sample.value - oldMean) * (sample.value - newMean);
      const newStddev = n >= 2 ? Math.sqrt(M2new / (n - 1)) : 0;

      // Check for deviation before updating
      if (existing.sampleCount >= MIN_SAMPLES_FOR_DEVIATION && existing.rollingStddev > 0.001) {
        const sigma = Math.abs(sample.value - existing.rollingMean) / existing.rollingStddev;
        if (sigma >= DEVIATION_THRESHOLD_SIGMA) {
          deviations.push({
            source: sample.source,
            metricName: sample.metricName,
            currentValue: sample.value,
            baselineMean: existing.rollingMean,
            baselineStddev: existing.rollingStddev,
            deviationSigma: Math.round(sigma * 10) / 10,
            direction: sample.value > existing.rollingMean ? "above" : "below",
            sampleCount: existing.sampleCount,
          });
        }
      }

      await prisma.baselineMetric.update({
        where: { id: existing.id },
        data: {
          sampleCount: n,
          rollingMean: newMean,
          rollingStddev: newStddev,
          lastValue: sample.value,
          lastUpdatedAt: new Date(),
        },
      });
    }
  }

  return deviations;
}

/** Get all baselines for an application (for RAG context injection). */
export async function getBaselines(applicationId: string) {
  return prisma.baselineMetric.findMany({
    where: { applicationId },
    orderBy: [{ source: "asc" }, { metricName: "asc" }],
  });
}

/** Compute metric samples from per-source stats. */
export function statsToSamples(
  stats: Record<string, { total: number; critical: number; error: number; warning: number; info: number }>,
): MetricSample[] {
  const samples: MetricSample[] = [];
  for (const [source, s] of Object.entries(stats)) {
    const total = s.total || 1;
    samples.push(
      { source, metricName: "errorRate", value: s.error / total },
      { source, metricName: "warningRate", value: s.warning / total },
      { source, metricName: "criticalRate", value: s.critical / total },
      { source, metricName: "totalEntries", value: s.total },
    );
  }
  return samples;
}
