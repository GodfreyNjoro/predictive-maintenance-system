"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  FileText,
  Activity,
  AlertTriangle,
  CheckCircle,
  Clock,
  RefreshCw,
  Server,
  Database,
  HardDrive,
  Wifi,
  Loader2,
} from "lucide-react";
import { StatCard } from "@/components/stat-card";
import { HealthGauge } from "@/components/health-gauge";
import { RecentActivityChart } from "./recent-activity-chart";
import { AlertsOverview } from "./alerts-overview";
import ApplicationFilterChips from "@/components/application-filter-chips";

interface DashboardData {
  overview: {
    totalFiles: number;
    processedFiles: number;
    totalPredictions: number;
    recentPredictions: number;
    healthScore: number;
  };
  alerts: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  model: {
    version: string;
    trainedAt: string | null;
    trainingSamples: number;
    feedbackIncluded: number;
  };
  feedback: {
    total: number;
    truePositives: number;
    falsePositives: number;
    accuracy: number;
  };
  logStats: Record<string, number>;
  recentActivity: any[];
}

export function DashboardClient() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [applicationId, setApplicationId] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (applicationId) params.set("applicationId", applicationId);
      const qs = params.toString();
      const res = await fetch(qs ? `/api/dashboard?${qs}` : "/api/dashboard");
      if (!res.ok) throw new Error("Failed to fetch");
      const json = await res.json();
      setData(json);
      setError("");
    } catch (err) {
      setError("Failed to load dashboard data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">System Dashboard</h1>
          <p className="text-slate-600 mt-1">Monitor infrastructure health and predictions</p>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Cross-application filter chips */}
      <div className="bg-white rounded-xl shadow-sm p-4">
        <ApplicationFilterChips
          storageKey="pms.dashboard.applicationId"
          onChange={setApplicationId}
        />
      </div>

      {error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          {error}
        </div>
      ) : loading || !data ? (
        <div className="flex items-center justify-center h-64 bg-white rounded-xl shadow-sm">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        </div>
      ) : (
        <DashboardBody data={data} />
      )}
    </div>
  );
}

function DashboardBody({ data }: { data: DashboardData }) {
  return (
    <div className="space-y-8">
      {/* Health Score & Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Health Gauge */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="bg-white rounded-xl shadow-sm p-6 flex flex-col items-center justify-center"
        >
          <h3 className="text-sm font-medium text-slate-500 mb-4">System Health Score</h3>
          <HealthGauge score={data?.overview?.healthScore ?? 0} />
          <p className="text-sm text-slate-500 mt-4 text-center">
            Based on {data?.overview?.totalPredictions ?? 0} predictions
          </p>
        </motion.div>

        {/* Stats Grid */}
        <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard
            title="Files Uploaded"
            value={data?.overview?.totalFiles ?? 0}
            icon={FileText}
            color="blue"
            delay={0.1}
          />
          <StatCard
            title="Processed"
            value={data?.overview?.processedFiles ?? 0}
            icon={CheckCircle}
            color="green"
            delay={0.2}
          />
          <StatCard
            title="Total Predictions"
            value={data?.overview?.totalPredictions ?? 0}
            icon={Activity}
            color="slate"
            delay={0.3}
          />
          <StatCard
            title="Last 24h"
            value={data?.overview?.recentPredictions ?? 0}
            icon={Clock}
            color="yellow"
            delay={0.4}
          />
        </div>
      </div>

      {/* Alerts & Model Info */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Alerts Overview */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="bg-white rounded-xl shadow-sm p-6"
        >
          <h3 className="text-lg font-semibold text-slate-900 mb-4">Active Alerts</h3>
          <AlertsOverview alerts={data?.alerts ?? { critical: 0, high: 0, medium: 0, low: 0 }} />
        </motion.div>

        {/* Model Info */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="bg-white rounded-xl shadow-sm p-6"
        >
          <h3 className="text-lg font-semibold text-slate-900 mb-4">Model Information</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <span className="text-slate-600">Active Version</span>
              <span className="font-mono font-semibold text-blue-600">
                {data?.model?.version ?? "v1.0.0"}
              </span>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <span className="text-slate-600">Training Samples</span>
              <span className="font-semibold text-slate-900">
                {data?.model?.trainingSamples?.toLocaleString() ?? 0}
              </span>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <span className="text-slate-600">Feedback Included</span>
              <span className="font-semibold text-slate-900">
                {data?.model?.feedbackIncluded ?? 0}
              </span>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <span className="text-slate-600">Model Accuracy</span>
              <span className="font-semibold text-emerald-600">
                {(data?.feedback?.accuracy ?? 0).toFixed(1)}%
              </span>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Recent Activity Chart */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.4 }}
        className="bg-white rounded-xl shadow-sm p-6"
      >
        <h3 className="text-lg font-semibold text-slate-900 mb-4">Recent Prediction Activity</h3>
        <RecentActivityChart data={data?.recentActivity ?? []} />
      </motion.div>

      {/* System Components */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.5 }}
        className="bg-white rounded-xl shadow-sm p-6"
      >
        <h3 className="text-lg font-semibold text-slate-900 mb-4">Monitored Systems</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { name: "Windows Server", icon: Server, status: "healthy" },
            { name: "MSSQL Database", icon: Database, status: "healthy" },
            { name: "Storage", icon: HardDrive, status: "healthy" },
            { name: "Network", icon: Wifi, status: "healthy" },
          ].map((system) => (
            <div
              key={system.name}
              className="flex items-center gap-3 p-4 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <div className="p-2 bg-emerald-100 rounded-lg">
                <system.icon className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <p className="font-medium text-slate-900 text-sm">{system.name}</p>
                <p className="text-xs text-emerald-600 capitalize">{system.status}</p>
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}