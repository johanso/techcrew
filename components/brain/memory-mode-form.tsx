"use client";

import { startTransition, useActionState, useState } from "react";
import { BanIcon, CheckIcon, FolderGitIcon, GlobeIcon, HardDriveIcon, SettingsIcon } from "lucide-react";

import { saveMemoryModeAction, type MemoryModeFormState } from "@/app/dashboard/[workspaceId]/brain/actions";
import { FormMessage } from "@/components/auth/form-parts";
import { SurfaceHeader } from "@/components/dashboard/page-header";
import { OptionCards, type OptionCard } from "@/components/settings/option-cards";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { MEMORY_MODE_META, type MemoryMode } from "@/lib/memory-config";

const ICON = { repo: FolderGitIcon, local: HardDriveIcon, off: BanIcon } as const;
const OPTIONS: OptionCard<MemoryMode>[] = (["repo", "local", "off"] as const).map((value) => ({
  value,
  icon: ICON[value],
  label: MEMORY_MODE_META[value].label,
  description: MEMORY_MODE_META[value].description,
}));

/** Brain → Settings: where this project's memory lives, with a notice when notes would land in a public repository. */
export function MemoryModeForm({ workspaceId, mode, repoPrivate }: { workspaceId: number; mode: MemoryMode; repoPrivate: boolean }) {
  const [state, formAction, pending] = useActionState<MemoryModeFormState, FormData>(saveMemoryModeAction.bind(null, workspaceId), {});
  const [value, setValue] = useState<MemoryMode>(mode);
  // Compared with what the server rendered, so "Saved" shows only until the next edit.
  const dirty = value !== mode;

  return (
    <section className="surface flex flex-col" aria-label="Brain settings">
      <SurfaceHeader
        icon={
          <span className="icon-tile text-brand-emphasis">
            <SettingsIcon />
          </span>
        }
        title="Settings"
        description="Where this project's notes live. Your own notes follow you to every project."
      />
      <form
        // Dispatched by hand: a form `action` resets the form afterwards, which would flip the radios back.
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          startTransition(() => formAction(data));
        }}
        className="flex flex-col gap-5 p-6"
      >
        <OptionCards name="mode" legend="Project memory" options={OPTIONS} value={value} onChange={setValue} />
        {value === "repo" && !repoPrivate && (
          <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm">
            <GlobeIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
            <span>
              <span className="font-semibold">This repository is public.</span> Notes in .techteam/memory/ are public too. Choose “On this computer” to keep them private.
            </span>
          </p>
        )}
        <FormMessage message={state.message} />
        <div className="flex items-center justify-end gap-3">
          {state.ok && !dirty && !pending && (
            <span role="status" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <CheckIcon aria-hidden className="size-3.5 text-success" />
              Saved
            </span>
          )}
          <Button type="submit" className="h-10" disabled={pending || !dirty}>
            {pending && <Spinner />}
            {pending ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </form>
    </section>
  );
}
