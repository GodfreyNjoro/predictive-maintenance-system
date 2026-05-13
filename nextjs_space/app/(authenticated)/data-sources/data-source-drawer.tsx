"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, X, AlertTriangle, Activity } from "lucide-react";
import type { DataSourceRow } from "./page";

interface FormState {
  name: string;
  kind: "MSSQL" | "POSTGRES" | "MYSQL" | "ORACLE";
  host: string;
  port: string;
  database: string;
  authMode: "SQL_AUTH" | "WINDOWS_AUTH" | "IAM" | "TOKEN";
  username: string;
  password: string;
  passwordTouched: boolean;
  domain: string;
  trustServerCert: boolean;
  enabled: boolean;
  enabledFeeds: string[];
  redactSqlText: boolean;
  defaultIntervalSec: string;
  spLoggingMode: "NONE" | "INSTRUMENTED" | "XEVENTS";
  encrypt: boolean;
  instance: string;
}

/** Feed options vary by DbKind. The drawer dynamically filters by selected kind. */
const ALL_FEED_OPTIONS: { id: string; label: string; hint?: string; kinds: string[] }[] = [
  // MSSQL feeds
  { id: "jobHistory", label: "Job history (msdb)", kinds: ["MSSQL"] },
  {
    id: "queryStore",
    label: "Query Store / pg_stat_statements / digest stats",
    hint: "MSSQL: Requires Query Store READ_WRITE. Postgres: Requires pg_stat_statements extension. MySQL: performance_schema.",
    kinds: ["MSSQL", "POSTGRES", "MYSQL"],
  },
  {
    id: "spExec",
    label: "Stored procedures (instrumented)",
    hint: "Requires dbo.PMS_SP_ExecutionLog (see scripts/mssql-bootstrap-phase2.sql) and SP logging mode INSTRUMENTED.",
    kinds: ["MSSQL"],
  },
  {
    id: "waitStats",
    label: "Wait statistics",
    hint: "MSSQL: DMV snapshots (sys.dm_os_wait_stats). Postgres: pg_stat_activity wait events. MySQL: perf_schema wait summary.",
    kinds: ["MSSQL", "POSTGRES", "MYSQL"],
  },
  {
    id: "ioStats",
    label: "File IO latency",
    hint: "MSSQL: sys.dm_io_virtual_file_stats. Postgres: pg_stat_io. MySQL: file_summary_by_instance.",
    kinds: ["MSSQL", "POSTGRES", "MYSQL"],
  },
  {
    id: "xevents",
    label: "Extended Events (deadlocks / timeouts / errors)",
    hint: "Requires a running pms_collector or system_health XE session. Run scripts/mssql-bootstrap-phase4.sql to create.",
    kinds: ["MSSQL"],
  },
  {
    id: "errorLog",
    label: "Server error log",
    hint: "MSSQL: sp_readerrorlog. Requires VIEW SERVER STATE or sysadmin membership.",
    kinds: ["MSSQL"],
  },
  {
    id: "osMetrics",
    label: "OS metrics (CPU/RAM/disk/connections)",
    hint: "MSSQL: DMVs (sys.dm_os_*). Postgres: pg_stat_activity + pg_stat_database. MySQL: SHOW GLOBAL STATUS.",
    kinds: ["MSSQL", "POSTGRES", "MYSQL"],
  },
  // --- Application-server feeds (pushed via Edge Collector) ---
  {
    id: "appMetrics",
    label: "App metrics (throughput/latency/errors/threads)",
    hint: "Via Edge Collector agent on the APP server. OTel, Application Insights, or custom APM.",
    kinds: ["MSSQL", "POSTGRES", "MYSQL"],
  },
  {
    id: "appLogs",
    label: "App logs (structured exceptions/events)",
    hint: "Via Edge Collector. Serilog, NLog, log4net, or OpenTelemetry log exporter.",
    kinds: ["MSSQL", "POSTGRES", "MYSQL"],
  },
  {
    id: "windowsEventLog",
    label: "Windows Event Log (Application/System)",
    hint: "Via Edge Collector. Captures .NET crashes, service failures, app pool events, unexpected reboots.",
    kinds: ["MSSQL", "POSTGRES", "MYSQL"],
  },
  {
    id: "iisLogs",
    label: "IIS access logs (W3C)",
    hint: "Via Edge Collector. HTTP status codes, request latency, queue length, app pool recycles.",
    kinds: ["MSSQL", "POSTGRES", "MYSQL"],
  },
  {
    id: "networkMetrics",
    label: "Network metrics (app ↔ DB latency/retransmits)",
    hint: "Via Edge Collector. RTT, TCP retransmissions, port exhaustion, DNS resolution. Critical for split-server setups.",
    kinds: ["MSSQL", "POSTGRES", "MYSQL"],
  },
];

/** Feeds the connector layer can actually pull. Other feeds remain greyed-out
 *  until their phase ships. */
const ENABLED_FEED_IDS = new Set([
  "jobHistory",
  "queryStore",
  "spExec",
  "waitStats",
  "ioStats",
  "xevents",
  "errorLog",
  "osMetrics",
  // Phase 7 – app-server / split-server feeds (via Edge Collector)
  "appMetrics",
  "appLogs",
  "windowsEventLog",
  "iisLogs",
  "networkMetrics",
]);

function defaultPort(kind: FormState["kind"]): string {
  switch (kind) {
    case "MSSQL": return "1433";
    case "POSTGRES": return "5432";
    case "MYSQL": return "3306";
    case "ORACLE": return "1521";
  }
}

function emptyForm(): FormState {
  return {
    name: "",
    kind: "MSSQL",
    host: "",
    port: "1433",
    database: "msdb",
    authMode: "SQL_AUTH",
    username: "",
    password: "",
    passwordTouched: false,
    domain: "",
    trustServerCert: true,
    enabled: true,
    enabledFeeds: ["jobHistory"],
    redactSqlText: false,
    defaultIntervalSec: "60",
    spLoggingMode: "NONE",
    encrypt: true,
    instance: "",
  };
}

function formFromRow(r: DataSourceRow): FormState {
  const cp = (r.connectionParams ?? {}) as Record<string, unknown>;
  return {
    name: r.name,
    kind: r.kind,
    host: r.host,
    port: String(r.port),
    database: r.database,
    authMode: r.authMode,
    username: r.username ?? "",
    password: "",
    passwordTouched: false,
    domain: typeof cp.domain === "string" ? cp.domain : "",
    trustServerCert: r.trustServerCert,
    enabled: r.enabled,
    enabledFeeds: r.enabledFeeds.length > 0 ? r.enabledFeeds : ["jobHistory"],
    redactSqlText: r.redactSqlText,
    defaultIntervalSec: String(r.defaultIntervalSec),
    spLoggingMode: r.spLoggingMode,
    encrypt: typeof cp.encrypt === "boolean" ? cp.encrypt : true,
    instance: typeof cp.instance === "string" ? cp.instance : "",
  };
}

function connectionParamsFor(form: FormState): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (form.kind === "MSSQL") {
    if (form.instance) out.instance = form.instance;
    if (form.authMode === "WINDOWS_AUTH" && form.domain) out.domain = form.domain;
    out.encrypt = form.encrypt;
  }
  return out;
}

export function DataSourceDrawer(props: {
  open: boolean;
  editing: DataSourceRow | null;
  onClose: () => void;
  onSaved: () => void;
  /** Pre-bind a new data source to this application. Required when creating from
   *  /applications/[id]; ignored when editing. */
  applicationId?: string | null;
}) {
  const { open, editing, onClose, onSaved, applicationId } = props;
  const [form, setForm] = useState<FormState>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    | null
    | { ok: boolean; message: string; serverVersion?: string; capabilities?: Record<string, boolean | string | number> }
  >(null);

  useEffect(() => {
    if (open) {
      setError(null);
      setTestResult(null);
      setForm(editing ? formFromRow(editing) : emptyForm());
    }
  }, [open, editing]);

  const isEdit = !!editing;

  const portChanged = useMemo(() => {
    return form.port !== defaultPort(form.kind);
  }, [form.kind, form.port]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function toggleFeed(id: string) {
    setForm((f) => {
      const has = f.enabledFeeds.includes(id);
      return {
        ...f,
        enabledFeeds: has ? f.enabledFeeds.filter((x) => x !== id) : [...f.enabledFeeds, id],
      };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isEdit && !applicationId) {
      setError("Open this dialog from an application to add a data source.");
      return;
    }
    setSubmitting(true);
    try {
      const portNum = parseInt(form.port, 10);
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        kind: form.kind,
        host: form.host.trim(),
        port: Number.isFinite(portNum) ? portNum : 1433,
        database: form.database.trim(),
        authMode: form.authMode,
        username: form.username.trim() || null,
        trustServerCert: form.trustServerCert,
        enabled: form.enabled,
        spLoggingMode: form.spLoggingMode,
        enabledFeeds: form.enabledFeeds,
        redactSqlText: form.redactSqlText,
        defaultIntervalSec: parseInt(form.defaultIntervalSec, 10) || 60,
        connectionParams: connectionParamsFor(form),
      };
      // Only send password if user touched the field (or for new records).
      if (!isEdit) {
        payload.password = form.password;
      } else if (form.passwordTouched) {
        payload.password = form.password;
      }

      // Bind to the calling application (only on create — edit keeps existing app).
      if (!isEdit && applicationId) {
        payload.applicationId = applicationId;
      }

      const url = isEdit ? `/api/data-sources/${editing!.id}` : "/api/data-sources";
      const method = isEdit ? "PATCH" : "POST";
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTest() {
    if (!isEdit) {
      setTestResult({
        ok: false,
        message: "Save the data source first — 'Test Connection' uses the stored credentials.",
      });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const r = await fetch(`/api/data-sources/${editing!.id}/test`, { method: "POST" });
      const j = await r.json();
      setTestResult(j.result ?? { ok: false, message: "Unknown error" });
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-40 bg-slate-900/50"
          onClick={onClose}
        >
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", duration: 0.25 }}
            className="fixed top-0 right-0 bottom-0 w-full max-w-2xl bg-white shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {isEdit ? "Edit data source" : "Add data source"}
                </h2>
                <p className="text-xs text-slate-500">
                  Credentials are encrypted with AES-256-GCM (PMS_DSN_KEY) before storage.
                </p>
              </div>
              <button onClick={onClose} className="p-2 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100">
                <X className="w-5 h-5" />
              </button>
            </header>

            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
              {/* Identity */}
              <Section title="Identity">
                <Field label="Name" required>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => update("name", e.target.value)}
                    className="input"
                    placeholder="PROD-SQL-01"
                  />
                </Field>
                <Field label="Kind" required>
                  <select
                    value={form.kind}
                    onChange={(e) => {
                      const newKind = e.target.value as FormState["kind"];
                      setForm((f) => ({
                        ...f,
                        kind: newKind,
                        port: portChanged ? f.port : defaultPort(newKind),
                      }));
                    }}
                    className="input"
                  >
                    <option value="MSSQL">Microsoft SQL Server</option>
                    <option value="POSTGRES" disabled>PostgreSQL (Phase 5)</option>
                    <option value="MYSQL" disabled>MySQL (Phase 5)</option>
                    <option value="ORACLE" disabled>Oracle (Phase 5)</option>
                  </select>
                </Field>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Host" required>
                    <input
                      type="text"
                      required
                      value={form.host}
                      onChange={(e) => update("host", e.target.value)}
                      className="input"
                      placeholder="sql.corp.example.com"
                    />
                  </Field>
                  <Field label="Port" required>
                    <input
                      type="number"
                      required
                      value={form.port}
                      onChange={(e) => update("port", e.target.value)}
                      className="input"
                    />
                  </Field>
                  <Field label="Database" required>
                    <input
                      type="text"
                      required
                      value={form.database}
                      onChange={(e) => update("database", e.target.value)}
                      className="input"
                      placeholder="msdb"
                    />
                  </Field>
                </div>
                {form.kind === "MSSQL" && (
                  <Field label="Named instance (optional)" hint="Leave blank when using a TCP port directly. Overrides port.">
                    <input
                      type="text"
                      value={form.instance}
                      onChange={(e) => update("instance", e.target.value)}
                      className="input"
                      placeholder="SQL2K22"
                    />
                  </Field>
                )}
              </Section>

              {/* Auth */}
              <Section title="Authentication">
                <Field label="Mode" required>
                  <select
                    value={form.authMode}
                    onChange={(e) => update("authMode", e.target.value as FormState["authMode"])}
                    className="input"
                  >
                    <option value="SQL_AUTH">SQL Authentication</option>
                    <option value="WINDOWS_AUTH">Windows Authentication (NTLM)</option>
                    <option value="IAM" disabled>IAM (later)</option>
                    <option value="TOKEN" disabled>Token (later)</option>
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Username" required>
                    <input
                      type="text"
                      required
                      value={form.username}
                      onChange={(e) => update("username", e.target.value)}
                      className="input"
                      placeholder="pms_collector"
                    />
                  </Field>
                  <Field
                    label={isEdit ? "Password (leave blank to keep)" : "Password"}
                    required={!isEdit}
                  >
                    <input
                      type="password"
                      required={!isEdit}
                      value={form.password}
                      onChange={(e) => {
                        update("password", e.target.value);
                        update("passwordTouched", true);
                      }}
                      className="input"
                      autoComplete="new-password"
                    />
                  </Field>
                </div>
                {form.authMode === "WINDOWS_AUTH" && (
                  <Field label="Windows domain" required hint="Required for NTLM. e.g. CORP">
                    <input
                      type="text"
                      required
                      value={form.domain}
                      onChange={(e) => update("domain", e.target.value)}
                      className="input"
                      placeholder="CORP"
                    />
                  </Field>
                )}
                <div className="flex flex-wrap gap-x-6 gap-y-2 mt-2">
                  <Toggle
                    label="Trust server certificate (typical for self-signed on-prem)"
                    checked={form.trustServerCert}
                    onChange={(v) => update("trustServerCert", v)}
                  />
                  {form.kind === "MSSQL" && (
                    <Toggle
                      label="Encrypt connection"
                      checked={form.encrypt}
                      onChange={(v) => update("encrypt", v)}
                    />
                  )}
                </div>
              </Section>

              {/* Feeds */}
              <Section
                title="Feeds"
                description="Select the feeds to pull from this data source. Available feeds depend on the database kind."
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {ALL_FEED_OPTIONS.filter((opt) => opt.kinds.includes(form.kind)).map((opt) => {
                    const isAvailable = ENABLED_FEED_IDS.has(opt.id);
                    return (
                      <label
                        key={opt.id}
                        className={`flex items-start gap-2 p-2 rounded-md border ${
                          isAvailable ? "border-slate-200" : "border-slate-100 bg-slate-50 opacity-60"
                        }`}
                      >
                        <input
                          type="checkbox"
                          disabled={!isAvailable}
                          checked={form.enabledFeeds.includes(opt.id)}
                          onChange={() => toggleFeed(opt.id)}
                          className="mt-1"
                        />
                        <div className="flex flex-col">
                          <span className="text-sm text-slate-700">{opt.label}</span>
                          {opt.hint && isAvailable && (
                            <span className="text-xs text-slate-500 mt-0.5">{opt.hint}</span>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </Section>

              {/* Operational */}
              <Section title="Operational">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Default cadence (s)">
                    <input
                      type="number"
                      min="0"
                      value={form.defaultIntervalSec}
                      onChange={(e) => update("defaultIntervalSec", e.target.value)}
                      className="input"
                    />
                  </Field>
                  {form.kind === "MSSQL" && (
                    <Field label="SP logging mode">
                      <select
                        value={form.spLoggingMode}
                        onChange={(e) => update("spLoggingMode", e.target.value as FormState["spLoggingMode"])}
                        className="input"
                      >
                        <option value="NONE">None</option>
                        <option value="INSTRUMENTED">Instrumented (SP_ExecutionLog)</option>
                        <option value="XEVENTS">Extended Events</option>
                      </select>
                    </Field>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-2 mt-2">
                  <Toggle
                    label="Enabled"
                    checked={form.enabled}
                    onChange={(v) => update("enabled", v)}
                  />
                  <Toggle
                    label="Redact SQL string literals before storage (PII safety)"
                    checked={form.redactSqlText}
                    onChange={(v) => update("redactSqlText", v)}
                  />
                </div>
              </Section>

              {error && (
                <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {testResult && (
                <div
                  className={`flex items-start gap-2 rounded-md p-3 text-sm border ${
                    testResult.ok
                      ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                      : "bg-red-50 border-red-200 text-red-700"
                  }`}
                >
                  <Activity className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <div className="font-medium">{testResult.ok ? "Connection ok" : "Connection failed"}</div>
                    <div className="text-xs mt-0.5 break-words">{testResult.message}</div>
                    {testResult.serverVersion && (
                      <div className="text-xs mt-0.5 text-slate-700">
                        Server: {testResult.serverVersion}
                      </div>
                    )}
                    {testResult.capabilities && (
                      <ul className="text-xs mt-1 space-y-0.5 text-slate-700">
                        {Object.entries(testResult.capabilities).map(([k, v]) => (
                          <li key={k}>
                            <span className="text-slate-500">{k}:</span> {String(v)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </form>

            <footer className="px-6 py-4 border-t border-slate-200 flex items-center justify-between">
              <button
                type="button"
                onClick={handleTest}
                disabled={!isEdit || testing}
                title={isEdit ? undefined : "Save first to test"}
                className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
                Test connection
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-md text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  {isEdit ? "Save changes" : "Create"}
                </button>
              </div>
            </footer>
          </motion.div>
        </motion.div>
      )}

      {/* Tailwind input style — declared once for the form */}
      <style jsx global>{`
        .input {
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid rgb(226 232 240);
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          color: rgb(15 23 42);
          background: white;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .input:focus {
          outline: none;
          border-color: rgb(59 130 246);
          box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
        }
        .input:disabled {
          background: rgb(248 250 252);
          color: rgb(100 116 139);
        }
      `}</style>
    </AnimatePresence>
  );
}

function Section(props: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">{props.title}</h3>
        {props.description && <p className="text-xs text-slate-500 mt-0.5">{props.description}</p>}
      </div>
      {props.children}
    </section>
  );
}

function Field(props: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 mb-1">
        {props.label}
        {props.required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {props.children}
      {props.hint && <p className="text-xs text-slate-500 mt-1">{props.hint}</p>}
    </div>
  );
}

function Toggle(props: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
        className="rounded border-slate-300"
      />
      {props.label}
    </label>
  );
}
