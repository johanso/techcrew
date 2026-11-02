# Data model

All app data lives in PostgreSQL, in the `public` schema, defined in [`db/schema.ts`](../db/schema.ts) with Drizzle.
The hosted auth service keeps identities elsewhere (its own `auth` schema); the app only mirrors what it needs.

- [Diagram](#diagram)
- [users](#users)
- [github_connections](#github_connections)
- [workspaces](#workspaces)
- [tasks](#tasks)
- [Value vocabularies](#value-vocabularies)
- [Behaviors worth knowing](#behaviors-worth-knowing)
- [Schema changes](#schema-changes)

---

## Diagram

```mermaid
erDiagram
    users ||--o| github_connections : "has (0..1)"
    users ||--o{ workspaces : owns
    users ||--o{ tasks : "created (nullable)"
    workspaces ||--o{ tasks : contains

    users {
        serial id PK
        text auth_user_id UK
        text email UK
        text name
        boolean email_verified
        text image
        timestamp last_sign_in_at
    }
    github_connections {
        serial id PK
        int user_id FK,UK
        bigint github_user_id
        text login
        text access_token "AES-256-GCM"
        text scope
    }
    workspaces {
        serial id PK
        int owner_id FK
        text name
        text icon
        text logo_key
        bigint github_repo_id
        text github_repo_full_name
        timestamp github_issues_synced_at
    }
    tasks {
        serial id PK
        int workspace_id FK
        int number "per workspace"
        text type
        text status
        int position
        bigint github_issue_id "nullable"
        text assignee_agent_id "nullable"
        timestamp removed_at "nullable"
    }
```

Every foreign key to `users` / `workspaces` is `ON DELETE CASCADE`, except `tasks.created_by_id` (`SET NULL`).

## users

Mirror of the hosted auth user. Created on first sign-in, refreshed on every sign-in (`lib/user-sync.ts`).

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | serial | no | | Primary key. What every other table references. |
| `auth_user_id` | text | no | | Better Auth `user.id`. **Unique.** Used to find the row from a session. |
| `name` | text | yes | | Display name from the auth service. |
| `email` | text | no | | **Unique.** |
| `email_verified` | boolean | no | `false` | |
| `image` | text | yes | | Avatar URL (e.g. from GitHub/Google). |
| `created_at` | timestamp | no | `now()` | "Member since". |
| `updated_at` | timestamp | no | `now()` | |
| `last_sign_in_at` | timestamp | no | `now()` | Updated on each sign-in. |

## github_connections

A user's linked GitHub account, used to read repositories and issues. **One per user** (`user_id` is unique).
Independent from "Sign in with GitHub" — see [github-integration.md](github-integration.md#why-a-separate-oauth-app).

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | serial | no | Primary key. |
| `user_id` | integer | no | → `users.id`, cascade. **Unique.** |
| `github_user_id` | bigint | no | GitHub's numeric user id. |
| `login` | text | no | GitHub username, shown as "Connected as @login". |
| `avatar_url` | text | yes | |
| `access_token` | text | no | **Encrypted** with AES-256-GCM (`lib/crypto.ts`), format `v1.<iv>.<tag>.<ciphertext>`. Only `getGithubToken()` decrypts it; never send it to the client. |
| `scope` | text | yes | Scopes GitHub granted (expected `repo,read:user`). |
| `created_at`, `updated_at` | timestamp | no | `updated_at` changes on reconnect. |

Reconnecting overwrites the row (upsert on `user_id`). "Disconnect" deletes it.

## workspaces

A workspace is bound to **exactly one** GitHub repository, chosen at creation. Owned by one user.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | serial | no | Primary key. Appears in URLs (`/dashboard/<id>`). |
| `owner_id` | integer | no | → `users.id`, cascade. Indexed (`workspaces_owner_id_idx`). |
| `name` | text | no | 1–60 characters (validated in `createWorkspace`). Also drives the task key prefix. |
| `icon` | text | no | Key from `lib/workspace-icons.ts` (16 icons), used when there's no logo. |
| `logo_key` | text | yes | S3 object key of an uploaded logo, e.g. `workspace-logos/1/<uuid>.png`. |
| `github_repo_id` | bigint | no | GitHub's numeric repository id. |
| `github_repo_full_name` | text | no | `owner/name`. Used for every GitHub API call about this workspace. |
| `github_repo_url` | text | no | `https://github.com/owner/name`. |
| `github_default_branch` | text | no | Snapshot at link time. |
| `github_repo_private` | boolean | no | Snapshot at link time. |
| `github_issues_synced_at` | timestamp | yes | Last successful issue sync, **minus 60 s** of overlap; passed to GitHub as `since`. `null` = never synced (the next sync imports all open issues). |
| `created_at`, `updated_at` | timestamp | no | |

The repository metadata is captured once. If the repo is renamed or its default branch changes on GitHub, these
columns aren't updated (yet).

## tasks

A card on a workspace's Kanban board. Created in the app, or imported from a GitHub issue.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | serial | no | | Primary key. Used as the card id in the UI (as a string). |
| `workspace_id` | integer | no | | → `workspaces.id`, cascade. |
| `number` | integer | no | | Per-workspace sequence shown in the key, e.g. `ACM-142`. Allocated as `max(number) + 1` under a workspace row lock. **Unique with `workspace_id`.** |
| `type` | text | no | | `feature` \| `bug` \| `issue`. |
| `title` | text | no | | ≤ 120 characters when written by the app; GitHub titles are stored as-is. |
| `description` | text | no | `''` | ≤ 5000 characters (GitHub bodies are truncated to that). |
| `priority` | text | no | | `urgent` \| `high` \| `medium` \| `low`. |
| `status` | text | no | | Column id: `todo` \| `in_development` \| `in_review` \| `testing` \| `done`. |
| `position` | integer | no | | Sort key within the column, ascending. **Not contiguous**: new cards take `min(position) - 1` (top, can go negative); a drag-and-drop rewrites the touched columns as `0..n-1`. |
| `labels` | text[] | no | `'{}'` | Lowercase, trimmed, unique, ≤ 5 labels of ≤ 30 characters. |
| `due_date` | date | yes | | Calendar date, handled as a `yyyy-MM-dd` string. |
| `created_by_id` | integer | yes | | → `users.id`, `SET NULL`. `null` for GitHub imports. |
| `github_issue_id` | bigint | yes | | GitHub's global issue id. **Unique with `workspace_id`** (NULLs don't conflict, so app cards are unaffected). Non-null ⇒ the card mirrors a GitHub issue. |
| `github_issue_number` | integer | yes | | The `#123` shown on the card. |
| `github_issue_url` | text | yes | | Link to the issue. |
| `github_issue_state` | text | yes | | `open` \| `closed`, as last seen on GitHub. |
| `github_updated_at` | timestamp | yes | | The issue's `updated_at` at the last sync; a sync only rewrites the card when GitHub's value is newer. |
| `assignee_agent_id` | text | yes | | Agent id from `lib/agents.ts` (set by **Run** — currently always `analyst`). |
| `removed_at` | timestamp | yes | | Set by **Remove task**. Removed rows are hidden everywhere but kept (see below). |
| `created_at`, `updated_at` | timestamp | no | `now()` | |

Indexes and constraints:

| Name | Columns | Purpose |
| --- | --- | --- |
| `tasks_workspace_number_unique` | `(workspace_id, number)` | Keys are never duplicated. |
| `tasks_workspace_github_issue_unique` | `(workspace_id, github_issue_id)` | One card per GitHub issue, even with concurrent syncs. |
| `tasks_workspace_status_position_idx` | `(workspace_id, status, position)` | Loading and ordering columns. |

## Value vocabularies

`type`, `priority` and `status` are plain `text` columns, not Postgres enums; the allowed values live in
[`lib/board-config.ts`](../lib/board-config.ts) (`ISSUE_TYPES`, `ISSUE_PRIORITIES`, `BOARD_COLUMNS`) and are
enforced by the server-side validators in `lib/board.ts` (`parseCardInput`, `parseBoardInput`). If a row ever holds
an unknown `status` (e.g. after renaming a column), `getBoardData` shows it in **Todo** rather than hiding it.

Agent ids (`assignee_agent_id`) come from `DUMMY_AGENTS` in [`lib/agents.ts`](../lib/agents.ts): `atlas`, `nova`,
`sage`, `orion`, `analyst`. An unknown id renders as unassigned.

## Behaviors worth knowing

**Task keys.** The key is computed, not stored: `taskKeyPrefix(workspace.name)` + `-` + `number`. The prefix is the
first three letters of the workspace name, uppercased (`Acme Platform` → `ACM`, a name without letters → `TSK`).
Renaming a workspace therefore changes every key's prefix; the numbers stay.

**Soft delete.** "Remove task" sets `removed_at`; rows are never deleted by the app, because:
- keys must never be reused (`number` stays taken), and
- a removed GitHub issue must not be imported again by the next sync (the row with its `github_issue_id` remains).

Every board query goes through `onBoard()` in `lib/board.ts` (`workspace_id = ? AND removed_at IS NULL`), so removed
cards can't be read, edited, moved, assigned or run.

**Ownership of fields on GitHub cards.** GitHub owns `title`, `description`, `labels`, `github_*`; the board owns
`status`, `position`, `type`, `priority`, `due_date`, `assignee_agent_id`. Details in
[github-integration.md](github-integration.md#ownership-rules).

**Locking.** Creating a card and running a GitHub sync both start with
`SELECT … FROM workspaces WHERE id = ? FOR UPDATE` inside a transaction, which serializes numbering and syncs per
workspace.

**Deleting a user or workspace** cascades to everything below it (connections, workspaces, tasks). There's no UI
for either yet.

## Schema changes

The project uses **`drizzle-kit push`** (no migration files):

1. Edit `db/schema.ts`.
2. Run `npm run db:push`. It diffs the schema against the live database, prints the SQL, and applies it.
3. Commit the schema change together with the code that uses it.

Things to know:

- `push` only touches the `public` schema (`schemaFilter` in `drizzle.config.ts`) and ignores `pg_stat_*` tables.
- Additive changes (new table, new nullable column, new index) apply directly.
- Risky changes stop for confirmation and need an interactive terminal — e.g. adding a unique constraint to a
  table that already has rows makes drizzle-kit offer to **truncate** the table. Don't accept that unless you mean
  it; empty the affected rows deliberately or add the constraint in a way that can't fail.
- drizzle-kit re-emits `ALTER COLUMN "labels" SET DEFAULT '{}'::text[]` on every push. It's harmless (same value).
- Dropping a column/table that exists in the database but not in the schema is also proposed by `push` — check
  that no other branch still needs it.
- `npm run db:generate` (SQL files in `drizzle/`) is available if the team moves to migrations later.
