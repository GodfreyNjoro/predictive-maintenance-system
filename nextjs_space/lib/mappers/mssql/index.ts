/**
 * MSSQL mapper registry.
 *
 * Each feed has exactly one mapper. The connector reaches in here when it
 * needs to convert raw rows to ParsedLogEntries. Adding a new feed (Phase 2+)
 * is purely additive: write the mapper, register it here.
 */

import type { FeedId } from "../../connectors/types";
import type { FeedMapper } from "../types";
import { jobHistoryMapper } from "./job-history";
import { queryStoreMapper } from "./query-store";
import { spExecMapper } from "./sp-exec";
import { waitStatsMapper } from "./wait-stats";
import { ioStatsMapper } from "./io-stats";
import { xeventsMapper } from "./xevents";
import { errorLogMapper } from "./error-log";
import { mssqlOsMetricsMapper } from "./os-metrics";

const registry = new Map<FeedId, FeedMapper<any, any>>();
registry.set("jobHistory", jobHistoryMapper);
registry.set("queryStore", queryStoreMapper);
registry.set("spExec", spExecMapper);
registry.set("waitStats", waitStatsMapper);
registry.set("ioStats", ioStatsMapper);
registry.set("xevents", xeventsMapper);
registry.set("errorLog", errorLogMapper);
registry.set("osMetrics", mssqlOsMetricsMapper);

export function getMssqlMapper(feed: FeedId): FeedMapper<any, any> | undefined {
  return registry.get(feed);
}

export function listMssqlMappers(): FeedId[] {
  return Array.from(registry.keys());
}

export {
  jobHistoryMapper,
  queryStoreMapper,
  spExecMapper,
  waitStatsMapper,
  ioStatsMapper,
  xeventsMapper,
  errorLogMapper,
  mssqlOsMetricsMapper,
};
