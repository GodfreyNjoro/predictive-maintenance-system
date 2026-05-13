"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Server,
  Database,
  FileText,
  Calendar,
  Globe,
  Tag,
  Loader2,
  Activity,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";
import { ApplicationRow, osBadgeColor, osLabel } from "../../types";

interface HealthSummary {
  totalLogFiles: number;
  totalDataSources: number;
  totalPredictions: number;
  highSeverityCount: number;
  lastIngestionAt: string | null;
}

export function OverviewTab({ app }: { app: ApplicationRow }) {
  const [summary, setSummary] = useState<HealthSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const r = await fetch(`/api/applications/${app.id}/summary`, { cache: "no-store" });
        if (!r.ok) {
          if (cancelled) return;
          setSummary(null);
          return;
        }
        const j = await r.json();
        if (!cancelled) setSummary(j.summary ?? null);
      } catch {
        if (!cancelled) setSummary(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [app.id]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">Application</h2>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${osBadgeColor(app.osType)}`}>
              <Server className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900 text-lg">{app.name}</h3>
              <p className="text-xs text-slate-500">{osLabel(app.osType)}</p>
            </div>
          </div>

          {app.description && (
            <p className="text-sm text-slate-700 whitespace-pre-wrap">{app.description}</p>
          )}

          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            {app.environment && (
              <Field icon={Tag} label="Environment" value={app.environment} />
            )}
            {app.hostname && (
              <Field icon={Globe} label="Hostname" value={app.hostname} />
            )}
            <Field
              icon={Calendar}
              label="Created"
              value={new Date(app.createdAt).toLocaleString()}
            />
            <Field
              icon={Calendar}
              label="Last updated"
              value={new Date(app.updatedAt).toLocaleString()}
            />
          </dl>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">Health</h2>
        </div>
        <div className="p-5 space-y-3 text-sm">
          {loading ? (
            <div className="flex items-center gap-2 text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading
            </div>
          ) : (
            <>
              <Counter
                icon={Database}
                label="Data sources"
                value={summary?.totalDataSources ?? app._count?.dataSources ?? 0}
              />
              <Counter
                icon={FileText}
                label="Log files"
                value={summary?.totalLogFiles ?? app._count?.logFiles ?? 0}
              />
              <Counter
                icon={Activity}
                label="Predictions"
                value={summary?.totalPredictions ?? 0}
              />
              <Counter
                icon={summary && summary.highSeverityCount > 0 ? AlertCircle : CheckCircle2}
                label="High severity (24h)"
                value={summary?.highSeverityCount ?? 0}
                tone={summary && summary.highSeverityCount > 0 ? "danger" : "ok"}
              />
              {summary?.lastIngestionAt && (
                <div className="text-xs text-slate-500 pt-2 border-t border-slate-100">
                  Last ingestion: {new Date(summary.lastIngestionAt).toLocaleString()}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="lg:col-span-3 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">Quick links</h2>
        </div>
        <div className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <QuickLink
            href={`/system-analysis?applicationId=${app.id}`}
            icon={Activity}
            title="System analysis"
            description="Drill into telemetry and parsed events"
          />
          <QuickLink
            href={`/predictions?applicationId=${app.id}`}
            icon={AlertCircle}
            title="Predictions"
            description="Recent failure-risk forecasts"
          />
          <QuickLink
            href={`/dashboard?applicationId=${app.id}`}
            icon={Server}
            title="Dashboard"
            description="Health overview & charts"
          />
        </div>
      </div>
    </div>
  );
}

function Field(props: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
}) {
  const { icon: Icon, label, value } = props;
  return (
    <div className="flex items-start gap-2">
      <Icon className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
      <div>
        <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
        <dd className="text-sm text-slate-700 mt-0.5">{value}</dd>
      </div>
    </div>
  );
}

function Counter(props: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone?: "ok" | "danger" | "neutral";
}) {
  const { icon: Icon, label, value, tone = "neutral" } = props;
  const colors =
    tone === "ok"
      ? "text-emerald-700"
      : tone === "danger"
        ? "text-red-700"
        : "text-slate-700";
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-slate-500">
        <Icon className={`w-4 h-4 ${tone === "danger" ? "text-red-500" : tone === "ok" ? "text-emerald-500" : "text-slate-400"}`} />
        <span className="text-sm">{label}</span>
      </div>
      <span className={`text-base font-semibold ${colors}`}>{value}</span>
    </div>
  );
}

function QuickLink(props: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  const { href, icon: Icon, title, description } = props;
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50 hover:border-slate-300 transition-colors group"
    >
      <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
        <Icon className="w-5 h-5 text-blue-600" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-slate-900 text-sm">{title}</p>
        <p className="text-xs text-slate-500 line-clamp-1">{description}</p>
      </div>
      <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-blue-600 flex-shrink-0" />
    </Link>
  );
}
