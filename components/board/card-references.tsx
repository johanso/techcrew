"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FileTextIcon, FileTypeIcon, PaperclipIcon, Trash2Icon, UploadIcon } from "lucide-react";

import {
  listCardReferencesAction,
  removeCardReferenceAction,
  uploadCardReferenceAction,
} from "@/app/dashboard/[workspaceId]/board/actions";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  REFERENCE_ACCEPT,
  REFERENCE_KIND_META,
  REFERENCE_MAX_BYTES,
  REFERENCE_UPLOAD_MAX_BYTES,
  REFERENCES_MAX,
  describeReference,
  formatReferenceBytes,
  referenceHref,
  type ReferenceView,
} from "@/lib/reference-config";
import { cn } from "@/lib/utils";

const LIMITS = `PNG, JPEG or WebP up to ${formatReferenceBytes(REFERENCE_MAX_BYTES.image)}, Markdown or text up to ${formatReferenceBytes(
  REFERENCE_MAX_BYTES.text
)}, PDF up to ${formatReferenceBytes(REFERENCE_MAX_BYTES.pdf)}. Up to ${REFERENCES_MAX} per card.`;

/**
 * The References section of the card dialog: files the owner attaches for the agents to build from (a design, a spec,
 * a document). Uploads go one file per call; each row opens the file through the owner-checked route.
 */
export function CardReferences({
  workspaceId,
  cardId,
  enabled,
  expected = 0,
  onCountChange,
}: {
  workspaceId: number;
  /** The card, or null while it's being created (references need a saved card). */
  cardId: string | null;
  /** False when the server has no file storage. */
  enabled: boolean;
  /** How many references the board says the card has: that many loading rows while the list loads. */
  expected?: number;
  onCountChange?: (count: number) => void;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 id={headingId} className="text-sm font-medium">
          References
        </h3>
        <p className="text-xs text-muted-foreground">Designs, specs or documents the agents read and build from.</p>
      </div>
      {!cardId ? (
        <Note>Save the card to add references.</Note>
      ) : !enabled ? (
        <Note>File storage isn&apos;t set up on this server, so references can&apos;t be added.</Note>
      ) : (
        <ReferenceList workspaceId={workspaceId} cardId={cardId} expected={expected} onCountChange={onCountChange} />
      )}
    </section>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg bg-muted/60 px-3.5 py-3 text-sm text-muted-foreground ring-1 ring-border/70">{children}</p>;
}

function ReferenceList({
  workspaceId,
  cardId,
  expected,
  onCountChange,
}: {
  workspaceId: number;
  cardId: string;
  expected: number;
  onCountChange?: (count: number) => void;
}) {
  const [references, setReferences] = useState<ReferenceView[] | null>(null);
  const [uploading, setUploading] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const report = useRef(onCountChange);
  useEffect(() => {
    report.current = onCountChange;
  }, [onCountChange]);
  // The board card's paperclip count follows the list.
  useEffect(() => {
    if (references) report.current?.(references.length);
  }, [references]);

  useEffect(() => {
    let active = true;
    listCardReferencesAction(workspaceId, cardId)
      .then((result) => {
        if (!active) return;
        if (result.ok) {
          setReferences(result.references);
        } else {
          setReferences([]);
          setErrors([result.error]);
        }
      })
      .catch(() => {
        if (!active) return;
        setReferences([]);
        setErrors(["We couldn't load the references. Please try again."]);
      });
    return () => {
      active = false;
    };
  }, [workspaceId, cardId]);

  const count = references?.length ?? 0;
  const full = count + uploading.length >= REFERENCES_MAX;

  // One upload of that name finished (names can repeat, so only the first match goes).
  const done = (name: string) =>
    setUploading((prev) => {
      const at = prev.indexOf(name);
      return at === -1 ? prev : [...prev.slice(0, at), ...prev.slice(at + 1)];
    });

  const upload = async (files: File[]) => {
    if (!files.length) return;
    const room = Math.max(0, REFERENCES_MAX - count - uploading.length);
    const taken = files.slice(0, room);
    const problems = files.length > room ? [`A card can have up to ${REFERENCES_MAX} references; ${files.length - room} file${files.length - room === 1 ? " was" : "s were"} left out.`] : [];
    setErrors(problems);
    setUploading((prev) => [...prev, ...taken.map((f) => f.name)]);
    // One file per call: each stays under the server's upload limit, and one bad file doesn't stop the others.
    for (const file of taken) {
      // Over the largest limit it would never reach the server action (body limit); the server checks the rest.
      if (file.size > REFERENCE_UPLOAD_MAX_BYTES) {
        setErrors((prev) => [...prev, `${file.name} is larger than ${formatReferenceBytes(REFERENCE_UPLOAD_MAX_BYTES)}.`]);
        done(file.name);
        continue;
      }
      try {
        const data = new FormData();
        data.set("file", file);
        const result = await uploadCardReferenceAction(workspaceId, cardId, data);
        if (result.ok) {
          setReferences((prev) => [...(prev ?? []), result.reference]);
        } else {
          setErrors((prev) => [...prev, result.error]);
        }
      } catch {
        setErrors((prev) => [...prev, `We couldn't add ${file.name}. Please try again.`]);
      } finally {
        done(file.name);
      }
    }
  };

  const remove = async (reference: ReferenceView) => {
    setRemoving(reference.id);
    setErrors([]);
    try {
      const result = await removeCardReferenceAction(workspaceId, cardId, reference.id);
      if (!result.ok) return setErrors([result.error]);
      setReferences((prev) => (prev ?? []).filter((r) => r.id !== reference.id));
    } catch {
      setErrors(["We couldn't remove the reference. Please try again."]);
    } finally {
      setRemoving(null);
      setConfirming(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {references === null ? (
        expected > 0 && (
          <ul className="flex flex-col gap-2" aria-busy="true">
            {Array.from({ length: Math.min(expected, REFERENCES_MAX) }, (_, i) => (
              <li key={i} className="flex min-w-0 items-center gap-3 rounded-lg border bg-card p-2">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
                  <Spinner className="text-muted-foreground" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  {i === 0 ? <span className="text-sm text-muted-foreground">Loading references…</span> : <Skeleton className="h-4 w-40" />}
                  <Skeleton className="h-3 w-24" />
                </div>
              </li>
            ))}
          </ul>
        )
      ) : (
        (references.length > 0 || uploading.length > 0) && (
          <ul className="flex flex-col gap-2">
            {references.map((reference) => (
              <li key={reference.id} className="flex min-w-0 items-center gap-3 rounded-lg border bg-card p-2 pr-2.5">
                <Thumbnail workspaceId={workspaceId} reference={reference} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <a
                    href={referenceHref(workspaceId, reference.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate text-sm font-medium hover:text-brand-emphasis hover:underline focus-visible:underline"
                  >
                    {reference.name}
                  </a>
                  <span className="truncate text-xs text-muted-foreground">
                    {REFERENCE_KIND_META[reference.kind].label} · {describeReference(reference)}
                  </span>
                </div>
                {confirming === reference.id ? (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={removing === reference.id}
                      onClick={() => remove(reference)}
                      aria-label={`Remove ${reference.name}`}
                    >
                      {removing === reference.id ? <Spinner /> : null}
                      {removing === reference.id ? "Removing…" : "Remove"}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" disabled={removing === reference.id} onClick={() => setConfirming(null)}>
                      Keep
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => setConfirming(reference.id)}
                    aria-label={`Remove ${reference.name}`}
                  >
                    <Trash2Icon />
                  </Button>
                )}
              </li>
            ))}
            {uploading.map((name, i) => (
              <li key={`${name}-${i}`} className="flex min-w-0 items-center gap-3 rounded-lg border bg-muted/40 p-2 text-sm text-muted-foreground">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
                  <Spinner />
                </span>
                <span className="truncate">Uploading {name}…</span>
              </li>
            ))}
          </ul>
        )
      )}

      {errors.length > 0 && (
        <ul role="alert" className="flex flex-col gap-1 text-sm text-destructive">
          {errors.map((error, i) => (
            <li key={i}>{error}</li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <input
          ref={input}
          type="file"
          multiple
          accept={REFERENCE_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            void upload(files);
          }}
        />
        <Button type="button" variant="outline" className="h-9 self-start" disabled={references === null || full} onClick={() => input.current?.click()}>
          {uploading.length || references === null ? <Spinner /> : count ? <PaperclipIcon /> : <UploadIcon />}
          {uploading.length ? "Uploading…" : count ? "Add more files" : "Add files"}
        </Button>
        <p className="text-xs text-muted-foreground">{full && !uploading.length ? `This card has the most references it can have (${REFERENCES_MAX}).` : LIMITS}</p>
      </div>
    </div>
  );
}

function Thumbnail({ workspaceId, reference }: { workspaceId: number; reference: ReferenceView }) {
  if (reference.kind === "image") return <ImageThumbnail src={referenceHref(workspaceId, reference.id)} />;
  const Icon = reference.kind === "pdf" ? FileTypeIcon : FileTextIcon;
  return (
    <span className={cn("icon-tile size-10 shrink-0 rounded-md", reference.kind === "pdf" ? "text-action" : "text-brand-emphasis")}>
      <Icon />
    </span>
  );
}

/** An image reference's thumbnail, with a spinner until it arrives (it streams from private storage). */
function ImageThumbnail({ src }: { src: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <span className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted ring-1 ring-border/70">
      {!loaded && <Spinner className="absolute text-muted-foreground" />}
      {/* eslint-disable-next-line @next/next/no-img-element -- auth-gated route; next/image can't optimize it */}
      <img
        src={src}
        alt=""
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
        className={cn("size-full object-cover transition-opacity", loaded ? "opacity-100" : "opacity-0")}
      />
    </span>
  );
}
