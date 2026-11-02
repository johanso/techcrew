import type { Metadata } from "next";
import { ActivityIcon } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { SectionEmpty } from "@/components/dashboard/section-empty";

export const metadata: Metadata = { title: "Activity" };

export default function ActivityPage() {
  return (
    <>
      <PageHeader title="Activity" description="A timeline of everything that happens in this workspace." />
      <SectionEmpty
        icon={ActivityIcon}
        title="No activity yet"
        description="Agent runs, commits and reviews will be logged here as your team starts working."
      />
    </>
  );
}
