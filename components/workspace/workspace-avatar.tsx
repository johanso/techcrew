import { cva, type VariantProps } from "class-variance-authority";

import { DEFAULT_WORKSPACE_ICON, WORKSPACE_ICONS, isWorkspaceIcon } from "@/lib/workspace-icons";
import { cn } from "@/lib/utils";

const avatarVariants = cva(
  "flex shrink-0 items-center justify-center overflow-hidden bg-brand text-brand-foreground [&_img]:size-full [&_img]:object-cover",
  {
    variants: {
      size: {
        sm: "size-8 rounded-lg [&_svg]:size-4",
        md: "size-10 rounded-lg [&_svg]:size-5",
        lg: "size-16 rounded-xl [&_svg]:size-8",
      },
    },
    defaultVariants: { size: "md" },
  }
);

/** A workspace's logo, or its icon on the brand color when no logo was uploaded. */
export function WorkspaceAvatar({
  icon,
  logoSrc,
  size,
  className,
}: { icon: string; logoSrc?: string | null; className?: string } & VariantProps<typeof avatarVariants>) {
  const Icon = WORKSPACE_ICONS[isWorkspaceIcon(icon) ? icon : DEFAULT_WORKSPACE_ICON];
  return (
    <span aria-hidden className={cn(avatarVariants({ size }), logoSrc && "bg-background", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- auth-gated route / blob URL; next/image can't optimize either */}
      {logoSrc ? <img src={logoSrc} alt="" /> : <Icon />}
    </span>
  );
}

export function workspaceLogoSrc(workspace: { id: number; logoKey: string | null }) {
  return workspace.logoKey ? `/api/workspaces/${workspace.id}/logo` : null;
}
