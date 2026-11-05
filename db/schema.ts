import { sql } from "drizzle-orm";
import { bigint, boolean, date, index, integer, jsonb, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";

import type { AgentModelId, AgentProvider } from "@/lib/agent-config";
import type { AnalystBrief, ReviewReport, RunFailure, TestReport } from "@/lib/agent-run-config";
import type { TrustReport } from "@/lib/agent-trust";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  // User id issued by the hosted auth service (Better Auth `user.id`).
  authUserId: text("auth_user_id").notNull().unique(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  lastSignInAt: timestamp("last_sign_in_at").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

/**
 * A user's linked GitHub account (OAuth App, `repo` scope). One per user.
 * Independent from social sign-in: the hosted auth service does not expose provider tokens.
 */
export const githubConnections = pgTable("github_connections", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  githubUserId: bigint("github_user_id", { mode: "number" }).notNull(),
  login: text("login").notNull(),
  avatarUrl: text("avatar_url"),
  // AES-256-GCM ciphertext (lib/crypto.ts). Never select this into client-facing data.
  accessToken: text("access_token").notNull(),
  scope: text("scope"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type GithubConnection = typeof githubConnections.$inferSelect;

/** A workspace is bound to exactly one GitHub repository that AI agents work on. */
export const workspaces = pgTable(
  "workspaces",
  {
    id: serial("id").primaryKey(),
    ownerId: integer("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Key from lib/workspace-icons.ts; used when no logo is uploaded.
    icon: text("icon").notNull(),
    // S3 object key of an uploaded logo (served by /api/workspaces/[id]/logo).
    logoKey: text("logo_key"),
    githubRepoId: bigint("github_repo_id", { mode: "number" }).notNull(),
    githubRepoFullName: text("github_repo_full_name").notNull(),
    githubRepoUrl: text("github_repo_url").notNull(),
    githubDefaultBranch: text("github_default_branch").notNull(),
    githubRepoPrivate: boolean("github_repo_private").notNull(),
    // Last successful issue sync (lib/github-issues.ts). Used as GitHub's `since` for incremental syncs.
    githubIssuesSyncedAt: timestamp("github_issues_synced_at"),
    // Agent automation (Settings → Agents). Pickup: the analyst takes the next Todo card on its own instead of
    // waiting for Run. Merge: agent pull requests merge once review and tests pass instead of waiting for the user.
    agentAutoPickup: boolean("agent_auto_pickup").default(false).notNull(),
    agentAutoMerge: boolean("agent_auto_merge").default(false).notNull(),
    // Settings → AI providers: the provider the team works on ("openai" | "anthropic"). Also used by AI drafting/scans.
    aiProvider: text("ai_provider").default("openai").notNull(),
    // When the provider runs out of credit mid-run and the other one has a key, switch the team to it and restart
    // the stage instead of stopping (Settings → AI providers). Off by default: switching changes every agent's model.
    aiAutoFailover: boolean("ai_auto_failover").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("workspaces_owner_id_idx").on(table.ownerId)]
);

export type Workspace = typeof workspaces.$inferSelect;

/**
 * A workspace's API key for an AI provider (Settings → AI providers). One per provider; without one, the server's
 * environment key is used. Kept out of `workspaces` so a workspace row passed around can never carry a secret.
 */
export const aiProviderKeys = pgTable(
  "ai_provider_keys",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    // AES-256-GCM ciphertext (lib/crypto.ts). Never select this into client-facing data.
    apiKey: text("api_key").notNull(),
    // Masked form for display, e.g. "sk-ant-••••a1B2".
    hint: text("hint").notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [unique("ai_provider_keys_workspace_provider").on(table.workspaceId, table.provider)]
);
export type NewWorkspace = typeof workspaces.$inferInsert;

/**
 * A card on a workspace's Kanban board (feature, bug or issue).
 * `type`, `priority` and `status` hold values from lib/board-config.ts and are validated in the server actions.
 */
export const tasks = pgTable(
  "tasks",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // Per-workspace sequence shown as the key, e.g. ACM-142.
    number: integer("number").notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    priority: text("priority").notNull(),
    // Board column id ("todo", "in_development", …).
    status: text("status").notNull(),
    // Sort key within the column (ascending). Not contiguous: new cards take min - 1 to land on top.
    position: integer("position").notNull(),
    labels: text("labels").array().notNull().default(sql`'{}'::text[]`),
    dueDate: date("due_date", { mode: "string" }),
    createdById: integer("created_by_id").references(() => users.id, { onDelete: "set null" }),
    // Set when the card mirrors a GitHub issue of the workspace's repo (null for cards created in the app).
    // GitHub owns title, description, labels and open/closed state; the board owns column, type, priority, due date.
    githubIssueId: bigint("github_issue_id", { mode: "number" }),
    githubIssueNumber: integer("github_issue_number"),
    githubIssueUrl: text("github_issue_url"),
    githubIssueState: text("github_issue_state"),
    githubUpdatedAt: timestamp("github_updated_at"),
    // Agent id from lib/agents.ts the card is assigned to (set by Run), or null.
    assigneeAgentId: text("assignee_agent_id"),
    // Removed from the board. The row stays so keys aren't reused and a sync doesn't import the issue again.
    removedAt: timestamp("removed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("tasks_workspace_number_unique").on(table.workspaceId, table.number),
    // One card per issue; concurrent syncs can't duplicate (NULLs — app cards — don't conflict).
    unique("tasks_workspace_github_issue_unique").on(table.workspaceId, table.githubIssueId),
    index("tasks_workspace_status_position_idx").on(table.workspaceId, table.status, table.position),
  ]
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;

/**
 * An AI agent of a workspace. Every workspace gets the four roles from lib/agent-config.ts (`key`), created on
 * first use by ensureDefaultAgents(); the user configures them on the AI Team page.
 */
export const agents = pgTable(
  "agents",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // Role key ("analyst", "developer", "reviewer", "tester"); also what tasks.assignee_agent_id stores.
    key: text("key").notNull(),
    description: text("description").notNull(),
    instructions: text("instructions").notNull(),
    // Active model id from AGENT_MODELS, always on the workspace's provider (workspaces.ai_provider).
    model: text("model").notNull(),
    // The model this agent uses on each provider, so switching provider and back restores the user's choice.
    providerModels: jsonb("provider_models").$type<Partial<Record<AgentProvider, AgentModelId>>>().notNull().default({}),
    // Skill ids from SKILLS.
    skills: text("skills").array().notNull().default(sql`'{}'::text[]`),
    monthlyBudgetCents: integer("monthly_budget_cents").notNull(),
    // Model turns allowed per stage before the agent must submit its result. Null = the role's default.
    maxTurns: integer("max_turns"),
    // Paused agents don't pick up work (Run refuses).
    enabled: boolean("enabled").default(true).notNull(),
    // Latest Skill Trust Score scan (lib/agent-trust.ts). Score is duplicated out of the report for queries.
    trustScore: integer("trust_score"),
    trustReport: jsonb("trust_report").$type<TrustReport>(),
    trustScannedAt: timestamp("trust_scanned_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [unique("agents_workspace_key_unique").on(table.workspaceId, table.key)]
);

export type AgentRow = typeof agents.$inferSelect;
export type NewAgentRow = typeof agents.$inferInsert;

/**
 * What an agent did, newest first in the activity drawer. Rows with `cost_micros` > 0 are also the spend ledger:
 * monthly spending is the sum for the calendar month (UTC).
 */
export const agentActivity = pgTable(
  "agent_activity",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    agentId: integer("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    // Value from AGENT_ACTIVITY_KINDS in lib/agents.ts.
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    detail: text("detail"),
    // Model spend in micro-dollars (1e-6 USD).
    costMicros: integer("cost_micros").notNull().default(0),
    taskId: integer("task_id").references(() => tasks.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("agent_activity_agent_created_idx").on(table.agentId, table.createdAt),
    index("agent_activity_workspace_created_idx").on(table.workspaceId, table.createdAt),
  ]
);

export type AgentActivityRow = typeof agentActivity.$inferSelect;

/**
 * One pass of a board card through the agent pipeline: analysis → development → review → testing → merge.
 * A card can be run more than once; the board shows its latest run. Values come from lib/agent-run-config.ts.
 */
export const agentRuns = pgTable(
  "agent_runs",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    taskId: integer("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    // "manual" (Run on the card) or "auto" (picked up by the analyst).
    trigger: text("trigger").notNull(),
    status: text("status").notNull(),
    // Current (or last) pipeline stage; null while queued.
    stage: text("stage"),
    // Working branch in the workspace repository, created by the developer stage.
    branch: text("branch"),
    brief: jsonb("brief").$type<AnalystBrief>(),
    review: jsonb("review").$type<ReviewReport>(),
    testReport: jsonb("test_report").$type<TestReport>(),
    // Development rounds after the first one (review or tests sent the work back).
    reworkRounds: integer("rework_rounds").notNull().default(0),
    // Why the run stopped (failed / needs info / merge blocked), in words for the user.
    error: text("error"),
    // The same, as data, for stops the UI can act on (e.g. out of credit → switch provider and retry).
    failure: jsonb("failure").$type<RunFailure>(),
    // The owner's answer to the analyst's question (needs info); later runs of the card get it in their task.
    answer: text("answer"),
    // Model spend of the whole run in micro-dollars (per-agent spend is in agent_activity).
    costMicros: integer("cost_micros").notNull().default(0),
    createdById: integer("created_by_id").references(() => users.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
  },
  (table) => [
    index("agent_runs_task_started_idx").on(table.taskId, table.startedAt),
    index("agent_runs_workspace_status_idx").on(table.workspaceId, table.status),
  ]
);

export type AgentRunRow = typeof agentRuns.$inferSelect;

/**
 * Conversation history of an agent stage on a stateless provider (Anthropic Messages API): one row per message,
 * in order. OpenAI keeps its conversation server-side and stores nothing here. Kept out of Inngest step output,
 * which would otherwise carry the whole growing history on every turn.
 */
export const agentRunMessages = pgTable(
  "agent_run_messages",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    // One conversation per stage and round, e.g. "development:1".
    conversation: text("conversation").notNull(),
    seq: integer("seq").notNull(),
    // The provider's message param, stored verbatim (thinking blocks must be sent back unchanged).
    message: jsonb("message").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [unique("agent_run_messages_conversation_seq").on(table.runId, table.conversation, table.seq)]
);

/**
 * What an agent did in a run, for the card's agent log: one row per tool call (read_file, write_file …), plus one
 * `result` row when a stage ends (its outcome, turns and cost) or a `stopped` row. Written at fixed positions
 * (stage, round, turn, seq), so a retried Inngest step rewrites its own rows instead of duplicating them.
 */
export const agentRunSteps = pgTable(
  "agent_run_steps",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    stage: text("stage").notNull(),
    // Rework round (0 = first pass).
    round: integer("round").notNull(),
    turn: integer("turn").notNull(),
    seq: integer("seq").notNull(),
    // Tool name, or "result" / "stopped" for the stage's end.
    tool: text("tool").notNull(),
    // File path, prefix or query the call was about, when it has one.
    target: text("target"),
    ok: boolean("ok").notNull(),
    // Short outcome: the tool's confirmation or error, or the stage's result.
    summary: text("summary"),
    model: text("model"),
    // Only on `result` rows: the stage's model spend in micro-dollars.
    costMicros: integer("cost_micros").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [unique("agent_run_steps_position").on(table.runId, table.stage, table.round, table.turn, table.seq)]
);

export type AgentRunStepRow = typeof agentRunSteps.$inferSelect;

/** A pull request an agent opened on the workspace repository. Shown on the Pull Requests page. */
export const pullRequests = pgTable(
  "pull_requests",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    taskId: integer("task_id").references(() => tasks.id, { onDelete: "set null" }),
    runId: integer("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    number: integer("number").notNull(),
    githubId: bigint("github_id", { mode: "number" }).notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    headBranch: text("head_branch").notNull(),
    baseBranch: text("base_branch").notNull(),
    // "open" | "merged" | "closed".
    state: text("state").notNull(),
    // "pending" | "approved" | "changes_requested".
    reviewStatus: text("review_status").notNull().default("pending"),
    // "pending" | "passed" | "failed".
    testStatus: text("test_status").notNull().default("pending"),
    // Why the last merge attempt failed (conflict, failing checks …); cleared on success.
    mergeError: text("merge_error"),
    // Card the tester filed for a failed merge.
    followUpTaskId: integer("follow_up_task_id").references(() => tasks.id, { onDelete: "set null" }),
    mergedAt: timestamp("merged_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("pull_requests_workspace_number_unique").on(table.workspaceId, table.number),
    index("pull_requests_workspace_created_idx").on(table.workspaceId, table.createdAt),
  ]
);

export type PullRequestRow = typeof pullRequests.$inferSelect;

/**
 * Header bell notifications for a workspace's owner: a pull request is ready to merge, the analyst needs info, a run
 * stopped, the provider ran out of credit … Values of `kind` come from NOTIFICATION_KINDS in lib/notifications.ts.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    // In-app path to open (e.g. the board with the card's agent log).
    href: text("href"),
    taskId: integer("task_id").references(() => tasks.id, { onDelete: "set null" }),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("notifications_user_workspace_created_idx").on(table.userId, table.workspaceId, table.createdAt)]
);

export type NotificationRow = typeof notifications.$inferSelect;
