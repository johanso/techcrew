import { NextResponse, type NextRequest } from "next/server";

import { advanceTrustScan, verifyScanToken } from "@/lib/switch-trust";

// One step polls Switch for up to 40 s after registering the agent and starting the run.
export const maxDuration = 120;

/**
 * Called by the scan's Cloudhike job (lib/switch-trust.ts → queueScanJob) with a single-use bearer token.
 * Advances the scan one step. Always answers 200 once authorized: failures are recorded on the scan for the owner,
 * and a retry wouldn't fix them.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/switch-trust/scans/[scanId]">) {
  const scanId = Number((await ctx.params).scanId);
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  if (!Number.isInteger(scanId) || scanId <= 0 || !token || !(await verifyScanToken(scanId, token))) {
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }
  const status = await advanceTrustScan(scanId);
  return NextResponse.json({ scanId, status });
}
