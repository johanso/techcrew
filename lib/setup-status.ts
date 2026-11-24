/**
 * The "Get started" checklist: what is left to do before agents can work. Pure and client-safe; lib/setup.ts gathers
 * the facts on the server (never a key, only whether one can be used).
 */

/** How an agent model can run on this computer, if it can. */
export type AiRoute = "key" | "plan" | "simulated";

export type SetupFacts = {
  /** The workspace the page belongs to, else the user's newest one, else null. */
  workspaceId: number | null;
  /** The user owns at least one workspace. */
  ownsWorkspace: boolean;
  /** The first way an agent model can run here, or null when none can. */
  aiRoute: AiRoute | null;
};

export type SetupStepId = "sign-in" | "ai-route" | "workspace";

export type SetupStep = {
  id: SetupStepId;
  title: string;
  description: string;
  done: boolean;
  /** Where to do it; null when there is nowhere yet. Done steps have none. */
  href: string | null;
};

const AI_DONE: Record<AiRoute, string> = {
  key: "An API key is set.",
  plan: "Your Claude plan runs agents on this computer.",
  simulated: "Agents are simulated on this computer, so no model is needed.",
};

/** The steps in order, each done or to do. Sign-in is always done: nobody sees this signed out. */
export function setupSteps(facts: SetupFacts): SetupStep[] {
  const { aiRoute, ownsWorkspace, workspaceId } = facts;
  const aiHref = workspaceId !== null ? `/dashboard/${workspaceId}/settings#ai` : null;
  return [
    { id: "sign-in", title: "Signed in with GitHub", description: "Your GitHub account is how TechTeam knows it is you.", done: true, href: null },
    {
      id: "ai-route",
      title: "Add an AI route",
      description: aiRoute
        ? AI_DONE[aiRoute]
        : aiHref
          ? "Add an API key, or switch on Claude Code to use your Claude plan, in Settings → AI."
          : "You set this up in Settings → AI once you have created your workspace.",
      done: aiRoute !== null,
      href: aiRoute ? null : aiHref,
    },
    {
      id: "workspace",
      title: "Create your first workspace",
      description: ownsWorkspace ? "A workspace links your agents to one GitHub repository." : "Pick a name and the GitHub repository your agents will work on.",
      done: ownsWorkspace,
      href: ownsWorkspace ? null : "/workspaces/new",
    },
  ];
}

/** Whether anything is left to do (the checklist shows only then). */
export function setupPending(steps: SetupStep[]) {
  return steps.some((step) => !step.done);
}
