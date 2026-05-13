/**
 * PostgreSQL mapper registry.
 *
 * Each feed has exactly one mapper. Adding a new Postgres feed is purely
 * additive: write the mapper, register it here.
 */

import type { FeedId } from "../../connectors/types";
import type { FeedMapper } from "../types";
import { pgQueryStatsMapper } from "./query-stats";
import { pgWaitEventsMapper } from "./wait-events";
import { pgIoStatsMapper } from "./io-stats";
import { pgOsMetricsMapper } from "./os-metrics";

const registry = new Map<FeedId, FeedMapper<any, any>>();
registry.set("queryStore", pgQueryStatsMapper);
registry.set("waitStats", pgWaitEventsMapper);
registry.set("ioStats", pgIoStatsMapper);
registry.set("osMetrics", pgOsMetricsMapper);

export function getPostgresMapper(feed: FeedId): FeedMapper<any, any> | undefined {
  return registry.get(feed);
}

export function listPostgresMappers(): FeedId[] {
  return Array.from(registry.keys());
}

export { pgQueryStatsMapper, pgWaitEventsMapper, pgIoStatsMapper, pgOsMetricsMapper };
