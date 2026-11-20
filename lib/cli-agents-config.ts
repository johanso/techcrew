import { PROVIDERS, type AgentKey, type AgentModelId, type AgentProvider } from "@/lib/agent-config";
import { modelProvider } from "@/lib/model-catalog-config";

/**
 * Agents on the owner's plans through a local CLI (docs/cli-agents-plan.md): pure, client-safe vocabulary and rules.
 *
 * An agent keeps its model; the computer decides the *route* its stages take: the owner's plan through the CLI
 * installed there (Claude Code, signed in to TechTeam's own config home), or the API key as before. Only when
 * TechTeam runs locally (cliAgentsAllowed): a deployed instance never offers, detects or spawns a CLI.
 *
 * Codex joins later as another CliKind ("codex-plan" for OpenAI models) on the same rules.
 */

export const CLI_KINDS = ["claude"] as const;
export type CliKind = (typeof CLI_KINDS)[number];

export function isCliKind(value: unknown): value is CliKind {
  return typeof value === "string" && (CLI_KINDS as readonly string[]).includes(value);
}

/** How a stage reaches its model: the API key (as always), or the owner's plan through a CLI. */
export const AGENT_ROUTES = ["api", "claude-plan"] as const;
export type AgentRoute = (typeof AGENT_ROUTES)[number];

export function isAgentRoute(value: unknown): value is AgentRoute {
  return typeof value === "string" && (AGENT_ROUTES as readonly string[]).includes(value);
}

/** What spend a stage's usage is: real API money, or the owner's plan (an API-equivalent cost kept for reference only). */
export type Billing = "api" | "plan";

export const CLI_META: Record<CliKind, { label: string; route: AgentRoute; provider: AgentProvider; plan: string; switchLabel: string; binary: string }> = {
  claude: {
    label: "Claude Code",
    route: "claude-plan",
    provider: "anthropic",
    plan: "Claude plan",
    switchLabel: "Use my Claude plan for Claude models",
    binary: "claude",
  },
};

export const ROUTE_LABEL: Record<AgentRoute, string> = { api: "API key", "claude-plan": "Your Claude plan" };

/** Each agent's route on this computer (AI Team); null: no plan and no key for its model. */
export type AgentRoutes = Partial<Record<AgentKey, AgentRoute | null>>;

export const cliOfRoute = (route: AgentRoute): CliKind | null => (route === "claude-plan" ? "claude" : null);

/** The CLI that can carry a model on its company's plan, or null (OpenRouter models, and OpenAI until Codex). */
export function cliForModel(model: AgentModelId): CliKind | null {
  const provider = modelProvider(model);
  return CLI_KINDS.find((kind) => CLI_META[kind].provider === provider) ?? null;
}

/** Claude Code's install command, shown when it's missing, per OS (native installers: no npm shim to quote on Windows). */
export function claudeInstallCommand(platform: string) {
  return platform === "win32" ? "irm https://claude.ai/install.ps1 | iex" : "curl -fsSL https://claude.ai/install.sh | bash";
}

// ── Where CLIs may run ─────────────────────────────────────────────────────────

const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|.+\.local|.+\.internal)$/i;
// Environment markers of hosted platforms: none of them is ever the owner's own computer.
const HOSTED_MARKERS = ["VERCEL", "NETLIFY", "RENDER", "FLY_APP_NAME", "RAILWAY_ENVIRONMENT", "K_SERVICE", "AWS_LAMBDA_FUNCTION_NAME"];

export type CliEnvironment = Record<string, string | undefined>;

/** Whether `raw` is an address on this computer (localhost, 127.x, *.local). */
export function isLocalAppUrl(raw: string | undefined) {
  if (!raw) return false;
  try {
    return LOCAL_HOST.test(new URL(raw).hostname);
  } catch {
    return false;
  }
}

/**
 * CLI agents are possible here: no hosted-platform marker, the app's own URL is local, and the kill switch
 * (AGENTS_LOCAL_CLI=false) is not set. No variable turns them on: a local checkout just has them.
 */
export function cliAgentsAllowed(env: CliEnvironment) {
  if (env.AGENTS_LOCAL_CLI?.trim().toLowerCase() === "false") return false;
  if (HOSTED_MARKERS.some((marker) => env[marker])) return false;
  return isLocalAppUrl(env.NEXT_PUBLIC_APP_URL);
}

// ── The CLI's sign-in ──────────────────────────────────────────────────────────

/** `claude auth status --json`, the fields TechTeam reads. */
export type CliAuth = {
  loggedIn: boolean;
  authMethod: string | null;
  email: string | null;
  orgName: string | null;
  subscriptionType: string | null;
  loginExpiresAt: string | null;
};

const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

/** Parses the CLI's auth status (JSON on stdout). Anything unreadable counts as signed out. */
export function parseCliAuth(stdout: string): CliAuth {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    raw = null;
  }
  const data = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const expires = data.loginExpiresAt;
  return {
    loggedIn: data.loggedIn === true,
    authMethod: str(data.authMethod),
    email: str(data.email),
    orgName: str(data.orgName),
    subscriptionType: str(data.subscriptionType)?.toLowerCase() ?? null,
    loginExpiresAt: typeof expires === "number" ? new Date(expires).toISOString() : str(expires),
  };
}

/** A plan login (claude.ai), not an API key or a cloud provider: only those carry a subscription's usage. */
export const isPlanLogin = (auth: CliAuth) => auth.loggedIn && Boolean(auth.subscriptionType) && auth.authMethod !== "api_key";

/** The account the owner confirmed in Settings for this computer. */
export type ConfirmedAccount = { email: string; orgName: string | null };

/** The CLI is signed in to exactly the account the owner confirmed (same email, same organization or none). */
export function accountMatches(auth: CliAuth, confirmed: ConfirmedAccount | null) {
  if (!confirmed || !auth.loggedIn || !auth.email) return false;
  return auth.email.toLowerCase() === confirmed.email.toLowerCase() && (auth.orgName ?? null) === (confirmed.orgName ?? null);
}

/** "jane@example.com · Personal · Max". */
export function describeAccount(auth: Pick<CliAuth, "email" | "orgName" | "subscriptionType">) {
  const plan = auth.subscriptionType ? auth.subscriptionType.charAt(0).toUpperCase() + auth.subscriptionType.slice(1) : null;
  return [auth.email, auth.orgName, plan].filter(Boolean).join(" · ");
}

/**
 * Whether the plan may carry the model in its CLI: any plan login, any model. Which models a plan includes changes
 * over time (Pro runs Opus in Claude Code today), so TechTeam doesn't guess: a model the CLI refuses is remembered on
 * this computer (`unusable` in resolveRoute) and routed to the API key, or the stage stops with the reason.
 */
export function planIncludesModel(subscriptionType: string | null, _model: AgentModelId) {
  return Boolean(subscriptionType);
}

// ── Route resolution ───────────────────────────────────────────────────────────

/** What this computer knows about one CLI when a stage starts. */
export type CliMachineState = {
  /** CLI agents allowed here and the binary found. */
  installed: boolean;
  /** The owner's switch on this computer (Settings → AI → Plans on this computer). */
  enabled: boolean;
  auth: CliAuth | null;
  confirmed: ConfirmedAccount | null;
  /** Models the CLI refused on this plan, remembered on this computer. */
  unusable: readonly string[];
  /** The plan's usage window ran out until then (ISO), remembered on this computer; null when it hasn't. */
  limitedUntil: string | null;
};

export type RouteResolution =
  | { route: AgentRoute; billing: Billing; note: string | null }
  | { route: null; problem: string };

/**
 * The route a stage takes on this computer. A model on a company with a CLI goes through the plan when the CLI is
 * installed, switched on, signed in to the confirmed account, the plan includes the model and its window hasn't run
 * out; otherwise through the API key. With neither, a problem for the owner (Run refuses before it starts).
 * `note` says why a switched-on plan wasn't used, for the agent log.
 */
export function resolveRoute(input: {
  model: AgentModelId;
  /** The model's name for messages (the catalog's label); the id when absent. */
  label?: string;
  hasKey: boolean;
  cli: CliMachineState | null;
  now?: Date;
  /** The stage already moved to the API key (the plan ran out mid-stage, "Continue on the API key"). */
  forceApi?: boolean;
}): RouteResolution {
  const { model, hasKey, cli } = input;
  const label = input.label ?? model;
  const provider = modelProvider(model);
  if (!provider) return { route: null, problem: `${model} isn't a model TechTeam can run. Pick another one on the AI Team page.` };
  const kind = cliForModel(model);
  const api: RouteResolution | null = hasKey ? { route: "api", billing: "api", note: null } : null;
  const noKey = `${label} needs an ${PROVIDERS[provider].label} API key. Add one in Settings → AI providers.`;
  if (!kind || !cli || !cli.installed || !cli.enabled || input.forceApi) return api ?? { route: null, problem: noKey };

  const plan = CLI_META[kind].plan;
  const unusable = planUnusableReason(model, label, cli, input.now ?? new Date());
  if (!unusable) return { route: CLI_META[kind].route, billing: "plan", note: null };
  if (api) return { ...api, note: `${unusable} Used the API key.` };
  return { route: null, problem: `${unusable} Fix it in Settings → AI → Plans on this computer, or add an ${PROVIDERS[provider].label} key. (${label}, ${plan})` };
}

/** Why a switched-on plan can't carry this model right now, or null when it can. */
function planUnusableReason(model: AgentModelId, label: string, cli: CliMachineState, now: Date): string | null {
  const auth = cli.auth;
  if (!auth?.loggedIn) return "Claude Code isn't signed in for TechTeam.";
  if (!isPlanLogin(auth)) return "Claude Code is signed in without a Claude plan.";
  if (!accountMatches(auth, cli.confirmed)) return `Claude Code is signed in as ${describeAccount(auth)}, not the account you confirmed.`;
  if (!planIncludesModel(auth.subscriptionType, model) || cli.unusable.includes(model)) return `Your Claude plan doesn't include ${label}.`;
  if (cli.limitedUntil && new Date(cli.limitedUntil) > now) return `Your Claude plan is out of usage until ${cli.limitedUntil}.`;
  return null;
}

// ── When the plan runs out ─────────────────────────────────────────────────────

/** Settings → AI, per plan: "When my plan runs out". */
export const PLAN_LIMIT_POLICIES = ["wait", "api", "failover"] as const;
export type PlanLimitPolicy = (typeof PLAN_LIMIT_POLICIES)[number];

export function isPlanLimitPolicy(value: unknown): value is PlanLimitPolicy {
  return typeof value === "string" && (PLAN_LIMIT_POLICIES as readonly string[]).includes(value);
}

export const PLAN_LIMIT_POLICY_META: Record<PlanLimitPolicy, { label: string; description: string }> = {
  wait: { label: "Wait for the reset", description: "The run pauses and the same session picks up where it stopped when your plan resets." },
  api: { label: "Continue on the API key", description: "The stage starts over on the same model through your API key, which costs money." },
  failover: { label: "Switch company", description: "Like running out of credit: the agents on this company move to another one with a key." },
};

/** The default when the owner never chose: continue on the key when there is one, else wait. */
export const defaultPlanLimitPolicy = (hasKey: boolean): PlanLimitPolicy => (hasKey ? "api" : "wait");

export type PlanLimitAction = { kind: "wait"; until: string } | { kind: "api" } | { kind: "failover" } | { kind: "stop"; reason: string };

// The CLI usually says when the window resets; when it doesn't, check again after this long.
export const PLAN_RETRY_MINUTES = 30;
// Wake a little after the reset, so the first request isn't refused again on a clock skew.
const RESET_MARGIN_MS = 60_000;
// A weekly limit can reset days away: past this, stop instead of holding the card.
const MAX_WAIT_MS = 24 * 60 * 60 * 1000;

/**
 * What a stage does when the plan's usage window runs out mid-stage. "api" needs a key for the company; "failover"
 * needs auto failover's other company (`other`); "wait" needs a reset within a day. Otherwise the next possible
 * action, and in the end a stop the board explains.
 */
export function planLimitAction(input: {
  policy: PlanLimitPolicy;
  hasKey: boolean;
  other: AgentProvider | null;
  resetsAt: string | null;
  now: Date;
}): PlanLimitAction {
  const { policy, hasKey, other, now } = input;
  const reset = input.resetsAt ? new Date(input.resetsAt) : null;
  const until = new Date((reset && reset > now ? reset.getTime() : now.getTime() + PLAN_RETRY_MINUTES * 60_000) + RESET_MARGIN_MS);
  const canWait = until.getTime() - now.getTime() <= MAX_WAIT_MS;
  if (policy === "api" && hasKey) return { kind: "api" };
  if (policy === "failover" && other) return { kind: "failover" };
  if (canWait) return { kind: "wait", until: until.toISOString() };
  if (hasKey) return { kind: "api" };
  return { kind: "stop", reason: `Your Claude plan is out of usage${reset ? ` until ${reset.toISOString()}` : ""}, more than a day away.` };
}

/** A run waiting on something outside it (agent_runs.waiting), shown on the card while it holds. */
export type RunWaiting = { kind: "plan_limit"; cli: CliKind; until: string };

export function parseRunWaiting(value: unknown): RunWaiting | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.kind !== "plan_limit" || !isCliKind(v.cli) || typeof v.until !== "string") return null;
  return { kind: "plan_limit", cli: v.cli, until: v.until };
}

/** Settings → AI → Plans on this computer: Claude Code as the page shows it (plain data for the client). */
export type ClaudePlanView = {
  installed: boolean;
  version: string | null;
  /** Why it can't run stages although it's there (an npm shim on Windows, a broken install), or null. */
  problem: string | null;
  installCommand: string;
  /** The sign-in under TechTeam's config home; null when it couldn't be read. */
  auth: { loggedIn: boolean; isPlan: boolean; account: string; email: string | null; orgName: string | null; expiresAt: string | null } | null;
  confirmed: ConfirmedAccount | null;
  /** The CLI is signed in to the account the owner confirmed. */
  accountConfirmed: boolean;
  enabled: boolean;
  onLimit: PlanLimitPolicy;
  hasKey: boolean;
  /** This workspace's agents on Claude models: the ones the plan carries. */
  agents: string[];
  limitedUntil: string | null;
  checkedAt: string;
};

/** "180K", "1.2M": tokens at a glance. */
export function formatTokens(tokens: number) {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens >= 10_000_000 ? 0 : 1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(Math.max(0, Math.round(tokens)));
}

/** A plan stage's usage for the agent log: "Your Claude plan · 12 turns · 180K tokens (≈ $0.40 at API prices)". */
export function planUsageSummary(usage: { turns: number; tokens: number; equivalentMicros: number }, cli: CliKind = "claude") {
  const turns = `${usage.turns} turn${usage.turns === 1 ? "" : "s"}`;
  const equivalent = usage.equivalentMicros > 0 ? ` (≈ $${(usage.equivalentMicros / 1_000_000).toFixed(2)} at API prices)` : "";
  return `Your ${CLI_META[cli].plan} · ${turns} · ${formatTokens(usage.tokens)} tokens${equivalent}`;
}
