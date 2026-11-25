import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { adoptExistingData, createSeparateAccount } from "@/app/(auth)/actions";
import { AuthHeader, FormMessage } from "@/components/auth/form-parts";
import { Button, buttonVariants } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/current-user";
import { getUserById } from "@/lib/local-user";
import { readPendingAdoption } from "@/lib/sign-in";
import { differentAccountMessage, sessionSignIn } from "@/lib/user-identity";

export const metadata: Metadata = { title: "Adopt existing data" };

/** Asked once: the database already holds one user, so the first GitHub sign-in decides who gets that data. */
export default async function AdoptPage() {
  const pending = await readPendingAdoption();
  const existing = pending ? await getUserById(pending.userId) : null;
  if (!pending || !existing) redirect("/sign-in");

  // Signed in as another account since the question was asked: neither answer is allowed (lib/sign-in.ts).
  if (sessionSignIn(pending.identity, await getCurrentUser()).kind === "different-account") {
    return (
      <div className="flex flex-col gap-4">
        <AuthHeader title="Already signed in" description="Nothing was changed." />
        <FormMessage message={differentAccountMessage(pending.identity.login)} />
        <Link href={pending.next} className={buttonVariants({ variant: "outline", className: "h-10" })}>
          Cancel
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <AuthHeader
        title="Use your existing data?"
        description={`This database already has data from ${existing.email}. Adopt it with @${pending.identity.login}, or start a separate account.`}
      />
      <div className="flex flex-col gap-3">
        <form action={adoptExistingData}>
          <Button type="submit" className="h-10 w-full">
            Adopt it with @{pending.identity.login}
          </Button>
        </form>
        <form action={createSeparateAccount}>
          <Button type="submit" variant="outline" className="h-10 w-full">
            Create a separate account
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">
          Adopting keeps every workspace, board and agent exactly as they are. A separate account starts empty; the existing data stays
          where it is and isn&apos;t shown to you.
        </p>
      </div>
    </div>
  );
}
