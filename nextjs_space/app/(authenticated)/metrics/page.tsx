"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  BarChart3,
  Loader2,
  RefreshCw,
  Target,
  TrendingUp,
  Activity,
  Brain,
} from "lucide-react";
import { useSession } from "next-auth/react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from "recharts";

interface MetricsData {
  metrics: {
    accuracy: number;
    precision: number;
    recall: number;
    f1Score: number;
    confusionMatrix: {
      truePositives: number;
      falsePositives: number;
      trueNegatives: number;
      falseNegatives: number;
    };
  };
  modelVersions: any[];
  severityDistribution: Record<string, number>;
  typeDistribution: Record<string, number>;
  dailyPredictions: { date: string; total: number; anomalies: number }[];
}

const COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e"];

export default function MetricsPage() {
  const { data: session } = useSession() || {};
  const [data, setData] = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [retraining, setRetraining] = useState(false);
  const [retrainMessage, setRetrainMessage] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const fetchMetrics = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/metrics");
      if (!res.ok) throw new Error("Failed to fetch");
      const json = await res.json();
      setData(json);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleRetrain = async () => {
    setRetraining(true);
    setRetrainMessage("");
    try {
      const res = await fetch("/api/retrain", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to retrain");
      setRetrainMessage(`Model ${json?.modelVersion} trained successfully!`);
      fetchMetrics();
    } catch (error: any) {
      setRetrainMessage(error?.message ?? "Retraining failed");
    } finally {
      setRetraining(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
  }, []);

  const severityChartData = data?.severityDistribution
    ? Object.entries(data.severityDistribution).map(([name, value]) => ({ name, value }))
    : [];

  const typeChartData = data?.typeDistribution
    ? Object.entries(data.typeDistribution).map(([name, value]) => ({ name, value }))
    : [];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Performance Metrics</h1>
          <p className="text-slate-600 mt-1">Model accuracy, precision, recall, and trends</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchMetrics}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          {(session?.user as any)?.role === "admin" && (
            <button
              onClick={handleRetrain}
              disabled={retraining}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {retraining ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Brain className="w-4 h-4" />
              )}
              Retrain Model
            </button>
          )}
        </div>
      </div>

      {retrainMessage && (
        <div className={`p-4 rounded-lg ${
          retrainMessage.includes("successfully") ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
        }`}>
          {retrainMessage}
        </div>
      )}

      {/* Key Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Accuracy", value: data?.metrics?.accuracy ?? 0, icon: Target, color: "blue" },
          { label: "Precision", value: data?.metrics?.precision ?? 0, icon: TrendingUp, color: "emerald" },
          { label: "Recall", value: data?.metrics?.recall ?? 0, icon: Activity, color: "purple" },
          { label: "F1 Score", value: data?.metrics?.f1Score ?? 0, icon: BarChart3, color: "orange" },
        ].map((metric) => (
          <motion.div
            key={metric.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-xl shadow-sm p-6"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-slate-500">{metric.label}</span>
              <div className={`p-2 rounded-lg bg-${metric.color}-100`}>
                <metric.icon className={`w-4 h-4 text-${metric.color}-600`} />
              </div>
            </div>
            <p className="text-3xl font-bold text-slate-900">{metric.value.toFixed(1)}%</p>
            <div className="mt-2 h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full bg-${metric.color}-500`}
                style={{ width: `${Math.min(metric.value, 100)}%` }}
              />
            </div>
          </motion.div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Severity Distribution */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-xl shadow-sm p-6"
        >
          <h3 className="text-lg font-semibold text-slate-900 mb-4">Severity Distribution</h3>
          <div className="h-64">
            {mounted && severityChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={severityChartData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={({ name, percent }: { name: string; percent: number }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  >
                    {severityChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-400">
                {mounted ? "No data available" : "Loading chart..."}
              </div>
            )}
          </div>
        </motion.div>

        {/* Type Distribution */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white rounded-xl shadow-sm p-6"
        >
          <h3 className="text-lg font-semibold text-slate-900 mb-4">Prediction Types</h3>
          <div className="h-64">
            {mounted && typeChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={typeChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-400">
                {mounted ? "No data available" : "Loading chart..."}
              </div>
            )}
          </div>
        </motion.div>
      </div>

      {/* Daily Predictions Trend */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="bg-white rounded-xl shadow-sm p-6"
      >
        <h3 className="text-lg font-semibold text-slate-900 mb-4">Predictions Over Time (Last 30 Days)</h3>
        <div className="h-72">
          {mounted && (data?.dailyPredictions?.length ?? 0) > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data?.dailyPredictions} margin={{ top: 10, right: 10, left: 0, bottom: 40 }}>
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  angle={-45}
                  textAnchor="end"
                  height={60}
                />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} />
                <Tooltip />
                <Legend verticalAlign="top" wrapperStyle={{ fontSize: 11 }} />
                <Line
                  type="monotone"
                  dataKey="total"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={false}
                  name="Total"
                />
                <Line
                  type="monotone"
                  dataKey="anomalies"
                  stroke="#ef4444"
                  strokeWidth={2}
                  dot={false}
                  name="Anomalies"
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-slate-400">
              {mounted ? "No prediction data available" : "Loading chart..."}
            </div>
          )}
        </div>
      </motion.div>

      {/* Confusion Matrix */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="bg-white rounded-xl shadow-sm p-6"
      >
        <h3 className="text-lg font-semibold text-slate-900 mb-4">Confusion Matrix</h3>
        <div className="grid grid-cols-2 gap-4 max-w-md mx-auto">
          <div className="p-6 bg-emerald-50 rounded-lg text-center">
            <p className="text-3xl font-bold text-emerald-700">
              {data?.metrics?.confusionMatrix?.truePositives ?? 0}
            </p>
            <p className="text-sm text-emerald-600 mt-1">True Positives</p>
          </div>
          <div className="p-6 bg-red-50 rounded-lg text-center">
            <p className="text-3xl font-bold text-red-700">
              {data?.metrics?.confusionMatrix?.falsePositives ?? 0}
            </p>
            <p className="text-sm text-red-600 mt-1">False Positives</p>
          </div>
          <div className="p-6 bg-amber-50 rounded-lg text-center">
            <p className="text-3xl font-bold text-amber-700">
              {data?.metrics?.confusionMatrix?.falseNegatives ?? 0}
            </p>
            <p className="text-sm text-amber-600 mt-1">False Negatives</p>
          </div>
          <div className="p-6 bg-blue-50 rounded-lg text-center">
            <p className="text-3xl font-bold text-blue-700">
              {data?.metrics?.confusionMatrix?.trueNegatives ?? 0}
            </p>
            <p className="text-sm text-blue-600 mt-1">True Negatives</p>
          </div>
        </div>
        <p className="text-sm text-slate-500 text-center mt-4">
          Based on user feedback data. Submit more feedback to improve accuracy.
        </p>
      </motion.div>

      {/* Model Versions */}
      {(data?.modelVersions?.length ?? 0) > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="bg-white rounded-xl shadow-sm p-6"
        >
          <h3 className="text-lg font-semibold text-slate-900 mb-4">Model Version History</h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-slate-900">Version</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-slate-900">Trained At</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-slate-900">Training Samples</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-slate-900">Feedback</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data?.modelVersions?.map((version: any) => (
                  <tr key={version.version} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-blue-600">{version.version}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {new Date(version.trainedAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-slate-900">{version.trainingSamples}</td>
                    <td className="px-4 py-3 text-slate-900">{version.feedbackIncluded}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}
    </div>
  );
}