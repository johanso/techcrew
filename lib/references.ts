import "server-only";

import { and, asc, count, eq, isNull } from "drizzle-orm";

import { db, taskReferences, tasks, workspaces, type TaskReferenceRow } from "@/db";
import {
  imageAttached,
  imageWithoutVision,
  isReferenceKind,
  pageReferenceText,
  pdfWithoutText,
  formatReferenceList,
  validateReference,
  type AgentReferenceInfo,
  type ReferenceView,
} from "@/lib/reference-config";
import type { LoadedImage, ToolImage } from "@/lib/reference-images";
import { PdfReadError, extractPdfText } from "@/lib/reference-pdf";
import { deleteObject, readObject, uploadCardReference } from "@/lib/storage";

/**
 * Card references: files the owner attaches to a card (images, Markdown or text, PDFs) for the agents to build from.
 * Files and a PDF's extracted text live in private S3 (lib/storage.ts); the task_references row keeps only what and
 * where. Every function takes ids the caller already scoped to the workspace (board actions, the owner-checked route,
 * or the pipeline's run context). Agents read them with list_references / read_reference (lib/agent-tools.ts).
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
 * Validates an upload by its bytes (type, size, image dimensions), stores it (and a PDF's text) in S3, then saves its
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
    const row = await db.transaction(async (tx) => {
      const [card] = await tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.id, input.taskId), eq(tasks.workspaceId, input.workspaceId), isNull(tasks.removedAt)))
        .for("update");
      if (!card) return "gone" as const;
      const [{ n: now }] = await tx.select({ n: count() }).from(taskReferences).where(scoped(input));
      if (!validateReference({ name: input.name, bytes: input.bytes, count: now ?? 0 }).ok) return "full" as const;
      const [created] = await tx
        .insert(taskReferences)
        .values({
          workspaceId: input.workspaceId,
          taskId: input.taskId,
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
          createdById: input.userId,
        })
        .returning();
      return created!;
    });
    if (row === "gone" || row === "full") {
      await deleteObjects([storageKey, textKey]);
      return { ok: false, error: row === "gone" ? "This card no longer exists." : "This card already has the most references it can have." };
    }
    return { ok: true, reference: toView(row) };
  } catch (error) {
    await deleteObjects([storageKey, textKey]);
    throw error;
  }
}

/** Deletes one reference: its row, then its objects (best effort). False when it wasn't on this card. */
export async function removeTaskReference(scope: Scope, referenceId: number) {
  const [removed] = await db
    .delete(taskReferences)
    .where(and(scoped(scope), eq(taskReferences.id, referenceId)))
    .returning({ storageKey: taskReferences.storageKey, textKey: taskReferences.textKey });
  if (!removed) return false;
  await deleteObjects([removed.storageKey, removed.textKey]);
  return true;
}

/** Deletes every reference of a card (it was removed from the board): rows, then objects (best effort, logged). */
export async function deleteTaskReferences(scope: Scope) {
  const removed = await db
    .delete(taskReferences)
    .where(scoped(scope))
    .returning({ storageKey: taskReferences.storageKey, textKey: taskReferences.textKey });
  await deleteObjects(removed.flatMap((row) => [row.storageKey, row.textKey]));
  return removed.length;
}

/** A reference's file for the owner-checked route, or null when it isn't in a workspace this user owns. */
export async function getOwnedReferenceFile(ownerId: number, workspaceId: number, referenceId: number) {
  const [row] = await db
    .select({ kind: taskReferences.kind, name: taskReferences.name, contentType: taskReferences.contentType, storageKey: taskReferences.storageKey })
    .from(taskReferences)
    .innerJoin(workspaces, eq(workspaces.id, taskReferences.workspaceId))
    .where(and(eq(taskReferences.id, referenceId), eq(taskReferences.workspaceId, workspaceId), eq(workspaces.ownerId, ownerId)));
  return row ?? null;
}

// ── Agents ─────────────────────────────────────────────────────────────────────

/** A reference as the agent tools hold it (server only: it carries storage keys). */
export type AgentReference = AgentReferenceInfo & { storageKey: string; textKey: string | null };

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
    storageKey: row.storageKey,
    textKey: row.textKey,
  }));
}

export async function taskHasImageReferences(taskId: number) {
  const [row] = await db
    .select({ id: taskReferences.id })
    .from(taskReferences)
    .where(and(eq(taskReferences.taskId, taskId), eq(taskReferences.kind, "image")))
    .limit(1);
  return Boolean(row);
}

export function listReferencesForAgent(refs: AgentReference[], vision: boolean) {
  return formatReferenceList(refs, { vision });
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
 * attached by the provider loop from `image`), or a note for one that can't. `target` names the reference for the
 * agent log (never its content).
 */
export async function readReferenceForAgent(
  refs: AgentReference[],
  rawId: unknown,
  rawOffset: unknown,
  vision: boolean
): Promise<{ text: string; image: ToolImage | null; target: string | null }> {
  const id = typeof rawId === "number" ? rawId : typeof rawId === "string" ? Number(rawId.replace(/^#/, "")) : NaN;
  const ref = refs.find((r) => r.id === id);
  if (!ref) {
    return { text: `Error: no reference with id ${JSON.stringify(rawId)} on this card. Ids: ${refs.map((r) => r.id).join(", ") || "none"}.`, image: null, target: null };
  }
  const offset = typeof rawOffset === "number" && Number.isFinite(rawOffset) ? rawOffset : 0;
  const done = (text: string, image: ToolImage | null = null) => ({ text, image, target: ref.name });
  if (ref.kind === "image") return vision ? done(imageAttached(ref), { referenceId: ref.id }) : done(imageWithoutVision(ref));
  if (ref.kind === "pdf" && !ref.textKey) return done(pdfWithoutText(ref.name));
  const content = await readText(ref.kind === "pdf" ? ref.textKey! : ref.storageKey);
  if (content === null) return done(`Error: ${ref.name} couldn't be read from storage. Work without it and say so in your result.`);
  return done(pageReferenceText(ref.name, content, offset));
}

/** A reference image of this card as base64, for a model request; null when it's gone or isn't an image. */
export async function loadReferenceImage(taskId: number, referenceId: number): Promise<LoadedImage | null> {
  const [row] = await db
    .select({ storageKey: taskReferences.storageKey, contentType: taskReferences.contentType })
    .from(taskReferences)
    .where(and(eq(taskReferences.id, referenceId), eq(taskReferences.taskId, taskId), eq(taskReferences.kind, "image")));
  if (!row) return null;
  const object = await readObject(row.storageKey).catch((error) => {
    console.error("[references] image read failed", error);
    return null;
  });
  if (!object) return null;
  const mediaType = row.contentType === "image/png" || row.contentType === "image/jpeg" || row.contentType === "image/webp" ? row.contentType : null;
  return mediaType ? { mediaType, base64: Buffer.from(object.bytes).toString("base64") } : null;
}
