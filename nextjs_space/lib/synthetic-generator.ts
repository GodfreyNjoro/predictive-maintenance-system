export interface SyntheticLogConfig {
  logSource: "windows_event" | "mssql" | "performance";
  count: number;
  startDate: Date;
  endDate: Date;
  anomalyPercentage: number; // 0-100
}

const WINDOWS_EVENT_SOURCES = [
  "System",
  "Application",
  "Security",
  "SystemMonitor.Core",
  "MSSQLSERVER",
  "W3SVC",
  "EventLog",
  "Service Control Manager",
];

const MSSQL_COMPONENTS = [
  "Database Engine",
  "Query Processor",
  "Transaction Manager",
  "Buffer Manager",
  "Lock Manager",
  "Backup/Restore",
  "SQL Agent",
  "Replication",
];

const NORMAL_WINDOWS_MESSAGES = [
  "Service started successfully",
  "User logon completed",
  "System time synchronized",
  "Scheduled task completed",
  "Network connection established",
  "File system check passed",
  "Memory cleanup completed",
  "Backup verification successful",
  "Certificate validation successful",
  "Performance counter loaded",
];

const ANOMALY_WINDOWS_MESSAGES = [
  "Connection timeout to database server",
  "Out of memory exception occurred",
  "Disk write operation failed - disk full",
  "Authentication failed for user SYSTEM",
  "Service crashed unexpectedly",
  "Deadlock detected in thread pool",
  "Critical system resource exhausted",
  "Buffer overflow detected in memory",
  "File corruption detected in logs",
  "Access denied to critical resource",
];

const NORMAL_MSSQL_MESSAGES = [
  "Database 'ChequeProcessing' started successfully",
  "Transaction log backup completed",
  "Index rebuild completed for table 'Transactions'",
  "Query execution plan optimized",
  "Connection pool initialized with 50 connections",
  "Statistics updated for 'ChequeImages' table",
  "Checkpoint completed in database 'ChequeProcessing'",
  "Tempdb space reclaimed successfully",
];

const ANOMALY_MSSQL_MESSAGES = [
  "Deadlock detected between processes 52 and 78",
  "Transaction log full - cannot process transactions",
  "Query timeout exceeded for batch processing",
  "Index corruption detected in 'ChequeImages'",
  "Connection pool exhausted - max connections reached",
  "Database 'ChequeProcessing' is in suspect state",
  "I/O error reading database page",
  "Lock escalation causing blocking chains",
  "Memory grant timeout for large query",
  "Tempdb contention causing performance degradation",
];

function randomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomTimestamp(start: Date, end: Date): Date {
  const startTime = start.getTime();
  const endTime = end.getTime();
  return new Date(startTime + Math.random() * (endTime - startTime));
}

function generateWindowsEventLog(
  isAnomaly: boolean,
  timestamp: Date
): Record<string, string | number> {
  const source = randomElement(WINDOWS_EVENT_SOURCES);
  const message = isAnomaly
    ? randomElement(ANOMALY_WINDOWS_MESSAGES)
    : randomElement(NORMAL_WINDOWS_MESSAGES);
  const level = isAnomaly
    ? randomElement(["Error", "Critical", "Warning"])
    : randomElement(["Information", "Information", "Information", "Warning"]);
  const eventId = isAnomaly
    ? Math.floor(Math.random() * 1000) + 4000
    : Math.floor(Math.random() * 100) + 1000;

  return {
    Timestamp: timestamp.toISOString(),
    Level: level,
    Source: source,
    EventID: eventId,
    Message: message,
    Computer: "PROD-SVR-01",
    TaskCategory: isAnomaly ? "Error" : "General",
  };
}

function generateMSSQLLog(
  isAnomaly: boolean,
  timestamp: Date
): Record<string, string | number> {
  const component = randomElement(MSSQL_COMPONENTS);
  const message = isAnomaly
    ? randomElement(ANOMALY_MSSQL_MESSAGES)
    : randomElement(NORMAL_MSSQL_MESSAGES);
  const severity = isAnomaly
    ? randomElement(["Error", "Critical"])
    : randomElement(["Info", "Info", "Info", "Warning"]);

  return {
    Timestamp: timestamp.toISOString(),
    Severity: severity,
    Component: component,
    SPID: Math.floor(Math.random() * 100) + 50,
    Message: message,
    Database: randomElement(["ChequeProcessing", "ChequeArchive", "AuditLog", "master"]),
  };
}

function generatePerformanceMetric(
  isAnomaly: boolean,
  timestamp: Date
): Record<string, string | number> {
  const cpuNormal = 20 + Math.random() * 40;
  const cpuAnomaly = 85 + Math.random() * 15;
  const memNormal = 40 + Math.random() * 30;
  const memAnomaly = 90 + Math.random() * 10;
  const diskNormal = 10 + Math.random() * 50;
  const diskAnomaly = 90 + Math.random() * 10;

  return {
    Timestamp: timestamp.toISOString(),
    Server: "PROD-SVR-01",
    CPU_Percent: isAnomaly ? cpuAnomaly : cpuNormal,
    Memory_Percent: isAnomaly ? memAnomaly : memNormal,
    Disk_Percent: isAnomaly ? diskAnomaly : diskNormal,
    Network_KB_s: isAnomaly ? Math.random() * 10 : 500 + Math.random() * 500,
    DB_Connections: isAnomaly ? 95 + Math.floor(Math.random() * 5) : Math.floor(Math.random() * 60),
    Active_Transactions: isAnomaly ? 100 + Math.floor(Math.random() * 50) : Math.floor(Math.random() * 30),
    Queue_Length: isAnomaly ? 50 + Math.floor(Math.random() * 100) : Math.floor(Math.random() * 10),
  };
}

export function generateSyntheticLogs(
  config: SyntheticLogConfig
): Record<string, string | number>[] {
  const logs: Record<string, string | number>[] = [];
  const anomalyCount = Math.floor((config.count * config.anomalyPercentage) / 100);
  const normalCount = config.count - anomalyCount;

  // Generate normal logs
  for (let i = 0; i < normalCount; i++) {
    const timestamp = randomTimestamp(config.startDate, config.endDate);
    let log: Record<string, string | number>;

    switch (config.logSource) {
      case "windows_event":
        log = generateWindowsEventLog(false, timestamp);
        break;
      case "mssql":
        log = generateMSSQLLog(false, timestamp);
        break;
      case "performance":
        log = generatePerformanceMetric(false, timestamp);
        break;
    }

    logs.push(log);
  }

  // Generate anomaly logs (clustered toward end for realistic pattern)
  const anomalyStartDate = new Date(
    config.startDate.getTime() +
      (config.endDate.getTime() - config.startDate.getTime()) * 0.7
  );

  for (let i = 0; i < anomalyCount; i++) {
    const timestamp = randomTimestamp(anomalyStartDate, config.endDate);
    let log: Record<string, string | number>;

    switch (config.logSource) {
      case "windows_event":
        log = generateWindowsEventLog(true, timestamp);
        break;
      case "mssql":
        log = generateMSSQLLog(true, timestamp);
        break;
      case "performance":
        log = generatePerformanceMetric(true, timestamp);
        break;
    }

    logs.push(log);
  }

  // Sort by timestamp
  return logs.sort((a, b) => {
    const dateA = new Date(a.Timestamp as string);
    const dateB = new Date(b.Timestamp as string);
    return dateA.getTime() - dateB.getTime();
  });
}

export function logsToCSV(logs: Record<string, string | number>[]): string {
  if (logs.length === 0) return "";

  const headers = Object.keys(logs[0]);
  const csvLines = [headers.join(",")];

  logs.forEach((log) => {
    const values = headers.map((h) => {
      const val = log[h];
      if (typeof val === "string" && val.includes(",")) {
        return `"${val}"`;
      }
      return String(val);
    });
    csvLines.push(values.join(","));
  });

  return csvLines.join("\n");
}

export function logsToJSON(logs: Record<string, string | number>[]): string {
  return JSON.stringify({ logs }, null, 2);
}

export function logsToTXT(logs: Record<string, string | number>[]): string {
  return logs
    .map((log) => {
      const timestamp = log.Timestamp;
      const level = log.Level ?? log.Severity ?? "INFO";
      const source = log.Source ?? log.Component ?? log.Server ?? "System";
      const message = log.Message ?? JSON.stringify(log);
      return `[${timestamp}] [${level}] [${source}] ${message}`;
    })
    .join("\n");
}