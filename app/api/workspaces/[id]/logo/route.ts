import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/current-user";
import { readObject } from "@/lib/storage";
import { getOwnedWorkspace } from "@/lib/workspaces";

/** Streams a workspace logo from private storage to its owner. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/workspaces/[id]/logo">) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse(null, { status: 401 });

  const workspace = await getOwnedWorkspace(user.id, Number((await ctx.params).id));
  if (!workspace?.logoKey) return new NextResponse(null, { status: 404 });

  const object = await readObject(workspace.logoKey).catch((error) => {
    console.error("[storage] logo read failed", error);
    return null;
  });
  if (!object) return new NextResponse(null, { status: 404 });

  return new NextResponse(Buffer.from(object.bytes), {
    headers: {
      "content-type": object.contentType,
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
    },
  });
}
