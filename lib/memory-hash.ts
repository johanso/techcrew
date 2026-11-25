import { createHash } from "node:crypto";

import type { NoteInput } from "@/lib/memory-config";
import type { ProposalKind, ProposalNote, ProposalTarget } from "@/lib/memory-proposals";
import type { MemoryScope } from "@/lib/memory-config";

/** How notes and proposals are recognized again. Pure (server side: it uses node:crypto). */

const sha256 = (parts: readonly string[]) => parts.reduce((hash, part) => hash.update(part).update("\0"), createHash("sha256")).digest("hex");

/** sha256 of the normalized title and body: the same note can't be saved twice in one place. */
export function noteHash(note: Pick<NoteInput, "title" | "body">) {
  const normal = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
  // The stored hashes (memory_notes.content_hash) separate the two with one NUL and have none at the end.
  return createHash("sha256").update(normal(note.title)).update("\0").update(normal(note.body)).digest("hex");
}

/** Every field of a note as it is: a proposal to update or retire it is only delivered while this stays the same. */
export function noteVersion(note: ProposalNote & { status: string }) {
  return sha256([note.title, note.type, note.load, note.status, note.paths.join("\n"), note.body]);
}

/**
 * What makes two proposals the same one: the new text for an addition, the target and the new text for an update, the
 * target as it was for a retirement (a note that changed since may be proposed for retirement again).
 */
export function proposalHash(proposal: { kind: ProposalKind; scope: MemoryScope; targetKey: string | null; target: ProposalTarget | null; note: ProposalNote | null }) {
  const text = proposal.note ? noteHash(proposal.note) : (proposal.target?.version ?? "");
  return sha256([proposal.kind, proposal.scope, proposal.targetKey ?? "", text]);
}
