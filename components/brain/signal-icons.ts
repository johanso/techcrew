import {
  BookmarkIcon,
  CircleAlertIcon,
  GitPullRequestClosedIcon,
  LightbulbIcon,
  MessageCircleReplyIcon,
  RotateCcwIcon,
  type LucideIcon,
} from "lucide-react";

import type { SignalKind } from "@/lib/memory-signals";

/** Icon + tone per signal kind, shared by the Brain's Activity and a proposal's evidence. */
export const SIGNAL_ICON: Record<SignalKind, { icon: LucideIcon; tone: string }> = {
  pr_rejected: { icon: GitPullRequestClosedIcon, tone: "text-error" },
  rework: { icon: RotateCcwIcon, tone: "text-warning" },
  answer: { icon: MessageCircleReplyIcon, tone: "text-brand-emphasis" },
  failure: { icon: CircleAlertIcon, tone: "text-error" },
  lesson: { icon: LightbulbIcon, tone: "text-brand-emphasis" },
  remember: { icon: BookmarkIcon, tone: "text-brand-emphasis" },
};
