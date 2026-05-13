"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  History,
  Loader2,
  ChevronLeft,
  ChevronRight,
  FileText,
  Brain,
  MessageSquare,
  Upload,
  RefreshCw,
  User,
  Clock,
} from "lucide-react";

interface AuditEntry {
  id: string;
  action: string;
  details: string;
  createdAt: string;
  user: { name: string; email: string } | null;
  prediction: { predictionType: string; severity: string; confidence: number } | null;
}

const actionConfig: Record<string, { icon: typeof FileText; label: string; color: string }> = {
  file_uploaded: { icon: Upload, label: "File Uploaded", color: "blue" },
  prediction_made: { icon: Brain, label: "Prediction Made", color: "purple" },
  feedback_submitted: { icon: MessageSquare, label: "Feedback Submitted", color: "emerald" },
  model_retrained: { icon: RefreshCw, label: "Model Retrained", color: "orange" },
};

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [actionFilter, setActionFilter] = useState("");

  const fetchAudit = async (page: number = 1) => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ page: page.toString(), limit: "20" });
      if (actionFilter) params.set("action", actionFilter);

      const res = await fetch(`/api/audit?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setEntries(data?.entries ?? []);
      setPagination(data?.pagination ?? { page: 1, totalPages: 1, total: 0 });
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAudit(1);
  }, [actionFilter]);

  const parseDetails = (details: string) => {
    try {
      return JSON.parse(details);
    } catch {
      return {};
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Audit Trail</h1>
          <p className="text-slate-600 mt-1">Track all system activities for compliance and review</p>
        </div>
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
        >
          <option value="">All Actions</option>
          <option value="file_uploaded">File Uploads</option>
          <option value="prediction_made">Predictions</option>
          <option value="feedback_submitted">Feedback</option>
          <option value="model_retrained">Model Retraining</option>
        </select>
      </div>

      {/* Audit Table */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        </div>
      ) : entries.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center">
          <History className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <p className="text-slate-600">No audit entries found</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900">Action</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900">User</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900">Details</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entries.map((entry, idx) => {
                  const config = actionConfig[entry?.action] ?? { icon: FileText, label: entry?.action, color: "slate" };
                  const Icon = config.icon;
                  const details = parseDetails(entry?.details ?? "{}");

                  return (
                    <motion.tr
                      key={entry.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: idx * 0.02 }}
                      className="hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg bg-${config.color}-100`}>
                            <Icon className={`w-4 h-4 text-${config.color}-600`} />
                          </div>
                          <span className="font-medium text-slate-900">{config.label}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center">
                            <User className="w-4 h-4 text-slate-500" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-slate-900">
                              {entry?.user?.name ?? "System"}
                            </p>
                            <p className="text-xs text-slate-500">{entry?.user?.email ?? ""}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-slate-600 max-w-md">
                          {entry?.action === "file_uploaded" && details?.fileName && (
                            <span>Uploaded <span className="font-medium">{details.fileName}</span></span>
                          )}
                          {entry?.action === "prediction_made" && details?.predictionType && (
                            <span>
                              <span className="capitalize">{details.severity}</span>{" "}
                              {details.predictionType} detected ({((details.confidence ?? 0) * 100).toFixed(0)}% confidence)
                            </span>
                          )}
                          {entry?.action === "feedback_submitted" && details?.feedbackType && (
                            <span>Marked as <span className="font-medium capitalize">{details.feedbackType?.replace("_", " ")}</span></span>
                          )}
                          {entry?.action === "model_retrained" && details?.newVersion && (
                            <span>
                              Trained {details.newVersion} with {details.trainingSamples} samples
                              ({details.feedbackIncluded} feedback entries)
                            </span>
                          )}
                          {!details?.fileName && !details?.predictionType && !details?.feedbackType && !details?.newVersion && (
                            <span className="text-slate-400">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2 text-sm text-slate-500">
                          <Clock className="w-4 h-4" />
                          {new Date(entry?.createdAt ?? Date.now()).toLocaleString()}
                        </div>
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200">
              <p className="text-sm text-slate-600">
                Showing {((pagination.page - 1) * 20) + 1} to {Math.min(pagination.page * 20, pagination.total)} of {pagination.total}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => fetchAudit(pagination.page - 1)}
                  disabled={pagination.page <= 1}
                  className="p-2 hover:bg-slate-100 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <span className="px-4 py-2 text-sm font-medium">
                  Page {pagination.page} of {pagination.totalPages}
                </span>
                <button
                  onClick={() => fetchAudit(pagination.page + 1)}
                  disabled={pagination.page >= pagination.totalPages}
                  className="p-2 hover:bg-slate-100 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}