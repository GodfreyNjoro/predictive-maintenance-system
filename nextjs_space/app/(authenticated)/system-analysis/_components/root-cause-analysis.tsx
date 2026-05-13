"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain,
  Sparkles,
  Microscope,
  GitBranch,
  Gauge,
  Clock4,
  ListChecks,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  Cpu,
  Boxes,
  AlertOctagon,
  Wrench,
  Wifi,
  ShieldAlert,
  CalendarClock,
  FileWarning,
  HelpCircle,
  ArrowRight,
  Target,
  CheckCircle2,
  Info,
  Flame,
  ArrowDownRight,
  ArrowUpRight,
  ArrowRightLeft,
  Database,
  Hourglass,
  HardDrive,
  Lock,
  Timer,
  FileText,
  Monitor,
  Activity,
  Network,
  ScreenShare,
  Globe,
} from "lucide-react";

// Types mirror lib/explainable-ai.ts
export interface ExplanationNode {
  id: string;
  label: string;
  type: "root_cause" | "contributing" | "effect" | "symptom";
  severity: "critical" | "high" | "medium" | "low";
  confidence: number;
  description: string;
  evidence: string[];
}

export interface CausalEdge {
  from: string;
  to: string;
  strength: number;
  relationship: string;
}

export interface RootCauseHypothesis {
  cause: string;
  category:
    | "resource_exhaustion"
    | "dependency_cascade"
    | "traffic_spike"
    | "configuration_drift"
    | "intermittent_component"
    | "network_incident"
    | "security_event"
    | "scheduled_collision"
    | "data_quality"
    | "plan_regression"
    | "wait_contention"
    | "io_latency"
    | "deadlock"
    | "query_timeout"
    | "error_log"
    | "os_resource_pressure"
    | "app_server_pressure"
    | "network_degradation"
    | "windows_event_failure"
    | "iis_error_spike"
    | "unknown";
  narrative: string;
  probability: number;
  evidence: string[];
  diagnosticSteps: string[];
  affectedSources: string[];
}

export interface ExplainablePrediction {
  summary: string;
  detailedExplanation: string;
  narrative: string;
  confidenceBreakdown: {
    overall: number;
    factors: { factor: string; contribution: number; reasoning: string }[];
  };
  rootCauseChain: { nodes: ExplanationNode[]; edges: CausalEdge[] };
  likelyRootCauses: RootCauseHypothesis[];
  temporalContext: {
    timeToFailure: string;
    trendDirection: "worsening" | "improving" | "stable";
    historicalPattern: string;
    timeline: { phase: string; description: string }[];
  };
  recommendations: {
    action: string;
    priority: "immediate" | "soon" | "scheduled";
    expectedImpact: string;
    reasoning: string;
  }[];
  featureImportance: {
    feature: string;
    importance: number;
    direction: "positive" | "negative";
    explanation: string;
  }[];
}

interface Props {
  explanation: ExplainablePrediction;
}

const CATEGORY_ICONS: Record<RootCauseHypothesis["category"], React.ComponentType<{ className?: string }>> = {
  resource_exhaustion: Cpu,
  dependency_cascade: Boxes,
  traffic_spike: Flame,
  configuration_drift: Wrench,
  intermittent_component: AlertOctagon,
  network_incident: Wifi,
  security_event: ShieldAlert,
  scheduled_collision: CalendarClock,
  data_quality: FileWarning,
  plan_regression: Database,
  wait_contention: Hourglass,
  io_latency: HardDrive,
  deadlock: Lock,
  query_timeout: Timer,
  error_log: FileText,
  os_resource_pressure: Monitor,
  app_server_pressure: Activity,
  network_degradation: Network,
  windows_event_failure: ScreenShare,
  iis_error_spike: Globe,
  unknown: HelpCircle,
};

const CATEGORY_COLORS: Record<RootCauseHypothesis["category"], string> = {
  resource_exhaustion: "from-orange-500/20 to-orange-700/10 border-orange-500/30",
  dependency_cascade: "from-red-500/20 to-red-700/10 border-red-500/30",
  traffic_spike: "from-pink-500/20 to-pink-700/10 border-pink-500/30",
  configuration_drift: "from-amber-500/20 to-amber-700/10 border-amber-500/30",
  intermittent_component: "from-yellow-500/20 to-yellow-700/10 border-yellow-500/30",
  network_incident: "from-cyan-500/20 to-cyan-700/10 border-cyan-500/30",
  security_event: "from-rose-500/20 to-rose-700/10 border-rose-500/30",
  scheduled_collision: "from-purple-500/20 to-purple-700/10 border-purple-500/30",
  data_quality: "from-indigo-500/20 to-indigo-700/10 border-indigo-500/30",
  plan_regression: "from-blue-500/20 to-blue-700/10 border-blue-500/30",
  wait_contention: "from-violet-500/20 to-violet-700/10 border-violet-500/30",
  io_latency: "from-teal-500/20 to-teal-700/10 border-teal-500/30",
  deadlock: "from-red-600/20 to-red-800/10 border-red-600/30",
  query_timeout: "from-amber-600/20 to-amber-800/10 border-amber-600/30",
  error_log: "from-gray-500/20 to-gray-700/10 border-gray-500/30",
  os_resource_pressure: "from-lime-500/20 to-lime-700/10 border-lime-500/30",
  app_server_pressure: "from-emerald-500/20 to-emerald-700/10 border-emerald-500/30",
  network_degradation: "from-sky-500/20 to-sky-700/10 border-sky-500/30",
  windows_event_failure: "from-fuchsia-500/20 to-fuchsia-700/10 border-fuchsia-500/30",
  iis_error_spike: "from-blue-400/20 to-blue-600/10 border-blue-400/30",
  unknown: "from-slate-500/20 to-slate-700/10 border-slate-500/30",
};

const SEVERITY_BADGE: Record<ExplanationNode["severity"], string> = {
  critical: "bg-red-900/50 text-red-300 border-red-500/40",
  high: "bg-orange-900/50 text-orange-300 border-orange-500/40",
  medium: "bg-yellow-900/50 text-yellow-300 border-yellow-500/40",
  low: "bg-green-900/50 text-green-300 border-green-500/40",
};

const NODE_TYPE_LABEL: Record<ExplanationNode["type"], string> = {
  root_cause: "Root cause",
  contributing: "Contributing factor",
  effect: "Effect",
  symptom: "Symptom",
};

const NODE_TYPE_ICON: Record<ExplanationNode["type"], React.ComponentType<{ className?: string }>> = {
  root_cause: Target,
  contributing: GitBranch,
  effect: ArrowDownRight,
  symptom: Info,
};

const PRIORITY_STYLE: Record<"immediate" | "soon" | "scheduled", string> = {
  immediate: "bg-red-100 text-red-800 border-red-300",
  soon: "bg-amber-100 text-amber-800 border-amber-300",
  scheduled: "bg-blue-100 text-blue-800 border-blue-300",
};

function probabilityColor(p: number): string {
  if (p >= 0.7) return "bg-red-500";
  if (p >= 0.5) return "bg-orange-500";
  if (p >= 0.35) return "bg-yellow-500";
  return "bg-blue-500";
}

function Section({
  icon: Icon,
  title,
  subtitle,
  defaultOpen = true,
  children,
  badge,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  badge?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white border border-slate-200 rounded-xl overflow-hidden"
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full p-5 flex items-center justify-between hover:bg-slate-700/30 transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 rounded-lg bg-slate-100 border border-slate-200">
            <Icon className="w-5 h-5 text-blue-400" />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-900 truncate">{title}</h3>
            {subtitle && (
              <p className="text-xs text-slate-500 mt-0.5 truncate">{subtitle}</p>
            )}
          </div>
          {badge}
        </div>
        {open ? (
          <ChevronUp className="w-5 h-5 text-slate-500 flex-shrink-0" />
        ) : (
          <ChevronDown className="w-5 h-5 text-slate-500 flex-shrink-0" />
        )}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function RootCauseAnalysis({ explanation }: Props) {
  const trendIcon =
    explanation.temporalContext.trendDirection === "worsening" ? (
      <ArrowUpRight className="w-4 h-4 text-red-400" />
    ) : explanation.temporalContext.trendDirection === "improving" ? (
      <ArrowDownRight className="w-4 h-4 text-green-400" />
    ) : (
      <ArrowRightLeft className="w-4 h-4 text-slate-600" />
    );

  return (
    <div className="space-y-5">
      {/* Headline / narrative banner */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-xl border border-blue-500/30 bg-gradient-to-br from-blue-900/40 via-slate-900/40 to-purple-900/30 p-6"
      >
        <div className="absolute -top-10 -right-10 opacity-20 pointer-events-none">
          <Sparkles className="w-40 h-40 text-blue-400" />
        </div>
        <div className="flex items-start gap-4 relative">
          <div className="p-3 rounded-xl bg-blue-500/20 border border-blue-500/40">
            <Brain className="w-6 h-6 text-blue-300" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 text-xs text-blue-300/80 mb-1">
              <Sparkles className="w-3 h-3" />
              <span>Explainable AI — Refined Root-Cause Analysis</span>
            </div>
            <h2 className="text-lg sm:text-xl font-semibold text-slate-900 leading-snug">
              {explanation.summary}
            </h2>
            {explanation.narrative && (
              <p className="text-sm text-slate-600 mt-3 leading-relaxed">
                {explanation.narrative}
              </p>
            )}
            {explanation.detailedExplanation && (
              <p className="text-sm text-slate-500 mt-3 leading-relaxed">
                {explanation.detailedExplanation}
              </p>
            )}
          </div>
        </div>
      </motion.div>

      {/* Likely Root Causes */}
      {explanation.likelyRootCauses.length > 0 && (
        <Section
          icon={Microscope}
          title="Likely Root Causes"
          subtitle="Pattern-matched hypotheses ranked by probability, with evidence and diagnostic steps"
          badge={
            <span className="ml-2 bg-blue-500/20 text-blue-300 text-xs px-2 py-0.5 rounded-full border border-blue-500/30">
              {explanation.likelyRootCauses.length}
            </span>
          }
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {explanation.likelyRootCauses.map((h, idx) => {
              const Icon = CATEGORY_ICONS[h.category] ?? HelpCircle;
              return (
                <motion.div
                  key={`${h.cause}-${idx}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.04 }}
                  className={`relative rounded-xl border bg-gradient-to-br p-5 ${
                    CATEGORY_COLORS[h.category] ?? CATEGORY_COLORS.unknown
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                      <Icon className="w-5 h-5 text-slate-700" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-semibold text-slate-900">{h.cause}</h4>
                        <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-50 border border-slate-200 text-slate-600">
                          #{idx + 1}
                        </span>
                      </div>

                      <div className="mt-3">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-slate-600">Probability</span>
                          <span className="font-semibold text-slate-900">
                            {Math.round(h.probability * 100)}%
                          </span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${h.probability * 100}%` }}
                            transition={{ duration: 0.6, ease: "easeOut" }}
                            className={`h-full rounded-full ${probabilityColor(h.probability)}`}
                          />
                        </div>
                      </div>

                      <p className="text-sm text-slate-700 mt-3 leading-relaxed">
                        {h.narrative}
                      </p>

                      {h.evidence.length > 0 && (
                        <div className="mt-3">
                          <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">
                            Evidence
                          </div>
                          <ul className="space-y-1">
                            {h.evidence.map((e, i) => (
                              <li
                                key={i}
                                className="text-xs text-slate-700 flex items-start gap-2"
                              >
                                <CheckCircle2 className="w-3 h-3 text-green-400 mt-0.5 flex-shrink-0" />
                                <span>{e}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {h.diagnosticSteps.length > 0 && (
                        <div className="mt-3">
                          <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">
                            Next steps to confirm
                          </div>
                          <ol className="space-y-1.5">
                            {h.diagnosticSteps.map((s, i) => (
                              <li
                                key={i}
                                className="text-xs text-slate-700 flex items-start gap-2"
                              >
                                <span className="flex-shrink-0 w-4 h-4 rounded-full bg-slate-100 border border-slate-200 text-[10px] flex items-center justify-center text-slate-600 font-semibold">
                                  {i + 1}
                                </span>
                                <span>{s}</span>
                              </li>
                            ))}
                          </ol>
                        </div>
                      )}

                      {h.affectedSources.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {h.affectedSources.map((src) => (
                            <span
                              key={src}
                              className="text-[11px] px-2 py-0.5 rounded-full bg-slate-50 border border-slate-200 text-slate-600"
                            >
                              {src}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Causal Chain */}
      {explanation.rootCauseChain.nodes.length > 0 && (
        <Section
          icon={GitBranch}
          title="Causal Chain"
          subtitle="How the suspected root cause connects to contributing factors and downstream effects"
        >
          <div className="flex flex-col gap-3">
            {explanation.rootCauseChain.nodes.map((n, i) => {
              const NodeIcon = NODE_TYPE_ICON[n.type];
              return (
                <div key={n.id}>
                  <div
                    className={`flex items-start gap-3 p-4 rounded-lg border bg-slate-50 ${
                      n.type === "root_cause"
                        ? "border-red-500/40"
                        : n.type === "contributing"
                          ? "border-amber-500/30"
                          : n.type === "effect"
                            ? "border-purple-500/30"
                            : "border-slate-200"
                    }`}
                  >
                    <div className="p-2 rounded-md bg-slate-50 border border-slate-200">
                      <NodeIcon className="w-4 h-4 text-slate-700" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-900">{n.label}</span>
                        <span className="text-[10px] uppercase tracking-wider text-slate-500">
                          {NODE_TYPE_LABEL[n.type]}
                        </span>
                        <span
                          className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ${SEVERITY_BADGE[n.severity]}`}
                        >
                          {n.severity}
                        </span>
                        <span className="text-[10px] text-slate-500">
                          confidence {Math.round(n.confidence * 100)}%
                        </span>
                      </div>
                      <p className="text-sm text-slate-600 mt-1 leading-relaxed">
                        {n.description}
                      </p>
                      {n.evidence.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {n.evidence.map((e, idx) => (
                            <span
                              key={idx}
                              className="text-[11px] px-2 py-0.5 rounded-full bg-slate-50 border border-slate-200 text-slate-600"
                            >
                              {e}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {i < explanation.rootCauseChain.nodes.length - 1 && (
                    <div className="flex justify-center my-1">
                      <ArrowRight className="w-4 h-4 text-slate-500 rotate-90" />
                    </div>
                  )}
                </div>
              );
            })}
            {explanation.rootCauseChain.edges.length > 0 && (
              <div className="text-xs text-slate-500 mt-2">
                <span className="font-medium text-slate-600">Relationships: </span>
                {explanation.rootCauseChain.edges
                  .map(
                    (e) =>
                      `${nodeLabel(explanation, e.from)} → ${e.relationship} → ${nodeLabel(
                        explanation,
                        e.to
                      )} (${Math.round(e.strength * 100)}%)`
                  )
                  .join(" · ")}
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Confidence breakdown */}
      <Section
        icon={Gauge}
        title="Confidence Breakdown"
        subtitle={`Overall confidence ${(
          explanation.confidenceBreakdown.overall * 100
        ).toFixed(0)}% — each factor contributes independently`}
        defaultOpen={false}
      >
        <div className="space-y-3">
          {explanation.confidenceBreakdown.factors.map((f, i) => (
            <div
              key={i}
              className="bg-slate-50 border border-slate-200 rounded-lg p-3"
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium text-slate-900">{f.factor}</span>
                <span className="text-xs text-slate-600">
                  {Math.round(f.contribution * 100)}%
                </span>
              </div>
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${f.contribution * 100}%` }}
                  className="h-full bg-blue-500 rounded-full"
                />
              </div>
              <p className="text-xs text-slate-500 mt-1.5">{f.reasoning}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Temporal context */}
      <Section
        icon={Clock4}
        title="Temporal Context"
        subtitle="When the issue is likely to escalate and what the timeline looks like"
        defaultOpen={false}
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
            <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">
              Time to failure
            </div>
            <div className="text-sm font-semibold text-slate-900">
              {explanation.temporalContext.timeToFailure}
            </div>
          </div>
          <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
            <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">
              Trend
            </div>
            <div className="text-sm font-semibold text-slate-900 flex items-center gap-1.5 capitalize">
              {trendIcon}
              {explanation.temporalContext.trendDirection}
            </div>
          </div>
          <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
            <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">
              Historical pattern
            </div>
            <div className="text-sm font-semibold text-slate-900">
              {explanation.temporalContext.historicalPattern}
            </div>
          </div>
        </div>

        {explanation.temporalContext.timeline.length > 0 && (
          <ol className="relative border-l border-slate-200 ml-2 space-y-3">
            {explanation.temporalContext.timeline.map((t, i) => (
              <li key={i} className="ml-4 relative">
                <div className="absolute -left-[1.43rem] top-1 w-3 h-3 rounded-full bg-blue-500 border-2 border-slate-900" />
                <div className="text-xs uppercase tracking-wider text-slate-500">
                  {t.phase}
                </div>
                <div className="text-sm text-slate-700">{t.description}</div>
              </li>
            ))}
          </ol>
        )}
      </Section>

      {/* Recommendations (rich) */}
      {explanation.recommendations.length > 0 && (
        <Section
          icon={ListChecks}
          title="Prioritized Recommendations"
          subtitle="Each action includes the reasoning and the expected impact"
          badge={
            <span className="ml-2 bg-blue-500/20 text-blue-300 text-xs px-2 py-0.5 rounded-full border border-blue-500/30">
              {explanation.recommendations.length}
            </span>
          }
        >
          <ul className="space-y-3">
            {explanation.recommendations.map((r, i) => (
              <li
                key={i}
                className="bg-slate-50 border border-slate-200 rounded-lg p-4"
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border flex-shrink-0 ${PRIORITY_STYLE[r.priority]}`}
                  >
                    {r.priority}
                  </span>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-slate-900">
                      {r.action}
                    </div>
                    <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-0.5">
                          Why
                        </div>
                        <div className="text-xs text-slate-600">{r.reasoning}</div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-0.5">
                          Expected impact
                        </div>
                        <div className="text-xs text-slate-600">
                          {r.expectedImpact}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Feature importance */}
      {explanation.featureImportance.length > 0 && (
        <Section
          icon={TrendingUp}
          title="Feature Importance"
          subtitle="Which signals contributed most to this verdict, and why"
          defaultOpen={false}
        >
          <div className="space-y-3">
            {explanation.featureImportance.map((f, i) => (
              <div
                key={i}
                className="bg-slate-50 border border-slate-200 rounded-lg p-3"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-900">
                      {f.feature}
                    </span>
                    <span
                      className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                        f.direction === "negative"
                          ? "bg-red-900/40 text-red-300 border-red-500/30"
                          : "bg-green-900/40 text-green-300 border-green-500/30"
                      }`}
                    >
                      {f.direction === "negative" ? "degrades health" : "healthy"}
                    </span>
                  </div>
                  <span className="text-xs text-slate-600">
                    {Math.round(f.importance * 100)}%
                  </span>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(f.importance, 1) * 100}%` }}
                    className={`h-full rounded-full ${
                      f.direction === "negative" ? "bg-red-500" : "bg-green-500"
                    }`}
                  />
                </div>
                <p className="text-xs text-slate-500 mt-1.5">{f.explanation}</p>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function nodeLabel(explanation: ExplainablePrediction, id: string): string {
  const node = explanation.rootCauseChain.nodes.find((n) => n.id === id);
  return node?.label ?? id;
}
