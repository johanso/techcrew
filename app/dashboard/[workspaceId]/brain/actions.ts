"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/current-user";
import { requestLearning } from "@/lib/librarian-request";
import { requestLibrarianRun } from "@/lib/librarian-run";
import { createMemoryNote, deleteMemoryNote, setMemoryNoteStatus, updateMemoryNote, type NotePlace } from "@/lib/memory";
import { isMemoryMode, type NoteField } from "@/lib/memory-config";
import { LIBRARIAN_JOBS, type LibrarianJob } from "@/lib/memory-proposals";
import {
  acceptProposal,
  editProposal,
  openMemoryPullRequest,
  refreshMemoryPullRequests,
  rejectProposal,
  type ProposalWrite,
} from "@/lib/memory-proposals-store";
import type { MemoryScanFinding } from "@/lib/memory-scan";
import type { SignalField } from "@/lib/memory-signals";
import { answerRejection, deleteSignal, dismissRejection, rememberNote, type SignalWrite } from "@/lib/memory-signals-store";
import { getOwnedWorkspace, updateMemoryMode } from "@/lib/workspaces";

/**
 * The Brain page's mutations. Every id and scope comes from the request and is untrusted: the workspace is loaded
 * with an owner-scoped query, a note is only ever touched inside the owner's place (their global notes, or this
 * workspace's), and the text is validated and scanned again by lib/memory.ts.
 */

export type NoteFormState = {
  ok?: boolean;
  message?: string;
  errors?: Partial<Record<NoteField, string>>;
  /** What the security scan found: critical ones blocked the save, the rest were allowed. */
  findings?: MemoryScanFinding[];
};

export type MemoryScopeName = "project" | "global";

async function authorize(workspaceId: number) {
  const user = await requireUser(`/dashboard/${workspaceId}/brain`);
  const workspace = await getOwnedWorkspace(user.id, workspaceId);
  return workspace ? { user, workspace } : null;
}

const placeOf = (userId: number, workspaceId: number, scope: MemoryScopeName): NotePlace => ({ userId, workspaceId: scope === "global" ? null : workspaceId });

const isScope = (value: unknown): value is MemoryScopeName => value === "project" || value === "global";

const refresh = (workspaceId: number) => revalidatePath(`/dashboard/${workspaceId}/brain`);

/** Creates (`noteId` null) or edits a note by hand. Project notes only exist in mode `local`. */
export async function saveNoteAction(workspaceId: number, scope: MemoryScopeName, noteId: number | null, _prev: NoteFormState, formData: FormData): Promise<NoteFormState> {
  const owned = await authorize(workspaceId);
  if (!owned) return { message: "Workspace not found." };
  if (!isScope(scope)) return { message: "Choose where the note belongs." };
  if (scope === "project" && owned.workspace.memoryMode !== "local") {
    return { message: "Project notes are kept as files in the repository in this mode. Switch to “On this computer” in the settings below to write them here." };
  }

  const input = {
    title: formData.get("title"),
    type: formData.get("type"),
    load: formData.get("load"),
    paths: formData.get("paths"),
    body: formData.get("body"),
    // Notes written here are the owner's own; edits keep what is already stored.
    status: "active",
    source: { kind: "owner" },
  };
  const place = placeOf(owned.user.id, workspaceId, scope);
  const result = noteId === null ? await createMemoryNote(place, input) : await updateMemoryNote(place, noteId, input);
  if (!result.ok) return { errors: result.errors, message: result.message, findings: result.findings };
  refresh(workspaceId);
  return { ok: true, findings: result.warnings };
}

export type NoteActionResult = { ok: boolean; message?: string };

/** Switches a note off (agents stop seeing it) or back on. */
export async function setNoteStatusAction(workspaceId: number, scope: MemoryScopeName, noteId: number, status: "active" | "disabled"): Promise<NoteActionResult> {
  const owned = await authorize(workspaceId);
  if (!owned) return { ok: false, message: "Workspace not found." };
  if (!isScope(scope) || (status !== "active" && status !== "disabled")) return { ok: false, message: "That isn't something a note can be." };
  const changed = await setMemoryNoteStatus(placeOf(owned.user.id, workspaceId, scope), noteId, status);
  if (!changed) return { ok: false, message: "Note not found." };
  refresh(workspaceId);
  return { ok: true };
}

export async function deleteNoteAction(workspaceId: number, scope: MemoryScopeName, noteId: number): Promise<NoteActionResult> {
  const owned = await authorize(workspaceId);
  if (!owned) return { ok: false, message: "Workspace not found." };
  if (!isScope(scope)) return { ok: false, message: "Choose where the note belongs." };
  const deleted = await deleteMemoryNote(placeOf(owned.user.id, workspaceId, scope), noteId);
  if (!deleted) return { ok: false, message: "Note not found." };
  refresh(workspaceId);
  return { ok: true };
}

// ── Signals ────────────────────────────────────────────────────────────────────
// Used by the Brain page's Activity, the board and the Pull Requests page (lib/memory-signals-store.ts validates and
// scans; every id is looked up inside the owner's workspace).

export type SignalFormState = {
  ok?: boolean;
  /** Saved as the owner's own words (Remember this). */
  trusted?: boolean;
  message?: string;
  errors?: Partial<Record<SignalField, string>>;
  /** What the security scan found when it refused the text. */
  findings?: MemoryScanFinding[];
};

const toFormState = (result: SignalWrite): SignalFormState =>
  result.ok ? { ok: true, trusted: result.trusted } : { message: result.message, errors: result.errors, findings: result.findings };

/** A closed question changes the board, the Pull Requests page and the Brain's Activity. */
function refreshSignals(workspaceId: number) {
  refresh(workspaceId);
  revalidatePath(`/dashboard/${workspaceId}/pull-requests`);
}

/** "Why was this rejected?": a reason and an optional note about a pull request closed without merging. */
export async function answerRejectionAction(workspaceId: number, pullRequestId: number, _prev: SignalFormState, formData: FormData): Promise<SignalFormState> {
  const owned = await authorize(workspaceId);
  if (!owned) return { message: "Workspace not found." };
  const result = await answerRejection(owned.workspace.id, pullRequestId, { reason: formData.get("reason"), note: formData.get("text") });
  if (result.ok) {
    await requestLearning(owned.workspace.id);
    refreshSignals(workspaceId);
  }
  return toFormState(result);
}

/** Closes the question for good, without a reason. */
export async function dismissRejectionAction(workspaceId: number, pullRequestId: number): Promise<NoteActionResult> {
  const owned = await authorize(workspaceId);
  if (!owned) return { ok: false, message: "Workspace not found." };
  const dismissed = await dismissRejection(owned.workspace.id, pullRequestId);
  if (!dismissed) return { ok: false, message: "We couldn't dismiss the question. Reload the page and try again." };
  refreshSignals(workspaceId);
  return { ok: true };
}

/** "Remember this" on a board card (`stepId` null) or on an entry of its agent log. */
export async function rememberAction(workspaceId: number, cardId: string, stepId: number | null, _prev: SignalFormState, formData: FormData): Promise<SignalFormState> {
  const owned = await authorize(workspaceId);
  if (!owned) return { message: "Workspace not found." };
  const result = await rememberNote(owned.workspace.id, { taskId: Number(cardId), stepId }, { text: formData.get("text"), scope: formData.get("scope") });
  if (result.ok) {
    await requestLearning(owned.workspace.id);
    refresh(workspaceId);
  }
  return toFormState(result);
}

export async function deleteSignalAction(workspaceId: number, signalId: number): Promise<NoteActionResult> {
  const owned = await authorize(workspaceId);
  if (!owned) return { ok: false, message: "Workspace not found." };
  const deleted = await deleteSignal(owned.workspace.id, signalId);
  if (!deleted) return { ok: false, message: "That entry isn't there any more." };
  refresh(workspaceId);
  return { ok: true };
}

// ── The librarian and its proposals ────────────────────────────────────────────

/** "Learn now" and "Build a first memory": asks the job runner for a librarian run. */
export async function runLibrarianAction(workspaceId: number, job: LibrarianJob): Promise<NoteActionResult> {
  const owned = await authorize(workspaceId);
  if (!owned) return { ok: false, message: "Workspace not found." };
  if (!LIBRARIAN_JOBS.includes(job)) return { ok: false, message: "That isn't something the librarian does." };
  const result = await requestLibrarianRun(owned.workspace, job);
  refresh(workspaceId);
  return result;
}

export type ProposalFormState = {
  ok?: boolean;
  message?: string;
  errors?: Partial<Record<NoteField, string>>;
  findings?: MemoryScanFinding[];
};

/** The owner's edit in a proposal's form, or null when the form carries none. */
function editOf(formData: FormData) {
  if (formData.get("edited") !== "1") return null;
  return {
    title: formData.get("title"),
    type: formData.get("type"),
    load: formData.get("load"),
    paths: formData.get("paths"),
    body: formData.get("body"),
  };
}

const proposalState = (result: ProposalWrite): ProposalFormState =>
  result.ok ? { ok: true, message: result.message } : { message: result.message, errors: result.errors, findings: result.findings };

/** Accepts a proposal into the notes, with the owner's edit if the form carries one. */
export async function acceptProposalAction(workspaceId: number, proposalId: number, _prev: ProposalFormState, formData: FormData): Promise<ProposalFormState> {
  const owned = await authorize(workspaceId);
  if (!owned) return { message: "Workspace not found." };
  const result = await acceptProposal(owned.workspace, proposalId, { edit: editOf(formData), confirmed: formData.get("confirmed") === "on" });
  refresh(workspaceId);
  return proposalState(result);
}

/** Saves an edit to a proposal that stays waiting for the memory pull request. */
export async function editProposalAction(workspaceId: number, proposalId: number, _prev: ProposalFormState, formData: FormData): Promise<ProposalFormState> {
  const owned = await authorize(workspaceId);
  if (!owned) return { message: "Workspace not found." };
  const result = await editProposal(owned.workspace, proposalId, editOf(formData));
  refresh(workspaceId);
  return proposalState(result);
}

export async function rejectProposalAction(workspaceId: number, proposalId: number): Promise<NoteActionResult> {
  const owned = await authorize(workspaceId);
  if (!owned) return { ok: false, message: "Workspace not found." };
  const result = await rejectProposal(owned.workspace, proposalId);
  refresh(workspaceId);
  return result;
}

/** "Open memory pull request": the chosen proposals, with the untrusted ones the owner confirmed. */
export async function openMemoryPullRequestAction(workspaceId: number, proposalIds: number[], confirmedIds: number[]): Promise<NoteActionResult> {
  const owned = await authorize(workspaceId);
  if (!owned) return { ok: false, message: "Workspace not found." };
  if (!Array.isArray(proposalIds) || !Array.isArray(confirmedIds)) return { ok: false, message: "Select at least one proposal." };
  const result = await openMemoryPullRequest(owned.workspace, proposalIds, confirmedIds);
  refresh(workspaceId);
  return result;
}

/** Checks the memory pull request on GitHub now: merged or closed. */
export async function refreshMemoryPullRequestsAction(workspaceId: number): Promise<NoteActionResult> {
  const owned = await authorize(workspaceId);
  if (!owned) return { ok: false, message: "Workspace not found." };
  const { ended, unchecked } = await refreshMemoryPullRequests(owned.workspace);
  refresh(workspaceId);
  if (unchecked) return { ok: false, message: "GitHub couldn't be checked. Try again, or reconnect GitHub." };
  return { ok: true, message: ended ? "Updated from GitHub." : "Still open on GitHub." };
}

export type MemoryModeFormState = { ok?: boolean; message?: string; savedAt?: number };

/** Brain → Settings: where this project's memory lives, and whether the librarian learns on its own. */
export async function saveMemoryModeAction(workspaceId: number, _prev: MemoryModeFormState, formData: FormData): Promise<MemoryModeFormState> {
  const owned = await authorize(workspaceId);
  if (!owned) return { message: "Workspace not found." };
  const mode = formData.get("mode");
  if (!isMemoryMode(mode)) return { message: "Choose where the project's memory lives." };
  await updateMemoryMode(owned.workspace.id, { memoryMode: mode, memoryAutoLearn: formData.get("autoLearn") === "on" });
  refresh(workspaceId);
  return { ok: true, savedAt: Date.now() };
}
