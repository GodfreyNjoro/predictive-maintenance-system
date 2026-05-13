"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  AppWindow,
  ChevronLeft,
  Loader2,
  CheckCircle2,
  Server,
  Sparkles,
} from "lucide-react";
import type { OsType } from "../types";

export default function NewApplicationPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isOnboarding = searchParams?.get("onboarding") === "1";
  const [name, setName] = useState("");
  const [osType, setOsType] = useState<OsType>("LINUX");
  const [environment, setEnvironment] = useState("production");
  const [hostname, setHostname] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent, addDataSourceAfter: boolean) {
    e.preventDefault();
    setError(null);
    if (name.trim().length < 2) {
      setError("Name must be at least 2 characters.");
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch("/api/applications", {
        method: "POST",
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
      const appId = j.application?.id as string | undefined;
      if (!appId) {
        setError("Application created but id missing in response.");
        return;
      }
      if (addDataSourceAfter) {
        router.push(`/applications/${appId}?tab=sources&action=create`);
      } else {
        router.push(`/applications/${appId}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      {!isOnboarding && (
        <Link
          href="/applications"
          className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 mb-4"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to applications
        </Link>
      )}

      {isOnboarding && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 flex items-start gap-3"
        >
          <Sparkles className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-blue-900">Welcome — let&apos;s add your first application</p>
            <p className="text-xs text-blue-700 mt-0.5">
              Every data source, log upload, and prediction is scoped under an Application. Tell us what you want to monitor.
            </p>
          </div>
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden"
      >
        <div className="p-6 border-b border-slate-200 bg-gradient-to-br from-blue-50 to-white">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center">
              <AppWindow className="w-5 h-5 text-white" />
            </span>
            <div>
              <h1 className="text-xl font-bold text-slate-900">
                {isOnboarding ? "Add your first application" : "Add a new application"}
              </h1>
              <p className="text-sm text-slate-600">
                Tell us a bit about the system you want to monitor.
              </p>
            </div>
          </div>
        </div>

        <form className="p-6 space-y-5" onSubmit={(e) => handleSubmit(e, false)}>
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Application name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Order Service, Reporting DB, Web Frontend"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
              minLength={2}
              maxLength={120}
            />
          </div>

          {/* OS type */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Operating system <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <OsRadio
                value="WINDOWS"
                selected={osType === "WINDOWS"}
                onSelect={() => setOsType("WINDOWS")}
                label="Windows"
                description="Server / Desktop, Performance Counters, Windows Event Log"
                colorClass="bg-sky-600"
              />
              <OsRadio
                value="LINUX"
                selected={osType === "LINUX"}
                onSelect={() => setOsType("LINUX")}
                label="Linux"
                description="Any distro, /proc, syslog, journald, node_exporter"
                colorClass="bg-emerald-600"
              />
            </div>
          </div>

          {/* Environment */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Environment</label>
            <select
              value={environment}
              onChange={(e) => setEnvironment(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="production">production</option>
              <option value="staging">staging</option>
              <option value="development">development</option>
              <option value="test">test</option>
              <option value="">(none)</option>
            </select>
          </div>

          {/* Hostname */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Hostname (optional)</label>
            <input
              type="text"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              placeholder="e.g. prod-app-01.example.com"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              maxLength={255}
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this application do? Any context that helps later."
              rows={3}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              maxLength={1000}
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center justify-end gap-3 pt-2 border-t border-slate-100">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-lg bg-white border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Create &amp; configure later
            </button>
            <button
              type="button"
              onClick={(e) => handleSubmit(e, true)}
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Server className="w-4 h-4" />}
              Create &amp; add data source
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function OsRadio(props: {
  value: OsType;
  selected: boolean;
  onSelect: () => void;
  label: string;
  description: string;
  colorClass: string;
}) {
  const { selected, onSelect, label, description, colorClass } = props;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`text-left rounded-lg border-2 p-4 transition-colors ${
        selected
          ? "border-blue-500 bg-blue-50/40"
          : "border-slate-200 bg-white hover:border-slate-300"
      }`}
    >
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-md ${colorClass} flex items-center justify-center flex-shrink-0`}>
          <Server className="w-4 h-4 text-white" />
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-slate-900">{label}</div>
          <div className="text-[11px] text-slate-500">{description}</div>
        </div>
      </div>
    </button>
  );
}
