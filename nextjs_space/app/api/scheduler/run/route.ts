/**
 * Scheduler trigger endpoint.
 *
 * Called by the external scheduler (cron / systemd timer) every 60s to drive the ingestion
 * dispatcher. Also callable manually from /data-sources via the
 * "Run now" button (with `dataSourceId` to scope to a single source).
 *
 * Auth model:
 *   - GET / POST without a session require a matching `x-pms-scheduler-key`
 *     header (env: `SCHEDULER_TRIGGER_KEY`). The key is generated on first
 *     deploy and surfaced in /data-sources for the operator's reference.
 *   - GET / POST with a NextAuth session (operator clicking "Run now")
 *     skips the header check.
 *
 * Implementation details:
 *   - The dispatcher itself is in `lib/scheduler/dispatch.ts` so it can
 *     also be invoked from a future stand-alone CLI / edge agent.
 *   - We always return a JSON summary, even on partial failure, so the
 *     scheduled task can log it.
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { runDispatcher } from "@/lib/scheduler/dispatch";

async function handle(request: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions).catch(() => null);
  const headerKey = request.headers.get("x-pms-scheduler-key");
  const expectedKey = process.env.SCHEDULER_TRIGGER_KEY;

  if (!session?.user) {
    if (!expectedKey) {
      return NextResponse.json(
        { error: "Scheduler trigger key not configured. Set SCHEDULER_TRIGGER_KEY in .env." },
        { status: 500 },
      );
    }
    if (!headerKey || headerKey !== expectedKey) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Optional scope params.
  const url = new URL(request.url);
  const dataSourceId = url.searchParams.get("dataSourceId") ?? undefined;
  const organizationId = url.searchParams.get("organizationId") ?? undefined;

  try {
    const summary = await runDispatcher({
      dataSourceId,
      organizationId,
      workerId: session?.user ? "manual" : "cron",
    });
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error("[/api/scheduler/run] dispatcher crashed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) { return handle(request); }
export async function GET(request: NextRequest)  { return handle(request); }
