"use client";

import { useState, useCallback, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  Upload,
  FileText,
  CheckCircle,
  AlertCircle,
  Loader2,
  X,
  Server,
  Database,
  Activity,
  Sparkles,
  Eye,
  Archive,
} from "lucide-react";

type FileType = "csv" | "txt" | "json" | "gz" | "zip" | "tar.gz" | "tgz" | "tar";

interface DetectedFormat {
  format: string;
  confidence: number;
  fields: { name: string; type: string }[];
}

interface UploadState {
  file: File | null;
  logSource: string;
  status: "idle" | "uploading" | "processing" | "success" | "error";
  message: string;
  progress: number;
  detectedFormat: DetectedFormat | null;
}

const commonSources = [
  { value: "windows_event", label: "Windows Event", icon: Server },
  { value: "linux_syslog", label: "Linux Syslog", icon: Server },
  { value: "database", label: "Database", icon: Database },
  { value: "application", label: "Application", icon: Activity },
  { value: "network", label: "Network", icon: Activity },
  { value: "security", label: "Security", icon: Server },
];

interface AppSummary {
  id: string;
  name: string;
  osType: "WINDOWS" | "LINUX";
}

export default function UploadPage() {
  const searchParams = useSearchParams();
  const applicationId = searchParams?.get("applicationId") ?? null;

  const [uploadState, setUploadState] = useState<UploadState>({
    file: null,
    logSource: "",
    status: "idle",
    message: "",
    progress: 0,
    detectedFormat: null,
  });
  const [dragActive, setDragActive] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [appSummary, setAppSummary] = useState<AppSummary | null>(null);

  // Load the application context (if scoped)
  useEffect(() => {
    if (!applicationId) return;
    let cancelled = false;
    fetch(`/api/applications/${applicationId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.application) return;
        setAppSummary({
          id: j.application.id,
          name: j.application.name,
          osType: j.application.osType,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  // Auto-detect format when file changes
  useEffect(() => {
    if (!uploadState.file) return;
    
    const detectFormat = async () => {
      setIsDetecting(true);
      try {
        const text = await uploadState.file!.text();
        const lines = text.split("\n").filter(l => l.trim()).slice(0, 20);
        
        let format = "custom";
        let confidence = 0.5;
        let fields: { name: string; type: string }[] = [];
        
        // Try JSON
        try {
          const parsed = JSON.parse(text);
          format = "json";
          confidence = 0.95;
          const sample = Array.isArray(parsed) ? parsed[0] : parsed;
          if (sample && typeof sample === "object") {
            fields = Object.keys(sample).slice(0, 6).map(k => ({
              name: k,
              type: inferType(String(sample[k]))
            }));
          }
        } catch {
          // Try NDJSON
          try {
            const first = JSON.parse(lines[0]);
            format = "json";
            confidence = 0.85;
            if (first && typeof first === "object") {
              fields = Object.keys(first).slice(0, 6).map(k => ({
                name: k,
                type: inferType(String(first[k]))
              }));
            }
          } catch {
            // Try CSV
            const firstLine = lines[0] || "";
            if (firstLine.includes(",")) {
              const headers = firstLine.split(",").map(h => h.trim());
              const dataLine = lines[1]?.split(",") || [];
              if (headers.length > 1 && headers.length === dataLine.length) {
                format = "csv";
                confidence = 0.9;
                fields = headers.slice(0, 6).map((h, i) => ({
                  name: h.replace(/["']/g, ""),
                  type: inferType(dataLine[i] || "")
                }));
              }
            }
            // Check for syslog
            else if (/^<\d+>/.test(firstLine) || /^\w{3}\s+\d{1,2}\s+\d{2}:\d{2}/.test(firstLine)) {
              format = "syslog";
              confidence = 0.85;
              fields = [
                { name: "timestamp", type: "timestamp" },
                { name: "hostname", type: "source" },
                { name: "message", type: "message" }
              ];
            }
            // Check for Windows event pattern
            else if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(firstLine)) {
              format = "windows";
              confidence = 0.8;
              fields = [
                { name: "timestamp", type: "timestamp" },
                { name: "level", type: "level" },
                { name: "source", type: "source" },
                { name: "message", type: "message" }
              ];
            }
          }
        }
        
        setUploadState(prev => ({
          ...prev,
          detectedFormat: { format, confidence, fields },
          logSource: prev.logSource || format
        }));
      } catch {
        // Ignore detection errors
      } finally {
        setIsDetecting(false);
      }
    };
    
    detectFormat();
  }, [uploadState.file]);
  
  const inferType = (value: string): string => {
    if (/\d{4}-\d{2}-\d{2}/.test(value) || /\d{2}\/\d{2}\/\d{4}/.test(value)) return "timestamp";
    if (["error", "warning", "info", "debug", "critical"].includes(value.toLowerCase())) return "level";
    if (value.length > 50) return "message";
    if (!isNaN(Number(value))) return "number";
    return "string";
  };

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const validateFile = (file: File): { valid: boolean; type: FileType | null; error?: string; isCompressed?: boolean } => {
    const fileName = file.name.toLowerCase();
    
    // Check for compressed formats first
    const compressedFormats: { ext: string; type: FileType }[] = [
      { ext: ".tar.gz", type: "tar.gz" },
      { ext: ".tgz", type: "tgz" },
      { ext: ".gz", type: "gz" },
      { ext: ".zip", type: "zip" },
      { ext: ".tar", type: "tar" },
    ];
    
    for (const format of compressedFormats) {
      if (fileName.endsWith(format.ext)) {
        if (file.size > 100 * 1024 * 1024) {
          return { valid: false, type: null, error: "Compressed file too large. Maximum size is 100MB." };
        }
        return { valid: true, type: format.type, isCompressed: true };
      }
    }
    
    // Check regular log formats
    const validExtensions = [".csv", ".txt", ".json", ".log", ".ndjson", ".jsonl"];
    const ext = fileName.slice(fileName.lastIndexOf("."));
    
    if (!validExtensions.includes(ext)) {
      return { valid: false, type: null, error: "Invalid file type. Please upload CSV, TXT, JSON, or compressed files (.gz, .zip, .tar.gz)." };
    }
    
    if (file.size > 50 * 1024 * 1024) {
      return { valid: false, type: null, error: "File too large. Maximum size is 50MB." };
    }
    
    return { valid: true, type: (ext === ".log" || ext === ".ndjson" || ext === ".jsonl" ? "txt" : ext.slice(1)) as FileType };
  };
  
  const isCompressedFile = (fileName: string): boolean => {
    const lower = fileName.toLowerCase();
    return lower.endsWith(".gz") || lower.endsWith(".zip") || lower.endsWith(".tar") || lower.endsWith(".tgz");
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const file = e.dataTransfer?.files?.[0];
    if (file) {
      const validation = validateFile(file);
      if (validation.valid) {
        setUploadState((prev) => ({ ...prev, file, status: "idle", message: "" }));
      } else {
        setUploadState((prev) => ({ ...prev, status: "error", message: validation.error ?? "Invalid file" }));
      }
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const validation = validateFile(file);
      if (validation.valid) {
        setUploadState((prev) => ({ ...prev, file, status: "idle", message: "" }));
      } else {
        setUploadState((prev) => ({ ...prev, status: "error", message: validation.error ?? "Invalid file" }));
      }
    }
  };

  const handleUpload = async () => {
    if (!uploadState.file) return;

    const validation = validateFile(uploadState.file);
    if (!validation.valid || !validation.type) return;

    setUploadState((prev) => ({ ...prev, status: "uploading", progress: 0 }));

    try {
      // Get upload URL (works for both S3 and local storage)
      const presignedRes = await fetch("/api/upload/presigned", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: uploadState.file.name,
          contentType: uploadState.file.type || "application/octet-stream",
          isPublic: false,
        }),
      });

      if (!presignedRes.ok) throw new Error("Failed to get upload URL");
      const { uploadUrl, cloud_storage_path, storageMode } = await presignedRes.json();

      setUploadState((prev) => ({ ...prev, progress: 30 }));

      // Upload file - method depends on storage mode
      if (storageMode === "local") {
        // Local storage: use PUT to our local endpoint
        const uploadRes = await fetch(uploadUrl, {
          method: "PUT",
          body: uploadState.file,
        });
        if (!uploadRes.ok) throw new Error("Failed to upload file locally");
      } else {
        // S3: use presigned URL
        const uploadRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": uploadState.file?.type || "application/octet-stream" },
          body: uploadState.file,
        });
        if (!uploadRes.ok) throw new Error("Failed to upload file to S3");
      }

      setUploadState((prev) => ({ ...prev, status: "processing", progress: 60 }));

      // Complete upload and trigger processing
      const completeRes = await fetch("/api/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cloud_storage_path,
          isPublic: false,
          fileName: uploadState.file?.name,
          fileType: validation.type,
          logSource: uploadState.logSource,
          fileSize: uploadState.file?.size,
          applicationId: applicationId ?? null,
        }),
      });

      if (!completeRes.ok) throw new Error("Failed to process file");

      setUploadState((prev) => ({
        ...prev,
        status: "success",
        progress: 100,
        message: "File uploaded and processing started. Predictions will be available shortly.",
      }));
    } catch (error) {
      setUploadState((prev) => ({
        ...prev,
        status: "error",
        message: error instanceof Error ? error.message : "Upload failed",
      }));
    }
  };

  const resetUpload = () => {
    setUploadState({
      file: null,
      logSource: "",
      status: "idle",
      message: "",
      progress: 0,
      detectedFormat: null,
    });
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Upload Log Files</h1>
        <p className="text-slate-600 mt-1">Upload any type of log files for AI-powered analysis and predictions</p>
      </div>

      {/* Application context banner */}
      {applicationId && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center">
              <Server className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-medium text-blue-900">
                Scoped to application{appSummary ? `: ${appSummary.name}` : ""}
              </p>
              <p className="text-xs text-blue-700">
                The uploaded file will be linked to this application.
              </p>
            </div>
          </div>
          {appSummary && (
            <Link
              href={`/applications/${appSummary.id}`}
              className="text-xs font-medium text-blue-700 hover:text-blue-800 underline whitespace-nowrap"
            >
              Back to {appSummary.name}
            </Link>
          )}
        </motion.div>
      )}

      {!applicationId && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-500 flex items-center justify-center">
              <AlertCircle className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-medium text-amber-900">No application selected</p>
              <p className="text-xs text-amber-700">
                Uploading without an application context. To scope this upload, open it from an Application&apos;s Log Files tab.
              </p>
            </div>
          </div>
          <Link
            href="/applications"
            className="text-xs font-medium text-amber-700 hover:text-amber-800 underline whitespace-nowrap"
          >
            View applications
          </Link>
        </motion.div>
      )}

      {/* Log Source Selection */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-xl shadow-sm p-6"
      >
        <h3 className="text-lg font-semibold text-slate-900 mb-4">Specify Log Source</h3>
        
        {/* Custom input */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Log Source Name
          </label>
          <input
            type="text"
            value={uploadState.logSource}
            onChange={(e) => setUploadState((prev) => ({ ...prev, logSource: e.target.value }))}
            placeholder="e.g., nginx_access, apache_error, kubernetes..."
            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-slate-900"
          />
        </div>

        {/* Quick select presets */}
        <div>
          <p className="text-sm text-slate-500 mb-2">Or quick select:</p>
          <div className="flex flex-wrap gap-2">
            {commonSources.map((source) => (
              <button
                key={source.value}
                onClick={() => setUploadState((prev) => ({ ...prev, logSource: source.value }))}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-all ${
                  uploadState.logSource === source.value
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                <source.icon className="w-3.5 h-3.5" />
                {source.label}
              </button>
            ))}
          </div>
        </div>
      </motion.div>

      {/* File Upload */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-white rounded-xl shadow-sm p-6"
      >
        <h3 className="text-lg font-semibold text-slate-900 mb-4">Upload File</h3>

        {!uploadState.file ? (
          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors ${
              dragActive
                ? "border-blue-500 bg-blue-50"
                : "border-slate-300 hover:border-slate-400"
            }`}
          >
            <Upload className="w-12 h-12 text-slate-400 mx-auto mb-4" />
            <p className="text-slate-600 mb-2">Drag and drop your log file here, or</p>
            <label className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg cursor-pointer transition-colors">
              <FileText className="w-4 h-4" />
              Browse Files
              <input
                type="file"
                accept=".csv,.txt,.json,.log,.ndjson,.jsonl,.gz,.zip,.tar,.tgz,.tar.gz"
                onChange={handleFileSelect}
                className="hidden"
              />
            </label>
            <p className="text-sm text-slate-500 mt-4">
              Supported: CSV, TXT, JSON, LOG (max 50MB) | Compressed: ZIP, GZ, TAR.GZ (max 100MB)
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Selected File */}
            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${isCompressedFile(uploadState.file.name) ? "bg-purple-100" : "bg-blue-100"}`}>
                  {isCompressedFile(uploadState.file.name) ? (
                    <Archive className="w-5 h-5 text-purple-600" />
                  ) : (
                    <FileText className="w-5 h-5 text-blue-600" />
                  )}
                </div>
                <div>
                  <p className="font-medium text-slate-900">{uploadState.file.name}</p>
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-slate-500">
                      {uploadState.file.size > 1024 * 1024
                        ? `${(uploadState.file.size / (1024 * 1024)).toFixed(1)} MB`
                        : `${(uploadState.file.size / 1024).toFixed(1)} KB`}
                    </p>
                    {isCompressedFile(uploadState.file.name) && (
                      <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full font-medium">
                        Compressed
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {uploadState.status === "idle" && (
                <button
                  onClick={resetUpload}
                  className="p-2 hover:bg-slate-200 rounded-lg transition-colors"
                >
                  <X className="w-4 h-4 text-slate-500" />
                </button>
              )}
            </div>

            {/* Auto-Detected Format */}
            {isDetecting && (
              <div className="flex items-center gap-2 p-4 bg-blue-50 rounded-lg border border-blue-200">
                <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                <span className="text-sm text-blue-700">Analyzing log format...</span>
              </div>
            )}
            {uploadState.detectedFormat && !isDetecting && (
              <div className="p-4 bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg border border-purple-200">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="w-5 h-5 text-purple-600" />
                  <span className="font-semibold text-purple-900">Auto-Detected Format</span>
                  <span className={`ml-auto px-2 py-0.5 rounded-full text-xs font-medium ${
                    uploadState.detectedFormat.confidence > 0.8
                      ? "bg-green-100 text-green-700"
                      : uploadState.detectedFormat.confidence > 0.6
                      ? "bg-yellow-100 text-yellow-700"
                      : "bg-slate-100 text-slate-600"
                  }`}>
                    {(uploadState.detectedFormat.confidence * 100).toFixed(0)}% confidence
                  </span>
                </div>
                <div className="flex items-center gap-4 mb-3">
                  <span className="px-3 py-1 bg-white rounded-lg text-sm font-medium text-slate-700 border">
                    {uploadState.detectedFormat.format.toUpperCase()}
                  </span>
                  <span className="text-sm text-slate-600">
                    {uploadState.detectedFormat.fields.length} fields detected
                  </span>
                </div>
                {uploadState.detectedFormat.fields.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {uploadState.detectedFormat.fields.map((field, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-white rounded text-xs border"
                      >
                        <Eye className="w-3 h-3 text-slate-400" />
                        <span className="font-medium text-slate-700">{field.name}</span>
                        <span className="text-slate-400">({field.type})</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Progress/Status */}
            {uploadState.status !== "idle" && (
              <div className="space-y-2">
                <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      uploadState.status === "error" ? "bg-red-500" : "bg-blue-500"
                    }`}
                    style={{ width: `${uploadState.progress}%` }}
                  />
                </div>
                <div className="flex items-center gap-2">
                  {uploadState.status === "uploading" && (
                    <><Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                    <span className="text-sm text-slate-600">Uploading...</span></>
                  )}
                  {uploadState.status === "processing" && (
                    <><Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                    <span className="text-sm text-slate-600">Processing logs and generating predictions...</span></>
                  )}
                  {uploadState.status === "success" && (
                    <><CheckCircle className="w-4 h-4 text-emerald-500" />
                    <span className="text-sm text-emerald-600">{uploadState.message}</span></>
                  )}
                  {uploadState.status === "error" && (
                    <><AlertCircle className="w-4 h-4 text-red-500" />
                    <span className="text-sm text-red-600">{uploadState.message}</span></>
                  )}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              {uploadState.status === "idle" && (
                <button
                  onClick={handleUpload}
                  className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
                >
                  <Upload className="w-4 h-4" />
                  Upload & Analyze
                </button>
              )}
              {(uploadState.status === "success" || uploadState.status === "error") && (
                <button
                  onClick={resetUpload}
                  className="flex items-center gap-2 px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg transition-colors"
                >
                  Upload Another File
                </button>
              )}
            </div>
          </div>
        )}

        {uploadState.status === "error" && !uploadState.file && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
            <AlertCircle className="w-4 h-4" />
            <span className="text-sm">{uploadState.message}</span>
          </div>
        )}
      </motion.div>

      {/* Instructions */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-slate-100 rounded-xl p-6"
      >
        <h3 className="text-lg font-semibold text-slate-900 mb-3">File Format Guidelines</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
          <div className="bg-white rounded-lg p-4">
            <p className="font-medium text-slate-900 mb-2">CSV Files</p>
            <p className="text-slate-600">Should include columns for timestamp, level/severity, source, and message.</p>
          </div>
          <div className="bg-white rounded-lg p-4">
            <p className="font-medium text-slate-900 mb-2">JSON Files</p>
            <p className="text-slate-600">Array of log objects or object with &quot;logs&quot; array property.</p>
          </div>
          <div className="bg-white rounded-lg p-4">
            <p className="font-medium text-slate-900 mb-2">TXT/LOG Files</p>
            <p className="text-slate-600">Standard log format: [timestamp] [level] [source] message</p>
          </div>
          <div className="bg-white rounded-lg p-4 border-2 border-purple-200">
            <div className="flex items-center gap-2 mb-2">
              <Archive className="w-4 h-4 text-purple-600" />
              <p className="font-medium text-slate-900">Compressed Files</p>
            </div>
            <p className="text-slate-600">Upload .gz, .zip, or .tar.gz archives. Log files inside will be auto-extracted and processed.</p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}