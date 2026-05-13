"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Shield,
  Cloud,
  Lock,
  Server,
  Users,
  Zap,
  Check,
  Download,
  Upload,
  RefreshCw,
  Globe,
  Database,
  Activity,
} from "lucide-react";

interface IndustryBaseline {
  id: string;
  name: string;
  description: string;
  industry: string;
  contributingOrgs: number;
  version: string;
  accuracy: number;
  supportedLogTypes: string[];
  modelSize: number;
  lastUpdated: string;
}

interface LocalTrainingStatus {
  isTraining: boolean;
  progress: number;
  samplesProcessed: number;
  currentAccuracy: number;
  privacyBudgetUsed: number;
}

const INDUSTRY_BASELINES: IndustryBaseline[] = [
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
    lastUpdated: "2026-02-15",
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
    lastUpdated: "2026-02-01",
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
    lastUpdated: "2026-02-20",
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
    lastUpdated: "2026-01-28",
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
    lastUpdated: "2026-02-10",
  },
];

export default function FederatedLearningPage() {
  const [activeBaseline, setActiveBaseline] = useState<string | null>(null);
  const [isParticipating, setIsParticipating] = useState(false);
  const [localTraining, setLocalTraining] = useState<LocalTrainingStatus>({
    isTraining: false,
    progress: 0,
    samplesProcessed: 0,
    currentAccuracy: 0.85,
    privacyBudgetUsed: 0,
  });

  // Simulate local training
  useEffect(() => {
    if (localTraining.isTraining && localTraining.progress < 100) {
      const timer = setTimeout(() => {
        setLocalTraining(prev => ({
          ...prev,
          progress: Math.min(prev.progress + 5, 100),
          samplesProcessed: prev.samplesProcessed + Math.floor(Math.random() * 50) + 10,
          currentAccuracy: Math.min(prev.currentAccuracy + 0.002, 0.95),
          privacyBudgetUsed: prev.privacyBudgetUsed + 0.02,
        }));
      }, 300);
      return () => clearTimeout(timer);
    } else if (localTraining.progress >= 100) {
      setLocalTraining(prev => ({ ...prev, isTraining: false }));
    }
  }, [localTraining.isTraining, localTraining.progress]);

  const startLocalTraining = () => {
    setLocalTraining({
      isTraining: true,
      progress: 0,
      samplesProcessed: 0,
      currentAccuracy: 0.85,
      privacyBudgetUsed: 0,
    });
  };

  const applyBaseline = (baselineId: string) => {
    setActiveBaseline(baselineId);
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Shield className="w-7 h-7 text-blue-600" />
          Federated Learning
        </h1>
        <p className="text-slate-600 mt-1">
          Privacy-preserving AI that keeps your data local while benefiting from collective intelligence
        </p>
      </div>

      {/* Key Benefits */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-5 border border-green-200"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <Lock className="w-5 h-5 text-green-600" />
            </div>
            <h3 className="font-semibold text-green-900">Data Never Leaves</h3>
          </div>
          <p className="text-sm text-green-800">
            Your logs and sensitive data stay on your infrastructure. Only encrypted model weights are shared.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-5 border border-blue-200"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Users className="w-5 h-5 text-blue-600" />
            </div>
            <h3 className="font-semibold text-blue-900">Collective Intelligence</h3>
          </div>
          <p className="text-sm text-blue-800">
            Benefit from patterns learned across thousands of organizations without exposing anyone&apos;s data.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-gradient-to-br from-purple-50 to-violet-50 rounded-xl p-5 border border-purple-200"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-purple-100 rounded-lg">
              <Zap className="w-5 h-5 text-purple-600" />
            </div>
            <h3 className="font-semibold text-purple-900">Better Predictions</h3>
          </div>
          <p className="text-sm text-purple-800">
            Industry-specific baselines provide superior detection accuracy from day one.
          </p>
        </motion.div>
      </div>

      {/* Local Training Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="bg-white rounded-xl shadow-sm p-6"
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <Server className="w-5 h-5 text-slate-600" />
              Local Model Training
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Train on your local data with differential privacy protection
            </p>
          </div>
          <button
            onClick={startLocalTraining}
            disabled={localTraining.isTraining}
            className={`px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors ${
              localTraining.isTraining
                ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700 text-white"
            }`}
          >
            {localTraining.isTraining ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Training...
              </>
            ) : (
              <>
                <Zap className="w-4 h-4" />
                Start Training
              </>
            )}
          </button>
        </div>

        {/* Training Progress */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-slate-50 rounded-lg p-4">
            <p className="text-xs text-slate-500 mb-1">Progress</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-600 transition-all"
                  style={{ width: `${localTraining.progress}%` }}
                />
              </div>
              <span className="text-sm font-medium text-slate-700">{localTraining.progress}%</span>
            </div>
          </div>
          <div className="bg-slate-50 rounded-lg p-4">
            <p className="text-xs text-slate-500 mb-1">Samples Processed</p>
            <p className="text-xl font-semibold text-slate-900">
              {localTraining.samplesProcessed.toLocaleString()}
            </p>
          </div>
          <div className="bg-slate-50 rounded-lg p-4">
            <p className="text-xs text-slate-500 mb-1">Local Accuracy</p>
            <p className="text-xl font-semibold text-green-600">
              {(localTraining.currentAccuracy * 100).toFixed(1)}%
            </p>
          </div>
          <div className="bg-slate-50 rounded-lg p-4">
            <p className="text-xs text-slate-500 mb-1">Privacy Budget Used</p>
            <p className="text-xl font-semibold text-slate-900">
              ε = {localTraining.privacyBudgetUsed.toFixed(2)}
            </p>
          </div>
        </div>

        {/* Privacy Guarantee */}
        <div className="flex items-start gap-3 bg-green-50 rounded-lg p-4 border border-green-200">
          <Shield className="w-5 h-5 text-green-600 mt-0.5" />
          <div>
            <p className="font-medium text-green-900">Differential Privacy Enabled</p>
            <p className="text-sm text-green-700 mt-1">
              All model updates are protected with (ε=1.0, δ=10⁻⁵) differential privacy,
              providing mathematically proven privacy guarantees.
            </p>
          </div>
        </div>
      </motion.div>

      {/* Contribute Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="bg-white rounded-xl shadow-sm p-6"
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <Cloud className="w-5 h-5 text-slate-600" />
              Contribute to Global Model
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Share model weights (not data) to improve predictions for everyone
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${
              isParticipating
                ? "bg-green-100 text-green-700"
                : "bg-slate-100 text-slate-600"
            }`}>
              {isParticipating ? "Participating" : "Not Participating"}
            </span>
            <button
              onClick={() => setIsParticipating(!isParticipating)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                isParticipating
                  ? "bg-slate-100 hover:bg-slate-200 text-slate-700"
                  : "bg-green-600 hover:bg-green-700 text-white"
              }`}
            >
              {isParticipating ? "Opt Out" : "Join Federation"}
            </button>
          </div>
        </div>

        {isParticipating && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
              <div className="flex items-center gap-2 mb-2">
                <Upload className="w-4 h-4 text-blue-600" />
                <p className="text-sm font-medium text-blue-900">Your Contribution</p>
              </div>
              <p className="text-2xl font-bold text-blue-700">3 rounds</p>
              <p className="text-xs text-blue-600 mt-1">Last sync: 2 hours ago</p>
            </div>
            <div className="bg-purple-50 rounded-lg p-4 border border-purple-200">
              <div className="flex items-center gap-2 mb-2">
                <Globe className="w-4 h-4 text-purple-600" />
                <p className="text-sm font-medium text-purple-900">Global Participants</p>
              </div>
              <p className="text-2xl font-bold text-purple-700">247</p>
              <p className="text-xs text-purple-600 mt-1">Organizations worldwide</p>
            </div>
            <div className="bg-green-50 rounded-lg p-4 border border-green-200">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4 text-green-600" />
                <p className="text-sm font-medium text-green-900">Model Improvement</p>
              </div>
              <p className="text-2xl font-bold text-green-700">+4.2%</p>
              <p className="text-xs text-green-600 mt-1">Since joining</p>
            </div>
          </div>
        )}
      </motion.div>

      {/* Industry Baselines */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="bg-white rounded-xl shadow-sm p-6"
      >
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Database className="w-5 h-5 text-slate-600" />
            Industry Baseline Models
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Pre-trained models from aggregated industry data - no proprietary information exposed
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {INDUSTRY_BASELINES.map((baseline) => (
            <div
              key={baseline.id}
              className={`rounded-lg border-2 p-4 transition-all cursor-pointer ${
                activeBaseline === baseline.id
                  ? "border-blue-500 bg-blue-50"
                  : "border-slate-200 hover:border-slate-300"
              }`}
              onClick={() => setActiveBaseline(baseline.id)}
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-slate-900">{baseline.name}</h3>
                  <p className="text-xs text-slate-500">{baseline.industry}</p>
                </div>
                {activeBaseline === baseline.id && (
                  <Check className="w-5 h-5 text-blue-600" />
                )}
              </div>
              <p className="text-sm text-slate-600 mb-3">{baseline.description}</p>
              <div className="flex flex-wrap gap-1 mb-3">
                {baseline.supportedLogTypes.slice(0, 3).map((type) => (
                  <span
                    key={type}
                    className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded"
                  >
                    {type}
                  </span>
                ))}
                {baseline.supportedLogTypes.length > 3 && (
                  <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded">
                    +{baseline.supportedLogTypes.length - 3}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-green-600 font-medium">
                  {(baseline.accuracy * 100).toFixed(0)}% accuracy
                </span>
                <span className="text-slate-500">
                  {baseline.contributingOrgs} orgs
                </span>
              </div>
              {activeBaseline === baseline.id && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    applyBaseline(baseline.id);
                  }}
                  className="w-full mt-3 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  Apply Baseline
                </button>
              )}
            </div>
          ))}
        </div>
      </motion.div>

      {/* How It Works */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl p-6 border border-slate-200"
      >
        <h2 className="text-lg font-semibold text-slate-900 mb-4">How Federated Learning Works</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            {
              step: 1,
              title: "Local Training",
              desc: "Model trains on your data locally",
              icon: Server,
            },
            {
              step: 2,
              title: "Privacy Protection",
              desc: "Differential privacy applied to weights",
              icon: Lock,
            },
            {
              step: 3,
              title: "Secure Aggregation",
              desc: "Encrypted weights combined globally",
              icon: Cloud,
            },
            {
              step: 4,
              title: "Improved Model",
              desc: "Better predictions for everyone",
              icon: Zap,
            },
          ].map((item) => (
            <div key={item.step} className="flex items-start gap-3">
              <div className="flex-shrink-0 w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-sm">
                {item.step}
              </div>
              <div>
                <h3 className="font-medium text-slate-900">{item.title}</h3>
                <p className="text-sm text-slate-600">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
