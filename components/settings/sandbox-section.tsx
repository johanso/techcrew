import { Suspense } from "react";
import { ServerOffIcon } from "lucide-react";

import { SandboxFormSkeleton, SandboxSettings } from "@/components/settings/sandbox-form";
import type { Workspace } from "@/db";
import { allowInstallScriptsOf } from "@/lib/sandbox/config";
import { detectRepoCommands, getSandboxStatus } from "@/lib/sandbox";
import { unavailableMessage, type SandboxStatus } from "@/lib/sandbox/mode";
import { previewsAvailable } from "@/lib/sandbox/preview";

/** One line when the sandbox can't run on this computer: what's wrong and the fix. Backticked words show as code. */
export function SandboxUnavailable({ status }: { status: Extract<SandboxStatus, { state: "unavailable" }> }) {
  const { problem, fix } = unavailableMessage(status);
  return (
    <p className="flex items-start gap-2 px-6 py-4 text-sm text-muted-foreground">
      <ServerOffIcon className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0">
        <span className="font-medium text-foreground">{problem}</span>{" "}
        {fix.split("`").map((part, index) =>
          index % 2 ? (
            <code key={index} className="font-mono">
              {part}
            </code>
          ) : (
            part
          )
        )}{" "}
        Agents check their changes with your repository&apos;s CI meanwhile.
      </span>
    </p>
  );
}

/**
 * The Sandbox card's body. It waits for the sandbox status (a `docker info` call, cached, 5 s at most), so the page
 * streams it inside a Suspense boundary: the rest of Settings never waits for Docker.
 */
export async function SandboxSection({ workspace }: { workspace: Workspace }) {
  const status = await getSandboxStatus();
  if (status.state !== "ready") return <SandboxUnavailable status={status} />;
  // Reads package.json on GitHub: streamed in so the form's frame doesn't wait for it. Null when it can't be read.
  const detected = detectRepoCommands(workspace).catch(() => null);
  return (
    <Suspense fallback={<SandboxFormSkeleton />}>
      <SandboxSettings
        workspaceId={workspace.id}
        enabled={workspace.sandboxEnabled}
        saved={workspace.sandboxCommands}
        mode={status.mode}
        previewsAvailable={await previewsAvailable()}
        previewEnabled={workspace.sandboxPreview}
        allowScripts={allowInstallScriptsOf(workspace.sandboxCommands)}
        detected={detected}
      />
    </Suspense>
  );
}
