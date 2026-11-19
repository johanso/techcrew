import { NextResponse, type NextRequest } from "next/server";

import { getStepScreenshotKey } from "@/lib/agent-runs";
import { getCurrentUser } from "@/lib/current-user";
import { readObject } from "@/lib/storage";

const id = (raw: string) => (/^\d{1,12}$/.test(raw) ? Number(raw) : null);

/** Streams the screenshot a browse_preview step took (the agent log) from private storage to the workspace owner. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/runs/[runId]/steps/[stepId]/screenshot">) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse(null, { status: 401 });

  const params = await ctx.params;
  const runId = id(params.runId);
  const stepId = id(params.stepId);
  if (runId === null || stepId === null) return new NextResponse(null, { status: 404 });

  const key = await getStepScreenshotKey(user.id, runId, stepId);
  if (!key) return new NextResponse(null, { status: 404 });

  const object = await readObject(key).catch((error) => {
    console.error("[storage] screenshot read failed", error);
    return null;
  });
  if (!object) return new NextResponse(null, { status: 404 });

  // Always served as a PNG, whatever the object says: it's a picture of an untrusted page.
  return new NextResponse(Buffer.from(object.bytes), {
    headers: {
      "content-type": "image/png",
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}
