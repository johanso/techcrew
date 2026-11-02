"use client";

import { DEFAULT_WORKSPACE_ICON, isWorkspaceIcon, type WorkspaceIconKey } from "@/lib/workspace-icons";

/**
 * Keeps the half-filled form across the GitHub OAuth round trip (a full-page redirect).
 * sessionStorage is per tab and cleared when the tab closes; failures are non-fatal.
 */

const KEY = "techteam:workspace-draft";

export type WorkspaceDraft = {
  name: string;
  icon: WorkspaceIconKey;
  repo: string | null;
  logo: File | null;
};

type StoredDraft = Omit<WorkspaceDraft, "logo"> & { logo: { dataUrl: string; name: string } | null };

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function saveDraft(draft: WorkspaceDraft) {
  try {
    const logo = draft.logo ? { dataUrl: await readAsDataUrl(draft.logo), name: draft.logo.name } : null;
    sessionStorage.setItem(KEY, JSON.stringify({ ...draft, logo } satisfies StoredDraft));
  } catch {
    // Quota exceeded or storage disabled: the user just re-enters the fields.
  }
}

/** Returns the saved draft once and removes it. */
export async function takeDraft(): Promise<WorkspaceDraft | null> {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as StoredDraft;
    let logo: File | null = null;
    if (stored.logo) {
      const blob = await (await fetch(stored.logo.dataUrl)).blob();
      logo = new File([blob], stored.logo.name, { type: blob.type });
    }
    return {
      name: typeof stored.name === "string" ? stored.name : "",
      icon: isWorkspaceIcon(stored.icon) ? stored.icon : DEFAULT_WORKSPACE_ICON,
      repo: typeof stored.repo === "string" ? stored.repo : null,
      logo,
    };
  } catch {
    return null;
  }
}
