import "server-only";

import { AGENT_ROLES, isAgentKey, modelInfo } from "@/lib/agent-config";
import { getAIKeys } from "@/lib/ai-keys";
import { activeAgentModel, getAgentTeamRows } from "@/lib/agents";
import { accountMatches, claudeInstallCommand, defaultPlanLimitPolicy, describeAccount, isPlanLogin, type ClaudePlanView } from "@/lib/cli-agents-config";
import { claudeMachineState, cliAgentsAvailable, detectClaude } from "@/lib/cli";

/**
 * Claude Code on this computer for Settings → AI, or null when CLI agents aren't possible here (a deploy, or switched
 * off with AGENTS_LOCAL_CLI=false): then nothing about CLIs shows.
 */
export async function getClaudePlanView(userId: number, workspaceId: number, { fresh = false } = {}): Promise<ClaudePlanView | null> {
  if (!cliAgentsAvailable()) return null;
  const detection = await detectClaude({ fresh });
  const [machine, keys, rows] = await Promise.all([claudeMachineState(userId), getAIKeys(workspaceId), getAgentTeamRows(workspaceId)]);
  if (!machine) return null;
  const auth = detection.auth;
  return {
    installed: Boolean(detection.binary),
    version: detection.version,
    problem: detection.problem,
    installCommand: claudeInstallCommand(process.platform),
    auth: auth
      ? { loggedIn: auth.loggedIn, isPlan: isPlanLogin(auth), account: describeAccount(auth), email: auth.email, orgName: auth.orgName, expiresAt: auth.loginExpiresAt }
      : null,
    confirmed: machine.confirmed,
    accountConfirmed: auth ? accountMatches(auth, machine.confirmed) : false,
    enabled: machine.enabled,
    onLimit: machine.onLimit ?? defaultPlanLimitPolicy(Boolean(keys.anthropic)),
    hasKey: Boolean(keys.anthropic),
    agents: rows.filter((row) => modelInfo(activeAgentModel(row)).provider === "anthropic").map((row) => (isAgentKey(row.key) ? AGENT_ROLES[row.key].name : row.key)),
    limitedUntil: machine.limitedUntil && new Date(machine.limitedUntil) > new Date() ? machine.limitedUntil : null,
    checkedAt: detection.checkedAt,
  };
}
