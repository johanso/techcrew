import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/current-user";

/** No public landing page yet: `/` sends signed-in users to their dashboard and everyone else to sign in. */
export default async function Home() {
  const user = await getCurrentUser();
  redirect(user ? "/dashboard" : "/sign-in");
}
