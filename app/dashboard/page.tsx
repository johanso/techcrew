import { redirect } from "next/navigation";

import { requireUser } from "@/lib/current-user";
import { listWorkspaces } from "@/lib/workspaces";

/** /dashboard has no content of its own: open the newest workspace, or create the first one. */
export default async function DashboardIndexPage() {
  const user = await requireUser("/dashboard");
  const [newest] = await listWorkspaces(user.id);
  redirect(newest ? `/dashboard/${newest.id}` : "/workspaces/new");
}
