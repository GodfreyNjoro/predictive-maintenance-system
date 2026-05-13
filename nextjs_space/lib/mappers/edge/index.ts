/**
 * Edge / application-server mapper registry.
 *
 * These mappers handle feeds pushed by on-prem edge collector agents running
 * on the APPLICATION server (not the DB server). They cover the "blind spot"
 * in split-server architectures where the app and DB are on different hosts.
 *
 * Unlike DB-connector mappers, these feeds are ingested via POST /api/ingest/batch
 * rather than pulled by the scheduler.
 */

import { appMetricsMapper } from "./app-metrics";
import { appLogsMapper } from "./app-logs";
import { windowsEventLogMapper } from "./windows-event-log";
import { iisLogsMapper } from "./iis-logs";
import { networkMetricsMapper } from "./network-metrics";

import type { FeedMapper } from "../types";

export const edgeMapperRegistry: Record<string, FeedMapper<any, any>> = {
  appMetrics: appMetricsMapper,
  appLogs: appLogsMapper,
  windowsEventLog: windowsEventLogMapper,
  iisLogs: iisLogsMapper,
  networkMetrics: networkMetricsMapper,
};

export {
  appMetricsMapper,
  appLogsMapper,
  windowsEventLogMapper,
  iisLogsMapper,
  networkMetricsMapper,
};
