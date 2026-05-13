"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  X,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Clock,
  History,
  RefreshCw,
} from "lucide-react";

interface IngestionRunRow {
  id: string;
  feed: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  rowsFetched: number;
  rowsEmitted: number;
  cursorBefore: unknown;
  cursorAfter: unknown;
  errorMessage: string | null;
}

interface DataSourceMeta {
  id: string;
  name: string;
  kind: string;
}

export function IngestionRunsPanel(props: {
  dataSourceId: string;
  onClose: () => void;
}) {
  const { dataSourceId, onClose } = props;
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [runs, setRuns] = useState<IngestionRunRow[]>([]);
  const [ds, setDs] = useState<DataSourceMeta | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fetchRuns(opts: { silent?: boolean } = {}) {
    if (!opts.silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const r = await fetch(`/api/data-sources/${dataSourceId}/runs?limit=100`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.success) {
        throw new Error(j?.error ?? `HTTP ${r.status}`);
      }
      setDs(j.dataSource ?? null);
      setRuns(j.runs ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    fetchRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSourceId]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-slate-900/50 z-50 flex items-stretch justify-end"
      onClick={onClose}
    >
      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "tween", duration: 0.25 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full max-w-3xl h-full overflow-y-auto shadow-2xl flex flex-col"
      >
        {/* Header */}
        <div className="sticky top-0 bg-white z-10 border-b border-slate-200 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
              <History className="w-5 h-5 text-slate-700" />
            </div>
            <div>
              <h2 className="font-semibold text-slate-900">Ingestion runs</h2>
              <p className="text-xs text-slate-500">
                {ds ? `${ds.name} · ${ds.kind}` : "Loading…"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => fetchRuns({ silent: true })}
              disabled={refreshing || loading}
              title="Refresh"
              className="p-2 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={onClose}
              title="Close"
              className="p-2 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            </div>
          ) : error ? (
            <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
              Failed to load runs: {error}
            </div>
          ) : runs.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-slate-200 p-10 text-center">
              <Clock className="w-10 h-10 mx-auto text-slate-300" />
              <p className="mt-3 font-medium text-slate-700">No ingestion runs yet</p>
              <p className="text-sm text-slate-500 mt-1">
                Click <strong>Run now</strong> on the data source card to trigger an immediate pull.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {runs.map((run) => (
                <RunRow key={run.id} run={run} />
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

function RunRow({ run }: { run: IngestionRunRow }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50"
      >
        <div className="flex items-center gap-3 min-w-0">
          <StatusBadge status={run.status} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-slate-900 text-sm">{run.feed}</span>
              <span className="text-xs text-slate-500">{formatDate(run.startedAt)}</span>
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              {run.rowsEmitted} emitted / {run.rowsFetched} fetched
              {run.durationMs != null && ` · ${(run.durationMs / 1000).toFixed(2)}s`}
            </div>
          </div>
        </div>
        <span className="text-xs text-slate-400">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="border-t border-slate-100 px-4 py-3 bg-slate-50 text-xs space-y-2">
          {run.errorMessage && (
            <div className="rounded bg-red-50 border border-red-200 p-2 text-red-700">
              <div className="font-medium">Error</div>
              <div className="font-mono whitespace-pre-wrap break-all">{run.errorMessage}</div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <CursorBlock label="Cursor before" value={run.cursorBefore} />
            <CursorBlock label="Cursor after" value={run.cursorAfter} />
          </div>
          <div className="text-slate-500">
            Started {formatDate(run.startedAt)} · Finished {run.finishedAt ? formatDate(run.finishedAt) : "—"}
          </div>
        </div>
      )}
    </div>
  );
}

function CursorBlock({ label, value }: { label: string; value: unknown }) {
  const text = value == null ? "null" : JSON.stringify(value, null, 2);
  return (
    <div className="rounded bg-white border border-slate-200 p-2">
      <div className="text-slate-500 mb-1">{label}</div>
      <pre className="font-mono whitespace-pre-wrap break-all text-slate-800 text-[11px]">
        {text}
      </pre>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "ok") {
    return (
      <div title="ok" className="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
        <CheckCircle2 className="w-4 h-4 text-green-600" />
      </div>
    );
  }
  if (status === "partial") {
    return (
      <div title="partial" className="w-7 h-7 rounded-full bg-yellow-100 flex items-center justify-center flex-shrink-0">
        <AlertTriangle className="w-4 h-4 text-yellow-600" />
      </div>
    );
  }
  return (
    <div title={status} className="w-7 h-7 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
      <XCircle className="w-4 h-4 text-red-600" />
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}
