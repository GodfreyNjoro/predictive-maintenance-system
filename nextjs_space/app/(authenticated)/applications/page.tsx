"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  AppWindow,
  Plus,
  RefreshCw,
  Server,
  Database,
  FileText,
  Loader2,
  Trash2,
  Edit,
  ChevronRight,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { ApplicationRow, osBadgeColor, osLabel } from "./types";

export default function ApplicationsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<ApplicationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  async function fetchAll() {
    setLoading(true);
    try {
      const r = await fetch("/api/applications", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setRows(j.applications ?? []);
    } catch (err) {
      console.error("Failed to fetch applications:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAll();
  }, []);

  async function handleDelete(id: string) {
    try {
      const r = await fetch(`/api/applications/${id}`, { method: "DELETE" });
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
            <span className="w-10 h-10 rounded-lg bg-blue-500 flex items-center justify-center">
              <AppWindow className="w-5 h-5 text-white" />
            </span>
            Applications
          </h1>
          <p className="text-slate-600 mt-1">
            Add the applications you want to monitor. Each application can have its own data sources, log uploads, and predictive analysis.
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
          <button
            onClick={() => router.push("/applications/new")}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Add Application
          </button>
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState onAdd={() => router.push("/applications/new")} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {rows.map((row) => (
            <ApplicationCard
              key={row.id}
              row={row}
              onOpen={() => router.push(`/applications/${row.id}`)}
              onAskDelete={() => setConfirmDeleteId(row.id)}
            />
          ))}
        </div>
      )}

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
                  <h3 className="font-semibold text-slate-900">Delete application?</h3>
                  <p className="text-sm text-slate-600 mt-1">
                    This removes the application record. Linked data sources and logs will be detached (set to "Unassigned") but their data is preserved.
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
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center">
      <div className="w-14 h-14 rounded-full bg-blue-50 mx-auto flex items-center justify-center mb-4">
        <AppWindow className="w-7 h-7 text-blue-600" />
      </div>
      <h3 className="font-semibold text-slate-900 text-lg">No applications yet</h3>
      <p className="text-sm text-slate-600 mt-1 max-w-md mx-auto">
        An application is a Windows or Linux system you want to monitor. Add one first, then
        attach its data sources and start ingesting telemetry.
      </p>
      <button
        onClick={onAdd}
        className="mt-5 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        <Plus className="w-4 h-4" />
        Add Application
      </button>
    </div>
  );
}

function ApplicationCard(props: {
  row: ApplicationRow;
  onOpen: () => void;
  onAskDelete: () => void;
}) {
  const { row, onOpen, onAskDelete } = props;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition-shadow flex flex-col"
    >
      <button
        onClick={onOpen}
        className="text-left p-5 border-b border-slate-100 hover:bg-slate-50 transition-colors rounded-t-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${osBadgeColor(row.osType)}`}>
              <Server className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-slate-900 truncate">{row.name}</h3>
              <p className="text-xs text-slate-500 truncate">
                {osLabel(row.osType)}
                {row.environment ? ` · ${row.environment}` : ""}
                {row.hostname ? ` · ${row.hostname}` : ""}
              </p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0 mt-2" />
        </div>

        {row.description && (
          <p className="text-sm text-slate-600 mt-3 line-clamp-2">{row.description}</p>
        )}
      </button>

      <div className="p-4 grid grid-cols-2 gap-2 text-xs">
        <Stat icon={Database} label="Data sources" value={row._count?.dataSources ?? 0} />
        <Stat icon={FileText} label="Log files" value={row._count?.logFiles ?? 0} />
      </div>

      <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between rounded-b-xl">
        <Link
          href={`/applications/${row.id}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
        >
          <Edit className="w-3.5 h-3.5" />
          Manage
        </Link>
        <button
          onClick={onAskDelete}
          className="text-slate-400 hover:text-red-600 hover:bg-red-50 p-1 rounded"
          title="Delete"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </motion.div>
  );
}

function Stat(props: { icon: React.ComponentType<{ className?: string }>; label: string; value: number }) {
  const { icon: Icon, label, value } = props;
  return (
    <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 border border-slate-100">
      <Icon className="w-3.5 h-3.5 text-slate-400" />
      <div className="min-w-0">
        <div className="font-semibold text-slate-900">{value}</div>
        <div className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</div>
      </div>
    </div>
  );
}
