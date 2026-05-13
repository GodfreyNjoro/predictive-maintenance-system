"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  FileText,
  Loader2,
  Upload,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  HardDrive,
  Tag,
} from "lucide-react";

interface LogFileRow {
  id: string;
  fileName: string;
  fileType: string;
  logSource: string;
  fileSize: number;
  status: string;
  recordCount: number | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export function LogsTab({ applicationId }: { applicationId: string }) {
  const [rows, setRows] = useState<LogFileRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function fetchAll() {
    setLoading(true);
    try {
      const r = await fetch(`/api/applications/${applicationId}/logs`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setRows(j.logFiles ?? []);
    } catch (err) {
      console.error("Failed to fetch log files:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Log files</h2>
          <p className="text-xs text-slate-500">Historical or batch log files uploaded for this application.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchAll}
            className="inline-flex items-center gap-2 rounded-lg bg-white border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          <Link
            href={`/upload?applicationId=${applicationId}`}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 shadow-sm"
          >
            <Upload className="w-4 h-4" />
            Upload to this app
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState applicationId={applicationId} />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">File</th>
                  <th className="text-left px-4 py-3 font-medium">Source</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-right px-4 py-3 font-medium">Records</th>
                  <th className="text-right px-4 py-3 font-medium">Size</th>
                  <th className="text-left px-4 py-3 font-medium">Uploaded</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900 truncate">{row.fileName}</p>
                          <p className="text-xs text-slate-500 uppercase">{row.fileType}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-xs text-slate-600">
                        <Tag className="w-3 h-3" />
                        {row.logSource}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={row.status} errorMessage={row.errorMessage} />
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700 tabular-nums">
                      {row.recordCount?.toLocaleString() ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500 text-xs">
                      <span className="inline-flex items-center gap-1">
                        <HardDrive className="w-3 h-3" />
                        {formatBytes(row.fileSize)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {new Date(row.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ applicationId }: { applicationId: string }) {
  return (
    <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center">
      <div className="w-14 h-14 rounded-full bg-blue-50 mx-auto flex items-center justify-center mb-4">
        <FileText className="w-7 h-7 text-blue-600" />
      </div>
      <h3 className="font-semibold text-slate-900 text-lg">No log files yet</h3>
      <p className="text-sm text-slate-600 mt-1 max-w-md mx-auto">
        Upload a log file (CSV / JSON / TXT / archive) to backfill historical events into this application.
      </p>
      <Link
        href={`/upload?applicationId=${applicationId}`}
        className="mt-5 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        <Upload className="w-4 h-4" />
        Upload a log file
      </Link>
    </div>
  );
}

function StatusBadge({ status, errorMessage }: { status: string; errorMessage: string | null }) {
  if (status === "processed") {
    return (
      <motion.span
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200"
      >
        <CheckCircle2 className="w-3 h-3" />
        processed
      </motion.span>
    );
  }
  if (status === "processing") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-blue-50 text-blue-700 border border-blue-200">
        <Loader2 className="w-3 h-3 animate-spin" />
        processing
      </span>
    );
  }
  if (status === "error") {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-red-50 text-red-700 border border-red-200 max-w-xs truncate"
        title={errorMessage ?? undefined}
      >
        <XCircle className="w-3 h-3" />
        error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-slate-100 text-slate-700 border border-slate-200">
      <Clock className="w-3 h-3" />
      {status}
    </span>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
