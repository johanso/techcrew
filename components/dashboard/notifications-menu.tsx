"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import {
  ArrowLeftRightIcon,
  BellIcon,
  BellOffIcon,
  CheckCheckIcon,
  CircleAlertIcon,
  GitMergeIcon,
  GitPullRequestArrowIcon,
  GitPullRequestClosedIcon,
  HourglassIcon,
  MessageCircleQuestionIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";

import { getNotificationsAction, markNotificationsReadAction } from "@/app/dashboard/[workspaceId]/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { NotificationKind, NotificationList, NotificationView } from "@/lib/notifications";
import { cn } from "@/lib/utils";

const POLL_MS = 30_000;

const KIND: Record<NotificationKind, { icon: LucideIcon; tone: string }> = {
  pr_ready: { icon: GitPullRequestArrowIcon, tone: "text-success" },
  merged: { icon: GitMergeIcon, tone: "text-success" },
  merge_blocked: { icon: GitPullRequestClosedIcon, tone: "text-error" },
  needs_info: { icon: MessageCircleQuestionIcon, tone: "text-warning" },
  run_failed: { icon: CircleAlertIcon, tone: "text-error" },
  out_of_credit: { icon: WalletIcon, tone: "text-warning" },
  plan_limit: { icon: HourglassIcon, tone: "text-warning" },
  provider_switched: { icon: ArrowLeftRightIcon, tone: "text-action" },
};

function Item({ item, onOpen }: { item: NotificationView; onOpen: () => void }) {
  const kind = KIND[item.kind] ?? KIND.run_failed;
  const content = (
    <>
      <span className={cn("icon-tile mt-0.5 size-8 rounded-full [&_svg]:size-4", kind.tone)}>
        <kind.icon aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn("line-clamp-2 text-sm", item.read ? "font-medium text-muted-foreground" : "font-semibold text-foreground")}>
          {item.title}
        </span>
        {item.body && <span className="line-clamp-2 text-xs text-muted-foreground">{item.body}</span>}
        <time dateTime={item.at} className="text-[11px] text-muted-foreground">
          {formatDistanceToNowStrict(new Date(item.at), { addSuffix: true })}
        </time>
      </span>
      {!item.read && <span aria-label="Unread" className="mt-2 size-2 shrink-0 rounded-full bg-brand-emphasis" />}
    </>
  );
  const className = "items-start gap-3 rounded-lg px-2 py-2.5";
  return item.href ? (
    <DropdownMenuItem render={<Link href={item.href} />} onClick={onOpen} className={className}>
      {content}
    </DropdownMenuItem>
  ) : (
    <DropdownMenuItem onClick={onOpen} className={className}>
      {content}
    </DropdownMenuItem>
  );
}

/**
 * The header bell: what needs the owner (PR ready, analyst questions, stopped runs, out of credit …). Refreshes every
 * 30 s while the tab is visible and whenever it opens; opening an item marks it read.
 */
export function NotificationsMenu({
  workspaceId,
  initial,
  className,
}: {
  workspaceId: number;
  initial: NotificationList;
  /** Trigger styling (the header's round action button). */
  className: string;
}) {
  const [list, setList] = useState(initial);

  const refresh = () => refreshFor(workspaceId, setList);

  useEffect(() => {
    const tick = () => document.visibilityState === "visible" && void refreshFor(workspaceId, setList);
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [workspaceId]);

  const markRead = (ids?: number[]) => {
    setList((prev) => {
      const read = (item: NotificationView) => !ids || ids.includes(item.id);
      const items = prev.items.map((item) => (read(item) ? { ...item, read: true } : item));
      return { items, unread: items.filter((item) => !item.read).length };
    });
    void markNotificationsReadAction(workspaceId, ids).catch(() => undefined);
  };

  const unread = list.unread;
  return (
    <DropdownMenu onOpenChange={(open) => open && void refresh()}>
      <DropdownMenuTrigger aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} className={cn(className, "relative")}>
        <BellIcon />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] leading-none font-bold text-brand-foreground tabular-nums ring-2 ring-canvas">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-[min(24rem,calc(100vw-2rem))] p-1.5">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center justify-between gap-2 px-2 py-1.5">
            <span className="text-sm font-semibold text-foreground">Notifications</span>
            {unread > 0 && (
              <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs text-muted-foreground" onClick={() => markRead()}>
                <CheckCheckIcon className="size-3.5" />
                Mark all as read
              </Button>
            )}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {list.items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <span className="icon-tile mb-1 rounded-full text-brand-emphasis">
              <BellOffIcon />
            </span>
            <p className="text-sm font-semibold">You&apos;re all caught up</p>
            <p className="text-xs text-muted-foreground">Pull requests ready to merge, questions from the analyst and stopped runs show up here.</p>
          </div>
        ) : (
          <DropdownMenuGroup className="max-h-[min(28rem,70vh)] overflow-y-auto">
            {list.items.map((item) => (
              <Item key={item.id} item={item} onOpen={() => !item.read && markRead([item.id])} />
            ))}
          </DropdownMenuGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Loads the latest list into `set`; failures keep what's shown (the next poll tries again). */
async function refreshFor(workspaceId: number, set: (list: NotificationList) => void) {
  const next = await getNotificationsAction(workspaceId).catch(() => null);
  if (next) set(next);
}
