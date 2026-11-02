"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import {
  ChevronsUpDownIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  SettingsIcon,
  SunIcon,
  SunMoonIcon,
  UserIcon,
} from "lucide-react";

import { signOut } from "@/app/(auth)/actions";
import { dashboardHref } from "@/components/dashboard/nav";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { initials } from "@/lib/utils";

export type MenuUser = { name: string | null; email: string; image: string | null };

const THEMES = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
] as const;

function UserAvatar({ user, className }: { user: MenuUser; className?: string }) {
  return (
    <Avatar className={className}>
      {user.image && <AvatarImage src={user.image} alt="" />}
      <AvatarFallback>{initials(user.name, user.email)}</AvatarFallback>
    </Avatar>
  );
}

function UserIdentity({ user }: { user: MenuUser }) {
  return (
    <span className="grid min-w-0 flex-1 text-left leading-tight">
      <span className="truncate text-sm font-semibold">{user.name || user.email}</span>
      <span className="truncate text-xs text-muted-foreground">{user.email}</span>
    </span>
  );
}

/** Settings options shared by the sidebar footer and the header avatar. */
function UserMenuItems({ user, workspaceId }: { user: MenuUser; workspaceId: number }) {
  const { theme, setTheme } = useTheme();
  const [signingOut, startSignOut] = useTransition();
  const settings = dashboardHref(workspaceId, "settings");

  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuLabel className="flex items-center gap-2 px-1.5 py-1.5 font-normal text-popover-foreground">
          <UserAvatar user={user} />
          <UserIdentity user={user} />
        </DropdownMenuLabel>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem render={<Link href={`${settings}#account`} />}>
          <UserIcon />
          Account settings
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href={`${settings}#workspace`} />}>
          <SettingsIcon />
          Workspace settings
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <SunMoonIcon />
            Theme
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value)}>
              {THEMES.map(({ value, label, icon: Icon }) => (
                <DropdownMenuRadioItem key={value} value={value}>
                  <Icon />
                  {label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        variant="destructive"
        closeOnClick={false}
        disabled={signingOut}
        onClick={() => startSignOut(() => signOut())}
      >
        {signingOut ? <Spinner /> : <LogOutIcon />}
        Sign out
      </DropdownMenuItem>
    </>
  );
}

/** Sidebar footer: avatar + name; opens the settings menu. */
export function SidebarUserMenu({ user, workspaceId }: { user: MenuUser; workspaceId: number }) {
  const { isMobile } = useSidebar();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<SidebarMenuButton size="lg" tooltip={user.name || user.email} className="data-popup-open:bg-sidebar-accent" />}
          >
            <UserAvatar user={user} />
            <UserIdentity user={user} />
            <ChevronsUpDownIcon className="ml-auto" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={isMobile ? "top" : "right"}
            align="end"
            sideOffset={8}
            className="w-(--anchor-width) min-w-60"
          >
            <UserMenuItems user={user} workspaceId={workspaceId} />
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/** Header avatar button; same menu as the sidebar footer. */
export function HeaderUserMenu({ user, workspaceId }: { user: MenuUser; workspaceId: number }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Open account menu"
        className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <UserAvatar user={user} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-60">
        <UserMenuItems user={user} workspaceId={workspaceId} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
