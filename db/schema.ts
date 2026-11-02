import { sql } from "drizzle-orm";
import { bigint, boolean, date, index, integer, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";

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
