/**
 * MySQL mapper registry.
 */

import type { FeedId } from "../../connectors/types";
import type { FeedMapper } from "../types";
import { mysqlQueryDigestMapper } from "./query-digest";
import { mysqlWaitSummaryMapper } from "./wait-summary";
import { mysqlIoSummaryMapper } from "./io-summary";
import { mysqlOsMetricsMapper } from "./os-metrics";

const registry = new Map<FeedId, FeedMapper<any, any>>();
registry.set("queryStore", mysqlQueryDigestMapper);
registry.set("waitStats", mysqlWaitSummaryMapper);
registry.set("ioStats", mysqlIoSummaryMapper);
registry.set("osMetrics", mysqlOsMetricsMapper);

export function getMysqlMapper(feed: FeedId): FeedMapper<any, any> | undefined {
  return registry.get(feed);
}

export function listMysqlMappers(): FeedId[] {
  return Array.from(registry.keys());
}

export { mysqlQueryDigestMapper, mysqlWaitSummaryMapper, mysqlIoSummaryMapper, mysqlOsMetricsMapper };
