export interface ParsedLogEntry {
  timestamp: Date;
  logLevel: string;
  source: string;
  eventId?: number;
  message: string;
  rawData?: string;
  features?: Record<string, number>;
}

const LOG_LEVELS = ["critical", "error", "warning", "info", "debug"];

function normalizeLogLevel(level: string): string {
  const normalized = level?.toLowerCase()?.trim() ?? "info";
  if (LOG_LEVELS.includes(normalized)) return normalized;
  if (normalized === "err" || normalized === "fatal") return "error";
  if (normalized === "warn") return "warning";
  if (normalized === "crit") return "critical";
  return "info";
}

export function parseCSV(content: string, source: string): ParsedLogEntry[] {
  const lines = content?.split("\n")?.filter((l) => l?.trim()) ?? [];
  if (lines?.length < 2) return [];

  const headers = lines[0]?.split(",")?.map((h) => h?.trim()?.toLowerCase()) ?? [];
  const timestampIdx = headers.findIndex((h) => h?.includes("time") || h?.includes("date"));
  const levelIdx = headers.findIndex((h) => h?.includes("level") || h?.includes("severity"));
  const messageIdx = headers.findIndex((h) => h?.includes("message") || h?.includes("description"));
  const eventIdIdx = headers.findIndex((h) => h?.includes("eventid") || h?.includes("event_id"));
  const sourceIdx = headers.findIndex((h) => h?.includes("source") || h?.includes("component"));

  return lines.slice(1).map((line) => {
    const values = line?.split(",")?.map((v) => v?.trim()) ?? [];
    const timestamp = timestampIdx >= 0 ? new Date(values[timestampIdx] ?? Date.now()) : new Date();
    
    return {
      timestamp: isNaN(timestamp.getTime()) ? new Date() : timestamp,
      logLevel: normalizeLogLevel(values[levelIdx] ?? "info"),
      source: values[sourceIdx] ?? source,
      eventId: eventIdIdx >= 0 ? parseInt(values[eventIdIdx] ?? "0") || undefined : undefined,
      message: values[messageIdx] ?? line,
      rawData: line,
    };
  });
}

export function parseJSON(content: string, source: string): ParsedLogEntry[] {
  try {
    const data = JSON.parse(content);
    const entries = Array.isArray(data) ? data : (data?.logs ?? data?.events ?? [data]);

    return (entries ?? []).map((entry: any) => {
      const timestamp = new Date(
        entry?.timestamp ?? entry?.time ?? entry?.datetime ?? entry?.date ?? Date.now()
      );

      return {
        timestamp: isNaN(timestamp.getTime()) ? new Date() : timestamp,
        logLevel: normalizeLogLevel(
          entry?.level ?? entry?.severity ?? entry?.logLevel ?? "info"
        ),
        source: entry?.source ?? entry?.component ?? entry?.system ?? source,
        eventId: entry?.eventId ?? entry?.event_id ?? entry?.id,
        message:
          entry?.message ?? entry?.description ?? entry?.text ?? JSON.stringify(entry),
        rawData: JSON.stringify(entry),
      };
    });
  } catch {
    return [];
  }
}

export function parseTXT(content: string, source: string): ParsedLogEntry[] {
  const lines = content?.split("\n")?.filter((l) => l?.trim()) ?? [];
  const windowsEventPattern =
    /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+(\w+)\s+(\w+)\s+(.*)$/;
  const mssqlPattern = /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+)\s+(\w+)\s+(.*)$/;
  const genericPattern = /^\[(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}[^\]]*)]\s*\[(\w+)]\s*(.*)$/;

  return lines.map((line) => {
    let match = line?.match?.(windowsEventPattern);
    if (match) {
      return {
        timestamp: new Date(match[1]),
        logLevel: normalizeLogLevel(match[2]),
        source: match[3] ?? source,
        message: match[4],
        rawData: line,
      };
    }

    match = line?.match?.(mssqlPattern);
    if (match) {
      return {
        timestamp: new Date(match[1]),
        logLevel: normalizeLogLevel(match[2]),
        source: "mssql",
        message: match[3],
        rawData: line,
      };
    }

    match = line?.match?.(genericPattern);
    if (match) {
      return {
        timestamp: new Date(match[1]),
        logLevel: normalizeLogLevel(match[2]),
        source: source,
        message: match[3],
        rawData: line,
      };
    }

    return {
      timestamp: new Date(),
      logLevel: line?.toLowerCase()?.includes("error")
        ? "error"
        : line?.toLowerCase()?.includes("warn")
        ? "warning"
        : "info",
      source: source,
      message: line,
      rawData: line,
    };
  });
}

export function parseLogFile(
  content: string,
  fileType: string,
  source: string
): ParsedLogEntry[] {
  switch (fileType?.toLowerCase()) {
    case "csv":
      return parseCSV(content, source);
    case "json":
      return parseJSON(content, source);
    case "txt":
    default:
      return parseTXT(content, source);
  }
}