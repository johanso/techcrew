import type { Metadata } from "next";

import { PageHeader } from "@/components/dashboard/page-header";
import { SkillLibrary } from "@/components/skills/skill-library";
import { SkillUploadButton } from "@/components/skills/skill-upload-button";
import { getSkillLibrary } from "@/lib/agent-skills";
import { ensureDefaultAgents } from "@/lib/agents";
import { getDashboardContext } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Agent skills" };

/** Settings → Agent skills: its own page, so a large library doesn't stretch the settings page. */
export default async function AgentSkillsPage({ params }: PageProps<"/dashboard/[workspaceId]/settings/skills">) {
  const { workspace } = await getDashboardContext((await params).workspaceId);
  // Agents and built-in skills exist before the library lists who uses what.
  await ensureDefaultAgents(workspace.id);
  const skills = await getSkillLibrary(workspace.id);

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Agent skills"
        description="Knowledge your agents search and read while they work. Skills are never run; switch them on per agent here or in AI Team."
        actions={<SkillUploadButton workspaceId={workspace.id} />}
      />
      <section className="surface" aria-label="Skill library">
        <SkillLibrary workspaceId={workspace.id} skills={skills} />
      </section>
    </>
  );
}
