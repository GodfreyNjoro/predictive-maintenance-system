"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  FileText,
  AlertTriangle,
  CheckCircle,
  XCircle,
  RefreshCw,
  Clock,
  TrendingUp,
  Zap,
  Shield,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import RootCauseAnalysis, {
  ExplainablePrediction,
} from "./_components/root-cause-analysis";
import ApplicationFilterChips from "@/components/application-filter-chips";

interface SourceHealth {
  sourceName: string;
  status: "healthy" | "warning" | "critical";
  score: number;
  issues: string[];
}

interface DynamicAnalysis {
  isAnomaly: boolean;
  anomalyScore: number;
  confidence: number;
  severity: "critical" | "high" | "medium" | "low";
  predictionType: "failure" | "degradation" | "normal";
  overallSystemHealth: number;
  description: string;
  sourceAnalysis: { [sourceName: string]: SourceHealth };
  correlationInsights: {
    crossSourceCorrelation: string;
    cascadeRisk: string;
    temporalClustering: string;
  };
  recommendations: string[];
}

interface LogSummary {
  sources: { [sourceName: string]: number };
  total: number;
  timeRange: { start: string; end: string } | null;
}

export default function SystemAnalysisPage() {
  const [analysis, setAnalysis] = useState<DynamicAnalysis | null>(null);
  const [explanation, setExplanation] = useState<ExplainablePrediction | null>(
    null
  );
  const [logSummary, setLogSummary] = useState<LogSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [hoursBack, setHoursBack] = useState(24);
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState({
    correlation: false,
    recommendations: false,
  });

  const fetchAnalysis = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ hours: String(hoursBack) });
      if (applicationId) params.set("applicationId", applicationId);
      const res = await fetch(`/api/system-analysis?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setAnalysis(data.analysis);
        setExplanation(data.explanation ?? null);
        setLogSummary(data.logSummary);
      }
    } catch (error) {
      console.error("Failed to fetch analysis:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoursBack, applicationId]);

  const getHealthColor = (score: number) => {
    if (score >= 75) return "text-green-700";
    if (score >= 50) return "text-yellow-700";
    return "text-red-700";
  };

  const getHealthBgColor = (score: number) => {
    if (score >= 75) return "bg-green-50 border-green-300";
    if (score >= 50) return "bg-yellow-50 border-yellow-300";
    return "bg-red-50 border-red-300";
  };

  const getStatusIcon = (status: "healthy" | "warning" | "critical") => {
    switch (status) {
      case "healthy":
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case "warning":
        return <AlertTriangle className="w-5 h-5 text-yellow-600" />;
      case "critical":
        return <XCircle className="w-5 h-5 text-red-600" />;
    }
  };

  const getSeverityBadge = (severity: string) => {
    const colors: Record<string, string> = {
      critical: "bg-red-100 text-red-800 border-red-300",
      high: "bg-orange-100 text-orange-800 border-orange-300",
      medium: "bg-yellow-100 text-yellow-800 border-yellow-300",
      low: "bg-green-100 text-green-800 border-green-300",
    };
    return colors[severity] || colors.low;
  };

  const toggleSection = (section: "correlation" | "recommendations") => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const getSourceColor = (sourceName: string) => {
    const colors = [
      "bg-blue-100 text-blue-700",
      "bg-purple-100 text-purple-700",
      "bg-green-100 text-green-700",
      "bg-orange-100 text-orange-700",
      "bg-pink-100 text-pink-700",
      "bg-cyan-100 text-cyan-700",
      "bg-indigo-100 text-indigo-700",
      "bg-yellow-100 text-yellow-700",
    ];
    const hash = sourceName.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return colors[hash % colors.length];
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Shield className="w-7 h-7 text-blue-600" />
            Unified System Analysis
          </h1>
          <p className="text-slate-600 mt-1">
            Combined analysis across all log sources
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={hoursBack}
            onChange={(e) => setHoursBack(parseInt(e.target.value))}
            className="bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-900 text-sm"
          >
            <option value={6}>Last 6 hours</option>
            <option value={12}>Last 12 hours</option>
            <option value={24}>Last 24 hours</option>
            <option value={48}>Last 48 hours</option>
            <option value={168}>Last 7 days</option>
          </select>
          <button
            onClick={fetchAnalysis}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-white text-sm font-medium transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Cross-application filter chips */}
      <div className="bg-white rounded-xl shadow-sm p-4 border border-slate-200">
        <ApplicationFilterChips
          storageKey="pms.systemAnalysis.applicationId"
          onChange={setApplicationId}
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
        </div>
      ) : analysis ? (
        <>
          {/* Overall Health Score */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className={`p-6 rounded-xl border ${getHealthBgColor(analysis.overallSystemHealth)}`}
          >
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
              <div className="flex items-center gap-6">
                <div className="relative">
                  <svg className="w-28 h-28 transform -rotate-90">
                    <circle
                      cx="56"
                      cy="56"
                      r="48"
                      stroke="currentColor"
                      strokeWidth="8"
                      fill="none"
                      className="text-slate-300"
                    />
                    <circle
                      cx="56"
                      cy="56"
                      r="48"
                      stroke="currentColor"
                      strokeWidth="8"
                      fill="none"
                      strokeDasharray={`${(analysis.overallSystemHealth / 100) * 301.59} 301.59`}
                      className={getHealthColor(analysis.overallSystemHealth)}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className={`text-3xl font-bold ${getHealthColor(analysis.overallSystemHealth)}`}>
                      {analysis.overallSystemHealth}
                    </span>
                  </div>
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-slate-900">System Health Score</h2>
                  <p className="text-slate-700 mt-1 max-w-md">{analysis.description}</p>
                  <div className="flex items-center gap-3 mt-3">
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-medium border ${getSeverityBadge(
                        analysis.severity
                      )}`}
                    >
                      {analysis.severity.toUpperCase()}
                    </span>
                    <span className="text-slate-600 text-sm">
                      Confidence: {(analysis.confidence * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>
              {logSummary && (
                <div className="bg-white rounded-lg p-4 min-w-[200px] border border-slate-200 shadow-sm">
                  <h3 className="text-sm font-medium text-slate-700 mb-2 flex items-center gap-2">
                    <Clock className="w-4 h-4" /> Logs Analyzed
                  </h3>
                  <div className="space-y-1 text-sm">
                    {Object.entries(logSummary.sources).map(([source, count]) => (
                      <div key={source} className="flex justify-between">
                        <span className="text-slate-600">{source}:</span>
                        <span className="text-slate-900 font-medium">{count}</span>
                      </div>
                    ))}
                    <div className="border-t border-slate-200 pt-1 mt-1 flex justify-between">
                      <span className="text-slate-700">Total:</span>
                      <span className="text-slate-900 font-bold">{logSummary.total}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </motion.div>

          {/* Dynamic Source Health Cards */}
          {Object.keys(analysis.sourceAnalysis).length > 0 && (
            <div className={`grid grid-cols-1 ${Object.keys(analysis.sourceAnalysis).length === 1 ? "md:grid-cols-1" : Object.keys(analysis.sourceAnalysis).length === 2 ? "md:grid-cols-2" : "md:grid-cols-3"} gap-4`}>
              {Object.entries(analysis.sourceAnalysis).map(([sourceName, health], index) => (
                <motion.div
                  key={sourceName}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 * (index + 1) }}
                  className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm"
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${getSourceColor(sourceName)}`}>
                        <FileText className="w-5 h-5" />
                      </div>
                      <h3 className="font-semibold text-slate-900">{sourceName}</h3>
                    </div>
                    {getStatusIcon(health.status)}
                  </div>
                  <div className="mb-3">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-slate-700 font-medium">Health Score</span>
                      <span className={`font-bold ${getHealthColor(health.score)}`}>
                        {health.score}%
                      </span>
                    </div>
                    <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${health.score >= 75 ? "bg-green-500" : health.score >= 50 ? "bg-yellow-500" : "bg-red-500"}`}
                        style={{ width: `${health.score}%` }}
                      />
                    </div>
                  </div>
                  {health.issues.length > 0 ? (
                    <ul className="space-y-1">
                      {health.issues.map((issue, i) => (
                        <li key={i} className="text-sm text-slate-700 flex items-start gap-2">
                          <AlertTriangle className="w-3 h-3 text-yellow-600 mt-1 flex-shrink-0" />
                          {issue}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-green-700 flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-600" /> No issues detected
                    </p>
                  )}
                </motion.div>
              ))}
            </div>
          )}

          {Object.keys(analysis.sourceAnalysis).length === 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center shadow-sm">
              <FileText className="w-12 h-12 mx-auto mb-3 text-slate-400" />
              <p className="text-slate-600">No log sources analyzed yet. Upload logs to begin analysis.</p>
            </div>
          )}

          {/* Refined Root-Cause Analysis (Explainable AI) */}
          {explanation && <RootCauseAnalysis explanation={explanation} />}

          {/* Correlation Insights */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm"
          >
            <button
              onClick={() => toggleSection("correlation")}
              className="w-full p-5 flex items-center justify-between hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Zap className="w-5 h-5 text-yellow-600" />
                <h3 className="font-semibold text-slate-900">Cross-Source Correlation Insights</h3>
              </div>
              {expandedSections.correlation ? (
                <ChevronUp className="w-5 h-5 text-slate-500" />
              ) : (
                <ChevronDown className="w-5 h-5 text-slate-500" />
              )}
            </button>
            {expandedSections.correlation && (
              <div className="px-5 pb-5 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                    <h4 className="text-sm font-medium text-slate-700 mb-2">Cross-Source Correlation</h4>
                    <p className="text-sm text-slate-800">{analysis.correlationInsights.crossSourceCorrelation}</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                    <h4 className="text-sm font-medium text-slate-700 mb-2">Cascade Risk</h4>
                    <p className="text-sm text-slate-800">{analysis.correlationInsights.cascadeRisk}</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                    <h4 className="text-sm font-medium text-slate-700 mb-2">Temporal Clustering</h4>
                    <p className="text-sm text-slate-800">{analysis.correlationInsights.temporalClustering}</p>
                  </div>
                </div>
              </div>
            )}
          </motion.div>

          {/* Recommendations */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm"
          >
            <button
              onClick={() => toggleSection("recommendations")}
              className="w-full p-5 flex items-center justify-between hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <TrendingUp className="w-5 h-5 text-blue-600" />
                <h3 className="font-semibold text-slate-900">Recommendations</h3>
                <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full">
                  {analysis.recommendations.length}
                </span>
              </div>
              {expandedSections.recommendations ? (
                <ChevronUp className="w-5 h-5 text-slate-500" />
              ) : (
                <ChevronDown className="w-5 h-5 text-slate-500" />
              )}
            </button>
            {expandedSections.recommendations && (
              <div className="px-5 pb-5">
                <ul className="space-y-3">
                  {analysis.recommendations.map((rec, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg text-sm text-slate-700 border border-slate-200"
                    >
                      <span className="text-lg">{rec.split(" ")[0]}</span>
                      <span>{rec.split(" ").slice(1).join(" ")}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </motion.div>
        </>
      ) : (
        <div className="text-center py-20 text-slate-500">
          <Activity className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>No analysis data available</p>
        </div>
      )}
    </div>
  );
}
