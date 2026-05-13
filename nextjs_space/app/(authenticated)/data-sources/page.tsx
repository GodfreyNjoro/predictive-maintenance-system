"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Database,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Edit,
  Trash2,
  Play,
  Loader2,
  Server,
  Lock,
  Activity,
  Settings,
  History,
  AppWindow,
  ChevronRight,
  Info,
} from "lucide-react";
import { DataSourceDrawer } from "./data-source-drawer";
import { IngestionRunsPanel } from "./ingestion-runs-panel";

export interface DataSourceRow {
  id: string;
  name: string;
  kind: "MSSQL" | "POSTGRES" | "MYSQL" | "ORACLE";
  host: string;
  port: number;
  database: string;
  authMode: "SQL_AUTH" | "WINDOWS_AUTH" | "IAM" | "TOKEN";
  username: string | null;
  trustServerCert: boolean;
  enabled: boolean;
  spLoggingMode: "INSTRUMENTED" | "XEVENTS" | "NONE";
  enabledFeeds: string[];
  redactSqlText: boolean;
  defaultIntervalSec: number;
  feedIntervalsSec: Record<string, number> | null;
  connectionParams: Record<string, unknown> | null;
  lastTestedAt: string | null;
  lastTestResult: string | null;
  consecutiveFailures: number;
  createdAt: string;
  updatedAt: string;
  applicationId: string | null;
  application: { id: string; name: string; osType: "WINDOWS" | "LINUX" } | null;
  _count?: { ingestionRuns: number; watermarks: number };
}

export default function DataSourcesPage() {
  const [rows, setRows] = useState<DataSourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<DataSourceRow | null>(null);
  const [pendingTestId, setPendingTestId] = useState<string | null>(null);
  const [pendingRunId, setPendingRunId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [viewingRunsForId, setViewingRunsForId] = useState<string | null>(null);

  async function fetchAll() {
    setLoading(true);
    try {
      const r = await fetch("/api/data-sources", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setRows(j.dataSources ?? []);
    } catch (err) {
      console.error("Failed to fetch data sources:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAll();
  }, []);

  async function handleTest(id: string) {
    setPendingTestId(id);
    try {
      const r = await fetch(`/api/data-sources/${id}/test`, { method: "POST" });
      const j = await r.json();
      const result = j.result ?? {};
      const msg = result.ok
        ? `Connected${result.serverVersion ? ` — ${result.serverVersion}` : ""}`
        : `Failed: ${result.message ?? "unknown"}`;
      alert(msg);
      await fetchAll();
    } catch (err) {
      alert(`Test failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPendingTestId(null);
    }
  }

  async function handleRun(id: string) {
    setPendingRunId(id);
    try {
      const r = await fetch(`/api/data-sources/${id}/run`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) {
        alert(`Run failed: ${j.error ?? r.statusText}`);
      } else {
        const s = j.summary ?? {};
        alert(
          `Run summary — attempts: ${s.totalAttempts ?? 0}, ok: ${s.successes ?? 0}, errors: ${s.errors ?? 0}, skipped: ${s.skipped ?? 0}`,
        );
      }
      await fetchAll();
    } catch (err) {
      alert(`Run failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPendingRunId(null);
    }
  }

  async function handleDelete(id: string) {
    try {
      const r = await fetch(`/api/data-sources/${id}`, { method: "DELETE" });
      if (!r.ok) {
        const j = await r.json();
        alert(`Delete failed: ${j.error ?? r.statusText}`);
        return;
      }
      setConfirmDeleteId(null);
      await fetchAll();
    } catch (err) {
      alert(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  function openEdit(row: DataSourceRow) {
    setEditing(row);
    setDrawerOpen(true);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
            <span className="w-10 h-10 rounded-lg bg-blue-500 flex items-center justify-center">
              <Database className="w-5 h-5 text-white" />
            </span>
            All Data Sources
          </h1>
          <p className="text-slate-600 mt-1">
            Cross-application view of every database connection. To add a new one, open an application first.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchAll}
            className="inline-flex items-center gap-2 rounded-lg bg-white border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          <Link
            href="/applications"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors shadow-sm"
          >
            <AppWindow className="w-4 h-4" />
            Go to Applications
          </Link>
        </div>
      </div>

      {/* Info banner */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 flex items-start gap-3">
        <Info className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-blue-900">
          Data sources are now created from within each <Link href="/applications" className="underline font-medium">application</Link>. This page is a read-only roll-up across all applications.
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {rows.map((row) => (
            <DataSourceCard
              key={row.id}
              row={row}
              isPendingTest={pendingTestId === row.id}
              isPendingRun={pendingRunId === row.id}
              onTest={() => handleTest(row.id)}
              onRun={() => handleRun(row.id)}
              onEdit={() => openEdit(row)}
              onAskDelete={() => setConfirmDeleteId(row.id)}
              onViewRuns={() => setViewingRunsForId(row.id)}
            />
          ))}
        </div>
      )}

      {/* Drawer */}
      <DataSourceDrawer
        open={drawerOpen}
        editing={editing}
        onClose={() => setDrawerOpen(false)}
        onSaved={async () => {
          setDrawerOpen(false);
          await fetchAll();
        }}
      />

      {/* Delete confirmation */}
      <AnimatePresence>
        {confirmDeleteId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4"
            onClick={() => setConfirmDeleteId(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6"
            >
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                  <Trash2 className="w-5 h-5 text-red-600" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-slate-900">Delete data source?</h3>
                  <p className="text-sm text-slate-600 mt-1">
                    This removes the connection, its watermarks, and ingestion-run history.
                    Already-ingested ParsedLog rows are kept (their LogFile dataSourceId becomes null).
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button
                  onClick={() => setConfirmDeleteId(null)}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  onClick={() => confirmDeleteId && handleDelete(confirmDeleteId)}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Runs panel */}
      <AnimatePresence>
        {viewingRunsForId && (
          <IngestionRunsPanel
            dataSourceId={viewingRunsForId}
            onClose={() => setViewingRunsForId(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center">
      <div className="w-14 h-14 rounded-full bg-blue-50 mx-auto flex items-center justify-center mb-4">
        <Database className="w-7 h-7 text-blue-600" />
      </div>
      <h3 className="font-semibold text-slate-900 text-lg">No data sources configured yet</h3>
      <p className="text-sm text-slate-600 mt-1 max-w-md mx-auto">
        Data sources live inside Applications. Open an Application and use the &quot;Data sources&quot; tab to add your first connection.
      </p>
      <Link
        href="/applications"
        className="mt-5 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        <AppWindow className="w-4 h-4" />
        Go to Applications
      </Link>
    </div>
  );
}

function DataSourceCard(props: {
  row: DataSourceRow;
  isPendingTest: boolean;
  isPendingRun: boolean;
  onTest: () => void;
  onRun: () => void;
  onEdit: () => void;
  onAskDelete: () => void;
  onViewRuns: () => void;
}) {
  const { row, isPendingTest, isPendingRun, onTest, onRun, onEdit, onAskDelete, onViewRuns } = props;
  const lastResultBadge = renderLastResult(row.lastTestResult);
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition-shadow"
    >
      <div className="p-5 border-b border-slate-100">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${kindBadgeColor(row.kind)}`}>
              <Server className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-slate-900">{row.name}</h3>
                {!row.enabled && (
                  <span className="px-2 py-0.5 text-xs rounded-full bg-slate-100 text-slate-600">disabled</span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                {row.kind} · {row.host}
                {row.port ? `:${row.port}` : ""} · {row.database}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <IconButton onClick={onViewRuns} icon={History} title="View ingestion runs" />
            <IconButton onClick={onEdit} icon={Edit} title="Edit" />
            <IconButton onClick={onAskDelete} icon={Trash2} title="Delete" tone="danger" />
          </div>
        </div>
      </div>

      <div className="p-5 space-y-3 text-sm">
        <Row label="Auth" value={authLabel(row.authMode)} icon={Lock} />
        <Row label="Feeds enabled" value={row.enabledFeeds.length === 0 ? "jobHistory (default)" : row.enabledFeeds.join(", ")} icon={Activity} />
        <Row label="Cadence" value={`${row.defaultIntervalSec}s default`} icon={Settings} />
        {lastResultBadge && <Row label="Last test" value={lastResultBadge} icon={CheckCircle2} />}
        {row.consecutiveFailures > 0 && (
          <div className="flex items-center gap-2 text-sm text-red-600">
            <AlertTriangle className="w-4 h-4" />
            <span>{row.consecutiveFailures} consecutive failure(s)</span>
          </div>
        )}
      </div>

      <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between rounded-b-xl">
        <div className="text-xs text-slate-500">
          {row._count?.ingestionRuns ?? 0} runs · {row._count?.watermarks ?? 0} feeds tracked
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onTest}
            disabled={isPendingTest}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 disabled:opacity-50 transition-colors"
          >
            {isPendingTest ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
            Test
          </button>
          <button
            onClick={onRun}
            disabled={isPendingRun || !row.enabled}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {isPendingRun ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Run now
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function IconButton(props: {
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  tone?: "neutral" | "danger";
}) {
  const { onClick, icon: Icon, title, tone = "neutral" } = props;
  const cls =
    tone === "danger"
      ? "text-slate-400 hover:text-red-600 hover:bg-red-50"
      : "text-slate-400 hover:text-slate-700 hover:bg-slate-100";
  return (
    <button onClick={onClick} title={title} className={`p-1.5 rounded-md transition-colors ${cls}`}>
      <Icon className="w-4 h-4" />
    </button>
  );
}

function Row(props: { label: string; value: React.ReactNode; icon: React.ComponentType<{ className?: string }> }) {
  const { label, value, icon: Icon } = props;
  return (
    <div className="flex items-center gap-2">
      <Icon className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
      <span className="text-slate-500 w-28 flex-shrink-0">{label}</span>
      <span className="text-slate-700">{value}</span>
    </div>
  );
}

function kindBadgeColor(kind: string): string {
  switch (kind) {
    case "MSSQL":   return "bg-cyan-600";
    case "POSTGRES":return "bg-indigo-600";
    case "MYSQL":   return "bg-orange-500";
    case "ORACLE":  return "bg-red-600";
    default:        return "bg-slate-600";
  }
}

function authLabel(a: string): string {
  switch (a) {
    case "SQL_AUTH": return "SQL Authentication";
    case "WINDOWS_AUTH": return "Windows Authentication (NTLM)";
    case "IAM": return "IAM";
    case "TOKEN": return "Token";
    default: return a;
  }
}

function renderLastResult(s: string | null): React.ReactNode {
  if (!s) return null;
  if (s === "ok") {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-700">
        <CheckCircle2 className="w-3.5 h-3.5" />
        ok
      </span>
    );
  }
  if (s.startsWith("degraded")) {
    return (
      <span className="inline-flex items-center gap-1 text-amber-700">
        <AlertTriangle className="w-3.5 h-3.5" />
        degraded
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-red-700 truncate max-w-[260px]" title={s}>
      <XCircle className="w-3.5 h-3.5 flex-shrink-0" />
      {s}
    </span>
  );
}