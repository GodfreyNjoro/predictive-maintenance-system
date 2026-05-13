import { 
  FeatureVector, 
  featureVectorToArray, 
  CombinedFeatureVector, 
  combinedFeatureVectorToArray,
  DynamicFeatureVector,
  SourceFeatures,
  dynamicFeatureVectorToArray
} from "./feature-extractor";

export interface PredictionResult {
  isAnomaly: boolean;
  anomalyScore: number;
  confidence: number;
  severity: "critical" | "high" | "medium" | "low";
  predictionType: "failure" | "degradation" | "normal";
  affectedSystem: string;
  description: string;
}

export interface CombinedPredictionResult {
  isAnomaly: boolean;
  anomalyScore: number;
  confidence: number;
  severity: "critical" | "high" | "medium" | "low";
  predictionType: "failure" | "degradation" | "normal";
  overallSystemHealth: number; // 0-100 score
  description: string;
  
  // Per-component analysis
  componentAnalysis: {
    windows: ComponentHealth;
    mssql: ComponentHealth;
    performance: ComponentHealth;
  };
  
  // Correlation insights
  correlationInsights: {
    errorTimingCorrelation: string;
    resourceCorrelation: string;
    cascadeRisk: string;
  };
  
  // Recommendations
  recommendations: string[];
}

export interface ComponentHealth {
  status: "healthy" | "warning" | "critical";
  score: number;
  issues: string[];
}

// Simple Isolation Forest implementation
class IsolationTree {
  private splitFeature: number = 0;
  private splitValue: number = 0;
  private left: IsolationTree | null = null;
  private right: IsolationTree | null = null;
  private size: number = 0;
  private isLeaf: boolean = false;

  constructor(data: number[][], currentDepth: number, maxDepth: number) {
    this.size = data?.length ?? 0;

    if (currentDepth >= maxDepth || this.size <= 1) {
      this.isLeaf = true;
      return;
    }

    const numFeatures = data[0]?.length ?? 0;
    if (numFeatures === 0) {
      this.isLeaf = true;
      return;
    }

    this.splitFeature = Math.floor(Math.random() * numFeatures);
    const featureValues = data.map((d) => d[this.splitFeature] ?? 0);
    const min = Math.min(...featureValues);
    const max = Math.max(...featureValues);

    if (min === max) {
      this.isLeaf = true;
      return;
    }

    this.splitValue = min + Math.random() * (max - min);

    const leftData = data.filter((d) => (d[this.splitFeature] ?? 0) < this.splitValue);
    const rightData = data.filter((d) => (d[this.splitFeature] ?? 0) >= this.splitValue);

    if (leftData.length === 0 || rightData.length === 0) {
      this.isLeaf = true;
      return;
    }

    this.left = new IsolationTree(leftData, currentDepth + 1, maxDepth);
    this.right = new IsolationTree(rightData, currentDepth + 1, maxDepth);
  }

  pathLength(point: number[], currentLength: number): number {
    if (this.isLeaf || !this.left || !this.right) {
      return currentLength + this.averagePathLength(this.size);
    }

    if ((point[this.splitFeature] ?? 0) < this.splitValue) {
      return this.left.pathLength(point, currentLength + 1);
    }
    return this.right.pathLength(point, currentLength + 1);
  }

  private averagePathLength(n: number): number {
    if (n <= 1) return 0;
    if (n === 2) return 1;
    const h = Math.log(n - 1) + 0.5772156649;
    return 2 * h - (2 * (n - 1)) / n;
  }
}

export class IsolationForest {
  private trees: IsolationTree[] = [];
  private numTrees: number;
  private maxSamples: number;
  private maxDepth: number;
  private trainingSamples: number = 0;

  constructor(numTrees: number = 100, maxSamples: number = 256) {
    this.numTrees = numTrees;
    this.maxSamples = maxSamples;
    this.maxDepth = Math.ceil(Math.log2(maxSamples));
  }

  fit(data: number[][]): void {
    if (!data || data.length === 0) return;

    this.trainingSamples = data.length;
    this.trees = [];

    for (let i = 0; i < this.numTrees; i++) {
      const sampleSize = Math.min(this.maxSamples, data.length);
      const sample = this.randomSample(data, sampleSize);
      this.trees.push(new IsolationTree(sample, 0, this.maxDepth));
    }
  }

  private randomSample(data: number[][], size: number): number[][] {
    const shuffled = [...data].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, size);
  }

  predict(point: number[]): number {
    if (this.trees.length === 0) return 0.5;

    const avgPathLength =
      this.trees.reduce((sum, tree) => sum + tree.pathLength(point, 0), 0) /
      this.trees.length;

    const c = this.averagePathLength(this.maxSamples);
    const anomalyScore = Math.pow(2, -avgPathLength / c);

    return anomalyScore;
  }

  private averagePathLength(n: number): number {
    if (n <= 1) return 0;
    if (n === 2) return 1;
    const h = Math.log(n - 1) + 0.5772156649;
    return 2 * h - (2 * (n - 1)) / n;
  }

  getParameters(): Record<string, number> {
    return {
      numTrees: this.numTrees,
      maxSamples: this.maxSamples,
      maxDepth: this.maxDepth,
      trainingSamples: this.trainingSamples,
    };
  }
}

// Global model instance
let globalModel: IsolationForest | null = null;
let modelVersion: string = "v1.0.0";

export function getModel(): IsolationForest {
  if (!globalModel) {
    globalModel = new IsolationForest(100, 256);
    // Initialize with baseline normal data
    const baselineData = generateBaselineData();
    globalModel.fit(baselineData);
  }
  return globalModel;
}

export function retrainModel(data: number[][], feedback?: { isAnomaly: boolean; features: number[] }[]): void {
  globalModel = new IsolationForest(100, 256);
  
  let trainingData = [...data];
  
  // Incorporate feedback if available
  if (feedback && feedback.length > 0) {
    // Weight anomalies higher in training
    feedback.forEach((f) => {
      if (f.isAnomaly) {
        // Don't include confirmed anomalies in normal training data
      } else {
        trainingData.push(f.features);
      }
    });
  }
  
  if (trainingData.length > 0) {
    globalModel.fit(trainingData);
  }
}

function generateBaselineData(): number[][] {
  const data: number[][] = [];
  for (let i = 0; i < 500; i++) {
    data.push([
      Math.random() * 0.1,      // errorRate - low for normal
      Math.random() * 0.15,     // warningRate
      Math.floor(Math.random() * 2), // criticalCount
      0.3 + Math.random() * 0.4, // avgMessageLength
      0.2 + Math.random() * 0.3, // uniqueSources
      Math.random() * 0.2,       // eventIdVariance
      Math.random() * 0.3,       // timeGapVariance
      Math.random() * 0.1,       // burstScore
      Math.random() * 0.3,       // severityScore
      Math.random() * 0.1,       // patternScore
    ]);
  }
  return data;
}

export function makePrediction(features: FeatureVector): PredictionResult {
  const model = getModel();
  const featureArray = featureVectorToArray(features);
  const anomalyScore = model.predict(featureArray);

  const isAnomaly = anomalyScore > 0.6;
  const confidence = Math.abs(anomalyScore - 0.5) * 2;

  let severity: "critical" | "high" | "medium" | "low";
  let predictionType: "failure" | "degradation" | "normal";
  let description: string;

  if (anomalyScore > 0.85) {
    severity = "critical";
    predictionType = "failure";
    description = "High probability of imminent system failure detected. Critical anomaly patterns identified.";
  } else if (anomalyScore > 0.7) {
    severity = "high";
    predictionType = "failure";
    description = "Significant anomaly detected indicating potential system failure.";
  } else if (anomalyScore > 0.6) {
    severity = "medium";
    predictionType = "degradation";
    description = "Performance degradation patterns detected. System may experience issues.";
  } else if (anomalyScore > 0.45) {
    severity = "low";
    predictionType = "degradation";
    description = "Minor anomalies detected. Continue monitoring.";
  } else {
    severity = "low";
    predictionType = "normal";
    description = "System operating within normal parameters.";
  }

  // Determine affected system based on features
  let affectedSystem = "windows_server";
  if (features.patternScore > 0.3) {
    affectedSystem = "mssql";
  } else if (features.burstScore > 0.3) {
    affectedSystem = "network";
  } else if (features.eventIdVariance > 0.5) {
    affectedSystem = "storage";
  }

  return {
    isAnomaly,
    anomalyScore,
    confidence,
    severity,
    predictionType,
    affectedSystem,
    description,
  };
}

// Combined model for multi-source analysis
let combinedModel: IsolationForest | null = null;

export function getCombinedModel(): IsolationForest {
  if (!combinedModel) {
    combinedModel = new IsolationForest(100, 256);
    const baselineData = generateCombinedBaselineData();
    combinedModel.fit(baselineData);
  }
  return combinedModel;
}

function generateCombinedBaselineData(): number[][] {
  const data: number[][] = [];
  for (let i = 0; i < 500; i++) {
    data.push([
      // Windows features (5)
      Math.random() * 0.1,       // windows_errorRate
      Math.random() * 0.15,      // windows_warningRate
      Math.floor(Math.random() * 2) / 10, // windows_criticalCount
      Math.random() * 0.3,       // windows_severityScore
      Math.random() * 0.1,       // windows_burstScore
      // MSSQL features (5)
      Math.random() * 0.1,       // mssql_errorRate
      Math.random() * 0.15,      // mssql_warningRate
      Math.floor(Math.random() * 2) / 10, // mssql_deadlockCount
      Math.random() * 0.1,       // mssql_queryTimeoutRate
      Math.floor(Math.random() * 2) / 10, // mssql_connectionFailures
      // Performance features (7)
      0.2 + Math.random() * 0.3, // perf_cpuAvg
      0.3 + Math.random() * 0.4, // perf_cpuMax
      0.3 + Math.random() * 0.3, // perf_memoryAvg
      0.4 + Math.random() * 0.4, // perf_memoryMax
      0.2 + Math.random() * 0.3, // perf_diskAvg
      0.3 + Math.random() * 0.4, // perf_diskMax
      Math.random() * 0.2,       // perf_networkAnomalyScore
      // Correlation features (3)
      Math.random() * 0.2,       // correlation_errorTimingOverlap
      Math.random() * 0.2,       // correlation_resourceStressWithErrors
      Math.random() * 0.1,       // correlation_cascadeScore
      // Overall metrics (4)
      0.1 + Math.random() * 0.3, // total_logCount (normalized)
      Math.random() * 0.1,       // total_errorRate
      Math.random() * 0.1,       // total_patternScore
      Math.random() * 0.5,       // time_spanHours (normalized)
    ]);
  }
  return data;
}

export function makeCombinedPrediction(features: CombinedFeatureVector): CombinedPredictionResult {
  const model = getCombinedModel();
  const featureArray = combinedFeatureVectorToArray(features);
  const anomalyScore = model.predict(featureArray);
  
  const isAnomaly = anomalyScore > 0.55; // Slightly lower threshold for combined analysis
  const confidence = Math.abs(anomalyScore - 0.5) * 2;
  
  // Calculate overall system health (0-100)
  const overallSystemHealth = Math.round((1 - anomalyScore) * 100);
  
  // Analyze individual components
  const windowsHealth = analyzeWindowsHealth(features);
  const mssqlHealth = analyzeMssqlHealth(features);
  const performanceHealth = analyzePerformanceHealth(features);
  
  // Generate correlation insights
  const correlationInsights = generateCorrelationInsights(features);
  
  // Determine severity and prediction type
  let severity: "critical" | "high" | "medium" | "low";
  let predictionType: "failure" | "degradation" | "normal";
  let description: string;
  
  // Count critical components
  const criticalComponents = [windowsHealth, mssqlHealth, performanceHealth]
    .filter(c => c.status === "critical").length;
  const warningComponents = [windowsHealth, mssqlHealth, performanceHealth]
    .filter(c => c.status === "warning").length;
  
  if (anomalyScore > 0.85 || criticalComponents >= 2 || features.correlation_cascadeScore > 0.5) {
    severity = "critical";
    predictionType = "failure";
    description = "CRITICAL: Multiple system components showing severe anomalies with high correlation. Immediate attention required to prevent system failure.";
  } else if (anomalyScore > 0.7 || criticalComponents >= 1 || features.correlation_resourceStressWithErrors > 0.5) {
    severity = "high";
    predictionType = "failure";
    description = "HIGH RISK: Significant anomalies detected across system components. Resource stress correlating with errors indicates potential cascade failure.";
  } else if (anomalyScore > 0.55 || warningComponents >= 2) {
    severity = "medium";
    predictionType = "degradation";
    description = "WARNING: Performance degradation patterns detected. Multiple components showing stress indicators that may lead to issues.";
  } else if (anomalyScore > 0.4 || warningComponents >= 1) {
    severity = "low";
    predictionType = "degradation";
    description = "NOTICE: Minor anomalies detected in system components. Continue monitoring for changes.";
  } else {
    severity = "low";
    predictionType = "normal";
    description = "HEALTHY: All system components operating within normal parameters. No immediate concerns.";
  }
  
  // Generate recommendations
  const recommendations = generateRecommendations(features, windowsHealth, mssqlHealth, performanceHealth);
  
  return {
    isAnomaly,
    anomalyScore,
    confidence,
    severity,
    predictionType,
    overallSystemHealth,
    description,
    componentAnalysis: {
      windows: windowsHealth,
      mssql: mssqlHealth,
      performance: performanceHealth,
    },
    correlationInsights,
    recommendations,
  };
}

function analyzeWindowsHealth(features: CombinedFeatureVector): ComponentHealth {
  const issues: string[] = [];
  let score = 100;
  
  if (features.windows_criticalCount > 0) {
    issues.push(`${features.windows_criticalCount} critical events detected`);
    score -= features.windows_criticalCount * 15;
  }
  if (features.windows_errorRate > 0.2) {
    issues.push(`High error rate: ${(features.windows_errorRate * 100).toFixed(1)}%`);
    score -= 20;
  } else if (features.windows_errorRate > 0.1) {
    issues.push(`Elevated error rate: ${(features.windows_errorRate * 100).toFixed(1)}%`);
    score -= 10;
  }
  if (features.windows_burstScore > 0.3) {
    issues.push("Event burst pattern detected - possible issue cascade");
    score -= 15;
  }
  if (features.windows_severityScore > 1.5) {
    issues.push("High severity event concentration");
    score -= 10;
  }
  
  score = Math.max(0, score);
  const status: "healthy" | "warning" | "critical" = 
    score < 50 ? "critical" : score < 75 ? "warning" : "healthy";
  
  return { status, score, issues };
}

function analyzeMssqlHealth(features: CombinedFeatureVector): ComponentHealth {
  const issues: string[] = [];
  let score = 100;
  
  if (features.mssql_deadlockCount > 0) {
    issues.push(`${features.mssql_deadlockCount} deadlock(s) detected`);
    score -= features.mssql_deadlockCount * 20;
  }
  if (features.mssql_connectionFailures > 0) {
    issues.push(`${features.mssql_connectionFailures} connection failure(s)`);
    score -= features.mssql_connectionFailures * 15;
  }
  if (features.mssql_queryTimeoutRate > 0.1) {
    issues.push(`Query timeout rate: ${(features.mssql_queryTimeoutRate * 100).toFixed(1)}%`);
    score -= 20;
  }
  if (features.mssql_errorRate > 0.15) {
    issues.push(`High database error rate: ${(features.mssql_errorRate * 100).toFixed(1)}%`);
    score -= 15;
  }
  
  score = Math.max(0, score);
  const status: "healthy" | "warning" | "critical" = 
    score < 50 ? "critical" : score < 75 ? "warning" : "healthy";
  
  return { status, score, issues };
}

function analyzePerformanceHealth(features: CombinedFeatureVector): ComponentHealth {
  const issues: string[] = [];
  let score = 100;
  
  // CPU analysis
  if (features.perf_cpuMax > 0.95) {
    issues.push(`Critical CPU usage peak: ${(features.perf_cpuMax * 100).toFixed(1)}%`);
    score -= 25;
  } else if (features.perf_cpuAvg > 0.8) {
    issues.push(`High average CPU: ${(features.perf_cpuAvg * 100).toFixed(1)}%`);
    score -= 15;
  }
  
  // Memory analysis
  if (features.perf_memoryMax > 0.95) {
    issues.push(`Critical memory usage: ${(features.perf_memoryMax * 100).toFixed(1)}%`);
    score -= 25;
  } else if (features.perf_memoryAvg > 0.85) {
    issues.push(`High average memory: ${(features.perf_memoryAvg * 100).toFixed(1)}%`);
    score -= 15;
  }
  
  // Disk analysis
  if (features.perf_diskMax > 0.95) {
    issues.push(`Critical disk usage: ${(features.perf_diskMax * 100).toFixed(1)}%`);
    score -= 20;
  } else if (features.perf_diskAvg > 0.85) {
    issues.push(`High disk utilization: ${(features.perf_diskAvg * 100).toFixed(1)}%`);
    score -= 10;
  }
  
  // Network analysis
  if (features.perf_networkAnomalyScore > 0.5) {
    issues.push("Network traffic anomaly detected");
    score -= 15;
  }
  
  score = Math.max(0, score);
  const status: "healthy" | "warning" | "critical" = 
    score < 50 ? "critical" : score < 75 ? "warning" : "healthy";
  
  return { status, score, issues };
}

function generateCorrelationInsights(features: CombinedFeatureVector): {
  errorTimingCorrelation: string;
  resourceCorrelation: string;
  cascadeRisk: string;
} {
  // Error timing correlation
  let errorTimingCorrelation: string;
  if (features.correlation_errorTimingOverlap > 0.7) {
    errorTimingCorrelation = "STRONG: Errors across Windows and MSSQL are highly synchronized, indicating a common root cause.";
  } else if (features.correlation_errorTimingOverlap > 0.4) {
    errorTimingCorrelation = "MODERATE: Some correlation between Windows and database errors. Monitor for patterns.";
  } else {
    errorTimingCorrelation = "LOW: Errors appear independent across systems.";
  }
  
  // Resource correlation
  let resourceCorrelation: string;
  if (features.correlation_resourceStressWithErrors > 0.7) {
    resourceCorrelation = "STRONG: Errors strongly correlate with high resource usage. Resource constraints likely causing failures.";
  } else if (features.correlation_resourceStressWithErrors > 0.4) {
    resourceCorrelation = "MODERATE: Some errors occur during resource stress periods. Consider capacity planning.";
  } else {
    resourceCorrelation = "LOW: Errors not significantly related to resource utilization.";
  }
  
  // Cascade risk
  let cascadeRisk: string;
  if (features.correlation_cascadeScore > 0.5) {
    cascadeRisk = "HIGH: Windows errors frequently trigger MSSQL errors. Investigate system dependencies.";
  } else if (features.correlation_cascadeScore > 0.2) {
    cascadeRisk = "MODERATE: Some error propagation detected between systems.";
  } else {
    cascadeRisk = "LOW: No significant error cascade patterns detected.";
  }
  
  return { errorTimingCorrelation, resourceCorrelation, cascadeRisk };
}

function generateRecommendations(
  features: CombinedFeatureVector,
  windowsHealth: ComponentHealth,
  mssqlHealth: ComponentHealth,
  performanceHealth: ComponentHealth
): string[] {
  const recommendations: string[] = [];
  
  // Performance-based recommendations
  if (features.perf_cpuAvg > 0.8 || features.perf_cpuMax > 0.95) {
    recommendations.push("🔧 Investigate high CPU usage - consider scaling or optimizing resource-intensive processes");
  }
  if (features.perf_memoryAvg > 0.85 || features.perf_memoryMax > 0.95) {
    recommendations.push("💾 Memory pressure detected - review application memory leaks or increase RAM allocation");
  }
  if (features.perf_diskMax > 0.9) {
    recommendations.push("💿 Disk space critical - clean up logs/temp files or expand storage capacity");
  }
  
  // MSSQL-based recommendations
  if (features.mssql_deadlockCount > 0) {
    recommendations.push("🔒 Deadlocks detected - review transaction isolation levels and query optimization");
  }
  if (features.mssql_queryTimeoutRate > 0.05) {
    recommendations.push("⏱️ Query timeouts occurring - analyze slow queries and add indexes where needed");
  }
  if (features.mssql_connectionFailures > 0) {
    recommendations.push("🔌 Database connection failures - check connection pool settings and network stability");
  }
  
  // Correlation-based recommendations
  if (features.correlation_cascadeScore > 0.3) {
    recommendations.push("⚡ Error cascade pattern detected - investigate dependencies between Windows services and MSSQL");
  }
  if (features.correlation_resourceStressWithErrors > 0.5) {
    recommendations.push("📊 Resource stress correlates with errors - implement resource monitoring alerts and auto-scaling");
  }
  
  // Windows-based recommendations
  if (features.windows_burstScore > 0.3) {
    recommendations.push("🚨 Event burst pattern detected - review system logs for rapid failure propagation");
  }
  if (windowsHealth.status === "critical") {
    recommendations.push("🖥️ Critical Windows events require immediate attention - check Event Viewer for details");
  }
  
  // General recommendations
  if (recommendations.length === 0) {
    recommendations.push("✅ System is healthy - continue regular monitoring and maintain current practices");
  }
  
  return recommendations;
}

// ===============================================
// DYNAMIC MULTI-SOURCE PREDICTION (Any Log Type)
// ===============================================

export interface DynamicSourceHealth {
  sourceName: string;
  status: "healthy" | "warning" | "critical";
  score: number;
  issues: string[];
}

export interface DynamicPredictionResult {
  isAnomaly: boolean;
  anomalyScore: number;
  confidence: number;
  severity: "critical" | "high" | "medium" | "low";
  predictionType: "failure" | "degradation" | "normal";
  overallSystemHealth: number;
  description: string;
  
  // Per-source analysis (dynamic - any source names)
  sourceAnalysis: { [sourceName: string]: DynamicSourceHealth };
  
  // Correlation insights
  correlationInsights: {
    crossSourceCorrelation: string;
    cascadeRisk: string;
    temporalClustering: string;
  };
  
  // Recommendations
  recommendations: string[];
}

// Dynamic model instance
let dynamicModel: IsolationForest | null = null;

export function getDynamicModel(): IsolationForest {
  if (!dynamicModel) {
    dynamicModel = new IsolationForest(100, 256);
    const baselineData = generateDynamicBaselineData();
    dynamicModel.fit(baselineData);
  }
  return dynamicModel;
}

function generateDynamicBaselineData(): number[][] {
  const data: number[][] = [];
  for (let i = 0; i < 500; i++) {
    const sample: number[] = [];
    
    // Generate 10 sources x 7 features = 70 source features (mostly zeros for unused sources)
    for (let j = 0; j < 70; j++) {
      // First 21 features (3 sources worth) have normal baseline values
      if (j < 21) {
        const featureIdx = j % 7;
        if (featureIdx === 0) sample.push(Math.random() * 0.1);      // errorRate
        else if (featureIdx === 1) sample.push(Math.random() * 0.15); // warningRate
        else if (featureIdx === 2) sample.push(Math.random() * 0.2);  // criticalCount
        else if (featureIdx === 3) sample.push(Math.random() * 0.3);  // severityScore
        else if (featureIdx === 4) sample.push(Math.random() * 0.1);  // burstScore
        else if (featureIdx === 5) sample.push(Math.random() * 0.1);  // patternScore
        else sample.push(0.3 + Math.random() * 0.4);                  // avgMessageLength
      } else {
        sample.push(0); // Unused source slots
      }
    }
    
    // Correlation features (3)
    sample.push(Math.random() * 0.2);  // crossSourceErrorOverlap
    sample.push(Math.random() * 0.1);  // cascadeScore
    sample.push(Math.random() * 0.2);  // temporalClusteringScore
    
    // Overall metrics (5)
    sample.push(0.1 + Math.random() * 0.3);  // totalLogCount
    sample.push(Math.random() * 0.1);        // totalErrorRate
    sample.push(Math.random() * 0.1);        // totalPatternScore
    sample.push(Math.random() * 0.5);        // timeSpanHours
    sample.push(0.1 + Math.random() * 0.3);  // uniqueSourceCount
    
    data.push(sample);
  }
  return data;
}

/**
 * Analyze health of a single source based on its features
 */
function analyzeSourceHealth(source: SourceFeatures): DynamicSourceHealth {
  const issues: string[] = [];
  let score = 100;
  
  if (source.criticalCount > 0) {
    issues.push(`${source.criticalCount} critical event(s)`);
    score -= source.criticalCount * 15;
  }
  
  if (source.errorRate > 0.2) {
    issues.push(`High error rate: ${(source.errorRate * 100).toFixed(1)}%`);
    score -= 20;
  } else if (source.errorRate > 0.1) {
    issues.push(`Elevated error rate: ${(source.errorRate * 100).toFixed(1)}%`);
    score -= 10;
  }
  
  if (source.burstScore > 0.3) {
    issues.push("Event burst pattern detected");
    score -= 15;
  }
  
  if (source.patternScore > 0.3) {
    issues.push("Error patterns detected in messages");
    score -= 10;
  }
  
  if (source.severityScore > 1.5) {
    issues.push("High severity concentration");
    score -= 10;
  }
  
  score = Math.max(0, score);
  const status: "healthy" | "warning" | "critical" = 
    score < 50 ? "critical" : score < 75 ? "warning" : "healthy";
  
  return {
    sourceName: source.sourceName,
    status,
    score,
    issues,
  };
}

/**
 * Generate correlation insights for dynamic multi-source analysis
 */
function generateDynamicCorrelationInsights(features: DynamicFeatureVector): {
  crossSourceCorrelation: string;
  cascadeRisk: string;
  temporalClustering: string;
} {
  const { correlations } = features;
  
  let crossSourceCorrelation: string;
  if (correlations.crossSourceErrorOverlap > 0.7) {
    crossSourceCorrelation = "STRONG: Errors across sources are highly synchronized, indicating a common root cause.";
  } else if (correlations.crossSourceErrorOverlap > 0.4) {
    crossSourceCorrelation = "MODERATE: Some correlation between errors across sources. Monitor for patterns.";
  } else {
    crossSourceCorrelation = "LOW: Errors appear independent across different log sources.";
  }
  
  let cascadeRisk: string;
  if (correlations.cascadeScore > 0.5) {
    cascadeRisk = "HIGH: Errors in one source frequently trigger errors in others. Investigate dependencies.";
  } else if (correlations.cascadeScore > 0.2) {
    cascadeRisk = "MODERATE: Some error propagation detected between sources.";
  } else {
    cascadeRisk = "LOW: No significant error cascade patterns detected.";
  }
  
  let temporalClustering: string;
  if (correlations.temporalClusteringScore > 0.5) {
    temporalClustering = "HIGH: Events are temporally clustered, suggesting related incidents.";
  } else if (correlations.temporalClusteringScore > 0.2) {
    temporalClustering = "MODERATE: Some temporal clustering of events.";
  } else {
    temporalClustering = "LOW: Events are evenly distributed over time.";
  }
  
  return { crossSourceCorrelation, cascadeRisk, temporalClustering };
}

/**
 * Generate recommendations based on dynamic multi-source analysis
 */
function generateDynamicRecommendations(
  features: DynamicFeatureVector,
  sourceHealth: { [sourceName: string]: DynamicSourceHealth }
): string[] {
  const recommendations: string[] = [];
  
  // Source-specific recommendations
  Object.values(sourceHealth).forEach(source => {
    if (source.status === "critical") {
      recommendations.push(`🚨 Critical issues in "${source.sourceName}" - immediate investigation required`);
    } else if (source.status === "warning" && source.issues.length > 1) {
      recommendations.push(`⚠️ Multiple warnings in "${source.sourceName}" - monitor closely`);
    }
    
    source.issues.forEach(issue => {
      if (issue.includes("burst pattern")) {
        recommendations.push(`📈 "${source.sourceName}": Analyze burst patterns for rapid failure detection`);
      }
      if (issue.includes("critical event")) {
        recommendations.push(`🔴 "${source.sourceName}": Review critical events in detail`);
      }
    });
  });
  
  // Correlation-based recommendations
  const { correlations } = features;
  if (correlations.cascadeScore > 0.3) {
    recommendations.push("⚡ Error cascade pattern detected - investigate dependencies between log sources");
  }
  if (correlations.crossSourceErrorOverlap > 0.5) {
    recommendations.push("🔗 Strong cross-source correlation - look for common infrastructure issues");
  }
  if (correlations.temporalClusteringScore > 0.5) {
    recommendations.push("⏰ Events are temporally clustered - check for scheduled jobs or peak load periods");
  }
  
  // Overall recommendations
  if (features.overall.totalErrorRate > 0.2) {
    recommendations.push("📊 High overall error rate - prioritize error investigation across all sources");
  }
  
  // General recommendations
  if (recommendations.length === 0) {
    recommendations.push("✅ All systems healthy - continue regular monitoring");
  }
  
  // Deduplicate similar recommendations
  return [...new Set(recommendations)].slice(0, 8);
}

/**
 * Make prediction using dynamic multi-source features (supports any log types)
 */
export function makeDynamicPrediction(features: DynamicFeatureVector): DynamicPredictionResult {
  const model = getDynamicModel();
  const featureArray = dynamicFeatureVectorToArray(features);
  const anomalyScore = model.predict(featureArray);
  
  const isAnomaly = anomalyScore > 0.55;
  const confidence = Math.abs(anomalyScore - 0.5) * 2;
  
  // Calculate overall system health (0-100)
  const overallSystemHealth = Math.round((1 - anomalyScore) * 100);
  
  // Analyze health of each source
  const sourceAnalysis: { [sourceName: string]: DynamicSourceHealth } = {};
  Object.entries(features.sources).forEach(([sourceName, sourceFeatures]) => {
    sourceAnalysis[sourceName] = analyzeSourceHealth(sourceFeatures);
  });
  
  // Generate correlation insights
  const correlationInsights = generateDynamicCorrelationInsights(features);
  
  // Count critical and warning sources
  const criticalSources = Object.values(sourceAnalysis).filter(s => s.status === "critical").length;
  const warningSources = Object.values(sourceAnalysis).filter(s => s.status === "warning").length;
  
  // Determine severity and prediction type
  let severity: "critical" | "high" | "medium" | "low";
  let predictionType: "failure" | "degradation" | "normal";
  let description: string;
  
  if (anomalyScore > 0.85 || criticalSources >= 2 || features.correlations.cascadeScore > 0.5) {
    severity = "critical";
    predictionType = "failure";
    description = "CRITICAL: Multiple log sources showing severe anomalies with high correlation. Immediate attention required.";
  } else if (anomalyScore > 0.7 || criticalSources >= 1) {
    severity = "high";
    predictionType = "failure";
    description = "HIGH RISK: Significant anomalies detected across log sources. Potential system failure imminent.";
  } else if (anomalyScore > 0.55 || warningSources >= 2) {
    severity = "medium";
    predictionType = "degradation";
    description = "WARNING: Performance degradation patterns detected. Multiple sources showing stress indicators.";
  } else if (anomalyScore > 0.4 || warningSources >= 1) {
    severity = "low";
    predictionType = "degradation";
    description = "NOTICE: Minor anomalies detected. Continue monitoring for changes.";
  } else {
    severity = "low";
    predictionType = "normal";
    description = "HEALTHY: All log sources operating within normal parameters.";
  }
  
  // Generate recommendations
  const recommendations = generateDynamicRecommendations(features, sourceAnalysis);
  
  return {
    isAnomaly,
    anomalyScore,
    confidence,
    severity,
    predictionType,
    overallSystemHealth,
    description,
    sourceAnalysis,
    correlationInsights,
    recommendations,
  };
}

export function retrainCombinedModel(data: number[][]): void {
  combinedModel = new IsolationForest(100, 256);
  if (data.length > 0) {
    combinedModel.fit(data);
  }
}