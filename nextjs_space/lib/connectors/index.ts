/**
 * Connector registry.
 *
 * The registry holds one factory per DBMS. Adding a new DBMS is purely
 * additive — register it here, ship its adapter file, and the rest of the
 * pipeline (scheduler, dispatcher, mappers, UI) picks it up automatically.
 *
 * Phase 1 ships with the MSSQL adapter. Postgres / MySQL / Oracle adapters
 * are pre-wired here (lazy factories pointing at not-yet-built modules) so
 * that the registry shape is stable from day one.
 */

import type { DbKind } from "@prisma/client";
import type { ConnectorFactory, DbConnector, DbmsKind } from "./types";

const registry = new Map<DbmsKind, ConnectorFactory>();
const instances = new Map<DbmsKind, DbConnector>();

/**
 * Register a connector factory. Idempotent — last write wins.
 * Adapters call this at module load (typically from their default export).
 */
export function registerConnector(kind: DbmsKind, factory: ConnectorFactory): void {
  registry.set(kind, factory);
  // Drop any cached instance so the new factory is honoured next get().
  instances.delete(kind);
}

/**
 * Lazily resolve a connector for a given DbKind. Throws a clear error if
 * the DBMS is not yet implemented — this is what the API/UI surfaces when
 * an operator picks an unsupported kind.
 */
export function getConnector(kind: DbKind | DbmsKind): DbConnector {
  const k = kind as DbmsKind;
  const cached = instances.get(k);
  if (cached) return cached;

  const factory = registry.get(k);
  if (!factory) {
    throw new Error(
      `No connector registered for DbKind=${k}. Supported: ${listRegisteredKinds().join(", ") || "(none yet)"}.`,
    );
  }

  const inst = factory();
  instances.set(k, inst);
  return inst;
}

/** Enumerate the DBMSes that currently have a registered factory. */
export function listRegisteredKinds(): DbmsKind[] {
  return Array.from(registry.keys()).sort();
}

/** True when a connector factory is registered for `kind`. */
export function hasConnector(kind: DbKind | DbmsKind): boolean {
  return registry.has(kind as DbmsKind);
}

/**
 * Tear down all live connector instances (safe to call from a graceful
 * shutdown path or a hot-reload boundary).
 */
export async function closeAllConnectors(): Promise<void> {
  const live = Array.from(instances.values());
  instances.clear();
  await Promise.allSettled(live.map((c) => c.close()));
}

export type { DbConnector, DbmsKind, ConnectionTestResult, FeedDescriptor, FeedId, FeedKind, PullResult } from "./types";
