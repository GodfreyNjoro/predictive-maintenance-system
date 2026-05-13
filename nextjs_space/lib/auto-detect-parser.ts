/**
 * Auto-Detection Log Parser
 * Automatically detects log format and schema from content
 * Supports: JSON, CSV, Syslog, Windows Event, Apache, Nginx, Custom formats
 */

import { ParsedLogEntry } from "./log-parser";

export interface DetectedFormat {
  format: "json" | "csv" | "syslog" | "windows" | "apache" | "nginx" | "custom";
  confidence: number;
  schema: DetectedSchema;
  sampleParsed: ParsedLogEntry[];
}

export interface DetectedSchema {
  fields: SchemaField[];
  timestampField?: string;
  levelField?: string;
  messageField?: string;
  sourceField?: string;
}

export interface SchemaField {
  name: string;
  type: "timestamp" | "level" | "message" | "source" | "number" | "string" | "unknown";
  confidence: number;
  sampleValues: string[];
}

const LOG_LEVEL_KEYWORDS = [
  "critical", "crit", "fatal", "error", "err", "warning", "warn", 
  "info", "information", "debug", "trace", "notice", "alert", "emerg"
];

const TIMESTAMP_PATTERNS = [
  /\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}/,
  /\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}/,
  /\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}/,
  /\d{10,13}/,
];

// Syslog pattern: <priority>timestamp hostname process[pid]: message
const SYSLOG_PATTERN = /^<?(\d+)?>?\s*(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+(\S+)(\[\d+\])?:\s*(.*)$/;

// Apache Common/Combined Log Format
const APACHE_PATTERN = /^(\S+)\s+(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+"([^"]+)"\s+(\d+)\s+(\d+|-)(.*)$/;

// Nginx default log format
const NGINX_PATTERN = /^(\S+)\s+-\s+(\S+)\s+\[([^\]]+)\]\s+"([^"]+)"\s+(\d+)\s+(\d+)\s+"([^"]*)"\s+"([^"]*)"$/;

// Windows Event Log pattern
const WINDOWS_PATTERN = /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+(\w+)\s+(\w+)\s+(.*)$/;

/**
 * Auto-detect log format from content
 */
export function autoDetectFormat(content: string): DetectedFormat {
  const lines = content.split("\n").filter(l => l.trim());
  if (lines.length === 0) {
    return createEmptyDetection();
  }

  // Try JSON first
  const jsonResult = tryDetectJSON(content, lines);
  if (jsonResult.confidence > 0.8) return jsonResult;

  // Try CSV
  const csvResult = tryDetectCSV(lines);
  if (csvResult.confidence > 0.7) return csvResult;

  // Try known patterns
  const syslogResult = tryDetectSyslog(lines);
  if (syslogResult.confidence > 0.6) return syslogResult;

  const apacheResult = tryDetectApache(lines);
  if (apacheResult.confidence > 0.6) return apacheResult;

  const nginxResult = tryDetectNginx(lines);
  if (nginxResult.confidence > 0.6) return nginxResult;

  const windowsResult = tryDetectWindows(lines);
  if (windowsResult.confidence > 0.6) return windowsResult;

  // Fall back to custom pattern detection
  return detectCustomFormat(lines);
}

function createEmptyDetection(): DetectedFormat {
  return {
    format: "custom",
    confidence: 0,
    schema: { fields: [] },
    sampleParsed: [],
  };
}

function tryDetectJSON(content: string, lines: string[]): DetectedFormat {
  try {
    // Check if entire content is valid JSON
    const parsed = JSON.parse(content);
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    
    if (entries.length > 0) {
      const schema = inferJSONSchema(entries);
      return {
        format: "json",
        confidence: 0.95,
        schema,
        sampleParsed: entries.slice(0, 5).map(e => parseJSONEntry(e, schema)),
      };
    }
  } catch {
    // Try line-by-line JSON (NDJSON)
    let validCount = 0;
    const entries: any[] = [];
    
    for (const line of lines.slice(0, 10)) {
      try {
        entries.push(JSON.parse(line));
        validCount++;
      } catch {
        // Not JSON
      }
    }
    
    if (validCount / Math.min(lines.length, 10) > 0.7) {
      const schema = inferJSONSchema(entries);
      return {
        format: "json",
        confidence: validCount / Math.min(lines.length, 10),
        schema,
        sampleParsed: entries.slice(0, 5).map(e => parseJSONEntry(e, schema)),
      };
    }
  }
  
  return { ...createEmptyDetection(), confidence: 0 };
}

function inferJSONSchema(entries: any[]): DetectedSchema {
  const fields: SchemaField[] = [];
  const fieldSamples: Record<string, string[]> = {};
  
  for (const entry of entries) {
    for (const [key, value] of Object.entries(entry)) {
      if (!fieldSamples[key]) fieldSamples[key] = [];
      fieldSamples[key].push(String(value));
    }
  }
  
  let timestampField: string | undefined;
  let levelField: string | undefined;
  let messageField: string | undefined;
  let sourceField: string | undefined;
  
  for (const [name, samples] of Object.entries(fieldSamples)) {
    const type = inferFieldType(name, samples);
    fields.push({ name, type, confidence: type === "unknown" ? 0.3 : 0.8, sampleValues: samples.slice(0, 3) });
    
    if (type === "timestamp" && !timestampField) timestampField = name;
    if (type === "level" && !levelField) levelField = name;
    if (type === "message" && !messageField) messageField = name;
    if (type === "source" && !sourceField) sourceField = name;
  }
  
  return { fields, timestampField, levelField, messageField, sourceField };
}

function inferFieldType(name: string, samples: string[]): SchemaField["type"] {
  const lowerName = name.toLowerCase();
  
  // Check by name
  if (["timestamp", "time", "datetime", "date", "@timestamp", "created_at"].includes(lowerName)) {
    return "timestamp";
  }
  if (["level", "severity", "loglevel", "log_level", "priority"].includes(lowerName)) {
    return "level";
  }
  if (["message", "msg", "description", "text", "content", "body"].includes(lowerName)) {
    return "message";
  }
  if (["source", "component", "service", "host", "hostname", "app", "application"].includes(lowerName)) {
    return "source";
  }
  
  // Check by sample values
  const hasTimestamp = samples.some(s => TIMESTAMP_PATTERNS.some(p => p.test(s)));
  if (hasTimestamp) return "timestamp";
  
  const hasLevel = samples.some(s => LOG_LEVEL_KEYWORDS.includes(s.toLowerCase()));
  if (hasLevel) return "level";
  
  const avgLength = samples.reduce((a, s) => a + s.length, 0) / samples.length;
  if (avgLength > 50) return "message";
  
  if (samples.every(s => !isNaN(Number(s)))) return "number";
  
  return "string";
}

function parseJSONEntry(entry: any, schema: DetectedSchema): ParsedLogEntry {
  return {
    timestamp: schema.timestampField ? new Date(entry[schema.timestampField]) : new Date(),
    logLevel: schema.levelField ? normalizeLevel(entry[schema.levelField]) : "info",
    source: schema.sourceField ? entry[schema.sourceField] : "unknown",
    message: schema.messageField ? entry[schema.messageField] : JSON.stringify(entry),
    rawData: JSON.stringify(entry),
  };
}

function tryDetectCSV(lines: string[]): DetectedFormat {
  const firstLine = lines[0];
  const possibleDelimiters = [",", ";", "\t", "|"];
  
  for (const delimiter of possibleDelimiters) {
    const headerCols = firstLine.split(delimiter).length;
    if (headerCols < 2) continue;
    
    let consistentCount = 0;
    for (let i = 1; i < Math.min(lines.length, 10); i++) {
      if (lines[i].split(delimiter).length === headerCols) {
        consistentCount++;
      }
    }
    
    const consistency = consistentCount / Math.min(lines.length - 1, 9);
    if (consistency > 0.7) {
      const headers = firstLine.split(delimiter).map(h => h.trim().replace(/^"|"$/g, ""));
      const schema = inferCSVSchema(headers, lines.slice(1, 6), delimiter);
      
      return {
        format: "csv",
        confidence: consistency,
        schema,
        sampleParsed: lines.slice(1, 6).map(l => parseCSVLine(l, delimiter, schema)),
      };
    }
  }
  
  return { ...createEmptyDetection(), confidence: 0 };
}

function inferCSVSchema(headers: string[], dataLines: string[], delimiter: string): DetectedSchema {
  const fields: SchemaField[] = [];
  let timestampField: string | undefined;
  let levelField: string | undefined;
  let messageField: string | undefined;
  let sourceField: string | undefined;
  
  headers.forEach((header, idx) => {
    const samples = dataLines.map(l => l.split(delimiter)[idx]?.trim().replace(/^"|"$/g, "") || "");
    const type = inferFieldType(header, samples);
    fields.push({ name: header, type, confidence: 0.7, sampleValues: samples.slice(0, 3) });
    
    if (type === "timestamp" && !timestampField) timestampField = header;
    if (type === "level" && !levelField) levelField = header;
    if (type === "message" && !messageField) messageField = header;
    if (type === "source" && !sourceField) sourceField = header;
  });
  
  return { fields, timestampField, levelField, messageField, sourceField };
}

function parseCSVLine(line: string, delimiter: string, schema: DetectedSchema): ParsedLogEntry {
  const values = line.split(delimiter).map(v => v.trim().replace(/^"|"$/g, ""));
  const fieldMap: Record<string, string> = {};
  schema.fields.forEach((f, idx) => { fieldMap[f.name] = values[idx] || ""; });
  
  return {
    timestamp: schema.timestampField ? new Date(fieldMap[schema.timestampField]) : new Date(),
    logLevel: schema.levelField ? normalizeLevel(fieldMap[schema.levelField]) : "info",
    source: schema.sourceField ? fieldMap[schema.sourceField] : "unknown",
    message: schema.messageField ? fieldMap[schema.messageField] : line,
    rawData: line,
  };
}

function tryDetectSyslog(lines: string[]): DetectedFormat {
  let matchCount = 0;
  const entries: ParsedLogEntry[] = [];
  
  for (const line of lines.slice(0, 10)) {
    const match = line.match(SYSLOG_PATTERN);
    if (match) {
      matchCount++;
      entries.push({
        timestamp: new Date(match[2]),
        logLevel: "info",
        source: match[4].replace(/\[\d+\]$/, ""),
        message: match[6],
        rawData: line,
      });
    }
  }
  
  return {
    format: "syslog",
    confidence: matchCount / Math.min(lines.length, 10),
    schema: {
      fields: [
        { name: "priority", type: "number", confidence: 0.8, sampleValues: [] },
        { name: "timestamp", type: "timestamp", confidence: 0.9, sampleValues: [] },
        { name: "hostname", type: "source", confidence: 0.8, sampleValues: [] },
        { name: "process", type: "source", confidence: 0.8, sampleValues: [] },
        { name: "message", type: "message", confidence: 0.9, sampleValues: [] },
      ],
      timestampField: "timestamp",
      sourceField: "process",
      messageField: "message",
    },
    sampleParsed: entries,
  };
}

function tryDetectApache(lines: string[]): DetectedFormat {
  let matchCount = 0;
  const entries: ParsedLogEntry[] = [];
  
  for (const line of lines.slice(0, 10)) {
    const match = line.match(APACHE_PATTERN);
    if (match) {
      matchCount++;
      const statusCode = parseInt(match[6]);
      entries.push({
        timestamp: new Date(match[4].replace(":", " ")),
        logLevel: statusCode >= 500 ? "error" : statusCode >= 400 ? "warning" : "info",
        source: "apache",
        message: `${match[5]} - ${match[6]}`,
        rawData: line,
      });
    }
  }
  
  return {
    format: "apache",
    confidence: matchCount / Math.min(lines.length, 10),
    schema: {
      fields: [
        { name: "client_ip", type: "string", confidence: 0.9, sampleValues: [] },
        { name: "timestamp", type: "timestamp", confidence: 0.9, sampleValues: [] },
        { name: "request", type: "message", confidence: 0.9, sampleValues: [] },
        { name: "status", type: "number", confidence: 0.9, sampleValues: [] },
      ],
      timestampField: "timestamp",
      messageField: "request",
    },
    sampleParsed: entries,
  };
}

function tryDetectNginx(lines: string[]): DetectedFormat {
  let matchCount = 0;
  const entries: ParsedLogEntry[] = [];
  
  for (const line of lines.slice(0, 10)) {
    const match = line.match(NGINX_PATTERN);
    if (match) {
      matchCount++;
      const statusCode = parseInt(match[5]);
      entries.push({
        timestamp: new Date(match[3].replace(":", " ")),
        logLevel: statusCode >= 500 ? "error" : statusCode >= 400 ? "warning" : "info",
        source: "nginx",
        message: `${match[4]} - ${match[5]}`,
        rawData: line,
      });
    }
  }
  
  return {
    format: "nginx",
    confidence: matchCount / Math.min(lines.length, 10),
    schema: {
      fields: [
        { name: "client_ip", type: "string", confidence: 0.9, sampleValues: [] },
        { name: "timestamp", type: "timestamp", confidence: 0.9, sampleValues: [] },
        { name: "request", type: "message", confidence: 0.9, sampleValues: [] },
        { name: "status", type: "number", confidence: 0.9, sampleValues: [] },
        { name: "user_agent", type: "string", confidence: 0.8, sampleValues: [] },
      ],
      timestampField: "timestamp",
      messageField: "request",
    },
    sampleParsed: entries,
  };
}

function tryDetectWindows(lines: string[]): DetectedFormat {
  let matchCount = 0;
  const entries: ParsedLogEntry[] = [];
  
  for (const line of lines.slice(0, 10)) {
    const match = line.match(WINDOWS_PATTERN);
    if (match) {
      matchCount++;
      entries.push({
        timestamp: new Date(match[1]),
        logLevel: normalizeLevel(match[2]),
        source: match[3],
        message: match[4],
        rawData: line,
      });
    }
  }
  
  return {
    format: "windows",
    confidence: matchCount / Math.min(lines.length, 10),
    schema: {
      fields: [
        { name: "timestamp", type: "timestamp", confidence: 0.9, sampleValues: [] },
        { name: "level", type: "level", confidence: 0.9, sampleValues: [] },
        { name: "source", type: "source", confidence: 0.9, sampleValues: [] },
        { name: "message", type: "message", confidence: 0.9, sampleValues: [] },
      ],
      timestampField: "timestamp",
      levelField: "level",
      sourceField: "source",
      messageField: "message",
    },
    sampleParsed: entries,
  };
}

function detectCustomFormat(lines: string[]): DetectedFormat {
  const entries: ParsedLogEntry[] = [];
  
  for (const line of lines.slice(0, 5)) {
    // Extract timestamp if present
    let timestamp = new Date();
    for (const pattern of TIMESTAMP_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        const parsed = new Date(match[0]);
        if (!isNaN(parsed.getTime())) {
          timestamp = parsed;
          break;
        }
      }
    }
    
    // Detect log level
    let level = "info";
    for (const keyword of LOG_LEVEL_KEYWORDS) {
      if (line.toLowerCase().includes(keyword)) {
        level = normalizeLevel(keyword);
        break;
      }
    }
    
    entries.push({
      timestamp,
      logLevel: level,
      source: "custom",
      message: line,
      rawData: line,
    });
  }
  
  return {
    format: "custom",
    confidence: 0.5,
    schema: {
      fields: [
        { name: "raw_line", type: "message", confidence: 0.5, sampleValues: lines.slice(0, 3) },
      ],
      messageField: "raw_line",
    },
    sampleParsed: entries,
  };
}

function normalizeLevel(level: string): string {
  const l = level?.toLowerCase()?.trim() || "info";
  if (["critical", "crit", "fatal", "emerg", "alert"].includes(l)) return "critical";
  if (["error", "err"].includes(l)) return "error";
  if (["warning", "warn"].includes(l)) return "warning";
  if (["debug", "trace"].includes(l)) return "debug";
  return "info";
}

/**
 * Parse content using auto-detected format
 */
export function autoParseContent(content: string, fallbackSource: string = "auto"): {
  format: DetectedFormat;
  entries: ParsedLogEntry[];
} {
  const format = autoDetectFormat(content);
  
  if (format.confidence < 0.3) {
    // Very low confidence, parse line by line
    const lines = content.split("\n").filter(l => l.trim());
    const entries = lines.map(line => ({
      timestamp: new Date(),
      logLevel: line.toLowerCase().includes("error") ? "error" : 
                line.toLowerCase().includes("warn") ? "warning" : "info",
      source: fallbackSource,
      message: line,
      rawData: line,
    }));
    return { format, entries };
  }
  
  // Parse all lines using detected format
  const lines = content.split("\n").filter(l => l.trim());
  let entries: ParsedLogEntry[] = [];
  
  switch (format.format) {
    case "json":
      try {
        const parsed = JSON.parse(content);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        entries = items.map(e => parseJSONEntry(e, format.schema));
      } catch {
        // NDJSON
        entries = lines.map(l => {
          try {
            return parseJSONEntry(JSON.parse(l), format.schema);
          } catch {
            return { timestamp: new Date(), logLevel: "info", source: fallbackSource, message: l };
          }
        });
      }
      break;
    case "csv":
      const delimiter = lines[0].includes(",") ? "," : lines[0].includes(";") ? ";" : "\t";
      entries = lines.slice(1).map(l => parseCSVLine(l, delimiter, format.schema));
      break;
    case "syslog":
      entries = lines.map(l => {
        const match = l.match(SYSLOG_PATTERN);
        if (match) {
          return {
            timestamp: new Date(match[2]),
            logLevel: "info",
            source: match[4].replace(/\[\d+\]$/, ""),
            message: match[6],
            rawData: l,
          };
        }
        return { timestamp: new Date(), logLevel: "info", source: fallbackSource, message: l };
      });
      break;
    case "apache":
    case "nginx":
      const pattern = format.format === "apache" ? APACHE_PATTERN : NGINX_PATTERN;
      entries = lines.map(l => {
        const match = l.match(pattern);
        if (match) {
          const statusCode = parseInt(match[format.format === "apache" ? 6 : 5]);
          return {
            timestamp: new Date(),
            logLevel: statusCode >= 500 ? "error" : statusCode >= 400 ? "warning" : "info",
            source: format.format,
            message: match[format.format === "apache" ? 5 : 4],
            rawData: l,
          };
        }
        return { timestamp: new Date(), logLevel: "info", source: fallbackSource, message: l };
      });
      break;
    case "windows":
      entries = lines.map(l => {
        const match = l.match(WINDOWS_PATTERN);
        if (match) {
          return {
            timestamp: new Date(match[1]),
            logLevel: normalizeLevel(match[2]),
            source: match[3],
            message: match[4],
            rawData: l,
          };
        }
        return { timestamp: new Date(), logLevel: "info", source: fallbackSource, message: l };
      });
      break;
    default:
      entries = format.sampleParsed.length > 0 ? format.sampleParsed : 
        lines.map(l => ({ timestamp: new Date(), logLevel: "info", source: fallbackSource, message: l }));
  }
  
  return { format, entries };
}
