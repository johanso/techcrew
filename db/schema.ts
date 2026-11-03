import { sql } from "drizzle-orm";
import { bigint, boolean, date, index, integer, jsonb, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";

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
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("workspaces_owner_id_idx").on(table.ownerId)]
);

export type Workspace = typeof workspaces.$inferSelect;
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
    // OpenAI model id from AGENT_MODELS.
    model: text("model").notNull(),
    // Skill ids from SKILLS.
    skills: text("skills").array().notNull().default(sql`'{}'::text[]`),
    monthlyBudgetCents: integer("monthly_budget_cents").notNull(),
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
