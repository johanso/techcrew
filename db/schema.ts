import { bigint, boolean, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

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
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("workspaces_owner_id_idx").on(table.ownerId)]
);

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
