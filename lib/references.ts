import "server-only";

import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";

import { db, taskReferences, tasks, workspaces, type TaskReferenceRow } from "@/db";
import {
  REFERENCES_MAX,
  VISUAL_REFERENCE_KINDS,
  imageAttached,
  imageWithoutVision,
  isReferenceKind,
  linkAttached,
  pageReferenceText,
  pdfWithoutText,
  formatReferenceList,
  validateReference,
  type AgentReferenceInfo,
  type ReferenceView,
} from "@/lib/reference-config";
import { referenceImage, type LoadedImage, type ReferenceImageView, type ToolImage } from "@/lib/reference-images";
import { PdfReadError, extractPdfText } from "@/lib/reference-pdf";
import { captureLink } from "@/lib/sandbox/capture";
import { formatCaptureOutline, linkReferenceName } from "@/lib/sandbox/capture-config";
import { deleteObject, readObject, uploadCardReference } from "@/lib/storage";

/**
 * Card references: files the owner attaches to a card (images, Markdown or text, PDFs) and links captured once when
 * they're added (lib/sandbox/capture.ts), for the agents to build from. Files, a PDF's extracted text and a link's
 * screenshots and outline live in local files (lib/storage.ts); the task_references row keeps only what and where.
 * Every function takes ids the caller already scoped to the workspace (board actions, the owner-checked route, or the
 * pipeline's run context). Agents read them with list_references / read_reference (lib/agent-tools.ts).
 */

type Scope = { workspaceId: number; taskId: number };

const scoped = ({ workspaceId, taskId }: Scope) => and(eq(taskReferences.workspaceId, workspaceId), eq(taskReferences.taskId, taskId));

function toView(row: TaskReferenceRow): ReferenceView {
  return {
    id: String(row.id),
    kind: isReferenceKind(row.kind) ? row.kind : "text",
    name: row.name,
    contentType: row.contentType,
    size: row.sizeBytes,
    width: row.width,
    height: row.height,
    pages: row.pageCount,
    hasText: row.kind === "pdf" ? (row.textLength ?? 0) > 0 : null,
    sourceUrl: row.kind === "link" ? row.sourceUrl : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** How many references each card of the workspace has (cards without any are left out). */
export async function getReferenceCounts(workspaceId: number) {
  const rows = await db
    .select({ taskId: taskReferences.taskId, n: count() })
    .from(taskReferences)
    .where(eq(taskReferences.workspaceId, workspaceId))
    .groupBy(taskReferences.taskId);
  return new Map(rows.map((row) => [row.taskId, row.n]));
}

export async function listTaskReferences(scope: Scope): Promise<ReferenceView[]> {
  const rows = await db.select().from(taskReferences).where(scoped(scope)).orderBy(asc(taskReferences.createdAt), asc(taskReferences.id));
  return rows.map(toView);
}

/** Removes stored objects, best effort: a failure is logged, never thrown (the row is what the app reads). */
async function deleteObjects(keys: (string | null)[]) {
  await Promise.all(
    keys
      .filter((key): key is string => Boolean(key))
      .map((key) => deleteObject(key).catch((error) => console.error("[references] object not deleted", key, error)))
  );
}

export type AddReferenceResult = { ok: true; reference: ReferenceView } | { ok: false; error: string };

/**
 * Validates an upload by its bytes (type, size, image dimensions), stores it (and a PDF's text) in local storage, then saves its
 * row. The count is checked again under a lock on the card, so two uploads at once can't pass the limit; objects of
 * an upload that loses that race are deleted.
 */
export async function addTaskReference(input: Scope & { userId: number; name: string; bytes: Uint8Array }): Promise<AddReferenceResult> {
  const [{ n }] = await db.select({ n: count() }).from(taskReferences).where(scoped(input));
  const valid = validateReference({ name: input.name, bytes: input.bytes, count: n ?? 0 });
  if (!valid.ok) return valid;
  const ref = valid.value;

  let pdf: Awaited<ReturnType<typeof extractPdfText>> | null = null;
  if (ref.kind === "pdf") {
    try {
      pdf = await extractPdfText(input.bytes);
    } catch (error) {
      if (error instanceof PdfReadError) return { ok: false, error: error.message };
      throw error;
    }
  }

  const storageKey = await uploadCardReference({ ...input, ext: ref.ext, contentType: ref.contentType, bytes: input.bytes });
  let textKey: string | null = null;
  try {
    if (pdf?.text) {
      textKey = await uploadCardReference({ ...input, ext: "txt", contentType: "text/plain; charset=utf-8", bytes: new TextEncoder().encode(pdf.text) });
    }
    const saved = await insertUnderLock(input, {
      kind: ref.kind,
      name: ref.name,
      contentType: ref.contentType,
      sizeBytes: ref.size,
      storageKey,
      textKey,
      textLength: pdf ? pdf.text.length : null,
      pageCount: pdf ? pdf.pages : null,
      width: ref.width,
      height: ref.height,
    });
    if (!saved.ok) await deleteObjects([storageKey, textKey]);
    return saved;
  } catch (error) {
    await deleteObjects([storageKey, textKey]);
    throw error;
  }
}

type NewReference = Omit<typeof taskReferences.$inferInsert, "id" | "workspaceId" | "taskId" | "createdById" | "createdAt">;

/**
 * Saves a reference's row once its objects are stored. The count is checked again under a lock on the card, so two
 * additions at once can't pass the limit; the caller deletes the objects when this refuses.
 */
async function insertUnderLock(input: Scope & { userId: number }, values: NewReference): Promise<AddReferenceResult> {
  const row = await db.transaction(async (tx) => {
    const [card] = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, input.taskId), eq(tasks.workspaceId, input.workspaceId), isNull(tasks.removedAt)))
      .for("update");
    if (!card) return "gone" as const;
    const [{ n: now }] = await tx.select({ n: count() }).from(taskReferences).where(scoped(input));
    if ((now ?? 0) >= REFERENCES_MAX) return "full" as const;
    const [created] = await tx
      .insert(taskReferences)
      .values({ ...values, workspaceId: input.workspaceId, taskId: input.taskId, createdById: input.userId })
      .returning();
    return created!;
  });
  if (row === "gone") return { ok: false, error: "This card no longer exists." };
  if (row === "full") return { ok: false, error: "This card already has the most references it can have." };
  return { ok: true, reference: toView(row) };
}

/**
 * Adds a link: captures the page now (lib/sandbox/capture.ts: desktop and mobile screenshots, an outline), stores the
 * three files and saves the row. A failed capture stores nothing and says why.
 */
export async function addLinkReference(input: Scope & { userId: number; url: string }): Promise<AddReferenceResult> {
  const [{ n }] = await db.select({ n: count() }).from(taskReferences).where(scoped(input));
  if ((n ?? 0) >= REFERENCES_MAX) return { ok: false, error: `A card can have up to ${REFERENCES_MAX} references. Remove one first.` };
  const captured = await captureLink(input.url);
  if (!captured.ok) return captured;
  const { value } = captured;
  const outlineText = formatCaptureOutline({ url: captured.url, finalUrl: value.finalUrl, title: value.title, outline: value.outline });
  const outline = new TextEncoder().encode(outlineText);

  const keys: string[] = [];
  const upload = async (ext: string, contentType: string, bytes: Uint8Array) => {
    const key = await uploadCardReference({ ...input, ext, contentType, bytes });
    keys.push(key);
    return key;
  };
  try {
    const storageKey = await upload("jpg", "image/jpeg", value.desktop.bytes);
    const mobileKey = await upload("jpg", "image/jpeg", value.mobile.bytes);
    const textKey = await upload("txt", "text/plain; charset=utf-8", outline);
    const saved = await insertUnderLock(input, {
      kind: "link",
      name: linkReferenceName(value.title, value.finalUrl ?? captured.url),
      contentType: "image/jpeg",
      sizeBytes: value.desktop.bytes.length + value.mobile.bytes.length + outline.length,
      storageKey,
      mobileKey,
      textKey,
      textLength: outlineText.length,
      width: value.desktop.width,
      height: value.desktop.height,
      sourceUrl: captured.url,
    });
    if (!saved.ok) await deleteObjects(keys);
    return saved;
  } catch (error) {
    await deleteObjects(keys);
    throw error;
  }
}

/** Deletes one reference: its row, then its objects (best effort). False when it wasn't on this card. */
export async function removeTaskReference(scope: Scope, referenceId: number) {
  const [removed] = await db
    .delete(taskReferences)
    .where(and(scoped(scope), eq(taskReferences.id, referenceId)))
    .returning({ storageKey: taskReferences.storageKey, textKey: taskReferences.textKey, mobileKey: taskReferences.mobileKey });
  if (!removed) return false;
  await deleteObjects([removed.storageKey, removed.textKey, removed.mobileKey]);
  return true;
}

/** Deletes every reference of a card (it was removed from the board): rows, then objects (best effort, logged). */
export async function deleteTaskReferences(scope: Scope) {
  const removed = await db
    .delete(taskReferences)
    .where(scoped(scope))
    .returning({ storageKey: taskReferences.storageKey, textKey: taskReferences.textKey, mobileKey: taskReferences.mobileKey });
  await deleteObjects(removed.flatMap((row) => [row.storageKey, row.textKey, row.mobileKey]));
  return removed.length;
}

/**
 * A reference's file for the owner-checked route, or null when it isn't in a workspace this user owns. A link's
 * `storageKey` is its desktop screenshot, `mobileKey` the mobile one.
 */
export async function getOwnedReferenceFile(ownerId: number, workspaceId: number, referenceId: number) {
  const [row] = await db
    .select({
      kind: taskReferences.kind,
      name: taskReferences.name,
      contentType: taskReferences.contentType,
      storageKey: taskReferences.storageKey,
      mobileKey: taskReferences.mobileKey,
    })
    .from(taskReferences)
    .innerJoin(workspaces, eq(workspaces.id, taskReferences.workspaceId))
    .where(and(eq(taskReferences.id, referenceId), eq(taskReferences.workspaceId, workspaceId), eq(workspaces.ownerId, ownerId)));
  return row ?? null;
}

// ── Agents ─────────────────────────────────────────────────────────────────────

/** A reference as the agent tools hold it (server only: it carries storage keys). */
export type AgentReference = AgentReferenceInfo & { storageKey: string; textKey: string | null; mobileKey: string | null };

/** The card's references for its agents (read every turn, like skills: a removed reference is gone next turn). */
export async function getAgentReferences(taskId: number): Promise<AgentReference[]> {
  const rows = await db.select().from(taskReferences).where(eq(taskReferences.taskId, taskId)).orderBy(asc(taskReferences.createdAt), asc(taskReferences.id));
  return rows.map((row) => ({
    id: row.id,
    kind: isReferenceKind(row.kind) ? row.kind : "text",
    name: row.name,
    contentType: row.contentType,
    size: row.sizeBytes,
    width: row.width,
    height: row.height,
    pages: row.pageCount,
    textLength: row.textLength,
    sourceUrl: row.sourceUrl,
    storageKey: row.storageKey,
    textKey: row.textKey,
    mobileKey: row.mobileKey,
  }));
}

/** Whether the card has a reference agents must see (an image or a link: VISUAL_REFERENCE_KINDS). */
export async function taskHasVisualReferences(taskId: number) {
  const [row] = await db
    .select({ id: taskReferences.id })
    .from(taskReferences)
    .where(and(eq(taskReferences.taskId, taskId), inArray(taskReferences.kind, [...VISUAL_REFERENCE_KINDS])))
    .limit(1);
  return Boolean(row);
}

export function listReferencesForAgent(refs: AgentReference[], vision: boolean, browse = false) {
  return formatReferenceList(refs, { vision, browse });
}

async function readText(key: string) {
  const object = await readObject(key).catch((error) => {
    console.error("[references] read failed", error);
    return null;
  });
  return object ? new TextDecoder().decode(object.bytes) : null;
}

/**
 * read_reference: text and PDF text as text (paged), an image as an image for a model that can see (the image is
 * attached by the provider loop from `images`), or a note for one that can't; a link as its outline plus its desktop
 * and mobile screenshots. `target` names the reference for the agent log (never its content).
 */
export async function readReferenceForAgent(
  refs: AgentReference[],
  rawId: unknown,
  rawOffset: unknown,
  vision: boolean
): Promise<{ text: string; images: ToolImage[]; target: string | null }> {
  const id = typeof rawId === "number" ? rawId : typeof rawId === "string" ? Number(rawId.replace(/^#/, "")) : NaN;
  const ref = refs.find((r) => r.id === id);
  if (!ref) {
    return { text: `Error: no reference with id ${JSON.stringify(rawId)} on this card. Ids: ${refs.map((r) => r.id).join(", ") || "none"}.`, images: [], target: null };
  }
  const offset = typeof rawOffset === "number" && Number.isFinite(rawOffset) ? rawOffset : 0;
  const done = (text: string, images: ToolImage[] = []) => ({ text, images, target: ref.name });
  if (ref.kind === "image") return vision ? done(imageAttached(ref), [referenceImage(ref.id)]) : done(imageWithoutVision(ref));
  if (ref.kind === "link") {
    const outline = ref.textKey ? await readText(ref.textKey) : null;
    const shots = vision ? [referenceImage(ref.id, "desktop"), ...(ref.mobileKey ? [referenceImage(ref.id, "mobile")] : [])] : [];
    return done(linkAttached(ref, outline, { vision }), shots);
  }
  if (ref.kind === "pdf" && !ref.textKey) return done(pdfWithoutText(ref.name));
  const content = await readText(ref.kind === "pdf" ? ref.textKey! : ref.storageKey);
  if (content === null) return done(`Error: ${ref.name} couldn't be read from storage. Work without it and say so in your result.`);
  return done(pageReferenceText(ref.name, content, offset));
}

/**
 * An image of this card's references as base64, for a model request: an image reference ("image"), or a link's
 * desktop or mobile screenshot. Null when it's gone or the view doesn't match the kind.
 */
export async function loadReferenceImage(taskId: number, referenceId: number, view: ReferenceImageView = "image"): Promise<LoadedImage | null> {
  const [row] = await db
    .select({ kind: taskReferences.kind, storageKey: taskReferences.storageKey, mobileKey: taskReferences.mobileKey, contentType: taskReferences.contentType })
    .from(taskReferences)
    .where(and(eq(taskReferences.id, referenceId), eq(taskReferences.taskId, taskId)));
  if (!row || (view === "image") !== (row.kind === "image") || (view !== "image" && row.kind !== "link")) return null;
  const key = view === "mobile" ? row.mobileKey : row.storageKey;
  if (!key) return null;
  return loadImageObject(key, row.contentType);
}

/** A stored image as base64 for a model request, when it's a type models take; null otherwise or on a read error. */
export async function loadImageObject(key: string, contentType: string): Promise<LoadedImage | null> {
  const object = await readObject(key).catch((error) => {
    console.error("[references] image read failed", error);
    return null;
  });
  if (!object) return null;
  const mediaType = contentType === "image/png" || contentType === "image/jpeg" || contentType === "image/webp" ? contentType : null;
  return mediaType ? { mediaType, base64: Buffer.from(object.bytes).toString("base64") } : null;
}
