/**
 * Multi-tenant scope helpers for DataSource API routes.
 *
 * Phase 1 ships single-tenant — every row's `organizationId` is `"default"`.
 * The schema and helpers are wired so we can later expose the org id
 * through the session and expand to multi-tenant without touching call sites.
 */

import type { Session } from "next-auth";

export const DEFAULT_ORGANIZATION_ID = "default";

/**
 * Resolve the organization id for the calling session.
 * Falls back to `"default"` while multi-tenancy is not yet exposed via session.
 */
export function getOrganizationId(session: Session | null | undefined): string {
  const candidate = (session?.user as { organizationId?: string | null } | undefined)?.organizationId;
  if (typeof candidate === "string" && candidate.length > 0) return candidate;
  return DEFAULT_ORGANIZATION_ID;
}
