import { LogOutIcon } from "lucide-react";

import { signOut } from "@/app/(auth)/actions";
import { Brand } from "@/components/brand";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type { User } from "@/db";
import { initials } from "@/lib/utils";

/** Top bar for signed-in pages. `children` renders next to the brand (e.g. a workspace switcher). */
export function AppHeader({ user, children }: { user: User; children?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b border-border/70 bg-canvas/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-6">
        <div className="flex min-w-0 items-center gap-4">
          <Brand />
          {children}
        </div>
        <div className="flex items-center gap-3">
          <Avatar>
            {user.image && <AvatarImage src={user.image} alt="" />}
            <AvatarFallback>{initials(user.name, user.email)}</AvatarFallback>
          </Avatar>
          <form action={signOut}>
            <Button type="submit" variant="outline" className="h-9">
              <LogOutIcon />
              Sign out
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
