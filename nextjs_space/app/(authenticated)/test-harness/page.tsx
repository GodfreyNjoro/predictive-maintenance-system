"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  TestTube,
  Play,
  Loader2,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Server,
  Database,
  Network,
  Globe,
  Activity,
  FileText,
  Monitor,
  HardDrive,
  Hourglass,
  BarChart3,
  ArrowRight,
  Zap,
  RefreshCw,
} from "lucide-react";

type Scenario = "healthy" | "degraded" | "critical";

interface FeedOption {
  id: string;
  label: string;
  group: "db" | "app";
  icon: typeof Database;
  description: string;
}

const FEED_OPTIONS: FeedOption[] = [
  // DB feeds
  { id: "jobHistory", label: "Job History", group: "db", icon: Database, description: "SQL Agent scheduled job results" },
  { id: "queryStore", label: "Query Store", group: "db", icon: BarChart3, description: "Query performance statistics" },
  { id: "spExec", label: "Stored Procedures", group: "db", icon: FileText, description: "SP execution audit" },
  { id: "waitStats", label: "Wait Statistics", group: "db", icon: Hourglass, description: "DMV wait type counters" },
  { id: "ioStats", label: "IO Statistics", group: "db", icon: HardDrive, description: "File-level IO latency" },
  { id: "xevents", label: "XEvents", group: "db", icon: Zap, description: "Deadlocks, timeouts, failures" },
  { id: "errorLog", label: "Error Log", group: "db", icon: AlertTriangle, description: "Database error log entries" },
  { id: "osMetrics", label: "OS Metrics", group: "db", icon: Monitor, description: "CPU / RAM / disk from DB host" },
  // App feeds
  { id: "appMetrics", label: "App Metrics", group: "app", icon: Activity, description: "Response time, error rate, threads" },
  { id: "appLogs", label: "App Logs", group: "app", icon: FileText, description: "Structured application logs" },
  { id: "windowsEventLog", label: "Windows Events", group: "app", icon: Server, description: "Windows Event Log entries" },
  { id: "iisLogs", label: "IIS Access Logs", group: "app", icon: Globe, description: "HTTP status, latency, queues" },
  { id: "networkMetrics", label: "Network Metrics", group: "app", icon: Network, description: "Latency, retransmits, ports" },
];

const SCENARIOS: { value: Scenario; label: string; color: string; icon: typeof CheckCircle; description: string }[] = [
  { value: "healthy", label: "Healthy", color: "bg-emerald-500", icon: CheckCircle, description: "Mostly info-level, rare warnings" },
  { value: "degraded", label: "Degraded", color: "bg-amber-500", icon: AlertTriangle, description: "Warnings & some errors \u2014 performance issues" },
  { value: "critical", label: "Critical", color: "bg-red-500", icon: XCircle, description: "Frequent errors & critical failures" },
];

interface GenerateResult {
  ok: boolean;
  applicationId: string;
  applicationName: string;
  dataSourceId: string;
  dataSourceName: string;
  scenario: string;
  totalRows: number;
  feeds: { feed: string; rows: number; level: string }[];
}

export default function TestHarnessPage() {
  const [selectedFeeds, setSelectedFeeds] = useState<Set<string>>(new Set(FEED_OPTIONS.map((f) => f.id)));
  const [scenario, setScenario] = useState<Scenario>("degraded");
  const [rowsPerFeed, setRowsPerFeed] = useState(50);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggleFeed = (id: string) => {
    setSelectedFeeds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = (group?: "db" | "app") => {
    setSelectedFeeds((prev) => {
      const next = new Set(prev);
      FEED_OPTIONS.filter((f) => !group || f.group === group).forEach((f) => next.add(f.id));
      return next;
    });
  };

  const clearAll = (group?: "db" | "app") => {
    setSelectedFeeds((prev) => {
      const next = new Set(prev);
      FEED_OPTIONS.filter((f) => !group || f.group === group).forEach((f) => next.delete(f.id));
      return next;
    });
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/test-harness/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feeds: Array.from(selectedFeeds),
          scenario,
          rowsPerFeed,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Generation failed");
      setResult(data);
    } catch (err: any) {
      setError(err.message ?? "Unknown error");
    } finally {
      setGenerating(false);
    }
  };

  const dbFeeds = FEED_OPTIONS.filter((f) => f.group === "db");
  const appFeeds = FEED_OPTIONS.filter((f) => f.group === "app");

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TestTube className="h-7 w-7 text-violet-500" />
            Test Harness
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Generate realistic synthetic telemetry and push it through the full PMS pipeline.
            Creates a test Application &amp; DataSource automatically.
          </p>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Configuration */}
        <div className="lg:col-span-2 space-y-5">
          {/* Scenario */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-700 mb-3">Scenario</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {SCENARIOS.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setScenario(s.value)}
                  className={`flex items-center gap-3 p-3 rounded-lg border-2 transition-all ${
                    scenario === s.value
                      ? "border-violet-500 bg-violet-50 ring-1 ring-violet-200"
                      : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <div className={`w-3 h-3 rounded-full ${s.color}`} />
                  <div className="text-left">
                    <div className="text-sm font-medium">{s.label}</div>
                    <div className="text-xs text-slate-500">{s.description}</div>
                  </div>
                </button>
              ))}
            </div>
          </motion.div>

          {/* Rows per feed */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-slate-700">Rows per feed</h2>
              <span className="text-lg font-mono font-bold text-violet-600">{rowsPerFeed}</span>
            </div>
            <input
              type="range"
              min={10}
              max={500}
              step={10}
              value={rowsPerFeed}
              onChange={(e) => setRowsPerFeed(Number(e.target.value))}
              className="w-full accent-violet-500"
            />
            <div className="flex justify-between text-xs text-slate-400 mt-1">
              <span>10</span>
              <span>Quick test</span>
              <span>250</span>
              <span>Thorough</span>
              <span>500</span>
            </div>
          </motion.div>

          {/* Feed selection */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            {/* DB feeds */}
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <Database className="h-4 w-4 text-blue-500" />
                Database Server Feeds
              </h2>
              <div className="flex gap-2 text-xs">
                <button onClick={() => selectAll("db")} className="text-violet-600 hover:underline">All</button>
                <button onClick={() => clearAll("db")} className="text-slate-400 hover:underline">None</button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-5">
              {dbFeeds.map((f) => {
                const Icon = f.icon;
                const active = selectedFeeds.has(f.id);
                return (
                  <button
                    key={f.id}
                    onClick={() => toggleFeed(f.id)}
                    className={`flex items-center gap-2.5 p-2.5 rounded-lg border text-left transition-all text-sm ${
                      active
                        ? "border-blue-300 bg-blue-50 text-blue-800"
                        : "border-slate-200 text-slate-500 hover:border-slate-300"
                    }`}
                  >
                    <Icon className={`h-4 w-4 shrink-0 ${active ? "text-blue-500" : "text-slate-400"}`} />
                    <div>
                      <div className="font-medium text-xs">{f.label}</div>
                      <div className="text-[11px] opacity-70">{f.description}</div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* App feeds */}
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <Activity className="h-4 w-4 text-emerald-500" />
                Application Server Feeds <span className="text-xs font-normal text-slate-400">(Phase 7 \u2014 split-server)</span>
              </h2>
              <div className="flex gap-2 text-xs">
                <button onClick={() => selectAll("app")} className="text-violet-600 hover:underline">All</button>
                <button onClick={() => clearAll("app")} className="text-slate-400 hover:underline">None</button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {appFeeds.map((f) => {
                const Icon = f.icon;
                const active = selectedFeeds.has(f.id);
                return (
                  <button
                    key={f.id}
                    onClick={() => toggleFeed(f.id)}
                    className={`flex items-center gap-2.5 p-2.5 rounded-lg border text-left transition-all text-sm ${
                      active
                        ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                        : "border-slate-200 text-slate-500 hover:border-slate-300"
                    }`}
                  >
                    <Icon className={`h-4 w-4 shrink-0 ${active ? "text-emerald-500" : "text-slate-400"}`} />
                    <div>
                      <div className="font-medium text-xs">{f.label}</div>
                      <div className="text-[11px] opacity-70">{f.description}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>
        </div>

        {/* Right: Actions & Results */}
        <div className="space-y-5">
          {/* Generate button */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <button
              onClick={handleGenerate}
              disabled={generating || selectedFeeds.size === 0}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-violet-600 text-white font-medium hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {generating ? (
                <><Loader2 className="h-5 w-5 animate-spin" /> Generating&hellip;</>
              ) : (
                <><Play className="h-5 w-5" /> Generate &amp; Ingest</>
              )}
            </button>
            <p className="text-xs text-slate-400 text-center mt-2">
              {selectedFeeds.size} feeds &times; {rowsPerFeed} rows = <strong>{selectedFeeds.size * rowsPerFeed}</strong> total entries
            </p>
          </motion.div>

          {/* Error */}
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              <XCircle className="h-4 w-4 inline mr-1" /> {error}
            </div>
          )}

          {/* Results */}
          {result && (
            <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm space-y-4">
              <div className="flex items-center gap-2 text-emerald-700 font-semibold">
                <CheckCircle className="h-5 w-5" />
                Ingested {result.totalRows.toLocaleString()} rows
              </div>

              <div className="text-xs text-slate-600 space-y-1">
                <div><strong>Application:</strong> {result.applicationName}</div>
                <div><strong>Data Source:</strong> {result.dataSourceName}</div>
                <div><strong>Scenario:</strong> <span className="capitalize">{result.scenario}</span></div>
              </div>

              <div className="space-y-1">
                <h3 className="text-xs font-semibold text-slate-600">Per-feed summary</h3>
                {result.feeds.map((f) => (
                  <div key={f.feed} className="flex items-center justify-between text-xs py-1 border-b border-emerald-100 last:border-0">
                    <span className="font-mono">{f.feed}</span>
                    <span className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${
                        f.level === "critical" ? "bg-red-500" : f.level === "error" ? "bg-orange-500" : f.level === "warning" ? "bg-amber-500" : "bg-emerald-500"
                      }`} />
                      {f.rows} rows
                    </span>
                  </div>
                ))}
              </div>

              {/* Quick links */}
              <div className="pt-2 space-y-2">
                <h3 className="text-xs font-semibold text-slate-600">Verify results</h3>
                <Link
                  href={`/applications/${result.applicationId}`}
                  className="flex items-center gap-2 text-sm text-violet-600 hover:text-violet-800 hover:underline"
                >
                  <ArrowRight className="h-3.5 w-3.5" /> View test Application
                </Link>
                <Link
                  href={`/system-analysis?applicationId=${result.applicationId}`}
                  className="flex items-center gap-2 text-sm text-violet-600 hover:text-violet-800 hover:underline"
                >
                  <ArrowRight className="h-3.5 w-3.5" /> Run System Analysis
                </Link>
                <Link
                  href={`/dashboard?applicationId=${result.applicationId}`}
                  className="flex items-center gap-2 text-sm text-violet-600 hover:text-violet-800 hover:underline"
                >
                  <ArrowRight className="h-3.5 w-3.5" /> View Dashboard
                </Link>
                <Link
                  href={`/predictions?applicationId=${result.applicationId}`}
                  className="flex items-center gap-2 text-sm text-violet-600 hover:text-violet-800 hover:underline"
                >
                  <ArrowRight className="h-3.5 w-3.5" /> View Predictions
                </Link>
              </div>
            </motion.div>
          )}

          {/* Tips */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500 space-y-2">
            <h3 className="font-semibold text-slate-600 flex items-center gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" /> How it works
            </h3>
            <ul className="space-y-1.5 list-disc list-inside">
              <li>Creates a <strong>&ldquo;PMS Test Harness&rdquo;</strong> Application &amp; DataSource (idempotent)</li>
              <li>Generates scenario-tuned synthetic data for each selected feed</li>
              <li>Ingests directly into the database &mdash; same pipeline as real edge collectors</li>
              <li>Use <strong>System Analysis</strong> to see EAI root-cause hypotheses on the test data</li>
              <li>Try <strong>Critical</strong> scenario to see how PMS detects cascading failures across DB + app + network</li>
            </ul>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
