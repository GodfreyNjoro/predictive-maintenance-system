import { ParsedLogEntry } from "./log-parser";

export interface FeatureVector {
  errorRate: number;
  warningRate: number;
  criticalCount: number;
  avgMessageLength: number;
  uniqueSources: number;
  eventIdVariance: number;
  timeGapVariance: number;
  burstScore: number;
  severityScore: number;
  patternScore: number;
}

// Source-specific features (generic for any log source)
export interface SourceFeatures {
  sourceName: string;
  logCount: number;
  errorRate: number;
  warningRate: number;
  criticalCount: number;
  severityScore: number;
  burstScore: number;
  patternScore: number;
  avgMessageLength: number;
  timeSpanHours: number;
}

// Dynamic multi-source feature vector
export interface DynamicFeatureVector {
  sources: { [sourceName: string]: SourceFeatures };
  correlations: {
    crossSourceErrorOverlap: number;
    cascadeScore: number;
    temporalClusteringScore: number;
  };
  overall: {
    totalLogCount: number;
    totalErrorRate: number;
    totalPatternScore: number;
    timeSpanHours: number;
    uniqueSourceCount: number;
  };
}

// Combined feature vector for multi-source analysis (legacy format for compatibility)
export interface CombinedFeatureVector {
  // Windows Event Features
  windows_errorRate: number;
  windows_warningRate: number;
  windows_criticalCount: number;
  windows_severityScore: number;
  windows_burstScore: number;
  
  // MSSQL Features
  mssql_errorRate: number;
  mssql_warningRate: number;
  mssql_deadlockCount: number;
  mssql_queryTimeoutRate: number;
  mssql_connectionFailures: number;
  
  // Performance Features
  perf_cpuAvg: number;
  perf_cpuMax: number;
  perf_memoryAvg: number;
  perf_memoryMax: number;
  perf_diskAvg: number;
  perf_diskMax: number;
  perf_networkAnomalyScore: number;
  
  // Cross-Source Correlation Features
  correlation_errorTimingOverlap: number;
  correlation_resourceStressWithErrors: number;
  correlation_cascadeScore: number;
  
  // Overall Metrics
  total_logCount: number;
  total_errorRate: number;
  total_patternScore: number;
  time_spanHours: number;
}

// Dynamic multi-source logs interface (supports any source names)
export interface DynamicMultiSourceLogs {
  [sourceName: string]: ParsedLogEntry[];
}

const ERROR_PATTERNS = [
  "timeout",
  "connection refused",
  "out of memory",
  "disk full",
  "deadlock",
  "fatal",
  "crash",
  "corruption",
  "failed",
  "exception",
  "overflow",
  "access denied",
  "authentication failed",
];

export function extractFeatures(logs: ParsedLogEntry[]): FeatureVector {
  if (!logs || logs.length === 0) {
    return {
      errorRate: 0,
      warningRate: 0,
      criticalCount: 0,
      avgMessageLength: 0,
      uniqueSources: 0,
      eventIdVariance: 0,
      timeGapVariance: 0,
      burstScore: 0,
      severityScore: 0,
      patternScore: 0,
    };
  }

  const total = logs.length;
  const errors = logs.filter((l) => l?.logLevel === "error")?.length ?? 0;
  const warnings = logs.filter((l) => l?.logLevel === "warning")?.length ?? 0;
  const criticals = logs.filter((l) => l?.logLevel === "critical")?.length ?? 0;

  const sources = new Set(logs.map((l) => l?.source).filter(Boolean));
  const messageLengths = logs.map((l) => l?.message?.length ?? 0);
  const avgMessageLength =
    messageLengths.reduce((a, b) => a + b, 0) / total;

  // Event ID variance
  const eventIds = logs
    .map((l) => l?.eventId)
    .filter((e): e is number => e !== undefined);
  let eventIdVariance = 0;
  if (eventIds.length > 1) {
    const mean = eventIds.reduce((a, b) => a + b, 0) / eventIds.length;
    eventIdVariance = eventIds.reduce((sum, id) => sum + Math.pow(id - mean, 2), 0) / eventIds.length;
    eventIdVariance = Math.sqrt(eventIdVariance);
  }

  // Time gap variance (detect bursts)
  const timestamps = logs
    .map((l) => l?.timestamp?.getTime?.() ?? 0)
    .filter((t) => t > 0)
    .sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    gaps.push(timestamps[i] - timestamps[i - 1]);
  }
  let timeGapVariance = 0;
  let burstScore = 0;
  if (gaps.length > 0) {
    const meanGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    timeGapVariance = Math.sqrt(
      gaps.reduce((sum, g) => sum + Math.pow(g - meanGap, 2), 0) / gaps.length
    );
    burstScore = gaps.filter((g) => g < meanGap / 10)?.length / gaps.length;
  }

  // Severity score
  const severityScore = (criticals * 4 + errors * 2 + warnings) / total;

  // Pattern matching score
  let patternMatches = 0;
  logs.forEach((log) => {
    const msg = log?.message?.toLowerCase() ?? "";
    ERROR_PATTERNS.forEach((pattern) => {
      if (msg.includes(pattern)) patternMatches++;
    });
  });
  const patternScore = patternMatches / total;

  return {
    errorRate: errors / total,
    warningRate: warnings / total,
    criticalCount: criticals,
    avgMessageLength: avgMessageLength / 100,
    uniqueSources: sources.size / 10,
    eventIdVariance: Math.min(eventIdVariance / 10000, 1),
    timeGapVariance: Math.min(timeGapVariance / 60000, 1),
    burstScore,
    severityScore,
    patternScore,
  };
}

export function featureVectorToArray(features: FeatureVector): number[] {
  return [
    features.errorRate,
    features.warningRate,
    features.criticalCount,
    features.avgMessageLength,
    features.uniqueSources,
    features.eventIdVariance,
    features.timeGapVariance,
    features.burstScore,
    features.severityScore,
    features.patternScore,
  ];
}

// MSSQL-specific error patterns
const MSSQL_PATTERNS = {
  deadlock: ["deadlock", "lock timeout", "blocking"],
  queryTimeout: ["timeout expired", "query timeout", "execution timeout"],
  connectionFailure: ["connection failed", "login failed", "network error", "tcp provider"],
};

// Performance threshold constants
const PERF_THRESHOLDS = {
  cpu_warning: 70,
  cpu_critical: 90,
  memory_warning: 80,
  memory_critical: 95,
  disk_warning: 85,
  disk_critical: 95,
};

export interface MultiSourceLogs {
  windows: ParsedLogEntry[];
  mssql: ParsedLogEntry[];
  performance: ParsedLogEntry[];
}

/**
 * Extract combined features from multiple log sources for unified system analysis
 */
export function extractCombinedFeatures(logs: MultiSourceLogs): CombinedFeatureVector {
  const { windows, mssql, performance } = logs;
  
  // Windows Event Features
  const windowsFeatures = extractWindowsFeatures(windows);
  
  // MSSQL Features
  const mssqlFeatures = extractMssqlFeatures(mssql);
  
  // Performance Features
  const perfFeatures = extractPerformanceFeatures(performance);
  
  // Cross-source correlation
  const correlationFeatures = calculateCorrelations(windows, mssql, performance);
  
  // Overall metrics
  const allLogs = [...windows, ...mssql, ...performance];
  const totalErrors = allLogs.filter(l => l?.logLevel === "error" || l?.logLevel === "critical").length;
  const totalPatternScore = calculateOverallPatternScore(allLogs);
  const timeSpan = calculateTimeSpanHours(allLogs);
  
  return {
    // Windows
    windows_errorRate: windowsFeatures.errorRate,
    windows_warningRate: windowsFeatures.warningRate,
    windows_criticalCount: windowsFeatures.criticalCount,
    windows_severityScore: windowsFeatures.severityScore,
    windows_burstScore: windowsFeatures.burstScore,
    
    // MSSQL
    mssql_errorRate: mssqlFeatures.errorRate,
    mssql_warningRate: mssqlFeatures.warningRate,
    mssql_deadlockCount: mssqlFeatures.deadlockCount,
    mssql_queryTimeoutRate: mssqlFeatures.queryTimeoutRate,
    mssql_connectionFailures: mssqlFeatures.connectionFailures,
    
    // Performance
    perf_cpuAvg: perfFeatures.cpuAvg,
    perf_cpuMax: perfFeatures.cpuMax,
    perf_memoryAvg: perfFeatures.memoryAvg,
    perf_memoryMax: perfFeatures.memoryMax,
    perf_diskAvg: perfFeatures.diskAvg,
    perf_diskMax: perfFeatures.diskMax,
    perf_networkAnomalyScore: perfFeatures.networkAnomalyScore,
    
    // Correlation
    correlation_errorTimingOverlap: correlationFeatures.errorTimingOverlap,
    correlation_resourceStressWithErrors: correlationFeatures.resourceStressWithErrors,
    correlation_cascadeScore: correlationFeatures.cascadeScore,
    
    // Overall
    total_logCount: allLogs.length,
    total_errorRate: allLogs.length > 0 ? totalErrors / allLogs.length : 0,
    total_patternScore: totalPatternScore,
    time_spanHours: timeSpan,
  };
}

function extractWindowsFeatures(logs: ParsedLogEntry[]) {
  if (!logs || logs.length === 0) {
    return { errorRate: 0, warningRate: 0, criticalCount: 0, severityScore: 0, burstScore: 0 };
  }
  
  const total = logs.length;
  const errors = logs.filter(l => l?.logLevel === "error").length;
  const warnings = logs.filter(l => l?.logLevel === "warning").length;
  const criticals = logs.filter(l => l?.logLevel === "critical").length;
  
  const severityScore = (criticals * 4 + errors * 2 + warnings) / total;
  
  // Calculate burst score
  const timestamps = logs.map(l => l?.timestamp?.getTime?.() ?? 0).filter(t => t > 0).sort((a, b) => a - b);
  let burstScore = 0;
  if (timestamps.length > 1) {
    const gaps = [];
    for (let i = 1; i < timestamps.length; i++) {
      gaps.push(timestamps[i] - timestamps[i - 1]);
    }
    const meanGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    burstScore = gaps.filter(g => g < meanGap / 10).length / gaps.length;
  }
  
  return {
    errorRate: errors / total,
    warningRate: warnings / total,
    criticalCount: criticals,
    severityScore,
    burstScore,
  };
}

function extractMssqlFeatures(logs: ParsedLogEntry[]) {
  if (!logs || logs.length === 0) {
    return { errorRate: 0, warningRate: 0, deadlockCount: 0, queryTimeoutRate: 0, connectionFailures: 0 };
  }
  
  const total = logs.length;
  const errors = logs.filter(l => l?.logLevel === "error").length;
  const warnings = logs.filter(l => l?.logLevel === "warning").length;
  
  let deadlockCount = 0;
  let queryTimeouts = 0;
  let connectionFailures = 0;
  
  logs.forEach(log => {
    const msg = log?.message?.toLowerCase() ?? "";
    
    if (MSSQL_PATTERNS.deadlock.some(p => msg.includes(p))) deadlockCount++;
    if (MSSQL_PATTERNS.queryTimeout.some(p => msg.includes(p))) queryTimeouts++;
    if (MSSQL_PATTERNS.connectionFailure.some(p => msg.includes(p))) connectionFailures++;
  });
  
  return {
    errorRate: errors / total,
    warningRate: warnings / total,
    deadlockCount,
    queryTimeoutRate: queryTimeouts / total,
    connectionFailures,
  };
}

function extractPerformanceFeatures(logs: ParsedLogEntry[]) {
  if (!logs || logs.length === 0) {
    return {
      cpuAvg: 0, cpuMax: 0, memoryAvg: 0, memoryMax: 0,
      diskAvg: 0, diskMax: 0, networkAnomalyScore: 0
    };
  }
  
  const cpuValues: number[] = [];
  const memoryValues: number[] = [];
  const diskValues: number[] = [];
  const networkValues: number[] = [];
  
  logs.forEach(log => {
    const msg = log?.message ?? "";
    const rawData = log?.rawData ?? "";
    
    // Parse performance metrics from log message or raw data
    const cpuMatch = msg.match(/cpu[_\s]*(?:percent|%)?[:\s]*(\d+\.?\d*)/i) || 
                     rawData.match(/"CPU_Percent"[:\s]*(\d+\.?\d*)/i);
    const memMatch = msg.match(/memory[_\s]*(?:percent|%)?[:\s]*(\d+\.?\d*)/i) ||
                     rawData.match(/"Memory_Percent"[:\s]*(\d+\.?\d*)/i);
    const diskMatch = msg.match(/disk[_\s]*(?:percent|%)?[:\s]*(\d+\.?\d*)/i) ||
                      rawData.match(/"Disk_Percent"[:\s]*(\d+\.?\d*)/i);
    const netMatch = msg.match(/network[_\s]*(?:kb|bytes)?[:\s]*(\d+\.?\d*)/i) ||
                     rawData.match(/"Network_KB_s"[:\s]*(\d+\.?\d*)/i);
    
    if (cpuMatch) cpuValues.push(parseFloat(cpuMatch[1]));
    if (memMatch) memoryValues.push(parseFloat(memMatch[1]));
    if (diskMatch) diskValues.push(parseFloat(diskMatch[1]));
    if (netMatch) networkValues.push(parseFloat(netMatch[1]));
  });
  
  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const max = (arr: number[]) => arr.length > 0 ? Math.max(...arr) : 0;
  
  // Network anomaly score based on variance
  let networkAnomalyScore = 0;
  if (networkValues.length > 1) {
    const netAvg = avg(networkValues);
    const variance = networkValues.reduce((sum, v) => sum + Math.pow(v - netAvg, 2), 0) / networkValues.length;
    networkAnomalyScore = Math.min(Math.sqrt(variance) / netAvg, 1) || 0;
  }
  
  return {
    cpuAvg: avg(cpuValues) / 100,
    cpuMax: max(cpuValues) / 100,
    memoryAvg: avg(memoryValues) / 100,
    memoryMax: max(memoryValues) / 100,
    diskAvg: avg(diskValues) / 100,
    diskMax: max(diskValues) / 100,
    networkAnomalyScore,
  };
}

function calculateCorrelations(
  windows: ParsedLogEntry[],
  mssql: ParsedLogEntry[],
  performance: ParsedLogEntry[]
) {
  // Error timing overlap - do errors across sources happen at similar times?
  let errorTimingOverlap = 0;
  const windowsErrorTimes = windows.filter(l => l?.logLevel === "error" || l?.logLevel === "critical")
    .map(l => l?.timestamp?.getTime?.() ?? 0).filter(t => t > 0);
  const mssqlErrorTimes = mssql.filter(l => l?.logLevel === "error" || l?.logLevel === "critical")
    .map(l => l?.timestamp?.getTime?.() ?? 0).filter(t => t > 0);
  
  if (windowsErrorTimes.length > 0 && mssqlErrorTimes.length > 0) {
    // Check how many MSSQL errors occurred within 5 minutes of Windows errors
    let overlaps = 0;
    const timeWindow = 5 * 60 * 1000; // 5 minutes
    
    mssqlErrorTimes.forEach(mssqlTime => {
      if (windowsErrorTimes.some(winTime => Math.abs(mssqlTime - winTime) < timeWindow)) {
        overlaps++;
      }
    });
    
    errorTimingOverlap = overlaps / mssqlErrorTimes.length;
  }
  
  // Resource stress with errors - do errors correlate with high resource usage?
  let resourceStressWithErrors = 0;
  const allErrorTimes = [...windowsErrorTimes, ...mssqlErrorTimes];
  
  if (allErrorTimes.length > 0 && performance.length > 0) {
    const perfMetrics = performance.map(log => {
      const rawData = log?.rawData ?? "";
      const cpuMatch = rawData.match(/"CPU_Percent"[:\s]*(\d+\.?\d*)/i);
      const memMatch = rawData.match(/"Memory_Percent"[:\s]*(\d+\.?\d*)/i);
      return {
        time: log?.timestamp?.getTime?.() ?? 0,
        cpu: cpuMatch ? parseFloat(cpuMatch[1]) : 0,
        memory: memMatch ? parseFloat(memMatch[1]) : 0,
      };
    }).filter(p => p.time > 0);
    
    let stressCorrelations = 0;
    const timeWindow = 5 * 60 * 1000;
    
    allErrorTimes.forEach(errorTime => {
      const nearbyPerf = perfMetrics.filter(p => Math.abs(p.time - errorTime) < timeWindow);
      if (nearbyPerf.some(p => p.cpu > PERF_THRESHOLDS.cpu_warning || p.memory > PERF_THRESHOLDS.memory_warning)) {
        stressCorrelations++;
      }
    });
    
    resourceStressWithErrors = allErrorTimes.length > 0 ? stressCorrelations / allErrorTimes.length : 0;
  }
  
  // Cascade score - errors propagating across systems
  let cascadeScore = 0;
  if (windowsErrorTimes.length > 0 && mssqlErrorTimes.length > 0) {
    // Check if Windows errors are followed by MSSQL errors within 2 minutes
    let cascades = 0;
    const cascadeWindow = 2 * 60 * 1000;
    
    windowsErrorTimes.forEach(winTime => {
      if (mssqlErrorTimes.some(mssqlTime => mssqlTime > winTime && mssqlTime - winTime < cascadeWindow)) {
        cascades++;
      }
    });
    
    cascadeScore = windowsErrorTimes.length > 0 ? cascades / windowsErrorTimes.length : 0;
  }
  
  return {
    errorTimingOverlap,
    resourceStressWithErrors,
    cascadeScore,
  };
}

function calculateOverallPatternScore(logs: ParsedLogEntry[]): number {
  if (!logs || logs.length === 0) return 0;
  
  let patternMatches = 0;
  logs.forEach(log => {
    const msg = log?.message?.toLowerCase() ?? "";
    ERROR_PATTERNS.forEach(pattern => {
      if (msg.includes(pattern)) patternMatches++;
    });
  });
  
  return patternMatches / logs.length;
}

function calculateTimeSpanHours(logs: ParsedLogEntry[]): number {
  const timestamps = logs.map(l => l?.timestamp?.getTime?.() ?? 0).filter(t => t > 0);
  if (timestamps.length < 2) return 0;
  
  const minTime = Math.min(...timestamps);
  const maxTime = Math.max(...timestamps);
  
  return (maxTime - minTime) / (1000 * 60 * 60); // Convert to hours
}

export function combinedFeatureVectorToArray(features: CombinedFeatureVector): number[] {
  return [
    features.windows_errorRate,
    features.windows_warningRate,
    features.windows_criticalCount / 10, // Normalize
    features.windows_severityScore,
    features.windows_burstScore,
    features.mssql_errorRate,
    features.mssql_warningRate,
    features.mssql_deadlockCount / 10,
    features.mssql_queryTimeoutRate,
    features.mssql_connectionFailures / 10,
    features.perf_cpuAvg,
    features.perf_cpuMax,
    features.perf_memoryAvg,
    features.perf_memoryMax,
    features.perf_diskAvg,
    features.perf_diskMax,
    features.perf_networkAnomalyScore,
    features.correlation_errorTimingOverlap,
    features.correlation_resourceStressWithErrors,
    features.correlation_cascadeScore,
    Math.min(features.total_logCount / 1000, 1), // Normalize
    features.total_errorRate,
    features.total_patternScore,
    Math.min(features.time_spanHours / 24, 1), // Normalize to max 1 day
  ];
}

// ===============================================
// DYNAMIC MULTI-SOURCE ANALYSIS (Any Log Type)
// ===============================================

/**
 * Extract features from a single log source (generic - works for any source type)
 */
export function extractSourceFeatures(sourceName: string, logs: ParsedLogEntry[]): SourceFeatures {
  if (!logs || logs.length === 0) {
    return {
      sourceName,
      logCount: 0,
      errorRate: 0,
      warningRate: 0,
      criticalCount: 0,
      severityScore: 0,
      burstScore: 0,
      patternScore: 0,
      avgMessageLength: 0,
      timeSpanHours: 0,
    };
  }

  const total = logs.length;
  const errors = logs.filter(l => l?.logLevel === "error").length;
  const warnings = logs.filter(l => l?.logLevel === "warning").length;
  const criticals = logs.filter(l => l?.logLevel === "critical").length;

  // Severity score
  const severityScore = (criticals * 4 + errors * 2 + warnings) / total;

  // Burst score
  const timestamps = logs.map(l => l?.timestamp?.getTime?.() ?? 0).filter(t => t > 0).sort((a, b) => a - b);
  let burstScore = 0;
  if (timestamps.length > 1) {
    const gaps: number[] = [];
    for (let i = 1; i < timestamps.length; i++) {
      gaps.push(timestamps[i] - timestamps[i - 1]);
    }
    const meanGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    burstScore = gaps.filter(g => g < meanGap / 10).length / gaps.length;
  }

  // Pattern score
  let patternMatches = 0;
  logs.forEach(log => {
    const msg = log?.message?.toLowerCase() ?? "";
    ERROR_PATTERNS.forEach(pattern => {
      if (msg.includes(pattern)) patternMatches++;
    });
  });
  const patternScore = patternMatches / total;

  // Average message length
  const avgMessageLength = logs.reduce((sum, l) => sum + (l?.message?.length ?? 0), 0) / total / 100;

  // Time span
  let timeSpanHours = 0;
  if (timestamps.length > 1) {
    timeSpanHours = (Math.max(...timestamps) - Math.min(...timestamps)) / (1000 * 60 * 60);
  }

  return {
    sourceName,
    logCount: total,
    errorRate: errors / total,
    warningRate: warnings / total,
    criticalCount: criticals,
    severityScore,
    burstScore,
    patternScore,
    avgMessageLength,
    timeSpanHours,
  };
}

/**
 * Calculate cross-source correlations for dynamic multi-source analysis
 */
function calculateDynamicCorrelations(logs: DynamicMultiSourceLogs): {
  crossSourceErrorOverlap: number;
  cascadeScore: number;
  temporalClusteringScore: number;
} {
  const sourceNames = Object.keys(logs);
  
  if (sourceNames.length < 2) {
    return { crossSourceErrorOverlap: 0, cascadeScore: 0, temporalClusteringScore: 0 };
  }

  // Collect error times from all sources
  const errorTimesBySource: { [source: string]: number[] } = {};
  sourceNames.forEach(source => {
    errorTimesBySource[source] = logs[source]
      .filter(l => l?.logLevel === "error" || l?.logLevel === "critical")
      .map(l => l?.timestamp?.getTime?.() ?? 0)
      .filter(t => t > 0);
  });

  // Cross-source error overlap (errors happening within 5 minutes across sources)
  const timeWindow = 5 * 60 * 1000;
  let totalOverlaps = 0;
  let totalComparisons = 0;

  for (let i = 0; i < sourceNames.length; i++) {
    for (let j = i + 1; j < sourceNames.length; j++) {
      const times1 = errorTimesBySource[sourceNames[i]];
      const times2 = errorTimesBySource[sourceNames[j]];

      if (times1.length > 0 && times2.length > 0) {
        times1.forEach(t1 => {
          if (times2.some(t2 => Math.abs(t1 - t2) < timeWindow)) {
            totalOverlaps++;
          }
        });
        totalComparisons += times1.length;
      }
    }
  }

  const crossSourceErrorOverlap = totalComparisons > 0 ? totalOverlaps / totalComparisons : 0;

  // Cascade score (errors in one source followed by errors in another)
  const cascadeWindow = 2 * 60 * 1000;
  let cascades = 0;
  let cascadeOpportunities = 0;

  for (let i = 0; i < sourceNames.length; i++) {
    for (let j = 0; j < sourceNames.length; j++) {
      if (i === j) continue;
      const times1 = errorTimesBySource[sourceNames[i]];
      const times2 = errorTimesBySource[sourceNames[j]];

      if (times1.length > 0 && times2.length > 0) {
        times1.forEach(t1 => {
          if (times2.some(t2 => t2 > t1 && t2 - t1 < cascadeWindow)) {
            cascades++;
          }
          cascadeOpportunities++;
        });
      }
    }
  }

  const cascadeScore = cascadeOpportunities > 0 ? cascades / cascadeOpportunities : 0;

  // Temporal clustering (are logs from different sources clustered in time?)
  const allTimestamps = Object.values(logs)
    .flat()
    .map(l => l?.timestamp?.getTime?.() ?? 0)
    .filter(t => t > 0)
    .sort((a, b) => a - b);

  let temporalClusteringScore = 0;
  if (allTimestamps.length > 10) {
    const gaps: number[] = [];
    for (let i = 1; i < allTimestamps.length; i++) {
      gaps.push(allTimestamps[i] - allTimestamps[i - 1]);
    }
    const meanGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const clusteredGaps = gaps.filter(g => g < meanGap / 5).length;
    temporalClusteringScore = clusteredGaps / gaps.length;
  }

  return { crossSourceErrorOverlap, cascadeScore, temporalClusteringScore };
}

/**
 * Extract dynamic features from multiple log sources (supports any source names)
 */
export function extractDynamicFeatures(logs: DynamicMultiSourceLogs): DynamicFeatureVector {
  const sourceNames = Object.keys(logs);
  
  // Extract features for each source
  const sources: { [sourceName: string]: SourceFeatures } = {};
  sourceNames.forEach(sourceName => {
    sources[sourceName] = extractSourceFeatures(sourceName, logs[sourceName]);
  });

  // Calculate correlations
  const correlations = calculateDynamicCorrelations(logs);

  // Overall metrics
  const allLogs = Object.values(logs).flat();
  const totalErrors = allLogs.filter(l => l?.logLevel === "error" || l?.logLevel === "critical").length;
  
  let totalPatternMatches = 0;
  allLogs.forEach(log => {
    const msg = log?.message?.toLowerCase() ?? "";
    ERROR_PATTERNS.forEach(pattern => {
      if (msg.includes(pattern)) totalPatternMatches++;
    });
  });

  const timestamps = allLogs.map(l => l?.timestamp?.getTime?.() ?? 0).filter(t => t > 0);
  const timeSpanHours = timestamps.length > 1 
    ? (Math.max(...timestamps) - Math.min(...timestamps)) / (1000 * 60 * 60) 
    : 0;

  return {
    sources,
    correlations,
    overall: {
      totalLogCount: allLogs.length,
      totalErrorRate: allLogs.length > 0 ? totalErrors / allLogs.length : 0,
      totalPatternScore: allLogs.length > 0 ? totalPatternMatches / allLogs.length : 0,
      timeSpanHours,
      uniqueSourceCount: sourceNames.length,
    },
  };
}

/**
 * Convert dynamic features to array for ML model input
 */
export function dynamicFeatureVectorToArray(features: DynamicFeatureVector): number[] {
  const arr: number[] = [];

  // Add source features (sorted by name for consistency)
  const sortedSources = Object.keys(features.sources).sort();
  sortedSources.forEach(sourceName => {
    const s = features.sources[sourceName];
    arr.push(
      s.errorRate,
      s.warningRate,
      Math.min(s.criticalCount / 10, 1),
      s.severityScore,
      s.burstScore,
      s.patternScore,
      Math.min(s.avgMessageLength, 1)
    );
  });

  // Pad to ensure consistent vector size (max 10 sources x 7 features = 70)
  while (arr.length < 70) arr.push(0);
  if (arr.length > 70) arr.length = 70;

  // Add correlation features
  arr.push(
    features.correlations.crossSourceErrorOverlap,
    features.correlations.cascadeScore,
    features.correlations.temporalClusteringScore
  );

  // Add overall metrics
  arr.push(
    Math.min(features.overall.totalLogCount / 1000, 1),
    features.overall.totalErrorRate,
    features.overall.totalPatternScore,
    Math.min(features.overall.timeSpanHours / 24, 1),
    Math.min(features.overall.uniqueSourceCount / 10, 1)
  );

  return arr;
}