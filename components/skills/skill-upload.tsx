"use client";

import { useId, useRef, useState, useTransition } from "react";
import { CircleCheckIcon, CpuIcon, FileUpIcon, ListChecksIcon, ShieldAlertIcon, TextSearchIcon, ZapIcon } from "lucide-react";

import { inspectSkillAction, installSkillAction } from "@/app/dashboard/[workspaceId]/settings/actions";
import { FormMessage } from "@/components/auth/form-parts";
import { OptionCards, type OptionCard } from "@/components/settings/option-cards";
import { AgentCheckboxes } from "@/components/skills/agent-checkboxes";
import { SkillFindings } from "@/components/skills/skill-findings";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { AGENT_ROLES, type AgentKey } from "@/lib/agent-config";
import {
  ALWAYS_BODY_MAX_BYTES,
  UPLOAD_FILES_MAX,
  UPLOAD_MAX_BYTES,
  UPLOAD_TEXT_MAX_BYTES,
  formatBytes,
  type SkillLoad,
  type SkillScanFinding,
  type SkillType,
} from "@/lib/agent-skills-config";
import type { UploadPreview } from "@/lib/skill-install";

const TYPE_OPTIONS: OptionCard<SkillType>[] = [
  { value: "technical", icon: CpuIcon, label: "Technical", description: "How to use a technology well (a framework, the web platform, an API)." },
  { value: "practice", icon: ListChecksIcon, label: "Practice", description: "How to do a kind of work well (reviews, testing, security)." },
];

const CLASSIFIED_BY: Record<UploadPreview["classifiedBy"], string> = {
  metadata: "Suggested by the skill's own metadata.",
  ai: "Suggested by the AI review. Check it before installing.",
  default: "Pick what fits: the skill has no TechTeam metadata and no AI review ran.",
};

type Stage =
  | { kind: "idle" }
  | { kind: "blocked"; error: string; findings: SkillScanFinding[] }
  | { kind: "confirm"; preview: UploadPreview }
  | { kind: "done"; name: string; roles: AgentKey[] };

/**
 * Upload a skill (Settings → Agent skills, inside a dialog): choose a SKILL.md or .zip → it's validated and scanned
 * (nothing is installed yet) → confirm type, load and the agents to assign → installed. The result stays on screen
 * with a Done button where Install was, so a second click never lands on the page behind. `replace` uploads a new
 * version of an uploaded skill instead.
 */
export function SkillUpload({
  workspaceId,
  replace,
  currentRoles,
  onClose,
}: {
  workspaceId: number;
  replace?: { id: number; name: string };
  /** For a new version: the agents that have the skill on now (pre-checked instead of the suggestion). */
  currentRoles?: AgentKey[];
  /** Closes the dialog (Done after installing). */
  onClose: () => void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<SkillType>("practice");
  const [load, setLoad] = useState<SkillLoad>("on_demand");
  const [roles, setRoles] = useState<AgentKey[]>([]);
  const [checking, startChecking] = useTransition();
  const [installing, startInstalling] = useTransition();

  const formFor = (chosen: File) => {
    const data = new FormData();
    data.set("file", chosen);
    if (replace) data.set("replaceId", String(replace.id));
    return data;
  };

  const reset = () => {
    setFile(null);
    setStage({ kind: "idle" });
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const inspect = (chosen: File) => {
    setFile(chosen);
    setError(null);
    if (chosen.size > UPLOAD_MAX_BYTES) {
      setError(`The file is larger than ${formatBytes(UPLOAD_MAX_BYTES)}.`);
      return;
    }
    startChecking(async () => {
      const result = await inspectSkillAction(workspaceId, formFor(chosen));
      if (result.ok) {
        setType(result.preview.type);
        setLoad(result.preview.load);
        setRoles(currentRoles ?? result.preview.roles);
        setStage({ kind: "confirm", preview: result.preview });
      } else if (result.blocked) {
        setStage({ kind: "blocked", error: result.error, findings: result.blocked.findings });
      } else {
        setError(result.error);
      }
    });
  };

  const install = (preview: UploadPreview) => {
    if (!file) return;
    setError(null);
    startInstalling(async () => {
      const data = formFor(file);
      data.set("token", preview.token);
      data.set("type", type);
      data.set("load", load);
      for (const role of roles) data.append("roles", role);
      const result = await installSkillAction(workspaceId, data);
      if (!result.ok) return setError(result.error);
      setStage({ kind: "done", name: result.name, roles });
      if (inputRef.current) inputRef.current.value = "";
      setFile(null);
    });
  };

  if (stage.kind === "done") {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-start gap-3 rounded-lg bg-success/8 p-4 ring-1 ring-success/25" role="status">
          <CircleCheckIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-sm font-semibold break-words">
              {replace ? `New version of ${stage.name} installed` : `${stage.name} installed`}
            </p>
            <p className="text-sm text-muted-foreground">
              {stage.roles.length
                ? `Switched on for ${stage.roles.map((key) => AGENT_ROLES[key].name).join(", ")}, from their next turn.`
                : "Not switched on for any agent yet. Use Assign in the library when you need it."}
            </p>
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {!replace && (
            <Button type="button" variant="outline" className="h-10" onClick={reset}>
              Upload another
            </Button>
          )}
          <Button type="button" className="h-10" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  if (stage.kind === "confirm") {
    const { preview } = stage;
    const alwaysTooBig = preview.bodyBytes > ALWAYS_BODY_MAX_BYTES;
    const loadOptions: OptionCard<SkillLoad>[] = [
      {
        value: "always",
        icon: ZapIcon,
        label: "Always loaded",
        description: alwaysTooBig
          ? `SKILL.md is ${formatBytes(preview.bodyBytes)}; only playbooks up to ${formatBytes(ALWAYS_BODY_MAX_BYTES)} ride in every prompt.`
          : "Its SKILL.md goes into every prompt. For short role playbooks.",
        disabled: alwaysTooBig,
      },
      { value: "on_demand", icon: TextSearchIcon, label: "On demand", description: "Agents search it and read the guide they need. For libraries." },
    ];
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <p className="eyebrow text-brand-emphasis">{preview.replacing ? "New version" : "Ready to install"}</p>
          <h3 className="text-base font-bold break-words">{preview.name}</h3>
          <p className="text-sm text-muted-foreground">{preview.description}</p>
          <p className="text-xs text-muted-foreground">
            {preview.fileCount} file{preview.fileCount === 1 ? "" : "s"} · {formatBytes(preview.totalBytes)}
            {preview.license ? ` · ${preview.license}` : ""}
          </p>
        </div>

        <div className="flex flex-col gap-3 rounded-lg bg-muted/50 p-4 ring-1 ring-border/60">
          <p className="flex items-center gap-2 text-sm font-semibold">
            {preview.status === "passed" ? (
              <CircleCheckIcon aria-hidden className="size-4 text-success" />
            ) : (
              <ShieldAlertIcon aria-hidden className="size-4 text-warning" />
            )}
            {preview.status === "passed"
              ? `Security scan passed${preview.reviewedBy === "ai" ? " (rules and AI review)" : " (rules)"}`
              : `${preview.findings.length} finding${preview.findings.length === 1 ? "" : "s"} to know about. It can be installed; they count in the trust score of the agents that use it.`}
          </p>
          {preview.findings.length > 0 && <SkillFindings findings={preview.findings} />}
          {preview.aiNotice && <p className="text-xs text-muted-foreground">{preview.aiNotice}</p>}
          {preview.ignored.length > 0 && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer font-medium text-foreground">
                {preview.ignored.length} file{preview.ignored.length === 1 ? "" : "s"} left out
              </summary>
              <ul className="mt-2 flex flex-col gap-1 font-mono">
                {preview.ignored.map((item) => (
                  <li key={item} className="truncate">
                    {item}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <OptionCards name="skill-type" legend="Type" options={TYPE_OPTIONS} value={type} onChange={setType} />
          <OptionCards name="skill-load" legend="Loading" options={loadOptions} value={load} onChange={setLoad} />
          <p className="text-xs text-muted-foreground">{CLASSIFIED_BY[preview.classifiedBy]}</p>
        </div>

        <AgentCheckboxes value={roles} onChange={setRoles} suggested={preview.roles} legend="Assign to" />

        <FormMessage message={error ?? undefined} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" className="h-10" onClick={reset} disabled={installing}>
            Cancel
          </Button>
          <Button type="button" className="h-10" onClick={() => install(preview)} disabled={installing}>
            {installing && <Spinner />}
            {installing ? "Installing…" : preview.replacing ? "Install new version" : "Install skill"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 rounded-lg bg-muted/40 p-4 ring-1 ring-border/60 sm:flex-row sm:items-center">
        <span className="icon-tile size-9 text-brand-emphasis [&_svg]:size-4">
          <FileUpIcon aria-hidden />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <label htmlFor={inputId} className="text-sm font-semibold">
            {replace ? `Upload a new version of ${replace.name}` : "Upload a skill"}
          </label>
          <p className="text-xs text-muted-foreground">
            A SKILL.md, or a .zip with SKILL.md at its root (or in one folder) and .md reference files. Up to {formatBytes(UPLOAD_MAX_BYTES)}, {UPLOAD_FILES_MAX}{" "}
            files, {formatBytes(UPLOAD_TEXT_MAX_BYTES)} of text. Only .md and .txt are kept; nothing is ever run.
          </p>
        </div>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept=".md,.zip,text/markdown,application/zip"
          className="sr-only"
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            if (chosen) inspect(chosen);
          }}
        />
        <Button type="button" variant="outline" className="h-9 shrink-0" disabled={checking} onClick={() => inputRef.current?.click()}>
          {checking && <Spinner />}
          {checking ? "Checking skill…" : "Choose file"}
        </Button>
      </div>
      {checking && file && (
        <p className="text-xs text-muted-foreground" role="status">
          Reading and scanning {file.name}… Nothing is installed until you confirm.
        </p>
      )}
      {stage.kind === "blocked" && (
        <div className="flex flex-col gap-3 rounded-lg bg-error/6 p-4 ring-1 ring-error/20" role="alert">
          <p className="flex items-center gap-2 text-sm font-semibold text-error">
            <ShieldAlertIcon aria-hidden className="size-4" />
            {stage.error}
          </p>
          <SkillFindings findings={stage.findings} />
          <Button type="button" variant="outline" className="h-9 self-start" onClick={reset}>
            Choose another file
          </Button>
        </div>
      )}
      <FormMessage message={error ?? undefined} />
    </div>
  );
}
