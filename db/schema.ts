import { sql } from "drizzle-orm";
import { bigint, boolean, date, index, integer, jsonb, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";

import type { AgentModelId, AgentProvider } from "@/lib/agent-config";
import type { AnalystBrief, LeadDecision, ReviewReport, RunFailure, SecurityReport, TestReport } from "@/lib/agent-run-config";
import type { SkillScan } from "@/lib/agent-skills-config";
import type { TrustReport } from "@/lib/agent-trust";
import type { CiResult } from "@/lib/ci-gate";
import type { RunPreview, StoredSandboxCommands } from "@/lib/sandbox/config";

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
    // waiting for Run. Merge mode ("manual" | "auto_low_risk" | "auto", MERGE_MODES): whether approved, tested
    // agent pull requests merge on their own (always, or only when the Lead rated them low risk).
    agentAutoPickup: boolean("agent_auto_pickup").default(false).notNull(),
    agentMergeMode: text("agent_merge_mode").default("manual").notNull(),
    // No longer read: each agent's model sets its company (AI Team → Configure). Kept while the dev database is
    // shared with older branches; a later migration drops it.
    aiProvider: text("ai_provider").default("openai").notNull(),
    // When a company runs out of credit mid-run and the other one has a key, move the agents on it there and restart
    // the stage instead of stopping (Settings → AI providers). Off by default: moving changes those agents' models.
    aiAutoFailover: boolean("ai_auto_failover").default(false).notNull(),
    // Settings → Sandbox: agents with "Run tests in a sandbox" get run_tests / run_build / run_command. The commands
    // are saved with the switch (prefilled from package.json), so a run never guesses them.
    sandboxEnabled: boolean("sandbox_enabled").default(false).notNull(),
    sandboxCommands: jsonb("sandbox_commands").$type<StoredSandboxCommands>(),
    // Settings → Sandbox → Previews: each agent PR gets a preview on SANDBOX_PREVIEW_DOMAIN that the Tester can browse.
    sandboxPreview: boolean("sandbox_preview").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("workspaces_owner_id_idx").on(table.ownerId)]
);

export type Workspace = typeof workspaces.$inferSelect;

/**
 * A user's API key for an AI provider (Settings → Your account → AI keys): every workspace they own uses it. One per
 * provider. It wins over a workspace's own key (ai_provider_keys), which only covers a provider the account has no
 * key for; the server's environment key comes last. Never select `api_key` into client-facing data.
 */
export const userAiKeys = pgTable(
  "user_ai_keys",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    // AES-256-GCM ciphertext (lib/crypto.ts).
    apiKey: text("api_key").notNull(),
    // Masked form for display, e.g. "sk-ant-••••a1B2".
    hint: text("hint").notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [unique("user_ai_keys_user_provider").on(table.userId, table.provider)]
);

/**
 * A workspace's own API key for an AI provider (Settings → This project → AI providers), optional: used only when
 * the owner's account has no key for that provider (user_ai_keys wins). Kept out of `workspaces` so a workspace row
 * passed around can never carry a secret.
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
 * An AI agent of a workspace. Every workspace gets the six roles from lib/agent-config.ts (`key`), created on
 * first use by ensureDefaultAgents(); the user configures them on the AI Team page.
 */
export const agents = pgTable(
  "agents",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // Role key ("analyst", "developer", "reviewer", "security", "lead", "tester"); also what tasks.assignee_agent_id stores.
    key: text("key").notNull(),
    description: text("description").notNull(),
    instructions: text("instructions").notNull(),
    // Model id from AGENT_MODELS, on either company: its provider is the agent's company (each agent picks its own).
    model: text("model").notNull(),
    // The model this agent last used on each company, so an out-of-credit move there and back restores the choice.
    providerModels: jsonb("provider_models").$type<Partial<Record<AgentProvider, AgentModelId>>>().notNull().default({}),
    // Permission ids from PERMISSIONS (lib/agent-config.ts). The column kept its v0.1 name "skills"; "skills" now
    // means the installable knowledge packs in agent_skills.
    permissions: text("skills").array().notNull().default(sql`'{}'::text[]`),
    monthlyBudgetCents: integer("monthly_budget_cents").notNull(),
    // Model turns allowed per stage before the agent must submit its result. Null = the role's default.
    maxTurns: integer("max_turns"),
    // Paused agents don't pick up work (Run refuses).
    enabled: boolean("enabled").default(true).notNull(),
    // Latest Trust Score scan (lib/agent-trust.ts). Score is duplicated out of the report for queries.
    trustScore: integer("trust_score"),
    trustReport: jsonb("trust_report").$type<TrustReport>(),
    trustScannedAt: timestamp("trust_scanned_at"),
    // Agent fingerprint in Switch Trust (agn_…), set the first time the agent is registered there.
    switchAgentId: text("switch_agent_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [unique("agents_workspace_key_unique").on(table.workspaceId, table.key)]
);

export type AgentRow = typeof agents.$inferSelect;
export type NewAgentRow = typeof agents.$inferInsert;

/**
 * A workspace's skill library: knowledge packs in the Agent Skills format (SKILL.md + reference files) that agents
 * search and read while they work. Built-ins are created by ensureBuiltinSkills() from agent-skills/catalog.json and
 * read from disk; uploaded skills keep their files in agent_skill_files. Values of `type`, `load` and `source` come
 * from lib/agent-skills-config.ts. Blocked uploads are never stored.
 */
export const agentSkills = pgTable(
  "agent_skills",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // The skill's frontmatter name (built-ins: the slug in agent-skills/sources.json). Agents name skills by it.
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    // "technical" | "practice".
    type: text("type").notNull(),
    // "always" | "on_demand".
    load: text("load").notNull(),
    // "builtin" | "uploaded" | "project" (project skills from the linked repository: later).
    source: text("source").notNull(),
    // "GoogleChrome/modern-web-guidance@64a6d70" or "Uploaded by Ada Lovelace".
    origin: text("origin").notNull(),
    license: text("license"),
    // Content hash (12 hex characters, contentVersion in lib/skill-format.ts); changes with every new version.
    version: text("version").notNull(),
    fileCount: integer("file_count").notNull(),
    totalBytes: integer("total_bytes").notNull(),
    // Security scan of this version (passed / warned; blocked uploads aren't stored).
    scan: jsonb("scan").$type<SkillScan>(),
    // Agent role keys the skill fits: pre-checked on install, "Recommended for" in the configure dialog.
    suggestedRoles: text("suggested_roles").array().notNull().default(sql`'{}'::text[]`),
    // Permission ids the skill assumes (metadata techteam-requires); the dialog warns when an agent lacks one.
    requiresPermissions: text("requires_permissions").array().notNull().default(sql`'{}'::text[]`),
    createdById: integer("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [unique("agent_skills_workspace_slug_unique").on(table.workspaceId, table.slug)]
);

export type AgentSkillRow = typeof agentSkills.$inferSelect;

/** Files of an uploaded skill (text only: .md and .txt). `title` and `summary` are what search_skill matches. */
export const agentSkillFiles = pgTable(
  "agent_skill_files",
  {
    id: serial("id").primaryKey(),
    skillId: integer("skill_id")
      .notNull()
      .references(() => agentSkills.id, { onDelete: "cascade" }),
    // Relative to the skill folder, e.g. "SKILL.md", "references/checklist.md".
    path: text("path").notNull(),
    content: text("content").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    // UTF-8 bytes of `content`.
    size: integer("size").notNull(),
  },
  (table) => [unique("agent_skill_files_skill_path_unique").on(table.skillId, table.path)]
);

/** Which agent uses which skill. A row with enabled = false is a skill the user switched off; nothing re-enables it on its own. */
export const agentSkillAssignments = pgTable(
  "agent_skill_assignments",
  {
    id: serial("id").primaryKey(),
    agentId: integer("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    skillId: integer("skill_id")
      .notNull()
      .references(() => agentSkills.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("agent_skill_assignments_agent_skill_unique").on(table.agentId, table.skillId),
    index("agent_skill_assignments_skill_idx").on(table.skillId),
  ]
);

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
 * What people did to cards on the board (moved to another column, edited, removed), for the Activity page.
 * Creating a card needs no row: tasks.created_by_id already says it. Values of `kind` come from TASK_EVENT_KINDS
 * in lib/task-events.ts.
 */
export const taskEvents = pgTable(
  "task_events",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    taskId: integer("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    detail: text("detail"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("task_events_workspace_created_idx").on(table.workspaceId, table.createdAt)]
);

/**
 * A file the owner attached to a card for the agents to build from (an image, a Markdown or text file, a PDF). The
 * file and a PDF's extracted text live in private S3 (lib/references.ts); this row only says what and where, so it
 * stays tiny. Deleted with its S3 objects when the card is removed (rows of a deleted workspace cascade).
 */
export const taskReferences = pgTable(
  "task_references",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    taskId: integer("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    // REFERENCE_KINDS in lib/reference-config.ts: "image" | "text" | "pdf".
    kind: text("kind").notNull(),
    // Display name (the uploaded file's name, cleaned).
    name: text("name").notNull(),
    // Detected from the bytes, not the browser's claim.
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    // S3 key: card-references/<workspaceId>/<taskId>/<uuid>.<ext>. Never sent to a client.
    storageKey: text("storage_key").notNull(),
    // PDFs: S3 key of the extracted text (null when the PDF had none), its length and the page count.
    textKey: text("text_key"),
    textLength: integer("text_length"),
    pageCount: integer("page_count"),
    // Images: pixel size.
    width: integer("width"),
    height: integer("height"),
    createdById: integer("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("task_references_task_idx").on(table.taskId)]
);

export type TaskReferenceRow = typeof taskReferences.$inferSelect;

/**
 * A workspace's Switch Trust account (Settings → Switch Trust). Agents are registered there and evaluated by it;
 * see lib/switch-trust.ts.
 */
export const switchConnections = pgTable("switch_connections", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id")
    .notNull()
    .unique()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  // AES-256-GCM ciphertext (lib/crypto.ts); null = the server's key (SWITCH_AGENT_AI_API_KEY). Never sent to the client.
  apiKey: text("api_key"),
  // Masked form for display; null for the server's key.
  hint: text("hint"),
  // "ApiKey" or "Bearer": the Authorization scheme the instance accepted when the account was connected.
  authScheme: text("auth_scheme").notNull(),
  // API base URL, e.g. https://api.switchagents.ai/api/v1.
  instanceUrl: text("instance_url").notNull(),
  tenantId: text("tenant_id").notNull(),
  switchWorkspaceId: text("switch_workspace_id").notNull(),
  // The one evaluation every agent runs (the fastest built-in one, picked on the first scan).
  evaluationId: text("evaluation_id"),
  evaluationName: text("evaluation_name"),
  // Settings → Switch Trust: scan every agent again each week (lib/inngest/switch-weekly.ts).
  weeklyScans: boolean("weekly_scans").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type SwitchConnectionRow = typeof switchConnections.$inferSelect;

/**
 * One SwitchAgent scan of one agent: registered in Switch, one evaluation run, health score read back. Advanced in
 * the background by Cloudhike jobs calling /api/switch-trust/scans/<id>. Values of `status` come from
 * TRUST_SCAN_STATUSES in lib/switch-trust-config.ts.
 */
export const trustScans = pgTable(
  "trust_scans",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    agentId: integer("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    // "connected" (account connected or a provider key saved), "manual" (SwitchAgent Scan) or "scheduled" (weekly).
    trigger: text("trigger").notNull(),
    status: text("status").notNull(),
    // Evaluation run in Switch Trust, once triggered.
    switchRunId: text("switch_run_id"),
    // Latest Cloudhike job run advancing this scan.
    jobId: text("job_id"),
    // sha256 of the token the job sends back; replaced on every job, cleared when the scan ends.
    tokenHash: text("token_hash"),
    error: text("error"),
    // Model spend of the evaluation's attacks on the agent, in micro-dollars (logged with the result).
    costMicros: integer("cost_micros").notNull().default(0),
    createdById: integer("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
  },
  (table) => [index("trust_scans_agent_created_idx").on(table.agentId, table.createdAt)]
);

export type TrustScanRow = typeof trustScans.$inferSelect;

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
    // Current (or last) pipeline phase (RUN_STAGES: analysis … merge); null while queued.
    stage: text("stage"),
    // Working branch in the workspace repository, created by the developer stage.
    branch: text("branch"),
    brief: jsonb("brief").$type<AnalystBrief>(),
    review: jsonb("review").$type<ReviewReport>(),
    // Security's report, from the same round as `review` (they run in parallel).
    securityReport: jsonb("security_report").$type<SecurityReport>(),
    // The Lead's decision after both reviews, with the final risk (raised to the deterministic floor).
    approval: jsonb("approval").$type<LeadDecision>(),
    testReport: jsonb("test_report").$type<TestReport>(),
    // CI on the pull request after each development round (the CI gate before review), oldest first.
    ci: jsonb("ci").$type<CiResult[]>(),
    // The run's live preview on the sandbox host (Settings → Sandbox → Previews), started after the CI gate.
    preview: jsonb("preview").$type<RunPreview>(),
    // Development rounds after the first one (the Lead or the tests sent the work back).
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
    // Agent stage (AGENT_STAGES): "review" and "security" run in parallel in the same round.
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
    // S3 key of the screenshot a browse_preview call took; served only to the workspace owner.
    screenshotKey: text("screenshot_key"),
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
    // The Lead's decision: "pending" | "approved" | "changes_requested".
    reviewStatus: text("review_status").notNull().default("pending"),
    // The Lead's final risk rating: "low" | "medium" | "high"; null until approval.
    risk: text("risk"),
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
