"use client";

import { useState } from "react";
import { UploadIcon } from "lucide-react";

import { SkillUpload } from "@/components/skills/skill-upload";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Settings → Agent skills header action: the upload flow in a dialog. */
export function SkillUploadButton({ workspaceId }: { workspaceId: number }) {
  const [open, setOpen] = useState(false);
  // A fresh upload form every time the dialog opens.
  const [session, setSession] = useState(0);
  return (
    <>
      <Button
        type="button"
        className="h-9"
        onClick={() => {
          setSession((n) => n + 1);
          setOpen(true);
        }}
      >
        <UploadIcon data-icon="inline-start" />
        Upload skill
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Upload a skill</DialogTitle>
            <DialogDescription>It&apos;s checked and scanned first. Nothing is installed until you confirm.</DialogDescription>
          </DialogHeader>
          <SkillUpload key={session} workspaceId={workspaceId} onClose={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}
