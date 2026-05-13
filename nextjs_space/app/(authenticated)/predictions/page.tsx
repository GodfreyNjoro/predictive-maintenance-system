"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Filter,
  Loader2,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  ThumbsUp,
  ThumbsDown,
  AlertCircle,
  CheckCircle,
  Send,
  X,
} from "lucide-react";
import { AlertBadge } from "@/components/alert-badge";
import ApplicationFilterChips from "@/components/application-filter-chips";

interface Prediction {
  id: string;
  predictionType: string;
  severity: string;
  confidence: number;
  anomalyScore: number;
  affectedSystem: string;
  description: string;
  predictedAt: string;
  logFile: { fileName: string; logSource: string } | null;
  feedback: { feedbackType: string; notes: string }[];
  modelVersion: { version: string };
}

export default function PredictionsPage() {
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [filters, setFilters] = useState({ severity: "", predictionType: "" });
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [feedbackModal, setFeedbackModal] = useState<{ predictionId: string; open: boolean }>({
    predictionId: "",
    open: false,
  });
  const [feedbackForm, setFeedbackForm] = useState({ feedbackType: "", notes: "" });
  const [submittingFeedback, setSubmittingFeedback] = useState(false);

  const fetchPredictions = async (page: number = 1) => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ page: page.toString(), limit: "10" });
      if (filters.severity) params.set("severity", filters.severity);
      if (filters.predictionType) params.set("predictionType", filters.predictionType);
      if (applicationId) params.set("applicationId", applicationId);

      const res = await fetch(`/api/predictions?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setPredictions(data?.predictions ?? []);
      setPagination(data?.pagination ?? { page: 1, totalPages: 1, total: 0 });
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPredictions(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, applicationId]);

  const submitFeedback = async () => {
    if (!feedbackForm.feedbackType) return;

    setSubmittingFeedback(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          predictionId: feedbackModal.predictionId,
          feedbackType: feedbackForm.feedbackType,
          notes: feedbackForm.notes,
        }),
      });

      if (!res.ok) throw new Error("Failed to submit feedback");

      setFeedbackModal({ predictionId: "", open: false });
      setFeedbackForm({ feedbackType: "", notes: "" });
      fetchPredictions(pagination.page);
    } catch (error) {
      console.error(error);
    } finally {
      setSubmittingFeedback(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Predictions</h1>
          <p className="text-slate-600 mt-1">Review system predictions and provide feedback</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={filters.severity}
            onChange={(e) => setFilters((prev) => ({ ...prev, severity: e.target.value }))}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          >
            <option value="">All Severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select
            value={filters.predictionType}
            onChange={(e) => setFilters((prev) => ({ ...prev, predictionType: e.target.value }))}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          >
            <option value="">All Types</option>
            <option value="failure">Failure</option>
            <option value="degradation">Degradation</option>
            <option value="normal">Normal</option>
          </select>
        </div>
      </div>

      {/* Cross-application filter chips */}
      <div className="bg-white rounded-xl shadow-sm p-4">
        <ApplicationFilterChips
          storageKey="pms.predictions.applicationId"
          onChange={setApplicationId}
        />
      </div>

      {/* Predictions List */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        </div>
      ) : predictions.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center">
          <AlertTriangle className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <p className="text-slate-600">No predictions found</p>
        </div>
      ) : (
        <div className="space-y-4">
          {predictions.map((pred, idx) => (
            <motion.div
              key={pred.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              className="bg-white rounded-xl shadow-sm p-6 hover:shadow-md transition-shadow"
            >
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-3">
                    <AlertBadge severity={pred?.severity as any} />
                    <span className="text-sm text-slate-500 capitalize">
                      {pred?.predictionType?.replace("_", " ")}
                    </span>
                    <span className="text-sm text-slate-400">•</span>
                    <span className="text-sm text-slate-500">
                      {pred?.affectedSystem?.replace("_", " ")}
                    </span>
                  </div>
                  <p className="text-slate-900 mb-2">{pred?.description}</p>
                  <div className="flex flex-wrap items-center gap-4 text-sm text-slate-500">
                    <span>Confidence: {((pred?.confidence ?? 0) * 100).toFixed(1)}%</span>
                    <span>Score: {(pred?.anomalyScore ?? 0).toFixed(3)}</span>
                    <span>Model: {pred?.modelVersion?.version}</span>
                    {pred?.logFile && (
                      <span className="text-blue-600">{pred.logFile.fileName}</span>
                    )}
                    <span>
                      {new Date(pred?.predictedAt ?? Date.now()).toLocaleString()}
                    </span>
                  </div>
                </div>

                {/* Feedback Section */}
                <div className="flex items-center gap-2">
                  {(pred?.feedback?.length ?? 0) > 0 ? (
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-lg">
                      {pred.feedback[0].feedbackType === "true_positive" && (
                        <><ThumbsUp className="w-4 h-4 text-emerald-500" />
                        <span className="text-sm text-emerald-700">True Positive</span></>
                      )}
                      {pred.feedback[0].feedbackType === "false_positive" && (
                        <><ThumbsDown className="w-4 h-4 text-red-500" />
                        <span className="text-sm text-red-700">False Positive</span></>
                      )}
                      {pred.feedback[0].feedbackType === "missed_incident" && (
                        <><AlertCircle className="w-4 h-4 text-amber-500" />
                        <span className="text-sm text-amber-700">Missed Incident</span></>
                      )}
                    </div>
                  ) : (
                    <button
                      onClick={() => setFeedbackModal({ predictionId: pred.id, open: true })}
                      className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium text-slate-700 transition-colors"
                    >
                      <MessageSquare className="w-4 h-4" />
                      Add Feedback
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between bg-white rounded-xl shadow-sm p-4">
          <p className="text-sm text-slate-600">
            Showing {((pagination.page - 1) * 10) + 1} to {Math.min(pagination.page * 10, pagination.total)} of {pagination.total}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchPredictions(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="p-2 hover:bg-slate-100 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="px-4 py-2 text-sm font-medium">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <button
              onClick={() => fetchPredictions(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
              className="p-2 hover:bg-slate-100 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Feedback Modal */}
      {feedbackModal.open && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">Submit Feedback</h3>
              <button
                onClick={() => setFeedbackModal({ predictionId: "", open: false })}
                className="p-2 hover:bg-slate-100 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Feedback Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { value: "true_positive", label: "True Positive", icon: ThumbsUp, color: "emerald" },
                    { value: "false_positive", label: "False Positive", icon: ThumbsDown, color: "red" },
                    { value: "missed_incident", label: "Missed", icon: AlertCircle, color: "amber" },
                  ].map((type) => (
                    <button
                      key={type.value}
                      onClick={() => setFeedbackForm((prev) => ({ ...prev, feedbackType: type.value }))}
                      className={`p-3 rounded-lg border-2 transition-all ${
                        feedbackForm.feedbackType === type.value
                          ? `border-${type.color}-500 bg-${type.color}-50`
                          : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <type.icon className={`w-5 h-5 mx-auto mb-1 ${
                        feedbackForm.feedbackType === type.value ? `text-${type.color}-600` : "text-slate-400"
                      }`} />
                      <p className="text-xs font-medium text-slate-700">{type.label}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Notes (Optional)</label>
                <textarea
                  value={feedbackForm.notes}
                  onChange={(e) => setFeedbackForm((prev) => ({ ...prev, notes: e.target.value }))}
                  placeholder="Add additional context..."
                  rows={3}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                />
              </div>

              <button
                onClick={submitFeedback}
                disabled={!feedbackForm.feedbackType || submittingFeedback}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {submittingFeedback ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <><Send className="w-4 h-4" /> Submit Feedback</>
                )}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}