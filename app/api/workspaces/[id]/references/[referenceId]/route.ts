import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/current-user";
import { getOwnedReferenceFile } from "@/lib/references";
import { readObject } from "@/lib/storage";

const id = (raw: string) => (/^\d{1,12}$/.test(raw) ? Number(raw) : null);

// The type the bytes were checked to be at upload; anything else is served as a download.
const SERVED_TYPES: Record<string, string> = {
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/webp": "image/webp",
  "text/markdown": "text/plain; charset=utf-8",
  "text/plain": "text/plain; charset=utf-8",
  "application/pdf": "application/pdf",
};

/**
 * Streams a card reference from private storage to the workspace owner: images and text inline (thumbnails, a quick
 * look), PDFs and `?download=1` as an attachment. A link serves its desktop screenshot, or the mobile one with
 * `?view=mobile`. Uploaded and captured content is served sandboxed and never sniffed.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/workspaces/[id]/references/[referenceId]">) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse(null, { status: 401 });

  const params = await ctx.params;
  const workspaceId = id(params.id);
  const referenceId = id(params.referenceId);
  if (workspaceId === null || referenceId === null) return new NextResponse(null, { status: 404 });

  const file = await getOwnedReferenceFile(user.id, workspaceId, referenceId);
  if (!file) return new NextResponse(null, { status: 404 });

  const mobile = request.nextUrl.searchParams.get("view") === "mobile";
  const key = mobile ? (file.kind === "link" ? file.mobileKey : null) : file.storageKey;
  if (!key) return new NextResponse(null, { status: 404 });
  const object = await readObject(key).catch((error) => {
    console.error("[storage] reference read failed", error);
    return null;
  });
  if (!object) return new NextResponse(null, { status: 404 });

  const type = SERVED_TYPES[file.contentType] ?? "application/octet-stream";
  const download = request.nextUrl.searchParams.has("download") || type === "application/pdf" || type === "application/octet-stream";
  // RFC 6266: an ASCII fallback plus the UTF-8 name.
  const name = file.kind === "link" ? `${file.name} (${mobile ? "mobile" : "desktop"}).jpg` : file.name;
  const asciiName = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new NextResponse(Buffer.from(object.bytes), {
    headers: {
      "content-type": type,
      "content-disposition": `${download ? "attachment" : "inline"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}
