"use client";

import { useState } from "react";

import type { AgentKey } from "@/lib/agent-config";
import { cn } from "@/lib/utils";

/**
 * An agent's face (`/agents/<key>.webp`). Falls back to the tinted initial if the image can't load.
 * `alt` is empty by default: callers show the agent's name next to it or label the wrapper.
 */
export function AgentFace({
  agent,
  toneClass,
  alt = "",
  className,
}: {
  agent: { id: AgentKey; name: string };
  /** Text-color class of the agent's tone, for the fallback initial. */
  toneClass: string;
  alt?: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span
        role={alt ? "img" : undefined}
        aria-label={alt || undefined}
        aria-hidden={alt ? undefined : true}
        className={cn("icon-tile rounded-full font-bold", toneClass, className)}
      >
        {agent.name[0]}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 256 px static webp files; next/image adds nothing here.
    <img
      src={`/agents/${agent.id}.webp`}
      alt={alt}
      width={256}
      height={256}
      draggable={false}
      onError={() => setFailed(true)}
      className={cn("shrink-0 rounded-full bg-muted object-cover ring-1 ring-border", className)}
    />
  );
}
