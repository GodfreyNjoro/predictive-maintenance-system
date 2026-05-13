/**
 * Federated Learning Module
 * Enables privacy-preserving model training where data stays local
 * Only model weights/gradients are shared
 */

export interface LocalModelState {
  id: string;
  version: string;
  trainingSamples: number;
  lastTrained: Date;
  accuracy: number;
  weights: number[];
}

export interface FederatedConfig {
  minClients: number;
  roundsToConverge: number;
  learningRate: number;
  batchSize: number;
  privacyBudget: number; // For differential privacy
}

export interface AggregatedModel {
  version: string;
  contributingClients: number;
  totalSamples: number;
  aggregatedWeights: number[];
  performanceMetrics: {
    accuracy: number;
    precision: number;
    recall: number;
    f1Score: number;
  };
  createdAt: Date;
}

export interface IndustryBaseline {
  id: string;
  name: string;
  description: string;
  industry: string;
  contributingOrgs: number;
  version: string;
  accuracy: number;
  supportedLogTypes: string[];
  modelSize: number;
  lastUpdated: Date;
}

// Simulated industry baselines
export const INDUSTRY_BASELINES: IndustryBaseline[] = [
  {
    id: "fin_services_v2",
    name: "Financial Services Baseline",
    description: "Trained on patterns from banking and fintech infrastructure",
    industry: "Financial Services",
    contributingOrgs: 47,
    version: "2.1.0",
    accuracy: 0.94,
    supportedLogTypes: ["Windows Event", "Database", "Application", "Network"],
    modelSize: 2.4,
    lastUpdated: new Date("2026-02-15"),
  },
  {
    id: "healthcare_v1",
    name: "Healthcare Infrastructure",
    description: "HIPAA-compliant patterns for medical systems",
    industry: "Healthcare",
    contributingOrgs: 23,
    version: "1.5.0",
    accuracy: 0.91,
    supportedLogTypes: ["Application", "Database", "Security", "Network"],
    modelSize: 1.8,
    lastUpdated: new Date("2026-02-01"),
  },
  {
    id: "ecommerce_v3",
    name: "E-Commerce Platform",
    description: "High-traffic retail and commerce patterns",
    industry: "Retail/E-Commerce",
    contributingOrgs: 89,
    version: "3.0.1",
    accuracy: 0.93,
    supportedLogTypes: ["Nginx", "Apache", "Application", "Database", "Network"],
    modelSize: 3.1,
    lastUpdated: new Date("2026-02-20"),
  },
  {
    id: "manufacturing_v1",
    name: "Industrial IoT & Manufacturing",
    description: "Patterns from factory automation and IoT devices",
    industry: "Manufacturing",
    contributingOrgs: 34,
    version: "1.2.0",
    accuracy: 0.89,
    supportedLogTypes: ["Syslog", "Custom", "Network", "Application"],
    modelSize: 2.0,
    lastUpdated: new Date("2026-01-28"),
  },
  {
    id: "telecom_v2",
    name: "Telecommunications",
    description: "Network infrastructure and service patterns",
    industry: "Telecommunications",
    contributingOrgs: 18,
    version: "2.0.0",
    accuracy: 0.92,
    supportedLogTypes: ["Syslog", "Network", "Application", "Security"],
    modelSize: 2.7,
    lastUpdated: new Date("2026-02-10"),
  },
];

/**
 * Simulated local model training
 * In production, this would run on the client's infrastructure
 */
export function trainLocalModel(
  data: number[][],
  config: Partial<FederatedConfig> = {}
): LocalModelState {
  const fullConfig: FederatedConfig = {
    minClients: 3,
    roundsToConverge: 10,
    learningRate: 0.01,
    batchSize: 32,
    privacyBudget: 1.0,
    ...config,
  };

  // Simulate local training
  const numFeatures = data[0]?.length || 10;
  const weights = new Array(numFeatures).fill(0).map(() => Math.random() * 0.1 - 0.05);
  
  // Add noise for differential privacy
  const noisyWeights = weights.map(w => 
    w + (Math.random() - 0.5) * (1 / fullConfig.privacyBudget)
  );

  return {
    id: `local_${Date.now()}`,
    version: "1.0.0",
    trainingSamples: data.length,
    lastTrained: new Date(),
    accuracy: 0.85 + Math.random() * 0.1,
    weights: noisyWeights,
  };
}

/**
 * Federated averaging of model weights
 */
export function aggregateModels(localModels: LocalModelState[]): AggregatedModel {
  if (localModels.length === 0) {
    throw new Error("No models to aggregate");
  }

  const totalSamples = localModels.reduce((sum, m) => sum + m.trainingSamples, 0);
  const numWeights = localModels[0].weights.length;
  
  // Weighted average based on sample count
  const aggregatedWeights = new Array(numWeights).fill(0);
  
  for (const model of localModels) {
    const weight = model.trainingSamples / totalSamples;
    for (let i = 0; i < numWeights; i++) {
      aggregatedWeights[i] += model.weights[i] * weight;
    }
  }

  // Simulate performance metrics
  const avgAccuracy = localModels.reduce((sum, m) => sum + m.accuracy, 0) / localModels.length;

  return {
    version: `agg_${Date.now()}`,
    contributingClients: localModels.length,
    totalSamples,
    aggregatedWeights,
    performanceMetrics: {
      accuracy: avgAccuracy + 0.02, // Aggregation typically improves
      precision: avgAccuracy + 0.01,
      recall: avgAccuracy,
      f1Score: avgAccuracy + 0.015,
    },
    createdAt: new Date(),
  };
}

/**
 * Apply differential privacy to gradients
 */
export function applyDifferentialPrivacy(
  gradients: number[],
  epsilon: number,
  delta: number = 1e-5
): number[] {
  const sensitivity = 1.0; // Assuming normalized gradients
  const sigma = sensitivity * Math.sqrt(2 * Math.log(1.25 / delta)) / epsilon;
  
  return gradients.map(g => {
    // Add Gaussian noise
    const u1 = Math.random();
    const u2 = Math.random();
    const noise = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * sigma;
    return g + noise;
  });
}

/**
 * Check if organization can contribute to federated learning
 */
export function validateContribution(localModel: LocalModelState): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  
  if (localModel.trainingSamples < 100) {
    issues.push("Minimum 100 training samples required");
  }
  
  if (localModel.accuracy < 0.7) {
    issues.push("Local model accuracy too low (minimum 70%)");
  }
  
  if (localModel.weights.some(w => isNaN(w) || !isFinite(w))) {
    issues.push("Invalid weight values detected");
  }
  
  return {
    valid: issues.length === 0,
    issues,
  };
}

export interface FederatedLearningStatus {
  isParticipating: boolean;
  currentRound: number;
  totalRounds: number;
  localModel: LocalModelState | null;
  globalModelVersion: string;
  lastSync: Date | null;
  privacyGuarantee: string;
  dataRetention: "local_only" | "encrypted_aggregation";
}

/**
 * Get current federated learning status
 */
export function getFederatedStatus(): FederatedLearningStatus {
  return {
    isParticipating: false,
    currentRound: 0,
    totalRounds: 10,
    localModel: null,
    globalModelVersion: "v1.0.0",
    lastSync: null,
    privacyGuarantee: "Differential Privacy (ε=1.0)",
    dataRetention: "local_only",
  };
}
