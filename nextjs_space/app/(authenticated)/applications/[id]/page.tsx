"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Server,
  ChevronLeft,
  Loader2,
  Database,
  FileText,
  Settings,
  LayoutDashboard,
  AlertTriangle,
  Trash2,
  Save,
  Plus,
} from "lucide-react";
import type { ApplicationRow, OsType } from "../types";
import { osBadgeColor, osLabel } from "../types";
import { DataSourcesTab } from "./_components/data-sources-tab";
import { OverviewTab } from "./_components/overview-tab";
import { LogsTab } from "./_components/logs-tab";

type TabId = "overview" | "sources" | "logs" | "settings";

const TABS: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "sources", label: "Data Sources", icon: Database },
  { id: "logs", label: "Log Files", icon: FileText },
  { id: "settings", label: "Settings", icon: Settings },
];

export default function ApplicationDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = params?.id as string;

  const [app, setApp] = useState<ApplicationRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const initialTab = useMemo<TabId>(() => {
    const t = searchParams?.get("tab");
    if (t === "sources" || t === "logs" || t === "settings" || t === "overview") return t;
    return "overview";
  }, [searchParams]);
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);

  async function fetchApp() {
    setLoading(true);
    try {
      const r = await fetch(`/api/applications/${id}`, { cache: "no-store" });
      if (r.status === 404) {
        setNotFound(true);
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setApp(j.application ?? null);
    } catch (err) {
      console.error("Failed to fetch application:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (id) fetchApp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function setTab(tab: TabId) {
    setActiveTab(tab);
    // also reflect in URL for shareable links
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    url.searchParams.delete("action");
    window.history.replaceState({}, "", url.toString());
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-12 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (notFound || !app) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
        <h2 className="font-semibold text-lg text-slate-900">Application not found</h2>
        <p className="text-sm text-slate-600 mt-1">It may have been deleted.</p>
        <Link
          href="/applications"
          className="mt-4 inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to applications
        </Link>
      </div>
    );
  }

  const initialAction = searchParams?.get("action");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/applications"
          className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 mb-3"
        >
          <ChevronLeft className="w-4 h-4" />
          All applications
        </Link>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${osBadgeColor(app.osType)}`}>
              <Server className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{app.name}</h1>
              <p className="text-sm text-slate-500">
                {osLabel(app.osType)}
                {app.environment ? ` · ${app.environment}` : ""}
                {app.hostname ? ` · ${app.hostname}` : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Database className="w-3.5 h-3.5" />
            <span>{app._count?.dataSources ?? 0} data sources</span>
            <span>·</span>
            <FileText className="w-3.5 h-3.5" />
            <span>{app._count?.logFiles ?? 0} log files</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <div className="flex flex-wrap gap-1">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setTab(tab.id)}
                className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  active
                    ? "border-blue-600 text-blue-700"
                    : "border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300"
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <div>
        <AnimatePresence mode="wait">
          {activeTab === "overview" && (
            <motion.div
              key="overview"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <OverviewTab app={app} />
            </motion.div>
          )}
          {activeTab === "sources" && (
            <motion.div
              key="sources"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <DataSourcesTab applicationId={app.id} initialAction={initialAction === "create" ? "create" : null} />
            </motion.div>
          )}
          {activeTab === "logs" && (
            <motion.div
              key="logs"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <LogsTab applicationId={app.id} />
            </motion.div>
          )}
          {activeTab === "settings" && (
            <motion.div
              key="settings"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <SettingsTab
                app={app}
                onSaved={fetchApp}
                onDeleted={() => router.push("/applications")}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Settings tab (inline, edit + delete)
// ----------------------------------------------------------------------------
function SettingsTab(props: { app: ApplicationRow; onSaved: () => void; onDeleted: () => void }) {
  const { app, onSaved, onDeleted } = props;
  const [name, setName] = useState(app.name);
  const [osType, setOsType] = useState<OsType>(app.osType);
  const [environment, setEnvironment] = useState(app.environment ?? "");
  const [hostname, setHostname] = useState(app.hostname ?? "");
  const [description, setDescription] = useState(app.description ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const r = await fetch(`/api/applications/${app.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          osType,
          environment: environment.trim() || null,
          hostname: hostname.trim() || null,
          description: description.trim() || null,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j.error ?? `HTTP ${r.status}`);
        return;
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    setSubmitting(true);
    try {
      const r = await fetch(`/api/applications/${app.id}`, { method: "DELETE" });
      if (!r.ok) {
        const j = await r.json();
        setError(j.error ?? `HTTP ${r.status}`);
        return;
      }
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <form
        onSubmit={handleSave}
        className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">Application details</h2>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
              minLength={2}
              maxLength={120}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Operating system</label>
            <select
              value={osType}
              onChange={(e) => setOsType(e.target.value as OsType)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="WINDOWS">Windows</option>
              <option value="LINUX">Linux</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Environment</label>
              <select
                value={environment}
                onChange={(e) => setEnvironment(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="production">production</option>
                <option value="staging">staging</option>
                <option value="development">development</option>
                <option value="test">test</option>
                <option value="">(none)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Hostname</label>
              <input
                type="text"
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                maxLength={255}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              maxLength={1000}
            />
          </div>
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-end">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save changes
          </button>
        </div>
      </form>

      <div className="rounded-xl border border-red-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-red-100">
          <h2 className="text-sm font-semibold text-red-700 uppercase tracking-wide">Danger zone</h2>
        </div>
        <div className="p-5 flex items-center justify-between gap-4">
          <div>
            <h3 className="font-medium text-slate-900">Delete this application</h3>
            <p className="text-sm text-slate-600 mt-0.5">
              Removes the application record. Linked data sources and log files are detached but preserved.
            </p>
          </div>
          <button
            onClick={() => setConfirmDelete(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
        </div>
      </div>

      <AnimatePresence>
        {confirmDelete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4"
            onClick={() => setConfirmDelete(false)}
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
                  <h3 className="font-semibold text-slate-900">Delete &quot;{app.name}&quot;?</h3>
                  <p className="text-sm text-slate-600 mt-1">
                    Linked data sources and log files will become unassigned but their data will be preserved.
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={submitting}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
                >
                  {submitting ? "Deleting..." : "Delete"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
