"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import {
  Brain,
  Play,
  Loader2,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Server,
  Activity,
  Network,
  Shield,
  Lightbulb,
  BookOpen,
  BarChart3,
  Clock,
  ChevronDown,
  ChevronUp,
  Zap,
  Target,
  Link2,
  History,
  Database,
  ThumbsUp,
  ThumbsDown,
  MessageSquare,
  TrendingUp,
  TrendingDown,
  Minus,
  Fingerprint,
  Layers,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import ApplicationFilterChips from "@/components/application-filter-chips";

// ---- Types ----
interface SystemProfile {
  description: string;
  components: string[];
  architecture: string;
  technologies: string[];
}
interface PatternInsight {
  title: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
  evidence: string;
  affectedComponents: string[];
}
interface RiskItem {
  risk: string;
  likelihood: "high" | "medium" | "low";
  impact: "high" | "medium" | "low";
  recommendation: string;
  timeframe: string;
}
interface Correlation {
  sources: string[];
  relationship: string;
  significance: string;
}
interface AnalysisResult {
  systemProfile: SystemProfile;
  activityNarrative: string;
  patternInsights: PatternInsight[];
  riskAssessment: RiskItem[];
  correlations: Correlation[];
  summary: string;
  baselineComparison?: string;
}
interface BaselineDeviation {
  source: string;
  metricName: string;
  currentValue: number;
  baselineMean: number;
  baselineStddev: number;
  deviationSigma: number;
  direction: string;
  sampleCount: number;
}
interface FullResult {
  result: AnalysisResult;
  logCount: number;
  sourceCount: number;
  stats: Record<string, { total: number; critical: number; error: number; warning: number; info: number }>;
  reportId?: string;
  deviations?: BaselineDeviation[];
  patternStats?: { created: number; updated: number };
  applicationId?: string;
}
interface HistoryReport {
  id: string;
  summary: string;
  tags: string[];
  verdict: string | null;
  verdictNotes: string | null;
  logFingerprint: any;
  createdAt: string;
}
interface KnowledgePattern {
  id: string;
  title: string;
  description: string;
  category: string;
  severity: string;
  affectedSources: string[];
  occurrenceCount: number;
  confidence: number;
  severityTrend: string | null;
  operatorVerdict: string | null;
  operatorNotes: string | null;
  lastSeenAt: string;
  createdAt: string;
}
interface KnowledgeBaseline {
  id: string;
  source: string;
  metricName: string;
  sampleCount: number;
  rollingMean: number;
  rollingStddev: number;
  lastValue: number;
  lastUpdatedAt: string;
}
interface KnowledgeData {
  patterns: KnowledgePattern[];
  baselines: KnowledgeBaseline[];
  reportStats: { total: number; confirmed: number; falsePositive: number; unreviewed: number };
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-100 text-red-800 border-red-200",
  high: "bg-orange-100 text-orange-800 border-orange-200",
  medium: "bg-amber-100 text-amber-800 border-amber-200",
  low: "bg-blue-100 text-blue-800 border-blue-200",
};
const LIKELIHOOD_DOT: Record<string, string> = { high: "bg-red-500", medium: "bg-amber-500", low: "bg-emerald-500" };
const CATEGORY_ICONS: Record<string, typeof Activity> = {
  performance: Zap,
  reliability: Shield,
  security: Shield,
  capacity: Database,
  network: Network,
  database: Database,
};
const TREND_ICONS: Record<string, { icon: typeof TrendingUp; color: string }> = {
  escalating: { icon: TrendingUp, color: "text-red-500" },
  stable: { icon: Minus, color: "text-slate-400" },
  improving: { icon: TrendingDown, color: "text-emerald-500" },
};

type TabId = "analyze" | "history" | "knowledge";

export default function IntelligencePage() {
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("analyze");

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Brain className="h-7 w-7 text-purple-500" />
          Adaptive Intelligence
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          AI-powered analysis that learns your system over time — builds baselines, remembers patterns, and enriches every report with historical context.
        </p>
      </motion.div>

      {/* App filter */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <ApplicationFilterChips storageKey="pms.intelligence.applicationId" onChange={setApplicationId} />
      </motion.div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
        {(["analyze", "history", "knowledge"] as TabId[]).map((tab) => {
          const labels: Record<TabId, { label: string; icon: typeof Brain }> = {
            analyze: { label: "Analyze", icon: Play },
            history: { label: "History", icon: History },
            knowledge: { label: "System Knowledge", icon: Fingerprint },
          };
          const { label, icon: Icon } = labels[tab];
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab ? "bg-white text-purple-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {activeTab === "analyze" && <AnalyzeTab applicationId={applicationId} />}
      {activeTab === "history" && <HistoryTab applicationId={applicationId} />}
      {activeTab === "knowledge" && <KnowledgeTab applicationId={applicationId} />}
    </div>
  );
}

// =====================================================================
// ANALYZE TAB
// =====================================================================
function AnalyzeTab({ applicationId }: { applicationId: string | null }) {
  const [hoursBack, setHoursBack] = useState(24);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<FullResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["summary", "deviations", "profile", "narrative", "patterns", "risks", "correlations"]));
  const abortRef = useRef<AbortController | null>(null);

  const toggleSection = (s: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  };

  const analyze = useCallback(async () => {
    if (!applicationId) {
      setError("Please select an application to analyze.");
      return;
    }
    setAnalyzing(true);
    setError(null);
    setResult(null);
    setProgress("Fetching logs and building adaptive context...");
    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/intelligence/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId, hoursBack, maxLogs: 500 }),
        signal: abortRef.current.signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error ?? "Analysis failed");
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");
      const decoder = new TextDecoder();
      let partialRead = "";
      let chunkCount = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        partialRead += decoder.decode(value, { stream: true });
        const lines = partialRead.split("\n");
        partialRead = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") break;
            try {
              const parsed = JSON.parse(data);
              if (parsed.status === "processing") {
                chunkCount++;
                if (chunkCount % 5 === 0) setProgress(`AI is analyzing with adaptive context... (${chunkCount} chunks)`);
              } else if (parsed.status === "completed") {
                setResult(parsed as FullResult);
                setProgress("");
              } else if (parsed.status === "error") {
                throw new Error(parsed.message ?? "Analysis error");
              }
            } catch (e: any) {
              if (e.message?.includes("Analysis") || e.message?.includes("error")) throw e;
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") setError(err.message ?? "Unknown error");
    } finally {
      setAnalyzing(false);
      setProgress("");
    }
  }, [applicationId, hoursBack]);

  const r = result?.result;
  const deviations = result?.deviations ?? [];

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-slate-400" />
          <select value={hoursBack} onChange={(e) => setHoursBack(Number(e.target.value))} className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white">
            <option value={1}>Last hour</option>
            <option value={6}>Last 6 hours</option>
            <option value={12}>Last 12 hours</option>
            <option value={24}>Last 24 hours</option>
            <option value={48}>Last 2 days</option>
            <option value={168}>Last 7 days</option>
          </select>
        </div>
        <button onClick={analyze} disabled={analyzing || !applicationId} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
          {analyzing ? <><Loader2 className="h-4 w-4 animate-spin" /> Analyzing&hellip;</> : <><Play className="h-4 w-4" /> Analyze Logs</>}
        </button>
        {!applicationId && <span className="text-xs text-amber-600">Select an application above to begin</span>}
      </div>

      {/* Progress */}
      {analyzing && progress && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl border border-purple-200 bg-purple-50 p-4 flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-purple-500" />
          <span className="text-sm text-purple-700">{progress}</span>
        </motion.div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex items-center gap-2">
          <XCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {/* Results */}
      <AnimatePresence>
        {r && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
            {/* Adaptive Intelligence Badges */}
            {(result?.reportId || deviations.length > 0 || (result?.patternStats && (result.patternStats.created + result.patternStats.updated) > 0)) && (
              <div className="flex flex-wrap gap-2">
                {result?.reportId && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-100 text-purple-700 text-xs font-medium">
                    <Fingerprint className="h-3 w-3" /> Report saved to history
                  </span>
                )}
                {deviations.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-medium">
                    <AlertTriangle className="h-3 w-3" /> {deviations.length} baseline deviation{deviations.length > 1 ? "s" : ""}
                  </span>
                )}
                {result?.patternStats && (result.patternStats.created + result.patternStats.updated) > 0 && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">
                    <Layers className="h-3 w-3" /> {result.patternStats.created} new + {result.patternStats.updated} updated patterns
                  </span>
                )}
              </div>
            )}

            {/* Executive Summary + Feedback */}
            <div className="rounded-xl border border-purple-200 bg-gradient-to-br from-purple-50 to-indigo-50 p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <Lightbulb className="h-5 w-5 text-purple-600" />
                <h2 className="font-semibold text-purple-900">Executive Summary</h2>
                <span className="ml-auto text-xs text-slate-400">
                  {result?.logCount?.toLocaleString()} logs · {result?.sourceCount} sources · last {hoursBack}h
                </span>
              </div>
              <p className="text-sm text-slate-700 leading-relaxed mb-3">{r.summary}</p>
              {result?.reportId && <FeedbackButtons type="report" id={result.reportId} applicationId={result.applicationId!} />}
            </div>

            {/* Baseline Deviations */}
            {deviations.length > 0 && (
              <SectionCard id="deviations" icon={<AlertTriangle className="h-5 w-5 text-amber-500" />} title={`Baseline Deviations (${deviations.length})`} subtitle="Metrics that deviate significantly from this application's historical norms" expanded={expandedSections.has("deviations")} toggle={toggleSection}>
                <div className="space-y-2">
                  {deviations.map((d, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                      {d.direction === "above" ? <ArrowUpRight className="h-4 w-4 text-red-500 shrink-0" /> : <ArrowDownRight className="h-4 w-4 text-blue-500 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-slate-800">{d.source}</span>
                        <span className="text-slate-400 mx-1">/</span>
                        <span className="font-mono text-xs text-slate-600">{d.metricName}</span>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-sm font-bold text-amber-800">{d.deviationSigma}σ {d.direction}</div>
                        <div className="text-xs text-slate-500">{d.currentValue.toFixed(3)} vs µ={d.baselineMean.toFixed(3)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </SectionCard>
            )}

            {/* Baseline Comparison */}
            {r.baselineComparison && (
              <SectionCard id="baseline-comparison" icon={<BarChart3 className="h-5 w-5 text-teal-500" />} title="Baseline Comparison" subtitle="How current metrics compare to historical norms" expanded={expandedSections.has("baseline-comparison")} toggle={toggleSection}>
                <div className="prose prose-sm max-w-none text-slate-700">
                  {r.baselineComparison.split("\n").filter(Boolean).map((p, i) => <p key={i} className="mb-2 last:mb-0 leading-relaxed">{p}</p>)}
                </div>
              </SectionCard>
            )}

            {/* System Profile */}
            <SectionCard id="profile" icon={<Server className="h-5 w-5 text-blue-500" />} title="System Profile" subtitle="What the AI learned about your infrastructure" expanded={expandedSections.has("profile")} toggle={toggleSection}>
              <p className="text-sm text-slate-700 mb-3">{r.systemProfile?.description}</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-blue-50 rounded-lg p-3">
                  <h4 className="text-xs font-semibold text-blue-600 mb-1.5">Architecture</h4>
                  <p className="text-sm text-slate-700">{r.systemProfile?.architecture}</p>
                </div>
                <div className="bg-emerald-50 rounded-lg p-3">
                  <h4 className="text-xs font-semibold text-emerald-600 mb-1.5">Components</h4>
                  <div className="flex flex-wrap gap-1">
                    {r.systemProfile?.components?.map((c, i) => <span key={i} className="inline-block px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs">{c}</span>)}
                  </div>
                </div>
                <div className="bg-violet-50 rounded-lg p-3">
                  <h4 className="text-xs font-semibold text-violet-600 mb-1.5">Technologies</h4>
                  <div className="flex flex-wrap gap-1">
                    {r.systemProfile?.technologies?.map((t, i) => <span key={i} className="inline-block px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 text-xs">{t}</span>)}
                  </div>
                </div>
              </div>
            </SectionCard>

            {/* Activity Narrative */}
            <SectionCard id="narrative" icon={<BookOpen className="h-5 w-5 text-amber-500" />} title="Activity Narrative" subtitle="What was happening, told as a story" expanded={expandedSections.has("narrative")} toggle={toggleSection}>
              <div className="prose prose-sm max-w-none text-slate-700">
                {r.activityNarrative?.split("\n").filter(Boolean).map((p, i) => <p key={i} className="mb-2 last:mb-0 leading-relaxed">{p}</p>)}
              </div>
            </SectionCard>

            {/* Pattern Insights */}
            <SectionCard id="patterns" icon={<Activity className="h-5 w-5 text-orange-500" />} title={`Pattern Insights (${r.patternInsights?.length ?? 0})`} subtitle="Recurring patterns and anomalies the AI detected" expanded={expandedSections.has("patterns")} toggle={toggleSection}>
              <div className="space-y-3">
                {r.patternInsights?.map((p, i) => (
                  <div key={i} className={`rounded-lg border p-3 ${SEVERITY_COLORS[p.severity] ?? SEVERITY_COLORS.low}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold">{p.title}</span>
                      <span className="ml-auto text-[10px] uppercase font-bold opacity-70">{p.severity}</span>
                    </div>
                    <p className="text-xs mb-2">{p.description}</p>
                    <p className="text-[11px] opacity-80"><strong>Evidence:</strong> {p.evidence}</p>
                    {p.affectedComponents?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {p.affectedComponents.map((c, j) => <span key={j} className="inline-block px-1.5 py-0.5 rounded bg-white/50 text-[10px] font-mono">{c}</span>)}
                      </div>
                    )}
                  </div>
                ))}
                {(!r.patternInsights || r.patternInsights.length === 0) && <p className="text-sm text-slate-400 italic">No significant patterns detected.</p>}
              </div>
            </SectionCard>

            {/* Risk Assessment */}
            <SectionCard id="risks" icon={<Shield className="h-5 w-5 text-red-500" />} title={`Risk Assessment (${r.riskAssessment?.length ?? 0})`} subtitle="Predicted risks based on observed patterns" expanded={expandedSections.has("risks")} toggle={toggleSection}>
              <div className="space-y-3">
                {r.riskAssessment?.map((risk, i) => (
                  <div key={i} className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex items-start gap-2 mb-2">
                      <Target className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-slate-800">{risk.risk}</p>
                        <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                          <span className="flex items-center gap-1">Likelihood: <span className={`w-2 h-2 rounded-full ${LIKELIHOOD_DOT[risk.likelihood] ?? "bg-gray-400"}`} /> {risk.likelihood}</span>
                          <span className="flex items-center gap-1">Impact: <span className={`w-2 h-2 rounded-full ${LIKELIHOOD_DOT[risk.impact] ?? "bg-gray-400"}`} /> {risk.impact}</span>
                          <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {risk.timeframe}</span>
                        </div>
                      </div>
                    </div>
                    <div className="ml-6 mt-1 p-2 bg-emerald-50 rounded text-xs text-emerald-800"><strong>Recommendation:</strong> {risk.recommendation}</div>
                  </div>
                ))}
                {(!r.riskAssessment || r.riskAssessment.length === 0) && <p className="text-sm text-slate-400 italic">No significant risks identified.</p>}
              </div>
            </SectionCard>

            {/* Correlations */}
            <SectionCard id="correlations" icon={<Link2 className="h-5 w-5 text-indigo-500" />} title={`Cross-Source Correlations (${r.correlations?.length ?? 0})`} subtitle="How different data sources relate to each other" expanded={expandedSections.has("correlations")} toggle={toggleSection}>
              <div className="space-y-3">
                {r.correlations?.map((c, i) => (
                  <div key={i} className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-3">
                    <div className="flex flex-wrap gap-1.5 mb-1.5">
                      {c.sources?.map((s, j) => <span key={j} className="inline-block px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-xs font-mono">{s}</span>)}
                    </div>
                    <p className="text-sm text-slate-700 mb-1">{c.relationship}</p>
                    <p className="text-xs text-indigo-600"><strong>Significance:</strong> {c.significance}</p>
                  </div>
                ))}
                {(!r.correlations || r.correlations.length === 0) && <p className="text-sm text-slate-400 italic">No cross-source correlations found.</p>}
              </div>
            </SectionCard>

            {/* Source Stats */}
            {result?.stats && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-3"><BarChart3 className="h-5 w-5 text-slate-400" /><h2 className="font-semibold text-slate-700">Source Breakdown</h2></div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className="text-left py-2 px-2 font-medium text-slate-500">Source</th>
                        <th className="text-right py-2 px-2 font-medium text-slate-500">Total</th>
                        <th className="text-right py-2 px-2 font-medium text-red-400">Critical</th>
                        <th className="text-right py-2 px-2 font-medium text-orange-400">Error</th>
                        <th className="text-right py-2 px-2 font-medium text-amber-400">Warning</th>
                        <th className="text-right py-2 px-2 font-medium text-emerald-400">Info</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(result.stats).sort((a, b) => b[1].total - a[1].total).map(([src, s]) => (
                        <tr key={src} className="border-b border-slate-50 hover:bg-slate-50">
                          <td className="py-1.5 px-2 font-mono">{src}</td>
                          <td className="py-1.5 px-2 text-right font-medium">{s.total}</td>
                          <td className="py-1.5 px-2 text-right text-red-600">{s.critical || "—"}</td>
                          <td className="py-1.5 px-2 text-right text-orange-600">{s.error || "—"}</td>
                          <td className="py-1.5 px-2 text-right text-amber-600">{s.warning || "—"}</td>
                          <td className="py-1.5 px-2 text-right text-emerald-600">{s.info || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Empty state */}
      {!analyzing && !result && !error && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
          <Brain className="h-12 w-12 text-purple-300 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-slate-600 mb-1">Ready to analyze</h3>
          <p className="text-sm text-slate-400 max-w-md mx-auto mb-4">
            Select an application and click Analyze. The AI will read your system&apos;s logs, compare against learned baselines and known patterns, and produce an enriched intelligence report.
          </p>
          <p className="text-xs text-slate-400">
            No logs yet? Use the <Link href="/test-harness" className="text-purple-600 hover:underline">Test Harness</Link> to generate synthetic data first.
          </p>
        </motion.div>
      )}
    </div>
  );
}

// =====================================================================
// HISTORY TAB
// =====================================================================
function HistoryTab({ applicationId }: { applicationId: string | null }) {
  const [reports, setReports] = useState<HistoryReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [fullReport, setFullReport] = useState<any>(null);

  useEffect(() => {
    if (!applicationId) { setReports([]); return; }
    setLoading(true);
    fetch(`/api/intelligence/history?applicationId=${applicationId}&limit=30`)
      .then((r) => r.json())
      .then((d) => setReports(d.reports ?? []))
      .catch(() => setReports([]))
      .finally(() => setLoading(false));
  }, [applicationId]);

  const loadFull = async (id: string) => {
    if (expandedId === id) { setExpandedId(null); setFullReport(null); return; }
    setExpandedId(id);
    try {
      const res = await fetch(`/api/intelligence/history/${id}?applicationId=${applicationId}`);
      const d = await res.json();
      setFullReport(d.report ?? null);
    } catch {
      setFullReport(null);
    }
  };

  if (!applicationId) return <EmptyAppPrompt message="Select an application to view analysis history." />;
  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-purple-500" /></div>;

  if (reports.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
        <History className="h-12 w-12 text-slate-300 mx-auto mb-3" />
        <h3 className="text-lg font-semibold text-slate-600 mb-1">No history yet</h3>
        <p className="text-sm text-slate-400">Run your first analysis on the Analyze tab to start building history.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {reports.map((rpt) => (
        <div key={rpt.id} className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <button onClick={() => loadFull(rpt.id)} className="w-full flex items-start gap-3 p-4 hover:bg-slate-50 transition-colors text-left">
            <div className="mt-0.5">
              {rpt.verdict === "confirmed" ? <CheckCircle className="h-5 w-5 text-emerald-500" /> : rpt.verdict === "false_positive" ? <XCircle className="h-5 w-5 text-red-400" /> : <Clock className="h-5 w-5 text-slate-300" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-slate-700 line-clamp-2">{rpt.summary}</p>
              <div className="flex items-center gap-2 mt-1.5 text-xs text-slate-400">
                <span>{new Date(rpt.createdAt).toLocaleString()}</span>
                {rpt.verdict && <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${rpt.verdict === "confirmed" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>{rpt.verdict}</span>}
                {rpt.tags.length > 0 && <span className="text-slate-300">· {rpt.tags.length} tags</span>}
              </div>
            </div>
            {expandedId === rpt.id ? <ChevronUp className="h-4 w-4 text-slate-400 mt-1" /> : <ChevronDown className="h-4 w-4 text-slate-400 mt-1" />}
          </button>
          <AnimatePresence>
            {expandedId === rpt.id && fullReport && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="px-4 pb-4 pt-1 border-t border-slate-100 space-y-3">
                  {fullReport.analysisResult?.patternInsights && (
                    <div>
                      <h4 className="text-xs font-semibold text-slate-500 mb-1.5">Pattern Insights</h4>
                      <div className="space-y-1.5">
                        {(fullReport.analysisResult.patternInsights as PatternInsight[]).map((p: PatternInsight, i: number) => (
                          <div key={i} className={`rounded p-2 text-xs ${SEVERITY_COLORS[p.severity] ?? SEVERITY_COLORS.low}`}>
                            <span className="font-semibold">{p.title}</span> — {p.description}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {(fullReport.tags ?? []).map((t: string, i: number) => <span key={i} className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[10px] font-mono">{t}</span>)}
                  </div>
                  <FeedbackButtons type="report" id={rpt.id} applicationId={applicationId!} currentVerdict={rpt.verdict} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}

// =====================================================================
// KNOWLEDGE TAB
// =====================================================================
function KnowledgeTab({ applicationId }: { applicationId: string | null }) {
  const [data, setData] = useState<KnowledgeData | null>(null);
  const [loading, setLoading] = useState(false);
  const [subTab, setSubTab] = useState<"patterns" | "baselines">("patterns");

  useEffect(() => {
    if (!applicationId) { setData(null); return; }
    setLoading(true);
    fetch(`/api/intelligence/knowledge?applicationId=${applicationId}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [applicationId]);

  if (!applicationId) return <EmptyAppPrompt message="Select an application to view its learned knowledge." />;
  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-purple-500" /></div>;
  if (!data) return null;

  return (
    <div className="space-y-5">
      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatBox label="Total Reports" value={data.reportStats.total} icon={<History className="h-4 w-4 text-purple-500" />} />
        <StatBox label="Confirmed" value={data.reportStats.confirmed} icon={<CheckCircle className="h-4 w-4 text-emerald-500" />} />
        <StatBox label="False Positives" value={data.reportStats.falsePositive} icon={<XCircle className="h-4 w-4 text-red-400" />} />
        <StatBox label="Known Patterns" value={data.patterns.length} icon={<Layers className="h-4 w-4 text-orange-500" />} />
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
        <button onClick={() => setSubTab("patterns")} className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${subTab === "patterns" ? "bg-white text-purple-700 shadow-sm" : "text-slate-500"}`}>
          Patterns ({data.patterns.length})
        </button>
        <button onClick={() => setSubTab("baselines")} className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${subTab === "baselines" ? "bg-white text-purple-700 shadow-sm" : "text-slate-500"}`}>
          Baselines ({data.baselines.length})
        </button>
      </div>

      {/* Patterns */}
      {subTab === "patterns" && (
        <div className="space-y-3">
          {data.patterns.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
              <Layers className="h-10 w-10 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-400">No patterns learned yet. Run a few analyses to start cataloguing patterns.</p>
            </div>
          ) : (
            data.patterns.map((p) => {
              const CatIcon = CATEGORY_ICONS[p.category] ?? Activity;
              const trend = TREND_ICONS[p.severityTrend ?? ""] ?? TREND_ICONS.stable;
              const TrendIcon = trend.icon;
              return (
                <div key={p.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5"><CatIcon className="h-5 w-5 text-slate-400" /></div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-semibold text-slate-800">{p.title}</h3>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-bold ${SEVERITY_COLORS[p.severity] ?? SEVERITY_COLORS.low}`}>{p.severity}</span>
                        <TrendIcon className={`h-3.5 w-3.5 ${trend.color}`} />
                      </div>
                      <p className="text-xs text-slate-600 mb-2">{p.description}</p>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                        <span>Seen {p.occurrenceCount}x</span>
                        <span>Confidence: {(p.confidence * 100).toFixed(0)}%</span>
                        <span>Category: {p.category}</span>
                        <span>Last: {new Date(p.lastSeenAt).toLocaleDateString()}</span>
                        {p.affectedSources.length > 0 && <span>Sources: {p.affectedSources.join(", ")}</span>}
                      </div>
                      {p.operatorVerdict && (
                        <div className={`mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${p.operatorVerdict === "confirmed" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                          {p.operatorVerdict === "confirmed" ? <ThumbsUp className="h-3 w-3" /> : <ThumbsDown className="h-3 w-3" />}
                          {p.operatorVerdict}
                          {p.operatorNotes && <span className="ml-1 text-slate-500">— {p.operatorNotes}</span>}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-purple-700">{(p.confidence * 100).toFixed(0)}%</div>
                      <div className="text-[10px] text-slate-400">confidence</div>
                    </div>
                  </div>
                  {!p.operatorVerdict && <FeedbackButtons type="pattern" id={p.id} applicationId={applicationId!} />}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Baselines */}
      {subTab === "baselines" && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {data.baselines.length === 0 ? (
            <div className="p-8 text-center">
              <BarChart3 className="h-10 w-10 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-400">No baselines established yet. Run analyses to build baselines.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    <th className="text-left py-2.5 px-3 font-medium text-slate-500">Source</th>
                    <th className="text-left py-2.5 px-3 font-medium text-slate-500">Metric</th>
                    <th className="text-right py-2.5 px-3 font-medium text-slate-500">Mean (µ)</th>
                    <th className="text-right py-2.5 px-3 font-medium text-slate-500">Std Dev (σ)</th>
                    <th className="text-right py-2.5 px-3 font-medium text-slate-500">Last Value</th>
                    <th className="text-right py-2.5 px-3 font-medium text-slate-500">Samples</th>
                    <th className="text-right py-2.5 px-3 font-medium text-slate-500">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {data.baselines.map((b) => {
                    const deviation = b.rollingStddev > 0.001 ? Math.abs(b.lastValue - b.rollingMean) / b.rollingStddev : 0;
                    const isHot = b.sampleCount >= 5 && deviation >= 2;
                    return (
                      <tr key={b.id} className={`border-b border-slate-50 ${isHot ? "bg-amber-50" : "hover:bg-slate-50"}`}>
                        <td className="py-2 px-3 font-mono">{b.source}</td>
                        <td className="py-2 px-3 font-mono">{b.metricName}</td>
                        <td className="py-2 px-3 text-right">{b.rollingMean.toFixed(4)}</td>
                        <td className="py-2 px-3 text-right">{b.rollingStddev.toFixed(4)}</td>
                        <td className={`py-2 px-3 text-right font-medium ${isHot ? "text-amber-700" : ""}`}>{b.lastValue.toFixed(4)}</td>
                        <td className="py-2 px-3 text-right">{b.sampleCount}</td>
                        <td className="py-2 px-3 text-right text-slate-400">{new Date(b.lastUpdatedAt).toLocaleDateString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =====================================================================
// SHARED COMPONENTS
// =====================================================================
function FeedbackButtons({ type, id, applicationId, currentVerdict }: { type: "report" | "pattern"; id: string; applicationId: string; currentVerdict?: string | null }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(currentVerdict ?? null);
  const [showNotes, setShowNotes] = useState(false);
  const [notes, setNotes] = useState("");

  const submit = async (verdict: "confirmed" | "false_positive") => {
    setSaving(true);
    try {
      await fetch("/api/intelligence/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, id, applicationId, verdict, notes: notes || undefined }),
      });
      setSaved(verdict);
      setShowNotes(false);
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <div className={`inline-flex items-center gap-1.5 mt-2 px-3 py-1 rounded-full text-xs font-medium ${saved === "confirmed" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
        {saved === "confirmed" ? <ThumbsUp className="h-3 w-3" /> : <ThumbsDown className="h-3 w-3" />}
        {saved === "confirmed" ? "Confirmed" : "False Positive"}
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center gap-2">
        <button onClick={() => submit("confirmed")} disabled={saving} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-medium hover:bg-emerald-100 disabled:opacity-50 transition-colors">
          <ThumbsUp className="h-3 w-3" /> Confirm
        </button>
        <button onClick={() => submit("false_positive")} disabled={saving} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-red-200 bg-red-50 text-red-700 text-xs font-medium hover:bg-red-100 disabled:opacity-50 transition-colors">
          <ThumbsDown className="h-3 w-3" /> False Positive
        </button>
        <button onClick={() => setShowNotes(!showNotes)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 text-slate-500 text-xs hover:bg-slate-50 transition-colors">
          <MessageSquare className="h-3 w-3" /> Note
        </button>
        {saving && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
      </div>
      {showNotes && (
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional note..."
          className="w-full border border-slate-200 rounded-md px-3 py-1.5 text-xs"
        />
      )}
    </div>
  );
}

function SectionCard({ id, icon, title, subtitle, expanded, toggle, children }: {
  id: string; icon: React.ReactNode; title: string; subtitle: string; expanded: boolean; toggle: (id: string) => void; children: React.ReactNode;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <button onClick={() => toggle(id)} className="w-full flex items-center gap-3 p-4 hover:bg-slate-50 transition-colors text-left">
        {icon}
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-slate-800 text-sm">{title}</h2>
          <p className="text-xs text-slate-400">{subtitle}</p>
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className="px-4 pb-4 pt-1">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function StatBox({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-1">{icon}<span className="text-xs text-slate-500">{label}</span></div>
      <div className="text-2xl font-bold text-slate-800">{value}</div>
    </div>
  );
}

function EmptyAppPrompt({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50 p-8 text-center">
      <AlertTriangle className="h-10 w-10 text-amber-400 mx-auto mb-2" />
      <p className="text-sm text-amber-700">{message}</p>
    </div>
  );
}
