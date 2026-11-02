"use client";

import { useEffect, useRef, useState } from "react";
import { ImageUpIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { WORKSPACE_ICONS, type WorkspaceIconKey } from "@/lib/workspace-icons";
import { cn } from "@/lib/utils";

// Mirrors lib/storage.ts (server-only); the server re-validates every upload.
const LOGO_MAX_BYTES = 1024 * 1024;
const LOGO_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

/** Blob URL for previewing a picked file; revoked when the file changes or on unmount. */
export function useObjectUrl(file: File | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return setUrl(null);
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

export function AppearancePicker({
  icon,
  onIconChange,
  logo,
  onLogoChange,
  uploadsEnabled,
  error,
}: {
  icon: WorkspaceIconKey;
  onIconChange: (icon: WorkspaceIconKey) => void;
  logo: File | null;
  onLogoChange: (logo: File | null) => void;
  uploadsEnabled: boolean;
  error?: string;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const pickLogo = (file: File | undefined) => {
    if (!file) return;
    if (!LOGO_ACCEPT.split(",").includes(file.type)) return setLocalError("Upload a PNG, JPG, WebP or GIF image.");
    if (file.size > LOGO_MAX_BYTES) return setLocalError("The logo must be 1 MB or smaller.");
    setLocalError(null);
    onLogoChange(file);
  };

  return (
    <div className="flex flex-col gap-4">
      <div
        role="radiogroup"
        aria-label="Workspace icon"
        className={cn("grid grid-cols-8 gap-2 transition-opacity", logo && "opacity-50")}
      >
        {(Object.entries(WORKSPACE_ICONS) as [WorkspaceIconKey, (typeof WORKSPACE_ICONS)[WorkspaceIconKey]][]).map(
          ([key, Icon]) => (
            <label key={key} className="relative cursor-pointer" title={key}>
              <input
                type="radio"
                name="icon"
                value={key}
                checked={icon === key}
                onChange={() => onIconChange(key)}
                className="peer sr-only"
              />
              <span
                className={cn(
                  "flex aspect-square items-center justify-center rounded-lg border bg-background text-muted-foreground transition-colors",
                  "hover:bg-muted hover:text-foreground",
                  "peer-checked:border-brand/40 peer-checked:bg-brand/10 peer-checked:text-brand-emphasis",
                  "peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50"
                )}
              >
                <Icon className="size-5" />
                <span className="sr-only">{key}</span>
              </span>
            </label>
          )
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={fileInput}
          type="file"
          name="logo"
          accept={LOGO_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            pickLogo(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          className="h-9"
          disabled={!uploadsEnabled}
          onClick={() => fileInput.current?.click()}
        >
          <ImageUpIcon />
          {logo ? "Replace logo" : "Upload custom logo"}
        </Button>
        {logo && (
          <Button type="button" variant="ghost" className="h-9 text-muted-foreground" onClick={() => onLogoChange(null)}>
            <Trash2Icon />
            Remove
          </Button>
        )}
        <p className="text-xs text-muted-foreground">
          {uploadsEnabled
            ? logo
              ? `${logo.name} · replaces the icon`
              : "PNG, JPG, WebP or GIF · up to 1 MB · square works best"
            : "Logo uploads are unavailable until file storage is configured."}
        </p>
      </div>

      <FieldError>{localError ?? error}</FieldError>
    </div>
  );
}
