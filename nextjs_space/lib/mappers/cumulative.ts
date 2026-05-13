/**
 * Cumulative-counter delta helper, shared by every PMS mapper that consumes
 * monotonically increasing DMV counters (waitStats, ioStats, perf counters,
 * Postgres pg_stat_io, ...).
 *
 * The contract is intentionally tiny:
 *   - `previous` and `current` are the *snapshots* (cumulative values).
 *   - We compute the delta unless we detect a counter reset, in which case
 *     `reset = true` and `delta` equals the current value (i.e. "this is
 *     the activity recorded since the reset, which we attribute to the
 *     window after the reset").
 *
 * Reset detection happens at two layers:
 *   1. *Per-counter* (`computeDelta`): if `current < previous`, the row was
 *      reset (rare — happens when the DMV bucket itself is reinitialised).
 *   2. *Per-snapshot* (`detectServerRestart`): if the server's reported
 *      `sqlserver_start_time` has advanced since the last snapshot, the
 *      whole counter set is fresh and *every* counter must be treated as
 *      delta-equals-current.
 *
 * Both functions are pure — no IO, no Prisma. They live next to mappers and
 * not in the connector layer because mappers are the right abstraction
 * boundary: a future edge-collector agent that ships ParsedLogEntries to
 * PMS over HTTP will reuse exactly the same logic.
 */

export interface DeltaResult {
  /** Computed delta (>= 0). Equals `current` when `reset` is true. */
  delta: number;
  /** True when the per-counter reset heuristic triggered. */
  reset: boolean;
}

/**
 * Compute a non-negative delta for one counter.
 *
 * @param current  The cumulative value reported by the DMV right now.
 * @param previous The cumulative value reported on the prior snapshot, or
 *                 null when this is the first observation.
 */
export function computeDelta(current: number, previous: number | null | undefined): DeltaResult {
  if (typeof current !== "number" || !Number.isFinite(current) || current < 0) {
    return { delta: 0, reset: false };
  }
  if (
    typeof previous !== "number" ||
    !Number.isFinite(previous) ||
    previous < 0
  ) {
    // First observation — no delta to report yet. Mappers MUST treat the
    // first call as "prime the cursor; emit nothing". We still return the
    // current value as `delta` so callers can distinguish first-pull from
    // reset by checking the previous-cursor pointer themselves.
    return { delta: current, reset: false };
  }
  if (current < previous) {
    // Per-counter reset — the bucket was reinitialised. Trust the new value.
    return { delta: current, reset: true };
  }
  return { delta: current - previous, reset: false };
}

/**
 * Detect a server restart by comparing the current `sqlserver_start_time`
 * to the value persisted on the previous cursor.
 *
 * Returns `true` when a restart happened and the entire counter set must
 * be treated as fresh (i.e. previous = 0 for every counter).
 *
 * The two timestamps are compared as ISO strings so we don't have to worry
 * about timezone drift between the SQL Server clock and the agent clock.
 */
export function detectServerRestart(
  previousServerStartTime: string | null | undefined,
  currentServerStartTime: string | null | undefined,
): boolean {
  if (!currentServerStartTime) return false;          // can't tell — be conservative
  if (!previousServerStartTime) return false;         // first observation
  return previousServerStartTime !== currentServerStartTime;
}

/**
 * Convenience: format a Date or ISO string to a stable ISO string suitable
 * for cursor persistence. Returns `null` for unparseable input.
 */
export function toIsoString(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : v.toISOString();
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
