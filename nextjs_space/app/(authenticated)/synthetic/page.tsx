"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  TestTube,
  Server,
  Database,
  Activity,
  Download,
  Loader2,
  FileText,
  AlertCircle,
  CheckCircle,
} from "lucide-react";

type LogSource = "windows_event" | "mssql" | "performance";
type OutputFormat = "csv" | "json" | "txt";

interface GeneratorConfig {
  logSource: LogSource;
  count: number;
  startDate: string;
  endDate: string;
  anomalyPercentage: number;
  outputFormat: OutputFormat;
}

const logSources: { value: LogSource; label: string; icon: typeof Server; description: string }[] = [
  { value: "windows_event", label: "Windows Event Logs", icon: Server, description: "System, Application, Security logs" },
  { value: "mssql", label: "MSSQL Logs", icon: Database, description: "Database engine, Query processor logs" },
  { value: "performance", label: "Performance Metrics", icon: Activity, description: "CPU, Memory, Disk, Network metrics" },
];

export default function SyntheticPage() {
  const [config, setConfig] = useState<GeneratorConfig>({
    logSource: "windows_event",
    count: 500,
    startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16),
    endDate: new Date().toISOString().slice(0, 16),
    anomalyPercentage: 15,
    outputFormat: "csv",
  });
  const [generating, setGenerating] = useState(false);
  const [generatedData, setGeneratedData] = useState<{
    content: string;
    fileName: string;
    recordCount: number;
    anomalyCount: number;
  } | null>(null);
  const [error, setError] = useState("");

  const handleGenerate = async () => {
    setGenerating(true);
    setError("");
    setGeneratedData(null);

    try {
      const res = await fetch("/api/generate-synthetic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });

      if (!res.ok) throw new Error("Failed to generate logs");
      const data = await res.json();
      setGeneratedData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = () => {
    if (!generatedData) return;

    const blob = new Blob([generatedData.content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = generatedData.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Synthetic Log Generator</h1>
        <p className="text-slate-600 mt-1">Generate realistic test data for Windows Server and MSSQL environments</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Configuration */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-xl shadow-sm p-6 space-y-6"
        >
          <h3 className="text-lg font-semibold text-slate-900">Configuration</h3>

          {/* Log Source */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-3">Log Source</label>
            <div className="space-y-2">
              {logSources.map((source) => (
                <button
                  key={source.value}
                  onClick={() => setConfig((prev) => ({ ...prev, logSource: source.value }))}
                  className={`w-full p-3 rounded-lg border-2 transition-all text-left flex items-center gap-3 ${
                    config.logSource === source.value
                      ? "border-blue-500 bg-blue-50"
                      : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <div className={`p-2 rounded-lg ${
                    config.logSource === source.value ? "bg-blue-100" : "bg-slate-100"
                  }`}>
                    <source.icon className={`w-4 h-4 ${
                      config.logSource === source.value ? "text-blue-600" : "text-slate-600"
                    }`} />
                  </div>
                  <div>
                    <p className="font-medium text-slate-900 text-sm">{source.label}</p>
                    <p className="text-xs text-slate-500">{source.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Record Count */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Number of Records: {config.count}
            </label>
            <input
              type="range"
              min="100"
              max="5000"
              step="100"
              value={config.count}
              onChange={(e) => setConfig((prev) => ({ ...prev, count: parseInt(e.target.value) }))}
              className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
            <div className="flex justify-between text-xs text-slate-500 mt-1">
              <span>100</span>
              <span>5,000</span>
            </div>
          </div>

          {/* Date Range */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Start Date</label>
              <input
                type="datetime-local"
                value={config.startDate}
                onChange={(e) => setConfig((prev) => ({ ...prev, startDate: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">End Date</label>
              <input
                type="datetime-local"
                value={config.endDate}
                onChange={(e) => setConfig((prev) => ({ ...prev, endDate: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          </div>

          {/* Anomaly Percentage */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Anomaly Percentage: {config.anomalyPercentage}%
            </label>
            <input
              type="range"
              min="0"
              max="50"
              value={config.anomalyPercentage}
              onChange={(e) => setConfig((prev) => ({ ...prev, anomalyPercentage: parseInt(e.target.value) }))}
              className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
            <div className="flex justify-between text-xs text-slate-500 mt-1">
              <span>0% (Normal)</span>
              <span>50% (High Anomaly)</span>
            </div>
          </div>

          {/* Output Format */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Output Format</label>
            <div className="flex gap-2">
              {(["csv", "json", "txt"] as OutputFormat[]).map((format) => (
                <button
                  key={format}
                  onClick={() => setConfig((prev) => ({ ...prev, outputFormat: format }))}
                  className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                    config.outputFormat === format
                      ? "bg-blue-600 text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {format.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Generate Button */}
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {generating ? (
              <><Loader2 className="w-5 h-5 animate-spin" /> Generating...</>
            ) : (
              <><TestTube className="w-5 h-5" /> Generate Synthetic Logs</>
            )}
          </button>
        </motion.div>

        {/* Results */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-xl shadow-sm p-6"
        >
          <h3 className="text-lg font-semibold text-slate-900 mb-4">Generated Output</h3>

          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
              <AlertCircle className="w-5 h-5" />
              {error}
            </div>
          )}

          {!generatedData && !error && (
            <div className="h-96 flex flex-col items-center justify-center text-slate-400">
              <FileText className="w-16 h-16 mb-4" />
              <p>Configure settings and generate synthetic logs</p>
            </div>
          )}

          {generatedData && (
            <div className="space-y-4">
              {/* Stats */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-blue-50 rounded-lg text-center">
                  <p className="text-2xl font-bold text-blue-700">{generatedData.recordCount}</p>
                  <p className="text-sm text-blue-600">Total Records</p>
                </div>
                <div className="p-4 bg-amber-50 rounded-lg text-center">
                  <p className="text-2xl font-bold text-amber-700">{generatedData.anomalyCount}</p>
                  <p className="text-sm text-amber-600">Anomaly Records</p>
                </div>
              </div>

              {/* Success Message */}
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-emerald-700">
                <CheckCircle className="w-5 h-5" />
                <span>Successfully generated {generatedData.fileName}</span>
              </div>

              {/* Preview */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Preview</label>
                <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg text-xs overflow-auto max-h-64 scrollbar-hide">
                  {generatedData.content.slice(0, 2000)}
                  {generatedData.content.length > 2000 && "\n..."}
                </pre>
              </div>

              {/* Download Button */}
              <button
                onClick={handleDownload}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-colors"
              >
                <Download className="w-5 h-5" />
                Download {generatedData.fileName}
              </button>
            </div>
          )}
        </motion.div>
      </div>

      {/* Info */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-slate-100 rounded-xl p-6"
      >
        <h3 className="text-lg font-semibold text-slate-900 mb-3">About Synthetic Data</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div className="bg-white rounded-lg p-4">
            <p className="font-medium text-slate-900 mb-2">Windows Event Logs</p>
            <p className="text-slate-600">Includes System, Application, Security events with realistic error patterns and timestamps.</p>
          </div>
          <div className="bg-white rounded-lg p-4">
            <p className="font-medium text-slate-900 mb-2">MSSQL Logs</p>
            <p className="text-slate-600">Database engine logs with deadlocks, timeouts, connection issues, and performance warnings.</p>
          </div>
          <div className="bg-white rounded-lg p-4">
            <p className="font-medium text-slate-900 mb-2">Performance Metrics</p>
            <p className="text-slate-600">CPU, Memory, Disk, Network metrics with normal and anomalous patterns.</p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}